
import React, { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { InboundRequest, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

const InboundApproval: React.FC<{ admin: User }> = ({ admin }) => {
  const [requests, setRequests] = useState<InboundRequest[]>([]);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [relato, setRelato] = useState('');
  const [costs, setCosts] = useState<Record<string, number>>({});

  // Fix: useEffect now correctly handles async getInboundRequests
  useEffect(() => { 
    DataService.getInboundRequests().then(setRequests); 
  }, []);

  // Fix: handleAction is now asynchronous and awaiting processInboundRequest/getInboundRequests
  const handleAction = async (id: string, action: 'APROVAR' | 'RECUSAR') => {
    if (!relato.trim()) { setToast({ msg: 'O parecer da gestão é obrigatório.', type: 'error' }); return; }
    
    if (action === 'APROVAR') {
      const req = requests.find(r => r.id === id);
      const allCostsSet = req?.items.every((it, i) => costs[`${it.sku}_${i}`] > 0);
      if (!allCostsSet) { setToast({ msg: 'Insira o custo por metro de todos os itens.', type: 'error' }); return; }
    }

    const success = await DataService.processInboundRequest(id, action, admin, relato, costs);
    if (success) {
      setToast({ msg: `Lote ${action === 'APROVAR' ? 'aprovado e estoque gerado' : 'recusado'}.`, type: 'success' });
      setRequests(await DataService.getInboundRequests());
      setProcessingId(null);
      setRelato('');
      setCosts({});
    }
  };

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex items-center space-x-3 mb-2">
        <h2 className="text-3xl font-black text-slate-800 uppercase italic tracking-tighter">Conferência de Lotes Solicitados</h2>
        <span className="bg-blue-600 text-white px-2 py-0.5 rounded text-[10px] font-black">{requests.filter(r => r.status === 'PENDENTE').length} PENDENTES</span>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-950 text-white text-[10px] font-black uppercase tracking-widest">
            <tr>
              <th className="px-8 py-5">Protocolo de Entrada</th>
              <th className="px-8 py-5">Solicitado por</th>
              <th className="px-8 py-5">Status</th>
              <th className="px-8 py-5 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {requests.map(req => (
              <React.Fragment key={req.id}>
                <tr className={`hover:bg-slate-50 transition-all ${processingId === req.id ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-8 py-6">
                    <p className="font-black text-blue-600">{req.id}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">{req.items.length} ITENS NO LOTE • {new Date(req.timestamp).toLocaleDateString('pt-BR')}</p>
                  </td>
                  <td className="px-8 py-6 font-bold text-slate-600 text-xs uppercase">{req.solicitante}</td>
                  <td className="px-8 py-6">
                    <span className={`px-2.5 py-1 rounded-xl text-[9px] font-black uppercase ${
                      req.status === 'PENDENTE' ? 'text-amber-500 bg-amber-50' : 
                      req.status === 'APROVADO' ? 'text-emerald-500 bg-emerald-50' : 'text-red-500 bg-red-50'
                    }`}>
                      {req.status}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-right">
                    {req.status === 'PENDENTE' ? (
                      <button onClick={() => setProcessingId(processingId === req.id ? null : req.id)} className="px-6 py-2 bg-slate-900 text-white rounded-xl font-black uppercase text-xs hover:bg-blue-600 transition-all">
                        {processingId === req.id ? 'Fechar' : 'Conferir Lote'}
                      </button>
                    ) : (
                      <div className="text-[9px] text-slate-400 font-black uppercase">Processado por: {req.aprovador}</div>
                    )}
                  </td>
                </tr>
                {processingId === req.id && (
                  <tr className="bg-slate-50/50">
                    <td colSpan={4} className="px-10 py-10 border-t border-blue-100">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                        <div className="space-y-4">
                          <h4 className="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-4">Detalhamento & Custo por Metro (ML)</h4>
                          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {req.items.map((item, i) => (
                              <div key={i} className="flex flex-col p-5 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-3">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <span className="text-[10px] font-black text-blue-600 uppercase tracking-tighter">{item.sku} | {item.marca}</span>
                                    <p className="font-bold text-slate-800 text-sm leading-tight uppercase">{item.nome}</p>
                                    <div className="mt-1 flex space-x-2 text-[9px] font-bold text-slate-400 uppercase">
                                       <span>LOTE: {item.lote}</span>
                                       <span>POS: {item.coluna}-{item.prateleira}</span>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-lg font-black text-slate-900">{item.quantMl} ML</span>
                                    <p className="text-[8px] font-black text-slate-400 uppercase">Quant. Solicitada</p>
                                  </div>
                                </div>
                                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                                  <label className="text-[10px] font-black text-slate-500 uppercase">Custo Unitário p/ Metro (R$)</label>
                                  <div className="flex items-center space-x-2">
                                     <span className="text-xs font-black text-slate-300">R$</span>
                                     <input 
                                        type="number" 
                                        step="0.01" 
                                        value={costs[`${item.sku}_${i}`] || ''} 
                                        onChange={e => setCosts({...costs, [`${item.sku}_${i}`]: parseFloat(e.target.value)})} 
                                        className="w-32 px-4 py-2 bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl text-sm font-black text-center outline-none" 
                                        placeholder="0.00" 
                                     />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col space-y-4">
                           <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100 mb-2">
                              <h5 className="text-[10px] font-black text-amber-600 uppercase mb-2">Orientações de Conferência</h5>
                              <p className="text-[11px] text-amber-800 leading-relaxed font-medium">Verifique se as metragens físicas batem com as informadas pelo estoquista. O LPN final será gerado apenas após sua aprovação com o custo fiscal correto.</p>
                           </div>
                           <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Parecer da Gestão / Observações Fiscais *</label>
                           <textarea value={relato} onChange={e => setRelato(e.target.value)} className="flex-1 p-5 bg-white border-2 border-slate-100 rounded-[2rem] outline-none focus:border-blue-600 text-sm font-medium resize-none" placeholder="Relate divergências, avarias ou notas fiscais vinculadas..." />
                           <div className="flex gap-4">
                              <button onClick={() => handleAction(req.id, 'RECUSAR')} className="flex-1 py-5 bg-red-100 text-red-600 font-black rounded-3xl uppercase text-xs hover:bg-red-200 transition-all">Recusar Lote</button>
                              <button onClick={() => handleAction(req.id, 'APROVAR')} className="flex-1 py-5 bg-emerald-600 text-white font-black rounded-3xl uppercase text-xs shadow-2xl shadow-emerald-200 hover:bg-emerald-500 transition-all">Aprovar & Gerar Etiquetas LPN</button>
                           </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {requests.length === 0 && (
              <tr><td colSpan={4} className="py-24 text-center opacity-20 font-black uppercase tracking-widest text-slate-400">Nenhuma solicitação pendente</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InboundApproval;
