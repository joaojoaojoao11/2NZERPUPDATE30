
import React, { useState, useEffect, useMemo } from 'react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, PieChart, Pie, Cell, AreaChart, Area 
} from 'recharts';
import { DataService } from '../services/dataService';
import { StockItem, AuditLog } from '../types';
import { ICONS } from '../constants';
import { jsPDF } from 'jspdf';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const InventoryBI: React.FC = () => {
  const [inventory, setInventory] = useState<StockItem[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Novos estados
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [showReplenishmentModal, setShowReplenishmentModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [invData, logData] = await Promise.all([
          DataService.getInventory(),
          DataService.getLogs()
        ]);
        setInventory(invData);
        setLogs(logData);
      } catch (e) {
        console.error("Erro ao carregar dados do BI Estoque", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const stats = useMemo(() => {
    // 1. Valor e Quantidade Total (Snapshot Atual)
    const totalMl = inventory.reduce((acc, curr) => acc + curr.quantMl, 0);
    const totalValue = inventory.reduce((acc, curr) => acc + (curr.quantMl * (curr.custoUnitario || 0)), 0);
    const totalItems = inventory.filter(i => i.quantMl > 0).length;

    // 2. Itens para Reposição (LÓGICA AGREGADA POR SKU)
    // Agrupa inventário por SKU para somar os saldos de todos os rolos
    const skuMap = new Map<string, StockItem & { totalSaldo: number, rolosAtivos: number }>();

    inventory.forEach(item => {
        if (!skuMap.has(item.sku)) {
            // Inicializa com dados do primeiro item encontrado + contadores zerados
            skuMap.set(item.sku, { 
                ...item, 
                totalSaldo: 0,
                rolosAtivos: 0
            });
        }
        
        const group = skuMap.get(item.sku)!;
        group.totalSaldo += item.quantMl; // Soma saldo de todos os rolos
        if (item.quantMl > 0) group.rolosAtivos += 1;
    });

    // Filtra SKUs onde a SOMA TOTAL é menor ou igual ao Mínimo
    const replenishmentItems = Array.from(skuMap.values())
      .filter(group => {
        const min = group.estoqueMinimo || 0;
        return min > 0 && group.totalSaldo <= min;
      })
      .sort((a, b) => {
         // Ordena por criticidade (% do mínimo que ainda resta)
         const minA = a.estoqueMinimo || 1;
         const minB = b.estoqueMinimo || 1;
         return (a.totalSaldo / minA) - (b.totalSaldo / minB);
      });

    // 3. Composição por Categoria
    const catMap: Record<string, number> = {};
    inventory.forEach(i => {
      if (i.quantMl > 0) {
        const cat = i.categoria || 'OUTROS';
        catMap[cat] = (catMap[cat] || 0) + i.quantMl;
      }
    });
    const categoryData = Object.entries(catMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // 4. Top 10 Materiais
    const topItemsData = inventory
      .filter(i => i.quantMl > 0)
      .sort((a, b) => b.quantMl - a.quantMl)
      .slice(0, 10)
      .map(i => ({
        name: i.sku,
        desc: i.nome,
        value: i.quantMl
      }));

    // 5. Histórico de Movimentação (Baseado no Mês Selecionado)
    const [year, month] = selectedMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    
    const movementMap: Record<number, { date: string, entrada: number, saida: number }> = {};
    
    // Inicializa dias
    for (let i = 1; i <= daysInMonth; i++) {
        movementMap[i] = { 
            date: `${String(i).padStart(2, '0')}/${String(month).padStart(2, '0')}`,
            entrada: 0, 
            saida: 0 
        };
    }

    logs.forEach(log => {
      const logDate = new Date(log.timestamp);
      // Verifica se o log pertence ao mês/ano selecionado
      if (logDate.getFullYear() === year && (logDate.getMonth() + 1) === month) {
          const day = logDate.getDate();
          if (movementMap[day]) {
            const qty = Number(log.quantidade || 0);
            if (log.acao.includes('ENTRADA') || log.acao.includes('CADASTRO')) {
              movementMap[day].entrada += qty;
            } else if (log.acao.includes('SAIDA')) {
              movementMap[day].saida += qty;
            }
          }
      }
    });

    const movementData = Object.values(movementMap);

    return { 
      totalMl, 
      totalValue, 
      totalItems, 
      categoryData, 
      topItemsData, 
      movementData,
      replenishmentItems 
    };
  }, [inventory, logs, selectedMonth]);

  const generateReplenishmentPDF = () => {
    if (stats.replenishmentItems.length === 0) return;

    const doc = new jsPDF();
    const dateStr = new Date().toLocaleDateString('pt-BR');
    
    // Header
    doc.setFillColor(220, 38, 38); // Red header
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RELATÓRIO DE REPOSIÇÃO (GLOBAL SKU)', 10, 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`EMITIDO EM: ${dateStr} | ITENS CRÍTICOS: ${stats.replenishmentItems.length}`, 10, 25);

    let y = 45;
    
    // Table Header
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    
    doc.text('SKU', 10, y);
    doc.text('DESCRIÇÃO', 40, y);
    doc.text('FORNECEDOR', 110, y);
    doc.text('VOL', 145, y);
    doc.text('MÍNIMO', 160, y);
    doc.text('SALDO', 175, y);
    doc.text('DÉFICIT', 200, y, { align: 'right' });
    
    doc.setDrawColor(200);
    doc.line(10, y + 2, 200, y + 2);
    y += 8;

    // Items
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    
    stats.replenishmentItems.forEach((item) => {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }

      const deficit = (item.estoqueMinimo || 0) - item.totalSaldo;

      doc.setFontSize(9);
      doc.text(item.sku, 10, y);
      
      doc.setFontSize(8);
      doc.text(item.nome.substring(0, 40), 40, y);
      doc.text((item.fornecedor || '').substring(0, 15), 110, y);
      
      doc.text(String(item.rolosAtivos), 145, y);
      doc.text((item.estoqueMinimo || 0).toFixed(2), 160, y);
      doc.text(item.totalSaldo.toFixed(2), 175, y);
      
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(220, 38, 38);
      doc.text(`-${deficit.toFixed(2)}`, 200, y, { align: 'right' });
      doc.setTextColor(0);
      doc.setFont('helvetica', 'normal');

      y += 6;
      doc.setDrawColor(240);
      doc.line(10, y - 4, 200, y - 4);
    });

    doc.save(`Relatório de Reposição (Global SKU) - ${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-full opacity-50 py-32">
      <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
      <p className="mt-4 font-black uppercase text-xs tracking-widest text-slate-400">Analisando Inventário...</p>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      
      {/* HEADER E FILTRO */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 shrink-0">
         <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">BI Estoque</h2>
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] mt-2 italic">
               Inteligência de Pátio e Movimentação
            </p>
         </div>
         
         <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 border-r border-slate-100">Período</span>
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
            <div className="absolute right-[-20px] top-[-20px] bg-blue-50 w-32 h-32 rounded-full group-hover:scale-110 transition-transform"></div>
            <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mb-1 z-10">Volume Total</p>
            <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter z-10">
                {stats.totalMl.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ML
            </h3>
         </div>

         <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden group">
            <div className="absolute right-[-20px] top-[-20px] bg-emerald-50 w-32 h-32 rounded-full group-hover:scale-110 transition-transform"></div>
            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1 z-10">Valorização</p>
            <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter z-10">
                R$ {stats.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </h3>
         </div>

         <div className="bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl flex flex-col justify-center relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950"></div>
            <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest mb-1 z-10">Itens Ativos</p>
            <h3 className="text-3xl font-black italic tracking-tighter z-10 text-amber-400">
                {stats.totalItems} LPNs
            </h3>
         </div>

         {/* CARD DE ALERTA DE REPOSIÇÃO */}
         <button 
            onClick={() => setShowReplenishmentModal(true)}
            className="bg-red-50 p-6 rounded-[2rem] border border-red-100 shadow-sm flex flex-col justify-center relative overflow-hidden group hover:bg-red-100 transition-all text-left"
         >
            <div className="absolute right-[-10px] top-[-10px] bg-red-100 w-24 h-24 rounded-full group-hover:scale-110 transition-transform"></div>
            <div className="flex items-center gap-2 mb-1 z-10">
               <p className="text-[9px] font-black text-red-600 uppercase tracking-widest">Ponto de Reposição</p>
               <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
               </span>
            </div>
            <h3 className="text-3xl font-black text-red-700 italic tracking-tighter z-10">
                {stats.replenishmentItems.length} SKUs
            </h3>
            <p className="text-[8px] font-bold text-red-400 uppercase mt-1 z-10 underline">Ver lista crítica →</p>
         </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         
         {/* Gráfico de Composição (Pizza) */}
         <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm min-h-[350px] flex flex-col">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Distribuição por Categoria (Metragem)</h4>
            <div className="flex flex-1">
               <div className="w-1/2 h-full">
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                        <Pie
                           data={stats.categoryData}
                           cx="50%"
                           cy="50%"
                           innerRadius={50}
                           outerRadius={80}
                           paddingAngle={5}
                           dataKey="value"
                        >
                           {stats.categoryData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                           ))}
                        </Pie>
                        <Tooltip 
                           formatter={(val: number) => `${val.toFixed(2)} ML`}
                           contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        />
                     </PieChart>
                  </ResponsiveContainer>
               </div>
               <div className="w-1/2 flex flex-col justify-center gap-2 overflow-auto custom-scrollbar max-h-[250px] pr-2">
                  {stats.categoryData.map((entry, index) => (
                     <div key={index} className="flex justify-between items-center text-[9px]">
                        <div className="flex items-center gap-2">
                           <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                           <span className="font-bold text-slate-600 uppercase truncate max-w-[100px]" title={entry.name}>{entry.name}</span>
                        </div>
                        <span className="font-black text-slate-900">{entry.value.toFixed(0)} ML</span>
                     </div>
                  ))}
               </div>
            </div>
         </div>

         {/* Gráfico de Movimentação (Area) - DINÂMICO PELO MÊS */}
         <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm min-h-[350px] flex flex-col">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Movimentação Diária ({selectedMonth})</h4>
            <div className="flex-1">
               <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.movementData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                     <defs>
                        <linearGradient id="colorEntrada" x1="0" y1="0" x2="0" y2="1">
                           <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                           <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorSaida" x1="0" y1="0" x2="0" y2="1">
                           <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1}/>
                           <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                        </linearGradient>
                     </defs>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                     <XAxis 
                       dataKey="date" 
                       axisLine={false} 
                       tickLine={false} 
                       tick={{fill: '#94a3b8', fontSize: 9, fontWeight: 700}} 
                       interval="preserveStartEnd"
                     />
                     <YAxis 
                       axisLine={false} 
                       tickLine={false} 
                       tick={{fill: '#94a3b8', fontSize: 9, fontWeight: 700}} 
                     />
                     <Tooltip 
                       contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                       formatter={(val: number) => `${val.toFixed(2)} ML`}
                     />
                     <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} iconType="circle" />
                     <Area type="monotone" name="Entradas" dataKey="entrada" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorEntrada)" />
                     <Area type="monotone" name="Saídas" dataKey="saida" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorSaida)" />
                  </AreaChart>
               </ResponsiveContainer>
            </div>
         </div>

         {/* Top Materiais (Barra Horizontal) */}
         <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm min-h-[400px] flex flex-col">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Top 10 Materiais em Estoque (SKU)</h4>
            <div className="flex-1">
               <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.topItemsData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                     <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                     <XAxis type="number" hide />
                     <YAxis 
                       dataKey="name" 
                       type="category" 
                       width={80} 
                       tick={{fill: '#475569', fontSize: 10, fontWeight: 700}} 
                       axisLine={false} 
                       tickLine={false} 
                     />
                     <Tooltip 
                        cursor={{fill: '#f8fafc'}}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        formatter={(val: number) => [`${val.toFixed(2)} ML`, 'Saldo']}
                        labelFormatter={(label, payload) => {
                           if (payload && payload.length > 0) {
                              return `${label} - ${payload[0].payload.desc}`;
                           }
                           return label;
                        }}
                     />
                     <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
               </ResponsiveContainer>
            </div>
         </div>
      </div>

      {/* MODAL DE REPOSIÇÃO */}
      {showReplenishmentModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[200] flex items-center justify-center p-6 animate-in fade-in duration-200">
           <div className="bg-white max-w-5xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95">
              <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-red-50/30">
                 <div>
                    <h3 className="text-2xl font-black text-red-600 uppercase italic tracking-tighter">Relatório de Reposição (Global SKU)</h3>
                    <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-1">Soma de todos os rolos por Produto vs Mínimo</p>
                 </div>
                 <div className="flex items-center gap-3">
                    <button 
                        onClick={generateReplenishmentPDF}
                        className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm"
                        title="Imprimir Relatório"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                    </button>
                    <button onClick={() => setShowReplenishmentModal(false)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all">
                        <ICONS.Add className="w-6 h-6 rotate-45" />
                    </button>
                 </div>
              </div>
              
              <div className="flex-1 overflow-auto p-8 custom-scrollbar">
                 {stats.replenishmentItems.length > 0 ? (
                    <table className="w-full text-left border-separate border-spacing-y-2">
                       <thead className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                          <tr>
                             <th className="px-4">SKU / Material</th>
                             <th className="px-4">Fornecedor</th>
                             <th className="px-4 text-center">Rolos Ativos</th>
                             <th className="px-4 text-center">Mínimo</th>
                             <th className="px-4 text-center">Saldo Total</th>
                             <th className="px-4 text-right">Déficit</th>
                          </tr>
                       </thead>
                       <tbody>
                          {stats.replenishmentItems.map((group, i) => {
                             const deficit = (group.estoqueMinimo || 0) - group.totalSaldo;
                             return (
                                <tr key={group.sku} className="bg-white shadow-sm rounded-xl group hover:shadow-md transition-all border border-slate-100">
                                   <td className="px-4 py-4 rounded-l-xl">
                                      <div className="flex items-center gap-3">
                                         <span className="text-[8px] font-black text-red-500 bg-red-50 px-2 py-0.5 rounded uppercase">CRÍTICO</span>
                                         <div>
                                            <p className="font-black text-slate-900 text-xs uppercase italic">{group.sku}</p>
                                            <p className="text-[9px] font-bold text-slate-400 truncate max-w-[250px] uppercase">{group.nome}</p>
                                         </div>
                                      </div>
                                   </td>
                                   <td className="px-4 py-4">
                                      <p className="text-[10px] font-bold text-slate-500 uppercase">{group.fornecedor || '---'}</p>
                                   </td>
                                   <td className="px-4 py-4 text-center">
                                      <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[9px] font-black uppercase">
                                         {group.rolosAtivos} Volume(s)
                                      </span>
                                   </td>
                                   <td className="px-4 py-4 text-center">
                                      <span className="text-xs font-bold text-slate-400">{group.estoqueMinimo?.toFixed(2)} ML</span>
                                   </td>
                                   <td className="px-4 py-4 text-center">
                                      <span className="text-xs font-black text-red-600">{group.totalSaldo.toFixed(2)} ML</span>
                                   </td>
                                   <td className="px-4 py-4 text-right rounded-r-xl">
                                      <p className="font-black text-slate-900 text-sm italic">-{deficit.toFixed(2)} ML</p>
                                   </td>
                                </tr>
                             );
                          })}
                       </tbody>
                    </table>
                 ) : (
                    <div className="h-full flex flex-col items-center justify-center opacity-30">
                       <div className="w-16 h-16 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                       </div>
                       <p className="font-black text-slate-400 uppercase tracking-widest text-xs">Estoque Saudável. Nenhum item crítico.</p>
                    </div>
                 )}
              </div>
              
              <div className="p-6 bg-slate-50 border-t border-slate-100 text-right">
                 <button onClick={() => setShowReplenishmentModal(false)} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all">Fechar Relatório</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default InventoryBI;
