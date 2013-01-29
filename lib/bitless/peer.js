var common = require('common');
var bitfield = require('./bitfield');
var protocol = require('./protocol');
var environment = require('./environment');
var utils = require('./utils');
var socket = environment.socket;
var logger = environment.logger.create('peer');

var KEEP_ALIVE_BUFFER = new Buffer(0);
var LENGTH_BUFFER = new Buffer(4);
var MAX_MESSAGE_LENGTH = Math.pow(2, 16);

var SOCKET_TIMEOUT = 120000; // milliseconds
var KEEP_ALIVE_INTERVAL = 60000;

var STALLED_TIMEOUT = 60; // seconds
var REQUEST_LIMIT = 3;
var BLOCK_LENGTH = Math.pow(2, 14);
var UPLOAD_LIMIT = 10;
var UPLOAD_QUEUE_LIMIT = 2;
var BUFFER_LIMIT = Math.pow(2, 14);

var error = function(msg) {
	throw new Error(msg);
};

var DownloadQueue = common.emitter(function(peer) {
	this.peer = peer;
	this.pieces = [];
	this.length = 0;

	this.paused = true;
	this.pieceReceivedAt = 0;

	this._requests = [];
	this._pendingRequests = [];

	var self = this;

	peer.on('message_piece', function(message) {
		var request = self._pendingRequests.filter(function(r) {
			return r.is(message);
		})[0];

		if(!request) {
			self.emit('peer_error', new Error('Unexpected piece message'), message);
			return;
		}

		self.pieceReceivedAt = utils.time.seconds();

		var i = self._pendingRequests.indexOf(request);
		var piece = self.pieces.filter(function(p) {
			return p.index === message.index;
		})[0];

		self._pendingRequests.splice(i, 1);
		piece.setBlock(message.offset, message.block);

		if(self._completed(message.index)) {
			logger.info(peer.address, 'Completed piece', piece.index);
			
			var j = self.pieces.indexOf(piece);

			self.pieces.splice(j, 1);
			this.length--;

			if(!piece.valid()) {
				logger.warn(peer.address, 'Received bad piece', message.index);

				self.emit('peer_error', new Error('Invalid piece hash'), message);
				self.push(piece);

				return;
			}

			self.emit('piece', piece);
		}
		
		if(self._requests.length < REQUEST_LIMIT) {
			self.emit('drain');
		}

		if(!peer.isChoking && !self.paused) {
			self._sendRequests();
		}
	});
});
DownloadQueue.prototype.push = function(piece, missingRequests) {
	this.pieces.push(piece);
	this.length++;

	if(missingRequests && missingRequests.length) {
		this._requests = this._requests.concat(missingRequests);
		return;
	}

	var offset = 0;

	while(offset < piece.length) {
		var length = piece.length - offset;

		if(length > BLOCK_LENGTH) {
			length = BLOCK_LENGTH;
		}

		var request = new protocol.Request(piece.index, offset, length);
		offset += length;

		this._requests.push(request);
	}
};
DownloadQueue.prototype.remove = function(index) {
	this._requests = this._requests.filter(function(request) {
		return request.index !== index;
	});
	this._pendingRequests = this._pendingRequests.filter(function(request) {
		return request.index !== index;
	});

	for(var i = 0; i < this.pieces.length; i++) {
		var piece = this.pieces[i];

		if(piece.index === index) {
			this.pieces.splice(i, 1);
			this.length--;
			return piece;
		}
	}

	return null;
};
DownloadQueue.prototype.requests = function(index) {
	return self._requests.concat(self._pendingRequests).filter(function(request) {
		return request.index === index;
	});
};
DownloadQueue.prototype.pause = function() {
	this.paused = true;
};
DownloadQueue.prototype.resume = function() {
	if(!this.paused) {
		return;
	}

	this.paused = false;

	this._requests = this._requests.concat(this._pendingRequests);
	this._pendingRequests = [];

	this._sendRequests();
};
DownloadQueue.prototype.cancelRequest = function(indexOrCancelMessage, offset, length) {
	var cancel = indexOrCancelMessage;

	if(typeof indexOrCancelMessage !== 'object') {
		cancel = new protocol.Cancel(indexOrCancelMessage, offset, length);
	}

	var remove = function(requests) {
		for(var i = 0; i < requests.length; i++) {
			var request = requests[i];

			if(request.is(cancel)) {
				requests.splice(i, 1);
				return request;
			}
		}
	};

	var request = remove(this._requests);

	if(request) {
		return request;
	}

	request = remove(this._pendingRequests);

	if(request) {
		this.peer.send(cancel);
		return request;
	}

	return null;
};
DownloadQueue.prototype.hasStalled = function() {
	return !!this.pieces.length && (utils.time.seconds() - this.pieceReceivedAt > STALLED_TIMEOUT);
};
DownloadQueue.prototype._completed = function(index) {
	return !this._requests.concat(this._pendingRequests).some(function(r) {
		return r.index === index;
	});
};
DownloadQueue.prototype._sendRequests = function() {
	logger.debug(this.peer.address, 'Sending requests, pending_length', 
		this._pendingRequests.length, ', requests_length', this._requests.length);

	while(this._requests.length && this._pendingRequests.length < REQUEST_LIMIT) {
		var request = this._requests.splice(0, 1)[0];

		this.peer.send(request);
		this._pendingRequests.push(request);
	}
};

