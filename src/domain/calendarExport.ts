import { AGENDA_TYPES, type AgendaEvent } from './agenda';
import { addDaysISO } from './formatters';

const byteLength = new TextEncoder();

function foldLine(line: string): string {
  let output = '';
  let bytes = 0;
  for (const character of line) {
    const size = byteLength.encode(character).length;
    if (bytes + size > 75) {
      output += '\r\n ';
      bytes = 1;
    }
    output += character;
    bytes += size;
  }
  return output;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\n|\r/g, '\\n').replace(/([;,])/g, '\\$1');
}

export function buildAgendaCalendar(events: readonly Pick<AgendaEvent, 'id' | 'type' | 'start' | 'end'>[], now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const dateValue = (date: string) => date.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pilotis//Agenda//PT-BR', 'CALSCALE:GREGORIAN'];
  for (const event of events) {
    const { label, exportTitle } = AGENDA_TYPES[event.type];
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + encodeURIComponent(event.id) + '@agenda.pilotis',
      'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + dateValue(event.start),
      'DTEND;VALUE=DATE:' + dateValue(addDaysISO(event.end, 1)),
      'SUMMARY:' + escapeText(exportTitle),
      'CATEGORIES:' + escapeText(label),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
