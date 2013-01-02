var global;
var env;

(function() {
	global = this;
}());

if(module.browser) {
	env = global.config && global.config.env;

	if(!env) {
		env = 'browser'
	}
} else {
	env = global.process.env['BITLESS'] || 'nodejs';
}

exports.name = env;
exports.logger = require('debug');

var initialize;

switch(env) {
	case 'browser':
		initialize = require('./browser');
		break;
	case 'nodejs':
		initialize = require('./nodejs'); // @rex-ignore
		break;
	default:
		throw new Error('Unknown environment ' + env);
}

initialize(exports, global.config || {});
