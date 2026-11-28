import { deduplicarReceitasEParcelas } from './financeiro';
import { roundCents } from './formatters';
import type {
  ContaPagarRecord,
  LancamentoRecord,
  ObraRecord,
  ParcelaRecord,
} from './types';

export interface LinhaDre {
  orcado: number;
  realizado: number;
  variacao: number;
  variacaoPct: number | null;
}

export interface DreObraResult {
  possuiRealizado: boolean;
  obraId: string;
  obraNome: string;
  receita: LinhaDre;
  maoDeObra: LinhaDre;
  empreita: LinhaDre;
  equipamentos: LinhaDre;
  impostos: LinhaDre;
  bdi: LinhaDre;
  ajusteEap: LinhaDre;
  custosTotais: LinhaDre;
  resultado: LinhaDre;
  margemOrcadaPct: number;
  margemRealizadaPct: number;
}

function makeLinha(orcado: number, realizado: number): LinhaDre {
  const o = roundCents(orcado);
  const r = roundCents(realizado);
  const variacao = roundCents(r - o);
  const variacaoPct = o > 0 ? roundCents((variacao / o) * 100) : null;
  return { orcado: o, realizado: r, variacao, variacaoPct };
}

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function mapExpenseBucket(
  categoria: string,
): 'maoDeObra' | 'empreita' | 'equipamentos' | 'impostos' | 'bdi' {
  const c = normalizeText(categoria);
  if (c === 'folha' || c === 'mão de obra' || c === 'mao de obra') {
    return 'maoDeObra';
  }
  if (c === 'subempreitada' || c === 'subempreitadas' || c === 'empreita') {
    return 'empreita';
  }
  if (c === 'equipamentos e epi' || c === 'equipamentos') {
    return 'equipamentos';
  }
  if (c === 'tributos' || c === 'impostos') {
    return 'impostos';
  }
  return 'bdi';
}

export type ObraDreInput = Pick<
  ObraRecord,
  | 'id'
  | 'nome'
  | 'valorContrato'
  | 'orcadoMaoDeObra'
  | 'orcadoEmpreita'
  | 'orcadoEquipamentos'
  | 'orcadoImpostos'
  | 'orcadoBdi'
> & { orcadoEap?: number };

export function dre(
  obra: ObraDreInput,
  lancamentos: LancamentoRecord[],
): DreObraResult {
  const { lancamentosUnicos } = deduplicarReceitasEParcelas(lancamentos, []);
  // Regra 6: empréstimo nunca entra no DRE (nem como receita nem como despesa operacional)
  const validTxs = lancamentosUnicos.filter(
    (l) => l.obraId === obra.id && l.tipo !== 'emprestimo',
  );

  const receitaRealizada = validTxs
    .filter((l) => l.tipo === 'receita' && !l.previsto && l.status === 'Recebido')
    .reduce((sum, l) => sum + l.valor, 0);

  const realizedBuckets = {
    maoDeObra: 0,
    empreita: 0,
    equipamentos: 0,
    impostos: 0,
    bdi: 0,
  };

  for (const tx of validTxs) {
    if (tx.tipo === 'despesa' && !tx.previsto && tx.status === 'Pago') {
      const bucket = mapExpenseBucket(tx.categoria);
      realizedBuckets[bucket] += tx.valor;
    }
  }

  const receita = makeLinha(obra.valorContrato, receitaRealizada);
  const maoDeObra = makeLinha(obra.orcadoMaoDeObra, realizedBuckets.maoDeObra);
  const empreita = makeLinha(obra.orcadoEmpreita, realizedBuckets.empreita);
  const equipamentos = makeLinha(
    obra.orcadoEquipamentos,
    realizedBuckets.equipamentos,
  );
  const impostos = makeLinha(obra.orcadoImpostos, realizedBuckets.impostos);
  const bdi = makeLinha(obra.orcadoBdi, realizedBuckets.bdi);

  const totalOrcado =
    maoDeObra.orcado +
    empreita.orcado +
    equipamentos.orcado +
    impostos.orcado +
    bdi.orcado;
  const totalRealizado =
    maoDeObra.realizado +
    empreita.realizado +
    equipamentos.realizado +
    impostos.realizado +
    bdi.realizado;

  const custosTotais = makeLinha(obra.orcadoEap ?? totalOrcado, totalRealizado);
  const ajusteEap = makeLinha(custosTotais.orcado - totalOrcado, 0);
  const resultadoOrcado = roundCents(receita.orcado - custosTotais.orcado);
  const resultadoRealizado = roundCents(
    receita.realizado - custosTotais.realizado,
  );
  const resultado = makeLinha(resultadoOrcado, resultadoRealizado);

  const margemOrcadaPct =
    receita.orcado > 0 ? roundCents((resultadoOrcado / receita.orcado) * 100) : 0;
  const margemRealizadaPct =
    receita.realizado > 0
      ? roundCents((resultadoRealizado / receita.realizado) * 100)
      : 0;

  return {
    possuiRealizado: validTxs.some((tx) => !tx.previsto && (tx.status === 'Recebido' || tx.status === 'Pago')),
    obraId: obra.id,
    obraNome: obra.nome,
    receita,
    maoDeObra,
    empreita,
    equipamentos,
    impostos,
    bdi,
    ajusteEap,
    custosTotais,
    resultado,
    margemOrcadaPct,
    margemRealizadaPct,
  };
}

