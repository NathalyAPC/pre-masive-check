/**
 * Revisiones del catálogo.
 *
 * Cada revisión es un objeto de la lista CHECKS. Para agregar una nueva,
 * añade un objeto con key, title, hint y run(catalog), donde run devuelve
 * una lista de elementos { ids, text, note?, rep? }. Opcionalmente puede tener
 * notice(catalog, items), que devuelve un aviso general para mostrar arriba de la lista.
 *
 * Funciona en el navegador (window.Checks) y en Node (require) para las pruebas.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Checks = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Columnas sin las que no se puede revisar el archivo. */
  var REQUIRED_COLUMNS = ['external_id', 'name', 'main_image'];

  /** Textos que debe tener cada producto (en al menos una de sus filas). */
  var TEXT_COLUMNS = ['brand', 'description'];

  /** Medidas que debe tener cada producto (peso en kg, dimensiones en cm). */
  var DIMENSION_COLUMNS = ['weight_kg', 'width_cm', 'height_cm', 'length_cm'];

  /**
   * Palabras que pueden repetirse en un título sin que sea un error:
   * conectores y unidades de medida. Los números también se ignoran.
   */
  var IGNORED_WORDS = new Set((
    'de del la el los las para con y e o u en por a al un una x sin ' +
    'cm mm m mt mts ml l lt lts gb mb tb kg g gr grs w v hz mah pulgada pulgadas'
  ).split(' '));

  /**
   * Una "palabra" son letras y números seguidos. Las unidas por barra
   * (220v/220v, Ce285a/Cf280x) cuentan como una sola.
   */
  var WORD_PATTERN = /[\p{L}\p{N}]+(?:\/[\p{L}\p{N}]+)*/gu;

  /** Minúsculas y sin tildes, para comparar textos. */
  function normText(s) {
    return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  }

  /**
   * Devuelve las palabras repetidas de un título como un Map
   * { palabra normalizada → cómo aparece escrita la primera vez }.
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

  /* ---------- Validación de números ---------- */

  /**
   * Revisa un número decimal mayor que 0. El separador decimal puede ser
   * punto o coma (45, 37.18, 37,18, 2500.00). No se aceptan separadores de
   * miles ni símbolos (1,234.56, $45), porque no se sabe con certeza qué número son.
   * Devuelve null si es válido, o la descripción del problema.
   */
  function decimalProblem(raw) {
    if (raw === '') return 'está vacío';
    if (/^-\d/.test(raw)) return 'es negativo ("' + raw + '")';
    if (!/^\d+([.,]\d+)?$/.test(raw)) return 'no es un número ("' + raw + '")';
    if (Number(raw.replace(',', '.')) === 0) return 'es 0';
    return null;
  }

  /** Máximo de decimales permitido en el precio. */
  var PRICE_MAX_DECIMALS = 2;

  /**
   * Revisa un precio: las mismas reglas de decimalProblem y, además,
   * no más de PRICE_MAX_DECIMALS decimales (37.18 sí, 37.185 no).
   */
  function priceProblem(raw) {
    var problem = decimalProblem(raw);
    if (problem) return problem;
    var decimals = raw.split(/[.,]/)[1] || '';
    if (decimals.length > PRICE_MAX_DECIMALS) {
      return 'tiene más de ' + PRICE_MAX_DECIMALS + ' decimales ("' + raw + '")' +
        (decimals.length === 3 ? '; si es un separador de miles, escríbelo sin él' : '');
    }
    return null;
  }

  /** Revisa un número entero de 0 en adelante (0, 10, 141). */
  function integerProblem(raw) {
    if (raw === '') return 'está vacío';
    if (/^-\d/.test(raw)) return 'es negativo ("' + raw + '")';
    if (/^\d+[.,]\d+$/.test(raw)) return 'debe ser un número entero ("' + raw + '")';
    if (!/^\d+$/.test(raw)) return 'no es un número ("' + raw + '")';
    return null;
  }

  /* ---------- Enlaces de imagen ---------- */

  /**
   * Revisa que un enlace de imagen esté bien escrito. No comprueba que cargue;
   * eso lo hace images.js en el navegador. Devuelve null si está bien escrito.
   */
  function urlProblem(raw) {
    if (/\s/.test(raw)) return 'tiene espacios';
    if (!/^https?:\/\//i.test(raw)) return 'no empieza con http:// o https://';
    if (!/^https?:\/\/[^\s\/?#]+\.[^\s\/?#]+([\/?#]\S*)?$/i.test(raw)) return 'no es un enlace válido';
    return null;
  }

  /**
   * Enlaces bien escritos que hay que abrir para comprobar que cargan.
   * Cada enlace se abre una sola vez aunque lo usen varios productos.
   * Devuelve [{ url, products: [{ id, name }] }] en el orden del archivo.
   */
  function imageTargets(catalog) {
    var byUrl = new Map();
    catalog.products.forEach(function (p) {
      p.rows.forEach(function (r) {
        var url = r.values.main_image;
        if (!url || urlProblem(url)) return;
        if (!byUrl.has(url)) byUrl.set(url, []);
        var list = byUrl.get(url);
        if (!list.some(function (x) { return x.id === p.id; })) list.push({ id: p.id, name: p.name });
      });
    });
    return Array.from(byUrl, function (entry) { return { url: entry[0], products: entry[1] }; });
  }

  /**
   * Convierte el resultado de abrir los enlaces (Map url → problema o null)
   * en elementos para mostrar, uno por producto y enlace que no carga.
   */
  function imageLoadItems(targets, results) {
    var items = [];
    targets.forEach(function (t) {
      var problem = results.get(t.url);
      if (!problem) return;
      t.products.forEach(function (p) {
        items.push({ ids: [p.id], text: p.name || '(sin nombre)', note: 'La imagen ' + problem + ': ' + t.url });
      });
    });
    return items;
  }

  /** Elemento que avisa que al archivo le faltan columnas para una revisión. */
  function missingColumnsItem(columns) {
    return {
      ids: ['Archivo'],
      text: (columns.length === 1 ? 'Falta la columna ' : 'Faltan las columnas ') + columns.join(', '),
      note: 'Agrégala al encabezado del CSV para que se pueda revisar.'
    };
  }

  /* ---------- Catálogo agrupado por producto ---------- */

  /**
   * Agrupa las filas por producto (external_id). Las variantes de un producto
   * son filas con el mismo external_id. Cada producto guarda sus filas con los
   * valores por nombre de columna, para que las revisiones los consulten.
   */
  function buildCatalog(rows) {
    if (!rows.length) return { error: 'El archivo está vacío.' };

    var header = rows[0].map(function (h) { return String(h).replace(/^\uFEFF/, '').trim().toLowerCase(); });
    var has = function (name) { return header.indexOf(name) >= 0; };
    var missing = REQUIRED_COLUMNS.filter(function (c) { return !has(c); });
    if (missing.length) {
      return { error: 'No encuentro estas columnas en la primera fila: ' + missing.join(', ') +
        '. ¿Seguro que es el CSV del catálogo?' };
    }

    var products = new Map();
    var skus = new Map();
    var variantIds = new Map();
    var dataRows = 0;

    function register(map, key, rowNumber, id) {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ row: rowNumber, id: id });
    }

    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (row.every(function (c) { return !String(c).trim(); })) continue;
      dataRows++;

      var rowNumber = r + 1; // coincide con el número de fila en Excel
      var values = {};
      header.forEach(function (h, i) { values[h] = String(row[i] == null ? '' : row[i]).trim(); });

      var id = values.external_id || '(sin id, fila ' + rowNumber + ')';
      var product = products.get(id);
      if (!product) { product = { id: id, name: values.name, hasImage: false, rows: [] }; products.set(id, product); }
      if (!product.name && values.name) product.name = values.name;
      if (values.main_image) product.hasImage = true;
      product.rows.push({ row: rowNumber, values: values });

      register(skus, values.variant_sku, rowNumber, id);
      register(variantIds, values.external_variant_id, rowNumber, id);
    }

    if (!products.size) return { error: 'No encontré productos debajo de la primera fila.' };
    return { header: header, has: has, products: products, skus: skus, variantIds: variantIds, dataRows: dataRows };
  }

  /** Primer valor no vacío de una columna entre las filas del producto. */
  function firstValue(product, column) {
    for (var i = 0; i < product.rows.length; i++) {
      if (product.rows[i].values[column]) return product.rows[i].values[column];
    }
    return '';
  }

  function duplicatesIn(map, label) {
    var items = [];
    map.forEach(function (list, key) {
      if (list.length < 2) return;
      var productIds = Array.from(new Set(list.map(function (x) { return x.id; })));
      items.push({
        ids: [key],
        text: label + ' repetido en ' + list.length + ' filas (filas ' + list.map(function (x) { return x.row; }).join(', ') + ')',
        note: 'Productos: ' + productIds.join(', ')
      });
    });
    return items;
  }

  /* ---------- Revisiones ---------- */

  var CHECKS = [
    {
      key: 'sin-imagen',
      title: 'Productos sin imagen',
      hint: 'La columna main_image está vacía en todas las filas del producto.',
      run: function (catalog) {
        return Array.from(catalog.products.values())
          .filter(function (p) { return !p.hasImage; })
          .map(function (p) { return { ids: [p.id], text: p.name || '(sin nombre)' }; });
      }
    },
    {
      key: 'imagenes-cargan',
      title: 'Imágenes que no cargan',
      hint: 'Se abre cada enlace de main_image para comprobar que sea una imagen y que cargue. Necesita conexión a internet.',
      // Al revisar se marcan los enlaces mal escritos; los que hay que abrir
      // quedan en "pending" y los verifica la página (images.js).
      run: function (catalog) {
        var items = [];
        catalog.products.forEach(function (p) {
          p.rows.forEach(function (r) {
            var url = r.values.main_image;
            var problem = url && urlProblem(url);
            if (problem) items.push({ ids: [p.id], text: p.name || '(sin nombre)', note: 'Fila ' + r.row + ': el enlace ' + problem + ' ("' + url + '")' });
          });
        });
        return items;
      },
      pending: imageTargets
    },
    {
      key: 'categoria',
      title: 'Productos sin categoría',
      hint: 'Cada producto necesita un category_id para no cargarse sin categoría. Basta con que lo tenga una de sus filas.',
      run: function (catalog) {
        if (!catalog.has('category_id')) return [missingColumnsItem(['category_id'])];
        return Array.from(catalog.products.values())
          .filter(function (p) { return !firstValue(p, 'category_id'); })
          .map(function (p) { return { ids: [p.id], text: p.name || '(sin nombre)' }; });
      },
      notice: function (catalog, items) {
        if (catalog.has('category_id') && items.length === catalog.products.size) {
          return 'La columna category_id está vacía en todo el archivo: ningún producto tiene categoría.';
        }
        return null;
      }
    },
    {
      key: 'precio-stock',
      title: 'Precio y stock no válidos',
      hint: 'price debe ser un número mayor que 0 con máximo 2 decimales, separados con punto o coma (37.18 o 37,18). stock debe ser un número entero de 0 en adelante. Se revisa cada fila, también las variantes.',
      run: function (catalog) {
        var columns = ['price', 'stock'];
        var missing = columns.filter(function (c) { return !catalog.has(c); });
        var items = missing.length ? [missingColumnsItem(missing)] : [];
        var checkPrice = catalog.has('price');
        var checkStock = catalog.has('stock');

        catalog.products.forEach(function (p) {
          var problems = [];
          p.rows.forEach(function (r) {
            var priceIssue = checkPrice && priceProblem(r.values.price);
            var stockIssue = checkStock && integerProblem(r.values.stock);
            if (priceIssue) problems.push('Fila ' + r.row + ': price ' + priceIssue);
            if (stockIssue) problems.push('Fila ' + r.row + ': stock ' + stockIssue);
          });
          if (problems.length) items.push({ ids: [p.id], text: p.name || '(sin nombre)', note: problems.join(' · ') });
        });
        return items;
      }
    },
    {
      key: 'dimensiones',
      title: 'Peso y dimensiones',
      hint: 'Cada producto necesita weight_kg, width_cm, height_cm y length_cm, con números mayores que 0 (decimal con punto o coma). Las variantes pueden dejarlas vacías si otra fila del producto las tiene.',
      run: function (catalog) {
        var missingColumns = DIMENSION_COLUMNS.filter(function (c) { return !catalog.has(c); });
        var columns = DIMENSION_COLUMNS.filter(function (c) { return catalog.has(c); });
        var items = missingColumns.length ? [missingColumnsItem(missingColumns)] : [];

        catalog.products.forEach(function (p) {
          var problems = [];
          var empty = columns.filter(function (c) { return !firstValue(p, c); });
          if (empty.length) problems.push('Falta ' + empty.join(', '));
          p.rows.forEach(function (r) {
            columns.forEach(function (c) {
              var raw = r.values[c];
              if (!raw) return; // vacío en una variante: hereda de otra fila
              var issue = decimalProblem(raw);
              if (issue) problems.push('Fila ' + r.row + ': ' + c + ' ' + issue);
            });
          });
          if (problems.length) items.push({ ids: [p.id], text: p.name || '(sin nombre)', note: problems.join(' · ') });
        });
        return items;
      }
    },
    {
      key: 'datos-vacios',
      title: 'Marca y descripción vacías',
      hint: 'Cada producto necesita brand y description. Basta con que estén en una de sus filas. Precio, stock y medidas vacíos se marcan en sus propias revisiones.',
      run: function (catalog) {
        var missingColumns = TEXT_COLUMNS.filter(function (c) { return !catalog.has(c); });
        var columns = TEXT_COLUMNS.filter(function (c) { return catalog.has(c); });
        var items = missingColumns.length ? [missingColumnsItem(missingColumns)] : [];
        catalog.products.forEach(function (p) {
          var empty = columns.filter(function (c) { return !firstValue(p, c); });
          if (empty.length) items.push({ ids: [p.id], text: p.name || '(sin nombre)', note: 'Falta ' + empty.join(', ') });
        });
        return items;
      },
      notice: function (catalog) {
        var allEmpty = TEXT_COLUMNS.filter(function (c) {
          if (!catalog.has(c)) return false;
          return Array.from(catalog.products.values()).every(function (p) { return !firstValue(p, c); });
        });
        if (!allEmpty.length) return null;
        return (allEmpty.length === 1 ? 'La columna ' + allEmpty[0] + ' está vacía' : 'Las columnas ' + allEmpty.join(' y ') + ' están vacías') +
          ' en todo el archivo.';
      }
    },
    {
      key: 'palabras-repetidas',
      title: 'Palabras repetidas en el título',
      hint: 'Se ignoran palabras comunes (de, para, con), números y unidades (cm, ml, gb).',
      run: function (catalog) {
        var items = [];
        catalog.products.forEach(function (p) {
          if (!p.name) return;
          var rep = repeatedWords(p.name);
          if (!rep.size) return;
          items.push({
            ids: [p.id],
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
      title: 'Nombres duplicados',
      hint: 'Productos distintos con el mismo título, sin importar mayúsculas ni tildes.',
      run: function (catalog) {
        var byName = new Map();
        catalog.products.forEach(function (p) {
          var key = normText(p.name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
          if (!key) return;
          if (!byName.has(key)) byName.set(key, []);
          byName.get(key).push(p);
        });
        return Array.from(byName.values())
          .filter(function (group) { return group.length > 1; })
          .map(function (group) {
            return {
              ids: group.map(function (p) { return p.id; }),
              text: group[0].name,
              note: 'Mismo nombre en ' + group.length + ' productos'
            };
          });
      }
    },
    {
      key: 'sku-duplicados',
      title: 'SKU de variante duplicados',
      hint: 'El mismo variant_sku usado en más de una fila.',
      run: function (catalog) {
        return duplicatesIn(catalog.skus, 'variant_sku')
          .concat(duplicatesIn(catalog.variantIds, 'external_variant_id'));
      }
    }
  ];

  /** Corre todas las revisiones sobre las filas que devuelve CsvParser.parseCSV. */
  function analyze(rows) {
    var catalog = buildCatalog(rows);
    if (catalog.error) return { error: catalog.error };
    return {
      stats: { products: catalog.products.size, rows: catalog.dataRows },
      checks: CHECKS.map(function (c) {
        var items = c.run(catalog);
        return {
          key: c.key,
          title: c.title,
          hint: c.hint,
          notice: c.notice ? c.notice(catalog, items) : null,
          pending: c.pending ? c.pending(catalog) : null,
          items: items
        };
      })
    };
  }

  return {
    REQUIRED_COLUMNS: REQUIRED_COLUMNS,
    DIMENSION_COLUMNS: DIMENSION_COLUMNS,
    TEXT_COLUMNS: TEXT_COLUMNS,
    IGNORED_WORDS: IGNORED_WORDS,
    WORD_PATTERN: WORD_PATTERN,
    CHECKS: CHECKS,
    normText: normText,
    repeatedWords: repeatedWords,
    PRICE_MAX_DECIMALS: PRICE_MAX_DECIMALS,
    decimalProblem: decimalProblem,
    priceProblem: priceProblem,
    integerProblem: integerProblem,
    urlProblem: urlProblem,
    imageTargets: imageTargets,
    imageLoadItems: imageLoadItems,
    buildCatalog: buildCatalog,
    analyze: analyze
  };
});
