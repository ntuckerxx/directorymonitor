var test = require('tap').test;
var fs = require('fs');
var when = require('when');
var util = require('util');
var events = require('events');
var DirectoryMonitor = require('../lib/directorymonitor.js');
var MockDirDB = require('./mockdirdb.js');


//fixme: these tests need setup/cleanup so they don't rely on previous state
// i've noticed that switching between running them via 'tape' and 'tapr', they
// occasionally fail, and i think that's related

function fstat(path) {
    var d = when.defer();
    fs.stat(path, function(err, stat) {
        if(err) d.reject(err);
        else d.resolve(stat);
    });
    return d.promise;
}

function touch(path) {
    var d = when.defer();
    fs.open(path, "w+", function(err, f) {
        fs.close(f);
        d.resolve();
    });
    return d.promise;
}

var TEST_DB_NAME = "testdirdb.db"
test("can create a directory monitor", function(t) {
    function setup() {
        var d = when.defer();
        d.resolve(true);
        return d.promise;
    }

    setup().then(function() {
        var dm = new DirectoryMonitor(TEST_DB_NAME);
        console.log("created DirectoryMonitor");
        t.ok(dm, "created directory monitor");

        t.test("cleanup", function(t) {
            t.plan(1);
            t.ok(true, "cleanup");
        });
        t.end();

    });
});
