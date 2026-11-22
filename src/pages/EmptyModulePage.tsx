import { useState } from 'react';
import {
  Building2,
  ChevronRight,
  ClipboardList,
  Component,
  DollarSign,
  HardHat,
  LayoutGrid,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  KpiCard,
  Note,
  PageHeader,
  ScrollableChips,
  Tabs,
} from '../components/ui/PilotisUI';
import { useToast } from '../components/ui/Toast';
import type { AppRouteKey } from '../components/ui/Sidebar';
import type { ModuleKey } from '../types/pilotis';

interface ModulePageSpec {
  title: string;
  mobileTitle: string;
  subtitle: string;
  tabs?: string[];
  kpis?: Array<{ label: string; subtext: string }>;
  emptyTitle: string;
  emptyDescription: string;
  actionLabel: string;
  secondaryActionLabel?: string;
  icon: typeof LayoutGrid;
}

export const MODULE_SPECS: Record<ModuleKey, ModulePageSpec> = {
  dashboard: {
    title: 'Dashboard',
    mobileTitle: 'Dashboard',
    subtitle: 'Visão geral da empresa',
    kpis: [
      { label: 'Saldo de caixa', subtext: 'Aguardando lançamentos reais' },
      { label: 'A receber (30 dias)', subtext: 'Aguardando parcelas' },
      { label: 'Resultado do mês', subtext: 'Calculado pelos lançamentos' },
      { label: 'Obras ativas', subtext: 'Nenhuma obra cadastrada' },
    ],
    emptyTitle: 'Sem dados operacionais ainda',
    emptyDescription:
      'O sistema inicia vazio, sem dados fictícios. Quando os módulos de dados forem conectados, os indicadores, alertas e projeções aparecerão aqui automaticamente.',
    actionLabel: 'Abrir catálogo de componentes (/dev)',
    icon: LayoutGrid,
  },
  ai: {
    title: 'IA Operacional',
    mobileTitle: 'IA Operacional',
    subtitle: 'Modo Analista e Modo Consultor baseados nos dados reais',
    tabs: ['Analista', 'Consultor', 'Resumo semanal'],
    emptyTitle: 'Sem registros suficientes para análise',
    emptyDescription:
      'A IA Operacional consulta apenas lançamentos, obras, equipe e conformidade cadastrados pela empresa. Nenhum dado simulado é exibido.',
    actionLabel: 'Ver catálogo visual',
    icon: Sparkles,
  },
  financial: {
    title: 'Financeiro',
    mobileTitle: 'Financeiro',
    subtitle: 'Lançamentos, a receber, a pagar, fluxo de caixa, dívidas e DRE',
    tabs: ['Geral', 'A receber', 'A pagar', 'Fluxo', 'Dívidas', 'DRE'],
    kpis: [
      { label: 'Entradas do mês', subtext: 'Realizado + previsto' },
      { label: 'Saídas do mês', subtext: 'Folha, tributos e despesas' },
      { label: 'Resultado', subtext: 'Margem calculada pelos registros' },
      { label: 'Em atraso', subtext: 'Nenhum lançamento vencido' },
    ],
    emptyTitle: 'Nenhum lançamento financeiro cadastrado',
    emptyDescription:
      'Esta é a base visual do módulo Financeiro. Receitas, despesas, parcelas de obras e empréstimos (separados de receita) aparecerão aqui.',
    actionLabel: 'Novo lançamento (em breve)',
    secondaryActionLabel: 'Importar extrato (em breve)',
    icon: DollarSign,
  },
  clients: {
    title: 'Clientes e Orçamentos',
    mobileTitle: 'Clientes e Orçamentos',
    subtitle: 'Funil comercial, propostas, contratos, licitações e garantia',
    tabs: ['Funil', 'Orçamentos', 'Clientes', 'Licitações', 'Rascunhos'],
    kpis: [
      { label: 'Valor no funil', subtext: 'Orçamentos em aberto' },
      { label: 'Funil ponderado', subtext: 'Por probabilidade de fechamento' },
      { label: 'Clientes ativos', subtext: 'Cadastro comercial' },
      { label: 'Obras em garantia', subtext: 'Pós-obra e chamados' },
    ],
    emptyTitle: 'Nenhum cliente ou orçamento cadastrado',
    emptyDescription:
      'Ao confirmar um orçamento na versão com dados, o sistema cria automaticamente a obra, as parcelas financeiras e o planejamento.',
    actionLabel: 'Novo orçamento (em breve)',
    icon: Users,
  },
  planning: {
    title: 'Planejamento de Obras',
    mobileTitle: 'Obras',
    subtitle: 'Visão geral, EAP, cronograma, Kanban, recursos e riscos',
    tabs: ['Visão geral', 'EAP', 'Cronograma', 'Kanban', 'Recursos', 'Riscos'],
    kpis: [
      { label: 'Progresso físico', subtext: 'Nenhuma etapa cadastrada' },
      { label: 'Índice de prazo', subtext: 'Aguardando linha de base' },
      { label: 'Etapas críticas', subtext: 'Caminho crítico da obra' },
      { label: 'Diários de obra', subtext: 'Nenhum registro enviado' },
    ],
    emptyTitle: 'Nenhuma obra em planejamento ou execução',
    emptyDescription:
      'Quando houver obras confirmadas, esta tela exibirá a EAP, cronograma com linha de base, quadro Kanban e alocação de equipe.',
    actionLabel: 'Nova obra (em breve)',
    icon: Building2,
  },
  team: {
    title: 'Equipe',
    mobileTitle: 'Equipe',
    subtitle: 'Cadastro de colaboradores, alocação, férias, SST e folha',
    tabs: ['Cadastro', 'Alocação', 'Férias', 'Segurança', 'Folha'],
    kpis: [
      { label: 'Colaboradores', subtext: 'CLT, autônomos e diaristas' },
      { label: 'Alocados em obra', subtext: 'Alocação semanal' },
      { label: 'ASO e NRs em alerta', subtext: 'NR-18, NR-35 e EPI' },
      { label: 'Folha prevista', subtext: 'Calculada com encargos' },
    ],
    emptyTitle: 'Nenhum colaborador cadastrado',
    emptyDescription:
      'Cadastre pedreiros, pintores, eletricistas, encarregados e equipe administrativa para acompanhar alocação, encargos e segurança do trabalho.',
    actionLabel: 'Cadastrar colaborador (em breve)',
    icon: HardHat,
  },
  pops: {
    title: 'POPs',
    mobileTitle: 'POPs',
    subtitle: 'Procedimentos Operacionais Padrão e critérios de aceitação',
    tabs: ['Vigentes', 'Em revisão', 'Integração'],
    emptyTitle: 'Nenhum POP cadastrado',
    emptyDescription:
      'Os procedimentos operacionais padrão orientam a execução das etapas em obra e alimentam os checklists de conferência e integração.',
    actionLabel: 'Novo POP (em breve)',
    icon: ClipboardList,
  },
  compliance: {
    title: 'Conformidade e Documentos',
    mobileTitle: 'Conformidade',
    subtitle: 'Obrigações fiscais, certidões, documentos de obra, notas fiscais e licitações',
    tabs: ['Obrigações', 'Certidões', 'Documentos', 'Notas fiscais', 'Licitações'],
    kpis: [
      { label: 'Obrigações no prazo', subtext: 'Simples, ISS e guias' },
      { label: 'Certidões vigentes', subtext: 'Federal, estadual, municipal e FGTS' },
      { label: 'Notas pendentes', subtext: 'Parcelas sem NF emitida' },
      { label: 'Documentos de obra', subtext: 'ART, alvará e matrícula' },
    ],
    emptyTitle: 'Nenhum item de conformidade registrado',
    emptyDescription:
      'Gerencie certidões negativas, guias tributárias, notas fiscais e documentos obrigatórios de cada obra em um único painel.',
    actionLabel: 'Registrar obrigação ou certidão (em breve)',
    icon: ShieldCheck,
  },
  settings: {
    title: 'Configurações',
    mobileTitle: 'Configurações',
    subtitle: 'Dados da empresa, parâmetros de encargos, importação e auditoria',
    tabs: ['Empresa', 'Encargos e impostos', 'Importar dados', 'Histórico'],
    emptyTitle: 'Parâmetros da empresa ainda não configurados',
    emptyDescription:
      'Nesta seção ficam os dados cadastrais da Pilotis, alíquotas de INSS/FGTS/férias/13º com histórico de vigência e importação de planilhas.',
    actionLabel: 'Abrir catálogo /dev',
    icon: Settings,
  },
};

