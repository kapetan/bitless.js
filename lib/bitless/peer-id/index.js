var utils = require('../utils');

var UNKNOWN = 'Unknown';
var PEER_ID_LENGTH = 20;
var SHADOW_BASE64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.-';

var truncate = function(arr) {
	for(var i = arr.length - 1; i >= 0; i--) {
		if(arr[i]) {
			return arr.slice(0, i + 1);
		}
	}

	return arr.slice(0, 1);
};

var Client = function(name, id, version, rest) {
	this.name = name || (UNKNOWN + ' (' + id + ')');
	this.id = id;
	this.version = truncate(version);
	this.rest = rest;
};
Client.prototype.toString = function(encoding) {
	if(encoding) {
		return this.pack().toString(encoding);
	}

	return this.name + ' (' + this.version.join('.') + ')';
};
Client.prototype.equals = function(obj) {
	return this.name === obj.name && this.id === obj.id &&
		utils.array.equals(this.version, obj.version) && 
		utils.buffer.equals(this.rest, obj.rest);
};

var Unknown = function(name, id, version, rest) {
	this.name = UNKNOWN;
	this.id = UNKNOWN;
	this.version = [0];
	this.rest = rest;
};
Unknown.encodingName = UNKNOWN;
Unknown.parse = function(peerId) {
	return new Unknown(null, null, null, peerId);
};
Unknown.is = function() {
	return true;
};
Unknown.prototype.encodingName = Unknown.encodingName;
Unknown.prototype.pack = function() {
	return this.rest;
};
Unknown.prototype.equals = function(obj) {
	return utils.buffer.equals(this.rest, obj.rest);
};
Unknown.prototype.toString = function() {
	return this.name;
};

var Azureus = function() {
	Client.apply(this, arguments);

	this.rest = this.rest || utils.buffer.random(12);
};
Azureus.encodingName = 'Azureus';
Azureus.IDS = require('./azureus.json');
Azureus.parse = function(peerId) {
	var id = peerId.toString('ascii', 1, 3);
	var name = Azureus.IDS[id];
	var version = peerId.toString('ascii', 3, 7).split('').map(function(i) {
		return parseInt(i, 10);
	});

	return new Azureus(name, id, version, peerId.slice(8));
};
Azureus.is = function(peerId) {
	var head = peerId.toString('ascii', 0, 8);
	return /^-([a-zA-Z]{2})(\d{4})-$/.test(head);
};
Azureus.prototype = Object.create(Client.prototype);
Azureus.prototype.encodingName = Azureus.encodingName;
Azureus.prototype.pack = function() {
	var peerId = new Buffer(PEER_ID_LENGTH);
	var version = [];

	for(var i = 0; i < 4; i++) {
		version[i] = this.version[i] || 0;
	}

	var head = '-' + this.id + version.join('') + '-';

	peerId.write(head, 'ascii');
	this.rest.copy(peerId, head.length, 0, this.rest.length);

	return peerId;
};

var Shadow = function() {
	Client.apply(this, arguments);

	if(!this.rest) {
		var peerId = '---';

		for(var i = 0; i < 11; i++) {
			peerId += SHADOW_BASE64.charAt(Math.floor(Math.random() * SHADOW_BASE64.length));
		}

		this.rest = new Buffer(peerId, 'ascii');
	}
};
Shadow.encodingName = 'Shadow';
Shadow.IDS = require('./shadow.json');
Shadow.parse = function(peerId) {
	var id = peerId.toString('ascii', 0, 1);
	var name = Shadow.IDS[id];
	var version = peerId.toString('ascii', 1, 6).replace(/-+$/, '').split('').map(function(i) {
		return SHADOW_BASE64.indexOf(i);
	});

	return new Shadow(name, id, version, peerId.slice(6));
};
Shadow.is = function(peerId) {
	for(var i = 0; i < peerId.length; i++) {
		var c = String.fromCharCode(peerId.get(0));

		if(SHADOW_BASE64.indexOf(c) < 0) {
			return false;
		}
	}

	var head = peerId.toString('ascii', 0, 6).replace(/-+$/, '');

	return /^[a-zA-Z](\d|[a-zA-Z0-9]|\.|-)+$/.test(head);
};
Shadow.prototype = Object.create(Client.prototype);
Shadow.prototype.encodingName = Shadow.encodingName;
Shadow.prototype.pack = function() {
	var peerId = new Buffer(PEER_ID_LENGTH);
	var head = this.id + this.version.map(function(i) {
		return SHADOW_BASE64.charAt(i);
	}).join('');

	for(var i = 0; i < (7 - head.length); i++) {
		head += '-';
	}

	peerId.write(head, 'ascii');
	this.rest.copy(peerId, head.length, 0, this.rest.length);

	return peerId;
};

var Mainline = function() {
	Client.apply(this, arguments);

	if(!this.rest) {
		var versionLength = this.version.reduce(function(acc, i) {
			return acc + i.toString().length;
		}, 0);

		this.rest = utils.buffer.random(versionLength + 3);
		this.rest.write('--', 'ascii');
	}
};
Mainline.encodingName = 'Mainline';
Mainline.IDS = require('./mainline.json');
Mainline.parse = function(peerId) {
	var id = peerId.toString('ascii', 0, 1);
	var name = Mainline.IDS[id];
	var version = [];

	var versionString = peerId.toString('ascii', 1);
	var re = /(\d{1,3})-/g;

	for(var i = 0; i < 3; i++) {
		var match = re.exec(versionString);
		version.push(parseInt(match[1], 10));
	}

	return new Mainline(name, id, version, peerId.slice(match.index + match[0].length));
};
Mainline.is = function(peerId) {
	var head = peerId.toString('ascii');
	return /^[a-zA-Z](\d{1,3}-){3}/.test(head);
};
Mainline.prototype = Object.create(Client.prototype);
Mainline.prototype.encodingName = Mainline.encodingName;
Mainline.prototype.pack = function() {
	var peerId = new Buffer(PEER_ID_LENGTH);
	var head = this.id + this.version.join('-');

	peerId.write(head, 'ascii');
	this.rest.copy(peerId, head.length, 0, this.rest.length);

	return peerId;
};

exports.clients = {};
exports.clients[Azureus.encodingName] = Azureus;
exports.clients[Shadow.encodingName] = Shadow;
exports.clients[Mainline.encodingName] = Mainline;

exports.parse = function(peerId) {
	var clients = Object.keys(exports.clients);

	for(var i = 0; i < clients.length; i++) {
		var client = exports.clients[clients[i]];

		if(client.is(peerId)) {
			return client.parse(peerId);
		}
	}

	return Unknown.parse(peerId);
};
exports.generate = function(id, version, encoding) {
	var client = exports.clients[encoding || Azureus.encodingName];

	if(typeof version === 'number') {
		version = version.toFixed(2).replace(/0+$/, '');
	}
	if(typeof version === 'string') {
		version = version.split('.').slice(0, 4).filter(function(i) {
			return i;
		}).map(function(i) {
			return parseInt(i, 10);
		});
	}

	return new client((client.IDS && client.IDS[id]) || id, id, version);
};
