import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calcularEncargos,
  dre,
  dreEmpresa,
  type AuditFields,
  type LancamentoRecord,
  type ObraRecord,
  type TaxChargeParameters,
} from '../index';

const META: AuditFields = {
  createdBy: 'Sócio',
  createdAt: '2026-11-01T10:00:00Z',
  updatedBy: 'Sócio',
  updatedAt: '2026-11-01T10:00:00Z',
};

describe('Encargos trabalhistas e DRE', () => {
  it('retorna "não configurado" para CLT quando não há parâmetros ou vigência está fora da data', () => {
    const clt = { vinculo: 'CLT' as const, salarioBase: 3000 };

    const semParams = calcularEncargos(clt, null, '2026-11-21');
    assert.equal(semParams.configurado, false);
    assert.equal(semParams.rotulo, 'não configurado');
    assert.equal(semParams.custoTotalMensal, null);
    assert.equal(semParams.inssValor, null);

    const foraVigencia = calcularEncargos(
      clt,
      {
        inssPct: 20,
        fgtsPct: 8,
        feriasPct: 11.11,
        decimoTerceiroPct: 8.33,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: '2026-06-30',
      },
      '2026-11-21',
    );
    assert.equal(foraVigencia.configurado, false);
    assert.equal(foraVigencia.rotulo, 'não configurado');
    assert.equal(foraVigencia.custoTotalMensal, null);
  });

  it('calcula encargos e provisões CLT usando exclusivamente os parâmetros vigentes', () => {
    const params: TaxChargeParameters = {
      inssPct: 20,
      fgtsPct: 8,
      feriasPct: 11.11,
      decimoTerceiroPct: 8.33,
      vigenciaInicio: '2026-01-01',
    };
    const res = calcularEncargos(
      { vinculo: 'CLT', salarioBase: 3000 },
      params,
      '2026-11-21',
    );

    assert.equal(res.configurado, true);
    assert.equal(res.inssValor, 600);
    assert.equal(res.fgtsValor, 240);
    assert.equal(res.feriasValor, 333.3);
    assert.equal(res.decimoTerceiroValor, 249.9);
    assert.equal(res.encargosMensais, 840);
    assert.equal(res.provisoesMensais, 583.2);
    assert.equal(res.custoTotalMensal, 4423.2);

    const autonomo = calcularEncargos(
      { vinculo: 'Autônomo', salarioBase: 4000 },
      null,
      '2026-11-21',
    );
    assert.equal(autonomo.status, 'nao_aplicavel');
    assert.equal(autonomo.custoTotalMensal, 4000);
  });

  it('calcula DRE por obra comparando orçado x realizado e excluindo empréstimos', () => {
    const obra: ObraRecord = {
      ...META,
      id: 'obra_1',
      nome: 'Residência Serra',
      clienteNome: 'Cliente A',
      tipo: 'Casa residencial',
      valorContrato: 500000,
      orcadoMaoDeObra: 200000,
      orcadoEmpreita: 80000,
      orcadoEquipamentos: 30000,
      orcadoImpostos: 40000,
      orcadoBdi: 50000,
      dataInicio: '2026-01-01',
      dataFimBaseline: '2027-01-01',
      dataFimPrevista: '2027-01-01',
      status: 'Em execução',
      contratoAssinado: true,
    };

    const lancamentos: LancamentoRecord[] = [
      {
        ...META,
        id: 'tx_1',
        data: '2026-11-05',
        vencimento: '2026-11-05',
        descricao: 'Entrada',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_1',
        valor: 100000,
        previsto: false,
        status: 'Recebido',
        notaFiscal: 'Emitida',
        formaPagamento: 'Transferência',
        origem: 'orcamento',
      },
      {
        ...META,
        id: 'tx_2',
        data: '2026-11-10',
        vencimento: '2026-11-10',
        descricao: 'Parcela futura',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_1',
        valor: 50000,
        previsto: true,
        status: 'A vencer',
        notaFiscal: 'A emitir',
        formaPagamento: 'Transferência',
        origem: 'orcamento',
      },
      {
        ...META,
        id: 'tx_3',
        data: '2026-11-12',
        vencimento: '2026-11-12',
        descricao: 'Folha obra',
        tipo: 'despesa',
        categoria: 'Mão de obra',
        obraId: 'obra_1',
        valor: 45000,
        previsto: false,
        status: 'Pago',
        notaFiscal: 'Não se aplica',
        formaPagamento: 'PIX',
        origem: 'manual',
      },
      {
        ...META,
        id: 'tx_loan',
        data: '2026-11-15',
        vencimento: '2026-11-15',
        descricao: 'Empréstimo bancário',
        tipo: 'emprestimo',
        categoria: 'Empréstimo',
        obraId: 'obra_1',
        valor: 200000,
        previsto: false,
        status: 'Não é receita',
        notaFiscal: 'Não se aplica',
        formaPagamento: 'Transferência',
        origem: 'manual',
      },
    ];

    const res = dre(obra, lancamentos);
    assert.equal(res.receita.orcado, 500000);
    assert.equal(res.receita.realizado, 100000);
    assert.equal(res.receita.variacao, -400000);
    assert.equal(res.maoDeObra.realizado, 45000);
    assert.equal(res.custosTotais.orcado, 400000);
    assert.equal(res.custosTotais.realizado, 45000);
    assert.equal(res.resultado.orcado, 100000);
    assert.equal(res.resultado.realizado, 55000);
    assert.equal(res.margemOrcadaPct, 20);
    assert.equal(res.margemRealizadaPct, 55);
  });

  it('calcula DRE da empresa no período separando previsto de realizado e ignorando empréstimos', () => {
    const lancamentos: LancamentoRecord[] = [
      {
        ...META,
        id: 'e1',
        data: '2026-11-05',
        vencimento: '2026-11-05',
        descricao: 'Recebimento parcela',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_1',
        valor: 30000,
        previsto: false,
        status: 'Recebido',
        notaFiscal: 'Emitida',
        formaPagamento: 'Transferência',
        origem: 'manual',
      },
      {
        ...META,
        id: 'e2',
        data: '2026-11-20',
        vencimento: '2026-11-20',
        descricao: 'Receita prevista',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_1',
        valor: 20000,
        previsto: true,
        status: 'A vencer',
        notaFiscal: 'A emitir',
        formaPagamento: 'Transferência',
        origem: 'orcamento',
      },
      {
        ...META,
        id: 'e3',
        data: '2026-11-10',
        vencimento: '2026-11-10',
        descricao: 'Folha paga',
        tipo: 'despesa',
        categoria: 'Folha',
        obraId: 'Empresa',
        valor: 18000,
        previsto: false,
        status: 'Pago',
        notaFiscal: 'Não se aplica',
        formaPagamento: 'Transferência',
        origem: 'folha',
      },
      {
        ...META,
        id: 'e4',
        data: '2026-11-18',
        vencimento: '2026-11-18',
        descricao: 'Empréstimo',
        tipo: 'emprestimo',
        categoria: 'Empréstimo',
        obraId: 'Empresa',
        valor: 90000,
        previsto: false,
        status: 'Não é receita',
        notaFiscal: 'Não se aplica',
        formaPagamento: 'Transferência',
        origem: 'manual',
      },
      {
        ...META,
        id: 'e5_fora',
        data: '2026-12-01',
        vencimento: '2026-12-01',
        descricao: 'Fora do período',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_1',
        valor: 50000,
        previsto: false,
        status: 'Recebido',
        notaFiscal: 'Emitida',
        formaPagamento: 'Transferência',
        origem: 'manual',
      },
    ];

    const res = dreEmpresa(
      { dataInicio: '2026-11-01', dataFim: '2026-11-30' },
      { lancamentos },
    );

    assert.equal(res.receitas.orcado, 20000);
    assert.equal(res.receitas.realizado, 30000);
    assert.equal(res.custosTotais.realizado, 18000);
    assert.equal(res.resultado.realizado, 12000);
    assert.equal(res.margemRealizadaPct, 40);
  });
});
