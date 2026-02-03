
import React, { useEffect, useState } from 'react';
import { supabaseClient } from '../services/core';
import AccountsReceivableImportModal from './AccountsReceivableImportModal';
import { ICONS } from '../constants';

interface AccountsReceivableRow {
    "ID": string;
    "IDCliente": string;
    "Data Emissão": string;
    "Data Vencimento": string;
    "Data Liquidação": string;
    "Valor documento": number;
    "Saldo": number;
    "Situação": string;
    "Número documento": string;
    "Número no banco": string;
    "Categoria": string;
    "Histórico": string;
    "Forma de recebimento": string;
    "Meio de recebimento": string;
    "Taxas": number;
    "Competência": string;
    "Recebimento": string;
    "Recebido": number;
}

const NewAccountsReceivable: React.FC<{ currentUser: any }> = ({ currentUser }) => {
    const [showImportModal, setShowImportModal] = useState(false);
    const [data, setData] = useState<AccountsReceivableRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterMonth, setFilterMonth] = useState("");

    // Advanced Filter State
    const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
    const [advancedFilters, setAdvancedFilters] = useState({
        situation: "",
        paymentForm: "",
        startDate: "",
        endDate: "",
        dateType: "" // Inicia como "Todos" por padrão
    });

    const [searchTerm, setSearchTerm] = useState("");
    const [sortConfig, setSortConfig] = useState<{ key: keyof AccountsReceivableRow | null; direction: 'asc' | 'desc' }>({ key: 'Data Vencimento', direction: 'asc' });

    const COLUMN_CONFIG: { label: string; key: keyof AccountsReceivableRow }[] = [
        { label: "ID", key: "ID" },
        { label: "Cliente", key: "IDCliente" },
        { label: "Emissão", key: "Data Emissão" },
        { label: "Vencimento", key: "Data Vencimento" },
        { label: "Liquidação", key: "Data Liquidação" },
        { label: "Valor Doc", key: "Valor documento" },
        { label: "Saldo", key: "Saldo" },
        { label: "Situação", key: "Situação" },
        { label: "Doc", key: "Número documento" },
        { label: "Banco", key: "Número no banco" },
        { label: "Categoria", key: "Categoria" },
        { label: "Histórico", key: "Histórico" },
        { label: "Forma", key: "Forma de recebimento" },
        { label: "Meio", key: "Meio de recebimento" },
        { label: "Taxas", key: "Taxas" },
        { label: "Comp.", key: "Competência" },
        { label: "Recebimento", key: "Recebimento" },
        { label: "Recebido", key: "Recebido" }
    ];

    const fetchData = async () => {
        setLoading(true);
        try {
            let query = supabaseClient
                .from('accounts_receivable')
                .select('*')
                .limit(5000)
                .order('Data Vencimento', { ascending: true });

            // 1. Filtro de Data
            if (advancedFilters.startDate) {
                if (advancedFilters.dateType) {
                    query = query.gte(advancedFilters.dateType, advancedFilters.startDate);
                    if (advancedFilters.endDate) {
                        query = query.lte(advancedFilters.dateType, advancedFilters.endDate);
                    }
                } else {
                    // Lógica Ampla (Todos): Busca nas 3 colunas simultaneamente
                    const start = advancedFilters.startDate;
                    const end = advancedFilters.endDate || start;
                    const rangeCond = `and(gte.${start},lte.${end})`;
                    query = query.or(`"Data Vencimento".${rangeCond},"Data Liquidação".${rangeCond},"Data Emissão".${rangeCond}`);
                }
            }

            // 2. Filtro de Situação Inteligente
            if (advancedFilters.situation === 'CANCELADO') {
                query = query.ilike('Situação', '%CANCEL%');
            } else if (advancedFilters.situation === 'EM ABERTO') {
                query = query.ilike('Situação', '%ABERT%');
            } else if (advancedFilters.situation) {
                query = query.ilike('Situação', `%${advancedFilters.situation}%`);
            }

            // 3. Forma de Pagamento
            if (advancedFilters.paymentForm) {
                query = query.ilike('Forma de recebimento', `%${advancedFilters.paymentForm}%`);
            }

            const { data: rows, error } = await query;
            if (error) throw error;
            setData(rows as AccountsReceivableRow[] || []);
        } catch (e) {
            console.error('Erro na busca:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [advancedFilters]);

    // Aplicar busca local para ser instantâneo
    const filteredAndSortedData = React.useMemo(() => {
        let processed = [...data];
        if (searchTerm) {
            const lowerTerm = searchTerm.toLowerCase();
            processed = processed.filter(row =>
                Object.values(row).some(val => String(val).toLowerCase().includes(lowerTerm))
            );
        }
        if (sortConfig.key) {
            processed.sort((a, b) => {
                const valA = a[sortConfig.key!] || '';
                const valB = b[sortConfig.key!] || '';
                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return processed;
    }, [data, searchTerm, sortConfig]);

    // KPIs sempre batendo com o que está na tela
    const summaries = React.useMemo(() => {
        return filteredAndSortedData.reduce((acc, curr) => {
            const valRecebido = curr["Recebido"] || 0;
            const valDoc = curr["Valor documento"] || 0;
            const situacaoStr = (curr["Situação"] || '').toLowerCase();
            const isLiquidado = situacaoStr.includes('liquidado') || situacaoStr.includes('pag') || situacaoStr.includes('recebido');

            let itemRecebido = 0;
            if (valRecebido > 0) itemRecebido = valRecebido;
            else if (isLiquidado) itemRecebido = valDoc;

            return {
                totalRecebido: acc.totalRecebido + itemRecebido,
                totalSaldo: acc.totalSaldo + (curr["Saldo"] || 0),
                count: acc.count + 1
            };
        }, { totalRecebido: 0, totalSaldo: 0, count: 0 });
    }, [filteredAndSortedData]);

    const handleSort = (key: keyof AccountsReceivableRow) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        try { return new Date(dateStr).toLocaleDateString('pt-BR'); } catch { return '-'; }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header com Filtros Rápidos */}
            <div className="flex flex-col xl:flex-row justify-between items-end bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm gap-6">
                <div>
                    <h2 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter">Contas a Receber</h2>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Gestão Financeira e Baixas</p>
                </div>

                <div className="flex flex-col xl:flex-row items-end gap-4 w-full xl:w-auto">
                    <div className="flex gap-2 w-full xl:w-auto">
                        <div className="flex-1 xl:w-40">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1 mb-1 block">Filtrar Por</label>
                            <select
                                value={advancedFilters.dateType}
                                onChange={(e) => setAdvancedFilters(prev => ({ ...prev, dateType: e.target.value }))}
                                className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl px-3 outline-none h-[42px]"
                            >
                                <option value="">Todos</option>
                                <option value="Data Vencimento">Vencimento</option>
                                <option value="Data Liquidação">Liquidação</option>
                                <option value="Data Emissão">Emissão</option>
                            </select>
                        </div>
                        <div className="flex-1 xl:w-40">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1 mb-1 block">Mês/Ano</label>
                            <input
                                type="month"
                                value={filterMonth}
                                onChange={(e) => {
                                    setFilterMonth(e.target.value);
                                    if (!e.target.value) {
                                        setAdvancedFilters(prev => ({ ...prev, startDate: "", endDate: "" }));
                                        return;
                                    }
                                    const [y, m] = e.target.value.split('-');
                                    const start = `${e.target.value}-01`;
                                    const end = new Date(parseInt(y), parseInt(m), 0).toISOString().split('T')[0];
                                    setAdvancedFilters(prev => ({ ...prev, startDate: start, endDate: end }));
                                }}
                                className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl px-3 outline-none h-[42px]"
                            />
                        </div>
                    </div>

                    <div className="relative group w-full lg:w-96">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <ICONS.Search className="h-4 w-4 text-slate-400" />
                        </div>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Pesquisar resultados atuais..."
                            className="block w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                        />
                    </div>

                    <div className="flex gap-4">
                        <button
                            onClick={() => setShowAdvancedFilter(!showAdvancedFilter)}
                            className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all shadow-lg text-xs font-black uppercase h-[42px] ${showAdvancedFilter ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 border border-indigo-100 hover:bg-indigo-50'}`}
                        >
                            <ICONS.Filter className="w-4 h-4" />
                            Filtros
                        </button>
                        <button
                            onClick={() => setShowImportModal(true)}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 shadow-lg h-[42px] text-xs font-black uppercase"
                        >
                            <ICONS.Upload className="w-4 h-4" />
                            Importar
                        </button>
                    </div>
                </div>
            </div>

            {/* Painel Avançado */}
            {showAdvancedFilter && (
                <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-[2rem] animate-in slide-in-from-top-4 duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest pl-1">Situação</label>
                            <select
                                value={advancedFilters.situation}
                                onChange={(e) => setAdvancedFilters(prev => ({ ...prev, situation: e.target.value }))}
                                className="w-full bg-white border border-indigo-100 text-indigo-900 text-sm font-bold rounded-xl px-4 py-3 outline-none"
                            >
                                <option value="">Todas</option>
                                <option value="PAGA">Paga</option>
                                <option value="EM ABERTO">Em Aberto</option>
                                <option value="CANCELADO">Cancelado</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest pl-1">Forma Pagto.</label>
                            <select
                                value={advancedFilters.paymentForm}
                                onChange={(e) => setAdvancedFilters(prev => ({ ...prev, paymentForm: e.target.value }))}
                                className="w-full bg-white border border-indigo-100 text-indigo-900 text-sm font-bold rounded-xl px-4 py-3 outline-none"
                            >
                                <option value="">Todas</option>
                                <option value="Boleto">Boleto</option>
                                <option value="Pix">Pix</option>
                                <option value="Cartão">Cartão</option>
                                <option value="Transferência">Transferência</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest pl-1">Data Início</label>
                            <input
                                type="date"
                                value={advancedFilters.startDate}
                                onChange={(e) => setAdvancedFilters(prev => ({ ...prev, startDate: e.target.value }))}
                                className="w-full bg-white border border-indigo-100 text-sm font-bold rounded-xl px-4 py-3 outline-none"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest pl-1">Data Fim</label>
                            <input
                                type="date"
                                value={advancedFilters.endDate}
                                onChange={(e) => setAdvancedFilters(prev => ({ ...prev, endDate: e.target.value }))}
                                className="w-full bg-white border border-indigo-100 text-sm font-bold rounded-xl px-4 py-3 outline-none"
                            />
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end gap-3">
                        <button
                            onClick={() => {
                                setAdvancedFilters({ situation: "", paymentForm: "", startDate: "", endDate: "", dateType: "" });
                                setFilterMonth("");
                                setSearchTerm("");
                                fetchData();
                            }}
                            className="px-6 py-3 bg-red-500 text-white rounded-xl font-black uppercase text-[10px] shadow-lg shadow-red-100 hover:bg-red-600 transition-all"
                        >
                            Limpar Tudo
                        </button>
                    </div>
                </div>
            )}

            {/* Cards de Indicadores */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100">
                    <p className="text-[10px] uppercase font-black text-emerald-400 tracking-widest">Total Recebido (Filtro)</p>
                    <p className="text-3xl font-black text-emerald-600 mt-2 tracking-tighter">{formatCurrency(summaries.totalRecebido)}</p>
                </div>
                <div className="bg-red-50 p-6 rounded-3xl border border-red-100">
                    <p className="text-[10px] uppercase font-black text-red-400 tracking-widest">Saldo em Aberto (Filtro)</p>
                    <p className="text-3xl font-black text-red-600 mt-2 tracking-tighter">{formatCurrency(summaries.totalSaldo)}</p>
                </div>
                <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100">
                    <p className="text-[10px] uppercase font-black text-blue-400 tracking-widest">Qtd. Títulos</p>
                    <p className="text-3xl font-black text-blue-600 mt-2 tracking-tighter">{summaries.count}</p>
                </div>
            </div>

            {/* Tabela de Dados */}
            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto min-h-[400px]">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                            <tr>
                                {COLUMN_CONFIG.map((col) => (
                                    <th
                                        key={col.key}
                                        onClick={() => handleSort(col.key)}
                                        className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:bg-slate-100 hover:text-blue-500 transition-colors select-none group"
                                    >
                                        <div className="flex items-center gap-1">
                                            {col.label}
                                            <div className="flex flex-col opacity-30 group-hover:opacity-100 transition-opacity">
                                                {sortConfig.key === col.key && sortConfig.direction === 'asc' ? (
                                                    <span className="text-blue-600">▲</span>
                                                ) : sortConfig.key === col.key && sortConfig.direction === 'desc' ? (
                                                    <span className="text-blue-600">▼</span>
                                                ) : (
                                                    <><span className="text-[6px] leading-[6px]">▲</span><span className="text-[6px] leading-[6px]">▼</span></>
                                                )}
                                            </div>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {loading ? (
                                <tr><td colSpan={18} className="p-10 text-center text-xs font-bold text-slate-400 uppercase animate-pulse">Buscando dados...</td></tr>
                            ) : filteredAndSortedData.length === 0 ? (
                                <tr><td colSpan={18} className="p-10 text-center text-xs font-bold text-slate-400 uppercase">Nenhum registro para este filtro.</td></tr>
                            ) : (
                                filteredAndSortedData.map((row) => (
                                    <tr key={row.ID} className="hover:bg-blue-50/30 transition-colors group">
                                        <td className="p-3 text-[10px] font-bold text-slate-500">{row.ID}</td>
                                        <td className="p-3 text-[10px] font-bold text-slate-800 truncate max-w-[150px]">{row.IDCliente}</td>
                                        <td className="p-3 text-[10px] text-slate-500">{formatDate(row["Data Emissão"])}</td>
                                        <td className="p-3 text-[10px] font-bold text-slate-700">{formatDate(row["Data Vencimento"])}</td>
                                        <td className="p-3 text-[10px] text-emerald-600 font-bold">{formatDate(row["Data Liquidação"])}</td>
                                        <td className="p-3 text-[10px] font-bold text-slate-600">{formatCurrency(row["Valor documento"])}</td>
                                        <td className="p-3 text-[10px] text-slate-400">{formatCurrency(row["Saldo"])}</td>
                                        <td className="p-3">
                                            <span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase ${(row["Situação"] || '').toLowerCase().includes('paga') ||
                                                (row["Situação"] || '').toLowerCase().includes('liquidado')
                                                ? 'bg-emerald-100 text-emerald-600'
                                                : (row["Situação"] || '').toLowerCase().includes('abert')
                                                    ? 'bg-amber-100 text-amber-600'
                                                    : (row["Situação"] || '').toLowerCase().includes('cancel')
                                                        ? 'bg-red-100 text-red-600'
                                                        : 'bg-slate-100 text-slate-500'
                                                }`}>
                                                {row["Situação"]}
                                            </span>
                                        </td>
                                        <td className="p-3 text-[9px] text-slate-400">{row["Número documento"]}</td>
                                        <td className="p-3 text-[9px] text-slate-400">{row["Número no banco"]}</td>
                                        <td className="p-3 text-[9px] text-slate-500 truncate max-w-[100px]">{row["Categoria"]}</td>
                                        <td className="p-3 text-[9px] text-slate-400 truncate max-w-[150px]">{row["Histórico"]}</td>
                                        <td className="p-3 text-[9px] text-slate-500">{row["Forma de recebimento"]}</td>
                                        <td className="p-3 text-[9px] text-slate-500">{row["Meio de recebimento"]}</td>
                                        <td className="p-3 text-[9px] text-red-400">{formatCurrency(row["Taxas"])}</td>
                                        <td className="p-3 text-[9px] text-slate-500">{row["Competência"]}</td>
                                        <td className="p-3 text-[9px] text-emerald-600">{formatDate(row["Recebimento"])}</td>
                                        <td className="p-3 text-[10px] font-black text-emerald-600 bg-emerald-50/50">{formatCurrency(row["Recebido"])}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {showImportModal && (
                <AccountsReceivableImportModal
                    onClose={() => setShowImportModal(false)}
                    onSuccess={() => {
                        setShowImportModal(false);
                        fetchData();
                    }}
                />
            )}
        </div>
    );
};

export default NewAccountsReceivable;
