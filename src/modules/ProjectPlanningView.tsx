import { WhatsAppShortcut } from '../components/ui/WhatsAppShortcut';
import { ProjectMaterialsView } from './ProjectMaterialsView';
import { weeksToCalendarDays, withMaterialHold } from '../domain/customerMaterials';
import { RecordLifecycleButton } from '../components/ui/ArchivedRecords';
import { useEffect, useMemo, useState } from 'react';
import { ListToolbar, useListFilters } from '../components/ui/ListFilters';
import { useViewParam, useViewTab } from '../hooks/useViewUrl';
import { addDaysISO, isValidISODate } from '../domain/formatters';
import type { ListSchema } from '../domain/listQuery';
import { PostConstructionView, ProjectClosureView } from './ProjectClosureView';
import { FieldStages, ProjectDiary } from './ProjectFieldView';
import { ProjectScheduleView, ScheduleProgressChart } from './ProjectScheduleView';
import { ProjectKanban, ProjectResources, ProjectRisks } from './ProjectOperationsView';
import {
  AlertNote,
  EmptySection,
  KpiCard,
  Modal,
  PageHeader,
  Button,
  ProgressBar,
  RegisteredBySelect,
  SegmentedControl,
  StatusBadge,
  Tabs,
} from '../components/ui/PilotisUI';
import {
  applyScheduleTemplateToProject,
  createProjectFromTemplate,
  createRecord,
  linkProjectClient,
  saveProjectStage,
} from '../services/pilotisService';
import type {
  ActorRole,
  PilotisDataState,
  ProjectContractKind,
  ProjectStage,
  ProjectType,
  StageStatus,
} from '../types/pilotis';
import {
  calcularCurvaSObra,
  DELAY_CATEGORIES,
  describeScheduleCycle,
  normalizeDelayCategory,
  plannedWeeks,
  resolveTeamWeek,
  getProjectSchedule,
  getContractCostBudget,
  isPublishedPop,
  linkedPopChecklist,
  getRecordedScheduleProgress,
  getWorkPackageBudget,
  planningTodayISO,
  roundCents,
  calcularDreObra,
  calcularProgressoObra,
  calcularResumoFasesEap,
  clampStr,
  formatBRL,
  formatDateBR as domainFormatDateBR,
  formatPercentBR,
  todayISO,
} from '../domain';

const formatDateBR = (val: string | null | undefined) => domainFormatDateBR(val, '—');

const PLAN_TABS = [
  'Visão geral',
  'EAP',
  'Cronograma',
  'Kanban',
  'Materiais do cliente',
  'Recursos',
  'Riscos',
  'Diário de obra',
  'Etapas em campo',
  'Encerramento',
  'Pós-obra',
];

const TEMPLATE_OPTIONS: { type: ProjectType; description: string }[] = [
  { type: 'Casa residencial', description: 'Estrutura, instalações e entrega · 52 semanas' },
  { type: 'Reforma', description: 'Demolição, instalações e entrega · 10 semanas' },
  { type: 'Obra satélite', description: 'Mobilização, execução e entrega · 4 semanas' },
];

