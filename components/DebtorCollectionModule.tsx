
import React, { useState, useMemo, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { FinanceService } from '../services/financeService';
import { DebtorInfo, User, AccountsReceivable, CollectionHistory, Settlement } from '../types';
import { ICONS } from '../constants';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import Toast from './Toast';
import SettlementModule from './SettlementModule';

type MainTab = 'CARTEIRA' | 'PREVENCAO' | 'ACORDOS' | 'LOGS' | 'BI';
type QuickAction = 'AGENDAR' | 'RETORNO' | 'CARTORIO_IN' | 'CARTORIO_OUT' | null;

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

// Estilo para o botão piscante
const pulseOrangeStyle = `
  @keyframes orange-alert {
    0% { background-color: #f97316; box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.7); }
    50% { background-color: #fb923c; box-shadow: 0 0 0 10px rgba(249, 115, 22, 0); }
    100% { background-color: #f97316; box-shadow: 0 0 0 0 rgba(249, 115, 22, 0); }
  }
  .animate-orange-alert {
    animation: orange-alert 1.5s infinite;
  }
`;

const DebtorCollectionModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [activeMainTab, setActiveMainTab] = useState<MainTab>('CARTEIRA');
  const [debtors, setDebtors] = useState<DebtorInfo[]>([]);
  const [allLogs, setAllLogs] = useState<CollectionHistory[]>([]);
  const [allAR, setAllAR] = useState<AccountsReceivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' | 'warning' } | null>(null);
  
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [clientTitles, setClientTitles] = useState<AccountsReceivable[]>([]);
  const [clientHistory, setClientHistory] = useState<CollectionHistory[]>([]);
  const [selectedForAgreement, setSelectedForAgreement] = useState<string[]>([]);
  const [isSubmittingInteraction, setIsSubmittingInteraction] = useState(false);
  const [viewMode, setViewMode] = useState<'CRM' | 'SETTLEMENT'>('CRM');
  const [activeQuickAction, setActiveQuickAction] = useState<QuickAction>(null);
  const [quickActionData, setQuickActionData] = useState({ date: '', obs: '' });

  const [validSettlementIds, setValidSettlementIds] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    setLoading(true);
    try {
      const [debtorData, logsData, arData] = await Promise.all([
        DataService.getDebtorsSummary(),
        FinanceService.getAllCollectionLogs(),
        FinanceService.getAccountsReceivable()
      ]);
      setDebtors(debtorData);
      setAllLogs(logsData);
      setAllAR(arData);
    } catch (e) {
      setToast({ msg: 'Erro ao carregar dados.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Listas de Prevenção (Separadas entre Pendentes e Lembrados Hoje)
  const preventionGroups = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // IDs de títulos que já foram lembrados HOJE
    const remindedTodayIds = new Set(
      allLogs
        .filter(log => 
          log.acao_tomada === 'LEMBRETE_PREVENTIVO' && 
          log.data_registro.startsWith(todayStr)
        )
        .map(log => {
          const match = log.observacao?.match(/DOC: ([\w-]+)/);
          return match ? match[1] : null;
        })
        .filter(Boolean)
    );

    const baseList = allAR.filter(t => {
      if ((t.forma_pagamento || '').toUpperCase() !== 'BOLETO') return false;
      if (t.saldo <= 0.01) return false;
      const status = (t.situacao || '').toUpperCase();
      if (status === 'CANCELADO' || status === 'PAGO') return false;
      if (!t.data_vencimento) return false;
      
      const parts = t.data_vencimento.split('-').map(Number);
      const dueDate = new Date(parts[0], parts[1] - 1, parts[2]);
      dueDate.setHours(0, 0, 0, 0);

      const diffTime = dueDate.getTime() - today.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      return diffDays >= 0 && diffDays <= 3;
    });

    const pending = baseList.filter(t => !remindedTodayIds.has(t.numero_documento || t.id));
    const finished = baseList.filter(t => remindedTodayIds.has(t.numero_documento || t.id));

    return { 
      pending: pending.sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento)),
      finished: finished.sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
    };
  }, [allAR, allLogs]);

  const handleManageClient = async (cliente: string) => {
    setLoading(true);
    setSelectedClient(cliente);
    setActiveQuickAction(null);
    setSelectedForAgreement([]);
    setViewMode('CRM');
    try {
      const [arData, historyData, settlementsData] = await Promise.all([
        FinanceService.getAccountsReceivable(),
        FinanceService.getCollectionHistoryByClient(cliente),
        FinanceService.getSettlements()
      ]);
      
      const validIds = new Set(settlementsData.filter(s => s.status !== 'CANCELADO').map(s => s.id));
      setValidSettlementIds(validIds);

      const today = new Date().toISOString().split('T')[0];
      const filtered = arData.filter(t => {
        const situacao = (t.situacao || '').toUpperCase().trim();
        const formaPgto = (t.forma_pagamento || '').toUpperCase().trim();
        const vencimento = t.data_vencimento;
        
        if (t.cliente !== cliente) return false;
        
        const hasValidAgreement = !!t.id_acordo && validIds.has(t.id_acordo);
        const isOrphaned = !!t.id_acordo && !hasValidAgreement;
        
        if (formaPgto !== 'BOLETO' && !hasValidAgreement && !isOrphaned) return false;

        const isCartorio = situacao === 'EM CARTORIO' || t.statusCobranca === 'CARTORIO' || t.statusCobranca === 'BLOQUEADO_CARTORIO';

        if (t.saldo <= 0.01 && !hasValidAgreement) return false;

        if (hasValidAgreement || isCartorio) return true;

        const effectiveStatus = isOrphaned && situacao === 'NEGOCIADO' ? 'EM ABERTO' : situacao;
        
        const isOpenStatus = ['EM ABERTO', 'ABERTO', 'VENCIDO', 'VENCIDA', 'NEGOCIADO'].includes(effectiveStatus);
        const isStrictlyOverdue = vencimento < today;

        return isOpenStatus && (isStrictlyOverdue || isOrphaned);
      });
      
      setClientTitles(filtered);
      setClientHistory(historyData);
    } catch (e) {
      setToast({ msg: 'Erro ao carregar dossiê.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const calculateDaysOverdue = (dueDateStr: string) => {
    if (!dueDateStr) return 0;
    const parts = dueDateStr.split('-').map(Number);
    const due = new Date(parts[0], parts[1] - 1, parts[2]);
    const today = new Date();
    today.setHours(0,0,0,0);
    const diffTime = today.getTime() - due.getTime();
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  };

  const handleSimpleLog = async (acao: string, obs: string, date?: string) => {
    if (!selectedClient) return;
    setIsSubmittingInteraction(true);
    try {
      const totalDevido = clientTitles.reduce((acc, curr) => acc + (curr.saldo || 0), 0);
      const res = await FinanceService.addCollectionHistory({
        cliente: selectedClient,
        acao_tomada: acao,
        observacao: obs.toUpperCase(),
        data_proxima_acao: date || null,
        valor_devido: totalDevido,
        dias_atraso: clientTitles.length > 0 ? calculateDaysOverdue(clientTitles[0].data_vencimento) : 0, 
        usuario: currentUser.name
      });
      if (res.success) {
        setToast({ msg: `Ação registrada!`, type: 'success' });
        setActiveQuickAction(null);
        setQuickActionData({ date: '', obs: '' });
        const updatedHistory = await FinanceService.getCollectionHistoryByClient(selectedClient);
        setClientHistory(updatedHistory);

        const nextDateStr = date || new Date(Date.now() + 86400000).toISOString().split('T')[0]; 
        
        setDebtors(prev => prev.map(d => 
            d.cliente === selectedClient 
            ? { ...d, nextActionDate: nextDateStr } 
            : d
        ));
      }
    } catch (e) {
      setToast({ msg: 'Erro ao registrar.', type: 'error' });
    } finally {
      setIsSubmittingInteraction(false);
    }
  };

  const handleNotaryActionExec = async () => {
    if (!selectedClient) return;
    if (selectedForAgreement.length === 0) {
        setToast({ msg: 'Selecione os títulos para esta ação.', type: 'error' });
        return;
    }
    const type = activeQuickAction === 'CARTORIO_IN' ? 'INCLUIR' : 'RETIRAR';
    setIsSubmittingInteraction(true);
    try {
        const res = type === 'INCLUIR' 
            ? await FinanceService.sendTitlesToNotary(selectedForAgreement, currentUser)
            : await FinanceService.removeTitlesFromNotary(selectedForAgreement, currentUser);
        if (res.success) {
            await handleSimpleLog(type === 'INCLUIR' ? 'CARTORIO_INCLUSAO' : 'CARTORIO_RETIRADA', `${type === 'INCLUIR' ? 'INCLUSÃO' : 'RETIRADA'} EM CARTORIO: ${selectedForAgreement.join(', ')}`);
            setToast({ msg: `Operação de Cartório efetuada.`, type: 'success' });
            
            await handleManageClient(selectedClient);
            fetchData();
        }
    } catch (e) {
        setToast({ msg: 'Falha na comunicação.', type: 'error' });
    } finally {
        setIsSubmittingInteraction(false);
    }
  };

  const toggleTitleSelection = (title: AccountsReceivable) => {
    setSelectedForAgreement(prev => prev.includes(title.id) ? prev.filter(i => i !== title.id) : [...prev, title.id]);
  };

  const handleGoToAgreement = () => {
    setViewMode('SETTLEMENT');
  };

  const isNotaryRemovalMode = useMemo(() => {
    if (selectedForAgreement.length === 0) return false;
    const selectedItems = clientTitles.filter(t => selectedForAgreement.includes(t.id));
    
    return selectedItems.length > 0 && selectedItems.every(t => 
        t.situacao === 'EM CARTORIO' || 
        t.statusCobranca === 'CARTORIO' || 
        t.statusCobranca === 'BLOQUEADO_CARTORIO'
    );
  }, [selectedForAgreement, clientTitles]);

  const biData = useMemo(() => {
    const ageing = [
      { name: '1-15 dias', value: debtors.reduce((acc, d) => acc + d.vencidoAte15d, 0) },
      { name: '15+ dias', value: debtors.reduce((acc, d) => acc + d.vencidoMais15d, 0) },
      { name: 'Cartório', value: debtors.reduce((acc, d) => acc + d.enviarCartorio, 0) }
    ];

    const interactions = allLogs.slice(0, 30).reduce((acc: any, log) => {
      const date = new Date(log.data_registro).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const idx = acc.findIndex((i: any) => i.date === date);
      if (idx > -1) acc[idx].count++;
      else acc.push({ date, count: 1 });
      return acc;
    }, []).reverse();

    return { ageing, interactions };
  }, [debtors, allLogs]);

  const { priorityList, upToDateList } = useMemo(() => {
    const filteredDebtors = debtors.filter(d => d.cliente.toLowerCase().includes(searchTerm.toLowerCase()));
    const todayStr = new Date().toISOString().split('T')[0];

    const priority: DebtorInfo[] = [];
    const upToDate: DebtorInfo[] = [];

    filteredDebtors.forEach(d => {
        const hasArrears = d.totalVencido > 0.01 || (d.acordoAtrasado || 0) > 0.01;
        const isActionDue = !d.nextActionDate || d.nextActionDate <= todayStr;

        if (hasArrears && isActionDue) {
            priority.push(d);
        } else {
            upToDate.push(d);
        }
    });

    priority.sort((a, b) => b.totalVencido - a.totalVencido);
    upToDate.sort((a, b) => b.totalVencido - a.totalVencido);

    return { priorityList: priority, upToDateList: upToDate };
  }, [debtors, searchTerm]);

  const handleSendReminder = async (title: AccountsReceivable) => {
    setIsSubmittingInteraction(true);
    try {
        await FinanceService.addCollectionHistory({
            cliente: title.cliente,
            acao_tomada: 'LEMBRETE_PREVENTIVO',
            observacao: `LEMBRETE DE VENCIMENTO ENVIADO (DOC: ${title.numero_documento || title.id})`,
            valor_devido: title.saldo,
            dias_atraso: 0,
            usuario: currentUser.name
        });
        setToast({ msg: 'Lembrete registrado!', type: 'success' });
        const updatedLogs = await FinanceService.getAllCollectionLogs();
        setAllLogs(updatedLogs);
    } catch(e) {
        setToast({ msg: 'Erro ao registrar lembrete.', type: 'error' });
    } finally {
        setIsSubmittingInteraction(false);
    }
  };

  if (loading && !selectedClient) return <div className="py-24 text-center opacity-30 font-black uppercase text-xs animate-pulse">Sincronizando Carteira...</div>;

  if (viewMode === 'SETTLEMENT' && selectedClient) {
    return <SettlementModule currentUser={currentUser} initialClient={selectedClient} initialTitles={selectedForAgreement} onBack={() => { setViewMode('CRM'); handleManageClient(selectedClient); }} />;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10 flex flex-col h-full">
      <style>{pulseOrangeStyle}</style>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      {!selectedClient ? (
        <>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 shrink-0">
            <div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Gestão de Cobrança</h2>
              <div className="flex flex-wrap gap-2 mt-4">
                 {[
                   { id: 'CARTEIRA', label: 'Carteira em Atraso' },
                   { id: 'PREVENCAO', label: 'Prevenção de Inadimplência' },
                   { id: 'ACORDOS', label: 'Gestão de Acordos' },
                   { id: 'LOGS', label: 'Log Cobrança' },
                   { id: 'BI', label: 'BI Cobrança' }
                 ].map(tab => (
                   <button key={tab.id} onClick={() => setActiveMainTab(tab.id as MainTab)} className={`px-5 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all border ${activeMainTab === tab.id ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'}`}>
                     {tab.label}
                   </button>
                 ))}
              </div>
            </div>
            <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm md:w-80 flex items-center">
              <svg className="w-5 h-5 text-slate-300 ml-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3"/></svg>
              <input type="text" placeholder="LOCALIZAR..." className="w-full px-4 py-2 bg-transparent outline-none font-black text-xs uppercase" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </div>

          <div className="flex-1 min-h-0">
             {activeMainTab === 'CARTEIRA' && (
                <div className="space-y-8 overflow-y-auto pr-2 custom-scrollbar">
                   {priorityList.length > 0 && (
                       <div>
                           <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest italic flex items-center gap-2 mb-4 sticky top-0 bg-white/80 backdrop-blur-sm p-2 z-10 rounded-xl border border-amber-100/50">
                              <span className="w-2 h-2 rounded-full bg-amber-600 animate-pulse"></span>
                              Prioridade: A Cobrar / Atrasados
                           </p>
                           <div className="space-y-4">
                               {priorityList.map(d => (
                                  <div key={d.cliente} className="bg-white border border-amber-200 p-6 rounded-[2.5rem] shadow-sm hover:border-amber-400 transition-all group flex flex-col xl:flex-row justify-between items-center gap-6 relative overflow-hidden">
                                     <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500"></div>
                                     <div className="flex-1 w-full pl-2">
                                        <div className="flex items-center gap-3 mb-1">
                                           <h3 className="font-black text-slate-900 uppercase italic text-lg tracking-tight">{d.cliente}</h3>
                                           {d.vencidoMais15d > 0 && <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded text-[7px] font-black uppercase tracking-widest border border-red-100">Risco Alto</span>}
                                           {(d.acordoAtrasado || 0) > 0 && <span className="bg-purple-50 text-purple-600 px-2 py-0.5 rounded text-[7px] font-black uppercase tracking-widest border border-purple-100">Acordo Quebrado</span>}
                                        </div>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{d.qtdTitulos} Títulos em aberto</p>
                                     </div>
                                     <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-center items-center w-full xl:w-auto">
                                        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 min-w-[110px]"><p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Total</p><p className="text-sm font-black text-slate-900 italic">R$ {d.totalVencido.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100 min-w-[110px]"><p className="text-[7px] font-black text-amber-600 uppercase tracking-widest mb-1">0 a 15 Dias</p><p className="text-sm font-black text-amber-700 italic">R$ {d.vencidoAte15d.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        <div className="bg-red-50 p-3 rounded-2xl border border-red-100 min-w-[110px]"><p className="text-[7px] font-black text-red-600 uppercase tracking-widest mb-1">15+ Dias</p><p className="text-sm font-black text-red-700 italic">R$ {d.vencidoMais15d.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        <div className="bg-slate-900 p-3 rounded-2xl text-white min-w-[110px]"><p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Em Cartório</p><p className="text-sm font-black italic text-white">R$ {d.enviarCartorio.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        <div className="bg-purple-50 p-3 rounded-2xl border border-purple-100 min-w-[110px]"><p className="text-[7px] font-black text-purple-600 uppercase tracking-widest mb-1">Em Acordo</p><p className="text-sm font-black text-purple-700 italic">R$ {d.emAcordo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        
                                        <button onClick={() => handleManageClient(d.cliente)} className="px-6 py-4 bg-amber-600 text-white rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-amber-700 transition-all shadow-lg italic h-full">Gerenciar</button>
                                     </div>
                                  </div>
                               ))}
                           </div>
                       </div>
                   )}

                   {upToDateList.length > 0 && (
                       <div className="mt-8 pt-8 border-t border-slate-100">
                           <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest italic flex items-center gap-2 mb-4">
                              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                              Cobrança em Dia / Agendados
                           </p>
                           <div className="space-y-4 opacity-80 hover:opacity-100 transition-opacity">
                               {upToDateList.map(d => {
                                  const isFullyPaidOrAgreed = d.totalVencido === 0 && (d.acordoAtrasado || 0) === 0;
                                  return (
                                  <div key={d.cliente} className="bg-white border border-slate-100 p-6 rounded-[2.5rem] shadow-sm hover:border-blue-300 transition-all group flex flex-col xl:flex-row justify-between items-center gap-6">
                                     <div className="flex-1 w-full">
                                        <div className="flex items-center gap-3 mb-1">
                                           <h3 className="font-black text-slate-700 uppercase italic text-lg tracking-tight">{d.cliente}</h3>
                                           {isFullyPaidOrAgreed ? (
                                              <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded text-[7px] font-black uppercase tracking-widest border border-emerald-100">
                                                 EM DIA / ACORDO
                                              </span>
                                           ) : (
                                              <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[7px] font-black uppercase tracking-widest border border-blue-100">
                                                 Retorno: {d.nextActionDate ? d.nextActionDate.split('-').reverse().join('/') : '-'}
                                              </span>
                                           )}
                                        </div>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{d.qtdTitulos} Títulos sob gestão</p>
                                     </div>
                                     <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-center items-center w-full xl:w-auto">
                                        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 min-w-[110px]"><p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Total</p><p className="text-sm font-black text-slate-900 italic">R$ {d.totalVencido.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100 min-w-[110px]"><p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">0 a 15 Dias</p><p className="text-sm font-black text-amber-700 italic">R$ {d.vencidoAte15d.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        <div className="bg-red-50 p-3 rounded-2xl border border-red-100 min-w-[110px]"><p className="text-[7px] font-black text-red-600 uppercase tracking-widest mb-1">15+ Dias</p><p className="text-sm font-black text-red-700 italic">R$ {d.vencidoMais15d.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        <div className="bg-slate-900 p-3 rounded-2xl text-white min-w-[110px]"><p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Em Cartório</p><p className="text-sm font-black italic text-white">R$ {d.enviarCartorio.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        <div className="bg-purple-50 p-3 rounded-2xl border border-purple-100 min-w-[110px]"><p className="text-[7px] font-black text-purple-600 uppercase tracking-widest mb-1">Em Acordo</p><p className="text-sm font-black text-purple-700 italic">R$ {d.emAcordo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        
                                        <button onClick={() => handleManageClient(d.cliente)} className="px-6 py-4 bg-blue-600 text-white rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg italic h-full">Gerenciar</button>
                                     </div>
                                  </div>
                               )})}
                           </div>
                       </div>
                   )}

                   {priorityList.length === 0 && upToDateList.length === 0 && (
                        <div className="py-24 text-center opacity-30 font-black uppercase text-[10px] italic">
                            Nenhum cliente inadimplente encontrado com este filtro.
                        </div>
                   )}
                </div>
             )}

             {activeMainTab === 'PREVENCAO' && (
                <div className="space-y-6 overflow-y-auto pr-2 custom-scrollbar">
                   {/* SEÇÃO 1: PENDENTES (BOTÃO PISCANTE) */}
                   <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
                      <div className="px-8 py-5 border-b border-slate-50 bg-indigo-50/50 flex justify-between items-center">
                         <div>
                            <h4 className="text-[11px] font-black text-indigo-700 uppercase tracking-widest italic flex items-center gap-2">
                               <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></span>
                               Pendentes de Lembrete (Boletos 0-3 dias)
                            </h4>
                            <p className="text-[9px] text-indigo-400 font-bold uppercase mt-1">Acione o cliente antes do vencimento para garantir o fluxo</p>
                         </div>
                         <div className="bg-white px-4 py-2 rounded-xl border border-indigo-100 shadow-sm">
                            <span className="text-[10px] font-black text-indigo-600">{preventionGroups.pending.length} Pendentes</span>
                         </div>
                      </div>
                      <table className="w-full text-left">
                         <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10 shadow-sm">
                            <tr>
                               <th className="px-8 py-5">Vencimento</th>
                               <th className="px-8 py-5">Cliente</th>
                               <th className="px-8 py-5 text-right">Valor</th>
                               <th className="px-8 py-5 text-center">Dias</th>
                               <th className="px-8 py-5 text-right">Ação</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-50 text-[11px]">
                            {preventionGroups.pending.map(item => {
                               const today = new Date();
                               today.setHours(0,0,0,0);
                               const parts = item.data_vencimento.split('-').map(Number);
                               const dueDate = new Date(parts[0], parts[1]-1, parts[2]);
                               dueDate.setHours(0,0,0,0);
                               const diffTime = dueDate.getTime() - today.getTime();
                               const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                               const displayDate = item.data_vencimento.split('-').reverse().join('/');
                               
                               let statusBadgeColor = 'bg-slate-50 text-slate-500 border-slate-200';
                               if (diffDays === 0) statusBadgeColor = 'bg-red-50 text-red-600 border-red-100';
                               else if (diffDays === 1) statusBadgeColor = 'bg-amber-50 text-amber-600 border-amber-100';
                               else if (diffDays === 2) statusBadgeColor = 'bg-blue-50 text-blue-600 border-blue-100';
                               else if (diffDays === 3) statusBadgeColor = 'bg-emerald-50 text-emerald-600 border-emerald-100';

                               return (
                               <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-8 py-5 font-black text-slate-700">{displayDate}</td>
                                  <td className="px-8 py-5">
                                     <p className="font-black text-slate-900 uppercase italic truncate max-w-[250px]">{item.cliente}</p>
                                     <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">NF: {item.numero_documento || item.id}</p>
                                  </td>
                                  <td className="px-8 py-5 text-right font-black text-slate-900">R$ {item.saldo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                                  <td className="px-8 py-5 text-center">
                                     <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase border ${statusBadgeColor}`}>
                                        {diffDays === 0 ? 'HOJE' : diffDays === 1 ? 'AMANHÃ' : `${diffDays} DIAS`}
                                     </span>
                                  </td>
                                  <td className="px-8 py-5 text-right">
                                     <button 
                                        onClick={() => handleSendReminder(item)}
                                        disabled={isSubmittingInteraction}
                                        className="px-4 py-2 bg-orange-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all animate-orange-alert border border-orange-400 shadow-lg shadow-orange-200"
                                     >
                                        Registrar Lembrete
                                     </button>
                                  </td>
                               </tr>
                            )})}
                            {preventionGroups.pending.length === 0 && (
                               <tr><td colSpan={5} className="py-20 text-center text-slate-300 font-black uppercase text-[10px]">Tudo em dia! Sem novos boletos pendentes de aviso.</td></tr>
                            )}
                         </tbody>
                      </table>
                   </div>

                   {/* SEÇÃO 2: LEMBRADOS HOJE (BOTÃO AZUL) */}
                   {preventionGroups.finished.length > 0 && (
                     <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden opacity-80 hover:opacity-100 transition-opacity">
                        <div className="px-8 py-5 border-b border-slate-50 bg-emerald-50/50 flex justify-between items-center">
                           <div>
                              <h4 className="text-[11px] font-black text-emerald-700 uppercase tracking-widest italic flex items-center gap-2">
                                 <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                                 Clientes Lembrados / Avisos Enviados Hoje
                              </h4>
                              <p className="text-[9px] text-emerald-500 font-bold uppercase mt-1">Estes títulos já foram notificados por nossa equipe hoje</p>
                           </div>
                           <div className="bg-white px-4 py-2 rounded-xl border border-emerald-100 shadow-sm">
                            <span className="text-[10px] font-black text-emerald-600">{preventionGroups.finished.length} Concluídos</span>
                         </div>
                        </div>
                        <table className="w-full text-left">
                           <tbody className="divide-y divide-slate-50 text-[11px]">
                              {preventionGroups.finished.map(item => {
                                 const displayDate = item.data_vencimento.split('-').reverse().join('/');
                                 return (
                                 <tr key={item.id} className="bg-emerald-50/10 grayscale-0">
                                    <td className="px-8 py-4 font-black text-slate-400">{displayDate}</td>
                                    <td className="px-8 py-4">
                                       <p className="font-black text-slate-600 uppercase italic truncate max-w-[250px]">{item.cliente}</p>
                                       <p className="text-[9px] text-slate-400 font-bold uppercase">NF: {item.numero_documento || item.id}</p>
                                    </td>
                                    <td className="px-8 py-4 text-right font-black text-slate-500 italic">R$ {item.saldo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                                    <td className="px-8 py-4 text-right">
                                       <button 
                                          disabled
                                          className="px-6 py-2 bg-blue-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest opacity-90 shadow-md border border-blue-500"
                                       >
                                          Lembrete Enviado
                                       </button>
                                    </td>
                                 </tr>
                              )})}
                           </tbody>
                        </table>
                     </div>
                   )}
                </div>
             )}

             {activeMainTab === 'BI' && (
                <div className="space-y-8 h-full">
                   <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col h-[400px]">
                         <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-8 italic text-center">Exposição de Carteira por Faixa</h4>
                         <div className="flex-1">
                            <ResponsiveContainer width="100%" height="100%">
                               <PieChart>
                                  <Pie data={biData.ageing} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={5} dataKey="value">
                                     {biData.ageing.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                                  </Pie>
                                  <Tooltip />
                               </PieChart>
                            </ResponsiveContainer>
                         </div>
                         <div className="flex justify-center gap-6 mt-4">
                            {biData.ageing.map((entry, i) => (
                               <div key={i} className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                                  <span className="text-[9px] font-black text-slate-500 uppercase">{entry.name}</span>
                               </div>
                            ))}
                         </div>
                      </div>
                      <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col h-[400px]">
                         <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-8 italic text-center">Volume de Interações (30 dias)</h4>
                         <div className="flex-1">
                            <ResponsiveContainer width="100%" height="100%">
                               <BarChart data={biData.interactions}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} />
                                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} />
                                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }} />
                               </BarChart>
                            </ResponsiveContainer>
                         </div>
                      </div>
                   </div>
                </div>
             )}

             {activeMainTab === 'LOGS' && (
                <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col h-full overflow-hidden">
                   <div className="flex-1 overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left">
                         <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10 shadow-sm">
                            <tr>
                               <th className="px-8 py-5">Data/Registro</th>
                               <th className="px-8 py-5">Cliente</th>
                               <th className="px-8 py-5">Ação Tomada</th>
                               <th className="px-8 py-5">Observação</th>
                               <th className="px-8 py-5 text-right">Agente</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-50 text-[11px]">
                            {allLogs.filter(l => l.cliente.toLowerCase().includes(searchTerm.toLowerCase()) || l.acao_tomada.toLowerCase().includes(searchTerm.toLowerCase())).map(log => (
                               <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-8 py-5 font-black text-slate-400">{new Date(log.data_registro).toLocaleString('pt-BR')}</td>
                                  <td className="px-8 py-5 font-black text-slate-900 uppercase italic">{log.cliente}</td>
                                  <td className="px-8 py-5">
                                     <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[8px] font-black uppercase border border-blue-100">{log.acao_tomada.replace(/_/g, ' ')}</span>
                                  </td>
                                  <td className="px-8 py-5 text-slate-500 font-medium italic truncate max-w-xs" title={log.observacao}>"{log.observacao}"</td>
                                  <td className="px-8 py-5 text-right font-black text-slate-400">@{log.usuario.split('@')[0]}</td>
                               </tr>
                            ))}
                         </tbody>
                      </table>
                   </div>
                </div>
             )}

             {activeMainTab === 'ACORDOS' && (
                <div className="h-full">
                   <SettlementModule currentUser={currentUser} />
                </div>
             )}
          </div>
        </>
      ) : (
        <div className="animate-in slide-in-from-right-4 duration-500 space-y-8 flex flex-col h-full overflow-hidden">
           <div className="flex items-center justify-between border-b border-slate-200 pb-8 shrink-0">
              <div className="flex items-center gap-6">
                 <button onClick={() => setSelectedClient(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm">
                   <svg className="w-5 h-5 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                 </button>
                 <div>
                    <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">{selectedClient}</h2>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-2 italic">Dossiê CRM • Ações Rápidas</p>
                 </div>
              </div>
              
              <div className="flex gap-4">
                  <div className="bg-slate-900 px-6 py-3 rounded-xl text-white shadow-xl">
                     <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Total em Aberto</p>
                     <p className="text-xl font-black italic">R$ {clientTitles.reduce((acc, t) => acc + (t.saldo || 0), 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                  </div>
                  
                  <div className="bg-purple-900 px-6 py-3 rounded-xl text-white shadow-xl border border-purple-800">
                     <p className="text-[8px] font-black text-purple-200 uppercase mb-1">Em Acordo</p>
                     <p className="text-xl font-black italic">
                        R$ {clientTitles.filter(t => !!t.id_acordo && validSettlementIds.has(t.id_acordo)).reduce((acc, t) => acc + (t.saldo || 0), 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                     </p>
                  </div>

                  <div className="bg-red-900 px-6 py-3 rounded-xl text-white shadow-xl border border-red-800">
                     <p className="text-[8px] font-black text-red-200 uppercase mb-1">Em Cartório</p>
                     <p className="text-xl font-black italic">R$ {clientTitles.filter(t => t.situacao === 'EM CARTORIO').reduce((acc, t) => acc + (t.saldo || 0), 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                  </div>
              </div>
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 min-h-0">
              <div className="lg:col-span-7 space-y-6 flex flex-col min-h-0">
                 <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col flex-1 min-h-0">
                    <div className="flex justify-between items-center mb-6 shrink-0 h-12">
                       <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest italic">Títulos Pendentes</h4>
                       
                       {selectedForAgreement.length > 0 ? (
                          <button 
                              onClick={handleGoToAgreement} 
                              className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 animate-in zoom-in-95 flex items-center gap-2"
                          >
                              <span>Efetuar Acordo</span>
                              <span className="bg-white/20 px-1.5 py-0.5 rounded text-[8px]">{selectedForAgreement.length}</span>
                          </button>
                       ) : (
                          <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest bg-slate-50 px-3 py-1 rounded-lg border border-slate-100">
                              Selecione p/ Negociar
                          </span>
                       )}
                    </div>
                    <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar flex-1">
                       {clientTitles.map(t => {
                          const isCurrentlyInNotary = t.situacao === 'EM CARTORIO' || t.statusCobranca === 'CARTORIO' || t.statusCobranca === 'BLOQUEADO_CARTORIO';
                          const hasAgreement = !!t.id_acordo && validSettlementIds.has(t.id_acordo);
                          const isSelected = selectedForAgreement.includes(t.id);
                          const displayVenc = t.data_vencimento.split('-').reverse().join('/');
                          
                          return (
                            <div key={t.id} onClick={() => toggleTitleSelection(t)} className={`p-5 rounded-3xl border-2 transition-all cursor-pointer flex justify-between items-center group ${isSelected ? 'border-blue-600 bg-blue-50/50 shadow-md' : 'border-slate-50 bg-slate-50/30 hover:border-blue-200'}`}>
                               <div className="flex items-center gap-4">
                                  <div className={`w-6 h-6 rounded-lg border-2 transition-all flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-200 group-hover:border-blue-300 bg-white'}`}>
                                     {isSelected && <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                  </div>
                                  <div>
                                     <div className="flex items-center gap-2 mb-1">
                                        <p className="font-black text-slate-800 text-[11px] uppercase">NF: {t.numero_documento || t.id}</p>
                                        {isCurrentlyInNotary && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tighter">EM CARTÓRIO</span>}
                                        {hasAgreement && <span className="bg-purple-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tighter">EM ACORDO</span>}
                                     </div>
                                     <p className="text-[9px] font-bold text-slate-400 uppercase">Venc: {displayVenc} • BOLETO</p>
                                  </div>
                               </div>
                               <div className="text-right">
                                  <p className={`font-black text-sm italic ${hasAgreement ? 'text-purple-600' : 'text-red-600'}`}>R$ {(t.valor_documento || t.saldo).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                                  <p className="text-[8px] font-black text-slate-400 uppercase">{calculateDaysOverdue(t.data_vencimento)} Dias em atraso</p>
                               </div>
                            </div>
                          );
                       })}
                    </div>
                    <div className="mt-4 border-t border-slate-50"></div>
                 </div>
              </div>

              <div className="lg:col-span-5 space-y-6 flex flex-col min-h-0">
                 <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm shrink-0">
                    <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest mb-6 italic">Ações Rápidas CRM</h4>
                    {!activeQuickAction ? (
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => setActiveQuickAction('AGENDAR')} className="flex flex-col items-center justify-center h-28 p-4 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-[1.5rem] hover:bg-emerald-100 transition-all group active:scale-95">
                                <svg className="w-7 h-7 mb-2 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                <span className="text-[9px] font-black uppercase text-center">Agendar Pagto</span>
                            </button>
                            <button onClick={() => setActiveQuickAction('RETORNO')} className="flex flex-col items-center justify-center h-28 p-4 bg-blue-50 text-blue-700 border border-blue-100 rounded-[1.5rem] hover:bg-blue-100 transition-all group active:scale-95">
                                <svg className="w-7 h-7 mb-2 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                                <span className="text-[9px] font-black uppercase text-center">Agendar Retorno</span>
                            </button>
                            <button onClick={() => handleSimpleLog('TENTATIVA', 'TENTATIVA DE CONTATO SEM SUCESSO')} className="flex flex-col items-center justify-center h-28 p-4 bg-amber-50 text-amber-700 border border-amber-100 rounded-[1.5rem] hover:bg-amber-100 transition-all group active:scale-95">
                                <svg className="w-7 h-7 mb-2 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" /></svg>
                                <span className="text-[9px] font-black uppercase text-center">Sem Retorno</span>
                            </button>
                            <button 
                                onClick={() => setActiveQuickAction(isNotaryRemovalMode ? 'CARTORIO_OUT' : 'CARTORIO_IN')} 
                                disabled={selectedForAgreement.length === 0}
                                className={`flex flex-col items-center justify-center h-28 p-4 rounded-[1.5rem] transition-all group active:scale-95 shadow-md border ${
                                    selectedForAgreement.length === 0 ? 'opacity-50 cursor-not-allowed bg-gray-100 text-gray-400 border-gray-200' :
                                    isNotaryRemovalMode 
                                        ? 'bg-white border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300' 
                                        : 'bg-slate-950 text-white border-slate-800 hover:bg-slate-800'
                                }`}
                            >
                                <svg className="w-7 h-7 mb-2 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>
                                <span className="text-[9px] font-black uppercase text-center">
                                    {isNotaryRemovalMode ? 'Retirar do Cartório' : 'Incluir Cartório'}
                                </span>
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                            <div className="flex justify-between items-center mb-2">
                                <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest">{activeQuickAction.replace('_', ' ')}</p>
                                <button onClick={() => setActiveQuickAction(null)} className="text-[9px] font-black text-slate-400 uppercase hover:text-red-500">Cancelar</button>
                            </div>
                            {(activeQuickAction === 'AGENDAR' || activeQuickAction === 'RETORNO') && (
                                <div className="space-y-4">
                                    <input type="date" value={quickActionData.date} onChange={e => setQuickActionData({...quickActionData, date: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs outline-none" />
                                    <textarea value={quickActionData.obs} onChange={e => setQuickActionData({...quickActionData, obs: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs outline-none resize-none uppercase" rows={2} placeholder="OBSERVAÇÃO..." />
                                    <button onClick={() => handleSimpleLog(activeQuickAction === 'AGENDAR' ? 'PROMESSA_PAGTO' : 'RECONTATO_AGENDADO', quickActionData.obs || 'Agendamento via CRM', quickActionData.date)} disabled={!quickActionData.date || isSubmittingInteraction} className="w-full py-5 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg hover:bg-blue-600 transition-all italic">Confirmar Agendamento</button>
                                </div>
                            )}
                            {(activeQuickAction === 'CARTORIO_IN' || activeQuickAction === 'CARTORIO_OUT') && (
                                <div className="space-y-6">
                                    <button onClick={handleNotaryActionExec} disabled={selectedForAgreement.length === 0 || isSubmittingInteraction} className="w-full py-6 bg-emerald-600 text-white rounded-[1.5rem] font-black text-[11px] uppercase shadow-xl hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 italic">
                                        {activeQuickAction === 'CARTORIO_IN' ? 'Confirmar INCLUSÃO' : 'Confirmar RETIRADA'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                 </div>

                 <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex-1 flex flex-col min-h-0 overflow-hidden">
                    <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest mb-6 italic shrink-0">Histórico de Cobrança</h4>
                    <div className="space-y-6 overflow-y-auto pr-2 custom-scrollbar flex-1">
                       {clientHistory.map(log => (
                          <div key={log.id} className="relative pl-6 border-l-2 border-slate-100 pb-2">
                             <div className="absolute left-[-5px] top-0 w-2 h-2 rounded-full bg-blue-600"></div>
                             <div className="flex justify-between items-start mb-1">
                                <span className="text-[8px] font-black text-blue-600 uppercase bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{log.acao_tomada.replace(/_/g, ' ')}</span>
                                <span className="text-[8px] font-bold text-slate-400 uppercase">{new Date(log.data_registro).toLocaleDateString('pt-BR')}</span>
                             </div>
                             <p className="text-[10px] font-bold text-slate-700 uppercase italic leading-relaxed">"{log.observacao}"</p>
                             <div className="mt-2 flex items-center justify-between opacity-50">
                                <span className="text-[8px] font-black text-slate-400 uppercase">Agente: @{log.usuario.split('@')[0]}</span>
                             </div>
                          </div>
                       ))}
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default DebtorCollectionModule;
