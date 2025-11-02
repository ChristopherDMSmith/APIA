// scripts/bg.js: Background service for Hermes extension UI
import { Logger } from './utils.js';

export default class HermesBackgroundService {
    static HERMES_GLOBAL_OPEN = false;
    static WFM_REGEX = /:\/\/.*\.mykronos\.com\//i;

    static async initialize() {
        try {
            const { hermesGlobalOpen } = await chrome.storage.session.get("hermesGlobalOpen");
            this.HERMES_GLOBAL_OPEN = !!hermesGlobalOpen;
            this.setupEventListeners();
            Logger.info("Background service initialized");
        } catch (error) {
            Logger.error("Background service initialization failed:", error);
        }
    }

    static setupEventListeners() {
        // Toolbar click handler
        chrome.action.onClicked.addListener((tab) => this.handleToolbarClick(tab));

        // Tab event handlers
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => 
            this.handleTabUpdate(tabId, changeInfo, tab));
        chrome.tabs.onRemoved.addListener((tabId) => 
            this.handleTabRemove(tabId));
        chrome.tabs.onActivated.addListener((activeInfo) => 
            this.handleTabActivation(activeInfo));

        // Runtime message handler
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => 
            this.handleMessage(message, sender, sendResponse));
    }

    static isValidWfmSessionUrl(url) {
        if (!url) return false;
        if (!/mykronos\.com/i.test(url)) return false;
        if (/mykronos\.com\/authn\//i.test(url)) return false;
        if (/:\/\/adp-developer\.mykronos\.com\//i.test(url)) return false;
        return true;
    }

    static isWfmUrl(url) {
        return !!url && this.WFM_REGEX.test(url);
    }

    static getOrigin(u) {
        try {
            const url = new URL(u);
            return url.origin;
        } catch {
            return null;
        }
    }

    static async setActiveTabState(tabId, url) {
        try {
            await chrome.storage.session.set({
                hermesActiveTabId: tabId || null,
                hermesActiveTabUrl: url || null,
            });
        } catch (error) {
            Logger.error("Failed to set active tab state:", error);
        }
    }

    static async setLinkedContext(tab) {
        if (!tab?.id || !this.isValidWfmSessionUrl(tab.url)) return;

        const payload = {
            hermesLinkedTabId: tab.id,
            hermesLinkedUrl: tab.url,
            hermesLinkedOrigin: this.getOrigin(tab.url),
            hermesLinkedTitle: tab.title || "",
            hermesLinkedStatus: "ok",
        };
        await chrome.storage.session.set(payload);
        chrome.runtime.sendMessage({ type: 'tabStatus', status: 'active' });
    }

    static async clearLinkedContext(reason = "closed") {
        await chrome.storage.session.set({
            hermesLinkedTabId: null,
            hermesLinkedUrl: null,
            hermesLinkedOrigin: null,
            hermesLinkedTitle: "",
            hermesLinkedStatus: reason,
        });
        chrome.runtime.sendMessage({ type: 'tabStatus', status: 'inactive' });
    }

    static async setSidePanelEnabledForAll(enabled) {
        const tabs = await chrome.tabs.query({});
        await Promise.all(tabs.map(t => 
            chrome.sidePanel.setOptions({ 
                tabId: t.id, 
                path: "hermes.html", 
                enabled 
            }).catch(() => {})
        ));
    }

    static async handleToolbarClick(tab) {
        if (!tab?.id) return;

        if (this.HERMES_GLOBAL_OPEN) {
            await this.setSidePanelEnabledForAll(false);
            this.HERMES_GLOBAL_OPEN = false;
            await chrome.storage.session.set({ hermesGlobalOpen: false });
            return;
        }

        await chrome.sidePanel.setOptions({ 
            tabId: tab.id, 
            path: "hermes.html", 
            enabled: true 
        });
        await chrome.sidePanel.open({ tabId: tab.id });
        await this.setSidePanelEnabledForAll(true);

        this.HERMES_GLOBAL_OPEN = true;
        await chrome.storage.session.set({ hermesGlobalOpen: true });

        if (this.isValidWfmSessionUrl(tab.url)) {
            await this.setLinkedContext(tab);
        } else if (/mykronos\.com\/authn\//i.test(tab?.url || "")) {
            await chrome.storage.session.set({ hermesLinkedStatus: "stale" });
        }

        await this.setActiveTabState(tab?.id || null, tab?.url || null);
    }

    static async handleTabUpdate(tabId, changeInfo, tab) {
        try {
            const { hermesLinkedTabId } = await chrome.storage.session.get("hermesLinkedTabId");
            if (hermesLinkedTabId && tabId === hermesLinkedTabId) {
                if (changeInfo.url) {
                    if (this.isValidWfmSessionUrl(changeInfo.url)) {
                        await this.setLinkedContext({
                            id: tabId,
                            url: changeInfo.url,
                            title: tab?.title,
                        });
                    } else {
                        await chrome.storage.session.set({
                            hermesLinkedStatus: "stale",
                            hermesLinkedUrl: changeInfo.url || null,
                        });
                    }
                }
                if (changeInfo.title) {
                    await chrome.storage.session.set({ hermesLinkedTitle: changeInfo.title });
                }
            }
        } catch (error) {
            Logger.error("Tab update handling failed:", error);
        }
    }

    static async handleTabRemove(tabId) {
        try {
            const { hermesLinkedTabId } = await chrome.storage.session.get("hermesLinkedTabId");
            if (hermesLinkedTabId && tabId === hermesLinkedTabId) {
                await this.clearLinkedContext("closed");
            }
        } catch (error) {
            Logger.error("Tab remove handling failed:", error);
        }
    }

    static async handleTabActivation(activeInfo) {
        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            await this.setActiveTabState(tab?.id || null, tab?.url || null);
        } catch (error) {
            Logger.error("Tab activation handling failed:", error);
        }
    }

    static async handleMessage(message, sender, sendResponse) {
        try {
            switch (message.action) {
                case 'getClientUrl':
                    const { hermesActiveTabUrl } = await chrome.storage.session.get("hermesActiveTabUrl");
                    sendResponse({ url: hermesActiveTabUrl });
                    break;
                case 'relinkCurrentTab':
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab && this.isValidWfmSessionUrl(tab.url)) {
                        await this.setLinkedContext(tab);
                        sendResponse({ success: true });
                    } else {
                        sendResponse({ success: false, error: "Not a valid WFM session" });
                    }
                    break;
                case 'goToLinkedTab':
                    const { hermesLinkedTabId } = await chrome.storage.session.get("hermesLinkedTabId");
                    if (hermesLinkedTabId) {
                        const linkedTab = await chrome.tabs.get(hermesLinkedTabId);
                        await chrome.windows.update(linkedTab.windowId, { focused: true });
                        await chrome.tabs.update(hermesLinkedTabId, { active: true });
                        sendResponse({ success: true });
                    } else {
                        sendResponse({ success: false, error: "No linked tab" });
                    }
                    break;
            }
        } catch (error) {
            Logger.error("Message handling failed:", error);
            sendResponse({ success: false, error: error.message });
        }
        return true; // Keep message channel open for async response
    }
}

// Initialize the background service
HermesBackgroundService.initialize();