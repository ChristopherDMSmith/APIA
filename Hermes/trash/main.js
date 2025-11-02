// main.js - Main application script
import { Logger } from './utils.js';
import TokenManager from './TokenManager.js';
import ApiLibrary from './ApiLibrary.js';
import UIManager from './UIManager.js';

class HermesApp {
    static async initialize() {
        Logger.info("Initializing Hermes extension in side panel...");
        
        try {
            // Initialize core services
            await this.initializeServices();
            
            // Setup event listeners
            await this.setupEventListeners();
            
            // Initial UI population
            const clientUrl = await this.getClientUrl();
            if (clientUrl) {
                await this.populateInitialData(clientUrl);
            }

            // Setup side panel specific features
            this.setupSidePanelFeatures();

        } catch (error) {
            Logger.error("Initialization failed:", error);
        }
    }

    static async initializeServices() {
        await UIManager.initialize();
        await ApiLibrary.populateDropdown();
        await TokenManager.restoreTokenState();
    }

    static setupSidePanelFeatures() {
        // Handle inactive overlay
        const overlay = document.getElementById('inactive-overlay');
        if (overlay) {
            document.getElementById('overlay-goto')?.addEventListener('click', () => {
                chrome.runtime.sendMessage({ action: 'goToLinkedTab' });
            });
            document.getElementById('overlay-relink')?.addEventListener('click', () => {
                chrome.runtime.sendMessage({ action: 'relinkCurrentTab' });
            });
        }

        // Listen for tab status updates from background script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'tabStatus') {
                this.updateSidePanelStatus(message.status);
            }
        });
    }

    static setupEventListeners() {
        // Add all your event listeners here
        this.setupAdminMenuListeners();
        this.setupTokenManagementListeners();
        this.setupApiLibraryListeners();
        this.setupThemeListeners();
        this.setupHelpListeners();
    }

    static setupAdminMenuListeners() {
        document.getElementById("clear-all-data")?.addEventListener("click", () => this.handleClearAllData());
        document.getElementById("clear-client-data")?.addEventListener("click", () => this.handleClearClientData());
        document.getElementById("view-client-data")?.addEventListener("click", () => this.handleViewClientData());
        document.getElementById("export-csv")?.addEventListener("click", () => this.handleExportCSV());
        document.getElementById("export-json")?.addEventListener("click", () => this.handleExportJSON());
        document.getElementById("import-data")?.addEventListener("click", () => this.handleImportData());
    }

    static setupTokenManagementListeners() {
        document.getElementById("get-token")?.addEventListener("click", () => TokenManager.handleGetToken());
        document.getElementById("copy-token")?.addEventListener("click", () => TokenManager.handleCopyToken());
        document.getElementById("refresh-access-token")?.addEventListener("click", () => TokenManager.handleRefreshToken());
    }

    static setupApiLibraryListeners() {
        document.getElementById("api-selector")?.addEventListener("change", (e) => 
            ApiLibrary.handleApiSelection(e.target.value));
        document.getElementById("execute-api")?.addEventListener("click", () => 
            ApiLibrary.handleApiExecution());
    }

    static setupThemeListeners() {
        document.getElementById("theme-selector")?.addEventListener("change", (e) => 
            UIManager.handleThemeChange(e.target.value));
    }

    static setupHelpListeners() {
        // Add help menu listeners
    }

    static async getClientUrl() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getClientUrl' }, (response) => {
                resolve(response?.url || null);
            });
        });
    }

    static async populateInitialData(clientUrl) {
        await UIManager.populateClientUrlField(clientUrl);
        await UIManager.populateClientID(clientUrl);
        await UIManager.populateAccessToken(clientUrl);
        await UIManager.populateClientSecret(clientUrl);
        await UIManager.populateRefreshToken(clientUrl);
    }

    // Add other app-level methods as needed
}

// Initialize the application when DOM is loaded
document.addEventListener("DOMContentLoaded", () => HermesApp.initialize());

export default HermesApp;