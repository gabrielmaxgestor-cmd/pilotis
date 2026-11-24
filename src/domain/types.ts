export type ActorRole = 'Sócio' | 'Responsável administrativo';

export interface AuditFields {
  createdBy: ActorRole;
  createdAt: string;
  updatedBy: ActorRole;
  updatedAt: string;
}

export interface TaxChargeParameters {
  inssPct: number;
  fgtsPct: number;
  feriasPct: number;
  decimoTerceiroPct: number;
  vigenciaInicio: string;
  vigenciaFim?: string;
  fonte?: string;
}

/* 1. config */
export interface ConfigRecord extends AuditFields {
  id: string;
  nomeEmpresa: string;
  cnpj: string;
  enderecoFiscal: string;
  cidade: string;
  emailEmpresa: string;
  telefone: string;
  corDestaque: string;
  exibirEmblemaPdf: boolean;
  parametrosEncargos: TaxChargeParameters | null;
}

/* 2. clientes */
export type ClienteStatus = 'Potencial' | 'Ativo' | 'Em garantia' | 'Inativo';
export interface ClienteRecord extends AuditFields {
  id: string;
  nome: string;
  origem: string;
  cidade: string;
  telefone: string;
  email: string;
  observacoes: string;
  status: ClienteStatus;
  indicacoesCount: number;
  statusDepoimento: string;
}

/* 3. orcamentos */
export type ObraTipo = 'Casa residencial' | 'Reforma' | 'Obra satélite';
export type OrcamentoStatus =
  | 'Rascunho'
  | 'Enviado'
  | 'Em negociação'
  | 'Ganho'
  | 'Perdido'
  | 'Descartado';

export interface OrcamentoRecord extends AuditFields {
  id: string;
  codigo: string;
  clienteId: string;
  clienteNome: string;
  titulo: string;
  tipo: ObraTipo;
  cidade: string;
  areaM2: number;
  prazoMeses: number;
  validadeDias: number;
  descricao: string;
  custoMaoDeObra: number;
  custoEmpreita: number;
  custoEquipamentos: number;
  custoBdi: number;
  custoImpostos: number;
  valorTotal: number;
  entradaPct: number;
  numeroParcelas: number;
  probabilidadePct: number;
  status: OrcamentoStatus;
  motivoDescarte?: string;
  obraId?: string;
}

/* 4. obras */
export type ObraStatus = 'Em execução' | 'Concluída';
export interface ObraRecord extends AuditFields {
  id: string;
  nome: string;
  orcamentoId?: string;
  clienteId?: string;
  clienteNome: string;
  tipo: ObraTipo;
  valorContrato: number;
  orcadoMaoDeObra: number;
  orcadoEmpreita: number;
  orcadoEquipamentos: number;
  orcadoBdi: number;
  orcadoImpostos: number;
  dataInicio: string;
  dataFimBaseline: string;
  dataFimPrevista: string;
  status: ObraStatus;
  contratoAssinado: boolean;
  dataInicioGarantia?: string;
}

/* 5. parcelas */
export type ParcelaStatusArmazenado = 'A vencer' | 'Recebida';
export type ParcelaStatus = ParcelaStatusArmazenado | 'Em atraso';
export type NotaFiscalStatus = 'Emitida' | 'A emitir' | 'Não emitida' | 'Não se aplica';

export interface ParcelaRecord extends AuditFields {
  id: string;
  obraId: string;
  orcamentoId?: string;
  numero: number;
  rotulo: string;
  vencimento: string;
  valor: number;
  status: ParcelaStatus;
  notaFiscal: NotaFiscalStatus;
  dataRecebimento?: string;
}

/* 6. lancamentos */
export type LancamentoTipo = 'receita' | 'despesa' | 'emprestimo';
export type LancamentoStatus =
  | 'Recebido'
  | 'Pago'
  | 'A vencer'
  | 'Em atraso'
  | 'Não é receita';

export interface LancamentoRecord extends AuditFields {
  id: string;
  data: string;
  vencimento: string;
  descricao: string;
  tipo: LancamentoTipo;
  categoria: string;
  obraId: string;
  valor: number;
  previsto: boolean;
  originalmentePrevisto?: boolean;
  statementKey?: string;
  status: LancamentoStatus;
  notaFiscal: NotaFiscalStatus;
  formaPagamento: string;
  origem: 'manual' | 'orcamento' | 'planilha' | 'extrato' | 'folha';
  parcelaId?: string;
  dividaId?: string;
}

