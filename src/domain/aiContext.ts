export type AiContextTopic =
  | 'finance_summary'
  | 'cashflow'
  | 'debts'
  | 'invoices'
  | 'projects'
  | 'stages'
  | 'quotes'
  | 'team_allocation'
  | 'payroll_aggregate'
  | 'compliance'
  | 'weekly_summary';

const FORBIDDEN_KEYS = new Set<string>([
  'basesalary',
  'salario',
  'salary',
  'salarioindividual',
  'salariobase',
  'remuneracao',
  'cpf',
  'cnpj',
  'rg',
  'cnh',
  'pis',
  'ctps',
  'tituloeleitor',
  'documento',
  'documentos',
  'documentopessoal',
  'email',
  'telefone',
  'phone',
  'celular',
  'whatsapp',
  'endereco',
  'fiscaladdress',
  'address',
  'filename',
  'arquivo',
  'anexo',
  'comprovante',
  'receiptref',
  'asovalidade',
  'asoexpiry',
  'nr18validade',
  'nr18expiry',
  'nr35validade',
  'nr35expiry',
  'paymentmethod',
  'formapagamento',
  'vacationperiod',
  'vacationscheduled',
  'occurrencesnote',
  'notes',
  'observacoes',
  'clientname',
  'cliente',
  'referredby',
  'quemindicou',
  'photourl',
  'logodataurl',
  'startdate',
  'dataadmissao',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeKey(key: string): string {
  return normalizeText(key).replace(/[^a-z0-9]/g, '');
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function stripForbiddenDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.slice(0, 600);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 40)
      .map((item) => stripForbiddenDeep(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(normalizeKey(k))) continue;
      const cleaned = stripForbiddenDeep(v, depth + 1);
      if (cleaned !== undefined) {
        out[k] = cleaned;
      }
    }
    return out;
  }
  return undefined;
}

function pickFields(
  obj: Record<string, unknown>,
  allowedKeys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in obj && !FORBIDDEN_KEYS.has(normalizeKey(key))) {
      const cleaned = stripForbiddenDeep(obj[key]);
      if (cleaned !== undefined) {
        out[key] = cleaned;
      }
    }
  }
  return out;
}

export function classifyAiQuestionTopics(
  question: string,
  isWeeklySummary: boolean,
): Set<AiContextTopic> {
  if (isWeeklySummary) {
    return new Set<AiContextTopic>([
      'weekly_summary',
      'finance_summary',
      'cashflow',
      'debts',
      'projects',
      'stages',
      'quotes',
      'payroll_aggregate',
      'compliance',
      'invoices',
    ]);
  }

  const normalized = normalizeText(question);
  const topics = new Set<AiContextTopic>();

  if (
    /\b(caixa|entra|entram|entradas|sai|saem|saidas|fluxo|saldo|previs|proximos?\s+\d+\s+meses|parcela|a receber|a pagar|receber|pagar)\b/.test(
      normalized,
    )
  ) {
    topics.add('cashflow');
    topics.add('finance_summary');
  }

  if (
    /\b(divida|dividas|emprestimo|emprestimos|credito|conta garantida|tributo|tributos|juros|endividamento)\b/.test(
      normalized,
    )
  ) {
    topics.add('debts');
    topics.add('finance_summary');
  }

  if (/\b(nota|notas|nf|faturamento|sem nota|emitir|a emitir)\b/.test(normalized)) {
    topics.add('invoices');
    topics.add('finance_summary');
  }

  const withoutSemObra = normalized.replace(/\bsem\s+obra\b/g, ' ');
  if (
    /\b(obras?|dre|margem|margens|custo|custos|orcado|realizado|contrato|contratos|lucro|bdi|subempreitada)\b/.test(
      withoutSemObra,
    )
  ) {
    topics.add('projects');
    topics.add('finance_summary');
  }

  if (
    /\b(etapa|etapas|cronograma|atraso|atrasos|atrasada|atrasadas|progresso|andamento|material|diario|caminho critico)\b/.test(
      normalized,
    )
  ) {
    topics.add('stages');
    topics.add('projects');
  }

  if (
    /\b(orcamento|orcamentos|funil|proposta|propostas|negociacao|ganho|perdido|venda|vendas|comercial|prontidao)\b/.test(
      normalized,
    )
  ) {
    topics.add('quotes');
  }

  if (
    /\b(equipe|colaborador|colaboradores|alocad[oa]s?|alocacao|sem obra|quem|funcionario|funcionarios|pessoal|ferias)\b/.test(
      normalized,
    )
  ) {
    topics.add('team_allocation');
    topics.add('payroll_aggregate');
  }

  if (
    /\b(folha|encargo|encargos|inss|fgts|provisao|provisoes|custo mensal|headcount)\b/.test(
      normalized,
    )
  ) {
    topics.add('payroll_aggregate');
  }

  if (
    /\b(certidao|certidoes|conformidade|obrigacao|obrigacoes|documento|documentos|art|rrt|cno|alvara|vence|vencem|vencimento|licitacao|licitacoes|pop|pops)\b/.test(
      normalized,
    )
  ) {
    topics.add('compliance');
  }

  if (topics.size === 0) {
    topics.add('finance_summary');
    topics.add('cashflow');
    topics.add('projects');
    topics.add('compliance');
  }

  return topics;
}

