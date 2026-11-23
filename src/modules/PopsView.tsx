import { useState } from 'react';
import { Printer, Search } from 'lucide-react';
import { CompanyPdfHeader } from '../components/ui/CompanyPdfHeader';
import {
  AlertNote,
  EmptySection,
  Modal,
  PageHeader,
  RegisteredBySelect,
  SegmentedControl,
  StatusBadge,
} from '../components/ui/PilotisUI';
import { createRecord, updateRecord } from '../services/pilotisService';
import type { ActorRole, PilotisDataState, Pop, PopStatus } from '../types/pilotis';
import { clampStr, formatTimestampBR } from '../domain';

function incrementVersion(v: string): string {
  const m = /^v?(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return 'v1.1';
  return `v${m[1]}.${Number(m[2]) + 1}`;
}

export function PopsView({
  uid,
  data,
  companyEmail,
}: {
  uid: string;
  data: PilotisDataState;
  companyEmail?: string | null;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [selectedPopId, setSelectedPopId] = useState<string>('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [editingPop, setEditingPop] = useState<Pop | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'bad'; title: string; text: string } | null>(null);

  // Editor state
  const [title, setTitle] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [version, setVersion] = useState('v1.0');
  const [linkedStagePhase, setLinkedStagePhase] = useState('');
  const [objective, setObjective] = useState('');
  const [materialsAndEpi, setMaterialsAndEpi] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [criteriaText, setCriteriaText] = useState('');
  const [popStatus, setPopStatus] = useState<PopStatus>('Vigente');
  const [usedInOnboarding, setUsedInOnboarding] = useState(true);
  const [actor, setActor] = useState<ActorRole>('Sócio');

  const filteredPops = data.pops.filter((p) => {
    const matchStatus =
      statusFilter === 'Todos'
        ? true
        : statusFilter === 'Vigentes'
        ? p.status === 'Vigente'
        : p.status === 'Em revisão';
    const q = search.trim().toLowerCase();
    const matchQuery =
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.serviceType.toLowerCase().includes(q) ||
      p.linkedStagePhase.toLowerCase().includes(q);
    return matchStatus && matchQuery;
  });

  const activePop =
    data.pops.find((p) => p.id === selectedPopId) || filteredPops[0] || data.pops[0] || null;

  function openNewPop() {
    setEditingPop(null);
    setTitle('');
    setServiceType('');
    setVersion('v1.0');
    setLinkedStagePhase('');
    setObjective('');
    setMaterialsAndEpi('');
    setStepsText('');
    setCriteriaText('');
    setPopStatus('Vigente');
    setUsedInOnboarding(true);
    setActor('Sócio');
    setEditorOpen(true);
  }

  function openEditPop(pop: Pop, asNewVersion = false) {
    setEditingPop(pop);
    setTitle(pop.title);
    setServiceType(pop.serviceType);
    setVersion(asNewVersion ? incrementVersion(pop.version) : pop.version);
    setLinkedStagePhase(pop.linkedStagePhase || '');
    setObjective(pop.objective || '');
    setMaterialsAndEpi(pop.materialsAndEpi || '');
    setStepsText((pop.steps || []).join('\n'));
    setCriteriaText((pop.acceptanceCriteria || []).join('\n'));
    setPopStatus(pop.status);
    setUsedInOnboarding(Boolean(pop.usedInOnboarding));
    setActor('Sócio');
    setEditorOpen(true);
  }

  async function handleSavePop(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !serviceType.trim()) return;
    setSaving(true);
    try {
      const steps = stepsText
        .split('\n')
        .map((s) => clampStr(s, 300))
        .filter(Boolean)
        .slice(0, 20);
      const acceptanceCriteria = criteriaText
        .split('\n')
        .map((s) => clampStr(s, 200))
        .filter(Boolean)
        .slice(0, 20);

      const payload = {
        title: clampStr(title, 160),
        serviceType: clampStr(serviceType, 80),
        version: clampStr(version || 'v1.0', 20),
        linkedStagePhase: clampStr(linkedStagePhase, 80),
        objective: clampStr(objective, 1000),
        materialsAndEpi: clampStr(materialsAndEpi, 1000),
        steps,
        acceptanceCriteria,
        status: popStatus,
        usedInOnboarding,
      };

      if (editingPop) {
        await updateRecord(
          'pops',
          editingPop.id,
          uid,
          actor,
          payload,
          `POP atualizado: ${payload.title} (${payload.version})`,
          editingPop.version,
          payload.version
        );
        setSelectedPopId(editingPop.id);
        setFeedback({
          tone: 'ok',
          title: 'POP salvo',
          text: `${payload.title} (${payload.version}) atualizado com sucesso.`,
        });
      } else {
        const newId = await createRecord(
          'pops',
          uid,
          actor,
          payload,
          `POP publicado: ${payload.title} (${payload.version})`
        );
        setSelectedPopId(newId);
        setFeedback({
          tone: 'ok',
          title: 'POP criado',
          text: `${payload.title} foi adicionado à biblioteca e já pode ser vinculado às etapas da obra.`,
        });
      }
      setEditorOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="POPs"
        subtitle="Procedimentos Operacionais Padrão por tipo de serviço"
        companyEmail={companyEmail}
        actions={
          <>
            {activePop && (
              <button
                type="button"
                onClick={() => setPdfPreviewOpen(true)}
                className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer inline-flex items-center gap-2"
              >
                <Printer className="w-4 h-4" /> Exportar PDF da empresa
              </button>
            )}
            <button
              type="button"
              onClick={openNewPop}
              className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] cursor-pointer"
            >
              Novo POP
            </button>
          </>
        }
      />

      {feedback && (
        <AlertNote tone={feedback.tone} title={feedback.title}>
          {feedback.text}
        </AlertNote>
      )}

      {data.pops.length === 0 ? (
        <EmptySection
          title="Nenhum POP cadastrado"
          description="Crie os Procedimentos Operacionais Padrão da construtora (fundação, revestimentos, pintura, elétrica, EPS). Eles alimentam os checklists das etapas e o onboarding."
          actionLabel="Criar primeiro POP"
          onAction={openNewPop}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {/* Biblioteca */}
          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[#14181F]">Biblioteca ({filteredPops.length})</h2>
            </div>

            <SegmentedControl
              items={['Todos', 'Vigentes', 'Em revisão']}
              active={statusFilter}
              onChange={setStatusFilter}
            />

            <div className="relative">
              <Search className="w-4 h-4 text-[#5B6472] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar POP ou serviço..."
                className="w-full rounded-lg border border-[#E4E1DA] pl-9 pr-3 py-2 text-sm"
              />
            </div>

            <div className="flex flex-col gap-2">
              {filteredPops.length === 0 ? (
                <p className="text-xs text-[#5B6472] py-4 text-center">
                  Nenhum procedimento corresponde ao filtro.
                </p>
              ) : (
                filteredPops.map((pop) => {
                  const isActive = activePop?.id === pop.id;
                  return (
                    <button
                      key={pop.id}
                      type="button"
                      onClick={() => setSelectedPopId(pop.id)}
                      className={`text-left border rounded-xl p-3.5 transition-colors cursor-pointer ${
                        isActive
                          ? 'border-[#1F3A5F] bg-[#E6EEFB]/50'
                          : 'border-[#E4E1DA] bg-white hover:bg-[#F6F5F2]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <strong className="text-sm font-semibold text-[#14181F] truncate">
                          {pop.title}
                        </strong>
                        <StatusBadge label={pop.status} />
                      </div>
                      <span className="text-xs text-[#5B6472] block">
                        {pop.serviceType} · {pop.version}
                        {pop.linkedStagePhase ? ` · Etapa: ${pop.linkedStagePhase}` : ''}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Detalhe do POP */}
          <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-6 flex flex-col gap-5">
            {!activePop ? (
              <p className="text-sm text-[#5B6472]">Selecione um procedimento na biblioteca.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#E4E1DA]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h2 className="text-xl font-bold text-[#14181F]">{activePop.title}</h2>
                      <StatusBadge label={activePop.version} tone="info" />
                      <StatusBadge label={activePop.status} />
                    </div>
                    <p className="text-xs text-[#5B6472]">
                      Serviço: {activePop.serviceType}
                      {activePop.linkedStagePhase ? ` · Etapa vinculada: ${activePop.linkedStagePhase}` : ''}
                      {activePop.usedInOnboarding ? ' · Usado no onboarding' : ''}
                      {` · Atualizado por ${activePop.updatedBy} (${formatTimestampBR(activePop.updatedAt)})`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openEditPop(activePop, false)}
                      className="px-3.5 py-2 rounded-lg border border-[#E4E1DA] text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditPop(activePop, true)}
                      className="px-3.5 py-2 rounded-lg bg-[#1F3A5F] text-white text-xs font-semibold hover:bg-[#182E4C] cursor-pointer"
                    >
                      Nova versão ({incrementVersion(activePop.version)})
                    </button>
                  </div>
                </div>

                {activePop.objective && (
                  <div>
                    <h3 className="text-sm font-semibold text-[#14181F] mb-1">Objetivo</h3>
                    <p className="text-sm text-[#5B6472] leading-relaxed">{activePop.objective}</p>
                  </div>
                )}

                {activePop.materialsAndEpi && (
                  <div>
                    <h3 className="text-sm font-semibold text-[#14181F] mb-1">Materiais e EPIs obrigatórios</h3>
                    <p className="text-sm text-[#5B6472] leading-relaxed">{activePop.materialsAndEpi}</p>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-semibold text-[#14181F] mb-2">Passo a passo</h3>
                  {activePop.steps.length === 0 ? (
                    <p className="text-sm text-[#5B6472]">Nenhum passo cadastrado.</p>
                  ) : (
                    <ol className="flex flex-col gap-2">
                      {activePop.steps.map((step, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-3 bg-[#F6F5F2] border border-[#E4E1DA] rounded-lg px-3.5 py-2.5 text-sm text-[#14181F]"
                        >
                          <span className="w-6 h-6 rounded-full bg-[#1F3A5F] text-white text-xs font-bold grid place-items-center shrink-0">
                            {i + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-[#14181F] mb-2">
                    Critérios de aceite (checklist de conferência)
                  </h3>
                  {activePop.acceptanceCriteria.length === 0 ? (
                    <p className="text-sm text-[#5B6472]">Nenhum critério de aceite cadastrado.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {activePop.acceptanceCriteria.map((crit, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-2.5 border border-[#E4E1DA] rounded-lg px-3.5 py-2 text-sm text-[#14181F]"
                        >
                          <span className="text-[#1E7F5C] font-bold">✓</span>
                          <span>{crit}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* Editor Modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingPop ? `Editar POP · ${version}` : 'Novo POP'}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSavePop} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pop-title" className="text-[13px] font-semibold text-[#14181F]">
                Título do procedimento
              </label>
              <input
                id="pop-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Assentamento de revestimento cerâmico"
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pop-svc" className="text-[13px] font-semibold text-[#14181F]">
                Tipo de serviço
              </label>
              <input
                id="pop-svc"
                required
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                placeholder="Revestimentos, Fundação, Pintura, EPS..."
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pop-ver" className="text-[13px] font-semibold text-[#14181F]">
                Versão
              </label>
              <input
                id="pop-ver"
                required
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pop-phase" className="text-[13px] font-semibold text-[#14181F]">
                Etapa vinculada no planejamento
              </label>
              <input
                id="pop-phase"
                value={linkedStagePhase}
                onChange={(e) => setLinkedStagePhase(e.target.value)}
                placeholder="Ex.: Revestimentos, Cobertura"
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pop-status" className="text-[13px] font-semibold text-[#14181F]">
                Status
              </label>
              <select
                id="pop-status"
                value={popStatus}
                onChange={(e) => setPopStatus(e.target.value as PopStatus)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="Vigente">Vigente</option>
                <option value="Em revisão">Em revisão</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pop-obj" className="text-[13px] font-semibold text-[#14181F]">
              Objetivo
            </label>
            <textarea
              id="pop-obj"
              rows={2}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Garantir alinhamento, nivelamento e padrão técnico da entrega."
              className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pop-mat" className="text-[13px] font-semibold text-[#14181F]">
              Materiais, ferramentas e EPIs
            </label>
            <input
              id="pop-mat"
              value={materialsAndEpi}
              onChange={(e) => setMaterialsAndEpi(e.target.value)}
              placeholder="Argamassa colante, nível a laser; luvas, óculos e botina."
              className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pop-steps" className="text-[13px] font-semibold text-[#14181F]">
                Passo a passo (1 passo por linha)
              </label>
              <textarea
                id="pop-steps"
                rows={4}
                value={stepsText}
                onChange={(e) => setStepsText(e.target.value)}
                placeholder={'Conferir nivelamento do contrapiso\nAplicar argamassa\nAssentar e alinhar'}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pop-crit" className="text-[13px] font-semibold text-[#14181F]">
                Critérios de aceite (1 por linha)
              </label>
              <textarea
                id="pop-crit"
                rows={4}
                value={criteriaText}
                onChange={(e) => setCriteriaText(e.target.value)}
                placeholder={'Alinhamento e nível conferidos\nTeste de percussão aprovado\nFotos anexadas'}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[#14181F] cursor-pointer">
            <input
              type="checkbox"
              checked={usedInOnboarding}
              onChange={(e) => setUsedInOnboarding(e.target.checked)}
              className="w-4 h-4 rounded border-[#E4E1DA]"
            />
            Usar este POP na integração (onboarding) da equipe
          </label>

          <RegisteredBySelect value={actor} onChange={setActor} id="pop-actor" />

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Publicar POP'}
            </button>
          </div>
        </form>
      </Modal>

      {/* PDF Export Modal */}
      {activePop && (
        <Modal
          open={pdfPreviewOpen}
          onClose={() => setPdfPreviewOpen(false)}
          title="Exportar POP em PDF com identidade da empresa"
          maxWidth="max-w-3xl"
        >
          <div className="flex flex-col gap-4">
            <div className="bg-white border border-[#E4E1DA] rounded-xl p-8 flex flex-col gap-4 shadow-sm print-sheet">
              <CompanyPdfHeader
                settings={data.settings}
                subtitle={`Procedimento Operacional Padrão · ${activePop.version} · ${activePop.serviceType}`}
              />

              <h3 className="text-xl font-bold text-[#14181F]">{activePop.title}</h3>

              {activePop.objective && (
                <p className="text-sm text-[#14181F]">
                  <strong>Objetivo:</strong> {activePop.objective}
                </p>
              )}
              {activePop.materialsAndEpi && (
                <p className="text-sm text-[#14181F]">
                  <strong>Materiais e EPIs:</strong> {activePop.materialsAndEpi}
                </p>
              )}
              {activePop.steps.length > 0 && (
                <div>
                  <strong className="text-sm text-[#14181F] block mb-1">Passo a passo:</strong>
                  <ol className="list-decimal pl-5 text-sm text-[#14181F] space-y-1">
                    {activePop.steps.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}
              {activePop.acceptanceCriteria.length > 0 && (
                <div>
                  <strong className="text-sm text-[#14181F] block mb-1">Critérios de aceite:</strong>
                  <ul className="list-disc pl-5 text-sm text-[#14181F] space-y-1">
                    {activePop.acceptanceCriteria.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 no-print">
              <button
                type="button"
                onClick={() => setPdfPreviewOpen(false)}
                className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] cursor-pointer inline-flex items-center gap-2"
              >
                <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
