import { diffDaysISO, roundCents } from './formatters';
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

export function resolverStatusConformidade(
  item: Pick<ItemConformidadeEntrada, 'status' | 'vencimento'>,
  dataReferencia: string,
): ItemConformidadeEntrada['status'] {
  if (
    item.status === 'Em dia' ||
    item.status === 'Válida' ||
    item.status === 'Anexado'
  ) {
    return item.status;
  }
  const due = (item.vencimento || '').trim().slice(0, 10);
  const ref = (dataReferencia || '').trim().slice(0, 10);
  if (due && ref && due < ref) {
    return 'Em atraso';
  }
  return item.status === 'Em atraso' ? 'Pendente' : item.status;
}

export function prontidaoLicitacao(
  itens: ItemConformidadeEntrada[],
): number | null {
  const tenderItems = itens.filter((i) => i.tipo === 'Licitação');
  if (tenderItems.length === 0) return null;
  const ready = tenderItems.filter(
    (i) => i.status === 'Em dia' || i.status === 'Válida' || i.status === 'Anexado',
  ).length;
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
): ProntidaoLicitacaoCategoria[] {
  const tenderItems = itens.filter((i) => i.tipo === 'Licitação');
  if (tenderItems.length === 0) return [];
  const grouped = new Map<string, { total: number; ready: number }>();
  for (const item of tenderItems) {
    const cat = item.categoria || 'Documentação geral';
    const entry = grouped.get(cat) || { total: 0, ready: 0 };
    entry.total += 1;
    if (
      item.status === 'Em dia' ||
      item.status === 'Válida' ||
      item.status === 'Anexado'
    ) {
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

  const obrigacoesAVencerOuAtrasadas =
    obrigacoes.length === 0
      ? null
      : obrigacoes.filter((o) => {
          const resolvedStatus = resolverStatusConformidade(o, dataReferencia);
          if (
            resolvedStatus === 'Em atraso' ||
            resolvedStatus === 'Pendente' ||
            resolvedStatus === 'Vence em breve'
          ) {
            return true;
          }
          if (!o.vencimento) return false;
          const days = diffDaysISO(o.vencimento.slice(0, 10), dataReferencia);
          return days !== null && days <= 30 && resolvedStatus !== 'Em dia';
        }).length;

  const certidoesValidas =
    certidoes.length === 0
      ? null
      : certidoes.filter((c) => c.status === 'Válida' || c.status === 'Em dia').length;

  const documentosObraPendentes =
    docsObra.length === 0
      ? null
      : docsObra.filter((d) => d.status === 'Pendente' || d.status === 'Parcial')
          .length;

  const parcelaIds = new Set(parcelas.map((p) => p.id));
  const realizedParcelaIds = new Set<string>();
  const receitasValidas = [];
  for (const l of lancamentos) {
    if (l.tipo !== 'receita') continue;
    const pid = (l.parcelaId || '').trim();
    const isRealized = !l.previsto && (l.status === undefined || l.status === 'Recebido');
    if (pid && !isRealized && parcelaIds.has(pid)) continue;
    if (isRealized && pid) {
      if (realizedParcelaIds.has(pid)) continue;
      realizedParcelaIds.add(pid);
    }
    receitasValidas.push(l);
  }
  const parcelasAbertas = parcelas.filter(
    (p) => p.status !== 'Recebida' && !realizedParcelaIds.has(p.id),
  );

  const receitaSemNotaPendente =
    receitasValidas.length === 0 && parcelasAbertas.length === 0
      ? null
      : roundCents(
          receitasValidas
            .filter(
              (r) => r.notaFiscal === 'Não emitida' || r.notaFiscal === 'A emitir',
            )
            .reduce((sum, r) => sum + r.valor, 0) +
            parcelasAbertas
              .filter(
                (p) =>
                  p.notaFiscal === 'Não emitida' || p.notaFiscal === 'A emitir',
              )
              .reduce((sum, p) => sum + p.valor, 0),
        );

  return {
    obrigacoesAVencerOuAtrasadas,
    certidoesValidas,
    documentosObraPendentes,
    receitaSemNotaPendente,
    prontidaoLicitacoesPct: prontidaoLicitacao(itens),
  };
}
