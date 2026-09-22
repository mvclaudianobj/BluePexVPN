// ============ IMPORTS ============
const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsAsync = require('fs').promises;
const os = require('os');
const { spawn, exec, execSync, execFile, execFileSync } = require('child_process');
const axios = require('axios');
const { PublicClientApplication } = require('@azure/msal-node');
const { dialog } = require('electron');
const ps = require('ps-node');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

// ============ SISTEMA DE LOGGING ============

class AppLogger {
  constructor() {
    this.logDir = this.getLogDirectory();
    this.currentLogFile = null;
    this.maxLogSize = 10 * 1024 * 1024; // 10MB
    this.maxLogFiles = 5;
    this.initializeLogger();
  }

  getLogDirectory() {
    return path.join(app.getPath('userData'), 'logs');
  }

  async initializeLogger() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
        console.log(`📁 Diretório de logs criado: ${this.logDir}`);
      }

      const testFile = path.join(this.logDir, '.write_test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);

      this.currentLogFile = this.getCurrentLogFile();
      console.log(`📝 Logger inicializado. Arquivo atual: ${this.currentLogFile}`);

      this.log('SYSTEM', 'APP_START', {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        userData: app.getPath('userData'),
        logDir: this.logDir,
        packaged: app.isPackaged
      });

    } catch (error) {
      console.error('❌ Erro ao inicializar logger:', error);
      try {
        const fallbackLogDir = path.join(app.getPath('userData'), 'logs');
        if (!fs.existsSync(fallbackLogDir)) {
          fs.mkdirSync(fallbackLogDir, { recursive: true });
        }

        const testFile = path.join(fallbackLogDir, '.write_test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);

        this.logDir = fallbackLogDir;
        this.currentLogFile = this.getCurrentLogFile();
        console.log(`📝 Logger inicializado com fallback. Arquivo atual: ${this.currentLogFile}`);

        this.log('SYSTEM', 'LOGGER_FALLBACK', {
          originalDir: this.getLogDirectory(),
          fallbackDir: fallbackLogDir,
          reason: 'permission_denied'
        });

      } catch (fallbackError) {
        console.error('❌ Fallback do logger também falhou:', fallbackError);
        this.currentLogFile = null;
      }
    }
  }

  getCurrentLogFile() {
    const today = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `data_${today}.log`);
  }

  async checkLogRotation() {
    if (!this.currentLogFile) return;
    try {
      const stats = await fsAsync.stat(this.currentLogFile);
      if (stats.size > this.maxLogSize) {
        await this.rotateLog();
      }
    } catch (error) {}
  }

  async rotateLog() {
    const baseName = path.basename(this.currentLogFile, '.log');
    for (let i = this.maxLogFiles - 1; i >= 1; i--) {
      const oldFile = path.join(this.logDir, `${baseName}.${i}.log`);
      const newFile = path.join(this.logDir, `${baseName}.${i + 1}.log`);
      try {
        if (fs.existsSync(oldFile)) {
          if (i === this.maxLogFiles - 1) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      } catch (error) {
        console.error(`Erro ao rotacionar log ${oldFile}:`, error.message);
      }
    }

    const rotatedFile = path.join(this.logDir, `${baseName}.1.log`);
    try {
      fs.renameSync(this.currentLogFile, rotatedFile);
    } catch (error) {
      console.error('Erro ao rotacionar log atual:', error.message);
    }

    this.currentLogFile = this.getCurrentLogFile();
  }

  log(category, action, data = {}, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      category,
      action,
      data,
      pid: process.pid
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    const consoleLine = `[${timestamp}] ${level} [${category}] ${action}: ${JSON.stringify(data)}`;

    if (level === 'ERROR') {
      console.error(consoleLine);
    } else if (level === 'WARN') {
      console.warn(consoleLine);
    } else {
      console.log(consoleLine);
    }

    if (this.currentLogFile) {
      try {
        fs.appendFileSync(this.currentLogFile, logLine);
      } catch (error) {
        console.error('Erro ao escrever no arquivo de log:', error);
      }
    }
  }

  logProfileCreate(profileId, profileType, profileName) {
    this.log('PROFILE', 'CREATE', { profileId, profileType, profileName });
  }

  logProfileDelete(profileId, profileType, profileName) {
    this.log('PROFILE', 'DELETE', { profileId, profileType, profileName });
  }

  logConnectionStart(profileId, profileType, connectionType) {
    this.log('CONNECTION', 'START', { profileId, profileType, connectionType });
  }

  logConnectionSuccess(profileId, profileType, details = {}) {
    this.log('CONNECTION', 'SUCCESS', { profileId, profileType, ...details });
  }

  logConnectionFailure(profileId, profileType, error, details = {}) {
    this.log('CONNECTION', 'FAILURE', { profileId, profileType, error: error.message, ...details }, 'ERROR');
  }

  logConnectionDisconnect(profileId, profileType, reason = '') {
    this.log('CONNECTION', 'DISCONNECT', { profileId, profileType, reason });
  }

  logSystemError(component, error, details = {}) {
    this.log('SYSTEM', 'ERROR', { component, error: error.message, ...details }, 'ERROR');
  }

  logAuthFailure(authType, provider, error, details = {}) {
    this.log('AUTH', 'FAILURE', { authType, provider, error: error.message, ...details }, 'ERROR');
  }

  logAuthSuccess(authType, provider, details = {}) {
    this.log('AUTH', 'SUCCESS', { authType, provider, ...details });
  }

  logAzureTokenPublish(username, success, details = {}) {
    this.log('AZURE', success ? 'TOKEN_PUBLISH_SUCCESS' : 'TOKEN_PUBLISH_FAILURE', { username, ...details }, success ? 'INFO' : 'ERROR');
  }

  async getRecentLogs(maxLines = 100) {
    try {
      if (!this.currentLogFile || !fs.existsSync(this.currentLogFile)) {
        return 'Nenhum arquivo de log encontrado.';
      }

      const content = fs.readFileSync(this.currentLogFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.trim());

      // Retornar as últimas maxLines linhas
      const recentLines = lines.slice(-maxLines);

      // Formatar para exibição
      return recentLines.map(line => {
        try {
          const entry = JSON.parse(line);
          const time = new Date(entry.timestamp).toLocaleString();
          return `[${time}] ${entry.level} [${entry.category}] ${entry.action}: ${JSON.stringify(entry.data)}`;
        } catch (e) {
          return line; // Se não conseguir parsear, retorna a linha crua
        }
      }).join('\n');

    } catch (error) {
      console.error('Erro ao ler logs recentes:', error);
      return `Erro ao ler logs: ${error.message}`;
    }
  }
}

// Verificar processos OpenVPN ativos
async function checkActiveOpenVPN() {
  return new Promise((resolve) => {
    ps.lookup({ command: 'openvpn' }, (err, resultList) => {
      if (err) {
        console.error('Erro ao verificar processos OpenVPN:', err);
        resolve([]);
        return;
      }
      resolve(resultList);
    });
  });
}

// Instância global do logger
let logger;
// Instância global do updater
let updaterManager;

// Capturar erros globais no main process
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  if (logger) {
    logger.log('SYSTEM', 'UNCAUGHT_EXCEPTION', {
      message: error.message,
      stack: error.stack
    });
  }
  app.quit();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
  logger.log('SYSTEM', 'UNHANDLED_REJECTION', {
    reason: reason,
    promise: promise
  }, 'ERROR');
});

// ============ SISTEMA DE ATUALIZAÇÃO AUTOMÁTICA ============

const WSUTM_UPDATE_BASE_URL = process.env.BLUEPEX_UPDATE_BASE_URL || 'http://wsutm.bluepex.com/bluepexvpn';
const UPDATE_PROVIDER_TIMEOUT_MS = 15000;
const UPDATE_IPC_TIMEOUT_MS = 35000;

function truncateUpdateError(error) {
  return String(error?.message || error || 'erro desconhecido').slice(0, 300);
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => resolve({ success: false, error: message, timeout: true }), timeoutMs);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    timeoutPromise
  ]);
}

class AutoUpdaterManager {
  constructor() {
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.updateInfo = null;
    this.checkInterval = null;
    this.isChecking = false;
    this.updateProvider = 'github';
    this.lastCheckProvider = null;
    this.wsutmBaseUrl = this.normalizeWsutmBaseUrl(WSUTM_UPDATE_BASE_URL);

    this.configureUpdater();
    this.setupEventHandlers();
    this.startPeriodicChecks();
  }

  normalizeWsutmBaseUrl(baseUrl) {
    return String(baseUrl || '').trim().replace(/\/+$/, '');
  }

  configureUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = true;

    this.configureGithubFeed();

    logger.log('UPDATE', 'CONFIGURED', {
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
      provider: 'github',
      fallbackProvider: 'generic',
      fallbackBaseUrl: this.wsutmBaseUrl
    });
  }

  configureGithubFeed() {
    if (process.env.GITHUB_TOKEN) {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'mvclaudianobj',
        repo: 'BluePexVPN',
        private: true,
        token: process.env.GITHUB_TOKEN
      });
      console.log('🔗 Feed URL configurado (private):', 'mvclaudianobj/BluePexVPN');
    } else {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'mvclaudianobj',
        repo: 'BluePexVPN',
        includePrerelease: true
      });
      console.log('🔗 Feed URL configurado (public):', 'mvclaudianobj/BluePexVPN');
    }

    this.updateProvider = 'github';
  }

  configureWsutmFeed() {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: this.wsutmBaseUrl,
      channel: process.platform === 'win32' ? 'latest' : 'latest-linux'
    });

    this.updateProvider = 'wsutm';
    console.log('🔗 Feed URL fallback WSUTM configurado:', this.wsutmBaseUrl);

    logger.log('UPDATE', 'WSUTM_CONFIGURED', {
      provider: 'generic',
      baseUrl: this.wsutmBaseUrl,
      expectedManifests: process.platform === 'win32' ? ['latest.yml'] : ['latest-linux.yml'],
      versionedAssetsPath: `${this.wsutmBaseUrl}/${app.getVersion()}/`
    });
  }

  getWsutmArtifactAliases(version) {
    return {
      win32: [
        `BluePex.VPN.Setup.${version}.exe`,
        `BluePex VPN Setup ${version}.exe`,
        `BluePex VPN Setup ${version}.exe.blockmap`,
        `BluePex.VPN.Setup.${version}.exe.blockmap`
      ],
      linux: [
        `bluepex-vpn_${version}_amd64.deb`,
        `bluepex-vpn-${version}.x86_64.rpm`,
        `bluepex-vpn-${version}.AppImage`,
        `BluePex VPN-${version}.AppImage`
      ],
      darwin: []
    }[process.platform] || [];
  }

  enhanceWsutmUpdateInfo(info) {
    if (!info || this.updateProvider !== 'wsutm') return info;

    const version = info.version || app.getVersion();
    const aliases = this.getWsutmArtifactAliases(version);
    info.wsutmCompatibility = {
      baseUrl: this.wsutmBaseUrl,
      manifestRoot: this.wsutmBaseUrl,
      versionedAssetsPath: `${this.wsutmBaseUrl}/${version}/`,
      artifactAliases: aliases,
      manifestFiles: Array.isArray(info.files) ? info.files.map((file) => file.url || file.path).filter(Boolean) : []
    };

    logger.log('UPDATE', 'WSUTM_COMPATIBILITY_ALIASES', info.wsutmCompatibility);
    return info;
  }

  setupEventHandlers() {
    // NOTA: os eventos 'update-available' e 'update-not-available' são gerenciados
    // com .once() dentro de checkForUpdates() para garantir sequência correta.
    // Aqui ficam apenas os eventos de longa duração (download e erro global).

    autoUpdater.on('download-progress', (progressObj) => {
      const progress = {
        percent: Math.round(progressObj.percent),
        speed: Math.round(progressObj.bytesPerSecond / 1024),
        transferred: Math.round(progressObj.transferred / 1024 / 1024),
        total: Math.round(progressObj.total / 1024 / 1024),
        remaining: progressObj.total - progressObj.transferred
      };

      if (progress.percent % 10 === 0 || progress.percent === 100) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-progress', progress);
        }
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      logger.log('UPDATE', 'DOWNLOADED', {
        version: info.version,
        downloadedAt: new Date().toISOString()
      });

      this.updateDownloaded = true;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-downloaded', info);
      }
    });

    autoUpdater.on('error', (error) => {
      console.log('💥 AUTO_UPDATER ERROR:', error.message);
      console.log('📋 Error details:', error);

      const waitingForFallback = this.isChecking && this.updateProvider === 'github';
      const handledByActiveCheck = this.isChecking;

      logger.logSystemError('AUTO_UPDATER', error, {
        currentVersion: app.getVersion(),
        platform: process.platform,
        provider: this.updateProvider,
        waitingForFallback,
        handledByActiveCheck
      });

      if (handledByActiveCheck) return;

      this.updateAvailable = false;
      this.updateDownloaded = false;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-error', {
          message: error.message,
          code: error.code
        });
      }
    });
  }

  startPeriodicChecks() {
    const checkInterval = 4 * 60 * 60 * 1000;
    this.checkInterval = setInterval(() => {
      if (!this.isChecking) {
        this.checkForUpdates(false);
      }
    }, checkInterval);

    setTimeout(() => {
      this.checkForUpdates(false);
    }, 30000);

    logger.log('UPDATE', 'PERIODIC_CHECKS_STARTED', {
      intervalHours: 4,
      firstCheckDelaySeconds: 30
    });
  }

  async checkForUpdates(showDialog = true) {
    if (this.isChecking) {
      logger.log('UPDATE', 'CHECK_ALREADY_RUNNING');
      return { success: false, alreadyRunning: true, error: 'Verificação de atualizações já está em andamento.' };
    }

    this.isChecking = true;
    let githubCheckError;
    try {
      this.configureGithubFeed();

      logger.log('UPDATE', 'CHECK_START', {
        manual: showDialog,
        currentVersion: app.getVersion(),
        primaryProvider: 'github',
        fallbackProvider: 'wsutm',
        providerTimeoutMs: UPDATE_PROVIDER_TIMEOUT_MS
      });

      console.log('🔍 Iniciando checkForUpdates()...');

      try {
        await this.runUpdateCheck('github');
      } catch (githubError) {
        githubCheckError = githubError;
        logger.logSystemError('UPDATE_CHECK_GITHUB_FAILED', githubError, {
          fallback: 'wsutm',
          baseUrl: this.wsutmBaseUrl,
          providerTimeoutMs: UPDATE_PROVIDER_TIMEOUT_MS
        });
      }

      if (!this.updateAvailable) {
        logger.log('UPDATE', 'CHECK_FALLBACK_START', {
          from: 'github',
          to: 'wsutm',
          reason: githubCheckError ? truncateUpdateError(githubCheckError) : 'no_update_on_github'
        });
        this.configureWsutmFeed();
        try {
          await this.runUpdateCheck('wsutm');
        } catch (wsutmError) {
          if (githubCheckError) {
            const message = 'Não foi possível verificar atualizações no GitHub nem no WSUTM.';
            const detail = `GitHub: ${truncateUpdateError(githubCheckError)} | WSUTM: ${truncateUpdateError(wsutmError)}`;
            const finalError = new Error(`${message} ${detail}`);
            finalError.code = 'UPDATE_CHECK_ALL_PROVIDERS_FAILED';
            throw finalError;
          }
        }
      }

      console.log('✅ checkForUpdates() concluído. updateAvailable:', this.updateAvailable);

      if (mainWindow && !mainWindow.isDestroyed()) {
        if (this.updateAvailable) {
          logger.log('UPDATE', 'NOTIFYING_UPDATE_AVAILABLE', { version: this.updateInfo?.version });
          mainWindow.webContents.send('update-available', { info: this.updateInfo, showDialog });
        } else {
          mainWindow.webContents.send('update-check-complete', {
            available: false,
            currentVersion: app.getVersion()
          });
        }
      }
      return { success: true, available: this.updateAvailable, provider: this.lastCheckProvider };
    } catch (error) {
      logger.logSystemError('UPDATE_CHECK', error);
      const message = error.code === 'UPDATE_CHECK_ALL_PROVIDERS_FAILED'
        ? 'Não foi possível verificar atualizações no GitHub nem no WSUTM.'
        : error.message;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-error', {
          message,
          detail: truncateUpdateError(error),
          code: error.code
        });
      }
      return { success: false, error: message, detail: truncateUpdateError(error), code: error.code };
    } finally {
      this.isChecking = false;
    }
  }

  async runUpdateCheck(provider) {
    this.lastCheckProvider = provider;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout na verificação de atualização ${provider} (${UPDATE_PROVIDER_TIMEOUT_MS / 1000}s)`));
      }, UPDATE_PROVIDER_TIMEOUT_MS);

      const onAvailable = (info) => {
        cleanup();
        this.updateAvailable = true;
        this.updateInfo = this.enhanceWsutmUpdateInfo(info);
        resolve({ available: true, info: this.updateInfo });
      };

      const onNotAvailable = (info) => {
        cleanup();
        this.updateAvailable = false;
        this.updateInfo = null;
        resolve({ available: false, info });
      };

      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-available', onAvailable);
        autoUpdater.removeListener('update-not-available', onNotAvailable);
        autoUpdater.removeListener('error', onError);
      };

      logger.log('UPDATE', 'CHECK_PROVIDER_START', {
        provider,
        timeoutMs: UPDATE_PROVIDER_TIMEOUT_MS,
        baseUrl: provider === 'wsutm' ? this.wsutmBaseUrl : undefined
      });

      autoUpdater.once('update-available', onAvailable);
      autoUpdater.once('update-not-available', onNotAvailable);
      autoUpdater.once('error', onError);

      autoUpdater.checkForUpdates().catch(onError);
    });

    logger.log('UPDATE', 'CHECK_PROVIDER_COMPLETE', {
      provider,
      available: this.updateAvailable,
      version: this.updateInfo?.version
    });
  }

  getStatus() {
    return {
      updateAvailable: this.updateAvailable,
      updateDownloaded: this.updateDownloaded,
      updateInfo: this.updateInfo,
      currentVersion: app.getVersion(),
      isChecking: this.isChecking,
      provider: this.updateProvider,
      fallbackBaseUrl: this.wsutmBaseUrl
    };
  }
}

// Instância global do auto-updater

// Padronizar nome da aplicação para consistência de diretórios
app.setName('bluepex-vpn');

// ============ CONFIGURAÇÃO DE DIRETÓRIOS ============

const USER_DATA_DIR = app.getPath('userData');
const PROFILES_DIR = path.join(USER_DATA_DIR, 'ovpn_profiles');
const AZURE_PROFILES_DIR = path.join(USER_DATA_DIR, 'azure_ovpn_profiles');

// Arquivos de configuração
const USER_PROFILES_PATH = path.join(USER_DATA_DIR, 'user_profiles.json');
const AZURE_PROFILES_PATH = path.join(USER_DATA_DIR, 'azure_profiles.json');
const APP_STATE_PATH = path.join(USER_DATA_DIR, 'app_state.json');
const USER_CREDENTIALS_PATH = path.join(USER_DATA_DIR, 'user_credentials.json');
const CONFIG_PATH = path.join(USER_DATA_DIR, 'config.json');
const APP_SETTINGS_PATH = path.join(USER_DATA_DIR, 'app_settings.json');
const CUSTOM_LOGO_PATH = path.join(USER_DATA_DIR, 'custom_logo.dat');

function loadAppSettings() {
  try {
    if (fs.existsSync(APP_SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, 'utf-8'));
    }
  } catch (_) {}
  return {};
}

function saveAppSettings(settings) {
  try {
    const current = loadAppSettings();
    const merged = Object.assign({}, current, settings);
    fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(merged, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============ UTILITÁRIOS DE CRIPTOGRAFIA ============
// IS004: chave derivada do machine-id do sistema (não hardcoded)
function getMachineId() {
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/);
      if (match) return match[1].trim();
    } else {
      // Linux: /etc/machine-id ou /var/lib/dbus/machine-id
      for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (fs.existsSync(p)) {
          return fs.readFileSync(p, 'utf8').trim();
        }
      }
    }
  } catch (_) {}
  // Fallback: identificador baseado no caminho de dados do app (único por instalação)
  return crypto.createHash('sha256').update(USER_DATA_DIR).digest('hex');
}

const _machineId = getMachineId();
const _appSalt = 'BluePexVPN-v2-Salt';
const ENCRYPTION_KEY = crypto.scryptSync(_machineId, _appSalt, 32);
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    encrypted: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

function decrypt(encryptedData) {
  try {
    if (!encryptedData || typeof encryptedData !== 'object' || !encryptedData.iv || !encryptedData.authTag || !encryptedData.encrypted) {
      return null;
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, Buffer.from(encryptedData.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (_) {
    // IS004: fallback — tenta descriptografar com a chave legada (antes da migração machine-id)
    try {
      const legacyKey = crypto.scryptSync('BluePexVPN-SecureStorage-2025', 'BluePexSalt2025', 32);
      const decipher = crypto.createDecipheriv(ALGORITHM, legacyKey, Buffer.from(encryptedData.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      console.log('🔑 [IS004] Credencial descriptografada com chave legada — será re-criptografada na próxima gravação');
      return decrypted;
    } catch (error) {
      console.error('Erro ao descriptografar (chave nova e legada falharam):', error.message);
      return null;
    }
  }
}

// Criar diretórios necessários
function ensureDirectories() {
  const dirs = [
    { path: USER_DATA_DIR, name: 'dados do usuário', critical: true },
    { path: PROFILES_DIR, name: 'perfis VPN', critical: false },
    { path: AZURE_PROFILES_DIR, name: 'perfis Azure', critical: false }
  ];

  logger.log('SYSTEM', 'DIRECTORY_CHECK_START', {
    directories: dirs.map(d => ({ path: d.path, name: d.name, critical: d.critical })),
    platform: process.platform,
    user: process.env.USER || 'unknown'
  });

  for (const dir of dirs) {
    try {
      const existsBefore = fs.existsSync(dir.path);
      if (!existsBefore) {
        fs.mkdirSync(dir.path, { recursive: true });
        logger.log('SYSTEM', 'DIRECTORY_CREATED', {
          path: dir.path,
          name: dir.name,
          permissions: '0755',
          recursive: true,
          critical: dir.critical,
          success: true
        });
        console.log(`📁 Diretório criado: ${dir.path}`);
      } else {
        console.log(`📁 Diretório já existe: ${dir.path}`);
      }
    } catch (error) {
      logger.logSystemError('DIRECTORY_CREATION_FAILED', error, {
        path: dir.path,
        name: dir.name,
        errorCode: error.code,
        errorMessage: error.message,
        errno: error.errno,
        syscall: error.syscall,
        critical: dir.critical
      });
      console.error(`❌ Erro ao criar diretório: ${dir.path}`, error.message);
    }
  }

  console.log(`📁 Diretório de perfis: ${PROFILES_DIR}`);
  console.log(`📁 Diretório de perfis Azure: ${AZURE_PROFILES_DIR}`);
}

function migrateLegacyUserDataIfNeeded() {
  try {
    const appDataDir = app.getPath('appData');
    const legacyDirs = [
      path.join(appDataDir, 'BluePexVPN'),
      path.join(appDataDir, 'bp-vpn-electron'),
      path.join(appDataDir, 'BluePex VPN')
    ].filter((dirPath) => dirPath !== USER_DATA_DIR);

    const jsonFiles = [
      'user_profiles.json',
      'azure_profiles.json',
      'user_credentials.json',
      'app_state.json',
      'config.json'
    ];

    const profileDirs = ['ovpn_profiles', 'azure_ovpn_profiles'];

    for (const legacyDir of legacyDirs) {
      if (!fs.existsSync(legacyDir)) {
        continue;
      }

      let migratedItems = 0;

      for (const fileName of jsonFiles) {
        const fromPath = path.join(legacyDir, fileName);
        const toPath = path.join(USER_DATA_DIR, fileName);
        if (!fs.existsSync(fromPath) || fs.existsSync(toPath)) {
          continue;
        }

        fs.copyFileSync(fromPath, toPath);
        migratedItems++;
      }

      for (const dirName of profileDirs) {
        const fromDir = path.join(legacyDir, dirName);
        const toDir = path.join(USER_DATA_DIR, dirName);
        if (!fs.existsSync(fromDir)) {
          continue;
        }

        fs.mkdirSync(toDir, { recursive: true });
        fs.cpSync(fromDir, toDir, { recursive: true, force: false, errorOnExist: false });
        migratedItems++;
      }

      if (migratedItems > 0) {
        logger.log('SYSTEM', 'LEGACY_USER_DATA_MIGRATED', {
          from: legacyDir,
          to: USER_DATA_DIR,
          migratedItems
        });
      }
    }
  } catch (error) {
    logger.logSystemError('LEGACY_USER_DATA_MIGRATION_FAILED', error, {
      userDataDir: USER_DATA_DIR
    });
  }
}

let mainWindow;
let splashWindow;
let tray;
let pca;
const azureAuthContexts = new Map();
let config;
let currentElevationMethod = null;
let currentOvpnPath = null;
let vpnProcess = null;
let vpnConnectionActive = false;
let currentConnectionMeta = null;
let tunnelHealthCheckInterval = null;
let suppressNextReconnect = false;
let currentLocalChallengeContext = null;

// RF011: Kill Switch
let killSwitchEnabled = false;
let killSwitchActive = false;

// RF010: controle de reconexão automática
const AUTO_RECONNECT = {
  enabled: true,       // habilita reconexão automática
  maxRetries: 3,       // máximo de tentativas
  baseDelay: 5000,     // delay inicial em ms (5s)
  maxDelay: 60000,     // delay máximo em ms (60s)
  retryCount: 0,       // contador atual
  retryTimer: null,    // timer pendente
  lastProfileId: null, // perfil da última conexão
  lastProfileType: null
};

function scheduleReconnect(profileId, profileType) {
  if (!AUTO_RECONNECT.enabled) return;
  if (AUTO_RECONNECT.retryCount >= AUTO_RECONNECT.maxRetries) {
    console.log(`⛔ [RF010] Máximo de tentativas (${AUTO_RECONNECT.maxRetries}) atingido para ${profileId}`);
    AUTO_RECONNECT.retryCount = 0;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn-reconnect-failed', { profileId, maxRetries: AUTO_RECONNECT.maxRetries });
    }
    return;
  }

  const delay = Math.min(AUTO_RECONNECT.baseDelay * Math.pow(2, AUTO_RECONNECT.retryCount), AUTO_RECONNECT.maxDelay);
  AUTO_RECONNECT.retryCount++;
  console.log(`🔄 [RF010] Tentativa ${AUTO_RECONNECT.retryCount}/${AUTO_RECONNECT.maxRetries} em ${delay / 1000}s para ${profileId}`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vpn-reconnecting', {
      profileId,
      attempt: AUTO_RECONNECT.retryCount,
      maxRetries: AUTO_RECONNECT.maxRetries,
      delaySeconds: Math.round(delay / 1000)
    });
  }

  AUTO_RECONNECT.retryTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn-reconnect-attempt', { profileId, attempt: AUTO_RECONNECT.retryCount });
    }
    // Dispara reconexão via IPC interno
    ipcMain.emit('internal-reconnect', profileId, profileType);
  }, delay);
}

function cancelReconnect() {
  if (AUTO_RECONNECT.retryTimer) {
    clearTimeout(AUTO_RECONNECT.retryTimer);
    AUTO_RECONNECT.retryTimer = null;
  }
  AUTO_RECONNECT.retryCount = 0;
  AUTO_RECONNECT.lastProfileId = null;
  AUTO_RECONNECT.lastProfileType = null;
}

// Caminhos dos arquivos
const cachePath = path.join(os.tmpdir(), 'electron_token_cache.json');
const authPath = path.join(os.tmpdir(), 'openvpn_auth.txt');

function writeTokenCache(data) {
  const encrypted = encrypt(JSON.stringify(data));
  fs.writeFileSync(cachePath, JSON.stringify(encrypted), { mode: 0o600 });
}

function readTokenCache() {
  const raw = fs.readFileSync(cachePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (parsed && parsed.encrypted && parsed.iv && parsed.authTag) {
    return JSON.parse(decrypt(parsed));
  }
  return parsed;
}

// Função para copiar a política para o local correto (se necessário)
function ensurePolicyFile() {
  if (process.platform === 'linux') {
    const policySource = path.join(__dirname, 'build', 'com.bpvpn.pkexec.policy');
    const policyDest = path.join(__dirname, 'resources', 'com.bpvpn.pkexec.policy');
    
    const resourcesDir = path.dirname(policyDest);
    try {
      if (!fs.existsSync(resourcesDir)) {
        fs.mkdirSync(resourcesDir, { recursive: true });
      }
    } catch (err) {
      console.warn('Erro ao criar diretório resources:', err.message);
    }
    
    if (fs.existsSync(policySource) && !fs.existsSync(policyDest)) {
      fs.copyFileSync(policySource, policyDest);
      console.log('✅ Arquivo de política copiado para resources');
    }
  }
}

async function ensurePolkitRules() {
  if (process.platform !== 'linux') return;
  const policyDest = '/usr/share/polkit-1/actions/com.bpvpn.pkexec.policy';
  const rulesDest  = '/usr/share/polkit-1/rules.d/com.bluepex.vpn.rules';
  if (fs.existsSync(policyDest) && fs.existsSync(rulesDest)) return;
  const resDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'build');
  const policySource = path.join(resDir, 'com.bpvpn.pkexec.policy');
  const rulesSource  = path.join(resDir, 'com.bluepex.vpn.rules');
  if (!fs.existsSync(policySource) || !fs.existsSync(rulesSource)) return;
  const installScript = `install -Dm644 '${policySource}' '${policyDest}' && install -Dm644 '${rulesSource}' '${rulesDest}' && (systemctl reload polkit 2>/dev/null || pkill -HUP polkitd 2>/dev/null || true)`;
  await new Promise((resolve) => {
    exec(`pkexec sh -c "${installScript}"`, (err) => {
      if (err) exec(`sudo -n sh -c "${installScript}"`, () => resolve());
      else resolve();
    });
  });
}

function createTray() {
  // IS001: evitar criação dupla do tray (race condition Linux)
  if (tray && !tray.isDestroyed()) {
    console.log('⚠️ Tray já existe, ignorando criação duplicada');
    return;
  }

  // Suporte a tray em todas as plataformas
  const iconExt = process.platform === 'win32' ? 'ico' : 'png';
  const iconPath = path.join(__dirname, `icon.${iconExt}`);

  // IS001: no Linux, aguardar que o display esteja estável antes de criar o tray
  const doCreate = () => {
    try {
      tray = new Tray(iconPath);
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Mostrar',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        },
        {
          label: 'Minimizar para Tray',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.hide();
            }
          }
        },
        {
          label: 'Sair',
          click: () => {
            if (isVpnSessionActive()) {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('vpn-status', 'Desconecte da VPN antes de sair do aplicativo.');
              }
              logger.log('SYSTEM', 'TRAY_QUIT_BLOCKED_VPN_ACTIVE', { trackedPid: getTrackedVpnPid() });
              return;
            }
            app.quit();
          }
        }
      ]);
      tray.setToolTip('BluePex VPN');
      tray.setContextMenu(contextMenu);

      // IS001: clique no tray — verifica mainWindow antes de agir
      tray.on('click', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      });

      // IS001: double-click também restaura (Linux/Windows)
      tray.on('double-click', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.show();
        mainWindow.focus();
      });

      console.log('✅ Tray criado com sucesso para plataforma:', process.platform);
    } catch (error) {
      console.error('Erro ao criar tray:', error);
      logger.logSystemError('TRAY_CREATION_FAILED', error, {
        platform: process.platform,
        iconPath: iconPath
      });
    }
  };

  // IS001: no Linux, pequeno delay evita race condition com o sistema de tray (appindicator)
  if (process.platform === 'linux') {
    setTimeout(doCreate, 500);
  } else {
    doCreate();
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    center: true,
    show: false,
  });

  const splashPath = path.join(__dirname, 'splash.html');
  let splashContent = fs.readFileSync(splashPath, 'utf8');
  const version = app.getVersion();
  splashContent = splashContent.replace('Versão 1.0.0', `Versão ${version}`);

  const logoPath = path.join(__dirname, 'logo.png');
  if (fs.existsSync(logoPath)) {
    const logoData = fs.readFileSync(logoPath);
    const logoBase64 = logoData.toString('base64');
    splashContent = splashContent.replace('src="logo.png"', `src="data:image/png;base64,${logoBase64}"`);
  }

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashContent)}`);
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });
}

 function createWindow() {
   try {
     console.log('🏗️ Criando janela principal...');
     console.log('📁 __dirname:', __dirname);
     console.log('📄 Preload path:', path.join(__dirname, 'preload.js'));
      mainWindow = new BrowserWindow({
      width: 640,
      height: 712, // 680 + 32 for title bar
       frame: false,
      minimizable: true,
      maximizable: false,
      movable: true,
      showInTaskbar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
       preload: path.join(__dirname, 'preload.js')
       },
       title: 'BluePex VPN Connections',
       icon: path.join(__dirname, 'icon.ico'), // Adicionar ícone
      autoHideMenuBar: false,
      resizable: true,
      center: true,
      show: false,
     });

    console.log('✅ Janela principal criada com sucesso');

    const savedSettings = loadAppSettings();
    if (savedSettings.compactMode) {
      mainWindow.setSize(640, 520);
      mainWindow.setResizable(false);
      mainWindow.setMinimumSize(640, 520);
      mainWindow.setMaximumSize(640, 520);
    } else {
      mainWindow.setSize(640, 712);
      mainWindow.setResizable(false);
      mainWindow.setMinimumSize(640, 712);
      mainWindow.setMaximumSize(640, 712);
    }

   // Menu removido conforme solicitado
   Menu.setApplicationMenu(null);

  console.log('📄 Carregando index.html...');
  mainWindow.loadFile('index.html');
  console.log('✅ index.html carregado');

  mainWindow.once('ready-to-show', () => {
    console.log('🎯 Janela principal pronta para mostrar');
    if (app.isPackaged) {
      setTimeout(() => {
        if (splashWindow) {
          splashWindow.close();
          splashWindow = null;
        }
        mainWindow.show();
        createTray();
      }, 3000);
    } else {
      mainWindow.show();
      createTray();
    }
  });

  mainWindow.on('minimize', () => {
    mainWindow.hide();
  });

  mainWindow.on('close', (event) => {
    if (isVpnSessionActive()) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-status', 'Desconecte da VPN antes de fechar o aplicativo.');
      }
      logger.log('SYSTEM', 'WINDOW_NATIVE_CLOSE_BLOCKED_VPN_ACTIVE', { trackedPid: getTrackedVpnPid() });
    }
  });

  mainWindow.on('closed', () => {
    if (tray) tray.destroy();

    // Desconectar somente processo rastreado pelo BluePex ao fechar (sem pkill/taskkill global)
    console.log("🔌 Fechando janela - limpeza de sessão BluePex rastreada...");
    if (vpnProcess && !vpnProcess.killed && currentConnectionMeta?.connectionOwner === 'bluepex') {
      console.log("🔌 Matando processo VPN BluePex específico...");
      vpnProcess.kill('SIGTERM');

      // Aguardar um pouco e forçar se necessário
      setTimeout(() => {
        if (vpnProcess && !vpnProcess.killed) {
          vpnProcess.kill('SIGKILL');
        }
      }, 2000);
    }

    vpnConnectionActive = false;
    clearBluepexConnectionMeta();

    // Não usar killVPNConnection() com pkexec ao fechar a aplicação
    console.log("✅ Processo de limpeza ao fechar concluído");

    mainWindow = null;
  });
  } catch (error) {
    console.error('❌ Erro ao criar janela principal:', error);
    // Mostrar erro em dialog para debug no packaged
    const { dialog } = require('electron');
    dialog.showErrorBox('Erro na Inicialização', `Erro ao criar janela principal:\n${error.message}\n\nStack: ${error.stack}`);
    app.quit();
  }
}

