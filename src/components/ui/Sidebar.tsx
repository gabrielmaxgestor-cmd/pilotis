import {
  Building2,
  ClipboardList,
  DollarSign,
  HardHat,
  LayoutGrid,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type { ModuleKey } from '../../types/pilotis';

export type AppRouteKey = ModuleKey | 'more' | 'login';

export const NAV_ITEMS: Array<{
  key: ModuleKey;
  label: string;
  icon: typeof LayoutGrid;
}> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { key: 'ai', label: 'IA Operacional', icon: Sparkles },
  { key: 'financial', label: 'Financeiro', icon: DollarSign },
  { key: 'clients', label: 'Clientes e Orçamentos', icon: Users },
  { key: 'planning', label: 'Planejamento de Obras', icon: Building2 },
  { key: 'team', label: 'Equipe', icon: HardHat },
  { key: 'pops', label: 'POPs', icon: ClipboardList },
  { key: 'compliance', label: 'Conformidade', icon: ShieldCheck },
];

function logoTextColor(background: string) {
  const [red, green, blue] = background.slice(1).match(/.{2}/g)!.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) > 0.179 ? '#000000' : '#FFFFFF';
}

export function Sidebar({
  active,
  onSelect,
  companyName,
  logoDataUrl,
  accentColor,
  onLogout,
}: {
  active: AppRouteKey;
  onSelect: (key: AppRouteKey) => void;
  companyName?: string;
  logoDataUrl?: string;
  accentColor?: string;
  onLogout: () => void;
}) {
  const brandColor = accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : '#9A6212';
  const hasLogo = Boolean(logoDataUrl && logoDataUrl.startsWith('data:image/'));

  return (
    <aside
      className="hidden md:flex flex-col w-[248px] pilotis-dark-focus shrink-0 bg-[#101828] min-h-screen px-4 py-6 justify-between no-print"
      aria-label="Navegação principal"
    >
      <div>
        <button
          type="button"
          onClick={() => onSelect('dashboard')}
          className="flex items-center gap-3 px-2 mb-6 w-full text-left rounded-[8px] cursor-pointer"
        >
          {hasLogo ? (
            <img
              src={logoDataUrl}
              alt={companyName || 'Logo da empresa'}
              className="w-9 h-9 rounded-[8px] object-contain bg-white p-0.5 shrink-0"
            />
          ) : (
            <div
              className="w-9 h-9 rounded-[8px] text-white font-bold text-lg grid place-items-center shrink-0"
              style={{ backgroundColor: brandColor, color: logoTextColor(brandColor) }}
            >
              {(companyName?.trim().charAt(0) || 'P').toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <strong className="block text-white text-base font-bold leading-tight truncate">
              {companyName || 'Pilotis'}
            </strong>
            <span className="block text-[#A8B0BF] text-[11px] truncate">
              Soluções Construtivas
            </span>
          </div>
        </button>

        <nav className="flex flex-col gap-1" aria-label="Módulos do sistema">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelect(item.key)}
                className={`relative flex items-center gap-3 px-3 py-2.5 min-h-[42px] rounded-[8px] text-sm font-medium text-left transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#1D2A44] text-white font-semibold'
                    : 'text-[#A8B0BF] hover:text-white hover:bg-[#1D2A44]/50'
                }`}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r"
                    style={{ backgroundColor: brandColor }}
                    aria-hidden="true"
                  />
                )}
                <Icon className="w-5 h-5 shrink-0" strokeWidth={1.85} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-1 pt-4 border-t border-white/10">
        <button
          type="button"
          aria-current={active === 'settings' ? 'page' : undefined}
          onClick={() => onSelect('settings')}
          className={`relative flex items-center gap-3 px-3 py-2.5 min-h-[42px] rounded-[8px] text-sm font-medium text-left transition-colors cursor-pointer ${
            active === 'settings'
              ? 'bg-[#1D2A44] text-white font-semibold'
              : 'text-[#A8B0BF] hover:text-white hover:bg-[#1D2A44]/50'
          }`}
        >
          {active === 'settings' && (
            <span
              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#9A6212] rounded-r"
              aria-hidden="true"
            />
          )}
          <Settings className="w-5 h-5 shrink-0" strokeWidth={1.85} />
          <span>Configurações</span>
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-3 px-3 py-2.5 min-h-[42px] rounded-[8px] text-sm font-medium text-[#A8B0BF] hover:text-white hover:bg-[#1D2A44]/50 text-left transition-colors cursor-pointer"
        >
          <LogOut className="w-5 h-5 shrink-0" strokeWidth={1.85} />
          <span>Sair</span>
        </button>
      </div>
    </aside>
  );
}
