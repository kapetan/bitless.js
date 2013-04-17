var utils = require('./utils');
var common = require('common');
var bencode = require('dht-bencode');
var environment = require('./environment');
var http = environment.http;
var logger = environment.logger.create('tracker');

// TODO
// Check if response is valid
// Join event request and pending peer request

// Available events started, stopped and completed.

//var NUMWANT = 30;
var RETRY_TIMEOUT = 300; // seconds

var noop = function() {};
var nullify = function(fn) {
	return function(err) {
		fn(null, err);
	};
};
var any = function(arr) {
	return arr.filter(function(i) {
		return i;
	})[0];
};

var Manager = common.emitter(function(torrent, options) {
	utils.arguments.expect(options, 'id', 'port');

	this.torrent = torrent;
	this.me = {
		id: options.id,
		port: options.port
	};

	this.downloaded = options.downloaded || 0;
	this.uploaded = options.uploaded || 0;
	this.left = options.left || torrent.length;

	this.trackers = [];
	this.numberOfTrackers = 0;

	this._waiting = null;
	this._requesting = false;

	var self = this;
	var announceList = torrent.announceList || [[torrent.announce]];

	announceList.forEach(function(tier) {
		var trackers = [];

		tier.forEach(function(announce) {
			var protocol = http.parseUrl(announce).protocol;

			if(protocol === 'http') {
				var t = new HttpClient(torrent, common.join(options, { announce: announce }));
				trackers.push(t);
			}
		});

		if(trackers.length) {
			self.numberOfTrackers += trackers.length;
			self.trackers.push(utils.array.shuffle(trackers));
		}
	});
});
Manager.prototype.getTracker = function(trackerIndex) {
	utils.array.indexInBounds(trackerIndex, this.numberOfTrackers);

	var off = trackerIndex;

	for(var i = 0; i < this.trackers.length; i++) {
		var tier = this.trackers[i];

		if(off < tier.length) {
			return tier[off];
		}
		else {
			off -= tier.length;
		}
	}
};
Manager.prototype.eachTracker = function(fn) {
	for(var i = 0; i < this.numberOfTrackers; i++) {
		fn(this.getTracker(i));
	}
};
Manager.prototype.eachActiveTracker = function(fn) {
	for(var i = 0; i < this.numberOfTrackers; i++) {
		var tracker = this.getTracker(i);

		if(tracker.active) {
			fn(tracker);
		}
	}
};
Manager.prototype.sendEvent = function(event, callback) {
	callback = callback || noop;

	var self = this;

	logger.debug('Sending event', event);

	common.step([
		function(next) {
			self.eachActiveTracker(function(tracker) {
				tracker.sendEvent(event, nullify(next.parallel()));
			});
		},
		function(errors) {
			callback(any(errors));
		}
	], callback);
};
Manager.prototype.request = function(options) {
	options = options || {};

	var force = options.force;

	if(this._requesting) {
		return;
	}
	if(this._waiting && !force) {
		return;
	}

	var self = this;

	clearTimeout(this._waiting);
	this._waiting = null;

	var next = function(i) {
		if(i === 0) {
			self._requesting = true;
		}
		if(i >= self.numberOfTrackers) {
			self._requesting = false;
			self.emit('abort', new Error('Unable to connect to trackers'));
			return;
		}

		var tracker = self.getTracker(i);
		var announce = tracker.announce.toString();

		if(!tracker.isReady() && !force) {
			next(i + 1);
			return;
		}

		logger.info(announce, 'Requesting from tracker', options);

		tracker.request(options, function(err, response) {
			if(err) {
				logger.warn(announce, 'Tracker request failed:', err.message);

				next(i + 1);
				return;
			}

			var off = i;

			// Move tracker to beginning of tier
			for(var j = 0; j < self.trackers.length; j++) {
				var tier = self.trackers[j];

				if(off < tier.length) {
					tier.splice(off, 1);
					tier.splice(0, 0, tracker);
				} else {
					off -= tier.length;
				}
			}

			logger.debug(announce, 'Tracker response', response);

			self._requesting = false;
			self.emit('response', response);
		});
	};

	if(this.isReady() || force) {
		next(0);
	} else {
		var min;

		this.eachTracker(function(tracker) {
			if(!min || (tracker.nextContact < min.nextContact)) {
				min = tracker;
			}
		});

		var contact = utils.time.seconds() - min.nextContact;
		this._waiting = setTimeout(function() {
			self._waiting = null;
			next(0);
		}, contact * 1000);
	}
};
Manager.prototype.close = function(callback) {
	var callback = callback || noop;
	var self = this;

	clearTimeout(this._waiting);
	this._waiting = null;

	this.downloaded = 0;
	this.uploaded = 0;

	logger.info('Closing tracker');

	common.step([
		function(next) {
			self.eachActiveTracker(function(tracker) {
				tracker.close(nullify(next.parallel()));
			});
		},
		function(errors) {
			callback(any(errors));
		}
	], callback);
};
Manager.prototype.isReady = function() {
	for(var i = 0; i < this.numberOfTrackers; i++) {
		if(this.getTracker(i).isReady()) {
			return true;
		}
	}

	return false;
};
Manager.prototype.updateLeft = function(value) {
	this.left -= value;

	this.eachTracker(function(tracker) {
		tracker.updateLeft(value);
	});
};
Manager.prototype.updateUploaded = function(value) {
	this.uploaded += value;

	this.eachActiveTracker(function(tracker) {
		tracker.updateUploaded(value);
	});
};
Manager.prototype.updateDownloaded = function(value) {
	this.downloaded += value;

	this.eachActiveTracker(function(tracker) {
		tracker.updateDownloaded(value);
	});
};

