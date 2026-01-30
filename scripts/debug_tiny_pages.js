
const TOKEN = '54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0';

async function checkPages() {
    console.log('Checking Total Pages...');
    const url = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${TOKEN}&formato=json&limit=50&pagina=1`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.retorno.status === 'Erro') {
            console.error('API Error:', data.retorno.erros);
            return;
        }

        const totalPaginas = Number(data.retorno.numero_paginas);
        const totalRegistros = Number(data.retorno.total_registros);
        console.log(`Total Pages: ${totalPaginas}`);
        console.log(`Total Records: ${totalRegistros}`);

        // Check Last Page
        if (totalPaginas > 1) {
            console.log(`Checking Last Page (${totalPaginas})...`);
            const urlLast = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${TOKEN}&formato=json&limit=50&pagina=${totalPaginas}`;
            const resLast = await fetch(urlLast);
            const dataLast = await resLast.json();
            const pedidos = dataLast.retorno.pedidos || [];
            console.log(`Found ${pedidos.length} orders on last page.`);
            if (pedidos.length > 0) {
                const first = pedidos[0].pedido;
                const last = pedidos[pedidos.length - 1].pedido;
                console.log(`- First on Last Page: ${first.data_pedido} (ID: ${first.id})`);
                console.log(`- Last on Last Page:  ${last.data_pedido} (ID: ${last.id})`);
            }
        }

    } catch (e) {
        console.error('Script Error:', e);
    }
}

checkPages();
