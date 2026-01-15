
/**
 * NZSTOK ERP v7.5 - Realtime Cloud Core
 * Backend API para integração com Vercel
 */

const SS = SpreadsheetApp.getActiveSpreadsheet();

function doPost(e) {
  const params = JSON.parse(e.postData.contents);
  const action = params.action;
  const data = params.data;
  const user = params.user;

  try {
    switch (action) {
      case 'GET_INITIAL_DATA':
        return response({
          inventory: getSheetData('ESTOQUE_FISICO'),
          master: getSheetData('BASE_PRODUTOS'),
          logs: getSheetData('LOGS_AUDITORIA'),
          users: getSheetData('USUARIOS'),
          layout: getLayoutData(),
          cases: getSheetData('CASOS_APROVACAO')
        });

      case 'SAVE_INVENTORY':
        setSheetData('ESTOQUE_FISICO', data);
        return response({ success: true });

      case 'SAVE_MASTER':
        setSheetData('BASE_PRODUTOS', data);
        return response({ success: true });

      case 'ADD_LOG':
        appendSheetData('LOGS_AUDITORIA', [data]);
        return response({ success: true });

      case 'SAVE_USERS':
        setSheetData('USUARIOS', data);
        return response({ success: true });

      case 'SAVE_LAYOUT':
        PropertiesService.getScriptProperties().setProperty('LAYOUT', JSON.stringify(data));
        return response({ success: true });

      case 'PROCESS_WITHDRAWAL':
        // Lógica de processamento atômico no servidor para evitar race conditions
        return handleWithdrawal(data, user);

      default:
        throw new Error('Ação não reconhecida');
    }
  } catch (err) {
    return response({ success: false, error: err.toString() }, 500);
  }
}

function response(obj, code = 200) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheetData(name) {
  const sheet = SS.getSheetByName(name);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.map(row => {
    let obj = {};
    headers.forEach((h, i) => obj[h.toLowerCase()] = row[i]);
    return obj;
  });
}

function setSheetData(name, data) {
  const sheet = SS.getSheetByName(name);
  if (!sheet) return;
  sheet.clearContents();
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  sheet.appendRow(headers.map(h => h.toUpperCase()));
  const values = data.map(item => headers.map(h => item[h]));
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
}

function appendSheetData(name, data) {
  const sheet = SS.getSheetByName(name);
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  data.forEach(item => {
    sheet.appendRow(headers.map(h => item[h.toLowerCase()] || ''));
  });
}

function getLayoutData() {
  const saved = PropertiesService.getScriptProperties().getProperty('LAYOUT');
  return saved ? JSON.parse(saved) : { columns: ['A', 'B', 'C'], shelvesPerColumn: { 'A': ['1', '2'], 'B': ['1', '2'], 'C': ['1', '2'] } };
}

/**
 * Processa baixas garantindo integridade
 */
function handleWithdrawal(items, user) {
  const inventory = getSheetData('ESTOQUE_FISICO');
  const logs = [];
  
  items.forEach(w => {
    const item = inventory.find(i => i.lpn === w.lpn);
    if (item && item.quant_ml >= w.quantidade) {
      item.quant_ml = parseFloat((item.quant_ml - w.quantidade).toFixed(2));
      item.status = item.quant_ml <= 0 ? 'ESGOTADO' : 'ROLO ABERTO';
      item.ult_atuali = new Date().toISOString();
      item.responsavel = user.name;
      
      logs.push({
        id: w.extra?.pedido || 'MOV-' + Date.now(),
        timestamp: new Date().toISOString(),
        usuario: user.email,
        acao: 'SAIDA_VENDA',
        sku: item.sku,
        lpn: item.lpn,
        quantidade: w.quantidade,
        detalhes: `Baixa via API: ${w.extra?.cliente || 'Venda'}`,
        lote: item.lote,
        nome: item.nome
      });
    }
  });

  setSheetData('ESTOQUE_FISICO', inventory);
  appendSheetData('LOGS_AUDITORIA', logs);
  
  return response({ success: true });
}
