import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFieldStageUpdate, drainFieldJobs, getFieldStageFields, type FieldJob, type FieldStageUpdate } from '../fieldWork';
import type { ProjectStage } from '../../types/pilotis';

const actor = 'Sócio';
const stage: ProjectStage = {
  id: 'stage', ownerUid: 'company', createdBy: actor, updatedBy: actor, projectId: 'project',
  wbsCode: '1', phase: 'Estrutura', name: 'Fundação', responsible: '', status: 'A fazer',
  durationWeeks: 1, startWeek: 0, baselineStartWeek: 0, baselineDurationWeeks: 1,
  progressPct: 0, budgetedCost: 0, popId: 'pop', dependsOn: [], isMilestone: false,
  materialExpectedDate: '', delayCategory: '', delayJustification: '', checklistCompleted: [],
};

const update = (next: FieldStageUpdate['next'], complete = false): FieldStageUpdate => ({
  previous: getFieldStageFields(stage), next, popId: 'pop', complete,
});

test('edita somente os campos registrados e preserva outras mudanças na etapa', () => {
  const latest = { ...stage, responsible: 'Equipe', materialExpectedDate: '2026-12-01' };
  const started = applyFieldStageUpdate(latest, update({ progressPct: 30 }));
  assert.equal(started.progressPct, 30);
  assert.equal(started.status, 'Em andamento');
  assert.equal(started.responsible, 'Equipe');
  assert.equal(started.materialExpectedDate, '2026-12-01');
  assert.throws(() => applyFieldStageUpdate(latest, update({ materialExpectedDate: '2026-12-02' })), /etapa mudou/i);
  assert.equal(applyFieldStageUpdate(started, update({ progressPct: 30 })).progressPct, 30);
});

test('a conclusão exige revisão se o POP mudar e registra 100% quando aplicada', () => {
  const completion = update({ checklistCompleted: ['Conferência'] }, true);
  assert.throws(() => applyFieldStageUpdate({ ...stage, popId: 'updated' }, completion), /POP vinculado mudou/);
  const done = applyFieldStageUpdate(stage, completion);
  assert.equal(done.status, 'Concluída');
  assert.equal(done.progressPct, 100);
  assert.deepEqual(done.checklistCompleted, ['Conferência']);
});

const diary: FieldJob = {
  id: 'log', uid: 'company', actor, queuedAt: 0, kind: 'diary',
  draft: { projectId: 'project', date: '2026-11-25', presentCount: 2, weather: 'Sol', activities: 'Conferência', occurrences: '' },
  photos: [{ id: 'photo', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) }],
};

test('reconectar envia o diário com a foto e remove a fila somente depois da confirmação', async () => {
  let online = false;
  const steps: string[] = [];
  const process = () => drainFieldJobs([diary], async (record) => {
    assert.equal(record.kind, 'diary');
    if (record.kind === 'diary') assert.equal(record.photos[0].blob.size, 3);
    steps.push('enviado');
  }, async (id) => { steps.push('confirmado ' + id); }, async () => { assert.fail('registro rejeitado'); }, () => online);
  await process();
  assert.deepEqual(steps, []);
  online = true;
  await process();
  assert.deepEqual(steps, ['enviado', 'confirmado log']);
});

test('bloqueio numa etapa mantém a sequência e permite sincronizar visitas de outras etapas e do diário', async () => {
  const first: FieldJob = { id: 'first', uid: 'company', actor, queuedAt: 1, kind: 'stage',
    projectId: 'project', stageId: 'stage', knownStageIds: ['stage'], update: update({ progressPct: 30 }) };
  const second = { ...first, id: 'second' };
  const acknowledgments: string[] = [];
  const rejected: string[] = [];
  await drainFieldJobs([first, second, diary], async (job) => {
    if (job.id === 'first') throw new Error('POP alterado');
  }, async (id) => { acknowledgments.push(id); }, async (job) => { rejected.push(job.id); }, () => true);
  assert.deepEqual(acknowledgments, ['log']);
  assert.deepEqual(rejected, ['first']);
});

test('falhas temporárias mantêm o registro pronto para reconexão', async () => {
  await drainFieldJobs([diary], async () => {
    throw Object.assign(new Error('Conexão instável'), { code: 'firestore/unavailable' });
  }, async () => { assert.fail('registro perdido'); }, async () => { assert.fail('falha temporária marcada como bloqueio'); }, () => true);
});
