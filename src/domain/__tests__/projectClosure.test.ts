import assert from 'node:assert/strict';
import test from 'node:test';
import { getClosureReview, getWarrantyWindow, summarizeWarrantyCalls } from '../projectClosure';
import { resolveTeamWeek } from '../teamPlanning';
import type { Allocation, ComplianceItem, Employee, FinancialTransaction, Installment, Pop, Project, ProjectStage, WarrantyCall } from '../../types/pilotis';

const meta = { ownerUid: 'company', createdBy: 'Sócio', updatedBy: 'Sócio' } as const;
const project: Project = {
  ...meta, id: 'work', name: 'Obra', quoteId: 'quote', clientId: '', clientName: '', type: 'Reforma',
  contractValue: 1000, budgetedLabor: 0, budgetedSubcontract: 0, budgetedEquipment: 0, budgetedBdi: 0, budgetedTax: 0,
  startDate: '2026-10-05', baselineEndDate: '', forecastEndDate: '', status: 'Em execução', contractSigned: true, warrantyStartDate: '',
};
const day = '2026-11-25';
const stage: ProjectStage = {
  ...meta, id: 'stage', projectId: project.id, wbsCode: '1', phase: 'Entrega', name: 'Entrega',
  responsible: '', startWeek: 0, durationWeeks: 1, baselineStartWeek: 0, baselineDurationWeeks: 1,
  status: 'Concluída', progressPct: 100, budgetedCost: 0, popId: 'pop', dependsOn: [], isMilestone: false,
  materialExpectedDate: '', delayCategory: '', delayJustification: '', checklistCompleted: ['Vistoria'],
};
const pop = { ...meta, id: 'pop', acceptanceCriteria: ['Vistoria'] } as Pop;
const installment = {
  ...meta, id: 'parcel', projectId: project.id, number: 1, amount: 1000, status: 'Recebida', receivedDate: day,
  invoiceStatus: 'Emitida', transactionId: 'payment',
} as Installment;
const income = {
  ...meta, id: 'payment', projectId: project.id, date: day, entryKind: 'income', status: 'Recebido',
  isForecast: false, amount: 1000, invoiceStatus: 'Emitida', installmentId: installment.id, source: 'manual',
} as FinancialTransaction;
const expense = {
  ...income, id: 'expense', amount: 250, entryKind: 'expense', status: 'Pago',
  invoiceStatus: 'Não se aplica', installmentId: undefined, category: 'Equipamentos',
} as FinancialTransaction;
const document = (title: string): ComplianceItem => ({
  ...meta, id: title, projectId: project.id, title, kind: 'Documento de obra', status: 'Anexado', fileName: 'documento.pdf',
} as ComplianceItem);
const data = {
  stages: [stage], pops: [pop], installments: [installment], transactions: [income, expense],
  complianceItems: [document('ART/RRT'), document('Matrícula CNO')],
};

test('encerramento confere requisitos e mantém DRE realizado até a data', () => {
  const result = getClosureReview(project, { ...data, transactions: [...data.transactions,
    { ...expense, id: 'future', date: '2026-11-26', amount: 20 },
    { ...expense, id: 'forecast', isForecast: true, amount: 20 },
  ] }, day);
  assert.equal(result.canClose, true);
  assert.equal(result.dre.receita.realizado, 1000);
  assert.equal(result.dre.custosTotais.realizado, 250);
  assert.equal(result.dre.resultado.realizado, 750);
  assert.equal(result.dre.margemRealizadaPct, 75);
});

test('nota pendente, documento sem arquivo e recebimento sem lançamento bloqueiam o encerramento', () => {
  const result = getClosureReview(project, { ...data, stages: [{ ...stage, checklistCompleted: [] }],
    transactions: [{ ...expense, invoiceStatus: 'A emitir' }],
    complianceItems: [{ ...document('ART/RRT'), fileName: '' }, document('Matrícula CNO')],
  }, day);
  assert.equal(result.canClose, false);
  assert.deepEqual(result.items.filter((item) => !item.cleared).map((item) => item.id), ['quality', 'installments', 'invoices', 'art']);
});

test('garantia de um ano e soma dos custos com centavos', () => {
  const closed: Project = { ...project, status: 'Concluída', warrantyStartDate: '2024-02-29', closureDate: '2024-02-29' };
  assert.deepEqual(getWarrantyWindow(closed, '2025-02-28'), { start: '2024-02-29', end: '2025-02-28', active: true });
  assert.equal(getWarrantyWindow(closed, '2025-03-01')?.active, false);
  assert.equal(summarizeWarrantyCalls([]).cost, null);
  assert.deepEqual(summarizeWarrantyCalls([{ cost: 100.01, status: 'Aberto' }, { cost: 235.98, status: 'Resolvido' }] as WarrantyCall[]), { cost: 335.99, open: 1 });
});

test('libera a equipe na semana do encerramento e conserva o histórico antes da entrega', () => {
  const employee = { ...meta, id: 'crew', currentProjectId: project.id } as Employee;
  const week = '2026-11-23';
  const allocation = { ...meta, id: 'before', employeeId: employee.id, weekStart: week, projectId: project.id, status: 'Obra' } as Allocation;
  const closed: Project = { ...project, status: 'Concluída', closureDate: day, warrantyStartDate: day };
  const next = { ...project, id: 'next' };
  const data = { employees: [employee], projects: [closed, next], allocations: [allocation] };
  assert.equal(resolveTeamWeek(employee, week, data).idle, true);
  assert.equal(resolveTeamWeek(employee, week, data, '2026-11-24').project?.id, project.id);
  const moved = { ...data, allocations: [allocation, { ...allocation, id: 'after', projectId: next.id, effectiveFrom: day }] };
  assert.equal(resolveTeamWeek(employee, week, moved, '2026-11-24').project?.id, project.id);
  assert.equal(resolveTeamWeek(employee, week, moved, day).project?.id, next.id);
});
