
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DataService } from '../services/dataService';
import { MasterProduct, User } from '../types';
import { ICONS, CATEGORIES } from '../constants';
import Toast from './Toast';
import ProductForm from './ProductForm';
import * as XLSX from 'xlsx';

interface MasterCatalogProps {
  user: User;
}

const BRAZIL_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

const MasterCatalog: React.FC<MasterCatalogProps> = ({ user }) => {
  const [catalog, setCatalog] = useState<MasterProduct[]>([]);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingItem, setEditingItem] = useState<MasterProduct | null>(null);
  const [originalSku, setOriginalSku] = useState<string>('');
  const [showProductForm, setShowProductForm] = useState(false);

  const [showInstructions, setShowInstructions] = useState(false);
  const [importStaging, setImportStaging] = useState<MasterProduct[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    DataService.getMasterCatalog().then(data => {
      setCatalog(data);
      setLoading(false);
    }).catch(err => {
      console.error("MasterCatalog Sync Error:", err);
      setToast({ msg: `Erro ao carregar catálogo: ${err.message}`, type: 'error' });
      setLoading(false);
    });
  }, [refreshKey]);

  const filteredCatalog = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return catalog.filter(p =>
      p.sku.toLowerCase().includes(term) ||
      p.nome.toLowerCase().includes(term) ||
      p.categoria.toLowerCase().includes(term) ||
      (p.marca || '').toLowerCase().includes(term)
    );
  }, [catalog, searchTerm]);

  const handleOpenEdit = (product: MasterProduct) => {
    setEditingItem({ ...product });
    setOriginalSku(product.sku);
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    try {
      // Sanitização de dados antes de enviar
      const sanitizedItem = {
        ...editingItem,
        larguraL: Number(editingItem.larguraL || 0),
        metragemPadrao: Number(editingItem.metragemPadrao || 0),
        estoqueMinimo: Number(editingItem.estoqueMinimo || 0),

        taxOrigin: editingItem.taxOrigin !== undefined ? Number(editingItem.taxOrigin) : 0,
        ncmCode: editingItem.ncmCode?.trim() || '',
        supplierState: editingItem.supplierState || ''
      };

      const success = await DataService.updateMasterProduct(sanitizedItem, user, originalSku);
      if (success) {
        setToast({ msg: 'CATÁLOGO ATUALIZADO!', type: 'success' });
        setRefreshKey(prev => prev + 1);
        setEditingItem(null);
      } else {
        setToast({ msg: 'Erro ao salvar alterações.', type: 'error' });
      }
    } catch (e: any) {
      setToast({ msg: `Erro de conexão: ${e.message}`, type: 'error' });
    }
  };

  const downloadTemplate = () => {
    const templateData = [
      {
        id_tiny: '123456789',
        sku: 'NZW01',
        nome: 'VINIL BLACK ULTRA GLOSS',
        categoria: 'ENVELOPAMENTO',
        marca: 'ORACAL',
        fornecedor: 'SIGN HOUSE',
        larguraL: 1.52,
        metragemPadrao: 15,
        estoqueMinimo: 5,

      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master_Catalog_Template");
    XLSX.writeFile(wb, "modelo_importacao_master_nzstok.xlsx");
    setToast({ msg: 'Modelo oficial gerado!', type: 'success' });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingImport(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const normalize = (s: any) => String(s || '').toLowerCase().trim().replace(/_/g, '').replace(/ /g, '');

        const parsedProducts: MasterProduct[] = jsonData.map((row: any) => {
          const item: any = {
            sku: '', nome: '', categoria: '', marca: 'NZ', fornecedor: 'NZ',
            larguraL: 1.52, metragemPadrao: 15, estoqueMinimo: 0
          };

          Object.keys(row).forEach(key => {
            const nKey = normalize(key);
            const val = row[key];
            if (nKey === 'idtiny' || nKey === 'tinyid' || nKey === 'id') item.id_tiny = String(val).trim();
            else if (nKey === 'sku') item.sku = String(val).trim().toUpperCase();
            else if (nKey === 'nome' || nKey === 'descricao') item.nome = String(val).trim().toUpperCase();
            else if (nKey === 'categoria') item.categoria = String(val).trim().toUpperCase();
            else if (nKey === 'marca') item.marca = String(val).trim().toUpperCase();
            else if (nKey === 'fornecedor') item.fornecedor = String(val).trim().toUpperCase();
            else if (nKey === 'largural' || nKey === 'largura') item.larguraL = Number(val) || 1.52;
            else if (nKey === 'metragempadrao' || nKey === 'rolo' || nKey === 'metragem') item.metragemPadrao = Number(val) || 15;
            else if (nKey === 'estoqueminimo' || nKey === 'minimo') item.estoqueMinimo = Number(val) || 0;

          });
          return item as MasterProduct;
        }).filter(p => p.sku && p.nome);

        if (parsedProducts.length === 0) throw new Error("Planilha sem dados válidos.");

        setImportStaging(parsedProducts);
        setShowInstructions(false);
      } catch (err: any) {
        setToast({ msg: `Falha no processamento: ${err.message}`, type: 'error' });
      } finally {
        setIsProcessingImport(false);
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset o valor para permitir selecionar o mesmo arquivo novamente se necessário
    e.target.value = '';
  };

  const confirmImport = async () => {
    if (!importStaging) return;
    setIsProcessingImport(true);
    try {
      const res = await DataService.importMasterProducts(importStaging, user);
      if (res.success) {
        setToast({ msg: 'BASE ATUALIZADA COM SUCESSO!', type: 'success' });
        setImportStaging(null);
        setRefreshKey(prev => prev + 1);
      } else {
        setToast({ msg: String(res.message || 'Erro ao sincronizar.'), type: 'error' });
      }
    } catch (e: any) {
      setToast({ msg: `Erro crítico: ${e.message}`, type: 'error' });
    } finally {
      setIsProcessingImport(false);
    }
  };

  const handleProductFormSuccess = () => {
    setShowProductForm(false);
    setRefreshKey(prev => prev + 1);
    setToast({ msg: 'NOVO SKU REGISTRADO COM SUCESSO!', type: 'success' });
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 opacity-30">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="space-y-10 animate-in fade-in duration-500 pb-10">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Catálogo Mestre</h2>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.25em] mt-3 italic">Definições Globais e Parâmetros de SKU</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowInstructions(true)}
            className="px-6 py-4 bg-white border border-slate-200 rounded-3xl text-slate-600 hover:text-blue-600 hover:border-blue-200 transition-all flex items-center gap-3 font-black text-[10px] uppercase tracking-widest shadow-sm italic"
          >
            <ICONS.Upload className="w-5 h-5" />
            <span>Importar Base</span>
          </button>
          <button
            onClick={() => setShowProductForm(true)}
            className="px-10 py-5 bg-slate-900 text-white rounded-[2rem] font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-slate-200 italic hover:bg-slate-800 transition-all"
          >
            Novo SKU
          </button>
        </div>
      </div>

      <div className="bg-slate-200/50 p-6 rounded-[2.5rem] border border-slate-200/40">
        <div className="relative group">
          <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="2.5" /></svg>
          </div>
          <input
            type="text"
            placeholder="Pesquisar por SKU, Material, Marca ou Categoria..."
            className="w-full pl-16 pr-8 py-5 bg-white border-2 border-transparent rounded-3xl outline-none font-bold text-sm focus:border-blue-500 shadow-md transition-all placeholder:text-slate-300"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
          />
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th className="w-40">SKU Mestre</th>
              <th className="w-48">Marca / Fabricante</th>
              <th>Descrição do Material</th>
              <th className="w-40 text-center">Categoria</th>
              <th className="w-32 text-right">Rolo Pad.</th>
              <th className="w-32 text-right">Est. Mínimo</th>
              <th className="w-32 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredCatalog.map(product => (
              <tr key={product.sku}>
                <td><span className="lpn-badge-industrial">{product.sku}</span></td>
                <td><span className="text-slate-400 font-bold text-[11px] uppercase italic">{product.marca || '---'}</span></td>
                <td>
                  <div className="flex flex-col">
                    <span className="font-black text-slate-900 uppercase tracking-tight">{product.nome}</span>
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">NZ Standard • {product.larguraL?.toFixed(2) || '1.52'}m Largura</span>
                  </div>
                </td>
                <td className="text-center"><span className="px-3 py-1 bg-slate-100 rounded-lg text-[9px] font-black text-slate-500">{product.categoria}</span></td>
                <td className="text-right"><span className="font-black text-slate-900 text-sm italic">{product.metragemPadrao} ML</span></td>
                <td className="text-right"><span className="font-black text-red-500 text-sm italic">{product.estoqueMinimo} ML</span></td>
                <td className="text-right">
                  <button onClick={() => handleOpenEdit(product)} className="p-2 bg-slate-50 text-slate-400 hover:text-slate-900 rounded-xl transition-all" title="Editar SKU">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth="2.5" /></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL: EDIÇÃO DE PRODUTO */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white max-w-4xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col border border-slate-100 animate-in zoom-in-95">
            <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
              <div>
                <h3 className="text-2xl font-black text-slate-900 uppercase italic">Ajuste Cadastral SKU</h3>
                <p className="text-blue-600 font-bold text-[10px] uppercase tracking-widest mt-1">Editando: {originalSku}</p>
              </div>
              <button onClick={() => setEditingItem(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all">
                <ICONS.Add className="w-6 h-6 rotate-45" />
              </button>
            </div>

            <div className="p-10 space-y-8 overflow-y-auto max-h-[70vh] custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">SKU Mestre</label>
                    <input
                      value={editingItem.sku}
                      onChange={e => setEditingItem({ ...editingItem, sku: e.target.value.toUpperCase() })}
                      className="w-full px-5 py-3.5 bg-blue-50/30 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none transition-all uppercase italic"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Descrição Comercial</label>
                    <input
                      value={editingItem.nome}
                      onChange={e => setEditingItem({ ...editingItem, nome: e.target.value.toUpperCase() })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none focus:bg-white transition-all uppercase italic"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Categoria</label>
                    <select
                      value={editingItem.categoria}
                      onChange={e => setEditingItem({ ...editingItem, categoria: e.target.value })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic cursor-pointer"
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  {/* DADOS FISCAIS - NOVA LINHA */}
                  <div className="space-y-6 pt-4 border-t border-slate-100">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-1 h-3 bg-blue-600 rounded-full"></div>
                      <h4 className="text-[10px] font-black text-slate-900 uppercase tracking-widest italic">Dados Fiscais e Origem</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">NCM (Código Fiscal)</label>
                        <input
                          value={editingItem.ncmCode || ''}
                          onChange={e => setEditingItem({ ...editingItem, ncmCode: e.target.value.toUpperCase() })}
                          placeholder="0000.00.00"
                          className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Origem Mercadoria</label>
                          <select
                            value={editingItem.taxOrigin ?? 0}
                            onChange={e => setEditingItem({ ...editingItem, taxOrigin: Number(e.target.value) })}
                            className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic cursor-pointer"
                          >
                            <option value="0">0 - NACIONAL</option>
                            <option value="1">1 - ESTRANGEIRA (IMP. DIRETA)</option>
                            <option value="2">2 - ESTRANGEIRA (ADQ. INTERNO)</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">UF Fornecedor (Origem)</label>
                          <select
                            value={editingItem.supplierState || ''}
                            onChange={e => setEditingItem({ ...editingItem, supplierState: e.target.value })}
                            className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic cursor-pointer"
                          >
                            <option value="">SELECIONE UF</option>
                            {BRAZIL_STATES.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-blue-600 uppercase tracking-widest ml-1 italic">ID TINY ERP</label>
                    <input
                      placeholder="ID DO PRODUTO NO TINY..."
                      value={editingItem.id_tiny || ''}
                      onChange={e => setEditingItem({ ...editingItem, id_tiny: e.target.value })}
                      className="w-full px-5 py-3.5 bg-blue-50/50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Marca</label>
                      <input
                        value={editingItem.marca || ''}
                        onChange={e => setEditingItem({ ...editingItem, marca: e.target.value.toUpperCase() })}
                        className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Fornecedor</label>
                      <input
                        value={editingItem.fornecedor || ''}
                        onChange={e => setEditingItem({ ...editingItem, fornecedor: e.target.value.toUpperCase() })}
                        className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Largura (m)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingItem.larguraL || ''}
                        onChange={e => setEditingItem({ ...editingItem, larguraL: parseFloat(e.target.value) })}
                        className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Rolo Padrão (ML)</label>
                      <input
                        type="number"
                        value={editingItem.metragemPadrao || ''}
                        onChange={e => setEditingItem({ ...editingItem, metragemPadrao: parseFloat(e.target.value) })}
                        className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-red-400 uppercase tracking-widest ml-1 italic">Estoque Mínimo</label>
                      <input
                        type="number"
                        value={editingItem.estoqueMinimo || ''}
                        onChange={e => setEditingItem({ ...editingItem, estoqueMinimo: parseFloat(e.target.value) })}
                        className="w-full px-5 py-3.5 bg-red-50/30 border-2 border-transparent focus:border-red-600 rounded-2xl text-xs font-black outline-none italic text-red-600"
                      />
                    </div>

                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Unidade de Custo</label>
                    <select
                      value={editingItem.costUnit || 'M2'}
                      onChange={e => setEditingItem({ ...editingItem, costUnit: e.target.value })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic cursor-pointer"
                    >
                      <option value="M2">M2 - METRO QUADRADO</option>
                      <option value="ML">ML - METRO LINEAR</option>
                      <option value="ROLO">ROLO - UNIDADE</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-10 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-4">
              <button onClick={() => setEditingItem(null)} className="px-8 py-4 text-slate-400 font-black text-[10px] uppercase tracking-widest italic hover:text-slate-900 transition-colors">Cancelar</button>
              <button
                onClick={handleSaveEdit}
                className="px-12 py-4 bg-slate-900 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-blue-600 transition-all italic active:scale-95"
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: INSTRUÇÕES E DOWNLOAD DE MODELO */}
      {showInstructions && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-white max-w-2xl w-full rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col border border-slate-100">
            <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
              <div>
                <h3 className="text-2xl font-black text-slate-900 uppercase italic">Sincronizar Base Mestre</h3>
                <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-1">Guia técnico para importação massiva</p>
              </div>
              <button onClick={() => setShowInstructions(false)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500"><ICONS.Add className="w-6 h-6 rotate-45" /></button>
            </div>

            <div className="p-10 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 bg-blue-50/50 rounded-3xl border border-blue-100/50">
                  <h4 className="text-[11px] font-black text-blue-600 uppercase mb-3 tracking-widest">1. Planilha Oficial</h4>
                  <p className="text-xs text-slate-500 leading-relaxed font-medium mb-4">Utilize nosso arquivo Excel formatado com os campos obrigatórios do banco NZSTOK.</p>
                  <button onClick={downloadTemplate} className="w-full py-3 bg-white border border-blue-200 text-blue-600 rounded-xl font-black text-[9px] uppercase hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeWidth="3" /></svg>
                    Baixar Modelo (.xlsx)
                  </button>
                </div>
                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                  <h4 className="text-[11px] font-black text-slate-900 uppercase mb-3 tracking-widest">2. Regras de Dados</h4>
                  <ul className="text-[10px] text-slate-400 space-y-2 font-bold uppercase">
                    <li className="flex gap-2"><span className="text-blue-500">•</span> SKU Único (Primário)</li>
                    <li className="flex gap-2"><span className="text-blue-500">•</span> Decimais: Use PONTO no Excel</li>
                    <li className="flex gap-2"><span className="text-blue-500">•</span> Nome/Descrição é obrigatório</li>
                  </ul>
                </div>
              </div>

              <div className="bg-amber-50 p-6 rounded-[2rem] border border-amber-100 flex items-start gap-4">
                <ICONS.Alert className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <p className="text-[10px] text-amber-800 font-black uppercase italic">Comportamento de Upsert</p>
                  <p className="text-[10px] text-amber-700 font-medium uppercase mt-1 leading-relaxed">SKUs que já existem na base serão ATUALIZADOS. Novos SKUs serão INSERIDOS automaticamente.</p>
                </div>
              </div>
            </div>

            <div className="p-10 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-4">
              <button onClick={() => setShowInstructions(false)} className="px-8 py-4 text-slate-400 font-black text-[10px] uppercase">Cancelar</button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-12 py-4 bg-slate-900 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-blue-600 transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.414a4 4 0 00-5.656-5.656l-6.415 6.414a6 6 0 108.486 8.486L20.5 13" strokeWidth="3" /></svg>
                Selecionar Planilha
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: STAGING / REVISÃO DE IMPORTAÇÃO */}
      {importStaging && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[250] flex items-center justify-center p-6 animate-in zoom-in-95">
          <div className="bg-white max-w-6xl w-full rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col h-[90vh] border border-slate-100">
            <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/30 shrink-0">
              <div>
                <h3 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter">Revisão Pré-Carga</h3>
                <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-1">Conferência final dos SKUs processados</p>
              </div>
              <button onClick={() => setImportStaging(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all"><ICONS.Add className="w-6 h-6 rotate-45" /></button>
            </div>

            <div className="flex-1 overflow-auto p-10 custom-scrollbar">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-6 py-4 text-center">STATUS</th>
                    <th className="px-6 py-4">ID TINY</th>
                    <th className="px-6 py-4">SKU MESTRE</th>
                    <th className="px-6 py-4">NOME / DESCRIÇÃO</th>
                    <th className="px-6 py-4">CATEGORIA</th>
                    <th className="px-6 py-4 text-center">ROLO</th>
                    <th className="px-6 py-4 text-center">MÍNIMO</th>
                    <th className="px-6 py-4 text-center">MÍNIMO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {importStaging.map((row, i) => {
                    const isNew = !catalog.some(p => p.sku === row.sku);
                    return (
                      <tr key={i} className={`hover:bg-blue-50/20 transition-all ${isNew ? 'bg-emerald-50/20' : ''}`}>
                        <td className="px-6 py-4 text-center">
                          {isNew ? (
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md text-[8px] font-black uppercase">Novo</span>
                          ) : (
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md text-[8px] font-black uppercase">Update</span>
                          )}
                        </td>
                        <td className="px-6 py-4 font-mono text-[10px] text-slate-400">{row.id_tiny || '-'}</td>
                        <td className="px-6 py-4 font-black text-blue-600 text-xs">{row.sku}</td>
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-800 text-[11px] uppercase truncate max-w-xs">{row.nome}</p>
                          <p className="text-[9px] text-slate-400 font-medium italic">{row.marca} • {row.fornecedor}</p>
                        </td>
                        <td className="px-6 py-4"><span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-xl text-[9px] font-black">{row.categoria}</span></td>
                        <td className="px-6 py-4 text-center font-black text-slate-900 text-[11px]">{row.metragemPadrao}m</td>
                        <td className="px-6 py-4 text-center font-black text-red-500 text-[11px]">{row.estoqueMinimo}m</td>
                        <td className="px-6 py-4 text-center font-black text-red-500 text-[11px]">{row.estoqueMinimo}m</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-10 border-t border-slate-50 bg-slate-50/30 flex justify-between items-center">
              <div className="space-y-1">
                <p className="text-slate-900 text-sm font-black uppercase italic">{importStaging.length} Registros Identificados</p>
                <p className="text-slate-400 text-[9px] font-bold uppercase italic">Pressione para sincronizar com o banco de dados</p>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setImportStaging(null)} className="px-8 py-4 bg-white text-slate-400 font-black text-[10px] uppercase rounded-2xl hover:text-red-500 border border-slate-200">Descartar</button>
                <button
                  onClick={confirmImport}
                  disabled={isProcessingImport}
                  className="px-12 py-5 bg-blue-600 text-white font-black text-[11px] uppercase rounded-[1.5rem] shadow-2xl hover:bg-blue-500 active:scale-95 transition-all flex items-center gap-3"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth="3" /></svg>
                  {isProcessingImport ? 'SINCRONIZANDO...' : 'EFETIVAR CARGA NO BANCO'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showProductForm && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-md z-[200] flex items-center justify-center p-4">
          <div className="bg-white max-w-4xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-8 border-b border-slate-50 flex justify-between items-center">
              <h3 className="text-2xl font-black text-slate-900 uppercase italic">Novo Cadastro Mestre</h3>
              <button onClick={() => setShowProductForm(false)} className="p-2.5 bg-slate-50 rounded-xl hover:text-red-500"><ICONS.Add className="w-6 h-6 rotate-45" /></button>
            </div>
            <div className="p-10">
              <ProductForm user={user} onSuccess={handleProductFormSuccess} />
            </div>
          </div>
        </div>
      )}
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx,.xls,.csv" />
    </div>
  );
};

export default MasterCatalog;