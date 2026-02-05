
import { supabaseClient as supabase } from './core';
import { StockItem, AuditLog, User, WarehouseLayout, InventorySession, WithdrawalReason, MasterProduct, InventoryUpdateStaging } from '../types';

const LAYOUT_STORAGE_KEY = 'nzstok_layout_fallback';

export class InventoryService {
  private static formatSupabaseError(error: any): string {
    if (!error) return "Erro desconhecido";
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (typeof error === 'object') {
      const parts: string[] = [];
      const msg = error.message || error.msg;
      const details = error.details || error.detail;
      const code = error.code;
      if (msg) parts.push(msg);
      if (details) parts.push(`Detalhes: ${details}`);
      if (code) parts.push(`[Código: ${code}]`);
      if (parts.length > 0) return parts.join(' | ');
      return JSON.stringify(error);
    }
    return String(error);
  }

  static async getInventory(): Promise<StockItem[]> {
    try {
      const { data, error } = await supabase.from('inventory').select('*');
      if (error) throw error;

      return (data || []).map(i => ({
        lpn: i.lpn,
        sku: i.sku,
        nome: i.nome,
        categoria: i.categoria,
        marca: i.marca,
        fornecedor: i.fornecedor,
        lote: i.lote,
        nfControle: i.nf_controle ?? i.nfControle,
        quantMl: Number(i.quant_ml ?? i.quantMl ?? 0),
        larguraL: Number(i.largura_l ?? i.larguraL ?? 1.52),
        custoUnitario: Number(i.custo_unitario ?? i.custoUnitario ?? 0),
        coluna: i.coluna,
        prateleira: i.prateleira,
        // Colunas com Case Sensitive no banco (aspas duplas na criação)
        nCaixa: i.nCaixa ?? i.n_caixa ?? 'N/A',
        statusRolo: i.status_rolo ?? i.statusRolo ?? 'ROLO FECHADO',
        dataEntrada: i.dataEntrada ?? i.data_entrada ?? i.created_at,
        ultAtuali: i.ultAtuali ?? i.ult_atuali ?? i.created_at,
        responsavel: i.responsavel,
        observacao: i.observacao || '',
        motivoEntrada: i.motivoEntrada ?? i.motivo_entrada,
        metragemPadrao: Number(i.metragemPadrao ?? i.metragem_padrao ?? 0),
        estoqueMinimo: Number(i.estoqueMinimo ?? i.estoque_minimo ?? 0),
      }));
    } catch (e) {
      throw e;
    }
  }

  static async saveInventory(items: StockItem[]): Promise<{ success: boolean, error?: string }> {
    try {
      const dbItems = items.map(i => ({
        lpn: i.lpn,
        sku: i.sku,
        nome: i.nome,
        categoria: i.categoria,
        marca: i.marca,
        fornecedor: i.fornecedor,
        lote: i.lote,
        nf_controle: i.nfControle,
        quant_ml: Number(i.quantMl),
        largura_l: Number(i.larguraL),
        custo_unitario: Number(i.custoUnitario),
        coluna: i.coluna,
        prateleira: i.prateleira,
        status_rolo: i.statusRolo,
        observacao: i.observacao,
        responsavel: i.responsavel,
        // Mapeamento exato para colunas Case Sensitive
        nCaixa: i.nCaixa,
        motivoEntrada: i.motivoEntrada,
        metragemPadrao: Number(i.metragemPadrao),
        estoqueMinimo: Number(i.estoqueMinimo)
      }));

      const { error } = await supabase.from('inventory').upsert(dbItems, { onConflict: 'lpn' });
      if (error) throw error;
      return { success: true };
    } catch (e: any) {
      return { success: false, error: this.formatSupabaseError(e) };
    }
  }

  static async updateStockItem(item: StockItem, user: User): Promise<{ success: boolean, message?: string }> {
    try {
      const { error } = await supabase.from('inventory').update({
        sku: item.sku,
        nome: item.nome,
        categoria: item.categoria,
        marca: item.marca,
        fornecedor: item.fornecedor,
        lote: item.lote,
        coluna: item.coluna,
        prateleira: item.prateleira,
        observacao: item.observacao,
        responsavel: user.name,
        // Campos snake_case
        nf_controle: item.nfControle,
        quant_ml: Number(item.quantMl),
        largura_l: Number(item.larguraL),
        custo_unitario: Number(item.custoUnitario),
        status_rolo: item.statusRolo,
        // Campos CamelCase (preservando nome exato do banco)
        nCaixa: item.nCaixa,
        motivoEntrada: item.motivoEntrada,
        metragemPadrao: Number(item.metragemPadrao),
        estoqueMinimo: Number(item.estoqueMinimo)
      }).eq('lpn', item.lpn);

      if (error) throw error;
      await this.addLog(user, 'EDICAO_CADASTRO', item.sku, item.lpn, 0, 'Alteração manual de cadastro.');
      return { success: true };
    } catch (e: any) {
      return { success: false, message: this.formatSupabaseError(e) };
    }
  }

