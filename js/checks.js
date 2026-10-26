/**
 * Catalog checks for the bulk upload.
 *
 * "error" level rules are the ones BE validates: if they fail, the upload
 * rejects the row or the product, or loads it differently than expected.
 * See docs/bulk-upload-criterios-aceptacion.md (the CA-x.y codes in the comments).
 * Data the business requires even if BE accepts it empty (the description) is
 * also an "error". "aviso" (warning) level rules are recommendations: the data
 * is uploaded, but it is worth reviewing.
 *
 * Each check is an object in the CHECKS list with:
 *   key, level ('error' | 'aviso'), title, hint
 *   run(catalog)            → list of { ids, text, note?, rep? }
 *   notice(catalog, items)  → general notice shown above the list (optional)
 *   pending(catalog)        → work the page finishes later (optional)
 *   skip(catalog)           → reason not to run the check, or null (optional)
 *
 * Works in the browser (window.Checks) and in Node (require) for the tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Checks = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- BE rules ---------- */

  var LIMITS = {
    fileMB: 50,            // CA-1: max CSV size
    maxImageUrls: 1500,    // CA-4.2: distinct URLs BE downloads per upload
    brandMaxLength: 120,   // brand: max characters
    priceMaxDecimals: 2    // CA-2.2: the price is not rounded
  };

  /** Required columns (CA-2): without them BE rejects the rows. */
  var REQUIRED_COLUMNS = ['name', 'price', 'weight_kg', 'width_cm', 'height_cm', 'length_cm'];

  /** Measurements required in the first row of each product (CA-2.4). */
  var DIMENSION_COLUMNS = ['weight_kg', 'width_cm', 'height_cm', 'length_cm'];


  /** Template columns. attr_{name} columns are also valid. */
  var KNOWN_COLUMNS = [
    'external_id', 'post_id', 'name', 'price', 'description', 'category_id', 'brand',
    'main_image', 'stock', 'variant_sku', 'external_variant_id', 'barcode',
    'requires_post_sale_action', 'branch_id'
  ].concat(DIMENSION_COLUMNS);

  /** Columns BE receives but ignores. */
  var IGNORED_COLUMNS = { condition: 'No se usa: todos los productos se cargan como nuevos.' };

  /** Valid extensions for images referenced by file name (CA-4.1). */
  var IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

  /** Accepted values for requires_post_sale_action (CA-3.4). */
  var POST_SALE_VALUES = ['si', 'sí', 'yes', 'true', '1', 'no', 'false', '0'];

  /** Characters allowed in brand: letters, digits, spaces and . , & ' + / ( ) ! - */
  var BRAND_CHAR = /[\p{L}\p{N} .,&'+\/()!-]/u;

  /* ---------- Repeated words ---------- */

  /**
   * Words that may repeat in a title without it being a mistake:
   * Spanish connectors and units of measure. Numbers are ignored too.
   */
  var IGNORED_WORDS = new Set((
    'de del la el los las para con y e o u en por a al un una x sin ' +
    'cm mm m mt mts ml l lt lts gb mb tb kg g gr grs w v hz mah pulgada pulgadas'
  ).split(' '));

  /**
   * A "word" is a run of letters and digits. Words joined by a slash
   * (220v/220v, Ce285a/Cf280x) count as one.
   */
  var WORD_PATTERN = /[\p{L}\p{N}]+(?:\/[\p{L}\p{N}]+)*/gu;

  /** Lowercase and without accents, to compare texts. */
  function normText(s) {
    return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  }

  /**
   * Returns the repeated words of a title as a Map
   * { normalized word → how it is written the first time }.
   */
  function repeatedWords(name) {
    var seen = new Map();
    var repeated = new Map();
    for (var m of String(name).matchAll(WORD_PATTERN)) {
      var word = normText(m[0]);
      if (word.length < 2 || /^\d+$/.test(word) || IGNORED_WORDS.has(word)) continue;
      if (seen.has(word)) {
        if (!repeated.has(word)) repeated.set(word, seen.get(word));
      } else {
        seen.set(word, m[0]);
      }
    }
    return repeated;
  }

  /* ---------- Numbers ---------- */

  /** Number with a dot or comma decimal separator, no sign and no thousands separator. */
  var NUMBER_PATTERN = /^\d+([.,]\d+)?$/;

  function toNumber(raw) {
    return Number(raw.replace(',', '.'));
  }

  /**
   * Price (CA-2.1 to CA-2.3): number ≥ 0, dot or comma decimal separator, at most
   * 2 decimals (not rounded) and no thousands separator. Returns null if valid.
   */
  function priceProblem(raw) {
    if (raw === '') return 'está vacío';
    if (/^-\d/.test(raw)) return 'es negativo ("' + raw + '")';
    if (/^\d{1,3}([.,]\d{3})+[.,]\d+$/.test(raw)) return 'usa separador de miles ("' + raw + '"); escríbelo sin él';
    if (!NUMBER_PATTERN.test(raw)) return 'no es un número ("' + raw + '")';
    var decimals = raw.split(/[.,]/)[1] || '';
    if (decimals.length > LIMITS.priceMaxDecimals) {
      return 'tiene más de ' + LIMITS.priceMaxDecimals + ' decimales ("' + raw + '"); no se redondea' +
        (decimals.length === 3 ? '. Si es un separador de miles, escríbelo sin él' : '');
    }
    return null;
  }

  /**
   * Measurement (CA-2.4, CA-2.6): number > 0, dot or comma decimal separator.
   * BE rounds to 2 decimals, so a value that rounds to 0 is also an error.
   */
  function measurementProblem(raw) {
    if (raw === '') return 'falta';
    if (/^-\d/.test(raw)) return 'es negativo ("' + raw + '")';
    if (!NUMBER_PATTERN.test(raw)) return 'no es un número ("' + raw + '")';
    var value = toNumber(raw);
    if (value === 0) return 'es 0';
    if (Math.round(value * 100) / 100 === 0) return 'se redondea a 0 ("' + raw + '"); solo se guardan 2 decimales';
    return null;
  }

  /** Stock, when present (CA-3): integer ≥ 0. */
  function stockProblem(raw) {
    if (/^-\d/.test(raw)) return 'es negativo ("' + raw + '")';
    if (/^\d+[.,]\d+$/.test(raw)) return 'debe ser un número entero ("' + raw + '")';
    if (!/^\d+$/.test(raw)) return 'no es un número ("' + raw + '")';
    return null;
  }

  /* ---------- Images ---------- */

  /** The images in a cell: there may be several, separated by commas. */
  function splitImages(cell) {
    return String(cell || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function isUrl(ref) {
    return /^https?:\/\//i.test(ref);
  }

  /**
   * Image reference (CA-4.1): absolute http(s) URL, or a file name from the
   * ZIP (no / or \) with a .jpg, .jpeg, .png, .gif or .webp extension.
   * Returns null if valid.
   */
  function imageRefProblem(ref) {
    if (isUrl(ref)) {
      if (/\s/.test(ref)) return 'tiene espacios';
      if (!/^https?:\/\/[^\s\/?#]+\.[^\s\/?#]+([\/?#]\S*)?$/i.test(ref)) return 'no es una URL válida';
      return null;
    }
    if (/[\/\\]/.test(ref)) return 'no es una URL http(s) ni un nombre de archivo (no puede llevar / ni \\)';
    var ext = (ref.match(/\.([a-z0-9]+)$/i) || [])[1];
    if (!ext || IMAGE_EXTENSIONS.indexOf(ext.toLowerCase()) < 0) {
      return 'no es una URL http(s) ni un nombre de archivo .' + IMAGE_EXTENSIONS.join(', .');
    }
    return null;
  }

  /**
   * Well-formed URLs to open to check that they load. Each URL is opened only
   * once even if several products use it. ZIP file names are not included.
   * Returns [{ url, products: [{ label, name }] }].
   */
  function imageTargets(catalog) {
    var byUrl = new Map();
    catalog.products.forEach(function (p) {
      p.rows.forEach(function (r) {
        splitImages(r.values.main_image).forEach(function (ref) {
          if (!isUrl(ref) || imageRefProblem(ref)) return;
          if (!byUrl.has(ref)) byUrl.set(ref, []);
          var list = byUrl.get(ref);
          if (!list.some(function (x) { return x.label === p.label; })) list.push({ label: p.label, name: p.name });
        });
      });
    });
    return Array.from(byUrl, function (entry) { return { url: entry[0], products: entry[1] }; });
  }

  /** ZIP file names referenced in main_image. */
  function zipImageRefs(catalog) {
    var refs = new Set();
    allRows(catalog).forEach(function (r) {
      splitImages(r.values.main_image).forEach(function (ref) {
        if (!isUrl(ref) && !imageRefProblem(ref)) refs.add(ref);
      });
    });
    return refs;
  }

  /**
   * Turns the result of opening the URLs (Map url → problem or null)
   * into items to display, one per product and URL that fails to load.
   */
  function imageLoadItems(targets, results) {
    var items = [];
    targets.forEach(function (t) {
      var problem = results.get(t.url);
      if (!problem) return;
      t.products.forEach(function (p) {
        items.push({ ids: [p.label], text: p.name || '(sin nombre)', note: 'La imagen ' + problem + ': ' + t.url });
      });
    });
    return items;
  }

  /* ---------- Description HTML ---------- */

  /** Tags that are never closed (void elements). */
  var VOID_TAGS = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));

  /** Tags that may be dangerous or break the store page. */
  var FORBIDDEN_TAGS = new Set('script style iframe frame frameset object embed form input button select textarea link meta base svg math'.split(' '));

  /** Formatting tags commonly used in a description. */
  var KNOWN_TAGS = new Set((
    'a abbr address article aside b bdi bdo big blockquote br caption center cite code col colgroup dd del details dfn div dl dt ' +
    'em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q s section small span ' +
    'strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var wbr'
  ).split(' '));

  /** Accepted named entities (lowercase). Numeric ones (&#39;) are always valid. */
  var KNOWN_ENTITIES = new Set((
    'nbsp amp lt gt quot apos copy reg trade hellip mdash ndash laquo raquo lsquo rsquo ldquo rdquo sbquo bdquo bull middot ' +
    'deg plusmn times divide frac12 frac14 frac34 sup1 sup2 sup3 micro para sect iexcl iquest ordf ordm euro cent pound yen ' +
    'aacute eacute iacute oacute uacute agrave egrave igrave ograve ugrave acirc ecirc icirc ocirc ucirc atilde otilde ' +
    'auml euml iuml ouml uuml yuml ntilde ccedil szlig shy thinsp ensp emsp zwnj zwj check cross larr rarr uarr darr hearts'
  ).split(' '));

  /** Well-formed tag: name and attributes, quoted or unquoted. */
  var TAG_PATTERN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;

  /** Does the description contain HTML (or escaped HTML)? */
  function looksLikeHtml(text) {
    return /<\/?[a-zA-Z][a-zA-Z0-9]*[\s>\/]/.test(text) || /&lt;\/?[a-zA-Z][a-zA-Z0-9]*(\s[^&]*)?&gt;/.test(text);
  }

  /**
   * Checks that the HTML of a description is well formed.
   * Returns a list of problems (empty if it is fine or has no HTML).
   */
  function htmlProblems(text) {
    text = String(text || '');
    var problems = [];
    var add = function (msg) { if (problems.indexOf(msg) < 0) problems.push(msg); };
    if (!looksLikeHtml(text)) return problems;

    if (/&lt;\/?[a-zA-Z][a-zA-Z0-9]*(\s[^&]*)?&gt;/.test(text)) {
      add('tiene etiquetas escapadas (como &lt;p&gt;): en la tienda se verán como texto');
    }

    var stack = [];
    var unclosed = new Map();
    var crossedLater = new Map(); // closing tags that will come late because of a crossed tag
    var i = 0;
    while (i < text.length) {
      var lt = text.indexOf('<', i);
      if (lt < 0) break;

      if (text.startsWith('<!--', lt)) {
        var endComment = text.indexOf('-->', lt + 4);
        if (endComment < 0) { add('tiene un comentario <!-- sin cerrar'); break; }
        i = endComment + 3;
        continue;
      }
      if (/^<!doctype/i.test(text.slice(lt, lt + 9))) { i = lt + 9; continue; }

      TAG_PATTERN.lastIndex = lt;
      var m = TAG_PATTERN.exec(text);
      if (!m) {
        var spaced = /^<\s+(\/?)([a-zA-Z][a-zA-Z0-9]*)\s*>/.exec(text.slice(lt, lt + 30));
        if (spaced && KNOWN_TAGS.has(spaced[2].toLowerCase())) {
          add('etiqueta mal escrita: "' + spaced[0] + '" (sobra el espacio después de <)');
          i = lt + spaced[0].length;
          continue;
        }
        // "<" followed by a letter or "/" looks like a tag, but it is malformed.
        if (/^<\/?[a-zA-Z]/.test(text.slice(lt, lt + 3)) || /^<\/\s*>/.test(text.slice(lt, lt + 4))) {
          var snippet = text.slice(lt, lt + 25).split('<')[1] || '';
          add('etiqueta mal escrita: "<' + snippet.replace(/\s+/g, ' ').slice(0, 20) + (snippet.length > 20 ? '…' : '') + '"');
        }
        i = lt + 1;
        continue;
      }
      i = TAG_PATTERN.lastIndex;

      var closing = m[1] === '/';
      var tag = m[2].toLowerCase();
      var attrs = m[3];
      var selfClosing = m[4] === '/';

      if (FORBIDDEN_TAGS.has(tag)) { add('etiqueta no permitida <' + tag + '>'); }
      else if (!KNOWN_TAGS.has(tag)) { add('etiqueta desconocida <' + tag + '>'); }
      if (/\son[a-z]+\s*=/i.test(attrs)) add('tiene atributos de script (onclick, onload…) en <' + tag + '>');
      if (/=\s*["']?\s*javascript:/i.test(attrs)) add('tiene un enlace javascript: en <' + tag + '>');

      if (VOID_TAGS.has(tag)) {
        if (closing) add('</' + tag + '> no existe: <' + tag + '> no se cierra');
        continue;
      }
      if (FORBIDDEN_TAGS.has(tag)) continue;
      if (!closing && selfClosing) { add('<' + tag + '/> no cierra la etiqueta: usa <' + tag + '></' + tag + '>'); continue; }

      if (!closing) { stack.push(tag); continue; }

      var pos = stack.lastIndexOf(tag);
      if (pos < 0) {
        if (crossedLater.get(tag)) { crossedLater.set(tag, crossedLater.get(tag) - 1); continue; }
        add('cierra </' + tag + '> sin haberla abierto');
        continue;
      }
      if (pos < stack.length - 1) {
        var crossed = stack.slice(pos + 1);
        add('etiquetas cruzadas: </' + tag + '> se cierra antes que <' + crossed.join('>, <') + '>');
        crossed.forEach(function (t) { crossedLater.set(t, (crossedLater.get(t) || 0) + 1); });
      }
      stack.length = pos;
    }

    stack.forEach(function (t) { unclosed.set(t, (unclosed.get(t) || 0) + 1); });
    unclosed.forEach(function (n, t) { add('<' + t + '> sin cerrar' + (n > 1 ? ' (' + n + ' veces)' : '')); });

    var badEntities = new Set();
    for (var e of text.matchAll(/&([a-zA-Z][a-zA-Z0-9]*);/g)) {
      if (!KNOWN_ENTITIES.has(e[1].toLowerCase())) badEntities.add('&' + e[1] + ';');
    }
    if (badEntities.size) add('entidad desconocida ' + Array.from(badEntities).join(', ') + ' (¿mal escrita?)');

    return problems;
  }

  /* ---------- Description quality ---------- */

  var DESCRIPTION = {
    minWords: 10,        // fewer words than this: "muy corta" (too short)
    maxBlockWords: 60,   // more words than this in a single block, no paragraphs: no structure
    minRepeatWords: 5,   // sentences of at least this many words that appear twice: repeated sentence
    upperRatio: 0.7      // uppercase ratio from which the text counts as ALL CAPS
  };

  var TEXT_ENTITIES = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", aacute: 'á', eacute: 'é', iacute: 'í',
    oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', iexcl: '¡', iquest: '¿', deg: '°', ordm: 'º', ordf: 'ª',
    laquo: '«', raquo: '»', hellip: '…', mdash: '—', ndash: '–', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™'
  };

  /** Visible text of a description: no tags, with a line break between paragraphs. */
  function descriptionText(raw) {
    var s = String(raw || '');
    s = s.replace(/<\s*\/?\s*(br|p|div|li|ul|ol|h[1-6]|tr|table|blockquote|section)\b[^>]*>/gi, '\n');
    s = s.replace(/<[^>]*>/g, ' ');
    s = s.replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); })
      .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&([a-zA-Z]+);/g, function (m, n) {
        var v = TEXT_ENTITIES[n.toLowerCase()];
        if (v === undefined) return m;
        return n[0] === n[0].toUpperCase() && n[0] !== n[0].toLowerCase() ? v.toUpperCase() : v;
      });
    return s.split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n');
  }

  function wordsOf(text) {
    return String(text).match(/[\p{L}\p{N}]+/gu) || [];
  }

  /** Key to compare texts: no accents, case or punctuation. */
  function textKey(text) {
    return normText(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function shorten(text, n) {
    return text.length > n ? text.slice(0, n - 1) + '…' : text;
  }

  /**
   * Checks the format, repeated text and structure of a description.
   * Returns a list of problems (empty if it is fine).
   */
  function descriptionProblems(raw, name) {
    var problems = [];
    var text = descriptionText(raw);
    if (!text) return problems;
    var words = wordsOf(text);

    // Content
    if (name && textKey(text) === textKey(name)) {
      problems.push('solo repite el nombre del producto');
    } else if (words.length < DESCRIPTION.minWords) {
      problems.push('es muy corta (' + words.length + (words.length === 1 ? ' palabra' : ' palabras') +
        '); describe el producto con al menos ' + DESCRIPTION.minWords + ' palabras');
    }

    // Format
    var letters = text.match(/\p{L}/gu) || [];
    var upper = text.match(/\p{Lu}/gu) || [];
    if (letters.length >= 20 && upper.length / letters.length > DESCRIPTION.upperRatio) {
      problems.push('está casi toda en MAYÚSCULAS');
    }
    if (/[!?¡¿]{2,}|,{2,}|\.{4,}/.test(text)) problems.push('tiene signos repetidos (como "!!!" o ",,")');
    if (/Ã[\u0080-¿]|Â[\s -¿]|â€|�/.test(text)) {
      problems.push('tiene caracteres mal codificados (como "Ã©" o "�"); revisa la codificación del archivo');
    }
    if (/\\[nrt]/.test(String(raw))) problems.push('tiene saltos de línea escritos como texto ("\\n")');

    // Repeated text
    var doubled = new Set();
    for (var m of text.matchAll(/(?<![\p{L}\p{N}])(\p{L}{2,})\s+\1(?![\p{L}\p{N}])/giu)) doubled.add(m[1].toLowerCase());
    if (doubled.size) {
      problems.push('repite palabras seguidas: ' + Array.from(doubled).map(function (w) { return '"' + w + ' ' + w + '"'; }).join(', '));
    }
    var seen = new Map();
    var repeated = [];
    text.split(/(?<=[.!?])\s+|\n/).forEach(function (sentence) {
      sentence = sentence.trim();
      if (wordsOf(sentence).length < DESCRIPTION.minRepeatWords) return;
      var key = textKey(sentence);
      if (seen.has(key)) { if (repeated.indexOf(seen.get(key)) < 0) repeated.push(seen.get(key)); }
      else seen.set(key, sentence);
    });
    if (repeated.length) {
      problems.push('repite ' + (repeated.length === 1 ? 'la frase' : repeated.length + ' frases, como') + ' "' + shorten(repeated[0], 60) + '"');
    }

    // Structure
    var blocks = text.split('\n');
    if (blocks.length === 1 && words.length > DESCRIPTION.maxBlockWords) {
      problems.push('es un solo bloque de ' + words.length + ' palabras; sepárala en párrafos o en una lista');
    }
    return problems;
  }

  /* ---------- Possible variants ---------- */

  /** Color words (Spanish and English, lowercase, no accents). */
  var COLOR_WORDS = new Set((
    'negro negra blanco blanca amarillo amarilla magenta cian cyan azul rojo roja verde gris rosa rosado ' +
    'morado morada naranja marron beige dorado dorada plateado plateada celeste fucsia turquesa vinotinto tricolor ' +
    'black white yellow blue red green grey gray pink purple orange brown gold silver navy lt dark light multicolor'
  ).split(' '));

  /** Letter sizes. */
  var SIZE_WORDS = new Set('xxs xs s m l xl xxl xxxl 2xl 3xl 4xl unica'.split(' '));

  /** Words that introduce a size: "Talla 36", "Size 8". */
  var SIZE_MARKERS = new Set(['talla', 'tallas', 'size']);

  /**
   * Splits a name into its base and its variant words (color and size).
   * A number is a size if it follows "talla"/"size", if it is a number from 1 to 50
   * at the end of the name (40, 41.5), or if it appears in attr_talla in the file.
   * Gender and age (men, women, kids, junior…) stay in the base.
   */
  function variantSplit(name, fileSizes) {
    var toks = normText(name).match(/[\p{L}\p{N}]+(?:[.,]5)?/gu) || [];
    var base = [];
    var vary = [];
    toks.forEach(function (t, i) {
      var prev = i ? toks[i - 1] : '';
      var isNum = /^\d+(?:[.,]5)?$/.test(t);
      var value = isNum ? Number(t.replace(',', '.')) : NaN;
      var sizeNumber = isNum && (SIZE_MARKERS.has(prev) || (i === toks.length - 1 && value >= 1 && value <= 50) || fileSizes.has(t));
      if (COLOR_WORDS.has(t) || SIZE_WORDS.has(t) || sizeNumber) vary.push(t);
      else if (SIZE_MARKERS.has(t) && i + 1 < toks.length) return; // "talla" goes away together with its number
      else base.push(t);
    });
    return { base: base.join(' '), vary: vary.join(' ') };
  }

  /** A row's attr_* columns, as text ("Negro 42"). */
  function rowAttrs(catalog, r) {
    return catalog.header.filter(function (h) { return /^attr_./.test(h) && r.values[h]; })
      .map(function (h) { return r.values[h]; }).join(' ');
  }

  /** Attributes of all the rows of a product, to compare products. */
  function productAttrs(catalog, p) {
    return Array.from(new Set(p.rows.map(function (r) { return rowAttrs(catalog, r); }).filter(Boolean))).sort().join(' / ');
  }

  /** Name the grouped product would have: the original name without the variant words. */
  function variantBaseName(name, fileSizes) {
    name = String(name);
    var vary = new Set(variantSplit(name, fileSizes).vary.split(' ').filter(Boolean));
    var tokens = Array.from(name.matchAll(/[\p{L}\p{N}]+(?:[.,]5)?/gu), function (m) {
      return { word: m[0], start: m.index, end: m.index + m[0].length };
    });
    tokens.forEach(function (t, i) {
      var n = normText(t.word);
      var next = tokens[i + 1];
      t.removed = vary.has(n) || (SIZE_MARKERS.has(n) && !!next && vary.has(normText(next.word)));
    });
    // Keep the original separators between words that stay next to each other ("5.0", "D-Kicks").
    var out = '';
    var prev = -1;
    tokens.forEach(function (t, i) {
      if (t.removed) return;
      if (prev >= 0) out += prev === i - 1 ? name.slice(tokens[prev].end, t.start) : ' ';
      out += t.word;
      prev = i;
    });
    return out.trim();
  }

  /* ---------- Catalog grouped by product ---------- */

  /**
   * Groups rows by product the way BE does: by external_id; if missing,
   * by post_id; if that is missing too, by name (CA-3, "grouped by name hash").
   *
   * options.file              { name, size } of the uploaded file, if known
   * options.multipleBranches  true if the merchant has more than one branch
   */
  function buildCatalog(rows, options) {
    options = options || {};
    var hasData = rows.some(function (r) { return r.some(function (c) { return String(c).trim(); }); });
    if (!hasData) return { error: 'El archivo está vacío.' };

    var header = rows[0].map(function (h) { return String(h).replace(/^﻿/, '').trim().toLowerCase(); });
    var has = function (name) { return header.indexOf(name) >= 0; };
    var known = header.filter(function (h) { return KNOWN_COLUMNS.indexOf(h) >= 0 || /^attr_./.test(h); });
    if (!known.length) {
      return { error: 'No reconozco ninguna columna de la plantilla en la primera fila (name, price, external_id…). ¿Seguro que es el CSV de la carga masiva?' };
    }

    var products = new Map();
    var dataRows = 0;

    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (row.every(function (c) { return !String(c).trim(); })) continue;
      dataRows++;

      var rowNumber = r + 1; // CA-6.2: the header is row 1
      var values = {};
      header.forEach(function (h, i) { values[h] = String(row[i] == null ? '' : row[i]).trim(); });

      var key, label, groupedBy;
      if (values.external_id) { groupedBy = 'ext'; key = values.external_id; label = values.external_id; }
      else if (values.post_id) { groupedBy = 'post'; key = values.post_id; label = values.post_id; }
      else if (values.name) { groupedBy = 'name'; key = values.name; label = null; }
      else { groupedBy = 'row'; key = String(rowNumber); label = null; }
      key = groupedBy + ':' + key;

      var product = products.get(key);
      if (!product) {
        product = { key: key, groupedBy: groupedBy, label: label || 'Fila ' + rowNumber, name: values.name, rows: [] };
        products.set(key, product);
      }
      if (!product.name && values.name) product.name = values.name;
      product.rows.push({ row: rowNumber, values: values });
    }

    if (!products.size) return { error: 'No encontré filas con datos debajo de la primera fila.' };
    return {
      header: header,
      has: has,
      products: products,
      dataRows: dataRows,
      file: options.file || null,
      multipleBranches: !!options.multipleBranches
    };
  }

  /* ---------- Check helpers ---------- */

  function allRows(catalog) {
    var rows = [];
    catalog.products.forEach(function (p) { rows.push.apply(rows, p.rows); });
    return rows.sort(function (a, b) { return a.row - b.row; });
  }

  function productItem(p, note) {
    var item = { ids: [p.label], text: p.name || '(sin nombre)' };
    if (note) item.note = note;
    return item;
  }

  function fileItem(text, note) {
    return { ids: ['Archivo'], text: text, note: note };
  }

  function columnsText(columns) {
    return (columns.length === 1 ? 'la columna ' : 'las columnas ') + columns.join(', ');
  }

  /**
   * Checks row by row: check(row) returns one text per problem (or nothing),
   * and one item is built per product with all of its problems.
   */
  function perRow(catalog, check) {
    var items = [];
    catalog.products.forEach(function (p) {
      var problems = [];
      p.rows.forEach(function (r) {
        var found = check(r, p);
        if (found) problems.push.apply(problems, [].concat(found));
      });
      if (problems.length) items.push(productItem(p, problems.join(' · ')));
    });
    return items;
  }

  /** First row (after the first one) where a column has a value, or null. */
  function laterRowWith(p, column) {
    for (var i = 1; i < p.rows.length; i++) {
      if (p.rows[i].values[column]) return p.rows[i].row;
    }
    return null;
  }

  /** Text for a product field missing from the first row (CA-3.3). */
  function missingInFirstRow(p, column) {
    var later = laterRowWith(p, column);
    return 'falta ' + column + (later ? ' (está en la fila ' + later + ', pero solo se toma de la primera fila del producto)' : '');
  }

  function rowList(rows) {
    return (rows.length === 1 ? 'Fila ' : 'Filas ') + rows.join(', ');
  }

  /* ---------- Checks ---------- */

  /** Topics used to group the checks on screen, in display order. */
  var GROUPS = ['Archivo', 'Nombre', 'Descripción', 'Precio y stock', 'Medidas', 'Imágenes', 'Variantes y códigos', 'Marca, categoría y otros'];

  var CHECKS = [

    /* ===== Errors: BE rejects the row or the product, or loads it wrong ===== */

    {
      key: 'archivo',
      level: 'error',
      group: 'Archivo',
      title: 'Archivo',
      hint: 'Solo se aceptan archivos .csv de hasta 50 MB, con las columnas name, price y las cuatro medidas.',
      run: function (c) {
        var items = [];
        if (c.file && c.file.name && !/\.csv$/i.test(c.file.name)) {
          items.push(fileItem('El archivo no termina en .csv', 'No se podrá cargar. Guárdalo como CSV antes de subirlo.'));
        }
        if (c.file && c.file.size > LIMITS.fileMB * 1024 * 1024) {
          items.push(fileItem('El archivo pesa ' + (c.file.size / 1024 / 1024).toFixed(1) + ' MB',
            'El máximo es ' + LIMITS.fileMB + ' MB. Divídelo en varios archivos.'));
        }
        var missing = REQUIRED_COLUMNS.filter(function (col) { return !c.has(col); });
        if (missing.length) {
          items.push(fileItem((missing.length === 1 ? 'Falta ' : 'Faltan ') + columnsText(missing), 'Son obligatorias: sin ellas las filas no se cargarán.'));
        }
        return items;
      }
    },
    {
      key: 'nombre',
      level: 'error',
      group: 'Nombre',
      title: 'Filas sin nombre',
      hint: 'name es obligatorio en cada fila, también en las variantes.',
      run: function (c) {
        if (!c.has('name')) return [];
        return perRow(c, function (r) { return r.values.name ? null : 'Fila ' + r.row + ': name está vacío'; });
      }
    },
    {
      key: 'sin-descripcion',
      level: 'error',
      group: 'Descripción',
      title: 'Productos sin descripción',
      hint: 'La descripción es obligatoria. Se toma de la primera fila del producto.',
      run: function (c) {
        if (!c.has('description')) return [fileItem('Falta la columna description', 'Ningún producto tendría descripción.')];
        var items = [];
        c.products.forEach(function (p) {
          if (descriptionText(p.rows[0].values.description)) return;
          var later = laterRowWith(p, 'description');
          items.push(productItem(p, 'Fila ' + p.rows[0].row + ': ' + (later
            ? 'está en la fila ' + later + ', pero solo se toma de la primera fila del producto'
            : 'description está vacía')));
        });
        return items;
      },
      notice: function (c, items) {
        if (c.has('description') && items.length === c.products.size) return 'La columna description está vacía en todo el archivo.';
        return null;
      }
    },
    {
      key: 'precio',
      level: 'error',
      group: 'Precio y stock',
      title: 'Precio no válido',
      hint: 'price es obligatorio en cada fila: número de 0 en adelante, con punto o coma decimal, máximo 2 decimales y sin separador de miles.',
      run: function (c) {
        if (!c.has('price')) return [];
        return perRow(c, function (r) {
          var problem = priceProblem(r.values.price);
          return problem ? 'Fila ' + r.row + ': price ' + problem : null;
        });
      }
    },
    {
      key: 'medidas',
      level: 'error',
      group: 'Medidas',
      title: 'Peso y dimensiones',
      hint: 'weight_kg, width_cm, height_cm y length_cm son obligatorias en la primera fila de cada producto, con números mayores que 0; las variantes pueden dejarlas vacías.',
      run: function (c) {
        var columns = DIMENSION_COLUMNS.filter(function (col) { return c.has(col); });
        if (!columns.length) return [];
        var items = [];
        c.products.forEach(function (p) {
          var first = p.rows[0];
          var problems = [];
          var missing = []; // missing and not present in any other row
          columns.forEach(function (col) {
            var problem = measurementProblem(first.values[col]);
            if (problem === 'falta' && !laterRowWith(p, col)) missing.push(col);
            else if (problem === 'falta') problems.push(missingInFirstRow(p, col));
            else if (problem) problems.push(col + ' ' + problem);
          });
          if (missing.length) problems.unshift((missing.length === 1 ? 'falta ' : 'faltan ') + missing.join(', '));
          if (problems.length) items.push(productItem(p, 'Fila ' + first.row + ': ' + problems.join(' · ')));
        });
        return items;
      }
    },
    {
      key: 'stock',
      level: 'error',
      group: 'Precio y stock',
      title: 'Stock no válido',
      hint: 'Cuando viene, stock debe ser un número entero de 0 en adelante. Se revisa cada fila, porque cada variante tiene el suyo.',
      run: function (c) {
        if (!c.has('stock')) return [];
        return perRow(c, function (r) {
          var raw = r.values.stock;
          var problem = raw && stockProblem(raw);
          return problem ? 'Fila ' + r.row + ': stock ' + problem : null;
        });
      }
    },
    {
      key: 'imagen-formato',
      level: 'error',
      group: 'Imágenes',
      title: 'Imágenes mal referenciadas',
      hint: 'Cada imagen debe ser una URL http(s) completa o el nombre de un archivo del ZIP (.jpg, .jpeg, .png, .gif o .webp). Si hay varias, van separadas por coma.',
      run: function (c) {
        if (!c.has('main_image')) return [];
        return perRow(c, function (r) {
          return splitImages(r.values.main_image).map(function (ref) {
            var problem = imageRefProblem(ref);
            return problem ? 'Fila ' + r.row + ': "' + ref + '" ' + problem : null;
          }).filter(Boolean);
        });
      }
    },
    {
      key: 'agrupacion',
      level: 'error',
      group: 'Variantes y códigos',
      title: 'Productos que se van a partir',
      hint: 'external_id y post_id deben repetirse idénticos en todas las filas del producto; si faltan en alguna, esas filas se cargan como otro producto.',
      run: function (c) {
        var items = [];

        // CA-3.1: rows without external_id with the same name as a product that has one.
        var extByName = new Map();
        c.products.forEach(function (p) {
          if (p.groupedBy === 'ext' && p.name && !extByName.has(p.name)) extByName.set(p.name, p);
        });
        c.products.forEach(function (p) {
          if (p.groupedBy !== 'name' && p.groupedBy !== 'post') return;
          var target = extByName.get(p.name);
          if (!target) return;
          var rows = p.rows.map(function (r) { return r.row; });
          items.push(productItem(target, rowList(rows) + ' sin external_id: ' + (rows.length === 1 ? 'se cargará' : 'se cargarán') +
            ' como un producto aparte. Repite el external_id en todas las filas del producto.'));
        });

        if (!c.has('post_id')) return items;

        // CA-3.1: post_id missing in some rows or changing within the product.
        c.products.forEach(function (p) {
          if (p.groupedBy !== 'ext') return;
          var postIds = Array.from(new Set(p.rows.map(function (r) { return r.values.post_id; }).filter(Boolean)));
          var withoutPost = p.rows.filter(function (r) { return !r.values.post_id; }).map(function (r) { return r.row; });
          if (postIds.length > 1) {
            items.push(productItem(p, 'Tiene varios post_id distintos (' + postIds.join(', ') + ')'));
          } else if (postIds.length === 1 && withoutPost.length) {
            items.push(productItem(p, rowList(withoutPost) + ' sin post_id: repítelo en todas las filas del producto'));
          }
        });

        // CA-3.2: the same post_id with different external_ids.
        var extByPost = new Map();
        allRows(c).forEach(function (r) {
          if (!r.values.post_id || !r.values.external_id) return;
          if (!extByPost.has(r.values.post_id)) extByPost.set(r.values.post_id, new Set());
          extByPost.get(r.values.post_id).add(r.values.external_id);
        });
        extByPost.forEach(function (exts, postId) {
          if (exts.size < 2) return;
          items.push({
            ids: [postId],
            text: 'Un post_id con varios external_id',
            note: 'Aparece con external_id ' + Array.from(exts).join(', ') + ': el producto no se cargará.'
          });
        });
        return items;
      }
    },
    {
      key: 'post-id',
      level: 'error',
      group: 'Variantes y códigos',
      title: 'post_id no válido',
      hint: 'Cuando viene, post_id debe tener exactamente 24 caracteres hexadecimales (0-9, a-f). Aquí no se puede comprobar que exista ni que sea del comercio.',
      run: function (c) {
        if (!c.has('post_id')) return [];
        var items = [];
        c.products.forEach(function (p) {
          var bad = new Map();
          p.rows.forEach(function (r) {
            var v = r.values.post_id;
            if (!v || /^[0-9a-f]{24}$/i.test(v)) return;
            if (!bad.has(v)) bad.set(v, []);
            bad.get(v).push(r.row);
          });
          if (!bad.size) return;
          var notes = Array.from(bad, function (e) {
            return rowList(e[1]) + ': "' + e[0] + '" tiene ' + e[0].length + ' caracteres o no es hexadecimal';
          });
          items.push(productItem(p, notes.join(' · ')));
        });
        return items;
      }
    },
    {
      key: 'variante-repetida',
      level: 'error',
      group: 'Variantes y códigos',
      title: 'external_variant_id repetido',
      hint: 'external_variant_id debe ser único dentro de cada producto.',
      run: function (c) {
        if (!c.has('external_variant_id')) return [];
        var items = [];
        c.products.forEach(function (p) {
          var byId = new Map();
          p.rows.forEach(function (r) {
            var v = r.values.external_variant_id;
            if (!v) return;
            if (!byId.has(v)) byId.set(v, []);
            byId.get(v).push(r.row);
          });
          var notes = [];
          byId.forEach(function (rows, v) {
            if (rows.length > 1) notes.push('"' + v + '" en las filas ' + rows.join(', '));
          });
          if (notes.length) items.push(productItem(p, notes.join(' · ')));
        });
        return items;
      }
    },
    {
      key: 'marca',
      level: 'error',
      group: 'Marca, categoría y otros',
      title: 'Marca no válida',
      hint: 'brand admite hasta 120 caracteres: letras, números, espacios y . , & \' + / ( ) ! -. Se lee de la primera fila del producto.',
      run: function (c) {
        if (!c.has('brand')) return [];
        var items = [];
        c.products.forEach(function (p) {
          var first = p.rows[0];
          var brand = first.values.brand;
          if (!brand) return;
          var problems = [];
          var length = Array.from(brand).length;
          if (length > LIMITS.brandMaxLength) problems.push('tiene ' + length + ' caracteres (máximo ' + LIMITS.brandMaxLength + ')');
          var invalid = Array.from(new Set(Array.from(brand).filter(function (ch) { return !BRAND_CHAR.test(ch); })));
          if (invalid.length) problems.push('tiene caracteres no permitidos: ' + invalid.join(' '));
          if (problems.length) items.push(productItem(p, 'Fila ' + first.row + ': brand "' + brand + '" ' + problems.join(' y ')));
        });
        return items;
      }
    },
    {
      key: 'post-venta',
      level: 'error',
      group: 'Marca, categoría y otros',
      title: 'requires_post_sale_action no válido',
      hint: 'Valores aceptados: sí, si, yes, true, 1, no, false o 0. Vacío no es error.',
      run: function (c) {
        if (!c.has('requires_post_sale_action')) return [];
        return perRow(c, function (r) {
          var v = r.values.requires_post_sale_action;
          if (!v || POST_SALE_VALUES.indexOf(v.toLowerCase()) >= 0) return null;
          return 'Fila ' + r.row + ': "' + v + '" no es un valor válido (usa sí o no)';
        });
      }
    },
    {
      key: 'sucursal',
      level: 'error',
      group: 'Marca, categoría y otros',
      title: 'Filas sin sucursal',
      hint: 'Si el comercio tiene más de una sucursal, branch_id es obligatorio en cada fila. Es el código de sucursal que definió el comercio.',
      skip: function (c) {
        return c.multipleBranches ? null : 'solo se revisa si marcas que el comercio tiene más de una sucursal.';
      },
      run: function (c) {
        if (!c.has('branch_id')) return [fileItem('Falta la columna branch_id', 'Con más de una sucursal es obligatoria: sin ella no se cargará ninguna fila.')];
        var items = [];
        c.products.forEach(function (p) {
          var rows = p.rows.filter(function (r) { return !r.values.branch_id; }).map(function (r) { return r.row; });
          if (rows.length) items.push(productItem(p, rowList(rows) + ' sin branch_id'));
        });
        return items;
      }
    },

    /* ===== Warnings: BE accepts them, but they are worth reviewing ===== */

    {
      key: 'sin-imagen',
      level: 'aviso',
      group: 'Imágenes',
      title: 'Productos sin imagen',
      hint: 'main_image está vacío en todas las filas del producto. Se cargará sin imagen.',
      run: function (c) {
        if (!c.has('main_image')) return [fileItem('No hay columna main_image', 'Todos los productos se cargarán sin imagen.')];
        var items = [];
        c.products.forEach(function (p) {
          var any = p.rows.some(function (r) { return splitImages(r.values.main_image).length; });
          if (!any) items.push(productItem(p));
        });
        return items;
      }
    },
    {
      key: 'variantes-sin-imagen',
      level: 'aviso',
      group: 'Imágenes',
      title: 'Variantes sin imagen',
      hint: 'Cada variante, sobre todo si cambia de color, debería traer su propia imagen en main_image para que el cliente vea lo que elige.',
      run: function (c) {
        if (!c.has('main_image')) return [];
        var items = [];
        c.products.forEach(function (p) {
          if (p.rows.length < 2) return;
          var withImage = p.rows.filter(function (r) { return splitImages(r.values.main_image).length; });
          if (!withImage.length) return; // no image at all: already reported in "Productos sin imagen"
          var missing = p.rows.filter(function (r) { return !splitImages(r.values.main_image).length; });
          if (!missing.length) return;
          var notes = missing.map(function (r) {
            var color = r.values.attr_color;
            var what = color || rowAttrs(c, r) || r.values.external_variant_id || r.values.variant_sku;
            var same = color && withImage.find(function (o) { return o.values.attr_color === color; });
            return 'Fila ' + r.row + (what ? ' (' + what + ')' : '') +
              (same ? ': el mismo color tiene imagen en la fila ' + same.row : '');
          });
          var total = p.rows.length;
          items.push(productItem(p, missing.length + ' de ' + total + ' variantes sin imagen · ' + notes.join(' · ')));
        });
        return items;
      }
    },
    {
      key: 'imagenes-cargan',
      level: 'aviso',
      group: 'Imágenes',
      title: 'Imágenes que no cargan',
      hint: 'Se abre cada URL de main_image para comprobar que sea una imagen y que cargue.',
      run: function () { return []; },
      notice: function (c) {
        var notes = [];
        var urls = imageTargets(c).length;
        if (urls > LIMITS.maxImageUrls) {
          notes.push('Hay ' + urls + ' URLs distintas: se descargan como máximo ' + LIMITS.maxImageUrls +
            ' por carga y el resto quedará como enlace externo.');
        }
        var zip = zipImageRefs(c).size;
        if (zip) {
          notes.push(zip + (zip === 1 ? ' imagen es un nombre de archivo' : ' imágenes son nombres de archivo') +
            ' del ZIP; esas no se pueden comprobar aquí.');
        }
        return notes.length ? notes.join(' ') : null;
      },
      // The page (images.js) opens the URLs after rendering the result.
      pending: imageTargets
    },
    {
      key: 'categoria',
      level: 'aviso',
      group: 'Marca, categoría y otros',
      title: 'Productos sin categoría',
      hint: 'category_id está vacío en la primera fila del producto.',
      run: function (c) {
        if (!c.has('category_id')) return [fileItem('No hay columna category_id', 'La IA categorizará todos los productos después de la carga.')];
        var items = [];
        c.products.forEach(function (p) {
          if (p.rows[0].values.category_id) return;
          var later = laterRowWith(p, 'category_id');
          items.push(productItem(p, later ? 'Está en la fila ' + later + ', pero solo se toma de la primera fila del producto' : null));
        });
        return items;
      },
      notice: function (c, items) {
        if (c.has('category_id') && items.length === c.products.size) {
          return 'La columna category_id está vacía en todo el archivo: la IA categorizará todos los productos.';
        }
        return null;
      }
    },
    {
      key: 'sin-marca',
      level: 'aviso',
      group: 'Marca, categoría y otros',
      title: 'Productos sin marca',
      hint: 'La marca no es obligatoria: es solo para que sepas qué productos se cargarán sin marca. Se lee de la primera fila del producto.',
      run: function (c) {
        if (!c.has('brand')) return [fileItem('No hay columna brand', 'Ningún producto tendrá marca.')];
        var items = [];
        c.products.forEach(function (p) {
          if (p.rows[0].values.brand) return;
          var later = laterRowWith(p, 'brand');
          items.push(productItem(p, later ? 'Está en la fila ' + later + ', pero solo se toma de la primera fila del producto' : null));
        });
        return items;
      },
      notice: function (c, items) {
        if (c.has('brand') && items.length === c.products.size) return 'La columna brand está vacía en todo el archivo.';
        return null;
      }
    },
    {
      key: 'descripcion-calidad',
      level: 'aviso',
      group: 'Descripción',
      title: 'Descripción con problemas',
      hint: 'Que tenga contenido propio (no solo el nombre ni la misma de otro producto), buen formato (sin MAYÚSCULAS sostenidas, signos repetidos ni caracteres mal codificados), sin texto repetido y separada en párrafos o lista si es larga.',
      run: function (c) {
        if (!c.has('description')) return [];
        // Descriptions copied between different products.
        var byText = new Map();
        c.products.forEach(function (p) {
          var text = descriptionText(p.rows[0].values.description);
          if (wordsOf(text).length < 5) return;
          var key = textKey(text);
          if (!byText.has(key)) byText.set(key, []);
          byText.get(key).push(p);
        });
        var items = [];
        c.products.forEach(function (p) {
          var first = p.rows[0];
          var problems = descriptionProblems(first.values.description, p.name);
          var text = descriptionText(first.values.description);
          var same = (byText.get(textKey(text)) || []).filter(function (o) {
            return o !== p && textKey(o.name || '') !== textKey(p.name || '');
          });
          if (wordsOf(text).length >= 5 && same.length) {
            problems.push('es igual a la descripción de ' + same.map(function (o) { return o.label; }).join(', '));
          }
          if (!problems.length) return;
          var shown = problems.slice(0, 4);
          if (problems.length > 4) shown.push('y ' + (problems.length - 4) + ' más');
          items.push(productItem(p, 'Fila ' + first.row + ': ' + shown.join(' · ')));
        });
        return items;
      }
    },
    {
      key: 'html',
      level: 'aviso',
      group: 'Descripción',
      title: 'HTML mal escrito en la descripción',
      hint: 'Si la descripción tiene HTML, se revisa que cada etiqueta se abra y se cierre bien, sin etiquetas cruzadas, desconocidas o peligrosas (como <script>). La descripción se publica tal cual, así que un error se vería en la tienda.',
      run: function (c) {
        if (!c.has('description')) return [];
        var items = [];
        c.products.forEach(function (p) {
          var first = p.rows[0];
          var problems = htmlProblems(first.values.description);
          if (!problems.length) return;
          var shown = problems.slice(0, 4);
          if (problems.length > 4) shown.push('y ' + (problems.length - 4) + ' más');
          items.push(productItem(p, 'Fila ' + first.row + ': ' + shown.join(' · ')));
        });
        return items;
      }
    },
    {
      key: 'stock-vacio',
      level: 'aviso',
      group: 'Precio y stock',
      title: 'Stock vacío',
      hint: 'Si stock está vacío, la variante se cargará con stock 1.',
      run: function (c) {
        if (!c.has('stock')) return [fileItem('No hay columna stock', 'Todas las variantes se cargarán con stock 1.')];
        var items = [];
        c.products.forEach(function (p) {
          var rows = p.rows.filter(function (r) { return !r.values.stock; }).map(function (r) { return r.row; });
          if (rows.length) items.push(productItem(p, rowList(rows) + ': se cargará con stock 1'));
        });
        return items;
      }
    },
    {
      key: 'precio-cero',
      level: 'aviso',
      group: 'Precio y stock',
      title: 'Precio en 0',
      hint: 'Con precio 0, el producto se publicaría gratis.',
      run: function (c) {
        if (!c.has('price')) return [];
        return perRow(c, function (r) {
          var raw = r.values.price;
          return raw && !priceProblem(raw) && toNumber(raw) === 0 ? 'Fila ' + r.row + ': price es 0' : null;
        });
      }
    },
    {
      key: 'columnas',
      level: 'aviso',
      group: 'Archivo',
      title: 'Columnas que no se usan',
      hint: 'Columnas que no se usan en la carga o que no son de la plantilla. Si una está mal escrita (por ejemplo, "prize"), sus datos no se cargan.',
      run: function (c) {
        var items = [];
        c.header.forEach(function (col) {
          if (!col) return;
          if (IGNORED_COLUMNS[col]) items.push(fileItem('Columna ' + col, IGNORED_COLUMNS[col]));
          else if (KNOWN_COLUMNS.indexOf(col) < 0 && !/^attr_./.test(col)) {
            items.push(fileItem('Columna "' + col + '"', 'No es una columna de la plantilla; revisa si está mal escrita. Los atributos van como attr_{nombre}.'));
          }
        });
        return items;
      }
    },
    {
      key: 'palabras-repetidas',
      level: 'aviso',
      group: 'Nombre',
      title: 'Palabras repetidas en el título',
      hint: 'Se ignoran palabras comunes (de, para, con), números y unidades (cm, ml, gb).',
      run: function (c) {
        var items = [];
        c.products.forEach(function (p) {
          if (!p.name) return;
          var rep = repeatedWords(p.name);
          if (!rep.size) return;
          items.push({
            ids: [p.label],
            text: p.name,
            rep: new Set(rep.keys()),
            note: 'Se repite: ' + Array.from(rep.values()).join(', ')
          });
        });
        return items;
      }
    },
    {
      key: 'nombres-duplicados',
      level: 'aviso',
      group: 'Nombre',
      title: 'Nombres duplicados',
      hint: 'Productos distintos con el mismo título, sin importar mayúsculas ni tildes. Sin external_id, los productos con el mismo nombre se cargarán como uno solo.',
      run: function (c) {
        // Rows without external_id that split from their product are already reported in "Productos que se van a partir".
        var extNames = new Set();
        c.products.forEach(function (p) { if (p.groupedBy === 'ext') extNames.add(p.name); });
        var byName = new Map();
        c.products.forEach(function (p) {
          if ((p.groupedBy === 'name' || p.groupedBy === 'post') && extNames.has(p.name)) return;
          var key = normText(p.name || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
          if (!key) return;
          if (!byName.has(key)) byName.set(key, []);
          byName.get(key).push(p);
        });
        return Array.from(byName.values())
          .filter(function (group) { return group.length > 1; })
          // Same name but a different size or color in attr_*: not a duplicate, it is reported in "Posibles variantes".
          .filter(function (group) { return new Set(group.map(function (p) { return productAttrs(c, p); })).size === 1; })
          .map(function (group) {
            return {
              ids: group.map(function (p) { return p.label; }),
              text: group[0].name,
              note: 'Mismo nombre en ' + group.length + ' productos'
            };
          });
      }
    },
    {
      key: 'posibles-variantes',
      level: 'aviso',
      group: 'Variantes y códigos',
      title: 'Posibles variantes',
      hint: 'Parecen el mismo producto en distinto color o talla, pero están cargados por separado. Se pueden unir en un solo producto con variantes usando el mismo external_id en todas sus filas. Nunca se juntan productos de distinto género o edad (Men, Women, Kids…). Es solo una sugerencia: decide el comercio.',
      run: function (c) {
        var fileSizes = new Set();
        allRows(c).forEach(function (r) { if (r.values.attr_talla) fileSizes.add(normText(r.values.attr_talla).trim()); });
        // Rows without external_id that split from their product are already reported in "Productos que se van a partir".
        var extNames = new Set();
        c.products.forEach(function (p) { if (p.groupedBy === 'ext') extNames.add(p.name); });
        var groups = new Map();
        c.products.forEach(function (p) {
          if (!p.name) return;
          if ((p.groupedBy === 'name' || p.groupedBy === 'post') && extNames.has(p.name)) return;
          var split = variantSplit(p.name, fileSizes);
          if (!split.base) return;
          if (!groups.has(split.base)) groups.set(split.base, []);
          groups.get(split.base).push({ p: p, vary: split.vary, attrs: productAttrs(c, p) });
        });
        var items = [];
        groups.forEach(function (members) {
          if (members.length < 2) return;
          // Same name and same attributes: a duplicate, not a variant.
          if (new Set(members.map(function (m) { return m.vary + '|' + m.attrs; })).size === 1) return;
          items.push({
            ids: members.map(function (m) { return m.p.label; }),
            text: 'Agrupar como "' + variantBaseName(members[0].p.name, fileSizes) + '"',
            note: members.map(function (m) {
              var what = m.vary ? m.p.name.match(/[\p{L}\p{N}]+(?:[.,]5)?/gu).filter(function (w) {
                return m.vary.split(' ').indexOf(normText(w)) >= 0;
              }).join(' ') : (m.attrs || 'sin color ni talla en el nombre');
              return m.p.label + ': ' + what;
            }).join(' · ')
          });
        });
        return items;
      }
    },
    {
      key: 'sku-duplicados',
      level: 'aviso',
      group: 'Variantes y códigos',
      title: 'variant_sku repetido',
      hint: 'Se puede repetir variant_sku (es solo informativo), pero suele ser un error al copiar filas.',
      run: function (c) {
        if (!c.has('variant_sku')) return [];
        var bySku = new Map();
        allRows(c).forEach(function (r) {
          var v = r.values.variant_sku;
          if (!v) return;
          if (!bySku.has(v)) bySku.set(v, []);
          bySku.get(v).push(r);
        });
        var labels = new Map();
        c.products.forEach(function (p) { p.rows.forEach(function (r) { labels.set(r.row, p.label); }); });
        var items = [];
        bySku.forEach(function (rows, sku) {
          if (rows.length < 2) return;
          items.push({
            ids: [sku],
            text: 'Repetido en ' + rows.length + ' filas (filas ' + rows.map(function (r) { return r.row; }).join(', ') + ')',
            note: 'Productos: ' + Array.from(new Set(rows.map(function (r) { return labels.get(r.row); }))).join(', ')
          });
        });
        return items;
      }
    }
  ];

  /**
   * Runs every check on the rows returned by CsvParser.parseCSV.
   * options: see buildCatalog.
   */
  function analyze(rows, options) {
    var catalog = buildCatalog(rows, options);
    if (catalog.error) return { error: catalog.error };
    return {
      stats: { products: catalog.products.size, rows: catalog.dataRows },
      checks: CHECKS.map(function (c) {
        var skipped = c.skip ? c.skip(catalog) : null;
        var items = skipped ? [] : c.run(catalog);
        return {
          key: c.key,
          level: c.level,
          group: c.group,
          title: c.title,
          hint: c.hint,
          skipped: skipped,
          notice: !skipped && c.notice ? c.notice(catalog, items) : null,
          pending: !skipped && c.pending ? c.pending(catalog) : null,
          items: items
        };
      })
    };
  }

  return {
    LIMITS: LIMITS,
    REQUIRED_COLUMNS: REQUIRED_COLUMNS,
    DIMENSION_COLUMNS: DIMENSION_COLUMNS,
    DESCRIPTION: DESCRIPTION,
    KNOWN_COLUMNS: KNOWN_COLUMNS,
    IMAGE_EXTENSIONS: IMAGE_EXTENSIONS,
    IGNORED_WORDS: IGNORED_WORDS,
    WORD_PATTERN: WORD_PATTERN,
    CHECKS: CHECKS,
    GROUPS: GROUPS,
    normText: normText,
    repeatedWords: repeatedWords,
    priceProblem: priceProblem,
    measurementProblem: measurementProblem,
    stockProblem: stockProblem,
    splitImages: splitImages,
    imageRefProblem: imageRefProblem,
    htmlProblems: htmlProblems,
    variantSplit: variantSplit,
    descriptionText: descriptionText,
    descriptionProblems: descriptionProblems,
    imageTargets: imageTargets,
    imageLoadItems: imageLoadItems,
    buildCatalog: buildCatalog,
    analyze: analyze
  };
});
