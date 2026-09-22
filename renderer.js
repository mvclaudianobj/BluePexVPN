// ============ TESTE SIMPLES ============

console.log('🔧 RENDERER.JS CARREGADO!');

// ============ IPC HANDLERS ============
const { ipcRenderer } = require('electron');
// ============ SISTEMA DE LOGGING DO RENDERER ============

// Função para enviar logs do renderer para o main process
function logToMain(category, action, data = {}, level = "INFO") {
// Aguardar DOM carregar antes de configurar listeners
    if (window.electronAPI && window.electronAPI.sendLog) {
        window.electronAPI.sendLog({ category, action, data, level });
    }
}

// ============ VARIÁVEIS GLOBAIS ============

// Estado da aplicação unificado
let vpnPid = null;
let currentProfile = null; // Perfil selecionado atualmente
let allProfiles = []; // Todos os perfis disponíveis (user + azure)

// Estado de atualização
let updateInfo = null;

function setUpdateDownloadState(state) {
    const updateDownloadBtn = document.getElementById('updateDownloadBtn');
    const updateInstallBtn = document.getElementById('updateInstallBtn');
    const updateProgress = document.getElementById('updateProgress');
    const updatePhase = document.getElementById('updatePhase');
    const updateSpinner = document.querySelector('#updateProgress .update-spinner');

    if (state === 'ready') {
        if (updateDownloadBtn) {
            updateDownloadBtn.style.display = 'block';
            updateDownloadBtn.disabled = false;
        }
        if (updateInstallBtn) updateInstallBtn.style.display = 'none';
        if (updateProgress) updateProgress.style.display = 'none';
        if (updateSpinner) updateSpinner.style.display = 'block';
        if (updatePhase) updatePhase.textContent = 'Baixando atualização...';
        return;
    }

    if (state === 'downloading') {
        if (updateDownloadBtn) {
            updateDownloadBtn.style.display = 'none';
            updateDownloadBtn.disabled = true;
        }
        if (updateInstallBtn) updateInstallBtn.style.display = 'none';
        if (updateProgress) updateProgress.style.display = 'block';
        if (updateSpinner) updateSpinner.style.display = 'block';
        if (updatePhase) updatePhase.textContent = 'Baixando atualização...';
        return;
    }

    if (state === 'downloaded') {
        if (updateDownloadBtn) updateDownloadBtn.style.display = 'none';
        if (updateInstallBtn) updateInstallBtn.style.display = 'block';
        if (updateProgress) updateProgress.style.display = 'none';
        if (updateSpinner) updateSpinner.style.display = 'none';
        if (updatePhase) updatePhase.textContent = 'Pronto para instalar!';
        return;
    }

    if (state === 'installing') {
        if (updateDownloadBtn) updateDownloadBtn.style.display = 'none';
        if (updateInstallBtn) updateInstallBtn.style.display = 'none';
        if (updateProgress) updateProgress.style.display = 'block';
        if (updateSpinner) updateSpinner.style.display = 'block';
        if (updatePhase) updatePhase.textContent = 'Instalando atualização...';
        return;
    }

    if (state === 'error') {
        if (updateDownloadBtn) {
            updateDownloadBtn.style.display = 'block';
            updateDownloadBtn.disabled = false;
        }
        if (updateInstallBtn) updateInstallBtn.style.display = 'none';
        if (updateProgress) updateProgress.style.display = 'none';
        if (updateSpinner) updateSpinner.style.display = 'none';
    }
}

// Logs armazenados em memória (removidos da interface principal)

// Watcher para arquivo de logs

ipcRenderer.on('vpn-status', (event, message) => {
  showStatus(message, 'alert');
});

ipcRenderer.on('vpn-log', (event, log) => {
  // Garantir que log seja string
  const logStr = typeof log === 'string' ? log : JSON.stringify(log);
  // Adicionar ao logs em tempo real
  if (typeof connectionLogsText !== 'undefined') {
    connectionLogsText += logStr;
  }
  // Se modal estiver aberto, atualizar e rolar
  if (connLogsModal && connLogsModal.classList.contains('show') && connLogsModalContent) {
    connLogsModalContent.textContent += logStr;
    connLogsModalContent.scrollTop = connLogsModalContent.scrollHeight;
  }
});

ipcRenderer.on('vpn-status-check', (event, data) => {
  if (data.active) {
    vpnPid = data.processes[0].pid; // Assumir primeiro
    showStatus('VPN detectada ativa (PID: ' + vpnPid + ')', 'success');
    updateConnectionButtons();
  }
});

// Ajustar tamanho da janela dinamicamente
function adjustWindowSize() {
  const body = document.body;
  const height = body.scrollHeight + 20; // Margem
  const width = 780; // Largura fixa
  ipcRenderer.send('adjust-window-size', { width, height });
}

// Chamar após mudanças no DOM
let adjustWindowPaused = false;
const observer = new MutationObserver(() => { if (!adjustWindowPaused) adjustWindowSize(); });
observer.observe(document.body, { childList: true, subtree: true });

// Ajustar inicialmente
window.addEventListener('load', () => {
});

// Teste básico do botão menu
document.addEventListener('DOMContentLoaded', function() {
    console.log('🎯 DOM CARREGADO!');

    // Update copyright with dynamic year and version
    updateCopyright();

    const menuBtn = document.getElementById('menuBtn');
    const configModal = document.getElementById('configModal');

    console.log('🔍 menuBtn encontrado:', !!menuBtn);
    console.log('🔍 configModal encontrado:', !!configModal);

    // Removed duplicate closeBtn declaration

    if (menuBtn) {
        menuBtn.addEventListener('click', function() {
            console.log('🖱️ BOTÃO MENU CLICADO!');
            //alert('Botão menu clicado!');

            if (configModal) {
                configModal.style.display = configModal.style.display === 'block' ? 'none' : 'block';
                console.log('🔄 Modal display:', configModal.style.display);
            } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
                alert('Modal não encontrado!');
            }
        });
        console.log('✅ Event listener adicionado');
    } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        console.error('❌ menuBtn não encontrado');
        alert('menuBtn não encontrado!');
    }

    // Update copyright with dynamic year and version
    updateCopyright();

    // Window controls (moved to initializeApp to avoid duplicates)
    // minimizeBtn, windowMinimizeBtn, windowCloseBtn, minimizeToTrayBtn handlers are in initializeApp

    // Inicializar aplicação
    initializeApp();
});

// Variáveis globais
let selectedOvpnFile = null;
let selectedAzureOvpnFile = null;

// Elementos da Interface Unificada
const statusEl = document.getElementById('status');
const profileSelect = document.getElementById('profileSelect');
const configureProfilesLink = document.getElementById('configureProfilesLink');
const configureProfilesWrapper = document.getElementById('configureProfilesWrapper');
const selectedProfileInfo = document.getElementById('selectedProfileInfo');
const profileIcon = document.getElementById('profileIcon');
const profileName = document.getElementById('profileName');
const profileType = document.getElementById('profileType');
const profileDetails = document.getElementById('profileDetails');
const credentialsSection = document.getElementById('credentialsSection');
const btnConectar = document.getElementById('btnConectar');
const btnDesconectar = document.getElementById('btnDesconectar');
const btnCopiarCodigo = document.getElementById('btnCopiarCodigo');

// Elementos do Menu e Configurações
const menuBtn = document.getElementById('menuBtn');
const configModal = document.getElementById('configModal');
const configCloseBtn = document.getElementById('configCloseBtn');
const configStatusEl = document.getElementById('configStatus');

// Elementos de Credenciais
const userUsername = document.getElementById('userUsername');
const userPassword = document.getElementById('userPassword');
const toggleUserPassword = document.getElementById('toggleUserPassword');
const toggleUserPasswordIcon = document.getElementById('toggleUserPasswordIcon');
const rememberCredentials = document.getElementById('rememberCredentials');

// Elementos de Configuração
const configSelectOvpn = document.getElementById('configSelectOvpn');
const configOvpnInfo = document.getElementById('configOvpnInfo');
const configOvpnName = document.getElementById('configOvpnName');
const configProfilesList = document.getElementById('configProfilesList');
const configSaveProfile = document.getElementById('configSaveProfile');
const configProfileName = document.getElementById('configProfileName');

const configSelectAzureOvpn = document.getElementById('configSelectAzureOvpn');
const configAzureOvpnInfo = document.getElementById('configAzureOvpnInfo');
const configAzureOvpnName = document.getElementById('configAzureOvpnName');
const configAzureProfilesList = document.getElementById('configAzureProfilesList');
const configSaveAzureProfile = document.getElementById('configSaveAzureProfile');
const configAzureProfileName = document.getElementById('configAzureProfileName');

// Botões de configuração
const configSaveUserProfile = document.getElementById('configSaveUserProfile');
const configSaveAzureProfileBtn = document.getElementById('configSaveAzureProfileBtn');

// Elementos de atualização
const updateBtn = document.getElementById('updateBtn');
const updateModal = document.getElementById('updateModal');
const updateCloseBtn = document.getElementById('updateCloseBtn');
const UPDATE_CHECK_TIMEOUT_MS = 40000;
const updateBtnDefaultHtml = updateBtn ? updateBtn.innerHTML : '';
let isManualUpdateCheckRunning = false;

// Garantir que o modal esteja escondido inicialmente
if (updateModal) {
    updateModal.style.display = 'none';
}

// Elementos de Device Code (Azure)
const deviceCodeSection = document.getElementById('deviceCodeSection');
const verificationUri = document.getElementById('verificationUri');
const userCode = document.getElementById('userCode');

// Elementos de Logs (serão definidos dentro das funções para garantir que o DOM esteja pronto)
let logsBtn, connLogsModal, connLogsModalContent, closeLogsModalBtn, clearLogsBtn;
let appLogsBtn, appLogsModal, appLogsCloseBtn, appLogsModalContent;

    if (configCloseBtn) {
        configCloseBtn.addEventListener('click', function(event) {
            console.log('🖱️ Botão fechar clicado!', event);
            logToMain('RENDERER', 'CLOSE_BUTTON_CLICKED', {
                button: configCloseBtn.outerHTML,
                eventType: event.type,
                target: event.target.id
            });
            console.log('🔒 Chamando closeConfigModal...');
            closeConfigModal();
            console.log('✅ closeConfigModal chamado');
        });
        console.log('✅ Event listener adicionado ao configCloseBtn');
        logToMain('RENDERER', 'CLOSE_BUTTON_LISTENER_ADDED', {});
    } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        console.error('❌ configCloseBtn não encontrado!');
        logToMain('RENDERER', 'CLOSE_BUTTON_NOT_FOUND', {}, 'ERROR');
    }

    // Configurações
    if (configSelectOvpn) {
        configSelectOvpn.addEventListener('click', handleOvpnFileSelection);
    }
    if (configSaveProfile) {
        configSaveProfile.addEventListener('change', handleSaveProfileCheckbox);
    }
    if (configSaveUserProfile) {
        configSaveUserProfile.addEventListener('click', saveUserProfileConfig);
    }
    if (configSelectAzureOvpn) {
        configSelectAzureOvpn.addEventListener('click', handleAzureOvpnFileSelection);
    }
    if (configSaveAzureProfile) {
        configSaveAzureProfile.addEventListener('change', handleSaveAzureProfileCheckbox);
    }
    if (configSaveAzureProfileBtn) {
        configSaveAzureProfileBtn.addEventListener('click', saveAzureProfileConfig);
    }

    // Atualizações
    if (!updateBtn) {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        console.log('ℹ️ minimizeBtn não encontrado (removido do layout)');
    }

    const closeBtn = document.getElementById('closeBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', async () => {
        await requestAppExitWithVpnPrompt('quit');
      });
      console.log('✅ Event listener adicionado ao closeBtn');
    } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        console.log('ℹ️ menuBtn não encontrado');
    }
    if (updateCloseBtn) {
        updateCloseBtn.addEventListener('click', closeUpdateModal);
    }

