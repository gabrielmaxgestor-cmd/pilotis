import { roundCents } from './formatters';
import type { BaselineEtapaItem, BaselineRecord, EtapaRecord } from './types';

export interface CpmEtapaDetalhe {
  etapaId: string;
  nome: string;
  duracaoSemanas: number;
  inicioMaisCedo: number;
  terminoMaisCedo: number;
  inicioMaisTarde: number;
  terminoMaisTarde: number;
  folga: number;
  critica: boolean;
}

export interface CaminhoCriticoResult {
  cicloDetectado: boolean;
  nosEmCiclo: string[];
  duracaoTotal: number;
  etapasCriticas: string[];
  detalhes: CpmEtapaDetalhe[];
}

export function caminhoCritico(
  etapas: Array<
    Pick<
      EtapaRecord,
      'id' | 'nome' | 'semanaInicio' | 'duracaoSemanas' | 'dependencias' | 'marco'
    >
  >,
): CaminhoCriticoResult {
  if (etapas.length === 0) {
    return {
      cicloDetectado: false,
      nosEmCiclo: [],
      duracaoTotal: 0,
      etapasCriticas: [],
      detalhes: [],
    };
  }

  const byId = new Map(etapas.map((e) => [e.id, e]));

  // 1. Detecção de ciclos (DFS de 3 cores no grafo de dependências término-início)
  const color = new Map<string, 0 | 1 | 2>(); // 0=não visitado, 1=visitando, 2=concluído
  const nosEmCicloSet = new Set<string>();
  const stack: string[] = [];
  let cicloDetectado = false;

  const dfsCycle = (id: string) => {
    const state = color.get(id) ?? 0;
    if (state === 1) {
      cicloDetectado = true;
      const idx = stack.indexOf(id);
      if (idx >= 0) {
        for (let i = idx; i < stack.length; i++) {
          nosEmCicloSet.add(stack[i]);
        }
      } else {
        nosEmCicloSet.add(id);
      }
      return;
    }
    if (state === 2) return;

    color.set(id, 1);
    stack.push(id);
    const etapa = byId.get(id);
    for (const depId of etapa?.dependencias ?? []) {
      if (byId.has(depId)) {
        dfsCycle(depId);
      }
    }
    stack.pop();
    color.set(id, 2);
  };

  for (const e of etapas) {
    if ((color.get(e.id) ?? 0) === 0) {
      dfsCycle(e.id);
    }
  }

  if (cicloDetectado) {
    return {
      cicloDetectado: true,
      nosEmCiclo: Array.from(nosEmCicloSet),
      duracaoTotal: 0,
      etapasCriticas: [],
      detalhes: [],
    };
  }

  // 2. Ordenação topológica (predecessores antes dos sucessores)
  const visited = new Set<string>();
  const topoOrder: string[] = [];

  const dfsTopo = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const etapa = byId.get(id);
    for (const depId of etapa?.dependencias ?? []) {
      if (byId.has(depId)) {
        dfsTopo(depId);
      }
    }
    topoOrder.push(id);
  };

  for (const e of etapas) {
    dfsTopo(e.id);
  }

  // 3. Passagem direta (Forward pass)
  const esMap = new Map<string, number>();
  const efMap = new Map<string, number>();
  const successorsMap = new Map<string, string[]>();
  for (const e of etapas) {
    successorsMap.set(e.id, []);
  }
  for (const e of etapas) {
    for (const depId of e.dependencias ?? []) {
      if (byId.has(depId)) {
        successorsMap.get(depId)!.push(e.id);
      }
    }
  }

  let duracaoTotal = 0;
  for (const id of topoOrder) {
    const etapa = byId.get(id)!;
    const deps = (etapa.dependencias ?? []).filter((d) => byId.has(d));
    const maxPredEF = deps.reduce((m, depId) => Math.max(m, efMap.get(depId) ?? 0), 0);
    const es = Math.max(etapa.semanaInicio || 0, maxPredEF);
    const dur = Math.max(0, etapa.duracaoSemanas || 0);
    const ef = es + dur;
    esMap.set(id, es);
    efMap.set(id, ef);
    duracaoTotal = Math.max(duracaoTotal, ef);
  }

  // 4. Passagem reversa (Backward pass)
  const lsMap = new Map<string, number>();
  const lfMap = new Map<string, number>();

  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i];
    const etapa = byId.get(id)!;
    const dur = Math.max(0, etapa.duracaoSemanas || 0);
    const sucs = successorsMap.get(id) ?? [];
    const lf =
      sucs.length === 0
        ? duracaoTotal
        : sucs.reduce((m, sucId) => Math.min(m, lsMap.get(sucId) ?? duracaoTotal), duracaoTotal);
    const ls = lf - dur;
    lfMap.set(id, lf);
    lsMap.set(id, ls);
  }

  // 5. Folga e etapas críticas
  const detalhes: CpmEtapaDetalhe[] = [];
  const etapasCriticas: string[] = [];

  for (const etapa of etapas) {
    const es = esMap.get(etapa.id) ?? 0;
    const ef = efMap.get(etapa.id) ?? 0;
    const ls = lsMap.get(etapa.id) ?? 0;
    const lf = lfMap.get(etapa.id) ?? 0;
    const folga = roundCents(ls - es);
    const critica =
      Math.abs(folga) < 0.001 && (etapa.duracaoSemanas > 0 || etapa.marco);

    if (critica) {
      etapasCriticas.push(etapa.id);
    }

    detalhes.push({
      etapaId: etapa.id,
      nome: etapa.nome,
      duracaoSemanas: etapa.duracaoSemanas,
      inicioMaisCedo: es,
      terminoMaisCedo: ef,
      inicioMaisTarde: ls,
      terminoMaisTarde: lf,
      folga,
      critica,
    });
  }

  return {
    cicloDetectado: false,
    nosEmCiclo: [],
    duracaoTotal,
    etapasCriticas,
    detalhes,
  };
}