export interface PeriodoDre {
  dataInicio: string;
  dataFim: string;
}

export interface DreEmpresaInput {
  lancamentos: LancamentoRecord[];
  parcelas?: ParcelaRecord[];
  contasPagar?: ContaPagarRecord[];
}

export interface DreEmpresaResult {
  possuiRealizado: boolean;
  periodo: PeriodoDre;
  receitas: LinhaDre;
  despesasPorCategoria: Record<string, LinhaDre>;
  custosTotais: LinhaDre;
  resultado: LinhaDre;
  margemOrcadaPct: number;
  margemRealizadaPct: number;
}

function inPeriod(dateStr: string | undefined, periodo: PeriodoDre): boolean {
  if (!dateStr) return false;
  return dateStr >= periodo.dataInicio && dateStr <= periodo.dataFim;
}

export function dreEmpresa(
  periodo: PeriodoDre,
  input: DreEmpresaInput,
): DreEmpresaResult {
  let receitaPrevista = 0;
  let receitaRealizada = 0;
  let possuiRealizado = input.lancamentos.some((row) =>
    row.status === 'Estornado' && row.tipo !== 'emprestimo' && !row.previsto && inPeriod(row.data, periodo));

  const parcelas = input.parcelas ?? [];
  const parcelaIds = new Set(parcelas.map((parcela) => parcela.id));
  const { lancamentosUnicos } = deduplicarReceitasEParcelas(
    input.lancamentos,
    parcelas,
  );

  const catTotals = new Map<string, { orcado: number; realizado: number }>();
  const addCat = (categoria: string, orcadoDelta: number, realizadoDelta: number) => {
    const key = categoria.trim() || 'Outros';
    const prev = catTotals.get(key) ?? { orcado: 0, realizado: 0 };
    catTotals.set(key, {
      orcado: prev.orcado + orcadoDelta,
      realizado: prev.realizado + realizadoDelta,
    });
  };

  for (const tx of lancamentosUnicos) {
    // Regra 6: empréstimo nunca entra no DRE da empresa
    if (tx.tipo === 'emprestimo') continue;

    const wasPlanned = (tx.previsto || tx.originalmentePrevisto) &&
      inPeriod(tx.vencimento || tx.data, periodo);
    const realizedInPeriod = !tx.previsto && inPeriod(tx.data, periodo);

    if (tx.tipo === 'receita') {
      if (wasPlanned && (!tx.parcelaId || !parcelaIds.has(tx.parcelaId))) receitaPrevista += tx.valor;
      if (realizedInPeriod && tx.status === 'Recebido') {
        receitaRealizada += tx.valor;
        possuiRealizado = true;
      }
    } else if (tx.tipo === 'despesa') {
      if (wasPlanned) addCat(tx.categoria, tx.valor, 0);
      if (realizedInPeriod && tx.status === 'Pago') {
        addCat(tx.categoria, 0, tx.valor);
        possuiRealizado = true;
      }
    }
  }

  // O orçamento conserva os vencimentos originais após receber as parcelas.
  for (const p of parcelas) {
    if (inPeriod(p.vencimento, periodo)) {
      receitaPrevista += p.valor;
    }
  }

  for (const cp of input.contasPagar || []) {
    if (!inPeriod(cp.vencimento, periodo)) continue;
    if (cp.status !== 'Paga') {
      addCat(cp.categoria, cp.valor, 0);
    }
  }

  const despesasPorCategoria: Record<string, LinhaDre> = {};
  let custosOrcado = 0;
  let custosRealizado = 0;

  for (const [cat, sums] of catTotals.entries()) {
    const linha = makeLinha(sums.orcado, sums.realizado);
    despesasPorCategoria[cat] = linha;
    custosOrcado += linha.orcado;
    custosRealizado += linha.realizado;
  }

  const receitas = makeLinha(receitaPrevista, receitaRealizada);
  const custosTotais = makeLinha(custosOrcado, custosRealizado);
  const resultadoOrcado = roundCents(receitas.orcado - custosTotais.orcado);
  const resultadoRealizado = roundCents(
    receitas.realizado - custosTotais.realizado,
  );
  const resultado = makeLinha(resultadoOrcado, resultadoRealizado);

  return {
    periodo,
    possuiRealizado,
    receitas,
    despesasPorCategoria,
    custosTotais,
    resultado,
    margemOrcadaPct:
      receitas.orcado > 0
        ? roundCents((resultadoOrcado / receitas.orcado) * 100)
        : 0,
    margemRealizadaPct:
      receitas.realizado > 0
        ? roundCents((resultadoRealizado / receitas.realizado) * 100)
        : 0,
  };
}
