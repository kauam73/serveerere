const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');
const AbortController = require('abort-controller');

const CONFIG = {
  API: {
    KEY: 'tekscripts',
    ERROR_KEYWORDS: [
      "erro", "error", "404", "unsupported", "invalid", "failed", "null",
      "afk", "down", "off", "stop", "discord", "not", "none", "fall", "er", "inva"
    ],
    SUCCESS_KEYWORDS: [
      "sucesso", "ok", "done", "completed", "success", "valid", "authorized",
      "passed", "loadstring", "local", "https", "http", "game:HttpGet",
      "No stages or already authenticated",
      "You have been authenticated. Please proceed back to the application.",
      "key", "FREE", "link", "type"
    ],
    RETRY_LIMIT: 1,
    RETRY_DELAY: 2000
  },
  SERVER: {
    TIMEOUT: 60000
  },
  FILES: {
    APIS_URL: 'https://raw.githubusercontent.com/kauam73/Servidor_api/refs/heads/main/apis.json',
    URLS_FILE: path.join(__dirname, 'urls.json'),
    STAT_FILE: path.join(__dirname, '.status.json'),
    APIS_DAT: path.join(__dirname, 'apisDat.json') // Novo arquivo para APIs adicionais
  },
  CACHE_DURATION: 10 * 60 * 1000 // 10 minutos
};

// Variável global para controlar se o bypass está ativo ou não.
let bypassEnabled = true;

// Serviço para registrar e classificar o desempenho das APIs
const ApiPerformanceTracker = {
  // Armazena as estatísticas: total de chamadas, chamadas com sucesso e tempo total (ms)
  stats: {},

  record(apiUrl, responseTime, success) {
    if (!this.stats[apiUrl]) {
      this.stats[apiUrl] = { totalCalls: 0, successCalls: 0, totalTime: 0 };
    }
    this.stats[apiUrl].totalCalls++;
    if (success) {
      this.stats[apiUrl].successCalls++;
      this.stats[apiUrl].totalTime += responseTime;
    }
  },

  // Calcula uma "pontuação" baseada na média de tempo e na taxa de sucesso
  getScore(apiUrl) {
    const stat = this.stats[apiUrl];
    if (!stat || stat.totalCalls === 0) return Infinity; // sem dados: pior prioridade
    const avgTime = stat.totalTime / stat.successCalls || CONFIG.SERVER.TIMEOUT;
    const successRate = stat.successCalls / stat.totalCalls;
    // Quanto menor o tempo e maior a taxa de sucesso, melhor a pontuação
    return avgTime / (successRate || 0.1);
  },

  // Ordena a lista de APIs com base na pontuação (menor é melhor)
  sortApis(apis) {
    return apis.sort((a, b) => {
      const scoreA = this.getScore(a.url);
      const scoreB = this.getScore(b.url);
      return scoreA - scoreB;
    });
  }
};

