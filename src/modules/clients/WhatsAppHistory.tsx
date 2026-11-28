import { useEffect, useState } from 'react';
import { Button, Card } from '../../components/ui/PilotisUI';
import { formatTimestampBR } from '../../domain/formatters';
import { WHATSAPP_MODELS } from '../../domain/whatsapp';
import { watchWhatsAppHistory } from '../../services/whatsappService';
import type { Project, WhatsAppSend } from '../../types/pilotis';

type Cursor = Parameters<typeof watchWhatsAppHistory>[1];

export function WhatsAppHistory({ clientId, projects }: { clientId: string; projects: Project[] }) {
  const [cursors, setCursors] = useState<Cursor[]>([null]);
  const [rows, setRows] = useState<WhatsAppSend[]>([]);
  const [next, setNext] = useState<Cursor>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const cursor = cursors.at(-1) ?? null;

  useEffect(() => watchWhatsAppHistory(clientId, cursor, (entries, following) => {
    setRows(entries);
    setNext(following);
    setError(false);
    setLoading(false);
  }, () => { setError(true); setLoading(false); }), [clientId, cursor]);

  return <Card title="Histórico de WhatsApp">
    {loading ? <p role="status" className="text-sm">Carregando envios…</p>
      : error ? <p role="alert" className="text-sm text-[#B42318]">Não foi possível carregar o histórico de WhatsApp.</p>
        : rows.length ? <ul className="grid gap-2 text-sm">
          {rows.map((row) => <li key={row.id} className="grid gap-0.5 rounded-lg border border-[#E4E1DA] p-2">
            <strong>{WHATSAPP_MODELS[row.model]?.label ?? 'WhatsApp'}</strong>
            <span>{formatTimestampBR(row.createdAt)} · {row.createdBy}</span>
            {projects.find((project) => project.id === row.projectId)?.name &&
              <span className="text-[#424D5D]">{projects.find((project) => project.id === row.projectId)?.name}</span>}
          </li>)}
        </ul> : <p className="text-sm text-[#424D5D]">Nenhum envio registrado.</p>}
    {!loading && !error && (next || cursors.length > 1) && <div className="mt-3 flex flex-wrap gap-2">
      {cursors.length > 1 && <Button size="sm" variant="secondary" onClick={() => {
        setLoading(true); setCursors((pages) => pages.slice(0, -1));
      }}>Mais recentes</Button>}
      {next && <Button size="sm" variant="secondary" onClick={() => {
        setLoading(true); setCursors((pages) => [...pages, next]);
      }}>Mais antigos</Button>}
    </div>}
  </Card>;
}
