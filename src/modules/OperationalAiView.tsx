import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { AlertNote, PageHeader, RegisteredBySelect, SegmentedControl, StatusBadge } from '../components/ui/PilotisUI';
import { CONSULTANT_ACTIONS, readWeeklyInsights, WEEKLY_QUESTION, type AiMode, type AiShortcut, type AiTurn } from '../domain/aiContext';
import { formatDateBR, planningTodayISO } from '../domain';
import { auth } from '../lib/firebase';
import type { ActorRole, ModuleKey, PilotisDataState } from '../types/pilotis';

const SUGGESTED_QUESTIONS = [
  'Quanto entra e sai nos próximos 5 meses?',
  'Quais certidões vencem este mês?',
  'Qual o custo real e a margem de cada obra?',
  'Quem está sem obra alocada nesta semana?',
  'Quanto foi recebido sem nota fiscal neste mês?',
];

const shortcutTargets: Record<AiShortcut, [ModuleKey, string]> = {
  funnel: ['clients', 'Funil'],
  simulator: ['financial', 'Simulador'],
  allocation: ['team', 'Alocação'],
};

const panel = 'min-w-0 rounded-xl border border-[#E4E1DA] bg-white p-4 sm:p-5';
const button = 'rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-semibold text-[#1F3A5F] hover:bg-[#F0EEE9] focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
const primary = 'inline-flex items-center gap-2 rounded-lg bg-[#1F3A5F] px-4 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';

