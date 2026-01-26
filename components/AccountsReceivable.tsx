import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FinanceService } from '../services/financeService';
import { DataService } from '../services/dataService';
import { AccountsReceivable, User, ARStagingItem } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import * as XLSX from 'xlsx';
import { supabaseClient as supabase } from '../services/core'; // Adicionado para a sincronização

const AccountsReceivableModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [data, setData] = useState<AccountsReceivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false); // Novo estado para o botão de sync
   
  const [searchTerm, setSearchTerm] = useState('');

  // Estados de Ordenação
  const [sortConfig, setSortConfig] = useState<{ key: keyof AccountsReceivable; direction: 'asc' | 'desc' }>({
    key: 'data_vencimento',
    direction: 'desc' // Padrão: Mais recente para mais antigo
  });

  // Estados de Filtros Avançados
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    origin: 'TODOS',
    paymentMethod: 'TODOS',
    status: 'TODOS'
  });

  // Estados de Importação
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStaging, setImportStaging] = useState<ARStagingItem[] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getStatusBadgeStyle = (status?: string): string => {
    const normalizedStatus = (status || '').toUpperCase();

    if (['PAGO', 'LIQUIDADO', 'RECEBIDO', 'QUITADO'].some(s => normalizedStatus.includes(s))) {
        return 'bg-emerald-50 text-emerald-600 border-emerald-100';
    }
    if (normalizedStatus.includes('VENCIDO')) {
        return 'bg-red-50 text-red-600 border-red-100';
    }
    if (normalizedStatus.includes('ABERTO')) {
        return 'bg-orange-50 text-orange-600 border-orange-100';
    }
    if (normalizedStatus.includes('CANCELADO')) {
        return 'bg-slate-100 text-slate-500 border-slate-200';
    }
    if (normalizedStatus.includes('NEGOCIADO')) {
        return 'bg-blue-50 text-blue-600 border-blue-100';
    }
    // Default style for unknown statuses
    return 'bg-slate-100 text-slate-500 border-slate-200';
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const items = await FinanceService.getAccountsReceivable();
      // NORMALIZAÇÃO DE DADOS: Garante que 'ABERTO' seja sempre tratado como 'EM ABERTO'
      const normalizedItems = items.map(i => ({
        ...i,
        situacao: (i.situacao === 'ABERTO' ? 'EM ABERTO' : i.situacao) || 'EM ABERTO'
      }));
      setData(normalizedItems);
    } catch (e) {
      setToast({ msg: 'Erro ao carregar títulos.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // --- NOVA FUNÇÃO DE SINCRONIZAÇÃO ---
  const handleSyncFinance = async () => {
    setIsSyncing(true);
    setToast({ msg: 'Buscando dados no Tiny...', type: 'info' }); // Mantido o estilo de toast original (info não existia no type, mas ajustei abaixo se necessário, ou usa success)

    try {
      const { data, error } = await supabase.functions.invoke('finance-integration');

      if (error) throw error;

      const count = data?.upserted_count || 0;
      setToast({ msg: `Sucesso! ${count} contas atualizadas.`, type: 'success' });
      await fetchData(); 
      
    } catch (err: any) {
      console.error(err);
      setToast({ msg: `Erro na sincronização: ${err.message}`, type: 'error' });
    } finally {
      setIsSyncing(false);
    }
  };

  // Opções dinâmicas para os filtros baseadas nos dados carregados
  const uniqueOrigins = useMemo(() => Array.from(new Set(data.map(i => i.origem || 'OUTROS'))).sort(), [data]);
  const uniqueMethods = useMemo(() => Array.from(new Set(data.map(i => i.forma_pagamento || 'OUTROS'))).sort(), [data]);

  const filteredData = useMemo(() => {
    const term = searchTerm.toLowerCase();
     
    return data.filter(item => {
      // 1. Filtro Textual (Busca Inteligente)
      const matchesSearch = 
        (item.cliente || '').toLowerCase().includes(term) ||
        (item.numero_documento || '').toLowerCase().includes(term) ||
        (item.id || '').toLowerCase().includes(term) ||
        (item.id_acordo || '').toLowerCase().includes(term) ||
        (item.origem || '').toLowerCase().includes(term);

      if (!matchesSearch) return false;

      // 2. Filtro de Período (Vencimento)
      if (filters.startDate || filters.endDate) {
        if (!item.data_vencimento) return false;
        const itemDate = item.data_vencimento;
        if (filters.startDate && itemDate < filters.startDate) return false;
        if (filters.endDate && itemDate > filters.endDate) return false;
      }

      // 3. Filtro de Origem
      if (filters.origin !== 'TODOS' && (item.origem || 'OUTROS') !== filters.origin) return false;

      // 4. Filtro de Forma de Pagamento
      if (filters.paymentMethod !== 'TODOS' && (item.forma_pagamento || 'OUTROS') !== filters.paymentMethod) return false;

      // 5. Filtro de Situação
      if (filters.status !== 'TODOS') {
        const isCanceled = item.situacao === 'CANCELADO';
        // Só considera vencido se NÃO estiver cancelado
        const isOverdue = !isCanceled && item.data_vencimento && new Date(item.data_vencimento) < new Date() && item.saldo > 0.01;
        
        // Como normalizamos na entrada, item.situacao já estará correto (EM ABERTO)
        const statusItem = item.situacao || 'EM ABERTO';

        if (filters.status === 'VENCIDO') {
          if (!isOverdue) return false;
        } else if (filters.status === 'EM ABERTO') {
          // Mostra apenas EM ABERTO que NÃO está vencido e NÃO está cancelado
          if (statusItem !== 'EM ABERTO' || isOverdue || isCanceled) return false;
        } else {
          // PAGO, NEGOCIADO, LIQUIDADO, CANCELADO etc.
          if (statusItem !== filters.status) return false;
        }
      }

      return true;
    });
  }, [data, searchTerm, filters]);

  // Lógica de Ordenação Aplicada sobre os Dados Filtrados
  const sortedData = useMemo(() => {
    const sorted = [...filteredData];
    if (!sortConfig) return sorted;

    return sorted.sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      // Tratamento para nulos/undefined
      if (aValue === bValue) return 0;
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      // Comparação
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConfig]);

  const handleSort = (key: keyof AccountsReceivable) => {
    let direction: 'asc' | 'desc' = 'desc'; // Padrão inicial ao clicar: DESC (Maior para Menor / Mais Recente)
     
    if (sortConfig.key === key) {
      // Se já está ordenado por essa coluna, inverte
      direction = sortConfig.direction === 'desc' ? 'asc' : 'desc';
    }
     
    setSortConfig({ key, direction });
  };

  const SortButton = ({ column }: { column: keyof AccountsReceivable }) => {
    const isActive = sortConfig.key === column;
    return (
      <button 
        type="button"
        className={`ml-2 p-1 rounded-md transition-all flex items-center justify-center w-5 h-5 ${
          isActive 
            ? 'bg-blue-600 text-white shadow-sm' 
            : 'bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-white'
        }`}
        title="Ordenar Maior/Menor"
      >
        <span className="text-[9px] leading-none">
          {isActive ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    );
  };

  const renderSortableHeader = (label: string, key: keyof AccountsReceivable, align: 'left' | 'center' | 'right' = 'left', extraClasses = '') => (
    <th 
      className={`bg-slate-900 text-slate-400 px-4 py-5 text-[9px] font-black uppercase border-b border-slate-800 cursor-pointer hover:text-white transition-colors group select-none text-${align} ${extraClasses}`}
      onClick={() => handleSort(key)}
    >
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
        <span>{label}</span>
        <SortButton column={key} />
      </div>
    </th>
  );

  const downloadTemplate = () => {
    const headers = [
      "ID", "CLIENTE", "DATA_EMISSAO", "DATA_VENCIMENTO", "VALOR_DOCUMENTO", 
      "SALDO", "SITUACAO", "NUMERO_DOCUMENTO", "CATEGORIA", "HISTORICO", 
      "COMPETENCIA", "FORMA_PAGAMENTO", "VALOR_RECEBIDO"
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modelo_Contas_Receber");
    XLSX.writeFile(wb, "Modelo_Importacao_OLIST.xlsx");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const dataArray = new Uint8Array(event.target?.result as ArrayBuffer);
            const workbook = XLSX.read(dataArray, { type: 'array', cellDates: true });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            if (jsonData.length < 2) throw new Error("Planilha vazia ou sem dados.");

            const headers = (jsonData[0] as string[]).map(h => 
                String(h).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
            );

            const findIdx = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)));

            const col = {
                id: findIdx(['id', 'codigo']),
                cliente: findIdx(['cliente', 'sacado']),
                emissao: findIdx(['emissao']),
                vencimento: findIdx(['vencimento']),
                liquidacao: findIdx(['liquidacao', 'pagamento']),
                valor: findIdx(['valor doc']),
                saldo: findIdx(['saldo']),
                situacao: findIdx(['situacao', 'status']),
                doc: findIdx(['numero doc']),
                banco: findIdx(['numero banco', 'numero no banco']),
                categoria: findIdx(['categoria']),
                historico: findIdx(['historico']),
                forma: findIdx(['forma de recebimento', 'forma pagamento']),
                meio: findIdx(['meio de recebimento']),
                taxas: findIdx(['taxas']),
                competencia: findIdx(['competencia']),
                recebido: findIdx(['recebido', 'valor recebido']),
            };

            if (col.id === -1) throw new Error("Coluna ID/CÓDIGO não identificada no arquivo.");

            const rows = jsonData.slice(1);
             
            const parsedItems: AccountsReceivable[] = rows.map((row: any) => {
                const getRaw = (idx: number) => idx !== -1 ? row[idx] : undefined;
                 
                let rawId = getRaw(col.id);
                if (!rawId) return null;
                 
                const idStr = String(rawId).trim();
                let rawSituacao = String(getRaw(col.situacao) || 'EM ABERTO').toUpperCase().trim();

                const parseMoney = (v: any) => {
                    if (typeof v === 'number') return v;
                    if (!v) return 0;
                    return parseFloat(String(v).replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0;
                };

                const parseDate = (v: any) => {
                    if (!v) return '';
                    if (v instanceof Date) return v.toISOString().split('T')[0];
                    const str = String(v).trim();
                    if (str.match(/^\d{2}\/\d{2}\/\d{4}/)) {
                        const parts = str.split('/');
                        return `${parts[2]}-${parts[1]}-${parts[0]}`;
                    }
                    return str.substring(0, 10);
                };

                return {
                    id: idStr,
                    cliente: String(getRaw(col.cliente) || 'N/A').toUpperCase(),
                    data_emissao: parseDate(getRaw(col.emissao)),
                    data_vencimento: parseDate(getRaw(col.vencimento)),
                    data_liquidacao: parseDate(getRaw(col.liquidacao)),
                    valor_documento: parseMoney(getRaw(col.valor)),
                    saldo: parseMoney(getRaw(col.saldo)),
                    situacao: rawSituacao,
                    numero_documento: String(getRaw(col.doc) || ''),
                    numero_banco: String(getRaw(col.banco) || ''),
                    categoria: String(getRaw(col.categoria) || 'VENDAS').toUpperCase(),
                    historico: String(getRaw(col.historico) || ''),
                    forma_pagamento: String(getRaw(col.forma) || 'OUTROS').toUpperCase(),
                    meio_recebimento: String(getRaw(col.meio) || '').toUpperCase(),
                    taxas: parseMoney(getRaw(col.taxas)),
                    competencia: String(getRaw(col.competencia) || ''),
                    valor_recebido: parseMoney(getRaw(col.recebido)),
                    origem: 'OLIST',
                } as AccountsReceivable;
            }).filter((i): i is AccountsReceivable => i !== null && i.valor_documento > 0);

            if (parsedItems.length === 0) throw new Error("Nenhum dado válido processado.");

            const staging = await FinanceService.processARStaging(parsedItems);
            setImportStaging(staging);

        } catch (err: any) {
            setToast({ msg: `Erro na leitura: ${err.message}`, type: 'error' });
        } finally {
            setIsProcessing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmImport = async () => {
      if (!importStaging) return;
      setIsProcessing(true);
      try {
          const res = await FinanceService.commitARBatch(importStaging, currentUser, 'Importação Olist');
          if (res.success) {
              setToast({ msg: 'IMPORTAÇÃO OLIST CONCLUÍDA!', type: 'success' });
              setImportStaging(null);
              setShowImportModal(false);
              await fetchData();
          } else {
              setToast({ msg: res.message || 'Erro ao salvar.', type: 'error' });
          }
      } catch (e) {
          setToast({ msg: 'Erro de comunicação.', type: 'error' });
      } finally {
          setIsProcessing(false);
      }
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(sortedData.map(d => ({
        ID: d.id,
        ID_Acordo: d.id_acordo,
        Origem: d.origem,
        Cliente: d.cliente,
        Vencimento: d.data_vencimento,
        Valor: d.valor_documento,
        Saldo: d.saldo,
        Status: d.situacao,
        Doc: d.numero_documento
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ContasReceber");
    XLSX.writeFile(wb, "ContasReceber_NZERP.xlsx");
  };

  const hasActiveFilters = filters.startDate !== '' || filters.endDate !== '' || filters.origin !== 'TODOS' || filters.paymentMethod !== 'TODOS' || filters.status !== 'TODOS';

  const clearFilters = () => {
    setFilters({
      startDate: '',
      endDate: '',
      origin: 'TODOS',
      paymentMethod: 'TODOS',
      status: 'TODOS'
    });
    setShowFilterModal(false);
  };

  if (loading) return <div className="p-20 text-center opacity-30 font-black uppercase text-xs italic animate-pulse">Carregando Títulos...</div>;

  // Ajuste do tipo do toast para aceitar 'info' se necessário, ou convertemos para 'success' na chamada.
  // Como o type original do componente Toast não foi fornecido, assumo que aceita 'success' | 'error' | 'info' ou adapto.
  // Vou garantir que o componente Toast receba os tipos certos.

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10 flex flex-col h-full">
      {toast && <Toast message={toast.msg} type={toast.type as any} onClose={() => setToast(null)} />}
       
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Contas a Receber</h2>
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mt-2 italic">
            Controle Financeiro Centralizado
          </p>
        </div>
        
        <div className="flex gap-3 items-center">
           <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex-1 md:w-auto">
              {/* --- BOTÃO DE SINCRONIZAR AQUI (ESQUERDA DO CAMPO) --- */}
              <button
                onClick={handleSyncFinance}
                disabled={isSyncing}
                className="p-2 rounded-xl transition-all text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                title="Sincronizar com Tiny"
              >
                {isSyncing ? (
                   <div className="w-5 h-5 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
                ) : (
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                )}
              </button>
              <div className="h-6 w-px bg-slate-100"></div>
              {/* ---------------------------------------------------- */}

              <input 
                type="text" 
                placeholder="BUSCAR CLIENTE, ORIGEM OU DOC..." 
                className="w-full md:w-64 px-4 py-2 bg-transparent outline-none font-bold text-xs uppercase"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className="h-6 w-px bg-slate-100"></div>
              <button 
                onClick={() => setShowFilterModal(true)}
                className={`p-2 rounded-xl transition-all ${hasActiveFilters ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
                title="Filtros Avançados"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
              </button>
           </div>

           <button 
             onClick={exportExcel}
             className="px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center space-x-2 italic"
           >
              <ICONS.Upload className="w-3.5 h-3.5 rotate-180" />
              <span>Exportar</span>
           </button>
           <button 
             onClick={() => setShowImportModal(true)} 
             className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-blue-600 transition-all flex items-center space-x-2 italic"
           >
             <ICONS.Upload className="w-3.5 h-3.5" />
             <span>Importar OLIST</span>
           </button>
        </div>
      </div>

      <div className="table-container flex-1 overflow-auto border border-slate-200 rounded-[2rem] bg-white shadow-sm relative" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <table className="w-full border-separate border-spacing-0" style={{ minWidth: '2800px' }}>
          <thead>
            <tr>
              <th 
                className="bg-slate-900 text-slate-400 px-4 py-5 text-[9px] font-black uppercase border-b border-slate-800 cursor-pointer hover:text-white transition-colors group select-none text-left sticky left-0 z-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
                style={{ width: '150px', minWidth: '150px' }}
                onClick={() => handleSort('id')}
              >
                <div className="flex items-center gap-1 justify-start">
                  <span>ID LANÇAMENTO</span>
                  <SortButton column="id" />
                </div>
              </th>
              {renderSortableHeader("ID Acordo", "id_acordo")}
              {renderSortableHeader("Cliente", "cliente", "left", "min-w-[200px]")}
              {renderSortableHeader("Data Emissão", "data_emissao", "center")}
              {renderSortableHeader("Data Venc.", "data_vencimento", "center")}
              {renderSortableHeader("Data Liq.", "data_liquidacao", "center")}
              {renderSortableHeader("Valor Doc.", "valor_documento", "right")}
              {renderSortableHeader("Saldo", "saldo", "right")}
              {renderSortableHeader("Situação", "situacao", "center")}
              {renderSortableHeader("Nº Doc", "numero_documento")}
              {renderSortableHeader("Nº Banco", "numero_banco")}
              {renderSortableHeader("Categoria", "categoria")}
              {renderSortableHeader("Histórico", "historico", "left", "min-w-[250px]")}
              {renderSortableHeader("Forma Receb.", "forma_pagamento")}
              {renderSortableHeader("Meio Receb.", "meio_recebimento")}
              {renderSortableHeader("Taxas", "taxas", "right")}
              {renderSortableHeader("Competência", "competencia")}
              {renderSortableHeader("Valor Recebido", "valor_recebido", "right")}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {sortedData.map(item => {
              const isOverdue = item.data_vencimento && new Date(item.data_vencimento) < new Date() && item.saldo > 0.01;
              const badgeLabel = item.situacao || 'INDEFINIDO';
              const badgeStyle = getStatusBadgeStyle(item.situacao);

              return (
                <tr key={item.id} className="group hover:bg-slate-50 transition-colors">
                  <td 
                    className="px-6 py-3 border-b border-slate-100 sticky left-0 z-30 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]"
                    style={{ width: '150px', minWidth: '150px' }}
                  >
                    <span className="font-black text-slate-400 text-[10px] italic">#{item.id}</span>
                  </td>
                  <td className="px-6 py-3 border-b border-slate-100 text-[10px] font-bold text-purple-600">
                    {item.id_acordo ? `#${item.id_acordo}` : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="px-6 py-3 border-b border-slate-100 font-black text-slate-900 uppercase text-[11px] whitespace-nowrap">{item.cliente}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-center font-bold text-[11px] text-slate-500">{item.data_emissao ? item.data_emissao.split('-').reverse().join('/') : '-'}</td>
                  <td className={`px-4 py-3 border-b border-slate-100 text-center font-bold text-[11px] ${isOverdue && !badgeLabel.includes('PAGO') ? 'text-red-600' : 'text-slate-600'}`}>{item.data_vencimento ? item.data_vencimento.split('-').reverse().join('/') : '-'}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-center font-bold text-[11px] text-emerald-600">{item.data_liquidacao ? item.data_liquidacao.split('-').reverse().join('/') : '-'}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right font-bold text-slate-500 text-[11px]">{item.valor_documento?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right font-black text-slate-900 text-[11px]">{item.saldo?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-center">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${badgeStyle}`}>{badgeLabel}</span>
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100 font-bold text-[10px] text-slate-600 uppercase">{item.numero_documento}</td>
                  <td className="px-4 py-3 border-b border-slate-100 font-bold text-[10px] text-slate-500 uppercase">{item.numero_banco}</td>
                  <td className="px-4 py-3 border-b border-slate-100 font-bold text-[10px] text-slate-500 uppercase">{item.categoria}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-[10px] text-slate-400 max-w-xs truncate" title={item.historico}>{item.historico}</td>
                  <td className="px-4 py-3 border-b border-slate-100 font-bold text-[10px] text-slate-500 uppercase">{item.forma_pagamento}</td>
                  <td className="px-4 py-3 border-b border-slate-100 font-bold text-[10px] text-slate-500 uppercase">{item.meio_recebimento}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right font-bold text-red-500 text-[11px]">{item.taxas?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 border-b border-slate-100 font-bold text-[10px] text-slate-500">{item.competencia}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right font-bold text-emerald-600 text-[11px]">{item.valor_recebido?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedData.length === 0 && (
            <div className="py-20 text-center opacity-30 font-black uppercase text-[10px]">Nenhum título encontrado.</div>
        )}
      </div>

      {/* --- MODAL DE FILTROS AVANÇADOS --- */}
      {showFilterModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-200">
           <div className="bg-white max-w-lg w-full rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                 <div>
                    <h3 className="text-xl font-black text-slate-900 uppercase italic tracking-tighter">Filtros Avançados</h3>
                    <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-1">Refine sua visualização financeira</p>
                 </div>
                 <button onClick={() => setShowFilterModal(false)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-slate-900 transition-all">
                    <ICONS.Add className="w-5 h-5 rotate-45" />
                 </button>
              </div>
              
              <div className="p-8 space-y-6">
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Período de Vencimento</label>
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                          <p className="text-[8px] font-bold text-slate-400 mb-1">DE</p>
                          <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase" />
                       </div>
                       <div>
                          <p className="text-[8px] font-bold text-slate-400 mb-1">ATÉ</p>
                          <input type="date" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase" />
                       </div>
                    </div>
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Origem do Lançamento</label>
                    <select value={filters.origin} onChange={e => setFilters({...filters, origin: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase cursor-pointer">
                       <option value="TODOS">Todas as Origens</option>
                       {uniqueOrigins.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Forma de Pagamento</label>
                    <select value={filters.paymentMethod} onChange={e => setFilters({...filters, paymentMethod: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase cursor-pointer">
                       <option value="TODOS">Todas as Formas</option>
                       {uniqueMethods.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Situação do Título</label>
                    <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase cursor-pointer">
                       <option value="TODOS">Todas as Situações</option>
                       <option value="EM ABERTO">Em Aberto (A Vencer)</option>
                       <option value="VENCIDO">Vencidos</option>
                       <option value="PAGO">Pagos / Liquidados</option>
                       <option value="NEGOCIADO">Negociados (Acordo)</option>
                       <option value="CANCELADO">Cancelados</option>
                    </select>
                 </div>
              </div>

              <div className="p-8 border-t border-slate-100 bg-slate-50/30 flex gap-4">
                 <button onClick={clearFilters} className="flex-1 py-4 bg-white border border-slate-200 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:text-red-500 transition-all">Limpar Filtros</button>
                 <button onClick={() => setShowFilterModal(false)} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-blue-600 transition-all">Aplicar Filtros</button>
              </div>
           </div>
        </div>
      )}

      {/* --- MODAL DE IMPORTAÇÃO --- */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[250] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white max-w-[95vw] w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[85vh]">
              <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/30 shrink-0">
                 <div>
                    <h3 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter">
                       {importStaging ? 'Revisão de Carga OLIST' : 'Importação OLIST'}
                    </h3>
                    <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-1">Sincronização em Massa</p>
                 </div>
                 <button onClick={() => { setShowImportModal(false); setImportStaging(null); }} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all"><ICONS.Add className="w-6 h-6 rotate-45" /></button>
              </div>
              
              {!importStaging ? (
                <div className="p-12 text-center space-y-8 flex-1 flex flex-col justify-center">
                   <div className="w-24 h-24 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto shadow-inner"><ICONS.Upload className="w-12 h-12" /></div>
                   <div className="max-w-xl mx-auto">
                      <p className="text-slate-500 font-medium text-sm mb-8">Importe os títulos da Olist. Todos os registros serão marcados automaticamente com origem OLIST.</p>
                      <div className="flex gap-4 justify-center">
                         <button onClick={downloadTemplate} className="px-8 py-4 bg-white border-2 border-slate-200 text-slate-700 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center space-x-3">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            <span>Baixar Modelo</span>
                         </button>
                         <button onClick={() => fileInputRef.current?.click()} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-blue-600 transition-all flex items-center space-x-3">
                            <ICONS.Upload className="w-4 h-4" />
                            <span>Selecionar Planilha</span>
                         </button>
                      </div>
                      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls,.csv" className="hidden" />
                   </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 overflow-hidden">
                   <div className="flex-1 overflow-auto p-8 custom-scrollbar">
                      <table className="w-full text-left" style={{minWidth: '2400px'}}>
                         <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                            <tr>
                               <th className="px-6 py-4">Status</th>
                               <th className="px-6 py-4">Cliente / ID</th>
                               <th className="px-6 py-4">Emissão</th>
                               <th className="px-6 py-4">Venc.</th>
                               <th className="px-6 py-4">Liq.</th>
                               <th className="px-6 py-4 text-right">Valor Doc.</th>
                               <th className="px-6 py-4 text-right">Saldo</th>
                               <th className="px-6 py-4 text-center">Situação</th>
                               <th className="px-6 py-4">Nº Doc</th>
                               <th className="px-6 py-4">Nº Banco</th>
                               <th className="px-6 py-4">Cat.</th>
                               <th className="px-6 py-4">Histórico</th>
                               <th className="px-6 py-4">Forma</th>
                               <th className="px-6 py-4">Meio</th>
                               <th className="px-6 py-4 text-right">Taxas</th>
                               <th className="px-6 py-4">Comp.</th>
                               <th className="px-6 py-4 text-right">Recebido</th>
                               <th className="px-6 py-4">Alterações</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-50 text-[11px]">
                            {importStaging.map((item, idx) => (
                               <tr key={idx} className={`hover:bg-blue-50/30 transition-all ${item.status === 'NEW' ? 'bg-emerald-50/30' : item.status === 'CHANGED' ? 'bg-blue-50/30' : ''}`}>
                                  <td className="px-6 py-4"><span className={`px-2 py-1 rounded text-[8px] font-black uppercase border ${ item.status === 'NEW' ? 'bg-emerald-100 text-emerald-700' : item.status === 'CHANGED' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{item.status}</span></td>
                                  <td className="px-6 py-4"><p className="font-black text-slate-900">{item.data.cliente}</p><p className="text-[9px] text-slate-400">ID: {item.data.id}</p></td>
                                  <td className="px-6 py-4 font-bold">{item.data.data_emissao}</td>
                                  <td className="px-6 py-4 font-bold">{item.data.data_vencimento}</td>
                                  <td className="px-6 py-4 font-bold">{item.data.data_liquidacao}</td>
                                  <td className="px-6 py-4 text-right font-black">R$ {item.data.valor_documento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                  <td className="px-6 py-4 text-right font-bold">R$ {item.data.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                  <td className="px-6 py-4 text-center">
                                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${getStatusBadgeStyle(item.data.situacao)}`}>
                                        {item.data.situacao}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4">{item.data.numero_documento}</td>
                                  <td className="px-6 py-4">{item.data.numero_banco}</td>
                                  <td className="px-6 py-4">{item.data.categoria}</td>
                                  <td className="px-6 py-4 truncate max-w-xs">{item.data.historico}</td>
                                  <td className="px-6 py-4">{item.data.forma_pagamento}</td>
                                  <td className="px-6 py-4">{item.data.meio_recebimento}</td>
                                  <td className="px-6 py-4 text-right">{item.data.taxas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                  <td className="px-6 py-4">{item.data.competencia}</td>
                                  <td className="px-6 py-4 text-right">{item.data.valor_recebido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                  <td className="px-6 py-4">
                                      {item.diff && item.diff.length > 0 ? (<div className="flex flex-wrap gap-1">{item.diff.map(d => (<span key={d} className="bg-blue-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase">{d}</span>))}</div>) : <span className="text-slate-300 text-[8px] italic">-</span>}
                                  </td>
                               </tr>
                            ))}
                         </tbody>
                      </table>
                   </div>
                   <div className="p-8 border-t border-slate-50 flex justify-between items-center bg-slate-50/30">
                      <div className="space-y-1">
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resumo OLIST</p>
                         <p className="text-xl font-black text-slate-900 uppercase italic">
                            {importStaging.filter(i => i.status === 'NEW').length} Novos • {importStaging.filter(i => i.status === 'CHANGED').length} Atualizados
                         </p>
                      </div>
                      <div className="flex gap-4">
                         <button onClick={() => setImportStaging(null)} className="px-8 py-4 bg-white border border-slate-200 text-slate-500 font-black text-[9px] uppercase rounded-2xl hover:text-red-500 transition-all">Cancelar</button>
                         <button onClick={confirmImport} disabled={isProcessing} className="px-10 py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-emerald-500 transition-all">
                            {isProcessing ? 'Gravando...' : 'Confirmar Carga'}
                         </button>
                      </div>
                   </div>
                </div>
              )}
           </div>
        </div>
      )}
    </div>
  );
};

export default AccountsReceivableModule;
