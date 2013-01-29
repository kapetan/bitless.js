var bitfield = require('./bitfield');
var utils = require('./utils');
var common = require('common');
var environment = require('./environment');
var sha1 = environment.sha1;
var logger = environment.logger.create('storage');

var DEFAULT_BASEPATH = './downloads';

var noop = function() {};

var Storage = function(torrent, fs, basepath) {
	this.torrent = torrent;
	this.haves = new bitfield.Bitfield(torrent.numberOfPieces);
	this.files = null;

	this._basepath = fs.path.resolve(basepath || DEFAULT_BASEPATH);
	this._fs = fs;
};
Storage.prototype.open = function(callback) {
	callback = callback || noop;

	var self = this;

	logger.info('Opening storage for reading/writing');

	common.step([
		function(next) {
			self._fs.exists(self._basepath, next.parallel());
			self._prepareFiles(self._basepath, next.parallel());
		},
		function(arr, next) {
			var exists = arr[0];
			var files = arr[1];

			self.files = files;

			if(!exists) {
				next(null);
				return;
			}

			(function iterate(i) {
				if(i >= self.torrent.numberOfPieces) {
					next(null);
					return;
				}

				self._pieceIO(self.getEmptyPiece(i), 'read', common.fork(callback, function(piece) {
					self.haves.set(i, piece.valid());
					setTimeout(iterate.bind(null, i + 1), 0);
				}));
			}(0));
		},
		function() {
			logger.debug('Files open. Pieces in possesion', self.haves.cardinality());

			callback(null, self);
		}
	], callback);
};
Storage.prototype.close = function(callback) {
	callback = callback || noop;

	if(!this.files) {
		callback();
		return;
	}

	logger.info('Closing storage');

	var self = this;

	common.step([
		function(next) {
			self.files.forEach(function(file) {
				file.close(next.parallel().bind(null, null));
			});
		},
		function() {
			self.files = null;;
			callback();
		}
	], callback);
};
Storage.prototype.size = function() {
	var size = 0;

	for(var i = 0; i < this.torrent.numberOfPieces; i++) {
		size += this.haves.get(i) * this.torrent.pieceSize(i);
	}

	return size;
};
Storage.prototype.hasPiece = function(index) {
	return !!this.haves.get(index);
};
Storage.prototype.getPiece = function(index, callback) {
	callback = callback || noop;

	var piece = this.getEmptyPiece(index);

	if(!this.haves.get(index)) {
		callback(null, piece);
		return;
	}

	this._pieceIO(piece, 'read', callback);
};
Storage.prototype.setPiece = function(piece, callback) {
	callback = callback || noop;

	var self = this;

	this._pieceIO(piece, 'write', common.fork(callback, function() {
		self.haves.set(piece.index, piece.valid());
		callback();
	}));
};
Storage.prototype.getEmptyPiece = function(index) {
	return new Piece(index, this.torrent.pieceSize(index), this.torrent.pieceHash(index));
};
Storage.prototype._pieceIO = function(piece, prop, callback) {
	var self = this;

	var fileIndex = 0;
	var fileSize = this.torrent.fileSize(0);
	var fileOffset = this.torrent.pieceLength * piece.index;

	while(fileOffset >= fileSize) {
		fileOffset -= fileSize;
		fileIndex++;
		fileSize = this.torrent.fileSize(fileIndex);
	}

	var pieceLength = piece.length;
	var pieceOffset = 0;
	var pieceRead = 0;

	(function iterate() {
		if(pieceRead >= pieceLength) {
			callback(null, piece);
			return;
		}

		var need = pieceLength - pieceRead;
		var fileNeed = fileOffset + need < fileSize ? need : (fileSize - fileOffset);

		var file = self.files[fileIndex];

		common.step([
			function(next) {
				file[prop](piece.data, pieceOffset, fileNeed, fileOffset, next);
			},
			function() {
				pieceRead += fileNeed;
				pieceOffset += fileNeed;

				if(need > fileNeed) {
					fileOffset = 0;
					fileIndex++;
					fileSize = self.torrent.fileSize(fileIndex);
				}

				iterate();
			}
		], callback);
	}());
};
Storage.prototype._openFiles = function(basepath, callback) {
	var fs = this._fs;
	var torrent = this.torrent;
	var fileDirs = [];

	var self = this;

	for(var i = 0; i < torrent.numberOfFiles; i++) {
		var dir = torrent.filePath(i);
		
		dir.pop();
		dir = fs.path.join.apply(null, [basepath].concat(dir));

		fileDirs.push(dir);
	}

	common.step([
		function(next) {
			fs.mkdirs(basepath, next);
		},
		function(next) {
			fileDirs.forEach(function(dir) {
				fs.mkdirs(dir, next.parallel());
			});
		},
		function(next) {
			for(var i = 0; i < torrent.numberOfFiles; i++) {
				var base = torrent.filePath(i).pop();
				var path = fs.path.join(fileDirs[i], base);

				logger.debug('Opening file', path);

				fs.open(path, 'a+', next.parallel());
			}
		},
		function(files) {
			callback(null, files);
		}
	], callback);
};
Storage.prototype._prepareFiles = function(basepath, callback) {
	var fs = this._fs;
	var torrent = this.torrent;

	var files;
	var self = this;

	common.step([
		function(next) {
			fs.mkdirs(basepath, next);
		},
		function(next) {
			basepath = fs.path.join(basepath, torrent.name);

			if(torrent.isSingleFileMode) {
				logger.debug('Opening file', basepath);

				fs.open(basepath, 'a+', next);
				return;
			} else {
				self._openFiles(basepath, next);
			}
		},
		function(result, next) {
			files = result;

			if(!utils.array.is(files)) {
				files = [files];
			}

			for(var i = 0; i < files.length; i++) {
				files[i].length(torrent.fileSize(i), next.parallel());
			}
		},
		function() {
			callback(null, files);
		}
	], callback);
};

