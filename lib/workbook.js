import * as XLSX from 'xlsx';

import { normalizeWhitespace } from './lookup.js';

export function needsLookup(value) {
  const normalized = normalizeWhitespace(value).toUpperCase();
  return !normalized || normalized === '?' || normalized === 'NEEDS_REVIEW';
}

function getFirstSheet(workbook) {
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) {
    throw new Error('Workbook has no sheets');
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error('Workbook sheet could not be read');
  }

  return { sheetName, sheet };
}

function extractHeaders(sheet) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const headers = [];

  for (let column = range.s.c; column <= range.e.c; column++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: column });
    const cell = sheet[cellAddress];
    headers.push(cell ? String(cell.v) : '');
  }

  return headers;
}

function readRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

export function parseWorkbookSummary(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const { sheet } = getFirstSheet(workbook);
  const headers = extractHeaders(sheet);
  const rows = readRows(sheet);

  if (!headers.includes('securityName') || !headers.includes('tickerSymbol')) {
    throw new Error('Spreadsheet must include securityName and tickerSymbol columns');
  }

  const lookupRows = rows.filter(row => needsLookup(row.tickerSymbol) && normalizeWhitespace(row.securityName));
  const uniqueNames = [...new Set(
    lookupRows
      .map(row => normalizeWhitespace(row.securityName))
      .filter(Boolean)
  )];

  return {
    headers,
    totalRows: rows.length,
    existingRows: rows.length - lookupRows.length,
    lookupRows: lookupRows.length,
    uniqueNames
  };
}

export function buildEnrichedWorkbook(buffer, resultsByName) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const { sheetName, sheet } = getFirstSheet(workbook);
  const headers = extractHeaders(sheet);
  const rows = readRows(sheet);

  const enrichedRows = rows.map(row => {
    if (!needsLookup(row.tickerSymbol)) {
      return row;
    }

    const securityName = normalizeWhitespace(row.securityName);
    const match = resultsByName[securityName];
    if (!match?.ticker) {
      return row;
    }

    return {
      ...row,
      tickerSymbol: match.ticker
    };
  });

  const nextSheet = XLSX.utils.json_to_sheet(enrichedRows, { header: headers });
  if (sheet['!cols']) {
    nextSheet['!cols'] = sheet['!cols'];
  }

  if (nextSheet['!ref']) {
    const range = XLSX.utils.decode_range(nextSheet['!ref']);
    const tickerColumn = headers.indexOf('tickerSymbol');

    if (tickerColumn >= 0) {
      for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex++) {
        const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: tickerColumn });
        const cell = nextSheet[cellAddress];

        if (cell && String(cell.v).toUpperCase() === 'NEEDS_REVIEW') {
          cell.s = cell.s || {};
          cell.s.fill = { fgColor: { rgb: 'FFFF00' } };
        }
      }
    }
  }

  workbook.Sheets[sheetName] = nextSheet;
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
