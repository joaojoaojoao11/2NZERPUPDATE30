
import React, { useState, useEffect, useMemo } from 'react';
import { FinanceService } from '../services/financeService';
import { AccountsReceivable, AccountsPayable } from '../types';
import {
   ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { ICONS } from '../constants';

const CashFlowBI: React.FC = () => {
   const [loading, setLoading] = useState(true);
   const [receivables, setReceivables] = useState<AccountsReceivable[]>([]);
   const [payables, setPayables] = useState<AccountsPayable[]>([]);

   // Filtros
   const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
   const [selectedWeek, setSelectedWeek] = useState<'ALL' | '1' | '2' | '3' | '4' | '5'>('ALL');

   useEffect(() => {
      const fetchData = async () => {
         setLoading(true);
         try {
            const [recvData, payData] = await Promise.all([
               FinanceService.getAccountsReceivable(),
               FinanceService.getAccountsPayable()
            ]);
            setReceivables(recvData || []);
            setPayables(payData || []);
         } catch (e) {
            console.error("Erro ao carregar dados de Fluxo de Caixa", e);
         } finally {
            setLoading(false);
         }
      };
      fetchData();
   }, []);

   const dailyData = useMemo(() => {
      const [year, month] = selectedMonth.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();

      const today = new Date().toISOString().split('T')[0];

      // Mapeamento por dia
      const map: Record<number, {
         day: number,
         date: string,
         receive: number,      // Total Previsto (Doc)
         receiveLiquidated: number, // Total Recebido (Baixado)
         receiveDelinquent: number, // Vencido em Aberto

         pay: number,          // Total Previsto
         payLiquidated: number // Total Pago
      }> = {};

      for (let i = 1; i <= daysInMonth; i++) {
         map[i] = {
            day: i,
            date: `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`,
            receive: 0,
            receiveLiquidated: 0,
            receiveDelinquent: 0,
            pay: 0,
            payLiquidated: 0
         };
      }

      const parseDate = (d: string) => {
         if (!d) return null;
         // Trata datas YYYY-MM-DD
         const parts = d.split('-');
         if (parts.length === 3 && parseInt(parts[0]) === year && parseInt(parts[1]) === month) {
            return parseInt(parts[2]);
         }
         return null;
      };

      // Somar Recebíveis
      receivables.forEach(item => {
         if (item.situacao === 'CANCELADO') return;

         // Fallback de datas para garantir que PIX/Cartão/À Vista entrem no fluxo
         // Se não tiver vencimento, tenta data de liquidação (se pago) ou emissão.
         const dateToUse = item.data_vencimento || item.data_liquidacao || item.data_emissao;
         const day = parseDate(dateToUse);

         if (day && map[day]) {
            const valorDoc = (item.valor_documento || 0);
            map[day].receive += valorDoc;

            // Checagem de Status
            const sit = item.situacao ? item.situacao.toLowerCase() : '';
            // Adicionado 'paga' e 'total' que são comuns
            const isPago = sit === 'paga' || sit === 'pago' || sit === 'liquidado' || sit === 'baixado' || sit === 'total';
            const vencimento = item.data_vencimento || dateToUse; // Usa a data resolvida se vencimento for nulo

            if (isPago) {
               // Se pago, usa o valor_recebido se existir (pois pode ter juros/desconto), senão valor_documento
               const valorRecebido = (item.valor_recebido && item.valor_recebido > 0) ? item.valor_recebido : valorDoc;
               map[day].receiveLiquidated += valorRecebido;
            } else if (vencimento < today) {
               // Vencido e não pago
               map[day].receiveDelinquent += valorDoc;
            }
         }
      });

      // Somar Pagáveis
      payables.forEach(item => {
         if (item.situacao === 'CANCELADO') return;

         // Fallback para pagáveis também
         const dateToUse = item.dataVencimento || item.dataLiquidacao || item.dataEmissao;
         const day = parseDate(dateToUse);

         if (day && map[day]) {
            const valor = (item.valorDocumento || 0);
            map[day].pay += valor;

            // Verifica se está liquidado
            const sit = item.situacao ? item.situacao.toLowerCase() : '';
            if (sit === 'paga' || sit === 'pago' || sit === 'liquidado' || sit === 'baixado') {
               map[day].payLiquidated += valor;
            }
         }
      });

      let result = Object.values(map).map(d => {
         // Receita Pendente (Futura) = Total - Liquidado - Inadimplente (aprox, ajustado por max 0)
         const receivePending = Math.max(0, d.receive - d.receiveDelinquent - d.receiveLiquidated);
         const receiveHealthy = d.receiveLiquidated + receivePending; // O que realmente conta para o saldo (Liquidado + Futuro Confiável)

         const balance = receiveHealthy - d.pay;
         const gap = Math.max(0, d.pay - receiveHealthy);

         return {
            ...d,
            receivePending,
            payPending: Math.max(0, d.pay - d.payLiquidated),
            balance, // Saldo do Dia (Pode ser negativo)
            need: gap,
            surplus: Math.max(0, receiveHealthy - d.pay)
         };
      });

      // Filtro de Semana Dinâmico
      if (selectedWeek !== 'ALL') {
         const w = parseInt(selectedWeek);
         const startDay = (w - 1) * 7 + 1;
         const endDay = w === 5 ? 31 : w * 7; // Semana 5 pega até o fim do mês
         result = result.filter(d => d.day >= startDay && d.day <= endDay);
      }

      return result;
   }, [receivables, payables, selectedMonth, selectedWeek]);

   const totals = useMemo(() => {
      return dailyData.reduce((acc, curr) => ({
         receive: acc.receive + curr.receive,
         pay: acc.pay + curr.pay,
         balance: acc.balance + curr.balance
      }), { receive: 0, pay: 0, balance: 0 });
   }, [dailyData]);

   const handlePrint = () => {
      const originalTitle = document.title;
      document.title = 'Demonstrativo de Fluxo de Caixa';
      window.print();
      document.title = originalTitle;
   };

   if (loading) return (
      <div className="flex flex-col items-center justify-center h-full opacity-50">
         <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
         <p className="mt-4 font-black uppercase text-xs tracking-widest text-slate-400">Calculando Fluxo Diário...</p>
      </div>
   );

   return (
      <div id="printable-area" className="space-y-8 animate-in fade-in duration-500 h-full flex flex-col pb-10">

         <style>{`
            @media print {
               @page { size: A4; margin: 10mm; }
               body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
               body * { visibility: hidden; }
               #printable-area, #printable-area * { visibility: visible; }
               #printable-area { 
                  position: absolute; 
                  top: 0; 
                  left: 0; 
                  width: 100%; 
                  height: auto; 
                  overflow: visible !important; 
                  background: white;
                  padding: 0;
                  margin: 0;
               }
               .no-print { display: none !important; }
               .print-only { display: block !important; }
               /* Remove scrollbars from table container */
               .overflow-auto { overflow: visible !important; height: auto !important; }
               /* Table adjustments */
               table { width: 100%; border-collapse: collapse; font-size: 10pt; }
               th, td { padding: 4px 8px !important; border: 1px solid #e2e8f0; }
               /* Hide background colors if desired, or keep them with print-color-adjust */
            }
            .print-only { display: none; }
         `}</style>

         {/* PRINT HEADER */}
         <div className="print-only mb-6 border-b border-black pb-4">
            <h1 className="text-2xl font-bold uppercase tracking-widest text-black">Demonstrativo de Fluxo de Caixa</h1>
            <div className="flex justify-between text-sm mt-2 text-slate-600">
               <span>Período: {selectedMonth.split('-').reverse().join('/')} ({selectedWeek === 'ALL' ? 'Mês Completo' : `Semana ${selectedWeek}`})</span>
               <span>Emissão: {new Date().toLocaleDateString('pt-BR')}</span>
            </div>
         </div>

         {/* HEADER */}
         <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 shrink-0 no-print">
            <div>
               <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Fluxo de Caixa Diário</h2>
               <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] mt-2 italic">
                  Controle de Liquidez: Receita vs Débito
               </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
               {/* BOTÃO IMPRIMIR */}
               <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl shadow-md hover:bg-slate-800 transition-all font-bold text-xs uppercase tracking-wider"
               >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                     <polyline points="6 9 6 2 18 2 18 9"></polyline>
                     <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                     <rect x="6" y="14" width="12" height="8"></rect>
                  </svg>
                  Imprimir Relatório
               </button>

               <div className="flex flex-wrap items-center gap-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center px-3 border-r border-slate-100">
                     <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mr-2">Mês</span>
                     <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="bg-transparent border-none outline-none text-xs font-black text-slate-700 uppercase cursor-pointer"
                     />
                  </div>

                  <div className="flex gap-1 overflow-x-auto">
                     {['ALL', '1', '2', '3', '4', '5'].map((w) => (
                        <button
                           key={w}
                           onClick={() => setSelectedWeek(w as any)}
                           className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${selectedWeek === w
                                 ? 'bg-slate-900 text-white shadow-md'
                                 : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                              }`}
                        >
                           {w === 'ALL' ? 'Mês Completo' : `Sem ${w}`}
                        </button>
                     ))}
                  </div>
               </div>
            </div>
         </div>

         {/* KPI CARDS */}
         <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col justify-center relative overflow-hidden group">
               <div className="absolute right-[-20px] top-[-20px] bg-emerald-50 w-32 h-32 rounded-full group-hover:scale-110 transition-transform"></div>
               <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1 z-10">
                  {selectedWeek === 'ALL' ? 'Receber no Mês' : `Receber (Sem ${selectedWeek})`}
               </p>
               <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter z-10">
                  R$ {totals.receive.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
               </h3>
            </div>

            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col justify-center relative overflow-hidden group">
               <div className="absolute right-[-20px] top-[-20px] bg-red-50 w-32 h-32 rounded-full group-hover:scale-110 transition-transform"></div>
               <p className="text-[9px] font-black text-red-600 uppercase tracking-widest mb-1 z-10">
                  {selectedWeek === 'ALL' ? 'Pagar no Mês' : `Pagar (Sem ${selectedWeek})`}
               </p>
               <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter z-10">
                  R$ {totals.pay.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
               </h3>
            </div>

            <div className="bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl flex flex-col justify-center relative overflow-hidden">
               <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950"></div>
               <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1 z-10">Saldo Líquido (Período)</p>
               <h3 className={`text-3xl font-black italic tracking-tighter z-10 ${totals.balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  R$ {totals.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
               </h3>
               <p className="text-[8px] font-bold text-slate-500 uppercase mt-2 z-10">Receitas Saudáveis - Despesas</p>
            </div>
         </div>

         {/* GRÁFICO */}
         <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm h-80 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
               <ComposedChart data={dailyData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                     dataKey="day"
                     axisLine={false}
                     tickLine={false}
                     height={45}
                     tick={({ x, y, payload }) => {
                        const [year, month] = selectedMonth.split('-').map(Number);
                        const date = new Date(year, month - 1, Number(payload.value));
                        const weekDay = date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase().slice(0, 3);
                        return (
                           <g transform={`translate(${x},${y})`}>
                              <text x={0} y={0} dy={12} textAnchor="middle" fill="#94a3b8" fontSize={10} fontWeight={700}>
                                 {payload.value}
                              </text>
                              <text x={0} y={0} dy={24} textAnchor="middle" fill="#94a3b8" fontSize={7} fontWeight={700} opacity={0.7}>
                                 {weekDay}
                              </text>
                           </g>
                        );
                     }}
                     label={{ value: 'DIAS', position: 'insideBottomRight', offset: 0, fontSize: 10, fill: '#cbd5e1' }}
                  />
                  <YAxis
                     axisLine={false}
                     tickLine={false}
                     tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                     tickFormatter={(val) => `R$${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                     cursor={{ fill: '#f8fafc' }}
                     contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px -5px rgba(0,0,0,0.1)' }}
                     formatter={(val: number) => `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                     labelFormatter={(label) => `Dia ${label}`}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" />

                  <Bar name="Recebido" dataKey="receiveLiquidated" stackId="b" fill="#059669" radius={[4, 4, 0, 0]} barSize={12} />
                  <Bar name="A Receber" dataKey="receivePending" stackId="b" fill="#34d399" radius={[4, 4, 0, 0]} barSize={12} />
                  <Bar name="Inadimplência" dataKey="receiveDelinquent" stackId="b" fill="#facc15" radius={[4, 4, 0, 0]} barSize={12} />

                  <Bar name="Desp. Pendente" dataKey="payPending" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} barSize={12} />
                  <Bar name="Desp. Liquidada" dataKey="payLiquidated" stackId="a" fill="#60a5fa" radius={[4, 4, 0, 0]} barSize={12} />

                  <Line
                     type="monotone"
                     name="Saldo do Dia"
                     dataKey="balance"
                     stroke="#3b82f6"
                     strokeWidth={3}
                     dot={false}
                     activeDot={{ r: 6 }}
                  />
               </ComposedChart>
            </ResponsiveContainer>
         </div>

         {/* TABELA DETALHADA DIA A DIA */}
         <div className="flex-1 bg-white border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-sm flex flex-col">
            <div className="px-8 py-5 border-b border-slate-100 bg-slate-50/50">
               <h4 className="text-sm font-black text-slate-800 uppercase italic tracking-tighter">Detalhamento Diário ({selectedWeek === 'ALL' ? 'Mês Completo' : `Semana ${selectedWeek}`})</h4>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar">
               <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                     <tr>
                        <th className="px-8 py-4">Data</th>
                        <th className="px-8 py-4 text-right text-emerald-600">Previsto Receber</th>
                        <th className="px-8 py-4 text-right text-emerald-600">Total Recebido</th>
                        <th className="px-8 py-4 text-right text-yellow-500">Inadimplência</th>
                        <th className="px-8 py-4 text-right text-red-500">Total Pagar</th>
                        <th className="px-8 py-4 text-right text-blue-400">Total Liquidado</th>
                        <th className="px-8 py-4 text-right text-blue-600">Saldo do Dia</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-[11px]">
                     {dailyData.map(d => {
                        // saldo já vem calculado no result
                        if (d.receive === 0 && d.pay === 0) return null;

                        return (
                           <tr key={d.day} className="hover:bg-slate-50 transition-colors">
                              <td className="px-8 py-4 font-black text-slate-700">
                                 {d.date.split('-').reverse().join('/')}
                              </td>
                              <td className="px-8 py-4 text-right font-bold text-slate-600">
                                 R$ {d.receive.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-8 py-4 text-right font-bold text-emerald-600 bg-emerald-50/50">
                                 R$ {d.receiveLiquidated.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-8 py-4 text-right font-bold text-yellow-500 bg-yellow-50/50">
                                 R$ {d.receiveDelinquent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-8 py-4 text-right font-bold text-slate-600">
                                 R$ {d.pay.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-8 py-4 text-right font-bold text-blue-400">
                                 R$ {d.payLiquidated.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>
                              <td className={`px-8 py-4 text-right font-black ${d.balance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                 R$ {d.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>
                           </tr>
                        );
                     })}
                     {dailyData.every(d => d.receive === 0 && d.pay === 0) && (
                        <tr><td colSpan={7} className="py-12 text-center text-slate-300 font-black uppercase text-[10px]">Sem movimentações previstas para este período.</td></tr>
                     )}
                  </tbody>
               </table>
            </div>
         </div>
      </div>
   );
};

export default CashFlowBI;
