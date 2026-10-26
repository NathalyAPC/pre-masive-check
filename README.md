# Revisor de Catálogo (pre-masive-check)

Herramienta web para revisar el CSV de un catálogo de productos **antes de hacer la carga masiva**. Encuentra en segundos los errores más comunes para que se corrijan en el archivo y no después de subirlo.

Está pensada para que la use cualquier persona con conocimientos básicos de computadora: no hay que instalar nada, solo abrir la página y arrastrar el archivo.

El archivo se procesa por completo en el navegador de quien lo revisa. **No se envía a ningún servidor.** Lo único que sale a internet es la petición de cada imagen a su propio servidor, para comprobar que carga, igual que cuando se abre la imagen en el navegador.

## Qué revisa

| Revisión | Qué marca | Ejemplo |
|---|---|---|
| Productos sin imagen | Productos con `main_image` vacío en todas sus filas. | `SHI-0002` sin URL de imagen |
| Imágenes que no cargan | Enlaces mal escritos y enlaces que, al abrirlos, no cargan una imagen (no existen, no son una imagen, el servidor la bloquea o tarda más de 15 s). | `www.tienda.com/foto.jpg`, error 404 |
| Productos sin categoría | Productos sin `category_id` en ninguna de sus filas, para que no se carguen sin categoría. | `category_id` vacío |
| Precio y stock no válidos | `price` que no sea un número mayor que 0 o que tenga más de 2 decimales, o `stock` que no sea un número entero de 0 en adelante. Se revisa cada fila, también las variantes. | `$45`, `37.185`, `1,234.56`, `0`, stock `2.5` o vacío |
| Peso y dimensiones | Productos sin `weight_kg`, `width_cm`, `height_cm` o `length_cm`, o con valores que no sean números mayores que 0. | alto vacío, largo `0`, peso `1kg` |
| Marca y descripción vacías | Productos sin `brand` o sin `description` en ninguna de sus filas. | `brand` vacío |
| Palabras repetidas en el título | Palabras que aparecen dos veces en `name`. | `Toner Xerox B405 Negro Negro` |
| Nombres duplicados | Productos distintos con el mismo título, sin importar mayúsculas, tildes ni signos. | `Cartucho Tinta Hp 712` y `Cartucho Tinta HP 712` |
| SKU de variante duplicados | El mismo `variant_sku` o `external_variant_id` en más de una fila. | `SHI-0012-B` en las filas 9 y 10 |

Todo se cuenta **por producto**, no por fila. Las variantes de un producto (filas con el mismo `external_id`) cuentan una sola vez. La imagen, la categoría, las medidas, la marca y la descripción basta con que estén en una de sus filas; normalmente la primera, y las demás variantes las heredan. El precio y el stock, en cambio, se revisan en todas las filas, porque cada variante tiene los suyos.

### Reglas de los números

- `price`, `weight_kg`, `width_cm`, `height_cm` y `length_cm`: número mayor que 0. El separador decimal puede ser punto o coma. Valen `45`, `37.18`, `37,18`, `2500.00` y `0,3`. No valen símbolos ni separadores de miles (`$45`, `1,234.56`, `1.234,56`), `0` ni negativos.
- `price` además puede tener como máximo 2 decimales: vale `37.18`, no vale `37.185`. Las medidas no tienen ese límite (`0.125` kg es válido).
- Si el CSV está separado por comas y un número lleva coma decimal, esa celda debe ir entre comillas (`"37,18"`). Excel lo hace solo al guardar como CSV.
- `stock`: número entero, 0 o mayor. Valen `0` y `10`. No valen `2.5`, `-1` ni texto.
- `category_id`: no puede estar vacío. Todavía no se comprueba que la categoría exista en el sistema.

Si al archivo le falta alguna de estas columnas, la revisión correspondiente lo indica como un problema del archivo.

### Imágenes que no cargan

