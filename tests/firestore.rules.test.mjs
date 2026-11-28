import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('usa o mesmo e-mail para autorizar o frontend, o backend e o acesso aos dados', async () => {
  const expectedEmail = 'gabrielmaxgestor@gmail.com';
  const files = {
    '../src/config/companyAuth.ts': /import\.meta\.env\.VITE_COMPANY_EMAIL\s*\|\|\s*'([^']+)'/,
    '../server.ts': /process\.env\.VITE_COMPANY_EMAIL\s*\?\?\s*'([^']+)'/,
    '../firestore.rules': /function companyEmail\(\)\s*\{\s*return '([^']+)'/,
    '../storage.rules': /token\.email\.lower\(\)\s*==\s*'([^']+)'/,
    '../Dockerfile': /^ARG VITE_COMPANY_EMAIL=(.+)$/m,
    '../.env.example': /^VITE_COMPANY_EMAIL="([^"]+)"$/m,
  };
  for (const [file, pattern] of Object.entries(files)) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.equal(pattern.exec(source)?.[1], expectedEmail, file);
  }
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.equal(/^COMPANY_EMAIL="([^"]+)"$/m.exec(env)?.[1], expectedEmail);
});

test('somente a conta verificada consulta os próprios registros em páginas limitadas', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { collection, connectFirestoreEmulator, doc, getDocFromServer, getDocsFromServer, getFirestore,
    limit, query, serverTimestamp, setDoc, terminate, where } = await import('firebase/firestore');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  assert.ok(host === '127.0.0.1' || host === 'localhost', 'Use apenas o emulador local');
  const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  const databases = [];
  const clients = [];
  const email = 'gabrielmaxgestor@gmail.com';
  function client(name, mockUserToken) {
    const app = initializeApp({ projectId: 'demo-pilotis' }, name);
    const db = getFirestore(app, config.firestore[0].database);
    connectFirestoreEmulator(db, host, Number(port), mockUserToken ? { mockUserToken } : {});
    clients.push(app);
    databases.push(db);
    return db;
  }

  try {
    const company = client('company', { sub: 'company', email, email_verified: true });
    const unverified = client('unverified', { sub: 'company', email, email_verified: false });
    const foreign = client('foreign', { sub: 'company', email: 'other@example.invalid', email_verified: true });
    const separateOwner = client('separate', { sub: 'separate', email, email_verified: true });
    const guest = client('guest');
    const record = (db) => doc(db, 'auditLogs', 'integration-permission-check');
    const permission = { code: 'permission-denied' };
    const data = { ownerUid: 'company', registeredBy: 'Sócio', action: 'Criação', entityType: 'tests',
      summary: 'Emulador de regras', createdAt: serverTimestamp() };
    await setDoc(record(company), data);
    assert.ok((await getDocFromServer(record(company))).exists());
    for (const db of [unverified, foreign, separateOwner, guest]) {
      await assert.rejects(getDocFromServer(record(db)), permission);
      await assert.rejects(setDoc(doc(db, 'auditLogs/restricted'), data), permission);
    }
    const source = collection(company, 'auditLogs');
    assert.ok((await getDocsFromServer(query(source, where('ownerUid', '==', 'company'), limit(201)))).size > 0);
    await assert.rejects(getDocsFromServer(query(source, where('ownerUid', '==', 'company'))), permission);
    await assert.rejects(getDocsFromServer(query(source, where('ownerUid', '==', 'company'), limit(202))), permission);
    await assert.rejects(getDocsFromServer(query(source, limit(201))), permission);
    await assert.rejects(getDocFromServer(doc(company, 'conversasIA/company/mensagens/private')), permission);
    await assert.rejects(getDocFromServer(doc(company, 'unknown/private')), permission);
  } finally {
    await Promise.all(databases.map((db) => terminate(db)));
    await Promise.all(clients.map((app) => deleteApp(app)));
  }
});

