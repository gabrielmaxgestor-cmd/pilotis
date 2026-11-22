import { resumoFolhaEquipe } from './equipe';
import {
  addMonthsISO,
  formatMonthLabelBR,
  monthKey,
  roundCents,
} from './formatters';
import { gerarParcelas } from './orcamentos';
import type {
  ColaboradorRecord,
  ContaPagarRecord,
  LancamentoRecord,
  OrcamentoRecord,
  ParcelaRecord,
  TaxChargeParameters,
} from './types';

export interface PrevisaoCaixaInput {
  dataBase: string;
  saldoInicial?: number | null;
  lancamentos: LancamentoRecord[];
  parcelas?: ParcelaRecord[];
  orcamentos?: OrcamentoRecord[];
  contasPagar?: ContaPagarRecord[];
  colaboradores?: ColaboradorRecord[];
  parametrosEncargos?: TaxChargeParameters | null;
}

export interface MesPrevisaoCaixa {
  mesKey: string;
  rotulo: string;
  realizadoEntradas: number;
  contratadoEntradas: number;
  funilPonderadoEntradas: number;
  emprestimosNaoReceita: number;
  saidasRealizadas: number;
  saidasPrevistas: number;
  saidasTotais: number;
  provisoesFolhaIncluidas: number;
  saldoProjetado: number;
  saldoProjetadoComFunil: number;
  negativo: boolean;
}

export interface PrevisaoCaixaResult {
  possuiDados: boolean;
  encargosConfigurados: boolean;
  meses: MesPrevisaoCaixa[];
  mesesNegativos: string[];
  saldoFinalProjetado: number | null;
}