function setupEventListeners() {
    console.log("setupEventListeners iniciado");
    // Seleção de perfil unificado
    if (profileSelect) {
        profileSelect.addEventListener('change', handleProfileSelection);
    }
    if (configureProfilesLink) {
        configureProfilesLink.addEventListener('click', (event) => {
            event.preventDefault();
            toggleConfigModal();
        });
    }

    // Conexões unificadas
    if (btnConectar) {
        btnConectar.addEventListener('click', handleConnect);
    }
    if (btnDesconectar) {
        btnDesconectar.addEventListener('click', handleDisconnect);
    }
    if (btnCopiarCodigo) {
        btnCopiarCodigo.addEventListener('click', copyDeviceCode);
    }

    // Campos de entrada para validação em tempo real
    if (userUsername) {
        userUsername.addEventListener('input', updateConnectionButtons);
    }
    if (userPassword) {
        userPassword.addEventListener('input', updateConnectionButtons);
    }
    if (toggleUserPassword && userPassword) {
        toggleUserPassword.addEventListener('click', () => {
            const isPasswordHidden = userPassword.type === 'password';
            userPassword.type = isPasswordHidden ? 'text' : 'password';
            toggleUserPassword.setAttribute('aria-pressed', String(isPasswordHidden));
            toggleUserPassword.setAttribute('aria-label', isPasswordHidden ? 'Ocultar senha' : 'Mostrar senha');
            toggleUserPassword.title = isPasswordHidden ? 'Ocultar senha' : 'Mostrar senha';
            if (toggleUserPasswordIcon) {
                toggleUserPasswordIcon.innerHTML = isPasswordHidden ? '&#128584;' : '&#128065;';
            }
        });
    }

    // Menu e configurações
    if (menuBtn) {
        menuBtn.addEventListener('click', toggleConfigModal);
    } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        logToMain('RENDERER', 'ELEMENT_NOT_FOUND', { element: 'menuBtn' }, 'ERROR');
    }

    // Botão de minimizar para tray
    // minimizeBtn handler moved to initializeApp to avoid duplicates

    // Configurações
    if (configSelectOvpn) {
        configSelectOvpn.addEventListener('click', handleOvpnFileSelection);
    }
    if (configOvpnInfo) {
        configOvpnInfo.addEventListener('click', handleOvpnFileSelection);
    }
    if (configSaveProfile) {
        configSaveProfile.addEventListener('change', handleSaveProfileCheckbox);
    }
    if (configSaveUserProfile) {
        configSaveUserProfile.addEventListener('click', saveUserProfileConfig);
    }
    if (configSelectAzureOvpn) {
        configSelectAzureOvpn.addEventListener('click', handleAzureOvpnFileSelection);
    }
    if (configSaveAzureProfile) {
        configSaveAzureProfile.addEventListener('change', handleSaveAzureProfileCheckbox);
    }
    if (configSaveAzureProfileBtn) {
        configSaveAzureProfileBtn.addEventListener('click', saveAzureProfileConfig);
    }

    // Atualizações
    if (updateBtn) {
        updateBtn.addEventListener('click', async () => {
            if (updateInfo) {
                // Se há atualização disponível, abre o modal
                if (updateModal) {
                    setUpdateDownloadState('ready');
                    updateModal.style.display = 'flex';
                }
            } else {
                // Senão, verifica por atualizações com feedback de status
                await checkForUpdates();
            }
        });
        console.log('✅ Event listener adicionado ao updateBtn');
    } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        console.log('ℹ️ updateBtn não encontrado');
    }


    if (updateCloseBtn) {
        updateCloseBtn.addEventListener('click', closeUpdateModal);
    }

    const updateDownloadBtn = document.getElementById('updateDownloadBtn');
    if (updateDownloadBtn) {
        updateDownloadBtn.addEventListener('click', async () => {
            console.log('🖱️ Download button clicked');
            try {
                setUpdateDownloadState('downloading');

                console.log('📡 Calling downloadUpdate IPC');
                const result = await window.electronAPI.downloadUpdate();
                console.log('📡 downloadUpdate result:', result);
                if (result.success) {
                    showStatus('Download da atualização iniciado!', 'success');
                } else {
                    setUpdateDownloadState('error');
                    showStatus(`Erro no download: ${result.error}`, 'alert');
                }
            } catch (error) {
                console.error('❌ Error in download button:', error);
                setUpdateDownloadState('error');
                showStatus('Erro ao iniciar download da atualização', 'alert');
            }
        });
    }

    const updateLaterBtn = document.getElementById('updateLaterBtn');
    if (updateLaterBtn) {
        updateLaterBtn.addEventListener('click', closeUpdateModal);
    }

    const updateInstallBtn = document.getElementById('updateInstallBtn');
    if (updateInstallBtn) {
        updateInstallBtn.addEventListener('click', async () => {
            try {
                setUpdateDownloadState('installing');
                const updateLaterBtn = document.getElementById('updateLaterBtn');
                if (updateLaterBtn) updateLaterBtn.style.display = 'none';

                showStatus('Aplicando atualização...', 'success');
                const result = await window.electronAPI.installUpdate();
                if (result.success) {
                    // quitAndInstall will restart the app
                } else {
                    setUpdateDownloadState('downloaded');
                    showStatus(`Erro na instalação: ${result.error}`, 'alert');
                }
            } catch (error) {
                setUpdateDownloadState('downloaded');
                showStatus('Erro ao instalar atualização', 'alert');
            }
        });
    }

    const openStatsBtn = document.getElementById('openStatsBtn');
    if (openStatsBtn) openStatsBtn.addEventListener('click', () => openStatsModal());

    const statsCloseBtn = document.getElementById('statsCloseBtn');
    if (statsCloseBtn) statsCloseBtn.addEventListener('click', () => closeStatsModal());

    const statsRefreshBtn = document.getElementById('statsRefreshBtn');
    if (statsRefreshBtn) statsRefreshBtn.addEventListener('click', () => refreshStatsModal());

    // Logs da conexão
    if (logsBtn) {
        logsBtn.addEventListener('click', toggleConnLogsModal);
        console.log('✅ Event listener adicionado ao logsBtn');
    } else {
        console.log("❌ logsBtn não encontrado!");
    }

    // Logs da aplicação
    if (appLogsBtn) {
        appLogsBtn.addEventListener('click', toggleAppLogsModal);
        console.log('✅ Event listener adicionado ao appLogsBtn');
    } else {
        console.log("❌ appLogsBtn não encontrado!");
        console.log("Verificando se dropdown está carregado...");
        // Tentar novamente após um pequeno delay
        setTimeout(() => {
            appLogsBtn = document.getElementById('appLogsBtn');
            if (appLogsBtn) {
                console.log('✅ appLogsBtn encontrado no retry');
                appLogsBtn.addEventListener('click', toggleAppLogsModal);
            } else {
                console.log('ℹ️ logsBtn ainda não encontrado (removido do layout)');
            }
        }, 1000);
    }

    // Modal de logs
    console.log("closeLogsModalBtn encontrado:", !!closeLogsModalBtn);
    if (closeLogsModalBtn) {
        closeLogsModalBtn.addEventListener('click', closeConnLogsModal);
    }

    // Modal de logs da aplicação
    console.log("appLogsCloseBtn encontrado:", !!appLogsCloseBtn);
    if (appLogsCloseBtn) {
        appLogsCloseBtn.addEventListener('click', closeAppLogsModal);
    }

}



async function initializeApp() {
    // Aguardar Bootstrap carregar completamente
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Definir elementos após DOM estar pronto
    logsBtn = document.getElementById('logsBtn');
    connLogsModal = document.getElementById('connLogsModal');
    connLogsModalContent = document.getElementById('connLogsModalContent');
    closeLogsModalBtn = document.getElementById('closeLogsModalBtn');
    clearLogsBtn = document.getElementById('clearLogsBtn');
    appLogsBtn = document.getElementById('appLogsBtn');
    appLogsModal = document.getElementById('appLogsModal');
    appLogsCloseBtn = document.getElementById('appLogsCloseBtn');
    appLogsModalContent = document.getElementById('appLogsModalContent');

    // Definir todos os elementos
    connLogsModal = document.getElementById('connLogsModal');
    connLogsModalContent = document.getElementById('connLogsModalContent');
    closeLogsModalBtn = document.getElementById('closeLogsModalBtn');
    clearLogsBtn = document.getElementById('clearLogsBtn');
    appLogsModal = document.getElementById('appLogsModal');
    appLogsCloseBtn = document.getElementById('appLogsCloseBtn');
    appLogsModalContent = document.getElementById('appLogsModalContent');

    console.log('🔍 Elementos encontrados:', {
        logsBtn: !!logsBtn,
        appLogsBtn: !!appLogsBtn,
        closeLogsModalBtn: !!closeLogsModalBtn,
        appLogsCloseBtn: !!appLogsCloseBtn
    });

    // Minimizar janela (minimize to taskbar)
    const minimizeBtn = document.getElementById('minimizeBtn');
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', async () => {
            try {
                await window.electronAPI.minimizeWindow();
                console.log('✅ Janela minimizada para barra de tarefas');
            } catch (error) {
                console.error('❌ Erro ao minimizar:', error);
            }
        });
        console.log('✅ Event listener adicionado ao minimizeBtn');
    } else {
        console.log('ℹ️ minimizeBtn não encontrado');
    }

    // Minimizar janela (barra de título)
    const windowMinimizeBtn = document.getElementById('windowMinimizeBtn');
    if (windowMinimizeBtn) {
        windowMinimizeBtn.addEventListener('click', async () => {
            try {
                await window.electronAPI.minimizeWindow();
                console.log('✅ Janela minimizada via barra de título');
            } catch (error) {
                console.error('❌ Erro ao minimizar janela via barra de título:', error);
            }
        });
        console.log('✅ Event listener adicionado ao windowMinimizeBtn');
    } else {
        console.log('ℹ️ windowMinimizeBtn não encontrado');
    }

    // Fechar janela (barra de título)
    const windowCloseBtn = document.getElementById('windowCloseBtn');
    if (windowCloseBtn) {
        windowCloseBtn.addEventListener('click', async () => {
            try {
                await requestAppExitWithVpnPrompt('close');
            } catch (error) {
                console.error('❌ Erro ao fechar janela via barra de título:', error);
            }
        });
        console.log('✅ Event listener adicionado ao windowCloseBtn');
    } else {
        console.log('ℹ️ windowCloseBtn não encontrado');
    }

    try {
        console.log('🚀 Inicializando aplicação...');
        logToMain('RENDERER', 'INIT_START', {});

        // Definir versão da aplicação
        const version = await window.electronAPI.getVersion();
        const updateVersionEl = document.getElementById('updateVersion');
        if (updateVersionEl) {
            updateVersionEl.textContent = version;
        }

        // Aguardar APIs ficarem disponíveis
        if (!window.electronAPI) {
            console.log('🔄 Aguardando electronAPI...');
            setTimeout(() => initializeApp(), 500);
            return;
        }

        // Verificar se APIs estão disponíveis
        console.log('🔍 Verificando APIs disponíveis:');
        console.log('  window.electronAPI:', !!window.electronAPI);
        if (window.electronAPI) {
            console.log('  loadUserProfiles:', !!window.electronAPI.loadUserProfiles);
            console.log('  loadAzureProfiles:', !!window.electronAPI.loadAzureProfiles);
        }

        // Definir versão da aplicação
        try {
            const version = await window.electronAPI.getVersion();
            const updateVersionEl = document.getElementById('updateVersion');
            if (updateVersionEl) {
                updateVersionEl.textContent = version;
            }
        } catch (error) {
            console.warn('Erro ao obter versão:', error);
        }

        // Inicializar elementos de atualização
        initializeUpdateElements();

        // RNF012: Carregar logo customizado
        await loadAndApplyCustomLogo();

        // Identidade Visual: carregar cores salvas
        try {
            if (window.electronAPI?.loadAppSettings) {
                const savedSettings = await window.electronAPI.loadAppSettings();
                document.body.classList.toggle('compact', !!savedSettings.compactMode);
                if (savedSettings && savedSettings.colorPrimary) {
                    const elPrimary = document.getElementById('colorPrimary');
                    const elAccent = document.getElementById('colorAccent');
                    const elBg = document.getElementById('colorBackground');
                    if (elPrimary) elPrimary.value = savedSettings.colorPrimary;
                    if (elAccent) elAccent.value = savedSettings.colorAccent || '#00eeff';
                    if (elBg) elBg.value = savedSettings.colorBackground || '#0A162E';
                    applyThemeColors(
                        savedSettings.colorPrimary,
                        savedSettings.colorAccent || '#00eeff',
                        savedSettings.colorBackground || '#0A162E'
                    );
                }
            }
        } catch (e) {
            console.warn('Identidade Visual: erro ao carregar cores:', e);
        }

        // Configurar event listeners primeiro
        setupEventListeners();

        // Carregar perfis salvos unificados
        await loadAllProfiles();

        // Verificar atualizações automaticamente
        checkForUpdatesOnStartup();

        // Restaurar estado da aplicação
        await restoreApplicationState();

        // Definir versão da aplicação
        try {
            const version = await window.electronAPI.getVersion();
            const updateVersionEl = document.getElementById('updateVersion');
            if (updateVersionEl) {
                updateVersionEl.textContent = version;
            }
        } catch (error) {
            console.warn('Erro ao obter versão:', error);
        }

        console.log('✅ Aplicação inicializada com sucesso');
        logToMain('RENDERER', 'INIT_SUCCESS', {});
        showStatus('Aplicação carregada com sucesso!', 'success');

        // RNF003: iniciar monitoramento de consumo de RAM
        startMemoryMonitor();

        // Abrir modal de atualização automaticamente no modo debug
        if (document.title.includes('DEBUG')) {
            setTimeout(() => {
                if (updateModal) {
                    updateModal.style.display = 'flex';
                    console.log('🧪 Modal de atualização aberto automaticamente no modo debug');
                }
            }, 2000); // Delay para garantir carregamento completo
        }
    } catch (error) {
        console.error('❌ Erro na inicialização:', error);
        logToMain('RENDERER', 'INIT_ERROR', {
            message: error.message,
            stack: error.stack
        }, 'ERROR');
        // Não mostrar erro para usuário, pois aplicação funciona
        console.log('Aplicação inicializada com avisos');
        showStatus('Aplicação carregada com avisos', 'success');
    }
}

// ============ GESTÃO DE PERFIS ============

async function loadAllProfiles() {
    try {
        if (!window.electronAPI) {
            throw new Error('window.electronAPI not available');
        }
        // Carregar perfis de usuário
        const userResult = await window.electronAPI.loadUserProfiles();
        const userProfiles = userResult.success ? userResult.profiles || [] : [];

        // Carregar perfis Azure
        const azureResult = await window.electronAPI.loadAzureProfiles();
        const azureProfiles = azureResult.success ? azureResult.profiles || [] : [];

        // Unificar todos os perfis
        allProfiles = [
            ...userProfiles.map(p => ({ ...p, type: 'user', icon: '🔐', typeLabel: 'Usuário/Senha' })),
            ...azureProfiles.map(p => ({ ...p, type: 'azure', icon: '🌐', typeLabel: 'Azure AD' }))
        ];

        console.log(`✅ Carregados ${allProfiles.length} perfis totais (${userProfiles.length} usuário, ${azureProfiles.length} Azure)`);

        // Popular o select de perfis
        populateProfileSelect();

        // Carregar último perfil usado
        await loadLastProfile();

        // Popular listas de configuração
        populateConfigProfilesList();

    } catch (error) {
        console.error('❌ Erro ao carregar perfis:', error);
        allProfiles = [];
    }
}

async function loadLastProfile() {
    try {
        const result = await window.electronAPI.loadAppState();
        // Priorizar selectedProfileId (estado atual), com fallback para lastProfileId legado
        const restoredProfileId = result.success ? (result.state.selectedProfileId || result.state.lastProfileId) : null;
        if (restoredProfileId) {
            const lastProfileId = restoredProfileId;
            const profileType = result.state.selectedProfileType || 'user';
            const profileKey = `${profileType}:${lastProfileId}`;
            const option = profileSelect.querySelector(`option[value="${profileKey}"]`);
            if (option) {
                profileSelect.value = profileKey;
                profileSelect.dispatchEvent(new Event('change'));
                console.log('✅ Último perfil restaurado:', profileKey);
            } else {
                console.log('⚠️ Perfil não encontrado:', profileKey);
            }
        }
    } catch (error) {
        console.error('Erro ao carregar último perfil:', error);
    }
}

