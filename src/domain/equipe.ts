import { addDaysISO, diffDaysISO, formatDateBR, isValidISODate, roundCents } from './formatters';
import type { ColaboradorRecord, TaxChargeParameters } from './types';

export interface EncargosColaboradorResult {
  configurado: boolean;
  aplicavel: boolean;
  status: 'configurado' | 'nao_configurado' | 'nao_aplicavel';
  rotulo: string;
  salarioBase: number;
  inssValor: number | null;
  fgtsValor: number | null;
  feriasValor: number | null;
  decimoTerceiroValor: number | null;
  encargosMensais: number | null;
  provisoesMensais: number | null;
  custoTotalMensal: number | null;
}

export function isParametrosEncargosVigente(
  parametros: TaxChargeParameters | null | undefined,
  dataReferencia?: string,
): parametros is TaxChargeParameters {
  if (!parametros) return false;
  if (!isValidISODate(parametros.vigenciaInicio)) return false;

  const rates = [
    parametros.inssPct,
    parametros.fgtsPct,
    parametros.feriasPct,
    parametros.decimoTerceiroPct,
  ];
  if (rates.some((r) => typeof r !== 'number' || !Number.isFinite(r) || r < 0)) {
    return false;
  }
  if (rates.reduce((sum, r) => sum + r, 0) <= 0) {
    return false;
  }

  if (dataReferencia && isValidISODate(dataReferencia)) {
    if (dataReferencia < parametros.vigenciaInicio) return false;
    if (
      parametros.vigenciaFim &&
      isValidISODate(parametros.vigenciaFim) &&
      dataReferencia > parametros.vigenciaFim
    ) {
      return false;
    }
  }

  return true;
}

export function calcularEncargos(
  colaborador: Pick<ColaboradorRecord, 'vinculo' | 'salarioBase'>,
  parametros: TaxChargeParameters | null | undefined,
  dataReferencia?: string,
): EncargosColaboradorResult {
  const salarioBase = roundCents(Math.max(0, colaborador.salarioBase || 0));

  if (colaborador.vinculo !== 'CLT') {
    return {
      configurado: true,
      aplicavel: false,
      status: 'nao_aplicavel',
      rotulo: 'Sem encargos CLT',
      salarioBase,
      inssValor: 0,
      fgtsValor: 0,
      feriasValor: 0,
      decimoTerceiroValor: 0,
      encargosMensais: 0,
      provisoesMensais: 0,
      custoTotalMensal: salarioBase,
    };
  }

  if (!isParametrosEncargosVigente(parametros, dataReferencia)) {
    return {
      configurado: false,
      aplicavel: true,
      status: 'nao_configurado',
      rotulo: 'não configurado',
      salarioBase,
      inssValor: null,
      fgtsValor: null,
      feriasValor: null,
      decimoTerceiroValor: null,
      encargosMensais: null,
      provisoesMensais: null,
      custoTotalMensal: null,
    };
  }

  const inssValor = roundCents(salarioBase * (parametros.inssPct / 100));
  const fgtsValor = roundCents(salarioBase * (parametros.fgtsPct / 100));
  const feriasValor = roundCents(salarioBase * (parametros.feriasPct / 100));
  const decimoTerceiroValor = roundCents(
    salarioBase * (parametros.decimoTerceiroPct / 100),
  );

  const encargosMensais = roundCents(inssValor + fgtsValor);
  const provisoesMensais = roundCents(feriasValor + decimoTerceiroValor);
  const custoTotalMensal = roundCents(
    salarioBase + encargosMensais + provisoesMensais,
  );

  return {
    configurado: true,
    aplicavel: true,
    status: 'configurado',
    rotulo: 'Configurado',
    salarioBase,
    inssValor,
    fgtsValor,
    feriasValor,
    decimoTerceiroValor,
    encargosMensais,
    provisoesMensais,
    custoTotalMensal,
  };
}

export interface ResumoFolhaEquipe {
  totalColaboradores: number;
  cltCount: number;
  outrosCount: number;
  recorrentesNaoCltCount: number;
  configurado: boolean;
  rotuloStatus: string;
  cltSalarioBase: number;
  outrosSalarioBase: number;
  cltCustoTotal: number | null;
  folhaBase: number;
  encargosMensais: number | null;
  provisoesMensais: number | null;
  custoTotalMensal: number | null;
}

