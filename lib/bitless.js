var environment = require('./bitless/environment');
var client = require('./bitless/client');

environment.logger.setLevel(3);

exports.create = function(options) {
	return new client.Client();
};
