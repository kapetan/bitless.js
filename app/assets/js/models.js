var common = require('common');

var Model = common.emitter(function(attributes) {
	this.setAttributes(attributes || {});
});
Model.extend = function(proto) {
	var Klass = function() {
		Model.apply(this, arguments);
	};

	Klass.prototype = Object.create(Model.prototype);

	for(var name in proto) {
		if(proto.hasOwnProperty(name)) {
			Klass.prototype[name] = proto[name];
		}
	}

	return Klass;
};
Model.prototype.setAttributes = function(attributes) {
	this._attributes = attributes;

	for(var name in attributes) {
		if(attributes.hasOwnProperty(name)) {
			this[name] = attributes[name];
		}
	}
};
Model.prototype.getAttributes = function() {
	return common.join(this._attributes)
};
Model.prototype.toJSON = function() {
	return this.getAttributes();
};

var Controller = Model.extend();
var Peer = Model.extend();
var Torrent = Model.extend();
