
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DataService } from '../services/dataService';
import { FinanceService } from '../services/financeService'; // Adicionado FinanceService
import { AccountsPayable, APStagingItem, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import * as XLSX from 'xlsx';

const AccountsPayableModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [data, setData] = useState<AccountsPayable[]>([]);
  const [staging, setStaging] = useState<APStagingItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [showImportInstructions, setShowImportInstructions] = useState(false); // Novo estado
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchItems = async () => {
    setLoading(true);
    const items = await DataService.getAccountsPayable();
    setData(items);
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const downloadTemplate = () => {
    const headers = [
      "ID", 
      "Fornecedor", 
      "Data Emissão", 
      "Data Vencimento", 
      "Data Liquidação", 
      "Valor Documento", 
      "Valor Pago",
      "Saldo", 
      "Situação", 
      "Número Documento", 
      "Categoria", 
      "Histórico", 
      "Competência", 
      "Forma Pagamento", 
      "Chave PIX/Código Boleto"
    ];

    const data = [
      headers,
      ["AUTO", "EXEMPLO FORNECEDOR LTDA", "2024-01-01", "2024-01-30", "", 1500.50, 0, 1500.50, "ABERTO", "NF-12345", "SERVIÇOS", "MANUTENÇÃO PÁTIO", "01/2024", "BOLETO", "34191.79001..."]
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modelo_Importacao_CP");
    
    // Ajuste de largura das colunas
    ws['!cols'] = headers.map(() => ({ wch: 20 }));

    XLSX.writeFile(wb, "Modelo_Contas_Pagar_NZERP.xlsx");
    setToast({ msg: 'Modelo baixado com sucesso!', type: 'success' });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    
    reader.onload = async (event) => {
      try {
        const dataArray = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(dataArray, { type: 'array', cellDates: true });
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (jsonData.length < 2) throw new Error("Planilha vazia ou incompleta.");

        // --- AUXILIARES DE TRATAMENTO ---
        const normalize = (s: any) => 
          String(s || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
            .replace(/^\ufeff/, '')
            .trim()
            .replace(/\s+/g, ' ');

        const parseSafeValue = (val: any): number => {
          if (val === null || val === undefined || val === '') return 0;
          if (typeof val === 'number') return val;
          const clean = String(val).replace(/[R$\s]/g, '').replace('.', '').replace(',', '.');
          return parseFloat(clean) || 0;
        };

        const parseSafeDate = (val: any): string => {
          if (!val || val === "undefined") return '';
          if (val instanceof Date) return val.toISOString().split('T')[0];
          const str = String(val).trim();
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
            const [d, m, y] = str.split('/');
            return `${y}-${m}-${d}`;
          }
          if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.split('T')[0];
          return '';
        };

        const headersRaw = jsonData[0];
        console.log("NZ Pay Debug - Headers:", headersRaw);

        // --- MAPEAMENTO FLEXÍVEL (FUZZY MATCH) ---
        const colIndices: Record<string, number> = {};
        headersRaw.forEach((h, idx) => {
          const nh = normalize(h);
          
          if (nh === 'id' || nh === 'codigo' || nh === 'identificador' || nh === 'doc_id') colIndices.id = idx;
          else if (nh.includes('fornecedor')) colIndices.fornecedor = idx;
          else if (nh.includes('emiss')) colIndices.dataEmissao = idx;
          else if (nh.includes('venc')) colIndices.dataVencimento = idx;
          else if (nh.includes('liq') || (nh.includes('pagamento') && nh.includes('data'))) colIndices.dataLiquidacao = idx;
          else if (nh.includes('valor doc') || nh.includes('valor original')) colIndices.valorDocumento = idx;
          else if (nh.includes('saldo')) colIndices.saldo = idx;
          else if (nh.includes('pago') && !nh.includes('data')) colIndices.valorPago = idx; // Valor Pago
          else if (nh.includes('situa') || nh.includes('status')) colIndices.situacao = idx;
          else if (nh.includes('numero doc') || nh.includes('ndoc')) colIndices.numeroDocumento = idx;
          else if (nh.includes('categ') || nh.includes('classificacao')) colIndices.categoria = idx;
          else if (nh.includes('histor') || nh.includes('descri')) colIndices.historico = idx;
          else if (nh.includes('compet')) colIndices.competencia = idx;
          else if (nh.includes('forma') || nh.includes('metodo') || nh.includes('tipo pag')) colIndices.formaPagamento = idx;
          else if (nh.includes('chave') || nh.includes('pix') || nh.includes('barras')) colIndices.chavePixBoleto = idx;
        });

        const rows = jsonData.slice(1);
        const rawItems: AccountsPayable[] = [];

        rows.forEach((row) => {
          if (!row || row.length === 0) return;

          const item: any = {
            id: '', fornecedor: '', dataEmissao: '', dataVencimento: '', dataLiquidacao: '',
            valorDocumento: 0, saldo: 0, valorPago: 0, situacao: 'ABERTO',
            numeroDocumento: '', categoria: '', historico: '', competencia: '',
            formaPagamento: '', chavePixBoleto: ''
          };

          Object.entries(colIndices).forEach(([key, colIdx]) => {
            const val = row[colIdx];
            if (key.toLowerCase().includes('data')) {
              item[key] = parseSafeDate(val);
            } else if (key.includes('valor') || key === 'saldo') {
              item[key] = parseSafeValue(val);
            } else if (key === 'competencia') {
              // Tratamento Especial para Competência
              if (val instanceof Date) {
                const m = String(val.getMonth() + 1).padStart(2, '0');
                const y = val.getFullYear();
                item[key] = `${m}/${y}`;
              } else {
                item[key] = String(val || '').trim();
              }
            } else {
              item[key] = String(val || '').trim();
            }
          });

          // Normalizações finais
          if (item.fornecedor) item.fornecedor = item.fornecedor.toUpperCase();
          if (item.categoria) item.categoria = item.categoria.toUpperCase();
          if (item.formaPagamento) item.formaPagamento = item.formaPagamento.toUpperCase();

          if (item.id && item.id !== 'undefined' && (item.fornecedor || item.valorDocumento > 0)) {
            rawItems.push(item as AccountsPayable);
          }
        });

        if (rawItems.length === 0) throw new Error("Nenhum dado válido identificado. Verifique os cabeçalhos.");

        console.log(`NZ Pay: ${rawItems.length} itens identificados.`);
        const stagingResult = await DataService.processAPStaging(rawItems);
        
        setShowImportInstructions(false); // Fecha o modal de instruções
        setStaging(stagingResult); // Abre o modal de staging (revisão)

      } catch (err: any) {
        setToast({ msg: err.message, type: 'error' });
      } finally {
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const confirmImport = async () => {
    if (!staging) return;
    setIsProcessing(true);
    try {
      const res = await DataService.commitAPBatch(staging, currentUser);
      if (res.success) {
        setToast({ msg: 'BASE DE CONTAS A PAGAR SINCRONIZADA!', type: 'success' });
        setStaging(null);
        await fetchItems();
      } else {
        setToast({ msg: res.message, type: 'error' });
      }
    } catch (e) {
      setToast({ msg: 'Erro de comunicação.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredData = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return data.filter(d => 
      (d.fornecedor || '').toLowerCase().includes(term) || 
      (d.numeroDocumento && d.numeroDocumento.toLowerCase().includes(term)) ||
      (d.id && d.id.toLowerCase().includes(term)) ||
      (d.categoria && d.categoria.toLowerCase().includes(term))
    );
  }, [data, searchTerm]);

  // Ordenação do Staging: Novos primeiro, depois Alterados
  const sortedStaging = useMemo(() => {
    if (!staging) return [];
    return [...staging].sort((a, b) => {
      // Prioridade 1: Status NEW
      if (a.status === 'NEW' && b.status !== 'NEW') return -1;
      if (a.status !== 'NEW' && b.status === 'NEW') return 1;
      
      // Prioridade 2: Status CHANGED
      if (a.status === 'CHANGED' && b.status === 'UNCHANGED') return -1;
      if (a.status === 'UNCHANGED' && b.status === 'CHANGED') return 1;
      
      return 0;
    });
  }, [staging]);

  if (loading) return <div className="p-20 text-center opacity-30 font-black uppercase text-xs italic animate-pulse">Consultando Posição Financeira...</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10 h-full flex flex-col">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Contas a Pagar</h2>
          <p className="text-[9px] font-black text-blue-600 uppercase tracking-[0.4em] mt-2 italic">
            Interface de Sincronização Olist ERP
          </p>
        </div>
        
        <div className="flex gap-3">
           <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex-1 md:w-96">
              <input 
                type="text" 
                placeholder="Pesquisar títulos..." 
                className="w-full px-4 py-2 bg-transparent outline-none font-bold text-xs"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
           </div>
           <button 
             onClick={() => setShowImportInstructions(true)}
             className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-blue-600 transition-all flex items-center space-x-2 italic shrink-0"
           >
              <ICONS.Upload className="w-3.5 h-3.5" />
              <span>Importar Olist</span>
           </button>
           <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xls,.xlsx,.csv" className="hidden" />
        </div>
      </div>

      <div className="table-container flex-1 overflow-auto border border-slate-200 rounded-[2rem] bg-white shadow-sm" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <table className="w-full border-separate border-spacing-0" style={{ minWidth: '1800px' }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left sticky left-0 z-30">ID</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Fornecedor</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center">Data Emissão</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center">Data Vencimento</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center">Data Liquidação</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-right">Valor documento</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-right">Pago</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-right">Saldo</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-center">Situação</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Número documento</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Categoria</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Histórico</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Competência</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Forma Pagamento</th>
              <th className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest px-6 py-4 border-b border-slate-200 text-left">Chave PIX/Código boleto</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map(item => (
              <tr key={item.id} className="group hover:bg-slate-50/80 transition-colors">
                <td className="px-6 py-4 border-b border-slate-100 font-black text-blue-600 text-[10px] italic sticky left-0 z-10 bg-white group-hover:bg-slate-50">#{item.id}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-black text-slate-900 uppercase italic text-[11px] whitespace-nowrap">{item.fornecedor}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-500 text-center">
                  {item.dataEmissao ? item.dataEmissao.split('-').reverse().join('/') : '---'}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-900 text-center">
                  {item.dataVencimento ? item.dataVencimento.split('-').reverse().join('/') : '---'}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-400 text-center">
                  {item.dataLiquidacao ? item.dataLiquidacao.split('-').reverse().join('/') : '---'}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 text-right font-bold text-slate-400 text-[11px]">
                  R$ {(item.valorDocumento || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 text-right font-black text-emerald-600 text-[11px]">
                  R$ {(item.valorPago || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 text-right font-black text-slate-900 text-[11px]">
                  R$ {(item.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 text-center">
                   <div className={`inline-flex px-3 py-1 rounded-lg font-black text-[9px] uppercase border shadow-sm ${
                     (item.situacao || '').toLowerCase().includes('paga') 
                     ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                     : item.dataVencimento && new Date(item.dataVencimento) < new Date()
                     ? 'bg-red-50 text-red-600 border-red-100'
                     : 'bg-amber-50 text-amber-600 border-amber-100'
                   }`}>
                      {item.situacao || 'PENDENTE'}
                   </div>
                </td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-600">{item.numeroDocumento || '---'}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-black text-blue-500 text-[9px] uppercase">{item.categoria}</td>
                <td className="px-6 py-4 border-b border-slate-100 text-[10px] text-slate-400 max-w-xs truncate" title={item.historico}>{item.historico}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[11px] text-slate-500">{item.competencia}</td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[10px] text-slate-500 uppercase">{item.formaPagamento}</td>
                <td className="px-6 py-4 border-b border-slate-100 text-[10px] text-slate-400 truncate max-w-xs" title={item.chavePixBoleto}>{item.chavePixBoleto}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredData.length === 0 && (
          <div className="py-20 text-center opacity-30 font-black uppercase text-[10px] tracking-widest">Nenhum registro encontrado.</div>
        )}
      </div>

      {/* MODAL DE INSTRUÇÕES DE IMPORTAÇÃO */}
      {showImportInstructions && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[150] flex items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-300">
           <div className="bg-white max-w-2xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col border border-slate-100">
              <div className="px-10 py-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                 <div>
                    <h3 className="text-2xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Importação de Títulos</h3>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-2 italic">Guia Rápido de Sincronização</p>
                 </div>
                 <button onClick={() => setShowImportInstructions(false)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-500 transition-all">
                    <ICONS.Add className="w-5 h-5 rotate-45" />
                 </button>
              </div>
              
              <div className="p-10 space-y-8">
                 <div className="bg-blue-50 p-6 rounded-[2rem] border border-blue-100 flex gap-4">
                    <div className="p-3 bg-white rounded-xl h-fit text-blue-600 shadow-sm"><ICONS.Upload className="w-5 h-5" /></div>
                    <div>
                       <h4 className="text-[11px] font-black text-blue-700 uppercase mb-2">Estrutura do Arquivo</h4>
                       <p className="text-xs text-blue-800/80 leading-relaxed font-medium">
                          Para garantir a integridade dos dados, utilize nossa planilha modelo padronizada. O sistema identifica automaticamente colunas como 
                          <span className="font-bold mx-1">Fornecedor</span>, 
                          <span className="font-bold mx-1">Vencimento</span>, 
                          <span className="font-bold mx-1">Valor</span> e 
                          <span className="font-bold mx-1">Situação</span>.
                       </p>
                    </div>
                 </div>

                 <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 italic">Ações Disponíveis</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <button 
                         onClick={downloadTemplate}
                         className="p-6 bg-slate-50 border border-slate-200 rounded-[2rem] text-left hover:border-emerald-400 hover:bg-emerald-50/50 transition-all group"
                       >
                          <div className="flex items-center justify-between mb-3">
                             <div className="p-2 bg-white rounded-lg shadow-sm group-hover:text-emerald-600 transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                             </div>
                             <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest group-hover:text-emerald-400">Passo 1</span>
                          </div>
                          <p className="text-sm font-black text-slate-700 uppercase italic group-hover:text-emerald-800">Baixar Modelo .XLSX</p>
                          <p className="text-[9px] text-slate-400 mt-1 font-medium">Planilha com colunas corretas</p>
                       </button>

                       <button 
                         onClick={() => fileInputRef.current?.click()}
                         className="p-6 bg-slate-900 border border-slate-900 rounded-[2rem] text-left hover:bg-blue-600 hover:border-blue-600 transition-all group shadow-xl"
                       >
                          <div className="flex items-center justify-between mb-3">
                             <div className="p-2 bg-white/10 rounded-lg text-white group-hover:bg-white/20 transition-colors">
                                <ICONS.Upload className="w-5 h-5" />
                             </div>
                             <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest group-hover:text-blue-200">Passo 2</span>
                          </div>
                          <p className="text-sm font-black text-white uppercase italic">Selecionar Arquivo</p>
                          <p className="text-[9px] text-slate-400 mt-1 font-medium group-hover:text-blue-100">Carregar dados preenchidos</p>
                       </button>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* MODAL DE VALIDAÇÃO (STAGING) */}
      {staging && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[150] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-300">
           <div className="bg-white max-w-6xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[85vh]">
              <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                 <div>
                    <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Validação de Carga</h3>
                    <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mt-1">Comparando dados da planilha com banco de dados</p>
                 </div>
                 <button onClick={() => setStaging(null)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-500 transition-all">
                    <ICONS.Add className="w-5 h-5 rotate-45" />
                 </button>
              </div>

              <div className="flex-1 overflow-auto p-6">
                 <table className="w-full text-left border-separate border-spacing-y-2">
                    <thead className="bg-slate-50 text-slate-400 text-[8px] font-black uppercase tracking-widest sticky top-0 z-10">
                       <tr>
                          <th className="px-6 py-3">Status</th>
                          <th className="px-6 py-3">Fornecedor / ID</th>
                          <th className="px-6 py-3 text-center">Detalhes (Cat. / Forma)</th>
                          <th className="px-6 py-3 text-right">Valores (Doc / Saldo)</th>
                          <th className="px-6 py-3 text-center">Competência</th>
                          <th className="px-6 py-3">Mudanças</th>
                       </tr>
                    </thead>
                    <tbody>
                       {sortedStaging.map((row, i) => (
                          <tr key={i} className={`group transition-all ${row.status === 'NEW' ? 'bg-emerald-50/40' : row.status === 'CHANGED' ? 'bg-blue-50/40' : 'opacity-50'}`}>
                             <td className="px-6 py-3 first:rounded-l-2xl">
                                <span className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase border ${
                                   row.status === 'NEW' ? 'bg-emerald-600 text-white border-emerald-700' :
                                   row.status === 'CHANGED' ? 'bg-blue-600 text-white border-blue-700' :
                                   'bg-slate-100 text-slate-400 border-slate-200'
                                }`}>
                                   {row.status === 'NEW' ? 'INCLUSÃO' : row.status === 'CHANGED' ? 'ATUALIZAÇÃO' : 'IDÊNTICO'}
                                </span>
                             </td>
                             <td className="px-6 py-3">
                                <p className="font-black text-slate-900 text-[10px] uppercase italic truncate max-w-xs">{row.data.fornecedor}</p>
                                <p className="font-bold text-[8px] text-slate-400">ID: #{row.data.id}</p>
                             </td>
                             <td className="px-6 py-3 text-center">
                                <p className="font-bold text-slate-700 text-[9px] uppercase">{row.data.categoria || '-'}</p>
                                <p className="text-[8px] text-slate-400 font-bold uppercase">{row.data.formaPagamento || '-'}</p>
                             </td>
                             <td className="px-6 py-3 text-right">
                                <p className="text-[9px] font-bold text-slate-400">Doc: R$ {row.data.valorDocumento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                <p className="font-black text-slate-900 text-[11px]">Saldo: R$ {row.data.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                             </td>
                             <td className="px-6 py-3 text-center">
                                <span className="bg-white/50 text-slate-500 px-2 py-1 rounded border text-[9px] font-bold">
                                  {row.data.competencia || '---'}
                                </span>
                             </td>
                             <td className="px-6 py-3 last:rounded-r-2xl">
                                {row.diff && row.diff.length > 0 ? (
                                   <div className="flex flex-wrap gap-1">
                                      {row.diff.map(d => (
                                         <span key={d} className="bg-blue-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tighter">{d}</span>
                                      ))}
                                   </div>
                                ) : <span className="text-[7px] text-slate-300 font-bold uppercase">{row.status === 'NEW' ? 'Novo Título' : 'Sem Alterações'}</span>}
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>
              </div>

              <div className="px-8 py-6 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                 <div className="flex gap-8">
                    <div className="text-center">
                       <p className="text-[7px] font-black text-emerald-500 uppercase tracking-widest">Inclusões</p>
                       <p className="text-2xl font-black text-emerald-600 leading-none">{staging.filter(s => s.status === 'NEW').length}</p>
                    </div>
                    <div className="text-center">
                       <p className="text-[7px] font-black text-blue-500 uppercase tracking-widest">Alterações</p>
                       <p className="text-2xl font-black text-blue-600 leading-none">{staging.filter(s => s.status === 'CHANGED').length}</p>
                    </div>
                 </div>
                 <div className="flex gap-3">
                    <button onClick={() => setStaging(null)} className="px-6 py-3 text-slate-500 font-black text-[9px] uppercase tracking-widest italic">Descartar</button>
                    <button 
                      onClick={confirmImport} 
                      disabled={isProcessing || staging.filter(s => s.status !== 'UNCHANGED').length === 0}
                      className="px-10 py-4 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all italic disabled:opacity-30"
                    >
                       {isProcessing ? 'Sincronizando...' : 'Confirmar & Gravar'}
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default AccountsPayableModule;
