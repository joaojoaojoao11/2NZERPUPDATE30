
import React, { useState, useEffect, useMemo } from 'react';
import { DataService } from '../services/dataService';
import { ApprovalCase, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

const CaseManagement: React.FC<{ admin: User }> = ({ admin }) => {
  const [cases, setCases] = useState<ApprovalCase[]>([]);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [analyzingCase, setAnalyzingCase] = useState<ApprovalCase | null>(null);
  const [relato, setRelato] = useState('');

  useEffect(() => {
    setLoading(true);
    DataService.getApprovalCases().then(data => {
      setCases(data);
      setLoading(false);
    });
  }, [refreshKey]);

  const filteredCases = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return cases.filter(c => 
      c.sku.toLowerCase().includes(term) || 
      c.solicitante.toLowerCase().includes(term) ||
      c.id.toLowerCase().includes(term) ||
      (c.lpn || '').toLowerCase().includes(term)
    );
  }, [cases, searchTerm]);

  const handleProcess = async (action: 'APROVAR' | 'RECUSAR') => {
    if (!analyzingCase) return;
    if (!relato.trim()) {
      setToast({ msg: 'PARECER OBRIGATÓRIO.', type: 'error' });
      return;
    }

    try {
      const res = await DataService.processCase(analyzingCase.id, action, admin, relato);
      if (res.success) {
        setToast({ msg: `CASO ${action === 'APROVAR' ? 'APROVADO' : 'RECUSADO'} COM SUCESSO!`, type: 'success' });
        setRefreshKey(prev => prev + 1);
        setAnalyzingCase(null);
        setRelato('');
      } else {
        setToast({ msg: res.message, type: 'error' });
      }
    } catch (e) {
      setToast({ msg: 'Erro na conexão.', type: 'error' });
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 opacity-30">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="space-y-10 animate-in fade-in duration-500 pb-10">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      {/* Header Corporativo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Fila de Aprovação</h2>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.25em] mt-3 italic">Governança Logística • Auditoria de Incidentes</p>
        </div>
        <div className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-100 italic">
          {cases.filter(c => c.status === 'PENDENTE').length} Casos Aguardando
        </div>
      </div>

      {/* Busca com Alto Contraste */}
      <div className="bg-slate-200/50 p-6 rounded-[2.5rem] border border-slate-200/40">
        <div className="relative group">
          <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="2.5"/></svg>
          </div>
          <input 
            type="text" 
            placeholder="Pesquisar por SKU, LPN ou Solicitante..." 
            className="w-full pl-16 pr-8 py-5 bg-white border-2 border-transparent rounded-3xl outline-none font-bold text-sm focus:border-blue-500 shadow-md transition-all placeholder:text-slate-300"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
          />
        </div>
      </div>

      {/* Tabela de Aprovação */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th className="w-32">Data / Hora</th>
              <th className="w-40">Status</th>
              <th>Material / SKU</th>
              <th className="w-40">LPN Relacionado</th>
              <th className="w-48">Solicitante</th>
              <th className="w-32 col-right">Qtd. ML</th>
              <th className="w-32 col-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filteredCases.map(item => (
              <tr key={item.id}>
                <td>
                  <div className="flex flex-col">
                    <span className="text-slate-900 font-black text-xs leading-none">{new Date(item.timestamp).toLocaleDateString()}</span>
                    <span className="text-[10px] text-slate-400 font-bold mt-1">{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                </td>
                <td>
                  <div className={`data-pill ${
                    item.status === 'PENDENTE' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                    item.status === 'APROVADO' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                    'bg-red-50 text-red-600 border-red-100'
                  }`}>
                    {item.status}
                  </div>
                </td>
                <td>
                  <div className="flex flex-col">
                    <span className="font-black text-slate-900 uppercase tracking-tight">{item.sku}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase truncate max-w-[200px] mt-0.5">{item.motivo}</span>
                  </div>
                </td>
                <td>
                  <span className="lpn-badge inline-block">{item.lpn || '---'}</span>
                </td>
                <td>
                  <div className="flex flex-col">
                    <span className="font-black text-slate-700 text-[11px] uppercase tracking-tighter">@{item.solicitante.split(' ')[0]}</span>
                    <span className="text-[9px] text-slate-400 font-bold uppercase italic mt-0.5">{item.cliente || 'Venda Interna'}</span>
                  </div>
                </td>
                <td className="col-right">
                  <span className="font-black text-slate-900 text-sm tracking-tighter italic">{item.quantidade.toFixed(2)} ML</span>
                </td>
                <td className="col-right">
                  <button 
                    onClick={() => setAnalyzingCase(item)}
                    disabled={item.status !== 'PENDENTE'}
                    className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      item.status === 'PENDENTE' 
                      ? 'bg-slate-900 text-white hover:bg-blue-600 shadow-md' 
                      : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    }`}
                  >
                    {item.status === 'PENDENTE' ? 'Analisar' : 'Resolvido'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredCases.length === 0 && (
          <div className="py-24 text-center">
             <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 border border-slate-100">
                <ICONS.Alert className="w-10 h-10 text-slate-200" />
             </div>
             <p className="text-slate-400 font-black uppercase tracking-[0.3em] text-[10px] italic">Nenhum incidente na fila</p>
          </div>
        )}
      </div>

      {/* Modal de Análise de Caso */}
      {analyzingCase && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[110] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white max-w-2xl w-full rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
              <div className="px-10 py-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                 <div>
                    <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Análise de Incidente</h3>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-2 italic">Protocolo: {analyzingCase.id}</p>
                 </div>
                 <button onClick={() => setAnalyzingCase(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all">
                    <ICONS.Add className="w-6 h-6 rotate-45" />
                 </button>
              </div>
              
              <div className="p-10 space-y-8">
                 <div className="grid grid-cols-2 gap-8">
                    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Solicitado por</p>
                       <p className="text-sm font-black text-slate-900 uppercase italic">@{analyzingCase.solicitante}</p>
                    </div>
                    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Volume em Pátio</p>
                       <p className="text-sm font-black text-blue-600 uppercase italic">{analyzingCase.lpn || 'Sem LPN'}</p>
                    </div>
                 </div>

                 <div className="bg-blue-50 p-6 rounded-[2rem] border border-blue-100">
                    <div className="flex justify-between items-center mb-2">
                       <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest italic">Detalhamento do Movimento</p>
                       <span className="font-black text-blue-800 text-lg italic">-{analyzingCase.quantidade.toFixed(2)} ML</span>
                    </div>
                    <p className="text-xs font-medium text-blue-900 leading-relaxed italic uppercase tracking-tight">"{analyzingCase.motivo}: Solicitação vinculada ao pedido {analyzingCase.pedido}"</p>
                 </div>

                 <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Parecer Final da Gestão *</label>
                    <textarea 
                      value={relato}
                      onChange={e => setRelato(e.target.value.toUpperCase())}
                      placeholder="RELATE OS MOTIVOS DA APROVAÇÃO OU RECUSA..."
                      className="w-full px-6 py-5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-[1.5rem] text-sm font-medium outline-none h-32 resize-none focus:bg-white uppercase italic tracking-tight leading-relaxed"
                    />
                 </div>
              </div>

              <div className="px-10 py-8 bg-slate-50 border-t border-slate-100 flex justify-end gap-5">
                 <button 
                  onClick={() => handleProcess('RECUSAR')}
                  className="px-8 py-4 bg-red-50 text-red-600 font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-red-100 italic transition-all"
                 >
                   Recusar Baixa
                 </button>
                 <button 
                  onClick={() => handleProcess('APROVAR')}
                  className="px-10 py-5 bg-emerald-600 text-white rounded-[2rem] text-[11px] font-black uppercase tracking-widest shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all italic"
                 >
                   Efetivar Ajuste no Pátio
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default CaseManagement;
