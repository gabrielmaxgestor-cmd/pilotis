import type { ModuleKey, PilotisDataState } from '../types/pilotis';
import { normalizeSearch, searchTerms } from './listQuery';

type SearchModule = Extract<ModuleKey, 'clients' | 'planning' | 'financial' | 'team' | 'pops' | 'compliance'>;

export interface SearchResult {
  module: SearchModule;
  label: string;
  detail: string;
  tab?: string;
  params: Record<string, string>;
  key: string;
  normalized: string;
}

export const SEARCH_MODULES: Record<SearchModule, string> = {
  clients: 'Clientes e Orçamentos', planning: 'Planejamento de Obras', financial: 'Financeiro',
  team: 'Equipe', pops: 'POPs', compliance: 'Conformidade',
};
const documentTabs = {
  Obrigação: 'Obrigações', Certidão: 'Certidões', 'Documento de obra': 'Documentos por obra', Licitação: 'Licitações',
};

export function buildSearchIndex(data: Pick<PilotisDataState, 'clients' | 'quotes' | 'projects' | 'transactions' | 'employees' | 'pops' | 'complianceItems'>): SearchResult[] {
  const projectQuoteCodes = new Map(data.quotes.map((quote) => [quote.id, quote.code]));
  function entry(module: SearchModule, kind: string, id: string, label: string, detail: string,
    text: Array<string | number | null | undefined>, params: Record<string, string>, tab?: string): SearchResult {
    return {
      module, label, detail, tab, params, key: kind + '/' + id,
      normalized: normalizeSearch([label, detail, id, ...text].join(' ')),
    };
  }
  return [
    ...data.clients.map((row) => entry('clients', 'client', row.id, row.name, 'Cliente',
      [row.phone, row.email, row.city], { 'clients.cliente': row.id }, 'Clientes')),
    ...data.quotes.map((row) => entry('clients', 'quote', row.id, row.title, 'Orçamento ' + row.code,
      [row.clientName, row.description, row.version], { registro: row.id },
      row.status === 'Descartado' ? 'Rascunhos descartados' : 'Orçamentos')),
    ...data.projects.map((row) => entry('planning', 'project', row.id, row.name, 'Obra',
      [row.clientName, projectQuoteCodes.get(row.quoteId)], { 'planning.obra': row.id }, 'Visão geral')),
    ...data.transactions.map((row) => entry('financial', 'transaction', row.id, row.description, 'Lançamento',
      [row.receiptRef, row.projectName, row.category, row.installmentLabel],
      { registro: row.id }, 'Visão geral')),
    ...data.employees.map((row) => entry('team', 'employee', row.id, row.name, 'Colaborador',
      [row.role], { 'team.colaborador': row.id }, 'Cadastro')),
    ...data.pops.map((row) => entry('pops', 'pop', row.id, row.draft?.title || row.title, 'POP ' + row.version,
      [row.title, row.serviceType, row.draft?.serviceType], { 'pops.registro': row.id })),
    ...data.complianceItems.map((row) => entry('compliance', 'document', row.id, row.title, row.kind,
      [row.fileName, row.category, row.competence, row.projectName],
      { registro: row.id }, documentTabs[row.kind])),
  ];
}

export function findSearchGroups(index: readonly SearchResult[], query: string, limitPerModule = 6) {
  const terms = searchTerms(query);
  const groups = new Map<SearchModule, SearchResult[]>();
  if (!terms.length || normalizeSearch(query).length < 2) return groups;
  for (const row of index) {
    const group = groups.get(row.module);
    if ((group?.length ?? 0) >= limitPerModule || !terms.every((term) => row.normalized.includes(term))) continue;
    if (group) group.push(row);
    else groups.set(row.module, [row]);
  }
  return groups;
}
