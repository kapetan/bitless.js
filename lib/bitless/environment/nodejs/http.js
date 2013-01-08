var request = require('../http');
var url = require('url');
var http = require('http');

var noop = function() {};

/*var parseUrl = function(href) {
	href = url.parse(href, true);
	var protocol = (href.protocol || 'http').replace(/:$/, '');

	return new request.URL({
		protocol: protocol,
		host: href.host,
		hostname: href.hostname,
		port: href.port || (protocol === 'http' ? 80 : 443),
		pathname: href.pathname,
		search: href.search,
		query: href.query
	});
};*/

var Request = request.Request.extend({
	send: function(callback) {
		callback = callback || noop;

		var redirects = 5;

		var body = this._body;
		var method = this._method;
		var url = this._url;
		var headers = this._headers;

		(function fetch() {
			if(!redirects) {
				callback(new Error('Too many redirects'));
				return;
			}

			var req = http.request({
				method: method,
				hostname: url.hostname,
				port: url.port,
				path: url.pathToString(),
				headers: headers
			}, function(res) {
				if(/3\d\d/.test(res.statusCode)) {
					var location = res.headers.location;

					if(location) {
						location = http.URL.parse(location);
						//location = parseUrl(location);

						url = { 
							port: location.port,
							hostname: location.hostname, 
							pathToString: function() { return location.pathname + location.search; } 
						};
						method = (/30[1-3]/.test(res.statusCode) ? 'GET' : method).toUpperCase();
						body = /GET|HEAD|DELETE/.test(method) ? null : body;

						if(!body) {
							delete headers['content-length'];
							delete headers['content-type'];
						}

						redirects--;

						fetch();

						return;
					}
				}

				var buffer = [];
				var length = 0;

				res.on('data', function(data) {
					buffer.push(data);
					length += data.length;
				});
				res.on('end', function() {
					callback(null, Buffer.concat(buffer, length));
				});
			});

			req.on('error', function(err) {
				callback(err);
			});

			req.end(body);
		}());
	}
});

exports.parseUrl = request.URL.parse;
//exports.parseUrl = request.URL.parse = parseUrl;
exports.request = function(method, url) {
	return new Request(method, url);
};

request.METHODS.forEach(function(method) {
	exports[method] = function(url) {
		return exports.request(method, url);
	};
});