async function chatRequest(method: 'GET' | 'POST', signal?: AbortSignal, body?: object) {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para consultar a IA Operacional.');
  const response = await fetch('/api/ai/chat', {
    method, signal, cache: 'no-store', headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: 'Bearer ' + await user.getIdToken(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({})) as { turn?: AiTurn; turns?: AiTurn[]; error?: string };
  if (!response.ok) throw new Error(payload.error || 'Não foi possível acessar a IA Operacional.');
  return payload;
}

type Navigate = (mod: ModuleKey, subTab?: string) => void;

function Answer({ turn, onNavigate }: { turn: AiTurn; onNavigate: Navigate }) {
  const { answer } = turn;
  const uniqueSources = [...new Map(answer.facts.map(({ source }) => [JSON.stringify(source), source])).values()];
  return (
    <article className="grid gap-3 rounded-xl border border-[#E4E1DA] bg-[#F6F5F2] p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">IA Operacional</strong>
        <StatusBadge label={turn.weekly ? (turn.createdBy === 'Sistema' ? 'Resumo semanal automático' : 'Resumo semanal') : turn.mode}
          tone={turn.mode === 'Consultor' ? 'warn' : 'info'} />
        <span className="text-xs text-[#5B6472]">{formatDateBR(turn.createdAt.slice(0, 10))}</span>
      </div>
      <p className="text-sm">{answer.text}</p>
      {answer.explanation && <p className="text-sm text-[#5B6472]">{answer.explanation}</p>}
      {answer.consulted.length > 0 && <p className="text-xs text-[#5B6472]"><strong>Fontes consultadas</strong> · {answer.consulted.join(' / ')}</p>}
      {answer.facts.length > 0 && <ol className="grid gap-2 text-sm">
        {answer.facts.map(({ id, label, value, source }) => {
          const sourceIndex = uniqueSources.findIndex((row) => JSON.stringify(row) === JSON.stringify(source)) + 1;
          return <li key={id} className="break-words">
            <strong>{label}{source.subject && ' · ' + source.subject}</strong><div>{value} <a href={'#source-' + turn.id + '-' + sourceIndex}
              className="whitespace-nowrap text-xs font-semibold text-[#1F3A5F] underline" aria-label={'Ver fonte ' + sourceIndex}>[{sourceIndex}]</a></div>
          </li>;
        })}
      </ol>}
      {answer.suggestions.length > 0 && <section className="grid gap-2 border-t border-[#E4E1DA] pt-3">
        <h3 className="text-sm font-semibold">Sugestões para avaliar</h3>
        {answer.suggestions.map((id) => <div key={id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p>{CONSULTANT_ACTIONS[id].text}</p>
          <button type="button" className={button} onClick={() => onNavigate(...shortcutTargets[id])}>{CONSULTANT_ACTIONS[id].label}</button>
        </div>)}
      </section>}
      {answer.guidance && <p className="rounded-lg bg-[#FFF4DE] p-2.5 text-sm text-[#70460B]">Valide decisões fiscais, tributárias, trabalhistas e jurídicas com o contador ou advogado.</p>}
      {uniqueSources.length > 0 && <details className="border-t border-[#E4E1DA] pt-2 text-xs" open>
        <summary className="cursor-pointer font-semibold text-[#1F3A5F]">Fontes consultadas</summary>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-[#5B6472]">
          {uniqueSources.map((source, index) => <li key={JSON.stringify(source)} id={'source-' + turn.id + '-' + (index + 1)} className="break-all">
            <strong>{source.module}</strong>{source.subject && ' · ' + source.subject} · {source.period}
            {source.records.length > 0 && <div>Registros de referência · {source.records.join(', ')}</div>}
          </li>)}
        </ol>
      </details>}
    </article>
  );
}

export function OperationalAiView({ data, onNavigate, companyEmail }: {
  data: PilotisDataState; onNavigate: Navigate; companyEmail?: string | null;
}) {
  const [mode, setMode] = useState<AiMode>('Analista');
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const lastRequest = useRef<{ key: string; id: string } | null>(null);
  const busy = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const today = planningTodayISO();
  const insights = readWeeklyInsights(data, today);

  useEffect(() => {
    const controller = new AbortController();
    void chatRequest('GET', controller.signal).then(({ turns: saved }) => {
      if (controller.signal.aborted || !saved?.length) return;
      setTurns(saved);
      const latestConversation = saved.filter((turn) => !turn.weekly).at(-1) ?? saved.at(-1);
      if (latestConversation) setSelected(latestConversation.conversationId);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Histórico indisponível.');
    }).finally(() => {
      if (!controller.signal.aborted) setHistoryLoading(false);
    });
    return () => controller.abort();
  }, []);

  const active = turns.filter((turn) => turn.conversationId === selected);
  const last = active.at(-1);
  const latestSummary = turns.filter((turn) => turn.weekly).at(-1);
  const threads = [...new Map(turns.map((turn) => [turn.conversationId, turn])).values()].reverse();

  useEffect(() => {
    const viewport = list.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [selected, turns.length, loading]);

  async function askAi(text: string, weekly = false) {
    if (busy.current || historyLoading) return;
    const question = weekly ? WEEKLY_QUESTION : text.trim();
    if (!question) return;
    const previousTurnId = weekly || last?.weekly ? undefined : last?.id;
    const key = JSON.stringify([question, mode, actor, weekly, previousTurnId]);
    const requestId = lastRequest.current?.key === key ? lastRequest.current.id : crypto.randomUUID();
    lastRequest.current = { key, id: requestId };
    busy.current = true;
    setError(''); setPending(question); setLoading(true);
    try {
      const response = await chatRequest('POST', undefined, { question, mode, registeredBy: actor, isWeeklySummary: weekly, previousTurnId, requestId });
      const turn = response.turn;
      if (!turn) throw new Error('O servidor não retornou a conversa salva.');
      setTurns((rows) => rows.some((row) => row.id === turn.id) ? rows : [...rows, turn]);
      setSelected(turn.conversationId);
      if (!weekly) setInput('');
      lastRequest.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao consultar IA Operacional.');
      if (!weekly) setInput(question);
    } finally {
      busy.current = false;
      setLoading(false); setPending('');
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader title="IA Operacional" subtitle="Consultas aos registros da Pilotis" companyEmail={companyEmail}
        actions={<button type="button" onClick={() => void askAi('', true)} disabled={loading || historyLoading}
          className={button}>Gerar resumo semanal</button>} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className={panel + ' flex min-h-[510px] flex-col gap-4'}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <SegmentedControl items={['Analista', 'Consultor']} active={mode} onChange={(value) => setMode(value as AiMode)} />
            <button type="button" className={button} disabled={loading || historyLoading}
              onClick={() => { setSelected(''); setInput(''); setError(''); }}>Nova conversa</button>
          </div>
          {threads.length > 0 && <label className="grid gap-1 text-sm font-semibold">
            Conversas recentes
            <select className="min-w-0 rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]"
              value={selected} disabled={loading} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Nova conversa</option>
              {threads.map((turn) => <option key={turn.conversationId} value={turn.conversationId}>{turn.weekly ? 'Resumo semanal · ' + formatDateBR(turn.week) : turn.question.slice(0, 90)}</option>)}
            </select>
          </label>}
          <div ref={list} className="grid max-h-[600px] min-h-40 flex-1 content-start gap-3 overflow-y-auto pr-1" aria-live="polite">
            {!active.length && !loading && <p className="p-4 text-sm text-[#5B6472]">
              {historyLoading ? 'Carregando conversas salvas…' : 'Pergunte sobre obras, finanças, equipe ou conformidade.'}
            </p>}
            {active.map((turn) => <div key={turn.id} className="grid min-w-0 gap-2">
              <p className="max-w-[90%] justify-self-end break-words rounded-xl bg-[#1F3A5F] px-4 py-3 text-sm text-white">{turn.question}</p>
              <Answer turn={turn} onNavigate={onNavigate} />
            </div>)}
            {loading && <><p className="max-w-[90%] justify-self-end break-words rounded-xl bg-[#1F3A5F] px-4 py-3 text-sm text-white">{pending}</p>
              <p className="p-2 text-sm text-[#5B6472]" role="status">Consultando registros…</p></>}
          </div>
          {error && <AlertNote tone="bad" title="Consulta da IA">{error}</AlertNote>}
          <form className="grid gap-2 border-t border-[#E4E1DA] pt-3" onSubmit={(event) => { event.preventDefault(); void askAi(input); }}>
            <RegisteredBySelect id="ai-registered-by" value={actor} onChange={setActor} />
            <div className="flex items-center gap-2">
              <input value={input} onChange={(event) => setInput(event.target.value)} maxLength={1200} disabled={loading}
                placeholder="Escreva sua pergunta" aria-label="Pergunta para a IA Operacional"
                className="min-w-0 flex-1 rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[#1F3A5F]" />
              <button type="submit" disabled={historyLoading || loading || !input.trim()} className={primary}><Send className="h-4 w-4" aria-hidden="true" />Enviar</button>
            </div>
          </form>
        </section>

        <aside className="grid gap-4">
          {mode === 'Consultor' && <section className={panel + ' grid gap-2'}>
            <h2 className="text-base font-semibold">Atalhos do Consultor</h2>
            {(Object.keys(CONSULTANT_ACTIONS) as AiShortcut[]).map((id) => <button key={id} type="button" className={button + ' text-left'}
              onClick={() => onNavigate(...shortcutTargets[id])}>{CONSULTANT_ACTIONS[id].label}</button>)}
          </section>}
          <section className={panel + ' grid gap-2'}>
            <h2 className="text-base font-semibold">Insights da semana</h2>
            {latestSummary && <button type="button" className={button + ' text-left'} disabled={loading}
              onClick={() => setSelected(latestSummary.conversationId)}>Ver último resumo · {formatDateBR(latestSummary.createdAt.slice(0, 10))}</button>}
            {insights.length === 0 ? <p className="text-sm text-[#5B6472]">Sem alertas da semana.</p>
              : insights.map((alert) => <button key={alert.id} type="button" onClick={() => onNavigate(alert.modulo,
                alert.modulo === 'compliance' ? (alert.categoria === 'certidao' ? 'Certidões' : 'Obrigações') : undefined)}
                className={button + ' grid justify-items-start gap-1 text-left'}><StatusBadge label={alert.nivel} />{alert.mensagem}</button>)}
          </section>
          <section className={panel + ' grid gap-2'}>
            <h2 className="text-base font-semibold">Perguntas sugeridas</h2>
            {SUGGESTED_QUESTIONS.map((question) => <button key={question} type="button"
              className={button + ' text-left'} disabled={loading || historyLoading} onClick={() => void askAi(question)}>{question}</button>)}
          </section>
        </aside>
      </div>
    </div>
  );
}