var UploadQueue = common.emitter(function(peer) {
	this.peer = peer;
	this.pieces = [];
	this.length = 0;

	this.paused = true;

	this._waiting = null;
	this._requests = [];

	var self = this;

	peer.on('message_request', function(message) {
		if(peer.amChoking || self.paused) {
			return;
		}

		if(self._requests.length < UPLOAD_LIMIT) {
			self._requests.push(message);
			self._scheduleUpload();
		}
	});
	peer.on('message_cancel', function(message) {
		self.cancelRequest(message);
	});
});
UploadQueue.prototype.push = function(piece) {
	if(this.paused) {
		return;
	}

	this.pieces.push(piece);
	this.length++;

	if(this.pieces.length > UPLOAD_QUEUE_LIMIT) {
		this.pieces.splice(0, this.pieces.length - UPLOAD_QUEUE_LIMIT);
		this.length = this.pieces.length;
	}

	logger.debug(this.peer.address, 'Pushed piece', piece.index, 'queue length', this.length);

	this._scheduleUpload();
};
UploadQueue.prototype.remove = function(index) {
	this._requests = this._requests.filter(function(request) {
		return request.index !== index;
	});

	for(var i = 0; i < this.pieces.length; i++) {
		var piece = this.pieces[i];

		if(piece.index === index) {
			this.pieces.split(i, 1);
			this.length--;
			return piece;
		}
	}

	return null;
};
UploadQueue.prototype.requests = function(index) {
	return this._requests.filter(function(request) {
		return request.index === index;
	});
};
UploadQueue.prototype.pause = function() {
	if(this.paused) {
		return;
	}

	this.peer.sendChoke();

	this.paused = true;
	this._requests = [];
	this.pieces = [];
	this.length = 0;

	if(this._waiting) {
		this.peer.messenger.removeListener('drain', this._waiting);
		this._waiting = null;
	}
};
UploadQueue.prototype.resume = function() {
	if(!this.paused) {
		return;
	}

	this.paused = false;
	this.peer.sendUnchoke();
};
UploadQueue.prototype.cancelRequest = function(indexOrCancelMessage, offset, length) {
	var cancel = indexOrCancelMessage;

	if(typeof indexOrCancelMessage !== 'object') {
		cancel = new protocol.Cancel(indexOrCancelMessage, offset, length);
	}

	for(var i = 0; i < this._requests.length; i++) {
		var request = this._requests[i];

		if(request.is(cancel)) {
			this._requests.splice(i, 1);
			return request;
		}
	}

	return null;
};
UploadQueue.prototype._scheduleUpload = function() {
	if(this._waiting || !this._requests.length) {
		return;
	}

	var request = this._requests[0]; //.splice(0, 1)[0];
	var piece = this.pieces.filter(function(piece) {
		return piece.index === request.index;
	})[0];

	if(!piece) {
		this.emit('drain', request.index);
		return;
	}

	this._requests.splice(0, 1);

	if(this.peer.messenger.isWritable()) {
		this._upload(request, piece);
	} else {
		logger.debug(this.peer.address, 'Queuing upload');

		this._waiting = this._upload.bind(this, request, piece);
		this.peer.messenger.once('drain', this._waiting);
	}
};
UploadQueue.prototype._upload = function(request, piece) {
	logger.debug(this.peer.address, 'Writing piece to peer');

	try {
		var block = piece.getBlock(request.offset, request.pieceLength);

		this.peer.sendPiece(request.index, request.offset, block);
		this._waiting = null;

		this._scheduleUpload();
	} catch(err) {
		this.emit('peer_error', err, request);
	}
};

