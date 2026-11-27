import type { ActorRole, PilotisDataState } from '../types/pilotis';
import { addDaysISO, addMonthsISO, formatBRL, formatDateBR, formatPercentBR, isValidISODate } from './formatters';
import {
  calcularAlertasSistema, calcularDreEmpresa, calcularDreObra, calcularIndicadoresDashboard,
  calcularPrevisaoCaixa, calcularProgressoObra, calcularResumoDividas, calcularResumoFinanceiroPeriodo,
  calcularResumoFolhaEquipe, calcularResumoFunilOrcamentos, calculateTeamPayroll, toDomainInstallments, toDomainTransactions,
} from './pilotisAdapters';
import { getInvoiceReceipts, pendingInvoiceReceipts, sumPendingInvoices } from './complianceWorkflows';
import { resolverStatusConformidade } from './conformidade';
import { deduplicarReceitasEParcelas } from './financeiro';
import { simulateCommercialCash } from './orcamentos';
import { resolveTeamWeek, weekStartingOn } from './teamPlanning';

export type AiMode = 'Analista' | 'Consultor';
export type AiTopic = 'finance' | 'forecast' | 'debts' | 'invoices' | 'projects' | 'stages' |
  'funnel' | 'team' | 'payroll' | 'compliance' | 'weekly';
export type AiShortcut = 'funnel' | 'simulator' | 'allocation';
export interface AiSource {
  module: string;
  collections: string[];
  period: string;
  subject?: string;
  records: string[];
}
export interface AiFact {
  id: string;
  label: string;
  value: string;
  source: AiSource;
}
export interface AiAnswer {
  text: string;
  facts: AiFact[];
  suggestions: AiShortcut[];
  guidance: boolean;
  consulted: string[];
  explanation: string;
}
export interface AiTurn {
  id: string;
  conversationId: string;
  mode: AiMode;
  question: string;
  weekly: boolean;
  week: string;
  answer: AiAnswer;
  createdAt: string;
  createdBy: ActorRole;
}

export const WEEKLY_QUESTION = 'Gerar resumo semanal operacional';
export const CONSULTANT_ACTIONS: Record<AiShortcut, { label: string; text: string }> = {
  funnel: { label: 'Abrir Funil', text: 'Revise os orçamentos abertos e as probabilidades antes de contar com novas contratações.' },
  simulator: { label: 'Abrir Simulador', text: 'Compare no simulador como a entrada e o número de parcelas afetam a previsão de caixa.' },
  allocation: { label: 'Abrir Alocação', text: 'Confira as semanas com pessoas sem obra ou com conflito antes de ajustar as alocações.' },
};

