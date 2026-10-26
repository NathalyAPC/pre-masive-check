/**
 * UI: reads the file, runs the checks and renders the result.
 * Depends on csv.js (CsvParser), checks.js (Checks) and images.js (ImageCheck).
 */
(function () {
  'use strict';

  var MAX_VISIBLE = 100; // items per check before "Mostrar los restantes" (show the rest)

  var GROUPS = [
    { level: 'error', title: 'Errores', subtitle: 'La carga los rechaza o los carga distinto de lo esperado, o falta un dato obligatorio para el negocio. Corrígelos antes de subir el archivo.' },
    { level: 'aviso', title: 'Avisos', subtitle: 'La carga los acepta, pero conviene revisarlos.' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var out = $('out');
  var errorBox = $('error');
  var dropZone = $('drop');
  var branchesBox = $('multiBranch');

  // Each new analysis cancels the previous image check.
  var currentRun = 0;
  // Last checked file, to re-run the analysis when the branches checkbox changes.
  var last = null;
  // Result of every URL already opened in this session (url → problem or null).
  var imageCache = new Map();

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) node.append(arguments[i]);
    return node;
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /** Writes the title with repeated words highlighted (without innerHTML). */
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
      } catch (e) { /* selection not available */ }
      flash('Selecciona y pulsa Ctrl+C');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash('Copiado'); }, selectInstead);
    } else {
      selectInstead();
    }
  }

  /* ---------- Rendering the result ---------- */

  function statusPill(check) {
    var count = check.items.length;
    if (check.status === 'verifying') return el('span', { class: 'pill wait' }, 'Verificando…');
    if (check.level === 'error') return el('span', { class: 'pill bad' }, count + ' por corregir');
    return el('span', { class: 'pill warn' }, count + ' por revisar');
  }

  function renderCheck(check) {
    var count = check.items.length;
    var section = el('section', { class: 'check level-' + check.level, 'data-check': check.key });
    var meta = el('div', { class: 'meta' }, statusPill(check));
    section.append(el('header', null,
      el('div', null, el('h3', null, check.title), el('p', { class: 'hint' }, check.hint)),
      meta));

    if (check.notice) section.append(el('p', { class: 'callout' }, check.notice));

    if (!count) {
      section.append(el('div', { class: 'spacer' }));
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

  /** Checks with nothing to show, grouped in one compact card. */
  function renderClean(checks) {
    var list = el('ul', { class: 'clean-list' });
    var isSkipped = function (c) { return !!(c.skipped || c.status === 'skipped'); };
    checks = checks.filter(function (c) { return !isSkipped(c); }).concat(checks.filter(isSkipped));
    checks.forEach(function (c) {
      if (c.skipped || c.status === 'skipped') {
        list.append(el('li', { class: 'skipped' }, el('span', { class: 'mark-icon' }, '–'),
          el('span', null, el('strong', null, c.title), ' · No revisado: ' + (c.skipped || c.notice))));
      } else {
        list.append(el('li', null, el('span', { class: 'mark-icon' }, '✓'), el('span', null, c.title)));
      }
    });
    return el('section', { class: 'check clean' },
      el('header', null, el('div', null, el('h3', null, 'Sin problemas'),
        el('p', { class: 'hint' }, 'Estas revisiones no encontraron nada.'))),
      list);
  }

  function needsAttention(c) {
    return c.items.length > 0 || c.status === 'verifying';
  }

  function render(result, fileName) {
    if (result.error) { showError(result.error); return; }
    out.replaceChildren();
    errorBox.hidden = true;

    var count = function (level) {
      return result.checks.filter(function (c) { return c.level === level; })
        .reduce(function (sum, c) { return sum + c.items.length; }, 0);
    };
    var errors = count('error');
    var warnings = count('aviso');
    var verifying = result.checks.some(function (c) { return c.status === 'verifying'; });

    var stat = function (value, label, state) {
      return el('div', { class: 'stat' + (state ? ' is-' + state : '') }, el('b', null, String(value)), el('span', null, label));
    };
    var head = el('div', { class: 'summary-file' },
      el('span', { class: 'file' }, fileName),
      el('span', { class: 'count' }, plural(result.stats.rows, 'fila', 'filas')));
    if (!errors && !warnings && !verifying) head.append(el('span', { class: 'pill ok' }, 'Todo en orden'));
    if (verifying) head.append(el('span', { class: 'pill wait' }, 'Verificando imágenes…'));
    out.append(el('div', { class: 'summary' }, head,
      el('div', { class: 'stats' },
        stat(result.stats.products, result.stats.products === 1 ? 'producto' : 'productos'),
        stat(errors, errors === 1 ? 'error' : 'errores', errors ? 'bad' : 'ok'),
        stat(warnings, warnings === 1 ? 'aviso' : 'avisos', warnings ? 'warn' : 'ok'))));

    GROUPS.forEach(function (g) {
      var checks = result.checks.filter(function (c) { return c.level === g.level && needsAttention(c); });
      if (!checks.length) return;
      out.append(el('div', { class: 'group-head level-' + g.level }, el('h2', null, g.title), el('p', null, g.subtitle)));
      checks.forEach(function (c) { out.append(renderCheck(c)); });
    });

    var clean = result.checks.filter(function (c) { return !needsAttention(c); });
    if (clean.length) out.append(renderClean(clean));

    $('dropTitle').textContent = 'Arrastra otro CSV para revisarlo de nuevo';
  }

  /* ---------- Images ---------- */

  /** Merges what is known about each URL and updates the image check. */
  function finishImages(check, targets, urls) {
    var failed = Checks.imageLoadItems(targets, imageCache);
    var failedUrls = urls.filter(function (u) { return imageCache.get(u); }).length;
    check.items = check.items.concat(failed);
    check.status = null;
    var summary = failedUrls && failedUrls === urls.length
      ? 'No cargó ninguna imagen. Revisa tu conexión a internet; si funciona, puede que el servidor de las imágenes las esté bloqueando.'
      : 'Se abrieron ' + plural(urls.length, 'URL distinta', 'URLs distintas') +
        (failedUrls ? '; ' + failedUrls + ' no cargan.' : ' y todas cargan.');
    check.notice = summary + (check.baseNotice ? ' ' + check.baseNotice : '');
  }

  /** Opens the image URLs not checked yet and updates the result when done. */
  function verifyImages(result, fileName, runId) {
    var check = result.checks.find(function (c) { return c.pending; });
    if (!check) return;
    var targets = check.pending;
    var urls = targets.map(function (t) { return t.url; });
    check.baseNotice = check.notice;
    if (!urls.length) return;

    var toOpen = urls.filter(function (u) { return !imageCache.has(u); });
    if (!toOpen.length) { finishImages(check, targets, urls); return; }

    if (navigator.onLine === false) {
      check.status = 'skipped';
      check.notice = 'no hay conexión a internet. Conéctate y vuelve a subir el archivo.';
      return;
    }

    check.status = 'verifying';
    check.notice = 'Abriendo ' + plural(toOpen.length, 'URL distinta', 'URLs distintas') + '…' + (check.baseNotice ? ' ' + check.baseNotice : '');

    ImageCheck.verify(toOpen, {
      isCancelled: function () { return runId !== currentRun; },
      onProgress: function (done, total) {
        if (runId !== currentRun) return;
        var pill = out.querySelector('[data-check="' + check.key + '"] .pill');
        if (pill) pill.textContent = 'Verificando ' + done + ' de ' + total;
      }
    }).then(function (results) {
      results.forEach(function (problem, url) { imageCache.set(url, problem); });
      if (runId !== currentRun) return;
      finishImages(check, targets, urls);
      render(result, fileName);
    });
  }

  /* ---------- Analysis ---------- */

  function run(text, file) {
    last = { text: text, file: file };
    var runId = ++currentRun;
    var result;
    try {
      result = Checks.analyze(CsvParser.parseCSV(text), { file: file, multipleBranches: branchesBox.checked });
    } catch (e) {
      console.error(e);
      result = { error: 'No pude leer el archivo. Revisa que sea un CSV de texto.' };
    }

    if (!result.error) verifyImages(result, file.name, runId);
    render(result, file.name);
  }

  function handleFile(file) {
    if (!file) return;
    if (/\.(xlsx|xls|xlsm|numbers)$/i.test(file.name)) {
      currentRun++;
      last = null;
      showError('Ese archivo es de Excel. Ábrelo en Excel y usa Archivo → Guardar como → CSV UTF-8, y sube el CSV.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      run(CsvParser.decode(reader.result), { name: file.name, size: file.size });
    };
    reader.onerror = function () { showError('No pude abrir el archivo.'); };
    reader.readAsArrayBuffer(file);
  }

  $('file').addEventListener('change', function (e) {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });
  branchesBox.addEventListener('change', function () {
    if (last) run(last.text, last.file);
  });
  ['dragenter', 'dragover'].forEach(function (t) {
    dropZone.addEventListener(t, function (e) { e.preventDefault(); dropZone.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    dropZone.addEventListener(t, function (e) { e.preventDefault(); dropZone.classList.remove('over'); });
  });
  dropZone.addEventListener('drop', function (e) { handleFile(e.dataTransfer.files[0]); });
  // Keeps the browser from opening the file when it is dropped outside the zone.
  ['dragover', 'drop'].forEach(function (t) {
    window.addEventListener(t, function (e) { e.preventDefault(); });
  });

})();
