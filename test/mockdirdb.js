var events = require('events');
var when = require('when');
var util = require('util');

function MockDirDB() {
    this.paths = [].slice.call(arguments);

    events.EventEmitter.call(this);
}
util.inherits(MockDirDB, events.EventEmitter);

MockDirDB.prototype.getDirs = function() {
    return when.resolve(this.paths);
}
MockDirDB.prototype.testAddDir = function(path) {
    this.paths.push(path);
    this.emit('dir_add', {path: path})
}
MockDirDB.prototype.checkHashChanged = function() {
    return when.resolve(true);
}
MockDirDB.prototype.storeInfo = function(info) {
    return when.resolve(true);
}

module.exports = MockDirDB;
