import { supabaseClient as supabase } from './core';
import { InventoryService } from './inventoryService';
import { UserService } from './userService';
import { FinanceService } from './financeService';
import {
  StockItem, User, MasterProduct, AuditLog,
  InventoryUpdateStaging, WithdrawalReason,
  ApprovalCase, InboundRequest, DebtorInfo,
  SalesHistoryItem, CRMOpportunity, CompanySettings,
  InventorySession, CRMInteraction, FinancialTransaction, Client
} from '../types';

export class DataService {
  // --- INVENTORY DELEGATION ---
  static async getInventory(): Promise<StockItem[]> {
    return InventoryService.getInventory();
  }

  static async getLogsByLpn(lpn: string): Promise<AuditLog[]> {
    return InventoryService.getLogsByLpn(lpn);
  }

  static async updateStockItem(item: StockItem, user: User): Promise<{ success: boolean, message?: string }> {
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

  // NOVO MÉTODO PARA BUSCAR DADOS FINANCEIROS REAIS (CORREÇÃO DO ERRO)
  static async getFinancialData(type: 'payable' | 'receivable'): Promise<FinancialTransaction[]> {
    if (!supabase) return [];

    const table = type === 'payable' ? 'accounts_payable' : 'accounts_receivable';

    // Busca tudo ordenado por vencimento
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('data_vencimento', { ascending: true });

    if (error) {
      console.error(`Erro ao buscar ${table}:`, error);
      throw error;
    }

    return (data || []).map(item => ({
      id: item.id,
      // Tenta pegar fornecedor ou cliente ou nomes com letra maiúscula (legado)
      fornecedor: item.fornecedor || item.cliente || item.Fornecedor || item.Cliente || 'Desconhecido',
      data_vencimento: item.data_vencimento || item['Data Vencimento'],
      data_emissao: item.data_emissao,
      data_liquidacao: item.data_liquidacao,
      valor_documento: Number(item.valor_documento || 0),
      valor_pago: Number(item.valor_pago || 0),
      saldo: Number(item.saldo || item.Saldo || 0),
      situacao: item.situacao,
      forma_pagamento: item.forma_pagamento,
      categoria: item.categoria,
      competencia: item.competencia,
      historico: item.historico,
      numero_documento: item.numero_documento,
      ult_atuali: item.ult_atuali
    }));
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
    // AQUI ESTÁ A MUDANÇA: Mapeamento dos novos campos financeiros
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
      salesRep: s.sales_rep,
      trackingCode: s.tracking_code,

      // NOVOS CAMPOS PARA O DRE
      totalAmount: Number(s.total_amount || 0),
      totalFreight: Number(s.total_freight || 0),
      orderDiscount: Number(s.order_discount || 0),
      totalDiscount: Number(s.total_discount || 0)
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
      tracking_code: i.trackingCode,
      // Adicione também na importação manual, se usar
      total_freight: i.totalFreight,
      order_discount: i.orderDiscount
    }));

    const { error } = await supabase.from('sales_history').upsert(dbItems, { onConflict: 'external_id' });
    if (error) throw error;
    return { success: true, count: items.length };
  }

  // --- CRM: Opportunities ---
  static async getCRMOpportunities(): Promise<CRMOpportunity[]> {
    if (!supabase) return [];

    // Join para pegar count de interações e dados do cliente
    const { data, error } = await supabase
      .from('crm_opportunities')
      .select('*, crm_interactions(count), clients(id, id_tiny, cpf_cnpj, endereco, bairro, cidade, estado, cep, email)')
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('Could not find')) {
        // Tenta fallback sem join de clients, caso a FK não exista
        console.warn("[DataService] JOIN clients falhou, tentando fallback...", error.message);
        const { data: fbData, error: fbError } = await supabase.from('crm_opportunities').select('*, crm_interactions(count)').order('created_at', { ascending: false });
        if (fbError) throw fbError;
        return (fbData || []).map((d: any) => ({
          id: d.id,
          clientName: d.client_name,
          companyName: d.company_name,
          cpfCnpj: d.cpf_cnpj || d.cnpj || d.cpf || d.documento || d.document,
          address: d.address || d.endereco,
          phone: d.phone,
          email: d.email || d.email_cli,
          status: d.status,
          nextFollowUp: d.next_follow_up,
          notes: d.notes,
          createdAt: d.created_at,
          ownerId: d.owner_id,
          instagramLink: d.instagram_link,
          prospector: d.prospector,
          attendant: d.attendant,
          interactionCount: d.crm_interactions && d.crm_interactions[0] ? d.crm_interactions[0].count : 0,

          // CRM 2.0
          ltv: Number(d.ltv || 0),
          xpReward: d.xp_reward || 0,
          engagementScore: d.engagement_score || 50,
          tags: d.tags || [],
          lastPurchaseDate: d.last_purchase_date
        }));
      }
      throw error;
    }

    return (data || []).map((d: any) => {
      // Resolve client join data
      const cli = Array.isArray(d.clients) ? d.clients[0] : d.clients;

      // Resolve document
      const doc = d.cpf_cnpj || d.cnpj || d.cpf || d.documento || d.document || (cli?.cpf_cnpj);

      // Resolve address
      let addr = d.address || d.endereco;
      if (!addr && cli) {
        const p = [];
        if (cli.endereco) p.push(cli.endereco);
        if (cli.bairro) p.push(cli.bairro);
        if (cli.cidade) p.push(`${cli.cidade}/${cli.estado || ''}`);
        else if (cli.estado) p.push(cli.estado);
        if (cli.cep) p.push(`CEP ${cli.cep}`);

        if (p.length > 0) addr = p.join(', ');
      }

      return {
        id: d.id,
        clientId: cli?.id, // ID real da tabela clients
        idTiny: cli?.id_tiny, // ID do Tiny ERP
        clientName: d.client_name,
        companyName: d.company_name,
        cpfCnpj: doc,
        address: addr,
        phone: d.phone,
        email: d.email || cli?.email,
        status: d.status,
        nextFollowUp: d.next_follow_up,
        notes: d.notes,
        createdAt: d.created_at,
        ownerId: d.owner_id,
        instagramLink: d.instagram_link,
        prospector: d.prospector,
        attendant: d.attendant,
        interactionCount: d.crm_interactions && d.crm_interactions[0] ? d.crm_interactions[0].count : 0,

        // CRM 2.0
        ltv: Number(d.ltv || 0),
        xpReward: d.xp_reward || 0,
        engagementScore: d.engagement_score || 50,
        tags: d.tags || [],
        lastPurchaseDate: d.last_purchase_date
      };
    });
  }

  static async saveCRMOpportunity(opp: CRMOpportunity): Promise<{ success: boolean; message?: string; id?: string }> {
    if (!supabase) return { success: false, message: 'Offline' };

    const payload: any = {
      client_name: opp.clientName,
      company_name: opp.companyName,
      phone: opp.phone,
      email: opp.email || null,
      cpf_cnpj: opp.cpfCnpj || null,
      address: opp.address || null,
      status: opp.status,
      next_follow_up: opp.nextFollowUp || null,
      notes: opp.notes || null,
      updated_at: new Date().toISOString(),
      owner_id: opp.ownerId,
      instagram_link: opp.instagramLink || null,
      prospector: opp.prospector || null,
      attendant: opp.attendant || null,
      client_id: opp.clientId || null,
      // CRM 2.0
      tags: opp.tags || [],
      ltv: opp.ltv || 0,
      xp_reward: opp.xpReward || 0,
      engagement_score: opp.engagementScore || 50,
      last_purchase_date: opp.lastPurchaseDate || null
    };

    if (opp.id) payload.id = opp.id;

    // 1. Upsert na tabela de oportunidades
    const { data, error } = await supabase.from('crm_opportunities').upsert(payload, { onConflict: 'id' }).select('id').single();
    if (error) throw error;

    // 2. Se tiver clientId (vinculado a um cadastro), atualiza os dados básicos lá também
    if (opp.clientId) {
      try {
        const updateClient: any = {};
        if (opp.cpfCnpj) updateClient.cpf_cnpj = opp.cpfCnpj;
        if (opp.address) updateClient.endereco = opp.address;
        if (opp.clientName) updateClient.nome = opp.clientName;
        if (opp.email) updateClient.email = opp.email;

        if (Object.keys(updateClient).length > 0) {
          await supabase.from('clients').update(updateClient).eq('id', opp.clientId);
        }
      } catch (errCli) {
        console.warn("[DataService] Erro ao sincronizar update com tabela clients:", errCli);
      }
    }

    return { success: true, id: data.id };
  }

  static async registerProspectAtTiny(opp: CRMOpportunity): Promise<{ success: boolean; message?: string }> {
    if (!supabase) return { success: false, message: 'Offline' };

    try {
      const { TinyService } = await import('./tinyService');
      const tinyRes = await TinyService.saveClient(opp);

      if (!tinyRes.success) return { success: false, message: tinyRes.message };

      const clientPayload: any = {
        nome: opp.clientName,
        cpf_cnpj: opp.cpfCnpj || null,
        email: opp.email || null,
        telefone: opp.phone || null,
        endereco: opp.address || null,
        id_tiny: tinyRes.id_tiny
      };

      if (opp.clientId) {
        await supabase.from('clients').update(clientPayload).eq('id', opp.clientId);
      } else {
        const { data: newCli } = await supabase.from('clients').insert(clientPayload).select('id').single();
        // O trigger automático não criará duplicado pois já existe a oportunidade com esse nome.
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  static async deleteCRMOpportunity(id: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase.from('crm_opportunities').delete().eq('id', id);
    return !error;
  }

  // --- CRM: Interactions / Feed ---
  static async getCRMInteractions(opportunityId: string): Promise<CRMInteraction[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('crm_interactions')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false });

    if (error) {
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

  static async syncTinySalesToInteractions(opportunityId: string, orders: any[]): Promise<number> {
    if (!supabase) return 0;

    const existing = await this.getCRMInteractions(opportunityId);
    let addedCount = 0;

    for (const order of orders) {
      const signature = `[TINY_ORDER:${order.id}]`;
      const exists = existing.some(i => i.content.includes(signature));

      if (!exists) {
        const payload = {
          id: order.id,
          numero: order.numero,
          data: order.data,
          valor: order.valor,
          situacao: order.situacao,
          // Se tiver details, salva, senão salva o proprio order
          details: order.details || order
        };

        // Formato Híbrido: Texto legível + JSON Oculto/Separado
        const content = `${signature} Pedido #${order.numero} integrado do Tiny.\n::JSON::${JSON.stringify(payload)}`;

        // Usamos a data do pedido como created_at? 
        // O banco usa created_at automatico na inserção (insert acima usa new Date), 
        // mas podemos tentar forçar se o banco permitir ou se alterarmos saveCRMInteraction.
        // O saveCRMInteraction usa new Date().
        // Para ficar na ordem certa na timeline, seria ideal usar a data do pedido.
        // Vou criar um overload ou parâmetro opcional no saveCRMInteraction, ou insert direto aqui.

        let saleDate = new Date().toISOString();
        if (order.data) {
          // Tenta parsear dd/mm/yyyy
          const parts = order.data.split('/');
          if (parts.length === 3) {
            // Seta hora para meio dia para evitar fuso
            saleDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`).toISOString();
          }
        }

        const { error } = await supabase.from('crm_interactions').insert({
          opportunity_id: opportunityId,
          user_name: 'TINY ERP',
          content: content,
          created_at: saleDate
        });

        if (!error) addedCount++;
      }
    }

    return addedCount;
  }

  static async getGlobalCRMFeed(limit = 50): Promise<any[]> {
    if (!supabase) return [];
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

    const { error } = await supabase.from('inbound_requests').update({
      status: action === 'APROVAR' ? 'APROVADO' : 'RECUSADO',
      aprovador: admin.name,
      relato: relato,
      updated_at: new Date().toISOString()
    }).eq('id', id);

    if (error) return false;

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
      const cliente = item.Cliente || item.cliente;
      if (!cliente) return;

      // 1. Normalização
      const formaPagamento = String(item['Forma de recebimento'] || item.forma_pagamento || '').toUpperCase().trim();
      const situacao = String(item.situacao || item['Situação'] || item.Situacao || '').toUpperCase().trim();
      const statusCobrancaDb = String(item.status_cobranca || '').toUpperCase().trim();
      const categoria = String(item.Categoria || item.categoria || '').toUpperCase().trim();

      // --- FILTRO 1: Forma de Pagamento 'BOLETO' OU ser uma Parcela de Acordo (que é PIX)
      const isAcordoComercial = categoria === 'ACORDO COMERCIAL';
      if (formaPagamento !== 'BOLETO' && !isAcordoComercial) return;

      // --- FILTRO 2: Situação deve ser válida (Ignora CANCELADO, SUSPENSO, etc, mesmo com saldo)
      // Lista de situações consideradas "Ativas/Cobráveis"
      const situacoesValidas = ['EM ABERTO', 'ABERTO', 'VENCIDO', 'VENCIDA', 'NEGOCIADO', 'EM CARTORIO'];

      // Se a situação não for válida E não estiver marcado como Cartório no DB, ignora
      if (!situacoesValidas.includes(situacao) && statusCobrancaDb !== 'CARTORIO') return;

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
        info.totalVencido += saldo; // Inclui Cartório no Total da Dívida
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

  static async getClients(limit = 100, offset = 0, search = ''): Promise<Client[]> {
    if (!supabase) return [];

    let query = supabase.from('clients').select('*');

    if (search) {
      query = query.or(`nome.ilike.%${search}%,cpf_cnpj.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data, error } = await query.range(offset, offset + limit - 1).order('nome');

    if (error) {
      console.error('Erro ao buscar clientes (Supabase):', error);
      return [];
    }
    console.log(`[DataService] Clientes carregados: ${data?.length}`);
    return data as Client[];
  }

  static async upsertClients(clients: Partial<Client>[]): Promise<{ success: boolean; count: number }> {
    if (!supabase) return { success: false, count: 0 };
    if (clients.length === 0) return { success: true, count: 0 };

    console.log(`[DataService] Processando ${clients.length} clientes do Tiny...`);

    // 1. Extrair ID Tiny para verificação (mais seguro que CPF)
    const idsToCheck = clients
      .map(c => c.id_tiny)
      .filter(id => id !== null && id !== undefined && id !== '') as string[];

    // Se por acaso vier cliente sem id_tiny, fall back para CPF? 
    // Vamos focar no ID Tiny pois o erro foi violação de constraint de ID Tiny.
    const cpfsToCheck = clients
      .filter(c => c.cpf_cnpj && !c.id_tiny)
      .map(c => c.cpf_cnpj) as string[]; // Checa CPF apenas se não tiver ID Tiny

    // 2. Buscar quais já existem no banco
    let existingSet: Set<string> = new Set();

    // Check IDs
    if (idsToCheck.length > 0) {
      const { data, error } = await supabase.from('clients').select('id_tiny').in('id_tiny', idsToCheck);
      if (error) throw error;
      data?.forEach((d: any) => existingSet.add(String(d.id_tiny)));
    }

    // Check CPFs (fallback)
    if (cpfsToCheck.length > 0) {
      const { data, error } = await supabase.from('clients').select('cpf_cnpj').in('cpf_cnpj', cpfsToCheck);
      if (!error && data) {
        data.forEach((d: any) => existingSet.add(String(d.cpf_cnpj)));
      }
    }

    // 3. Filtrar apenas os novos
    const newClients = clients.filter(c => {
      // Se tem ID Tiny e já existe, pula
      if (c.id_tiny && existingSet.has(String(c.id_tiny))) return false;
      // Se não tem ID Tiny mas tem CPF e já existe, pula
      if (!c.id_tiny && c.cpf_cnpj && existingSet.has(String(c.cpf_cnpj))) return false;
      return true;
    });

    console.log(`[DataService] ${newClients.length} novos clientes reais identificados.`);

    if (newClients.length === 0) {
      return { success: true, count: 0 };
    }

    // 4. Inserir os novos
    // NOTA: Para garantir que o trigger funcione conforme o plano (Status = QUALIFICADO se tiver Tiny),
    // o DB trigger já foi ajustado para setar QUALIFICADO como padrão.
    // O que falta é a validação de histórico de vendas, que no plano original seria um modal.
    // O trigger vai cuidar da criação do card. 

    const { error: insertError } = await supabase.from('clients').insert(newClients);

    if (insertError) {
      console.error("Erro ao inserir novos clientes:", insertError);
      throw insertError;
    }

    return { success: true, count: newClients.length };
  }
}