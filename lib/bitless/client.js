var common = require('common');
var controller = require('./controller');
var torrent = require('./torrent');

var nullify = function(fn) {
	return function(err) {
		fn(null, err);
	};
};

var Client = function(options) {
	this.torrents = [];
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
	if(meta instanceof String || Buffer.isBuffer(meta)) {
		meta = new torrent.Torrent(meta);
	}

	var manger = controller.create(meta, options);
	this.torrents.push(manager);

	return manager;
};

exports.Client = Client;