var Client = common.emitter(function() {
	this.contact = null;
});
Client.extend = function(fn) {
	var Klass = function() {
		Client.apply(this, arguments);
		fn.apply(this, arguments);
	};

	Klass.prototype = Object.create(Client.prototype);

	return Klass;
};
Client.prototype.request = function(options) {
	/*if(this._requesting) {
		return;
	}*/
	if(this.contact && !options.force) {
		this.contact.options = options;
		return;
	}

	//this._requesting = true;

	clearTimeout(this.contact && this.contact.timeout);
	//this.contact = null;

	this.sendRequest(options, this._scheduleRequest.bind(this));
};
Client.prototype.event = function(event, callback) {
	var options = (this.contact && this.contact.options) || {};
	var self = this;

	options = common.join(options, { event: event });

	clearTimeout(this.contact && this.contact.timeout);
	//this.contact = null;

	this.sendRequest(options, function(err, response) {
		self._scheduleRequest();
		callback(err, response);
	});
};
Client.prototype._scheduleRequest = function() {
	var self = this;

	this.contact = {};
	this.contact.options = { numwant: 0 };

	this.contact.timeout = setTimeout(function() {
		var contact = self.contact;

		self.contact = null;
		self.request(contact.options);
	}, (self.nextContact - utils.time.seconds()) * 1000);
};

var HttpClient = Client.extend(function(torrent, options) {
	utils.arguments.expect(options, 'id', 'port', 'announce');

	this.announce = http.parseUrl(options.announce);

	if(this.announce.protocol !== 'http') {
		throw new Error('Unsupported protocol "' + this.announce.protocol + '"');
	}

	this.torrent = torrent;
	this.me = {
		id: options.id,
		port: options.port
	};

	this.left = options.left || torrent.length;
	this.downloaded = options.downloaded || 0;
	this.uploaded = options.uploaded || 0;

	this.trackerId = null;
	this.active = false;
	this.nextContact = null;
});
HttpClient.prototype.sendRequest = function(options, callback) {
	options = common.join({}, options || {});
	callback = callback || noop;

	var numwant = options.numwant;

	if(numwant === undefined) {
		numwant = 0;
	}
	if(!options.event && !this.active) {
		options.event = 'started';
	}

	var params = {
		info_hash: this.torrent.infoHash,
		peer_id: this.me.id.pack(),
		port: this.me.port,
		uploaded: this.uploaded,
		downloaded: this.downloaded,
		left: this.left,
		compact: 1,
		no_peer_id: 1,
		numwant: numwant
	};

	if(this.trackerId) {
		params['trackerid'] = this.trackerId;
	}
	if(options.event) {
		params['event'] = options.event;
	}

	var self = this;
	var error = function(err) {
		self.nextContact = utils.time.seconds() + RETRY_TIMEOUT;

		self.emit('abort', err);
		callback(err);
	};

	http
		.get(this.announce)
		.query(params)
		.send(function(err, data) {
			if(err) {
				error(err);
				return;
			}

			var response;

			try {
				response = new HttpResponse(data);

				self.trackerId = response.trackerId;

				if(response.interval) {
					self.nextContact = utils.time.seconds() + response.interval;
				}

				self.active = true;
			} catch(err) {
				error(err);
				return;
			}

			self.emit('response', response);
			callback(null, response);
	});
};
/*HttpClient.prototype.sendEvent = function(event, callback) {
	this.sendRequest({ numwant: 0, event: event }, callback);
};*/
HttpClient.prototype.close = function(callback) {
	this.active = false;
	this.nextContact = null;
	this.trackerId = null;

	this.downloaded = 0;
	this.uploaded = 0;

	var self = this;

	this.event('stopped', function(err, response) {
		self.emit('close');
		callback(err, response);
	});
};
HttpClient.prototype.isReady = function() {
	return !this.nextContact || (this.nextContact <= utils.time.seconds());
}
HttpClient.prototype.updateLeft = function(value) {
	this.left -= value;
};
HttpClient.prototype.updateUploaded = function(value) {
	this.uploaded += value;
};
HttpClient.prototype.updateDownloaded = function(value) {
	this.downloaded += value;
};

var HttpResponse = function(content) {
	resp = bencode.bdecode(content);
	if(resp['failure reason']) {
		throw new Error(resp['failure reason']);
	}

	this.complete = resp['complete'];
	this.incomplete = resp['incomplete'];
	this.interval = resp['interval'];
	this.minInterval = resp['min interval'];
	this.trackerId = resp['tracker id'];

	var peers = resp['peers'];

	if(peers instanceof Array) {
		this.peers = peers.map(function(peer) {
			return {
				host: peer.ip.toString('ascii'),
				port: peer.port
			};
		});
	}
	else {
		this.peers = [];
		var start = 0;

		while(start < peers.length) {
			var ip = [];

			for(var i = 0; i < 4; i++) {
				ip.push(peers.get(start + i).toString());
			}

			ip = ip.join('.');

			var port = peers.readUInt16BE(start + 4);

			this.peers.push({
				host: ip,
				port: port
			});

			start += 6;
		}
	}
};

var UdpClient = Client.extend(function(torrent, options) {

});

var UdpResponse = function(content) {

};

exports.Manager = Manager;
exports.HttpClient = HttpClient;
