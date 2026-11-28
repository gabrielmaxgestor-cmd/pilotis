import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorkReport, reportMonth, reportText } from '../workReport';
import type { Project, ProjectStage, ScheduleProgress } from '../../types/pilotis';

test('relatório mensal usa conclusões do período e a última observação disponível até o fechamento', () => {
  assert.equal(reportMonth('2026-13', '2026-11-28'), null);
  assert.equal(reportMonth('2026-12', '2026-11-28'), null);
  assert.equal(reportMonth('2024-02', '2026-11-28')?.cutoff, '2024-02-29');
  assert.equal(reportMonth('2026-11', '2026-11-28')?.cutoff, '2026-11-28');

  const project = { id: 'obra', name: 'Residência', startDate: '2026-10-01', status: 'Em execução', contractValue: 999123 } as Project;
  const stage = (data: Partial<ProjectStage>) => ({
    id: 'done', projectId: 'obra', name: 'Estrutura', wbsCode: '1', startWeek: 0, durationWeeks: 1, progressPct: 100,
    status: 'Concluída', dependsOn: [], completedDate: '2026-10-13', ...data,
  }) as ProjectStage;
  const observation = (data: Partial<ScheduleProgress>) => ({ projectId: 'obra', date: '2026-10-13',
    progressPct: 25, scheduleRevision: 2, ...data }) as ScheduleProgress;
  const result = buildWorkReport({ project, month: '2026-10', today: '2026-11-28', materials: [],
    stages: [stage({}), stage({ id: 'legacy', completedDate: '' }), stage({ id: 'new', completedDate: '2026-11-01' }),
      stage({ id: 'external', projectId: 'outra', name: 'Excluir outra obra' }),
      stage({ id: 'pending', status: 'A fazer', name: 'Revestimento', progressPct: 0, completedDate: '', startWeek: 9 })],
    progressHistory: [observation({}), observation({ scheduleRevision: 1, progressPct: 10 }),
      observation({ projectId: 'outra', date: '2026-10-18', progressPct: 90 }),
      observation({ date: '2026-11-01', progressPct: 80 })],
    approvals: [{ id: 'a', title: 'Acabamento', dueDate: '2027-01-01', approvedAt: '' },
      { id: 'b', title: 'Planta', dueDate: '', approvedAt: '2026-10-18' }],
  });
  assert.equal(result.progress, 25);
  assert.deepEqual(result.completed, [{ name: 'Estrutura', date: '2026-10-13' }]);
  assert.equal(result.undatedCompletions, 1);
  assert.deepEqual(result.upcoming.map((item) => item.name), ['Revestimento']);
  assert.deepEqual(result.approvals.map((row) => row.name), ['Acabamento']);
  assert.ok(!JSON.stringify(result).includes('999123'));
  assert.equal(reportText('Acabamento R$ 123,00 e 500 reais'), 'Acabamento [valor omitido] e [valor omitido]');
});
