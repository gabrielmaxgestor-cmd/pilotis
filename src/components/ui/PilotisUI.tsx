import {
  Component,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Info,
  X,
  XCircle,
} from 'lucide-react';
import type { ActorRole } from '../../types/pilotis';

/* ---------------- Button ---------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'text';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const BUTTON_VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-[#1F3A5F] text-white border border-[#1F3A5F] hover:bg-[#182E4C] active:bg-[#14253D]',
  secondary:
    'bg-white text-[#14181F] border border-[#E4E1DA] hover:bg-[#F0EEE9] active:bg-[#E4E1DA]',
  text: 'bg-transparent text-[#1F3A5F] border border-transparent hover:bg-[#E6EEFB]/60 active:bg-[#E6EEFB]',
};

const BUTTON_SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-4 py-1.5 text-[13px]',
  md: 'min-h-[42px] px-5 py-2.5 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-[8px] font-semibold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${BUTTON_VARIANT_STYLES[variant]} ${BUTTON_SIZE_STYLES[size]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------------- Badge ---------------- */

export type BadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'critical'
  | 'neutral';

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'info' | 'crit' | 'neutral';

const BADGE_STYLES: Record<BadgeVariant, string> = {
  success: 'bg-[#E3F4EC] text-[#1D6849]',
  warning: 'bg-[#FBF1DC] text-[#8A5200]',
  danger: 'bg-[#FDECEA] text-[#B42318]',
  info: 'bg-[#E6EEFB] text-[#2455A4]',
  critical: 'bg-[#F6E7CC] text-[#9A6212]',
  neutral: 'bg-[#ECEAE4] text-[#5B6472]',
};

const TONE_TO_VARIANT: Record<BadgeTone, BadgeVariant> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
  info: 'info',
  crit: 'critical',
  neutral: 'neutral',
};

