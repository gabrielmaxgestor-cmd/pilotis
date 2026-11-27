import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar, type AppRouteKey } from '../../src/components/ui/Sidebar';
import { MobileNav, MobileTopBar } from '../../src/components/ui/MobileNav';
import { ToastProvider } from '../../src/components/ui/Toast';
import { DashboardView } from '../../src/modules/DashboardView';
import { FinancialView } from '../../src/modules/FinancialView';
import { ProjectPlanningView } from '../../src/modules/ProjectPlanningView';
import type { PilotisDataState } from '../../src/types/pilotis';
import '../../src/index.css';

const data: PilotisDataState = {
  settings: null, clients: [], quotes: [], projects: [], installments: [], stages: [],
  transactions: [], debts: [], employees: [], allocations: [], pops: [], complianceItems: [],
  tenders: [], warrantyCalls: [], dailyLogs: [], auditLogs: [],
};

function noAction() {}

function Fixture() {
  const [route, navigate] = useState<AppRouteKey>('dashboard');
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
  const title = route === 'financial' ? 'Financeiro' : route === 'planning' ? 'Obras' : 'Dashboard';
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F6F5F2]">
      <Sidebar active={route} onSelect={navigate} onLogout={noAction} />
      <MobileTopBar title={title} onGoHome={() => navigate('dashboard')} onGoMore={() => navigate('more')} />
      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 px-4 py-4 pb-24 md:px-8 md:py-6 md:pb-8 max-w-[1360px]">
        {route === 'dashboard' && <DashboardView data={data} onNavigate={navigate}
          onOpenProject={noAction} onOpenNewTransaction={() => { navigate('financial'); setNewExpense(true); }}
          onOpenNewQuote={noAction} />}
        {route === 'financial' && <FinancialView uid="browser-test" data={financeData} externalNewTxOpen={newExpense}
          onCloseExternalNewTx={() => setNewExpense(false)} />}
        {route === 'planning' && <ProjectPlanningView uid="browser-test" data={planningData} selectedProjectId="construction" onSelectProject={noAction} />}
      </main>
      <MobileNav active={route} onSelect={navigate} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<ToastProvider><Fixture /></ToastProvider>);
