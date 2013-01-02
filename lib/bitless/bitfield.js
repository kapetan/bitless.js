var utils = require('./utils');

var Bitfield = function(length) {
	this.length = length;
	this.bytelength = Math.ceil(length / 8);
	this._field = [];

	for(var i = 0; i < length; i++) {
		this._field[i] = 0;
	}
};

Bitfield.prototype.get = function(index) {
	utils.array.indexInBounds(index, this.length);

	return this._field[index];
};
Bitfield.prototype.set = function(index, value) {
	utils.array.indexInBounds(index, this.length);

	this._field[index] = +!!value;
};
Bitfield.prototype.flip = function(index) {
	var i = this.get(index);

	this.set(index, !i);
};
Bitfield.prototype.cardinality = function() {
	var card = 0;

	for(var i = 0; i < this.length; i++) {
		if(this._field[i]) {
			card++;
		}
	}

	return card;
};
Bitfield.prototype.equals = function(field) {
	return utils.array.equals(this._field, field._field);
};
Bitfield.prototype.pack = function() {
	var bytes = new Buffer(Math.ceil(this.length / 8));
	var length = bytes.length * 8;

	bytes.fill(0);

	for(var i = 0; i < length; i++) {
		var j = Math.floor(i / 8);
		var b = this._field[i] || 0;
		var c = bytes.get(j);

		if(b) {
			c = c | 1;
		}
		if(i % 8 !== 7) {
			c = c << 1;
		}

		bytes.set(j, c);
	}

	return bytes;
};

exports.Bitfield = Bitfield;
exports.unpack = function(buffer, length) {
	var biteLength = buffer.length * 8;

	if(biteLength < length) {
		throw new Error('Expected length does not match the given buffer');
	}

	var bitField = new Bitfield(length);

	for(var i = 0; i < biteLength; i++) {
		var j = Math.floor(i / 8);
		var b = (buffer.get(j) & 0xff) >> (7 - (i % 8));

		if(b & 1) {
			if(i >= length) {
				throw new Error('Bits set beyond given length');
			}

			bitField.flip(i);
		}
	}

	return bitField;
};
