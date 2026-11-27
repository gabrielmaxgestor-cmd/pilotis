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
          'export const db = globalThis.__pilotisRulesTestDb; export const OperationType = {}; export function handleFirestoreError(error) { throw error; }' };
      }
      if (url.startsWith(root.href) && url.endsWith('.ts')) {
        const source = readFileSync(fileURLToPath(url), 'utf8');
        return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(source, { mode: 'transform' }) };
      }
      return next(url, context);
    },
  });
  try {
    return await import('../src/services/pilotisService.ts');
  } finally {
    loader.deregister();
    delete globalThis.__pilotisRulesTestDb;
  }
}

test('a confirmação grava obra, PDF, parcelas e checklist no banco nomeado', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { collection, connectFirestoreEmulator, doc, getDocFromServer, getDocsFromServer, getFirestore,
    limit, query, serverTimestamp, setDoc, terminate, where } = await import('firebase/firestore');
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
    const { confirmQuoteAndGenerateProject } = await loadConfirmationService(db);
    const meta = {
      ownerUid: uid, createdBy: actor, updatedBy: actor, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    const totalValue = 12_000;
    const startDate = '2027-01-15';
    const clientRef = doc(collection(db, 'clients'));
    await setDoc(clientRef, { ...meta, name: 'Cliente do teste', origin: 'Indicação', status: 'Potencial' });
    const matching = (name, projectId) => getDocsFromServer(query(collection(db, name),
      where('ownerUid', '==', uid), where('projectId', '==', projectId), limit(100)));

    for (const installmentsCount of [4, 36]) {
      const quoteRef = doc(collection(db, 'quotes'));
      await setDoc(quoteRef, {
        ...meta, code: 'TESTE', title: 'Confirmação no emulador', clientId: clientRef.id, clientName: 'Cliente do teste',
        type: 'Reforma', status: 'Em negociação', estimatedMonths: 4, totalValue, downPaymentPct: 40, installmentsCount,
      });

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
  } finally {
    await terminate(db);
    await deleteApp(app);
  }
});
