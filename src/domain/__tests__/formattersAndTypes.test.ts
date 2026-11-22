import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addMonthsISO,
  COLLECTION_NAMES,
  diffDaysISO,
  formatBRL,
  formatDateBR,
  formatPercentBR,
  parseDateBRToISO,
} from '../index';

describe('Formatação pt-BR e tipos de coleções', () => {
  it('formata valores em BRL com R$ e separadores pt-BR', () => {
    assert.equal(formatBRL(1234.56), 'R$ 1.234,56');
    assert.equal(formatBRL(0), 'R$ 0,00');
    assert.equal(formatBRL(-450.5), '− R$ 450,50');
    assert.equal(formatBRL(null), 'Sem dados');
    assert.equal(formatBRL(Number.NaN), 'Sem dados');
  });

  it('formata datas no padrão dd/mm/aaaa e valida datas ISO/BR', () => {
    assert.equal(formatDateBR('2026-11-21'), '21/11/2026');
    assert.equal(formatDateBR('05/03/2027'), '05/03/2027');
    assert.equal(formatDateBR(''), 'Sem dados');
    assert.equal(formatDateBR(undefined), 'Sem dados');
    assert.equal(parseDateBRToISO('21/11/2026'), '2026-11-21');
    assert.equal(parseDateBRToISO('31/02/2026'), null);
  });

  it('calcula avanço de meses ajustando fim de mês e diferença de dias', () => {
    assert.equal(addMonthsISO('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonthsISO('2024-01-31', 1), '2024-02-29');
    assert.equal(addMonthsISO('2026-11-15', 13), '2027-12-15');
    assert.equal(diffDaysISO('2026-11-25', '2026-11-21'), 4);
    assert.equal(diffDaysISO('2026-11-18', '2026-11-21'), -3);
  });

  it('formata percentuais em pt-BR com vírgula decimal', () => {
    assert.equal(formatPercentBR(14.5), '14,5%');
    assert.equal(formatPercentBR(11.11, 2), '11,11%');
    assert.equal(formatPercentBR(-3.2, 1), '− 3,2%');
    assert.equal(formatPercentBR(null), 'Sem dados');
  });

  it('declara exatamente todas as 24 coleções especificadas no domínio', () => {
    const expected = [
      'config',
      'clientes',
      'orcamentos',
      'obras',
      'parcelas',
      'lancamentos',
      'contasPagar',
      'dividas',
      'colaboradores',
      'alocacoes',
      'ferias',
      'capacitacoes',
      'etapas',
      'diario',
      'riscos',
      'baselines',
      'pops',
      'versoes',
      'obrigacoes',
      'certidoes',
      'documentos',
      'licitacoes',
      'garantias',
      'auditoria',
    ];
    assert.deepEqual([...COLLECTION_NAMES], expected);
  });
});
