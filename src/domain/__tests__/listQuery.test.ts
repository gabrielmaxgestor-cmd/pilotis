import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyListFilters, recordDay, type ListFilters, type ListSchema } from '../listQuery';
import { findSearchGroups, type SearchResult } from '../globalSearch';

test('filtra com acentos, por obra e por período inclusivo e ordena valores numericamente', () => {
  const source = [
    { title: 'Aço estrutural', project: 'obra-a', status: 'Pago', day: '2026-11-30', amount: 100 },
    { title: 'Aço para fundação', project: 'obra-a', status: 'Pago', day: '2026-11-01', amount: 20 },
    { title: 'Aço para fundação', project: 'obra-b', status: 'Pago', day: '2026-11-17', amount: 10 },
    { title: 'Aço para fundação', project: 'obra-a', status: 'Pendente', day: '2026-11-17', amount: 30 },
    { title: 'Aço para fundação', project: 'obra-a', status: 'Pago', day: '2026-12-01', amount: 15 },
  ];
  const schema: ListSchema<typeof source[number]> = {
    text: (row) => [row.title], status: (row) => row.status,
    projects: (row) => row.project, dates: (row) => row.day,
    columns: [{ key: 'amount', label: 'Valor', value: (row) => row.amount }],
  };
  const filters: ListFilters = {
    q: 'ACO', obra: 'obra-a', status: 'Pago', de: '2026-11-01', ate: '2026-11-30',
    ordem: 'amount', sentido: 'asc',
  };
  assert.deepEqual(applyListFilters(source, filters, schema).map((row) => row.amount), [20, 100]);
  assert.deepEqual(applyListFilters(source, { ...filters, sentido: 'desc' }, schema).map((row) => row.amount), [100, 20]);
  assert.deepEqual(applyListFilters(source, { ...filters, q: 'fundac' }, schema).map((row) => row.amount), [20]);
});

test('agrupa resultados globais com limite e mantém o destino do lançamento', () => {
  const expense: SearchResult = {
    module: 'financial', key: 'transaction/a', label: 'Compra de aço',
    detail: 'Lançamento', tab: 'Visão geral', params: { registro: 'a' },
    normalized: 'compra de aco lancamento',
  };
  const project: SearchResult = {
    module: 'planning', key: 'project/a', label: 'Estrutura de Aço',
    detail: 'Obra', tab: 'Visão geral', params: { 'planning.obra': 'a' },
    normalized: 'estrutura de aco obra',
  };
  const groups = findSearchGroups([expense, project, { ...expense, key: 'transaction/b' }], 'AÇO', 1);
  assert.deepEqual([...groups.values()].flat().map((row) => row.params), [expense.params, project.params]);
  assert.equal(findSearchGroups([expense, project], 'A').size, 0);
});

test('usa o dia local de Valença para datas de cadastro do Firestore', () => {
  const timestamp = { toDate: () => new Date('2026-11-28T01:00:00Z') };
  assert.equal(recordDay(timestamp), '2026-11-27');
  assert.equal(recordDay('2026-11-28'), '2026-11-28');
});