Primero se revisa que cada enlace esté bien escrito: que empiece con `http://` o `https://` y no tenga espacios. Después la página abre cada enlace distinto, de 6 en 6, y espera hasta 15 segundos por cada uno. Si varios productos usan la misma foto, se abre una sola vez. Mientras tanto, la revisión muestra el avance ("Verificando 120 de 236") y al terminar se actualiza el resultado.

- Necesita conexión a internet. Si no hay conexión, la revisión queda como **No verificado**; si no carga ninguna imagen, se muestra un aviso para revisar la conexión.
- El navegador no informa el motivo exacto del fallo, así que el mensaje agrupa los casos: no existe (404), no es una imagen o el servidor la bloquea.
- En el ejemplo que aparece al abrir la página solo se revisa cómo están escritos los enlaces, porque sus imágenes son inventadas.

### Palabras repetidas

Se ignoran las repeticiones normales: conectores (de, para, con, y…), números, unidades de medida (cm, ml, gb, mts…) y pares unidos por barra como `220v/220v`.

## Cómo usarla

1. Abre la herramienta. Mientras no esté publicada en un servidor, abre el archivo `index.html` con doble clic y se abrirá en tu navegador.
2. Arrastra tu CSV a la zona punteada, o pulsa **Elegir archivo**.
3. Revisa el resultado. Cada revisión dice **Todo bien** o cuántos productos hay **por revisar**, con su código, su nombre y el detalle del problema (por ejemplo, la fila y la columna con el valor incorrecto). En los títulos, las palabras repetidas aparecen resaltadas en amarillo.
4. Usa **Copiar lista** para pegar los productos en un correo, en Slack o en una hoja de cálculo.
5. Corrige tu archivo y vuelve a subirlo hasta que el resumen diga **Todo en orden**.

Al abrir la página se muestra un ejemplo con productos inventados para que se vea cómo funciona. El mismo ejemplo está en `ejemplos/ejemplo.csv` por si quieres probar a subirlo.

### Si tu archivo está en Excel

La herramienta lee archivos CSV, no `.xlsx`. En Excel ve a **Archivo → Guardar como** y elige **CSV UTF-8 (delimitado por comas)**. También acepta CSV separados por punto y coma, que es como Excel los guarda en algunos equipos en español.

## Formato del CSV

La primera fila debe ser el encabezado. Sin estas columnas el archivo no se puede revisar:

| Columna | Uso |
|---|---|
| `external_id` | Código del producto. Las filas con el mismo código son variantes del mismo producto. |
| `name` | Título del producto. |
| `main_image` | URL de la imagen principal. Puede ir solo en la primera fila del producto. |

Estas columnas también se revisan; si faltan, la herramienta lo marca como un problema del archivo:

| Columna | Uso |
|---|---|
| `brand` | Marca. Puede ir solo en la primera fila. |
| `description` | Descripción. Puede ir solo en la primera fila. |
| `category_id` | Categoría del producto. Puede ir solo en la primera fila. |
| `price` | Precio, en cada fila. |
| `stock` | Unidades disponibles, en cada fila. |
| `weight_kg`, `width_cm`, `height_cm`, `length_cm` | Peso y dimensiones. Pueden ir solo en la primera fila. |

Si están, se usan además `variant_sku` y `external_variant_id`. Las demás columnas (`attr_color`, `barcode`…) se ignoran por ahora.

El archivo puede estar en UTF-8 (con o sin BOM) o en Windows-1252, con finales de línea de Windows o de Mac/Linux, y separado por comas, punto y coma o tabuladores.

```csv
external_id,name,price,main_image,category_id,stock,variant_sku,attr_color,weight_kg,width_cm,height_cm,length_cm
SHI-0003,Auricular Logitech H390,55,https://.../foto.webp,12,8,SHI-0003-A,Negro,0.3,22,20,10
SHI-0003,Auricular Logitech H390,55,,,0,SHI-0003-B,Blanco,,,,
SHI-0004,"Caja Registradora, Cheques Y Más",155,https://.../caja.webp,31,10,,,4.5,42,36,22
```

## Lo que todavía no revisa

