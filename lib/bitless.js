var environment = require('./bitless/environment');
var client = require('./bitless/client');

exports.create = function() {
	return new client.Client();
};
