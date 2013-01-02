var bencode = require('dht-bencode');

console.log(bencode.bencode({ hello: ['gogo', 1] }));