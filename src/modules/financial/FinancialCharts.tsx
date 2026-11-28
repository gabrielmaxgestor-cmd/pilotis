import { useId, type ReactNode } from 'react';
import type { PrevisaoCaixaResult, MesPrevisaoCaixa } from '../../domain/caixa';
import type { PaidExpenseComposition, ProjectDreChartRow } from '../../domain/financialCharts';
import { formatBRL, formatBRLCompact, formatMonthLabelBR, formatPercentBR } from '../../domain/formatters';

const ink = '#14181F';
const muted = '#424D5D';
const grid = '#D8DCE2';
const axis = '#627084';
const negative = '#B42318';
const blue = '#1F3A5F';
const bronze = '#945A0F';
const inputFill = '#E6EEFB';
const outputFill = '#F6E7CC';

type Swatch = { color: string; pattern?: 'diagonal' | 'dots' | 'cross'; background?: string };
type LegendItem = Swatch & { key: string; label: string; line?: boolean };
type CashKey = 'realizadoEntradas' | 'contratadoEntradas' | 'funilPonderadoEntradas' |
  'emprestimosNaoReceita' | 'saidasRealizadas' | 'saidasPrevistas';
type CashSeries = LegendItem & { key: CashKey };

const cashIncome: CashSeries[] = [
  { key: 'realizadoEntradas', label: 'Receita recebida', color: blue },
  { key: 'contratadoEntradas', label: 'Entradas contratadas', color: blue, pattern: 'diagonal', background: inputFill },
  { key: 'funilPonderadoEntradas', label: 'Funil ponderado', color: blue, pattern: 'dots', background: inputFill },
  { key: 'emprestimosNaoReceita', label: 'Crédito recebido', color: '#405268', pattern: 'cross', background: '#F0F3F7' },
];
const cashOutflow: CashSeries[] = [
  { key: 'saidasRealizadas', label: 'Saídas pagas', color: bronze },
  { key: 'saidasPrevistas', label: 'Saídas previstas', color: bronze, pattern: 'diagonal', background: outputFill },
];
const cashLegend: LegendItem[] = [...cashIncome, ...cashOutflow, { key: 'balance', label: 'Saldo projetado', color: ink, line: true }];
const dreLegend: LegendItem[] = [
  { key: 'budget', label: 'Orçado', color: blue, pattern: 'diagonal', background: inputFill },
  { key: 'actual', label: 'Realizado', color: bronze },
];
const expenseLegend: LegendItem[] = [{ key: 'paid', label: 'Despesas pagas', color: blue }];

function patternFill(id: string, item: LegendItem) {
  return item.pattern ? 'url(#' + id + '-' + item.key + ')' : item.color;
}

function PatternDefs({ id, items }: { id: string; items: LegendItem[] }) {
  return <defs>{items.filter((item) => item.pattern).map((item) =>
    <pattern key={item.key} id={id + '-' + item.key} width="7" height="7" patternUnits="userSpaceOnUse">
      <rect width="7" height="7" fill={item.background ?? '#FFFFFF'} />
      {item.pattern === 'dots' ? <circle cx="3.5" cy="3.5" r="1.2" fill={item.color} />
        : item.pattern === 'cross' ? <path d="M 0 3.5 H 7 M 3.5 0 V 7" stroke={item.color} strokeWidth="1.2" />
        : <path d="M -3 3 L 3 -3 M -1 8 L 8 -1 M 4 10 L 10 4" stroke={item.color} strokeWidth="1.25" />}
    </pattern>)}</defs>;
}

