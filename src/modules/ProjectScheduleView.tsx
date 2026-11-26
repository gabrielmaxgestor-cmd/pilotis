import { useId, useRef, useState } from 'react';
import { Modal, RegisteredBySelect, StatusBadge } from '../components/ui/PilotisUI';
import {
  addDaysISO,
  formatDateBR,
  formatShortDateBR,
  formatPercentBR,
  getProjectSchedule,
  getScheduleBaselineStages,
  planningTodayISO,
  scheduleDeliveryVariance,
  validateReplanJustification,
  type CurvaSResult,
} from '../domain';
import { replanProjectSchedule } from '../services/pilotisService';
import type { ActorRole, Project, ProjectStage, ScheduleBaseline, ScheduleBaselineStage } from '../types/pilotis';

const NAVY = '#1F3A5F';
const BRONZE = '#9A6212';
const TODAY = '#B42318';
const RED = '#B42318';
const BASELINE = '#68645B';
const WEEK_WIDTH = 46;
const ROW_HEIGHT = 72;
const HEADER_HEIGHT = 46;
const EDGE = 20;

type Schedule = ReturnType<typeof getProjectSchedule>;

function deliveryVariation(days: number | null) {
  if (days === null) return 'Sem dados';
  if (days === 0) return 'Sem variação';
  return Math.abs(days) + (Math.abs(days) === 1 ? ' dia ' : ' dias ') + (days > 0 ? 'de atraso' : 'de antecipação');
}

function diamond(x: number, y: number, radius: number) {
  return 'M ' + x + ' ' + (y - radius) + ' l ' + radius + ' ' + radius + ' l -' + radius + ' ' + radius
    + ' l -' + radius + ' -' + radius + ' z';
}

function dependencyPath(fromX: number, fromY: number, toX: number, toY: number) {
  if (toX - fromX > 18) {
    const bend = (fromX + toX) / 2;
    return 'M' + fromX + ' ' + fromY + ' H' + bend + ' V' + toY + ' H' + toX;
  }
  const lane = toY + (fromY < toY ? -25 : 25);
  return 'M' + fromX + ' ' + fromY + ' h9 V' + lane + ' H' + (toX - 9) + ' V' + toY + ' H' + toX;
}

interface TimelineRow {
  stage: ProjectStage;
  baseline?: ScheduleBaselineStage;
  start: number;
  end: number;
  slack?: number;
  critical: boolean;
  late: boolean;
}

function StageBars({ row, x, y }: { row: TimelineRow; x: (week: number) => number; y: number }) {
  const { stage, baseline, start, end, critical, late } = row;
  const width = x(end) - x(start);
  const progress = Math.min(100, Math.max(0, stage.progressPct ?? 0));
  const fill = critical ? BRONZE : NAVY;
  const outline = late ? RED : 'none';
  return (
    <g>
      {baseline && (baseline.durationWeeks === 0 ? (
        <path d={diamond(x(baseline.startWeek), y + 13, 4)} fill="none" stroke={BASELINE} strokeDasharray="2 2" />
      ) : (
        <rect x={x(baseline.startWeek)} y={y + 10} width={x(baseline.startWeek + baseline.durationWeeks) - x(baseline.startWeek)}
          height={6} rx={2} fill="none" stroke={BASELINE} strokeDasharray="4 3" />
      ))}
      {stage.isMilestone || width === 0 ? (
        <path d={diamond(x(start), y, 6)} fill={fill} stroke={outline} strokeWidth={2} />
      ) : (
        <>
          <rect x={x(start)} y={y - 7} width={width} height={14} rx={3} fill={fill} fillOpacity={0.25} stroke={fill} />
          {progress > 0 && <rect x={x(start)} y={y - 7} width={width * progress / 100} height={14} rx={3} fill={fill} />}
          {late && <rect x={x(start)} y={y - 7} width={width} height={14} rx={3} fill="none" stroke={RED} strokeWidth={2} />}
        </>
      )}
    </g>
  );
}

