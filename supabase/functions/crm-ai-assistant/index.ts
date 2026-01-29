import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { text } = await req.json();
        if (!text) throw new Error('Texto não fornecido.');

        // Chave do Gemini (Vem do .env do Supabase)
        // OBS: O usuário precisará setar GEMINI_API_KEY no Supabase
        const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('VITE_GEMINI_API_KEY');

        if (!GEMINI_KEY) throw new Error('Chave da API Gemini não configurada no servidor.');

        // Prompt Otimizado
        const prompt = `
      Você é um assistente comercial experiente. Analise a seguinte conversa ou texto copiado de um chat (WhatsApp/Instagram):
      
      "${text.substring(0, 5000)}"

      Gere um resumo JSON estrito com os seguintes campos:
      - resumo (string): Resumo conciso do que foi falado.
      - interesse (string): Qual produto ou serviço o cliente quer.
      - objecoes (string): Dúvidas ou impedimentos citados.
      - sentimento (string): "Positivo", "Neutro" ou "Negativo".
      - tags (array de strings): Ex: ["Urgente", "Preço", "Dúvida Técnica"].
      - proximo_passo (string): Sugestão de ação para o vendedor.
      
      Responda APENAS o JSON.
    `;

        // Chamada à API do Gemini (REST)
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_KEY}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();

        // Extração segura do JSON na resposta (caso venha texto em volta)
        let aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();

        const result = JSON.parse(aiText);

        return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        });
    }
});
