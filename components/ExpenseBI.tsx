
import React, { useState, useEffect, useMemo } from 'react';
import { FinanceService } from '../services/financeService';
import { AccountsPayable } from '../types';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, 
  PieChart, Pie, Cell, AreaChart, Area 
} from 'recharts';
import { ICONS } from '../constants';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b'];

const ExpenseBI: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [payables, setPayables] = useState<AccountsPayable[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  
  // Estado para o Modal de Detalhes do Dia
  const [selectedDayDetails, setSelectedDayDetails] = useState<{ date: string, items: AccountsPayable[] } | null>(null);

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

  const { 
    filteredData, 
    kpis, 
    categoryData, 
    supplierData, 
    statusData, 
    timelineData,
    dailyBreakdown 
  } = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const today = new Date();
    today.setHours(0,0,0,0);

    // Filtragem por competência ou vencimento no mês selecionado
    const filtered = payables.filter(p => {
        if (!p.dataVencimento) return false;
        const [pYear, pMonth] = p.dataVencimento.split('-').map(Number);
        return pYear === year && pMonth === month;
    });

    // KPIs
    let totalVencido = 0;
    let totalAVencer = 0;
    let totalPago = 0;
    let totalAberto = 0;

    const supplierMap: Record<string, number> = {};
    const categoryMap: Record<string, number> = {};
    const statusMap: Record<string, number> = {};
    
    // Mapa detalhado por dia (1 a 31)
    const dailyMap: Record<number, { value: number, items: AccountsPayable[], paid: number, open: number }> = {};
    const daysInMonth = new Date(year, month, 0).getDate();
    
    // Inicializa todos os dias do mês
    for (let i = 1; i <= daysInMonth; i++) {
        dailyMap[i] = { value: 0, items: [], paid: 0, open: 0 };
    }

    filtered.forEach(p => {
        const valor = Number(p.valorDocumento || 0);
        const pago = Number(p.valorPago || 0);
        const saldo = Number(p.saldo || 0);
        const isPaid = saldo <= 0.01;
        const vencimento = new Date(p.dataVencimento);
        const isOverdue = vencimento < today && !isPaid;

        // KPI Calc
        if (isPaid) totalPago += pago;
        else {
            totalAberto += saldo;
            if (isOverdue) totalVencido += saldo;
            else totalAVencer += saldo;
        }

        // Categorias
        const cat = p.categoria || 'OUTROS';
        categoryMap[cat] = (categoryMap[cat] || 0) + valor;

        // Fornecedores
        const forn = p.fornecedor || 'DESCONHECIDO';
        supplierMap[forn] = (supplierMap[forn] || 0) + valor;

        // Status
        const status = isPaid ? 'PAGO' : isOverdue ? 'VENCIDO' : 'A VENCER';
        statusMap[status] = (statusMap[status] || 0) + valor;

        // Timeline & Detalhes Diários
        const day = parseInt(p.dataVencimento.split('-')[2]);
        if (dailyMap[day]) {
            dailyMap[day].value += valor;
            dailyMap[day].items.push(p);
            if (isPaid) dailyMap[day].paid += valor;
            else dailyMap[day].open += valor;
        }
    });

    // Formatação para Gráficos
    const categoryChart = Object.entries(categoryMap)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    const supplierChart = Object.entries(supplierMap)
        .map(([name, value]) => ({ name: name.length > 15 ? name.substring(0,15)+'...' : name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 7); // Top 7

    const statusChart = Object.entries(statusMap)
        .map(([name, value]) => ({ name, value }));

    const timelineChart = Object.keys(dailyMap).map(d => ({
        day: Number(d),
        value: dailyMap[Number(d)].value
    }));

    // Array para a tabela diária (apenas dias com movimento ou todos, aqui optamos por todos para visualização de calendário)
    const dailyBreakdownList = Object.entries(dailyMap).map(([day, data]) => {
        const dateObj = new Date(year, month - 1, Number(day));
        const weekDay = dateObj.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase();
        return {
            day: Number(day),
            dateStr: dateObj.toLocaleDateString('pt-BR'),
            weekDay,
            ...data
        };
    }).filter(d => d.value > 0); // Filtra apenas dias com contas para não poluir

    return {
        filteredData: filtered,
        kpis: { totalVencido, totalAVencer, totalPago, totalAberto },
        categoryData: categoryChart,
        supplierData: supplierChart,
        statusData: statusChart,
        timelineData: timelineChart,
        dailyBreakdown: dailyBreakdownList
    };
  }, [payables, selectedMonth]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-full opacity-50">
      <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
      <p className="mt-4 font-black uppercase text-xs tracking-widest text-slate-400">Processando Despesas...</p>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 h-full flex flex-col pb-10">
      
      {/* HEADER E FILTRO */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 shrink-0">
         <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">BI de Despesas</h2>
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] mt-2 italic">
               Análise de Procurement & Contas a Pagar
            </p>
         </div>
         
         <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 border-r border-slate-100">Competência</span>
            <input 
               type="month" 
               value={selectedMonth}
               onChange={(e) => setSelectedMonth(e.target.value)}
               className="bg-transparent border-none outline-none text-xs font-black text-slate-700 uppercase px-3 py-1 cursor-pointer"
            />
         </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 shrink-0">
         <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden group">
            <div className="absolute right-[-10px] top-[-10px] bg-red-50 w-24 h-24 rounded-full group-hover:scale-110 transition-transform"></div>
            <p className="text-[9px] font-black text-red-500 uppercase tracking-widest mb-1 z-10">Vencido (Crítico)</p>
            <h3 className="text-2xl font-black text-slate-900 italic tracking-tighter z-10">
                R$ {kpis.totalVencido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </h3>
         </div>

         <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden group">
            <div className="absolute right-[-10px] top-[-10px] bg-amber-50 w-24 h-24 rounded-full group-hover:scale-110 transition-transform"></div>
            <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1 z-10">A Vencer (Fluxo)</p>
            <h3 className="text-2xl font-black text-slate-900 italic tracking-tighter z-10">
                R$ {kpis.totalAVencer.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </h3>
         </div>

         <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden group">
            <div className="absolute right-[-10px] top-[-10px] bg-emerald-50 w-24 h-24 rounded-full group-hover:scale-110 transition-transform"></div>
            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1 z-10">Pago (Realizado)</p>
            <h3 className="text-2xl font-black text-slate-900 italic tracking-tighter z-10">
                R$ {kpis.totalPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </h3>
         </div>

         <div className="bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl flex flex-col justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950"></div>
            <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1 z-10">Total Carteira (Aberto)</p>
            <h3 className="text-2xl font-black italic tracking-tighter z-10 text-white">
                R$ {kpis.totalAberto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </h3>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0">
         
         {/* COLUNA 1: Timeline e Categorias */}
         <div className="lg:col-span-2 space-y-8 flex flex-col">
            {/* Timeline */}
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm h-80 shrink-0">
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 italic">Fluxo de Saída Diário (Previsto)</h4>
               <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                     <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                           <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1}/>
                           <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                        </linearGradient>
                     </defs>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                     <XAxis 
                       dataKey="day" 
                       axisLine={false} 
                       tickLine={false} 
                       tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}} 
                       label={{ value: 'DIA', position: 'insideBottomRight', offset: -5, fontSize: 9, fill: '#cbd5e1' }}
                     />
                     <YAxis 
                       axisLine={false} 
                       tickLine={false} 
                       tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}} 
                       tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`}
                     />
                     <Tooltip 
                       contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px -5px rgba(0,0,0,0.1)' }}
                       formatter={(val: number) => `R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`}
                       labelFormatter={(label) => `Dia ${label}`}
                     />
                     <Area type="monotone" dataKey="value" stroke="#ef4444" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                  </AreaChart>
               </ResponsiveContainer>
            </div>

            {/* Nova Seção: Tabela Diária Detalhada */}
            <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col flex-1 min-h-[300px] overflow-hidden">
                <div className="px-8 py-5 border-b border-slate-100 bg-slate-50/30">
                    <h4 className="text-[10px] font-black text-slate-900 uppercase tracking-widest italic">Calendário de Desembolso</h4>
                </div>
                <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-4">Data</th>
                                <th className="px-6 py-4 text-center">Qtd. Doc</th>
                                <th className="px-6 py-4 text-right">Valor Total</th>
                                <th className="px-6 py-4">Status (Pago / Aberto)</th>
                                <th className="px-6 py-4 text-right">Ação</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 text-[11px]">
                            {dailyBreakdown.map(day => (
                                <tr key={day.day} onClick={() => setSelectedDayDetails({ date: day.dateStr, items: day.items })} className="hover:bg-slate-50 cursor-pointer transition-all group">
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-black text-slate-800 text-lg leading-none">{day.day}</span>
                                            <span className="text-[9px] font-bold text-slate-400 uppercase">{day.weekDay}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center font-bold text-slate-600">
                                        {day.items.length}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <span className="font-black text-slate-900 text-sm">R$ {day.value.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden flex">
                                            <div style={{ width: `${(day.paid / day.value) * 100}%` }} className="bg-emerald-500 h-full"></div>
                                            <div style={{ width: `${(day.open / day.value) * 100}%` }} className="bg-red-400 h-full"></div>
                                        </div>
                                        <div className="flex justify-between mt-1 text-[8px] font-bold uppercase">
                                            <span className="text-emerald-600">{((day.paid / day.value) * 100).toFixed(0)}% Pago</span>
                                            <span className="text-red-500">{((day.open / day.value) * 100).toFixed(0)}% Aberto</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button className="p-2 rounded-lg bg-white border border-slate-200 text-slate-400 group-hover:text-blue-600 group-hover:border-blue-200 transition-all">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
         </div>

         {/* COLUNA 2: Top Fornecedores e Status */}
         <div className="space-y-8 flex flex-col">
            {/* Top Fornecedores */}
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex-1 flex flex-col min-h-[400px]">
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Top 7 Credores (Curva ABC)</h4>
               <div className="flex-1 space-y-4 overflow-auto custom-scrollbar pr-2">
                  {supplierData.map((s, idx) => {
                     const maxVal = supplierData[0]?.value || 1;
                     const percent = (s.value / maxVal) * 100;
                     return (
                        <div key={idx} className="group">
                           <div className="flex justify-between items-end mb-1">
                              <span className="text-[10px] font-bold text-slate-700 uppercase truncate w-32" title={s.name}>{idx + 1}. {s.name}</span>
                              <span className="text-[10px] font-black text-slate-900">R$ {s.value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>
                           </div>
                           <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                 className="h-full bg-blue-600 rounded-full transition-all duration-1000 group-hover:bg-blue-500" 
                                 style={{ width: `${percent}%` }}
                              ></div>
                           </div>
                        </div>
                     );
                  })}
                  {supplierData.length === 0 && (
                     <div className="text-center py-10 opacity-30 text-[10px] font-black uppercase">Sem dados</div>
                  )}
               </div>
            </div>

            {/* Categorias - Movido para cá para balancear */}
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm min-h-[250px] flex flex-col">
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 italic">Categorias</h4>
               <div className="flex flex-1">
                  <div className="w-1/2 h-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                           <Pie
                              data={categoryData}
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={60}
                              paddingAngle={5}
                              dataKey="value"
                           >
                              {categoryData.map((entry, index) => (
                                 <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                              ))}
                           </Pie>
                           <Tooltip 
                              formatter={(val: number) => `R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`}
                              contentStyle={{ borderRadius: '12px', border: 'none' }}
                           />
                        </PieChart>
                     </ResponsiveContainer>
                  </div>
                  <div className="w-1/2 flex flex-col justify-center gap-2 overflow-auto custom-scrollbar max-h-[200px] pr-2">
                     {categoryData.map((entry, index) => (
                        <div key={index} className="flex justify-between items-center text-[9px]">
                           <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                              <span className="font-bold text-slate-600 uppercase truncate max-w-[80px]" title={entry.name}>{entry.name}</span>
                           </div>
                           <span className="font-black text-slate-900">R$ {(entry.value/1000).toFixed(0)}k</span>
                        </div>
                     ))}
                  </div>
               </div>
            </div>

            {/* Status Breakdown */}
            <div className="bg-slate-900 p-6 rounded-[2.5rem] shadow-xl text-white">
               <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-4 italic">Status da Carteira</h4>
               <div className="space-y-4">
                  {statusData.map((s) => {
                     const total = kpis.totalAberto + kpis.totalPago; // Total geral do mês
                     const pct = total > 0 ? (s.value / total) * 100 : 0;
                     let color = 'bg-slate-600';
                     if (s.name === 'PAGO') color = 'bg-emerald-500';
                     if (s.name === 'VENCIDO') color = 'bg-red-500';
                     if (s.name === 'A VENCER') color = 'bg-amber-500';

                     return (
                        <div key={s.name} className="flex items-center gap-4">
                           <div className={`w-3 h-12 rounded-lg ${color} shrink-0`}></div>
                           <div className="flex-1">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{s.name}</p>
                              <p className="text-lg font-black italic tracking-tighter">R$ {s.value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                           </div>
                           <span className="text-xs font-bold text-slate-500">{pct.toFixed(0)}%</span>
                        </div>
                     )
                  })}
               </div>
            </div>
         </div>
      </div>

      {/* MODAL DETALHE DO DIA */}
      {selectedDayDetails && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[200] flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-white max-w-4xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95">
                <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter">Despesas do Dia {selectedDayDetails.date}</h3>
                        <p className="text-blue-600 font-bold text-[10px] uppercase tracking-widest mt-1">{selectedDayDetails.items.length} Títulos Listados</p>
                    </div>
                    <button onClick={() => setSelectedDayDetails(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all">
                        <ICONS.Add className="w-6 h-6 rotate-45" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-auto p-8 custom-scrollbar">
                    <table className="w-full text-left border-separate border-spacing-y-3">
                        <thead className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                            <tr>
                                <th className="px-4">Fornecedor / Doc</th>
                                <th className="px-4">Categoria / Histórico</th>
                                <th className="px-4 text-center">Forma Pagto</th>
                                <th className="px-4 text-right">Valor</th>
                                <th className="px-4 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {selectedDayDetails.items.map((item, i) => (
                                <tr key={i} className="bg-white shadow-sm rounded-2xl group hover:shadow-md transition-all">
                                    <td className="px-4 py-4 border border-slate-100 rounded-l-2xl">
                                        <p className="font-black text-slate-900 text-[11px] uppercase italic">{item.fornecedor}</p>
                                        <p className="text-[9px] font-bold text-slate-400">DOC: {item.numeroDocumento || 'S/N'}</p>
                                    </td>
                                    <td className="px-4 py-4 border-y border-slate-100">
                                        <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[8px] font-black uppercase mb-1 inline-block">{item.categoria}</span>
                                        <p className="text-[10px] text-slate-500 font-medium truncate max-w-xs">{item.historico}</p>
                                    </td>
                                    <td className="px-4 py-4 border-y border-slate-100 text-center">
                                        <p className="text-[10px] font-bold text-slate-600 uppercase">{item.formaPagamento}</p>
                                    </td>
                                    <td className="px-4 py-4 border-y border-slate-100 text-right">
                                        <p className="font-black text-slate-900 text-sm">R$ {item.valorDocumento.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                                        {item.saldo > 0 && item.saldo < item.valorDocumento && (
                                            <p className="text-[8px] text-red-500 font-bold">Saldo: R$ {item.saldo.toFixed(2)}</p>
                                        )}
                                    </td>
                                    <td className="px-4 py-4 border border-slate-100 rounded-r-2xl text-center">
                                        <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase border ${
                                            (item.situacao || '').includes('PAGA') ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                            new Date(item.dataVencimento) < new Date() && item.saldo > 0.01 ? 'bg-red-50 text-red-600 border-red-100' :
                                            'bg-amber-50 text-amber-600 border-amber-100'
                                        }`}>
                                            {(item.situacao || '').includes('PAGA') ? 'PAGO' : new Date(item.dataVencimento) < new Date() && item.saldo > 0.01 ? 'VENCIDO' : item.situacao}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseBI;
