import React, { useState } from 'react';
import { DataService } from '../services/dataService';
import { CATEGORIES } from '../constants';
import { User } from '../types';

interface ProductFormProps {
  user: User;
  onSuccess: () => void;
}

const ProductForm: React.FC<ProductFormProps> = ({ user, onSuccess }) => {
  const [formData, setFormData] = useState({
    sku: '',
    marca: '',
    categoria: CATEGORIES[0],
    fornecedor: '',
    descricao: '',
    larguraL: '1,52',
    quantMl: '0',
    estoqueMinimo: '0',
    metragemPadrao: '15',
    custoUnitario: '0',
    precoVenda: '0',
    responsavel: user.name
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    // Lista de campos numéricos para validação instantânea
    const numericFields = ['larguraL', 'quantMl', 'estoqueMinimo', 'metragemPadrao', 'custoUnitario', 'precoVenda'];
    
    if (numericFields.indexOf(name) === -1) {
      setFormData(prev => ({ ...prev, [name]: value }));
      return;
    }

    // Para campos numéricos: permitir apenas números, vírgula e ponto
    const sanitizedValue = value.replace(/[^0-9,.]/g, '');
    setFormData(prev => ({ ...prev, [name]: sanitizedValue }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.sku || !formData.descricao || !formData.responsavel) {
      setError('Preencha os campos obrigatórios (SKU, Descrição e Responsável).');
      return;
    }

    // Converte vírgula para ponto e transforma em Number para a API
    const parsedData = {
      ...formData,
      larguraL: Number(formData.larguraL.replace(',', '.')),
      quantMl: Number(formData.quantMl.replace(',', '.')),
      estoqueMinimo: Number(formData.estoqueMinimo.replace(',', '.')),
      metragemPadrao: Number(formData.metragemPadrao.replace(',', '.')),
      custoUnitario: Number(formData.custoUnitario.replace(',', '.')),
      precoVenda: Number(formData.precoVenda.replace(',', '.'))
    };

    const hasInvalidNumber = isNaN(parsedData.larguraL) || 
                            isNaN(parsedData.quantMl) || 
                            isNaN(parsedData.estoqueMinimo) ||
                            isNaN(parsedData.precoVenda);

    if (hasInvalidNumber) {
      setError('Verifique os valores numéricos inseridos (use vírgula ou ponto).');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await DataService.addProduct(parsedData, user);
      if (result.success) {
        onSuccess();
      } else {
        const errorMsg = result.message ? (typeof result.message === 'string' ? result.message : JSON.stringify(result.message)) : 'Falha ao processar cadastro.';
        setError(errorMsg);
      }
    } catch (err: any) {
      setError('Erro na comunicação com o servidor: ' + (err.message || String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-lg border border-slate-100 animate-in fade-in duration-300">
      <div className="flex items-center space-x-3 mb-8">
        <div className="p-2 bg-emerald-600 rounded-lg text-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-slate-800">Cadastrar Novo Material</h2>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">SKU do Produto *</label>
            <input name="sku" value={formData.sku} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none uppercase font-bold" placeholder="Ex: NZW01" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Marca</label>
            <input name="marca" value={formData.marca} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none uppercase" placeholder="Ex: ORACAL" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Categoria</label>
            <select name="categoria" value={formData.categoria} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Fornecedor</label>
            <input name="fornecedor" value={formData.fornecedor} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none uppercase" placeholder="Ex: SIGN HOUSE" />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Nome / Descrição NZ *</label>
            <input name="descricao" value={formData.descricao} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none uppercase" placeholder="Nome completo do material" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Largura (m)</label>
              <input name="larguraL" value={formData.larguraL} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Estoque Mínimo (ML)</label>
              <input name="estoqueMinimo" value={formData.estoqueMinimo} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-red-500 outline-none font-bold text-red-600" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Custo (R$/ML)</label>
              <input name="custoUnitario" value={formData.custoUnitario} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold text-emerald-600" />
            </div>
            <div>
              <label className="block text-xs font-bold text-blue-600 uppercase mb-1">Preço Venda (R$/ML)</label>
              <input name="precoVenda" value={formData.precoVenda} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-600" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Metragem Padrão (m)</label>
              <input name="metragemPadrao" value={formData.metragemPadrao} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold" />
            </div>
            <div>
              <label className="block text-xs font-bold text-blue-600 uppercase mb-1">Quant. Inicial (ML)</label>
              <input name="quantMl" value={formData.quantMl} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-600" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Responsável pelo Cadastro *</label>
            <input name="responsavel" value={formData.responsavel} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none uppercase" placeholder="Seu nome" />
          </div>
        </div>

        {error && <div className="md:col-span-2 p-3 bg-red-50 text-red-600 rounded-lg text-[11px] font-black uppercase border border-red-100 italic">{error}</div>}

        <div className="md:col-span-2 mt-4">
          <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest italic py-4 rounded-xl transition-all shadow-xl shadow-emerald-100 flex items-center justify-center space-x-2 active:scale-95 disabled:opacity-50">
            {isSubmitting ? 'SINCRONIZANDO...' : 'Salvar Novo Material'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProductForm;
