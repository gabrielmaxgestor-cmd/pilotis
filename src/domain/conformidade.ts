import { diffDaysISO, roundCents, todayISO } from './formatters';
import type { LancamentoRecord, ParcelaRecord } from './types';

export interface ItemConformidadeEntrada {
  id?: string;
  tipo: 'Obrigação' | 'Certidão' | 'Documento de obra' | 'Licitação';
  categoria?: string;
  status:
    | 'Em dia'
    | 'Válida'
    | 'Anexado'
    | 'Vence em breve'
    | 'Em atraso'
    | 'Pendente'
    | 'Parcial';
  vencimento?: string;
}

export const OBLIGATION_WARNING_DAYS = 7;
export const CERTIFICATE_WARNING_DAYS = 30;

export function resolverStatusConformidade(
  item: Pick<ItemConformidadeEntrada, 'status' | 'vencimento'> & Partial<Pick<ItemConformidadeEntrada, 'tipo'>>,
  dataReferencia: string,
): ItemConformidadeEntrada['status'] {
  const ready = item.status === 'Em dia' || item.status === 'Válida' || item.status === 'Anexado';
  if (!item.tipo && ready) return item.status;
  if (item.tipo === 'Obrigação' && ready) return 'Em dia';

  const days = diffDaysISO(item.vencimento ?? '', dataReferencia);
  if (days !== null && days < 0) return 'Em atraso';
  if (item.tipo === 'Obrigação' && days !== null && days <= OBLIGATION_WARNING_DAYS) return 'Vence em breve';
  if (item.tipo === 'Certidão') {
    if (days === null || !ready && item.status !== 'Vence em breve') return item.status === 'Parcial' ? 'Parcial' : 'Pendente';
    return days <= CERTIFICATE_WARNING_DAYS ? 'Vence em breve' : 'Válida';
  }
  if (ready) return item.status;
  return item.status === 'Em atraso' || (item.tipo === 'Obrigação' && item.status === 'Vence em breve') ? 'Pendente' : item.status;
}

function tenderReady(item: ItemConformidadeEntrada, referenceDate: string) {
  const resolved = resolverStatusConformidade(item, referenceDate);
  return resolved === 'Em dia' || resolved === 'Válida' || resolved === 'Anexado';
}

export function prontidaoLicitacao(
  itens: ItemConformidadeEntrada[],
  referenceDate = todayISO(),
): number | null {
  const tenderItems = itens.filter((i) => i.tipo === 'Licitação');
  if (tenderItems.length === 0) return null;
  const ready = tenderItems.filter((item) => tenderReady(item, referenceDate)).length;
  return Math.round((ready / tenderItems.length) * 100);
}

export interface ProntidaoLicitacaoCategoria {
  categoria: string;
  pct: number;
  prontos: number;
  total: number;
  statusRotulo: 'Em dia' | 'Parcial' | 'Pendente';
}

export function prontidaoLicitacaoPorCategoria(
  itens: ItemConformidadeEntrada[],
  referenceDate = todayISO(),
): ProntidaoLicitacaoCategoria[] {
  const tenderItems = itens.filter((i) => i.tipo === 'Licitação');
  if (tenderItems.length === 0) return [];
  const grouped = new Map<string, { total: number; ready: number }>();
  for (const item of tenderItems) {
    const cat = item.categoria || 'Documentação geral';
    const entry = grouped.get(cat) || { total: 0, ready: 0 };
    entry.total += 1;
    if (tenderReady(item, referenceDate)) {
      entry.ready += 1;
    }
    grouped.set(cat, entry);
  }
  return Array.from(grouped.entries()).map(([categoria, counts]) => {
    const pct = Math.round((counts.ready / counts.total) * 100);
    return {
      categoria,
      pct,
      prontos: counts.ready,
      total: counts.total,
      statusRotulo: pct === 100 ? 'Em dia' : pct === 0 ? 'Pendente' : 'Parcial',
    };
  });
}

export interface ResumoConformidadeResult {
  obrigacoesAVencerOuAtrasadas: number | null;
  certidoesValidas: number | null;
  documentosObraPendentes: number | null;
  receitaSemNotaPendente: number | null;
  prontidaoLicitacoesPct: number | null;
}

export function resumoConformidade(
  itens: ItemConformidadeEntrada[],
  lancamentos: Array<
    Pick<LancamentoRecord, 'tipo' | 'notaFiscal' | 'valor'> &
      Partial<Pick<LancamentoRecord, 'previsto' | 'status' | 'parcelaId'>>
  >,
  dataReferencia: string,
  parcelas: Array<Pick<ParcelaRecord, 'id' | 'status' | 'notaFiscal' | 'valor'>> = [],
): ResumoConformidadeResult {
  const obrigacoes = itens.filter((i) => i.tipo === 'Obrigação');
  const certidoes = itens.filter((i) => i.tipo === 'Certidão');
  const docsObra = itens.filter((i) => i.tipo === 'Documento de obra');

  const obrigacoesAVencerOuAtrasadas = obrigacoes.length === 0 ? null : obrigacoes.filter((item) => {
    const status = resolverStatusConformidade(item, dataReferencia);
    return status === 'Vence em breve' || status === 'Em atraso';
  }).length;
  const certidoesValidas = certidoes.length === 0 ? null : certidoes.filter((item) => {
    const status = resolverStatusConformidade(item, dataReferencia);
    return status === 'Válida' || status === 'Vence em breve';
  }).length;
  const documentosObraPendentes = docsObra.length === 0 ? null : docsObra.filter((item) => {
    const status = resolverStatusConformidade(item, dataReferencia);
    return status === 'Pendente' || status === 'Parcial' || status === 'Em atraso';
  }).length;

  const realized = new Set<string>();
  const receipts = [];
  for (const item of lancamentos) {
    if (item.tipo !== 'receita' || item.previsto || (item.status !== undefined && item.status !== 'Recebido')) continue;
    if (item.parcelaId) {
      if (realized.has(item.parcelaId)) continue;
      realized.add(item.parcelaId);
    }
    receipts.push(item);
  }
  for (const item of parcelas) {
    if (item.status === 'Recebida' && !realized.has(item.id)) receipts.push(item);
  }
  const receitaSemNotaPendente = receipts.length ? roundCents(receipts.filter((row) =>
    !row.notaFiscal || row.notaFiscal === 'Não emitida' || row.notaFiscal === 'A emitir').reduce((sum, row) => sum + row.valor, 0)) : null;

  return {
    obrigacoesAVencerOuAtrasadas,
    certidoesValidas,
    documentosObraPendentes,
    receitaSemNotaPendente,
    prontidaoLicitacoesPct: prontidaoLicitacao(itens, dataReferencia),
  };
}
