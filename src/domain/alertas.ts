import { previsaoCaixa } from './caixa';
import { isParcelaEmAtraso } from './financeiro';
import { diffDaysISO, formatDateBR } from './formatters';
import type { DomainCollections } from './types';

export type AlertaNivel = 'Urgente' | 'Atenção' | 'Info' | 'Neutro';
export type AlertaCategoria =
  | 'caixa'
  | 'vencimento'
  | 'certidao'
  | 'treinamento'
  | 'planejamento'
  | 'garantia';

export type AlertaModulo =
  | 'financial'
  | 'compliance'
  | 'planning'
  | 'clients'
  | 'team';

export interface AlertaDominio {
  id: string;
  nivel: AlertaNivel;
  categoria: AlertaCategoria;
  modulo: AlertaModulo;
  mensagem: string;
  referenciaId?: string;
}

export interface AlertasOpcoes {
  dataReferencia: string;
  mesesPrevisaoCaixa?: number;
  diasAvisoVencimento?: number;
  diasAvisoCertidao?: number;
  diasAvisoTreinamento?: number;
  saldoInicialCaixa?: number | null;
}

export function alertas(
  estado: Partial<DomainCollections>,
  opcoes: AlertasOpcoes,
): AlertaDominio[] {
  const refDate = opcoes.dataReferencia;
  const mesesPrevisao = opcoes.mesesPrevisaoCaixa ?? 5;
  const diasVencimento = opcoes.diasAvisoVencimento ?? 7;
  const diasCertidao = opcoes.diasAvisoCertidao ?? 30;
  const diasTreinamento = opcoes.diasAvisoTreinamento ?? 45;

  const resultado: AlertaDominio[] = [];

  const lancamentos = estado.lancamentos ?? [];
  const parcelas = estado.parcelas ?? [];
  const orcamentos = estado.orcamentos ?? [];
  const contasPagar = estado.contasPagar ?? [];
  const colaboradores = estado.colaboradores ?? [];
  const capacitacoes = estado.capacitacoes ?? [];
  const obrigacoes = estado.obrigacoes ?? [];
  const certidoes = estado.certidoes ?? [];
  const etapas = estado.etapas ?? [];
  const garantias = estado.garantias ?? [];

  // 1. Caixa negativo projetado
  const caixa = previsaoCaixa(mesesPrevisao, {
    dataBase: refDate,
    saldoInicial: opcoes.saldoInicialCaixa,
    lancamentos,
    parcelas,
    orcamentos,
    contasPagar,
    colaboradores,
    parametrosEncargos: estado.config?.parametrosEncargos,
  });

  for (const mes of caixa.meses) {
    if (mes.negativo) {
      resultado.push({
        id: `caixa-negativo-${mes.mesKey}`,
        nivel: 'Urgente',
        categoria: 'caixa',
        modulo: 'financial',
        mensagem: `Caixa projetado negativo em ${mes.rotulo}`,
      });
    }
  }

  // 2. Vencimentos (contas a pagar, parcelas a receber em atraso/próximas, obrigações fiscais)
  for (const cp of contasPagar) {
    if (cp.status === 'Paga') continue;
    const dias = diffDaysISO(cp.vencimento, refDate);
    if (dias === null) continue;
    if (dias < 0) {
      resultado.push({
        id: `cp-atraso-${cp.id}`,
        nivel: 'Urgente',
        categoria: 'vencimento',
        modulo: 'financial',
        mensagem: `Conta a pagar "${cp.descricao}" vencida em ${formatDateBR(cp.vencimento)}`,
        referenciaId: cp.id,
      });
    } else if (dias <= diasVencimento) {
      resultado.push({
        id: `cp-vence-${cp.id}`,
        nivel: 'Atenção',
        categoria: 'vencimento',
        modulo: 'financial',
        mensagem: `Conta a pagar "${cp.descricao}" vence em ${dias} dia(s)`,
        referenciaId: cp.id,
      });
    }
  }

  for (const ob of obrigacoes) {
    if (ob.status === 'Em dia') continue;
    const dias = diffDaysISO(ob.vencimento, refDate);
    if (dias !== null && dias < 0) {
      resultado.push({
        id: `ob-atraso-${ob.id}`,
        nivel: 'Urgente',
        categoria: 'vencimento',
        modulo: 'compliance',
        mensagem: `Obrigação "${ob.titulo}" em atraso (${formatDateBR(ob.vencimento)})`,
        referenciaId: ob.id,
      });
    } else if (dias !== null && dias <= diasVencimento) {
      resultado.push({
        id: `ob-vence-${ob.id}`,
        nivel: 'Atenção',
        categoria: 'vencimento',
        modulo: 'compliance',
        mensagem: `Obrigação "${ob.titulo}" vence em ${dias} dia(s)`,
        referenciaId: ob.id,
      });
    }
  }

  for (const p of parcelas) {
    if (isParcelaEmAtraso(p, refDate)) {
      resultado.push({
        id: `parcela-atraso-${p.id}`,
        nivel: 'Urgente',
        categoria: 'vencimento',
        modulo: 'financial',
        mensagem: `Parcela ${p.rotulo} vencida em ${formatDateBR(p.vencimento)}`,
        referenciaId: p.id,
      });
    }
  }

  // 3. Certidões
  for (const cert of certidoes) {
    const dias = diffDaysISO(cert.dataValidade, refDate);
    if (cert.status === 'Vencida' || (dias !== null && dias < 0)) {
      resultado.push({
        id: `cert-vencida-${cert.id}`,
        nivel: 'Urgente',
        categoria: 'certidao',
        modulo: 'compliance',
        mensagem: `Certidão "${cert.titulo}" vencida em ${formatDateBR(cert.dataValidade)}`,
        referenciaId: cert.id,
      });
    } else if (dias !== null && dias <= diasCertidao) {
      resultado.push({
        id: `cert-vence-${cert.id}`,
        nivel: 'Atenção',
        categoria: 'certidao',
        modulo: 'compliance',
        mensagem: `Certidão "${cert.titulo}" vence em ${dias} dia(s)`,
        referenciaId: cert.id,
      });
    }
  }

  // 4. Treinamentos, ASO, NR-18 e NR-35
  const colabNameById = new Map(colaboradores.map((c) => [c.id, c.nome]));

  for (const colab of colaboradores) {
    const checks: Array<{ label: string; date?: string }> = [
      { label: 'ASO', date: colab.asoValidade },
      { label: 'NR-18', date: colab.nr18Validade },
      { label: 'NR-35', date: colab.nr35Validade },
    ];
    for (const chk of checks) {
      if (!chk.date) continue;
      const dias = diffDaysISO(chk.date, refDate);
      if (dias === null) continue;
      if (dias < 0) {
        resultado.push({
          id: `sst-vencido-${colab.id}-${chk.label}`,
          nivel: 'Urgente',
          categoria: 'treinamento',
          modulo: 'team',
          mensagem: `${chk.label} de ${colab.nome} vencido em ${formatDateBR(chk.date)}`,
          referenciaId: colab.id,
        });
      } else if (dias <= diasTreinamento) {
        resultado.push({
          id: `sst-vence-${colab.id}-${chk.label}`,
          nivel: 'Atenção',
          categoria: 'treinamento',
          modulo: 'team',
          mensagem: `${chk.label} de ${colab.nome} vence em ${dias} dia(s)`,
          referenciaId: colab.id,
        });
      }
    }
  }

  for (const cap of capacitacoes) {
    if (!cap.dataValidade) continue;
    const dias = diffDaysISO(cap.dataValidade, refDate);
    if (dias === null) continue;
    const colabName = colabNameById.get(cap.colaboradorId) || 'colaborador';
    if (cap.status === 'Vencida' || dias < 0) {
      resultado.push({
        id: `cap-vencida-${cap.id}`,
        nivel: 'Urgente',
        categoria: 'treinamento',
        modulo: 'team',
        mensagem: `Capacitação "${cap.titulo}" (${colabName}) vencida em ${formatDateBR(cap.dataValidade)}`,
        referenciaId: cap.id,
      });
    } else if (dias <= diasTreinamento) {
      resultado.push({
        id: `cap-vence-${cap.id}`,
        nivel: 'Atenção',
        categoria: 'treinamento',
        modulo: 'team',
        mensagem: `Capacitação "${cap.titulo}" (${colabName}) vence em ${dias} dia(s)`,
        referenciaId: cap.id,
      });
    }
  }

  // 5. Etapas com atraso justificado
  for (const st of etapas) {
    if (st.justificativaAtraso && st.status !== 'Concluída') {
      resultado.push({
        id: `stage-delay-${st.id}`,
        nivel: 'Info',
        categoria: 'planejamento',
        modulo: 'planning',
        mensagem: `Etapa "${st.nome}" com atraso registrado (${st.categoriaAtraso || 'Justificado'})`,
        referenciaId: st.id,
      });
    }
  }

  // 6. Chamados de garantia em aberto
  const openWarranties = garantias.filter((w) => w.status !== 'Resolvido');
  if (openWarranties.length > 0) {
    resultado.push({
      id: 'warranty-open',
      nivel: 'Neutro',
      categoria: 'garantia',
      modulo: 'clients',
      mensagem: `Garantia: ${openWarranties.length} chamado(s) em aberto`,
    });
  }

  const order: Record<AlertaNivel, number> = {
    Urgente: 0,
    Atenção: 1,
    Info: 2,
    Neutro: 3,
  };
  return resultado.sort((a, b) => order[a.nivel] - order[b.nivel]);
}
