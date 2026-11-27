const operations = {
  verifyEmail: 'VERIFY_EMAIL',
  resetPassword: 'PASSWORD_RESET',
  recoverEmail: 'RECOVER_EMAIL',
  verifyAndChangeEmail: 'VERIFY_AND_CHANGE_EMAIL',
} as const;

export type EmailActionMode = keyof typeof operations;
export type EmailAction = { mode: EmailActionMode; code: string } | { mode: 'invalid' };

function isEmailActionMode(value: string | null): value is EmailActionMode {
  return value !== null && Object.hasOwn(operations, value);
}

export function readEmailAction(search: string): EmailAction | null {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  const code = params.get('oobCode');
  if (!params.has('oobCode') && !isEmailActionMode(mode)) return null;
  if (!isEmailActionMode(mode) || !code?.trim() || code.length > 4096 ||
    params.getAll('mode').length !== 1 || params.getAll('oobCode').length !== 1) {
    return { mode: 'invalid' };
  }
  return { mode, code };
}

interface EmailActionServices {
  inspect: (code: string) => Promise<{ operation: string; data: { email?: string | null } }>;
  isAllowedEmail: (email: string | null | undefined) => boolean;
  apply: (code: string) => Promise<void>;
  reset: (code: string, password: string) => Promise<void>;
}

export async function submitEmailAction(
  action: Exclude<EmailAction, { mode: 'invalid' }>,
  services: EmailActionServices,
  password = '',
) {
  const info = await services.inspect(action.code);
  if (info.operation !== operations[action.mode] || !services.isAllowedEmail(info.data.email)) {
    throw Object.assign(new Error('Ação de e-mail fora da conta autorizada.'), { code: 'pilotis/wrong-email-action' });
  }
  if (action.mode === 'resetPassword') {
    await services.reset(action.code, password);
  } else {
    await services.apply(action.code);
  }
}

export function describeEmailActionFailure(error: unknown) {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case 'auth/expired-action-code':
      return { message: 'Este link expirou. Volte ao Pilotis e solicite um novo.', retryable: false, checkVerification: true };
    case 'auth/invalid-action-code':
      return { message: 'Este link é inválido ou já foi usado. Volte ao Pilotis para conferir a verificação ou solicitar um novo link.', retryable: false, checkVerification: true };
    case 'pilotis/wrong-email-action':
      return { message: 'O link não corresponde à ação ou à conta autorizada do Pilotis.', retryable: false, checkVerification: false };
    case 'auth/user-disabled':
    case 'auth/user-not-found':
      return { message: 'O Firebase informa que a conta está indisponível. Confira a conta no Firebase Authentication.', retryable: false, checkVerification: false };
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return { message: 'A senha não atende aos requisitos de segurança do Firebase. Escolha outra senha.', retryable: true, checkVerification: false };
    case 'auth/too-many-requests':
      return { message: 'O Firebase limitou temporariamente as tentativas. Aguarde alguns minutos e tente novamente.', retryable: true, checkVerification: false };
    default:
      return { message: 'Não foi possível concluir a solicitação. Confira sua conexão e tente novamente.', retryable: true, checkVerification: false };
  }
}
