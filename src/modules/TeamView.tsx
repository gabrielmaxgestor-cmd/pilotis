import { useMemo, useState } from 'react';
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
  updateRecord,
  upsertCompanySettings,
} from '../services/pilotisService';
import type {
  ActorRole,
  Employee,
  EmploymentType,
  EpiStatus,
  OnboardingStatus,
  PilotisDataState,
} from '../types/pilotis';
import {
  addDaysISO,
  avaliarValidadeSst,
  calcularEncargosColaborador,
  calcularPendenciasSegurancaEquipe,
  calcularResumoFolhaEquipe,
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

function getNext8Mondays(): string[] {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  const firstMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon);
  const weeks: string[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(firstMon.getFullYear(), firstMon.getMonth(), firstMon.getDate() + i * 7);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    weeks.push(`${y}-${m}-${dd}`);
  }
  return weeks;
}

export function TeamView({
  uid,
  data,
  companyEmail,
}: {
  uid: string;
  data: PilotisDataState;
  companyEmail?: string | null;
}) {
  const [tab, setTab] = useState('Cadastro');
  const [filterType, setFilterType] = useState('Todos');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

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
  const weeks = useMemo(() => getNext8Mondays(), []);
  const [allocEmpId, setAllocEmpId] = useState('');
  const [allocProjectId, setAllocProjectId] = useState('');
  const [allocWeekStart, setAllocWeekStart] = useState(weeks[0] || todayISO());
  const [allocStatus, setAllocStatus] = useState<'Obra' | 'Férias'>('Obra');
  const [allocActor, setAllocActor] = useState<ActorRole>('Sócio');

  // Safety form
  const [safetyEmpId, setSafetyEmpId] = useState('');
  const [safetyAso, setSafetyAso] = useState('');
  const [safetyNr18, setSafetyNr18] = useState('');
  const [safetyNr35, setSafetyNr35] = useState('');
  const [safetyEpi, setSafetyEpi] = useState<EpiStatus>('Em dia');
  const [safetyOnboarding, setSafetyOnboarding] = useState<OnboardingStatus>('Concluída');
  const [safetyActor, setSafetyActor] = useState<ActorRole>('Responsável administrativo');

  // Vacation form
  const [vacEmpId, setVacEmpId] = useState('');
  const [vacPeriod, setVacPeriod] = useState('');
  const [vacScheduled, setVacScheduled] = useState('');
  const [vacActor, setVacActor] = useState<ActorRole>('Responsável administrativo');

  // Occurrence form
  const [occText, setOccText] = useState('');
  const [occActor, setOccActor] = useState<ActorRole>('Sócio');

  // Tax params form
  const [inssRate, setInssRate] = useState(String(data.settings?.inssRate ?? 20));
  const [fgtsRate, setFgtsRate] = useState(String(data.settings?.fgtsRate ?? 8));
  const [vacationRate, setVacationRate] = useState(String(data.settings?.vacationRate ?? 11.11));
  const [thirteenthRate, setThirteenthRate] = useState(String(data.settings?.thirteenthRate ?? 8.33));
  const [taxEffectiveDate, setTaxEffectiveDate] = useState(data.settings?.taxParamsEffectiveDate || todayISO());
  const [taxSource, setTaxSource] = useState(data.settings?.taxParamsSource || 'Contador · regime atual');
  const [taxActor, setTaxActor] = useState<ActorRole>('Responsável administrativo');

  // Send payroll actor
  const [payrollActor, setPayrollActor] = useState<ActorRole>('Responsável administrativo');

  const todayStr = todayISO();
  const payroll = useMemo(
    () => calcularResumoFolhaEquipe(data.employees, data.settings, todayStr),
    [data.employees, data.settings, todayStr]
  );

  const selectedEmployee = data.employees.find((e) => e.id === selectedEmployeeId) || null;

  const filteredEmployees = data.employees.filter((e) => {
    if (filterType === 'Todos') return true;
    return e.employmentType === filterType;
  });

  const expiringTrainingCount = useMemo(
    () => calcularPendenciasSegurancaEquipe(data.employees, todayStr),
    [data.employees, todayStr]
  );

  const unallocatedEmployeesCount = useMemo(() => {
    if (data.employees.length === 0) return null;
    const firstWeek = weeks[0];
    return data.employees.filter((e) => {
      const hasAlloc = data.allocations.some(
        (a) => a.employeeId === e.id && a.weekStart === firstWeek && a.projectId !== 'Sem obra'
      );
      return !hasAlloc && !e.currentProjectId;
    }).length;
  }, [data.employees, data.allocations, weeks]);

  const currentMonthPayrollSent = data.transactions.some(
    (t) =>
      t.entryKind === 'expense' &&
      (t.source === 'folha' || t.category === 'Folha') &&
      monthKey(t.date) === monthKey(todayISO())
  );

  function openCreateEmployee() {
    setEditingEmp(null);
    setEmpName('');
    setEmpRole('');
    setEmpType('CLT');
    setEmpSalary('');
    setEmpPaymentMethod('Transferência');
    setEmpStartDate(todayISO());
    setEmpProjectId(data.projects[0]?.id || '');
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
    setEmpSalary(String(emp.baseSalary || ''));
    setEmpPaymentMethod(emp.paymentMethod || 'Transferência');
    setEmpStartDate(emp.startDate || todayISO());
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
    if (!empName.trim() || !empRole.trim()) return;
    setSaving(true);
    try {
      const proj = data.projects.find((p) => p.id === empProjectId);
      const salaryNum = parseCurrencyInput(empSalary);
      const payload = {
        name: clampStr(empName, 140),
        role: clampStr(empRole, 80),
        employmentType: empType,
        baseSalary: salaryNum,
        paymentMethod: clampStr(empPaymentMethod, 60),
        startDate: empStartDate || todayISO(),
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
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAllocation(e: React.FormEvent) {
    e.preventDefault();
    if (!allocEmpId) return;
    setSaving(true);
    try {
      const emp = data.employees.find((x) => x.id === allocEmpId);
      const proj = data.projects.find((p) => p.id === allocProjectId);
      const targetProjId = allocStatus === 'Férias' ? 'Férias' : proj?.id || 'Sem obra';
      const targetProjName =
        allocStatus === 'Férias' ? 'Férias' : proj?.name || 'Sem obra';

      await createRecord(
        'allocations',
        uid,
        allocActor,
        {
          employeeId: allocEmpId,
          employeeName: clampStr(emp?.name || '', 140),
          projectId: targetProjId,
          projectName: clampStr(targetProjName, 160),
          weekStart: allocWeekStart,
          status: allocStatus,
        },
        `Alocação: ${emp?.name || 'Colaborador'} em ${targetProjName} (semana ${formatDateBR(allocWeekStart)})`
      );
      if (emp && allocStatus === 'Obra' && proj) {
        await updateRecord(
          'employees',
          emp.id,
          uid,
          allocActor,
          {
            currentProjectId: proj.id,
            currentProjectName: clampStr(proj.name, 160),
          },
          `Obra atual de ${emp.name} atualizada para ${proj.name}`,
          emp.currentProjectName || 'Sem obra',
          proj.name
        );
      }
      setAllocModalOpen(false);
      setFeedback({
        tone: 'ok',
        title: 'Alocação registrada',
        text: 'Quadro semanal de alocação atualizado.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSafety(e: React.FormEvent) {
    e.preventDefault();
    const emp = data.employees.find((x) => x.id === safetyEmpId);
    if (!emp) return;
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
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveVacation(e: React.FormEvent) {
    e.preventDefault();
    const emp = data.employees.find((x) => x.id === vacEmpId);
    if (!emp) return;
    setSaving(true);
    try {
      await updateRecord(
        'employees',
        emp.id,
        uid,
        vacActor,
        {
          vacationPeriod: clampStr(vacPeriod, 60),
          vacationScheduled: clampStr(vacScheduled, 60),
        },
        `Férias atualizadas para ${emp.name}: ${vacScheduled}`,
        emp.vacationScheduled || 'A programar',
        vacScheduled
      );
      setVacationModalOpen(false);
      setFeedback({
        tone: 'ok',
        title: 'Programação de férias salva',
        text: `Férias de ${emp.name} atualizadas.`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveOccurrence(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEmployee || !occText.trim()) return;
    setSaving(true);
    try {
      const prefix = selectedEmployee.occurrencesNote
        ? `${selectedEmployee.occurrencesNote}\n`
        : '';
      const line = `[${formatDateBR(todayISO())} · ${occActor}] ${occText.trim()}`;
      const combined = clampStr(`${prefix}${line}`, 1000);
      await updateRecord(
        'employees',
        selectedEmployee.id,
        uid,
        occActor,
        { occurrencesNote: combined },
        `Ocorrência registrada para ${selectedEmployee.name}`
      );
      setOccurrenceModalOpen(false);
      setOccText('');
      setFeedback({
        tone: 'ok',
        title: 'Ocorrência registrada',
        text: `Histórico de ${selectedEmployee.name} atualizado.`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTaxParams(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await upsertCompanySettings(uid, taxActor, data.settings, {
        inssRate: Number(inssRate) || 0,
        fgtsRate: Number(fgtsRate) || 0,
        vacationRate: Number(vacationRate) || 0,
        thirteenthRate: Number(thirteenthRate) || 0,
        taxParamsEffectiveDate: taxEffectiveDate || todayISO(),
        taxParamsSource: clampStr(taxSource, 120),
      });
      setParamsModalOpen(false);
      setFeedback({
        tone: 'ok',
        title: 'Parâmetros de encargos salvos',
        text: 'Os encargos e provisões da folha CLT passam a usar as novas alíquotas.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSendPayrollToFinance(e: React.FormEvent) {
    e.preventDefault();
    if (payroll.custoTotalMensal === null || payroll.custoTotalMensal <= 0) return;
    const totalAmount = payroll.custoTotalMensal;
    setSaving(true);
    try {
      const today = todayISO();
      await createRecord(
        'transactions',
        uid,
        payrollActor,
        {
          date: today,
          dueDate: today,
          description: clampStr(`Folha e encargos (${payroll.totalColaboradores} pessoas)`, 200),
          entryKind: 'expense',
          category: 'Folha',
          projectId: 'Empresa',
          projectName: 'Empresa',
          amount: Math.round(totalAmount * 100) / 100,
          isForecast: false,
          status: 'Pago',
          invoiceStatus: 'Não se aplica',
          paymentMethod: 'Transferência',
          installmentLabel: monthKey(today),
          quoteId: '',
          debtId: '',
          source: 'folha',
        },
        `Folha do mês enviada ao Financeiro: ${formatBRL(totalAmount)}`
      );
      setPayrollModalOpen(false);
      setFeedback({
        tone: 'ok',
        title: 'Folha enviada ao Financeiro',
        text: `Lançamento de ${formatBRL(totalAmount)} criado em Contas pagas.`,
      });
    } finally {
      setSaving(false);
    }
  }

  // Collaborator Profile View
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

    const occurrencesList = selectedEmployee.occurrencesNote
      ? selectedEmployee.occurrencesNote.split('\n').filter(Boolean)
      : [];

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
              <StatusBadge label={selectedEmployee.currentProjectName || 'Sem obra alocada'} />
              <StatusBadge
                label={
                  asoStatus.expiredOrSoon || nr18Status.expiredOrSoon || nr35Status.expiredOrSoon || selectedEmployee.epiStatus !== 'Em dia'
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
              <span className="text-[#5B6472]">Integração</span>
              <StatusBadge label={selectedEmployee.onboardingStatus || 'Pendente'} />
            </div>
          </section>

          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
            <h3 className="text-base font-semibold text-[#14181F]">Alocação e férias</h3>
            <div className="flex justify-between text-[13px] py-1 border-b border-[#E4E1DA]">
              <span className="text-[#5B6472]">Alocação atual</span>
              <strong className="text-[#14181F]">
                {selectedEmployee.currentProjectName || 'Sem obra alocada'}
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
          <h3 className="text-base font-semibold text-[#14181F]">Ocorrências e histórico</h3>
          {occurrencesList.length === 0 ? (
            <p className="text-sm text-[#5B6472]">
              Nenhuma ocorrência registrada para este colaborador.
            </p>
          ) : (
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

        <Modal
          open={occurrenceModalOpen}
          onClose={() => setOccurrenceModalOpen(false)}
          title={`Registrar ocorrência · ${selectedEmployee.name}`}
        >
          <form onSubmit={handleSaveOccurrence} className="flex flex-col gap-4">
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
                placeholder="Ex.: Treinamento concluído no POP de revestimento ou elogio de acabamento."
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
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
                <option value="CLT">CLT</option>
                <option value="Autônomo">Autônomo</option>
                <option value="Diarista">Diarista</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-sal" className="text-[13px] font-semibold text-[#14181F]">
                Salário ou valor mensal (R$)
              </label>
              <input
                id="emp-sal"
                required
                value={empSalary}
                onChange={(e) => setEmpSalary(e.target.value)}
                placeholder="3200,00"
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
                value={empStartDate}
                onChange={(e) => setEmpStartDate(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-pay" className="text-[13px] font-semibold text-[#14181F]">
                Forma de pagamento
              </label>
              <select
                id="emp-pay"
                value={empPaymentMethod}
                onChange={(e) => setEmpPaymentMethod(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="Transferência">Transferência</option>
                <option value="PIX">PIX</option>
                <option value="Dinheiro">Dinheiro</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-proj" className="text-[13px] font-semibold text-[#14181F]">
                Obra atual
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
                  setAllocEmpId(data.employees[0]?.id || '');
                  setAllocProjectId(data.projects[0]?.id || '');
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
                  setInssRate(String(data.settings?.inssRate ?? 20));
                  setFgtsRate(String(data.settings?.fgtsRate ?? 8));
                  setVacationRate(String(data.settings?.vacationRate ?? 11.11));
                  setThirteenthRate(String(data.settings?.thirteenthRate ?? 8.33));
                  setTaxEffectiveDate(data.settings?.taxParamsEffectiveDate || todayISO());
                  setTaxSource(data.settings?.taxParamsSource || 'Contador · regime atual');
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Pessoas na equipe"
          value={data.employees.length > 0 ? String(data.employees.length) : 'Sem dados'}
          subtext={
            data.employees.length > 0
              ? `${payroll.cltCount} CLT · ${payroll.outrosCount} autônomos/diaristas`
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
                <SegmentedControl
                  items={['Todos', 'CLT', 'Autônomo', 'Diarista']}
                  active={filterType}
                  onChange={setFilterType}
                />
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                      <th className="py-2.5 px-3 rounded-l-lg">Colaborador</th>
                      <th className="py-2.5 px-3">Especialidade</th>
                      <th className="py-2.5 px-3">Vínculo</th>
                      <th className="py-2.5 px-3">Obra atual</th>
                      <th className="py-2.5 px-3 text-right">Salário / base</th>
                      <th className="py-2.5 px-3 rounded-r-lg">Segurança</th>
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
                          onClick={() => setSelectedEmployeeId(emp.id)}
                          className="border-b border-[#E4E1DA] text-[13px] hover:bg-[#F6F5F2] cursor-pointer"
                        >
                          <td className="py-3 px-3 font-semibold text-[#1F3A5F] underline-offset-2 hover:underline">
                            {emp.name}
                          </td>
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
                    onClick={() => setSelectedEmployeeId(emp.id)}
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
                      setAllocEmpId(data.employees[0]?.id || '');
                      setAllocProjectId(data.projects[0]?.id || '');
                      setAllocWeekStart(weeks[0] || todayISO());
                      setAllocStatus('Obra');
                      setAllocModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#E4E1DA] text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
                  >
                    Alocar semana
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <div className="min-w-[780px] grid grid-cols-[180px_repeat(8,1fr)] gap-1.5 items-center text-xs">
                    <div className="font-semibold text-[#5B6472] px-2">Colaborador</div>
                    {weeks.map((w) => (
                      <div key={w} className="font-semibold text-[#5B6472] text-center py-1">
                        {formatShortDateBR(w)}
                      </div>
                    ))}
                    {data.employees.map((emp) => (
                      <div key={emp.id} className="contents">
                        <button
                          type="button"
                          onClick={() => setSelectedEmployeeId(emp.id)}
                          className="text-left font-semibold text-[#14181F] truncate px-2 py-1.5 hover:underline cursor-pointer"
                        >
                          {emp.name}
                        </button>
                        {weeks.map((w) => {
                          const alloc = data.allocations.find(
                            (a) => a.employeeId === emp.id && a.weekStart === w
                          );
                          const label = alloc
                            ? alloc.status === 'Férias'
                              ? 'Férias'
                              : alloc.projectName || 'Obra'
                            : emp.currentProjectName || 'Sem obra';
                          const isVac = alloc?.status === 'Férias';
                          const isNone = label === 'Sem obra';
                          return (
                            <button
                              key={`${emp.id}-${w}`}
                              type="button"
                              onClick={() => {
                                setAllocEmpId(emp.id);
                                setAllocProjectId(alloc?.projectId || emp.currentProjectId || '');
                                setAllocWeekStart(w);
                                setAllocStatus(alloc?.status || 'Obra');
                                setAllocModalOpen(true);
                              }}
                              title={`${emp.name} · ${formatDateBR(w)}: ${label}`}
                              className={`h-8 rounded-md px-1.5 text-[11px] font-semibold truncate cursor-pointer ${
                                isVac
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

              {unallocatedEmployeesCount !== null && unallocatedEmployeesCount > 0 && (
                <AlertNote tone="warn" title={`${unallocatedEmployeesCount} pessoa(s) sem obra na semana atual`}>
                  Avalie realocar para obras satélites ou confirmar novos orçamentos no funil comercial.
                </AlertNote>
              )}
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
                      setVacScheduled(first?.vacationScheduled || '');
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
                        <th className="py-2.5 px-3 rounded-l-lg">Colaborador</th>
                        <th className="py-2.5 px-3">Vínculo</th>
                        <th className="py-2.5 px-3">Período aquisitivo</th>
                        <th className="py-2.5 px-3">Férias programadas</th>
                        <th className="py-2.5 px-3 rounded-r-lg">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.employees.map((emp) => {
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
                  {data.employees.map((emp) => (
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
                        setSafetyAso(emp.asoExpiry || addDaysISO(todayISO(), 365));
                        setSafetyNr18(emp.nr18Expiry || addDaysISO(todayISO(), 365));
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
                        <th className="py-2.5 px-3 rounded-l-lg">Colaborador</th>
                        <th className="py-2.5 px-3">ASO</th>
                        <th className="py-2.5 px-3">NR-18</th>
                        <th className="py-2.5 px-3">NR-35</th>
                        <th className="py-2.5 px-3">EPIs</th>
                        <th className="py-2.5 px-3 rounded-r-lg">Integração</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.employees.map((emp) => {
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
                            </td>
                            <td className="py-3 px-3">
                              <StatusBadge label={emp.onboardingStatus || 'Pendente'} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden flex flex-col gap-3">
                  {data.employees.map((emp) => (
                    <div key={emp.id} className="border border-[#E4E1DA] rounded-xl p-4 flex flex-col gap-2">
                      <strong className="text-sm text-[#14181F]">{emp.name}</strong>
                      <div className="flex flex-wrap gap-1.5">
                        <StatusBadge label={`ASO: ${avaliarValidadeSst(emp.asoExpiry, todayStr).label}`} />
                        <StatusBadge label={`EPI: ${emp.epiStatus || 'Pendente'}`} />
                        <StatusBadge label={`Integração: ${emp.onboardingStatus || 'Pendente'}`} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {tab === 'Folha e encargos' && (
            <div className="flex flex-col gap-4">
              <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-[#14181F]">Folha calculada do mês</h2>
                    <p className="text-xs text-[#5B6472]">
                      {payroll.configurado
                        ? `Alíquotas vigentes desde ${formatDateBR(data.settings?.taxParamsEffectiveDate)} (${data.settings?.taxParamsSource || 'Configurado'})`
                        : 'Configure as alíquotas e vigência validadas com o contador em “Parâmetros de encargos”.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {currentMonthPayrollSent && (
                      <StatusBadge label="Enviado ao Financeiro neste mês" tone="ok" />
                    )}
                    <button
                      type="button"
                      onClick={() => setPayrollModalOpen(true)}
                      disabled={payroll.custoTotalMensal === null || payroll.custoTotalMensal <= 0}
                      className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-xs font-semibold hover:bg-[#182E4C] cursor-pointer disabled:opacity-50"
                    >
                      Enviar folha do mês ao Financeiro
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                        <th className="py-2.5 px-3 rounded-l-lg">Grupo</th>
                        <th className="py-2.5 px-3 text-right">Salários e valores</th>
                        <th className="py-2.5 px-3 text-right">Encargos (INSS/FGTS)</th>
                        <th className="py-2.5 px-3 text-right">Provisões (férias/13º)</th>
                        <th className="py-2.5 px-3 text-right rounded-r-lg">Custo total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[#E4E1DA] text-[13px]">
                        <td className="py-3 px-3 font-medium text-[#14181F]">
                          CLT ({payroll.cltCount})
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {formatBRL(payroll.cltSalarioBase)}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {payroll.encargosMensais !== null
                            ? formatBRL(payroll.encargosMensais)
                            : 'não configurado'}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {payroll.provisoesMensais !== null
                            ? formatBRL(payroll.provisoesMensais)
                            : 'não configurado'}
                        </td>
                        <td className="py-3 px-3 text-right font-semibold text-[#14181F] tabular-nums">
                          {payroll.cltCustoTotal !== null
                            ? formatBRL(payroll.cltCustoTotal)
                            : 'não configurado'}
                        </td>
                      </tr>
                      <tr className="border-b border-[#E4E1DA] text-[13px]">
                        <td className="py-3 px-3 font-medium text-[#14181F]">
                          Autônomos e diaristas ({payroll.outrosCount})
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {formatBRL(payroll.outrosSalarioBase)}
                        </td>
                        <td className="py-3 px-3 text-right text-[#5B6472]">—</td>
                        <td className="py-3 px-3 text-right text-[#5B6472]">—</td>
                        <td className="py-3 px-3 text-right font-semibold text-[#14181F] tabular-nums">
                          {formatBRL(payroll.outrosSalarioBase)}
                        </td>
                      </tr>
                      <tr className="text-[13px] font-bold bg-[#F6F5F2]">
                        <td className="py-3 px-3 text-[#14181F]">Total mensal</td>
                        <td className="py-3 px-3 text-right tabular-nums">{formatBRL(payroll.folhaBase)}</td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {payroll.encargosMensais !== null
                            ? formatBRL(payroll.encargosMensais)
                            : 'não configurado'}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {payroll.provisoesMensais !== null
                            ? formatBRL(payroll.provisoesMensais)
                            : 'não configurado'}
                        </td>
                        <td className="py-3 px-3 text-right text-[#1F3A5F] tabular-nums">
                          {payroll.custoTotalMensal !== null
                            ? formatBRL(payroll.custoTotalMensal)
                            : 'não configurado'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AlertNote tone="info" title="Parâmetros validados com o contador">
                  Alíquotas e regras por vínculo ficam parametrizadas com data de vigência e fonte, nunca fixas no código.
                </AlertNote>
                {payroll.recorrentesNaoCltCount > 0 && (
                  <AlertNote tone="warn" title="Atenção a vínculos autônomos recorrentes">
                    {payroll.recorrentesNaoCltCount} autônomo(s) possuem valor mensal recorrente cadastrado. Avalie o enquadramento com contador ou advogado.
                  </AlertNote>
                )}
              </div>
            </div>
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
              value={allocEmpId}
              onChange={(e) => setAllocEmpId(e.target.value)}
              className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
            >
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
              <select
                id="alloc-week"
                value={allocWeekStart}
                onChange={(e) => setAllocWeekStart(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                {weeks.map((w) => (
                  <option key={w} value={w}>
                    {formatDateBR(w)}
                  </option>
                ))}
              </select>
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
                onChange={(e) => setAllocProjectId(e.target.value)}
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
                setVacScheduled(emp?.vacationScheduled || '');
              }}
              className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
            >
              {data.employees.map((emp) => (
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
                placeholder="Ex.: 02/2026 a 01/2027"
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="vac-sch" className="text-[13px] font-semibold text-[#14181F]">
                Férias programadas
              </label>
              <input
                id="vac-sch"
                value={vacScheduled}
                onChange={(e) => setVacScheduled(e.target.value)}
                placeholder="Ex.: 02/02 a 21/02/2027"
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>
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
                placeholder="Ex.: Contador · Simples Anexo IV"
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>
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
          <AlertNote tone="info" title="Lançamento integrado">
            Será registrada uma saída de{' '}
            <strong>
              {payroll.custoTotalMensal !== null
                ? formatBRL(payroll.custoTotalMensal)
                : 'não configurado'}
            </strong>{' '}
            na categoria <strong>Folha</strong> para {payroll.totalColaboradores} colaborador(es).
          </AlertNote>
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