function ScheduleTemplateOptions({ value, onChange }: { value: ProjectType; onChange: (value: ProjectType) => void }) {
  return (
    <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <legend className="sr-only">Modelo de cronograma</legend>
      {TEMPLATE_OPTIONS.map(({ type, description }) => (
        <label key={type} className="cursor-pointer">
          <input type="radio" name="schedule-template" checked={value === type} onChange={() => onChange(type)} className="peer sr-only" />
          <span className="block h-full rounded-xl p-3.5 border border-[#E4E1DA] bg-white peer-checked:border-[#1F3A5F] peer-checked:bg-[#E6EEFB] peer-focus-visible:ring-2 peer-focus-visible:ring-[#1F3A5F]">
            <strong className="block text-sm text-[#14181F]">{type}</strong>
            <span className="text-xs text-[#5B6472]">{description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function groupStages(stages: ProjectStage[]) {
  const phases = new Map<string, Map<string, ProjectStage[]>>();
  for (const stage of stages) {
    const phase = phases.get(stage.phase) ?? new Map<string, ProjectStage[]>();
    phases.set(stage.phase, phase);
    const delivery = stage.deliverable || 'Entrega ainda não informada';
    const packages = phase.get(delivery) ?? [];
    packages.push(stage);
    phase.set(delivery, packages);
  }
  return [...phases];
}

export function ProjectPlanningView({
  uid,
  data,
  companyEmail,
  selectedProjectId,
  onSelectProject,
}: {
  uid: string;
  data: PilotisDataState;
  companyEmail?: string | null;
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
}) {
  const [tab, setTab] = useViewTab('planning', PLAN_TABS);
  const [recordId, setRecordId] = useViewParam('registro');
  const [selectedPhase, setSelectedPhase] = useViewParam('etapas.fase');
  const [projectFilter, setProjectFilter] = useState('Todas');

  // New Project from Template Modal
  const [newProjModal, setNewProjModal] = useState(false);
  const [npName, setNpName] = useState('');
  const [npClientName, setNpClientName] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkClient, setLinkClient] = useState('');
  const [linkActor, setLinkActor] = useState<ActorRole>('Sócio');
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [npType, setNpType] = useState<ProjectType>('Casa residencial');
  const [npContractKind, setNpContractKind] = useState<ProjectContractKind>('Principal');
  const [npValue, setNpValue] = useState('');
  const [npBudget, setNpBudget] = useState('');
  const [npError, setNpError] = useState<string | null>(null);
  const [npStart, setNpStart] = useState(todayISO());
  const [npMonths, setNpMonths] = useState('');
  const [npActor, setNpActor] = useState<ActorRole>('Sócio');
  const [npSaving, setNpSaving] = useState(false);

  // Schedule Template Onboarding for Contratada projects awaiting cronograma
  const [tplType, setTplType] = useState<ProjectType>('Casa residencial');
  const [tplStart, setTplStart] = useState(todayISO());
  const [tplMonths, setTplMonths] = useState('');
  const [tplActor, setTplActor] = useState<ActorRole>('Sócio');
  const [tplSaving, setTplSaving] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);

  // Stage Modal (Create / Edit + Checklist + Delay justification)
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<ProjectStage | null>(null);
  const [stWbs, setStWbs] = useState('1.1');
  const [stPhase, setStPhase] = useState('1 · Fundação, estrutura e cobertura');
  const [stName, setStName] = useState('');
  const [stDeliverable, setStDeliverable] = useState('');
  const [stageRevision, setStageRevision] = useState<number | undefined>();
  const [stResp, setStResp] = useState('');
  const [stStartWeek, setStStartWeek] = useState('0');
  const [stDurWeeks, setStDurWeeks] = useState('4');
  const [stProgress, setStProgress] = useState('0');
  const [stBudget, setStBudget] = useState('0');
  const [stPopId, setStPopId] = useState('');
  const [stDeps, setStDeps] = useState<string[]>([]);
  const [stStatus, setStStatus] = useState<StageStatus>('A fazer');
  const [stMatDate, setStMatDate] = useState('');
  const [stDelayCat, setStDelayCat] = useState('');
  const [stDelayJust, setStDelayJust] = useState('');
  const [stChecklistDone, setStChecklistDone] = useState<string[]>([]);
  const [stActor, setStActor] = useState<ActorRole>('Sócio');
  const [stError, setStError] = useState<string | null>(null);
  const [stSaving, setStSaving] = useState(false);

  const activeProject =
    data.projects.find((p) => p.id === selectedProjectId) ?? null;

  useEffect(() => {
    if (!activeProject) return;
    setTplType(activeProject.type || 'Casa residencial');
    setTplStart(activeProject.startDate || todayISO());
    const linkedQuote = data.quotes.find((q) => q.id === activeProject.quoteId);
    setTplMonths(linkedQuote?.estimatedMonths ? String(linkedQuote.estimatedMonths) : '');
    setTplError(null);
  }, [activeProject, data.quotes]);

  const projectStages = useMemo(
    () =>
      activeProject
        ? data.stages
            .filter((s) => s.projectId === activeProject.id)
            .sort((a, b) => a.wbsCode.localeCompare(b.wbsCode, 'pt-BR', { numeric: true }))
        : [],
    [activeProject, data.stages]
  );

  const awaitingScheduleTemplate = Boolean(
    activeProject &&
      activeProject.status === 'Contratada' && activeProject.planningStatus !== 'Cronograma criado' && projectStages.length === 0
  );

  const scheduleDate = planningTodayISO();
  const schedule = useMemo(
    () => activeProject ? getProjectSchedule(activeProject, projectStages, scheduleDate, data.customerMaterials) : null,
    [activeProject, projectStages, scheduleDate, data.customerMaterials],
  );
  const visibleProjectStages = useMemo(() => schedule
    ? projectStages.map((stage) => withMaterialHold(stage, schedule.materials.blockedStages))
    : projectStages, [projectStages, schedule]);
  const originalBaseline = data.baselines?.find((baseline) => baseline.projectId === activeProject?.id && baseline.version === 1);
  const criticalIds = new Set(schedule?.criticalPath.etapasCriticas ?? []);
  const stageDeadline = (stage: ProjectStage) => isValidISODate(activeProject?.startDate)
    ? addDaysISO(activeProject.startDate, weeksToCalendarDays(schedule?.details.get(stage.id)?.terminoMaisCedo ?? stage.startWeek + stage.durationWeeks)) : '';
  const stageSchema: ListSchema<ProjectStage> = {
    text: (row) => [row.wbsCode, row.name, row.phase, row.deliverable, row.responsible,
      data.pops.find((pop) => pop.id === row.popId)?.title],
    status: (row) => row.status, projects: (row) => row.projectId, dates: stageDeadline,
    interval: (row) => isValidISODate(activeProject?.startDate) ? [
      addDaysISO(activeProject.startDate, weeksToCalendarDays(schedule?.details.get(row.id)?.inicioMaisCedo ?? row.startWeek)),
      stageDeadline(row),
    ] : undefined,
    columns: [
      { key: 'code', label: 'Código EAP', value: (row) => row.wbsCode },
      { key: 'title', label: 'Etapa', value: (row) => row.name },
      { key: 'phase', label: 'Fase', value: (row) => row.phase },
      { key: 'assignee', label: 'Responsável', value: (row) => row.responsible },
      { key: 'end', label: 'Término', value: stageDeadline },
      { key: 'duration', label: 'Duração', value: (row) => row.durationWeeks },
      { key: 'budget', label: 'Custo orçado', value: (row) => row.budgetedCost },
      { key: 'status', label: 'Situação', value: (row) => row.status },
    ],
  };
  const linkedStage = tab === 'Cronograma' ? visibleProjectStages.find((stage) => stage.id === recordId) : undefined;
  const stages = useListFilters('etapas', visibleProjectStages, stageSchema);
  const projectProgress = activeProject ? calcularProgressoObra(activeProject.id, projectStages) : null;
  const curvaSData = useMemo(() => calcularCurvaSObra(
    projectStages, schedule?.referenceWeek, originalBaseline, tab === 'Visão geral', schedule?.criticalPath,
  ), [projectStages, schedule?.referenceWeek, originalBaseline, tab, schedule?.criticalPath]);
  const progressObservations = activeProject && tab === 'Visão geral' && curvaSData.possuiDados
    ? getRecordedScheduleProgress(activeProject, data.scheduleProgress ?? [], scheduleDate, curvaSData.progressoRealizadoPct)
    : [];
  const delayedStages = projectStages.filter((stage) => (
    (schedule?.details.get(stage.id)?.terminoMaisCedo ?? stage.startWeek + stage.durationWeeks)
    > stage.baselineStartWeek + stage.baselineDurationWeeks
  ));
  const scheduleCycle = schedule ? describeScheduleCycle(projectStages, schedule.criticalPath) : null;
  const filteredProjects = data.projects.filter((project) => projectFilter === 'Todas' || (
    projectFilter === 'Concluídas' ? project.status === 'Concluída' : project.status === projectFilter
  ));


  // Phases breakdown for Visão geral via /src/domain
  const phasesList = useMemo(
    () => calcularResumoFasesEap(projectStages),
    [projectStages]
  );

  function openCreateStage() {
    setEditingStage(null);
    setStWbs('');
    setStPhase('');
    setStDeliverable('');
    setStageRevision(activeProject?.scheduleRevision);
    setStName('');
    setStResp('');
    setStStartWeek('0');
    setStDurWeeks('4');
    setStProgress('0');
    setStBudget('0');
    setStPopId('');
    setStDeps([]);
    setStStatus('A fazer');
    setStMatDate('');
    setStDelayCat('');
    setStDelayJust('');
    setStChecklistDone([]);
    setStError(null);
    setStageModalOpen(true);
  }

  function openEditStage(selected: ProjectStage) {
    const st = projectStages.find((stage) => stage.id === selected.id) ?? selected;
    setEditingStage(st);
    setStWbs(st.wbsCode);
    setStPhase(st.phase);
    setStDeliverable(st.deliverable ?? '');
    setStageRevision(activeProject?.scheduleRevision);
    setStName(st.name);
    setStResp(st.responsible);
    setStStartWeek(String(st.startWeek));
    setStDurWeeks(String(st.durationWeeks));
    setStProgress(String(st.progressPct));
    setStBudget(String(st.budgetedCost));
    setStPopId(st.popId || '');
    setStDeps(st.dependsOn || []);
    setStStatus(st.status);
    setStMatDate(st.materialExpectedDate || '');
    setStDelayCat(normalizeDelayCategory(st.delayCategory || ''));
    setStDelayJust(st.delayJustification || '');
    setStChecklistDone(st.checklistCompleted || []);
    setStError(null);
    setStageModalOpen(true);
  }

  const cycleError = stageModalOpen && editingStage
    ? describeScheduleCycle(projectStages.map((stage) =>
        stage.id === editingStage.id ? { ...stage, wbsCode: stWbs, name: stName, dependsOn: stDeps } : stage))
    : null;

  async function handleSaveStage(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProject || cycleError) return;

    const startNum = Number(stStartWeek) || 0;
    const durNum = Number(stDurWeeks) || 0;
    const baseStart = editingStage ? editingStage.baselineStartWeek : startNum;
    const baseDur = editingStage ? editingStage.baselineDurationWeeks : durNum;
    setStSaving(true);
    setStError(null);
    try {
      const payload = {
        projectId: activeProject.id,
        wbsCode: clampStr(stWbs.trim(), 24),
        phase: clampStr(stPhase.trim(), 100),
        deliverable: clampStr(stDeliverable.trim(), 120),
        name: clampStr(stName.trim(), 140),
        responsible: clampStr(stResp, 120),
        startWeek: startNum,
        durationWeeks: durNum,
        baselineStartWeek: baseStart,
        baselineDurationWeeks: baseDur,
        progressPct: stStatus === 'Concluída' ? 100 : Math.min(100, Math.max(0, Number(stProgress) || 0)),
        budgetedCost: roundCents(Number(stBudget) || 0),
        popId: stPopId,
        dependsOn: stDeps,
        isMilestone: durNum === 0,
        status: stStatus,
        materialExpectedDate: stMatDate,
        delayCategory: clampStr(stDelayCat, 60),
        delayJustification: clampStr(stDelayJust, 500),
        checklistCompleted: stChecklistDone,
      };

      await saveProjectStage({
        uid, actor: stActor, project: { ...activeProject, scheduleRevision: stageRevision },
        knownStages: projectStages, stageId: editingStage?.id, payload,
      });
      setStageModalOpen(false);
    } catch (err) {
      setStError(err instanceof Error ? err.message : 'Erro ao salvar etapa.');
    } finally {
      setStSaving(false);
    }
  }

  const totalEapBudget = getWorkPackageBudget(projectStages);
  const hasEapBudget = totalEapBudget > 0 || Boolean(projectStages.length && activeProject && getContractCostBudget(activeProject) !== null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Planejamento de Obras"
        subtitle="Acompanhe o andamento e os prazos das obras"
        companyEmail={companyEmail}
        actions={
          <>
            {activeProject && (
              <button type="button" onClick={() => { onSelectProject(''); setTab('Visão geral'); }} className="rounded-lg border border-[#E4E1DA] bg-white px-4 py-2.5 text-sm font-semibold">
                Voltar às obras
              </button>
            )}
            {activeProject && activeProject.status !== 'Concluída' && <RecordLifecycleButton uid={uid}
              record={{ entity: 'projects', id: activeProject.id, title: activeProject.name }} onSaved={() => onSelectProject('')} />}
            <button
              type="button"
              onClick={() => setNewProjModal(true)}
              className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] whitespace-nowrap cursor-pointer"
            >
              Nova obra
            </button>
            {activeProject && activeProject.status !== 'Concluída' && !awaitingScheduleTemplate && (
              <button
                type="button"
                onClick={openCreateStage}
                className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] whitespace-nowrap cursor-pointer"
              >
                Nova etapa
              </button>
            )}
          </>
        }
      />

      {!activeProject ? (
        data.projects.length === 0 ? (
          <EmptySection title="Nenhuma obra cadastrada" description="Confirme um orçamento em Clientes e Orçamentos ou crie uma obra a partir de um modelo de cronograma."
            actionLabel="Nova obra a partir de modelo" onAction={() => setNewProjModal(true)} />
        ) : (
          <section className="grid gap-4" aria-label="Obras">
            <SegmentedControl items={['Todas', 'Contratada', 'Em execução', 'Concluídas']} active={projectFilter} onChange={setProjectFilter} />
            {filteredProjects.length === 0 ? <p className="text-sm text-[#5B6472]">Nenhuma obra neste filtro.</p> : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {filteredProjects.map((project) => {
                  const stages = data.stages.filter((stage) => stage.projectId === project.id);
                  const next = getProjectSchedule(project, stages, scheduleDate, data.customerMaterials).nextStage;
                  const progress = calcularProgressoObra(project.id, stages);
                  const dre = calcularDreObra(project, data.transactions, stages);
                  return (
                    <article key={project.id} className="grid gap-3 rounded-xl border border-[#E4E1DA] bg-white p-5">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-base text-[#14181F]">{project.name}</strong>
                        <StatusBadge label={project.status} />
                      </span>
                      <span className="text-xs text-[#5B6472]">{project.type}{project.clientName && ` · ${project.clientName}`}</span>
                      <span className="flex justify-between gap-2 text-sm"><span>Progresso</span><strong>{formatPercentBR(progress)}</strong></span>
                      {progress !== null && <ProgressBar pct={progress} />}
                      <span className="flex justify-between gap-2 text-sm"><span>Margem real</span><strong>{formatPercentBR(dre.receita.realizado > 0 ? dre.margemRealizadaPct : null)}</strong></span>
                      <span className="text-sm"><strong>Próxima etapa</strong> · {next ? `${next.wbsCode} ${next.name}` : stages.length ? 'Etapas concluídas' : 'Sem dados'}</span>
                      <button type="button" aria-label={`Abrir planejamento de ${project.name}`} onClick={() => { onSelectProject(project.id); setTab('Visão geral'); }}
                        className="justify-self-start rounded text-sm font-semibold text-[#1F3A5F] hover:underline focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
                        Abrir planejamento →
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )
      ) : (
        <>
          <div className="bg-white border border-[#E4E1DA] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm text-[#14181F]">{activeProject.name}</strong>
              {activeProject.clientName && (
                <span className="text-xs text-[#5B6472]">· Cliente: {activeProject.clientName}</span>
              )}
              {!activeProject.clientId && <Button size="sm" variant="secondary" onClick={() => {
                setLinkClient(''); setLinkError(''); setLinkOpen(true);
              }}>Vincular cadastro do cliente</Button>}
              <span className="text-xs text-[#5B6472] tabular-nums">
                · Contrato {formatBRL(activeProject.contractValue)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={activeProject.contractKind || 'Principal'} />
              <StatusBadge label={activeProject.status} />
              {activeProject.planningStatus === 'Aguardando modelo de cronograma' && (
                <StatusBadge label="Aguardando modelo de cronograma" tone="warn" />
              )}
            </div>
          </div>

          {awaitingScheduleTemplate && (
            <section className="bg-[#FBF1DC]/45 border border-[#9A6212]/40 rounded-xl p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#14181F]">
                    Obra contratada aguardando modelo de cronograma
                  </h2>
                  <p className="text-xs text-[#5B6472] mt-0.5">
                    Orçamento confirmado! Escolha o modelo de EAP e cronograma abaixo para gerar as etapas iniciais, preservar a linha de base e iniciar a execução da obra.
                  </p>
                </div>
                <StatusBadge label={`${activeProject.contractKind || 'Principal'} · Contratada`} />
              </div>

              <ScheduleTemplateOptions value={tplType} onChange={setTplType} />

              {getContractCostBudget(activeProject) === null && (
                <p className="text-sm text-[#5B6472]">Custo orçado · Sem dados. Você pode gerar o cronograma e registrar os custos nos pacotes da EAP.</p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label htmlFor="tpl-start" className="text-xs font-semibold text-[#14181F]">Data de início</label>
                  <input
                    type="date"
                    id="tpl-start"
                    value={tplStart}
                    onChange={(e) => setTplStart(e.target.value)}
                    className="rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="tpl-months" className="text-xs font-semibold text-[#14181F]">Prazo (meses)</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    placeholder="Duração do modelo"
                    id="tpl-months"
                    value={tplMonths}
                    onChange={(e) => setTplMonths(e.target.value)}
                    className="rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <RegisteredBySelect value={tplActor} onChange={setTplActor} id="tpl-actor" />
              </div>

              {tplError && (
                <AlertNote tone="bad" title="Erro ao aplicar modelo">
                  {tplError}
                </AlertNote>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={tplSaving}
                  onClick={async () => {
                    if (!activeProject) return;
                    setTplSaving(true);
                    setTplError(null);
                    try {
                      await applyScheduleTemplateToProject({
                        uid,
                        actor: tplActor,
                        project: activeProject,
                        templateType: tplType,
                        startDate: tplStart,
                        estimatedMonths: tplMonths ? Number(tplMonths) : undefined,
                        pops: data.pops,
                      });
                    } catch (err) {
                      setTplError(
                        err instanceof Error ? err.message : 'Erro ao gerar cronograma da obra.'
                      );
                    } finally {
                      setTplSaving(false);
                    }
                  }}
                  className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] disabled:opacity-45 cursor-pointer"
                >
                  {tplSaving ? 'Gerando etapas...' : 'Aplicar modelo e iniciar cronograma'}
                </button>
              </div>
            </section>
          )}

          <div className="flex flex-wrap gap-2 md:hidden">
            <button type="button" onClick={() => setTab('Diário de obra')} className="rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-semibold text-[#1F3A5F] focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
              Diário de obra
            </button>
            <button type="button" onClick={() => setTab('Etapas em campo')} className="rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-semibold text-[#1F3A5F] focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
              Etapas em campo
            </button>
          </div>
          <Tabs items={PLAN_TABS} active={tab} onChange={setTab} />
          {['EAP', 'Cronograma', 'Kanban'].includes(tab) && <ListToolbar label="etapas" list={stages}
            projects={data.projects} projectSelection={{ value: activeProject.id, change: (id) => { setSelectedPhase(''); onSelectProject(id); } }}
            phase={tab === 'Kanban' ? { value: selectedPhase, change: setSelectedPhase,
              options: [...new Set(projectStages.map((stage) => stage.phase))] } : undefined} />}

          {tab === 'Visão geral' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {[
                  ['1 · Iniciação', 'Escopo e valor do orçamento', 'done'],
                  [
                    '2 · Planejamento',
                    awaitingScheduleTemplate
                      ? 'Aguardando modelo de cronograma'
                      : 'EAP, prazos e linha de base',
                    awaitingScheduleTemplate ? 'on' : 'done',
                  ],
                  [
                    '3 · Execução',
                    'Execução das etapas planejadas',
                    awaitingScheduleTemplate ? 'idle' : activeProject.status === 'Concluída' ? 'done' : 'on',
                  ],
                  [
                    '4 · Monitoramento',
                    'Curva S e replanejamento',
                    awaitingScheduleTemplate ? 'idle' : activeProject.status === 'Concluída' ? 'done' : 'on',
                  ],
                  [
                    '5 · Encerramento',
                    'Resultado real e garantia',
                    activeProject.status === 'Concluída' ? 'done' : 'idle',
                  ],
                ].map(([t, sub, st]) => (
                  <div
                    key={t}
                    className={`rounded-xl p-3 border text-left ${
                      st === 'on'
                        ? 'border-2 border-[#1F3A5F] bg-[#E6EEFB]'
                        : 'border-[#E4E1DA] bg-white'
                    }`}
                  >
                    <strong className="block text-[13px] text-[#14181F]">
                      {t}
                    </strong>
                    <span className="block text-xs text-[#5B6472]">{sub}</span>
                    <span className="mt-1 block text-xs font-semibold text-[#1F3A5F]">{st === 'done' ? 'Concluída' : st === 'on' ? 'Em andamento' : 'A iniciar'}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  label="Progresso real"
                  value={projectProgress !== null ? `${projectProgress}%` : 'Sem dados'}
                  subtext={projectStages.length ? `${projectStages.filter((s) => s.status === 'Concluída').length} de ${projectStages.length} etapas` : undefined}
                />
                <KpiCard
                  label="Etapas críticas"
                  value={projectStages.length > 0 ? String(criticalIds.size) : 'Sem dados'}
                  subtext="Folga zero no cronograma"
                />
                <KpiCard
                  label="Etapas atrasadas"
                  value={projectStages.length ? String(delayedStages.length) : 'Sem dados'}
                  subtext={
                    delayedStages.length > 0
                      ? 'Fim previsto após a linha de base'
                      : projectStages.length ? 'Sem desvios da linha de base' : undefined
                  }
                />
                <KpiCard
                  label="Entrega prevista"
                  value={schedule?.forecastEndDate ? formatDateBR(schedule.forecastEndDate) : 'Sem dados'}
                  subtext={`Linha de base · ${projectStages.length && (originalBaseline?.endDate || activeProject.baselineEndDate) ? formatDateBR(originalBaseline?.endDate || activeProject.baselineEndDate) : 'Sem dados'}`}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-[#14181F]">
                      Progresso por fase (EAP)
                    </h2>
                    <div className="flex items-center gap-2">
                      <StatusBadge label={activeProject.contractKind || 'Principal'} />
                      <StatusBadge label={activeProject.status} />
                    </div>
                  </div>
                  {phasesList.length === 0 ? (
                    <p className="text-sm text-[#5B6472]">Adicione etapas à EAP para acompanhar o avanço.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {phasesList.map((ph) => (
                        <div key={ph.fase} className="flex flex-col gap-1">
                          <div className="flex justify-between text-xs">
                            <span className="font-medium text-[#14181F]">{ph.fase}</span>
                            <strong className="tabular-nums">{ph.progressoMedioPct}%</strong>
                          </div>
                          <ProgressBar pct={ph.progressoMedioPct} />
                        </div>
                      ))}
                    </div>
                  )}
                  {curvaSData.possuiDados && (
                    <div className="grid min-w-0 gap-2 border-t border-[#E4E1DA] pt-4">
                      <h3 className="text-sm font-semibold">Progresso acumulado</h3>
                      <ScheduleProgressChart curve={curvaSData} observations={progressObservations} />
                    </div>
                  )}
                </section>

                <div className="flex flex-col gap-4">
                  <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-[#14181F]">Curva S (prazo)</h2>
                      <StatusBadge
                        label={curvaSData.statusPrazo}
                        tone={
                          curvaSData.statusPrazo === 'Atrasado'
                            ? 'bad'
                            : curvaSData.statusPrazo === 'Em atenção'
                            ? 'warn'
                            : curvaSData.statusPrazo === 'Sem dados'
                            ? 'neutral'
                            : 'ok'
                        }
                      />
                    </div>
                    {!curvaSData.possuiDados ? (
                      <p className="text-xs text-[#5B6472]">Sem etapas para calcular a Curva S.</p>
                    ) : (
                      <div className="flex flex-col gap-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[#5B6472]">Planejado (linha de base)</span>
                          <strong className="tabular-nums">
                            {formatPercentBR(curvaSData.progressoPlanejadoPct)}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#5B6472]">Realizado ponderado</span>
                          <strong className="tabular-nums">
                            {formatPercentBR(curvaSData.progressoRealizadoPct)}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#5B6472]">Índice de prazo (SPI)</span>
                          <strong className="tabular-nums">
                            {curvaSData.indicePrazo !== null
                              ? curvaSData.indicePrazo.toFixed(2).replace('.', ',')
                              : 'Sem dados'}
                          </strong>
                        </div>
                      </div>
                    )}
                  </section>

                  <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
                    <h2 className="text-base font-semibold text-[#14181F]">Caminho crítico</h2>
                    {scheduleCycle ? <p role="alert" className="text-sm text-[#B42318]">{scheduleCycle}</p> : criticalIds.size === 0 ? (
                      <p className="text-xs text-[#5B6472]">Sem etapas críticas definidas.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {projectStages
                          .filter((s) => criticalIds.has(s.id))
                          .map((s) => (
                            <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-medium text-[#14181F] truncate">
                                {s.wbsCode} · {s.name}
                              </span>
                              <span className="shrink-0 text-[#5B6472]">Folga {schedule?.details.get(s.id)?.folga ?? 0} sem.</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </section>
                  <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
                    <h2 className="text-base font-semibold text-[#14181F]">Próximos marcos</h2>
                    {schedule?.milestones.length ? (
                      <ul className="grid gap-2">
                        {schedule.milestones.slice(0, 5).map(({ stage, date }) => (
                          <li key={stage.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <div className="grid gap-0.5">
                              <span>{stage.wbsCode} · {stage.name}</span>
                              <span className="text-[#5B6472]">{date ? formatDateBR(date) : 'Sem dados'}</span>
                            </div>
                            {date && activeProject.status !== 'Concluída' &&
                              <WhatsAppShortcut uid={uid} client={data.clients.find((row) => row.id === activeProject.clientId)}
                                templates={data.settings?.whatsappTemplates} label="Avisar pelo WhatsApp"
                                target={{ model: 'milestone', projectId: activeProject.id, sourceId: stage.id }}
                                values={{ obra: activeProject.name, marco: stage.name, vencimento: formatDateBR(date) }} />}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-[#5B6472]">{projectStages.length ? 'Nenhum marco pendente.' : 'Sem dados'}</p>}
                  </section>
                </div>
              </div>
            </>
          )}

          {tab === 'EAP' && (
            <section className="grid gap-4" aria-label="Estrutura analítica do projeto">
              <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E4E1DA] bg-white p-4">
                <div>
                  <h2 className="text-base font-semibold text-[#14181F]">Estrutura analítica do projeto</h2>
                  <p className="text-sm text-[#5B6472]">Custo orçado da obra · {formatBRL(hasEapBudget ? totalEapBudget : null)}</p>
                </div>
                {!awaitingScheduleTemplate && <button type="button" onClick={openCreateStage} className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm font-semibold">Adicionar pacote</button>}
              </header>
              {groupStages(stages.rows).map(([phase, deliveries]) => (
                <section key={phase} className="overflow-hidden rounded-xl border border-[#E4E1DA] bg-white">
                  <div className="flex flex-wrap justify-between gap-2 bg-[#E6EEFB] px-4 py-3">
                    <h3 className="text-sm font-bold text-[#14181F]">{phase}</h3>
                    <strong className="text-sm text-[#1F3A5F]">{formatBRL(hasEapBudget ? getWorkPackageBudget([...deliveries.values()].flat()) : null)}</strong>
                  </div>
                  {[...deliveries].map(([delivery, packages]) => (
                    <div key={delivery} className="grid gap-2 border-t border-[#E4E1DA] p-4">
                      <div className="flex flex-wrap justify-between gap-2">
                        <h4 className="text-sm font-semibold">{delivery}</h4>
                        <span className="text-sm text-[#5B6472]">{formatBRL(hasEapBudget ? getWorkPackageBudget(packages) : null)}</span>
                      </div>
                      <div className="grid gap-1">
                        {packages.map((stage) => {
                          const pop = data.pops.find((item) => item.id === stage.popId);
                          return (
                            <button key={stage.id} type="button" onClick={() => openEditStage(stage)}
                              className="grid items-center gap-2 rounded-lg border border-[#E4E1DA] p-3 text-left text-sm hover:bg-[#F6F5F2] focus-visible:ring-2 focus-visible:ring-[#1F3A5F] md:grid-cols-[2fr_1fr_auto_auto_1fr_auto]">
                              <strong className="min-w-0 break-words text-[#14181F]">{stage.wbsCode} · {stage.name}</strong>
                              <span className="text-[#5B6472]">{stage.responsible || 'Sem responsável'}</span>
                              <span>{stage.isMilestone ? 'Marco' : `${stage.durationWeeks} sem.`}</span>
                              <span className="tabular-nums">{formatBRL(hasEapBudget ? stage.budgetedCost : null)}</span>
                              <span className="text-[#5B6472]">{pop ? `POP · ${pop.title}` : 'Sem POP vinculado'}</span>
                              <span><StatusBadge label={stage.status} /></span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
              {!stages.rows.length && <p className="text-sm text-[#5B6472]">{projectStages.length ? 'Nenhuma etapa neste filtro.' : 'Sem dados na EAP.'}</p>}
            </section>
          )}

          {tab === 'Cronograma' && schedule && (
            <ProjectScheduleView
              key={activeProject.id}
              uid={uid}
              project={activeProject}
              stages={projectStages}
              visibleStages={stages.rows}
              schedule={schedule}
              baselines={data.baselines ?? []}
              cycle={scheduleCycle}
              onEdit={openEditStage}
            />
          )}

          {tab === 'Kanban' && schedule && (
            <ProjectKanban key={activeProject.id} uid={uid} project={activeProject} stages={visibleProjectStages} visibleStages={stages.rows.filter((stage) => !selectedPhase || stage.phase === selectedPhase)} data={data} schedule={schedule} onEdit={openEditStage} />
          )}
          {tab === 'Materiais do cliente' && schedule && (
            <ProjectMaterialsView key={activeProject.id} uid={uid} project={activeProject} stages={projectStages} schedule={schedule} data={data} />
          )}
          {tab === 'Recursos' && (
            <ProjectResources key={activeProject.id} uid={uid} project={activeProject} stages={projectStages} data={data} />
          )}
          {tab === 'Riscos' && schedule && (
            <ProjectRisks key={activeProject.id} uid={uid} project={activeProject} stages={visibleProjectStages} data={data} schedule={schedule} onEdit={openEditStage} onSchedule={() => setTab('Cronograma')} />
          )}

          {tab === 'Diário de obra' && (
            <ProjectDiary key={activeProject.id} uid={uid} project={activeProject} logs={data.dailyLogs} />
          )}
          {tab === 'Etapas em campo' && (
            <FieldStages key={activeProject.id} uid={uid} project={activeProject} stages={projectStages} pops={data.pops}
              stageSchema={stageSchema} projects={data.projects} onSelectProject={onSelectProject} materialBlocks={schedule?.materials.blockedStages} />
          )}

          {tab === 'Encerramento' && (
            <ProjectClosureView key={activeProject.id} uid={uid} project={activeProject} data={data} onAftercare={() => setTab('Pós-obra')} />
          )}
          {tab === 'Pós-obra' && <PostConstructionView key={activeProject.id} uid={uid} data={data} projectId={activeProject.id} />}
        </>
      )}

      {/* Modal: Nova Obra a partir de modelo */}
      <Modal
        open={newProjModal}
        onClose={() => setNewProjModal(false)}
        title="Nova obra · escolha o modelo de cronograma"
        maxWidth="max-w-2xl"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!npName.trim()) return;
            setNpSaving(true);
            setNpError(null);
            try {
              const id = await createProjectFromTemplate(uid, npActor, {
                name: npName,
                clientName: npClientName,
                type: npType,
                contractKind: npContractKind,
                contractValue: Number(npValue),
                costBudget: Number(npBudget),
                startDate: npStart,
                estimatedMonths: npMonths ? Number(npMonths) : undefined,
                pops: data.pops,
              });
              onSelectProject(id);
              setTab('Visão geral');
              setNpName('');
              setNpClientName('');
              setNpValue('');
              setNpBudget('');
              setNpMonths('');
              setNewProjModal(false);
            } catch (err) {
              setNpError(err instanceof Error ? err.message : 'Erro ao criar a obra.');
            } finally {
              setNpSaving(false);
            }
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="np-name" className="text-[13px] font-semibold">Nome da obra</label>
              <input
                type="text"
                required
                id="np-name"
                value={npName}
                onChange={(e) => setNpName(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="np-client" className="text-[13px] font-semibold">Cliente</label>
              <input
                type="text"
                id="np-client"
                value={npClientName}
                onChange={(e) => setNpClientName(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="np-kind" className="text-[13px] font-semibold">Tipo de contrato</label>
              <select
                id="np-kind"
                value={npContractKind}
                onChange={(e) => setNpContractKind(e.target.value as ProjectContractKind)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm bg-white"
              >
                <option value="Principal">Principal</option>
                <option value="Satélite">Satélite</option>
              </select>
            </div>
          </div>
          <ScheduleTemplateOptions value={npType} onChange={(type) => {
            setNpType(type);
            setNpContractKind(type === 'Obra satélite' ? 'Satélite' : 'Principal');
          }} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="np-value" className="text-[13px] font-semibold">Valor do contrato (R$)</label>
              <input
                type="number"
                required
                min={0}
                step="0.01"
                id="np-value"
                value={npValue}
                onChange={(e) => setNpValue(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Custo orçado da obra (R$)
              <input type="number" required min={0} step="0.01" value={npBudget} onChange={(e) => setNpBudget(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums" />
            </label>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="np-start" className="text-[13px] font-semibold">Início</label>
              <input
                type="date"
                id="np-start"
                required
                value={npStart}
                onChange={(e) => setNpStart(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="np-months" className="text-[13px] font-semibold">Prazo (meses)</label>
              <input
                type="number"
                min={1}
                max={120}
                placeholder="Duração do modelo"
                id="np-months"
                value={npMonths}
                onChange={(e) => setNpMonths(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
          </div>
          <RegisteredBySelect value={npActor} onChange={setNpActor} id="np-actor" />
          {npError && <p role="alert" className="text-sm text-[#B42318]">{npError}</p>}
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setNewProjModal(false)}
              className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={npSaving}
              className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer"
            >
              {npSaving ? 'Criando...' : 'Criar cronograma'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={linkOpen && Boolean(activeProject)} onClose={() => setLinkOpen(false)} title="Vincular cadastro do cliente">
        <form className="grid gap-3 text-sm" onSubmit={async (event) => {
          event.preventDefault();
          if (!activeProject || !linkClient || linkSaving) return;
          setLinkSaving(true); setLinkError('');
          try {
            await linkProjectClient(uid, linkActor, activeProject.id, linkClient);
            setLinkOpen(false);
          } catch (error) {
            setLinkError(error instanceof Error ? error.message : 'Não foi possível vincular o cliente.');
          } finally { setLinkSaving(false); }
        }}>
          <label className="grid gap-1 font-semibold">Cliente cadastrado
            <select required className="min-w-0 rounded-lg border border-[#E4E1DA] p-2 text-sm" value={linkClient}
              onChange={(event) => setLinkClient(event.target.value)}>
              <option value="">Selecione o cliente</option>
              {data.clients.map((client) => <option key={client.id} value={client.id}>
                {[client.name, client.city, client.phone].filter(Boolean).join(' · ')}
              </option>)}
            </select>
          </label>
          <RegisteredBySelect value={linkActor} onChange={setLinkActor} id="project-link-client-actor" />
          {linkError && <p role="alert" className="text-[#B42318]">{linkError}</p>}
          <Button type="submit" disabled={!linkClient || linkSaving} className="justify-self-start">Vincular cliente</Button>
        </form>
      </Modal>

      <Modal open={Boolean(linkedStage)} onClose={() => setRecordId('')}
        title={linkedStage ? 'Etapa · ' + linkedStage.name : 'Etapa'}>
        {linkedStage && <div className="grid gap-3 text-sm">
          <StatusBadge label={linkedStage.status} />
          {schedule?.materials.blockedStages.has(linkedStage.id) && <p>Categoria do atraso · Material do cliente</p>}
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt>Obra</dt><dd>{activeProject?.name}</dd></div>
            <div><dt>Código EAP</dt><dd>{linkedStage.wbsCode}</dd></div>
            <div><dt>Fase</dt><dd>{linkedStage.phase}</dd></div>
            <div><dt>{linkedStage.isMilestone ? 'Data do marco' : 'Término previsto'}</dt><dd>{formatDateBR(stageDeadline(linkedStage))}</dd></div>
            {linkedStage.materialExpectedDate && <div><dt>Material prometido para</dt><dd>{formatDateBR(linkedStage.materialExpectedDate)}</dd></div>}
          </dl>
          {linkedStage.isMilestone && activeProject && activeProject.status !== 'Concluída' && stageDeadline(linkedStage) &&
            <div className="justify-self-start">
              <WhatsAppShortcut uid={uid} client={data.clients.find((row) => row.id === activeProject.clientId)}
                templates={data.settings?.whatsappTemplates} label="Avisar pelo WhatsApp"
                target={{ model: 'milestone', projectId: activeProject.id, sourceId: linkedStage.id }}
                values={{ obra: activeProject.name, marco: linkedStage.name, vencimento: formatDateBR(stageDeadline(linkedStage)) }} />
            </div>}
          {activeProject?.status !== 'Concluída' && <button type="button" className="justify-self-start font-semibold text-[#1F3A5F] underline"
            onClick={() => { setRecordId(''); openEditStage(linkedStage); }}>Editar etapa</button>}
        </div>}
      </Modal>

      {/* Modal: Nova / Editar Etapa com detecção de ciclo */}
      <Modal
        open={stageModalOpen}
        onClose={() => setStageModalOpen(false)}
        title={editingStage ? `Etapa · ${editingStage.name}` : 'Nova etapa'}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveStage} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-code" className="text-xs font-semibold">Código EAP</label>
              <input
                type="text"
                required
                id="stage-code"
                value={stWbs}
                onChange={(e) => setStWbs(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2 flex flex-col gap-1">
              <label htmlFor="stage-phase" className="text-xs font-semibold">Fase da EAP</label>
              <input
                type="text"
                required
                id="stage-phase"
                value={stPhase}
                onChange={(e) => setStPhase(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm"
              />
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs font-semibold">
            Entrega da EAP
            <input type="text" required={!editingStage} maxLength={120} value={stDeliverable} onChange={(e) => setStDeliverable(e.target.value)}
              className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm font-normal" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-name" className="text-xs font-semibold">Pacote de trabalho</label>
              <input
                type="text"
                required
                id="stage-name"
                value={stName}
                onChange={(e) => setStName(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-owner" className="text-xs font-semibold">Responsável</label>
              <input
                type="text"
                id="stage-owner"
                value={stResp}
                onChange={(e) => setStResp(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-start" className="text-xs font-semibold">Início mais cedo (semana)</label>
              <input
                type="number"
                min={0}
                id="stage-start"
                value={stStartWeek}
                onChange={(e) => setStStartWeek(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-duration" className="text-xs font-semibold">Duração (semanas)</label>
              <input
                type="number"
                min={0}
                id="stage-duration"
                value={stDurWeeks}
                onChange={(e) => setStDurWeeks(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-progress" className="text-xs font-semibold">Progresso (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                id="stage-progress"
                value={stProgress}
                onChange={(e) => setStProgress(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-budget" className="text-xs font-semibold">Custo orçado (R$)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                id="stage-budget"
                value={stBudget}
                onChange={(e) => setStBudget(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-status" className="text-xs font-semibold">Situação</label>
              <select
                id="stage-status"
                value={stStatus}
                onChange={(e) => setStStatus(e.target.value as StageStatus)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm bg-white"
              >
                <option value="A fazer">A fazer</option>
                <option value="Em andamento">Em andamento</option>
                <option value="Aguardando material">Aguardando</option>
                <option value="Em conferência">Em conferência</option>
                <option value="Concluída">Concluída</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-pop" className="text-xs font-semibold">POP vinculado</label>
              <select
                id="stage-pop"
                value={stPopId}
                onChange={(e) => { setStPopId(e.target.value); setStChecklistDone([]); }}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm bg-white"
              >
                <option value="">Sem POP vinculado</option>
                {data.pops.filter((p) => isPublishedPop(p) || p.id === stPopId).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.version})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dependencies with cycle validation */}
          {projectStages.filter((s) => s.id !== editingStage?.id).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold">Depende de (término-início)</label>
              <div
                className={`flex flex-wrap gap-2 p-2.5 rounded-lg border ${
                  cycleError ? 'border-[#B42318] bg-[#FDECEA]/40' : 'border-[#E4E1DA]'
                }`}
              >
                {projectStages
                  .filter((s) => s.id !== editingStage?.id)
                  .map((other) => {
                    const checked = stDeps.includes(other.id);
                    return (
                      <label
                        key={other.id}
                        className="inline-flex items-center gap-1.5 text-xs bg-white border border-[#E4E1DA] rounded-md px-2 py-1 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setStDeps((prev) => [...prev, other.id]);
                            else setStDeps((prev) => prev.filter((id) => id !== other.id));
                          }}
                        />
                        <span>
                          {other.wbsCode} · {other.name}
                        </span>
                      </label>
                    );
                  })}
              </div>
              {cycleError && <span role="alert" className="text-xs font-medium text-[#B42318]">{cycleError}</span>}
            </div>
          )}

          {/* POP acceptance checklist */}
          {(() => {
            const pop = data.pops.find((p) => p.id === stPopId);
            const review = linkedPopChecklist({ popId: stPopId, status: stStatus, popReview: editingStage?.popReview }, pop);
            if (!review?.acceptanceCriteria.length) return null;
            return (
              <div className="border border-[#E4E1DA] rounded-xl p-3 flex flex-col gap-2">
                <strong className="text-xs text-[#14181F]">
                  Checklist de qualidade do POP · {pop?.title || 'Procedimento vinculado'} · {review.version}
                </strong>
                {review.acceptanceCriteria.map((crit) => {
                  const done = stChecklistDone.includes(crit);
                  return (
                    <label key={crit} className="inline-flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={(e) => {
                          if (e.target.checked) setStChecklistDone((p) => [...p, crit]);
                          else setStChecklistDone((p) => p.filter((x) => x !== crit));
                        }}
                      />
                      <span>{crit}</span>
                    </label>
                  );
                })}
              </div>
            );
          })()}

          {/* Delay justification */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-delay-category" className="text-xs font-semibold">Categoria do atraso</label>
              <select
                id="stage-delay-category" value={stDelayCat}
                onChange={(e) => setStDelayCat(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm bg-white"
              >
                <option value="">Sem atraso</option>
                {DELAY_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-delay-reason" className="text-xs font-semibold">Justificativa do atraso</label>
              <input
                type="text"
                id="stage-delay-reason" maxLength={500} value={stDelayJust}
                onChange={(e) => setStDelayJust(e.target.value)}
                placeholder="Descreva o motivo do desvio"
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm"
              />
            </div>
          </div>

          {(stStatus === 'Aguardando material' || stDelayCat === 'Material do cliente' || stMatDate) && (
            <label className="grid gap-1 text-xs font-semibold">Chegada prevista do material do cliente
              <input type="date" value={stMatDate} onChange={(event) => setStMatDate(event.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm font-normal" />
            </label>
          )}
          {editingStage && (() => {
            const week = plannedWeeks(scheduleDate)[0];
            const people = data.employees.filter((employee) => {
              const cell = resolveTeamWeek(employee, week, data);
              return cell.allocation?.stageId === editingStage.id && !cell.vacation && !cell.conflict && cell.started;
            });
            return <p className="text-xs text-[#5B6472]"><strong>Colaboradores na semana · </strong>
              {people.length ? people.map((employee) => employee.name).join(', ') : 'Sem atribuições'}
            </p>;
          })()}
          <RegisteredBySelect value={stActor} onChange={setStActor} id="stage-actor" />
          {stError && (
            <AlertNote tone="bad" title="Atenção">
              {stError}
            </AlertNote>
          )}
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setStageModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={stSaving || Boolean(cycleError)}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold disabled:opacity-45 cursor-pointer"
            >
              {stSaving ? 'Salvando...' : 'Salvar etapa'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
