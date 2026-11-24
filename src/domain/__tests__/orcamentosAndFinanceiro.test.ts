import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  avaliarMargemContraMeta,
  classificarLancamento,
  composicaoOrcamento,
  conciliarExtratoBancario,
  dreEmpresa,
  gerarParcelas,
  resumoDividas,
  resumoFinanceiroPeriodo,
  simularPagamentoOrcamento,
  validarDadosConfirmacaoOrcamento,
  validarLancamentoFinanceiro,
  type AuditFields,
  type DividaRecord,
  type LancamentoRecord,
  type ParcelaRecord,
} from '../index';

const META: AuditFields = {
  createdBy: 'Sócio',
  createdAt: '2026-11-01T10:00:00Z',
  updatedBy: 'Sócio',
  updatedAt: '2026-11-01T10:00:00Z',
};

describe('Orçamentos, parcelas e classificação financeira', () => {
  it('gera parcelas com entrada e ajuste exato de centavos na última parcela', () => {
    const parcelas = gerarParcelas(100000, 20, 13, '2026-11-21');
    assert.equal(parcelas.length, 14);
    assert.equal(parcelas[0].rotulo, 'Entrada (20%)');
    assert.equal(parcelas[0].valor, 20000);
    assert.equal(parcelas[0].vencimentoBR, '21/11/2026');

    // 80000 / 13 = 6153.8461... -> 12x 6153.84 + última = 6153.92
    assert.equal(parcelas[1].valor, 6153.84);
    assert.equal(parcelas[13].valor, 6153.92);
    assert.equal(parcelas[13].rotulo, '13/13');
    assert.equal(parcelas[13].vencimento, '2027-12-21');

    const somaCentavos = parcelas.reduce(
      (acc, item) => acc + Math.round(item.valor * 100),
      0,
    );
    assert.equal(somaCentavos, 10000000);
  });

  it('gera parcelas sem entrada ajustando centavos na última parcela para dízima', () => {
    const parcelas = gerarParcelas(10000, 0, 3, '2026-01-31');
    assert.equal(parcelas.length, 3);
    assert.equal(parcelas[0].valor, 3333.33);
    assert.equal(parcelas[1].valor, 3333.33);
    assert.equal(parcelas[2].valor, 3333.34);
    assert.equal(parcelas[0].vencimento, '2026-02-28');
  });

  it('calcula composição do orçamento com custos + BDI + impostos, margem em R$ e %', () => {
    const comp = composicaoOrcamento({
      maoDeObra: 180000,
      empreita: 70000,
      equipamentos: 20000,
      bdi: 40000,
      impostos: 30000,
      valorTotal: 400000,
    });

    assert.equal(comp.custosDiretos, 270000);
    assert.equal(comp.bdiValor, 40000);
    assert.equal(comp.impostosValor, 30000);
    assert.equal(comp.custoTotal, 340000);
    assert.equal(comp.valorTotal, 400000);
    assert.equal(comp.margemReais, 60000);
    assert.equal(comp.margemPct, 15);
  });

  it('calcula composição com percentuais de BDI, impostos e margem desejada', () => {
    const comp = composicaoOrcamento({
      maoDeObra: 100000,
      empreita: 0,
      equipamentos: 0,
      bdiPct: 10,
      impostosPct: 10,
      margemDesejadaPct: 20,
    });

    assert.equal(comp.custosDiretos, 100000);
    assert.equal(comp.bdiValor, 10000);
    assert.equal(comp.impostosValor, 11000);
    assert.equal(comp.custoTotal, 121000);
    assert.equal(comp.valorTotal, 151250);
    assert.equal(comp.margemReais, 30250);
    assert.equal(comp.margemPct, 20);
  });

  it('avalia margem prevista contra a meta configurada e trata meta ausente', () => {
    const semMeta = avaliarMargemContraMeta(16, undefined);
    assert.equal(semMeta.metaConfigurada, false);
    assert.equal(semMeta.status, 'sem_meta');

    const acima = avaliarMargemContraMeta(16.3, 12);
    assert.equal(acima.metaConfigurada, true);
    assert.equal(acima.status, 'acima');
    assert.equal(acima.diferencaPct, 4.3);

    const abaixo = avaliarMargemContraMeta(9.5, 12);
    assert.equal(abaixo.status, 'abaixo');
    assert.equal(abaixo.diferencaPct, -2.5);
  });

  it('simula pagamento e avalia efeito no caixa frente à folha mensal', () => {
    const simAtencao = simularPagamentoOrcamento({
      valorTotal: 410000,
      entradaPct: 20,
      nParcelas: 24,
      dataInicio: '2026-11-21',
      folhaMensalEstimada: 50000,
    });
    assert.equal(simAtencao.valorEntrada, 82000);
    assert.equal(simAtencao.parcelaMensalMedia, 13666.67);
    assert.equal(simAtencao.efeitoCaixa, 'atencao');

    const simOk = simularPagamentoOrcamento({
      valorTotal: 410000,
      entradaPct: 20,
      nParcelas: 13,
      dataInicio: '2026-11-21',
      folhaMensalEstimada: 40000,
    });
    assert.equal(simOk.efeitoCaixa, 'positivo');

    const simNeutro = simularPagamentoOrcamento({
      valorTotal: 200000,
      entradaPct: 10,
      nParcelas: 15,
      dataInicio: '2026-11-21',
    });
    assert.equal(simNeutro.efeitoCaixa, 'neutro');
    assert.equal(simNeutro.coberturaFolhaPct, null);
  });

  it('nunca classifica empréstimo como receita mesmo quando informado como receita', () => {
    const res = classificarLancamento({
      descricao: 'Empréstimo capital de giro Banco X',
      categoria: 'Outros',
      tipoInformado: 'receita',
      valor: 50000,
      previsto: false,
    });

    assert.equal(res.tipo, 'emprestimo');
    assert.equal(res.entraComoReceita, false);
    assert.equal(res.entraNoDre, false);
    assert.equal(res.geraDivida, true);
    assert.equal(res.rejeitadoComoReceita, true);
    assert.equal(res.status, 'Não é receita');
  });

  it('valida formulário financeiro exigindo obra/Empresa e bloqueando empréstimo como receita', () => {
    const erro = validarLancamentoFinanceiro({
      descricao: 'Empréstimo bancário',
      categoria: 'Empréstimo',
      tipoInformado: 'income',
      obraId: '',
      valor: 25000,
    });
    assert.equal(erro.valido, false);
    assert.equal(erro.errosCount, 2);
    assert.ok(erro.erroEmprestimoComoReceita);
    assert.ok(erro.erroCentroCusto);

    const ok = validarLancamentoFinanceiro({
      descricao: 'Parcela 1/18',
      categoria: 'Receita de obra',
      tipoInformado: 'income',
      obraId: 'obra_1',
      valor: 18500,
    });
    assert.equal(ok.valido, true);
    assert.equal(ok.errosCount, 0);
  });

  it('separa lançamento previsto de realizado para receita e despesa', () => {
    const prevista = classificarLancamento({
      descricao: 'Parcela 2/18',
      tipoInformado: 'receita',
      valor: 15000,
      previsto: true,
    });
    assert.equal(prevista.tipo, 'receita');
    assert.equal(prevista.natureza, 'previsto');
    assert.equal(prevista.status, 'A vencer');
    assert.equal(prevista.entraComoReceita, true);

    const realizada = classificarLancamento({
      descricao: 'Pagamento pedreiros',
      categoria: 'Folha',
      tipoInformado: 'despesa',
      valor: 12000,
      previsto: false,
    });
    assert.equal(realizada.tipo, 'despesa');
    assert.equal(realizada.natureza, 'realizado');
    assert.equal(realizada.status, 'Pago');
  });

  it('calcula resumo financeiro do período com tributos em atraso e sem somar empréstimo em receita', () => {
    const lancamentos: LancamentoRecord[] = [
      {
        ...META,
        id: 't1',
        data: '2026-11-10',
        vencimento: '2026-11-10',
        descricao: 'Parcela obra A',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_a',
        valor: 50000,
        previsto: false,
        status: 'Recebido',
        notaFiscal: 'Não emitida',
        formaPagamento: 'Transferência',
        origem: 'manual',
      },
      {
        ...META,
        id: 't2',
        data: '2026-11-05',
        vencimento: '2026-11-05',
        descricao: 'DAS Simples Nacional',
        tipo: 'despesa',
        categoria: 'Tributos',
        obraId: 'Empresa',
        valor: 4200,
        previsto: true,
        status: 'Em atraso',
        notaFiscal: 'Não se aplica',
        formaPagamento: 'Boleto',
        origem: 'manual',
      },
      {
        ...META,
        id: 't3',
        data: '2026-11-12',
        vencimento: '2026-11-12',
        descricao: 'Capital de giro',
        tipo: 'emprestimo',
        categoria: 'Empréstimo',
        obraId: 'Empresa',
        valor: 80000,
        previsto: false,
        status: 'Não é receita',
        notaFiscal: 'Não se aplica',
        formaPagamento: 'Transferência',
        origem: 'manual',
      },
    ];

    const parcelas: ParcelaRecord[] = [
      {
        ...META,
        id: 'p1',
        obraId: 'obra_a',
        numero: 1,
        rotulo: '1/18',
        vencimento: '2026-11-28',
        valor: 15000,
        status: 'A vencer',
        notaFiscal: 'A emitir',
      },
    ];

    const resumo = resumoFinanceiroPeriodo(lancamentos, parcelas, '2026-11-21');
    assert.equal(resumo.entradasMes, 65000);
    assert.equal(resumo.saidasMes, 4200);
    assert.equal(resumo.resultadoMes, 60800);
    assert.equal(resumo.receitaSemNota, 50000);
    assert.equal(resumo.tributosEmAtrasoQtd, 1);
    assert.equal(resumo.tributosEmAtrasoValor, 4200);
    assert.equal(resumo.recebiveisEmAbertoQtd, 1);
    assert.equal(resumo.recebiveisEmAbertoValor, 15000);
  });

  it('calcula resumo de dívidas retornando null quando vazio e totais quando preenchido', () => {
    const vazio = resumoDividas([]);
    assert.equal(vazio.possuiDados, false);
    assert.equal(vazio.dividaTotal, null);
    assert.equal(vazio.custoMensal, null);

    const dividas: DividaRecord[] = [
      {
        ...META,
        id: 'd1',
        credor: 'Banco X',
        tipo: 'Empréstimo bancário',
        saldoDevedor: 40000,
        custoMensal: 1800,
        parcelasRestantes: 24,
        proximoVencimento: '2026-12-05',
        status: 'Em dia',
      },
      {
        ...META,
        id: 'd2',
        credor: 'Receita Federal',
        tipo: 'Tributo em atraso',
        saldoDevedor: 12000,
        custoMensal: 0,
        parcelasRestantes: 1,
        proximoVencimento: '2026-11-25',
        status: 'Em atraso',
      },
    ];
    const preenchido = resumoDividas(dividas);
    assert.equal(preenchido.possuiDados, true);
    assert.equal(preenchido.dividaTotal, 52000);
    assert.equal(preenchido.tributosEmAtraso, 12000);
    assert.equal(preenchido.proximoVencimento, '2026-11-25');
  });

  it('concilia extrato OFX/CSV com status Conciliado, Sugerido, Revisar e Classificar', () => {
    const lancamentos: LancamentoRecord[] = [
      {
        ...META,
        id: 'tx_dup',
        data: '2026-11-10',
        vencimento: '2026-11-10',
        descricao: 'Pagamento eletricista Casa Bela',
        tipo: 'despesa',
        categoria: 'Mão de obra',
        obraId: 'obra_bela',
        valor: 3500,
        previsto: false,
        status: 'Pago',
        notaFiscal: 'Não se aplica',
        formaPagamento: 'PIX',
        origem: 'manual',
      },
    ];
    const parcelas: ParcelaRecord[] = [
      {
        ...META,
        id: 'parc_1',
        obraId: 'obra_bela',
        numero: 1,
        rotulo: '1/18',
        vencimento: '2026-11-20',
        valor: 22000,
        status: 'A vencer',
        notaFiscal: 'A emitir',
      },
    ];

    const conciliado = conciliarExtratoBancario(
      [
        { id: 'r1', data: '2026-11-10', descricao: 'PIX Eletricista', valorAssinado: -3500 },
        { id: 'r2', data: '2026-11-19', descricao: 'TED Cliente A', valorAssinado: 22000 },
        { id: 'r3', data: '2026-11-18', descricao: 'Crédito Empréstimo Giro', valorAssinado: 50000 },
        { id: 'r4', data: '2026-11-17', descricao: 'Compra material genérico', valorAssinado: -950 },
      ],
      lancamentos,
      parcelas,
      [{ id: 'obra_bela', nome: 'Casa Bela' }],
    );

    assert.equal(conciliado[0].statusConciliacao, 'Conciliado');
    assert.equal(conciliado[0].incluirNaImportacao, false);
    assert.equal(conciliado[1].statusConciliacao, 'Sugerido');
    assert.equal(conciliado[1].obraId, 'obra_bela');
    assert.equal(conciliado[2].statusConciliacao, 'Revisar');
    assert.equal(conciliado[2].tipo, 'emprestimo');
    assert.equal(conciliado[2].alertaEmprestimo, true);
    assert.equal(conciliado[3].statusConciliacao, 'Classificar');
  });

  it('calcula DRE da empresa no período separando orçado e realizado sem empréstimo', () => {
    const dreEmp = dreEmpresa(
      { dataInicio: '2026-11-01', dataFim: '2026-11-30' },
      {
        lancamentos: [
          {
            ...META,
            id: 'e1',
            data: '2026-11-10',
            vencimento: '2026-11-10',
            descricao: 'Receita realizada',
            tipo: 'receita',
            categoria: 'Receita de obra',
            obraId: 'o1',
            valor: 60000,
            previsto: false,
            status: 'Recebido',
            notaFiscal: 'Emitida',
            formaPagamento: 'TED',
            origem: 'manual',
          },
          {
            ...META,
            id: 'e2',
            data: '2026-11-15',
            vencimento: '2026-11-15',
            descricao: 'Folha mês',
            tipo: 'despesa',
            categoria: 'Folha',
            obraId: 'Empresa',
            valor: 24000,
            previsto: false,
            status: 'Pago',
            notaFiscal: 'Não se aplica',
            formaPagamento: 'PIX',
            origem: 'folha',
          },
          {
            ...META,
            id: 'e3',
            data: '2026-11-18',
            vencimento: '2026-11-18',
            descricao: 'Empréstimo banco',
            tipo: 'emprestimo',
            categoria: 'Empréstimo',
            obraId: 'Empresa',
            valor: 100000,
            previsto: false,
            status: 'Não é receita',
            notaFiscal: 'Não se aplica',
            formaPagamento: 'TED',
            origem: 'manual',
          },
        ],
      },
    );
    assert.equal(dreEmp.receitas.realizado, 60000);
    assert.equal(dreEmp.custosTotais.realizado, 24000);
    assert.equal(dreEmp.resultado.realizado, 36000);
    assert.equal(dreEmp.margemRealizadaPct, 60);
  });

  it('valida dados obrigatórios antes de confirmar orçamento em transação', () => {
    const invalido = validarDadosConfirmacaoOrcamento({
      clienteId: '',
      valorTotal: 0,
      entradaPct: 120,
      nParcelas: 0,
      dataInicio: '',
      status: 'Em negociação',
    });
    assert.equal(invalido.valido, false);
    assert.equal(invalido.erros.length, 5);
    assert.equal(invalido.dataInicioISO, null);

    const jaConfirmado = validarDadosConfirmacaoOrcamento({
      clienteId: 'cli_1',
      valorTotal: 350000,
      entradaPct: 20,
      nParcelas: 18,
      dataInicio: '2026-11-25',
      status: 'Ganho',
      projectId: 'proj_123',
    });
    assert.equal(jaConfirmado.valido, false);
    assert.match(jaConfirmado.erros[0], /já foi confirmado/i);

    const valido = validarDadosConfirmacaoOrcamento({
      clienteId: 'cli_1',
      valorTotal: 410000,
      entradaPct: 20,
      nParcelas: 18,
      dataInicio: '21/11/2026',
      status: 'Em negociação',
    });
    assert.equal(valido.valido, true);
    assert.equal(valido.erros.length, 0);
    assert.equal(valido.dataInicioISO, '2026-11-21');
  });
});

