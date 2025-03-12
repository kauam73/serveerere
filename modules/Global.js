/**
 * Módulo de Gerenciamento de Usuários e Mensagens
 * Fornece endpoints para gerenciamento de usuários e mensagens,
 * com dados armazenados em arquivos JSON.
 */

const fs = require("fs");

// CONFIGURAÇÕES GLOBAIS
const CONFIG = {
  FILES: {
    USERS: "global-users-apk.json",
    MESSAGES: "global-msgs-apk.json",
    DELETED_MESSAGES: "deleted-msgs-apk.json",
    BANNED_USERS: "banned-users-apk.json"
    // Removido: PRIVATE_MESSAGES
  },
  VALIDATION: {
    USERNAME: {
      LENGTH: 3,
      REGEX: /^[\w]+$/,
      RESERVED_NAMES: ["tekscripts"],
      AUTO_REPLACE: "fake"
    },
    MESSAGES: {
      LIMIT: 1500,
      RESET_MESSAGE: {
        user: "system",
        id: "server",
        msg: "Reset de mensagens",
        replies: []
      }
    },
    SECURITY: {
      URL_REGEX: /https?:\/\/.+/,
      // ID_REGEX permanece definido, mas não será utilizado para validação dos comandos
      ID_REGEX: /^[\d]+$/
    }
  }
};

// Cache em memória para reduzir acessos aos arquivos
const cache = {
  users: [],
  messages: [],
  deletedMessages: [],
  bannedUsers: []
};

// Fila para notificações – armazena as últimas 5 mensagens de usuário
let notifyMessages = [];

// Objeto para armazenar status de digitação dos usuários
// Cada entrada: { id, user, typing, timestamp }
let typingStatus = {};
const TYPING_TIMEOUT = 5000; // tempo em ms para considerar como inativo

// Objeto para armazenar status online dos usuários
// Cada entrada: { id, user, online, timestamp }
let onlineStatus = {};
const ONLINE_TIMEOUT = 30000; // tempo em ms para considerar como offline (exemplo: 30 segundos)

// Carrega os dados dos arquivos para o cache (síncrono na inicialização)
function loadData() {
  cache.users = readJSON(CONFIG.FILES.USERS);
  cache.messages = readJSON(CONFIG.FILES.MESSAGES);
  cache.deletedMessages = readJSON(CONFIG.FILES.DELETED_MESSAGES);
  cache.bannedUsers = readJSON(CONFIG.FILES.BANNED_USERS);
}

// Grava os dados do cache nos arquivos a cada 5 segundos (escrita assíncrona)
setInterval(() => {
  writeJSON(CONFIG.FILES.USERS, cache.users);
  writeJSON(CONFIG.FILES.MESSAGES, cache.messages);
  writeJSON(CONFIG.FILES.DELETED_MESSAGES, cache.deletedMessages);
  writeJSON(CONFIG.FILES.BANNED_USERS, cache.bannedUsers);
}, 5000);

// Função auxiliar para leitura de JSON (síncrona na inicialização)
function readJSON(filePath) {
  try {
    return fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath))
      : [];
  } catch (error) {
    console.error(`Erro ao ler ${filePath}:`, error);
    return [];
  }
}

// Função auxiliar para escrita de JSON de forma assíncrona
function writeJSON(filePath, data) {
  fs.writeFile(filePath, JSON.stringify(data, null, 2), err => {
    if (err) {
      console.error(`Erro ao escrever em ${filePath}:`, err);
    }
  });
}

// Serviços de Dados usando o cache
const UserService = {
  getAll: () => cache.users,
  findById: (userId) => cache.users.find(u => u.id === userId),
  save: () => writeJSON(CONFIG.FILES.USERS, cache.users)
};

const MessageService = {
  getAll: () => cache.messages,
  getDeleted: () => cache.deletedMessages,
  save: () => writeJSON(CONFIG.FILES.MESSAGES, cache.messages),
  add: (msg) => {
    if (cache.messages.length >= CONFIG.VALIDATION.MESSAGES.LIMIT) {
      cache.messages = [CONFIG.VALIDATION.MESSAGES.RESET_MESSAGE];
    } else {
      cache.messages.push(msg);
    }
  }
};

