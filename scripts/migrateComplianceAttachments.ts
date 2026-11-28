import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { COMPLIANCE_ID } from '../src/domain/complianceAttachments.ts';
import { createComplianceAttachmentStore } from '../src/server/complianceAttachmentStore.ts';

const { values } = parseArgs({ options: {
  owner: { type: 'string' }, report: { type: 'string' }, apply: { type: 'boolean' },
} });
if (!values.owner || !COMPLIANCE_ID.test(values.owner) || !values.report) {
  throw new Error('Use --owner UID_DA_CONTA --report caminho.json e acrescente --apply para migrar.');
}
const config = JSON.parse(await readFile(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
if (!config.projectId || !config.firestoreDatabaseId || !config.storageBucket) {
  throw new Error('Configure o projeto, o banco nomeado e o bucket do Firebase.');
}
const app = initializeApp({ projectId: config.projectId, storageBucket: config.storageBucket, credential: applicationDefault() });
try {
  const store = createComplianceAttachmentStore(getFirestore(app, config.firestoreDatabaseId), getStorage(app).bucket());
  const report = await store.migrate(values.owner, 'Responsável administrativo', Boolean(values.apply));
  await writeFile(values.report, JSON.stringify({ project: config.projectId, database: config.firestoreDatabaseId, ...report }, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify(report.totals) + '\nRelatório salvo em ' + values.report + '\n');
  if (report.totals.failed) process.exitCode = 1;
} finally { await deleteApp(app); }
