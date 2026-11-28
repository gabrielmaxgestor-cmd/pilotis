import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyListFilters, recordDay, type ListFilters, type ListSchema } from '../listQuery';
import { buildSearchIndex, findSearchGroups, type SearchResult } from '../globalSearch';

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

test('indexa os registros pesquisáveis e aponta para o cadastro de origem', () => {
  const base = {
    clients: [{ id: 'client', name: 'Fundação' }],
    quotes: [{ id: 'quote', title: 'Fundação', code: 'ORC-0098', status: 'Descartado' }],
    projects: [{ id: 'project', name: 'Fundação', quoteId: 'quote' }],
    transactions: [{ id: 'tx', description: 'Pagamento de fundação' }],
    employees: [{ id: 'employee', name: 'Fundação' }],
    pops: [{ id: 'pop', title: 'Fundação', version: 'v1.0' }],
    complianceItems: [{ id: 'doc', title: 'Fundação', kind: 'Documento de obra' }],
  } as Parameters<typeof buildSearchIndex>[0];
  const index = buildSearchIndex(base);
  const results = [...findSearchGroups(index, 'fundacao').values()].flat();
  assert.equal(results.length, 7);
  assert.deepEqual(results.find((row) => row.key === 'client/client')?.params, { 'clients.cliente': 'client' });
  assert.equal(results.find((row) => row.key === 'quote/quote')?.tab, 'Rascunhos descartados');
  assert.deepEqual(results.find((row) => row.key === 'project/project')?.params, { 'planning.obra': 'project' });
  assert.deepEqual(results.find((row) => row.key === 'transaction/tx')?.params, { registro: 'tx' });
  assert.deepEqual(results.find((row) => row.key === 'employee/employee')?.params, { 'team.colaborador': 'employee' });
  assert.deepEqual(results.find((row) => row.key === 'pop/pop')?.params, { 'pops.registro': 'pop' });
  assert.equal(results.find((row) => row.key === 'document/doc')?.tab, 'Documentos por obra');
  assert.equal(findSearchGroups(index, '0098').get('clients')?.[0].key, 'quote/quote');
});