function syncConfigureProfilesLinkVisibility() {
    const hasProfiles = Array.isArray(allProfiles) && allProfiles.length > 0;
    const cfgLink = document.getElementById('configureProfilesLink');
    const cfgWrap = document.getElementById('configureProfilesWrapper');
    if (cfgLink) cfgLink.style.display = hasProfiles ? 'none' : 'inline';
    if (cfgWrap) {
        cfgWrap.style.display = hasProfiles ? 'none' : 'block';
        cfgWrap.hidden = hasProfiles;
    }
}

function populateProfileSelect() {
    if (!profileSelect) return;

    // Limpar opções existentes exceto a primeira
    while (profileSelect.options.length > 1) {
        profileSelect.remove(1);
    }

    // Adicionar perfis
    allProfiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = `${profile.type}:${profile.id}`;
        option.textContent = `${profile.icon} ${profile.name}`;
        profileSelect.appendChild(option);
    });

    console.log(`📋 Select populado com ${allProfiles.length} perfis`);
    syncConfigureProfilesLinkVisibility();
}

function getTwoFactorBadge(profile) {
    return profile.type === 'user' && profile.requires2FA ? '<span class="profile-2fa-badge">2FA detectado</span>' : '';
}

function populateConfigProfilesList() {
    if (!configProfilesList) return;

    configProfilesList.innerHTML = '';

    allProfiles.filter(p => p.type === 'user').forEach(profile => {
        const li = document.createElement('li');
        li.className = 'profile-item';
        li.innerHTML = `
            <div class="profile-info">
                <strong>${profile.name}</strong> ${getTwoFactorBadge(profile)}
                <small>${profile.ovpnFileName || 'Arquivo não especificado'}</small>
            </div>
            <button class="btn btn-sm btn-danger font-095" onclick="deleteProfile('${profile.id}', 'user')">Excluir</button>
        `;
        configProfilesList.appendChild(li);
    });

    if (!configAzureProfilesList) return;

    configAzureProfilesList.innerHTML = '';

    allProfiles.filter(p => p.type === 'azure').forEach(profile => {
        const li = document.createElement('li');
        li.className = 'profile-item';
        li.innerHTML = `
            <div class="profile-info">
                <strong>${profile.name}</strong>
                <small>${profile.ovpnFileName || 'Arquivo não especificado'}</small>
            </div>
            <button class="btn btn-sm btn-danger font-095" onclick="deleteProfile('${profile.id}', 'azure')">Excluir</button>
        `;
        configAzureProfilesList.appendChild(li);
    });
}

// ============ SELEÇÃO E GESTÃO DE PERFIS ============

function handleProfileSelection() {
    const selectedValue = profileSelect.value;
    if (!selectedValue) {
        currentProfile = null;
        updateProfileDisplay();
        updateConnectionButtons();
        return;
    }

    const [type, id] = selectedValue.split(':');
    const profile = allProfiles.find(p => p.type === type && p.id === id);

    if (profile) {
        currentProfile = profile;
        console.log(`🎯 Perfil selecionado: ${profile.name} (${profile.typeLabel})`);

        // Limpar campos antes de carregar credenciais do novo perfil (IS006)
        if (userUsername) userUsername.value = '';
        if (userPassword) userPassword.value = '';
        if (rememberCredentials) rememberCredentials.checked = false;

        // Carregar credenciais salvas para perfis de usuário
        if (profile.type === 'user') {
            loadSavedCredentials(profile.id);
        }

        updateProfileDisplay();
        updateConnectionButtons();
    }
}

async function loadSavedCredentials(profileId) {
    try {
        const result = await window.electronAPI.loadUserCredentials(profileId);
        if (!currentProfile || currentProfile.type !== 'user' || currentProfile.id !== profileId) {
            console.log(`ℹ️ Credenciais ignoradas: perfil ativo mudou durante carregamento (${profileId})`);
            return;
        }

        if (result.success && result.credentials) {
            if (userUsername) userUsername.value = result.credentials.username || '';
            if (userPassword) userPassword.value = result.credentials.password || '';
            if (rememberCredentials) rememberCredentials.checked = result.credentials.rememberPassword || false;
            console.log('🔑 Credenciais carregadas para perfil:', profileId);
            // Atualizar botões após carregar credenciais
            updateConnectionButtons();
        }
    } catch (error) {
        console.error('❌ Erro ao carregar credenciais:', error);
    }
}

function updateProfileDisplay() {
    if (!selectedProfileInfo || !profileIcon || !profileName || !profileType || !profileDetails) return;

    if (currentProfile) {
        profileIcon.textContent = currentProfile.icon;
        profileName.textContent = currentProfile.name;
        profileType.textContent = currentProfile.typeLabel;
        profileType.className = `profile-type-badge ${currentProfile.type}`;

        // Detalhes específicos do perfil
        let details = '';
        if (currentProfile.type === 'user') {
            details = `Arquivo: ${currentProfile.ovpnFileName || 'N/A'}`;
            if (currentProfile.requires2FA) {
                details += ' · 2FA detectado';
            }
        } else if (currentProfile.type === 'azure') {
            details = `Arquivo: ${currentProfile.ovpnFileName || 'N/A'}`;
        }
        profileDetails.textContent = details;

        selectedProfileInfo.style.display = 'block';

        // Mostrar/esconder seção de credenciais
        if (credentialsSection) {
            credentialsSection.style.display = currentProfile.type === 'user' ? 'block' : 'none';
        }

        // Seção de device code sempre escondida por padrão (aparece apenas durante login)
        if (deviceCodeSection) {
            deviceCodeSection.style.display = 'none';
        }
    } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        selectedProfileInfo.style.display = 'none';
        if (credentialsSection) {
            credentialsSection.style.display = 'none';
        }
        if (deviceCodeSection) {
            deviceCodeSection.style.display = 'none';
        }
    }
}

function updateConnectionButtons() {
    const isConnected = vpnPid !== null;
    const hasValidProfile = currentProfile !== null;

    if (btnConectar) {
        btnConectar.disabled = isConnected || !hasValidProfile ||
                              (currentProfile?.type === 'user' && !isUserFormValid());
    }
    if (btnDesconectar) {
        btnDesconectar.disabled = !isConnected;
    }

    // Travar seleção de perfil durante conexão
    if (profileSelect) {
        profileSelect.disabled = isConnected;
    }
}

function getFriendlyIpcErrorMessage(error) {
    let message = String(error?.message || error || 'Erro desconhecido');

    // Remove prefixos técnicos do Electron IPC:
    // Error invoking remote method 'x': Error: mensagem
    message = message.replace(/^Error invoking remote method '[^']+':\s*/i, '');
    message = message.replace(/^Error:\s*/i, '');

    if (/Token 2FA inválido ou expirado/i.test(message)) {
        return 'Token 2FA inválido ou expirado. Tente novamente.';
    }

    if (/Falha na autenticação/i.test(message)) {
        return 'Falha na autenticação: usuário, senha ou token incorretos. Verifique também a permissão no Controle OpenVPN.';
    }

    return message;
}

function sanitizeChallengeInput(inputEl) {
    const sanitized = String(inputEl.value || '').replace(/\D/g, '').slice(0, 6);
    if (inputEl.value !== sanitized) inputEl.value = sanitized;
    return sanitized;
}

function bindChallengeAutoSubmit(inputEl, onSubmit) {
    const onInput = () => {
        const token = sanitizeChallengeInput(inputEl);
        if (token.length === 6) onSubmit();
    };
    inputEl.addEventListener('input', onInput);
    return () => inputEl.removeEventListener('input', onInput);
}

function promptTotpTokenBeforeConnection(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('challengeModal');
        const msgEl = document.getElementById('challengeMessage');
        const inputEl = document.getElementById('challengeResponse');
        const timerEl = document.getElementById('challengeTimer');
        const submitBtn = document.getElementById('submitChallengeBtn');
        const cancelBtn = document.getElementById('cancelChallengeBtn');

        if (!modal || !msgEl || !inputEl || !submitBtn || !cancelBtn) {
            const token = window.prompt(message);
            if (token === null) {
                resolve(null);
                return;
            }
            const trimmedToken = token.trim();
            if (!/^\d{6}$/.test(trimmedToken)) {
                showStatus('Token deve ser exatamente 6 dígitos numéricos.', 'alert');
                resolve(false);
                return;
            }
            resolve(trimmedToken);
            return;
        }

        const submitClone = submitBtn.cloneNode(true);
        const cancelClone = cancelBtn.cloneNode(true);
        submitBtn.replaceWith(submitClone);
        cancelBtn.replaceWith(cancelClone);

        let submitted = false;
        let unbindAutoSubmit = null;

        const closeModal = (value) => {
            modal.style.display = 'none';
            inputEl.value = '';
            inputEl.removeEventListener('keydown', onKeyDown);
            if (unbindAutoSubmit) unbindAutoSubmit();
            resolve(value);
        };

        const onSubmit = () => {
            if (submitted) return;
            const token = sanitizeChallengeInput(inputEl);
            if (!/^\d{6}$/.test(token)) {
                showStatus('Token deve ser exatamente 6 dígitos numéricos.', 'alert');
                return;
            }
            submitted = true;
            closeModal(token);
        };

        const onCancel = () => {
            closeModal(null);
        };

        const onKeyDown = (event) => {
            if (event.key === 'Enter') onSubmit();
            if (event.key === 'Escape') onCancel();
        };

        msgEl.textContent = message;
        inputEl.value = '';
        if (timerEl) timerEl.textContent = '';
        modal.style.display = 'flex';
        submitClone.addEventListener('click', onSubmit);
        cancelClone.addEventListener('click', onCancel);
        inputEl.addEventListener('keydown', onKeyDown);
        unbindAutoSubmit = bindChallengeAutoSubmit(inputEl, onSubmit);
        setTimeout(() => inputEl.focus(), 100);
    });
}

function isActiveVpnError(error) {
    const message = getFriendlyIpcErrorMessage(error);
    return /Já existe uma conexão VPN ativa|conexão VPN ativa|VPN ativa/i.test(message);
}

async function promptForceDisconnectActiveVpn(errorMessage = '') {
    const shouldForce = window.confirm(
        'Já existe uma conexão VPN ativa ou presa pelo BluePex VPN.\n\n' +
        'Deseja forçar a desconexão agora?\n\n' +
        'Isso tentará encerrar apenas a conexão VPN gerenciada pelo BluePex.'
    );

    if (!shouldForce) {
        return false;
    }

    try {
        showStatus('Forçando desconexão da VPN ativa...', 'warning');
        const result = await window.electronAPI.killVPNConnection();

        if (result?.success) {
            vpnPid = null;
            await saveApplicationState();
            showConnectionElements();
            updateConnectionButtons();
            showStatus('VPN desconectada com sucesso. Tente conectar novamente.', 'success');
            return true;
        }

        showStatus(`Falha ao forçar desconexão: ${result?.error || 'erro desconhecido'}`, 'alert');
        updateConnectionButtons();
        return false;
    } catch (forceError) {
        showStatus(`Erro ao forçar desconexão: ${forceError.message}`, 'alert');
        updateConnectionButtons();
        return false;
    }
}

async function requestAppExitWithVpnPrompt(action, force = false) {
    const result = action === 'quit'
        ? await window.electronAPI.quitApp()
        : await window.electronAPI.closeWindow();

    if (result?.success) {
        if (action === 'close') console.log('✅ Janela fechada via barra de título');
        return true;
    }

    if (!force && result?.blocked && result?.reason === 'vpn_active') {
        const shouldForce = window.confirm('Existe conexão VPN BluePex ativa ou presa. Deseja forçar desconexão antes de sair/fechar?');
        if (!shouldForce) {
            showStatus('Saída cancelada. A conexão VPN BluePex permanece ativa.', 'warning');
            return false;
        }

        try {
            showStatus('Forçando desconexão da VPN BluePex...', 'warning');
            const killResult = await window.electronAPI.killVPNConnection();
            if (killResult?.success) {
                vpnPid = null;
                await saveApplicationState();
                showConnectionElements();
                updateConnectionButtons();
                return await requestAppExitWithVpnPrompt(action, true);
            }
            showStatus(`Falha ao forçar desconexão: ${killResult?.error || 'erro desconhecido'}`, 'alert');
            return false;
        } catch (error) {
            showStatus(`Erro ao forçar desconexão: ${error.message}`, 'alert');
            return false;
        }
    }

    return false;
}

function isUserFormValid() {
    return currentProfile?.type === 'user' &&
           userUsername && userPassword &&
           userUsername.value.trim() !== '' &&
           userPassword.value !== '';
}

// ============ CONEXÃO VPN ============

