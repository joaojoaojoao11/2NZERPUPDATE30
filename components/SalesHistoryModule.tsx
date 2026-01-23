
import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { DataService } from '../services/dataService';
import { supabaseClient as supabase } from '../services/core';
import { SalesHistoryItem, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import { jsPDF } from 'jspdf';

interface SalesHistoryModuleProps {
  user: User;
}

// Tipo local para o Staging
interface SalesStagingItem {
  data: SalesHistoryItem;
  status: 'NEW' | 'CHANGED' | 'UNCHANGED';
  diff?: string[];
}

const SalesHistoryModule: React.FC<SalesHistoryModuleProps> = ({ user }) => {
  const [activeTab, setActiveTab] = useState<'HISTORY' | 'COMMISSION'>('HISTORY');
  const [historyData, setHistoryData] = useState<SalesHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  
  const [showImportModal, setShowImportModal] = useState(false);
  const [stagingData, setStagingData] = useState<SalesStagingItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [salesRepFilter, setSalesRepFilter] = useState('TODOS');

  const [selectedCommissionRep, setSelectedCommissionRep] = useState<string>('');
  const [commissionMonth, setCommissionMonth] = useState(new Date().toISOString().slice(0, 7));
  
  const [commissionSortConfig, setCommissionSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ 
    key: 'date', 
    direction: 'desc' 
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await DataService.getSalesHistory(1000); 
      setHistoryData(data);
    } catch (e) {
      console.error(e);
      setToast({ msg: 'Erro ao carregar histórico.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOlistSync = async () => {
    if (!supabase) {
      setToast({ msg: 'Erro: Cliente Supabase não está disponível.', type: 'error' });
      return;
    }

    setIsSyncing(true);
    setToast({ msg: 'Iniciando sincronização com Olist...', type: 'info' });
    try {
      // CORREÇÃO: Invoca a Edge Function correta 'olist-integration'.
      const { data, error } = await supabase.functions.invoke('olist-integration');

      if (error) {
        // O erro "Failed to send a request" geralmente acontece se o nome da função estiver errado ou a função não estiver implantada (deployed).
        throw new Error(`Falha na comunicação com a Edge Function: ${error.message}`);
      }

      const syncCount = data?.upserted_count || 0;
      const readCount = data?.orders_read || 0;
      
      // A lógica de salvar foi removida. O frontend apenas reage ao resultado.
      if (syncCount > 0) {
        setToast({ msg: `${syncCount} pedidos novos foram salvos com sucesso!`, type: 'success' });
        await fetchData(); // Recarrega a tabela para mostrar os dados novos que o robô salvou.
      } else {
        setToast({ msg: `Sincronização concluída. ${readCount} pedidos analisados, nenhum novo para salvar.`, type: 'info' });
      }

    } catch (err: any) {
      console.error("Erro detalhado na sincronização:", err);
      setToast({ msg: `Erro na sincronização: ${err.message}`, type: 'error' });
    } finally {
      setIsSyncing(false);
    }
  };

  const getNormalizedRep = (repName?: string) => {
    if (!repName || repName.trim() === '') return 'SISTEMA';
    return repName.trim().toUpperCase();
  };

  const uniqueStatuses = useMemo(() => {
    const statuses = new Set(historyData.map(i => i.status || 'N/A').filter(Boolean));
    return Array.from(statuses).sort();
  }, [historyData]);

  const uniqueReps = useMemo(() => {
    const reps = new Set(historyData.map(i => getNormalizedRep(i.salesRep)));
    return Array.from(reps).sort();
  }, [historyData]);

  useEffect(() => {
    if (uniqueReps.length > 0 && !selectedCommissionRep) {
      setSelectedCommissionRep(uniqueReps[0]);
    }
  }, [uniqueReps]);

  const filteredData = useMemo(() => {
    return historyData.filter(item => {
      const term = searchTerm.toLowerCase();
      const matchesText = 
        (item.orderNumber || '').toLowerCase().includes(term) ||
        (item.contactName || '').toLowerCase().includes(term) ||
        (item.sku || '').toLowerCase().includes(term) ||
        (item.externalId || '').toLowerCase().includes(term);

      if (!matchesText) return false;

      if (startDate || endDate) {
        const itemDate = item.saleDate ? item.saleDate.split('T')[0] : '';
        if (startDate && itemDate < startDate) return false;
        if (endDate && itemDate > endDate) return false;
      }

      if (statusFilter !== 'TODOS' && item.status !== statusFilter) return false;
      if (salesRepFilter !== 'TODOS' && getNormalizedRep(item.salesRep) !== salesRepFilter) return false;

      return true;
    });
  }, [historyData, searchTerm, startDate, endDate, statusFilter, salesRepFilter]);

  const commissionStats = useMemo(() => {
    const rep = selectedCommissionRep;
    if (!rep) return { orders: [], totalSales: 0, totalItems: 0, orderCount: 0 };

    const repItems = historyData.filter(i => {
        const isRepMatch = getNormalizedRep(i.salesRep) === rep;
        if (!isRepMatch) return false;
        if (commissionMonth) {
            if (!i.saleDate) return false;
            const itemMonth = i.saleDate.slice(0, 7);
            if (itemMonth !== commissionMonth) return false;
        }
        return true;
    });

    const ordersMap = new Map<string, {
      orderNumber: string;
      date: string;
      client: string;
      totalValue: number;
      itemCount: number;
      status: string;
    }>();

    repItems.forEach(item => {
      const orderNum = item.orderNumber || 'S/N';
      if (!ordersMap.has(orderNum)) {
        ordersMap.set(orderNum, {
          orderNumber: orderNum,
          date: item.saleDate || '',
          client: item.contactName || 'Consumidor',
          totalValue: 0,
          itemCount: 0,
          status: item.status || 'N/A'
        });
      }

      const order = ordersMap.get(orderNum)!;
      const lineTotal = (item.unitPrice || 0) * (item.quantity || 0);
      order.totalValue += lineTotal;
      order.itemCount += 1;
    });

    const orders = Array.from(ordersMap.values()).sort((a, b) => {
        const { key, direction } = commissionSortConfig;
        let valA = a[key as keyof typeof a];
        let valB = b[key as keyof typeof b];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    const totalSales = orders.reduce((acc, o) => {
        const statusNormalized = (o.status || '').toUpperCase().trim();
        if (statusNormalized === 'ENTREGUE') {
            return acc + o.totalValue;
        }
        return acc;
    }, 0);
    const totalItems = orders.reduce((acc, o) => acc + o.itemCount, 0);
    return { orders, totalSales, totalItems, orderCount: orders.length };
  }, [historyData, selectedCommissionRep, commissionMonth, commissionSortConfig]);

  const handleCommissionSort = (key: string) => {
    setCommissionSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };

  const SortIndicator = ({ active, direction }: { active: boolean, direction: 'asc' | 'desc' }) => {
    if (!active) return <span className="opacity-20 ml-1">⇅</span>;
    return <span className="ml-1 text-emerald-800">{direction === 'asc' ? '▲' : '▼'}</span>;
  };

  const generateCommissionReport = () => {
    if (!commissionStats.orders.length) {
      setToast({ msg: 'Não há dados para gerar o relatório.', type: 'error' });
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    doc.setFillColor(16, 185, 129);
    doc.rect(0, 0, pageWidth, 35, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RELATÓRIO DE APURAÇÃO DE VENDAS', 15, 18);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`VENDEDOR: ${selectedCommissionRep}`, 15, 26);
    doc.text(`COMPETÊNCIA: ${commissionMonth}`, 15, 31);
    
    doc.text(`EMISSÃO: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}`, pageWidth - 15, 31, { align: 'right' });

    y = 50;
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMO DO PERÍODO', 15, y);
    
    y += 8;
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(15, y, 60, 20, 2, 2, 'FD');
    doc.setFontSize(8);
    doc.text('BASE CÁLCULO (ENTREGUES)', 20, y + 6);
    doc.setFontSize(12);
    doc.setTextColor(16, 185, 129);
    doc.text(`R$ ${commissionStats.totalSales.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 20, y + 15);

    doc.setFillColor(245, 245, 245);
    doc.roundedRect(80, y, 50, 20, 2, 2, 'FD');
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(8);
    doc.text('PEDIDOS TOTAL', 85, y + 6);
    doc.setFontSize(12);
    doc.text(`${commissionStats.orderCount}`, 85, y + 15);

    doc.setFillColor(245, 245, 245);
    doc.roundedRect(135, y, 50, 20, 2, 2, 'FD');
    doc.setFontSize(8);
    doc.text('ITENS/LINHAS', 140, y + 6);
    doc.setFontSize(12);
    doc.text(`${commissionStats.totalItems}`, 140, y + 15);

    y += 35;
    doc.setFillColor(230, 230, 230);
    doc.rect(15, y, pageWidth - 30, 8, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    
    doc.text('DATA', 18, y + 5);
    doc.text('PEDIDO', 40, y + 5);
    doc.text('CLIENTE', 65, y + 5);
    doc.text('STATUS', 130, y + 5);
    doc.text('ITENS', 155, y + 5);
    doc.text('VALOR TOTAL', 190, y + 5, { align: 'right' });

    y += 10;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);

    commissionStats.orders.forEach((order, index) => {
        if (y > 275) {
            doc.addPage();
            y = 20;
            doc.setFillColor(230, 230, 230);
            doc.rect(15, y, pageWidth - 30, 8, 'F');
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(80, 80, 80);
            doc.text('DATA', 18, y + 5);
            doc.text('PEDIDO', 40, y + 5);
            doc.text('CLIENTE', 65, y + 5);
            doc.text('STATUS', 130, y + 5);
            doc.text('ITENS', 155, y + 5);
            doc.text('VALOR TOTAL', 190, y + 5, { align: 'right' });
            y += 10;
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(0, 0, 0);
        }

        if (index % 2 === 0) {
            doc.setFillColor(250, 250, 250);
            doc.rect(15, y - 4, pageWidth - 30, 8, 'F');
        }

        const dateStr = order.date ? new Date(order.date).toLocaleDateString('pt-BR') : '-';
        doc.text(dateStr, 18, y);
        doc.text(order.orderNumber, 40, y);
        const clientName = doc.splitTextToSize(order.client, 60);
        doc.text(clientName, 65, y);
        
        if (order.status.includes('CANCEL')) doc.setTextColor(200, 0, 0);
        else if (order.status === 'ENTREGUE') doc.setTextColor(0, 150, 0);
        doc.text(order.status, 130, y);
        doc.setTextColor(0, 0, 0);

        doc.text(String(order.itemCount), 160, y, { align: 'center' });
        doc.text(order.totalValue.toLocaleString('pt-BR', {minimumFractionDigits: 2}), 190, y, { align: 'right' });
        y += Math.max(6, clientName.length * 4);
    });

    y += 5;
    doc.setDrawColor(0);
    doc.setLineWidth(0.1);
    doc.line(15, y, pageWidth - 15, y);
    y += 5;
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text('Relatório gerado automaticamente pelo sistema NZERP. Apenas pedidos com status ENTREGUE compõem a base de cálculo de comissão financeira.', 15, y);

    doc.save(`Relatorio_Comissao_${selectedCommissionRep.replace(/\s+/g, '_')}_${commissionMonth}.pdf`);
    setToast({ msg: 'Relatório PDF gerado com sucesso!', type: 'success' });
  };

  const clearFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setStatusFilter('TODOS');
    setSalesRepFilter('TODOS');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10 flex flex-col h-full">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 shrink-0">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">
            Histórico de Vendas
          </h2>
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] mt-2 italic">
            Integração e Análise de Pedidos
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleOlistSync}
            disabled={isSyncing}
            className="px-6 py-4 bg-indigo-600 text-white rounded-2xl font-black text-[9px] uppercase tracking-widest shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center space-x-2 italic disabled:opacity-50"
          >
            {isSyncing ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            )}
            <span>Sincronizar Olist</span>
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-[2rem] border border-slate-100 shadow-sm grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
         <div className="lg:col-span-3 relative">
            <svg className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input 
              type="text" 
              placeholder="Buscar Pedido, Cliente ou SKU..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl outline-none text-xs font-bold uppercase transition-all"
            />
         </div>
         <div className="lg:col-span-3 flex gap-2">
            <div className="flex-1">
               <label className="text-[8px] font-black text-slate-400 uppercase ml-2 mb-1 block">De</label>
               <input 
                 type="date" 
                 value={startDate}
                 onChange={(e) => setStartDate(e.target.value)}
                 className="w-full px-3 py-2 bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl outline-none text-xs font-bold uppercase"
               />
            </div>
            <div className="flex-1">
               <label className="text-[8px] font-black text-slate-400 uppercase ml-2 mb-1 block">Até</label>
               <input 
                 type="date" 
                 value={endDate}
                 onChange={(e) => setEndDate(e.target.value)}
                 className="w-full px-3 py-2 bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl outline-none text-xs font-bold uppercase"
               />
            </div>
         </div>
         <div className="lg:col-span-2">
            <label className="text-[8px] font-black text-slate-400 uppercase ml-2 mb-1 block">Status</label>
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl outline-none text-xs font-bold uppercase cursor-pointer"
            >
               <option value="TODOS">Todos</option>
               {uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
         </div>
         <div className="lg:col-span-2">
            <label className="text-[8px] font-black text-slate-400 uppercase ml-2 mb-1 block">Vendedor</label>
            <select 
              value={salesRepFilter}
              onChange={(e) => setSalesRepFilter(e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl outline-none text-xs font-bold uppercase cursor-pointer"
            >
               <option value="TODOS">Todos</option>
               {uniqueReps.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
         </div>
         <div className="lg:col-span-2 flex justify-end">
            <button 
              onClick={clearFilters}
              className="px-4 py-3 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
            >
               <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
               Limpar
            </button>
         </div>
      </div>

      <div className="table-container flex-1 overflow-auto border border-slate-200 rounded-[2rem] bg-white shadow-sm custom-scrollbar">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 opacity-50">
            <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em]">Carregando Vendas...</p>
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0" style={{ minWidth: '2000px' }}>
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800 sticky left-0 z-30">ID</th>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-center border-b border-slate-800">Data Venda</th>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800">Pedido</th>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800">Cliente</th>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800">SKU</th>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800">Produto</th>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-center border-b border-slate-800">Qtd</th>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-right border-b border-slate-800">Total</th>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-center border-b border-slate-800">Situação</th>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800">Rastreio</th>
                <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800">Vendedor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredData.map((item, idx) => (
                <tr key={item.id || idx} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4 sticky left-0 bg-white group-hover:bg-slate-50 border-r border-slate-100 font-mono text-[9px] font-bold text-slate-400">{item.externalId || item.id}</td>
                  <td className="px-6 py-4 text-center text-[10px] font-bold text-slate-600">{item.saleDate ? new Date(item.saleDate).toLocaleDateString('pt-BR') : '-'}</td>
                  <td className="px-6 py-4 font-black text-blue-600 text-[10px]">{item.orderNumber}</td>
                  <td className="px-6 py-4 text-[10px] font-bold text-slate-700 uppercase truncate max-w-[150px]" title={item.contactName}>{item.contactName}</td>
                  <td className="px-6 py-4 font-black text-slate-900 text-[10px]">{item.sku}</td>
                  <td className="px-6 py-4 text-[9px] text-slate-500 uppercase truncate max-w-[200px]" title={item.description}>{item.description}</td>
                  <td className="px-6 py-4 text-center font-black text-slate-800 text-[11px]">{item.quantity}</td>
                  <td className="px-6 py-4 text-right font-black text-slate-900 text-[11px]">R$ {item.totalAmount?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${
                      (item.status || '').includes('CANCEL') ? 'bg-red-50 text-red-600 border-red-100' :
                      (item.status || '').includes('PENDENTE') ? 'bg-amber-50 text-amber-600 border-amber-100' :
                      'bg-emerald-50 text-emerald-600 border-emerald-100'
                    }`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-[9px] font-mono text-slate-400">{item.trackingCode || '-'}</td>
                  <td className="px-6 py-4 text-[9px] font-bold text-slate-500 uppercase">{item.salesRep || '-'}</td>
                </tr>
              ))}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-20 text-center opacity-30 font-black uppercase text-[10px] tracking-widest italic">
                    Nenhum registro encontrado para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default SalesHistoryModule;