// Prevenir múltiplas instâncias
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

// Disable hardware acceleration to avoid DISPLAY issues
app.disableHardwareAcceleration();

// Register custom protocol for serving icons and static assets
const { protocol } = require('electron');

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-resource', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }
]);

function startTunnelHealthCheck() {
  if (tunnelHealthCheckInterval) return;
  tunnelHealthCheckInterval = setInterval(() => {
    if (!vpnConnectionActive) return;

    const pid = getTrackedVpnPid();
    const pidAlive = pid ? isPidAlive(pid) : false;

    if (!pidAlive) {
      const ifaceState = detectLocalVpnInterfaceState();
      if (ifaceState.connected) {
        logger.log('VPN', 'TUNNEL_HEALTH_CHECK_PID_GONE_IFACE_OK', { pid, reason: 'pkexec_wrapper_ended' }, 'WARN');
        return;
      }

      vpnConnectionActive = false;
      if (tunnelHealthCheckInterval) {
        clearInterval(tunnelHealthCheckInterval);
        tunnelHealthCheckInterval = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-disconnected');
        mainWindow.webContents.send('vpn-status', 'Túnel VPN encerrado pelo servidor. Reconecte.');
      }
      logger.log('VPN', 'TUNNEL_HEALTH_CHECK_DISCONNECTED', { pid, reason: pid ? 'process_gone' : 'pid_gone' }, 'WARN');
    }
  }, 30000);
}

function stopTunnelHealthCheck() {
  if (tunnelHealthCheckInterval) {
    clearInterval(tunnelHealthCheckInterval);
    tunnelHealthCheckInterval = null;
  }
}


app.on('ready', () => {
  protocol.registerFileProtocol('local-resource', (request, callback) => {
    const url = request.url.replace('local-resource://', '');
    const decodedUrl = decodeURIComponent(url);
    let filePath = path.join(__dirname, decodedUrl);
    
    // If file doesn't exist in app directory, try resources directory (for packaged app)
    if (!fs.existsSync(filePath) && app.isPackaged) {
      filePath = path.join(process.resourcesPath, 'app.asar.unpacked', decodedUrl);
    }
    
    callback({ path: filePath });
  });
});

// Log environment info for DISPLAY verification
console.log('DISPLAY env:', process.env.DISPLAY);
console.log('Platform:', process.platform);
console.log('Electron version:', process.versions.electron);

