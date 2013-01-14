var common = require('common');
var protocol = require('./protocol');
var peerid = require('./peer-id');
var peer = require('./peer');
var storage = require('./storage');
var torrent = require('./torrent');
var tracker = require('./tracker');
var utils = require('./utils');
var logger = require('./environment').logger.create('controller');

var PORTS = utils.array.range(6881, 6890);

var DEFAULT_DOWNLOADER_LIMIT = 10;
var DEFAULT_UPLOADER_LIMIT = 5;
var DEFAULT_PEER_LIMIT = 30;

var PEER_THRESHOLD = 5;
var PEER_LIMIT_THRESHOLD = 10;

var CHOKE_INTERVAL = 10000;
var CHOKE_RATE_ID = 10;

var noop = function() {};
var nullify = function(fn) {
	return function(arg) {
		fn(null, arg);
	};
};

var sortByDownloaded = function(p1, p2) {
	return p2.getRate(CHOKE_RATE_ID).getDownloadRate() - p1.getRate(CHOKE_RATE_ID).getDownloadRate();
};
var sortByUploaded = function(p1, p2) {
	return p2.getRate(CHOKE_RATE_ID).getUploadRate() - p1.getRate(CHOKE_RATE_ID).getUploadRate();
};

var Choker = function(controller) {
	this.controller = controller;

	this._round = 0;
	this._run = null;
};
Choker.prototype.start = function() {
	var self = this;

	this._unchokePeers();

	this._run = setInterval(function() {
		self._round++;
		self._unchokePeers(self._round % 3 === 0);
	}, CHOKE_INTERVAL);
};
Choker.prototype.stop = function() {
	clearInterval(this._run);
	this._round = 0;
	this._run = null;
};
Choker.prototype._unchokePeers = function(optimistic) {
	var controller = this.controller;
	var peers = controller.peers
		.slice().sort(controller.hasCompleted() ? sortByDownloaded : sortByUploaded);

	if(!peers.length) {
		return;
	}

	var uploading = 0;

	if(optimistic) {
		var peer = utils.array.pick(peers);
		peers.splice(peers.indexOf(peer), 1);

		if(peer.isInterested) {
			uploading++;
		}

		peer.uploadQueue.resume();
		peer.getRate(CHOKE_RATE_ID).update();
	}

	peers.forEach(function(peer) {
		if(uploading < controller.uploaderLimit && peer.isInterested) {
			uploading++;
			peer.uploadQueue.resume();
		} else {
			peer.uploadQueue.pause();
		}

		peer.getRate(CHOKE_RATE_ID).update();
	});

	logger.info('Unchoked peers', uploading, 'in round', this._round);
};

