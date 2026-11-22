import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alertas,
  caminhoCritico,
  curvaS,
  previsaoCaixa,
  type AuditFields,
  type BaselineRecord,
  type EtapaRecord,
  type LancamentoRecord,
  type OrcamentoRecord,
} from '../index';

const META: AuditFields = {
  createdBy: 'Sócio',
  createdAt: '2026-11-01T10:00:00Z',
  updatedBy: 'Sócio',
  updatedAt: '2026-11-01T10:00:00Z',
};

describe('Previsão de caixa, planejamento (CPM + Curva S) e alertas', () => {
  it('retorna estado vazio sem dados inventados quando não há registros', () => {
    const vazio = previsaoCaixa(5, {
      dataBase: '2026-11-21',
      lancamentos: [],
    });
    assert.equal(vazio.possuiDados, false);
    assert.equal(vazio.meses.length, 0);
    assert.equal(vazio.saldoFinalProjetado, null);

    const semAlertas = alertas({}, { dataReferencia: '2026-11-21' });
    assert.deepEqual(semAlertas, []);
  });

  it('separa realizado, contratado e funil ponderado na previsão de caixa e marca meses negativos', () => {
    const lancamentos: LancamentoRecord[] = [
      {
        ...META,
        id: 'c1',
        data: '2026-11-10',
        vencimento: '2026-11-10',
        descricao: 'Parcela recebida',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_1',
        valor: 20000,
        previsto: false,
        status: 'Recebido',
        notaFiscal: 'Emitida',
        formaPagamento: 'Transferência',
        origem: 'orcamento',
      },
      {
        ...META,
        id: 'c2',
        data: '2026-12-10',
        vencimento: '2026-12-10',
        descricao: 'Parcela contratada dez',
        tipo: 'receita',
        categoria: 'Receita de obra',
        obraId: 'obra_1',
        valor: 10000,
        previsto: true,
        status: 'A vencer',
        notaFiscal: 'A emitir',
        formaPagamento: 'Transferência',
        origem: 'orcamento',
      },
      {
        ...META,
        id: 'c3',
        data: '2026-12-15',
        vencimento: '2026-12-15',
        descricao: 'Despesa pesada dez',
        tipo: 'despesa',
        categoria: 'Folha',
        obraId: 'Empresa',
        valor: 45000,
        previsto: true,
        status: 'A vencer',
        notaFiscal: 'Não se aplica',
        formaPagamento: 'Transferência',
        origem: 'folha',
      },
      {
        ...META,
        id: 'c_loan',
        data: '2026-12-15',
        vencimento: '2026-12-15',
        descricao: 'Empréstimo',
        tipo: 'emprestimo',
        categoria: 'Empréstimo',
        obraId: 'Empresa',
        valor: 100000,
        previsto: false,
        status: 'Não é receita',
        notaFiscal: 'Não se aplica',
        formaPagamento: 'Transferência',
        origem: 'manual',
      },
    ];

    const orcamentos: OrcamentoRecord[] = [
      {
        ...META,
        id: 'orc_funil',
        codigo: 'Orç. 01',
        clienteId: 'cli_1',
        clienteNome: 'Cliente B',
        titulo: 'Casa Jardim',
        tipo: 'Casa residencial',
        cidade: 'Valença',
        areaM2: 200,
        prazoMeses: 12,
        validadeDias: 30,
        descricao: 'Obra nova',
        custoMaoDeObra: 200000,
        custoEmpreita: 50000,
        custoEquipamentos: 10000,
        custoBdi: 20000,
        custoImpostos: 20000,
        valorTotal: 400000,
        entradaPct: 20,
        numeroParcelas: 16,
        probabilidadePct: 50,
        status: 'Em negociação',
      },
    ];

    const prev = previsaoCaixa(3, {
      dataBase: '2026-11-21',
      saldoInicial: 5000,
      lancamentos,
      orcamentos,
    });

    assert.equal(prev.possuiDados, true);
    // Nov/2026: saldo inicial 5000 + 20000 realizado = 25000
    assert.equal(prev.meses[0].realizadoEntradas, 20000);
    assert.equal(prev.meses[0].contratadoEntradas, 0);
    assert.equal(prev.meses[0].saldoProjetado, 25000);
    assert.equal(prev.meses[0].negativo, false);

    // Dez/2026: 25000 + 10000 contratado - 45000 saída = -10000 (empréstimo de 100k não mascara)
    assert.equal(prev.meses[1].contratadoEntradas, 10000);
    assert.equal(prev.meses[1].emprestimosNaoReceita, 100000);
    assert.equal(prev.meses[1].saldoProjetado, -10000);
    assert.equal(prev.meses[1].negativo, true);
    // Funil ponderado entra em dez/2026 (entrada de 20% sobre 400k * 50% = 40.000)
    assert.equal(prev.meses[1].funilPonderadoEntradas, 40000);
    assert.equal(prev.meses[1].saldoProjetadoComFunil, 30000);
    assert.deepEqual(prev.mesesNegativos, ['2026-12', '2027-01']);
  });

  it('calcula CPM com dependências término-início, folga, etapas críticas e detecta ciclo', () => {
    const etapas: EtapaRecord[] = [
      {
        ...META,
        id: 'A',
        obraId: 'o1',
        codigoEap: '1.1',
        fase: 'Fundação',
        nome: 'Fundação',
        responsavel: 'Equipe',
        semanaInicio: 0,
        duracaoSemanas: 4,
        progressoPct: 100,
        custoOrcado: 40000,
        dependencias: [],
        marco: false,
        status: 'Concluída',
      },
      {
        ...META,
        id: 'B',
        obraId: 'o1',
        codigoEap: '2.1',
        fase: 'Estrutura',
        nome: 'Cobertura',
        responsavel: 'Equipe',
        semanaInicio: 4,
        duracaoSemanas: 6,
        progressoPct: 50,
        custoOrcado: 60000,
        dependencias: ['A'],
        marco: false,
        status: 'Em andamento',
      },
      {
        ...META,
        id: 'C',
        obraId: 'o1',
        codigoEap: '2.2',
        fase: 'Instalações',
        nome: 'Elétrica paralela',
        responsavel: 'Equipe',
        semanaInicio: 4,
        duracaoSemanas: 2,
        progressoPct: 50,
        custoOrcado: 20000,
        dependencias: ['A'],
        marco: false,
        status: 'Em andamento',
      },
      {
        ...META,
        id: 'D',
        obraId: 'o1',
        codigoEap: '3.1',
        fase: 'Entrega',
        nome: 'Entrega',
        responsavel: 'Sócios',
        semanaInicio: 10,
        duracaoSemanas: 0,
        progressoPct: 0,
        custoOrcado: 0,
        dependencias: ['B', 'C'],
        marco: true,
        status: 'A fazer',
      },
    ];

    const cpm = caminhoCritico(etapas);
    assert.equal(cpm.cicloDetectado, false);
    assert.equal(cpm.duracaoTotal, 10);
    assert.deepEqual(cpm.etapasCriticas.sort(), ['A', 'B', 'D']);

    const detalheC = cpm.detalhes.find((d) => d.etapaId === 'C')!;
    assert.equal(detalheC.folga, 4);
    assert.equal(detalheC.critica, false);

    // Ciclo A -> B -> A
    const comCiclo = caminhoCritico([
      { ...etapas[0], dependencias: ['B'] },
      etapas[1],
    ]);
    assert.equal(comCiclo.cicloDetectado, true);
    assert.ok(comCiclo.nosEmCiclo.includes('A'));
    assert.ok(comCiclo.nosEmCiclo.includes('B'));
  });

  it('calcula Curva S (planejado x realizado) e índice de prazo (SPI)', () => {
    const etapas: EtapaRecord[] = [
      {
        ...META,
        id: 'e1',
        obraId: 'o1',
        codigoEap: '1.1',
        fase: '1',
        nome: 'Etapa 1',
        responsavel: 'Equipe',
        semanaInicio: 0,
        duracaoSemanas: 4,
        progressoPct: 100,
        custoOrcado: 50000,
        dependencias: [],
        marco: false,
        status: 'Concluída',
      },
      {
        ...META,
        id: 'e2',
        obraId: 'o1',
        codigoEap: '2.1',
        fase: '2',
        nome: 'Etapa 2',
        responsavel: 'Equipe',
        semanaInicio: 4,
        duracaoSemanas: 4,
        progressoPct: 0,
        custoOrcado: 50000,
        dependencias: ['e1'],
        marco: false,
        status: 'A fazer',
      },
    ];

    const baseline: BaselineRecord = {
      ...META,
      id: 'base_1',
      obraId: 'o1',
      nome: 'Linha de base inicial',
      dataCriacao: '2026-11-01',
      dataFimPrevista: '2026-12-27',
      etapas: [
        { etapaId: 'e1', semanaInicioBaseline: 0, duracaoBaselineSemanas: 4, custoOrcadoBaseline: 50000 },
        { etapaId: 'e2', semanaInicioBaseline: 4, duracaoBaselineSemanas: 4, custoOrcadoBaseline: 50000 },
      ],
    };

    const s4 = curvaS(etapas, baseline, 4);
    assert.equal(s4.possuiDados, true);
    assert.equal(s4.progressoPlanejadoPct, 50);
    assert.equal(s4.progressoRealizadoPct, 50);
    assert.equal(s4.indicePrazo, 1);
    assert.equal(s4.statusPrazo, 'No prazo');

    const s6 = curvaS(etapas, baseline, 6);
    assert.equal(s6.progressoPlanejadoPct, 75);
    assert.equal(s6.progressoRealizadoPct, 50);
    assert.equal(s6.indicePrazo, 0.67);
    assert.equal(s6.statusPrazo, 'Atrasado');
  });

  it('gera alertas de vencimentos, certidões, treinamentos e caixa negativo', () => {
    const lista = alertas(
      {
        contasPagar: [
          {
            ...META,
            id: 'cp1',
            fornecedor: 'Fornecedor',
            descricao: 'Aluguel betoneira',
            categoria: 'Equipamentos e EPI',
            obraId: 'o1',
            vencimento: '2026-11-24',
            valor: 2500,
            status: 'A vencer',
          },
        ],
        certidoes: [
          {
            ...META,
            id: 'cert1',
            titulo: 'Certidão Federal',
            esfera: 'Federal',
            dataValidade: '2026-12-05',
            status: 'Vence em breve',
          },
        ],
        colaboradores: [
          {
            ...META,
            id: 'col1',
            nome: 'João Silva',
            funcao: 'Pedreiro',
            vinculo: 'CLT',
            salarioBase: 3200,
            formaPagamento: 'PIX',
            dataAdmissao: '2024-01-10',
            nr35Validade: '2026-11-10',
            statusEpi: 'Em dia',
            statusIntegracao: 'Concluída',
          },
        ],
        lancamentos: [
          {
            ...META,
            id: 'tx1',
            data: '2026-11-25',
            vencimento: '2026-11-25',
            descricao: 'Despesa caixa',
            tipo: 'despesa',
            categoria: 'Outros',
            obraId: 'Empresa',
            valor: 15000,
            previsto: true,
            status: 'A vencer',
            notaFiscal: 'Não se aplica',
            formaPagamento: 'Transferência',
            origem: 'manual',
          },
        ],
      },
      { dataReferencia: '2026-11-21', saldoInicialCaixa: 5000 },
    );

    const categorias = new Set(lista.map((a) => a.categoria));
    assert.ok(categorias.has('caixa'));
    assert.ok(categorias.has('vencimento'));
    assert.ok(categorias.has('certidao'));
    assert.ok(categorias.has('treinamento'));
    assert.ok(lista.some((a) => a.nivel === 'Urgente' && a.categoria === 'caixa'));
    assert.ok(lista.some((a) => a.mensagem.includes('NR-35 de João Silva')));
  });
});
