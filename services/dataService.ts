
import { supabaseClient as supabase } from './core';
import { InventoryService } from './inventoryService';
import { UserService } from './userService';
import { FinanceService } from './financeService';
import { 
  StockItem, User, MasterProduct, AuditLog, 
  InventoryUpdateStaging, WithdrawalReason, 
  ApprovalCase, InboundRequest, DebtorInfo, 
  SalesHistoryItem, CRMOpportunity, CompanySettings, InventorySession, CRMInteraction
} from '../types';

export class DataService {
  // --- INVENTORY DELEGATION ---
  static async getInventory(): Promise<StockItem[]> {
    return InventoryService.getInventory();
  }

  static async getLogsByLpn(lpn: string): Promise<AuditLog[]> {
    return InventoryService.getLogsByLpn(lpn);
  }

  static async updateStockItem(item: StockItem, user: User): Promise<{success: boolean, message?: string}> {
    return InventoryService.updateStockItem(item, user);
  }

  static async addLog(user: User, action: string, sku: string, lpn: string, qty: number, details: string, lote?: string, name?: string, valorOperacao?: number, nfControle?: string, tipo?: string, category?: string, motivo?: string, cliente?: string) {
    return InventoryService.addLog(user, action, sku, lpn, qty, details, lote, name, valorOperacao, nfControle, tipo, category, motivo, cliente);
  }

  static async getLogs(): Promise<AuditLog[]> {
    return InventoryService.getLogs();
  }

  static async getLayout() {
    return InventoryService.getLayout();
  }

  static async saveLayout(layout: any) {
    return InventoryService.saveLayout(layout);
  }

  static async processInboundBatch(items: StockItem[], user: User, filename?: string) {
    return InventoryService.processInboundBatchAtomic(items, user);
  }

  static async processWithdrawalBatch(items: any[], user: User) {
    return InventoryService.processWithdrawalBatchAtomic(items, user);
  }
  
  static async registerWithdrawalBatch(items: any[], user: User) {
    return this.processWithdrawalBatch(items, user);
  }

  static async processInventoryUpdateStaging(items: any[]) {
    return InventoryService.processInventoryUpdateStaging(items);
  }

  static async commitInventoryBatch(staging: InventoryUpdateStaging[], user: User) {
    return InventoryService.commitInventoryBatch(staging, user);
  }

  static async saveInventorySession(session: InventorySession) {
    return InventoryService.saveInventorySession(session);
  }

  static async getInventorySessions() {
    return InventoryService.getInventorySessions();
  }

  static async setAuditLock(lock: any) {
    if (lock) {
       localStorage.setItem('nz_audit_lock', JSON.stringify(lock));
    } else {
       localStorage.removeItem('nz_audit_lock');
    }
    return true;
  }

  // --- USER / SETTINGS DELEGATION ---
  static async login(email: string, pass: string) {
    return UserService.login(email, pass);
  }

  static async getUsers() {
    return UserService.getUsers();
  }

  static async saveUser(user: User, admin: User) {
    return UserService.saveUser(user);
  }

  static async deleteUser(id: string, admin: User) {
    if (!supabase) return false;
    const { error } = await supabase.from('users').delete().eq('id', id);
    return !error;
  }

  static async getCompanySettings() {
    return UserService.getCompanySettings();
  }

  static async saveCompanySettings(settings: CompanySettings) {
    return UserService.saveCompanySettings(settings);
  }

  // --- FINANCE DELEGATION ---
  static async getAccountsPayable() {
    return FinanceService.getAccountsPayable();
  }

  static async getLastAPImport() {
    return FinanceService.getLastAPImport();
  }

  static async processAPStaging(items: any[]) {
    return FinanceService.processAPStaging(items);
  }

  static async commitAPBatch(staging: any[], user: User, fileName?: string) {
    return FinanceService.commitAPBatch(staging, user, fileName);
  }

