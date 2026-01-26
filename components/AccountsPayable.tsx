import React, { useState, useMemo, useEffect, useRef } from 'react';
import { supabaseClient as supabase } from '../services/core'; 
import { ICONS } from '../constants';
import Toast from './Toast';
import * as XLSX from 'xlsx';

// Definindo o tipo exato que vem do banco
interface AccountsPayable {
  id: string;
  fornecedor: string;
  data_emissao?: string;
  data_vencimento: string;
  data_liquidacao?: string;
  valor_documento: number;
  saldo: number;
  situacao?: string;
  numero_documento?: string;
  categoria?: string;
  historico?: string;
  competencia?: string;
  forma_pagamento?: string;
  chave_pix_boleto?: string;
  valor_pago?: number;
}

const AccountsPayableModule: React.FC = () => {
  const [data, setData] = useState<AccountsPayable[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' | 'info' } | null>(null);
  
  // Estados de Filtro
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    status: 'TODOS',
    category: 'TODOS'
  });

  const fetchItems = async () => {
    setLoading(true);
    try {
      const { data: items, error } = await supabase
        .from('accounts_payable')
        .select('*')
        .order('data_vencimento', { ascending: true })
        .limit(100);

      if (error) throw error;
      setData(items || []);
    } catch (e: any) {
      console.error(e);
      setToast({ msg: "Erro ao carregar dados.", type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleSyncExpenses = async () => {
    setIsSyncing(true);
    setToast({ msg: 'Buscando despesas no Tiny...', type: 'info' });

    try {
      const { data, error } = await supabase.functions.invoke('expense-integration');
      if (error) throw error;

      const count = data?.upserted_count || 0;
      setToast({ msg: `Sucesso! ${count} despesas atualizadas.`, type: 'success' });
      await fetchItems();
      
    } catch (err: any) {
      console.error(err);
      setToast({ msg: `Erro na sincronização: ${err.message}`, type: 'error' });
    } finally {
      setIsSyncing(false);
    }
  };

  const uniqueCategories = useMemo(() => Array.from(new Set(data.map(i => i.categoria || 'N/A'))).sort(), [data]);
  const uniqueStatuses = useMemo(() => Array.from(new Set(data.map(i => i.situacao || 'N/A'))).sort(), [data]);
  const hasActiveFilters = filters.startDate !== '' || filters.endDate !== '' || filters.status !== 'TODOS' || filters.category !== 'TODOS';

  const clearFilters = () => {
    setFilters({ startDate: '', endDate: '', status: 'TODOS', category: 'TODOS' });
    setShowFilterModal(false);
  };

  const filteredData = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return data.filter(d => {
      const matchesSearch = 
        (d.fornecedor || '').toLowerCase().includes(term) || 
        (d.numero_documento && d.numero_documento.toLowerCase().includes(term)) ||
        (d.id && d.id.toLowerCase().includes(term)) ||
        (d.categoria && d.categoria.toLowerCase().includes(term));
      
      if (!matchesSearch) return false;

      if (filters.startDate && d.data_vencimento < filters.startDate) return false;
      if (filters.endDate && d.data_vencimento > filters.endDate) return false;
      if (filters.status !== 'TODOS' && (d.situacao || 'N/A') !== filters.status) return false;
      if (filters.category !== 'TODOS' && (d.categoria || 'N/A') !== filters.category) return false;

      return true;
    });
  }, [data, searchTerm, filters]);

  if (loading) return <div className="p-20 text-center opacity-30 font-black uppercase text-xs italic animate-pulse">Carregando Despesas...</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10 h-full flex flex-col">
      {toast && <Toast message={toast.msg} type={toast.type as any} onClose={() => setToast(null)} />}
      
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Contas a Pagar</h2>
          <p className="text-[9px] font-black text-blue-600 uppercase tracking-[0.4em] mt-2 italic">
            Interface de Sincronização Olist ERP
          </p>
        </div>
        
        <div className="flex items-center gap-3">
           <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex-1 md:w-auto">
              <button
                onClick={handleSyncExpenses}
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

              <input 
                type="text" 
                placeholder="Pesquisar títulos..." 
                className="w-full md:w-64 px-4 py-2 bg-transparent outline-none font-bold text-xs"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className="h-6 w-px bg-slate-100"></div>
              <button 
                onClick={() => setShowFilterModal(true)}
                className={`p-2 rounded-xl transition-all ${hasActiveFilters ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
                title="Filtros Avançados"
              >
                <ICONS.Filter className="w-4 h-4" />
              </button>
           </div>
        </div>
      </div>

      <div className="table-container flex-1 overflow-auto border border-slate-200 rounded-[2rem] bg-white shadow-sm" style={{ maxHeight: 'calc(100vh - 280px)' }}>
        <table className="w-full border-separate border-spacing-0" style={{ minWidth: '1800px' }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left sticky left-0 z-30">ID</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Fornecedor</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center">Data Emissão</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center">Data Vencimento</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center">Data Liquidação</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-right">Valor documento</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-right">Pago</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-right">Saldo</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center">Situação</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Número documento</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Categoria</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Histórico</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Competência</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Forma Pagamento</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map(item => (
              <tr key={item.id} className="group hover:bg-slate-50/80 transition-colors">
                <td className="px-6 py-4 border-b border-slate-100 font-black text-blue-600 text-[10px] italic sticky left-0 z-10 bg-white group-hover:bg-slate-50">#{item.id}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-black text-slate-900 uppercase italic text-[11px] whitespace-nowrap">{item.fornecedor}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-500 text-center">{item.data_emissao ? item.data_emissao.split('-').reverse().join('/') : '---'}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-900 text-center">{item.data_vencimento ? item.data_vencimento.split('-').reverse().join('/') : '---'}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-400 text-center">{item.data_liquidacao ? item.data_liquidacao.split('-').reverse().join('/') : '---'}</td>
                <td className="px-6 py-4 border-b border-slate-100 text-right font-bold text-slate-400 text-[11px]">R$ {(item.valor_documento || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="px-6 py-4 border-b border-slate-100 text-right font-black text-emerald-600 text-[11px]">R$ {(item.valor_pago || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="px-6 py-4 border-b border-slate-100 text-right font-black text-slate-900 text-[11px]">R$ {(item.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="px-6 py-4 border-b border-slate-100 text-center">
                   <div className={`inline-flex px-3 py-1 rounded-lg font-black text-[9px] uppercase border shadow-sm ${ (item.situacao || '').toLowerCase().includes('paga') ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : item.data_vencimento && new Date(item.data_vencimento) < new Date() ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100' }`}>{item.situacao || 'PENDENTE'}</div>
                </td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-600">{item.numero_documento || '---'}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-black text-blue-500 text-[9px] uppercase">{item.categoria}</td>
                <td className="px-6 py-4 border-b border-slate-100 text-[10px] text-slate-400 max-w-xs truncate" title={item.historico}>{item.historico}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-500">{item.competencia}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[10px] text-slate-500 uppercase">{item.forma_pagamento}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredData.length === 0 && (<div className="py-20 text-center opacity-30 font-black uppercase text-[10px] tracking-widest">Nenhum registro encontrado.</div>)}
      </div>

      {showFilterModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-200">
           <div className="bg-white max-w-lg w-full rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                 <div><h3 className="text-xl font-black text-slate-900 uppercase italic tracking-tighter">Filtros Avançados</h3><p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-1">Refine sua busca de títulos</p></div>
                 <button onClick={() => setShowFilterModal(false)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-slate-900 transition-all"><ICONS.Add className="w-5 h-5 rotate-45" /></button>
              </div>
              <div className="p-8 space-y-6">
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Período de Vencimento</label>
                    <div className="grid grid-cols-2 gap-4">
                       <div><p className="text-[8px] font-bold text-slate-400 mb-1">DE</p><input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase" /></div>
                       <div><p className="text-[8px] font-bold text-slate-400 mb-1">ATÉ</p><input type="date" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase" /></div>
                    </div>
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Situação</label>
                    <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase cursor-pointer">
                       <option value="TODOS">Todas as Situações</option>
                       {uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                 </div>
              </div>
              <div className="p-8 border-t border-slate-100 bg-slate-50/30 flex gap-4">
                 <button onClick={clearFilters} className="flex-1 py-4 bg-white border border-slate-200 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:text-red-500 transition-all">Limpar</button>
                 <button onClick={() => setShowFilterModal(false)} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-blue-600 transition-all">Aplicar</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default AccountsPayableModule;
