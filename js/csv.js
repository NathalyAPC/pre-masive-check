/**
 * Lectura de archivos CSV.
 *
 * Funciona en el navegador (queda disponible como window.CsvParser)
 * y en Node (require) para las pruebas.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CsvParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DELIMITERS = [',', ';', '\t'];

  /**
   * Detecta el separador (coma, punto y coma o tabulador) contando cuántas
   * veces aparece cada uno en la primera línea, fuera de comillas.
   * Excel en español suele guardar los CSV con punto y coma.
   */
  function detectDelimiter(text) {
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (inQuotes) continue;
      if (ch === '\n' || ch === '\r') break;
      if (ch in counts) counts[ch]++;
    }
    var best = ',';
    DELIMITERS.forEach(function (d) { if (counts[d] > counts[best]) best = d; });
    return best;
  }

  /**
   * Convierte el texto de un CSV en una lista de filas; cada fila es una lista de celdas.
   * Soporta comillas, comillas escapadas (""), saltos de línea dentro de comillas,
   * finales de línea LF, CRLF o CR, y el BOM de UTF-8.
   * La fila 0 es el encabezado; el índice + 1 coincide con el número de fila en Excel.
   */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var delimiter = detectDelimiter(text);
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"' && field === '') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /**
   * Convierte los bytes del archivo en texto. Intenta UTF-8 y, si el archivo
   * no es UTF-8 válido, usa Windows-1252 (lo habitual en CSV guardados por Excel).
   */
  function decode(buffer) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(buffer);
    }
  }

  return { detectDelimiter: detectDelimiter, parseCSV: parseCSV, decode: decode };
});