export function sanitizeAiContextSnapshot(
  rawSnapshot: unknown,
  question: string,
  isWeeklySummary: boolean,
): Record<string, unknown> {
  if (!isPlainRecord(rawSnapshot)) return {};

  const topics = classifyAiQuestionTopics(question, isWeeklySummary);
  const result: Record<string, unknown> = {};

  if (
    (topics.has('finance_summary') ||
      topics.has('cashflow') ||
      topics.has('projects') ||
      topics.has('weekly_summary')) &&
    isPlainRecord(rawSnapshot.resumoExecutivo)
  ) {
    result.resumoExecutivo = pickFields(rawSnapshot.resumoExecutivo, [
      'cashBalance',
      'forecastMonthEndCash',
      'receivables30Days',
      'receivables30Count',
      'overdueReceivablesCount',
      'monthResult',
      'averageMarginPct',
      'activeProjectsCount',
      'negotiatingQuotesCount',
      'unissuedInvoicesAmount',
    ]);
  }

  if (
    (topics.has('cashflow') || topics.has('weekly_summary')) &&
    Array.isArray(rawSnapshot.fluxoCaixaProjetado5Meses)
  ) {
    result.fluxoCaixaProjetado5Meses = rawSnapshot.fluxoCaixaProjetado5Meses
      .slice(0, 6)
      .filter(isPlainRecord)
      .map((item) =>
        pickFields(item, [
          'monthKey',
          'label',
          'contractedIn',
          'funnelWeightedIn',
          'realizedIn',
          'outflows',
          'provisionsIncluded',
          'projectedBalance',
          'projectedBalanceWithFunnel',
          'isNegative',
        ]),
      );
  }

  if (
    (topics.has('payroll_aggregate') ||
      topics.has('team_allocation') ||
      topics.has('weekly_summary')) &&
    isPlainRecord(rawSnapshot.folhaEquipe)
  ) {
    result.folhaEquipe = pickFields(rawSnapshot.folhaEquipe, [
      'totalHeadcount',
      'cltCount',
      'otherCount',
      'recurringNonCltCount',
      'basePayroll',
      'chargesTotal',
      'provisionsTotal',
      'totalMonthlyCost',
      'paramsConfigured',
    ]);
  }

  if (
    (topics.has('debts') || topics.has('weekly_summary')) &&
    isPlainRecord(rawSnapshot.dividasResumo)
  ) {
    result.dividasResumo = pickFields(rawSnapshot.dividasResumo, [
      'totalBalance',
      'overdueTaxesBalance',
      'monthlyCommitment',
      'nextDueDate',
      'activeCount',
    ]);
  }

  if (
    (topics.has('projects') || topics.has('stages') || topics.has('weekly_summary')) &&
    Array.isArray(rawSnapshot.obras)
  ) {
    result.obras = rawSnapshot.obras
      .slice(0, 25)
      .filter(isPlainRecord)
      .map((item) => {
        const picked = pickFields(item, ['nome', 'tipo', 'status', 'valorContrato']);
        if (isPlainRecord(item.dre)) {
          picked.dre = pickFields(item.dre, [
            'revenueBudgeted',
            'revenueRealized',
            'laborBudgeted',
            'laborRealized',
            'subcontractBudgeted',
            'subcontractRealized',
            'equipmentBudgeted',
            'equipmentRealized',
            'taxBudgeted',
            'taxRealized',
            'bdiBudgeted',
            'bdiRealized',
            'totalDirectBudgeted',
            'totalDirectRealized',
            'marginBudgeted',
            'marginRealized',
            'marginRealizedPct',
            'marginBudgetedPct',
          ]);
        }
        return picked;
      });
  }

  if (
    (topics.has('stages') || topics.has('weekly_summary')) &&
    Array.isArray(rawSnapshot.etapasEmAndamentoOuAtrasadas)
  ) {
    result.etapasEmAndamentoOuAtrasadas = rawSnapshot.etapasEmAndamentoOuAtrasadas
      .slice(0, 30)
      .filter(isPlainRecord)
      .map((item) =>
        pickFields(item, [
          'obraId',
          'codigo',
          'etapa',
          'status',
          'progressoPct',
          'atrasoCategoria',
          'atrasoJustificativa',
        ]),
      );
  }

  if (
    (topics.has('quotes') || topics.has('weekly_summary')) &&
    Array.isArray(rawSnapshot.orcamentosAbertos)
  ) {
    result.orcamentosAbertos = rawSnapshot.orcamentosAbertos
      .slice(0, 20)
      .filter(isPlainRecord)
      .map((item) =>
        pickFields(item, ['codigo', 'titulo', 'tipo', 'valor', 'probabilidadePct', 'status']),
      );
  }

  const rawTeamList = Array.isArray(rawSnapshot.colaboradoresAlocacao)
    ? rawSnapshot.colaboradoresAlocacao
    : Array.isArray(rawSnapshot.colaboradoresResumo)
      ? rawSnapshot.colaboradoresResumo
      : null;

  if (topics.has('team_allocation') && rawTeamList) {
    result.colaboradoresAlocacao = rawTeamList
      .slice(0, 30)
      .filter(isPlainRecord)
      .map((item) => pickFields(item, ['nome', 'funcao', 'vinculo', 'obraAtual']));
  }

  if (
    (topics.has('compliance') || topics.has('weekly_summary')) &&
    Array.isArray(rawSnapshot.conformidade)
  ) {
    result.conformidade = rawSnapshot.conformidade
      .slice(0, 25)
      .filter(isPlainRecord)
      .map((item) => pickFields(item, ['tipo', 'titulo', 'vencimento', 'status', 'obra']));
  }

  if (
    (topics.has('compliance') || topics.has('quotes') || topics.has('weekly_summary')) &&
    typeof rawSnapshot.prontidaoLicitacoesPct === 'number'
  ) {
    result.prontidaoLicitacoesPct = rawSnapshot.prontidaoLicitacoesPct;
  }

  if (
    (topics.has('invoices') || topics.has('weekly_summary')) &&
    Array.isArray(rawSnapshot.recebimentosSemNota)
  ) {
    result.recebimentosSemNota = rawSnapshot.recebimentosSemNota
      .slice(0, 25)
      .filter(isPlainRecord)
      .map((item) => pickFields(item, ['descricao', 'valor', 'vencimento']));
  }

  return result;
}