app.whenReady().then(async () => {
  try {
    // Inicializar logger após app ready
    logger = new AppLogger();

    if (!app.isPackaged) ensurePolicyFile();
    if (process.platform === 'linux') await ensurePolkitRules();
    ensureDirectories();
    migrateLegacyUserDataIfNeeded();

    // Migrar credenciais antigas para criptografia segura
    await migrateCredentials();

    // Inicializar auto-updater
    updaterManager = new AutoUpdaterManager();

    if (process.platform === 'linux' && !process.env.DISPLAY) {
      console.error('Erro: DISPLAY não definido. Execute em ambiente com interface gráfica.');
      app.quit();
      return;
    }

    if (app.isPackaged) {
      createSplashWindow();
    }
    
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } else {
      const oldConfigPath = path.join(__dirname, 'config.json');
      if (fs.existsSync(oldConfigPath)) {
        config = JSON.parse(fs.readFileSync(oldConfigPath, 'utf-8'));
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      } else {
        config = {
          client_id: "",
          tenant_id: "",
          scope: "https://graph.microsoft.com/.default",
          server_api: "",
          openvpn_config: ""
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      }
    }
  } catch (error) {
    console.error('Erro ao carregar configurações:', error);
    logger.logSystemError('CONFIG_LOAD', error);
    config = {
      client_id: "",
      tenant_id: "",
      scope: "https://graph.microsoft.com/.default",
      server_api: "",
      openvpn_config: ""
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  logger.log('AZURE', 'CLIENT_CONFIGURED', {
    hasClientId: !!config.client_id,
    hasTenantId: !!config.tenant_id,
    scope: config.scope,
    serverApi: config.server_api
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (isVpnSessionActive()) {
      logger.log('SYSTEM', 'WINDOW_ALL_CLOSED_QUIT_BLOCKED_VPN_ACTIVE', { trackedPid: getTrackedVpnPid() });
      return;
    }
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isVpnSessionActive()) {
    event.preventDefault();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('vpn-status', 'Desconecte da VPN antes de sair do aplicativo.');
    }

    logger.log('SYSTEM', 'APP_QUIT_BLOCKED_VPN_ACTIVE', { trackedPid: getTrackedVpnPid() });
  }
});

// ============ FUNÇÕES AUXILIARES ============

async function checkPkexecAvailable() {
  return new Promise((resolve) => {
    exec('which pkexec', (error) => {
      resolve(!error);
    });
  });
}

async function fileExists(filePath) {
  try {
    await fsAsync.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateOvpnFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'Caminho do arquivo OVPN não informado' };
  }

  try {
    const stats = await fsAsync.stat(filePath);
    if (!stats.isFile()) {
      return { valid: false, error: `Caminho selecionado não é um arquivo regular: ${filePath}` };
    }

    if (path.extname(filePath).toLowerCase() !== '.ovpn') {
      return { valid: false, error: 'Arquivo inválido. Selecione um arquivo com extensão .ovpn' };
    }

    return { valid: true, stats };
  } catch (error) {
    return { valid: false, error: `Arquivo OVPN não encontrado ou inacessível: ${error.message}` };
  }
}

function hasInlineBlock(content, blockName) {
  const escapedName = String(blockName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*<${escapedName}>\\s*$[\\s\\S]*?^\\s*</${escapedName}>\\s*$`, 'im').test(String(content || ''));
}

function hasDirective(content, directiveName) {
  const escapedName = String(directiveName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${escapedName}(?:\\s|$)`, 'im').test(String(content || ''));
}

function hasClientCertDisabled(content) {
  return /^\s*setenv\s+CLIENT_CERT\s+0\b/im.test(String(content || ''));
}

function validateOvpnContent(content) {
  const ovpnContent = String(content || '');
  const lineCount = ovpnContent.split(/\r?\n/).length;
  const hasRemote = hasDirective(ovpnContent, 'remote');
  const hasClientMode = hasDirective(ovpnContent, 'client') || hasDirective(ovpnContent, 'tls-client') || hasDirective(ovpnContent, 'dev');
  const hasAuthUserPass = hasDirective(ovpnContent, 'auth-user-pass');
  const hasCa = hasDirective(ovpnContent, 'ca') || hasInlineBlock(ovpnContent, 'ca');
  const hasCert = hasDirective(ovpnContent, 'cert') || hasInlineBlock(ovpnContent, 'cert');
  const hasKey = hasDirective(ovpnContent, 'key') || hasInlineBlock(ovpnContent, 'key');
  const clientCertDisabled = hasClientCertDisabled(ovpnContent);
  const hasTlsAuth = hasDirective(ovpnContent, 'tls-auth') || hasInlineBlock(ovpnContent, 'tls-auth');

  if (!hasRemote) {
    return { valid: false, error: 'Configuração OVPN não possui servidor remoto (remote)' };
  }

  if (!hasClientMode) {
    return { valid: false, error: 'Configuração OVPN não possui indicação de modo cliente (client, tls-client ou dev)' };
  }

  if (!hasCa) {
    return { valid: false, error: 'Configuração OVPN não possui certificado CA (ca arquivo ou bloco <ca>)' };
  }

  if (!clientCertDisabled && (hasCert !== hasKey)) {
    return { valid: false, error: 'Configuração OVPN possui cert/key incompletos. Use cert e key juntos ou setenv CLIENT_CERT 0' };
  }

  return {
    valid: true,
    metadata: {
      lineCount,
      size: ovpnContent.length,
      hasRemote,
      hasClientMode,
      hasAuthUserPass,
      hasCa,
      hasCert,
      hasKey,
      clientCertDisabled,
      hasTlsAuth
    }
  };
}

async function validateOvpnFileForImport(filePath) {
  const pathValidation = await validateOvpnFilePath(filePath);
  if (!pathValidation.valid) {
    return pathValidation;
  }

  try {
    const content = await fsAsync.readFile(filePath, 'utf-8');
    const contentValidation = validateOvpnContent(content);
    if (!contentValidation.valid) {
      return contentValidation;
    }

    return { valid: true, content, metadata: { ...contentValidation.metadata, fileSize: pathValidation.stats.size } };
  } catch (error) {
    return { valid: false, error: `Erro ao ler arquivo OVPN: ${error.message}` };
  }
}

function validateAzureOvpnTags(ovpnContent) {
  const azureTagRegex = /^\s*#AZURE:\s*([^=\s]+)\s*=\s*(.+?)\s*$/gim;
  const foundTags = new Set();
  let match;

  while ((match = azureTagRegex.exec(String(ovpnContent || ''))) !== null) {
    foundTags.add(String(match[1] || '').trim().toLowerCase());
  }

  if (foundTags.size === 0) {
    return {
      valid: false,
      error: 'Configuração não compatível com perfil Azure/Entra ID. O arquivo .ovpn deve conter tags #AZURE de configuração.'
    };
  }

  const requiredTags = ['client_id', 'tenant_id', 'scope', 'server_api'];
  const missingTags = requiredTags.filter(tag => !foundTags.has(tag));

  return {
    valid: true,
    foundTags: Array.from(foundTags),
    missingTags
  };
}

function parseOvpnFileDirective(line, fileDirectives) {
  const match = String(line || '').match(/^\s*([^\s#;]+)\s+(.+)$/);
  if (!match) return null;

  const directiveName = match[1];
  if (!fileDirectives.includes(directiveName)) return null;

  let rest = match[2].trimStart();
  let fileNamePart = '';
  let extraParams = '';

  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quote = rest[0];
    let escaped = false;
    let endIndex = -1;
    for (let i = 1; i < rest.length; i++) {
      const char = rest[i];
      if (char === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      if (char === quote && !escaped) {
        endIndex = i;
        break;
      }
      escaped = false;
    }

    if (endIndex === -1) {
      fileNamePart = rest.slice(1);
      extraParams = '';
    } else {
      fileNamePart = rest.slice(1, endIndex).replace(/\\(["'])/g, '$1');
      extraParams = rest.slice(endIndex + 1).trim();
    }
  } else {
    const parts = rest.split(/\s+/);
    fileNamePart = parts[0];
    extraParams = parts.slice(1).join(' ');
  }

  return { directiveName, fileNamePart, extraParams };
}

function formatOvpnDirectivePath(filePath) {
  const normalizedPath = process.platform === 'win32' ? filePath.replace(/\\/g, '\\\\') : filePath;
  if (/\s|["']/.test(normalizedPath)) {
    return `"${normalizedPath.replace(/"/g, '\\"')}"`;
  }
  return normalizedPath;
}

async function readJsonWithBackup(filePath, fallbackValue, context = 'json_file') {
  if (!(await fileExists(filePath))) {
    return { success: true, data: fallbackValue, source: 'default' };
  }

  try {
    const raw = await fsAsync.readFile(filePath, 'utf-8');
    return { success: true, data: JSON.parse(raw), source: 'primary' };
  } catch (error) {
    const backupPath = `${filePath}.bak`;
    logger.logSystemError('JSON_READ_PARSE_FAILED', error, { filePath, context, backupPath });

    if (await fileExists(backupPath)) {
      try {
        const backupRaw = await fsAsync.readFile(backupPath, 'utf-8');
        const backupData = JSON.parse(backupRaw);
        await fsAsync.writeFile(filePath, JSON.stringify(backupData, null, 2));
        logger.log('SYSTEM', 'JSON_RECOVERED_FROM_BACKUP', { filePath, backupPath, context });
        return { success: true, data: backupData, source: 'backup' };
      } catch (backupError) {
        logger.logSystemError('JSON_BACKUP_RECOVERY_FAILED', backupError, { filePath, backupPath, context });
      }
    }

    return { success: false, error: error.message };
  }
}

async function writeJsonWithBackup(filePath, data, context = 'json_file') {
  const backupPath = `${filePath}.bak`;

  try {
    if (await fileExists(filePath)) {
      await fsAsync.copyFile(filePath, backupPath);
    }

    await fsAsync.writeFile(filePath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    logger.logSystemError('JSON_WRITE_FAILED', error, { filePath, backupPath, context });
    return { success: false, error: error.message };
  }
}

function shouldEnableExplicitExitNotify(ovpnContent = '') {
  const content = String(ovpnContent || '');

  // Evitar duplicidade se já estiver definido no perfil
  if (/^\s*explicit-exit-notify\b/im.test(content)) {
    return false;
  }

  // Se protocolo TCP está explícito, não aplica
  if (/^\s*proto\s+tcp/i.test(content)) {
    return false;
  }

  // Para UDP explícito ou default (sem proto definido), habilitar
  return true;
}

async function loadOvnFromProfile(profileId, preferredType = null) {
  console.log(`🔍 Iniciando busca por arquivo OVPN para perfil: ${profileId}`);

  const userProfilesRead = await readJsonWithBackup(USER_PROFILES_PATH, [], 'user_profiles');
  const azureProfilesRead = await readJsonWithBackup(AZURE_PROFILES_PATH, [], 'azure_profiles');

  const userProfiles = Array.isArray(userProfilesRead.data) ? userProfilesRead.data : [];
  const azureProfiles = Array.isArray(azureProfilesRead.data) ? azureProfilesRead.data : [];

  const profileCollections = preferredType === 'user'
    ? [userProfiles, azureProfiles]
    : preferredType === 'azure'
      ? [azureProfiles, userProfiles]
      : [userProfiles, azureProfiles];

  for (const profiles of profileCollections) {
    const selectedProfile = profiles.find((p) => p && p.id === profileId);
    if (!selectedProfile?.ovpnFile) {
      continue;
    }

    if (await fileExists(selectedProfile.ovpnFile)) {
      try {
        const content = await fsAsync.readFile(selectedProfile.ovpnFile, 'utf-8');
        const profileDir = path.dirname(selectedProfile.ovpnFile);
        console.log(`✅ Arquivo OVPN encontrado via metadata do perfil: ${selectedProfile.ovpnFile}`);
        return {
          success: true,
          content,
          path: selectedProfile.ovpnFile,
          profileDir,
          profileName: selectedProfile.name || selectedProfile.ovpnFileName || selectedProfile.id || profileId
        };
      } catch (error) {
        console.log(`⚠️ Falha ao ler OVPN via metadata (${selectedProfile.ovpnFile}): ${error.message}`);
      }
    }
  }
  
  const searchDirs = preferredType === 'user'
    ? [PROFILES_DIR, AZURE_PROFILES_DIR]
    : preferredType === 'azure'
      ? [AZURE_PROFILES_DIR, PROFILES_DIR]
      : [PROFILES_DIR, AZURE_PROFILES_DIR];

  const possibleFilenames = [
    `${profileId}.ovpn`,
    `${profileId}.conf`,
    `config.ovpn`,
    `client.ovpn`
  ];

  for (const baseDir of searchDirs) {
    console.log(`📁 Verificando diretório base: ${baseDir}`);
    
    const profileDir = path.join(baseDir, profileId);
    for (const filename of possibleFilenames) {
      const filePath = path.join(profileDir, filename);
      console.log(`   🔎 Tentando: ${filePath}`);
      
      try {
        if (await fileExists(filePath)) {
          const content = await fsAsync.readFile(filePath, 'utf-8');
          console.log(`✅ Arquivo OVPN encontrado: ${filePath}`);
          return { 
            success: true, 
            content: content, 
            path: filePath,
            profileDir: profileDir 
          };
        }
      } catch (error) {
        console.log(`   ❌ Erro ao acessar ${filePath}: ${error.message}`);
      }
    }
    
    if (!preferredType) {
      for (const filename of possibleFilenames) {
        const filePath = path.join(baseDir, filename);
        console.log(`   🔎 Tentando: ${filePath}`);
        
        try {
          if (await fileExists(filePath)) {
            const content = await fsAsync.readFile(filePath, 'utf-8');
            console.log(`✅ Arquivo OVPN encontrado: ${filePath}`);
            return { 
              success: true, 
              content: content, 
              path: filePath,
              profileDir: baseDir 
            };
          }
        } catch (error) {
          console.log(`   ❌ Erro ao acessar ${filePath}: ${error.message}`);
        }
      }
    }
  }
  
  console.log(`❌ Arquivo OVPN não encontrado em nenhum local para perfil: ${profileId}`);
  return { 
    success: false, 
    error: `Arquivo OVPN não encontrado para o perfil ${profileId}. Verifique se o arquivo existe.` 
  };
}

// ============ FUNÇÃO PARA PROCESSAR ARQUIVOS OVPN ============

async function processAndCopyOvpnFiles(originalOvpnPath, profileId, baseDir = null) {
  const ovpnDir = baseDir || PROFILES_DIR;
  const profileDir = path.join(ovpnDir, profileId);

  try {
    await fsAsync.mkdir(profileDir, { recursive: true });

    const originalContent = await fsAsync.readFile(originalOvpnPath, 'utf-8');
    const originalDir = path.dirname(originalOvpnPath);
    const originalLineCount = originalContent.split('\n').length;

    console.log(`📂 Processando arquivo OVPN: ${originalOvpnPath}`);
    console.log(`📁 Diretório do perfil: ${profileDir}`);
    console.log(`📄 Metadados OVPN original: ${originalLineCount} linhas, ${Buffer.byteLength(originalContent, 'utf8')} bytes`);

    const processedLines = [];
    const filesToCopy = new Set();

    const azureConfig = {
      client_id: null,
      tenant_id: null,
      scope: null,
      server_api: null
    };
    
    const fileDirectives = ['ca', 'cert', 'key', 'tls-auth', 'tls-crypt', 'pkcs12', 'dh', 'extra-certs', 'crl-verify'];
    const inlineBlockStartRegex = /^\s*<([a-zA-Z0-9_-]+)>\s*$/;
    const inlineBlockEndRegex = /^\s*<\/([a-zA-Z0-9_-]+)>\s*$/;
    let currentInlineBlock = null;

    const lines = originalContent.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i].replace(/\r$/, '');
      const trimmedLine = originalLine.trim();

      if (currentInlineBlock) {
        processedLines.push(originalLine);
        const blockEndMatch = trimmedLine.match(inlineBlockEndRegex);
        if (blockEndMatch && blockEndMatch[1].toLowerCase() === currentInlineBlock.toLowerCase()) {
          currentInlineBlock = null;
        }
        continue;
      }

      const blockStartMatch = trimmedLine.match(inlineBlockStartRegex);
      if (blockStartMatch) {
        currentInlineBlock = blockStartMatch[1];
        processedLines.push(originalLine);
        continue;
      }

      if (trimmedLine.startsWith('#AZURE:')) {
        const azureLine = trimmedLine.substring(7).trim();
        const [key, value] = azureLine.split('=').map(s => s.trim());

        if (key && value) {
          switch (key.toLowerCase()) {
            case 'client_id':
              azureConfig.client_id = value;
              console.log(`🔧 Configuração Azure extraída: client_id = ${value}`);
              break;
            case 'tenant_id':
              azureConfig.tenant_id = value;
              console.log(`🔧 Configuração Azure extraída: tenant_id = ${value}`);
              break;
            case 'scope':
              azureConfig.scope = value;
              console.log(`🔧 Configuração Azure extraída: scope = ${value}`);
              break;
            case 'server_api':
              azureConfig.server_api = value;
              console.log(`🔧 Configuração Azure extraída: server_api = ${value}`);
              break;
          }
        }
        processedLines.push(originalLine);
        continue;
      }

      if (/^keysize\b/i.test(trimmedLine)) {
        console.log('ℹ️ Diretiva keysize removida por compatibilidade com OpenVPN 2.6+:', trimmedLine);
        continue;
      }

      if (!trimmedLine || trimmedLine.startsWith('#')) {
        processedLines.push(originalLine);
        continue;
      }
      
      if (/^auth-user-pass\b/i.test(trimmedLine)) {
        continue;
      }

      let outputLine = originalLine;
      const parsedDirective = parseOvpnFileDirective(trimmedLine, fileDirectives);

      if (parsedDirective?.fileNamePart) {
        const { directiveName, fileNamePart, extraParams } = parsedDirective;
        console.log(`🔍 Processando diretiva externa: ${directiveName} (${fileNamePart})`);

        let absoluteSourcePath;

        if (path.isAbsolute(fileNamePart)) {
          absoluteSourcePath = fileNamePart;
        } else {
          const possiblePaths = [
            path.join(originalDir, fileNamePart),
            path.join(originalDir, '..', fileNamePart),
            path.join(__dirname, fileNamePart),
            fileNamePart
          ];

          for (const possiblePath of possiblePaths) {
            if (await fileExists(possiblePath)) {
              absoluteSourcePath = possiblePath;
              break;
            }
          }

          if (!absoluteSourcePath) {
            absoluteSourcePath = path.join(originalDir, fileNamePart);
          }
        }

        if (await fileExists(absoluteSourcePath)) {
          const fileName = path.basename(absoluteSourcePath);
          const targetFilePath = path.join(profileDir, fileName);

          filesToCopy.add({
            source: absoluteSourcePath,
            target: targetFilePath,
            directive: directiveName
          });

          outputLine = `${directiveName} ${formatOvpnDirectivePath(targetFilePath)}`;
          if (extraParams) {
            outputLine += ` ${extraParams}`;
          }

          console.log(`✅ Arquivo identificado: ${fileName} (${directiveName})`);
          console.log(`   Destino: ${targetFilePath}`);
        } else {
          console.error(`❌ Arquivo não encontrado: ${absoluteSourcePath}`);
          throw new Error(`Arquivo obrigatório não encontrado para ${directiveName}: ${fileNamePart}`);
        }
      }
      
      processedLines.push(outputLine);
    }
    
    for (let file of filesToCopy) {
      try {
        await fsAsync.copyFile(file.source, file.target);
        console.log(`✅ Arquivo copiado: ${path.basename(file.source)} -> ${file.target}`);
      } catch (copyError) {
        console.error(`❌ Erro ao copiar ${file.source}:`, copyError);
        throw copyError;
      }
    }
    
    if (!processedLines.some(line => /^\s*auth-user-pass\b/i.test(line))) {
      processedLines.push('auth-user-pass');
    }

    // Garante que 'dev tun' existe — perfis iOS/OpenVPN Connect não incluem essa diretiva
    // mas ela é obrigatória no Linux CLI. 'dev' pode ser 'dev tun', 'dev tap', 'dev tunX', etc.
    if (!processedLines.some(line => /^\s*dev\s+/i.test(line.trim()))) {
      // Insere no início para melhor compatibilidade (OpenVPN lê em ordem, mas dev é uma das primeiras diretivas esperadas)
      processedLines.unshift('dev tun');
    }
    
    const processedContent = processedLines.join('\n');
    const targetOvpnPath = path.join(profileDir, `${profileId}.ovpn`);
    await fsAsync.writeFile(targetOvpnPath, processedContent, 'utf-8');

    console.log(`📄 Configuração processada salva em: ${targetOvpnPath}`);
    console.log(`✅ Perfil OVPN processado salvo em: ${targetOvpnPath}`);
    console.log(`📄 Metadados OVPN processado: ${processedLines.length} linhas, ${Buffer.byteLength(processedContent, 'utf8')} bytes, arquivos externos copiados: ${filesToCopy.size}`);
    
    return {
      success: true,
      content: processedContent,
      profileDir: profileDir,
      filesCopied: filesToCopy.size,
      azureConfig: azureConfig
    };
    
  } catch (error) {
    console.error('❌ Erro ao processar perfil OVPN:', error);
    return { success: false, error: error.message };
  }
}

function detectTwoFactorRequirementFromOvpn(ovpnContent) {
  const staticChallengeMatch = ovpnContent.match(/static-challenge\s+"([^"]+)"\s+(\d)/gi);
  const hasStaticChallenge = staticChallengeMatch && staticChallengeMatch.length > 0;

  let promptText = '';
  if (hasStaticChallenge) {
    const promptMatch = ovpnContent.match(/static-challenge\s+"([^"]+)"/i);
    if (promptMatch && promptMatch[1]) {
      promptText = promptMatch[1];
    }
  }

  const usesAuthUserPass = /auth-user-pass/gi.test(ovpnContent);

  return {
    requires2FA: hasStaticChallenge && usesAuthUserPass,
    hasStaticChallenge: hasStaticChallenge,
    staticChallengeMatches: staticChallengeMatch,
    promptText: promptText,
    usesEcho: ovpnContent.includes('static-challenge') && ovpnContent.includes(' 1')
  };
}

// ============ DNS LEAK PROTECTION ============

const historyPath = path.join(app.getPath('userData'), 'connection_history.json');
let activeTunInterface = null;
let dnsLeakProtectionApplied = false;
let trafficStatsInterval = null;
let activeHistoryEntry = null;
let lastBytesIn = 0;
let lastBytesOut = 0;

function appendConnectionHistory(entry) {
  try {
    let history = [];
    if (fs.existsSync(historyPath)) {
      try { history = JSON.parse(fs.readFileSync(historyPath, 'utf-8')); } catch (_) { history = []; }
    }
    if (!Array.isArray(history)) history = [];
    const idx = history.findIndex(e => e.id === entry.id);
    if (idx >= 0) {
      history[idx] = entry;
    } else {
      history.push(entry);
    }
    if (history.length > 50) history = history.slice(history.length - 50);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  } catch (err) {
    console.log('⚠️ Erro ao salvar histórico:', err.message);
  }
}

function getConnectionHistory() {
  try {
    if (!fs.existsSync(historyPath)) return [];
    const raw = fs.readFileSync(historyPath, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function detectActiveTunInterface() {
  if (process.platform !== 'linux') return null;
  try {
    const out = execSync('ip link show', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 });
    const match = out.match(/\btun\d+\b/);
    return match ? match[0] : null;
  } catch (_) {
    return null;
  }
}

function readLinuxNetDevBytes(iface) {
  try {
    const content = fs.readFileSync('/proc/net/dev', 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(iface + ':')) {
        const parts = trimmed.split(':')[1].trim().split(/\s+/);
        const bytesIn = parseInt(parts[0], 10) || 0;
        const bytesOut = parseInt(parts[8], 10) || 0;
        return { bytesIn, bytesOut };
      }
    }
  } catch (_) {}
  return { bytesIn: 0, bytesOut: 0 };
}

function isValidIpv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function getDnsLeakProtectionSettings() {
  const settings = loadAppSettings();
  const dns = [];
  if (isValidIpv4(settings.primaryDns)) dns.push(settings.primaryDns.trim());
  if (isValidIpv4(settings.secondaryDns)) dns.push(settings.secondaryDns.trim());
  return {
    enabled: settings.dnsLeakProtectionEnabled === true,
    dns: dns.length ? dns : ['1.1.1.1', '1.0.0.1']
  };
}

async function applyDnsLeakProtection(tunInterface) {
  if (process.platform === 'linux' && tunInterface) {
    const settings = getDnsLeakProtectionSettings();
    if (!settings.enabled) {
      dnsLeakProtectionApplied = false;
      logger.log('VPN', 'DNS_LEAK_PROTECTION_SKIPPED', { tunInterface, reason: 'disabled' });
      return;
    }
    try {
      execFileSync('resolvectl', ['dns', tunInterface, ...settings.dns], { stdio: 'ignore', timeout: 3000 });
      dnsLeakProtectionApplied = true;
      logger.log('VPN', 'DNS_LEAK_PROTECTION_APPLIED', { tunInterface, dns: settings.dns });
    } catch (_) {}
  }
}

async function revertDnsLeakProtection(tunInterface) {
  if (process.platform === 'linux' && tunInterface && dnsLeakProtectionApplied) {
    try {
      execFileSync('resolvectl', ['revert', tunInterface], { stdio: 'ignore', timeout: 3000 });
      dnsLeakProtectionApplied = false;
      logger.log('VPN', 'DNS_LEAK_PROTECTION_REVERTED', { tunInterface });
    } catch (_) {}
  }
}

function startTrafficStats(profileName, profileType) {
  activeTunInterface = detectActiveTunInterface();
  lastBytesIn = 0;
  lastBytesOut = 0;

  const sendTrafficSnapshot = (stats, speedIn = 0, speedOut = 0) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('vpn-traffic-stats', {
      bytesIn: stats.bytesIn,
      bytesOut: stats.bytesOut,
      speedIn,
      speedOut
    });
    if (activeHistoryEntry) {
      activeHistoryEntry.bytesIn = stats.bytesIn;
      activeHistoryEntry.bytesOut = stats.bytesOut;
    }
  };

  if (activeTunInterface) {
    const initial = readLinuxNetDevBytes(activeTunInterface);
    lastBytesIn = initial.bytesIn;
    lastBytesOut = initial.bytesOut;
    sendTrafficSnapshot(initial);
  }

  if (trafficStatsInterval) clearInterval(trafficStatsInterval);

  trafficStatsInterval = setInterval(() => {
    if (!activeTunInterface) {
      activeTunInterface = detectActiveTunInterface();
      if (!activeTunInterface) return;
      const initial = readLinuxNetDevBytes(activeTunInterface);
      lastBytesIn = initial.bytesIn;
      lastBytesOut = initial.bytesOut;
      sendTrafficSnapshot(initial);
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const stats = readLinuxNetDevBytes(activeTunInterface);
    const speedIn = Math.max(0, stats.bytesIn - lastBytesIn);
    const speedOut = Math.max(0, stats.bytesOut - lastBytesOut);
    lastBytesIn = stats.bytesIn;
    lastBytesOut = stats.bytesOut;
    sendTrafficSnapshot(stats, speedIn, speedOut);
  }, 2000);
}

function stopTrafficStats(disconnectReason) {
  if (trafficStatsInterval) {
    clearInterval(trafficStatsInterval);
    trafficStatsInterval = null;
  }
  if (activeHistoryEntry) {
    activeHistoryEntry.endedAt = new Date().toISOString();
    const startMs = new Date(activeHistoryEntry.startedAt).getTime();
    activeHistoryEntry.durationSeconds = Math.round((Date.now() - startMs) / 1000);
    activeHistoryEntry.disconnectReason = disconnectReason || 'manual';
    activeHistoryEntry.status = 'completed';
    appendConnectionHistory(activeHistoryEntry);
    activeHistoryEntry = null;
  }
  if (activeTunInterface) {
    revertDnsLeakProtection(activeTunInterface).catch(() => {});
    activeTunInterface = null;
  }
}

ipcMain.handle('get-connection-history', () => getConnectionHistory());

// ============ CONEXÕES VPN ============

// Conexão OpenVPN com usuário/senha usando perfil
ipcMain.handle('connect-openvpn-userpass-profile', async (event, profileId, username, password, totpToken) => {
  return new Promise(async (resolve, reject) => {
    let authFilePath = null;
    let tempConfigPath = null;
    let runtimeConfigPath = null;
    let originalConfigPath = null;
    let challengeHandler = null;
    let challengeTimeout = null;
    let promiseSettled = false;
    let transientPassword = null;

    const cleanupTempConfig = () => {
      try {
        if (tempConfigPath && tempConfigPath !== originalConfigPath && fs.existsSync(tempConfigPath)) {
          fs.unlinkSync(tempConfigPath);
          console.log(`🧹 Configuração temporária removida: ${tempConfigPath}`);
        }
      } catch (cleanupError) {
        logger.logSystemError('TEMP_CONFIG_CLEANUP_FAILED', cleanupError, {
          connectionId,
          tempConfigPath
        });
      }
    };

    const resolveOnce = (value) => {
      if (promiseSettled) return;
      promiseSettled = true;
      transientPassword = null;
      cleanupTempConfig();
      if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;
      resolve(value);
    };

    const rejectOnce = (error) => {
      if (promiseSettled) return;
      promiseSettled = true;
      transientPassword = null;
      cleanupTempConfig();
      if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const connectionId = `conn_${profileId}_${Date.now()}`;
    suppressNextReconnect = false;

    try {
      logger.log('CONNECTION', 'START', {
        connectionId,
        profileId,
        profileType: 'user',
        connectionType: 'openvpn-userpass',
        username: username ? '***provided***' : 'empty',
        passwordLength: password ? password.length : 0,
        platform: process.platform,
        user: process.env.USER || 'unknown',
        timestamp: new Date().toISOString()
      });

      const ovpnResult = await loadOvnFromProfile(profileId, 'user');
      if (!ovpnResult.success) {
        console.error(`❌ Erro ao carregar perfil: ${ovpnResult.error}`);
        logger.log('CONNECTION', 'LOAD_PROFILE_FAILED', {
          connectionId,
          profileId,
          error: ovpnResult.error,
          step: 'load_ovpn_profile',
          profileDir: ovpnResult.profileDir || 'unknown'
        }, 'ERROR');
        rejectOnce(new Error(ovpnResult.error));
        return;
      }

      logger.log('CONNECTION', 'PROFILE_LOADED', {
        connectionId,
        profileId,
        configPath: ovpnResult.path,
        profileDir: ovpnResult.profileDir,
        configSize: ovpnResult.content ? ovpnResult.content.length : 0
      });

      const profileDir = ovpnResult.profileDir;
      const configPath = ovpnResult.path;
      originalConfigPath = configPath;
      runtimeConfigPath = configPath;
      const ovpnContent = ovpnResult.content || '';
      const hasStaticChallenge = /static-challenge/i.test(ovpnContent);
      const usesAuthUserPass = /^\s*auth-user-pass\b/im.test(ovpnContent);

      const normalizeCredentialValue = (value, { trim = false } = {}) => {
        let normalized = String(value ?? '');
        normalized = normalized.replace(/\0/g, '');
        normalized = normalized.replace(/[\r\n]+/g, '');
        return trim ? normalized.trim() : normalized;
      };

      const normalizedUsername = normalizeCredentialValue(username, { trim: true });
      const normalizedPassword = normalizeCredentialValue(password, { trim: false });
      const normalizedTotpToken = normalizeCredentialValue(totpToken, { trim: true });
      const preSubmittedTotp = hasStaticChallenge && usesAuthUserPass && !!normalizedTotpToken;
      const authRetryMode = preSubmittedTotp ? 'nointeract' : hasStaticChallenge ? 'interact' : 'nointeract';
      transientPassword = normalizedPassword;

      if (!normalizedUsername || !normalizedPassword) {
        rejectOnce(new Error('Usuário e senha são obrigatórios'));
        return;
      }

      logger.log('CONNECTION', 'CREDENTIALS_NORMALIZED', {
        connectionId,
        profileId,
        platform: process.platform,
        authFileLineEnding: 'LF',
        usernameChanged: normalizedUsername !== String(username ?? ''),
        passwordChanged: normalizedPassword !== String(password ?? ''),
        usernameLength: normalizedUsername.length,
        passwordLength: normalizedPassword.length
      });
      
      console.log(`📁 Diretório do perfil: ${profileDir}`);
      console.log(`📄 Configuração: ${configPath}`);

      if (preSubmittedTotp) {
        const tempConfigContent = ovpnContent
          .split(/\r?\n/)
          .filter((line) => !/^\s*static-challenge\b/i.test(line))
          .join('\n');
        tempConfigPath = path.join(profileDir, `openvpn_runtime_${Date.now()}.ovpn`);
        fs.writeFileSync(tempConfigPath, tempConfigContent, { encoding: 'utf8' });
        runtimeConfigPath = tempConfigPath;
        logger.log('CONNECTION', 'PRE_SUBMITTED_TOTP_CONFIG_PREPARED', {
          connectionId,
          profileId,
          originalConfigPath: configPath,
          runtimeConfigPath,
          staticChallengeRemoved: true,
          authRetryMode
        });
      }

        if (process.platform === 'win32') {
          try {
            const currentRuntimeContent = fs.readFileSync(runtimeConfigPath, 'utf-8');
            if (!/^\s*block-outside-dns\b/im.test(currentRuntimeContent)) {
              fs.writeFileSync(runtimeConfigPath, currentRuntimeContent + '\nblock-outside-dns\n', 'utf-8');
            }
          } catch (_) {}
        }

        authFilePath = path.join(profileDir, `openvpn_auth_${Date.now()}.txt`);
        const authLineBreak = '\n';
        const authPasswordLine = preSubmittedTotp ? `${normalizedPassword}|${normalizedTotpToken}` : normalizedPassword;
        const authFileContent = `${normalizedUsername}${authLineBreak}${authPasswordLine}${authLineBreak}`;
        fs.writeFileSync(authFilePath, authFileContent, { encoding: 'utf8' });

       if (process.platform !== 'win32') {
         fs.chmodSync(authFilePath, 0o600);
       }

       console.log(`🔐 Arquivo de autenticação criado: ${authFilePath}`);

        const openvpnArgs = [
          '--config', runtimeConfigPath,
          '--auth-user-pass', authFilePath,
          '--auth-retry', authRetryMode
        ];

        logger.log('CONNECTION', 'AUTH_RETRY_MODE', {
          connectionId,
          profileId,
          authRetryMode,
          hasStaticChallenge,
          usesAuthUserPass,
          preSubmittedTotp
        });

        if (shouldEnableExplicitExitNotify(ovpnContent)) {
         openvpnArgs.push('--explicit-exit-notify', '3');
         logger.log('CONNECTION', 'EXPLICIT_EXIT_NOTIFY_ENABLED', {
           connectionId,
           profileId,
           mode: 'userpass'
         });
       }

      console.log('🔐 Executando OpenVPN...');
     
      let openvpnCommand;
      let openvpnArgsFinal;
     
       let spawnOptions = {
         stdio: ['pipe', 'pipe', 'pipe'],
         env: { ...process.env, SYSTEMD_ASK_PASSWORD: '' }
       };

        if (process.platform === 'linux') {
           logger.log('CONNECTION', 'CHECK_ELEVATION_TOOLS', {
             connectionId,
             displayAvailable: !!process.env.DISPLAY,
             checkingPkexec: true
           });

           const pkexecAvailable = await checkPkexecAvailable();
           logger.log('CONNECTION', 'PKEXEC_AVAILABILITY', {
             connectionId,
             pkexecAvailable,
             displayEnv: process.env.DISPLAY || 'not_set'
           });

           const openvpnPath = await new Promise((resolve) => {
             exec('which openvpn', (error, stdout) => {
               if (error) {
                 logger.log('CONNECTION', 'OPENVPN_NOT_FOUND', {
                   connectionId,
                   error: error.message,
                   code: error.code
                 }, 'ERROR');
                 resolve('openvpn');
               } else {
                 const path = stdout.trim();
                 logger.log('CONNECTION', 'OPENVPN_FOUND', {
                   connectionId,
                   path,
                   versionCheck: true
                 });
                 resolve(path);
               }
             });
           });

           // Se já rodando como root (uid=0), sudo/pkexec são desnecessários e causam falha interativa
           const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

           if (isRoot) {
              openvpnCommand = openvpnPath;
              currentElevationMethod = 'direct';
              openvpnArgsFinal = openvpnArgs;
              logger.log('CONNECTION', 'ELEVATION_STRATEGY', {
                connectionId,
                strategy: 'direct_root',
                command: openvpnCommand,
                reason: 'process_already_root',
                elevationMethodStored: currentElevationMethod
              });
              console.log(`🔐 Processo já é root — invocando ${openvpnPath} diretamente`);
             } else if (process.env.DISPLAY && pkexecAvailable) {
                // Verificar se perfil tem static-challenge (2FA) — pkexec intercepta stdin e quebra o challenge
                if (hasStaticChallenge && !preSubmittedTotp) {
                 // 2FA detectado SEM pré-submissão: pkexec bloqueia stdin — usar sudo para preservar challenge flow
                 openvpnCommand = 'sudo';
                 currentElevationMethod = 'sudo';
                 openvpnArgsFinal = ['-n', openvpnPath, ...openvpnArgs];
                 logger.log('CONNECTION', 'ELEVATION_STRATEGY', {
                   connectionId,
                   strategy: 'sudo',
                   command: openvpnCommand,
                   args: openvpnArgsFinal.slice(0, 2),
                   reason: 'static_challenge_detected_pkexec_incompatible',
                   elevationMethodStored: currentElevationMethod
                 });
                 console.log(`🔐 2FA detectado (static-challenge sem pré-submissão) — usando sudo para preservar stdin`);
               } else {
                  // BUG2-FIX: pkexec deve receber openvpnPath diretamente (policy cobre /usr/bin/openvpn,
                  // não /usr/bin/stdbuf). SYSTEMD_ASK_PASSWORD já está em spawnOptions.env.
                  openvpnCommand = 'pkexec';
                  currentElevationMethod = 'pkexec';
                  openvpnArgsFinal = [openvpnPath, ...openvpnArgs];
                  logger.log('CONNECTION', 'ELEVATION_STRATEGY', {
                    connectionId,
                    strategy: 'pkexec',
                    command: openvpnCommand,
                    args: openvpnArgsFinal.slice(0, 2),
                    reason: 'display_and_pkexec_available',
                    elevationMethodStored: currentElevationMethod,
                    stdbufRemoved: true
                  });
                  console.log(`🔐 Usando pkexec ${openvpnPath} (SYSTEMD_ASK_PASSWORD via env, sem stdbuf)`);
                }
             } else {
               openvpnCommand = 'sudo';
               currentElevationMethod = 'sudo';
               openvpnArgsFinal = ['-n', openvpnPath, ...openvpnArgs];
               logger.log('CONNECTION', 'ELEVATION_STRATEGY', {
                 connectionId,
                 strategy: 'sudo',
                 command: openvpnCommand,
                 reason: process.env.DISPLAY ? 'pkexec_not_available' : 'no_display',
                 elevationMethodStored: currentElevationMethod
               });
               console.log(`🔐 Usando sudo -n com ${openvpnPath} para elevação`);
             }
         } else if (process.platform === 'win32') {
           // Detect OpenVPN installation path on Windows
           const pf64 = process.env['ProgramFiles'] || 'C:\\Program Files';
           const pf32 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
           const possiblePaths = [
             `${pf64}\\OpenVPN\\bin\\openvpn.exe`,
             `${pf32}\\OpenVPN\\bin\\openvpn.exe`,
             `${pf64}\\OpenVPN Connect\\openvpn.exe`,
             `${pf32}\\OpenVPN Connect\\openvpn.exe`,
             'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe',
             'C:\\Program Files (x86)\\OpenVPN\\bin\\openvpn.exe',
           ];

          let openvpnPath = null;
          for (const path of possiblePaths) {
            if (fs.existsSync(path)) {
              openvpnPath = path;
              break;
            }
          }

          if (!openvpnPath) {
            // Try to find via registry or PATH
            try {
              const { execSync } = require('child_process');
              const result = execSync('where openvpn.exe 2>nul', { encoding: 'utf8' });
              openvpnPath = result.trim().split('\n')[0];
            } catch (e) {
              logger.log('CONNECTION', 'OPENVPN_NOT_FOUND_WINDOWS', {
                connectionId,
                searchedPaths: possiblePaths,
                error: 'OpenVPN executable not found'
              }, 'ERROR');
              // IS003: notifica o renderer para exibir link de download
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('openvpn-not-found', {
                  downloadUrl: 'https://openvpn.net/community-downloads/'
                });
              }
              rejectOnce(new Error('OpenVPN não encontrado. Baixe em: https://openvpn.net/community-downloads/'));
              return;
            }
          }

          logger.log('CONNECTION', 'OPENVPN_PATH_DETECTED', {
            connectionId,
            openvpnPath,
            method: 'path_detection'
          });

          // Use PowerShell to run OpenVPN with admin privileges
          // Try direct execution first (no elevation)
           openvpnCommand = openvpnPath;
           openvpnArgsFinal = openvpnArgs;
           spawnOptions.shell = false;

           logger.log('CONNECTION', 'ELEVATION_STRATEGY', {
             connectionId,
             strategy: 'direct_execution',
             openvpnPath,
             profileDir,
             platform: 'windows'
           });
            console.log(`🔐 Usando OpenVPN diretamente (sem elevação): ${openvpnPath}`);
            console.log('OpenVPN args:', openvpnArgsFinal.join(' '));
       } else {
         logger.log('CONNECTION', 'UNSUPPORTED_PLATFORM', {
           connectionId,
           platform: process.platform,
           supported: ['linux', 'win32']
         }, 'ERROR');
          throw new Error('Plataforma não suportada');
        }

          await disableKillSwitch();
          vpnProcess = spawn(openvpnCommand, openvpnArgsFinal, spawnOptions);
          vpnConnectionActive = true;

          currentOvpnPath = runtimeConfigPath;
          currentConnectionMeta = buildBluepexConnectionMeta({
            connectionId,
            profileId,
            profileType: 'user',
            configPath: runtimeConfigPath,
            originalConfigPath: configPath,
            authFilePath,
            vpnPid: vpnProcess.pid,
            wrapperPid: vpnProcess.pid
         });
         persistBluepexConnectionMeta(currentConnectionMeta);

         console.log(`🔌 [MAIN] Processo OpenVPN iniciado com PID: ${vpnProcess.pid}`);
        logger.logConnectionStart(profileId, 'user', 'openvpn-userpass');

        let connectionEstablished = false;
        let challengeDetected = false;
        let authFailed = false;
        let stdinReady = false;
        let tokenResponseSent = false;
         let stderrBuffer = '';

        const isSudoPasswordRequired = (text) => /sudo:.*password is required|sudo:.*a password is required|sudo: a terminal is required|sudo:.*no tty present/i.test(String(text || ''));

        const sudoPolicyError = 'OpenVPN com 2FA local requer stdin preservado. O sudo -n exigiu senha/interação. Instale a policy/polkit do BluePex ou configure sudoers NOPASSWD para o OpenVPN.';

        const handleAuthFailure = (source) => {
          if (authFailed) return;
          authFailed = true;
          suppressNextReconnect = true;

          if (mainWindow && !mainWindow.isDestroyed()) {
            const authFailMsg = tokenResponseSent || preSubmittedTotp
              ? 'Token 2FA inválido ou expirado. Tente novamente.'
              : 'Falha de autenticação (usuário/senha incorretos)';
            mainWindow.webContents.send('vpn-status', authFailMsg);
          }

          ipcMain.removeAllListeners('send-challenge-response');
          if (connectionTimeout) clearTimeout(connectionTimeout);
          if (challengeTimeout) clearTimeout(challengeTimeout);

          logger.log('CONNECTION', 'AUTH_FAILED_DETECTED', {
            connectionId,
            profileId,
            source
          });

          // Mata via rotina BluePex específica/elevada; não usar vpnProcess.kill simples para pkexec/root.
          killVPNConnection().catch((killError) => {
            logger.logSystemError('AUTH_FAILED_KILL_FAILED', killError, {
              connectionId,
              profileId,
              source
            });
          });

          rejectOnce(new Error(preSubmittedTotp ? 'Token 2FA inválido ou expirado. Tente novamente.' : 'Falha na autenticação: usuário, senha ou token incorretos'));
        };

        const parseChallengeMessage = (text) => {
          const challengeMatch = text.match(/CHALLENGE:\s*([^\n\r]+)/);
          if (challengeMatch && challengeMatch[1]) {
            return challengeMatch[1].trim();
          }
          return 'Enter Google Authenticator Token';
        };

        const isChallengePrompt = (text) => {
          if (!text || typeof text !== 'string') return false;

          if (/CHALLENGE:/i.test(text) || /Enter Google Authenticator Token/i.test(text)) {
            return true;
          }

          if (process.platform === 'win32') {
            return /(static[-\s]?challenge|authenticator\s*token|verification\s*code)/i.test(text);
          }

          return false;
        };

       challengeHandler = (event, response) => {
         const responseText = typeof response === 'object' && response !== null ? String(response.response || '') : String(response || '');
         console.log('📤 Recebida resposta para desafio:', { responseLength: responseText.length, composeLocalMfa: hasStaticChallenge && usesAuthUserPass });
          if (vpnProcess && !vpnProcess.killed && challengeDetected) {
            const challengeResponse = hasStaticChallenge && usesAuthUserPass && transientPassword !== null
              ? `${transientPassword}|${responseText}`
              : responseText;
            vpnProcess.stdin.write(challengeResponse + '\n');
            challengeDetected = false;
            tokenResponseSent = true;
            transientPassword = null;
            if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;
            if (challengeTimeout) clearTimeout(challengeTimeout);

           connectionTimeout = setTimeout(() => {
             if (!connectionEstablished && vpnProcess && !vpnProcess.killed) {
               const errorMsg = 'Timeout na autenticação após token 2FA';
               console.error(`❌ ${errorMsg}`);
                rejectOnce(new Error(errorMsg));
              }
            }, 30000);
         }
       };

        const abortPendingConnection = (reason) => {
          if (!vpnProcess || vpnProcess.killed || connectionEstablished) {
            return;
          }

          console.log(`🛑 Encerrando tentativa de conexão pendente: ${reason}`);
          suppressNextReconnect = true;
          try {
            vpnProcess.kill('SIGTERM');
          } catch (_) {}
          transientPassword = null;
          if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;
          setTimeout(() => {
            if (vpnProcess && !vpnProcess.killed) {
              try {
                vpnProcess.kill('SIGKILL');
              } catch (_) {}
            }
          }, 1200);
        };

        let connectionTimeout = setTimeout(() => {
         if (!connectionEstablished && vpnProcess && !vpnProcess.killed && !challengeDetected) {
           const errorMsg = 'Timeout na conexão OpenVPN';
           console.error(`❌ ${errorMsg}`);
           ipcMain.removeAllListeners('send-challenge-response');
           transientPassword = null;
           if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;
           abortPendingConnection('timeout_conexao');
           rejectOnce(new Error(errorMsg));
         }
       }, 60000);

        vpnProcess.stdout.on('data', (data) => {
          const output = data.toString();
          console.log('OpenVPN stdout:', output);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('vpn-log', output);
          }

          if (!stdinReady) {
            stdinReady = true;
            console.log('🔄 OpenVPN stdin pronto para entrada');
           }

           if (output.includes('AUTH_FAILED') && !authFailed) {
             handleAuthFailure('stdout');
             return;
           }

          if ((output.includes('Initialization Sequence Completed') || output.includes('Connected')) && !connectionEstablished) {
           connectionEstablished = true;
            vpnConnectionActive = true;
            const bluepexPid = refreshTrackedBluepexPid(currentConnectionMeta) || vpnProcess.pid;
            currentConnectionMeta = { ...currentConnectionMeta, vpnPid: bluepexPid };
            persistBluepexConnectionMeta(currentConnectionMeta);
            console.log('✅ [MAIN] VPN conectada com sucesso!');
             logger.logConnectionSuccess(profileId, 'user', { pid: bluepexPid, wrapperPid: vpnProcess.pid });

              const userProfileName = ovpnResult.profileName || profileId;
              activeHistoryEntry = {
                id: connectionId,
                profileName: userProfileName,
               profileType: 'userpass',
               startedAt: new Date().toISOString(),
               endedAt: null,
               durationSeconds: 0,
               disconnectReason: null,
               bytesIn: 0,
               bytesOut: 0,
               status: 'active'
             };
             appendConnectionHistory(activeHistoryEntry);
             {
               const detectedTun = detectActiveTunInterface();
               if (detectedTun) {
                 activeTunInterface = detectedTun;
                 startTrafficStats(profileId, 'userpass');
                 applyDnsLeakProtection(detectedTun).catch(() => {});
               } else {
                 setTimeout(() => {
                   const t = detectActiveTunInterface();
                   if (t) activeTunInterface = t;
                   startTrafficStats(profileId, 'userpass');
                   if (activeTunInterface) applyDnsLeakProtection(activeTunInterface).catch(() => {});
                 }, 1500);
               }
             }

             mainWindow.webContents.send('vpn-connected', { pid: bluepexPid });
             startTunnelHealthCheck();
             resolveOnce({ pid: bluepexPid });

            if (connectionTimeout) clearTimeout(connectionTimeout);
            if (challengeTimeout) clearTimeout(challengeTimeout);
          }

        if (isChallengePrompt(output) && !challengeDetected && !authFailed) {
          console.log('🔐 Static challenge detectado!');
          challengeDetected = true;
          const challengeMessage = parseChallengeMessage(output);

          if (connectionTimeout) clearTimeout(connectionTimeout);

          mainWindow.webContents.send('vpn-challenge', {
            type: 'static-challenge',
            message: challengeMessage,
            requiresInput: true,
            usesEcho: /static-challenge\s+"[^"]+"\s+1/i.test(ovpnContent),
            usesAuthUserPass,
            composeLocalMfa: hasStaticChallenge && usesAuthUserPass,
            promptText: challengeMessage
          });
          currentLocalChallengeContext = {
            connectionId,
            profileId,
            composeLocalMfa: hasStaticChallenge && usesAuthUserPass,
            getPassword: () => transientPassword,
            submit: challengeHandler,
            abort: abortPendingConnection
          };

           challengeTimeout = setTimeout(() => {
             if (challengeDetected) {
               console.error('❌ Timeout no desafio 2FA');
               ipcMain.removeAllListeners('send-challenge-response');
               transientPassword = null;
               if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;
               if (mainWindow && !mainWindow.isDestroyed()) {
                 mainWindow.webContents.send('vpn-challenge-expired');
               }
               abortPendingConnection('timeout_desafio_2fa_stdout');
               rejectOnce(new Error('Timeout: Token 2FA não foi fornecido a tempo'));
             }
           }, 120000);
        }
       });

       vpnProcess.stderr.on('data', (data) => {
         const error = data.toString();
         stderrBuffer += error; // acumula stderr para diagnóstico no close
         console.error('OpenVPN stderr:', error);
         if (mainWindow && !mainWindow.isDestroyed()) {
           mainWindow.webContents.send('vpn-log', `ERRO: ${error}`);
         }

            if ((error.includes('AUTH_FAILED') || error.includes('auth-failure')) && !authFailed) {
              console.error(`❌ Falha na autenticação`);
              handleAuthFailure('stderr');
              return;
            }

          if (openvpnCommand === 'sudo' && isSudoPasswordRequired(error)) {
            console.error('❌ sudo -n requer senha/interação para OpenVPN com stdin preservado');
            abortPendingConnection('sudo_requer_senha');
            rejectOnce(new Error(sudoPolicyError));
            return;
          }

          if (isChallengePrompt(error) && !challengeDetected && !authFailed) {
            console.log('🔐 Static challenge detectado no stderr!', { error, challengeDetected, authFailed, stdinReady });
            challengeDetected = true;
            const challengeMessage = parseChallengeMessage(error);

           if (connectionTimeout) clearTimeout(connectionTimeout);

           mainWindow.webContents.send('vpn-challenge', {
             type: 'static-challenge',
             message: challengeMessage,
             requiresInput: true,
             usesEcho: /static-challenge\s+"[^"]+"\s+1/i.test(ovpnContent),
             usesAuthUserPass,
             composeLocalMfa: hasStaticChallenge && usesAuthUserPass,
             promptText: challengeMessage
           });
           currentLocalChallengeContext = {
             connectionId,
             profileId,
             composeLocalMfa: hasStaticChallenge && usesAuthUserPass,
             getPassword: () => transientPassword,
             submit: challengeHandler,
             abort: abortPendingConnection
           };

             challengeTimeout = setTimeout(() => {
               if (challengeDetected) {
                 console.error('❌ Timeout no desafio 2FA');
                 ipcMain.removeAllListeners('send-challenge-response');
                 transientPassword = null;
                 if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;
                 if (mainWindow && !mainWindow.isDestroyed()) {
                   mainWindow.webContents.send('vpn-challenge-expired');
                 }
                 abortPendingConnection('timeout_desafio_2fa_stderr');
                rejectOnce(new Error('Timeout: Token 2FA não foi fornecido a tempo'));
               }
             }, 120000);
           }
         });

         vpnProcess.on('close', (code) => {
           console.log(`OpenVPN encerrado com código ${code}`);
           const wasEstablished = connectionEstablished;
            vpnConnectionActive = false;
            vpnProcess = null;
            ipcMain.removeAllListeners('send-challenge-response');
            transientPassword = null;
            if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;
            if (wasEstablished) {
              const disconnReason = authFailed ? 'error' : (code !== 0 ? 'reconnect' : 'manual');
              stopTrafficStats(disconnReason);
            }
             if (wasEstablished && mainWindow && !mainWindow.isDestroyed()) {
               if (killSwitchEnabled && !suppressNextReconnect) { enableKillSwitch().catch(() => {}); }
               stopTunnelHealthCheck();

               mainWindow.webContents.send('vpn-disconnected');
             }

             if (connectionTimeout) clearTimeout(connectionTimeout);
             if (challengeTimeout) clearTimeout(challengeTimeout);
             cleanupTempConfig();

            if (code === 0) {
             logger.logConnectionDisconnect(profileId, 'user', 'normal_exit');
           } else {
             logger.logConnectionDisconnect(profileId, 'user', `exit_code_${code}`);
           }

             currentElevationMethod = null;
             currentOvpnPath = null;
             transientPassword = null;
             if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;
             clearBluepexConnectionMeta();

           const manualDisconnect = suppressNextReconnect;
           if (manualDisconnect) {
             console.log('🛑 [RF010] Reconexão automática ignorada: desconexão manual solicitada');
             suppressNextReconnect = false;
           }

           // RF010: reagendar conexão se caiu inesperadamente
            if (wasEstablished && code !== 0 && AUTO_RECONNECT.enabled && !authFailed && !manualDisconnect) {
              AUTO_RECONNECT.lastProfileId = profileId;
              AUTO_RECONNECT.lastProfileType = 'user';
              scheduleReconnect(profileId, 'user');
            }

            if (code !== 0 && stderrBuffer) {
              logger.log('CONNECTION', 'OPENVPN_STDERR_ON_EXIT', {
                connectionId,
                exitCode: code,
                stderr: stderrBuffer.slice(-2000) // últimos 2000 chars
              }, 'ERROR');
            }

             if (!wasEstablished && !authFailed) {
               rejectOnce(new Error(isSudoPasswordRequired(stderrBuffer) ? sudoPolicyError : `OpenVPN encerrou antes de conectar (código ${code})`));
             }

           try {
             if (authFilePath && fs.existsSync(authFilePath)) {
               fs.unlinkSync(authFilePath);
               console.log(`🧹 Arquivo de autenticação removido: ${authFilePath}`);
             }
           } catch (e) {
             console.log('Erro ao limpar arquivos:', e.message);
           }


       });

        vpnProcess.on('error', (error) => {
          // EPERM com syscall 'kill' é falso positivo do Node.js ao verificar PID de processo root.
          // O pkexec executou normalmente — o openvpn saiu por outro motivo (ver exit_code no 'close').
          if (error.code === 'EPERM' && error.syscall === 'kill') {
            console.log('⚠️ [CONN] EPERM kill ignorado (processo root, Node não pode verificar PID) — aguardando evento close para diagnóstico real');
            logger.log('CONNECTION', 'EPERM_KILL_IGNORED', {
              connectionId,
              note: 'EPERM_syscall_kill_is_nodejs_internal_pid_check_not_spawn_failure',
              pid: vpnProcess?.pid
            });
            return; // NÃO rejeitar a promise — aguarda evento 'close' com exit_code real
          }

          console.error('❌ Erro ao executar OpenVPN:', error);
          vpnConnectionActive = false;
          clearBluepexConnectionMeta();
          cleanupTempConfig();

          logger.log('CONNECTION', 'PROCESS_SPAWN_ERROR', {
            connectionId,
            profileId,
            errorCode: error.code,
            errorMessage: error.message,
            errno: error.errno,
            syscall: error.syscall,
            command: openvpnCommand,
            argsCount: openvpnArgsFinal.length,
            platform: process.platform,
            elevationStrategy: openvpnCommand === 'pkexec' ? 'pkexec' : openvpnCommand === 'sudo' ? 'sudo' : 'direct'
          }, 'ERROR');

          ipcMain.removeAllListeners('send-challenge-response');
          if (connectionTimeout) clearTimeout(connectionTimeout);
          if (challengeTimeout) clearTimeout(challengeTimeout);
          transientPassword = null;
          if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;

          try {
            if (authFilePath && fs.existsSync(authFilePath)) {
              fs.unlinkSync(authFilePath);
              logger.log('CONNECTION', 'AUTH_FILE_CLEANUP', {
                connectionId,
                authFilePath,
                cleanupSuccess: true
              });
            }
          } catch (cleanupError) {
            logger.logSystemError('AUTH_FILE_CLEANUP_FAILED', cleanupError, {
              connectionId,
              authFilePath
            });
            console.log('Erro ao limpar arquivos:', cleanupError.message);
          }

          let userFriendlyError;
          if (error.code === 'ENOENT') {
            userFriendlyError = 'OpenVPN não encontrado. Certifique-se de que o OpenVPN está instalado.';
            logger.log('CONNECTION', 'OPENVPN_NOT_INSTALLED', {
              connectionId,
              command: openvpnCommand,
              suggestion: 'install_openvpn'
            }, 'ERROR');
          } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            userFriendlyError = 'Permissões insuficientes para executar OpenVPN. Tente executar como administrador.';
            logger.log('CONNECTION', 'INSUFFICIENT_PERMISSIONS', {
              connectionId,
              command: openvpnCommand,
              errorCode: error.code,
              suggestion: 'run_as_admin'
            }, 'ERROR');
          } else if (error.code === 'ENOEXEC') {
            userFriendlyError = 'Erro na execução do comando de elevação. Verifique se pkexec/sudo estão instalados.';
            logger.log('CONNECTION', 'ELEVATION_EXEC_ERROR', {
              connectionId,
              command: openvpnCommand,
              errorCode: error.code,
              suggestion: 'check_elevation_tools'
            }, 'ERROR');
          } else {
            userFriendlyError = `Erro ao executar OpenVPN: ${error.message}`;
            logger.log('CONNECTION', 'UNKNOWN_EXEC_ERROR', {
              connectionId,
              command: openvpnCommand,
              errorCode: error.code,
              errorMessage: error.message
            }, 'ERROR');
          }

          rejectOnce(new Error(userFriendlyError));
       });

   } catch (error) {
     console.error(`❌ Erro na conexão:`, error);
     ipcMain.removeAllListeners('send-challenge-response');
     if (challengeTimeout) clearTimeout(challengeTimeout);
     transientPassword = null;
     if (currentLocalChallengeContext?.connectionId === connectionId) currentLocalChallengeContext = null;
    
      try {
        if (authFilePath && fs.existsSync(authFilePath)) {
          fs.unlinkSync(authFilePath);
        }
       cleanupTempConfig();
      } catch (e) {
       console.log('Erro ao limpar arquivo de auth:', e.message);
     }
    
     rejectOnce(error);
    }
  });
});

// Nova função para enviar resposta de desafio
ipcMain.handle('send-challenge-response', async (event, response) => {
  if (currentLocalChallengeContext?.submit) {
    currentLocalChallengeContext.submit(event, response);
    return { success: true };
  }
  if (vpnProcess && !vpnProcess.killed) {
    vpnProcess.stdin.write(response + '\n');
    return { success: true };
  }
  return { success: false, error: 'Processo VPN não encontrado' };
});

ipcMain.handle('cancel-challenge-response', async () => {
  if (currentLocalChallengeContext?.abort) {
    const context = currentLocalChallengeContext;
    currentLocalChallengeContext = null;
    context.abort('desafio_2fa_cancelado');
    return { success: true };
  }
  return { success: false, error: 'Desafio 2FA não encontrado' };
});

ipcMain.handle('cancel-challenge', async () => {
  if (currentLocalChallengeContext) {
    const ctx = currentLocalChallengeContext;
    currentLocalChallengeContext = null;
    if (ctx.abort) ctx.abort('desafio_2fa_timer_expirado_renderer');
  }
  if (vpnProcess && !vpnProcess.killed) {
    vpnProcess.kill('SIGTERM');
  }
  return { success: true };
});

// Handler para senha do sudo
ipcMain.handle('send-sudo-password', async (event, password) => {
  if (vpnProcess && !vpnProcess.killed) {
    vpnProcess.stdin.write(password + '\n');
    return { success: true };
  }
  return { success: false, error: 'Processo VPN não encontrado' };
});

// ============ GESTÃO DE PERFIS USUÁRIO ============

ipcMain.handle('select-ovpn-file', async () => {
  console.log('Handler select-ovpn-file chamado, mainWindow:', !!mainWindow);
  if (mainWindow) {
    console.log('mainWindow.isVisible():', mainWindow.isVisible());
  }
  console.log('Chamando dialog.showOpenDialog');
  const result = await dialog.showOpenDialog({
    title: 'Selecionar arquivo OVPN',
    properties: ['openFile'],
    filters: [
      { name: 'Arquivos OpenVPN', extensions: ['ovpn'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ]
  });
  console.log('Dialog result:', result);

  if (result.canceled) {
    console.log('Dialog cancelado');
    return { success: false, error: 'Seleção cancelada' };
  }

  if (!result.filePaths || result.filePaths.length === 0) {
    console.log('Nenhum arquivo selecionado');
    return { success: false, error: 'Nenhum arquivo selecionado' };
  }

  const filePath = result.filePaths[0];
  console.log('Arquivo selecionado:', filePath);

  try {
    const validation = await validateOvpnFileForImport(filePath);
    if (!validation.valid) {
      console.warn('Arquivo OVPN rejeitado:', { filePath, error: validation.error });
      return { success: false, error: validation.error };
    }

    const content = validation.content;
    const fileName = path.parse(filePath).name;

    console.log('Arquivo OVPN validado com sucesso:', { filePath, fileName, metadata: validation.metadata });
    return {
      success: true,
      filePath: filePath,
      fileName: fileName,
      content: content
    };
  } catch (error) {
    console.error('Erro ao ler arquivo:', error);
    return { success: false, error: `Erro ao ler arquivo: ${error.message}` };
  }
});

ipcMain.handle('save-ovpn-to-profile', async (event, profileId, ovpnContent, ovpnFileName, originalOvpnPath) => {
  const profilesPath = USER_PROFILES_PATH;

  try {
    console.log('Handler save-ovpn-to-profile chamado:', { profileId, ovpnFileName, originalOvpnPath, profilesPath });
    logger.log('PROFILE', 'SAVE_START', {
      profileId,
      ovpnFileName,
      originalOvpnPath,
      profilesPath,
      operation: 'save_ovpn_to_profile'
    });

    const ovpnValidation = await validateOvpnFileForImport(originalOvpnPath);
    if (!ovpnValidation.valid) {
      logger.log('PROFILE', 'ORIGINAL_FILE_NOT_FOUND', {
        profileId,
        ovpnFileName,
        originalOvpnPath,
        error: ovpnValidation.error
      }, 'ERROR');
      return { success: false, error: ovpnValidation.error };
    }

    const processResult = await processAndCopyOvpnFiles(originalOvpnPath, profileId);
    if (!processResult.success) {
      logger.log('PROFILE', 'PROCESS_OVPN_FAILED', {
        profileId,
        ovpnFileName,
        originalOvpnPath,
        error: processResult.error,
        operation: 'process_and_copy_files'
      }, 'ERROR');
      return { success: false, error: processResult.error };
    }

    console.log(`✅ Perfil salvo: ${profileId}`);
    console.log(`📁 Diretório: ${processResult.profileDir}`);

    const twoFactorMetadata = detectTwoFactorRequirementFromOvpn([
      processResult.content || '',
      ovpnValidation.content || ovpnContent || ''
    ].join('\n'));

    const profilesRead = await readJsonWithBackup(profilesPath, [], 'user_profiles');
    if (!profilesRead.success) {
      return { success: false, error: `Falha ao ler perfis de usuário: ${profilesRead.error}` };
    }
    let profiles = Array.isArray(profilesRead.data) ? profilesRead.data : [];

    const isNew = profiles.findIndex(p => p.id === profileId) === -1;
    const profileIndex = profiles.findIndex(p => p.id === profileId);

    if (profileIndex >= 0) {
      const previousProfile = profiles[profileIndex] || {};
      const newOvpnPath = path.join(processResult.profileDir, `${profileId}.ovpn`);
      const previousOvpnPath = previousProfile.ovpnFile;

      profiles[profileIndex].ovpnFile = newOvpnPath;
      profiles[profileIndex].ovpnFileName = ovpnFileName;
      profiles[profileIndex].profileDir = processResult.profileDir;
      profiles[profileIndex].requires2FA = !!twoFactorMetadata.requires2FA;
      profiles[profileIndex].twoFactorPrompt = twoFactorMetadata.promptText || '';
      profiles[profileIndex].twoFactorUsesEcho = !!twoFactorMetadata.usesEcho;
      profiles[profileIndex].updatedAt = new Date().toISOString();

      logger.log('PROFILE', 'PROFILE_UPDATED', {
        profileId,
        profileType: 'user',
        oldValues: {
          ovpnFile: profiles[profileIndex].ovpnFile,
          ovpnFileName: profiles[profileIndex].ovpnFileName,
          updatedAt: profiles[profileIndex].updatedAt
        },
        newValues: {
          ovpnFile: profiles[profileIndex].ovpnFile,
          ovpnFileName: ovpnFileName,
          filesCopied: processResult.filesCopied
        }
      });

      if (previousOvpnPath && previousOvpnPath !== newOvpnPath) {
        try {
          const previousDir = path.dirname(previousOvpnPath);
          if (previousDir !== processResult.profileDir && await fileExists(previousDir)) {
            await fsAsync.rm(previousDir, { recursive: true, force: true });
            logger.log('PROFILE', 'OLD_PROFILE_DIR_REMOVED', {
              profileId,
              oldDir: previousDir,
              newDir: processResult.profileDir
            });
          }
        } catch (cleanupError) {
          logger.logSystemError('PROFILE_PREVIOUS_DIR_CLEANUP_FAILED', cleanupError, {
            profileId,
            previousOvpnPath,
            newOvpnPath
          });
        }
      }
    } else {
      const newProfile = {
        id: profileId,
        name: ovpnFileName,
        type: 'user',
        ovpnFile: path.join(processResult.profileDir, `${profileId}.ovpn`),
        ovpnFileName: ovpnFileName,
        profileDir: processResult.profileDir,
        requires2FA: !!twoFactorMetadata.requires2FA,
        twoFactorPrompt: twoFactorMetadata.promptText || '',
        twoFactorUsesEcho: !!twoFactorMetadata.usesEcho,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      profiles.push(newProfile);

      logger.log('PROFILE', 'PROFILE_CREATED', {
        profileId,
        profileType: 'user',
        profileName: ovpnFileName,
        ovpnFile: newProfile.ovpnFile,
        profileDir: processResult.profileDir,
        filesCopied: processResult.filesCopied,
        totalProfiles: profiles.length
      });
    }

    const writeResult = await writeJsonWithBackup(profilesPath, profiles, 'user_profiles');
    if (!writeResult.success) {
      return { success: false, error: `Falha ao salvar perfis de usuário: ${writeResult.error}` };
    }

    logger.log('PROFILE', 'SAVE_SUCCESS', {
      profileId,
      profileType: 'user',
      isNew,
      filesCopied: processResult.filesCopied,
      profileDir: processResult.profileDir,
      totalProfiles: profiles.length
    });

    return {
      success: true,
      profileDir: processResult.profileDir,
      filesCopied: processResult.filesCopied
    };

  } catch (error) {
    console.error('Erro ao salvar perfil:', error);
    logger.logSystemError('PROFILE_SAVE_EXCEPTION', error, {
      profileId,
      ovpnFileName,
      originalOvpnPath,
      profilesPath,
      errorCode: error.code,
      errorMessage: error.message,
      stack: error.stack
    });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-user-profiles', async () => {
  const profilesPath = USER_PROFILES_PATH;
  try {
    const profilesRead = await readJsonWithBackup(profilesPath, [], 'user_profiles');
    if (!profilesRead.success) {
      return { success: false, error: profilesRead.error };
    }

    const profiles = Array.isArray(profilesRead.data) ? profilesRead.data : [];
    return { success: true, profiles };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-user-profile', async (event, profile) => {
  const profilesPath = USER_PROFILES_PATH;
  try {
    const profilesRead = await readJsonWithBackup(profilesPath, [], 'user_profiles');
    if (!profilesRead.success) {
      return { success: false, error: profilesRead.error };
    }

    let profiles = Array.isArray(profilesRead.data) ? profilesRead.data : [];

    const existingIndex = profiles.findIndex(p => p.id === profile.id);
    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }

    const writeResult = await writeJsonWithBackup(profilesPath, profiles, 'user_profiles');
    if (!writeResult.success) {
      return { success: false, error: writeResult.error };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-user-profile', async (event, profileId) => {
  const profilesPath = USER_PROFILES_PATH;
  const profileDir = path.join(PROFILES_DIR, profileId);

  try {
    logger.log('PROFILE', 'DELETE_START', { profileId, profileType: 'user' });

    let profileName = 'Unknown';
    if (await fileExists(profilesPath)) {
      const profilesRead = await readJsonWithBackup(profilesPath, [], 'user_profiles');
      if (!profilesRead.success) {
        return { success: false, error: profilesRead.error };
      }
      const profiles = Array.isArray(profilesRead.data) ? profilesRead.data : [];
      const profile = profiles.find((p) => p.id === profileId);
      if (profile) profileName = profile.name;
    }

    if (await fileExists(profileDir)) {
      await fsAsync.rm(profileDir, { recursive: true, force: true });
      logger.log('PROFILE', 'DIR_REMOVED', { profileId, profileDir });
    }

    const profilesRead = await readJsonWithBackup(profilesPath, [], 'user_profiles');
    if (!profilesRead.success) {
      return { success: false, error: profilesRead.error };
    }
    let profiles = Array.isArray(profilesRead.data) ? profilesRead.data : [];
    profiles = profiles.filter((p) => p.id !== profileId);
    const writeResult = await writeJsonWithBackup(profilesPath, profiles, 'user_profiles');
    if (!writeResult.success) {
      return { success: false, error: writeResult.error };
    }

    logger.logProfileDelete(profileId, 'user', profileName);
    return { success: true };
  } catch (error) {
    logger.logSystemError('PROFILE_DELETE', error, { profileId, profileType: 'user' });
    return { success: false, error: error.message };
  }
});

// ============ GESTÃO DE CREDENCIAIS SEGURAS ============

// Migração de credenciais antigas (Base64) para criptografia AES
async function migrateCredentials() {
  try {
    const credentialsRead = await readJsonWithBackup(USER_CREDENTIALS_PATH, {}, 'user_credentials');
    if (!credentialsRead.success) {
      return;
    }

    const credentials = credentialsRead.data && typeof credentialsRead.data === 'object' ? credentialsRead.data : {};
    let needsMigration = false;

    for (const profileId in credentials) {
      const creds = credentials[profileId];
      const isLegacyBase64 = creds.password && typeof creds.password === 'string';
      const isCurrentEncrypted = creds.password && typeof creds.password === 'object' && creds.password.iv && creds.password.authTag && creds.password.encrypted;

      if (isLegacyBase64 && !isCurrentEncrypted) {
        try {
          const decrypted = Buffer.from(creds.password, 'base64').toString('utf-8');
          creds.password = encrypt(decrypted);
          needsMigration = true;
          console.log(`🔐 Migrando credenciais para ${profileId}`);
        } catch (error) {
          console.error(`❌ Erro ao migrar credenciais para ${profileId}:`, error);
        }
      }
    }

    if (needsMigration) {
      await writeJsonWithBackup(USER_CREDENTIALS_PATH, credentials, 'user_credentials');
      console.log('✅ Migração de credenciais concluída');
    }
  } catch (error) {
    console.error('❌ Erro na migração de credenciais:', error);
  }
}

ipcMain.handle('save-user-credentials', async (event, profileId, username, password, rememberPassword) => {
  const credentialsPath = USER_CREDENTIALS_PATH;

  try {
    const credentialsRead = await readJsonWithBackup(credentialsPath, {}, 'user_credentials');
    if (!credentialsRead.success) {
      return { success: false, error: credentialsRead.error };
    }

    let credentials = credentialsRead.data && typeof credentialsRead.data === 'object' ? credentialsRead.data : {};

    const encryptedPassword = rememberPassword ? encrypt(password) : null;

    credentials[profileId] = {
      username: username,
      password: encryptedPassword,
      rememberPassword: rememberPassword,
      updatedAt: new Date().toISOString()
    };

    const writeResult = await writeJsonWithBackup(credentialsPath, credentials, 'user_credentials');
    if (!writeResult.success) {
      return { success: false, error: writeResult.error };
    }
    return { success: true };

  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-user-credentials', async (event, profileId) => {
  const credentialsPath = USER_CREDENTIALS_PATH;

  try {
    const credentialsRead = await readJsonWithBackup(credentialsPath, {}, 'user_credentials');
    if (!credentialsRead.success) {
      return { success: false, error: credentialsRead.error };
    }

    const credentials = credentialsRead.data && typeof credentialsRead.data === 'object' ? credentialsRead.data : {};
    if (credentials[profileId]) {
      const creds = credentials[profileId];
      if (creds.rememberPassword && creds.password) {
        creds.password = decrypt(creds.password);
        if (creds.password === null) {
          creds.password = '';
          creds.rememberPassword = false;
        }
      } else {
        creds.password = '';
      }
      return { success: true, credentials: creds };
    }
    return { success: true, credentials: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============ LOGOUT E LIMPEZA DE SESSÃO ============

ipcMain.handle('logout', async () => {
  try {
    const results = [];

    // 1. Remove token Azure em cache
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      results.push('token Azure removido');
    }

    // 2. Limpa estado da aplicação (PID, vpnConnected, etc.) mas preserva perfis selecionados
    if (fs.existsSync(APP_STATE_PATH)) {
      const state = JSON.parse(fs.readFileSync(APP_STATE_PATH, 'utf-8'));
      const cleanState = {
        selectedProfileId: state.selectedProfileId || null,
        selectedProfileType: state.selectedProfileType || null,
        lastSaved: new Date().toISOString()
      };
      fs.writeFileSync(APP_STATE_PATH, JSON.stringify(cleanState, null, 2));
      results.push('estado da sessão limpo');
    }

    // 3. Notifica o renderer para limpar UI
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-cleared');
    }

    logger.log('AUTH', 'LOGOUT', { cleared: results });
    return { success: true, cleared: results };
  } catch (error) {
    logger.logSystemError('LOGOUT', error);
    return { success: false, error: error.message };
  }
});

// ============ DETECÇÃO DE 2FA ============

ipcMain.handle('detect-2fa-requirement', async (event, profileId) => {
  try {
    const ovpnResult = await loadOvnFromProfile(profileId, 'user');
    if (!ovpnResult.success) {
      return { success: false, error: ovpnResult.error };
    }

    const ovpnContent = ovpnResult.content;
    const twoFactorRequirement = detectTwoFactorRequirementFromOvpn(ovpnContent);

    return { 
      success: true, 
      requires2FA: twoFactorRequirement.requires2FA,
      hasStaticChallenge: twoFactorRequirement.hasStaticChallenge,
      staticChallengeMatches: twoFactorRequirement.staticChallengeMatches,
      promptText: twoFactorRequirement.promptText,
      usesEcho: twoFactorRequirement.usesEcho
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('prepare-linux-elevation', async (event, profileId) => {
  if (process.platform !== 'linux') {
    return { success: true, skipped: true, platform: process.platform };
  }

  try {
    await ensurePolkitRules();
    const policyDest = '/usr/share/polkit-1/actions/com.bpvpn.pkexec.policy';
    const rulesDest  = '/usr/share/polkit-1/rules.d/com.bluepex.vpn.rules';
    const pkexecAvailable = await checkPkexecAvailable();
    const ready = fs.existsSync(policyDest) && fs.existsSync(rulesDest);
    const openvpnPath = await new Promise((resolve) => {
      exec('which openvpn', (error, stdout) => {
        if (error) resolve('openvpn');
        else resolve(stdout.trim() || 'openvpn');
      });
    });
    const preauthResult = await new Promise((resolve) => {
      if (!pkexecAvailable) {
        resolve({ ok: false, reason: 'pkexec_unavailable' });
        return;
      }

      execFile('pkexec', [openvpnPath, '--version'], { timeout: 15000 }, (error) => {
        if (error) {
          resolve({
            ok: false,
            reason: error.killed ? 'timeout' : 'pkexec_failed',
            code: error.code || null,
            signal: error.signal || null
          });
          return;
        }

        resolve({ ok: true });
      });
    });

    logger.log('SYSTEM', 'LINUX_ELEVATION_PREPARED', {
      profileId,
      pkexecAvailable,
      polkitRulesReady: ready,
      displayAvailable: !!process.env.DISPLAY,
      openvpnPath,
      preauthOk: preauthResult.ok,
      preauthFailure: preauthResult.ok ? null : {
        reason: preauthResult.reason,
        code: preauthResult.code,
        signal: preauthResult.signal
      }
    });

    return { success: true, pkexecAvailable, polkitRulesReady: ready, openvpnPath, preauthOk: preauthResult.ok };
  } catch (error) {
    logger.logSystemError('LINUX_ELEVATION_PREPARE_FAILED', error, { profileId });
    return { success: true, preauthOk: false, error: error.message };
  }
});

// ============ GESTÃO DE CONFIGURAÇÕES AZURE AD ============

ipcMain.handle('save-azure-config', async (event, profileId, ovpnContent, ovpnFileName, originalOvpnPath) => {
  const azureProfilesPath = AZURE_PROFILES_PATH;
  const azureOvpnDir = AZURE_PROFILES_DIR;

  try {
    const ovpnValidation = await validateOvpnFileForImport(originalOvpnPath);
    if (!ovpnValidation.valid) {
      return { success: false, error: ovpnValidation.error };
    }

    const azureTagsValidation = validateAzureOvpnTags(ovpnValidation.content || ovpnContent);
    if (!azureTagsValidation.valid) {
      return { success: false, error: azureTagsValidation.error };
    }

    if (azureTagsValidation.missingTags?.length) {
      console.warn(`⚠️ Perfil Azure com tags #AZURE incompletas: ${azureTagsValidation.missingTags.join(', ')}`);
    }

    const processResult = await processAndCopyOvpnFiles(originalOvpnPath, profileId, azureOvpnDir);
    if (!processResult.success) {
      return { success: false, error: processResult.error };
    }

    if (processResult.azureConfig) {
      const configPath = CONFIG_PATH;
      const currentConfig = JSON.parse(await fsAsync.readFile(configPath, 'utf-8'));

      if (processResult.azureConfig.client_id) {
        currentConfig.client_id = processResult.azureConfig.client_id;
        console.log(`💾 Client ID salvo: ${processResult.azureConfig.client_id}`);
      }
      if (processResult.azureConfig.tenant_id) {
        currentConfig.tenant_id = processResult.azureConfig.tenant_id;
        console.log(`💾 Tenant ID salvo: ${processResult.azureConfig.tenant_id}`);
      }
      if (processResult.azureConfig.scope) {
        currentConfig.scope = processResult.azureConfig.scope;
        console.log(`💾 Scope salvo: ${processResult.azureConfig.scope}`);
      }
      if (processResult.azureConfig.server_api) {
        currentConfig.server_api = processResult.azureConfig.server_api;
        console.log(`💾 Server API salvo: ${processResult.server_api}`);
      }

      await fsAsync.writeFile(configPath, JSON.stringify(currentConfig, null, 2));
      console.log(`✅ Configurações Azure salvas no config.json`);
    }

    console.log(`✅ Perfil Azure salvo: ${profileId}`);

    const azureProfilesRead = await readJsonWithBackup(azureProfilesPath, [], 'azure_profiles');
    if (!azureProfilesRead.success) {
      return { success: false, error: `Falha ao ler perfis Azure: ${azureProfilesRead.error}` };
    }
    let azureProfiles = Array.isArray(azureProfilesRead.data) ? azureProfilesRead.data : [];

    const profileIndex = azureProfiles.findIndex(p => p.id === profileId);
    if (profileIndex >= 0) {
      azureProfiles[profileIndex].ovpnFile = path.join(processResult.profileDir, `${profileId}.ovpn`);
      azureProfiles[profileIndex].ovpnFileName = ovpnFileName;
      azureProfiles[profileIndex].profileDir = processResult.profileDir;
      azureProfiles[profileIndex].azureConfig = processResult.azureConfig || null;
      azureProfiles[profileIndex].updatedAt = new Date().toISOString();
    } else {
      azureProfiles.push({
        id: profileId,
        name: `Azure ${ovpnFileName}`,
        ovpnFile: path.join(processResult.profileDir, `${profileId}.ovpn`),
        ovpnFileName: ovpnFileName,
        profileDir: processResult.profileDir,
        azureConfig: processResult.azureConfig || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    const azureWriteResult = await writeJsonWithBackup(azureProfilesPath, azureProfiles, 'azure_profiles');
    if (!azureWriteResult.success) {
      return { success: false, error: `Falha ao salvar perfis Azure: ${azureWriteResult.error}` };
    }

    config.openvpn_config = path.join(processResult.profileDir, `${profileId}.ovpn`);
    if (processResult.azureConfig?.client_id) config.client_id = processResult.azureConfig.client_id;
    if (processResult.azureConfig?.tenant_id) config.tenant_id = processResult.azureConfig.tenant_id;
    if (processResult.azureConfig?.scope) config.scope = processResult.azureConfig.scope;
    if (processResult.azureConfig?.server_api) config.server_api = processResult.azureConfig.server_api;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));



    return {
      success: true,
      profileDir: processResult.profileDir,
      filesCopied: processResult.filesCopied
    };

  } catch (error) {
    console.error('Erro ao salvar perfil Azure:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-app-state', async (event, appState) => {
  const statePath = APP_STATE_PATH;
  try {
    const stateRead = await readJsonWithBackup(statePath, {}, 'app_state');
    if (!stateRead.success) {
      return { success: false, error: stateRead.error };
    }
    const currentState = stateRead.data && typeof stateRead.data === 'object' ? stateRead.data : {};

    const mergedState = {
      ...currentState,
      ...appState,
      killSwitchEnabled,
      lastSaved: new Date().toISOString()
    };

    const writeResult = await writeJsonWithBackup(statePath, mergedState, 'app_state');
    if (!writeResult.success) {
      return { success: false, error: writeResult.error };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-app-state', async () => {
  const statePath = APP_STATE_PATH;
  try {
    const stateRead = await readJsonWithBackup(statePath, {}, 'app_state');
    if (!stateRead.success) {
      return { success: false, error: stateRead.error };
    }

    if (stateRead.source !== 'default') {
      const state = stateRead.data && typeof stateRead.data === 'object' ? stateRead.data : {};

      // IS002: validar se o PID salvo ainda corresponde a sessão BluePex rastreada
      if (state.vpnPid || state.connectionOwner === 'bluepex') {
        const meta = state.connectionOwner === 'bluepex' ? {
          connectionOwner: 'bluepex',
          connectionId: state.connectionId,
          profileId: state.profileId,
          profileType: state.profileType,
          ovpnPath: state.ovpnPath || state.configPath,
          configPath: state.configPath || state.ovpnPath,
          normalizedConfigPath: normalizePathForCompare(state.configPath || state.ovpnPath),
          authFilePath: state.authFilePath || null,
          startedAt: state.startedAt || null,
          vpnPid: state.vpnPid ? Number(state.vpnPid) : null,
          wrapperPid: state.wrapperPid ? Number(state.wrapperPid) : null
        } : null;
        const bluepexPid = meta ? refreshTrackedBluepexPid(meta) : null;

        if (!bluepexPid) {
          console.log(`⚠️ [IS002] Estado salvo não corresponde a sessão BluePex ativa — limpando estado`);
          state.vpnPid = null;
          state.vpnConnected = false;
          state.wrapperPid = null;
          state.connectionOwner = null;
          state.connectionId = null;
          state.profileId = null;
          state.profileType = null;
          state.ovpnPath = null;
          state.configPath = null;
          state.authFilePath = null;
          state.startedAt = null;
          // Persiste o estado limpo para evitar reincidência
          try {
            await writeJsonWithBackup(statePath, { ...state, lastSaved: new Date().toISOString() }, 'app_state');
          } catch (_) {}
        } else {
          state.vpnPid = bluepexPid;
          state.vpnConnected = true;
          if (state.killSwitchEnabled) {
            killSwitchEnabled = true;
            enableKillSwitch().catch(() => {});
          }
        }
      }

      if (state.killSwitchEnabled !== undefined) {
        killSwitchEnabled = !!state.killSwitchEnabled;
      }

      return { success: true, state };
    }
    return { success: true, state: {} };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-app-settings', () => loadAppSettings());
ipcMain.handle('save-app-settings', (_, settings) => saveAppSettings(settings));

ipcMain.handle('set-compact-mode', (_, enabled) => {
  saveAppSettings({ compactMode: enabled });
  if (mainWindow && !mainWindow.isDestroyed()) {
    const h = enabled ? 520 : 712;
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(640, h);
    mainWindow.setMaximumSize(640, h);
    mainWindow.setSize(640, h);
    mainWindow.setResizable(false);
  }
  return { success: true };
});

ipcMain.handle('load-azure-profiles', async () => {
  const azureProfilesPath = AZURE_PROFILES_PATH;
  try {
    const profilesRead = await readJsonWithBackup(azureProfilesPath, [], 'azure_profiles');
    if (!profilesRead.success) {
      return { success: false, error: profilesRead.error };
    }

    const profiles = Array.isArray(profilesRead.data) ? profilesRead.data : [];
    return { success: true, profiles };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('open-external', (event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'URL inválida' };
});

// Minimizar para tray
ipcMain.handle('minimize-to-tray', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
    logger.log('SYSTEM', 'WINDOW_MINIMIZED_TO_TRAY', {
      platform: process.platform,
      trayAvailable: !!tray
    });
  }
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
    logger.log('SYSTEM', 'MINIMIZE_WINDOW_SUCCESS', {});
  }
});

ipcMain.handle('close-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (isVpnSessionActive()) {
      const activePid = getTrackedVpnPid();
      logger.log('SYSTEM', 'WINDOW_CLOSE_BLOCKED_VPN_ACTIVE', { trackedPid: activePid });
      return { success: false, blocked: true, reason: 'vpn_active', pid: activePid };
    }

    mainWindow.close();
    logger.log('SYSTEM', 'WINDOW_CLOSED', {});
    return { success: true };
  }

  return { success: false, blocked: false, reason: 'window_unavailable' };
});

ipcMain.handle('save-azure-profile', async (event, profile) => {
  const azureProfilesPath = AZURE_PROFILES_PATH;
  try {
    const profilesRead = await readJsonWithBackup(azureProfilesPath, [], 'azure_profiles');
    if (!profilesRead.success) {
      return { success: false, error: profilesRead.error };
    }

    let profiles = Array.isArray(profilesRead.data) ? profilesRead.data : [];

    const existingIndex = profiles.findIndex(p => p.id === profile.id);
    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }

    const writeResult = await writeJsonWithBackup(azureProfilesPath, profiles, 'azure_profiles');
    if (!writeResult.success) {
      return { success: false, error: writeResult.error };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-azure-profile', async (event, profileId) => {
  const azureProfilesPath = AZURE_PROFILES_PATH;
  const profileDir = path.join(AZURE_PROFILES_DIR, profileId);

  try {
    if (await fileExists(profileDir)) {
      await fsAsync.rm(profileDir, { recursive: true, force: true });
    }

    const profilesRead = await readJsonWithBackup(azureProfilesPath, [], 'azure_profiles');
    if (!profilesRead.success) {
      return { success: false, error: profilesRead.error };
    }

    let profiles = Array.isArray(profilesRead.data) ? profilesRead.data : [];
    profiles = profiles.filter((p) => p.id !== profileId);
    const writeResult = await writeJsonWithBackup(azureProfilesPath, profiles, 'azure_profiles');
    if (!writeResult.success) {
      return { success: false, error: writeResult.error };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function maskValue(value) {
  const text = String(value || '');
  if (!text) return 'not_set';
  if (text.length <= 8) return '***configured***';
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

// ============ FUNÇÕES AZURE ============

function parseAzureConfigFromOvpnContent(content = '') {
  const azureConfig = {
    client_id: null,
    tenant_id: null,
    scope: null,
    server_api: null
  };

  String(content || '').split('\n').forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith('#AZURE:')) return;
    const azureLine = trimmedLine.substring(7).trim();
    const separatorIndex = azureLine.indexOf('=');
    if (separatorIndex < 0) return;
    const key = azureLine.substring(0, separatorIndex).trim().toLowerCase();
    const value = azureLine.substring(separatorIndex + 1).trim();
    if (!value || !Object.prototype.hasOwnProperty.call(azureConfig, key)) return;
    azureConfig[key] = value;
  });

  return azureConfig;
}

function normalizeAzureConfig(azureConfig = {}) {
  return {
    client_id: azureConfig.client_id || azureConfig.clientId || null,
    tenant_id: azureConfig.tenant_id || azureConfig.tenantId || null,
    scope: azureConfig.scope || null,
    server_api: azureConfig.server_api || azureConfig.serverApi || null
  };
}

function mergeAzureConfig(...configs) {
  return configs.reduce((merged, item) => {
    const normalized = normalizeAzureConfig(item || {});
    Object.keys(merged).forEach((key) => {
      if (!merged[key] && normalized[key]) merged[key] = normalized[key];
    });
    return merged;
  }, { client_id: null, tenant_id: null, scope: null, server_api: null });
}

async function getAzureProfile(profileId) {
  const profilesRead = await readJsonWithBackup(AZURE_PROFILES_PATH, [], 'azure_profiles');
  if (!profilesRead.success) {
    throw new Error(`Falha ao ler perfis Azure: ${profilesRead.error}`);
  }
  const profiles = Array.isArray(profilesRead.data) ? profilesRead.data : [];
  return profiles.find((profile) => profile && profile.id === profileId) || null;
}

async function resolveAzureProfileConfig(profileId) {
  if (!profileId) {
    throw new Error('Perfil Azure não informado. Selecione um perfil e tente novamente.');
  }

  const profile = await getAzureProfile(profileId);
  const ovpnResult = await loadOvnFromProfile(profileId, 'azure');
  const ovpnConfig = ovpnResult.success ? parseAzureConfigFromOvpnContent(ovpnResult.content) : {};
  const fallbackConfig = {
    client_id: config?.client_id || null,
    tenant_id: config?.tenant_id || null,
    scope: config?.scope || null,
    server_api: config?.server_api || null
  };
  const azureConfig = mergeAzureConfig(profile?.azureConfig, ovpnConfig, fallbackConfig);
  const missing = ['client_id', 'tenant_id', 'scope', 'server_api'].filter((key) => !azureConfig[key]);

  if (missing.length) {
    throw new Error(`Configuração Azure incompleta para o perfil selecionado: ${missing.join(', ')}.`);
  }

  return {
    profile,
    ovpnPath: ovpnResult.success ? ovpnResult.path : null,
    azureConfig
  };
}

ipcMain.handle('login-azure', async (event, profileId) => {
  const { azureConfig } = await resolveAzureProfileConfig(profileId);
  const profilePca = new PublicClientApplication({
    auth: {
      clientId: azureConfig.client_id,
      authority: `https://login.microsoftonline.com/${azureConfig.tenant_id}`,
    }
  });

  azureAuthContexts.set(profileId, {
    azureConfig,
    updatedAt: new Date().toISOString()
  });

  logger.log('AZURE', 'LOGIN_START', {
    profileId,
    hasClientId: !!azureConfig.client_id,
    tenantId: maskValue(azureConfig.tenant_id),
    hasScope: !!azureConfig.scope,
    hasServerApi: !!azureConfig.server_api
  });

  const request = {
    scopes: azureConfig.scope.split(' ').filter(Boolean),
    deviceCodeCallback: (deviceCodeResponse) => {
      logger.log('AZURE', 'DEVICE_CODE_GENERATED', {
        verificationUri: deviceCodeResponse.verificationUri,
        userCode: deviceCodeResponse.userCode
      });
      const messageData = {
        verification_uri: deviceCodeResponse.verificationUri,
        user_code: deviceCodeResponse.userCode,
      };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('device-code-response', messageData);
      }
      try {
        shell.openExternal(deviceCodeResponse.verificationUri);
      } catch (e) {
        console.log('⚠️ shell.openExternal falhou:', e.message);
      }
    }
  };

  try {
    const response = await profilePca.acquireTokenByDeviceCode(request);
    const { accessToken, account } = response;

    let expiresAtIso;
    if (response.expiresOn instanceof Date) {
      expiresAtIso = response.expiresOn.toISOString();
    } else if (typeof response.expiresOn === 'number') {
      expiresAtIso = new Date(response.expiresOn * 1000).toISOString();
    } else {
      expiresAtIso = new Date(Date.now() + 86400 * 1000).toISOString();
    }

    const cache = {
      access_token: accessToken,
      username: account.username,
      profile_id: profileId,
      expires_at: expiresAtIso
    };
    writeTokenCache(cache);

    logger.logAuthSuccess('azure_device_code', 'azure_ad', {
      username: account.username,
      expiresAt: cache.expires_at
    });

    return { token: accessToken, username: account.username };
  } catch (err) {
    logger.logAuthFailure('azure_device_code', 'azure_ad', err);
    throw new Error(err.message);
  }
});

ipcMain.handle('publish-token', async (event, username, token, profileId) => {
  try {
    const context = azureAuthContexts.get(profileId);
    const { azureConfig } = context?.azureConfig
      ? context
      : await resolveAzureProfileConfig(profileId);

    logger.log('AZURE', 'TOKEN_PUBLISH_START', {
      username,
      profileId,
      hasServerApi: !!azureConfig.server_api
    });

    const response = await axios.post(azureConfig.server_api, { username, jwt_token: token });
    const shortIdRaw =
      response?.data?.short_id ||
      response?.data?.shortID ||
      response?.data?.id ||
      response?.data?.data?.short_id ||
      response?.data?.data?.shortID ||
      null;
    const shortId = typeof shortIdRaw === 'string' ? shortIdRaw.trim() : (shortIdRaw ? String(shortIdRaw).trim() : '');

    if (!shortId) {
      const responseData = response?.data && typeof response.data === 'object' ? response.data : {};
      logger.log('AZURE', 'TOKEN_PUBLISH_FAILURE', {
        username,
        profileId,
        hasServerApi: !!azureConfig.server_api,
        status: response?.status || null,
        responseKeys: Object.keys(responseData),
        nestedDataKeys: responseData.data && typeof responseData.data === 'object' ? Object.keys(responseData.data) : []
      }, 'WARN');
      throw new Error('Backend não retornou short_id do Entra ID.');
    }

    try {
      const existing = fs.existsSync(cachePath)
        ? readTokenCache()
        : {};

      existing.short_id = shortId;
      existing.shortID = shortId;
      existing.profile_id = profileId;
      existing.short_id_generated_at = new Date().toISOString();
      writeTokenCache(existing);
    } catch (persistErr) {
      logger.log('AZURE', 'TOKEN_PUBLISH_CACHE_WARN', {
        username,
        error: persistErr.message
      });
    }

    logger.logAzureTokenPublish(username, true, {
      profileId,
      hasServerApi: !!azureConfig.server_api,
      hasShortId: !!shortId
    });
    return { success: true, short_id: shortId };
  } catch (err) {
    logger.logAzureTokenPublish(username, false, {
      profileId,
      error: err.response?.data?.message || err.message
    });
    throw new Error(err.response?.data?.message || err.message);
  }
});

async function renewShortIdIfNeeded(cache) {
  const SHORT_ID_TTL_MS = 8 * 60 * 60 * 1000;
  const RENEW_MARGIN_MS = 30 * 60 * 1000;
  const generatedAt = cache.short_id_generated_at ? new Date(cache.short_id_generated_at).getTime() : 0;
  const age = Date.now() - generatedAt;
  if (!cache.short_id || !cache.access_token || !config.server_api) return;
  if (age < SHORT_ID_TTL_MS - RENEW_MARGIN_MS) return;
  try {
    logger.log('AZURE', 'SHORT_ID_RENEW_START', { age: Math.round(age / 60000) + 'min', username: cache.username });
    const resp = await axios.post(config.server_api, { username: cache.username, jwt_token: cache.access_token });
    const newShortId = resp?.data?.short_id || resp?.data?.shortID || resp?.data?.data?.short_id || '';
    if (newShortId) {
      cache.short_id = newShortId;
      cache.shortID = newShortId;
      cache.short_id_generated_at = new Date().toISOString();
      writeTokenCache(cache);
      logger.log('AZURE', 'SHORT_ID_RENEW_OK', { username: cache.username });
    }
  } catch (e) {
    logger.log('AZURE', 'SHORT_ID_RENEW_WARN', { error: e.message }, 'WARN');
  }
}


ipcMain.handle('connect-openvpn', async () => {
  suppressNextReconnect = false;
  const connectionId = `conn_azure_${Date.now()}`;
  const pkexecAvailableGlobal = await checkPkexecAvailable();
  return new Promise(async (resolve, reject) => {
    console.log(`🔗 [MAIN] connect-openvpn chamado - Timestamp: ${new Date().toISOString()}`);

    if (vpnProcess && !vpnProcess.killed) {
      console.log(`⚠️ [MAIN] Conexão Azure já ativa (PID: ${vpnProcess.pid})`);
      reject(new Error('Já existe uma conexão VPN ativa'));
      return;
    }

    if (!config?.openvpn_config || !fs.existsSync(config.openvpn_config)) {
      reject(new Error('Arquivo de configuração OpenVPN Azure não encontrado.'));
      return;
    }

    let configContent = '';
    try {
      configContent = fs.readFileSync(config.openvpn_config, 'utf-8');
    } catch (readConfigError) {
      console.log(`⚠️ Não foi possível ler conteúdo do .ovpn Azure (${config.openvpn_config}): ${readConfigError.message}`);
    }

    let cache;
    try {
      cache = readTokenCache();
    } catch (err) {
      reject(new Error('Token não encontrado. Faça login primeiro.'));
      return;
    }
    await renewShortIdIfNeeded(cache);

    // Exigir short_id retornado pelo backend no publish-token
    const shortID = (cache.short_id && String(cache.short_id).trim())
      ? String(cache.short_id).trim()
      : ((cache.shortID && String(cache.shortID).trim()) ? String(cache.shortID).trim() : '');

    if (!shortID) {
      reject(new Error('short_id do Entra ID não encontrado. Faça login novamente para publicar o token antes de conectar.'));
      return;
    }
    const azureUpn = String(cache.username || '').trim().replace(/[\r\n]/g, '');

    if (!azureUpn || !azureUpn.includes('@')) {
      reject(new Error('UPN do Entra ID inválido ou ausente no cache. Faça login novamente.'));
      return;
    }

    logger.log('CONNECTION', 'START', {
      connectionId,
      profileId: 'azure',
      profileType: 'azure',
      connectionType: 'openvpn-azure',
      platform: process.platform,
      user: process.env.USER || process.env.USERNAME || 'unknown',
      timestamp: new Date().toISOString(),
      hasShortId: true,
      shortIdLength: shortID.length,
      shortIdSuffix: shortID.slice(-4),
      configPath: config.openvpn_config
    });

    fs.writeFileSync(authPath, `${azureUpn}\n${shortID}`, 'utf-8');
    console.log(`🔐 [Azure] auth-user-pass preparado com UPN: ${azureUpn}`);

    if (process.platform === 'win32' && configContent && !/^\s*block-outside-dns\b/im.test(configContent)) {
      try {
        fs.writeFileSync(config.openvpn_config, configContent + '\nblock-outside-dns\n', 'utf-8');
        configContent = configContent + '\nblock-outside-dns\n';
      } catch (_) {}
    }

    const openvpnArgs = ['--config', config.openvpn_config, '--auth-user-pass', authPath];
    if (shouldEnableExplicitExitNotify(configContent)) {
      openvpnArgs.push('--explicit-exit-notify', '3');
      logger.log('CONNECTION', 'EXPLICIT_EXIT_NOTIFY_ENABLED', {
        profileType: 'azure',
        profileId: 'azure',
        mode: 'azure'
      });
    }
    if (process.platform === 'linux') {
      openvpnArgs.push('--pull-filter', 'ignore', 'block-outside-dns');
      openvpnArgs.push('--pull-filter', 'ignore', 'comp-lzo');
      openvpnArgs.push('--pull-filter', 'ignore', 'compress');
    }
    let openvpnCommand;
    let openvpnArgsFinal;

    currentOvpnPath = config.openvpn_config;
    currentElevationMethod = 'direct';

    if (process.platform === 'win32') {
      // Detectar caminho real do OpenVPN no Windows (igual ao handler userpass)
      const pf64Az = process.env['ProgramFiles'] || 'C:\\Program Files';
      const pf32Az = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const possibleWinPaths = [
        `${pf64Az}\\OpenVPN\\bin\\openvpn.exe`,
        `${pf32Az}\\OpenVPN\\bin\\openvpn.exe`,
        `${pf64Az}\\OpenVPN Connect\\openvpn.exe`,
        `${pf32Az}\\OpenVPN Connect\\openvpn.exe`,
        'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe',
        'C:\\Program Files (x86)\\OpenVPN\\bin\\openvpn.exe',
      ];
      let winOpenvpnPath = null;
      for (const p of possibleWinPaths) {
        if (fs.existsSync(p)) { winOpenvpnPath = p; break; }
      }
      if (!winOpenvpnPath) {
        try {
          const { execSync } = require('child_process');
          const r = execSync('where openvpn.exe 2>nul', { encoding: 'utf8' });
          winOpenvpnPath = r.trim().split('\n')[0].trim();
        } catch (_) {}
      }
      if (!winOpenvpnPath) {
        cleanup();
        reject(new Error('OpenVPN não encontrado. Instale o OpenVPN e tente novamente.'));
        return;
      }
      console.log(`🔐 [Azure/Win] OpenVPN encontrado: ${winOpenvpnPath}`);
      openvpnCommand = winOpenvpnPath;
      openvpnArgsFinal = openvpnArgs;
    } else {
      // Linux/Unix: escolher estratégia de elevação compatível
      const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
      const pkexecAvailable = pkexecAvailableGlobal;

      if (isRoot) {
        openvpnCommand = 'openvpn';
        openvpnArgsFinal = openvpnArgs;
        currentElevationMethod = 'direct';
        console.log('🔐 [Azure] Processo já é root — invocando openvpn diretamente');
      } else if (process.env.DISPLAY && pkexecAvailable) {
        // BUG2-FIX: pkexec deve receber openvpn diretamente (policy cobre /usr/bin/openvpn, não stdbuf).
        // SYSTEMD_ASK_PASSWORD já está no env do spawn.
        openvpnCommand = 'pkexec';
        openvpnArgsFinal = ['openvpn', ...openvpnArgs];
        currentElevationMethod = 'pkexec';
        console.log('🔐 [Azure] Usando pkexec openvpn (sem stdbuf, SYSTEMD_ASK_PASSWORD via env)');
      } else {
        openvpnCommand = 'sudo';
        openvpnArgsFinal = ['-n', 'openvpn', ...openvpnArgs];
        currentElevationMethod = 'sudo';
        console.log('🔐 [Azure] Usando sudo -n openvpn para elevação não interativa');
      }
    }

    let connectionEstablished = false;
    let azureAuthFailed = false;
    let azureFatalFailed = false;
    let lastErrorOutput = '';
    let promiseSettled = false;

    let connectionTimeout = null;
    let azureFallbackInterval = null;
    const azureFallbackStartedAt = Date.now();

    const resolveOnce = (value) => {
      if (promiseSettled) return;
      promiseSettled = true;
      resolve(value);
    };

    const rejectOnce = (error) => {
      if (promiseSettled) return;
      promiseSettled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const isAzureConnectedOutput = (output) => {
      if (!output || typeof output !== 'string') return false;
      return /Initialization Sequence Completed/i.test(output)
        || /CONNECTED,SUCCESS/i.test(output)
        || /\bConnected\b/i.test(output);
    };

    const isAzureFatalOutput = (output) => {
      if (!output || typeof output !== 'string') return false;
      return /AUTH_FAILED/i.test(output)
        || /Cannot open TUN\/TAP dev/i.test(output)
        || /Failed to open tun\/tap interface/i.test(output)
        || /Exiting due to fatal error/i.test(output)
        || /Failed to apply push options/i.test(output)
        || /process-push-msg-failed/i.test(output)
        || /server pushed compression settings/i.test(output)
        || /Compression is not allowed/i.test(output)
        || /TLS Error: TLS key negotiation failed/i.test(output)
        || /sudo:.*password is required/i.test(output)
        || /Not authorized/i.test(output);
    };

    const getAzureFatalLine = (output) => {
      const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const fatalLine = [...lines].reverse().find((line) => isAzureFatalOutput(line));
      return (fatalLine || lines[lines.length - 1] || 'Erro fatal no OpenVPN Azure').slice(-500);
    };

    const clearAzureFallbackInterval = () => {
      if (azureFallbackInterval) {
        clearInterval(azureFallbackInterval);
        azureFallbackInterval = null;
      }
    };

    const handleAzureConnected = (source, output) => {
      if (connectionEstablished) return;
      connectionEstablished = true;
      if (connectionTimeout) clearTimeout(connectionTimeout);
      clearAzureFallbackInterval();
      vpnConnectionActive = true;
      const bluepexPid = refreshTrackedBluepexPid(currentConnectionMeta) || vpnProcess.pid;
      currentConnectionMeta = { ...currentConnectionMeta, vpnPid: bluepexPid };
      persistBluepexConnectionMeta(currentConnectionMeta);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-connected', { pid: bluepexPid });
        startTunnelHealthCheck();
      }
      console.log('✅ [Azure] VPN conectada com sucesso!');
      activeHistoryEntry = {
        id: connectionId,
        profileName: 'azure',
        profileType: 'azure',
        startedAt: new Date().toISOString(),
        endedAt: null,
        durationSeconds: 0,
        disconnectReason: null,
        bytesIn: 0,
        bytesOut: 0,
        status: 'active'
      };
      appendConnectionHistory(activeHistoryEntry);
      {
        const detectedTunAz = detectActiveTunInterface();
        if (detectedTunAz) {
          activeTunInterface = detectedTunAz;
          startTrafficStats('azure', 'azure');
          applyDnsLeakProtection(detectedTunAz).catch(() => {});
        } else {
          setTimeout(() => {
            const t = detectActiveTunInterface();
            if (t) activeTunInterface = t;
            startTrafficStats('azure', 'azure');
            if (activeTunInterface) applyDnsLeakProtection(activeTunInterface).catch(() => {});
          }, 1500);
        }
      }
      logger.logConnectionSuccess('azure', 'azure', {
        pid: bluepexPid,
        wrapperPid: vpnProcess.pid,
        source,
        output: String(output || '').slice(-1000)
      });
      resolveOnce({ pid: bluepexPid, shortID });
    };

    const handleAzureAuthFailure = (source) => {
      if (azureAuthFailed) return;
      azureAuthFailed = true;
      suppressNextReconnect = true;
      lastErrorOutput = 'Falha de autenticação do OpenVPN.';

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-status', 'Falha de autenticação do OpenVPN Azure');
      }

      if (connectionTimeout) clearTimeout(connectionTimeout);
      clearAzureFallbackInterval();

      logger.log('CONNECTION', 'AUTH_FAILED_DETECTED', {
        connectionId,
        profileId: 'azure',
        source
      });

      killVPNConnection().catch((killError) => {
        logger.logSystemError('AUTH_FAILED_KILL_FAILED', killError, {
          connectionId,
          profileId: 'azure',
          source
        });
      });

      rejectOnce(new Error('Falha na autenticação do OpenVPN Azure'));
    };

    const handleAzureFatalOutput = (source, output) => {
      if (connectionEstablished || azureFatalFailed) return;
      azureFatalFailed = true;
      suppressNextReconnect = true;
      lastErrorOutput = getAzureFatalLine(output);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-status', `Erro fatal no OpenVPN Azure: ${lastErrorOutput}`);
      }

      if (connectionTimeout) clearTimeout(connectionTimeout);
      clearAzureFallbackInterval();

      logger.log('CONNECTION', 'OPENVPN_AZURE_FATAL_OUTPUT', {
        connectionId,
        profileId: 'azure',
        source,
        error: lastErrorOutput
      }, 'ERROR');

      killVPNConnection().catch((killError) => {
        logger.logSystemError('AZURE_FATAL_KILL_FAILED', killError, {
          connectionId,
          profileId: 'azure',
          source
        });
      });

      rejectOnce(new Error(`Erro fatal no OpenVPN Azure: ${lastErrorOutput}`));
    };

    const cleanup = () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      clearAzureFallbackInterval();
      try {
        if (fs.existsSync(authPath)) {
          fs.unlinkSync(authPath);
        }
      } catch (error) {
        console.log('⚠️ Erro ao limpar authPath Azure:', error.message);
      }
    };

    try {
      disableKillSwitch().catch(() => {});
      vpnProcess = spawn(openvpnCommand, openvpnArgsFinal, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, SYSTEMD_ASK_PASSWORD: '' }
      });
    } catch (spawnError) {
      cleanup();
      rejectOnce(new Error(`Falha ao iniciar OpenVPN: ${spawnError.message}`));
      return;
    }

    vpnConnectionActive = true;
    currentConnectionMeta = buildBluepexConnectionMeta({
      connectionId,
      profileId: 'azure',
      profileType: 'azure',
      configPath: config.openvpn_config,
      authFilePath: authPath,
      vpnPid: vpnProcess.pid,
      wrapperPid: vpnProcess.pid
    });
    persistBluepexConnectionMeta(currentConnectionMeta);

    if (process.platform === 'linux') {
      logger.log('CONNECTION', 'AZURE_CONNECT_FALLBACK_WAITING', {
        connectionId,
        profileId: 'azure',
        intervalMs: 2000,
        minAliveMs: 10000
      });

      azureFallbackInterval = setInterval(() => {
        if (connectionEstablished || azureAuthFailed || azureFatalFailed || promiseSettled) {
          clearAzureFallbackInterval();
          return;
        }

        const trackedPid = refreshTrackedBluepexPid(currentConnectionMeta);
        const wrapperAlive = vpnProcess?.pid ? isPidAlive(vpnProcess.pid) : false;
        const bluepexAlive = !!trackedPid || wrapperAlive;
        const elapsedMs = Date.now() - azureFallbackStartedAt;

        if (!bluepexAlive) {
          return;
        }

        const vpnState = detectLocalVpnInterfaceState();
        if (elapsedMs >= 10000 && vpnState.connected && !isAzureFatalOutput(lastErrorOutput)) {
          logger.log('CONNECTION', 'AZURE_CONNECT_FALLBACK_CONFIRMED', {
            connectionId,
            profileId: 'azure',
            elapsedMs,
            pid: trackedPid || vpnProcess.pid,
            detail: vpnState.detail
          });
          handleAzureConnected('local-vpn-state', vpnState.detail);
        }
      }, 2000);
    }

    connectionTimeout = setTimeout(() => {
      if (!connectionEstablished) {
        vpnConnectionActive = false;
        suppressNextReconnect = true;
        clearAzureFallbackInterval();
        killVPNConnection().catch((killError) => {
          logger.logSystemError('AZURE_TIMEOUT_KILL_FAILED', killError, {
            connectionId,
            profileId: 'azure'
          });
        });
        rejectOnce(new Error(`Timeout na conexão OpenVPN Azure. ${lastErrorOutput || ''}`.trim()));
      }
    }, 120000);

    let replayErrorCount = 0;
    let replayErrorTimer = null;

    const handleAzureServerDisconnect = async (reason, details = {}) => {
      if (!connectionEstablished || !vpnConnectionActive) return;
      logger.log('VPN', 'AZURE_SERVER_DISCONNECT_DETECTED', { reason, ...details }, 'WARN');
      vpnConnectionActive = false;
      stopTunnelHealthCheck();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-status', 'Conexão encerrada pelo servidor. Desconectando...');
      }
      try {
        await killVPNConnection();
      } catch (_) {}
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-disconnected');
        mainWindow.webContents.send('vpn-status', 'Conexão encerrada pelo servidor. Reconecte.');
      }
    };

    const handleReplayStorm = () => handleAzureServerDisconnect('replay_storm', { replayErrorCount });

    const isAzureServerDisconnectOutput = (text) => /Inactivity timeout \(--ping-restart\)|SIGUSR1\[soft,ping-restart\]|process restarting|Peer Connection Initiated/i.test(String(text || ''));

    vpnProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('OpenVPN Azure stdout:', output);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-log', output);
      }

      if (connectionEstablished && isAzureServerDisconnectOutput(output)) {
        handleAzureServerDisconnect('openvpn_restart', { output: output.slice(-500) });
        return;
      }

      if (connectionEstablished && output.includes('bad packet ID (may be a replay)')) {
        replayErrorCount++;
        if (replayErrorTimer) clearTimeout(replayErrorTimer);
        replayErrorTimer = setTimeout(() => { replayErrorCount = 0; }, 10000);
        if (replayErrorCount >= 5) {
          handleReplayStorm();
          return;
        }
      }

      if (isAzureConnectedOutput(output) && !connectionEstablished) {
        handleAzureConnected('stdout', output);
      }

      if (output.includes('AUTH_FAILED')) {
        handleAzureAuthFailure('stdout');
        return;
      }

      if (isAzureFatalOutput(output)) {
        handleAzureFatalOutput('stdout', output);
        return;
      }
    });

    vpnProcess.stderr.on('data', (data) => {
      const errorText = data.toString();
      console.error('OpenVPN Azure stderr:', errorText);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-log', `ERRO: ${errorText}`);
      }

      if (isAzureConnectedOutput(errorText) && !connectionEstablished) {
        handleAzureConnected('stderr', errorText);
        return;
      }

      if (connectionEstablished && isAzureServerDisconnectOutput(errorText)) {
        handleAzureServerDisconnect('openvpn_restart', { output: errorText.slice(-500) });
        return;
      }

      if (errorText.includes('sudo:') || errorText.includes('a password is required')) {
        lastErrorOutput = 'Sudo requer senha/interação para iniciar OpenVPN (configure NOPASSWD ou use pkexec).';
      } else if (errorText.includes('pkexec') || errorText.includes('Not authorized')) {
        lastErrorOutput = 'pkexec negou a elevação para iniciar OpenVPN.';
      } else if (errorText.includes('Cannot open TUN/TAP dev')) {
        lastErrorOutput = 'Sem permissão para abrir TUN/TAP.';
      } else if (errorText.includes('AUTH_FAILED')) {
        handleAzureAuthFailure('stderr');
        return;
      } else if (connectionEstablished && errorText.includes('bad packet ID (may be a replay)')) {
        replayErrorCount++;
        if (replayErrorTimer) clearTimeout(replayErrorTimer);
        replayErrorTimer = setTimeout(() => { replayErrorCount = 0; }, 10000);
        if (replayErrorCount >= 5) {
          handleReplayStorm();
          return;
        }
      } else if (errorText.trim()) {
        lastErrorOutput = errorText.trim().split('\n').pop();
      }

      if (isAzureFatalOutput(errorText)) {
        handleAzureFatalOutput('stderr', errorText);
        return;
      }
    });

    vpnProcess.on('error', (error) => {
      if (error.code === 'EPERM' && error.syscall === 'kill') {
        console.log('⚠️ [Azure] EPERM kill ignorado (processo root, Node não pode verificar PID) — aguardando evento close para diagnóstico real');
        logger.log('CONNECTION', 'EPERM_KILL_IGNORED', {
          connectionId,
          profileId: 'azure',
          note: 'EPERM_syscall_kill_is_nodejs_internal_pid_check_not_spawn_failure',
          pid: vpnProcess?.pid
        });
        return;
      }

      vpnConnectionActive = false;
      cleanup();
      clearBluepexConnectionMeta();
      vpnProcess = null;
      rejectOnce(new Error(`Erro ao iniciar OpenVPN Azure: ${error.message}`));
    });

     vpnProcess.on('close', (code) => {
       console.log(`OpenVPN Azure encerrado com código ${code}`);
       const wasEstablished = connectionEstablished;
        vpnConnectionActive = false;
         cleanup();
        vpnProcess = null;
        clearBluepexConnectionMeta();

       if (wasEstablished) {
         const azureDisconnReason = azureAuthFailed ? 'error' : (code !== 0 ? 'reconnect' : 'manual');
         stopTrafficStats(azureDisconnReason);
       }
       if (wasEstablished && mainWindow && !mainWindow.isDestroyed()) {
         const manualDisconnect = suppressNextReconnect;
         if (killSwitchEnabled && !manualDisconnect) { enableKillSwitch().catch(() => {}); }
         stopTunnelHealthCheck();

         mainWindow.webContents.send('vpn-disconnected');
         if (manualDisconnect) {
           console.log('🛑 [RF010] Reconexão automática Azure ignorada: desconexão manual solicitada');
           suppressNextReconnect = false;
         }
         // RF010: reagendar reconexão se caiu inesperadamente
          if (code !== 0 && AUTO_RECONNECT.enabled && !azureAuthFailed && !manualDisconnect) {
           AUTO_RECONNECT.lastProfileId = 'azure';
           AUTO_RECONNECT.lastProfileType = 'azure';
           scheduleReconnect('azure', 'azure');
         }
       }

       if (code !== 0 && lastErrorOutput) {
          logger.log('CONNECTION', 'OPENVPN_AZURE_STDERR_ON_EXIT', {
            connectionId,
            exitCode: code,
            stderr: lastErrorOutput.slice(-2000)
          }, 'ERROR');
        }

       if (!wasEstablished && !azureAuthFailed && !azureFatalFailed) {
           rejectOnce(new Error(`OpenVPN Azure encerrou antes de conectar (código ${code}). ${lastErrorOutput || ''}`.trim()));
         }
     });
  });
});

// ============ DESCONEXÃO VPN ============

// Função para matar a conexão VPN (MESMA DO FECHAR)
async function killVPNConnection() {
  console.log('🔌 MATANDO CONEXÃO VPN (MÉTODO DO FECHAR)...');
  suppressNextReconnect = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vpn-log', '⚠️ Desconexão solicitada pelo usuário\n');
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Executa um comando e retorna resultado sem lançar exceção
  const execCommand = (command) => new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error ? error.code : 0,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        error: error ? error.message : null
      });
    });
  });

  // BUG1-FIX: kill elevado e cirúrgico para PID específico.
  // Estratégia primária: pkexec /bin/kill coberto pela policy com.bluepex.kill
  // (allow_active=yes → sem prompt de senha em sessão ativa).
  // Fallback: sudo -n kill (sistemas com NOPASSWD configurado).
  const sudoKillPid = (pid, signal) => new Promise((resolve) => {
    const sigArg = signal === 'SIGKILL' ? '-9' : '-TERM';
    // Usa pkexec /bin/kill coberto pela policy com.bluepex.kill (allow_active=yes, sem prompt de senha)
    // Fallback: sudo -n kill se pkexec falhar (ex: sem DISPLAY ou polkit não instalado)
    const pkexecCmd = `pkexec /bin/kill ${sigArg} ${Number(pid)}`;
    exec(pkexecCmd, (pkexecError, pkexecStdout, pkexecStderr) => {
      if (!pkexecError) {
        resolve({
          ok: true,
          method: 'pkexec',
          error: null,
          stdout: (pkexecStdout || '').trim(),
          stderr: (pkexecStderr || '').trim()
        });
      } else {
        // Fallback: sudo -n
        exec(`sudo -n kill ${sigArg} ${Number(pid)}`, (sudoError, sudoStdout, sudoStderr) => {
          resolve({
            ok: !sudoError,
            method: 'sudo',
            error: sudoError ? sudoError.message : null,
            stdout: (sudoStdout || '').trim(),
            stderr: (sudoStderr || '').trim(),
            pkexecError: pkexecError.message,
            pkexecStderr: (pkexecStderr || '').trim()
          });
        });
      }
    });
  });

  // verifyDisconnected verifica apenas se o openvpn rastreado BluePex ainda está vivo.
  // NÃO usa hasAnyOpenVpnProcess() como critério de falha (não interfere com processos externos).
  const verifyDisconnected = () => {
    return !refreshTrackedBluepexPid();
  };

  try {
    const meta = loadTrackedBluepexMetaFromState();
    const bluepexPid = refreshTrackedBluepexPid(meta);
    const wrapperPid = vpnProcess?.pid || meta?.wrapperPid || null;

    if (!bluepexPid && !vpnProcess) {
      // Nenhuma sessão BluePex rastreada — não matar processos externos
      if (hasAnyOpenVpnProcess()) {
        console.log('ℹ️ OpenVPN externo detectado; desconexão BluePex não matará processos externos.');
      }
      vpnConnectionActive = false;
      clearBluepexConnectionMeta();
      return { success: true, skipped: true, reason: 'no_tracked_bluepex_session' };
    }

    // --- AVISO TCP: explicit-exit-notify não é suportado em perfis TCP ---
    const ovpnPath = currentOvpnPath || meta?.ovpnPath || meta?.configPath || null;
    if (ovpnPath) {
      try {
        const ovpnContent = fs.readFileSync(ovpnPath, 'utf8');
        if (/^\s*proto\s+tcp/im.test(ovpnContent)) {
          console.log('⚠️ [KILL-TCP] Perfil TCP detectado — explicit-exit-notify não suportado pelo protocolo; servidor pode demorar keepalive timeout para limpar sessão');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('vpn-log', '⚠️ Perfil TCP: servidor pode demorar para limpar sessão (keepalive timeout)\n');
          }
        }
      } catch (e) {
        console.log(`⚠️ [KILL-TCP] Não foi possível ler perfil ovpn para verificar proto: ${e.message}`);
      }
    }

    // Determina se bluepexPid é distinto do wrapper (conexão com pkexec/sudo)
    // hasSeparateOpenvpnPid = true  → há wrapper (pkexec/sudo) separado do openvpn
    // isDirectConnection     = true → vpnProcess IS o próprio openvpn (sem wrapper elevado)
    const hasSeparateOpenvpnPid = !!(bluepexPid && bluepexPid !== wrapperPid);
    const isDirectConnection = !hasSeparateOpenvpnPid;

    // =====================================================================
    // PASSO 1 — SIGTERM DIRETO NO PROCESSO OPENVPN para enviar explicit-exit-notify
    //
    // RAZÃO: pkexec NÃO repassa SIGTERM ao filho openvpn (openvpn receberia
    // SIGHUP, que trata como restart, nunca encerrando graciosamente).
    // Ao mandar SIGTERM diretamente no PID do openvpn, ele envia
    // explicit-exit-notify ao servidor UTM antes de encerrar.
    // =====================================================================
    if (hasSeparateOpenvpnPid && process.platform !== 'win32') {
      console.log(`🔌 [KILL-1] PASSO 1: kill -TERM ${bluepexPid} (pkexec/sudo) — SIGTERM direto no openvpn para enviar explicit-exit-notify ao servidor UTM`);
      const r = await sudoKillPid(bluepexPid, 'SIGTERM');
      logger.log('CONNECTION', 'DISCONNECT_SIGTERM_SENT', {
        pid: bluepexPid,
        wrapperPid,
        method: r.method,
        ok: r.ok,
        error: r.error,
        stderr: r.stderr,
        pkexecError: r.pkexecError,
        pkexecStderr: r.pkexecStderr,
        ovpnPath,
        purpose: 'explicit_exit_notify_udp'
      });
      if (r.ok === false) {
        logger.log('CONNECTION', 'DISCONNECT_SIGTERM_FAILED', {
          pid: bluepexPid,
          wrapperPid,
          method: r.method,
          error: r.error,
          stderr: r.stderr,
          pkexecError: r.pkexecError,
          pkexecStderr: r.pkexecStderr,
          ovpnPath,
          purpose: 'explicit_exit_notify_udp'
        }, 'ERROR');
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-log', `🔌 SIGTERM enviado ao OpenVPN PID ${bluepexPid} para notificar o servidor UDP\n`);
      }
      console.log(`   resultado: ok=${r.ok} method=${r.method}${r.error ? ` err=${r.error}` : ''}${r.stderr ? ` stderr=${r.stderr}` : ''}`);
      console.log('🔌 [KILL-1] Aguardando 8000ms para explicit-exit-notify (3 retransmissões UDP)...');
      await sleep(8000);

      if (verifyDisconnected()) {
        console.log('✅ [KILL-1] OpenVPN encerrado após SIGTERM direto — explicit-exit-notify enviado com sucesso; pulando passos seguintes');
      } else {
        console.log('⚠️ [KILL-1] OpenVPN ainda vivo após 8s; prosseguindo para PASSO 2');
      }
    } else if (isDirectConnection) {
      // Conexão direta (sem pkexec): vpnProcess IS o próprio openvpn
      // vpnProcess.kill('SIGTERM') entrega SIGTERM diretamente ao openvpn
      if (vpnProcess && !vpnProcess.killed) {
        console.log(`🔌 [KILL-1] PASSO 1 (direct): vpnProcess.kill(SIGTERM) PID=${vpnProcess.pid} — openvpn direto, enviando explicit-exit-notify`);
        try {
          const directPid = bluepexPid || vpnProcess.pid;
          vpnProcess.kill('SIGTERM');
          logger.log('CONNECTION', 'DISCONNECT_SIGTERM_SENT', {
            pid: directPid,
            wrapperPid,
            method: 'process.kill',
            ok: true,
            error: null,
            stderr: null,
            ovpnPath,
            purpose: 'explicit_exit_notify_udp'
          });
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('vpn-log', `🔌 SIGTERM enviado ao OpenVPN PID ${directPid} para notificar o servidor UDP\n`);
          }
        } catch (e) {
          console.log(`⚠️ vpnProcess TERM (direct): ${e.message}`);
          logger.log('CONNECTION', 'DISCONNECT_SIGTERM_FAILED', {
            pid: bluepexPid || vpnProcess.pid,
            wrapperPid,
            method: 'process.kill',
            error: e.message,
            stderr: null,
            ovpnPath,
            purpose: 'explicit_exit_notify_udp'
          }, 'ERROR');
        }
      }
      console.log('🔌 [KILL-1] Aguardando 8000ms para explicit-exit-notify (conexão direta)...');
      await sleep(8000);

      if (verifyDisconnected()) {
        console.log('✅ [KILL-1] OpenVPN direto encerrado após SIGTERM — explicit-exit-notify enviado');
      } else {
        console.log('⚠️ [KILL-1] OpenVPN direto ainda vivo após 8s; prosseguindo para PASSO 2');
      }
    } else if (bluepexPid && process.platform === 'win32') {
      console.log(`🔌 [KILL-1] PASSO 1 (Windows): taskkill /PID ${bluepexPid} /T`);
      await execCommand(`taskkill /PID ${bluepexPid} /T`);
      await sleep(4000);
    }

    // =====================================================================
    // PASSO 2 — SIGTERM NO WRAPPER (pkexec/sudo) para limpar árvore de processos
    //
    // Executado apenas se openvpn ainda estiver vivo após o PASSO 1.
    // =====================================================================
    if (!verifyDisconnected()) {
      console.log('🔌 [KILL-2] PASSO 2: SIGTERM no wrapper (pkexec/sudo) para limpar árvore de processos');

      if (vpnProcess && !vpnProcess.killed) {
        console.log(`   vpnProcess.kill(SIGTERM) PID=${vpnProcess.pid}`);
        try { vpnProcess.kill('SIGTERM'); } catch (e) { console.log(`⚠️ vpnProcess TERM: ${e.message}`); }
      }

      if (wrapperPid && wrapperPid !== bluepexPid) {
        console.log(`   process.kill(${wrapperPid}, SIGTERM) — wrapper`);
        try { process.kill(Number(wrapperPid), 'SIGTERM'); } catch (e) { console.log(`⚠️ wrapper TERM: ${e.message}`); }
      }

      await sleep(1500);
    }

    // =====================================================================
    // PASSO 3 — SIGKILL de limpeza (somente se ainda vivo após SIGTERM)
    // =====================================================================
    if (!verifyDisconnected()) {
      console.log('🔌 [KILL-3] PASSO 3: SIGKILL de limpeza (processo ainda vivo após todos os SIGTERM)');

      if (bluepexPid && process.platform !== 'win32') {
        console.log(`   kill -9 ${bluepexPid} (pkexec/sudo)`);
        const r = await sudoKillPid(bluepexPid, 'SIGKILL');
        console.log(`   KILL resultado: ok=${r.ok} method=${r.method}${r.error ? ` err=${r.error}` : ''}`);
      } else if (bluepexPid && process.platform === 'win32') {
        await execCommand(`taskkill /F /PID ${bluepexPid} /T`);
      }

      if (vpnProcess && !vpnProcess.killed) {
        try { vpnProcess.kill('SIGKILL'); } catch (e) { console.log(`⚠️ vpnProcess KILL: ${e.message}`); }
      }

      if (wrapperPid && wrapperPid !== bluepexPid) {
        try { process.kill(Number(wrapperPid), 'SIGKILL'); } catch (e) { console.log(`⚠️ wrapper KILL: ${e.message}`); }
      }

      await sleep(1000);
    }

    // Verificação final — baseada apenas no processo rastreado BluePex
    const disconnected = verifyDisconnected();

    if (!disconnected) {
      console.log('❌ Desconexão não confirmada: sessão BluePex rastreada ainda ativa');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vpn-log', '❌ Falha ao confirmar desconexão: sessão BluePex ainda ativa\n');
      }
      return {
        success: false,
        error: 'Não foi possível confirmar a desconexão da VPN BluePex rastreada.'
      };
    }

    stopTrafficStats('manual');

    await disableKillSwitch();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn-log', '✅ VPN desconectada com sucesso\n');
      stopTunnelHealthCheck();

      mainWindow.webContents.send('vpn-disconnected');
    }

    vpnProcess = null;
    vpnConnectionActive = false;
    currentOvpnPath = null;
    currentElevationMethod = null;
    clearBluepexConnectionMeta();

    console.log('✅ Conexão VPN finalizada (MÉTODO DO FECHAR)');
    return { success: true };

  } catch (error) {
    console.error('❌ Erro ao matar conexão VPN:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn-log', `❌ Erro na desconexão: ${error.message}\n`);
    }
    return { success: false, error: error.message };
  }
}

