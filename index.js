var environment = require('./lib/bitless/environment');
var torrent = require('./lib/bitless/torrent');
var controller = require('./lib/bitless/controller');
var storage = require('./lib/bitless/storage');
var fs = require('fs');

fs.readFile('./downloads/trusted-computing-local.torrent', function(err, data) {
	if(err) {
		console.error(err.stack);
		return;
	}

	var content = fs.readFileSync('./downloads/trusted-computing/TrustedComputing_LAFKON_HIGH.mov');
	storage.memory.open('./downloads/trusted-computing/TrustedComputing_LAFKON_HIGH.mov', '', function(_, f) {
		f.length(content.length);
		f.write(content);
	});

	var t = new torrent.Torrent(data);
	var manager = new controller.create(t);

	/*manager.on('peer', function(peer) {
		peer.once('message_interested', function() {
			console.log('----------------------------------------------');
			peer.uploadQueue.resume();
		});
	});*/

	/*manager.on('complete', function() {
		manager.close(function() {
			process.exit();
		});
	});*/

	manager.open();
});