async function handleConnect() {
    // ✅ PROTEÇÃO: Verificar se há uma conexão em andamento
    if (vpnPid !== null) {
        showStatus('Já existe uma conexão VPN ativa', 'alert');
        return;
    }

    if (!currentProfile) {
        showStatus('Por favor, selecione um perfil primeiro.', 'alert');
        return;
    }

    try {
        btnConectar.disabled = true;
        btnDesconectar.disabled = false;
        // Travar seleção de perfil durante todo o processo de conexão
        if (profileSelect) profileSelect.disabled = true;
        showStatus(`Iniciando conexão ao perfil "${currentProfile.name}"...`, 'status');

        // Limpar logs de conexão (armazenados em memória)
        connectionLogsText = '';
        console.log('📝 [RENDERER] Logs de conexão limpos');

        if (currentProfile.type === 'user') {
            let totpToken = null;

            if (window.electronAPI.detect2FARequirement) {
                let twoFaCheck = null;
                try {
                    twoFaCheck = await window.electronAPI.detect2FARequirement(currentProfile.id);
                } catch (_) {}

                if (twoFaCheck && twoFaCheck.requires2FA) {
                    if (window.electronAPI.prepareLinuxElevation) {
                        try {
                            await window.electronAPI.prepareLinuxElevation(currentProfile.id);
                        } catch (prepError) {
                            console.warn('Falha ao preparar elevação Linux antes do 2FA:', prepError?.message || prepError);
                        }
                    }
                    const tokenResult = await promptTotpTokenBeforeConnection('Este perfil requer 2FA. Informe o token TOTP para iniciar a conexão.');
                    if (tokenResult === null) {
                        showStatus('Autenticação 2FA cancelada', 'alert');
                        return;
                    }
                    if (tokenResult === false) {
                        throw new Error('Token deve ser exatamente 6 dígitos numéricos.');
                    }
                    totpToken = tokenResult;
                }
            }

            const username = userUsername.value.trim();
            const password = userPassword.value;

            if (!username || !password) {
                throw new Error('Usuário e senha são obrigatórios');
            }

            // Persistir credenciais antes da tentativa de conexão para não perder em timeout/falha
            if (rememberCredentials && rememberCredentials.checked) {
                if (!currentProfile || !currentProfile.id) {
                    console.error('❌ Erro: currentProfile ou currentProfile.id está vazio');
                    showStatus('Erro: Perfil inválido para salvar credenciais', 'alert');
                } else {
                    const saveResult = await window.electronAPI.saveUserCredentials(
                        currentProfile.id,
                        username,
                        password,
                        true
                    );

                    if (saveResult.success) {
                        console.log('💾 Credenciais salvas para perfil (pré-conexão):', currentProfile.id);
                    } else {
                        console.error('❌ Erro ao salvar credenciais antes da conexão:', saveResult.error);
                    }
                }
            }

            const result = await window.electronAPI.connectOpenVPNUserPassProfile(
                currentProfile.id,
                username,
                password,
                totpToken
            );

            vpnPid = result.pid;
            console.log(`🔌 [RENDERER] VPN PID definido: ${vpnPid}`);
            showStatus(`Conectado com sucesso! PID: ${vpnPid}`, 'success');

            // Esconder elementos desnecessários quando conectado
            hideConnectionElements();

        } else if (currentProfile.type === 'azure') {
            try {
                // Conexão Azure AD
                console.log('🔐 [RENDERER] Iniciando login Azure...');
                const authResult = await window.electronAPI.loginAzure(currentProfile.id);
                console.log('🔐 [RENDERER] Login Azure retornou:', authResult);
                
                if (!authResult || !authResult.token) {
                    throw new Error('Login Azure não retornou token');
                }
                
                const { token, username } = authResult;
                showStatus(`Login realizado: ${username}`, 'status');

                const publishResult = await window.electronAPI.publishToken(username, token, currentProfile.id);
                if (!publishResult || !publishResult.success) {
                    throw new Error('Falha ao publicar token no servidor');
                }
                const publishedShortId = publishResult.short_id ? String(publishResult.short_id).trim() : '';
                if (!publishedShortId) {
                    console.error('❌ [RENDERER] Backend publicou token sem short_id válido:', publishResult);
                    throw new Error('Backend não retornou short_id do Entra ID.');
                }
                showStatus('Token publicado. Conectando VPN...', 'status');

                const connectResult = await window.electronAPI.connectOpenVPN();
                if (!connectResult || !connectResult.pid) {
                    throw new Error('Falha ao conectar OpenVPN');
                }
                
                vpnPid = connectResult.pid;
                showStatus(`Conectado com sucesso! PID: ${vpnPid}`, 'success');

                // Salvar estado do perfil atual
                await window.electronAPI.saveAppState({
                    selectedProfileId: currentProfile.id,
                    selectedProfileType: currentProfile.type
                });

                // Esconder elementos desnecessários quando conectado
                hideConnectionElements();
            } catch (azureErr) {
                console.error('❌ [RENDERER] Erro no fluxo Azure:', azureErr);
                throw azureErr;
            }
        }

        saveApplicationState();

    } catch (err) {
        const friendlyError = getFriendlyIpcErrorMessage(err);
        console.log(`❌ [RENDERER] Erro na conexão: ${friendlyError}`);
        const activeVpnError = isActiveVpnError(err);
        vpnPid = null; // Garantir que vpnPid seja limpo em caso de erro
        // Destravar seleção de perfil em caso de erro
        if (profileSelect) profileSelect.disabled = false;
        showStatus(`Erro: ${friendlyError}`, 'alert');

        if (activeVpnError) {
            await promptForceDisconnectActiveVpn(friendlyError);
        }
    } finally {
        updateConnectionButtons();
    }
}

async function handleDisconnect() {
  console.log(`🔌 [RENDERER] Botão desconectar clicado. VPN PID atual: ${vpnPid}`);

  try {
    btnDesconectar.disabled = true; // Evita clique duplo durante desconexão
    
    console.log(`🔌 [RENDERER] Chamando killVPNConnection()...`);
    
    // USAR APENAS A FUNÇÃO killVPNConnection() (MESMA DO FECHAR)
    const result = await window.electronAPI.killVPNConnection();
    
    console.log(`🔌 [RENDERER] Resultado:`, result);
    
    if (result.success) {
      showStatus('VPN desconectada com sucesso!', 'status');
      vpnPid = null;
      
      // Destravar seleção de perfil
      if (profileSelect) profileSelect.disabled = false;
      
      // Mostrar elementos de conexão novamente
      showConnectionElements();
      
      // Limpar status após desconectar
      setTimeout(() => {
        if (statusEl) statusEl.style.display = 'none';
      }, 3000);
    } else {
      throw new Error(result.error || 'Falha na desconexão');
    }

    updateConnectionButtons();
    saveApplicationState(); // SALVAR ESTADO APÓS DESCONEXÃO

  } catch (err) {
    console.error('❌ Erro na desconexão:', err);
    showStatus(`Erro na desconexão: ${err.message}`, 'alert');
    btnDesconectar.disabled = false; // Re-habilitar para nova tentativa
    updateConnectionButtons();
  }
}

// ============ CONFIGURAÇÕES ============

function toggleConfigModal() {
    if (configModal) {
        const isVisible = configModal.classList.contains('show');

        if (isVisible) {
            adjustWindowPaused = false;
            configModal.classList.remove('show');
            configModal.style.display = 'none';
            clearConfigStatus();
        } else {
            clearConfigStatus();
            adjustWindowPaused = true;
            configModal.style.display = 'flex';
            configModal.classList.add('show');
            if (window.electronAPI?.loadAppSettings) {
                window.electronAPI.loadAppSettings().then(settings => {
                    const tog = document.getElementById('compactModeToggle');
                    if (tog) tog.checked = !!settings.compactMode;
                    document.body.classList.toggle('compact', !!settings.compactMode);
                    const colPri = document.getElementById('colorPrimary');
                    const colAcc = document.getElementById('colorAccent');
                    const colBg  = document.getElementById('colorBackground');
                    if (colPri && settings.colorPrimary) colPri.value = settings.colorPrimary;
                    if (colAcc && settings.colorAccent)  colAcc.value = settings.colorAccent;
                    if (colBg  && settings.colorBackground) colBg.value = settings.colorBackground;
                }).catch(() => {});
            }
        }

        logToMain('RENDERER', 'CONFIG_MODAL_TOGGLE', {
            wasVisible: isVisible,
            nowVisible: !isVisible
        });
    } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        logToMain('RENDERER', 'CONFIG_MODAL_NOT_FOUND', {}, 'ERROR');
    }
}

function closeConfigModal() {
    if (configModal) {
        console.log('  Modal encontrado, removendo classe show');
        configModal.classList.remove('show');
        configModal.style.display = 'none';
        clearConfigStatus();
        console.log('  Classe show removida, classes atuais:', configModal.className, 'display:', configModal.style.display);
    } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        console.log('  Modal não encontrado!');
    }
}

function toggleConnLogsModal() {
    console.log("📋 Alternando modal de logs - BOTÃO CLICADO");
    //alert("Botão Logs clicado!");
    if (connLogsModal) {
        const isVisible = connLogsModal.classList.contains('show');
        console.log("  Modal está visível:", isVisible);

        if (isVisible) {
            connLogsModal.classList.remove('show');
        connLogsModal.style.display = 'none';
        console.log('Modal fechado');
            connLogsModal.style.display = 'none';
        console.log('Modal fechado');
        connLogsModal.style.display = 'none';
        console.log('Modal fechado');
            console.log("  Classe 'show' removida");
        } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
            connLogsModal.classList.add('show');
            connLogsModal.style.display = 'flex';
            updateConnLogsModalContent().catch(error => console.error('Erro ao atualizar logs:', error));
            console.log("  Classe 'show' adicionada");
        }

        logToMain('RENDERER', 'LOGS_MODAL_TOGGLE', {
            wasVisible: isVisible,
            nowVisible: !isVisible
        });
    } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        console.error("❌ connLogsModal não encontrado");
        logToMain('RENDERER', 'LOGS_MODAL_NOT_FOUND', {}, 'ERROR');
    }
}

function closeConnLogsModal() {
    console.log("Fechando modal de logs de conexão");
    if (connLogsModal) {
        connLogsModal.classList.remove('show');
        connLogsModal.style.display = 'none';
        console.log('Modal fechado');
    }
}

async function clearLogs() {
    connectionLogsText = '';
    logToMain('RENDERER', 'LOGS_CLEARED', {});
    showStatus('Logs limpos!', 'success');
}

async function updateConnLogsModalContent() {
    if (connLogsModalContent) {
        try {
            let content = '';

            // 1. Primeiro, mostrar logs em tempo real (sempre disponíveis)
            if (connectionLogsText && connectionLogsText.trim() !== '') {
                content += '📋 Logs em Tempo Real:\n' + connectionLogsText;
            }

            // 2. Tentar ler logs do arquivo via IPC
            try {
                const result = await window.electronAPI.getConnectionLogs();
                if (result.success && result.logs.trim() !== '') {
                    if (content !== '') content += '\n\n--- Logs do Arquivo ---\n';
                    content += result.logs;
                } else if (!result.success) {
                    console.warn('Erro ao carregar logs do arquivo:', result.error);
                }
            } catch (error) {
                console.warn('Erro ao buscar logs via IPC:', error.message);
            }

            // 3. Se não houver nenhum conteúdo, mostrar mensagem amigável
            if (content === '') {
                content = '📋 Nenhum log de conexão disponível ainda.\n\n';
                content += '💡 Dica: Conecte-se a uma VPN para ver os logs em tempo real aqui!\n\n';
                content += 'Os logs aparecerão automaticamente quando você iniciar uma conexão.';
            }

            connLogsModalContent.textContent = content;

        } catch (error) {
            console.error('Erro ao carregar logs:', error);
            // Mesmo em erro, mostrar mensagem amigável em vez de erro técnico
            connLogsModalContent.textContent = '📋 Nenhum log de conexão disponível ainda.\n\n';
            connLogsModalContent.textContent += '💡 Dica: Conecte-se a uma VPN para ver os logs em tempo real!\n\n';
            connLogsModalContent.textContent += 'Se o problema persistir, verifique o console para detalhes técnicos.';
        }
    }

    // Rolar para o final
    if (connLogsModalContent) {
        connLogsModalContent.scrollTop = connLogsModalContent.scrollHeight;
    }
}

function hideConnectionElements() {
    // Esconder seção de device code
    if (deviceCodeSection) {
        deviceCodeSection.style.display = 'none';
    }

    // Esconder botão copiar código
    if (btnCopiarCodigo) {
        btnCopiarCodigo.style.display = 'none';
    }



    // Esconder seção de credenciais se for perfil usuário
    if (currentProfile?.type === 'user' && credentialsSection) {
        credentialsSection.style.display = 'none';
    }

    logToMain('RENDERER', 'CONNECTION_ELEMENTS_HIDDEN', {
        profileType: currentProfile?.type,
        vpnPid: vpnPid
    });
}

function showConnectionElements() {
    // Mostrar seção de credenciais se for perfil usuário
    if (currentProfile?.type === 'user' && credentialsSection) {
        credentialsSection.style.display = 'block';
    }

    logToMain('RENDERER', 'CONNECTION_ELEMENTS_SHOWN', {
        profileType: currentProfile?.type
    });
}

// ============ UTILITÁRIOS ============

function showStatus(message, type = 'status') {
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.style.display = 'block';

    // Auto-hide success messages after 5 seconds, unless connected
    if (type === 'success' && !vpnPid) {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 5000);
    }
}

function normalizeConfigStatusType(type = 'status') {
    return type === 'error' ? 'alert' : type;
}

function showConfigStatus(message, type = 'status') {
    if (!configStatusEl) return;

    const normalizedType = normalizeConfigStatusType(type);
    configStatusEl.textContent = message;
    configStatusEl.className = `status config-status ${normalizedType}`;
    configStatusEl.style.display = 'block';
}

function clearConfigStatus() {
    if (!configStatusEl) return;

    configStatusEl.textContent = '';
    configStatusEl.className = 'status config-status';
    configStatusEl.style.display = 'none';
}

function saveApplicationState() {
    const appState = {
        selectedProfileType: currentProfile?.type || null,
        selectedProfileId: currentProfile?.id || null,
        username: userUsername?.value || '',
        rememberCredentials: rememberCredentials?.checked || false,
        vpnPid: vpnPid,
        lastSaved: new Date().toISOString()
    };

    if (window.electronAPI?.saveAppState) {
        window.electronAPI.saveAppState(appState);
    }
}

