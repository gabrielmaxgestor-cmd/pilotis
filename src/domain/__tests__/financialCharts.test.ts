import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectDreRows } from '../financialCharts';
import { resumoFinanceiroPeriodo } from '../financeiro';
import { dre } from '../dre';
import type { LancamentoRecord } from '../types';

const day = '2026-11-27';
function movement(fields: Partial<LancamentoRecord>): LancamentoRecord {
  return {
    id: 'movement', data: day, vencimento: day, descricao: 'Despesa do teste', tipo: 'despesa',
    categoria: 'Materiais', obraId: 'work', valor: 100, previsto: false, status: 'Pago',
    notaFiscal: 'Não se aplica', formaPagamento: 'Pix', origem: 'manual', ...fields,
  } as LancamentoRecord;
}

test('a composição usa as mesmas despesas realizadas do saldo do mês', () => {
  const entries = [
    movement({ categoria: 'Pró-labore', origem: 'folha', valor: 300 }),
    movement({ categoria: 'Tributos', valor: 150 }),
    movement({ categoria: 'Juros e tarifas', valor: 50 }),
    movement({ valor: 100 }),
    movement({ valor: 500, previsto: true, status: 'A vencer' }),
    movement({ valor: 900, tipo: 'emprestimo', status: 'Não é receita' }),
    movement({ valor: 250, status: 'Estornado' }),
    movement({ valor: 250, status: 'Estorno' }),
  ];
  const summary = resumoFinanceiroPeriodo(entries, [], day);
  assert.equal(summary.saidasMes, 600);
  assert.equal(summary.folhaMes, 300);
  assert.deepEqual(summary.composicaoDespesas.rows.map(({ amount }) => amount), [300, 150, 50, 100]);
  assert.deepEqual(summary.composicaoDespesas.rows.map(({ percent }) => percent), [50, 25, 8.33, 16.67]);
  assert.equal(resumoFinanceiroPeriodo(entries.slice(4), [], day).composicaoDespesas.hasData, false);
});

test('as linhas do gráfico de DRE preservam ausência de orçamento e de realização', () => {
  const project = {
    id: 'work', nome: 'Obra', valorContrato: 9000, orcadoMaoDeObra: 4000, orcadoEmpreita: 1000,
    orcadoEquipamentos: 0, orcadoImpostos: 0, orcadoBdi: 0, orcadoEap: 4800,
  };
  const comparison = projectDreRows(dre(project, [movement({ categoria: 'Folha', valor: 1200 })]), true);
  assert.deepEqual(comparison.filter((row) => /Mão de obra|EAP/.test(row.label)).map(({ budget, actual }) => [budget, actual]),
    [[4000, 1200], [-200, null]]);
  const withoutExpenses = projectDreRows(dre(project, []), false);
  assert.equal(withoutExpenses.find((row) => row.label.includes('Mão de obra'))?.budget, null);
  assert.equal(withoutExpenses[0].budget, 9000);
  assert.ok(withoutExpenses.every((row) => row.actual === null));
});
