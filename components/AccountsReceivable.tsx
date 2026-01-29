import React, { useState, useEffect, useMemo, useRef } from 'react';
import { format, addMonths, subMonths, getDaysInMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { FinanceService } from '../services/financeService';
import { DataService } from '../services/dataService';
import { AccountsReceivable, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

import { supabaseClient as supabase } from '../services/core'; // Adicionado para a sincronização

const AccountsReceivableModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [data, setData] = useState<AccountsReceivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false); // Novo estado para o botão de sync

  // --- NOVOS ESTADOS DE NAVEGAÇÃO DE DATA (Estilo BI) ---
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [ignoreDateFilter, setIgnoreDateFilter] = useState(false); // NOVO ESTADO


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
    setToast({ msg: 'Buscando dados no Tiny...', type: 'info' });

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

  // --- FUNÇÕES DE NAVEGAÇÃO DE DATA ---
  const handlePrevMonth = () => {
    setCurrentDate(prev => subMonths(prev, 1));
    setSelectedDay(null); // Reseta dia ao mudar mês
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => addMonths(prev, 1));
    setSelectedDay(null);
  };

  const handleDaySelect = (day: number) => {
    if (selectedDay === day) {
      setSelectedDay(null); // Desmarca se clicar no mesmo
    } else {
      setSelectedDay(day);
    }
  };
  // -------------------------------------

  // Opções dinâmicas para os filtros baseadas nos dados carregados
  const uniqueOrigins = useMemo(() => Array.from(new Set(data.map(i => i.origem || 'OUTROS'))).sort(), [data]);
  const uniqueMethods = useMemo(() => Array.from(new Set(data.map(i => i.forma_pagamento || 'OUTROS'))).sort(), [data]);

  const filteredData = useMemo(() => {
    const term = searchTerm.toLowerCase();

    // Preparar dados para comparação de data
    const targetMonth = currentDate.getMonth();
    const targetYear = currentDate.getFullYear();

    return data.filter(item => {
      if (!item.data_vencimento) return false;

      // Se 'ignoreDateFilter' estiver ativo E houver termo de busca, PULA a checagem de data
      if (!ignoreDateFilter) {
        // Parse manual da data YYYY-MM-DD para garantir consistência
        const [yearStr, monthStr, dayStr] = String(item.data_vencimento).split('-');
        const itemYear = parseInt(yearStr);
        const itemMonth = parseInt(monthStr) - 1; // JS Months 0-11
        const itemDay = parseInt(dayStr);

        if (itemMonth !== targetMonth) return false;
        if (itemYear !== targetYear) return false;

        // 2. Filtro de Dia Específico (Se selecionado)
        if (selectedDay !== null) {
          if (itemDay !== selectedDay) return false;
        }
      } // <--- FECHAMENTO DO IF (!ignoreDateFilter)

      // 3. Filtro Textual (Busca Inteligente)
      const matchesSearch =
        (item.cliente || '').toLowerCase().includes(term) ||
        (item.numero_documento || '').toLowerCase().includes(term) ||
        (item.id || '').toLowerCase().includes(term) ||
        (item.id_acordo || '').toLowerCase().includes(term) ||
        (item.origem || '').toLowerCase().includes(term);

      if (!matchesSearch) return false;

      // 4. Filtros Avançados (Modal)

      // Filtro de Origem
      if (filters.origin !== 'TODOS' && (item.origem || 'OUTROS') !== filters.origin) return false;

      // Filtro de Forma de Pagamento
      if (filters.paymentMethod !== 'TODOS' && (item.forma_pagamento || 'OUTROS') !== filters.paymentMethod) return false;

      // Filtro de Situação
      if (filters.status !== 'TODOS') {
        const isCanceled = item.situacao === 'CANCELADO';
        const isOverdue = !isCanceled && item.data_vencimento && new Date(item.data_vencimento) < new Date() && item.saldo > 0.01;
        const statusItem = item.situacao || 'EM ABERTO';

        if (filters.status === 'VENCIDO') {
          if (!isOverdue) return false;
        } else if (filters.status === 'EM ABERTO') {
          if (statusItem !== 'EM ABERTO' || isOverdue || isCanceled) return false;
        } else {
          if (statusItem !== filters.status) return false;
        }
      }

      return true;
    });
  }, [data, searchTerm, filters, currentDate, selectedDay, ignoreDateFilter]);

  // Gera os dias do mês atual para a régua
  const daysInMonth = getDaysInMonth(currentDate);
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

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

  // Cálculo de Totais para a Barra Inferior
  const summary = useMemo(() => {
    return sortedData.reduce((acc, item) => {
      // Ignora cancelados APENAS para o saldo "A Receber"
      // Se estiver cancelado, assumimos que não há nada a receber, mesmo que o banco diga que tem saldo.
      const isCanceled = (item.situacao || '').toUpperCase().includes('CANCELAD');
      const saldoConsiderado = isCanceled ? 0 : (item.saldo || 0);

      return {
        totalDoc: acc.totalDoc + (item.valor_documento || 0),
        totalRecebido: acc.totalRecebido + (item.valor_recebido || 0),
        totalSaldo: acc.totalSaldo + saldoConsiderado,
        count: acc.count + 1
      };
    }, { totalDoc: 0, totalRecebido: 0, totalSaldo: 0, count: 0 });
  }, [sortedData]);

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
        className={`ml-2 p-1 rounded-md transition-all flex items-center justify-center w-5 h-5 ${isActive
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
          <p className="text-[9px] font-black text-blue-600 uppercase tracking-[0.4em] mt-2 italic">
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
              placeholder="Pesquisar..."
              className="w-full md:w-64 px-4 py-2 bg-transparent outline-none font-bold text-xs uppercase"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                if (!e.target.value) setIgnoreDateFilter(false);
              }}
            />
            {searchTerm && (
              <button
                onClick={() => setIgnoreDateFilter(!ignoreDateFilter)}
                className={`mx-2 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${ignoreDateFilter
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
              >
                {ignoreDateFilter ? 'Ver Mês' : 'Ver Tudo'}
              </button>
            )}
            <div className="h-6 w-px bg-slate-100"></div>
            <button
              onClick={() => setShowFilterModal(true)}
              className={`p-2 rounded-xl transition-all ${hasActiveFilters ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
              title="Filtros Avançados"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
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

      <div className="table-container flex-1 border border-slate-200 rounded-[2rem] bg-white shadow-sm flex flex-col relative" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <div className="flex-1 overflow-auto custom-scrollbar">
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

        {/* --- BARRA DE TOTAIS --- */}
        <div className="bg-slate-50 border-t border-slate-200 px-8 py-4 flex items-center gap-8 shrink-0 z-20 overflow-x-auto">
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Qtd</span>
            <span className="text-xl font-black text-slate-700">{summary.count}</span>
          </div>
          <div className="w-px h-8 bg-slate-200"></div>
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total</span>
            <span className="text-xl font-black text-slate-900">R$ {summary.totalDoc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Recebido</span>
            <span className="text-xl font-black text-emerald-600">R$ {summary.totalRecebido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">A Receber</span>
            <span className="text-xl font-black text-blue-600">R$ {summary.totalSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
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
                    <input type="date" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase" />
                  </div>
                  <div>
                    <p className="text-[8px] font-bold text-slate-400 mb-1">ATÉ</p>
                    <input type="date" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Origem do Lançamento</label>
                <select value={filters.origin} onChange={e => setFilters({ ...filters, origin: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase cursor-pointer">
                  <option value="TODOS">Todas as Origens</option>
                  {uniqueOrigins.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Forma de Pagamento</label>
                <select value={filters.paymentMethod} onChange={e => setFilters({ ...filters, paymentMethod: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase cursor-pointer">
                  <option value="TODOS">Todas as Formas</option>
                  {uniqueMethods.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Situação do Título</label>
                <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl text-xs font-bold outline-none uppercase cursor-pointer">
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


    </div>
  );
};

export default AccountsReceivableModule;