var Messenger = common.emitter(function(socket, addr) {
	this._socket = socket;

	socket.setTimeout(SOCKET_TIMEOUT);

	var self = this;

	var pstrlen;
	var readingHandshake = true;
	
	var readingLength = true;
	var buffer = new Buffer(1);
	var bufferOffset = 0;

	var valid = function(len) {
		if(len > MAX_MESSAGE_LENGTH) {
			socket.end();
			self.emit('abort', new Error('Reading length too big'));

			return false;
		}

		return true;
	};

	socket.on('data', function(data) {
		var dataOffset = 0;

		while(dataOffset < data.length) {
			var available = Math.min(data.length, dataOffset + buffer.length - bufferOffset);
			var copied = available - dataOffset;

			data.copy(buffer, bufferOffset, dataOffset, available);

			dataOffset += copied;
			bufferOffset += copied;

			if(bufferOffset < buffer.length) {
				return;
			}

			bufferOffset = 0;
			
			if(readingLength) {
				if(readingHandshake) {
					pstrlen = buffer.get(0);

					if(!valid(pstrlen)) {
						return;
					}

					buffer = new Buffer(protocol.Handshake.byteLength(pstrlen));
					readingLength = false;

					continue;
				}

				var length = protocol.unpackMessageLength(buffer);

				logger.log(addr, 'Length to read', length);

				if(!valid(length)) {
					return;
				}

				if(length === 0) {
					self.emit('message', KEEP_ALIVE_BUFFER);
					continue;
				}

				readingLength = false;
				buffer = new Buffer(length);
			} else {
				if(readingHandshake) {
					self.emit('handshake', buffer, pstrlen);
					
					readingHandshake = false;
					readingLength = true;
					buffer = LENGTH_BUFFER;

					continue;
				}

				self.emit('message', buffer);
				
				readingLength = true;
				buffer = LENGTH_BUFFER;
			}
		}
	});
	socket.on('error', function(e) {
		self.emit('abort', e);
	});
	socket.on('timeout', function() {
		logger.debug(addr, 'Peer timed out');
		socket.end();
	});
	socket.on('close', function() {
		self.emit('end');
	});
	socket.on('drain', function() {
		self.emit('drain');
	});
});
Messenger.prototype.send = function(message) {
	this._socket.write(message.pack());
};
Messenger.prototype.isWritable = function() {
	return this._socket.bufferSize <= BUFFER_LIMIT;
};
Messenger.prototype.close = function() {
	this._socket.end();
};

var Rate = function(peer) {
	this.peer = peer;

	this.updatedAt = peer.connectedAt;
	this.uploaded = 0;
	this.downloaded = 0;
};
Rate.prototype.update = function() {
	this.updatedAt = utils.time.milliseconds();
	this.uploaded = this.peer.uploaded;
	this.downloaded = this.peer.downloaded;
};
Rate.prototype.getDownloadRate = function() {
	return this._getRate('downloaded');
};
Rate.prototype.getUploadRate = function() {
	return this._getRate('uploaded');
};
Rate.prototype._getRate = function(measure) {
	var rate = this.peer[measure] - this[measure];
	var delta = utils.time.milliseconds() - this.updatedAt;

	return delta ? (rate / delta) : 0;
};