function normalize(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

export function classifyAiQuestionTopics(question: string, weekly: boolean, previousQuestion = ''): Set<AiTopic> {
  if (weekly) return new Set(['weekly', 'finance', 'forecast', 'debts', 'invoices', 'projects', 'stages', 'funnel', 'team', 'payroll', 'compliance']);
  function classify(text: string) {
    const topics = new Set<AiTopic>();
    const match = (pattern: RegExp, ...keys: AiTopic[]) => { if (pattern.test(text)) keys.forEach((key) => topics.add(key)); };
    match(/\b(caixa|saldo|financeir\w*|resultado|receitas?|despesas?|lancamentos?|receb\w*|saidas?|entra\w*|sai\w*|a pagar|pagar)\b/, 'finance');
    match(/\b(fluxo|previs\w*|proximos meses|proximos? \d+ meses|simul\w*|entradas?|parcelamento|parcelas?|caixa)\b/, 'forecast', 'finance');
    match(/\b(dividas?|emprestim\w*|credito|juros|tributos?|endividamento)\b/, 'debts');
    match(/\b(notas?|nf|faturamento|emitir|emiss\w*)\b/, 'invoices');
    match(/\b(dre|obras?|margens?|custos?|contratos?|lucro|orcado|realizado)\b/, 'projects', 'finance');
    match(/\b(etapas?|cronograma|atras\w*|progresso|andamento|caminho critico)\b/, 'stages', 'projects');
    match(/\b(orcamentos?|funil|negociacao|propostas?|comercial|vendas?|probabilidade|simul\w*)\b/, 'funnel');
    match(/\b(equipe|aloca\w*|colaborador\w*|sem obra|funcionario\w*|ferias|ociosidade)\b/, 'team');
    match(/\b(folha|encargos?|provisoes|salari\w*|pro.labore)\b/, 'payroll');
    match(/\b(certidoes|certidao|obrigac\w*|conformidade|documentos?|art|rrt|cno|vencem?|vencimento|licitac\w*|fiscal|inss|fgts)\b/, 'compliance');
    return topics;
  }
  const topics = classify(normalize(question));
  if (previousQuestion && (topics.size === 0 || /^(e |tambem |agora )/.test(normalize(question)))) {
    classify(normalize(previousQuestion)).forEach((topic) => topics.add(topic));
  }
  return topics.size ? topics : new Set(['finance', 'forecast', 'projects', 'compliance']);
}

export function needsProfessionalGuidance(question: string) {
  return /\b(fisc\w*|tribut\w*|juridic\w*|trabalhist\w*|advog\w*|contad\w*|inss|fgts|iss|imposto\w*|nota fiscal|notas fiscais|vinculo|clt|certidao|certidoes|licitac\w*|regulariz\w*|garantia|folha|rescis\w*|funcionario\w*|dctfweb|esocial|efd.reinf|simples nacional|pro.labore|ferias|salari\w*)\b/.test(normalize(question));
}

function monthPeriod(first: string) {
  return { start: first, end: addDaysISO(addMonthsISO(first, 1), -1) };
}

const MONTH_NAMES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function questionHasPeriod(question: string) {
  const text = normalize(question);
  return /\b(?:\d{4}-\d{2}-\d{2}|\d{2}\/(?:\d{2}\/)?\d{4}|(?:19|20)\d{2}|mes|semana)\b/.test(text)
    || MONTH_NAMES.some((month) => new RegExp('\\b' + month + '\\b').test(text));
}

export function resolveAiPeriod(question: string, today: string) {
  const text = normalize(question);
  const dates = [...text.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/g)]
    .map(([date]) => date.includes('/') ? date.split('/').reverse().join('-') : date)
    .filter(isValidISODate).sort();
  if (dates.length) return { start: dates[0], end: dates.at(-1)! };
  const month = /\b(0[1-9]|1[0-2])\/(\d{4})\b/.exec(text);
  if (month && isValidISODate(month[2] + '-' + month[1] + '-01')) return monthPeriod(month[2] + '-' + month[1] + '-01');
  const named = MONTH_NAMES.findIndex((value) => new RegExp('\\b' + value + '\\b').test(text));
  const year = /\b(?:19|20)\d{2}\b/.exec(text)?.[0];
  if (named !== -1) return monthPeriod((year ?? today.slice(0, 4)) + '-' + String(named + 1).padStart(2, '0') + '-01');
  if (year) return { start: year + '-01-01', end: year + '-12-31' };
  if (/\bsemana\b/.test(text)) {
    const start = addDaysISO(weekStartingOn(today), /semana passada/.test(text) ? -7 : /proxima semana/.test(text) ? 7 : 0);
    return { start, end: addDaysISO(start, 6) };
  }
  return monthPeriod(addMonthsISO(today.slice(0, 7) + '-01', /mes passado/.test(text) ? -1 : /proximo mes\b/.test(text) ? 1 : 0));
}

export function formatAiPeriod(start: string, end = start) {
  return start === end ? formatDateBR(start) : formatDateBR(start) + ' a ' + formatDateBR(end);
}

const MAX_FACTS = 280;
type AddFact = (label: string, value: string | number | null | undefined, source: AiSource, format?: (value: number) => string) => void;
type SourceOptions = { subject?: string; records?: string[]; period?: string };
type SourceFor = (module: string, collections: string[], options?: SourceOptions) => AiSource;

