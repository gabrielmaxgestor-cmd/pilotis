import { CalendarDays, ChevronLeft, ChevronRight, Download, List } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Modal, PageHeader, StatusBadge } from '../components/ui/PilotisUI';
import {
  AGENDA_TYPES, agendaDays, agendaEventsInPeriod, agendaPeriod, buildAgendaEvents,
  type AgendaEvent, type AgendaPeriod, type AgendaTarget, type AgendaViewMode,
} from '../domain/agenda';
import { buildAgendaCalendar } from '../domain/calendarExport';
import { addDaysISO, addMonthsISO, formatDateBR, isValidISODate } from '../domain/formatters';
import { planningTodayISO } from '../domain/pilotisAdapters';
import { useViewParam } from '../hooks/useViewUrl';
import type { PilotisDataState } from '../types/pilotis';

const weekdayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const field = 'min-h-11 w-full min-w-0 rounded-lg border border-[#E4E1DA] bg-white px-3 text-sm font-normal text-[#14181F]';
const calendarButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#E4E1DA] bg-white text-[#1F3A5F] hover:bg-[#E6EEFB]';

function eventDates(event: AgendaEvent) {
  return event.start === event.end ? formatDateBR(event.start)
    : formatDateBR(event.start) + ' a ' + formatDateBR(event.end);
}

function EventList({ events, onOpen }: { events: AgendaEvent[]; onOpen: (target: AgendaTarget) => void }) {
  return <ul className="grid gap-2">{events.map((event) => (
    <li key={event.id}>
      <button type="button" onClick={() => onOpen(event.target)}
        className="grid w-full min-w-0 gap-1 rounded-lg border border-[#E4E1DA] bg-white px-3 py-2.5 text-left hover:border-[#1F3A5F] hover:bg-[#F8FAFD] sm:grid-cols-[1fr_auto] sm:items-center">
        <span className="min-w-0">
          <strong className="block break-words text-sm text-[#14181F]">{event.title}</strong>
          <span className="block break-words text-xs text-[#424D5D]">
            {AGENDA_TYPES[event.type].label}{event.projectName ? ' · ' + event.projectName : ''} · {eventDates(event)}
          </span>
        </span>
        {event.status && <StatusBadge label={event.status} tone={event.status === 'Em atraso' ? 'bad' : 'neutral'} />}
      </button>
    </li>
  ))}</ul>;
}

