const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { parseCSV, detectDelimiter } = require('../js/csv.js');
const {
  analyze, buildCatalog, repeatedWords, decimalProblem, priceProblem, integerProblem,
  urlProblem, imageTargets, imageLoadItems,
} = require('../js/checks.js');
const { verify } = require('../js/images.js');

const ROOT = path.join(__dirname, '..');
const run = (lines) => analyze(parseCSV(lines.join('\n')));
const check = (result, key) => result.checks.find((c) => c.key === key);
const idsOf = (result, key) => check(result, key).items.map((i) => i.ids.join('+'));

// Encabezado con todas las columnas que se revisan, para armar casos cortos.
const FULL = 'external_id,name,main_image,category_id,price,stock,variant_sku,weight_kg,width_cm,height_cm,length_cm,brand,description';
const ok = (id, name, extra = {}) => {
  const v = {
    img: 'https://img.ejemplo.com/' + id + '.webp', cat: '10', price: '45', stock: '3', sku: '',
    w: '0.3', wi: '22', h: '20', l: '10', brand: 'HP', desc: 'Descripción', ...extra,
  };
  return [id, name, v.img, v.cat, v.price, v.stock, v.sku, v.w, v.wi, v.h, v.l, v.brand, v.desc].join(',');
};

/* ---------- Lectura del CSV ---------- */

