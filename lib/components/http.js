'use strict';

var express = require('express');
var http = require('http');
var https = require('https');
var path = require('path');
var fs = require('fs');
var assert = require('assert');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

module.exports = function (app, opts) {
    return new Http(app, opts);
};

var DEFAULT_HOST = '127.0.0.1';
var DEFAULT_PORT = 3001;

var createExpressLogger = function (logger) {
    return express.logger({
        format: 'short',
        stream: {
            write: function (str) {
                logger.debug(str);
            }
        },
    })
};

var defaultLogger = function () {
    return {
        debug: console.log,
        info: console.log,
        warn: console.warn,
        error: console.error,
    }
}

var readdirSync = function(dir, callback) {
    fs.readdirSync(dir).forEach(function (file) {
        var pathname = path.join(dir, file);

        if (fs.statSync(pathname).isDirectory()) {
            readdirSync(pathname, callback);
        } else {
            callback(pathname, file);
        }
    });
}

var Http = function (app, opts) {
    opts = opts || {};
    this.app = app;
    this.http = express();
    // self.logger.info('Http opts:', opts);
    this.host = opts.host || DEFAULT_HOST;
    this.port = opts.port || DEFAULT_PORT;

    if (!!opts.isCluster) {
        var serverId = app.getServerId();
        var params = serverId.split('-');
        var idx = parseInt(params[params.length - 1], 10);
        if (/\d+\+\+/.test(this.port)) {

            this.port = parseInt(this.port.substr(0, this.port.length - 2));
        } else {
            assert.ok(false, 'http cluster expect http port format like "3000++"');
        }

        this.port = this.port + idx;
    }

    this.useSSL = !!opts.useSSL;
    this.sslOpts = {};
    if (this.useSSL) {
        this.sslOpts.key = fs.readFileSync(path.join(app.getBase(), opts.keyFile));
        this.sslOpts.cert = fs.readFileSync(path.join(app.getBase(), opts.certFile));
    }

    this.logger = opts.logger || defaultLogger();

    //this.http.set('port', this.port);
    //this.http.set('host', this.host);
    //this.http.use(createExpressLogger(this.logger));
    //this.http.use(express.bodyParser());
    //this.http.use(express.urlencoded());
    //this.http.use(express.json());
    //this.http.use(express.methodOverride());
    //this.http.use(this.http.router);
    
    this.http.set('port', this.port);
    this.http.set('host', this.host);
    this.http.use(logger('dev'));
    this.http.use(bodyParser.json());
    this.http.use(bodyParser.urlencoded({ extended: false }));
    this.http.use(cookieParser());
    
    // catch 404 and forward to error handler
    // this.http.use(function(req, res, next) {
    //     var err = new Error('Not Found');
    //     err.status = 404;
    //     next(err);
    // });
    //
    // // error handler
    // this.http.use(function(err, req, res, next) {
    //     // set locals, only providing error in development
    //     res.locals.message = err.message;
    //     res.locals.error = req.app.get('env') === 'development' ? err : {};
    //
    //     // render the error page
    //     res.status(err.status || 500);
    //     res.render('error');
    // });

    var self = this;
    this.app.configure(function () {
        //self.http.use(express.errorHandler());
    });


    this.beforeFilters = require('../../index').beforeFilters;
    this.afterFilters = require('../../index').afterFilters;
    this.server = null;
};

Http.prototype.loadRoutes = function () {
    this.http.get('/', function (req, res) {
        res.send('server ok!');
    });

    var routesPath = path.join(this.app.getBase(), 'app/servers', this.app.getServerType(), 'route');
    // self.logger.info(routesPath);
    assert.ok(fs.existsSync(routesPath), 'Cannot find route path: ' + routesPath);

    // console.log("----------routePath" + routesPath);

    var self = this;
    readdirSync(routesPath, function (pathname, file) {
        // console.log("----------pathname:" + pathname + ",file:" + file);
        if (/.js$/.test(file)) {
            require(pathname)(self.app, self.http, self);
        }
    });

    // fs.readdirSync(routesPath).forEach(function (file) {
    //     if (/.js$/.test(file)) {
    //         var routePath = path.join(routesPath, file);
    //         // self.logger.info(routePath);
    //         require(routePath)(self.app, self.http, self);
    //     }
    // });
}

Http.prototype.start = function (cb) {
    var self = this;

    this.beforeFilters.forEach(function (elem) {
        self.http.use(elem);
    });

    this.loadRoutes();

    this.afterFilters.forEach(function (elem) {
        self.http.use(elem);
    });

    if (this.useSSL) {
        this.server = https.createServer(this.sslOpts, this.http).listen(this.port, function () {
            self.logger.info('Http start', self.app.getServerId(), 'url: https://' + self.host + ':' + self.port);
            self.logger.info('Http start success');
            process.nextTick(cb);
        });
    } else {
        this.server = http.createServer(this.http).listen(this.port, function () {
            self.logger.info('Http start', self.app.getServerId(), 'url: http://' + self.host + ':' + self.port);
            self.logger.info('Http start success');
            process.nextTick(cb);
        });
    }
}

Http.prototype.afterStart = function (cb) {
    this.logger.info('Http afterStart');
    process.nextTick(cb);
}

Http.prototype.stop = function (force, cb) {
    var self = this;
    this.server.close(function () {
        self.logger.info('Http stop');
        cb();
    });
}