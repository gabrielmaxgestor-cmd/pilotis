import { AlertNote, KpiCard, PageHeader, ProgressBar, StatusBadge } from '../components/ui/PilotisUI';
import type { ModuleKey, PilotisDataState } from '../types/pilotis';
import {
  calcularAlertasSistema,
  calcularIndicadoresDashboard,
  calcularPrevisaoCaixa,
  calcularProgressoObra,
  formatBRL,
  formatBRLCompact,
} from '../domain';

export function DashboardView({
  data,
  onNavigate,
  onOpenNewTransaction,
  onOpenNewQuote,
  companyEmail,
}: {
  data: PilotisDataState;
  onNavigate: (mod: ModuleKey, subTab?: string) => void;
  onOpenNewTransaction: () => void;
  onOpenNewQuote: () => void;
  companyEmail?: string | null;
}) {
  const metrics = calcularIndicadoresDashboard(data);
  const empty = metrics.sistemaVazio;
  const forecast = calcularPrevisaoCaixa(data, 5);
  const projection = forecast.possuiDados ? forecast.meses : [];
  const alerts = calcularAlertasSistema(data);

  const openQuotes = data.quotes.filter(
    (q) => q.status === 'Enviado' || q.status === 'Em negociação' || q.status === 'Rascunho'
  );

  const maxChartVal = Math.max(
    1,
    ...projection.map((p) =>
      Math.max(p.realizadoEntradas + p.contratadoEntradas, p.saidasTotais, p.funilPonderadoEntradas)
    )
  );

  if (empty) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Dashboard"
          subtitle="Visão geral da empresa"
          companyEmail={companyEmail}
          actions={
            <>
              <button
                type="button"
                onClick={() => onNavigate('settings', 'Importar dados')}
                className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] whitespace-nowrap shrink-0 cursor-pointer"
              >
                Importar planilha
              </button>
              <button
                type="button"
                onClick={onOpenNewQuote}
                className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] whitespace-nowrap shrink-0 cursor-pointer"
              >
                Novo orçamento
              </button>
            </>
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Saldo de caixa"
            value="Sem dados"
            subtext="Registre o primeiro lançamento"
            isEmpty
          />
          <KpiCard
            label="A receber (30 dias)"
            value="Sem dados"
            subtext="Confirme um orçamento"
            isEmpty
          />
          <KpiCard
            label="Resultado do mês"
            value="Sem dados"
            subtext="Depende dos lançamentos"
            isEmpty
          />
          <KpiCard
            label="Obras ativas"
            value="Sem dados"
            subtext="Nenhuma obra cadastrada"
            isEmpty
          />
        </div>

        <section className="bg-white border border-[#E4E1DA] rounded-xl p-8 md:p-12 flex flex-col items-center text-center gap-4">
          <h2 className="text-xl font-bold text-[#14181F]">
            Comece cadastrando os dados reais da empresa
          </h2>
          <p className="text-sm text-[#5B6472] max-w-xl">
            Nada aqui é de exemplo. Cada indicador será calculado automaticamente a partir do que você cadastrar ou importar.
          </p>

          <div className="w-full max-w-xl flex flex-col gap-2.5 text-left mt-2">
            <div className="flex items-center justify-between gap-3 border border-[#E4E1DA] rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-[#F0EEE9] text-[#5B6472] text-xs font-bold grid place-items-center shrink-0">
                  1
                </span>
                <span className="text-sm font-medium text-[#14181F]">
                  Importar a planilha financeira atual
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('settings', 'Importar dados')}
                className="px-3.5 py-1.5 rounded-lg border border-[#E4E1DA] bg-white text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] whitespace-nowrap cursor-pointer"
              >
                Importar
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 border border-[#E4E1DA] rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-[#F0EEE9] text-[#5B6472] text-xs font-bold grid place-items-center shrink-0">
                  2
                </span>
                <span className="text-sm font-medium text-[#14181F]">
                  Cadastrar a equipe e os vínculos
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('team')}
                className="px-3.5 py-1.5 rounded-lg border border-[#E4E1DA] bg-white text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] whitespace-nowrap cursor-pointer"
              >
                Cadastrar
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 border border-[#E4E1DA] rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-[#F0EEE9] text-[#5B6472] text-xs font-bold grid place-items-center shrink-0">
                  3
                </span>
                <span className="text-sm font-medium text-[#14181F]">
                  Registrar clientes e orçamentos
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('clients')}
                className="px-3.5 py-1.5 rounded-lg border border-[#E4E1DA] bg-white text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] whitespace-nowrap cursor-pointer"
              >
                Cadastrar
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 border border-[#E4E1DA] rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-[#F0EEE9] text-[#5B6472] text-xs font-bold grid place-items-center shrink-0">
                  4
                </span>
                <span className="text-sm font-medium text-[#14181F]">
                  Confirmar o primeiro orçamento e abrir a obra
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('clients')}
                disabled={data.quotes.length === 0}
                className="px-3.5 py-1.5 rounded-lg border border-[#E4E1DA] bg-white text-xs font-semibold text-[#5B6472] disabled:opacity-50 whitespace-nowrap"
              >
                Aguardando passo 3
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral da empresa com dados reais integrados"
        companyEmail={companyEmail}
        actions={
          <>
            <button
              type="button"
              onClick={onOpenNewTransaction}
              className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Registrar lançamento
            </button>
            <button
              type="button"
              onClick={onOpenNewQuote}
              className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Novo orçamento
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Saldo de caixa"
          value={formatBRL(metrics.saldoRealizadoCaixa)}
          subtext={
            metrics.saldoPrevistoFimMes !== null
              ? `Previsto fim do mês: ${formatBRL(metrics.saldoPrevistoFimMes)}`
              : 'Registre lançamentos realizados'
          }
          isEmpty={metrics.saldoRealizadoCaixa === null}
        />
        <KpiCard
          label="A receber (30 dias)"
          value={formatBRL(metrics.aReceber30Dias)}
          subtext={
            metrics.aReceber30Dias !== null
              ? `${metrics.aReceber30Qtd} parcela(s) · ${metrics.aReceberAtrasoQtd} em atraso`
              : 'Sem parcelas cadastradas'
          }
          isEmpty={metrics.aReceber30Dias === null}
        />
        <KpiCard
          label="Resultado do mês"
          value={formatBRL(metrics.resultadoMes)}
          subtext={
            metrics.margemMediaObrasPct !== null
              ? `Margem média das obras: ${metrics.margemMediaObrasPct}%`
              : 'Sem lançamentos no mês atual'
          }
          isEmpty={metrics.resultadoMes === null}
        />
        <KpiCard
          label="Obras ativas"
          value={metrics.obrasAtivasQtd !== null ? String(metrics.obrasAtivasQtd) : 'Sem dados'}
          subtext={`${metrics.orcamentosEmAbertoQtd} orçamento(s) em aberto`}
          isEmpty={metrics.obrasAtivasQtd === null}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[#14181F]">
              Previsão de caixa · próximos 5 meses
            </h2>
            <StatusBadge label="Realizado separado do previsto" tone="info" />
          </div>

          {projection.length === 0 ? (
            <p className="text-sm text-[#5B6472] py-8 text-center">
              Sem dados suficientes para projeção de caixa.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-4 text-xs text-[#5B6472]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#1F3A5F]" /> Entradas (realizado + contratado)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#9A6212]" /> Saídas + folha
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#E6EEFB] border border-[#2455A4]" /> Previsto ponderado pelo funil
                </span>
              </div>

              <div className="grid grid-cols-5 gap-3 items-end h-48 pt-4 pb-2 border-b border-[#E4E1DA]">
                {projection.map((pt) => {
                  const inTotal = pt.realizadoEntradas + pt.contratadoEntradas;
                  const hIn = Math.max(4, Math.round((inTotal / maxChartVal) * 140));
                  const hOut = Math.max(4, Math.round((pt.saidasTotais / maxChartVal) * 140));
                  const hFun =
                    pt.funilPonderadoEntradas > 0
                      ? Math.max(4, Math.round((pt.funilPonderadoEntradas / maxChartVal) * 140))
                      : 0;
                  return (
                    <div key={pt.mesKey} className="flex flex-col items-center gap-2">
                      <div className="flex items-end gap-1.5 h-36">
                        <div
                          className="w-4 md:w-6 rounded-t bg-[#1F3A5F]"
                          style={{ height: `${inTotal > 0 ? hIn : 2}px` }}
                          title={`Entradas: ${formatBRL(inTotal)}`}
                        />
                        <div
                          className="w-4 md:w-6 rounded-t bg-[#9A6212]"
                          style={{ height: `${pt.saidasTotais > 0 ? hOut : 2}px` }}
                          title={`Saídas: ${formatBRL(pt.saidasTotais)}`}
                        />
                        {hFun > 0 && (
                          <div
                            className="w-4 md:w-6 rounded-t bg-[#E6EEFB] border border-[#2455A4]"
                            style={{ height: `${hFun}px` }}
                            title={`Funil ponderado: ${formatBRL(pt.funilPonderadoEntradas)}`}
                          />
                        )}
                      </div>
                      <span className="text-xs text-[#5B6472] font-medium">{pt.rotulo}</span>
                    </div>
                  );
                })}
              </div>

              {projection.some((p) => p.saldoProjetado < 0) && (
                <AlertNote tone="warn" title="Atenção ao fluxo futuro">
                  Sem novas contratações ou entrada de parcelas, o saldo projetado fica negativo nos meses futuros.
                </AlertNote>
              )}
            </>
          )}
        </section>

        <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
          <h2 className="text-base font-semibold text-[#14181F]">Alertas</h2>
          {alerts.length === 0 ? (
            <p className="text-sm text-[#5B6472] py-4">
              Nenhum alerta pendente com base nos registros atuais.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {alerts.map((al) => (
                <button
                  key={al.id}
                  type="button"
                  onClick={() => onNavigate(al.modulo)}
                  className="flex items-start gap-2.5 text-left p-2 -mx-2 rounded-lg hover:bg-[#F6F5F2] transition-colors cursor-pointer"
                >
                  <StatusBadge label={al.nivel} />
                  <span className="text-[13px] text-[#14181F] leading-snug">{al.mensagem}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#14181F]">Andamento das obras</h2>
            <button
              type="button"
              onClick={() => onNavigate('planning')}
              className="text-xs font-semibold text-[#1F3A5F] hover:underline cursor-pointer"
            >
              Ver todas
            </button>
          </div>
          {data.projects.length === 0 ? (
            <p className="text-sm text-[#5B6472]">Nenhuma obra cadastrada ainda.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {data.projects.slice(0, 4).map((proj) => {
                const prog = calcularProgressoObra(proj.id, data.stages);
                return (
                  <div key={proj.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <strong className="text-[#14181F] font-semibold truncate">{proj.name}</strong>
                      <span className="text-[#14181F] font-semibold tabular-nums">
                        {prog !== null ? `${prog}%` : 'Sem etapas'}
                      </span>
                    </div>
                    <ProgressBar pct={prog ?? 0} />
                    <span className="text-xs text-[#5B6472]">
                      {proj.status} · {proj.type} · cliente {proj.clientName || 'não informado'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#14181F]">Carteira futura (funil)</h2>
            <button
              type="button"
              onClick={() => onNavigate('clients')}
              className="text-xs font-semibold text-[#1F3A5F] hover:underline cursor-pointer"
            >
              Abrir funil
            </button>
          </div>
          {openQuotes.length === 0 ? (
            <p className="text-sm text-[#5B6472]">Nenhum orçamento aberto no funil comercial.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {openQuotes.slice(0, 5).map((q) => (
                <div
                  key={q.id}
                  className="flex items-center justify-between gap-3 py-1 border-b border-[#E4E1DA] last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#14181F] truncate">
                      {q.code} · {q.title}
                    </p>
                    <p className="text-xs text-[#5B6472]">{q.clientName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge label={q.status} />
                    <span className="text-sm font-semibold text-[#14181F] tabular-nums">
                      {formatBRLCompact(q.totalValue)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