var Controller = common.emitter(function(options) {
	utils.arguments.expect(options, 'torrent', 'tracker', 'storage', 'id', 'port');

	this.port = options.port;
	this.id = options.id;

	this.peerLimit = options.peerLimit || DEFAULT_PEER_LIMIT;
	this.uploaderLimit = options.uploaderLimit || DEFAULT_UPLOADER_LIMIT;
	this.downloaderLimit = options.downloaderLimit || DEFAULT_DOWNLOADER_LIMIT;

	var tracker = this.tracker = options.tracker;
	this.torrent = options.torrent;
	this.storage = options.storage;

	this.mode = 'leech';
	this.peers = [];
	
	this._choker = new Choker(this);
	this._pieceDownload = null;
	this._wantedPieces = [];
	this._closed = false;

	this.setPieceDownloadStrategy(new RandomPieceDownloadStrategy());

	var self = this;

	tracker.on('response', function(response) {
		if(self._closed) {
			return;
		}

		var peers = response.peers.slice();

		(function addPeers() {
			if(self.peers.length > self.peerLimit || !peers.length) {
				self._request();
				return;
			}

			self._addPeer(peers.pop());
			setTimeout(addPeers, 100);
		}());
	});
	tracker.on('abort', this._request.bind(this));
});
Controller.prototype.hasCompleted = function() {
	return this.storage.haves.cardinality() === this.torrent.numberOfPieces;
};
Controller.prototype.hasPiece = function(index) {
	return this.storage.hasPiece(index);
};
Controller.prototype.open = function(callback) {
	callback = callback || noop;

	var self = this;
	var storage = this.storage;

	logger.info('Starting torrent', this.torrent.name);

	common.step([
		function(next) {
			storage.open(next);
		},
		function() {
			for(var i = 0; i < self.torrent.numberOfPieces; i++) {
				if(!storage.hasPiece(i)) {
					self._wantedPieces.push(i);
				}
			}

			if(!self._wantedPieces.length) {
				self.mode = 'seed';
			}

			self._choker.start();
			self.tracker.updateLeft(storage.size());
			self._request();

			self._closed = false;

			self.emit('open');
			callback();
		}
	], callback);
};
Controller.prototype.close = function(callback) {
	callback = callback || noop;

	logger.info('Closing torrent', this.torrent.name);

	this._closed = true;
	this._choker.stop();

	var self = this;

	common.step([
		function(next) {
			/*self.peers.forEach(function(peer) {
				peer.close(nullify(next.parallel()));
			});

			self.storage.close(nullify(next.parallel()));
			self.tracker.close(nullify(next.parallel()));*/

			self.peers.concat(self.storage, self.tracker).forEach(function(closable) {
				closable.close(nullify(next.parallel()));
			});
		},
		function(errors) {
			self.mode = 'leech';
			self.peers = [];

			self.emit('close');
			callback(errors.filter(function(err) { return err; })[0]);
		}
	], callback);
};
Controller.prototype.getDownloaded = function() {
	/*return this.peers.reduce(function(acc, peer) {
		return acc + peer.uploaded;
	}, 0);*/

	return this.tracker.downloaded;
};
Controller.prototype.getUploaded = function() {
	/*return this.peers.reduce(function(acc, peer) {
		return acc + peer.downloaded;
	}, 0);*/

	return this.tracker.uploaded;
};
Controller.prototype._addPeer = function(address, callback) {
	callback = callback || noop;

	var self = this;
	var reject = function() {
		return self._hasPeer(address) || self.peers.length > self.peerLimit;
	};

	if(reject()) {
		callback();
		return;
	}

	common.step([
		function(next) {
			peer.initiateHandshake({ 
				address: address, 
				torrent: self.torrent, 
				id: self.id 
			}, next);
		},
		function(peer) {
			if(reject()) {
				peer.close();
				
				callback();
				return;
			}

			peer.on('send', function(message) {
				self.tracker.updateUploaded(message.totalLength);
			});
			peer.on('message', function(message) {
				self.tracker.updateDownloaded(message.totalLength);
			});
			peer.on('message_bitfield', function() {
				if(self._interested(peer)) {
					peer.sendInterested();
				}
			});
			peer.on('message_choke', function() {
				peer.downloadQueue.pause();
			});
			peer.on('message_unchoke', function() {
				if(self._getActiveDownloads() < self.downloaderLimit && !self.hasCompleted()) {
					if(!peer.downloadQueue.length) {
						if(!self._pieceDownload(peer)) {
							return;
						}
					}

					logger.debug(peer.address, 'Resuming download');

					peer.downloadQueue.resume();
				}
			});
			peer.on('message_have', function(message) {
				if(!peer.amInterested && !self.hasPiece(message.index)) {
					peer.sendInterested();
				}
			});
			peer.on('end', function() {
				var index = self.peers.indexOf(peer);
				self.peers.splice(index, 1);

				self._wantedPieces = peer.downloadQueue.pieces.map(function(piece) {
					return piece.index;
				}).concat(self._wantedPieces);

				self._request();
			});

			peer.downloadQueue.on('piece', function(piece) {
				if(self.hasPiece(piece.index)) {
					logger.warn(peer.address, 'Received unwanted piece', piece.index);
					return;
				}

				self.storage.setPiece(piece, function(err) {
					if(err) {
						logger.error(err.stack);

						self.emit('error', err);
						return;
					}

					self.tracker.updateLeft(piece.length);

					self.peers.forEach(function(peer) {
						peer.sendHave(piece.index);

						if(peer.amInterested && !self._interested(peer)) {
							peer.sendNotInterested();
						}
					});

					self.emit('piece', piece);

					if(self.hasCompleted()) {
						logger.info(self.torrent.name, 'Completed file download');

						self.mode = 'seed';

						self.tracker.sendEvent('completed');
						self.emit('complete');
					}
				});
			});
			peer.downloadQueue.on('drain', function() {
				if(!self.hasCompleted()) {
					self._pieceDownload(peer);
				}
			});
			peer.uploadQueue.on('drain', function(index) {
				self.storage.getPiece(index, function(err, piece) {
					if(err) {
						logger.error(err.stack);
						self.emit('error', err);

						return;
					}

					peer.uploadQueue.push(piece);
				});
			});

			if(self.storage.haves.cardinality()) {
				peer.sendBitfield(self.storage.haves);
			}

			self.peers.push(peer);
			self.emit('peer', peer);

			callback();
		}
	], function(err) {
		logger.warn(address, 'Failed to connect to peer:', err.message);
		callback(err);
	});
};
Controller.prototype.setPieceDownloadStrategy = function(strategy) {
	var fn = strategy;
	var self = this;

	if(typeof strategy === 'object') {
		fn = function(peer, controller) {
			return strategy.handlePeer(peer, controller);
		};
	}

	this._pieceDownload = function(peer) {
		var piece = fn.call(self, peer, self);

		if(!piece) {
			logger.warn(peer.address, 'No pieces available for peer');
		} else {
			logger.debug(peer.address, 'Queued piece', piece.index);
		}

		return piece;
	};
};
Controller.prototype._request = function() {
	if(this._closed) {
		return;
	}

	var needs = !this.peers.length || this.peers.length < (this.peerLimit - PEER_THRESHOLD);

	if(needs) {
		this.tracker.request({ numwant: this.peerLimit + PEER_LIMIT_THRESHOLD });
	}
};
Controller.prototype._hasPeer = function(address) {
	return this.peers.some(function(peer) {
		return peer.address.host === address.ip && peer.address.port === address.port;
	});
};
Controller.prototype._getActiveDownloads = function() {
	return this.peers.reduce(function(acc, peer) {
		return acc + !peer.downloadQueue.paused;
	}, 0);
};
Controller.prototype._interested = function(peer) {
	for(var i = 0; i < peer.haves.length; i++) {
		if(peer.haves.get(i) && !this.hasPiece(i)) {
			return true;
		}
	}

	return false;
};

