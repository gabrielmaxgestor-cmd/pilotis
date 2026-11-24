import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alertas,
  avaliarValidadeSst,
  calcularAlertasSistema,
  calcularCaminhoCriticoObra,
  calcularCurvaSObra,
  calcularDreEmpresa,
  calcularDreObra,
  calcularEncargosColaborador,
  calcularIndicadoresDashboard,
  calcularPendenciasSegurancaEquipe,
  calcularPrevisaoCaixa,
  calcularProgressoObra,
  calcularProntidaoLicitacao,
  calcularProntidaoLicitacaoPorCategoria,
  calcularResumoConformidade,
  calcularResumoDividas,
  calcularResumoFasesEap,
  calcularResumoFinanceiroPeriodo,
  calcularResumoFolhaEquipe,
  calcularResumoFunilOrcamentos,
  calcularSaldoInicialCaixa,
  caminhoCritico,
  conciliarExtratoPilotis,
  contarPendenciasSegurancaEquipe,
  diffDaysFromToday,
  formatBRLCompact,
  formatShortDateBR,
  indicadoresDashboard,
  normalizeBRDateToISO,
  parseCurrencyInput,
  progressoObra,
  prontidaoLicitacao,
  prontidaoLicitacaoPorCategoria,
  resumoConformidade,
  resumoFasesEap,
  resumoFolhaEquipe,
  resumoFunilOrcamentos,
  todayISO,
  type AuditFields,
} from '../index';
import type { PilotisDataState } from '../../types/pilotis';

const META: AuditFields = {
  createdBy: 'Sócio',
  createdAt: '2026-11-01T10:00:00Z',
  updatedBy: 'Sócio',
  updatedAt: '2026-11-01T10:00:00Z',
};

function makeEmptyPilotisState(): PilotisDataState {
  return {
    settings: null,
    clients: [],
    quotes: [],
    projects: [],
    installments: [],
    transactions: [],
    debts: [],
    employees: [],
    allocations: [],
    stages: [],
    dailyLogs: [],
    pops: [],
    complianceItems: [],
    tenders: [],
    warrantyCalls: [],
    auditLogs: [],
  };
}