// RF011: Kill Switch — execPromise helper
const execPromise = (cmd) => new Promise((res, rej) => exec(cmd, (err, stdout, stderr) => err ? rej(err) : res(stdout)));

// RF011: Kill Switch — ativa bloqueio de rede exceto loopback e tun+
async function enableKillSwitch() {
  if (killSwitchActive) return;
  killSwitchActive = true;
  try {
    if (process.platform === 'linux') {
      const pkexecAvail = await checkPkexecAvailable();
      const sudo = pkexecAvail ? 'pkexec' : 'sudo';
      await execPromise(`${sudo} iptables -I OUTPUT 1 -o lo -j ACCEPT`);
      await execPromise(`${sudo} iptables -I OUTPUT 2 -o tun+ -j ACCEPT`);
      await execPromise(`${sudo} iptables -A OUTPUT -j DROP`);
    } else if (process.platform === 'win32') {
      await execPromise('powershell -NoProfile -Command "New-NetFirewallRule -DisplayName \'BluePexVPN-KillSwitch-Block\' -Direction Outbound -Action Block -Enabled True -Profile Any"').catch(() => {});
      await execPromise('powershell -NoProfile -Command "New-NetFirewallRule -DisplayName \'BluePexVPN-KillSwitch-Allow-VPN\' -Direction Outbound -Action Allow -InterfaceAlias \'*TAP*\',\'*tun*\',\'*OpenVPN*\' -Enabled True -Profile Any"').catch(() => {});
      await execPromise('powershell -NoProfile -Command "New-NetFirewallRule -DisplayName \'BluePexVPN-KillSwitch-Allow-Lo\' -Direction Outbound -Action Allow -InterfaceAlias \'Loopback*\' -Enabled True -Profile Any"').catch(() => {});
    }
  } catch (e) {
    killSwitchActive = false;
    logger.log('KILLSWITCH', 'ENABLE_ERROR', { error: e.message });
  }
}

