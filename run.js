#!/usr/bin/env node

var child = require('child_process');
var fs = require('fs');

var now = Date.now();

[0, 1].forEach(function(i) {
	var name = './log/' + now + '_run_' + i + '.log';
	var args = ['./index.js'];

	if(i === 1) args.push('read');

	var stdout = fs.openSync(name, 'a');
	var stderr = fs.openSync(name, 'a');
	
	child.spawn('node', args, { stdio: [process.stdin, stdout, stderr] });
});

child.fork('./app/server', [12000]);
