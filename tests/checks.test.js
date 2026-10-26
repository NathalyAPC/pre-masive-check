const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCSV, detectDelimiter } = require('../js/csv.js');
const {
  analyze, buildCatalog, repeatedWords, priceProblem, measurementProblem, stockProblem,
  imageRefProblem, imageTargets, imageLoadItems, htmlProblems, descriptionText, descriptionProblems, variantSplit,
} = require('../js/checks.js');
const { verify } = require('../js/images.js');

const run = (lines, options) => analyze(parseCSV(lines.join('\n')), options);
const check = (result, key) => result.checks.find((c) => c.key === key);
const idsOf = (result, key) => check(result, key).items.map((i) => i.ids.join('+'));
const notesOf = (result, key) => check(result, key).items.map((i) => i.note);

// Header with every checked column, to build short test cases.
const COLUMNS = ['external_id', 'name', 'price', 'main_image', 'category_id', 'stock', 'variant_sku', 'external_variant_id',
  'weight_kg', 'width_cm', 'height_cm', 'length_cm', 'brand', 'description'];
const FULL = COLUMNS.join(',');
const ok = (id, name, extra = {}) => {
  const v = {
    external_id: id, name, price: '45', main_image: 'https://img.ejemplo.com/' + id + '.webp', category_id: '10',
    stock: '3', variant_sku: '', external_variant_id: '', weight_kg: '0.3', width_cm: '22', height_cm: '20',
    length_cm: '10', brand: 'HP', description: name + ': producto de prueba con una descripción completa para la tienda.', ...extra,
  };
  return COLUMNS.map((c) => v[c]).join(',');
};
// Variant: only per-row data; product-level columns are left empty.
const variant = (id, name, extra = {}) => ok(id, name, {
  main_image: '', category_id: '', weight_kg: '', width_cm: '', height_cm: '', length_cm: '', brand: '', description: '', ...extra,
});

/* ---------- CSV reading ---------- */

