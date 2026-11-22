import { useState } from 'react';
import { Bell, Plus, Sparkles } from 'lucide-react';
import { DataList, type DataListColumn } from '../components/ui/DataList';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  KpiCard,
  Modal,
  Note,
  PageHeader,
  ProgressBar,
  ScrollableChips,
  SegmentedControl,
  Select,
  Tabs,
  Textarea,
} from '../components/ui/PilotisUI';
import { useToast } from '../components/ui/Toast';
import type { AppRouteKey } from '../components/ui/Sidebar';

interface CatalogRow {
  id: string;
  item: string;
  categoria: string;
  status: 'ok' | 'warn' | 'bad' | 'info' | 'crit' | 'neutral';
  statusLabel: string;
  valor: string;
}

const CATALOG_SAMPLE_ROWS: CatalogRow[] = [
  {
    id: '1',
    item: 'Elemento tabular A',
    categoria: 'Categoria 01',
    status: 'ok',
    statusLabel: 'Aprovado',
    valor: '100%',
  },
  {
    id: '2',
    item: 'Elemento tabular B',
    categoria: 'Categoria 02',
    status: 'warn',
    statusLabel: 'Atenção',
    valor: '64%',
  },
  {
    id: '3',
    item: 'Elemento tabular C',
    categoria: 'Categoria 03',
    status: 'bad',
    statusLabel: 'Bloqueado',
    valor: '18%',
  },
];

const COLOR_TOKENS = [
  { name: 'Fundo do app', hex: '#F6F5F2', darkText: true },
  { name: 'Superfície', hex: '#FFFFFF', darkText: true },
  { name: 'Sutil', hex: '#F0EEE9', darkText: true },
  { name: 'Barra lateral', hex: '#101828', darkText: false },
  { name: 'Sidebar ativo', hex: '#1D2A44', darkText: false },
  { name: 'Primária', hex: '#1F3A5F', darkText: false },
  { name: 'Destaque bronze', hex: '#9A6212', darkText: false },
  { name: 'Bronze suave', hex: '#F6E7CC', darkText: true },
  { name: 'Texto principal', hex: '#14181F', darkText: false },
  { name: 'Texto secundário', hex: '#5B6472', darkText: false },
  { name: 'Borda padrão', hex: '#E4E1DA', darkText: true },
  { name: 'Sucesso', hex: '#1E7F5C', darkText: false },
  { name: 'Sucesso fundo', hex: '#E3F4EC', darkText: true },
  { name: 'Alerta', hex: '#8A5200', darkText: false },
  { name: 'Alerta fundo', hex: '#FBF1DC', darkText: true },
  { name: 'Perigo', hex: '#B42318', darkText: false },
  { name: 'Perigo fundo', hex: '#FDECEA', darkText: true },
  { name: 'Info', hex: '#2455A4', darkText: false },
  { name: 'Info fundo', hex: '#E6EEFB', darkText: true },
  { name: 'Neutro fundo', hex: '#ECEAE4', darkText: true },
];

