import { formatBRL, formatDateBR, isValidISODate } from './formatters';
import type { Installment, WhatsAppModel, WhatsAppTemplates } from '../types/pilotis';

type MessageVariable = 'cliente' | 'obra' | 'valor' | 'vencimento' | 'material' | 'marco';
export type MessageValues = Partial<Record<MessageVariable, string>>;
type MessageModel = { label: string; defaultText: string; variables: readonly MessageVariable[] };

const PAYMENT_VARIABLES: readonly MessageVariable[] = ['cliente', 'obra', 'valor', 'vencimento'];
export const WHATSAPP_MODELS: Record<WhatsAppModel, MessageModel> = {
  installmentDue: {
    label: 'Parcela a vencer', variables: PAYMENT_VARIABLES,
    defaultText: 'Olá, {cliente}! Lembrete da parcela de {valor} da obra {obra}, com vencimento em {vencimento}.',
  },
  installmentOverdue: {
    label: 'Parcela vencida', variables: PAYMENT_VARIABLES,
    defaultText: 'Olá, {cliente}! A parcela de {valor} da obra {obra}, vencida em {vencimento}, consta em aberto. Pode confirmar a previsão de pagamento?',
  },
  material: {
    label: 'Cobrança de material', variables: ['cliente', 'obra', 'material', 'vencimento'],
    defaultText: 'Olá, {cliente}! Para seguirmos com a obra {obra}, precisamos de {material} até {vencimento}. Pode confirmar a previsão de entrega?',
  },
  milestone: {
    label: 'Aviso de marco da obra', variables: ['cliente', 'obra', 'marco', 'vencimento'],
    defaultText: 'Olá, {cliente}! O marco “{marco}” da obra {obra} está previsto para {vencimento}.',
  },
  testimonial: {
    label: 'Pedido de depoimento', variables: ['cliente', 'obra'],
    defaultText: 'Olá, {cliente}! Agradecemos a confiança durante a obra {obra}. Você poderia nos enviar um depoimento sobre a experiência?',
  },
};

export const WHATSAPP_TEMPLATE_LIMIT = 500;
export const WHATSAPP_MODEL_KEYS = Object.keys(WHATSAPP_MODELS) as WhatsAppModel[];
const PLACEHOLDER = /\{([^{}]*)\}/g;

export function whatsappTemplates(saved?: WhatsAppTemplates): WhatsAppTemplates {
  return Object.fromEntries(WHATSAPP_MODEL_KEYS.map((key) => [key, saved?.[key] ?? WHATSAPP_MODELS[key].defaultText])) as WhatsAppTemplates;
}

export function validateWhatsAppTemplate(model: WhatsAppModel, text: string): string {
  const cleaned = text.trim();
  const definition = WHATSAPP_MODELS[model];
  if (!cleaned || cleaned.length > WHATSAPP_TEMPLATE_LIMIT) {
    throw new Error(definition.label + ' · Escreva uma mensagem de até ' + WHATSAPP_TEMPLATE_LIMIT + ' caracteres.');
  }
  if (/[{}]/.test(cleaned.replace(PLACEHOLDER, '')) ||
    Array.from(cleaned.matchAll(PLACEHOLDER)).some(([, variable]) => !definition.variables.some((allowed) => allowed === variable))) {
    throw new Error(definition.label + ' · Use apenas as variáveis listadas para este modelo.');
  }
  return cleaned;
}

export function normalizeWhatsAppNumber(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!/^\+?[0-9 ().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  const international = raw.startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00') && !raw.startsWith('+')) digits = digits.slice(2);
  if (international) return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
  if (/^[1-9]\d{9,10}$/.test(digits)) return '55' + digits;
  return /^55[1-9]\d{9,10}$/.test(digits) ? digits : null;
}

export function createWhatsAppDraft(options: { model: WhatsAppModel; template: string; phone?: string; values: MessageValues }) {
  const phone = normalizeWhatsAppNumber(options.phone);
  if (!phone) throw new Error('Informe um telefone com DDD no cadastro do cliente.');
  const template = validateWhatsAppTemplate(options.model, options.template);
  const message = template.replace(PLACEHOLDER, (_placeholder, key: MessageVariable) => {
    const value = options.values[key]?.trim();
    if (!value) throw new Error('Preencha o dado {' + key + '} no registro ou ajuste o modelo em Configurações.');
    return value;
  });
  return { phone, message, href: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message) };
}

export function installmentWhatsAppContext(installment: Pick<Installment, 'status' | 'dueDate' | 'amount'>, today: string) {
  if (installment.status !== 'A vencer' || !isValidISODate(installment.dueDate)) return null;
  return {
    model: installment.dueDate < today ? 'installmentOverdue' as const : 'installmentDue' as const,
    values: { valor: formatBRL(installment.amount), vencimento: formatDateBR(installment.dueDate) },
  };
}
