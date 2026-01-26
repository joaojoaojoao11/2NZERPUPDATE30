import React, { useState, useEffect } from 'react';
import { supabaseClient as supabase } from '../services/core';
import Toast from './Toast';
// ... Importe outros componentes se necessário (Forms, Tables, etc que você já usa)
// Estou mantendo a estrutura genérica para focar na lógica de integração

const AccountsReceivableModule: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' | 'info' } | null>(null);

  const fetchAccounts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('accounts_receivable')
      .select('*')
      .order('Data Vencimento', { ascending: true })
      .limit(100);

    if (error) {
      console.error(error);
      setToast({ msg: 'Erro ao carregar contas.', type: 'error' });
    } else {
      setAccounts(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleSyncFinance = async () => {
    setIsSyncing(true);
    setToast({ msg: 'Buscando dados no Tiny...', type: 'info' });

    try {
      const { data, error } = await supabase.functions.invoke('finance-integration');

      if (error) throw error;

      const count = data?.upserted_count || 0;
      setToast({ msg: `Sucesso! ${count} contas atualizadas.`, type: 'success' });
      await fetchAccounts(); // Recarrega a tabela para mostrar dados novos
      
    } catch (err: any) {
      console.error(err);
      setToast({ msg: `Erro na sincronização: ${err.message}`, type: 'error' });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6 p-6 bg-slate-50 min-h-screen">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Contas a Receber</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Gestão Financeira & Cobrança</p>
        </div>
        
        <button
          onClick={handleSyncFinance}
          disabled={isSyncing}
          className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSyncing ? (
            <>
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Sincronizando...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              <span>Sincronizar Tiny</span>
            </>
          )}
        </button>
      </div>

      {/* AQUI ENTRA A SUA TABELA EXISTENTE */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Vencimento</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Cliente</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Valor</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Situação</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Cobrança (Local)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {accounts.map((acc) => (
              <tr key={acc.ID} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 text-xs font-bold text-slate-600">
                    {acc['Data Vencimento'] ? new Date(acc['Data Vencimento']).toLocaleDateString('pt-BR') : '-'}
                </td>
                <td className="px-6 py-4 text-xs font-bold text-slate-800">{acc.Cliente}</td>
                <td className="px-6 py-4 text-xs font-black text-slate-900 text-right">
                    R$ {Number(acc['Valor documento']).toFixed(2)}
                </td>
                <td className="px-6 py-4 text-center">
                    <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                        acc['Situação'] === 'Liquidado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                        {acc['Situação']}
                    </span>
                </td>
                <td className="px-6 py-4 text-center">
                    {/* Exibe o dado LOCAL que não vem do Tiny */}
                    <span className="text-[10px] font-mono font-bold text-indigo-600">
                        {acc.status_cobranca || '-'}
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

export default AccountsReceivableModule;
