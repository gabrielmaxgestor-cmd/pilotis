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
      ...await import('../src/services/archiveService.ts'),
      ...await import('../src/services/editUndo.ts'),
      ...await import('../src/server/recordDeletion.ts'),
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
      prepareEditUndo, permanentRecordDeletion } =
      await loadConfirmationService(db);
    const meta = {
      ownerUid: uid, createdBy: actor, updatedBy: actor, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    const totalValue = 12_000;
    const startDate = '2027-01-15';
    const clientRef = doc(collection(db, 'clients'));
    await setDoc(clientRef, {
      ...meta, name: 'Cliente do teste', origin: 'Indicação', status: 'Potencial',
      city: 'Valença', referredBy: '', phone: '', email: '', notes: '', referralsCount: 0,
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

    const parcel = (await getDocsFromServer(query(collection(db, 'parcelas'), where('ownerUid', '==', uid), limit(1)))).docs[0];
    const originalParcel = { id: parcel.id, ...parcel.data() };
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
      await assert.rejects(permanentRecordDeletion(adminDb, uid, 'clients', clientRef.id, actor), /vínculos/);
      await setRecordArchived(uid, actor, 'clients', clientRef.id, false);
      assert.equal((await getDocFromServer(clientRef)).data().archive, undefined);
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
