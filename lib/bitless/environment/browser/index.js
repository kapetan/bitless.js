module.exports = function(exports, config) {
	var socket = require('./socket');
	var http = require('./http');

	exports.Buffer = require('./buffer').Buffer;
	exports.sha1 = require('./sha1/index');
	exports.socket = socket.create({ wsUrl: 'ws://' + window.location.host });
	exports.http = http.use(function(request) {
		var proxy = http.parseUrl('/proxy');

		proxy.query.url = request._url.toString();
		request._url = proxy;
	});
};