async function restoreApplicationState() {
    try {
        if (!window.electronAPI?.loadAppState) return;

        const result = await window.electronAPI.loadAppState();
        if (result.success && result.state) {
            const state = result.state;

            // Restaurar perfil selecionado
            if (state.selectedProfileId && state.selectedProfileType) {
                const profileKey = `${state.selectedProfileType}:${state.selectedProfileId}`;
                if (profileSelect) {
                    profileSelect.value = profileKey;
                    // Simular seleção para atualizar interface
                    setTimeout(() => {
                        profileSelect.dispatchEvent(new Event('change'));
                    }, 100);
                }
            }

            // Restaurar credenciais
            if (userUsername && state.username) {
                userUsername.value = state.username;
            }
            if (rememberCredentials && state.rememberCredentials !== undefined) {
                rememberCredentials.checked = state.rememberCredentials;
            }

            // Restaurar status de conexão
            if (state.vpnPid) {
                // Verificar se a VPN ainda está realmente ativa
                try {
                    const statusResult = await window.electronAPI.checkVpnStatus(state.vpnPid);
                    if (statusResult.connected) {
                        vpnPid = statusResult.pid || state.vpnPid;
                        updateConnectionButtons();
                        showStatus('Estado de conexão restaurado', 'success');
                        console.log('✅ VPN ainda está ativa:', vpnPid);
                    } else {
                        console.log('⚠️ VPN não está mais ativa, limpando estado');
                        vpnPid = null;
                        // Limpar estado de conexão persistido
                        saveApplicationState();
                        showStatus('Conexão anterior detectada, mas a VPN já está desconectada.', 'alert');
                    }
                } catch (error) {
                    console.error('❌ Erro ao verificar status VPN:', error);
                    vpnPid = null;
                }
            }

            console.log('✅ Estado da aplicação restaurado');
        }
    } catch (error) {
        console.error('❌ Erro ao restaurar estado:', error);
    }
}

// ============ PLACEHOLDER FUNCTIONS ============
// Estas funções serão implementadas conforme necessário

function copyDeviceCode() {
    if (!currentDeviceCode || !currentDeviceCode.user_code) {
        showStatus('Nenhum código de verificação disponível para copiar.', 'alert');
        logToMain('RENDERER', 'COPY_DEVICE_CODE_FAILED', { reason: 'no_device_code' });
        return;
    }

    try {
        // Copiar para clipboard
        navigator.clipboard.writeText(currentDeviceCode.user_code).then(() => {
            showStatus(`Código "${currentDeviceCode.user_code}" copiado para a área de transferência!`, 'success');
            logToMain('RENDERER', 'DEVICE_CODE_COPIED', {
                code: currentDeviceCode.user_code,
                success: true
            });
        }).catch((error) => {
            console.error('Erro ao copiar código:', error);
            showStatus('Erro ao copiar código. Copie manualmente.', 'alert');
            logToMain('RENDERER', 'DEVICE_CODE_COPY_FAILED', {
                code: currentDeviceCode.user_code,
                error: error.message
            });
        });
    } catch (error) {
        console.error('Erro ao acessar clipboard:', error);
        showStatus('Erro ao acessar área de transferência.', 'alert');
        logToMain('RENDERER', 'CLIPBOARD_ACCESS_FAILED', { error: error.message });
    }
}

async function handleOvpnFileSelection() {
    try {
        console.log('📁 Abrindo diálogo de seleção de arquivo OVPN...');
        const result = await window.electronAPI.selectOvpnFile();

        if (result.success) {
            console.log('✅ Arquivo selecionado:', result.fileName);
            console.log('fileName:', result.fileName, 'filePath:', result.filePath, 'content length:', result.content?.length);

            // Atualizar a interface com as informações do arquivo
            if (configOvpnInfo) {
                configOvpnInfo.style.display = 'block';
                if (configOvpnName) {
                    configOvpnName.textContent = result.fileName;
                }
            }

            // Mostrar checkbox de salvar perfil
            if (configSaveProfile) {
                configSaveProfile.style.display = 'inline-block';
            }

            // Armazenar informações do arquivo para uso posterior
            selectedOvpnFile = {
                path: result.filePath,
                name: result.fileName,
                content: result.content
            };

            showStatus(`Arquivo "${result.fileName}" selecionado com sucesso!`, 'success');
            showConfigStatus(`Arquivo "${result.fileName}" selecionado com sucesso!`, 'success');
        } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
            console.error('❌ Erro na seleção:', result.error);
            console.log('Result completo:', result);
            showStatus(`Erro: ${result.error}`, 'alert');
            showConfigStatus(`Erro: ${result.error}`, 'alert');
        }
    } catch (error) {
        console.error('❌ Erro ao selecionar arquivo:', error);
        showStatus(`Erro ao selecionar arquivo: ${error.message}`, 'alert');
        showConfigStatus(`Erro ao selecionar arquivo: ${error.message}`, 'alert');
    }
}

function handleSaveProfileCheckbox() {
    const isChecked = configSaveProfile.checked;
    console.log('📋 Checkbox salvar perfil:', isChecked);

    // Mostrar/esconder campo de nome do perfil
    if (configProfileName) {
        configProfileName.style.display = isChecked ? 'block' : 'none';
    }

    // Mostrar/esconder botão de salvar
    if (configSaveUserProfile) {
        configSaveUserProfile.style.display = isChecked ? 'inline-block' : 'none';
    }
}

async function saveUserProfileConfig() {
    if (!selectedOvpnFile) {
        showStatus('Por favor, selecione um arquivo OVPN primeiro.', 'alert');
        showConfigStatus('Por favor, selecione um arquivo OVPN primeiro.', 'alert');
        return;
    }

    if (!configProfileName || !configProfileName.value.trim()) {
        showStatus('Por favor, digite um nome para o perfil.', 'alert');
        showConfigStatus('Por favor, digite um nome para o perfil.', 'alert');
        return;
    }

    try {
        console.log('💾 Salvando perfil usuário...');
        showStatus('Salvando perfil...', 'status');
        showConfigStatus('Salvando perfil...', 'status');

        const profileId = `profile_${Date.now()}`;
        const profileName = configProfileName.value.trim();

        const result = await window.electronAPI.saveOvpnToProfile(
            profileId,
            selectedOvpnFile.content,
            profileName,
            selectedOvpnFile.path
        );

        if (result.success) {
            console.log('✅ Perfil salvo:', result);
            showStatus(`Perfil "${profileName}" salvo com sucesso!`, 'success');
            showConfigStatus(`Perfil "${profileName}" salvo com sucesso!`, 'success');

            // Recarregar perfis e selecionar automaticamente o novo perfil
            await loadAllProfiles();
            
            // Forçar seleção do novo perfil criado
            const newProfileKey = `user:${profileId}`;
            if (profileSelect) {
                profileSelect.value = newProfileKey;
                profileSelect.dispatchEvent(new Event('change'));
            }

            // Limpar formulário
            selectedOvpnFile = null;
            if (configProfileName) configProfileName.value = '';
            if (configSaveProfile) configSaveProfile.checked = false;
            if (configOvpnInfo) configOvpnInfo.style.display = 'none';
            if (configSaveUserProfile) configSaveUserProfile.style.display = 'none';
            if (configProfileName) configProfileName.style.display = 'none';

            // Recarregar perfis
            await loadAllProfiles();
        } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
            console.error('❌ Erro ao salvar perfil:', result.error);
            showStatus(`Erro ao salvar perfil: ${result.error}`, 'alert');
            showConfigStatus(`Erro ao salvar perfil: ${result.error}`, 'alert');
        }
    } catch (error) {
        console.error('❌ Erro ao salvar perfil:', error);
        showStatus(`Erro ao salvar perfil: ${error.message}`, 'alert');
        showConfigStatus(`Erro ao salvar perfil: ${error.message}`, 'alert');
    }
}

async function handleAzureOvpnFileSelection() {
    try {
        console.log('📁 Abrindo diálogo de seleção de arquivo OVPN Azure...');
        const result = await window.electronAPI.selectOvpnFile();

        if (result.success) {
            console.log('✅ Arquivo Azure selecionado:', result.fileName);

            // Atualizar a interface com as informações do arquivo
            if (configAzureOvpnInfo) {
                configAzureOvpnInfo.style.display = 'block';
                if (configAzureOvpnName) {
                    configAzureOvpnName.textContent = result.fileName;
                }
            }

            // Mostrar checkbox de salvar perfil Azure
            if (configSaveAzureProfile) {
                configSaveAzureProfile.style.display = 'inline-block';
            }

            // Armazenar informações do arquivo para uso posterior
            selectedAzureOvpnFile = {
                path: result.filePath,
                name: result.fileName,
                content: result.content
            };

            showStatus(`Arquivo Azure "${result.fileName}" selecionado com sucesso!`, 'success');
            showConfigStatus(`Arquivo Azure "${result.fileName}" selecionado com sucesso!`, 'success');
        } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
            console.error('❌ Erro na seleção Azure:', result.error);
            showStatus(`Erro: ${result.error}`, 'alert');
            showConfigStatus(`Erro: ${result.error}`, 'alert');
        }
    } catch (error) {
        console.error('❌ Erro ao selecionar arquivo Azure:', error);
        showStatus(`Erro ao selecionar arquivo: ${error.message}`, 'alert');
        showConfigStatus(`Erro ao selecionar arquivo: ${error.message}`, 'alert');
    }
}

function handleSaveAzureProfileCheckbox() {
    const isChecked = configSaveAzureProfile.checked;
    console.log('📋 Checkbox salvar perfil Azure:', isChecked);

    // Mostrar/esconder campo de nome do perfil Azure
    if (configAzureProfileName) {
        configAzureProfileName.style.display = isChecked ? 'block' : 'none';
    }

    // Mostrar/esconder botão de salvar Azure
    if (configSaveAzureProfileBtn) {
        configSaveAzureProfileBtn.style.display = isChecked ? 'inline-block' : 'none';
    }
}

async function saveAzureProfileConfig() {
    if (!selectedAzureOvpnFile) {
        showStatus('Por favor, selecione um arquivo OVPN Azure primeiro.', 'alert');
        showConfigStatus('Por favor, selecione um arquivo OVPN Azure primeiro.', 'alert');
        return;
    }

    if (!configAzureProfileName || !configAzureProfileName.value.trim()) {
        showStatus('Por favor, digite um nome para o perfil Azure.', 'alert');
        showConfigStatus('Por favor, digite um nome para o perfil Azure.', 'alert');
        return;
    }

    const originalButtonText = configSaveAzureProfileBtn?.textContent;

    try {
        console.log('💾 Salvando perfil Azure...');
        showStatus('Salvando perfil Azure...', 'status');
        showConfigStatus('Salvando perfil Azure...', 'status');

        if (configSaveAzureProfileBtn) {
            configSaveAzureProfileBtn.disabled = true;
            configSaveAzureProfileBtn.textContent = 'Salvando...';
        }

        const profileId = `azure_${Date.now()}`;
        const profileName = configAzureProfileName.value.trim();

        const result = await window.electronAPI.saveAzureConfig(
            profileId,
            selectedAzureOvpnFile.content,
            profileName,
            selectedAzureOvpnFile.path
        );

        if (result?.success) {
            console.log('✅ Perfil Azure salvo:', result);
            showStatus(`Perfil Azure "${profileName}" salvo com sucesso!`, 'success');
            showConfigStatus(`Perfil Azure "${profileName}" salvo com sucesso!`, 'success');

            // Limpar formulário
            selectedAzureOvpnFile = null;
            if (configAzureProfileName) configAzureProfileName.value = '';
            if (configSaveAzureProfile) configSaveAzureProfile.checked = false;
            if (configAzureOvpnInfo) configAzureOvpnInfo.style.display = 'none';
            if (configSaveAzureProfileBtn) configSaveAzureProfileBtn.style.display = 'none';
            if (configAzureProfileName) configAzureProfileName.style.display = 'none';

            // Recarregar perfis
            await loadAllProfiles();
        } else {
            const errorMessage = result?.error || 'Falha desconhecida ao salvar perfil Azure.';
            console.error('❌ Erro ao salvar perfil Azure:', errorMessage);
            showStatus(`Erro ao salvar perfil Azure: ${errorMessage}`, 'alert');
            showConfigStatus(`Erro ao salvar perfil Azure: ${errorMessage}`, 'alert');
        }
    } catch (error) {
        console.error('❌ Erro ao salvar perfil Azure:', error);
        showStatus(`Erro ao salvar perfil Azure: ${error.message}`, 'alert');
        showConfigStatus(`Erro ao salvar perfil Azure: ${error.message}`, 'alert');
    } finally {
        if (configSaveAzureProfileBtn) {
            configSaveAzureProfileBtn.disabled = false;
            if (originalButtonText) {
                configSaveAzureProfileBtn.textContent = originalButtonText;
            }
        }
    }
}


async function deleteProfile(profileId, profileType) {
    if (!confirm(`Tem certeza que deseja excluir o perfil "${profileId}"?`)) {
        return;
    }

    try {
        console.log(`🗑️ Excluindo perfil ${profileType}:${profileId}...`);
        showStatus('Excluindo perfil...', 'status');
        showConfigStatus('Excluindo perfil...', 'status');

        let result;
        if (profileType === 'user') {
            result = await window.electronAPI.deleteUserProfile(profileId);
        } else if (profileType === 'azure') {
            result = await window.electronAPI.deleteAzureProfile(profileId);
        } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
            throw new Error('Tipo de perfil inválido');
        }

        if (result.success) {
            console.log('✅ Perfil excluído:', profileId);
            showStatus('Perfil excluído com sucesso!', 'success');
            showConfigStatus('Perfil excluído com sucesso!', 'success');

            // Recarregar perfis
            await loadAllProfiles();
        } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
            console.error('❌ Erro ao excluir perfil:', result.error);
            showStatus(`Erro ao excluir perfil: ${result.error}`, 'alert');
            showConfigStatus(`Erro ao excluir perfil: ${result.error}`, 'alert');
        }
    } catch (error) {
        console.error('❌ Erro ao excluir perfil:', error);
        showStatus(`Erro ao excluir perfil: ${error.message}`, 'alert');
        showConfigStatus(`Erro ao excluir perfil: ${error.message}`, 'alert');
    }
}

// ============ SISTEMA DE ATUALIZAÇÃO ============

function initializeUpdateElements() {
    // Inicializar elementos de atualização se existirem
    console.log('🔄 Elementos de atualização inicializados');
}

