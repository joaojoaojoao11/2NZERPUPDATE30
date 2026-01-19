
import React, { useState, useMemo, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { FinanceService } from '../services/financeService';
import { DebtorInfo, User, AccountsReceivable, CollectionHistory, Settlement } from '../types';
import { ICONS } from '../constants';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import Toast from './Toast';
import SettlementModule from './SettlementModule';

type MainTab = 'CARTEIRA' | 'ACORDOS' | 'LEMBRETES' | 'LOGS' | 'BI';
type QuickAction = 'AGENDAR' | 'RETORNO' | 'CARTORIO_IN' | 'CARTORIO_OUT' | null;

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

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

  // Estado local para controlar lembretes enviados na sessão
  const [sentReminders, setSentReminders] = useState<string[]>([]);

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

  const handleManageClient = async (cliente: string) => {
    setLoading(true);
    setSelectedClient(cliente);
    setActiveQuickAction(null);
    setSelectedForAgreement([]);
    setViewMode('CRM');
    try {
      const arData = await FinanceService.getAccountsReceivable();
      const historyData = await FinanceService.getCollectionHistoryByClient(cliente);
      
      const today = new Date().toISOString().split('T')[0];
      const filtered = arData.filter(t => {
        const situacao = (t.situacao || '').toUpperCase().trim();
        const formaPgto = (t.forma_pagamento || '').toUpperCase().trim();
        const vencimento = t.data_vencimento;
        const isBoleto = formaPgto === 'BOLETO';
        const situacoesExibiveis = ['EM ABERTO', 'ABERTO', 'EM CARTORIO', 'NEGOCIADO', 'VENCIDO', 'VENCIDA'];
        const isCobravelStatus = situacoesExibiveis.includes(situacao);
        const hasAgreement = !!t.id_acordo;

        return (
          t.cliente === cliente && 
          isBoleto &&
          isCobravelStatus &&
          (vencimento < today || hasAgreement || situacao === 'EM CARTORIO') && 
          (t.saldo > 0.01 || hasAgreement)
        );
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
    const due = new Date(dueDateStr);
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
            handleManageClient(selectedClient);
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

  // Fix: Adicionado o handler para transição para o módulo de acordos
  const handleGoToAgreement = () => {
    setViewMode('SETTLEMENT');
  };

  const handleSendReminderAction = async (title: AccountsReceivable) => {
    // Adiciona log de lembrete
    try {
        await FinanceService.addCollectionHistory({
            cliente: title.cliente,
            acao_tomada: 'LEMBRETE_VENCIMENTO',
            observacao: `LEMBRETE ENVIADO: TÍTULO ${title.numero_documento} VENCE EM ${new Date(title.data_vencimento).toLocaleDateString()}`,
            valor_devido: title.saldo,
            dias_atraso: 0,
            usuario: currentUser.name
        });
        setSentReminders(prev => [...prev, title.id]);
        setToast({ msg: 'Lembrete registrado!', type: 'success' });
    } catch (e) {
        setToast({ msg: 'Erro ao registrar lembrete.', type: 'error' });
    }
  };

  // --- LOGICA BI COBRANÇA ---
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

  // --- LOGICA LEMBRETES (VENCENDO EM 0, 1, 2, 3 DIAS) ---
  const reminderTitles = useMemo(() => {
    const today = new Date();
    today.setHours(0,0,0,0);

    const filtered = allAR.filter(t => {
        // Filtrar apenas títulos em aberto
        const situacao = (t.situacao || '').toUpperCase();
        const isAberto = situacao === 'EM ABERTO' || situacao === 'ABERTO';
        if (!isAberto || t.saldo <= 0.01) return false;

        // Calcular dias até o vencimento
        const dueDate = new Date(t.data_vencimento);
        // Ajuste de fuso horário simples para comparação de datas
        const diffTime = dueDate.getTime() - today.getTime();
        // Diferença em dias (arredondado)
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Queremos: 0 (Hoje), 1, 2 ou 3 dias
        return diffDays >= 0 && diffDays <= 3;
    });

    // Separa em Pendentes e Enviados
    const pending = filtered.filter(t => !sentReminders.includes(t.id));
    const sent = filtered.filter(t => sentReminders.includes(t.id));

    // Ordenar por vencimento (mais urgente primeiro)
    pending.sort((a, b) => new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime());
    sent.sort((a, b) => new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime());

    return { pending, sent };
  }, [allAR, sentReminders]);

  const getDaysLabel = (dateStr: string) => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const due = new Date(dateStr);
    due.setHours(0,0,0,0); // Normaliza para comparar datas cheias
    // Use getTime para evitar problemas de fuso horário
    const diffMs = due.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return { text: 'VENCE HOJE', color: 'bg-red-500 text-white' };
    if (diffDays === 1) return { text: 'AMANHÃ', color: 'bg-amber-500 text-white' };
    return { text: `EM ${diffDays} DIAS`, color: 'bg-blue-500 text-white' };
  };

  if (loading && !selectedClient) return <div className="py-24 text-center opacity-30 font-black uppercase text-xs animate-pulse">Sincronizando Carteira...</div>;

  if (viewMode === 'SETTLEMENT' && selectedClient) {
    return <SettlementModule currentUser={currentUser} initialClient={selectedClient} initialTitles={selectedForAgreement} onBack={() => { setViewMode('CRM'); handleManageClient(selectedClient); }} />;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10 flex flex-col h-full">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      {!selectedClient ? (
        <>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 shrink-0">
            <div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Gestão de Cobrança</h2>
              <div className="flex flex-wrap gap-2 mt-4">
                 {[
                   { id: 'CARTEIRA', label: 'Carteira em Atraso' },
                   { id: 'ACORDOS', label: 'Gestão de Acordos' },
                   { id: 'LEMBRETES', label: 'Lembretes' },
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
                <div className="space-y-4 overflow-y-auto pr-2 custom-scrollbar">
                   <p className="text-[10px] font-black text-red-500 uppercase tracking-widest italic flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                      Prioridade: A Cobrar / Atrasados
                   </p>
                   {debtors.filter(d => d.cliente.toLowerCase().includes(searchTerm.toLowerCase())).map(d => (
                      <div key={d.cliente} className="bg-white border border-slate-100 p-6 rounded-[2.5rem] shadow-sm hover:border-blue-300 transition-all group flex flex-col xl:flex-row justify-between items-center gap-6">
                         <div className="flex-1 w-full">
                            <div className="flex items-center gap-3 mb-1">
                               <h3 className="font-black text-slate-900 uppercase italic text-lg tracking-tight">{d.cliente}</h3>
                               {d.vencidoMais15d > 0 && <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded text-[7px] font-black uppercase tracking-widest border border-red-100">Risco Alto</span>}
                            </div>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{d.qtdTitulos} Títulos em aberto</p>
                         </div>
                         <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center items-center w-full xl:w-auto">
                            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 min-w-[110px]"><p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Total</p><p className="text-sm font-black text-slate-900 italic">R$ {d.totalVencido.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                            <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100 min-w-[110px]"><p className="text-[7px] font-black text-amber-600 uppercase tracking-widest mb-1">0 a 15 Dias</p><p className="text-sm font-black text-amber-700 italic">R$ {d.vencidoAte15d.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                            <div className="bg-red-50 p-3 rounded-2xl border border-red-100 min-w-[110px]"><p className="text-[7px] font-black text-red-600 uppercase tracking-widest mb-1">15+ Dias</p><p className="text-sm font-black text-red-700 italic">R$ {d.vencidoMais15d.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                            <div className="bg-slate-900 p-3 rounded-2xl text-white min-w-[110px]"><p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Em Cartório</p><p className="text-sm font-black italic text-white">R$ {d.enviarCartorio.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                            <button onClick={() => handleManageClient(d.cliente)} className="px-6 py-4 bg-blue-600 text-white rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg italic h-full">Gerenciar</button>
                         </div>
                      </div>
                   ))}
                </div>
             )}

             {activeMainTab === 'LEMBRETES' && (
                <div className="space-y-8 overflow-y-auto pr-2 custom-scrollbar h-full">
                   <div className="flex items-center gap-3 bg-blue-50 p-4 rounded-2xl border border-blue-100">
                      <ICONS.Alert className="w-5 h-5 text-blue-600" />
                      <p className="text-[10px] font-black text-blue-800 uppercase tracking-wide">
                         Títulos vencendo em até 3 dias. Clique em "Lembrar" para registrar o contato preventivo.
                      </p>
                   </div>

                   {/* PENDENTES */}
                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {reminderTitles.pending.map(t => {
                         const status = getDaysLabel(t.data_vencimento);
                         return (
                            <div key={t.id} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative group overflow-hidden hover:border-blue-300 transition-all">
                               <div className="flex justify-between items-start mb-4">
                                  <span className={`px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest shadow-sm ${status.color}`}>
                                     {status.text}
                                  </span>
                                  <span className="text-[9px] font-black text-slate-300 uppercase">NF: {t.numero_documento}</span>
                               </div>
                               <h4 className="font-black text-slate-900 uppercase italic text-lg truncate mb-1" title={t.cliente}>{t.cliente}</h4>
                               <p className="text-xl font-black text-slate-700 italic tracking-tighter mb-4">
                                  R$ {t.saldo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                               </p>
                               <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 mb-4 flex justify-between items-center">
                                  <span className="text-[9px] font-bold text-slate-400 uppercase">Vencimento</span>
                                  <span className="text-[10px] font-black text-slate-900">{new Date(t.data_vencimento).toLocaleDateString('pt-BR')}</span>
                               </div>
                               <button 
                                  onClick={() => handleSendReminderAction(t)} 
                                  className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase tracking-[0.2em] hover:bg-blue-600 transition-all shadow-lg flex items-center justify-center gap-2"
                               >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                                  Lembrar
                               </button>
                            </div>
                         );
                      })}
                   </div>

                   {reminderTitles.pending.length === 0 && (
                      <div className="py-12 text-center opacity-30 font-black uppercase text-[10px] italic">Nenhum título próximo do vencimento pendente de aviso</div>
                   )}

                   {/* ENVIADOS (Descem para cá) */}
                   {reminderTitles.sent.length > 0 && (
                      <div className="pt-8 border-t border-slate-100 opacity-60">
                         <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Enviados Recentemente</h4>
                         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {reminderTitles.sent.map(t => (
                               <div key={t.id} className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 relative grayscale transition-all hover:grayscale-0">
                                  <div className="flex justify-between items-start mb-2">
                                     <span className="bg-emerald-100 text-emerald-600 px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest">
                                        ENVIADO
                                     </span>
                                     <span className="text-[9px] font-black text-slate-300 uppercase">NF: {t.numero_documento}</span>
                                  </div>
                                  <h4 className="font-black text-slate-700 uppercase italic text-sm truncate mb-1">{t.cliente}</h4>
                                  <p className="text-sm font-black text-slate-500 italic">R$ {t.saldo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                               </div>
                            ))}
                         </div>
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
        /* --- DOSSIÊ DO CLIENTE (MANTIDO E MELHORADO) --- */
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
              <div className="bg-slate-900 px-6 py-3 rounded-xl text-white shadow-xl">
                 <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Total em Aberto</p>
                 <p className="text-xl font-black italic">R$ {clientTitles.reduce((acc, t) => acc + (t.saldo || 0), 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
              </div>
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 min-h-0">
              {/* COLUNA ESQUERDA: LISTA DE TÍTULOS */}
              <div className="lg:col-span-7 space-y-6 flex flex-col min-h-0">
                 <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col flex-1 min-h-0">
                    <div className="flex justify-between items-center mb-6 shrink-0">
                       <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest italic">Títulos Pendentes</h4>
                       {selectedForAgreement.length > 0 && <span className="bg-blue-600 text-white px-4 py-1 rounded-xl text-[9px] font-black uppercase shadow-lg shadow-blue-100">{selectedForAgreement.length} selecionados</span>}
                    </div>
                    <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar flex-1">
                       {clientTitles.map(t => {
                          const isCurrentlyInNotary = t.situacao === 'EM CARTORIO';
                          const hasAgreement = !!t.id_acordo;
                          const isSelected = selectedForAgreement.includes(t.id);
                          
                          return (
                            <div key={t.id} onClick={() => toggleTitleSelection(t)} className={`p-5 rounded-3xl border-2 transition-all cursor-pointer flex justify-between items-center group ${isSelected ? 'border-blue-600 bg-blue-50/50 shadow-md' : 'border-slate-50 bg-slate-50/30 hover:border-blue-200'}`}>
                               <div className="flex items-center gap-4">
                                  <div className={`w-6 h-6 rounded-lg border-2 transition-all flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-200 group-hover:border-blue-300 bg-white'}`}>
                                     {isSelected && <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                  </div>
                                  <div>
                                     <p className="font-black text-slate-800 text-[11px] uppercase flex items-center gap-2">
                                        NF: {t.numero_documento || t.id}
                                        {isCurrentlyInNotary && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tighter">EM CARTÓRIO</span>}
                                        {hasAgreement && <span className="bg-purple-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tighter">EM ACORDO</span>}
                                     </p>
                                     <p className="text-[9px] font-bold text-slate-400 uppercase">Venc: {new Date(t.data_vencimento).toLocaleDateString('pt-BR')} • BOLETO</p>
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
                    <div className="mt-8 pt-8 border-t border-slate-100 flex justify-between items-center shrink-0">
                       <button onClick={handleGoToAgreement} disabled={selectedForAgreement.length === 0} className="px-10 py-5 bg-blue-600 text-white rounded-[1.5rem] font-black text-[10px] uppercase shadow-xl hover:bg-blue-700 disabled:opacity-20 transition-all italic active:scale-95">Ir para Mesa de Acordo →</button>
                    </div>
                 </div>
              </div>

              {/* COLUNA DIREITA: AÇÕES RÁPIDAS CRM */}
              <div className="lg:col-span-5 space-y-6 flex flex-col min-h-0">
                 <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm shrink-0">
                    <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest mb-6 italic">Ações Rápidas CRM</h4>
                    {!activeQuickAction ? (
                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={() => setActiveQuickAction('AGENDAR')} className="flex flex-col items-center justify-center p-6 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-[1.5rem] hover:bg-emerald-100 transition-all group">
                                <svg className="w-8 h-8 mb-2 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2" strokeWidth="2.5"/></svg>
                                <span className="text-[10px] font-black uppercase">Agendar Pagto</span>
                            </button>
                            <button onClick={() => setActiveQuickAction('RETORNO')} className="flex flex-col items-center justify-center p-6 bg-blue-50 text-blue-700 border border-blue-100 rounded-[1.5rem] hover:bg-blue-100 transition-all group">
                                <svg className="w-8 h-8 mb-2 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684" strokeWidth="2.5"/></svg>
                                <span className="text-[10px] font-black uppercase">Agendar Retorno</span>
                            </button>
                            <button onClick={() => handleSimpleLog('TENTATIVA', 'TENTATIVA DE CONTATO SEM SUCESSO')} className="flex flex-col items-center justify-center p-6 bg-amber-50 text-amber-700 border border-amber-100 rounded-[1.5rem] hover:bg-amber-100 transition-all group">
                                <svg className="w-8 h-8 mb-2 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M18.364 5.636l-3.536 3.536" strokeWidth="2.5"/></svg>
                                <span className="text-[10px] font-black uppercase">Sem Retorno</span>
                            </button>
                            <button onClick={() => setActiveQuickAction('CARTORIO_IN')} className="flex flex-col items-center justify-center p-6 bg-slate-950 text-white rounded-[1.5rem] hover:bg-slate-900 border border-slate-800 transition-all group">
                                <svg className="w-8 h-8 mb-2 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 6l3 1m0 0l-3 9" strokeWidth="2.5"/></svg>
                                <span className="text-[10px] font-black uppercase">Incluir Cartório</span>
                            </button>
                            <button onClick={() => setActiveQuickAction('CARTORIO_OUT')} className="col-span-2 py-4 mt-2 bg-white border-2 border-slate-100 text-slate-400 font-black text-[10px] uppercase rounded-xl hover:text-blue-600 transition-all italic">Retirar do Cartório</button>
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
                                    <button onClick={handleNotaryActionExec} disabled={selectedForAgreement.length === 0 || isSubmittingInteraction} className="w-full py-6 bg-emerald-600 text-white rounded-[1.5rem] font-black text-[11px] uppercase shadow-xl hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 italic">Confirmar Operação Cartório</button>
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
