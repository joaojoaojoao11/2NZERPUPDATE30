
import { supabaseClient as supabase } from './core';

const TINY_API_URL = '/api/tiny'; // Proxy configurado no Vite
const TOKEN = import.meta.env.VITE_TINY_TOKEN;

export const OlistService = {
    /**
     * Sincroniza o status dos pedidos em aberto (não ENTREGUE/CANCELADO) verificando no Tiny API.
     */
    async syncStatusOrders(): Promise<void> {
        if (!TOKEN) {
            console.warn("VITE_TINY_TOKEN não configurado. Impossível sincronizar status.");
            return;
        }

        // 1. Buscar pedidos locais que precisam de atualização (não finalizados)
        // Regra de otimização: Ignorar pedidos finalizados (ENTREGUE/CANCELADO) e anteriores a 60 dias
        const limitDate = new Date();
        limitDate.setDate(limitDate.getDate() - 60);
        const limitDateStr = limitDate.toISOString();

        const { data: pendingOrders, error } = await supabase
            .from('sales_history')
            .select('id, external_id, order_number, status')
            .not('status', 'in', '("ENTREGUE","CANCELADO","Entregue","Cancelado")')
            .gt('sale_date', limitDateStr)
            .order('sale_date', { ascending: false })
            .limit(200);

        if (error || !pendingOrders || pendingOrders.length === 0) return;

        // 2. Para cada pedido, consultar no Tiny
        for (const order of pendingOrders) {
            // Se tiver ID externo (Tiny ID) ou Número
            if (!order.external_id && !order.order_number) continue;

            try {
                await this.checkAndUpdateOrder(order);
            } catch (err) {
                console.error(`Erro ao atualizar pedido ${order.order_number}:`, err);
            }
        }
    },

    async checkAndUpdateOrder(localOrder: any) {
        // Busca no Tiny pelo ID ou Número
        const params = new URLSearchParams({
            token: TOKEN,
            formato: 'json'
        });

        // Se tiver external_id (ID do Tiny), usa 'id_pedido', senão 'numero'
        // Mas a API de pesquisa do Tiny geralmente é 'pedidos.pesquisa.php' e aceita 'numero' ou 'id'.
        // API: pedidos.pesquisa.php?token=...&numero=123

        if (localOrder.order_number) {
            params.append('numero', localOrder.order_number);
        } else if (localOrder.external_id) {
            // Se a busca por id não for direta na pesquisa, teriamos que usar 'pedido.obter'
            // Vamos tentar pelo número first se disponivel
            params.append('id', localOrder.external_id);
        }

        const response = await fetch(`${TINY_API_URL}/pedidos.pesquisa.php?${params.toString()}`);
        const data = await response.json();

        if (data.retorno.status === 'OK' && data.retorno.pedidos && data.retorno.pedidos.length > 0) {
            const tinyOrder = data.retorno.pedidos[0].pedido;

            // Normaliza status
            const currentStatus = (tinyOrder.situacao || '').toUpperCase();
            const localStatus = (localOrder.status || '').toUpperCase();

            if (currentStatus && currentStatus !== localStatus) {
                // Atualiza no Supabase
                console.log(`[OlistService] Atualizando status de #${localOrder.order_number}: ${localStatus} -> ${currentStatus}`);
                await supabase
                    .from('sales_history')
                    .update({ status: currentStatus })
                    .eq('id', localOrder.id);
            }
        }
    }
};
