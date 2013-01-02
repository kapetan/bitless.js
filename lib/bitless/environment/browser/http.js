var http = require('../http');

var parseUrl = function(url) {
	var a = document.createElement('a');
	a.href = url;

	var query = {};
	var protocol = (a.protocol || 'http').replace(/:$/, '');

	(a.search || '').replace(/^\?/, '').split('&').filter(function(pair) {
		return !!pair;
	}).forEach(function(pair) {
		pair = pair.replace(/\+/g, ' ').split('=').map(decodeURIComponent);
		query[pair[0]] = pair[1];
	});

	return new http.URL({
		protocol: protocol,
		host: a.host,
		hostname: a.hostname,
		port: a.port || (protocol === 'http' ? 80 : 443),
		pathname: a.pathname,
		search: a.search,
		query: query
	});
};

var Request = http.Request.extend({
	send: function(callback) {
		callback = callback || function() {};

		var xhr = new XMLHttpRequest();
		var body = this._body;

		if(body && Buffer.isBuffer(body)) {
			body = body.bytes();
		}

		xhr.responseType = 'arraybuffer';

		for(var name in this._headers) {
			xhr.setRequestHeader(name, this._headers[name]);
		}

		xhr.onload = function() {
			if(!/2\d\d/.test(xhr.status)) {
				var err = new Error('Non 2xx response code');
				err.statusCode = xhr.status;

				callback(err);

				return;
			}

			callback(null, new Buffer(xhr.response));
		};
		xhr.onerror = function() {
			callback(new Error('Unable to send request'));
		};

		xhr.open(this._method, this._url.toString());
		xhr.send(body);
	}
});

var MiddlewareRequest = function(method, url) {
	Request.call(this, method, url);

	this._use = [];
};

MiddlewareRequest.prototype = Object.create(Request.prototype);
MiddlewareRequest.prototype.send = function(callback) {
	for(var i = 0; i < this._use.length; i++) {
		var fn = this._use[i];

		if(fn(this) === false) {
			return;
		}
	}

	return Request.prototype.send.call(this, callback);
};
MiddlewareRequest.prototype.use = function(fn) {
	this._use = this._use.concat(fn);
};

exports.parseUrl = http.URL.parse = parseUrl;
exports.request = function(method, url) {
	return new Request(method, url);
};

http.METHODS.forEach(function(method) {
	exports[method] = function(url) {
		return exports.request(method, url);
	};
});

exports.use = function(fn) {
	var that = {};

	that.parseUrl = parseUrl;
	that.request = function(method, url) {
		var request = new MiddlewareRequest(method, url);

		request.use(fn);

		return request;
	};

	http.METHODS.forEach(function(method) {
		that[method] = function(url) {
			return that.request(method, url);
		};
	});

	that.use = function(f) {
		return exports.use([].concat(fn).concat(f));
	};

	return that;
};