const BanService = {
  getAll: () => cache.bannedUsers,
  isBanned: (id) => cache.bannedUsers.includes(id),
  addBan: (id) => {
    if (!cache.bannedUsers.includes(id)) {
      cache.bannedUsers.push(id);
    }
  },
  removeBan: (id) => {
    cache.bannedUsers = cache.bannedUsers.filter(b => b !== id);
  }
};

// Validações
const Validators = {
  username: (username) => {
    const { LENGTH, REGEX, RESERVED_NAMES } = CONFIG.VALIDATION.USERNAME;
    return username.length > LENGTH &&
           REGEX.test(username) &&
           !RESERVED_NAMES.some(reserved => username.toLowerCase().includes(reserved));
  },
  messageContent: (message) => {
    return !CONFIG.VALIDATION.SECURITY.URL_REGEX.test(message);
  }
};

// Auto-delete para mensagens
let autoDeleteUsers = {};

// Função para agendar a remoção automática de uma mensagem
function scheduleAutoDelete(msgId, delay, userId) {
  setTimeout(() => {
    const messages = MessageService.getAll();
    const index = messages.findIndex(m => m.msgId === msgId && m.id === userId);
    if (index !== -1) {
      messages.splice(index, 1);
      MessageService.save();
      console.log(`Mensagem ${msgId} de ${userId} removida automaticamente.`);
    }
  }, delay);
}

// Cria mensagem sem criptografia
function createMessage(user, id, msg, extra = {}) {
  return {
    msgId: Date.now() + "_" + Math.random().toString(36).substring(2),
    user,
    id,
    msg,
    replies: [],
    timestamp: new Date().toISOString(),
    ...extra
  };
}

// Controlador de Usuários
const UserController = {
  createUser: (req, res) => {
    const { user_name: rawName, gmail } = req.query;
    if (!rawName || !gmail) return res.status(400).send("Faltam parâmetros");
    let username = rawName;
    if (!Validators.username(username)) return res.status(400).send("Nome inválido");
    if (CONFIG.VALIDATION.USERNAME.RESERVED_NAMES.some(reserved => username.toLowerCase().includes(reserved))) {
      username = CONFIG.VALIDATION.USERNAME.AUTO_REPLACE;
    }
    const users = UserService.getAll();
    const existingUserIndex = users.findIndex(u => u.id === gmail);
    if (existingUserIndex !== -1) {
      // Atualiza o nome do usuário mantendo o mesmo id e, portanto, os status (ban, castigo, etc.)
      users[existingUserIndex].user = username;
      UserService.save();
      return res.send("Usuário já existia, nome atualizado");
    }
    users.push({ user: username, id: gmail });
    UserService.save();
    res.send("Usuário criado");
  },
  getProfile: (req, res) => {
    const userId = req.params.id;
    const user = UserService.findById(userId);
    if (!user) return res.status(404).send("Usuário não encontrado");
    const messages = MessageService.getAll().filter(msg => msg.id === userId);
    const stats = {
      totalMessages: messages.length,
      totalReplies: messages.reduce((acc, msg) => acc + msg.replies.length, 0)
    };
    res.json({ ...user, ...stats });
  }
};

