import React, { useState, useMemo, useEffect } from 'react';
import { supabaseClient as supabase } from '../services/core'; 
import { ICONS } from '../constants';
import Toast from './Toast';
// CORREÇÃO: Mantive apenas o que estamos usando para evitar erros de Linter
import { format, addMonths, subMonths, getDaysInMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
  
  // --- NOVOS ESTADOS DE NAVEGAÇÃO DE DATA (Estilo BI) ---
  const [currentDate, setCurrentDate] = useState(new Date('2026-01-01')); 
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  // ------------------------------------------------------

  // Estados de Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Estados de Filtro
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filters, setFilters] = useState({
    status: 'TODOS',
    category: 'TODOS'
  });

  const fetchItems = async () => {
    setLoading(true);
    try {
      const { data: items, error } = await supabase
        .from('accounts_payable')
        .select('*')
        .order('data_vencimento', { ascending: true });

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

  // --- FUNÇÕES DE NAVEGAÇÃO DE DATA ---
  const handlePrevMonth = () => {
    setCurrentDate(prev => subMonths(prev, 1));
    setSelectedDay(null); // Reseta dia ao mudar mês
    setCurrentPage(1);
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => addMonths(prev, 1));
    setSelectedDay(null);
    setCurrentPage(1); 
  };

  const handleDaySelect = (day: number) => {
    if (selectedDay === day) {
      setSelectedDay(null); // Desmarca se clicar no mesmo
    } else {
      setSelectedDay(day);
    }
    setCurrentPage(1); 
  };
  // -------------------------------------

  const handleSyncExpenses = async () => {
    setIsSyncing(true);
    setToast({ msg: 'Sincronizando 2026...', type: 'info' });

    try {
      const { data, error } = await supabase.functions.invoke('expense-integration', {
        method: 'POST',
      });

      if (error) throw error;

      console.log('Sync Sucesso:', data);
      const count = data?.count || 0;
      setToast({ msg: `Sucesso! ${count} contas atualizadas.`, type: 'success' });
      
      setTimeout(() => fetchItems(), 1000);
      
    } catch (err: any) {
      console.error("Erro Sync:", err);
      setToast({ msg: `Processo enviado. Atualize a tabela em instantes.`, type: 'info' });
      setTimeout(() => fetchItems(), 3000);
    } finally {
      setIsSyncing(false);
    }
  };

  const uniqueCategories = useMemo(() => Array.from(new Set(data.map(i => i.categoria || 'N/A'))).sort(), [data]);
  const uniqueStatuses = useMemo(() => Array.from(new Set(data.map(i => i.situacao || 'N/A'))).sort(), [data]);
  
  const hasActiveFilters = filters.status !== 'TODOS' || filters.category !== 'TODOS';

  const clearFilters = () => {
    setFilters({ status: 'TODOS', category: 'TODOS' });
    setShowFilterModal(false);
    setCurrentPage(1); 
  };

  // Filtragem dos dados
  const filteredData = useMemo(() => {
    const term = searchTerm.toLowerCase();
    
    // Preparar dados para comparação de data
    const targetMonth = currentDate.getMonth();
    const targetYear = currentDate.getFullYear();

    return data.filter(d => {
      // 1. Filtro de Mês/Ano
      if (!d.data_vencimento) return false;
      const vencDate = new Date(d.data_vencimento + 'T12:00:00');
      
      if (vencDate.getMonth() !== targetMonth) return false;
      if (vencDate.getFullYear() !== targetYear) return false;

      // 2. Filtro de Dia Específico
      if (selectedDay !== null) {
        if (vencDate.getDate() !== selectedDay) return false;
      }

      // 3. Busca Textual
      const matchesSearch = 
        (d.fornecedor || '').toLowerCase().includes(term) || 
        (d.numero_documento && d.numero_documento.toLowerCase().includes(term)) ||
        (d.id && d.id.toLowerCase().includes(term)) ||
        (d.categoria && d.categoria.toLowerCase().includes(term));
      
      if (!matchesSearch) return false;

      // 4. Filtros Modais
      if (filters.status !== 'TODOS' && (d.situacao || 'N/A') !== filters.status) return false;
      if (filters.category !== 'TODOS' && (d.categoria || 'N/A') !== filters.category) return false;

      return true;
    });
  }, [data, searchTerm, filters, currentDate, selectedDay]);

  // Cálculo de Totais
  const summary = useMemo(() => {
    return filteredData.reduce((acc, item) => ({
      totalDoc: acc.totalDoc + (item.valor_documento || 0),
      totalPago: acc.totalPago + (item.valor_pago || 0),
      totalSaldo: acc.totalSaldo + (item.saldo || 0),
      count: acc.count + 1
    }), { totalDoc: 0, totalPago: 0, totalSaldo: 0, count: 0 });
  }, [filteredData]);

  // Lógica de Paginação
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentAccounts = filteredData.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  // Gera os dias do mês atual para a régua
  const daysInMonth = getDaysInMonth(currentDate);
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  if (loading) return <div className="p-20 text-center opacity-30 font-black uppercase text-xs italic animate-pulse">Carregando Despesas...</div>;

  return (
    <div className="space-y-4 animate-in fade-in duration-500 pb-10 h-full flex flex-col">
      {toast && <Toast message={toast.msg} type={toast.type as any} onClose={() => setToast(null)} />}
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Contas a Pagar</h2>
          <p className="text-[9px] font-black text-blue-600 uppercase tracking-[0.4em] mt-2 italic">
            Gestão Financeira Dinâmica
          </p>
        </div>
        
        <div className="flex items-center gap-3">
           <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex-1 md:w-auto">
              <button
                onClick={handleSyncExpenses}
                disabled={isSyncing}
                className="p-2 rounded-xl transition-all text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={isSyncing ? "Sincronizando..." : "Sincronizar com Tiny"}
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
                placeholder="Pesquisar..." 
                className="w-full md:w-48 px-4 py-2 bg-transparent outline-none font-bold text-xs"
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

      {/* --- NAVEGAÇÃO DE DATA (ESTILO BI) --- */}
      <div className="bg-white rounded-[2rem] border border-slate-200 p-4 shadow-sm space-y-4">
         {/* Linha 1: Navegação Mês */}
         <div className="flex items-center justify-between px-4">
            <button onClick={handlePrevMonth} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
               <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            
            <div className="flex flex-col items-center">
               <h3 className="text-xl font-black text-slate-900 uppercase italic tracking-tighter">
                  {format(currentDate, 'MMMM yyyy', { locale: ptBR })}
               </h3>
               {selectedDay ? (
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-0.5 rounded-full mt-1">
                     Dia {selectedDay} Selecionado
                  </span>
               ) : (
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                     Visualizando Mês Completo
                  </span>
               )}
            </div>

            <button onClick={handleNextMonth} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
               <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
            </button>
         </div>

         {/* Linha 2: Régua de Dias */}
         <div className="flex items-center gap-2 overflow-x-auto pb-2 px-2 no-scrollbar">
            {daysArray.map(day => (
               <button
                  key={day}
                  onClick={() => handleDaySelect(day)}
                  className={`
                     flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black transition-all
                     ${selectedDay === day 
                        ? 'bg-blue-600 text-white shadow-lg scale-110' 
                        : 'bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'}
                  `}
               >
                  {day}
               </button>
            ))}
         </div>
      </div>

      {/* Tabela de Dados */}
      <div className="table-container flex-1 overflow-auto border border-slate-200 rounded-[2rem] bg-white shadow-sm flex flex-col" style={{ maxHeight: 'calc(100vh - 350px)' }}>
        <div className="flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0" style={{ minWidth: '1800px' }}>
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left sticky left-0 z-30 whitespace-nowrap">ID</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left whitespace-nowrap">Fornecedor</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center whitespace-nowrap">Data Emissão</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center whitespace-nowrap">Data Vencimento</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center whitespace-nowrap">Data Liquidação</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-right whitespace-nowrap">Valor documento</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-right whitespace-nowrap">Pago</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-right whitespace-nowrap">Saldo</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center whitespace-nowrap">Situação</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left whitespace-nowrap">Número documento</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left whitespace-nowrap">Categoria</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left whitespace-nowrap">Histórico</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left whitespace-nowrap">Competência</th>
                <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left whitespace-nowrap">Forma Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {currentAccounts.map(item => (
                <tr key={item.id} className="group hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-4 border-b border-slate-100 font-black text-blue-600 text-[10px] italic sticky left-0 z-10 bg-white group-hover:bg-slate-50 whitespace-nowrap">#{item.id}</td>
                  <td className="px-6 py-4 border-b border-slate-100 font-black text-slate-900 uppercase italic text-[11px] whitespace-nowrap">{item.fornecedor}</td>
                  <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-500 text-center whitespace-nowrap">{item.data_emissao ? item.data_emissao.split('-').reverse().join('/') : '---'}</td>
                  <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-900 text-center whitespace-nowrap">{item.data_vencimento ? item.data_vencimento.split('-').reverse().join('/') : '---'}</td>
                  <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-400 text-center whitespace-nowrap">{item.data_liquidacao ? item.data_liquidacao.split('-').reverse().join('/') : '---'}</td>
                  <td className="px-6 py-4 border-b border-slate-100 text-right font-bold text-slate-400 text-[11px] whitespace-nowrap">R$ {(item.valor_documento || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 border-b border-slate-100 text-right font-black text-emerald-600 text-[11px] whitespace-nowrap">R$ {(item.valor_pago || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 border-b border-slate-100 text-right font-black text-slate-900 text-[11px] whitespace-nowrap">R$ {(item.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 border-b border-slate-100 text-center whitespace-nowrap">
                     <div className={`inline-flex px-3 py-1 rounded-lg font-black text-[9px] uppercase border shadow-sm ${ (item.situacao || '').toLowerCase().includes('pago') || (item.situacao || '').toLowerCase().includes('paga') || (item.situacao || '').toLowerCase().includes('liquidado') ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : item.data_vencimento && new Date(item.data_vencimento) < new Date() ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100' }`}>{item.situacao || 'PENDENTE'}</div>
                  </td>
                  <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-600 whitespace-nowrap">{item.numero_documento || '---'}</td>
                  <td className="px-6 py-4 border-b border-slate-100 font-black text-blue-500 text-[9px] uppercase whitespace-nowrap">{item.categoria || 'SEM CATEGORIA'}</td>
                  <td className="px-6 py-4 border-b border-slate-100 text-[10px] text-slate-400 max-w-xs truncate whitespace-nowrap" title={item.historico}>{item.historico}</td>
                  <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-500 whitespace-nowrap">{item.competencia}</td>
                  <td className="px-6 py-4 border-b border-slate-100 font-bold text-[10px] text-slate-500 uppercase whitespace-nowrap">{item.forma_pagamento}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredData.length === 0 && (<div className="py-20 text-center opacity-30 font-black uppercase text-[10px] tracking-widest">Nenhum registro encontrado para este período.</div>)}
        </div>

        {/* --- BARRA DE TOTAIS --- */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between gap-6 overflow-x-auto">
            <div className="flex gap-6">
              <div className="flex flex-col">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Qtd</span>
                  <span className="text-sm font-black text-slate-700">{summary.count}</span>
              </div>
              <div className="w-px bg-slate-200"></div>
              <div className="flex flex-col">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total</span>
                  <span className="text-sm font-black text-slate-900">R$ {summary.totalDoc.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
              </div>
              <div className="flex flex-col">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Pago</span>
                  <span className="text-sm font-black text-emerald-600">R$ {summary.totalPago.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
              </div>
              <div className="flex flex-col">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">A Pagar</span>
                  <span className="text-sm font-black text-red-500">R$ {summary.totalSaldo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
              </div>
            </div>
        </div>

        {/* --- RODAPÉ COM PAGINAÇÃO --- */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-t border-slate-100 sticky bottom-0 z-40">
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                Mostrando <span className="font-black text-slate-900">{indexOfFirstItem + 1}</span> até{' '}
                <span className="font-black text-slate-900">
                  {Math.min(indexOfLastItem, filteredData.length)}
                </span>{' '}
                de <span className="font-black text-slate-900">{filteredData.length}</span> resultados
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-xl shadow-sm -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className={`relative inline-flex items-center px-3 py-2 rounded-l-xl border border-slate-200 bg-white text-xs font-bold uppercase tracking-wider ${
                    currentPage === 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  Anterior
                </button>
                
                {/* Paginação Segura */}
                <div className="hidden md:flex gap-1">
                  {Array.from({ length: Math.max(0, totalPages) }).map((_, i) => {
                    const pageNum = i + 1;
                    if (pageNum === 1 || pageNum === totalPages || (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)) {
                       return (
                        <button
                          key={i}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`relative inline-flex items-center px-4 py-2 border text-xs font-bold ${
                            currentPage === pageNum
                              ? 'z-10 bg-slate-900 border-slate-900 text-white rounded-lg shadow-md'
                              : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 rounded-lg'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    } else if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                       return <span key={i} className="px-2 py-2 text-slate-400 font-bold">...</span>;
                    }
                    return null;
                  })}
                </div>

                <button
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages || totalPages === 0}
                  className={`relative inline-flex items-center px-3 py-2 rounded-r-xl border border-slate-200 bg-white text-xs font-bold uppercase tracking-wider ${
                    currentPage === totalPages || totalPages === 0 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  Próximo
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>

      {showFilterModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-200">
           <div className="bg-white max-w-lg w-full rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                 <div><h3 className="text-xl font-black text-slate-900 uppercase italic tracking-tighter">Filtros Avançados</h3><p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-1">Refine por categoria ou status</p></div>
                 <button onClick={() => setShowFilterModal(false)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-slate-900 transition-all"><ICONS.Add className="w-5 h-5 rotate-45" /></button>
              </div>
              <div className="p-8 space-y-6">
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Situação</label>
                    <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase cursor-pointer">
                       <option value="TODOS">Todas as Situações</option>
                       {uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Categoria</label>
                    <select value={filters.category} onChange={e => setFilters({...filters, category: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase cursor-pointer">
                       <option value="TODOS">Todas as Categorias</option>
                       {uniqueCategories.map(s => <option key={s} value={s}>{s}</option>)}
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