// RF011: Kill Switch — remove bloqueio de rede
async function disableKillSwitch() {
  if (!killSwitchActive) return;
  try {
    if (process.platform === 'linux') {
      const pkexecAvail = await checkPkexecAvailable();
      const sudo = pkexecAvail ? 'pkexec' : 'sudo';
      await execPromise(`${sudo} iptables -D OUTPUT -j DROP`).catch(() => {});
      await execPromise(`${sudo} iptables -D OUTPUT -o tun+ -j ACCEPT`).catch(() => {});
      await execPromise(`${sudo} iptables -D OUTPUT -o lo -j ACCEPT`).catch(() => {});
    } else if (process.platform === 'win32') {
      await execPromise('powershell -NoProfile -Command "Remove-NetFirewallRule -DisplayName \'BluePexVPN-KillSwitch*\' -ErrorAction SilentlyContinue"').catch(() => {});
    }
    killSwitchActive = false;
  } catch (e) {
    logger.log('KILLSWITCH', 'DISABLE_ERROR', { error: e.message });
  }
}

// APENAS UM HANDLER - REMOVER O DUPLICADO!
ipcMain.handle('kill-vpn-connection', async () => {
  console.log('🔌 [MAIN] Executando kill-vpn-connection via IPC');
  // RF010: cancelar reconexão automática quando usuário desconectar manualmente via kill-vpn-connection
  cancelReconnect();
  suppressNextReconnect = true;
  return await killVPNConnection();
});

