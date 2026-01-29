
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DataService } from '../services/dataService';
import { CRMOpportunity, CRMStatus, User, CRMInteraction } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import SocialCard from './crm/SocialCard';
import { AIAssistant } from './crm/AIAssistant';

interface CRMModuleProps {
    user: User;
}

const COLUMNS: { id: CRMStatus; label: string; color: string; headerColor: string; icon: any }[] = [
    { id: 'PROSPECCAO', label: 'Prospecção', color: 'bg-slate-50', headerColor: 'border-slate-300 text-slate-600', icon: ICONS.Search },
    { id: 'QUALIFICADO', label: 'Qualificado', color: 'bg-blue-50/30', headerColor: 'border-blue-300 text-blue-600', icon: ICONS.Chart },
    { id: 'NEGOCIACAO', label: 'Negociação', color: 'bg-amber-50/30', headerColor: 'border-amber-300 text-amber-600', icon: ICONS.Inventory },
    { id: 'GANHO', label: 'Ganho', color: 'bg-emerald-50/30', headerColor: 'border-emerald-300 text-emerald-600', icon: ICONS.Finance },
    { id: 'PERDIDO', label: 'Perdido', color: 'bg-red-50/30', headerColor: 'border-red-300 text-red-600', icon: ICONS.Alert },
];