export function EmptyModulePage({
  moduleKey,
  onNavigate,
}: {
  moduleKey: ModuleKey;
  onNavigate: (route: AppRouteKey) => void;
}) {
  const spec = MODULE_SPECS[moduleKey];
  const [activeTab, setActiveTab] = useState<string>(spec.tabs?.[0] || '');
  const { showToast } = useToast();
  const Icon = spec.icon;

  const handlePreviewAction = () => {
    if (moduleKey === 'dashboard' || moduleKey === 'settings' || moduleKey === 'ai') {
      onNavigate('dev');
      return;
    }
    showToast({
      tone: 'info',
      title: 'Base visual ativa',
      description: 'Os fluxos de criação e persistência serão conectados na etapa de dados.',
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={spec.title}
        subtitle={spec.subtitle}
        actions={
          moduleKey === 'dashboard' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onNavigate('dev')}
            >
              Catálogo UI (/dev)
            </Button>
          ) : undefined
        }
      />

      {spec.tabs && spec.tabs.length > 0 && (
        <>
          <div className="hidden md:block">
            <Tabs
              items={spec.tabs}
              active={activeTab || spec.tabs[0]}
              onChange={setActiveTab}
            />
          </div>
          <div className="md:hidden">
            <ScrollableChips
              items={spec.tabs}
              active={activeTab || spec.tabs[0]}
              onChange={setActiveTab}
              ariaLabel={`Seções de ${spec.title}`}
            />
          </div>
        </>
      )}

      {spec.kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {spec.kpis.map((kpi) => (
            <KpiCard
              key={kpi.label}
              label={kpi.label}
              value="Sem dados"
              subtext={kpi.subtext}
              isEmpty
            />
          ))}
        </div>
      )}

      <EmptyState
        icon={<Icon className="w-5 h-5" strokeWidth={1.85} aria-hidden="true" />}
        title={spec.emptyTitle}
        description={spec.emptyDescription}
        actionLabel={spec.actionLabel}
        onAction={handlePreviewAction}
        secondaryActionLabel={spec.secondaryActionLabel}
        onSecondaryAction={
          spec.secondaryActionLabel ? handlePreviewAction : undefined
        }
      />
    </div>
  );
}

