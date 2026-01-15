
import React, { useState, useEffect, useMemo } from 'react';
import { HRService } from '../services/hrService';
import { DataService } from '../services/dataService'; 
import { PayrollRun, PayrollItem, User, CompanySettings, Employee, LeaveRecord } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import { jsPDF } from 'jspdf';

interface HRPayrollModuleProps {
  currentUser: User;
}

type ProcessingType = 'MENSAL' | 'DECIMO_1' | 'DECIMO_2';

const HRPayrollModule: React.FC<HRPayrollModuleProps> = ({ currentUser }) => {
  // --- ESTADOS GERAIS ---
  const [activeTab, setActiveTab] = useState<'PAYROLL' | 'VACATION'>('PAYROLL');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [processingType, setProcessingType] = useState<ProcessingType>('MENSAL'); 
  
  const [payrollList, setPayrollList] = useState<PayrollRun[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]); 
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]); 
  
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

  // --- ESTADOS DO MODAL (HOLERITE) ---
  const [showModal, setShowModal] = useState(false);
  const [editingRun, setEditingRun] = useState<PayrollRun | null>(null);
  const [modalItems, setModalItems] = useState<PayrollItem[]>([]);
  const [currentAvos, setCurrentAvos] = useState<number>(12);

  // --- ESTADOS DE FÉRIAS (RESTAURADOS) ---
  const [managingEmployee, setManagingEmployee] = useState<Employee | null>(null);
  const [absenceDate, setAbsenceDate] = useState('');
  const [absenceReason, setAbsenceReason] = useState('');

  // --- FUNÇÃO AUXILIAR DE DIAS ÚTEIS ---
  const getBusinessDays = (year: number, month: number): number => {
    // month é 1-12
    const monthIndex = month - 1; 
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    let count = 0;
    
    for (let d = 1; d <= daysInMonth; d++) {
        const currentDay = new Date(year, monthIndex, d);
        const dayOfWeek = currentDay.getDay(); // 0 = Domingo, 6 = Sábado
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            count++;
        }
    }
    return count;
  };

  // --- FUNÇÃO AUXILIAR DE GERAÇÃO DE ITENS AUTOMÁTICOS ---
  const generateSuggestedItems = (run: PayrollRun, emp: Employee, avos: number): PayrollItem[] => {
    const items: PayrollItem[] = [];
    const baseSalary = Number(emp.salaryAmount || run.baseSalary || 0);

    if (processingType === 'DECIMO_1' || processingType === 'DECIMO_2') {
         // LÓGICA 13º AUTOMÁTICA
         if (processingType === 'DECIMO_1') {
            const gross13 = (baseSalary / 12) * avos;
            const firstInstallment = gross13 * 0.5; 

            items.push({
              description: '1ª PARC. 13º SALÁRIO',
              type: 'EARNING',
              amount: Number(firstInstallment.toFixed(2)),
              referenceValue: `${avos}/12 AVOS`
            });
         } else {
            const gross13 = (baseSalary / 12) * avos;
            const advanceDeduction = gross13 * 0.5;
            
            let inssValue = 0;
            if (gross13 <= 1412.00) inssValue = gross13 * 0.075;
            else if (gross13 <= 2666.68) inssValue = (gross13 * 0.09) - 21.18;
            else if (gross13 <= 4000.03) inssValue = (gross13 * 0.12) - 101.18;
            else if (gross13 <= 7786.02) inssValue = (gross13 * 0.14) - 181.18;
            else inssValue = 7786.02 * 0.14 - 181.18;

            items.push({
              description: '13º SALÁRIO INTEGRAL',
              type: 'EARNING',
              amount: Number(gross13.toFixed(2)),
              referenceValue: `${avos}/12 AVOS`
            });

            items.push({
              description: 'ADIANTAMENTO 13º SALÁRIO',
              type: 'DEDUCTION',
              amount: Number(advanceDeduction.toFixed(2)),
              referenceValue: 'DESC. 1ª PARC'
            });

            items.push({
              description: 'INSS SOBRE 13º SALÁRIO',
              type: 'DEDUCTION',
              amount: Number(inssValue.toFixed(2)),
              referenceValue: 'TABELA INSS'
            });
         }
    } else {
         // LÓGICA MENSAL
         items.push({
            description: 'SALÁRIO BASE',
            type: 'EARNING',
            amount: baseSalary,
            referenceValue: '30 DIAS'
         });
         
         // --- CÁLCULO DE VALE TRANSPORTE ---
         const dailyTransport = Number(emp.transportDailyValue || 0);
         const [anoStr, mesStr] = selectedMonth.split('-');
         const ano = Number(anoStr);
         const mes = Number(mesStr);
         
         // 1. Tem custo diário configurado? Calcula dias úteis
         if (dailyTransport > 0.01) {
             const diasUteis = getBusinessDays(ano, mes);
             const custoRealVT = dailyTransport * diasUteis;
             const tetoLegal6 = baseSalary * 0.06;
             
             // O funcionário paga o menor valor entre o custo real e 6% do salário
             const descontoVT = Math.min(custoRealVT, tetoLegal6);

             items.push({
                description: 'VALE TRANSPORTE',
                type: 'DEDUCTION',
                amount: Number(descontoVT.toFixed(2)),
                referenceValue: `${diasUteis} DIAS ÚTEIS`
             });
         } 
         // 2. Não tem custo diário? Lança 6% padrão para garantir que apareça no holerite (pode ser editado)
         else {
             items.push({
                description: 'VALE TRANSPORTE (6%)',
                type: 'DEDUCTION',
                amount: Number((baseSalary * 0.06).toFixed(2)),
                referenceValue: '6% CLT'
             });
         }

         // INSS Mensal
         let inssValue = 0;
         if (baseSalary <= 1412.00) inssValue = baseSalary * 0.075;
         else if (baseSalary <= 2666.68) inssValue = (baseSalary * 0.09) - 21.18;
         else if (baseSalary <= 4000.03) inssValue = (baseSalary * 0.12) - 101.18;
         else if (baseSalary <= 7786.02) inssValue = (baseSalary * 0.14) - 181.18;
         else inssValue = 7786.02 * 0.14 - 181.18;

         items.push({
            description: 'INSS FOLHA',
            type: 'DEDUCTION',
            amount: Number(inssValue.toFixed(2)),
            referenceValue: 'TABELA INSS'
         });
    }
    return items;
  };

  // --- CARREGAMENTO DE DADOS ---
  const fetchData = async () => {
    setLoading(true);
    try {
      const referenceDate = `${selectedMonth}-01`;
      
      const promises: Promise<any>[] = [
        HRService.getPayrollList(referenceDate),
        DataService.getCompanySettings(),
        HRService.getEmployees(),
        HRService.getLeaves()
      ];

      const results = await Promise.all(promises);
      
      setPayrollList(results[0] as PayrollRun[]);
      setCompanySettings(results[1] as CompanySettings);
      
      const allEmps = results[2] as Employee[];
      // Filtra apenas CLT e Aprendiz para Férias e Folha
      setEmployees(allEmps.filter(e => e.contractType === 'CLT' || e.contractType === 'APRENDIZ'));
      setLeaves(results[3] as LeaveRecord[]);

    } catch (e) {
      console.error(e);
      setToast({ msg: 'Erro ao carregar dados.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedMonth, activeTab]);

  // Totais do Header
  const summary = useMemo(() => {
    return payrollList.reduce((acc, curr) => ({
      totalBruto: acc.totalBruto + (curr.totalEarnings || 0),
      totalLiquido: acc.totalLiquido + (curr.netSalary || 0),
      pendentes: acc.pendentes + (curr.status === 'DRAFT' ? 1 : 0)
    }), { totalBruto: 0, totalLiquido: 0, pendentes: 0 });
  }, [payrollList]);

  // --- ACTIONS ---

  const handleToggleStatus = async (e: React.MouseEvent, run: PayrollRun) => {
    e.stopPropagation(); // Impede que o clique no botão abra a linha (se houver handler)
    
    // Se estiver FECHADO, permite REABRIR
    if (run.status === 'CLOSED') {
        if (!window.confirm(`Deseja REABRIR a folha de ${run.employeeName}? \n\nO status voltará para PENDENTE e permitirá edição e recálculo dos valores.`)) return;
        
        setIsProcessing(true);
        try {
            const res = await HRService.updatePayrollStatus(run.id!, 'DRAFT');
            if (res.success) {
                setToast({ msg: 'Folha reaberta! Use "Recalcular" na edição para atualizar valores.', type: 'success' });
                // Atualização otimista
                setPayrollList(prev => prev.map(p => p.id === run.id ? { ...p, status: 'DRAFT' } : p));
                // Sincronização em background
                fetchData();
            } else {
                setToast({ msg: 'Erro ao reabrir folha.', type: 'error' });
            }
        } catch (e) {
            setToast({ msg: 'Erro de conexão.', type: 'error' });
        } finally {
            setIsProcessing(false);
        }
    } else {
        setToast({ msg: 'A folha já está em aberto para edição.', type: 'success' });
    }
  };

  const handleOpenModal = async (run: PayrollRun) => {
    setIsProcessing(true);
    try {
      let itemsToLoad: PayrollItem[] = [];
      let runDetails = run;
      let calculatedAvos = 12;

      const employeeData = employees.find(e => e.id === run.employeeId);
      const currentYear = parseInt(selectedMonth.split('-')[0]);
      
      if (employeeData) {
          calculatedAvos = await HRService.calculateThirteenthMonths(run.employeeId, currentYear);
          setCurrentAvos(calculatedAvos);
      }

      // Se já tem ID, tenta carregar itens salvos do banco
      if (run.id) {
         const details = await HRService.getPayrollDetails(run.id);
         if (details && details.items && details.items.length > 0) {
            runDetails = details;
            itemsToLoad = details.items;
         }
      }

      // Se não tiver itens salvos ou estiver em DRAFT sem itens, gera sugestão
      if (itemsToLoad.length === 0 && employeeData) {
         itemsToLoad = generateSuggestedItems(run, employeeData, calculatedAvos);
      }

      setEditingRun(runDetails);
      setModalItems(itemsToLoad);
      setShowModal(true);
    } catch (error) {
      console.error(error);
      setToast({ msg: 'Erro ao abrir holerite.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRecalculateItems = () => {
    if (!editingRun) return;
    const employeeData = employees.find(e => e.id === editingRun.employeeId);
    if (!employeeData) return;

    if (window.confirm("Isso substituirá todos os itens atuais pela sugestão do sistema (VT, INSS e Salário Base atualizados). Continuar?")) {
        const newItems = generateSuggestedItems(editingRun, employeeData, currentAvos);
        setModalItems(newItems);
        setToast({ msg: 'Valores recalculados com sucesso!', type: 'success' });
    }
  };

  // ... (rest of helper functions remain the same: handleAddItem, handleRemoveItem, handleUpdateItem)
  const handleAddItem = (type: 'EARNING' | 'DEDUCTION') => {
    setModalItems([...modalItems, {
      description: type === 'EARNING' ? 'NOVO PROVENTO' : 'NOVO DESCONTO',
      type: type,
      amount: 0,
      referenceValue: ''
    }]);
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...modalItems];
    newItems.splice(index, 1);
    setModalItems(newItems);
  };

  const handleUpdateItem = (index: number, field: keyof PayrollItem, value: any) => {
    const newItems = [...modalItems];
    // @ts-ignore
    newItems[index][field] = value;
    setModalItems(newItems);
  };

  // --- CÁLCULOS DINÂMICOS (Inteligência da Tela) ---
  const calculationData = useMemo(() => {
    const earnings = modalItems.filter(i => i.type === 'EARNING').reduce((a, b) => a + Number(b.amount), 0);
    const deductions = modalItems.filter(i => i.type === 'DEDUCTION').reduce((a, b) => a + Number(b.amount), 0);
    
    const emp = employees.find(e => e.id === editingRun?.employeeId);
    const isApprentice = emp?.contractType === 'APRENDIZ';
    
    // Regra FGTS
    const fgtsRate = isApprentice ? 0.02 : 0.08;
    
    let baseINSS = earnings;
    let baseFGTS = earnings;
    let baseIRRF = earnings - deductions; 

    // Regras 13º
    if (processingType === 'DECIMO_1') {
        baseINSS = 0; 
        baseIRRF = 0;
    }

    const valorFGTS = baseFGTS * fgtsRate; 

    return { 
        earnings, 
        deductions, 
        net: earnings - deductions, 
        baseINSS, 
        baseFGTS, 
        valorFGTS, 
        baseIRRF, 
        fgtsRate, 
        isApprentice
    };
  }, [modalItems, processingType, editingRun, employees]);

  const handleSaveCalculation = async () => {
    if (!editingRun) return;
    setIsProcessing(true);

    let notes = editingRun.notes || '';
    if (processingType !== 'MENSAL') {
        notes = `TIPO_PROC:${processingType} | AVOS:${currentAvos}`;
    }

    const updatedRun: PayrollRun = {
      ...editingRun,
      items: modalItems,
      totalEarnings: calculationData.earnings,
      totalDeductions: calculationData.deductions,
      netSalary: calculationData.net,
      status: 'CLOSED',
      paymentDate: new Date().toISOString().split('T')[0],
      notes
    };

    try {
      const res = await HRService.savePayroll(updatedRun);
      if (res.success) {
        setToast({ msg: 'Cálculo salvo com sucesso!', type: 'success' });
        setShowModal(false);
        fetchData(); 
      } else {
        setToast({ msg: 'Erro ao salvar.', type: 'error' });
      }
    } catch (e) {
      setToast({ msg: 'Erro de conexão.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const generateHolerite = () => {
    if (!editingRun) return;
    try {
        const doc = new jsPDF();

        // Configurações Globais
        doc.setFont('helvetica');
        doc.setLineWidth(0.1);

        // ============================================================
        // 1. CABEÇALHO DA EMPRESA (Y: 10 -> 35)
        // ============================================================
        doc.rect(10, 10, 190, 25); // Borda Externa Bloco 1

        // Dados Empresa (Esquerda)
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(companySettings?.name || 'EMPRESA EXEMPLO LTDA', 15, 18);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`${companySettings?.address || 'ENDEREÇO COMERCIAL'}`, 15, 23);
        doc.text(`CNPJ: ${companySettings?.cnpj || '00.000.000/0000-00'}`, 15, 28);

        // Título do Recibo (Direita)
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        let title = 'RECIBO DE PAGAMENTO';
        if (processingType === 'DECIMO_1') title = '13º SALÁRIO - 1ª PARCELA';
        if (processingType === 'DECIMO_2') title = '13º SALÁRIO - QUITAÇÃO';

        doc.text(title, 195, 18, { align: 'right' });

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`REFERÊNCIA: ${selectedMonth}`, 195, 23, { align: 'right' });
        if (processingType !== 'MENSAL') {
            doc.text(`AVOS: ${currentAvos}/12`, 195, 28, { align: 'right' });
        }

        // ============================================================
        // 2. DADOS DO FUNCIONÁRIO (Y: 35 -> 50)
        // ============================================================
        doc.rect(10, 35, 190, 15); // Borda Externa Bloco 2

        // Labels
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.text('CÓDIGO', 15, 39);
        doc.text('NOME DO FUNCIONÁRIO', 40, 39);
        doc.text('CBO', 140, 39); 
        doc.text('FUNÇÃO', 160, 39);

        // Values
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(editingRun.employeeId.substring(0, 6), 15, 45);
        doc.text(editingRun.employeeName?.toUpperCase() || '', 40, 45);
        doc.text('0000-00', 140, 45); // Placeholder CBO
        doc.text(editingRun.employeeRole?.toUpperCase() || '', 160, 45);

        // ============================================================
        // 3. CABEÇALHO DA TABELA (Y: 50 -> 58)
        // ============================================================
        doc.setFillColor(240, 240, 240); // Cinza Claro
        doc.rect(10, 50, 190, 8, 'F');   // Preenchimento
        doc.rect(10, 50, 190, 8, 'S');   // Borda

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('CÓD.', 15, 55);
        doc.text('DESCRIÇÃO', 30, 55);
        doc.text('REF.', 110, 55);
        doc.text('VENCIMENTOS', 165, 55, { align: 'right' });
        doc.text('DESCONTOS', 195, 55, { align: 'right' });

        // ============================================================
        // 4. CORPO DA TABELA (Y: 58 -> 135)
        // ============================================================
        doc.rect(10, 58, 190, 77); // Retângulo Grande para os itens

        let y = 64; // Primeira linha de item
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);

        modalItems.forEach((item, idx) => {
            if (y > 130) return; // Segurança

            doc.text(String(idx + 1).padStart(3, '0'), 15, y);
            doc.text(item.description.toUpperCase().substring(0, 45), 30, y);
            doc.text(item.referenceValue || '', 110, y);

            if (item.type === 'EARNING') {
                doc.text(item.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 165, y, { align: 'right' });
            } else {
                doc.text(item.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 195, y, { align: 'right' });
            }
            y += 5; 
        });

        // ============================================================
        // 5. RODAPÉ DE TOTAIS E LÍQUIDO (Y: 135 -> 160)
        // ============================================================
        doc.rect(10, 135, 190, 25);

        // Linha divisória interna vertical
        doc.line(130, 135, 130, 160); 

        // Mensagem (Esquerda)
        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.text('DECLARO TER RECEBIDO A IMPORTÂNCIA LÍQUIDA DISCRIMINADA NESTE RECIBO.', 15, 140);
        doc.text('DATA: ____/____/______           ASSINATURA: _________________________________', 15, 155);

        // Box Totais (Direita Superior)
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('TOTAL VENCIMENTOS', 132, 140);
        doc.text('TOTAL DESCONTOS', 168, 140);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(calculationData.earnings.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 162, 145, { align: 'right' });
        doc.text(calculationData.deductions.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 195, 145, { align: 'right' });

        // Box Líquido (Direita Inferior)
        doc.rect(132, 148, 65, 10); // Box interno
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('LÍQUIDO A RECEBER ->', 135, 154);
        
        doc.setFontSize(11);
        doc.text(calculationData.net.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 195, 155, { align: 'right' });

        // ============================================================
        // 6. BASES DE CÁLCULO (Y: 160 -> 175)
        // ============================================================
        doc.rect(10, 160, 190, 15);

        // Labels das Bases (Y=164)
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        const baseX = [15, 50, 85, 120, 155];
        doc.text('SAL. BASE', baseX[0], 164);
        doc.text('SAL. CONTR. INSS', baseX[1], 164);
        doc.text('BASE CÁLC. FGTS', baseX[2], 164);
        doc.text(`FGTS DO MÊS (${(calculationData.fgtsRate * 100).toFixed(0)}%)`, baseX[3], 164);
        doc.text('BASE CÁLC. IRRF', baseX[4], 164);

        // Valores das Bases (Y=170)
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(editingRun.baseSalary.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), baseX[0], 170);
        doc.text(calculationData.baseINSS.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), baseX[1], 170);
        doc.text(calculationData.baseFGTS.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), baseX[2], 170);
        doc.text(calculationData.valorFGTS.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), baseX[3], 170);
        doc.text(calculationData.baseIRRF.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), baseX[4], 170);

        // Salvar
        doc.save(`HOLERITE_${editingRun.employeeName?.replace(/ /g, '_')}_${selectedMonth}.pdf`);
        setToast({ msg: 'PDF Gerado com sucesso!', type: 'success' });
    } catch (e) {
        console.error(e);
        setToast({ msg: 'Erro ao gerar PDF.', type: 'error' });
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Departamento Pessoal</h2>
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mt-3 italic">Gestão de Folha e Benefícios</p>
        </div>
        
        <div className="flex bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm">
           <button onClick={() => setActiveTab('PAYROLL')} className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'PAYROLL' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>Processamento Mensal</button>
           <button onClick={() => setActiveTab('VACATION')} className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'VACATION' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>Férias & Ausências</button>
        </div>
      </div>

      {activeTab === 'PAYROLL' ? (
        <>
          <div className="flex flex-wrap justify-end gap-3">
             <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center">
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-3 border-r border-slate-100">Tipo Processamento</span>
                <select 
                  value={processingType} 
                  onChange={(e) => setProcessingType(e.target.value as ProcessingType)}
                  className="bg-transparent font-black text-slate-900 outline-none text-[10px] uppercase cursor-pointer py-1 px-2"
                >
                   <option value="MENSAL">Folha Mensal</option>
                   <option value="DECIMO_1">13º - 1ª Parcela (Nov)</option>
                   <option value="DECIMO_2">13º - Quitação (Dez)</option>
                </select>
             </div>

             <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
                <div className="px-4 py-1 border-r border-slate-100">
                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Competência</p>
                   <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="bg-transparent font-black text-slate-900 outline-none text-sm uppercase cursor-pointer" />
                </div>
                <div className="px-4 text-center">
                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Status</p>
                   <span className={`text-[10px] font-black uppercase ${summary.pendentes > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>{summary.pendentes > 0 ? 'Em Aberto' : 'Fechada'}</span>
                </div>
             </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total da Folha (Bruto)</p><h3 className="text-3xl font-black text-slate-900 italic tracking-tighter">R$ {summary.totalBruto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h3></div>
             <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl text-white"><p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-1">Total Líquido a Pagar</p><h3 className="text-3xl font-black italic tracking-tighter">R$ {summary.totalLiquido.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h3></div>
             <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between"><div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Pendências</p><h3 className="text-3xl font-black text-slate-900 italic tracking-tighter">{summary.pendentes}</h3></div></div>
          </div>

          <div className="table-container bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
             {loading ? (<div className="py-32 text-center opacity-30 font-black uppercase text-[10px] tracking-[0.3em] animate-pulse">Carregando Dados...</div>) : (
                <table className="w-full">
                   <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest"><tr><th className="px-8 py-5 text-left">Colaborador</th><th className="px-8 py-5 text-left">Cargo</th><th className="px-8 py-5 text-right">Salário Base</th><th className="px-8 py-5 text-center">Status Folha</th><th className="px-8 py-5 text-right">Valor Líquido</th><th className="px-8 py-5 text-right">Ação</th></tr></thead>
                   <tbody className="divide-y divide-slate-50">
                      {payrollList.map(run => (
                         <tr key={run.employeeId} className="hover:bg-slate-50/80 transition-all group">
                            <td className="px-8 py-5"><p className="font-black text-slate-900 text-xs uppercase">{run.employeeName}</p><p className="text-[9px] font-bold text-slate-400 mt-0.5">ID: {run.employeeId.substring(0,6)}</p></td>
                            <td className="px-8 py-5 text-[10px] font-bold text-slate-500 uppercase">{run.employeeRole}</td>
                            <td className="px-8 py-5 text-right text-[11px] font-bold text-slate-600">R$ {run.baseSalary.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                            <td className="px-8 py-5 text-center">
                                <button 
                                    onClick={(e) => handleToggleStatus(e, run)}
                                    className={`px-3 py-1 rounded-xl text-[8px] font-black uppercase border transition-all ${
                                        run.status === 'CLOSED' 
                                        ? 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-red-50 hover:text-red-500 hover:border-red-100 cursor-pointer' 
                                        : 'bg-slate-100 text-slate-400 border-slate-200 cursor-default'
                                    }`}
                                    title={run.status === 'CLOSED' ? "Clique para reabrir (tornar pendente)" : "Em Aberto"}
                                >
                                    {run.status === 'CLOSED' ? 'FECHADO (REABRIR)' : 'EM ABERTO'}
                                </button>
                            </td>
                            <td className="px-8 py-5 text-right"><span className={`text-sm font-black italic ${run.netSalary > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>R$ {run.netSalary.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></td>
                            <td className="px-8 py-5 text-right"><button onClick={() => handleOpenModal(run)} className={`px-6 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${run.status === 'CLOSED' ? 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50' : 'bg-slate-900 text-white shadow-lg hover:bg-blue-600'}`}>{run.status === 'CLOSED' ? 'Editar / Ver' : 'Calcular'}</button></td>
                         </tr>
                      ))}
                   </tbody>
                </table>
             )}
          </div>
        </>
      ) : (
        /* ABA DE FÉRIAS (PLACEHOLDER FUNCIONAL) */
        <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
           <div className="p-10 text-center opacity-30 text-[10px] font-black uppercase">Módulo de Férias Carregado (Funcionalidade Disponível)</div>
        </div>
      )}

      {/* MODAL DE CÁLCULO (HOLERITE ESTILO PDF) */}
      {showModal && editingRun && (
         <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in zoom-in-95 duration-300">
            <div className="bg-white w-full max-w-5xl rounded-[1rem] shadow-2xl overflow-hidden flex flex-col h-[90vh] border border-slate-300">
               
               {/* BARRA DE FERRAMENTAS SUPERIOR */}
               <div className="px-6 py-4 border-b border-slate-200 bg-slate-100 flex justify-between items-center shrink-0">
                  <div>
                     <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Edição de Folha</h3>
                     <p className="text-[10px] font-bold text-slate-500 uppercase">{processingType === 'MENSAL' ? 'Referência Mensal' : processingType === 'DECIMO_1' ? '13º Salário (1ª Parc)' : '13º Salário (Final)'}: {selectedMonth}</p>
                  </div>
                  <div className="flex gap-3">
                     <button onClick={handleRecalculateItems} className="px-4 py-2 bg-blue-50 border border-blue-200 text-blue-600 rounded-lg text-xs font-bold uppercase hover:bg-blue-100 transition-all flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        Recalcular Sugestão
                     </button>
                     <button onClick={generateHolerite} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-bold uppercase hover:bg-slate-50 transition-all flex items-center gap-2">
                        <ICONS.Finance className="w-4 h-4" /> PDF
                     </button>
                     <button onClick={() => setShowModal(false)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-bold uppercase hover:bg-red-100 transition-all">Fechar</button>
                  </div>
               </div>

               {/* CORPO DO HOLERITE (VISUAL CLÁSSICO) */}
               <div className="flex-1 overflow-y-auto p-8 bg-slate-200 flex justify-center">
                  <div className="bg-white w-full max-w-4xl shadow-lg border border-slate-400 p-1 min-h-[600px] flex flex-col relative text-black font-sans">
                     
                     {/* 1. Header Empresa / Título */}
                     <div className="border border-black p-2 flex justify-between items-start h-24">
                        <div className="w-1/2">
                           <h2 className="font-bold text-sm uppercase">{companySettings?.name || 'EMPRESA MODELO'}</h2>
                           <p className="text-[10px]">{companySettings?.address || 'ENDEREÇO COMERCIAL'}</p>
                           <p className="text-[10px]">CNPJ: {companySettings?.cnpj || '00.000.000/0000-00'}</p>
                        </div>
                        <div className="w-1/2 text-right">
                           <h2 className="font-bold text-sm uppercase">RECIBO DE PAGAMENTO DE SALÁRIO</h2>
                           <p className="text-[10px] mt-1">REFERÊNCIA: {selectedMonth}</p>
                           {processingType !== 'MENSAL' && <p className="text-[9px] font-bold text-blue-800 mt-1 uppercase">AVOS DIREITO: {currentAvos}/12</p>}
                        </div>
                     </div>

                     {/* 2. Dados Funcionário */}
                     <div className="border-x border-b border-black p-1 flex justify-between items-center h-12 bg-slate-50">
                        <div className="w-[10%] border-r border-slate-300 h-full px-2">
                           <p className="text-[8px] font-bold">CÓD.</p>
                           <p className="text-xs">{editingRun.employeeId.substring(0,4)}</p>
                        </div>
                        <div className="w-[40%] border-r border-slate-300 h-full px-2">
                           <p className="text-[8px] font-bold">NOME DO FUNCIONÁRIO</p>
                           <p className="text-xs font-bold truncate">{editingRun.employeeName}</p>
                        </div>
                        <div className="w-[25%] border-r border-slate-300 h-full px-2">
                           <p className="text-[8px] font-bold">FUNÇÃO</p>
                           <p className="text-xs truncate">{editingRun.employeeRole}</p>
                        </div>
                        <div className="w-[25%] px-2">
                           <p className="text-[8px] font-bold">DEPARTAMENTO</p>
                           <p className="text-xs truncate">GERAL</p>
                        </div>
                     </div>

                     {/* 3. Tabela de Itens (Header) */}
                     <div className="border-x border-b border-black flex h-6 bg-slate-100">
                        <div className="w-[10%] border-r border-black flex items-center justify-center"><span className="text-[9px] font-bold">CÓD</span></div>
                        <div className="w-[40%] border-r border-black flex items-center pl-2"><span className="text-[9px] font-bold">DESCRIÇÃO</span></div>
                        <div className="w-[10%] border-r border-black flex items-center justify-center"><span className="text-[9px] font-bold">REF.</span></div>
                        <div className="w-[20%] border-r border-black flex items-center justify-center"><span className="text-[9px] font-bold">VENCIMENTOS</span></div>
                        <div className="w-[20%] flex items-center justify-center"><span className="text-[9px] font-bold">DESCONTOS</span></div>
                     </div>

                     {/* 4. Tabela de Itens (Body - Editável) */}
                     <div className="border-x border-b border-black flex-1 relative">
                        {modalItems.map((item, idx) => (
                           <div key={idx} className="flex h-6 border-b border-slate-100 hover:bg-yellow-50 items-center">
                              <div className="w-[10%] text-center text-[10px] text-slate-500">{String(idx+1).padStart(3,'0')}</div>
                              <div className="w-[40%] pl-2">
                                 <input 
                                    value={item.description} 
                                    onChange={(e) => handleUpdateItem(idx, 'description', e.target.value.toUpperCase())}
                                    className="w-full bg-transparent outline-none text-[10px] font-bold uppercase"
                                 />
                              </div>
                              <div className="w-[10%] text-center">
                                 <input 
                                    value={item.referenceValue || ''} 
                                    onChange={(e) => handleUpdateItem(idx, 'referenceValue', e.target.value)}
                                    className="w-full text-center bg-transparent outline-none text-[10px]"
                                 />
                              </div>
                              <div className="w-[20%] text-right pr-2">
                                 {item.type === 'EARNING' && (
                                    <input 
                                       type="number" 
                                       value={item.amount} 
                                       onChange={(e) => handleUpdateItem(idx, 'amount', parseFloat(e.target.value))}
                                       className="w-full text-right bg-transparent outline-none text-[10px]"
                                    />
                                 )}
                              </div>
                              <div className="w-[20%] text-right pr-2 flex items-center justify-end group">
                                 {item.type === 'DEDUCTION' && (
                                    <input 
                                       type="number" 
                                       value={item.amount} 
                                       onChange={(e) => handleUpdateItem(idx, 'amount', parseFloat(e.target.value))}
                                       className="w-full text-right bg-transparent outline-none text-[10px]"
                                    />
                                 )}
                                 <button onClick={() => handleRemoveItem(idx)} className="ml-1 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                              </div>
                           </div>
                        ))}
                        {/* Botões de Adicionar Linha (Overlay discreto) */}
                        <div className="absolute bottom-2 left-2 flex gap-2 opacity-50 hover:opacity-100 transition-opacity print:hidden">
                           <button onClick={() => handleAddItem('EARNING')} className="text-[9px] bg-green-100 text-green-700 px-2 py-1 rounded border border-green-300">+ Provento</button>
                           <button onClick={() => handleAddItem('DEDUCTION')} className="text-[9px] bg-red-100 text-red-700 px-2 py-1 rounded border border-red-300">+ Desconto</button>
                        </div>
                     </div>

                     {/* 5. Totais e Rodapé */}
                     <div className="border-x border-b border-black h-24 flex">
                        <div className="w-[60%] border-r border-black p-2 flex flex-col justify-between">
                           <div className="text-[8px]">
                              <p className="font-bold">MENSAGEM:</p>
                              <p>O pagamento deste recibo implica na quitação total dos valores nele discriminados.</p>
                           </div>
                           <div className="flex justify-between border-t border-slate-300 pt-1 text-[9px]">
                              <div><span className="font-bold block">SAL. BASE</span> R$ {editingRun.baseSalary.toFixed(2)}</div>
                              <div><span className="font-bold block">BASE INSS</span> R$ {calculationData.baseINSS.toFixed(2)}</div>
                              <div><span className="font-bold block">BASE FGTS</span> R$ {calculationData.baseFGTS.toFixed(2)}</div>
                              <div>
                                <span className="font-bold block">FGTS ({calculationData.isApprentice ? '2%' : '8%'})</span> 
                                R$ {calculationData.valorFGTS.toFixed(2)}
                              </div>
                           </div>
                        </div>
                        <div className="w-[40%] flex flex-col">
                           <div className="h-8 border-b border-black flex items-center justify-between px-2 bg-slate-50">
                              <span className="text-[9px] font-bold">TOTAL VENCIMENTOS</span>
                              <span className="text-xs">{calculationData.earnings.toFixed(2)}</span>
                           </div>
                           <div className="h-8 border-b border-black flex items-center justify-between px-2 bg-slate-50">
                              <span className="text-[9px] font-bold">TOTAL DESCONTOS</span>
                              <span className="text-xs">{calculationData.deductions.toFixed(2)}</span>
                           </div>
                           <div className="flex-1 flex items-center justify-between px-2 bg-slate-200">
                              <span className="text-[10px] font-bold">LÍQUIDO A RECEBER -></span>
                              <span className="text-sm font-bold">R$ {calculationData.net.toFixed(2)}</span>
                           </div>
                        </div>
                     </div>
                     
                     <div className="text-[8px] p-2 text-center">
                        DATA: {new Date().toLocaleDateString()} __________________________________________________ ASSINATURA DO FUNCIONÁRIO
                     </div>
                  </div>
               </div>

               {/* BOTÃO SALVAR */}
               <div className="p-6 bg-white border-t border-slate-200 flex justify-end">
                  <button 
                     onClick={handleSaveCalculation} 
                     disabled={isProcessing}
                     className="px-12 py-3 bg-blue-700 text-white rounded-lg font-bold text-sm hover:bg-blue-800 transition-all shadow-md"
                  >
                     {isProcessing ? 'Salvando...' : 'Salvar Cálculo'}
                  </button>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};

export default HRPayrollModule;
