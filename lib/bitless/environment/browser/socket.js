var common = require('common');

var BUFFERED_READ_INTERVAL = 100;

var Socket = common.emitter(function(wsUrl) {
	this._wsUrl = wsUrl;
	this._drain = null;
});
Socket.prototype.connect = function(port, host, connectListener) {
	if(!connectListener && typeof host === 'function') {
		connectListener = host;
		host = null;
	}
	if(connectListener) {
		this.on('connect', connectListener);
	}

	host = host || 'localhost';
	this._address = { address: host, port: port };

	var ws = this._ws = new WebSocket(this._wsUrl);
	var self = this;

	ws.binaryType = 'arraybuffer';
	ws.onopen = function() {
		var message = new Buffer(3 + Buffer.byteLength(host, 'ascii'));

		message.set(0, 0);
		message.writeUInt16BE(port, 1);
		message.write(host, 3, 'ascii');

		self.write(message);
	};
	ws.onmessage = function(e) {
		var data = new Buffer(e.data);

		if(self._timer) {
			self.setTimeout(self._timeout);
		}

		if(data.toString() !== 'open') {
			self.emit('error', new Error('Failed to open connection'));
			ws.close();

			return;
		}

		ws.onmessage = function(e) {
			if(self._timer) {
				self.setTimeout(self._timeout);
			}

			self.emit('data', new Buffer(e.data));
		};

		self.emit('connect');
	};
	ws.onclose = function() {
		self.emit('end');
		self.emit('close');
	};
	ws.onerror = function() {
		self.emit('error', new Error('connection failed'));
		self.end();
	};
};
Socket.prototype.__defineGetter__('bufferSize', function() {
	return this._ws.bufferedAmount;
});
Socket.prototype.address = function() {
	return this._address;
};
Socket.prototype.write = function(data) {
	data = Buffer.isBuffer(data) ? data.bytes() : data;
	this._ws.send(data);

	var buffered = this._ws.bufferedAmount;

	if(buffered && !this._drain) {
		var self = this;

		this._drain = setInterval(function() {
			var buffered = self._ws.bufferedAmount;

			if(!buffered) {
				self._drain = null;	
				clearInterval(self._drain);

				self.emit('drain');
			}
		}, BUFFERED_READ_INTERVAL);
	}

	return !buffered;
};
Socket.prototype.end = function(data) {
	if(data) {
		this.write(data);
	}

	clearTimeout(this._timer);
	clearInterval(this._drain);	

	this._ws.close();
};
Socket.prototype.destroy = function() {
	this.end();
};
Socket.prototype.setTimeout = function(timeout) {
	clearTimeout(this._timer);

	var self = this;
	this._timeout = timeout;
	
	if(!timeout) {
		this._timer = null;

		return;
	}

	this._timer = setTimeout(function() {
		self.emit('timeout');
	}, timeout);
};

exports.create = function(options) {
	var that = {};

	that.connect = function(port, host) {
		var socket = new Socket(options.wsUrl);
		socket.connect(port, host);

		return socket;
	};

	return that;
};
