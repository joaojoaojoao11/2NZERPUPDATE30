
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DataService } from '../services/dataService';
import { CRMOpportunity, CRMStatus, User, CRMInteraction } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import SocialCard from './crm/SocialCard';
import { AIAssistant } from './crm/AIAssistant';

interface CRMModuleProps {
    user: User;
    onNavigate?: (view: any) => void;
}

const COLUMNS: { id: CRMStatus; label: string; color: string; headerColor: string; icon: any }[] = [
    { id: 'PROSPECCAO', label: 'Prospecção', color: 'bg-slate-50', headerColor: 'border-slate-300 text-slate-600', icon: ICONS.Search },
    { id: 'QUALIFICADO', label: 'Qualificado', color: 'bg-blue-50/30', headerColor: 'border-blue-300 text-blue-600', icon: ICONS.Chart },
    { id: 'NEGOCIACAO', label: 'Negociação', color: 'bg-amber-50/30', headerColor: 'border-amber-300 text-amber-600', icon: ICONS.Inventory },
    { id: 'GANHO', label: 'Ganho', color: 'bg-emerald-50/30', headerColor: 'border-emerald-300 text-emerald-600', icon: ICONS.Finance },
    { id: 'PERDIDO', label: 'Perdido', color: 'bg-red-50/30', headerColor: 'border-red-300 text-red-600', icon: ICONS.Alert },
    { id: 'DESQUALIFICADO', label: 'Desqualificado', color: 'bg-slate-200/50', headerColor: 'border-slate-400 text-slate-500', icon: ICONS.Inventory },
];

