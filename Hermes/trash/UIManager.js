// UIManager.js - Handle UI-related functionality
import { UIUtils, Logger } from './utils.js';
import TokenManager from './TokenManager.js';
import ApiLibrary from './ApiLibrary.js';

export default class UIManager {
    static async initialize() {
        try {
            await this.setupTheme();
            await this.setupApiLibrary();
            await this.restoreUIState();
            Logger.info("UI Manager initialized successfully");
        } catch (error) {
            Logger.error("UI Manager initialization failed:", error);
        }
    }

    static async setupTheme() {
        try {
            const themes = await this.loadThemes();
            await this.populateThemeDropdown(themes);
            await this.restoreSelectedTheme();
        } catch (error) {
            Logger.error("Theme setup failed:", error);
        }
    }

    static async loadThemes() {
        try {
            const response = await fetch("themes/themes.json");
            if (!response.ok) {
                throw new Error(`Failed to fetch themes. Status: ${response.status}`);
            }
            const themesData = await response.json();
            return themesData.themes;
        } catch (error) {
            Logger.error("Error loading themes:", error);
            return {};
        }
    }

    static async populateThemeDropdown(themes) {
        const dropdown = document.getElementById("theme-selector");
        if (!dropdown) return;

        Object.entries(themes).forEach(([themeKey, theme]) => {
            const option = document.createElement("option");
            option.value = themeKey;
            option.textContent = theme.name;
            dropdown.appendChild(option);
        });
    }

    static async applyTheme(themeKey) {
        const themes = await this.loadThemes();
        const selectedTheme = themes[themeKey];

        if (!selectedTheme) {
            Logger.error(`Theme "${themeKey}" not found.`);
            return;
        }

        const root = document.documentElement;
        
        // Apply colors
        Object.entries(selectedTheme.colors).forEach(([key, value]) => {
            root.style.setProperty(`--${key}`, value);
        });

        // Apply fonts
        const fonts = selectedTheme.fonts;
        root.style.setProperty("--font-family", fonts["font-family-primary"]);
        root.style.setProperty("--title-font", fonts["title-font-primary"]);

        await chrome.storage.local.set({ selectedTheme: themeKey });
        Logger.info(`Theme "${themeKey}" applied.`);
    }

    static async restoreUIState() {
        await TokenManager.restoreTokenTimers();
        await this.restoreRefreshTokenOptions();
        this.setupResponseSection();
    }

    static setupResponseSection() {
        const responseSection = document.getElementById("response-section");
        if (!responseSection) return;

        responseSection.innerHTML = `
            <button id="popout-response" class="btn3">
                Popout Response 
                <img src="icons/external-link.png" alt="Popout" class="btn-icon">
            </button>
            <pre>Awaiting API Response...</pre>
        `;
    }

    static async toggleRefreshTokenOptions() {
        const toggleButton = document.getElementById("toggle-refresh-token-options");
        const content = document.getElementById("refresh-token-options-content");
        if (!toggleButton || !content) return;

        const isExpanded = content.classList.toggle("expanded");
        toggleButton.textContent = isExpanded ? 
            "▲ Hide Refresh Token Options ▲" : 
            "▼ Show Refresh Token Options ▼";

        await chrome.storage.local.set({ refreshTokenOptionsExpanded: isExpanded });
    }

    static async restoreRefreshTokenOptions() {
        const { refreshTokenOptionsExpanded } = await chrome.storage.local.get("refreshTokenOptionsExpanded");
        const toggleButton = document.getElementById("toggle-refresh-token-options");
        const content = document.getElementById("refresh-token-options-content");
        
        if (toggleButton && content) {
            if (refreshTokenOptionsExpanded) {
                content.classList.add("expanded");
                toggleButton.textContent = "▲ Hide Refresh Token Options ▲";
            } else {
                content.classList.remove("expanded");
                toggleButton.textContent = "▼ Show Refresh Token Options ▼";
            }
        }
    }

    // Add other UI management methods as needed
}