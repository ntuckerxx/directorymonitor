var DirectoryMonitor = require('./lib/directorymonitor.js');
dm = new DirectoryMonitor('testdm.db');

dm.on('file_add', function(path) {
    console.log("file added: " + path);
});
dm.on('file_delete', function(path) {
    console.log("file deleted: " + path);
});
dm.on('file_change', function(path) {
    console.log("file changed: " + path);
});
dm.start();

add = function(dir) {
    dm.addDir(dir).then(function(result){
        console.log("dir added: " + result);
    });
}

require('./lib/debugport.js')(3001);