export function DevCatalogPage({
  onNavigate,
}: {
  onNavigate: (route: AppRouteKey) => void;
}) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState('Aba ativa');
  const [segment, setSegment] = useState('Opção A');
  const [chip, setChip] = useState('Todos');
  const [forceFieldError, setForceFieldError] = useState(true);
  const [inputVal, setInputVal] = useState('Texto válido de exemplo');
  const [selectVal, setSelectVal] = useState('Sócio');
  const [textareaVal, setTextareaVal] = useState(
    'Descrição multi-linha para demonstrar o componente Textarea.',
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [emptyTableMode, setEmptyTableMode] = useState(false);

  const columns: Array<DataListColumn<CatalogRow>> = [
    {
      key: 'item',
      header: 'Item',
      render: (r) => <span className="font-semibold text-[#14181F]">{r.item}</span>,
    },
    {
      key: 'categoria',
      header: 'Grupo',
      render: (r) => <span className="text-[#5B6472]">{r.categoria}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const map: Record<
          CatalogRow['status'],
          'success' | 'warning' | 'danger' | 'info' | 'critical' | 'neutral'
        > = {
          ok: 'success',
          warn: 'warning',
          bad: 'danger',
          info: 'info',
          crit: 'critical',
          neutral: 'neutral',
        };
        return <Badge variant={map[r.status]}>{r.statusLabel}</Badge>;
      },
    },
    {
      key: 'valor',
      header: 'Progresso',
      align: 'right',
      numeric: true,
      render: (r) => r.valor,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catálogo de Componentes (/dev)"
        subtitle="Base visual Pilotis · Tokens, estados e componentes responsivos (desktop e celular)"
        actions={
          <Button variant="secondary" size="sm" onClick={() => onNavigate('dashboard')}>
            Voltar ao Dashboard
          </Button>
        }
      />

      {/* 1. Design Tokens */}
      <Card
        title="1. Tokens de cor, fonte e raios"
        subtitle="Paleta oficial (#F6F5F2, #1F3A5F, #9A6212, #101828), fonte Inter, raios 8 px (campos/botões) e 12 px (cartões)."
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5">
          {COLOR_TOKENS.map((t) => (
            <div
              key={t.name}
              className="border border-[#E4E1DA] rounded-[8px] overflow-hidden bg-white"
            >
              <div
                className={`h-11 px-2.5 flex items-end pb-1.5 text-[11px] font-mono-num font-semibold ${
                  t.darkText ? 'text-[#14181F]' : 'text-white'
                }`}
                style={{ backgroundColor: t.hex }}
              >
                {t.hex}
              </div>
              <div className="px-2.5 py-1.5 text-xs font-medium text-[#14181F] truncate">
                {t.name}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 2. Buttons & Badges */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="2. Button"
          subtitle="Variantes primário, secundário e texto com raio de 8 px."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">
              <Plus className="w-4 h-4" />
              Primário
            </Button>
            <Button variant="secondary">Secundário</Button>
            <Button variant="text">Botão texto</Button>
            <Button variant="primary" size="sm">
              Compacto
            </Button>
            <Button variant="primary" disabled>
              Desabilitado
            </Button>
          </div>
        </Card>

        <Card
          title="3. Badge"
          subtitle="Sempre acompanhado de texto descritivo (acessibilidade AA)."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">Sucesso</Badge>
            <Badge variant="warning">Alerta</Badge>
            <Badge variant="danger">Perigo</Badge>
            <Badge variant="info">Info</Badge>
            <Badge variant="critical">Crítico</Badge>
            <Badge variant="neutral">Neutro</Badge>
          </div>
        </Card>
      </div>

      {/* 4. KpiCard & Card */}
      <Card
        title="4. KpiCard e Card"
        subtitle="Indicadores numéricos com tabular-nums e estado padrão “Sem dados”."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Indicador sem registros"
            value="Sem dados"
            subtext="Nunca exibe zero artificial"
            isEmpty
          />
          <KpiCard
            label="Indicador monetário"
            value="R$ 120.000,00"
            subtext="Formatação brasileira e tabular-nums"
          />
          <KpiCard
            label="Indicador percentual"
            value="82%"
            subtext="Progresso calculado"
          />
          <KpiCard
            label="Data padrão"
            value="21/11/2026"
            subtext="Formato dd/mm/aaaa"
          />
        </div>
      </Card>

      {/* 5. Tabs, SegmentedControl, ScrollableChips */}
      <Card
        title="5. Navegação interna: Tabs, SegmentedControl e Chips roláveis"
        subtitle="Abas com linha bronze (#9A6212), controle segmentado e chips com rolagem horizontal."
      >
        <div className="flex flex-col gap-5">
          <div>
            <span className="block text-xs font-semibold text-[#5B6472] mb-2">
              Tabs
            </span>
            <Tabs
              items={['Aba ativa', 'Segunda aba', 'Terceira aba', 'Quarta aba']}
              active={activeTab}
              onChange={setActiveTab}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="block text-xs font-semibold text-[#5B6472] mb-2">
                SegmentedControl
              </span>
              <SegmentedControl
                items={['Opção A', 'Opção B', 'Opção C']}
                active={segment}
                onChange={setSegment}
              />
            </div>

            <div className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-[#5B6472] mb-2">
                Chips roláveis
              </span>
              <ScrollableChips
                items={[
                  'Todos',
                  'Em andamento',
                  'Aguardando',
                  'Concluídos',
                  'Com alerta',
                  'Em conferência',
                  'Arquivados',
                ]}
                active={chip}
                onChange={setChip}
                ariaLabel="Chips de exemplo"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* 6. Field, Input, Textarea, Select */}
      <Card
        title="6. Field, Input, Textarea e Select"
        subtitle="Campos com raio de 8 px, rótulo obrigatório, texto de ajuda e estado de erro (#B42318)."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setForceFieldError((v) => !v)}
          >
            {forceFieldError ? 'Ocultar erro de exemplo' : 'Simular erro nos campos'}
          </Button>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Input padrão"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            help="Texto de apoio para preenchimento do campo."
          />

          <Input
            label="Input com estado de erro"
            required
            defaultValue="Valor inválido"
            error={
              forceFieldError
                ? 'Empréstimo não pode entrar como receita. Corrija a classificação.'
                : undefined
            }
            help="Sem erro, exibe a orientação padrão."
          />

          <Select
            label="Registrado por"
            required
            value={selectVal}
            onChange={(e) => setSelectVal(e.target.value)}
            error={
              forceFieldError ? 'Selecione quem realizou o registro.' : undefined
            }
          >
            <option value="Sócio">Sócio</option>
            <option value="Responsável administrativo">
              Responsável administrativo
            </option>
          </Select>

          <Textarea
            label="Textarea"
            rows={3}
            value={textareaVal}
            onChange={(e) => setTextareaVal(e.target.value)}
            error={
              forceFieldError ? 'Informe ao menos 10 caracteres.' : undefined
            }
          />
        </div>
      </Card>

      {/* 7. ProgressBar & Note */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="7. ProgressBar"
          subtitle="Barras de progresso com suporte a cores semânticas."
        >
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-medium">
                <span>Primária (75%)</span>
                <span className="tabular-nums">75%</span>
              </div>
              <ProgressBar pct={75} tone="primary" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-medium">
                <span>Destaque bronze (55%)</span>
                <span className="tabular-nums">55%</span>
              </div>
              <ProgressBar pct={55} tone="bronze" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-medium">
                <span>Sucesso (100%)</span>
                <span className="tabular-nums">100%</span>
              </div>
              <ProgressBar pct={100} tone="success" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-medium">
                <span>Alerta (40%)</span>
                <span className="tabular-nums">40%</span>
              </div>
              <ProgressBar pct={40} tone="warning" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-medium">
                <span>Perigo (18%)</span>
                <span className="tabular-nums">18%</span>
              </div>
              <ProgressBar pct={18} tone="danger" />
            </div>
          </div>
        </Card>

        <Card
          title="8. Note"
          subtitle="Avisos semânticos nas variantes info, alerta, perigo e sucesso."
        >
          <div className="flex flex-col gap-2.5">
            <Note variant="info" title="Nota informativa (info)">
              Orientação neutra ou explicação de regra de negócio.
            </Note>
            <Note variant="warning" title="Nota de atenção (alerta)">
              Destaca prazos próximos ou desvios que exigem decisão.
            </Note>
            <Note variant="danger" title="Nota crítica (perigo)">
              Indica bloqueio, saldo negativo previsto ou erro de validação.
            </Note>
            <Note variant="success" title="Nota positiva (sucesso)">
              Confirma conciliação, aprovação ou conformidade em dia.
            </Note>
          </div>
        </Card>
      </div>

      {/* 9. Modal/BottomSheet & Toast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="9. Modal (desktop) e BottomSheet (celular)"
          subtitle="Centralizado em telas >= 768 px; desliza de baixo em telas < 768 px."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              Abrir Modal / BottomSheet
            </Button>
          </div>
        </Card>

        <Card
          title="10. Toast"
          subtitle="Notificações temporárias acessíveis em todos os tons semânticos."
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                showToast({
                  tone: 'success',
                  title: 'Ação concluída',
                  description: 'Componente Toast na variante sucesso.',
                })
              }
            >
              <Bell className="w-4 h-4" />
              Toast sucesso
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                showToast({
                  tone: 'warning',
                  title: 'Atenção necessária',
                  description: 'Componente Toast na variante alerta.',
                })
              }
            >
              Toast alerta
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                showToast({
                  tone: 'danger',
                  title: 'Falha de validação',
                  description: 'Componente Toast na variante perigo.',
                })
              }
            >
              Toast perigo
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                showToast({
                  tone: 'info',
                  title: 'Informação do sistema',
                  description: 'Componente Toast na variante info.',
                })
              }
            >
              Toast info
            </Button>
          </div>
        </Card>
      </div>

      {/* 11. EmptyState */}
      <Card
        title="11. EmptyState"
        subtitle="Estado vazio padrão aplicado em todos os módulos sem dados."
      >
        <EmptyState
          icon={<Sparkles className="w-5 h-5" />}
          title="Nenhum registro encontrado"
          description="Quando um módulo ou filtro não tiver dados reais cadastrados, exibimos este componente orientando o próximo passo."
          actionLabel="Ação primária"
          onAction={() =>
            showToast({
              tone: 'info',
              title: 'Ação primária acionada',
            })
          }
          secondaryActionLabel="Ação secundária"
          onSecondaryAction={() =>
            showToast({
              tone: 'info',
              title: 'Ação secundária acionada',
            })
          }
        />
      </Card>

      {/* 12. DataList */}
      <Card
        title="12. DataList (Tabela no desktop · Lista de cartões no celular)"
        subtitle="Redimensione entre 1440 px e 390 px para testar a conversão automática."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEmptyTableMode((v) => !v)}
          >
            {emptyTableMode ? 'Mostrar itens de catálogo' : 'Testar estado vazio'}
          </Button>
        }
      >
        <DataList
          caption="Demonstração de DataList do catálogo visual"
          columns={columns}
          rows={emptyTableMode ? [] : CATALOG_SAMPLE_ROWS}
          keyExtractor={(r) => r.id}
          emptyTitle="Lista vazia no DataList"
          emptyDescription="Quando não há linhas, o DataList renderiza automaticamente o EmptyState."
          emptyActionLabel="Restaurar itens de catálogo"
          onEmptyAction={() => setEmptyTableMode(false)}
          onRowClick={(r) =>
            showToast({
              tone: 'info',
              title: `${r.item} selecionado`,
              description: `${r.categoria} · ${r.statusLabel}`,
            })
          }
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Exemplo de Modal / BottomSheet"
        subtitle="No desktop aparece centralizado; no celular (390 px) abre como folha inferior."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setModalOpen(false);
                showToast({
                  tone: 'success',
                  title: 'Janela confirmada',
                  description: 'Modal fechado com sucesso.',
                });
              }}
            >
              Confirmar
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Note variant="info" title="Comportamento responsivo">
            Em telas menores que 768 px, o container ganha borda superior arredondada
            (22 px), alça visual superior e animação de subida respeitando
            prefers-reduced-motion.
          </Note>
          <Input
            label="Campo dentro da janela"
            placeholder="Digite um texto para testar foco e espaçamento"
          />
          <Select label="Registrado por">
            <option value="Sócio">Sócio</option>
            <option value="Responsável administrativo">
              Responsável administrativo
            </option>
          </Select>
        </div>
      </Modal>
    </div>
  );
}
