import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastTone = 'success' | 'warning' | 'danger' | 'info';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

const TOAST_STYLES: Record<
  ToastTone,
  { container: string; icon: typeof Info; label: string }
> = {
  success: {
    container: 'bg-[#E3F4EC] text-[#1D6849] border-[#B7E3CE]',
    icon: CheckCircle2,
    label: 'Sucesso',
  },
  warning: {
    container: 'bg-[#FBF1DC] text-[#8A5200] border-[#EED39B]',
    icon: AlertTriangle,
    label: 'Alerta',
  },
  danger: {
    container: 'bg-[#FDECEA] text-[#B42318] border-[#F5C2BD]',
    icon: XCircle,
    label: 'Erro',
  },
  info: {
    container: 'bg-[#E6EEFB] text-[#2455A4] border-[#C1D5F4]',
    icon: Info,
    label: 'Informação',
  },
};

export function Toast({
  tone = 'info',
  title,
  description,
  onClose,
}: {
  tone?: ToastTone;
  title: string;
  description?: string;
  onClose?: () => void;
}) {
  const style = TOAST_STYLES[tone];
  const Icon = style.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto w-full sm:w-[360px] rounded-[12px] border px-4 py-3 shadow-md flex items-start gap-3 ${style.container}`}
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-snug">
          <span className="sr-only">{style.label}: </span>
          {title}
        </p>
        {description && (
          <p className="text-xs mt-0.5 opacity-90 leading-relaxed">{description}</p>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar notificação"
          className="p-1.5 -mr-1 -mt-1 rounded-[8px] hover:bg-black/5 cursor-pointer shrink-0 min-w-[32px] min-h-[32px] grid place-items-center"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastItem, 'id'>, durationMs?: number) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<ToastItem, 'id'>, durationMs = 4200) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      if (durationMs > 0) {
        window.setTimeout(() => {
          dismissToast(id);
        }, durationMs);
      }
    },
    [dismissToast],
  );

  const value = useMemo(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed z-50 left-4 right-4 bottom-20 md:bottom-6 md:left-auto md:right-6 flex flex-col gap-2 items-end"
      >
        {toasts.map((item) => (
          <Toast
            key={item.id}
            tone={item.tone}
            title={item.title}
            description={item.description}
            onClose={() => dismissToast(item.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast deve ser usado dentro de ToastProvider.');
  }
  return ctx;
}
