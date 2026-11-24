import {
  addMonthsISO,
  formatBRL,
  formatDateBR,
  parseDateBRToISO,
  roundCents,
} from './formatters';
import type {
  ActorRole,
  LancamentoRecord,
  NotaFiscalStatus,
  ParcelaRecord,
  ParcelaStatus,
} from './types';

export interface ParcelaGerada {
  numero: number;
  rotulo: string;
  vencimento: string;
  vencimentoBR: string;
  valor: number;
  status: ParcelaStatus;
  notaFiscal: NotaFiscalStatus;
}

export function gerarParcelas(
  valorTotal: number,
  entradaPct: number,
  nParcelas: number,
  dataInicio: string,
): ParcelaGerada[] {
  if (!Number.isFinite(valorTotal) || valorTotal < 0) {
    throw new Error('valorTotal deve ser um número maior ou igual a zero.');
  }
  if (!Number.isFinite(entradaPct) || entradaPct < 0 || entradaPct > 100) {
    throw new Error('entradaPct deve estar entre 0 e 100.');
  }
  if (!Number.isInteger(nParcelas) || nParcelas < 1) {
    throw new Error('nParcelas deve ser um número inteiro maior ou igual a 1.');
  }

  const startISO = parseDateBRToISO(dataInicio);
  if (!startISO) {
    throw new Error(`dataInicio inválida: "${dataInicio}"`);
  }

  const totalCents = Math.round(valorTotal * 100);
  const entradaCents = Math.round(totalCents * (entradaPct / 100));
  const saldoCents = totalCents - entradaCents;

  const result: ParcelaGerada[] = [];

  if (entradaCents > 0) {
    result.push({
      numero: 0,
      rotulo: `Entrada (${entradaPct}%)`,
      vencimento: startISO,
      vencimentoBR: formatDateBR(startISO),
      valor: entradaCents / 100,
      status: 'A vencer',
      notaFiscal: 'A emitir',
    });
  }

  const baseParcelaCents = Math.floor(saldoCents / nParcelas);
  const acumuladoSemUltima = baseParcelaCents * (nParcelas - 1);
  const ultimaParcelaCents = saldoCents - acumuladoSemUltima;

  for (let i = 1; i <= nParcelas; i++) {
    const dueISO = addMonthsISO(startISO, i);
    const parcelCents = i === nParcelas ? ultimaParcelaCents : baseParcelaCents;
    result.push({
      numero: i,
      rotulo: `${i}/${nParcelas}`,
      vencimento: dueISO,
      vencimentoBR: formatDateBR(dueISO),
      valor: parcelCents / 100,
      status: 'A vencer',
      notaFiscal: 'A emitir',
    });
  }

  return result;
}

export interface ComposicaoOrcamentoInput {
  maoDeObra: number;
  empreita: number;
  equipamentos: number;
  outrosCustos?: number;
  bdi?: number;
  bdiPct?: number;
  impostos?: number;
  impostosPct?: number;
  valorTotal?: number;
  margemDesejadaPct?: number;
}

export interface ComposicaoOrcamentoResult {
  custosDiretos: number;
  bdiValor: number;
  impostosValor: number;
  custoTotal: number;
  valorTotal: number;
  margemReais: number;
  margemPct: number;
}

export function composicaoOrcamento(
  input: ComposicaoOrcamentoInput,
): ComposicaoOrcamentoResult {
  const maoDeObra = Math.max(0, input.maoDeObra || 0);
  const empreita = Math.max(0, input.empreita || 0);
  const equipamentos = Math.max(0, input.equipamentos || 0);
  const outrosCustos = Math.max(0, input.outrosCustos || 0);

  const custosDiretos = roundCents(
    maoDeObra + empreita + equipamentos + outrosCustos,
  );

  const bdiValor =
    input.bdi !== undefined
      ? roundCents(Math.max(0, input.bdi))
      : roundCents(custosDiretos * (Math.max(0, input.bdiPct ?? 0) / 100));

  let impostosValor = 0;
  if (input.impostos !== undefined) {
    impostosValor = roundCents(Math.max(0, input.impostos));
  } else if (input.impostosPct !== undefined) {
    const taxRate = Math.max(0, input.impostosPct) / 100;
    if (input.valorTotal !== undefined) {
      impostosValor = roundCents(Math.max(0, input.valorTotal) * taxRate);
    } else {
      impostosValor = roundCents((custosDiretos + bdiValor) * taxRate);
    }
  }

  const custoTotal = roundCents(custosDiretos + bdiValor + impostosValor);

  let valorTotal = custoTotal;
  if (input.valorTotal !== undefined) {
    valorTotal = roundCents(Math.max(0, input.valorTotal));
  } else if (input.margemDesejadaPct !== undefined) {
    if (input.margemDesejadaPct < 0 || input.margemDesejadaPct >= 100) {
      throw new Error('margemDesejadaPct deve estar entre 0 e 99,99.');
    }
    valorTotal = roundCents(custoTotal / (1 - input.margemDesejadaPct / 100));
  }

  const margemReais = roundCents(valorTotal - custoTotal);
  const margemPct =
    valorTotal > 0 ? roundCents((margemReais / valorTotal) * 100) : 0;

  return {
    custosDiretos,
    bdiValor,
    impostosValor,
    custoTotal,
    valorTotal,
    margemReais,
    margemPct,
  };
}

