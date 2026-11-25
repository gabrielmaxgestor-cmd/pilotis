import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStageDelay, validateStageWorkflow, validateWorkInProgressLimit } from '../projectOperations';
import { resolveTeamWeek } from '../teamPlanning';
import type { Allocation, Employee, ProjectStage } from '../../types/pilotis';

const actor = 'Sócio' as const;
const meta = { ownerUid: 'company', createdBy: actor, updatedBy: actor };
const stage = (id: string, change: Partial<ProjectStage> = {}): ProjectStage => ({
  ...meta, id, projectId: 'work', wbsCode: id, phase: 'Execução', name: id, responsible: '',
  durationWeeks: 1, startWeek: 0, baselineStartWeek: 0, baselineDurationWeeks: 1, progressPct: 0,
  budgetedCost: 0, popId: '', dependsOn: [], isMilestone: false, status: 'A fazer', materialExpectedDate: '',
  delayCategory: '', delayJustification: '', checklistCompleted: [], ...change,
});

test('a dependência precisa estar concluída e o limite conta as etapas de todas as fases', () => {
  const previous = stage('Instalação', { dependsOn: ['Estrutura'] });
  const started = { ...previous, status: 'Em andamento' as const };
  const predecessor = stage('Estrutura');
  assert.throws(() => validateStageWorkflow(started, previous, [predecessor], {}), /Estrutura/);
  const complete = { ...predecessor, status: 'Concluída' as const };
  const ongoing = stage('Outra fase', { phase: 'Revestimento', status: 'Em andamento' });
  assert.throws(() => validateStageWorkflow(started, previous, [complete, ongoing], { workInProgressLimit: 1 }), /Limite de 1/);
  assert.doesNotThrow(() => validateStageWorkflow(started, previous, [complete, ongoing], { workInProgressLimit: 2 }));
  assert.throws(() => validateWorkInProgressLimit(0), /entre 1 e 100/);
});

test('concluir confere o conteúdo do POP e impede invalidar uma predecessora em uso', () => {
  const complete = stage('Estrutura', { status: 'Concluída', popId: 'pop', checklistCompleted: ['A', 'Duplicado'] });
  const pop = { acceptanceCriteria: ['A', 'B'] };
  assert.throws(() => validateStageWorkflow(complete, undefined, [], {}, pop), /todos os critérios/);
  assert.doesNotThrow(() => validateStageWorkflow({ ...complete, checklistCompleted: ['A', 'B'] }, undefined, [], {}, pop));
  const successor = stage('Instalação', { dependsOn: [complete.id], status: 'Em andamento' });
  assert.throws(() => validateStageWorkflow({ ...complete, status: 'A fazer' }, complete, [successor], {}), /Instalação/);
});

test('atraso exige uma categoria permitida e uma justificativa preenchida', () => {
  assert.throws(() => validateStageDelay(stage('Etapa'), true), /categoria e a justificativa/);
  assert.throws(() => validateStageDelay(stage('Etapa', { delayCategory: 'Chuva', delayJustification: '  ' }), false), /justificativa/);
  assert.doesNotThrow(() => validateStageDelay(stage('Etapa', { delayCategory: 'Retrabalho', delayJustification: 'Revisar instalação' }), true));
});

test('a equipe resolve a etapa da semana e detecta atribuições em conflito', () => {
  const employee = { ...meta, id: 'worker', name: 'Teste', currentProjectId: 'work', startDate: '2026-01-01' } as Employee;
  const week = '2026-11-23';
  const one: Allocation = { ...meta, id: 'one', employeeId: employee.id, employeeName: employee.name,
    projectId: 'work', projectName: 'Obra', stageId: 'first', weekStart: week, status: 'Obra' };
  const data = { employees: [employee], projects: [{ id: 'work', name: 'Obra', type: 'Reforma' as const, status: 'Em execução' as const }], allocations: [one] };
  assert.equal(resolveTeamWeek(employee, week, data).allocation?.stageId, 'first');
  assert.equal(resolveTeamWeek(employee, week, data).conflict, false);
  assert.equal(resolveTeamWeek(employee, week, { ...data, allocations: [one, { ...one, stageId: 'second' }] }).conflict, true);
});
