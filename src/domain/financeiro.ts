import { diffDaysISO, monthKey, roundCents } from './formatters';
import type {
  DividaRecord,
  DividaStatus,
  LancamentoRecord,
  LancamentoStatus,
  LancamentoTipo,
  ParcelaRecord,
  ParcelaStatus,
} from './types';

export interface ClassificarLancamentoInput {
  descricao: string;
  categoria?: string;
  tipoInformado?: LancamentoTipo | 'income' | 'expense' | 'loan';
  valor: number;
  previsto?: boolean;
  statusInformado?: LancamentoStatus;
}

export interface LancamentoClassificado {
  tipo: LancamentoTipo;
  categoria: string;
  natureza: 'previsto' | 'realizado';
  valor: number;
  entraComoReceita: boolean;
  entraNoDre: boolean;
  geraDivida: boolean;
  rejeitadoComoReceita: boolean;
  status: LancamentoStatus;
  motivo?: string;
}

const LOAN_KEYWORDS = [
  'emprestimo',
  'empréstimo',
  'emprest',
  'financiamento',
  'conta garantida',
  'cheque especial',
  'capital de giro',
  'credito bancario',
  'crédito bancário',
];

export function isLoanKeywordPresent(text: string): boolean {
  const normalized = (text || '').trim().toLowerCase();
  return LOAN_KEYWORDS.some((kw) => normalized.includes(kw));
}

export function classificarLancamento(
  input: ClassificarLancamentoInput,
): LancamentoClassificado {
  const valor = roundCents(Math.max(0, input.valor || 0));
  const rawCategory = (input.categoria || '').trim();
  const rawDesc = (input.descricao || '').trim();
  const askedIncome =
    input.tipoInformado === 'receita' || input.tipoInformado === 'income';
  const askedLoan =
    input.tipoInformado === 'emprestimo' || input.tipoInformado === 'loan';

  const detectedLoan = askedLoan || (askedIncome && (
    isLoanKeywordPresent(rawCategory) || isLoanKeywordPresent(rawDesc)
  ));

  if (detectedLoan) {
    return {
      tipo: 'emprestimo',
      categoria: 'Empréstimo',
      natureza: 'realizado',
      valor,
      entraComoReceita: false,
      entraNoDre: false,
      geraDivida: true,
      rejeitadoComoReceita: askedIncome,
      status: 'Não é receita',
      motivo:
        'Empréstimo nunca entra como receita; classificado separadamente como entrada de crédito/dívida.',
    };
  }

  const tipo: LancamentoTipo = askedIncome ? 'receita' : 'despesa';
  const previsto = Boolean(input.previsto);
  const natureza: 'previsto' | 'realizado' = previsto ? 'previsto' : 'realizado';

  let status: LancamentoStatus;
  if (
    input.statusInformado &&
    input.statusInformado !== 'Não é receita' &&
    input.statusInformado !== 'Em atraso'
  ) {
    status = input.statusInformado;
  } else if (previsto) {
    status = 'A vencer';
  } else {
    status = tipo === 'receita' ? 'Recebido' : 'Pago';
  }

  return {
    tipo,
    categoria:
      rawCategory || (tipo === 'receita' ? 'Receita de obra' : 'Outros'),
    natureza,
    valor,
    entraComoReceita: tipo === 'receita',
    entraNoDre: true,
    geraDivida: false,
    rejeitadoComoReceita: false,
    status,
  };
}

export function resolverStatusParcela(
  parcela: Pick<ParcelaRecord, 'status' | 'vencimento'>,
  dataReferenciaISO: string,
): ParcelaStatus {
  if (parcela.status === 'Recebida') return 'Recebida';
  const due = (parcela.vencimento || '').trim().slice(0, 10);
  const ref = (dataReferenciaISO || '').trim().slice(0, 10);
  if (due && ref && due < ref) {
    return 'Em atraso';
  }
  return 'A vencer';
}

export function isParcelaEmAtraso(
  parcela: Pick<ParcelaRecord, 'status' | 'vencimento'>,
  dataReferenciaISO: string,
): boolean {
  return resolverStatusParcela(parcela, dataReferenciaISO) === 'Em atraso';
}