const CRMModule: React.FC<CRMModuleProps> = ({ user }) => {
    // --- STATE: GERAL ---
    const [viewMode, setViewMode] = useState<'KANBAN' | 'FEED'>('KANBAN');
    const [loading, setLoading] = useState(true);
    const [opportunities, setOpportunities] = useState<CRMOpportunity[]>([]);
    const [globalFeed, setGlobalFeed] = useState<any[]>([]);
    const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
    const [systemUsers, setSystemUsers] = useState<User[]>([]); // <<< NOVO ESTADO

    // --- STATE: KANBAN ---
    const [filterMode, setFilterMode] = useState<'ALL' | 'MINE'>('ALL');

    // --- STATE: MODAL & INTERAÇÕES ---
    const [selectedOpp, setSelectedOpp] = useState<CRMOpportunity | null>(null); // Se null, modal fechado
    const [oppInteractions, setOppInteractions] = useState<CRMInteraction[]>([]);
    const [newInteractionText, setNewInteractionText] = useState('');
    const [isSavingInteraction, setIsSavingInteraction] = useState(false);
    const [isSavingOpp, setIsSavingOpp] = useState(false);

    // Ref para scroll do feed
    const feedScrollRef = useRef<HTMLDivElement>(null);

    // --- FETCH DATA ---
    const fetchData = async () => {
        setLoading(true);
        try {
            if (viewMode === 'KANBAN') {
                const data = await DataService.getCRMOpportunities();
                setOpportunities(data);
            } else {
                const feed = await DataService.getGlobalCRMFeed();
                setGlobalFeed(feed);
            }
        } catch (e) {
            console.error(e);
            setToast({ msg: 'Erro ao carregar dados do CRM.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [viewMode]);

    // <<< NOVO USEEFFECT PARA BUSCAR USUÁRIOS DO SISTEMA >>>
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const users = await DataService.getUsers();
                setSystemUsers(users.filter(u => u.active)); // Filtra apenas usuários ativos
            } catch (e) {
                console.error("Falha ao buscar usuários do sistema:", e);
                setToast({ msg: 'Não foi possível carregar a lista de vendedores.', type: 'error' });
            }
        };
        fetchUsers();
    }, []); // Roda apenas uma vez na montagem do componente

    // --- HANDLERS KANBAN ---

    const filteredOpportunities = useMemo(() => {
        let list = opportunities;
        if (filterMode === 'MINE') {
            const myName = user.name.toUpperCase();
            list = list.filter(o =>
                (o.attendant && o.attendant.toUpperCase() === myName) ||
                (o.prospector && o.prospector.toUpperCase() === myName)
            );
        }
        return list;
    }, [opportunities, filterMode, user.name]);

    // --- HANDLERS MODAL ---

    const handleOpenCard = async (opp: CRMOpportunity | 'NEW') => {
        if (opp === 'NEW') {
            setSelectedOpp({
                clientName: '',
                status: 'PROSPECCAO',
                prospector: user.name
            } as CRMOpportunity);
            setOppInteractions([]);
        } else {
            setSelectedOpp({ ...opp }); // Clone para edição
            // Carrega interações
            try {
                const interactions = await DataService.getCRMInteractions(opp.id!);
                setOppInteractions(interactions);
            } catch (e) { console.error(e); }
        }
    };

    const handleSaveOpp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedOpp?.clientName) return setToast({ msg: 'Nome do cliente obrigatório', type: 'error' });

        setIsSavingOpp(true);
        try {
            const res = await DataService.saveCRMOpportunity(selectedOpp);
            if (res.success) {
                setToast({ msg: 'Dados salvos com sucesso!', type: 'success' });
                // Atualiza lista em background
                const data = await DataService.getCRMOpportunities();
                setOpportunities(data);
                // Fecha o modal após o sucesso
                setSelectedOpp(null);
            } else {
                setToast({ msg: res.message || 'Falha ao salvar oportunidade.', type: 'error' });
            }
        } catch (e: any) {
            setToast({ msg: (e as Error).message || 'Erro de conexão ao salvar.', type: 'error' });
        } finally {
            setIsSavingOpp(false);
        }
    };

    const handlePostInteraction = async () => {
        if (!selectedOpp?.id) return setToast({ msg: 'Salve o card antes de comentar.', type: 'error' });
        if (!newInteractionText.trim()) return;

        setIsSavingInteraction(true);
        try {
            const success = await DataService.saveCRMInteraction(selectedOpp.id, user.name, newInteractionText);
            if (success) {
                setNewInteractionText('');
                // Recarrega feed local
                const updated = await DataService.getCRMInteractions(selectedOpp.id);
                setOppInteractions(updated);
            }
        } catch (e) {
            setToast({ msg: 'Erro ao postar nota.', type: 'error' });
        } finally {
            setIsSavingInteraction(false);
        }
    };

    const handleMoveCard = async (opp: CRMOpportunity, direction: 'NEXT' | 'PREV') => {
        const currentIndex = COLUMNS.findIndex(c => c.id === opp.status);
        const newIndex = direction === 'NEXT' ? currentIndex + 1 : currentIndex - 1;

        if (newIndex >= 0 && newIndex < COLUMNS.length) {
            const newStatus = COLUMNS[newIndex].id;
            const updated = { ...opp, status: newStatus };

            // Otimista
            setOpportunities(prev => prev.map(p => p.id === opp.id ? updated : p));

            try {
                await DataService.saveCRMOpportunity(updated);
                // Log automático de movimentação
                await DataService.saveCRMInteraction(opp.id!, user.name, `Moveu card para ${COLUMNS[newIndex].label}`);
            } catch (e) {
                fetchData(); // Reverte em erro
            }
        }
    };

    if (loading && !selectedOpp) return (
        <div className="flex flex-col items-center justify-center py-40 opacity-30">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-[10px] font-black uppercase tracking-widest italic">Sincronizando CRM...</p>
        </div>
    );

    return (
        <div className="flex flex-col h-full space-y-6 animate-in fade-in duration-500 pb-4">
            {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

            {/* --- HEADER --- */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 shrink-0">
                <div>
                    <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">
                        CRM Pipeline
                    </h2>
                    <div className="flex gap-1 mt-4 bg-slate-100 p-1 rounded-xl w-fit">
                        <button
                            onClick={() => setViewMode('KANBAN')}
                            className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'KANBAN' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            Quadro Kanban
                        </button>
                        <button
                            onClick={() => setViewMode('FEED')}
                            className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'FEED' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            Feed Gerencial
                        </button>
                    </div>
                </div>

                {viewMode === 'KANBAN' && (
                    <div className="flex items-center gap-4">
                        <div className="bg-white border border-slate-200 p-1 rounded-xl flex items-center shadow-sm">
                            <span className="text-[9px] font-black text-slate-400 uppercase px-3 italic">Visualizar:</span>
                            <select
                                value={filterMode}
                                onChange={(e) => setFilterMode(e.target.value as any)}
                                className="bg-transparent text-[10px] font-bold text-slate-700 uppercase outline-none py-2 pr-2 cursor-pointer"
                            >
                                <option value="ALL">Todos os Cards</option>
                                <option value="MINE">Meus Cards</option>
                            </select>
                        </div>
                        <button
                            onClick={() => handleOpenCard('NEW')}
                            className="px-6 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-indigo-600 transition-all flex items-center gap-2 italic"
                        >
                            <ICONS.Add className="w-4 h-4" />
                            Novo Cliente
                        </button>
                    </div>
                )}
            </div>

            {/* --- CONTENT AREA --- */}
            <div className="flex-1 min-h-0 overflow-hidden relative">

                {/* VIEW 1: FEED GERENCIAL */}
                {viewMode === 'FEED' && (
                    <div className="h-full overflow-y-auto custom-scrollbar p-4 max-w-4xl mx-auto space-y-6">
                        {globalFeed.length === 0 ? (
                            <div className="text-center py-20 opacity-40">
                                <ICONS.History className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                                <p className="font-black text-xs uppercase text-slate-400">Nenhuma interação registrada recentemente.</p>
                            </div>
                        ) : (
                            globalFeed.map((item, idx) => (
                                <div key={item.id || idx} className="flex gap-4 animate-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${idx * 50}ms` }}>
                                    <div className="flex flex-col items-center">
                                        <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-black text-xs shadow-md border-2 border-white">
                                            {item.userName?.[0] || '?'}
                                        </div>
                                        <div className="w-0.5 flex-1 bg-slate-200 my-2"></div>
                                    </div>
                                    <div className="flex-1 bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md transition-shadow mb-4">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wide mr-2">@{item.userName}</span>
                                                <span className="text-[10px] text-slate-400 font-medium">em <span className="font-bold text-slate-600 uppercase">{item.clientName}</span></span>
                                            </div>
                                            <span className="text-[9px] font-bold text-slate-300 uppercase">{new Date(item.createdAt).toLocaleString()}</span>
                                        </div>
                                        <p className="text-xs text-slate-600 leading-relaxed font-medium">"{item.content}"</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* VIEW 2: KANBAN INTELIGENTE */}
                {viewMode === 'KANBAN' && (
                    <div className="h-full overflow-x-auto overflow-y-hidden pb-4">
                        <div className="flex gap-6 h-full min-w-[1400px] px-2">
                            {COLUMNS.map(col => {
                                const colItems = filteredOpportunities.filter(o => o.status === col.id);

                                // Lógica de Separação (Prioridade vs Agendados)
                                const todayStr = new Date().toISOString().split('T')[0];

                                const priorityItems = colItems.filter(i => {
                                    if (!i.nextFollowUp) return true; // Sem data = Prioridade (Não esquecer)
                                    return i.nextFollowUp <= todayStr;
                                }).sort((a, b) => (a.nextFollowUp || '').localeCompare(b.nextFollowUp || ''));

                                const scheduledItems = colItems.filter(i => {
                                    return i.nextFollowUp && i.nextFollowUp > todayStr;
                                }).sort((a, b) => a.nextFollowUp!.localeCompare(b.nextFollowUp!));

                                return (
                                    <div key={col.id} className="flex-1 flex flex-col min-w-[280px] h-full">
                                        {/* Column Header */}
                                        <div className={`p-4 rounded-t-3xl border-t-4 bg-white border-x border-b border-slate-100 shadow-sm mb-4 shrink-0 flex items-center justify-between ${col.headerColor.replace('text', 'border')}`}>
                                            <div className="flex items-center gap-2">
                                                <col.icon className={`w-4 h-4 ${col.headerColor.split(' ')[1]}`} />
                                                <h3 className={`font-black uppercase text-xs tracking-wide ${col.headerColor.split(' ')[1]}`}>{col.label}</h3>
                                            </div>
                                            <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-lg text-[9px] font-black">{colItems.length}</span>
                                        </div>

                                        {/* Column Body */}
                                        <div className={`flex-1 overflow-y-auto custom-scrollbar p-2 rounded-3xl ${col.color} space-y-2`}>

                                            {/* Zona de Prioridade */}
                                            {priorityItems.length > 0 && (
                                                <div className="space-y-3 mb-6">
                                                    <div className="flex items-center gap-2 px-2 opacity-50">
                                                        <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
                                                        <span className="text-[8px] font-black text-red-500 uppercase tracking-widest">Atenção / Hoje</span>
                                                    </div>
                                                    {priorityItems.map(opp => (
                                                        <SocialCard
                                                            key={opp.id}
                                                            opp={opp}
                                                            onClick={() => handleOpenCard(opp)}
                                                            onMove={(dir) => handleMoveCard(opp, dir)}
                                                            isFirstCol={COLUMNS.findIndex(c => c.id === col.id) === 0}
                                                            isLastCol={COLUMNS.findIndex(c => c.id === col.id) === COLUMNS.length - 1}
                                                        />
                                                    ))}
                                                </div>
                                            )}

                                            {/* Zona Agendada */}
                                            {scheduledItems.length > 0 && (
                                                <div className="space-y-3">
                                                    <div className="flex items-center gap-2 px-2 opacity-40 mt-4">
                                                        <ICONS.History className="w-3 h-3 text-slate-500" />
                                                        <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Futuro</span>
                                                    </div>
                                                    {scheduledItems.map(opp => (
                                                        <SocialCard
                                                            key={opp.id}
                                                            opp={opp}
                                                            onClick={() => handleOpenCard(opp)}
                                                            onMove={(dir) => handleMoveCard(opp, dir)}
                                                            isFirstCol={COLUMNS.findIndex(c => c.id === col.id) === 0}
                                                            isLastCol={COLUMNS.findIndex(c => c.id === col.id) === COLUMNS.length - 1}
                                                        />
                                                    ))}
                                                </div>
                                            )}

                                            {colItems.length === 0 && (
                                                <div className="h-full flex items-center justify-center opacity-10">
                                                    <ICONS.Chart className="w-12 h-12 text-slate-900" />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* --- MODAL DETALHES (SPLIT SCREEN) --- */}
            {selectedOpp && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[200] flex items-center justify-center p-4 animate-in zoom-in-95 duration-200">
                    <div className="bg-white w-full max-w-6xl h-[90vh] rounded-[3rem] shadow-2xl overflow-hidden flex border border-slate-200">

                        {/* ESQUERDA: FORMULÁRIO DE EDIÇÃO */}
                        <div className="w-1/2 flex flex-col border-r border-slate-100 bg-slate-50/30">
                            <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                                <div>
                                    <h3 className="text-xl font-black text-slate-900 uppercase italic">Ficha do Cliente</h3>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Dados Cadastrais & Status</p>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                                <form id="oppForm" onSubmit={handleSaveOpp} className="space-y-6">
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Cliente / Lead *</label>
                                            <input
                                                required
                                                value={selectedOpp.clientName}
                                                onChange={e => setSelectedOpp({ ...selectedOpp, clientName: e.target.value.toUpperCase() })}
                                                className="w-full px-5 py-4 bg-white border-2 border-slate-100 focus:border-indigo-600 rounded-2xl outline-none font-black text-sm uppercase transition-all"
                                                placeholder="NOME DO CLIENTE"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Empresa</label>
                                                <input value={selectedOpp.companyName || ''} onChange={e => setSelectedOpp({ ...selectedOpp, companyName: e.target.value.toUpperCase() })} className="w-full px-4 py-3 bg-white border-2 border-slate-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase" />
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Telefone / Whats</label>
                                                <input value={selectedOpp.phone || ''} onChange={e => setSelectedOpp({ ...selectedOpp, phone: e.target.value })} className="w-full px-4 py-3 bg-white border-2 border-slate-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase" />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Link Instagram</label>
                                            <div className="relative">
                                                <ICONS.Instagram className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-pink-600" />
                                                <input value={selectedOpp.instagramLink || ''} onChange={e => setSelectedOpp({ ...selectedOpp, instagramLink: e.target.value })} className="w-full pl-10 pr-4 py-3 bg-white border-2 border-slate-100 focus:border-pink-500 rounded-xl outline-none font-bold text-xs" placeholder="https://instagram.com/..." />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-50 space-y-4">
                                        <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest italic">Responsáveis</h4>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase ml-1">SDR (Prospecção)</label>
                                                <select value={selectedOpp.prospector || ''} onChange={e => setSelectedOpp({ ...selectedOpp, prospector: e.target.value })} className="w-full px-4 py-3 bg-white border-2 border-indigo-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase cursor-pointer">
                                                    <option value="">Selecione...</option>
                                                    {systemUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Closer (Vendedor)</label>
                                                <select value={selectedOpp.attendant || ''} onChange={e => setSelectedOpp({ ...selectedOpp, attendant: e.target.value })} className="w-full px-4 py-3 bg-white border-2 border-indigo-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase cursor-pointer">
                                                    <option value="">Selecione...</option>
                                                    {systemUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Status Funil</label>
                                            <select value={selectedOpp.status} onChange={e => setSelectedOpp({ ...selectedOpp, status: e.target.value as CRMStatus })} className="w-full px-4 py-3 bg-slate-100 border-2 border-transparent focus:border-slate-400 rounded-xl outline-none font-black text-xs uppercase cursor-pointer">
                                                {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Próx. Follow-up</label>
                                            <input type="date" value={selectedOpp.nextFollowUp || ''} onChange={e => setSelectedOpp({ ...selectedOpp, nextFollowUp: e.target.value })} className="w-full px-4 py-3 bg-slate-100 border-2 border-transparent focus:border-slate-400 rounded-xl outline-none font-black text-xs uppercase" />
                                        </div>
                                    </div>
                                </form>
                            </div>
                            <div className="p-6 border-t border-slate-100 flex justify-between items-center bg-white">
                                <button type="button" onClick={() => setSelectedOpp(null)} className="px-6 py-3 text-slate-400 font-black text-[10px] uppercase hover:text-red-500 transition-colors">Cancelar</button>
                                <button type="submit" form="oppForm" disabled={isSavingOpp} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-indigo-600 transition-all disabled:opacity-50 italic">
                                    {isSavingOpp ? 'Salvando...' : 'Salvar Alterações'}
                                </button>
                            </div>
                        </div>

                        {/* DIREITA: TIMELINE & INTERAÇÕES */}
                        <div className="w-1/2 flex flex-col bg-white">
                            <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                                <div>
                                    <h3 className="text-xl font-black text-slate-900 uppercase italic">Linha do Tempo</h3>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Histórico de Interações</p>
                                </div>
                                <div className="bg-slate-100 text-slate-500 px-3 py-1 rounded-lg text-[9px] font-black">{oppInteractions.length} Notas</div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/50 space-y-6" ref={feedScrollRef}>
                                {oppInteractions.length === 0 ? (
                                    <div className="text-center py-20 opacity-30">
                                        <ICONS.History className="w-12 h-12 mx-auto mb-3" />
                                        <p className="text-[10px] font-black uppercase">Nenhum registro encontrado.</p>
                                    </div>
                                ) : (
                                    oppInteractions.map((interaction) => (
                                        <div key={interaction.id} className="flex gap-4">
                                            <div className="flex flex-col items-center">
                                                <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-[10px] shadow-md uppercase">
                                                    {interaction.userName[0]}
                                                </div>
                                                <div className="w-0.5 flex-1 bg-indigo-100 my-2"></div>
                                            </div>
                                            <div className="flex-1 bg-white p-5 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-[9px] font-black text-indigo-600 uppercase tracking-wider">@{interaction.userName}</span>
                                                    <span className="text-[8px] font-bold text-slate-400">{new Date(interaction.createdAt).toLocaleString()}</span>
                                                </div>
                                                <p className="text-xs text-slate-600 font-medium leading-relaxed whitespace-pre-wrap">{interaction.content}</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="p-6 border-t border-slate-100 bg-white space-y-4">
                                <AIAssistant onSummaryGenerated={(text) => setNewInteractionText(prev => prev ? prev + '\n\n' + text : text)} />
                                <div className="relative">
                                    <textarea
                                        value={newInteractionText}
                                        onChange={e => setNewInteractionText(e.target.value)}
                                        placeholder="Digite uma nova nota, resumo de ligação ou atualização..."
                                        className="w-full pl-6 pr-20 py-4 bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 rounded-2xl outline-none font-medium text-xs resize-none h-24"
                                    />
                                    <button
                                        onClick={handlePostInteraction}
                                        disabled={!newInteractionText.trim() || isSavingInteraction}
                                        className="absolute bottom-4 right-4 bg-indigo-600 text-white p-2 rounded-xl shadow-lg hover:bg-indigo-700 transition-all disabled:opacity-50"
                                    >
                                        {isSavingInteraction ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>}
                                    </button>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
};

// --- FIM DO COMPONENTE ---

export default CRMModule;