export interface PontoCurvaS {
  semana: number;
  planejadoPct: number;
  realizadoPct: number;
}

export interface CurvaSResult {
  possuiDados: boolean;
  semanaReferencia: number;
  progressoPlanejadoPct: number;
  progressoRealizadoPct: number;
  indicePrazo: number | null;
  statusPrazo: 'Adiantado' | 'No prazo' | 'Em atenção' | 'Atrasado' | 'Sem dados';
  pontos: PontoCurvaS[];
}

export function curvaS(
  etapas: Array<
    Pick<
      EtapaRecord,
      'id' | 'semanaInicio' | 'duracaoSemanas' | 'progressoPct' | 'custoOrcado' | 'marco'
    >
  >,
  baseline: BaselineRecord | BaselineEtapaItem[] | null | undefined,
  semanaReferencia?: number,
): CurvaSResult {
  const etapasAtivas = etapas.filter((e) => !e.marco || e.custoOrcado > 0 || e.duracaoSemanas > 0);
  if (etapasAtivas.length === 0) {
    return {
      possuiDados: false,
      semanaReferencia: semanaReferencia ?? 0,
      progressoPlanejadoPct: 0,
      progressoRealizadoPct: 0,
      indicePrazo: null,
      statusPrazo: 'Sem dados',
      pontos: [],
    };
  }

  const baselineItems: BaselineEtapaItem[] = Array.isArray(baseline)
    ? baseline
    : baseline?.etapas ?? [];
  const baselineById = new Map(baselineItems.map((b) => [b.etapaId, b]));

  let maxWeek = 0;
  let totalWeight = 0;

  const normalized = etapasAtivas.map((e) => {
    const b = baselineById.get(e.id);
    const start = b ? b.semanaInicioBaseline : e.semanaInicio;
    const dur = Math.max(0, b ? b.duracaoBaselineSemanas : e.duracaoSemanas);
    const weight = Math.max(
      1,
      b && b.custoOrcadoBaseline > 0
        ? b.custoOrcadoBaseline
        : e.custoOrcado > 0
        ? e.custoOrcado
        : dur || 1,
    );
    maxWeek = Math.max(maxWeek, start + dur, e.semanaInicio + e.duracaoSemanas);
    totalWeight += weight;

    return {
      id: e.id,
      baseStart: start,
      baseDur: dur,
      actualStart: e.semanaInicio,
      actualDur: Math.max(0, e.duracaoSemanas),
      progressPct: Math.min(100, Math.max(0, e.progressoPct || 0)),
      weight,
    };
  });

  const maxWeekInt = Math.max(1, Math.ceil(maxWeek));
  const refWeek =
    semanaReferencia !== undefined
      ? Math.max(0, Math.min(maxWeekInt, semanaReferencia))
      : maxWeekInt;

  const computePlannedAtWeek = (week: number): number => {
    let accWeight = 0;
    for (const st of normalized) {
      let ratio = 0;
      if (st.baseDur === 0) {
        ratio = week >= st.baseStart ? 1 : 0;
      } else if (week <= st.baseStart) {
        ratio = 0;
      } else if (week >= st.baseStart + st.baseDur) {
        ratio = 1;
      } else {
        ratio = (week - st.baseStart) / st.baseDur;
      }
      accWeight += st.weight * ratio;
    }
    return totalWeight > 0 ? roundCents((accWeight / totalWeight) * 100) : 0;
  };

  const computeRealizedAtWeek = (week: number): number => {
    let accWeight = 0;
    for (const st of normalized) {
      const doneRatio = st.progressPct / 100;
      let timeCoverage = 1;
      if (week < st.actualStart) {
        timeCoverage = 0;
      } else if (st.actualDur > 0 && week < st.actualStart + st.actualDur) {
        // Distribui proporcionalmente o progresso realizado dentro da janela executada até a semana
        const elapsedFraction = (week - st.actualStart) / st.actualDur;
        timeCoverage = Math.min(1, elapsedFraction / Math.max(doneRatio, 0.01));
      }
      accWeight += st.weight * doneRatio * timeCoverage;
    }
    return totalWeight > 0 ? roundCents((accWeight / totalWeight) * 100) : 0;
  };

  const pontos: PontoCurvaS[] = [];
  for (let w = 0; w <= maxWeekInt; w++) {
    pontos.push({
      semana: w,
      planejadoPct: computePlannedAtWeek(w),
      realizadoPct: computeRealizedAtWeek(w),
    });
  }

  const progressoPlanejadoPct = computePlannedAtWeek(refWeek);
  const progressoRealizadoPct = computeRealizedAtWeek(refWeek);
  const indicePrazo =
    progressoPlanejadoPct > 0
      ? roundCents(progressoRealizadoPct / progressoPlanejadoPct)
      : null;

  let statusPrazo: CurvaSResult['statusPrazo'] = 'Sem dados';
  if (indicePrazo !== null) {
    if (indicePrazo >= 1.05) statusPrazo = 'Adiantado';
    else if (indicePrazo >= 0.95) statusPrazo = 'No prazo';
    else if (indicePrazo >= 0.85) statusPrazo = 'Em atenção';
    else statusPrazo = 'Atrasado';
  }

  return {
    possuiDados: true,
    semanaReferencia: refWeek,
    progressoPlanejadoPct,
    progressoRealizadoPct,
    indicePrazo,
    statusPrazo,
    pontos,
  };
}
