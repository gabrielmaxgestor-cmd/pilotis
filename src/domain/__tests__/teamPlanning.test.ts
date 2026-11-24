import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planMonthlyPayroll, resolveTeamWeek } from '../teamPlanning';
import { resumoFolhaEquipe } from '../equipe';
import type { Allocation, Employee, Project } from '../../types/pilotis';

const audit = { ownerUid: 'company', createdBy: 'Sócio', updatedBy: 'Sócio' } as const;
const employee = {
  ...audit, id: 'emp', name: 'Pessoa', employmentType: 'CLT', baseSalary: 3000,
  startDate: '2026-01-01', paymentMethod: 'PIX', currentProjectId: '',
} as Employee;
const project = { id: 'site', name: 'Obra', type: 'Reforma', status: 'Em execução' } as Project;
const assignment = {
  ...audit, id: 'alloc', employeeId: 'emp', projectId: 'site',
  weekStart: '2026-11-02', status: 'Obra',
} as Allocation;
const rates = { inssPct: 10, fgtsPct: 5, feriasPct: 10, decimoTerceiroPct: 5, vigenciaInicio: '2026-01-01' };

test('reparte remuneração, encargos e provisões entre obra e Empresa', () => {
  const result = planMonthlyPayroll({ employees: [employee], allocations: [assignment], projects: [project] }, '2026-11', rates);
  const line = result.lines.find((item) => item.projectId === 'site');
  assert.equal(line?.base, 700);
  assert.equal(line?.charges, 105);
  assert.equal(line?.provisions, 105);
  assert.equal(result.totalKnown, 3900);
  assert.equal(result.centers.find((center) => center.id === 'site')?.amount, 910);
});

test('férias parciais retiram somente os dias programados da obra', () => {
  const person = { ...employee, vacationStart: '2026-11-05', vacationEnd: '2026-11-06' };
  const data = { employees: [person], allocations: [assignment], projects: [project] };
  assert.equal(resolveTeamWeek(person, assignment.weekStart, data).label, 'Férias');
  const result = planMonthlyPayroll(data, '2026-11', rates);
  assert.equal(result.lines.find((item) => item.projectId === 'site')?.base, 500);
  assert.equal(result.lines.find((item) => item.vacation)?.base, 200);
  assert.equal(result.totalKnown, 3900);
});

test('conflitos e encargos ausentes aparecem sem estimar alíquotas', () => {
  const data = { employees: [employee], projects: [project], allocations: [
    assignment, { ...assignment, id: 'conflict', projectId: 'Sem obra' },
  ] };
  const result = planMonthlyPayroll(data, '2026-11', null);
  assert.equal(result.configured, false);
  assert.equal(result.provisions, null);
  assert.deepEqual(result.conflicts, ['Pessoa']);
  assert.equal(result.totalKnown, 3000);
});

test('pagamento avulso tem competência única e o pró-labore é fixo', () => {
  const partner = { ...employee, id: 'partner', employmentType: 'Sócio' as const, baseSalary: 2500 };
  const contractor = { ...employee, employmentType: 'PJ' as const, baseSalary: 100,
    paymentFrequency: 'oneOff' as const, paymentMonth: '2026-11' };
  const data = { employees: [partner, contractor], allocations: [], projects: [] };
  assert.equal(planMonthlyPayroll(data, '2026-11', null).totalKnown, 2600);
  const december = planMonthlyPayroll(data, '2026-12', null);
  assert.equal(december.totalKnown, 2500);
  assert.equal(december.lines[0].category, 'Pró-labore');
  assert.equal(resumoFolhaEquipe([
    { vinculo: 'PJ', salarioBase: 100, paymentFrequency: 'oneOff' },
    { vinculo: 'Autônomo', salarioBase: 200, paymentFrequency: 'monthly' },
    { vinculo: 'PJ', salarioBase: 300, paymentFrequency: 'monthly' },
  ], null).recorrentesNaoCltCount, 2);
});
