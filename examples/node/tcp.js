var net = require('net');

module.exports = {
  createServer: createServer,
  connect: connect
};

function createServer(port, address, onConnection) {
  if (typeof address === "function" && typeof onConnection === "undefined") {
    onConnection = address;
    address = "127.0.0.1";
  }
  if (typeof port !== "number") throw new TypeError("port must be number");
  if (typeof address !== "string") throw new TypeError("address must be string");
  if (typeof onConnection !== "function") throw new TypeError("onConnection must be function");

  var server = net.createServer();
  server.listen(port, address);
  server.on("connection", function (stream) {
    onConnection(wrapStream(stream));
  });
  return server;
}

function connect(port, address, callback) {
  if (typeof address === "function" && typeof callback === "undefined") {
    callback = address;
    address = "127.0.0.1";
  }
  if (!callback) return connect.bind(this, port, address);
  if (typeof port !== "number") throw new TypeError("port must be number");
  if (typeof address !== "string") throw new TypeError("address must be string");
  if (typeof callback !== "function") throw new TypeError("callback must be function");

  var stream = net.connect(port, address);

  stream.on("error", finish);
  stream.on("connect", onConnect);

  var done = false;
  function finish(err, socket) {
    if (done) return;
    done = true;
    stream.removeListener("error", finish);
    stream.removeListener("connect", onConnect);
    callback(err, socket);
  }

  function onConnect() {
    finish(null, wrapStream(stream));
  }

  return stream;
}

function wrapStream(stream) {
  var out;
  if (stream.readable) {
    out = streamToSource(stream);
  }
  else {
    out = {};
  }
  if (stream.writable) {
    out.sink = streamToSink(stream);
  }
  return out;
}

function streamToSource(stream) {
  var dataQueue = [];
  var emit = null;

  stream.on('error', function (err) {
    dataQueue.push([err]);
    check();
  });

  stream.on('end', function () {
    dataQueue.push([]);
    check();
  });

  stream.on('readable', function () {
    var data = false;
    var chunk;
    while (chunk = stream.read()) {
      data = true;
      dataQueue.push([null, chunk]);
    }
    if (data) check();
  });

  function check() {
    if (emit && dataQueue.length) {
      var callback = emit;
      emit = null;
      callback.apply(null, dataQueue.shift());
    }

    if (dataQueue.length && !emit) {
      stream.pause();
    }
    else if (!dataQueue.length && emit) {
      stream.resume();
    }
  }

  return { read: streamRead, abort: streamAbort };

  function streamRead(callback) {
    if (dataQueue.length) {
      return callback.apply(null, dataQueue.shift());
    }
    if (emit) return new Error("Only one read at a time allowed.");
    emit = callback;
    check();
  }

  function streamAbort(callback) {
    stream.destroy();
    stream.on('close', callback);
  }

}

function streamToSink(writable) {
  return streamSink;
  function streamSink(stream, callback) {
    if (!callback) return streamSink.bind(this, stream);
    var sync;

    writable.on("drain", start);

    start();

    function start() {
      do {
        sync = undefined;
        stream.read(onRead);
        if (sync === undefined) sync = false;
      } while (sync);
    }

    function onRead(err, chunk) {
      if (chunk === undefined) {
        writable.end();
        writable.once("close", function () {
          callback(err);
        });
        return;
      }
      if (writable.write(chunk)){
        if (sync === undefined) sync = true;
        else start();
      }
    }
  }
}