var RandomPieceDownloadStrategy = function() {};
RandomPieceDownloadStrategy.prototype = {
	handlePeer: function(peer, controller) {
		return this._wantedPiece(peer, controller) || this._stalledPiece(peer, controller);
	},
	_wantedPiece: function(peer, controller) {
		var wantedPieces = controller._wantedPieces.filter(function(index) {
			return peer.hasPiece(index);
		});

		var i = Math.floor(Math.random() * wantedPieces.length);
		var index = wantedPieces[i];

		if(index !== undefined) {
			var j = controller._wantedPieces.indexOf(index);
			var piece = controller.storage.getEmptyPiece(index);

			controller._wantedPieces.splice(j, 1);
			peer.downloadQueue.push(piece);

			return piece;
		}

		return null;
	},
	_stalledPiece: function(peer, controller) {
		var stalled;
		var piece;

		peers:
		for(var i = 0; i < controller.peers.length; i++) {
			var other = controller.peers[i];

			if(other.downloadQueue.hasStalled()) {
				for(var j = 0; j < other.downloadQueue.length; j++) {
					var otherPiece = other.downloadQueue.pieces[j];

					if(peer.hasPiece(otherPiece.index)) {
						stalled = other;
						piece = otherPiece;

						break peers;
					}
				}
			}
		}

		if(stalled) {
			var requests = stalled.requests(piece.index);

			stalled.downloadQueue.pause();
			stalled.downloadQueue.remove(piece.index);

			peer.downloadQueue.push(piece, requests);

			return piece;
		}

		return null;
	}
};

/*var SequentialPieceDownloadStrategy = function() {

};
SequentialPieceDownloadStrategy.prototype = Object.create(RandomPieceDownloadStrategy.prototype);
SequentialPieceDownloadStrategy.prototype.PIECE_THRESHOLD = 10;
SequentialPieceDownloadStrategy.prototype.handlePeer = function(peer, controller) {
	var wantedPieces = controller._wantedPieces.filter(function(piece) {
		return peer.hasPiece(piece);
	});

	var minPeerHave = Math.min.apply(null, wantedPieces);
	var minWant = Math.min.apply(null, controller._wantedPieces);
	var minReallyWant;

	var haves = controller.storag.haves;

	for(var i = 0; i < haves.length; i++) {
		if(!haves.get(i) && peer.hasPiece(i)) {
			minReallyWant = i;
			break;
		}
	}
};*/

exports.Controller = Controller;
exports.create = function(torrent, options) {
	options = options || {};

	var port = options.port || utils.array.pick(PORTS);
	var id = options.id || peerid.generate('bL', 1);

	return new Controller(common.join({
		torrent: torrent,
		tracker: new tracker.Manager(torrent, { port: port, id: id }),
		storage: new storage.Storage(torrent, storage.memory),
		id: id,
		port: port
	}, options));
};
