import assert from 'node:assert/strict';
import test from 'node:test';
import { createPopPdf } from '../popPdf';
import { isPublishedPop, linkedPopChecklist, nextPopVersion, readPopContent, validatePopContent } from '../pops';
import type { CompanySettings, Pop } from '../../types/pilotis';

const pop: Pop = {
  id: 'pop', ownerUid: 'company', createdBy: 'Sócio', updatedBy: 'Sócio', title: 'Vistoria',
  serviceType: 'Entrega', version: 'v1.3', linkedStagePhase: 'Entrega', objective: 'Conferir instalação',
  materialsAndEpi: 'Materiais da obra', status: 'Em revisão', publicationNumber: 4,
  approvedBy: 'Responsável administrativo', publishedOn: '2026-11-25',
  steps: ['Conferir nível'], acceptanceCriteria: ['Nível conferido'], usedInOnboarding: true,
};

test('rascunho novo não fornece checklist; revisão mantém a última publicação', () => {
  const stage = { popId: pop.id, status: 'Em conferência' } as const;
  assert.equal(nextPopVersion(undefined), 'v1.0');
  assert.equal(nextPopVersion(pop), 'v1.4');
  assert.equal(isPublishedPop({ ...pop, publicationNumber: 0 }), false);
  assert.equal(linkedPopChecklist(stage, { ...pop, publicationNumber: 0 }), undefined);
  assert.deepEqual(linkedPopChecklist(stage, {
    ...pop, draft: { ...readPopContent(pop), acceptanceCriteria: ['Mudança ainda em revisão'] },
  })?.acceptanceCriteria, ['Nível conferido']);
});

test('etapa concluída conserva os critérios da versão conferida', () => {
  const review = { popId: pop.id, version: 'v1.2', acceptanceCriteria: ['Vistoria anterior'] };
  assert.deepEqual(linkedPopChecklist({ popId: pop.id, status: 'Concluída', popReview: review }, pop), review);
  assert.equal(linkedPopChecklist({ popId: pop.id, status: 'Em conferência', popReview: review }, pop)?.version, 'v1.3');
});

test('não aceita critérios repetidos nem anexo que ultrapassa o total permitido', () => {
  assert.throws(() => validatePopContent({ ...readPopContent(pop), acceptanceCriteria: ['Teste', 'Teste '] }), /uma única vez/);
  assert.throws(() => validatePopContent({
    ...readPopContent(pop), attachments: [{ id: 'upload', chunkCount: 9, size: 6 * 1024 * 1024, contentType: 'video/mp4', name: 'teste.mp4' }],
  }), /5 MB/);
});

test('o PDF contém identidade, cabeçalho e rodapé em todas as páginas, com imagem opcional', () => {
  const settings = {
    companyName: 'Identidade teste', accentColor: '#1255A0', popPdfHeader: 'Cabeçalho de teste',
    popPdfFooter: 'Rodapé de teste', pdfShowLogo: true,
  } as CompanySettings;
  const pdf = new TextDecoder().decode(createPopPdf(
    { ...pop, steps: Array.from({ length: 20 }, (_, index) => index + ' ' + 'Passo. '.repeat(40)) },
    settings, '2026-11-25', { bytes: new Uint8Array([255, 216, 255, 217]), width: 1, height: 1 },
  ));
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /\/Subtype \/Image/);
  assert.match(pdf, /0\.071 0\.333 0\.627 RG/);
  assert.ok(pdf.includes(Buffer.from(settings.popPdfHeader!, 'latin1').toString('hex')));
  assert.ok(pdf.includes(Buffer.from(settings.popPdfFooter!, 'latin1').toString('hex')));
  assert.ok(pdf.includes(Buffer.from('v1.3 · Publicação 25/11/2026', 'latin1').toString('hex')));
  assert.equal((pdf.match(/\/Logo Do/g) ?? []).length, (pdf.match(/\/Type \/Page\b/g) ?? []).length);
  assert.ok((pdf.match(/\/Type \/Page\b/g) ?? []).length > 1);
  const offset = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
  assert.equal(pdf.slice(offset, offset + 4), 'xref');
});
