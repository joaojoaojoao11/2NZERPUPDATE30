
const TOKEN = '54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0';

async function testFormat(dateStr, label) {
    console.log(`Testing format: ${label} (${dateStr})...`);
    const url = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${TOKEN}&formato=json&data_inicial=${dateStr}&limit=5`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        const pedidos = data.retorno.pedidos || [];
        if (pedidos.length > 0) {
            console.log(`  -> First order date: ${pedidos[0].pedido.data_pedido} (ID: ${pedidos[0].pedido.id})`);
        } else {
            console.log(`  -> No orders found (or filtering worked too well?)`);
        }
    } catch (e) {
        console.error('  -> Error', e.message);
    }
}

console.log('--- Starting Format Tests ---');
await testFormat('27/01/2026', 'dd/mm/aaaa');
await testFormat('2026-01-27', 'aaaa-mm-dd');
await testFormat('27-01-2026', 'dd-mm-aaaa');