function readFinance(data: PilotisDataState, today: string, range: ReturnType<typeof resolveAiPeriod>, add: AddFact, source: SourceFor) {
  const metrics = calcularIndicadoresDashboard(data, today);
  const history = data.transactions.filter((row) => !row.isForecast && row.date <= today && (row.status === 'Recebido' || row.status === 'Pago' || row.status === 'Não é receita'));
  const periodRecords = [
    ...data.transactions.filter((row) => {
      const date = row.isForecast ? row.dueDate || row.date : row.date;
      return date >= range.start && date <= range.end && row.entryKind !== 'loan';
    }).map((row) => row.id),
    ...data.installments.filter((row) => [row.dueDate, row.receivedDate].some((date) => date && date >= range.start && date <= range.end)).map((row) => row.id),
  ];
  const month = resolveAiPeriod('', today);
  if (range.start === month.start && range.end === month.end) {
    const summary = calcularResumoFinanceiroPeriodo(data, today);
    const cash = source('Dashboard · Caixa', ['transactions', 'parcelas'], { period: 'Até ' + formatDateBR(today), records: history.map((row) => row.id) });
    add('Saldo de caixa realizado (inclui entradas de empréstimo no caixa)', metrics.saldoRealizadoCaixa, cash, formatBRL);
    add('A receber em atraso ou nos próximos 30 dias', metrics.aReceber30Dias,
      source('Dashboard · A receber', ['parcelas', 'transactions'], { period: 'Vencidos e com vencimento até ' + formatDateBR(addDaysISO(today, 30)) }), formatBRL);
    const periodSource = source('Financeiro · Visão geral', ['transactions', 'parcelas'], { records: periodRecords });
    if (summary.possuiMovimentoRealizadoNoMes) {
      add('Entradas realizadas no mês, excluindo empréstimos', summary.entradasMes, periodSource, formatBRL);
      add('Saídas realizadas no mês', summary.saidasMes, periodSource, formatBRL);
      add('Resultado realizado no mês', summary.resultadoMes, periodSource, formatBRL);
    }
    if (summary.possuiRecebiveis) {
      add('Parcelas em aberto', summary.recebiveisEmAbertoQtd, source('Financeiro · A receber', ['parcelas', 'transactions']));
      add('Valor a receber em aberto', summary.recebiveisEmAbertoValor, source('Financeiro · A receber', ['parcelas', 'transactions']), formatBRL);
    }
  }

  const dre = calcularDreEmpresa(data, range.start, range.end);
  const dreSource = source('Financeiro · DRE da empresa', ['transactions', 'parcelas'], { records: periodRecords });
  if (dre.possuiRealizado) {
    add('Receita realizada da empresa no período', dre.receitas.realizado, dreSource, formatBRL);
    add('Custo realizado da empresa no período', dre.custosTotais.realizado, dreSource, formatBRL);
    add('Resultado realizado da empresa no período', dre.resultado.realizado, dreSource, formatBRL);
    add('Margem realizada da empresa no período', dre.margemRealizadaPct, dreSource, formatPercentBR);
  }
}

function readForecast(data: PilotisDataState, today: string, question: string, add: AddFact, source: SourceFor) {
  const forecast = calcularPrevisaoCaixa(data, 5, today);
  if (!forecast.possuiDados) return;
  const months = /\b(\d+)\s+meses\b/.exec(normalize(question));
  const count = months ? Math.min(5, Math.max(1, Number(months[1]))) : 5;
  const columns = (month: (typeof forecast.meses)[number]) => [
    ['Entradas realizadas', month.realizadoEntradas], ['Entradas contratadas', month.contratadoEntradas],
    ['Funil ponderado', month.funilPonderadoEntradas], ['Saídas totais', month.saidasTotais],
    ['Provisões da folha incluídas', month.provisoesFolhaIncluidas], ['Saldo projetado', month.saldoProjetado],
    ['Saldo projetado com funil', month.saldoProjetadoComFunil],
  ] as const;
  const { lancamentosUnicos, parcelasAbertas } = deduplicarReceitasEParcelas(toDomainTransactions(data.transactions), toDomainInstallments(data.installments));
  const baseMonth = today.slice(0, 7);
  const plannedMonth = (date: string) => date && date.slice(0, 7) < baseMonth ? baseMonth : date.slice(0, 7);
  for (const month of forecast.meses.slice(0, count)) {
    const range = monthPeriod(month.mesKey + '-01');
    const transactionIds = lancamentosUnicos.filter((row) =>
      (row.previsto ? plannedMonth(row.vencimento || row.data) : row.data.slice(0, 7)) === month.mesKey).map((row) => row.id);
    const installmentIds = parcelasAbertas.filter((row) => plannedMonth(row.vencimento) === month.mesKey).map((row) => row.id);
    const ref = source('Financeiro · Fluxo de caixa', ['transactions', 'parcelas', 'quotes', 'employees', 'allocations', 'companySettings'],
      { period: formatAiPeriod(range.start, range.end), records: [...transactionIds, ...installmentIds] });
    for (const [label, value] of columns(month)) add(label + ' · ' + month.rotulo, value, ref, formatBRL);
  }
}

