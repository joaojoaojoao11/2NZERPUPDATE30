
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { WithdrawalReason, User, StockItem, CompanySettings } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import { jsPDF } from 'jspdf';

interface WithdrawalFormProps {
  currentUser: User;
  onSuccess: () => void;
}

type Step = 'ACTION_SELECT' | 'FORM_ENTRY';

const WithdrawalForm: React.FC<WithdrawalFormProps> = ({ currentUser, onSuccess }) => {
  const [step, setStep] = useState<Step>('ACTION_SELECT');
  const [selectedReason, setSelectedReason] = useState<WithdrawalReason | null>(null);
  
  const [inventory, setInventory] = useState<StockItem[]>([]);
  const [draftItems, setDraftItems] = useState<any[]>([]);
  
  const [selectedLpn, setSelectedLpn] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showResults, setShowResults] = useState(false);
  
  const [globalData, setGlobalData] = useState({
    cliente: '',
    pedido: '',
    transportadora: '',
    volumes: '',
    notaFiscal: ''
  });

  const [addFormData, setAddFormData] = useState({
    qtyRaw: '',
    relato: ''
  });
  
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      DataService.getInventory(),
      DataService.getCompanySettings()
    ]).then(([invData, settings]) => {
        setInventory(invData.filter(i => i.quantMl > 0.001));
        setCompanySettings(settings);
      })
      .catch(e => {
        console.error("Error fetching inventory for withdrawal:", e);
        setToast({ msg: "Erro ao carregar dados.", type: 'error' });
      });
  }, []);

  const selectedItem = useMemo(() => 
    inventory.find(i => String(i.lpn) === String(selectedLpn)), 
  [inventory, selectedLpn]);

  const filteredResults = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term || term.length < 1 || (selectedItem && searchTerm === `${selectedItem.sku} | LPN: ${selectedItem.lpn}`)) return [];
    
    const draftLpns = new Set(draftItems.map(d => d.lpn));
    
    return inventory.filter(item => {
      if (draftLpns.has(item.lpn)) return false;
      
      const lpn = String(item.lpn || '').toLowerCase();
      const sku = String(item.sku || '').toLowerCase();
      const nome = String(item.nome || '').toLowerCase();
      const lote = String(item.lote || '').toLowerCase();
      const fornecedor = String(item.fornecedor || '').toLowerCase();
      
      return lpn.includes(term) || 
             sku.includes(term) || 
             nome.includes(term) || 
             lote.includes(term) ||
             fornecedor.includes(term);
    }).slice(0, 100);
  }, [inventory, searchTerm, draftItems, selectedItem]);

  const totals = useMemo(() => {
    return draftItems.reduce((acc, curr) => ({
      ml: acc.ml + curr.quantidade,
      count: acc.count + 1
    }), { ml: 0, count: 0 });
  }, [draftItems]);

  const generateSaleLabel = (items: any[], meta: typeof globalData) => {
    try {
      // Configuração: 3.94 inch x 5.9 inch (aprox 100mm x 150mm)
      const doc = new jsPDF({
        orientation: 'p',
        unit: 'in',
        format: [3.94, 5.9]
      });

      const totalVolumes = parseInt(meta.volumes) || 1;

      // Loop para gerar uma página para cada volume
      for (let currentVol = 1; currentVol <= totalVolumes; currentVol++) {
        if (currentVol > 1) doc.addPage();

        const pageWidth = 3.94;
        let y = 0.2; // Margem superior inicial (resetada a cada página)

        // 1. LOGO DA EMPRESA (Topo)
        if (companySettings?.logoUrl) {
          try {
            // Ajusta tamanho da imagem mantendo proporção (max width 2in, max height 1in)
            const imgProps = doc.getImageProperties(companySettings.logoUrl);
            const ratio = imgProps.width / imgProps.height;
            let imgWidth = 1.5; 
            let imgHeight = imgWidth / ratio;
            
            if (imgHeight > 0.8) {
              imgHeight = 0.8;
              imgWidth = imgHeight * ratio;
            }

            const xCenter = (pageWidth - imgWidth) / 2;
            doc.addImage(companySettings.logoUrl, 'PNG', xCenter, y, imgWidth, imgHeight);
            y += imgHeight + 0.2;
          } catch (e) {
            // Fallback se imagem falhar: Texto
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text((companySettings.name || 'NZERP').substring(0, 15), pageWidth / 2, y + 0.3, { align: 'center' });
            y += 0.5;
          }
        } else {
          // Fallback sem logo configurado
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.text('NZ LOGÍSTICA', pageWidth / 2, y + 0.3, { align: 'center' });
          y += 0.6;
        }

        // Linha separadora
        doc.setLineWidth(0.02);
        doc.line(0.2, y, 3.74, y);
        y += 0.2;

        // 2. DADOS PRINCIPAIS - AGORA NF EM DESTAQUE
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text('NOTA FISCAL', 0.2, y); // Label Alterada
        
        y += 0.25;
        doc.setFontSize(22);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        // Valor da NF em destaque grande
        doc.text(meta.notaFiscal || 'S/N', 0.2, y);
        
        // Pedido/Controle ao lado (secundário)
        if (meta.pedido) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.text(`PED: ${meta.pedido}`, 3.74, y, { align: 'right' });
        }

        y += 0.3;

        // 3. DESTINATÁRIO
        doc.setFillColor(245, 245, 245);
        doc.rect(0.2, y, 3.54, 0.6, 'F'); // Box background
        
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text('DESTINATÁRIO / CLIENTE', 0.3, y + 0.15);
        
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        // Quebra de linha se nome for muito longo
        const splitName = doc.splitTextToSize(meta.cliente || 'CLIENTE BALCÃO', 3.3);
        doc.text(splitName, 0.3, y + 0.35);
        
        y += 0.8;

        // 4. TRANSPORTE E VOLUMES
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.setFont('helvetica', 'normal');
        doc.text('TRANSPORTADORA', 0.2, y);
        doc.text('VOLUMES', 2.5, y);

        y += 0.2;
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        doc.text((meta.transportadora || 'RETIRA').substring(0, 18), 0.2, y);
        
        // Lógica de numeração de volumes: 1/2, 2/2 etc.
        const volumeText = totalVolumes > 1 ? `${currentVol}/${totalVolumes}` : (meta.volumes || '1');
        doc.text(volumeText, 2.5, y);

        y += 0.3;
        doc.setLineWidth(0.01);
        doc.line(0.2, y, 3.74, y);
        y += 0.2;

        // 5. LISTA DE ITENS (Resumida)
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('ITENS CONFERIDOS:', 0.2, y);
        y += 0.2;

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        
        items.forEach((item) => {
          if (y > 5.5) return; // Evita estourar a página
          const line = `[${item.lpn}] ${item.sku} - ${item.quantidade.toFixed(2)}m`;
          doc.text(line, 0.2, y);
          y += 0.15;
        });

        if (items.length > 8 && y > 5.5) {
           doc.setFontSize(7);
           doc.text('... ver romaneio completo para mais itens.', 0.2, 5.7);
        }
      }

      // Salvar
      doc.save(`ETIQUETA_EXPEDICAO_${meta.pedido || 'VENDA'}.pdf`);

    } catch (err) {
      console.error("Erro ao gerar PDF da etiqueta:", err);
      setToast({ msg: 'ERRO AO GERAR ETIQUETA PDF.', type: 'error' });
    }
  };

  const handleActionChoice = (reason: WithdrawalReason) => {
    setSelectedReason(reason);
    setStep('FORM_ENTRY');
  };

  const resetSession = () => {
    if (draftItems.length > 0 && !window.confirm("Isso limpará o rascunho atual. Continuar?")) return;
    setStep('ACTION_SELECT');
    setSelectedReason(null);
    setDraftItems([]);
    setGlobalData({ cliente: '', pedido: '', transportadora: '', volumes: '', notaFiscal: '' });
  };

  const handleSelect = (item: StockItem) => {
    setSelectedLpn(item.lpn);
    setSearchTerm(`${item.sku} | LPN: ${item.lpn}`);
    setShowResults(false);
  };

  const addItemToDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(addFormData.qtyRaw.replace(',', '.'));
    if (!selectedItem) return setToast({ msg: 'SELECIONE UM VOLUME.', type: 'error' });
    if (isNaN(qty) || qty <= 0) return setToast({ msg: 'METRAGEM INVÁLIDA.', type: 'error' });
    if (qty > selectedItem.quantMl + 0.001) return setToast({ msg: 'SALDO INSUFICIENTE.', type: 'error' });

    if (selectedReason === WithdrawalReason.VENDA && globalData.pedido.trim()) {
      const isUsed = await DataService.isOrderIdUsed(globalData.pedido.trim());
      if (isUsed) {
        setToast({ msg: `PEDIDO ERP ${globalData.pedido} JÁ UTILIZADO.`, type: 'error' });
        return;
      }
    }

    // Constrói o relato concatenando informações extras se for Venda ou Troca
    let finalRelato = addFormData.relato;
    if (selectedReason === WithdrawalReason.VENDA || selectedReason === WithdrawalReason.TROCA) {
      if (globalData.transportadora) finalRelato += ` | TRANSP: ${globalData.transportadora}`;
      if (globalData.volumes) finalRelato += ` | VOL: ${globalData.volumes}`;
      if (globalData.notaFiscal) finalRelato += ` | NF: ${globalData.notaFiscal}`;
    }

    const newItem = {
      lpn: selectedItem.lpn,
      sku: selectedItem.sku,
      nome: selectedItem.nome,
      categoria: selectedItem.categoria,
      lote: selectedItem.lote,
      quantidade: qty,
      motivo: selectedReason,
      relato: finalRelato,
      custoUnitario: selectedItem.custoUnitario,
      nfControle: selectedItem.nfControle,
      extra: { ...globalData, vendedor: currentUser.name }
    };

    setDraftItems([newItem, ...draftItems]);
    setSelectedLpn(null);
    setSearchTerm('');
    setAddFormData({ qtyRaw: '', relato: '' });
    setToast({ msg: 'ITEM ADICIONADO AO CHECKOUT.', type: 'success' });
  };

  const handleFinalSubmit = async () => {
    // Validação de Venda e Troca
    if ((selectedReason === WithdrawalReason.VENDA || selectedReason === WithdrawalReason.TROCA) && (!globalData.cliente || !globalData.pedido)) {
      return setToast({ msg: 'DADOS DO CLIENTE OBRIGATÓRIOS.', type: 'error' });
    }
    
    // Agora apenas DEFEITO exige validação estrita de pedido para aprovação se não tiver preenchido (mas a UI não pede obrigatoriedade explícita de campos além do form básico)
    if (selectedReason === WithdrawalReason.DEFEITO && !globalData.pedido) {
      return setToast({ msg: 'NÚMERO DO PEDIDO/CONTROLE OBRIGATÓRIO PARA DEFEITO.', type: 'error' });
    }

    setIsSubmitting(true);
    try {
      const response = await DataService.registerWithdrawalBatch(draftItems, currentUser);
      
      if (response.success) {
        let msg = 'SOLICITAÇÃO PROCESSADA COM SUCESSO!';
        
        if (selectedReason === WithdrawalReason.VENDA) {
          msg = 'VENDA EFETUADA! GERANDO ETIQUETA...';
          generateSaleLabel(draftItems, globalData);
        } else if (selectedReason === WithdrawalReason.TROCA) {
          msg = 'TROCA REGISTRADA! GERANDO ETIQUETA...';
          generateSaleLabel(draftItems, globalData);
        } else if (selectedReason === WithdrawalReason.AJUSTE) {
          msg = 'AJUSTE DE ESTOQUE CONCLUÍDO!';
        } else if (selectedReason === WithdrawalReason.DEFEITO) {
          msg = 'BAIXA POR AVARIA REGISTRADA!';
        }
        
        setToast({ msg, type: 'success' });
        setTimeout(onSuccess, 2000); 
      } else {
        throw new Error(String(response.message || "Falha desconhecida ao processar a saída."));
      }
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));
      setToast({ msg: `FALHA OPERACIONAL: ${errorMsg}`, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (step === 'ACTION_SELECT') {
    return (
      <div className="max-w-4xl mx-auto py-8 animate-in fade-in zoom-in-95 duration-500">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Registrar Saída</h2>
          <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.4em] mt-3 italic">Operação de Baixa e Incidentes</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            { id: WithdrawalReason.VENDA, label: 'Venda Comercial', desc: 'BAIXA DIRETA (SEM APROVAÇÃO)', icon: ICONS.Withdraw, color: 'bg-emerald-600' },
            { id: WithdrawalReason.TROCA, label: 'Troca Material', desc: 'BAIXA PARA SUBSTITUIÇÃO', icon: ICONS.Inventory, color: 'bg-blue-600' },
            { id: WithdrawalReason.DEFEITO, label: 'Avaria / Defeito', desc: 'BAIXA TÉCNICA DE PERDA', icon: ICONS.Alert, color: 'bg-red-600' },
            { id: WithdrawalReason.AJUSTE, label: 'Ajuste / Consumo', desc: 'BAIXA TÉCNICA INTERNA', icon: ICONS.Map, color: 'bg-slate-800' },
          ].map(action => (
            <button key={action.id} onClick={() => handleActionChoice(action.id)} className="group bg-white p-8 rounded-[2rem] shadow-sm hover:shadow-xl transition-all border border-slate-100 hover:border-blue-600 text-left flex items-start space-x-6 transform hover:-translate-y-1">
              <div className={`p-6 ${action.color} text-white rounded-2xl shadow-lg transition-transform duration-300 group-hover:rotate-3`}><action.icon className="w-8 h-8" /></div>
              <div className="pt-1">
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tighter italic leading-none">{action.label}</h3>
                <p className="text-[9px] font-black text-slate-400 tracking-widest mt-2 uppercase">{action.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-[1400px] mx-auto animate-in slide-in-from-right-10 duration-500 pb-12">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="lg:col-span-8 space-y-6">
        <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 overflow-visible">
          <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-50">
            <div className="flex items-center space-x-3">
              <div className={`p-3 rounded-xl text-white shadow-md ${selectedReason === WithdrawalReason.VENDA ? 'bg-emerald-600' : 'bg-slate-900'}`}><ICONS.Withdraw className="w-5 h-5" /></div>
              <div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">{selectedReason}</h2>
                <button onClick={resetSession} className="text-[9px] font-black text-blue-600 uppercase tracking-widest mt-1 hover:underline">← TROCAR OPERAÇÃO</button>
              </div>
            </div>
          </div>
          {selectedReason !== WithdrawalReason.AJUSTE && (
            <div className="bg-slate-50 p-6 rounded-[1.5rem] border border-slate-100 mb-8 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2">
                    {selectedReason === WithdrawalReason.VENDA ? 'PEDIDO ERP *' : 'PEDIDO DE ORIGEM *'}
                  </label>
                  <input value={globalData.pedido} onChange={e => setGlobalData({...globalData, pedido: e.target.value.toUpperCase()})} className="w-full px-6 py-3 bg-white border-2 border-transparent focus:border-blue-600 rounded-xl font-black text-sm outline-none transition-all tracking-tight uppercase" placeholder="#NÚMERO" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2">
                    {selectedReason === WithdrawalReason.VENDA ? 'PROJETO / CLIENTE *' : 'NOME DO CLIENTE *'}
                  </label>
                  <input value={globalData.cliente} onChange={e => setGlobalData({...globalData, cliente: e.target.value.toUpperCase()})} className="w-full px-6 py-3 bg-white border-2 border-transparent focus:border-blue-600 rounded-xl font-black text-sm outline-none transition-all tracking-tight uppercase" placeholder="NOME COMPLETO" />
                </div>
                
                {/* Campos para Venda e Troca */}
                {(selectedReason === WithdrawalReason.VENDA || selectedReason === WithdrawalReason.TROCA) && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2">
                        TRANSPORTADORA
                      </label>
                      <input 
                        value={globalData.transportadora} 
                        onChange={e => setGlobalData({...globalData, transportadora: e.target.value.toUpperCase()})} 
                        className="w-full px-6 py-3 bg-white border-2 border-transparent focus:border-blue-600 rounded-xl font-black text-sm outline-none transition-all tracking-tight uppercase" 
                        placeholder="EX: CORREIOS, JADLOG..." 
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2">
                        QTD. VOLUMES
                      </label>
                      <input 
                        type="number"
                        value={globalData.volumes} 
                        onChange={e => setGlobalData({...globalData, volumes: e.target.value})} 
                        className="w-full px-6 py-3 bg-white border-2 border-transparent focus:border-blue-600 rounded-xl font-black text-sm outline-none transition-all tracking-tight uppercase" 
                        placeholder="EX: 1, 2, 5..." 
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2">
                        NF / PEDIDO
                      </label>
                      <input 
                        value={globalData.notaFiscal} 
                        onChange={e => setGlobalData({...globalData, notaFiscal: e.target.value.toUpperCase()})} 
                        className="w-full px-6 py-3 bg-white border-2 border-transparent focus:border-blue-600 rounded-xl font-black text-sm outline-none transition-all tracking-tight uppercase" 
                        placeholder="NÚMERO DOC..." 
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          <form onSubmit={addItemToDraft} className="space-y-8">
            <div className="space-y-2 relative z-[60]" ref={searchRef}>
              <label className="text-[9px] font-black text-blue-600 uppercase tracking-[0.3em] ml-2 italic">1. LOCALIZAR VOLUME EM PÁTIO</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={searchTerm} 
                  onChange={(e) => { 
                    setSearchTerm(e.target.value.toUpperCase()); 
                    setShowResults(true);
                    if (selectedLpn) setSelectedLpn(null);
                  }} 
                  onFocus={() => setShowResults(true)} 
                  className={`w-full px-8 py-4 rounded-2xl outline-none font-black text-lg transition-all shadow-inner tracking-tight uppercase ${selectedLpn ? 'border-2 border-blue-600 bg-blue-50 text-blue-900' : 'bg-slate-50 border-2 border-transparent focus:border-blue-600 focus:bg-white'}`} 
                  placeholder="DIGITE SKU, NOME, LOTE OU ESCANEIE LPN..." 
                />
                {searchTerm && (
                  <button type="button" onClick={() => { setSelectedLpn(null); setSearchTerm(''); setShowResults(false); }} className="absolute right-6 top-3.5 text-slate-400 hover:text-red-500 hover:scale-110 transition-all">
                    <ICONS.Add className="w-6 h-6 rotate-45" />
                  </button>
                )}
              </div>
              
              {showResults && filteredResults.length > 0 && (
                <div className="absolute top-full left-0 w-full mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 z-[100] max-h-[350px] overflow-y-auto custom-scrollbar">
                  {filteredResults.map(item => (
                    <button key={item.lpn} type="button" onClick={() => handleSelect(item)} className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-600 group transition-all border-b border-slate-50 last:border-0">
                      <div className="flex items-center space-x-4">
                        <div className="flex flex-col items-center">
                          <span className="bg-slate-900 text-white text-[8px] font-black px-2 py-0.5 rounded group-hover:bg-white group-hover:text-blue-600 transition-all uppercase mb-1">LPN</span>
                          <span className="text-[10px] font-black text-slate-900 group-hover:text-white">{item.lpn}</span>
                        </div>
                        <div className="text-left">
                          <p className="font-black text-slate-800 text-xs group-hover:text-white transition-colors uppercase tracking-tight">{item.sku} • {item.marca}</p>
                          <p className="text-[9px] text-slate-400 font-bold uppercase group-hover:text-blue-100 transition-colors truncate max-w-[300px]">{item.nome}</p>
                          <p className="text-[8px] font-black text-emerald-600 group-hover:text-emerald-300 uppercase italic">LOTE: {item.lote}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-black text-slate-900 text-sm group-hover:text-white transition-colors uppercase tracking-tighter">{item.quantMl.toFixed(2)} ML</p>
                        <p className="text-[8px] font-black text-blue-600 uppercase group-hover:text-blue-200">{item.coluna}-{item.prateleira}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedItem && (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-400">
                <div className="bg-slate-950 p-6 rounded-[2rem] text-white shadow-lg flex justify-between items-center border border-white/5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[8px] font-black uppercase text-blue-400 tracking-widest mb-1 italic">Material Selecionado</p>
                    <h3 className="text-xl font-black tracking-tighter leading-none uppercase italic truncate mr-4">{selectedItem.nome}</h3>
                    <div className="flex items-center space-x-4 mt-3">
                       <p className="text-[9px] font-black uppercase tracking-widest bg-white/5 px-2 py-1 rounded-md border border-white/10">LOTE: {selectedItem.lote} | {selectedItem.lpn}</p>
                       <p className="text-[9px] font-black uppercase tracking-widest bg-white/5 px-2 py-1 rounded-md border border-white/10">POS: {selectedItem.coluna}-{selectedItem.prateleira}</p>
                    </div>
                  </div>
                  <div className="text-right pl-6 border-l border-white/10 shrink-0">
                     <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest mb-1">Saldo em Pátio</p>
                     <p className="text-4xl font-black tracking-tighter leading-none">{selectedItem.quantMl.toFixed(2)} <span className="text-sm opacity-30">ML</span></p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2 italic">2. METRAGEM SAÍDA (ML) *</label>
                    <div className="relative">
                      <input type="text" value={addFormData.qtyRaw} onChange={e => setAddFormData({...addFormData, qtyRaw: e.target.value.replace(/\./g, ',').replace(/[^0-9,]/g, '')})} className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-[1.2rem] outline-none font-black text-3xl text-center shadow-inner transition-all tracking-tighter" placeholder="0,00" autoFocus />
                      <span className="absolute right-6 top-6 text-slate-300 font-black text-[10px] uppercase">ML</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2 italic">3. DETALHES DA RETIRADA</label>
                    <textarea value={addFormData.relato} onChange={e => setAddFormData({...addFormData, relato: e.target.value.toUpperCase()})} rows={2} className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-[1.2rem] outline-none font-bold text-xs resize-none shadow-inner transition-all uppercase tracking-tight leading-relaxed" placeholder="JUSTIFICATIVA OU OBSERVAÇÕES..." />
                  </div>
                </div>
                <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[1.5rem] font-black text-sm hover:bg-blue-600 transition-all uppercase tracking-[0.3em] shadow-xl active:scale-95 italic">LANÇAR NO CHECKOUT</button>
              </div>
            )}
          </form>
          {!selectedItem && (
            <div className="py-16 flex flex-col items-center justify-center border-2 border-dashed border-slate-100 rounded-[2rem] opacity-20 mt-6"><ICONS.Inventory className="w-12 h-12 mb-4 text-slate-300" /><p className="font-black text-slate-400 uppercase tracking-widest text-[9px] italic">Aguardando Identificação de Volume</p></div>
          )}
        </div>
      </div>
      <div className="lg:col-span-4 bg-[#0F172A] p-8 rounded-[2.5rem] shadow-xl flex flex-col h-fit sticky top-10 border border-slate-800">
        <div className="flex justify-between items-center mb-8 border-b border-slate-800 pb-4">
          <div><h3 className="text-white font-black uppercase tracking-tighter text-2xl italic leading-none">CHECKOUT</h3><p className="text-[8px] font-black text-slate-500 uppercase tracking-[0.3em] mt-2 leading-none">REVISÃO DE SAÍDA</p></div>
          <div className="bg-blue-600/10 text-blue-500 px-3 py-1.5 rounded-lg border border-blue-600/20 font-black text-[9px] uppercase tracking-widest">{totals.count} VOL</div>
        </div>
        <div className="flex-1 space-y-3 mb-8 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
          {draftItems.map((it, idx) => (
            <div key={idx} className="bg-slate-800/30 border border-slate-700/50 p-4 rounded-2xl flex justify-between items-center group animate-in slide-in-from-right-4 hover:bg-slate-800/80 transition-all">
              <div className="min-w-0 flex-1 pr-3">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-[8px] font-black text-blue-400 border border-blue-400/30 px-1.5 py-0.5 rounded leading-none">{it.lpn}</span>
                  <p className="text-white font-black text-[10px] uppercase truncate tracking-tight">{it.sku}</p>
                </div>
                <p className="text-[9px] text-slate-400 font-bold uppercase truncate leading-none mb-2">{it.nome}</p>
                <p className="text-emerald-400 font-mono font-black text-lg tracking-tighter leading-none">{it.quantidade.toFixed(2)} ML</p>
              </div>
              <button onClick={() => setDraftItems(draftItems.filter((_, i) => i !== idx))} className="text-slate-600 hover:text-red-500 p-2 rounded-xl transition-all"><ICONS.Add className="w-5 h-5 rotate-45" /></button>
            </div>
          ))}
        </div>
        <div className="bg-slate-950 p-6 rounded-[1.5rem] border border-slate-800 mb-8 text-center">
           <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 leading-none italic">Total Geral Despachado</p>
           <h4 className="text-4xl font-black text-blue-500 tracking-tighter leading-none mono">{totals.ml.toFixed(2)} <span className="text-xs opacity-40 text-white font-black">ML</span></h4>
        </div>
        <button onClick={handleFinalSubmit} disabled={draftItems.length === 0 || isSubmitting} className="w-full py-5 bg-emerald-600 text-white rounded-[1.2rem] font-black text-sm hover:bg-emerald-500 disabled:opacity-20 transition-all uppercase tracking-[0.3em] shadow-lg active:scale-95 italic leading-none">{isSubmitting ? 'EFETIVANDO...' : 'FINALIZAR SAÍDA'}</button>
      </div>
    </div>
  );
};

export default WithdrawalForm;
