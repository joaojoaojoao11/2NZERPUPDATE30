
import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { DataService } from '../services/dataService';
import { OlistService } from '../services/olistService';
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
  const [selectedCommissionRep, setSelectedCommissionRep] = useState<string>('');
  const [commissionMonth, setCommissionMonth] = useState(new Date().toISOString().slice(0, 7));
  const [commissionSortConfig, setCommissionSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'date',
    direction: 'desc'
  });

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



  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'saleDate',
    direction: 'desc'
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      // Atualiza status via API antes de buscar os dados para garantir consistencia
      try {
        await OlistService.syncStatusOrders();
      } catch (err) {
        console.warn("Falha ao sincronizar status em segundo plano:", err);
      }
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
    const autoFilter = sessionStorage.getItem('SALES_HISTORY_FILTER');
    if (autoFilter) {
      setSearchTerm(autoFilter);
      sessionStorage.removeItem('SALES_HISTORY_FILTER');
      setToast({ msg: `Visualizando histórico de: ${autoFilter}`, type: 'info' });
    }
    fetchData();
  }, []);

  const handleOlistSync = async () => {
    if (!supabase) {
      setToast({ msg: 'Erro: Cliente Supabase não está disponível.', type: 'error' });
      return;
    }

    setIsSyncing(true);
    setIsSyncing(true);
    setToast({ msg: 'Iniciando sincronização com Tiny...', type: 'info' });
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

  const commissionUniqueReps = useMemo(() => {
    const monthItems = historyData.filter(i => {
      if (!commissionMonth) return true;
      if (!i.saleDate) return false;
      const itemMonth = i.saleDate.slice(0, 7);
      return itemMonth === commissionMonth;
    });

    const reps = new Set(monthItems.map(i => getNormalizedRep(i.salesRep)));
    return Array.from(reps).sort();
  }, [historyData, commissionMonth]);

  useEffect(() => {
    // Se a lista de reps da comissao mudar e o selecionado nao estiver nela, seleciona o primeiro
    if (commissionUniqueReps.length > 0) {
      if (!selectedCommissionRep || !commissionUniqueReps.includes(selectedCommissionRep)) {
        setSelectedCommissionRep(commissionUniqueReps[0]);
      }
    } else {
      setSelectedCommissionRep('');
    }
  }, [commissionUniqueReps, selectedCommissionRep]);

  const commissionStats = useMemo(() => {
    const rep = selectedCommissionRep;
    if (!rep) return { orders: [], baseCommission: 0, baseCommissionCount: 0, cancelledValue: 0, cancelledCount: 0, totalFreight: 0, totalGeneral: 0, orderCount: 0 };

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
      totalProductValue: number;
      totalFreightValue: number;
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
          totalProductValue: 0,
          totalFreightValue: 0,
          itemCount: 0,
          status: item.status || 'N/A'
        });
      }

      const order = ordersMap.get(orderNum)!;
      // Lógica de Comissao: Base é apenas o produto.
      // Assumimos que unitPrice * quantity é puramente produto.
      const lineTotal = (item.unitPrice || 0) * (item.quantity || 0);

      // SalesHistoryItem geralmente é achatado (flattened). Se proratedFreight existir, usa ele.
      // Se não, assumimos 0 para evitar duplicar orderFreight N vezes.
      const safeFreight = item.proratedFreight || 0;

      order.totalProductValue += lineTotal;
      order.totalFreightValue += safeFreight;
      order.itemCount += 1;
    });

    const orders = Array.from(ordersMap.values()).sort((a, b) => {
      const { key, direction } = commissionSortConfig;
      let valA = a[key as keyof typeof a];
      let valB = b[key as keyof typeof b];

      if (key === 'totalProductValue' || key === 'totalFreightValue') {
        // Number sort
      } else {
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
      }

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    const baseCommission = orders.reduce((acc, o) => {
      const statusNormalized = (o.status || '').toUpperCase().trim();
      // Solicitação do usuário: Soma da coluna produto, exceto cancelados.
      // Antes era apenas 'ENTREGUE'. Agora é tudo o que NÃO é CANCELADO.
      if (!statusNormalized.includes('CANCEL')) {
        return acc + o.totalProductValue;
      }
      return acc;
    }, 0);

    const baseCommissionCount = orders.filter(o => !((o.status || '').toUpperCase().trim()).includes('CANCEL')).length;

    const cancelledStats = orders.reduce((acc, o) => {
      const statusNormalized = (o.status || '').toUpperCase().trim();
      if (statusNormalized.includes('CANCEL')) {
        acc.value += (o.totalProductValue + o.totalFreightValue);
        acc.count += 1;
      }
      return acc;
    }, { value: 0, count: 0 });

    const totalFreight = orders.reduce((acc, o) => {
      const statusNormalized = (o.status || '').toUpperCase().trim();
      if (!statusNormalized.includes('CANCEL')) {
        return acc + o.totalFreightValue;
      }
      return acc;
    }, 0);

    return {
      orders,
      baseCommission,
      baseCommissionCount,
      cancelledValue: cancelledStats.value,
      cancelledCount: cancelledStats.count,
      totalFreight,
      totalGeneral: baseCommission + totalFreight,
      orderCount: orders.length
    };
  }, [historyData, selectedCommissionRep, commissionMonth, commissionSortConfig]);

  const handleCommissionSort = (key: string) => {
    setCommissionSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };



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
    }).sort((a: any, b: any) => {
      if (!sortConfig.key) return 0;
      let valA = a[sortConfig.key];
      let valB = b[sortConfig.key];

      // Tratamento especial para datas e números
      if (sortConfig.key === 'totalAmount' || sortConfig.key === 'quantity' || sortConfig.key === 'unitPrice') {
        const numA = Number(valA) || 0;
        const numB = Number(valB) || 0;
        return sortConfig.direction === 'asc' ? numA - numB : numB - numA;
      }

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [historyData, searchTerm, startDate, endDate, statusFilter, salesRepFilter, sortConfig]);





  const generateCommissionReport = () => {
    if (!commissionStats.orders.length) {
      setToast({ msg: 'Não há dados para gerar o relatório.', type: 'error' });
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header Colorido
    doc.setFillColor(15, 23, 42); // Slate 900
    doc.rect(0, 0, pageWidth, 40, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('FECHAMENTO DE COMISSÃO', 15, 20);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184); // Slate 400
    doc.text('DOCUMENTO ANALÍTICO DE VENDAS E FRETE', 15, 26);

    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(`VENDEDOR: ${selectedCommissionRep}`, 15, 35);
    doc.text(`COMPETÊNCIA: ${commissionMonth}`, 150, 35, { align: 'right' });

    y = 55;

    // Cards Resumo
    const drawCard = (label: string, value: string, x: number, color: [number, number, number]) => {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, y, 60, 24, 3, 3, 'FD');

      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(label, x + 5, y + 8);

      doc.setFontSize(14);
      doc.setTextColor(color[0], color[1], color[2]);
      doc.setFont('helvetica', 'bold');
      doc.text(value, x + 5, y + 18);
    };

    drawCard('BASE COMISSÃO (PRODUTOS)', `R$ ${commissionStats.baseCommission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 15, [22, 163, 74]); // Green

    // Adiciona contador de pedidos ao lado
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`${commissionStats.baseCommissionCount} Pedido(s)`, 80, y + 15);

    // Cards removidos conforme solicitacao: TOTAL FRETE e TOTAL GERAL. 
    // O relatorio agora foca apenas na base de comissao apurada.

    y += 40;

    // Tabela Header
    doc.setFillColor(241, 245, 249);
    doc.rect(15, y, pageWidth - 30, 10, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);

    doc.text('DATA', 20, y + 6);
    doc.text('PEDIDO', 45, y + 6);
    doc.text('CLIENTE', 70, y + 6);
    doc.text('STATUS', 130, y + 6);
    doc.text('PRODUTO (R$)', 170, y + 6, { align: 'right' });
    doc.text('FRETE (R$)', 195, y + 6, { align: 'right' });

    y += 12;
    doc.setFont('helvetica', 'normal');

    commissionStats.orders.forEach((order, index) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
        // Repete Header se nova página
        doc.setFillColor(241, 245, 249);
        doc.rect(15, y, pageWidth - 30, 10, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(71, 85, 105);
        doc.text('DATA', 20, y + 6);
        doc.text('PEDIDO', 45, y + 6);
        doc.text('CLIENTE', 70, y + 6);
        doc.text('STATUS', 130, y + 6);
        doc.text('PRODUTO (R$)', 170, y + 6, { align: 'right' });
        doc.text('FRETE (R$)', 195, y + 6, { align: 'right' });
        y += 12;
        doc.setFont('helvetica', 'normal');
      }

      const isStriped = index % 2 === 0;
      if (isStriped) {
        doc.setFillColor(252, 252, 253); // Very light gray
        doc.rect(15, y - 4, pageWidth - 30, 8, 'F');
      }

      doc.setTextColor(51, 65, 85);
      const dateStr = order.date ? new Date(order.date).toLocaleDateString('pt-BR').substring(0, 5) : '-';
      doc.text(dateStr, 20, y);
      doc.text(order.orderNumber, 45, y);
      const clientName = doc.splitTextToSize(order.client.substring(0, 25), 50);
      doc.text(clientName, 70, y);

      let statusColor = [51, 65, 85];
      if (order.status === 'ENTREGUE') statusColor = [22, 163, 74];
      if (order.status.includes('CANCEL')) statusColor = [220, 38, 38];

      doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
      doc.setFont('helvetica', 'bold');
      doc.text(order.status, 130, y);

      doc.setTextColor(51, 65, 85);
      doc.setFont('helvetica', 'normal');
      doc.text(order.totalProductValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 170, y, { align: 'right' });

      doc.setTextColor(148, 163, 184);
      doc.text(order.totalFreightValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 195, y, { align: 'right' });

      y += 6;
    });

    // Rodapé
    y += 5;
    doc.setDrawColor(226, 232, 240);
    doc.line(15, y, pageWidth - 15, y);
    y += 5;
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Relatório gerado por NZERP 3.0. Note: O valor de frete foi deduzido da base de comissão conforme regra vigente.', 15, y);

    doc.save(`Comissao_${selectedCommissionRep}_${commissionMonth}.pdf`);
  };

  const SortIndicator = ({ active, direction }: { active: boolean, direction: 'asc' | 'desc' }) => {
    if (!active) return <span className="opacity-20 ml-1">⇅</span>;
    return <span className="ml-1 text-emerald-800">{direction === 'asc' ? '▲' : '▼'}</span>;
  };



  const clearFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setStatusFilter('TODOS');
    setSalesRepFilter('TODOS');
  };

  const handleSort = (key: string) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10 flex flex-col h-full">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 shrink-0">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">
            Histórico de Vendas
          </h2>
          <div className="flex items-center gap-4 mt-4">
            <button
              onClick={() => setActiveTab('HISTORY')}
              className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'HISTORY'
                ? 'bg-slate-900 text-white shadow-lg'
                : 'bg-white text-slate-400 hover:bg-slate-50'
                }`}
            >
              Histórico Geral
            </button>
            <button
              onClick={() => setActiveTab('COMMISSION')}
              className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'COMMISSION'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100'
                : 'bg-white text-slate-400 hover:bg-slate-50'
                }`}
            >
              Fechamento de Comissão
            </button>
          </div>
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
            <span>Sincronizar Tiny</span>
          </button>
        </div>
      </div>

      {activeTab === 'HISTORY' ? (
        <>
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
        </>
      ) : (
        /* ABA DE COMISSÃO */
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col md:flex-row items-end gap-6">
            <div className="flex-1 w-full">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Vendedor Responsável</label>
              <select
                value={selectedCommissionRep}
                onChange={(e) => setSelectedCommissionRep(e.target.value)}
                className="w-full px-4 py-4 bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-2xl outline-none text-sm font-black uppercase cursor-pointer text-slate-700"
              >
                {commissionUniqueReps.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="w-full md:w-64">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Competência (Mês)</label>
              <input
                type="month"
                value={commissionMonth}
                onChange={(e) => setCommissionMonth(e.target.value)}
                className="w-full px-4 py-3.5 bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-2xl outline-none text-sm font-bold uppercase text-slate-700"
              />
            </div>
            <div className="shrink-0 pb-1">
              <button
                onClick={generateCommissionReport}
                className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-xl"
              >
                Imprimir Fechamento
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Base de Comissão (Produtos)</p>
                <h3 className="text-3xl font-black text-emerald-600 mt-2 tracking-tighter">
                  R$ {commissionStats.baseCommission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </h3>
                <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">
                  {commissionStats.baseCommissionCount} Pedido(s)
                </p>
              </div>
              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0" /></svg>
              </div>
            </div>
            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Pedidos Cancelados</p>
                <h3 className="text-3xl font-black text-red-500 mt-2 tracking-tighter">
                  R$ {commissionStats.cancelledValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </h3>
                <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">
                  {commissionStats.cancelledCount} Pedido(s)
                </p>
              </div>
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </div>
            </div>
            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between opacity-60">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Geral (Ref.)</p>
                <h3 className="text-2xl font-black text-slate-700 mt-2 tracking-tighter">
                  R$ {commissionStats.totalGeneral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </h3>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest cursor-pointer" onClick={() => handleCommissionSort('date')}>Data <SortIndicator active={commissionSortConfig.key === 'date'} direction={commissionSortConfig.direction} /></th>
                  <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest cursor-pointer" onClick={() => handleCommissionSort('orderNumber')}>Pedido <SortIndicator active={commissionSortConfig.key === 'orderNumber'} direction={commissionSortConfig.direction} /></th>
                  <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">Cliente</th>
                  <th className="px-6 py-4 text-center text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="px-6 py-4 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest cursor-pointer" onClick={() => handleCommissionSort('totalProductValue')}>Produto (Base) <SortIndicator active={commissionSortConfig.key === 'totalProductValue'} direction={commissionSortConfig.direction} /></th>
                  <th className="px-6 py-4 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest cursor-pointer" onClick={() => handleCommissionSort('totalFreightValue')}>Frete <SortIndicator active={commissionSortConfig.key === 'totalFreightValue'} direction={commissionSortConfig.direction} /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {commissionStats.orders.map((order, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4 text-[10px] font-bold text-slate-600">{new Date(order.date).toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 text-[10px] font-black text-slate-800">{order.orderNumber}</td>
                    <td className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase truncate max-w-[200px]">{order.client}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-1 rounded text-[8px] font-black uppercase ${(order.status || '').toUpperCase() === 'ENTREGUE' ? 'bg-emerald-50 text-emerald-600' :
                          (order.status || '').toUpperCase().includes('CANCEL') ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-400'
                        }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className={`px-6 py-4 text-right text-[11px] font-black tracking-tight ${(order.status || '').toUpperCase() === 'ENTREGUE' ? 'text-emerald-700' : 'text-slate-300 decoration-line-through'}`}>
                      R$ {order.totalProductValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right text-[10px] font-bold text-slate-400">
                      R$ {order.totalFreightValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {commissionStats.orders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[10px] font-black text-slate-300 uppercase italic tracking-widest">
                      Nenhum pedido encontrado nesta competência
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'HISTORY' && (
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
                  <th onClick={() => handleSort('id')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800 sticky left-0 z-30 transition-colors">
                    ID <SortIndicator active={sortConfig.key === 'id'} direction={sortConfig.direction} />
                  </th>
                  <th onClick={() => handleSort('saleDate')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-center border-b border-slate-800 transition-colors">
                    Data Venda <SortIndicator active={sortConfig.key === 'saleDate'} direction={sortConfig.direction} />
                  </th>
                  <th onClick={() => handleSort('orderNumber')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800 transition-colors">
                    Pedido <SortIndicator active={sortConfig.key === 'orderNumber'} direction={sortConfig.direction} />
                  </th>
                  <th onClick={() => handleSort('contactName')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800 transition-colors">
                    Cliente <SortIndicator active={sortConfig.key === 'contactName'} direction={sortConfig.direction} />
                  </th>
                  <th onClick={() => handleSort('sku')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800 transition-colors">
                    SKU <SortIndicator active={sortConfig.key === 'sku'} direction={sortConfig.direction} />
                  </th>
                  <th onClick={() => handleSort('description')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800 transition-colors">
                    Produto <SortIndicator active={sortConfig.key === 'description'} direction={sortConfig.direction} />
                  </th>
                  <th onClick={() => handleSort('quantity')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-center border-b border-slate-800 transition-colors">
                    Qtd <SortIndicator active={sortConfig.key === 'quantity'} direction={sortConfig.direction} />
                  </th>
                  <th onClick={() => handleSort('totalAmount')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-right border-b border-slate-800 transition-colors">
                    Total <SortIndicator active={sortConfig.key === 'totalAmount'} direction={sortConfig.direction} />
                  </th>
                  <th onClick={() => handleSort('status')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-center border-b border-slate-800 transition-colors">
                    Situação <SortIndicator active={sortConfig.key === 'status'} direction={sortConfig.direction} />
                  </th>
                  <th onClick={() => handleSort('trackingCode')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800 transition-colors">
                    Rastreio <SortIndicator active={sortConfig.key === 'trackingCode'} direction={sortConfig.direction} />
                  </th>
                  <th onClick={() => handleSort('salesRep')} className="cursor-pointer hover:bg-slate-800 bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800 transition-colors">
                    Vendedor <SortIndicator active={sortConfig.key === 'salesRep'} direction={sortConfig.direction} />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredData.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4 sticky left-0 bg-white group-hover:bg-slate-50 border-r border-slate-100 font-mono text-[9px] font-bold text-slate-400">{item.externalId || item.id}</td>
                    <td className="px-6 py-4 text-center text-[10px] font-bold text-slate-600">
                      {item.saleDate ? item.saleDate.split('T')[0].split('-').reverse().join('/') : '-'}
                    </td>                  <td className="px-6 py-4 font-black text-blue-600 text-[10px]">{item.orderNumber}</td>
                    <td className="px-6 py-4 text-[10px] font-bold text-slate-700 uppercase truncate max-w-[150px]" title={item.contactName}>{item.contactName}</td>
                    <td className="px-6 py-4 font-black text-slate-900 text-[10px]">{item.sku}</td>
                    <td className="px-6 py-4 text-[9px] text-slate-500 uppercase truncate max-w-[200px]" title={item.description}>{item.description}</td>
                    <td className="px-6 py-4 text-center font-black text-slate-800 text-[11px]">{item.quantity}</td>
                    <td className="px-6 py-4 text-right font-black text-slate-900 text-[11px]">R$ {item.totalAmount?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${(item.status || '').includes('CANCEL') ? 'bg-red-50 text-red-600 border-red-100' :
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
      )}
    </div>
  );
};

export default SalesHistoryModule;
