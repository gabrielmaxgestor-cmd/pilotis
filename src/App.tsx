/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import { MobileNav, MobileTopBar } from './components/ui/MobileNav';
import { ErrorBoundary } from './components/ui/PilotisUI';
import { Sidebar, type AppRouteKey } from './components/ui/Sidebar';
import { ToastProvider } from './components/ui/Toast';
import { useCurrentUser } from './hooks/useCurrentUser';
import { testFirestoreConnection } from './lib/firebase';
import { importLegacyDailyQueue, startFieldSync } from './services/fieldQueue';
import { subscribePilotisCollections } from './services/pilotisService';
import type { ModuleKey, PilotisDataState } from './types/pilotis';

const ClientsQuotesView = lazy(() =>
  import('./modules/ClientsQuotesView').then((m) => ({ default: m.ClientsQuotesView }))
);
const ComplianceView = lazy(() =>
  import('./modules/ComplianceView').then((m) => ({ default: m.ComplianceView }))
);
const DashboardView = lazy(() =>
  import('./modules/DashboardView').then((m) => ({ default: m.DashboardView }))
);
const FinancialView = lazy(() =>
  import('./modules/FinancialView').then((m) => ({ default: m.FinancialView }))
);
const LoginView = lazy(() =>
  import('./modules/LoginView').then((m) => ({ default: m.LoginView }))
);
const OperationalAiView = lazy(() =>
  import('./modules/OperationalAiView').then((m) => ({ default: m.OperationalAiView }))
);
const PopsView = lazy(() =>
  import('./modules/PopsView').then((m) => ({ default: m.PopsView }))
);
const ProjectPlanningView = lazy(() =>
  import('./modules/ProjectPlanningView').then((m) => ({ default: m.ProjectPlanningView }))
);
const SettingsView = lazy(() =>
  import('./modules/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const TeamView = lazy(() =>
  import('./modules/TeamView').then((m) => ({ default: m.TeamView }))
);
const DevCatalogPage = lazy(() =>
  import('./pages/DevCatalogPage').then((m) => ({ default: m.DevCatalogPage }))
);
const MaisView = lazy(() =>
  import('./pages/EmptyModulePage').then((m) => ({ default: m.MaisView }))
);

function ModuleLoadingFallback({ label = 'Carregando módulo...' }: { label?: string }) {
  return (
    <div className="bg-white border border-[#E4E1DA] rounded-xl px-5 py-4 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-[#9A6212] text-white font-bold text-sm grid place-items-center shrink-0">
        P
      </div>
      <div>
        <strong className="block text-sm font-semibold text-[#14181F]">Pilotis</strong>
        <span className="text-xs text-[#5B6472]">{label}</span>
      </div>
    </div>
  );
}

const INITIAL_DATA_STATE: PilotisDataState = {
  settings: null,
  clients: [],
  quotes: [],
  projects: [],
  installments: [],
  stages: [],
  projectRisks: [],
  baselines: [],
  scheduleProgress: [],
  dailyLogs: [],
  transactions: [],
  debts: [],
  employees: [],
  allocations: [],
  pops: [],
  popVersions: [],
  complianceItems: [],
  tenders: [],
  warrantyCalls: [],
  projectClosures: [],
  projectFollowUps: [],
  auditLogs: [],
};

const ROUTE_TO_PATH: Record<AppRouteKey, string> = {
  dashboard: '/',
  ai: '/ia-operacional',
  financial: '/financeiro',
  clients: '/clientes',
  planning: '/obras',
  team: '/equipe',
  pops: '/pops',
  compliance: '/conformidade',
  settings: '/configuracoes',
  more: '/mais',
  dev: '/dev',
  login: '/login',
};

function parseRouteFromPathname(pathname: string): AppRouteKey {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  switch (normalized) {
    case '/':
    case '/dashboard':
      return 'dashboard';
    case '/ia-operacional':
      return 'ai';
    case '/financeiro':
      return 'financial';
    case '/clientes':
    case '/clientes-e-orcamentos':
      return 'clients';
    case '/obras':
    case '/planejamento':
      return 'planning';
    case '/equipe':
      return 'team';
    case '/pops':
      return 'pops';
    case '/conformidade':
      return 'compliance';
    case '/configuracoes':
      return 'settings';
    case '/mais':
      return 'more';
    case '/dev':
      return 'dev';
    case '/login':
      return 'login';
    default:
      return 'dashboard';
  }
}

const MOBILE_MODULE_TITLES: Record<ModuleKey, string> = {
  dashboard: 'Dashboard',
  ai: 'IA Operacional',
  financial: 'Financeiro',
  clients: 'Clientes e Orçamentos',
  planning: 'Obras',
  team: 'Equipe',
  pops: 'POPs',
  compliance: 'Conformidade',
  settings: 'Configurações',
};

function getMobileTopTitle(route: AppRouteKey): string {
  if (route === 'more') return 'Mais';
  if (route === 'dev') return 'Catálogo UI (/dev)';
  return MOBILE_MODULE_TITLES[route as ModuleKey] || 'Pilotis';
}

function AuthenticatedShell({
  uid,
  companyEmail,
  onLogout,
}: {
  uid: string;
  companyEmail: string | null;
  onLogout: () => Promise<void>;
}) {
  const [route, setRoute] = useState<AppRouteKey>(() => {
    const parsed = parseRouteFromPathname(window.location.pathname);
    return parsed === 'login' ? 'dashboard' : parsed;
  });

  const [data, setData] = useState<PilotisDataState>(INITIAL_DATA_STATE);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [financialInitialTab, setFinancialInitialTab] = useState<string | undefined>(undefined);
  const [complianceInitialTab, setComplianceInitialTab] = useState<string | undefined>(undefined);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  const [externalNewTxOpen, setExternalNewTxOpen] = useState(false);
  const [externalNewQuoteOpen, setExternalNewQuoteOpen] = useState(false);

  useEffect(() => {
    if (window.location.pathname === '/login') {
      window.history.replaceState(null, '', '/');
    }
    const onPopState = () => {
      const parsed = parseRouteFromPathname(window.location.pathname);
      setRoute(parsed === 'login' ? 'dashboard' : parsed);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    void testFirestoreConnection();
    const unsub = subscribePilotisCollections(uid, (partial) => {
      setData((prev) => ({ ...prev, ...partial }));
    });
    return () => {
      unsub();
    };
  }, [uid]);

  useEffect(() => startFieldSync(uid), [uid]);

  useEffect(() => {
    if (data.projects.length === 0) return;
    void importLegacyDailyQueue(uid, data.projects).catch((error) => console.warn('Diário armazenado no aparelho:', error));
  }, [uid, data.projects]);

  function navigateTo(nextRoute: AppRouteKey, subTab?: string) {
    if (nextRoute === 'login') {
      void onLogout();
      return;
    }

    if (nextRoute === 'financial') {
      setFinancialInitialTab(subTab);
    } else if (nextRoute === 'compliance') {
      setComplianceInitialTab(subTab);
    } else if (nextRoute === 'settings') {
      setSettingsInitialTab(subTab);
    }

    const nextPath = ROUTE_TO_PATH[nextRoute] || '/';
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath);
    }
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function handleModuleNavigate(mod: ModuleKey, subTab?: string) {
    navigateTo(mod, subTab);
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F6F5F2]">
      <Sidebar
        active={route}
        companyName={data.settings?.companyName || 'Pilotis'}
        logoDataUrl={data.settings?.logoDataUrl}
        accentColor={data.settings?.accentColor}
        onSelect={(key) => navigateTo(key)}
        onLogout={() => void onLogout()}
      />

      <MobileTopBar
        title={getMobileTopTitle(route)}
        onGoHome={() => navigateTo('dashboard')}
        onGoMore={() => navigateTo('more')}
      />

      <main className="flex-1 min-w-0 px-4 py-4 pb-24 md:px-8 md:py-6 md:pb-8 max-w-[1360px]">
        <Suspense fallback={<ModuleLoadingFallback />}>
          {route === 'dev' && <DevCatalogPage onNavigate={(r) => navigateTo(r)} />}

          {route === 'more' && (
            <MaisView
              onSelect={(r) => navigateTo(r)}
              onLogout={() => void onLogout()}
            />
          )}

          {route === 'dashboard' && (
            <DashboardView
              data={data}
              companyEmail={companyEmail}
              onNavigate={handleModuleNavigate}
              onOpenNewTransaction={() => {
                setExternalNewTxOpen(true);
                navigateTo('financial', 'Visão geral');
              }}
              onOpenNewQuote={() => {
                setExternalNewQuoteOpen(true);
                navigateTo('clients');
              }}
            />
          )}

          {route === 'ai' && (
            <OperationalAiView
              data={data}
              companyEmail={companyEmail}
              onNavigate={(mod) => navigateTo(mod)}
            />
          )}

          {route === 'financial' && (
            <FinancialView
              uid={uid}
              data={data}
              companyEmail={companyEmail}
              initialTab={financialInitialTab}
              externalNewTxOpen={externalNewTxOpen}
              onCloseExternalNewTx={() => setExternalNewTxOpen(false)}
            />
          )}

          {route === 'clients' && (
            <ClientsQuotesView
              uid={uid}
              data={data}
              companyEmail={companyEmail}
              externalNewQuoteOpen={externalNewQuoteOpen}
              onCloseExternalNewQuote={() => setExternalNewQuoteOpen(false)}
              onProjectCreated={(projId) => {
                setSelectedProjectId(projId);
                navigateTo('planning');
              }}
              onNavigateToReceivables={() => {
                navigateTo('financial', 'A receber');
              }}
            />
          )}

          {route === 'planning' && (
            <ProjectPlanningView
              uid={uid}
              data={data}
              companyEmail={companyEmail}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
            />
          )}

          {route === 'team' && (
            <TeamView uid={uid} data={data} companyEmail={companyEmail} />
          )}

          {route === 'pops' && (
            <PopsView uid={uid} data={data} companyEmail={companyEmail} />
          )}

          {route === 'compliance' && (
            <ComplianceView uid={uid} data={data} companyEmail={companyEmail} initialTab={complianceInitialTab} />
          )}

          {route === 'settings' && (
            <SettingsView
              uid={uid}
              data={data}
              companyEmail={companyEmail}
              initialTab={settingsInitialTab}
            />
          )}
        </Suspense>
      </main>

      <MobileNav active={route} onSelect={(key) => navigateTo(key)} />
    </div>
  );
}

