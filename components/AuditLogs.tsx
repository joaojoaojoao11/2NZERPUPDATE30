
import React, { useState, useMemo, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { AuditLog } from '../types';

const AuditLogs: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('TODOS');
  const [logs, setLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    DataService.getLogs().then(setLogs);
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const term = searchTerm.toLowerCase();
      const matchesText = 
        log.usuario.toLowerCase().includes(term) ||
        log.sku?.toLowerCase().includes(term) ||
        log.nome?.toLowerCase().includes(term) ||
        log.lpn?.toLowerCase().includes(term) ||
        log.lote?.toLowerCase().includes(term) ||
        log.cliente?.toLowerCase().includes(term) ||
        log.detalhes.toLowerCase().includes(term);

      const matchesAction = 
        actionFilter === 'TODOS' ||
        (actionFilter === 'ENTRADAS' && (log.acao.includes('ENTRADA') || log.acao.includes('APROVACAO_ENTRADA'))) ||
        (actionFilter === 'SAIDAS' && log.acao.includes('SAIDA')) ||
        (actionFilter === 'AJUSTES' && (log.acao.includes('EDICAO') || log.acao.includes('AJUSTE')));

      return matchesText && matchesAction;
    });
  }, [logs, searchTerm, actionFilter]);

  const handleExport = () => {
    if (filteredLogs.length === 0) return;
    const headers = ["DATA/HORA", "USUARIO", "ACAO", "IDENTIFICADOR", "SKU", "LOTE", "CLIENTE/DESTINO", "DETALHES", "METRAGEM"];
    const rows = filteredLogs.map(log => [
      new Date(log.timestamp).toLocaleString('pt-BR'),
      log.usuario,
      log.acao,
      log.lpn || '-',
      log.sku || '-',
      log.lote || '-',
      log.cliente || 'SISTEMA',
      log.detalhes.replace(/\|/g, ' '),
      log.quantidade ? log.quantidade.toString().replace('.', ',') : '0'
    ]);

    const csvContent = [headers.join('|'), ...rows.map(row => row.join('|'))].join('\n');
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `audit_timeline_nzstok_${new Date().toISOString().slice(0, 10)}.csv`);
    link.click();
  };

  const getAcaoColor = (acao: string) => {
    if (acao.includes('SAIDA')) return 'text-red-600 bg-red-50 border-red-100';
    if (acao.includes('ENTRADA')) return 'text-emerald-600 bg-emerald-50 border-emerald-100';
    if (acao.includes('APROVACAO')) return 'text-blue-600 bg-blue-50 border-blue-100';
    return 'text-slate-500 bg-slate-50 border-slate-100';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
        <div className="relative flex-1 max-w-xl">
          <input 
              type="text" 
              placeholder="PESQUISAR POR SKU, LPN OU OPERADOR..." 
              className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl outline-none font-bold text-slate-700 text-sm shadow-inner uppercase"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
          />
          <svg className="w-5 h-5 text-slate-300 absolute left-4 top-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3"/></svg>
        </div>
        
        <div className="flex flex-wrap gap-4">
          <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-200">
             {['TODOS', 'ENTRADAS', 'SAIDAS', 'AJUSTES'].map(f => (
               <button key={f} onClick={() => setActionFilter(f)} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${actionFilter === f ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400'}`}>
                 {f}
               </button>
             ))}
          </div>
          <button 
            onClick={handleExport}
            className="px-6 py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:text-blue-600 transition-all shadow-sm flex items-center space-x-2 italic"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2.5"/></svg>
            <span>Exportar CSV</span>
          </button>
        </div>
      </div>

      <div className="table-container shadow-none border-none">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-36 text-center">Data / Hora</th>
              <th className="w-40 text-center">Protocolo LPN</th>
              <th className="text-left">Material & Descrição</th>
              <th className="w-48 text-center">Ação & Origem</th>
              <th className="w-48 text-center">Cliente / Destino</th>
              <th className="w-32 text-right">Metragem</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map(log => (
              <tr key={log.id}>
                <td className="text-center">
                  <div className="flex flex-col items-center">
                    <span className="text-slate-900 font-black text-[11px] leading-none">{new Date(log.timestamp).toLocaleDateString('pt-BR')}</span>
                    <span className="text-[9px] text-slate-400 font-bold mt-1 uppercase">{new Date(log.timestamp).toLocaleTimeString('pt-BR')}</span>
                  </div>
                </td>
                <td className="text-center">
                  {log.lpn ? <span className="lpn-badge-industrial">{log.lpn}</span> : <span className="text-slate-200">---</span>}
                </td>
                <td className="text-left">
                  <div className="flex flex-col">
                    <span className="font-black text-slate-900 text-[12px] uppercase tracking-tight">{log.sku || 'SISTEMA'}</span>
                    <span className="text-[9px] text-slate-400 font-bold uppercase truncate max-w-[240px] mt-0.5">{log.nome || log.detalhes}</span>
                  </div>
                </td>
                <td className="text-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <span className={`px-2 py-0.5 rounded-lg font-black uppercase text-[8px] border ${getAcaoColor(log.acao)}`}>
                      {log.acao.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[8px] font-black text-slate-400 uppercase italic">@{log.usuario.split('@')[0]}</span>
                  </div>
                </td>
                <td className="text-center">
                  <p className="font-black text-slate-700 uppercase text-[10px] italic leading-tight truncate max-w-[140px]">
                    {log.cliente || 'NZ LOGÍSTICA'}
                  </p>
                </td>
                <td className="text-right">
                  <span className={`font-black text-sm tracking-tighter italic ${log.acao.includes('SAIDA') ? 'text-red-500' : 'text-emerald-500'}`}>
                    {log.acao.includes('SAIDA') ? '-' : '+'}{log.quantidade?.toFixed(2) || '0.00'} ML
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditLogs;
