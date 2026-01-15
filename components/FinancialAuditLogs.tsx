import React, { useState, useMemo, useEffect } from 'react';
import { FinanceService } from '../services/financeService';
import { User } from '../types';
import { ICONS } from '../constants';

const FinancialAuditLogs: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchData = async () => {
    setLoading(true);
    const data = await FinanceService.getFinancialLogs();
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const term = searchTerm.toLowerCase();
      return (
        log.usuario.toLowerCase().includes(term) ||
        (log.cliente || '').toLowerCase().includes(term) ||
        log.acao.toLowerCase().includes(term) ||
        (log.detalhes || '').toLowerCase().includes(term)
      );
    });
  }, [logs, searchTerm]);

  const getActionTheme = (acao: string) => {
    const a = acao.toUpperCase();
    if (a.includes('BAIXA')) return { label: 'LIQUIDAÇÃO', color: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: '💰' };
    if (a.includes('ACORDO')) return { label: 'NEGOCIAÇÃO', color: 'bg-purple-50 text-purple-600 border-purple-100', icon: '📝' };
    if (a.includes('ESTORNO')) return { label: 'REVERSÃO', color: 'bg-red-50 text-red-600 border-red-100', icon: '⚠️' };
    return { label: 'OUTROS', color: 'bg-slate-50 text-slate-500 border-slate-100', icon: '📌' };
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Auditoria de Caixa</h2>
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mt-3 italic">Rastreabilidade dedicada de tesouraria</p>
        </div>
        
        <div className="flex gap-4 items-center">
           <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm md:w-96 flex items-center">
              <svg className="w-5 h-5 text-slate-300 ml-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3"/></svg>
              <input 
                type="text" 
                placeholder="BUSCAR OPERADOR OU CLIENTE..." 
                className="w-full px-4 py-2 bg-transparent outline-none font-black text-[10px] uppercase placeholder:text-slate-300"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
           </div>
           <button onClick={fetchData} className="p-4 bg-slate-900 text-white rounded-2xl hover:bg-blue-600 transition-all shadow-lg">
             <ICONS.History className="w-5 h-5" />
           </button>
        </div>
      </div>

      <div className="table-container bg-white border border-slate-100 rounded-[3rem] shadow-sm overflow-hidden min-h-[600px]">
        {loading ? (
          <div className="py-40 text-center opacity-30 font-black uppercase text-[10px] tracking-[0.5em] italic animate-pulse">Sincronizando timeline financeira...</div>
        ) : (
          <table className="w-full">
            <thead className="bg-[#0F172A] text-slate-500 text-[9px] font-black uppercase tracking-widest">
              <tr>
                <th className="px-10 py-6 text-left">Data / Hora</th>
                <th className="px-6 py-6 text-left">Usuário</th>
                <th className="px-6 py-6 text-center">Operação</th>
                <th className="px-6 py-6 text-left">Cliente / Destino</th>
                <th className="px-6 py-6 text-right">Impacto Financeiro</th>
                <th className="px-10 py-6 text-left">Detalhamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredLogs.map(log => {
                const theme = getActionTheme(log.acao);
                return (
                  <tr key={log.id} className="group hover:bg-slate-50/80 transition-all">
                    <td className="px-10 py-6">
                       <div className="flex flex-col">
                          <span className="text-slate-900 font-black text-xs leading-none">{new Date(log.timestamp).toLocaleDateString('pt-BR')}</span>
                          <span className="text-[10px] text-blue-600 font-black mt-1 italic leading-none">{new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                       </div>
                    </td>
                    <td className="px-6 py-6">
                       <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-[11px] shadow-sm uppercase italic">{log.usuario[0]}</div>
                          <span className="text-[11px] font-black text-slate-700 uppercase italic">@{log.usuario.split('@')[0]}</span>
                       </div>
                    </td>
                    <td className="px-6 py-6 text-center">
                       <div className={`inline-flex items-center px-4 py-1.5 rounded-xl text-[8px] font-black uppercase border shadow-sm ${theme.color}`}>
                          <span className="mr-2">{theme.icon}</span>
                          {theme.label}
                       </div>
                    </td>
                    <td className="px-6 py-6">
                       <p className="font-black text-slate-800 uppercase italic text-[11px] truncate max-w-[200px]">{log.cliente || 'SISTEMA'}</p>
                    </td>
                    <td className="px-6 py-6 text-right">
                       <span className={`text-base font-black italic tracking-tighter ${log.acao.includes('ESTORNO') ? 'text-red-500' : 'text-emerald-600'}`}>
                         R$ {Number(log.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                       </span>
                    </td>
                    <td className="px-10 py-6">
                       <p className="text-[10px] font-bold text-slate-400 uppercase leading-relaxed max-w-md italic group-hover:text-slate-600 transition-colors">"{log.detalhes}"</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        
        {!loading && filteredLogs.length === 0 && (
          <div className="py-32 text-center opacity-30 flex flex-col items-center">
             <ICONS.Alert className="w-16 h-16 text-slate-300 mb-6" />
             <p className="font-black text-slate-400 uppercase tracking-[0.3em] text-[11px] italic">Nenhuma atividade registrada no período.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FinancialAuditLogs;