import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alertas,
  classificarLancamento,
  deduplicarReceitasEParcelas,
  dre,
  dreEmpresa,
  gerarParcelas,
  indicadoresDashboard,
  prepararRecebimentoParcela,
  previsaoCaixa,
  resolverStatusConformidade,
  resolverStatusDivida,
  resolverStatusLancamento,
  resolverStatusParcela,
  resumoConformidade,
  resumoFinanceiroPeriodo,
  type AuditFields,
  type LancamentoRecord,
  type ObraDreInput,
  type ParcelaRecord,
} from '../index';

const META: AuditFields = {
  createdBy: 'Sócio',
  createdAt: '2026-11-01T10:00:00Z',
  updatedBy: 'Sócio',
  updatedAt: '2026-11-01T10:00:00Z',
};

function buildParcelasFromQuote(
  obraId: string,
  orcamentoId: string,
  valorTotal: number,
  entradaPct: number,
  nParcelas: number,
  dataInicio: string,
): ParcelaRecord[] {
  return gerarParcelas(valorTotal, entradaPct, nParcelas, dataInicio).map((p, idx) => ({
    ...META,
    id: `par_${idx + 1}`,
    obraId,
    orcamentoId,
    numero: p.numero,
    rotulo: p.rotulo,
    vencimento: p.vencimento,
    valor: p.valor,
    // Regra: nunca gravar "Em atraso"; grava-se sempre "A vencer" na confirmação
    status: 'A vencer',
    notaFiscal: p.notaFiscal,
  }));
}

