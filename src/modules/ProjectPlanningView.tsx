import { useEffect, useMemo, useState } from 'react';
import { ProjectScheduleView, ScheduleProgressChart } from './ProjectScheduleView';
import {
  AlertNote,
  EmptySection,
  KpiCard,
  Modal,
  PageHeader,
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
  saveProjectStage,
  updateRecord,
} from '../services/pilotisService';
import type {
  ActorRole,
  PilotisDataState,
  ProjectContractKind,
  ProjectStage,
  ProjectType,
  StageStatus,
  WeatherType,
} from '../types/pilotis';
import {
  calcularCurvaSObra,
  describeScheduleCycle,
  getProjectSchedule,
  getRecordedScheduleProgress,
  getWorkPackageBudget,
  planningTodayISO,
  roundCents,
  calcularDreObra,
  calculateTeamPayroll,
  formatMonthLabelBR,
  monthKey,
  resolveTeamWeek,
  weekStartingOn,
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
  'Recursos',
  'Riscos',
  'Diário de obra',
  'Encerramento',
];

const KANBAN_COLS: Array<{ status: StageStatus; subtitle: string }> = [
  { status: 'A fazer', subtitle: 'Pronta para iniciar' },
  { status: 'Em andamento', subtitle: 'Limite WIP: 4' },
  { status: 'Aguardando material', subtitle: 'Material do cliente' },
  { status: 'Em conferência', subtitle: 'Checklist do POP' },
  { status: 'Concluída', subtitle: 'Entregue e conferida' },
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
  const [tab, setTab] = useState('Visão geral');
  const [projectFilter, setProjectFilter] = useState('Todas');
  const [kanbanPhaseFilter, setKanbanPhaseFilter] = useState('Todas as fases');

  // New Project from Template Modal
  const [newProjModal, setNewProjModal] = useState(false);
  const [npName, setNpName] = useState('');
  const [npClientName, setNpClientName] = useState('');
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

  // Daily Log state (with offline queue support)
  const [logDate, setLogDate] = useState(todayISO());
  const [logCount, setLogCount] = useState('0');
  const [logWeather, setLogWeather] = useState<WeatherType>('Sol');
  const [logActivities, setLogActivities] = useState('');
  const [logOccurrences, setLogOccurrences] = useState('');
  const [logActor, setLogActor] = useState<ActorRole>('Sócio');
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [offlineQueuedCount, setOfflineQueuedCount] = useState(0);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

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
    () => activeProject ? getProjectSchedule(activeProject, projectStages, scheduleDate) : null,
    [activeProject, projectStages, scheduleDate],
  );
  const originalBaseline = data.baselines?.find((baseline) => baseline.projectId === activeProject?.id && baseline.version === 1);
  const criticalIds = new Set(schedule?.criticalPath.etapasCriticas ?? []);
  const projectProgress = activeProject ? calcularProgressoObra(activeProject.id, projectStages) : null;
  const curvaSData = useMemo(() => calcularCurvaSObra(
    projectStages, schedule?.referenceWeek, originalBaseline, tab === 'Visão geral',
  ), [projectStages, schedule?.referenceWeek, originalBaseline, tab]);
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

  const projectLogs = activeProject
    ? data.dailyLogs
        .filter((l) => l.projectId === activeProject.id)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];

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

  function openEditStage(st: ProjectStage) {
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
    setStDelayCat(st.delayCategory || '');
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
    const isDelayed = startNum + durNum > baseStart + baseDur;

    if (isDelayed && (!stDelayCat.trim() || !stDelayJust.trim())) {
      setStError('Etapas deslocadas além da linha de base exigem categoria e justificativa do atraso.');
      return;
    }

    // Check POP acceptance checklist if marking Concluída
    const linkedPop = data.pops.find((p) => p.id === stPopId);
    if (
      stStatus === 'Concluída' &&
      linkedPop &&
      linkedPop.acceptanceCriteria.length > 0 &&
      stChecklistDone.length < linkedPop.acceptanceCriteria.length
    ) {
      setStError('Complete todos os critérios de aceite do POP vinculado antes de concluir a etapa.');
      return;
    }

    // Check dependency gate if moving to Em andamento
    if (stStatus === 'Em andamento' && stDeps.length > 0) {
      const pendingDep = stDeps
        .map((id) => projectStages.find((s) => s.id === id))
        .find((s) => s && s.status !== 'Concluída');
      if (pendingDep) {
        setStError(
          `Não é possível iniciar: a etapa anterior "${pendingDep.name}" ainda não foi concluída.`
        );
        return;
      }
    }

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

  async function handleSaveDailyLog(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProject || !logActivities.trim()) return;
    const payload = {
      projectId: activeProject.id,
      date: logDate,
      presentCount: Number(logCount) || 0,
      weather: logWeather,
      activities: clampStr(logActivities, 1500),
      occurrences: clampStr(logOccurrences, 1000),
      photoNotes: [],
    };

    if (!isOnline) {
      const queueKey = 'pilotis_offline_logs';
      const existingQueue = JSON.parse(localStorage.getItem(queueKey) || '[]');
      existingQueue.push({ ...payload, actor: logActor });
      localStorage.setItem(queueKey, JSON.stringify(existingQueue));
      setOfflineQueuedCount(existingQueue.length);
      setLogActivities('');
      setLogOccurrences('');
      return;
    }

    await createRecord('dailyLogs', uid, logActor, payload, `Diário de obra · ${activeProject.name}`);
    setLogActivities('');
    setLogOccurrences('');
  }

  async function handleCloseProject() {
    if (!activeProject) return;
    await updateRecord(
      'projects',
      activeProject.id,
      uid,
      'Sócio',
      {
        status: 'Concluída',
        warrantyStartDate: todayISO(),
      },
      `Obra encerrada: ${activeProject.name}`,
      'Em execução',
      'Concluída'
    );
    if (activeProject.clientId) {
      await updateRecord(
        'clients',
        activeProject.clientId,
        uid,
        'Sócio',
        { status: 'Em garantia' },
        `Cliente entrou em garantia: ${activeProject.clientName}`,
        'Ativo',
        'Em garantia'
      );
    }
  }

  const totalEapBudget = getWorkPackageBudget(projectStages);

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
            <button
              type="button"
              onClick={() => setNewProjModal(true)}
              className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] whitespace-nowrap cursor-pointer"
            >
              Nova obra
            </button>
            {activeProject && !awaitingScheduleTemplate && (
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
                  const next = getProjectSchedule(project, stages).nextStage;
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
                      <button type="button" aria-label={`Abrir planejamento de ${project.name}`} onClick={() => { onSelectProject(project.id); setTab('Visão geral'); setKanbanPhaseFilter('Todas as fases'); }}
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

          <Tabs items={PLAN_TABS} active={tab} onChange={setTab} />

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
                          <li key={stage.id} className="flex justify-between gap-3 text-sm">
                            <span>{stage.wbsCode} · {stage.name}</span>
                            <span className="shrink-0 text-[#5B6472]">{date ? formatDateBR(date) : 'Sem dados'}</span>
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
                  <p className="text-sm text-[#5B6472]">Custo orçado da obra · {projectStages.length ? formatBRL(totalEapBudget) : 'Sem dados'}</p>
                </div>
                {!awaitingScheduleTemplate && <button type="button" onClick={openCreateStage} className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm font-semibold">Adicionar pacote</button>}
              </header>
              {groupStages(projectStages).map(([phase, deliveries]) => (
                <section key={phase} className="overflow-hidden rounded-xl border border-[#E4E1DA] bg-white">
                  <div className="flex flex-wrap justify-between gap-2 bg-[#E6EEFB] px-4 py-3">
                    <h3 className="text-sm font-bold text-[#14181F]">{phase}</h3>
                    <strong className="text-sm text-[#1F3A5F]">{formatBRL(getWorkPackageBudget([...deliveries.values()].flat()))}</strong>
                  </div>
                  {[...deliveries].map(([delivery, packages]) => (
                    <div key={delivery} className="grid gap-2 border-t border-[#E4E1DA] p-4">
                      <div className="flex flex-wrap justify-between gap-2">
                        <h4 className="text-sm font-semibold">{delivery}</h4>
                        <span className="text-sm text-[#5B6472]">{formatBRL(getWorkPackageBudget(packages))}</span>
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
                              <span className="tabular-nums">{formatBRL(stage.budgetedCost)}</span>
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
              {!projectStages.length && <p className="text-sm text-[#5B6472]">Sem dados na EAP.</p>}
            </section>
          )}

          {tab === 'Cronograma' && schedule && (
            <ProjectScheduleView
              key={activeProject.id}
              uid={uid}
              project={activeProject}
              stages={projectStages}
              schedule={schedule}
              baselines={data.baselines ?? []}
              cycle={scheduleCycle}
              onEdit={openEditStage}
            />
          )}

          {tab === 'Kanban' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SegmentedControl
                  items={['Todas as fases', ...phasesList.map((p) => p.fase)]}
                  active={kanbanPhaseFilter}
                  onChange={setKanbanPhaseFilter}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {KANBAN_COLS.map((col) => {
                  const cards = projectStages.filter(
                    (s) =>
                      s.status === col.status &&
                      (kanbanPhaseFilter === 'Todas as fases' || s.phase === kanbanPhaseFilter)
                  );
                  return (
                    <div
                      key={col.status}
                      className="bg-[#F0EEE9] rounded-xl p-3 flex flex-col gap-2.5 min-h-[240px]"
                    >
                      <div className="flex items-center justify-between px-1">
                        <strong className="text-xs font-bold text-[#14181F]">{col.status}</strong>
                        <span className="text-[11px] text-[#5B6472]">
                          {col.status === 'Em andamento' ? `${cards.length} de 4` : cards.length}
                        </span>
                      </div>

                      {cards.map((st) => {
                        const isCrit = criticalIds.has(st.id);
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => openEditStage(st)}
                            className="text-left bg-white border border-[#E4E1DA] rounded-xl p-3 flex flex-col gap-2 hover:border-[#1F3A5F] cursor-pointer"
                          >
                            <strong className="text-[13px] text-[#14181F] leading-snug">
                              {st.name}
                            </strong>
                            <div className="flex flex-wrap gap-1">
                              <StatusBadge label={st.phase.split('·')[0].trim()} tone="info" />
                              {isCrit && <StatusBadge label="Crítica" tone="crit" />}
                              {st.delayJustification && (
                                <StatusBadge label={st.delayCategory || 'Atrasada'} tone="bad" />
                              )}
                            </div>
                            <ProgressBar pct={st.progressPct} />
                            <span className="text-[11px] text-[#5B6472]">
                              {st.responsible || 'Sem responsável'} · {st.progressPct}%
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              <AlertNote tone="soft" title="Regras do quadro">
                Mover uma etapa para “Concluída” exige o checklist de qualidade do POP completo. Mover para “Em andamento” é bloqueado se a etapa anterior da dependência ainda não terminou.
              </AlertNote>
            </div>
          )}

          {tab === 'Recursos' && (() => {
            const today = todayISO();
            const month = monthKey(today);
            const payroll = calculateTeamPayroll(data, month);
            const people = data.employees.filter((employee) => {
              const cell = resolveTeamWeek(employee, weekStartingOn(today), data);
              return cell.project?.id === activeProject.id && !cell.vacation && !cell.conflict;
            });
            const cost = payroll.centers.find((center) => center.id === activeProject.id)?.amount;
            return (
              <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
                <h2 className="text-base font-semibold">Equipe alocada nesta obra</h2>
                <p className="text-sm">
                  {payroll.configured ? 'Custo de equipe previsto' : 'Custo de equipe conhecido'} · {formatMonthLabelBR(month)} · <strong>{formatBRL(cost)}</strong>
                </p>
                {people.length ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {people.map((employee) => (
                      <li key={employee.id} className="rounded-lg border border-[#E4E1DA] p-3 text-sm">
                        <strong>{employee.name}</strong> · {employee.role} · {employee.employmentType}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-[#5B6472]">Sem colaboradores disponíveis nesta obra na semana atual.</p>}
              </section>
            );
          })()}

          {tab === 'Riscos' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
                <h2 className="text-base font-semibold text-[#14181F]">Atrasos registrados</h2>
                {delayedStages.length === 0 ? (
                  <p className="text-sm text-[#5B6472]">
                    Nenhum atraso registrado frente à linha de base original.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                          <th className="py-2.5 px-3 rounded-l-lg">Etapa</th>
                          <th className="py-2.5 px-3">Categoria</th>
                          <th className="py-2.5 px-3">Justificativa</th>
                          <th className="py-2.5 px-3 rounded-r-lg">Situação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {delayedStages.map((s) => (
                          <tr key={s.id} className="border-b border-[#E4E1DA] text-[13px]">
                            <td className="py-3 px-3 font-medium">{s.name}</td>
                            <td className="py-3 px-3">{s.delayCategory || '—'}</td>
                            <td className="py-3 px-3 text-[#5B6472]">{s.delayJustification}</td>
                            <td className="py-3 px-3">
                              <StatusBadge label={s.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
                <h2 className="text-base font-semibold text-[#14181F]">Linha de base x previsão</h2>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5B6472]">Início</span>
                  <strong>{formatDateBR(activeProject.startDate)}</strong>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5B6472]">Entrega na linha de base</span>
                  <strong>{formatDateBR(activeProject.baselineEndDate)}</strong>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5B6472]">Entrega prevista atual</span>
                  <strong>{formatDateBR(activeProject.forecastEndDate)}</strong>
                </div>
                {curvaSData.possuiDados && (
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-[#5B6472]">Curva S (realizado / base)</span>
                    <strong>
                      {formatPercentBR(curvaSData.progressoRealizadoPct)} /{' '}
                      {formatPercentBR(curvaSData.progressoPlanejadoPct)}
                    </strong>
                  </div>
                )}
                <AlertNote tone="info" title="Linha de base preservada">
                  O plano original nunca é apagado. Ao replanejar prazos, o sistema exige justificativa.
                </AlertNote>
              </section>
            </div>
          )}

          {tab === 'Diário de obra' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
                <h2 className="text-base font-semibold text-[#14181F]">Registros do diário</h2>
                {!isOnline && (
                  <AlertNote tone="info" title="Sem conexão no canteiro">
                    Os novos registros serão salvos no aparelho e sincronizados depois ({offlineQueuedCount} na fila).
                  </AlertNote>
                )}
                {projectLogs.length === 0 ? (
                  <p className="text-sm text-[#5B6472]">Nenhum registro no diário desta obra.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {projectLogs.map((l) => (
                      <div key={l.id} className="border border-[#E4E1DA] rounded-xl p-3.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <strong className="text-[#14181F]">{formatDateBR(l.date)}</strong>
                          <span className="text-[#5B6472]">
                            {l.weather} · {l.presentCount} pessoa(s)
                          </span>
                        </div>
                        <p className="text-sm text-[#14181F]">{l.activities}</p>
                        {l.occurrences && (
                          <p className="text-xs text-[#8A5200]">Ocorrências: {l.occurrences}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
                <h2 className="text-base font-semibold text-[#14181F]">Novo registro do dia</h2>
                <form onSubmit={handleSaveDailyLog} className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold">Data</label>
                      <input
                        type="date"
                        value={logDate}
                        onChange={(e) => setLogDate(e.target.value)}
                        className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold">Equipe presente</label>
                      <input
                        type="number"
                        min={0}
                        value={logCount}
                        onChange={(e) => setLogCount(e.target.value)}
                        className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold">Clima</label>
                    <SegmentedControl
                      items={['Sol', 'Chuva fraca', 'Chuva forte']}
                      active={logWeather}
                      onChange={(w) => setLogWeather(w as WeatherType)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold">Atividades do dia</label>
                    <textarea
                      required
                      rows={3}
                      value={logActivities}
                      onChange={(e) => setLogActivities(e.target.value)}
                      className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold">Ocorrências</label>
                    <textarea
                      rows={2}
                      value={logOccurrences}
                      onChange={(e) => setLogOccurrences(e.target.value)}
                      className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm"
                    />
                  </div>
                  <RegisteredBySelect value={logActor} onChange={setLogActor} id="log-actor" />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer"
                  >
                    Salvar registro do dia
                  </button>
                </form>
              </section>
            </div>
          )}

          {tab === 'Encerramento' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(() => {
                const projectDre = calcularDreObra(activeProject, data.transactions, projectStages);
                const doneStages = projectStages.filter((s) => s.status === 'Concluída').length;
                return (
                  <>
                    <div className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-2 text-sm">
                      <h3 className="font-semibold text-[#14181F]">Conferência antes de encerrar</h3>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Etapas concluídas</span>
                        <strong>
                          {doneStages} de {projectStages.length}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Status atual</span>
                        <StatusBadge label={activeProject.status} />
                      </div>
                    </div>
                    <div className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-2 text-sm">
                      <h3 className="font-semibold text-[#14181F]">Resultado consolidado</h3>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Receita</span>
                        <strong className="tabular-nums">{formatBRL(projectDre.receita.orcado)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Custo real lançado</span>
                        <strong className="tabular-nums">{formatBRL(projectDre.custosTotais.realizado)}</strong>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span>Margem real</span>
                        <span className="tabular-nums">{formatPercentBR(projectDre.margemRealizadaPct)}</span>
                      </div>
                    </div>
                    <div className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3 text-sm">
                      <h3 className="font-semibold text-[#14181F]">Ao encerrar, o sistema…</h3>
                      <ul className="text-xs text-[#5B6472] flex flex-col gap-1.5">
                        <li>✓ Inicia a garantia contratual de 1 ano</li>
                        <li>✓ Atualiza o cliente para “Em garantia”</li>
                        <li>✓ Consolida o DRE definitivo da obra</li>
                      </ul>
                      <button
                        type="button"
                        disabled={activeProject.status === 'Concluída'}
                        onClick={handleCloseProject}
                        className="w-full py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold disabled:opacity-45 cursor-pointer"
                      >
                        {activeProject.status === 'Concluída' ? 'Obra encerrada' : 'Encerrar obra'}
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
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
                <option value="Aguardando material">Aguardando material</option>
                <option value="Em conferência">Em conferência</option>
                <option value="Concluída">Concluída</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="stage-pop" className="text-xs font-semibold">POP vinculado</label>
              <select
                id="stage-pop"
                value={stPopId}
                onChange={(e) => setStPopId(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm bg-white"
              >
                <option value="">Sem POP vinculado</option>
                {data.pops.map((p) => (
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
            if (!pop || pop.acceptanceCriteria.length === 0) return null;
            return (
              <div className="border border-[#E4E1DA] rounded-xl p-3 flex flex-col gap-2">
                <strong className="text-xs text-[#14181F]">
                  Checklist de qualidade do POP ({pop.title})
                </strong>
                {pop.acceptanceCriteria.map((crit) => {
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
              <label className="text-xs font-semibold">Categoria do atraso (se houver)</label>
              <select
                value={stDelayCat}
                onChange={(e) => setStDelayCat(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm bg-white"
              >
                <option value="">Sem atraso</option>
                <option value="Chuva">Chuva</option>
                <option value="Material do cliente">Material do cliente</option>
                <option value="Fornecedor">Fornecedor</option>
                <option value="Equipe">Equipe</option>
                <option value="Outro">Outro</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold">Justificativa do atraso</label>
              <input
                type="text"
                value={stDelayJust}
                onChange={(e) => setStDelayJust(e.target.value)}
                placeholder="Descreva o motivo do desvio"
                className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm"
              />
            </div>
          </div>

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
