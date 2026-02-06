
import React, { useState, useMemo, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { StockItem, User, AuditLog } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

interface InventoryProps {
  currentUser: User;
  onStartAudit?: (filters: { column: string, shelf: string } | null) => void;
  initialSearchTerm?: string;
  onNavigateToPricing?: (sku: string) => void;
}

const Inventory: React.FC<InventoryProps> = ({ currentUser, onStartAudit, initialSearchTerm, onNavigateToPricing }) => {
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm || '');
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);

  // Estados para o Histórico Detalhado
  const [viewingHistoryLpn, setViewingHistoryLpn] = useState<string | null>(null);
  const [selectedItemForHistory, setSelectedItemForHistory] = useState<StockItem | null>(null);
  const [itemLogs, setItemLogs] = useState<AuditLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const [inventory, setInventory] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof StockItem; direction: 'asc' | 'desc' } | null>({ key: 'lpn', direction: 'asc' });

  const [showAuditModal, setShowAuditModal] = useState(false);

  // Novos filtros de texto livre
  const [filterColumn, setFilterColumn] = useState('');
  const [filterShelf, setFilterShelf] = useState('');

  const [showEmptyRolls, setShowEmptyRolls] = useState(false);

  const canEditItem = currentUser.role === 'DIRETORIA' || currentUser.permissions?.includes('CAN_EDIT');

  const handleOpenItemHistory = async (item: StockItem) => {
    setSelectedItemForHistory(item);
    setViewingHistoryLpn(item.lpn);
    setLogsLoading(true);
    try {
      const logs = await DataService.getLogsByLpn(item.lpn);
      setItemLogs(logs);
    } catch (e) {
      setToast({ msg: 'Erro ao carregar histórico.', type: 'error' });
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setErrorState(null);
    DataService.getInventory().then(invData => {
      setInventory(invData);
      setLoading(false);

      const params = new URLSearchParams(window.location.search);
      const lpnFromUrl = params.get('lpn');
      if (lpnFromUrl) {
        const item = invData.find(i => String(i.lpn).toUpperCase() === String(lpnFromUrl).toUpperCase());
        if (item) {
          handleOpenItemHistory(item);
        }
        const baseUrl = window.location.href.split('?')[0];
        window.history.replaceState({}, document.title, baseUrl);
      }
    }).catch(err => {
      setErrorState(err.message || "Erro desconhecido ao carregar dados.");
      setLoading(false);
    });
  }, [refreshKey]);

  const handleSort = (key: keyof StockItem) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const generateControlSheet = async (item: StockItem) => {
    try {
      const doc = new jsPDF();
      const currentOrigin = window.location.origin;
      const currentPath = window.location.pathname;
      const baseUrl = currentOrigin + (currentPath.endsWith('/') ? currentPath : currentPath + '/');
      const qrTarget = `${baseUrl}?lpn=${item.lpn}`;

      // Gera QR Code preto (padrão)
      const qrCodeDataUrl = await QRCode.toDataURL(qrTarget, {
        margin: 0,
        width: 300,
        color: { dark: '#000000', light: '#FFFFFF' }
      });

      // Configuração para economia de tinta: Fundo Branco com Borda Preta
      doc.setDrawColor(0, 0, 0); // Cor da linha: Preto
      doc.setLineWidth(0.7);     // Espessura da linha
      doc.rect(10, 10, 190, 45); // Retângulo apenas contornado (sem 'F')

      // Textos em Preto
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.text('FOLHA DE IDENTIFICAÇÃO NZ', 20, 28);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`PROTOCOLO LPN: ${item.lpn}`, 20, 36);
      doc.text(`EMITIDO EM: ${new Date().toLocaleString()} POR ${currentUser.name.toUpperCase()}`, 20, 41);

      doc.addImage(qrCodeDataUrl, 'PNG', 160, 15, 30, 30);

      doc.setTextColor(0, 0, 0); // Garante preto para o texto abaixo do QR
      doc.setFontSize(6);
      doc.text('SCANEIE P/ HISTÓRICO', 161, 48);

      // --- DADOS TÉCNICOS ---

      doc.setTextColor(15, 23, 42); // Azul escuro padrão do sistema para títulos
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('DADOS TÉCNICOS E CADASTRAIS', 15, 70);
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.5);
      doc.line(15, 72, 195, 72);

      let y = 85;
      const drawField = (label: string, value: string, xOffset = 0, size = 11) => {
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139); // Slate 500
        doc.text(label.toUpperCase(), 15 + xOffset, y);
        doc.setFontSize(size);
        doc.setTextColor(0, 0, 0); // Texto do valor em Preto para contraste
        doc.setFont('helvetica', 'bold');
        doc.text(String(value || '---').toUpperCase(), 15 + xOffset, y + 6);
      };

      drawField('SKU Mestre', item.sku);
      drawField('Fabricante / Marca', item.marca, 60);
      drawField('Categoria', item.categoria, 120);

      y += 20;
      drawField('Descrição Completa do Material', item.nome, 0, 10);

      y += 20;
      // Removido Fornecedor, Lote movido para esquerda
      drawField('Nº do Lote', item.lote, 0);
      drawField('NF / Documento', item.nfControle || '---', 80);

      y += 20;
      // Removido Custo, reajustado posições
      drawField('Largura Nominal (L)', `${item.larguraL.toFixed(2)} Metros`, 0);
      drawField('Metragem Saldo (ML)', `${item.quantMl.toFixed(2)} ML`, 80);

      y += 20;
      // Alinhado Caixa Ref com a coluna do meio para consistência visual
      drawField('Localização no Pátio', `COLUNA ${item.coluna} - NÍVEL ${item.prateleira}`, 0);
      drawField('Caixa Ref.', item.nCaixa || '---', 80);
      drawField('Status de Rolo', item.statusRolo, 140);

      // Re-adicionando Seção de Observações Internas
      if (item.observacao && item.observacao.trim() !== '') {
        y += 20;
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139); // Slate 500
        doc.text('OBSERVAÇÕES INTERNAS', 15, y);

        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');

        const observationText = doc.splitTextToSize(String(item.observacao).toUpperCase(), 180); // 180mm width
        doc.text(observationText, 15, y + 6);
      }

      doc.setFillColor(248, 250, 252); // Fundo cinza bem claro para rodapé
      doc.rect(0, 275, 210, 22, 'F');
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text('DOCUMENTO DE CONTROLE INTERNO NZSTOK', 105, 285, { align: 'center' });
      doc.text('ESTA FOLHA DEVE PERMANECER JUNTO AO MATERIAL ATÉ O ESGOTAMENTO TOTAL.', 105, 290, { align: 'center' });

      doc.save(`FOLHA_IDENTIFICACAO_${item.lpn}.pdf`);
      setToast({ msg: 'FOLHA GERADA (MODO ECONOMIA)!', type: 'success' });
    } catch (err) {
      setToast({ msg: 'ERRO AO GERAR DOCUMENTO.', type: 'error' });
    }
  };

  const filteredItems = useMemo(() => {
    const term = searchTerm.toLowerCase();
    let result = inventory.filter(item => {
      if (!showEmptyRolls && (item.quantMl <= 0 || item.statusRolo === 'ESGOTADO')) return false;
      const position = `${item.coluna}-${item.prateleira}`.toLowerCase();
      return (
        item.sku.toLowerCase().includes(term) ||
        item.nome.toLowerCase().includes(term) ||
        item.lpn.toLowerCase().includes(term) ||
        item.fornecedor.toLowerCase().includes(term) ||
        (item.nCaixa || '').toLowerCase().includes(term) ||
        position.includes(term)
      );
    });

    if (sortConfig) {
      result.sort((a, b) => {
        const valA = a[sortConfig.key] ?? '';
        const valB = b[sortConfig.key] ?? '';
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [inventory, searchTerm, sortConfig, showEmptyRolls]);

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    try {
      const res = await DataService.updateStockItem(editingItem, currentUser);
      if (res.success) {
        setToast({ msg: 'SISTEMA ATUALIZADO!', type: 'success' });
        setRefreshKey(prev => prev + 1);
        setEditingItem(null);
      } else {
        setToast({ msg: res.message, type: 'error' });
      }
    } catch (e) {
      setToast({ msg: 'Erro de conexão.', type: 'error' });
    }
  };

  const confirmStartAudit = () => {
    if (!onStartAudit) return;
    const filters = (filterColumn || filterShelf)
      ? { column: filterColumn, shelf: filterShelf }
      : null;
    setShowAuditModal(false);
    onStartAudit(filters);
  };

  const SortIndicator = ({ active }: { active: boolean }) => (
    <span className={`inline-block ml-1.5 text-[8px] transition-opacity ${active ? 'opacity-100 text-blue-400' : 'opacity-20 group-hover:opacity-50'}`}>
      {sortConfig?.direction === 'desc' && active ? '▼' : '▲'}
    </span>
  );

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 opacity-30">
      <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  if (errorState) return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6 border border-red-100 shadow-lg">
        <ICONS.Alert className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-black text-slate-900 uppercase italic">Falha na Comunicação com o Banco</h2>
      <p className="text-slate-500 max-w-md mt-2 mb-8 font-medium">{errorState}</p>
      <button onClick={() => setRefreshKey(k => k + 1)} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-widest italic hover:bg-blue-600 transition-all">Tentar Reconectar</button>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10 flex flex-col h-full overflow-hidden">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Pátio & Estoque</h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.3em] mt-2 italic">Auditoria em Tempo Real • NZSTOK</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowEmptyRolls(!showEmptyRolls)}
            className={`px-4 py-3 border rounded-xl transition-all font-black text-[9px] uppercase tracking-widest flex items-center gap-2 ${showEmptyRolls ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-slate-200 text-slate-400'}`}
          >
            {showEmptyRolls ? 'Exibindo Esgotados' : 'Ocultando Esgotados'}
          </button>
          <button
            onClick={() => setShowAuditModal(true)}
            className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-slate-200 italic hover:bg-blue-600 transition-all"
          >
            Novo Inventário
          </button>
        </div>
      </div>

      <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm shrink-0">
        <div className="relative group">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-blue-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3" /></svg>
          </div>
          <input
            type="text"
            placeholder="Pesquisar por LPN, SKU, Caixa ou Posição..."
            className="w-full pl-12 pr-4 py-4 bg-transparent outline-none font-bold text-sm placeholder:text-slate-300 uppercase"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
          />
        </div>
      </div>

      <div className="table-container">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-36 text-center cursor-pointer group" onClick={() => handleSort('lpn')}>
                <div className="flex items-center justify-center">Protocolo <SortIndicator active={sortConfig?.key === 'lpn'} /></div>
              </th>
              <th className="w-44 text-center cursor-pointer group" onClick={() => handleSort('statusRolo')}>
                <div className="flex items-center justify-center">Situação <SortIndicator active={sortConfig?.key === 'statusRolo'} /></div>
              </th>
              <th className="text-left cursor-pointer group" onClick={() => handleSort('sku')}>
                <div className="flex items-center">Material & Descrição <SortIndicator active={sortConfig?.key === 'sku'} /></div>
              </th>
              <th className="w-36 text-center cursor-pointer group" onClick={() => handleSort('coluna')}>
                <div className="flex items-center justify-center">Localização <SortIndicator active={sortConfig?.key === 'coluna'} /></div>
              </th>
              <th className="w-32 text-center cursor-pointer group" onClick={() => handleSort('dataEntrada')}>
                <div className="flex items-center justify-center">Entrada <SortIndicator active={sortConfig?.key === 'dataEntrada'} /></div>
              </th>
              <th className="w-44 text-center cursor-pointer group" onClick={() => handleSort('fornecedor')}>
                <div className="flex items-center justify-center">Origem <SortIndicator active={sortConfig?.key === 'fornecedor'} /></div>
              </th>
              <th className="w-32 text-right cursor-pointer group" onClick={() => handleSort('quantMl')}>
                <div className="flex items-center justify-end">Saldo (ML) <SortIndicator active={sortConfig?.key === 'quantMl'} /></div>
              </th>
              <th className="w-28 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map(item => (
              <tr key={item.lpn}>
                <td className="text-center">
                  <span className="lpn-badge-industrial">{item.lpn}</span>
                </td>
                <td className="text-center">
                  {(item.quantMl <= 0 || item.statusRolo === 'ESGOTADO') ? (
                    <span className="bg-red-50 text-red-600 px-3 py-1 rounded-full font-black text-[9px] uppercase border border-red-100 shadow-sm italic">ESGOTADO</span>
                  ) : (
                    <div className={`inline-flex items-center px-3 py-1 rounded-full font-black text-[9px] uppercase tracking-tighter border shadow-sm ${item.statusRolo === 'ROLO FECHADO'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      : 'bg-amber-50 text-amber-700 border-amber-100'
                      }`}>
                      <div className={`w-1.5 h-1.5 rounded-full mr-2 ${item.statusRolo === 'ROLO FECHADO' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></div>
                      {item.statusRolo}
                    </div>
                  )}
                </td>
                <td className="text-left">
                  <div className="flex flex-col">
                    <span className="font-black text-slate-900 text-[13px] uppercase tracking-tight">{item.sku}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase truncate max-w-[280px] mt-0.5">{item.nome}</span>
                  </div>
                </td>
                <td className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span className="loc-badge">COL {item.coluna}-{item.prateleira}</span>
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest italic">{item.nCaixa ? `CX ${item.nCaixa}` : '---'}</span>
                  </div>
                </td>
                <td className="text-center">
                  <div className="flex flex-col items-center">
                    <span className="text-slate-900 font-black text-[11px] leading-none">
                      {item.dataEntrada ? new Date(item.dataEntrada).toLocaleDateString('pt-BR') : '-'}
                    </span>
                    <span className="text-[8px] text-slate-400 font-bold mt-1 uppercase">
                      {item.dataEntrada ? new Date(item.dataEntrada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                </td>
                <td className="text-center">
                  <div className="flex flex-col items-center">
                    <span className="text-slate-600 font-black text-[10px] uppercase truncate max-w-[140px] italic">
                      {item.fornecedor || '---'}
                    </span>
                    <span className="text-[8px] text-slate-400 font-bold uppercase mt-1">LT: {item.lote}</span>
                  </div>
                </td>
                <td className="text-right">
                  <div className="flex flex-col items-end">
                    <span className={`font-black text-[15px] tracking-tighter italic ${(item.quantMl <= 0 || item.statusRolo === 'ESGOTADO') ? 'text-red-500' : 'text-slate-900'}`}>
                      {(item.quantMl <= 0 || item.statusRolo === 'ESGOTADO') ? '0.00' : item.quantMl.toFixed(2)}
                    </span>
                    <span className="text-[8px] font-black text-blue-600 uppercase tracking-widest mt-0.5">METROS</span>
                  </div>
                </td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleOpenItemHistory(item)}
                      className="p-2 bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                      title="Histórico"
                    >
                      <ICONS.History className="w-4 h-4" />
                    </button>
                    {onNavigateToPricing && (
                      <button
                        onClick={() => onNavigateToPricing(item.sku)}
                        className="p-2 bg-slate-50 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                        title="Ver Preço"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      </button>
                    )}
                    <button
                      onClick={() => generateControlSheet(item)}
                      className="p-2 bg-slate-50 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                      title="Folha de Controle"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" strokeWidth="2.5" /></svg>
                    </button>
                    {canEditItem && (
                      <button
                        onClick={() => setEditingItem(item)}
                        className="p-2 bg-slate-50 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"
                        title="Editar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth="2.5" /></svg>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredItems.length === 0 && (
          <div className="py-24 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
              <ICONS.Inventory className="w-8 h-8 text-slate-200" />
            </div>
            <p className="text-slate-400 font-black uppercase tracking-widest text-[10px] italic">Nenhum volume localizado no pátio</p>
          </div>
        )}
      </div>

      {/* Modal de Auditoria Escopo - AGORA COM TEXTO LIVRE */}
      {showAuditModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[150] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white max-w-2xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col h-fit">
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Iniciar Inventário</h3>
                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-2 italic">Configuração de Escopo e Filtros</p>
              </div>
              <button onClick={() => setShowAuditModal(false)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-500 transition-all">
                <ICONS.Add className="w-5 h-5 rotate-45" />
              </button>
            </div>
            <div className="p-8 space-y-8">
              <div className="bg-amber-50 p-6 rounded-[2rem] border border-amber-100 flex items-start gap-4">
                <ICONS.Alert className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <p className="text-[10px] font-black text-amber-800 uppercase italic">Bloqueio de Movimentação</p>
                  <p className="text-[11px] text-amber-700 leading-relaxed font-medium mt-1">Ao iniciar, evite realizar saídas ou entradas físicas para garantir a precisão dos dados apurados.</p>
                </div>
              </div>
              <div className="space-y-6">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Filtros de Localização (Opcional):</p>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Filtrar por Coluna</label>
                    <input
                      type="text"
                      placeholder="Ex: A, B, ZONA 1..."
                      value={filterColumn}
                      onChange={(e) => setFilterColumn(e.target.value.toUpperCase())}
                      className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl outline-none font-bold text-xs uppercase"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Filtrar por Nível</label>
                    <input
                      type="text"
                      placeholder="Ex: 1, 2, CHÃO..."
                      value={filterShelf}
                      onChange={(e) => setFilterShelf(e.target.value.toUpperCase())}
                      className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl outline-none font-bold text-xs uppercase"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-8 py-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-5">
              <button onClick={() => setShowAuditModal(false)} className="px-6 py-3 text-slate-500 font-black text-[9px] uppercase tracking-widest italic">Cancelar</button>
              <button onClick={confirmStartAudit} className="px-10 py-4 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all italic">
                {!filterColumn && !filterShelf ? 'Estoque Total' : 'Iniciar c/ Filtros'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Histórico Item */}
      {viewingHistoryLpn && selectedItemForHistory && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[110] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white max-w-3xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[85vh]">
            {/* Cabeçalho do Extrato */}
            <div className="px-10 py-8 border-b border-slate-100 bg-slate-900 text-white flex justify-between items-start shrink-0">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="lpn-badge-industrial bg-blue-600 text-white border-blue-500 shadow-lg">{viewingHistoryLpn}</span>
                  <h3 className="text-2xl font-black tracking-tighter uppercase italic leading-none">{selectedItemForHistory.sku}</h3>
                </div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{selectedItemForHistory.nome}</p>
                <p className="text-[9px] font-bold text-blue-400 uppercase italic mt-2">LOTE: {selectedItemForHistory.lote} • ORIGEM: {selectedItemForHistory.fornecedor}</p>
              </div>
              <button onClick={() => { setViewingHistoryLpn(null); setSelectedItemForHistory(null); }} className="p-2.5 bg-white/10 hover:bg-red-500 rounded-xl text-white transition-all">
                <ICONS.Add className="w-5 h-5 rotate-45" />
              </button>
            </div>

            {/* Corpo das Movimentações */}
            <div className="flex-1 overflow-y-auto p-10 space-y-6 custom-scrollbar bg-white">
              {logsLoading ? (
                <div className="py-20 text-center opacity-30">
                  <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-[10px] font-black uppercase tracking-widest">Sincronizando timeline...</p>
                </div>
              ) : itemLogs.length > 0 ? (
                itemLogs.map((log, idx) => {
                  const isSaida = log.acao.includes('SAIDA') || log.acao.includes('AUDITORIA');
                  const isEntrada = log.acao.includes('ENTRADA') || log.acao.includes('CADASTRO');

                  return (
                    <div key={log.id} className="relative pl-8 group">
                      {/* Linha da Timeline */}
                      {idx !== itemLogs.length - 1 && (
                        <div className="absolute left-[11px] top-8 bottom-[-24px] w-0.5 bg-slate-100 group-last:hidden"></div>
                      )}

                      {/* Ponto na Timeline */}
                      <div className={`absolute left-0 top-1.5 w-6 h-6 rounded-full border-4 border-white shadow-md z-10 ${isSaida ? 'bg-red-500' : isEntrada ? 'bg-emerald-500' : 'bg-blue-500'
                        }`}></div>

                      <div className="p-6 bg-slate-50 border border-slate-100 rounded-3xl flex justify-between items-center hover:bg-white hover:shadow-lg transition-all group/card">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-3">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(log.timestamp).toLocaleString()}</span>
                            <div className={`px-2.5 py-0.5 rounded-lg font-black text-[8px] uppercase border shadow-sm ${isSaida ? 'bg-red-50 text-red-600 border-red-100' :
                              isEntrada ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                'bg-blue-50 text-blue-600 border-blue-100'
                              }`}>
                              {log.acao.replace(/_/g, ' ')}
                            </div>
                          </div>
                          <p className="text-[12px] font-black text-slate-800 uppercase italic tracking-tight">{log.detalhes}</p>
                          <div className="flex items-center gap-4">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">NF/PEDIDO: <span className="text-slate-900">{log.nfControle || 'INTERNO'}</span></p>
                            <p className="text-[9px] font-black text-blue-600 uppercase italic">@{log.usuario.split('@')[0]}</p>
                          </div>
                        </div>
                        <div className="text-right pl-6 shrink-0">
                          {log.quantidade !== undefined && (
                            <div className="flex flex-col items-end">
                              <p className={`text-xl font-black italic tracking-tighter ${isSaida ? 'text-red-500' : 'text-emerald-500'}`}>
                                {isSaida ? '-' : '+'}{log.quantidade.toFixed(2)}
                              </p>
                              <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">METROS (ML)</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-24 text-center opacity-20">
                  <ICONS.History className="w-12 h-12 mx-auto mb-4" />
                  <p className="font-black text-[10px] uppercase tracking-widest">Nenhuma movimentação para este LPN</p>
                </div>
              )}
            </div>

            {/* Rodapé Informativo */}
            <div className="px-10 py-5 bg-slate-50 border-t border-slate-100 flex justify-between items-center shrink-0">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Timeline NZSTOK • Histórico de Volume Físico</p>
              <span className="text-[10px] font-black text-slate-900 uppercase">Saldo Atual: {selectedItemForHistory.quantMl.toFixed(2)} ML</span>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Ajuste Cadastral */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-md z-[150] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white max-w-5xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[95vh]">
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
              <div>
                <h3 className="text-2xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">Ajuste Cadastral de Volume</h3>
                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-1">LPN IDENTIFICADOR: {editingItem.lpn}</p>
              </div>
              <button onClick={() => setEditingItem(null)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-500 transition-all">
                <ICONS.Add className="w-5 h-5 rotate-45" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-10 space-y-12 custom-scrollbar bg-white">
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-1.5 h-6 bg-emerald-600 rounded-full"></div>
                  <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] italic">Logística e Pátio</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Nº do Lote</label>
                    <input
                      value={editingItem.lote}
                      onChange={e => setEditingItem({ ...editingItem, lote: e.target.value.toUpperCase() })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">NF / Controle</label>
                    <input
                      value={editingItem.nfControle}
                      onChange={e => setEditingItem({ ...editingItem, nfControle: e.target.value.toUpperCase() })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Origem (Fornecedor)</label>
                    <input
                      value={editingItem.fornecedor}
                      onChange={e => setEditingItem({ ...editingItem, fornecedor: e.target.value.toUpperCase() })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Coluna (Texto)</label>
                    <input
                      type="text"
                      value={editingItem.coluna}
                      onChange={e => setEditingItem({ ...editingItem, coluna: e.target.value.toUpperCase() })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Nível (Texto)</label>
                    <input
                      type="text"
                      value={editingItem.prateleira}
                      onChange={e => setEditingItem({ ...editingItem, prateleira: e.target.value.toUpperCase() })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Metragem Atual (Saldo ML)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingItem.quantMl}
                      onChange={e => setEditingItem({ ...editingItem, quantMl: parseFloat(e.target.value) })}
                      className="w-full px-5 py-3.5 bg-amber-50/50 border-2 border-transparent focus:border-amber-600 rounded-2xl text-sm font-black outline-none italic text-amber-700"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Largura (Metros)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingItem.larguraL}
                      onChange={e => setEditingItem({ ...editingItem, larguraL: parseFloat(e.target.value) })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Nº Caixa Ref.</label>
                    <input
                      value={editingItem.nCaixa}
                      onChange={e => setEditingItem({ ...editingItem, nCaixa: e.target.value.toUpperCase() })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic uppercase"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Situação do Rolo</label>
                    <select
                      value={editingItem.statusRolo}
                      onChange={e => setEditingItem({ ...editingItem, statusRolo: e.target.value })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic"
                    >
                      <option value="ROLO FECHADO">ROLO FECHADO</option>
                      <option value="ROLO ABERTO">ROLO ABERTO</option>
                      <option value="ESGOTADO">ESGOTADO</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Seção 3: Parâmetros Técnicos e Financeiros - Mantida igual */}
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-1.5 h-6 bg-slate-900 rounded-full"></div>
                  <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] italic">Dados Técnicos e Custo</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Custo Unitário (R$/ML)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">R$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={editingItem.custoUnitario}
                        onChange={e => setEditingItem({ ...editingItem, custoUnitario: parseFloat(e.target.value) })}
                        className="w-full pl-10 pr-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-emerald-600 rounded-2xl text-xs font-black outline-none italic text-emerald-700"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Metragem Padrão (Fábrica)</label>
                    <input
                      type="number"
                      value={editingItem.metragemPadrao}
                      onChange={e => setEditingItem({ ...editingItem, metragemPadrao: parseFloat(e.target.value) })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Ponto de Reposição (Min.)</label>
                    <input
                      type="number"
                      value={editingItem.estoqueMinimo}
                      onChange={e => setEditingItem({ ...editingItem, estoqueMinimo: parseFloat(e.target.value) })}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-red-600 rounded-2xl text-xs font-black outline-none italic text-red-600"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Observações Internas</label>
                  <textarea
                    value={editingItem.observacao}
                    onChange={e => setEditingItem({ ...editingItem, observacao: e.target.value.toUpperCase() })}
                    rows={2}
                    className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none italic uppercase resize-none shadow-inner"
                  />
                </div>
              </div>
            </div>

            <div className="px-8 py-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-4 shrink-0">
              <button onClick={() => setEditingItem(null)} className="px-6 py-3 text-slate-500 font-black text-[10px] uppercase tracking-widest italic hover:text-slate-900 transition-colors">Descartar</button>
              <button onClick={handleSaveEdit} className="px-10 py-4 bg-blue-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all italic active:scale-95">Salvar Todas Alterações</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;
