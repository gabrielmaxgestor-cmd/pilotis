import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar, type AppRouteKey } from '../../src/components/ui/Sidebar';
import { MobileNav, MobileTopBar } from '../../src/components/ui/MobileNav';
import { GlobalSearch, SearchButton, useGlobalSearchShortcut } from '../../src/components/ui/GlobalSearch';
import { updateViewUrl, useViewSearch } from '../../src/hooks/useViewUrl';
import { ToastProvider } from '../../src/components/ui/Toast';
import { AgendaView } from '../../src/modules/AgendaView';
import { MaisView } from '../../src/pages/MaisView';
import { ComplianceView } from '../../src/modules/ComplianceView';
import { DashboardView } from '../../src/modules/DashboardView';
import { FinancialView } from '../../src/modules/FinancialView';
import { ProjectPlanningView } from '../../src/modules/ProjectPlanningView';
import { SettingsView } from '../../src/modules/SettingsView';
import type { FinancialTransaction, PilotisDataState } from '../../src/types/pilotis';
import '../../src/index.css';

const data: PilotisDataState = {
  settings: null, clients: [], quotes: [], projects: [], installments: [], stages: [],
  transactions: [], debts: [], employees: [], allocations: [], pops: [], complianceItems: [],
  tenders: [], warrantyCalls: [], dailyLogs: [], auditLogs: [],
};

function noAction() {}

