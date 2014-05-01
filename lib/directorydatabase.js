/*
    DirectoryDatabase represents the current state of files watched by a DirectoryMonitor.
    It's backed by a SQLite database which holds a table of directories of interest
    and a table of files and a hash of their interesting fstat fields, which allows us
    to determine if the file has changed since we last looked at it.

    Files are referenced by full path by breaking them into the root directory path and
    the remainder of the file's path ("subpath"), which is further sped up by also storing
    an MD5 hash of the subpath.  Looking up a file record, rather than being a text comparison,
    ends up being a hash comparison which is then disambiguated with the full subpath.
 */

// TODO: add method for filtering files of interest

var Database = require('./database');
var when = require('when');
var md5 = require('MD5');
var util = require('util');
var events = require('events');
var ConcurrencyLimiter = require('./concurrencylimiter.js');

function DirectoryDatabase(dbfile) {
    this.db = new Database(dbfile);
    //this.db.debug(true);
    this.limiter = new ConcurrencyLimiter(10);
    events.EventEmitter.call(this);
    this.statTouches = [];
}
util.inherits(DirectoryDatabase, events.EventEmitter);


function dbg(msg) {
    //console.log("DirectoryDatabase: " + msg);
}

// events:
//      dir_add -> function(path) -- a directory of interest was added.
//      dir_delete -> function(path) -- directory of interest was removed
//      file_add -> function(path, stat) -- a file was added
//      file_change -> function(path, stat) -- a file was added
//      file_delete -> function(path) -- a file was removed


DirectoryDatabase.prototype.setup = function() {
    var sqls = [
        "CREATE TABLE IF NOT EXISTS directories (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, seq INTEGER)",
        "CREATE TABLE IF NOT EXISTS files (" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT," +
            "directory_id INTEGER," +
            "subpath TEXT," +
            "subpath_hash BLOB," +
            "statdate INTEGER," +
            "stathash BLOB)",
        "CREATE INDEX IF NOT EXISTS directory_id ON files (directory_id)",
        "CREATE INDEX IF NOT EXISTS subpath_hash ON files (subpath_hash)"
    ];

    return when.all(sqls.map(this.db.query.bind(this.db)));
}

/* hash interesting properties of an fstat result so that if any of
   them change, so does the hash */
function statHash(stat) {
    var input = [
        stat.isFile(),
        stat.isDirectory(),
        stat.isBlockDevice(),
        stat.isCharacterDevice(),
        stat.isFIFO(),
        stat.isSocket(),
        stat.mode,
        stat.size,
        stat.mtime
    ];
    return md5(JSON.stringify(input));
}
DirectoryDatabase.statHash = statHash;

var loadDirsPromise = null;
DirectoryDatabase.prototype.loadDirs = function() {
    var self = this;
    //console.log("loadDirs: " + this.dirs);
    if(this.dirs) {
        return when.resolve(this.dirs);
    } else {
        if(loadDirsPromise) {
            return loadDirsPromise;
        } else {
            return loadDirsPromise = this.db.query("SELECT * FROM directories").then(function(rows) {
                loadDirsPromise = null;
                //console.log("loadDirs rows: ", rows);
                return self.dirs = rows;
            });
        }
    }
}

DirectoryDatabase.prototype.getDirs = function() {
    return this.loadDirs().then(function(dirs) {
        return dirs.map(function(d) { return d.path; });
    })
};

DirectoryDatabase.prototype.findDir = function(path) {
    return this.loadDirs().then(function(dirs) {
        var result = null;
        dirs.forEach(function(dir) {
            if(!result && dir.path == path.substring(0, dir.path.length)) {
                result = dir;
            }
        })
        return result;
    })
}

DirectoryDatabase.prototype.addDir = function(path) {
    var self = this;
    return this.findDir(path).then(function(dir) {
        //console.log("findDir result: " + dir);
        if(!dir) {
            self.dirs = null;
            return self.db.query("INSERT INTO directories (path) VALUES ($path)", {$path: path})
                .then(function() {
                    console.log("dir added, emitting dir_add");
                    self.emit('dir_add', path);
                });
            return result;
        } else {
            return dir;
        }
    })
}

