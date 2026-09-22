const { contextBridge, ipcRenderer } = require('electron');

// Send log to main process
ipcRenderer.invoke('send-renderer-log', {
  category: 'PRELOAD',
  action: 'INIT_START',
  data: {
    nodeEnv: process.env.NODE_ENV,
    platform: process.platform,
    contextBridge: typeof contextBridge,
    ipcRenderer: typeof ipcRenderer,
    window: typeof window
  }
});

globalThis.electronAPI = {
  // Autenticação Azure
  loginAzure: (profileId) => ipcRenderer.invoke('login-azure', profileId),
  publishToken: (username, token, profileId) => ipcRenderer.invoke('publish-token', username, token, profileId),

  // Conexões VPN
  connectOpenVPN: () => ipcRenderer.invoke('connect-openvpn'),
  disconnectOpenVPN: (pid) => ipcRenderer.invoke('disconnect-openvpn', pid),
  killVPNConnection: () => ipcRenderer.invoke('kill-vpn-connection'),
  connectOpenVPNUserPassProfile: (profileId, username, password, totpToken) =>
  ipcRenderer.invoke('connect-openvpn-userpass-profile', profileId, username, password, totpToken),

  // Gestão de Arquivos
  selectOvpnFile: () => ipcRenderer.invoke('select-ovpn-file'),
  validateOpenVPNConfig: () => ipcRenderer.invoke('validate-openvpn-config'),

  // Perfis Usuário
  loadUserProfiles: () => ipcRenderer.invoke('load-user-profiles'),
  saveUserProfile: (profile) => ipcRenderer.invoke('save-user-profile', profile),
  deleteUserProfile: (profileId) => ipcRenderer.invoke('delete-user-profile', profileId),
  saveOvpnToProfile: (profileId, ovpnContent, ovpnFileName, originalOvpnPath) =>
  ipcRenderer.invoke('save-ovpn-to-profile', profileId, ovpnContent, ovpnFileName, originalOvpnPath),

  // Credenciais
  saveUserCredentials: (profileId, username, password, rememberPassword) =>
  ipcRenderer.invoke('save-user-credentials', profileId, username, password, rememberPassword),
  loadUserCredentials: (profileId) => ipcRenderer.invoke('load-user-credentials', profileId),

  // Perfis Azure
  saveAzureConfig: (profileId, ovpnContent, ovpnFileName, originalOvpnPath) =>
  ipcRenderer.invoke('save-azure-config', profileId, ovpnContent, ovpnFileName, originalOvpnPath),
  loadAzureProfiles: () => ipcRenderer.invoke('load-azure-profiles'),
  saveAzureProfile: (profile) => ipcRenderer.invoke('save-azure-profile', profile),
  deleteAzureProfile: (profileId) => ipcRenderer.invoke('delete-azure-profile', profileId),

  // Configurações
  getCurrentConfig: () => ipcRenderer.invoke('get-current-config'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  getAzureAppConfig: () => ipcRenderer.invoke('get-azure-app-config'),
  saveAzureAppConfig: (config) => ipcRenderer.invoke('save-azure-app-config', config),

  // Remove all listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // Configurações padrão
  saveDefaultProfiles: (defaultProfiles) => ipcRenderer.invoke('save-default-profiles', defaultProfiles),
  loadDefaultProfiles: () => ipcRenderer.invoke('load-default-profiles'),

  // Estado da aplicação
  saveAppState: (appState) => ipcRenderer.invoke('save-app-state', appState),
  loadAppState: () => ipcRenderer.invoke('load-app-state'),

  // Sistema de atualizações
  checkForUpdates: (showDialog) => ipcRenderer.invoke('check-for-updates', showDialog),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),

  // Detecção de 2FA
  detect2FARequirement: (profileId) => ipcRenderer.invoke('detect-2fa-requirement', profileId),
  prepareLinuxElevation: (profileId) => ipcRenderer.invoke('prepare-linux-elevation', profileId),

  // Desafio de autenticação
  sendChallengeResponse: (response) => ipcRenderer.invoke('send-challenge-response', response),
  cancelChallengeResponse: () => ipcRenderer.invoke('cancel-challenge-response'),
  cancelChallenge: () => ipcRenderer.invoke('cancel-challenge'),
  onVpnChallenge: (callback) => ipcRenderer.on('vpn-challenge', (event, data) => {
    ipcRenderer.invoke('send-renderer-log', {
      category: 'PRELOAD',
      action: 'VPN_CHALLENGE_RECEIVED',
      data: data
    });
    callback(event, data);
  }),
  onVpnChallengeExpired: (callback) => ipcRenderer.on('vpn-challenge-expired', callback),
  sendSystemdChallengeResponse: (response) => ipcRenderer.invoke('send-systemd-challenge-response', response),
  sendSudoPassword: (password) => ipcRenderer.invoke('send-sudo-password', password),

   // Eventos de atualização
   onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
   onUpdateProgress: (callback) => ipcRenderer.on('update-progress', callback),
   onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
   onUpdateError: (callback) => ipcRenderer.on('update-error', callback),
   onUpdateCheckComplete: (callback) => ipcRenderer.on('update-check-complete', callback),
   onUpdateDownloadStarted: (callback) => ipcRenderer.on('update-download-started', callback),
   downloadUpdate: () => ipcRenderer.invoke('download-update'),
   installUpdate: () => ipcRenderer.invoke('install-update'),
   startUpdateDownload: () => ipcRenderer.invoke('start-update-download'),
   quitAndInstallUpdate: () => ipcRenderer.invoke('quit-and-install-update'),

  // Sistema de logging do renderer
  sendLog: (logData) => ipcRenderer.invoke('send-renderer-log', logData),

  // Event Listeners
  onVPNDisconnected: (callback) => ipcRenderer.on('vpn-disconnected', callback),
  onVPNConnected: (callback) => ipcRenderer.on('vpn-connected', callback),
  onVPNLog: (callback) => ipcRenderer.on('vpn-log', callback),

   // Minimizar para tray
   minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),

   // Controles da janela
   minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
   closeWindow: () => ipcRenderer.invoke('close-window'),

   getPlatform: () => ipcRenderer.invoke('get-platform'),

   // Obter versão da aplicação
   getVersion: () => ipcRenderer.invoke('get-version'),

    // Logs da aplicação
    getAppLogs: () => ipcRenderer.invoke('get-app-logs'),

   // Logs de conexão
   getConnectionLogs: () => ipcRenderer.invoke('get-connection-logs'),

   // Verificação de status VPN
   checkVpnStatus: (savedPid) => ipcRenderer.invoke('check-vpn-status', savedPid),

   // Azure device code
   onDeviceCodeResponse: (callback) => ipcRenderer.on('device-code-response', callback),

   // Abrir URL externa no navegador padrão
   openExternal: (url) => ipcRenderer.invoke('open-external', url),

   // IS003: notificação de OpenVPN não encontrado
   onOpenVpnNotFound: (callback) => ipcRenderer.on('openvpn-not-found', (_, data) => callback(data)),

   // RF004: logout e limpeza de sessão
   logout: () => ipcRenderer.invoke('logout'),
   onSessionCleared: (callback) => ipcRenderer.on('session-cleared', callback),

   // RF010: reconexão automática
   onVpnReconnecting: (callback) => ipcRenderer.on('vpn-reconnecting', (_, data) => callback(data)),
   onVpnReconnectFailed: (callback) => ipcRenderer.on('vpn-reconnect-failed', (_, data) => callback(data)),
   onVpnAutoReconnect: (callback) => ipcRenderer.on('vpn-auto-reconnect', (_, data) => callback(data)),

   // RF011: Kill Switch
   enableKillSwitch: () => ipcRenderer.invoke('enable-kill-switch'),
   disableKillSwitch: () => ipcRenderer.invoke('disable-kill-switch'),
   getKillSwitchStatus: () => ipcRenderer.invoke('get-kill-switch-status'),

   // RNF014b: Gráfico de tráfego e histórico de conexões
   getConnectionHistory: () => ipcRenderer.invoke('get-connection-history'),
   onVpnTrafficStats: (cb) => ipcRenderer.on('vpn-traffic-stats', (_, data) => cb(data)),
   removeVpnTrafficStatsListener: () => ipcRenderer.removeAllListeners('vpn-traffic-stats'),

   // RNF014: Settings persistentes
   loadAppSettings: () => ipcRenderer.invoke('load-app-settings'),
   saveAppSettings: (settings) => ipcRenderer.invoke('save-app-settings', settings),

   // RNF013: Modo compacto
   setCompactMode: (enabled) => ipcRenderer.invoke('set-compact-mode', enabled),

   // RNF012: Logo customizado
   saveCustomLogo: (base64) => ipcRenderer.invoke('save-custom-logo', base64),
   loadCustomLogo: () => ipcRenderer.invoke('load-custom-logo'),
   removeCustomLogo: () => ipcRenderer.invoke('remove-custom-logo'),
    setAppIcon: (base64OrNull) => ipcRenderer.invoke('set-app-icon', base64OrNull),

    // RNF003: monitoramento de consumo de RAM
    getMemoryUsage: () => ipcRenderer.invoke('get-memory-usage'),
};

// Send success log
ipcRenderer.invoke('send-renderer-log', {
  category: 'PRELOAD',
  action: 'API_EXPOSED',
  data: {
    electronAPI: typeof globalThis.electronAPI,
    functionsCount: Object.keys(globalThis.electronAPI || {}).length
  }
});
