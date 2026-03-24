const { register } = require('./dist/index.js');
const http = require('http');

register();
console.log('Registered network-debugger');

setTimeout(() => {
    http.get('http://example.com', (res) => {
        console.log('Response status:', res.statusCode);
        res.on('data', () => {});
    });
}, 2000);