ipcMain.handle('disconnect-openvpn', async (event, pid) => {
  console.log(`🔌 [MAIN] Desconexão solicitada via disconnect-openvpn - PID: ${pid}`);
  // RF010: cancelar reconexão automática quando usuário desconectar manualmente
  cancelReconnect();
  return await killVPNConnection();
});

// RF011: Kill Switch — handlers IPC
ipcMain.handle('enable-kill-switch', async () => {
  killSwitchEnabled = true;
  return { success: true };
});

ipcMain.handle('disable-kill-switch', async () => {
  killSwitchEnabled = false;
  await disableKillSwitch();
  return { success: true };
});

ipcMain.handle('get-kill-switch-status', () => {
  return { enabled: killSwitchEnabled, active: killSwitchActive };
});

ipcMain.handle('get-memory-usage', () => {
  const m = process.memoryUsage();
  const rss = Math.round(m.rss / 1024 / 1024);
  const warningThreshold = 250;
  const criticalThreshold = 350;
  const level = rss >= criticalThreshold ? 'critical' : (rss >= warningThreshold ? 'warning' : 'normal');
  return {
    rss,
    heapUsed: Math.round(m.heapUsed / 1024 / 1024),
    heapTotal: Math.round(m.heapTotal / 1024 / 1024),
    external: Math.round(m.external / 1024 / 1024),
    arrayBuffers: Math.round(m.arrayBuffers / 1024 / 1024),
    threshold: warningThreshold,
    warningThreshold,
    criticalThreshold,
    level,
    exceeded: level !== 'normal',
    critical: level === 'critical'
  };
});

