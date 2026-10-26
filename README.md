# Catalog review (pre-masive-check)

A web tool to check the bulk upload CSV **before uploading it**. It shows what the upload would reject and what is worth reviewing, so it gets fixed in the file instead of after the upload.

It is meant to be used by anyone with basic computer skills: there is nothing to install, just open the page and drag the file in. The interface is in Spanish; in this README, on-screen labels are quoted in Spanish with an English translation.

The file is processed entirely in the reviewer's browser. **It is never sent to any server.** The only thing that goes out to the internet is the request for each image to its own server, to check that it loads, just like opening the image in the browser.

## Errors and warnings

The result splits problems into two kinds:

- **Errores** (errors): what must be fixed before uploading the file. On one side, what BE validates in the bulk upload: if it is not fixed, the upload rejects the row or the product, or loads it differently than expected. These follow BE's acceptance criteria, copied in [`docs/bulk-upload-criterios-aceptacion.md`](docs/bulk-upload-criterios-aceptacion.md); the CA-x.y codes below refer to that document. On the other side, data the business requires even though BE accepts it empty: currently, the description.
- **Avisos** (warnings): data that is uploaded anyway, but worth reviewing before uploading the file (for example, a product without a category or a brand, or a description with problems).

### Errors

| Check (on screen) | What it flags | CA |
|---|---|---|
| Archivo (file) | Extension other than `.csv`, more than 50 MB, or a missing required column: `name`, `price`, `weight_kg`, `width_cm`, `height_cm`, `length_cm`. | CA-1, CA-2 |
| Filas sin nombre (rows without a name) | Empty `name` in any row, variants included. | CA-2.1 |
| Productos sin descripción (products without a description) | Empty `description` in the product's first row (or only empty HTML, such as `<p>&nbsp;</p>`). BE accepts it empty, but the business requires it. | Business |
| Precio no válido (invalid price) | `price` empty, negative, with symbols, with a thousands separator or with more than 2 decimals (it is not rounded). Every row is checked. | CA-2.1 to CA-2.3 |
| Peso y dimensiones (weight and dimensions) | A measurement is missing from the product's **first row**, is not a number greater than 0, or rounds to 0 with 2 decimals. If the measurement is in another row, the tool says so: BE only reads it from the first one. | CA-2.4, CA-2.6 |
| Stock no válido (invalid stock) | `stock` with decimals, negative or with text. | CA-3 |
| Imágenes mal referenciadas (badly referenced images) | Each image in `main_image` must be a full `http(s)` URL or a ZIP file name (no `/` or `\`) ending in `.jpg`, `.jpeg`, `.png`, `.gif` or `.webp`. Several images go separated by commas. | CA-4.1 |
| Productos que se van a partir (products that will be split) | Rows without `external_id` with the same name as a product that has one (they are loaded as another product); `post_id` missing in some rows or changing within the product; one `post_id` with several `external_id` values. | CA-3.1, CA-3.2 |
| post_id no válido (invalid post_id) | A `post_id` that is not exactly 24 hexadecimal characters. | CA-3 |
| external_variant_id repetido (repeated external_variant_id) | The same `external_variant_id` twice within a product. | CA-3 |
| Marca no válida (invalid brand) | `brand` longer than 120 characters or with characters other than letters, digits, spaces and `. , & ' + / ( ) ! -`. | CA-3 |
| requires_post_sale_action no válido (invalid value) | A value other than `sí`, `si`, `yes`, `true`, `1`, `no`, `false` or `0`. Empty is not an error. | CA-3.4 |
| Filas sin sucursal (rows without a branch) | Empty `branch_id`. **Only checked when the checkbox** "El comercio tiene más de una sucursal" (the merchant has more than one branch) is ticked, because that information is not in the CSV. | CA-2 |

### Warnings

| Check (on screen) | What it flags |
|---|---|
| Productos sin imagen (products without an image) | No row of the product has `main_image`. BE loads it without an image. |
| Variantes sin imagen (variants without an image) | Products with variants where some rows have no `main_image`. Each variant, especially when the color changes, should have its own image so the customer sees what they pick. If another row with the same color already has an image, the tool says which one, so it can be copied. It is a suggestion, not an error. |
| Imágenes que no cargan (images that don't load) | The page opens each URL and flags the ones that don't load an image. BE does not reject the product, but reports the image as an error (CA-4.3). |
| Productos sin categoría (products without a category) | Empty `category_id` in the first row. BE accepts it and the AI categorizes the product after the upload. |
| Productos sin marca (products without a brand) | Empty `brand` in the first row. The brand is not required: this only shows which products will be uploaded without one. |
| Descripción con problemas (description with problems) | Descriptions that only repeat the name, are too short, are copied from another product, are badly formatted, have repeated text or no structure. See below. |
| HTML mal escrito en la descripción (malformed description HTML) | If `description` has HTML: unclosed, unopened or crossed tags, malformed, unknown or dangerous tags (`<script>`, `onclick`…), misspelled entities (`&nbps;`) or escaped HTML (`&lt;p&gt;`). BE stores it as-is, so the error would show in the store. |
| Stock vacío (empty stock) | BE loads the variant with stock 1. |
| Precio en 0 (price 0) | BE accepts it, but the product would be published for free. |
| Columnas que no se usan (unused columns) | `condition` (BE ignores it: everything is created as new) and columns that are not in the template, such as a misspelled `prize`. |
| Palabras repetidas en el título (repeated words in the title) | Words that appear twice in `name`, such as `Negro Negro`. |
| Nombres duplicados (duplicate names) | Different products with the same title and the same attributes, ignoring case and accents. Without `external_id`, BE merges them into one (CA-5.5). |
| Posibles variantes (possible variants) | Products uploaded separately that could be a single product with variants, because their names only differ in color or size. See below. |
| variant_sku repetido (repeated variant_sku) | BE allows it (it is informational), but it is usually a mistake when copying rows. |

### How products are grouped

Same as BE: rows with the same `external_id` are variants of one product. Without `external_id`, rows are grouped by `post_id`, and without that, by name. When a product has no `external_id`, it shows in the result as **Fila N** (row N, its first row).

Product-level fields (measurements, `category_id`, `brand`, `description`) are read from the product's **first row** (CA-3.3). Price, stock and images are per variant, so they are checked in every row.

### Number rules

- `price`: a number from 0 up, with a dot or comma decimal separator and at most 2 decimals. Valid: `0`, `45`, `19.99` and `19,99`. Not valid: `1.247` (3 decimals), `1.500` or `1,234.56` (thousands separator), `$45` or negative numbers.
- `weight_kg`, `width_cm`, `height_cm`, `length_cm`: a number greater than 0, with a dot or comma decimal separator. BE rounds to 2 decimals, so `0.004` is an error (it rounds to 0) and `0.125` is valid.
- `stock`: an integer from 0 up.
- If the CSV is comma-separated and a number uses a decimal comma, that cell must be quoted (`"19,99"`). Excel does this automatically when saving as CSV.

### Images that don't load

The page opens each distinct URL, 6 at a time, and waits up to 15 seconds for each one. If several products use the same photo, it is opened only once, and changing the branches checkbox does not open them again. Meanwhile, the check shows its progress ("Verificando 120 de 236", checking 120 of 236).

- It needs an internet connection. Without one, the check is marked **No revisado** (not checked); if no image loads at all, a notice asks to check the connection.
- The browser does not report the exact reason for a failure, so the message covers all cases: it doesn't exist (404), it is not an image, or the server blocks it.
- Images given as ZIP file names cannot be checked, because the tool does not receive the ZIP.
- If there are more than 1,500 distinct URLs, the tool warns about it: BE only downloads that many and the rest stay as external links (CA-4.2).

### Description

The description is required: if it is missing, it is an **error**. If it is present, its quality is checked and each problem shows as a **warning** in "Descripción con problemas":

- **Content**: it cannot be just the product name, have fewer than 10 words, or be the same as another, different product's description (variants of the same product do share it).
- **Format**: it cannot be almost all in CAPITALS, have repeated punctuation (`!!!`, `,,`), garbled characters (`Ã©`, `�`, a sign that the file was saved with another encoding), or line breaks written as text (`\n`).
- **Repeated text**: words repeated back to back (`de de`, `negro negro`), or the same sentence of 5 or more words appearing twice.
- **Structure**: if it has more than 60 words, it must be split into paragraphs or a list, not a single block.

The check uses the text shown in the store: without HTML tags and with entities (`&nbsp;`, `&aacute;`) converted. The limits (10 words, 60 words per block, 5 words per repeated sentence) are in `DESCRIPTION`, in `js/checks.js`.

### Description HTML

Only descriptions that contain HTML are checked; plain text (even with a stray `<` or `>`, such as "precio < 5") is not flagged. HTML is considered well formed when:

- Every tag that is opened is closed, in the right order: `<p><b>text</b></p>`, not `<p><b>text</p></b>`. Tags that are never closed (`<br>`, `<hr>`, `<img>`) can be written `<br>` or `<br/>`.
- Tags are common formatting tags: paragraphs, bold, lists, tables, links, images, headings, etc. A made-up or misspelled tag (`<bold>`) is reported as unknown.
- There is nothing that could run code or break the page: `<script>`, `<style>`, `<iframe>`, forms, `on…` attributes or `javascript:` links.
- Entities exist (`&nbsp;`, `&aacute;`, `&#39;`…). A misspelled one, such as `&nbps;`, would show as-is.
- It is not escaped: `&lt;p&gt;` instead of `<p>` makes the store show the tags as text.

If a description has many problems, the first 4 are shown along with how many more there are.

### Possible variants

Suggests which products could be uploaded as a single product with variants (the same `external_id` in all of its rows). It is only a suggestion: the merchant decides, and variants with different prices are fine.

- **Color** words (Negro, Azul, Tricolor, Black, Grey…) and **size** words are removed from the name: letter sizes (S, M, L, XL…) or numbers when they really are a size. A number counts as a size if it follows "Talla" or "Size" ("Talla 36"), if it is a number from 1 to 50 at the end of the name ("Zapato Running Men 41.5"), or if it appears in the file's `attr_talla` column.
- If several different products end up with the same name, they are suggested together. For example, "Franela Polo Men Negro S", "Franela Polo Men Negro M" and "Franela Polo Men Azul L" are suggested as "Franela Polo Men".
- **Gender and age** (Men, Women, Unisex, Kids, Junior, Niño…) are never removed: Men is not grouped with Women, nor Kids with Junior or with adults.
- Two products with **exactly the same name** are suggested as variants if their `attr_` columns have a different size or color. If everything matches, they show in "Nombres duplicados".
- Products are not suggested because of **model numbers** ("Cartucho HP 667" and "HP 664" are different products), **measurements** (7mm/9mm, 30w/60w) or sharing the same photo.

### Repeated words

Normal repetitions are ignored: Spanish connectors (de, para, con, y…), numbers, units of measure (cm, ml, gb, mts…) and slash-joined pairs such as `220v/220v`.

## How to use it

1. Open the tool. Until it is published on a server, double-click `index.html` and it will open in your browser.
2. If the merchant has more than one branch, tick the branches checkbox.
3. Drag your CSV onto the dashed area, or click **Elegir archivo** (choose file).
4. Review the result. **Errores** (errors, in red) are at the top and must be fixed before uploading the file; **Avisos** (warnings, in yellow) come next. Each one shows the product, the row and what is wrong. Checks that found nothing are grouped at the end under **Sin problemas** (no problems).
5. Use **Copiar lista** (copy list) to paste the products and the reason into an email, Slack or a spreadsheet.
6. Fix your file and upload it again until there are no errors left.

### If your file is in Excel

The tool reads CSV files, not `.xlsx`. In Excel go to **File → Save As** and choose **CSV UTF-8 (Comma delimited)**. It also accepts semicolon-separated CSV files, which is how Excel saves them on some Spanish-locale computers.

## CSV format

The first row is the header; spaces and capitalization in column names don't matter. The file can be UTF-8 (with or without BOM) or Windows-1252, with Windows or Mac/Linux line endings, and separated by commas, semicolons or tabs.

| Column | Required | Level |
|---|---|---|
| `name` | Yes | Every row |
| `price` | Yes | Every row |
| `weight_kg`, `width_cm`, `height_cm`, `length_cm` | Yes | Product's first row |
| `branch_id` | Only if the merchant has more than one branch | Every row |
| `external_id`, `post_id` | No (repeat in every row of the product) | Product |
| `description`, `category_id`, `brand`, `requires_post_sale_action` | No | Product's first row |
| `main_image`, `stock`, `variant_sku`, `external_variant_id`, `barcode`, `attr_{name}` | No | Variant |

```csv
external_id,name,price,main_image,category_id,stock,variant_sku,attr_color,weight_kg,width_cm,height_cm,length_cm
SHI-0003,Auricular Logitech H390,55,https://.../foto.webp,12,8,SHI-0003-A,Negro,0.3,22,20,10
SHI-0003,Auricular Logitech H390,55,foto-blanco.jpg,,0,SHI-0003-B,Blanco,,,,
SHI-0004,"Caja Registradora, Cheques Y Más","155,90",https://.../caja.webp,31,10,,,4.5,42,36,22
```

## What it cannot check

Some BE criteria depend on data that is not in the CSV:

- Whether the `post_id` exists and belongs to the merchant, or whether the `category_id` and `branch_id` exist.
- Whether the product already exists and the upload will create or update it (CA-5), and the Cashea rules (CA-5.6).
- The ZIP contents: whether the files named in `main_image` are there, their sizes (max 10 MB per image) and the ZIP limits.
- The size of images given by URL (max 15 MB): the browser does not report it.

## Project structure

```
pre-masive-check/
├── index.html            Main page
├── css/
│   └── styles.css        Styles (light and dark themes)
├── js/
│   ├── csv.js            CSV reading: delimiter, quotes, encoding
│   ├── checks.js         The checks and their rules
│   ├── images.js         Opens image URLs to check that they load
│   └── app.js            UI: file upload, results, copyable lists
├── docs/
│   └── bulk-upload-criterios-aceptacion.md   BE acceptance criteria
├── tests/
│   └── checks.test.js    Automated tests
└── package.json          Only used to run the tests
```

## Development

There are no dependencies and no build step: these are HTML, CSS and JavaScript files the browser reads as-is. Scripts are loaded as classic scripts (not modules) so the page also works when `index.html` is opened directly, without a server.

To view it on a local server:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

To run the tests (requires Node 18 or later):

```bash
npm test
```

### Adding or changing a check

The checks live in the `CHECKS` list in `js/checks.js`. Each one is an object with:

- `key`: a short identifier, for example `'precio-variantes'`.
- `level`: `'error'` if BE rejects it or the business requires it, `'aviso'` (warning) if it is a recommendation.
- `title` and `hint`: the title and the explanation the user will see (in Spanish).
- `run(catalog)`: receives the catalog grouped by product and returns a list of `{ ids, text, note }`. Each product in `catalog.products` has its rows in `rows`, with values by column name (`row.values.price`); the first row is `rows[0]`.
- `notice(catalog, items)` (optional): a general notice shown above the list, or `null`.
- `skip(catalog)` (optional): the reason not to run the check, or `null`. Used by the branches check.
- `pending(catalog)` (optional): work the page finishes later, in the background. Used by the image check.

The UI shows it automatically in its group, with its status and its copy button. Add a test in `tests/checks.test.js` as well.

BE limits (50 MB, 1,500 URLs, 120 brand characters, 2 price decimals) are in `LIMITS`, at the top of `js/checks.js`, together with the required columns, the template columns and the accepted values. If BE changes a rule, that is the place. The measurement columns are in `DIMENSION_COLUMNS`, and the description limits in `DESCRIPTION`. The number of images opened at once and the max wait time are in `DEFAULTS`, in `js/images.js`.

## Hosting

Not decided yet. Since it is a static site, with no server or database, it can be published anywhere that serves files:

- GitHub Pages, Netlify, Vercel or Cloudflare Pages.
- An S3 bucket with CloudFront, or a Google Cloud Storage bucket.
- An internal web server (nginx, Apache).
- No hosting: share the folder as a `.zip` and everyone opens `index.html`.

Only `index.html`, `css/` and `js/` are needed to publish it. Serving it over HTTPS is recommended so the **Copiar lista** (copy list) button works in every browser. Fonts are loaded from Google Fonts; without internet, the page uses system fonts and works the same.
