import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateScheduleBudget,
  calcularCurvaSObra,
  calcularDreObra,
  describeScheduleCycle,
  getProjectSchedule,
  getWorkPackageBudget,
} from '../index';
import type { Project, ProjectStage } from '../../types/pilotis';

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