export function resolverStatusLancamento(
  lancamento: Pick<
    LancamentoRecord,
    'tipo' | 'status' | 'previsto' | 'vencimento' | 'data'
  >,
  dataReferenciaISO: string,
): LancamentoStatus {
  if (lancamento.tipo === 'emprestimo' || lancamento.status === 'Não é receita') {
    return 'Não é receita';
  }
  if (lancamento.status === 'Recebido' || lancamento.status === 'Pago') {
    return lancamento.status;
  }
  const due = (lancamento.vencimento || lancamento.data || '').trim().slice(0, 10);
  const ref = (dataReferenciaISO || '').trim().slice(0, 10);
  if (due && ref && due < ref) {
    return 'Em atraso';
  }
  return 'A vencer';
}

export function resolverStatusDivida(
  divida: Pick<DividaRecord, 'status' | 'proximoVencimento'>,
  dataReferenciaISO: string,
): DividaStatus {
  if (divida.status === 'Quitada') return 'Quitada';
  const due = (divida.proximoVencimento || '').trim().slice(0, 10);
  const ref = (dataReferenciaISO || '').trim().slice(0, 10);
  if (due && ref && due < ref) {
    return 'Em atraso';
  }
  return divida.status === 'Em atraso' ? 'Em dia' : divida.status;
}

export interface ReceitasEParcelasDeduplicadas {
  parcelaIds: Set<string>;
  realizedParcelaIds: Set<string>;
  lancamentosUnicos: LancamentoRecord[];
  parcelasAbertas: ParcelaRecord[];
}

/**
 * Garante /parcelas como fonte única das contas a receber vinculadas a orçamentos/obras:
 * - Qualquer lançamento previsto em /transactions com parcelaId existente em /parcelas é ignorado
 *   (evita dupla contagem com espelhos legados).
 * - Lançamentos realizados com o mesmo parcelaId são deduplicados.
 * - Uma parcela só é considerada em aberto se status !== 'Recebida' e não houver lançamento realizado vinculado.
 */
export function deduplicarReceitasEParcelas(
  lancamentos: LancamentoRecord[],
  parcelas: ParcelaRecord[],
): ReceitasEParcelasDeduplicadas {
  const parcelaIds = new Set(parcelas.map((p) => p.id));
  const realizedParcelaIds = new Set<string>();
  const lancamentosUnicos: LancamentoRecord[] = [];

  for (const tx of lancamentos) {
    const pid = (tx.parcelaId || '').trim();
    const isRealizedIncome =
      tx.tipo === 'receita' && !tx.previsto && tx.status === 'Recebido';

    if (tx.tipo === 'receita' && pid && !isRealizedIncome && parcelaIds.has(pid)) {
      continue;
    }

    if (isRealizedIncome && pid) {
      if (realizedParcelaIds.has(pid)) {
        continue;
      }
      realizedParcelaIds.add(pid);
    }

    lancamentosUnicos.push(tx);
  }

  const parcelasAbertas = parcelas.filter(
    (p) => p.status !== 'Recebida' && !realizedParcelaIds.has(p.id),
  );

  return {
    parcelaIds,
    realizedParcelaIds,
    lancamentosUnicos,
    parcelasAbertas,
  };
}

export interface ValidarLancamentoInput {
  descricao: string;
  categoria: string;
  tipoInformado: LancamentoTipo | 'income' | 'expense' | 'loan';
  obraId: string;
  valor: number;
}

export interface ValidarLancamentoResult {
  valido: boolean;
  errosCount: number;
  erroEmprestimoComoReceita: string | null;
  erroCentroCusto: string | null;
  erroValorOuDescricao: string | null;
}

export function validarLancamentoFinanceiro(
  input: ValidarLancamentoInput,
): ValidarLancamentoResult {
  const isIncome =
    input.tipoInformado === 'receita' || input.tipoInformado === 'income';
  const looksLikeLoan =
    isLoanKeywordPresent(input.categoria) ||
    isLoanKeywordPresent(input.descricao);

  const erroEmprestimoComoReceita =
    isIncome && looksLikeLoan
      ? 'Empréstimo não pode entrar como receita, porque aumentaria o faturamento. Selecione "Empréstimo" acima para registrar como dívida.'
      : null;

  const erroCentroCusto = !input.obraId.trim()
    ? 'Escolha a obra ou "Empresa" para continuar.'
    : null;

  const erroValorOuDescricao =
    !input.descricao.trim() || !Number.isFinite(input.valor) || input.valor <= 0
      ? 'Preencha a descrição e um valor maior que zero.'
      : null;

  const errosCount =
    (erroEmprestimoComoReceita ? 1 : 0) +
    (erroCentroCusto ? 1 : 0) +
    (erroValorOuDescricao ? 1 : 0);

  return {
    valido: errosCount === 0,
    errosCount,
    erroEmprestimoComoReceita,
    erroCentroCusto,
    erroValorOuDescricao,
  };
}

