
const TOKEN = '54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0';

async function run() {
    const url = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${TOKEN}&formato=json&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    console.log(JSON.stringify(data.retorno, null, 2));
}
run();
