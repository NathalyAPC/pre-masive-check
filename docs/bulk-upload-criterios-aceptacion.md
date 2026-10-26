# Carga masiva — Criterios de aceptación

Qué es **obligatorio** y qué es **opcional** al subir productos por CSV (+ ZIP de
imágenes). Aplica igual al portal admin y al portal seller.

> Contexto de negocio y el porqué de cada regla: [`docs/domain/bulk-upload.md`](domain/bulk-upload.md).
> Referencia técnica de columnas: [`docs/bulk-upload-guide.md`](bulk-upload-guide.md).
> Plantilla de ejemplo: [`docs/example-bulk-create.csv`](example-bulk-create.csv).

---

## 1. Archivos

| Archivo   | Obligatorio | Criterio                                                                                                     |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| CSV       | **Sí**      | Extensión `.csv` y MIME de CSV. Máx **50 MB**. Sin CSV la carga se rechaza                                   |
| ZIP       | No          | Extensión `.zip`. Máx **50 MB** comprimido. Solo hace falta si `main_image` referencia archivos por nombre   |
| Contenido del ZIP | —   | Máx **1 500** imágenes, máx **10 MB** por imagen y **150 MB** descomprimido en total                         |

- **CA-1.1** Si no se adjunta CSV → la carga se rechaza antes de crear el job.
- **CA-1.2** Un archivo con extensión o MIME distinto al esperado (o un campo de archivo
  que no sea `csvFile`/`zipFile`) → error `400`.
- **CA-1.3** El CSV exportado desde Excel como "CSV UTF-8" (con BOM) se lee
  correctamente; los espacios alrededor de los encabezados se ignoran.

---

## 2. Columnas obligatorias

| Columna     | Nivel                                | Criterio                                                                                         | Error si falla                         |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `name`      | **Cada fila**                        | No vacío                                                                                         | `BULK_ERROR_MISSING_FIELD`             |
| `price`     | **Cada fila**                        | Número ≥ 0, **máx 2 decimales** (no se redondea). Coma o punto decimal; sin separador de miles   | `BULK_ERROR_INVALID_PRICE` / `…_TOO_MANY_DECIMALS` |
| `weight_kg` | **Por producto** (1ª fila del grupo) | Número > 0. Más de 2 decimales → se redondea a 2; si redondea a 0 → error                        | `BULK_ERROR_MISSING_MEASUREMENTS` / `…_INVALID_MEASUREMENT` |
| `width_cm`  | **Por producto** (1ª fila del grupo) | Igual que `weight_kg`                                                                            | ídem                                   |
| `height_cm` | **Por producto** (1ª fila del grupo) | Igual que `weight_kg`                                                                            | ídem                                   |
| `length_cm` | **Por producto** (1ª fila del grupo) | Igual que `weight_kg`                                                                            | ídem                                   |

- **CA-2.1** Una fila sin `name` o sin `price` se rechaza; el resto del archivo sigue.
- **CA-2.2** `price` con 3+ decimales (ej. `1.247`) se rechaza, **no** se redondea.
- **CA-2.3** `price` con separador de miles (`1.500`, `1,500`) se rechaza. `19,99` = `19.99`.
- **CA-2.4** Las 4 medidas son obligatorias en la **primera fila** de cada producto.
  Las filas siguientes (variantes) pueden dejarlas vacías.
- **CA-2.5** Las medidas son obligatorias **también en updates** — no hay excepción por
  editar un producto existente.
- **CA-2.6** El peso redondeado es el que se guarda y el que define el `shippingType`.

### Obligatoria según el caso: `branch_id`

| Sucursales del comercio | `branch_id` ausente                                        |
| ----------------------- | ---------------------------------------------------------- |
| 0                       | Se crea una sucursal por defecto                           |
| 1                       | Se usa esa sucursal                                        |
| **> 1**                 | **Obligatorio** → fila rechazada (`BULK_ERROR_BRANCH_REQUIRED`) |

- **CA-2.7** `branch_id` es el `externalId` de la sucursal que definió el comercio, no un ObjectId.
- **CA-2.8** Un miembro con sucursales restringidas no puede cargar ni editar productos
  fuera de su alcance.

---

## 3. Columnas opcionales

