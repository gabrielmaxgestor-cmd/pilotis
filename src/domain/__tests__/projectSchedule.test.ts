import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateScheduleBudget,
  calcularCurvaSObra,
  calcularDreObra,
  describeScheduleCycle,
  getProjectSchedule,
  getRecordedScheduleProgress,
  getScheduleBaselineStages,
  scheduleDeliveryVariance,
  validateReplanJustification,
  getWorkPackageBudget,
} from '../index';
import type { Project, ProjectStage, ScheduleBaseline, ScheduleProgress } from '../../types/pilotis';

const audit = { ownerUid: 'test', createdBy: 'Sócio', updatedBy: 'Sócio' } as const;
const project: Project = {
  ...audit, id: 'work', name: 'Obra de teste', quoteId: '', clientId: '', clientName: '',
  type: 'Reforma', status: 'Em execução', contractValue: 400,
  budgetedLabor: 100, budgetedSubcontract: 50, budgetedEquipment: 0, budgetedBdi: 0, budgetedTax: 0,
  startDate: '2026-01-05', baselineEndDate: '2026-02-02', forecastEndDate: '2026-02-02',
  contractSigned: false, warrantyStartDate: '',
};

function stage(id: string, fields: Partial<ProjectStage> = {}): ProjectStage {
  return {
    ...audit, id, projectId: project.id, wbsCode: id, phase: 'Execução', deliverable: 'Entrega',
    name: `Etapa ${id}`, responsible: '', startWeek: 0, durationWeeks: 2,
    baselineStartWeek: 0, baselineDurationWeeks: 2, progressPct: 0,
    budgetedCost: 50, popId: '', dependsOn: [], isMilestone: false, status: 'A fazer',
    materialExpectedDate: '', delayCategory: '', delayJustification: '', checklistCompleted: [],
    ...fields,
  };
}

test('a distribuição pelos pacotes fecha em centavos e alimenta a DRE da obra', () => {
  const costs = allocateScheduleBudget(123.47, [0.2, 0.5, 0.3, 0]);
  const stages = costs.map((budgetedCost, index) => stage(String(index), { budgetedCost }));
  assert.equal(costs[3], 0);
  assert.equal(getWorkPackageBudget(stages), 123.47);
  assert.equal(calcularDreObra(project, [], stages).custosTotais.orcado, 123.47);
  assert.equal(calcularDreObra(project, [], stages).ajusteEap.orcado, -26.53);
  assert.equal(calcularDreObra(project, []).custosTotais.orcado, 150);
  assert.equal(calcularDreObra(project, [], [stage('0', { budgetedCost: 0 })]).custosTotais.orcado, 0);
});

test('uma predecessora desloca o início, o marco e a entrega sem mudar a linha de base', () => {
  const stages = [
    stage('1', { durationWeeks: 3 }),
    stage('2', { startWeek: 2, baselineStartWeek: 2, dependsOn: ['1'] }),
    stage('3', { durationWeeks: 0, baselineDurationWeeks: 0, dependsOn: ['2'], isMilestone: true }),
  ];
  const schedule = getProjectSchedule(project, stages, '2026-01-12');
  assert.equal(schedule.referenceWeek, 1);
  assert.equal(schedule.details.get('2')?.inicioMaisCedo, 3);
  assert.equal(schedule.details.get('2')?.folga, 0);
  assert.equal(schedule.forecastEndDate, '2026-02-09');
  assert.equal(schedule.milestones[0]?.date, '2026-02-09');
  assert.equal(schedule.nextStage?.id, '1');
  assert.equal(project.baselineEndDate, '2026-02-02');
});

test('a mensagem identifica a sequência circular e orienta remover a ligação', () => {
  const stages = [stage('1', { dependsOn: ['2'] }), stage('2', { dependsOn: ['1'] })];
  assert.match(describeScheduleCycle(stages) ?? '', /1 Etapa 1 → 2 Etapa 2 → 1 Etapa 1.*Remova uma das ligações/);
  assert.equal(getProjectSchedule(project, stages).forecastEndDate, null);
  assert.equal(describeScheduleCycle([stage('1'), stages[1]]), null);
});

test('o índice usa o plano na data de referência e o progresso registrado', () => {
  const progress = calcularCurvaSObra([stage('1', { progressPct: 75, status: 'Em andamento' })], 1);
  assert.equal(progress.progressoPlanejadoPct, 50);
  assert.equal(progress.progressoRealizadoPct, 75);
  assert.equal(progress.indicePrazo, 1.5);
});

test('o atraso crítico muda a entrega e a nova versão mantém a referência original', () => {
  const original = [stage('1'), stage('2', { startWeek: 2, baselineStartWeek: 2, dependsOn: ['1'] })];
  const changed = [{ ...original[0], durationWeeks: 3 }, original[1]];
  const shifted = getProjectSchedule(project, changed, '2026-01-12');

  assert.equal(shifted.forecastEndDate, '2026-02-09');
  assert.equal(scheduleDeliveryVariance(shifted.forecastEndDate!, project.baselineEndDate), 7);
  assert.deepEqual(getScheduleBaselineStages(changed), getScheduleBaselineStages(original));
  assert.equal(getScheduleBaselineStages(changed, shifted)[1].startWeek, 3);
  assert.equal(project.baselineEndDate, '2026-02-02');
});

test('o replanejamento exige justificativa preenchida', () => {
  assert.throws(() => validateReplanJustification('   \n\t'), /Informe a justificativa/);
  assert.throws(() => validateReplanJustification('x'.repeat(501)), /500/);
  assert.equal(validateReplanJustification('  Aguardar os materiais.  '), 'Aguardar os materiais.');
});

test('a curva planejada continua usando o plano original quando novos pacotes são incluídos', () => {
  const initial = [stage('1')];
  const baseline: ScheduleBaseline = {
    ...audit, id: 'b1', projectId: project.id, version: 1, justification: '',
    endDate: '2026-01-19', recordedDate: '2026-01-05', stages: getScheduleBaselineStages(initial),
  };
  const revised = [...initial, stage('2', { startWeek: 2, baselineStartWeek: 2 })];
  assert.equal(calcularCurvaSObra(revised, 2, baseline).progressoPlanejadoPct, 100);
  assert.equal(calcularCurvaSObra(revised, 2).progressoPlanejadoPct, 50);
});

test('a curva realizada conserva o último registro de cada dia e o progresso corrente', () => {
  const sample = (date: string, scheduleRevision: number, progressPct: number): ScheduleProgress => ({
    ...audit, id: String(scheduleRevision), projectId: project.id, date, scheduleRevision, progressPct,
  });
  const samples = [
    sample('2026-01-12', 3, 30),
    sample('2026-01-12', 2, 20),
    sample('2026-01-26', 4, 45),
    sample('2026-02-02', 5, 95),
    { ...sample('2026-01-19', 8, 95), projectId: 'another' },
  ];
  assert.deepEqual(getRecordedScheduleProgress(project, samples, '2026-01-26', 50), [
    { date: '2026-01-12', week: 1, progressPct: 30 },
    { date: '2026-01-26', week: 3, progressPct: 50 },
  ]);
});
