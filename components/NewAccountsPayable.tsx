
import React, { useEffect, useState } from 'react';
import { supabaseClient } from '../services/core';
import { FinanceService } from '../services/financeService';
import AccountsPayableImportModal from './AccountsPayableImportModal';
import { ICONS } from '../constants';

interface AccountsPayableRow {
    "id": string;
    "fornecedor": string;
    "data_emissao": string;
    "data_vencimento": string;
    "data_liquidacao": string;
    "valor_documento": number;
    "saldo": number;
    "situacao": string;
    "numero_documento": string;
    "categoria": string;
    "historico": string;
    "forma_pagamento": string;
    "valor_pago": number;
    "competencia": string;
}

const NewAccountsPayable: React.FC<{ currentUser: any }> = ({ currentUser }) => {
    const [showImportModal, setShowImportModal] = useState(false);
    const [data, setData] = useState<AccountsPayableRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterMonth, setFilterMonth] = useState("");
    const [lastImportDate, setLastImportDate] = useState<string | null>(null);

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
    const [sortConfig, setSortConfig] = useState<{ key: keyof AccountsPayableRow | null; direction: 'asc' | 'desc' }>({ key: 'data_vencimento', direction: 'asc' });

    const COLUMN_CONFIG: { label: string; key: keyof AccountsPayableRow }[] = [
        { label: "ID", key: "id" },
        { label: "Fornecedor", key: "fornecedor" },
        { label: "Emissão", key: "data_emissao" },
        { label: "Vencimento", key: "data_vencimento" },
        { label: "Liquidação", key: "data_liquidacao" },
        { label: "Valor Doc", key: "valor_documento" },
        { label: "Saldo", key: "saldo" },
        { label: "Situação", key: "situacao" },
        { label: "Doc", key: "numero_documento" },
        { label: "Categoria", key: "categoria" },
        { label: "Histórico", key: "historico" },
        { label: "Forma", key: "forma_pagamento" },
        { label: "Comp.", key: "competencia" },
        { label: "Pago", key: "valor_pago" }
    ];

    const fetchData = async () => {
        setLoading(true);
        try {
            let query = supabaseClient
                .from('accounts_payable')
                .select('*')
                .limit(5000)
                .order('data_vencimento', { ascending: true });

            // 1. Filtro de Data
            // 1. Filtro de Data
            // 1. Filtro de Data (BANCO DE DADOS)
            if (advancedFilters.startDate) {
                if (advancedFilters.dateType) {
                    query = query.gte(advancedFilters.dateType, advancedFilters.startDate);
                    if (advancedFilters.endDate) {
                        query = query.lte(advancedFilters.dateType, advancedFilters.endDate);
                    }
                } else {
                    // Lógica Ampla (Todos)
                    const start = advancedFilters.startDate;
                    const end = advancedFilters.endDate || start;
                    const rangeCond = `and(gte.${start},lte.${end})`;
                    query = query.or(`data_vencimento.${rangeCond},data_liquidacao.${rangeCond},data_emissao.${rangeCond}`);
                }
            }

            const { data: rawRows, error } = await query;
            if (error) throw error;

            // 2. Filtros de Refinamento (CLIENT SIDE - Garantia de Precisão)
            let processedRows = rawRows as AccountsPayableRow[] || [];

            if (advancedFilters.situation) {
                const searchSit = advancedFilters.situation.toUpperCase();
                processedRows = processedRows.filter(row => {
                    const s = (row.situacao || '').toUpperCase();
                    if (searchSit === 'CANCELADO') return s.includes('CANCEL');
                    if (searchSit === 'EM ABERTO') return s.includes('ABERTO') || s.includes('PENDENTE') || s.includes('VENCID') || s.includes('A VENCER');
                    if (searchSit === 'PAGA') return s.includes('PAG') || s.includes('LIQUID');
                    return s.includes(searchSit);
                });
            }

            if (advancedFilters.paymentForm) {
                const searchForm = advancedFilters.paymentForm.toUpperCase();
                processedRows = processedRows.filter(row => (row.forma_pagamento || '').toUpperCase().includes(searchForm));
            }

            setData(processedRows);

            // Fetch last import date logic
            FinanceService.getLastAPImport().then(res => {
                if (res?.timestamp) {
                    setLastImportDate(new Date(res.timestamp).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                    }));
                }
            });
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
            const valPago = curr["valor_pago"] || 0;
            const valDoc = curr["valor_documento"] || 0;
            const situacaoStr = (curr["situacao"] || '').toLowerCase();
            const isLiquidado = situacaoStr.includes('liquidado') || situacaoStr.includes('pag') || situacaoStr.includes('recebido');

            let itemPago = 0;
            if (valPago > 0) itemPago = valPago;
            else if (isLiquidado) itemPago = valDoc;

            return {
                totalPago: acc.totalPago + itemPago,
                totalSaldo: acc.totalSaldo + (curr["saldo"] || 0),
                count: acc.count + 1
            };
        }, { totalPago: 0, totalSaldo: 0, count: 0 });
    }, [filteredAndSortedData]);

    const handleSort = (key: keyof AccountsPayableRow) => {
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
        // Fix: Use string splitting to avoid Timezone shifts (Browser interpreting YYYY-MM-DD as UTC midnight)
        if (dateStr.includes('T')) dateStr = dateStr.split('T')[0];
        const parts = dateStr.split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return dateStr;
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header com Filtros Rápidos */}
            <div className="flex flex-col xl:flex-row justify-between items-end bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm gap-6">
                <div>
                    <h2 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter">Contas a Pagar</h2>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Gestão de Despesas e Pagamentos</p>
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
                                <option value="data_vencimento">Vencimento</option>
                                <option value="data_liquidacao">Liquidação</option>
                                <option value="data_emissao">Emissão</option>
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
                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl flex items-center gap-3 shadow-lg shadow-emerald-100 h-auto min-h-[42px] transition-all"
                        >
                            <ICONS.Upload className="w-5 h-5" />
                            <div className="flex flex-col items-start leading-none">
                                <span className="text-xs font-black uppercase">Importar</span>
                                {lastImportDate && (
                                    <span className="text-[9px] font-medium opacity-80 mt-0.5">Atualizado: {lastImportDate}</span>
                                )}
                            </div>
                        </button>
                    </div>
                </div>
            </div>

            {/* Painel Avançado */}
            {showAdvancedFilter && (
                <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-[2rem] animate-in slide-in-from-top-4 duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-end">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest pl-1">Filtrar Por</label>
                            <select
                                value={advancedFilters.dateType}
                                onChange={(e) => setAdvancedFilters(prev => ({ ...prev, dateType: e.target.value }))}
                                className="w-full bg-white border border-indigo-100 text-indigo-900 text-sm font-bold rounded-xl px-4 py-3 outline-none"
                            >
                                <option value="">Todos</option>
                                <option value="data_vencimento">Vencimento</option>
                                <option value="data_liquidacao">Liquidação</option>
                                <option value="data_emissao">Emissão</option>
                            </select>
                        </div>
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
                    <p className="text-[10px] uppercase font-black text-emerald-400 tracking-widest">Total Pago (Filtro)</p>
                    <p className="text-3xl font-black text-emerald-600 mt-2 tracking-tighter">{formatCurrency(summaries.totalPago)}</p>
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
                                <tr><td colSpan={14} className="p-10 text-center text-xs font-bold text-slate-400 uppercase animate-pulse">Buscando dados...</td></tr>
                            ) : filteredAndSortedData.length === 0 ? (
                                <tr><td colSpan={14} className="p-10 text-center text-xs font-bold text-slate-400 uppercase">Nenhum registro para este filtro.</td></tr>
                            ) : (
                                filteredAndSortedData.map((row) => (
                                    <tr key={row.id} className="hover:bg-blue-50/30 transition-colors group">
                                        <td className="p-3 text-[10px] font-bold text-slate-500">{row.id}</td>
                                        <td className="p-3 text-[10px] font-bold text-slate-800 truncate max-w-[150px]">{row.fornecedor}</td>
                                        <td className="p-3 text-[10px] text-slate-500">{formatDate(row.data_emissao)}</td>
                                        <td className="p-3 text-[10px] font-bold text-slate-700">{formatDate(row.data_vencimento)}</td>
                                        <td className="p-3 text-[10px] text-emerald-600 font-bold">{formatDate(row.data_liquidacao)}</td>
                                        <td className="p-3 text-[10px] font-bold text-slate-600">{formatCurrency(row.valor_documento)}</td>
                                        <td className="p-3 text-[10px] text-slate-400">{formatCurrency(row.saldo)}</td>
                                        <td className="p-3">
                                            <span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase ${(row.situacao || '').toLowerCase().includes('paga') ||
                                                (row.situacao || '').toLowerCase().includes('liquidado')
                                                ? 'bg-emerald-100 text-emerald-600'
                                                : (row.situacao || '').toLowerCase().includes('abert')
                                                    ? 'bg-amber-100 text-amber-600'
                                                    : (row.situacao || '').toLowerCase().includes('cancel')
                                                        ? 'bg-red-100 text-red-600'
                                                        : 'bg-slate-100 text-slate-500'
                                                }`}>
                                                {row.situacao}
                                            </span>
                                        </td>
                                        <td className="p-3 text-[9px] text-slate-400">{row.numero_documento}</td>
                                        <td className="p-3 text-[9px] text-slate-500 truncate max-w-[100px]">{row.categoria}</td>
                                        <td className="p-3 text-[9px] text-slate-400 truncate max-w-[150px]">{row.historico}</td>
                                        <td className="p-3 text-[9px] text-slate-500">{row.forma_pagamento}</td>
                                        <td className="p-3 text-[9px] text-slate-500">{row.competencia}</td>
                                        <td className="p-3 text-[10px] font-black text-emerald-600 bg-emerald-50/50">{formatCurrency(row.valor_pago)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {showImportModal && (
                <AccountsPayableImportModal
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

export default NewAccountsPayable;
