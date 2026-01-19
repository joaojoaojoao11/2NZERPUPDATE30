
import React, { useState, useMemo, useEffect } from 'react';
import { FinanceService } from '../services/financeService';
import { DataService } from '../services/dataService';
import { Settlement, AccountsReceivable, User, CompanySettings } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import { jsPDF } from 'jspdf';

type SettlementStep = 'GESTAO' | 'SELECAO' | 'SIMULACAO' | 'REVISAO';

interface SettlementModuleProps {
  currentUser: User;
  initialClient?: string | null;
  initialTitles?: string[];
  onBack?: () => void;
}

const SettlementModule: React.FC<SettlementModuleProps> = ({ currentUser, initialClient, initialTitles, onBack }) => {
  const [step, setStep] = useState<SettlementStep>('GESTAO');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  
  const [ar, setAr] = useState<AccountsReceivable[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(initialClient || null);
  const [selectedTitles, setSelectedTitles] = useState<string[]>(initialTitles || []);
  
  const [config, setConfig] = useState({
    parcelas: 1,
    dataPrimeira: new Date().toISOString().split('T')[0],
    frequencia: 'Mensal' as 'Mensal' | 'Quinzenal' | 'Semanal',
    totalAcordo: 0,
    observacao: ''
  });

  const [viewingSettlement, setViewingSettlement] = useState<Settlement | null>(null);
  const [viewingDetails, setViewingDetails] = useState<{ installments: AccountsReceivable[], originals: AccountsReceivable[] } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [resAr, resSet, resComp] = await Promise.all([
        FinanceService.getAccountsReceivable(),
        FinanceService.getSettlements(),
        DataService.getCompanySettings()
      ]);
      setAr(Array.isArray(resAr) ? resAr : []);
      setSettlements(Array.isArray(resSet) ? resSet : []);
      setCompany(resComp);

      if (initialClient && initialTitles && initialTitles.length > 0) {
        const selectedAr = (Array.isArray(resAr) ? resAr : []).filter(t => initialTitles.includes(t.id));
        const total = selectedAr.reduce((a, b) => a + (Number(b.saldo) || 0), 0);
        setConfig(prev => ({ ...prev, totalAcordo: total }));
        setStep('SIMULACAO');
      }
    } catch (e) {
      console.error("NZSTOK Safe Loading Error:", e);
      setAr([]);
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const totalOriginalSelecionado = useMemo(() => {
    return (ar || []).filter(t => (selectedTitles || []).includes(t.id)).reduce((a, b) => a + (Number(b.saldo) || 0), 0);
  }, [ar, selectedTitles]);

  const projectedInstallments = useMemo(() => {
    if (config.parcelas <= 0 || config.totalAcordo <= 0) return [];
    
    const installments = [];
    const valorParcela = config.totalAcordo / config.parcelas;
    let dataRef = new Date(config.dataPrimeira);
    dataRef.setMinutes(dataRef.getMinutes() + dataRef.getTimezoneOffset());

    for (let i = 1; i <= config.parcelas; i++) {
      installments.push({
        numero: i,
        vencimento: dataRef.toLocaleDateString('pt-BR'),
        valor: valorParcela
      });

      if (config.frequencia === 'Semanal') dataRef.setDate(dataRef.getDate() + 7);
      else if (config.frequencia === 'Quinzenal') dataRef.setDate(dataRef.getDate() + 15);
      else dataRef.setMonth(dataRef.getMonth() + 1);
    }
    return installments;
  }, [config]);

  const handleOpenDetails = async (s: Settlement) => {
    setLoading(true);
    try {
      const details = await FinanceService.getSettlementDetails(s.id);
      setViewingDetails(details);
      setViewingSettlement(s);
    } catch (e) {
      setToast({ msg: "Erro ao abrir acordo.", type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleLiquidate = async (id: string, valor: number) => {
    const method = window.prompt("Digite o meio de pagamento (PIX, BOLETO, DINHEIRO):", "PIX");
    if (!method) return;

    setLoading(true);
    try {
        const today = new Date().toISOString().split('T')[0];
        const success = await FinanceService.liquidateInstallment(id, today, method.toUpperCase(), currentUser);
        if (success) {
            setToast({ msg: "Parcela liquidada com sucesso!", type: 'success' });
            if (viewingSettlement) {
                await handleOpenDetails(viewingSettlement); // Refresh details
            }
        } else {
            setToast({ msg: "Erro ao liquidar parcela.", type: 'error' });
        }
    } catch (e) {
        setToast({ msg: "Erro de comunicação.", type: 'error' });
    } finally {
        setLoading(false);
    }
  };

  const handleDeleteSettlement = async () => {
    if (!viewingSettlement) return;
    
    const confirm = window.confirm(
      `ATENÇÃO: EXCLUSÃO DE ACORDO\n\n` +
      `Esta ação irá:\n` +
      `1. Apagar todas as parcelas geradas.\n` +
      `2. Destravar os títulos originais (voltando para 'EM ABERTO' ou 'VENCIDO').\n` +
      `3. Remover o registro deste acordo.\n\n` +
      `Deseja realmente cancelar este acordo?`
    );

    if (!confirm) return;

    setLoading(true);
    try {
      const success = await FinanceService.deleteSettlement(viewingSettlement.id, currentUser);
      if (success) {
        setToast({ msg: "Acordo excluído e títulos restaurados!", type: 'success' });
        setViewingSettlement(null);
        setViewingDetails(null);
        await fetchData(); // Atualiza a lista principal
      } else {
        setToast({ msg: "Erro ao excluir o acordo. Tente novamente.", type: 'error' });
      }
    } catch (e) {
      setToast({ msg: "Erro crítico ao excluir.", type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const generateConfessionPDF = () => {
    if (!viewingSettlement || !viewingDetails) return;

    const doc = new jsPDF();
    const pageWidth = 210;
    const margin = 15;
    
    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('TERMO DE CONFISSÃO DE DÍVIDA', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(10);
    doc.text(`PROTOCOLO: ${viewingSettlement.id}`, pageWidth / 2, 26, { align: 'center' });

    let y = 40;

    // Partes
    doc.setFontSize(11);
    doc.text('CREDOR:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(company?.name || 'EMPRESA USUÁRIA DO SISTEMA NZERP', margin + 25, y);
    doc.text(`CNPJ: ${company?.cnpj || '00.000.000/0000-00'}`, margin + 25, y + 5);
    
    y += 15;
    doc.setFont('helvetica', 'bold');
    doc.text('DEVEDOR:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(viewingSettlement.cliente, margin + 25, y);
    doc.text('Confirmado eletronicamente.', margin + 25, y + 5);

    y += 20;
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    // Cláusula 1 - Objeto (Originais)
    doc.setFont('helvetica', 'bold');
    doc.text('1. DA ORIGEM DA DÍVIDA', margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('O DEVEDOR reconhece e confessa a dívida referente aos títulos abaixo listados:', margin, y);
    y += 8;

    // Tabela Originais
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y - 4, pageWidth - (margin * 2), 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.text('DOCUMENTO', margin + 2, y);
    doc.text('VENCIMENTO ORIG.', margin + 50, y);
    doc.text('VALOR ORIGINAL', pageWidth - margin - 2, y, { align: 'right' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    viewingDetails.originals.forEach(orig => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(`${orig.numero_documento || orig.id}`, margin + 2, y);
        doc.text(orig.data_vencimento ? new Date(orig.data_vencimento).toLocaleDateString('pt-BR') : '-', margin + 50, y);
        doc.text(`R$ ${Number(orig.valor_documento).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, pageWidth - margin - 2, y, { align: 'right' });
        y += 5;
    });
    
    // Total Originais
    const totalOrig = viewingDetails.originals.reduce((acc, i) => acc + Number(i.valor_documento), 0);
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL ORIGINAL: R$ ${totalOrig.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, pageWidth - margin - 2, y, { align: 'right' });

    y += 15;

    // Cláusula 2 - Novo Acordo (Parcelas)
    doc.setFontSize(11);
    doc.text('2. DA FORMA DE PAGAMENTO ACORDADA', margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('A dívida acima confessada será paga conforme o fluxo abaixo, acrescido de juros/multa se houver:', margin, y);
    y += 8;

    // Tabela Parcelas
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y - 4, pageWidth - (margin * 2), 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.text('PARCELA', margin + 2, y);
    doc.text('VENCIMENTO', margin + 50, y);
    doc.text('VALOR PARCELA', pageWidth - margin - 2, y, { align: 'right' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    viewingDetails.installments.forEach(inst => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(inst.numero_documento, margin + 2, y);
        doc.text(inst.data_vencimento ? new Date(inst.data_vencimento).toLocaleDateString('pt-BR') : '-', margin + 50, y);
        doc.text(`R$ ${Number(inst.valor_documento).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, pageWidth - margin - 2, y, { align: 'right' });
        y += 5;
    });

    // Total Acordo
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL ACORDADO: R$ ${Number(viewingSettlement.valorAcordo).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, pageWidth - margin - 2, y, { align: 'right' });

    // Assinaturas
    y += 30;
    if (y > 260) { doc.addPage(); y = 40; }

    doc.setLineWidth(0.1);
    doc.line(margin + 10, y, 90, y);
    doc.line(120, y, pageWidth - margin - 10, y);

    doc.setFontSize(8);
    doc.text('ASSINATURA CREDOR', 50, y + 5, { align: 'center' });
    doc.text('ASSINATURA DEVEDOR', 160, y + 5, { align: 'center' });

    doc.text(`Emitido em: ${new Date().toLocaleString()}`, margin, 285);

    doc.save(`Confissao_Divida_${viewingSettlement.cliente.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    setToast({ msg: "Documento gerado com sucesso!", type: 'success' });
  };

  if (loading && step === 'GESTAO' && !viewingSettlement) return <div className="py-40 text-center opacity-30 font-black uppercase text-[10px] animate-pulse">Sincronizando Mesa de Acordos...</div>;

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500 h-full flex flex-col">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {step === 'GESTAO' && (
        <div className="space-y-8 flex flex-col h-full">
          <div className="flex justify-between items-end shrink-0">
            <div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Mesa de Acordos</h2>
              <p className="text-[10px] font-black text-blue-600 uppercase mt-3 italic tracking-widest">Histórico de Negociações Efetivadas</p>
            </div>
            {onBack && (
              <button onClick={onBack} className="px-6 py-4 bg-white border border-slate-200 rounded-2xl font-black text-[10px] uppercase text-slate-400 hover:text-slate-600 transition-all italic shadow-sm">
                ← Voltar CRM
              </button>
            )}
          </div>

          <div className="table-container bg-white border border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest border-b border-slate-100">
                  <th className="px-8 py-5">Protocolo</th>
                  <th>Cliente</th>
                  <th className="text-right">Valor Acordo</th>
                  <th className="text-center">Status</th>
                  <th className="text-right px-8">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(settlements || []).map(s => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-all">
                    <td className="px-8 py-6 font-black text-blue-600 text-xs">#{s.id}</td>
                    <td className="font-black text-slate-800 uppercase text-[11px] truncate max-w-[350px]">{s.cliente}</td>
                    <td className="text-right font-black text-slate-900">R$ {(Number(s.valorAcordo) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="text-center">
                       <span className={`px-3 py-1 rounded-xl text-[8px] font-black uppercase border ${s.status === 'ATIVO' ? 'bg-emerald-50 text-emerald-600 border-emerald-100 shadow-sm' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>{s.status}</span>
                    </td>
                    <td className="text-right px-8">
                       <button onClick={() => handleOpenDetails(s)} className="px-5 py-2 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-900 hover:text-white transition-all italic">Ver Detalhes</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(settlements || []).length === 0 && (
              <div className="py-32 text-center opacity-20 font-black uppercase text-[10px] italic">Nenhum acordo registrado na base</div>
            )}
          </div>
        </div>
      )}

      {step === 'SELECAO' && (
        <div className="max-w-5xl mx-auto space-y-8 animate-in slide-in-from-right-4">
           <button onClick={() => setStep('GESTAO')} className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-2 hover:text-slate-900">← Voltar</button>
           <h3 className="text-2xl font-black italic uppercase tracking-tighter">1. Localizar Devedor</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="space-y-4">
                 <input type="text" placeholder="PESQUISAR CLIENTE..." className="w-full px-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none font-black text-xs uppercase" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                 <div className="bg-white rounded-2xl border border-slate-100 shadow-sm max-h-60 overflow-y-auto">
                    {Array.from(new Set((ar || []).filter(t => (Number(t.saldo) || 0) > 0.01).map(t => t.cliente || 'N/A')))
                      .filter((c: string) => c.toLowerCase().includes(searchTerm.toLowerCase()))
                      .map(name => (
                        <button key={name} onClick={() => setSelectedClient(name)} className={`w-full p-4 text-left border-b border-slate-50 font-black text-[11px] uppercase italic ${selectedClient === name ? 'bg-blue-600 text-white' : 'hover:bg-slate-50'}`}>{name}</button>
                    ))}
                 </div>
              </div>
              <div className="space-y-4">
                 {selectedClient && (
                    <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                       <p className="text-[9px] font-black text-slate-400 uppercase mb-4">Débitos em Aberto</p>
                       <div className="space-y-3">
                          {(ar || []).filter(t => t.cliente === selectedClient && (Number(t.saldo) || 0) > 0.01).map(t => (
                            <button key={t.id} onClick={() => setSelectedTitles(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id])} className={`w-full p-4 rounded-xl border flex justify-between items-center transition-all ${selectedTitles.includes(t.id) ? 'border-blue-600 bg-blue-50' : 'border-slate-100 bg-slate-50'}`}>
                               <span className="font-black text-[10px] uppercase">NF: {t.id}</span>
                               <span className="font-black text-slate-900 text-xs">R$ {(Number(t.saldo) || 0).toLocaleString('pt-BR')}</span>
                            </button>
                          ))}
                       </div>
                       <button disabled={selectedTitles.length === 0} onClick={() => { setStep('SIMULACAO'); setConfig({...config, totalAcordo: totalOriginalSelecionado}); }} className="w-full mt-6 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest disabled:opacity-20 italic transition-all">Configurar Acordo →</button>
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {step === 'SIMULACAO' && (
        <div className="max-w-4xl mx-auto space-y-10 animate-in slide-in-from-right-4">
           <button onClick={() => initialClient ? (onBack ? onBack() : setStep('GESTAO')) : setStep('SELECAO')} className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-2 hover:text-slate-900">← {initialClient ? 'Voltar para CRM' : 'Alterar Seleção'}</button>
           
           <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-xl space-y-8">
                    <h3 className="text-2xl font-black italic uppercase tracking-tighter">2. Simulador de Parcelas</h3>
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase ml-2 italic">Nº Parcelas</label>
                                <input type="number" min="1" max="60" className="w-full p-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-black text-lg outline-none" value={config.parcelas} onChange={e => setConfig({...config, parcelas: Number(e.target.value)})} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase ml-2 italic">Valor Final</label>
                                <input type="number" className="w-full p-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-black text-lg outline-none" value={config.totalAcordo} onChange={e => setConfig({...config, totalAcordo: Number(e.target.value)})} />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-2 italic">Data 1ª Parcela</label>
                            <input type="date" className="w-full p-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-black text-xs outline-none uppercase" value={config.dataPrimeira} onChange={e => setConfig({...config, dataPrimeira: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-2 italic">Frequência</label>
                            <select className="w-full p-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-black text-xs outline-none uppercase cursor-pointer" value={config.frequencia} onChange={e => setConfig({...config, frequencia: e.target.value as any})}>
                                <option value="Mensal">Mensal</option>
                                <option value="Quinzenal">Quinzenal</option>
                                <option value="Semanal">Semanal</option>
                            </select>
                        </div>
                    </div>
                    <button onClick={() => setStep('REVISAO')} className="w-full py-5 bg-blue-600 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-all italic shadow-xl">Revisar Confissão →</button>
                </div>
              </div>

              <div className="lg:col-span-7 space-y-6">
                <div className="bg-slate-900 p-8 rounded-[2.5rem] shadow-2xl flex flex-col h-full border border-slate-800">
                    <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                        <h4 className="text-[11px] font-black text-blue-400 uppercase tracking-widest italic">Projeção de Fluxo de Caixa</h4>
                        <span className="bg-white/10 text-white px-3 py-1 rounded-lg text-[9px] font-black uppercase">R$ {(config.totalAcordo / (config.parcelas || 1)).toLocaleString('pt-BR', {minimumFractionDigits: 2})} /m</span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                        {projectedInstallments.map((inst) => (
                            <div key={inst.numero} className="p-4 bg-white/5 border border-white/5 rounded-2xl flex justify-between items-center group hover:bg-white/10 transition-all">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-blue-600/20 text-blue-400 rounded-xl flex items-center justify-center font-black text-xs italic">{inst.numero}º</div>
                                    <div><p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Vencimento</p><p className="text-sm font-black text-white italic">{inst.vencimento}</p></div>
                                </div>
                                <div className="text-right">
                                    <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest mb-0.5">Valor Parcela</p>
                                    <p className="text-sm font-black text-white italic">R$ {inst.valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-6 pt-6 border-t border-white/10 flex justify-between items-center">
                        <div className="text-[9px] font-bold text-slate-400 uppercase">Total do Acordo</div>
                        <div className="text-2xl font-black text-white italic tracking-tighter">R$ {config.totalAcordo.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
                    </div>
                </div>
              </div>
           </div>
        </div>
      )}

      {step === 'REVISAO' && (
        <div className="max-w-2xl mx-auto space-y-10 animate-in zoom-in-95">
           <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 shadow-2xl text-center space-y-8">
              <h1 className="text-3xl font-black uppercase italic tracking-tighter">Termo de Confissão</h1>
              <p className="text-sm text-slate-500 leading-relaxed font-medium uppercase">Acordo de liquidação de débitos em nome de <span className="font-black text-slate-900">{selectedClient}</span> no montante de <span className="font-black text-blue-600">R$ {Number(config.totalAcordo).toLocaleString('pt-BR')}</span>.</p>
              <div className="flex gap-4">
                 <button onClick={() => setStep('SIMULACAO')} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase italic">Ajustar</button>
                 <button onClick={async () => {
                    setLoading(true);
                    const res = await FinanceService.createSettlement({
                       id: `AC-${Date.now().toString().slice(-6)}`, 
                       cliente: selectedClient!, 
                       valorOriginal: totalOriginalSelecionado, 
                       valorAcordo: config.totalAcordo,
                       parcelas: config.parcelas, 
                       frequencia: config.frequencia, 
                       dataPrimeiraParcela: config.dataPrimeira,
                       dataCriacao: new Date().toISOString(), 
                       status: 'ATIVO', 
                       usuario: currentUser.name, 
                       intervaloDias: 30
                    }, selectedTitles, currentUser);
                    if (res) {
                       setToast({ msg: "ACORDO EFETIVADO!", type: 'success' });
                       if (onBack) onBack();
                       else {
                         setStep('GESTAO');
                         fetchData();
                       }
                    }
                    setLoading(false);
                 }} className="flex-[2] py-5 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-emerald-700 italic">Registrar Acordo</button>
              </div>
           </div>
        </div>
      )}

      {viewingSettlement && viewingDetails && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[200] flex items-center justify-center p-4">
           <div className="bg-white max-w-5xl w-full h-[90vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col border border-slate-100">
              <div className="px-8 py-6 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                 <div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter leading-none">{viewingSettlement.cliente}</h3>
                    <p className="text-[10px] font-black text-blue-600 uppercase mt-2 italic">Contrato: {viewingSettlement.id}</p>
                 </div>
                 <div className="flex gap-2">
                    <button 
                        onClick={generateConfessionPDF}
                        className="px-4 py-2 bg-slate-900 text-white hover:bg-blue-600 border border-transparent rounded-xl font-black text-[9px] uppercase transition-all flex items-center gap-2 shadow-lg"
                        title="Imprimir Termo"
                    >
                        <ICONS.Finance className="w-4 h-4" />
                        Imprimir Confissão
                    </button>
                    {/* Botão de Excluir Acordo */}
                    <button 
                        onClick={handleDeleteSettlement}
                        className="px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 border border-red-100 rounded-xl font-black text-[9px] uppercase transition-all flex items-center gap-2"
                        title="Cancelar acordo e restaurar dívida original"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        Excluir Acordo
                    </button>
                    <button onClick={() => setViewingSettlement(null)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-500 transition-all"><ICONS.Add className="w-5 h-5 rotate-45" /></button>
                 </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-slate-50/30">
                 {/* BLOCO 1: ORIGEM DA DÍVIDA */}
                 <div>
                    <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                       <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                       Origem da Dívida (Títulos Negociados)
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {viewingDetails.originals.map((orig) => (
                          <div key={orig.id} className="p-4 bg-white border border-slate-200 rounded-2xl flex justify-between items-center opacity-70 hover:opacity-100 transition-opacity">
                             <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase">NF Origem: {orig.numero_documento || orig.id}</p>
                                <p className="text-[10px] font-bold text-slate-600">Venc. Original: {orig.data_vencimento ? new Date(orig.data_vencimento).toLocaleDateString('pt-BR') : '-'}</p>
                             </div>
                             <div className="text-right">
                                <p className="text-sm font-black text-slate-800">R$ {Number(orig.valor_documento).toLocaleString('pt-BR')}</p>
                                <span className="text-[7px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-black uppercase">BLOQUEADO</span>
                             </div>
                          </div>
                       ))}
                    </div>
                 </div>

                 {/* BLOCO 2: PARCELAMENTO */}
                 <div>
                    <h4 className="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                       <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                       Plano de Pagamento (Parcelas)
                    </h4>
                    <div className="space-y-3">
                       {(viewingDetails.installments || []).map((inst, i) => (
                          <div key={inst.id} className="p-5 bg-white border border-slate-100 rounded-2xl flex justify-between items-center group shadow-sm hover:shadow-md transition-all">
                             <div><p className="text-[10px] font-black text-slate-400 uppercase italic">Parcela {i+1}</p><p className="font-black text-slate-900 text-sm">Vencimento: {inst.data_vencimento || '---'}</p></div>
                             <div className="flex items-center gap-4 text-right">
                                <div>
                                  <p className="text-base font-black text-slate-900 italic">R$ {(Number(inst.valor_documento) || 0).toLocaleString('pt-BR')}</p>
                                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${inst.situacao === 'PAGO' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>{inst.situacao}</span>
                                </div>
                                {inst.situacao !== 'PAGO' && (
                                  <button 
                                      onClick={() => handleLiquidate(inst.id, Number(inst.valor_documento))} 
                                      className="px-4 py-2 bg-emerald-100 text-emerald-700 rounded-xl font-black text-[9px] uppercase hover:bg-emerald-200 transition-all ml-2"
                                  >
                                      Baixar
                                  </button>
                                )}
                             </div>
                          </div>
                       ))}
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default SettlementModule;
