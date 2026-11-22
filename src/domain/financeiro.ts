import { roundCents } from './formatters';
import type { LancamentoStatus, LancamentoTipo } from './types';

export interface ClassificarLancamentoInput {
  descricao: string;
  categoria?: string;
  tipoInformado?: LancamentoTipo | 'income' | 'expense' | 'loan';
  valor: number;
  previsto?: boolean;
  statusInformado?: LancamentoStatus;
}

export interface LancamentoClassificado {
  tipo: LancamentoTipo;
  categoria: string;
  natureza: 'previsto' | 'realizado';
  valor: number;
  entraComoReceita: boolean;
  entraNoDre: boolean;
  geraDivida: boolean;
  rejeitadoComoReceita: boolean;
  status: LancamentoStatus;
  motivo?: string;
}

const LOAN_KEYWORDS = [
  'emprestimo',
  'empréstimo',
  'financiamento',
  'conta garantida',
  'cheque especial',
  'capital de giro',
  'credito bancario',
  'crédito bancário',
];

function isLoanKeywordPresent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return LOAN_KEYWORDS.some((kw) => normalized.includes(kw));
}

export function classificarLancamento(
  input: ClassificarLancamentoInput,
): LancamentoClassificado {
  const valor = roundCents(Math.max(0, input.valor || 0));
  const rawCategory = (input.categoria || '').trim();
  const rawDesc = (input.descricao || '').trim();
  const askedIncome =
    input.tipoInformado === 'receita' || input.tipoInformado === 'income';
  const askedLoan =
    input.tipoInformado === 'emprestimo' || input.tipoInformado === 'loan';

  const detectedLoan =
    askedLoan ||
    isLoanKeywordPresent(rawCategory) ||
    isLoanKeywordPresent(rawDesc);

  if (detectedLoan) {
    return {
      tipo: 'emprestimo',
      categoria: 'Empréstimo',
      natureza: 'realizado',
      valor,
      entraComoReceita: false,
      entraNoDre: false,
      geraDivida: true,
      rejeitadoComoReceita: askedIncome,
      status: 'Não é receita',
      motivo:
        'Empréstimo nunca entra como receita; classificado separadamente como entrada de crédito/dívida.',
    };
  }

  const tipo: LancamentoTipo = askedIncome ? 'receita' : 'despesa';
  const previsto = Boolean(input.previsto);
  const natureza: 'previsto' | 'realizado' = previsto ? 'previsto' : 'realizado';

  let status: LancamentoStatus;
  if (input.statusInformado && input.statusInformado !== 'Não é receita') {
    status = input.statusInformado;
  } else if (previsto) {
    status = 'A vencer';
  } else {
    status = tipo === 'receita' ? 'Recebido' : 'Pago';
  }

  return {
    tipo,
    categoria:
      rawCategory || (tipo === 'receita' ? 'Receita de obra' : 'Outros'),
    natureza,
    valor,
    entraComoReceita: tipo === 'receita',
    entraNoDre: true,
    geraDivida: false,
    rejeitadoComoReceita: false,
    status,
  };
}
