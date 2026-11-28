import type { CellObject, Sheet } from 'write-excel-file/browser';
import type { AccountingTable } from '../domain/accountingPackage';
import { sanitizeSpreadsheetCell } from './spreadsheet';

const textCell = (value: string) => String(sanitizeSpreadsheetCell(value.trim()));

export function accountingCsv(table: AccountingTable) {
  return '\uFEFF' + [table.headers, ...table.rows].map((row) => row.map((cell, index) => {
    if (typeof cell === 'number') {
      return (table.moneyColumns?.includes(index) ? cell.toFixed(2) : String(cell)).replace('.', ',');
    }
    return '"' + (cell === null ? '' : textCell(cell)).replace(/"/g, '""') + '"';
  }).join(';')).join('\r\n') + '\r\n';
}

export function accountingWorkbookSheets(tables: AccountingTable[]): Sheet<File | Blob | ArrayBuffer>[] {
  return tables.map((table) => ({
    sheet: table.title,
    stickyRowsCount: 1,
    columns: table.headers.map((header) => ({ width: table.title === 'Resumo' && header === 'Referência' ? 60 : Math.max(18, header.length + 3) })),
    data: [
      table.headers.map((header): CellObject => ({ type: String, value: header, fontWeight: 'bold',
        backgroundColor: '#1F3A5F', textColor: '#FFFFFF' })),
      ...table.rows.map((row) => row.map((cell, index): CellObject =>
        typeof cell === 'number' ? { type: Number, value: cell, ...(table.moneyColumns?.includes(index) ? { format: '#,##0.00' } : {}) }
          : { type: String, value: cell === null ? '' : textCell(cell), wrap: true })),
    ],
  }));
}

export async function createAccountingArchive(tables: AccountingTable[]) {
  const [{ default: writeXlsxFile }, { zipSync, strToU8 }] = await Promise.all([
    import('write-excel-file/browser'), import('fflate'),
  ]);
  const workbook = await writeXlsxFile(accountingWorkbookSheets(tables)).toBlob();
  const files: Record<string, Uint8Array> = { 'pacote-para-o-contador.xlsx': new Uint8Array(await workbook.arrayBuffer()) };
  for (const table of tables) files['csv/' + table.fileName] = strToU8(accountingCsv(table));
  const archive = zipSync(files);
  return new Blob([archive.slice().buffer as ArrayBuffer], { type: 'application/zip' });
}

export function downloadAccountingArchive(archive: Blob, filename: string) {
  const href = URL.createObjectURL(archive);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}
