import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerMaterialTemplate, withMaterialHold } from '../customerMaterials';
import { getProjectSchedule } from '../pilotisAdapters';
import { createPurchasingSchedulePdf } from '../purchasingSchedulePdf';
import { pdfText } from '../pdfDocument';
import { calcularPainelDashboard } from '../dashboard';
import type { CustomerMaterial, PilotisDataState, Project, ProjectStage } from '../../types/pilotis';

const project = { id: 'work', name: 'Reforma em teste', type: 'Reforma', status: 'Em execução', startDate: '2026-11-30' } as Project;
const today = '2026-11-20';
function stage(id: string, name: string, startWeek: number, durationWeeks: number, dependsOn: string[] = []): ProjectStage {
  return { id, wbsCode: id, name, projectId: project.id, startWeek, durationWeeks, dependsOn,
    status: 'A fazer', phase: name, budgetedCost: 0, progressPct: 0,
    baselineStartWeek: startWeek, baselineDurationWeeks: durationWeeks } as ProjectStage;
}
function material(id: string, stageId: string, promisedDate: string, leadDays = 2): CustomerMaterial {
  return { id, projectId: project.id, stageId, description: 'Tubos hidráulicos', promisedDate, leadDays,
    deliveredDate: '', status: 'Comprado', quantity: 12, unit: 'm', clientContact: 'Cliente', notes: '' } as CustomerMaterial;
}
const first = stage('1', 'Instalações hidráulicas e elétricas', 0, 1);
const second = stage('2', 'Revestimentos e pisos', 1, 1, ['1']);
const stages = [first, second];

test('promessa depois da data necessária desloca a etapa e a entrega pelo CPM', () => {
  const items = [material('pipe', first.id, '2026-12-02'), material('other', first.id, '2026-12-01')];
  const schedule = getProjectSchedule(project, stages, today, items);
  const pipe = schedule.materials.rows.find((row) => row.item.id === 'pipe');
  assert.equal(pipe?.necessaryDate, '2026-11-28');
  assert.equal(pipe?.estimatedWaitDays, 4);
  assert.equal(schedule.forecastEndDate, '2026-12-18');
  assert.equal(schedule.materials.deliveryImpactDays, 4);
  assert.equal(Math.round((schedule.details.get(second.id)?.inicioAntesDaRestricao ?? 0) * 7), 11);
  assert.equal(withMaterialHold(first, schedule.materials.blockedStages).status, 'Aguardando material');
  assert.equal(withMaterialHold(first, schedule.materials.blockedStages).delayCategory, 'Material do cliente');
  assert.equal(first.status, 'A fazer');
});

test('a folga absorve atrasos em um ramo e a entrega efetiva libera a etapa mantendo o atraso medido', () => {
  const parallel = stage('3', 'Pintura', 0, 1);
  const slip = material('paint', parallel.id, '2026-11-30');
  assert.equal(getProjectSchedule(project, [...stages, parallel], today, [slip]).materials.deliveryImpactDays, 0);
  const pipe = { ...material('pipe', first.id, '2026-12-02'), status: 'Entregue' as const, deliveredDate: '2026-12-02' };
  const schedule = getProjectSchedule(project, stages, '2026-12-02', [pipe]);
  assert.equal(schedule.materials.deliveryImpactDays, 4);
  assert.equal(schedule.materials.blockedStages.has(first.id), false);
  const unknown = getProjectSchedule(project, stages, '2026-11-29', [material('none', first.id, '')]);
  assert.equal(unknown.materials.rows[0].status, 'Atrasado');
  assert.equal(unknown.materials.deliveryImpactDays, 1);
});

test('o dashboard aponta o atraso e o PDF apresenta a data necessária e a prometida', () => {
  const items = [material('pipe', first.id, '2026-12-02')];
  const data = { projects: [project], stages, customerMaterials: items, clients: [], quotes: [], installments: [],
    transactions: [], debts: [], employees: [], allocations: [], settings: null, complianceItems: [], warrantyCalls: [],
    auditLogs: [], pops: [], tenders: [], dailyLogs: [] } satisfies PilotisDataState;
  const dashboard = calcularPainelDashboard(data, today);
  assert.equal(dashboard.work[0].delayedStagesCount, 1);
  assert.equal(dashboard.work[0].completion, '2026-12-18');
  assert.ok(dashboard.alerts.some((alert) => alert.categoria === 'material' && alert.obraId === project.id));
  const { materials } = getProjectSchedule(project, stages, today, items);
  const content = new TextDecoder().decode(createPurchasingSchedulePdf({ companyName: 'Pilotis', projectName: project.name, date: today, rows: materials.rows }));
  assert.match(content, /^%PDF-1\.4/);
  assert.ok(content.includes(pdfText('Necessária: 28/11/2026 | Prometida: 02/12/2026 | Situação: Atrasado')));
});

test('o modelo vincula etapas compatíveis e deixa as quantidades e promessas a confirmar', () => {
  const rows = customerMaterialTemplate(project.type, stages, [], 5);
  assert.deepEqual(rows.map((row) => row.stageId), ['1', '2']);
  assert.ok(rows.every((row) => row.quantity === null && row.promisedDate === '' && row.leadDays === 5));
  assert.equal(customerMaterialTemplate(project.type, stages, [{ ...material('test', '1', ''), templateKey: rows[0].templateKey }], 5).length, 1);
});
