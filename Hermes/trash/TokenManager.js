// TokenManager.js - Handle token-related functionality
import { StorageManager, Logger, ApiClient } from './utils.js';

export default class TokenManager {
    static accessTokenTimer = null;
    static refreshTokenTimer = null;

    static async fetchToken(clienturl, clientID) {
        if (!clienturl || !clientID) {
            throw new Error("Missing required parameters for token fetch");
        }

        const tokenurl = `${clienturl}accessToken?clientId=${clientID}`;
        Logger.info(`Requesting token from: ${tokenurl}`);

        try {
            const result = await ApiClient.request(tokenurl);
            await this.processTokenResponse(result, clienturl, clientID, tokenurl);
            return result;
        } catch (error) {
            Logger.error("Token fetch failed:", error);
            throw error;
        }
    }

    static async processTokenResponse(result, clienturl, clientID, tokenurl) {
        const { accessToken, refreshToken, expiresInSeconds } = result;

        if (!accessToken || !refreshToken || !expiresInSeconds) {
            throw new Error("Invalid token response");
        }

        const currentDateTime = new Date();
        const accessTokenExpirationDateTime = new Date(
            currentDateTime.getTime() + expiresInSeconds * 1000
        );
        const refreshTokenExpirationDateTime = new Date(
            currentDateTime.getTime() + 8 * 60 * 60 * 1000
        );

        const baseClientUrl = new URL(tokenurl).origin + "/";
        const tokenData = {
            clientid: clientID,
            tokenurl: tokenurl,
            apiurl: `${baseClientUrl}api`,
            accesstoken: accessToken,
            refreshtoken: refreshToken,
            effectivedatetime: currentDateTime.toISOString(),
            expirationdatetime: accessTokenExpirationDateTime.toISOString(),
            refreshExpirationDateTime: refreshTokenExpirationDateTime.toISOString(),
            editdatetime: currentDateTime.toISOString()
        };

        await StorageManager.append(baseClientUrl, tokenData);
        Logger.info("Token processed and saved successfully");
    }

    static startAccessTokenTimer(seconds, timerBox) {
        this.stopAccessTokenTimer(timerBox);
        let remainingTime = seconds;

        const updateTimer = () => {
            if (remainingTime <= 0) {
                this.stopAccessTokenTimer(timerBox);
                return;
            }

            const minutes = Math.floor(remainingTime / 60);
            const seconds = remainingTime % 60;
            timerBox.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            remainingTime--;

            chrome.storage.local.set({ accessTokenTimer: remainingTime });
        };

        updateTimer();
        this.accessTokenTimer = setInterval(updateTimer, 1000);
    }

    static stopAccessTokenTimer(timerBox) {
        if (this.accessTokenTimer) {
            clearInterval(this.accessTokenTimer);
            this.accessTokenTimer = null;
            timerBox.textContent = "--:--";
            Logger.info("Access Token Timer stopped");
        }
    }

    static startRefreshTokenTimer(seconds, timerBox) {
        this.stopRefreshTokenTimer(timerBox);
        let remainingTime = seconds;

        const updateTimer = () => {
            if (remainingTime <= 0) {
                this.stopRefreshTokenTimer(timerBox);
                return;
            }

            const minutes = Math.floor(remainingTime / 60);
            const seconds = remainingTime % 60;
            timerBox.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            remainingTime--;

            chrome.storage.local.set({ refreshTokenTimer: remainingTime });
        };

        updateTimer();
        this.refreshTokenTimer = setInterval(updateTimer, 1000);
    }

    static stopRefreshTokenTimer(timerBox) {
        if (this.refreshTokenTimer) {
            clearInterval(this.refreshTokenTimer);
            this.refreshTokenTimer = null;
            timerBox.textContent = "--:--";
            Logger.info("Refresh Token Timer stopped");
        }
    }

    // Handler methods
    static async handleGetToken() {
        try {
            const button = document.getElementById("get-token");
            button.disabled = true;
            await this.fetchToken();
            UIUtils.setButtonTempText(button, "Token Retrieved!");
        } catch (error) {
            Logger.error("Get token failed:", error);
            UIUtils.setButtonFailText(button, "Failed!");
        }
    }

    static async handleCopyToken() {
        try {
            const accessTokenBox = document.getElementById("access-token");
            const accessToken = accessTokenBox?.value;

            if (!accessToken || accessToken === "Get Token" || accessToken === "Access Token Expired") {
                throw new Error("No valid Access Token available");
            }

            await navigator.clipboard.writeText(accessToken);
            UIUtils.setButtonTempText(document.getElementById("copy-token"), "Copied!");
        } catch (error) {
            Logger.error("Copy token failed:", error);
            UIUtils.setButtonFailText(document.getElementById("copy-token"), "Failed!");
        }
    }
}