function readProjects(data: PilotisDataState, projects: PilotisDataState['projects'], today: string, add: AddFact, source: SourceFor) {
  for (const project of projects) {
    const closure = data.projectClosures?.find((item) => item.projectId === project.id);
    const dre = closure?.dre ?? calcularDreObra(project, data.transactions, data.stages);
    const period = project.startDate
      ? formatAiPeriod(project.startDate, closure?.date || today)
      : 'Até ' + formatDateBR(closure?.date || today);
    const ref = source('Financeiro · DRE por obra', ['projects', 'projectClosures', 'stages', 'transactions'], {
      subject: project.name, period,
      records: [project.id, ...data.transactions.filter((row) => row.projectId === project.id && !row.isForecast).map((row) => row.id)],
    });
    add('Receita orçada da obra', dre.receita.orcado, ref, formatBRL);
    if (dre.custosTotais.orcado > 0) add('Custo orçado da obra', dre.custosTotais.orcado, ref, formatBRL);
    if (dre.possuiRealizado) {
      add('Receita realizada da obra', dre.receita.realizado, ref, formatBRL);
      add('Custo realizado da obra', dre.custosTotais.realizado, ref, formatBRL);
      add('Margem realizada da obra', dre.margemRealizadaPct, ref, formatPercentBR);
      add('Resultado realizado da obra', dre.resultado.realizado, ref, formatBRL);
    }
    const plan = source('Planejamento · Visão geral', ['projects', 'stages'], { subject: project.name, period: formatAiPeriod(today), records: [project.id] });
    add('Situação da obra', project.status, plan);
    add('Progresso da obra', calcularProgressoObra(project.id, data.stages), plan, formatPercentBR);
  }
}
 
function readSimulation(data: PilotisDataState, question: string, today: string, projects: PilotisDataState['projects'], add: AddFact, source: SourceFor) {
  const text = normalize(question);
  const down = /(?:entrada(?:\s+de)?\s+(\d+(?:[.,]\d+)?)\s*%|(\d+(?:[.,]\d+)?)\s*%\s+de entrada)/.exec(text);
  const installments = /\b(\d+)\s*(?:parcelas|x)\b/.exec(text);
  if (!down || !installments) return;
  const pct = Number((down[1] ?? down[2]).replace(',', '.'));
  const count = Number(installments[1]);
  if (pct < 0 || pct > 100 || count < 1 || count > 36) return;
  const quotes = data.quotes.filter((row) => row.code && text.split(/\s+/).some((word) => word.replace(/[,.?!]/g, '') === normalize(row.code)));
  const quote = quotes.length === 1 ? quotes[0] : undefined;
  const project = projects.length === 1 ? projects[0] : undefined;
  const base = quote?.totalValue ?? project?.contractValue ?? 0;
  if (!Number.isFinite(base) || base <= 0) return;
  const payroll = calcularResumoFolhaEquipe(data.employees, data.settings, today);
  const simulation = simulateCommercialCash({
    valorTotal: base, entradaPct: pct, nParcelas: count, dataInicio: today,
    folhaMensalEstimada: payroll.custoTotalMensal ?? payroll.folhaBase,
  });
  const ref = source('Financeiro · Simulador', [quote ? 'quotes' : 'projects'], {
    subject: quote ? 'Orçamento ' + quote.code : project?.name, period: formatAiPeriod(today),
    records: [quote?.id ?? project?.id ?? ''].filter(Boolean),
  });
  add('Cenário simulado · entrada considerada', simulation.valorEntrada, ref, formatBRL);
  add('Cenário simulado · parcela mensal média', simulation.parcelaMensalMedia, ref, formatBRL);
  add('Cenário simulado · saldo parcelado', simulation.saldoParcelado, ref, formatBRL);
  if (simulation.quarterGap !== null) {
    add('Cenário simulado · diferença para cobrir a folha dos três primeiros meses', simulation.quarterGap,
      { ...ref, collections: [...ref.collections, 'employees', 'companySettings'] }, formatBRL);
  }
}

