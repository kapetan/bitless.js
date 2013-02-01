var common = require('common');
var controller = require('./controller');
var torrent = require('./torrent');
var peerid = require('./peer-id');

// Bitless.js
var CLIENT_ID = 'bL';
var CLIENT_VERSION = require('../../package.json').version;
var CLIENT_ID_ENCODING = peerid.clients.Azureus.encodingName;

var nullify = function(fn) {
	return function(err) {
		fn(null, err);
	};
};

var Client = function(options) {
	options = options || {};

	this.torrents = [];
	this.server = null;
	this.id = options.id || peerid.generate(CLIENT_ID, CLIENT_VERSION, CLIENT_ID_ENCODING);
};
Client.prototype.open = function(callback) {
	var self = this;

	self.server = new controller.Server();
	self.server.listen(callback);
};
Client.prototype.close = function(callback) {
	var self = this;

	common.step([
		function(next) {
			self.torrents.forEach(function(torrent) {
				torrent.close(nullify(next.parallel()));
			});
		},
		function(errors) {
			callback(errors.filter(function(err) { return err; })[0]);
		}
	], callback);
};
Client.prototype.addTorrent = function(meta, options) {
	if(typeof meta === 'string' || Buffer.isBuffer(meta)) {
		meta = new torrent.Torrent(meta);
	}

	var manager = controller.create(meta, this.server, common.join({ id: this.id }, options));
	this.torrents.push(manager);

	return manager;
};

exports.Client = Client;
