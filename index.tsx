import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  // Se o HTML não tiver a div root, avisa na tela
  document.body.innerHTML = '<div style="color: red; padding: 20px; font-size: 20px;">ERRO FATAL: Elemento "root" não encontrado no index.html</div>';
  throw new Error("Could not find root element to mount to");
}

try {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  // Captura erros que acontecem logo no início
  console.error("ERRO DE INICIALIZAÇÃO:", error);
  rootElement.innerHTML = `
    <div style="padding: 40px; font-family: system-ui, sans-serif; text-align: center;">
      <h1 style="color: #e11d48; margin-bottom: 20px;">Ocorreu um erro ao iniciar</h1>
      <p style="color: #475569; margin-bottom: 30px;">O sistema não pôde ser carregado. Detalhes técnicos abaixo:</p>
      <pre style="background: #f1f5f9; padding: 20px; border-radius: 8px; text-align: left; overflow: auto; max-width: 800px; margin: 0 auto; border: 1px solid #cbd5e1;">
        ${error instanceof Error ? error.message : JSON.stringify(error)}
      </pre>
    </div>
  `;
}