export function readAiFacts(data: PilotisDataState, question: string, today: string, topics: Set<AiTopic>, previousQuestion = '', mode: AiMode = 'Analista') {
  const weekly = topics.has('weekly');
  const week = weekStartingOn(today);
  const range = weekly ? { start: addDaysISO(week, -7), end: addDaysISO(week, -1) } : resolveAiPeriod(question, today);
  const facts: AiFact[] = [];
  const source: SourceFor = (module, collections, options = {}) => ({
    module, collections, period: options.period ?? formatAiPeriod(range.start, range.end),
    ...(options.subject ? { subject: options.subject } : {}),
    records: [...new Set(options.records ?? [])].slice(0, 8),
  });
  const add: AddFact = (label, value, ref, format = String) => {
    if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value)) || facts.length >= MAX_FACTS) return;
    facts.push({ id: 'f' + (facts.length + 1), label, value: typeof value === 'number' ? format(value) : value, source: ref });
  };
  const projectsIn = (text: string) => data.projects.filter((item) => item.name && normalize(text).includes(normalize(item.name)));
  const mentionedNow = projectsIn(question);
  const mentioned = mentionedNow.length ? mentionedNow : projectsIn(previousQuestion);
  const projects = mentioned.length ? mentioned : data.projects;
  const current = formatAiPeriod(today);
  if (mode === 'Consultor' && topics.has('forecast')) readSimulation(data, question, today, mentioned, add, source);
  if (topics.has('finance') && !mentioned.length) readFinance(data, today, range, add, source);
  if (topics.has('forecast') && !mentioned.length) readForecast(data, today, question, add, source);
  if (topics.has('debts') && !mentioned.length) {
    const debts = calcularResumoDividas(data.debts);
    const ref = source('Financeiro · Dívidas e crédito', ['debts'], { period: current, records: data.debts.map((row) => row.id) });
    add('Saldo devedor', debts.dividaTotal, ref, formatBRL);
    add('Custo mensal de dívidas', debts.custoMensal, ref, formatBRL);
    add('Tributos em atraso', debts.tributosEmAtraso, ref, formatBRL);
    add('Próximo vencimento de dívida', debts.proximoVencimento ? formatDateBR(debts.proximoVencimento) : null, ref);
  }
  if (topics.has('invoices')) {
    const filterByDate = weekly || questionHasPeriod(question);
    const receipts = getInvoiceReceipts(data.transactions, data.installments).filter((row) =>
      (!filterByDate || (row.date >= range.start && row.date <= range.end)) &&
      (!mentioned.length || mentioned.some((project) => project.id === row.projectId)));
    const period = filterByDate ? formatAiPeriod(range.start, range.end) : 'Todos os recebimentos registrados';
    const pending = pendingInvoiceReceipts(receipts);
    const ids = (row: (typeof pending)[number]) => [row.target.transactionId ?? '', row.target.installmentId ?? ''].filter(Boolean);
    const ref = source('Conformidade · Notas fiscais', ['transactions', 'parcelas'], { records: pending.flatMap(ids), period, subject: mentioned.length === 1 ? mentioned[0].name : undefined });
    add('Total recebido sem nota emitida', receipts.length ? sumPendingInvoices(pending) : null, ref, formatBRL);
    for (const row of pending.slice(0, 24)) {
      add('Recebimento sem nota emitida', formatBRL(row.amount) + (row.date ? ' em ' + formatDateBR(row.date) : ' · data de recebimento sem registro'),
        source('Conformidade · Notas fiscais', ['transactions', 'parcelas'], { subject: row.projectName || (row.projectId === 'Empresa' ? 'Empresa' : data.projects.find((project) => project.id === row.projectId)?.name), records: ids(row), period: row.date ? formatAiPeriod(row.date) : 'Data de recebimento sem registro' }));
    }
  }
  if (topics.has('funnel') && data.quotes.length) {
    const funnel = calcularResumoFunilOrcamentos(data.quotes);
    const ref = source('Clientes e Orçamentos · Funil', ['quotes'], { period: current, records: data.quotes.map((row) => row.id) });
    add('Orçamentos em aberto', funnel.abertosCount, ref);
    add('Valor em aberto no funil', funnel.valorFunil, ref, formatBRL);
    add('Previsão ponderada do funil', funnel.previsaoPonderada, ref, formatBRL);
    const candidates = data.quotes.filter((item) => item.status !== 'Descartado' || /descart/.test(normalize(question)));
    const matchingCode = candidates.filter((item) => item.code && normalize(question).includes(normalize(item.code)));
    for (const row of (matchingCode.length ? matchingCode : candidates).slice(0, 30)) {
      add('Orçamento ' + row.code + ' · ' + row.status, formatBRL(row.totalValue) + ' · probabilidade ' + formatPercentBR(row.probabilityPct),
        source('Clientes e Orçamentos · Funil', ['quotes'], { period: current, records: [row.id] }));
    }
  }
  if (topics.has('compliance')) {
    const text = normalize(question);
    const certOnly = /\b(certidoes|certidao)\b/.test(text);
    const lateOnly = /\b(vencid\w*|atras\w*)\b/.test(text);
    const restrictToPeriod = questionHasPeriod(question);
    const upcomingOnly = /\b(vence|vencem|vencerao|vencer)\b/.test(text);
    const complianceRange = weekly ? { start: week, end: addDaysISO(week, 6) } : range;
    const items = data.complianceItems.filter((item) => (!certOnly || item.kind === 'Certidão')
      && (!mentioned.length || mentioned.some((project) => project.id === item.projectId))
      && (weekly || !restrictToPeriod || (item.dueDate >= complianceRange.start && item.dueDate <= complianceRange.end)));
    for (const row of items.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      const status = resolverStatusConformidade({ tipo: row.kind, status: row.status, vencimento: row.dueDate }, today);
      if (lateOnly && status !== 'Em atraso') continue;
      if (upcomingOnly && !lateOnly && (!row.dueDate || (complianceRange.end >= today && row.dueDate < today))) continue;
      if (weekly && status !== 'Em atraso' && (!row.dueDate || row.dueDate < complianceRange.start || row.dueDate > complianceRange.end)) continue;
      add(row.kind + ' · ' + row.title, status + (row.dueDate ? ' · vencimento em ' + formatDateBR(row.dueDate) : ''),
        source('Conformidade · ' + row.kind, ['complianceItems'], { subject: row.projectName, period: row.dueDate ? formatAiPeriod(row.dueDate) : current, records: [row.id] }));
    }
  }
  if (topics.has('payroll') && data.employees.length && !mentioned.length) {
    const month = (weekly ? today : range.start).slice(0, 7);
    const payroll = calculateTeamPayroll(data, month);
    if (payroll.lines.length) {
      const period = monthPeriod(month + '-01');
      const ref = source('Equipe · Folha e encargos', ['employees', 'allocations', 'projects', 'companySettings'],
        { period: formatAiPeriod(period.start, period.end) });
      add('Custo conhecido no quadro da folha', payroll.totalKnown, ref, formatBRL);
      add('Parâmetros de encargos da folha', payroll.configured ? 'Configurados' : 'Não configurados', ref);
    }
  }
  if (topics.has('team') && data.employees.length) {
    const targetWeek = weekly ? week : weekStartingOn(range.start <= today && today <= range.end ? today : range.start);
    const options = { period: formatAiPeriod(targetWeek, addDaysISO(targetWeek, 6)) };
    const rows = data.employees.map((employee) => ({ employee, assignment: resolveTeamWeek(employee, targetWeek, data) }))
      .filter(({ assignment }) => !mentioned.length || mentioned.some((project) => project.id === assignment.project?.id));
    const ref = source('Equipe · Alocação', ['allocations', 'employees', 'projects'], options);
    if (rows.length) {
      add('Pessoas sem obra na semana', rows.filter(({ assignment }) => assignment.idle).length, ref);
      add('Pessoas com conflito na semana', rows.filter(({ assignment }) => assignment.conflict).length, ref);
    }
    for (const { employee, assignment } of rows) {
      add('Alocação · ' + employee.name, assignment.label,
        source('Equipe · Alocação', ['allocations', 'employees', 'projects'], { ...options, records: [employee.id, ...(assignment.allocation ? [assignment.allocation.id] : [])] }));
    }
  }
  if (topics.has('stages')) {
    for (const row of data.stages.filter((item) => projects.some((project) => project.id === item.projectId))) {
      const project = projects.find((item) => item.id === row.projectId);
      const ref = source('Planejamento · Etapas', ['stages', 'projects'], { period: current, subject: project?.name, records: [row.id] });
      add('Etapa ' + row.wbsCode + ' · ' + row.name, row.status + ' · progresso ' + formatPercentBR(row.progressPct), ref);
    }
  }
  if (topics.has('projects')) readProjects(data, projects, today, add, source);
  return facts;
}

