var test = require('tap').test;
var Database = require('../lib/database.js');
var fs = require('fs');
var when = require('when');

var TEST_DB_NAME = 'test.db';

function deleteTestDB() {
    var d = when.defer();
    function deleteit() {
        fs.unlink(TEST_DB_NAME, function(err) {
            if(err) d.reject(err);
            else d.resolve();
        });
    }

    fs.exists(TEST_DB_NAME, function(exists){
        if(exists) {
            console.log("test db exists; deleting it");
            deleteit();
        } else {
            console.log("test db doesn't exist");
            d.resolve();
        }
    })

    return d.promise;
}

function passfail(test, name, promise) {
    promise.then(function() {
        test.ok(true, name);
    }).catch(function(err) {
        test.fail(err);
    });
}

test("can create a database", function(t) {
    function setup() {
        return deleteTestDB();
    }

    setup().then(function() {
        console.log("testing!");
        t.ok(Database, "Database exists");
        var db = new Database(TEST_DB_NAME);
        console.log("created db");

        t.test("create a table", function(t) {
            t.plan(1);
            console.log("creating a table");
            passfail(t, "created table", db.query("create table if not exists test (id integer, info text)"));
        });
        t.test("do a query with params", function(t) {
            t.plan(2);
            console.log("doing a param query");
            db.query("insert into test (id, info) values ($id, $info)", {$id: 44, $info: 'howdy'}).then(function(){
                db.query("select * from test").then(function(result) {
                    console.log("result: ", result);
                    t.ok(result.length == 1, "got one result");
                    t.ok(result[0].id == 44 && result[0].info == 'howdy', "read back what we wrote");
                })
            });
        });
        t.test("check that the db exists", function(t) {
            t.plan(1);
            fs.exists(TEST_DB_NAME, function(exists) {
                t.ok(exists, "the db file now exists");
            });
        });
        t.test("cleanup", function(t) {
            t.plan(1);
            passfail(t, "cleanup", deleteTestDB());
        });
        t.end();

    });
});