export function previsaoCaixa(
  mesesCount: number,
  input: PrevisaoCaixaInput,
): PrevisaoCaixaResult {
  if (!Number.isInteger(mesesCount) || mesesCount < 1) {
    throw new Error('meses deve ser um inteiro maior ou igual a 1.');
  }

  const parcelas = input.parcelas ?? [];
  const orcamentos = input.orcamentos ?? [];
  const contasPagar = input.contasPagar ?? [];
  const colaboradores = input.colaboradores ?? [];

  const openFunnelQuotes = orcamentos.filter(
    (q) =>
      (q.status === 'Enviado' || q.status === 'Em negociação') &&
      q.probabilidadePct > 0 &&
      q.valorTotal > 0,
  );

  const hasAnyData =
    input.saldoInicial !== undefined && input.saldoInicial !== null ||
    input.lancamentos.length > 0 ||
    parcelas.length > 0 ||
    openFunnelQuotes.length > 0 ||
    contasPagar.length > 0 ||
    colaboradores.length > 0;

  if (!hasAnyData) {
    return {
      possuiDados: false,
      encargosConfigurados: false,
      meses: [],
      mesesNegativos: [],
      saldoFinalProjetado: null,
    };
  }

  const payroll = resumoFolhaEquipe(
    colaboradores,
    input.parametrosEncargos,
    input.dataBase,
  );

  // Funil ponderado distribuído por mês usando as parcelas do orçamento ponderadas pela probabilidade
  const funnelByMonth = new Map<string, number>();
  for (const orc of openFunnelQuotes) {
    const weightedTotal = roundCents(
      orc.valorTotal * (orc.probabilidadePct / 100),
    );
    const startMonthISO = addMonthsISO(input.dataBase, 1);
    const generated = gerarParcelas(
      weightedTotal,
      orc.entradaPct,
      Math.max(1, orc.numeroParcelas),
      startMonthISO,
    );
    for (const item of generated) {
      const mk = monthKey(item.vencimento);
      funnelByMonth.set(mk, (funnelByMonth.get(mk) ?? 0) + item.valor);
    }
  }

  const linkedParcelaIds = new Set(
    input.lancamentos.map((l) => l.parcelaId).filter(Boolean) as string[],
  );

  let runningBalance = roundCents(input.saldoInicial ?? 0);
  let runningFunnelAccum = 0;

  const meses: MesPrevisaoCaixa[] = [];
  const mesesNegativos: string[] = [];

  for (let i = 0; i < mesesCount; i++) {
    const mk = monthKey(addMonthsISO(input.dataBase, i));
    const txsInMonth = input.lancamentos.filter(
      (l) => monthKey(l.previsto ? l.vencimento || l.data : l.data) === mk,
    );

    // Empréstimos ficam separados: nunca entram como realizadoEntradas ou contratadoEntradas
    const emprestimosNaoReceita = roundCents(
      txsInMonth
        .filter((l) => l.tipo === 'emprestimo')
        .reduce((s, l) => s + l.valor, 0),
    );

    const realizadoEntradas = roundCents(
      txsInMonth
        .filter((l) => l.tipo === 'receita' && !l.previsto && l.status === 'Recebido')
        .reduce((s, l) => s + l.valor, 0),
    );

    const lancamentosContratados = txsInMonth
      .filter((l) => l.tipo === 'receita' && l.previsto)
      .reduce((s, l) => s + l.valor, 0);

    const parcelasContratadas = parcelas
      .filter(
        (p) =>
          !linkedParcelaIds.has(p.id) &&
          p.status !== 'Recebida' &&
          monthKey(p.vencimento) === mk,
      )
      .reduce((s, p) => s + p.valor, 0);

    const contratadoEntradas = roundCents(
      lancamentosContratados + parcelasContratadas,
    );

    const saidasRealizadas = roundCents(
      txsInMonth
        .filter((l) => l.tipo === 'despesa' && !l.previsto && l.status === 'Pago')
        .reduce((s, l) => s + l.valor, 0),
    );

    const lancamentosDespesasPrevistas = txsInMonth
      .filter((l) => l.tipo === 'despesa' && l.previsto)
      .reduce((s, l) => s + l.valor, 0);

    const contasPagarMes = contasPagar
      .filter((cp) => cp.status !== 'Paga' && monthKey(cp.vencimento) === mk)
      .reduce((s, cp) => s + cp.valor, 0);

    const hasExplicitFolha = txsInMonth.some(
      (l) =>
        l.tipo === 'despesa' &&
        (l.categoria.toLowerCase() === 'folha' || l.origem === 'folha'),
    );

    let payrollProjectedOutflow = 0;
    let provisoesFolhaIncluidas = 0;
    if (!hasExplicitFolha && colaboradores.length > 0) {
      if (payroll.configurado && payroll.custoTotalMensal !== null) {
        payrollProjectedOutflow = payroll.custoTotalMensal;
        provisoesFolhaIncluidas = payroll.provisoesMensais ?? 0;
      } else {
        // Sem parâmetros configurados, usa apenas salário-base cadastrado (nunca inventa alíquota)
        payrollProjectedOutflow = payroll.folhaBase;
      }
    }

    const saidasPrevistas = roundCents(
      lancamentosDespesasPrevistas + contasPagarMes + payrollProjectedOutflow,
    );
    const saidasTotais = roundCents(saidasRealizadas + saidasPrevistas);

    const funilPonderadoEntradas = roundCents(funnelByMonth.get(mk) ?? 0);
    runningFunnelAccum = roundCents(runningFunnelAccum + funilPonderadoEntradas);

    runningBalance = roundCents(
      runningBalance + realizadoEntradas + contratadoEntradas - saidasTotais,
    );
    const saldoProjetadoComFunil = roundCents(runningBalance + runningFunnelAccum);
    const negativo = runningBalance < 0;

    if (negativo) {
      mesesNegativos.push(mk);
    }

    meses.push({
      mesKey: mk,
      rotulo: formatMonthLabelBR(mk),
      realizadoEntradas,
      contratadoEntradas,
      funilPonderadoEntradas,
      emprestimosNaoReceita,
      saidasRealizadas,
      saidasPrevistas,
      saidasTotais,
      provisoesFolhaIncluidas: roundCents(provisoesFolhaIncluidas),
      saldoProjetado: runningBalance,
      saldoProjetadoComFunil,
      negativo,
    });
  }

  return {
    possuiDados: true,
    encargosConfigurados: payroll.configurado,
    meses,
    mesesNegativos,
    saldoFinalProjetado:
      meses.length > 0 ? meses[meses.length - 1].saldoProjetado : null,
  };
}
