import { ACCOUNTING_COLLECTIONS } from './domain/accountingPackage';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { MobileNav, MobileTopBar } from './components/ui/MobileNav';
import { ArchivedRecords } from './components/ui/ArchivedRecords';
import { activePilotisData, type ArchivableCollection } from './domain/recordLifecycle';
import { Button, ErrorBoundary } from './components/ui/PilotisUI';
import { GlobalSearch, SearchButton, useGlobalSearchShortcut } from './components/ui/GlobalSearch';
import { updateViewUrl, useViewParam, useViewSearch } from './hooks/useViewUrl';
import { Sidebar, type AppRouteKey } from './components/ui/Sidebar';
import { ToastProvider } from './components/ui/Toast';
import { useCurrentUser } from './hooks/useCurrentUser';
import { importLegacyDailyQueue, startFieldSync } from './services/fieldQueue';
import { subscribePilotisCollections } from './services/pilotisService';
import { readEmailAction } from './services/emailActions';
import type { ModuleKey, PilotisDataState } from './types/pilotis';

const AgendaView = lazy(() =>
  import('./modules/AgendaView').then((m) => ({ default: m.AgendaView }))
);
const ClientsQuotesView = lazy(() =>
  import('./modules/ClientsQuotesView').then((m) => ({ default: m.ClientsQuotesView }))
);
const ComplianceView = lazy(() =>
  import('./modules/ComplianceView').then((m) => ({ default: m.ComplianceView }))
);
const EmailActionView = lazy(() =>
  import('./modules/EmailActionView').then((m) => ({ default: m.EmailActionView }))
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
const MaisView = lazy(() =>
  import('./pages/MaisView').then((m) => ({ default: m.MaisView }))
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
  customerMaterials: [],
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
  agenda: '/agenda',
  clients: '/clientes',
  planning: '/obras',
  team: '/equipe',
  pops: '/pops',
  compliance: '/conformidade',
  settings: '/configuracoes',
  more: '/mais',
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
    case '/agenda':
      return 'agenda';
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
  agenda: 'Agenda',
  clients: 'Clientes e Orçamentos',
  planning: 'Obras',
  team: 'Equipe',
  pops: 'POPs',
  compliance: 'Conformidade',
  settings: 'Configurações',
};

function getMobileTopTitle(route: AppRouteKey): string {
  if (route === 'more') return 'Mais';
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

  const [records, setData] = useState<PilotisDataState>(INITIAL_DATA_STATE);
  const data = useMemo(() => activePilotisData(records), [records]);
  const [dashboardReady, setDashboardReady] = useState(false);
  const [dashboardLoadFailed, setDashboardLoadFailed] = useState(false);
  const [accountingLoadState, setAccountingLoadState] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [selectedProjectId, setSelectedProjectId] = useViewParam('planning.obra');
  const query = useViewSearch();
  const archiveEntities: readonly ArchivableCollection[] | undefined = route === 'clients' ? ['clients', 'quotes']
    : route === 'planning' ? ['projects'] : route === 'team' ? ['employees'] : undefined;
  const archiveParam = route + '.arquivados';
  const showArchived = Boolean(archiveEntities && query.get(archiveParam) === 'sim');
  const [searchOpen, setSearchOpen] = useState(false);
  useGlobalSearchShortcut(searchOpen, () => setSearchOpen(true));
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
    const dashboardPending = new Set([
      'clients', 'quotes', 'projects', 'installments', 'stages', 'customerMaterials', 'transactions',
      'debts', 'employees', 'allocations', 'settings', 'complianceItems', 'warrantyCalls',
    ]);
    const accountingPending = new Set<string>(ACCOUNTING_COLLECTIONS);
    let accountingFailed = false;
    setAccountingLoadState('loading');
    const unsub = subscribePilotisCollections(uid, (partial) => {
      if (accountingPending.size) {
        Object.keys(partial).forEach((name) => accountingPending.delete(name));
        if (!accountingPending.size && !accountingFailed) setAccountingLoadState('ready');
      }
      setData((prev) => ({ ...prev, ...partial }));
      if (dashboardPending.size) {
        Object.keys(partial).forEach((name) => dashboardPending.delete(name));
        if (!dashboardPending.size) setDashboardReady(true);
      }
    }, (key) => {
      if (ACCOUNTING_COLLECTIONS.some((name) => name === key)) {
        accountingFailed = true;
        setAccountingLoadState('failed');
      }
      if (dashboardPending.has(key)) setDashboardLoadFailed(true);
      else console.error('Falha ao sincronizar os registros de ' + key);
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

  function navigateTo(nextRoute: AppRouteKey, subTab?: string, selection: Record<string, string> = {}) {
    if (nextRoute === 'login') {
      void onLogout();
      return;
    }
    updateViewUrl({ registro: undefined, ...(subTab ? { [nextRoute + '.aba']: subTab } : {}), ...(Object.keys(selection).length ? { [nextRoute + '.arquivados']: undefined } : {}), ...selection },
      { path: ROUTE_TO_PATH[nextRoute] || '/', push: true });
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function handleModuleNavigate(mod: ModuleKey, subTab?: string, selection?: Record<string, string>) {
    navigateTo(mod, subTab, selection);
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F6F5F2]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-[#1F3A5F]">Ir para o conteúdo</a>
      <Sidebar
        active={route}
        companyName={data.settings?.companyName || 'Pilotis'}
        logoDataUrl={data.settings?.logoDataUrl}
        accentColor={data.settings?.accentColor}
        onSelect={(key) => navigateTo(key)}
        onLogout={() => void onLogout()}
      />

      <MobileTopBar
        onSearch={() => setSearchOpen(true)}
        title={getMobileTopTitle(route)}
        onGoHome={() => navigateTo('dashboard')}
        onGoMore={() => navigateTo('more')}
      />

      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 px-4 py-4 pb-24 md:px-8 md:py-6 md:pb-8 max-w-[1360px]">
        <div className="mb-4 hidden justify-end md:flex"><SearchButton onClick={() => setSearchOpen(true)} /></div>
        {archiveEntities && <div className="mb-3">
          <Button type="button" variant="secondary" size="sm" aria-pressed={showArchived}
            onClick={() => updateViewUrl({ [archiveParam]: showArchived ? undefined : 'sim' }, { push: true })}>
            {showArchived ? 'Voltar aos ativos' : 'Arquivados'}
          </Button>
        </div>}
        {showArchived && archiveEntities ? <ArchivedRecords uid={uid} data={records} entities={archiveEntities} scope={route} /> :
        <Suspense fallback={<ModuleLoadingFallback />}>

          {route === 'more' && (
            <MaisView
              onSelect={(r) => navigateTo(r)}
              onLogout={() => void onLogout()}
            />
          )}

          {route === 'dashboard' && (dashboardLoadFailed ? (
            <section role="alert" className="rounded-xl bg-white p-5">
              <p>Não foi possível consultar os registros do Dashboard.</p>
              <button type="button" className="mt-2 font-semibold text-[#1F3A5F] underline" onClick={() => window.location.reload()}>Tentar novamente</button>
            </section>
          ) : !dashboardReady ? <ModuleLoadingFallback label="Carregando dados do Dashboard…" /> : (
            <DashboardView
              data={data}
              companyEmail={companyEmail}
              onNavigate={handleModuleNavigate}
              onOpenProject={(projectId) => {
                navigateTo('planning', 'Visão geral', { 'planning.obra': projectId });
              }}
              onOpenNewTransaction={() => {
                setExternalNewTxOpen(true);
                navigateTo('financial', 'Visão geral');
              }}
              onOpenNewQuote={() => {
                setExternalNewQuoteOpen(true);
                navigateTo('clients');
              }}
            />
          ))}

          {route === 'ai' && (
            <OperationalAiView
              data={data}
              companyEmail={companyEmail}
              onNavigate={handleModuleNavigate}
            />
          )}

          {route === 'agenda' && (
            <AgendaView data={data} companyEmail={companyEmail} loading={!dashboardReady} loadFailed={dashboardLoadFailed}
              onOpen={(target) => navigateTo(target.module, target.tab, target.params)} />
          )}

          {route === 'financial' && (
            <FinancialView
              uid={uid}
              data={data}
              companyEmail={companyEmail}
              initialTab={query.get('financial.aba') ?? undefined}
              accountingLoadState={accountingLoadState}
              externalNewTxOpen={externalNewTxOpen}
              onCloseExternalNewTx={() => setExternalNewTxOpen(false)}
            />
          )}

          {route === 'clients' && (
            <ClientsQuotesView
              uid={uid}
              data={data}
              companyEmail={companyEmail}
              initialTab={query.get('clients.aba') ?? undefined}
              externalNewQuoteOpen={externalNewQuoteOpen}
              onCloseExternalNewQuote={() => setExternalNewQuoteOpen(false)}
              onProjectCreated={(projId) => {
                navigateTo('planning', 'Visão geral', { 'planning.obra': projId });
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
            <TeamView uid={uid} data={data} companyEmail={companyEmail} initialTab={query.get('team.aba') ?? undefined} />
          )}

          {route === 'pops' && (
            <PopsView uid={uid} data={data} companyEmail={companyEmail} />
          )}

          {route === 'compliance' && (
            <ComplianceView uid={uid} data={data} companyEmail={companyEmail} initialTab={query.get('compliance.aba') ?? undefined} />
          )}

          {route === 'settings' && (
            <SettingsView
              uid={uid}
              data={data}
              companyEmail={companyEmail}
              initialTab={query.get('settings.aba') ?? undefined}
            />
          )}
        </Suspense>}
      </main>

      <MobileNav active={route} onSelect={(key) => navigateTo(key)} />
      {searchOpen && <GlobalSearch data={data} onClose={() => setSearchOpen(false)} onSelect={(result) => {
        setSearchOpen(false);
        navigateTo(result.module, result.tab, result.params);
      }} />}
    </div>
  );
}

function ProtectedPilotisApp() {
  const [emailAction] = useState(() => readEmailAction(window.location.search));
  useEffect(() => {
    if (emailAction) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [emailAction]);

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

  if (emailAction) {
    return (
      <Suspense fallback={<ModuleLoadingFallback label="Carregando ação de e-mail..." />}>
        <EmailActionView action={emailAction} onCheckSession={reloadUser} />
      </Suspense>
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
      key={user.uid}
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
