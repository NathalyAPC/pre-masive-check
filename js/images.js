/**
 * Comprueba que los enlaces de imagen carguen.
 *
 * En el navegador abre cada enlace como una imagen (igual que lo haría la tienda)
 * y espera a que cargue o falle. No descarga nada al disco ni envía el CSV a
 * ningún lado: solo pide cada imagen a su servidor.
 *
 * Funciona en el navegador (window.ImageCheck) y en Node (require) para las
 * pruebas, donde se le pasa un "loader" de mentira.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImageCheck = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    concurrency: 6,     // imágenes que se abren a la vez
    timeoutMs: 15000    // tiempo máximo de espera por imagen
  };

  /**
   * Abre una imagen en el navegador. Resuelve con null si carga,
   * o con la descripción del problema si no.
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
      // El navegador no dice el motivo exacto: puede ser que no exista (404),
      // que el enlace no sea una imagen o que el servidor la bloquee.
      img.onerror = function () {
        finish('no carga (no existe, no es una imagen o el servidor la bloquea)');
      };
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    });
  }

  /**
   * Comprueba una lista de enlaces y devuelve una Promise con un
   * Map { enlace → problema o null }.
   *
   * options:
   *   loader(url, timeoutMs)  función que abre un enlace (por defecto, el navegador)
   *   concurrency, timeoutMs  ver DEFAULTS
   *   onProgress(hechas, total)
   *   isCancelled()           devuelve true para detener la verificación
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
