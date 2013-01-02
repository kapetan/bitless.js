var common = require('common');

exports.arguments = {
	expect: function(opts) {
		for(var i = 1; i < arguments.length; i++) {
			var key = arguments[i];
			if(opts[key] === undefined) {
				throw new Error('Expected key "' + key + '" not in options');
			}
		}
	},
	only: function(opts) {
		var args = {};
		for(var i = 1; i < arguments.length; i++) {
			args[arguments[i]] = 0;
		}

		for(var key in opts) {
			if(!(key in args)) {
				throw new Error('Unexpected key "' + key + '" in options');
			}
		}
	},
	exactly: function() {
		var args = Array.prototype.slice.call(arguments);
		this.expect.apply(this, args);
		this.only.apply(this, args);
	}
};

exports.array = {
	shuffle: function(arr) {
		arr = arr.slice();
		var i = arr.length;

		if(i === 0) {
			return arr;
		}

		while(--i) {
			var j = Math.floor(Math.random() * (i + 1));
			var temp = arr[i];

			arr[i] = arr[j];
			arr[j] = temp; 
		}

		return arr;
	},
	indexInBounds: function(i, length) {
		if(!exports.array.is(i)) {
			i = [i];
		}
		if(typeof length.length === 'number') {
			length = length.length;
		}

		for(var j = 0; j < i.length; j++) {
			if(0 > i[j] || i[j] >= length) {
				throw new Error('Index out of bounds');
			}
		}
	},
	is: function(obj) {
		return Object.prototype.toString.call(obj) === '[object Array]';
	},
	range: function(from, to) {
		if(to === undefined && from > 0) {
			to = from;
			from = 0;
		}

		to = to || 0;

		var range = [];

		for(var i = from; i < to; i++) {
			range.push(i);
		}

		return range;
	},
	pick: function(arr) {
		var i = Math.floor(Math.random() * arr.length);

		return arr[i];
	},
	equals: function(a1, a2) {
		if(a1.length !== a2.length) {
			return false;
		}

		for(var i = 0; i < a1.length; i++) {
			if(a1[i] !== a2[i]) {
				return false;
			}
		}

		return true;
	}
};

exports.time = {
	milliseconds: function() {
		//(new Date()).getTime();
		return Date.now();
	},
	seconds: function() {
		return Math.round(exports.time.milliseconds() / 1000);
	}
};

exports.buffer = {
	equals: function(b1, b2) {
		if(b1.length !== b2.length) {
			return false;
		}

		for(var i = 0; i < b1.length; i++) {
			if(b1.get(i) !== b2.get(i)) {
				return false;
			}
		}

		return true;
	},
	random: function(len) {
		var b = new Buffer(len);

		for(var i = 0; i < len; i++) {
			b.set(i, Math.floor(Math.random() * 256));
		}

		return b;
	}
};