// Controlador de Mensagens
const MessageController = {
  postMessage: (req, res) => {
    const { Nome, id, msg } = req.query;
    if (!Nome || !id || !msg) return res.status(400).send("Faltam parâmetros");

    // Verifica se o usuário está cadastrado
    const currentUser = UserService.findById(id);
    if (!currentUser) return res.status(400).send("Usuário não existe");

    // Bloqueia envio de mensagens de usuários banidos
    if (BanService.isBanned(id)) return res.status(403).send("Usuário banido");

    // Anti-link
    if (CONFIG.VALIDATION.SECURITY.URL_REGEX.test(msg)) {
      return res.status(403).send("Anti-link ativo: mensagem bloqueada");
    }
    // Anti-spam
    if (req.app.locals.lastMessageTimestamp === undefined) req.app.locals.lastMessageTimestamp = {};
    const now = Date.now();
    if (req.app.locals.lastMessageTimestamp[id] && (now - req.app.locals.lastMessageTimestamp[id] < 3000)) {
      return res.status(429).send("Anti-spam ativo: aguarde para enviar outra mensagem");
    }
    req.app.locals.lastMessageTimestamp[id] = now;

    // Processamento de comandos sensíveis enviados diretamente no chat global

    // !Tekban: banir usuário
    if (msg.startsWith("!Tekban ")) {
      const parts = msg.trim().split(/\s+/);
      if (parts.length !== 2)
        return res.status(400).send("Formato inválido para !Tekban. Use: !Tekban <ID>");
      const banId = parts[1];
      // Removida a validação que exige apenas números
      BanService.addBan(banId);
      MessageService.add(createMessage("BOT", "server", "******"));
      return res.send("Usuário banido");
    }
    // !Tekunban: desbanir usuário
    else if (msg.startsWith("!Tekunban ")) {
      const parts = msg.trim().split(/\s+/);
      if (parts.length !== 2)
        return res.status(400).send("Formato inválido para !Tekunban. Use: !Tekunban <ID>");
      const unbanId = parts[1].trim();
      // Removida a validação que exige apenas números
      if (!BanService.isBanned(unbanId))
        return res.status(404).send("Usuário não está banido.");
      BanService.removeBan(unbanId);
      MessageService.add(createMessage("BOT", "server", `Usuário ${unbanId} foi desbanido.`));
      return res.send(`Usuário ${unbanId} desbanido com sucesso.`);
    }
    // !Tekcast: ativa auto-delete para um usuário
    else if (msg.startsWith("!Tekcast ")) {
      const parts = msg.trim().split(/\s+/);
      if (parts.length !== 3)
        return res.status(400).send("Formato inválido para !Tekcast. Use: !Tekcast <ID> <tempo_em_segundos>");
      const castId = parts[1];
      // Removida a validação que exige apenas números
      const castTime = parseInt(parts[2]);
      if (isNaN(castTime))
        return res.status(400).send("Tempo inválido para !Tekcast.");
      autoDeleteUsers[castId] = castTime * 1000;
      MessageService.add(createMessage("BOT", "server", "******"));
      return res.send("Auto-delete ativado para usuário " + castId);
    }
    // Processamento de outros comandos padrão
    else if (msg.startsWith("!")) {
      switch (msg) {
        case "!config":
          MessageService.add(createMessage("BOT", "server", "por favor forneça a senha", { configBy: id }));
          return res.send("Mensagem de configuração postada");
        case "!ping":
          MessageService.add(createMessage("BOT", "server", "pong"));
          return res.send("Resposta pong postada");
        case "!help":
          MessageService.add(createMessage("BOT", "server", "Comandos: !ping, !help, !status, !time, !about, !admire, !list-users, !antilink-on, !antilink-off, !antispam-on, !antispam-off, !anticaracteres-on, !anticaracteres-off"));
          return res.send("Mensagem de ajuda postada");
        case "!status":
          MessageService.add(createMessage("BOT", "server", "Servidor em funcionamento."));
          return res.send("Status postado");
        case "!time":
          MessageService.add(createMessage("BOT", "server", `Hora atual: ${new Date().toLocaleString()}`));
          return res.send("Hora postada");
        case "!about":
          MessageService.add(createMessage("BOT", "server", "Este é o servidor de mensagens da TekScripts."));
          return res.send("Informação sobre o servidor postada");
        case "!admire":
          MessageService.add(createMessage("BOT", "server", "Você é incrível!"));
          return res.send("Mensagem de admiração postada");
        case "!list-users": {
          const users = UserService.getAll();
          const userList = users.map(u => `${u.user} (${u.id})`).join(", ");
          MessageService.add(createMessage("BOT", "server", `Usuários: ${userList}`));
          return res.send("Lista de usuários postada");
        }
        case "!antilink-on":
          MessageService.add(createMessage("BOT", "server", "Anti-link ativado."));
          return res.send("Anti-link ativado");
        case "!antilink-off":
          MessageService.add(createMessage("BOT", "server", "Anti-link desativado."));
          return res.send("Anti-link desativado");
        case "!antispam-on":
          MessageService.add(createMessage("BOT", "server", "Anti-spam ativado."));
          return res.send("Anti-spam ativado");
        case "!antispam-off":
          MessageService.add(createMessage("BOT", "server", "Anti-spam desativado."));
          return res.send("Anti-spam desativado");
        case "!anticaracteres-on":
        case "!anticaracteres-off":
          MessageService.add(createMessage("BOT", "server", "Anti-caracteres não está mais em operação."));
          return res.send("Anti-caracteres removido");
        default:
          break;
      }
    }

    // Se não for um comando, cria mensagem normal
    const newMessage = createMessage(Nome, id, msg);
    MessageService.add(newMessage);
    if (Nome !== "BOT") {
      notifyMessages.push({ user: Nome, Msg: msg });
      if (notifyMessages.length > 5) {
        notifyMessages.shift();
      }
    }
    if (autoDeleteUsers[id]) {
      scheduleAutoDelete(newMessage.msgId, autoDeleteUsers[id], id);
    }
    res.send("Mensagem postada");
  },
  addReply: (req, res) => {
    const { id, msgIndex, replyMsg } = req.query;
    const parsedIndex = parseInt(msgIndex);
    if (!id || isNaN(parsedIndex) || !replyMsg)
      return res.status(400).send("Parâmetros inválidos");
      
    // Bloqueia resposta de usuários banidos
    if (BanService.isBanned(id)) return res.status(403).send("Usuário banido");

    const user = UserService.findById(id);
    if (!user) return res.status(400).send("Usuário não encontrado");
    const messages = MessageService.getAll();
    if (parsedIndex < 0 || parsedIndex >= messages.length)
      return res.status(404).send("Recurso não encontrado");
    const parentMessage = messages[parsedIndex];
      
    // Processamento para comando especial de deleção
    if (replyMsg === "!TekDelete") {
      parentMessage.msg = "Um ADM apagou essa mensagem";
      parentMessage.replies = [];
      MessageService.save();
      return res.send("Mensagem deletada via !TekDelete");
    }
      
    // Comandos sensíveis em replies
    if (replyMsg.startsWith("!Tekban ")) {
      const parts = replyMsg.trim().split(/\s+/);
      if (parts.length !== 2)
        return res.status(400).send("Formato inválido para !Tekban. Use: !Tekban <ID>");
      const banId = parts[1];
      // Removida a validação que exige apenas números
      BanService.addBan(banId);
      parentMessage.replies.push({
        user: user.user,
        id: user.id,
        replyMsg: "******",
        timestamp: new Date().toISOString()
      });
      MessageService.save();
      return res.send("Usuário banido");
    } else if (replyMsg.startsWith("!Tekunban ")) {
      const parts = replyMsg.trim().split(/\s+/);
      if (parts.length !== 2)
        return res.status(400).send("Formato inválido para !Tekunban. Use: !Tekunban <ID>");
      const unbanId = parts[1].trim();
      // Removida a validação que exige apenas números
      if (!BanService.isBanned(unbanId))
        return res.status(404).send("Usuário não está banido.");
      BanService.removeBan(unbanId);
      parentMessage.replies.push({
        user: user.user,
        id: user.id,
        replyMsg: "******",
        timestamp: new Date().toISOString()
      });
      MessageService.save();
      return res.send("Usuário desbanido");
    } else if (replyMsg.startsWith("!Tekcast ")) {
      const parts = replyMsg.trim().split(/\s+/);
      if (parts.length !== 3)
        return res.status(400).send("Formato inválido para !Tekcast. Use: !Tekcast <ID> <tempo_em_segundos>");
      const castId = parts[1];
      // Removida a validação que exige apenas números
      const castTime = parseInt(parts[2]);
      if (isNaN(castTime))
        return res.status(400).send("Tempo inválido para !Tekcast.");
      autoDeleteUsers[castId] = castTime * 1000;
      parentMessage.replies.push({
        user: user.user,
        id: user.id,
        replyMsg: "******",
        timestamp: new Date().toISOString()
      });
      MessageService.save();
      return res.send("Auto-delete ativado para usuário " + castId);
    }
      
    // Resposta normal
    parentMessage.replies.push({
      user: user.user,
      id: user.id,
      replyMsg: replyMsg,
      timestamp: new Date().toISOString()
    });
    MessageService.save();
    res.send("Resposta adicionada");
  },
  deleteMessage: (req, res) => {
    const { id, msgIndex } = req.query;
    const parsedIndex = parseInt(msgIndex);
    if (isNaN(parsedIndex)) return res.status(400).send("Índice inválido");
    const messages = MessageService.getAll();
    const user = UserService.findById(id);
    if (user.user.toLowerCase() === "tekscripts" || messages[parsedIndex].id === id) {
      const deleted = messages[parsedIndex];
      cache.deletedMessages.push(deleted);
      writeJSON(CONFIG.FILES.DELETED_MESSAGES, cache.deletedMessages);
      messages.splice(parsedIndex, 1);
      MessageService.save();
      return res.send("Mensagem deletada");
    }
    return res.status(403).send("Não autorizado");
  },
  editMessage: (req, res) => {
    const { id, msgIndex, newMsg } = req.query;
    const parsedIndex = parseInt(msgIndex);
    if (isNaN(parsedIndex)) return res.status(400).send("Índice inválido");
    const messages = MessageService.getAll();
    if (parsedIndex < 0 || parsedIndex >= messages.length || messages[parsedIndex].id !== id) {
      return res.status(403).send("Não autorizado");
    }
    messages[parsedIndex].msg = newMsg;
    MessageService.save();
    res.send("Mensagem editada");
  }
};

