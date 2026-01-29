
import fs from 'fs';
import path from 'path';
import https from 'https';

// Função simples para ler env
function getEnvValue(key) {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(new RegExp(`${key}=(.*)`));
        return match ? match[1].trim() : null;
    } catch (e) {
        return null;
    }
}

const token = getEnvValue('VITE_TINY_TOKEN');

if (!token) {
    console.error("❌ ERRO: Token não encontrado no .env.local");
    process.exit(1);
}

// Configuração do Request
const endpoint = '/api2/contatos.pesquisa.php';
const hostname = 'api.tiny.com.br';
const searchQuery = process.argv[2] || '';
const params = `token=${token}&formato=json&pesquisa=${searchQuery}`;

const options = {
    hostname: hostname,
    path: `${endpoint}?${params}`,
    method: 'GET',
    headers: {
        'Content-Type': 'application/json'
    }
};

console.log(`📡 Testando Conexão com Tiny API...`);
console.log(`URL: https://${hostname}${endpoint}`);

const req = https.request(options, (res) => {
    let data = '';

    console.log(`Status Code: ${res.statusCode}`);

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log("\n⬇️ RESPOSTA DO TINY (Salvando em tiny_result.json)...");
        fs.writeFileSync('tiny_result.json', data, 'utf8');

        if (data.includes("File not found")) {
            console.error("\n❌ DIAGNÓSTICO: O endpoint parece estar errado (File not found).");
        } else if (res.statusCode === 200) {
            console.log("\n✅ SUCESSO: Conexão estabelecida e endpoint válido!");
        }
    });
});

req.on('error', (e) => {
    console.error(`❌ Erro na requisição: ${e.message}`);
});

req.end();