| Columna                     | Nivel                    | Si se omite                                              | Criterio cuando viene                                                                 |
| --------------------------- | ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `external_id`               | Producto (repetir en cada fila) | Se agrupa por hash del nombre                     | Id propio del comercio; llave de agrupación y de actualización                        |
| `post_id`                   | Producto (repetir en cada fila) | Se resuelve por `external_id` o nombre            | Exactamente 24 caracteres hex. Debe existir y ser del comercio; **nunca crea**        |
| `description`               | Producto                 | Vacía (o se preserva en update)                          | Texto libre, se guarda tal cual                                                        |
| `category_id`               | Producto                 | La IA categoriza después de la carga                     | Id de categoría del catálogo                                                           |
| `brand`                     | Producto                 | Sin marca                                                | Máx 120 caracteres; letras, números y `. , & ' + / ( ) ! -`                            |
| `main_image`                | Variante                 | Sin imagen (o se preservan las actuales en update)       | URL http(s) o nombre de archivo del ZIP; varias separadas por coma                     |
| `stock`                     | Variante + sucursal      | **1**                                                    | Entero ≥ 0                                                                             |
| `variant_sku`               | Variante                 | Se deriva                                                | Metadata; puede repetirse                                                              |
| `external_variant_id`       | Variante                 | Se deriva de `variant_sku` / atributos                   | Único dentro del producto                                                              |
| `barcode`                   | Variante                 | Vacío                                                    | Se guarda tal cual, sin validar unicidad                                               |
| `attr_{nombre}`             | Variante                 | Sin atributos (producto simple)                          | Nombre libre: `attr_color`, `attr_talla`…                                              |
| `requires_post_sale_action` | Producto                 | Default del producto                                     | `si`/`sí`/`yes`/`true`/`1` o `no`/`false`/`0`; cualquier otro valor → error de fila    |
| `condition`                 | —                        | —                                                        | **Ignorada**: todo producto se crea como `new`                                         |

- **CA-3.1** `external_id` y `post_id` deben repetirse **idénticos en cada fila** del
  producto; si solo van en la primera, las variantes se parten en otro producto.
- **CA-3.2** Filas de un mismo `post_id` con `external_id` distintos → se rechaza el producto.
- **CA-3.3** Las columnas a nivel producto se leen solo de la **primera fila** del grupo.
- **CA-3.4** `requires_post_sale_action` con un valor no reconocido (ej. "tal vez") se
  rechaza; vacío no es error.

---

## 4. Imágenes

- **CA-4.1** Referencia válida = URL `http(s)` absoluta **o** nombre de archivo (sin `/`
  ni `\`) con extensión `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`. Cualquier otra cosa
  (`www.tienda.com/a.jpg`, ruta de Windows, carpeta de Drive) → fila rechazada.
- **CA-4.2** URLs: se descargan y validan por contenido real (magic bytes); máx **15 MB**
  por imagen y máx **1 500** URLs distintas por carga. Las que exceden el tope conservan
  el link externo con un aviso.
- **CA-4.3** Una imagen que falla **no** rechaza el producto: se reporta como error de
  imagen en el job.
- **CA-4.4** En update, las imágenes se reemplazan **solo si todas** las de la fila
  resolvieron OK; si alguna falla, se conservan las anteriores.

---

## 5. Crear vs actualizar

| El CSV trae         | Resultado                                                                 |
| ------------------- | ------------------------------------------------------------------------- |
| `post_id`           | **Siempre actualiza**; si no existe o no es del comercio → error de fila  |
| solo `external_id`  | Crea si no existe, actualiza si existe                                    |
| ninguno             | Crea (agrupa por nombre); actualiza si el nombre coincide con una carga previa |

- **CA-5.1** Producto nuevo → se crea **pausado** (pendiente de publicar).
- **CA-5.2** Producto existente con algún cambio → se actualiza y **vuelve a pausarse**.
- **CA-5.3** Producto existente idéntico → no se escribe nada y cuenta como `unchanged`.
- **CA-5.4** En update, una columna opcional vacía **no borra** el valor guardado.
  `name`, `price` y las 4 medidas siguen siendo obligatorias: para no cambiarlas, se
  repite el valor actual.
- **CA-5.5** Sin `external_id`, renombrar un producto crea un **duplicado**, y dos
  productos con el mismo nombre se fusionan en uno.
- **CA-5.6** Un nuevo `price` que deja un producto con descuento y Cashea activo por
  debajo del mínimo de Cashea se rechaza (`BULK_ERROR_DISCOUNT_DISABLES_CASHEA`); no se
  cambia nada de ese producto.

---

## 6. Resultado del job

- **CA-6.1** Los errores son **por fila**: una fila inválida no detiene el resto de la carga.
- **CA-6.2** Cada error indica el número de fila del CSV (el encabezado es la fila 1) y
  el motivo.
- **CA-6.3** El job reporta conteos exactos de creados, actualizados, sin cambios y
  fallidos; el detalle por producto/imagen puede venir truncado (máx 500 entradas).
- **CA-6.4** Estados del job: `queued` → `processing` → `completed` | `failed`.

---

## Resumen rápido

| Obligatorio                                          | Opcional                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Archivo CSV                                          | Archivo ZIP                                                              |
| `name` y `price` en **cada fila**                    | `external_id`, `post_id`                                                 |
| `weight_kg`, `width_cm`, `height_cm`, `length_cm` en la **1ª fila de cada producto** (también en updates) | `description`, `category_id`, `brand`, `main_image`, `requires_post_sale_action` |
| `branch_id` **solo** si el comercio tiene más de 1 sucursal | `stock` (default 1), `variant_sku`, `external_variant_id`, `barcode`, `attr_*` |
