
import { supabaseClient as supabase } from './core';
import { InventoryService } from './inventoryService';
import { FinanceService } from './financeService';
import { UserService } from './userService';
import { 
  StockItem, AuditLog, User, MasterProduct, CompanySettings, 
  InventoryUpdateStaging, InventorySession, AccountsReceivable, 
  DebtorInfo, WarehouseLayout, ApprovalCase, InboundRequest, 
  AccountsPayable, Settlement, APStagingItem, ARStagingItem, SalesHistoryItem 
} from '../types';

export class DataService {
  static async getInventory() { return InventoryService.getInventory(); }
  static async updateStockItem(item: StockItem, user: User) { return InventoryService.updateStockItem(item, user); }
  static async saveInventory(items: StockItem[]) { return InventoryService.saveInventory(items); }
  static async getLogs() { return InventoryService.getLogs(); }
  static async getLogsByLpn(lpn: string) { return InventoryService.getLogsByLpn(lpn); }
  
  static async addLog(user: User, action: string, sku: string = '', lpn: string = '', qty: number = 0, details: string, lote?: string, name?: string, valorOperacao?: number, nfControle?: string, tipo: string = 'LOGISTICA', category?: string, motivo?: string, cliente?: string) {
    return InventoryService.addLog(user, action, sku, lpn, qty, details, lote, name, valorOperacao, nfControle, tipo, category, motivo, cliente);
  }
  static async getLayout() { return InventoryService.getLayout(); }
  static async saveLayout(layout: WarehouseLayout) { return InventoryService.saveLayout(layout); }
  static async getInventorySessions() { return InventoryService.getInventorySessions(); }
  static async saveInventorySession(session: InventorySession) { return InventoryService.saveInventorySession(session); }
  
  static async commitInventoryBatch(staging: InventoryUpdateStaging[], user: User) {
    return InventoryService.commitInventoryBatch(staging, user);
  }

  static async addProduct(item: any, user: User) { return InventoryService.addProduct(item, user); }
  static async processInboundBatch(items: StockItem[], user: User, fileName?: string) {
    const res = await InventoryService.processInboundBatchAtomic(items, user);
    if (res.success && fileName) {
      await FinanceService.saveFinancialLog(user, 'IMPORTACAO_ESTOQUE', 'N/A', `Importação: ${fileName}`, items.length);
    }
    return res;
  }

  static async getInboundRequests(): Promise<InboundRequest[]> {
    const { data, error } = await supabase.from('inbound_requests').select('*').order('timestamp', { ascending: false });
    if (error) throw error;
    return data;
  }

  static async processInboundRequest(id: string, action: 'APROVAR' | 'RECUSAR', admin: User, relato: string, costs: Record<string, number>) {
    const { data: request, error: fetchErr } = await supabase.from('inbound_requests').select('*').eq('id', id).single();
    if (fetchErr) throw fetchErr;

    if (action === 'APROVAR' && request.items) {
      const itemsToProcess = request.items.map((it: any, idx: number) => ({
        ...it,
        custoUnitario: costs[`${it.sku}_${idx}`] || it.custoUnitario || 0
      }));
      await InventoryService.processInboundBatchAtomic(itemsToProcess, admin);
    }

    const { error } = await supabase.from('inbound_requests').update({ 
      status: action === 'APROVAR' ? 'APROVADO' : 'RECUSADO', 
      aprovador: admin.name, 
      relato: relato 
    }).eq('id', id);
    
    return !error;
  }

  static async getNextLPN() { return InventoryService.getNextLPN(); }
  static async processInventoryUpdateStaging(items: any[]) { return InventoryService.processInventoryUpdateStaging(items); }

