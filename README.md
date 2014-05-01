DirectoryMonitor
================
DirectoryMonitor is a utility which allows you to set up a monitor of a
directory or set of directories and receive events whenever things in
that directory change.

The primary difference between DirectoryMonitor and other similar tools
such as [watch](https://www.npmjs.org/package/node-watch) is that
DirectoryMonitor persists its state (in a SQLite database) so that it can
send events about changes to the filesystem since the last time it ran,
and so that the start-time scan of a directory is extremely fast if it
has been scanned before. This makes it suitable as the basis for a
process which needs to monitor a directory continuously across multiple
runs.

Another difference is that it is intended that DirectoryMonitor will
gracefully handle a directory going offline, meaning it can be used
to monitor directories that may reside on remote media such as a NAS
without freaking out and sending "deleted" events for every single
file on a remote server because you disconnected from the network.
(note: this functionality is tbd)

Usage
-----

    var DirectoryMonitor = require('./lib/directorymonitor.js'); /* fixme: hey, shouldn't this be an npm module? */

Instantiate with a path to a SQLite database for storing state.
The database will be created and initialized if it does not exist.

    dm = new DirectoryMonitor('testdm.db');

    dm.on('file_add', function(path, stat) { /* a new file appeared */ });
    dm.on('file_delete', function(path) { /* a file was deleted */ });
    dm.on('file_change', function(path, stat) { /* a file was modified */ });

add a directory to be watched:

    dm.addDir('/Volumes/music');

start the watchin':

    dm.start();

Note that once you `addDir` a directory, it will be persisted to the database,
and the next time you fire up a new DirectoryMonitor from that same database,
you will not need to `addDir` again.

How it works
------------
DirectoryMonitor keeps a sqlite database containing MD5 hashes of the result
of `fs.stat` for each file.  When it starts up, it does a full scan of the
directories of interest and does an `fs.stat` on each file.  It then checks to
see if the file is known and if the hash of the `fs.stat` result has changed.
If it's not known, or if the stat has changed, a `file_add` or `file_change`
event is generated.  After the initial scan, filesystem events are used to
determine when changes occur and the appropriate events are generated.

In addition to storing each file's path within its watched parent
directory (aka the "subpath"), the files table also stores the MD5 hash of
that subpath.  Thus, in order to look up a file by path, the query looks
like:

        SELECT <fields> FROM files WHERE subpath_hash = <hash>
            AND subpath = <subpath>
Since there is an index on subpath_hash, this query looks at very few
rows.


TBD
---
* **BUG:** handle file disappearance while DirectoryMonitor is not running (mark/sweep
    the file table so that after initial scan, unseen files are called deleted)
* **Not implemented:** handle directory disappearance ("offline" events)
* investigate possiblity of only monitoring directories instead of using `watch`
to monitor every file in the directory tree.
* emit file_delete events when removeDir() is called?  Not actually sure about
this one.  You're indicating your disinterest in a directory.  Do you care that
all of its file entries were removed from the db?
* would it make sense to allow the caller to provide the SQLite database?
Some apps will already have their own database for app-specific stuff; would it
be better if we could use that rather than creating our own?
