import { useEffect, useMemo, useState } from 'react';
import { ListToolbar, SortHeading, useListFilters } from '../components/ui/ListFilters';
import { normalizeSearch, recordDay } from '../domain/listQuery';
import { useViewParam, useViewTab } from '../hooks/useViewUrl';
import { DataList } from '../components/ui/DataList';
import {
  AlertNote,
  EmptySection,
  KpiCard,
  Modal,
  PageHeader,
  RegisteredBySelect,
  SegmentedControl,
  StatusBadge,
  Tabs,
} from '../components/ui/PilotisUI';
import {
  createRecord,
  recordEmployeeOccurrence,
  saveWeeklyAllocation,
  submitTeamPayroll,
  subscribeEmployeeOccurrences,
  updateRecord,
  upsertCompanySettings,
} from '../services/pilotisService';
import type {
  ActorRole,
  Employee,
  EmployeeOccurrence,
  EmployeeOccurrenceKind,
  EmploymentType,
  EpiStatus,
  OnboardingStatus,
  PilotisDataState,
} from '../types/pilotis';
import {
  addDaysISO,
  addMonthsISO,
  avaliarValidadeSst,
  calcularEncargosColaborador,
  calcularPendenciasSegurancaEquipe,
  calcularResumoFolhaEquipe,
  calculateTeamPayroll,
  formatMonthLabelBR,
  onboardingDeadline,
  isPublishedPop,
  normalizeCompetence,
  getOnboardingAlert,
  plannedWeeks,
  planningTodayISO,
  resolveTeamWeek,
  clampStr,
  formatBRL,
  formatDateBR as domainFormatDateBR,
  formatShortDateBR,
  monthKey,
  parseCurrencyInput,
  todayISO,
} from '../domain';

const formatDateBR = (val: string | null | undefined) => domainFormatDateBR(val, '—');

const TEAM_TABS = [
  'Cadastro',
  'Alocação',
  'Férias',
  'Segurança e capacitação',
  'Folha e encargos',
];

const EMPLOYMENT_TYPES: EmploymentType[] = ['CLT', 'PJ', 'Autônomo', 'Freelancer', 'Diarista', 'Informal', 'Sócio'];
const OCCURRENCE_TYPES: EmployeeOccurrenceKind[] = ['Elogio', 'Registro', 'Advertência', 'Acidente', 'Quase acidente'];

