
import React, { useState, useEffect, useMemo } from 'react';
import { HRService } from '../services/hrService';
import { DataService } from '../services/dataService';
import { PayrollRun, PayrollItem, User, CompanySettings } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import { jsPDF } from 'jspdf';

interface HRServiceOrdersModuleProps {
  currentUser: User;
}

const HRServiceOrdersModule: React.FC<HRServiceOrdersModuleProps> = ({ currentUser }) => {
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [orderList, setOrderList] = useState<PayrollRun[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PayrollRun | null>(null);
  const [modalItems, setModalItems] = useState<PayrollItem[]>([]);

  // Novo estado para configuração de pagamentos
  const [paymentConfig, setPaymentConfig] = useState({
    installments: 1,
    frequency: 'MENSAL', // 'SEMANAL', 'QUINZENAL', 'MENSAL'
    startDate: new Date().toISOString().split('T')[0]
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const referenceDate = `${selectedMonth}-01`;
      const [orderData, companyData] = await Promise.all([
        HRService.getServiceOrderList(referenceDate),
        DataService.getCompanySettings()
      ]);
      setOrderList(orderData);
      setCompanySettings(companyData);
    } catch (e) {
      setToast({ msg: 'Erro ao carregar dados.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedMonth]);

  const summary = useMemo(() => {
    return orderList.reduce((acc, curr) => ({
      totalBruto: acc.totalBruto + (curr.totalEarnings || 0),
      totalLiquido: acc.totalLiquido + (curr.netSalary || 0),
      pendentes: acc.pendentes + (curr.status === 'DRAFT' ? 1 : 0)
    }), { totalBruto: 0, totalLiquido: 0, pendentes: 0 });
  }, [orderList]);

  const handleOpenModal = async (run: PayrollRun) => {
    setIsProcessing(true);
    try {
      let itemsToLoad: PayrollItem[] = [];
      let runDetails = run;

      if (run.id) {
        const details = await HRService.getPayrollDetails(run.id);
        if (details) {
          runDetails = details;
          itemsToLoad = details.items || [];
        }
      } 
      
      if (itemsToLoad.length === 0) {
         if (run.items && run.items.length > 0) {
            itemsToLoad = [...run.items];
         } else if (run.baseSalary > 0) {
            itemsToLoad.push({
              description: 'HONORÁRIOS CONTRATUAIS',
              type: 'EARNING',
              amount: run.baseSalary,
              referenceValue: 'MENSAL'
            });
         }
      }

      setEditingOrder(runDetails);
      setModalItems(itemsToLoad);
      
      // Tenta recuperar a configuração de pagamento salva no campo notes
      let loadedConfig = {
        installments: 1,
        frequency: 'MENSAL',
        startDate: new Date().toISOString().split('T')[0]
      };

      if (runDetails.notes) {
        try {
          const parsed = JSON.parse(runDetails.notes);
          // Validação básica para garantir que é um config de pagamento
          if (parsed.installments && parsed.frequency && parsed.startDate) {
            loadedConfig = parsed;
          }
        } catch (e) {
          // Se não for JSON válido (ex: nota de texto antiga), mantém o default
          console.log('Notes não é um JSON de configuração válido');
        }
      }

      setPaymentConfig(loadedConfig);
      setShowModal(true);
    } catch (error) {
      console.error(error);
      setToast({ msg: 'Erro ao carregar detalhes.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddItem = (type: 'EARNING' | 'DEDUCTION') => {
    setModalItems([...modalItems, {
      description: type === 'EARNING' ? 'SERVIÇO ADICIONAL' : 'RETENÇÃO TRIBUTÁRIA',
      type,
      amount: 0,
      referenceValue: ''
    }]);
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...modalItems];
    newItems.splice(index, 1);
    setModalItems(newItems);
  };

  const handleUpdateItem = (index: number, field: keyof PayrollItem, value: string | number) => {
    const newItems = [...modalItems];
    // @ts-ignore
    newItems[index][field] = value;
    setModalItems(newItems);
  };

  const modalTotals = useMemo(() => {
    const earnings = modalItems.filter(i => i.type === 'EARNING').reduce((a, b) => a + Number(b.amount), 0);
    const deductions = modalItems.filter(i => i.type === 'DEDUCTION').reduce((a, b) => a + Number(b.amount), 0);
    return {
      earnings,
      deductions,
      net: earnings - deductions
    };
  }, [modalItems]);

  // Cálculo do Cronograma de Pagamento
  const paymentSchedule = useMemo(() => {
    const schedule = [];
    const count = Math.max(1, paymentConfig.installments);
    const amountPerInstallment = modalTotals.net / count;
    
    let currentDate = new Date(paymentConfig.startDate);
    // Ajuste fuso horário simples para visualização correta
    currentDate.setMinutes(currentDate.getMinutes() + currentDate.getTimezoneOffset());

    for (let i = 0; i < count; i++) {
      schedule.push({
        number: i + 1,
        date: currentDate.toISOString().split('T')[0],
        amount: amountPerInstallment
      });

      // Incrementa data
      if (paymentConfig.frequency === 'SEMANAL') {
        currentDate.setDate(currentDate.getDate() + 7);
      } else if (paymentConfig.frequency === 'QUINZENAL') {
        currentDate.setDate(currentDate.getDate() + 15);
      } else {
        // Mensal
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    }
    return schedule;
  }, [modalTotals.net, paymentConfig]);

  const handleSaveCalculation = async () => {
    if (!editingOrder) return;
    setIsProcessing(true);

    // Serializa a configuração de pagamento para salvar no campo notes
    const paymentConfigString = JSON.stringify(paymentConfig);

    const updatedRun: PayrollRun = {
      ...editingOrder,
      items: modalItems,
      totalEarnings: modalTotals.earnings,
      totalDeductions: modalTotals.deductions,
      netSalary: modalTotals.net,
      status: 'CLOSED',
      paymentDate: new Date().toISOString().split('T')[0],
      notes: paymentConfigString // Salvando a configuração aqui
    };

    try {
      const res = await HRService.savePayroll(updatedRun);
      if (res.success) {
        setToast({ msg: 'Ordem de serviço salva com sucesso!', type: 'success' });
        setShowModal(false);
        fetchData();
      } else {
        setToast({ msg: 'Erro ao salvar OS.', type: 'error' });
      }
    } catch (e) {
      setToast({ msg: 'Erro de conexão.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // --- GERAÇÃO DE PDF RECIBO PJ ---
  const generateReceipt = () => {
    if (!editingOrder) return;
    
    const doc = new jsPDF();
    const pageWidth = 210;
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    
    const fmtMoney = (val: number) => val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDate = (d: string) => d.split('-').reverse().join('/');

    let y = 20;

    // Cabeçalho Simples
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('RECIBO DE PRESTAÇÃO DE SERVIÇOS', pageWidth / 2, y, { align: 'center' });
    
    y += 10;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`COMPETÊNCIA: ${selectedMonth}`, pageWidth / 2, y, { align: 'center' });

    y += 20;

    // Dados da Contratante (Sua Empresa)
    doc.setDrawColor(0);
    doc.rect(margin, y, contentWidth, 25); 
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('TOMADOR DE SERVIÇOS (CONTRATANTE):', margin + 5, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.text(companySettings?.name || 'EMPRESA CONTRATANTE', margin + 5, y + 12);
    doc.text(`CNPJ: ${companySettings?.cnpj || '00.000.000/0000-00'}`, margin + 5, y + 17);
    doc.text(companySettings?.address || 'ENDEREÇO COMERCIAL', margin + 5, y + 22);

    y += 35;

    // Dados do Prestador (PJ)
    doc.rect(margin, y, contentWidth, 20);
    doc.setFont('helvetica', 'bold');
    doc.text('PRESTADOR DE SERVIÇOS (CONTRATADO):', margin + 5, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.text(editingOrder.employeeName?.toUpperCase() || 'PRESTADOR PJ', margin + 5, y + 12);
    doc.text(`FUNÇÃO/OBJETO: ${editingOrder.employeeRole?.toUpperCase() || 'SERVIÇOS PRESTADOS'}`, margin + 5, y + 17);

    y += 30;

    // Tabela de Serviços
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('DISCRIMINAÇÃO DOS SERVIÇOS E VALORES', margin, y);
    y += 5;

    // Linha simples de separação superior
    doc.line(margin, y, pageWidth - margin, y);
    
    doc.setFontSize(9);
    doc.text('DESCRIÇÃO', margin + 5, y + 5);
    doc.text('REF.', 140, y + 5);
    doc.text('VALOR (R$)', 180, y + 5);

    // Linha simples de separação inferior do cabeçalho
    doc.line(margin, y + 8, pageWidth - margin, y + 8);

    y += 14; 
    doc.setFont('helvetica', 'normal');

    modalItems.forEach((item) => {
        doc.text(item.description.toUpperCase(), margin + 5, y);
        doc.text(item.referenceValue || '-', 140, y);
        
        const valStr = fmtMoney(Number(item.amount));
        const prefix = item.type === 'DEDUCTION' ? '-' : '';
        doc.text(`${prefix} ${valStr}`, 180, y);
        
        y += 6;
    });

    y += 5;
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    // Totais
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('VALOR BRUTO:', 130, y);
    doc.text(fmtMoney(modalTotals.earnings), 180, y);
    
    y += 6;
    doc.text('RETENÇÕES:', 130, y);
    doc.text(fmtMoney(modalTotals.deductions), 180, y);

    y += 10;
    
    // Adicionado linha de destaque simples
    doc.line(125, y - 6, 195, y - 6);
    doc.line(125, y + 4, 195, y + 4);

    doc.setFontSize(12);
    doc.text('LÍQUIDO A PAGAR:', 130, y);
    doc.text(fmtMoney(modalTotals.net), 180, y);

    y += 20;

    // --- NOVA SEÇÃO: CRONOGRAMA DE PAGAMENTO NO PDF ---
    if (paymentSchedule.length > 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('CRONOGRAMA DE PAGAMENTO (PREVISÃO)', margin, y);
        y += 5;
        doc.line(margin, y, pageWidth - margin, y);
        y += 5;

        doc.setFontSize(8);
        doc.text('PARCELA', margin + 5, y);
        doc.text('VENCIMENTO', margin + 40, y);
        doc.text('VALOR (R$)', margin + 80, y);
        y += 5;

        doc.setFont('helvetica', 'normal');
        paymentSchedule.forEach(sch => {
            doc.text(`${sch.number}/${paymentConfig.installments}`, margin + 5, y);
            doc.text(fmtDate(sch.date), margin + 40, y);
            doc.text(fmtMoney(sch.amount), margin + 80, y);
            y += 4;
        });
        y += 5;
    }

    y += 15;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Recebi(emos) a importância líquida acima discriminada como pagamento pelos serviços prestados no período, dando plena e rasa quitação.', margin, y, { maxWidth: contentWidth });

    y += 30;
    doc.line(pageWidth / 2 - 40, y, pageWidth / 2 + 40, y);
    doc.text('ASSINATURA DO PRESTADOR', pageWidth / 2, y + 5, { align: 'center' });
    doc.text(`DATA: ____/____/_______`, pageWidth / 2, y + 10, { align: 'center' });

    doc.save(`RECIBO_PJ_${editingOrder.employeeName?.replace(/[^a-zA-Z0-9]/g, '_')}_${selectedMonth}.pdf`);
    setToast({ msg: 'Recibo gerado com sucesso!', type: 'success' });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Contratos PJ</h2>
          <p className="text-[10px] font-black text-purple-600 uppercase tracking-[0.4em] mt-3 italic">Processamento de Ordens de Serviço</p>
        </div>
        
        <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
           <div className="px-4 py-2 border-r border-slate-100">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Competência</p>
              <input 
                type="month" 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent font-black text-slate-900 outline-none text-sm uppercase cursor-pointer"
              />
           </div>
           <div className="px-4 text-center">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Status OS</p>
              <span className={`text-[10px] font-black uppercase ${summary.pendentes > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                 {summary.pendentes > 0 ? 'Em Aberto' : 'Finalizado'}
              </span>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm group hover:border-purple-200 transition-all">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Serviços (Bruto)</p>
            <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter">
               R$ {summary.totalBruto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
            </h3>
         </div>
         <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -mr-10 -mt-10"></div>
            <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-1">Total a Pagar (Líquido)</p>
            <h3 className="text-3xl font-black italic tracking-tighter">
               R$ {summary.totalLiquido.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
            </h3>
         </div>
         <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between">
            <div>
               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Contratos Ativos</p>
               <h3 className="text-3xl font-black text-slate-900 italic tracking-tighter">
                  {orderList.length} <span className="text-sm text-slate-400 not-italic">Prestadores</span>
               </h3>
            </div>
         </div>
      </div>

      <div className="table-container bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
         {loading ? (
            <div className="py-32 text-center opacity-30 font-black uppercase text-[10px] tracking-[0.3em] animate-pulse">Carregando Contratos...</div>
         ) : (
            <table className="w-full">
               <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest">
                  <tr>
                     <th className="px-8 py-5 text-left">Prestador</th>
                     <th className="px-8 py-5 text-left">Objeto do Contrato</th>
                     <th className="px-8 py-5 text-right">Valor Contrato</th>
                     <th className="px-8 py-5 text-center">Status OS</th>
                     <th className="px-8 py-5 text-right">Valor Líquido</th>
                     <th className="px-8 py-5 text-right">Ação</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50">
                  {orderList.map(run => (
                     <tr key={run.employeeId} className="hover:bg-slate-50/80 transition-all group">
                        <td className="px-8 py-5">
                           <p className="font-black text-slate-900 text-xs uppercase">{run.employeeName}</p>
                           <p className="text-[9px] font-bold text-slate-400 mt-0.5">ID: {run.employeeId.substring(0,6)}</p>
                        </td>
                        <td className="px-8 py-5 text-[10px] font-bold text-slate-500 uppercase">
                           {run.employeeRole}
                        </td>
                        <td className="px-8 py-5 text-right text-[11px] font-bold text-slate-600">
                           R$ {run.baseSalary.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                        </td>
                        <td className="px-8 py-5 text-center">
                           <span className={`px-3 py-1 rounded-xl text-[8px] font-black uppercase border ${
                              run.status === 'CLOSED' 
                              ? 'bg-purple-50 text-purple-600 border-purple-100' 
                              : 'bg-slate-100 text-slate-400 border-slate-200'
                           }`}>
                              {run.status === 'CLOSED' ? 'PROCESSADO' : 'PENDENTE'}
                           </span>
                        </td>
                        <td className="px-8 py-5 text-right">
                           <span className={`text-sm font-black italic ${run.netSalary > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                              R$ {run.netSalary.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                           </span>
                        </td>
                        <td className="px-8 py-5 text-right">
                           <button 
                              onClick={() => handleOpenModal(run)}
                              className={`px-6 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                                 run.status === 'CLOSED' 
                                 ? 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50' 
                                 : 'bg-slate-900 text-white shadow-lg hover:bg-purple-600'
                              }`}
                           >
                              {run.status === 'CLOSED' ? 'Visualizar' : 'Processar OS'}
                           </button>
                        </td>
                     </tr>
                  ))}
                  {orderList.length === 0 && (
                     <tr><td colSpan={6} className="py-20 text-center text-slate-300 font-bold text-xs uppercase">Nenhum contrato PJ ativo encontrado</td></tr>
                  )}
               </tbody>
            </table>
         )}
      </div>

      {/* MODAL OS PJ */}
      {showModal && editingOrder && (
         <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in zoom-in-95 duration-300">
            <div className="bg-white w-full max-w-7xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col h-[90vh] border border-slate-200">
               <div className="px-10 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
                  <div>
                     <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter">Ordem de Serviço (PJ)</h3>
                     <p className="text-[10px] font-black text-purple-600 uppercase tracking-widest mt-1">
                        {editingOrder.employeeName} • REF: {selectedMonth}
                     </p>
                  </div>
                  <button onClick={() => setShowModal(false)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all">
                     <ICONS.Add className="w-6 h-6 rotate-45" />
                  </button>
               </div>

               <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 bg-slate-50/30">
                  {/* Dados Contratuais e Pagamento */}
                  <div className="lg:col-span-3 space-y-6">
                     <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 border-b border-slate-100 pb-2">Dados do Contrato</h4>
                        <div className="space-y-4">
                           <div>
                              <p className="text-[9px] font-bold text-slate-400 uppercase">Valor Contratual</p>
                              <p className="text-lg font-black text-slate-900">R$ {editingOrder.baseSalary.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                           </div>
                           <div>
                              <p className="text-[9px] font-bold text-slate-400 uppercase">Período</p>
                              <p className="text-sm font-bold text-slate-700">{selectedMonth}</p>
                           </div>
                        </div>
                     </div>

                     {/* Nova Seção: Programação de Pagamento */}
                     <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl text-white">
                        <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-4 border-b border-white/10 pb-2">Programação de Pagamento</h4>
                        <div className="space-y-4">
                           <div className="grid grid-cols-2 gap-3">
                              <div>
                                 <label className="text-[8px] font-bold text-slate-400 uppercase">Parcelas</label>
                                 <input 
                                    type="number" 
                                    min="1" 
                                    value={paymentConfig.installments} 
                                    onChange={(e) => setPaymentConfig({...paymentConfig, installments: parseInt(e.target.value) || 1})}
                                    className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-xs font-black text-white outline-none focus:border-blue-500"
                                 />
                              </div>
                              <div>
                                 <label className="text-[8px] font-bold text-slate-400 uppercase">Frequência</label>
                                 <select 
                                    value={paymentConfig.frequency} 
                                    onChange={(e) => setPaymentConfig({...paymentConfig, frequency: e.target.value})}
                                    className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-[10px] font-black text-white outline-none focus:border-blue-500"
                                 >
                                    <option value="SEMANAL" className="text-slate-900">SEMANAL</option>
                                    <option value="QUINZENAL" className="text-slate-900">QUINZENAL</option>
                                    <option value="MENSAL" className="text-slate-900">MENSAL</option>
                                 </select>
                              </div>
                           </div>
                           <div>
                              <label className="text-[8px] font-bold text-slate-400 uppercase">1ª Data</label>
                              <input 
                                 type="date" 
                                 value={paymentConfig.startDate} 
                                 onChange={(e) => setPaymentConfig({...paymentConfig, startDate: e.target.value})}
                                 className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-[10px] font-black text-white outline-none focus:border-blue-500 uppercase"
                              />
                           </div>
                           
                           {/* Lista de Datas Geradas */}
                           <div className="mt-4 bg-white/5 rounded-xl p-3 max-h-40 overflow-y-auto custom-scrollbar">
                              <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest mb-2">Previsão</p>
                              {paymentSchedule.map((sch, idx) => (
                                 <div key={idx} className="flex justify-between items-center text-[9px] py-1 border-b border-white/5 last:border-0">
                                    <span className="text-slate-300">{idx + 1}x {sch.date.split('-').reverse().join('/')}</span>
                                    <span className="text-white font-bold">R$ {sch.amount.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                                 </div>
                              ))}
                           </div>
                        </div>
                     </div>
                  </div>

                  {/* Itens */}
                  <div className="lg:col-span-6 space-y-6">
                     <div className="bg-white p-6 rounded-[2.5rem] border border-emerald-100 shadow-sm">
                        <div className="flex justify-between items-center mb-6">
                           <h4 className="text-[11px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                              Serviços / Honorários
                           </h4>
                           <button onClick={() => handleAddItem('EARNING')} className="px-4 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl text-[9px] font-black uppercase hover:bg-emerald-100 transition-all">+ Adicionar</button>
                        </div>
                        <div className="space-y-3">
                           {modalItems.filter(i => i.type === 'EARNING').map((item, idx) => {
                              const globalIdx = modalItems.indexOf(item);
                              return (
                                 <div key={globalIdx} className="flex gap-3 items-center">
                                    <input 
                                       value={item.description}
                                       onChange={(e) => handleUpdateItem(globalIdx, 'description', e.target.value.toUpperCase())}
                                       className="flex-[3] bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[10px] font-black uppercase outline-none focus:border-emerald-500"
                                       placeholder="DESCRIÇÃO SERVIÇO"
                                    />
                                    <div className="relative w-32">
                                       <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-emerald-600">R$</span>
                                       <input 
                                          type="number"
                                          value={item.amount}
                                          onChange={(e) => handleUpdateItem(globalIdx, 'amount', parseFloat(e.target.value))}
                                          className="w-full bg-emerald-50/50 border border-emerald-100 rounded-xl pl-8 pr-3 py-3 text-[11px] font-black text-right text-emerald-700 outline-none focus:border-emerald-500"
                                       />
                                    </div>
                                    <button onClick={() => handleRemoveItem(globalIdx)} className="text-slate-300 hover:text-red-500 p-2"><ICONS.Add className="w-4 h-4 rotate-45" /></button>
                                 </div>
                              );
                           })}
                        </div>
                     </div>

                     <div className="bg-white p-6 rounded-[2.5rem] border border-red-100 shadow-sm">
                        <div className="flex justify-between items-center mb-6">
                           <h4 className="text-[11px] font-black text-red-500 uppercase tracking-widest flex items-center gap-2">
                              Retenções / Descontos
                           </h4>
                           <button onClick={() => handleAddItem('DEDUCTION')} className="px-4 py-1.5 bg-red-50 text-red-700 rounded-xl text-[9px] font-black uppercase hover:bg-red-100 transition-all">+ Adicionar</button>
                        </div>
                        <div className="space-y-3">
                           {modalItems.filter(i => i.type === 'DEDUCTION').map((item, idx) => {
                              const globalIdx = modalItems.indexOf(item);
                              return (
                                 <div key={globalIdx} className="flex gap-3 items-center">
                                    <input 
                                       value={item.description}
                                       onChange={(e) => handleUpdateItem(globalIdx, 'description', e.target.value.toUpperCase())}
                                       className="flex-[3] bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[10px] font-black uppercase outline-none focus:border-red-500"
                                       placeholder="DESCRIÇÃO RETENÇÃO"
                                    />
                                    <div className="relative w-32">
                                       <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-red-600">R$</span>
                                       <input 
                                          type="number"
                                          value={item.amount}
                                          onChange={(e) => handleUpdateItem(globalIdx, 'amount', parseFloat(e.target.value))}
                                          className="w-full bg-red-50/50 border border-red-100 rounded-xl pl-8 pr-3 py-3 text-[11px] font-black text-right text-red-700 outline-none focus:border-red-500"
                                       />
                                    </div>
                                    <button onClick={() => handleRemoveItem(globalIdx)} className="text-slate-300 hover:text-red-500 p-2"><ICONS.Add className="w-4 h-4 rotate-45" /></button>
                                 </div>
                              );
                           })}
                        </div>
                     </div>
                  </div>

                  {/* Resumo */}
                  <div className="lg:col-span-3">
                     <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-2xl sticky top-0">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 border-b border-white/10 pb-4">Resumo da OS</h4>
                        
                        <div className="space-y-4 mb-8">
                           <div className="flex justify-between items-center text-emerald-400">
                              <span className="text-[9px] font-bold uppercase">Total Serviços</span>
                              <span className="text-sm font-black">+ {modalTotals.earnings.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                           </div>
                           <div className="flex justify-between items-center text-red-400">
                              <span className="text-[9px] font-bold uppercase">Total Retenções</span>
                              <span className="text-sm font-black">- {modalTotals.deductions.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                           </div>
                        </div>

                        <div className="pt-6 border-t border-white/20">
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Líquido a Pagar</p>
                           {/* Ajuste Visual: Fonte Reduzida para evitar quebra */}
                           <p className="text-2xl lg:text-3xl font-black italic tracking-tighter text-white">
                              R$ {modalTotals.net.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                           </p>
                        </div>
                     </div>
                  </div>
               </div>

               <div className="px-10 py-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-4 shrink-0">
                  {editingOrder.status === 'CLOSED' && (
                     <button 
                        onClick={generateReceipt}
                        className="px-8 py-4 bg-white border border-slate-200 text-slate-600 rounded-[1.5rem] font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-all flex items-center gap-2 italic"
                     >
                        <ICONS.Finance className="w-4 h-4" />
                        Gerar Recibo PDF
                     </button>
                  )}
                  <button 
                     onClick={handleSaveCalculation}
                     disabled={isProcessing}
                     className="px-12 py-4 bg-purple-600 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-purple-500 transition-all active:scale-95 disabled:opacity-50 italic"
                  >
                     {isProcessing ? 'Salvando...' : 'Salvar OS'}
                  </button>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};

export default HRServiceOrdersModule;
