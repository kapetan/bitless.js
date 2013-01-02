var bitfield =  require('./bitfield');
var peerid = require('./peer-id');
var utils = require('./utils');

var messages = {
	handshake: { id: -2, length: 49 },
	keepAlive: { id: -1, length: 0 },
	choke: { id: 0, length: 1 },
	unchoke: { id: 1, length : 1 },
	interested: { id: 2, length: 1 },
	notInterested: { id: 3, length: 1 },
	have: { id: 4, length: 5 },
	bitfield: { id: 5, length: 1 },
	request: { id: 6, length: 13 },
	piece: { id: 7, length: 9 },
	cancel: { id: 8, length: 13 }
};

var PSTR = new Buffer('BitTorrent protocol');
var RESERVED_HANDSHAKE = new Buffer(8);

RESERVED_HANDSHAKE.fill(0);

var assert = function(cond, msg) {
	if(!cond) {
		throw new Error(msg);
	}
};
var assertLength = function(buffer, expected) {
	assert(buffer.length === expected, 'Message did not match expected length');
};

var Message = function(length) {
	this.length = length === undefined ? messages[this.name].length : length;
	this.totalLength = 4 + this.length;
};
Message.extend = function(proto) {
	var Klass = function() {
		this._super = Message.bind(this);
		
		if(typeof proto.initialize === 'function') {
			proto.initialize.apply(this, arguments);
		} else {
			this._super();
		}

		delete this._super;
	};

	var id = messages[proto.name].id;

	Klass.prototype = Object.create(Message.prototype);
	
	Klass.prototype.id = id;
	Klass.ID = id;
	Klass.NAME = proto.name;

	for(var name in proto) {
		Klass.prototype[name] = proto[name];
	}

	return Klass;
};
Message.prototype.equals = function(obj) {
	return this.id === obj.id && this.length === obj.length;
};

var eql = Message.prototype.equals;

var Handshake = Message.extend({
	name: 'handshake',
	initialize: function(infoHash, peerId, reserved, pstr) {
		this.infoHash = infoHash;
		this.peerId = peerId;
		this.reserved = reserved || RESERVED_HANDSHAKE;
		this.pstr = pstr || PSTR;

		this._super(messages.handshake.length + this.pstr.length);

		this.totalLength = this.length;
	},
	pack: function() {
		var pstrLength = new Buffer(1);
		pstrLength.set(0, this.pstr.length);

		return Buffer.concat([pstrLength, this.pstr, this.reserved, this.infoHash, this.peerId.pack()]);
	},
	equals: function(obj) {
		return eql.call(this, obj) && utils.buffer.equals(this.infoHash, obj.infoHash) &&
			this.peerId.equals(obj.peerId) && utils.buffer.equals(this.reserved, obj.reserved) &&
			utils.buffer.equals(this.pstr, obj.pstr);
	}
});
Handshake.unpackPstrLength = function(pstrlen) {
	return pstrlen.get(0);
};
Handshake.unpack = function(pstrlen, msg) {
	assertLength(msg, Handshake.byteLength(pstrlen));

	var len = pstrlen + RESERVED_HANDSHAKE.length;

	var pstr = msg.slice(0, pstrlen);
	var reserved = msg.slice(pstrlen, len);
	var infoHash = msg.slice(len, len + 20);
	var peerId = peerid.parse(msg.slice(len + 20, len + 40));

	assert(utils.buffer.equals(pstr, PSTR), 'Pstr did not match expected value');

	return new Handshake(infoHash, peerId, reserved, pstr);
};
Handshake.byteLength = function(pstrlen) {
	return messages.handshake.length + pstrlen - 1;
};

var KeepAlive = Message.extend({
	name: 'keepAlive',
	pack: function() {
		var payload = new Buffer(4);
		payload.writeUInt32BE(0, 0);

		return payload;
	}
});
KeepAlive.unpack = function(msg) {
	if(msg) {
		assertLength(msg, messages.keepAlive.length);
	}

	return new KeepAlive();
};

var Choke = Message.extend({
	name: 'choke',
	pack: function() {
		var payload = new Buffer(4 + this.length);

		payload.writeUInt32BE(this.length, 0);
		payload.writeUInt8(this.id, 4);

		return payload;
	}
});
Choke.unpack = function(msg) {
	assertLength(msg, messages.choke.length);
	return new Choke();
};

var Unchoke = Message.extend({
	name: 'unchoke',
	pack: Choke.prototype.pack
});
Unchoke.unpack = function(msg) {
	assertLength(msg, messages.unchoke.length);
	return new Unchoke();
};

var Interested = Message.extend({
	name: 'interested',
	pack: Choke.prototype.pack
});
Interested.unpack = function(msg) {
	assertLength(msg, messages.interested.length);
	return new Interested();
};

var NotInterested = Message.extend({
	name: 'notInterested',
	pack: Choke.prototype.pack
});
NotInterested.unpack = function(msg) {
	assertLength(msg, messages.notInterested.length);
	return new NotInterested();
};

