import { useState } from 'react';
import { AlertNote, Modal, ProgressBar, RegisteredBySelect, StatusBadge } from '../components/ui/PilotisUI';
import {
  addDaysISO, DEFAULT_WORK_IN_PROGRESS_LIMIT, DELAY_CATEGORIES, formatDateBR, formatPercentBR,
  getProjectSchedule, MAX_WORK_IN_PROGRESS_LIMIT, plannedWeeks, planningTodayISO, resolveTeamWeek,
  scheduleDeliveryVariance, WORKFLOW_COLUMNS,
} from '../domain';
import { createRecord, saveProjectStage, saveWeeklyAllocation, saveWorkInProgressLimit, updateRecord } from '../services/pilotisService';
import type {
  ActorRole, PilotisDataState, Project, ProjectRisk, ProjectRiskCategory, ProjectRiskImpact,
  ProjectRiskStatus, ProjectStage, StageStatus,
} from '../types/pilotis';

const panel = 'grid gap-4 rounded-xl border border-[#E4E1DA] bg-white p-4 sm:p-5';
const field = 'w-full rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]';
const button = 'rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-semibold text-[#1F3A5F] focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
const primary = 'rounded-lg bg-[#1F3A5F] px-3 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
const statusLabel = (status: StageStatus) => WORKFLOW_COLUMNS.find((column) => column.status === status)?.label ?? status;
type Schedule = ReturnType<typeof getProjectSchedule>;
type ProjectStagesProps = { uid: string; project: Project; stages: ProjectStage[] };
type OperationProps = ProjectStagesProps & { data: PilotisDataState };