export function Badge({
  variant = 'neutral',
  children,
  className = '',
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap shrink-0 ${BADGE_STYLES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export function inferStatusTone(status: string): BadgeTone {
  const s = status.toLowerCase();
  if (
    s.includes('atraso') ||
    s.includes('vencid') ||
    s.includes('não emitida') ||
    s.includes('pendente') ||
    s.includes('perdido') ||
    s.includes('negativ') ||
    s.includes('urgente')
  ) {
    return 'bad';
  }
  if (
    s.includes('vence') ||
    s.includes('atenção') ||
    s.includes('revis') ||
    s.includes('aguardando') ||
    s.includes('negociação') ||
    s.includes('parcial') ||
    s.includes('repor') ||
    s.includes('garantia') ||
    s.includes('uso') ||
    s.includes('atendimento') ||
    s.includes('consultor') ||
    s.includes('crítica')
  ) {
    return 'warn';
  }
  if (
    s.includes('concluíd') ||
    s.includes('válida') ||
    s.includes('emitida') ||
    s.includes('pago') ||
    s.includes('recebid') ||
    s.includes('em dia') ||
    s.includes('ganho') ||
    s.includes('vigente') ||
    s.includes('anexad') ||
    s.includes('resolvid') ||
    s.includes('aprovada') ||
    s.includes('ativo') ||
    s.includes('conciliado')
  ) {
    return 'ok';
  }
  if (
    s.includes('andamento') ||
    s.includes('enviado') ||
    s.includes('não é receita') ||
    s.includes('clt') ||
    s.includes('analista') ||
    s.includes('info') ||
    s.includes('contratada') ||
    s.includes('principal') ||
    s.includes('execução') ||
    s.includes('previsão')
  ) {
    return 'info';
  }
  if (s.includes('satélite')) {
    return 'crit';
  }
  return 'neutral';
}

export function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone?: BadgeTone;
}) {
  const resolved = tone ?? inferStatusTone(label);
  return <Badge variant={TONE_TO_VARIANT[resolved]}>{label}</Badge>;
}

/* ---------------- Card & KpiCard ---------------- */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bg-white border border-[#E4E1DA] rounded-[12px] p-5 flex flex-col gap-4 ${className}`}
    >
      {(title || subtitle || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-bold text-[#14181F] leading-snug">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-[13px] text-[#5B6472] mt-0.5">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  subtext,
  isEmpty,
}: {
  label: string;
  value?: string;
  subtext: string;
  isEmpty?: boolean;
}) {
  const displayValue = value && value.trim().length > 0 ? value : 'Sem dados';
  const muted = isEmpty || displayValue === 'Sem dados';

  return (
    <div className="bg-white border border-[#E4E1DA] rounded-[12px] px-5 py-4 flex flex-col justify-between min-w-0">
      <span className="text-[13px] font-medium text-[#5B6472]">{label}</span>
      <strong
        className={`text-2xl md:text-[26px] font-bold tracking-tight my-1.5 tabular-nums truncate ${
          muted ? 'text-[#5B6472]' : 'text-[#14181F]'
        }`}
      >
        {displayValue}
      </strong>
      <span className="text-xs text-[#5B6472]">{subtext}</span>
    </div>
  );
}

/* ---------------- PageHeader ---------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
  companyEmail,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  companyEmail?: string | null;
}) {
  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-1">
      <div className="min-w-0">
        <h1 className="text-2xl md:text-[26px] font-bold tracking-tight text-[#14181F] leading-tight">
          {title}
        </h1>
        <p className="text-sm text-[#5B6472] mt-1">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
        {actions}
        <div
          className="hidden lg:flex items-center gap-2 bg-white border border-[#E4E1DA] rounded-full py-1.5 px-3 text-[13px] font-medium text-[#14181F] whitespace-nowrap shrink-0"
          title={companyEmail || 'Acesso único da empresa'}
        >
          <span className="w-7 h-7 rounded-full bg-[#1F3A5F] text-white grid place-items-center text-xs font-bold">
            P
          </span>
          <span>Pilotis · acesso da empresa</span>
        </div>
      </div>
    </header>
  );
}

/* ---------------- Tabs, SegmentedControl & ScrollableChips ---------------- */

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: string[];
  active: string;
  onChange: (item: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-6 border-b border-[#E4E1DA] overflow-x-auto no-scrollbar"
      role="tablist"
      aria-label="Abas do módulo"
    >
      {items.map((item) => {
        const isActive = item === active;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(item)}
            onKeyDown={(event) => {
              const position = items.indexOf(item);
              const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                : event.key === 'ArrowLeft' ? (position + items.length - 1) % items.length
                : event.key === 'ArrowRight' ? (position + 1) % items.length : -1;
              if (target < 0) return;
              event.preventDefault();
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
              onChange(items[target]);
            }}
            className={`pb-2.5 min-h-[40px] text-sm whitespace-nowrap shrink-0 border-b-[3px] -mb-px transition-colors cursor-pointer ${
              isActive
                ? 'border-[#9A6212] text-[#1F3A5F] font-semibold'
                : 'border-transparent text-[#5B6472] font-medium hover:text-[#14181F]'
            }`}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedControl({
  items,
  active,
  onChange,
}: {
  items: string[];
  active: string;
  onChange: (item: string) => void;
}) {
  return (
    <div
      className="inline-flex bg-[#F0EEE9] p-1 rounded-[8px] gap-1 shrink-0 overflow-x-auto max-w-full no-scrollbar"
      role="group"
    >
      {items.map((item) => {
        const isActive = item === active;
        return (
          <button
            key={item}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(item)}
            className={`px-3.5 py-1.5 min-h-[34px] rounded-[6px] text-[13px] font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              isActive
                ? 'bg-white text-[#14181F] border border-[#E4E1DA]'
                : 'text-[#5B6472] hover:text-[#14181F] border border-transparent'
            }`}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

export function ScrollableChips({
  items,
  active,
  onChange,
  ariaLabel = 'Filtros',
}: {
  items: string[];
  active: string;
  onChange: (item: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5"
      role="group"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const isActive = item === active;
        return (
          <button
            key={item}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(item)}
            className={`flex-none rounded-full px-3.5 py-2 min-h-[38px] text-[13px] font-semibold whitespace-nowrap border transition-colors cursor-pointer ${
              isActive
                ? 'bg-[#1F3A5F] text-white border-[#1F3A5F]'
                : 'bg-white text-[#5B6472] border-[#E4E1DA] hover:text-[#14181F] hover:bg-[#F0EEE9]'
            }`}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Field, Input, Textarea, Select ---------------- */

export function Field({
  label,
  htmlFor,
  help,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  help?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[13px] font-semibold text-[#14181F] flex items-center gap-1"
      >
        <span>{label}</span>
        {required && (
          <span className="text-[#B42318]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <span role="alert" className="text-xs font-medium text-[#B42318]">
          {error}
        </span>
      ) : (
        help && <span className="text-xs text-[#5B6472]">{help}</span>
      )}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-[8px] border bg-white px-3.5 py-2.5 text-sm text-[#14181F] placeholder:text-[#5B6472]/70 transition-colors disabled:bg-[#F0EEE9] disabled:text-[#5B6472] disabled:cursor-not-allowed';

const CONTROL_NORMAL = 'border-[#E4E1DA] hover:border-[#5B6472]/60';
const CONTROL_ERROR = 'border-[#B42318] ring-3 ring-[#FDECEA]';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  help?: string;
  error?: string;
}

export function Input({
  label,
  help,
  error,
  required,
  id,
  className = '',
  ...rest
}: InputProps) {
  const autoId = useId();
  const fieldId = id || autoId;
  const control = (
    <input
      id={fieldId}
      aria-invalid={error ? true : undefined}
      required={required}
      className={`${CONTROL_BASE} min-h-[42px] ${
        error ? CONTROL_ERROR : CONTROL_NORMAL
      } ${className}`}
      {...rest}
    />
  );

  if (!label && !help && !error) return control;

  return (
    <Field
      label={label || ''}
      htmlFor={fieldId}
      help={help}
      error={error}
      required={required}
    >
      {control}
    </Field>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  help?: string;
  error?: string;
}

export function Textarea({
  label,
  help,
  error,
  required,
  id,
  rows = 3,
  className = '',
  ...rest
}: TextareaProps) {
  const autoId = useId();
  const fieldId = id || autoId;
  const control = (
    <textarea
      id={fieldId}
      rows={rows}
      aria-invalid={error ? true : undefined}
      required={required}
      className={`${CONTROL_BASE} ${
        error ? CONTROL_ERROR : CONTROL_NORMAL
      } ${className}`}
      {...rest}
    />
  );

  if (!label && !help && !error) return control;

  return (
    <Field
      label={label || ''}
      htmlFor={fieldId}
      help={help}
      error={error}
      required={required}
    >
      {control}
    </Field>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  help?: string;
  error?: string;
}

export function Select({
  label,
  help,
  error,
  required,
  id,
  className = '',
  children,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const fieldId = id || autoId;
  const control = (
    <select
      id={fieldId}
      aria-invalid={error ? true : undefined}
      required={required}
      className={`${CONTROL_BASE} min-h-[42px] ${
        error ? CONTROL_ERROR : CONTROL_NORMAL
      } ${className}`}
      {...rest}
    >
      {children}
    </select>
  );

  if (!label && !help && !error) return control;

  return (
    <Field
      label={label || ''}
      htmlFor={fieldId}
      help={help}
      error={error}
      required={required}
    >
      {control}
    </Field>
  );
}

/* ---------------- ProgressBar ---------------- */

export type ProgressTone = 'primary' | 'bronze' | 'success' | 'warning' | 'danger';

const PROGRESS_TONE_CLASSES: Record<ProgressTone, string> = {
  primary: 'bg-[#1F3A5F]',
  bronze: 'bg-[#9A6212]',
  success: 'bg-[#1D6849]',
  warning: 'bg-[#8A5200]',
  danger: 'bg-[#B42318]',
};

export function ProgressBar({
  pct,
  tone = 'primary',
  colorClass,
  label,
}: {
  pct: number;
  tone?: ProgressTone;
  colorClass?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const barColor = colorClass || PROGRESS_TONE_CLASSES[tone];
  return (
    <div
      className="h-2 bg-[#F0EEE9] rounded-full overflow-hidden w-full"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || `Progresso: ${clamped}%`}
    >
      <div
        className={`h-full rounded-full transition-all duration-200 ${barColor}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/* ---------------- Note & AlertNote ---------------- */

export type NoteVariant = 'info' | 'warning' | 'danger' | 'success' | 'soft';

const NOTE_STYLES: Record<
  NoteVariant,
  { container: string; icon: typeof Info }
> = {
  info: { container: 'bg-[#E6EEFB] text-[#2455A4]', icon: Info },
  warning: { container: 'bg-[#FBF1DC] text-[#8A5200]', icon: AlertTriangle },
  danger: { container: 'bg-[#FDECEA] text-[#B42318]', icon: XCircle },
  success: { container: 'bg-[#E3F4EC] text-[#1D6849]', icon: CheckCircle2 },
  soft: { container: 'bg-[#F6E7CC] text-[#14181F]', icon: Info },
};

export function Note({
  variant = 'info',
  title,
  children,
}: {
  variant?: NoteVariant;
  title: string;
  children: ReactNode;
}) {
  const style = NOTE_STYLES[variant];
  const Icon = style.icon;
  return (
    <div className={`rounded-[12px] px-4 py-3.5 text-[13px] flex items-start gap-3 ${style.container}`}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <strong className="block font-semibold mb-0.5">{title}</strong>
        <div>{children}</div>
      </div>
    </div>
  );
}

export function AlertNote({
  tone,
  title,
  children,
}: {
  tone: 'warn' | 'info' | 'bad' | 'ok' | 'soft';
  title: string;
  children: ReactNode;
}) {
  const map: Record<string, NoteVariant> = {
    warn: 'warning',
    info: 'info',
    bad: 'danger',
    ok: 'success',
    soft: 'soft',
  };
  return (
    <Note variant={map[tone] || 'info'} title={title}>
      {children}
    </Note>
  );
}

/* ---------------- EmptyState & EmptySection ---------------- */

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  icon,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  icon?: ReactNode;
}) {
  return (
    <div className="bg-white border border-[#E4E1DA] rounded-[12px] px-6 py-10 text-center flex flex-col items-center gap-3">
      <div className="w-11 h-11 rounded-[12px] bg-[#F0EEE9] text-[#5B6472] grid place-items-center">
        {icon || <FolderOpen className="w-5 h-5" aria-hidden="true" />}
      </div>
      <h3 className="text-base font-semibold text-[#14181F]">{title}</h3>
      <p className="text-sm text-[#5B6472] max-w-md leading-relaxed">
        {description}
      </p>
      {(actionLabel || secondaryActionLabel) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
          {actionLabel && onAction && (
            <Button variant="primary" size="md" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <Button variant="secondary" size="md" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function EmptySection({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      actionLabel={actionLabel}
      onAction={onAction}
    />
  );
}

/* ---------------- Modal (Desktop) / BottomSheet (Mobile) ---------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 'max-w-xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement;
    if (!dialog.open) dialog.showModal();
    titleRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-[#101828]/55">
      <div className="flex min-h-full items-end justify-center md:items-center md:p-4"
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className={`w-full ${maxWidth} bg-white border-t md:border border-[#E4E1DA] rounded-t-[22px] md:rounded-[12px] px-4 pt-3 pb-6 md:p-6 shadow-xl max-h-[88vh] md:max-h-[90vh] flex flex-col animate-sheet-up md:animate-none`}
      >
        <div
          className="md:hidden w-10 h-1 rounded-full bg-[#E4E1DA] mx-auto mb-3 shrink-0"
          aria-hidden="true"
        />

        <div className="flex items-start justify-between gap-4 pb-3.5 border-b border-[#E4E1DA] mb-4 shrink-0">
          <div className="min-w-0">
            <h3 ref={titleRef} id={titleId} tabIndex={-1} className="text-lg font-bold text-[#14181F] leading-snug">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-[#5B6472] mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela"
            className="p-2 -mr-1 rounded-[8px] text-[#5B6472] hover:text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer min-w-[40px] min-h-[40px] grid place-items-center shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 pr-0.5">{children}</div>

        {footer && (
          <div className="pt-4 mt-4 border-t border-[#E4E1DA] flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
      </div>
    </dialog>
  );
}

/* ---------------- RegisteredBySelect (Legacy / Shared Form Field) ---------------- */

export function RegisteredBySelect({
  value,
  onChange,
  id = 'registered-by',
}: {
  value: ActorRole;
  onChange: (val: ActorRole) => void;
  id?: string;
}) {
  return (
    <Select
      id={id}
      label="Registrado por"
      value={value}
      onChange={(e) => onChange(e.target.value as ActorRole)}
      help="Identifica o responsável pelo lançamento no acesso único da empresa."
    >
      <option value="Sócio">Sócio</option>
      <option value="Responsável administrativo">Responsável administrativo</option>
    </Select>
  );
}

/* ---------------- ErrorBoundary ---------------- */

interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Erro inesperado no aplicativo.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F6F5F2] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#E4E1DA] rounded-[12px] p-6 flex flex-col gap-4">
            <h2 className="text-xl font-bold text-[#14181F]">
              Ocorreu um erro ao carregar a tela
            </h2>
            <p className="text-sm text-[#5B6472]">
              Recarregue a página para restaurar a visualização.
            </p>
            <pre className="text-xs bg-[#F0EEE9] p-3 rounded-[8px] overflow-x-auto text-[#B42318]">
              {this.state.message}
            </pre>
            <div className="self-start">
              <Button variant="primary" onClick={() => window.location.reload()}>
                Recarregar sistema
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