export function TeamView({
  uid,
  data,
  companyEmail,
  initialTab,
}: {
  uid: string;
  data: PilotisDataState;
  companyEmail?: string | null;
  initialTab?: string;
}) {
  const [tab, setTab] = useViewTab('team', TEAM_TABS, initialTab);
  const [selectedEmployeeId, setSelectedEmployeeId] = useViewParam('team.colaborador');

  // Modals
  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [allocModalOpen, setAllocModalOpen] = useState(false);
  const [safetyModalOpen, setSafetyModalOpen] = useState(false);
  const [vacationModalOpen, setVacationModalOpen] = useState(false);
  const [paramsModalOpen, setParamsModalOpen] = useState(false);
  const [occurrenceModalOpen, setOccurrenceModalOpen] = useState(false);
  const [payrollModalOpen, setPayrollModalOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'bad' | 'info'; title: string; text: string } | null>(null);

  // Employee form
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState('');
  const [empType, setEmpType] = useState<EmploymentType>('CLT');
  const [empSalary, setEmpSalary] = useState('');
  const [paymentFrequency, setPaymentFrequency] = useState<'monthly' | 'oneOff'>('monthly');
  const [paymentMonth, setPaymentMonth] = useState('');
  const [empPaymentMethod, setEmpPaymentMethod] = useState('Transferência');
  const [empStartDate, setEmpStartDate] = useState(todayISO());
  const [empProjectId, setEmpProjectId] = useState('');
  const [empAso, setEmpAso] = useState('');
  const [empNr18, setEmpNr18] = useState('');
  const [empNr35, setEmpNr35] = useState('');
  const [empEpi, setEmpEpi] = useState<EpiStatus>('Pendente');
  const [empOnboarding, setEmpOnboarding] = useState<OnboardingStatus>('Em andamento');
  const [empActor, setEmpActor] = useState<ActorRole>('Sócio');

  // Allocation form
  const todayStr = planningTodayISO();
  const weeks = useMemo(() => plannedWeeks(todayStr), [todayStr]);
  const [allocEmpId, setAllocEmpId] = useState('');
  const [allocProjectId, setAllocProjectId] = useState('');
  const [allocStageId, setAllocStageId] = useState('');
  const [allocWeekStart, setAllocWeekStart] = useState(weeks[0] || todayISO());
  const [allocStatus, setAllocStatus] = useState<'Obra' | 'Férias'>('Obra');
  const [allocActor, setAllocActor] = useState<ActorRole>('Sócio');

  // Safety form
  const [safetyEmpId, setSafetyEmpId] = useState('');
  const [safetyAso, setSafetyAso] = useState('');
  const [safetyNr18, setSafetyNr18] = useState('');
  const [safetyNr35, setSafetyNr35] = useState('');
  const [safetyEpiExpiry, setSafetyEpiExpiry] = useState('');
  const [safetyOnboardingStart, setSafetyOnboardingStart] = useState('');
  const [safetyEpi, setSafetyEpi] = useState<EpiStatus>('Em dia');
  const [safetyOnboarding, setSafetyOnboarding] = useState<OnboardingStatus>('Concluída');
  const [safetyActor, setSafetyActor] = useState<ActorRole>('Responsável administrativo');

  // Vacation form
  const [vacEmpId, setVacEmpId] = useState('');
  const [vacPeriod, setVacPeriod] = useState('');
  const [vacStart, setVacStart] = useState('');
  const [vacEnd, setVacEnd] = useState('');
  const [vacActor, setVacActor] = useState<ActorRole>('Responsável administrativo');

  // Occurrence form
  const [occurrences, setOccurrences] = useState<EmployeeOccurrence[]>([]);
  const [occurrenceError, setOccurrenceError] = useState(false);
  const [occType, setOccType] = useState<EmployeeOccurrenceKind>('Registro');
  const [occDate, setOccDate] = useState(todayStr);
  const [occText, setOccText] = useState('');
  const [occActor, setOccActor] = useState<ActorRole>('Sócio');

  // Tax params form
  const [inssRate, setInssRate] = useState(String(data.settings?.inssRate ?? ''));
  const [fgtsRate, setFgtsRate] = useState(String(data.settings?.fgtsRate ?? ''));
  const [vacationRate, setVacationRate] = useState(String(data.settings?.vacationRate ?? ''));
  const [thirteenthRate, setThirteenthRate] = useState(String(data.settings?.thirteenthRate ?? ''));
  const [taxEffectiveDate, setTaxEffectiveDate] = useState(data.settings?.taxParamsEffectiveDate || '');
  const [taxSource, setTaxSource] = useState(data.settings?.taxParamsSource || '');
  const [taxActor, setTaxActor] = useState<ActorRole>('Responsável administrativo');

  // Send payroll actor
  const [payrollActor, setPayrollActor] = useState<ActorRole>('Responsável administrativo');

  const [payrollMonthParam, setPayrollMonth] = useViewParam('equipe.folha.mes');
  const payrollMonth = normalizeCompetence(payrollMonthParam) || monthKey(todayStr);
  const [payrollDueDate, setPayrollDueDate] = useState('');
  const monthlyPayroll = useMemo(() => calculateTeamPayroll(data, payrollMonth), [data, payrollMonth]);
  const payroll = useMemo(
    () => calcularResumoFolhaEquipe(data.employees, data.settings, todayStr),
    [data.employees, data.settings, todayStr]
  );

  const selectedEmployee = data.employees.find((e) => e.id === selectedEmployeeId) || null;

  useEffect(() => {
    setOccurrences([]);
    setOccurrenceError(false);
    if (!selectedEmployeeId) return;
    return subscribeEmployeeOccurrences(uid, selectedEmployeeId, setOccurrences, () => setOccurrenceError(true));
  }, [uid, selectedEmployeeId]);

  const allocationsByEmployee = new Map<string, PilotisDataState['allocations']>();
  for (const allocation of data.allocations) {
    const records = allocationsByEmployee.get(allocation.employeeId) ?? [];
    records.push(allocation);
    allocationsByEmployee.set(allocation.employeeId, records);
  }
  const safetyStatus = (row: Employee) => [row.asoExpiry, row.nr18Expiry, row.nr35Expiry, row.epiExpiry]
    .some((date) => avaliarValidadeSst(date || '', todayStr).expiredOrSoon) || row.epiStatus !== 'Em dia'
    ? 'Com pendências' : 'Em dia';
  const vacationStatus = (row: Employee) => row.employmentType !== 'CLT'
    ? 'Sem férias (não CLT)' : row.vacationScheduled ? 'Aprovada' : 'Pendente';
  const employeeStatus = (row: Employee) => {
    if (tab === 'Férias') return vacationStatus(row);
    if (tab === 'Segurança e capacitação') return safetyStatus(row);
    if (tab === 'Alocação') {
      const assignment = resolveTeamWeek(row, weeks[0] ?? todayStr, data);
      if (assignment.conflict || assignment.vacation || !assignment.started || !assignment.project) return assignment.label;
      return assignment.project.contractKind === 'Satélite' || assignment.project.type === 'Obra satélite' ? 'Satélite' : 'Obra';
    }
    return row.employmentType;
  };
  const roster = useListFilters('equipe.' + normalizeSearch(tab).replace(/\W+/g, '-'), data.employees, {
    text: (row) => [row.name, row.role, row.employmentType, row.currentProjectName, row.id],
    status: employeeStatus,
    projects: (row) => [row.currentProjectId, ...(allocationsByEmployee.get(row.id) ?? []).map((item) => item.projectId)],
    dates: (row, projectId) => tab === 'Alocação' ? (allocationsByEmployee.get(row.id) ?? [])
      .filter((item) => !projectId || item.projectId === projectId).map((item) => item.weekStart)
      : tab === 'Segurança e capacitação' ? [row.asoExpiry, row.nr18Expiry, row.nr35Expiry, row.epiExpiry || '']
      : tab === 'Férias' ? [row.vacationStart || '', row.vacationEnd || '']
      : row.startDate || recordDay(row.createdAt),
    interval: (row) => tab === 'Férias' && row.vacationStart && row.vacationEnd
      ? [row.vacationStart, row.vacationEnd] : undefined,
    columns: [
      { key: 'name', label: 'Colaborador', value: (row) => row.name },
      { key: 'role', label: 'Especialidade', value: (row) => row.role },
      { key: 'employment', label: 'Vínculo', value: (row) => row.employmentType },
      { key: 'project', label: 'Obra atual', value: (row) => row.currentProjectName },
      { key: 'salary', label: 'Salário / base', value: (row) => row.baseSalary },
      { key: 'status', label: 'Situação', value: employeeStatus },
      { key: 'safety', label: 'Segurança', value: safetyStatus },
      { key: 'start', label: 'Admissão', value: (row) => row.startDate },
      ...(tab === 'Férias' ? [
        { key: 'vacationPeriod', label: 'Período aquisitivo', value: (row: Employee) => row.vacationPeriod },
        { key: 'vacationStart', label: 'Férias programadas', value: (row: Employee) => row.vacationStart },
      ] : []),
      ...(tab === 'Segurança e capacitação' ? [
        { key: 'aso', label: 'ASO', value: (row: Employee) => row.asoExpiry },
        { key: 'nr18', label: 'NR-18', value: (row: Employee) => row.nr18Expiry },
        { key: 'nr35', label: 'NR-35', value: (row: Employee) => row.nr35Expiry },
        { key: 'epi', label: 'EPIs', value: (row: Employee) => row.epiExpiry || row.epiStatus },
        { key: 'onboarding', label: 'Integração', value: (row: Employee) => row.onboardingStatus },
      ] : []),
    ],
  });
  const filteredEmployees = roster.rows;
  const employeesById = new Map(data.employees.map((employee) => [employee.id, employee]));
  const payrollStart = payrollMonth + '-01';
  const payrollEnd = addDaysISO(addMonthsISO(payrollStart, 1), -1);
  const payrollList = useListFilters('equipe.folha', monthlyPayroll.lines, {
    text: (row) => [row.employeeName, row.projectName, row.category, employeesById.get(row.employeeId)?.role],
    status: (row) => row.vacation ? 'Férias' : employeesById.get(row.employeeId)?.employmentType || 'Sem vínculo registrado',
    projects: (row) => row.projectId,
    dates: () => payrollStart,
    interval: () => [payrollStart, payrollEnd],
    columns: [
      { key: 'person', label: 'Colaborador', value: (row) => row.employeeName },
      { key: 'center', label: 'Centro de custo', value: (row) => row.projectName },
      { key: 'base', label: 'Remuneração', value: (row) => row.base },
      { key: 'charges', label: 'Encargos', value: (row) => row.charges },
      { key: 'provisions', label: 'Provisões de férias e 13º', value: (row) => row.provisions },
      { key: 'total', label: 'Custo previsto', value: (row) => row.charges === null ? null : row.amount },
    ],
  });

  const expiringTrainingCount = useMemo(
    () => calcularPendenciasSegurancaEquipe(data.employees, todayStr),
    [data.employees, todayStr]
  );

  const matrix = useMemo(() => data.employees.map((employee) => ({
    employee,
    cells: weeks.map((week) => resolveTeamWeek(employee, week, data)),
  })), [data, weeks]);
  const matrixByEmployee = new Map(matrix.map((row) => [row.employee.id, row]));
  const visibleMatrix = filteredEmployees.map((employee) => matrixByEmployee.get(employee.id)!);
  function allocationLabel(cell: ReturnType<typeof resolveTeamWeek>) {
    const stage = data.stages.find((item) => item.id === cell.allocation?.stageId);
    return stage && !cell.conflict && !cell.vacation && cell.started ? stage.name + ' · ' + cell.label : cell.label;
  }

  function openAllocationCell(employee: Employee, week: string, cell: ReturnType<typeof resolveTeamWeek>) {
    setAllocEmpId(employee.id);
    setAllocProjectId(cell.allocation?.projectId || employee.currentProjectId || '');
    setAllocWeekStart(week);
    setAllocStageId(cell.allocation?.stageId ?? '');
    setAllocStatus(cell.allocation?.status || 'Obra');
    setAllocModalOpen(true);
  }

  const unallocatedEmployeesCount = data.employees.length ? matrix.filter((row) => row.cells[0]?.idle).length : null;
  const idleWeeks = matrix.reduce((sum, row) => sum + row.cells.filter((cell) => cell.idle).length, 0);
  const conflictWeeks = matrix.reduce((sum, row) => sum + row.cells.filter((cell) => cell.conflict).length, 0);
  const currentMonthPayrollSent = data.transactions.some((transaction) => transaction.source === 'folha' &&
    (transaction.payrollPeriod || transaction.installmentLabel || monthKey(transaction.date)) === payrollMonth);

  function openCreateEmployee() {
    setEditingEmp(null);
    setEmpName('');
    setEmpRole('');
    setEmpType('CLT');
    setEmpSalary('');
    setPaymentFrequency('monthly');
    setPaymentMonth('');
    setEmpPaymentMethod('');
    setEmpStartDate('');
    setEmpProjectId('');
    setEmpAso('');
    setEmpNr18('');
    setEmpNr35('');
    setEmpEpi('Pendente');
    setEmpOnboarding('Em andamento');
    setEmpActor('Sócio');
    setEmpModalOpen(true);
  }

  function openEditEmployee(emp: Employee) {
    setEditingEmp(emp);
    setEmpName(emp.name);
    setEmpRole(emp.role);
    setEmpType(emp.employmentType);
    setEmpSalary(String(emp.baseSalary ?? ''));
    setPaymentFrequency(emp.paymentFrequency ?? 'monthly');
    setPaymentMonth(emp.paymentMonth ?? '');
    setEmpPaymentMethod(emp.paymentMethod || '');
    setEmpStartDate(emp.startDate || '');
    setEmpProjectId(emp.currentProjectId || '');
    setEmpAso(emp.asoExpiry || '');
    setEmpNr18(emp.nr18Expiry || '');
    setEmpNr35(emp.nr35Expiry || '');
    setEmpEpi(emp.epiStatus || 'Pendente');
    setEmpOnboarding(emp.onboardingStatus || 'Em andamento');
    setEmpActor('Sócio');
    setEmpModalOpen(true);
  }

  async function handleSaveEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!empName.trim() || !empRole.trim() || !empPaymentMethod || !empStartDate) return;
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(empSalary.trim())) {
      setFeedback({ tone: 'bad', title: 'Valor inválido', text: 'Informe um valor com até duas casas decimais.' });
      return;
    }
    setFeedback(null);
    setSaving(true);
    try {
      const proj = data.projects.find((p) => p.id === empProjectId);
      const salaryNum = parseCurrencyInput(empSalary);
      const payload = {
        name: clampStr(empName, 140),
        role: clampStr(empRole, 80),
        employmentType: empType,
        baseSalary: salaryNum,
        paymentFrequency: empType === 'CLT' || empType === 'Sócio' ? 'monthly' : paymentFrequency,
        paymentMonth: empType !== 'CLT' && empType !== 'Sócio' && paymentFrequency === 'oneOff' ? paymentMonth : '',
        paymentMethod: clampStr(empPaymentMethod, 60),
        startDate: empStartDate,
        currentProjectId: proj?.id || '',
        currentProjectName: clampStr(proj?.name || '', 160),
        asoExpiry: empAso,
        nr18Expiry: empNr18,
        nr35Expiry: empNr35,
        epiStatus: empEpi,
        onboardingStatus: empOnboarding,
        vacationPeriod: editingEmp?.vacationPeriod || '',
        vacationScheduled: editingEmp?.vacationScheduled || '',
        occurrencesNote: editingEmp?.occurrencesNote || '',
      };

      if (editingEmp) {
        await updateRecord(
          'employees',
          editingEmp.id,
          uid,
          empActor,
          payload,
          `Colaborador atualizado: ${payload.name}`,
          editingEmp.role,
          payload.role
        );
        setFeedback({
          tone: 'ok',
          title: 'Colaborador atualizado',
          text: `${payload.name} atualizado na base da equipe.`,
        });
      } else {
        const newId = await createRecord(
          'employees',
          uid,
          empActor,
          payload,
          `Novo colaborador cadastrado: ${payload.name} (${payload.employmentType})`
        );
        setSelectedEmployeeId(newId);
        setFeedback({
          tone: 'ok',
          title: 'Colaborador cadastrado',
          text: `${payload.name} salvo. O custo e os encargos já refletem na folha e previsão de caixa.`,
        });
      }
      setEmpModalOpen(false);
    } catch (error) {
      setFeedback({ tone: 'bad', title: 'Colaborador', text: error instanceof Error ? error.message : 'Não foi possível salvar.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAllocation(e: React.FormEvent) {
    e.preventDefault();
    if (!allocEmpId) return;
    setFeedback(null);
    setSaving(true);
    try {
      const emp = data.employees.find((x) => x.id === allocEmpId);
      const proj = data.projects.find((p) => p.id === allocProjectId);
      const targetProjId = allocStatus === 'Férias' ? 'Férias' : proj?.id || 'Sem obra';
      const targetProjName =
        allocStatus === 'Férias' ? 'Férias' : proj?.name || 'Sem obra';

      if (!emp) return;
      await saveWeeklyAllocation(uid, allocActor, emp, allocWeekStart, {
        projectId: targetProjId, projectName: targetProjName, status: allocStatus,
        stageId: allocStatus === 'Obra' && proj ? allocStageId : '',
      }, data.allocations);
      setAllocModalOpen(false);
      setFeedback({
        tone: 'ok',
        title: 'Alocação registrada',
        text: 'Quadro semanal de alocação atualizado.',
      });
    } catch (error) {
      setFeedback({ tone: 'bad', title: 'Alocação', text: error instanceof Error ? error.message : 'Não foi possível salvar.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSafety(e: React.FormEvent) {
    e.preventDefault();
    const emp = data.employees.find((x) => x.id === safetyEmpId);
    if (!emp) return;
    setFeedback(null);
    setSaving(true);
    try {
      await updateRecord(
        'employees',
        emp.id,
        uid,
        safetyActor,
        {
          asoExpiry: safetyAso,
          nr18Expiry: safetyNr18,
          nr35Expiry: safetyNr35,
          epiStatus: safetyEpi,
          onboardingStatus: safetyOnboarding,
          onboardingStart: safetyOnboardingStart,
          epiExpiry: safetyEpiExpiry,
        },
        `Segurança e treinamentos atualizados para ${emp.name}`,
        emp.epiStatus,
        safetyEpi
      );
      setSafetyModalOpen(false);
      setFeedback({
        tone: 'ok',
        title: 'Segurança atualizada',
        text: `Validades de ASO, NRs e EPIs de ${emp.name} salvas.`,
      });
    } catch (error) {
      setFeedback({ tone: 'bad', title: 'Segurança', text: error instanceof Error ? error.message : 'Não foi possível salvar.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveVacation(e: React.FormEvent) {
    e.preventDefault();
    const emp = data.employees.find((x) => x.id === vacEmpId);
    if (!emp || emp.employmentType !== 'CLT') return;
    if ((vacStart || vacEnd) && (!vacStart || !vacEnd || vacEnd < vacStart)) {
      setFeedback({ tone: 'bad', title: 'Datas de férias inválidas', text: 'Informe início e fim em ordem cronológica.' });
      return;
    }
    setFeedback(null);
    setSaving(true);
    try {
      await updateRecord(
        'employees',
        emp.id,
        uid,
        vacActor,
        {
          vacationPeriod: clampStr(vacPeriod, 60),
          vacationScheduled: vacStart ? formatDateBR(vacStart) + ' a ' + formatDateBR(vacEnd) : '',
          vacationStart: vacStart,
          vacationEnd: vacEnd,
        },
        `Férias atualizadas para ${emp.name}`,
        emp.vacationScheduled || 'A programar',
        vacStart ? formatDateBR(vacStart) + ' a ' + formatDateBR(vacEnd) : 'A programar'
      );
      setVacationModalOpen(false);
      setFeedback({
        tone: 'ok',
        title: 'Programação de férias salva',
        text: `Férias de ${emp.name} atualizadas.`,
      });
    } catch (error) {
      setFeedback({ tone: 'bad', title: 'Programação de férias', text: error instanceof Error ? error.message : 'Não foi possível salvar.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveOccurrence(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEmployee || !occText.trim()) return;
    setFeedback(null);
    setSaving(true);
    try {
      await recordEmployeeOccurrence(uid, selectedEmployee.id, occActor, occType, occDate, occText);
      setOccurrenceModalOpen(false);
      setOccText('');
      setFeedback({
        tone: 'ok',
        title: 'Ocorrência registrada',
        text: `Histórico de ${selectedEmployee.name} atualizado.`,
      });
    } catch (error) {
      setFeedback({ tone: 'bad', title: 'Ocorrência', text: error instanceof Error ? error.message : 'Não foi possível salvar.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTaxParams(e: React.FormEvent) {
    e.preventDefault();
    const fields = [inssRate, fgtsRate, vacationRate, thirteenthRate];
    if (fields.some((field) => !field.trim() || !Number.isFinite(Number(field)) || Number(field) < 0) || !taxEffectiveDate) {
      setFeedback({ tone: 'bad', title: 'Parâmetros incompletos', text: 'Informe as quatro alíquotas e a data de vigência.' });
      return;
    }
    setFeedback(null);
    setSaving(true);
    try {
      await upsertCompanySettings(uid, taxActor, data.settings, {
        inssRate: Number(inssRate) || 0,
        fgtsRate: Number(fgtsRate) || 0,
        vacationRate: Number(vacationRate) || 0,
        thirteenthRate: Number(thirteenthRate) || 0,
        taxParamsEffectiveDate: taxEffectiveDate,
        taxParamsSource: clampStr(taxSource, 120),
      });
      setParamsModalOpen(false);
      setFeedback({
        tone: 'ok',
        title: 'Parâmetros de encargos salvos',
        text: 'Os encargos e provisões da folha CLT passam a usar as novas alíquotas.',
      });
    } catch (error) {
      setFeedback({ tone: 'bad', title: 'Parâmetros de encargos', text: error instanceof Error ? error.message : 'Não foi possível salvar.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSendPayrollToFinance(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      await submitTeamPayroll(uid, payrollActor, data, payrollMonth, payrollDueDate);
      setPayrollModalOpen(false);
      setFeedback({ tone: 'ok', title: 'Folha enviada', text: 'Lançamentos previstos registrados em Contas a pagar por centro de custo.' });
    } catch (error) {
      setFeedback({ tone: 'bad', title: 'Não foi possível enviar a folha', text: error instanceof Error ? error.message : 'Revise os dados e tente novamente.' });
    } finally {
      setSaving(false);
    }
  }

  if (selectedEmployee) {
    const isClt = selectedEmployee.employmentType === 'CLT';
    const empCharges = calcularEncargosColaborador(selectedEmployee, data.settings, todayStr);
    const asoStatus = avaliarValidadeSst(selectedEmployee.asoExpiry, todayStr);
    const nr18Status = avaliarValidadeSst(selectedEmployee.nr18Expiry, todayStr);
    const nr35Status = avaliarValidadeSst(selectedEmployee.nr35Expiry, todayStr);
    const initials = selectedEmployee.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');

    const occurrencesList = selectedEmployee.occurrencesNote?.split('\n').filter(Boolean) ?? [];
    const assignments = data.allocations.filter((row) => row.employeeId === selectedEmployee.id && row.status === 'Obra' &&
      row.projectId !== 'Sem obra').sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    const integrationDate = onboardingDeadline(selectedEmployee.onboardingStart, selectedEmployee.startDate);
    const epiDate = avaliarValidadeSst(selectedEmployee.epiExpiry, todayStr);
    const currentAssignment = resolveTeamWeek(selectedEmployee, weeks[0], data);
    const currentStage = !currentAssignment.conflict && !currentAssignment.vacation && currentAssignment.started
      ? data.stages.find((stage) => stage.id === currentAssignment.allocation?.stageId) : undefined;

    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={`${selectedEmployee.name} · ${selectedEmployee.role}`}
          subtitle="Equipe › Cadastro › Perfil do colaborador"
          companyEmail={companyEmail}
          actions={
            <>
              <button
                type="button"
                onClick={() => setSelectedEmployeeId('')}
                className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
              >
                Voltar à lista
              </button>
              <button
                type="button"
                onClick={() => openEditEmployee(selectedEmployee)}
                className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => {
                  setOccText('');
                  setOccActor('Sócio');
                  setOccurrenceModalOpen(true);
                }}
                className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] cursor-pointer"
              >
                Registrar ocorrência
              </button>
            </>
          }
        />

        {feedback && (
          <AlertNote tone={feedback.tone} title={feedback.title}>
            {feedback.text}
          </AlertNote>
        )}

        <div className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-wrap items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-[#1F3A5F] text-white font-bold text-lg grid place-items-center shrink-0">
            {initials || 'P'}
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-bold text-[#14181F]">{selectedEmployee.name}</h2>
            <div className="flex flex-wrap gap-2">
              <StatusBadge label={selectedEmployee.employmentType} />
              <StatusBadge label={currentAssignment.label} />
              <StatusBadge
                label={
                  asoStatus.expiredOrSoon || nr18Status.expiredOrSoon || nr35Status.expiredOrSoon || epiDate.expiredOrSoon || (integrationDate && integrationDate < todayStr && selectedEmployee.onboardingStatus !== 'Concluída') || selectedEmployee.epiStatus !== 'Em dia'
                    ? 'Segurança com pendências'
                    : 'Segurança em dia'
                }
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
            <h3 className="text-base font-semibold text-[#14181F]">Dados e custo</h3>
            <div className="flex justify-between text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">Especialidade</span>
              <strong className="text-[#14181F]">{selectedEmployee.role}</strong>
            </div>
            <div className="flex justify-between text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">Vínculo</span>
              <strong className="text-[#14181F]">{selectedEmployee.employmentType}</strong>
            </div>
            <div className="flex justify-between text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">Salário / valor base</span>
              <strong className="text-[#14181F] tabular-nums">{formatBRL(selectedEmployee.baseSalary)}</strong>
            </div>
            <div className="flex justify-between text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">Encargos e provisões</span>
              <strong className="text-[#14181F] tabular-nums">
                {!empCharges.aplicavel
                  ? 'Não se aplica'
                  : empCharges.status === 'nao_configurado'
                  ? 'não configurado'
                  : formatBRL((empCharges.encargosMensais ?? 0) + (empCharges.provisoesMensais ?? 0))}
              </strong>
            </div>
            <div className="flex justify-between text-[13px] py-1 border-b border-[#E4E1DA]">
              <strong className="text-[#14181F]">Custo total por mês</strong>
              <strong className="text-[#1F3A5F] tabular-nums">
                {empCharges.custoTotalMensal !== null
                  ? formatBRL(empCharges.custoTotalMensal)
                  : 'não configurado'}
              </strong>
            </div>
            <div className="flex justify-between text-[13px] py-1">
              <span className="text-[#5B6472]">Forma de pagamento</span>
              <strong className="text-[#14181F]">{selectedEmployee.paymentMethod || '—'}</strong>
            </div>
          </section>

          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
            <h3 className="text-base font-semibold text-[#14181F]">Segurança e capacitação</h3>
            <div className="flex justify-between items-center text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">ASO</span>
              <StatusBadge label={asoStatus.label} />
            </div>
            <div className="flex justify-between items-center text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">NR-18</span>
              <StatusBadge label={nr18Status.label} />
            </div>
            <div className="flex justify-between items-center text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">NR-35</span>
              <StatusBadge label={nr35Status.label} />
            </div>
            <div className="flex justify-between items-center text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">EPIs entregues</span>
              <StatusBadge label={selectedEmployee.epiStatus || 'Pendente'} />
            </div>
            <div className="flex justify-between items-center text-[13px] py-1">
              <span className="text-[#5B6472]">Integração · prazo de uma semana</span>
              <StatusBadge label={selectedEmployee.onboardingStatus || 'Pendente'} />
            {integrationDate && selectedEmployee.onboardingStatus !== 'Concluída' && (
                <StatusBadge label={integrationDate < todayStr ? 'Integração em atraso' : 'Até ' + formatDateBR(integrationDate)}
                  tone={integrationDate < todayStr ? 'bad' : 'info'} />
              )}
              </div>
          </section>

          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
            <h3 className="text-base font-semibold text-[#14181F]">Alocação e férias</h3>
            <div className="flex justify-between text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">Alocação atual</span>
              <strong className="text-[#14181F]">
                {currentAssignment.label}{currentStage && <span className="block text-right text-xs font-normal">{currentStage.name}</span>}
              </strong>
            </div>
            <div className="flex justify-between text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">Admissão / início</span>
              <strong className="text-[#14181F]">{formatDateBR(selectedEmployee.startDate)}</strong>
            </div>
            <div className="flex justify-between text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">Período aquisitivo</span>
              <strong className="text-[#14181F]">
                {isClt ? selectedEmployee.vacationPeriod || 'Não informado' : 'Não se aplica'}
              </strong>
            </div>
            <div className="flex justify-between text-[13px] py-1">
              <span className="text-[#5B6472]">Férias programadas</span>
              <strong className="text-[#14181F]">
                {isClt ? selectedEmployee.vacationScheduled || 'A programar' : 'Não se aplica'}
              </strong>
            </div>
          </section>
        </div>

        <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
          <h3 className="text-base font-semibold text-[#14181F]">Ocorrências</h3>
          {occurrenceError && <AlertNote tone="bad" title="Não foi possível carregar as ocorrências">Confira a conexão com o sistema.</AlertNote>}
          {occurrences.length > 0 && (
            <ul className="grid gap-2">
              {occurrences.map((item) => (
                <li key={item.id} className="rounded-lg border border-[#E4E1DA] p-3 text-sm">
                  <StatusBadge label={item.kind} /> · {formatDateBR(item.date)} · {item.createdBy}
                  <p className="mt-1 whitespace-pre-line">{item.description}</p>
                </li>
              ))}
            </ul>
          )}
          {occurrencesList.length === 0 ? (occurrences.length === 0 && !occurrenceError && (
            <p className="text-sm text-[#5B6472]">
              Nenhuma ocorrência registrada para este colaborador.
            </p>
          )) : (
            <ul className="flex flex-col gap-2">
              {occurrencesList.map((line, i) => (
                <li
                  key={i}
                  className="text-sm text-[#14181F] bg-[#F6F5F2] border border-[#E4E1DA] rounded-lg px-3.5 py-2.5"
                >
                  {line}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-[#E4E1DA] bg-white p-5 grid gap-2">
          <h3 className="font-semibold">Histórico em obras</h3>
          {assignments.length === 0 ? <p className="text-sm text-[#5B6472]">Sem alocações semanais registradas.</p> : (
            <ul className="grid gap-1 text-sm">
              {assignments.map((row) => <li key={row.id}>{formatDateBR(row.weekStart)} · {row.projectName}</li>)}
            </ul>
          )}
        </section>
        <Modal
          open={occurrenceModalOpen}
          onClose={() => setOccurrenceModalOpen(false)}
          title={`Registrar ocorrência · ${selectedEmployee.name}`}
        >
          <form onSubmit={handleSaveOccurrence} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Tipo de ocorrência
                <select value={occType} onChange={(e) => setOccType(e.target.value as EmployeeOccurrenceKind)}
                  className="block w-full rounded-lg border border-[#E4E1DA] p-2">
                  {OCCURRENCE_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label className="text-sm">Data da ocorrência
                <input type="date" value={occDate} required max={todayStr} onChange={(e) => setOccDate(e.target.value)}
                  className="block w-full rounded-lg border border-[#E4E1DA] p-2" />
              </label>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="occ-text" className="text-[13px] font-semibold text-[#14181F]">
                Descrição da ocorrência, elogio ou treinamento
              </label>
              <textarea
                id="occ-text"
                rows={3}
                required
                value={occText}
                onChange={(e) => setOccText(e.target.value)}
                maxLength={1000}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            {feedback?.tone === 'bad' && <AlertNote tone="bad" title={feedback.title}>{feedback.text}</AlertNote>}
          <RegisteredBySelect value={occActor} onChange={setOccActor} id="occ-actor" />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOccurrenceModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar ocorrência'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Reuse employee edit modal */}
        {renderEmployeeModal()}
      </div>
    );
  }

  function renderEmployeeModal() {
    return (
      <Modal
        open={empModalOpen}
        onClose={() => setEmpModalOpen(false)}
        title={editingEmp ? `Editar · ${editingEmp.name}` : 'Novo colaborador'}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveEmployee} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-name" className="text-[13px] font-semibold text-[#14181F]">
                Nome completo
              </label>
              <input
                id="emp-name"
                required
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                placeholder="Nome do colaborador"
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-role" className="text-[13px] font-semibold text-[#14181F]">
                Especialidade / cargo
              </label>
              <input
                id="emp-role"
                required
                value={empRole}
                onChange={(e) => setEmpRole(e.target.value)}
                placeholder="Pedreiro, Carpinteiro, Eletricista..."
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-type" className="text-[13px] font-semibold text-[#14181F]">
                Vínculo
              </label>
              <select
                id="emp-type"
                value={empType}
                onChange={(e) => setEmpType(e.target.value as EmploymentType)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                {EMPLOYMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-sal" className="text-[13px] font-semibold text-[#14181F]">
                {empType === 'Sócio' ? 'Pró-labore fixo mensal (R$)' : paymentFrequency === 'oneOff' && empType !== 'CLT' ? 'Valor avulso (R$)' : 'Valor mensal (R$)'}
              </label>
              <input
                id="emp-sal"
                required
                value={empSalary}
                onChange={(e) => setEmpSalary(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-start" className="text-[13px] font-semibold text-[#14181F]">
                Data de início
              </label>
              <input
                id="emp-start"
                type="date"
                required
                value={empStartDate}
                onChange={(e) => setEmpStartDate(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          {empType !== 'CLT' && empType !== 'Sócio' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm flex flex-col gap-1">Frequência do pagamento
                <select value={paymentFrequency} onChange={(e) => setPaymentFrequency(e.target.value as 'monthly' | 'oneOff')}
                  className="rounded-lg border border-[#E4E1DA] p-2">
                  <option value="monthly">Mensal recorrente</option><option value="oneOff">Avulso</option>
                </select>
              </label>
              {paymentFrequency === 'oneOff' && (
                <label className="text-sm flex flex-col gap-1">Mês de referência
                  <input type="month" required value={paymentMonth} onChange={(e) => { if (e.target.value || !e.target.validity.badInput) setPaymentMonth(e.target.value); }}
                    className="rounded-lg border border-[#E4E1DA] p-2" />
                </label>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-pay" className="text-[13px] font-semibold text-[#14181F]">
                Forma de pagamento
              </label>
              <select
                id="emp-pay"
                required
                value={empPaymentMethod}
                onChange={(e) => setEmpPaymentMethod(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="">Selecione</option>
                <option value="Transferência">Transferência</option>
                <option value="PIX">PIX</option>
                <option value="Dinheiro">Dinheiro</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-proj" className="text-[13px] font-semibold text-[#14181F]">
                Obra padrão para semanas sem alocação
              </label>
              <select
                id="emp-proj"
                value={empProjectId}
                onChange={(e) => setEmpProjectId(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="">Sem obra alocada</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-aso" className="text-[13px] font-semibold text-[#14181F]">
                Validade ASO
              </label>
              <input
                id="emp-aso"
                type="date"
                value={empAso}
                onChange={(e) => setEmpAso(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-nr18" className="text-[13px] font-semibold text-[#14181F]">
                Validade NR-18
              </label>
              <input
                id="emp-nr18"
                type="date"
                value={empNr18}
                onChange={(e) => setEmpNr18(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-nr35" className="text-[13px] font-semibold text-[#14181F]">
                Validade NR-35
              </label>
              <input
                id="emp-nr35"
                type="date"
                value={empNr35}
                onChange={(e) => setEmpNr35(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-epi" className="text-[13px] font-semibold text-[#14181F]">
                EPIs entregues
              </label>
              <select
                id="emp-epi"
                value={empEpi}
                onChange={(e) => setEmpEpi(e.target.value as EpiStatus)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="Em dia">Em dia</option>
                <option value="A repor">A repor</option>
                <option value="Pendente">Pendente</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-onb" className="text-[13px] font-semibold text-[#14181F]">
                Integração inicial
              </label>
              <select
                id="emp-onb"
                value={empOnboarding}
                onChange={(e) => setEmpOnboarding(e.target.value as OnboardingStatus)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="Concluída">Concluída</option>
                <option value="Em andamento">Em andamento</option>
                <option value="Pendente">Pendente</option>
              </select>
            </div>
          </div>

          {feedback?.tone === 'bad' && <AlertNote tone="bad" title={feedback.title}>{feedback.text}</AlertNote>}
          <RegisteredBySelect value={empActor} onChange={setEmpActor} id="emp-actor" />

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEmpModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar colaborador'}
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Equipe"
        subtitle="Cadastro, alocação semanal, férias, segurança e folha de pagamento"
        companyEmail={companyEmail}
        actions={
          <>
            {tab === 'Alocação' && data.employees.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAllocEmpId('');
                  setAllocStageId('');
                  setAllocProjectId('');
                  setAllocWeekStart(weeks[0] || todayISO());
                  setAllocStatus('Obra');
                  setAllocModalOpen(true);
                }}
                className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
              >
                Nova alocação
              </button>
            )}
            {tab === 'Folha e encargos' && (
              <button
                type="button"
                onClick={() => {
                  setInssRate(String(data.settings?.inssRate ?? ''));
                  setFgtsRate(String(data.settings?.fgtsRate ?? ''));
                  setVacationRate(String(data.settings?.vacationRate ?? ''));
                  setThirteenthRate(String(data.settings?.thirteenthRate ?? ''));
                  setTaxEffectiveDate(data.settings?.taxParamsEffectiveDate || '');
                  setTaxSource(data.settings?.taxParamsSource || '');
                  setParamsModalOpen(true);
                }}
                className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
              >
                Parâmetros de encargos
              </button>
            )}
            <button
              type="button"
              onClick={openCreateEmployee}
              className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] cursor-pointer"
            >
              Novo colaborador
            </button>
          </>
        }
      />

      {feedback && (
        <AlertNote tone={feedback.tone} title={feedback.title}>
          {feedback.text}
        </AlertNote>
      )}

      <Tabs items={TEAM_TABS} active={tab} onChange={setTab} />
      {tab === 'Folha e encargos'
        ? <ListToolbar key="folha" label="lançamentos da folha" list={payrollList} projects={[{ id: 'Empresa', name: 'Empresa' }, ...data.projects]} />
        : <ListToolbar key={tab} label="colaboradores" list={roster} projects={data.projects} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Pessoas na equipe"
          value={data.employees.length > 0 ? String(data.employees.length) : 'Sem dados'}
          subtext={
            data.employees.length > 0
              ? `${payroll.cltCount} CLT · ${payroll.outrosCount} outros vínculos`
              : 'Cadastre os colaboradores'
          }
          isEmpty={data.employees.length === 0}
        />
        <KpiCard
          label="Custo da folha (mês)"
          value={
            data.employees.length === 0
              ? 'Sem dados'
              : payroll.custoTotalMensal !== null
              ? formatBRL(payroll.custoTotalMensal)
              : 'Não configurado'
          }
          subtext={
            data.employees.length > 0
              ? payroll.configurado
                ? 'Salários + encargos e provisões'
                : 'Configure as alíquotas em Folha e encargos'
              : 'Calculado pelos vínculos'
          }
          isEmpty={data.employees.length === 0}
        />
        <KpiCard
          label="Ociosidade prevista"
          value={unallocatedEmployeesCount !== null ? `${unallocatedEmployeesCount} pessoa(s)` : 'Sem dados'}
          subtext="Sem obra alocada na semana atual"
          isEmpty={unallocatedEmployeesCount === null}
        />
        <KpiCard
          label="Treinamentos a vencer"
          value={data.employees.length > 0 ? String(expiringTrainingCount) : 'Sem dados'}
          subtext="ASO, NR-18, NR-35 e EPIs (45 dias)"
          isEmpty={data.employees.length === 0}
        />
      </div>

      {data.employees.length === 0 ? (
        <EmptySection
          title="Nenhum colaborador cadastrado"
          description="Cadastre os profissionais da equipe (CLT, autônomos e diaristas) para calcular o custo mensal da folha, controlar ASO/NRs e alocar nas obras."
          actionLabel="Cadastrar primeiro colaborador"
          onAction={openCreateEmployee}
        />
      ) : (
        <>
          {tab === 'Cadastro' && (
            <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-[#14181F]">
                  Equipe cadastrada ({filteredEmployees.length})
                </h2>
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                      <SortHeading column="name" label="Colaborador" sort={roster.sort} className="py-2.5 px-3 rounded-l-lg" />
                      <SortHeading column="role" label="Especialidade" sort={roster.sort} className="py-2.5 px-3" />
                      <SortHeading column="employment" label="Vínculo" sort={roster.sort} className="py-2.5 px-3" />
                      <SortHeading column="project" label="Obra atual" sort={roster.sort} className="py-2.5 px-3" />
                      <SortHeading column="salary" label="Salário / base" sort={roster.sort} className="py-2.5 px-3 text-right" />
                      <SortHeading column="safety" label="Segurança" sort={roster.sort} className="py-2.5 px-3 rounded-r-lg" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((emp) => {
                      const hasIssue =
                        avaliarValidadeSst(emp.asoExpiry, todayStr).expiredOrSoon ||
                        avaliarValidadeSst(emp.nr18Expiry, todayStr).expiredOrSoon ||
                        avaliarValidadeSst(emp.nr35Expiry, todayStr).expiredOrSoon ||
                        emp.epiStatus !== 'Em dia';
                      return (
                        <tr
                          key={emp.id}
                          onClick={() => setSelectedEmployeeId(emp.id, { push: true })}
                          className="border-b border-[#E4E1DA] text-[13px] hover:bg-[#F6F5F2] cursor-pointer"
                        >
                          <td className="py-3 px-3"><button type="button" className="font-semibold text-[#1F3A5F] underline"
                            onClick={(event) => { event.stopPropagation(); setSelectedEmployeeId(emp.id, { push: true }); }}>{emp.name}</button></td>
                          <td className="py-3 px-3 text-[#5B6472]">{emp.role}</td>
                          <td className="py-3 px-3">
                            <StatusBadge label={emp.employmentType} />
                          </td>
                          <td className="py-3 px-3 text-[#14181F]">
                            {emp.currentProjectName || 'Sem obra'}
                          </td>
                          <td className="py-3 px-3 text-right font-semibold text-[#14181F] tabular-nums">
                            {formatBRL(emp.baseSalary)}
                          </td>
                          <td className="py-3 px-3">
                            <StatusBadge label={hasIssue ? 'Atenção' : 'Em dia'} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden flex flex-col gap-3">
                {filteredEmployees.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => setSelectedEmployeeId(emp.id, { push: true })}
                    className="text-left border border-[#E4E1DA] rounded-xl p-4 flex flex-col gap-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm font-semibold text-[#14181F]">{emp.name}</strong>
                      <StatusBadge label={emp.employmentType} />
                    </div>
                    <span className="text-xs text-[#5B6472]">
                      {emp.role} · {emp.currentProjectName || 'Sem obra'}
                    </span>
                    <strong className="text-sm font-bold text-[#14181F] tabular-nums">
                      {formatBRL(emp.baseSalary)}
                    </strong>
                  </button>
                ))}
              </div>
            </section>
          )}

          {tab === 'Alocação' && (
            <div className="flex flex-col gap-4">
              <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-[#14181F]">
                    Alocação · próximas 8 semanas
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setAllocEmpId('');
                      setAllocStageId('');
                      setAllocProjectId('');
                      setAllocWeekStart(weeks[0] || todayISO());
                      setAllocStatus('Obra');
                      setAllocModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#E4E1DA] text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
                  >
                    Alocar semana
                  </button>
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <div className="min-w-[780px] grid grid-cols-[180px_repeat(8,1fr)] gap-1.5 items-center text-xs">
                    <div className="font-semibold text-[#5B6472] px-2">Colaborador</div>
                    {weeks.map((w) => (
                      <div key={w} className="font-semibold text-[#5B6472] text-center py-1">
                        {formatShortDateBR(w)}
                      </div>
                    ))}
                    {visibleMatrix.map(({ employee: emp, cells }) => (
                      <div key={emp.id} className="contents">
                        <button
                          type="button"
                          onClick={() => setSelectedEmployeeId(emp.id, { push: true })}
                          className="text-left font-semibold text-[#14181F] truncate px-2 py-1.5 hover:underline cursor-pointer"
                        >
                          {emp.name}
                        </button>
                        {cells.map((cell, index) => {
                          const w = weeks[index];
                          const { vacation: isVac, idle: isNone } = cell;
                          const label = allocationLabel(cell);
                          return (
                            <button
                              key={`${emp.id}-${w}`}
                              type="button"
                              onClick={() => openAllocationCell(emp, w, cell)}
                              title={`${emp.name} · ${formatDateBR(w)}: ${label}`}
                              className={`h-8 rounded-md px-1.5 text-[11px] font-semibold truncate cursor-pointer ${
                                cell.conflict ? 'bg-[#FDECEA] text-[#B42318]' : isVac
                                  ? 'bg-[#ECEAE4] text-[#5B6472]'
                                  : isNone
                                  ? 'bg-[#FDECEA] text-[#B42318]'
                                  : 'bg-[#1F3A5F] text-white'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                <ul className="grid gap-2 md:hidden">
                  {visibleMatrix.map(({ employee, cells }) => (
                    <li key={employee.id} className="rounded-lg border border-[#E4E1DA] p-3">
                      <details>
                        <summary className="cursor-pointer break-words font-semibold text-[#1F3A5F]">{employee.name}</summary>
                        <ul className="mt-2 grid gap-1">
                          {cells.map((cell, index) => (
                            <li key={weeks[index]}>
                              <button type="button" onClick={() => openAllocationCell(employee, weeks[index], cell)}
                                className="flex w-full flex-wrap justify-between gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-[#F0EEE9]">
                                <strong>{formatDateBR(weeks[index])}</strong>
                                <span className="break-words">{allocationLabel(cell)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap gap-4 text-xs text-[#5B6472]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-[#1F3A5F]" /> Obra alocada
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-[#FDECEA] border border-[#B42318]" /> Sem obra
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-[#ECEAE4]" /> Férias
                  </span>
                </div>
              </section>

              {idleWeeks > 0 && (
                <AlertNote tone="warn" title="Ociosidade prevista">
                  {idleWeeks} semana(s) sem obra na matriz das próximas oito semanas.
                </AlertNote>
              )}
              {conflictWeeks > 0 && (
                <AlertNote tone="bad" title="Conflitos de alocação">
                  {conflictWeeks} semana(s) com registros divergentes. Abra a célula e salve a alocação correta para substituir os registros da semana.
                </AlertNote>
              )}
              <section className="rounded-xl border border-[#E4E1DA] bg-white p-5">
                <h2 className="font-semibold mb-2">Custo de equipe por centro · {formatMonthLabelBR(payrollMonth)}</h2>
                <DataList rows={monthlyPayroll.centers} keyExtractor={(row) => row.id} emptyTitle="Sem dados"
                  columns={[
                    { key: 'name', header: 'Centro de custo', render: (row) => row.name },
                    { key: 'cost', header: monthlyPayroll.configured ? 'Custo previsto' : 'Custo conhecido', render: (row) => formatBRL(row.amount) },
                  ]} />
              </section>
            </div>
          )}

          {tab === 'Férias' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-[#14181F]">Programação de férias</h2>
                  <button
                    type="button"
                    onClick={() => {
                      const first = data.employees.find((e) => e.employmentType === 'CLT') || data.employees[0];
                      setVacEmpId(first?.id || '');
                      setVacPeriod(first?.vacationPeriod || '');
                      setVacStart(first?.vacationStart || '');
                      setVacEnd(first?.vacationEnd || '');
                      setVacationModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#E4E1DA] text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
                  >
                    Programar férias
                  </button>
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                        <SortHeading column="name" label="Colaborador" sort={roster.sort} className="py-2.5 px-3 rounded-l-lg" />
                        <SortHeading column="employment" label="Vínculo" sort={roster.sort} className="py-2.5 px-3" />
                        <SortHeading column="vacationPeriod" label="Período aquisitivo" sort={roster.sort} className="py-2.5 px-3" />
                        <SortHeading column="vacationStart" label="Férias programadas" sort={roster.sort} className="py-2.5 px-3" />
                        <SortHeading column="status" label="Status" sort={roster.sort} className="py-2.5 px-3 rounded-r-lg" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.map((emp) => {
                        const isClt = emp.employmentType === 'CLT';
                        const statusLabel = !isClt
                          ? 'Sem férias (não CLT)'
                          : emp.vacationScheduled
                          ? 'Aprovada'
                          : 'Pendente';
                        return (
                          <tr key={emp.id} className="border-b border-[#E4E1DA] text-[13px]">
                            <td className="py-3 px-3 font-medium text-[#14181F]">{emp.name}</td>
                            <td className="py-3 px-3 text-[#5B6472]">{emp.employmentType}</td>
                            <td className="py-3 px-3 text-[#5B6472]">
                              {isClt ? emp.vacationPeriod || 'Não informado' : 'Não se aplica'}
                            </td>
                            <td className="py-3 px-3 text-[#14181F]">
                              {isClt ? emp.vacationScheduled || 'A programar' : 'Não se aplica'}
                            </td>
                            <td className="py-3 px-3">
                              <StatusBadge label={statusLabel} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden flex flex-col gap-3">
                  {filteredEmployees.map((emp) => (
                    <div key={emp.id} className="border border-[#E4E1DA] rounded-xl p-4 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <strong className="text-sm text-[#14181F]">{emp.name}</strong>
                        <StatusBadge label={emp.employmentType} />
                      </div>
                      <span className="text-xs text-[#5B6472]">
                        Programação: {emp.employmentType === 'CLT' ? emp.vacationScheduled || 'A programar' : 'Não se aplica'}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex flex-col gap-4">
                <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
                  <h2 className="text-base font-semibold text-[#14181F]">Provisão mensal de férias e 13º</h2>
                  <div className="flex justify-between text-[13px] py-1 border-b border-[#E4E1DA]">
                    <span className="text-[#5B6472]">Colaboradores CLT</span>
                    <strong className="text-[#14181F]">{payroll.cltCount}</strong>
                  </div>
                  <div className="flex justify-between text-[13px] py-1">
                    <span className="text-[#5B6472]">Provisão mensal calculada</span>
                    <strong className="text-[#14181F] tabular-nums">
                      {payroll.provisoesMensais !== null
                        ? formatBRL(payroll.provisoesMensais)
                        : 'não configurado'}
                    </strong>
                  </div>
                </section>
                <AlertNote tone="info" title="Impacto no planejamento e caixa">
                  Férias programadas aparecem na grade de alocação e as provisões entram na projeção mensal de saídas.
                </AlertNote>
              </div>
            </div>
          )}

          {tab === 'Segurança e capacitação' && (
            <div className="flex flex-col gap-4">
              <section className="grid gap-3 rounded-xl border border-[#E4E1DA] bg-white p-4 sm:p-5">
                <h2 className="text-base font-semibold text-[#14181F]">POPs do treinamento de integração</h2>
                {data.pops.some((pop) => isPublishedPop(pop) && pop.usedInOnboarding) ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {data.pops.filter((pop) => isPublishedPop(pop) && pop.usedInOnboarding).map((pop) => (
                      <li key={pop.id}>
                        <a href={'/pops?pop=' + encodeURIComponent(pop.id)}
                          className="block rounded-lg border border-[#E4E1DA] p-3 text-sm font-semibold text-[#1F3A5F] hover:underline focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
                          {pop.title} · {pop.version}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-[#5B6472]">Sem POPs publicados para a integração.</p>}
              </section>
              <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-[#14181F]">Matriz de conformidade de segurança</h2>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      label={expiringTrainingCount > 0 ? `${expiringTrainingCount} item(ns) em atenção` : 'Tudo em dia'}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const emp = data.employees[0];
                        if (!emp) return;
                        setSafetyEmpId(emp.id);
                        setSafetyAso(emp.asoExpiry || '');
                      setSafetyEpiExpiry(emp.epiExpiry || '');
                      setSafetyOnboardingStart(emp.onboardingStart || emp.startDate || '');
                        setSafetyNr18(emp.nr18Expiry || '');
                        setSafetyNr35(emp.nr35Expiry || '');
                        setSafetyEpi(emp.epiStatus || 'Em dia');
                        setSafetyOnboarding(emp.onboardingStatus || 'Concluída');
                        setSafetyModalOpen(true);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#1F3A5F] text-white text-xs font-semibold cursor-pointer"
                    >
                      Atualizar treinamento / ASO
                    </button>
                  </div>
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                        <SortHeading column="name" label="Colaborador" sort={roster.sort} className="py-2.5 px-3 rounded-l-lg" />
                        <SortHeading column="aso" label="ASO" sort={roster.sort} className="py-2.5 px-3" />
                        <SortHeading column="nr18" label="NR-18" sort={roster.sort} className="py-2.5 px-3" />
                        <SortHeading column="nr35" label="NR-35" sort={roster.sort} className="py-2.5 px-3" />
                        <SortHeading column="epi" label="EPIs" sort={roster.sort} className="py-2.5 px-3" />
                        <SortHeading column="onboarding" label="Integração" sort={roster.sort} className="py-2.5 px-3 rounded-r-lg" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.map((emp) => {
                        const aso = avaliarValidadeSst(emp.asoExpiry, todayStr);
                        const nr18 = avaliarValidadeSst(emp.nr18Expiry, todayStr);
                        const nr35 = avaliarValidadeSst(emp.nr35Expiry, todayStr);
                        return (
                          <tr key={emp.id} className="border-b border-[#E4E1DA] text-[13px]">
                            <td className="py-3 px-3 font-medium text-[#14181F]">{emp.name}</td>
                            <td className="py-3 px-3">
                              <StatusBadge label={aso.label} />
                            </td>
                            <td className="py-3 px-3">
                              <StatusBadge label={nr18.label} />
                            </td>
                            <td className="py-3 px-3">
                              <StatusBadge label={nr35.label} />
                            </td>
                            <td className="py-3 px-3">
                              <StatusBadge label={emp.epiStatus || 'Pendente'} />
                              {emp.epiExpiry && <StatusBadge label={avaliarValidadeSst(emp.epiExpiry, todayStr).label} />}
                            </td>
                            <td className="py-3 px-3">
                              <StatusBadge label={getOnboardingAlert(emp.onboardingStart, emp.startDate, emp.onboardingStatus, todayStr) ?? emp.onboardingStatus ?? 'Pendente'} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden flex flex-col gap-3">
                  {filteredEmployees.map((emp) => (
                    <div key={emp.id} className="border border-[#E4E1DA] rounded-xl p-4 flex flex-col gap-2">
                      <strong className="text-sm text-[#14181F]">{emp.name}</strong>
                      <div className="flex flex-wrap gap-1.5">
                        <StatusBadge label={`ASO: ${avaliarValidadeSst(emp.asoExpiry, todayStr).label}`} />
                        <StatusBadge label={`EPI: ${emp.epiStatus || 'Pendente'}`} />
                        <StatusBadge label={`NR-18: ${avaliarValidadeSst(emp.nr18Expiry, todayStr).label}`} />
                        <StatusBadge label={`NR-35: ${avaliarValidadeSst(emp.nr35Expiry, todayStr).label}`} />
                        {emp.epiExpiry && <StatusBadge label={`Validade do EPI: ${avaliarValidadeSst(emp.epiExpiry, todayStr).label}`} />}
                        <StatusBadge label={getOnboardingAlert(emp.onboardingStart, emp.startDate, emp.onboardingStatus, todayStr) ?? emp.onboardingStatus ?? 'Pendente'} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

{tab === 'Folha e encargos' && (
            <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className="text-sm font-semibold">Competência da folha
                  <input type="month" value={payrollMonth} onChange={(e) => { if (e.target.value) setPayrollMonth(e.target.value); }}
                    className="block rounded-lg border border-[#E4E1DA] p-2 font-normal" />
                </label>
                {currentMonthPayrollSent ? <StatusBadge label="Enviada ao Financeiro" tone="ok" /> : (
                  <button type="button" onClick={() => setPayrollModalOpen(true)}
                    disabled={!monthlyPayroll.configured || !monthlyPayroll.lines.length || !!monthlyPayroll.conflicts.length}
                    className="rounded-lg bg-[#1F3A5F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    Enviar ao Financeiro
                  </button>
                )}
              </div>
              {!monthlyPayroll.configured && (
                <AlertNote tone="warn" title="Encargos não configurados">
                  Os valores-base permanecem visíveis. Informe as alíquotas da empresa e a vigência para enviar a folha.
                </AlertNote>
              )}
              {monthlyPayroll.conflicts.length > 0 && (
                <AlertNote tone="bad" title="Resolva os conflitos de alocação">
                  {monthlyPayroll.conflicts.join(', ')}. Corrija as semanas na aba Alocação.
                </AlertNote>
              )}
              <DataList rows={payrollList.rows} sort={payrollList.sort} keyExtractor={(row, index) => row.employeeId + '-' + index} emptyTitle="Sem dados"
                columns={[
                  { key: 'person', header: 'Colaborador', render: (row) => row.employeeName },
                  { key: 'center', header: 'Centro de custo', render: (row) => row.projectName + (row.vacation ? ' · Férias' : '') },
                  { key: 'base', header: 'Remuneração', render: (row) => formatBRL(row.base) + (row.category === 'Pró-labore' ? ' · Pró-labore' : '') },
                  { key: 'charges', header: 'Encargos', render: (row) => row.charges === null ? 'não configurado' : formatBRL(row.charges) },
                  { key: 'provisions', header: 'Provisões de férias e 13º', render: (row) => row.provisions === null ? 'não configurado' : formatBRL(row.provisions) },
                  { key: 'total', header: 'Custo previsto', render: (row) => row.charges === null ? 'não configurado' : formatBRL(row.amount) },
                ]} />
              {monthlyPayroll.lines.length > 0 && (
                <p className="text-sm font-semibold">{monthlyPayroll.configured ? 'Total previsto' : 'Total conhecido'} · {formatBRL(monthlyPayroll.totalKnown)}</p>
              )}
              <p className="text-xs text-[#5B6472]">O rateio usa dias corridos por centro de custo. O pró-labore é o valor fixo mensal cadastrado para cada sócio.</p>
              {payroll.recorrentesNaoCltCount > 0 && (
                <AlertNote tone="warn" title="Atenção a pagamentos recorrentes">
                  {payroll.recorrentesNaoCltCount} vínculo(s) PJ ou autônomo recebem mensalmente. Avalie o enquadramento com contador ou advogado.
                </AlertNote>
              )}
            </section>
          )}
        </>
      )}

      {renderEmployeeModal()}

      {/* Allocation Modal */}
      <Modal
        open={allocModalOpen}
        onClose={() => setAllocModalOpen(false)}
        title="Alocar colaborador na semana"
      >
        <form onSubmit={handleSaveAllocation} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="alloc-emp" className="text-[13px] font-semibold text-[#14181F]">
              Colaborador
            </label>
            <select
              id="alloc-emp"
              required
              value={allocEmpId}
              onChange={(e) => { setAllocEmpId(e.target.value); setAllocStageId(''); }}
              className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
            >
              <option value="">Selecione</option>
              {data.employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.role})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="alloc-week" className="text-[13px] font-semibold text-[#14181F]">
                Semana iniciando em
              </label>
              <input type="date" required id="alloc-week" value={allocWeekStart}
                onChange={(e) => { setAllocWeekStart(e.target.value); setAllocStageId(''); }}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm" />
              <span className="text-xs text-[#5B6472]">Informe a segunda-feira da semana.</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="alloc-status" className="text-[13px] font-semibold text-[#14181F]">
                Situação
              </label>
              <select
                id="alloc-status"
                value={allocStatus}
                onChange={(e) => setAllocStatus(e.target.value as 'Obra' | 'Férias')}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="Obra">Obra</option>
                <option value="Férias">Férias</option>
              </select>
            </div>
          </div>
          {allocStatus === 'Obra' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="alloc-proj" className="text-[13px] font-semibold text-[#14181F]">
                Obra de destino
              </label>
              <select
                id="alloc-proj"
                value={allocProjectId}
                onChange={(e) => { setAllocProjectId(e.target.value); setAllocStageId(''); }}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="Sem obra">Sem obra</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {feedback?.tone === 'bad' && <AlertNote tone="bad" title={feedback.title}>{feedback.text}</AlertNote>}
          {allocStatus === 'Obra' && data.stages.some((stage) => stage.projectId === allocProjectId) && (
            <label className="grid gap-1 text-sm font-semibold">Etapa da obra
              <select value={allocStageId} onChange={(e) => setAllocStageId(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
                <option value="">Sem etapa</option>
                {data.stages.filter((stage) => stage.projectId === allocProjectId).map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.wbsCode} · {stage.name}</option>
                ))}
              </select>
            </label>
          )}
          <RegisteredBySelect value={allocActor} onChange={setAllocActor} id="alloc-actor" />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAllocModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar alocação'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Safety Modal */}
      <Modal
        open={safetyModalOpen}
        onClose={() => setSafetyModalOpen(false)}
        title="Atualizar segurança e capacitação"
      >
        <form onSubmit={handleSaveSafety} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="saf-emp" className="text-[13px] font-semibold text-[#14181F]">
              Colaborador
            </label>
            <select
              id="saf-emp"
              value={safetyEmpId}
              onChange={(e) => {
                const emp = data.employees.find((x) => x.id === e.target.value);
                setSafetyEmpId(e.target.value);
                if (emp) {
                  setSafetyAso(emp.asoExpiry || '');
                      setSafetyEpiExpiry(emp.epiExpiry || '');
                      setSafetyOnboardingStart(emp.onboardingStart || emp.startDate || '');
                  setSafetyNr18(emp.nr18Expiry || '');
                  setSafetyNr35(emp.nr35Expiry || '');
                  setSafetyEpi(emp.epiStatus || 'Em dia');
                  setSafetyOnboarding(emp.onboardingStatus || 'Concluída');
                }
              }}
              className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
            >
              {data.employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="saf-aso" className="text-[13px] font-semibold text-[#14181F]">
                Validade ASO
              </label>
              <input
                id="saf-aso"
                type="date"
                value={safetyAso}
                onChange={(e) => setSafetyAso(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="saf-nr18" className="text-[13px] font-semibold text-[#14181F]">
                Validade NR-18
              </label>
              <input
                id="saf-nr18"
                type="date"
                value={safetyNr18}
                onChange={(e) => setSafetyNr18(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="saf-nr35" className="text-[13px] font-semibold text-[#14181F]">
                Validade NR-35
              </label>
              <input
                id="saf-nr35"
                type="date"
                value={safetyNr35}
                onChange={(e) => setSafetyNr35(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="saf-epi" className="text-[13px] font-semibold text-[#14181F]">
                EPIs
              </label>
              <select
                id="saf-epi"
                value={safetyEpi}
                onChange={(e) => setSafetyEpi(e.target.value as EpiStatus)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="Em dia">Em dia</option>
                <option value="A repor">A repor</option>
                <option value="Pendente">Pendente</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="saf-onb" className="text-[13px] font-semibold text-[#14181F]">
                Integração
              </label>
              <select
                id="saf-onb"
                value={safetyOnboarding}
                onChange={(e) => setSafetyOnboarding(e.target.value as OnboardingStatus)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="Concluída">Concluída</option>
                <option value="Em andamento">Em andamento</option>
                <option value="Pendente">Pendente</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Validade dos EPIs
              <input type="date" value={safetyEpiExpiry} onChange={(e) => setSafetyEpiExpiry(e.target.value)}
                className="block w-full rounded-lg border border-[#E4E1DA] p-2" />
            </label>
            <label className="text-sm">Início da integração
              <input type="date" value={safetyOnboardingStart} onChange={(e) => setSafetyOnboardingStart(e.target.value)}
                className="block w-full rounded-lg border border-[#E4E1DA] p-2" />
            </label>
          </div>
          {feedback?.tone === 'bad' && <AlertNote tone="bad" title={feedback.title}>{feedback.text}</AlertNote>}
          <RegisteredBySelect value={safetyActor} onChange={setSafetyActor} id="saf-actor" />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setSafetyModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar registro'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Vacation Modal */}
      <Modal
        open={vacationModalOpen}
        onClose={() => setVacationModalOpen(false)}
        title="Programar férias"
      >
        <form onSubmit={handleSaveVacation} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="vac-emp" className="text-[13px] font-semibold text-[#14181F]">
              Colaborador
            </label>
            <select
              id="vac-emp"
              value={vacEmpId}
              onChange={(e) => {
                const emp = data.employees.find((x) => x.id === e.target.value);
                setVacEmpId(e.target.value);
                setVacPeriod(emp?.vacationPeriod || '');
                setVacStart(emp?.vacationStart || '');
                setVacEnd(emp?.vacationEnd || '');
              }}
              className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
            >
              {data.employees.filter((emp) => emp.employmentType === 'CLT').map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employmentType})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="vac-per" className="text-[13px] font-semibold text-[#14181F]">
                Período aquisitivo
              </label>
              <input
                id="vac-per"
                value={vacPeriod}
                onChange={(e) => setVacPeriod(e.target.value)}
                placeholder="Informe o mês de início e o de fim"
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm">Início das férias
                <input type="date" value={vacStart} onChange={(e) => setVacStart(e.target.value)}
                  className="block w-full rounded-lg border border-[#E4E1DA] p-2" />
              </label>
              <label className="text-sm">Fim das férias
                <input type="date" value={vacEnd} min={vacStart || undefined} onChange={(e) => setVacEnd(e.target.value)}
                  className="block w-full rounded-lg border border-[#E4E1DA] p-2" />
              </label>
            </div>
          </div>
          <p className="text-xs text-[#5B6472]">Os dias de férias saem da alocação em obra e vão para o centro Empresa na folha. A projeção mantém a remuneração e as provisões calculadas.</p>
          {feedback?.tone === 'bad' && <AlertNote tone="bad" title={feedback.title}>{feedback.text}</AlertNote>}
          <RegisteredBySelect value={vacActor} onChange={setVacActor} id="vac-actor" />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setVacationModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar programação'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Tax Parameters Modal */}
      <Modal
        open={paramsModalOpen}
        onClose={() => setParamsModalOpen(false)}
        title="Parâmetros de encargos e provisões (CLT)"
      >
        <form onSubmit={handleSaveTaxParams} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="p-inss" className="text-[13px] font-semibold text-[#14181F]">
                INSS patronal (%)
              </label>
              <input
                id="p-inss"
                type="number"
                step="0.01"
                min={0}
                value={inssRate}
                onChange={(e) => setInssRate(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="p-fgts" className="text-[13px] font-semibold text-[#14181F]">
                FGTS (%)
              </label>
              <input
                id="p-fgts"
                type="number"
                step="0.01"
                min={0}
                value={fgtsRate}
                onChange={(e) => setFgtsRate(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="p-vac" className="text-[13px] font-semibold text-[#14181F]">
                Provisão férias + 1/3 (%)
              </label>
              <input
                id="p-vac"
                type="number"
                step="0.01"
                min={0}
                value={vacationRate}
                onChange={(e) => setVacationRate(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="p-13" className="text-[13px] font-semibold text-[#14181F]">
                Provisão 13º salário (%)
              </label>
              <input
                id="p-13"
                type="number"
                step="0.01"
                min={0}
                value={thirteenthRate}
                onChange={(e) => setThirteenthRate(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="p-date" className="text-[13px] font-semibold text-[#14181F]">
                Vigência a partir de
              </label>
              <input
                id="p-date"
                type="date"
                value={taxEffectiveDate}
                onChange={(e) => setTaxEffectiveDate(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="p-src" className="text-[13px] font-semibold text-[#14181F]">
                Fonte / validação contábil
              </label>
              <input
                id="p-src"
                value={taxSource}
                onChange={(e) => setTaxSource(e.target.value)}
                placeholder="Fonte dos parâmetros de encargos"
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>
          {feedback?.tone === 'bad' && <AlertNote tone="bad" title={feedback.title}>{feedback.text}</AlertNote>}
          <RegisteredBySelect value={taxActor} onChange={setTaxActor} id="tax-actor" />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setParamsModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar parâmetros'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Send Payroll Modal */}
      <Modal
        open={payrollModalOpen}
        onClose={() => setPayrollModalOpen(false)}
        title="Enviar folha do mês ao Financeiro"
      >
        <form onSubmit={handleSendPayrollToFinance} className="flex flex-col gap-4">
          <AlertNote tone="info" title="Despesas previstas por pessoa e centro">
            {monthlyPayroll.lines.length} lançamento(s) em {formatMonthLabelBR(payrollMonth)}, no total de {formatBRL(monthlyPayroll.totalKnown)}. A baixa é feita em Contas a pagar.
          </AlertNote>
          <label className="text-sm font-semibold">Vencimento da folha
            <input type="date" required min={payrollMonth + '-01'} value={payrollDueDate}
              onChange={(e) => setPayrollDueDate(e.target.value)} className="block w-full rounded-lg border border-[#E4E1DA] p-2" />
          </label>
          {feedback?.tone === 'bad' && <AlertNote tone="bad" title={feedback.title}>{feedback.text}</AlertNote>}
          <RegisteredBySelect value={payrollActor} onChange={setPayrollActor} id="pay-actor" />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPayrollModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Enviando...' : 'Confirmar envio ao Financeiro'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
