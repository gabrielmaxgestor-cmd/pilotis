import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContractPdf } from '../contractPdf';
import { gerarParcelas } from '../orcamentos';

test('gera um PDF paginado com referências válidas e o cronograma do contrato', () => {
  const installments = gerarParcelas(120000, 20, 36, '2026-11-30');
  const pdf = createContractPdf({
    code: 'Orç. 01',
    companyName: 'Pilotis Soluções Construtivas',
    clientName: 'Contratante',
    projectName: 'Obra residencial',
    contractKind: 'Principal',
    description: 'Detalhes da execução. '.repeat(12),
    totalValue: 120000,
    startDate: '2026-11-30',
    installments,
  });

  const content = new TextDecoder().decode(pdf);
  assert.ok(content.startsWith('%PDF-1.4\n'));
  assert.match(content, /\/Count 2\b/);
  const offset = Number(content.match(/startxref\n(\d+)\n/)?.[1]);
  assert.equal(content.slice(offset, offset + 4), 'xref');

  for (const [index, match] of [...content.matchAll(/^(\d{10}) 00000 n /gm)].entries()) {
    assert.ok(content.slice(Number(match[1])).startsWith((index + 1) + ' 0 obj\n'));
  }

  const commands = [...content.matchAll(/<([0-9a-f]*)> Tj/g)];
  const text = commands.map((match) => Buffer.from(match[1], 'hex').toString('latin1')).join('\n');
  assert.match(text, /Pilotis Soluções Construtivas/);
  assert.match(text, /Entrada \(20%\) · 30\/11\/2026 · R\$ 24\.000,00/);
  assert.match(text, /36\/36 · 30\/11\/2029/);
  assert.match(text, /Garantia contratual de 1 ano/);
});