export interface AvaliacaoMargemResult {
  metaConfigurada: boolean;
  metaPct: number | null;
  diferencaPct: number | null;
  status: 'acima' | 'abaixo' | 'sem_meta';
}

export function avaliarMargemContraMeta(
  margemPct: number,
  metaMargemPct?: number | null,
): AvaliacaoMargemResult {
  if (metaMargemPct === undefined || metaMargemPct === null || metaMargemPct <= 0) {
    return {
      metaConfigurada: false,
      metaPct: null,
      diferencaPct: null,
      status: 'sem_meta',
    };
  }
  const diferencaPct = roundCents(margemPct - metaMargemPct);
  return {
    metaConfigurada: true,
    metaPct: roundCents(metaMargemPct),
    diferencaPct,
    status: margemPct >= metaMargemPct ? 'acima' : 'abaixo',
  };
}

export interface SimulacaoPagamentoInput {
  valorTotal: number;
  entradaPct: number;
  nParcelas: number;
  dataInicio: string;
  folhaMensalEstimada?: number;
}

export interface SimulacaoPagamentoResult {
  valorEntrada: number;
  saldoParcelado: number;
  parcelaMensalMedia: number;
  primeiraParcela: number;
  ultimaParcela: number;
  parcelas: ParcelaGerada[];
  coberturaFolhaPct: number | null;
  efeitoCaixa: 'positivo' | 'atencao' | 'neutro';
  mensagemCaixa: string;
}

export function simularPagamentoOrcamento(
  input: SimulacaoPagamentoInput,
): SimulacaoPagamentoResult {
  const parcelas = gerarParcelas(
    input.valorTotal,
    input.entradaPct,
    input.nParcelas,
    input.dataInicio,
  );
  const entryItem = parcelas.find((installment) => installment.numero === 0);
  const installmentItems = parcelas.filter((installment) => installment.numero > 0);
  const valorEntrada = entryItem ? entryItem.valor : 0;
  const saldoParcelado = roundCents(input.valorTotal - valorEntrada);
  const primeiraParcela = installmentItems[0]?.valor ?? 0;
  const ultimaParcela = installmentItems[installmentItems.length - 1]?.valor ?? 0;
  const parcelaMensalMedia =
    installmentItems.length > 0
      ? roundCents(saldoParcelado / installmentItems.length)
      : 0;

  const folha = input.folhaMensalEstimada ?? 0;
  if (folha <= 0) {
    return {
      valorEntrada,
      saldoParcelado,
      parcelaMensalMedia,
      primeiraParcela,
      ultimaParcela,
      parcelas,
      coberturaFolhaPct: null,
      efeitoCaixa: 'neutro',
      mensagemCaixa:
        'Cadastre colaboradores em Equipe para comparar a parcela mensal com o custo mensal da folha.',
    };
  }

  const coberturaFolhaPct = roundCents((parcelaMensalMedia / folha) * 100);
  if (coberturaFolhaPct < 50) {
    return {
      valorEntrada,
      saldoParcelado,
      parcelaMensalMedia,
      primeiraParcela,
      ultimaParcela,
      parcelas,
      coberturaFolhaPct,
      efeitoCaixa: 'atencao',
      mensagemCaixa: `Parcelas em ${input.nParcelas}x cobrem ${coberturaFolhaPct.toFixed(0)}% da folha mensal atual (${formatBRL(folha)}). Teste entrada maior ou menos parcelas para reforçar o caixa.`,
    };
  }

  return {
    valorEntrada,
    saldoParcelado,
    parcelaMensalMedia,
    primeiraParcela,
    ultimaParcela,
    parcelas,
    coberturaFolhaPct,
    efeitoCaixa: 'positivo',
    mensagemCaixa: `Parcela mensal média cobre ${coberturaFolhaPct.toFixed(0)}% da folha mensal atual da equipe.`,
  };
}

export interface ConfirmacaoOrcamentoInput {
  clienteId?: string | null;
  valorTotal?: number | null;
  entradaPct?: number | null;
  nParcelas?: number | null;
  dataInicio?: string | null;
  status?: string | null;
  projectId?: string | null;
}

export interface ConfirmacaoOrcamentoValidacao {
  valido: boolean;
  erros: string[];
  dataInicioISO: string | null;
}

