
import React, { useState, useEffect, useMemo } from 'react';
import { FinanceService } from '../services/financeService';
import { AccountsPayable } from '../types';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    PieChart, Pie, Cell, AreaChart, Area, ComposedChart, Line
} from 'recharts';
import { ICONS } from '../constants';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b'];

const ExpenseBI: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [payables, setPayables] = useState<AccountsPayable[]>([]);
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [prevMonthData, setPrevMonthData] = useState<AccountsPayable[]>([]);

    // Modal State
    const [selectedDayDetails, setSelectedDayDetails] = useState<{ date: string, items: AccountsPayable[] } | null>(null);
    const [selectedCategoryDetails, setSelectedCategoryDetails] = useState<{ category: string, items: AccountsPayable[] } | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const data = await FinanceService.getAccountsPayable();
                setPayables(data || []);
            } catch (e) {
                console.error("Erro ao carregar dados do BI Despesas", e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const analyzedData = useMemo(() => {
        const [year, month] = selectedMonth.split('-').map(Number);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Filter current month
        const currentItems = payables.filter(p => {
            if (!p.dataVencimento) return false;
            const [pYear, pMonth] = p.dataVencimento.split('-').map(Number);
            return pYear === year && pMonth === month;
        });

        // Filter previous month for MoM comparison
        const prevDate = new Date(year, month - 2, 1);
        const pYear = prevDate.getFullYear();
        const pMonth = prevDate.getMonth() + 1;
        const previousItems = payables.filter(p => {
            if (!p.dataVencimento) return false;
            const [itemYear, itemMonth] = p.dataVencimento.split('-').map(Number);
            return itemYear === pYear && itemMonth === pMonth;
        });

        // Mappings for Fixas vs Variaveis & OPEX
        const CATEGORY_MESSAGES = {
            FIXAS: ['ALUGUEL', 'FOLHA', 'PRO-LABORE', 'PRO LABORE', 'CONTABILIDADE', 'INTERNET', 'SISTEMA', 'CONDOMINIO', 'FIXA'],
            OPEX: ['ADMINISTRATIVO', 'OPERACIONAL', 'MANUTENÇÃO', 'SERVIÇOS', 'MARKETING', 'LIMPEZA', 'VENDAS']
        };

        const isFixed = (cat: string) => CATEGORY_MESSAGES.FIXAS.some(f => cat.toUpperCase().includes(f));
        const isOPEX = (cat: string) => isFixed(cat) || CATEGORY_MESSAGES.OPEX.some(o => cat.toUpperCase().includes(o));

        // KPIs Calculation
        let totalDespesas = 0;
        let totalFixas = 0;
        let totalVariaveis = 0;
        let totalOPEX = 0;
        let totalPago = 0;
        let totalAberto = 0;
        let totalVencido = 0;
        let docCount = currentItems.length;
        let paidOnTimeCount = 0;
        let totalPaidDocs = 0;

        const categoryMap: Record<string, number> = {};
        const supplierMap: Record<string, number> = {};
        const dailyMap: Record<number, { value: number, items: AccountsPayable[], paid: number, open: number }> = {};
        const daysInMonth = new Date(year, month, 0).getDate();
        for (let i = 1; i <= daysInMonth; i++) dailyMap[i] = { value: 0, items: [], paid: 0, open: 0 };

        currentItems.forEach(item => {
            const valor = Number(item.valorDocumento || item.valor_documento || 0);
            const saldo = Number(item.saldo || 0);
            const valorPagoItem = Number(item.valorPago || item.valor_pago || 0);
            const sit = (item.situacao || '').toUpperCase();
            const isPaid = sit.includes('PAGA') || sit.includes('PAGO') || sit.includes('LIQUID') || saldo <= 0.01;
            const cat = (item.categoria || 'OUTROS').toUpperCase();
            const vencimento = new Date(item.dataVencimento || item.data_vencimento);
            const liquidacao = item.dataLiquidacao || item.data_liquidacao ? new Date(item.dataLiquidacao || item.data_liquidacao) : null;

            totalDespesas += valor;
            if (isPaid) {
                totalPago += valorPagoItem || valor;
                totalPaidDocs++;
                // Pontualidade check
                if (liquidacao && liquidacao <= vencimento) paidOnTimeCount++;
            } else {
                totalAberto += saldo;
                if (vencimento < today) totalVencido += saldo;
            }

            // Fixas vs Variaveis
            if (isFixed(cat)) totalFixas += valor;
            else totalVariaveis += valor;

            // OPEX
            if (isOPEX(cat)) totalOPEX += valor;

            // Breakdown Maps
            categoryMap[cat] = (categoryMap[cat] || 0) + valor;
            const forn = item.fornecedor || 'DESCONHECIDO';
            supplierMap[forn] = (supplierMap[forn] || 0) + valor;

            const day = vencimento.getDate();
            if (dailyMap[day]) {
                dailyMap[day].value += valor;
                dailyMap[day].items.push(item);
                if (isPaid) dailyMap[day].paid += valor;
                else dailyMap[day].open += valor;
            }
        });

        // MoM comparison
        const prevTotal = previousItems.reduce((acc, curr) => acc + Number(curr.valorDocumento || curr.valor_documento || 0), 0);
        const momPercentage = prevTotal > 0 ? ((totalDespesas - prevTotal) / prevTotal) * 100 : 0;

        // Financial Metrics
        const ticketMedio = docCount > 0 ? totalDespesas / docCount : 0;
        const pontualidade = totalPaidDocs > 0 ? (paidOnTimeCount / totalPaidDocs) * 100 : 0;
        const fixedPercent = totalDespesas > 0 ? (totalFixas / totalDespesas) * 100 : 0;

        // Chart Formatters
        const categoryChart = Object.entries(categoryMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);

        const supplierChart = Object.entries(supplierMap)
            .map(([name, value]) => ({ name: name.length > 20 ? name.substring(0, 18) + '...' : name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);

        const timelineChart = Object.keys(dailyMap).map(d => ({
            day: Number(d),
            total: dailyMap[Number(d)].value,
            pago: dailyMap[Number(d)].paid,
            aberto: dailyMap[Number(d)].open
        }));

        const typeChart = [
            { name: 'Fixas', value: totalFixas },
            { name: 'Variáveis', value: totalVariaveis }
        ];

        return {
            kpis: {
                totalDespesas,
                totalOPEX,
                ticketMedio,
                pontualidade,
                momPercentage,
                fixedPercent,
                totalAberto,
                totalVencido,
                totalPago
            },
            charts: {
                categoryChart,
                supplierChart,
                timelineChart,
                typeChart
            },
            dailyBreakdown: Object.entries(dailyMap).map(([day, data]) => ({ day: Number(day), ...data })).filter(d => d.value > 0),
            currentItems // Expose items for filtering
        };
    }, [payables, selectedMonth]);

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-full opacity-50">
            <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-4 font-black uppercase text-xs tracking-widest text-slate-400">Gerando Inteligência Financeira...</p>
        </div>
    );

    const { kpis, charts, dailyBreakdown, currentItems } = analyzedData;

    const handleCategoryClick = (categoryName: string) => {
        const items = currentItems.filter(i => (i.categoria || 'OUTROS').toUpperCase() === categoryName.toUpperCase());
        setSelectedCategoryDetails({ category: categoryName, items });
    };

    const formatCurrency = (val: number) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return (
        <div className="space-y-8 animate-in fade-in duration-500 h-full flex flex-col pb-10">

            {/* HEADER PREMIUM */}
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 shrink-0">
                <div>
                    <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">BI de Despesas</h2>
                    <div className="flex items-center gap-2 mt-2">
                        <p className="text-[10px] font-black text-red-600 uppercase tracking-[0.3em] italic">Análise de OPEX & Performance Financeira</p>
                        <div className="px-2 py-0.5 bg-red-50 text-red-600 rounded text-[8px] font-black uppercase">Market Standard</div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="bg-white p-2 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-3">
                        <ICONS.Search className="w-4 h-4 text-slate-400 ml-2" />
                        <input
                            type="month"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                            className="bg-transparent border-none outline-none text-xs font-black text-slate-700 uppercase pr-4 cursor-pointer"
                        />
                    </div>
                    <button className="bg-slate-900 text-white p-3 rounded-2xl shadow-lg hover:bg-slate-800 transition-all group">
                        <ICONS.Filter className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                    </button>
                </div>
            </div>

            {/* KPI GRID - 1st Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 shrink-0">
                {/* TOTAL DESPESAS */}
                <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden group">
                    <div className="absolute right-[-20px] top-[-20px] bg-slate-50 w-32 h-32 rounded-full group-hover:scale-110 transition-transform duration-500"></div>
                    <div className="relative z-10">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Desembolso (Mês)</p>
                        <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter">{formatCurrency(kpis.totalDespesas)}</h3>
                        <div className={`flex items-center gap-1 mt-2 text-[10px] font-bold ${kpis.momPercentage > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                            <span>{kpis.momPercentage > 0 ? '▲' : '▼'} {Math.abs(kpis.momPercentage).toFixed(1)}%</span>
                            <span className="text-slate-400 font-medium">vs mês ant.</span>
                        </div>
                    </div>
                </div>

                {/* OPEX */}
                <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden group">
                    <div className="absolute right-[-20px] top-[-20px] bg-blue-50 w-32 h-32 rounded-full group-hover:scale-110 transition-transform duration-500"></div>
                    <div className="relative z-10">
                        <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mb-1">OPEX (Operação)</p>
                        <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter">{formatCurrency(kpis.totalOPEX)}</h3>
                        <p className="text-[9px] text-slate-400 font-bold mt-2 uppercase">Gasto Essencial p/ Rodar</p>
                    </div>
                </div>

                {/* TICKET MÉDIO */}
                <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden group">
                    <div className="absolute right-[-20px] top-[-20px] bg-amber-50 w-32 h-32 rounded-full group-hover:scale-110 transition-transform duration-500"></div>
                    <div className="relative z-10">
                        <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">Ticket Médio Despesa</p>
                        <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter">{formatCurrency(kpis.ticketMedio)}</h3>
                        <p className="text-[9px] text-slate-400 font-bold mt-2 uppercase">Valor por Documento</p>
                    </div>
                </div>

                {/* PONTUALIDADE */}
                <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950"></div>
                    <div className="relative z-10">
                        <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">Índice de Pontualidade</p>
                        <h3 className="text-4xl font-black text-white italic tracking-tighter">{kpis.pontualidade.toFixed(1)}%</h3>
                        <div className="w-full bg-white/10 h-1.5 rounded-full mt-3 overflow-hidden">
                            <div className="bg-emerald-500 h-full rounded-full transition-all duration-1000" style={{ width: `${kpis.pontualidade}%` }}></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* DASHBOARD GRID */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0">

                {/* LEFT COLUMN: Trends and Fixed vs Var */}
                <div className="lg:col-span-2 space-y-8 flex flex-col">

                    {/* TREND CHART */}
                    <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm flex-1 min-h-[400px] flex flex-col">
                        <div className="flex justify-between items-center mb-8">
                            <div>
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Tendência de Desembolso</h4>
                                <p className="text-2xl font-black text-slate-900 tracking-tighter uppercase italic">Timeline do Período</p>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                    <span className="text-[9px] font-black text-slate-400 uppercase">Liquidado</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-slate-200"></div>
                                    <span className="text-[9px] font-black text-slate-400 uppercase">Previsto</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex-1">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={charts.timelineChart}>
                                    <defs>
                                        <linearGradient id="colorPago" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} tickFormatter={(val) => `R$${(val / 1000).toFixed(0)}k`} />
                                    <Tooltip
                                        contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 10px 40px -10px rgba(0,0,0,0.1)', padding: '20px' }}
                                        formatter={(val: number) => formatCurrency(val)}
                                        labelFormatter={(label) => `Dia ${label}`}
                                    />
                                    <Area name="Total Previsto" type="monotone" dataKey="total" stroke="#cbd5e1" strokeWidth={2} strokeDasharray="5 5" fill="none" />
                                    <Area name="Total Liquidado" type="monotone" dataKey="pago" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorPago)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* SECONDARY KPIS & FIXED CHART */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col">
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Estrutura de Custo</h4>
                            <div className="flex-1 flex items-center gap-8">
                                <div className="w-1/2 h-32">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={charts.typeChart} innerRadius={40} outerRadius={60} paddingAngle={10} dataKey="value">
                                                <Cell fill="#3b82f6" />
                                                <Cell fill="#fbbf24" />
                                            </Pie>
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="w-1/2 space-y-4">
                                    <div>
                                        <p className="text-[9px] font-black text-blue-600 uppercase mb-1">Fixas</p>
                                        <p className="text-xl font-black text-slate-900">{kpis.fixedPercent.toFixed(0)}%</p>
                                        <div className="w-full bg-slate-100 h-1 rounded-full"><div className="bg-blue-600 h-full" style={{ width: `${kpis.fixedPercent}%` }}></div></div>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-amber-500 uppercase mb-1">Variáveis</p>
                                        <p className="text-xl font-black text-slate-900">{(100 - kpis.fixedPercent).toFixed(0)}%</p>
                                        <div className="w-full bg-slate-100 h-1 rounded-full"><div className="bg-amber-500 h-full" style={{ width: `${100 - kpis.fixedPercent}%` }}></div></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-900 p-8 rounded-[3rem] shadow-xl text-white flex flex-col justify-center">
                            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-2">Painel de Alerta</p>
                            <div className="space-y-6">
                                <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl">
                                    <span className="text-xs font-bold text-slate-400 uppercase">Vencido</span>
                                    <span className="text-xl font-black text-red-500">{formatCurrency(kpis.totalVencido)}</span>
                                </div>
                                <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl">
                                    <span className="text-xs font-bold text-slate-400 uppercase">A Pagar</span>
                                    <span className="text-xl font-black text-amber-500">{formatCurrency(kpis.totalAberto)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: Pie and Ranking */}
                <div className="space-y-8 flex flex-col">

                    {/* COMPOSITION DONUT */}
                    <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col h-[400px]">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Mix de Categorias</h4>
                        <div className="flex-1 relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={charts.categoryChart}
                                        innerRadius={70}
                                        outerRadius={100}
                                        stroke="none"
                                        paddingAngle={5}
                                        dataKey="value"
                                        onClick={(data) => handleCategoryClick(data.name)}
                                        className="cursor-pointer focus:outline-none"
                                    >
                                        {charts.categoryChart.map((_, index) => (
                                            <Cell key={index} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(val: number) => formatCurrency(val)} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-[9px] font-black text-slate-400 uppercase">Dominante</span>
                                <span className="text-sm font-black text-slate-900 uppercase italic truncate max-w-[120px]">{charts.categoryChart[0]?.name || '-'}</span>
                            </div>
                        </div>
                        <div className="mt-6 flex flex-wrap gap-3 justify-center">
                            {charts.categoryChart.slice(0, 4).map((c, idx) => (
                                <div key={idx} className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
                                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                                    <span className="text-[8px] font-black text-slate-600 uppercase tracking-tight truncate max-w-[60px]">{c.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* SUPPLIER RANKING */}
                    <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm flex-1 flex flex-col overflow-hidden lowercase">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Top 5 Credores</h4>
                        <div className="space-y-6 overflow-auto custom-scrollbar pr-2 flex-1">
                            {charts.supplierChart.map((s, idx) => {
                                const max = charts.supplierChart[0]?.value || 1;
                                const ratio = (s.value / max) * 100;
                                return (
                                    <div key={idx} className="group">
                                        <div className="flex justify-between items-end mb-2">
                                            <span className="text-[10px] font-black text-slate-700 uppercase tracking-tighter truncate w-36">{idx + 1}. {s.name}</span>
                                            <span className="text-[10px] font-black text-slate-900">{formatCurrency(s.value)}</span>
                                        </div>
                                        <div className="w-full h-2 bg-slate-50 rounded-full overflow-hidden">
                                            <div className="bg-slate-900 h-full rounded-full transition-all duration-1000 origin-left scale-x-0 group-hover:scale-x-100 group-hover:bg-blue-600" style={{ width: `${ratio}%`, transform: 'scaleX(1)' }}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* DETAILED TABLE */}
            <div className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden shrink-0">
                <div className="px-10 py-6 border-b border-slate-50 bg-slate-50/30 flex justify-between items-center">
                    <h4 className="text-[10px] font-black text-slate-900 uppercase tracking-widest italic">Detalhamento de Fluxo Diário</h4>
                    <div className="flex gap-2">
                        <div className="px-3 py-1 bg-emerald-100 text-emerald-600 rounded-full text-[8px] font-black uppercase">Liquidado</div>
                        <div className="px-3 py-1 bg-amber-100 text-amber-600 rounded-full text-[8px] font-black uppercase">Aberto</div>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/50 text-slate-400 text-[9px] font-black uppercase tracking-widest">
                            <tr>
                                <th className="px-10 py-5">Data Vencimento</th>
                                <th className="px-10 py-5 text-center">Títulos</th>
                                <th className="px-10 py-5 text-right">Valor Total</th>
                                <th className="px-10 py-5">Rateio Status</th>
                                <th className="px-10 py-5 text-right">Ação</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {dailyBreakdown.map(day => (
                                <tr key={day.day} className="hover:bg-blue-50/30 transition-all cursor-pointer group" onClick={() => setSelectedDayDetails({ date: `${day.day}/${selectedMonth.split('-')[1]}/${selectedMonth.split('-')[0]}`, items: day.items })}>
                                    <td className="px-10 py-5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center font-black text-slate-800 text-lg">{day.day}</div>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">de {selectedMonth.split('-')[1]}</span>
                                        </div>
                                    </td>
                                    <td className="px-10 py-5 text-center font-black text-slate-600">{day.items.length}</td>
                                    <td className="px-10 py-5 text-right font-black text-slate-900 text-sm">{formatCurrency(day.value)}</td>
                                    <td className="px-10 py-5">
                                        <div className="flex items-center gap-3">
                                            <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                                                <div style={{ width: `${(day.paid / day.value) * 100}%` }} className="bg-emerald-500 h-full"></div>
                                                <div style={{ width: `${(day.open / day.value) * 100}%` }} className="bg-amber-400 h-full"></div>
                                            </div>
                                            <span className="text-[10px] font-black text-slate-400 min-w-[30px]">{((day.paid / day.value) * 100).toFixed(0)}%</span>
                                        </div>
                                    </td>
                                    <td className="px-10 py-5 text-right">
                                        <button className="w-10 h-10 rounded-xl bg-white border border-slate-100 text-slate-300 flex items-center justify-center group-hover:bg-slate-900 group-hover:text-white group-hover:border-slate-900 transition-all shadow-sm">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* MODAL DETALHADO (SYNCED WITH DESIGN) */}
            {selectedDayDetails && (
                <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[500] flex items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-200">
                    <div className="bg-white max-w-5xl w-full rounded-[4rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white/20">
                        <div className="px-12 py-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <div className="flex items-center gap-3 mb-1">
                                    <h3 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter">Extrato do Dia {selectedDayDetails.date}</h3>
                                    <span className="px-3 py-1 bg-red-100 text-red-600 rounded-full text-[9px] font-black uppercase">{selectedDayDetails.items.length} Títulos</span>
                                </div>
                                <p className="text-slate-400 font-bold text-[10px] uppercase tracking-[0.2em] italic">Detalhamento técnico de despesas vinculadas</p>
                            </div>
                            <button onClick={() => setSelectedDayDetails(null)} className="w-12 h-12 bg-white border border-slate-100 rounded-2xl text-slate-300 hover:text-red-500 hover:rotate-90 transition-all flex items-center justify-center shadow-sm">
                                <ICONS.Add className="w-8 h-8 rotate-45" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-auto p-12 custom-scrollbar space-y-4">
                            {selectedDayDetails.items.map((item, i) => {
                                const val = Number(item.valorDocumento || item.valor_documento || 0);
                                const saldo = Number(item.saldo || 0);
                                const sit = (item.situacao || '').toUpperCase();
                                const isPago = sit.includes('PAGA') || sit.includes('PAGO') || sit.includes('LIQUID') || saldo <= 0.01;

                                return (
                                    <div key={i} className="bg-slate-50/50 p-6 rounded-[2rem] border border-slate-100 flex items-center gap-6 hover:bg-white hover:shadow-xl hover:border-blue-100 transition-all group">
                                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${isPago ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                                            <ICONS.History className="w-6 h-6" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <p className="font-black text-slate-900 text-sm uppercase italic truncate">{item.fornecedor}</p>
                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded text-[7px] font-black uppercase">DOC: {item.numero_documento || item.numeroDocumento || 'S/N'}</span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-slate-100">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                                                    <span className="text-[8px] font-black text-slate-500 uppercase">{item.categoria}</span>
                                                </div>
                                                <p className="text-[10px] text-slate-400 font-medium truncate italic">{item.historico}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-black text-slate-900 text-lg italic tracking-tighter">{formatCurrency(val)}</p>
                                            <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${isPago ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                {isPago ? 'Totalmente Pago' : `Aberto: ${formatCurrency(saldo)}`}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* CATEGORY DETAILED MODAL */}
            {selectedCategoryDetails && (
                <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[600] flex items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-200">
                    <div className="bg-white max-w-5xl w-full rounded-[4rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white/20">
                        <div className="px-12 py-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <div className="flex items-center gap-3 mb-1">
                                    <h3 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter">Categoria: {selectedCategoryDetails.category}</h3>
                                    <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-[9px] font-black uppercase">{selectedCategoryDetails.items.length} Títulos</span>
                                </div>
                                <p className="text-slate-400 font-bold text-[10px] uppercase tracking-[0.2em] italic">Detalhamento por Grupo de Despesa</p>
                            </div>
                            <button onClick={() => setSelectedCategoryDetails(null)} className="w-12 h-12 bg-white border border-slate-100 rounded-2xl text-slate-300 hover:text-red-500 hover:rotate-90 transition-all flex items-center justify-center shadow-sm">
                                <ICONS.Add className="w-8 h-8 rotate-45" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-auto p-12 custom-scrollbar space-y-4">
                            {selectedCategoryDetails.items.map((item, i) => {
                                const val = Number(item.valorDocumento || item.valor_documento || 0);
                                const saldo = Number(item.saldo || 0);
                                const sit = (item.situacao || '').toUpperCase();
                                const isPago = sit.includes('PAGA') || sit.includes('PAGO') || sit.includes('LIQUID') || saldo <= 0.01;

                                return (
                                    <div key={i} className="bg-slate-50/50 p-6 rounded-[2rem] border border-slate-100 flex items-center gap-6 hover:bg-white hover:shadow-xl hover:border-blue-100 transition-all group">
                                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${isPago ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                                            <ICONS.History className="w-6 h-6" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <p className="font-black text-slate-900 text-sm uppercase italic truncate">{item.fornecedor}</p>
                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded text-[7px] font-black uppercase">DOC: {item.numero_documento || item.numeroDocumento || 'S/N'}</span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-slate-100">
                                                    <span className="text-[10px] text-slate-400 font-bold">{item.dataVencimento ? new Date(item.dataVencimento).toLocaleDateString('pt-BR') : '-'}</span>
                                                </div>
                                                <p className="text-[10px] text-slate-400 font-medium truncate italic">{item.historico}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-black text-slate-900 text-lg italic tracking-tighter">{formatCurrency(val)}</p>
                                            <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${isPago ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                {isPago ? 'Totalmente Pago' : `Aberto: ${formatCurrency(saldo)}`}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExpenseBI;