  // --- MASTER CATALOG ---
  static async getMasterCatalog(): Promise<MasterProduct[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('master_catalog').select('*').order('sku', { ascending: true });
    if (error) throw error;
    return (data || []).map(p => ({
        sku: p.sku,
        nome: p.nome,
        categoria: p.categoria,
        marca: p.marca,
        fornecedor: p.fornecedor,
        larguraL: Number(p.largura_l),
        metragemPadrao: Number(p.metragem_padrao),
        estoqueMinimo: Number(p.estoque_minimo),
        custoUnitario: Number(p.custo_unitario),
        precoVenda: Number(p.preco_venda),
        custoUnitarioFrac: Number(p.custo_unitario_frac ?? p.custo_unitario),
        custoUnitarioRolo: Number(p.custo_unitario_rolo ?? p.custo_unitario),
        costExtraValue: Number(p.cost_extra_value),
        costTaxPercent: Number(p.cost_tax_percent),
        priceRoloMin: Number(p.price_rolo_min),
        priceRoloIdeal: Number(p.price_rolo_ideal),
        priceFracMin: Number(p.price_frac_min),
        priceFracIdeal: Number(p.price_frac_ideal),
        active: p.active,
        updatedAt: p.updated_at,
        taxOrigin: p.tax_origin,
        ncmCode: p.ncm_code,
        supplierState: p.supplier_state
    }));
  }

  static async updateMasterProduct(product: Partial<MasterProduct>, user: User, originalSku: string): Promise<{ success: boolean; message?: string; warning?: string }> {
    if (!supabase) return { success: false, message: 'Offline' };
    
    const payload = {
        sku: product.sku,
        nome: product.nome,
        categoria: product.categoria,
        marca: product.marca,
        fornecedor: product.fornecedor,
        largura_l: product.larguraL,
        metragem_padrao: product.metragemPadrao,
        estoque_minimo: product.estoqueMinimo,
        custo_unitario: product.custoUnitario,
        preco_venda: product.precoVenda,
        active: product.active,
        custo_unitario_frac: product.custoUnitarioFrac,
        custo_unitario_rolo: product.custoUnitarioRolo,
        cost_extra_value: product.costExtraValue,
        cost_tax_percent: product.costTaxPercent,
        price_rolo_min: product.priceRoloMin,
        price_rolo_ideal: product.priceRoloIdeal,
        price_frac_min: product.priceFracMin,
        price_frac_ideal: product.priceFracIdeal,
        updated_at: new Date().toISOString(),
        ncm_code: product.ncmCode,
        tax_origin: product.taxOrigin,
        supplier_state: product.supplierState,
        cost_unit: product.costUnit
    };

    const { error } = await supabase.from('master_catalog').update(payload).eq('sku', originalSku);
    if (error) return { success: false, message: error.message };

    await this.addLog(user, 'EDICAO_MASTER_COMERCIAL', product.sku!, '', 0, 'Atualização de parâmetros comerciais/cadastrais.');
    return { success: true };
  }

  static async addProduct(product: any, user: User) {
    return InventoryService.addProduct(product, user);
  }

  static async importMasterProducts(items: MasterProduct[], user: User) {
    return InventoryService.importMasterProducts(items);
  }