var Piece = function(index, length, base64Hash) {
	this.index = index;
	this.length = length;
	this.data = new Buffer(length);

	this._hash = base64Hash;

	this.data.fill(0);
};
Piece.prototype.valid = function() {
	var hashed = sha1.create(this.data).digest('base64');

	return hashed === this._hash;
};
Piece.prototype.getBlock = function(offset, length) {
	utils.array.indexInBounds([offset, length - 1, offset + length - 1], this.length);

	return this.data.slice(offset, offset + length);
};
Piece.prototype.setBlock = function(offset, data) {
	utils.array.indexInBounds([offset, data.length - 1, offset + data.length - 1], this.length);

	data.copy(this.data, offset, 0, data.length);
};

var memory = {
	_cache: {},
	path: {
		sep: '/',
		join: function() {
			var path = Array.prototype.slice.call(arguments).join('/');

			return memory.path._normalize(path);
		},
		resolve: function(path) {
			return memory.path._normalize(path);
		},
		_normalize: function(path) {
			var dir = /\/$/.test(path);
			var res = [];

			path = path.split('/').reduce(function(acc, p) {
				if(p && p !== '.') {
					acc.push(p);
				}

				return acc;
			}, []);

			path.forEach(function(p) {
				if(p === '..') {
					res.pop();
					return;
				}

				res.push(p);
			});

			return '/' + res.join('/') + (dir && res.length ? '/' : '');
		}
	},
	open: function(path, flags, callback) {
		path = memory.path.resolve(path);
		var file = memory._cache[path];

		if(!file) {
			file = new memory.File(path);
			memory._cache[path] = file;
		}

		(callback || noop)(null, file);
	},
	mkdirs: function(path, callback) {
		(callback || noop)(null, memory.path.resolve(path).split('/'));
	},
	exists: function(path, callback) {
		path = memory.path.resolve(path);
		var exists = Object.keys(memory._cache).some(function(p) {
			return p.indexOf(path) === 0;
		});

		(callback || noop)(null, exists);
	}
};

memory.File = function(path) {
	this.path = path;
	this.basename = path.split('/').pop();

	this._length = 0;
	this._data = new Buffer(0);
};
memory.File.prototype.read = function(buffer, offset, length, position, callback) {
	callback = callback || noop;

	this._data.copy(buffer, offset, position, position + length);
	callback(null, buffer);
};
memory.File.prototype.write = function(buffer, offset, length, position, callback) {
	callback = callback || noop;

	buffer.copy(this._data, position, offset, offset + length);
	callback(null, buffer);
};
memory.File.prototype.length = function(len, callback) {
	if(!callback && typeof len === 'function') {
		callback = len;
		len = undefined;
	}

	callback = callback || noop;

	if(len !== undefined) {
		var data = new Buffer(len);

		if(data.length && this._data.length) {
			var write = Math.min(data.length, this._data.length);
			this._data.copy(data, 0, 0, write);
		}

		this._length = len;
		this._data = data;
	}

	callback(null, this._length);
};
memory.File.prototype.close = function(callback) {
	(callback || noop)();
};

exports.Piece = Piece;
exports.Storage = Storage;
exports.memory = memory;