export function validarDadosConfirmacaoOrcamento(
  input: ConfirmacaoOrcamentoInput,
): ConfirmacaoOrcamentoValidacao {
  const erros: string[] = [];

  if (input.projectId && input.projectId.trim().length > 0) {
    erros.push('Este orçamento já foi confirmado e possui uma obra vinculada.');
  }
  if (input.status === 'Perdido' || input.status === 'Descartado') {
    erros.push('Orçamentos perdidos ou descartados precisam ser reativados antes da confirmação.');
  }
  if (!input.clienteId || input.clienteId.trim().length === 0) {
    erros.push('Selecione um cliente válido antes de confirmar o orçamento.');
  }
  if (
    typeof input.valorTotal !== 'number' ||
    !Number.isFinite(input.valorTotal) ||
    input.valorTotal <= 0
  ) {
    erros.push('Informe um valor total fechado maior que R$ 0,00.');
  }
  if (
    typeof input.entradaPct !== 'number' ||
    !Number.isFinite(input.entradaPct) ||
    input.entradaPct < 0 ||
    input.entradaPct > 100
  ) {
    erros.push('Informe um percentual de entrada entre 0% e 100%.');
  }
  if (
    typeof input.nParcelas !== 'number' ||
    !Number.isInteger(input.nParcelas) ||
    input.nParcelas < 1 ||
    input.nParcelas > 36
  ) {
    erros.push('Informe a quantidade de parcelas entre 1 e 36.');
  }

  const dataInicioISO = input.dataInicio
    ? parseDateBRToISO(input.dataInicio.trim())
    : null;
  if (!dataInicioISO) {
    erros.push('Informe uma data de início válida para o contrato e parcelas.');
  }

  return {
    valido: erros.length === 0,
    erros,
    dataInicioISO,
  };
}

export interface ResumoFunilOrcamentosResult {
  abertosCount: number;
  valorFunil: number;
  previsaoPonderada: number;
  fechadosCount: number;
  ganhosCount: number;
  taxaConversaoPct: number | null;
}

export function resumoFunilOrcamentos(
  orcamentos: Array<{
    status: string;
    valorTotal: number;
    probabilidadePct: number;
  }>,
): ResumoFunilOrcamentosResult {
  const abertos = orcamentos.filter(
    (q) =>
      q.status === 'Rascunho' ||
      q.status === 'Enviado' ||
      q.status === 'Em negociação',
  );
  const valorFunil = roundCents(abertos.reduce((s, q) => s + (q.valorTotal || 0), 0));
  const previsaoPonderada = roundCents(
    abertos.reduce(
      (s, q) => s + (q.valorTotal || 0) * ((q.probabilidadePct || 0) / 100),
      0,
    ),
  );
  const fechados = orcamentos.filter(
    (q) => q.status === 'Ganho' || q.status === 'Perdido',
  );
  const ganhos = orcamentos.filter((q) => q.status === 'Ganho');
  const taxaConversaoPct =
    fechados.length > 0 ? Math.round((ganhos.length / fechados.length) * 100) : null;

  return {
    abertosCount: abertos.length,
    valorFunil,
    previsaoPonderada,
    fechadosCount: fechados.length,
    ganhosCount: ganhos.length,
    taxaConversaoPct,
  };
}

export interface PrepararRecebimentoParcelaInput {
  parcela: ParcelaRecord;
  dataRecebimento: string;
  actor: ActorRole;
  projetoNome: string;
  clienteNome?: string;
  formaPagamento?: string;
  transactionId?: string;
}

export interface PrepararRecebimentoParcelaResult {
  parcelaAtualizada: ParcelaRecord;
  lancamentoRealizado: LancamentoRecord;
}

export function prepararRecebimentoParcela(
  input: PrepararRecebimentoParcelaInput,
): PrepararRecebimentoParcelaResult {
  const { parcela, actor, projetoNome, clienteNome, formaPagamento, transactionId } = input;
  if (parcela.status === 'Recebida') {
    throw new Error('Esta parcela já foi registrada como recebida.');
  }

  const receivedISO = parseDateBRToISO(input.dataRecebimento);
  if (!receivedISO) {
    throw new Error(`Data de recebimento inválida: "${input.dataRecebimento}"`);
  }

  const timestampISO = `${receivedISO}T12:00:00Z`;
  const isDownPayment = parcela.numero === 0;
  const suffix = clienteNome?.trim() ? ` (${clienteNome.trim()})` : '';
  const descricao = isDownPayment
    ? `Entrada · ${projetoNome}${suffix}`
    : `Parcela ${parcela.rotulo} · ${projetoNome}${suffix}`;

  const parcelaAtualizada: ParcelaRecord = {
    ...parcela,
    status: 'Recebida',
    dataRecebimento: receivedISO,
    updatedBy: actor,
    updatedAt: timestampISO,
  };

  const lancamentoRealizado: LancamentoRecord = {
    id: transactionId || `tx_${parcela.id}`,
    data: receivedISO,
    vencimento: parcela.vencimento,
    descricao,
    tipo: 'receita',
    categoria: 'Receita de obra',
    obraId: parcela.obraId,
    valor: parcela.valor,
    previsto: false,
    status: 'Recebido',
    notaFiscal: parcela.notaFiscal,
    formaPagamento: formaPagamento?.trim() || 'Transferência',
    origem: 'orcamento',
    parcelaId: parcela.id,
    createdBy: actor,
    createdAt: timestampISO,
    updatedBy: actor,
    updatedAt: timestampISO,
  };

  return { parcelaAtualizada, lancamentoRealizado };
}
