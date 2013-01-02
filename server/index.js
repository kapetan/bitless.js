var root = require('root');
var filed = require('filed');
var request = require('request');
var WebSocket = require('faye-websocket');
var rex = require('rex');
var cat = require('cat');
var net = require('net');
var fs = require('fs');
var path = require('path');
var Stream = require('stream');

var PORT = 3000;
var ECHO_PORT = 3001;

var rexParse = rex({ minify: false, eval: false });

var socketPool = {};
var log = function() {
	var args = Array.prototype.slice.call(arguments);
	var datetime = (new Date()).toUTCString();

	args.splice(0, 0, '[' + datetime + '] -- :');

	console.log.apply(console, args);
};
var address = function(s) {
	var addr = s.address();

	return {
		host: addr.address,
		port: addr.port
	};
};
var generateid = (function() {
	var current = 0;

	return function() {
		return current++;
	};
}());

var StreamingWebSocket = function(ws) {
	this.readable = true;
	this.writable = true;

	this.id = { id: generateid() };

	this._ws = ws;

	var self = this;

	ws.addEventListener('message', function(e) {
		var data = e.data;

		if(!Buffer.isBuffer(data)) {
			data = new Buffer(data, 'binary');
		}

		//log(self.id, 'Message received from WebSocket client, length', data.length);

		self.emit('data', data);
	});
	ws.addEventListener('close', function() {
		self.emit('end');
	});
	ws.addEventListener('open', function() {
		self.emit('open');
	});
};
StreamingWebSocket.prototype.__proto__ = Stream.prototype;
StreamingWebSocket.prototype.write = function(data) {
	if(!Buffer.isBuffer(data)) {
		data = new Buffer(data, 'utf-8');
	}

	//log('Sending to WebSocket', data.length);

	this._ws.send(data);
};
StreamingWebSocket.prototype.end = function(data) {
	if(!this.writable) {
		return;
	}
	if(data) {
		this.write(data);
	}

	this.readable = false;
	this.writable = false;

	this._ws.close();
};
StreamingWebSocket.prototype.destroy = function() {
	this.end();
};

var app = root();

app.on('route', function(req, res) {
	res.on('finish', function() {
		log(res.statusCode, req.method, req.url);
	});
});
app.on('upgrade', function(request, socket, head) {
	var ws = new StreamingWebSocket(new WebSocket(request, socket, head));

	ws.on('open', function() {
		log(ws.id, 'New WebSocket connection established');
	});
	ws.on('end', function() {
		log(ws.id, 'WebSocket connection closed');
	});

	ws.once('data', function(data) {
		var id = data.get(0);

		switch(id) {
		case 0:
			var port = data.readUInt16BE(1);
			var host = data.toString('ascii', 3);

			log('Opening connection to', host, port);

			var socket = net.connect(port, host);

			socket.pipe(ws).pipe(socket);
			socket.on('error', function() {
				ws.end();
			});
			socket.once('connect', function() {
				ws.write('open');
			});

			break;
		case 1:
			var port = data.readUInt16BE(1);

			log('Starting server on port', port);

			net.createServer(function(socket) {
				var socketId = generateid();
				var encodedId = new Buffer(4);
				socketPool[socketId] = socket;

				log(ws.id, 'Received incoming connection, socket_id', socketId);

				encodedId.writeUInt32BE(socketId, 0);

				ws.write(encodedId);
			}).on('error', function() {
				ws.end();
			}).listen(port, function() {
				ws.write('open');
			});

			break;
		case 2:
			var socketId = data.readUInt32BE(0);
			var socket = socketPool[socketId];

			log('Connecting to socket pool, socket_id', socketId);

			delete socketPool[socketId];

			if(!socket) {
				ws.end();
				return;
			}

			socket.pipe(ws).pipe(socket);
			socket.on('error', function() {
				ws.end();
			});

			ws.write('open');

			break;
		default:
			log('Received message with unknown id', id);
			ws.end();
		}
	});
});

app.get('/rex', function(req, res) {
	var url = req.query.url;

	res.setHeader('Content-Type', 'text/javascript');

	if(!url) {
		res.end('document.write("<script src=\'http://' + req.headers.host +
			'/rex?url="+encodeURIComponent(""+location)+"\'></script>");');
		return;
	}

	url = decodeURIComponent(url).replace('~', process.env.HOME).replace(/^file:\/\/\/C:\//, '/');

	cat(url, function(err, str) {
		if (err) return res.end(err.stack);

		var src = (str.match(/<script[^>]+src=[^>]+>((?:\s|\S)+)<\/script>/i) || [])[1];

		rexParse(new Function(src), function(err, js) {
			if (err) return res.end(err.stack);
			res.end(js);
		});
	});
});
app.all('/proxy', function(req, res, error) {
	var url = req.query.url;

	if(!url) {
		res.error(400, 'Missing url');
		return;
	}

	req.pipe(request(url).on('error', error)).pipe(res);
});
app.get('/*', function(req, res) {
	filed(req.params.glob).pipe(res);
});

app.listen(3000, function() {
	log('Server started on port', PORT);
});

net.createServer(function(socket) {
	var addr = address(socket);

	log(addr, 'Peer connected to echo server');

	socket.pipe(socket);
	socket.on('end', function() {
		log(addr, 'Peer disconnected from echo server');
	});
}).listen(3001, function() {
	log('Echo server started on port', ECHO_PORT);
});
