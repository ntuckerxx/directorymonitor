/*
    DirectoryMonitor talks to a DirectoryDatabase and queries it for the
    list of directories the DirectoryDatabase is interested in.  It then
    watches these directories and updates the DirectoryDatabase when files
    change.
 */

var events = require('events');
var util = require('util');
var fs = require('fs');
var when = require('when');
var watch = require('watch');
var wrench = require('wrench');
var ConcurrencyLimiter = require('./concurrencylimiter.js');

var DirectoryDatabase = require('./directorydatabase.js');

function dbg(msg) {
    //console.log(msg);
}

function DirectoryMonitor(dbfile) {
    this.dirdb = new DirectoryDatabase(dbfile);
    this.dirdb.setup();
    var self = this;

    ['dir_add', 'dir_delete', 'file_add', 'file_change', 'file_delete'].forEach(function(evt) {
        var handler = '_on_dirdb_' + evt;
        self.dirdb.on(evt, self[handler].bind(self));
    });

    this.dirs = {};
    this.errordirs = {};
    this.limiter = new ConcurrencyLimiter(1);
    events.EventEmitter.call(this);
}
util.inherits(DirectoryMonitor, events.EventEmitter);

DirectoryMonitor.prototype.start = function() {
    return this.setupWatchers();
}

DirectoryMonitor.prototype.scan = function() {
    var self = this;
    var promises = [];

    for(var dir in this.dirs) {
        var d = when.defer();
        promises.push(self.scanDir(dir));
    }

    return when.all(promises);
}
DirectoryMonitor.prototype.scanDir = function(dir) {
    var self = this;
    var d = when.defer();
    //fixme: store something in self.dirs[dir] that allows this scan to be canceled along with an unhook()
    wrench.readdirRecursive(dir, function(error, curFiles) {
        if(error) {
            dbg("oops: problem walking dir " + dir);
            d.resolve();
        }
        if(curFiles) {
            curFiles.forEach(function(f) {
                self.limiter.do(function() {
                    var filepath = (dir + "/" + f).replace(/\/+/g, "/");
                    dbg("scan: " + filepath);
                    return self.saveFileIfChanged(filepath).then(function() {
                        dbg("saveFileIfChanged finished");
                    });
                });
            });
        } else {
            d.resolve();
        }
    });
    return d.promise;
}
DirectoryMonitor.prototype.setupWatchers = function() {
    var self = this;
    var promises = [];
    var d = when.defer();

    this.dirdb.getDirs().then(function(dirs) {
        dirs.forEach(function(dir) {
            promises.push(self.setupWatch(dir));
        });
    }).then(function() {
        when.all(promises).then(function() {
            d.resolve();
        });
    })
    return d.promise;
}
DirectoryMonitor.prototype.createMonitor = function(dir) {
    var self = this;
    var d = when.defer();

    try {
        console.log("creating monitor for dir " + dir);
        self.dirs[dir] = {};
        watch.createMonitor(dir, function(monitor) {
            console.log("monitor created for dir " + dir);
            var oncreated = self.oncreated.bind(self, dir);
            var onchanged = self.onchanged.bind(self, dir);
            var onremoved = self.onremoved.bind(self, dir);

            monitor.on('created', oncreated);
            monitor.on('changed', onchanged);
            monitor.on('removed', onremoved);
            monitor.unhook = function() {
                monitor.removeListener('created', oncreated);
                monitor.removeListener('changed', onchanged);
                monitor.removeListener('removed', onremoved);
            };
            self.dirs[dir].monitor = monitor;
            d.resolve(monitor);
    });
    } catch(e) {
        console.error("Failed to create monitor for dir " + dir + ": " + e);
        this.errordirs[dir] = e;
        d.reject(e);
    }
    return d.promise;
}

DirectoryMonitor.prototype.removeDir = function(dir) {
    return this.dirdb.removeDir(dir);
}
DirectoryMonitor.prototype.addDir = function(dir) {
    return this.dirdb.addDir(dir);
}

function fstat(path) {
    var d = when.defer();
    fs.stat(path, function(err, stat) {
        dbg("fstat result: " + (err ? err : "ok"));
        if(err) d.reject(err);
        else d.resolve(stat);
    });
    return d.promise;
}
function maybestat(path, stat) {
    dbg("maybestat(" + (stat?"no":"yes") + ")");
    if(stat) return when.resolve(stat);
    else return fstat(path);
}

DirectoryMonitor.prototype.saveFileIfChanged = function(path, stat) {
    var self = this;
    dbg("saveFileIfChanged, already stated? " + (stat ? "yes" : "no"))
    return (stat ? when.resolve(stat) : fstat(path)).then(function(stat) {
        if(stat.isDirectory()) {
            return when.resolve();
        }

        //fixme: file-of-interest filtering
            dbg("checking to see if hash changed: " + path);
            return self.dirdb.checkStat(path, stat).then(function(changed) {
                if(changed) {
                    dbg("changed: " + path);
                    return self.dirdb.storeInfo(path, stat);
                } else {
                    dbg("not changed: " + path);
                    return when.resolve();
                }
            });
    });
}

// called when a watcher sees a file added
DirectoryMonitor.prototype.oncreated = function(dir, filepath, stat) {
    dbg("created: " + filepath);
    this.saveFileIfChanged(filepath, stat);
}
// called when a watcher sees a file changed
DirectoryMonitor.prototype.onchanged = function(dir, filepath, stat) {
    dbg("changed: " + filepath);
    this.saveFileIfChanged(filepath, stat);
}
// called when a watcher sees a file removed
DirectoryMonitor.prototype.onremoved = function(dir, filepath, stat) {
    dbg("removed: " + filepath);
    this.dirdb.deleteFile(filepath);
}


DirectoryMonitor.prototype.setupWatch = function(path) {
    if(!this.dirs[path]) {
        console.log("DirectoryMonitor watching dir " + path);

        this.scanDir(path); //async, don't care when it finishes

        return this.createMonitor(path);
    } else {
        return when.resolve(true);
    }
}

DirectoryMonitor.prototype.unhookWatch = function(path) {
    var watcher = this.dirs[path];
    if(watcher) {
        delete this.dirs[path];
        watcher.unhook();
    }
    return when.resolve(true);
}


// called when the dirdb gets a new dir
DirectoryMonitor.prototype._on_dirdb_dir_add = function(path) {
    console.log("received dir_add");
    this.setupWatch(path);
}

// called when the dirdb removes a dir
DirectoryMonitor.prototype._on_dirdb_dir_delete = function(path) {
    this.unhookWatch(path);
}

DirectoryMonitor.prototype._on_dirdb_file_add = function(path, stat) {
    this.emit('file_add', path, stat)
}
DirectoryMonitor.prototype._on_dirdb_file_delete = function(path) {
    this.emit('file_delete', path);
}
DirectoryMonitor.prototype._on_dirdb_file_change = function(path, stat) {
    this.emit('file_change', path, stat)
}

module.exports = DirectoryMonitor;

/*

this relies on watch, which is pretty simple, but i think i'm going to have to rewrite watch:
1) it dies if i try to watch all of \\datahole\music
2) it doesn't seem to hook watchers to newly-created directories, which is pretty lame

Also, it seems to attach watchers to every file, which I think is overkill.  If we
watched every directory in the tree, we'd know when the child files changed and could stat
them.  This would reduce the number of watchers by an order of magnitude.

*/