function MonthCalendar({ period, date, today, events, onDate, onOpen }: {
  period: AgendaPeriod; date: string; today: string; events: AgendaEvent[];
  onDate: (date: string) => void; onOpen: (target: AgendaTarget) => void;
}) {
  const days = agendaDays(period, true);
  const weeks = Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  return <div className="min-w-0 overflow-hidden rounded-xl border border-[#E4E1DA] bg-white">
    <table className="w-full table-fixed border-collapse">
      <caption className="sr-only">Calendário mensal de eventos</caption>
      <thead className="bg-[#F0EEE9]">
        <tr>{weekdayLabels.map((day) => <th key={day} scope="col" className="py-2 text-center text-xs font-semibold text-[#424D5D]">{day}</th>)}</tr>
      </thead>
      <tbody>{weeks.map((week) => <tr key={week[0]}>
        {week.map((day) => {
          const inMonth = day >= period.start && day <= period.end;
          const items = inMonth ? events.filter((event) => event.start <= day && event.end >= day) : [];
          const count = items.length;
          return <td key={day} className={'border border-[#E4E1DA] align-top ' + (inMonth ? '' : 'bg-[#F6F5F2]')}>
            <button type="button" aria-pressed={date === day} aria-current={today === day ? 'date' : undefined}
              aria-label={formatDateBR(day) + ' · ' + (count === 1 ? '1 evento' : count + ' eventos')}
              onClick={() => onDate(day)}
              className={'flex min-h-11 w-full flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-xs font-semibold focus-visible:outline-offset-[-2px] lg:flex-row lg:justify-between lg:px-2 ' +
                (date === day ? 'bg-[#1F3A5F] text-white' : today === day ? 'bg-[#E6EEFB] text-[#1F3A5F]' : 'text-[#424D5D] hover:bg-[#E6EEFB]')}>
              <span>{day.slice(-2)}</span>
              {count > 0 && <span aria-hidden="true" className="rounded-full bg-white px-1 text-[10px] tabular-nums text-[#1F3A5F]">{count}</span>}
            </button>
            <div className="hidden min-h-11 min-w-0 gap-1 p-1 lg:grid lg:content-start">
              {items.slice(0, 2).map((event) =>
                <button key={event.id} type="button" onClick={() => onOpen(event.target)} title={event.title}
                  className="line-clamp-2 min-w-0 break-words rounded bg-[#E6EEFB] px-1 py-0.5 text-left text-[11px] text-[#1F3A5F] hover:underline">
                  {event.title}
                </button>)}
              {count > 2 && <button type="button" onClick={() => onDate(day)}
                aria-label={'Ver mais ' + (count - 2) + ' eventos de ' + formatDateBR(day)}
                className="px-1 text-left text-[11px] font-semibold text-[#1F3A5F] underline">
                + {count - 2}
              </button>}
            </div>
          </td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}

function ExportAgenda({ events, period, onClose }: { events: AgendaEvent[]; period: AgendaPeriod; onClose: () => void }) {
  const [checked, setChecked] = useState(() => new Set(events.map((event) => event.id)));
  const selected = events.filter((event) => checked.has(event.id));

  function download() {
    if (!selected.length) return;
    const url = URL.createObjectURL(new Blob([buildAgendaCalendar(selected)], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pilotis-agenda-' + period.start + '.ics';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    onClose();
  }

  return <Modal open title="Exportar para o Google Agenda" onClose={onClose}>
    <div className="grid gap-3 text-sm">
      <p>O arquivo inclui o tipo e as datas dos eventos selecionados. No Google Agenda, use <strong>Configurações → Importar e exportar</strong> em um computador.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setChecked(new Set(events.map((event) => event.id)))}>Selecionar todos</Button>
        <Button size="sm" variant="secondary" onClick={() => setChecked(new Set())}>Limpar seleção</Button>
        <span role="status" className="text-xs text-[#424D5D]">{selected.length} selecionado{selected.length === 1 ? '' : 's'}</span>
      </div>
      <fieldset className="grid min-w-0 gap-1">
        <legend className="text-sm font-semibold">Eventos de {formatDateBR(period.start)} a {formatDateBR(period.end)}</legend>
        {events.map((event) => (
          <label key={event.id} className="flex min-w-0 items-start gap-2 rounded border border-[#E4E1DA] px-2 py-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#1F3A5F]" checked={checked.has(event.id)}
              onChange={(change) => setChecked((previous) => {
                const next = new Set(previous);
                if (change.target.checked) next.add(event.id);
                else next.delete(event.id);
                return next;
              })} />
            <span className="min-w-0">
              <strong className="block break-words">{event.title}</strong>
              <span className="block text-xs text-[#424D5D]">{eventDates(event)} · {AGENDA_TYPES[event.type].label}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button className="justify-self-end" onClick={download} disabled={!selected.length}><Download className="h-4 w-4" aria-hidden="true" /> Baixar arquivo .ics</Button>
    </div>
  </Modal>;
}

export function AgendaView({ data, companyEmail, onOpen, loading = false, loadFailed = false }: {
  data: PilotisDataState; companyEmail?: string | null; onOpen: (target: AgendaTarget) => void;
  loading?: boolean; loadFailed?: boolean;
}) {
  const today = planningTodayISO();
  const [dateParam, setDate] = useViewParam('agenda.data', today);
  const date = isValidISODate(dateParam) ? dateParam.trim() : today;
  const [viewParam, setView] = useViewParam('agenda.visao');
  const view: AgendaViewMode = viewParam === 'semana' ? 'week' : 'month';
  const [type, setType] = useViewParam('agenda.tipo');
  const [work, setWork] = useViewParam('agenda.obra');
  const [exporting, setExporting] = useState(false);
  const events = useMemo(() => buildAgendaEvents(data, today), [data, today]);
  const period = agendaPeriod(date, view);
  const visible = agendaEventsInPeriod(events, period, type, work);
  const isMonth = view === 'month';
  const label = isMonth ? monthLabel.format(new Date(period.start + 'T12:00:00Z'))
    : formatDateBR(period.start) + ' a ' + formatDateBR(period.end);
  const shift = (direction: -1 | 1) => setDate(isMonth ? addMonthsISO(date, direction) : addDaysISO(date, direction * 7));
  const currentDay = visible.filter((event) => event.start <= date && event.end >= date);

  return <div className="grid min-w-0 gap-4">
    <PageHeader title="Agenda" subtitle="Vencimentos, prazos e períodos cadastrados nos módulos" companyEmail={companyEmail}
      actions={<Button onClick={() => setExporting(true)} disabled={loading || loadFailed || !visible.length}>
        <Download className="h-4 w-4" aria-hidden="true" /> Exportar para o Google Agenda
      </Button>} />
    <div className="grid gap-3 rounded-xl border border-[#E4E1DA] bg-white p-3 sm:grid-cols-2">
      <label className="grid min-w-0 gap-1 text-sm font-semibold">Tipo de evento
        <select className={field} value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(AGENDA_TYPES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select>
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-semibold">Obra
        <select className={field} value={work} onChange={(event) => setWork(event.target.value)}>
          <option value="">Todas as obras</option><option value="Empresa">Empresa e eventos sem obra</option>
          {data.projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Modo de visualização" className="flex flex-wrap gap-2">
        <Button size="sm" variant={isMonth ? 'primary' : 'secondary'} aria-pressed={isMonth} onClick={() => setView('')}>
          <CalendarDays className="h-4 w-4" aria-hidden="true" /> Mês
        </Button>
        <Button size="sm" variant={isMonth ? 'secondary' : 'primary'} aria-pressed={!isMonth} onClick={() => setView('semana')}>
          <List className="h-4 w-4" aria-hidden="true" /> Semana
        </Button>
      </div>
      <Button size="sm" variant="secondary" onClick={() => setDate(today)}>Hoje</Button>
    </div>
    <div className="flex items-center justify-between gap-2">
      <button type="button" className={calendarButton} aria-label={isMonth ? 'Mês anterior' : 'Semana anterior'} onClick={() => shift(-1)}>
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <h2 className="min-w-0 text-center text-base font-bold text-[#14181F] first-letter:uppercase" aria-live="polite">{label}</h2>
      <button type="button" className={calendarButton} aria-label={isMonth ? 'Próximo mês' : 'Próxima semana'} onClick={() => shift(1)}>
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
    {loadFailed ? <p role="alert" className="text-sm text-[#B42318]">Não foi possível carregar os eventos. Recarregue a página para tentar novamente.</p>
      : loading ? <p role="status" className="text-sm text-[#424D5D]">Carregando eventos…</p>
      : isMonth ? <>
        <MonthCalendar period={period} date={date} today={today} events={visible} onDate={setDate} onOpen={onOpen} />
        <section className="grid gap-2" aria-label="Eventos do dia selecionado">
          <h3 className="text-sm font-semibold">Eventos de {formatDateBR(date)}</h3>
          {currentDay.length ? <EventList events={currentDay} onOpen={onOpen} />
            : <p className="text-sm text-[#424D5D]">{visible.length ? 'Nenhum evento neste dia.' : 'Nenhum evento neste mês com os filtros selecionados.'}</p>}
        </section>
      </> : visible.length ? <div className="grid gap-4">
        {agendaDays(period).map((day, index) => {
          const items = visible.filter((event) => event.start === day || (day === period.start && event.start < day));
          return items.length > 0 && <section key={day} className="grid gap-2">
            <h3 className="text-sm font-semibold">{weekdayLabels[index]} · <time dateTime={day}>{formatDateBR(day)}</time></h3>
            <EventList events={items} onOpen={onOpen} />
          </section>;
        })}
      </div> : <p className="text-sm text-[#424D5D]">Nenhum evento nesta semana com os filtros selecionados.</p>}
    {exporting && <ExportAgenda events={visible} period={period} onClose={() => setExporting(false)} />}
  </div>;
}
