const fs = require('fs');

const path = require('path');

// Função para ler o arquivo .update.json

const readUpdateFile = () => {

  const filePath = path.join(__dirname, '.update.json');

  if (fs.existsSync(filePath)) {

    const data = fs.readFileSync(filePath);

    return JSON.parse(data);

  }

  return null;

};

// Função para salvar no arquivo .update.json

const saveUpdateFile = (data) => {

  const filePath = path.join(__dirname, '.update.json');

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

};

module.exports.setup = (app) => {

  // Rota para atualizar o status

  app.get('/edit/apk-up', (req, res) => {

    const { session, newL, up } = req.query;

    // Verificar se o session está correto

    if (session !== 'abten-code-obfuscator-generatorkeyTektekscripts') {

      return res.status(403).json({ error: 'Session inválido' });

    }

    // Ler dados do arquivo .update.json

    let currentData = readUpdateFile();

    // Se não existir o arquivo, cria um padrão

    if (!currentData) {

      currentData = {

        result: 'false',

        linkUp: ''

      };

    }

    // Atualizar status

    if (up === 'true' || up === 'false') {

      currentData.result = up;

    }

    // Atualizar link, se fornecido

    if (newL && newL !== '') {

      currentData.linkUp = newL;

    }

    // Salvar as mudanças no arquivo .update.json

    saveUpdateFile(currentData);

    return res.json({ status: 'Atualizado', result: currentData.result, linkUp: currentData.linkUp });

  });

  // Rota para retornar o status atual

  app.get('/edit/apk-stats', (req, res) => {

    const currentData = readUpdateFile();

    // Se não existir o arquivo, retorna erro

    if (!currentData) {

      return res.status(404).json({ error: 'Arquivo de status não encontrado' });

    }

    return res.json({

      result: currentData.result,

      linkUp: currentData.linkUp

    });

  });

};
