import { useState } from 'react';
import { Send } from 'lucide-react';
import {
  AlertNote,
  PageHeader,
  SegmentedControl,
  StatusBadge,
} from '../components/ui/PilotisUI';
import type { ModuleKey, PilotisDataState } from '../types/pilotis';
import {
  computeCashFlowProjection,
  computeDashboardMetrics,
  computeDebtSummary,
  computeProjectDre,
  computeSystemAlerts,
  computeTeamPayrollSummary,
  computeTenderReadinessPct,
} from '../utils/calculations';

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  mode?: 'Analista' | 'Consultor';
  text: string;
  isWeeklySummary?: boolean;
}

const SUGGESTED_QUESTIONS = [
  'Quanto entra e sai nos próximos 5 meses?',
  'Quais certidões vencem este mês?',
  'Qual o custo real e margem de cada obra?',
  'Quem está sem obra alocada atualmente?',
];

export function OperationalAiView({
  data,
  onNavigate,
  companyEmail,
}: {
  data: PilotisDataState;
  onNavigate: (mod: ModuleKey) => void;
  companyEmail?: string | null;
}) {
  const [mode, setMode] = useState<'Analista' | 'Consultor'>('Analista');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const alerts = computeSystemAlerts(data);

  function buildContextSnapshot() {
    const metrics = computeDashboardMetrics(data);
    const projection = computeCashFlowProjection(data, 5);
    const payroll = computeTeamPayrollSummary(data.employees, data.settings);
    const debtSummary = computeDebtSummary(data.debts);

    return {
      resumoExecutivo: metrics,
      fluxoCaixaProjetado5Meses: projection,
      folhaEquipe: payroll,
      dividasResumo: debtSummary,
      obras: data.projects.map((p) => ({
        nome: p.name,
        tipo: p.type,
        status: p.status,
        valorContrato: p.contractValue,
        dre: computeProjectDre(p, data.transactions),
      })),
      etapasEmAndamentoOuAtrasadas: data.stages
        .filter((s) => s.status !== 'Concluída' || s.delayJustification)
        .slice(0, 40)
        .map((s) => ({
          obraId: s.projectId,
          codigo: s.wbsCode,
          etapa: s.name,
          status: s.status,
          progressoPct: s.progressPct,
          atrasoCategoria: s.delayCategory,
          atrasoJustificativa: s.delayJustification,
        })),
      orcamentosAbertos: data.quotes
        .filter((q) => q.status !== 'Descartado')
        .slice(0, 25)
        .map((q) => ({
          codigo: q.code,
          cliente: q.clientName,
          valor: q.totalValue,
          probabilidadePct: q.probabilityPct,
          status: q.status,
        })),
      colaboradoresResumo: data.employees.map((e) => ({
        nome: e.name,
        funcao: e.role,
        vinculo: e.employmentType,
        obraAtual: e.currentProjectName || 'Sem alocação',
        asoValidade: e.asoExpiry,
        nr18Validade: e.nr18Expiry,
        nr35Validade: e.nr35Expiry,
      })),
      conformidade: data.complianceItems.slice(0, 30).map((c) => ({
        tipo: c.kind,
        titulo: c.title,
        vencimento: c.dueDate,
        status: c.status,
        obra: c.projectName,
      })),
      prontidaoLicitacoesPct: computeTenderReadinessPct(data.complianceItems),
      recebimentosSemNota: data.transactions
        .filter((t) => t.entryKind === 'income' && t.invoiceStatus === 'Não emitida')
        .map((t) => ({
          descricao: t.description,
          valor: t.amount,
          vencimento: t.dueDate || t.date,
        })),
    };
  }

  async function askAi(questionText: string, isWeeklySummary = false) {
    if (loading) return;
    setErrorMsg(null);

    if (!isWeeklySummary && !questionText.trim()) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      sender: 'user',
      text: isWeeklySummary ? 'Gerar resumo semanal operacional' : questionText.trim(),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!isWeeklySummary) setInput('');
    setLoading(true);

    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          question: questionText.trim(),
          isWeeklySummary,
          contextSnapshot: buildContextSnapshot(),
        }),
      });
      const payload = (await resp.json()) as { answer?: string; error?: string };
      if (!resp.ok || !payload.answer) {
        throw new Error(payload.error || 'Não foi possível obter resposta da IA.');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          sender: 'ai',
          mode,
          text: payload.answer!,
          isWeeklySummary,
        },
      ]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao consultar IA Operacional.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="IA Operacional"
        subtitle="Respostas baseadas exclusivamente nos dados reais registrados no sistema"
        companyEmail={companyEmail}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              items={['Analista', 'Consultor']}
              active={mode}
              onChange={(m) => setMode(m as 'Analista' | 'Consultor')}
            />
            <button
              type="button"
              onClick={() => askAi('', true)}
              disabled={loading}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              Gerar resumo semanal
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4 min-h-[540px]">
          <div className="flex-1 flex flex-col gap-4 overflow-y-auto max-h-[520px] pr-1">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 gap-2">
                <h2 className="text-base font-semibold text-[#14181F]">
                  Pergunte sobre obras, caixa, equipe ou conformidade
                </h2>
                <p className="text-sm text-[#5B6472] max-w-md">
                  No modo <strong className="text-[#14181F]">Analista</strong> a IA responde fatos exatos dos registros. No modo{' '}
                  <strong className="text-[#14181F]">Consultor</strong> ela sugere caminhos práticos para avaliação.
                </p>
              </div>
            ) : (
              messages.map((msg) =>
                msg.sender === 'user' ? (
                  <div
                    key={msg.id}
                    className="self-end bg-[#1F3A5F] text-white rounded-xl px-4 py-3 text-sm max-w-lg"
                  >
                    {msg.text}
                  </div>
                ) : (
                  <div
                    key={msg.id}
                    className="self-start bg-[#F0EEE9] border border-[#E4E1DA] rounded-xl px-4 py-3.5 text-sm text-[#14181F] max-w-2xl flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <strong className="text-xs font-bold text-[#14181F]">IA Operacional</strong>
                      <StatusBadge
                        label={msg.isWeeklySummary ? 'Resumo semanal' : msg.mode || 'Analista'}
                        tone={msg.mode === 'Consultor' ? 'warn' : 'info'}
                      />
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed text-[13.5px]">
                      {msg.text}
                    </div>
                  </div>
                )
              )
            )}
            {loading && (
              <div className="self-start bg-[#F0EEE9] border border-[#E4E1DA] rounded-xl px-4 py-3 text-sm text-[#5B6472]">
                Consultando os registros atuais do sistema...
              </div>
            )}
          </div>

          {errorMsg && (
            <AlertNote tone="bad" title="Erro na consulta">
              {errorMsg}
            </AlertNote>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              askAi(input, false);
            }}
            className="flex items-center gap-2 pt-3 border-t border-[#E4E1DA]"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte sobre obras, caixa, equipe, clientes..."
              aria-label="Pergunta para a IA Operacional"
              className="flex-1 rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm text-[#14181F]"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] disabled:opacity-50 cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>Enviar</span>
            </button>
          </form>
        </section>

        <aside className="flex flex-col gap-4">
          <div className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
            <h3 className="text-base font-semibold text-[#14181F]">Insights atuais</h3>
            {alerts.length === 0 ? (
              <p className="text-xs text-[#5B6472]">
                Sem alertas ativos nos registros cadastrados até o momento.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {alerts.slice(0, 4).map((al) => (
                  <button
                    key={al.id}
                    type="button"
                    onClick={() => onNavigate(al.module)}
                    className="bg-[#F6F5F2] border border-[#E4E1DA] rounded-lg p-3 text-left flex flex-col gap-1.5 hover:bg-[#F0EEE9] cursor-pointer"
                  >
                    <StatusBadge label={al.level} />
                    <span className="text-xs text-[#14181F] font-medium">{al.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-2.5">
            <h3 className="text-base font-semibold text-[#14181F]">Perguntas sugeridas</h3>
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={loading}
                onClick={() => askAi(q, false)}
                className="text-left text-xs font-medium text-[#14181F] border border-[#E4E1DA] rounded-lg px-3 py-2.5 hover:bg-[#F6F5F2] disabled:opacity-50 cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>

          <AlertNote tone="soft" title="Como a IA responde">
            Usa apenas registros reais do sistema, cita as fontes e informa quando não há dados. Nunca inventa valores sem lastro.
          </AlertNote>
        </aside>
      </div>
    </div>
  );
}
