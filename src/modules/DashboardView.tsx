import { AlertNote, Button, KpiCard, PageHeader, ProgressBar, StatusBadge } from '../components/ui/PilotisUI';
import {
  calcularPainelDashboard, formatBRL, formatDateBR, formatMonthLabelBR, formatPercentBR, monthKey,
  type AlertaDominio, type MesPrevisaoCaixa,
} from '../domain';
import type { ModuleKey, PilotisDataState } from '../types/pilotis';

type Navigate = (module: ModuleKey, subTab?: string, params?: Record<string, string>) => void;
type Dashboard = ReturnType<typeof calcularPainelDashboard>;

const panel = 'grid min-w-0 content-start gap-4 rounded-xl border border-[#E4E1DA] bg-white p-4 sm:p-5';
const heading = 'text-base font-semibold text-[#14181F]';
const muted = 'text-sm text-[#5B6472]';
const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F3A5F]';

const series = [
  { key: 'contratadoEntradas', label: 'Entradas contratadas', color: 'bg-[#1F3A5F]' },
  { key: 'realizadoEntradas', label: 'Entradas realizadas', color: 'bg-[#577393]' },
  { key: 'funilPonderadoEntradas', label: 'Funil ponderado', color: 'border border-[#2455A4] bg-[#E6EEFB]' },
  { key: 'saidasTotais', label: 'Saídas totais', color: 'bg-[#9A6212]' },
] as const;

function GettingStarted({ canConfirmQuote, onNavigate }: { canConfirmQuote: boolean; onNavigate: Navigate }) {
  const steps = [
    { title: 'Importar a planilha financeira', label: 'Importar', route: 'settings', tab: 'Importar dados' },
    { title: 'Cadastrar a equipe e os vínculos', label: 'Cadastrar equipe', route: 'team', tab: 'Cadastro' },
    { title: 'Registrar clientes e orçamentos', label: 'Abrir orçamentos', route: 'clients', tab: 'Orçamentos' },
    { title: 'Confirmar o primeiro orçamento e abrir a obra', label: 'Escolher orçamento', route: 'clients', tab: 'Orçamentos' },
  ] as const;
  return (
    <section className={panel + ' justify-items-center sm:px-8 sm:py-9'} aria-labelledby="dashboard-start-title">
      <div className="grid gap-1 text-center">
        <h2 id="dashboard-start-title" className="text-lg font-semibold text-[#14181F]">Comece com os dados reais da empresa</h2>
        <p className={muted}>Os indicadores são calculados a partir dos registros dos módulos.</p>
      </div>
      <ol className="grid w-full max-w-2xl gap-2">
        {steps.map((step, index) => {
          const blocked = index === 3 && !canConfirmQuote;
          return <li key={step.title} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E4E1DA] p-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#F0EEE9] text-xs text-[#5B6472]" aria-hidden="true">{index + 1}</span>
              {step.title}
            </span>
            {blocked ? <span className="pl-8 text-xs text-[#5B6472]">Aguardando orçamento</span>
              : <Button size="sm" variant="secondary" className={focus} onClick={() => onNavigate(step.route, step.tab)}>{step.label}</Button>}
          </li>;
        })}
      </ol>
    </section>
  );
}

