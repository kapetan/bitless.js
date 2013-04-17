var environment = require('./lib/bitless/environment');
var torrent = require('./lib/bitless/torrent');
var controller = require('./lib/bitless/controller');
var storage = require('./lib/bitless/storage');
var fs = require('fs');

/*
fs.readFile('./downloads/trusted-computing-local.torrent', function(err, data) {
	if(err) {
		console.error(err.stack);
		return;
	}

	if(process.argv[2] === 'read') {
		var content = fs.readFileSync('./downloads/trusted-computing/TrustedComputing_LAFKON_HIGH.mov');
		storage.memory.open('./downloads/trusted-computing/TrustedComputing_LAFKON_HIGH.mov', '', function(_, f) {
			f.length(content.length);
			f.write(content);
		});
	}

	var t = new torrent.Torrent(data);

	controller.open(t, function(err, manager) {
		// ...
	});
});
*/

fs.readFile('./downloads/trusted-computing.torrent', function(err, data) {
	var t = new torrent.Torrent(data);
	var tracker = require('./lib/bitless/tracker');
	var peerid = require('./lib/bitless/peer-id');

	var http = new tracker.HttpClient(t, { id: peerid.generate(), port: 6881, announce: t.announce });

	http.on('response', function(response) {
		console.log(response);
	});
	http.request({ numwant: 10 });
});
