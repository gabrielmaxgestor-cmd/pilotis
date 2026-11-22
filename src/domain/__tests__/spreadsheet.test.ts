import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  autoSuggestColumnMapping,
  buildImportPreviewRows,
  parseCsvText,
  sanitizeSpreadsheetCell,
} from '../../utils/spreadsheet';

describe('spreadsheet import and export helpers', () => {
  it('interpreta CSV em pt-BR, sugere colunas e sinaliza empréstimo lançado como faturamento', () => {
    const csv = [
      'Data;Descrição;Categoria;Valor;Obra',
      '05/11/2026;Parcela 12/24;Faturamento de obra;12500,00;Obra Residencial A',
      '10/11/2026;Empréstimo Banco X;Faturamento;50000,00;Empresa',
      '15/11/2026;;;;',
      '20/11/2026;Folha mensal;Folha;8400,50;Obra Residencial A',
    ].join('\n');

    const parsed = parseCsvText(csv, 'movimentos.csv');
    assert.equal(parsed.headers.length, 5);
    assert.equal(parsed.suggestedMapping.dateCol, 0);
    assert.equal(parsed.suggestedMapping.descriptionCol, 1);
    assert.equal(parsed.suggestedMapping.categoryCol, 2);
    assert.equal(parsed.suggestedMapping.amountCol, 3);
    assert.equal(parsed.suggestedMapping.projectCol, 4);

    const preview = buildImportPreviewRows(parsed, parsed.suggestedMapping);
    // Linha vazia sem valor é ignorada (meses vazios continuam vazios)
    assert.equal(preview.rows.length, 3);
    assert.equal(preview.skippedRowsCount, 1);

    // Receita legítima
    assert.equal(preview.rows[0].entryKind, 'income');
    assert.equal(preview.rows[0].amount, 12500);
    assert.equal(preview.rows[0].flaggedLoan, false);

    // Empréstimo marcado como Faturamento é bloqueado como receita e sinalizado
    assert.equal(preview.rows[1].entryKind, 'loan');
    assert.equal(preview.rows[1].flaggedLoan, true);
    assert.equal(preview.rows[1].wasTaggedAsRevenue, true);
    assert.equal(preview.flaggedLoansCount, 1);

    // Despesa normal
    assert.equal(preview.rows[2].entryKind, 'expense');
    assert.equal(preview.rows[2].amount, 8400.5);
  });

  it('permite mapear colunas fora de ordem manualmente', () => {
    const csv = [
      'Centro;Valor R$;Historico;Dt Movimento;Grupo',
      'Obra B;3200,00;Cimento e frete;01/12/2026;Material',
    ].join('\n');

    const parsed = parseCsvText(csv);
    const mapping = autoSuggestColumnMapping(parsed.headers);
    const preview = buildImportPreviewRows(parsed, mapping);

    assert.equal(preview.rows.length, 1);
    assert.equal(preview.rows[0].date, '2026-12-01');
    assert.equal(preview.rows[0].projectName, 'Obra B');
    assert.equal(preview.rows[0].amount, 3200);
  });

  it('protege células exportadas contra injeção de fórmulas em planilhas', () => {
    assert.equal(sanitizeSpreadsheetCell('=CMD|"/C calc"!A0'), "'=CMD|\"/C calc\"!A0");
    assert.equal(sanitizeSpreadsheetCell('+1+1'), "'+1+1");
    assert.equal(sanitizeSpreadsheetCell('@SUM(A1:A2)'), "'@SUM(A1:A2)");
    assert.equal(sanitizeSpreadsheetCell('Obra Residencial'), 'Obra Residencial');
    assert.equal(sanitizeSpreadsheetCell(1500), 1500);
  });
});
