import React, { useState } from 'react';
import { ICONS } from '../../constants';
// Supondo que você use um Toast system já existente, ou podemos injetar
// import toast from '...'

interface AIAssistantProps {
    onSummaryGenerated: (summary: string) => void;
}

export const AIAssistant: React.FC<AIAssistantProps> = ({ onSummaryGenerated }) => {
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    const handleGenerate = async () => {
        if (!inputText.trim()) return;

        setLoading(true);
        try {
            const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY;
            if (!GEMINI_KEY) {
                alert('Chave API Gemini não configurada no .env local.');
                setLoading(false);
                return;
            }

            const prompt = `
            Você é um assistente comercial experiente. Analise a seguinte conversa ou texto copiado de um chat (WhatsApp/Instagram):
            
            "${inputText.substring(0, 5000)}"

            Gere um resumo JSON estrito com os seguintes campos:
            - resumo (string): Resumo conciso do que foi falado.
            - interesse (string): Qual produto ou serviço o cliente quer.
            - objecoes (string): Dúvidas ou impedimentos citados.
            - sentimento (string): "Positivo", "Neutro" ou "Negativo".
            - tags (array de strings): Ex: ["Urgente", "Preço", "Dúvida Técnica"].
            - proximo_passo (string): Sugestão de ação para o vendedor.
            
            Responda APENAS o JSON. Sem markdown em volta.
            `;

            // 1. Descobrir Modelo Disponível
            let modelName = 'gemini-1.5-flash'; // Fallback inicial
            try {
                const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`);
                if (listResp.ok) {
                    const listData = await listResp.json();
                    // Procura primeiro modelo gemini compatível
                    const model = listData.models?.find((m: any) =>
                        m.name.includes('gemini') &&
                        m.supportedGenerationMethods?.includes('generateContent')
                    );
                    if (model) {
                        modelName = model.name.replace('models/', '');
                        console.log("Modelo Auto-Detectado:", modelName);
                    } else {
                        console.warn("Nenhum modelo 'gemini' encontrado na listagem. Usando fallback.");
                        console.log("Modelos disponíveis:", listData.models);
                    }
                }
            } catch (e) {
                console.warn("Falha ao listar modelos, usando fallback", e);
            }

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error("Erro Detalhado API Gemini:", response.status, response.statusText, errorData);
                throw new Error(`Erro API Gemini (${response.status}) [Modelo: ${modelName}]: ${errorData.error?.message || response.statusText}`);
            }

            const data = await response.json();

            // Parsing seguro
            let aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
            // Limpa md code blocks se houver
            aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();

            let result;
            try {
                result = JSON.parse(aiText);
            } catch (e) {
                console.error("Erro parse JSON IA", e);
                throw new Error("Resposta da IA inválida");
            }

            // Formata o resultado como markdown para o campo de notas
            const md = `🤖 **Resumo IA:**\n\n` +
                `📌 **Resumo:** ${result.resumo || '-'}\n` +
                `🎯 **Interesse:** ${result.interesse || '-'}\n` +
                `⚠️ **Objeções:** ${result.objecoes || '-'}\n` +
                `🔥 **Sentimento:** ${result.sentimento || '-'}\n` +
                `📅 **Próx. Passo:** ${result.proximo_passo || '-'}\n` +
                `🏷️ **Tags:** ${result.tags?.join(', ') || '-'}`;

            onSummaryGenerated(md);
            setInputText('');
            setIsExpanded(false);

        } catch (e: any) {
            console.error("Erro IA:", e);
            alert(`Erro ao gerar resumo: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    if (!isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                className="flex items-center gap-2 text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-xl transition-colors w-fit border border-indigo-100 shadow-sm"
            >
                ✨ Assistente IA (Resumir Conversa)
            </button>
        );
    }

    return (
        <div className="bg-gradient-to-br from-indigo-50 to-white rounded-2xl p-4 border border-indigo-100 shadow-sm space-y-3 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
                <h4 className="text-[10px] font-black text-indigo-600 uppercase flex items-center gap-1">
                    ✨ Colar conversa do WhatsApp
                </h4>
                <button onClick={() => setIsExpanded(false)} className="text-slate-400 hover:text-red-500">
                    <ICONS.Close className="w-4 h-4" />
                </button>
            </div>

            <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="Cole aqui o texto bagunçado ou histórico de chat..."
                className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 outline-none h-24 resize-none bg-white"
            />

            <div className="flex justify-end">
                <button
                    onClick={handleGenerate}
                    disabled={loading || !inputText.trim()}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                >
                    {loading ? 'Processando (IA)...' : 'Gerar Insights'}
                    {loading && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>}
                </button>
            </div>
        </div>
    );
};