test('lee comillas, comas dentro de comillas, comillas escapadas, CRLF y BOM', () => {
  const rows = parseCSV('﻿a,b\r\n"Caja, grande","Dice ""hola"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['Caja, grande', 'Dice "hola"']]);
});

test('detecta CSV separados por punto y coma', () => {
  assert.equal(detectDelimiter('external_id;name;main_image\nA;B;C'), ';');
  const rows = parseCSV('external_id;name;main_image\nA1;"Mouse; negro";');
  assert.deepEqual(rows[1], ['A1', 'Mouse; negro', '']);
});

test('avisa cuando faltan columnas obligatorias', () => {
  const result = run(['a,b', '1,2']);
  assert.match(result.error, /external_id, name, main_image/);
});

test('avisa cuando el archivo está vacío o solo tiene encabezado', () => {
  assert.ok(analyze(parseCSV('')).error);
  assert.ok(run(['external_id,name,main_image']).error);
});

test('acepta punto o coma decimal en un CSV separado por punto y coma', () => {
  const result = run([
    FULL.replaceAll(',', ';'),
    ['P1', 'Mouse Usb', 'https://x.com/1', '10', '37,18', '3', '', '0,3', '22,5', '20', '10', 'HP', 'Mouse'].join(';'),
    ['P2', 'Teclado Usb', 'https://x.com/2', '10', '45.90', '0', '', '1.2', '40', '15.5', '5', 'HP', 'Teclado'].join(';'),
  ]);
  assert.deepEqual(idsOf(result, 'precio-stock'), []);
  assert.deepEqual(idsOf(result, 'dimensiones'), []);
});

test('un archivo correcto no tiene nada por revisar', () => {
  const result = run([FULL, ok('P1', 'Mouse Usb'), ok('P2', 'Teclado Usb')]);
  for (const c of result.checks) assert.deepEqual(c.items, [], c.key);
});

/* ---------- Imagen ---------- */

test('productos sin imagen se cuentan por producto, no por fila', () => {
  const result = run([
    'external_id,name,main_image,variant_sku',
    'P1,Con variantes,https://x/1.webp,P1-A',
    'P1,Con variantes,,P1-B',
    'P2,Sin imagen,,',
    'P3,Con imagen,https://x/3.webp,',
  ]);
  assert.deepEqual(idsOf(result, 'sin-imagen'), ['P2']);
  assert.deepEqual(result.stats, { products: 3, rows: 4 });
});

/* ---------- Enlaces de imagen ---------- */

test('reglas de escritura de los enlaces de imagen', () => {
  for (const good of ['https://http2.mlstatic.com/D_NQ_NP_2X_1-O.webp', 'http://shopink.com.ve/a.jpg', 'https://127.0.0.1:8080/a.png?x=1'])
    assert.equal(urlProblem(good), null, good);
  assert.match(urlProblem('www.ejemplo.com/a.webp'), /no empieza con http/);
  assert.match(urlProblem('https://ejemplo.com/mi foto.jpg'), /espacios/);
  assert.match(urlProblem('https://localhost/a.png'), /no es un enlace válido/);
  assert.match(urlProblem('N/A'), /no empieza con http/);
});

test('marca enlaces mal escritos y deja los demás pendientes de abrir, una vez por enlace', () => {
  const result = run([
    FULL,
    ok('P1', 'Bien', { img: 'https://img.ejemplo.com/compartida.webp' }),
    ok('P2', 'Comparte foto', { img: 'https://img.ejemplo.com/compartida.webp' }),
    ok('P3', 'Mal escrito', { img: 'www.ejemplo.com/3.webp' }),
    ok('P4', 'Variantes', { sku: 'P4-A', img: 'https://img.ejemplo.com/4.webp' }),
    ok('P4', 'Variantes', { sku: 'P4-B', img: 'https://img.ejemplo.com/4.webp' }),
  ]);
  const c = check(result, 'imagenes-cargan');
  assert.deepEqual(c.items.map((i) => i.ids[0]), ['P3']);
  assert.match(c.items[0].note, /Fila 4: el enlace no empieza con http/);
  assert.deepEqual(c.pending.map((t) => [t.url, t.products.map((p) => p.id)]), [
    ['https://img.ejemplo.com/compartida.webp', ['P1', 'P2']],
    ['https://img.ejemplo.com/4.webp', ['P4']],
  ]);
});

test('los enlaces que no cargan se muestran por producto', () => {
  const catalog = buildCatalog(parseCSV([FULL,
    ok('P1', 'Uno', { img: 'https://a.com/ok.webp' }),
    ok('P2', 'Dos', { img: 'https://a.com/rota.webp' }),
    ok('P3', 'Tres', { img: 'https://a.com/rota.webp' }),
  ].join('\n')));
  const targets = imageTargets(catalog);
  const results = new Map([['https://a.com/ok.webp', null], ['https://a.com/rota.webp', 'no carga']]);
  const items = imageLoadItems(targets, results);
  assert.deepEqual(items.map((i) => i.ids[0]), ['P2', 'P3']);
  assert.equal(items[0].note, 'La imagen no carga: https://a.com/rota.webp');
});

test('verify abre todos los enlaces con concurrencia limitada e informa el avance', async () => {
  let open = 0, maxOpen = 0;
  const progress = [];
  const loader = (url) => new Promise((resolve) => {
    open++; maxOpen = Math.max(maxOpen, open);
    setTimeout(() => { open--; resolve(url.includes('rota') ? 'no carga' : null); }, 5);
  });
  const urls = Array.from({ length: 10 }, (_, i) => 'https://a.com/' + (i % 3 ? 'ok' : 'rota') + i);
  const results = await verify(urls, { loader, concurrency: 3, onProgress: (d, t) => progress.push(d + '/' + t) });
  assert.equal(results.size, 10);
  assert.equal(results.get('https://a.com/rota0'), 'no carga');
  assert.equal(results.get('https://a.com/ok1'), null);
  assert.ok(maxOpen <= 3);
  assert.equal(progress.at(-1), '10/10');
});

test('verify se detiene si se cancela y no falla si el loader lanza un error', async () => {
  let calls = 0;
  let cancelled = false;
  const loader = () => { calls++; if (calls === 2) cancelled = true; return Promise.reject(new Error('x')); };
  const results = await verify(['a', 'b', 'c', 'd'], { loader, concurrency: 1, isCancelled: () => cancelled });
  assert.equal(calls, 2);
  assert.equal(results.get('a'), 'no se pudo comprobar');
});

/* ---------- Categoría ---------- */

test('marca productos sin category_id; basta con que una variante lo tenga', () => {
  const result = run([
    FULL,
    ok('P1', 'Con categoría'),
    ok('P2', 'Sin categoría', { cat: '' }),
    ok('P3', 'Variante con categoría', { cat: '', sku: 'P3-A' }),
    ok('P3', 'Variante con categoría', { cat: '7', sku: 'P3-B' }),
  ]);
  assert.deepEqual(idsOf(result, 'categoria'), ['P2']);
  assert.equal(check(result, 'categoria').notice, null);
});

test('avisa cuando ningún producto tiene categoría', () => {
  const result = run([FULL, ok('P1', 'Uno', { cat: '' }), ok('P2', 'Dos', { cat: '' })]);
  assert.deepEqual(idsOf(result, 'categoria'), ['P1', 'P2']);
  assert.match(check(result, 'categoria').notice, /vacía en todo el archivo/);
});

test('avisa cuando falta la columna category_id', () => {
  const result = run(['external_id,name,main_image', 'P1,Uno,https://x/1']);
  const items = check(result, 'categoria').items;
  assert.equal(items.length, 1);
  assert.match(items[0].text, /Falta la columna category_id/);
});

/* ---------- Precio y stock ---------- */

test('reglas de números para price y medidas', () => {
  for (const good of ['45', '37.18', '37,18', '2500.00', '2500,00', '0.12', '0,3']) assert.equal(decimalProblem(good), null, good);
  assert.match(decimalProblem(''), /vacío/);
  assert.match(decimalProblem('-5'), /negativo/);
  assert.match(decimalProblem('-5,5'), /negativo/);
  assert.match(decimalProblem('0'), /es 0/);
  assert.match(decimalProblem('0.00'), /es 0/);
  assert.match(decimalProblem('0,00'), /es 0/);
  for (const bad of ['$45', '1,234.56', '1.234,56', 'abc', '45 usd', '1.2.3', ',5']) assert.match(decimalProblem(bad), /no es un número/, bad);
});

test('el precio admite como máximo 2 decimales; las medidas no tienen límite', () => {
  for (const good of ['45', '45.5', '37.18', '37,18', '2500.00']) assert.equal(priceProblem(good), null, good);
  assert.match(priceProblem('37.185'), /más de 2 decimales/);
  assert.match(priceProblem('37,1855'), /más de 2 decimales/);
  assert.match(priceProblem('1.234'), /separador de miles/);
  assert.doesNotMatch(priceProblem('37.1855'), /separador de miles/);
  assert.match(priceProblem('$45'), /no es un número/);
  assert.equal(decimalProblem('0.125'), null);
});

test('reglas de números para stock', () => {
  for (const good of ['0', '10', '141']) assert.equal(integerProblem(good), null, good);
  assert.match(integerProblem(''), /vacío/);
  assert.match(integerProblem('2.5'), /entero/);
  assert.match(integerProblem('-1'), /negativo/);
  assert.match(integerProblem('diez'), /no es un número/);
});

test('revisa price y stock en cada fila, también en las variantes', () => {
  const result = run([
    FULL,
    ok('P1', 'Bien'),
    ok('P2', 'Precio con símbolo', { price: '$72.50' }),
    ok('P3', 'Variante mala', { sku: 'P3-A' }),
    ok('P3', 'Variante mala', { sku: 'P3-B', stock: '2.5' }),
    ok('P4', 'Stock vacío', { stock: '' }),
    ok('P5', 'Precio con coma decimal', { price: '"72,50"' }),
    ok('P6', 'Precio con tres decimales', { price: '19.999' }),
  ]);
  assert.deepEqual(idsOf(result, 'precio-stock'), ['P2', 'P3', 'P4', 'P6']);
  const notes = check(result, 'precio-stock').items.map((i) => i.note);
  assert.match(notes[0], /Fila 3: price no es un número/);
  assert.match(notes[1], /Fila 5: stock debe ser un número entero/);
  assert.match(notes[2], /stock está vacío/);
});

/* ---------- Peso y dimensiones ---------- */

test('marca medidas faltantes o no válidas; las variantes pueden heredarlas', () => {
  const result = run([
    FULL,
    ok('P1', 'Bien'),
    ok('P2', 'Sin alto', { h: '' }),
    ok('P3', 'Largo cero', { l: '0' }),
    ok('P4', 'Variantes heredan', { sku: 'P4-A' }),
    ok('P4', 'Variantes heredan', { sku: 'P4-B', w: '', wi: '', h: '', l: '' }),
    ok('P5', 'Peso con texto', { w: '1kg' }),
    ok('P6', 'Medidas con coma decimal', { w: '"0,3"', wi: '"22,5"' }),
  ]);
  assert.deepEqual(idsOf(result, 'dimensiones'), ['P2', 'P3', 'P5']);
  const notes = check(result, 'dimensiones').items.map((i) => i.note);
  assert.match(notes[0], /Falta height_cm/);
  assert.match(notes[1], /length_cm es 0/);
  assert.match(notes[2], /weight_kg no es un número/);
});

test('avisa cuando faltan columnas de medidas', () => {
  const result = run(['external_id,name,main_image,weight_kg', 'P1,Uno,https://x/1,0.5']);
  assert.match(check(result, 'dimensiones').items[0].text, /Faltan las columnas width_cm, height_cm, length_cm/);
});

/* ---------- Marca y descripción ---------- */

test('marca productos sin brand o description; las variantes pueden heredarlos', () => {
  const result = run([
    FULL,
    ok('P1', 'Bien'),
    ok('P2', 'Sin marca', { brand: '' }),
    ok('P3', 'Sin nada', { brand: '', desc: '' }),
    ok('P4', 'Variantes', { sku: 'P4-A' }),
    ok('P4', 'Variantes', { sku: 'P4-B', brand: '', desc: '' }),
  ]);
  const c = check(result, 'datos-vacios');
  assert.deepEqual(c.items.map((i) => i.ids[0] + ': ' + i.note), ['P2: Falta brand', 'P3: Falta brand, description']);
  assert.equal(c.notice, null);
});

test('avisa si falta la columna brand o si está vacía en todo el archivo', () => {
  const sinColumna = run(['external_id,name,main_image,description', 'P1,Uno,https://x.com/1,Algo']);
  assert.match(check(sinColumna, 'datos-vacios').items[0].text, /Falta la columna brand/);

  const vacia = run([FULL, ok('P1', 'Uno', { brand: '' }), ok('P2', 'Dos', { brand: '' })]);
  assert.equal(check(vacia, 'datos-vacios').notice, 'La columna brand está vacía en todo el archivo.');
});

/* ---------- Títulos y duplicados ---------- */

test('detecta palabras repetidas en el título', () => {
  assert.deepEqual([...repeatedWords('Toner Xerox B405 Negro Negro').values()], ['Negro']);
  assert.deepEqual([...repeatedWords('Kit Tinta Epson 544 Compatible Kit').values()], ['Kit']);
  assert.deepEqual([...repeatedWords('Bobina Blanco Opaco Blanco Opaco').values()], ['Blanco', 'Opaco']);
  assert.deepEqual([...repeatedWords('Tóner Hp Compatible toner').values()], ['Tóner']);
});

test('ignora conectores, números, unidades y pares con barra', () => {
  for (const name of [
    'Pizarra Acrílica Plegable Medidas 60 Cm X 90 Cm',
    'Cartucho De Tinta HP Para Plotter 712 Negro De 38 Ml',
    'Tablet TCL Tab10 10.1 Gen 4 HD 4 GB RAM 64gb',
    'Papel Vinil 50 Mts Largo 1,37 Mts Ancho',
    'UPS Spidertec On Line Px10k-20 Monofasico 220v/220v 10000va',
  ]) {
    assert.equal(repeatedWords(name).size, 0, name);
  }
});

test('nombres duplicados sin importar mayúsculas, tildes ni signos', () => {
  const result = run([
    'external_id,name,main_image',
    'P1,Cartucho Tinta Hp 712 Negro 38 Ml,https://x/1',
    'P2,Cartucho Tinta HP 712 Negro 38 ML,https://x/2',
    'P3,Tóner Hp 85a,https://x/3',
    'P4,Toner HP-85a,https://x/4',
    'P5,Otro producto,https://x/5',
  ]);
  assert.deepEqual(idsOf(result, 'nombres-duplicados'), ['P1+P2', 'P3+P4']);
});

test('variantes del mismo producto no cuentan como nombre duplicado', () => {
  const result = run([
    'external_id,name,main_image,variant_sku',
    'P1,Tóner Hp Cf400a,https://x/1,P1-A',
    'P1,Tóner Hp Cf400a,,P1-B',
  ]);
  assert.deepEqual(idsOf(result, 'nombres-duplicados'), []);
});

test('SKU de variante duplicados', () => {
  const result = run([
    'external_id,name,main_image,variant_sku,external_variant_id',
    'P1,Uno,https://x/1,P1-A,V1',
    'P1,Uno,,P1-B,V2',
    'P1,Uno,,P1-B,V2',
  ]);
  const items = check(result, 'sku-duplicados').items;
  assert.deepEqual(items.map((i) => i.ids[0]), ['P1-B', 'V2']);
  assert.match(items[0].text, /filas 3, 4/);
});

/* ---------- Ejemplo ---------- */

test('el CSV de ejemplo da el resultado esperado', () => {
  const text = fs.readFileSync(path.join(ROOT, 'ejemplos', 'ejemplo.csv'), 'utf8');
  const result = analyze(parseCSV(text));
  assert.deepEqual(idsOf(result, 'sin-imagen'), ['EJ-0002', 'EJ-0004']);
  assert.deepEqual(idsOf(result, 'imagenes-cargan'), ['EJ-0009']);
  assert.deepEqual(idsOf(result, 'categoria'), ['EJ-0004']);
  assert.deepEqual(idsOf(result, 'datos-vacios'), ['EJ-0003', 'EJ-0004']);
  assert.deepEqual(idsOf(result, 'precio-stock'), ['EJ-0006', 'EJ-0007']);
  assert.deepEqual(idsOf(result, 'dimensiones'), ['EJ-0008', 'EJ-0009']);
  assert.deepEqual(idsOf(result, 'palabras-repetidas'), ['EJ-0003', 'EJ-0008']);
  assert.deepEqual(idsOf(result, 'nombres-duplicados'), ['EJ-0005+EJ-0006']);
  assert.deepEqual(idsOf(result, 'sku-duplicados'), ['EJ-0007-B']);
});

test('el ejemplo de la página coincide con ejemplos/ejemplo.csv', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'sample.js'), 'utf8'), sandbox);
  const file = fs.readFileSync(path.join(ROOT, 'ejemplos', 'ejemplo.csv'), 'utf8');
  assert.equal(sandbox.window.SAMPLE_CSV, file);
});