DirectoryDatabase.prototype.removeDir = function(path) {
    var self = this;
    return this.db.query("SELECT id FROM directories WHERE path = $path", {$path:path}).then(function(dirs) {
        if(dirs.length > 0) {
            dirid = dirs[0].id;

            return when.join(
                self.db.query("DELETE FROM directories WHERE id = $dirid", {$dirid: dirid}),
                //fixme: need to emit file_delete for each of these!
                self.db.query("DELETE FROM files WHERE directory_id = $dirid", {$dirid: dirid})
              ).then(function() {
                self.emit('dir_delete', path);
              })
        }
    })
}

/*
 * checkStat -
 *     given a path and a stat (which is presumed to be a current stat for that path),
 *     look for the corresponding file in the database and determine whether it has
 *     changed since we last updated it.  Responds with a promise for either the
 *     file row in question (if it's changed) or null (if it's not).
 */
DirectoryDatabase.prototype.checkStat = function(path, stat) {
    var d = when.defer();
    var self = this;

    // look up the path's directory id and subpath
    this.findDir(path).then(function(dir) {
        //console.log("checkStat findDir result: ", dir);
        if(dir) {
            var stathash = statHash(stat);
            var subpath = path.substring(dir.path.length);
            var subpath_hash = md5(subpath);

            // find the file entry corresponding to that dir id and subpath IFF its stathash is different
            self.db.query("SELECT id,stathash FROM files WHERE directory_id = $dir_id AND subpath_hash = $subpath_hash AND subpath = $subpath",
                {
                    $dir_id : dir.id,
                    $subpath_hash : subpath_hash,
                    $subpath : subpath
                }).then(function(result) {
                    //console.log("query result: ", result);
                    if(result.length == 0) {
                        dbg("resolving checkStat true (no row found)");
                        d.resolve(true);
                    } else {
                        dbg("resolving checkStat " + (result[0].stathash != stathash))
                        self.db.query("UPDATE files SET statdate = $statdate WHERE directory_id = $dir_id AND subpath_hash = $subpath_hash AND subpath = $subpath",
                            {
                                $dir_id : dir.id,
                                $subpath_hash : subpath_hash,
                                $subpath : subpath,
                                $statdate : new Date()
                            }
                        ).then(function(){
                            d.resolve(result[0].stathash != stathash);
                        });
                    }
                }).catch(function(err) { console.log("ERROR: " + err);})
            //console.log("found dir: ", {path: path, dirpath: dir.path, subpath: subpath});

        } else {
            d.resolve(false);
        }
    })

    return d.promise;
}

DirectoryDatabase.prototype.touchStat = function(dir_id, subpath) {
    this.statTouches.push({ dir_id: dir_id, subpath: subpath });
}
DirectoryDatabase.prototype.flushTouches = function() {
    var chunkSize = 100;
}

DirectoryDatabase.prototype.storeInfo1 = function(path, stat) {
    var d = when.defer();
    var self = this;

    this.findDir(path).then(function(dir) {
        //console.log("storeInfo findDir result: ", dir);
        if(dir) {
            var stathash = statHash(stat);
            var subpath = path.substring(dir.path.length);
            var subpath_hash = md5(subpath);

            // find the file entry corresponding to that dir id and subpath IFF its stathash is different
            self.db.query(
                        "SELECT id FROM files " +
                        "WHERE directory_id = $directory_id " +
                        "    AND subpath_hash = $subpath_hash " +
                        "    AND subpath = $subpath " +
                        "    AND stathash IS NOT $stathash",
                {
                    $directory_id : dir.id,
                    $subpath_hash : subpath_hash,
                    $subpath : subpath,
                    $stathash : stathash
                }).then(function(result) {
                    if(result.length > 0) {
                        //update it
                            console.log("updating file " + path);
                            d.resolve(
                                self.db.query(
                                     "UPDATE files SET " +
                                     "    stathash = $stathash " +
                                     "WHERE directory_id = $directory_id " +
                                     "    AND subpath_hash = $subpath_hash " +
                                     "    AND subpath = $subpath " +
                                     "    AND stathash != $stathash",
                                     {
                                         $directory_id : dir.id,
                                         $subpath_hash : subpath_hash,
                                         $subpath : subpath,
                                         $stathash : stathash,
                                     }
                                 )
                            ).then(function(arg) {
                                self.emit('file_change', path, stat);
                                return arg;
                            });;
                    } else {
                        //console.log("file query produced " + result.length + " results but none matched subpath " + subpath);
                        //insert it
                        d.resolve(
                            self.db.query("INSERT INTO files (directory_id, subpath, stathash, subpath_hash) VALUES ($directory_id, $subpath, $stathash, $subpath_hash)",
                                {
                                    $directory_id : dir.id,
                                    $subpath_hash : subpath_hash,
                                    $subpath : subpath,
                                    $stathash : stathash
                                }
                            ).then(function(arg) {
                                self.emit('file_add', path, stat);
                                return arg;
                            })
                        );
                    }
                })
            //console.log("found dir: ", {path: path, dirpath: dir.path, subpath: subpath});
            d.resolve(false);

        } else {
            d.resolve(false);
        }
    })

    return d.promise;
}