function setUpdateCheckingState(isChecking) {
    isManualUpdateCheckRunning = isChecking;
    if (!updateBtn) return;

    updateBtn.disabled = isChecking;
    if (isChecking) {
        updateBtn.innerHTML = 'Verificando...';
    } else if (!updateInfo) {
        updateBtn.innerHTML = updateBtnDefaultHtml;
    }
}

function withLocalTimeout(promise, timeoutMs, message) {
    let timeout;
    const timeoutPromise = new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ success: false, error: message, timeout: true }), timeoutMs);
    });

    return Promise.race([
        promise.finally(() => clearTimeout(timeout)),
        timeoutPromise
    ]);
}

function getIpcPayload(eventOrPayload, payload) {
    return payload === undefined ? eventOrPayload : payload;
}

async function checkForUpdates() {
    try {
        if (isManualUpdateCheckRunning) return;
        console.log('🔄 BOTÃO DE ATUALIZAÇÃO CLICADO - Verificando atualizações...');
        showStatus('Verificando atualizações...', 'status');
        setUpdateCheckingState(true);

        const result = await withLocalTimeout(
            window.electronAPI.checkForUpdates(true),
            UPDATE_CHECK_TIMEOUT_MS,
            'Tempo esgotado ao verificar atualizações.'
        );

        // Não exibir "versão mais recente" aqui — o resultado correto chega via evento:
        // onUpdateAvailable (se houver update) ou onUpdateCheckComplete (se não houver).
        // Exibir mensagem apenas em caso de erro técnico no IPC.
        if (!result.success) {
            showStatus(`Erro na verificação: ${result.error}`, 'alert');
            setUpdateCheckingState(false);
        }
    } catch (error) {
        console.error('❌ Erro ao verificar atualizações:', error);
        showStatus(`Erro ao verificar atualizações: ${error.message}`, 'alert');
        setUpdateCheckingState(false);
    }
}

async function checkForUpdatesOnStartup() {
    try {
        console.log('🔄 Verificando atualizações automaticamente...');
        await window.electronAPI.checkForUpdates(false);
    } catch (error) {
        console.warn('Erro na verificação automática de atualizações:', error);
    }
}

function closeUpdateModal() {
    if (updateModal) {
        updateModal.style.display = 'none';
    }
}

// ============ EVENT LISTENERS IPC ============

// Configurar listeners de eventos IPC
if (window.electronAPI) {
    // Device Code Response (Azure Login)
    window.electronAPI.onDeviceCodeResponse((event, deviceCodeData) => {
        try {
        console.log('🔐 Device code recebido:', deviceCodeData);
        logToMain('RENDERER', 'DEVICE_CODE_RECEIVED', {
            hasUri: !!deviceCodeData.verification_uri,
            hasCode: !!deviceCodeData.user_code
        });

        // Armazenar device code
        currentDeviceCode = deviceCodeData;

        // Atualizar interface
        if (verificationUri && deviceCodeData.verification_uri) {
            verificationUri.textContent = deviceCodeData.verification_uri;
        }

        if (userCode && deviceCodeData.user_code) {
            userCode.textContent = deviceCodeData.user_code;
        }

        // Mostrar seção de device code
        if (deviceCodeSection) {
            deviceCodeSection.style.display = 'block';
        }

        // Mostrar botão de copiar código
        if (btnCopiarCodigo) {
            btnCopiarCodigo.style.display = 'block';
        }

        showStatus('Código de verificação gerado. Copie e use no navegador.', 'success');
        } catch (err) {
            console.error('❌ Erro ao processar device code:', err);
            showStatus('Erro ao processar autenticação: ' + err.message, 'alert');
        }
    });

    // Evento de desconexão externa
    window.electronAPI.onVPNDisconnected(() => {
        console.log('🔌 VPN desconectada externamente');
        showStatus('VPN desconectada externamente.', 'status');
        vpnPid = null;
        updateConnectionButtons();

        // Esconder device code quando desconectar
        if (deviceCodeSection) {
            deviceCodeSection.style.display = 'none';
        }
        if (btnCopiarCodigo) {
            btnCopiarCodigo.style.display = 'none';
        }
        currentDeviceCode = null;
    });

    // Evento de conexão estabelecida
    window.electronAPI.onVPNConnected((event, data) => {
        console.log('🔗 VPN conectada:', data);
        vpnPid = data.pid;
        updateConnectionButtons();
        showStatus('VPN conectada com sucesso!', 'success');

        // Esconder device code quando conectar
        if (deviceCodeSection) {
            deviceCodeSection.style.display = 'none';
        }
        if (btnCopiarCodigo) {
            btnCopiarCodigo.style.display = 'none';
        }
        currentDeviceCode = null;
    });

    // Desafio 2FA - abrir modal real
    window.electronAPI.onVpnChallenge((event, data) => {
        console.log('🔐 Desafio VPN recebido:', {
            type: data?.type,
            requiresInput: !!data?.requiresInput,
            usesEcho: !!data?.usesEcho,
            usesAuthUserPass: !!data?.usesAuthUserPass,
            composeLocalMfa: !!data?.composeLocalMfa,
            messageLength: data?.message ? String(data.message).length : 0
        });

        const modal = document.getElementById('challengeModal');
        const msgEl = document.getElementById('challengeMessage');
        const inputEl = document.getElementById('challengeResponse');
        const timerEl = document.getElementById('challengeTimer');
        const submitBtn = document.getElementById('submitChallengeBtn');
        const cancelBtn = document.getElementById('cancelChallengeBtn');

        if (!modal) {
            console.error('challengeModal não encontrado no DOM');
            showStatus(`Desafio 2FA: ${data.message}`, 'alert');
            return;
        }

        // Preencher mensagem e limpar input
        msgEl.textContent = data.message || 'Digite o token do Google Authenticator:';
        inputEl.value = '';

        // Mostrar modal
        modal.style.display = 'flex';
        setTimeout(() => inputEl.focus(), 100);

        // Timer regressivo
        let secondsLeft = 120;
        timerEl.textContent = `Tempo restante: ${secondsLeft} segundos`;
        const timerInterval = setInterval(() => {
            secondsLeft--;
            timerEl.textContent = `Tempo restante: ${secondsLeft} segundos`;
            if (secondsLeft <= 0) {
                closeModal();
                showStatus('Tempo esgotado para o token 2FA', 'error');
                if (window.electronAPI.cancelChallenge) {
                    window.electronAPI.cancelChallenge().catch((err) => {
                        console.error('Erro ao cancelar challenge no main:', err);
                    });
                }
            }
        }, 1000);

        let submitted = false;
        let unbindAutoSubmit = null;
        const submitClone = submitBtn.cloneNode(true);
        const cancelClone = cancelBtn.cloneNode(true);
        submitBtn.replaceWith(submitClone);
        cancelBtn.replaceWith(cancelClone);

        const closeModal = () => {
            clearInterval(timerInterval);
            modal.style.display = 'none';
            inputEl.value = '';
            inputEl.removeEventListener('keydown', onKeyDown);
            if (unbindAutoSubmit) unbindAutoSubmit();
        };

        // Enviar token
        const onSubmit = async () => {
            if (submitted) return;
            const token = sanitizeChallengeInput(inputEl);
            if (!/^\d{6}$/.test(token)) {
                showStatus('Token deve ser exatamente 6 dígitos numéricos.', 'alert');
                return;
            }
            submitted = true;
            console.log('📤 Enviando token 2FA');
            try {
                await window.electronAPI.sendChallengeResponse(token);
                closeModal();
            } catch (err) {
                submitted = false;
                console.error('Erro ao enviar token 2FA:', err);
                showStatus('Erro ao enviar token 2FA. Tente novamente.', 'error');
            }
        };

        // Cancelar
        const onCancel = () => {
            closeModal();
            showStatus('Autenticação 2FA cancelada', 'alert');
            if (window.electronAPI.cancelChallengeResponse) {
                window.electronAPI.cancelChallengeResponse().catch((err) => {
                    console.error('Erro ao cancelar token 2FA:', err);
                });
            }
        };

        // Enter no input também submete
        const onKeyDown = (e) => {
            if (e.key === 'Enter') onSubmit();
            if (e.key === 'Escape') onCancel();
        };

        submitClone.addEventListener('click', onSubmit);
        cancelClone.addEventListener('click', onCancel);
        inputEl.addEventListener('keydown', onKeyDown);
        unbindAutoSubmit = bindChallengeAutoSubmit(inputEl, onSubmit);
    });

    if (window.electronAPI.onVpnChallengeExpired) {
        window.electronAPI.onVpnChallengeExpired(() => {
            const modal = document.getElementById('challengeModal');
            if (modal && modal.style.display !== 'none') {
                modal.style.display = 'none';
                showStatus('Tempo esgotado para o token 2FA', 'error');
            }
        });
    }

    // Função para extrair versão do update info (centralizada como app.getVersion())
    async function getUpdateVersion(info) {
        console.log('🔍 getUpdateVersion called with info:', info);
        let version = info.version || info.releaseName || info.tag;
        console.log('📋 Raw version from info:', version);
        if (typeof version === 'string' && version.startsWith('v')) {
            version = version.substring(1);
        }
        if (!version) {
            // Fallback: incrementar versão atual (assumindo patch)
            const currentVersion = await window.electronAPI.getVersion();
            const parts = currentVersion.split('.');
            parts[2] = (parseInt(parts[2]) + 1).toString();
            version = parts.join('.');
            console.log('📦 Fallback version (incremented):', version);
        }
        console.log('📦 Final version:', version);
        return version;
    }

    // Eventos de atualização
    window.electronAPI.onUpdateAvailable(async (event, data) => {
        const payload = getIpcPayload(event, data);
        const info = payload.info || payload;
        const showDialog = payload.showDialog;
        console.log('🎉 Update available event received:', JSON.stringify(payload, null, 2));
        if (!info) {
            console.error('❌ Info is null or undefined');
            return;
        }
        logToMain('RENDERER', 'UPDATE_AVAILABLE', { info: info, showDialog: showDialog });
        updateInfo = info;
        const version = await getUpdateVersion(info);
        console.log('📦 Extracted version:', version);
        if (updateBtn) {
            updateBtn.style.display = 'block';
            updateBtn.disabled = false;
            updateBtn.innerHTML = `<img src="local-resource://icon-download.png" alt="Icon Download" class="mg-top-icon"> Baixar ${version}`;
        }
        // Atualizar modal com nova versão
        const updateVersionEl = document.getElementById('updateVersion');
        if (updateVersionEl) {
            updateVersionEl.textContent = version;
        }
        const updateDateEl = document.getElementById('updateDate');
        console.log('📅 Release date from info:', info.releaseDate);
        if (updateDateEl && info.releaseDate) {
            updateDateEl.textContent = new Date(info.releaseDate).toLocaleDateString('pt-BR');
        } else if (updateDateEl) {
            // Fallback: usar data atual
            updateDateEl.textContent = new Date().toLocaleDateString('pt-BR');
            console.log('📅 Using fallback date (current):', updateDateEl.textContent);
        }
        const updateNotesEl = document.getElementById('updateNotes');
        if (updateNotesEl && info.releaseNotes) {
            updateNotesEl.innerHTML = `<p><strong>Notas de lançamento:</strong></p><pre>${info.releaseNotes}</pre>`;
        }
        if (showDialog) {
            // Abrir modal apenas quando chamado manualmente
            if (updateModal) {
                setUpdateDownloadState('ready');
                updateModal.style.display = 'flex';
            }
        }
        showStatus('Atualização disponível!', 'success');
        isManualUpdateCheckRunning = false;
    });

    window.electronAPI.onUpdateDownloaded((event, data) => {
        const info = getIpcPayload(event, data);
        console.log('📦 Update downloaded:', info);
        setUpdateDownloadState('downloaded');
    });

    window.electronAPI.onUpdateError((event, error) => {
        const updateError = getIpcPayload(event, error);
        console.log('❌ Update error:', updateError);
        setUpdateDownloadState('error');
        setUpdateCheckingState(false);
        showStatus(`Erro na atualização: ${updateError?.message || 'falha desconhecida'}`, 'alert');
    });

    window.electronAPI.onUpdateDownloadStarted(() => {
        console.log('🚀 Update download started, opening modal');
        if (updateModal) {
            updateModal.style.display = 'flex';
        }
    });

    window.electronAPI.onUpdateProgress((event, data) => {
        const progress = getIpcPayload(event, data);
        console.log('📊 Update progress:', progress);
        setUpdateDownloadState('downloading');
        const progressFill = document.getElementById('progressFill');
        if (progressFill) {
            progressFill.style.width = `${progress.percent}%`;
        }

    });

    window.electronAPI.onUpdateCheckComplete((event, data) => {
        const payload = getIpcPayload(event, data);
        if (!payload) return;
        if (payload.available === false) {
            setUpdateCheckingState(false);
            showStatus('Verificação concluída. Você está usando a versão mais recente.', 'success');
        }
    });

    // IS003: OpenVPN não encontrado no Windows — exibe link de download
    window.electronAPI.onOpenVpnNotFound((data) => {
        const url = data?.downloadUrl || 'https://openvpn.net/community-downloads/';
        showStatus(
            `OpenVPN não encontrado. <a href="#" onclick="window.electronAPI.openExternal('${url}');return false;" style="color:inherit;text-decoration:underline;">Baixar OpenVPN</a>`,
            'alert'
        );
    });

    // RF010: notificação de reconexão automática em andamento
    window.electronAPI.onVpnReconnecting((data) => {
        showStatus(
            `Conexão perdida. Reconectando... (tentativa ${data.attempt}/${data.maxRetries} em ${data.delaySeconds}s)`,
            'alert'
        );
        console.log('🔄 [RF010] Reconexão agendada:', data);
    });

    window.electronAPI.onVpnReconnectFailed((data) => {
        showStatus(`Reconexão automática falhou após ${data.maxRetries} tentativas.`, 'alert');
        console.log('⛔ [RF010] Reconexão falhou:', data);
        updateConnectionButtons();
    });

    // RF010: reconexão automática de perfis de usuário — dispara connect novamente
    window.electronAPI.onVpnAutoReconnect(async (data) => {
        console.log('🔄 [RF010] Iniciando reconexão automática para perfil:', data.profileId);
        try {
            await connectVPN();
        } catch (err) {
            console.error('❌ [RF010] Falha na reconexão:', err.message);
        }
    });

    // RNF013/RNF014: Modo compacto
    const compactModeToggle = document.getElementById('compactModeToggle');
    if (compactModeToggle && window.electronAPI?.loadAppSettings) {
        window.electronAPI.loadAppSettings().then((settings) => {
            compactModeToggle.checked = !!settings.compactMode;
        }).catch(() => {});

        compactModeToggle.addEventListener('change', async () => {
            const enabled = compactModeToggle.checked;
            if (window.electronAPI?.setCompactMode) {
                await window.electronAPI.setCompactMode(enabled);
            }
            document.body.classList.toggle('compact', enabled);
            syncConfigureProfilesLinkVisibility();
        });
    }

    // RF011: Kill Switch toggle
    const killSwitchToggle = document.getElementById('killSwitchToggle');
    const killSwitchStatus = document.getElementById('killSwitchStatus');
    if (killSwitchToggle) {
        window.electronAPI.getKillSwitchStatus().then((status) => {
            killSwitchToggle.checked = status.enabled;
            if (killSwitchStatus) {
                killSwitchStatus.style.display = status.active ? 'block' : 'none';
                killSwitchStatus.textContent = status.active ? 'Kill Switch ativo: tráfego bloqueado.' : '';
            }
        }).catch(() => {});

        killSwitchToggle.addEventListener('change', async () => {
            if (killSwitchToggle.checked) {
                await window.electronAPI.enableKillSwitch();
            } else {
                await window.electronAPI.disableKillSwitch();
                if (killSwitchStatus) {
                    killSwitchStatus.style.display = 'none';
                    killSwitchStatus.textContent = '';
                }
            }
        });
    }

    const dnsLeakProtectionToggle = document.getElementById('dnsLeakProtectionToggle');
    const primaryDnsInput = document.getElementById('primaryDnsInput');
    const secondaryDnsInput = document.getElementById('secondaryDnsInput');
    if (dnsLeakProtectionToggle && primaryDnsInput && secondaryDnsInput && window.electronAPI?.loadAppSettings) {
        const syncDnsInputs = () => {
            primaryDnsInput.disabled = !dnsLeakProtectionToggle.checked;
            secondaryDnsInput.disabled = !dnsLeakProtectionToggle.checked;
        };
        const saveDnsSettings = async () => {
            if (window.electronAPI?.saveAppSettings) {
                await window.electronAPI.saveAppSettings({
                    dnsLeakProtectionEnabled: dnsLeakProtectionToggle.checked,
                    primaryDns: primaryDnsInput.value.trim(),
                    secondaryDns: secondaryDnsInput.value.trim()
                });
            }
        };
        window.electronAPI.loadAppSettings().then((settings) => {
            dnsLeakProtectionToggle.checked = settings.dnsLeakProtectionEnabled === true;
            primaryDnsInput.value = settings.primaryDns || '';
            secondaryDnsInput.value = settings.secondaryDns || '';
            syncDnsInputs();
        }).catch(() => {
            syncDnsInputs();
        });
        dnsLeakProtectionToggle.addEventListener('change', async () => {
            syncDnsInputs();
            await saveDnsSettings();
        });
        primaryDnsInput.addEventListener('change', saveDnsSettings);
        secondaryDnsInput.addEventListener('change', saveDnsSettings);
    }

    // RF004: sessão limpa pelo processo principal (após logout)
    window.electronAPI.onSessionCleared(() => {
        vpnPid = null;
        currentProfile = null;
        if (userUsername) userUsername.value = '';
        if (userPassword) userPassword.value = '';
        if (rememberCredentials) rememberCredentials.checked = false;
        updateConnectionButtons();
        updateProfileDisplay();
        showStatus('Sessão encerrada com sucesso.', 'success');
        console.log('🔓 Sessão limpa pelo processo principal');
    });

    // RNF012: Logo customizado
    const customLogoChangeBtn = document.getElementById('customLogoChangeBtn');
    const customLogoRemoveBtn = document.getElementById('customLogoRemoveBtn');
    const customLogoFileInput = document.getElementById('customLogoFileInput');

    if (customLogoChangeBtn && customLogoFileInput) {
        customLogoChangeBtn.addEventListener('click', () => customLogoFileInput.click());
        customLogoFileInput.addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            const allowedExtensions = ['jpeg', 'jpg', 'bmp', 'png', 'gif'];
            const allowedMimeTypes = ['image/jpeg', 'image/bmp', 'image/png', 'image/gif'];
            const extension = file.name.split('.').pop().toLowerCase();
            if (!allowedExtensions.includes(extension) || !allowedMimeTypes.includes(file.type)) {
                showStatus('Logo inválido. Use apenas arquivos JPEG, JPG, BMP, PNG ou GIF.', 'alert');
                customLogoFileInput.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64 = e.target.result;
                const image = new Image();
                image.onload = async () => {
                    if (image.naturalWidth !== 120 || image.naturalHeight !== 120) {
                        showStatus('Logo inválido. A imagem deve ter exatamente 120x120 pixels.', 'alert');
                        customLogoFileInput.value = '';
                        return;
                    }
                    await window.electronAPI.saveCustomLogo(base64);
                    applyCustomLogo(base64);
                    customLogoFileInput.value = '';
                };
                image.onerror = () => {
                    showStatus('Logo inválido. Não foi possível carregar a imagem selecionada.', 'alert');
                    customLogoFileInput.value = '';
                };
                image.src = base64;
            };
            reader.onerror = () => {
                showStatus('Logo inválido. Não foi possível ler o arquivo selecionado.', 'alert');
                customLogoFileInput.value = '';
            };
            reader.readAsDataURL(file);
        });
    }

    if (customLogoRemoveBtn) {
        customLogoRemoveBtn.addEventListener('click', async () => {
            await window.electronAPI.removeCustomLogo();
            applyCustomLogo(null);
        });
    }

    // Identidade Visual: botões Aplicar e Restaurar
    const applyColorsBtn = document.getElementById('applyColorsBtn');
    const resetColorsBtn = document.getElementById('resetColorsBtn');

    if (applyColorsBtn) {
        applyColorsBtn.addEventListener('click', async () => {
            const primary = document.getElementById('colorPrimary').value;
            const accent = document.getElementById('colorAccent').value;
            const bg = document.getElementById('colorBackground').value;
            applyThemeColors(primary, accent, bg);
            if (window.electronAPI?.saveAppSettings) {
                await window.electronAPI.saveAppSettings({ colorPrimary: primary, colorAccent: accent, colorBackground: bg });
            }
        });
    }

    if (resetColorsBtn) {
        resetColorsBtn.addEventListener('click', async () => {
            const defaults = { colorPrimary: '#0078BE', colorAccent: '#00eeff', colorBackground: '#0A162E' };
            const elPrimary = document.getElementById('colorPrimary');
            const elAccent = document.getElementById('colorAccent');
            const elBg = document.getElementById('colorBackground');
            if (elPrimary) elPrimary.value = defaults.colorPrimary;
            if (elAccent) elAccent.value = defaults.colorAccent;
            if (elBg) elBg.value = defaults.colorBackground;
            applyThemeColors(defaults.colorPrimary, defaults.colorAccent, defaults.colorBackground);
            if (window.electronAPI?.saveAppSettings) {
                await window.electronAPI.saveAppSettings(defaults);
            }
        });
    }
}