export function isRealizedCashEntry(entry: LancamentoRecord): boolean {
  if (entry.previsto) return false;
  if (entry.tipo === 'emprestimo') return entry.status === 'Não é receita' || entry.status === 'Recebido';
  return entry.tipo === 'receita' ? entry.status === 'Recebido' : entry.status === 'Pago';
}

export function signedCashAmount(entry: LancamentoRecord): number {
  return entry.tipo === 'despesa' ? -entry.valor : entry.valor;
}

export interface ResumoFinanceiroPeriodoResult {
  possuiLancamentos: boolean;
  possuiMovimentoRealizadoNoMes: boolean;
  entradasMes: number;
  saidasMes: number;
  folhaMes: number;
  folhaParticipacaoPct: number | null;
  resultadoMes: number | null;
  possuiReceitasComNf: boolean;
  receitaSemNota: number | null;
  saldoRealizadoCaixa: number | null;
  possuiRecebiveis: boolean;
  recebiveisEmAbertoQtd: number;
  recebiveisEmAbertoValor: number;
  recebidosNoMesValor: number;
  recebiveisEmAtrasoValor: number;
  tributosEmAtrasoQtd: number;
  tributosEmAtrasoValor: number;
}

export function resumoFinanceiroPeriodo(
  lancamentos: LancamentoRecord[],
  parcelas: ParcelaRecord[],
  dataReferenciaISO: string,
): ResumoFinanceiroPeriodoResult {
  const mesAtual = monthKey(dataReferenciaISO);
  const { lancamentosUnicos, parcelasAbertas } = deduplicarReceitasEParcelas(
    lancamentos,
    parcelas,
  );
  const semEmprestimo = lancamentosUnicos.filter((l) => l.tipo !== 'emprestimo');
  const mesTxs = semEmprestimo.filter(
    (l) => isRealizedCashEntry(l) && monthKey(l.data) === mesAtual && l.data <= dataReferenciaISO,
  );

  const entradasMes = roundCents(
    mesTxs
      .filter((l) => l.tipo === 'receita')
      .reduce((sum, l) => sum + l.valor, 0),
  );
  const saidasMes = roundCents(
    mesTxs
      .filter((l) => l.tipo === 'despesa')
      .reduce((sum, l) => sum + l.valor, 0),
  );
  const folhaMes = roundCents(
    mesTxs
      .filter(
        (l) =>
          l.tipo === 'despesa' &&
          (l.categoria.toLowerCase() === 'folha' || l.origem === 'folha'),
      )
      .reduce((sum, l) => sum + l.valor, 0),
  );
  const folhaParticipacaoPct =
    saidasMes > 0 ? Math.round((folhaMes / saidasMes) * 100) : null;
  const hasMesMovements = mesTxs.length > 0;
  const resultadoMes = hasMesMovements ? roundCents(entradasMes - saidasMes) : null;

  const receitasTxs = semEmprestimo.filter((l) => l.tipo === 'receita');
  const possuiReceitasComNf = receitasTxs.length > 0 || parcelasAbertas.length > 0;
  const receitaSemNota = possuiReceitasComNf
    ? roundCents(
        receitasTxs
          .filter((l) => l.notaFiscal === 'Não emitida')
          .reduce((sum, l) => sum + l.valor, 0) +
          parcelasAbertas
            .filter((p) => p.notaFiscal === 'Não emitida')
            .reduce((sum, p) => sum + p.valor, 0),
      )
    : null;

  const realizados = lancamentosUnicos.filter(
    (l) => isRealizedCashEntry(l) && l.data <= dataReferenciaISO,
  );
  const saldoRealizadoCaixa =
    realizados.length > 0
      ? roundCents(
          realizados.reduce(
            (sum, l) => sum + signedCashAmount(l),
            0,
          ),
        )
      : null;

  const avulsasReceita = receitasTxs.filter((l) => !l.parcelaId);
  const possuiRecebiveis = parcelas.length > 0 || avulsasReceita.length > 0;

  const avulsasAbertas = avulsasReceita.filter((l) => l.status !== 'Recebido');
  const recebiveisEmAbertoQtd = parcelasAbertas.length + avulsasAbertas.length;
  const recebiveisEmAbertoValor = roundCents(
    parcelasAbertas.reduce((s, p) => s + p.valor, 0) +
      avulsasAbertas.reduce((s, l) => s + l.valor, 0),
  );

  const recebidosNoMesValor = roundCents(
    parcelas
      .filter(
        (p) =>
          p.status === 'Recebida' &&
          monthKey(p.dataRecebimento || p.vencimento) === mesAtual,
      )
      .reduce((s, p) => s + p.valor, 0) +
      avulsasReceita
        .filter(
          (l) =>
            l.status === 'Recebido' &&
            monthKey(l.data || l.vencimento) === mesAtual,
        )
        .reduce((s, l) => s + l.valor, 0),
  );

  const recebiveisEmAtrasoValor = roundCents(
    parcelasAbertas
      .filter((p) => isParcelaEmAtraso(p, dataReferenciaISO))
      .reduce((s, p) => s + p.valor, 0) +
      avulsasAbertas
        .filter((l) => resolverStatusLancamento(l, dataReferenciaISO) === 'Em atraso')
        .reduce((s, l) => s + l.valor, 0),
  );

  const tributosEmAtraso = semEmprestimo.filter(
    (l) =>
      l.tipo === 'despesa' &&
      l.status !== 'Pago' &&
      l.categoria.trim().toLowerCase() === 'tributos' &&
      resolverStatusLancamento(l, dataReferenciaISO) === 'Em atraso',
  );

  return {
    possuiLancamentos: lancamentosUnicos.length > 0 || parcelas.length > 0,
    possuiMovimentoRealizadoNoMes: hasMesMovements,
    entradasMes,
    saidasMes,
    folhaMes,
    folhaParticipacaoPct,
    resultadoMes,
    possuiReceitasComNf,
    receitaSemNota,
    saldoRealizadoCaixa,
    possuiRecebiveis,
    recebiveisEmAbertoQtd,
    recebiveisEmAbertoValor,
    recebidosNoMesValor,
    recebiveisEmAtrasoValor,
    tributosEmAtrasoQtd: tributosEmAtraso.length,
    tributosEmAtrasoValor: roundCents(
      tributosEmAtraso.reduce((s, l) => s + l.valor, 0),
    ),
  };
}