function ProtectedPilotisApp() {
  const {
    user,
    loading,
    isAuthorized,
    authIssue,
    logout,
    resendVerificationEmail,
    reloadUser,
  } = useCurrentUser();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F5F2] flex items-center justify-center p-6">
        <div className="bg-white border border-[#E4E1DA] rounded-xl px-6 py-5 flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-lg bg-[#9A6212] text-white font-bold text-lg grid place-items-center shrink-0">
            P
          </div>
          <div>
            <strong className="block text-sm font-bold text-[#14181F]">
              Sistema de Gestão Pilotis
            </strong>
            <span className="text-xs text-[#5B6472]">
              Verificando sessão da empresa...
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthorized || !user) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-[#F6F5F2] flex items-center justify-center p-6">
            <ModuleLoadingFallback label="Carregando acesso..." />
          </div>
        }
      >
        <LoginView
          authIssue={authIssue}
          currentUserEmail={user?.email}
          onLogout={logout}
          onResendVerification={resendVerificationEmail}
          onReloadUser={reloadUser}
        />
      </Suspense>
    );
  }

  return (
    <AuthenticatedShell
      uid={user.uid}
      companyEmail={user.email}
      onLogout={logout}
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ProtectedPilotisApp />
      </ToastProvider>
    </ErrorBoundary>
  );
}
