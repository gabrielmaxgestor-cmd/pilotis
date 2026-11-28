import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PilotisDataState } from '../../types/pilotis';
import { agendaDays, agendaEventsInPeriod, agendaPeriod, buildAgendaEvents } from '../agenda';
import { buildAgendaCalendar } from '../calendarExport';

const data = {
  settings: null, clients: [], quotes: [],
  projects: [
    { id: 'work', name: 'Reforma', status: 'Em execução', startDate: '2026-11-23', forecastEndDate: '2027-01-01' },
    { id: 'finished', name: 'Obra concluída', status: 'Concluída', closureDate: '2025-11-28', warrantyStartDate: '2025-11-28' },
  ],
  installments: [
    { id: 'parcel', number: 1, label: '1/4', dueDate: '2026-11-27', status: 'Recebida', projectId: 'work', transactionId: 'receipt' },
  ],
  stages: [
    { id: 'stage', projectId: 'work', wbsCode: '1', name: 'Fundação', status: 'A fazer', startWeek: 0, durationWeeks: 1, dependsOn: [], progressPct: 0, materialExpectedDate: '2026-11-25' },
    { id: 'mile', projectId: 'work', wbsCode: '2', name: 'Inspeção', status: 'A fazer', startWeek: 0, durationWeeks: 0, dependsOn: ['stage'], isMilestone: true, progressPct: 0 },
  ],
  transactions: [
    { id: 'bill', entryKind: 'expense', description: 'Aluguel R$ 9.900,00', dueDate: '2026-11-27', date: '2026-11-20', amount: 9900, isForecast: true, status: 'A vencer', projectId: 'work' },
    { id: 'receipt', entryKind: 'income', dueDate: '2026-11-27', status: 'Recebido', isForecast: false, installmentId: 'parcel' },
    { id: 'reversed', entryKind: 'expense', dueDate: '2026-11-27', status: 'Estornado', isForecast: false },
  ],
  debts: [{ id: 'debt', creditor: 'Banco', nextDueDate: '2026-11-30', status: 'Em uso' }],
  employees: [{ id: 'person', name: 'Colaborador', employmentType: 'CLT', currentProjectId: 'work',
    vacationStart: '2026-11-29', vacationEnd: '2026-12-02', nr18Expiry: '2026-11-27' }],
  allocations: [{ id: 'leave', employeeId: 'person', weekStart: '2026-12-07', status: 'Férias', projectId: '' }],
  complianceItems: [
    { id: 'guide', kind: 'Obrigação', title: 'Guia', dueDate: '2026-11-27', status: 'Pendente' },
    { id: 'certificate', kind: 'Certidão', title: 'Certidão', dueDate: '2026-11-28', status: 'Válida', projectId: 'work' },
    { id: 'invalid', kind: 'Obrigação', title: 'Data inválida', dueDate: '2026-11-31', status: 'Pendente' },
  ],
  warrantyCalls: [{ id: 'call', projectId: 'finished', description: 'Visita', deadlineDate: '2026-11-26', status: 'Aberto' }],
  pops: [], tenders: [], dailyLogs: [], auditLogs: [],
} as unknown as PilotisDataState;

test('a agenda usa vencimentos dos módulos e aponta para o registro original', () => {
  const events = buildAgendaEvents(data, '2026-11-27');
  const byId = new Map(events.map((row) => [row.id, row]));
  assert.deepEqual(byId.get('installment-parcel')?.target, { module: 'financial', tab: 'A receber', params: { registro: 'parcel' } });
  assert.equal(byId.get('bill-bill')?.target.tab, 'A pagar');
  assert.equal(byId.get('debt-debt')?.target.tab, 'Dívidas e crédito');
  assert.equal(byId.get('compliance-guide')?.target.tab, 'Obrigações');
  assert.equal(byId.get('compliance-certificate')?.target.tab, 'Certidões');
  assert.equal(byId.get('stage-stage')?.start, '2026-11-30');
  assert.equal(byId.get('stage-mile')?.type, 'milestone');
  assert.equal(byId.get('material-stage')?.start, '2026-11-25');
  assert.equal(byId.get('warranty-finished')?.start, '2026-11-28');
  assert.equal(byId.get('call-call')?.target.params.registro, 'call');
  assert.equal(byId.get('training-nr18-person')?.target.params['team.colaborador'], 'person');
  assert.equal(byId.get('allocation-leave')?.end, '2026-12-13');
  assert.ok(!events.some((row) => /receipt|reversed|invalid/.test(row.id)));
});

test('semana começa na segunda e férias atravessam o limite do mês', () => {
  const events = buildAgendaEvents(data, '2026-11-27');
  const week = agendaPeriod('2026-11-29', 'week');
  assert.deepEqual(week, { start: '2026-11-23', end: '2026-11-29' });
  assert.equal(agendaDays(week).length, 7);
  const month = agendaPeriod('2026-12-01', 'month');
  assert.equal(agendaDays(month, true)[0], '2026-11-30');
  assert.equal(agendaDays(month, true).length % 7, 0);
  assert.deepEqual(agendaEventsInPeriod(events, month, 'vacation', 'work').map((row) => row.id), ['vacation-person']);
  assert.deepEqual(agendaEventsInPeriod(events, month, 'vacation', 'Empresa').map((row) => row.id), ['allocation-leave']);
});

test('o ICS usa datas de dia inteiro, fim exclusivo e campos sem valores financeiros', () => {
  const events = buildAgendaEvents(data, '2026-11-27');
  const picked = events.filter((row) => ['bill-bill', 'vacation-person'].includes(row.id));
  const file = buildAgendaCalendar(picked, new Date('2026-11-27T20:10:00Z'));
  assert.match(file, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(file, /UID:bill-bill@agenda\.pilotis\r\nDTSTAMP:20261127T201000Z/);
  assert.match(file, /DTSTART;VALUE=DATE:20261127\r\nDTEND;VALUE=DATE:20261128/);
  assert.match(file, /DTSTART;VALUE=DATE:20261129\r\nDTEND;VALUE=DATE:20261203/);
  assert.match(file, /SUMMARY:Vencimento de conta/);
  assert.equal((file.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.doesNotMatch(file, /R\$|9\.900|Aluguel|Guia/);
  assert.ok(file.endsWith('END:VCALENDAR\r\n'));
  assert.ok(file.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75));
});
