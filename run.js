#!/usr/bin/env node

var child = require('child_process');	

child.fork('./app/server', [12000]);
child.fork('./app/server', [12001]);
child.fork('./index.js');
