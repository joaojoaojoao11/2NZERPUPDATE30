
import React, { useState, useEffect, useMemo } from 'react';
import { DataService } from '../services/dataService';
import { SalesHistoryItem } from '../types';
import { 
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell 
} from 'recharts';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#a855f7'];

const SalesBI: React.FC = () => {
  const [sales, setSales] = useState<SalesHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const data = await DataService.getSalesHistory(2000); // Carrega um volume maior para BI
        setSales(data || []);
      } catch (e) {
        console.error("Erro no BI Vendas:", e);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  const analytics = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    
    // Filtragem pelo mês selecionado
    const filtered = sales.filter(s => {
        if (!s.saleDate) return false;
        const sDate = new Date(s.saleDate);
        return sDate.getFullYear() === year && (sDate.getMonth() + 1) === month;
    });

    // KPIs
    let totalEntregue = 0;
    let totalCancelado = 0;
    let totalPendente = 0;
    const ordersSet = new Set<string>();
    
    const repMap: Record<string, number> = {};
    const statusMap: Record<string, number> = {};
    
    // Timeline Diária
    const dailyMap: Record<number, { day: number, value: number }> = {};
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) dailyMap[i] = { day: i, value: 0 };

    filtered.forEach(s => {
        const valor = Number(s.unitPrice || 0) * Number(s.quantity || 0);
        const status = (s.status || 'PENDENTE').toUpperCase();
        
        if (s.orderNumber) ordersSet.add(s.orderNumber);

        // Agrupamento por Status
        statusMap[status] = (statusMap[status] || 0) + valor;

        if (status.includes('ENTREGUE')) {
            totalEntregue += valor;
            const day = new Date(s.saleDate!).getDate();
            if (dailyMap[day]) dailyMap[day].value += valor;
        } else if (status.includes('CANCEL')) {
            totalCancelado += valor;
        } else {
            totalPendente += valor;
        }

        // Agrupamento por Vendedor (Apenas entregues para performance)
        if (status.includes('ENTREGUE')) {
            const rep = s.salesRep || 'SISTEMA';
            repMap[rep] = (repMap[rep] || 0) + valor;
        }
    });

    // Formatação Gráficos
    const timelineData = Object.values(dailyMap);
    
    const repData = Object.entries(repMap)
        .map(([name, value]) => ({ name: name.split(' ')[0], value }))
        .sort((a, b) => b.value - a.value);

    const statusData = Object.entries(statusMap)
        .map(([name, value]) => ({ name, value }));

    const orderCount = ordersSet.size;
    const avgTicket = orderCount > 0 ? totalEntregue / orderCount : 0;
    const conversionRate = (totalEntregue + totalCancelado) > 0 
        ? (totalEntregue / (totalEntregue + totalCancelado)) * 100 
        : 0;

    return {
        totalEntregue,
        totalPendente,
        orderCount,
        avgTicket,
        conversionRate,
        timelineData,
        repData,
        statusData
    };
  }, [sales, selectedMonth]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-40 opacity-30">
      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
      <p className="text-[10px] font-black uppercase tracking-widest italic">Processando Inteligência de Vendas...</p>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 shrink-0">
         <div>
            <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">BI Vendas</h2>
            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.3em] mt-3 italic flex items-center">
               <span className="w-8 h-px bg-indigo-600 mr-4"></span>
               Performance Comercial NZERP
            </p>
         </div>
         
         <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 border-r border-slate-100 italic">Competência</span>
            <input 
               type="month" 
               value={selectedMonth}
               onChange={(e) => setSelectedMonth(e.target.value)}
               className="bg-transparent border-none outline-none text-xs font-black text-slate-700 uppercase px-3 py-1 cursor-pointer"
            />
         </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
         <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center relative overflow-hidden group">
            <div className="absolute right-[-15px] top-[-15px] bg-emerald-50 w-24 h-24 rounded-full group-hover:scale-110 transition-transform"></div>
            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1 z-10">Faturamento Líquido</p>
            <h3 className="text-2xl font-black text-slate-900 italic tracking-tighter z-10">
                R$ {analytics.totalEntregue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </h3>
         </div>

         <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden group">
            <div className="absolute right-[-15px] top-[-15px] bg-blue-50 w-24 h-24 rounded-full group-hover:scale-110 transition-transform"></div>
            <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mb-1 z-10">Ticket Médio</p>
            <h3 className="text-2xl font-black text-slate-900 italic tracking-tighter z-10">
                R$ {analytics.avgTicket.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </h3>
         </div>

         <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden group">
            <div className="absolute right-[-15px] top-[-15px] bg-indigo-50 w-24 h-24 rounded-full group-hover:scale-110 transition-transform"></div>
            <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-1 z-10">Volume de Pedidos</p>
            <h3 className="text-2xl font-black text-slate-900 italic tracking-tighter z-10">
                {analytics.orderCount} <span className="text-[10px] text-slate-400 not-italic uppercase">Unid</span>
            </h3>
         </div>

         <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950 opacity-50"></div>
            <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest mb-1 z-10">Taxa de Conversão</p>
            <h3 className="text-2xl font-black italic tracking-tighter z-10">
                {analytics.conversionRate.toFixed(1)}%
            </h3>
            <div className="w-full h-1.5 bg-white/10 rounded-full mt-2 z-10 overflow-hidden">
                <div style={{ width: `${analytics.conversionRate}%` }} className="h-full bg-amber-400 transition-all duration-1000"></div>
            </div>
         </div>
      </div>

      {/* GRÁFICOS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         
         {/* Evolução de Vendas (Diário) */}
         <div className="lg:col-span-2 bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm h-96">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Faturamento Diário no Mês</h4>
            <ResponsiveContainer width="100%" height="90%">
               <AreaChart data={analytics.timelineData}>
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="day" fontSize={10} fontWeight="bold" axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`} fontSize={10} axisLine={false} tickLine={false} />
                  <Tooltip 
                     contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.05)' }}
                     formatter={(val: number) => `R$ ${val.toLocaleString('pt-BR')}`}
                     labelFormatter={(label) => `Dia ${label}`}
                  />
                  <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
               </AreaChart>
            </ResponsiveContainer>
         </div>

         {/* Status de Pedidos */}
         <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm h-96 flex flex-col">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Status da Carteira</h4>
            <div className="flex-1">
               <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                     <Pie
                        data={analytics.statusData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                     >
                        {analytics.statusData.map((_, index) => (
                           <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                     </Pie>
                     <Tooltip 
                        formatter={(val: number) => `R$ ${val.toLocaleString('pt-BR')}`}
                        contentStyle={{ borderRadius: '12px', border: 'none' }}
                     />
                  </PieChart>
               </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
               {analytics.statusData.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                     <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                     <span className="text-[8px] font-black text-slate-500 uppercase truncate">{s.name}</span>
                  </div>
               ))}
            </div>
         </div>

         {/* Performance por Vendedor */}
         <div className="lg:col-span-3 bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm min-h-[400px]">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8 italic">Ranking de Performance (Vendedores)</h4>
            <div className="h-[300px]">
               <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.repData} layout="vertical" margin={{ left: 20 }}>
                     <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                     <XAxis type="number" hide />
                     <YAxis 
                        dataKey="name" 
                        type="category" 
                        fontSize={10} 
                        fontWeight="bold" 
                        axisLine={false} 
                        tickLine={false} 
                     />
                     <Tooltip 
                        cursor={{fill: '#f8fafc'}}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.05)' }}
                        formatter={(val: number) => `R$ ${val.toLocaleString('pt-BR')}`}
                     />
                     <Bar dataKey="value" fill="#6366f1" radius={[0, 8, 8, 0]} barSize={20} />
                  </BarChart>
               </ResponsiveContainer>
            </div>
         </div>
      </div>
    </div>
  );
};

export default SalesBI;
