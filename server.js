const express = require('express');
const fs = require('fs').promises; // Uso de promises diretamente
const path = require('path');
const cors = require('cors');

const app = express();

app.use(express.json());
app.use(cors());

async function loadModules(app) {
  const modulesDir = path.resolve(__dirname, 'modules');

  try {
    console.time('Carregamento dos módulos');
    const files = await fs.readdir(modulesDir);

    // Filtrar apenas arquivos .js antes de carregar
    const moduleFiles = files.filter(file => file.endsWith('.js'));

    // Carregar todos os módulos de forma assíncrona
    await Promise.all(moduleFiles.map(async (file) => {
      try {
        const modPath = path.join(modulesDir, file);
        const mod = require(modPath);

        if (typeof mod.setup === 'function') {
          mod.setup(app);
          console.log(`Módulo ${file} carregado.`);
        }
      } catch (error) {
        console.error(`Erro ao carregar o módulo ${file}:`, error);
      }
    }));

    console.timeEnd('Carregamento dos módulos');
  } catch (error) {
    console.error('Erro ao ler diretório de módulos:', error);
  }
}

app.get('/status', (req, res) => {
  res.json({ result: 'server on' });
});

loadModules(app).then(() => {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
});
