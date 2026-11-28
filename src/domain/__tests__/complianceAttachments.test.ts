import assert from 'node:assert/strict';
import { test } from 'node:test';
import { complianceStoragePath, sanitizeComplianceFilename } from '../complianceAttachments';
import { detectComplianceMime } from '../../server/complianceAttachmentContent';

test('decide o formato pelo conteúdo e identifica documentos Word em vez de ZIPs comuns', () => {
  const docx = Buffer.from('UEsDBBQAAAAIAOyBfF2sbhJapAAAANwAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFyPMQ7CMAxFr1JlRdSIgQG1XdiBgQtYqdtGxHaUGCi3RwWpA/PXe0+/ub0TlWrmKKV1k1k6AhQ/EWOpNZHMHAfNjFZqzSMk9HccCfa73QG8ipHY1haH65rLk3IOPVVXzHZGptbBS3MPvfoHk1g9c3TV6Yct5dZhSjF4tKACT+n/mlsdhuBp5RdbyuqplCAjx3pdGINsFj10DXxPdR8AAAD//wMAUEsDBBQAAAAIAOyBfF1M12HDYQAAAGkAAAARAAAAd29yZC9kb2N1bWVudC54bWxEzMENgCAMAMBVjANY48MHQXZBQCChLaEYdHuf3gCnh/LsbgzUpwcLiRrHnHqvCkBcCmhl4RrowXJxQ9tl4RZhcPO1sQsimSIW2NZ1B7SZZqOHOtm/YDT8ufkAAAD//wMAUEsBAhQAFAAAAAgA7IF8XaxuElqkAAAA3AAAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACADsgXxdTNdhw2EAAABpAAAAEQAAAAAAAAAAAAAAAADVAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAIAAgCAAAAAZQEAAAAA', 'base64');
  assert.equal(detectComplianceMime(docx), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(detectComplianceMime(Buffer.from('%PDF-1.4')), 'application/pdf');
  assert.equal(detectComplianceMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(detectComplianceMime(Buffer.from([255, 216, 255, 224])), 'image/jpeg');
  assert.equal(detectComplianceMime(Buffer.from('<!doctype html>')), null);
  assert.equal(detectComplianceMime(docx.subarray(0, 50)), null);
  const zip = Buffer.from(docx);
  const filename = Buffer.from('word/document.xml');
  for (let i = zip.indexOf(filename); i !== -1; i = zip.indexOf(filename)) zip[i] = 'x'.charCodeAt(0);
  assert.equal(detectComplianceMime(zip), null);
});

test('remove diretórios, acentos e extensão informada para montar o caminho privado', () => {
  assert.equal(sanitizeComplianceFilename('../Pasta\\Certidão de locação.exe', 'application/pdf'), 'Certidao-de-locacao.pdf');
  assert.equal(sanitizeComplianceFilename('.png', 'image/png'), 'arquivo.png');
  assert.equal(complianceStoragePath('uid', '', 'doc', 'versao', 'anexo.pdf'),
    'complianceAttachments/uid/company/doc/versao/anexo.pdf');
});
