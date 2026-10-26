/**
 * Interfaz: lee el archivo, corre las revisiones y muestra el resultado.
 * Depende de csv.js (CsvParser), checks.js (Checks), images.js (ImageCheck)
 * y sample.js (SAMPLE_CSV).
 */
(function () {
  'use strict';

  var MAX_VISIBLE = 100; // elementos por revisión antes de "Mostrar los restantes"

  var $ = function (id) { return document.getElementById(id); };
  var out = $('out');
  var errorBox = $('error');
  var exampleBanner = $('banner');
  var dropZone = $('drop');

  // Cada archivo nuevo cancela la verificación de imágenes del anterior.
  var currentRun = 0;

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) node.append(arguments[i]);
    return node;
  }

  /** Escribe el título resaltando las palabras repetidas (sin usar innerHTML). */
  function markRepeated(text, repeated) {
    var frag = document.createDocumentFragment();
    var last = 0;
    for (var m of text.matchAll(Checks.WORD_PATTERN)) {
      if (!repeated.has(Checks.normText(m[0]))) continue;
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(el('mark', null, m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }

  function showError(message) {
    out.replaceChildren();
    exampleBanner.hidden = true;
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function copyList(check, button, list) {
    var text = check.items.map(function (it) {
      return it.ids.join(', ') + ' – ' + it.text + (it.note ? ' (' + it.note + ')' : '');
    }).join('\n');
    var flash = function (msg) {
      button.textContent = msg;
      setTimeout(function () { button.textContent = 'Copiar lista'; }, 2200);
    };
    var selectInstead = function () {
      try {
        var range = document.createRange();
        range.selectNodeContents(list);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) { /* sin selección disponible */ }
      flash('Selecciona y pulsa Ctrl+C');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash('Copiado'); }, selectInstead);
    } else {
      selectInstead();
    }
  }

  /** Estado de una revisión: "Todo bien", "N por revisar" o "Verificando…". */
  function statusPill(check) {
    var count = check.items.length;
    if (check.status === 'verifying') return el('span', { class: 'pill wait' }, 'Verificando…');
    if (check.status === 'skipped' && !count) return el('span', { class: 'pill wait' }, 'No verificado');
    return el('span', { class: 'pill ' + (count ? 'bad' : 'ok') }, count ? count + ' por revisar' : 'Todo bien');
  }

  function renderCheck(check) {
    var count = check.items.length;
    var section = el('section', { class: 'check', 'data-check': check.key });
    var meta = el('div', { class: 'meta' }, statusPill(check));
    section.append(el('header', null,
      el('div', null, el('h2', null, check.title), el('p', { class: 'hint' }, check.hint)),
      meta));

    if (check.notice) section.append(el('p', { class: 'callout' }, check.notice));

    if (!count) {
      if (check.status !== 'verifying') section.append(el('p', { class: 'none' }, 'Ninguno con este problema.'));
      else section.append(el('div', { class: 'spacer' }));
      return section;
    }

    var list = el('ul', { class: 'items' });
    var copyButton = el('button', { type: 'button', class: 'copy' }, 'Copiar lista');
    copyButton.addEventListener('click', function () { copyList(check, copyButton, list); });
    meta.append(copyButton);

    var addItems = function (from, to) {
      check.items.slice(from, to).forEach(function (it) {
        var li = el('li', null,
          el('span', { class: 'ids' }, it.ids.join(' · ')),
          el('span', { class: 'txt' }, it.rep ? markRepeated(it.text, it.rep) : it.text));
        if (it.note) li.append(el('div', { class: 'note' }, it.note));
        list.append(li);
      });
    };
    addItems(0, MAX_VISIBLE);
    section.append(list);

    if (count > MAX_VISIBLE) {
      var more = el('button', { type: 'button', class: 'more' }, 'Mostrar los ' + (count - MAX_VISIBLE) + ' restantes');
      more.addEventListener('click', function () { addItems(MAX_VISIBLE, count); more.remove(); });
      section.append(more);
    } else {
      section.append(el('div', { class: 'spacer' }));
    }
    return section;
  }

  function render(result, fileName, isExample) {
    if (result.error) { showError(result.error); return; }
    out.replaceChildren();
    errorBox.hidden = true;
    exampleBanner.hidden = !isExample;

    var verifying = result.checks.some(function (c) { return c.status === 'verifying'; });
    var total = result.checks.reduce(function (sum, c) { return sum + c.items.length; }, 0);
    var summaryPill = verifying
      ? el('span', { class: 'pill wait' }, 'Verificando imágenes…')
      : el('span', { class: 'pill ' + (total ? 'bad' : 'ok') }, total ? total + ' cosas por revisar' : 'Todo en orden');
    out.append(el('div', { class: 'summary' },
      el('div', null,
        el('div', { class: 'file' }, fileName),
        el('div', { class: 'count' }, result.stats.products + ' productos · ' + result.stats.rows + ' filas')),
      summaryPill));
    result.checks.forEach(function (c) { out.append(renderCheck(c)); });

    if (!isExample) $('dropTitle').textContent = 'Arrastra otro CSV para revisarlo de nuevo';
  }

  /** Abre los enlaces de imagen y actualiza la revisión al terminar. */
  function verifyImages(result, fileName, runId) {
    var check = result.checks.find(function (c) { return c.pending; });
    if (!check) return;
    var targets = check.pending;
    var urls = targets.map(function (t) { return t.url; });

    if (!urls.length) { check.status = null; return; }
    if (navigator.onLine === false) {
      check.status = 'skipped';
      check.notice = 'Sin conexión a internet: no se pudieron abrir los enlaces. Conéctate y vuelve a subir el archivo.';
      return;
    }

    check.status = 'verifying';
    check.notice = 'Abriendo ' + urls.length + (urls.length === 1 ? ' enlace distinto…' : ' enlaces distintos…');

    ImageCheck.verify(urls, {
      isCancelled: function () { return runId !== currentRun; },
      onProgress: function (done, total) {
        if (runId !== currentRun) return;
        var pill = out.querySelector('[data-check="' + check.key + '"] .pill');
        if (pill) pill.textContent = 'Verificando ' + done + ' de ' + total;
      }
    }).then(function (results) {
      if (runId !== currentRun) return;
      var failed = Checks.imageLoadItems(targets, results);
      var failedUrls = urls.filter(function (u) { return results.get(u); }).length;
      check.items = check.items.concat(failed);
      check.status = null;
      check.notice = failedUrls && failedUrls === urls.length
        ? 'No cargó ninguna imagen. Revisa tu conexión a internet; si funciona, puede que el servidor de las imágenes las esté bloqueando.'
        : 'Se abrieron ' + urls.length + (urls.length === 1 ? ' enlace distinto' : ' enlaces distintos') +
          (failedUrls ? '; ' + failedUrls + ' no cargan.' : ' y todos cargan.');
      render(result, fileName, false);
    });
  }

  function run(text, fileName, isExample) {
    var runId = ++currentRun;
    var result;
    try {
      result = Checks.analyze(CsvParser.parseCSV(text));
    } catch (e) {
      console.error(e);
      result = { error: 'No pude leer el archivo. Revisa que sea un CSV de texto.' };
    }

    if (!result.error) {
      var imageCheck = result.checks.find(function (c) { return c.pending; });
      if (imageCheck && isExample) {
        imageCheck.status = 'skipped';
        imageCheck.notice = 'En el ejemplo solo se revisa que los enlaces estén bien escritos. Con tu archivo se abre cada enlace.';
      } else if (imageCheck) {
        verifyImages(result, fileName, runId);
      }
    }
    render(result, fileName, isExample);
  }

  function handleFile(file) {
    if (!file) return;
    if (/\.(xlsx|xls|xlsm|numbers)$/i.test(file.name)) {
      currentRun++;
      showError('Ese archivo es de Excel. Ábrelo en Excel y usa Archivo → Guardar como → CSV UTF-8, y sube el CSV.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { run(CsvParser.decode(reader.result), file.name, false); };
    reader.onerror = function () { showError('No pude abrir el archivo.'); };
    reader.readAsArrayBuffer(file);
  }

  $('file').addEventListener('change', function (e) {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (t) {
    dropZone.addEventListener(t, function (e) { e.preventDefault(); dropZone.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    dropZone.addEventListener(t, function (e) { e.preventDefault(); dropZone.classList.remove('over'); });
  });
  dropZone.addEventListener('drop', function (e) { handleFile(e.dataTransfer.files[0]); });
  // Evita que el navegador abra el archivo si se suelta fuera de la zona.
  ['dragover', 'drop'].forEach(function (t) {
    window.addEventListener(t, function (e) { e.preventDefault(); });
  });

  run(window.SAMPLE_CSV, 'ejemplo.csv', true);
})();
