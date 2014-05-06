var when = require('when');
var util = require('util');
var events = require('events');

function ConcurrencyLimiter(maxCount) {
    this.maxCount = maxCount || 5;
    this.queue = [];
    this.currentCount = 0;
    events.EventEmitter.call(this);
}
util.inherits(ConcurrencyLimiter, events.EventEmitter);

ConcurrencyLimiter.prototype.do = function(fn) {
    var d = when.defer();

    this.queue.push({ deferred: d, fn: fn });
    this.checkForWork();

    return d.promise;
}

ConcurrencyLimiter.prototype.drain = function() {
    var promise = when.all(this.queue.map(function(qitem) { return qitem.deferred.promise; }));
    this.checkForWork();
    return promise;
}

ConcurrencyLimiter.prototype.checkForWork = function() {
    var self = this;
    if(this.currentCount >= this.maxCount) {
        self.emit('throttling');
        return;
    }

    var work = this.queue.shift();
    if(work) {
        var self = this;
        var doit = function() {
            self.process(work.fn, work.deferred);
        }
        if(this.slow) {
            setTimeout(doit, 200);
        } else {
            doit();
        }
    }
}

ConcurrencyLimiter.prototype.process = function(fn, deferred) {
    var self = this;
    self.currentCount++;
    function finished() {
        self.currentCount--;
        self.checkForWork();
    }
    fn().then(function(result) {
        finished();
        deferred.resolve(result);
    }).catch(function(err) {
        finished();
        deferred.reject(err);
    });
}

module.exports = ConcurrencyLimiter;