export function MaisView({
  onSelect,
  onLogout,
}: {
  onSelect: (route: AppRouteKey) => void;
  onLogout: () => void;
}) {
  const menuItems: Array<{
    key: AppRouteKey;
    label: string;
    description: string;
    icon: typeof Sparkles;
  }> = [
    {
      key: 'ai',
      label: 'IA Operacional',
      description: 'Análises e consultoria sobre os dados da empresa',
      icon: Sparkles,
    },
    {
      key: 'team',
      label: 'Equipe',
      description: 'Cadastro, alocação, férias, SST e folha',
      icon: HardHat,
    },
    {
      key: 'pops',
      label: 'POPs',
      description: 'Procedimentos operacionais e critérios de qualidade',
      icon: ClipboardList,
    },
    {
      key: 'compliance',
      label: 'Conformidade',
      description: 'Obrigações, certidões, documentos e notas fiscais',
      icon: ShieldCheck,
    },
    {
      key: 'settings',
      label: 'Configurações',
      description: 'Dados da empresa, encargos e importação',
      icon: Settings,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden md:block">
        <PageHeader
          title="Mais módulos"
          subtitle="Atalho para módulos operacionais, configurações e catálogo de UI"
        />
      </div>

      <Card>
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-full bg-[#1F3A5F] text-white font-bold text-base grid place-items-center shrink-0">
            P
          </div>
          <div className="min-w-0 flex-1">
            <strong className="block text-sm font-bold text-[#14181F] truncate">
              Pilotis · acesso da empresa
            </strong>
            <span className="block text-xs text-[#5B6472] truncate">
              Soluções Construtivas · Valença/RJ
            </span>
          </div>
          <Badge variant="info">Acesso único</Badge>
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              className="w-full bg-white border border-[#E4E1DA] rounded-[12px] px-4 py-3.5 min-h-[56px] flex items-center justify-between gap-3 text-left hover:bg-[#F0EEE9]/60 active:bg-[#F0EEE9] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-[8px] bg-[#E6EEFB] text-[#1F3A5F] grid place-items-center shrink-0">
                  <Icon className="w-5 h-5" strokeWidth={1.85} />
                </span>
                <div className="min-w-0">
                  <strong className="block text-sm font-semibold text-[#14181F] truncate">
                    {item.label}
                  </strong>
                  <span className="block text-xs text-[#5B6472] truncate">
                    {item.description}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-[#5B6472] shrink-0" aria-hidden="true" />
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onSelect('dev')}
          className="w-full bg-white border border-[#E4E1DA] rounded-[12px] px-4 py-3.5 min-h-[56px] flex items-center justify-between gap-3 text-left hover:bg-[#F0EEE9]/60 active:bg-[#F0EEE9] transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-[8px] bg-[#F6E7CC] text-[#9A6212] grid place-items-center shrink-0">
              <Component className="w-5 h-5" strokeWidth={1.85} />
            </span>
            <div className="min-w-0">
              <strong className="block text-sm font-semibold text-[#14181F] truncate">
                Catálogo de componentes (/dev)
              </strong>
              <span className="block text-xs text-[#5B6472] truncate">
                Tokens visuais e componentes reutilizáveis
              </span>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-[#5B6472] shrink-0" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="w-full bg-white border border-[#E4E1DA] rounded-[12px] px-4 py-3.5 min-h-[56px] flex items-center justify-between gap-3 text-left hover:bg-[#FDECEA]/60 active:bg-[#FDECEA] transition-colors cursor-pointer mt-1"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-[8px] bg-[#FDECEA] text-[#B42318] grid place-items-center shrink-0">
              <LogOut className="w-5 h-5" strokeWidth={1.85} />
            </span>
            <strong className="text-sm font-semibold text-[#B42318]">Sair</strong>
          </div>
          <ChevronRight className="w-5 h-5 text-[#B42318] shrink-0" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function VisualLoginView({ onEnter }: { onEnter: () => void }) {
  const [companyUser, setCompanyUser] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col md:flex-row">
      <div className="bg-[#101828] text-white px-6 py-10 md:w-1/2 md:px-14 md:py-16 flex flex-col justify-center gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[8px] bg-[#9A6212] text-white font-bold text-xl grid place-items-center">
            P
          </div>
          <div>
            <strong className="block text-xl font-bold leading-tight">Pilotis</strong>
            <span className="block text-xs text-[#A8B0BF]">Soluções Construtivas</span>
          </div>
        </div>
        <h1 className="text-[28px] md:text-[36px] font-bold leading-tight tracking-tight max-w-md">
          Obras, caixa e equipe em um só lugar.
        </h1>
        <p className="text-sm md:text-base text-[#A8B0BF] max-w-md leading-relaxed">
          Planeje cada etapa, acompanhe o fluxo de caixa e mantenha a empresa em
          conformidade, com dados reais e sempre atualizados.
        </p>
      </div>

      <div className="flex-1 bg-white px-6 py-10 md:px-14 flex items-center justify-center">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onEnter();
          }}
          className="w-full max-w-md flex flex-col gap-4"
        >
          <div>
            <h2 className="text-2xl font-bold text-[#14181F]">Entrar no sistema</h2>
            <p className="text-sm text-[#5B6472] mt-1">
              Acesso único da empresa Pilotis
            </p>
          </div>

          <Input
            label="Usuário da empresa"
            type="email"
            placeholder="nome@empresa.com.br"
            value={companyUser}
            onChange={(e) => setCompanyUser(e.target.value)}
          />

          <Input
            label="Senha"
            type="password"
            placeholder="••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Note variant="info" title="Base visual sem autenticação ativa">
            Clique em “Entrar” para retornar à navegação do aplicativo.
          </Note>

          <Button type="submit" variant="primary" fullWidth>
            Entrar
          </Button>

          <p className="text-xs text-[#5B6472] leading-relaxed">
            Um único login em nome da empresa, com acesso total a todos os módulos.
          </p>
        </form>
      </div>
    </div>
  );
}