describe('/parcelas como fonte única de recebíveis e status Em atraso dinâmico', () => {
  it('confirmar orçamento + receber parcela mantém saldo, a receber, fluxo de caixa e DRE coerentes sem dupla contagem', () => {
    const obraId = 'obra_alpha';
    const orcamentoId = 'orc_alpha';
    const valorContrato = 100000;
    const dataReferencia = '2026-11-10';

    // 1. Confirmação do orçamento gera apenas /parcelas (20% entrada + 2 parcelas), 0 lançamentos em /transactions
    let parcelas = buildParcelasFromQuote(
      obraId,
      orcamentoId,
      valorContrato,
      20,
      2,
      '2026-11-15',
    );
    let lancamentos: LancamentoRecord[] = [];

    assert.equal(parcelas.length, 3);
    const somaParcelas = parcelas.reduce((s, p) => s + p.valor, 0);
    assert.equal(somaParcelas, valorContrato);
    assert.ok(parcelas.every((p) => p.status === 'A vencer'));

    const obraInput: ObraDreInput = {
      id: obraId,
      nome: 'Residência Alpha',
      valorContrato,
      orcadoMaoDeObra: 40000,
      orcadoEmpreita: 15000,
      orcadoEquipamentos: 5000,
      orcadoImpostos: 8000,
      orcadoBdi: 12000,
    };

    // Antes do recebimento: saldo de caixa é nulo (sem realizado), a receber (30d) em 10/11 = Entrada (20k em 15/11)
    const dashAntes = indicadoresDashboard({
      dataReferencia,
      lancamentos,
      parcelas,
      obras: [{ ...obraInput, status: 'Contratada' }],
      orcamentos: [{ status: 'Ganho' }],
      clientesCount: 1,
      colaboradores: [],
      dividas: [],
    });
    assert.equal(dashAntes.saldoRealizadoCaixa, null);
    assert.equal(dashAntes.aReceber30Dias, 20000);
    assert.equal(dashAntes.aReceber30Qtd, 1);
    assert.equal(dashAntes.aReceberAtrasoQtd, 0);

    const finAntes = resumoFinanceiroPeriodo(lancamentos, parcelas, dataReferencia);
    assert.equal(finAntes.recebiveisEmAbertoValor, 100000);
    assert.equal(finAntes.recebiveisEmAbertoQtd, 3);
    assert.equal(finAntes.recebidosNoMesValor, 0);
    assert.equal(finAntes.entradasMes, 0);
    assert.equal(finAntes.resultadoMes, null);

    const dreObraAntes = dre(obraInput, lancamentos);
    assert.equal(dreObraAntes.receita.orcado, 100000);
    assert.equal(dreObraAntes.receita.realizado, 0);

    const dreEmpAntes = dreEmpresa(
      { dataInicio: '2026-11-01', dataFim: '2026-11-30' },
      { lancamentos, parcelas },
    );
    assert.equal(dreEmpAntes.receitas.orcado, 20000);
    assert.equal(dreEmpAntes.receitas.realizado, 0);

    const caixaAntes = previsaoCaixa(3, {
      dataBase: dataReferencia,
      lancamentos,
      parcelas,
      orcamentos: [],
      colaboradores: [],
    });
    assert.equal(caixaAntes.meses[0].realizadoEntradas, 0);
    assert.equal(caixaAntes.meses[0].contratadoEntradas, 20000);
    assert.equal(caixaAntes.meses[1].contratadoEntradas, 40000);
    assert.equal(caixaAntes.meses[2].contratadoEntradas, 40000);
    assert.equal(caixaAntes.meses[2].saldoProjetado, 100000);

    // 2. Receber a entrada (par_1 = R$ 20.000) em 2026-11-16
    const { parcelaAtualizada, lancamentoRealizado } = prepararRecebimentoParcela({
      parcela: parcelas[0],
      dataRecebimento: '2026-11-16',
      actor: 'Sócio',
      projetoNome: 'Residência Alpha',
      clienteNome: 'Cliente A',
    });

    parcelas = [parcelaAtualizada, parcelas[1], parcelas[2]];
    lancamentos = [lancamentoRealizado];

    assert.equal(parcelas[0].status, 'Recebida');
    assert.equal(lancamentoRealizado.previsto, false);
    assert.equal(lancamentoRealizado.status, 'Recebido');
    assert.equal(lancamentoRealizado.parcelaId, parcelas[0].id);

    // Após recebimento: saldo = +20k, a receber 30d cai para 40k (só 1/2), total em aberto cai para 80k
    const dashDepois = indicadoresDashboard({
      dataReferencia: '2026-11-16',
      lancamentos,
      parcelas,
      obras: [{ ...obraInput, status: 'Contratada' }],
      orcamentos: [{ status: 'Ganho' }],
      clientesCount: 1,
      colaboradores: [],
      dividas: [],
    });
    assert.equal(dashDepois.saldoRealizadoCaixa, 20000);
    assert.equal(dashDepois.aReceber30Dias, 40000); // apenas parcela 1/2 (15/12) nos próximos 30 dias
    assert.equal(dashDepois.aReceber30Qtd, 1);

    const finDepois = resumoFinanceiroPeriodo(lancamentos, parcelas, '2026-11-16');
    assert.equal(finDepois.recebiveisEmAbertoValor, 80000);
    assert.equal(finDepois.recebiveisEmAbertoQtd, 2);
    assert.equal(finDepois.recebidosNoMesValor, 20000);
    // Entradas do mês continua exatamente 20.000 (não somou 20k + 20k!)
    assert.equal(finDepois.entradasMes, 20000);
    assert.equal(finDepois.resultadoMes, 20000);

    // DRE por obra e DRE da empresa refletem R$ 20.000 realizados exatamente uma vez
    const dreObraDepois = dre(obraInput, lancamentos);
    assert.equal(dreObraDepois.receita.orcado, 100000);
    assert.equal(dreObraDepois.receita.realizado, 20000);

    const dreEmpDepois = dreEmpresa(
      { dataInicio: '2026-11-01', dataFim: '2026-11-30' },
      { lancamentos, parcelas },
    );
    assert.equal(dreEmpDepois.receitas.realizado, 20000);
    assert.equal(dreEmpDepois.receitas.orcado, 20000);

    // Fluxo de caixa mantém mês 1 = 20.000 realizado (sem contar parcela paga + lançamento juntos)
    const caixaDepois = previsaoCaixa(3, {
      dataBase: '2026-11-16',
      lancamentos,
      parcelas,
      orcamentos: [],
      colaboradores: [],
    });
    assert.equal(caixaDepois.meses[0].realizadoEntradas, 20000);
    assert.equal(caixaDepois.meses[0].contratadoEntradas, 0);
    assert.equal(caixaDepois.meses[1].contratadoEntradas, 40000);
    assert.equal(caixaDepois.meses[2].contratadoEntradas, 40000);
    assert.equal(caixaDepois.meses[2].saldoProjetado, 100000);

    // Conformidade conta somente a entrada recebida, uma vez, e exclui as parcelas abertas.
    const conf = resumoConformidade([], lancamentos, '2026-11-16', parcelas);
    assert.equal(conf.receitaSemNotaPendente, 20000);

    // Tentativa de receber a mesma parcela novamente deve falhar
    assert.throws(
      () =>
        prepararRecebimentoParcela({
          parcela: parcelas[0],
          dataRecebimento: '2026-11-17',
          actor: 'Sócio',
          projetoNome: 'Residência Alpha',
        }),
      /já foi registrada como recebida/,
    );
  });

  it('deduplica espelhos previstos legados e lançamentos realizados duplicados vinculados ao mesmo parcelaId', () => {
    const parcelas: ParcelaRecord[] = [
      {
        ...META,
        id: 'par_1',
        obraId: 'obra_1',
        numero: 0,
        rotulo: 'Entrada (20%)',
        vencimento: '2026-11-10',
        valor: 20000,
        status: 'Recebida',
        notaFiscal: 'Emitida',
        dataRecebimento: '2026-11-10',
      },
      {
        ...META,
        id: 'par_2',
        obraId: 'obra_1',
        numero: 1,
        rotulo: '1/2',
        vencimento: '2026-11-25',
        valor: 30000,
        status: 'A vencer',
        notaFiscal: 'A emitir',
      },
    ];

    // Cenário legado com espelho previsto para par_2 e duas cópias realizadas de par_1
    const lancamentos: LancamentoRecord[] = [
      {
        ...META,
        id: 'tx_real_1',
        data: '2026-11-10',
        vencimento: '2026-11-10',
        descricao: 'Entrada · Obra 1',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_1',
        valor: 20000,
        previsto: false,
        status: 'Recebido',
        notaFiscal: 'Emitida',
        formaPagamento: 'PIX',
        origem: 'orcamento',
        parcelaId: 'par_1',
      },
      {
        ...META,
        id: 'tx_real_1_dup',
        data: '2026-11-10',
        vencimento: '2026-11-10',
        descricao: 'Entrada · Obra 1 (duplicada)',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_1',
        valor: 20000,
        previsto: false,
        status: 'Recebido',
        notaFiscal: 'Emitida',
        formaPagamento: 'PIX',
        origem: 'orcamento',
        parcelaId: 'par_1',
      },
      {
        ...META,
        id: 'tx_prev_2_espelho',
        data: '2026-11-25',
        vencimento: '2026-11-25',
        descricao: 'Parcela 1/2 · Obra 1',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_1',
        valor: 30000,
        previsto: true,
        status: 'A vencer',
        notaFiscal: 'A emitir',
        formaPagamento: 'Transferência',
        origem: 'orcamento',
        parcelaId: 'par_2',
      },
    ];

    const dedup = deduplicarReceitasEParcelas(lancamentos, parcelas);
    assert.equal(dedup.lancamentosUnicos.length, 1);
    assert.equal(dedup.parcelasAbertas.length, 1);

    const fin = resumoFinanceiroPeriodo(lancamentos, parcelas, '2026-11-15');
    assert.equal(fin.recebidosNoMesValor, 20000);
    assert.equal(fin.recebiveisEmAbertoValor, 30000);
    assert.equal(fin.entradasMes, 20000);

    const dreObra = dre(
      {
        id: 'obra_1',
        nome: 'Obra 1',
        valorContrato: 50000,
        orcadoMaoDeObra: 20000,
        orcadoEmpreita: 0,
        orcadoEquipamentos: 0,
        orcadoImpostos: 5000,
        orcadoBdi: 5000,
      },
      lancamentos,
    );
    assert.equal(dreObra.receita.realizado, 20000);
  });

  it('calcula "Em atraso" dinamicamente na leitura sem alterar o registro armazenado', () => {
    const parcelaVencida: ParcelaRecord = {
      ...META,
      id: 'par_vencida',
      obraId: 'obra_1',
      orcamentoId: 'orc_1',
      numero: 1,
      rotulo: '1/4',
      vencimento: '2026-11-05',
      valor: 12500,
      // Armazenado sempre como "A vencer"
      status: 'A vencer',
      notaFiscal: 'A emitir',
    };

    // Na data do vencimento ainda não está em atraso
    assert.equal(resolverStatusParcela(parcelaVencida, '2026-11-05'), 'A vencer');

    // Após o vencimento, resolve como "Em atraso" sem mutar parcelaVencida.status
    const resolvedAfterDue = resolverStatusParcela(parcelaVencida, '2026-11-06');
    assert.equal(resolvedAfterDue, 'Em atraso');
    assert.equal(parcelaVencida.status, 'A vencer');

    const dash = indicadoresDashboard({
      dataReferencia: '2026-11-20',
      lancamentos: [],
      parcelas: [parcelaVencida],
      obras: [],
      orcamentos: [],
      clientesCount: 1,
      colaboradores: [],
      dividas: [],
    });
    assert.equal(dash.aReceberAtrasoQtd, 1);

    const fin = resumoFinanceiroPeriodo([], [parcelaVencida], '2026-11-20');
    assert.equal(fin.recebiveisEmAtrasoValor, 12500);
    assert.equal(fin.recebiveisEmAbertoQtd, 1);

    const listaAlertas = alertas(
      {
        config: null,
        lancamentos: [],
        parcelas: [parcelaVencida],
        orcamentos: [],
        colaboradores: [],
        obrigacoes: [],
        certidoes: [],
        etapas: [],
        garantias: [],
      },
      { dataReferencia: '2026-11-20' },
    );
    assert.ok(
      listaAlertas.some(
        (a) =>
          a.id === 'parcela-atraso-par_vencida' &&
          a.nivel === 'Urgente' &&
          a.mensagem.includes('Parcela 1/4 vencida em 05/11/2026'),
      ),
    );

    // Após ser recebida, deixa de aparecer em atraso mesmo com vencimento passado
    const { parcelaAtualizada } = prepararRecebimentoParcela({
      parcela: parcelaVencida,
      dataRecebimento: '2026-11-20',
      actor: 'Responsável administrativo',
      projetoNome: 'Obra 1',
    });
    assert.equal(resolverStatusParcela(parcelaAtualizada, '2026-11-25'), 'Recebida');
    const alertasDepois = alertas(
      {
        config: null,
        lancamentos: [],
        parcelas: [parcelaAtualizada],
        orcamentos: [],
        colaboradores: [],
        obrigacoes: [],
        certidoes: [],
        etapas: [],
        garantias: [],
      },
      { dataReferencia: '2026-11-25' },
    );
    assert.equal(
      alertasDepois.some((a) => a.id === 'parcela-atraso-par_vencida'),
      false,
    );
  });

  it('resolve "Em atraso" dinamicamente para lançamentos, dívidas e conformidade e nunca grava "Em atraso"', () => {
    const classificado = classificarLancamento({
      descricao: 'DAS Simples Nacional',
      categoria: 'Tributos',
      tipoInformado: 'despesa',
      valor: 3800,
      previsto: true,
      statusInformado: 'Em atraso',
    });
    assert.equal(classificado.status, 'A vencer');

    assert.equal(
      resolverStatusLancamento(
        {
          tipo: 'despesa',
          status: 'A vencer',
          previsto: true,
          vencimento: '2026-11-10',
          data: '2026-11-10',
        },
        '2026-11-15',
      ),
      'Em atraso',
    );
    assert.equal(
      resolverStatusLancamento(
        {
          tipo: 'despesa',
          status: 'Pago',
          previsto: false,
          vencimento: '2026-11-10',
          data: '2026-11-15',
        },
        '2026-11-20',
      ),
      'Pago',
    );

    assert.equal(
      resolverStatusDivida(
        { status: 'Em dia', proximoVencimento: '2026-11-01' },
        '2026-11-02',
      ),
      'Em atraso',
    );
    assert.equal(
      resolverStatusDivida(
        { status: 'Quitada', proximoVencimento: '2026-11-01' },
        '2026-11-02',
      ),
      'Quitada',
    );

    assert.equal(
      resolverStatusConformidade(
        { status: 'Pendente', vencimento: '2026-11-01' },
        '2026-11-02',
      ),
      'Em atraso',
    );
    assert.equal(
      resolverStatusConformidade(
        { status: 'Válida', vencimento: '2026-11-01' },
        '2026-11-02',
      ),
      'Válida',
    );
  });
});
