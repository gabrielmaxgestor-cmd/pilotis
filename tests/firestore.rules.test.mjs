import assert from 'node:assert/strict';
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