it('recalcula o preço fechado a partir dos custos e da margem de precificação', () => {
  const result = composicaoOrcamento({
    maoDeObra: 53000.15,
    empreita: 11300.25,
    equipamentos: 6200.35,
    bdi: 6000.19,
    impostos: 3400.07,
    margemDesejadaPct: 20,
  });

  assert.equal(result.custoTotal, 79901.01);
  assert.equal(result.valorTotal, 99876.26);
  assert.equal(result.margemReais, 19975.25);
  assert.equal(result.margemPct, 20);
});

it('preserva o preço registrado ao calcular a margem de um orçamento anterior', () => {
  const result = composicaoOrcamento({
    maoDeObra: 92000,
    empreita: 0,
    equipamentos: 0,
    valorTotal: 90000,
  });

  assert.equal(result.valorTotal, 90000);
  assert.equal(result.margemReais, -2000);
  assert.equal(result.margemPct, -2.22);
});

it('identifica a entrada pela numeração quando o percentual arredonda para zero', () => {
  const result = simularPagamentoOrcamento({
    valorTotal: 10,
    entradaPct: 0.01,
    nParcelas: 2,
    dataInicio: '2026-11-23',
  });

  assert.equal(result.valorEntrada, 0);
  assert.equal(result.saldoParcelado, 10);
  assert.equal(result.primeiraParcela, 5);
  assert.equal(result.ultimaParcela, 5);
});
