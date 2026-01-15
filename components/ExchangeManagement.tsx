
import React, { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { ApprovalCase, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

const ExchangeManagement: React.FC<{ admin: User }> = ({ admin }) => {
  const [cases, setCases] = useState<ApprovalCase[]>([]);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

  // Fix: Corrected async call in useEffect using .then
  useEffect(() => {
    DataService.getApprovalCases().then(setCases);
  }, []);

  // Fix: Made handleAction asynchronous and awaiting processCase/getApprovalCases
  const handleAction = async (id: string, action: 'APROVAR' | 'RECUSAR') => {
    const success = await DataService.processCase(id, action, admin, `Ação ${action} executada via painel de trocas.`);
    if (success) {
      setToast({ msg: `Troca ${action === 'APROVAR' ? 'aprovada e estoque baixado' : 'recusada'}.`, type: 'success' });
      setCases(await DataService.getApprovalCases());
    } else {
      setToast({ msg: 'Erro ao processar. Verifique o saldo em estoque.', type: 'error' });
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Controle de Trocas & Devoluções</h2>
          <p className="text-sm text-slate-400 font-medium italic">Gestão de qualidade e conformidade operacional.</p>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
            <tr>
              <th className="px-8 py-5">Status</th>
              <th className="px-8 py-5">Material (SKU)</th>
              <th className="px-8 py-5">Qtd (ML)</th>
              <th className="px-8 py-5">Solicitante</th>
              <th className="px-8 py-5">Data/Hora</th>
              <th className="px-8 py-5 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {cases.map(item => (
              <tr key={item.id} className="hover:bg-slate-50/50 transition-all">
                <td className="px-8 py-6">
                  <span className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase border ${
                    item.status === 'PENDENTE' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                    item.status === 'APROVADO' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                    'bg-red-100 text-red-700 border-red-200'
                  }`}>
                    {item.status}
                  </span>
                </td>
                <td className="px-8 py-6">
                  <p className="font-black text-blue-600 text-sm">{item.sku}</p>
                </td>
                <td className="px-8 py-6 font-black text-slate-800">{item.quantidade} ML</td>
                <td className="px-8 py-6 text-xs font-bold text-slate-600">{item.solicitante}</td>
                <td className="px-8 py-6 text-[10px] font-mono text-slate-400">{new Date(item.timestamp).toLocaleString('pt-BR')}</td>
                <td className="px-8 py-6 text-right">
                  {item.status === 'PENDENTE' && (
                    <div className="flex justify-end space-x-2">
                      <button onClick={() => handleAction(item.id, 'RECUSAR')} className="p-2 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                      <button onClick={() => handleAction(item.id, 'APROVAR')} className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-100">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                      </button>
                    </div>
                  )}
                  {item.status !== 'PENDENTE' && (
                    <p className="text-[10px] font-black text-slate-400 uppercase">Por: {item.aprovador}</p>
                  )}
                </td>
              </tr>
            ))}
            {cases.length === 0 && (
              <tr>
                <td colSpan={6} className="py-20 text-center opacity-30 font-black uppercase tracking-widest text-slate-400">Nenhum caso de troca registrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ExchangeManagement;