function CashForecast({ projection }: { projection: MesPrevisaoCaixa[] }) {
  const max = Math.max(1, ...projection.flatMap((month) => series.map(({ key }) => month[key])));
  const negative = projection.filter((month) => month.negativo);
  return (
    <section className={panel + ' lg:col-span-2'} aria-labelledby="dashboard-cash-title">
      <h2 className={heading} id="dashboard-cash-title">Previsão de caixa · próximos 5 meses</h2>
      {!projection.length ? <p className={muted}>Sem dados para projetar o caixa.</p> : <>
        <ul className="hidden flex-wrap gap-x-4 gap-y-2 text-xs text-[#5B6472] md:flex">
          {series.map(({ key, label, color }) => <li key={key} className="flex items-center gap-1.5">
            <span className={'h-2.5 w-2.5 rounded-sm ' + color} aria-hidden="true" />{label}
          </li>)}
        </ul>

        <div className="hidden grid-cols-5 gap-2 border-b border-[#E4E1DA] pb-2 md:grid" aria-hidden="true">
          {projection.map((month) => <div key={month.mesKey} className="grid min-w-0 content-end justify-items-center gap-1">
            <div className="flex h-32 w-full max-w-28 items-end justify-center gap-1">
              {series.map(({ key, color }) => <span key={key} className={'w-1/5 rounded-t ' + color}
                style={{ height: month[key] > 0 ? Math.max(3, (month[key] / max) * 128) : 0 }} />)}
            </div>
            <span className="text-xs font-semibold text-[#14181F]">{month.rotulo}</span>
          </div>)}
        </div>

        <details className="hidden min-w-0 text-sm md:block">
          <summary className={'w-fit cursor-pointer font-semibold text-[#1F3A5F] ' + focus}>Ver valores por mês</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-right text-xs tabular-nums">
              <caption className="sr-only">Valores da previsão de caixa por mês</caption>
              <thead className="text-[#5B6472]"><tr>
                <th className="p-2 text-left" scope="col">Mês</th>
                {series.map(({ key, label }) => <th key={key} className="p-2" scope="col">{label}</th>)}
                <th className="p-2" scope="col">Saldo projetado</th>
              </tr></thead>
              <tbody>
                {projection.map((month) => <tr key={month.mesKey} className="border-t border-[#E4E1DA]">
                  <th className="whitespace-nowrap p-2 text-left" scope="row">{month.rotulo}</th>
                  {series.map(({ key }) => <td key={key} className="whitespace-nowrap p-2">{formatBRL(month[key])}</td>)}
                  <td className={'whitespace-nowrap p-2 font-semibold ' + (month.negativo ? 'text-[#B42318]' : '')}>
                    {formatBRL(month.saldoProjetado)}
                    {month.negativo && <span className="block">Negativo</span>}
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </details>

        <ul className="grid gap-2 md:hidden" aria-label="Valores por mês">
          {projection.map((month) => <li key={month.mesKey} className="grid gap-2 rounded-lg border border-[#E4E1DA] px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <strong className="text-sm">{month.rotulo}</strong>
              {month.negativo && <StatusBadge tone="bad" label="Saldo negativo" />}
            </div>
            <dl className="grid gap-1 text-xs tabular-nums">
              {series.map(({ key, label }) => <div key={key} className="flex justify-between gap-2">
                <dt className="text-[#5B6472]">{label}</dt><dd>{formatBRL(month[key])}</dd>
              </div>)}
              <div className="flex justify-between gap-2 border-t border-[#E4E1DA] pt-1 font-semibold">
                <dt>Saldo projetado</dt><dd>{formatBRL(month.saldoProjetado)}</dd>
              </div>
            </dl>
          </li>)}
        </ul>

        {negative.length > 0 && (
          <AlertNote tone="warn" title="Saldo projetado negativo">
            {negative.map((month) => month.rotulo + ' (' + formatBRL(month.saldoProjetado) + ')').join(' · ')}
          </AlertNote>
        )}
      </>}
    </section>
  );
}

function alertDestination(alert: AlertaDominio) {
  switch (alert.categoria) {
    case 'caixa': return 'Fluxo de caixa';
    case 'tributo': return alert.id.startsWith('tax-debt-') ? 'Dívidas e crédito' : 'A pagar';
    case 'certidao': return 'Certidões';
    case 'garantia': return 'Pós-obra';
    case 'material': return 'Materiais do cliente';
    case 'treinamento': return 'Segurança e capacitação';
    case 'vencimento':
      if (alert.modulo === 'compliance') return 'Obrigações';
      return alert.id.startsWith('parcela-') ? 'A receber' : 'A pagar';
    default: return undefined;
  }
}

export function DashboardView({
  data, onNavigate, onOpenProject, onOpenNewTransaction, onOpenNewQuote, companyEmail,
}: {
  data: PilotisDataState;
  onNavigate: Navigate;
  onOpenProject: (projectId: string) => void;
  onOpenNewTransaction: () => void;
  onOpenNewQuote: () => void;
  companyEmail?: string | null;
}) {
  const { metrics, referenceDate, isEmpty, canConfirmQuote, projection, currentMonthBalance, alerts, work, openQuotes, funnel, coverage }: Dashboard = calcularPainelDashboard(data);
  const uncovered = coverage.filter((month) => month.status === 'uncovered');
  const uncertain = coverage.filter((month) => month.status === 'unknown');

  return (
    <div className="grid gap-5">
      <PageHeader title="Dashboard" subtitle={isEmpty ? 'Visão geral da empresa' : 'Visão geral da empresa · ' + formatMonthLabelBR(monthKey(referenceDate))}
        companyEmail={companyEmail} actions={<>
          <Button variant="secondary" className={focus} onClick={isEmpty ? () => onNavigate('settings', 'Importar dados') : onOpenNewTransaction}>
            {isEmpty ? 'Importar planilha' : 'Registrar lançamento'}
          </Button>
          <Button className={focus} onClick={onOpenNewQuote}>Novo orçamento</Button>
        </>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Saldo de caixa" value={formatBRL(metrics.saldoRealizadoCaixa)}
          subtext={currentMonthBalance === null ? 'Registre o primeiro lançamento' : 'Previsto para o fim do mês · ' + formatBRL(currentMonthBalance)} />
        <KpiCard label="A receber (30 dias)" value={formatBRL(metrics.aReceber30Dias)}
          subtext={metrics.aReceber30Dias === null ? 'Confirme um orçamento' : metrics.aReceber30Qtd + ' recebível(is) · ' + metrics.aReceberAtrasoQtd + ' em atraso'} />
        <KpiCard label="Resultado do mês" value={formatBRL(metrics.resultadoMes)}
          subtext={metrics.resultadoMes === null ? 'Sem movimento realizado no mês' : 'Receitas e despesas realizadas'} />
        <KpiCard label="Obras ativas" value={metrics.obrasAtivasQtd?.toString()}
          subtext={metrics.obrasAtivasQtd === null ? 'Nenhuma obra cadastrada' : 'Obras contratadas ou em execução'} />
      </div>

      {data.projects.length === 0 && <GettingStarted canConfirmQuote={canConfirmQuote} onNavigate={onNavigate} />}

      {!isEmpty && <>
        <div className="grid gap-4 lg:grid-cols-3">
          <CashForecast projection={projection} />
          <section className={panel} aria-labelledby="dashboard-alerts-title">
            <h2 id="dashboard-alerts-title" className={heading}>Alertas</h2>
            {alerts.length === 0 ? <p className={muted}>Nenhum alerta nos registros atuais.</p>
              : <ul className="grid gap-1">
                {alerts.map((alert) => <li key={alert.id}>
                  <button type="button" className={'flex w-full flex-wrap items-start gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[#F6F5F2] ' + focus}
                    onClick={() => onNavigate(alert.modulo, alertDestination(alert), alert.obraId
                      ? { 'planning.obra': alert.obraId, registro: alert.referenciaId ?? '' } : undefined)}>
                    <StatusBadge label={alert.nivel} /><span className="min-w-0 flex-1 break-words">{alert.mensagem}</span>
                  </button>
                </li>)}
              </ul>}
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className={panel} aria-labelledby="dashboard-work-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="dashboard-work-title" className={heading}>Andamento das obras</h2>
              <Button variant="text" size="sm" className={focus} onClick={() => onNavigate('planning')}>Ver obras</Button>
            </div>
            {work.length === 0 ? <p className={muted}>{data.projects.length ? 'Nenhuma obra ativa.' : 'Sem dados de obras.'}</p>
              : <ul className="grid gap-3">
                {work.map(({ project, progress, nextStage, completion, delayedStagesCount }) => <li key={project.id} className="grid gap-2 rounded-lg border border-[#E4E1DA] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                    <button type="button" className={'break-words text-left font-semibold text-[#1F3A5F] hover:underline ' + focus}
                      onClick={() => onOpenProject(project.id)}>{project.name}</button>
                    <div className="flex flex-wrap gap-1.5">
                      <StatusBadge label={project.status} />
                      {delayedStagesCount > 0 && <StatusBadge label={delayedStagesCount + (delayedStagesCount === 1 ? ' etapa atrasada' : ' etapas atrasadas')} tone="warn" />}
                    </div>
                  </div>
                  <div className="flex justify-between gap-2 text-xs"><span>Progresso</span><strong>{formatPercentBR(progress, 0)}</strong></div>
                  {progress !== null && <ProgressBar pct={progress} label={'Progresso de ' + project.name} />}
                  <p className="text-xs text-[#5B6472]">
                    {nextStage && <>Próxima etapa · {nextStage}<br /></>}
                    Entrega prevista · {formatDateBR(completion)}
                  </p>
                </li>)}
              </ul>}
          </section>

          <section className={panel} aria-labelledby="dashboard-portfolio-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="dashboard-portfolio-title" className={heading}>Carteira futura</h2>
              <Button variant="text" size="sm" className={focus} onClick={() => onNavigate('clients', 'Funil')}>Abrir funil</Button>
            </div>
            {openQuotes.length === 0 ? <p className={muted}>{data.quotes.length ? 'Nenhum orçamento em aberto.' : 'Sem dados de orçamentos.'}</p>
              : <>
                <p className={muted}>Valor dos orçamentos abertos · <strong className="text-[#14181F]">{formatBRL(funnel.valorFunil)}</strong></p>
                <ul className="grid gap-2">
                {openQuotes.slice(0, 5).map((quote) => <li key={quote.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-[#E4E1DA] pb-2 last:border-b-0">
                  <p className="min-w-0 flex-1 break-words text-sm font-medium">{quote.code && quote.code + ' · '}{quote.title}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={quote.status} /><strong className="text-sm tabular-nums">{formatBRL(quote.totalValue)}</strong>
                  </div>
                </li>)}
                </ul>
              </>}
            {coverage.length > 0 && <div className="grid gap-2 border-t border-[#E4E1DA] pt-3">
              <h3 className="text-sm font-semibold">Cobertura por mês</h3>
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {coverage.map((month) => <li key={month.key}><StatusBadge
                  tone={month.status === 'covered' ? 'ok' : month.status === 'unknown' ? 'warn' : 'bad'}
                  label={month.label + ' · ' + (month.status === 'covered' ? 'Com obra' : month.status === 'unknown' ? 'Prazo a confirmar' : 'Sem obra')} /></li>)}
              </ul>
              {uncovered.length > 0 && <p className="text-sm font-semibold text-[#B42318]">Meses sem obra contratada · {uncovered.map((month) => month.label).join(', ')}</p>}
              {uncertain.length > 0 && <p className={muted}>Há obras com datas insuficientes para confirmar a cobertura dos meses sinalizados.</p>}
            </div>}
          </section>
        </div>
      </>}
    </div>
  );
}
