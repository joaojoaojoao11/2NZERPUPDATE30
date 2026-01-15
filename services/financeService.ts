
// Fix: Correctly import 'supabaseClient' as 'supabase' from './core'
import { supabaseClient as supabase } from './core';
import { 
  AccountsReceivable, AccountsPayable, Settlement, ARStagingItem, 
  APStagingItem, User, AuditLog, FinancialImportRecord, ImportSummary, CollectionHistory
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
    const { data, error } = await supabase.from('accounts_receivable').select('*').order('data_vencimento', { ascending: true });
    if (error) return [];
    
    return data.map(item => ({
      id: item.id,
      cliente: item.cliente,
      data_emissao: item.data_emissao,
      data_vencimento: item.data_vencimento,
      data_liquidacao: item.data_liquidacao,
      valor_documento: Number(item.valor_documento || 0),
      saldo: Number(item.saldo || 0),
      situacao: item.situacao,
      numero_documento: item.numero_documento,
      numero_banco: item.numero_banco,
      categoria: item.categoria,
      historico: item.historico,
      competencia: item.competencia,
      forma_pagamento: item.forma_pagamento,
      meio_recebimento: item.meio_recebimento,
      taxas: Number(item.taxas || 0),
      valor_recebido: Number(item.valor_recebido || 0),
      id_acordo: item.id_acordo,
      origem: item.origem,
      statusCobranca: item.status_cobranca
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
      numeroDocumento: item.numero_documento,
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

      // Verifica status atual dos títulos para decidir o tipo de bloqueio
      const { data: currentTitles } = await supabase.from('accounts_receivable').select('id, status_cobranca').in('id', titleIds);
      
      const cartorioIds = (currentTitles || [])
        .filter((t: any) => t.status_cobranca === 'CARTORIO')
        .map((t: any) => t.id);
      
      const normalIds = titleIds.filter(id => !cartorioIds.includes(id));

      // Bloqueia títulos normais
      if (normalIds.length > 0) {
        await supabase.from('accounts_receivable').update({ 
          id_acordo: settlement.id, 
          situacao: 'NEGOCIADO', 
          saldo: 0,
          status_cobranca: 'BLOQUEADO_ACORDO'
        }).in('id', normalIds);
      }

      // Bloqueia títulos de cartório (com status diferenciado para retorno futuro)
      if (cartorioIds.length > 0) {
        await supabase.from('accounts_receivable').update({ 
          id_acordo: settlement.id, 
          situacao: 'NEGOCIADO', 
          saldo: 0,
          status_cobranca: 'BLOQUEADO_CARTORIO'
        }).in('id', cartorioIds);
      }

      const parcelasItems = [];
      const valorParcela = settlement.valorAcordo / settlement.parcelas;
      let dataRef = new Date(settlement.dataPrimeiraParcela);

      for (let i = 1; i <= settlement.parcelas; i++) {
        parcelasItems.push({
          id: `${settlement.id}-${i}`,
          cliente: settlement.cliente,
          data_emissao: new Date().toISOString().split('T')[0],
          data_vencimento: dataRef.toISOString().split('T')[0],
          valor_documento: valorParcela,
          saldo: valorParcela,
          situacao: 'ABERTO',
          numero_documento: `PARC ${i}/${settlement.parcelas}`,
          categoria: 'ACORDO COMERCIAL',
          historico: `PARCELA ${i} DO ACORDO ${settlement.id}`,
          competencia: `${dataRef.getMonth() + 1}/${dataRef.getFullYear()}`,
          forma_pagamento: 'PIX',
          meio_recebimento: 'PIX',
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
      const { data: title } = await supabase.from('accounts_receivable').select('valor_documento, cliente').eq('id', id).single();
      if (!title) return false;

      const { error } = await supabase.from('accounts_receivable').update({
        situacao: 'PAGO',
        saldo: 0,
        valor_recebido: title.valor_documento,
        data_liquidacao: dataLiquidacao,
        meio_recebimento: meio
      }).eq('id', id);

      if (error) throw error;

      await this.saveFinancialLog(user, 'BAIXA_PARCELA_ACORDO', title.cliente, `Parcela ${id} liquidada via ${meio}.`, title.valor_documento);
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

      // 1. Atualizar Status do Acordo
      await supabase.from('settlements').update({ status: 'LIQUIDADO' }).eq('id', settlementId);

      // 2. Liquidar Títulos Originais (usando a lista oficial do acordo)
      const idsOriginais: string[] = s.titulos_negociados || [];

      if (idsOriginais.length > 0) {
        // Update em lote para performance, marcando todos os originais como LIQUIDADO
        const { error: updError } = await supabase.from('accounts_receivable')
            .update({
                situacao: 'LIQUIDADO',
                saldo: 0,
                data_liquidacao: new Date().toISOString().split('T')[0],
                status_cobranca: 'NAO_COBRAVEL'
            })
            .in('id', idsOriginais);
            
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

      const { data: relatedItems, error: rError } = await supabase
        .from('accounts_receivable')
        .select('*')
        .eq('id_acordo', settlementId);

      if (rError) throw rError;

      const originals = relatedItems.filter(i => 
        idsOriginais.includes(i.id) || 
        i.status_cobranca === 'BLOQUEADO_ACORDO' ||
        i.status_cobranca === 'BLOQUEADO_CARTORIO'
      );
      const originalIds = originals.map(i => i.id);
      const installments = relatedItems.filter(i => !originalIds.includes(i.id));

      // 4. EXCLUIR AS PARCELAS FISICAMENTE (Diferença do Cancelar)
      if (installments.length > 0) {
        const instIds = installments.map(i => i.id);
        const { error: delPartsError } = await supabase.from('accounts_receivable')
          .delete()
          .in('id', instIds);
        
        if (delPartsError) throw delPartsError;
      }

      // 5. RESTAURAR TÍTULOS ORIGINAIS
      const today = new Date().toISOString().split('T')[0];

      for (const orig of originals) {
        const isOverdue = orig.data_vencimento && orig.data_vencimento < today;
        const wasInCartorio = orig.status_cobranca === 'BLOQUEADO_CARTORIO';

        await supabase.from('accounts_receivable').update({
          // Se estava em cartório, volta para situação 'EM CARTORIO', senão 'VENCIDO'/'ABERTO'
          situacao: wasInCartorio ? 'EM CARTORIO' : (isOverdue ? 'VENCIDO' : 'ABERTO'),
          saldo: Number(orig.valor_documento),
          // Restaura status: se era BLOQUEADO_CARTORIO volta para CARTORIO, senão COBRAVEL
          status_cobranca: wasInCartorio ? 'CARTORIO' : 'COBRAVEL',
          id_acordo: null
        }).eq('id', orig.id);
      }

      // 6. EXCLUIR O REGISTRO DO ACORDO (Diferença do Cancelar)
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
      titulosNegociados: s.titulos_negociados // Carrega o array importante
    }));
  }

  static async getSettlementDetails(settlementId: string): Promise<{ installments: AccountsReceivable[], originals: AccountsReceivable[] }> {
    if (!supabase) return { installments: [], originals: [] };
    
    // 1. Busca o acordo para pegar os IDs
    const { data: s } = await supabase.from('settlements').select('titulos_negociados').eq('id', settlementId).single();
    const idsOriginais: string[] = s?.titulos_negociados || [];

    // 2. Busca tudo vinculado
    const { data: allRelated, error } = await supabase.from('accounts_receivable').select('*').eq('id_acordo', settlementId).order('data_vencimento', { ascending: true });
    if (error) return { installments: [], originals: [] };

    const mapper = (item: any) => ({
      id: item.id,
      cliente: item.cliente,
      data_emissao: item.data_emissao,
      data_vencimento: item.data_vencimento,
      data_liquidacao: item.data_liquidacao,
      valor_documento: Number(item.valor_documento || 0),
      saldo: Number(item.saldo || 0),
      situacao: item.situacao,
      numero_documento: item.numero_documento,
      categoria: item.categoria,
      historico: item.historico,
      valor_recebido: Number(item.valor_recebido || 0),
      id_acordo: item.id_acordo,
      origem: item.origem,
      statusCobranca: item.status_cobranca,
      forma_pagamento: item.forma_pagamento,
      meio_recebimento: item.meio_recebimento
    } as unknown as AccountsReceivable);

    // 3. Separação correta usando a lista de IDs + Status Cobrança para robustez
    const originals = allRelated.filter(i => 
        idsOriginais.includes(i.id) || 
        i.status_cobranca === 'BLOQUEADO_ACORDO' ||
        i.status_cobranca === 'BLOQUEADO_CARTORIO'
    ).map(mapper);
    
    const originalIds = originals.map(i => i.id);
    const installments = allRelated.filter(i => !originalIds.includes(i.id)).map(mapper);

    return { installments, originals };
  }

  static async processARStaging(items: AccountsReceivable[]): Promise<ARStagingItem[]> {
    const current = await this.getAccountsReceivable();
    return items.map(item => {
      const match = current.find(c => c.id === item.id);
      
      if (!match) return { data: item, status: 'NEW' as const };

      // LÓGICA DE DETECÇÃO DE MUDANÇA (VENCIMENTO, SALDO, SITUAÇÃO)
      const diff: string[] = [];
      
      const cleanDate = (d: string | null | undefined) => d ? new Date(d).toISOString().split('T')[0] : '';
      
      if (cleanDate(match.data_vencimento) !== cleanDate(item.data_vencimento)) {
          diff.push('VENCIMENTO');
      }
      
      if (Math.abs(Number(match.saldo || 0) - Number(item.saldo || 0)) > 0.01) {
          diff.push('SALDO');
      }
      
      if ((match.situacao || '').toUpperCase() !== (item.situacao || '').toUpperCase()) {
          diff.push('SITUAÇÃO');
      }

      if (diff.length > 0) {
          return { data: item, status: 'CHANGED' as const, diff };
      }

      return { data: item, status: 'UNCHANGED' as const };
    });
  }

  static async processAPStaging(items: AccountsPayable[]): Promise<APStagingItem[]> {
    const current = await this.getAccountsPayable();
    
    // Funções de limpeza reforçadas
    const cleanStr = (s: any) => {
        if (s === null || s === undefined) return '';
        const str = String(s);
        // Evita strings literais "null" ou "undefined" que possam ter sido passadas
        if (str === 'null' || str === 'undefined') return '';
        return str.trim().toUpperCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // Remove acentos
            .replace(/\s+/g, ' '); // Remove espaços duplos
    };
    
    const cleanNum = (n: any) => {
        if (n === null || n === undefined || n === '') return 0;
        return Number(n);
    };

    return items.map(item => {
      // Comparação de ID insensível a caixa
      const match = current.find(c => cleanStr(c.id) === cleanStr(item.id));
      if (!match) return { data: item, status: 'NEW' as const };
      
      const diff: string[] = [];
      
      // REQUISITO: Monitorar apenas Situação e Saldo
      if (cleanStr(match.situacao) !== cleanStr(item.situacao)) diff.push('SITUAÇÃO');
      
      // Comparação numérica para Saldo
      if (Math.abs(cleanNum(match.saldo) - cleanNum(item.saldo)) > 0.01) diff.push('SALDO');

      if (diff.length > 0) {
          console.debug(`Diff detectado para ID ${item.id}:`, diff);
          return { data: item, status: 'CHANGED' as const, diff };
      }
      return { data: item, status: 'UNCHANGED' as const };
    });
  }

  static async commitARBatch(staging: ARStagingItem[], user: User, fileName?: string): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) return { success: false, message: 'DB Offline' };
      const itemsToSave = staging.map(s => ({ 
        id: s.data.id, 
        cliente: s.data.cliente, 
        data_emissao: s.data.data_emissao || null, 
        data_vencimento: s.data.data_vencimento || null, 
        valor_documento: s.data.valor_documento, 
        saldo: s.data.saldo, 
        situacao: s.data.situacao, 
        numero_documento: s.data.numero_documento, 
        categoria: s.data.categoria, 
        historico: s.data.historico, 
        competencia: s.data.competencia, 
        forma_pagamento: s.data.forma_pagamento,
        origem: s.data.origem || 'OLIST', 
        status_cobranca: s.data.statusCobranca
      }));

      const { error: upsertError } = await supabase.from('accounts_receivable').upsert(itemsToSave, { onConflict: 'id' });
      if (upsertError) throw upsertError;
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  static async commitAPBatch(staging: APStagingItem[], user: User): Promise<{ success: boolean; message?: string }> {
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
        numero_documento: s.data.numeroDocumento, // Corrected to camelCase
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
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  static async sendTitlesToNotary(titleIds: string[], user: User): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) return { success: false, message: 'DB Offline' };
      
      const { error } = await supabase.from('accounts_receivable')
        .update({ status_cobranca: 'CARTORIO', situacao: 'EM CARTORIO' })
        .in('id', titleIds);

      if (error) throw error;

      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  static async removeTitlesFromNotary(titleIds: string[], user: User): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) return { success: false, message: 'DB Offline' };
      
      // Retorna para situação padrão de cobrança (VENCIDO pois provavelmente está atrasado se estava em cartório)
      const { error } = await supabase.from('accounts_receivable')
        .update({ status_cobranca: 'COBRAVEL', situacao: 'VENCIDO' })
        .in('id', titleIds);

      if (error) throw error;

      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }
}
