require('sha1');
require('enc-base64');

var Hash = function(str) {
	this._hash = CryptoJS.algo.SHA1.create();
	
	if(str) {
		this.update(str);
	}
};
Hash.prototype.update = function(str, encoding) {
	if(Buffer.isBuffer(str)) {
		str = str.toString('binary');
		str = CryptoJS.enc.Latin1.parse(str);
	}

	this._hash.update(str);

	return this;
};
Hash.prototype.digest = function(encoding) {
	var hash = this._hash.finalize();

	switch(encoding || 'binary') {
		case 'binary':
			return hash.toString(CryptoJS.enc.Latin1);
		case 'hex':
			return hash.toString(CryptoJS.enc.Hex);
		case 'base64':
			return hash.toString(CryptoJS.enc.Base64);
		default:
			throw new Error('Unsupported encoding ' + encoding);
	}
};

exports.create = function(str) {
	return new Hash(str);
};
