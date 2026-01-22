
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { User, StockItem, MasterProduct, CompanySettings } from '../types';
import { ICONS, INBOUND_REASONS } from '../constants';
import Toast from './Toast';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

const InboundForm: React.FC<{ user: User, onSuccess: () => void }> = ({ user, onSuccess }) => {
  const [catalog, setCatalog] = useState<MasterProduct[]>([]);
  const [draftItems, setDraftItems] = useState<StockItem[]>([]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importStaging, setImportStaging] = useState<(StockItem & { assignedLpn: string })[] | null>(null);
  
  const [formData, setFormData] = useState<any>({
    sku: '', nome: '', categoria: '', marca: '', fornecedor: '',
    larguraL: 1.52, metragemPadrao: 15, estoqueMinimo: 0,
    coluna: '', prateleira: '', quantMl: 0, lote: '', 
    nfControle: '', custoUnitario: 0, nCaixa: '', motivoEntrada: INBOUND_REASONS[0],
    observacao: ''
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);

  const generateRandomLpn = () => {
    // Formato solicitado: NZ-XXXX (4 dígitos numéricos)
    const random = Math.floor(1000 + Math.random() * 9000).toString();
    return `NZ-${random}`;
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [currentCatalog, settings] = await Promise.all([
          DataService.getMasterCatalog(),
          DataService.getCompanySettings()
        ]);
        setCatalog(currentCatalog);
        setCompanySettings(settings);
      } catch (e) {
        console.error("Error fetching initial data for InboundForm:", e);
        setToast({ msg: "Erro ao carregar catálogo.", type: 'error' });
      }
    };
    fetchData();
  }, []);

  const generateInboundChecklistPDF = (items: StockItem[]) => {
    if (items.length === 0) return;
    try {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 15;
        let y = 20;
        
        const colPositions = {
            lpn: margin + 2,
            sku: margin + 25,
            desc: margin + 55,
            lote: margin + 115,
            local: margin + 140,
            qtd: pageWidth - margin - 2,
        };

        const drawHeader = (isContinuation = false) => {
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.text(isContinuation ? 'ROMANEIRO DE CONFERÊNCIA (Continuação)' : 'ROMANEIRO DE CONFERÊNCIA - ENTRADA', pageWidth / 2, y, { align: 'center' });
            y += 10;
            if (!isContinuation) {
              doc.setFontSize(9);
              doc.setFont('helvetica', 'normal');
              doc.text(`DATA: ${new Date().toLocaleString('pt-BR')}`, margin, y);
              doc.text(`OPERADOR: ${user.name.toUpperCase()}`, pageWidth - margin, y, { align: 'right' });
              y += 5;
              doc.text(`TOTAL DE VOLUMES: ${items.length}`, margin, y);
            }
            y += 15;

            // Table Header
            doc.setFillColor(241, 245, 249); // slate-100
            doc.rect(margin, y - 5, pageWidth - (margin * 2), 8, 'F');
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(100, 116, 139); // slate-500
            
            doc.text('LPN', colPositions.lpn, y);
            doc.text('SKU', colPositions.sku, y);
            doc.text('DESCRIÇÃO', colPositions.desc, y);
            doc.text('LOTE', colPositions.lote, y);
            doc.text('LOCAL', colPositions.local, y);
            doc.text('QTD (ML)', colPositions.qtd, y, { align: 'right' });
            
            y += 8;
        };

        drawHeader();

        // Table Body
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(15, 23, 42); // slate-900

        items.forEach((item, index) => {
            if (y > 275) {
                doc.addPage();
                y = 20;
                drawHeader(true);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(15, 23, 42);
            }

            const isEven = index % 2 === 0;
            if (isEven) {
                doc.setFillColor(248, 250, 252); // slate-50
                doc.rect(margin, y - 4, pageWidth - (margin * 2), 7, 'F');
            }

            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.text(item.lpn, colPositions.lpn, y);
            
            doc.setFont('helvetica', 'normal');
            doc.text(item.sku, colPositions.sku, y);
            
            doc.setFontSize(8);
            const truncatedDesc = item.nome.length > 35 ? item.nome.substring(0, 35) + '...' : item.nome;
            doc.text(truncatedDesc, colPositions.desc, y);
            
            doc.setFontSize(9);
            doc.text(item.lote, colPositions.lote, y);
            doc.text(`${item.coluna}-${item.prateleira}`, colPositions.local, y);
            doc.text(Number(item.quantMl).toFixed(2), colPositions.qtd, y, { align: 'right' });
            
            y += 7; // Fixed row height for single-line layout
        });

        doc.save(`Romaneiro_Entrada_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
        console.error("PDF Generation Error:", e);
        setToast({ msg: 'ERRO AO GERAR PDF.', type: 'error' });
    }
  };

  const downloadTemplate = () => {
    const headers = "sku;quantMl;lote;nfControle;coluna;prateleira;nCaixa;observacao;motivoEntrada";
    const example = "\nNZW01;15.50;LOTE-ABC;NF-12345;A;1;CX-81;OK;Compra";
    const blob = new Blob(["\ufeff" + headers + example], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'modelo_entrada_nzstok_logistico.csv');
    link.click();
  };

  const filteredCatalog = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const term = searchTerm.toLowerCase();
    return catalog.filter(p => p.sku.toLowerCase().includes(term) || p.nome.toLowerCase().includes(term)).slice(0, 5);
  }, [catalog, searchTerm]);

  const selectMaster = (p: MasterProduct) => {
    setFormData({ 
      ...formData, 
      sku: p.sku, nome: p.nome, categoria: p.categoria,
      quantMl: p.metragemPadrao || 0, larguraL: p.larguraL || 1.52, 
      marca: (p.marca || '').toUpperCase(), fornecedor: (p.fornecedor || '').toUpperCase(),
      custoUnitario: p.custoUnitario || 0, estoqueMinimo: p.estoqueMinimo || 0,
      metragemPadrao: p.metragemPadrao || 15
    });
    setSearchTerm(`${p.sku} | ${p.nome}`.toUpperCase());
    setShowResults(false);
  };

  const addItemToDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.sku || !formData.quantMl || !formData.lote || !formData.nfControle) {
      setToast({ msg: 'PREENCHA OS CAMPOS OBRIGATÓRIOS.', type: 'error' });
      return;
    }
    
    const qty = Number(formData.quantMl);
    const std = Number(formData.metragemPadrao || 15);
    const calculatedStatus = qty < std ? 'ROLO ABERTO' : 'ROLO FECHADO';

    const newItem: StockItem = {
      ...formData,
      lpn: generateRandomLpn(),
      statusRolo: calculatedStatus, 
      nCaixa: formData.nCaixa || 'N/A',
      // Default para vazio se não preenchido
      coluna: formData.coluna ? formData.coluna.toUpperCase() : 'GERAL',
      prateleira: formData.prateleira ? formData.prateleira.toUpperCase() : 'CHÃO',
      ultAtuali: new Date().toISOString(), 
      responsavel: user.name,
      dataEntrada: new Date().toISOString(),
      quantMl: qty,
      larguraL: Number(formData.larguraL),
      custoUnitario: Number(formData.custoUnitario || 0),
      estoqueMinimo: Number(formData.estoqueMinimo || 0),
      metragemPadrao: std,
    };
    
    setDraftItems([newItem, ...draftItems]);
    // Mantém a localização para facilitar próxima entrada
    setFormData({ 
      ...formData, 
      sku: '', nome: '', categoria: '', marca: '', fornecedor: '', 
      quantMl: 0, lote: '', nfControle: '', custoUnitario: 0, 
      nCaixa: '', observacao: '', 
      motivoEntrada: formData.motivoEntrada,
    });
    setSearchTerm('');
    setToast({ msg: 'VOLUME ADICIONADO AO CHECKOUT.', type: 'success' });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const csv = event.target?.result as string;
        const lines = csv.split(/\r?\n/).filter(l => l.trim() !== "");
        if (lines.length < 2) throw new Error("Arquivo sem dados suficientes");
        
        let separator = ';'; 
        if (lines[0].includes(',')) separator = ',';
        if (lines[0].includes('|')) separator = '|';

        const headers = lines[0].toLowerCase().split(separator).map(h => h.trim());
        const items: any[] = [];

        for (const line of lines.slice(1)) {
          const values = line.split(separator).map(v => v.trim());
          const item: any = { 
            observacao: '', nCaixa: 'N/A', 
            statusRolo: 'ROLO FECHADO', 
            motivoEntrada: INBOUND_REASONS[0], custoUnitario: 0,
            coluna: 'GERAL', prateleira: 'CHÃO'
          };

          headers.forEach((h, i) => {
            const val = values[i];
            if (!val) return;
            if (h.includes('sku')) item.sku = val.toUpperCase();
            else if (h.includes('ml') || h.includes('quant')) item.quantMl = Number(val.replace(',', '.'));
            else if (h.includes('lote')) item.lote = val.toUpperCase();
            else if (h.includes('nf') || h.includes('controle')) item.nfControle = val.toUpperCase();
            else if (h.includes('col')) item.coluna = val.toUpperCase();
            else if (h.includes('prat') || h.includes('niv')) item.prateleira = val.toUpperCase();
            else if (h.includes('caixa')) item.nCaixa = val.toUpperCase();
            else if (h.includes('obs')) item.observacao = val;
            else if (h.includes('motivo entrada')) item.motivoEntrada = val;
            else if (h.includes('status rolo')) item.statusRolo = val.toUpperCase();
          });

          const master = catalog.find(p => p.sku === item.sku);
          if (item.sku && master) {
            const lpn = generateRandomLpn();
            const stdMetragem = Number(master.metragemPadrao || 15);
            const inputQuant = Number(item.quantMl || 0);
            
            let calculatedStatus = item.statusRolo; 
            if (!headers.some(h => h.includes('status rolo'))) {
               calculatedStatus = inputQuant < stdMetragem ? 'ROLO ABERTO' : 'ROLO FECHADO';
            }

            items.push({ 
              ...master, ...item, assignedLpn: lpn, lpn: lpn,
              ultAtuali: new Date().toISOString(), 
              responsavel: user.name, 
              dataEntrada: new Date().toISOString(),
              quantMl: inputQuant, 
              larguraL: Number(item.larguraL || master.larguraL || 1.52),
              custoUnitario: Number(master.custoUnitario || 0), 
              estoqueMinimo: Number(item.estoqueMinimo || master.estoqueMinimo || 0),
              metragemPadrao: stdMetragem,
              statusRolo: calculatedStatus
            });
          }
        }
        if (items.length > 0) setImportStaging(items);
        else setToast({ msg: 'Nenhum SKU válido encontrado.', type: 'error' });
      } catch (err: any) {
        setToast({ msg: `ERRO CSV: ${err.message}`, type: 'error' });
      } finally {
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const confirmImport = () => {
    if (importStaging && importStaging.length > 0) {
        setDraftItems([...draftItems, ...importStaging]);
        setImportStaging(null);
        setIsImportModalOpen(false);
        setToast({ msg: `${importStaging.length} itens importados para conferência.`, type: 'success' });
    }
  };

  const handleFinalSubmit = async () => {
    if (draftItems.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await DataService.processInboundBatch(draftItems, user);
      if (res.success) {
        setToast({ msg: 'CARGA REGISTRADA! GERANDO ROMANEIRO...', type: 'success' });
        generateInboundChecklistPDF(draftItems);
        setDraftItems([]);
        setTimeout(onSuccess, 2000);
      } else throw new Error(res.message);
    } catch (e: any) {
      setToast({ msg: `ERRO AO SALVAR: ${e.message}`, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const totals = useMemo(() => {
    return draftItems.reduce((acc, curr) => ({
      ml: acc.ml + curr.quantMl,
      count: acc.count + 1
    }), { ml: 0, count: 0 });
  }, [draftItems]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tighter uppercase italic leading-none">Registrar Entrada</h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2 italic">Entrada manual ou importação sem validação de layout</p>
        </div>
        <button onClick={() => setIsImportModalOpen(true)} className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-600 transition-all shadow-lg flex items-center space-x-2 italic">
          <ICONS.Upload className="w-4 h-4" />
          <span>Importar Lote CSV</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-8 bg-white p-10 rounded-[3rem] border border-slate-100 premium-shadow">
          <form onSubmit={addItemToDraft} className="space-y-10">
            <div className="space-y-3 relative" ref={searchRef}>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4 italic">1. Localizar no Catálogo Mestre</label>
              <input type="text" value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value.toUpperCase()); setShowResults(true); }} onFocus={() => setShowResults(true)} className="w-full px-8 py-5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-[2rem] outline-none font-black text-sm shadow-inner transition-all uppercase" placeholder="ESCANEIE OU DIGITE SKU..." />
              {showResults && filteredCatalog.length > 0 && (
                <div className="absolute top-full left-0 w-full mt-3 bg-white rounded-[2rem] shadow-2xl border border-slate-100 z-[100] overflow-hidden">
                  {filteredCatalog.map(p => (
                    <button key={p.sku} type="button" onClick={() => selectMaster(p)} className="w-full px-8 py-4 text-left hover:bg-blue-50 flex justify-between items-center border-b border-slate-50 last:border-0 group transition-all">
                      <div className="flex items-center space-x-4">
                        <span className="bg-slate-900 text-white text-[8px] font-black px-2.5 py-1 rounded-lg group-hover:bg-blue-600 uppercase italic">SKU: {p.sku}</span>
                        <p className="font-black text-slate-800 text-[10px] uppercase tracking-tight">{p.nome}</p>
                      </div>
                      <p className="text-[8px] font-black text-blue-600 uppercase italic">{p.metragemPadrao} ML</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <div className="space-y-1.5">
                <label className="text-[9px] font-black text-blue-600 uppercase ml-2 tracking-widest italic">2. Metragem Entrada (ML) *</label>
                <input type="number" step="0.01" value={formData.quantMl || ''} onChange={e => setFormData({...formData, quantMl: parseFloat(e.target.value)})} className="w-full px-8 py-5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-[1.8rem] font-black text-2xl text-center shadow-inner italic outline-none" placeholder="0.00" />
            </div>

            {/* Nova Seção: Pátio e Logística */}
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                   <div className="w-1.5 h-6 bg-emerald-600 rounded-full"></div>
                   <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] italic">Pátio e Logística</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Lote *</label>
                      <input value={formData.lote} onChange={e => setFormData({...formData, lote: e.target.value.toUpperCase()})} className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase" placeholder="LOTE FABRICANTE" />
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">NF / Controle *</label>
                      <input value={formData.nfControle} onChange={e => setFormData({...formData, nfControle: e.target.value.toUpperCase()})} className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase" placeholder="Nº NF..." />
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Origem (Fornecedor)</label>
                      <input value={formData.fornecedor} onChange={e => setFormData({...formData, fornecedor: e.target.value.toUpperCase()})} className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase" placeholder="FORNECEDOR" />
                   </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Coluna</label>
                      <input type="text" value={formData.coluna} onChange={e => setFormData({...formData, coluna: e.target.value.toUpperCase()})} className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase" placeholder="EX: A, B, Z1..." />
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Nível / Prateleira</label>
                      <input type="text" value={formData.prateleira} onChange={e => setFormData({...formData, prateleira: e.target.value.toUpperCase()})} className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase" placeholder="EX: 1, 2, CHÃO..." />
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Nº Caixa</label>
                      <input value={formData.nCaixa} onChange={e => setFormData({...formData, nCaixa: e.target.value.toUpperCase()})} className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase" placeholder="EX: 81" />
                   </div>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-2 tracking-widest italic">Motivo da Entrada *</label>
                  <select value={formData.motivoEntrada} onChange={e => setFormData({...formData, motivoEntrada: e.target.value})} className="w-full px-8 py-5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-[1.8rem] font-black text-xs uppercase shadow-inner italic outline-none cursor-pointer">
                    {INBOUND_REASONS.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                  </select>
               </div>
               <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-2 tracking-widest italic">Observações</label>
                  <input value={formData.observacao} onChange={e => setFormData({...formData, observacao: e.target.value.toUpperCase()})} className="w-full px-8 py-5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-[1.8rem] font-black text-xs outline-none shadow-inner italic" placeholder="EMBALAGEM DANIFICADA..." />
               </div>
            </div>

            <button type="submit" className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-sm hover:bg-blue-600 transition-all uppercase tracking-widest shadow-2xl active:scale-95 italic">Lançar Entrada</button>
          </form>
        </div>

        <div className="lg:col-span-4 bg-[#0F172A] p-10 rounded-[3.5rem] shadow-xl flex flex-col h-fit sticky top-10 border border-slate-800">
          <div className="flex justify-between items-start mb-8 border-b border-slate-800 pb-6">
            <div>
              <h3 className="text-4xl font-black text-white tracking-tighter italic leading-none uppercase">CONFERIR</h3>
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-3 leading-none">ENTRADA MANUAL</p>
            </div>
            <span className="bg-blue-600 text-white px-4 py-2 rounded-2xl font-black text-[10px] uppercase tracking-widest">{totals.count} VOL</span>
          </div>

          <div className="flex-1 space-y-4 mb-8 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {draftItems.map((it, idx) => (
              <div key={idx} className="bg-slate-800/40 border border-slate-700 p-6 rounded-[2.5rem] flex justify-between items-center group animate-in slide-in-from-right-4 transition-all shadow-lg">
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-[7px] font-black text-white bg-blue-600 px-2 py-0.5 rounded uppercase italic">LPN: {it.lpn}</span>
                    <p className="text-blue-400 font-black text-[11px] uppercase tracking-tight">{it.sku}</p>
                  </div>
                  <p className="text-[9px] text-slate-300 font-bold uppercase truncate max-w-[150px] leading-tight">{it.nome}</p>
                  <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">{it.statusRolo} • {it.coluna}-{it.prateleira}</p>
                </div>
                <button onClick={() => setDraftItems(draftItems.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-400 transition-transform hover:scale-110"><ICONS.Add className="w-6 h-6 rotate-45" /></button>
              </div>
            ))}
            {draftItems.length === 0 && <div className="py-24 text-center opacity-10 flex flex-col items-center"><ICONS.Inventory className="w-16 h-16 text-white mb-6" /><p className="text-white text-[10px] font-black uppercase tracking-widest italic">Aguardando Lançamentos</p></div>}
          </div>

          <div className="bg-slate-950 p-8 rounded-[2.5rem] border border-slate-800 mb-8 text-center shadow-inner">
             <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-3 leading-none italic">Total Geral Solicitado</p>
             <h4 className="text-5xl font-black text-blue-500 tracking-tighter italic">{totals.ml.toFixed(2)} <span className="text-sm opacity-30 text-white uppercase italic">ML</span></h4>
          </div>

          <button onClick={handleFinalSubmit} disabled={draftItems.length === 0 || isSubmitting} className="w-full py-6 bg-emerald-600 text-white rounded-[2rem] font-black text-lg hover:bg-emerald-500 disabled:opacity-20 transition-all uppercase tracking-widest shadow-xl active:scale-95 italic">
            {isSubmitting ? 'SINCRONIZANDO...' : 'CONFIRMAR CARGA'}
          </button>
        </div>
      </div>

      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[120] flex items-center justify-center p-6">
           <div className={`bg-white max-w-6xl w-full rounded-[3.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 border border-slate-100 flex flex-col h-[85vh]`}>
              <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/30 shrink-0">
                 <h3 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter">
                    {importStaging ? 'Revisão de Lote CSV' : 'Entrada em Massa'}
                 </h3>
                 <button onClick={() => { setIsImportModalOpen(false); setImportStaging(null); }} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500"><ICONS.Add className="w-6 h-6 rotate-45" /></button>
              </div>
              
              {!importStaging ? (
                <div className="p-12 text-center space-y-8 flex-1 flex flex-col justify-center">
                   <div className="w-24 h-24 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto shadow-inner"><ICONS.Upload className="w-12 h-12" /></div>
                   <div className="max-w-xl mx-auto">
                      <p className="text-slate-500 font-medium text-sm mb-8">Baixe nosso modelo logístico oficial. As colunas e prateleiras são texto livre.</p>
                      <div className="flex gap-4 justify-center">
                         <button onClick={downloadTemplate} className="px-8 py-4 bg-white border-2 border-slate-200 text-slate-700 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center space-x-3">
                            <span>Baixar Modelo</span>
                         </button>
                         <button onClick={() => fileInputRef.current?.click()} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-blue-600 transition-all flex items-center space-x-3">
                            <ICONS.Add className="w-5 h-5" />
                            <span>Selecionar Arquivo</span>
                         </button>
                      </div>
                      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
                   </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 overflow-hidden">
                   <div className="flex-1 overflow-auto p-8 custom-scrollbar">
                      <table className="w-full text-left">
                         <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                            <tr>
                               <th className="px-6 py-4">Protocolo LPN (Auto)</th>
                               <th className="px-6 py-4">Material / SKU</th>
                               <th className="px-6 py-4 text-center">Localização</th>
                               <th className="px-6 py-4 text-right">Saldo (ML)</th>
                               <th className="px-6 py-4 text-right">Status</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-50 text-[11px]">
                            {importStaging.map((item, idx) => (
                               <tr key={idx} className="hover:bg-blue-50/30 transition-all">
                                  <td className="px-6 py-4 font-black text-blue-600">{item.lpn}</td>
                                  <td className="px-6 py-4">
                                     <p className="font-black text-slate-900">{item.sku}</p>
                                     <p className="text-[9px] text-slate-400 uppercase truncate max-w-[200px]">{item.nome}</p>
                                  </td>
                                  <td className="px-6 py-4 text-center font-bold text-slate-500">COL {item.coluna}-{item.prateleira}</td>
                                  <td className="px-6 py-4 text-right font-black text-slate-900">{item.quantMl.toFixed(2)}</td>
                                  <td className="px-6 py-4 text-right font-bold text-slate-400">
                                     <span className={`px-2 py-0.5 rounded text-[8px] border ${item.statusRolo === 'ROLO ABERTO' ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>
                                        {item.statusRolo}
                                     </span>
                                  </td>
                               </tr>
                            ))}
                         </tbody>
                      </table>
                   </div>
                   <div className="p-8 border-t border-slate-50 flex justify-between items-center bg-slate-50/30">
                      <div className="space-y-1">
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resumo do Lote</p>
                         <p className="text-xl font-black text-slate-900 uppercase italic">{importStaging.length} Volumes</p>
                      </div>
                      <div className="flex gap-4">
                         <button onClick={() => setImportStaging(null)} className="px-8 py-4 bg-white border border-slate-200 text-slate-500 font-black text-[9px] uppercase rounded-2xl hover:text-red-500 transition-all">Cancelar</button>
                         <button onClick={confirmImport} className="px-10 py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-emerald-500 transition-all">Confirmar e Importar</button>
                      </div>
                   </div>
                </div>
              )}
           </div>
        </div>
      )}
    </div>
  );
};

export default InboundForm;