function ChartLegend({ id, items }: { id: string; items: LegendItem[] }) {
  return <ul aria-label="Legenda do gráfico" className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-[#424D5D]">
    {items.map((item) => <li key={item.key} className="inline-flex items-center gap-1.5">
      <svg aria-hidden="true" width="22" height="14" viewBox="0 0 22 14" focusable="false">
        {item.line
          ? <><path d="M 1 7 H 21" stroke={item.color} strokeWidth="2" /><circle cx="11" cy="7" r="3" fill="white" stroke={item.color} strokeWidth="2" /></>
          : <rect x="1" y="1" width="20" height="12" rx="1.5" fill={patternFill(id, item)} stroke={item.color} />}
      </svg>
      {item.label}
    </li>)}
  </ul>;
}

function ChartTable({ caption, labels, rows }: {
  caption: string; labels: string[]; rows: { key: string; label: string; values: string[] }[];
}) {
  return <details className="min-w-0 rounded-lg border border-[#E4E1DA] bg-[#FAFAF8]">
    <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-[#1F3A5F]">
      Ver dados em tabela
    </summary>
    <div role="region" aria-label={caption} tabIndex={0} className="max-w-full overflow-x-auto border-t border-[#E4E1DA]">
      <table className="w-full border-collapse bg-white text-left text-xs tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[#F0EEE9]">
          <tr>{labels.map((label) => <th key={label} scope="col" className="whitespace-nowrap px-3 py-2">{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => <tr key={row.key} className="border-t border-[#E4E1DA]">
            <th scope="row" className="whitespace-nowrap px-3 py-2 font-semibold">{row.label}</th>
            {row.values.map((value, index) => <td key={labels[index + 1]} className="whitespace-nowrap px-3 py-2">{value}</td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
  </details>;
}

function ChartFigure({ title, summary, children, legend, table }: {
  title: string; summary: string; children?: ReactNode; legend?: ReactNode; table?: ReactNode;
}) {
  const id = useId();
  return <figure aria-labelledby={id} className="grid min-w-0 gap-3">
    <figcaption>
      <h3 id={id} className="text-sm font-semibold text-[#14181F]">{title}</h3>
      <p className="mt-1 break-words text-sm text-[#424D5D]">{summary}</p>
    </figcaption>
    {children && <>
      {legend}
      <p className="text-xs text-[#424D5D] sm:hidden">Deslize para ver todo o gráfico.</p>
      <div role="region" aria-label={title + ' · área rolável'} tabIndex={0}
        className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-[#E4E1DA] bg-white">
        {children}
      </div>
      {table}
    </>}
  </figure>;
}

// Eixo comum com marcas legíveis e origem zero, inclusive para valores negativos.
function axisScale(values: number[]) {
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const rawStep = (maximum - minimum || 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = Math.max(0.01, ([1, 2, 2.5, 5, 10].find((value) => value >= rawStep / magnitude) ?? 10) * magnitude);
  const first = Math.floor(minimum / step);
  const last = Math.ceil(maximum / step) || (first === 0 ? 4 : 0);
  const ticks = Array.from({ length: last - first + 1 }, (_, index) =>
    Number(((first + index) * step).toPrecision(12)));
  const low = ticks[0];
  const high = ticks[ticks.length - 1];
  return { ticks, ratio: (value: number) => (value - low) / (high - low) };
}

function cashTotal(row: MesPrevisaoCaixa, series: CashSeries[]) {
  return series.reduce((total, item) => total + row[item.key], 0);
}

function CashPlot({ months, id }: { months: MesPrevisaoCaixa[]; id: string }) {
  const left = 112;
  const top = 20;
  const bottom = 224;
  const step = 112;
  const width = left + step * months.length + 12;
  const axisValues = axisScale(months.flatMap((row) => [
    cashTotal(row, cashIncome), row.saidasTotais, row.saldoProjetado,
  ]));
  const y = (value: number) => bottom - axisValues.ratio(value) * (bottom - top);
  const x = (index: number) => left + (index + 0.5) * step;
  return <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${width} 295`} className="block h-auto w-full" style={{ minWidth: width }}>
    <PatternDefs id={id} items={cashLegend} />
    {axisValues.ticks.map((tick) => <g key={tick}>
      <line x1={left} x2={width - 13} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? axis : grid} />
      <text x={left - 10} y={y(tick) + 4} fill={muted} textAnchor="end" fontSize="12">{formatBRLCompact(tick)}</text>
    </g>)}
    {months.map((row, index) => <g key={row.mesKey}>
      {[cashIncome, cashOutflow].map((series, group) => {
        let cumulative = 0;
        return <g key={group}>
          {series.map((item) => {
            const value = row[item.key];
            const lower = cumulative;
            cumulative += value;
            return value > 0 && <rect key={item.key} x={x(index) + (group === 0 ? -42 : 8)} y={y(cumulative)}
              width="34" height={y(lower) - y(cumulative)} fill={patternFill(id, item)} stroke={item.color}>
              <title>{row.rotulo + ' · ' + item.label + ' · ' + formatBRL(value)}</title>
            </rect>;
          })}
          <text x={x(index) + (group === 0 ? -25 : 25)} y={bottom + 17} textAnchor="middle" fontSize="10" fill={muted}>
            {group === 0 ? 'Entradas' : 'Saídas'}
          </text>
        </g>;
      })}
      <text x={x(index)} y={bottom + 36} textAnchor="middle" fontSize="12" fontWeight="600" fill={ink}>{row.rotulo}</text>
      {row.negativo && <text x={x(index)} y={bottom + 54} textAnchor="middle" fontSize="11" fontWeight="700" fill={negative}>Saldo negativo</text>}
    </g>)}
    <polyline points={months.map((row, index) => x(index) + ',' + y(row.saldoProjetado)).join(' ')}
      fill="none" stroke="white" strokeWidth="5" />
    <polyline points={months.map((row, index) => x(index) + ',' + y(row.saldoProjetado)).join(' ')}
      fill="none" stroke={ink} strokeWidth="2.5" />
    {months.map((row, index) => <g key={row.mesKey} transform={`translate(${x(index)} ${y(row.saldoProjetado)})`}>
      {row.negativo
        ? <path d="M 0 -6 L 6 0 L 0 6 L -6 0 Z" fill={negative} stroke="white" strokeWidth="1.5" />
        : <circle r="4.5" fill="white" stroke={ink} strokeWidth="2" />}
      <title>{row.rotulo + ' · Saldo projetado · ' + formatBRL(row.saldoProjetado)}</title>
    </g>)}
  </svg>;
}

export function CashFlowChart({ forecast }: { forecast: PrevisaoCaixaResult }) {
  const id = useId();
  const title = 'Entradas x saídas e saldo projetado';
  if (!forecast.possuiDados || !forecast.meses.length) return <ChartFigure title={title} summary="Sem dados" />;
  const monthLabels = forecast.mesesNegativos.map(formatMonthLabelBR);
  const summary = 'Ao fim do período, o saldo projetado é de ' + formatBRL(forecast.saldoFinalProjetado) + '. ' +
    (monthLabels.length ? 'Saldo negativo em ' + monthLabels.join(', ') + '.' : 'Saldo projetado positivo ou zerado em todos os meses.') +
    ' O impacto do funil no saldo está na tabela.';
  return <ChartFigure title={title} summary={summary} legend={<ChartLegend id={id} items={cashLegend} />}
    table={<ChartTable caption="Dados do gráfico de fluxo de caixa"
      labels={['Mês', ...cashIncome.map((item) => item.label), ...cashOutflow.map((item) => item.label),
        'Provisões incluídas', 'Saldo projetado', 'Saldo com funil', 'Situação do saldo']}
      rows={forecast.meses.map((row) => ({
        key: row.mesKey, label: row.rotulo,
        values: [...[...cashIncome, ...cashOutflow].map((item) => formatBRL(row[item.key])),
          formatBRL(row.provisoesFolhaIncluidas), formatBRL(row.saldoProjetado), formatBRL(row.saldoProjetadoComFunil),
          row.negativo ? 'Negativo' : row.saldoProjetado === 0 ? 'Zerado' : 'Positivo'],
      }))} />}>
    <CashPlot id={id} months={forecast.meses} />
  </ChartFigure>;
}

function HorizontalPlot({ id, items, rows, width, labelRoom }: {
  id: string; items: LegendItem[]; rows: { label: string; values: (number | null)[] }[]; width: number; labelRoom: number;
}) {
  const left = labelRoom;
  const right = width - 60;
  const step = items.length > 1 ? 48 : 39;
  const bottom = 12 + rows.length * step;
  const range = axisScale(rows.flatMap((row) => row.values.filter((value): value is number => value !== null)));
  const x = (value: number) => left + (right - left) * range.ratio(value);
  return <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${width} ${bottom + 30}`}
    className="block h-auto w-full" style={{ minWidth: width }}>
    <PatternDefs id={id} items={items} />
    {range.ticks.map((tick) => <g key={tick}>
      <line x1={x(tick)} x2={x(tick)} y1={10} y2={bottom} stroke={tick === 0 ? axis : grid} />
      <text x={x(tick)} y={bottom + 20} textAnchor="middle" fill={muted} fontSize="12">{formatBRLCompact(tick)}</text>
    </g>)}
    {rows.map((row, index) => <g key={row.label}>
      <text x="12" y={14 + (index + 0.5) * step} dominantBaseline="middle" fontSize="12" fill={ink}>{row.label}</text>
      {items.map((item, bar) => {
        const value = row.values[bar];
        if (value === null) return null;
        const y = 14 + index * step + (items.length === 1 ? 12 : 7 + bar * 17);
        const title = <title>{row.label + ' · ' + item.label + ' · ' + formatBRL(value)}</title>;
        return value === 0 ? <circle key={item.key} cx={x(0)} cy={y + 6} r="3.5" fill="white" stroke={item.color} strokeWidth="2">{title}</circle>
          : <rect key={item.key} x={Math.min(x(0), x(value))} y={y} width={Math.abs(x(value) - x(0))} height="12"
            fill={patternFill(id, item)} stroke={item.color}>{title}</rect>;
      })}
    </g>)}
  </svg>;
}

export function ProjectDreChart({ rows, projectName }: { rows: ProjectDreChartRow[]; projectName?: string }) {
  const id = useId();
  const title = 'Orçado x realizado por categoria';
  const result = rows.at(-1);
  const hasData = rows.some((row) => row.actual !== null || (row.budget !== null && row.budget !== 0));
  if (!hasData || !result) return <ChartFigure title={title} summary="Sem dados" />;
  return <ChartFigure title={title} summary={projectName + ' · Resultado orçado ' + formatBRL(result.budget) +
    ' · Resultado realizado ' + formatBRL(result.actual) + '.'} legend={<ChartLegend id={id} items={dreLegend} />}
    table={<ChartTable caption="Dados do gráfico de DRE por obra" labels={['Categoria', 'Orçado', 'Realizado']}
      rows={rows.map((row) => ({ key: row.label, label: row.label, values: [formatBRL(row.budget), formatBRL(row.actual)] }))} />}>
    <HorizontalPlot id={id} items={dreLegend} width={765} labelRoom={235}
      rows={rows.map((row) => ({ label: row.label, values: [row.budget, row.actual] }))} />
  </ChartFigure>;
}

export function ExpenseCompositionChart({ composition, period }: { composition: PaidExpenseComposition; period: string }) {
  const id = useId();
  const title = 'Composição das despesas pagas';
  if (!composition.hasData) return <ChartFigure title={title} summary="Sem dados" />;
  const summary = 'Total pago em ' + period + ' · ' + formatBRL(composition.total) + '. ' +
    composition.rows.map((row) => row.label + ' ' + formatBRL(row.amount)).join(' · ') + '.';
  return <ChartFigure title={title} summary={summary}
    table={<ChartTable caption="Dados do gráfico de composição das despesas pagas" labels={['Categoria', 'Valor pago', 'Participação']}
      rows={composition.rows.map((row) => ({
        key: row.key, label: row.label, values: [formatBRL(row.amount), formatPercentBR(row.percent, 1)],
      }))} />}>
    <HorizontalPlot id={id} items={expenseLegend} width={585} labelRoom={145}
      rows={composition.rows.map((row) => ({ label: row.label, values: [row.amount] }))} />
  </ChartFigure>;
}
