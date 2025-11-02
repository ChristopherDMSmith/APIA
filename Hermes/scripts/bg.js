// Background Script (bg.js)
// Last Updated: 2025-11-02 18:45:42 UTC by ChristopherDMSmith

// Debug Configuration
const DEBUG_MODE = {
    enabled: false,      // Master switch for logging
    logLevel: 'INFO'     // Default log level (ERROR, WARN, INFO, DEBUG)
};

// Logger utility
const appLogger = {
    timestamp() {
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
    },

    error(message) {
        if (DEBUG_MODE.enabled) {
            console.error(`[${this.timestamp()}][ERROR] ${message}`);
        }
        this.appendToStorage('ERROR', message);
    },

    warn(message) {
        if (DEBUG_MODE.enabled && ['ERROR', 'WARN'].includes(DEBUG_MODE.logLevel)) {
            console.warn(`[${this.timestamp()}][WARN] ${message}`);
        }
        this.appendToStorage('WARN', message);
    },

    info(message) {
        if (DEBUG_MODE.enabled && ['ERROR', 'WARN', 'INFO'].includes(DEBUG_MODE.logLevel)) {
            console.info(`[${this.timestamp()}][INFO] ${message}`);
        }
        this.appendToStorage('INFO', message);
    },

    debug(message) {
        if (DEBUG_MODE.enabled && DEBUG_MODE.logLevel === 'DEBUG') {
            console.debug(`[${this.timestamp()}][DEBUG] ${message}`);
        }
        this.appendToStorage('DEBUG', message);
    },

    async appendToStorage(level, message) {
        try {
            const logEntry = {
                timestamp: this.timestamp(),
                level,
                message
            };
            
            chrome.storage.local.get({ extension_logs: [] }, (result) => {
                const logs = result.extension_logs;
                logs.push(logEntry);
                if (logs.length > 1000) logs.shift();
                chrome.storage.local.set({ extension_logs: logs });
            });
        } catch (error) {
            console.error('Failed to store log:', error);
        }
    }
};

// Global state
let HERMES_GLOBAL_OPEN = false;

// URL Validation Functions
function getVanityUrl(tabUrl) {
    let url = new URL(tabUrl);
    let hostname = url.hostname;

    if (hostname.includes(".mykronos.com") && !hostname.includes("-nosso")) {
        if (hostname.includes(".prd.mykronos.com")) {
            hostname = hostname.replace(".prd.mykronos.com", "-nosso.prd.mykronos.com");
        } else if (hostname.includes(".npr.mykronos.com")) {
            hostname = hostname.replace(".npr.mykronos.com", "-nosso.npr.mykronos.com");
        }
    }

    return `${url.protocol}//${hostname}/`;
}

function validateWebPage(url) {
    if (!url.includes("mykronos.com")) {
        return { valid: false, message: "Invalid Domain" };
    }

    const invalidPatterns = [
        {
            pattern: "mykronos.com/authn/",
            message: "Invalid Login - Authentication Required"
        },
        {
            pattern: "mykronos.com/wfd/unauthorized",
            message: "Invalid Login - Unauthorized Access"
        },
        {
            pattern: /:\/\/adp-developer\.mykronos\.com\//i,
            message: "Developer Portal not supported for API session"
        }
    ];

    for (const { pattern, message } of invalidPatterns) {
        if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) {
            return { valid: false, message };
        }
    }

    return { valid: true, message: "Valid" };
}

// State Management Functions
async function setLinkedContext(tab) {
    if (!tab?.id) return;
    
    const validation = validateWebPage(tab.url);
    if (!validation.valid) {
        appLogger.debug(`Invalid URL: ${validation.message}`);
        return;
    }

    const timestamp = new Date().toISOString();
    const payload = {
        hermesLinkedTabId: tab.id,
        hermesLinkedWindowId: tab.windowId,
        hermesLinkedUrl: tab.url,
        hermesLinkedOrigin: getVanityUrl(tab.url),
        hermesLinkedTitle: tab.title || '',
        hermesLinkedStatus: 'ok',
        hermesLastValidation: timestamp,
        hermesValidationMessage: validation.message
    };
    
    appLogger.debug('Setting linked context:', payload);
    await chrome.storage.session.set(payload);
}

async function clearLinkedContext(reason = 'closed') {
    const timestamp = new Date().toISOString();
    const payload = {
        hermesLinkedTabId: null,
        hermesLinkedWindowId: null,
        hermesLinkedUrl: null,
        hermesLinkedOrigin: null,
        hermesLinkedTitle: '',
        hermesLinkedStatus: reason,
        hermesLastValidation: timestamp,
        hermesValidationMessage: reason === 'closed' ? 
            'Linked tab was closed' : 
            'Session needs attention'
    };

    appLogger.debug('Clearing linked context:', { reason });
    await chrome.storage.session.set(payload);
}