// Identidade Visual: aplica cores ao tema
function applyThemeColors(primary, accent, bg) {
    document.documentElement.style.setProperty('--color-primary', primary);
    document.documentElement.style.setProperty('--color-accent', accent);
    document.documentElement.style.setProperty('--color-bg', bg);
    document.body.style.background = bg;
    const appWrapper = document.querySelector('.app-wrapper');
    if (appWrapper) appWrapper.style.background = bg;
    const loginContainer = document.querySelector('.login-container');
    if (loginContainer) loginContainer.style.background = bg;
    document.querySelectorAll('.btn-connect, #connectBtn').forEach(el => { el.style.background = primary; el.style.borderColor = primary; });
    document.querySelectorAll('.topbar').forEach(el => el.style.background = primary);
    document.querySelectorAll('.profile-header').forEach(el => el.style.background = primary);
    document.querySelectorAll('a').forEach(el => el.style.color = accent);
    document.querySelectorAll('.config-section h4').forEach(el => el.style.color = accent);
    const footer = document.getElementById('appFooter');
    if (footer) footer.style.backgroundColor = (primary && primary !== '#0078BE') ? primary : '#061C30';

    const configContent = document.querySelector('.config-content');
    if (configContent) {
        configContent.style.background = bg === '#0A162E' ? '#061c2e' : bg;
        configContent.style.borderColor = primary + '33';
    }
    document.querySelectorAll('.config-section').forEach(el => {
        el.style.borderColor = primary + '22';
    });
    document.querySelectorAll('.config-section h4').forEach(el => {
        el.style.color = accent;
        el.style.borderBottomColor = primary + '55';
    });

    document.querySelectorAll('.logs-modal .modal-content').forEach(el => {
        el.style.background = bg === '#0A162E' ? '#061c2e' : bg;
    });

    const challengeContent = document.querySelector('.challenge-content');
    if (challengeContent) challengeContent.style.background = bg === '#0A162E' ? '#0A162E' : bg;
    const challengeInput = document.querySelector('.challenge-input');
    if (challengeInput) challengeInput.style.background = primary + '22';

    const updateContent = document.querySelector('.update-content');
    if (updateContent) {
        updateContent.style.background = bg === '#0A162E' ? '#061c2e' : bg;
        updateContent.style.borderColor = primary;
    }
    document.querySelectorAll('.spinner').forEach(el => {
        el.style.borderTopColor = primary;
    });

    document.querySelectorAll('.profile-item.active').forEach(el => {
        el.style.background = primary + '33';
        el.style.borderLeftColor = primary;
    });

    document.documentElement.style.setProperty('--scrollbar-thumb', primary);
    document.documentElement.style.setProperty('--scrollbar-track', bg);

    document.querySelectorAll('.btn-outline-info').forEach(el => {
        el.style.borderColor = primary;
        el.style.color = primary;
    });
    document.querySelectorAll('.btn-outline-primary').forEach(el => {
        el.style.borderColor = primary;
        el.style.color = primary;
    });

    document.querySelectorAll('.status-indicator, .vpn-status').forEach(el => {
        if (!el.classList.contains('connected') && !el.classList.contains('error')) {
            el.style.borderColor = primary;
        }
    });

    const statsContent = document.querySelector('#statsModal .config-content');
    if (statsContent) {
        statsContent.style.background = bg === '#0A162E' ? '#061c2e' : bg;
        statsContent.style.borderColor = primary + '33';
    }
    document.querySelectorAll('.stat-box').forEach(el => {
        el.style.borderColor = primary + '33';
    });
    document.querySelectorAll('.stat-bar-fill').forEach(el => {
        if (el.style.background !== '#f44336') el.style.background = primary;
    });
    document.querySelectorAll('.stat-label').forEach(el => {
        el.style.color = accent;
    });
}

// RNF012: aplica logo customizado ao header e ao preview
function applyCustomLogo(base64OrNull) {
    const headerLogo = document.querySelector('img.logo');
    const preview = document.getElementById('customLogoPreview');
    const src = base64OrNull || 'local-resource://logo.png';
    if (headerLogo) headerLogo.src = src;
    if (preview) preview.src = src;
    if (window.electronAPI && window.electronAPI.setAppIcon) {
        window.electronAPI.setAppIcon(base64OrNull).catch(() => {});
    }
}

async function loadAndApplyCustomLogo() {
    try {
        if (!window.electronAPI || !window.electronAPI.loadCustomLogo) return;
        const result = await window.electronAPI.loadCustomLogo();
        if (result && result.success && result.data) {
            applyCustomLogo(result.data);
        }
    } catch (error) {
        console.warn('RNF012: erro ao carregar logo customizado:', error);
    }
}

async function updateCopyright() {
    try {
        const currentYear = new Date().getFullYear();
        const version = await window.electronAPI.getVersion();
        const copyrightElement = document.getElementById('copyright');
        if (copyrightElement) {
            copyrightElement.textContent = `BluePex® CyberSecurity © Copyright ${currentYear} - v${version}`;
        }
    } catch (error) {
        console.error('Erro ao atualizar copyright:', error);
    }
}

function toggleAppLogsModal() {
    console.log("📊 Alternando modal de logs da aplicação");
    if (appLogsModal) {
        const isVisible = appLogsModal.classList.contains('show');
        console.log("  Modal está visível:", isVisible);

        if (isVisible) {
            appLogsModal.classList.remove('show');
        appLogsModal.style.display = 'none';
            console.log("  Classe 'show' removida");
        } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
            appLogsModal.classList.add('show');
            appLogsModal.style.display = 'flex';
            updateAppLogsModalContent();
            console.log("  Classe 'show' adicionada");
        }

        logToMain('RENDERER', 'APP_LOGS_MODAL_TOGGLE', {
            wasVisible: isVisible,
            nowVisible: !isVisible
        });
    } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
        console.error("❌ appLogsModal não encontrado");
        console.log("appLogsModal não encontrado");
        logToMain('RENDERER', 'APP_LOGS_MODAL_NOT_FOUND', {}, 'ERROR');
    }
}

function closeAppLogsModal() {
    console.log("Fechando modal de logs da aplicação");
    if (appLogsModal) {
        appLogsModal.classList.remove('show');
        appLogsModal.style.display = 'none';
    }
}