describe('Cobertura de domínio unificado usado pela interface', () => {
  it('calcula indicadoresDashboard vazio e com lançamentos, obras e orçamentos', () => {
    const empty = indicadoresDashboard({
      dataReferencia: '2026-11-21',
      lancamentos: [],
      parcelas: [],
      obras: [],
      orcamentos: [],
      clientesCount: 0,
      colaboradores: [],
      dividas: [],
    });
    assert.equal(empty.sistemaVazio, true);
    assert.equal(empty.saldoRealizadoCaixa, null);
    assert.equal(empty.saldoPrevistoFimMes, null);
    assert.equal(empty.aReceber30Dias, null);
    assert.equal(empty.margemMediaObrasPct, null);
    assert.equal(empty.obrasAtivasQtd, null);

    const populated = indicadoresDashboard({
      dataReferencia: '2026-11-21',
      lancamentos: [
        {
          ...META,
          id: 't1',
          data: '2026-11-05',
          vencimento: '2026-11-05',
          descricao: 'Entrada recebida',
          tipo: 'receita',
          categoria: 'Receita de obra',
          obraId: 'o1',
          valor: 100000,
          previsto: false,
          status: 'Recebido',
          notaFiscal: 'Emitida',
          formaPagamento: 'Transferência',
          origem: 'manual',
        },
        {
          ...META,
          id: 't2',
          data: '2026-11-28',
          vencimento: '2026-11-28',
          descricao: 'Parcela a vencer 30d',
          tipo: 'receita',
          categoria: 'Receita de obra',
          obraId: 'o1',
          valor: 25000,
          previsto: true,
          status: 'A vencer',
          notaFiscal: 'Não emitida',
          formaPagamento: 'PIX',
          origem: 'orcamento',
        },
        {
          ...META,
          id: 't3',
          data: '2026-11-10',
          vencimento: '2026-11-10',
          descricao: 'Mão de obra paga',
          tipo: 'despesa',
          categoria: 'Mão de obra',
          obraId: 'o1',
          valor: 40000,
          previsto: false,
          status: 'Pago',
          notaFiscal: 'Não se aplica',
          formaPagamento: 'Transferência',
          origem: 'manual',
        },
        {
          ...META,
          id: 't4',
          data: '2026-11-12',
          vencimento: '2026-11-12',
          descricao: 'Empréstimo banco',
          tipo: 'emprestimo',
          categoria: 'Empréstimo',
          obraId: 'Empresa',
          valor: 50000,
          previsto: false,
          status: 'Não é receita',
          notaFiscal: 'Não se aplica',
          formaPagamento: 'Transferência',
          origem: 'manual',
        },
      ],
      parcelas: [],
      obras: [
        {
          id: 'o1',
          nome: 'Residência Boa Vista',
          valorContrato: 200000,
          orcadoMaoDeObra: 80000,
          orcadoEmpreita: 40000,
          orcadoEquipamentos: 10000,
          orcadoImpostos: 15000,
          orcadoBdi: 15000,
          status: 'Em execução',
        },
      ],
      orcamentos: [
        { status: 'Em negociação' },
        { status: 'Enviado' },
        { status: 'Ganho' },
      ],
      clientesCount: 1,
      colaboradores: [{ id: 'c1' }],
      dividas: [],
    });

    assert.equal(populated.sistemaVazio, false);
    assert.equal(populated.saldoRealizadoCaixa, 110000);
    assert.equal(populated.saldoPrevistoFimMes, 135000);
    assert.equal(populated.aReceber30Dias, 25000);
    assert.equal(populated.aReceber30Qtd, 1);
    assert.equal(populated.aReceberAtrasoQtd, 0);
    assert.equal(populated.obrasAtivasQtd, 1);
    assert.equal(populated.orcamentosEmAbertoQtd, 2);
    assert.equal(populated.receitaSemNota, 25000);
    // Margem realizada da obra o1 = (100000 - 40000) / 200000 = 30%
    assert.equal(populated.margemMediaObrasPct, 30);
  });

  it('calcula progressoObra e resumoFasesEap ignorando marcos e ponderando por custo', () => {
    assert.equal(progressoObra([]), null);

    const etapas = [
      {
        fase: '1 · Fundação',
        custoOrcado: 100000,
        duracaoSemanas: 4,
        progressoPct: 100,
        marco: false,
      },
      {
        fase: '1 · Fundação',
        custoOrcado: 0,
        duracaoSemanas: 0,
        progressoPct: 0,
        marco: true,
      },
      {
        fase: '2 · Acabamento',
        custoOrcado: 300000,
        duracaoSemanas: 8,
        progressoPct: 20,
        marco: false,
      },
    ];

    // (100000*1 + 300000*0.2) / 400000 = 160000 / 400000 = 40%
    assert.equal(progressoObra(etapas), 40);

    const fases = resumoFasesEap(etapas);
    assert.equal(fases.length, 2);
    assert.deepEqual(fases[0], {
      fase: '1 · Fundação',
      totalEtapas: 2,
      progressoMedioPct: 50,
      custoOrcado: 100000,
    });
    assert.deepEqual(fases[1], {
      fase: '2 · Acabamento',
      totalEtapas: 1,
      progressoMedioPct: 20,
      custoOrcado: 300000,
    });
  });

  it('detecta autociclo e ciclo indireto em caminhoCritico', () => {
    const autoCiclo = caminhoCritico([
      {
        id: 'e1',
        nome: 'Etapa única',
        semanaInicio: 0,
        duracaoSemanas: 2,
        dependencias: ['e1'],
        marco: false,
      },
    ]);
    assert.equal(autoCiclo.cicloDetectado, true);
    assert.deepEqual(autoCiclo.nosEmCiclo, ['e1']);
  });

  it('calcula prontidaoLicitacao, prontidaoLicitacaoPorCategoria e resumoConformidade', () => {
    assert.equal(prontidaoLicitacao([]), null);
    assert.deepEqual(prontidaoLicitacaoPorCategoria([]), []);

    const itens = [
      { tipo: 'Licitação' as const, categoria: 'Habilitação jurídica', status: 'Válida' as const },
      { tipo: 'Licitação' as const, categoria: 'Habilitação jurídica', status: 'Pendente' as const },
      { tipo: 'Licitação' as const, categoria: 'Qualificação técnica', status: 'Anexado' as const },
      { tipo: 'Obrigação' as const, status: 'Em atraso' as const, vencimento: '2026-11-10' },
      { tipo: 'Obrigação' as const, status: 'Em dia' as const, vencimento: '2026-12-20' },
      { tipo: 'Certidão' as const, status: 'Válida' as const, vencimento: '2027-03-01' },
      { tipo: 'Documento de obra' as const, status: 'Pendente' as const },
    ];

    assert.equal(prontidaoLicitacao(itens), 67);
    const porCat = prontidaoLicitacaoPorCategoria(itens);
    assert.equal(porCat.length, 2);
    assert.deepEqual(porCat[0], {
      categoria: 'Habilitação jurídica',
      pct: 50,
      prontos: 1,
      total: 2,
      statusRotulo: 'Parcial',
    });
    assert.deepEqual(porCat[1], {
      categoria: 'Qualificação técnica',
      pct: 100,
      prontos: 1,
      total: 1,
      statusRotulo: 'Em dia',
    });

    const conf = resumoConformidade(
      itens,
      [
        { tipo: 'receita', notaFiscal: 'A emitir', valor: 12000 },
        { tipo: 'receita', notaFiscal: 'Emitida', valor: 30000 },
        { tipo: 'emprestimo', notaFiscal: 'Não se aplica', valor: 90000 },
      ],
      '2026-11-21',
    );
    assert.equal(conf.obrigacoesAVencerOuAtrasadas, 1);
    assert.equal(conf.certidoesValidas, 1);
    assert.equal(conf.documentosObraPendentes, 1);
    assert.equal(conf.receitaSemNotaPendente, 12000);
    assert.equal(conf.prontidaoLicitacoesPct, 67);
  });

  it('calcula resumoFunilOrcamentos ignorando descartados', () => {
    const res = resumoFunilOrcamentos([
      { status: 'Rascunho', valorTotal: 100000, probabilidadePct: 20 },
      { status: 'Em negociação', valorTotal: 200000, probabilidadePct: 60 },
      { status: 'Ganho', valorTotal: 300000, probabilidadePct: 100 },
      { status: 'Perdido', valorTotal: 150000, probabilidadePct: 0 },
      { status: 'Descartado', valorTotal: 500000, probabilidadePct: 50 },
    ]);

    assert.equal(res.abertosCount, 2);
    assert.equal(res.valorFunil, 300000);
    assert.equal(res.previsaoPonderada, 140000);
    assert.equal(res.fechadosCount, 2);
    assert.equal(res.ganhosCount, 1);
    assert.equal(res.taxaConversaoPct, 50);
  });

  it('calcula SST e subtotais da folha na equipe sem inventar encargos', () => {
    assert.equal(avaliarValidadeSst('', '2026-11-21').label, 'Não informado');
    assert.equal(avaliarValidadeSst('2026-11-10', '2026-11-21').label, 'Vencido');
    assert.equal(avaliarValidadeSst('2026-12-01', '2026-11-21').label, 'Vence em 10d');
    assert.equal(avaliarValidadeSst('2027-06-01', '2026-11-21').expiredOrSoon, false);

    const pendencias = contarPendenciasSegurancaEquipe(
      [
        {
          asoValidade: '2026-11-01',
          nr18Validade: '2026-12-05',
          nr35Validade: '2027-10-01',
          statusEpi: 'A repor',
        },
      ],
      '2026-11-21',
    );
    assert.equal(pendencias, 3);

    const colabs = [
      { vinculo: 'CLT' as const, salarioBase: 3000 },
      { vinculo: 'Autônomo' as const, salarioBase: 2500 },
    ];
    const semParams = resumoFolhaEquipe(colabs, null, '2026-11-21');
    assert.equal(semParams.configurado, false);
    assert.equal(semParams.cltSalarioBase, 3000);
    assert.equal(semParams.outrosSalarioBase, 2500);
    assert.equal(semParams.cltCustoTotal, null);
    assert.equal(semParams.custoTotalMensal, null);
    assert.equal(semParams.recorrentesNaoCltCount, 1);

    const comParams = resumoFolhaEquipe(
      colabs,
      {
        inssPct: 20,
        fgtsPct: 8,
        feriasPct: 11.11,
        decimoTerceiroPct: 8.33,
        vigenciaInicio: '2026-01-01',
      },
      '2026-11-21',
    );
    assert.equal(comParams.configurado, true);
    assert.equal(comParams.cltCustoTotal, 4423.2);
    assert.equal(comParams.custoTotalMensal, 6923.2);
  });

  it('gera alertas para atrasos em etapas e chamados de garantia', () => {
    const res = alertas(
      {
        etapas: [
          {
            ...META,
            id: 'et_1',
            obraId: 'o1',
            codigoEap: '1.1',
            fase: 'Cobertura',
            nome: 'Telhado',
            responsavel: 'Mestre',
            semanaInicio: 0,
            duracaoSemanas: 4,
            progressoPct: 50,
            custoOrcado: 20000,
            dependencias: [],
            marco: false,
            status: 'Em andamento',
            categoriaAtraso: 'Chuva',
            justificativaAtraso: 'Chuva forte na semana',
          },
        ],
        garantias: [
          {
            ...META,
            id: 'g1',
            obraId: 'o1',
            descricao: 'Ajuste porta',
            dataAbertura: '2026-11-15',
            prazoAtendimento: '2026-11-25',
            custo: 0,
            status: 'Aberto',
          },
        ],
      },
      { dataReferencia: '2026-11-21' },
    );

    assert.ok(res.some((a) => a.modulo === 'planning' && a.categoria === 'planejamento'));
    assert.ok(res.some((a) => a.modulo === 'clients' && a.categoria === 'garantia'));
  });

  it('valida formatadores complementares e adaptadores Pilotis', () => {
    assert.equal(formatBRLCompact(1500000), 'R$ 1,50 mi');
    assert.equal(formatBRLCompact(85000), 'R$ 85 mil');
    assert.equal(formatShortDateBR('2026-11-21'), '21/11');
    assert.equal(parseCurrencyInput('R$ 12.345,67'), 12345.67);
    assert.equal(normalizeBRDateToISO('21/11/2026'), '2026-11-21');
    assert.equal(diffDaysFromToday(todayISO()), 0);

    const state = makeEmptyPilotisState();
    const ownerUid = 'owner_1';
    state.clients.push({
      ownerUid,
      ...META,
      id: 'cli1',
      name: 'Cliente Teste',
      phone: '11999999999',
      email: 'c@teste.com',
      city: 'Valença',
      origin: 'Indicação',
      notes: '',
      status: 'Ativo',
      referralsCount: 0,
      testimonialStatus: '',
    });
    state.projects.push({
      ownerUid,
      ...META,
      id: 'p1',
      name: 'Casa Alpha',
      quoteId: 'q0',
      clientId: 'cli1',
      clientName: 'Cliente Teste',
      type: 'Casa residencial',
      contractKind: 'Principal',
      contractValue: 100000,
      budgetedLabor: 40000,
      budgetedSubcontract: 20000,
      budgetedEquipment: 5000,
      budgetedBdi: 10000,
      budgetedTax: 5000,
      startDate: '2026-10-01',
      baselineEndDate: '2027-04-01',
      forecastEndDate: '2027-04-01',
      status: 'Em execução',
      contractSigned: true,
      warrantyStartDate: '',
    });
    state.transactions.push({
      ownerUid,
      ...META,
      id: 'tx_prev',
      date: '2026-10-15',
      dueDate: '2026-10-15',
      description: 'Entrada anterior',
      entryKind: 'income',
      category: 'Receita de obra',
      projectId: 'p1',
      projectName: 'Casa Alpha',
      amount: 30000,
      isForecast: false,
      status: 'Recebido',
      invoiceStatus: 'Emitida',
      paymentMethod: 'PIX',
      installmentLabel: '',
      quoteId: '',
      debtId: '',
      source: 'manual',
    });
    state.stages.push({
      ownerUid,
      ...META,
      id: 'st1',
      projectId: 'p1',
      wbsCode: '1.1',
      phase: '1 · Fundação',
      name: 'Escavação',
      responsible: 'João',
      startWeek: 0,
      durationWeeks: 2,
      baselineStartWeek: 0,
      baselineDurationWeeks: 2,
      progressPct: 100,
      budgetedCost: 20000,
      popId: '',
      dependsOn: [],
      isMilestone: false,
      status: 'Concluída',
      materialExpectedDate: '',
      delayCategory: '',
      delayJustification: '',
      checklistCompleted: [],
    });
    state.quotes.push({
      ownerUid,
      ...META,
      id: 'q1',
      code: 'Orç. 01',
      clientId: 'cli1',
      clientName: 'Cliente Teste',
      title: 'Casa Alpha',
      type: 'Casa residencial',
      city: 'Valença',
      areaM2: 120,
      estimatedMonths: 6,
      validityDays: 30,
      description: 'Obra',
      origin: 'Indicação',
      laborCost: 40000,
      subcontractCost: 20000,
      equipmentCost: 5000,
      bdiCost: 10000,
      taxCost: 5000,
      totalValue: 100000,
      downPaymentPct: 20,
      installmentsCount: 6,
      probabilityPct: 50,
      status: 'Em negociação',
      discardReason: '',
      projectId: '',
    });
    state.debts.push({
      ownerUid,
      ...META,
      id: 'd1',
      creditor: 'Banco X',
      debtType: 'Empréstimo bancário',
      principalBalance: 15000,
      monthlyCost: 500,
      remainingInstallments: 12,
      nextDueDate: '2026-12-05',
      status: 'Em dia',
      notes: '',
    });
    state.employees.push({
      ownerUid,
      ...META,
      id: 'e1',
      name: 'Pedro',
      role: 'Pedreiro',
      employmentType: 'CLT',
      baseSalary: 3000,
      paymentMethod: 'Transferência',
      startDate: '2026-01-01',
      currentProjectId: 'p1',
      currentProjectName: 'Casa Alpha',
      asoExpiry: '2027-05-01',
      nr18Expiry: '2027-05-01',
      nr35Expiry: '',
      epiStatus: 'Em dia',
      onboardingStatus: 'Concluída',
      vacationPeriod: '',
      vacationScheduled: '',
      occurrencesNote: '',
    });
    state.complianceItems.push({
      ownerUid,
      ...META,
      id: 'comp1',
      kind: 'Licitação',
      title: 'CND Federal',
      category: 'Regularidade fiscal',
      projectId: '',
      projectName: '',
      competence: '11/2026',
      dueDate: '2026-12-30',
      issuedDate: '2026-10-01',
      fileName: 'cnd.pdf',
      mandatory: true,
      status: 'Válida',
      notes: '',
    });

    assert.equal(calcularSaldoInicialCaixa(state.transactions, '2026-11-21'), 30000);
    assert.equal(calcularIndicadoresDashboard(state, '2026-11-21').saldoRealizadoCaixa, 30000);
    assert.equal(calcularResumoFinanceiroPeriodo(state, '2026-11-21').possuiLancamentos, true);
    assert.equal(calcularPrevisaoCaixa(state, 5, '2026-11-21').possuiDados, true);
    assert.equal(calcularDreObra(state.projects[0], state.transactions).receita.realizado, 30000);
    assert.equal(
      calcularDreEmpresa(state, '2026-10-01', '2026-11-30').receitas.realizado,
      30000,
    );
    assert.equal(calcularEncargosColaborador(state.employees[0], null, '2026-11-21').rotulo, 'não configurado');
    assert.equal(calcularResumoFolhaEquipe(state.employees, null, '2026-11-21').custoTotalMensal, null);
    assert.equal(calcularPendenciasSegurancaEquipe(state.employees, '2026-11-21'), 0);
    assert.equal(calcularResumoDividas(state.debts).dividaTotal, 15000);
    assert.deepEqual(calcularCaminhoCriticoObra(state.stages).etapasCriticas, ['st1']);
    assert.equal(calcularCurvaSObra(state.stages).progressoRealizadoPct, 100);
    assert.equal(calcularProgressoObra('p1', state.stages), 100);
    assert.equal(calcularResumoFasesEap(state.stages).length, 1);
    assert.equal(calcularProntidaoLicitacao(state.complianceItems), 100);
    assert.equal(calcularProntidaoLicitacaoPorCategoria(state.complianceItems).length, 1);
    assert.equal(calcularResumoConformidade(state.complianceItems, state.transactions, '2026-11-21').prontidaoLicitacoesPct, 100);
    assert.equal(calcularResumoFunilOrcamentos(state.quotes).valorFunil, 100000);
    assert.ok(Array.isArray(calcularAlertasSistema(state, '2026-11-21')));
    assert.equal(
      conciliarExtratoPilotis(state, [
        { id: 'r1', data: '2026-10-15', descricao: 'Entrada anterior', valorAssinado: 30000 },
      ])[0].statusConciliacao,
      'Conciliado',
    );
  });
});