  static async getMasterCatalog(): Promise<MasterProduct[]> {
    const { data, error } = await supabase.from('master_catalog').select('*').order('sku', { ascending: true });
    if (error) throw error; 
    return (data || []).map(p => ({
      sku: p.sku,
      nome: p.nome,
      categoria: p.categoria,
      marca: p.marca,
      fornecedor: p.fornecedor,
      larguraL: Number(p.largura_l ?? p.larguraL ?? 1.52), 
      metragemPadrao: Number(p.metragem_padrao ?? p.metragemPadrao ?? 15),
      estoqueMinimo: Number(p.estoque_minimo ?? p.estoqueMinimo ?? 0), 
      custoUnitario: Number(p.custo_unitario ?? p.custoUnitario ?? 0), 
      costTaxPercent: Number(p.cost_tax_percent ?? 0),
      costExtraValue: Number(p.cost_extra_value ?? 0),
      precoVenda: Number(p.preco_venda ?? p.precoVenda ?? 0),
      ncmCode: p.ncm_code || p.ncmCode,
      taxOrigin: p.tax_origin !== undefined ? Number(p.tax_origin) : (p.taxOrigin !== undefined ? Number(p.taxOrigin) : undefined),
      supplierState: p.supplier_state || p.supplierState,
      costUnit: p.cost_unit || p.costUnit,
      priceRoloMin: Number(p.price_rolo_min ?? 0),
      priceRoloIdeal: Number(p.price_rolo_ideal ?? 0),
      priceFracMin: Number(p.price_frac_min ?? 0),
      priceFracIdeal: Number(p.price_frac_ideal ?? 0),
      active: p.active ?? true,
      updatedAt: p.updated_at || p.created_at // Mapeamento da data de atualização
    }));
  }

  static async updateMasterProduct(product: MasterProduct, user: User, oldSku: string): Promise<boolean> {
    const fullPayload = {
      sku: product.sku,
      nome: product.nome, 
      categoria: product.categoria, 
      marca: product.marca, 
      fornecedor: product.fornecedor,
      largura_l: Number(product.larguraL || 0), 
      metragem_padrao: Number(product.metragemPadrao || 0), 
      estoque_minimo: Number(product.estoqueMinimo || 0), 
      custo_unitario: Number(product.custoUnitario || 0), 
      cost_tax_percent: Number(product.costTaxPercent || 0),
      cost_extra_value: Number(product.costExtraValue || 0),
      preco_venda: Number(product.precoVenda || 0),
      ncm_code: product.ncmCode,
      tax_origin: product.taxOrigin !== undefined ? Number(product.taxOrigin) : null,
      supplier_state: product.supplierState,
      cost_unit: product.costUnit,
      price_rolo_min: Number(product.priceRoloMin || 0),
      price_rolo_ideal: Number(product.priceRoloIdeal || 0),
      price_frac_min: Number(product.priceFracMin || 0),
      price_frac_ideal: Number(product.priceFracIdeal || 0),
      active: product.active ?? true,
      updated_at: new Date().toISOString() // Força atualização da data
    };

    const { error } = await supabase
      .from('master_catalog')
      .update(fullPayload)
      .eq('sku', oldSku);
    
    if (error) {
        // Tratamento de Schema Desatualizado (42703 = Undefined Column, PGRST204 = No Content/Mismatch)
        // Adicionado check por string 'column' para capturar variações de erro
        if (error.code === 'PGRST204' || error.code === '42703' || (error.message && error.message.includes('column'))) {
            console.warn("Database Schema Mismatch: Coluna possivelmente inexistente. Tentando salvamento resiliente...");
            
            const basicPayload = {
                sku: product.sku,
                nome: product.nome,
                categoria: product.categoria,
                marca: product.marca,
                fornecedor: product.fornecedor,
                largura_l: Number(product.larguraL || 1.52),
                metragem_padrao: Number(product.metragemPadrao || 15),
                estoque_minimo: Number(product.estoqueMinimo || 0),
                custo_unitario: Number(product.custoUnitario || 0),
                preco_venda: Number(product.precoVenda || 0)
                // Excluímos 'active' e outros campos novos no fallback
            };

            const { error: retryError } = await supabase
                .from('master_catalog')
                .update(basicPayload)
                .eq('sku', oldSku);

            if (retryError) throw new Error(`Falha crítica de persistência: ${retryError.message}`);
            
            // Se o usuário tentou especificamente pausar/ativar, mas a coluna não existe, avisa e sugere correção.
            if (product.active !== undefined) {
               throw new Error("Aviso: Status não salvo (Coluna 'active' inexistente). Vá em 'Configurações > Banco de Dados' para corrigir.");
            }
            
            return true;
        }
        throw new Error(`Falha no Banco de Dados: ${error.message}`);
    }
    
    await this.addLog(user, 'EDICAO_MASTER_COMERCIAL', product.sku, '', 0, `Atualização de parâmetros comerciais. Ativo: ${product.active}`);
    return true;
  }

  static async importMasterProducts(items: MasterProduct[], user: User) {
    return InventoryService.importMasterProducts(items);
  }

