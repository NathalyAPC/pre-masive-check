/**
 * Checks that image links load.
 *
 * In the browser it opens each link as an image (just like the store would)
 * and waits for it to load or fail. It saves nothing to disk and never sends
 * the CSV anywhere: it only requests each image from its own server.
 *
 * Works in the browser (window.ImageCheck) and in Node (require) for the
 * tests, which pass in a fake "loader".
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImageCheck = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    concurrency: 6,     // images opened at the same time
    timeoutMs: 15000    // max wait time per image
  };

  /**
   * Opens an image in the browser. Resolves with null if it loads,
   * or with a description of the problem if it doesn't.
   */
  function browserLoader(url, timeoutMs) {
    return new Promise(function (resolve) {
      var img = new Image();
      var finished = false;
      var timer = setTimeout(function () {
        finish('tardó más de ' + Math.round(timeoutMs / 1000) + ' s en responder');
      }, timeoutMs);

      function finish(problem) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        img.onload = img.onerror = null;
        resolve(problem);
      }

      img.onload = function () {
        finish(img.naturalWidth > 0 ? null : 'está vacía');
      };
      // The browser doesn't say why: it may not exist (404),
      // the link may not be an image, or the server may block it.
      img.onerror = function () {
        finish('no carga (no existe, no es una imagen o el servidor la bloquea)');
      };
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    });
  }

  /**
   * Checks a list of links and returns a Promise with a
   * Map { link → problem or null }.
   *
   * options:
   *   loader(url, timeoutMs)  function that opens a link (the browser by default)
   *   concurrency, timeoutMs  see DEFAULTS
   *   onProgress(done, total)
   *   isCancelled()           returns true to stop checking
   */
  function verify(urls, options) {
    options = options || {};
    var loader = options.loader || browserLoader;
    var concurrency = options.concurrency || DEFAULTS.concurrency;
    var timeoutMs = options.timeoutMs || DEFAULTS.timeoutMs;
    var results = new Map();
    var next = 0;
    var done = 0;

    function worker() {
      if (next >= urls.length) return Promise.resolve();
      if (options.isCancelled && options.isCancelled()) return Promise.resolve();
      var url = urls[next++];
      return Promise.resolve(loader(url, timeoutMs))
        .catch(function () { return 'no se pudo comprobar'; })
        .then(function (problem) {
          results.set(url, problem);
          done++;
          if (options.onProgress) options.onProgress(done, urls.length);
          return worker();
        });
    }

    var workers = [];
    for (var i = 0; i < Math.min(concurrency, urls.length); i++) workers.push(worker());
    return Promise.all(workers).then(function () { return results; });
  }

  return { DEFAULTS: DEFAULTS, verify: verify, browserLoader: browserLoader };
});