export function readWeeklyInsights(data: PilotisDataState, today: string) {
  const weekEnd = addDaysISO(weekStartingOn(today), 6);
  const byId = new Map(data.complianceItems.map((item) => [item.id, item]));
  return calcularAlertasSistema(data, today).filter((alert) => {
    const compliance = alert.modulo === 'compliance' ? byId.get(alert.referenciaId ?? '') : undefined;
    return !compliance || alert.nivel === 'Urgente' || compliance.dueDate <= weekEnd;
  }).slice(0, 4);
}

export function suggestedActions(facts: AiFact[]): AiShortcut[] {
  const allowed: AiShortcut[] = [];
  if (facts.some((fact) => fact.source.collections.includes('quotes'))) allowed.push('funnel');
  if (facts.some((fact) => fact.source.module === 'Financeiro · Fluxo de caixa' || fact.source.module === 'Financeiro · Simulador')) allowed.push('simulator');
  if (facts.some((fact) => fact.source.module === 'Equipe · Alocação')) allowed.push('allocation');
  return allowed;
}

function validIds(input: unknown) {
  return Array.isArray(input) ? [...new Set(input.filter((value): value is string => typeof value === 'string'))] : [];
}

const topicSources: Record<AiTopic, string> = {
  finance: 'Financeiro · Lançamentos e parcelas', forecast: 'Financeiro · Fluxo de caixa',
  debts: 'Financeiro · Dívidas e crédito', invoices: 'Conformidade · Notas fiscais', projects: 'Financeiro · DRE por obra',
  stages: 'Planejamento · Etapas', funnel: 'Clientes e Orçamentos · Funil', team: 'Equipe · Alocação',
  payroll: 'Equipe · Folha e encargos', compliance: 'Conformidade · Registros', weekly: '',
};