  static async getSalesHistory(limit = 100): Promise<SalesHistoryItem[]> {
    const { data, error } = await supabase
      .from('sales_history')
      .select('*')
      .order('sale_date', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data || []).map(row => ({
      id: row.id,
      externalId: row.external_id,
      orderNumber: row.order_number,
      saleDate: row.sale_date,
      expectedDate: row.expected_date,
      status: row.status,
      notes: row.notes,
      contactId: row.contact_id,
      contactName: row.contact_name,
      personType: row.person_type,
      cpfCnpj: row.cpf_cnpj,
      rgIe: row.rg_ie,
      email: row.email,
      phone: row.phone,
      mobile: row.mobile,
      zipCode: row.zip_code,
      address: row.address,
      addressNumber: row.address_number,
      complement: row.complement,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      productIdExternal: row.product_id_external,
      sku: row.sku,
      description: row.description,
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unit_price || 0),
      itemDiscount: Number(row.item_discount || 0),
      orderDiscount: Number(row.order_discount || 0),
      orderFreight: Number(row.order_freight || 0),
      orderExpenses: Number(row.order_expenses || 0),
      proratedDiscount: Number(row.prorated_discount || 0),
      proratedFreight: Number(row.prorated_freight || 0),
      proratedExpenses: Number(row.prorated_expenses || 0),
      trackingCode: row.tracking_code,
      salesRep: row.sales_rep,
      purchaseOrderNumber: row.purchase_order_number,
      recipientName: row.recipient_name,
      recipientCpfCnpj: row.recipient_cpf_cnpj,
      recipientZipCode: row.recipient_zip_code,
      recipientAddress: row.recipient_address,
      recipientAddressNumber: row.recipient_address_number,
      recipientComplement: row.recipient_complement,
      recipientNeighborhood: row.recipient_neighborhood,
      recipientCity: row.recipient_city,
      recipientState: row.recipient_state,
      recipientPhone: row.recipient_phone,
      importedAt: row.imported_at,
      totalAmount: Number(row.unit_price || 0) * Number(row.quantity || 0), // Calculado
      totalFreight: Number(row.order_freight || 0) // Alias para compatibilidade visual
    }));
  }

  static async getSalesByIds(ids: string[]): Promise<SalesHistoryItem[]> {
    if (ids.length === 0) return [];
    
    const { data, error } = await supabase
        .from('sales_history')
        .select('*')
        .in('external_id', ids);
    
    if (error) return [];

    return (data || []).map(row => ({
      id: row.id,
      externalId: row.external_id,
      orderNumber: row.order_number,
      saleDate: row.sale_date,
      expectedDate: row.expected_date,
      status: row.status,
      notes: row.notes,
      contactId: row.contact_id,
      contactName: row.contact_name,
      personType: row.person_type,
      cpfCnpj: row.cpf_cnpj,
      rgIe: row.rg_ie,
      email: row.email,
      phone: row.phone,
      mobile: row.mobile,
      zipCode: row.zip_code,
      address: row.address,
      addressNumber: row.address_number,
      complement: row.complement,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      productIdExternal: row.product_id_external,
      sku: row.sku,
      description: row.description,
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unit_price || 0),
      itemDiscount: Number(row.item_discount || 0),
      orderDiscount: Number(row.order_discount || 0),
      orderFreight: Number(row.order_freight || 0),
      orderExpenses: Number(row.order_expenses || 0),
      proratedDiscount: Number(row.prorated_discount || 0),
      proratedFreight: Number(row.prorated_freight || 0),
      proratedExpenses: Number(row.prorated_expenses || 0),
      trackingCode: row.tracking_code,
      salesRep: row.sales_rep,
      purchaseOrderNumber: row.purchase_order_number,
      recipientName: row.recipient_name,
      recipientCpfCnpj: row.recipient_cpf_cnpj,
      recipientZipCode: row.recipient_zip_code,
      recipientAddress: row.recipient_address,
      recipientAddressNumber: row.recipient_address_number,
      recipientComplement: row.recipient_complement,
      recipientNeighborhood: row.recipient_neighborhood,
      recipientCity: row.recipient_city,
      recipientState: row.recipient_state,
      recipientPhone: row.recipient_phone,
      importedAt: row.imported_at
    }));
  }

  static async importSalesHistoryBatch(items: SalesHistoryItem[], user: User): Promise<{ success: boolean, count: number }> {
    const buildPayload = (item: SalesHistoryItem, includeUser: boolean) => {
        const payload: any = {
            external_id: item.externalId,
            order_number: item.orderNumber,
            sale_date: item.saleDate ? item.saleDate : null,
            expected_date: item.expectedDate ? item.expectedDate : null,
            status: item.status,
            notes: item.notes,
            contact_id: item.contactId,
            contact_name: item.contactName,
            person_type: item.personType,
            cpf_cnpj: item.cpfCnpj,
            rg_ie: item.rgIe,
            email: item.email,
            phone: item.phone,
            mobile: item.mobile,
            zip_code: item.zipCode,
            address: item.address,
            address_number: item.addressNumber,
            complement: item.complement,
            neighborhood: item.neighborhood,
            city: item.city,
            state: item.state,
            product_id_external: item.productIdExternal,
            sku: item.sku,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            item_discount: item.itemDiscount,
            order_discount: item.orderDiscount,
            order_freight: item.orderFreight,
            order_expenses: item.orderExpenses,
            prorated_discount: item.proratedDiscount,
            prorated_freight: item.proratedFreight,
            prorated_expenses: item.proratedExpenses,
            tracking_code: item.trackingCode,
            sales_rep: item.salesRep,
            purchase_order_number: item.purchaseOrderNumber,
            recipient_name: item.recipientName,
            recipient_cpf_cnpj: item.recipientCpfCnpj,
            recipient_zip_code: item.recipientZipCode,
            recipient_address: item.recipientAddress,
            recipient_address_number: item.recipientAddressNumber,
            recipient_complement: item.recipientComplement,
            recipient_neighborhood: item.recipientNeighborhood,
            recipient_city: item.recipientCity,
            recipient_state: item.recipientState,
            recipient_phone: item.recipientPhone,
            imported_at: new Date().toISOString()
        };

        if (includeUser) payload.imported_by = user.id;
        // O ID só é adicionado se existir no objeto de entrada.
        if (item.id) payload.id = item.id;
        
        return payload;
    };

    const itemsToUpdate = items.filter(i => !!i.id);
    const itemsToInsert = items.filter(i => !i.id);
    
    // Processa Updates
    if (itemsToUpdate.length > 0) {
        // De-duplicate items based on 'id' to prevent "affect row twice" error.
        const uniqueItemsToUpdate = Array.from(new Map(itemsToUpdate.map(item => [item.id, item])).values());
        let updatePayloads = uniqueItemsToUpdate.map(i => buildPayload(i, true));
        
        let { error: updateError } = await supabase.from('sales_history').upsert(updatePayloads, { onConflict: 'id' });
        
        if (updateError && (updateError.code === '23503' || updateError.message.includes('imported_by'))) {
            console.warn("NZERP Warning (UPDATE): Foreign key violation on imported_by. Retrying without user.");
            updatePayloads = uniqueItemsToUpdate.map(i => buildPayload(i, false));
            const { error: retryError } = await supabase.from('sales_history').upsert(updatePayloads, { onConflict: 'id' });
            if (retryError) throw retryError;
        } else if (updateError) {
            throw updateError;
        }
    }

    // Processa Inserts
    if (itemsToInsert.length > 0) {
        // De-duplicate based on externalId to avoid inserting duplicates from a messy source file.
        const uniqueItemsToInsert = Array.from(new Map(itemsToInsert.map(item => [item.externalId, item])).values());
        
        const insertPayloads = uniqueItemsToInsert.map(item => {
            const payload = buildPayload(item, true);
            // Se o BD não gera UUIDs, fornecemos um válido para satisfazer a constraint NOT NULL.
            if (!payload.id) {
              payload.id = crypto.randomUUID();
            }
            return payload;
        });

        let { error: insertError } = await supabase.from('sales_history').insert(insertPayloads);
        
        if (insertError && (insertError.code === '23503' || insertError.message.includes('imported_by'))) {
            console.warn("NZERP Warning (INSERT): Foreign key violation on imported_by. Retrying without user.");
            const retryPayloads = uniqueItemsToInsert.map(item => {
                const payload = buildPayload(item, false);
                if (!payload.id) {
                  payload.id = crypto.randomUUID();
                }
                return payload;
            });
            const { error: retryError } = await supabase.from('sales_history').insert(retryPayloads);
            if (retryError) throw retryError;
        } else if (insertError) {
            throw insertError;
        }
    }
    
    return { success: true, count: items.length };
  }

  static async getAccountsReceivable() { return FinanceService.getAccountsReceivable(); }
  static async getAccountsPayable() { return FinanceService.getAccountsPayable(); }
  static async getLastAPImport() { return FinanceService.getLastAPImport(); }

  static async processAPStaging(items: AccountsPayable[]): Promise<APStagingItem[]> {
    return FinanceService.processAPStaging(items);
  }

  static async commitAPBatch(staging: APStagingItem[], user: User, fileName?: string) {
    return FinanceService.commitAPBatch(staging, user, fileName);
  }

  static async login(email: string, pass: string) { return UserService.login(email, pass); }
  static async getUsers() { return UserService.getUsers(); }
  static async saveUser(user: User, admin: User) { return UserService.saveUser(user); }
  static async deleteUser(id: string, admin: User) { 
    const { error } = await supabase.from('users').delete().eq('id', id);
    return !error;
  }
  static async getCompanySettings() { return UserService.getCompanySettings(); }
  static async saveCompanySettings(settings: CompanySettings) { return UserService.saveCompanySettings(settings); }

  static async registerWithdrawalBatch(items: any[], user: User) {
    return InventoryService.processWithdrawalBatchAtomic(items, user);
  }

  static async isOrderIdUsed(orderId: string): Promise<boolean> {
    const { data } = await supabase.from('audit_logs').select('id').eq('nfControle', orderId).limit(1);
    return !!data && data.length > 0;
  }

  static async setAuditLock(lock: any): Promise<void> { }

  static async getDebtorsSummary(): Promise<DebtorInfo[]> {
    const [ar, { data: historyData }] = await Promise.all([
      this.getAccountsReceivable(),
      supabase.from('collection_history').select('cliente, data_proxima_acao').order('data_registro', { ascending: false })
    ]);
  
    const nextActionMap: Record<string, string> = {};
    if (historyData) {
      historyData.forEach((h: any) => {
        if (!nextActionMap[h.cliente] && h.data_proxima_acao) {
          nextActionMap[h.cliente] = h.data_proxima_acao;
        }
      });
    }
  
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Define para meia-noite do dia atual (local)
    const debtorsMap: Record<string, DebtorInfo> = {};
  
    ar.forEach(t => {
      const situacao = (t.situacao || '').toUpperCase().trim();
      const formaPgto = (t.forma_pagamento || '').toUpperCase().trim();
      
      let dueDate: Date | null = null;
      if (t.data_vencimento) {
        // Constrói a data a partir do string YYYY-MM-DD para evitar problemas de fuso horário.
        // Isso cria a data na meia-noite do fuso horário local.
        const parts = t.data_vencimento.split('-').map(Number);
        if (parts.length === 3) {
            dueDate = new Date(parts[0], parts[1] - 1, parts[2]);
        }
      }

      const isDebtActiveAndOverdue = 
          situacao === 'EM ABERTO' &&
          formaPgto === 'BOLETO' &&
          t.saldo > 0.01 &&
          !t.id_acordo &&
          dueDate && dueDate < today; // Comparação de objetos Date, agora ambos no fuso local.
  
      if (!isDebtActiveAndOverdue || !dueDate) return;
  
      if (!debtorsMap[t.cliente]) {
        debtorsMap[t.cliente] = {
          cliente: t.cliente,
          totalVencido: 0,
          vencidoAte15d: 0,
          vencidoMais15d: 0,
          enviarCartorio: 0,
          qtdTitulos: 0,
          statusCobranca: 'PENDENTE',
          protocoloAtual: `COB-${Date.now().toString().slice(-6)}`,
          enviadoCartorio: false,
          nextActionDate: nextActionMap[t.cliente]
        };
      }
  
      const info = debtorsMap[t.cliente];
      info.totalVencido += t.saldo;
      info.qtdTitulos += 1;
  
      if (t.statusCobranca === 'CARTORIO') {
        info.enviarCartorio += t.saldo;
        info.enviadoCartorio = true;
      } else {
        const diffDays = Math.ceil((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 15) {
          info.vencidoAte15d += t.saldo;
        } else {
          info.vencidoMais15d += t.saldo;
        }
      }
    });
  
    return Object.values(debtorsMap).sort((a, b) => b.totalVencido - a.totalVencido);
  }

  static async sendToNotary(cliente: string, user: User): Promise<boolean> {
    return true; 
  }

  static async getApprovalCases() {
    const { data, error } = await supabase.from('approval_cases').select('*').order('timestamp', { ascending: false });
    if (error) throw error; 
    return data;
  }

  static async processCase(id: string, action: 'APROVAR' | 'RECUSAR', admin: User, relato: string) {
    const { error } = await supabase.from('approval_cases').update({ status: action === 'APROVAR' ? 'APROVADO' : 'RECUSADO', aprovador: admin.name, parecer: relato }).eq('id', id);
    if (error) throw error; 
    return { success: !error, message: error?.message };
  }
}
