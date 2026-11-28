import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWhatsAppDraft, installmentWhatsAppContext, normalizeWhatsAppNumber, validateWhatsAppTemplate, whatsappTemplates } from '../whatsapp';

test('normaliza telefone com DDD sem confundir números internacionais ou com ramal', () => {
  assert.equal(normalizeWhatsAppNumber('(24) 99999-1212'), '5524999991212');
  assert.equal(normalizeWhatsAppNumber('+55 24 99999-1212'), '5524999991212');
  assert.equal(normalizeWhatsAppNumber('00 351 912 345 678'), '351912345678');
  assert.equal(normalizeWhatsAppNumber('99999-1212'), null);
  assert.equal(normalizeWhatsAppNumber('(24) 99999-1212 ramal 12'), null);
});

test('o atalho preenche as variáveis em pt-BR e codifica só o texto selecionado', () => {
  const installment = { status: 'A vencer' as const, amount: 1200.5, dueDate: '2026-11-27' };
  const { model, values } = installmentWhatsAppContext(installment, '2026-11-28')!;
  assert.equal(model, 'installmentOverdue');
  assert.equal(installmentWhatsAppContext(installment, '2026-11-27')?.model, 'installmentDue');
  assert.equal(installmentWhatsAppContext({ ...installment, status: 'Recebida' }, '2026-11-28'), null);
  const draft = createWhatsAppDraft({ model, template: whatsappTemplates()[model],
    phone: '(24) 99999-1212', values: { ...values, cliente: 'Lívia', obra: 'Casa A & B' } });
  const url = new URL(draft.href);
  assert.equal(url.origin + url.pathname, 'https://wa.me/5524999991212');
  assert.equal(url.searchParams.get('text'), draft.message);
  assert.match(draft.message, /Lívia.*R\$\s1\.200,50.*Casa A & B.*27\/11\/2026/);
});

test('bloqueia dados financeiros em modelos de obra e exige as variáveis usadas', () => {
  assert.throws(() => validateWhatsAppTemplate('material', 'Valor {valor}'), /apenas as variáveis/);
  assert.throws(() => validateWhatsAppTemplate('testimonial', 'Prazo {{obra}}'), /apenas as variáveis/);
  assert.throws(() => createWhatsAppDraft({ model: 'milestone', template: 'Prazo {vencimento}',
    phone: '(24) 99999-1212', values: {} }), /Preencha o dado/);
  assert.equal(createWhatsAppDraft({ model: 'material', template: 'Pode entregar {material}?',
    phone: '(24) 99999-1212', values: { material: 'Revestimento' } }).message, 'Pode entregar Revestimento?');
});