async function updateAppLogsModalContent() {
    if (appLogsModalContent) {
        try {
            console.log('📊 Carregando logs da aplicação...');
            const result = await window.electronAPI.getAppLogs();

            if (result.success) {
                let content = result.logs;

                // Formatar logs JSON para melhor leitura
                const lines = content.split('\n');
                const formattedLines = lines.map(line => {
                    try {
                        const logEntry = JSON.parse(line);
                        const timestamp = new Date(logEntry.timestamp).toLocaleString();
                        const level = logEntry.level.padEnd(5);
                        const category = logEntry.category.padEnd(10);
                        const action = logEntry.action;
                        const data = JSON.stringify(logEntry.data, null, 2);
                        return timestamp + " [" + level + "] [" + category + "] " + action + ": " + data;
                    } catch {
                        return line; // Se não for JSON, mostrar como está
                    }
                });

                content = formattedLines.join('\n');
                appLogsModalContent.textContent = content;
            } else {
        console.log("closeLogsModalBtn não encontrado");
        console.log("connLogsModal não encontrado");
                appLogsModalContent.textContent = "❌ Erro ao carregar logs: " + result.error;
            }
        } catch (error) {
            console.error('Erro ao carregar logs da aplicação:', error);
            appLogsModalContent.textContent = '📊 Erro ao carregar logs da aplicação. Verifique o console para mais detalhes.';
        }
    }

    // Rolar para o final
    appLogsModalContent.scrollTop = appLogsModalContent.scrollHeight;
}

// ============ RNF008: GRÁFICO DE CONSUMO E HISTÓRICO ============

const CHART_POINTS = 60;
const chartSpeedIn = new Array(CHART_POINTS).fill(0);
const chartSpeedOut = new Array(CHART_POINTS).fill(0);
let statsCurrentTab = 'chart';

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}

function formatSpeed(bytesPerSec) {
    return formatBytes(bytesPerSec) + '/s';
}

function drawTrafficChart() {
    const canvas = document.getElementById('traffic-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, w, h);

    const maxVal = Math.max(1, ...chartSpeedIn, ...chartSpeedOut);
    const stepX = w / (CHART_POINTS - 1);

    const drawLine = (data, color) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        data.forEach((val, i) => {
            const x = i * stepX;
            const y = h - (val / maxVal) * (h - 4) - 2;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    };

    const fillLine = (data, color) => {
        ctx.beginPath();
        ctx.fillStyle = color;
        data.forEach((val, i) => {
            const x = i * stepX;
            const y = h - (val / maxVal) * (h - 4) - 2;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.lineTo((CHART_POINTS - 1) * stepX, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
    };

    fillLine(chartSpeedIn, 'rgba(79,195,247,0.15)');
    fillLine(chartSpeedOut, 'rgba(102,187,106,0.15)');
    drawLine(chartSpeedIn, '#4fc3f7');
    drawLine(chartSpeedOut, '#66bb6a');

    ctx.fillStyle = 'rgba(79,195,247,0.8)';
    ctx.font = '9px monospace';
    ctx.fillText('RX', 4, 12);
    ctx.fillStyle = 'rgba(102,187,106,0.8)';
    ctx.fillText('TX', 4, 24);
}

function updateTrafficStats(data) {
    chartSpeedIn.push(data.speedIn || 0);
    chartSpeedOut.push(data.speedOut || 0);
    if (chartSpeedIn.length > CHART_POINTS) chartSpeedIn.shift();
    if (chartSpeedOut.length > CHART_POINTS) chartSpeedOut.shift();

    const speedInEl = document.getElementById('stat-speed-in');
    const speedOutEl = document.getElementById('stat-speed-out');
    const bytesInEl = document.getElementById('stat-bytes-in');
    const bytesOutEl = document.getElementById('stat-bytes-out');

    if (speedInEl) speedInEl.textContent = formatSpeed(data.speedIn || 0);
    if (speedOutEl) speedOutEl.textContent = formatSpeed(data.speedOut || 0);
    if (bytesInEl) bytesInEl.textContent = formatBytes(data.bytesIn || 0);
    if (bytesOutEl) bytesOutEl.textContent = formatBytes(data.bytesOut || 0);

    const statsSpeedIn = document.getElementById('statsSpeedIn');
    const statsSpeedOut = document.getElementById('statsSpeedOut');
    const statsTotalIn = document.getElementById('statsTotalIn');
    const statsTotalOut = document.getElementById('statsTotalOut');
    if (statsSpeedIn) statsSpeedIn.textContent = formatSpeed(data.speedIn || 0);
    if (statsSpeedOut) statsSpeedOut.textContent = formatSpeed(data.speedOut || 0);
    if (statsTotalIn) statsTotalIn.textContent = formatBytes(data.bytesIn || 0);
    if (statsTotalOut) statsTotalOut.textContent = formatBytes(data.bytesOut || 0);

    if (statsCurrentTab === 'chart') drawTrafficChart();

    const statsModal = document.getElementById('statsModal');
    if (statsModal && statsModal.classList.contains('show')) {
        drawStatsChart();
    }
}

function showStatsPanel() {
    const panel = document.getElementById('vpn-stats-panel');
    if (panel) panel.style.display = 'block';
    chartSpeedIn.fill(0);
    chartSpeedOut.fill(0);
    drawTrafficChart();
}

function hideStatsPanel() {
    const panel = document.getElementById('vpn-stats-panel');
    if (panel) panel.style.display = 'none';
}

function switchStatsTab(tab) {
    statsCurrentTab = tab;
    const chartTab = document.getElementById('statsTabChart');
    const historyTab = document.getElementById('statsTabHistory');
    const historyList = document.getElementById('connection-history-list');
    const canvas = document.getElementById('traffic-chart');
    const summary = document.getElementById('traffic-summary');

    if (tab === 'chart') {
        if (chartTab) chartTab.classList.add('active');
        if (historyTab) historyTab.classList.remove('active');
        if (historyList) historyList.style.display = 'none';
        if (canvas) canvas.style.display = 'block';
        if (summary) summary.style.display = 'flex';
        drawTrafficChart();
    } else {
        if (historyTab) historyTab.classList.add('active');
        if (chartTab) chartTab.classList.remove('active');
        if (historyList) historyList.style.display = 'block';
        if (canvas) canvas.style.display = 'none';
        if (summary) summary.style.display = 'none';
        renderConnectionHistory();
    }
}

async function renderConnectionHistory() {
    const listEl = document.getElementById('connection-history-list');
    if (!listEl) return;
    try {
        const history = await window.electronAPI.getConnectionHistory();
        if (!history || history.length === 0) {
            listEl.innerHTML = '<div style="color:#6c8fa8;font-size:0.75rem;padding:8px 0;text-align:center">Nenhum histórico disponível</div>';
            return;
        }
        const reversed = [...history].reverse();
        listEl.innerHTML = reversed.map(entry => {
            const date = entry.startedAt ? new Date(entry.startedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
            const dur = entry.durationSeconds > 0 ? (entry.durationSeconds >= 60 ? Math.floor(entry.durationSeconds / 60) + 'min' : entry.durationSeconds + 's') : '-';
            const rx = formatBytes(entry.bytesIn || 0);
            const tx = formatBytes(entry.bytesOut || 0);
            const reason = entry.disconnectReason === 'error' ? '<span style="color:#f44336">erro</span>' : (entry.disconnectReason === 'reconnect' ? '<span style="color:#ffc107">reconexão</span>' : '<span style="color:#66bb6a">manual</span>');
            return `<div class="history-item">
                <div>
                    <div class="hi-name">${entry.profileName || 'VPN'}</div>
                    <div class="hi-date">${date} &bull; ${entry.profileType || ''}</div>
                </div>
                <div style="text-align:right">
                    <div class="hi-dur">${dur} &bull; ${reason}</div>
                    <div class="hi-date">RX ${rx} / TX ${tx}</div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        listEl.innerHTML = '<div style="color:#f44336;font-size:0.75rem;padding:8px 0">Erro ao carregar histórico</div>';
    }
}

let lastMemoryLevel = null;

function getMemoryLevelColor(level) {
    if (level === 'critical') return '#f44336';
    if (level === 'warning') return '#ffc107';
    return '#0078BE';
}

function updateMemoryStats(mem) {
    const rssEl = document.getElementById('statRssVal');
    const heapEl = document.getElementById('statHeapVal');
    const rssBar = document.getElementById('statRssBar');
    const heapBar = document.getElementById('statHeapBar');
    const thresholdEl = document.getElementById('statThresholdVal');
    const thresholdLabelEl = document.getElementById('statThresholdLabel');
    const criticalThreshold = mem.criticalThreshold || mem.threshold || 350;
    const warningThreshold = mem.warningThreshold || mem.threshold || 250;
    const color = getMemoryLevelColor(mem.level);
    if (rssEl) rssEl.textContent = mem.rss + ' MB';
    if (heapEl) heapEl.textContent = mem.heapUsed + ' MB';
    if (rssBar) {
        rssBar.style.width = Math.min(100, (mem.rss / criticalThreshold) * 100) + '%';
        rssBar.style.background = color;
    }
    if (heapBar) {
        heapBar.style.width = Math.min(100, (mem.heapUsed / criticalThreshold) * 100) + '%';
        heapBar.style.background = color;
    }
    if (thresholdEl) {
        thresholdEl.textContent = 'Alerta ' + warningThreshold + ' MB / Crítico ' + criticalThreshold + ' MB';
        thresholdEl.style.color = color;
    }
    if (thresholdLabelEl) thresholdLabelEl.textContent = mem.level === 'critical' ? 'Limite RAM Crítico' : (mem.level === 'warning' ? 'Limite RAM Alerta' : 'Limite RAM');
}

function logMemoryLevelChange(mem) {
    if (lastMemoryLevel === mem.level) return;
    lastMemoryLevel = mem.level;
    try {
        const payload = { rss: mem.rss, level: mem.level, warningThreshold: mem.warningThreshold, criticalThreshold: mem.criticalThreshold };
        logToMain('SYSTEM', mem.level === 'normal' ? 'MEMORY_USAGE_NORMALIZED' : 'MEMORY_THRESHOLD_EXCEEDED', payload);
    } catch(_) {}
}

function startMemoryMonitor() {
    const update = async () => {
        try {
            if (window.electronAPI && window.electronAPI.getMemoryUsage) {
                const mem = await window.electronAPI.getMemoryUsage();
                updateMemoryStats(mem);
                logMemoryLevelChange(mem);
            }
        } catch (e) {}
    };
    update();
    setInterval(update, 10000);
}

function drawStatsChart() {
    const canvas = document.getElementById('statsTrafficChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#001220';
    ctx.fillRect(0, 0, w, h);

    const maxVal = Math.max(1, ...chartSpeedIn, ...chartSpeedOut);
    const stepX = w / (CHART_POINTS - 1);

    const drawLine = (data, color) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        data.forEach((val, i) => {
            const x = i * stepX;
            const y = h - (val / maxVal) * (h - 8) - 4;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    };

    const fillLine = (data, color) => {
        ctx.beginPath();
        ctx.fillStyle = color;
        data.forEach((val, i) => {
            const x = i * stepX;
            const y = h - (val / maxVal) * (h - 8) - 4;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.lineTo((CHART_POINTS - 1) * stepX, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
    };

    fillLine(chartSpeedIn, 'rgba(79,195,247,0.18)');
    fillLine(chartSpeedOut, 'rgba(102,187,106,0.18)');
    drawLine(chartSpeedIn, '#4fc3f7');
    drawLine(chartSpeedOut, '#66bb6a');

    ctx.fillStyle = 'rgba(79,195,247,0.9)';
    ctx.font = '11px monospace';
    ctx.fillText('RX', 8, 18);
    ctx.fillStyle = 'rgba(102,187,106,0.9)';
    ctx.fillText('TX', 8, 34);
}

async function openStatsModal() {
    adjustWindowPaused = true;
    const modal = document.getElementById('statsModal');
    if (modal) modal.classList.add('show');
    await refreshStatsModal();
}

function closeStatsModal() {
    adjustWindowPaused = false;
    const modal = document.getElementById('statsModal');
    if (modal) modal.classList.remove('show');
}

async function refreshStatsModal() {
    if (window.electronAPI && window.electronAPI.getMemoryUsage) {
        try {
            const mem = await window.electronAPI.getMemoryUsage();
            updateMemoryStats(mem);
        } catch (e) {
            console.warn('Stats modal: erro ao obter memória:', e);
        }
    }

    if (window.electronAPI && window.electronAPI.getConnectionHistory) {
        try {
            const history = await window.electronAPI.getConnectionHistory();
            const list = document.getElementById('statsHistoryList');
            if (list && Array.isArray(history)) {
                if (history.length === 0) {
                    list.innerHTML = '<div style="color:#4a7a9a;padding:12px;text-align:center;">Nenhuma conexão registrada</div>';
                } else {
                    list.innerHTML = history.slice().reverse().map(h => {
                        const start = h.startedAt ? new Date(h.startedAt).toLocaleString('pt-BR') : '--';
                        const dur = h.durationSeconds ? (h.durationSeconds >= 60 ? Math.floor(h.durationSeconds / 60) + 'min' : h.durationSeconds + 's') : '--';
                        const reason = h.disconnectReason === 'manual'
                            ? '<span class="hist-reason-manual">manual</span>'
                            : h.disconnectReason === 'error'
                                ? '<span class="hist-reason-error">erro</span>'
                                : (h.status === 'active' ? '<span style="color:#2196F3">ativa</span>' : '--');
                        return `<div class="hist-item"><span>${h.profileName || 'perfil'}</span><span>${start}</span><span>${dur}</span><span>${reason}</span></div>`;
                    }).join('');
                }
            }
        } catch (e) {
            console.warn('Stats modal: erro ao obter histórico:', e);
        }
    }

    drawStatsChart();
}

if (window.electronAPI && window.electronAPI.onVpnTrafficStats) {
    window.electronAPI.onVpnTrafficStats((data) => {
        updateTrafficStats(data);
    });
}

if (window.electronAPI && window.electronAPI.onVPNConnected) {
    window.electronAPI.onVPNConnected(() => {
        showStatsPanel();
    });
}

if (window.electronAPI && window.electronAPI.onVPNDisconnected) {
    window.electronAPI.onVPNDisconnected(() => {
        hideStatsPanel();
    });
}