/* 7. contasPagar */
export type ContaPagarStatus = 'A vencer' | 'Paga' | 'Em atraso';
export interface ContaPagarRecord extends AuditFields {
  id: string;
  fornecedor: string;
  descricao: string;
  categoria: string;
  obraId: string;
  vencimento: string;
  valor: number;
  status: ContaPagarStatus;
  dataPagamento?: string;
}

/* 8. dividas */
export type DividaTipo =
  | 'Empréstimo bancário'
  | 'Conta garantida'
  | 'Tributo em atraso'
  | 'Encargos trabalhistas'
  | 'Outro';
export type DividaStatus = 'Em dia' | 'Em uso' | 'Em atraso' | 'A parcelar' | 'Quitada';

export interface DividaRecord extends AuditFields {
  id: string;
  credor: string;
  tipo: DividaTipo;
  saldoDevedor: number;
  custoMensal: number;
  parcelasRestantes: number;
  proximoVencimento: string;
  status: DividaStatus;
  observacoes?: string;
}

/* 9. colaboradores */
export type VinculoTipo = 'CLT' | 'Autônomo' | 'Diarista';
export interface ColaboradorRecord extends AuditFields {
  id: string;
  nome: string;
  funcao: string;
  vinculo: VinculoTipo;
  salarioBase: number;
  formaPagamento: string;
  dataAdmissao: string;
  obraAtualId?: string;
  asoValidade?: string;
  nr18Validade?: string;
  nr35Validade?: string;
  statusEpi: 'Em dia' | 'A repor' | 'Pendente';
  statusIntegracao: 'Concluída' | 'Em andamento' | 'Pendente';
}

/* 10. alocacoes */
export interface AlocacaoRecord extends AuditFields {
  id: string;
  colaboradorId: string;
  obraId: string;
  semanaInicio: string;
  status: 'Obra' | 'Férias';
}

/* 11. ferias */
export type FeriasStatus = 'A programar' | 'Programada' | 'Em gozo' | 'Concluída';
export interface FeriasRecord extends AuditFields {
  id: string;
  colaboradorId: string;
  periodoAquisitivo: string;
  dataInicio: string;
  dataFim: string;
  status: FeriasStatus;
}

/* 12. capacitacoes */
export type CapacitacaoStatus = 'Válida' | 'Vence em breve' | 'Vencida' | 'Pendente';
export interface CapacitacaoRecord extends AuditFields {
  id: string;
  colaboradorId: string;
  titulo: string;
  tipo: 'NR-18' | 'NR-35' | 'ASO' | 'POP' | 'Integração' | 'Outro';
  dataRealizacao?: string;
  dataValidade?: string;
  status: CapacitacaoStatus;
}

/* 13. etapas */
export type EtapaStatus =
  | 'A fazer'
  | 'Em andamento'
  | 'Aguardando material'
  | 'Em conferência'
  | 'Concluída';

export interface EtapaRecord extends AuditFields {
  id: string;
  obraId: string;
  codigoEap: string;
  fase: string;
  nome: string;
  responsavel: string;
  semanaInicio: number;
  duracaoSemanas: number;
  progressoPct: number;
  custoOrcado: number;
  dependencias: string[];
  marco: boolean;
  status: EtapaStatus;
  popId?: string;
  dataPrevistaMaterial?: string;
  categoriaAtraso?: string;
  justificativaAtraso?: string;
}

/* 14. diario */
export type ClimaTipo = 'Sol' | 'Chuva fraca' | 'Chuva forte';
export interface DiarioRecord extends AuditFields {
  id: string;
  obraId: string;
  data: string;
  equipePresente: number;
  clima: ClimaTipo;
  atividades: string;
  ocorrencias?: string;
  fotos: string[];
}

/* 15. riscos */
export type RiscoNivel = 'Baixo' | 'Médio' | 'Alto';
export type RiscoStatus = 'Monitorando' | 'Mitigado' | 'Materializado';
export interface RiscoRecord extends AuditFields {
  id: string;
  obraId: string;
  descricao: string;
  categoria: 'Material do cliente' | 'Clima' | 'Mão de obra' | 'Prazo' | 'Financeiro' | 'Outro';
  probabilidade: RiscoNivel;
  impacto: RiscoNivel;
  planoAcao: string;
  status: RiscoStatus;
}

/* 16. baselines */
export interface BaselineEtapaItem {
  etapaId: string;
  semanaInicioBaseline: number;
  duracaoBaselineSemanas: number;
  custoOrcadoBaseline: number;
}

export interface BaselineRecord extends AuditFields {
  id: string;
  obraId: string;
  nome: string;
  dataCriacao: string;
  dataFimPrevista: string;
  etapas: BaselineEtapaItem[];
}

