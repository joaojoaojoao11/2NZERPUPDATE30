
import React, { useEffect, useState } from 'react';
import { DREService } from '../services/dreService';
import { UserService } from '../services/userService';
import { DREReportItem, DREMapping, CompanySettings } from '../types';
import { ICONS } from '../constants';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';

const DREReport: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'REPORT' | 'AUDIT'>('REPORT');
    const [reportData, setReportData] = useState<DREReportItem[]>([]);

    // Filter State
    const [periodType, setPeriodType] = useState<'MONTH' | 'QUARTER' | 'SEMESTER' | 'YEAR'>('MONTH');
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [year, setYear] = useState(new Date().getFullYear());
    const [quarter, setQuarter] = useState(Math.floor((new Date().getMonth() + 3) / 3)); // 1-4
    const [semester, setSemester] = useState(Math.floor((new Date().getMonth() + 6) / 6)); // 1-2

    // Unmapped Logic
    const [unmappedItems, setUnmappedItems] = useState<{ category: string, count: number, totalValue: number }[]>([]);
    const [showUnmappedModal, setShowUnmappedModal] = useState(false);
    const [mappingForm, setMappingForm] = useState<{ original: string, group: string, subgroup: string }>({ original: '', group: 'DESPESAS_OPERACIONAIS', subgroup: 'Despesas Administrativas' });

    // Print & Logo State
    const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);

    // Fetch Settings
    useEffect(() => {
        UserService.getCompanySettings().then(setCompanySettings);
    }, []);

    // Helper: Generate list of month keys (YYYY-MM) for corresponding columns
    const getColumns = () => {
        if (periodType === 'MONTH') return []; // Single column mode

        const cols: string[] = [];
        if (periodType === 'YEAR') {
            for (let i = 0; i < 12; i++) {
                cols.push(`${year}-${String(i + 1).padStart(2, '0')}`);
            }
        } else if (periodType === 'QUARTER') {
            const startMonth = (quarter - 1) * 3;
            for (let i = 0; i < 3; i++) {
                cols.push(`${year}-${String(startMonth + i + 1).padStart(2, '0')}`);
            }
        } else if (periodType === 'SEMESTER') {
            const startMonth = (semester - 1) * 6;
            for (let i = 0; i < 6; i++) {
                cols.push(`${year}-${String(startMonth + i + 1).padStart(2, '0')}`);
            }
        }
        return cols;
    };

    const periodColumns = getColumns();

    const getPeriodDates = () => {
        let startDate = '';
        let endDate = '';

        switch (periodType) {
            case 'MONTH':
                const [y, m] = month.split('-');
                startDate = `${y}-${m}-01`;
                endDate = new Date(parseInt(y), parseInt(m), 0).toISOString().split('T')[0];
                break;
            case 'YEAR':
                startDate = `${year}-01-01`;
                endDate = `${year}-12-31`;
                break;
            case 'QUARTER':
                const qStartMonth = (quarter - 1) * 3;
                const qEndMonth = qStartMonth + 3;
                startDate = new Date(year, qStartMonth, 1).toISOString().split('T')[0];
                endDate = new Date(year, qEndMonth, 0).toISOString().split('T')[0];
                break;
            case 'SEMESTER':
                const sStartMonth = (semester - 1) * 6;
                const sEndMonth = sStartMonth + 6;
                startDate = new Date(year, sStartMonth, 1).toISOString().split('T')[0];
                endDate = new Date(year, sEndMonth, 0).toISOString().split('T')[0];
                break;
        }
        return { startDate, endDate };
    };

    const loadData = async () => {
        setLoading(true);
        try {
            const { startDate, endDate } = getPeriodDates();

            // Using the new unified method
            const { report, unmapped } = await DREService.generateDREReport(startDate, endDate);

            setReportData(report);
            setUnmappedItems(unmapped); // Now using the unmapped list from the generator directly

        } catch (e) {
            console.error("Erro DRE:", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [periodType, month, year, quarter, semester]);

    const handleOpenMapping = (category: string) => {
        const suggestion = DREService.autoSuggestMapping(category);
        setMappingForm({
            original: category,
            group: suggestion.dre_group || 'DESPESAS_OPERACIONAIS',
            subgroup: suggestion.dre_subgroup || 'Despesas Administrativas'
        });
        setShowUnmappedModal(true);
    };

    const handleSaveMapping = async () => {
        try {
            await DREService.mapCategory(mappingForm.original, mappingForm.group, mappingForm.subgroup);
            setShowUnmappedModal(false);
            loadData();
        } catch (e) {
            alert("Erro ao salvar mapeamento");
        }
    };


    // Helper to format currency or percentage based on flags
    const formatCurrency = (val: number, compact = false, isPercent = false) => {
        if (isPercent) return new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val / 100);
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: compact ? 0 : 2 }).format(val);
    };

    const formatMonthHeader = (ym: string) => {
        const [y, m] = ym.split('-');
        const date = new Date(parseInt(y), parseInt(m) - 1, 1);
        return date.toLocaleDateString('pt-BR', { month: 'short' }).toUpperCase();
    };

    const getRowStyle = (id: string, val: number) => {
        if (id === 'RESULTADO') return val >= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50';
        if (id.includes('LUCRO') || id.includes('RECEITA_LIQUIDA')) return 'text-slate-900 bg-slate-50';
        return 'text-slate-600';
    };


    if (loading && !reportData.length) return <div className="p-10 text-center animate-pulse text-slate-400 font-bold uppercase tracking-widest">Calculando DRE...</div>;

    return (
        <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">

            {/* Global Print Styles */}
            <style>{`
                @media print {
                    @page { 
                        size: landscape; 
                        margin: 10mm;
                    }
                    body { 
                        visibility: hidden; 
                        background: white;
                    }
                    #print-section { 
                        visibility: visible; 
                        position: absolute; 
                        left: 0; 
                        top: 0; 
                        width: 100%; /* 297mm - 20mm margin = 277mm effectively */
                        margin: 0;
                        padding: 0;
                    }
                    /* Ensure table borders print */
                    table { border-collapse: collapse !important; }
                    th, td { border: 1px solid black !important; }
                }
            `}</style>

            {/* Header */}
            <div className="flex justify-between items-end bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm shrink-0 print:hidden">
                <div>
                    <h2 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter">DRE Gerencial</h2>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Demonstração do Resultado do Exercício</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="bg-slate-50 p-2 rounded-xl border border-slate-100 flex items-center gap-2">
                        <ICONS.Filter className="w-4 h-4 text-slate-400 ml-1" />

                        <select
                            value={periodType}
                            onChange={e => setPeriodType(e.target.value as any)}
                            className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 uppercase cursor-pointer"
                        >
                            <option value="MONTH">Mensal</option>
                            <option value="QUARTER">Trimestral</option>
                            <option value="SEMESTER">Semestral</option>
                            <option value="YEAR">Anual</option>
                        </select>

                        <div className="w-px h-4 bg-slate-200 mx-2"></div>

                        {periodType === 'MONTH' && (
                            <input
                                type="month"
                                value={month}
                                onChange={e => setMonth(e.target.value)}
                                className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 uppercase"
                            />
                        )}

                        {periodType !== 'MONTH' && (
                            <select
                                value={year}
                                onChange={e => setYear(Number(e.target.value))}
                                className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 uppercase cursor-pointer"
                            >
                                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        )}

                        {periodType === 'QUARTER' && (
                            <select
                                value={quarter}
                                onChange={e => setQuarter(Number(e.target.value))}
                                className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 uppercase cursor-pointer ml-2"
                            >
                                <option value={1}>1º Trimestre</option>
                                <option value={2}>2º Trimestre</option>
                                <option value={3}>3º Trimestre</option>
                                <option value={4}>4º Trimestre</option>
                            </select>
                        )}

                        {periodType === 'SEMESTER' && (
                            <select
                                value={semester}
                                onChange={e => setSemester(Number(e.target.value))}
                                className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 uppercase cursor-pointer ml-2"
                            >
                                <option value={1}>1º Semestre</option>
                                <option value={2}>2º Semestre</option>
                            </select>
                        )}
                    </div>

                    <button
                        onClick={() => window.print()}
                        className="p-3 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-all shadow-sm flex items-center gap-2 font-bold text-xs uppercase tracking-widest"
                        title="Imprimir Relatório Oficial"
                    >
                        <ICONS.Document className="w-5 h-5" />
                        Imprimir Oficial
                    </button>

                    <button onClick={loadData} className="p-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all shadow-lg">
                        <ICONS.History className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* PRINT ONLY SECTION - FORMAL LAYOUT */}
            <div id="print-section" className="hidden print:block bg-white text-black w-full">
                <div className="flex flex-col h-full w-full">

                    {/* Print Header */}
                    <div className="flex justify-between items-center pb-4 mb-2 border-b-2 border-black">
                        <div className="flex items-center gap-6">
                            {companySettings?.logoUrl && (
                                <img src={companySettings.logoUrl} alt="Logo" className="h-16 object-contain" />
                            )}
                            <div>
                                <h1 className="text-xl font-serif font-bold uppercase tracking-wide leading-none">{companySettings?.name || 'Empresa'}</h1>
                                <p className="text-sm font-serif text-gray-600 mt-1">{companySettings?.cnpj}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <h2 className="text-xl font-serif font-black uppercase tracking-widest">DRE Gerencial</h2>
                            <p className="text-xs font-serif text-gray-800 uppercase font-bold mt-1">
                                Período: {periodType === 'MONTH' ? month : `Ano ${year} (${periodType === 'QUARTER' ? 'Trimestral' : periodType === 'SEMESTER' ? 'Semestral' : 'Anual'})`}
                            </p>
                        </div>
                    </div>

                    {/* Print Table (Percentage Based Widths) */}
                    <table className="w-full border-collapse font-serif text-[10px] table-fixed">
                        <thead>
                            <tr className="bg-gray-200 text-black">
                                <th className="text-left py-1.5 px-2 font-bold uppercase tracking-wider w-[35%]">Descrição da Conta</th>
                                {periodColumns.map(col => (
                                    <th key={col} className="text-right py-1.5 px-1 font-bold uppercase tracking-wider">{formatMonthHeader(col)}</th>
                                ))}
                                <th className="text-right py-1.5 px-2 font-bold uppercase tracking-wider bg-gray-300 w-[12%]">TOTAL (R$)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reportData.map((item) => (
                                <React.Fragment key={item.id}>
                                    {/* Main Group */}
                                    <tr className={`break-inside-avoid ${item.id === 'RESULTADO' ? 'font-bold bg-gray-100 text-sm' : item.id === 'EBITDA' ? 'font-bold bg-slate-50' : ''}`}>
                                        <td className={`py-1 px-2 truncate ${item.type === 'GROUP' && !item.subItems ? 'pl-2' : 'pl-2 font-bold'}`}>
                                            {item.label}
                                        </td>
                                        {periodColumns.map(col => (
                                            <td key={col} className="text-right py-1 px-1">
                                                {formatCurrency(item.monthlyValues?.[col] || 0, true, item.id === 'ROI')}
                                            </td>
                                        ))}
                                        <td className="text-right py-1 px-2 bg-gray-50 font-bold">
                                            {formatCurrency(item.value, true, item.id === 'ROI')}
                                        </td>
                                    </tr>

                                    {/* SubItems */}
                                    {item.subItems?.map(sub => (
                                        <tr key={sub.id} className="break-inside-avoid">
                                            <td className="py-0.5 px-2 pl-8 text-gray-700 italic truncate">
                                                {sub.label}
                                            </td>
                                            {periodColumns.map(col => (
                                                <td key={col} className="text-right py-0.5 px-1 text-gray-600">
                                                    {new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(sub.monthlyValues?.[col] || 0)}
                                                </td>
                                            ))}
                                            <td className="text-right py-0.5 px-2 text-gray-700">
                                                {new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(sub.value)}
                                            </td>
                                        </tr>
                                    ))}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>

                    {/* Footer / Signatures */}
                    <div className="grid grid-cols-2 gap-32 pt-12 mt-auto page-break-inside-avoid px-20">
                        <div className="border-t border-black pt-2 text-center">
                            <p className="font-serif font-bold text-[10px] uppercase">Responsável Legal</p>
                        </div>
                        <div className="border-t border-black pt-2 text-center">
                            <p className="font-serif font-bold text-[10px] uppercase">Contador Responsável</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* TABS */}
            <div className="flex gap-4 border-b border-slate-100 px-4 print:hidden">
                <button
                    onClick={() => setActiveTab('REPORT')}
                    className={`pb-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'REPORT' ? 'text-slate-900 border-b-2 border-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Relatório Financeiro
                </button>
                <button
                    onClick={() => setActiveTab('AUDIT')}
                    className={`pb-3 text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'AUDIT' ? 'text-slate-900 border-b-2 border-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Auditoria
                    {unmappedItems.length > 0 && (
                        <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full">{unmappedItems.length}</span>
                    )}
                </button>

            </div>

            {/* UNMAPPED MODAL */}
            {showUnmappedModal && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
                    {/* ... (Same Modal as before) ... */}
                    {/* For brevity in this replacement, keeping the modal structure identical to previous artifact, just minimized here conceptually, but I must output full code */}
                    <div className="bg-white max-w-2xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300">
                        <div className="bg-amber-400 p-8 flex justify-between items-center">
                            <div>
                                <h3 className="text-2xl font-black text-white uppercase italic tracking-tighter">Categorização Pendente</h3>
                            </div>
                            <div className="bg-white/20 p-3 rounded-xl">
                                <ICONS.Warning className="w-8 h-8 text-white" />
                            </div>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-2">Categoria Original</p>
                                <p className="text-2xl font-black text-slate-800 italic uppercase">"{mappingForm.original}"</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Grupo DRE</label>
                                    <select
                                        value={mappingForm.group}
                                        onChange={e => setMappingForm({ ...mappingForm, group: e.target.value })}
                                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                    >
                                        <option value="RECEITA_BRUTA">Receita Bruta</option>
                                        <option value="DEDUCOES">(-) Deduções</option>
                                        <option value="CMV">(-) CMV</option>
                                        <option value="DESPESAS_OPERACIONAIS">(-) Despesas Operacionais</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Subgrupo</label>
                                    {mappingForm.group === 'DESPESAS_OPERACIONAIS' ? (
                                        <select
                                            value={mappingForm.subgroup}
                                            onChange={e => setMappingForm({ ...mappingForm, subgroup: e.target.value })}
                                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                        >
                                            <option value="Despesas com Vendas">Despesas com Vendas</option>
                                            <option value="Despesas Administrativas">Despesas Administrativas</option>
                                            <option value="Despesas Financeiras">Despesas Financeiras</option>
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            value={mappingForm.subgroup}
                                            onChange={e => setMappingForm({ ...mappingForm, subgroup: e.target.value })}
                                            placeholder="Ex: Impostos, Compras..."
                                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                        />
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={handleSaveMapping}
                                className="w-full bg-slate-900 text-white py-4 rounded-xl font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg text-sm flex items-center justify-center gap-2"
                            >
                                <ICONS.Check className="w-5 h-5" />
                                Confirmar Mapeamento
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB CONTENT */}
            <div className="flex-1 bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                {activeTab === 'REPORT' ? (
                    <div className="flex-1 overflow-auto custom-scrollbar p-8">
                        <table className="w-full text-left min-w-[800px]">
                            <thead className="sticky top-0 bg-white z-10">
                                <tr className="border-b-2 border-slate-100">
                                    <th className="py-4 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-64 sticky left-0 bg-white shadow-sm z-20">Descrição</th>
                                    {periodColumns.map(col => (
                                        <th key={col} className="text-right py-4 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest min-w-[100px]">{formatMonthHeader(col)}</th>
                                    ))}
                                    <th className="text-right py-4 px-6 text-[10px] font-black text-slate-900 uppercase tracking-widest bg-slate-50 min-w-[120px]">TOTAL</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {reportData.map((item) => (
                                    <React.Fragment key={item.id}>
                                        <tr className={`group hover:bg-slate-50/80 transition-colors ${getRowStyle(item.id, item.value)} ${item.id === 'EBITDA' ? 'bg-blue-50/30 font-bold' : ''}`}>
                                            <td className="py-4 px-4 sticky left-0 bg-inherit z-10">
                                                <span className={`text-xs font-black uppercase tracking-tight ${item.type === 'GROUP' && !item.subItems ? 'pl-0 text-sm italic' : ''}`}>
                                                    {item.label}
                                                </span>
                                            </td>
                                            {periodColumns.map(col => (
                                                <td key={col} className="py-4 px-4 text-right">
                                                    <span className="text-xs font-medium opacity-80">
                                                        {item.id === 'ROI'
                                                            ? formatCurrency(item.monthlyValues?.[col] || 0, false, true)
                                                            : new Intl.NumberFormat('pt-BR', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(item.monthlyValues?.[col] || 0)
                                                        }
                                                    </span>
                                                </td>
                                            ))}
                                            <td className="py-4 px-6 text-right bg-slate-50/50 font-bold border-l border-slate-100">
                                                <span className="text-sm font-black tracking-tighter">{formatCurrency(item.value, false, item.id === 'ROI')}</span>
                                            </td>
                                        </tr>
                                        {item.subItems?.map(sub => (
                                            <tr key={sub.id} className="hover:bg-amber-50/30 transition-colors">
                                                <td className="py-2 px-4 pl-12 flex items-center gap-2 sticky left-0 bg-white z-10">
                                                    <div className="w-1 h-1 bg-slate-300 rounded-full"></div>
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase truncate max-w-[200px]" title={sub.label}>{sub.label}</span>
                                                </td>
                                                {periodColumns.map(col => (
                                                    <td key={col} className="py-2 px-4 text-right">
                                                        <span className="text-[10px] font-medium text-slate-400">
                                                            {new Intl.NumberFormat('pt-BR', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sub.monthlyValues?.[col] || 0)}
                                                        </span>
                                                    </td>
                                                ))}
                                                <td className="py-2 px-6 text-right bg-slate-50/30 border-l border-slate-100">
                                                    <span className="text-xs font-medium text-slate-600">{formatCurrency(sub.value)}</span>
                                                </td>
                                            </tr>
                                        ))}
                                        {item.type === 'GROUP' && <tr className="h-2 bg-transparent"></tr>}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="flex-1 overflow-auto custom-scrollbar p-8">
                        {/* Unmapped Table (Simplified for brevity but functional) */}
                        {unmappedItems.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                <ICONS.Check className="w-16 h-16 mb-4 text-emerald-200" />
                                <p className="font-black uppercase tracking-widest text-sm">Tudo Categorizado!</p>
                            </div>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-100 text-[10px] text-slate-400 font-black uppercase tracking-widest">
                                        <th className="p-4">Categoria Original</th>
                                        <th className="p-4">Ocorrências</th>
                                        <th className="p-4">Impacto Total</th>
                                        <th className="p-4 text-right">Ação</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {unmappedItems.map((item, idx) => (
                                        <tr key={idx} className="hover:bg-amber-50/50 transition-colors group">
                                            <td className="p-4 text-sm font-bold text-slate-700">{item.category}</td>
                                            <td className="p-4 text-xs font-medium text-slate-500">{item.count}x</td>
                                            <td className="p-4 text-xs font-black text-slate-600">{formatCurrency(item.totalValue)}</td>
                                            <td className="p-4 text-right">
                                                <button onClick={() => handleOpenMapping(item.category)} className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-lg">Classificar</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>

        </div>
    );
};

export default DREReport;
