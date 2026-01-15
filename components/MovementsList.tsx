
import React, { useState, useMemo, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { AuditLog } from '../types';
import { ICONS } from '../constants';

type PeriodFilterType = 'ALL' | 'TODAY' | 'WEEK' | 'MONTH';
type NatureFilterType = 'ALL' | 'ENTRADA' | 'SAÍDA' | 'VENDA' | 'TROCA' | 'AVARIA' | 'AJUSTE';

const MovementsList: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterType>('ALL');
  const [selectedMonth, setSelectedMonth] = useState(''); // Novo estado para YYYY-MM
  const [natureFilter, setNatureFilter] = useState<NatureFilterType>('ALL');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    DataService.getLogs().then(data => {
      setLogs(data);
      setLoading(false);
    }).catch(err => {
      console.error("MovementsList Sync Error:", err);
      setLoading(false);
    });
  }, []);

  const getNatureza = (log: AuditLog) => {
    const action = (log.acao || '').toUpperCase();
    const motivo = (log.motivo || '').toUpperCase();
    
    if (motivo.includes('TROCA') || action.includes('TROCA')) 
      return { label: 'TROCA', color: 'bg-purple-50 text-purple-600 border-purple-100' };
    if (motivo.includes('DEFEITO') || action.includes('DEFEITO')) 
      return { label: 'AVARIA', color: 'bg-red-50 text-red-600 border-red-100' };
    if (motivo.includes('AJUSTE') || action.includes('AJUSTE')) 
      return { label: 'AJUSTE', color: 'bg-amber-50 text-amber-600 border-amber-100' };
    if (action.includes('VENDA')) 
      return { label: 'VENDA', color: 'bg-emerald-50 text-emerald-600 border-emerald-100' };
    
    return action.includes('SAIDA') ? 
      { label: 'SAÍDA', color: 'bg-rose-50 text-rose-600 border-rose-100' } :
      { label: 'ENTRADA', color: 'bg-blue-50 text-blue-600 border-blue-100' };
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // 1. Filtro de Governança (ignorar logs técnicos)
      if (!log.acao) return false;
      const isGovernance = log.acao.includes('MASTER') || log.acao.includes('GESTAO_USUARIO') || log.acao.includes('EDICAO_MASTER');
      if (isGovernance) return false;

      // 2. Filtro de Período
      let matchesPeriod = true;

      if (selectedMonth) {
        // Se houver mês selecionado, filtra pela string YYYY-MM
        matchesPeriod = log.timestamp.startsWith(selectedMonth);
      } else {
        // Lógica dos botões de atalho
        const logDate = new Date(log.timestamp);
        const today = new Date();
        
        if (periodFilter === 'TODAY') {
          matchesPeriod = logDate.toDateString() === today.toDateString();
        } else if (periodFilter === 'WEEK') {
          const weekAgo = new Date();
          weekAgo.setDate(today.getDate() - 7);
          matchesPeriod = logDate >= weekAgo;
        } else if (periodFilter === 'MONTH') {
          const monthAgo = new Date();
          monthAgo.setDate(today.getDate() - 30);
          matchesPeriod = logDate >= monthAgo;
        }
      }

      if (!matchesPeriod) return false;

      // 3. Filtro de Natureza
      const naturezaInfo = getNatureza(log);
      let matchesNature = true;
      if (natureFilter !== 'ALL') {
        matchesNature = naturezaInfo.label === natureFilter;
      }

      if (!matchesNature) return false;

      // 4. Filtro de Busca Textual
      const term = searchTerm.toLowerCase();
      return (
        (log.id && log.id.toLowerCase().includes(term)) ||
        (log.sku && log.sku.toLowerCase().includes(term)) ||
        (log.nome && log.nome.toLowerCase().includes(term)) ||
        (log.usuario && log.usuario.toLowerCase().includes(term)) ||
        (log.lpn && log.lpn.toLowerCase().includes(term)) ||
        (log.cliente && log.cliente.toLowerCase().includes(term))
      );
    });
  }, [logs, searchTerm, periodFilter, natureFilter, selectedMonth]);

  const handleExport = () => {
    if (filteredLogs.length === 0) return;
    
    const headers = [
      "DATA_HORA", 
      "LPN", 
      "NATUREZA", 
      "SKU", 
      "NOME_MATERIAL", 
      "OPERADOR", 
      "CLIENTE_DESTINO", 
      "QUANTIDADE_ML",
      "DETALHES"
    ];

    const safe = (str: string) => (str || '').replace(/;/g, ' ').replace(/[\r\n]+/g, ' ').trim();

    const rows = filteredLogs.map(log => {
      const nat = getNatureza(log);
      return [
        safe(new Date(log.timestamp).toLocaleString('pt-BR')),
        safe(log.lpn || '-'),
        safe(nat.label),
        safe(log.sku || '-'),
        safe(log.nome || '-'),
        safe(log.usuario),
        safe(log.cliente || '-'),
        (log.quantidade || 0).toString().replace('.', ','),
        safe(log.detalhes || '')
      ];
    });

    const csvContent = [
        headers.join(';'), 
        ...rows.map(row => row.join(';'))
    ].join('\r\n');

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `movimentacoes_nzstok_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 opacity-30">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Movimentações</h2>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.25em] mt-3 italic">Trilha de Auditoria Logística NZ</p>
        </div>
        <button 
          onClick={handleExport} 
          className="px-8 py-4 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:text-blue-600 hover:border-blue-200 transition-all flex items-center gap-3 font-black text-[10px] uppercase tracking-widest shadow-sm italic active:scale-95"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span>Exportar Histórico</span>
        </button>
      </div>

      {/* FILTROS DINÂMICOS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Filtro de Período + Mês/Ano */}
        <div className="bg-slate-100 p-1.5 rounded-2xl flex items-center gap-2 overflow-x-auto border border-slate-200 shrink-0">
          <div className="flex bg-white/50 rounded-xl p-1 shrink-0">
            {[
              { id: 'ALL', label: 'Tudo' },
              { id: 'TODAY', label: 'Hoje' },
              { id: 'WEEK', label: '7 Dias' },
              { id: 'MONTH', label: '30 Dias' }
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => { 
                  setPeriodFilter(f.id as PeriodFilterType); 
                  setSelectedMonth(''); // Limpa o mês específico ao selecionar um preset
                }}
                className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-all ${
                  periodFilter === f.id && !selectedMonth
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          
          <div className="h-6 w-px bg-slate-300 mx-1 shrink-0"></div>

          <div className="flex items-center gap-2 bg-white rounded-xl px-2 py-1 shadow-sm border border-slate-200 shrink-0">
             <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">MÊS ESPECÍFICO</span>
             <input 
               type="month" 
               value={selectedMonth}
               onChange={(e) => { 
                 setSelectedMonth(e.target.value); 
                 setPeriodFilter('ALL'); // Reseta o preset ao selecionar mês
               }}
               className="bg-transparent text-[10px] font-bold text-slate-700 uppercase outline-none cursor-pointer hover:text-blue-600 transition-colors"
             />
          </div>
        </div>

        {/* Filtro de Natureza */}
        <div className="bg-slate-100 p-1.5 rounded-2xl flex overflow-x-auto border border-slate-200 shrink-0 custom-scrollbar">
          {[
            { id: 'ALL', label: 'Todas Operações' },
            { id: 'ENTRADA', label: 'Entradas' },
            { id: 'SAÍDA', label: 'Saídas' },
            { id: 'VENDA', label: 'Vendas' },
            { id: 'TROCA', label: 'Trocas' },
            { id: 'AVARIA', label: 'Avarias' },
            { id: 'AJUSTE', label: 'Ajustes' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setNatureFilter(f.id as NatureFilterType)}
              className={`px-4 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-wide transition-all whitespace-nowrap ${
                natureFilter === f.id 
                  ? 'bg-slate-900 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-200/50 p-6 rounded-[2.5rem] border border-slate-200/40">
        <div className="relative group">
          <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="2.5"/></svg>
          </div>
          <input 
            type="text" 
            placeholder="Pesquisar por SKU, LPN, Cliente ou Operador..." 
            className="w-full pl-16 pr-8 py-5 bg-white border-2 border-transparent rounded-3xl outline-none font-bold text-sm focus:border-blue-500 shadow-md transition-all placeholder:text-slate-300"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
          />
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th className="w-32">Data / Hora</th>
              <th className="w-40">LPN Protocolo</th>
              <th className="w-32 col-center">Natureza</th>
              <th>Material / SKU</th>
              <th className="w-48">Operador / Cliente</th>
              <th className="w-32 col-right">Quant. (ML)</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map(log => {
              const nat = getNatureza(log);
              const isSaida = (log.acao || '').includes('SAIDA') || (log.acao || '').includes('SOLICITACAO') || (log.acao || '').includes('AUDITORIA');
              
              return (
                <tr key={log.id}>
                  <td>
                    <div className="flex flex-col">
                      <span className="text-slate-900 font-black text-xs leading-none">{new Date(log.timestamp).toLocaleDateString()}</span>
                      <span className="text-[10px] text-slate-400 font-bold mt-1">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </td>
                  <td>
                    <span className="lpn-badge inline-block">{log.lpn || 'SISTEMA'}</span>
                  </td>
                  <td className="col-center">
                    <div className={`data-pill ${nat.color}`}>
                      {nat.label}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col">
                      <span className="font-black text-slate-900 uppercase tracking-tight">{log.sku || 'N/A'}</span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase truncate max-w-[200px] mt-0.5">{log.nome || 'Lançamento Estrutural'}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col">
                      <span className="font-black text-slate-700 text-[11px] uppercase tracking-tighter">@{log.usuario ? log.usuario.split('@')[0] : 'bot'}</span>
                      <span className="text-[9px] text-slate-400 font-bold uppercase italic mt-0.5 truncate max-w-[150px]">{log.cliente || 'NZ Logística'}</span>
                    </div>
                  </td>
                  <td className="col-right">
                    <span className={`font-black text-sm tracking-tighter italic ${isSaida ? 'text-red-500' : 'text-emerald-500'}`}>
                      {isSaida ? '-' : '+'}{log.quantidade?.toFixed(2) || '0.00'} ML
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredLogs.length === 0 && (
          <div className="py-24 text-center">
             <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 border border-slate-100">
                <ICONS.History className="w-10 h-10 text-slate-200" />
             </div>
             <p className="text-slate-400 font-black uppercase tracking-[0.3em] text-[10px] italic">Nenhuma movimentação compatível</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MovementsList;
