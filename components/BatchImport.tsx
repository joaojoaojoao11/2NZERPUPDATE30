
import React, { useState } from 'react';
import { DataService } from '../services/dataService';
import Toast from './Toast';
import { ICONS } from '../constants';
import { User } from '../types';

interface BatchImportProps {
  currentUser: User;
  onSuccess: () => void;
}

const BatchImport: React.FC<BatchImportProps> = ({ currentUser, onSuccess }) => {
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [summary, setSummary] = useState<{ successCount: number, totalCount: number, errorMessages: string[] } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        setFileContent(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const parseCSV = (csvText: string) => {
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) return [];

    let separator = '|';
    if (!lines[0].includes('|') && lines[0].includes(',')) separator = ',';

    const headers = lines[0].toLowerCase().split(separator).map(h => h.trim());
    
    return lines.slice(1).filter(line => line.trim() !== "").map(line => {
      const values = line.split(separator).map(v => v.trim());
      const obj: any = {};
      headers.forEach((header, i) => {
        if (header.includes('sku')) obj.sku = values[i];
        else if (header.includes('marca')) obj.marca = values[i];
        else if (header.includes('categoria')) obj.categoria = values[i];
        else if (header.includes('fornecedor')) obj.fornecedor = values[i];
        else if (header.includes('desc') || header.includes('nome')) obj.descricao = values[i];
        else if (header.includes('larg') || header.includes(' l ')) obj.larguraL = Number(values[i].replace(',', '.'));
        else if (header.includes('quant') || header.includes(' ml')) obj.quantMl = Number(values[i].replace(',', '.'));
        else if (header.includes('caixa') || header.includes('posi')) obj.nCaixa = values[i];
        // Campos de Localização: Texto Livre (Sem validação)
        else if (header.includes('coluna')) obj.coluna = values[i].toUpperCase();
        else if (header.includes('prat') || header.includes('nivel')) obj.prateleira = values[i].toUpperCase();
      });
      // Defaults se não vier na planilha
      if (!obj.coluna) obj.coluna = 'GERAL';
      if (!obj.prateleira) obj.prateleira = 'CHÃO';
      
      return obj;
    });
  };

  const handleImport = async () => {
    if (!fileContent) return;
    setIsProcessing(true);
    
    try {
      const items = parseCSV(fileContent);
      if (items.length === 0) {
        setToast({ msg: "Arquivo vazio ou cabeçalhos inválidos.", type: 'error' });
        setIsProcessing(false);
        return;
      }
      
      const result = await DataService.processInboundBatch(items, currentUser, fileName);
      
      if (result.success) {
        setSummary({ successCount: items.length, totalCount: items.length, errorMessages: [] });
        setToast({ msg: `${items.length} produtos importados com sucesso!`, type: 'success' });
        onSuccess();
      } else {
        setSummary({ successCount: 0, totalCount: items.length, errorMessages: [result.message || "Erro desconhecido ao importar lote."] });
        setToast({ msg: result.message || "Nenhum produto foi importado. Verifique os erros.", type: 'error' });
      }
    } catch (err: any) {
      setSummary({ successCount: 0, totalCount: parseCSV(fileContent).length, errorMessages: [err.message || "Erro ao processar o arquivo. Verifique o delimitador Pipe (|)."] });
      setToast({ msg: `Erro crítico: ${err.message || "Erro ao processar o arquivo. Verifique o delimitador Pipe (|)."}`, type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
        <div className="flex items-center space-x-4 mb-8">
          <div className="p-3 bg-indigo-600 rounded-2xl text-white">
            <ICONS.Upload className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800">Importação em Lote</h2>
            <p className="text-sm text-slate-500 font-medium">Delimitador oficial: Pipe (|) para proteção de decimais.</p>
          </div>
        </div>

        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-10 text-center space-y-4">
          <input 
            type="file" 
            accept=".csv,.txt" 
            onChange={handleFileChange} 
            className="hidden" 
            id="batch-file-input" 
          />
          <label 
            htmlFor="batch-file-input" 
            className="cursor-pointer inline-flex flex-col items-center group"
          >
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center text-slate-400 group-hover:text-indigo-600 group-hover:shadow-md transition-all mb-4">
              <ICONS.Upload className="w-8 h-8" />
            </div>
            <span className="text-slate-700 font-bold block">
              {fileName || "Selecione o arquivo .CSV ou .TXT"}
            </span>
            <span className="text-xs text-slate-400 mt-1">Recomendado formato Pipe Delimited (|)</span>
          </label>
        </div>

        <div className="mt-8 bg-blue-50 p-6 rounded-2xl">
          <h4 className="text-sm font-black text-blue-800 uppercase tracking-widest mb-3">Cabeçalhos Aceitos (Separados por | )</h4>
          <div className="bg-white/50 p-3 rounded-lg font-mono text-[10px] text-blue-900 overflow-x-auto whitespace-nowrap">
            sku|marca|categoria|fornecedor|descricao|larguraL|quantMl|nCaixa|coluna|prateleira
          </div>
        </div>

        <div className="mt-8 flex justify-end space-x-4">
          <button onClick={onSuccess} className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-all">Cancelar</button>
          <button 
            disabled={!fileContent || isProcessing}
            onClick={handleImport}
            className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black hover:bg-indigo-700 shadow-xl shadow-indigo-100 disabled:opacity-50 transition-all flex items-center space-x-2"
          >
            {isProcessing ? <span>Processando...</span> : (
              <>
                <ICONS.Upload className="w-4 h-4" />
                <span>Importar Agora (Pipe)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {summary && (
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 animate-in slide-in-from-top-4 duration-500">
          <h3 className="text-lg font-black text-slate-800 mb-4 uppercase tracking-tight">Resumo da Importação</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-50 p-4 rounded-xl">
              <p className="text-[10px] font-black text-slate-400 uppercase">Total Linhas</p>
              <p className="text-2xl font-black text-slate-800">{summary.totalCount}</p>
            </div>
            <div className="bg-emerald-50 p-4 rounded-xl">
              <p className="text-[10px] font-black text-emerald-400 uppercase">Sucesso</p>
              <p className="text-2xl font-black text-emerald-600">{summary.successCount}</p>
            </div>
            <div className="bg-red-50 p-4 rounded-xl">
              <p className="text-[10px] font-black text-red-400 uppercase">Erros</p>
              <p className="text-2xl font-black text-red-600">{summary.errorMessages.length}</p>
            </div>
          </div>
          {summary.errorMessages.length > 0 && (
            <div className="bg-red-50 p-4 rounded-xl border border-red-100 mt-4">
              <h4 className="text-sm font-black text-red-700 mb-2">Detalhes dos Erros:</h4>
              <ul className="list-disc list-inside text-xs text-red-600">
                {summary.errorMessages.map((msg, index) => <li key={index}>{msg}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BatchImport;
