import { useEffect, useMemo, useState } from 'react';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import {
  Download,
  FileSpreadsheet,
  ImagePlus,
  KeyRound,
  Trash2,
  Upload,
} from 'lucide-react';
import { CompanyPdfHeader } from '../components/ui/CompanyPdfHeader';
import { DataList, type DataListColumn } from '../components/ui/DataList';
import {
  AlertNote,
  Badge,
  Button,
  Card,
  Modal,
  PageHeader,
  RegisteredBySelect,
  ScrollableChips,
  Select,
  StatusBadge,
  Tabs,
} from '../components/ui/PilotisUI';
import { auth } from '../lib/firebase';
import {
  importTransactionsBatch,
  logSecurityAudit,
  upsertCompanySettings,
} from '../services/pilotisService';
import type {
  ActorRole,
  AuditLog,
  CompanySettings,
  FinancialTransaction,
  PilotisDataState,
  TransactionKind,
} from '../types/pilotis';
import {
  clampStr,
  formatBRL,
  formatDateBR as domainFormatDateBR,
  formatTimestampBR,
} from '../domain';

const formatDateBR = (val: string | null | undefined) => domainFormatDateBR(val, '—');
import {
  buildImportPreviewRows,
  exportBackupJson,
  exportBackupWorkbookXlsx,
  exportTransactionsCsv,
  normalizeHexColor,
  parseCsvText,
  parseSpreadsheetFile,
  rasterizeLogoToDataUrl,
  type ColumnMapping,
  type ImportPreviewRow,
  type ParsedSheetData,
} from '../utils/spreadsheet';

const SETTINGS_TABS = [
  'Dados da empresa',
  'Encargos e meta',
  'Importar dados',
  'Segurança e auditoria',
];

const ACCENT_PRESETS = [
  { hex: '#9A6212', label: 'Bronze Pilotis' },
  { hex: '#1F3A5F', label: 'Azul marinho' },
  { hex: '#1E7F5C', label: 'Verde obra' },
  { hex: '#8A5200', label: 'Âmbar escuro' },
];