- Que el `category_id` exista en el sistema; solo se comprueba que no esté vacío.
- Valores fuera de lo razonable, como un peso de 500 kg o un precio muy distinto al habitual.
- Precios distintos entre variantes de un mismo producto, códigos fuera de orden o filas de un mismo producto separadas.
- Archivos de Excel (`.xlsx`) directamente.

## Estructura del proyecto

```
pre-masive-check/
├── index.html            Página principal
├── css/
│   └── styles.css        Estilos (tema claro y oscuro)
├── js/
│   ├── csv.js            Lectura del CSV: separador, comillas, codificación
│   ├── checks.js         Las revisiones y sus reglas
│   ├── images.js         Abre los enlaces de imagen para comprobar que cargan
│   ├── sample.js         Ejemplo que se muestra al abrir la página
│   └── app.js            Interfaz: subir archivo, mostrar resultados, copiar listas
├── ejemplos/
│   └── ejemplo.csv       CSV de ejemplo para probar
├── tests/
│   └── checks.test.js    Pruebas automáticas
└── package.json          Solo para correr las pruebas
```

## Desarrollo

No tiene dependencias ni paso de compilación: son archivos HTML, CSS y JavaScript que el navegador lee tal cual. Los scripts se cargan como scripts normales (no como módulos) para que la página funcione también abriendo `index.html` directamente, sin servidor.

Para verla en un servidor local:

```bash
python3 -m http.server 8080
# y abre http://localhost:8080
```

Para correr las pruebas (necesita Node 18 o superior):

```bash
npm test
```

### Agregar una revisión

Las revisiones están en la lista `CHECKS` de `js/checks.js`. Para agregar una, añade un objeto con:

- `key`: identificador corto, por ejemplo `'precio-variantes'`.
- `title` y `hint`: el título y la explicación que verá el usuario.
- `run(catalog)`: una función que recibe el catálogo agrupado por producto y devuelve una lista de `{ ids, text, note }`. Cada producto de `catalog.products` trae sus filas en `rows`, con los valores por nombre de columna (`row.values.price`).
- `notice(catalog, items)` (opcional): devuelve un aviso general que se muestra arriba de la lista, o `null`.
- `pending(catalog)` (opcional): trabajo que la página termina después, en segundo plano. Hoy solo lo usa la revisión de imágenes.

Para validar números ya existen `decimalProblem` e `integerProblem`.

La interfaz la muestra sola, con su estado y su botón de copiar. Agrega también una prueba en `tests/checks.test.js`.

Para ajustar qué palabras pueden repetirse en un título sin que se marque, edita `IGNORED_WORDS` en el mismo archivo. Las columnas de medidas están en `DIMENSION_COLUMNS` y las de texto obligatorio (marca y descripción) en `TEXT_COLUMNS`. La cantidad de imágenes que se abren a la vez y el tiempo máximo de espera están en `DEFAULTS`, en `js/images.js`.

### Cambiar el ejemplo

El ejemplo está en dos lugares: `ejemplos/ejemplo.csv` y `js/sample.js`, que es una copia para que funcione sin servidor. Si cambias uno, cambia el otro; hay una prueba que avisa si no coinciden.

## Dónde alojarla

Todavía no está decidido. Como es un sitio estático, sin servidor ni base de datos, puede publicarse en cualquier lugar que sirva archivos:

- GitHub Pages, Netlify, Vercel o Cloudflare Pages.
- Un bucket de S3 con CloudFront, o uno de Google Cloud Storage.
- Un servidor web interno (nginx, Apache).
- Sin alojar: se comparte la carpeta en un `.zip` y cada persona abre `index.html`.

Para publicarla solo hacen falta `index.html`, `css/` y `js/`. Se recomienda servirla por HTTPS para que el botón **Copiar lista** funcione en todos los navegadores. Las fuentes se cargan de Google Fonts; sin internet la página usa las fuentes del sistema y funciona igual.

Hay además una versión de prueba publicada como artefacto privado en claude.ai, con la misma lógica.