  static async addLog(user: User, action: string, sku: string = '', lpn: string = '', qty: number = 0, details: string, lote?: string, name?: string, valorOperacao?: number, nfControle?: string, tipo: string = 'LOGISTICA', category?: string, motivo?: string, cliente?: string): Promise<void> {
    const logId = `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const payload = {
      id: logId, usuario: user.email, acao: action,
      sku: (sku || 'SISTEMA').substring(0, 50),
      lpn: (lpn || 'SISTEMA').substring(0, 50),
      quantidade: Number(qty || 0), detalhes: details.substring(0, 500),
      lote: (lote || 'N/A').substring(0, 50),
      nome: (name || 'Ação de Sistema').substring(0, 255),
      valorOperacao: Number(valorOperacao || 0),
      nfControle: nfControle,
      tipo: tipo, categoria: category, motivo: motivo, cliente: cliente,
      timestamp: new Date().toISOString()
    };

    const { error } = await supabase.from('audit_logs').insert(payload);
    if (error) throw error;
  }

  static async getLogs(): Promise<AuditLog[]> {
    const { data, error } = await supabase.from('audit_logs').select('*').order('timestamp', { ascending: false });
    if (error) throw error;
    return (data || []).map(l => ({
      ...l,
      quantidade: Number(l.quantidade || 0),
      valorOperacao: Number(l.valorOperacao || 0)
    }));
  }

  static async getLogsByLpn(lpn: string): Promise<AuditLog[]> {
    const { data, error } = await supabase.from('audit_logs').select('*').eq('lpn', lpn).order('timestamp', { ascending: false });
    if (error) throw error;
    return (data || []).map(l => ({
      ...l,
      quantidade: Number(l.quantidade || 0),
      valorOperacao: Number(l.valorOperacao || 0)
    }));
  }

  static async getLayout(): Promise<WarehouseLayout> {
    const DEFAULT_LAYOUT: WarehouseLayout = {
      columns: ['A', 'B', 'C', 'D', 'E'],
      shelvesPerColumn: {
        'A': ['1', '2', '3'],
        'B': ['1', '2', '3'],
        'C': ['1', '2', '3'],
        'D': ['1', '2', '3'],
        'E': ['1', '2', '3']
      }
    };

    try {
      const { data, error } = await supabase.from('warehouse_layout').select('*').single();
      if (error || !data) {
        console.warn("⚠️ MODO OFFLINE: Usando Layout Local (Banco inacessível ou vazio)");
        const local = localStorage.getItem(LAYOUT_STORAGE_KEY);
        return local ? JSON.parse(local) : DEFAULT_LAYOUT;
      }
      return {
        columns: data.columns || DEFAULT_LAYOUT.columns,
        shelvesPerColumn: data.shelves_per_column ?? data.shelvesPerColumn ?? DEFAULT_LAYOUT.shelvesPerColumn
      };
    } catch (e) {
      console.warn("⚠️ MODO OFFLINE: Usando Layout Local (Falha de conexão)");
      const local = localStorage.getItem(LAYOUT_STORAGE_KEY);
      return local ? JSON.parse(local) : DEFAULT_LAYOUT;
    }
  }

  static async saveLayout(layout: WarehouseLayout): Promise<boolean> {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    try {
      const { error } = await supabase
        .from('warehouse_layout')
        .upsert({ id: 1, columns: layout.columns, shelves_per_column: layout.shelvesPerColumn }, { onConflict: 'id' });
      return !error;
    } catch (e) {
      return true;
    }
  }

  static async getNextLPN(): Promise<string> {
    // FIX: Aumentado para 8 digitos baseados em Timestamp para garantir unicidade
    return `NZ-${Date.now().toString().slice(-8)}`;
  }

  static async processInboundBatchAtomic(items: StockItem[], user: User): Promise<{ success: boolean; message?: string; lpnsGenerated?: string[] }> {
    try {
      const lpns: string[] = [];

      const dbItems = items.map((it) => {
        // Use existing LPN if present and not 'PROJETADO', otherwise generate robust
        let lpn = it.lpn;
        if (!lpn || lpn === 'PROJETADO' || lpn.length < 5) {
          // Fallback de alta entropia: Timestamp (6) + Random (3)
          lpn = `NZ-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
        }

