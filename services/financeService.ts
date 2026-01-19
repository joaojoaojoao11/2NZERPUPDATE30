
// Fix: Correctly import 'supabaseClient' as 'supabase' from './core'
import { supabaseClient as supabase } from './core';
import { 
  AccountsReceivable, AccountsPayable, Settlement, ARStagingItem, 
  APStagingItem, User, AuditLog, CollectionHistory
} from '../types';

export class FinanceService {
  /**
   * SISTEMA DE AUDITORIA FINANCEIRA CENTRALIZADO
   */
  public static async saveFinancialLog(user: User, acao: string, cliente: string, detalhes: string, valor: number) {
    try {
      if (!supabase) return;
      await supabase.from('financial_logs').insert({
        usuario: user.email,
        acao,
        cliente,
        detalhes,
        valor,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.error("NZSTOK Audit Failure:", e);
    }
  }

  static async getFinancialLogs(): Promise<any[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('financial_logs').select('*').order('timestamp', { ascending: false });
    if (error) return [];
    return data;
  }

  static async logFinanceiro(user: User, acao: string, detalhes: string, valor: number, cliente: string) {
    return this.saveFinancialLog(user, acao, cliente, detalhes, valor);
  }

  static async addCollectionHistory(item: Omit<CollectionHistory, 'id' | 'data_registro'>): Promise<{ success: boolean; error?: string }> {
    try {
        if (!supabase) throw new Error("Database offline");
        const { error } = await supabase.from('collection_history').insert({
            cliente: item.cliente,
            dias_atraso: item.dias_atraso || 0,
            valor_devido: item.valor_devido || 0,
            acao_tomada: item.acao_tomada,
            data_proxima_acao: item.data_proxima_acao || null, 
            observacao: item.observacao,
            usuario: item.usuario,
            data_registro: new Date().toISOString()
        });
        if (error) throw error;
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
  }

  static async getCollectionHistoryByClient(cliente: string): Promise<CollectionHistory[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('collection_history')
      .select('*')
      .eq('cliente', cliente)
      .order('data_registro', { ascending: false });
    return error ? [] : data;
  }

  static async getAllCollectionLogs(): Promise<CollectionHistory[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('collection_history')
      .select('*')
      .order('data_registro', { ascending: false })
      .limit(500); // Limite de segurança para performance
    return error ? [] : data;
  }

  static async getAccountsReceivable(): Promise<AccountsReceivable[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('accounts_receivable').select('*').order('Data Vencimento', { ascending: true });
    if (error) {
        console.error("Error fetching accounts receivable:", error);
        return [];
    };
    
    return data.map(item => ({
      id: item.ID,
      cliente: item.Cliente,
      data_emissao: item['Data Emissão'],
      data_vencimento: item['Data Vencimento'],
      data_liquidacao: item['Data Liquidação'],
      valor_documento: Number(item['Valor documento'] || 0),
      saldo: Number(item.Saldo || 0),
      situacao: item['Situação'],
      numero_documento: item['Número documento'],
      numero_banco: item['Número no banco'],
      categoria: item.Categoria,
      historico: item.Histórico,
      competencia: item.Competência,
      forma_pagamento: item['Forma de recebimento'],
      meio_recebimento: item['Meio de recebimento'],
      taxas: Number(item.Taxas || 0),
      valor_recebido: Number(item.Recebido || 0),
      id_acordo: item.id_acordo,
      origem: item.origem,
      statusCobranca: item.status_cobranca,
      data_recebimento: item.data_recebimento
    })) as unknown as AccountsReceivable[];
  }

  static async getAccountsPayable(): Promise<AccountsPayable[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('accounts_payable').select('*').order('data_vencimento', { ascending: true });
    if (error) return [];
    
    return (data || []).map(item => ({
      id: item.id,
      fornecedor: item.fornecedor,
      dataEmissao: item.data_emissao,
      dataVencimento: item.data_vencimento,
      dataLiquidacao: item.data_liquidacao,
      valorDocumento: Number(item.valor_documento || 0),
      saldo: Number(item.saldo || 0),
      situacao: item.situacao,
      // Corrected: numeroDocumento -> numero_documento to match interface
      numero_documento: item.numero_documento,
      categoria: item.categoria,
      historico: item.historico,
      valorPago: Number(item.valor_pago || 0),
      competencia: item.competencia,
      formaPagamento: item.formaPagamento,
      chavePixBoleto: item.chave_pix_boleto
    }));
  }

  static async createSettlement(settlement: Settlement, titleIds: string[], user: User): Promise<boolean> {
    try {
      if (!supabase) return false;
      const { error: sError } = await supabase.from('settlements').insert({
        id: settlement.id, 
        cliente: settlement.cliente, 
        valor_original: settlement.valorOriginal,
        valor_acordo: settlement.valorAcordo, 
        parcelas: settlement.parcelas, 
        frequencia: settlement.frequencia,
        data_primeira_parcela: settlement.dataPrimeiraParcela, 
        status: 'ATIVO', 
        usuario: user.name, 
        observacao: settlement.observacao, 
        titulos_negociados: titleIds,
        created_at: new Date().toISOString()
      });
      if (sError) throw sError;

      const { data: currentTitles } = await supabase.from('accounts_receivable').select('ID, status_cobranca').in('ID', titleIds);
      
      const cartorioIds = (currentTitles || []).filter((t: any) => t.status_cobranca === 'CARTORIO').map((t: any) => t.ID);
      const normalIds = titleIds.filter(id => !cartorioIds.includes(id));

      if (normalIds.length > 0) {
        await supabase.from('accounts_receivable').update({ 
          id_acordo: settlement.id, 
          "Situação": 'NEGOCIADO', 
          "Saldo": 0,
          status_cobranca: 'BLOQUEADO_ACORDO'
        }).in('ID', normalIds);
      }

      if (cartorioIds.length > 0) {
        await supabase.from('accounts_receivable').update({ 
          id_acordo: settlement.id, 
          "Situação": 'NEGOCIADO', 
          "Saldo": 0,
          status_cobranca: 'BLOQUEADO_CARTORIO'
        }).in('ID', cartorioIds);
      }

      const parcelasItems = [];
      const valorParcela = settlement.valorAcordo / settlement.parcelas;
      let dataRef = new Date(settlement.dataPrimeiraParcela);

      for (let i = 1; i <= settlement.parcelas; i++) {
        parcelasItems.push({
          "ID": `${settlement.id}-${i}`,
          "Cliente": settlement.cliente,
          "Data Emissão": new Date().toISOString().split('T')[0],
          "Data Vencimento": dataRef.toISOString().split('T')[0],
          "Valor documento": valorParcela,
          "Saldo": valorParcela,
          "Situação": 'ABERTO',
          "Número documento": `PARC ${i}/${settlement.parcelas}`,
          "Categoria": 'ACORDO COMERCIAL',
          "Histórico": `PARCELA ${i} DO ACORDO ${settlement.id}`,
          "Competência": `${dataRef.getMonth() + 1}/${dataRef.getFullYear()}`,
          "Forma de recebimento": 'PIX',
          "Meio de recebimento": 'PIX',
          status_cobranca: 'NAO_COBRAVEL',
          origem: 'NZERP',
          id_acordo: settlement.id
        });

        if (settlement.frequencia === 'Semanal') dataRef.setDate(dataRef.getDate() + 7);
        else if (settlement.frequencia === 'Quinzenal') dataRef.setDate(dataRef.getDate() + 15);
        else dataRef.setMonth(dataRef.getMonth() + 1);
      }

      const { error: pError } = await supabase.from('accounts_receivable').insert(parcelasItems);
      if (pError) throw pError;

      return true;
    } catch (e) {
      console.error("Erro ao criar acordo:", e);
      return false;
    }
  }

  static async liquidateInstallment(id: string, dataLiquidacao: string, meio: string, user: User): Promise<boolean> {
    try {
      if (!supabase) return false;
      const { data: title } = await supabase.from('accounts_receivable').select('*').eq('ID', id).single();
      if (!title) return false;

      // Se já estiver pago, retorna sucesso mas não faz nada
      if (title['Situação'] === 'PAGO' || title['Saldo'] <= 0.01) return true;

      const valorOriginal = Number(title['Valor documento']);

      const { error } = await supabase.from('accounts_receivable').update({
        "Situação": 'PAGO',
        "Saldo": 0,
        "Recebido": valorOriginal,
        "Data Liquidação": dataLiquidacao,
        "Meio de recebimento": meio,
        status_cobranca: 'LIQUIDADO'
      }).eq('ID', id);

      if (error) throw error;

      await this.saveFinancialLog(user, 'BAIXA_PARCELA_ACORDO', title.Cliente, `Parcela ${id} liquidada via ${meio}.`, valorOriginal);
      return true;
    } catch (e) {
      console.error("Erro ao baixar parcela:", e);
      return false;
    }
  }

  static async finalizeSettlement(settlementId: string, user: User): Promise<boolean> {
    try {
      if (!supabase) return false;
      const { data: s, error: fError } = await supabase.from('settlements').select('*').eq('id', settlementId).single();
      if (fError || !s) throw new Error("Acordo não localizado.");

      await supabase.from('settlements').update({ status: 'LIQUIDADO' }).eq('id', settlementId);
      const idsOriginais: string[] = s.titulos_negociados || [];

      if (idsOriginais.length > 0) {
        const { error: updError } = await supabase.from('accounts_receivable')
            .update({
                "Situação": 'LIQUIDADO',
                "Saldo": 0,
                "Data Liquidação": new Date().toISOString().split('T')[0],
                status_cobranca: 'NAO_COBRAVEL'
            })
            .in('ID', idsOriginais);
            
        if (updError) throw updError;
      }

      await this.saveFinancialLog(user, 'LIQUIDACAO_TOTAL_ACORDO', s.cliente, `Acordo ${settlementId} FINALIZADO. Originais baixados.`, s.valor_acordo);
      return true;
    } catch (e) {
      console.error("Erro ao finalizar acordo:", e);
      return false;
    }
  }

  static async deleteSettlement(settlementId: string, user: User): Promise<boolean> {
    try {
      if (!supabase) return false;
      
      const { data: s, error: fError } = await supabase.from('settlements').select('*').eq('id', settlementId).single();
      if (fError || !s) throw new Error("Acordo não localizado.");

      const idsOriginais: string[] = s.titulos_negociados || [];

      const { data: relatedItems, error: rError } = await supabase.from('accounts_receivable').select('*').eq('id_acordo', settlementId);
      if (rError) throw rError;

      const originals = relatedItems.filter(i => idsOriginais.includes(i.ID) || i.status_cobranca === 'BLOQUEADO_ACORDO' || i.status_cobranca === 'BLOQUEADO_CARTORIO');
      const originalIds = originals.map(i => i.ID);
      const installments = relatedItems.filter(i => !originalIds.includes(i.id));

      if (installments.length > 0) {
        const instIds = installments.map(i => i.ID);
        const { error: delPartsError } = await supabase.from('accounts_receivable').delete().in('ID', instIds);
        if (delPartsError) throw delPartsError;
      }

      const today = new Date().toISOString().split('T')[0];
      for (const orig of originals) {
        const isOverdue = orig['Data Vencimento'] && orig['Data Vencimento'] < today;
        const wasInCartorio = orig.status_cobranca === 'BLOQUEADO_CARTORIO';

        await supabase.from('accounts_receivable').update({
          "Situação": wasInCartorio ? 'EM CARTORIO' : (isOverdue ? 'VENCIDO' : 'ABERTO'),
          "Saldo": Number(orig['Valor documento']),
          status_cobranca: wasInCartorio ? 'CARTORIO' : 'COBRAVEL',
          id_acordo: null
        }).eq('ID', orig.ID);
      }

      const { error: delContractError } = await supabase.from('settlements').delete().eq('id', settlementId);
      if (delContractError) throw delContractError;

      await this.saveFinancialLog(user, 'EXCLUSAO_ACORDO', s.cliente, `Acordo ${settlementId} EXCLUÍDO. Parcelas deletadas e originais restaurados ao status original.`, s.valor_acordo);
      return true;
    } catch (e: any) {
      console.error("NZERP Delete Error:", e.message);
      return false;
    }
  }

  static async getSettlements(): Promise<Settlement[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('settlements').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return data.map(s => ({
      ...s,
      valorOriginal: Number(s.valor_original || 0),
      valorAcordo: Number(s.valor_acordo || 0),
      dataPrimeiraParcela: s.data_primeira_parcela,
      dataCriacao: s.created_at,
      titulosNegociados: s.titulos_negociados
    }));
  }

  static async getSettlementDetails(settlementId: string): Promise<{ installments: AccountsReceivable[], originals: AccountsReceivable[] }> {
    if (!supabase) return { installments: [], originals: [] };
    
    const { data: s } = await supabase.from('settlements').select('titulos_negociados').eq('id', settlementId).single();
    const idsOriginais: string[] = s?.titulos_negociados || [];

    const { data: allRelated, error } = await supabase.from('accounts_receivable').select('*').eq('id_acordo', settlementId).order('Data Vencimento', { ascending: true });
    if (error) return { installments: [], originals: [] };

    const mapper = (item: any) => ({
      id: item.ID,
      cliente: item.Cliente,
      data_emissao: item['Data Emissão'],
      data_vencimento: item['Data Vencimento'],
      data_liquidacao: item['Data Liquidação'],
      valor_documento: Number(item['Valor documento'] || 0),
      saldo: Number(item.Saldo || 0),
      situacao: item['Situação'],
      numero_documento: item['Número documento'],
      categoria: item.Categoria,
      historico: item.Histórico,
      valor_recebido: Number(item.Recebido || 0),
      id_acordo: item.id_acordo,
      origem: item.origem,
      statusCobranca: item.status_cobranca,
      forma_pagamento: item['Forma de recebimento'],
      meio_recebimento: item['Meio de recebimento'],
      numero_banco: item['Número no banco'],
      competencia: item.Competência,
      taxas: Number(item.Taxas || 0),
      data_recebimento: item.data_recebimento,
    } as unknown as AccountsReceivable);

    const originals = allRelated.filter(i => idsOriginais.includes(i.ID) || i.status_cobranca === 'BLOQUEADO_ACORDO' || i.status_cobranca === 'BLOQUEADO_CARTORIO').map(mapper);
    const originalIds = originals.map(i => i.id);
    const installments = allRelated.filter(i => !originalIds.includes(i.id)).map(mapper);

    return { installments, originals };
  }

  static async processARStaging(items: AccountsReceivable[]): Promise<ARStagingItem[]> {
    const current = await this.getAccountsReceivable();
    return items.map(item => {
      const match = current.find(c => c.id === item.id);
      
      if (!match) return { data: item, status: 'NEW' as const };

      const diff: string[] = [];
      const cleanDate = (d: string | null | undefined) => d ? new Date(d).toISOString().split('T')[0] : '';
      
      if (cleanDate(match.data_vencimento) !== cleanDate(item.data_vencimento)) diff.push('VENCIMENTO');
      if (Math.abs(Number(match.saldo || 0) - Number(item.saldo || 0)) > 0.01) diff.push('SALDO');
      if ((match.situacao || '').toUpperCase() !== (item.situacao || '').toUpperCase()) diff.push('SITUAÇÃO');

      if (diff.length > 0) return { data: item, status: 'CHANGED' as const, diff };
      return { data: item, status: 'UNCHANGED' as const };
    });
  }

  static async processAPStaging(items: AccountsPayable[]): Promise<APStagingItem[]> {
    const current = await this.getAccountsPayable();
    const cleanStr = (s: any) => (s || '').toString().trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');
    const cleanNum = (n: any) => Number(n || 0);

    return items.map(item => {
      const match = current.find(c => cleanStr(c.id) === cleanStr(item.id));
      if (!match) return { data: item, status: 'NEW' as const };
      
      const diff: string[] = [];
      if (cleanStr(match.situacao) !== cleanStr(item.situacao)) diff.push('SITUAÇÃO');
      if (Math.abs(cleanNum(match.saldo) - cleanNum(item.saldo)) > 0.01) diff.push('SALDO');

      if (diff.length > 0) return { data: item, status: 'CHANGED' as const, diff };
      return { data: item, status: 'UNCHANGED' as const };
    });
  }

  static async commitARBatch(staging: ARStagingItem[], user: User, fileName?: string): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) return { success: false, message: 'DB Offline' };
      const itemsToSave = staging.map(s => ({ 
        "ID": s.data.id,
        "Cliente": s.data.cliente,
        "Data Emissão": s.data.data_emissao || null,
        "Data Vencimento": s.data.data_vencimento || null,
        "Data Liquidação": s.data.data_liquidacao || null,
        "Valor documento": s.data.valor_documento,
        "Saldo": s.data.saldo,
        "Situação": s.data.situacao,
        "Número documento": s.data.numero_documento,
        "Número no banco": s.data.numero_banco,
        "Categoria": s.data.categoria,
        "Histórico": s.data.historico,
        "Competência": s.data.competencia,
        "Forma de recebimento": s.data.forma_pagamento,
        "Meio de recebimento": s.data.meio_recebimento,
        "Taxas": s.data.taxas,
        "Recebido": s.data.valor_recebido,
        origem: s.data.origem || 'OLIST',
        status_cobranca: s.data.statusCobranca,
        id_acordo: s.data.id_acordo || null,
        data_recebimento: s.data.data_recebimento || null
      }));

      const { error: upsertError } = await supabase.from('accounts_receivable').upsert(itemsToSave, { onConflict: 'ID' });
      if (upsertError) throw upsertError;
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  static async commitAPBatch(staging: APStagingItem[], user: User, fileName?: string): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) return { success: false, message: 'DB Offline' };
      const itemsToSave = staging.filter(s => s.status !== 'UNCHANGED').map(s => ({
        id: s.data.id,
        fornecedor: s.data.fornecedor,
        data_emissao: s.data.dataEmissao || null,
        data_vencimento: s.data.dataVencimento || null,
        data_liquidacao: s.data.dataLiquidacao || null,
        valor_documento: s.data.valorDocumento,
        saldo: s.data.saldo,
        situacao: s.data.situacao,
        // Corrected: s.data.numeroDocumento -> s.data.numero_documento
        numero_documento: s.data.numero_documento,
        categoria: s.data.categoria,
        historico: s.data.historico,
        valor_pago: s.data.valorPago,
        competencia: s.data.competencia,
        forma_pagamento: s.data.formaPagamento,
        chave_pix_boleto: s.data.chavePixBoleto
      }));

      if (itemsToSave.length > 0) {
        const { error: upsertError } = await supabase.from('accounts_payable').upsert(itemsToSave, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        if (fileName) {
          await this.saveFinancialLog(user, 'IMPORTACAO_AP', fileName, `Importação Olist Contas a Pagar: ${itemsToSave.length} registros.`, itemsToSave.length);
        }
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  static async getLastAPImport(): Promise<{ fileName: string; timestamp: string } | null> {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('financial_logs')
        .select('cliente, timestamp') // 'cliente' é usado para o nome do arquivo aqui
        .eq('acao', 'IMPORTACAO_AP')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();
      
      if (error || !data) {
        if (error && error.code !== 'PGRST116') { // Ignora 'no rows found'
          console.error("Erro ao buscar último import:", error);
        }
        return null;
      }
      return { fileName: data.cliente, timestamp: data.timestamp };
    } catch (e) {
      console.error("Exceção ao buscar último import:", e);
      return null;
    }
  }

  static async sendTitlesToNotary(titleIds: string[], user: User): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) return { success: false, message: 'DB Offline' };
      const { error } = await supabase.from('accounts_receivable')
        .update({ status_cobranca: 'CARTORIO', "Situação": 'EM CARTORIO' })
        .in('ID', titleIds);
      if (error) throw error;
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  static async removeTitlesFromNotary(titleIds: string[], user: User): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) return { success: false, message: 'DB Offline' };
      const { error } = await supabase.from('accounts_receivable')
        .update({ status_cobranca: 'COBRAVEL', "Situação": 'VENCIDO' })
        .in('ID', titleIds);
      if (error) throw error;

      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }
}
