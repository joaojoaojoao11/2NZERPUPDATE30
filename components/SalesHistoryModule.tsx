
import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { DataService } from '../services/dataService';
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
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  
  // Estados para Modal de Importação
  const [showImportModal, setShowImportModal] = useState(false);
  const [stagingData, setStagingData] = useState<SalesStagingItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- ESTADOS DE FILTRO HISTÓRICO ---
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [salesRepFilter, setSalesRepFilter] = useState('TODOS');

  // --- ESTADOS DE COMISSÃO ---
  const [selectedCommissionRep, setSelectedCommissionRep] = useState<string>('');
  const [commissionMonth, setCommissionMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM atual padrão
  
  // Estado de Ordenação da Comissão
  const [commissionSortConfig, setCommissionSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ 
    key: 'date', 
    direction: 'desc' 
  });

  // --- BUSCA INICIAL ---
  const fetchData = async () => {
    setLoading(true);
    try {
      // Carrega um limite maior para permitir filtros locais efetivos
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

  // --- LÓGICA DE NORMALIZAÇÃO DE VENDEDOR ---
  const getNormalizedRep = (repName?: string) => {
    if (!repName || repName.trim() === '') return 'SISTEMA';
    return repName.trim().toUpperCase();
  };

  // --- OPÇÕES DINÂMICAS PARA OS DROPDOWNS ---
  const uniqueStatuses = useMemo(() => {
    const statuses = new Set(historyData.map(i => i.status || 'N/A').filter(Boolean));
    return Array.from(statuses).sort();
  }, [historyData]);

  const uniqueReps = useMemo(() => {
    const reps = new Set(historyData.map(i => getNormalizedRep(i.salesRep)));
    return Array.from(reps).sort();
  }, [historyData]);

  // Define o primeiro vendedor como padrão se a lista não estiver vazia e nenhum estiver selecionado
  useEffect(() => {
    if (uniqueReps.length > 0 && !selectedCommissionRep) {
      setSelectedCommissionRep(uniqueReps[0]);
    }
  }, [uniqueReps]);

  // --- LÓGICA DE FILTRAGEM (HISTÓRICO) ---
  const filteredData = useMemo(() => {
    return historyData.filter(item => {
      // 1. Busca Textual
      const term = searchTerm.toLowerCase();
      const matchesText = 
        (item.orderNumber || '').toLowerCase().includes(term) ||
        (item.contactName || '').toLowerCase().includes(term) ||
        (item.sku || '').toLowerCase().includes(term) ||
        (item.externalId || '').toLowerCase().includes(term);

      if (!matchesText) return false;

      // 2. Filtro de Data
      if (startDate || endDate) {
        const itemDate = item.saleDate ? item.saleDate.split('T')[0] : '';
        if (startDate && itemDate < startDate) return false;
        if (endDate && itemDate > endDate) return false;
      }

      // 3. Status
      if (statusFilter !== 'TODOS' && item.status !== statusFilter) return false;

      // 4. Vendedor
      if (salesRepFilter !== 'TODOS' && getNormalizedRep(item.salesRep) !== salesRepFilter) return false;

      return true;
    });
  }, [historyData, searchTerm, startDate, endDate, statusFilter, salesRepFilter]);

  // --- LÓGICA DE CÁLCULO (COMISSÃO) ---
  const commissionStats = useMemo(() => {
    const rep = selectedCommissionRep;
    if (!rep) return { orders: [], totalSales: 0, totalItems: 0, orderCount: 0 };

    // 1. Filtra itens do vendedor E do mês selecionado
    const repItems = historyData.filter(i => {
        const isRepMatch = getNormalizedRep(i.salesRep) === rep;
        if (!isRepMatch) return false;

        if (commissionMonth) {
            if (!i.saleDate) return false;
            // Extrai YYYY-MM da data da venda (ISO string ou YYYY-MM-DD)
            const itemMonth = i.saleDate.slice(0, 7);
            if (itemMonth !== commissionMonth) return false;
        }
        return true;
    });

    // 2. Agrupa por Pedido (Order Number)
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
      // Soma valor total da linha (unit * qtd já calculado no service ou calculado aqui)
      const lineTotal = (item.unitPrice || 0) * (item.quantity || 0);
      order.totalValue += lineTotal;
      
      // Conta +1 para cada linha encontrada (itens distintos no pedido)
      order.itemCount += 1;
    });

    const orders = Array.from(ordersMap.values()).sort((a, b) => {
        const { key, direction } = commissionSortConfig;
        
        let valA = a[key as keyof typeof a];
        let valB = b[key as keyof typeof b];

        // Tratamento especial para strings para ordenação case-insensitive
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    // Soma apenas pedidos com status "ENTREGUE" para o total financeiro
    const totalSales = orders.reduce((acc, o) => {
        const statusNormalized = (o.status || '').toUpperCase().trim();
        if (statusNormalized === 'ENTREGUE') {
            return acc + o.totalValue;
        }
        return acc;
    }, 0);

    // Total de itens (linhas) de todos os pedidos listados (independente do status)
    const totalItems = orders.reduce((acc, o) => acc + o.itemCount, 0);

    return { orders, totalSales, totalItems, orderCount: orders.length };
  }, [historyData, selectedCommissionRep, commissionMonth, commissionSortConfig]);

  // Handler para alterar a ordenação
  const handleCommissionSort = (key: string) => {
    setCommissionSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Helper para renderizar o indicador de ordenação
  const SortIndicator = ({ active, direction }: { active: boolean, direction: 'asc' | 'desc' }) => {
    if (!active) return <span className="opacity-20 ml-1">⇅</span>;
    return <span className="ml-1 text-emerald-800">{direction === 'asc' ? '▲' : '▼'}</span>;
  };

  // --- GERAR PDF DO RELATÓRIO ---
  const generateCommissionReport = () => {
    if (!commissionStats.orders.length) {
      setToast({ msg: 'Não há dados para gerar o relatório.', type: 'error' });
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Cabeçalho
    doc.setFillColor(16, 185, 129); // Emerald 500
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

    // Cards de Resumo
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMO DO PERÍODO', 15, y);
    
    y += 8;
    // Box 1 - Total Vendido
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(15, y, 60, 20, 2, 2, 'FD');
    doc.setFontSize(8);
    doc.text('BASE CÁLCULO (ENTREGUES)', 20, y + 6);
    doc.setFontSize(12);
    doc.setTextColor(16, 185, 129); // Green
    doc.text(`R$ ${commissionStats.totalSales.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 20, y + 15);

    // Box 2 - Pedidos
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(80, y, 50, 20, 2, 2, 'FD');
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(8);
    doc.text('PEDIDOS TOTAL', 85, y + 6);
    doc.setFontSize(12);
    doc.text(`${commissionStats.orderCount}`, 85, y + 15);

    // Box 3 - Itens
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(135, y, 50, 20, 2, 2, 'FD');
    doc.setFontSize(8);
    doc.text('ITENS/LINHAS', 140, y + 6);
    doc.setFontSize(12);
    doc.text(`${commissionStats.totalItems}`, 140, y + 15);

    y += 35;

    // Tabela Header
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

    // Tabela Body
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);

    commissionStats.orders.forEach((order, index) => {
        if (y > 275) {
            doc.addPage();
            y = 20;
            // Repete Header se mudar de página
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

        // Zebra striping
        if (index % 2 === 0) {
            doc.setFillColor(250, 250, 250);
            doc.rect(15, y - 4, pageWidth - 30, 8, 'F');
        }

        const dateStr = order.date ? new Date(order.date).toLocaleDateString('pt-BR') : '-';
        
        doc.text(dateStr, 18, y);
        doc.text(order.orderNumber, 40, y);
        const clientName = doc.splitTextToSize(order.client, 60);
        doc.text(clientName, 65, y);
        
        // Status cor
        if (order.status.includes('CANCEL')) doc.setTextColor(200, 0, 0);
        else if (order.status === 'ENTREGUE') doc.setTextColor(0, 150, 0);
        doc.text(order.status, 130, y);
        doc.setTextColor(0, 0, 0);

        doc.text(String(order.itemCount), 160, y, { align: 'center' });
        doc.text(order.totalValue.toLocaleString('pt-BR', {minimumFractionDigits: 2}), 190, y, { align: 'right' });

        y += Math.max(6, clientName.length * 4); // Ajusta altura baseado no nome do cliente
    });

    // Rodapé Final
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


  // --- HELPERS DE PARSE ---
  const parseCurrency = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const str = String(val).replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
    return parseFloat(str) || 0;
  };

  const parseDate = (val: any): string => {
    if (!val) return '';
    if (typeof val === 'number') {
      const date = new Date(Math.round((val - 25569) * 86400 * 1000));
      return date.toISOString().split('T')[0];
    }
    const str = String(val).trim();
    if (str.includes('/')) {
      const parts = str.split('/');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return '';
  };

  // --- IMPORTAÇÃO ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (jsonData.length < 2) throw new Error("Arquivo vazio ou sem cabeçalho.");

        const headers = (jsonData[0] as string[]).map(h => 
          String(h).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
        );

        const colMap: any = {};
        colMap.id = headers.indexOf('id');
        colMap.orderNumber = headers.findIndex(h => h === 'numero do pedido');
        colMap.saleDate = headers.findIndex(h => h === 'data');
        colMap.expectedDate = headers.findIndex(h => h === 'data prevista');
        colMap.status = headers.findIndex(h => h === 'situacao');
        colMap.notes = headers.findIndex(h => h === 'observacoes');
        colMap.contactId = headers.findIndex(h => h === 'id contato');
        colMap.contactName = headers.findIndex(h => h === 'nome do contato');
        colMap.personType = headers.findIndex(h => h === 'tipo de pessoa');
        colMap.cpfCnpj = headers.findIndex(h => h === 'cpf/cnpj');
        colMap.rgIe = headers.findIndex(h => h === 'rg/ie');
        colMap.zipCode = headers.findIndex(h => h === 'cep');
        colMap.city = headers.findIndex(h => h === 'municipio');
        colMap.state = headers.findIndex(h => h === 'uf');
        colMap.address = headers.findIndex(h => h === 'endereco');
        colMap.addressNumber = headers.findIndex(h => h === 'endereco nro');
        colMap.complement = headers.findIndex(h => h === 'complemento');
        colMap.neighborhood = headers.findIndex(h => h === 'bairro');
        colMap.phone = headers.findIndex(h => h === 'fone');
        colMap.mobile = headers.findIndex(h => h === 'celular');
        colMap.email = headers.findIndex(h => h === 'e-mail');
        colMap.orderDiscount = headers.findIndex(h => h.includes('desconto do pedido'));
        colMap.orderFreight = headers.findIndex(h => h === 'frete pedido');
        colMap.productIdExternal = headers.findIndex(h => h === 'id produto');
        colMap.description = headers.findIndex(h => h === 'descricao');
        colMap.quantity = headers.findIndex(h => h === 'quantidade');
        colMap.unitPrice = headers.findIndex(h => h === 'valor unitario');
        colMap.itemDiscount = headers.findIndex(h => h === 'desconto item');
        colMap.trackingCode = headers.findIndex(h => h === 'codigo de rastreamento');
        colMap.purchaseOrderNumber = headers.findIndex(h => h === 'numero da ordem de compra');
        colMap.salesRep = headers.findIndex(h => h === 'vendedor');
        colMap.orderExpenses = headers.findIndex(h => h === 'despesas pedido');
        colMap.proratedDiscount = headers.findIndex(h => h === 'desconto do pedido rateado');
        colMap.proratedFreight = headers.findIndex(h => h === 'frete pedido rateado');
        colMap.proratedExpenses = headers.findIndex(h => h === 'despesas pedido rateado');
        colMap.recipientName = headers.findIndex(h => h === 'destinatario');
        colMap.recipientCpfCnpj = headers.findIndex(h => h === 'cpf/cnpj entrega');
        colMap.recipientZipCode = headers.findIndex(h => h === 'cep entrega');
        colMap.recipientCity = headers.findIndex(h => h === 'municipio entrega');
        colMap.recipientState = headers.findIndex(h => h === 'uf entrega');
        colMap.recipientAddress = headers.findIndex(h => h === 'endereco entrega');
        colMap.recipientAddressNumber = headers.findIndex(h => h === 'endereco nro entrega');
        colMap.recipientComplement = headers.findIndex(h => h === 'complemento entrega');
        colMap.recipientNeighborhood = headers.findIndex(h => h === 'bairro entrega');
        colMap.recipientPhone = headers.findIndex(h => h === 'fone entrega');
        colMap.sku = headers.findIndex(h => h === 'codigo (sku)');

        if (colMap.id === -1) throw new Error("Coluna 'ID' não encontrada na planilha. Ela é obrigatória.");

        const rows = jsonData.slice(1);
        const importedItems: SalesHistoryItem[] = [];
        const idsToCheck: string[] = [];

        rows.forEach((row: any) => {
          if (!row[colMap.id]) return;
          const externalId = String(row[colMap.id]);
          
          const item: SalesHistoryItem = {
            externalId: externalId,
            orderNumber: String(row[colMap.orderNumber] || ''),
            saleDate: parseDate(row[colMap.saleDate]),
            expectedDate: parseDate(row[colMap.expectedDate]),
            status: String(row[colMap.status] || '').toUpperCase(),
            notes: String(row[colMap.notes] || ''),
            contactId: String(row[colMap.contactId] || ''),
            contactName: String(row[colMap.contactName] || ''),
            personType: String(row[colMap.personType] || ''),
            cpfCnpj: String(row[colMap.cpfCnpj] || ''),
            rgIe: String(row[colMap.rgIe] || ''),
            email: String(row[colMap.email] || ''),
            phone: String(row[colMap.phone] || ''),
            mobile: String(row[colMap.mobile] || ''),
            zipCode: String(row[colMap.zipCode] || ''),
            address: String(row[colMap.address] || ''),
            addressNumber: String(row[colMap.addressNumber] || ''),
            complement: String(row[colMap.complement] || ''),
            neighborhood: String(row[colMap.neighborhood] || ''),
            city: String(row[colMap.city] || ''),
            state: String(row[colMap.state] || ''),
            productIdExternal: String(row[colMap.productIdExternal] || ''),
            sku: String(row[colMap.sku] || '').toUpperCase(),
            description: String(row[colMap.description] || ''),
            quantity: parseCurrency(row[colMap.quantity]),
            unitPrice: parseCurrency(row[colMap.unitPrice]),
            itemDiscount: parseCurrency(row[colMap.itemDiscount]),
            orderDiscount: parseCurrency(row[colMap.orderDiscount]),
            orderFreight: parseCurrency(row[colMap.orderFreight]),
            orderExpenses: parseCurrency(row[colMap.orderExpenses]),
            proratedDiscount: parseCurrency(row[colMap.proratedDiscount]),
            proratedFreight: parseCurrency(row[colMap.proratedFreight]),
            proratedExpenses: parseCurrency(row[colMap.proratedExpenses]),
            trackingCode: String(row[colMap.trackingCode] || ''),
            salesRep: String(row[colMap.salesRep] || ''),
            purchaseOrderNumber: String(row[colMap.purchaseOrderNumber] || ''),
            recipientName: String(row[colMap.recipientName] || ''),
            recipientCpfCnpj: String(row[colMap.recipientCpfCnpj] || ''),
            recipientZipCode: String(row[colMap.recipientZipCode] || ''),
            recipientAddress: String(row[colMap.recipientAddress] || ''),
            recipientAddressNumber: String(row[colMap.recipientAddressNumber] || ''),
            recipientComplement: String(row[colMap.recipientComplement] || ''),
            recipientNeighborhood: String(row[colMap.recipientNeighborhood] || ''),
            recipientCity: String(row[colMap.recipientCity] || ''),
            recipientState: String(row[colMap.recipientState] || ''),
            recipientPhone: String(row[colMap.recipientPhone] || ''),
          };
          
          importedItems.push(item);
          idsToCheck.push(externalId);
        });

        if (importedItems.length === 0) throw new Error("Nenhum dado válido identificado.");

        const existingRecords = await DataService.getSalesByIds(idsToCheck); 
        const existingMap = new Map(existingRecords.map(r => [String(r.externalId), r]));

        const staging: SalesStagingItem[] = importedItems.map(item => {
          const existing = item.externalId ? existingMap.get(item.externalId) : undefined;
          
          if (existing) {
              item.id = existing.id; // Carry over DB ID
          }

          if (!existing) {
             return { data: item, status: 'NEW' };
          }

          // User requirement: Only 'status' changes should flag the item as CHANGED.
          const diff: string[] = [];
          if ((existing.status || '').trim() !== (item.status || '').trim()) {
            diff.push(`Situação: ${existing.status || 'N/A'} -> ${item.status || 'N/A'}`);
          }
          
          // For UI purposes, we only flag as 'CHANGED' if the status column is different.
          // The data payload always contains the new spreadsheet data to ensure overwrites.
          const stagingStatus = diff.length > 0 ? 'CHANGED' : 'UNCHANGED';

          return { data: item, status: stagingStatus, diff };
        });

        setStagingData(staging);

      } catch (err: any) {
        setToast({ msg: `Erro na importação: ${err.message}`, type: 'error' });
        setShowImportModal(false);
      } finally {
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleConfirmImport = async () => {
    setIsProcessing(true);
    try {
      // User requirement: overwrite all data, even for UNCHANGED items.
      // So, we send all staged items to the backend for upsert.
      const itemsToSave = stagingData.map(s => s.data);

      if (itemsToSave.length === 0) {
        setToast({ msg: 'Nenhum item para importar.', type: 'error' });
        setShowImportModal(false);
        return;
      }

      const result = await DataService.importSalesHistoryBatch(itemsToSave, user);
      if (result.success) {
        setToast({ msg: `${result.count} registros processados!`, type: 'success' });
        setStagingData([]);
        setShowImportModal(false);
        fetchData();
      } else {
        throw new Error('Falha no salvamento em lote.');
      }
    } catch (e: any) {
      setToast({ msg: `Erro ao salvar: ${e.message}`, type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadTemplate = () => {
    const headers = [
      "ID", "Número do pedido", "Data", "Data prevista", "Situação", "Observações",
      "ID contato", "Nome do contato", "Tipo de Pessoa", "CPF/CNPJ", "RG/IE", "e-mail",
      "Fone", "Celular", "CEP", "Endereço", "Endereço Nro", "Complemento", "Bairro",
      "Município", "UF", "ID produto", "Código (SKU)", "Descrição", "Quantidade",
      "Valor unitário", "Desconto item", "Desconto do pedido (% ou valor)", "Frete pedido",
      "Despesas pedido", "Desconto do pedido rateado", "Frete pedido rateado", "Despesas pedido rateado",
      "Código de rastreamento", "Vendedor", "Número da ordem de compra", "Destinatário",
      "CPF/CNPJ entrega", "CEP entrega", "Endereço entrega", "Endereço Nro entrega",
      "Complemento entrega", "Bairro entrega", "Município entrega", "UF entrega", "Fone entrega"
    ];
    const data = [headers];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modelo_Vendas");
    XLSX.writeFile(wb, "Modelo_Importacao_Vendas_NZ.xlsx");
  };

  const sortedStaging = useMemo(() => {
    return [...stagingData].sort((a, b) => {
      const score = (s: string) => {
        if (s === 'NEW') return 3;
        if (s === 'CHANGED') return 1;
        return 0;
      };
      return score(b.status) - score(a.status);
    });
  }, [stagingData]);

  const stagingStats = useMemo(() => ({
    new: stagingData.filter(s => s.status === 'NEW').length,
    changed: stagingData.filter(s => s.status === 'CHANGED').length,
    unchanged: stagingData.filter(s => s.status === 'UNCHANGED').length,
    totalToSave: stagingData.filter(s => s.status !== 'UNCHANGED').length
  }), [stagingData]);

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

      {/* CABEÇALHO */}
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
          <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
             <button 
               onClick={() => setActiveTab('HISTORY')} 
               className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'HISTORY' ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-500 hover:text-slate-700'}`}
             >
               Histórico Geral
             </button>
             <button 
               onClick={() => setActiveTab('COMMISSION')} 
               className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'COMMISSION' ? 'bg-emerald-600 text-white shadow-xl' : 'text-slate-500 hover:text-emerald-700'}`}
             >
               Fechamento de Comissão
             </button>
          </div>

          <button
            onClick={() => { setShowImportModal(true); setStagingData([]); }}
            className="px-6 py-4 bg-white text-slate-600 border border-slate-200 rounded-2xl font-black text-[9px] uppercase tracking-widest shadow-sm hover:bg-slate-50 transition-all flex items-center space-x-2 italic"
          >
            <ICONS.Upload className="w-4 h-4" />
            <span>Importar</span>
          </button>
        </div>
      </div>

      {/* CONTEÚDO PRINCIPAL BASEADO NA ABA */}
      {activeTab === 'HISTORY' ? (
        <>
          {/* BARRA DE FILTROS HISTÓRICO */}
          <div className="bg-white p-4 rounded-[2rem] border border-slate-100 shadow-sm grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
             {/* Busca Textual */}
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

             {/* Data Range */}
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

             {/* Status */}
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

             {/* Vendedor */}
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

             {/* Botão Limpar */}
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

          {/* TABELA DE DADOS (PRINCIPAL) */}
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
                    <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800 sticky left-0 z-30 bg-slate-900">ID</th>
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
        </>
      ) : (
        /* ABA DE COMISSÃO */
        <div className="space-y-8 animate-in slide-in-from-right-4 duration-500 h-full flex flex-col">
           <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 flex flex-col md:flex-row gap-8 items-center justify-between">
              <div>
                 <h3 className="text-xl font-black text-slate-900 uppercase italic tracking-tighter">Apuração de Vendas</h3>
                 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Fechamento por Pedido Agrupado</p>
              </div>
              
              <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
                 <div className="flex items-center gap-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Vendedor:</label>
                    <select 
                        value={selectedCommissionRep}
                        onChange={(e) => setSelectedCommissionRep(e.target.value)}
                        className="w-48 px-4 py-3 bg-white border-2 border-slate-200 rounded-xl outline-none font-bold text-xs uppercase cursor-pointer focus:border-emerald-500 transition-all"
                    >
                        {uniqueReps.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                 </div>
                 
                 <div className="flex items-center gap-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Mês:</label>
                    <input 
                        type="month"
                        value={commissionMonth}
                        onChange={(e) => setCommissionMonth(e.target.value)}
                        className="px-4 py-3 bg-white border-2 border-slate-200 rounded-xl outline-none font-bold text-xs uppercase cursor-pointer focus:border-emerald-500 transition-all"
                    />
                 </div>

                 {/* BOTÃO IMPRIMIR RELATÓRIO */}
                 <button 
                    onClick={generateCommissionReport}
                    className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-blue-600 transition-all flex items-center space-x-2 italic"
                 >
                    <ICONS.Finance className="w-4 h-4" />
                    <span>Imprimir Relatório</span>
                 </button>
              </div>
           </div>

           {/* KPIs do Vendedor */}
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-emerald-600 p-6 rounded-[2rem] shadow-xl text-white relative overflow-hidden">
                 <div className="absolute top-0 right-0 p-4 opacity-10"><ICONS.Finance className="w-20 h-20" /></div>
                 <p className="text-[9px] font-black text-emerald-200 uppercase tracking-widest mb-1">Total Vendido</p>
                 <h3 className="text-3xl font-black italic tracking-tighter">R$ {commissionStats.totalSales.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h3>
                 <p className="text-[8px] font-bold text-emerald-100 mt-2 uppercase">Base de Cálculo de Comissão</p>
              </div>
              <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col justify-center">
                 <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Pedidos no Período</p>
                 <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter">{commissionStats.orderCount}</h3>
              </div>
              <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col justify-center">
                 <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Itens Vendidos</p>
                 <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter">{commissionStats.totalItems}</h3>
              </div>
           </div>

           {/* Tabela de Comissão */}
           <div className="table-container flex-1 overflow-auto border border-slate-200 rounded-[2rem] bg-white shadow-sm custom-scrollbar">
              <table className="w-full text-left">
                 <thead className="bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                    <tr>
                       <th className="px-8 py-5 cursor-pointer hover:bg-emerald-100/50 transition-colors group" onClick={() => handleCommissionSort('date')}>
                          <div className="flex items-center gap-1">Data <SortIndicator active={commissionSortConfig.key === 'date'} direction={commissionSortConfig.direction} /></div>
                       </th>
                       <th className="px-8 py-5 cursor-pointer hover:bg-emerald-100/50 transition-colors group" onClick={() => handleCommissionSort('orderNumber')}>
                          <div className="flex items-center gap-1">Nº Pedido <SortIndicator active={commissionSortConfig.key === 'orderNumber'} direction={commissionSortConfig.direction} /></div>
                       </th>
                       <th className="px-8 py-5 cursor-pointer hover:bg-emerald-100/50 transition-colors group" onClick={() => handleCommissionSort('client')}>
                          <div className="flex items-center gap-1">Cliente <SortIndicator active={commissionSortConfig.key === 'client'} direction={commissionSortConfig.direction} /></div>
                       </th>
                       <th className="px-8 py-5 text-center cursor-pointer hover:bg-emerald-100/50 transition-colors group" onClick={() => handleCommissionSort('status')}>
                          <div className="flex items-center justify-center gap-1">Status <SortIndicator active={commissionSortConfig.key === 'status'} direction={commissionSortConfig.direction} /></div>
                       </th>
                       <th className="px-8 py-5 text-center cursor-pointer hover:bg-emerald-100/50 transition-colors group" onClick={() => handleCommissionSort('itemCount')}>
                          <div className="flex items-center justify-center gap-1">Qtd. Produtos <SortIndicator active={commissionSortConfig.key === 'itemCount'} direction={commissionSortConfig.direction} /></div>
                       </th>
                       <th className="px-8 py-5 text-right cursor-pointer hover:bg-emerald-100/50 transition-colors group" onClick={() => handleCommissionSort('totalValue')}>
                          <div className="flex items-center justify-end gap-1">Valor Total Pedido <SortIndicator active={commissionSortConfig.key === 'totalValue'} direction={commissionSortConfig.direction} /></div>
                       </th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-50">
                    {commissionStats.orders.map((order, idx) => (
                       <tr key={idx} className="hover:bg-emerald-50/30 transition-all">
                          <td className="px-8 py-5">
                             <span className="text-[11px] font-bold text-slate-600">{order.date ? new Date(order.date).toLocaleDateString('pt-BR') : '-'}</span>
                          </td>
                          <td className="px-8 py-5 font-black text-blue-600 text-xs">{order.orderNumber}</td>
                          <td className="px-8 py-5">
                             <span className="text-[10px] font-bold text-slate-700 uppercase italic">{order.client}</span>
                          </td>
                          <td className="px-8 py-5 text-center">
                             <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${
                                order.status.includes('CANCEL') ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-50 text-slate-500 border-slate-200'
                             }`}>
                                {order.status}
                             </span>
                          </td>
                          <td className="px-8 py-5 text-center font-black text-slate-800 text-[11px]">{order.itemCount}</td>
                          <td className="px-8 py-5 text-right font-black text-emerald-600 text-xs">R$ {order.totalValue.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                       </tr>
                    ))}
                    {commissionStats.orders.length === 0 && (
                       <tr>
                          <td colSpan={6} className="py-20 text-center opacity-30 font-black uppercase text-[10px] italic">
                             Nenhum pedido encontrado para este vendedor no período selecionado.
                          </td>
                       </tr>
                    )}
                 </tbody>
              </table>
           </div>
        </div>
      )}

      {/* MODAL DE IMPORTAÇÃO & REVISÃO (Código Mantido) */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white max-w-7xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[90vh]">
              
              <div className="px-10 py-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
                 <div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter">
                       {stagingData.length > 0 ? 'Revisão Detalhada de Arquivo' : 'Importação de Vendas'}
                    </h3>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-1 italic">Sincronização por ID do Pedido</p>
                 </div>
                 <button onClick={() => { setShowImportModal(false); setStagingData([]); }} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all"><ICONS.Add className="w-6 h-6 rotate-45" /></button>
              </div>

              <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/30">
                 
                 {stagingData.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-10 space-y-8">
                       <div className="w-24 h-24 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center shadow-inner mb-2">
                          <ICONS.Upload className="w-12 h-12" />
                       </div>
                       <div className="text-center max-w-md">
                          <p className="text-slate-500 font-medium text-sm mb-8">
                             Selecione o arquivo de vendas (Excel/CSV) com as colunas padrão.
                          </p>
                          <div className="flex gap-4 justify-center">
                             <button 
                               onClick={downloadTemplate}
                               className="px-8 py-4 bg-white border-2 border-slate-200 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center space-x-2"
                             >
                                <span>Baixar Modelo</span>
                             </button>
                             <button 
                               onClick={() => fileInputRef.current?.click()}
                               disabled={isProcessing}
                               className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-blue-600 transition-all flex items-center space-x-3"
                             >
                                {isProcessing ? (
                                   <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                ) : (
                                   <ICONS.Upload className="w-4 h-4" />
                                )}
                                <span>{isProcessing ? 'Processando...' : 'Selecionar Arquivo'}</span>
                             </button>
                          </div>
                          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls,.csv" className="hidden" />
                       </div>
                    </div>
                 ) : (
                    <div className="flex flex-col h-full">
                       <div className="px-10 py-6 grid grid-cols-4 gap-4 bg-white border-b border-slate-100 shadow-sm shrink-0">
                          <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl text-center">
                             <p className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">Novos</p>
                             <p className="text-2xl font-black text-emerald-700">{stagingStats.new}</p>
                          </div>
                          <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl text-center">
                             <p className="text-[8px] font-black text-blue-600 uppercase tracking-widest">Alterados</p>
                             <p className="text-2xl font-black text-blue-700">{stagingStats.changed}</p>
                          </div>
                          <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-center">
                             <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Sem Mudança</p>
                             <p className="text-2xl font-black text-slate-700">{stagingStats.unchanged}</p>
                          </div>
                       </div>

                       <div className="flex-1 overflow-auto p-10 custom-scrollbar">
                          <table className="w-full text-left border-separate border-spacing-y-2" style={{ minWidth: '1800px' }}>
                             <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                                <tr>
                                   <th className="px-4 py-3">Status</th>
                                   <th className="px-4 py-3">ID Planilha</th>
                                   <th className="px-4 py-3">Pedido</th>
                                   <th className="px-4 py-3">Cliente</th>
                                   <th className="px-4 py-3 text-center">SKU</th>
                                   <th className="px-4 py-3 text-right">Valor</th>
                                   <th className="px-4 py-3">Situação</th>
                                   <th className="px-4 py-3">Observações (Diff)</th>
                                </tr>
                             </thead>
                             <tbody>
                                {sortedStaging.map((item, idx) => (
                                   <tr key={idx} className={`group hover:shadow-md transition-all ${
                                       item.status === 'NEW' ? 'bg-emerald-50/30' : 
                                       item.status === 'CHANGED' ? 'bg-blue-50/30' : 
                                       'bg-white/50 opacity-50'
                                    }`}>
                                      <td className="px-4 py-3 first:rounded-l-xl">
                                         <span className={`px-2 py-1 rounded text-[8px] font-black uppercase border ${
                                            item.status === 'NEW' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                            item.status === 'CHANGED' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                            'bg-slate-100 text-slate-500 border-slate-200'
                                         }`}>
                                            {item.status}
                                         </span>
                                      </td>
                                      <td className="px-4 py-3 font-mono text-[9px] font-bold text-slate-500">{item.data.externalId}</td>
                                      <td className="px-4 py-3 font-black text-slate-900 text-xs">{item.data.orderNumber}</td>
                                      <td className="px-4 py-3 font-bold text-slate-600 text-[10px] uppercase truncate max-w-[150px]">{item.data.contactName}</td>
                                      <td className="px-4 py-3 text-center text-[10px] font-black text-slate-800">{item.data.sku}</td>
                                      <td className="px-4 py-3 text-right font-black text-slate-900 text-[11px]">R$ {(item.data.totalAmount || 0).toFixed(2)}</td>
                                      <td className="px-4 py-3 text-[9px] font-bold text-slate-500 uppercase">{item.data.status}</td>
                                      <td className="px-4 py-3 last:rounded-r-xl">
                                         {item.diff && item.diff.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                               {item.diff.map((d, i) => (
                                                  <span key={i} className="text-[8px] bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-500 font-bold uppercase">{d}</span>
                                               ))}
                                            </div>
                                         ) : <span className="text-slate-300 text-[8px] italic">-</span>}
                                      </td>
                                   </tr>
                                ))}
                             </tbody>
                          </table>
                       </div>

                       <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-4 shrink-0">
                          <button onClick={() => setStagingData([])} className="px-8 py-4 bg-white border border-slate-200 text-slate-500 font-black rounded-2xl text-[10px] uppercase tracking-widest hover:text-red-500 transition-all">
                             Descartar
                          </button>
                          <button 
                            onClick={handleConfirmImport}
                            disabled={isProcessing}
                            className="px-12 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-emerald-600 disabled:opacity-30 disabled:hover:bg-slate-900 transition-all flex items-center gap-2"
                          >
                             {isProcessing ? 'Gravando...' : 'Confirmar e Gravar Dados'}
                          </button>
                       </div>
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default SalesHistoryModule;
