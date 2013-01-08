var root = require('root');
var response_require = require('response.require');
var filed = require('filed');
var path = require('path');
var bitless = require('../lib/bitless');

process.chdir(__dirname);

var app = root();
var client = bitless.create();

var toJSON = function() {
	return client.torrents.map(function(manager) {
		return {
			mode: manager.mode,
			haves: manager.storage.haves._field,
			downloaded: manager.getDownloaded(),
			uploaded: manager.getUploaded(),
			peers: manager.peers.map(function(peer) {
				return {
					downloaded: peer.downloaded,
					uploaded: peer.uploaded,
					address: peer.address,
					id: peer.id.toString(),
					isInterested: peer.isInterested,
					amInterested: peer.amInterested,
					isChoking: peer.isChoking,
					amChoking: peer.amChoking
				};
			})
		};
	});
};

app.use(response_require);

app.get('/.json', function(request, response) {
	response.send(toJSON());
});
app.put('/', function(request, response) {
	var buffer = '';

	request.on('data', function(data) {
		buffer += data.toString('binary');
	});
	request.on('end', function() {
		try {
			client.addTorrent(new Buffer(buffer, 'binary'));
			response.send(toJSON());
		} catch(err) {
			response.error(400, err);
		}
	});
});

app.get('/require', response_require.script);
app.get('/js/*', function(request, response) {
	respons.require(path.join('assets', 'js', request.params.glob));
});
app.get('/*', function(request, response) {
	filed(path.join('public', request.params.glob)).pipe(response);
});

app.listen(3000);