  // --- SALES & CRM ---
  static async getSalesHistory(limit: number = 500): Promise<SalesHistoryItem[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('sales_history').select('*').order('sale_date', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(s => ({
        id: s.id,
        externalId: s.external_id,
        orderNumber: s.order_number,
        saleDate: s.sale_date,
        status: s.status,
        contactName: s.contact_name,
        sku: s.sku,
        description: s.description,
        quantity: Number(s.quantity),
        unitPrice: Number(s.unit_price),
        totalAmount: Number(s.total_amount),
        salesRep: s.sales_rep,
        trackingCode: s.tracking_code
    }));
  }

  static async getSalesByIds(ids: string[]): Promise<SalesHistoryItem[]> {
    if (!supabase || ids.length === 0) return [];
    const { data, error } = await supabase.from('sales_history').select('*').in('external_id', ids);
    if (error) throw error;
    return (data || []).map(s => ({
        id: s.id,
        externalId: s.external_id,
        status: s.status
    }));
  }

  static async importSalesHistoryBatch(items: SalesHistoryItem[], user: User): Promise<{ success: boolean; count: number }> {
    if (!supabase) return { success: false, count: 0 };
    
    const dbItems = items.map(i => ({
        external_id: i.externalId,
        order_number: i.orderNumber,
        sale_date: i.saleDate,
        status: i.status,
        contact_name: i.contactName,
        sku: i.sku,
        description: i.description,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        total_amount: (i.quantity || 0) * (i.unitPrice || 0),
        sales_rep: i.salesRep,
        tracking_code: i.trackingCode
    }));

    const { error } = await supabase.from('sales_history').upsert(dbItems, { onConflict: 'external_id' });
    if (error) throw error;
    return { success: true, count: items.length };
  }

  // --- CRM: Opportunities ---
  static async getCRMOpportunities(): Promise<CRMOpportunity[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('crm_opportunities').select('*').order('created_at', { ascending: false });
    if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('does not exist')) return [];
        throw error;
    }
    return (data || []).map(d => ({
        id: d.id,
        clientName: d.client_name,
        companyName: d.company_name,
        phone: d.phone,
        status: d.status,
        nextFollowUp: d.next_follow_up,
        notes: d.notes,
        createdAt: d.created_at,
        ownerId: d.owner_id,
        // New Fields
        instagramLink: d.instagram_link,
        prospector: d.prospector,
        attendant: d.attendant
    }));
  }

  static async saveCRMOpportunity(opp: CRMOpportunity): Promise<{ success: boolean; message?: string; id?: string }> {
    if (!supabase) return { success: false, message: 'Offline' };
    const payload: any = {
        client_name: opp.clientName,
        company_name: opp.companyName,
        phone: opp.phone,
        status: opp.status,
        next_follow_up: opp.nextFollowUp || null,
        notes: opp.notes || null,
        updated_at: new Date().toISOString(),
        owner_id: opp.ownerId, // Preserve owner
        // New Fields
        instagram_link: opp.instagramLink || null,
        prospector: opp.prospector || null,
        attendant: opp.attendant || null
    };
    if (opp.id) payload.id = opp.id;

    const { data, error } = await supabase.from('crm_opportunities').upsert(payload, { onConflict: 'id' }).select('id').single();
    if (error) throw error;
    return { success: true, id: data.id };
  }

  static async deleteCRMOpportunity(id: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase.from('crm_opportunities').delete().eq('id', id);
    return !error;
  }

  // --- CRM: Interactions / Feed ---
  
  static async getCRMInteractions(opportunityId: string): Promise<CRMInteraction[]> {
    if (!supabase) return [];
    // Busca interações de um card específico
    const { data, error } = await supabase
      .from('crm_interactions')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false });
      
    if (error) {
       // Silent fail if table doesn't exist yet
       if (error.code === 'PGRST205' || error.message?.includes('does not exist')) return [];
       return [];
    }

    return (data || []).map(i => ({
      id: i.id,
      opportunityId: i.opportunity_id,
      userName: i.user_name,
      content: i.content,
      createdAt: i.created_at
    }));
  }

  static async saveCRMInteraction(opportunityId: string, userName: string, content: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase.from('crm_interactions').insert({
      opportunity_id: opportunityId,
      user_name: userName,
      content: content,
      created_at: new Date().toISOString()
    });
    return !error;
  }

  // Feed Global: Traz as últimas interações de TODOS os cards (Dashboard)
  static async getGlobalCRMFeed(limit = 50): Promise<any[]> {
    if (!supabase) return [];
    // Join com crm_opportunities para pegar o nome do cliente
    const { data, error } = await supabase
      .from('crm_interactions')
      .select('*, crm_opportunities(client_name)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
       if (error.code === 'PGRST205' || error.message?.includes('does not exist')) return [];
       return [];
    }

    return (data || []).map(i => ({
      id: i.id,
      opportunityId: i.opportunity_id,
      userName: i.user_name,
      content: i.content,
      createdAt: i.created_at,
      clientName: i.crm_opportunities?.client_name || 'Cliente Removido'
    }));
  }

  // --- APPROVAL & INBOUND REQUESTS ---
  static async getInboundRequests(): Promise<InboundRequest[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('inbound_requests').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return data.map(r => ({
        id: r.id,
        timestamp: r.created_at,
        solicitante: r.solicitante,
        status: r.status,
        items: r.items, // JSONB
        aprovador: r.aprovador,
        relato: r.relato
    }));
  }

  static async processInboundRequest(id: string, action: 'APROVAR' | 'RECUSAR', admin: User, relato: string, costs: Record<string, number>): Promise<boolean> {
    if (!supabase) return false;
    
    // 1. Update request
    const { error } = await supabase.from('inbound_requests').update({
        status: action === 'APROVAR' ? 'APROVADO' : 'RECUSADO',
        aprovador: admin.name,
        relato: relato,
        updated_at: new Date().toISOString()
    }).eq('id', id);
    
    if (error) return false;

    // 2. If approved, create inventory
    if (action === 'APROVAR') {
        const { data: req } = await supabase.from('inbound_requests').select('items').eq('id', id).single();
        if (req && req.items) {
            const items: StockItem[] = req.items.map((it: any, idx: number) => ({
                ...it,
                custoUnitario: costs[`${it.sku}_${idx}`] || 0,
                responsavel: admin.name,
                dataEntrada: new Date().toISOString()
            }));
            await this.processInboundBatch(items, admin);
        }
    }
    return true;
  }

  static async getApprovalCases(): Promise<ApprovalCase[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('approval_cases').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return data.map(c => ({
        id: c.id,
        timestamp: c.created_at,
        status: c.status,
        sku: c.sku,
        motivo: c.motivo,
        lpn: c.lpn,
        solicitante: c.solicitante,
        cliente: c.cliente,
        quantidade: Number(c.quantidade),
        pedido: c.pedido,
        aprovador: c.aprovador,
        parecer: c.parecer
    }));
  }

  static async processCase(id: string, action: 'APROVAR' | 'RECUSAR', admin: User, relato: string): Promise<{ success: boolean; message?: string }> {
    if (!supabase) return { success: false, message: 'Offline' };
    
    const { data: caseItem } = await supabase.from('approval_cases').select('*').eq('id', id).single();
    if (!caseItem) return { success: false, message: 'Caso não encontrado' };

    const { error } = await supabase.from('approval_cases').update({
        status: action === 'APROVAR' ? 'APROVADO' : 'RECUSADO',
        aprovador: admin.name,
        parecer: relato,
        updated_at: new Date().toISOString()
    }).eq('id', id);

    if (error) return { success: false, message: error.message };

    if (action === 'APROVAR') {
        const item = {
            lpn: caseItem.lpn,
            sku: caseItem.sku,
            quantidade: caseItem.quantidade,
            motivo: caseItem.motivo,
            relato: `Aprovado por ${admin.name}: ${relato}`,
            extra: { pedido: caseItem.pedido, cliente: caseItem.cliente }
        };
        if (caseItem.lpn) {
            await this.processWithdrawalBatch([item], admin);
        }
    }

    return { success: true };
  }

  // --- UTILS & AGGREGATIONS ---
  static async isOrderIdUsed(orderId: string): Promise<boolean> {
    if (!supabase) return false;
    const { data } = await supabase.from('audit_logs').select('id').eq('nfControle', orderId).limit(1);
    return (data && data.length > 0);
  }

  static async getDebtorsSummary(): Promise<DebtorInfo[]> {
    if (!supabase) return [];
    
    const { data: arData, error } = await supabase.from('accounts_receivable').select('*');
    if (error) return [];

    const map = new Map<string, DebtorInfo>();
    const today = new Date().toISOString().split('T')[0];

    arData.forEach((item: any) => {
        const cliente = item.Cliente;
        if (!cliente) return;

        if (!map.has(cliente)) {
            map.set(cliente, {
                cliente,
                totalVencido: 0,
                vencidoAte15d: 0,
                vencidoMais15d: 0,
                enviarCartorio: 0,
                emAcordo: 0,
                qtdTitulos: 0,
                statusCobranca: 'REGULAR',
                protocoloAtual: '',
                enviadoCartorio: false,
                acordoAtrasado: 0
            });
        }

        const info = map.get(cliente)!;
        const saldo = Number(item.Saldo || 0);
        
        if (item.situacao === 'EM CARTORIO' || item.status_cobranca === 'CARTORIO') {
            info.enviadoCartorio = true;
            info.enviarCartorio += saldo;
            info.statusCobranca = 'CARTORIO';
        } else if (item.id_acordo) {
            info.emAcordo += saldo;
            if (item['Data Vencimento'] < today && saldo > 0) {
                info.acordoAtrasado = (info.acordoAtrasado || 0) + saldo;
            }
        } else if (saldo > 0.01 && item['Data Vencimento'] < today) {
            info.totalVencido += saldo;
            info.qtdTitulos++;
            
            const diffDays = (new Date(today).getTime() - new Date(item['Data Vencimento']).getTime()) / (1000 * 3600 * 24);
            if (diffDays <= 15) info.vencidoAte15d += saldo;
            else info.vencidoMais15d += saldo;
            
            if (info.statusCobranca !== 'CARTORIO') info.statusCobranca = 'COBRANCA';
        }
    });

    return Array.from(map.values());
  }
}
