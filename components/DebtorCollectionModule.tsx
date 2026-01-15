import React, { useState, useMemo, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { FinanceService } from '../services/financeService';
import { DebtorInfo, User, AccountsReceivable, CollectionHistory, Settlement } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import { jsPDF } from 'jspdf';

type MainTab = 'CARTEIRA' | 'ACORDOS' | 'LOGS';

const DebtorCollectionModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [activeMainTab, setActiveMainTab] = useState<MainTab>('CARTEIRA');
  const [debtors, setDebtors] = useState<DebtorInfo[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [globalLogs, setGlobalLogs] = useState<CollectionHistory[]>([]);
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
      const [debtorData, settlementData, logsData] = await Promise.all([
        DataService.getDebtorsSummary(),
        FinanceService.getSettlements(),
        FinanceService.getAllCollectionLogs()
      ]);
      setDebtors(debtorData);
      setSettlements(settlementData);
      setGlobalLogs(logsData);
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
      
      // Filtro Rigoroso: Apenas BOLETOS VENCIDOS em aberto (Em Aberto ou Cartório)
      // Exclui explicitamente CANCELADOS, PAGOS e NEGOCIADOS
      const filtered = allAR.filter(t => {
        const situacao = (t.situacao || '').toUpperCase().trim();
        const formaPagamento = (t.forma_pagamento || '').toUpperCase();
        const isBoleto = formaPagamento.includes('BOLETO');
        const isOverdue = t.data_vencimento && t.data_vencimento < today;
        
        // Situações que representam dívida ativa e não resolvida
        const situacoesPermitidas = ['ABERTO', 'EM ABERTO', 'CARTORIO', 'EM CARTORIO'];
        
        return (
          t.cliente === cliente && 
          t.saldo > 0.01 && 
          !t.id_acordo && 
          isBoleto && 
          isOverdue &&
          situacoesPermitidas.includes(situacao)
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
                  onClick={() => setActiveMainTab('LOGS')}
                  className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeMainTab === 'LOGS' ? 'bg-purple-600 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
                 >
                   Log Cobrança
                 </button>
              </div>
            </div>
            
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
                                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${s.status === 'CANCELADO' ? 'bg-red-50 text-red-500 border-red-100' : s.status === 'LIQUIDADO' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-100'}`}>{s.status}</span>
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
          ) : (
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
          )}
        </>
      ) : selectedClient ? (
        /* CRM DO CLIENTE */
        <div className="animate-in slide-in-from-right-4 duration-500 space-y-8">
           <div className="flex items-center justify-between">
              <button onClick={() => { setSelectedClient(null); setIsNegotiating(false); setIsNotarySelection(false); setIsNotaryRemoval(false); setSelectedForAgreement([]); }} className="flex items-center gap-2 text-slate-400 hover:text-slate-900 transition-colors font-black text-[10px] uppercase tracking-widest">
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth="3"/></svg>
                 Voltar para Fila
              </button>
              <div className="flex gap-3">
                 <button 
                   onClick={() => { setIsNegotiating(!isNegotiating); setIsNotarySelection(false); setIsNotaryRemoval(false); setSelectedForAgreement([]); }}
                   className={`px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 italic transition-all ${isNegotiating ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                 >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {isNegotiating ? 'Cancelar Seleção' : 'Efetuar Acordo'}
                 </button>
              </div>
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8 space-y-8">
                 <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm relative overflow-hidden">
                    {isNegotiating && <div className="absolute top-0 left-0 w-full h-2 bg-blue-600 animate-pulse"></div>}
                    {isNotarySelection && <div className="absolute top-0 left-0 w-full h-2 bg-slate-900 animate-pulse"></div>}
                    {isNotaryRemoval && <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500 animate-pulse"></div>}
                    <h2 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter mb-8 leading-none">{selectedClient}</h2>
                    <div className="space-y-6">
                       <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest italic">
                          {isNegotiating ? 'SELECIONE OS TÍTULOS PARA O ACORDO' : isNotarySelection ? 'SELECIONE TÍTULOS PARA CARTÓRIO' : isNotaryRemoval ? 'SELECIONE PARA RETIRAR DO CARTÓRIO' : 'DOSSIÊ FINANCEIRO'}
                       </p>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {clientTitles.length > 0 ? clientTitles.map(t => {
                            // Bloqueio apenas se estiver em OUTRO acordo (não bloqueia 'CARTORIO' para negociação, apenas se não for acordo)
                            const isBlocked = t.statusCobranca === 'BLOQUEADO_ACORDO' || t.statusCobranca === 'BLOQUEADO_CARTORIO';
                            const days = calculateDaysOverdue(t.data_vencimento);
                            const isSelected = selectedForAgreement.includes(t.id);
                            const canSelect = isNegotiating || isNotarySelection || isNotaryRemoval;
                            
                            // Se estivermos removendo do cartório, só pode selecionar o que ESTÁ em cartório
                            if (isNotaryRemoval && t.statusCobranca !== 'CARTORIO') return null;
                            // Se estivermos enviando para cartório, não pode selecionar o que JÁ ESTÁ em cartório
                            if (isNotarySelection && t.statusCobranca === 'CARTORIO') return null;

                            return (
                               <div 
                                 key={t.id} 
                                 onClick={() => !isBlocked && canSelect && toggleTitleSelection(t.id)}
                                 className={`p-6 border rounded-[2rem] space-y-4 transition-all group relative ${
                                    isBlocked 
                                    ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed' 
                                    : canSelect 
                                      ? isSelected ? 'bg-blue-50 border-blue-600 cursor-pointer shadow-md' : 'bg-white border-slate-200 opacity-80 cursor-pointer'
                                      : 'bg-white border-red-100 hover:border-red-300'
                                 }`}
                               >
                                  {isBlocked && (
                                     <div className="absolute top-4 right-4 bg-slate-900 text-white p-1 rounded-lg" title="Título bloqueado">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeWidth="3"/></svg>
                                     </div>
                                  )}
                                  <div className="flex justify-between items-start">
                                     <div>
                                        <p className="font-black text-slate-400 text-[8px] uppercase">Lançamento / Doc</p>
                                        <p className="font-mono font-bold text-slate-800 text-[11px] tracking-tight">{t.numero_documento || t.id}</p>
                                     </div>
                                     <div className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border bg-red-50 text-red-600 border-red-100 flex items-center gap-1">
                                        <div className="w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse"></div>
                                        VENCIDO ({days} DIAS)
                                     </div>
                                  </div>
                                  <div className="flex justify-between items-end border-t border-slate-200/50 pt-3">
                                     <p className="font-black text-slate-900 text-sm italic">R$ {(t.valor_documento || t.saldo).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                                     {t.statusCobranca === 'CARTORIO' ? (
                                        <span className="text-[7px] font-black text-white bg-slate-900 px-2 py-0.5 rounded uppercase italic">EM CARTÓRIO</span>
                                     ) : t.statusCobranca === 'BLOQUEADO_CARTORIO' ? (
                                        <span className="text-[7px] font-black text-slate-900 bg-slate-200 px-2 py-0.5 rounded uppercase italic">ACORDO (CARTÓRIO)</span>
                                     ) : isBlocked ? (
                                        <span className="text-[7px] font-black text-slate-400 uppercase italic">BLOQUEADO</span>
                                     ) : (
                                        <p className="text-[8px] font-black text-slate-400 uppercase italic">{t.data_vencimento?.split('-').reverse().join('/')}</p>
                                     )}
                                  </div>
                               </div>
                            );
                          }).filter(Boolean) : (
                            <div className="col-span-full py-10 text-center opacity-30 italic font-black uppercase text-[10px]">
                               Nenhum boleto vencido encontrado para negociação.
                            </div>
                          )}
                       </div>
                    </div>
                 </div>
                 <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                    <h3 className="text-xl font-black text-slate-900 uppercase italic tracking-tighter mb-8 flex items-center gap-3"><ICONS.History className="w-5 h-5 text-blue-600" />Histórico de Cobrança</h3>
                    <div className="relative pl-8 space-y-10">
                       {clientHistory.length > 0 ? clientHistory.map((h, idx) => (
                         <div key={h.id} className="relative group">
                            {idx !== clientHistory.length - 1 && <div className="absolute left-[-21px] top-6 w-0.5 h-20 bg-slate-100"></div>}
                            <div className={`absolute left-[-26px] top-1.5 w-3 h-3 rounded-full border-4 border-white shadow-sm ${h.acao_tomada === 'CARTORIO' ? 'bg-slate-900' : 'bg-blue-600'}`}></div>
                            <div className="space-y-1">
                               <div className="flex items-center gap-3">
                                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(h.data_registro).toLocaleString('pt-BR')}</span>
                                  <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase border shadow-sm ${h.acao_tomada === 'ACORDO' ? 'bg-purple-50 text-purple-600' : h.acao_tomada === 'CARTORIO' ? 'bg-slate-900 text-white border-slate-900' : 'bg-blue-50 text-blue-600'}`}>{h.acao_tomada}</span>
                               </div>
                               <p className="text-[12px] font-bold text-slate-700 leading-relaxed group-hover:text-slate-900 transition-colors">"{h.observacao}"</p>
                               {h.data_proxima_acao && <p className="text-[8px] font-black text-amber-600 uppercase tracking-widest mt-1">Próxima Ação: {new Date(h.data_proxima_acao).toLocaleDateString('pt-BR')}</p>}
                               <p className="text-[8px] font-black text-slate-400 uppercase italic mt-1">Operador: {h.usuario}</p>
                            </div>
                         </div>
                       )) : <div className="py-10 text-center opacity-20 italic font-black uppercase text-[10px]">Nenhum registro anterior</div>}
                    </div>
                 </div>
              </div>

              <div className="lg:col-span-4 space-y-6">
                 {isNegotiating ? (
                    <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl text-white space-y-6 sticky top-24">
                       <h3 className="text-lg font-black uppercase italic tracking-tighter text-amber-400">Novo Acordo</h3>
                       <div className="p-6 bg-white/5 rounded-3xl border border-white/10 text-center">
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Montante p/ Parcelamento</p>
                          <h4 className="text-4xl font-black italic tracking-tighter text-white">R$ {totalSelectedForAgreement.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h4>
                       </div>
                       <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                             <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Parcelas</label>
                                <input type="number" min="1" value={agreementConfig.parcelas} onChange={e => setAgreementConfig({...agreementConfig, parcelas: parseInt(e.target.value) || 1})} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl font-black text-xs text-center outline-none" />
                             </div>
                             <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-400 uppercase ml-2">1º Vencimento</label>
                                <input type="date" value={agreementConfig.dataPrimeira} onChange={e => setAgreementConfig({...agreementConfig, dataPrimeira: e.target.value})} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl font-black text-[10px] uppercase outline-none" />
                             </div>
                          </div>
                          <div className="space-y-2">
                             <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Frequência de Pagamento</label>
                             <select 
                               value={agreementConfig.frequencia} 
                               onChange={e => setAgreementConfig({...agreementConfig, frequencia: e.target.value as any})} 
                               className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl font-black text-xs uppercase outline-none cursor-pointer hover:bg-white/10 transition-all"
                             >
                                <option value="Mensal" className="text-slate-900">Mensal (30 dias)</option>
                                <option value="Quinzenal" className="text-slate-900">Quinzenal (15 dias)</option>
                                <option value="Semanal" className="text-slate-900">Semanal (7 dias)</option>
                             </select>
                          </div>
                       </div>
                       <button 
                         onClick={() => setIsReviewing(true)} 
                         disabled={selectedForAgreement.length === 0} 
                         className="w-full py-5 bg-blue-600 text-white rounded-[1.5rem] font-black text-[11px] uppercase tracking-widest shadow-xl hover:bg-blue-500 disabled:opacity-30 transition-all italic"
                       >
                         Revisar Condições →
                       </button>
                    </div>
                 ) : isNotarySelection ? (
                    <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl text-white space-y-6 sticky top-24">
                        <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-4">
                           <h3 className="text-lg font-black uppercase italic tracking-tighter text-white">Enviar para Cartório</h3>
                           <button onClick={() => { setIsNotarySelection(false); setSelectedForAgreement([]); }} className="text-[9px] font-black text-red-400 uppercase hover:underline">Cancelar</button>
                        </div>
                        <div className="p-6 bg-white/5 rounded-3xl border border-white/10 text-center">
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Selecionado</p>
                          <h4 className="text-4xl font-black italic tracking-tighter text-white">R$ {totalSelectedForAgreement.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h4>
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-2">{selectedForAgreement.length} Títulos</p>
                       </div>
                       <button 
                         onClick={handleSendToCartorio} 
                         disabled={selectedForAgreement.length === 0 || isSubmittingInteraction} 
                         className="w-full py-5 bg-white text-slate-900 rounded-[1.5rem] font-black text-[11px] uppercase tracking-widest shadow-xl hover:bg-slate-200 disabled:opacity-30 transition-all italic"
                       >
                         {isSubmittingInteraction ? 'Processando...' : 'Confirmar Envio'}
                       </button>
                    </div>
                 ) : isNotaryRemoval ? (
                    <div className="bg-emerald-800 p-8 rounded-[3rem] shadow-2xl text-white space-y-6 sticky top-24 border border-emerald-700">
                        <div className="flex justify-between items-center border-b border-emerald-600 pb-4 mb-4">
                           <h3 className="text-lg font-black uppercase italic tracking-tighter text-white">Retirar de Cartório</h3>
                           <button onClick={() => { setIsNotaryRemoval(false); setSelectedForAgreement([]); }} className="text-[9px] font-black text-emerald-200 uppercase hover:underline">Cancelar</button>
                        </div>
                        <div className="p-6 bg-black/10 rounded-3xl border border-white/10 text-center">
                          <p className="text-[9px] font-black text-emerald-200 uppercase tracking-widest mb-1">Total a Retirar</p>
                          <h4 className="text-4xl font-black italic tracking-tighter text-white">R$ {totalSelectedForAgreement.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h4>
                          <p className="text-[9px] font-black text-emerald-200 uppercase tracking-widest mt-2">{selectedForAgreement.length} Títulos</p>
                       </div>
                       <button 
                         onClick={handleRemoveFromCartorio} 
                         disabled={selectedForAgreement.length === 0 || isSubmittingInteraction} 
                         className="w-full py-5 bg-white text-emerald-800 rounded-[1.5rem] font-black text-[11px] uppercase tracking-widest shadow-xl hover:bg-emerald-50 disabled:opacity-30 transition-all italic"
                       >
                         {isSubmittingInteraction ? 'Processando...' : 'Confirmar Retirada'}
                       </button>
                    </div>
                 ) : (
                    <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl text-white space-y-6 sticky top-24">
                       <h3 className="text-lg font-black uppercase italic tracking-tighter text-blue-400 border-b border-white/10 pb-4 mb-4">Ações Rápidas CRM</h3>
                       
                       <div className="grid grid-cols-2 gap-3">
                          <button onClick={() => handleQuickAction('AGENDAR')} className="p-4 bg-blue-600 hover:bg-blue-500 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all text-center">
                             Agendar Pagamento
                          </button>
                          <button onClick={() => handleQuickAction('RETORNOU')} className="p-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all text-center">
                             Cliente Retornou
                          </button>
                          <button onClick={() => handleQuickAction('SEM_RETORNO')} className="p-4 bg-amber-600 hover:bg-amber-500 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all text-center">
                             Sem Retorno
                          </button>
                          <button onClick={() => handleQuickAction('CARTORIO')} className="p-4 bg-white text-slate-900 hover:bg-slate-200 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all text-center shadow-lg">
                             Enviar p/ Cartório
                          </button>
                          <button onClick={() => handleQuickAction('RETIRAR_CARTORIO')} className="col-span-2 p-3 bg-slate-800 text-slate-400 border border-slate-700 hover:text-white hover:border-slate-500 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all text-center">
                             Retirar do Cartório
                          </button>
                       </div>

                       <div className="h-px bg-white/10 my-2"></div>

                       <form onSubmit={handleAddInteraction} className="space-y-4">
                          <div className="space-y-2">
                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2">Detalhes da Ocorrência</label>
                             <textarea required placeholder="RESUMO..." value={interactionForm.observacao} onChange={e => setInteractionForm({...interactionForm, observacao: e.target.value.toUpperCase()})} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl outline-none font-medium text-xs uppercase h-24 resize-none" />
                          </div>
                          
                          {/* Campo de Data Condicional */}
                          {['Agendamento', 'Retorno', 'Tentativa'].includes(interactionForm.acao) && (
                             <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-2">
                                   {interactionForm.acao === 'Agendamento' ? 'Data da Promessa *' : 'Próximo Contato *'}
                                </label>
                                <input 
                                  type="date" 
                                  required 
                                  min={new Date().toISOString().split('T')[0]}
                                  value={interactionForm.proximaAcao} 
                                  onChange={e => setInteractionForm({...interactionForm, proximaAcao: e.target.value})} 
                                  className="w-full px-4 py-3 bg-blue-600/20 border border-blue-500/50 rounded-2xl outline-none font-black text-xs uppercase text-white" 
                                />
                             </div>
                          )}

                          <button type="submit" disabled={isSubmittingInteraction} className="w-full py-5 bg-blue-600 text-white rounded-[11px] font-black text-[11px] uppercase tracking-widest shadow-xl italic">Registrar Ocorrência</button>
                       </form>
                    </div>
                 )}
              </div>
           </div>
        </div>
      ) : (
        /* VISUALIZAÇÃO E GERENCIAMENTO DE ACORDO */
        <div className="animate-in slide-in-from-bottom-4 duration-500 space-y-8">
           <div className="flex items-center justify-between">
              <button onClick={() => { setViewingSettlement(null); setSettlementDetails(null); }} className="flex items-center gap-2 text-slate-400 hover:text-slate-900 transition-colors font-black text-[10px] uppercase tracking-widest">
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth="3"/></svg>
                 Voltar para Acordos
              </button>
              <div className="flex items-center gap-3">
                 {viewingSettlement.status === 'ATIVO' && (
                    <div className="flex gap-2">
                       {allInstallmentsPaid && (
                         <button 
                            onClick={handleFinalizarAcordoTotal}
                            disabled={isSubmittingInteraction}
                            className="px-8 py-2 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg border border-emerald-500 animate-bounce italic"
                         >
                            Finalizar e Liquidar Acordo
                         </button>
                       )}
                       <button 
                         onClick={handleExcluirAcordo}
                         disabled={isSubmittingInteraction}
                         className="px-6 py-2 bg-red-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-700 transition-all shadow-md italic"
                       >
                          Excluir (Permanentemente)
                       </button>
                    </div>
                 )}
                 <span className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border ${viewingSettlement.status === 'ATIVO' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : viewingSettlement.status === 'LIQUIDADO' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                    Contrato {viewingSettlement.status}
                 </span>
              </div>
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
              <div className="lg:col-span-8 space-y-8">
                 <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                    <p className="text-[8px] font-black text-blue-600 uppercase tracking-widest mb-1">Contrato #{viewingSettlement.id}</p>
                    <h2 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter mb-8 leading-none">{viewingSettlement.cliente}</h2>
                    
                    <div className="space-y-6">
                       <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Cronograma de Parcelas</h4>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {settlementDetails?.installments.map((inst, i) => (
                             <div key={inst.id} className={`p-5 border rounded-2xl flex justify-between items-center group transition-all shadow-sm ${inst.situacao === 'PAGO' ? 'bg-slate-50 border-slate-100' : 'bg-white border-blue-100 hover:border-blue-400'}`}>
                                <div>
                                   <p className="text-[10px] font-black text-slate-400 uppercase">PARC {i+1}</p>
                                   <p className="font-black text-slate-900 text-xs italic">Vencimento: {inst.data_vencimento?.split('-').reverse().join('/')}</p>
                                   {inst.situacao === 'PAGO' && (
                                     <p className="text-[8px] font-bold text-emerald-600 uppercase mt-1">Pago via {inst.meio_recebimento} em {inst.data_liquidacao?.split('-').reverse().join('/')}</p>
                                   )}
                                </div>
                                <div className="text-right flex flex-col items-end gap-2">
                                   <p className="font-black text-slate-900 text-xs">R$ {inst.valor_documento.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                                   {inst.situacao === 'ABERTO' && viewingSettlement.status === 'ATIVO' ? (
                                      liquidatingInstallment === inst.id ? (
                                        <div className="flex flex-col gap-2 items-end animate-in fade-in duration-300 bg-slate-50 p-3 rounded-xl border border-blue-100">
                                          <div className="space-y-1">
                                             <label className="text-[8px] font-black text-slate-400 uppercase">Data do Pagamento PIX</label>
                                             <input 
                                               type="date" 
                                               value={liquidationForm.data} 
                                               onChange={e => setLiquidationForm({...liquidationForm, data: e.target.value})}
                                               className="w-full text-[10px] border border-blue-200 rounded p-1.5 outline-none font-bold"
                                             />
                                          </div>
                                          <div className="flex gap-2">
                                             <button onClick={() => setLiquidatingInstallment(null)} className="text-[9px] font-black text-slate-400 hover:text-slate-600 transition-colors uppercase">Cancelar</button>
                                             <button onClick={() => handleBaixarParcela(inst.id)} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase hover:bg-blue-700 shadow-sm transition-all">Baixar Agora</button>
                                          </div>
                                        </div>
                                      ) : (
                                        <button 
                                          onClick={() => setLiquidatingInstallment(inst.id)}
                                          className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-blue-700 shadow-md transition-all active:scale-95 italic"
                                        >
                                          Baixar Parcela
                                        </button>
                                      )
                                   ) : (
                                     <span className={`text-[7px] font-black uppercase ${inst.situacao === 'PAGO' ? 'text-emerald-500' : inst.situacao === 'CANCELADO' ? 'text-red-500' : 'text-amber-500 animate-pulse'}`}>{inst.situacao}</span>
                                   )}
                                </div>
                             </div>
                          ))}
                       </div>
                    </div>
                 </div>

                 <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic mb-6">Títulos Originais Bloqueados</h4>
                    <div className="space-y-3">
                       {settlementDetails?.originals.map(orig => (
                          <div key={orig.id} className="flex justify-between items-center p-4 bg-slate-50/50 border border-dashed border-slate-200 rounded-2xl text-[10px] font-bold text-slate-500">
                             <div className="flex gap-4">
                                <span className="text-blue-600">ID #{orig.id}</span>
                                <span className="text-slate-900 uppercase">DOC: {orig.numero_documento}</span>
                             </div>
                             <div className="flex gap-4 items-center">
                                <span>R$ {orig.valor_documento.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                                {orig.statusCobranca === 'BLOQUEADO_CARTORIO' ? (
                                   <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-slate-900 text-white">EM CARTÓRIO</span>
                                ) : (
                                   <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${orig.situacao === 'LIQUIDADO' ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-white'}`}>
                                     {orig.situacao === 'LIQUIDADO' ? 'LIQUIDADO' : 'Bloqueado'}
                                   </span>
                                )}
                             </div>
                          </div>
                       ))}
                    </div>
                 </div>
              </div>

              <div className="lg:col-span-4">
                 <div className="bg-slate-900 p-8 rounded-[3rem] text-white space-y-8 sticky top-24 shadow-2xl">
                    <div>
                       <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">Montante Negociado</p>
                       <h4 className="text-2xl font-black italic tracking-tighter text-white">
                          R$ {viewingSettlement.valorAcordo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                       </h4>
                    </div>
                    <div className="h-px bg-white/10"></div>
                    <div className="grid grid-cols-2 gap-6">
                       <div>
                          <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Criado em</p>
                          <p className="text-[10px] font-bold italic">{new Date(viewingSettlement.dataCriacao).toLocaleDateString('pt-BR')}</p>
                       </div>
                       <div>
                          <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Frequência</p>
                          <p className="text-[10px] font-bold italic uppercase">{viewingSettlement.frequencia}</p>
                       </div>
                    </div>
                    <div className="bg-white/5 p-5 rounded-2xl border border-white/10">
                       <p className="text-[8px] font-black text-amber-400 uppercase mb-2 italic">Histórico de Observações</p>
                       <p className="text-[10px] font-medium leading-relaxed italic opacity-80 uppercase">"{viewingSettlement.observacao || 'SEM NOTAS ADICIONAIS'}"</p>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* --- TELA DE REVISÃO DE ACORDO (MODAL OVERLAY) --- */}
      {isReviewing && (
         <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-[300] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="bg-white max-w-5xl w-full rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col h-[90vh]">
               <div className="p-10 border-b border-slate-100 flex justify-between items-center bg-slate-50/30 shrink-0">
                  <div>
                     <h3 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter">Revisão de Acordo</h3>
                     <p className="text-blue-600 font-bold text-[10px] uppercase tracking-widest mt-1">Confirme as condições antes da efetivação</p>
                  </div>
                  <button onClick={() => setIsReviewing(false)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all"><ICONS.Add className="w-6 h-6 rotate-45" /></button>
               </div>

               <div className="flex-1 overflow-auto p-10 space-y-10 custom-scrollbar">
                  {/* Resumo Financeiro */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                     <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Devedor</p>
                        <p className="text-xl font-black text-slate-900 uppercase italic leading-none">{selectedClient}</p>
                     </div>
                     <div className="bg-blue-50 p-8 rounded-[2.5rem] border border-blue-100">
                        <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">Montante Original</p>
                        <p className="text-xl font-black text-blue-700 italic leading-none">R$ {totalSelectedForAgreement.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                     </div>
                     <div className="bg-emerald-50 p-8 rounded-[2.5rem] border border-emerald-100">
                        <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-1">Valor Acordado</p>
                        <p className="text-2xl font-black text-emerald-700 italic leading-none">R$ {(agreementConfig.valorNegociado || totalSelectedForAgreement).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                     </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                     {/* Projeção de Parcelas */}
                     <div className="space-y-6">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                           <div className="w-1 h-4 bg-blue-600 rounded-full"></div>
                           Cronograma de Pagamento ({agreementConfig.frequencia})
                        </h4>
                        <div className="space-y-3">
                           {projectedInstallments.map(p => (
                              <div key={p.num} className="flex justify-between items-center p-4 bg-slate-50/50 border border-slate-100 rounded-2xl">
                                 <span className="text-[10px] font-black text-slate-400">PARCELA {p.num}</span>
                                 <span className="text-[11px] font-bold text-slate-900">{p.date.split('-').reverse().join('/')}</span>
                                 <span className="text-[12px] font-black text-emerald-600 italic">R$ {p.value.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                              </div>
                           ))}
                        </div>
                     </div>

                     {/* Títulos Bloqueados */}
                     <div className="space-y-6">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                           <div className="w-1 h-4 bg-red-600 rounded-full"></div>
                           Títulos Originais a Bloquear
                        </h4>
                        <div className="space-y-3">
                           {clientTitles.filter(t => selectedForAgreement.includes(t.id)).map(t => (
                              <div key={t.id} className="p-4 border border-dashed border-slate-200 rounded-2xl flex justify-between items-center opacity-70">
                                 <div className="flex gap-3 items-center">
                                    <span className="text-[9px] font-black text-slate-400">DOC: {t.numero_documento || t.id}</span>
                                 </div>
                                 <span className="text-[10px] font-bold text-slate-600">R$ {(t.valor_documento || t.saldo).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                              </div>
                           ))}
                        </div>
                        <div className="bg-amber-50 p-6 rounded-[2rem] border border-amber-100 text-[10px] text-amber-700 font-medium leading-relaxed italic">
                           Atenção: Ao confirmar, estes títulos originais serão marcados como "NEGOCIADO" e terão o saldo zerado para não haver cobrança duplicada.
                        </div>
                     </div>
                  </div>
               </div>

               <div className="p-10 border-t border-slate-100 bg-slate-50/30 flex justify-end gap-6 shrink-0">
                  <button onClick={() => setIsReviewing(false)} className="px-8 py-5 text-slate-500 font-black text-[11px] uppercase tracking-widest italic hover:text-slate-900 transition-colors">Voltar para Ajustar</button>
                  <button 
                    onClick={handleEfetivarAcordo} 
                    disabled={isSubmittingInteraction}
                    className="px-12 py-5 bg-emerald-600 text-white rounded-[1.5rem] font-black text-[11px] uppercase tracking-widest shadow-2xl hover:bg-emerald-500 transition-all italic active:scale-95"
                  >
                    {isSubmittingInteraction ? 'Processando...' : 'Confirmar e Efetivar Acordo'}
                  </button>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};

export default DebtorCollectionModule;