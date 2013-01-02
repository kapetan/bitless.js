var METHODS = ['get', 'post', 'put', 'delete', 'head'];

var urlEncodeBuffer = function(buffer) {
	var encoded = [];

	for(var i = 0; i < buffer.length; i++) {
		var hex = buffer.get(i).toString(16);

		encoded.push('%');
		if(hex.length < 2) {
			encoded.push('0')
		}

		encoded.push(hex);
	}

	return encoded.join('').toUpperCase();
};

var join = function(obj, options, value) {
	if(value) {
		var name = options;
		
		options = {};
		options[name] = value;
	}

	for(var name in options) {
		if(options.hasOwnProperty(name)) {
			obj[name] = options[name];
		}
	}

	return obj;
};

var URL = function(options) {
	join(this, options);
};
URL.prototype.queryToString = function() {
	var query = [];

	for(var name in this.query) {
		var value = this.query[name];

		value = Buffer.isBuffer(value) ? urlEncodeBuffer(value) : encodeURIComponent(value);

		var p = encodeURIComponent(name) + '=' + value;
		query.push(p);
	}

	return query.join('&');
};
URL.prototype.pathToString = function() {
	var query = this.queryToString();

	if(query.length) {
		query = '?' + query;
	}

	return this.pathname + query;
};
URL.prototype.toString = function() {
	return this.protocol + '://' + this.host + this.pathToString();
};

var Request = function(method, url) {
	this._method = method.toUpperCase();
	this._headers = {};
	this._body = null;

	if(typeof url === 'object') {
		this._url = Object.create(url);
		this._url.query = join({}, url.query);
	} else {
		this._url = URL.parse(url);
	}
};
Request.extend = function(proto) {
	var Klass = function() {
		Request.apply(this, arguments);
	};

	Klass.prototype = Object.create(Request.prototype);
	join(Klass.prototype, proto || {});

	return Klass;
};
Request.prototype.query = function(query, value) {
	join(this._url.query, query, value);
	return this;
};
Request.prototype.headers = function(header, value) {
	join(this._headers, header, value);
	return this;
};
Request.prototype.body = function(body) {
	this._body = body;
	return this;
};

exports.METHODS = METHODS;
exports.URL = URL;
exports.Request = Request;