var Have = Message.extend({
	name: 'have',
	initialize: function(piece) {
		this.piece = piece;
		this._super();
	},
	pack: function() {
		var	payload = new Buffer(4 + this.length);

		payload.writeUInt32BE(this.length, 0);
		payload.writeUInt8(this.id, 4);
		payload.writeUInt32BE(this.piece, 5);

		return payload;
	},
	equals: function(obj) {
		eql.call(this, obj) && this.piece === obj.piece;
	}
});
Have.unpack = function(msg) {
	assertLength(msg, messages.have.length);

	var piece = msg.readUInt32BE(1);

	return new Have(piece);
};

var Bitfield = Message.extend({
	name: 'bitfield',
	initialize: function(bitfield) {
		this.bitfield = bitfield;
		this._super(messages.bitfield.length + bitfield.bytelength);
	},
	pack: function() {
		var bitfield = this.bitfield.pack();
		var payload = new Buffer(4 + this.length);

		payload.writeUInt32BE(this.length, 0);
		payload.writeUInt8(this.id, 4);
		bitfield.copy(payload, 5, 0, bitfield.length);

		return payload;
	},
	equals: function(obj) {
		return eql.call(this, obj) && this.bitfield.equals(obj.bitfield);
	}
});
Bitfield.unpack = function(msg, numberOfPieces) {
	var expected = Math.ceil(numberOfPieces / 8);
	assertLength(msg, messages.bitfield.length + expected);

	var bytes = msg.slice(1);
	var field = new bitfield.unpack(bytes, numberOfPieces);

	return new Bitfield(field);
};

var Request = Message.extend({
	name: 'request',
	initialize: function(index, offset, pieceLength) {
		this.index = index;
		this.offset = offset;
		this.pieceLength = pieceLength;

		this._super();
	},
	pack: function() {
		var payload = new Buffer(4 + this.length);

		payload.writeUInt32BE(this.length, 0);
		payload.writeUInt8(this.id, 4);
		payload.writeUInt32BE(this.index, 5);
		payload.writeUInt32BE(this.offset, 9);
		payload.writeUInt32BE(this.pieceLength, 13);

		return payload;
	},
	equals: function(obj) {
		return eql.call(this, obj) && this.index === obj.index &&
			this.offset === obj.offset && this.pieceLength === obj.pieceLength;
	},
	is: function(obj) {
		var length = this.pieceLength || this.block.length;
		var otherLength = this.pieceLength || this.block.length;

		return this.index === obj.index && this.offset === obj.offset &&
			length === otherLength;
	}
});
Request.unpack = function(msg) {
	assertLength(msg, messages.request.length);

	var index = msg.readUInt32BE(1);
	var offset = msg.readUInt32BE(5);
	var pieceLength = msg.readUInt32BE(9);

	return new Request(index, offset, pieceLength);
};

var Cancel = Message.extend({
	name: 'cancel',
	initialize: Request.prototype.initialize,
	pack: Request.prototype.pack,
	equals: Request.prototype.equals,
	is: Request.prototype.is
});
Cancel.unpack = function(msg) {
	assertLength(msg, messages.cancel.length);

	var index = msg.readUInt32BE(1);
	var offset = msg.readUInt32BE(5);
	var pieceLength = msg.readUInt32BE(9);

	return new Cancel(index, offset, pieceLength);
};

var Piece = Message.extend({
	name: 'piece',
	initialize: function(index, offset, block) {
		this.index = index;
		this.offset = offset;
		this.block = block;

		this._super(messages.piece.length + block.length);
	},
	pack: function() {
		var payload = new Buffer(4 + this.length);

		payload.writeUInt32BE(this.length, 0);
		payload.writeUInt8(this.id, 4);
		payload.writeUInt32BE(this.index, 5);
		payload.writeUInt32BE(this.offset, 9);

		this.block.copy(payload, 13, 0, this.block.length);

		return payload;
	},
	equals: function(obj) {
		return eql.call(this, obj) && this.index === obj.index &&
			this.offset === obj.offset && this.block.length === obj.block.length;
	},
	is: Request.prototype.is
});
Piece.unpack = function(msg) {
	if(msg.length < messages.piece.length) {
		assertLength(msg, -1);
	}

	var index = msg.readUInt32BE(1);
	var offset = msg.readUInt32BE(5);
	var block = msg.slice(9);

	return new Piece(index, offset, block);
};

exports.Handshake = Handshake;
exports.KeepAlive = KeepAlive;
exports.Choke = Choke;
exports.Unchoke = Unchoke;
exports.Interested = Interested;
exports.NotInterested = NotInterested;
exports.Have = Have;
exports.Bitfield = Bitfield;
exports.Request = Request;
exports.Cancel = Cancel;
exports.Piece = Piece;

exports.unpackMessageLength = function(len) {
	assertLength(len, 4);
	return len.readUInt32BE(0);
};
