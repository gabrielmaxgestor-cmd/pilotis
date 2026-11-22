import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { Button, Input, Note } from '../components/ui/PilotisUI';
import { isAuthorizedCompanyEmail } from '../config/companyAuth';
import type { AuthIssue } from '../hooks/useCurrentUser';
import { auth } from '../lib/firebase';

type AuthScreenMode = 'login' | 'forgot';

export function LoginView({
  authIssue,
  currentUserEmail,
  onLogout,
  onResendVerification,
  onReloadUser,
}: {
  authIssue?: AuthIssue;
  currentUserEmail?: string | null;
  onLogout?: () => Promise<void>;
  onResendVerification?: () => Promise<void>;
  onReloadUser?: () => Promise<boolean>;
}) {
  const [mode, setMode] = useState<AuthScreenMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepConnected, setKeepConnected] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState(false);

  // Forgot password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  // Verification feedback state
  const [verifyFeedback, setVerifyFeedback] = useState<{
    tone: 'info' | 'warning' | 'danger' | 'success';
    title: string;
    text: string;
  } | null>(null);

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      setFieldError(true);
      setLoginError('Confira os dados e tente de novo ou use “Esqueci a senha”.');
      return;
    }

    setLoading(true);
    setLoginError(null);
    setFieldError(false);

    try {
      await setPersistence(
        auth,
        keepConnected ? browserLocalPersistence : browserSessionPersistence,
      );

      const credential = await signInWithEmailAndPassword(
        auth,
        normalizedEmail,
        password,
      );

      if (!isAuthorizedCompanyEmail(credential.user.email)) {
        await signOut(auth);
        setFieldError(true);
        setLoginError('Confira os dados e tente de novo ou use “Esqueci a senha”.');
        return;
      }
    } catch {
      setFieldError(true);
      setLoginError('Confira os dados e tente de novo ou use “Esqueci a senha”.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetEmail = resetEmail.trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes('@')) {
      setResetError('Informe um e-mail válido da empresa.');
      return;
    }

    setLoading(true);
    setResetError(null);

    try {
      if (isAuthorizedCompanyEmail(targetEmail)) {
        await sendPasswordResetEmail(auth, targetEmail);
      }
      setResetSent(true);
    } catch {
      // Exibe confirmação neutra sem vazar existência de conta, exceto falha de rede óbvia
      setResetSent(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
    if (!onResendVerification) return;
    setLoading(true);
    setVerifyFeedback(null);
    try {
      await onResendVerification();
      setVerifyFeedback({
        tone: 'info',
        title: 'E-mail de verificação enviado',
        text: 'Confira a caixa de entrada e clique no link de confirmação para liberar o acesso.',
      });
    } catch {
      setVerifyFeedback({
        tone: 'danger',
        title: 'Não foi possível reenviar agora',
        text: 'Aguarde alguns instantes e tente novamente.',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckVerified() {
    if (!onReloadUser) return;
    setLoading(true);
    setVerifyFeedback(null);
    try {
      const ok = await onReloadUser();
      if (!ok) {
        setVerifyFeedback({
          tone: 'warning',
          title: 'E-mail ainda não verificado',
          text: 'Abra o link recebido no e-mail da empresa e tente confirmar novamente.',
        });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-white">
      <div className="bg-[#101828] text-white p-8 md:p-16 flex flex-col justify-center gap-6">
        <div className="flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-xl bg-[#9A6212] text-white font-bold text-2xl grid place-items-center shrink-0">
            P
          </div>
          <div>
            <strong className="block text-2xl font-bold tracking-tight">Pilotis</strong>
            <span className="text-sm text-[#A8B0BF]">
              Soluções Construtivas · Valença/RJ
            </span>
          </div>
        </div>

        <h1 className="text-3xl md:text-[40px] font-bold leading-[1.15] tracking-tight max-w-md">
          Obras, caixa e equipe em um só lugar.
        </h1>

        <p className="text-base text-[#A8B0BF] max-w-md leading-relaxed">
          Planeje cada etapa, acompanhe o fluxo de caixa e mantenha a empresa em conformidade, com dados reais e sempre atualizados.
        </p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-8 md:p-16 bg-white">
        {authIssue === 'email_not_verified' ? (
          <div className="w-full max-w-[400px] flex flex-col gap-5">
            <div>
              <h2 className="text-2xl md:text-[28px] font-bold text-[#14181F]">
                Confirmar e-mail da empresa
              </h2>
              <p className="text-sm text-[#5B6472] mt-1">
                Por segurança, o banco de dados exige que o e-mail único da empresa esteja verificado.
              </p>
            </div>

            <Note variant="warning" title="Verificação pendente">
              A conta <strong>{currentUserEmail}</strong> ainda não confirmou o e-mail.
            </Note>

            {verifyFeedback && (
              <Note variant={verifyFeedback.tone} title={verifyFeedback.title}>
                {verifyFeedback.text}
              </Note>
            )}

            <div className="flex flex-col gap-2.5">
              <Button
                variant="primary"
                fullWidth
                disabled={loading}
                onClick={handleCheckVerified}
              >
                {loading ? 'Verificando...' : 'Já verifiquei, entrar'}
              </Button>
              <Button
                variant="secondary"
                fullWidth
                disabled={loading}
                onClick={handleResendVerification}
              >
                Reenviar e-mail de verificação
              </Button>
              <Button
                variant="text"
                fullWidth
                disabled={loading}
                onClick={() => onLogout?.()}
              >
                Voltar para o login
              </Button>
            </div>
          </div>
        ) : mode === 'forgot' ? (
          <form
            onSubmit={handleResetSubmit}
            className="w-full max-w-[400px] flex flex-col gap-5"
            noValidate
          >
            <div>
              <h2 className="text-2xl md:text-[28px] font-bold text-[#14181F]">
                Recuperar senha
              </h2>
              <p className="text-sm text-[#5B6472] mt-1">
                Enviaremos um link de redefinição para o e-mail da empresa.
              </p>
            </div>

            {resetSent && (
              <Note variant="info" title="Link enviado">
                Se o e-mail estiver cadastrado, o link chega em alguns minutos e vale por 1 hora.
              </Note>
            )}

            <Input
              id="reset-company-email"
              label="E-mail da empresa"
              type="email"
              autoComplete="email"
              placeholder="pilotis@empresa.com.br"
              value={resetEmail}
              onChange={(e) => {
                setResetEmail(e.target.value);
                setResetError(null);
              }}
              error={resetError || undefined}
              required
            />

            <Button type="submit" variant="primary" fullWidth disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar link de redefinição'}
            </Button>

            <button
              type="button"
              onClick={() => {
                setMode('login');
                setResetSent(false);
                setResetError(null);
              }}
              className="text-sm font-semibold text-[#1F3A5F] hover:underline self-center cursor-pointer py-1"
            >
              Voltar para o login
            </button>
          </form>
        ) : (
          <form
            onSubmit={handleLoginSubmit}
            className="w-full max-w-[400px] flex flex-col gap-5"
            noValidate
          >
            <div>
              <h2 className="text-2xl md:text-[28px] font-bold text-[#14181F]">
                Entrar no sistema
              </h2>
              <p className="text-sm text-[#5B6472] mt-1">
                Acesso único da empresa Pilotis
              </p>
            </div>

            {authIssue === 'unauthorized_email' && (
              <Note variant="danger" title="Usuário não autorizado">
                O acesso ao Sistema de Gestão Pilotis é exclusivo da conta única da empresa.
              </Note>
            )}

            {loginError && (
              <Note variant="danger" title="Usuário ou senha incorretos">
                {loginError}
              </Note>
            )}

            <Input
              id="login-company-email"
              label="Usuário da empresa"
              type="email"
              autoComplete="username"
              placeholder="pilotis@empresa.com.br"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldError) {
                  setFieldError(false);
                  setLoginError(null);
                }
              }}
              error={fieldError ? ' ' : undefined}
              required
            />

            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <Input
                  id="login-password"
                  label="Senha"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldError) {
                      setFieldError(false);
                      setLoginError(null);
                    }
                  }}
                  error={fieldError ? ' ' : undefined}
                  className="pr-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2.5 top-[30px] p-2 text-[#5B6472] hover:text-[#14181F] rounded-md cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-[#14181F] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={keepConnected}
                  onChange={(e) => setKeepConnected(e.target.checked)}
                  className="w-4 h-4 rounded border-[#E4E1DA] accent-[#1F3A5F] cursor-pointer"
                />
                <span>Manter conectado</span>
              </label>

              <button
                type="button"
                onClick={() => {
                  setResetEmail(email);
                  setResetSent(false);
                  setResetError(null);
                  setMode('forgot');
                }}
                className="text-sm font-semibold text-[#1F3A5F] hover:underline cursor-pointer"
              >
                Esqueci a senha
              </button>
            </div>

            <Button type="submit" variant="primary" fullWidth disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>

            <p className="text-xs text-[#5B6472] leading-relaxed">
              Um único login em nome da empresa, com acesso total a todos os módulos. Todo registro exige o campo{' '}
              <strong className="text-[#14181F]">Registrado por</strong> (Sócio ou Responsável administrativo) para auditoria.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