// RF010: handler interno de reconexão automática
ipcMain.on('internal-reconnect', (profileId, profileType) => {
  console.log(`🔄 [RF010] Tentando reconexão para perfil ${profileId} (tipo: ${profileType})`);
  if (profileType === 'azure') {
    ipcMain.emit('internal-invoke', 'connect-openvpn');
  } else {
    // Para perfis de usuário, emite sinal para o renderer iniciar o connect novamente
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn-auto-reconnect', { profileId, profileType });
    }
  }
});

// ============ VERIFICAÇÃO DE STATUS VPN ============

function normalizePathForCompare(value) {
  if (!value || typeof value !== 'string') return '';
  let normalized = value.replace(/^file:\/\//i, '').trim();
  try {
    normalized = path.resolve(normalized);
  } catch (_) {}
  if (process.platform === 'win32') {
    normalized = normalized.replace(/\\/g, '/').toLowerCase();
  }
  return normalized;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function getConfigPathFromArgs(args = []) {
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] || '');
    if (arg === '--config' && args[i + 1]) return String(args[i + 1]);
    if (arg.startsWith('--config=')) return arg.slice('--config='.length);
  }
  return null;
}

function getBluepexOvpnProfilesDirs() {
  const dirs = new Set();
  try {
    dirs.add(normalizePathForCompare(path.join(app.getPath('userData'), 'ovpn_profiles')));
  } catch (_) {}
  if (process.platform === 'linux' && process.env.HOME) {
    dirs.add(normalizePathForCompare(path.join(process.env.HOME, '.config', 'bluepex-vpn', 'ovpn_profiles')));
  }
  return [...dirs].filter(Boolean);
}