export function installmentProgress(installments: ParcelaRecord[], projectId: string) {
  const projectInstallments = installments.filter((installment) => installment.obraId === projectId);
  const total = projectInstallments.length;
  const received = projectInstallments.filter((installment) => installment.status === 'Recebida').length;
  return { received, total, percentage: total ? Math.round(received / total * 100) : null };
}

export interface ResumoDividasResult {
  possuiDados: boolean;
  dividaTotal: number | null;
  custoMensal: number | null;
  tributosEmAtraso: number | null;
  contaGarantida: number | null;
  proximoVencimento: string | null;
}

export function resumoDividas(dividas: DividaRecord[]): ResumoDividasResult {
  if (dividas.length === 0) {
    return {
      possuiDados: false,
      dividaTotal: null,
      custoMensal: null,
      tributosEmAtraso: null,
      contaGarantida: null,
      proximoVencimento: null,
    };
  }
  const ativas = dividas.filter((d) => d.status !== 'Quitada');
  const dueDates = ativas
    .map((d) => d.proximoVencimento)
    .filter((dt) => Boolean(dt && dt.trim()))
    .sort();

  return {
    possuiDados: true,
    dividaTotal: roundCents(ativas.reduce((s, d) => s + d.saldoDevedor, 0)),
    custoMensal: roundCents(ativas.reduce((s, d) => s + (d.custoMensal || 0), 0)),
    tributosEmAtraso: roundCents(
      ativas
        .filter((d) => d.tipo === 'Tributo em atraso')
        .reduce((s, d) => s + d.saldoDevedor, 0),
    ),
    contaGarantida: roundCents(
      ativas
        .filter((d) => d.tipo === 'Conta garantida')
        .reduce((s, d) => s + d.saldoDevedor, 0),
    ),
    proximoVencimento: dueDates[0] ?? null,
  };
}

export type StatusConciliacaoExtrato =
  | 'Conciliado'
  | 'Sugerido'
  | 'Revisar'
  | 'Classificar';

export interface ExtratoLinhaEntrada {
  statementKey?: string;
  id: string;
  data: string;
  descricao: string;
  valorAssinado: number;
}

