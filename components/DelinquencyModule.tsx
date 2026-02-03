
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
}

const DelinquencyModule: React.FC<{ currentUser: any }> = ({ currentUser }) => {
  const [data, setData] = useState<AccountsReceivableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: keyof AccountsReceivableRow | null; direction: 'asc' | 'desc' }>({ key: 'Data Vencimento', direction: 'asc' });

  const COLUMN_CONFIG: { label: string; key: keyof AccountsReceivableRow }[] = [
    { label: "ID", key: "ID" },
    { label: "Cliente", key: "IDCliente" },
    { label: "Vencimento", key: "Data Vencimento" },
    { label: "Valor Doc", key: "Valor documento" },
    { label: "Saldo", key: "Saldo" },
    { label: "Situação", key: "Situação" },
    { label: "Doc", key: "Número documento" },
    { label: "Categoria", key: "Categoria" },
    { label: "Histórico", key: "Histórico" },
  ];

  const fetchData = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      // Query for overdue items: Due Date < Today AND Status NOT PAID
      const { data: rows, error } = await supabaseClient
        .from('accounts_receivable')
        .select('*')
        .lt('Data Vencimento', today)
        .ilike('Situação', '%EM ABERTO%')
        .gt('Saldo', 0.01) // Ensure there is balance due
        .limit(5000)
        .order('Data Vencimento', { ascending: true });

      if (error) throw error;
      setData(rows as AccountsReceivableRow[] || []);
    } catch (e) {
      console.error('Erro na busca de inadimplência:', e);
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
        count: acc.count + 1
      };
    }, { totalVencido: 0, count: 0 });
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col xl:flex-row justify-between items-end bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm gap-6">
        <div>
          <h2 className="text-3xl font-black text-red-600 uppercase italic tracking-tighter">Inadimplência</h2>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Gestão de Títulos Vencidos</p>
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-red-50 p-6 rounded-3xl border border-red-100">
          <p className="text-[10px] uppercase font-black text-red-400 tracking-widest">Total Vencido</p>
          <p className="text-3xl font-black text-red-600 mt-2 tracking-tighter">{formatCurrency(summaries.totalVencido)}</p>
        </div>
        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Qtd. Títulos Vencidos</p>
          <p className="text-3xl font-black text-slate-600 mt-2 tracking-tighter">{summaries.count}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
              <tr>
                {COLUMN_CONFIG.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:bg-slate-100 hover:text-red-500 transition-colors select-none group"
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      <div className="flex flex-col opacity-30 group-hover:opacity-100 transition-opacity">
                        {sortConfig.key === col.key && sortConfig.direction === 'asc' ? (
                          <span className="text-red-600">▲</span>
                        ) : sortConfig.key === col.key && sortConfig.direction === 'desc' ? (
                          <span className="text-red-600">▼</span>
                        ) : (
                          <><span className="text-[6px] leading-[6px]">▲</span><span className="text-[6px] leading-[6px]">▼</span></>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={COLUMN_CONFIG.length} className="p-10 text-center text-xs font-bold text-slate-400 uppercase animate-pulse">Buscando inadimplência...</td></tr>
              ) : filteredAndSortedData.length === 0 ? (
                <tr><td colSpan={COLUMN_CONFIG.length} className="p-10 text-center text-xs font-bold text-slate-400 uppercase">Nenhum título vencido encontrado. Parabéns!</td></tr>
              ) : (
                filteredAndSortedData.map((row) => (
                  <tr key={row.ID} className="hover:bg-red-50/10 transition-colors group">
                    <td className="p-3 text-[10px] font-bold text-slate-500">{row.ID}</td>
                    <td className="p-3 text-[10px] font-bold text-slate-800 truncate max-w-[200px]">{row.IDCliente}</td>
                    <td className="p-3 text-[10px] font-black text-red-600">{formatDate(row["Data Vencimento"])}</td>
                    <td className="p-3 text-[10px] font-bold text-slate-600">{formatCurrency(row["Valor documento"])}</td>
                    <td className="p-3 text-[10px] font-black text-red-600">{formatCurrency(row["Saldo"])}</td>
                    <td className="p-3">
                      <span className="px-2 py-1 rounded-lg text-[8px] font-black uppercase bg-red-100 text-red-600">
                        {row["Situação"]}
                      </span>
                    </td>
                    <td className="p-3 text-[9px] text-slate-400">{row["Número documento"]}</td>
                    <td className="p-3 text-[9px] text-slate-500 truncate max-w-[100px]">{row.Categoria}</td>
                    <td className="p-3 text-[9px] text-slate-400 truncate max-w-[150px]">{row.Histórico}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DelinquencyModule;