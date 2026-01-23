
export type UserRole = 'DIRETORIA' | 'ADM' | 'ESTOQUISTA' | 'VENDEDOR';
export type ModuleContext = 'ESTOQUE' | 'FINANCEIRO' | 'RH' | 'COMERCIAL' | null;

export type ViewType = 
  | 'SELECAO_MODULO' 
  | 'INVENTARIO' 
  | 'CONFERENCIA_INVENTARIO' 
  | 'HISTORICO_HUB' 
  | 'ENTRADA' 
  | 'SAIDA' 
  | 'CATALOGO_MESTRE' 
  | 'GESTAO_USUARIOS' 
  | 'LANCAMENTO_RECEBER'
  | 'INADIMPLENCIA' 
  | 'CONTAS_PAGAR'
  | 'BI_CAIXA' 
  | 'BI_DESPESAS'
  | 'BI_ESTOQUE'
  | 'RH_COLLABORATORS'
  | 'RH_PAYROLL'
  | 'RH_SERVICE_ORDERS'
  | 'SALES_PRICETABLE' 
  | 'SALES_HISTORY'   
  | 'SALES_BI'
  | 'CRM'
  | 'CONFIGURACOES'
  | 'MOVEMENTS_LIST';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  password?: string;
  active: boolean;
  permissions?: string[]; 
}

export enum WithdrawalReason {
  VENDA = 'Venda',
  TROCA = 'Troca',
  DEFEITO = 'Defeito',
  AJUSTE = 'Ajuste',
  AUDITORIA = 'Auditoria'
}

export interface StockItem {
  lpn: string;
  sku: string;
  nome: string;
  categoria: string;
  marca: string;
  fornecedor: string;
  lote: string;
  nfControle?: string;
  larguraL: number;
  quantMl: number;
  custoUnitario: number;
  coluna: string;
  prateleira: string;
  nCaixa?: string;
  statusRolo: string;
  observacao?: string;
  dataEntrada: string;
  ultAtuali: string;
  responsavel: string;
  motivoEntrada?: string;
  metragemPadrao?: number;
  estoqueMinimo?: number;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  usuario: string;
  acao: string;
  sku?: string;
  lpn?: string;
  quantidade?: number;
  detalhes: string;
  lote?: string;
  nome?: string;
  valorOperacao?: number; 
  nfControle?: string;
  tipo?: string;
  categoria?: string;
  cliente?: string;
  motivo?: string;
  dataPedidoFornecedor?: string;
}

export interface MasterProduct {
  sku: string;
  nome: string;
  categoria: string;
  marca?: string;
  fornecedor?: string;
  larguraL?: number;
  metragemPadrao?: number;
  estoqueMinimo: number;
  custoUnitario?: number;
  custoUnitarioFrac?: number; // Novo
  custoUnitarioRolo?: number; // Novo
  costTaxPercent?: number;
  costExtraValue?: number;
  precoVenda?: number;
  ncmCode?: string;
  taxOrigin?: number;
  supplierState?: string;
  costUnit?: string;
  priceRoloMin?: number;
  priceRoloIdeal?: number;
  priceFracMin?: number;
  priceFracIdeal?: number;
  active?: boolean;
  updatedAt?: string;
}

export interface CompanySettings {
  name: string;
  cnpj: string;
  address: string;
  logoUrl: string;
}

export interface InventoryUpdateStaging {
  item: Partial<StockItem>;
  status: 'NEW' | 'CHANGED' | 'DELETED' | 'UNCHANGED';
  diff?: string[];
}

export interface InventorySession {
  id: string;
  startTime: string;
  endTime?: string;
  responsible: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  itemsCount: number;
  posAdjustments: number;
  negAdjustments: number;
  observation?: string;
  durationSeconds?: number;
}

export interface AppNotification {
  id: string;
  titulo: string;
  mensagem: string;
  timestamp: string;
  lida: boolean;
  clienteTarget?: string;
}

export interface WarehouseLayout {
  columns: string[];
  shelvesPerColumn: Record<string, string[]>;
}

export interface AccountsPayable {
  id: string;
  fornecedor: string;
  dataEmissao: string;
  dataVencimento: string;
  dataLiquidacao: string;
  valorDocumento: number;
  saldo: number;
  situacao: string;
  numero_documento: string;
  categoria: string;
  historico: string;
  valorPago: number;
  competencia: string;
  formaPagamento: string;
  chavePixBoleto: string;
}

export interface APStagingItem {
  data: AccountsPayable;
  status: 'NEW' | 'CHANGED' | 'UNCHANGED';
  diff?: string[];
}

export interface ARStagingItem {
  data: AccountsReceivable;
  status: 'NEW' | 'CHANGED' | 'UNCHANGED';
  diff?: string[];
}

export interface Settlement {
  id: string;
  cliente: string;
  valorOriginal: number;
  valorAcordo: number;
  parcelas: number;
  intervaloDias: number;
  frequencia: 'Semanal' | 'Quinzenal' | 'Mensal';
  dataPrimeiraParcela: string;
  dataCriacao: string;
  status: 'ATIVO' | 'FINALIZADO' | 'LIQUIDADO' | 'CANCELADO';
  usuario: string;
  observacao?: string;
  titulosNegociados?: string[]; 
}

export interface AccountsReceivable {
  id: string;
  cliente: string;
  data_emissao: string;
  data_vencimento: string;
  data_liquidacao?: string | null;
  data_recebimento?: string | null;
  valor_documento: number;
  saldo: number;
  situacao: string;
  numero_documento: string;
  numero_banco?: string;
  categoria: string;
  historico: string;
  competencia: string;
  forma_pagamento: string;
  meio_recebimento: string;
  taxas: number;
  valor_recebido: number;
  valor_recebido_csv?: number;
  origem?: string;
  id_acordo?: string;
  statusCobranca?: string;
}

export interface DebtorInfo {
  cliente: string;
  totalVencido: number;
  vencidoAte15d: number;
  vencidoMais15d: number;
  enviarCartorio: number;
  emAcordo: number;
  acordoAtrasado?: number; // Novo Campo: Rastreia valor de parcelas de acordo vencidas
  qtdTitulos: number;
  statusCobranca: string;
  protocoloAtual: string;
  enviadoCartorio: boolean;
  nextActionDate?: string;
}

export interface ApprovalCase {
  id: string;
  timestamp: string;
  status: 'PENDENTE' | 'APROVADO' | 'RECUSADO';
  sku: string;
  motivo: string;
  lpn?: string;
  solicitante: string;
  cliente?: string;
  quantidade: number;
  pedido?: string;
  aprovador?: string;
  parecer?: string;
}

export interface InboundRequest {
  id: string;
  timestamp: string;
  solicitante: string;
  status: 'PENDENTE' | 'APROVADO' | 'RECUSADO';
  items: Partial<StockItem>[];
  aprovador?: string;
  relato?: string;
}

export interface CollectionHistory {
  id: string;
  cliente: string;
  data_registro: string;
  dias_atraso: number;
  valor_devido: number;
  acao_tomada: string;
  data_proxima_acao?: string;
  observacao?: string;
  usuario: string;
}

export interface Employee {
  id?: string;
  fullName: string;
  cpf: string;
  jobTitle: string;
  department: string;
  hireDate: string;
  salaryAmount: number;
  contractType: 'CLT' | 'PJ' | 'ESTAGIO' | 'APRENDIZ' | 'OUTRO';
  status: 'ACTIVE' | 'VACATION' | 'TERMINATED';
  email: string;
  phone: string;
  pixKey: string;
  notes: string;
  transportDailyValue?: number;
}

export interface HRDocument {
  id: string;
  employeeId: string;
  documentType: string;
  fileUrl: string;
  fileName: string;
  uploadedAt: string;
}

export interface PayrollItem {
  id?: string;
  description: string;
  type: 'EARNING' | 'DEDUCTION';
  amount: number;
  referenceValue?: string;
}

export interface PayrollRun {
  id?: string;
  employeeId: string;
  employeeName?: string;
  employeeRole?: string;
  referenceDate: string;
  baseSalary: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  status: 'DRAFT' | 'CLOSED';
  paymentDate?: string;
  items: PayrollItem[];
  notes?: string;
}

export interface LeaveRecord {
  id?: string;
  employeeId: string;
  type: 'FERIAS' | 'ATESTADO' | 'MATERNIDADE' | 'OUTROS' | 'FALTA';
  startDate: string;
  endDate: string;
  durationDays: number;
  vestingStart?: string;
  vestingEnd?: string;
  status: 'AGENDADO' | 'EM_ANDAMENTO' | 'CONCLUIDO';
  notes?: string;
}

export interface SalesHistoryItem {
  id?: string;
  externalId?: string;
  orderNumber?: string;
  saleDate?: string;
  expectedDate?: string;
  status?: string;
  notes?: string;
  contactId?: string;
  contactName?: string;
  personType?: string;
  cpfCnpj?: string;
  rgIe?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  zipCode?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  productIdExternal?: string;
  sku?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  itemDiscount?: number;
  orderDiscount?: number;
  orderFreight?: number;
  orderExpenses?: number;
  proratedDiscount?: number;
  proratedFreight?: number;
  proratedExpenses?: number;
  trackingCode?: string;
  salesRep?: string;
  purchaseOrderNumber?: string;
  recipientName?: string;
  recipientCpfCnpj?: string;
  recipientZipCode?: string;
  recipientAddress?: string;
  recipientAddressNumber?: string;
  recipientComplement?: string;
  recipientNeighborhood?: string;
  recipientCity?: string;
  recipientState?: string;
  recipientPhone?: string;
  importedAt?: string;
  totalAmount?: number;
  totalFreight?: number;
}

// --- TIPOS DO CRM ---
export type CRMStatus = 'PROSPECCAO' | 'QUALIFICADO' | 'NEGOCIACAO' | 'GANHO' | 'PERDIDO';

export interface CRMOpportunity {
  id?: string;
  clientName: string;
  companyName?: string;
  phone?: string;
  instagramLink?: string; // Novo
  prospector?: string;    // Novo (SDR)
  attendant?: string;     // Novo (Closer)
  status: CRMStatus;
  nextFollowUp?: string;
  notes?: string;
  createdAt?: string;
  ownerId?: string;
}

export interface CRMInteraction {
  id: string;
  opportunityId: string;
  userName: string;
  content: string;
  createdAt: string;
}
