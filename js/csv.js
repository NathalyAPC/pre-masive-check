/**
 * CSV reading.
 *
 * Works in the browser (exposed as window.CsvParser)
 * and in Node (require) for the tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CsvParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DELIMITERS = [',', ';', '\t'];

  /**
   * Detects the delimiter (comma, semicolon or tab) by counting how many
   * times each one appears in the first line, outside quotes.
   * Spanish-locale Excel usually saves CSV files with semicolons.
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
   * Turns CSV text into a list of rows; each row is a list of cells.
   * Supports quotes, escaped quotes (""), line breaks inside quotes,
   * LF, CRLF or CR line endings, and the UTF-8 BOM.
   * Row 0 is the header; index + 1 matches the row number in Excel.
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
   * Turns the file bytes into text. Tries UTF-8 and, if the file is not
   * valid UTF-8, falls back to Windows-1252 (common in CSV files saved by Excel).
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