var Peer = common.emitter(function(torrent, socket, addr) {
	this.id = null;

	var self = this;

	this.torrent = torrent;
	this.address = addr;
	//addr = this.address = { host: addr.ip, port: addr.port };
	this.haves = null;
	this.handshakeReceived = false;
	this.handshakeSent = false;
	this.connectedAt = null;

	// How much data the peer downloaded/uploaded from/to us
	this.uploaded = 0;
	this.downloaded = 0;

	// Is the peer interested in us
	this.isInterested = false;
	// Is the peer choking us
	this.isChoking = true;
	// Am I interested in the peer
	this.amInterested = false;
	// Am I choking the peer
	this.amChoking = true;

	this._rates = {};
	this._keepAlive = null;

	this.downloadQueue = new DownloadQueue(this);
	this.uploadQueue = new UploadQueue(this);
	var messenger = this.messenger = new Messenger(socket, addr);

	var peerError = function(err, message) {
		logger.warn(addr, 'Protocol error', err.message);
		logger.log(err.stack);
	};

	this.downloadQueue.on('peer_error', peerError);
	this.uploadQueue.on('peer_error', peerError);

	messenger.on('handshake', function(hs, pstrlen) {
		try {
			hs = protocol.Handshake.unpack(pstrlen, hs);
		} catch(err) {
			messenger.close();
			self.emit('abort', err);

			return;
		}

		logger.debug(addr, 'Handshake received', hs);

		self.handshakeReceived = true;
		self.connectedAt = utils.time.seconds();
		self.id = hs.peerId;

		self._scheduleKeepAlive();

		self.emit('handshake', hs);
	});
	messenger.on('message', function(message) {
		logger.debug(addr, 'Received message, with length', message.length, 
			' and id', (message.length > 0 ? message.get(0) : '~'));

		if(!message.length) {
			return;
		}

		var id = message.get(0);

		if(!self.isReady() && id !== protocol.Bitfield.ID) {
			self.haves = new bitfield.Bitfield(self.torrent.numberOfPieces);
		}

		try {
			switch(id) {
			case protocol.Choke.ID:
				message = protocol.Choke.unpack(message);
				self.isChoking = true;

				break;
			case protocol.Unchoke.ID:
				message = protocol.Unchoke.unpack(message);
				self.isChoking = false;

				break;
			case protocol.Interested.ID:
				message = protocol.Interested.unpack(message);
				self.isInterested = true;

				break;
			case protocol.NotInterested.ID:
				message = protocol.NotInterested.unpack(message);
				self.isInterested = false;

				break;
			case protocol.Have.ID:
				message = protocol.Have.unpack(message);
				self.haves.set(message.piece, true);

				break;
			case protocol.Bitfield.ID:
				if(self.isReady()) {
					error('Already received bitfield');
				}

				message = protocol.Bitfield.unpack(message, self.torrent.numberOfPieces);
				self.haves = message.bitfield;

				break;
			case protocol.Request.ID:
				message = protocol.Request.unpack(message);

				break;
			case protocol.Cancel.ID:
				message = protocol.Cancel.unpack(message);

				break;
			case protocol.Piece.ID:
				message = protocol.Piece.unpack(message);

				break;
			default:
				error('Unknown message id ' + id);
			}

			self.uploaded += message.totalLength;
		} catch(err) {
			peerError(err, message);
			return;
		}

		self.emit('message', message);
		self.emit('message_' + message.name.toLowerCase(), message);
	});
	messenger.on('abort', function(e) {
		logger.warn(addr, 'Peer died:', e.message);
		self.emit('abort', e);
	});
	messenger.on('end', function() {
		logger.debug(addr, 'Peer closed');

		clearTimeout(self._keepAlive);
		self.emit('end');
	});
});
Peer.prototype.send = function(message) {
	logger.debug(this.address, 'Sending message to peer', message.name);

	this.downloaded += message.totalLength;
	this.messenger.send(message);

	this.emit('send', message);

	this._scheduleKeepAlive();

	return message;
};
Peer.prototype.close = function(callback) {
	if(callback) {
		this.once('end', callback);
	}

	clearTimeout(this._keepAlive);
	this.messenger.close();
};
Peer.prototype.hasPiece = function(index) {
	return this.isReady() && this.haves.get(index);
};
Peer.prototype.isReady = function() {
	return this.handshakeReceived && this.handshakeSent && !!this.haves;
};
Peer.prototype.equals = function(other) {
	return other.address.host === this.address.host &&
		other.address.port === this.address.port &&
		other.id.equals(this.id);
};
Peer.prototype.getRate = function(name) {
	var rate = this._rates[name];

	if(!rate) {
		rate = new Rate(this);
		this._rates[name] = rate;
	}

	return rate;
};
Peer.prototype._scheduleKeepAlive = function() {
	var self = this;

	clearTimeout(this._keepAlive);

	this._keepAlive = setTimeout(function() {
		self.sendKeepAlive();
	}, KEEP_ALIVE_INTERVAL);
};
Peer.prototype.__handshake = function() {
	this.handshakeSent = true;
};
Peer.prototype.__choke = function() {
	this.amChoking = true;
};
Peer.prototype.__unchoke = function() {
	this.amChoking = false;
};
Peer.prototype.__interested = function() {
	this.amInterested = true;
};
Peer.prototype.__notInterested = function() {
	this.amInterested = false;
};

