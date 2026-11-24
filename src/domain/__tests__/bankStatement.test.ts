import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBankStatement } from '../bankStatement';
import { conciliarExtratoBancario } from '../financeiro';
import type { AuditFields, ParcelaRecord } from '../types';

const audit: AuditFields = {
  createdBy: 'Sócio', updatedBy: 'Sócio',
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
};

test('lê valores decimais, aspas e datas no CSV, relatando linhas inválidas', () => {
  const raw = 'Data;Descrição;Valor\n02/11/2026;"Recebimento; ob. 1";"1.234,56"\n' +
    '03/11/2026;Preservar centavos;-50.25\n31/11/2026;Data inválida;100';
  const result = parseBankStatement(raw, 'movimentos.csv');
  assert.equal(result.invalidCount, 1);
  assert.deepEqual(result.rows.map((row) => row.valorAssinado), [1234.56, -50.25]);
  assert.equal(result.rows[0].descricao, 'Recebimento; ob. 1');
  assert.equal(parseBankStatement(raw, 'copia.csv').rows[0].statementKey, result.rows[0].statementKey);
});

test('lê OFX e usa uma chave estável por conta e FITID', () => {
  const statement = '<OFX><BANKID>01<ACCTID>500<STMTTRN><DTPOSTED>20261103080000' +
    '<TRNAMT>75.30<FITID>mov-A<NAME>Cliente';
  const { rows } = parseBankStatement(statement, 'extrato.ofx');
  assert.equal(rows[0].data, '2026-11-03');
  assert.equal(rows[0].valorAssinado, 75.3);
  assert.match(rows[0].statementKey ?? '', /mov-A/);
});

test('pede confirmação de baixa e envia casos ambíguos para revisão', () => {
  const rows = parseBankStatement('Data,Descrição,Valor\n2026-11-01,Transferência,150.00', 'extrato.csv').rows;
  const installment: ParcelaRecord = {
    ...audit, id: 'p1', obraId: 'obra', numero: 1, rotulo: '1/3',
    vencimento: '2026-11-01', valor: 150, status: 'A vencer', notaFiscal: 'A emitir',
  };
  const [single] = conciliarExtratoBancario(rows, [], [installment], []);
  assert.equal(single.parcelaSugeridaId, 'p1');
  assert.equal(single.incluirNaImportacao, false);
  const [ambiguous] = conciliarExtratoBancario(rows, [], [installment, { ...installment, id: 'p2' }], []);
  assert.equal(ambiguous.statusConciliacao, 'Revisar');
  assert.equal(ambiguous.incluirNaImportacao, false);
});
