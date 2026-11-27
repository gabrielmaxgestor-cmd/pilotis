/**
 * Ponto único de configuração do usuário único da empresa no frontend.
 * Deve corresponder exatamente ao valor definido em `companyEmail()` em `firestore.rules`.
 */
export const COMPANY_EMAIL = (
  import.meta.env.VITE_COMPANY_EMAIL || 'gabrielmaxgestor@gmail.com'
)
  .trim()
  .toLowerCase();

export function isAuthorizedCompanyEmail(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === COMPANY_EMAIL;
}
