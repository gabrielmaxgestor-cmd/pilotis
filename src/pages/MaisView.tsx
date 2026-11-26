import { ChevronRight, ClipboardList, HardHat, LogOut, Settings, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge, Card, PageHeader } from '../components/ui/PilotisUI';
import type { AppRouteKey } from '../components/ui/Sidebar';

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
          subtitle="Módulos operacionais e configurações"
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
