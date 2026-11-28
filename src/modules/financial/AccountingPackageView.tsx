import { useState } from 'react';
import { AlertNote, Button, Card, RegisteredBySelect } from '../../components/ui/PilotisUI';
import { buildAccountingPackage, validAccountingPeriod } from '../../domain/accountingPackage';
import { addDaysISO, addMonthsISO } from '../../domain/formatters';
import { planningTodayISO } from '../../domain/pilotisAdapters';
import { recordAccountingPackageExport } from '../../services/pilotisService';
import type { ActorRole, PilotisDataState } from '../../types/pilotis';

const field = 'min-w-0 rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]';
const stamp = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export function AccountingPackageView({ uid, data, loadState = 'ready' }: {
  uid: string; data: PilotisDataState; loadState?: 'loading' | 'failed' | 'ready';
}) {
  const today = planningTodayISO();
  const monthStart = today.slice(0, 7) + '-01';
  const [start, setStart] = useState(monthStart);
  const [end, setEnd] = useState(() => addDaysISO(addMonthsISO(monthStart, 1), -1));
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);

  return <Card title="Pacote para o contador">
    <form className="grid max-w-2xl gap-4" onSubmit={async (event) => {
      event.preventDefault();
      if (busy || loadState !== 'ready') return;
      if (!validAccountingPeriod({ start, end })) {
        setFeedback({ tone: 'bad', text: 'Informe as duas datas. O início deve ser anterior ou igual ao fim.' });
        return;
      }
      setBusy(true); setFeedback(null);
      try {
        const { createAccountingArchive, downloadAccountingArchive } = await import('../../utils/accountingPackageFiles');
        const result = buildAccountingPackage(data, { start, end }, { actor, generatedAt: stamp.format(new Date()) }, today);
        const archive = await createAccountingArchive(result.sheets);
        await recordAccountingPackageExport(uid, actor, start, end);
        downloadAccountingArchive(archive, 'pacote-para-o-contador-' + start + '-a-' + end + '.zip');
        setFeedback({ tone: 'ok', text: result.hasData ? 'Pacote gerado e registrado na auditoria.' :
          'Pacote gerado com “Sem dados” no período. A geração foi registrada na auditoria.' });
      } catch {
        setFeedback({ tone: 'bad', text: 'Não foi possível gerar o pacote e registrar a exportação. Confira a conexão e tente novamente.' });
      } finally { setBusy(false); }
    }}>
      <p className="text-sm text-[#424D5D]">Baixe uma planilha Excel e os CSVs equivalentes de lançamentos, parcelas recebidas, notas fiscais, folha e encargos, tributos e dívidas.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-sm font-semibold">Início do período
          <input type="date" className={field} required value={start} max={end || undefined}
            onChange={(event) => { setStart(event.target.value); setFeedback(null); }} />
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-semibold">Fim do período
          <input type="date" className={field} required value={end} min={start || undefined}
            onChange={(event) => { setEnd(event.target.value); setFeedback(null); }} />
        </label>
      </div>
      <RegisteredBySelect id="accounting-package-actor" value={actor} onChange={setActor} />
      {loadState === 'loading' && <p role="status" className="text-sm text-[#424D5D]">Aguardando os dados do sistema…</p>}
      {loadState === 'failed' && <p role="alert" className="text-sm text-[#B42318]">Não foi possível carregar todos os dados do pacote. Recarregue a página e tente novamente.</p>}
      {feedback && <AlertNote tone={feedback.tone} title={feedback.tone === 'ok' ? 'Exportação concluída' : 'Verifique a exportação'}>
        <p role={feedback.tone === 'ok' ? 'status' : 'alert'}>{feedback.text}</p>
      </AlertNote>}
      <Button type="submit" className="justify-self-start" disabled={busy || loadState !== 'ready'}>
        {busy ? 'Gerando pacote…' : 'Gerar pacote (.zip)'}
      </Button>
    </form>
  </Card>;
}