/* 17. pops */
export type PopStatus = 'Vigente' | 'Em revisão';
export interface PopRecord extends AuditFields {
  id: string;
  titulo: string;
  tipoServico: string;
  versaoAtual: string;
  faseVinculada: string;
  objetivo: string;
  materiaisEpi: string;
  passos: string[];
  criteriosAceitacao: string[];
  status: PopStatus;
  usadoIntegracao: boolean;
}

/* 18. versoes */
export interface VersaoPopRecord extends AuditFields {
  id: string;
  popId: string;
  versao: string;
  resumoMudanca: string;
  dataVigencia: string;
}

/* 19. obrigacoes */
export type ObrigacaoStatus = 'Em dia' | 'Vence em breve' | 'Em atraso' | 'Pendente';
export interface ObrigacaoRecord extends AuditFields {
  id: string;
  titulo: string;
  categoria: string;
  competencia: string;
  vencimento: string;
  status: ObrigacaoStatus;
  arquivo?: string;
}

/* 20. certidoes */
export type CertidaoStatus = 'Válida' | 'Vence em breve' | 'Vencida' | 'Pendente';
export interface CertidaoRecord extends AuditFields {
  id: string;
  titulo: string;
  esfera: 'Federal' | 'Estadual' | 'Municipal' | 'FGTS' | 'Trabalhista' | 'Outro';
  dataEmissao?: string;
  dataValidade: string;
  status: CertidaoStatus;
  arquivo?: string;
}

/* 21. documentos */
export type DocumentoObraStatus = 'Anexado' | 'Pendente' | 'Vencido';
export interface DocumentoObraRecord extends AuditFields {
  id: string;
  obraId: string;
  titulo: string;
  obrigatorio: boolean;
  vencimento?: string;
  arquivo?: string;
  status: DocumentoObraStatus;
}

/* 22. licitacoes */
export type LicitacaoStatus =
  | 'Acompanhando'
  | 'Em preparo'
  | 'Documentos pendentes'
  | 'Enviado'
  | 'Encerrado';
export interface LicitacaoRecord extends AuditFields {
  id: string;
  orgao: string;
  objeto: string;
  dataAbertura: string;
  valorEstimado: number;
  status: LicitacaoStatus;
  observacoes?: string;
}

/* 23. garantias */
export type GarantiaStatus = 'Aberto' | 'Em atendimento' | 'Resolvido';
export interface GarantiaRecord extends AuditFields {
  id: string;
  obraId: string;
  descricao: string;
  dataAbertura: string;
  prazoAtendimento: string;
  custo: number;
  status: GarantiaStatus;
}

/* 24. auditoria */
export interface AuditoriaRecord {
  id: string;
  registradoPor: ActorRole;
  acao: 'Criação' | 'Atualização' | 'Exclusão' | 'Importação';
  entidade: CollectionName | string;
  registroId: string;
  resumo: string;
  valorAnterior?: string;
  valorNovo?: string;
  criadoEm: string;
}

export const COLLECTION_NAMES = [
  'config',
  'clientes',
  'orcamentos',
  'obras',
  'parcelas',
  'lancamentos',
  'contasPagar',
  'dividas',
  'colaboradores',
  'alocacoes',
  'ferias',
  'capacitacoes',
  'etapas',
  'diario',
  'riscos',
  'baselines',
  'pops',
  'versoes',
  'obrigacoes',
  'certidoes',
  'documentos',
  'licitacoes',
  'garantias',
  'auditoria',
] as const;

export type CollectionName = (typeof COLLECTION_NAMES)[number];

export interface DomainCollections {
  config: ConfigRecord | null;
  clientes: ClienteRecord[];
  orcamentos: OrcamentoRecord[];
  obras: ObraRecord[];
  parcelas: ParcelaRecord[];
  lancamentos: LancamentoRecord[];
  contasPagar: ContaPagarRecord[];
  dividas: DividaRecord[];
  colaboradores: ColaboradorRecord[];
  alocacoes: AlocacaoRecord[];
  ferias: FeriasRecord[];
  capacitacoes: CapacitacaoRecord[];
  etapas: EtapaRecord[];
  diario: DiarioRecord[];
  riscos: RiscoRecord[];
  baselines: BaselineRecord[];
  pops: PopRecord[];
  versoes: VersaoPopRecord[];
  obrigacoes: ObrigacaoRecord[];
  certidoes: CertidaoRecord[];
  documentos: DocumentoObraRecord[];
  licitacoes: LicitacaoRecord[];
  garantias: GarantiaRecord[];
  auditoria: AuditoriaRecord[];
}
