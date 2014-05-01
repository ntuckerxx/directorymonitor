var test = require('tap').test;
var DirectoryDatabase = require('../lib/directorydatabase.js');
var fs = require('fs');
var when = require('when');

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
test("can create a directory database", function(t) {
    function setup() {
        var d = when.defer();
        d.resolve(true);
        return d.promise;
    }

    setup().then(function() {
        var dirdb = new DirectoryDatabase(TEST_DB_NAME);

        t.test("initialize the db", function(t) {
            t.plan(1);
            dirdb.setup().then(function() {
                t.ok(true, "ok");
            })
        });
        t.test("add and find a directory", function(t) {
            t.plan(6);
            dirdb.addDir('/').then(function() {
                t.ok(true, "added dir");
                return dirdb.findDir('/foobar')
            }).then(function(dir) {
                t.ok(dir, "found dir");
                console.log("findDir result: ", dir);
            }).then(function() {
                fstat('/tmp').then(function(stat) {
                    console.log("got a stat: ", stat);
                    var h = DirectoryDatabase.statHash(stat);
                    t.ok(h, "calculate stat hash");
                    dirdb.checkHashChanged('/tmp', stat).then(function(result) {
                        console.log("hash changed result: ", result);
                    });
                })
            }).then(function() {
                touch('/tmp/foob').then(function() {
                    fstat('/tmp/foob').then(function(stat) {
                        dirdb.storeInfo('/tmp/foob', stat).then(function() {
                            t.ok(true, "file info stored");
                        });
                    })
                });
            }).then(function() {
                dirdb.addDir('/blahblah').then(function() {
                    t.ok(true, "added dir");
                }).then(function() {
                    dirdb.removeDir('/blahblah').then(function() {
                        t.ok(true, "removed dir");
                    })
                })
            });
        });
/*
        t.test("get and check a stat hash", function(t) {
            t.plan(1);
            fstat('/tmp').then(function(stat) {
                console.log("got a stat: ", stat);
                var h = DirectoryDatabase.statHash(stat);
                t.ok(h, "calculate stat hash");
                dirdb.checkHashChanged('/tmp', stat).then(function(result) {
                    console.log("track hash changed result: ", result);
                });
            })
        });
*/
        t.test("cleanup", function(t) {
            t.plan(1);
            t.ok(true, "cleanup");
        });
        t.end();

    });
});
