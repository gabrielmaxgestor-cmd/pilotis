import {
  Building2,
  DollarSign,
  LayoutGrid,
  MoreHorizontal,
  Users,
} from 'lucide-react';
import type { AppRouteKey } from './Sidebar';

export function MobileTopBar({
  title,
  onGoHome,
  onGoMore,
}: {
  title: string;
  onGoHome: () => void;
  onGoMore: () => void;
}) {
  return (
    <header className="md:hidden sticky top-0 z-30 bg-white border-b border-[#E4E1DA] px-4 h-[54px] flex items-center justify-between gap-3 no-print">
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onGoHome}
          aria-label="Ir para o início"
          className="w-[30px] h-[30px] rounded-[8px] bg-[#9A6212] text-white font-bold text-sm grid place-items-center shrink-0 cursor-pointer"
        >
          P
        </button>
        <span className="text-[17px] font-bold text-[#14181F] truncate">
          {title}
        </span>
      </div>

      <button
        type="button"
        onClick={onGoMore}
        aria-label="Abrir menu da empresa e módulos adicionais"
        title="Pilotis · acesso da empresa"
        className="min-w-[44px] min-h-[44px] flex items-center justify-end cursor-pointer shrink-0"
      >
        <span className="w-8 h-8 rounded-full bg-[#1F3A5F] text-white text-xs font-bold grid place-items-center">
          P
        </span>
      </button>
    </header>
  );
}

export function MobileNav({
  active,
  onSelect,
}: {
  active: AppRouteKey;
  onSelect: (key: AppRouteKey) => void;
}) {
  const primaryTabs: Array<{ key: AppRouteKey; label: string; icon: typeof LayoutGrid }> = [
    { key: 'dashboard', label: 'Início', icon: LayoutGrid },
    { key: 'financial', label: 'Financeiro', icon: DollarSign },
    { key: 'planning', label: 'Obras', icon: Building2 },
    { key: 'clients', label: 'Clientes', icon: Users },
    { key: 'more', label: 'Mais', icon: MoreHorizontal },
  ];

  const isMoreGroup = ['more', 'ai', 'team', 'pops', 'compliance', 'settings'].includes(
    active,
  );

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#E4E1DA] grid grid-cols-5 items-center h-[60px] px-1 no-print"
      aria-label="Navegação inferior"
    >
      {primaryTabs.map((tab) => {
        const Icon = tab.icon;
        const isCurrent = tab.key === 'more' ? isMoreGroup : active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={isCurrent ? 'page' : undefined}
            onClick={() => onSelect(tab.key)}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] rounded-[8px] px-1 py-1 text-[11px] transition-colors cursor-pointer ${
              isCurrent
                ? 'text-[#1F3A5F] font-bold'
                : 'text-[#5B6472] font-medium hover:text-[#14181F]'
            }`}
          >
            <Icon className="w-[22px] h-[22px]" strokeWidth={isCurrent ? 2.2 : 1.75} />
            <span className="leading-none">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
