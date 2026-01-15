
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, PieChart, Pie, Cell 
} from 'recharts';
import { DataService } from '../services/dataService';
import { StockItem, AuditLog, MasterProduct } from '../types';
import { ICONS } from '../constants';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const InfoBalloon: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <div className="group relative inline-block ml-2 align-middle">
    <div className="cursor-help bg-slate-100 text-slate-400 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black border border-slate-200 hover:bg-slate-200 hover:text-slate-600 transition-colors">?</div>
    <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-4 bg-slate-900 text-white text-[10px] rounded-xl shadow-2xl z-50 border border-slate-700 animate-in fade-in zoom-in-95 pointer-events-none">
      <p className="font-black text-blue-400 mb-1.5 uppercase tracking-widest">{title}</p>
      <p className="leading-relaxed opacity-90 font-medium text-slate-300">{text}</p>
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900"></div>
    </div>
  </div>
);

const BIAnalytics: React.FC = () => {
  const [rawInventory, setRawInventory] = useState<StockItem[]>([]);
  const [rawLogs, setRawLogs] = useState<AuditLog[]>([]);
  const [rawMaster, setRawMaster] = useState<MasterProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      DataService.getInventory(),
      DataService.getLogs(),
      DataService.getMasterCatalog()
    ]).then(([inv, logs, master]) => {
      setRawInventory(inv || []);
      setRawLogs(logs || []);
      setRawMaster(master || []);
      setLoading(false);
    }).catch(err => {
      console.error("BI Sync Error:", err);
      setLoading(false);
    });
  }, []);

  const analytics = useMemo(() => {
    // 1. Pilar Rentabilidade
    const salesLogs = rawLogs.filter(l => l.acao && l.acao.includes('VENDA'));
    
    // Verificação de integridade de dados para balões
    const hasPriceData = rawMaster.some(m => m.precoVenda && m.precoVenda > 0);
    const hasLeadTimeData = rawLogs.some(l => l.dataPedidoFornecedor);

    const totalRevenue = salesLogs.reduce((acc, l) => {
      const price = rawMaster.find(m => m.sku === l.sku)?.precoVenda || 0;
      // Fix: Changed l.nf to l.nfControle as per AuditLog type
      return acc + ((l.quantidade || 0) * price);
    }, 0);
    
    const totalOrders = new Set(salesLogs.map(l => l.nfControle || l.id)).size || 1;
    const ticketMedio = totalRevenue > 0 ? totalRevenue / totalOrders : 0;

    const marginData = rawMaster.map(m => {
      const salePrice = m.precoVenda || (m.custoUnitario || 0) * 1.5; // Mock markup se não houver preco
      const costPrice = m.custoUnitario || 0;
      const margin = salePrice - costPrice;
      return { 
        sku: m.sku, 
        margin, 
        name: m.nome,
        isEstimated: !m.precoVenda 
      };
    }).sort((a, b) => b.margin - a.margin).slice(0, 8);

    // 2. Pilar Gestão de Estoque
    const totalInvValue = rawInventory.reduce((acc, curr) => acc + (curr.quantMl * (curr.custoUnitario || 0)), 0);
    
    const stagnantItems = rawInventory.filter(item => {
      if (!item.dataEntrada) return false;
      const days = (Date.now() - new Date(item.dataEntrada).getTime()) / (1000 * 60 * 60 * 24);
      return days > 60; // Considera parado após 60 dias
    });
    const stagnantValue = stagnantItems.reduce((acc, i) => acc + (i.quantMl * (i.custoUnitario || 0)), 0);

    // Giro: (Vendas / Estoque Médio) - Simplificado
    const totalSalesQty = salesLogs.reduce((acc, l) => acc + (l.quantidade || 0), 0);
    const totalStockQty = rawInventory.reduce((acc, i) => acc + i.quantMl, 0) || 1;
    const inventoryTurnover = totalSalesQty / totalStockQty;

    // 3. Pilar Supply Chain
    const supplierConcentration: Record<string, number> = {};
    rawInventory.forEach(item => {
      const sup = item.fornecedor || 'N/A';
      supplierConcentration[sup] = (supplierConcentration[sup] || 0) + (item.quantMl * (item.custoUnitario || 0));
    });
    const supplierData = Object.entries(supplierConcentration)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    return {
      ticketMedio,
      totalRevenue,
      marginData,
      totalInvValue,
      stagnantValue,
      inventoryTurnover,
      supplierData,
      hasPriceData,
      hasLeadTimeData
    };
  }, [rawInventory, rawLogs, rawMaster]);

  const generatePDF = async () => {
    if (!dashboardRef.current) return;
    setIsGeneratingPdf(true);
    try {
      const canvas = await html2canvas(dashboardRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#f8fafc'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`NZSTOK_Relatorio_Executivo_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (err) {
      console.error("PDF Generation Error:", err);
      alert("Erro ao gerar PDF. Tente novamente.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 opacity-30">
      <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-4"></div>
      <p className="text-[10px] font-black uppercase tracking-[0.5em] italic">Processando Indicadores...</p>
    </div>
  );

  return (
    <div className="space-y-10 pb-20 max-w-[1400px] mx-auto animate-in fade-in duration-700">
      {/* HEADER E AÇÕES */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200 pb-8">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Dashboard de Valor</h2>
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.5em] mt-3 italic flex items-center">
            <span className="w-8 h-px bg-blue-600 mr-4"></span>
            Performance & Supply Chain
          </p>
        </div>
        <button 
          onClick={generatePDF}
          disabled={isGeneratingPdf}
          className="px-8 py-4 bg-slate-900 text-white rounded-[2rem] font-black text-[10px] uppercase tracking-widest hover:bg-blue-600 transition-all shadow-xl flex items-center space-x-3 active:scale-95 disabled:opacity-50"
        >
          {isGeneratingPdf ? (
            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          )}
          <span>Gerar Relatório PDF</span>
        </button>
      </div>

      <div ref={dashboardRef} className="space-y-12 p-2 bg-[#f8fafc]">
        {/* PILAR 1: RENTABILIDADE */}
        <section className="space-y-6">
          <div className="flex items-center space-x-3">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest italic">1. Rentabilidade e Margem</h3>
            {!analytics.hasPriceData && (
              <InfoBalloon 
                title="Margem Estimada" 
                text="O campo 'Preço de Venda' não está preenchido no Catálogo Mestre. Os indicadores de margem estão usando um markup padrão de 50% sobre o custo. Atualize o catálogo para precisão real." 
              />
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Ticket Médio (Vendas)</p>
               <h4 className="text-4xl font-black italic tracking-tighter text-slate-900">
                 R$ {analytics.ticketMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
               </h4>
               <div className="mt-4 flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${analytics.hasPriceData ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`}></span>
                  <span className="text-[8px] font-bold text-slate-400 uppercase">{analytics.hasPriceData ? 'Dados Reais' : 'Estimado (Falta Preço Venda)'}</span>
               </div>
            </div>

            <div className="md:col-span-2 bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8 italic">Ranking de Margem Bruta por SKU (R$/ML)</p>
               <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.marginData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" hide />
                      <YAxis dataKey="sku" type="category" width={80} fontSize={10} fontStyle="bold" axisLine={false} tickLine={false} />
                      <Tooltip 
                        contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.1)'}}
                        cursor={{fill: '#f8fafc'}}
                      />
                      <Bar dataKey="margin" radius={[0, 8, 8, 0]} barSize={20}>
                        {analytics.marginData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.isEstimated ? '#fbbf24' : '#10b981'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
               </div>
            </div>
          </div>
        </section>

        {/* PILAR 2: GESTÃO DE ESTOQUE */}
        <section className="space-y-6">
          <div className="flex items-center space-x-3">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest italic">2. Saúde do Estoque</h3>
            <InfoBalloon 
                title="Giro de Estoque" 
                text="Indicador de eficiência que mostra quantas vezes o inventário foi renovado no período. Baixo giro com alto valor indica capital parado." 
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-5 bg-slate-950 p-10 rounded-[3rem] shadow-2xl text-white border border-slate-800 flex flex-col justify-center relative overflow-hidden">
               <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-3 italic">Estoque Parado (+60 dias)</p>
               <h4 className="text-5xl font-black italic tracking-tighter leading-none">R$ {analytics.stagnantValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h4>
               <p className="text-[9px] text-slate-500 font-bold uppercase mt-6 tracking-widest leading-none">Capital Imobilizado Crítico</p>
               <div className="absolute right-[-20%] bottom-[-20%] opacity-10"><ICONS.History className="w-64 h-64" /></div>
            </div>

            <div className="lg:col-span-7 bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
               <div className="flex justify-between items-center mb-8">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Performance de Giro</p>
                  <div className="text-right">
                     <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Valor Total Ativo</p>
                     <p className="text-sm font-black text-slate-900">R$ {analytics.totalInvValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
               </div>
               <div className="flex items-center justify-center h-48 bg-slate-50 rounded-3xl border border-slate-100">
                  <div className="text-center">
                     <p className="text-4xl font-black text-blue-600 mb-2">{analytics.inventoryTurnover.toFixed(2)}x</p>
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Giro Médio Global</p>
                  </div>
               </div>
            </div>
          </div>
        </section>

        {/* PILAR 3: SUPPLY CHAIN */}
        <section className="space-y-6">
          <div className="flex items-center space-x-3">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest italic">3. Cadeia de Suprimentos</h3>
            {!analytics.hasLeadTimeData && (
               <InfoBalloon 
                 title="Lead Time Indisponível" 
                 text="Para calcular o tempo médio de entrega (Lead Time), é necessário registrar a 'Data do Pedido' nas entradas de nota fiscal. Atualmente, o sistema só possui a data de entrada física." 
               />
            )}
          </div>

          <div className="bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-sm">
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                <div className="space-y-8">
                   <div>
                      <h4 className="text-xl font-black text-slate-900 uppercase italic tracking-tighter mb-3">Concentração por Fornecedor</h4>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">Esta métrica identifica dependência excessiva de parceiros. Uma concentração > 50% em um único fornecedor representa risco alto de ruptura.</p>
                   </div>
                   
                   <div className="space-y-3">
                      {analytics.supplierData.map((sup, idx) => (
                        <div key={sup.name} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-transparent hover:border-blue-100 transition-all">
                           <div className="flex items-center space-x-3">
                              <span className="w-6 h-6 rounded-lg bg-white shadow-sm flex items-center justify-center font-black text-[9px] text-slate-400">#{idx+1}</span>
                              <span className="text-[10px] font-black text-slate-700 uppercase">{sup.name}</span>
                           </div>
                           <span className="font-black text-blue-600 italic text-xs">{((sup.value / (analytics.totalInvValue || 1)) * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                   </div>
                </div>

                <div className="h-[300px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie 
                        data={analytics.supplierData} 
                        dataKey="value" 
                        nameKey="name" 
                        cx="50%" 
                        cy="50%" 
                        innerRadius={60} 
                        outerRadius={100} 
                        stroke="none"
                      >
                         {analytics.supplierData.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" iconSize={8} wrapperStyle={{fontSize: '9px', fontWeight: 700}} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Centro do Gráfico */}
                  <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                     <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Total Ativos</p>
                     <p className="text-lg font-black text-slate-900">{(analytics.totalInvValue/1000).toFixed(0)}k</p>
                  </div>
                </div>
             </div>
          </div>
        </section>

        {/* FOOTER PDF */}
        <div className="hidden pdf-only mt-10 pt-6 border-t border-slate-200 text-center">
           <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.5em]">Relatório Gerado Automaticamente pelo NZSTOK ERP</p>
        </div>
      </div>
    </div>
  );
};

export default BIAnalytics;