// Use the real confirmation service and Firestore SDK against the isolated emulator.
// Substitute only the app's browser-specific Firebase initialization.
async function loadConfirmationService(db) {
  const root = new URL('../', import.meta.url);
  const appFirebase = new URL('src/lib/firebase.ts', root).href;
  globalThis.__pilotisRulesTestDb = db;
  const loader = registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('.') && context.parentURL?.startsWith(root.href)) {
        const base = new URL(specifier, context.parentURL);
        for (const suffix of ['', '.ts', '/index.ts']) {
          const candidate = base.href + suffix;
          if (candidate.endsWith('.ts') && existsSync(fileURLToPath(candidate))) {
            return { url: candidate, shortCircuit: true };
          }
        }
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url === appFirebase) {
        return { format: 'module', shortCircuit: true, source:
          'export const db = globalThis.__pilotisRulesTestDb; export const OperationType = {}; export const auth = {}; export function handleFirestoreError(error) { throw error; }' };
      }
      if (url.startsWith(root.href) && url.endsWith('.ts')) {
        const source = readFileSync(fileURLToPath(url), 'utf8');
        return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(source, { mode: 'transform' }) };
      }
      return next(url, context);
    },
  });
  try {
    return {
      ...await import('../src/services/pilotisService.ts'),
      ...await import('../src/services/whatsappService.ts'),
      ...await import('../src/domain/whatsapp.ts'),
      ...await import('../src/services/archiveService.ts'),
      ...await import('../src/services/editUndo.ts'),
      ...await import('../src/server/recordDeletion.ts'),
      ...await import('../src/server/workReportStore.ts'),
      ...await import('../src/server/workReportRoutes.ts'),
      ...await import('../src/domain/pdfDocument.ts'),
    };
  } finally {
    loader.deregister();
    delete globalThis.__pilotisRulesTestDb;
  }
}

