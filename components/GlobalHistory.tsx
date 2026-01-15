
import React, { useState, useMemo, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { AuditLog } from '../types';
import { ICONS } from '../constants';

const GlobalHistory: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchData = async () => {
    setLoading(true);
    const data = await DataService.getLogs();
    // FILTRO RÍGIDO: Mostrar apenas registros do tipo FINANCEIRO ou relacionados a tesouraria
    const financialOnly = data.filter(l => 
      l.tipo === 'FINANCEIRO' || 
      ['ACORDO', 'BAIXA', 'PAGAR', 'RECEBER', 'CARTORIO'].some(key => l.acao.includes(key))
    );
    setLogs(financialOnly);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const stats = useMemo(() => {
    return {
      // Usamos uma verificação rigorosa para evitar NaN na soma total
      totalValue: logs.reduce((acc, curr) => {
        const val = Number(curr.valorOperacao);
        return acc + (isNaN(val) ? 0 : val);
      }, 0),
      count: logs.length
    };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const term = searchTerm.toLowerCase();
      return (
        log.usuario.toLowerCase().includes(term) ||
        log.detalhes.toLowerCase().includes(term) ||
        (log.cliente || '').toLowerCase().includes(term) ||
        log.acao.toLowerCase().includes(term)
      );
    });
  }, [logs, searchTerm]);

  const getActionConfig = (acao: string) => {
    const a = acao.toUpperCase();
    if (a.includes('BAIXA')) return { label: 'RECEBIMENTO', color: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: '💰' };
    if (a.includes('ACORDO')) return { label: 'CONTRATO / ACORDO', color: 'bg-purple-50 text-purple-600 border-purple-100', icon: '📝' };
    if (a.includes('PAGAR')) return { label: 'CONTA A PAGAR', color: 'bg-blue-50 text-blue-600 border-blue-100', icon: '📉' };
    if (a.includes('CARTORIO')) return { label: 'COBRANÇA / JURÍDICO', color: 'bg-red-50 text-red-600 border-red-100', icon: '⚖️' };
    if (a.includes('RECEBER')) return { label: 'CONTA A RECEBER', color: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: '📈' };
    
    return { label: 'MOV. FINANCEIRA', color: 'bg-slate-50 text-slate-500 border-slate-100', icon: '📌' };
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {/* HEADER DE KPIs FINANCEIROS NA TIMELINE */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
           <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-2 italic">Histórico de Fluxo</p>
           <h3 className="text-4xl font-black italic tracking-tighter leading-none">{stats.count} <span className="text-sm opacity-30">Ações Auditadas</span></h3>
           <div className="absolute right-[-10%] bottom-[-20%] opacity-5 group-hover:opacity-10 transition-opacity">
              <ICONS.History className="w-40 h-40" />
           </div>
        </div>
        <div className="md:col-span-2 bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col justify-center">
           <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2 italic">Volume Financeiro Total na Timeline</p>
           <h3 className="text-4xl font-black italic tracking-tighter text-slate-900 leading-none">
             R$ {stats.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
           </h3>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Timeline Geral</h2>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-3 italic">Rastreabilidade exclusiva de Tesouraria e Crédito</p>
        </div>
        
        <div className="flex gap-4 items-center">
           <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm md:w-96 flex items-center">
              <svg className="w-5 h-5 text-slate-300 ml-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3"/></svg>
              <input 
                type="text" 
                placeholder="BUSCAR CLIENTE, OPERADOR OU PROTOCOLO..." 
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
          <div className="py-40 text-center opacity-30 font-black uppercase text-[10px] tracking-[0.5em] italic animate-pulse">Sincronizando timeline de tesouraria...</div>
        ) : (
          <table className="w-full">
            <thead className="bg-[#0F172A] text-slate-500 text-[9px] font-black uppercase tracking-widest">
              <tr>
                <th className="px-10 py-6 text-left">Data / Hora</th>
                <th className="px-6 py-6 text-left">Autor (Usuário)</th>
                <th className="px-6 py-6 text-center">Operação Financeira</th>
                <th className="px-6 py-6 text-left">Contexto / Cliente</th>
                <th className="px-6 py-6 text-right">Valor Auditado</th>
                <th className="px-10 py-6 text-left">Resumo do Lançamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredLogs.map(log => {
                const config = getActionConfig(log.acao);
                const isDebit = log.acao.includes('PAGAR') || log.acao.includes('ESTORNO');
                const val = Number(log.valorOperacao);
                const displayVal = isNaN(val) ? 0 : val;
                
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
                       <div className={`inline-flex items-center px-4 py-1.5 rounded-xl text-[8px] font-black uppercase border shadow-sm ${config.color}`}>
                          <span className="mr-2">{config.icon}</span>
                          {config.label}
                       </div>
                    </td>
                    <td className="px-6 py-6">
                       <p className="font-black text-slate-800 uppercase italic text-[11px] truncate max-w-[200px]">{log.cliente || 'NZ TESOURARIA'}</p>
                    </td>
                    <td className="px-6 py-6 text-right">
                       <span className={`text-base font-black italic tracking-tighter ${isDebit ? 'text-red-500' : 'text-emerald-600'}`}>
                         {isDebit ? '-' : '+'} R$ {displayVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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
             <p className="font-black text-slate-400 uppercase tracking-[0.3em] text-[11px] italic">Nenhuma atividade financeira registrada nesta timeline.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default GlobalHistory;