export interface ExtratoLinhaConciliada {
  statementKey?: string;
  settleTransactionId?: string;
  id: string;
  data: string;
  descricao: string;
  valor: number;
  tipo: LancamentoTipo;
  categoria: string;
  obraId: string;
  statusConciliacao: StatusConciliacaoExtrato;
  motivoConciliacao: string;
  incluirNaImportacao: boolean;
  alertaEmprestimo: boolean;
  lancamentoCorrespondenteId?: string;
  parcelaSugeridaId?: string;
}

function inferExpenseCategoryFromText(descLower: string): string | null {
  if (/(das|simples|inss|fgts|darf|iss|tributo|imposto|gps)/.test(descLower)) {
    return 'Tributos';
  }
  if (/(folha|salario|salário|adiantamento|ferias|férias|13o|13º)/.test(descLower)) {
    return 'Folha';
  }
  if (/(pedreiro|servente|eletricista|pintor|diaria|diária|mao de obra|mão de obra)/.test(descLower)) {
    return 'Mão de obra';
  }
  if (/(empreit|subempreit|gesso|marmore|mármore|esquadria|serralheria)/.test(descLower)) {
    return 'Subempreitada';
  }
  if (/(epi|andaime|betoneira|ferramenta|equipamento|locacao|locação)/.test(descLower)) {
    return 'Equipamentos e EPI';
  }
  if (/(tarifa|juro|iof|cesta|ted|doc|taxa bancaria|taxa bancária)/.test(descLower)) {
    return 'Juros e tarifas';
  }
  if (/(comissao|comissão)/.test(descLower)) {
    return 'Comissão';
  }
  if (/(retirada|pro-labore|pró-labore|socio|sócio)/.test(descLower)) {
    return 'Retirada de sócio';
  }
  return null;
}

function shareSignificantToken(a: string, b: string): boolean {
  const tokensA = a
    .toLowerCase()
    .split(/[^a-z0-9áéíóúâêôãõç]+/)
    .filter((t) => t.length >= 4);
  const lowerB = b.toLowerCase();
  return tokensA.some((tok) => lowerB.includes(tok));
}

