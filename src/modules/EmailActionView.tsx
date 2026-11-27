import { useRef, useState } from 'react';
import { applyActionCode, checkActionCode, confirmPasswordReset } from 'firebase/auth';
import { Button, Input, Note } from '../components/ui/PilotisUI';
import { isAuthorizedCompanyEmail } from '../config/companyAuth';
import { auth } from '../lib/firebase';
import { describeEmailActionFailure, submitEmailAction, type EmailAction } from '../services/emailActions';

const copy = {
  verifyEmail: {
    title: 'Confirmar e-mail',
    detail: 'Confirme o endereço da conta do Pilotis para liberar o acesso.',
    action: 'Confirmar e-mail',
    success: 'Seu e-mail foi verificado. Volte ao Pilotis para acessar o sistema.',
  },
  resetPassword: {
    title: 'Redefinir senha',
    detail: 'Escolha uma nova senha para a conta do Pilotis.',
    action: 'Salvar nova senha',
    success: 'Senha atualizada. Entre no Pilotis com a nova senha.',
  },
  recoverEmail: {
    title: 'Recuperar e-mail',
    detail: 'Confirme a recuperação do endereço de acesso da conta do Pilotis.',
    action: 'Recuperar e-mail',
    success: 'Endereço recuperado. Volte ao Pilotis e entre novamente.',
  },
  verifyAndChangeEmail: {
    title: 'Confirmar novo e-mail',
    detail: 'Confirme o novo endereço de acesso da conta do Pilotis.',
    action: 'Confirmar alteração',
    success: 'Novo endereço confirmado. Volte ao Pilotis e entre novamente.',
  },
} as const;

const loginLink = 'inline-flex min-h-[42px] items-center justify-center rounded-lg border border-[#E4E1DA] px-4 py-2 text-sm font-semibold text-[#1F3A5F] hover:bg-[#F0EEE9]';

export function EmailActionView({ action, onCheckSession }: { action: EmailAction; onCheckSession: () => Promise<boolean> }) {
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retryable: boolean } | null>(null);
  const handling = useRef(false);
  const settings = action.mode === 'invalid' ? null : copy[action.mode];

  async function checkVerification() {
    try { return await onCheckSession(); } catch { return false; }
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.mode === 'invalid' || handling.current || done) return;
    if (action.mode === 'resetPassword' && password !== passwordConfirmation) {
      setFailure({ message: 'As duas senhas precisam coincidir.', retryable: true });
      return;
    }

    handling.current = true;
    setWorking(true);
    setFailure(null);
    try {
      await submitEmailAction(action, {
        inspect: (code) => checkActionCode(auth, code),
        isAllowedEmail: isAuthorizedCompanyEmail,
        apply: (code) => applyActionCode(auth, code),
        reset: (code, newPassword) => confirmPasswordReset(auth, code, newPassword),
      }, password);
      if (action.mode === 'verifyEmail' || action.mode === 'verifyAndChangeEmail') await checkVerification();
      setDone(true);
    } catch (error) {
      const next = describeEmailActionFailure(error);
      if (action.mode === 'verifyEmail' && next.checkVerification && await checkVerification()) setDone(true);
      else setFailure(next);
    } finally {
      handling.current = false;
      setWorking(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-4 sm:p-8">
      <section className="grid w-full max-w-md gap-4 rounded-xl border border-[#E4E1DA] bg-white p-5 sm:p-7" aria-labelledby="email-action-title">
        <span className="text-sm font-semibold text-[#1F3A5F]">Pilotis</span>
        <h1 id="email-action-title" className="text-xl font-bold text-[#14181F]">{settings?.title ?? 'Link de acesso inválido'}</h1>
        {!settings ? (
          <p role="alert" className="text-sm text-[#5B6472]">Abra o link completo recebido por e-mail. Se necessário, volte ao Pilotis para solicitar outro.</p>
        ) : done ? (
          <div role="status"><Note variant="success" title="Solicitação concluída">{settings.success}</Note></div>
        ) : (
          <form className="grid gap-3" onSubmit={confirm} aria-busy={working}>
            <p className="text-sm text-[#5B6472]">{settings.detail}</p>
            {action.mode === 'resetPassword' && (failure?.retryable ?? true) && <>
              <Input id="email-action-password" label="Nova senha" type="password" autoComplete="new-password" required
                value={password} onChange={(event) => setPassword(event.target.value)} disabled={working} />
              <Input id="email-action-password-confirmation" label="Confirme a nova senha" type="password" autoComplete="new-password" required
                value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} disabled={working} />
            </>}
            {failure && <div role="alert"><Note variant="danger" title="Falha na solicitação">{failure.message}</Note></div>}
            {(failure?.retryable ?? true) && <Button type="submit" disabled={working}>{working ? 'Confirmando…' : settings.action}</Button>}
          </form>
        )}
        <a className={loginLink} href="/">Voltar ao Pilotis</a>
      </section>
    </main>
  );
}