function Fixture() {
  const params = useViewSearch();
  const route = (params.get('route') || 'dashboard') as AppRouteKey;
  const navigate = (next: AppRouteKey, tab?: string, selection: Record<string, string> = {}) =>
    updateViewUrl({ route: next, registro: undefined, ...(tab ? { [next + '.aba']: tab } : {}), ...selection }, { push: true });
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearch = () => setSearchOpen(true);
  useGlobalSearchShortcut(searchOpen, showSearch);
  const [newExpense, setNewExpense] = useState(false);
  const planningData: PilotisDataState = {
    ...data,
    projects: [{
      id: 'construction', ownerUid: 'browser-test', createdBy: 'Sócio', updatedBy: 'Sócio',
      name: 'Obra contratada', quoteId: 'quote', clientId: 'client', clientName: 'Cliente',
      type: 'Reforma', planningStatus: 'Aguardando modelo de cronograma', contractValue: 12000,
      budgetedLabor: 0, budgetedSubcontract: 0, budgetedEquipment: 0, budgetedBdi: 0, budgetedTax: 0,
      status: 'Contratada', contractSigned: false, warrantyStartDate: '',
      startDate: '2026-11-27', baselineEndDate: '2027-03-27', forecastEndDate: '2027-03-27',
    }],
  };
  const financeData: PilotisDataState = {
    ...data,
    transactions: [{
      id: 'expense', ownerUid: 'browser-test', createdBy: 'Sócio', updatedBy: 'Sócio',
      date: '2026-11-27', description: 'Comprovante de despesa', entryKind: 'expense',
      category: 'Empresa', projectId: 'Empresa', projectName: 'Empresa', amount: 135,
      status: 'Pago', isForecast: false, paymentMethod: 'Pix', invoiceStatus: 'Não se aplica',
      dueDate: '', installmentLabel: '', quoteId: '', debtId: '', source: 'manual',
    }],
  };
  const chartProject = { ...planningData.projects[0], budgetedLabor: 4000, budgetedTax: 600 };
  const chartEntry = (id: string, amount: number, category: string, fields: Partial<FinancialTransaction> = {}): FinancialTransaction => ({
    ...financeData.transactions[0], id, amount, category, description: category,
    projectId: chartProject.id, projectName: chartProject.name, ...fields,
  });
  const chartData: PilotisDataState = {
    ...data, projects: [chartProject],
    transactions: [
      chartEntry('income', 500, 'Receita de obra', { entryKind: 'income', status: 'Recebido' }),
      chartEntry('contracted', 300, 'Receita de obra', { entryKind: 'income', status: 'A vencer', isForecast: true }),
      chartEntry('credit', 100, 'Empréstimo', { entryKind: 'loan', status: 'Não é receita' }),
      chartEntry('payroll', 1000, 'Folha'),
      chartEntry('taxes', 250, 'Tributos'),
      chartEntry('interest', 100, 'Juros e tarifas', { projectId: 'Empresa', projectName: 'Empresa' }),
      chartEntry('materials', 150, 'Materiais'),
      chartEntry('unpaid', 200, 'Materiais', { status: 'A vencer', isForecast: true }),
    ],
    quotes: [{
      id: 'funnel', ownerUid: 'browser-test', createdBy: 'Sócio', updatedBy: 'Sócio',
      code: 'ORC-1', clientId: 'client', clientName: 'Cliente', title: 'Obra em negociação',
      type: 'Reforma', city: 'Valença', areaM2: 1, estimatedMonths: 1, validityDays: 30, description: '', origin: '',
      laborCost: 0, subcontractCost: 0, equipmentCost: 0, bdiCost: 0, taxCost: 0, totalValue: 1000,
      downPaymentPct: 40, installmentsCount: 1, probabilityPct: 50, status: 'Em negociação', discardReason: '', projectId: '',
    }],
  };
  const agendaData: PilotisDataState = params.get('agenda') === 'events' ? {
    ...planningData,
    installments: [{
      id: 'agenda-parcel', ownerUid: 'browser-test', createdBy: 'Sócio', updatedBy: 'Sócio',
      projectId: 'construction', projectName: 'Obra contratada', quoteId: 'quote', clientId: 'client', clientName: 'Cliente',
      number: 1, label: '01/04', dueDate: '2026-11-27', amount: 5000, status: 'A vencer',
      invoiceStatus: 'A emitir', receivedDate: '', transactionId: '',
    }],
    transactions: [{
      ...financeData.transactions[0], id: 'agenda-bill', description: 'Aluguel de equipamento R$ 135,00',
      dueDate: '2026-11-27', status: 'A vencer', isForecast: true, projectId: 'construction', projectName: 'Obra contratada',
    }],
    complianceItems: [{
      id: 'agenda-guide', ownerUid: 'browser-test', createdBy: 'Sócio', updatedBy: 'Sócio',
      kind: 'Obrigação', title: 'Guia de novembro', category: 'INSS', projectId: '', projectName: '',
      competence: '2026-11', dueDate: '2026-11-27', issuedDate: '', fileName: '', mandatory: true, status: 'Pendente', notes: '',
    }],
  } : data;
  const finance = params.get('agenda') === 'events' ? agendaData : params.get('finance') === 'charts' ? chartData : params.get('finance') === 'empty' ? data : financeData;
  const title = route === 'financial' ? 'Financeiro' : route === 'planning' ? 'Obras'
     : route === 'settings' ? 'Configurações' : route === 'agenda' ? 'Agenda' : route === 'more' ? 'Mais' : 'Dashboard';
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F6F5F2]">
      <Sidebar active={route} onSelect={navigate} onLogout={noAction} />
      <MobileTopBar onSearch={showSearch} title={title} onGoHome={() => navigate('dashboard')} onGoMore={() => navigate('more')} />
      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 px-4 py-4 pb-24 md:px-8 md:py-6 md:pb-8 max-w-[1360px]">
        <div className="hidden md:flex md:justify-end"><SearchButton onClick={showSearch} /></div>
        {route === 'dashboard' && <DashboardView data={data} onNavigate={navigate}
          onOpenProject={noAction} onOpenNewTransaction={() => { navigate('financial'); setNewExpense(true); }}
          onOpenNewQuote={noAction} />}
        {route === 'more' && <MaisView onSelect={navigate} onLogout={noAction} />}
        {route === 'agenda' && <AgendaView data={agendaData} onOpen={(target) => navigate(target.module, target.tab, target.params)} />}
        {route === 'compliance' && <ComplianceView uid="browser-test" data={agendaData} />}
        {route === 'financial' && <FinancialView uid="browser-test" data={finance} externalNewTxOpen={newExpense}
          onCloseExternalNewTx={() => setNewExpense(false)} />}
        {route === 'planning' && <ProjectPlanningView uid="browser-test" data={planningData} selectedProjectId="construction" onSelectProject={noAction} />}
        {route === 'settings' && <SettingsView uid="browser-test" data={data} initialTab="Importar dados" />}
      </main>
      <MobileNav active={route} onSelect={navigate} />
      {searchOpen && <GlobalSearch data={financeData} onClose={() => setSearchOpen(false)} onSelect={(result) => {
        setSearchOpen(false);
        updateViewUrl({ route: result.module, ...result.params }, { push: true });
      }} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<ToastProvider><Fixture /></ToastProvider>);