function explainFacts(facts: AiFact[]) {
  if (facts.some((fact) => fact.source.module === 'Financeiro · Simulador')) {
    return 'Cenário calculado a partir do valor cadastrado e das condições informadas na pergunta.';
  }
  if (facts.some((fact) => fact.source.module === 'Financeiro · Fluxo de caixa')) {
    return 'O fluxo distingue recebimentos realizados, parcelas contratadas e valores ponderados do funil.';
  }
  if (facts.some((fact) => fact.label.startsWith('Margem realizada'))) {
    return 'A margem realizada relaciona o resultado e a receita realizados no DRE.';
  }
  if (facts.some((fact) => fact.source.module === 'Equipe · Alocação')) {
    return 'A alocação segue a matriz semanal e considera férias e conflitos.';
  }
  return '';
}

export function renderAiAnswer(selection: unknown, facts: AiFact[], mode: AiMode, question: string, weekly: boolean, topics = classifyAiQuestionTopics(question, weekly)): AiAnswer {
  const result = selection && typeof selection === 'object' ? selection as { factIds?: unknown; suggestionIds?: unknown } : {};
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const selected = validIds(result.factIds).map((id) => byId.get(id)).filter((fact): fact is AiFact => Boolean(fact)).slice(0, 45);
  const allowed = new Set(suggestedActions(selected));
  const suggestions = mode === 'Consultor'
    ? validIds(result.suggestionIds).filter((id): id is AiShortcut => allowed.has(id as AiShortcut))
    : [];
  return {
    text: selected.length ? (weekly ? 'Resumo semanal dos registros consultados.' : 'Dados encontrados no sistema.')
      : weekly ? 'Não há dados no sistema para gerar o resumo semanal.' : 'Não há dados suficientes no sistema para responder a essa pergunta.',
    facts: selected, suggestions, explanation: explainFacts(selected),
    consulted: selected.length ? [] : [...topics].map((topic) => topicSources[topic]).filter(Boolean),
    guidance: needsProfessionalGuidance(question) || selected.some((fact) => needsProfessionalGuidance(fact.label)
      || fact.source.collections.includes('complianceItems')),
  };
}