export function SettingsView({
  uid,
  data,
  companyEmail,
  initialTab,
}: {
  uid: string;
  data: PilotisDataState;
  companyEmail?: string | null;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(
    initialTab && SETTINGS_TABS.includes(initialTab) ? initialTab : 'Dados da empresa'
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'bad' | 'info' | 'warn';
    title: string;
    text: string;
  } | null>(null);

  useEffect(() => {
    if (initialTab && SETTINGS_TABS.includes(initialTab)) {
      setTab(initialTab);
    }
  }, [initialTab]);

  // Company identity & branding form
  const [companyName, setCompanyName] = useState(
    data.settings?.companyName || 'Pilotis Soluções Construtivas'
  );
  const [cnpj, setCnpj] = useState(data.settings?.cnpj || '');
  const [fiscalAddress, setFiscalAddress] = useState(data.settings?.fiscalAddress || '');
  const [city, setCity] = useState(data.settings?.city || 'Valença · RJ');
  const [email, setEmail] = useState(data.settings?.email || companyEmail || '');
  const [phone, setPhone] = useState(data.settings?.phone || '');
  const [accentColor, setAccentColor] = useState(
    normalizeHexColor(data.settings?.accentColor, '#9A6212')
  );
  const [logoDataUrl, setLogoDataUrl] = useState(data.settings?.logoDataUrl || '');
  const [pdfShowLogo, setPdfShowLogo] = useState(data.settings?.pdfShowLogo ?? true);
  const [popPdfHeader, setPopPdfHeader] = useState(data.settings?.popPdfHeader ?? '');
  const [popPdfFooter, setPopPdfFooter] = useState(data.settings?.popPdfFooter ?? '');
  const [companyActor, setCompanyActor] = useState<ActorRole>('Sócio');

  // Tax parameters & margin target form
  const [inssRate, setInssRate] = useState(
    data.settings?.inssRate ? String(data.settings.inssRate) : ''
  );
  const [fgtsRate, setFgtsRate] = useState(
    data.settings?.fgtsRate ? String(data.settings.fgtsRate) : ''
  );
  const [vacationRate, setVacationRate] = useState(
    data.settings?.vacationRate ? String(data.settings.vacationRate) : ''
  );
  const [thirteenthRate, setThirteenthRate] = useState(
    data.settings?.thirteenthRate ? String(data.settings.thirteenthRate) : ''
  );
  const [taxEffectiveDate, setTaxEffectiveDate] = useState(
    data.settings?.taxParamsEffectiveDate || ''
  );
  const [taxSource, setTaxSource] = useState(data.settings?.taxParamsSource || '');
  const [targetMarginPct, setTargetMarginPct] = useState(
    data.settings?.targetMarginPct ? String(data.settings.targetMarginPct) : ''
  );
  const [paramsActor, setParamsActor] = useState<ActorRole>('Sócio');

  useEffect(() => {
    if (data.settings) {
      setCompanyName(data.settings.companyName || 'Pilotis Soluções Construtivas');
      setCnpj(data.settings.cnpj || '');
      setFiscalAddress(data.settings.fiscalAddress || '');
      setCity(data.settings.city || 'Valença · RJ');
      setEmail(data.settings.email || companyEmail || '');
      setPhone(data.settings.phone || '');
      setAccentColor(normalizeHexColor(data.settings.accentColor, '#9A6212'));
      setLogoDataUrl(data.settings.logoDataUrl || '');
      setPdfShowLogo(data.settings.pdfShowLogo ?? true);
      setPopPdfHeader(data.settings.popPdfHeader ?? '');
      setPopPdfFooter(data.settings.popPdfFooter ?? '');

      setInssRate(data.settings.inssRate ? String(data.settings.inssRate) : '');
      setFgtsRate(data.settings.fgtsRate ? String(data.settings.fgtsRate) : '');
      setVacationRate(data.settings.vacationRate ? String(data.settings.vacationRate) : '');
      setThirteenthRate(
        data.settings.thirteenthRate ? String(data.settings.thirteenthRate) : ''
      );
      setTaxEffectiveDate(data.settings.taxParamsEffectiveDate || '');
      setTaxSource(data.settings.taxParamsSource || '');
      setTargetMarginPct(
        data.settings.targetMarginPct ? String(data.settings.targetMarginPct) : ''
      );
    }
  }, [data.settings, companyEmail]);

  // Spreadsheet import wizard state (zero Firestore writes until final confirmation)
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [csvText, setCsvText] = useState('');
  const [sheetData, setSheetData] = useState<ParsedSheetData | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    dateCol: 0,
    descriptionCol: 1,
    categoryCol: 2,
    amountCol: 3,
    projectCol: 4,
    kindCol: -1,
  });
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [skippedRowsCount, setSkippedRowsCount] = useState(0);
  const [importActor, setImportActor] = useState<ActorRole>('Responsável administrativo');
  const [importError, setImportError] = useState<string | null>(null);

  // Password change modal state
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordActor, setPasswordActor] = useState<ActorRole>('Sócio');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const previewSettings: CompanySettings = useMemo(
    () => ({
      id: uid,
      ownerUid: uid,
      companyName: companyName || 'Pilotis Soluções Construtivas',
      cnpj,
      fiscalAddress,
      city,
      email,
      phone,
      accentColor,
      logoDataUrl,
      pdfShowLogo,
      inssRate: Number(inssRate) || 0,
      fgtsRate: Number(fgtsRate) || 0,
      vacationRate: Number(vacationRate) || 0,
      thirteenthRate: Number(thirteenthRate) || 0,
      targetMarginPct: Number(targetMarginPct) || 0,
      taxParamsEffectiveDate: taxEffectiveDate,
      taxParamsSource: taxSource,
      createdBy: companyActor,
      updatedBy: companyActor,
    }),
    [
      uid,
      companyName,
      cnpj,
      fiscalAddress,
      city,
      email,
      phone,
      accentColor,
      logoDataUrl,
      pdfShowLogo,
      inssRate,
      fgtsRate,
      vacationRate,
      thirteenthRate,
      targetMarginPct,
      taxEffectiveDate,
      taxSource,
      companyActor,
    ]
  );

  const totalChargePct =
    (Number(inssRate) || 0) +
    (Number(fgtsRate) || 0) +
    (Number(vacationRate) || 0) +
    (Number(thirteenthRate) || 0);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const processed = await rasterizeLogoToDataUrl(file);
      setLogoDataUrl(processed);
      setFeedback({
        tone: 'info',
        title: 'Logo carregada na pré-visualização',
        text: 'Clique em “Salvar alterações” para gravar a logo e aplicá-la nos contratos, POPs e PDFs.',
      });
    } catch (err) {
      setFeedback({
        tone: 'bad',
        title: 'Não foi possível carregar a logo',
        text: err instanceof Error ? err.message : 'Formato de imagem inválido.',
      });
    }
  }

  async function handleSaveCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) {
      setFeedback({
        tone: 'bad',
        title: 'Informe o nome da empresa',
        text: 'O nome da empresa é obrigatório para salvar os dados cadastrais.',
      });
      return;
    }
    setSaving(true);
    try {
      await upsertCompanySettings(uid, companyActor, data.settings, {
        companyName: clampStr(companyName, 120),
        cnpj: clampStr(cnpj, 24),
        fiscalAddress: clampStr(fiscalAddress, 240),
        city: clampStr(city, 80),
        email: clampStr(email, 120),
        phone: clampStr(phone, 40),
        accentColor: normalizeHexColor(accentColor, '#9A6212'),
        logoDataUrl: clampStr(logoDataUrl, 200000),
        pdfShowLogo,
        popPdfHeader: clampStr(popPdfHeader, 120),
        popPdfFooter: clampStr(popPdfFooter, 120),
      });
      setFeedback({
        tone: 'ok',
        title: 'Dados da empresa salvos',
        text: 'Nome, logo e cor de destaque atualizados para contratos, POPs e relatórios em PDF.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveParameters(e: React.FormEvent) {
    e.preventDefault();
    const parsedInss = Number(inssRate) || 0;
    const parsedFgts = Number(fgtsRate) || 0;
    const parsedVac = Number(vacationRate) || 0;
    const parsed13 = Number(thirteenthRate) || 0;
    const parsedMargin = Number(targetMarginPct) || 0;

    if (
      parsedInss < 0 ||
      parsedFgts < 0 ||
      parsedVac < 0 ||
      parsed13 < 0 ||
      parsedMargin < 0 ||
      parsedMargin > 100
    ) {
      setFeedback({
        tone: 'bad',
        title: 'Alíquotas inválidas',
        text: 'Os percentuais não podem ser negativos e a meta de margem deve ficar entre 0% e 100%.',
      });
      return;
    }

    setSaving(true);
    try {
      await upsertCompanySettings(uid, paramsActor, data.settings, {
        companyName: clampStr(companyName || 'Pilotis Soluções Construtivas', 120),
        inssRate: parsedInss,
        fgtsRate: parsedFgts,
        vacationRate: parsedVac,
        thirteenthRate: parsed13,
        targetMarginPct: parsedMargin,
        taxParamsEffectiveDate: clampStr(taxEffectiveDate, 20),
        taxParamsSource: clampStr(taxSource, 120),
      });
      setFeedback({
        tone: 'ok',
        title: 'Parâmetros de encargos e meta salvos',
        text: 'Alterações gravadas com histórico de antes/depois na trilha de auditoria.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSpreadsheetFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    try {
      const parsed = await parseSpreadsheetFile(file);
      if (parsed.rawRows.length === 0) {
        setImportError(
          'A planilha selecionada não possui linhas com conteúdo para importar.'
        );
        return;
      }
      setSheetData(parsed);
      setColumnMapping(parsed.suggestedMapping);
      setImportStep(2);
    } catch (err) {
      setImportError(
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível ler o arquivo enviado. Verifique se é um .csv ou .xlsx válido.'
      );
    }
  }

  function handleAnalyzePastedCsv() {
    setImportError(null);
    const parsed = parseCsvText(csvText, 'colagem-manual.csv');
    if (parsed.rawRows.length === 0) {
      setImportError('Nenhuma linha válida encontrada no texto colado.');
      return;
    }
    setSheetData(parsed);
    setColumnMapping(parsed.suggestedMapping);
    setImportStep(2);
  }

  function handleBuildPreview() {
    if (!sheetData) return;
    setImportError(null);
    if (columnMapping.descriptionCol < 0 || columnMapping.amountCol < 0) {
      setImportError(
        'Relacione pelo menos as colunas de “Descrição” e “Valor” antes de continuar.'
      );
      return;
    }
    const result = buildImportPreviewRows(sheetData, columnMapping);
    if (result.rows.length === 0) {
      setImportError(
        'Nenhuma linha com valor positivo encontrada nas colunas selecionadas. Meses vazios continuam vazios.'
      );
      return;
    }
    setPreviewRows(result.rows);
    setSkippedRowsCount(result.skippedRowsCount);
    setImportStep(3);
  }

  async function handleConfirmSpreadsheetImport() {
    if (previewRows.length === 0) return;

    const unresolvedLoanAsIncome = previewRows.some(
      (r) => r.flaggedLoan && r.entryKind === 'income'
    );
    if (unresolvedLoanAsIncome) {
      setImportError(
        'Existem empréstimos marcados como receita. Reclassifique como “Empréstimo (dívida)” ou “Despesa” antes de confirmar.'
      );
      return;
    }

    setSaving(true);
    setImportError(null);
    try {
      const payloadRows: Array<
        Omit<
          FinancialTransaction,
          'id' | 'ownerUid' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'
        >
      > = previewRows.map((r) => {
        const matchedProj = data.projects.find(
          (p) => p.name.toLowerCase() === r.projectName.toLowerCase()
        );
        return {
          date: r.date,
          dueDate: r.date,
          description: clampStr(r.description, 200),
          entryKind: r.entryKind,
          category:
            r.entryKind === 'loan' ? 'Empréstimo' : clampStr(r.category, 60),
          projectId: matchedProj?.id || 'Empresa',
          projectName: clampStr(matchedProj?.name || r.projectName || 'Empresa', 160),
          amount: r.amount,
          isForecast: false,
          status:
            r.entryKind === 'loan'
              ? 'Não é receita'
              : r.entryKind === 'income'
              ? 'Recebido'
              : 'Pago',
          invoiceStatus: r.entryKind === 'income' ? 'A emitir' : 'Não se aplica',
          paymentMethod: 'Transferência',
          installmentLabel: '',
          quoteId: '',
          debtId: '',
          source: 'planilha',
        };
      });

      await importTransactionsBatch(uid, importActor, payloadRows, 'planilha');
      setFeedback({
        tone: 'ok',
        title: 'Importação confirmada e salva',
        text: `${payloadRows.length} movimento(s) gravados com origem “planilha”. Empréstimos foram separados em dívidas e meses vazios permaneceram sem registro.`,
      });
      setPreviewRows([]);
      setSheetData(null);
      setCsvText('');
      setSkippedRowsCount(0);
      setImportStep(1);
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);

    if (!currentPassword) {
      setPasswordError('Informe a senha atual para confirmar sua identidade.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('A confirmação da nova senha não confere.');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('A nova senha deve ser diferente da senha atual.');
      return;
    }
    const user = auth.currentUser;
    if (!user || !user.email) {
      setPasswordError('Sessão da empresa não encontrada. Entre novamente.');
      return;
    }

    setPasswordBusy(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      await logSecurityAudit(
        uid,
        passwordActor,
        'Senha de acesso único da empresa alterada',
        'Credencial anterior',
        'Nova senha definida'
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordModalOpen(false);
      setFeedback({
        tone: 'ok',
        title: 'Senha alterada com sucesso',
        text: 'A nova senha já está ativa para o acesso único da empresa e a alteração foi registrada na auditoria.',
      });
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential' ||
        code === 'auth/invalid-login-credentials'
      ) {
        setPasswordError('Senha atual incorreta.');
      } else if (code === 'auth/weak-password') {
        setPasswordError('A nova senha é muito fraca. Use ao menos 6 caracteres.');
      } else if (code === 'auth/requires-recent-login') {
        setPasswordError(
          'Por segurança, saia e entre novamente no sistema antes de trocar a senha.'
        );
      } else {
        setPasswordError(
          'Não foi possível atualizar a senha agora. Tente novamente em instantes.'
        );
      }
    } finally {
      setPasswordBusy(false);
    }
  }

  const sortedAuditLogs = useMemo(() => {
    return [...data.auditLogs].sort((a, b) => {
      const getMs = (ts: unknown): number => {
        if (
          ts &&
          typeof ts === 'object' &&
          'toMillis' in ts &&
          typeof (ts as { toMillis: () => number }).toMillis === 'function'
        ) {
          return (ts as { toMillis: () => number }).toMillis();
        }
        return 0;
      };
      return getMs(b.createdAt) - getMs(a.createdAt);
    });
  }, [data.auditLogs]);

  const auditColumns: Array<DataListColumn<AuditLog>> = [
    {
      key: 'when',
      header: 'Quando',
      numeric: true,
      render: (log) => (
        <span className="text-[#5B6472] whitespace-nowrap">
          {formatTimestampBR(log.createdAt)}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Registrado por',
      render: (log) => <span className="font-medium text-[#14181F]">{log.registeredBy}</span>,
    },
    {
      key: 'action',
      header: 'Ação',
      render: (log) => <StatusBadge label={log.action} />,
    },
    {
      key: 'summary',
      header: 'O que mudou',
      render: (log) => <span className="text-[#14181F]">{log.summary}</span>,
    },
    {
      key: 'before',
      header: 'Antes',
      render: (log) => <span className="text-[#5B6472]">{log.beforeValue || '—'}</span>,
    },
    {
      key: 'after',
      header: 'Depois',
      render: (log) => <span className="text-[#14181F]">{log.afterValue || '—'}</span>,
    },
  ];

  const flaggedRowsCount = previewRows.filter((r) => r.flaggedLoan).length;
  const flaggedAsRevenueCount = previewRows.filter((r) => r.wasTaggedAsRevenue).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configurações"
        subtitle="Identidade da empresa, encargos, importação de planilhas, segurança e backup"
        companyEmail={companyEmail}
      />

      {feedback && (
        <AlertNote tone={feedback.tone} title={feedback.title}>
          {feedback.text}
        </AlertNote>
      )}

      {/* Desktop Tabs + Mobile ScrollableChips */}
      <div className="hidden md:block">
        <Tabs items={SETTINGS_TABS} active={tab} onChange={setTab} />
      </div>
      <div className="md:hidden">
        <ScrollableChips
          items={SETTINGS_TABS}
          active={tab}
          onChange={setTab}
          ariaLabel="Seções de configurações"
        />
      </div>

      {/* 1. Dados da empresa e identidade visual */}
      {tab === 'Dados da empresa' && (
        <form
          onSubmit={handleSaveCompany}
          className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start"
        >
          <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-[12px] p-5 flex flex-col gap-4">
            <h2 className="text-base font-bold text-[#14181F]">
              Dados cadastrais e fiscais
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="set-name" className="text-[13px] font-semibold text-[#14181F]">
                  Nome da empresa
                </label>
                <input
                  id="set-name"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="set-cnpj" className="text-[13px] font-semibold text-[#14181F]">
                  CNPJ
                </label>
                <input
                  id="set-cnpj"
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="set-addr" className="text-[13px] font-semibold text-[#14181F]">
                  Endereço fiscal
                </label>
                <input
                  id="set-addr"
                  value={fiscalAddress}
                  onChange={(e) => setFiscalAddress(e.target.value)}
                  placeholder="Rua, número, bairro, CEP"
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="set-city" className="text-[13px] font-semibold text-[#14181F]">
                  Cidade / UF
                </label>
                <input
                  id="set-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Valença · RJ"
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="set-email" className="text-[13px] font-semibold text-[#14181F]">
                  E-mail da empresa
                </label>
                <input
                  id="set-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="set-phone" className="text-[13px] font-semibold text-[#14181F]">
                  Telefone
                </label>
                <input
                  id="set-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(24) 00000-0000"
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
                />
              </div>
            </div>

            <RegisteredBySelect
              value={companyActor}
              onChange={setCompanyActor}
              id="set-company-actor"
            />

            <div className="flex justify-end pt-2">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </div>
          </section>

          <section className="bg-white border border-[#E4E1DA] rounded-[12px] p-5 flex flex-col gap-4">
            <h2 className="text-base font-bold text-[#14181F]">
              Identidade visual dos PDFs
            </h2>
            <p className="text-xs text-[#5B6472]">
              Aplicada automaticamente nos contratos, POPs e relatórios de DRE em PDF.
            </p>

            {/* Live PDF Header Preview */}
            <div className="border border-[#E4E1DA] rounded-[12px] p-4 bg-[#F6F5F2]">
              <CompanyPdfHeader
                settings={previewSettings}
                subtitle="Prévia do cabeçalho em contratos e POPs"
              />
            </div>

            {/* Logo Upload */}
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-[#14181F]">
                Logo da empresa
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[8px] border border-[#E4E1DA] bg-white text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer">
                  <ImagePlus className="w-4 h-4 text-[#1F3A5F]" />
                  <span>{logoDataUrl ? 'Trocar logo' : 'Enviar imagem da logo'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoUpload}
                    className="sr-only"
                  />
                </label>
                {logoDataUrl && (
                  <button
                    type="button"
                    onClick={() => setLogoDataUrl('')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-[#E4E1DA] text-xs font-semibold text-[#B42318] hover:bg-[#FDECEA] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remover logo
                  </button>
                )}
              </div>
              <span className="text-xs text-[#5B6472]">
                PNG, JPG ou WebP (redimensionada automaticamente para impressão nítida).
              </span>
            </div>

            {/* Accent Color Picker */}
            <div className="flex flex-col gap-2 pt-2 border-t border-[#E4E1DA]">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="set-accent" className="text-[13px] font-semibold text-[#14181F]">
                  Cor de destaque
                </label>
                <span className="text-xs font-mono text-[#5B6472]">{accentColor}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="set-accent"
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value.toUpperCase())}
                  className="w-10 h-9 rounded-[8px] border border-[#E4E1DA] cursor-pointer bg-white p-0.5"
                />
                {ACCENT_PRESETS.map((preset) => {
                  const selected = accentColor.toUpperCase() === preset.hex;
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => setAccentColor(preset.hex)}
                      title={preset.label}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border text-xs font-medium cursor-pointer ${
                        selected
                          ? 'border-[#1F3A5F] bg-[#E6EEFB] text-[#1F3A5F]'
                          : 'border-[#E4E1DA] bg-white text-[#5B6472] hover:bg-[#F0EEE9]'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: preset.hex }}
                        aria-hidden="true"
                      />
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-[#14181F] cursor-pointer pt-2 border-t border-[#E4E1DA]">
              <input
                type="checkbox"
                checked={pdfShowLogo}
                onChange={(e) => setPdfShowLogo(e.target.checked)}
                className="w-4 h-4 rounded border-[#E4E1DA]"
              />
              Incluir logo ou emblema no cabeçalho de contratos, POPs e relatórios
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Cabeçalho do PDF dos POPs
              <input className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]"
                value={popPdfHeader} maxLength={120} onChange={(event) => setPopPdfHeader(event.target.value)}
                placeholder="Procedimento Operacional Padrão" />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Rodapé do PDF dos POPs
              <input className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]"
                value={popPdfFooter} maxLength={120} onChange={(event) => setPopPdfFooter(event.target.value)} />
            </label>
          </section>
        </form>
      )}

      {/* 2. Parâmetros de encargos e meta de margem */}
      {tab === 'Encargos e meta' && (
        <form
          onSubmit={handleSaveParameters}
          className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start"
        >
          <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-[12px] p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-[#14181F]">
                Parâmetros de encargos (CLT) e meta de margem
              </h2>
              <StatusBadge
                label={
                  totalChargePct > 0
                    ? `Encargos configurados: ${totalChargePct.toFixed(2).replace('.', ',')}%`
                    : 'Não configurado'
                }
                tone={totalChargePct > 0 ? 'ok' : 'warn'}
              />
            </div>

            <AlertNote tone="warn" title="Validação obrigatória com o contador">
              Os valores abaixo não vêm preenchidos por estimativa. Informe e confirme cada alíquota de INSS, FGTS e provisões diretamente com o contador da empresa.
            </AlertNote>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="param-inss" className="text-[13px] font-semibold text-[#14181F]">
                  INSS patronal (%)
                </label>
                <input
                  id="param-inss"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={inssRate}
                  onChange={(e) => setInssRate(e.target.value)}
                  placeholder="Não configurado"
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums min-h-[42px]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="param-fgts" className="text-[13px] font-semibold text-[#14181F]">
                  FGTS (%)
                </label>
                <input
                  id="param-fgts"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={fgtsRate}
                  onChange={(e) => setFgtsRate(e.target.value)}
                  placeholder="Não configurado"
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums min-h-[42px]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="param-vac" className="text-[13px] font-semibold text-[#14181F]">
                  Provisão de férias + 1/3 (%)
                </label>
                <input
                  id="param-vac"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={vacationRate}
                  onChange={(e) => setVacationRate(e.target.value)}
                  placeholder="Não configurado"
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums min-h-[42px]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="param-13" className="text-[13px] font-semibold text-[#14181F]">
                  Provisão de 13º salário (%)
                </label>
                <input
                  id="param-13"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={thirteenthRate}
                  onChange={(e) => setThirteenthRate(e.target.value)}
                  placeholder="Não configurado"
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums min-h-[42px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-[#E4E1DA]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="param-date" className="text-[13px] font-semibold text-[#14181F]">
                  Data de vigência
                </label>
                <input
                  id="param-date"
                  type="date"
                  value={taxEffectiveDate}
                  onChange={(e) => setTaxEffectiveDate(e.target.value)}
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
                />
              </div>

              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label htmlFor="param-src" className="text-[13px] font-semibold text-[#14181F]">
                  Fonte / referência contábil
                </label>
                <input
                  id="param-src"
                  value={taxSource}
                  onChange={(e) => setTaxSource(e.target.value)}
                  placeholder="Ex.: Contador · Simples Nacional Anexo IV (a validar)"
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-[#E4E1DA]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="param-margin" className="text-[13px] font-semibold text-[#14181F]">
                  Meta de margem líquida das obras (%)
                </label>
                <input
                  id="param-margin"
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  value={targetMarginPct}
                  onChange={(e) => setTargetMarginPct(e.target.value)}
                  placeholder="Sem meta definida"
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums min-h-[42px]"
                />
                <span className="text-xs text-[#5B6472]">
                  Usada como referência em Orçamentos e DRE por obra.
                </span>
              </div>
              <RegisteredBySelect
                value={paramsActor}
                onChange={setParamsActor}
                id="set-params-actor"
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar parâmetros'}
              </Button>
            </div>
          </section>

          <Card title="Resumo vigente" subtitle="Calculado a partir dos valores salvos">
            <div className="flex flex-col gap-2.5 text-sm">
              <div className="flex justify-between py-1.5 border-b border-[#E4E1DA]">
                <span className="text-[#5B6472]">Total de encargos + provisões</span>
                <strong className="text-[#14181F] tabular-nums">
                  {totalChargePct > 0
                    ? `${totalChargePct.toFixed(2).replace('.', ',')}%`
                    : 'Sem dados'}
                </strong>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#E4E1DA]">
                <span className="text-[#5B6472]">Vigência</span>
                <strong className="text-[#14181F]">
                  {data.settings?.taxParamsEffectiveDate
                    ? formatDateBR(data.settings.taxParamsEffectiveDate)
                    : 'Não informada'}
                </strong>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#E4E1DA]">
                <span className="text-[#5B6472]">Fonte</span>
                <strong className="text-[#14181F] text-right max-w-[180px] truncate">
                  {data.settings?.taxParamsSource || 'A validar com contador'}
                </strong>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-[#5B6472]">Meta de margem</span>
                <strong className="text-[#14181F] tabular-nums">
                  {data.settings?.targetMarginPct && data.settings.targetMarginPct > 0
                    ? `${data.settings.targetMarginPct.toFixed(1).replace('.', ',')}%`
                    : 'Sem dados'}
                </strong>
              </div>
            </div>
          </Card>
        </form>
      )}

      {/* 3. Importar dados da planilha (CSV ou XLSX) */}
      {tab === 'Importar dados' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div
              className={`border rounded-[12px] px-4 py-3 text-sm font-semibold ${
                importStep === 1
                  ? 'border-[#1F3A5F] bg-[#E6EEFB] text-[#1F3A5F]'
                  : 'border-[#E4E1DA] bg-white text-[#1E7F5C]'
              }`}
            >
              1 · Enviar planilha (.csv ou .xlsx) {importStep > 1 ? '✓' : ''}
            </div>
            <div
              className={`border rounded-[12px] px-4 py-3 text-sm font-semibold ${
                importStep === 2
                  ? 'border-[#1F3A5F] bg-[#E6EEFB] text-[#1F3A5F]'
                  : importStep === 3
                  ? 'border-[#E4E1DA] bg-white text-[#1E7F5C]'
                  : 'border-[#E4E1DA] bg-white text-[#5B6472]'
              }`}
            >
              2 · Relacionar colunas {importStep === 3 ? '✓' : ''}
            </div>
            <div
              className={`border rounded-[12px] px-4 py-3 text-sm font-semibold ${
                importStep === 3
                  ? 'border-[#1F3A5F] bg-[#E6EEFB] text-[#1F3A5F]'
                  : 'border-[#E4E1DA] bg-white text-[#5B6472]'
              }`}
            >
              3 · Revisar e confirmar
            </div>
          </div>

          {importError && (
            <AlertNote tone="bad" title="Verifique a planilha">
              {importError}
            </AlertNote>
          )}

          {importStep === 1 && (
            <section className="bg-white border border-[#E4E1DA] rounded-[12px] p-6 flex flex-col gap-4">
              <h2 className="text-base font-bold text-[#14181F]">
                Importar planilha financeira atual (CSV ou XLSX)
              </h2>
              <p className="text-sm text-[#5B6472]">
                Envie um arquivo Excel (.xlsx) ou CSV (.csv/.txt). Nenhum registro é gravado antes de você relacionar as colunas e confirmar na revisão final. Meses sem movimentação permanecem vazios.
              </p>

              <label className="border-2 border-dashed border-[#E4E1DA] rounded-[12px] p-8 text-center flex flex-col items-center gap-2 cursor-pointer hover:bg-[#F6F5F2]">
                <Upload className="w-6 h-6 text-[#1F3A5F]" />
                <span className="text-sm font-semibold text-[#14181F]">
                  Selecionar arquivo .xlsx ou .csv
                </span>
                <span className="text-xs text-[#5B6472]">
                  Ou cole as linhas CSV manualmente abaixo
                </span>
                <input
                  type="file"
                  accept=".csv,.txt,.tsv,.xlsx"
                  onChange={handleSpreadsheetFileUpload}
                  className="sr-only"
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="csv-paste" className="text-[13px] font-semibold text-[#14181F]">
                  Colar linhas CSV manualmente
                </label>
                <textarea
                  id="csv-paste"
                  rows={5}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={
                    'Data;Descrição;Categoria;Valor;Obra\n02/11/2026;Parcela 19/24;Receita de obra;5200,00;Obra A'
                  }
                  className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm font-mono"
                />
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleAnalyzePastedCsv}
                  disabled={!csvText.trim()}
                >
                  Avançar para relacionar colunas
                </Button>
              </div>
            </section>
          )}

          {importStep === 2 && sheetData && (
            <section className="bg-white border border-[#E4E1DA] rounded-[12px] p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#14181F]">
                    Relacionar colunas da planilha
                  </h2>
                  <p className="text-xs text-[#5B6472]">
                    Arquivo: <strong>{sheetData.fileName}</strong> ({sheetData.sheetName}) ·{' '}
                    {sheetData.rawRows.length} linha(s) encontrada(s) · Nada salvo ainda
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setImportStep(1)}
                >
                  Enviar outro arquivo
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { key: 'dateCol' as const, label: 'Coluna de Data', required: true },
                  {
                    key: 'descriptionCol' as const,
                    label: 'Coluna de Descrição',
                    required: true,
                  },
                  {
                    key: 'categoryCol' as const,
                    label: 'Coluna de Categoria',
                    required: false,
                  },
                  { key: 'amountCol' as const, label: 'Coluna de Valor', required: true },
                  {
                    key: 'projectCol' as const,
                    label: 'Coluna de Obra / Centro',
                    required: false,
                  },
                  {
                    key: 'kindCol' as const,
                    label: 'Coluna de Tipo (opcional)',
                    required: false,
                  },
                ].map((field) => (
                  <Select
                    key={field.key}
                    label={field.label}
                    required={field.required}
                    value={String(columnMapping[field.key])}
                    onChange={(e) =>
                      setColumnMapping((prev) => ({
                        ...prev,
                        [field.key]: Number(e.target.value),
                      }))
                    }
                  >
                    <option value="-1">Não mapear (ignorar)</option>
                    {sheetData.headers.map((header, idx) => (
                      <option key={`${header}_${idx}`} value={String(idx)}>
                        {header}
                        {sheetData.rawRows[0]?.[idx]
                          ? ` (ex.: ${String(sheetData.rawRows[0][idx]).slice(0, 24)})`
                          : ''}
                      </option>
                    ))}
                  </Select>
                ))}
              </div>

              <div className="border border-[#E4E1DA] rounded-[12px] p-4 bg-[#F6F5F2] flex flex-col gap-2">
                <strong className="text-xs font-semibold text-[#14181F]">
                  Amostra das primeiras linhas lidas
                </strong>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-left text-[#5B6472] border-b border-[#E4E1DA]">
                        {sheetData.headers.map((h, i) => (
                          <th key={i} className="py-1.5 px-2 font-semibold whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheetData.rawRows.slice(0, 3).map((row, rIdx) => (
                        <tr key={rIdx} className="border-b border-[#E4E1DA]/70">
                          {sheetData.headers.map((_, cIdx) => (
                            <td key={cIdx} className="py-1.5 px-2 text-[#14181F] whitespace-nowrap">
                              {row[cIdx] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setImportStep(1)}>
                  Voltar
                </Button>
                <Button type="button" variant="primary" onClick={handleBuildPreview}>
                  Revisar movimentos
                </Button>
              </div>
            </section>
          )}

          {importStep === 3 && (
            <div className="flex flex-col gap-4">
              {flaggedRowsCount > 0 && (
                <AlertNote
                  tone="warn"
                  title={
                    flaggedAsRevenueCount > 0
                      ? 'Empréstimo lançado como faturamento sinalizado para reclassificação'
                      : 'Empréstimos identificados e separados de receita'
                  }
                >
                  {flaggedRowsCount} movimento(s) identificado(s) como empréstimo, financiamento ou conta garantida. Empréstimo nunca entra como faturamento — eles foram reclassificados para dívida e não podem ser salvos como receita.
                </AlertNote>
              )}

              <AlertNote tone="info" title="Revisão antes de gravar no banco">
                Todos os registros receberão origem <strong>“planilha”</strong>.{' '}
                {skippedRowsCount > 0
                  ? `${skippedRowsCount} linha(s) vazia(s) ou sem valor foram mantidas vazias (nunca preenchidas com zero).`
                  : 'Meses sem movimentação continuam vazios.'}
              </AlertNote>

              <section className="bg-white border border-[#E4E1DA] rounded-[12px] p-5 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-[#14181F]">
                    Movimentos prontos para confirmação ({previewRows.length})
                  </h2>
                  <button
                    type="button"
                    onClick={() => setImportStep(2)}
                    className="text-xs font-semibold text-[#1F3A5F] hover:underline cursor-pointer"
                  >
                    Ajustar colunas
                  </button>
                </div>

                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                        <th className="py-2.5 px-3 rounded-l-lg">Data</th>
                        <th className="py-2.5 px-3">Descrição</th>
                        <th className="py-2.5 px-3">Categoria original</th>
                        <th className="py-2.5 px-3">Classificação no sistema</th>
                        <th className="py-2.5 px-3">Obra / centro</th>
                        <th className="py-2.5 px-3 text-right">Valor</th>
                        <th className="py-2.5 px-3 rounded-r-lg text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => (
                        <tr
                          key={row.id}
                          className={`border-b border-[#E4E1DA] text-[13px] ${
                            row.wasTaggedAsRevenue ? 'bg-[#FBF1DC]/45' : ''
                          }`}
                        >
                          <td className="py-3 px-3 text-[#5B6472] tabular-nums whitespace-nowrap">
                            {formatDateBR(row.date)}
                          </td>
                          <td className="py-3 px-3 font-medium text-[#14181F]">
                            <div>{row.description}</div>
                            {row.wasTaggedAsRevenue && (
                              <div className="mt-1">
                                <Badge variant="warning">
                                  Sinalizado · empréstimo não é faturamento
                                </Badge>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-[#5B6472]">{row.rawCategory}</td>
                          <td className="py-3 px-3">
                            <select
                              aria-label={`Tipo de ${row.description}`}
                              value={row.entryKind}
                              onChange={(e) => {
                                const nextKind = e.target.value as TransactionKind;
                                setPreviewRows((prev) =>
                                  prev.map((p) =>
                                    p.id === row.id
                                      ? {
                                          ...p,
                                          entryKind: nextKind,
                                          category:
                                            nextKind === 'loan'
                                              ? 'Empréstimo'
                                              : nextKind === 'income'
                                              ? 'Receita de obra'
                                              : p.rawCategory !== '—'
                                              ? p.rawCategory
                                              : 'Outros',
                                        }
                                      : p
                                  )
                                );
                              }}
                              className="rounded-[8px] border border-[#E4E1DA] bg-white px-2.5 py-1.5 text-xs"
                            >
                              <option value="income" disabled={row.flaggedLoan}>
                                Receita
                              </option>
                              <option value="expense">Despesa</option>
                              <option value="loan">Empréstimo (dívida)</option>
                            </select>
                          </td>
                          <td className="py-3 px-3 text-[#5B6472]">{row.projectName}</td>
                          <td className="py-3 px-3 text-right font-semibold tabular-nums whitespace-nowrap">
                            {formatBRL(row.amount)}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewRows((prev) => prev.filter((p) => p.id !== row.id))
                              }
                              className="text-xs text-[#B42318] hover:underline cursor-pointer"
                            >
                              Remover
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden flex flex-col gap-3">
                  {previewRows.map((row) => (
                    <div
                      key={row.id}
                      className={`border rounded-[12px] p-4 flex flex-col gap-2 ${
                        row.wasTaggedAsRevenue
                          ? 'border-[#8A5200] bg-[#FBF1DC]/40'
                          : 'border-[#E4E1DA] bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-sm text-[#14181F]">{row.description}</strong>
                        <strong className="text-sm text-[#14181F] tabular-nums shrink-0">
                          {formatBRL(row.amount)}
                        </strong>
                      </div>
                      <span className="text-xs text-[#5B6472]">
                        {formatDateBR(row.date)} · {row.projectName} · Origem na planilha:{' '}
                        {row.rawCategory}
                      </span>
                      {row.wasTaggedAsRevenue && (
                        <Badge variant="warning">
                          Empréstimo sinalizado · não entra como receita
                        </Badge>
                      )}
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <select
                          aria-label={`Tipo de ${row.description}`}
                          value={row.entryKind}
                          onChange={(e) => {
                            const nextKind = e.target.value as TransactionKind;
                            setPreviewRows((prev) =>
                              prev.map((p) =>
                                p.id === row.id
                                  ? {
                                      ...p,
                                      entryKind: nextKind,
                                      category:
                                        nextKind === 'loan'
                                          ? 'Empréstimo'
                                          : nextKind === 'income'
                                          ? 'Receita de obra'
                                          : p.rawCategory !== '—'
                                          ? p.rawCategory
                                          : 'Outros',
                                    }
                                  : p
                              )
                            );
                          }}
                          className="rounded-[8px] border border-[#E4E1DA] bg-white px-2.5 py-1.5 text-xs flex-1"
                        >
                          <option value="income" disabled={row.flaggedLoan}>
                            Receita
                          </option>
                          <option value="expense">Despesa</option>
                          <option value="loan">Empréstimo (dívida)</option>
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewRows((prev) => prev.filter((p) => p.id !== row.id))
                          }
                          className="text-xs font-semibold text-[#B42318] px-2 py-1.5 cursor-pointer"
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <RegisteredBySelect
                  value={importActor}
                  onChange={setImportActor}
                  id="imp-actor"
                />

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setPreviewRows([]);
                      setSheetData(null);
                      setImportStep(1);
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={saving || previewRows.length === 0}
                    onClick={handleConfirmSpreadsheetImport}
                  >
                    {saving
                      ? 'Importando...'
                      : `Confirmar importação (${previewRows.length})`}
                  </Button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* 4. Segurança, backup e auditoria */}
      {tab === 'Segurança e auditoria' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section className="bg-white border border-[#E4E1DA] rounded-[12px] p-5 flex flex-col justify-between gap-4">
              <div className="flex flex-col gap-3">
                <h2 className="text-base font-bold text-[#14181F]">
                  Acesso único da empresa
                </h2>
                <div className="flex justify-between text-[13px] py-1.5 border-b border-[#E4E1DA]">
                  <span className="text-[#5B6472]">Conta autenticada</span>
                  <strong className="text-[#14181F]">
                    {companyEmail || email || 'Usuário único da empresa'}
                  </strong>
                </div>
                <AlertNote tone="soft" title="Quem registrou cada ação">
                  Como o login é único em nome da empresa, cada formulário exige o campo “Registrado por” para diferenciar Sócio e Responsável administrativo.
                </AlertNote>
              </div>
              <div className="flex justify-start">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setPasswordError(null);
                    setPasswordModalOpen(true);
                  }}
                >
                  <KeyRound className="w-4 h-4" /> Trocar senha
                </Button>
              </div>
            </section>

            <section className="bg-white border border-[#E4E1DA] rounded-[12px] p-5 flex flex-col justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-[#14181F] mb-1">
                  Backup dos dados
                </h2>
                <p className="text-sm text-[#5B6472]">
                  Exporte uma cópia completa dos dados em JSON estruturado ou em planilha multi-abas (.xlsx) e CSV.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => exportBackupJson(data)}
                >
                  <Download className="w-4 h-4" /> Exportar JSON
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void exportBackupWorkbookXlsx(data)}
                >
                  <FileSpreadsheet className="w-4 h-4" /> Exportar planilha (.xlsx)
                </Button>
                <Button
                  type="button"
                  variant="text"
                  onClick={() => exportTransactionsCsv(data)}
                >
                  Lançamentos (.csv)
                </Button>
              </div>
            </section>
          </div>

          <section className="bg-white border border-[#E4E1DA] rounded-[12px] p-5 flex flex-col gap-4">
            <h2 className="text-base font-bold text-[#14181F]">
              Histórico de alterações (auditoria)
            </h2>
            <DataList
              columns={auditColumns}
              rows={sortedAuditLogs.slice(0, 60)}
              keyExtractor={(log) => log.id}
              caption="Histórico de alterações registradas no sistema"
              emptyTitle="Nenhuma alteração registrada ainda"
              emptyDescription="Todas as criações, atualizações, exclusões, importações e trocas de senha ficam registradas aqui com antes, depois e quem registrou."
              renderMobileCard={(log) => (
                <div className="bg-white border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-xs font-semibold text-[#14181F]">
                      {log.registeredBy}
                    </strong>
                    <StatusBadge label={log.action} />
                  </div>
                  <p className="text-sm font-medium text-[#14181F]">{log.summary}</p>
                  {(log.beforeValue || log.afterValue) && (
                    <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-[#F0EEE9] text-xs">
                      <div>
                        <span className="block text-[#5B6472]">Antes</span>
                        <span className="text-[#14181F] break-words">
                          {log.beforeValue || '—'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[#5B6472]">Depois</span>
                        <span className="text-[#14181F] break-words">
                          {log.afterValue || '—'}
                        </span>
                      </div>
                    </div>
                  )}
                  <span className="text-xs text-[#5B6472] tabular-nums">
                    {formatTimestampBR(log.createdAt)}
                  </span>
                </div>
              )}
            />
          </section>
        </div>
      )}

      {/* Modal: Trocar senha */}
      <Modal
        open={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
        title="Trocar senha do acesso único"
        subtitle="Exige confirmação da senha atual e registra o evento na auditoria."
      >
        <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
          {passwordError && (
            <AlertNote tone="bad" title="Não foi possível alterar a senha">
              {passwordError}
            </AlertNote>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pwd-current" className="text-[13px] font-semibold text-[#14181F]">
              Senha atual
            </label>
            <input
              id="pwd-current"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pwd-new" className="text-[13px] font-semibold text-[#14181F]">
              Nova senha (mínimo 6 caracteres)
            </label>
            <input
              id="pwd-new"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pwd-confirm" className="text-[13px] font-semibold text-[#14181F]">
              Confirmar nova senha
            </label>
            <input
              id="pwd-confirm"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              className="w-full rounded-[8px] border border-[#E4E1DA] px-3.5 py-2.5 text-sm min-h-[42px]"
            />
          </div>

          <RegisteredBySelect
            value={passwordActor}
            onChange={setPasswordActor}
            id="pwd-actor"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPasswordModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={passwordBusy}>
              {passwordBusy ? 'Atualizando...' : 'Confirmar nova senha'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
