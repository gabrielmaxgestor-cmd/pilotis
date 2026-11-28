import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const firebaseMock = new URL('src/lib/firebase.ts', root).href;
const sdkMock = 'pilotis:firestore';
function typescriptSource(url) {
  return stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' });
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'firebase/firestore') return { url: sdkMock, shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL?.startsWith(root.href)) {
      const base = new URL(specifier, context.parentURL);
      for (const suffix of ['', '.ts', '/index.ts']) {
        const candidate = base.href + suffix;
        if (candidate.endsWith('.ts') && existsSync(fileURLToPath(candidate))) return { url: candidate, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === firebaseMock) return { format: 'module', source: 'export const db = {}; export const OperationType = {}; export const handleFirestoreError = (error) => { throw error };', shortCircuit: true };
    if (url === sdkMock) return { format: 'module', shortCircuit: true,
      source: 'export const { Bytes, collection, deleteField, doc, documentId, getDoc, getDocsFromServer, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAfter, where, writeBatch } = globalThis.__pilotisTestFirestore;' };
    if (url.startsWith(root.href) && url.endsWith('.ts')) return { format: 'module', source: typescriptSource(url), shortCircuit: true };
    return next(url, context);
  },
});

const db = new Map();
const listeners = new Set();
let rejectCommit = false;
const makeRef = (...parts) => {
  const path = parts.join('/');
  return { path, id: path.split('/').at(-1) };
};
function snapshot(ref) {
  return { id: ref.id, ref, exists: () => db.has(ref.path), data: () => db.get(ref.path) };
}
const byCollection = (path) => [...db.keys()].filter((key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'));
function readQuery(source) {
  let keys = byCollection(source.path).sort();
  for (const constraint of source.constraints ?? []) {
    if (constraint.kind === 'where') keys = keys.filter((key) => db.get(key)[constraint.field] === constraint.value);
    if (constraint.kind === 'startAfter') keys = keys.filter((key) => key > constraint.cursor.ref.path);
  }
  const cap = (source.constraints ?? []).find((constraint) => constraint.kind === 'limit');
  if (cap) keys = keys.slice(0, cap.count);
  const docs = keys.map((key) => snapshot(makeRef(key)));
  return { docs, size: docs.length };
}
function bufferWrites() {
  const changes = [];
  return {
    get: async (ref) => { assert.equal(changes.length, 0, 'Firestore exige leituras antes de gravar'); return snapshot(ref); },
    set: (ref, value) => changes.push({ ref, value, action: 'set' }),
    update: (ref, value) => changes.push({ ref, value, action: 'update' }),
    delete: (ref) => changes.push({ ref, action: 'delete' }),
    async commit() {
      if (rejectCommit) {
        const error = rejectCommit;
        rejectCommit = false;
        throw error;
      }
      for (const { ref, action } of changes) {
        if (action === 'update') assert.ok(db.has(ref.path));
        if (ref.path.startsWith('auditLogs/') && db.has(ref.path)) throw new Error('auditoria imutável');
      }
      for (const { ref, value, action } of changes) {
        if (action === 'delete') db.delete(ref.path);
        else db.set(ref.path, action === 'update' ? { ...db.get(ref.path), ...value } : value);
      }
      for (const notify of listeners) queueMicrotask(notify);
    },
  };
}
globalThis.__pilotisTestFirestore = {
  Bytes: class {
    constructor(bytes) { this.bytes = bytes; }
    static fromUint8Array(bytes) { return new this(bytes); }
    toUint8Array() { return this.bytes; }
  },
  collection: (_db, ...parts) => makeRef(...parts),
  doc: (_db, ...parts) => makeRef(...parts),
  deleteField: () => Symbol('deleteField'),
  documentId: () => '__name__',
  getDoc: async (ref) => snapshot(ref),
  getDocsFromServer: async (source) => readQuery(source),
  limit: (count) => ({ kind: 'limit', count }),
  orderBy: (field) => ({ kind: 'orderBy', field }),
  query: (ref, ...constraints) => ({ ...ref, constraints: [...(ref.constraints ?? []), ...constraints] }),
  serverTimestamp: () => ({ timestamp: true }),
  startAfter: (cursor) => ({ kind: 'startAfter', cursor }),
  where: (field, _operator, value) => ({ kind: 'where', field, value }),
  writeBatch: bufferWrites,
  runTransaction: async (_db, work) => {
    const writer = bufferWrites();
    const result = await work(writer);
    await writer.commit();
    return result;
  },
  onSnapshot: (source, publish) => {
    const notify = () => {
      if (listeners.has(notify)) publish(readQuery(source));
    };
    listeners.add(notify);
    queueMicrotask(notify);
    return () => listeners.delete(notify);
  },
};

const service = await import('../src/services/pilotisService.ts');
const domain = await import('../src/domain/index.ts');
const paging = await import('../src/lib/firestorePages.ts');
const uid = 'company';
const actor = 'Sócio';
const today = domain.planningTodayISO();
const audit = { ownerUid: uid, createdBy: actor, updatedBy: actor };
const row = (collection, id) => ({ ...db.get(collection + '/' + id), id });
const rows = (collection) => byCollection(collection).map((key) => row(collection, key.split('/').at(-1)));
function state() {
  return {
    settings: db.get('companySettings/' + uid) ?? null, clients: rows('clients'), quotes: rows('quotes'), projects: rows('projects'),
    installments: rows('parcelas'), stages: rows('stages'), transactions: rows('transactions'), debts: rows('debts'),
    employees: rows('employees'), allocations: rows('allocations'), pops: rows('pops'), complianceItems: rows('complianceItems'),
    warrantyCalls: rows('warrantyCalls'), dailyLogs: [], tenders: [], auditLogs: rows('auditLogs'),
    baselines: rows('baselines'), scheduleProgress: rows('scheduleProgress'), projectClosures: rows('projectClosures'),
    projectFollowUps: rows('projectFollowUps'),
  };
}
function prepareQuote(downPaymentPct, installmentsCount = 3, estimatedMonths = 3) {
  db.set('clients/client', { ...audit, name: 'Cliente', status: 'Prospect' });
  db.set('quotes/quote', { ...audit, code: '1', title: 'Obra', city: 'Valença', description: '', status: 'Em negociação',
    clientId: 'client', totalValue: 10000, downPaymentPct, installmentsCount, estimatedMonths,
    type: 'Reforma', laborCost: 3000, subcontractCost: 500, equipmentCost: 500, bdiCost: 0, taxCost: 0 });
  return { uid, actor, quoteId: 'quote', clientId: 'client', totalValue: 10000, downPaymentPct, installmentsCount, startDate: today };
}
function replaceStage(stage, patch) {
  const { id, ownerUid, createdBy, updatedBy, createdAt, updatedAt, ...payload } = { ...stage, ...patch };
  return payload;
}

test('confirmação é atômica e cria obra, parcelas, PDF, checklist e entrada no Planejamento', async () => {
  db.clear();
  const params = prepareQuote(40, 4, 4);
  rejectCommit = Object.assign(new Error('falha simulada no commit'), { code: 'permission-denied' });
  await assert.rejects(service.confirmQuoteAndGenerateProject(params), /recusou a gravação conjunta/);
  assert.deepEqual([rows('projects').length, rows('parcelas').length, rows('complianceItems').length, rows('auditLogs').length], [0, 0, 0, 0]);
  assert.equal(row('quotes', 'quote').status, 'Em negociação');
  const { projectId } = await service.confirmQuoteAndGenerateProject(params);
  const project = row('projects', projectId);
  assert.equal(project.status, 'Contratada');
  assert.match(project.planningStatus, /Aguardando/);
  assert.equal(row('quotes', 'quote').projectId, projectId);
  assert.equal(row('quotes', 'quote').status, 'Ganho');
  assert.equal(rows('parcelas').length, 5);
  assert.equal(rows('parcelas').find((payment) => payment.number === 0)?.amount, 4000);
  assert.equal(rows('parcelas').reduce((sum, payment) => sum + payment.amount, 0), 10000);
  assert.equal(rows('transactions').length, 0);
  assert.equal(new TextDecoder().decode(project.contractPdf.toUint8Array().slice(0, 5)), '%PDF-');
  assert.equal(rows('complianceItems').length, 3);
  await assert.rejects(service.confirmQuoteAndGenerateProject(params), /confirmado/);
  const pop = { id: 'pop', ...audit, status: 'Vigente', publicationNumber: 1, linkedStagePhase: 'Instalações' };
  await service.applyScheduleTemplateToProject({ uid, actor, project, templateType: 'Reforma', startDate: today, estimatedMonths: 3, pops: [pop] });
  assert.ok(rows('stages').some((stage) => stage.popId === pop.id));
  assert.equal(row('projects', projectId).status, 'Em execução');
  assert.equal(rows('stages').reduce((sum, stage) => sum + stage.budgetedCost, 0), 4000);
  assert.equal(rows('baselines').length, 1);
});

test('nova obra a partir de modelo cria etapas e vincula o POP publicado da fase', async () => {
  db.clear();
  const phase = 'Instalações';
  db.set('pops/draft', { ...audit, status: 'Em revisão', publicationNumber: 0, linkedStagePhase: phase });
  db.set('pops/published', { ...audit, status: 'Vigente', publicationNumber: 1, linkedStagePhase: phase });

  const projectId = await service.createProjectFromTemplate(uid, actor, {
    name: 'Obra de integração', clientName: 'Cliente', type: 'Reforma',
    contractValue: 10000, costBudget: 4000, startDate: today, pops: rows('pops'),
  });

  const project = row('projects', projectId);
  const stages = rows('stages').filter((stage) => stage.projectId === projectId);
  assert.equal(project.planningStatus, 'Cronograma criado');
  assert.ok(stages.length > 1);
  assert.deepEqual(project.scheduleStageIds, stages.map((stage) => stage.id));
  const installations = stages.find((stage) => stage.phase.endsWith(phase));
  assert.ok(installations);
  assert.equal(installations.popId, 'published');
  assert.ok(!stages.some((stage) => stage.popId === 'draft'));
});

test('atualização genérica registra valores anteriores e novos junto com a alteração', async () => {
  db.clear();
  db.set('clients/client', { ...audit, name: 'Nome anterior', notes: 'a'.repeat(500), origin: 'Indicação' });
  const payload = { name: 'Nome atualizado', notes: 'b'.repeat(500), origin: 'Indicação' };
  rejectCommit = new Error('falha simulada na auditoria');
  await assert.rejects(service.updateRecord('clients', 'client', uid, actor, payload, 'Cliente atualizado'),
    /falha simulada na auditoria/);
  assert.equal(row('clients', 'client').name, 'Nome anterior');
  assert.equal(rows('auditLogs').length, 0);
  await service.updateRecord('clients', 'client', uid, actor, payload, 'Cliente atualizado');
  assert.equal(row('clients', 'client').name, payload.name);
  const [log] = rows('auditLogs');
  assert.equal(log.beforeValue, 'Nome: Nome anterior · Observações: ' + 'a'.repeat(500));
  assert.equal(log.afterValue, 'Nome: Nome atualizado · Observações: ' + payload.notes);
});

test('recebimento alimenta parcela, caixa, DRE, Dashboard e pendências de notas sem dupla contagem', async () => {
  db.clear();
  const { projectId } = await service.confirmQuoteAndGenerateProject(prepareQuote(10));
  const installment = rows('parcelas').find((item) => item.number === 0);
  await service.markInstallmentReceived(uid, actor, installment, today, 'Pix');
  const current = row('parcelas', installment.id);
  const data = state();
  assert.equal(current.status, 'Recebida');
  assert.equal(current.invoiceStatus, 'A emitir');
  assert.equal(data.transactions[0].id, current.transactionId);
  assert.equal(data.transactions[0].installmentId, current.id);
  assert.equal(domain.calcularIndicadoresDashboard(data, today).saldoRealizadoCaixa, 1000);
  assert.equal(domain.calcularIndicadoresDashboard(data, today).resultadoMes, 1000);
  assert.equal(domain.calcularPainelDashboard(data, today).metrics.obrasAtivasQtd, 1);
  assert.equal(domain.calcularPrevisaoCaixa(data, 5, today).meses[0].realizadoEntradas, 1000);
  assert.equal(domain.calcularDreObra(row('projects', projectId), data.transactions).receita.realizado, 1000);
  await assert.rejects(service.markInstallmentReceived(uid, actor, installment, today, 'Pix'), /já foi recebida/);
  const receipts = (data) => domain.pendingInvoiceReceipts(domain.getInvoiceReceipts(data.transactions, data.installments));
  assert.equal(receipts(data).length, 1);
  await service.markReceiptInvoiceIssued(uid, actor, receipts(data)[0].target);
  assert.equal(receipts(state()).length, 0);
  assert.equal(row('parcelas', installment.id).invoiceStatus, 'Emitida');
  assert.equal(row('transactions', current.transactionId).invoiceStatus, 'Emitida');
});

test('a alocação semanal alimenta o centro de custo e o envio da folha gera uma única despesa prevista por linha', async () => {
  db.clear();
  const month = '2026-11';
  db.set('companySettings/company', { ...audit, inssRate: 10, fgtsRate: 5, vacationRate: 10, thirteenthRate: 5, taxParamsEffectiveDate: '2026-01-01' });
  db.set('employees/employee', { ...audit, name: 'Pessoa', employmentType: 'CLT', baseSalary: 3000, startDate: '2026-01-01', paymentMethod: 'Pix', currentProjectId: '' });
  db.set('projects/site', { ...audit, name: 'Obra', status: 'Em execução', type: 'Reforma' });
  const target = { status: 'Obra', projectId: 'site', projectName: 'Obra' };
  await service.saveWeeklyAllocation(uid, actor, row('employees', 'employee'), '2026-11-02', target, []);
  const data = state();
  const payroll = domain.calculateTeamPayroll(data, month);
  assert.equal(payroll.centers.find((center) => center.id === 'site').amount, 910);
  assert.equal(payroll.totalKnown, 3900);
  await service.submitTeamPayroll(uid, actor, data, month, '2026-11-30');
  assert.equal(rows('transactions').find((entry) => entry.projectId === 'site').amount, 910);
  assert.ok(rows('transactions').every((entry) => entry.isForecast && entry.source === 'folha' && entry.payrollEmployeeId === 'employee'));
  await assert.rejects(service.submitTeamPayroll(uid, actor, data, month, '2026-11-30'), /imutável/);
  assert.equal(rows('transactions').length, payroll.lines.length);
  await service.settleFinancialTransaction(uid, actor, rows('transactions').find((entry) => entry.projectId === 'site').id, today);
  assert.equal(domain.calcularDreObra(row('projects', 'site'), state().transactions).maoDeObra.realizado, 910);
});

test('atraso exige justificativa, desloca a previsão e gera alerta sem mudar a linha de base', async () => {
  db.clear();
  const startDate = domain.addDaysISO(today, -3);
  db.set('projects/site', { ...audit, name: 'Obra', startDate, status: 'Em execução', baselineEndDate: domain.addDaysISO(startDate, 7),
    forecastEndDate: domain.addDaysISO(startDate, 7), scheduleRevision: 1, scheduleStageIds: ['stage'] });
  db.set('stages/stage', { ...audit, projectId: 'site', name: 'Etapa', phase: 'Execução', wbsCode: '1', durationWeeks: 1,
    startWeek: 0, baselineStartWeek: 0, baselineDurationWeeks: 1, budgetedCost: 1000, dependsOn: [], checklistCompleted: [],
    progressPct: 20, status: 'Em andamento', popId: '', delayCategory: '', delayJustification: '' });
  const project = row('projects', 'site');
  const stage = row('stages', 'stage');
  const args = { uid, actor, project, knownStages: [stage], stageId: stage.id };
  await assert.rejects(service.saveProjectStage({ ...args, payload: replaceStage(stage, { durationWeeks: 2 }) }), /justific|categoria/i);
  assert.equal(row('projects', 'site').forecastEndDate, project.forecastEndDate);
  await service.saveProjectStage({ ...args, payload: replaceStage(stage, { durationWeeks: 2, delayCategory: 'Chuva', delayJustification: 'Registro de chuva na obra' }) });
  assert.equal(row('projects', 'site').forecastEndDate, domain.addDaysISO(startDate, 14));
  assert.equal(row('projects', 'site').baselineEndDate, project.baselineEndDate);
  assert.ok(domain.calcularPainelDashboard(state(), today).alerts.some((alert) => alert.referenciaId === stage.id && /atraso/.test(alert.mensagem)));
});

test('concluir etapa exige checklist publicado e registra 100% na Curva S', async () => {
  db.clear();
  db.set('projects/site', { ...audit, name: 'Obra', startDate: today, status: 'Em execução', forecastEndDate: '', scheduleRevision: 1, scheduleStageIds: ['stage'] });
  db.set('stages/stage', { ...audit, projectId: 'site', name: 'Etapa', phase: 'Execução', wbsCode: '1', durationWeeks: 1,
    startWeek: 0, baselineStartWeek: 0, baselineDurationWeeks: 1, budgetedCost: 1000, dependsOn: [], checklistCompleted: [],
    progressPct: 20, status: 'Em conferência', popId: 'pop', delayCategory: '', delayJustification: '' });
  db.set('pops/pop', { ...audit, title: 'Vistoria', version: 'v1.0', status: 'Vigente', publicationNumber: 1, acceptanceCriteria: ['Nível conferido'] });
  const stage = row('stages', 'stage');
  const args = { uid, actor, project: row('projects', 'site'), knownStages: [stage], stageId: stage.id };
  await assert.rejects(service.saveProjectStage({ ...args, moveTo: 'Concluída' }), /checklist/i);
  assert.equal(rows('scheduleProgress').length, 0);
  await service.saveProjectStage({ ...args, payload: replaceStage(stage, { status: 'Concluída', checklistCompleted: ['Nível conferido'] }) });
  assert.equal(row('stages', 'stage').progressPct, 100);
  assert.deepEqual(row('stages', 'stage').popReview.acceptanceCriteria, ['Nível conferido']);
  assert.equal(rows('scheduleProgress')[0].progressPct, 100);
});

test('obra integralmente paga na entrada encerra e gera garantia, DRE e pós-obra', async () => {
  db.clear();
  const { projectId } = await service.confirmQuoteAndGenerateProject(prepareQuote(100));
  assert.equal(rows('parcelas').length, 1);
  const installment = rows('parcelas')[0];
  await service.markInstallmentReceived(uid, actor, installment, today, 'Pix');
  await service.markReceiptInvoiceIssued(uid, actor, { installmentId: installment.id });
  db.set('projects/' + projectId, { ...db.get('projects/' + projectId), status: 'Em execução', scheduleStageIds: ['done'] });
  db.set('stages/done', { ...audit, projectId, name: 'Etapa', status: 'Concluída', progressPct: 100, budgetedCost: 4000 });
  await assert.rejects(service.closeProject(uid, actor, projectId), /ART\/RRT.*CNO/);
  for (const doc of rows('complianceItems').filter((doc) => doc.title !== 'Contrato assinado')) {
    const { id, ownerUid, createdBy, updatedBy, createdAt, updatedAt, ...payload } = doc;
    await service.saveComplianceItem(uid, actor, { ...payload, fileName: 'protocolo', status: 'Anexado' }, id);
  }
  const dre = await service.closeProject(uid, actor, projectId);
  const project = row('projects', projectId);
  assert.equal(project.status, 'Concluída');
  assert.equal(project.warrantyStartDate, today);
  assert.equal(domain.getWarrantyWindow(project, today).end, domain.addMonthsISO(today, 12));
  assert.equal(dre.receita.realizado, 10000);
  assert.equal(row('projectClosures', projectId).date, today);
  assert.equal(row('projectFollowUps', projectId).projectId, projectId);
  assert.equal(row('clients', 'client').status, 'Em garantia');
});

test('paginação mantém o histórico e refaz o cursor quando a primeira página muda', async () => {
  db.clear();
  for (let index = 1; index <= 405; index++) db.set('history/' + String(index).padStart(3, '0'), { ownerUid: uid });
  db.set('history/other', { ownerUid: 'foreign' });
  const sdk = globalThis.__pilotisTestFirestore;
  const source = sdk.query(makeRef('history'), sdk.where('ownerUid', '==', uid));
  const pages = await paging.readAllPages(source);
  assert.equal(pages.length, 405);
  let result = [];
  const stop = paging.listenToPages(source, (rows) => { result = rows.map((row) => row.id); }, (error) => { throw error; });
  try {
    await new Promise(setImmediate);
    assert.equal(result.length, 405);
    assert.equal(listeners.size, 3);
    db.set('history/000', { ownerUid: uid });
    for (const notify of listeners) queueMicrotask(notify);
    await new Promise(setImmediate);
    assert.equal(result.length, 406);
    assert.equal(result[0], '000');
    assert.equal(result.at(-1), '405');
  } finally { stop(); }
  assert.equal(listeners.size, 0);
});

test('regras declaradas negam por padrão e restringem cada lista', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false/);
  assert.match(rules, /request.auth.token.email_verified == true/);
  assert.match(rules, /request.auth.token.email.lower\(\) == companyEmail\(\)/);
  const directives = [...rules.matchAll(/\ballow\s+([^:]+):\s*if\s+([^;]+);/g)];
  assert.ok(directives.length > 90);
  for (const [, verbs, condition] of directives) {
    if (condition.trim() === 'false') continue;
    assert.match(condition, /\bisSignedIn\(\)|\bisOwner\(/);
    if (verbs.includes('list')) assert.match(condition, /^isBoundedList\(\)/);
  }
});

test('paleta de texto, status e contorno de foco atende aos limites de contraste conferidos', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const colors = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]));
  function luminance(hex) {
    const [red, green, blue] = hex.slice(1).match(/.{2}/g).map((channel) => {
      const value = Number.parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }
  const pairs = [
    ['text-primary', 'bg-app', 4.5], ['text-secondary', 'bg-surface', 4.5], ['text-secondary', 'bg-app', 4.5],
    ['text-on-dark-muted', 'bg-sidebar', 4.5], ['text-inverse', 'brand-primary', 4.5], ['text-inverse', 'brand-accent', 4.5],
    ...['success', 'warning', 'danger', 'info'].map((status) => ['status-' + status, 'status-' + status + '-bg', 4.5]),
    ['brand-accent-soft', 'bg-sidebar', 3], ['brand-primary', 'bg-app', 3],
  ];
  for (const [foreground, background, threshold] of pairs) {
    const a = luminance(colors[foreground]);
    const b = luminance(colors[background]);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= threshold, foreground + ' sobre ' + background + ' · ' + ratio.toFixed(2));
  }
});