// Controlador para atualizar e visualizar status de digitação
const TypingController = {
  updateTyping: (req, res) => {
    const { id, user, tu } = req.query;
    if (!id || !user || (tu !== "true" && tu !== "false"))
      return res.status(400).send("Parâmetros inválidos");
    typingStatus[id] = {
      user,
      typing: tu === "true",
      timestamp: Date.now()
    };
    res.send(`Status de digitação atualizado para ${user}`);
  },
  getTypingStatus: (req, res) => {
    const now = Date.now();
    for (let key in typingStatus) {
      if (now - typingStatus[key].timestamp > TYPING_TIMEOUT) {
        typingStatus[key].typing = false;
      }
    }
    res.json(typingStatus);
  }
};

// Controlador para atualizar e visualizar status online
const OnlineController = {
  updateOnline: (req, res) => {
    const { id, user, online } = req.query;
    if (!id || !user || (online !== "true" && online !== "false"))
      return res.status(400).send("Parâmetros inválidos");
    onlineStatus[id] = {
      user,
      online: online === "true",
      timestamp: Date.now()
    };
    res.send(`Status online atualizado para ${user}`);
  },
  getOnlineStatus: (req, res) => {
    const now = Date.now();
    for (let key in onlineStatus) {
      if (now - onlineStatus[key].timestamp > ONLINE_TIMEOUT) {
        onlineStatus[key].online = false;
      }
    }
    res.json(onlineStatus);
  }
};

