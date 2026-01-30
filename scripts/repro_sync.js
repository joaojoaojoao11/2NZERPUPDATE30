
const TOKEN = '54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0';

function parseTinyDate(dateStr) {
    if (!dateStr) return new Date().toISOString();
    try {
        const cleanDate = dateStr.split(' ')[0].trim();
        let year, month, day;
        if (cleanDate.includes('/')) {
            [day, month, year] = cleanDate.split('/');
        } else if (cleanDate.includes('-')) {
            [year, month, day] = cleanDate.split('-');
        } else {
            return new Date().toISOString();
        }
        return new Date(`${year}-${month}-${day}T12:00:00.000Z`).toISOString();
    } catch (e) {
        return new Date().toISOString();
    }
}

async function run() {
    console.log("Simulating Sync Logic...");

    // 1. Get Pages
    const urlInitial = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${TOKEN}&formato=json&limit=50&pagina=1`;
    const resInitial = await fetch(urlInitial);
    const jsonInitial = await resInitial.json();
    const totalPaginas = Number(jsonInitial.retorno.numero_paginas || 1);
    console.log(`Total Pages: ${totalPaginas}`);

    // 2. Cutoff
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    console.log(`Cutoff: ${cutoffDate.toISOString()}`);

    // 3. Loop Last Page
    const pagina = totalPaginas;
    console.log(`Processing Page ${pagina}...`);

    const urlBusca = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${TOKEN}&formato=json&limit=50&pagina=${pagina}`;
    const resBusca = await fetch(urlBusca);
    const jsonBusca = await resBusca.json();
    const listaPedidos = jsonBusca.retorno.pedidos || [];

    console.log(`Found ${listaPedidos.length} orders.`);

    for (const item of listaPedidos) {
        const p = item.pedido;
        const rawDate = p.data_pedido;

        let shouldProcess = false;
        if (rawDate) {
            const [d, m, y] = rawDate.split('/');
            // Month is 0-indexed in JS Date? NO, in string YYYY-MM-DD it is 1-indexed.
            // But new Date(y, m-1, d) uses 0-index.
            // new Date("YYYY-MM-DD") uses 1-index.
            const pDate = new Date(`${y}-${m}-${d}`);

            if (pDate >= cutoffDate) {
                shouldProcess = true;
            } else {
                console.log(`IGNORED OLD: ${rawDate}`);
            }
        }

        if (shouldProcess) {
            const parsed = parseTinyDate(rawDate);
            console.log(`PROCESSING: ID ${p.id} Date ${rawDate} -> Parsed ${parsed}`);
        }
    }
}

run();