function ScheduleTimeline({
  project, stages, schedule, baseline, onEdit,
}: {
  project: Project;
  stages: ProjectStage[];
  schedule: Schedule;
  baseline?: ScheduleBaseline;
  onEdit: (stage: ProjectStage) => void;
}) {
  const arrowId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const baselineById = new Map((baseline?.stages ?? getScheduleBaselineStages(stages)).map((item) => [item.stageId, item]));
  const rows: TimelineRow[] = stages.map((stage) => {
    const detail = schedule.details.get(stage.id);
    const base = baselineById.get(stage.id);
    const start = detail?.inicioMaisCedo ?? stage.startWeek;
    const end = detail?.terminoMaisCedo ?? start + stage.durationWeeks;
    return {
      stage, baseline: base, start, end, slack: detail?.folga, critical: detail?.critica ?? false,
      late: Boolean(base && end > base.startWeek + base.durationWeeks)
        || (stage.status !== 'Concluída' && (schedule.todayWeek ?? 0) > end),
    };
  });
  const rowIndex = new Map(rows.map((row, index) => [row.stage.id, index]));
  const today = schedule.todayWeek;
  const baselineEndDate = baseline?.endDate ?? project.baselineEndDate;
  const baselineEndDays = scheduleDeliveryVariance(baselineEndDate, project.startDate);
  const baseDelivery = baselineEndDays === null ? null : baselineEndDays / 7;
  const from = Math.min(0, Math.floor(today ?? 0), Math.floor(baseDelivery ?? 0));
  const to = Math.ceil(Math.max(1, schedule.criticalPath.duracaoTotal, today ?? 0, baseDelivery ?? 0,
    ...rows.map(({ end }) => end),
    ...[...baselineById.values()].map((stage) => stage.startWeek + stage.durationWeeks)));
  const x = (week: number) => EDGE + (week - from) * WEEK_WIDTH;
  const miniX = (week: number) => 10 + (week - from) / (to - from) * 300;
  const textToday = formatDateBR(planningTodayISO());
  const weeks = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const width = x(to) + EDGE;
  const height = HEADER_HEIGHT + (rows.length + 1) * ROW_HEIGHT;
  const rowY = (index: number) => HEADER_HEIGHT + index * ROW_HEIGHT + 32;
  const delivery = schedule.forecastEndDate ? schedule.criticalPath.duracaoTotal : null;
  const codeList = (stage: ProjectStage) => (stage.dependsOn ?? []).map((id) => rows[rowIndex.get(id) ?? -1]?.stage.wbsCode ?? id);
  const rowSummary = (row: TimelineRow) => (
    <span className="text-xs text-[#5B6472]">
      Semana {row.start} a {row.end} · {formatPercentBR(row.stage.progressPct, 0)}
      {row.slack !== undefined && ' · Folga ' + row.slack + ' sem.'}
    </span>
  );
  const stageFlags = (row: TimelineRow) => (
    <span className="flex flex-wrap gap-1.5">
      {row.critical && <StatusBadge label="Crítica" tone="crit" />}
      {row.late && <StatusBadge label="Atrasada" tone="bad" />}
      {row.stage.isMilestone && <StatusBadge label="Marco" />}
    </span>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[#5B6472]">
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-[#1F3A5F]" /> Progresso</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded border border-dashed border-[#68645B]" /> Linha de base</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-[#9A6212]" /> Caminho crítico</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded border border-[#B42318]" /> Atraso</span>
        {today !== null && <span className="flex items-center gap-1.5"><span className="h-3 border-l-2 border-[#B42318]" /> Hoje · {textToday}</span>}
        {today !== null && <button type="button" onClick={() => viewport.current?.scrollTo({ left: Math.max(0, x(today) - 36) })}
          className="hidden rounded border border-[#E4E1DA] px-2 py-1 font-semibold text-[#1F3A5F] focus-visible:ring-2 focus-visible:ring-[#1F3A5F] md:block">
          Ir para hoje
        </button>}
      </div>

      <ul className="grid gap-2 md:hidden" aria-label="Cronograma por etapa">
        {rows.map((row) => (
          <li key={row.stage.id} className="rounded-lg border border-[#E4E1DA]">
            <button type="button" onClick={() => onEdit(row.stage)}
              className="grid w-full gap-1.5 rounded-lg p-3 text-left focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
              <strong className="text-sm text-[#14181F]">{row.stage.wbsCode} · {row.stage.name}</strong>
              <span className="text-xs text-[#5B6472]">{row.stage.status}</span>
              {rowSummary(row)}
              {row.baseline && <span className="text-xs text-[#5B6472]">Linha de base · S{row.baseline.startWeek} a S{row.baseline.startWeek + row.baseline.durationWeeks}</span>}
              {stageFlags(row)}
              {codeList(row.stage).length > 0 && <span className="text-xs text-[#5B6472]">Predecessoras · {codeList(row.stage).join(', ')}</span>}
              <svg viewBox="0 0 320 35" className="h-9 w-full rounded bg-[#F6F5F2]" aria-hidden="true">
                <StageBars row={row} x={miniX} y={13} />
                {today !== null && <line x1={miniX(today)} x2={miniX(today)} y1={2} y2={33} stroke={TODAY} strokeWidth={2} />}
              </svg>
            </button>
          </li>
        ))}
        {delivery !== null && <li className="grid gap-1 rounded-lg border border-[#E4E1DA] p-3 text-sm">
          <strong>Marco de entrega · {formatDateBR(schedule.forecastEndDate)}</strong>
          <svg viewBox="0 0 320 30" className="h-8 w-full rounded bg-[#F6F5F2]" aria-hidden="true">
            {baseDelivery !== null && <path d={diamond(miniX(baseDelivery), 21, 4)} stroke={BASELINE} fill="none" strokeDasharray="2 2" />}
            <path d={diamond(miniX(delivery), 11, 6)} fill={BRONZE} />
            {today !== null && <line x1={miniX(today)} x2={miniX(today)} y1={1} y2={29} stroke={TODAY} strokeWidth={2} />}
          </svg>
        </li>}
      </ul>
      {today !== null && (
        <div aria-label="Datas da escala das mini-barras" className="flex justify-between text-xs tabular-nums text-[#5B6472] md:hidden">
          {[from, Math.round((to + from) / 2), to].filter((week, index, all) => all.indexOf(week) === index).map((week) => (
            <span key={week}>{formatShortDateBR(addDaysISO(project.startDate, week * 7))}</span>
          ))}
        </div>
      )}

      <div ref={viewport} tabIndex={0} aria-label="Gantt semanal. Role na horizontal para navegar pelas semanas."
        className="hidden max-w-full overflow-x-auto rounded-xl border border-[#E4E1DA] focus-visible:ring-2 focus-visible:ring-[#1F3A5F] md:block">
        <div className="flex w-max min-w-full">
          <div className="sticky left-0 z-10 w-60 shrink-0 border-r border-[#E4E1DA] bg-white">
            <div style={{ height: HEADER_HEIGHT }} className="flex items-center bg-[#F0EEE9] px-3 text-xs font-semibold">Etapa · situação</div>
            {rows.map((row) => (
              <button key={row.stage.id} type="button" onClick={() => onEdit(row.stage)} style={{ height: ROW_HEIGHT }}
                className="grid w-full content-center gap-1 border-t border-[#E4E1DA] px-3 text-left hover:bg-[#F6F5F2] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F3A5F]">
                <strong className="truncate text-xs text-[#14181F]" title={row.stage.name}>{row.stage.wbsCode} · {row.stage.name}</strong>
                {rowSummary(row)}
                <span className="truncate text-[11px] text-[#5B6472]">
                  {[row.stage.status, row.critical ? 'Crítica' : '', row.late ? 'Atrasada' : '',
                    ...(codeList(row.stage).length ? ['Depende de ' + codeList(row.stage).join(', ')] : [])].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
            <div style={{ height: ROW_HEIGHT }} className="grid content-center gap-1 border-t border-[#E4E1DA] px-3 text-xs">
              <strong>Marco de entrega</strong>
              <span>{schedule.forecastEndDate ? formatDateBR(schedule.forecastEndDate) : 'Sem dados'}</span>
            </div>
          </div>

          <svg width={width} height={height} role="img" aria-label="Gantt semanal com linha de base, progresso, setas de dependência e a entrega prevista">
            <defs>
              <marker id={arrowId + '-normal'} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={BASELINE} />
              </marker>
              <marker id={arrowId + '-critical'} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={BRONZE} />
              </marker>
            </defs>
            <rect width={width} height={HEADER_HEIGHT} fill="#F0EEE9" />
            {rows.map((row, index) => (
              <g key={row.stage.id}>
                {index % 2 === 1 && <rect y={HEADER_HEIGHT + index * ROW_HEIGHT} width={width} height={ROW_HEIGHT} fill="#F9F8F5" />}
                <line x2={width} y1={HEADER_HEIGHT + index * ROW_HEIGHT} y2={HEADER_HEIGHT + index * ROW_HEIGHT} stroke="#E4E1DA" />
              </g>
            ))}
            {weeks.map((week) => (
              <g key={week}>
                <line x1={x(week)} x2={x(week)} y1={HEADER_HEIGHT} y2={height} stroke="#E4E1DA" />
                <text x={x(week)} y={16} textAnchor="middle" fontSize="10" fill="#5B6472">{week < 0 ? week : 'S' + week}</text>
              </g>
            ))}
            {rows.map((row, index) => (row.stage.dependsOn ?? []).map((predecessorId) => {
              const predecessorIndex = rowIndex.get(predecessorId);
              if (predecessorIndex === undefined || schedule.criticalPath.cicloDetectado) return null;
              const predecessor = rows[predecessorIndex];
              const criticalLink = predecessor.critical && row.critical && predecessor.end === row.start;
              return <path key={row.stage.id + '-' + predecessorId} d={dependencyPath(
                x(predecessor.end) + (predecessor.stage.isMilestone ? 6 : 0), rowY(predecessorIndex),
                x(row.start) - (row.stage.isMilestone ? 7 : 2), rowY(index),
              )} stroke={criticalLink ? BRONZE : BASELINE} strokeWidth="1.5" fill="none"
                markerEnd={'url(#' + arrowId + (criticalLink ? '-critical' : '-normal') + ')'} />;
            }))}
            {rows.map((row, index) => <StageBars key={row.stage.id} row={row} x={x} y={rowY(index)} />)}
            <line x2={width} y1={height - ROW_HEIGHT} y2={height - ROW_HEIGHT} stroke="#E4E1DA" />
            {baseDelivery !== null && <path d={diamond(x(baseDelivery), rowY(rows.length) + 13, 5)} stroke={BASELINE} fill="none" strokeDasharray="3 2" />}
            {delivery !== null && <path d={diamond(x(delivery), rowY(rows.length), 8)} fill={BRONZE} />}
            {today !== null && (
              <g>
                <line x1={x(today)} x2={x(today)} y1={30} y2={height} stroke={TODAY} strokeWidth="2" />
                <text x={Math.min(Math.max(x(today), 19), width - 19)} y={29} textAnchor="middle" fontSize="10" fontWeight="700" fill={TODAY}>Hoje</text>
              </g>
            )}
          </svg>
        </div>
      </div>
    </>
  );
}

export function ProjectScheduleView({
  uid, project, stages, schedule, baselines, cycle, onEdit,
}: {
  uid: string;
  project: Project;
  stages: ProjectStage[];
  schedule: Schedule;
  baselines: ScheduleBaseline[];
  cycle: string | null;
  onEdit: (stage: ProjectStage) => void;
}) {
  const [selectedVersion, setSelectedVersion] = useState(1);
  const [revision, setRevision] = useState<number | undefined>();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const versions = baselines.filter((record) => record.projectId === project.id).sort((a, b) => b.version - a.version);
  const original = versions.find((version) => version.version === 1);
  const active = versions.find((version) => version.version === (project.scheduleBaselineVersion ?? 1));
  const selected = versions.find((version) => version.version === selectedVersion);
  const originalDate = original?.endDate ?? project.baselineEndDate;
  const selectedDate = selected?.endDate ?? originalDate;

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-[#E4E1DA] bg-white p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#14181F]">Cronograma semanal</h2>
          <p className="text-sm text-[#5B6472]">{project.name}</p>
        </div>
        <button type="button" disabled={!schedule.forecastEndDate} onClick={() => {
          setRevision(project.scheduleRevision);
          setReason('');
          setError(null);
          setFeedback('');
          setIsOpen(true);
        }} className="rounded-lg bg-[#1F3A5F] px-3 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50">
          Replanejar
        </button>
      </header>
      {feedback && <p role="status" className="rounded-lg bg-[#E3F4EC] p-3 text-sm text-[#1D6849]">{feedback}</p>}
      {cycle && <p role="alert" className="text-sm text-[#B42318]">{cycle}</p>}
      {stages.length === 0 ? <p className="text-sm text-[#5B6472]">Sem dados no cronograma.</p> : (
        <>
          <dl className="grid gap-3 rounded-lg border border-[#E4E1DA] p-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-[#5B6472]">Entrega original</dt><dd className="font-semibold">{formatDateBR(originalDate)}</dd></div>
            <div><dt className="text-xs text-[#5B6472]">Entrega prevista</dt><dd className="font-semibold">{formatDateBR(schedule.forecastEndDate)}</dd></div>
            <div><dt className="text-xs text-[#5B6472]">Variação frente ao plano original</dt>
              <dd className="font-semibold">{deliveryVariation(scheduleDeliveryVariance(schedule.forecastEndDate ?? '', originalDate))}</dd></div>
          </dl>
          {versions.some((version) => version.version > 1) && (
            <label className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              Linha de base exibida
              <select value={selectedVersion} onChange={(event) => setSelectedVersion(Number(event.target.value))}
                className="rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
                <option value={1}>Plano original</option>
                {versions.filter((version) => version.version > 1).map((version) => (
                  <option key={version.id} value={version.version}>Versão {version.version} · {formatDateBR(version.endDate)}</option>
                ))}
              </select>
              <span className="text-xs font-normal text-[#5B6472]">
                Variação frente à linha de base exibida · {deliveryVariation(scheduleDeliveryVariance(schedule.forecastEndDate ?? '', selectedDate))}
              </span>
            </label>
          )}
          <ScheduleTimeline project={project} stages={stages} schedule={schedule} baseline={selected} onEdit={onEdit} />
          <details className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm">
            <summary className="cursor-pointer rounded font-semibold focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">Histórico de linhas de base</summary>
            {versions.length === 0 ? <p className="mt-2 text-[#5B6472]">Nenhum replanejamento registrado.</p> : (
              <ol className="mt-2 grid gap-2">
                {versions.map((version, index) => {
                  const prior = versions[index + 1];
                  const difference = prior ? scheduleDeliveryVariance(version.endDate, prior.endDate) : null;
                  return (
                    <li key={version.id} className="grid gap-1 rounded border border-[#E4E1DA] px-3 py-2">
                      <strong>{version.version === 1 ? 'Plano original' : 'Versão ' + version.version} · Entrega em {formatDateBR(version.endDate)}</strong>
                      {difference !== null && <span>Em relação à versão anterior · {deliveryVariation(difference)}</span>}
                      <span className="text-xs text-[#5B6472]">Registro em {formatDateBR(version.recordedDate)} · {version.createdBy}</span>
                      {version.justification && <p className="whitespace-pre-wrap break-words">{version.justification}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </details>
        </>
      )}

      <Modal open={isOpen} onClose={() => { if (!isSaving) setIsOpen(false); }} title="Replanejar cronograma" maxWidth="max-w-lg">
        <form className="grid gap-4" onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setIsSaving(true);
          try {
            await replanProjectSchedule({ uid, actor, project: { ...project, scheduleRevision: revision }, knownStages: stages,
              justification: validateReplanJustification(reason) });
            setFeedback('Nova linha de base registrada no histórico.');
            setIsOpen(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Não foi possível registrar o replanejamento.');
          } finally {
            setIsSaving(false);
          }
        }}>
          <p className="text-sm text-[#5B6472]">Registre o cronograma atual como uma nova linha de base.</p>
          <div className="grid gap-1 rounded-lg bg-[#F0EEE9] p-3 text-sm">
            <span>Entrega da versão anterior · <strong>{formatDateBR(active?.endDate ?? originalDate)}</strong></span>
            <span>Nova entrega · <strong>{formatDateBR(schedule.forecastEndDate)}</strong></span>
            <span>Variação · <strong>{deliveryVariation(scheduleDeliveryVariance(schedule.forecastEndDate ?? '', active?.endDate ?? originalDate))}</strong></span>
          </div>
          <label className="grid gap-1 text-sm font-semibold">
            Justificativa do replanejamento
            <textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}
              className="min-h-24 rounded-lg border border-[#E4E1DA] p-2 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]" />
          </label>
          <RegisteredBySelect id="schedule-replan-actor" value={actor} onChange={setActor} />
          {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={isSaving} onClick={() => setIsOpen(false)} className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm font-semibold">Cancelar</button>
            <button type="submit" disabled={isSaving} className="rounded-lg bg-[#1F3A5F] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {isSaving ? 'Salvando...' : 'Salvar nova linha de base'}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

export function ScheduleProgressChart({ curve, observations }: {
  curve: CurvaSResult;
  observations: { week: number; progressPct: number; date: string }[];
}) {
  const maxWeek = Math.max(1, curve.pontos.at(-1)?.semana ?? 0, observations.at(-1)?.week ?? 0);
  const maxX = 426;
  const x = (week: number) => 43 + week / maxWeek * (maxX - 43);
  const y = (pct: number) => 137 - pct / 100 * 120;
  const planned = curve.pontos.map((point) => x(point.semana) + ',' + y(point.planejadoPct)).join(' ');
  const actual = observations.map((point) => x(point.week) + ',' + y(point.progressPct)).join(' ');
  const ticks = [...new Set([0, .25, .5, .75, 1].map((part) => Math.round(maxWeek * part)))];

  return (
    <div className="grid min-w-0 gap-1">
      <svg viewBox="0 0 440 167" className="block w-full" role="img" aria-label={
        'Curva S. Planejado ' + formatPercentBR(curve.progressoPlanejadoPct) + '. Realizado ' + formatPercentBR(curve.progressoRealizadoPct) + '.'
      }>
        {[0, 25, 50, 75, 100].map((pct) => (
          <g key={pct}>
            <line x1="43" x2={maxX} y1={y(pct)} y2={y(pct)} stroke="#E4E1DA" />
            <text x="35" y={y(pct) + 4} textAnchor="end" fontSize="12" fill="#5B6472">{pct}%</text>
          </g>
        ))}
        {ticks.map((week) => <text key={week} x={x(Math.min(week, maxWeek))} y="156" textAnchor="middle" fontSize="12" fill="#5B6472">
          S{week}
        </text>)}
        <polyline points={planned} fill="none" stroke={NAVY} strokeWidth="2.5" strokeDasharray="5 3" />
        {observations.length > 1 && <polyline points={actual} fill="none" stroke={BRONZE} strokeWidth="3" />}
        {observations.map((point) => (
          <circle key={point.date} cx={x(point.week)} cy={y(point.progressPct)} r="3.25" fill={BRONZE}>
            <title>{formatDateBR(point.date)} · {formatPercentBR(point.progressPct)}</title>
          </circle>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#5B6472]">
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#1F3A5F]" /> Planejado · linha de base original</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-[#9A6212]" /> Realizado registrado</span>
      </div>
    </div>
  );
}