test('a confirmação grava obra, PDF, parcelas e checklist no banco nomeado', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { Bytes, deleteDoc, collection, connectFirestoreEmulator, doc, getDocFromServer, getDocsFromServer, getFirestore,
    limit, query, serverTimestamp, setDoc, terminate, updateDoc, where, writeBatch } = await import('firebase/firestore');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  assert.ok(host === '127.0.0.1' || host === 'localhost', 'Use apenas o emulador local');
  const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  const app = initializeApp({ projectId: 'demo-pilotis' }, 'quote-confirmation');
  const db = getFirestore(app, config.firestore[0].database);
  const uid = 'confirm-' + randomUUID();
  const actor = 'Sócio';
  connectFirestoreEmulator(db, host, Number(port), {
    mockUserToken: { sub: uid, email: 'gabrielmaxgestor@gmail.com', email_verified: true },
  });

  try {
    const { confirmQuoteAndGenerateProject, createProjectFromTemplate, recordFinancialTransaction, updateRecord,
      markInstallmentReceived, reverseFinancialMovement, undoInstallmentReceipt, setRecordArchived,
      prepareEditUndo, permanentRecordDeletion, saveCustomerMaterials, saveProjectStage, linkProjectClient,
      recordWhatsAppSend, upsertCompanySettings, whatsappTemplates, createWorkReportStore, createWorkReportRouter,
      showSharedWorkReport, pdfText, recordAccountingPackageExport } =
      await loadConfirmationService(db);
    const meta = {
      ownerUid: uid, createdBy: actor, updatedBy: actor, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    const totalValue = 12_000;
    const startDate = '2027-01-15';
    const clientRef = doc(collection(db, 'clients'));
    await setDoc(clientRef, {
      ...meta, name: 'Cliente do teste', origin: 'Indicação', status: 'Potencial',
      city: 'Valença', referredBy: '', phone: '(24) 99999-1212', email: '', notes: '', referralsCount: 0,
      testimonialStatus: 'Aguardando conclusão',
    });
    const matching = (name, projectId) => getDocsFromServer(query(collection(db, name),
      where('ownerUid', '==', uid), where('projectId', '==', projectId), limit(100)));

    const cases = [
      { installmentsCount: 4, status: 'Ganho' },
      { installmentsCount: 36, status: 'Em negociação' },
    ];
    for (const { installmentsCount, status } of cases) {
      if (status === 'Em negociação') {
        await setDoc(doc(db, 'companySettings', uid), { ...meta, companyName: 'Empresa no teste do emulador' });
      }
      const quoteRef = doc(collection(db, 'quotes'));
      await setDoc(quoteRef, {
        ...meta, code: 'TESTE', title: 'Confirmação no emulador', clientId: clientRef.id, clientName: 'Cliente do teste',
        type: 'Reforma', city: 'Valença', areaM2: 80, estimatedMonths: 4, validityDays: 30,
        description: 'Confirmação no banco do emulador', origin: 'Indicação',
        laborCost: 6000, subcontractCost: 1000, equipmentCost: 500, bdiCost: 500, taxCost: 1000, pricingMarginPct: 25,
        totalValue, downPaymentPct: 40, installmentsCount,
        probabilityPct: status === 'Ganho' ? 100 : 50, status, discardReason: '', lossReason: '',
        version: 'v1.0', versionHistory: ['v1.0|2027-01-15|12000.00|9000.00|25.0|Sócio|Versão inicial'],
        contractSignStatus: status === 'Ganho' ? 'Aguardando assinatura' : 'Não gerado',
        contractSignedAt: '', contractAddenda: [], addendaTotalValue: 0, projectId: '',
      });

      await assert.rejects(updateDoc(quoteRef, {
        status: 'Ganho', probabilityPct: 100, projectId: 'missing-' + randomUUID(),
        contractSignStatus: 'Aguardando assinatura', updatedAt: serverTimestamp(),
      }), { code: 'permission-denied' });

      if (status === 'Em negociação') {
        const orphanProject = doc(collection(db, 'projects'));
        const missingClientId = 'missing-client-' + randomUUID();
        const batch = writeBatch(db);
        batch.set(orphanProject, {
          ...meta, name: 'Obra isolada', type: 'Reforma', quoteId: quoteRef.id, clientId: missingClientId,
          contractValue: totalValue, contractPdf: Bytes.fromUint8Array(new TextEncoder().encode('%PDF-')),
          status: 'Contratada', planningStatus: 'Aguardando modelo de cronograma',
        });
        batch.update(quoteRef, {
          status: 'Ganho', probabilityPct: 100, projectId: orphanProject.id, clientId: missingClientId,
          contractSignStatus: 'Aguardando assinatura', updatedAt: serverTimestamp(),
        });
        await assert.rejects(batch.commit(), { code: 'permission-denied' });
        assert.equal((await getDocFromServer(orphanProject)).exists(), false);
      }

      const { projectId } = await confirmQuoteAndGenerateProject({
        uid, actor, quoteId: quoteRef.id, totalValue, downPaymentPct: 40, installmentsCount, startDate,
      });
      const project = (await getDocFromServer(doc(db, 'projects', projectId))).data();
      assert.equal(project.status, 'Contratada');
      assert.equal(project.planningStatus, 'Aguardando modelo de cronograma');
      assert.equal(new TextDecoder().decode(project.contractPdf.toUint8Array().slice(0, 5)), '%PDF-');
      const quote = (await getDocFromServer(quoteRef)).data();
      assert.equal(quote.status, 'Ganho');
      assert.equal(quote.projectId, projectId);
      assert.equal(quote.totalValue, totalValue);
      await assert.rejects(updateDoc(quoteRef, {
        totalValue: totalValue + 1, updatedAt: serverTimestamp(),
      }), { code: 'permission-denied' });
      const payments = (await matching('parcelas', projectId)).docs.map((item) => item.data());
      assert.equal(payments.length, installmentsCount + 1);
      assert.equal(payments.find((item) => item.number === 0)?.amount, 4800);
      assert.equal(payments.reduce((cents, item) => cents + Math.round(item.amount * 100), 0), totalValue * 100);
      assert.deepEqual((await matching('complianceItems', projectId)).docs.map((item) => item.data().title).sort(),
        ['ART/RRT', 'Contrato assinado', 'Matrícula CNO']);
      await assert.rejects(setDoc(doc(collection(db, 'parcelas')), {
        ...payments[0], ...meta, projectId: 'missing-' + randomUUID(),
      }), { code: 'permission-denied' });
    }
    const audits = await getDocsFromServer(query(collection(db, 'auditLogs'), where('ownerUid', '==', uid), limit(100)));
    assert.equal(audits.docs.filter((item) => item.data().entityType === 'quote->project').length, 2);

    await updateRecord('clients', clientRef.id, uid, actor, { notes: 'a'.repeat(500) }, 'Observações registradas');
    await updateRecord('clients', clientRef.id, uid, actor, { notes: 'b'.repeat(500) }, 'Observações atualizadas');
    const updatedAudits = await getDocsFromServer(query(collection(db, 'auditLogs'), where('ownerUid', '==', uid), limit(100)));
    const change = updatedAudits.docs.map((item) => item.data()).find((item) => item.summary === 'Observações atualizadas');
    assert.equal(change?.beforeValue, 'Observações: ' + 'a'.repeat(500));
    assert.equal(change?.afterValue, 'Observações: ' + 'b'.repeat(500));

    const receipt = new File(['%PDF-1.4'], 'comprovante.pdf', { type: 'application/pdf' });
    await recordFinancialTransaction(uid, actor, {
      date: '2027-01-15', dueDate: '2027-01-15', description: 'Empréstimo conferido',
      entryKind: 'loan', category: 'Empréstimo', projectId: 'Empresa', projectName: 'Empresa',
      amount: 1200, isForecast: false, status: 'Não é receita', invoiceStatus: 'Não se aplica',
      paymentMethod: 'Pix', installmentLabel: '', quoteId: '', debtId: '', source: 'manual',
    }, receipt, { creditor: 'Credor de teste', debtType: 'Empréstimo bancário', remainingInstallments: 3, nextDueDate: '2027-02-15' });
    const loans = await getDocsFromServer(query(collection(db, 'transactions'), where('ownerUid', '==', uid), limit(100)));
    assert.equal(loans.size, 1);
    const loan = loans.docs[0].data();
    assert.equal(loan.entryKind, 'loan');
    assert.equal(loan.receiptFile.name, 'comprovante.pdf');
    assert.equal(new TextDecoder().decode(loan.receiptFile.content.toUint8Array()), '%PDF-1.4');
    const debt = (await getDocFromServer(doc(db, 'debts', loan.debtId))).data();
    assert.equal(debt.remainingInstallments, 3);
    assert.equal(debt.nextDueDate, '2027-02-15');
    assert.equal(debt.monthlyCost, undefined);

    const popRef = doc(collection(db, 'pops'));
    await setDoc(popRef, {
      ...meta, title: 'Conferência das instalações', serviceType: 'Instalações', linkedStagePhase: 'Instalações',
      version: 'v1.0', status: 'Vigente', publicationNumber: 1,
    });
    const pop = (await getDocFromServer(popRef)).data();
    const modeledProjectId = await createProjectFromTemplate(uid, actor, {
      name: 'Obra a partir do modelo', clientName: 'Cliente do teste', type: 'Reforma',
      contractValue: totalValue, costBudget: 5000, startDate, pops: [{ ...pop, id: popRef.id }],
    });
    const modeledStages = await matching('stages', modeledProjectId);
    assert.ok(modeledStages.size > 1);
    const linkedStage = modeledStages.docs.find((item) => item.data().phase.endsWith('Instalações'));
    assert.equal(linkedStage?.data().popId, popRef.id);

    const materialProjectRef = doc(db, 'projects', modeledProjectId);
    let materialProject = { id: modeledProjectId, ...(await getDocFromServer(materialProjectRef)).data() };
    const materialStages = modeledStages.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const firstStage = materialStages.find((stage) => stage.startWeek === 0 && !stage.isMilestone);
    assert.ok(firstStage, 'O modelo deve ter uma etapa de início');
    const materialInput = {
      stageId: firstStage.id, description: 'Material da etapa no emulador', quantity: 12, unit: 'm',
      leadDays: 2, promisedDate: '2027-01-13', deliveredDate: '', status: 'Comprado', clientContact: 'Cliente', notes: '',
    };
    const originalForecast = materialProject.forecastEndDate;
    const materialParams = { uid, actor, knownStages: materialStages };
    assert.equal(await saveCustomerMaterials({ ...materialParams, project: materialProject, item: materialInput }), 1);
    materialProject = { id: modeledProjectId, ...(await getDocFromServer(materialProjectRef)).data() };
    const materialRef = doc(db, 'customerMaterials', materialProject.customerMaterialIds[0]);
    await assert.rejects(updateDoc(materialRef, { leadDays: 3, updatedAt: serverTimestamp() }), { code: 'permission-denied' });
    await saveCustomerMaterials({ ...materialParams, project: materialProject, itemId: materialRef.id,
      item: { ...materialInput, promisedDate: '2027-01-20' } });
    materialProject = { id: modeledProjectId, ...(await getDocFromServer(materialProjectRef)).data() };
    assert.ok(materialProject.forecastEndDate > originalForecast);
    const material = (await getDocFromServer(materialRef)).data();
    const dateAudit = (await getDocFromServer(doc(db, 'auditLogs', material.auditId))).data();
    assert.match(dateAudit.beforeValue, /Prometida: 13\/01\/2027/);
    assert.match(dateAudit.afterValue, /Prometida: 20\/01\/2027/);
    await assert.rejects(saveProjectStage({
      uid, actor, project: materialProject, knownStages: materialStages, stageId: firstStage.id, moveTo: 'Em andamento',
    }), /aguardando material do cliente/);
    assert.equal(await saveCustomerMaterials({ ...materialParams, project: materialProject, templateLeadDays: 7 }), 3);
    materialProject = { id: modeledProjectId, ...(await getDocFromServer(materialProjectRef)).data() };
    assert.equal(await saveCustomerMaterials({ ...materialParams, project: materialProject, templateLeadDays: 7 }), 0);

    const denial = { code: 'permission-denied' };
    const loanId = loans.docs[0].id;
    const loanRef = doc(db, 'transactions', loanId);
    await assert.rejects(deleteDoc(loanRef), denial);
    await assert.rejects(updateDoc(loanRef, { status: 'Estornado', updatedAt: serverTimestamp() }), denial);
    await assert.rejects(reverseFinancialMovement(uid, actor, loanId, '   '), /Informe um motivo/);
    await reverseFinancialMovement(uid, actor, loanId, 'Lançado em duplicidade');
    const reversed = (await getDocFromServer(loanRef)).data();
    const inverseRef = doc(db, 'transactions', reversed.reversalId);
    const inverse = (await getDocFromServer(inverseRef)).data();
    assert.equal(reversed.status, 'Estornado');
    assert.equal(inverse.status, 'Estorno');
    assert.equal(inverse.reversalOfId, loanId);
    assert.equal(inverse.amount, reversed.amount);
    const reversalAudit = (await getDocFromServer(doc(db, 'auditLogs', reversed.reversalAuditId))).data();
    assert.equal(reversalAudit.entityId, loanId);
    assert.equal(reversalAudit.afterValue, 'Lançado em duplicidade');
    assert.equal((await getDocFromServer(doc(db, 'debts', loan.debtId))).data().principalBalance, 0);
    await assert.rejects(updateDoc(inverseRef, { amount: 700, updatedAt: serverTimestamp() }), denial);
    await assert.rejects(reverseFinancialMovement(uid, actor, loanId, 'Tentativa repetida'), /indisponível/);
    await recordFinancialTransaction(uid, actor, {
      date: loan.date, description: 'Crédito com baixa parcial', entryKind: 'loan', category: 'Empréstimo',
      projectId: 'Empresa', amount: loan.amount, isForecast: false, status: 'Não é receita', paymentMethod: 'Pix',
    }, undefined, { creditor: 'Credor do teste', debtType: 'Empréstimo bancário' });
    const posted = (await getDocsFromServer(query(collection(db, 'transactions'),
      where('ownerUid', '==', uid), where('description', '==', 'Crédito com baixa parcial'), limit(1)))).docs[0];
    const changedDebt = doc(db, 'debts', posted.data().debtId);
    await updateDoc(changedDebt, { principalBalance: 900, status: 'Em dia', updatedAt: serverTimestamp() });
    await reverseFinancialMovement(uid, actor, posted.id, 'Corrigir o lançamento original');
    assert.equal((await getDocFromServer(posted.ref)).data().status, 'Estornado');
    assert.equal((await getDocFromServer(changedDebt)).data().principalBalance, 900);

    const parcel = (await getDocsFromServer(query(collection(db, 'parcelas'), where('ownerUid', '==', uid), limit(1)))).docs[0];
    const originalParcel = { id: parcel.id, ...parcel.data() };
    const openedPhone = '5524999991212';
    const history = collection(clientRef, 'whatsappHistory');
    const sendParams = { uid, actor, clientId: clientRef.id, openedPhone };
    const reminderId = 'test-reminder';
    const reminderTarget = { model: 'installmentDue', projectId: originalParcel.projectId, sourceId: parcel.id };
    const reminderRef = doc(history, reminderId);
    await assert.rejects(updateDoc(parcel.ref, {
      reminderMessageId: reminderId, reminderSentAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }), denial);
    await assert.rejects(setDoc(reminderRef, { ...meta, ...reminderTarget }), denial);
    await assert.rejects(recordWhatsAppSend({ ...sendParams, openedPhone: '5524999990055', messageId: reminderId,
      target: reminderTarget }), /contato do cliente mudou/);
    await recordWhatsAppSend({ ...sendParams, messageId: reminderId, target: reminderTarget });
    await recordWhatsAppSend({ ...sendParams, messageId: reminderId, target: reminderTarget });
    const reminder = (await getDocFromServer(reminderRef)).data();
    const remindedParcel = (await getDocFromServer(parcel.ref)).data();
    assert.equal(reminder.model, 'installmentDue');
    assert.equal(reminder.createdBy, actor);
    assert.equal(remindedParcel.reminderMessageId, reminderId);
    assert.equal(remindedParcel.reminderSentAt.toMillis(), reminder.createdAt.toMillis());
    assert.deepEqual(Object.keys(reminder).sort(),
      ['createdAt', 'createdBy', 'model', 'ownerUid', 'projectId', 'sourceId', 'updatedAt', 'updatedBy'].sort());
    await assert.rejects(updateDoc(reminderRef, { model: 'installmentOverdue' }), denial);
    await assert.rejects(deleteDoc(reminderRef), denial);
    await assert.rejects(getDocsFromServer(history), denial);
    assert.equal((await getDocsFromServer(query(history, limit(25)))).size, 1);

    const settingsRef = doc(db, 'companySettings', uid);
    const settings = (await getDocFromServer(settingsRef)).data();
    const templates = { ...whatsappTemplates(), installmentDue: 'Olá, {cliente}. A parcela vence em {vencimento}.' };
    await upsertCompanySettings(uid, actor, settings, { whatsappTemplates: templates });
    assert.deepEqual((await getDocFromServer(settingsRef)).data().whatsappTemplates, templates);
    await assert.rejects(updateDoc(settingsRef, { 'whatsappTemplates.unexpected': 'x', updatedAt: serverTimestamp() }), denial);

    await linkProjectClient(uid, actor, modeledProjectId, clientRef.id);
    const milestone = materialStages.find((stage) => stage.isMilestone);
    assert.ok(milestone);
    for (const [model, sourceId] of [['material', materialRef.id], ['milestone', milestone.id]]) {
      await recordWhatsAppSend({ ...sendParams, messageId: 'test-' + model, target: { model, projectId: modeledProjectId, sourceId } });
      assert.equal((await getDocFromServer(doc(history, 'test-' + model))).data().model, model);
    }
    await markInstallmentReceived(uid, actor, originalParcel, '2026-01-15', 'Pix');
    const received = (await getDocFromServer(parcel.ref)).data();
    await assert.rejects(updateDoc(parcel.ref, { status: 'A vencer', updatedAt: serverTimestamp() }), denial);
    await assert.rejects(reverseFinancialMovement(uid, actor, received.transactionId, 'Retorno avulso'), /parcela/);
    await undoInstallmentReceipt(uid, actor, parcel.id, 'Parcela selecionada por engano');
    const reopened = (await getDocFromServer(parcel.ref)).data();
    assert.equal(reopened.status, 'A vencer');
    assert.equal(reopened.receivedDate, '');
    assert.equal(reopened.transactionId, '');
    assert.equal(reopened.amount, originalParcel.amount);
    assert.equal(reopened.reminderMessageId, reminderId);
    const reversedReceipt = (await getDocFromServer(doc(db, 'transactions', received.transactionId))).data();
    assert.equal(reversedReceipt.status, 'Estornado');
    assert.equal(reversedReceipt.reversalAuditId, reopened.receiptReversalAuditId);
    await markInstallmentReceived(uid, actor, originalParcel, '2026-01-16', 'Pix');
    assert.notEqual((await getDocFromServer(parcel.ref)).data().transactionId, received.transactionId);

    const state = (await getDocFromServer(clientRef)).data();
    const undo = prepareEditUndo(uid, actor, [{ ref: clientRef, before: state, after: { notes: 'Editar no teste' } }]);
    await updateRecord('clients', clientRef.id, uid, actor, { notes: 'Editar no teste' }, 'Editar');
    await undo();
    assert.equal((await getDocFromServer(clientRef)).data().notes, state.notes);
    await assert.rejects(undo(), /registro mudou/);

    await assert.rejects(updateDoc(clientRef, {
      archive: { at: serverTimestamp(), by: actor }, updatedAt: serverTimestamp(),
    }), denial);
    await setRecordArchived(uid, actor, 'clients', clientRef.id, true);
    assert.equal((await getDocFromServer(clientRef)).data().archive.by, actor);
    await assert.rejects(updateDoc(clientRef, { name: 'Alteração de arquivado', updatedAt: serverTimestamp() }), denial);
    await assert.rejects(deleteDoc(clientRef), denial);

    const { initializeApp: initializeAdmin, deleteApp: deleteAdmin } = await import('firebase-admin/app');
    const { getFirestore: getAdminFirestore } = await import('firebase-admin/firestore');
    const admin = initializeAdmin({ projectId: 'demo-pilotis' }, 'record-lifecycle');
    try {
      const adminDb = getAdminFirestore(admin, config.firestore[0].database);
      await recordAccountingPackageExport(uid, actor, '2026-11-01', '2026-11-30');
      const exportLog = await adminDb.collection('auditLogs').where('ownerUid', '==', uid)
        .where('entityType', '==', 'accountingPackage').get();
      assert.equal(exportLog.size, 1);
      assert.equal(exportLog.docs[0].get('registeredBy'), actor);
      assert.equal(exportLog.docs[0].get('afterValue'), '01/11/2026 a 30/11/2026');
      assert.equal(typeof exportLog.docs[0].get('createdAt').toMillis(), 'number');
      await assert.rejects(permanentRecordDeletion(adminDb, uid, 'clients', clientRef.id, actor), /vínculos/);
      await setRecordArchived(uid, actor, 'clients', clientRef.id, false);
      assert.equal((await getDocFromServer(clientRef)).data().archive, undefined);
      const quote = (await getDocsFromServer(query(collection(db, 'quotes'),
        where('ownerUid', '==', uid), limit(1)))).docs[0];
      const employee = doc(collection(db, 'employees'));
      await setDoc(employee, { ...meta, name: 'Colaborador do teste', role: 'Alvenaria', employmentType: 'CLT', baseSalary: 4000 });
      for (const [entity, id] of [['quotes', quote.id], ['projects', modeledProjectId], ['employees', employee.id]]) {
        const ref = doc(db, entity, id);
        await setRecordArchived(uid, actor, entity, id, true);
        const archived = (await getDocFromServer(ref)).data();
        assert.equal(archived.archive.by, actor);
        await assert.rejects(deleteDoc(ref), denial);
        await setRecordArchived(uid, actor, entity, id, false);
        assert.equal((await getDocFromServer(ref)).data().archive, undefined);
      }
      const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKACiiigAooooAKKKKAP/2Q==', 'base64');
      let serverNow = Date.parse('2027-01-29T15:00:00Z');
      const reports = createWorkReportStore(adminDb, async () => jpeg, () => serverNow);
      const reportLogId = 'report-test-' + randomUUID();
      const logRef = adminDb.collection('dailyLogs').doc(reportLogId);
      await logRef.set({
        ownerUid: uid, projectId: modeledProjectId, date: '2027-01-20', photoIds: ['test-photo'], photoBackend: 'firestore',
      });
      await logRef.collection('photos').doc('test-photo').set({ ownerUid: uid, mimeType: 'image/jpeg', content: jpeg });
      await adminDb.collection('companySettings').doc(uid).update({ companyName: 'Marca do emulador',
        accentColor: '#1F3A5F', logoDataUrl: 'data:image/jpeg;base64,' + jpeg.toString('base64'), pdfShowLogo: true });
      await adminDb.collection('stages').doc(firstStage.id).update({ status: 'Concluída', completedDate: '2027-01-18', progressPct: 100 });
      const selected = [{ logId: reportLogId, photoId: 'test-photo', caption: 'Fundação executada' }];
      await reports.saveApproval(uid, actor, modeledProjectId, { id: '', title: 'Aprovar acabamento', dueDate: '2027-02-05', approvedAt: '' });
      await assert.rejects(reports.generate(uid, actor, modeledProjectId, '2027-01', selected, jpeg.toString('base64'), false), /autorização/);
      await assert.rejects(reports.generate(uid, actor, originalParcel.projectId, '2027-01', selected, jpeg.toString('base64'), true), /diário da obra/);

      const express = (await import('express')).default;
      const httpApp = express();
      httpApp.get('/relatorio', showSharedWorkReport);
      httpApp.use('/api/work-reports', createWorkReportRouter({
        store: () => reports, authorizedEmail: 'gabrielmaxgestor@gmail.com',
        verifyToken: async (token) => ({ uid: token === 'company' ? uid : 'outro-usuario', email_verified: true,
          email: 'gabrielmaxgestor@gmail.com' }),
      }));
      const http = httpApp.listen(0, '127.0.0.1');
      try {
        if (!http.listening) await new Promise((resolve) => http.once('listening', resolve));
        const origin = 'http://127.0.0.1:' + http.address().port;
        const api = origin + '/api/work-reports';
        const endpoint = api + '/projects/' + modeledProjectId;
        const send = (url, payload, token = '') => fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
          body: JSON.stringify(payload),
        });
        const generation = { actor, month: '2027-01', photos: selected, photosAuthorized: true, logoJpeg: jpeg.toString('base64') };
        assert.equal((await send(endpoint, generation)).status, 401);
        assert.equal((await send(endpoint, generation, 'other')).status, 404);
        const createdResponse = await send(endpoint, generation, 'company');
        assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
        const created = await createdResponse.json();
        assert.equal(created.month, '2027-01');
        assert.equal(created.createdBy, actor);
        const reportRef = doc(db, 'projects', modeledProjectId, 'workReports', created.id);
        await assert.rejects(getDocFromServer(reportRef), denial);
        await assert.rejects(getDocFromServer(doc(db, 'projects', modeledProjectId, 'workReports', created.id, 'pdf', '0')), denial);
        const download = await fetch(endpoint + '/' + created.id + '/pdf', { headers: { Authorization: 'Bearer company' } });
        assert.equal(download.status, 200);
        const pdf = Buffer.from(await download.arrayBuffer());
        const content = pdf.toString('ascii');
        assert.ok(content.startsWith('%PDF-1.4'));
        for (const label of ['Marca do emulador', 'Aprovar acabamento', 'Fundação executada', '20/01/2027', '18/01/2027']) {
          assert.ok(content.includes(pdfText(label)), label);
        }
        assert.equal(content.match(/\/Subtype \/Image/g)?.length, 2);
        assert.ok(!content.includes(pdfText('R$ 12.000,00')));
        assert.ok(!content.includes(pdfText(modeledProjectId)));
        assert.ok(!content.includes(pdfText('Confirmação no emulador')));

        const sharing = endpoint + '/' + created.id;
        const link = await (await send(sharing + '/share', { actor }, 'company')).json();
        assert.match(link.token, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(Date.parse(link.report.shareExpiresAt) - serverNow, 30 * 86_400_000);
        const stored = (await adminDb.doc('projects/' + modeledProjectId + '/workReports/' + created.id).get()).data();
        assert.notEqual(stored.shareHash, link.token);
        await assert.rejects(getDocFromServer(doc(db, 'workReportShares', stored.shareHash)), denial);
        const publicAccess = (token) => send(api + '/public', { token });
        const page = await fetch(origin + '/relatorio');
        assert.match(page.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
        assert.match(await page.text(), /location\.hash/);
        const response = await publicAccess(link.token);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('Cache-Control'), /no-store/);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
        assert.equal((await publicAccess('x'.repeat(43))).status, 404);
        assert.equal((await publicAccess(created.id)).status, 404);
        const sent = await (await send(sharing + '/sent', { actor }, 'company')).json();
        assert.ok(sent.report.sentAt);
        assert.equal(sent.report.sentBy, actor);
        assert.equal((await send(sharing + '/revoke', { actor }, 'company')).status, 200);
        assert.equal((await publicAccess(link.token)).status, 404);
        const rotated = await (await send(sharing + '/share', { actor }, 'company')).json();
        assert.notEqual(rotated.token, link.token);
        serverNow += 30 * 86_400_000;
        assert.equal((await publicAccess(rotated.token)).status, 404);
        const listed = await (await fetch(endpoint, { headers: { Authorization: 'Bearer company' } })).json();
        assert.equal(listed.reports[0].shareActive, false);
        assert.equal(listed.reports[0].sentAt, sent.report.sentAt);
        const audit = await adminDb.collection('auditLogs').where('entityId', '==', created.id).get();
        assert.ok(audit.docs.some((row) => row.data().summary === 'Relatório gerado'));
        assert.ok(audit.docs.some((row) => row.data().summary === 'Envio do relatório registrado'));
      } finally {
        await new Promise((resolve) => http.close(resolve));
      }

      await adminDb.doc('projects/' + modeledProjectId).update({ status: 'Concluída' });
      const testimonialTarget = { model: 'testimonial', projectId: modeledProjectId, sourceId: modeledProjectId };
      await recordWhatsAppSend({ ...sendParams, messageId: 'test-testimonial', target: testimonialTarget });
      assert.equal((await getDocFromServer(doc(history, 'test-testimonial'))).data().model, 'testimonial');
      assert.match((await getDocFromServer(doc(db, 'projectFollowUps', modeledProjectId))).data().testimonialRequestedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal((await getDocFromServer(clientRef)).data().testimonialStatus, 'Solicitado');

      const legacy = adminDb.collection('parcelas').doc();
      const currentParcel = (await adminDb.doc('parcelas/' + parcel.id).get()).data();
      await legacy.set({ ...currentParcel, status: 'Recebida', transactionId: '', receivedDate: '2026-01-15' });
      await undoInstallmentReceipt(uid, actor, legacy.id, 'Corrigir parcela legada');
      assert.equal((await legacy.get()).data().status, 'A vencer');
      const unlinked = doc(collection(db, 'clients'));
      const unlinkedData = { ...meta, name: 'Cadastro independente no teste', origin: '', status: 'Potencial' };
      await setDoc(unlinked, unlinkedData);
      await setRecordArchived(uid, actor, 'clients', unlinked.id, true);
      await permanentRecordDeletion(adminDb, uid, 'clients', unlinked.id, actor);
      assert.equal((await adminDb.doc('clients/' + unlinked.id).get()).exists, false);
      await assert.rejects(setDoc(unlinked, unlinkedData), denial);
    } finally {
      await deleteAdmin(admin);
    }
  } finally {
    await terminate(db);
    await deleteApp(app);
  }
});
