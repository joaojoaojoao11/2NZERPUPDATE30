
const TOKEN = '54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0';

async function checkMetadata() {
    console.log('Checking Metadata...');
    const url = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${TOKEN}&formato=json&limit=1`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        console.log('Root keys:', Object.keys(data.retorno));
        if (data.retorno.numero_paginas) console.log('numero_paginas:', data.retorno.numero_paginas);
        if (data.retorno.total_registros) console.log('total_registros:', data.retorno.total_registros);
    } catch (e) { console.error(e); }
}

async function trySort(param, value) {
    console.log(`Trying sort param: ${param}=${value}...`);
    const url = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${TOKEN}&formato=json&limit=1&${param}=${value}`;
    const res = await fetch(url);
    const data = await res.json();
    const p = data.retorno.pedidos ? data.retorno.pedidos[0].pedido : null;
    if (p) console.log(`  -> Got ID: ${p.id} Date: ${p.data_pedido}`);
}

console.log('--- Metadata ---');
await checkMetadata();

console.log('--- Sorting ---');
await trySort('sort', 'data_pedido desc');
await trySort('sort', 'id desc');
await trySort('ordem', 'DESC');
await trySort('order', 'DESC');
