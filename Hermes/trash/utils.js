// utils.js - Common utility functions
export class UIUtils {
    static async setButtonTempText(btn, okText, ms = 2000) {
        if (!btn) return;
        const original = btn.textContent;
        btn.textContent = okText;
        btn.disabled = true;
        await new Promise(resolve => setTimeout(resolve, ms));
        btn.textContent = original;
        btn.disabled = false;
    }

    static async setButtonFailText(btn, failText, ms = 2000) {
        if (!btn) return;
        const original = btn.textContent;
        btn.textContent = failText;
        btn.disabled = false;
        await new Promise(resolve => setTimeout(resolve, ms));
        btn.textContent = original;
    }

    static downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    static openURLNormally(url) {
        const newTab = document.createElement("a");
        newTab.href = url;
        newTab.target = "_blank";
        newTab.rel = "noopener noreferrer";
        document.body.appendChild(newTab);
        newTab.click();
        document.body.removeChild(newTab);
    }

    static async createPopup(title, content, width = 600, height = 400) {
        const popupWindow = window.open("", "_blank", `width=${width},height=${height}`);
        const html = `
            <html>
                <head>
                    <title>${title}</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            padding: 20px;
                            margin: 0;
                            line-height: 1.6;
                        }
                        h1 { color: #0059B3; }
                        pre {
                            background: #f4f4f4;
                            border: 1px solid #ddd;
                            padding: 10px;
                            overflow-x: auto;
                        }
                    </style>
                </head>
                <body>
                    <h1>${title}</h1>
                    ${content}
                </body>
            </html>
        `;
        popupWindow.document.write(html);
        popupWindow.document.close();
        return popupWindow;
    }
}

export class StorageManager {
    static storageKey = "clientdata";

    static async load() {
        return new Promise((resolve) => {
            chrome.storage.local.get([this.storageKey], (result) => {
                resolve(result[this.storageKey] || {});
            });
        });
    }

    static async save(data) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [this.storageKey]: data }, resolve);
        });
    }

    static async append(key, value) {
        const data = await this.load();
        data[key] = value;
        await this.save(data);
    }

    static async remove(key) {
        const data = await this.load();
        delete data[key];
        await this.save(data);
    }
}

export class Logger {
    static async appendLog(message) {
        const timestamp = new Date().toISOString();
        chrome.storage.local.get({ logs: [] }, (result) => {
            const logs = result.logs;
            logs.push(`[${timestamp}] ${message}`);
            chrome.storage.local.set({ logs });
        });
    }

    static error(message, error) {
        console.error(message, error);
        this.appendLog(`ERROR: ${message} - ${error.message}`);
    }

    static info(message) {
        console.log(message);
        this.appendLog(`INFO: ${message}`);
    }
}

export class ApiClient {
    static async request(url, options = {}) {
        try {
            const response = await fetch(url, {
                ...options,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType?.includes('application/json')) {
                return await response.json();
            }
            return await response.text();
        } catch (error) {
            Logger.error('API request failed:', error);
            throw error;
        }
    }
}