// ==================================================
// Controlador de Administração
// ==================================================
const AdminController = {
  // Visualiza todas as mensagens e também as deletadas
  viewAllMessages: (req, res) => {
    res.json({
      messages: MessageService.getAll(),
      deletedMessages: MessageService.getDeleted()
    });
  },
  // Limpa todas as mensagens do chat
  clearAllMessages: (req, res) => {
    cache.messages = [];
    MessageService.save();
    res.send("Todas as mensagens foram limpas.");
  },
  // Apaga uma mensagem específica, dado o msgId
  deleteAnyMessage: (req, res) => {
    const { msgId } = req.query;
    if (!msgId) return res.status(400).send("Parâmetro msgId necessário");
    const index = cache.messages.findIndex(m => m.msgId === msgId);
    if (index === -1) return res.status(404).send("Mensagem não encontrada");
    const deleted = cache.messages.splice(index, 1)[0];
    cache.deletedMessages.push(deleted);
    MessageService.save();
    writeJSON(CONFIG.FILES.DELETED_MESSAGES, cache.deletedMessages);
    res.send("Mensagem deletada.");
  },
  // Apaga um usuário e remove suas mensagens
  deleteUser: (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).send("Parâmetro id necessário");
    const userIndex = cache.users.findIndex(u => u.id === id);
    if (userIndex === -1) return res.status(404).send("Usuário não encontrado");
    const deletedUser = cache.users.splice(userIndex, 1)[0];
    UserService.save();
    // Remove as mensagens do usuário deletado
    cache.messages = cache.messages.filter(m => m.id !== id);
    MessageService.save();
    res.send(`Usuário ${deletedUser.user} e suas mensagens foram apagados.`);
  },
  // Banir usuário via rota administrativa
  banUser: (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).send("Parâmetro id necessário");
    if (BanService.isBanned(id)) return res.status(400).send("Usuário já está banido");
    BanService.addBan(id);
    res.send(`Usuário ${id} foi banido.`);
  },
  // Desbanir usuário via rota administrativa
  unbanUser: (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).send("Parâmetro id necessário");
    if (!BanService.isBanned(id)) return res.status(400).send("Usuário não está banido");
    BanService.removeBan(id);
    res.send(`Usuário ${id} foi desbanido.`);
  },
  // Censurar uma mensagem específica, substituindo seu conteúdo
  censorMessage: (req, res) => {
    const { msgId } = req.query;
    if (!msgId) return res.status(400).send("Parâmetro msgId necessário");
    const message = cache.messages.find(m => m.msgId === msgId);
    if (!message) return res.status(404).send("Mensagem não encontrada");
    message.msg = "Mensagem censurada pelo ADM";
    MessageService.save();
    res.send("Mensagem censurada.");
  },
  // Visualiza o status de todos os usuários, usuários banidos e status de digitação
  viewAllUsersStatus: (req, res) => {
    const users = UserService.getAll();
    const banned = BanService.getAll();
    res.json({ 
      users: users,
      bannedUsers: banned,
      typingStatus: typingStatus
    });
  }
};