async function setSidePanelEnabledForAll(enabled) {
    const tabs = await chrome.tabs.query({});
    const ops = tabs.map(t =>
        chrome.sidePanel.setOptions({ 
            tabId: t.id, 
            path: "hermes.html", 
            enabled 
        }).catch(() => {})
    );
    await Promise.all(ops);
}

async function getGlobalOpen() {
    const { hermesGlobalOpen } = await chrome.storage.session.get('hermesGlobalOpen');
    return !!hermesGlobalOpen;
}

async function setGlobalOpen(value) {
    await chrome.storage.session.set({ hermesGlobalOpen: !!value });
}

// Event Handler Functions
async function handleStartup() {
    try {
        const { hermesGlobalOpen } = await chrome.storage.session.get('hermesGlobalOpen');
        HERMES_GLOBAL_OPEN = !!hermesGlobalOpen;
        appLogger.info(`Startup state retrieved: ${HERMES_GLOBAL_OPEN}`);
    } catch (error) {
        appLogger.error(`Startup state retrieval failed: ${error}`);
    }
}

async function handleHermesClose() {
    setSidePanelEnabledForAll(false).catch(e => 
        appLogger.error(`Failed to disable panels: ${e}`)
    );
    HERMES_GLOBAL_OPEN = false;
    chrome.storage.session.set({ hermesGlobalOpen: false }).catch(e => 
        appLogger.error(`Failed to update storage: ${e}`)
    );
}

async function handleHermesOpen(tab) {
    appLogger.info(`Opening Hermes for tab: ${tab.id}`);

    // Enable panel for current tab
    await chrome.sidePanel.setOptions({ 
        tabId: tab.id, 
        path: "hermes.html", 
        enabled: true 
    });

    // Open the panel
    await chrome.sidePanel.open({ tabId: tab.id });

    // Enable for all tabs
    await setSidePanelEnabledForAll(true);

    // Update state
    HERMES_GLOBAL_OPEN = true;
    await setGlobalOpen(true);

    // Handle linking if valid WFM session
    try {
        const validation = validateWebPage(tab.url);
        if (validation.valid) {
            await setLinkedContext(tab);
        } else {
            appLogger.debug(`Not linking tab: ${validation.message}`);
            await chrome.storage.session.set({ 
                hermesLinkedStatus: 'stale',
                hermesValidationMessage: validation.message
            });
        }
    } catch (error) {
        appLogger.error(`Failed to handle session linking: ${error}`);
    }
}

async function handleToolbarClick(tab) {
    if (!tab?.id) {
        appLogger.warn('Invalid tab for toolbar click');
        return;
    }

    if (HERMES_GLOBAL_OPEN) {
        appLogger.info('Closing Hermes globally');
        await handleHermesClose();
        return;
    }

    await handleHermesOpen(tab);
}

async function handleTabUpdate(tabId, changeInfo, tab) {
    try {
        const isOpen = await getGlobalOpen();
        await chrome.sidePanel.setOptions({ 
            tabId, 
            path: "hermes.html", 
            enabled: isOpen 
        });
    } catch (error) {
        appLogger.error(`Failed to update panel state: ${error}`);
    }

    try {
        const { hermesLinkedTabId } = await chrome.storage.session.get('hermesLinkedTabId');
        if (!hermesLinkedTabId || tabId !== hermesLinkedTabId) return;

        if (changeInfo.url) {
            const validation = validateWebPage(changeInfo.url);
            if (validation.valid) {
                await setLinkedContext({ 
                    id: tabId, 
                    windowId: tab.windowId,
                    url: changeInfo.url, 
                    title: tab?.title 
                });
            } else {
                const timestamp = new Date().toISOString();
                await chrome.storage.session.set({ 
                    hermesLinkedStatus: 'stale', 
                    hermesLinkedUrl: changeInfo.url || null,
                    hermesLastValidation: timestamp,
                    hermesValidationMessage: validation.message
                });
            }
        }
        
        if (changeInfo.title) {
            await chrome.storage.session.set({ 
                hermesLinkedTitle: changeInfo.title,
                hermesLastValidation: new Date().toISOString()
            });
        }
    } catch (error) {
        appLogger.error(`Failed to handle tab update: ${error}`);
    }
}

async function handleTabRemoved(tabId) {
    try {
        const { hermesLinkedTabId } = await chrome.storage.session.get('hermesLinkedTabId');
        if (hermesLinkedTabId && tabId === hermesLinkedTabId) {
            appLogger.info(`Linked tab closed: ${tabId}`);
            await clearLinkedContext('closed');
        }
    } catch (error) {
        appLogger.error(`Failed to handle tab removal: ${error}`);
    }
}

// Event Listeners
chrome.runtime.onStartup?.addListener(handleStartup);
chrome.action.onClicked.addListener(handleToolbarClick);
chrome.tabs.onUpdated.addListener(handleTabUpdate);
chrome.tabs.onRemoved.addListener(handleTabRemoved);