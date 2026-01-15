
import React, { useState, useMemo, useEffect } from 'react';
import { FinanceService } from '../services/financeService';
import { DataService } from '../services/dataService';
import { Settlement, AccountsReceivable, User, CompanySettings } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

type SettlementStep = 'GESTAO' | 'SELECAO' | 'SIMULACAO' | 'REVISAO';

const SettlementModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [step, setStep] = useState<SettlementStep>('GESTAO');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  
  const [ar, setAr] = useState<AccountsReceivable[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]);
  
  const [config, setConfig] = useState({
    parcelas: 1,
    dataPrimeira: new Date().toISOString().split('T')[0],
    frequencia: 'Mensal' as 'Mensal' | 'Quinzenal' | 'Semanal',
    totalAcordo: 0,
    observacao: ''
  });

  const [viewingSettlement, setViewingSettlement] = useState<Settlement | null>(null);
  const [viewingDetails, setViewingDetails] = useState<{ installments: AccountsReceivable[], originals: AccountsReceivable[] } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [resAr, resSet, resComp] = await Promise.all([
        FinanceService.getAccountsReceivable(),
        FinanceService.getSettlements(),
        DataService.getCompanySettings()
      ]);
      setAr(Array.isArray(resAr) ? resAr : []);
      setSettlements(Array.isArray(resSet) ? resSet : []);
      setCompany(resComp);
    } catch (e) {
      console.error("NZSTOK Safe Loading Error:", e);
      setAr([]);
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const projections = useMemo(() => {
    const parts = [];
    const total = Number(config.totalAcordo) || 0;
    const qtd = Math.max(1, Number(config.parcelas) || 1);
    const val = total / qtd;
    
    // Fallback simples para evitar erros de data
    for (let i = 0; i < qtd; i++) {
      parts.push({ 
        num: i + 1, 
        date: config.dataPrimeira || new Date().toISOString().split('T')[0], 
        value: val 
      });
    }
    return parts;
  }, [config]);

  const totalOriginalSelecionado = useMemo(() => {
    return (ar || []).filter(t => (selectedTitles || []).includes(t.id)).reduce((a, b) => a + (Number(b.saldo) || 0), 0);
  }, [ar, selectedTitles]);

  const handleOpenDetails = async (s: Settlement) => {
    setLoading(true);
    try {
      const details = await FinanceService.getSettlementDetails(s.id);
      setViewingDetails(details);
      setViewingSettlement(s);
    } catch (e) {
      setToast({ msg: "Erro ao abrir acordo.", type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (loading && step === 'GESTAO') return <div className="py-40 text-center opacity-30 font-black uppercase text-[10px] animate-pulse">Sincronizando Mesa de Acordos...</div>;

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {step === 'GESTAO' && (
        <div className="space-y-8">
          <div className="flex justify-between items-end">
            <div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Mesa de Acordos</h2>
              <p className="text-[10px] font-black text-blue-600 uppercase mt-3 italic tracking-widest">Recuperação de Crédito Resiliente</p>
            </div>
            <button 
              onClick={() => { setStep('SELECAO'); setSelectedClient(null); setSelectedTitles([]); }}
              className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-blue-600 transition-all flex items-center gap-3 italic"
            >
              <ICONS.Add className="w-4 h-4" /> Nova Negociação
            </button>
          </div>

          <div className="table-container bg-white border border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest">
                  <th className="px-8 py-5">Protocolo</th>
                  <th>Cliente</th>
                  <th className="text-right">Valor Acordo</th>
                  <th className="text-center">Status</th>
                  <th className="text-right px-8">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(settlements || []).map(s => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-all">
                    <td className="px-8 py-6 font-black text-blue-600 text-xs">#{s.id}</td>
                    <td className="font-black text-slate-800 uppercase text-[11px] truncate max-w-[200px]">{s.cliente}</td>
                    <td className="text-right font-black text-slate-900">R$ {(Number(s.valorAcordo) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="text-center">
                       <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase border ${s.status === 'ATIVO' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>{s.status}</span>
                    </td>
                    <td className="text-right px-8">
                       <button onClick={() => handleOpenDetails(s)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-900 hover:text-white transition-all italic">Ver Detalhes</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(settlements || []).length === 0 && (
              <div className="py-20 text-center opacity-20 font-black uppercase text-[10px] italic">Nenhum registro localizado</div>
            )}
          </div>
        </div>
      )}

      {/* Navegação Wizard Simples */}
      {step === 'SELECAO' && (
        <div className="max-w-5xl mx-auto space-y-8 animate-in slide-in-from-right-4">
           <button onClick={() => setStep('GESTAO')} className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-2 hover:text-slate-900">← Voltar</button>
           <h3 className="text-2xl font-black italic uppercase tracking-tighter">1. Localizar Devedor</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="space-y-4">
                 <input type="text" placeholder="PESQUISAR CLIENTE..." className="w-full px-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none font-black text-xs uppercase" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                 <div className="bg-white rounded-2xl border border-slate-100 shadow-sm max-h-60 overflow-y-auto">
                    {Array.from(new Set((ar || []).filter(t => (Number(t.saldo) || 0) > 0.01).map(t => t.cliente || 'N/A')))
                      .filter((c: string) => c.toLowerCase().includes(searchTerm.toLowerCase()))
                      .map(name => (
                        <button key={name} onClick={() => setSelectedClient(name)} className={`w-full p-4 text-left border-b border-slate-50 font-black text-[11px] uppercase italic ${selectedClient === name ? 'bg-blue-600 text-white' : 'hover:bg-slate-50'}`}>{name}</button>
                    ))}
                 </div>
              </div>
              <div className="space-y-4">
                 {selectedClient && (
                    <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                       <p className="text-[9px] font-black text-slate-400 uppercase mb-4">Débitos em Aberto</p>
                       <div className="space-y-3">
                          {(ar || []).filter(t => t.cliente === selectedClient && (Number(t.saldo) || 0) > 0.01).map(t => (
                            <button key={t.id} onClick={() => setSelectedTitles(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id])} className={`w-full p-4 rounded-xl border flex justify-between items-center transition-all ${selectedTitles.includes(t.id) ? 'border-blue-600 bg-blue-50' : 'border-slate-100 bg-slate-50'}`}>
                               <span className="font-black text-[10px] uppercase">NF: {t.id}</span>
                               <span className="font-black text-slate-900 text-xs">R$ {(Number(t.saldo) || 0).toLocaleString('pt-BR')}</span>
                            </button>
                          ))}
                       </div>
                       <button disabled={selectedTitles.length === 0} onClick={() => { setStep('SIMULACAO'); setConfig({...config, totalAcordo: totalOriginalSelecionado}); }} className="w-full mt-6 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest disabled:opacity-20 italic transition-all">Configurar Acordo →</button>
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {step === 'SIMULACAO' && (
        <div className="max-w-2xl mx-auto space-y-10 animate-in slide-in-from-right-4">
           <button onClick={() => setStep('SELECAO')} className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-2 hover:text-slate-900">← Alterar Seleção</button>
           <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-xl space-y-8">
              <h3 className="text-2xl font-black italic uppercase tracking-tighter">2. Simulador de Parcelas</h3>
              <div className="grid grid-cols-2 gap-6">
                 <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Parcelas</label>
                    <input type="number" min="1" max="60" className="w-full p-4 bg-slate-50 rounded-xl font-black text-lg outline-none" value={config.parcelas} onChange={e => setConfig({...config, parcelas: Number(e.target.value)})} />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Valor Final</label>
                    <input type="number" className="w-full p-4 bg-slate-50 rounded-xl font-black text-lg outline-none" value={config.totalAcordo} onChange={e => setConfig({...config, totalAcordo: Number(e.target.value)})} />
                 </div>
              </div>
              <button onClick={() => setStep('REVISAO')} className="w-full py-5 bg-blue-600 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-all italic shadow-xl">Revisar Confissão →</button>
           </div>
        </div>
      )}

      {step === 'REVISAO' && (
        <div className="max-w-2xl mx-auto space-y-10 animate-in zoom-in-95">
           <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 shadow-2xl text-center space-y-8">
              <h1 className="text-3xl font-black uppercase italic tracking-tighter">Termo de Confissão</h1>
              <p className="text-sm text-slate-500 leading-relaxed font-medium uppercase">Acordo de liquidação de débitos em nome de <span className="font-black text-slate-900">{selectedClient}</span> no montante de <span className="font-black text-blue-600">R$ {Number(config.totalAcordo).toLocaleString('pt-BR')}</span>.</p>
              <div className="flex gap-4">
                 <button onClick={() => setStep('SIMULACAO')} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase italic">Ajustar</button>
                 <button onClick={async () => {
                    setLoading(true);
                    const res = await FinanceService.createSettlement({
                       id: `AC-${Date.now().toString().slice(-6)}`, 
                       cliente: selectedClient!, 
                       valorOriginal: totalOriginalSelecionado, 
                       valorAcordo: config.totalAcordo,
                       parcelas: config.parcelas, 
                       frequencia: config.frequencia, 
                       dataPrimeiraParcela: config.dataPrimeira,
                       dataCriacao: new Date().toISOString(), 
                       status: 'ATIVO', 
                       usuario: currentUser.name, 
                       intervaloDias: 30
                    }, selectedTitles, currentUser);
                    if (res) {
                       setToast({ msg: "ACORDO EFETIVADO!", type: 'success' });
                       setStep('GESTAO');
                       fetchData();
                    }
                    setLoading(false);
                 }} className="flex-[2] py-5 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-emerald-700 italic">Registrar Acordo</button>
              </div>
           </div>
        </div>
      )}

      {/* Modal de Detalhes Detalhado */}
      {viewingSettlement && viewingDetails && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[200] flex items-center justify-center p-4">
           <div className="bg-white max-w-4xl w-full h-[80vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col border border-slate-100">
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                 <div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter leading-none">{viewingSettlement.cliente}</h3>
                    <p className="text-[10px] font-black text-blue-600 uppercase mt-2 italic">Contrato: {viewingSettlement.id}</p>
                 </div>
                 <button onClick={() => setViewingSettlement(null)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-500 transition-all"><ICONS.Add className="w-5 h-5 rotate-45" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-10 space-y-6">
                 {(viewingDetails.installments || []).map((inst, i) => (
                    <div key={inst.id} className="p-5 bg-slate-50 border border-slate-100 rounded-2xl flex justify-between items-center">
                       <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase italic">Parcela {i+1}</p>
                          <p className="font-black text-slate-900 text-sm">Vencimento: {inst.data_vencimento || '---'}</p>
                       </div>
                       <div className="text-right">
                          <p className="text-base font-black text-slate-900 italic">R$ {(Number(inst.valor_documento) || 0).toLocaleString('pt-BR')}</p>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${inst.situacao === 'PAGO' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>{inst.situacao}</span>
                       </div>
                    </div>
                 ))}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default SettlementModule;