test('lee comillas, comas dentro de comillas, comillas escapadas, CRLF y BOM (CA-1.3)', () => {
  const rows = parseCSV('\uFEFFa,b\r\n"Caja, grande","Dice ""hola"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['Caja, grande', 'Dice "hola"']]);
});

test('detecta CSV separados por punto y coma', () => {
  assert.equal(detectDelimiter('external_id;name;main_image\nA;B;C'), ';');
  const rows = parseCSV('external_id;name;main_image\nA1;"Mouse; negro";');
  assert.deepEqual(rows[1], ['A1', 'Mouse; negro', '']);
});

test('ignora espacios y mayúsculas en los encabezados (CA-1.3)', () => {
  const result = run([' External_ID , Name ,price,weight_kg,width_cm,height_cm,length_cm', 'P1,Uno,10,1,1,1,1']);
  assert.deepEqual(idsOf(result, 'archivo'), []);
  assert.deepEqual(idsOf(result, 'nombre'), []);
});

test('rechaza archivos vacíos o sin ninguna columna de la plantilla', () => {
  assert.match(analyze(parseCSV('')).error, /vacío/);
  assert.match(run(['a,b', '1,2']).error, /No reconozco ninguna columna/);
  assert.match(run(['name,price']).error, /No encontré filas/);
});

test('un archivo correcto no tiene errores ni avisos', () => {
  const result = run([FULL, ok('P1', 'Mouse Usb'), ok('P2', 'Teclado Usb')]);
  for (const c of result.checks) assert.deepEqual(c.items, [], c.key);
});

/* ---------- File and required columns ---------- */

test('marca extensión distinta de .csv, archivos de más de 50 MB y columnas obligatorias que faltan', () => {
  const result = run(['external_id,name,main_image', 'P1,Uno,https://x.com/1.jpg'], { file: { name: 'catalogo.txt', size: 60 * 1024 * 1024 } });
  const texts = check(result, 'archivo').items.map((i) => i.text);
  assert.deepEqual(texts, [
    'El archivo no termina en .csv',
    'El archivo pesa 60.0 MB',
    'Faltan las columnas price, weight_kg, width_cm, height_cm, length_cm',
  ]);
});

/* ---------- Grouping by product ---------- */

test('agrupa por external_id; sin external_id, por nombre (CA-3)', () => {
  const catalog = buildCatalog(parseCSV([
    'external_id,name,price',
    'P1,Uno,1', 'P1,Uno,1', ',Dos,1', ',Dos,1', ',,1',
  ].join('\n')));
  assert.deepEqual([...catalog.products.values()].map((p) => [p.label, p.rows.length]), [['P1', 2], ['Fila 4', 2], ['Fila 6', 1]]);
});

/* ---------- Name and price ---------- */

test('name es obligatorio en cada fila, también en variantes (CA-2.1)', () => {
  const result = run([FULL, ok('P1', 'Uno', { variant_sku: 'A' }), variant('P1', '', { variant_sku: 'B' })]);
  assert.deepEqual(notesOf(result, 'nombre'), ['Fila 3: name está vacío']);
});

test('reglas del precio (CA-2.1 a CA-2.3)', () => {
  for (const good of ['0', '45', '19.99', '19,99', '2500.00', '45.5']) assert.equal(priceProblem(good), null, good);
  assert.match(priceProblem(''), /vacío/);
  assert.match(priceProblem('-5'), /negativo/);
  assert.match(priceProblem('1.247'), /más de 2 decimales.*no lo redondea.*separador de miles/);
  assert.match(priceProblem('1.2475'), /más de 2 decimales/);
  assert.match(priceProblem('1.500'), /separador de miles/);
  assert.match(priceProblem('1,500'), /separador de miles/);
  assert.match(priceProblem('1,234.56'), /usa separador de miles/);
  assert.match(priceProblem('1.234,56'), /usa separador de miles/);
  for (const bad of ['$45', 'abc', '45 usd', ',5']) assert.match(priceProblem(bad), /no es un número/, bad);
});

test('revisa el precio en cada fila y avisa el precio 0', () => {
  const result = run([
    FULL,
    ok('P1', 'Bien', { price: '"19,99"' }),
    ok('P2', 'Tres decimales', { variant_sku: 'A' }),
    variant('P2', 'Tres decimales', { variant_sku: 'B', price: '1.247' }),
    ok('P3', 'Gratis', { price: '0' }),
  ]);
  assert.deepEqual(idsOf(result, 'precio'), ['P2']);
  assert.match(notesOf(result, 'precio')[0], /^Fila 4: price tiene más de 2 decimales/);
  assert.deepEqual(notesOf(result, 'precio-cero'), ['Fila 5: price es 0']);
});

/* ---------- Measurements ---------- */

test('reglas de las medidas (CA-2.4, CA-2.6)', () => {
  for (const good of ['0.3', '0,3', '22', '0.125', '0.005']) assert.equal(measurementProblem(good), null, good);
  assert.equal(measurementProblem(''), 'falta');
  assert.match(measurementProblem('0'), /es 0/);
  assert.match(measurementProblem('0.004'), /se redondea a 0/);
  assert.match(measurementProblem('-1'), /negativo/);
  assert.match(measurementProblem('1kg'), /no es un número/);
});

test('las medidas se exigen en la primera fila del producto; las variantes pueden dejarlas vacías', () => {
  const result = run([
    FULL,
    ok('P1', 'Variantes heredan', { variant_sku: 'A' }),
    variant('P1', 'Variantes heredan', { variant_sku: 'B' }),
    ok('P2', 'Sin alto', { height_cm: '' }),
    ok('P3', 'Medida en la segunda fila', { weight_kg: '', variant_sku: 'A' }),
    variant('P3', 'Medida en la segunda fila', { weight_kg: '0.5', variant_sku: 'B' }),
    ok('P4', 'Sin medidas', { weight_kg: '', width_cm: '', height_cm: '', length_cm: '' }),
  ]);
  assert.deepEqual(idsOf(result, 'medidas'), ['P2', 'P3', 'P4']);
  const notes = notesOf(result, 'medidas');
  assert.equal(notes[0], 'Fila 4: falta height_cm');
  assert.match(notes[1], /^Fila 5: falta weight_kg \(está en la fila 6, pero BE solo lo lee de la primera fila/);
  assert.equal(notes[2], 'Fila 7: faltan weight_kg, width_cm, height_cm, length_cm');
});

/* ---------- Stock ---------- */

test('stock: entero de 0 en adelante; vacío es un aviso porque se carga con 1', () => {
  for (const good of ['0', '10']) assert.equal(stockProblem(good), null, good);
  assert.match(stockProblem('2.5'), /entero/);
  assert.match(stockProblem('-1'), /negativo/);
  assert.match(stockProblem('diez'), /no es un número/);

  const result = run([FULL, ok('P1', 'Decimal', { stock: '2.5' }), ok('P2', 'Vacío', { stock: '' })]);
  assert.deepEqual(idsOf(result, 'stock'), ['P1']);
  assert.deepEqual(notesOf(result, 'stock-vacio'), ['Fila 3: se cargará con stock 1']);
});

/* ---------- Images ---------- */

test('referencias de imagen válidas: URL http(s) o nombre de archivo del ZIP (CA-4.1)', () => {
  for (const good of ['https://http2.mlstatic.com/D_NQ_NP_2X_1-O.webp', 'http://shopink.com.ve/a.jpg', 'foto.jpg', 'FOTO 1.PNG', 'a.webp', 'b.gif', 'c.jpeg'])
    assert.equal(imageRefProblem(good), null, good);
  assert.match(imageRefProblem('www.tienda.com/a.jpg'), /no puede llevar \//);
  assert.match(imageRefProblem('C:\\fotos\\a.jpg'), /no puede llevar/);
  assert.match(imageRefProblem('foto.bmp'), /nombre de archivo/);
  assert.match(imageRefProblem('https://tienda.com/mi foto.jpg'), /espacios/);
  assert.match(imageRefProblem('https://localhost/a.png'), /no es una URL válida/);
});

test('revisa cada imagen de la celda, también cuando vienen varias separadas por coma', () => {
  const result = run([FULL, ok('P1', 'Varias', { main_image: '"https://x.com/a.jpg, foto.png, www.x.com/b.jpg"' })]);
  assert.deepEqual(notesOf(result, 'imagen-formato'), ['Fila 2: "www.x.com/b.jpg" no es una URL http(s) ni un nombre de archivo (no puede llevar / ni \\)']);
  const c = check(result, 'imagenes-cargan');
  assert.deepEqual(c.pending.map((t) => t.url), ['https://x.com/a.jpg']);
  assert.match(c.notice, /1 imagen es un nombre de archivo del ZIP/);
});

test('cada URL se abre una sola vez aunque la usen varios productos', () => {
  const result = run([
    FULL,
    ok('P1', 'Uno', { main_image: 'https://x.com/compartida.webp' }),
    ok('P2', 'Dos', { main_image: 'https://x.com/compartida.webp' }),
  ]);
  assert.deepEqual(check(result, 'imagenes-cargan').pending.map((t) => [t.url, t.products.map((p) => p.label)]),
    [['https://x.com/compartida.webp', ['P1', 'P2']]]);
});

test('avisa cuando hay más URLs distintas de las que BE descarga (CA-4.2)', () => {
  const lines = [FULL];
  for (let i = 0; i < 1501; i++) lines.push(ok('P' + i, 'Producto ' + i));
  assert.match(check(run(lines), 'imagenes-cargan').notice, /Hay 1501 URLs distintas: BE descarga como máximo 1500/);
});

test('las URLs que no cargan se muestran por producto', () => {
  const catalog = buildCatalog(parseCSV([FULL,
    ok('P1', 'Uno', { main_image: 'https://a.com/ok.webp' }),
    ok('P2', 'Dos', { main_image: 'https://a.com/rota.webp' }),
  ].join('\n')));
  const results = new Map([['https://a.com/ok.webp', null], ['https://a.com/rota.webp', 'no carga']]);
  const items = imageLoadItems(imageTargets(catalog), results);
  assert.deepEqual(items.map((i) => [i.ids[0], i.note]), [['P2', 'La imagen no carga: https://a.com/rota.webp']]);
});

test('variantes sin imagen son una sugerencia; indica si el mismo color ya tiene imagen', () => {
  const header = 'external_id,name,price,main_image,attr_color,attr_talla,weight_kg,width_cm,height_cm,length_cm';
  const result = run([
    header,
    'P1,Zapato,10,https://x.com/negro.jpg,Negro,40,1,1,1,1',
    'P1,Zapato,10,,Negro,41,,,,',
    'P1,Zapato,10,,Azul,40,,,,',
    'P1,Zapato,10,https://x.com/azul.jpg,Azul,41,,,,',
    'P2,Gorra,10,https://x.com/gorra-negra.jpg,Negro,,1,1,1,1',
    'P2,Gorra,10,https://x.com/gorra-blanca.jpg,Blanco,,,,,',
    'P3,Sin fotos,10,,Negro,,1,1,1,1',
    'P3,Sin fotos,10,,Blanco,,,,,',
  ]);
  const c = check(result, 'variantes-sin-imagen');
  assert.equal(c.level, 'aviso');
  assert.deepEqual(c.items.map((i) => i.ids[0]), ['P1'], 'P3 ya sale en "Productos sin imagen"');
  assert.equal(c.items[0].note, '2 de 4 variantes sin imagen · Fila 3 (Negro): el mismo color tiene imagen en la fila 2 · Fila 4 (Azul): el mismo color tiene imagen en la fila 5');
  assert.deepEqual(idsOf(result, 'sin-imagen'), ['P3']);
});

test('productos sin ninguna imagen son un aviso', () => {
  const result = run([FULL, ok('P1', 'Sin foto', { main_image: '', variant_sku: 'A' }), variant('P1', 'Sin foto', { variant_sku: 'B' })]);
  assert.deepEqual(idsOf(result, 'sin-imagen'), ['P1']);
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

/* ---------- external_id, post_id and variants ---------- */

test('filas sin external_id se separan del producto (CA-3.1)', () => {
  const result = run([
    FULL,
    ok('P1', 'Tóner Hp', { variant_sku: 'A' }),
    variant('', 'Tóner Hp', { variant_sku: 'B' }),
    variant('', 'Tóner Hp', { variant_sku: 'C' }),
  ]);
  assert.deepEqual(idsOf(result, 'agrupacion'), ['P1']);
  assert.match(notesOf(result, 'agrupacion')[0], /^Filas 3, 4 sin external_id: se cargarán como un producto aparte/);
  assert.deepEqual(idsOf(result, 'nombres-duplicados'), [], 'no se repite como nombre duplicado');
});

test('post_id: 24 caracteres hexadecimales, en todas las filas y con un solo external_id (CA-3.1, CA-3.2)', () => {
  const good = 'a'.repeat(24);
  const result = run([
    'external_id,post_id,name,price,weight_kg,width_cm,height_cm,length_cm',
    `P1,${good},Uno,1,1,1,1,1`,
    `P1,,Uno,1,,,,`,
    `P2,${'b'.repeat(24)},Dos,1,1,1,1,1`,
    `P3,${'b'.repeat(24)},Tres,1,1,1,1,1`,
    'P4,123,Cuatro,1,1,1,1,1',
  ]);
  assert.deepEqual(check(result, 'agrupacion').items.map((i) => i.ids[0] + ': ' + i.note), [
    'P1: Fila 3 sin post_id: repítelo en todas las filas del producto',
    'bbbbbbbbbbbbbbbbbbbbbbbb: Aparece con external_id P2, P3: BE rechaza el producto.',
  ]);
  assert.deepEqual(notesOf(result, 'post-id'), ['Fila 6: "123" tiene 3 caracteres o no es hexadecimal']);
});

test('external_variant_id no se repite dentro del producto; variant_sku repetido es solo un aviso', () => {
  const result = run([
    FULL,
    ok('P1', 'Uno', { variant_sku: 'SKU-A', external_variant_id: 'NEGRO' }),
    variant('P1', 'Uno', { variant_sku: 'SKU-A', external_variant_id: 'NEGRO' }),
    ok('P2', 'Dos', { external_variant_id: 'NEGRO' }),
  ]);
  assert.deepEqual(notesOf(result, 'variante-repetida'), ['"NEGRO" en las filas 2, 3']);
  assert.deepEqual(idsOf(result, 'sku-duplicados'), ['SKU-A']);
});

/* ---------- Brand, post-sale action, branch ---------- */

test('brand: hasta 120 caracteres y solo caracteres permitidos', () => {
  const result = run([
    FULL,
    ok('P1', 'Bien', { brand: "\"Klip Xtreme, D'Art & Co. (Pro)+/!-\"" }),
    ok('P2', 'Símbolo', { brand: 'Agiler™' }),
    ok('P3', 'Larga', { brand: 'M'.repeat(121) }),
  ]);
  assert.deepEqual(idsOf(result, 'marca'), ['P2', 'P3']);
  assert.match(notesOf(result, 'marca')[0], /caracteres no permitidos: ™/);
  assert.match(notesOf(result, 'marca')[1], /121 caracteres \(máximo 120\)/);
});

test('requires_post_sale_action acepta sí/no y equivalentes; vacío no es error (CA-3.4)', () => {
  const lines = ['name,price,weight_kg,width_cm,height_cm,length_cm,requires_post_sale_action'];
  for (const v of ['sí', 'SI', 'yes', 'true', '1', 'no', 'False', '0', '', 'tal vez']) lines.push(`Producto ${v || 'vacío'},1,1,1,1,1,${v}`);
  assert.deepEqual(notesOf(run(lines), 'post-venta'), ['Fila 11: "tal vez" no es un valor válido (usa sí o no)']);
});

test('branch_id solo se exige si el comercio tiene más de una sucursal', () => {
  const lines = [FULL + ',branch_id', ok('P1', 'Uno') + ',S1', ok('P2', 'Dos') + ','];
  assert.ok(check(run(lines), 'sucursal').skipped);
  assert.deepEqual(notesOf(run(lines, { multipleBranches: true }), 'sucursal'), ['Fila 3 sin branch_id']);
  assert.match(check(run([FULL, ok('P1', 'Uno')], { multipleBranches: true }), 'sucursal').items[0].text, /Falta la columna branch_id/);
});

/* ---------- Business warnings ---------- */

test('categoría, marca y descripción se leen de la primera fila (CA-3.3)', () => {
  const result = run([
    FULL,
    ok('P1', 'Sin categoría', { category_id: '' }),
    ok('P2', 'Categoría en variante', { category_id: '', variant_sku: 'A' }),
    variant('P2', 'Categoría en variante', { category_id: '7', variant_sku: 'B' }),
    ok('P3', 'Sin marca', { brand: '' }),
  ]);
  assert.deepEqual(idsOf(result, 'categoria'), ['P1', 'P2']);
  assert.match(notesOf(result, 'categoria')[1], /Está en la fila 4, pero BE solo lo lee de la primera fila/);
  assert.deepEqual(idsOf(result, 'sin-marca'), ['P3']);
});

test('avisa columnas vacías en todo el archivo o que faltan', () => {
  const vacia = run([FULL, ok('P1', 'Uno', { category_id: '', brand: '' }), ok('P2', 'Dos', { category_id: '', brand: '' })]);
  assert.match(check(vacia, 'categoria').notice, /vacía en todo el archivo/);
  assert.equal(check(vacia, 'sin-marca').notice, 'La columna brand está vacía en todo el archivo.');

  const sinColumnas = run(['name,price,weight_kg,width_cm,height_cm,length_cm', 'Uno,1,1,1,1,1']);
  assert.match(check(sinColumnas, 'categoria').items[0].text, /No hay columna category_id/);
  assert.match(check(sinColumnas, 'sin-marca').items[0].text, /No hay columna brand/);
  assert.equal(check(sinColumnas, 'sin-descripcion').level, 'error');
  assert.match(check(sinColumnas, 'sin-descripcion').items[0].text, /Falta la columna description/);
  assert.match(check(sinColumnas, 'stock-vacio').items[0].note, /stock 1/);
  assert.match(check(sinColumnas, 'sin-imagen').items[0].text, /No hay columna main_image/);
});

test('avisa columnas ignoradas o que no son de la plantilla', () => {
  const result = run(['name,price,weight_kg,width_cm,height_cm,length_cm,condition,prize,attr_color', 'Uno,1,1,1,1,1,new,2,Negro']);
  assert.deepEqual(check(result, 'columnas').items.map((i) => i.text), ['Columna condition', 'Columna "prize"']);
});

/* ---------- Description HTML ---------- */

test('HTML bien escrito o texto sin HTML no tiene problemas', () => {
  for (const ok of [
    'Texto sin HTML', 'Precio < 5 y peso > 3', '<p>Hola</p>', '<p>a<br>b<br/>c</p>',
    '<p><b>CARACTERISTICAS</b></p><p>&nbsp;</p>', '<p>&aacute; &#39; &#x2014; &amp;</p>',
    '<ul><li>Uno</li><li>Dos</li></ul>', '<a href="https://tienda.com">ver</a>', '<!-- nota --><p>x</p>',
  ]) assert.deepEqual(htmlProblems(ok), [], ok);
});

test('detecta etiquetas sin cerrar, sin abrir, cruzadas y mal escritas', () => {
  assert.deepEqual(htmlProblems('<p>Hola'), ['<p> sin cerrar']);
  assert.deepEqual(htmlProblems('<p>a<p>b<p>c'), ['<p> sin cerrar (3 veces)']);
  assert.deepEqual(htmlProblems('</p>hola'), ['cierra </p> sin haberla abierto']);
  assert.deepEqual(htmlProblems('<b><i>x</b></i>'), ['etiquetas cruzadas: </b> se cierra antes que <i>']);
  assert.deepEqual(htmlProblems('<p>a</br></p>'), ['</br> no existe: <br> no se cierra']);
  assert.deepEqual(htmlProblems('<div/>'), ['<div/> no cierra la etiqueta: usa <div></div>']);
  assert.match(htmlProblems('<p class="a>texto</p>')[0], /etiqueta mal escrita/);
  assert.match(htmlProblems('< p>x</p>')[0], /sobra el espacio/);
});

test('detecta etiquetas desconocidas o peligrosas, entidades mal escritas y HTML escapado', () => {
  assert.deepEqual(htmlProblems('<bold>x</bold>'), ['etiqueta desconocida <bold>']);
  assert.deepEqual(htmlProblems('<script>alert(1)</script>'), ['etiqueta no permitida <script>']);
  assert.match(htmlProblems('<p onclick="x()">a</p>')[0], /atributos de script/);
  assert.match(htmlProblems('<a href="javascript:x()">a</a>')[0], /javascript:/);
  assert.deepEqual(htmlProblems('<p>&nbps;</p>'), ['entidad desconocida &nbps; (¿mal escrita?)']);
  assert.match(htmlProblems('&lt;p&gt;Hola&lt;/p&gt;')[0], /etiquetas escapadas/);
});

test('revisa la descripción de la primera fila y resume si hay muchos problemas', () => {
  const result = run([
    FULL,
    ok('P1', 'Bien', { description: '<p>Hola</p>' }),
    ok('P2', 'Mal', { description: '<p>Hola' }),
    ok('P3', 'Muchos', { description: '<bold><x1><x2><x3><x4>' }),
  ]);
  assert.deepEqual(idsOf(result, 'html'), ['P2', 'P3']);
  assert.equal(notesOf(result, 'html')[0], 'Fila 3: <p> sin cerrar');
  assert.match(notesOf(result, 'html')[1], /y \d+ más$/);
});

/* ---------- Description ---------- */

test('la descripción es obligatoria (error) y se lee de la primera fila; la marca es solo un aviso', () => {
  const result = run([
    FULL,
    ok('P1', 'Bien'),
    ok('P2', 'Sin descripción', { description: '' }),
    ok('P3', 'Descripción en la variante', { description: '', variant_sku: 'A' }),
    variant('P3', 'Descripción en la variante', { description: 'Texto que está en la segunda fila del producto, no en la primera.', variant_sku: 'B' }),
    ok('P4', 'Solo HTML vacío', { description: '<p>&nbsp;</p>' }),
    ok('P5', 'Sin marca', { brand: '' }),
  ]);
  assert.equal(check(result, 'sin-descripcion').level, 'error');
  assert.deepEqual(idsOf(result, 'sin-descripcion'), ['P2', 'P3', 'P4']);
  assert.match(notesOf(result, 'sin-descripcion')[1], /está en la fila 5, pero BE solo la lee de la primera fila/);
  assert.equal(check(result, 'sin-marca').level, 'aviso');
  assert.deepEqual(idsOf(result, 'sin-marca'), ['P5']);
});

test('texto visible de la descripción: sin etiquetas, con entidades y párrafos', () => {
  assert.equal(descriptionText('<p>Hola&nbsp;mundo</p><ul><li>Uno</li><li>Dos &amp; tres</li></ul>'), 'Hola mundo\nUno\nDos & tres');
  assert.equal(descriptionText('<P>&Aacute;rbol&#39;s</P>'), "Árbol's");
});

test('una descripción bien escrita no tiene problemas', () => {
  for (const d of [
    'Franela de algodón peinado, cuello polo y botones. Ideal para uso diario en la oficina.',
    '<p>Franela de algodón peinado.</p><ul><li>Cuello polo</li><li>Botones de nácar</li><li>Tallas S a XL</li></ul>',
    '<p>Tóner HP 212A original.</p><p>- Rendimiento: 5.500 páginas</p><p>Rendimiento 5.500 páginas en negro.</p>',
  ]) assert.deepEqual(descriptionProblems(d, 'Franela'), [], d);
});

test('detecta descripciones que solo repiten el nombre o son muy cortas', () => {
  assert.deepEqual(descriptionProblems('Mouse USB Negro', 'Mouse Usb Negro'), ['solo repite el nombre del producto']);
  assert.deepEqual(descriptionProblems('<p>Mouse USB Negro.</p>', 'Mouse Usb Negro'), ['solo repite el nombre del producto']);
  assert.match(descriptionProblems('Audífonos inalámbricos', 'Audífonos Bluetooth')[0], /es muy corta \(2 palabras\)/);
});

test('detecta problemas de formato', () => {
  assert.deepEqual(descriptionProblems('FRANELA DE ALGODON PEINADO CON CUELLO POLO IDEAL PARA EL USO DIARIO', 'F'), ['está casi toda en MAYÚSCULAS']);
  assert.match(descriptionProblems('Franela de algodón peinado con cuello polo!!! Ideal para el día a día.', 'F')[0], /signos repetidos/);
  assert.match(descriptionProblems('Franela de algodÃ³n peinado con cuello polo ideal para el uso diario', 'F')[0], /mal codificados/);
  assert.match(descriptionProblems('Franela de algodón peinado.\\nIdeal para el uso diario con cuello polo.', 'F')[0], /\\n/);
});

test('detecta texto repetido: palabras seguidas y frases', () => {
  assert.deepEqual(descriptionProblems('Franela de de algodón peinado con cuello polo y botones de nácar.', 'F'), ['repite palabras seguidas: "de de"']);
  assert.match(descriptionProblems('Franela de algodón peinado. Ideal para uso diario en la oficina. Ideal para uso diario en la oficina.', 'F')[0],
    /repite la frase "Ideal para uso diario en la oficina\."/);
});

test('detecta descripciones largas en un solo bloque', () => {
  const long = Array.from({ length: 13 }, () => 'Texto de la descripción sin párrafos.').join(' ');
  const problems = descriptionProblems(long, 'F');
  assert.ok(problems.some((p) => /un solo bloque de 78 palabras/.test(p)), problems.join(' | '));
});

test('detecta la misma descripción en productos distintos', () => {
  const desc = '"Cable de cobre con conectores dorados, ideal para televisores, consolas y monitores."';
  const result = run([FULL, ok('P1', 'Cable HDMI 2 Metros', { description: desc }), ok('P2', 'Cable HDMI 5 Metros', { description: desc }), ok('P3', 'Otro')]);
  assert.deepEqual(notesOf(result, 'descripcion-calidad'), [
    'Fila 2: es igual a la descripción de P2',
    'Fila 3: es igual a la descripción de P1',
  ]);
});

/* ---------- Titles and duplicates ---------- */

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
    FULL,
    ok('P1', 'Cartucho Tinta Hp 712 Negro 38 Ml'),
    ok('P2', 'Cartucho Tinta HP 712 Negro 38 ML'),
    ok('P3', 'Tóner Hp 85a'),
    ok('P4', 'Toner HP-85a'),
    ok('P5', 'Otro producto'),
  ]);
  assert.deepEqual(idsOf(result, 'nombres-duplicados'), ['P1+P2', 'P3+P4']);
});

/* ---------- Possible variants ---------- */

test('separa el nombre en base y palabras de color o talla', () => {
  const none = new Set();
  assert.deepEqual(variantSplit('Franela Polo Men Negro S', none), { base: 'franela polo men', vary: 'negro s' });
  assert.deepEqual(variantSplit('Zapato Running Men 41.5', none), { base: 'zapato running men', vary: '41.5' });
  assert.deepEqual(variantSplit('Sandalia Playa Talla 36', none), { base: 'sandalia playa', vary: '36' });
  assert.deepEqual(variantSplit('Cartucho HP 667 Negro', none), { base: 'cartucho hp 667', vary: 'negro' }, 'un modelo no es talla');
  assert.deepEqual(variantSplit('Kit Tinta 4 Colores', none), { base: 'kit tinta 4 colores', vary: '' });
  assert.deepEqual(variantSplit('Pantalón Cargo 32 Azul', new Set(['32'])), { base: 'pantalon cargo', vary: '32 azul' }, 'número que está en attr_talla');
});

const VARIANTS_HEADER = 'external_id,name,price,weight_kg,width_cm,height_cm,length_cm,attr_color,attr_talla';
const vrow = (id, name, color = '', talla = '') => `${id},${name},20,1,1,1,1,${color},${talla}`;

test('sugiere variantes por color y talla, sin mezclar género ni edad', () => {
  const result = run([
    VARIANTS_HEADER,
    vrow('A1', 'Franela Polo Men Negro S'), vrow('A2', 'Franela Polo Men Negro M'), vrow('A3', 'Franela Polo Men Azul L'),
    vrow('B1', 'Franela Polo Women Negro S'), vrow('B2', 'Franela Polo Women Rosa M'),
    vrow('C1', 'Franela Polo Kids Negro S'), vrow('C2', 'Franela Polo Kids Azul M'),
    vrow('D1', 'Franela Polo Junior Negro M'),
    vrow('F1', 'Zapato Running Men 40'), vrow('F2', 'Zapato Running Men 41.5'), vrow('F3', 'Zapato Running Women 38'),
    vrow('H1', 'Cartucho Original HP 667 Negro'), vrow('H2', 'Cartucho Original HP 664 Negro'),
  ]);
  assert.deepEqual(idsOf(result, 'posibles-variantes'), ['A1+A2+A3', 'B1+B2', 'C1+C2', 'F1+F2']);
  const first = check(result, 'posibles-variantes').items[0];
  assert.equal(first.text, 'Agrupar como "Franela Polo Men"');
  assert.equal(first.note, 'A1: Negro S · A2: Negro M · A3: Azul L');
});

test('el nombre sugerido conserva puntos y guiones del original', () => {
  const result = run([
    VARIANTS_HEADER,
    vrow('A1', 'Audífonos Bluetooth 5.0 Negro'), vrow('A2', 'Audífonos Bluetooth 5.0 Blanco'),
    vrow('B1', 'RS D-Kicks - Grey/Orange'), vrow('B2', 'RS D-Kicks - Black'),
    vrow('C1', 'Sandalia Playa Talla 36'), vrow('C2', 'Sandalia Playa Talla 37'),
  ]);
  assert.deepEqual(check(result, 'posibles-variantes').items.map((i) => i.text), [
    'Agrupar como "Audífonos Bluetooth 5.0"', 'Agrupar como "RS D-Kicks"', 'Agrupar como "Sandalia Playa"',
  ]);
});

test('mismo nombre con distinta talla en attr_ son variantes; si todo coincide, es un duplicado', () => {
  const result = run([
    VARIANTS_HEADER,
    vrow('B1', 'Bota Trekking Men', 'Marrón', '42'), vrow('B2', 'Bota Trekking Men', 'Marrón', '43'),
    vrow('M1', 'Mouse Pad Gamer XL'), vrow('M2', 'Mouse Pad Gamer XL'),
  ]);
  assert.deepEqual(idsOf(result, 'posibles-variantes'), ['B1+B2']);
  assert.equal(check(result, 'posibles-variantes').items[0].note, 'B1: Marrón 42 · B2: Marrón 43');
  assert.deepEqual(idsOf(result, 'nombres-duplicados'), ['M1+M2']);
});

test('no sugiere como variante una fila que ya se marca como producto partido', () => {
  const result = run([FULL, ok('P1', 'Tóner Hp', { variant_sku: 'A' }), variant('', 'Tóner Hp Negro', { variant_sku: 'B' })]);
  assert.deepEqual(idsOf(result, 'posibles-variantes'), ['P1+Fila 3'], 'nombre distinto: sí es candidata');
  const split = run([FULL, ok('P1', 'Tóner Hp', { variant_sku: 'A' }), variant('', 'Tóner Hp', { variant_sku: 'B', external_variant_id: 'X' })]);
  assert.deepEqual(idsOf(split, 'posibles-variantes'), []);
  assert.deepEqual(idsOf(split, 'agrupacion'), ['P1']);
});