function isBluepexProfileConfigPath(configPath) {
  const normalizedConfig = normalizePathForCompare(configPath);
  if (!normalizedConfig) return false;
  return getBluepexOvpnProfilesDirs().some((profilesDir) => {
    const separator = process.platform === 'win32' ? '/' : path.sep;
    const prefix = profilesDir.endsWith(separator) || profilesDir.endsWith('/') ? profilesDir : `${profilesDir}${separator}`;
    return normalizedConfig === profilesDir || normalizedConfig.startsWith(prefix);
  });
}

function listBluepexOpenVpnProfileProcesses() {
  const processes = [];

  try {
    if (process.platform === 'linux') {
      const procEntries = fs.readdirSync('/proc').filter((entry) => /^\d+$/.test(entry));
      for (const pidText of procEntries) {
        const args = readLinuxCmdline(pidText);
        if (!args?.length) continue;
        const command = path.basename(args[0] || '').toLowerCase();
        if (!command.includes('openvpn')) continue;
        const configPath = getConfigPathFromArgs(args);
        if (!isBluepexProfileConfigPath(configPath)) continue;
        const pid = Number(pidText);
        if (Number.isInteger(pid) && pid > 0) {
          processes.push({ pid, configPath });
        }
      }
    } else if (process.platform === 'win32') {
      const output = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name=\'openvpn.exe\'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      const lines = output.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const [pidText, ...cmdParts] = line.split('|');
        const commandLine = cmdParts.join('|');
        const match = commandLine.match(/--config(?:=|\s+)("[^"]+"|'[^']+'|\S+)/i);
        const configPath = match ? match[1].replace(/^['"]|['"]$/g, '') : null;
        if (!isBluepexProfileConfigPath(configPath)) continue;
        const pid = Number(pidText);
        if (Number.isInteger(pid) && pid > 0) {
          processes.push({ pid, configPath });
        }
      }
    }
  } catch (error) {
    console.log(`⚠️ Falha ao listar OpenVPN BluePex por diretório de perfis: ${error.message}`);
  }

  return processes;
}

function getActiveBluepexOpenVpnProcesses(meta = loadTrackedBluepexMetaFromState()) {
  const processes = listBluepexOpenVpnProfileProcesses();
  const trackedPid = refreshTrackedBluepexPid(meta);

  if (trackedPid && !processes.some((processInfo) => processInfo.pid === trackedPid)) {
    processes.push({ pid: trackedPid, configPath: meta?.configPath || meta?.ovpnPath || null });
  }

  return processes;
}

function buildBluepexConnectionMeta({ connectionId, profileId, profileType, configPath, originalConfigPath = null, authFilePath, vpnPid = null, wrapperPid = null }) {
  const normalizedConfigPath = normalizePathForCompare(configPath);
  return {
    connectionOwner: 'bluepex',
    connectionId,
    profileId,
    profileType,
    ovpnPath: configPath,
    configPath,
    originalConfigPath: originalConfigPath || configPath,
    normalizedConfigPath,
    authFilePath: authFilePath || null,
    startedAt: new Date().toISOString(),
    vpnPid: vpnPid ? Number(vpnPid) : null,
    wrapperPid: wrapperPid ? Number(wrapperPid) : null,
    elevationMethod: currentElevationMethod || null
  };
}

function getBluepexStatePayload(meta = currentConnectionMeta) {
  if (!meta || meta.connectionOwner !== 'bluepex') return {};
  return {
    vpnConnected: true,
    connectionOwner: 'bluepex',
    connectionId: meta.connectionId || null,
    profileId: meta.profileId || null,
    profileType: meta.profileType || null,
    ovpnPath: meta.ovpnPath || meta.configPath || null,
    configPath: meta.configPath || meta.ovpnPath || null,
    authFilePath: meta.authFilePath || null,
    startedAt: meta.startedAt || null,
    vpnPid: meta.vpnPid || meta.wrapperPid || null,
    wrapperPid: meta.wrapperPid || null
  };
}

function persistBluepexConnectionMeta(meta = currentConnectionMeta) {
  if (!meta || meta.connectionOwner !== 'bluepex') return;
  try {
    const currentState = fs.existsSync(APP_STATE_PATH)
      ? JSON.parse(fs.readFileSync(APP_STATE_PATH, 'utf-8'))
      : {};
    const mergedState = {
      ...currentState,
      ...getBluepexStatePayload(meta),
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(APP_STATE_PATH, JSON.stringify(mergedState, null, 2));
  } catch (error) {
    console.log(`⚠️ Não foi possível persistir metadados BluePex: ${error.message}`);
  }
}

function clearBluepexConnectionMeta() {
  currentConnectionMeta = null;
  try {
    if (!fs.existsSync(APP_STATE_PATH)) return;
    const state = JSON.parse(fs.readFileSync(APP_STATE_PATH, 'utf-8'));
    const cleaned = {
      ...state,
      vpnConnected: false,
      vpnPid: null,
      wrapperPid: null,
      connectionOwner: null,
      connectionId: null,
      profileId: null,
      profileType: null,
      ovpnPath: null,
      configPath: null,
      authFilePath: null,
      startedAt: null,
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(APP_STATE_PATH, JSON.stringify(cleaned, null, 2));
  } catch (error) {
    console.log(`⚠️ Não foi possível limpar metadados BluePex: ${error.message}`);
  }
}

function loadTrackedBluepexMetaFromState() {
  if (currentConnectionMeta?.connectionOwner === 'bluepex') {
    return currentConnectionMeta;
  }

  try {
    if (!fs.existsSync(APP_STATE_PATH)) return null;
    const state = JSON.parse(fs.readFileSync(APP_STATE_PATH, 'utf-8'));
    if (state?.connectionOwner !== 'bluepex' || !state?.connectionId) return null;

    const configPath = state.configPath || state.ovpnPath;
    if (!configPath) return null;

    return {
      connectionOwner: 'bluepex',
      connectionId: state.connectionId,
      profileId: state.profileId || null,
      profileType: state.profileType || null,
      ovpnPath: state.ovpnPath || configPath,
      configPath,
      normalizedConfigPath: normalizePathForCompare(configPath),
      authFilePath: state.authFilePath || null,
      startedAt: state.startedAt || null,
      vpnPid: state.vpnPid ? Number(state.vpnPid) : null,
      wrapperPid: state.wrapperPid ? Number(state.wrapperPid) : null,
      elevationMethod: state.elevationMethod || null
    };
  } catch (error) {
    console.log(`⚠️ Não foi possível carregar metadados BluePex salvos: ${error.message}`);
    return null;
  }
}

function readLinuxCmdline(pid) {
  try {
    const cmdlinePath = `/proc/${Number(pid)}/cmdline`;
    if (!fs.existsSync(cmdlinePath)) return null;
    const raw = fs.readFileSync(cmdlinePath);
    return raw.toString('utf8').split('\0').filter(Boolean);
  } catch (_) {
    return null;
  }
}

function commandLineMatchesBluepexConfig(argsOrText, expectedConfigPath) {
  const expected = normalizePathForCompare(expectedConfigPath);
  if (!expected) return false;

  if (Array.isArray(argsOrText)) {
    const configArg = getConfigPathFromArgs(argsOrText);
    return normalizePathForCompare(configArg) === expected;
  }

  const text = String(argsOrText || '');
  if (!/--config(?:\s|=)/i.test(text)) return false;
  const comparable = process.platform === 'win32'
    ? text.replace(/\\/g, '/').toLowerCase()
    : text;
  return comparable.includes(expected);
}

function isBluepexOwnedPid(pid, meta = loadTrackedBluepexMetaFromState()) {
  const pidNumber = Number(pid);
  if (!Number.isInteger(pidNumber) || pidNumber <= 0 || !meta || meta.connectionOwner !== 'bluepex') {
    return false;
  }

  try {
    if (process.platform === 'linux') {
      const args = readLinuxCmdline(pidNumber);
      if (!args?.length) return false;
      const command = path.basename(args[0] || '').toLowerCase();
      if (!command.includes('openvpn')) return false;
      return commandLineMatchesBluepexConfig(args, meta.configPath || meta.ovpnPath);
    }

    if (process.platform === 'win32') {
      const psCommand = `powershell -NoProfile -Command "$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${pidNumber}\"; if ($p) { $p.Name; $p.CommandLine }"`;
      const output = execSync(psCommand, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (!/openvpn\.exe/i.test(output)) return false;
      return commandLineMatchesBluepexConfig(output, meta.configPath || meta.ovpnPath);
    }

    return false;
  } catch (error) {
    return false;
  }
}

function findRelatedOpenVpnPidByConfig(meta = loadTrackedBluepexMetaFromState()) {
  if (!meta?.configPath && !meta?.ovpnPath) return null;
  const expectedConfig = meta.configPath || meta.ovpnPath;

  try {
    if (process.platform === 'linux') {
      const procEntries = fs.readdirSync('/proc').filter((entry) => /^\d+$/.test(entry));
      for (const pid of procEntries) {
        const args = readLinuxCmdline(pid);
        if (!args?.length) continue;
        const command = path.basename(args[0] || '').toLowerCase();
        if (!command.includes('openvpn')) continue;
        if (commandLineMatchesBluepexConfig(args, expectedConfig)) {
          return Number(pid);
        }
      }
      return null;
    }

    if (process.platform === 'win32') {
      const output = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name=\'openvpn.exe\'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      const lines = output.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const [pidText, ...cmdParts] = line.split('|');
        if (commandLineMatchesBluepexConfig(cmdParts.join('|'), expectedConfig)) {
          const pid = Number(pidText);
          return Number.isInteger(pid) && pid > 0 ? pid : null;
        }
      }
      return null;
    }
  } catch (error) {
    console.log(`⚠️ Falha ao localizar OpenVPN por config BluePex: ${error.message}`);
  }

  return null;
}

function refreshTrackedBluepexPid(meta = loadTrackedBluepexMetaFromState()) {
  if (!meta) return null;
  if (meta.vpnPid && isBluepexOwnedPid(meta.vpnPid, meta)) {
    currentConnectionMeta = { ...meta, vpnPid: Number(meta.vpnPid) };
    return currentConnectionMeta.vpnPid;
  }

  const relatedPid = findRelatedOpenVpnPidByConfig(meta);
  if (relatedPid && isBluepexOwnedPid(relatedPid, { ...meta, vpnPid: relatedPid })) {
    currentConnectionMeta = { ...meta, vpnPid: relatedPid };
    persistBluepexConnectionMeta(currentConnectionMeta);
    return relatedPid;
  }

  return null;
}

function isPidAlive(pid) {
  const pidNumber = Number(pid);
  if (!Number.isInteger(pidNumber) || pidNumber <= 0) return false;

  try {
    if (process.platform === 'win32') {
      const output = execSync(`tasklist /FI "PID eq ${pidNumber}" /FO CSV /NH`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim();
      return !!output && !output.includes('No tasks are running');
    }

    process.kill(pidNumber, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function detectLocalVpnInterfaceState() {
  if (process.platform !== 'linux') {
    return { connected: false, detail: 'unsupported-platform' };
  }

  try {
    const addrOutput = execSync('ip -o addr show', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000
    });
    const routeOutput = execSync('ip route show', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000
    });
    const vpnInterfacePattern = /\b(?:tun|tap|ovpn)\w*\b/i;
    const privateIpPattern = /\binet\s+(?:10\.|172\.(?:1[6-9]|2\d|3[0-1])\.|192\.168\.)/;
    const addrLines = addrOutput.split(/\r?\n/).filter((line) => vpnInterfacePattern.test(line));
    const routeLines = routeOutput.split(/\r?\n/).filter((line) => /\bdev\s+(?:tun|tap|ovpn)\w*\b/i.test(line));
    const hasPrivateVpnAddress = addrLines.some((line) => privateIpPattern.test(line));
    const hasVpnRoute = routeLines.length > 0;
    const connected = addrLines.length > 0 && (hasPrivateVpnAddress || hasVpnRoute);
    const interfaces = [...new Set(addrLines.map((line) => {
      const match = line.match(/^\d+:\s+([^\s:]+)[:\s]/);
      return match ? match[1].replace(/@.*$/, '') : null;
    }).filter(Boolean))];
    const detailParts = [];
    if (interfaces.length) detailParts.push(`ifaces=${interfaces.join(',')}`);
    if (hasPrivateVpnAddress) detailParts.push('private_addr=true');
    if (hasVpnRoute) detailParts.push(`routes=${routeLines.length}`);
    return { connected, detail: detailParts.join(' ') || 'no-vpn-interface-state' };
  } catch (error) {
    return { connected: false, detail: `detect-error:${error.message}` };
  }
}

function isVpnPidRunning(pid) {
  const pidNumber = Number(pid);
  if (!Number.isInteger(pidNumber) || pidNumber <= 0) {
    return false;
  }

  try {
    if (process.platform === 'win32') {
      const output = execSync(
        `tasklist /FI "PID eq ${pidNumber}" /FI "IMAGENAME eq openvpn.exe" /FO CSV /NH`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      ).trim();

      if (!output || output.includes('No tasks are running')) {
        return false;
      }

      return output.toLowerCase().includes('openvpn.exe');
    }

    process.kill(pidNumber, 0);
    const processName = execSync(`ps -p ${pidNumber} -o comm=`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim().toLowerCase();

    return processName.includes('openvpn');
  } catch (error) {
    return false;
  }
}

function getTrackedVpnPid() {
  if (vpnProcess?.pid) {
    return currentConnectionMeta?.vpnPid || vpnProcess.pid;
  }

  try {
    if (!fs.existsSync(APP_STATE_PATH)) {
      return null;
    }

    const state = JSON.parse(fs.readFileSync(APP_STATE_PATH, 'utf-8'));
    const pid = Number(state?.vpnPid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (error) {
    return null;
  }
}

function hasAnyOpenVpnProcess() {
  try {
    if (process.platform === 'win32') {
      const output = execSync(
        'tasklist /FI "IMAGENAME eq openvpn.exe" /FO CSV /NH',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      ).trim();

      if (!output || output.includes('No tasks are running')) {
        return false;
      }

      return output.toLowerCase().includes('openvpn.exe');
    }

    execSync('pgrep -x openvpn', { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch (error) {
    return false;
  }
}

function isVpnSessionActive() {
  const bluepexPid = refreshTrackedBluepexPid();
  if (bluepexPid) {
    vpnConnectionActive = true;
    return true;
  }

  if (hasAnyOpenVpnProcess()) {
    console.log('ℹ️ OpenVPN externo detectado, ignorado para estado/bloqueio BluePex');
  }

  vpnConnectionActive = false;
  return false;
}

ipcMain.handle('check-vpn-status', async (event, savedPid) => {
  console.log(`🔍 [MAIN] Verificando status da VPN para PID: ${savedPid}`);
  
  try {
    const meta = loadTrackedBluepexMetaFromState();
    const pidToCheck = savedPid || meta?.vpnPid || getTrackedVpnPid();

    if (pidToCheck && isBluepexOwnedPid(pidToCheck, meta)) {
      vpnConnectionActive = true;
      console.log(`✅ [MAIN] VPN ainda está ativa (PID: ${pidToCheck})`);
      return { connected: true, pid: Number(pidToCheck) };
    }

    const bluepexPid = refreshTrackedBluepexPid(meta);
    if (bluepexPid) {
      vpnConnectionActive = true;
      return { connected: true, pid: Number(bluepexPid) };
    }

    if (hasAnyOpenVpnProcess()) {
      console.log('ℹ️ [MAIN] OpenVPN externo ativo não será tratado como conexão BluePex');
    }

    console.log(`❌ [MAIN] VPN não está ativa para PID: ${pidToCheck}`);
    if (vpnProcess && vpnProcess.pid === Number(pidToCheck)) {
      vpnProcess = null;
    }
    vpnConnectionActive = false;
    
    return { connected: false, pid: null };
  } catch (error) {
    console.error('❌ [MAIN] Erro ao verificar status VPN:', error);
    return { connected: false, pid: null, error: error.message };
  }
});

// ============ FUNÇÕES AUXILIARES ============

ipcMain.handle('validate-openvpn-config', async () => {
  return new Promise(async (resolve) => {
    if (!fs.existsSync(config.openvpn_config)) {
      resolve({ valid: false, error: 'Arquivo de configuração OpenVPN não encontrado' });
      return;
    }

    try {
      const content = fs.readFileSync(config.openvpn_config, 'utf-8');
      const lines = content.split('\n');

      const hasRemote = hasDirective(content, 'remote');
      const hasCa = hasDirective(content, 'ca') || hasInlineBlock(content, 'ca');
      const hasCert = hasDirective(content, 'cert') || hasInlineBlock(content, 'cert');
      const hasKey = hasDirective(content, 'key') || hasInlineBlock(content, 'key');
      const clientCertDisabled = hasClientCertDisabled(content);

      if (!hasRemote) {
        resolve({ valid: false, error: 'Configuração não possui servidor remoto (remote)' });
        return;
      }

      if (!hasCa) {
        resolve({ valid: false, error: 'Configuração não possui certificado CA' });
        return;
      }

      if (!clientCertDisabled && (hasCert !== hasKey)) {
        resolve({ valid: false, error: 'Configuração possui cert/key incompletos' });
        return;
      }

      resolve({
        valid: true,
        info: {
          hasRemote,
          hasCa,
          hasCert,
          hasKey,
          clientCertDisabled,
          lineCount: lines.length
        }
      });
    } catch (error) {
      resolve({ valid: false, error: `Erro ao ler arquivo: ${error.message}` });
    }
  });
});

ipcMain.handle('get-azure-app-config', async () => {
  try {
    logger.log('AZURE', 'GET_CONFIG_START');

    const azureConfig = {
      client_id: config.client_id || '',
      tenant_id: config.tenant_id || '',
      scope: config.scope || '',
      server_api: config.server_api || ''
    };

    logger.log('AZURE', 'GET_CONFIG_SUCCESS', {
      hasClientId: !!azureConfig.client_id,
      hasTenantId: !!azureConfig.tenant_id,
      hasScope: !!azureConfig.scope,
      hasServerApi: !!azureConfig.server_api
    });

    return {
      success: true,
      config: azureConfig
    };
   } catch (error) {
    logger.logSystemError('AZURE_GET_CONFIG_FAILED', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('get-app-logs', async () => {
  try {
    const logs = await logger.getRecentLogs();
    return { success: true, logs };
  } catch (error) {
    logger.log('SYSTEM', 'GET_APP_LOGS_ERROR', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-connection-logs', async () => {
  try {
    const fs = require('fs');
    const path = require('path');

    // Diretório de logs baseado na plataforma
    let logDir;
    if (process.platform === 'win32') {
      logDir = path.join(process.env.APPDATA, 'BluePexVPN', 'logs');
    } else {
      logDir = '/var/log/bluepex-vpn';
    }

    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `data_${today}.log`);

    let content = '';

    // Verificar se o diretório e arquivo existem
    if (fs.existsSync(logDir) && fs.existsSync(logFile)) {
      const fileLogs = fs.readFileSync(logFile, 'utf8');
      if (fileLogs.trim() !== '') {
        content = fileLogs;
      }
    }

    return { success: true, logs: content };
  } catch (error) {
    logger.log('SYSTEM', 'GET_CONNECTION_LOGS_ERROR', { error: error.message });
    return { success: false, error: error.message };
  }
});


ipcMain.handle('save-azure-app-config', async (event, newConfig) => {
  try {
    logger.log('AZURE', 'SAVE_CONFIG_START', {
      hasClientId: !!newConfig.client_id,
      hasTenantId: !!newConfig.tenant_id,
      hasScope: !!newConfig.scope,
      hasServerApi: !!newConfig.server_api
    });

    if (!newConfig.client_id || !newConfig.tenant_id) {
      logger.log('AZURE', 'SAVE_CONFIG_VALIDATION_FAILED', {
        hasClientId: !!newConfig.client_id,
        hasTenantId: !!newConfig.tenant_id
      }, 'WARN');
      return {
        success: false,
        error: 'Client ID e Tenant ID são obrigatórios'
      };
    }

    const changes = {};
    if (config.client_id !== newConfig.client_id) changes.client_id = { old: config.client_id, new: newConfig.client_id };
    if (config.tenant_id !== newConfig.tenant_id) changes.tenant_id = { old: config.tenant_id, new: newConfig.tenant_id };
    if (config.scope !== newConfig.scope) changes.scope = { old: config.scope, new: newConfig.scope };
    if (config.server_api !== newConfig.server_api) changes.server_api = { old: config.server_api, new: newConfig.server_api };

    config.client_id = newConfig.client_id;
    config.tenant_id = newConfig.tenant_id;
    config.scope = newConfig.scope || config.scope;
    config.server_api = newConfig.server_api || config.server_api;

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    logger.log('AZURE', 'SAVE_CONFIG_SUCCESS', {
      changes: Object.keys(changes).length,
      changesDetail: changes
    });

    return { success: true };
  } catch (error) {
    logger.logSystemError('AZURE_SAVE_CONFIG_FAILED', error, {
      configKeys: Object.keys(newConfig || {})
    });
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('check-for-updates', async (event, showDialog = true) => {
  try {
    return await withTimeout(
      updaterManager.checkForUpdates(showDialog),
      UPDATE_IPC_TIMEOUT_MS,
      'Tempo esgotado ao verificar atualizações.'
    );
  } catch (error) {
    logger.logSystemError('CHECK_UPDATES_FAILED', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    if (updaterManager.updateAvailable) {
      autoUpdater.downloadUpdate();
      return { success: true };
    } else {
      return { success: false, error: 'Nenhuma atualização disponível' };
    }
  } catch (error) {
    logger.logSystemError('DOWNLOAD_UPDATE_FAILED', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-update', async () => {
  try {
    autoUpdater.quitAndInstall();
    return { success: true };
  } catch (error) {
    logger.logSystemError('INSTALL_UPDATE_FAILED', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-update-status', async () => {
  return updaterManager.getStatus();
});

ipcMain.handle('get-current-config', async () => {
  return {
    success: true,
    config: {
      userOvpnFile: null,
      azureOvpnFile: config.openvpn_config,
      azureOvpnFileName: path.basename(config.openvpn_config, '.ovpn')
    }
  };
});

// Handler para logs do renderer
ipcMain.handle('send-renderer-log', async (event, logData) => {
  logger.log(logData.category, logData.action, logData.data, logData.level);
});

ipcMain.on('adjust-window-size', (event, { width, height }) => {
  if (mainWindow) {
    const settings = loadAppSettings();
    if (settings.compactMode) return;
    mainWindow.setSize(width, Math.min(height, 800));
  }
});

ipcMain.handle('quit-app', async () => {
  if (isVpnSessionActive()) {
    const activePid = getTrackedVpnPid();
    const bluepexProcesses = getActiveBluepexOpenVpnProcesses();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn-status', 'Desconecte da VPN antes de sair do aplicativo.');
    }
    return { success: false, blocked: true, reason: 'vpn_active', pid: activePid, pids: bluepexProcesses.map((processInfo) => processInfo.pid), bluepexProcesses };
  }

  app.quit();
  return { success: true };
});

// ============ RNF012: LOGO CUSTOMIZADO ============

ipcMain.handle('save-custom-logo', (event, base64) => {
  try {
    fs.writeFileSync(CUSTOM_LOGO_PATH, base64, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-custom-logo', () => {
  try {
    if (!fs.existsSync(CUSTOM_LOGO_PATH)) return { success: false };
    const data = fs.readFileSync(CUSTOM_LOGO_PATH, 'utf8');
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-custom-logo', () => {
  try {
    if (fs.existsSync(CUSTOM_LOGO_PATH)) fs.unlinkSync(CUSTOM_LOGO_PATH);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-app-icon', (event, base64OrNull) => {
  try {
    const { nativeImage } = require('electron');
    let img;
    if (base64OrNull) {
      const buf = Buffer.from(base64OrNull.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      img = nativeImage.createFromBuffer(buf);
    } else {
      const iconExt = process.platform === 'win32' ? 'ico' : 'png';
      img = nativeImage.createFromPath(path.join(__dirname, `icon.${iconExt}`));
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setIcon(img);
    if (tray && !tray.isDestroyed()) tray.setImage(img);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============ FUNÇÃO PARA SALVAR ESTADO DA APLICAÇÃO ============

async function saveApplicationState() {
  const statePath = APP_STATE_PATH;
  try {
    const appState = {
      version: app.getVersion(),
      lastSaved: new Date().toISOString(),
      platform: process.platform,
      userData: app.getPath('userData')
    };

    await fsAsync.writeFile(statePath, JSON.stringify(appState, null, 2));
    logger.log('SYSTEM', 'APP_STATE_SAVED', {
      statePath,
      version: appState.version,
      platform: appState.platform
    });
  } catch (error) {
    logger.logSystemError('APP_STATE_SAVE_FAILED', error, { statePath });
  }
}