const FileService = {
  // Carrega as APIs do repositório Git
  async loadApis() {
    try {
      const response = await axios.get(CONFIG.FILES.APIS_URL);
      return response.data.apis || [];
    } catch (error) {
      console.error('Erro ao carregar APIs:', error.message);
      return [];
    }
  },
  // Lê o arquivo de URLs salvas
  async loadSavedUrls() {
    try {
      const data = await fs.readFile(CONFIG.FILES.URLS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // Se não existir o arquivo, retorna objeto vazio
      return {};
    }
  },
  // Salva ou atualiza a URL com sua resposta e timestamp
  async saveUrl(url, responseData) {
    try {
      const savedUrls = await this.loadSavedUrls();
      savedUrls[url] = { response: responseData, timestamp: Date.now() };
      await fs.writeFile(CONFIG.FILES.URLS_FILE, JSON.stringify(savedUrls, null, 2), 'utf-8');
    } catch (error) {
      console.error('Erro ao salvar URL:', error.message);
    }
  },
  // Lê o arquivo urls.json
  async getUrlsJson() {
    try {
      const data = await fs.readFile(CONFIG.FILES.URLS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return {};
    }
  },
  // Limpa o arquivo urls.json
  async clearSavedUrls() {
    try {
      await fs.writeFile(CONFIG.FILES.URLS_FILE, JSON.stringify({}, null, 2), 'utf-8');
    } catch (error) {
      console.error('Erro ao limpar urls.json:', error.message);
    }
  },
  // ================= Métodos para APIs adicionais (apisDat.json) =================
  // Carrega as APIs adicionais do arquivo apisDat.json
  async loadAdditionalApis() {
    try {
      const data = await fs.readFile(CONFIG.FILES.APIS_DAT, 'utf-8');
      return JSON.parse(data).apis || [];
    } catch (error) {
      // Se o arquivo não existir, retorna um array vazio
      return [];
    }
  },
  // Salva o array de APIs adicionais no arquivo apisDat.json
  async saveAdditionalApis(apis) {
    try {
      await fs.writeFile(CONFIG.FILES.APIS_DAT, JSON.stringify({ apis }, null, 2), 'utf-8');
    } catch (error) {
      console.error('Erro ao salvar apisDat.json:', error.message);
    }
  },
  // Adiciona uma nova API ao arquivo apisDat.json (evita duplicatas)
  async addAdditionalApi(newApi) {
    let additionalApis = await this.loadAdditionalApis();
    if (additionalApis.find(api => api.url === newApi.url)) {
      return false;
    }
    additionalApis.push(newApi);
    await this.saveAdditionalApis(additionalApis);
    return true;
  }
};

const StatusService = {
  // Retorna os dados de status, ou cria um objeto padrão se não existir
  async getStatus() {
    try {
      const data = await fs.readFile(CONFIG.FILES.STAT_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return { totalRequests: 0, successfulRequests: 0, failedRequests: 0 };
    }
  },
  // Salva os dados de status
  async saveStatus(status) {
    try {
      await fs.writeFile(CONFIG.FILES.STAT_FILE, JSON.stringify(status, null, 2), 'utf-8');
    } catch (error) {
      console.error('Erro ao salvar status:', error.message);
    }
  },
  async incrementTotal() {
    const status = await this.getStatus();
    status.totalRequests = (status.totalRequests || 0) + 1;
    await this.saveStatus(status);
  },
  async incrementSuccess() {
    const status = await this.getStatus();
    status.successfulRequests = (status.successfulRequests || 0) + 1;
    await this.saveStatus(status);
  },
  async incrementFailure() {
    const status = await this.getStatus();
    status.failedRequests = (status.failedRequests || 0) + 1;
    await this.saveStatus(status);
  }
};

const ValidationService = {
  _toString(response) {
    return typeof response === 'string' ? response : JSON.stringify(response);
  },
  isErrorResponse(responseText) {
    if (!responseText) return true;
    const text = this._toString(responseText);
    return CONFIG.API.ERROR_KEYWORDS.some(keyword => new RegExp(`\\b${keyword}\\b`, 'i').test(text));
  },
  isSuccessResponse(responseText) {
    if (!responseText) return false;
    const text = this._toString(responseText);
    return CONFIG.API.SUCCESS_KEYWORDS.some(keyword => new RegExp(`\\b${keyword}\\b`, 'i').test(text));
  },
  isValidResponse(responseText) {
    if (!responseText) return false;
    const text = this._toString(responseText);
    if (/^[a-f0-9]{32}$/i.test(text)) return true;
    return !this.isErrorResponse(text) && this.isSuccessResponse(text);
  }
};

// Retorna a primeira promessa com resposta válida
function firstValid(promises) {
  return new Promise((resolve, reject) => {
    let settledCount = 0;
    let resolved = false;
    promises.forEach(p => {
      p.then(result => {
        settledCount++;
        if (result && ValidationService.isValidResponse(result) && !resolved) {
          resolved = true;
          resolve(result);
        } else if (settledCount === promises.length && !resolved) {
          reject(new Error('Nenhuma API conseguiu processar a URL'));
        }
      }).catch(() => {
        settledCount++;
        if (settledCount === promises.length && !resolved) {
          reject(new Error('Nenhuma API conseguiu processar a URL'));
        }
      });
    });
  });
}

const BypassService = {
  // Processa a URL, usando cache se disponível e priorizando APIs mais performáticas
  async processUrl(url) {
    const startTime = performance.now();
    let apis = await FileService.loadApis();
    if (!apis.length) throw new Error('Nenhuma API configurada');

    // Ordena as APIs com base no desempenho
    apis = ApiPerformanceTracker.sortApis(apis);

    // Verifica cache
    const savedUrls = await FileService.loadSavedUrls();
    const savedUrl = savedUrls[url];
    if (savedUrl && (Date.now() - savedUrl.timestamp) < CONFIG.CACHE_DURATION) {
      const endTime = performance.now();
      return {
        result: savedUrl.response,
        message: "URL já foi processada recentemente.",
        time: `${Math.round(endTime - startTime)}ms`,
        creditos: { Equipe: "Tekscripts", Server: "https://discord.gg/dHFPxSTBYT" }
      };
    }

    // Cria um AbortController para cancelar requisições pendentes
    const abortController = new AbortController();
    // Requisições concorrentes para as APIs (em ordem de prioridade)
    const requests = apis.map(api => this._tryApiWithRetry(url, api, 1, abortController));
    let result;
    try {
      result = await firstValid(requests);
      // Aborta as outras requisições
      abortController.abort();
    } catch (err) {
      throw new Error(err.message);
    }
    const endTime = performance.now();
    // Salva resposta válida no cache
    await FileService.saveUrl(url, result);
    return {
      result,
      time: `${Math.round(endTime - startTime)}ms`,
      creditos: { Equipe: "Tekscripts", Server: "https://discord.gg/dHFPxSTBYT" }
    };
  },
  // Tenta a API com retry e registra o desempenho
  async _tryApiWithRetry(url, apiConfig, attempt = 1, abortController) {
    if (abortController.signal.aborted) return null;
    const startApiTime = performance.now();
    try {
      const apiUrl = apiConfig.url.replace('{url}', encodeURIComponent(url));
      const response = await axios.get(apiUrl, {
        timeout: CONFIG.SERVER.TIMEOUT,
        signal: abortController.signal
      });
      const result = apiConfig.parse_json ? response.data[apiConfig.response_key] : response.data;
      const endApiTime = performance.now();
      const responseTime = endApiTime - startApiTime;
      if (ValidationService.isValidResponse(result)) {
        ApiPerformanceTracker.record(apiConfig.url, responseTime, true);
        return result;
      }
      throw new Error('Resposta inválida');
    } catch (error) {
      const endApiTime = performance.now();
      const responseTime = endApiTime - startApiTime;
      ApiPerformanceTracker.record(apiConfig.url, responseTime, false);
      if (attempt < CONFIG.API.RETRY_LIMIT && !abortController.signal.aborted) {
        await new Promise(res => setTimeout(res, CONFIG.API.RETRY_DELAY));
        return this._tryApiWithRetry(url, apiConfig, attempt + 1, abortController);
      }
      return null;
    }
  }
};

module.exports.setup = function(app) {
  // Middleware para validar chave e URL para a rota /bypass
  function ApiKeyMiddleware(req, res, next) {
    if (req.query.key !== CONFIG.API.KEY) {
      return res.status(401).json({ error: 'Chave de API inválida' });
    }
    if (!req.query.url) {
      return res.status(400).json({ error: 'URL não fornecida' });
    }
    if (!req.query.url.startsWith('https://')) {
      return res.status(400).json({ error: 'URL inválida: deve iniciar com "https://"' });
    }
    next();
  }

  // Middleware para rotas administrativas
  function AdminAuthMiddleware(req, res, next) {
    if (req.query.admin_key !== 'admintekscripts') {
      return res.status(401).json({ error: 'Chave de administração inválida' });
    }
    next();
  }

  // Rota /bypass
  app.get('/bypass', ApiKeyMiddleware, async (req, res) => {
    if (!bypassEnabled) {
      return res.status(503).json({ error: 'Bypass está desativado no momento.' });
    }
    try {
      const result = await BypassService.processUrl(req.query.url);
      // Atualiza status: requisição bem-sucedida
      await StatusService.incrementSuccess();
      res.json(result);
    } catch (error) {
      // Atualiza status: requisição falhou
      await StatusService.incrementFailure();
      res.status(502).json({ error: error.message });
    } finally {
      // Sempre incrementa o total de requisições
      await StatusService.incrementTotal();
    }
  });

  // Rota para ler urls.json (público ou pode ser restringida)
  app.get('/get-urls', async (req, res) => {
    try {
      const urlsJson = await FileService.getUrlsJson();
      res.json(urlsJson);
    } catch (error) {
      res.status(500).json({ error: 'Erro ao ler o arquivo urls.json' });
    }
  });

  // Rota para exibir o status das requisições (arquivo oculto .status.json)
  app.get('/statusBypass', async (req, res) => {
    try {
      const status = await StatusService.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Erro ao ler o status das requisições' });
    }
  });

  // ===================== Rotas de Administração =====================

  // Rota para alternar o estado do bypass (ativar/desativar)
  // Exemplo de uso: POST /admin/toggle-bypass?admin_key=admintekscripts&state=on|off
  app.post('/admin/toggle-bypass', AdminAuthMiddleware, (req, res) => {
    const state = req.query.state;
    if (state === 'on') {
      bypassEnabled = true;
    } else if (state === 'off') {
      bypassEnabled = false;
    } else {
      return res.status(400).json({ error: 'Parâmetro state inválido. Utilize "on" ou "off".' });
    }
    res.json({ message: `Bypass ${bypassEnabled ? 'ativado' : 'desativado'}.`, bypassEnabled });
  });

  // Rota para obter o status atual do sistema e do bypass
  // Exemplo de uso: GET /admin/status?admin_key=admintekscripts
  app.get('/admin/status', AdminAuthMiddleware, async (req, res) => {
    try {
      const status = await StatusService.getStatus();
      res.json({ bypassEnabled, status });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao obter o status do bypass.' });
    }
  });

  // Rota para visualizar as estatísticas de desempenho das APIs
  // Exemplo de uso: GET /admin/api-performance?admin_key=admintekscripts
  app.get('/admin/api-performance', AdminAuthMiddleware, (req, res) => {
    res.json(ApiPerformanceTracker.stats);
  });

  // ===================== Nova Rota para Adicionar API =====================
  // Rota para adicionar uma nova API extra (apisDat.json)
  // Exemplo de uso: POST /admin/add-api?admin_key=admintekscripts
  // Espera um JSON no corpo da requisição com os dados da API (pelo menos { url: 'https://...', parse_json: true/false, response_key: '...' })
  app.post('/admin/add-api', AdminAuthMiddleware, async (req, res) => {
    const newApi = req.body;
    if (!newApi || !newApi.url) {
      return res.status(400).json({ error: 'Dados da API inválidos. É necessário informar pelo menos o campo "url".' });
    }

    try {
      // Carrega APIs existentes do Git
      const gitApis = await FileService.loadApis();
      if (gitApis.find(api => api.url === newApi.url)) {
        return res.json({ message: 'API já existe no sistema (Git).' });
      }

      // Verifica se já existe em apisDat.json para evitar duplicatas
      const additionalApis = await FileService.loadAdditionalApis();
      if (additionalApis.find(api => api.url === newApi.url)) {
        return res.json({ message: 'API já existe no sistema (apisDat).' });
      }

      // Adiciona a nova API ao arquivo apisDat.json
      const added = await FileService.addAdditionalApi(newApi);
      if (!added) {
        return res.status(500).json({ error: 'Falha ao adicionar a API.' });
      }
      return res.json({ message: 'API adicionada com sucesso!', api: newApi });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao processar a requisição: ' + error.message });
    }
  });
};

// Limpa o arquivo urls.json a cada 10 minutos
setInterval(() => {
  FileService.clearSavedUrls();
}, CONFIG.CACHE_DURATION);
