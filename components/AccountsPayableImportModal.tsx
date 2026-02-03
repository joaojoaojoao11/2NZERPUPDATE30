import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabaseClient } from '../services/core';
import { ICONS } from '../constants';

interface ImportModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

// Mapeamento: Título na Planilha -> Nome da Coluna no Banco (accounts_payable)
const COLUMNS_MAP = {
    "ID": "id",
    "Fornecedor": "fornecedor",
    "Data Emissão": "data_emissao",
    "Data Vencimento": "data_vencimento",
    "Data Liquidação": "data_liquidacao",
    "Valor documento": "valor_documento",
    "Saldo": "saldo",
    "Situação": "situacao",
    "Número documento": "numero_documento",
    "Categoria": "categoria",
    "Histórico": "historico",
    "Pago": "valor_pago",
    "Competência": "competencia",
    "Forma Pagamento": "forma_pagamento",
    "Chave PIX/Código boleto": "chave_pix_boleto"
};

const AccountsPayableImportModal: React.FC<ImportModalProps> = ({ onClose, onSuccess }) => {
    const [step, setStep] = useState<'UPLOAD' | 'REVIEW' | 'SAVING'>('UPLOAD');
    const [file, setFile] = useState<File | null>(null);
    const [stats, setStats] = useState({ new: 0, updated: 0, unchanged: 0 });
    const [previewData, setPreviewData] = useState<{ newRows: any[], updatedRows: any[] }>({ newRows: [], updatedRows: [] });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDownloadTemplate = () => {
        const headers = Object.keys(COLUMNS_MAP);
        const ws = XLSX.utils.aoa_to_sheet([headers]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Modelo Importacao");
        XLSX.writeFile(wb, "Modelo_Contas_Pagar.xlsx");
    };

    const processFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;
        setFile(selectedFile);

        const reader = new FileReader();
        reader.onload = async (evt) => {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_json(ws);

            await analyzeData(data);
        };
        reader.readAsBinaryString(selectedFile);
    };

    const excelDateToISO = (serialOrStr: any) => {
        if (!serialOrStr) return null;
        if (typeof serialOrStr === 'number') {
            const utc_days = Math.floor(serialOrStr - 25569);
            const utc_value = utc_days * 86400;
            const date_info = new Date(utc_value * 1000);
            return date_info.toISOString().split('T')[0];
        }
        if (typeof serialOrStr === 'string' && serialOrStr.includes('/')) {
            const parts = serialOrStr.split('/');
            if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        return String(serialOrStr);
    };

    const parseCurrency = (val: any) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        if (typeof val === 'string') {
            let clean = val.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
            return parseFloat(clean) || 0;
        }
        return 0;
    };

    const analyzeData = async (importedRows: any[]) => {
        // Mapear cabeçalhos da planilha para colunas do banco ANTES de qualquer coisa
        const cleanedRows = importedRows.map(raw => {
            const row: any = {};
            Object.entries(COLUMNS_MAP).forEach(([header, column]) => {
                row[column] = raw[header] || raw[column]; // Aceita tanto o cabeçalho humano quanto o nome da coluna
            });

            // Higienização
            ['data_emissao', 'data_vencimento', 'data_liquidacao'].forEach(field => {
                if (row[field]) row[field] = excelDateToISO(row[field]);
            });
            ['valor_documento', 'saldo', 'valor_pago'].forEach(field => {
                row[field] = parseCurrency(row[field]);
            });

            return row;
        });

        const importedIds = cleanedRows.map(r => String(r.id)).filter(id => id && id !== 'undefined');

        const { data: existingData, error } = await supabaseClient
            .from('accounts_payable')
            .select('*')
            .in('id', importedIds);

        if (error) {
            alert("Erro ao verificar dados existentes: " + error.message);
            return;
        }

        const existingMap = new Map((existingData || []).map(d => [String(d.id), d]));
        const newRows: any[] = [];
        const updatedRows: any[] = [];
        let unchangedCount = 0;

        cleanedRows.forEach((row: any) => {
            const id = String(row.id);
            if (!id || id === 'undefined') return;

            const existing = existingMap.get(id);

            if (!existing) {
                newRows.push(row);
            } else {
                let hasChanges = false;
                const diffs: any = { _id: id };

                Object.values(COLUMNS_MAP).forEach(col => {
                    if (col === 'id') return;

                    let valImport = row[col];
                    let valExist = existing[col];

                    // Proteção: não remove data de liquidação existente se a nova estiver vazia
                    if (col === 'data_liquidacao' && !valImport && valExist) return;

                    const strImport = (valImport === undefined || valImport === null) ? "" : String(valImport);
                    const strExist = (valExist === undefined || valExist === null) ? "" : String(valExist);

                    if (strImport !== strExist) {
                        hasChanges = true;
                        diffs[col] = { old: valExist, new: valImport };
                    }
                });

                if (hasChanges) {
                    updatedRows.push({ ...row, _diffs: diffs });
                } else {
                    unchangedCount++;
                }
            }
        });

        setPreviewData({ newRows, updatedRows });
        setStats({ new: newRows.length, updated: updatedRows.length, unchanged: unchangedCount });
        setStep('REVIEW');
    };

    const handleSave = async () => {
        setStep('SAVING');
        try {
            const allPayload = [...previewData.newRows, ...previewData.updatedRows.map(r => {
                const { _diffs, ...rest } = r;
                return rest;
            })];

            if (allPayload.length === 0) {
                onSuccess();
                return;
            }

            const BATCH_SIZE = 100;
            for (let i = 0; i < allPayload.length; i += BATCH_SIZE) {
                const batch = allPayload.slice(i, i + BATCH_SIZE);
                const { error } = await supabaseClient
                    .from('accounts_payable')
                    .upsert(batch);

                if (error) throw error;
            }

            // NEW: Registra o log para alimentar a "Última Atualização"
            try {
                // Se recebermos currentUser via props (precisaria adicionar na interface), usamos. 
                // Como paliativo, usamos um usuário genérico se não disponível ou recuperamos da sessão.
                const userEmail = (await supabaseClient.auth.getUser()).data.user?.email || 'sistema@nzerp.com';

                await supabaseClient.from('financial_logs').insert({
                    usuario: userEmail,
                    acao: 'IMPORTACAO_AP',
                    cliente: file?.name || 'Arquivo Manual',
                    detalhes: `Importação de ${allPayload.length} títulos.`,
                    valor: allPayload.length, // Usando valor para qtd registros
                    timestamp: new Date().toISOString()
                });
            } catch (logErr) {
                console.error("Erro ao gerar log de importação", logErr);
            }

            onSuccess();
        } catch (err: any) {
            alert(`ERRO AO IMPORTAR: ${err.message}`);
            setStep('REVIEW');
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h2 className="text-2xl font-black text-slate-800 uppercase italic tracking-tighter">Importar Contas a Pagar</h2>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
                            {step === 'UPLOAD' && 'Carregamento de Dados'}
                            {step === 'REVIEW' && 'Validação Técnica'}
                            {step === 'SAVING' && 'Gravando no Banco...'}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-all"><ICONS.Close className="w-6 h-6 text-slate-400" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {step === 'UPLOAD' && (
                        <div className="flex flex-col md:flex-row gap-8">
                            <div className="flex-1 space-y-6">
                                <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100">
                                    <h3 className="text-indigo-700 font-black uppercase text-sm tracking-widest mb-4 flex items-center gap-2">
                                        <ICONS.Document className="w-4 h-4" /> Instruções
                                    </h3>
                                    <ul className="space-y-3 text-xs font-medium text-slate-600">
                                        <li>• Use a planilha modelo para evitar erros de coluna.</li>
                                        <li>• O campo <b>ID</b> é obrigatório para atualizações.</li>
                                        <li>• Valores devem ser numéricos (ex: 1500,50).</li>
                                        <li>• Situações sugeridas: <b>PAGA</b>, <b>EM ABERTO</b>, <b>CANCELADO</b>.</li>
                                    </ul>
                                </div>
                                <button
                                    onClick={handleDownloadTemplate}
                                    className="w-full py-4 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-indigo-500 hover:bg-indigo-50 transition-all group"
                                >
                                    <ICONS.Download className="w-6 h-6 text-slate-400 group-hover:text-indigo-500" />
                                    <span className="text-xs font-black uppercase text-slate-400 group-hover:text-indigo-600">Baixar Planilha Modelo</span>
                                </button>
                            </div>

                            <div className="flex-[1.5] border-l border-slate-100 pl-8 flex justify-center items-center">
                                <input type="file" ref={fileInputRef} onChange={processFile} className="hidden" />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full max-w-sm aspect-video bg-slate-900 rounded-[2rem] flex flex-col items-center justify-center gap-4 text-white hover:scale-105 transition-all shadow-xl"
                                >
                                    <ICONS.Upload className="w-12 h-12" />
                                    <div className="text-center font-black uppercase italic tracking-tighter">Carregar Arquivo</div>
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 'REVIEW' && (
                        <div className="space-y-8">
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                                    <p className="text-[9px] font-black uppercase text-emerald-400">Novos</p>
                                    <p className="text-2xl font-black text-emerald-600">{stats.new}</p>
                                </div>
                                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                                    <p className="text-[9px] font-black uppercase text-amber-400">Atualizações</p>
                                    <p className="text-2xl font-black text-amber-600">{stats.updated}</p>
                                </div>
                                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 opacity-50">
                                    <p className="text-[9px] font-black uppercase text-slate-400">Inalterados</p>
                                    <p className="text-2xl font-black text-slate-600">{stats.unchanged}</p>
                                </div>
                            </div>

                            {stats.updated > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-xs font-black uppercase text-amber-600">Alterações Detectadas</h4>
                                    <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
                                        {previewData.updatedRows.map(r => (
                                            <div key={r.id} className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm text-[10px]">
                                                <p className="font-black text-slate-700 mb-2">ID: {r.id} - {r.fornecedor}</p>
                                                {Object.keys(r._diffs).map(k => k !== '_id' && (
                                                    <div key={k} className="flex gap-2 ml-2">
                                                        <span className="font-bold text-slate-400 w-20 text-right">{k}:</span>
                                                        <span className="line-through text-red-300">{String(r._diffs[k].old || "-")}</span>
                                                        <span className="text-slate-300">➜</span>
                                                        <span className="text-emerald-600 font-bold">{String(r._diffs[k].new)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-4">
                    {step === 'REVIEW' && (
                        <>
                            <button onClick={() => setStep('UPLOAD')} className="px-6 py-3 rounded-xl font-bold text-slate-500 uppercase text-xs">Voltar</button>
                            <button onClick={handleSave} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-black uppercase text-xs hover:bg-emerald-600 transition-all">Confirmar Importação</button>
                        </>
                    )}
                    {step === 'UPLOAD' && <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-slate-500 uppercase text-xs">Fechar</button>}
                </div>
            </div>
        </div>
    );
};

export default AccountsPayableImportModal;