        lpns.push(lpn);
        return {
          lpn,
          sku: it.sku.toUpperCase(),
          nome: it.nome,
          categoria: it.categoria,
          marca: it.marca,
          fornecedor: it.fornecedor,
          lote: it.lote,
          coluna: it.coluna,
          prateleira: it.prateleira,
          responsavel: user.name,
          observacao: it.observacao || '',
          dataEntrada: it.dataEntrada || new Date().toISOString(),
          ultAtuali: new Date().toISOString(),

          // Campos snake_case
          nf_controle: it.nfControle,
          quant_ml: Number(it.quantMl),
          largura_l: Number(it.larguraL),
          custo_unitario: Number(it.custoUnitario),
          status_rolo: it.statusRolo,

          // Campos CamelCase (preservando aspas implícitas do Supabase client)
          nCaixa: it.nCaixa,
          motivoEntrada: it.motivoEntrada,
          metragemPadrao: Number(it.metragemPadrao),
          estoqueMinimo: Number(it.estoqueMinimo)
        };
      });

      const { error } = await supabase.from('inventory').insert(dbItems);
      if (error) throw error;

      // --- LOGGING START ---
      // Cria registros na timeline de movimentações para cada item inserido
      const logPromises = items.map((it, index) => {
        const finalLpn = lpns[index];
        return this.addLog(
          user,
          'ENTRADA_REGISTRADA',
          it.sku,
          finalLpn,
          Number(it.quantMl),
          `Entrada Manual: ${it.observacao || 'Sem observações'}`,
          it.lote,
          it.nome,
          Number(it.custoUnitario),
          it.nfControle,
          'LOGISTICA',
          it.categoria,
          it.motivoEntrada,
          it.fornecedor // Armazena Fornecedor no campo Cliente para rastreio
        );
      });
      await Promise.all(logPromises);
      // --- LOGGING END ---

      return { success: true, lpnsGenerated: lpns };
    } catch (e: any) {
      return { success: false, message: this.formatSupabaseError(e) };
    }
  }

  static async addProduct(item: any, user: User): Promise<{ success: boolean; message?: string }> {
    try {
      const { error: masterError } = await supabase.from('master_catalog').upsert({
        sku: item.sku.toUpperCase(),
        id_tiny: item.idTiny,
        nome: item.descricao || item.nome,
        categoria: item.categoria,
        marca: item.marca,
        fornecedor: item.fornecedor,
        largura_l: Number(item.larguraL),
        metragem_padrao: Number(item.metragemPadrao),
        estoque_minimo: Number(item.estoqueMinimo),
        custo_unitario: Number(item.custoUnitario),
        preco_venda: Number(item.precoVenda)
      }, { onConflict: 'sku' });

      if (masterError) throw masterError;

      if (Number(item.quantMl) > 0) {
        const lpn = await this.getNextLPN();
        const { error: invError } = await supabase.from('inventory').insert({
          lpn,
          sku: item.sku.toUpperCase(),
          nome: item.descricao || item.nome,
          categoria: item.categoria,
          marca: item.marca,
          fornecedor: item.fornecedor,
          lote: 'CARGA_INICIAL',
          coluna: 'A',
          prateleira: '1',
          responsavel: user.name,
          // Snake case
          nf_controle: 'INICIAL',
          quant_ml: Number(item.quantMl),
          largura_l: Number(item.larguraL),
          custo_unitario: Number(item.custoUnitario),
          status_rolo: 'ROLO FECHADO',
          // CamelCase
          motivoEntrada: 'Ajuste de Inventário',
          nCaixa: 'N/A',
          metragemPadrao: Number(item.metragemPadrao),
          estoqueMinimo: Number(item.estoqueMinimo)
        });
        if (invError) throw invError;
        await this.addLog(user, 'CADASTRO_PRODUTO_ESTOQUE', item.sku, lpn, Number(item.quantMl), 'Cadastro de novo material com saldo inicial.');
      } else {
        await this.addLog(user, 'CADASTRO_PRODUTO_MASTER', item.sku, '', 0, 'Cadastro de novo SKU no catálogo mestre.');
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, message: this.formatSupabaseError(e) };
    }
  }

  static async importMasterProducts(items: MasterProduct[]): Promise<{ success: boolean; message?: string }> {
    try {
      const dbItems = items.map(p => ({
        sku: String(p.sku).toUpperCase().trim(),
        id_tiny: p.id_tiny ? String(p.id_tiny).trim() : null,
        nome: String(p.nome).toUpperCase().trim(),
        categoria: String(p.categoria || 'DIVERSOS').toUpperCase().trim(),
        marca: p.marca ? String(p.marca).toUpperCase().trim() : 'NZ',
        fornecedor: p.fornecedor ? String(p.fornecedor).toUpperCase().trim() : 'NZ',
        largura_l: Number(p.larguraL) || 0,
        metragem_padrao: Number(p.metragemPadrao) || 0,
        estoque_minimo: Number(p.estoqueMinimo) || 0,
        custo_unitario: Number(p.custoUnitario) || 0,
        preco_venda: Number(p.precoVenda) || 0,
        updated_at: new Date().toISOString()
      }));

      // DEDUPLICAÇÃO DE SKUS: O Supabase/Postgres não permite upsert de duplicatas no mesmo comando
      const uniqueItemsMap = new Map();
      dbItems.forEach(item => {
        uniqueItemsMap.set(item.sku, item);
      });
      const finalItems = Array.from(uniqueItemsMap.values());

      if (finalItems.length < dbItems.length) {
        console.warn(`[InventoryService] Removidos ${dbItems.length - finalItems.length} SKUs duplicados na planilha.`);
      }

      console.log(`[InventoryService] Tentando importar ${finalItems.length} produtos únicos via Upsert...`);
      console.log(`[InventoryService] Exemplo do primeiro item:`, finalItems[0]);

      const { data, error } = await supabase.from('master_catalog').upsert(finalItems, {
        onConflict: 'sku'
      }).select();

      if (error) {
        console.error("[InventoryService] Erro crítico no UPSERT:", error);
        throw error;
      };

      console.log(`[InventoryService] Importação concluída com sucesso.`);
      return { success: true };
    } catch (e: any) {
      return { success: false, message: this.formatSupabaseError(e) };
    }
  }

  static async processWithdrawalBatchAtomic(items: any[], user: User): Promise<{ success: boolean; message?: string }> {
    try {
      for (const item of items) {
        // Processamento IMEDIATO para TODOS os motivos, incluindo DEFEITO e TROCA
        const { data: current, error: fetchError } = await supabase.from('inventory').select('quant_ml').eq('lpn', item.lpn).single();
        if (fetchError || !current) throw new Error(`Item ${item.lpn} não encontrado.`);

        const currentQty = Number(current.quant_ml);
        const newQty = currentQty - Number(item.quantidade);

        if (newQty < -0.001) throw new Error(`Saldo insuficiente para o item ${item.lpn}.`);

        const { error: updateError } = await supabase.from('inventory').update({
          quant_ml: Math.max(0, newQty),
          status_rolo: newQty <= 0.001 ? 'ESGOTADO' : 'ROLO ABERTO',
          ultAtuali: new Date().toISOString()
        }).eq('lpn', item.lpn);

        if (updateError) throw updateError;

        let logAction = 'SAIDA_AJUSTE';
        if (item.motivo === WithdrawalReason.VENDA) logAction = 'SAIDA_VENDA';
        else if (item.motivo === WithdrawalReason.AUDITORIA) logAction = 'SAIDA_AUDITORIA';
        else if (item.motivo === WithdrawalReason.TROCA) logAction = 'SAIDA_TROCA';
        else if (item.motivo === WithdrawalReason.DEFEITO) logAction = 'SAIDA_DEFEITO';

        await this.addLog(user, logAction, item.sku, item.lpn, item.quantidade, item.relato || `Saída por ${item.motivo}`, item.lote, item.nome, item.custoUnitario, item.extra?.pedido, 'LOGISTICA', item.categoria, item.motivo, item.extra?.cliente);
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, message: this.formatSupabaseError(e) };
    }
  }

  static async getInventorySessions(): Promise<InventorySession[]> {
    const { data, error } = await supabase.from('inventory_sessions').select('*').order('startTime', { ascending: false });
    if (error) throw error;
    return (data || []).map(s => ({
      id: s.id,
      startTime: s.startTime ?? s.start_time,
      endTime: s.endTime ?? s.end_time,
      responsible: s.responsible,
      status: s.status,
      itemsCount: s.itemsCount ?? s.items_count,
      posAdjustments: s.posAdjustments ?? s.pos_adjustments,
      negAdjustments: s.negAdjustments ?? s.neg_adjustments,
      observation: s.observation,
      durationSeconds: s.durationSeconds ?? s.duration_seconds
    }));
  }

  static async saveInventorySession(session: InventorySession): Promise<boolean> {
    const payload = {
      id: session.id,
      start_time: session.startTime,
      end_time: session.endTime,
      responsible: session.responsible,
      status: session.status,
      items_count: session.itemsCount,
      pos_adjustments: session.posAdjustments,
      neg_adjustments: session.negAdjustments,
      observation: session.observation,
      duration_seconds: session.durationSeconds
    };
    const { error } = await supabase.from('inventory_sessions').upsert(payload);
    return !error;
  }

  static async processInventoryUpdateStaging(items: any[]): Promise<InventoryUpdateStaging[]> {
    const current = await this.getInventory();
    const staging: InventoryUpdateStaging[] = [];
    const processedLpns = new Set<string>();

    for (const item of items) {
      const existing = current.find(i => String(i.lpn).toUpperCase() === String(item.lpn).toUpperCase());
      if (!existing) {
        staging.push({ item, status: 'NEW' });
      } else {
        const diff: string[] = [];
        if (existing.sku !== item.sku) diff.push('SKU');
        if (existing.nome !== item.nome) diff.push('NOME');
        if (Math.abs(Number(existing.quantMl) - Number(item.quantMl)) > 0.001) diff.push('SALDO');
        if (existing.coluna !== item.coluna || existing.prateleira !== item.prateleira) diff.push('LOCAL');

        staging.push({
          item: { ...existing, ...item },
          status: diff.length > 0 ? 'CHANGED' : 'UNCHANGED',
          diff
        });
      }
      if (item.lpn) processedLpns.add(String(item.lpn).toUpperCase());
    }

    current.forEach(item => {
      if (!processedLpns.has(String(item.lpn).toUpperCase())) {
        staging.push({ item: item as Partial<StockItem>, status: 'DELETED' });
      }
    });

    return staging;
  }

  static async commitInventoryBatch(staging: InventoryUpdateStaging[], user: User): Promise<{ success: boolean, message?: string }> {
    try {
      for (const row of staging) {
        if (row.status === 'NEW' && row.item) {
          const { error } = await supabase.from('inventory').insert({
            lpn: row.item.lpn,
            sku: row.item.sku,
            nome: row.item.nome,
            categoria: row.item.categoria,
            lote: row.item.lote,
            coluna: row.item.coluna,
            prateleira: row.item.prateleira,
            responsavel: user.name,
            // Snake case
            quant_ml: Number(row.item.quantMl || 0),
            // CamelCase
            nCaixa: row.item.nCaixa,
            motivoEntrada: row.item.motivoEntrada,
            metragemPadrao: Number(row.item.metragemPadrao || 0),
            estoqueMinimo: Number(row.item.estoqueMinimo || 0)
          });
          if (error) throw error;
          await this.addLog(user, 'CARGA_INICIAL', row.item.sku, row.item.lpn, Number(row.item.quantMl), 'Carga via importação em massa.');
        } else if (row.status === 'CHANGED' && row.item) {
          const { error } = await supabase.from('inventory').update({
            sku: row.item.sku,
            nome: row.item.nome,
            categoria: row.item.categoria,
            lote: row.item.lote,
            coluna: row.item.coluna,
            prateleira: row.item.prateleira,
            responsavel: user.name,
            // Snake case
            quant_ml: Number(row.item.quantMl || 0),
            // CamelCase
            nCaixa: row.item.nCaixa,
            motivoEntrada: row.item.motivoEntrada,
            metragemPadrao: Number(row.item.metragemPadrao),
            estoqueMinimo: Number(row.item.estoqueMinimo)
          }).eq('lpn', row.item.lpn);
          if (error) throw error;
          await this.addLog(user, 'ATUALIZACAO_MASSA', row.item.sku, row.item.lpn, Number(row.item.quantMl), `Ajuste em massa: ${row.diff?.join(', ')}`);
        } else if (row.status === 'DELETED' && row.item) {
          const { error } = await supabase.from('inventory').delete().eq('lpn', row.item.lpn);
          if (error) throw error;
          await this.addLog(user, 'REMOCAO_MASSA', row.item.sku, row.item.lpn, 0, 'Item removido via sincronização em massa.');
        }
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, message: this.formatSupabaseError(e) };
    }
  }
}