const CRMModule: React.FC<CRMModuleProps> = ({ user, onNavigate }) => {
    // --- STATE: GERAL ---
    const [viewMode, setViewMode] = useState<'KANBAN' | 'FEED'>('KANBAN');
    const [loading, setLoading] = useState(true);
    const [opportunities, setOpportunities] = useState<CRMOpportunity[]>([]);
    const [globalFeed, setGlobalFeed] = useState<any[]>([]);
    const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
    const [systemUsers, setSystemUsers] = useState<User[]>([]); // <<< NOVO ESTADO

    // --- STATE: KANBAN ---
    const [filterMode, setFilterMode] = useState<'ALL' | 'MINE'>('ALL');
    const [searchTerm, setSearchTerm] = useState('');

    // --- STATE: MODAL & INTERAÇÕES ---
    const [selectedOpp, setSelectedOpp] = useState<CRMOpportunity | null>(null); // Se null, modal fechado
    const [oppInteractions, setOppInteractions] = useState<CRMInteraction[]>([]);
    const [newInteractionText, setNewInteractionText] = useState('');
    const [isSavingInteraction, setIsSavingInteraction] = useState(false);
    const [isSavingOpp, setIsSavingOpp] = useState(false);
    const [salesHistory, setSalesHistory] = useState<any[] | null>(null); // Histórico de Compras Tiny
    const [showSalesWidget, setShowSalesWidget] = useState(false);
    const [xpAnimation, setXpAnimation] = useState(false); // Animação XP
    const isLocked = selectedOpp?.status === 'DESQUALIFICADO';

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

        // Filter by Owner
        if (filterMode === 'MINE') {
            const myName = user.name.toUpperCase();
            list = list.filter(o =>
                (o.attendant && o.attendant.toUpperCase() === myName) ||
                (o.prospector && o.prospector.toUpperCase() === myName)
            );
        }

        // Filter by Search Term (Busca Inteligente)
        if (searchTerm.trim()) {
            const term = searchTerm.toUpperCase().trim();
            list = list.filter(o => {
                const searchString = [
                    o.clientName,
                    o.companyName,
                    o.cpfCnpj,
                    o.address,
                    o.email,
                    ...(o.tags || [])
                ].filter(Boolean).join(' ').toUpperCase();

                return searchString.includes(term);
            });
        }

        return list;
    }, [opportunities, filterMode, user.name, searchTerm]);

    // --- HANDLERS MODAL ---

    // --- TIMELINE (INTERAÇÕES + VENDAS SINCRONIZADAS) ---
    const mergedTimeline = useMemo(() => {
        return oppInteractions.map(i => {
            // Detecta Venda Tiny Persistida
            if (i.content && i.content.includes('::JSON::')) {
                try {
                    const parts = i.content.split('::JSON::');
                    const jsonStr = parts[1];
                    const payload = JSON.parse(jsonStr);

                    // Se tiver data no payload, usar para display, mas a ordenação usa i.createdAt
                    return {
                        type: 'SALE',
                        id: `sale-${payload.id}`,
                        date: i.createdAt,
                        user: 'TINY ERP',
                        initial: 'T',
                        content: `Pedido #${payload.numero}`,
                        total: payload.valor,
                        status: payload.situacao,
                        details: payload
                    };
                } catch (e) {
                    console.error("Erro parse json timeline", e);
                }
            }

            // Interação Normal CRM
            return {
                type: 'CRM',
                id: `crm-${i.id}`,
                date: i.createdAt,
                user: i.userName,
                initial: i.userName ? i.userName[0] : '?',
                content: i.content.replace(/\[TINY_ORDER:.*?\]/, '').trim(), // Limpa assinatura visualmente se houver
                details: null
            };
        }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [oppInteractions]);

    // <<< CRM 2.0: INTELIGÊNCIA E GAMIFICAÇÃO >>>
    const calculateIntel = (opp: CRMOpportunity, interactions: CRMInteraction[]) => {
        let xp = 0;
        // 1. Completude de Perfil
        if (opp.clientName) xp += 10;
        if (opp.cpfCnpj) xp += 15;
        if (opp.email) xp += 10;
        if (opp.phone) xp += 10;
        if (opp.address) xp += 10;
        if (opp.instagramLink) xp += 10;
        if (opp.prospector) xp += 5;
        if (opp.attendant) xp += 5;
        if (opp.tags && opp.tags.length > 0) xp += (opp.tags.length * 2);

        // 2. Interações (Notas) e Vendas
        const salesCount = interactions.filter(i => i.content && i.content.includes('::JSON::')).length;
        const notesCount = interactions.length - salesCount;

        xp += (salesCount * 50); // Venda vale muito!
        xp += (notesCount * 5);  // Notas simples valem 5

        // 3. Follow-up
        if (opp.nextFollowUp) xp += 10;

        // --- ENGAJAMENTO (TERMÔMETRO) ---
        let score = 50; // Base
        if (interactions.length > 0) {
            const lastDate = new Date(interactions[0].createdAt).getTime();
            const now = new Date().getTime();
            const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

            if (diffDays < 3) score = 100;
            else if (diffDays < 7) score = 85;
            else if (diffDays < 15) score = 60;
            else if (diffDays < 30) score = 30;
            else score = 10;
        } else {
            score = 10;
        }

        return { xp, score };
    };

    const triggerXpAnimation = () => {
        setXpAnimation(true);
        setTimeout(() => setXpAnimation(false), 2000);
    };

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
            setSalesHistory(null); // Reset history view
            setShowSalesWidget(false); // Reset widget visibility

            // --- CRM 2.0: Enriquecimento de Dados (Cadastro Clientes) ---
            DataService.getClients(5, 0, opp.clientName).then(clients => {
                const exactMatch = clients.find(c => c.nome.toUpperCase() === opp.clientName.toUpperCase());
                if (exactMatch) {
                    setSelectedOpp(prev => {
                        if (!prev || prev.id !== opp.id) return prev;
                        return {
                            ...prev,
                            cpfCnpj: prev.cpfCnpj || exactMatch.cpf_cnpj,
                            address: prev.address || [exactMatch.endereco, exactMatch.bairro, exactMatch.cidade, exactMatch.estado].filter(Boolean).join(', '),
                            clientId: exactMatch.id,
                            idTiny: exactMatch.id_tiny
                        };
                    });
                }
            }).catch(err => console.error("Erro ao carregar dados mestre do cliente:", err));

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
            // Recalcula intel antes de salvar
            const { xp, score } = calculateIntel(selectedOpp, oppInteractions);
            const toSave = { ...selectedOpp, xpReward: xp, engagementScore: score };

            const res = await DataService.saveCRMOpportunity(toSave);
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

                // Ganho de XP por nota
                const { xp, score } = calculateIntel(selectedOpp, updated);
                setSelectedOpp(prev => prev ? { ...prev, xpReward: xp, engagementScore: score } : null);
                triggerXpAnimation();
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
                        {/* SEARCH BAR & IMPORT */}
                        <div className="flex items-center gap-2">
                            <div className="bg-white border border-slate-200 p-1 rounded-xl flex items-center shadow-sm w-64">
                                <ICONS.Search className="w-3 h-3 text-slate-400 ml-3 mr-2" />
                                <input
                                    type="text"
                                    placeholder="BUSCAR CLIENTE..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="bg-transparent text-[10px] font-bold text-slate-700 uppercase outline-none py-2 w-full placeholder:text-slate-300"
                                />
                            </div>
                            {searchTerm.length > 2 && (
                                <button
                                    onClick={async () => {
                                        setToast({ msg: `Buscando '${searchTerm}' no Tiny ERP...`, type: 'success' });
                                        try {
                                            const { TinyService } = await import('../services/tinyService');
                                            const results = await TinyService.searchFullClients(searchTerm);

                                            if (results.length > 0) {
                                                const { count } = await DataService.upsertClients(results);
                                                if (count > 0) {
                                                    setToast({ msg: `${count} cliente(s) importado(s) do Tiny!`, type: 'success' });
                                                    setTimeout(fetchData, 1000);
                                                } else {
                                                    setToast({ msg: 'Cliente encontrado no Tiny mas já existe no CRM (ou erro de atualização).', type: 'error' });
                                                }
                                            } else {
                                                setToast({ msg: 'Nenhum cliente encontrado no Tiny com este nome.', type: 'error' });
                                            }
                                        } catch (e) { console.error(e); setToast({ msg: 'Erro na busca Tiny.', type: 'error' }); }
                                    }}
                                    className="px-3 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl font-bold text-[9px] uppercase hover:bg-indigo-100 transition-colors whitespace-nowrap"
                                    title="Buscar e importar do Tiny"
                                >
                                    Buscar no Tiny
                                </button>
                            )}
                        </div>
                        <button
                            onClick={() => handleOpenCard('NEW')}
                            className="px-6 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all flex items-center gap-2 italic"
                        >
                            <ICONS.Add className="w-4 h-4" />
                            Novo Cliente
                        </button>
                        <button
                            onClick={async () => {
                                setToast({ msg: 'Importando clientes do Tiny...', type: 'success' });
                                try {
                                    const { TinyService } = await import('../services/tinyService');
                                    const newClients = await TinyService.getRecentClients();

                                    if (newClients.length > 0) {
                                        const { count } = await DataService.upsertClients(newClients);
                                        setToast({ msg: `${count} Clientes processados. O CRM será atualizado.`, type: 'success' });
                                        // A automação do banco deve criar os cards. Recarregamos:
                                        setTimeout(fetchData, 2000);
                                    } else {
                                        setToast({ msg: 'Nenhum cliente novo encontrado para importar.', type: 'error' });
                                    }
                                } catch (e: any) {
                                    console.error("Erro Sync Tiny:", JSON.stringify(e, null, 2));
                                    setToast({ msg: `Erro: ${e.message || JSON.stringify(e)}`, type: 'error' });
                                }
                            }}
                            className="px-4 py-4 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all flex items-center gap-2 italic"
                            title="Importar clientes recentes do Tiny ERP"
                        >
                            <ICONS.History className="w-4 h-4" />
                            Sync Tiny
                        </button>
                    </div>
                )}
            </div>

            {/* --- CONTENT AREA --- */}
            <div className="flex-1 min-h-0 overflow-hidden relative bg-slate-200 rounded-t-[2.5rem] shadow-inner border-t border-slate-300">
                {/* Background Pattern for Texture */}
                <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>

                {/* VIEW 1: FEED GERENCIAL */}
                {viewMode === 'FEED' && (
                    <div className="h-full overflow-y-auto custom-scrollbar p-8 max-w-5xl mx-auto space-y-8 relative z-10">
                        {globalFeed.length === 0 ? (
                            <div className="text-center py-32 opacity-40">
                                <div className="bg-slate-300 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <ICONS.History className="w-10 h-10 text-slate-500" />
                                </div>
                                <p className="font-black text-sm uppercase text-slate-500 tracking-widest">Nenhuma interação recente</p>
                            </div>
                        ) : (
                            globalFeed.map((item, idx) => (
                                <div key={item.id || idx} className="flex gap-6 animate-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${idx * 50}ms` }}>
                                    <div className="flex flex-col items-center pt-2">
                                        <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-sm shadow-indigo-200 shadow-lg border-2 border-white transform rotate-3">
                                            {item.userName?.[0] || '?'}
                                        </div>
                                        <div className="w-0.5 flex-1 bg-gradient-to-b from-slate-300 to-transparent my-2"></div>
                                    </div>
                                    <div className="flex-1 bg-white p-8 rounded-[2rem] rounded-tl-none border border-slate-200 shadow-sm hover:shadow-md transition-all hover:-translate-y-1">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <span className="inline-block bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md mb-1">@{item.userName}</span>
                                                <div className="text-xs text-slate-400 font-medium mt-1">em <span className="font-bold text-slate-700 uppercase">{item.clientName}</span></div>
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase bg-slate-50 px-3 py-1 rounded-full border border-slate-100">{new Date(item.createdAt).toLocaleString()}</span>
                                        </div>
                                        <p className="text-sm text-slate-600 leading-relaxed font-medium">"{item.content}"</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* VIEW 2: KANBAN INTELIGENTE (PREMIUM) */}
                {viewMode === 'KANBAN' && (
                    <div className="h-full overflow-x-auto overflow-y-hidden pb-4 pt-6 px-6 relative z-10">
                        <div className="flex gap-6 h-full min-w-max">
                            {COLUMNS.map(col => {
                                const colItems = filteredOpportunities.filter(o => o.status === col.id);
                                const todayStr = new Date().toISOString().split('T')[0];

                                // 1. Não Contatados (Cold)
                                const notContactedItems = colItems.filter(i => (i.interactionCount || 0) === 0 && !i.nextFollowUp);

                                // 2. Agendados (Scheduled)
                                const scheduledItems = colItems.filter(i => i.nextFollowUp && i.nextFollowUp > todayStr)
                                    .sort((a, b) => a.nextFollowUp!.localeCompare(b.nextFollowUp!));

                                // 3. Em Atendimento (Priority)
                                const priorityItems = colItems.filter(i => {
                                    const isCold = (i.interactionCount || 0) === 0 && !i.nextFollowUp;
                                    const isScheduled = i.nextFollowUp && i.nextFollowUp > todayStr;
                                    return !isCold && !isScheduled;
                                }).sort((a, b) => (a.nextFollowUp || '').localeCompare(b.nextFollowUp || ''));

                                const accentColor = col.color.includes('blue') ? 'bg-blue-500' :
                                    col.color.includes('emerald') ? 'bg-emerald-500' :
                                        col.color.includes('amber') ? 'bg-amber-500' :
                                            col.color.includes('red') ? 'bg-red-500' : 'bg-slate-500';

                                return (
                                    <div key={col.id} className="flex-1 flex flex-col min-w-[320px] w-[320px] h-full">
                                        <div className="mb-5 flex items-center justify-between px-1">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-1.5 h-1.5 rounded-full ${accentColor} shadow-[0_0_10px_rgba(0,0,0,0.2)]`}></div>
                                                <h3 className="font-black uppercase text-xs tracking-widest text-slate-600">{col.label}</h3>
                                            </div>
                                            <div className="bg-white border border-slate-200 text-slate-500 px-2.5 py-0.5 rounded-md text-[10px] font-black shadow-sm">
                                                {colItems.length}
                                            </div>
                                        </div>

                                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 -mr-2 space-y-4 pb-20">

                                            {/* SEÇÃO 1: EM ATENDIMENTO */}
                                            {priorityItems.length > 0 && (
                                                <div className="space-y-3">
                                                    <div className="flex items-center gap-2 px-1 opacity-50 mb-2">
                                                        <ICONS.Fire className="w-3 h-3 text-red-500" />
                                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Em Foco</span>
                                                    </div>
                                                    {priorityItems.map((opp) => (
                                                        <div key={opp.id || `priority-${opp.clientName}`}>
                                                            <SocialCard
                                                                opp={opp}
                                                                onClick={() => handleOpenCard(opp)}
                                                                onMove={(dir) => handleMoveCard(opp, dir)}
                                                                isFirstCol={col.id === COLUMNS[0].id}
                                                                isLastCol={col.id === COLUMNS[COLUMNS.length - 1].id}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* SEÇÃO 2: AGENDADOS */}
                                            {scheduledItems.length > 0 && (
                                                <div className="space-y-3 pt-6 border-t border-slate-200/50">
                                                    <div className="flex items-center gap-2 px-1 opacity-50 mb-2">
                                                        <ICONS.Calendar className="w-3 h-3 text-indigo-500" />
                                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Próximos</span>
                                                    </div>
                                                    {scheduledItems.map((opp) => (
                                                        <div key={opp.id || `sched-${opp.clientName}`} className="opacity-90 hover:opacity-100 transition-opacity">
                                                            <SocialCard
                                                                opp={opp}
                                                                onClick={() => handleOpenCard(opp)}
                                                                onMove={(dir) => handleMoveCard(opp, dir)}
                                                                isFirstCol={col.id === COLUMNS[0].id}
                                                                isLastCol={col.id === COLUMNS[COLUMNS.length - 1].id}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* SEÇÃO 3: NÃO CONTATADOS */}
                                            {notContactedItems.length > 0 && (
                                                <div className="space-y-3 pt-6 border-t border-slate-200/50">
                                                    <div className="flex items-center gap-2 px-1 opacity-50 mb-2">
                                                        <div className="w-3 h-3 bg-slate-200 rounded-full flex items-center justify-center"><div className="w-1.5 h-1.5 bg-slate-400 rounded-full"></div></div>
                                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Sem Contato</span>
                                                    </div>
                                                    {notContactedItems.map((opp) => (
                                                        <div key={opp.id || `cold-${opp.clientName}`} className="opacity-80 hover:opacity-100 grayscale hover:grayscale-0 transition-all">
                                                            <SocialCard
                                                                opp={opp}
                                                                onClick={() => handleOpenCard(opp)}
                                                                onMove={(dir) => handleMoveCard(opp, dir)}
                                                                isFirstCol={col.id === COLUMNS[0].id}
                                                                isLastCol={col.id === COLUMNS[COLUMNS.length - 1].id}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {colItems.length === 0 && (
                                                <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-3xl m-1 opacity-50">
                                                    <div className="bg-slate-100 p-4 rounded-full mb-3">
                                                        <col.icon className="w-5 h-5 text-slate-400" />
                                                    </div>
                                                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Sem Cards</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div >
                )}
            </div >

            {/* --- MODAL DETALHES (SPLIT SCREEN) --- */}
            {
                selectedOpp && (
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
                                    <div className="flex justify-between items-center bg-slate-50 p-2 rounded-xl mb-4">
                                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic ml-2">Inteligência de Cliente</h4>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (!selectedOpp) return;
                                                setToast({ msg: 'Buscando dados no Tiny...', type: 'success' });
                                                try {
                                                    const { TinyService } = await import('../services/tinyService');
                                                    const enriched = await TinyService.enrichOpportunity(selectedOpp);

                                                    if (Object.keys(enriched).length > 0) {
                                                        // Auto-fill logic: Merge enriched data + potentially client details if available
                                                        // Por enquanto, enrichOpportunity traz LTV e Datas. 
                                                        // TODO: Buscar dados cadastrais (telefone, cidade) se o backend suportar no futuro.

                                                        setSelectedOpp(prev => {
                                                            const updated = { ...prev, ...enriched } as CRMOpportunity;
                                                            const { xp, score } = calculateIntel(updated, oppInteractions);
                                                            return { ...updated, xpReward: xp, engagementScore: score };
                                                        });
                                                        setToast({ msg: 'Dados enriquecidos com sucesso!', type: 'success' });
                                                        triggerXpAnimation();
                                                    } else {
                                                        setToast({ msg: 'Cliente não encontrado ou sem histórico no Tiny.', type: 'error' });
                                                    }
                                                } catch (e) {
                                                    console.error(e);
                                                    setToast({ msg: 'Erro na integração Tiny.', type: 'error' });
                                                }
                                            }}
                                            className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-[9px] font-black uppercase tracking-wide hover:bg-indigo-100 transition-colors flex items-center gap-2"
                                        >
                                            <ICONS.History className="w-3 h-3" />
                                            Sincronizar Tiny
                                        </button>
                                    </div>

                                    {/* PAINEL DE MÉTRICAS (LTV & ENGAGEMENT) - REMOVIDO LTV TOTAL (User Request) */}
                                    <div className="grid grid-cols-2 gap-3 mb-6 relative">
                                        <div className="bg-gradient-to-br from-amber-50 to-white p-4 rounded-2xl border border-amber-100 shadow-sm flex flex-col items-center justify-center text-center overflow-hidden relative">
                                            <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider mb-1">XP Reward</span>
                                            <span className="text-lg font-black text-amber-600 leading-none">
                                                ★ {selectedOpp.xpReward || 0}
                                            </span>
                                            {xpAnimation && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-amber-500/10 pointer-events-none animate-in fade-in zoom-in-150 duration-500">
                                                    <span className="text-amber-600 font-black text-xs animate-bounce">+ XP!</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="bg-gradient-to-br from-blue-50 to-white p-4 rounded-2xl border border-blue-100 shadow-sm flex flex-col items-center justify-center text-center">
                                            <span className="text-[9px] font-bold text-blue-400 uppercase tracking-wider mb-1">Engajamento</span>
                                            <div className="w-full bg-blue-100/30 h-1.5 rounded-full mt-2 mb-1 overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-1000 ${selectedOpp.engagementScore && selectedOpp.engagementScore > 70 ? 'bg-emerald-500' :
                                                        selectedOpp.engagementScore && selectedOpp.engagementScore > 40 ? 'bg-blue-500' : 'bg-red-400'
                                                        }`}
                                                    style={{ width: `${selectedOpp.engagementScore || 50}%` }}
                                                ></div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className={`text-[8px] font-black uppercase ${selectedOpp.engagementScore && selectedOpp.engagementScore > 70 ? 'text-emerald-600' :
                                                    selectedOpp.engagementScore && selectedOpp.engagementScore > 40 ? 'text-blue-600' : 'text-red-600'
                                                    }`}>
                                                    {selectedOpp.engagementScore && selectedOpp.engagementScore > 70 ? '🔥 Quente' :
                                                        selectedOpp.engagementScore && selectedOpp.engagementScore > 40 ? '⚡ Ativo' : '❄️ Frio'}
                                                </span>
                                                <span className="text-[8px] font-bold text-slate-300">|</span>
                                                <span className="text-[8px] font-black text-slate-400">{selectedOpp.engagementScore || 50}/100</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Botão de Histórico de Vendas (NOVO) */}
                                    <div className="mb-6">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (salesHistory) {
                                                    setShowSalesWidget(!showSalesWidget);
                                                    return;
                                                }

                                                setToast({ msg: 'Buscando histórico de compras...', type: 'success' });
                                                try {
                                                    const { TinyService } = await import('../services/tinyService');
                                                    const history = await TinyService.getClientSales(selectedOpp.cpfCnpj || '', selectedOpp.clientName);

                                                    if (history && history.length > 0) {
                                                        // 1. Persistir na Timeline
                                                        if (selectedOpp && selectedOpp.id) {
                                                            const count = await DataService.syncTinySalesToInteractions(selectedOpp.id, history);
                                                            if (count > 0) {
                                                                const updatedInteractions = await DataService.getCRMInteractions(selectedOpp.id);
                                                                setOppInteractions(updatedInteractions);

                                                                // Recalcula XP com novas vendas
                                                                const { xp, score } = calculateIntel(selectedOpp, updatedInteractions);
                                                                setSelectedOpp(prev => prev ? { ...prev, xpReward: xp, engagementScore: score } : null);
                                                                triggerXpAnimation();

                                                                setToast({ msg: `${count} novos pedidos salvos na timeline.`, type: 'success' });
                                                            } else {
                                                                setToast({ msg: `Histórico atualizado.`, type: 'success' });
                                                            }
                                                        }

                                                        // 2. Atualizar Closer (Vendedor) com base na última venda
                                                        try {
                                                            const sortedHistory = [...history].sort((a, b) => {
                                                                const toTime = (d: string) => {
                                                                    if (!d) return 0;
                                                                    const p = d.split('/');
                                                                    return p.length === 3
                                                                        ? new Date(`${p[2]}-${p[1]}-${p[0]}`).getTime()
                                                                        : 0;
                                                                };
                                                                return toTime(b.data) - toTime(a.data);
                                                            });

                                                            const lastSale = sortedHistory[0];
                                                            if (lastSale && lastSale.vendedor && lastSale.vendedor !== selectedOpp.attendant) {
                                                                const newAttendant = lastSale.vendedor.trim(); // Trim para evitar espaços extras
                                                                await DataService.saveCRMOpportunity({
                                                                    ...selectedOpp,
                                                                    attendant: newAttendant
                                                                });

                                                                setSelectedOpp(prev => prev ? ({ ...prev, attendant: newAttendant }) : null);
                                                                setOpportunities(prev => prev.map(o => o.id === selectedOpp.id ? { ...o, attendant: newAttendant } : o));
                                                                setToast({ msg: `Closer atualizado para: ${newAttendant}`, type: 'success' });
                                                            }
                                                        } catch (errUpdater) {
                                                            console.error("Erro ao atualizar closer automático", errUpdater);
                                                        }

                                                        setSalesHistory(history);
                                                        setShowSalesWidget(true);
                                                    } else {
                                                        setSalesHistory([]); // Empty state
                                                        setShowSalesWidget(true);
                                                        setToast({ msg: 'Nenhuma venda encontrada para este cliente.', type: 'error' });
                                                    }
                                                } catch (e) {
                                                    console.error(e);
                                                    setToast({ msg: 'Erro ao buscar vendas.', type: 'error' });
                                                }
                                            }}
                                            className={`w-full py-3 border rounded-xl font-bold text-xs uppercase transition-colors flex items-center justify-center gap-2 ${showSalesWidget ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                                }`}
                                        >
                                            <ICONS.Inventory className={`w-4 h-4 ${showSalesWidget ? 'text-indigo-500' : 'text-slate-400'}`} />
                                            {showSalesWidget ? 'Ocultar Histórico' : 'Ver Histórico de Compras (Tiny)'}
                                        </button>

                                        {/* LISTA DE HISTÓRICO EXPANSÍVEL */}
                                        {showSalesWidget && salesHistory && (
                                            <div className="mt-3 animate-in slide-in-from-top-2 duration-300">
                                                {salesHistory.length === 0 ? (
                                                    <div className="p-4 text-center text-xs text-slate-400 font-bold uppercase bg-slate-50 rounded-xl border border-slate-200">Sem registros.</div>
                                                ) : (
                                                    <div className="flex flex-col gap-2">
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex flex-col items-center justify-center text-center shadow-sm">
                                                                <span className="text-[9px] font-black text-emerald-400 uppercase tracking-wider mb-1">Pedidos</span>
                                                                <span className="text-2xl font-black text-emerald-600 leading-none">{salesHistory.length}</span>
                                                            </div>
                                                            <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl flex flex-col items-center justify-center text-center shadow-sm">
                                                                <span className="text-[9px] font-black text-indigo-400 uppercase tracking-wider mb-1">Total Comprado</span>
                                                                <span className="text-xl font-black text-indigo-600 leading-none">
                                                                    {Number(salesHistory.reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                if (onNavigate) {
                                                                    sessionStorage.setItem('SALES_HISTORY_FILTER', selectedOpp.clientName);
                                                                    onNavigate('SALES_HISTORY');
                                                                }
                                                            }}
                                                            className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-500 transition-colors flex items-center justify-center gap-1 py-1 cursor-pointer"
                                                        >
                                                            Ver detalhado no Histórico <ICONS.Search className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-8 mt-8">
                                        {/* CRM 2.0: BOTÃO DE CONVERSÃO PROSPECT -> TINY */}
                                        {(!selectedOpp.idTiny && !selectedOpp.clientId) && (
                                            <div className={`p-6 rounded-2xl border-2 transition-all duration-500 flex flex-col items-center gap-4 text-center ${selectedOpp.clientName && selectedOpp.cpfCnpj && selectedOpp.email && selectedOpp.phone && selectedOpp.address
                                                ? 'bg-emerald-50 border-emerald-100'
                                                : 'bg-slate-50 border-slate-100 opacity-60'
                                                }`}>
                                                <div>
                                                    <h4 className={`text-sm font-black uppercase italic ${selectedOpp.clientName && selectedOpp.cpfCnpj && selectedOpp.email && selectedOpp.phone && selectedOpp.address ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                        {selectedOpp.clientName && selectedOpp.cpfCnpj && selectedOpp.email && selectedOpp.phone && selectedOpp.address ? '✨ Pronto para Cadastro!' : '📝 Complete os dados'}
                                                    </h4>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                                                        {selectedOpp.clientName && selectedOpp.cpfCnpj && selectedOpp.email && selectedOpp.phone && selectedOpp.address
                                                            ? 'Todos os campos obrigatórios foram preenchidos.'
                                                            : 'Faltam campos: Nome, CPF/CNPJ, E-mail, Telefone e Endereço.'}
                                                    </p>
                                                </div>

                                                {selectedOpp.clientName && selectedOpp.cpfCnpj && selectedOpp.email && selectedOpp.phone && selectedOpp.address && (
                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            setToast({ msg: 'Cadastrando no Tiny ERP...', type: 'success' });
                                                            try {
                                                                const res = await DataService.registerProspectAtTiny(selectedOpp);
                                                                if (res.success) {
                                                                    setToast({ msg: 'Cliente cadastrado no Tiny com sucesso!', type: 'success' });
                                                                    const up = await DataService.getCRMOpportunities();
                                                                    setOpportunities(up);
                                                                    const found = up.find(o => o.id === selectedOpp.id);
                                                                    if (found) setSelectedOpp(found);
                                                                } else {
                                                                    setToast({ msg: res.message || 'Falha ao cadastrar no Tiny.', type: 'error' });
                                                                }
                                                            } catch (e: any) {
                                                                setToast({ msg: e.message || 'Erro de conexão.', type: 'error' });
                                                            }
                                                        }}
                                                        className="px-8 py-3 bg-emerald-600 text-white rounded-xl font-black text-[11px] uppercase tracking-tighter shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95"
                                                    >
                                                        🚀 Cadastrar no Tiny Agora
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        <form id="oppForm" onSubmit={handleSaveOpp} className="space-y-6">
                                            <div className={`space-y-4 ${isLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                                                <div>
                                                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Cliente / Lead *</label>
                                                    <input
                                                        required
                                                        value={selectedOpp.clientName}
                                                        onChange={e => setSelectedOpp({ ...selectedOpp, clientName: e.target.value.toUpperCase() })}
                                                        className="w-full px-5 py-4 bg-white border-2 border-slate-100 focus:border-indigo-600 rounded-2xl outline-none font-black text-sm uppercase transition-all"
                                                        placeholder="NOME DO CLIENTE"
                                                        disabled={isLocked}
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Empresa</label>
                                                        <input value={selectedOpp.companyName || ''} onChange={e => setSelectedOpp({ ...selectedOpp, companyName: e.target.value.toUpperCase() })} className="w-full px-4 py-3 bg-white border-2 border-slate-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase" disabled={isLocked} />
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Telefone / Whats</label>
                                                        <input value={selectedOpp.phone || ''} onChange={e => setSelectedOpp({ ...selectedOpp, phone: e.target.value })} className="w-full px-4 py-3 bg-white border-2 border-slate-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase" disabled={isLocked} />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-[1fr_2fr] gap-4">
                                                    <div>
                                                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1">CPF / CNPJ</label>
                                                        <input value={selectedOpp.cpfCnpj || ''} onChange={e => setSelectedOpp({ ...selectedOpp, cpfCnpj: e.target.value })} className="w-full px-4 py-3 bg-white border-2 border-slate-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase" placeholder="000.000.000-00" disabled={isLocked} />
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Endereço</label>
                                                        <input value={selectedOpp.address || ''} onChange={e => setSelectedOpp({ ...selectedOpp, address: e.target.value })} className="w-full px-4 py-3 bg-white border-2 border-slate-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase" disabled={isLocked} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">E-mail</label>
                                                    <input value={selectedOpp.email || ''} onChange={e => setSelectedOpp({ ...selectedOpp, email: e.target.value })} className="w-full px-4 py-3 bg-white border-2 border-slate-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase" placeholder="EMAIL@EXEMPLO.COM" disabled={isLocked} />
                                                </div>
                                                <div>
                                                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Link Instagram</label>
                                                    <div className="relative">
                                                        <ICONS.Instagram className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-pink-600" />
                                                        <input value={selectedOpp.instagramLink || ''} onChange={e => setSelectedOpp({ ...selectedOpp, instagramLink: e.target.value })} className="w-full pl-10 pr-4 py-3 bg-white border-2 border-slate-100 focus:border-pink-500 rounded-xl outline-none font-bold text-xs" placeholder="https://instagram.com/..." disabled={isLocked} />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* TAGS */}
                                            <div className={isLocked ? 'opacity-50 pointer-events-none' : ''}>
                                                <label className="text-[9px] font-black text-slate-400 uppercase ml-1 mb-1 block">Tags e Segmentação</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {selectedOpp.tags?.map(tag => (
                                                        <span key={tag} className="bg-slate-200 text-slate-600 px-2 py-1 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 group cursor-pointer hover:bg-red-100 hover:text-red-500 transition-colors"
                                                            onClick={() => !isLocked && setSelectedOpp({ ...selectedOpp, tags: selectedOpp.tags?.filter(t => t !== tag) })}
                                                        >
                                                            {tag}
                                                            {!isLocked && <span className="hidden group-hover:inline">×</span>}
                                                        </span>
                                                    ))}
                                                    {!isLocked && (
                                                        <input
                                                            placeholder="+ Tag"
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    e.preventDefault();
                                                                    const val = e.currentTarget.value.trim().toUpperCase();
                                                                    if (val && !selectedOpp.tags?.includes(val)) {
                                                                        setSelectedOpp({ ...selectedOpp, tags: [...(selectedOpp.tags || []), val] });
                                                                        e.currentTarget.value = '';
                                                                    }
                                                                }
                                                            }}
                                                            className="w-20 bg-transparent border border-dashed border-slate-300 rounded-lg px-2 py-1 text-[9px] font-bold uppercase focus:w-32 transition-all outline-none focus:border-indigo-400"
                                                        />
                                                    )}
                                                </div>
                                            </div>

                                            <div className={`bg-indigo-50/50 p-6 rounded-3xl border border-indigo-50 space-y-4 ${isLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                                                <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest italic">Responsáveis</h4>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1">SDR (Prospecção)</label>
                                                        <select value={selectedOpp.prospector || ''} onChange={e => setSelectedOpp({ ...selectedOpp, prospector: e.target.value })} className="w-full px-4 py-3 bg-white border-2 border-indigo-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase cursor-pointer" disabled={isLocked}>
                                                            <option value="">Selecione...</option>
                                                            {systemUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Closer (Vendedor)</label>
                                                        <select value={selectedOpp.attendant || ''} onChange={e => setSelectedOpp({ ...selectedOpp, attendant: e.target.value })} className="w-full px-4 py-3 bg-white border-2 border-indigo-100 focus:border-indigo-600 rounded-xl outline-none font-bold text-xs uppercase cursor-pointer" disabled={isLocked}>
                                                            <option value="">Selecione...</option>
                                                            {systemUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Status Funil</label>
                                                    <select value={selectedOpp.status} onChange={e => setSelectedOpp({ ...selectedOpp, status: e.target.value as CRMStatus })} className={`w-full px-4 py-3 border-2 rounded-xl outline-none font-black text-xs uppercase cursor-pointer transition-all ${isLocked ? 'bg-slate-900 text-white border-slate-900 shadow-xl' : 'bg-slate-100 border-transparent focus:border-slate-400 text-slate-700'}`}>
                                                        {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                                    </select>
                                                    {isLocked && <p className="text-[8px] font-black text-indigo-500 uppercase mt-2 animate-pulse">🔒 Ficha Bloqueada - Altere o status para editar</p>}
                                                </div>
                                                <div className={isLocked ? 'opacity-50 pointer-events-none' : ''}>
                                                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Próx. Follow-up</label>
                                                    <input type="date" value={selectedOpp.nextFollowUp || ''} onChange={e => setSelectedOpp({ ...selectedOpp, nextFollowUp: e.target.value })} className="w-full px-4 py-3 bg-slate-100 border-2 border-transparent focus:border-slate-400 rounded-xl outline-none font-black text-xs uppercase mb-2" disabled={isLocked} />
                                                    <div className="flex gap-1 justify-between">
                                                        {[7, 15, 30].map(days => (
                                                            <button
                                                                type="button"
                                                                key={days}
                                                                onClick={() => {
                                                                    const d = new Date();
                                                                    d.setDate(d.getDate() + days);
                                                                    setSelectedOpp({ ...selectedOpp, nextFollowUp: d.toISOString().split('T')[0] });
                                                                }}
                                                                className="flex-1 py-2 bg-white border border-slate-200 rounded-lg text-[9px] font-bold text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all uppercase"
                                                                disabled={isLocked}
                                                            >
                                                                +{days} dias
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </form>
                                    </div>
                                </div>
                                <div className="p-6 border-t border-slate-100 flex justify-between items-center bg-white shrink-0">
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
                                    <div className="bg-slate-100 text-slate-500 px-3 py-1 rounded-lg text-[9px] font-black">{mergedTimeline.length} Registros</div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/50 space-y-6" ref={feedScrollRef}>
                                    {mergedTimeline.length === 0 ? (
                                        <div className="text-center py-20 opacity-30">
                                            <ICONS.History className="w-12 h-12 mx-auto mb-3" />
                                            <p className="text-[10px] font-black uppercase">Nenhum registro encontrado.</p>
                                        </div>
                                    ) : (
                                        mergedTimeline.map((item) => {
                                            if (item.type === 'SALE') {
                                                return (
                                                    <div key={item.id} className="flex gap-4">
                                                        <div className="flex flex-col items-center">
                                                            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center font-black text-[10px] shadow-sm uppercase z-10">
                                                                <ICONS.Inventory className="w-4 h-4" />
                                                            </div>
                                                            <div className="w-0.5 flex-1 bg-emerald-100/50 my-2"></div>
                                                        </div>
                                                        <div className="flex-1 bg-white p-4 rounded-2xl rounded-tl-none border border-emerald-100 shadow-sm relative group hover:border-emerald-300 transition-colors">
                                                            <div className="flex justify-between items-start mb-2">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-50 px-2 py-0.5 rounded-md">Venda Tiny</span>
                                                                    <span className="text-[9px] font-bold text-slate-400">{item.date}</span>
                                                                </div>
                                                                <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{item.status}</div>
                                                            </div>
                                                            <div className="text-xs font-black text-slate-700 uppercase flex justify-between items-center">
                                                                <span>{item.content}</span>
                                                                <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                                                                    {Number(item.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return (
                                                <div key={item.id} className="flex gap-4">
                                                    <div className="flex flex-col items-center">
                                                        <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-[10px] shadow-md uppercase z-10">
                                                            {item.initial}
                                                        </div>
                                                        <div className="w-0.5 flex-1 bg-indigo-100 my-2"></div>
                                                    </div>
                                                    <div className="flex-1 bg-white p-5 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm">
                                                        <div className="flex justify-between items-center mb-2">
                                                            <span className="text-[9px] font-black text-indigo-600 uppercase tracking-wider">@{item.user}</span>
                                                            <span className="text-[8px] font-bold text-slate-400">{new Date(item.date).toLocaleString()}</span>
                                                        </div>
                                                        <p className="text-xs text-slate-600 font-medium leading-relaxed whitespace-pre-wrap">{item.content}</p>
                                                    </div>
                                                </div>
                                            );
                                        })
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
                )
            }
        </div>
    );
};

export default CRMModule;
