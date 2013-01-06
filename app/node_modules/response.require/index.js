var htmlparser = require('htmlparser');
var rex = require('rex');
var cat = require('cat');

var TYPE_ATTRIBUTE = 'text/require';

module.exports = exports = function(app, options) {
	var parse = rex(options);

	var js = function(content, callback) {
		try {
			content = new Function(content);
		} catch(err) {
			callback(err);
			return;
		}

		parse(content, callback);
	};
	var html = function(content, callback) {	
		var handler = new htmlparser.DefaultHandler(function(err, dom) {
			if(err) {
				callback(err);
				return;
			}

			var result = [];
			var reduce = function(acc, element) {
				if(element.type === 'script' && element.attribs && element.attribs.type === TYPE_ATTRIBUTE) {
					acc.push(element);
				}
				if(element.children) {
					element.children.reduce(reduce, acc);
				}

				return acc;
			};

			dom.reduce(reduce, result);

			if(!result.length) {
				callback(null, '');
				return;
			}

			result = result.map(function(script) {
				var text = script.children && script.children[0];

				if(!text || text.type !== 'text') {
					return '';
				}

				return text.data;
			});

			js(result.join('\n'), callback);
		}, { verbose: false });

		(new htmlparser.Parser(handler)).parseComplete(content);
	};

	app.use('response.require', function(filename, options) {
		if(!options && typeof filename === 'object') {
			options = filename;
			filename = null;
		}

		var response = this;
		var isHtml = !!(/\.htm(l)?$/.test(filename) || options.html);

		var send = function(err, body) {
			if(err) return response.error(err);

			response.setHeader('Content-Type', 'application/javascript');
			response.send(body);
		};
		var end = function(content) {
			if(!content) return response.end();
			
			if(isHtml) return html(content, send);
			js(content, send);
		};
		
		if(filename) {
			cat(filename, function(err, content) {
				if(err) return response.error(err);
				end(content);
			});

			return;
		}

		end(options.html || options.js);
	});
};

exports.script = function(request, response) {
	var url = request.query.url;

	response.setHeader('Content-Type', 'text/javascript');

	if(url) {
		return response.require(url, { html: true });
	} 

	var path = request.url.split('?')[0];
	var protocol = request.connection.encrypted ? 'https' : 'http';

	response.send('document.write("<script src=\'' + protocol + '://' + request.headers.host + path +
		'?url="+encodeURIComponent(window.location.toString())+"\'></script>");');
};
