var bencode = require('dht-bencode');
var utils = require('./utils');
var sha1 = require('./environment').sha1;

// TODO Check if torrent is valid

var noop = function() {};

var Torrent = function(content) {
	var torrent = bencode.bdecode(content);

	this.announce = torrent['announce'].toString('utf8');

	var announceList = torrent['announce-list'];
	if(announceList) {
		this.announceList = [];

		for(var i = 0; i < announceList.length; i++) {
			var tire = announceList[i];

			this.announceList.push(tire.map(function(t) {
				return t.toString('utf8');
			}));
		}
	}

	var info = torrent['info'];
	var bencodedInfo = bencode.bencode(info);

	this.infoHash = new Buffer(sha1.create(bencodedInfo).digest('binary'), 'binary');
	this.hexInfoHash = this.infoHash.toString('hex');

	this.pieceLength = info['piece length'];

	var pieces = info['pieces'];
	this.pieces = [];

	var current = 0;
	var length = pieces.length;

	while(current < length) {
		var hash = pieces.slice(current, current + 20);

		this.pieces.push(hash.toString('base64'));
		current += 20;
	}

	this.name = info['name'].toString('utf8');

	if(info['files']) {
		this.fileMode = 'multi';
		this.files = info['files'];

		this.length = 0;
		for(var i = 0; i < this.files.length; i++) {
			var files = this.files[i];
			
			this.length += files['length'];
			files['path'] = files['path'].map(function(p) { 
				return p.toString('utf8');
			});
		}
	}
	else {
		this.fileMode = 'single';
		this.length = info['length'];
	}

	this.numberOfPieces = this.pieces.length;

	this.isSingleFileMode = (this.fileMode === 'single');
	this.isMultiFileMode = !this.isSingleFileMode;

	this.numberOfFiles = this.isSingleFileMode ? 1 : this.files.length;
};

Torrent.prototype.filePath = function(fileIndex) {
	utils.array.indexInBounds(fileIndex, this.numberOfFiles);

	if(this.isSigleFileMode) {
		return this.name;
	}
	else {
		return this.files[fileIndex]['path'].slice();
	}
};
Torrent.prototype.fileSize = function(fileIndex) {
	utils.array.indexInBounds(fileIndex, this.numberOfFiles);

	if(this.isSingleFileMode) {
		return this.length;
	}
	else {
		return this.files[fileIndex]['length']
	}
};
Torrent.prototype.pieceHash = function(pieceIndex) {
	utils.array.indexInBounds(pieceIndex, this.numberOfPieces);
	return this.pieces[pieceIndex];
};
Torrent.prototype.pieceSize = function(pieceIndex) {
	utils.array.indexInBounds(pieceIndex, this.numberOfPieces);

	if(pieceIndex === this.numberOfPieces - 1) {
		return this.length - this.pieceLength * pieceIndex;
	}
	else {
		return this.pieceLength;
	}
};

exports.Torrent = Torrent;
