import { useId, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Button, Modal, RegisteredBySelect } from './PilotisUI';
import { useToast } from './Toast';
import { createWhatsAppDraft, WHATSAPP_MODELS, type MessageValues } from '../../domain/whatsapp';
import { generateId } from '../../services/pilotisService';
import { recordWhatsAppSend, type WhatsAppTarget } from '../../services/whatsappService';
import type { ActorRole, Client, WhatsAppTemplates } from '../../types/pilotis';

const linkStyle = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm font-semibold text-[#1F3A5F] hover:bg-[#F6F5F2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F3A5F]';

export function WhatsAppShortcut({ uid, client, target, templates, values, label }: {
  uid: string;
  client?: Client;
  target: WhatsAppTarget;
  templates?: WhatsAppTemplates;
  values: MessageValues;
  label: string;
}) {
  const model = WHATSAPP_MODELS[target.model];
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState<{
    draft: ReturnType<typeof createWhatsAppDraft>;
    clientId: string;
    target: WhatsAppTarget;
    messageId: string;
  } | null>(null);
  const [opened, setOpened] = useState(false);
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const actorId = useId();
  const { showToast } = useToast();

  function prepare() {
    setOpen(true);
    setOpened(false);
    setActor('Sócio');
    setError('');
    setAttempt(null);
    try {
      if (!client) throw new Error('Use “Vincular cadastro do cliente” na obra antes de abrir o WhatsApp.');
      const draft = createWhatsAppDraft({
        model: target.model, template: templates?.[target.model] ?? model.defaultText,
        phone: client.phone, values: { ...values, cliente: client.name.trim().split(/\s+/)[0] },
      });
      setAttempt({ draft, clientId: client.id, target, messageId: generateId('wa') });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível preparar a mensagem.');
    }
  }

  return <>
    <Button variant="secondary" size="sm" onClick={prepare}>
      <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> {label}
    </Button>
    <Modal open={open} onClose={() => { if (!submitting.current) setOpen(false); }} title={model.label + ' pelo WhatsApp'}>
      <form className="grid gap-3 text-sm" onSubmit={async (event) => {
        event.preventDefault();
        if (!attempt || !opened || submitting.current) return;
        submitting.current = true;
        setSaving(true);
        setError('');
        try {
          await recordWhatsAppSend({
            uid, actor, clientId: attempt.clientId, target: attempt.target,
            openedPhone: attempt.draft.phone, messageId: attempt.messageId,
          });
          setOpen(false);
          showToast({ tone: 'success', title: 'Envio registrado no histórico do cliente.' });
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'Não foi possível registrar o envio.');
        } finally {
          submitting.current = false;
          setSaving(false);
        }
      }}>
        {attempt && <>
          <p className="whitespace-pre-wrap break-words rounded-lg bg-[#F6F5F2] p-3">{attempt.draft.message}</p>
          <p className="text-[#424D5D]">Abra a conversa, envie a mensagem e volte aqui para registrar o envio.</p>
          <a className={linkStyle + ' justify-self-start'} href={attempt.draft.href} target="_blank"
            rel="noopener noreferrer" onClick={() => setOpened(true)}>Abrir WhatsApp</a>
          <RegisteredBySelect id={actorId} value={actor} onChange={setActor} />
          <Button type="submit" disabled={!opened || saving} className="justify-self-start">
            {saving ? 'Registrando…' : 'Confirmar mensagem enviada'}
          </Button>
        </>}
        {error && <p role="alert" className="text-[#B42318]">{error}</p>}
      </form>
    </Modal>
  </>;
}