// Rotas
function setup(app) {
  app.get("/api/user", UserController.createUser);
  app.get("/api/user-profile/:id", UserController.getProfile);
  app.get("/api/name", MessageController.postMessage);
  app.post("/api/reply-to-msg", MessageController.addReply);
  app.delete("/api/delete-msg", MessageController.deleteMessage);
  app.put("/api/edit-msg", MessageController.editMessage);
  app.get("/api/show-global-msgs", (req, res) => {
    res.json(MessageService.getAll());
  });
  app.get("/api/deleted-msgs", (_, res) => res.json(MessageService.getDeleted()));
  app.get("/api/all-users", (_, res) => res.json(UserService.getAll()));
  app.get("/api/notify", (req, res) => {
    res.json({ Noti: notifyMessages });
  });
    
  // Nova rota para atualizar status de digitação
  // Exemplo: /api/typing-status?id=123&user=Fabiana&tu=true
  app.get("/api/typing-status", TypingController.updateTyping);
    
  // Rota para visualizar status de digitação
  app.get("/api/status/typing", TypingController.getTypingStatus);

  // Nova rota para atualizar status online
  // Exemplo: /api/online-status?id=123&user=Fabiana&online=true
  app.get("/api/online-status", OnlineController.updateOnline);
    
  // Rota para visualizar status online
  app.get("/api/status/online", OnlineController.getOnlineStatus);

  // ============================
  // Rotas de Administração
  // ============================
  app.get("/api/admin/view-messages", AdminController.viewAllMessages);
  app.delete("/api/admin/clear-messages", AdminController.clearAllMessages);
  app.delete("/api/admin/delete-message", AdminController.deleteAnyMessage);
  app.delete("/api/admin/delete-user", AdminController.deleteUser);
  app.post("/api/admin/ban-user", AdminController.banUser);
  app.post("/api/admin/unban-user", AdminController.unbanUser);
  app.post("/api/admin/censor-message", AdminController.censorMessage);
  app.get("/api/admin/users-status", AdminController.viewAllUsersStatus);

  console.log("Módulo de usuários e mensagens carregado!");
}

loadData();

module.exports = { setup };
