
const TOKEN = '54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0';
const DATA_INICIAL = '27/01/2026';

console.log(`Checking Tiny Orders since ${DATA_INICIAL}...`);

const url = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${TOKEN}&formato=json&data_inicial=${DATA_INICIAL}`;

try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.retorno.status === 'Erro') {
        console.error('API Error:', data.retorno.erros);
    } else {
        const pedidos = data.retorno.pedidos || [];
        console.log(`Found ${pedidos.length} orders.`);

        pedidos.forEach(p => {
            console.log(`- Order ${p.pedido.id}: ${p.pedido.data_pedido} - ${(p.pedido.cliente && p.pedido.cliente.nome) || 'No Name'} - Status: ${p.pedido.situacao}`);
        });
    }
} catch (e) {
    console.error('Script Error:', e);
}
