// repl server lifted from https://gist.github.com/jakwings/7772580

var repl = require('repl');
var net = require('net');

function Debugport(portnum) {
    net.createServer(function(socket) {
        var r = repl.start({
            prompt: 'debugport > ',
            input: socket,
            output: socket,
            terminal: true,
            useGlobal: true
        });
        r.on('exit', function() {
            socket.end();
        });
        r.context.socket = socket;
    }).listen(portnum, 'localhost');
}

module.exports = Debugport;

