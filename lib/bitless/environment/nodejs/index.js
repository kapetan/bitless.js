module.exports = function(exports, config) {
	var crypto = require('crypto');

	var createSha1 = function(str) {
		var hash = crypto.createHash('sha1');

		if(str) {
			hash.update(str);
		}

		return hash;
	};

	exports.Buffer = require('buffer').Buffer;
	exports.sha1 = { create: createSha1 };
	exports.socket = require('net');
	exports.http = require('./http');

	/*var formatter = exports.logger.getFormatter();

	exports.logger.setFormatter(function(severity, datetime, progname, args) {
		args = args.map(function(obj) {
			if(Buffer.isBuffer(obj)) {
				obj = { Buffer: obj.length };
			}

			return typeof obj === 'string' ? obj : JSON.stringify(obj);
		});

		return formatter(severity, datetime, progname, args);
	});*/
};
