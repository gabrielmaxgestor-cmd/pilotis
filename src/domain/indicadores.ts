import { dre, type ObraDreInput } from './dre';
import {
  deduplicarReceitasEParcelas,
  isParcelaEmAtraso,
  resolverStatusLancamento,
  resumoFinanceiroPeriodo,
} from './financeiro';
import { diffDaysISO, monthKey, roundCents } from './formatters';
import type {
  ColaboradorRecord,
  DividaRecord,
  LancamentoRecord,
  OrcamentoRecord,
  ParcelaRecord,
} from './types';

export interface IndicadoresDashboardInput {
  dataReferencia: string;
  lancamentos: LancamentoRecord[];
  parcelas: ParcelaRecord[];
  obras: Array<ObraDreInput & { status: 'Contratada' | 'Em execução' | 'Concluída' }>;
  orcamentos: Array<Pick<OrcamentoRecord, 'status'>>;
  clientesCount?: number;
  colaboradores?: Array<Pick<ColaboradorRecord, 'id'>>;
  dividas?: Array<Pick<DividaRecord, 'id'>>;
}

export interface IndicadoresDashboardResult {
  sistemaVazio: boolean;
  saldoRealizadoCaixa: number | null;
  saldoPrevistoFimMes: number | null;
  aReceber30Dias: number | null;
  aReceber30Qtd: number;
  aReceberAtrasoQtd: number;
  resultadoMes: number | null;
  margemMediaObrasPct: number | null;
  obrasAtivasQtd: number | null;
  orcamentosEmAbertoQtd: number;
  receitaSemNota: number | null;
}

export function indicadoresDashboard(
  input: IndicadoresDashboardInput,
): IndicadoresDashboardResult {
  const refISO = input.dataReferencia;
  const currentMonth = monthKey(refISO);

  const sistemaVazio =
    input.lancamentos.length === 0 &&
    input.parcelas.length === 0 &&
    (input.clientesCount ?? 0) === 0 &&
    input.orcamentos.length === 0 &&
    input.obras.length === 0 &&
    (input.colaboradores?.length ?? 0) === 0 &&
    (input.dividas?.length ?? 0) === 0;

  const { lancamentosUnicos, parcelasAbertas } = deduplicarReceitasEParcelas(
    input.lancamentos,
    input.parcelas,
  );

  const periodSummary = resumoFinanceiroPeriodo(
    input.lancamentos,
    input.parcelas,
    refISO,
  );
  const saldoRealizadoCaixa = periodSummary.saldoRealizadoCaixa;

  const currentMonthTx = lancamentosUnicos.filter(
    (t) =>
      t.tipo !== 'emprestimo' &&
      monthKey(t.previsto ? t.vencimento || t.data : t.data || t.vencimento) === currentMonth,
  );
  const currentMonthOpenParcelas = parcelasAbertas.filter(
    (p) => monthKey(p.vencimento) === currentMonth,
  );

  let saldoPrevistoFimMes: number | null = null;
  if (
    saldoRealizadoCaixa !== null ||
    currentMonthTx.length > 0 ||
    currentMonthOpenParcelas.length > 0
  ) {
    const pendingTxInMonth = currentMonthTx
      .filter((t) => t.previsto || t.status === 'A vencer' || t.status === 'Em atraso')
      .reduce((sum, t) => (t.tipo === 'receita' ? sum + t.valor : sum - t.valor), 0);
    const pendingParcelasInMonth = currentMonthOpenParcelas.reduce(
      (sum, p) => sum + p.valor,
      0,
    );
    saldoPrevistoFimMes = roundCents(
      (saldoRealizadoCaixa ?? 0) + pendingTxInMonth + pendingParcelasInMonth,
    );
  }

  const standaloneReceivables30 = lancamentosUnicos.filter((t) => {
    if (t.tipo !== 'receita') return false;
    if (t.status === 'Recebido') return false;
    const due = (t.vencimento || t.data).trim().slice(0, 10);
    const diff = diffDaysISO(due, refISO);
    return diff !== null && diff <= 30;
  });

  const parcelasReceivables30 = parcelasAbertas.filter((p) => {
    const due = (p.vencimento || '').trim().slice(0, 10);
    const diff = diffDaysISO(due, refISO);
    return diff !== null && diff <= 30;
  });

  const aReceberAtrasoQtd =
    parcelasReceivables30.filter((p) => isParcelaEmAtraso(p, refISO)).length +
    standaloneReceivables30.filter(
      (t) => resolverStatusLancamento(t, refISO) === 'Em atraso',
    ).length;

  const aReceber30Qtd = parcelasReceivables30.length + standaloneReceivables30.length;
  const hasAnyReceivables =
    input.parcelas.length > 0 ||
    lancamentosUnicos.some((t) => t.tipo === 'receita');
  const aReceber30Dias = hasAnyReceivables
    ? roundCents(
        parcelasReceivables30.reduce((sum, p) => sum + p.valor, 0) +
          standaloneReceivables30.reduce((sum, t) => sum + t.valor, 0),
      )
    : null;

  const activeProjects = input.obras.filter(
    (p) => p.status === 'Em execução' || p.status === 'Contratada',
  );

  let margemMediaObrasPct: number | null = null;
  if (input.obras.length > 0) {
    const dres = input.obras.map((obra) => dre(obra, lancamentosUnicos));
    const totalRev = dres.reduce((s, d) => s + d.receita.orcado, 0);
    const totalMargin = dres.reduce((s, d) => s + d.resultado.realizado, 0);
    margemMediaObrasPct =
      totalRev > 0 ? Math.round((totalMargin / totalRev) * 100) : null;
  }

  const orcamentosEmAbertoQtd = input.orcamentos.filter(
    (q) => q.status === 'Em negociação' || q.status === 'Enviado',
  ).length;

  return {
    sistemaVazio,
    saldoRealizadoCaixa,
    saldoPrevistoFimMes,
    aReceber30Dias,
    aReceber30Qtd,
    aReceberAtrasoQtd,
    resultadoMes: periodSummary.resultadoMes,
    margemMediaObrasPct,
    obrasAtivasQtd: input.obras.length > 0 ? activeProjects.length : null,
    orcamentosEmAbertoQtd,
    receitaSemNota: periodSummary.receitaSemNota,
  };
}
