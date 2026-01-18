

import React, { useState, useMemo, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { FinanceService } from '../services/financeService';
import { DebtorInfo, User, AccountsReceivable, CollectionHistory, Settlement } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
// Fix: Add CartesianGrid to recharts import to fix "Cannot find name 'CartesianGrid'" errors.
import { ResponsiveContainer, BarChart, PieChart, Bar, Pie, Cell, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

type MainTab = 'CARTEIRA' | 'ACORDOS' | 'LEMBRETES' | 'LOGS' | 'BI';
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#a855f7', '#64748b'];

const DebtorCollectionModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [activeMainTab, setActiveMainTab] = useState<MainTab>('CARTEIRA');
  const [debtors, setDebtors] = useState<DebtorInfo[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [globalLogs, setGlobalLogs] = useState<CollectionHistory[]>([]);
  const [allTitles, setAllTitles] = useState<AccountsReceivable[]>([]); // Para a aba Lembretes
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  
  // Estados do CRM
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [clientTitles, setClientTitles] = useState<AccountsReceivable[]>([]);
  const [clientHistory, setClientHistory] = useState<CollectionHistory[]>([]);
  const [isSubmittingInteraction, setIsSubmittingInteraction] = useState(false);
  
  // Estados do Acordo (Settlement) & Cartório
  const [isNegotiating, setIsNegotiating] = useState(false);
  const [isNotarySelection, setIsNotarySelection] = useState(false);
  const [isNotaryRemoval, setIsNotaryRemoval] = useState(false); // Novo estado para retirada
  const [isReviewing, setIsReviewing] = useState(false);
  const [selectedForAgreement, setSelectedForAgreement] = useState<string[]>([]);
  const [viewingSettlement, setViewingSettlement] = useState<Settlement | null>(null);
  const [settlementDetails, setSettlementDetails] = useState<{ installments: AccountsReceivable[], originals: AccountsReceivable[] } | null>(null);
  
  // Estado para Lembretes
  const [sentReminders, setSentReminders] = useState<string[]>([]);

  // Estado para Baixa de Parcela
  const [liquidatingInstallment, setLiquidatingInstallment] = useState<string | null>(null);
  const [liquidationForm, setLiquidationForm] = useState({
    data: new Date().toISOString().split('T')[0]
  });

  const [agreementConfig, setAgreementConfig] = useState({
    parcelas: 1,
    frequencia: 'Mensal' as 'Semanal' | 'Quinzenal' | 'Mensal',
    dataPrimeira: new Date().toISOString().split('T')[0],
    valorNegociado: 0,
    observacao: ''
  });

  const [interactionForm, setInteractionForm] = useState({
    acao: 'WhatsApp',
    observacao: '',
    proximaAcao: '' // Usado para data de agendamento ou retorno
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [debtorData, settlementData, logsData, titlesData] = await Promise.all([
        DataService.getDebtorsSummary(),
        FinanceService.getSettlements(),
        FinanceService.getAllCollectionLogs(),
        FinanceService.getAccountsReceivable() // Para aba Lembretes
      ]);
      setDebtors(debtorData);
      setSettlements(settlementData);
      setGlobalLogs(logsData);
      setAllTitles(titlesData);
    } catch (e) {
      setToast({ msg: 'Erro ao carregar dados financeiros.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleManageClient = async (cliente: string) => {
    setSelectedClient(cliente);
    setLoading(true);
    try {
      const allAR = await FinanceService.getAccountsReceivable();
      const clientHistoryData = await FinanceService.getCollectionHistoryByClient(cliente);
      const today = new Date().toISOString().split('T')[0];
      
      const filtered = allAR.filter(t => {
        const situacao = (t.situacao || '').toUpperCase().trim();
        const formaPgto = (t.forma_pagamento || '').toUpperCase().trim();
        const isOverdue = t.data_vencimento && t.data_vencimento < today;
        
        return (
          t.cliente === cliente && 
          situacao === 'EM ABERTO' &&
          formaPgto === 'BOLETO' &&
          t.saldo > 0.01 && 
          !t.id_acordo && 
          isOverdue
        );
      });
      
      setClientTitles(filtered);
      setClientHistory(clientHistoryData);
    } catch (e) {
      setToast({ msg: 'Erro ao carregar dossiê do cliente.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSendToCartorio = async () => {
    if (selectedForAgreement.length === 0) return;
    if (!window.confirm(`Confirma o envio de ${selectedForAgreement.length} títulos para protesto em cartório?`)) return;

    setIsSubmittingInteraction(true);
    try {
      const res = await FinanceService.sendTitlesToNotary(selectedForAgreement, currentUser);
      if (res.success) {
        await FinanceService.addCollectionHistory({
          cliente: selectedClient!,
          acao_tomada: 'CARTORIO',
          observacao: `ENVIO PARA PROTESTO: ${selectedForAgreement.length} TÍTULOS. VALOR TOTAL: R$ ${totalSelectedForAgreement.toFixed(2)}`,
          data_proxima_acao: undefined,
          valor_devido: totalSelectedForAgreement,
          dias_atraso: 0,
          usuario: currentUser.name
        });
        setToast({ msg: 'TÍTULOS ENVIADOS PARA CARTÓRIO!', type: 'success' });
        setIsNotarySelection(false);
        setSelectedForAgreement([]);
        fetchData();
        setSelectedClient(null); 
      } else {
        setToast({ msg: res.message || 'Erro ao processar envio.', type: 'error' });
      }
    } catch (e) {
      setToast({ msg: 'Erro de conexão.', type: 'error' });
    } finally {
      setIsSubmittingInteraction(false);
    }
  };

  const handleRemoveFromCartorio = async () => {
    if (selectedForAgreement.length === 0) return;
    if (!window.confirm(`Confirma a retirada de ${selectedForAgreement.length} títulos do cartório?`)) return;

    setIsSubmittingInteraction(true);
    try {
      const res = await FinanceService.removeTitlesFromNotary(selectedForAgreement, currentUser);
      if (res.success) {
        await FinanceService.addCollectionHistory({
          cliente: selectedClient!,
          acao_tomada: 'RETIRADA_CARTORIO',
          observacao: `RETIRADA DE PROTESTO: ${selectedForAgreement.length} TÍTULOS. REVERTIDO PARA COBRANÇA.`,
          data_proxima_acao: undefined,
          valor_devido: totalSelectedForAgreement,
          dias_atraso: 0,
          usuario: currentUser.name
        });
        setToast({ msg: 'TÍTULOS RETIRADOS DO CARTÓRIO!', type: 'success' });
        setIsNotaryRemoval(false);
        setSelectedForAgreement([]);
        fetchData();
        setSelectedClient(null);
      } else {
        setToast({ msg: res.message || 'Erro ao processar retirada.', type: 'error' });
      }
    } catch (e) {
      setToast({ msg: 'Erro de conexão.', type: 'error' });
    } finally {
      setIsSubmittingInteraction(false);
    }
  };

  const handleQuickAction = (actionType: 'AGENDAR' | 'RETORNOU' | 'SEM_RETORNO' | 'CARTORIO' | 'RETIRAR_CARTORIO') => {
    setIsNegotiating(false);
    setIsNotarySelection(false);
    setIsNotaryRemoval(false);
    setSelectedForAgreement([]);

    if (actionType === 'CARTORIO') {
      setIsNotarySelection(true);
      setToast({ msg: 'Selecione os títulos para envio.', type: 'success' });
      return;
    }

    if (actionType === 'RETIRAR_CARTORIO') {
      setIsNotaryRemoval(true);
      setToast({ msg: 'Selecione os títulos para retirar.', type: 'success' });
      return;
    }

    let obs = '';
    let acao = 'Outros';

    if (actionType === 'AGENDAR') {
      acao = 'Agendamento';
      obs = 'CLIENTE PROMETEU PAGAMENTO';
    } else if (actionType === 'RETORNOU') {
      acao = 'Retorno';
      obs = 'CLIENTE RETORNOU CONTATO';
    } else if (actionType === 'SEM_RETORNO') {
      acao = 'Tentativa';
      obs = 'TENTATIVA DE CONTATO SEM SUCESSO';
    }

    setInteractionForm({ acao, observacao: obs, proximaAcao: '' });
  };

  const handleViewSettlement = async (s: Settlement) => {
    setLoading(true);
    try {
      const details = await FinanceService.getSettlementDetails(s.id);
      setSettlementDetails(details);
      setViewingSettlement(s);
    } catch (e) {
      setToast({ msg: 'Erro ao carregar detalhes do acordo.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleExcluirAcordo = async () => {
    if (!viewingSettlement) return;
    if (!window.confirm("CUIDADO: Isso excluirá PERMANENTEMENTE o contrato do banco e restaurará os débitos originais. Continuar?")) return;
    
    setIsSubmittingInteraction(true);
    try {
        const success = await FinanceService.deleteSettlement(viewingSettlement.id, currentUser);
        if (success) {
            setToast({ msg: 'ACORDO EXCLUÍDO!', type: 'success' });
            setViewingSettlement(null);
            setSettlementDetails(null);
            await fetchData();
        } else {
            setToast({ msg: 'Falha técnica ao excluir no banco.', type: 'error' });
        }
    } catch (e: any) {
        setToast({ msg: `Erro: ${e.message || 'Falha de conexão'}`, type: 'error' });
    } finally {
        setIsSubmittingInteraction(false);
    }
  };

  const handleBaixarParcela = async (id: string) => {
    setIsSubmittingInteraction(true);
    try {
        const success = await FinanceService.liquidateInstallment(id, liquidationForm.data, 'PIX', currentUser);
        if (success) {
            setToast({ msg: 'PARCELA LIQUIDADA (VIA PIX)!', type: 'success' });
            setLiquidatingInstallment(null);
            const updatedDetails = await FinanceService.getSettlementDetails(viewingSettlement!.id);
            setSettlementDetails(updatedDetails);
        } else {
            setToast({ msg: 'Erro ao liquidar parcela.', type: 'error' });
        }
    } catch (e) {
        setToast({ msg: 'Erro de conexão.', type: 'error' });
    } finally {
        setIsSubmittingInteraction(false);
    }
  };

  const handleFinalizarAcordoTotal = async () => {
    if (!viewingSettlement) return;
    if (!window.confirm("Todas as parcelas foram pagas. Deseja liquidar os títulos originais e finalizar o contrato?")) return;
    
    setIsSubmittingInteraction(true);
    try {
        const success = await FinanceService.finalizeSettlement(viewingSettlement.id, currentUser);
        if (success) {
            setToast({ msg: 'ACORDO FINALIZADO E TÍTULOS ORIGINAIS LIQUIDADOS!', type: 'success' });
            setViewingSettlement(null);
            setSettlementDetails(null);
            fetchData();
        } else {
            setToast({ msg: 'Falha ao finalizar contrato.', type: 'error' });
        }
    } catch (e) {
        setToast({ msg: 'Erro de conexão.', type: 'error' });
    } finally {
        setIsSubmittingInteraction(false);
    }
  };

  const calculateDaysOverdue = (dueDateStr: string) => {
    if (!dueDateStr) return 0;
    const due = new Date(dueDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = today.getTime() - due.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  const toggleTitleSelection = (id: string) => {
    setSelectedForAgreement(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const totalSelectedForAgreement = useMemo(() => {
    return clientTitles
      .filter(t => selectedForAgreement.includes(t.id))
      .reduce((acc, curr) => acc + (curr.valor_documento || curr.saldo), 0);
  }, [clientTitles, selectedForAgreement]);

  const projectedInstallments = useMemo(() => {
    const parts = [];
    let dateRef = new Date(agreementConfig.dataPrimeira);
    const valuePerPart = (agreementConfig.valorNegociado || totalSelectedForAgreement) / agreementConfig.parcelas;

    for (let i = 1; i <= agreementConfig.parcelas; i++) {
      parts.push({
        num: i,
        date: dateRef.toISOString().split('T')[0],
        value: valuePerPart
      });
      if (agreementConfig.frequencia === 'Semanal') dateRef.setDate(dateRef.getDate() + 7);
      else if (agreementConfig.frequencia === 'Quinzenal') dateRef.setDate(dateRef.getDate() + 15);
      else dateRef.setMonth(dateRef.getMonth() + 1);
    }
    return parts;
  }, [agreementConfig, totalSelectedForAgreement]);

  const generateAgreementPDF = async (
    agreementId: string,
    clientName: string,
    originalTotal: number,
    agreedTotal: number,
    parcelas: number,
    frequencia: string,
    firstDate: string,
    titles: AccountsReceivable[]
  ) => {
    try {
      const doc = new jsPDF();
      const company = await DataService.getCompanySettings();
      const today = new Date().toLocaleDateString('pt-BR');

      // Título
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('TERMO DE CONFISSÃO DE DÍVIDA E ACORDO EXTRAJUDICIAL', 105, 20, { align: 'center' });

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`PROTOCOLO: ${agreementId} | DATA: ${today}`, 105, 28, { align: 'center' });

      // Dados das Partes
      let y = 40;
      doc.setFont('helvetica', 'bold');
      doc.text('CREDOR:', 20, y);
      doc.setFont('helvetica', 'normal');
      doc.text(`${company.name || 'NZERP - SISTEMA DE GESTÃO'} (CNPJ: ${company.cnpj || '---'})`, 50, y);
      
      y += 8;
      doc.setFont('helvetica', 'bold');
      doc.text('DEVEDOR:', 20, y);
      doc.setFont('helvetica', 'normal');
      doc.text(clientName, 50, y);

      // Objeto (Dívida Original)
      y += 15;
      doc.setFont('helvetica', 'bold');
      doc.text('1. DO OBJETO (DÍVIDA ORIGINAL):', 20, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      const debtText = `O DEVEDOR reconhece e confessa a dívida no valor total original de R$ ${originalTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}, referente aos seguintes títulos vencidos:`;
      const splitDebt = doc.splitTextToSize(debtText, 170);
      doc.text(splitDebt, 20, y);
      
      y += 6 * splitDebt.length;
      
      // Lista de Títulos (Resumida)
      doc.setFontSize(8);
      titles.forEach((t, i) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(`• Doc: ${t.numero_documento || t.id} - Venc: ${new Date(t.data_vencimento).toLocaleDateString('pt-BR')} - Valor: R$ ${t.saldo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 25, y);
        y += 4;
      });
      y += 4;

      // Condições do Acordo
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('2. DAS CONDIÇÕES DE PAGAMENTO (ACORDO):', 20, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      const agreeText = `As partes ajustam o pagamento do montante negociado de R$ ${agreedTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}, a ser liquidado em ${parcelas} parcela(s) de periodicidade ${frequencia.toUpperCase()}, com início em ${new Date(firstDate).toLocaleDateString('pt-BR')}, conforme cronograma abaixo:`;
      const splitAgree = doc.splitTextToSize(agreeText, 170);
      doc.text(splitAgree, 20, y);
      y += 6 * splitAgree.length + 4;

      // Tabela de Parcelas
      doc.setFillColor(240, 240, 240);
      doc.rect(20, y, 170, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('PARCELA', 25, y + 5);
      doc.text('VENCIMENTO', 80, y + 5);
      doc.text('VALOR', 150, y + 5);
      y += 10;

      doc.setFont('helvetica', 'normal');
      const parts = [];
      let dateRef = new Date(firstDate);
      const valuePerPart = agreedTotal / parcelas;

      for (let i = 1; i <= parcelas; i++) {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(`${i}/${parcelas}`, 25, y);
        doc.text(dateRef.toLocaleDateString('pt-BR'), 80, y);
        doc.text(`R$ ${valuePerPart.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 150, y);
        
        if (frequencia === 'Semanal') dateRef.setDate(dateRef.getDate() + 7);
        else if (frequencia === 'Quinzenal') dateRef.setDate(dateRef.getDate() + 15);
        else dateRef.setMonth(dateRef.getMonth() + 1);
        
        y += 6;
      }

      // Disposições Finais
      y += 10;
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(8);
      doc.text('3. O não pagamento de qualquer parcela acarretará o vencimento antecipado das demais e o retorno da dívida ao valor original.', 20, y);
      
      // Assinaturas
      y += 30;
      if (y > 270) { doc.addPage(); y = 40; }
      
      doc.line(20, y, 90, y);
      doc.line(110, y, 180, y);
      doc.text('CREDOR (NZERP)', 35, y + 4);
      doc.text('DEVEDOR', 135, y + 4);

      doc.save(`ACORDO_${agreementId}_${clientName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);

    } catch (e) {
      console.error("Erro ao gerar PDF:", e);
      setToast({ msg: 'Erro ao gerar PDF do acordo.', type: 'error' });
    }
  };

  const handleEfetivarAcordo = async () => {
    if (!selectedClient) return;
    setIsSubmittingInteraction(true);
    try {
        const agreementId = `AC-${Date.now().toString().slice(-6)}`;
        const res = await FinanceService.createSettlement({
            id: agreementId,
            cliente: selectedClient,
            valorOriginal: totalSelectedForAgreement,
            valorAcordo: agreementConfig.valorNegociado || totalSelectedForAgreement,
            parcelas: agreementConfig.parcelas,
            frequencia: agreementConfig.frequencia,
            dataPrimeiraParcela: agreementConfig.dataPrimeira,
            dataCriacao: new Date().toISOString(),
            status: 'ATIVO',
            usuario: currentUser.name,
            intervaloDias: 30
        }, selectedForAgreement, currentUser);

        if (res) {
            // Títulos originais para listar no PDF
            const negotiatedTitles = clientTitles.filter(t => selectedForAgreement.includes(t.id));

            // Gera o PDF
            await generateAgreementPDF(
                agreementId,
                selectedClient,
                totalSelectedForAgreement,
                agreementConfig.valorNegociado || totalSelectedForAgreement,
                agreementConfig.parcelas,
                agreementConfig.frequencia,
                agreementConfig.dataPrimeira,
                negotiatedTitles
            );

            setToast({ msg: 'ACORDO EFETIVADO! PDF GERADO.', type: 'success' });
            
            await FinanceService.addCollectionHistory({
                cliente: selectedClient,
                acao_tomada: 'ACORDO',
                observacao: `ACORDO FIRMADO: R$ ${totalSelectedForAgreement.toFixed(2)} EM ${agreementConfig.parcelas}X ${agreementConfig.frequencia.toUpperCase()}. TÍTULOS ORIGINAIS BLOQUEADOS.`,
                data_proxima_acao: agreementConfig.dataPrimeira,
                valor_devido: totalSelectedForAgreement,
                dias_atraso: 0,
                usuario: currentUser.name
            });
            
            setIsReviewing(false);
            setIsNegotiating(false);
            setSelectedForAgreement([]);
            setActiveMainTab('ACORDOS');
            fetchData();
            setSelectedClient(null);
        }
    } catch (e) {
        setToast({ msg: 'Erro ao salvar acordo.', type: 'error' });
    } finally {
        setIsSubmittingInteraction(false);
    }
  };

  const handleAddInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;

    // Validação de Data Obrigatória
    const needsDate = ['Agendamento', 'Retorno', 'Tentativa'].includes(interactionForm.acao);
    if (needsDate && !interactionForm.proximaAcao) {
        setToast({ msg: 'A data de agendamento/retorno é obrigatória.', type: 'error' });
        return;
    }

    setIsSubmittingInteraction(true);
    try {
      const totalDevido = clientTitles.reduce((acc, curr) => acc + curr.saldo, 0);
      const res = await FinanceService.addCollectionHistory({
        cliente: selectedClient,
        acao_tomada: interactionForm.acao,
        observacao: interactionForm.observacao,
        data_proxima_acao: interactionForm.proximaAcao, // Envia a data selecionada
        valor_devido: totalDevido,
        dias_atraso: clientTitles.length > 0 ? calculateDaysOverdue(clientTitles[0].data_vencimento) : 0, 
        usuario: currentUser.name
      });

      if (res.success) {
        setToast({ msg: 'Interação registrada!', type: 'success' });
        setInteractionForm({ acao: 'WhatsApp', observacao: '', proximaAcao: '' });
        const updatedHistory = await FinanceService.getCollectionHistoryByClient(selectedClient);
        setClientHistory(updatedHistory);
      } else {
        setToast({ msg: res.error || 'Falha ao processar comando.', type: 'error' });
      }
    } catch (e: any) {
      setToast({ msg: 'Erro de conexão.', type: 'error' });
    } finally {
      setIsSubmittingInteraction(false);
    }
  };

  // Separação em dois grupos: A Cobrar (Urgente) vs Em Dia (Agendados)
  const { toCollect, upToDate } = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const filtered = debtors.filter(d => d.cliente.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const toCollectList: DebtorInfo[] = [];
    const upToDateList: DebtorInfo[] = [];

    filtered.forEach(d => {
        // Se não tem data agendada OU se a data é hoje/passado -> A Cobrar
        if (!d.nextActionDate || d.nextActionDate <= today) {
            toCollectList.push(d);
        } else {
            // Se tem data futura -> Em Dia
            upToDateList.push(d);
        }
    });

    return { toCollect: toCollectList, upToDate: upToDateList };
  }, [debtors, searchTerm]);

  const activeSettlements = useMemo(() => settlements.filter(s => s.status === 'ATIVO'), [settlements]);
  const completedSettlements = useMemo(() => settlements.filter(s => s.status !== 'ATIVO'), [settlements]);
  
  const allInstallmentsPaid = useMemo(() => {
    if (!settlementDetails || settlementDetails.installments.length === 0) return false;
    return settlementDetails.installments.every(i => i.situacao === 'PAGO');
  }, [settlementDetails]);

  // Filtragem para o Log Geral
  const filteredLogs = useMemo(() => {
    return globalLogs.filter(l => 
        l.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.usuario.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.acao_tomada.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [globalLogs, searchTerm]);

  // --- NOVA LÓGICA PARA LEMBRETES ---
  const { pendingReminders, sentTodayReminders } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = allTitles
      .map(t => {
        if (!t.data_vencimento) return null;
        const [year, month, day] = t.data_vencimento.split('-').map(Number);
        const dueDate = new Date(year, month - 1, day);
        dueDate.setHours(0, 0, 0, 0);

        const diffTime = dueDate.getTime() - today.getTime();
        const daysUntilDue = Math.round(diffTime / (1000 * 60 * 60 * 24));
        
        return { ...t, daysUntilDue };
      })
      .filter((t): t is AccountsReceivable & { daysUntilDue: number } => 
        t !== null &&
        (t.situacao === 'EM ABERTO' || t.situacao === 'ABERTO') &&
        t.saldo > 0.01 &&
        !t.id_acordo &&
        t.daysUntilDue >= 0 && t.daysUntilDue <= 3
      );

    const pending = upcoming
      .filter(t => !sentReminders.includes(t.id))
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
      
    const sent = upcoming
      .filter(t => sentReminders.includes(t.id))
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

    return { pendingReminders: pending, sentTodayReminders: sent };
  }, [allTitles, sentReminders]);

  const handleSendReminder = async (title: AccountsReceivable & { daysUntilDue: number }) => {
    setSentReminders(prev => [...prev, title.id]);
    try {
        await FinanceService.addCollectionHistory({
            cliente: title.cliente,
            acao_tomada: 'LEMBRETE_VENCIMENTO',
            observacao: `LEMBRETE ENVIADO. TÍTULO ${title.numero_documento || title.id} VENCE EM ${title.daysUntilDue} DIA(S).`,
            valor_devido: title.saldo,
            dias_atraso: 0,
            usuario: currentUser.name
        });
        setToast({ msg: 'Lembrete registrado!', type: 'success' });
    } catch (e) {
        setSentReminders(prev => prev.filter(id => id !== title.id));
        setToast({ msg: 'Falha ao registrar lembrete.', type: 'error' });
    }
  };

  const formatDaysUntilDue = (days: number) => {
    if (days === 0) return { text: "VENCE HOJE", color: 'text-red-600', pulse: true };
    if (days === 1) return { text: "VENCE AMANHÃ", color: 'text-amber-600', pulse: false };
    return { text: `VENCE EM ${days} DIAS`, color: 'text-slate-500', pulse: false };
  };

  // --- NOVA LÓGICA PARA O BI ---
  const biData = useMemo(() => {
    const totalEmAtraso = debtors.reduce((acc, d) => acc + d.totalVencido, 0);
    const totalEmAcordo = activeSettlements.reduce((acc, s) => acc + s.valorAcordo, 0);
    const totalCarteira = totalEmAtraso + totalEmAcordo;
    const recoveryRate = totalCarteira > 0 ? (totalEmAcordo / totalCarteira) * 100 : 0;

    const agingData = [
      { name: '0-15 Dias', value: debtors.reduce((acc, d) => acc + d.vencidoAte15d, 0) },
      { name: '15+ Dias', value: debtors.reduce((acc, d) => acc + d.vencidoMais15d, 0) },
      { name: 'Em Cartório', value: debtors.reduce((acc, d) => acc + d.enviarCartorio, 0) },
    ];

    const operatorMap: Record<string, number> = {};
    globalLogs.forEach(log => {
      const operator = log.usuario.split('@')[0].toUpperCase();
      operatorMap[operator] = (operatorMap[operator] || 0) + 1;
    });
    const operatorPerformance = Object.entries(operatorMap)
      .map(([name, actions]) => ({ name, actions }))
      .sort((a, b) => b.actions - a.actions)
      .slice(0, 10);

    const actionMap: Record<string, number> = {};
    globalLogs.forEach(log => {
      const action = log.acao_tomada;
      actionMap[action] = (actionMap[action] || 0) + 1;
    });
    const actionDistribution = Object.entries(actionMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return {
      totalEmAtraso,
      totalEmAcordo,
      recoveryRate,
      debtorCount: debtors.length,
      agingData,
      operatorPerformance,
      actionDistribution,
    };
  }, [debtors, activeSettlements, globalLogs]);


  const exportLogsToExcel = () => {
    if (filteredLogs.length === 0) {
      setToast({ msg: 'Nenhum log para exportar.', type: 'error' });
      return;
    }

    const dataForExport = filteredLogs.map(log => ({
      'Data/Hora': new Date(log.data_registro).toLocaleString('pt-BR'),
      'Cliente': log.cliente,
      'Ação Tomada': log.acao_tomada,
      'Valor Devido (R$)': log.valor_devido,
      'Operador': log.usuario,
      'Detalhamento': log.observacao,
      'Próxima Ação Agendada': log.data_proxima_acao ? new Date(log.data_proxima_acao).toLocaleDateString('pt-BR') : ''
    }));

    const ws = XLSX.utils.json_to_sheet(dataForExport);
    
    ws['!cols'] = [
      { wch: 20 }, { wch: 35 }, { wch: 20 }, { wch: 15 }, 
      { wch: 15 }, { wch: 60 }, { wch: 25 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Log_Cobranca');
    XLSX.writeFile(wb, `Log_Cobranca_NZERP_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setToast({ msg: 'Log de cobrança exportado!', type: 'success' });
  };


  const DebtorCard: React.FC<{ d: DebtorInfo }> = ({ d }) => (
    <div className="bg-white border border-slate-100 p-6 rounded-[2rem] shadow-sm hover:border-blue-300 transition-all group flex flex-col xl:flex-row justify-between items-center gap-6">
       <div className="flex-1 w-full xl:w-auto">
          <div className="flex items-center gap-3 mb-1">
             <h3 className="font-black text-slate-900 uppercase italic text-lg tracking-tight">{d.cliente}</h3>
             {d.vencidoMais15d > 0 && <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded-lg text-[7px] font-black uppercase tracking-widest animate-pulse border border-red-100">Risco Alto</span>}
             {d.nextActionDate && d.nextActionDate > new Date().toISOString().split('T')[0] && (
               <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-lg text-[7px] font-black uppercase tracking-widest border border-blue-100">
                 Agendado: {new Date(d.nextActionDate).toLocaleDateString('pt-BR')}
               </span>
             )}
          </div>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{d.qtdTitulos} Títulos em aberto</p>
       </div>
       
       <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center items-center w-full xl:w-auto">
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 min-w-[100px]">
             <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Vencido</p>
             <p className="text-sm font-black text-slate-900 italic">R$ {d.totalVencido.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
          </div>
          <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100 min-w-[100px]">
             <p className="text-[7px] font-black text-amber-600 uppercase tracking-widest mb-1">0 a 15 Dias</p>
             <p className="text-sm font-black text-amber-700 italic">R$ {d.vencidoAte15d.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
          </div>
          <div className="bg-red-50 p-3 rounded-2xl border border-red-100 min-w-[100px]">
             <p className="text-[7px] font-black text-red-600 uppercase tracking-widest mb-1">15+ Dias</p>
             <p className="text-sm font-black text-red-700 italic">R$ {d.vencidoMais15d.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
          </div>
          <div className="bg-slate-900 p-3 rounded-2xl border border-slate-800 min-w-[100px] text-white">
             <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Em Cartório</p>
             <p className="text-sm font-black text-white italic">R$ {(d.enviarCartorio || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
          </div>
          <button 
            onClick={() => handleManageClient(d.cliente)}
            className="px-6 py-4 bg-blue-600 text-white rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg italic h-full"
          >
            Gerenciar
          </button>
       </div>
    </div>
  );

  if (loading && !selectedClient && !viewingSettlement) return (
    <div className="py-20 text-center opacity-30 font-black uppercase text-xs italic animate-pulse">
      Sincronizando Sistema de Cobrança...
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      {!selectedClient && !viewingSettlement ? (
        <>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Gestão de Cobrança</h2>
              <div className="flex gap-4 mt-4">
                 <button 
                  onClick={() => setActiveMainTab('CARTEIRA')}
                  className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeMainTab === 'CARTEIRA' ? 'bg-slate-900 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
                 >
                   Carteira em Atraso
                 </button>
                 <button 
                  onClick={() => setActiveMainTab('ACORDOS')}
                  className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeMainTab === 'ACORDOS' ? 'bg-blue-600 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
                 >
                   Gestão de Acordos
                 </button>
                 <button
                    onClick={() => setActiveMainTab('LEMBRETES')}
                    className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeMainTab === 'LEMBRETES' ? 'bg-amber-500 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
                 >
                    Lembretes
                 </button>
                 <button 
                  onClick={() => setActiveMainTab('LOGS')}
                  className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeMainTab === 'LOGS' ? 'bg-purple-600 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
                 >
                   Log Cobrança
                 </button>
                 <button
                    onClick={() => setActiveMainTab('BI')}
                    className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeMainTab === 'BI' ? 'bg-teal-600 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
                 >
                    BI Cobrança
                 </button>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex-1 max-w-md flex items-center">
                <svg className="w-5 h-5 text-slate-300 ml-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3"/></svg>
                <input 
                  type="text" 
                  placeholder="LOCALIZAR..." 
                  className="w-full px-4 py-3 bg-transparent outline-none font-black text-xs uppercase"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              {activeMainTab === 'LOGS' && (
                <button 
                  onClick={exportLogsToExcel}
                  className="px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center space-x-2 italic"
                >
                   <ICONS.Upload className="w-3.5 h-3.5 rotate-180" />
                   <span>Exportar</span>
                </button>
              )}
            </div>
          </div>

          {activeMainTab === 'CARTEIRA' ? (
            <div className="space-y-12">
              {/* SEÇÃO 1: A COBRAR (PRIORIDADE) */}
              <section>
                 <h3 className="text-sm font-black text-red-500 uppercase tracking-widest flex items-center gap-2 mb-4 italic">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                    Prioridade: A Cobrar / Atrasados
                 </h3>
                 <div className="grid grid-cols-1 gap-4">
                    {toCollect.map(d => <DebtorCard key={d.cliente} d={d} />)}
                    {toCollect.length === 0 && (
                       <div className="py-8 text-center border-2 border-dashed border-slate-100 rounded-[2rem] opacity-30 font-black uppercase text-[10px]">
                          Nenhum cliente na fila de cobrança imediata.
                       </div>
                    )}
                 </div>
              </section>

              {/* SEÇÃO 2: COBRANÇA EM DIA (AGENDADOS) */}
              {upToDate.length > 0 && (
                <section className="pt-8 border-t border-slate-200">
                   <h3 className="text-sm font-black text-blue-500 uppercase tracking-widest flex items-center gap-2 mb-4 italic opacity-70">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                      Cobrança em Dia / Agendados
                   </h3>
                   <div className="grid grid-cols-1 gap-4 opacity-80 hover:opacity-100 transition-opacity">
                      {upToDate.map(d => <DebtorCard key={d.cliente} d={d} />)}
                   </div>
                </section>
              )}
            </div>
          ) : activeMainTab === 'ACORDOS' ? (
            <div className="space-y-12">
               <section className="space-y-6">
                  <h3 className="text-xl font-black text-slate-900 uppercase italic tracking-tighter flex items-center gap-3">
                     <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                     Acordos em Vigência (Ativos)
                  </h3>
                  <div className="grid grid-cols-1 gap-4">
                     {activeSettlements.filter(s => s.cliente.toLowerCase().includes(searchTerm.toLowerCase())).map(s => (
                        <div key={s.id} className="bg-white border border-slate-100 p-8 rounded-[2.5rem] shadow-sm hover:border-blue-500 transition-all flex flex-col md:flex-row justify-between items-center gap-8">
                           <div className="flex-1">
                              <p className="text-[8px] font-black text-blue-600 uppercase tracking-widest mb-1">Protocolo #{s.id}</p>
                              <h4 className="text-xl font-black text-slate-900 uppercase italic tracking-tight">{s.cliente}</h4>
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-2 italic">Criado em: {new Date(s.dataCriacao).toLocaleDateString('pt-BR')}</p>
                           </div>
                           <div className="grid grid-cols-2 md:grid-cols-3 gap-10 text-center md:text-right">
                              <div>
                                 <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Valor Acordado</p>
                                 <p className="text-sm font-black text-emerald-600 italic">R$ {s.valorAcordo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                              </div>
                              <div>
                                 <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Parcelamento</p>
                                 <p className="text-sm font-black text-slate-900 italic">{s.parcelas}x {s.frequencia}</p>
                              </div>
                              <button 
                                onClick={() => handleViewSettlement(s)}
                                className="px-6 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-900 hover:text-white shadow-sm transition-all italic"
                              >
                                Gerenciar Acordo
                              </button>
                           </div>
                        </div>
                     ))}
                  </div>
               </section>

               <section className="space-y-6 pt-6 border-t border-slate-200">
                  <h3 className="text-sm font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-3">
                     Histórico de Negociações
                  </h3>
                  <div className="table-container shadow-none border border-slate-100">
                     <table className="w-full">
                        <thead className="bg-slate-50">
                           <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                              <th className="px-6 py-4 text-left">Protocolo</th>
                              <th className="px-6 py-4 text-left">Cliente</th>
                              <th className="px-6 py-4 text-right">Valor</th>
                              <th className="px-6 py-4 text-center">Status</th>
                              <th className="px-6 py-4 text-right">Ação</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                           {completedSettlements.map(s => (
                              <tr key={s.id} className="hover:bg-slate-50/50 transition-all opacity-70 grayscale hover:grayscale-0">
                                 <td className="px-6 py-4 text-[10px] font-black text-slate-400">#{s.id}</td>
                                 <td className="px-6 py-4 text-[11px] font-black text-slate-800 uppercase italic">{s.cliente}</td>
                                 <td className="px-6 py-4 text-right font-black text-slate-900 text-xs">R$ {s.valorAcordo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                                 <td className="px-6 py-4 text-center">
                                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${s.status === 'CANCELADO' ? 'bg-red-50 text-red-500 border-red-100' : s.status === 'LIQUIDADO' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-100'}`}>{s.status}</span>
                                 </td>
                                 <td className="px-6 py-4 text-right">
                                    <button onClick={() => handleViewSettlement(s)} className="text-[9px] font-black text-blue-600 uppercase hover:underline">Visualizar</button>
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </section>
            </div>
          ) : activeMainTab === 'LEMBRETES' ? (
            <div className="space-y-12">
                <section>
                    <h3 className="text-sm font-black text-amber-500 uppercase tracking-widest flex items-center gap-2 mb-4 italic">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                        Lembretes de Vencimento Pendentes
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {pendingReminders.length > 0 ? pendingReminders.map(t => {
                            const { text, color, pulse } = formatDaysUntilDue(t.daysUntilDue);
                            return (
                                <div key={t.id} className="bg-white border border-slate-100 p-6 rounded-2xl shadow-sm hover:border-amber-300 transition-all flex justify-between items-center">
                                    <div className="flex-1">
                                        <div className={`text-[9px] font-black uppercase tracking-widest mb-1 ${color} ${pulse ? 'animate-pulse' : ''}`}>{text}</div>
                                        <h4 className="text-sm font-black text-slate-900 uppercase italic truncate">{t.cliente}</h4>
                                        <p className="text-[10px] font-bold text-slate-400">{t.data_vencimento.split('-').reverse().join('/')}</p>
                                    </div>
                                    <div className="text-right flex items-center gap-4">
                                        <p className="text-sm font-black text-slate-800 italic">R$ {t.saldo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                                        <button 
                                            onClick={() => handleSendReminder(t)}
                                            className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all shadow-lg italic"
                                        >
                                            Lembrar
                                        </button>
                                    </div>
                                </div>
                            );
                        }) : (
                            <div className="md:col-span-2 py-8 text-center border-2 border-dashed border-slate-100 rounded-[2rem] opacity-30 font-black uppercase text-[10px]">
                                Nenhum título com vencimento próximo.
                            </div>
                        )}
                    </div>
                </section>

                {sentTodayReminders.length > 0 && (
                    <section className="pt-8 border-t border-slate-200">
                        <h3 className="text-sm font-black text-emerald-500 uppercase tracking-widest flex items-center gap-2 mb-4 italic">
                            Alertas Enviados Hoje
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-70">
                            {sentTodayReminders.map(t => (
                                <div key={t.id} className="bg-white border border-slate-100 p-6 rounded-2xl flex justify-between items-center">
                                    <div className="flex-1">
                                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t.data_vencimento.split('-').reverse().join('/')}</div>
                                        <h4 className="text-sm font-black text-slate-600 uppercase italic truncate">{t.cliente}</h4>
                                    </div>
                                    <div className="text-right flex items-center gap-4">
                                        <p className="text-sm font-black text-slate-500 italic">R$ {t.saldo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                                        <button disabled className="px-6 py-3 bg-emerald-50 text-emerald-600 rounded-xl font-black text-[10px] uppercase tracking-widest border border-emerald-100">
                                            Enviado
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
          ) : activeMainTab === 'LOGS' ? (
            <div className="space-y-6">
                <div className="table-container shadow-none border border-slate-100 bg-white rounded-[2rem]">
                    <table className="w-full">
                        <thead className="bg-[#0F172A]">
                            <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                <th className="px-6 py-5 text-left">Data / Hora</th>
                                <th className="px-6 py-5 text-left">Cliente</th>
                                <th className="px-6 py-5 text-center">Ação</th>
                                <th className="px-6 py-5 text-right">Valor Negociado</th>
                                <th className="px-6 py-5 text-left">Operador</th>
                                <th className="px-6 py-5 text-left">Detalhamento</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filteredLogs.length > 0 ? filteredLogs.map(log => {
                                let actionClass = 'bg-slate-100 text-slate-500 border-slate-200';
                                if (log.acao_tomada === 'ACORDO') actionClass = 'bg-emerald-50 text-emerald-600 border-emerald-100';
                                else if (log.acao_tomada === 'CARTORIO') actionClass = 'bg-slate-900 text-white border-slate-900';
                                else if (log.acao_tomada === 'Agendamento') actionClass = 'bg-blue-50 text-blue-600 border-blue-100';
                                else if (log.acao_tomada === 'RETIRADA_CARTORIO') actionClass = 'bg-emerald-100 text-emerald-700 border-emerald-200';
                                else if (['Tentativa', 'Sem Retorno'].includes(log.acao_tomada)) actionClass = 'bg-amber-50 text-amber-600 border-amber-100';

                                return (
                                    <tr key={log.id} className="hover:bg-slate-50 transition-all group">
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-[11px] font-black text-slate-900 leading-none">{new Date(log.data_registro).toLocaleDateString('pt-BR')}</span>
                                                <span className="text-[9px] font-bold text-slate-400 mt-1 uppercase">{new Date(log.data_registro).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-[10px] font-black text-slate-800 uppercase italic truncate max-w-[200px] block">{log.cliente}</span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${actionClass}`}>
                                                {log.acao_tomada}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {log.valor_devido ? (
                                                <span className="text-[11px] font-black text-slate-900 italic">R$ {Number(log.valor_devido).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                                            ) : <span className="text-slate-300">-</span>}
                                        </td>
                                        <td className="px-6 py-4 text-left">
                                            <span className="text-[9px] font-black text-blue-600 uppercase">@{log.usuario.split('@')[0]}</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-[9px] font-medium text-slate-500 uppercase leading-relaxed max-w-sm italic">"{log.observacao}"</p>
                                            {log.data_proxima_acao && (
                                                <p className="text-[8px] font-black text-amber-600 uppercase mt-1">Próx. Ação: {new Date(log.data_proxima_acao).toLocaleDateString('pt-BR')}</p>
                                            )}
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan={6} className="py-20 text-center opacity-30 font-black uppercase text-[10px] italic">Nenhuma ação registrada no histórico global.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
          ) : (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total em Atraso</p><h3 className="text-2xl font-black text-red-600 italic tracking-tighter">R$ {biData.totalEmAtraso.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3></div>
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total em Acordo</p><h3 className="text-2xl font-black text-blue-600 italic tracking-tighter">R$ {biData.totalEmAcordo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3></div>
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Taxa de Recuperação</p><h3 className="text-2xl font-black text-emerald-600 italic tracking-tighter">{biData.recoveryRate.toFixed(1)}%</h3></div>
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Devedores Ativos</p><h3 className="text-2xl font-black text-slate-800 italic tracking-tighter">{biData.debtorCount}</h3></div>
              </div>
              
              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                <div className="lg:col-span-3 bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm h-96">
                   <h4 className="text-sm font-black text-slate-600 uppercase mb-4 italic tracking-tight">Dívida por Faixa de Atraso (Aging)</h4>
                   <ResponsiveContainer width="100%" height="90%">
                      <BarChart data={biData.agingData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                         <CartesianGrid strokeDasharray="3 3" vertical={false} />
                         <XAxis dataKey="name" fontSize={10} fontWeight="bold" />
                         <YAxis tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`} fontSize={10} />
                         <Tooltip formatter={(val: number) => `R$ ${val.toLocaleString('pt-BR')}`} />
                         <Bar dataKey="value" name="Valor" radius={[4, 4, 0, 0]}>
                            {biData.agingData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={['#fbbf24', '#f87171', '#1f2937'][index % 3]} />
                            ))}
                         </Bar>
                      </BarChart>
                   </ResponsiveContainer>
                </div>
                
                <div className="lg:col-span-2 bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm h-96">
                   <h4 className="text-sm font-black text-slate-600 uppercase mb-4 italic tracking-tight">Distribuição de Ações</h4>
                   <ResponsiveContainer width="100%" height="90%">
                      <PieChart>
                         <Pie data={biData.actionDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} labelLine={false} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}>
                            {biData.actionDistribution.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                         </Pie>
                         <Tooltip formatter={(val: number, name: string) => [`${val} ações`, name]} />
                         <Legend iconType="circle" wrapperStyle={{fontSize: '10px'}} />
                      </PieChart>
                   </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm h-[450px]">
                 <h4 className="text-sm font-black text-slate-600 uppercase mb-4 italic tracking-tight">Produtividade por Operador (Top 10)</h4>
                 <ResponsiveContainer width="100%" height="90%">
                    <BarChart layout="vertical" data={biData.operatorPerformance} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                       <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                       <XAxis type="number" />
                       <YAxis dataKey="name" type="category" width={80} fontSize={10} />
                       <Tooltip />
                       <Legend />
                       <Bar dataKey="actions" name="Ações Realizadas" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                 </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      ) : selectedClient ? (
        /* CRM DO CLIENTE */
        <div className="animate-in slide-in-from-right-4 duration-500 space-y-8">
           {/* ... (CRM UI remains unchanged) ... */}
        </div>
      ) : (
        /* VISUALIZAÇÃO E GERENCIAMENTO DE ACORDO */
        <div className="animate-in slide-in-from-bottom-4 duration-500 space-y-8">
           {/* ... (Settlement Details UI remains unchanged) ... */}
        </div>
      )}

      {/* --- TELA DE REVISÃO DE ACORDO (MODAL OVERLAY) --- */}
      {isReviewing && (
         <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-[300] flex items-center justify-center p-6 animate-in fade-in duration-300">
            {/* ... (Review UI remains unchanged) ... */}
         </div>
      )}
    </div>
  );
};

export default DebtorCollectionModule;
