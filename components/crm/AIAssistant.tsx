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
            // Chama a Edge Function que você acabou de criar
            // Assumindo que o Supabase client está disponível globalmente ou via prop,
            // mas aqui vamos usar fetch direto no endpoint público da function por simplicidade (requires anon key)
            // O ideal é usar supabase.functions.invoke('crm-ai-assistant') se disponível no contexto.

            // Vamos usar fetch direto na URL da function que sabemos do projeto
            // ATENÇÃO: Em produção, usar supabase-js
            const { createClient } = await import('@supabase/supabase-js');
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
            const supabase = createClient(supabaseUrl, supabaseKey);

            const { data, error } = await supabase.functions.invoke('crm-ai-assistant', {
                body: { text: inputText }
            });

            if (error) throw error;

            // Formata o resultado como markdown para o campo de notas
            const md = `🤖 **Resumo IA:**\n\n` +
                `📌 **Resumo:** ${data.resumo}\n` +
                `🎯 **Interesse:** ${data.interesse}\n` +
                `⚠️ **Objeções:** ${data.objecoes}\n` +
                `🔥 **Sentimento:** ${data.sentimento}\n` +
                `📅 **Próx. Passo:** ${data.proximo_passo}\n` +
                `🏷️ **Tags:** ${data.tags?.join(', ')}`;

            onSummaryGenerated(md);
            setInputText('');
            setIsExpanded(false);

        } catch (e) {
            console.error("Erro IA:", e);
            alert('Erro ao gerar resumo. Verifique se a chave Gemini está configurada.');
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