export function ProjectKanban({ uid, project, stages, visibleStages = stages, schedule, data, onEdit }: OperationProps & {
  visibleStages?: ProjectStage[]; schedule: Schedule; onEdit: (stage: ProjectStage) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [destination, setDestination] = useState<StageStatus | null>(null);
  const [action, setAction] = useState<{ stageId: string; status: StageStatus } | 'limit' | null>(null);
  const [revision, setRevision] = useState<number | undefined>();
  const [limitInput, setLimitInput] = useState('');
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const limit = project.workInProgressLimit ?? DEFAULT_WORK_IN_PROGRESS_LIMIT;
  const ongoing = stages.filter((stage) => stage.status === 'Em andamento').length;
  const moving = typeof action === 'object' && action ? stages.find((stage) => stage.id === action.stageId) : undefined;
  const currentWeek = plannedWeeks(planningTodayISO())[0];

  function openMove(stage: ProjectStage, status = stage.status) {
    setRevision(project.scheduleRevision);
    setAction({ stageId: stage.id, status });
    setError('');
    setFeedback('');
  }

  return (
    <section className="grid min-w-0 gap-4" aria-label="Kanban da obra">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {stages.length > 0 && <span className="text-sm text-[#5B6472]">{ongoing} de {limit} em andamento</span>}
          <button type="button" className={button} onClick={() => {
            setError(''); setFeedback(''); setLimitInput(String(limit)); setAction('limit');
          }}>Configurar limite</button>
        </div>
      </div>
      {feedback && <p role="status" className="text-sm text-[#1D6849]">{feedback}</p>}
      {stages.length === 0 ? <p className={panel}>Sem etapas no quadro.</p> : (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-flow-col md:grid-cols-[repeat(5,minmax(12rem,1fr))] md:overflow-x-auto">
          {WORKFLOW_COLUMNS.map(({ status, label }) => {
            const cards = visibleStages.filter((stage) => stage.status === status);
            return (
              <section key={status} aria-label={label}
                onDragOver={(event) => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDestination(status); } }}
                onDrop={(event) => {
                  event.preventDefault();
                  const stage = stages.find((item) => item.id === dragging && item.id === event.dataTransfer.getData('text/plain'));
                  if (stage && stage.status !== status) openMove(stage, status);
                  setDragging(null); setDestination(null);
                }}
                className={'grid content-start gap-2 rounded-xl border bg-[#F0EEE9] p-3 ' + (dragging && destination === status ? 'border-[#1F3A5F] bg-[#E9EEF6]' : 'border-[#E4E1DA]')}>
                <h3 className="flex justify-between gap-2 text-sm font-bold"><span>{label}</span>
                  <span className="text-xs text-[#5B6472]">{status === 'Em andamento' ? ongoing + ' / ' + limit : cards.length}</span>
                </h3>
                {cards.length === 0 && <p className="text-xs text-[#5B6472]">Sem etapas nesta coluna.</p>}
                {cards.map((stage) => {
                  const detail = schedule.details.get(stage.id);
                  const deadline = detail && schedule.forecastEndDate ? addDaysISO(project.startDate, Math.ceil(detail.terminoMaisCedo * 7)) : null;
                  const people = data.employees.filter((employee) => {
                    const cell = resolveTeamWeek(employee, currentWeek, data);
                    return cell.allocation?.stageId === stage.id && !cell.vacation && !cell.conflict && cell.started;
                  }).map((employee) => employee.name);
                  const responsible = [...new Set([stage.responsible, ...people].filter(Boolean))].join(', ');
                  return (
                    <article key={stage.id} draggable onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', stage.id);
                      event.dataTransfer.effectAllowed = 'move'; setDragging(stage.id);
                    }} onDragEnd={() => { setDragging(null); setDestination(null); }}
                      className="grid gap-2 rounded-lg border border-[#E4E1DA] bg-white p-3">
                      <button type="button" onClick={() => onEdit(stage)}
                        className="text-left text-sm font-semibold text-[#14181F] hover:underline focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
                        {stage.wbsCode} · {stage.name}
                      </button>
                      <p className="text-xs text-[#5B6472]">{responsible || 'Sem responsável'}</p>
                      <div className="flex flex-wrap gap-1">
                        {detail?.critica && <StatusBadge label="Caminho crítico" tone="crit" />}
                        {(stage.status === 'Aguardando material' || stage.delayCategory === 'Material do cliente') && <StatusBadge label="Material do cliente" tone="warn" />}
                        {stage.delayJustification && <StatusBadge label="Atraso registrado" tone="bad" />}
                      </div>
                      <ProgressBar pct={stage.progressPct} />
                      <p className="text-xs text-[#5B6472]">{formatPercentBR(stage.progressPct, 0)} · Prazo {formatDateBR(deadline)}</p>
                      {stage.status === 'Aguardando material' && stage.materialExpectedDate && (
                        <p className="text-xs text-[#5B6472]">Material previsto em {formatDateBR(stage.materialExpectedDate)}</p>
                      )}
                      <button type="button" className={button + ' justify-self-start py-1 text-xs'} onClick={() => openMove(stage)}
                        aria-label={'Mover etapa ' + stage.name}>Mover</button>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
      <Modal open={Boolean(action)} onClose={() => setAction(null)}
        title={action === 'limit' ? 'Limite de etapas em andamento' : 'Mover etapa'} maxWidth="max-w-lg">
        <form className="grid gap-4" onSubmit={async (event) => {
          event.preventDefault();
          if (!action) return;
          setSaving(true); setError('');
          try {
            if (action === 'limit') {
              await saveWorkInProgressLimit(uid, actor, project.id, Number(limitInput));
              setFeedback('Limite atualizado.');
            } else {
              await saveProjectStage({ uid, actor, project: { ...project, scheduleRevision: revision }, knownStages: stages, stageId: action.stageId, moveTo: action.status });
              setFeedback('Etapa movida para ' + statusLabel(action.status) + '.');
            }
            setAction(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
          } finally { setSaving(false); }
        }}>
          {action === 'limit' ? (
            <label className="grid gap-1 text-sm font-semibold">Limite nesta obra
              <input className={field} type="number" required min={1} max={MAX_WORK_IN_PROGRESS_LIMIT} value={limitInput} onChange={(event) => setLimitInput(event.target.value)} />
            </label>
          ) : action && moving && (
            <label className="grid gap-1 text-sm font-semibold">{moving.name}
              <select className={field} value={action.status} onChange={(event) => setAction({ stageId: moving.id, status: event.target.value as StageStatus })}>
                {WORKFLOW_COLUMNS.map(({ status, label }) => <option key={status} value={status}>{label}</option>)}
              </select>
            </label>
          )}
          <RegisteredBySelect id="kanban-actor" value={actor} onChange={setActor} />
          {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
          {error && moving && <button type="button" className={button} onClick={() => { setAction(null); onEdit(moving); }}>Abrir detalhe da etapa</button>}
          <div className="flex justify-end gap-2">
            <button type="button" className={button} disabled={saving} onClick={() => setAction(null)}>Cancelar</button>
            <button type="submit" className={primary} disabled={saving || Boolean(action && action !== 'limit' && moving?.status === action.status)}>{saving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

export function ProjectResources({ uid, project, stages, data }: OperationProps) {
  const [date, setDate] = useState(planningTodayISO);
  const weeks = plannedWeeks(date);
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [stageId, setStageId] = useState('');
  const [week, setWeek] = useState(weeks[0]);
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const rows = data.employees.map((employee) => ({ employee, cells: weeks.map((day) => {
    const cell = resolveTeamWeek(employee, day, data);
    const stage = cell.project?.id === project.id ? stages.find((item) => item.id === cell.allocation?.stageId) : undefined;
    const conflict = cell.conflict || Boolean(cell.project?.id === project.id && cell.allocation?.stageId && !stage);
    const available = !conflict && cell.started && !cell.vacation && (!cell.project || cell.project.id === project.id);
    const idle = available && !stage;
    return { day, stage: available ? stage : undefined, conflict, idle, label: conflict ? 'Conflito de alocação' : available ? stage?.name || 'Sem etapa' : cell.label };
  }) }));
  const conflicts = rows.filter(({ cells }) => cells.some((cell) => cell.conflict)).map(({ employee }) => employee.name);

  function show(employee = '', selectedWeek = weeks[0], stage = '') {
    setEmployeeId(employee); setWeek(selectedWeek); setStageId(stage); setError(''); setFeedback(''); setOpen(true);
  }

  return (
    <section className={panel + ' min-w-0'}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="text-base font-semibold">Carga semanal por etapa</h2>
          <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">Semana inicial
            <input type="date" value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }}
              className="rounded border border-[#E4E1DA] p-1" />
          </label>
        </div>
        <button type="button" className={primary} disabled={!data.employees.length || !stages.length} onClick={() => show()}>Atribuir pessoa a etapa</button>
      </div>
      {feedback && <p role="status" className="text-sm text-[#1D6849]">{feedback}</p>}
      {conflicts.length > 0 && <AlertNote tone="bad" title="Conflito de alocação">{conflicts.join(', ')}. Revise a semana em Equipe.</AlertNote>}
      {rows.length === 0 ? <p className="text-sm text-[#5B6472]">Sem colaboradores cadastrados em Equipe.</p> : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[65rem] w-full border-separate border-spacing-1 text-xs">
              <thead><tr><th scope="col" className="p-2 text-left">Colaborador</th>{weeks.map((day, index) => (
                <th scope="col" key={day} className="w-28 p-2">{formatDateBR(day)}
                  <span className="block font-normal text-[#5B6472]">{rows.filter(({ cells }) => cells[index].stage && !cells[index].conflict).length} em etapa</span>
                </th>
              ))}</tr></thead>
              <tbody>{rows.map(({ employee, cells }) => <tr key={employee.id}>
                <th scope="row" className="p-2 text-left">{employee.name}</th>
                {cells.map((cell) => <td key={cell.day} className="p-0.5">
                  {cell.idle || (cell.stage && !cell.conflict) ? (
                    <button type="button" onClick={() => show(employee.id, cell.day, cell.stage?.id)}
                      className={'w-full rounded p-2 text-left focus-visible:ring-2 focus-visible:ring-[#1F3A5F] ' + (cell.idle ? 'bg-[#FBF1DC] font-semibold text-[#704509]' : 'bg-[#E9EEF6] text-[#1F3A5F]')}>
                      {cell.label}
                    </button>
                  ) : <span className={'block rounded p-2 ' + (cell.conflict ? 'bg-[#FDECEA] font-semibold text-[#B42318]' : 'bg-[#F6F5F2]')}>{cell.label}</span>}
                </td>)}
              </tr>)}</tbody>
            </table>
          </div>
          <ul className="grid gap-2 md:hidden">{rows.map(({ employee, cells }) => (
            <li key={employee.id}><details className="rounded-lg border border-[#E4E1DA] p-3">
              <summary className="cursor-pointer text-sm font-semibold">{employee.name} · {cells[0].label}</summary>
              <ul className="mt-2 grid gap-2 text-sm">{cells.map((cell) => <li key={cell.day} className={'flex items-center justify-between gap-2 border-t p-1 ' + (cell.conflict ? 'text-[#B42318]' : cell.idle ? 'font-semibold text-[#704509]' : '')}>
                <span>{formatDateBR(cell.day)} · {cell.label}</span>
                {(cell.idle || (cell.stage && !cell.conflict)) && <button type="button" className={button + ' px-2 py-1 text-xs'} onClick={() => show(employee.id, cell.day, cell.stage?.id)}>Atribuir</button>}
              </li>)}</ul>
            </details></li>
          ))}</ul>
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Atribuir colaborador a uma etapa" maxWidth="max-w-lg">
        <form className="grid gap-3" onSubmit={async (event) => {
          event.preventDefault();
          const employee = data.employees.find((item) => item.id === employeeId);
          if (!employee || !stages.some((stage) => stage.id === stageId)) return;
          setSaving(true); setError('');
          try {
            await saveWeeklyAllocation(uid, actor, employee, week, { projectId: project.id, projectName: project.name, stageId, status: 'Obra' }, data.allocations, true);
            setFeedback('Atribuição registrada em Recursos e Equipe.'); setOpen(false);
          } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar a atribuição.'); }
          finally { setSaving(false); }
        }}>
          <label className="grid gap-1 text-sm font-semibold">Colaborador
            <select className={field} required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              <option value="">Selecione</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">Etapa
            <select className={field} required value={stageId} onChange={(event) => setStageId(event.target.value)}>
              <option value="">Selecione</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.wbsCode} · {stage.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">Segunda-feira da semana
            <input className={field} required type="date" value={week} onChange={(event) => setWeek(event.target.value)} />
          </label>
          <RegisteredBySelect value={actor} onChange={setActor} id="resource-actor" />
          {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
          <button className={primary + ' justify-self-end'} type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar atribuição'}</button>
        </form>
      </Modal>
    </section>
  );
}

const riskCategories: ProjectRiskCategory[] = [...DELAY_CATEGORIES, 'Dependência'];
const riskImpacts: ProjectRiskImpact[] = ['Baixo', 'Médio', 'Alto'];
const riskStatuses: ProjectRiskStatus[] = ['Aberto', 'Monitorado', 'Resolvido'];
const initialRisk = { stageId: '', category: 'Outros' as ProjectRiskCategory, description: '', impact: 'Médio' as ProjectRiskImpact, status: 'Aberto' as ProjectRiskStatus };
const showVariance = (days: number | null) => days === null ? 'Sem dados' : days === 0 ? 'Sem variação' :
  Math.abs(days) + (Math.abs(days) === 1 ? ' dia ' : ' dias ') + (days > 0 ? 'de atraso' : 'de antecipação');

export function ProjectRisks({ uid, project, stages, data, schedule, onEdit, onSchedule }: OperationProps & {
  schedule: Schedule; onEdit: (stage: ProjectStage) => void; onSchedule: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRisk | null>(null);
  const [draft, setDraft] = useState(initialRisk);
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const risks = (data.projectRisks ?? []).filter((risk) => risk.projectId === project.id);
  const delays = stages.filter((stage) => stage.delayJustification?.trim());
  const baselines = data.baselines?.filter((record) => record.projectId === project.id) ?? [];
  const original = baselines.find((record) => record.version === 1)?.endDate ?? project.baselineEndDate;
  const active = baselines.find((record) => record.version === project.scheduleBaselineVersion);
  const forecast = schedule.forecastEndDate;
  function show(risk?: ProjectRisk) {
    setEditing(risk ?? null);
    setDraft(risk ? { stageId: risk.stageId, category: risk.category, description: risk.description, impact: risk.impact, status: risk.status } : initialRisk);
    setError(''); setFeedback(''); setOpen(true);
  }
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="grid gap-4">
        <section className={panel}>
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Riscos da obra</h2>
            <button type="button" className={primary} disabled={!stages.length} onClick={() => show()}>Registrar risco</button>
          </header>
          {feedback && <p role="status" className="text-sm text-[#1D6849]">{feedback}</p>}
          {risks.length === 0 ? <p className="text-sm text-[#5B6472]">Sem riscos registrados.</p> : <ul className="grid gap-2">
            {risks.map((risk) => <li key={risk.id}>
              <button type="button" onClick={() => show(risk)} className="grid w-full gap-2 rounded-lg border border-[#E4E1DA] p-3 text-left text-sm hover:bg-[#F6F5F2] focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
                <strong>{stages.find((stage) => stage.id === risk.stageId)?.name ?? 'Etapa indisponível'} · {risk.category}</strong>
                <span className="whitespace-pre-wrap break-words text-[#5B6472]">{risk.description}</span>
                <span className="flex flex-wrap gap-2"><StatusBadge label={'Impacto ' + risk.impact.toLowerCase()} tone={risk.impact === 'Alto' ? 'bad' : 'neutral'} /><StatusBadge label={risk.status} /></span>
              </button>
            </li>)}
          </ul>}
        </section>
        <section className={panel}>
          <h2 className="text-base font-semibold">Atrasos registrados</h2>
          {delays.length === 0 ? <p className="text-sm text-[#5B6472]">Sem atrasos justificados.</p> : <ul className="grid gap-2">
            {delays.map((stage) => {
              const plannedEnd = stage.baselineStartWeek + stage.baselineDurationWeeks;
              const forecastEnd = schedule.details.get(stage.id)?.terminoMaisCedo;
              return <li key={stage.id}><button type="button" onClick={() => onEdit(stage)}
                className="grid w-full gap-2 rounded-lg border border-[#E4E1DA] p-3 text-left text-sm hover:bg-[#F6F5F2] focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
                <strong>{stage.name} · {stage.delayCategory || 'Categoria pendente'}</strong>
                <span className="whitespace-pre-wrap break-words">{stage.delayJustification}</span>
                <span className="flex flex-wrap gap-2"><StatusBadge label={statusLabel(stage.status)} />
                  <StatusBadge label={showVariance(forecastEnd === undefined ? null : Math.round((forecastEnd - plannedEnd) * 7))} /></span>
              </button></li>;
            })}
          </ul>}
        </section>
      </div>
      <section className={panel}>
        <h2 className="text-base font-semibold">Linha de base × previsão</h2>
        <dl className="grid gap-2 text-sm">
          <div><dt className="text-xs text-[#5B6472]">Entrega original</dt><dd className="font-semibold">{formatDateBR(stages.length ? original : null)}</dd></div>
          {active && active.version > 1 && <div><dt className="text-xs text-[#5B6472]">Entrega da versão {active.version}</dt><dd className="font-semibold">{formatDateBR(active.endDate)}</dd></div>}
          <div><dt className="text-xs text-[#5B6472]">Entrega prevista</dt><dd className="font-semibold">{formatDateBR(forecast)}</dd></div>
          <div><dt className="text-xs text-[#5B6472]">Variação frente ao plano original</dt><dd className="font-semibold">{showVariance(scheduleDeliveryVariance(forecast ?? '', original))}</dd></div>
        </dl>
        <button type="button" className={button} onClick={onSchedule}>Ver histórico no Cronograma</button>
      </section>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar risco' : 'Registrar risco'} maxWidth="max-w-lg">
        <form className="grid gap-3" onSubmit={async (event) => {
          event.preventDefault();
          const description = draft.description.trim();
          if (!description || !stages.some((stage) => stage.id === draft.stageId)) { setError('Escolha a etapa e descreva o risco.'); return; }
          setSaving(true); setError('');
          const row = { ...draft, description, projectId: project.id };
          try {
            if (editing) await updateRecord('projectRisks', editing.id, uid, actor, row, 'Risco atualizado', editing.status, row.status);
            else await createRecord('projectRisks', uid, actor, row, 'Risco registrado na obra ' + project.name);
            setOpen(false); setFeedback('Risco salvo.');
          } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar o risco.'); }
          finally { setSaving(false); }
        }}>
          <label className="grid gap-1 text-sm font-semibold">Etapa
            <select className={field} required value={draft.stageId} onChange={(event) => setDraft({ ...draft, stageId: event.target.value })}>
              <option value="">Selecione</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.wbsCode} · {stage.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">Categoria
            <select className={field} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as ProjectRiskCategory })}>{riskCategories.map((item) => <option key={item}>{item}</option>)}</select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">Descrição
            <textarea className={field} required maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-sm font-semibold">Impacto
              <select className={field} value={draft.impact} onChange={(event) => setDraft({ ...draft, impact: event.target.value as ProjectRiskImpact })}>{riskImpacts.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">Situação
              <select className={field} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProjectRiskStatus })}>{riskStatuses.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
          </div>
          <RegisteredBySelect value={actor} onChange={setActor} id="risk-actor" />
          {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
          <button className={primary + ' justify-self-end'} type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar risco'}</button>
        </form>
      </Modal>
    </div>
  );
}