export function resumoFolhaEquipe(
  colaboradores: Array<Pick<ColaboradorRecord, 'vinculo' | 'salarioBase' | 'paymentFrequency'>>,
  parametros: TaxChargeParameters | null | undefined,
  dataReferencia?: string,
): ResumoFolhaEquipe {
  if (colaboradores.length === 0) {
    return {
      totalColaboradores: 0,
      cltCount: 0,
      outrosCount: 0,
      recorrentesNaoCltCount: 0,
      configurado: isParametrosEncargosVigente(parametros, dataReferencia),
      rotuloStatus: 'Sem dados',
      cltSalarioBase: 0,
      outrosSalarioBase: 0,
      cltCustoTotal: 0,
      folhaBase: 0,
      encargosMensais: 0,
      provisoesMensais: 0,
      custoTotalMensal: 0,
    };
  }

  let cltCount = 0;
  let outrosCount = 0;
  let recorrentesNaoCltCount = 0;
  let cltSalarioBase = 0;
  let outrosSalarioBase = 0;
  let folhaBase = 0;
  let encargosSum = 0;
  let provisoesSum = 0;
  let hasUnconfiguredClt = false;

  for (const colab of colaboradores) {
    const res = calcularEncargos(colab, parametros, dataReferencia);
    folhaBase += res.salarioBase;
    if (colab.vinculo === 'CLT') {
      cltCount++;
      cltSalarioBase += res.salarioBase;
    } else {
      outrosCount++;
      outrosSalarioBase += res.salarioBase;
      if ((colab.vinculo === 'Autônomo' || colab.vinculo === 'PJ') && colab.paymentFrequency !== 'oneOff' && res.salarioBase > 0) {
        recorrentesNaoCltCount++;
      }
    }

    if (res.status === 'nao_configurado') {
      hasUnconfiguredClt = true;
    } else {
      encargosSum += res.encargosMensais ?? 0;
      provisoesSum += res.provisoesMensais ?? 0;
    }
  }

  if (hasUnconfiguredClt) {
    return {
      totalColaboradores: colaboradores.length,
      cltCount,
      outrosCount,
      recorrentesNaoCltCount,
      configurado: false,
      rotuloStatus: 'não configurado',
      cltSalarioBase: roundCents(cltSalarioBase),
      outrosSalarioBase: roundCents(outrosSalarioBase),
      cltCustoTotal: null,
      folhaBase: roundCents(folhaBase),
      encargosMensais: null,
      provisoesMensais: null,
      custoTotalMensal: null,
    };
  }

  const encargosMensais = roundCents(encargosSum);
  const provisoesMensais = roundCents(provisoesSum);
  const cltBaseRounded = roundCents(cltSalarioBase);

  return {
    totalColaboradores: colaboradores.length,
    cltCount,
    outrosCount,
    recorrentesNaoCltCount,
    configurado: true,
    rotuloStatus: 'Configurado',
    cltSalarioBase: cltBaseRounded,
    outrosSalarioBase: roundCents(outrosSalarioBase),
    cltCustoTotal: roundCents(cltBaseRounded + encargosMensais + provisoesMensais),
    folhaBase: roundCents(folhaBase),
    encargosMensais,
    provisoesMensais,
    custoTotalMensal: roundCents(folhaBase + encargosMensais + provisoesMensais),
  };
}

export interface StatusValidadeSst {
  label: string;
  expiredOrSoon: boolean;
}

export function avaliarValidadeSst(
  dateStr: string | undefined,
  dataReferencia: string,
): StatusValidadeSst {
  if (!dateStr || !dateStr.trim()) {
    return { label: 'Não informado', expiredOrSoon: false };
  }
  const days = diffDaysISO(dateStr.trim().slice(0, 10), dataReferencia);
  if (days === null) {
    return { label: formatDateBR(dateStr), expiredOrSoon: false };
  }
  if (days < 0) {
    return { label: 'Vencido', expiredOrSoon: true };
  }
  if (days <= 45) {
    return { label: `Vence em ${days}d`, expiredOrSoon: true };
  }
  return { label: formatDateBR(dateStr), expiredOrSoon: false };
}

export function contarPendenciasSegurancaEquipe(
  colaboradores: Array<
    Pick<
      ColaboradorRecord,
      'asoValidade' | 'nr18Validade' | 'nr35Validade' | 'statusEpi'
    >
  >,
  dataReferencia: string,
): number {
  let count = 0;
  for (const colab of colaboradores) {
    if (avaliarValidadeSst(colab.asoValidade, dataReferencia).expiredOrSoon) count++;
    if (avaliarValidadeSst(colab.nr18Validade, dataReferencia).expiredOrSoon) count++;
    if (avaliarValidadeSst(colab.nr35Validade, dataReferencia).expiredOrSoon) count++;
    if (colab.statusEpi !== 'Em dia') count++;
  }
  return count;
}

export function onboardingDeadline(start: string | undefined, hireDate: string | undefined): string | null {
  const date = start || hireDate;
  return date && isValidISODate(date) ? addDaysISO(date, 7) : null;
}

export function getOnboardingAlert(start: string | undefined, hireDate: string | undefined, status: string, today: string) {
  if (status === 'Concluída') return null;
  const deadline = onboardingDeadline(start, hireDate);
  if (!deadline) return null;
  return deadline < today ? 'Integração em atraso' : 'Integração até ' + formatDateBR(deadline);
}
