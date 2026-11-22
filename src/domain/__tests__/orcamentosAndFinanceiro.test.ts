import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  avaliarMargemContraMeta,
  classificarLancamento,
  composicaoOrcamento,
  gerarParcelas,
  simularPagamentoOrcamento,
  validarDadosConfirmacaoOrcamento,
} from '../index';

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
