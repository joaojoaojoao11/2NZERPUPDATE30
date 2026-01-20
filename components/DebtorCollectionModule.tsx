
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

  // Lista de IDs de acordos válidos para filtragem
  const [validSettlementIds, setValidSettlementIds] = useState<Set<string>>(new Set());

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
      const [arData, historyData, settlementsData] = await Promise.all([
        FinanceService.getAccountsReceivable(),
        FinanceService.getCollectionHistoryByClient(cliente),
        FinanceService.getSettlements()
      ]);
      
      // CRITICAL FIX: Filtrar apenas acordos que NÃO estão cancelados
      const validIds = new Set(settlementsData.filter(s => s.status !== 'CANCELADO').map(s => s.id));
      setValidSettlementIds(validIds);

      const today = new Date().toISOString().split('T')[0];
      const filtered = arData.filter(t => {
        const situacao = (t.situacao || '').toUpperCase().trim();
        const formaPgto = (t.forma_pagamento || '').toUpperCase().trim();
        const vencimento = t.data_vencimento;
        
        // 1. Filtro Base: Cliente
        if (t.cliente !== cliente) return false;
        
        // Validação Estrita de Acordo
        const hasValidAgreement = !!t.id_acordo && validIds.has(t.id_acordo);
        // Título Órfão: Tem ID de acordo, mas o acordo não existe ou foi cancelado
        const isOrphaned = !!t.id_acordo && !hasValidAgreement;
        
        // Se NÃO tiver acordo válido, exige BOLETO. Se tiver, aceita qualquer forma.
        // Se for órfão (acordo cancelado), volta a ser tratado como pendência (deve aparecer)
        if (formaPgto !== 'BOLETO' && !hasValidAgreement && !isOrphaned) return false;

        const isCartorio = situacao === 'EM CARTORIO' || t.statusCobranca === 'CARTORIO' || t.statusCobranca === 'BLOQUEADO_CARTORIO';

        // 2. Filtro de Saldo: Deve ter saldo positivo OU ser um acordo
        if (t.saldo <= 0.01 && !hasValidAgreement) return false;

        // 3. Regras de Exibição:
        // Caso A: Títulos já em gestão (Acordo Válido ou Cartório)
        if (hasValidAgreement || isCartorio) return true;

        // Caso B: Títulos "Soltos" OU "Órfãos" (Acordo Cancelado)
        // Se for órfão e a situação ainda for 'NEGOCIADO', forçamos a exibição
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

        // --- ATUALIZAÇÃO AUTOMÁTICA DE LISTA ---
        // Se houve ação, move para "Em Dia / Agendados" visualmente
        // Se não foi passada data, assume que está resolvido por hoje (joga para amanhã)
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
            
            // Atualiza a vista detalhada para refletir o status imediatamente
            await handleManageClient(selectedClient);
            // Atualiza a lista principal para que o card de resumo "Em Cartório" esteja correto
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

  // --- LÓGICA DE BOTÃO DINÂMICO DE CARTÓRIO ---
  const isNotaryRemovalMode = useMemo(() => {
    if (selectedForAgreement.length === 0) return false;
    const selectedItems = clientTitles.filter(t => selectedForAgreement.includes(t.id));
    
    // Se todos os selecionados estiverem em cartório (seja por 'situacao' ou 'statusCobranca'), o modo é REMOVER
    return selectedItems.length > 0 && selectedItems.every(t => 
        t.situacao === 'EM CARTORIO' || 
        t.statusCobranca === 'CARTORIO' || 
        t.statusCobranca === 'BLOQUEADO_CARTORIO'
    );
  }, [selectedForAgreement, clientTitles]);

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
    today.setHours(0, 0, 0, 0); // Define hoje 00:00:00

    // Data limite (Hoje + 3 dias)
    const limitDate = new Date(today);
    limitDate.setDate(today.getDate() + 3);
    limitDate.setHours(23, 59, 59, 999); // Final do 3º dia

    const filtered = allAR.filter(t => {
        // Filtrar apenas títulos em aberto
        const situacao = (t.situacao || '').toUpperCase();
        const isAberto = situacao === 'EM ABERTO' || situacao === 'ABERTO';
        if (!isAberto || t.saldo <= 0.01) return false;
        
        // Filtrar apenas BOLETO
        const forma = (t.forma_pagamento || '').toUpperCase();
        if (!forma.includes('BOLETO')) return false;

        if (!t.data_vencimento) return false;

        // Parse Manual da Data (YYYY-MM-DD) para evitar problemas de fuso horário
        const [y, m, d] = t.data_vencimento.split('-').map(Number);
        const dueDate = new Date(y, m - 1, d); // 00:00:00 local
        
        // 1. Excluir Passado (Estritamente menor que hoje)
        if (dueDate.getTime() < today.getTime()) return false;

        // 2. Incluir apenas até o limite de 3 dias
        if (dueDate.getTime() > limitDate.getTime()) return false;

        return true;
    });

    // Separa em Pendentes e Enviados
    const pending = filtered.filter(t => !sentReminders.includes(t.id));
    const sent = filtered.filter(t => sentReminders.includes(t.id));

    // Ordenar por vencimento (mais urgente primeiro)
    pending.sort((a, b) => new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime());
    sent.sort((a, b) => new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime());

    return { pending, sent };
  }, [allAR, sentReminders]);

  // --- PREPARAÇÃO DAS LISTAS PRIORITÁRIAS E EM DIA ---
  const { priorityList, upToDateList } = useMemo(() => {
    const filteredDebtors = debtors.filter(d => d.cliente.toLowerCase().includes(searchTerm.toLowerCase()));
    const todayStr = new Date().toISOString().split('T')[0];

    const priority: DebtorInfo[] = [];
    const upToDate: DebtorInfo[] = [];

    filteredDebtors.forEach(d => {
        // Lógica de Risco: 
        // 1. Tem dívida "solta" vencida (totalVencido > 0)
        // 2. OU tem parcela de acordo vencida (acordoAtrasado > 0)
        const hasArrears = d.totalVencido > 0.01 || (d.acordoAtrasado || 0) > 0.01;
        
        // Lógica de Data de Ação:
        // Está vencido o prazo de contato?
        const isActionDue = !d.nextActionDate || d.nextActionDate <= todayStr;

        // Regra de Ouro:
        // Se NÃO tem pendências (hasArrears == false), vai para "Em Dia / Agendados" automaticamente (mesmo que a data de ação tenha passado, pois não há o que cobrar urgentemente).
        // Se TEM pendências (hasArrears == true), vai para "Prioridade" SE a data de ação chegou.
        // Se TEM pendências mas a data é futura (ex: agendou para semana que vem), fica em "Em Dia / Agendados" (temporariamente sob controle).

        if (hasArrears && isActionDue) {
            priority.push(d);
        } else {
            upToDate.push(d);
        }
    });

    // Ordenação interna
    priority.sort((a, b) => b.totalVencido - a.totalVencido);
    upToDate.sort((a, b) => b.totalVencido - a.totalVencido);

    return { priorityList: priority, upToDateList: upToDate };
  }, [debtors, searchTerm]);

  const getDaysLabel = (dateStr: string) => {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    // Parse manual para evitar problemas de fuso horário
    const [y, m, d] = dateStr.split('-').map(Number);
    const due = new Date(y, m - 1, d); // 00:00:00 local
    
    // Calcula a diferença em milissegundos
    const diffMs = due.getTime() - today.getTime();
    
    // Calcula a diferença em dias de forma precisa
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return { text: 'VENCE HOJE', color: 'bg-red-500 text-white' };
    if (diffDays === 1) return { text: 'AMANHÃ', color: 'bg-amber-500 text-white' };
    if (diffDays < 0) return { text: 'VENCIDO', color: 'bg-gray-700 text-white' }; // Fallback de segurança
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
                <div className="space-y-8 overflow-y-auto pr-2 custom-scrollbar">
                   
                   {/* SEÇÃO 1: PRIORIDADE */}
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

                   {/* SEÇÃO 2: EM DIA / AGENDADOS */}
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
                                                 Retorno: {d.nextActionDate ? new Date(d.nextActionDate).toLocaleDateString('pt-BR') : '-'}
                                              </span>
                                           )}
                                        </div>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{d.qtdTitulos} Títulos sob gestão</p>
                                     </div>
                                     <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-center items-center w-full xl:w-auto">
                                        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 min-w-[110px]"><p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Total</p><p className="text-sm font-black text-slate-900 italic">R$ {d.totalVencido.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
                                        <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100 min-w-[110px]"><p className="text-[7px] font-black text-amber-600 uppercase tracking-widest mb-1">0 a 15 Dias</p><p className="text-sm font-black text-amber-700 italic">R$ {d.vencidoAte15d.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p></div>
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
           {/* ... (Conteúdo do Dossiê mantido sem alterações na lógica, apenas visualização) ... */}
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
                  
                  {/* NOVO CARD: Em Acordo - Soma dinâmica com validação */}
                  <div className="bg-purple-900 px-6 py-3 rounded-xl text-white shadow-xl border border-purple-800">
                     <p className="text-[8px] font-black text-purple-200 uppercase mb-1">Em Acordo</p>
                     <p className="text-xl font-black italic">
                        R$ {clientTitles.filter(t => !!t.id_acordo && validSettlementIds.has(t.id_acordo)).reduce((acc, t) => acc + (t.saldo || 0), 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                     </p>
                  </div>

                  {/* CARD: Em Cartório - Soma dinâmica */}
                  <div className="bg-red-900 px-6 py-3 rounded-xl text-white shadow-xl border border-red-800">
                     <p className="text-[8px] font-black text-red-200 uppercase mb-1">Em Cartório</p>
                     <p className="text-xl font-black italic">R$ {clientTitles.filter(t => t.situacao === 'EM CARTORIO').reduce((acc, t) => acc + (t.saldo || 0), 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                  </div>
              </div>
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 min-h-0">
              {/* COLUNA ESQUERDA: LISTA DE TÍTULOS */}
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
                    {/* FOOTER REMOVIDO PARA LIMPEZA VISUAL (Botão movido para o topo) */}
                    <div className="mt-4 border-t border-slate-50"></div>
                 </div>
              </div>

              {/* COLUNA DIREITA: AÇÕES RÁPIDAS CRM */}
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
