# response.require

response.require is a [root][root] plugin, for compiling Javascript files using [rex][rex]. It adds one method `response.require`. Install using npm.

```javascript
npm install response.require
```

# Usage

`response.require` takes either a filename and an optional options object, or just the options object as first argument. The input can either be Javascript or HTML, and can be specified using `options.html` or `options.js`. When the input is determined to be HTML, either by checking the filename extension or `options.html`, all the script tags which have the type attribute set to `text/require` are extracted, joined and compiled using `rex`.

```javascript
var fs = require('fs');
var root = require('root');
var responserequire = require('response.require');

var app = root();

app.use(responserequire, { /* options for rex */ });

app.get('/js/*', function(request, response) {
	// Return the compiled javascript file
	response.require(request.params.glob);
});
```

The module exposes an extra function which is mostly suited for development.

```javascript
// Create a route and pass the script function
app.get('/require', responserequire.script);
```

In a HTML file add a script tag whos src attribute points at the route. The specified script tags are compiled and inserted into the document.

```html
<!-- ./index.html -->
<html>
	<head>
		<title>response.require test</title>

		<script type="text/javascript" src="/require"></script>

		<!-- Type must be text/require, only script tags with that type will be compiled -->
		<script type="text/require">
			var mymodule = require('my-module');
			// Do something with mymodule
		</script>

		<script type="text/require">
			// Require more modules
		</script>
	</head>
	<body>
		Hello
	</body>
</html>
```

This is equivalent to doing the following on the server.

```javascript
app.get('/route', function(request, response) {
	// Read the content of the HTML file
	fs.readFile('./index.html', function(err, content) {
		if(err) return response.error(err);

		response.setHeader('Content-Type', 'application/javascript');

		// Compile the script tags and return the result
		response.require({ html: conent });
	});
});
```

`responserequire.script` adds a more generic method of doing the above, which works with all HTML files, but requires multiple requests to the server.

[root]:https://github.com/mafintosh/root "root"
[rex]:https://github.com/gett/rex "rex"