DirectoryDatabase.prototype.storeInfo = function(path, stat) {
    var d = when.defer();
    var self = this;
    //console.log("storing file info for " + path);
    this.findDir(path).then(function(dir) {
        //console.log("storeInfo findDir result: ", dir);
        if(dir) {
            var stathash = statHash(stat);
            var subpath = path.substring(dir.path.length);
            var subpath_hash = md5(subpath);

            // find the file entry corresponding to that dir id and subpath IFF its stathash is different
            self.db.query("SELECT * FROM files WHERE directory_id = $dir_id AND subpath_hash = $subpath_hash",
                {
                    $dir_id : dir.id,
                    $subpath_hash : subpath_hash,
                }).then(function(result) {
                    var match = null;
                    for(var i=0; i<result.length; i++) {
                        if(result[i].subpath == subpath) {
                            match = result[i];
                            break;
                        }
                    }
                    if(match) {
                        dbg("storeInfo found file, updating it (" + path + ")");
                        //update it
                        d.resolve(
                            self.db.query("UPDATE files SET stathash = $stathash WHERE id = $id",
                                {
                                    $stathash : stathash,
                                    $id : match.id
                                }
                            ).then(function(r) {
                                dbg("emitting file_change");
                                self.emit("file_change", path, stat);
                                return r;
                            }).catch(function(err) { console.log("ERROR: " + err);})
                        );
                    } else {
                        dbg("storeInfo didn't find file, creating it (" + path + ")");
                        //console.log("file query produced " + result.length + " results but none matched subpath " + subpath);
                        //insert it
                        d.resolve(
                            self.db.query("INSERT INTO files (directory_id, subpath, stathash, subpath_hash) VALUES ($directory_id, $subpath, $stathash, $subpath_hash)",
                            {
                                $directory_id : dir.id,
                                $subpath_hash : subpath_hash,
                                $subpath : subpath,
                                $stathash : stathash
                            }).then(function(r) {
                                self.emit("file_add", path, stat);
                                return r;
                            })
                        );
                    }
                });
            //console.log("found dir: ", {path: path, dirpath: dir.path, subpath: subpath});
            d.resolve(false);

        } else {
            d.resolve(false);
        }
    });

    return d.promise;
}

DirectoryDatabase.prototype.deleteFile = function(path) {
    var d = when.defer();
    var self = this;
    //console.log("deleting file info for " + path);
    this.findDir(path).then(function(dir) {
        //console.log("deleteFile findDir result: ", dir);
        if(dir) {
            var stathash = statHash(stat);
            var subpath = path.substring(dir.path.length);
            var subpath_hash = md5(subpath);

            d.resolve(
                self.db.query("DELETE FROM files WHERE directory_id = $dir_id AND subpath_hash = $subpath_hash AND subpath = $subpath",
                {
                    $dir_id : dir.id,
                    $subpath_hash : subpath_hash,
                    $subpath : subpath,
                }).then(function() {
                    self.emit('file_delete', path);
                })
            );
        } else {
            d.resolve(false);
        }
    });

    return d.promise;
};

module.exports = DirectoryDatabase;