[
	'Handshake',
	'KeepAlive', 
	'Choke', 
	'Unchoke', 
	'Interested', 
	'NotInterested', 
	'Have', 
	'Bitfield', 
	'Request', 
	'Cancel', 
	'Piece'
].forEach(function(name) {
	var Klass = protocol[name];
	var privateMethodName = '__' + Klass.NAME;

	Peer.prototype['send' + name] = function() {
		var message = Object.create(Klass.prototype);
		Klass.apply(message, arguments);

		if(Peer.prototype[privateMethodName]) {
			this[privateMethodName](message);
		}

		return this.send(message);
	};
});

exports.Peer = Peer;

exports.acceptHandshake = function(connection, options, callback) {
	utils.arguments.expect(options, 'address', 'torrent');

	var torrents = options.torrent;
	torrents = utils.array.is(torrents) ? torrents : [torrents];
	var peer = new Peer(null, connection, options.address);

	var onend = function() {
		callback(new Error('Peer closed before handshake exchange'));
	};

	peer.on('end', onend);
	peer.once('handshake', function(hs) {
		peer.removeListener('end', onend);

		for(var i = 0; i < torrents.length; i++) {
			var torrent = torrents[i];

			if(utils.buffer.equals(hs.infoHash, torrent.infoHash)) {
				peer.torrent = torrent;
				callback(null, peer, torrent);

				return;
			}
		}

		peer.close();
		callback(new Error('Mismatching info hash recevied from peer'));
	});
};
exports.initiateHandshake = function(options, callback) {
	utils.arguments.expect(options, 'address', 'torrent', 'id');

	var torrent = options.torrent;
	var connection = socket.connect(options.address.port, options.address.host);
	var peer = new Peer(torrent, connection, options.address);

	var onend = function() {
		callback(new Error('Peer closed connection before handshake exchange'));
	};

	connection.once('connect', function() {
		peer.sendHandshake(torrent.infoHash, options.id);
	});
	peer.on('end', onend);
	peer.once('handshake', function(hs) {
		peer.removeListener('end', onend);

		if(!utils.buffer.equals(hs.infoHash, torrent.infoHash)) {
			peer.close();
			callback(new Error('Mismatching info hash recevied from peer'));

			return;
		}

		callback(null, peer);
	});
};
