
import React, { useEffect, useState } from 'react';
import { supabaseClient } from '../services/core';
import { ICONS } from '../constants';

interface AccountsReceivableRow {
  "ID": string;
  "IDCliente": string;
  "Data Emissão": string;
  "Data Vencimento": string;
  "Data Liquidação": string;
  "Valor documento": number;
  "Saldo": number;
  "Situação": string;
  "Número documento": string;
  "Número no banco": string;
  "Categoria": string;
  "Histórico": string;
  "Forma de recebimento": string;
  "Meio de recebimento": string;
  "Taxas": number;
  "Competência": string;
  "Recebimento": string;
  "Recebido": number;
  "Cartório": boolean;
}

const DelinquencyModule: React.FC<{ currentUser: any }> = ({ currentUser }) => {
  const [data, setData] = useState<AccountsReceivableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<'TITLES' | 'DEBTORS'>('TITLES');
  const [sortConfig, setSortConfig] = useState<{ key: keyof AccountsReceivableRow | null; direction: 'asc' | 'desc' }>({ key: 'Data Vencimento', direction: 'asc' });
  const [selectedDebtor, setSelectedDebtor] = useState<{ name: string, total: number, count: number } | null>(null);

  // Agrupamento por devedor
  const debtorsSummary = React.useMemo(() => {
    const map = new Map<string, { name: string, total: number, count: number }>();

    data.forEach(row => {
      const clientName = row.IDCliente || 'DESCONHECIDO';
      if (!map.has(clientName)) {
        map.set(clientName, { name: clientName, total: 0, count: 0 });
      }
      const entry = map.get(clientName)!;
      entry.total += (row["Saldo"] || 0);
      entry.count += 1;
    });

    return Array.from(map.values())
      .map(d => ({ ...d })) // ensure plain object
      .sort((a, b) => b.total - a.total) // Ordenar por Maior Dívida
      .filter(d =>
        searchTerm ? d.name.toLowerCase().includes(searchTerm.toLowerCase()) : true
      );
  }, [data, searchTerm]);

  const COLUMN_CONFIG: { label: string; key: keyof AccountsReceivableRow }[] = [
    { label: "ID", key: "ID" },
    { label: "Cliente", key: "IDCliente" },
    { label: "Vencimento", key: "Data Vencimento" },
    { label: "Valor Doc", key: "Valor documento" },
    { label: "Saldo", key: "Saldo" },
    { label: "Situação", key: "Situação" },
    { label: "Doc", key: "Número documento" },
    { label: "Cartório", key: "Cartório" },
    { label: "Categoria", key: "Categoria" },
    { label: "Histórico", key: "Histórico" },
  ];

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const today = new Date().toISOString().split('T')[0];

      // TENTATIVA PRINCIPAL: Query "Legado" (Nomes com espaços/Acentos)
      // Usada como padrão pois era o que funcionava antes.
      const { data: rowsLegacy, error: errorLegacy } = await supabaseClient
        .from('accounts_receivable')
        .select('*, cartorio')
        .lt('Data Vencimento', today)
        .ilike('Situação', '%EM ABERTO%')
        .gt('Saldo', 0.01)
        .order('Data Vencimento', { ascending: true });

      if (!errorLegacy && rowsLegacy) {
        // Mapeamento Legado
        const mappedLegacy = (rowsLegacy as any[]).map(r => ({
          ...r,
          "Cartório": (r.cartorio === true || r.cartorio === 'true' || r.Cartorio === true)
        }));
        setData(mappedLegacy as AccountsReceivableRow[]);
        return;
      }

      // FALLBACK: Query "Moderno" (snake_case)
      console.warn("Tentando fallback para colunas snake_case...", errorLegacy);

      const { data: rows, error } = await supabaseClient
        .from('accounts_receivable')
        .select('*, cartorio')
        .lt('data_vencimento', today)
        .gt('saldo', 0.01)
        .order('data_vencimento', { ascending: true });

      if (error) {
        // Se ambos falharem, mostramos o erro do Legado ou do Moderno dependendo do contexto
        throw errorLegacy || error;
      };

      // Mapeamento Snake -> Interface com espaços
      const mappedRows = (rows || [])
        .filter((r: any) => String(r.situacao || r['Situação'] || '').toUpperCase().includes('BERTO'))
        .map((r: any) => ({
          "ID": r.id,
          "IDCliente": r.cliente || r.IDCliente || r.fornecedor || 'Desconhecido',
          "Data Vencimento": r.data_vencimento || r['Data Vencimento'],
          "Data Emissão": r.data_emissao || r['Data Emissão'],
          "Data Liquidação": r.data_liquidacao || r['Data Liquidação'],
          "Valor documento": Number(r.valor_documento || r['Valor documento'] || 0),
          "Saldo": Number(r.saldo || r.Saldo || 0),
          "Situação": r.situacao || r['Situação'],
          "Número documento": r.numero_documento || r['Número documento'],
          "Número no banco": r.numero_banco || r['Número no banco'],
          "Categoria": r.categoria || r.Categoria,
          "Histórico": r.historico || r.Histórico,
          "Forma de recebimento": r.forma_pagamento || r['Forma de recebimento'],
          "Meio de recebimento": r.meio_recebimento || r['Meio de recebimento'],
          "Taxas": r.taxas || 0,
          "Competência": r.competencia || r['Competência'],
          "Recebimento": r.recebimento || '',
          "Recebido": r.valor_recebido || r['Recebido'] || 0,
          "Cartório": r.cartorio || false
        }));

      setData(mappedRows as AccountsReceivableRow[]);

    } catch (e: any) {
      console.error('Erro na busca de inadimplência:', e);
      setErrorMsg(e.message || "Erro ao carregar dados. Verifique a conexão.");
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    fetchData();
  }, []);

  const filteredAndSortedData = React.useMemo(() => {
    let processed = [...data];
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      processed = processed.filter(row =>
        Object.values(row).some(val => String(val).toLowerCase().includes(lowerTerm))
      );
    }
    if (sortConfig.key) {
      processed.sort((a, b) => {
        const valA = a[sortConfig.key!] || '';
        const valB = b[sortConfig.key!] || '';
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return processed;
  }, [data, searchTerm, sortConfig]);

  const summaries = React.useMemo(() => {
    return filteredAndSortedData.reduce((acc, curr) => {
      return {
        totalVencido: acc.totalVencido + (curr["Saldo"] || 0),
        count: acc.count + 1,
        totalCartorio: acc.totalCartorio + (curr["Cartório"] ? (curr["Saldo"] || 0) : 0),
        countCartorio: acc.countCartorio + (curr["Cartório"] ? 1 : 0)
      };
    }, { totalVencido: 0, count: 0, totalCartorio: 0, countCartorio: 0 });
  }, [filteredAndSortedData]);

  const handleSort = (key: keyof AccountsReceivableRow) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    // Fix: Use string splitting to avoid Timezone shifts
    if (dateStr.includes('T')) dateStr = dateStr.split('T')[0];
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dateStr;
  };

  const handleManageDebtor = (debtor: { name: string, total: number, count: number }) => {
    setSelectedDebtor(debtor);
  };

  if (selectedDebtor) {
    return (
      <CollectionManagement
        debtorName={selectedDebtor.name}
        onBack={() => setSelectedDebtor(null)}
        currentUser={currentUser}
      />
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col xl:flex-row justify-between items-end bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm gap-6">
        <div>
          <h2 className="text-3xl font-black text-red-600 uppercase italic tracking-tighter">Inadimplência</h2>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Gestão de Títulos Vencidos</p>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setActiveTab('TITLES')}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'TITLES' ? 'bg-red-600 text-white shadow-lg shadow-red-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
            >
              Títulos Vencidos
            </button>
            <button
              onClick={() => setActiveTab('DEBTORS')}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'DEBTORS' ? 'bg-red-600 text-white shadow-lg shadow-red-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
            >
              Devedores ({debtorsSummary.length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 w-full xl:w-auto">
          <div className="relative group w-full lg:w-96">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <ICONS.Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquisar devedores..."
              className="block w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-red-500/20 outline-none transition-all"
            />
          </div>
          <button onClick={fetchData} className="p-3 hover:bg-slate-100 rounded-xl transition-all" title="Atualizar">
            <ICONS.History className="w-5 h-5 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Error Message */}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl flex items-center gap-3">
          <ICONS.Alert className="w-5 h-5" />
          <p className="font-bold text-sm">{errorMsg}</p>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="bg-red-50 p-6 rounded-3xl border border-red-100">
          <p className="text-[10px] uppercase font-black text-red-400 tracking-widest">Total Vencido</p>
          <p className="text-3xl font-black text-red-600 mt-2 tracking-tighter">{formatCurrency(summaries.totalVencido)}</p>
        </div>
        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Qtd. Títulos Vencidos</p>
          <p className="text-3xl font-black text-slate-600 mt-2 tracking-tighter">{summaries.count}</p>
        </div>
        <div className="bg-red-900 p-6 rounded-3xl border border-red-800 shadow-xl shadow-red-900/10">
          <p className="text-[10px] uppercase font-black text-red-300 tracking-widest">Total em Cartório</p>
          <p className="text-3xl font-black text-white mt-2 tracking-tighter">{formatCurrency(summaries.totalCartorio)}</p>
        </div>
        <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl shadow-slate-900/10">
          <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Qtd. em Cartório</p>
          <p className="text-3xl font-black text-white mt-2 tracking-tighter">{summaries.countCartorio}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto min-h-[400px]">
          {activeTab === 'TITLES' ? (
            // ... existing titles table ...
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                <tr>
                  {COLUMN_CONFIG.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest cursor-pointer hover:bg-slate-100 transition-colors select-none"
                    >
                      <div className="flex items-center gap-2">
                        {col.label}
                        {sortConfig.key === col.key && (
                          <span className="text-red-500">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredAndSortedData.length === 0 ? (
                  <tr><td colSpan={COLUMN_CONFIG.length + 1} className="p-10 text-center text-xs font-bold text-slate-400 uppercase">Nenhum título encontrado.</td></tr>
                ) : (
                  filteredAndSortedData.map((row, i) => (
                    <tr key={row.ID || i} className="hover:bg-red-50/10 transition-colors group">
                      {COLUMN_CONFIG.map(col => (
                        <td key={col.key} className="p-4">
                          {col.key === 'Saldo' || col.key === 'Valor documento' ? (
                            <span className={`text-xs font-black tracking-tighter ${col.key === 'Saldo' ? 'text-red-600' : 'text-slate-600'}`}>
                              {formatCurrency(row[col.key] as number)}
                            </span>
                          ) : col.key === 'Data Vencimento' ? (
                            <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded-lg border border-red-100">
                              {formatDate(row[col.key] as string)}
                            </span>
                          ) : col.key === 'Cartório' ? (
                            row["Cartório"] ? (
                              <span className="text-[9px] bg-red-600 text-white px-2 py-1 rounded font-bold uppercase tracking-widest">Sim</span>
                            ) : (
                              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Não</span>
                            )
                          ) : (
                            <span className="text-[10px] font-bold text-slate-500 uppercase">
                              {row[col.key]}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleManageDebtor({ name: row.IDCliente, total: 0, count: 0 })}
                          className="text-slate-300 hover:text-blue-600 transition-colors"
                          title="Gerenciar este cliente"
                        >
                          <ICONS.Edit className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Ranking</th>
                  <th className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Cliente / Devedor</th>
                  <th className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Qtd. Títulos</th>
                  <th className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Valor Total em Aberto</th>
                  <th className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {debtorsSummary.length === 0 ? (
                  <tr><td colSpan={5} className="p-10 text-center text-xs font-bold text-slate-400 uppercase">Nenhum devedor encontrado.</td></tr>
                ) : (
                  debtorsSummary.map((debtor, index) => (
                    <tr key={debtor.name} className="hover:bg-red-50/10 transition-colors">
                      <td className="p-4 text-[10px] font-black text-slate-300">#{index + 1}</td>
                      <td className="p-4">
                        <span className="text-xs font-black text-slate-800 uppercase">{debtor.name}</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-lg text-[10px] font-bold">{debtor.count}</span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-sm font-black text-red-600 tracking-tighter">{formatCurrency(debtor.total)}</span>
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleManageDebtor(debtor)}
                          className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-blue-600 transition-colors shadow-lg shadow-slate-200"
                        >
                          Gerenciar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div >
  );
};

interface CollectionManagementProps {
  debtorName: string;
  onBack: () => void;
  currentUser: any;
}

const CollectionManagement: React.FC<CollectionManagementProps> = ({ debtorName, onBack, currentUser }) => {
  const [titles, setTitles] = useState<AccountsReceivableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<{ id: string, action: string, note: string, date: string, user: string }[]>([]);
  const [newNote, setNewNote] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [actionType, setActionType] = useState('RETORNO_SEM_AGENDAMENTO');

  useEffect(() => {
    loadDebtorData();
  }, [debtorName]);

  const loadDebtorData = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data: rows } = await supabaseClient
        .from('accounts_receivable')
        .select('*, cartorio')
        .eq('IDCliente', debtorName)
        .lt('Data Vencimento', today)
        .ilike('Situação', '%EM ABERTO%')
        .gt('Saldo', 0.01)
        .order('Data Vencimento', { ascending: true });

      if (rows) {
        // Map cartorio correctly for internal use
        const mapped = rows.map((r: any) => ({
          ...r,
          "ID": r.id || r.ID,
          "Data Vencimento": r.data_vencimento || r['Data Vencimento'],
          "Saldo": Number(r.saldo || r.Saldo || 0),
          "Número documento": r.numero_documento || r['Número documento'],
          "Cartório": (r.cartorio === true || r.cartorio === 'true' || r.Cartorio === true)
        }));
        setTitles(mapped as AccountsReceivableRow[]);
      }

      const { data: hist } = await supabaseClient
        .from('collection_history')
        .select('*')
        .eq('cliente', debtorName)
        .order('created_at', { ascending: false });

      if (hist) {
        // Enforce client-side sorting: Newest (Desc) to Oldest
        hist.sort((a: any, b: any) => {
          const dateA = new Date(a.created_at || 0).getTime();
          const dateB = new Date(b.created_at || 0).getTime();
          return dateB - dateA;
        });

        setHistory(hist.map((h: any) => ({
          id: h.id,
          action: h.acao,
          note: h.observacao,
          date: h.created_at,
          user: h.usuario
        })));
      }

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const toggleCartorio = async (id: string, currentStatus: boolean) => {
    if (!id) {
      alert("Erro: ID do título não encontrado. Recarregue a página.");
      return;
    }

    // Optimistic Update
    setTitles(prev => prev.map(t => t.ID === id ? { ...t, "Cartório": !currentStatus } : t));

    try {
      // Tenta atualizar usando ID (maiúsculo), que parece ser a PK correta
      const { error } = await supabaseClient
        .from('accounts_receivable')
        .update({ cartorio: !currentStatus })
        .eq('ID', id); // Mudança crítica: 'id' -> 'ID'

      if (error) {
        console.warn("Falha ao atualizar com ID maiúsculo, tentando minúsculo...", error);
        // Fallback desesperado
        const { error: err2 } = await supabaseClient
          .from('accounts_receivable')
          .update({ cartorio: !currentStatus })
          .eq('id', id);

        if (err2) throw err2;
      }
    } catch (e: any) {
      console.error("Erro ao atualizar cartorio", e);
      alert(`Erro ao atualizar status: ${e.message || e.error_description || JSON.stringify(e)}`);
      // Rollback
      setTitles(prev => prev.map(t => t.ID === id ? { ...t, "Cartório": currentStatus } : t));
    }
  };

  const handleSaveInteraction = async () => {
    // Validação
    if (actionType === 'AGENDOU_PAGTO' && !scheduledDate) {
      alert('Por favor, informe a data do agendamento.');
      return;
    }

    try {
      let finalNote = newNote;
      if (actionType === 'AGENDOU_PAGTO') {
        const [y, m, d] = scheduledDate.split('-');
        finalNote = `Agendado para: ${d}/${m}/${y} ${newNote ? '- ' + newNote : ''}`;
      } else if (actionType === 'INCLUIR_CARTORIO') {
        finalNote = `Títulos enviados para protesto. ${newNote}`;
      } else if (actionType === 'RETIRAR_CARTORIO') {
        finalNote = `Títulos retirados de protesto. ${newNote}`;
      } else if (!newNote) {
        finalNote = actionType === 'NAO_RETORNOU' ? 'Tentativa de contato sem sucesso.' : 'Contato realizado, sem previsão de pagamento.';
      }

      const payload = {
        cliente: debtorName,
        acao: actionType,
        observacao: finalNote,
        usuario: currentUser?.name || 'Sistema'
      };

      const { error } = await supabaseClient.from('collection_history').insert(payload);

      if (error) {
        console.error("Erro ao inserir historico:", error);
        throw new Error(error.message + " (" + error.code + ")");
      }

      setNewNote('');
      setScheduledDate('');

      // Se a ação foi de cartório, reseta o select para evitar acidentes
      if (actionType.includes('CARTORIO')) {
        setActionType('RETORNO_SEM_AGENDAMENTO');
      }

      loadDebtorData();
    } catch (e: any) {
      console.error(e);
      alert(`Erro ao salvar histórico: ${e.message}`);
    }
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const hasInCartorio = titles.some(t => t["Cartório"]);

  return (
    <div className="flex flex-col h-full animate-in slide-in-from-right duration-500">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="p-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-400 hover:text-slate-900 transition-all">
          <ICONS.ChevronUp className="w-5 h-5 -rotate-90" />
        </button>
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter">Gerenciamento de Cobrança</h2>
          <p className="text-xs text-blue-600 font-black uppercase tracking-widest">{debtorName}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 h-full overflow-hidden">
        {/* Left: Titles List */}
        <div className="flex-1 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wide">Títulos em Aberto</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-0">
            {loading ? <div className="p-10 text-center opacity-50">Carregando...</div> : (
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest sticky top-0">
                  <tr>
                    <th className="p-4 text-center">Cartório</th>
                    <th className="p-4">Vencimento</th>
                    <th className="p-4">Número Doc</th>
                    <th className="p-4 text-right">Valor Aberto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {titles.map(t => {
                    const isCartorioMode = actionType === 'INCLUIR_CARTORIO' || actionType === 'RETIRAR_CARTORIO';
                    const canToggle =
                      (actionType === 'INCLUIR_CARTORIO' && !t["Cartório"]) ||
                      (actionType === 'RETIRAR_CARTORIO' && t["Cartório"]);

                    return (
                      <tr key={t.ID} className={`hover:bg-red-50/30 transition-colors ${t["Cartório"] ? 'bg-red-50' : ''}`}>
                        <td className="p-4 text-center">
                          <input
                            type="checkbox"
                            checked={t["Cartório"] || false}
                            disabled={!canToggle}
                            onChange={() => toggleCartorio(t.ID, t["Cartório"])}
                            className={`w-4 h-4 rounded border-slate-300 focus:ring-red-500 cursor-pointer ${!canToggle ? 'opacity-30 cursor-not-allowed' : 'text-red-600'}`}
                          />
                        </td>
                        <td className="p-4 text-xs font-bold text-red-600">{new Date(t["Data Vencimento"]).toLocaleDateString('pt-BR')}</td>
                        <td className="p-4 text-xs font-bold text-slate-600">{t["Número documento"]}</td>
                        <td className="p-4 text-xs font-black text-slate-900 text-right">{formatCurrency(t.Saldo)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="p-6 bg-red-50 border-t border-red-100">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black text-red-400 uppercase tracking-widest">Total Devido</span>
              <span className="text-2xl font-black text-red-600 tracking-tighter">{formatCurrency(titles.reduce((acc, t) => acc + t.Saldo, 0))}</span>
            </div>
          </div>
        </div>

        {/* Right: CRM Feed */}
        <div className="w-full lg:w-96 bg-slate-900 rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden text-white h-[650px] shrink-0">
          <div className="p-6 border-b border-slate-800">
            <h3 className="text-sm font-black text-white uppercase tracking-wide italic">Timeline de Cobrança</h3>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar-dark">
            {history.length === 0 && <p className="text-center text-slate-600 text-xs uppercase font-bold py-10">Nenhum registro de contato.</p>}
            {history.map(h => (
              <div key={h.id} className="relative pl-4 border-l border-slate-700">
                <div className="absolute -left-1.5 top-0 w-3 h-3 bg-blue-500 rounded-full border-2 border-slate-900"></div>
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">{new Date(h.date).toLocaleString()}</p>
                <p className="text-xs font-bold text-slate-300 italic">"{h.note}"</p>
                <div className="flex justify-between items-center mt-2">
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${h.action === 'AGENDOU_PAGTO' ? 'bg-emerald-500/20 text-emerald-400' :
                    h.action === 'NAO_RETORNOU' ? 'bg-red-500/20 text-red-400' :
                      h.action?.includes('CARTORIO') ? 'bg-slate-700 text-slate-300' :
                        'bg-blue-500/20 text-blue-400'
                    }`}>{(h.action || '').replace('_', ' ')}</span>
                  <span className="text-[9px] font-bold text-slate-600 uppercase">@{h.user}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 bg-slate-800/50 border-t border-slate-700 space-y-4">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Registrar Nova Interação</label>
              <select
                value={actionType}
                onChange={e => setActionType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none focus:border-blue-500 uppercase"
              >
                <option value="RETORNO_SEM_AGENDAMENTO">Retorno s/ Agendamento</option>
                <option value="AGENDOU_PAGTO">Agendou Pagamento</option>
                <option value="NAO_RETORNOU">Não Retornou Contato</option>
                <option disabled className="bg-slate-800 text-slate-500">─── Ações de Protesto ───</option>
                <option value="INCLUIR_CARTORIO">Incluir em Cartório</option>
                {hasInCartorio && <option value="RETIRAR_CARTORIO">Retirar do Cartório</option>}
              </select>
            </div>

            {/* Conditional Date Input */}
            {actionType === 'AGENDOU_PAGTO' && (
              <div className="space-y-1">
                <label className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Data do Agendamento</label>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={e => setScheduledDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none focus:border-emerald-500 uppercase"
                />
              </div>
            )}

            {actionType === 'AGENDOU_PAGTO' && (
              <input
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Observação opcional..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xs font-medium text-white placeholder:text-slate-600 outline-none focus:border-blue-500"
                onKeyDown={e => e.key === 'Enter' && handleSaveInteraction()}
              />
            )}

            <button
              onClick={handleSaveInteraction}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg"
            >
              Registrar no Histórico
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DelinquencyModule;