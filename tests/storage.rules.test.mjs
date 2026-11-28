import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';

const projectId = 'demo-pilotis';
const bucketName = projectId + '.appspot.com';
const email = 'gabrielmaxgestor@gmail.com';
const onlyEmulators = !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST;

test('anexos de conformidade usam Storage privado com versões e migração verificada', { skip: onlyEmulators }, async () => {
  const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST.replace(/^https?:\/\//, '');
  assert.match(storageHost, /^(localhost|127\.0\.0\.1):\d+$/);
  assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(localhost|127\.0\.0\.1):\d+$/);
  const { tsImport } = await import('tsx/esm/api');
  const { createComplianceAttachmentStore } = await tsImport('../src/server/complianceAttachmentStore.ts', import.meta.url);
  const { createComplianceAttachmentRouter } = await tsImport('../src/server/complianceAttachmentRoutes.ts', import.meta.url);
  const { createPdfDocument } = await tsImport('../src/domain/pdfDocument.ts', import.meta.url);
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
  const { getStorage: adminStorage } = await import('firebase-admin/storage');
  const { initializeApp: initializeAdmin, deleteApp: deleteAdmin } = await import('firebase-admin/app');
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { connectStorageEmulator, deleteObject, getStorage, getMetadata, list, ref, uploadBytes } = await import('firebase/storage');
  const { connectFirestoreEmulator, doc, getDocFromServer, getFirestore: getClientDb, setDoc, terminate } = await import('firebase/firestore');
  const express = (await import('express')).default;
  const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  const dbName = config.firestore[0].database;
  const admin = initializeAdmin({ projectId, storageBucket: bucketName }, 'compliance-storage');
  const bucket = adminStorage(admin).bucket();
  const db = getFirestore(admin, dbName);
  const store = createComplianceAttachmentStore(db, bucket);
  const uid = 'compliance-' + randomUUID();
  const actor = 'Sócio';
  const project = 'test-project-' + randomUUID();
  const item = 'test-item-' + randomUUID();
  const other = 'other-item-' + randomUUID();
  const clientApps = [];
  const signed = { sub: uid, email, email_verified: true };
  const tokenType = { company: { uid, email, email_verified: true }, foreign: { uid, email: 'other@example.invalid', email_verified: true },
    isolated: { uid: 'isolated', email, email_verified: true } };
  const server = express();
  server.use('/api/compliance-attachments', createComplianceAttachmentRouter({
    store: () => store, authorizedEmail: email, verifyToken: async (token) => tokenType[token] ?? {},
  }));
  const http = server.listen(0, '127.0.0.1');
  if (!http.listening) await new Promise((resolve) => http.once('listening', resolve));
  const url = 'http://127.0.0.1:' + http.address().port + '/api/compliance-attachments/';
  const request = (path, body, token = 'company') => fetch(url + path, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  function client(name, mockUserToken) {
    const app = initializeApp({ projectId, storageBucket: bucketName }, name);
    clientApps.push(app);
    const storage = getStorage(app);
    const [host, port] = storageHost.split(':');
    connectStorageEmulator(storage, host, Number(port), mockUserToken ? { mockUserToken } : {});
    return { app, storage };
  }
  const permission = { code: 'storage/unauthorized' };
  const meta = { ownerUid: uid, createdBy: actor, updatedBy: actor, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
  const data = { title: 'Contrato do teste', status: 'Anexado', category: 'Contrato', kind: 'Documento de obra',
    projectId: project, competence: '', dueDate: '', issuedDate: '', fileName: '', mandatory: true, notes: '' };
  const text = 'q\n' + '% ' + 'x'.repeat(5 * 1024 * 1024) + '\nQ\n';
  const pdf = Buffer.from(createPdfDocument(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    '<< /Length ' + text.length + ' >>\nstream\n' + text + 'endstream']));
  const legacy = Buffer.from('%PDF-1.4\n% versão legada do teste\n%%EOF');
  const upload = { actor, name: '../../Contrato Valença.PDF', editing: false, expectedAttachment: '', draft: data, base64: pdf.toString('base64') };
  try {
    await db.doc('projects/' + project).set({ ...meta, name: 'Obra do teste' });
    await db.doc('complianceItems/' + other).set({ ...meta, ...data, attachmentId: 'old-test-attachment', fileName: 'Certidão anterior.pdf' });
    await db.doc('complianceFiles/old-test-attachment').set({ ...meta, itemId: other, name: 'Certidão anterior.pdf',
      mimeType: 'application/pdf', content: legacy });
    assert.equal((await request(item, upload, 'foreign')).status, 401);
    assert.equal((await request(item, { ...upload, base64: Buffer.from('HTML renomeado').toString('base64') })).status, 400);
    const created = await request(item, upload);
    assert.equal(created.status, 201, await created.clone().text());
    const saved = await created.json();
    const fileRef = db.doc('complianceFiles/' + saved.attachmentId);
    const file = (await fileRef.get()).data();
    assert.equal(file.name, 'Contrato-Valenca.pdf');
    assert.equal(file.sizeBytes, pdf.length);
    assert.equal(file.content, undefined);
    assert.equal(file.storagePath, ['complianceAttachments', uid, project, item, saved.attachmentId, file.name].join('/'));
    assert.equal((await request(other + '/' + saved.attachmentId)).status, 404);
    assert.equal((await request(item + '/' + saved.attachmentId, undefined, 'isolated')).status, 404);
    const downloaded = await request(item + '/' + saved.attachmentId);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get('cache-control'), /no-store/);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pdf);
    const owner = client('attachment-owner', signed);
    const guest = client('attachment-guest');
    const foreign = client('attachment-foreign', { ...signed, email: 'other@example.invalid' });
    const unverified = client('attachment-unverified', { ...signed, email_verified: false });
    const isolated = client('attachment-isolated', { ...signed, sub: 'isolated' });
    assert.equal((await getMetadata(ref(owner.storage, file.storagePath))).size, pdf.length);
    for (const outsider of [guest, foreign, unverified, isolated]) await assert.rejects(getMetadata(ref(outsider.storage, file.storagePath)), permission);
    await assert.rejects(list(ref(owner.storage, 'complianceAttachments/' + uid), { maxResults: 5 }), permission);
    await assert.rejects(uploadBytes(ref(owner.storage, file.storagePath), legacy, { contentType: 'application/pdf' }), permission);
    await assert.rejects(deleteObject(ref(owner.storage, file.storagePath)), permission);
    const prefix = ['complianceAttachments', uid, project, item, 'rules'].join('/');
    for (const [name, type, bytes] of [['fora-do-limite.pdf', 'application/pdf', Buffer.alloc(10 * 1024 * 1024 + 1)],
      ['tipo-errado.pdf', 'text/html', legacy], ['extensao.png', 'application/pdf', legacy], ['nome inválido.pdf', 'application/pdf', legacy]]) {
      await bucket.file(prefix + '/' + name).save(bytes, { resumable: false, metadata: { contentType: type } });
      await assert.rejects(getMetadata(ref(owner.storage, prefix + '/' + name)), permission);
    }

    const clientDb = getClientDb(owner.app, dbName);
    const [dbHost, dbPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    connectFirestoreEmulator(clientDb, dbHost, Number(dbPort), { mockUserToken: signed });
    try {
      const clientFile = doc(clientDb, 'complianceFiles', 'old-test-attachment');
      assert.ok((await getDocFromServer(clientFile)).exists());
      await assert.rejects(setDoc(doc(clientDb, 'complianceFiles', 'direct'), { content: 'blocked' }), { code: 'permission-denied' });
    } finally { await terminate(clientDb); }

    const replacement = { ...upload, editing: true, expectedAttachment: saved.attachmentId, name: 'Contrato atualizado.pdf', base64: legacy.toString('base64') };
    const replaced = await request(item, replacement);
    assert.equal(replaced.status, 201);
    const next = await replaced.json();
    assert.notEqual(next.attachmentId, saved.attachmentId);
    assert.equal((await request(item, replacement)).status, 409);
    assert.equal((await request(item + '/' + saved.attachmentId)).status, 200);
    assert.equal((await request(item + '/' + next.attachmentId + '/remove', { actor })).status, 204);
    const listResult = await (await request(item)).json();
    assert.equal(listResult.activeId, '');
    assert.equal(listResult.versions.length, 2);
    assert.ok(listResult.versions.find((v) => v.id === next.attachmentId).removedAt);
    assert.equal((await db.doc('complianceItems/' + item).get()).get('status'), 'Pendente');
    assert.equal((await request(item + '/' + next.attachmentId)).status, 200);

    const oldPath = other + '/old-test-attachment';
    assert.deepEqual(Buffer.from(await (await request(oldPath)).arrayBuffer()), legacy);
    const dryRun = await store.migrate(uid, actor, false);
    assert.equal(dryRun.totals.ready, 1);
    assert.ok((await db.doc('complianceFiles/old-test-attachment').get()).get('content'));
    const migrated = await store.migrate(uid, actor, true);
    assert.equal(migrated.totals.migrated, 1, JSON.stringify(migrated));
    assert.equal(migrated.totals.failed, 0);
    const migratedFile = (await db.doc('complianceFiles/old-test-attachment').get()).data();
    assert.equal(migratedFile.content, undefined);
    assert.deepEqual(Buffer.from(await (await request(oldPath)).arrayBuffer()), legacy);
    assert.equal((await store.migrate(uid, actor, true)).totals.migrated, 0);
    if (process.env.PILOTIS_MIGRATION_REPORT) {
      await writeFile(process.env.PILOTIS_MIGRATION_REPORT, JSON.stringify({ environment: 'Emuladores Firebase', ...migrated }, null, 2) + '\n');
    }
  } finally {
    await new Promise((resolve) => http.close(resolve));
    await Promise.all(clientApps.map(deleteApp));
    await deleteAdmin(admin);
  }
});