export function conciliarExtratoBancario(
  linhas: ExtratoLinhaEntrada[],
  lancamentosExistentes: LancamentoRecord[],
  parcelasExistentes: ParcelaRecord[],
  obras: Array<{ id: string; nome: string }>,
): ExtratoLinhaConciliada[] {
  const matchedIds = new Set<string>();
  return linhas
    .filter((row) => Number.isFinite(row.valorAssinado) && row.valorAssinado !== 0)
    .map((row) => {
      const absValor = roundCents(Math.abs(row.valorAssinado));
      const desc = (row.descricao || 'Movimento bancário').trim().slice(0, 180);
      const descLower = desc.toLowerCase();
      const isCredit = row.valorAssinado > 0;
      const detectedLoan = isCredit && isLoanKeywordPresent(desc);

      const matchedProject = obras.find((o) => {
        const nameLower = o.nome.trim().toLowerCase();
        return nameLower.length >= 4 && descLower.includes(nameLower);
      });

      const exactMatchTx = lancamentosExistentes.find((tx) => {
        if (matchedIds.has(tx.id)) return false;
        if (row.statementKey && tx.statementKey === row.statementKey) return true;
        if (Math.abs(tx.valor - absValor) >= 0.005) return false;
        const diff = diffDaysISO(row.data, tx.previsto ? tx.vencimento || tx.data : tx.data);
        if (diff === null || (tx.previsto ? Math.abs(diff) > 2 : diff !== 0)) return false;
        if (detectedLoan) return tx.tipo === 'emprestimo' && shareSignificantToken(desc, tx.descricao);
        const sameDirection = isCredit
          ? tx.tipo === 'receita'
          : tx.tipo === 'despesa';
        return sameDirection && shareSignificantToken(desc, tx.descricao);
      });

      if (exactMatchTx) {
        matchedIds.add(exactMatchTx.id);
        const settle = exactMatchTx.previsto && !exactMatchTx.parcelaId;
        if (!exactMatchTx.previsto || settle) return {
          id: row.id, statementKey: row.statementKey,
          data: row.data,
          descricao: desc,
          valor: absValor,
          tipo: exactMatchTx.tipo,
          categoria: exactMatchTx.categoria,
          obraId: exactMatchTx.obraId || 'Empresa',
          statusConciliacao: settle ? 'Sugerido' : 'Conciliado',
          motivoConciliacao: (settle ? 'Baixar lançamento previsto: ' : 'Já lançado: ') + exactMatchTx.descricao,
          incluirNaImportacao: false,
          settleTransactionId: settle ? exactMatchTx.id : undefined,
          alertaEmprestimo: detectedLoan,
          lancamentoCorrespondenteId: exactMatchTx.id,
        };
      }

      if (detectedLoan) {
        return {
          id: row.id, statementKey: row.statementKey,
          data: row.data,
          descricao: desc,
          valor: absValor,
          tipo: 'emprestimo',
          categoria: 'Empréstimo',
          obraId: 'Empresa',
          statusConciliacao: 'Revisar',
          motivoConciliacao: 'Crédito identificado. Confira o lançamento antes de importar.',
          incluirNaImportacao: false,
          alertaEmprestimo: true,
        };
      }

      if (isCredit) {
        const candidateInstallments = parcelasExistentes.filter((p) => {
          if (p.status === 'Recebida' || matchedIds.has(p.id)) return false;
          if (Math.abs(p.valor - absValor) >= 0.005) return false;
          const diff = diffDaysISO(row.data, p.vencimento);
          return diff !== null && Math.abs(diff) <= 7;
        });

        const matchingProject = matchedProject
          ? candidateInstallments.filter((p) => p.obraId === matchedProject.id)
          : candidateInstallments;
        const openParcela = matchingProject.length === 1 ? matchingProject[0] : undefined;

        if (openParcela) {
          matchedIds.add(openParcela.id);
          return {
            id: row.id, statementKey: row.statementKey,
            data: row.data,
            descricao: desc,
            valor: absValor,
            tipo: 'receita',
            categoria: 'Receita de obra',
            obraId: openParcela.obraId,
            statusConciliacao: 'Sugerido',
            motivoConciliacao: `Baixar parcela ${openParcela.rotulo} em aberto`,
            incluirNaImportacao: false,
            alertaEmprestimo: false,
            parcelaSugeridaId: openParcela.id,
          };
        }

        if (matchingProject.length > 1) {
          return {
            id: row.id, statementKey: row.statementKey, data: row.data, descricao: desc, valor: absValor,
            tipo: 'receita', categoria: 'Receita de obra', obraId: matchedProject?.id || '',
            statusConciliacao: 'Revisar', motivoConciliacao: 'Mais de uma parcela compatível. Confira em A receber.',
            incluirNaImportacao: false, alertaEmprestimo: false,
          };
        }

        if (matchedProject) {
          return {
            id: row.id, statementKey: row.statementKey,
            data: row.data,
            descricao: desc,
            valor: absValor,
            tipo: 'receita',
            categoria: 'Receita de obra',
            obraId: matchedProject.id,
            statusConciliacao: 'Sugerido',
            motivoConciliacao: `Obra identificada: ${matchedProject.nome}`,
            incluirNaImportacao: true,
            alertaEmprestimo: false,
          };
        }

        return {
          id: row.id, statementKey: row.statementKey,
          data: row.data,
          descricao: desc,
          valor: absValor,
          tipo: 'receita',
          categoria: 'Receita de obra',
          obraId: '',
          statusConciliacao: 'Classificar',
          motivoConciliacao: 'Vincule à obra ou confirme centro "Empresa"',
          incluirNaImportacao: true,
          alertaEmprestimo: false,
        };
      }

      const suggestedCat = inferExpenseCategoryFromText(descLower);
      if (suggestedCat || matchedProject) {
        return {
          id: row.id, statementKey: row.statementKey,
          data: row.data,
          descricao: desc,
          valor: absValor,
          tipo: 'despesa',
          categoria: suggestedCat || 'Outros',
          obraId: matchedProject?.id || 'Empresa',
          statusConciliacao: 'Sugerido',
          motivoConciliacao: matchedProject
            ? `Sugestão: ${suggestedCat || 'Despesa'} · ${matchedProject.nome}`
            : `Categoria sugerida: ${suggestedCat}`,
          incluirNaImportacao: true,
          alertaEmprestimo: false,
        };
      }

      return {
        id: row.id, statementKey: row.statementKey,
        data: row.data,
        descricao: desc,
        valor: absValor,
        tipo: 'despesa',
        categoria: 'Outros',
        obraId: '',
        statusConciliacao: 'Classificar',
        motivoConciliacao: 'Defina categoria e obra ou "Empresa"',
        incluirNaImportacao: true,
        alertaEmprestimo: false,
      };
    });
}
