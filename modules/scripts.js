const fs = require('fs').promises;
const path = require('path');
const winston = require('winston'); // Logger para rastreamento de erros
// Logger simples com winston
const logger = winston.createLogger({
  transports: [new winston.transports.Console()]
});

// Configurações usando variáveis de ambiente
const CONFIG = {
  FILES: {
    SCRIPTS: process.env.SCRIPTS_PATH || path.join(__dirname, '..', 'scripts.json')
  },
  LIMITS: {
    SCRIPTS_PER_DAY: 30,
    MIN_NAME_LENGTH: 3,
    MIN_SCRIPT_LENGTH: 10
  }
};

// Serviço para manipulação de arquivos com tratamento de JSON
const FileService = {
  async loadScripts() {
    try {
      const data = await fs.readFile(CONFIG.FILES.SCRIPTS, 'utf8');
      let scripts = [];
      try {
        scripts = JSON.parse(data);
        // Garante que cada script tenha os campos esperados
        scripts = scripts.filter(s => s.id && s.nome && s.script && s.status && s.data);
      } catch (error) {
        logger.error('Erro ao parsear JSON:', error); // Log de erro no JSON
      }
      return scripts;
    } catch (error) {
      logger.error('Erro ao ler arquivo:', error);
      return [];
    }
  },
  async saveScripts(scripts) {
    try {
      await fs.writeFile(CONFIG.FILES.SCRIPTS, JSON.stringify(scripts, null, 2));
    } catch (error) {
      logger.error('Erro ao salvar arquivo:', error);
      throw error;
    }
  }
};

// Validações de scripts e segurança simples
const ValidationService = {
  // Verifica duplicidade exata do script
  isDuplicate(script, scripts) {
    return scripts.some(s => s.script === script);
  },
  // Conta scripts do dia para o usuário usando ISO date; cuidado com fusos horários
  countDailyScripts(user, scripts) {
    const today = new Date().toISOString().slice(0, 10);
    return scripts.filter(s => s.nome === user && s.data.startsWith(today)).length;
  },
  // Valida nome e script; evita caracteres potencialmente maliciosos
  validateScript(nome, script) {
    if (!nome || nome.length < CONFIG.LIMITS.MIN_NAME_LENGTH) {
      return 'Nome inválido (mínimo 3 caracteres).';
    }
    if (!script || script.length < CONFIG.LIMITS.MIN_SCRIPT_LENGTH) {
      return 'Script inválido (mínimo 10 caracteres).';
    }
    // Validação simples para evitar injeção de código (permite letras, números, espaços e pontuação básica)
    const validPattern = /^[\w\s.,;:!?()'"-]+$/;
    if (!validPattern.test(nome)) {
      return 'Nome contém caracteres inválidos.';
    }
    if (!validPattern.test(script)) {
      return 'Script contém caracteres inválidos.';
    }
    return null;
  }
};

module.exports.setup = function(app) {
  // Rota para enviar script
  app.post('/enviar_script', async (req, res) => {
    try {
      const { nome, script } = req.body;
      const error = ValidationService.validateScript(nome, script);
      if (error) return res.status(400).json({ mensagem: error });

      const scripts = await FileService.loadScripts();

      if (ValidationService.isDuplicate(script, scripts)) {
        return res.status(400).json({ mensagem: 'Script duplicado!' });
      }
      if (ValidationService.countDailyScripts(nome, scripts) >= CONFIG.LIMITS.SCRIPTS_PER_DAY) {
        return res.status(400).json({ mensagem: 'Limite diário excedido!' });
      }
      
      // Cálculo de ID: operação síncrona aceitável para poucos registros.
      const newId = scripts.length ? Math.max(...scripts.map(s => s.id)) + 1 : 1;
      const newScript = {
        id: newId,
        nome,
        script,
        status: 'Em análise',
        data: new Date().toISOString()
      };
      await FileService.saveScripts([...scripts, newScript]);
      res.status(201).json({ mensagem: 'Script enviado com sucesso!' });
    } catch (error) {
      logger.error('Erro no POST /enviar_script:', error);
      res.status(500).json({ mensagem: 'Erro interno no servidor' });
    }
  });

  // Rota para listar scripts
  app.get('/listar_scripts', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const scripts = await FileService.loadScripts();
      const startIndex = (page - 1) * limit;
      res.json({
        total: scripts.length,
        scripts: scripts.slice(startIndex, startIndex + limit)
      });
    } catch (error) {
      logger.error('Erro no GET /listar_scripts:', error);
      res.status(500).json({ mensagem: 'Erro ao carregar scripts' });
    }
  });

  // Rota para atualizar status
  app.patch('/alterar_status/:id', async (req, res) => {
    try {
      const scriptId = parseInt(req.params.id);
      if (isNaN(scriptId)) {
        return res.status(400).json({ mensagem: 'ID inválido' });
      }
      // Validação do status; defina os status permitidos
      const allowedStatus = ['Em análise', 'Aprovado', 'Rejeitado'];
      const novoStatus = req.body.status;
      if (!novoStatus || !allowedStatus.includes(novoStatus)) {
        return res.status(400).json({ mensagem: 'Status inválido ou não fornecido' });
      }
      const scripts = await FileService.loadScripts();
      const script = scripts.find(s => s.id === scriptId);
      if (!script) return res.status(404).json({ mensagem: 'Script não encontrado' });
      
      script.status = novoStatus;
      await FileService.saveScripts(scripts);
      res.json({ mensagem: 'Status atualizado com sucesso' });
    } catch (error) {
      logger.error('Erro no PATCH /alterar_status:', error);
      res.status(500).json({ mensagem: 'Erro ao atualizar status' });
    }
  });

  // Rota para remover script
  app.delete('/remover_script/:id', async (req, res) => {
    try {
      const scriptId = parseInt(req.params.id);
      if (isNaN(scriptId)) {
        return res.status(400).json({ mensagem: 'ID inválido' });
      }
      let scripts = await FileService.loadScripts();
      const initialLength = scripts.length;
      scripts = scripts.filter(s => s.id !== scriptId);
      if (scripts.length === initialLength) {
        return res.status(404).json({ mensagem: 'Script não encontrado' });
      }
      await FileService.saveScripts(scripts);
      res.json({ mensagem: 'Script removido com sucesso' });
    } catch (error) {
      logger.error('Erro no DELETE /remover_script:', error);
      res.status(500).json({ mensagem: 'Erro ao remover script' });
    }
  });
};
