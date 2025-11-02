// main.js: Core functionality for Hermes extension UI

const LOGGING_ENABLED = false;
const storageKey = "clientdata";
let accessTokenTimerInterval = null;
let refreshTokenTimerInterval = null;
let lastRequestDetails = null;


// ===== UTILITIES ===== //
// Logging Control
const DEBUG_MODE = {
    enabled: false,      // Master switch for logging
    logLevel: 'INFO'     // Default log level (ERROR, WARN, INFO, DEBUG)
};

// Logger utility
// Usage: appLogger.info(); appLogger.error(); appLogger.warn(); appLogger.debug(); appLogger.timestamp;
const appLogger = {
    timestamp() {
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
    },

    error(message) {
        if (DEBUG_MODE.enabled) {
            console.error(`[${this.timestamp()}][ERROR] ${message}`);
        }
        // Always log errors to storage regardless of debug mode
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

    // Store logs in chrome.storage for later retrieval
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
                // Keep only last 1000 logs
                if (logs.length > 1000) logs.shift();
                chrome.storage.local.set({ extension_logs: logs });
            });
        } catch (error) {
            console.error('Failed to store log:', error);
        }
    }
};

// Download Utility for Export Functions
function downloadFile(filename, content, mimeType) {
	const blob = new Blob([content], {
		type: mimeType
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}



// ===== MENU BAR | ADMIN FUNCTIONS ===== //
// Clear All Data
async function clearAllData() {
    if (!confirm("Are you sure you want to clear ALL stored client data?")) return;

    await new Promise((resolve) => {
        chrome.storage.local.remove(storageKey, () => {
            appLogger.info("All client data cleared.");
            resolve();
        });
    });

    // stop timers and reset UI
    const accessTokenTimerBox = document.getElementById("timer");
    const refreshTokenTimerBox = document.getElementById("refresh-timer");
    stopAccessTokenTimer(accessTokenTimerBox);
    stopRefreshTokenTimer(refreshTokenTimerBox);

    await populateClientID();
    await populateAccessToken();
	await populateClientSecret();
    await populateRefreshToken();
    await restoreTokenTimers();
}

// Clear Client Data
async function clearClientData() {
    const clienturl = await getClientUrl();
    if (!clienturl) {
        alert("No valid client environment detected.");
        return;
    }

    if (!confirm(`Are you sure you want to clear data for: ${clienturl}?`)) return;

    const data = await loadClientData();
    if (data[clienturl]) {
        delete data[clienturl];
        await saveClientData(data);
        appLogger.info(`Data cleared for ${clienturl}`);
        alert(`Client data cleared for: ${clienturl}`);

        // Stop timers and reset UI
        const accessTokenTimerBox = document.getElementById("timer");
        const refreshTokenTimerBox = document.getElementById("refresh-timer");
        stopAccessTokenTimer(accessTokenTimerBox);
        stopRefreshTokenTimer(refreshTokenTimerBox);

        await populateClientID();
        await populateAccessToken();
		await populateClientSecret();
        await populateRefreshToken();
        await restoreTokenTimers();
    } else {
        alert("No data found for this client environment.");
    }
}

// View Client Data
async function viewClientData() {
    appLogger.info("View Client Data clicked.");

    // get the client URL
    const clienturl = await getClientUrl();
    if (!clienturl) {
        alert("No valid client URL detected.");
        return;
    }

    // load data from local storage
    const data = await loadClientData();
    const clientData = data[clienturl];

    if (!clientData) {
        alert("No data exists for the current client.");
        return;
    }

    // format client data for display
    const formattedData = JSON.stringify(clientData, null, 2);

    // open a new popup window to display the client data
    const popupWindow = window.open(
        "",
        "_blank",
        "width=850,height=350,scrollbars=yes,resizable=yes"
    );
    if (popupWindow) {
        popupWindow.document.write(`
            <html>
                <head>
                    <title>Client Data</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            margin: 10px;
                        }
                        pre {
                            white-space: pre-wrap;
                            word-wrap: break-word;
                            background-color: #f4f4f4;
                            padding: 10px;
                            border: 1px solid #ddd;
                            border-radius: 5px;
							font-size: 1.2em;
                        }
                    </style>
                </head>
                <body>
                    <h2>Client Data for ${clienturl}</h2>
                    <pre>${formattedData}</pre>
                    <button onclick="window.close()">Close</button>
                </body>
            </html>
        `);
    } else {
        alert("Unable to open the popup window. Please check your browser settings.");
    }
}

// Export CSV
async function exportCSV() {
    const data = await loadClientData();
    if (!Object.keys(data).length) {
        alert("No client data available to export.");
        return;
    }

    let csvContent = "Client URL,Client ID,Client Secret,Token URL,API URL,Effective Date,Expiration Date,Edit Date\n";

    for (const [url, details] of Object.entries(data)) {
        csvContent += `"${url}","${details.clientid || ""}","${details.clientsecret || ""}","${details.tokenurl || ""}","${details.apiurl || ""}","${details.effectivedatetime || ""}","${details.expirationdatetime || ""}","${details.editdatetime || ""}"\n`;
    }

    const fileName = `hermes-clientdata-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadFile(fileName, csvContent, "text/csv");

    appLogger.info("Client data exported as CSV.");

    alert(` CSV exported successfully!\nCheck your downloads folder for:\n ${fileName}`);
}

// Export JSON
async function exportJSON() {
    const data = await loadClientData();
    if (!Object.keys(data).length) {
        alert("No client data available to export.");
        return;
    }

    const sanitizedData = JSON.parse(JSON.stringify(data, (key, value) => {
        return (key === "accesstoken" || key === "refreshtoken") ? undefined : value;
    }));

    const fileName = `hermes-clientdata-${new Date().toISOString().slice(0, 10)}.json`;
    downloadFile(fileName, JSON.stringify(sanitizedData, null, 2), "application/json");

    appLogger.info("Client data exported as JSON.");

    alert(`JSON exported successfully!\nCheck your downloads folder for:\n${fileName}`);
}

// Import Data
async function importData() {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = ".csv,.json";
	input.addEventListener("change", async (event) => {
		const file = event.target.files[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = async (e) => {
			const content = e.target.result;
			const data = await loadClientData();

			try {
				if (file.name.endsWith(".json")) {
					const importedData = JSON.parse(content);
					for (const [url, details] of Object.entries(importedData)) {
						data[url] = {
							clientid: details.clientid || "",
							clientsecret: details.clientsecret || "",
							tokenurl: details.tokenurl || "",
							apiurl: details.apiurl || "",
							accesstoken: null, // clear sensitive fields
							refreshtoken: null, // clear sensitive fields
							editdatetime: new Date().toISOString()
						};
					}
				} else if (file.name.endsWith(".csv")) {
					const rows = content.split("\n").slice(1); // skip header
					for (const row of rows) {
						const [url, clientid, clientsecret, tokenurl, apiurl] = row.split(",").map((field) => field.replace(/"/g, "").trim());
						if (url) {
							data[url] = {
								clientid: clientid || "",
								clientsecret: clientsecret || "",
								tokenurl: tokenurl || "",
								apiurl: apiurl || "",
								accesstoken: null, // clear sensitive fields
								refreshtoken: null, // clear sensitive fields
								editdatetime: new Date().toISOString()
							};
						}
					}
				} else {
					throw new Error("Unsupported file format.");
				}

				await saveClientData(data);
				alert("Data imported successfully.");
				appLogger.info("Client data imported.");


				// refresh the UI
				await populateClientID();
				await populateAccessToken();
				await populateClientSecret();
				await populateRefreshToken();
				await restoreTokenTimers();
			} catch (error) {
				appLogger.error("Import failed:", error);
				alert("Failed to import data. Ensure the file is in the correct format.");
			}
		};
		reader.readAsText(file);
	});

	input.click();
}



// ===== MENU BAR | LINKS FUNCTIONS ===== //
// Boomi
async function linksBoomi() {
  if (!(await isValidSession())) {
    alert("Requires a valid ADP WorkForce Manager session.");
    return;
  }

  const clienturl = await getClientUrl();
  if (!clienturl) {
    appLogger.info("Client URL not found.");
    return;
  }

  const ssoClientUrl = createSsoUrl(clienturl);
  const boomiURL = `${ssoClientUrl}ihub#/integrationTemplatesDesigner?ctxt=designIntegrationTemplates&pageId=58`;
  appLogger.info("Opening Boomi URL:", boomiURL);

  // detect if in incognito mode
  chrome.windows.getCurrent({ populate: false }, (window) => {
    if (chrome.runtime.lastError) {
      appLogger.error(
        "Error detecting incognito mode:",
        chrome.runtime.lastError,
      );
      openURLNormally(boomiURL); // fallback
      return;
    }

    if (window.incognito) {
      appLogger.info("Opening in the same incognito session...");
      chrome.tabs.create({ url: boomiURL, active: true });
    } else {
      appLogger.info("Opening in a normal window...");
      openURLNormally(boomiURL);
    }
  });
}

// Install Integrations
async function linksInstallIntegrations() {
  if (!(await isValidSession())) {
    alert("Requires a valid ADP Workforce Manager session.");
    return;
  }

  const clienturl = await getClientUrl();
  if (!clienturl) {
    appLogger.info("Client URL not found.");
    return;
  }

  const ssoClientUrl = createSsoUrl(clienturl);
  const installIntegrationsURL = `${ssoClientUrl}metaui#/list/integration/?ctxt=configureIntegrations&pageId=57`;

  // detect if in incognito mode
  chrome.windows.getCurrent({ populate: false }, (window) => {
    if (chrome.runtime.lastError) {
      appLogger.error(
        "Error detecting incognito mode:",
        chrome.runtime.lastError,
      );
      openURLNormally(installIntegrationsURL); // fallback
      return;
    }

    if (window.incognito) {
      appLogger.info("Opening in the same incognito session...");
      chrome.tabs.create({ url: installIntegrationsURL, active: true });
    } else {
      appLogger.info("Opening in a normal window...");
      openURLNormally(installIntegrationsURL);
    }
  });
}

// Developer Portal
async function linksDeveloperPortal() {
  try {
    const hermesData = await fetch("hermes.json").then((res) => res.json());
    const developerPortalURL = hermesData.details.urls.developerPortal;

    if (!developerPortalURL) {
      appLogger.error("Developer Portal URL not found in hermes.json.");
      return;
    }

    // store a reference to the global window object
    const globalWindow = window;

    // detect if in incognito mode
    chrome.windows.getCurrent({ populate: false }, (win) => {
      if (win.incognito) {
        appLogger.info("Opening in the same incognito session...");
        chrome.tabs.create({ url: developerPortalURL, active: true });
      } else {
        appLogger.info("Opening in a normal window...");
        globalWindow.open(developerPortalURL, "_blank");
      }
    });
  } catch (error) {
    appLogger.error("Failed to load Developer Portal URL:", error);
  }
}



// ===== MENU BAR | THEMES FUNCTIONS ===== //
// Load Themes From themes.json
async function loadThemes() {
  try {
    const response = await fetch("themes/themes.json");
    if (!response.ok)
      throw new Error(
        `Failed to fetch themes. HTTP status: ${response.status}`,
      );
    const themesData = await response.json();
    appLogger.info("Themes loaded:", themesData);
    return themesData.themes;
  } catch (error) {
    appLogger.error("Error loading themes:", error);
    return {};
  }
}

// Populate Themes Dropdown
async function populateThemeDropdown() {
  const themes = await loadThemes();
  const dropdown = document.getElementById("theme-selector");
  if (!dropdown) {
    appLogger.error("Theme dropdown element not found in DOM.");
    return;
  }

  for (const themeKey in themes) {
    const theme = themes[themeKey];
    const option = document.createElement("option");
    option.value = themeKey;
    option.textContent = theme.name;
    dropdown.appendChild(option);
  }
}

// Apply the Selected Theme
async function applyTheme(themeKey) {
  const themes = await loadThemes();
  const selectedTheme = themes[themeKey];

  if (!selectedTheme) {
    appLogger.warn(`Theme "${themeKey}" not found.`);
    return;
  }

  const root = document.documentElement;
  const colors = selectedTheme.colors;

  // update color variables
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--${key}`, value);
  }

  // update font variables
  const fonts = selectedTheme.fonts;
  root.style.setProperty("--font-family", fonts["font-family-primary"]);
  root.style.setProperty("--title-font", fonts["title-font-primary"]);

  // save the selected theme in local storage
  chrome.storage.local.set({ selectedTheme: themeKey });
  appLogger.info(`Theme "${themeKey}" applied.`);
}

// Theme Selection
function themeSelection(event) {
  const selectedTheme = event.target.value;
  applyTheme(selectedTheme);
}

// Restore the Last Selected Theme On Load
async function restoreSelectedTheme() {
  chrome.storage.local.get("selectedTheme", async (result) => {
    const themeKey = result.selectedTheme || "hermes"; // Default theme
    await applyTheme(themeKey);

    const dropdown = document.getElementById("theme-selector");
    if (dropdown) dropdown.value = themeKey;
  });
}



// ===== MENU BAR | HELP FUNCTIONS ===== //
// About
async function helpAbout() {
  try {
    const hermesData = await fetch("hermes.json").then((res) => res.json());
    const aboutMessage = `
            Name: ${hermesData.name}
            Description: ${hermesData.details.description}
            Version: ${hermesData.details.version}
            Release Date: ${hermesData.details.release_date}
            Author: ${hermesData.details.author}`;

    // clean up the message to remove tabs
    const cleansedAboutMessage = aboutMessage.replace(/\t/g, "");
    alert(cleansedAboutMessage);
  } catch (error) {
    appLogger.error("Failed to load About information:", error);
  }
}

// Support
async function helpSupport() {
    try {
        const hermesData = await fetch("hermes.json").then((res) => res.json());
        const contactEmail = hermesData.details.contact;

        const userConfirmed = confirm("Would you like to open a support ticket?");
        if (!userConfirmed) return;

        const mailtoLink = `mailto:${contactEmail}?subject=Hermes: Support Ticket Request&body=Please describe the support request here.`;
        window.location.href = mailtoLink;
		appLogger.info("Support mail opened");
    } catch (error) {
        appLogger.error("Failed to load support contact information:", error);
    }
}



// ===== LOCAL STORAGE FUNCTIONS ===== //
// Load Client Data From Local Storage
async function loadClientData() {
	return new Promise((resolve) => {
		chrome.storage.local.get([storageKey], (result) => {
			resolve(result[storageKey] || {});
		});
	});
}

// Save Client data To Local Storage
async function saveClientData(data) {
	return new Promise((resolve) => {
		chrome.storage.local.set({
			[storageKey]: data
		}, () => resolve());
	});
}



// ===== MAIN UI HELPERS ===== //
// Button Success Text Temporary
function setButtonTempText(btn, okText, ms = 2000, originalText = btn.textContent) {
    if (!btn) return;
    btn.textContent = okText;
    btn.disabled = true;
    setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
    }, ms);
}

// Button Fail Text Temporary
function setButtonFailText(btn, failText, ms = 2000, originalText = btn.textContent) {
    if (!btn) return;
    btn.textContent = failText;
    btn.disabled = false;
    setTimeout(() => {
        btn.textContent = originalText;
    }, ms);
}

// Button Hourglass Animation
function startLoadingAnimation(button) {
    const hourglassFrames = ["⏳", "⌛"];
    let frameIndex = 0;
    let rotationAngle = 0;

    // Store original text for later restoration
    const originalText = button.textContent;

    button.innerHTML = `Waiting... <span class="hourglass">${hourglassFrames[frameIndex]}</span>`;
    button.disabled = true;
    
    const hourglassSpan = button.querySelector(".hourglass");
    hourglassSpan.style.display = "inline-block";

    return {
        interval: setInterval(() => {
            frameIndex = (frameIndex + 1) % hourglassFrames.length;
            rotationAngle += 30;
            hourglassSpan.textContent = hourglassFrames[frameIndex];
            hourglassSpan.style.transform = `rotate(${rotationAngle}deg)`;
        }, 100),
        originalText // return this sto be used later
    };
}

// Restore Token Timers
async function restoreTokenTimers() {
    appLogger.info("Restoring token timers...");

    const clienturl = await getClientUrl();
    if (!clienturl) {
        appLogger.info("No valid client environment detected. Resetting all timers.");
        const accessTokenTimerBox = document.getElementById("timer");
        const refreshTokenTimerBox = document.getElementById("refresh-timer");

        // reset timers in the UI
        stopAccessTokenTimer(accessTokenTimerBox);
        stopRefreshTokenTimer(refreshTokenTimerBox);
        return;
    }

    const data = await loadClientData();
    const clientData = data[clienturl] || {};
    const currentDateTime = new Date();

    // restore access token timer
    const accessTokenTimerBox = document.getElementById("timer");
    if (clientData.accesstoken) {
        const expirationTime = new Date(clientData.expirationdatetime);
        if (currentDateTime < expirationTime) {
            const remainingSeconds = Math.floor((expirationTime - currentDateTime) / 1000);
            startAccessTokenTimer(remainingSeconds, accessTokenTimerBox);
        } else {
            appLogger.info("Access token expired; resetting timer.");
            accessTokenTimerBox.textContent = "--:--";
        }
    } else {
        accessTokenTimerBox.textContent = "--:--";
    }

    // restore refresh token timer
    const refreshTokenTimerBox = document.getElementById("refresh-timer");
    if (clientData.refreshtoken) {
        const refreshExpirationTime = new Date(clientData.refreshExpirationDateTime);
        if (currentDateTime < refreshExpirationTime) {
            const remainingSeconds = Math.floor((refreshExpirationTime - currentDateTime) / 1000);
            startRefreshTokenTimer(remainingSeconds, refreshTokenTimerBox);
        } else {
            appLogger.info("Refresh token expired; resetting timer.");
            refreshTokenTimerBox.textContent = "--:--";
        }
    } else {
        refreshTokenTimerBox.textContent = "--:--";
    }
} 



// ===== CLIENT URL/ID FIELDS AND BUTTONS ===== //
// Populate the API Access Client URL Field
async function populateClientUrlField() {
  try {
    const input = document.getElementById("client-url");
    if (!input) return;

    const base = await getClientUrl();
    input.value = base ? toApiUrl(base) : "";
  } catch (e) {
    appLogger.error("populateClientUrlField failed:", e);
  }
}

// Refresh URL Button
async function refreshClientUrlClick() {
  const btn = document.getElementById("refresh-client-url");
  try {
    await populateClientUrlField();
    const val = (document.getElementById("client-url") || {}).value || "";
    if (val) {
      setButtonTempText(btn, "URL Refreshed");
    } else {
      setButtonFailText(btn, "No URL Detected");
    }
  } catch (e) {
    appLogger.error(e);
    setButtonFailText(btn, "Refresh Failed");
  }
}

// Copy URL Button
async function copyClientUrlClick() {
  const btn = document.getElementById("copy-client-url");
  try {
    const val = (document.getElementById("client-url") || {}).value || "";
    if (!val) {
      setButtonFailText(btn, "No URL to Copy");
      return;
    }

    // use clipboard API; fallback if needed
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(val);
    } else {
      // fallback approach
      const ta = document.createElement("textarea");
      ta.value = val;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }

    setButtonTempText(btn, "URL Copied");
  } catch (e) {
    appLogger.error("Copy failed:", e);
    setButtonFailText(btn, "Copy Failed");
  }
}

// Populate Client ID Field
async function populateClientID() {
	const clienturl = await getClientUrl();
	const clientIDBox = document.getElementById("client-id");
	appLogger.info("Populating Client ID");

	if (!clienturl) {
		appLogger.info("Client URL not detected.");
		clientIDBox.value = "";
		clientIDBox.placeholder = "Requires WFMgr Login";
		clientIDBox.readOnly = true;
		return;
	}

	const data = await loadClientData();
	if (data[clienturl]?.clientid) {
		clientIDBox.value = data[clienturl].clientid;
		clientIDBox.placeholder = "";
	} else {
		clientIDBox.value = "";
		clientIDBox.placeholder = "Enter Client ID";
	}
}

// Save Client ID Button
async function saveClientIDClick() {
    const button = document.getElementById("save-client-id");
    
    try {
        appLogger.info("Save Client ID button clicked.");

        if (!(await isValidSession())) {
            alert("Requires a valid ADP Workforce Manager session.");
            return;
        }

        const clienturl = await getClientUrl();
        if (!clienturl) {
            appLogger.info("No client URL detected.");
            return;
        }

        const clientid = document.getElementById("client-id").value.trim();
        if (!clientid) {
            alert("Client ID cannot be empty!");
            return;
        }

        const data = await loadClientData();
        data[clienturl] = {
            ...(data[clienturl] || {}),
            clientid: clientid,
            tokenurl: `${clienturl}accessToken?clientId=${clientid}`,
            apiurl: `${clienturl}api`,
            editdatetime: new Date().toISOString(),
        };

        await saveClientData(data);
        appLogger.info("Client ID saved:", clientid);

        // Use helper function for success case
        setButtonTempText(button, "Client ID Saved!");
    } catch (error) {
        // Use helper function for failure case
        appLogger.error("Failed to save Client ID:", error);
        setButtonFailText(button, "Save Failed!");
    }
}



// ===== ACCESS TOKEN UI FIELDS AND BUTTONS ===== //
// Populate Access Token Field and Start Timer if Token is Valid
async function populateAccessToken() {
	appLogger.info("Populating Access Token...");
	const clienturl = await getClientUrl();
	const accessTokenBox = document.getElementById("access-token");
	const timerBox = document.getElementById("timer");

	if (!clienturl) {
		appLogger.info("Client URL not found.");
		accessTokenBox.value = "Requires WFMgr Login";
		timerBox.textContent = "--:--";
		return;
	}

	const data = await loadClientData();
	const currentDateTime = new Date();

	if (data[clienturl]?.accesstoken) {
		const expirationTime = new Date(data[clienturl].expirationdatetime);

		if (currentDateTime > expirationTime) {
			appLogger.info("Access token has expired.");
			accessTokenBox.value = "Access Token Expired";
			timerBox.textContent = "--:--";
		} else {
			appLogger.info("Access token is valid.");
			accessTokenBox.value = data[clienturl].accesstoken;

			// calculate remaining time and start the timer
			const remainingSeconds = Math.floor((expirationTime - currentDateTime) / 1000);
			appLogger.info(`Timer will start with ${remainingSeconds} seconds remaining.`);
			startAccessTokenTimer(remainingSeconds, timerBox);
		}
	} else {
		appLogger.info("No access token found.");
		accessTokenBox.value = "Get Token";
		timerBox.textContent = "--:--";
	}
}

// Get Access Token Button
async function fetchToken() {
    appLogger.info("Fetching token...");
    const clienturl = await getClientUrl();
    if (!clienturl || !(await isValidSession())) {
        alert("Requires a valid ADP Workforce Manager session.");
        return;
    }

    const clientID = document.getElementById("client-id").value.trim();
    if (!clientID) {
        alert("Please enter a Client ID first.");
        return;
    }

    const tokenurl = `${clienturl}accessToken?clientId=${clientID}`;
    appLogger.info(`Requesting token from: ${tokenurl}`);

    // Check if the current window is incognito
    chrome.windows.getCurrent({ populate: false }, async (window) => {
        if (window.incognito) {
            appLogger.info("Running in incognito mode. Using tab-based token retrieval...");
            retrieveTokenViaNewTab(tokenurl);
        } else {
            appLogger.info("Running in normal mode. Using fetch...");
            fetchTokenDirectly(tokenurl, clienturl, clientID);
        }
    });
}

// Get Access Token Normal Mode (used by fetchToken())
async function fetchTokenDirectly(tokenurl, clienturl, clientID) {
    try {
        const response = await fetch(tokenurl, {
            method: "GET",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch token. HTTP status: ${response.status}`);
        }

        const result = await response.json();
        appLogger.info("Token response:", result);

        processTokenResponse(result, clienturl, clientID, tokenurl);
    } catch (error) {
        appLogger.error("Error fetching token:", error.message);
        alert(`Failed to fetch token: ${error.message}`);
    }
}

// Get Access Token Incognito Mode (used by fetchToken())
async function retrieveTokenViaNewTab(tokenurl) {
    chrome.tabs.create({ url: tokenurl, active: false }, async (tab) => {
        setTimeout(() => {
            chrome.scripting.executeScript(
                {
                    target: { tabId: tab.id },
                    function: scrapeTokenFromPage,
                },
                async (injectionResults) => {
                    if (chrome.runtime.lastError) {
                        appLogger.info("Script injection failed:", chrome.runtime.lastError);
                    } else {
                        appLogger.info("Script executed, processing token...");

                        if (injectionResults && injectionResults[0].result) {
                            appLogger.info("Scraped token:", injectionResults[0].result);

                            // retrieve the existing client ID from storage
                            const baseClientUrl = new URL(tokenurl).origin + "/";
                            const storedData = await loadClientData();
                            const existingClientID = storedData[baseClientUrl]?.clientid || "unknown-client";

                            appLogger.info("Using clientid:", existingClientID);

                            // pass the correct client ID instead of "incognito-client"
                            processTokenResponse(
                                injectionResults[0].result,
                                baseClientUrl,
                                existingClientID,
                                tokenurl
                            );
                        } else {
                            appLogger.error("No token found on the page.");
                            alert("Failed to retrieve token from the page.");
                        }
                    }

                    // close the tab
                    chrome.tabs.remove(tab.id, () => {
                        if (chrome.runtime.lastError) {
                            console.log("Error closing tab:", chrome.runtime.lastError);
                        } else {
                            console.log("Tab closed successfully.");
                        }
                    });
                }
            );
        }, 1500); // wait for 1.5 seconds to let the page load
    });
}

// Scrape Token From Browser Tab (used by retrieveTokenViaNewTab())
function scrapeTokenFromPage() {
    try {
        const preElement = document.querySelector("pre"); // assuming the token is inside a <pre> tag
        if (!preElement) return null;

        const jsonText = preElement.innerText;
        return JSON.parse(jsonText);
    } catch (error) {
        appLogger.info("Error parsing token:", error);
        return null;
    }
}

// Process Token (used by fetchTokenDirectly() and retrieveTokenViaNewTab())
async function processTokenResponse(result, tokenurl, clientID) {
    const button = document.getElementById("get-token");

    try {
        const { accessToken, refreshToken, expiresInSeconds } = result;

        if (!accessToken || !refreshToken || !expiresInSeconds) {
            appLogger.info("Token response is missing required fields.");
            alert("Failed to fetch token: Invalid response.");
            setButtonFailText(button, "Token Failed!");
            return;
        }

        const currentDateTime = new Date();
        const accessTokenExpirationDateTime = new Date(currentDateTime.getTime() + expiresInSeconds * 1000);
        const refreshTokenExpirationDateTime = new Date(currentDateTime.getTime() + 8 * 60 * 60 * 1000); // 8 hours

        // extract the BASE URL instead of storing under the full token URL
        const baseClientUrl = new URL(tokenurl).origin + "/";

        const data = await loadClientData();
        data[baseClientUrl] = {
            ...(data[baseClientUrl] || {}),
            clientid: clientID,
            tokenurl: tokenurl,
            apiurl: data[baseClientUrl]?.apiurl || `${baseClientUrl}api`,
            accesstoken: accessToken,
            refreshtoken: refreshToken,
            effectivedatetime: currentDateTime.toISOString(),
            expirationdatetime: accessTokenExpirationDateTime.toISOString(),
            refreshExpirationDateTime: refreshTokenExpirationDateTime.toISOString(),
            editdatetime: currentDateTime.toISOString(),
        };

        appLogger.info("Updating local storage under key:", baseClientUrl, data[baseClientUrl]);

        await saveClientData(data);

        // verify data was stored correctly
        chrome.storage.local.get([storageKey], (result) => {
            appLogger.info("Local storage after update:", result);
        });

        appLogger.info("Token fetched and saved successfully.");
        populateAccessToken();
        populateRefreshToken();
        restoreTokenTimers();

        // Use helper function for success case
        setButtonTempText(button, "Token Retrieved!");

    } catch (error) {
        // Use helper function for failure case
        appLogger.error("Failed to process token response:", error);
        setButtonFailText(button, "Token Failed!");
    }
}

// Start Timer for Access Token
function startAccessTokenTimer(seconds, timerBox) {
	if (accessTokenTimerInterval) {
		clearInterval(accessTokenTimerInterval);
		accessTokenTimerInterval = null;
	}

	let remainingTime = seconds;

	const updateTimer = () => {
		if (remainingTime <= 0) {
			clearInterval(accessTokenTimerInterval);
			accessTokenTimerInterval = null;
			timerBox.textContent = "--:--";
			appLogger.info("Access Token Timer expired.");

			// clear the remaining time in storage
			chrome.storage.local.remove("accessTokenTimer");
		} else {
			const minutes = Math.floor(remainingTime / 60);
			const seconds = remainingTime % 60;
			timerBox.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
			remainingTime--;

			// save the remaining time to storage
			chrome.storage.local.set({
				accessTokenTimer: remainingTime
			});
		}
	};

	// update the timer immediately and then every second
	updateTimer();
	accessTokenTimerInterval = setInterval(updateTimer, 1000);
}

// Stop Access Token Timer
function stopAccessTokenTimer(timerBox) {
	if (accessTokenTimerInterval) {
		clearInterval(accessTokenTimerInterval);
		accessTokenTimerInterval = null;
		timerBox.textContent = "--:--"; // Reset the timer box
		appLogger.info("Access Token Timer stopped");
	}

	// Clear timer from storage
	//chrome.storage.local.remove("accessTokenTimer");
}

// Copy Access Token Button
function copyAccessToken() {
    const accessTokenBox = document.getElementById("access-token");
    const accessToken = accessTokenBox?.value;

    // Validate Access Token before copying
    if (!accessToken || accessToken === "Get Token" || accessToken === "Access Token Expired") {
        appLogger.info("No valid Access Token available to copy.");
        return;
    }

    // Copy token to clipboard
    navigator.clipboard.writeText(accessToken)
        .then(() => {
            // Visual feedback: Change button text
            const button = document.getElementById("copy-token");
            const originalText = button.textContent;

            button.textContent = "Copied!";
            button.disabled = true; // Disable temporarily

            setTimeout(() => {
                button.textContent = originalText;
                button.disabled = false; // Re-enable
            }, 2000);
        })
        .catch((error) => {
            appLogger.error("Failed to copy Access Token:", error);
        });
}


// ===== REFRESH TOKEN UI FIELDS AND BUTTONS ===== //
// Toggle Refresh Token Options Visibility
function toggleRefreshTokenOptions() {
    const toggleButton = document.getElementById("toggle-refresh-token-options");
    const content = document.getElementById("refresh-token-options-content");
    const wrapper = content.parentElement;

    // toggle expanded/collapsed state
    const isExpanded = content.classList.toggle("expanded");

    // dynamically calculate the height
    if (isExpanded) {
        wrapper.style.height = `${content.scrollHeight + toggleButton.offsetHeight}px`; // Expand wrapper height
        toggleButton.textContent = "▲ Hide Refresh Token Options ▲";
    } else {
        wrapper.style.height = `${toggleButton.offsetHeight + 15}px`; // Shrink wrapper height (15px padding)
        toggleButton.textContent = "▼ Show Refresh Token Options ▼";
    }

    // persist the state in local storage
    chrome.storage.local.set({ clientSecretRefreshExpanded: isExpanded });

}

// Restore Refresh Token Options Visibility on Load
function restoreRefreshTokenOptions() {
    chrome.storage.local.get("clientSecretRefreshExpanded", (result) => {
        const isExpanded = result.clientSecretRefreshExpanded || false;
        const toggleButton = document.getElementById("toggle-refresh-token-options");
        const content = document.getElementById("refresh-token-options-content");
        const wrapper = content.parentElement;

        // set initial state based on stored value
        if (isExpanded) {
            content.classList.add("expanded");
            wrapper.style.height = `${content.scrollHeight + toggleButton.offsetHeight}px`;
            toggleButton.textContent = "▲ Hide Refresh Token Options ▲";
        } else {
            content.classList.remove("expanded");
            wrapper.style.height = `${toggleButton.offsetHeight + 15}px`;
            toggleButton.textContent = "▼ Show Refresh Token Options ▼";
        }
    });
}

// Populate Client Secret Box
async function populateClientSecret() {
    const clienturl = await getClientUrl();
    const clientSecretBox = document.getElementById("client-secret");
	appLogger.info("Populating client secret.");

    if (!clienturl) {
        appLogger.info("Client URL not detected.");
        clientSecretBox.value = "";
        clientSecretBox.placeholder = "Requires WFMgr Login";
		clientSecretBox.readOnly = true;
        return;
    }

    const data = await loadClientData();
    if (data[clienturl]?.clientsecret) {
        clientSecretBox.value = data[clienturl].clientsecret;
        clientSecretBox.placeholder = "";
    } else {
        clientSecretBox.value = "";
        clientSecretBox.placeholder = "Enter Client Secret";
    }
}

// Toggle Client Secret Visibility
function toggleClientSecretVisibility() {
    const clientSecretBox = document.getElementById("client-secret");
    const toggleIcon = document.getElementById("toggle-client-secret");

    if (clientSecretBox.type === "password") {
        clientSecretBox.type = "text";
        toggleIcon.src = "icons/eyeclosed.png";
    } else {
        clientSecretBox.type = "password";
        toggleIcon.src = "icons/eyeopen.png";
    }
}

// Save Client Secret Button
async function saveClientSecretClick() {
    const button = document.getElementById("save-client-secret");
    
    try {
        appLogger.info("Save Client Secret button clicked.");

        if (!(await isValidSession())) {
            alert("Requires a valid ADP Workforce Manager session.");
            return;
        }

        const clienturl = await getClientUrl();
        if (!clienturl) {
            appLogger.info("No client URL detected.");
            return;
        }

        const clientsecret = document.getElementById("client-secret").value.trim();
        if (!clientsecret) {
            alert("Client Secret cannot be empty!");
            return;
        }

        const data = await loadClientData();
        data[clienturl] = {
            ...(data[clienturl] || {}),
            clientsecret: clientsecret,
            editdatetime: new Date().toISOString(),
        };

        await saveClientData(data);
        appLogger.info("Client Secret saved:", clientsecret);

        // Use helper function for success case
        setButtonTempText(button, "Client Secret Saved!");
    } catch (error) {
        // Use helper function for failure case
        appLogger.error("Failed to save Client Secret:", error);
        setButtonFailText(button, "Save Failed!");
    }
}

// Populate Refresh Token Box
async function populateRefreshToken() {
	appLogger.info("Populating Refresh Token...");
	const clienturl = await getClientUrl();
	const refreshTokenBox = document.getElementById("refresh-token");
	const refreshTimerBox = document.getElementById("refresh-timer");

	if (!clienturl) {
		appLogger.info("Client URL not found.");
		refreshTokenBox.value = "Requires WFMgr Login";
		refreshTimerBox.textContent = "--:--";
		return;
	}

	const data = await loadClientData();
	const currentDateTime = new Date();

	if (data[clienturl]?.refreshtoken) {
		const refreshExpirationTime = new Date(data[clienturl].refreshExpirationDateTime);

		if (currentDateTime > refreshExpirationTime) {
			appLogger.info("Refresh token has expired.");
			refreshTokenBox.value = "Refresh Token Expired";
			refreshTimerBox.textContent = "--:--";
		} else {
			appLogger.info("Refresh token is valid.");
			refreshTokenBox.value = data[clienturl].refreshtoken;

			// Calculate remaining time and start the timer
			const remainingSeconds = Math.floor((refreshExpirationTime - currentDateTime) / 1000);
			appLogger.info(`Refresh Timer will start with ${remainingSeconds} seconds remaining.`);
			startRefreshTokenTimer(remainingSeconds, refreshTimerBox);
		}
	} else {
		appLogger.info("No refresh token found.");
		refreshTokenBox.value = "Refresh Token";
		refreshTimerBox.textContent = "--:--";
	}
}

// Refresh Access Token using Refresh Token
async function refreshAccessToken() {
    const button = document.getElementById("refresh-access-token");
    
    try {
        appLogger.info("Refreshing Access Token...");
        const clienturl = await getClientUrl();
        if (!clienturl || !(await isValidSession())) {
            alert("Requires a valid ADP Workforce Manager session.");
            return;
        }

        const data = await loadClientData();
        const client = data[clienturl] || {};
        const { refreshtoken, clientid, clientsecret } = client;

        // validate refresh token
        if (!refreshtoken || refreshtoken === "Refresh Token" || new Date() > new Date(client.refreshExpirationDateTime)) {
            alert("No valid Refresh Token found. Please retrieve an Access Token first.");
            setButtonFailText(button, "No Valid Token!");
            return;
        }

        // validate client secret
        if (!clientsecret || clientsecret === "Enter Client Secret") {
            alert("Client Secret is required to refresh the Access Token.");
            setButtonFailText(button, "Missing Secret!");
            return;
        }

        const apiurl = `${clienturl}api/authentication/access_token`;
        appLogger.info(`Requesting new access token via refresh token at: ${apiurl}`);

        // make POST request
        const response = await fetch(apiurl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                refresh_token: refreshtoken,
                client_id: clientid,
                client_secret: clientsecret,
                grant_type: "refresh_token",
                auth_chain: "OAuthLdapService",
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to refresh access token. HTTP status: ${response.status}`);
        }

        // parse response
        const result = await response.json();
        appLogger.info("Refresh Token response:", result);

        const { access_token, expires_in } = result;
        if (!access_token || !expires_in) {
            throw new Error("Response is missing required fields: 'access_token' or 'expires_in'.");
        }

        // calculate expiration time
        const currentDateTime = new Date();
        const accessTokenExpirationDateTime = new Date(currentDateTime.getTime() + expires_in * 1000);

        // update local storage
        data[clienturl] = {
            ...client,
            accesstoken: access_token,
            expirationdatetime: accessTokenExpirationDateTime.toISOString(),
            editdatetime: currentDateTime.toISOString(),
        };

        await saveClientData(data);

        // update the UI
        appLogger.info("Access Token refreshed and saved successfully.");
        populateAccessToken();
        restoreTokenTimers();

        // Use helper function for success case
        setButtonTempText(button, "Token Refreshed!");

    } catch (error) {
        appLogger.error("Error refreshing access token:", error.message);
        alert(`Failed to refresh access token: ${error.message}`);
        setButtonFailText(button, "Refresh Failed!");
    }
}

// Start Timer for Refresh Token
function startRefreshTokenTimer(seconds, timerBox) {
	if (refreshTokenTimerInterval) {
		clearInterval(refreshTokenTimerInterval);
		refreshTokenTimerInterval = null;
	}

	let remainingTime = seconds;

	const updateTimer = () => {
		if (remainingTime <= 0) {
			clearInterval(refreshTokenTimerInterval);
			refreshTokenTimerInterval = null;
			timerBox.textContent = "--:--";
			console.log("Refresh Token Timer expired.");
		} else {
			const minutes = Math.floor(remainingTime / 60);
			const seconds = remainingTime % 60;
			timerBox.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
			remainingTime--;

			// Save the remaining time to storage
			chrome.storage.local.set({
				refreshTokenTimer: remainingTime
			});
		}
	};

	updateTimer();
	refreshTokenTimerInterval = setInterval(updateTimer, 1000);
}

// Stop Refresh Token Timer
function stopRefreshTokenTimer(timerBox) {
	if (refreshTokenTimerInterval) {
		clearInterval(refreshTokenTimerInterval);
		refreshTokenTimerInterval = null;
		timerBox.textContent = "--:--";
		console.log("Refresh Token Timer stopped.");
	}
	
	// clear timer from storage
	//chrome.storage.local.remove("refreshTokenTimer");
}

// Copy Refresh Token Button
function copyRefreshToken() {
    const button = document.getElementById("copy-refresh-token");
    const refreshTokenBox = document.getElementById("refresh-token");
    const refreshToken = refreshTokenBox?.value;

    // validate refresh token before copying
    if (!refreshToken || refreshToken === "Refresh Token" || refreshToken === "Refresh Token Expired") {
        appLogger.info("No valid Refresh Token available to copy.");
        setButtonFailText(button, "No Token!");
        return;
    }

    // copy refresh token to clipboard
    navigator.clipboard.writeText(refreshToken)
        .then(() => {
            setButtonTempText(button, "Copied!");
        })
        .catch((error) => {
            appLogger.error("Failed to copy Refresh Token:", error);
            setButtonFailText(button, "Copy Failed!");
        });
}



// ===== API LIBRARY FUNCTIONS ===== //
// Toggle API Library Visibility
function toggleApiLibrary() {
    const toggleButton = document.getElementById("toggle-api-library");
    const content = document.getElementById("api-library-content");
    const wrapper = content.parentElement;

    // Toggle expanded/collapsed state
    const isExpanded = content.classList.toggle("expanded");

    // Dynamically calculate the height
    if (isExpanded) {
        wrapper.style.height = `${content.scrollHeight + toggleButton.offsetHeight}px`; // Expand wrapper height
        toggleButton.textContent = "▲ Hide API Library ▲";
    } else {
        wrapper.style.height = `${toggleButton.offsetHeight + 15}px`; // Shrink wrapper height (15px padding)
        toggleButton.textContent = "▼ Show API Library ▼";
    }

    // Persist the state in local storage
    chrome.storage.local.set({ apiLibraryExpanded: isExpanded });

}

// Restore API Library Visibility on Load
function restoreApiLibrary() {
    chrome.storage.local.get("apiLibraryExpanded", (result) => {
        const isExpanded = result.apiLibraryExpanded || false;
        const toggleButton = document.getElementById("toggle-api-library");
        const content = document.getElementById("api-library-content");
        const wrapper = content.parentElement;

        // set initial state based on stored value
        if (isExpanded) {
            content.classList.add("expanded");
            wrapper.style.height = `${content.scrollHeight + toggleButton.offsetHeight}px`;
            toggleButton.textContent = "▲ Hide API Library ▲";
        } else {
            content.classList.remove("expanded");
            wrapper.style.height = `${toggleButton.offsetHeight + 15}px`;
            toggleButton.textContent = "▼ Show API Library ▼";
        }
    });
}

// Load API Library from apilibrary.json
async function loadApiLibrary() {
    try {
        const response = await fetch("apilibrary/apilibrary.json");
        if (!response.ok) throw new Error(`Failed to load API Library: ${response.status}`);
        const apiLibraryData = await response.json();
        appLogger.info("API Library loaded:", apiLibraryData);
        return apiLibraryData.apiLibrary;
    } catch (error) {
        appLogger.error("Error loading API Library:", error);
        return {};
    }
}

// Populate API Dropdown
async function populateApiDropdown() {
    try {
        const response = await fetch("apilibrary/apilibrary.json");
        if (!response.ok) throw new Error(`Failed to fetch API library. HTTP status: ${response.status}`);
        const apiLibraryData = await response.json();
        appLogger.info("API Library loaded:", apiLibraryData);

        const apiDropdown = document.getElementById("api-selector");
        if (!apiDropdown) {
            appLogger.warn("API dropdown element not found.");
            return;
        }

        // clear existing options in the dropdown
        apiDropdown.innerHTML = '<option value="" disabled selected>Select API...</option>';

        const apiLibrary = apiLibraryData.apiLibrary;
        for (const apiKey in apiLibrary) {
            // skip keys that start with an underscore
            if (apiKey.startsWith("_")) continue;

            const api = apiLibrary[apiKey];
            const option = document.createElement("option");
            option.value = apiKey; // use the key as the value
            option.textContent = api.name; // display the name in the dropdown
            apiDropdown.appendChild(option);
        }

        //console.log("API Dropdown populated successfully.");
    } catch (error) {
        appLogger.error("Error populating API dropdown:", error);
    }
}

// Load Request Profile (DEPRECATED)
async function loadRequestProfile(profilePath) {
    try {
        const response = await fetch(profilePath);
        if (!response.ok) {
            throw new Error(`Failed to fetch request profile. HTTP status: ${response.status}`);
        }
        const profileTemplate = await response.json();
        appLogger.info("Request Profile loaded:", profileTemplate);
        return profileTemplate;
    } catch (error) {
        appLogger.error("Error loading request profile:", error.message);
        return null; // Return null if loading fails
    }
}

// Clear Existing Parameters
function clearParameters() {
  const queryContainer = document.getElementById("query-parameters-container");
  const bodyContainer = document.getElementById("body-parameters-container");

  if (queryContainer) {
    queryContainer.innerHTML = ""; // clear query parameters
  }
  if (bodyContainer) {
    bodyContainer.innerHTML = ""; // clear body parameters
  }

  appLogger.info("API Parameters cleared successfully.");
}

// Populate Query Parameters with Dynamic Date Calculation
async function populateQueryParameters(selectedApiKey) {
    try {
        const apiLibrary = await loadApiLibrary(); // Load the API library
        const selectedApi = apiLibrary[selectedApiKey];

        if (!selectedApi) {
            appLogger.info("Selected API not found in the library.");
            return;
        }

        const queryContainer = document.getElementById("query-parameters-container");
        queryContainer.innerHTML = ""; // Clear existing parameters

        // handle ad-hoc requests
        if (selectedApiKey === "adHocGet" || selectedApiKey === "adHocPost") {
            const queryHeader = document.createElement("div");
            queryHeader.className = "parameter-header";
            queryHeader.textContent = "Endpoint URL with Query Parameters";
            queryContainer.appendChild(queryHeader);

            const endpointInput = document.createElement("input");
            endpointInput.type = "text";
            endpointInput.id = "adhoc-endpoint";
            endpointInput.classList.add("query-param-input");
            endpointInput.placeholder = "/v1/endpoint?queryParam=value";

            queryContainer.appendChild(endpointInput);
            return; // skip further processing for ad-hoc requests
        }

        // default behavior for regular APIs
        const queryHeader = document.createElement("div");
        queryHeader.className = "parameter-header";
        queryHeader.textContent = "Query Parameters";
        queryContainer.appendChild(queryHeader);

        // add help text if available
        if (selectedApi.queryParametersHelp) {
            const queryHelpText = document.createElement("p");
            queryHelpText.className = "parameter-help-text"; // uses existing CSS
            queryHelpText.textContent = selectedApi.queryParametersHelp;
            queryContainer.appendChild(queryHelpText);
        }

        if (!selectedApi.queryParameters || selectedApi.queryParameters.length === 0) {
            appLogger.info("No query parameters for this API.");
            return;
        }

        selectedApi.queryParameters.forEach((param) => {
            const paramWrapper = document.createElement("div");
            paramWrapper.classList.add("query-param-wrapper");

            const label = document.createElement("label");
            label.textContent = `${param.name}:`;
            label.setAttribute("for", `query-${param.name}`);
            paramWrapper.appendChild(label);

            let input; // declare input variable

            if (param.type === "select") {
                input = document.createElement("select");
                input.classList.add("query-param-input");

                // create the placeholder option
                const placeholderOption = document.createElement("option");
                placeholderOption.value = "";
                placeholderOption.textContent = param.description || "Select an option";
                placeholderOption.disabled = true;
                placeholderOption.selected = true;
                input.appendChild(placeholderOption);

                // add actual parameter options
                param.options.forEach((option) => {
                    const optionElement = document.createElement("option");
                    optionElement.value = option;
                    optionElement.textContent = option;
                    input.appendChild(optionElement);
                });

                // apply class for styling when placeholder is selected
                input.classList.add("placeholder");

                input.addEventListener("change", () => {
                    if (input.value === "") {
                        input.classList.add("placeholder");
                    } else {
                        input.classList.remove("placeholder");
                    }
                });
            } else if (param.type === "date") {
                input = document.createElement("input");
                input.type = "date";
                input.id = `query-${param.name}`;
                input.classList.add("query-param-input");

                if (typeof param.defaultValue === "string" && /^[+-]?\d+$/.test(param.defaultValue)) {
                    // convert relative days (e.g., "-10", "+5") to actual date
                    const daysOffset = parseInt(param.defaultValue, 10);
                    const calculatedDate = new Date();
                    calculatedDate.setDate(calculatedDate.getDate() + daysOffset);
                    input.value = calculatedDate.toISOString().split("T")[0]; // format as YYYY-MM-DD
                } else if (param.defaultValue) {
                    input.value = param.defaultValue; // use fixed date if provided
                }
            } else {
                input = document.createElement("input");
                input.type = "text";
                input.id = `query-${param.name}`;
                input.classList.add("query-param-input");

                if (param.defaultValue !== undefined && param.defaultValue !== "") {
                    input.value = param.defaultValue;
                } else {
                    input.placeholder = param.description || "Enter value";
                }
            }

            paramWrapper.appendChild(input);
            queryContainer.appendChild(paramWrapper);
        });

        appLogger.info("Query parameters populated successfully.");
    } catch (error) {
        appLogger.error("Error populating query parameters:", error);
    }
}

// Populate Body Parameters with Dynamic Max Limit in Labels
async function populateBodyParameters(selectedApiKey) {
    try {
        const apiLibrary = await loadApiLibrary();
        const selectedApi = apiLibrary[selectedApiKey];

        const bodyParamContainer = document.getElementById("body-parameters-container");
        if (!bodyParamContainer) {
            appLogger.info("Body Parameters container not found.");
            return;
        }

        // clear existing body parameters
        bodyParamContainer.innerHTML = "";

        // for adHoc POST requests, show a resizable textarea
        if (selectedApiKey === "adHocPost") {
            const bodyHeader = document.createElement("div");
            bodyHeader.className = "parameter-header";
            bodyHeader.textContent = "Full JSON Body";
            bodyParamContainer.appendChild(bodyHeader);

            const textarea = document.createElement("textarea");
            textarea.id = "adhoc-body";
            textarea.className = "json-textarea"; // custom style for resizing
            textarea.placeholder = "Enter full JSON body here...";
            bodyParamContainer.appendChild(textarea);

            appLogger.info("Body Parameters populated for adHoc POST request.");
            return;
        }

        // skip rendering body parameters for GET requests
        if (selectedApi.method === "GET") {
            appLogger.info("No Body Parameters needed for GET requests.");
            return;
        }

        // for regular POST requests, add a header
        if (!selectedApi || !selectedApi.bodyParameters) {
            appLogger.info("No body parameters found for the selected API.");
            return;
        }

        const bodyHeader = document.createElement("div");
        bodyHeader.className = "parameter-header";
        bodyHeader.textContent = "Body Parameters";
        bodyParamContainer.appendChild(bodyHeader);

        // add help text if available
        if (selectedApi.bodyParametersHelp) {
            const bodyHelpText = document.createElement("p");
            bodyHelpText.className = "parameter-help-text"; // uses existing CSS
            bodyHelpText.textContent = selectedApi.bodyParametersHelp;
            bodyParamContainer.appendChild(bodyHelpText);
        }

        // generate body parameter inputs for regular POST APIs
        selectedApi.bodyParameters.forEach((param) => {
            const paramWrapper = document.createElement("div");
            paramWrapper.className = "body-param-wrapper";

            let labelText = param.name;

            // append maxEntered value for multi-text fields
            if (param.type === "multi-text" && param.validation?.maxEntered) {
                labelText += ` (max = ${param.validation.maxEntered})`;
            }

            const label = document.createElement("label");
            label.htmlFor = `body-param-${param.name}`;
            label.textContent = labelText;
            label.className = "body-param-label";
            paramWrapper.appendChild(label);

            let input;

            // handle different parameter types
            if (param.type === "multi-select") {
                const multiSelectContainer = document.createElement("div");
                multiSelectContainer.className = "multi-select-container";

                param.options.forEach((option) => {
                    const checkboxWrapper = document.createElement("div");
                    checkboxWrapper.className = "checkbox-wrapper";

                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.value = option;
                    checkbox.dataset.path = param.path;
                    checkbox.dataset.type = param.type;
                    checkbox.id = `body-param-${param.name}-${option}`;

                    const checkboxLabel = document.createElement("label");
                    checkboxLabel.htmlFor = `body-param-${param.name}-${option}`;
                    checkboxLabel.textContent = option;

                    checkboxWrapper.appendChild(checkbox);
                    checkboxWrapper.appendChild(checkboxLabel);
                    multiSelectContainer.appendChild(checkboxWrapper);
                });

                paramWrapper.appendChild(multiSelectContainer);
            } else if (param.type === "multi-text") {
                const multiTextContainer = document.createElement("div");
                multiTextContainer.className = "multi-text-container";

                const addButton = document.createElement("button");
                addButton.type = "button";
                addButton.className = "btn btn-add-item";
                addButton.textContent = "Add Entry";

                addButton.addEventListener("click", () => {
                    const textInput = document.createElement("input");
                    textInput.type = "text";
                    textInput.className = "body-param-input";
                    textInput.dataset.path = param.path;
                    textInput.dataset.type = param.type;
                    textInput.placeholder = param.description || "Enter value";
                    multiTextContainer.appendChild(textInput);
                });

                multiTextContainer.appendChild(addButton);

                const defaultTextInput = document.createElement("input");
                defaultTextInput.type = "text";
                defaultTextInput.className = "body-param-input";
                defaultTextInput.dataset.path = param.path;
                defaultTextInput.dataset.type = param.type;
                defaultTextInput.placeholder = param.description || "Enter value";
                multiTextContainer.appendChild(defaultTextInput);

                paramWrapper.appendChild(multiTextContainer);
            } else if (param.type === "select" || param.type === "boolean") {
                const dropdownContainer = document.createElement("div");
                dropdownContainer.className = "dropdown-container";

                input = document.createElement("select");
                input.className = "body-param-input";
                input.dataset.path = param.path;
                input.dataset.type = param.type;

                // placeholder option
                const placeholderOption = document.createElement("option");
                placeholderOption.value = "";
                placeholderOption.textContent = param.description || "Select an option";
                placeholderOption.disabled = true;
                placeholderOption.selected = true;
                placeholderOption.hidden = true;
                input.appendChild(placeholderOption);

                // add actual parameter options
                param.options.forEach((option) => {
                    const optionElement = document.createElement("option");
                    optionElement.value = option;
                    optionElement.textContent = option;
                    input.appendChild(optionElement);
                });

                // set the default value properly
                if (param.defaultValue) {
                    input.value = param.defaultValue;
                }

                dropdownContainer.appendChild(input);
                paramWrapper.appendChild(dropdownContainer);
            } else {
                input = document.createElement("input");
                input.type = param.type === "date" ? "date" : "text";
                input.className = "body-param-input";
                input.dataset.path = param.path;
                input.dataset.type = param.type;

                // handle placeholders & default values
                if (param.type === "date") {
                    if (param.defaultValue === "") {
                        input.placeholder = param.description || "mm/dd/yyyy";
                        input.classList.add("placeholder-style"); // Ensure styling for placeholder text
                    } else if (typeof param.defaultValue === "string" && /^[+-]?\d+$/.test(param.defaultValue)) {
                        // convert relative days (e.g., "-10", "+5") to actual date
                        const daysOffset = parseInt(param.defaultValue, 10);
                        const calculatedDate = new Date();
                        calculatedDate.setDate(calculatedDate.getDate() + daysOffset);
                        input.value = calculatedDate.toISOString().split("T")[0]; // format as YYYY-MM-DD
                    } else {
                        input.value = param.defaultValue; // use fixed date if provided
                    }
                } else {
                    if (param.defaultValue !== undefined && param.defaultValue !== "") {
                        input.value = param.defaultValue;
                    }
                }

                paramWrapper.appendChild(input);
            }

            bodyParamContainer.appendChild(paramWrapper);
        });

        appLogger.info("Body parameters populated successfully for regular POST request.");
    } catch (error) {
        appLogger.error("Error populating Body Parameters:", error);
    }
}

// Stylize Ad-Hoc APIs
function applyDynamicStyles() {
    // get dynamically generated elements
    const endpointInput = document.getElementById("adhoc-endpoint");
    const bodyTextarea = document.getElementById("adhoc-body");

    // add classes if necessary
    if (endpointInput) {
        endpointInput.classList.add("query-param-input");
    }

    if (bodyTextarea) {
        bodyTextarea.classList.add("json-textarea");
    }
}

// Map User Inputs to Request Profile
function mapUserInputsToRequestProfile(profileTemplate, inputs) {
    appLogger.info("Mapping user inputs to request profile...");
    inputs.forEach((input) => {
        const { path, type } = input.dataset;
        const value = input.value;
        appLogger.info(`Processing Input - Path: ${path}, Type: ${type}, Value: ${value}`);

        if (!path) return;

        const keys = path.split(".");
        let ref = profileTemplate;

        // navigate to the appropriate location in the JSON structure
        for (let i = 0; i < keys.length - 1; i++) {
            if (!ref[keys[i]]) ref[keys[i]] = {}; // create the key if it doesn't exist
            ref = ref[keys[i]];
        }

        const lastKey = keys[keys.length - 1];

        // handle different parameter types
        if (type === "boolean") {
            // convert "true"/"false" strings to actual boolean
            ref[lastKey] = value === "true";
        } else if (type === "multi-select") {
            // collect all selected checkboxes
            const selectedOptions = Array.from(
                document.querySelectorAll(`[data-path="${path}"]:checked`)
            ).map((checkbox) => checkbox.value);
            ref[lastKey] = selectedOptions; // assign the selected options as an array
        } else if (type === "multi-text") {
            // collect all text inputs in the container
            const multiTextValues = Array.from(
                document.querySelectorAll(`[data-path="${path}"]`)
            ).map((textInput) => textInput.value.trim());
            ref[lastKey] = multiTextValues.filter((val) => val !== ""); // remove empty values
        } else if (type === "date") {
            // assign date as-is
            ref[lastKey] = value;
        } else {
            // default behavior for text/select
            ref[lastKey] = value;
        }

        appLogger.info(`Mapped Value - Path: ${path}, Final Value:`, ref[lastKey]);
    });
}

// Clear Response Field for New Data
function clearApiResponse() {
    const responseSection = document.getElementById("response-section");
    if (responseSection) {
        responseSection.innerHTML = "<pre>Awaiting API Response...</pre>";
    }
}

// Wait For Valid Access Token To Be Updated In Storage If Needed
async function waitForUpdatedToken(clienturl, maxRetries = 5, delayMs = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        await new Promise((resolve) => setTimeout(resolve, delayMs)); // Wait for storage update
        let updatedData = await loadClientData();
        let updatedClientData = updatedData[clienturl] || {};

        if (updatedClientData.accesstoken) {
            appLogger.info("New access token retrieved:", updatedClientData.accesstoken);
            return updatedClientData;
        }

        appLogger.info(`Retry ${i + 1}/${maxRetries}: Token not available yet...`);
    }

    throw new Error("Failed to retrieve updated access token after multiple attempts.");
}
	
// API Selector
async function handleApiSelection(selectedApiKey) {
  clearApiResponse();
  clearParameters();
  await populateQueryParameters(selectedApiKey);
  await populateBodyParameters(selectedApiKey);
  applyDynamicStyles();
}

// Execute API Call With Multi-Call Support
async function executeApiCall() {
    const button = document.getElementById("execute-api");
    let animation;

    try {
        clearApiResponse();
        appLogger.info("Executing API call...");

        // Start loading animation and store both interval and original text
        animation = startLoadingAnimation(button);

        if (!(await isValidSession())) {
            alert("Requires a valid ADP Workforce Manager session.");
            throw new Error("Invalid session");
        }

        const apiDropdown = document.getElementById("api-selector");
        const selectedApiKey = apiDropdown?.value;
        if (!selectedApiKey || selectedApiKey === "Select API...") {
            alert("Please select an API to execute.");
            throw new Error("No API selected");
        }

        const apiLibrary = await loadApiLibrary();
        const selectedApi = apiLibrary[selectedApiKey];
        if (!selectedApi) {
            alert("Selected API not found in the library.");
            throw new Error("API not found");
        }

        const clienturl = await getClientUrl();
        let data = await loadClientData();
        let clientData = data[clienturl] || {};

        if (!clientData.accesstoken || new Date(clientData.expirationdatetime) < new Date()) {
            console.log("Access token expired or missing. Fetching a new token...");
            await fetchToken();
            clientData = await waitForUpdatedToken(clienturl);
        }

        const accessToken = clientData.accesstoken;
        let fullUrl = clientData.apiurl + selectedApi.url;
        let requestBody = null;

        // handle query parameters for standard GET requests
        if (selectedApi.method === "GET") {
            const queryParams = new URLSearchParams();
            const queryInputs = document.querySelectorAll("#query-parameters-container .query-param-input");

            queryInputs.forEach((input) => {
                if (input.value.trim() !== "" && input.value.trim() !== input.placeholder) {
                    queryParams.append(input.id.replace("query-", ""), input.value.trim());
                }
            });

            if (queryParams.toString()) {
                fullUrl += "?" + queryParams.toString();
            }
        }

        // handle ad-hoc requests
        if (selectedApiKey === "adHocGet" || selectedApiKey === "adHocPost") {
            const endpointInput = document.getElementById("adhoc-endpoint");
            if (!endpointInput || !endpointInput.value.trim()) {
                alert("Please provide an endpoint URL.");
                throw new Error("Empty ad-hoc endpoint");
            }
            fullUrl = clientData.apiurl + endpointInput.value.trim();
        }

        // handle pre-request logic if needed
        if (selectedApi.preRequest) {
            appLogger.info(`Executing pre-request: ${selectedApi.preRequest.apiKey}`);

            const preRequestApi = apiLibrary[selectedApi.preRequest.apiKey];
            const preRequestUrl = clientData.apiurl + preRequestApi.url;

            const preResponse = await fetch(preRequestUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });

            if (!preResponse.ok) {
                const errorText = await preResponse.text();
                displayApiResponse({
                    error: errorText
                }, selectedApiKey);
                throw new Error(`Pre-request failed. HTTP status: ${preResponse.status}`);
            }

            const preResult = await preResponse.json();
            appLogger.info("Pre-request Response:", preResult);

            const {
                field,
                match,
                mapTo,
                ["data-path"]: dataPath
            } = selectedApi.preRequest.responseFilter;
            let mappedValues = preResult.filter(item => item[field] === match).map(item => item[mapTo]);

            const maxLimit = selectedApi.bodyParameters.find(p => p.name === "qualifiers")?.validation?.maxEntered || 1000;
            if (mappedValues.length > maxLimit) {
                alert(`Only the first ${maxLimit} entries will be used due to API limitations.`);
                mappedValues = mappedValues.slice(0, maxLimit);
            }

            appLogger.info("Mapped Values (Limited):", mappedValues);

            // dynamically insert mapped values into requestBody using the correct dataPath
            requestBody = {};
            const pathParts = dataPath.split(".");
            let currentLevel = requestBody;

            pathParts.forEach((part, index) => {
                if (index === pathParts.length - 1) {
                    currentLevel[part] = mappedValues;
                } else {
                    currentLevel[part] = currentLevel[part] || {};
                    currentLevel = currentLevel[part];
                }
            });
        } else {
            // handle request body for regular POST APIs
            if (selectedApi.method === "POST") {
                if (selectedApiKey === "adHocPost") {
                    const bodyInput = document.getElementById("adhoc-body");
                    if (!bodyInput || !bodyInput.value.trim()) {
                        alert("Please provide a JSON body.");
                        throw new Error("Empty JSON body");
                    }

                    try {
                        requestBody = JSON.parse(bodyInput.value.trim());
                    } catch (error) {
                        alert("Invalid JSON body. Please correct it.");
                        throw new Error("Invalid JSON format");
                    }
                } else if (selectedApi.requestProfile) {
                    const profileTemplate = JSON.parse(JSON.stringify(selectedApi.requestProfile));
                    const bodyParamsContainer = document.getElementById("body-parameters-container");
                    const paramInputs = Array.from(bodyParamsContainer.querySelectorAll("[data-path]"));

                    mapUserInputsToRequestProfile(profileTemplate, paramInputs);
                    requestBody = profileTemplate;
                }
            }
        }

        appLogger.info("Final Request Body:", JSON.stringify(requestBody, null, 2));

        // save request details for the request details button
        lastRequestDetails = {
            method: selectedApi.method || "GET",
            url: fullUrl,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: requestBody ? JSON.stringify(requestBody, null, 2) : null,
        };

        const response = await fetch(fullUrl, {
            method: selectedApi.method || "GET",
            headers: lastRequestDetails.headers,
            body: lastRequestDetails.body,
        });

        const responseText = await response.text();
        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            result = {
                error: responseText
            };
        }

        appLogger.info("API Response:", result);
        displayApiResponse(result, selectedApiKey);

        // Clear animation interval
        if (animation?.interval) {
            clearInterval(animation.interval);
        }

        // Use helper function for success/failure and restore original text after
        if (response.ok) {
            setButtonTempText(button, "Success!", 2000, animation.originalText);
        } else {
            setButtonFailText(button, "Failed!", 2000, animation.originalText);
        }

    } catch (error) {
        appLogger.error("Error executing API call:", error);
        alert(`API call failed: ${error.message}`);
        displayApiResponse({
            error: error.message
        }, "Error");

        // Clear animation interval
        if (animation?.interval) {
            clearInterval(animation.interval);
        }

        setButtonFailText(button, "Failed!", 2000, animation.originalText);
    }
}

// Display API Response (Default = Raw View)
async function displayApiResponse(response, apiKey) {
  const responseSection = document.getElementById("response-section");
  window.lastApiResponseObject = response; // stash for popout/toggle

  // preserve/create Popout button
  let popoutButton = document.getElementById("popout-response");
  if (!popoutButton) {
    popoutButton = document.createElement("button");
    popoutButton.id = "popout-response";
    popoutButton.className = "btn3";
    popoutButton.innerHTML = `
      Popout Response 
      <img src="icons/external-link.png" alt="Popout" class="btn-icon">
    `;
    popoutButton.addEventListener("click", popoutResponse);
    responseSection.prepend(popoutButton);
  }

  // load API library and set up Export CSV button
  const apiLibrary = await loadApiLibrary();
  appLogger.info("Raw API Key from executeApiCall:", apiKey);
  appLogger.info("Available API Keys in Library:", Object.keys(apiLibrary));
  const selectedApi = apiLibrary[apiKey];
  if (!selectedApi) {
    console.log("API Key Not Found in Library:", apiKey);
  } else {
    appLogger.info("Retrieved API Object:", selectedApi);
    appLogger.info("Checking ExportMap for:", apiKey, selectedApi?.exportMap);
  }

  if (selectedApi?.exportMap) {
    let exportCsvButton = document.getElementById("export-api-csv");
    if (!exportCsvButton) {
      exportCsvButton = document.createElement("button");
      exportCsvButton.id = "export-api-csv";
      exportCsvButton.className = "btn3";
      exportCsvButton.innerHTML = `
        Export CSV
        <img src="icons/export-csv.png" alt="CSV" class="btn-icon">
      `;
      exportCsvButton.addEventListener("click", () => {
        appLogger.info("Export CSV button clicked!");
        exportApiResponseToCSV(response, selectedApi.exportMap, apiKey);
      });
      responseSection.appendChild(exportCsvButton);
    }
  }

  // ensure tree/raw toggle exists (default = raw)
  ensureViewToggle();

  // clear prior render
  [...responseSection.querySelectorAll('.json-tree, pre')].forEach(n => n.remove());

  // raw by default
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(response, null, 2);
  responseSection.appendChild(pre);

  // set toggle button state to raw
  const toggle = document.getElementById('toggle-view');
  if (toggle) {
    toggle.dataset.mode = 'raw';
    toggle.textContent = 'Tree View';
  }

  // enable download button
  const downloadButton = document.getElementById("download-response");
  if (downloadButton) {
    downloadButton.disabled = false;
    downloadButton.onclick = () => downloadApiResponse(response, apiKey);
  }
}

// JSON Tree View Renderer
function renderJsonTree(data, rootEl, {collapsedDepth = 1} = {}) {
  rootEl.innerHTML = ''
  const el = buildNode(data, undefined, 0, collapsedDepth)
  rootEl.appendChild(el)
}

// JSON Tree View Node Builder
function buildNode(value, key, depth, collapsedDepth) {
  const isObj = v => v && typeof v === 'object'
  if (isObj(value)) {
    const details = document.createElement('details')
    details.open = depth < collapsedDepth

    const summary = document.createElement('summary')
    summary.textContent = key != null
      ? `${key}: ${Array.isArray(value) ? '[]' : '{}'}`
      : (Array.isArray(value) ? '[]' : '{}')
    details.appendChild(summary)

    const keys = Array.isArray(value) ? value.keys() : Object.keys(value)
    for (const k of keys) {
      const childKey = Array.isArray(value) ? k : k
      const childVal = Array.isArray(value) ? value[k] : value[k]
      details.appendChild(buildNode(childVal, childKey, depth + 1, collapsedDepth))
    }
    return details
  } else {
    const row = document.createElement('div')
    row.className = 'json-leaf'
    row.textContent = key != null ? `${key}: ${formatScalar(value)}` : formatScalar(value)
    return row
  }
}

// Pretty-Print Leaf Values For The JSON Tree
function formatScalar(v) {
  if (typeof v === 'string') return `"${v}"`
  if (v === null) return 'null'
  return String(v)
}

// API Response Raw / Tree View Toggle
function ensureViewToggle() {
  const section = document.getElementById('response-section');
  let btn = document.getElementById('toggle-view');
  if (btn) return;

  btn = document.createElement('button');
  btn.id = 'toggle-view';
  btn.className = 'btn3';
  btn.dataset.mode = 'raw';   // default mode
  btn.textContent = 'Tree View';
  section.prepend(btn);

  btn.onclick = () => {
    const mode = btn.dataset.mode;
    // clear current render
    [...section.querySelectorAll('.json-tree, pre')].forEach(n => n.remove());

    if (mode === 'raw') {
      // switch to tree
      const tree = document.createElement('div');
      tree.className = 'json-tree';
      section.appendChild(tree);
      renderJsonTree(window.lastApiResponseObject ?? {}, tree, { collapsedDepth: 1 });
      btn.dataset.mode = 'tree';
      btn.textContent = 'Raw View';
    } else {
      // switch back to raw
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(window.lastApiResponseObject ?? {}, null, 2);
      section.appendChild(pre);
      btn.dataset.mode = 'raw';
      btn.textContent = 'Tree View';
    }
  };
}

// Download API Response
async function downloadApiResponse(response, apiName) {
    const sanitizedApiName = apiName.replace(/[^a-zA-Z0-9_-]/g, "_"); // Sanitize filename
    const defaultFileName = `${sanitizedApiName || "api_response"}.json`;

    if (window.showSaveFilePicker) {
        try {
            // Modern method: File System Access API
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: defaultFileName,
                types: [
                    {
                        description: "JSON Files",
                        accept: { "application/json": [".json"] },
                    },
                ],
            });

            // write file content
            const writableStream = await fileHandle.createWritable();
            await writableStream.write(JSON.stringify(response, null, 2));
            await writableStream.close();

            appLogger.info("File successfully saved.");
        } catch (error) {
            if (error.name !== "AbortError") {
                appLogger.error("Error saving file:", error);
                alert("Failed to save the file.");
            }
        }
    } else {
        // fallback: trigger file download using Blob and anchor element
        appLogger.info("File System Access API not supported, using fallback method.");

        const blob = new Blob([JSON.stringify(response, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultFileName;
        a.click();
        URL.revokeObjectURL(url);

        appLogger.info("File downloaded using fallback method.");
    }
}

// Copy API Response to Clipboard (Only JSON)
function copyApiResponse() {
    const button = document.getElementById("copy-api-response");
    const responseSection = document.getElementById("response-section");

    // find the first <pre> or <code> block that contains the JSON response
    const jsonElement = responseSection?.querySelector("pre, code");

    if (jsonElement) {
        const responseContent = jsonElement.innerText.trim();

        if (responseContent) {
            navigator.clipboard.writeText(responseContent)
                .then(() => {
                    setButtonTempText(button, "Copied!");
                })
                .catch((err) => {
                    appLogger.info("Failed to copy API response:", err);
                    setButtonFailText(button, "Copy Failed!");
                });
        } else {
            appLogger.info("No valid JSON response found.");
            setButtonFailText(button, "No JSON!");
        }
    } else {
        appLogger.info("No API Response exists. Send a request first.");
        setButtonFailText(button, "No Response!");
    }
}

// View API Request Details
function showRequestDetails() {
    if (!lastRequestDetails) {
        const noDetailsHtml = `
            <html>
            <head>
                <title>No Request Details</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        padding: 20px;
                        margin: 0;
                    }
                    h1 {
                        color: #ff0000;
                    }
                </style>
            </head>
            <body>
                <h1>No request details available.</h1>
            </body>
            </html>
        `;

        const noDetailsWindow = window.open("", "_blank", "width=400,height=300");
        noDetailsWindow.document.write(noDetailsHtml);
        noDetailsWindow.document.close();
        return;
    }

    const requestDetailsHtml = `
        <html>
        <head>
            <title>Request Details</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 20px;
                    margin: 0;
                    line-height: 1.6;
                }
                h1 {
                    color: #0059B3;
                }
                pre {
                    background: #f4f4f4;
                    border: 1px solid #ddd;
                    padding: 10px;
                    overflow-x: auto;
                }
            </style>
        </head>
        <body>
            <h1>Request Details</h1>
            <p><strong>Method:</strong> ${lastRequestDetails.method}</p>
            <p><strong>URL:</strong> ${lastRequestDetails.url}</p>
            <p><strong>Headers:</strong></p>
            <pre>${JSON.stringify(lastRequestDetails.headers, null, 2)}</pre>
            <p><strong>Body:</strong></p>
            <pre>${lastRequestDetails.body || "No body"}</pre>
        </body>
        </html>
    `;

    const detailsWindow = window.open("", "_blank", "width=600,height=400");
    detailsWindow.document.write(requestDetailsHtml);
    detailsWindow.document.close();
}

// Popout API Response (works for Raw or Tree view without inline scripts)
function popoutResponse() {
  const data = window.lastApiResponseObject;
  if (!data) {
    const noResponseHtml = `
      <html><head><title>No Response</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; margin: 0; }
        h1 { color: #ff0000; }
      </style></head>
      <body>
        <h1>No response available.</h1>
        <p>Please send an API request to generate a response.</p>
      </body></html>`;
    const w = window.open("", "_blank", "width=400,height=300");
    w.document.write(noResponseHtml);
    w.document.close();
    return;
  }

  const mode = document.getElementById('toggle-view')?.dataset.mode || 'raw';

  if (mode === 'raw') {
    // RAW popout
    const responseHtml = `
      <html><head><title>API Response</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; margin: 0; line-height: 1.6; }
        h1 { color: #0059B3; }
        pre { background: #f4f4f4; border: 1px solid #ddd; padding: 10px; overflow-x: auto; }
      </style></head>
      <body>
        <h1>API Response</h1>
        <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </body></html>`;
    const w = window.open("", "_blank", "width=800,height=900");
    w.document.write(responseHtml);
    w.document.close();
  } else {
    // TREE popout (no inline script: pre-render HTML in the parent)
    const container = document.createElement('div');
    container.className = 'json-tree';
    // reuse your existing renderer to build DOM in this temp container
    renderJsonTree(data, container, { collapsedDepth: 1 });

    // serialize the built tree to static HTML
    const treeHtml = container.outerHTML;

    const responseHtml = `
      <html><head><title>API Response (Tree)</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; margin: 0; line-height: 1.6; }
        h1 { color: #0059B3; margin-bottom: 10px; }
        .json-tree { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
        .json-tree details { margin-left: .75rem; }
        .json-tree summary { cursor: pointer; outline: none; }
        .json-tree .json-leaf { margin-left: 1.5rem; white-space: pre-wrap; }
      </style></head>
      <body>
        <h1>API Response (Tree)</h1>
        ${treeHtml}
      </body></html>`;
    const w = window.open("", "_blank", "width=900,height=1000");
    w.document.write(responseHtml);
    w.document.close();
  }
}

// Helper for RAW Popout To Avoid Breaking HTML
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

//Export JSON Response to CSV
async function exportApiResponseToCSV(response, apiKey) {
    appLogger.info("Exporting API Response to CSV...");
    appLogger.info("API Key Received for Export:", apiKey);
    appLogger.info("Full API Response:", response);

    if (!response || (Array.isArray(response) && response.length === 0)) {
        alert("No data available to export.");
        return;
    }

    // extract array if the response is an object with a nested array
    let extractedArray = response;
    if (!Array.isArray(response)) {
        for (const key in response) {
            if (Array.isArray(response[key])) {
                extractedArray = response[key];
                appLogger.info(`Extracted nested array from key: ${key}`);
                break;
            }
        }
    }

    if (!Array.isArray(extractedArray) || extractedArray.length === 0) {
        alert("No valid array data found for export.");
        return;
    }

    // load API library
    const apiLibrary = await loadApiLibrary();
    appLogger.info("Loaded API Library for Validation:", apiLibrary);

    // set the file name based on the API key
    const safeApiName = apiKey ? apiKey : "api-response"; // Ensure safe fallback
    appLogger.info("CSV File Name Will Be:", safeApiName);

    let expandedHeaders = new Set();
    let expandedData = [];

    // **Recursive Function to Flatten Objects**
    function flattenObject(obj, parentKey = "") {
        let flatRow = {};
        let arrayFields = {};

        Object.entries(obj).forEach(([key, value]) => {
            const newKey = parentKey ? `${parentKey}.${key}` : key;

            if (Array.isArray(value)) {
                arrayFields[newKey] = value;
            } else if (typeof value === "object" && value !== null) {
                // **Recursively flatten nested objects**
                const nestedFlat = flattenObject(value, newKey);
                Object.assign(flatRow, nestedFlat.flatRow);
                Object.assign(arrayFields, nestedFlat.arrayFields);
            } else {
                flatRow[newKey] = value;
                expandedHeaders.add(newKey);
            }
        });

        return { flatRow, arrayFields };
    }

    // Flatten Each Object in the Array
    extractedArray.forEach(item => {
        const { flatRow, arrayFields } = flattenObject(item);
        const maxRows = Math.max(...Object.values(arrayFields).map(arr => arr.length), 1);

        for (let i = 0; i < maxRows; i++) {
            let rowCopy = { ...flatRow };

            Object.entries(arrayFields).forEach(([field, values]) => {
                if (typeof values[i] === "object" && values[i] !== null) {
                    Object.entries(values[i]).forEach(([subKey, subValue]) => {
                        let subField = `${field}.${subKey}`;
                        rowCopy[subField] = subValue;
                        expandedHeaders.add(subField);
                    });
                } else {
                    rowCopy[field] = values[i] !== undefined ? values[i] : "";
                    expandedHeaders.add(field);
                }
            });

            expandedData.push(rowCopy);
        }
    });

    // 🚀 Remove Empty Columns
    expandedHeaders = Array.from(expandedHeaders);
    const columnsWithData = expandedHeaders.filter(header =>
        expandedData.some(row => row[header] !== "" && row[header] !== undefined)
    );

    appLogger.info("Final CSV Headers (After Cleanup):", columnsWithData);

    //const csvRows = [columnsWithData.join(",")];
	const csvRows = [`"${columnsWithData.join('","')}"`];


    expandedData.forEach(row => {
        const rowData = columnsWithData.map(header => `"${row[header] !== undefined ? row[header] : ""}"`);
        csvRows.push(rowData.join(","));
    });

    appLogger.info("Final CSV Data:\n", csvRows.join("\n"));

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    // Ensure file always saves with the same name (overwrite existing file)
    link.download = `${safeApiName}-export.csv`;
    link.href = url;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}



// ===== SESSION FUNCTIONS ===== //
// Remove -nosso From client URL
function createSsoUrl(clientUrl) {
    return clientUrl.replace("-nosso.", ".");
}

// Construct API URL
function toApiUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    // strip query/hash; normalize path
    let path = u.pathname || "/";
    if (!path.endsWith("/")) path += "/";
    // ensure exactly “…/api” (no trailing slash)
    if (path.endsWith("/api/") || path.endsWith("/api")) {
      path = "/api";
    } else {
      path = path + "api";
    }
    return u.origin + path;
  } catch {
    // fallback if URL constructor fails
    let s = (url.split(/[?#]/)[0] || "").replace(/\/+$/, "");
    return s + "/api";
  }
}

// Open URL In Normal Mode
function openURLNormally(url) {
    const newTab = document.createElement("a");
    newTab.href = url;
    newTab.target = "_blank";
    newTab.rel = "noopener noreferrer";
    document.body.appendChild(newTab);
    newTab.click();
    document.body.removeChild(newTab);
}

// Get the base URL (Vanity URL) from active tab and inject 
function getVanityUrl(tabUrl) {
    let url = new URL(tabUrl);
    let hostname = url.hostname;

    // Handle the SSO URL adjustments
    if (hostname.includes(".mykronos.com") && !hostname.includes("-nosso")) {
        if (hostname.includes(".prd.mykronos.com")) {
            hostname = hostname.replace(".prd.mykronos.com", "-nosso.prd.mykronos.com");
        } else if (hostname.includes(".npr.mykronos.com")) {
            hostname = hostname.replace(".npr.mykronos.com", "-nosso.npr.mykronos.com");
        }
    }

    return `${url.protocol}//${hostname}/`;
}

// Validate session based on the active tab URL
async function isValidSession() {
	const clientUrl = await getClientUrl();
	return clientUrl !== null; // If getClientUrl resolves null, the session is invalid
}

// Validate Current Webpage Is A Valid ADP WFMgr Session
function validateWebPage(url) {
  // First check if we're even on mykronos.com
  if (!url.includes("mykronos.com")) {
    return { valid: false, message: "Invalid Domain" };
  }

  // define invalid URL patterns
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

  // check against invalid patterns
  for (const { pattern, message } of invalidPatterns) {
    if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) {
      return { valid: false, message };
    }
  }

  // if no invalid patterns matched, the URL is valid
  return { valid: true, message: "Valid" };
}

// Retrieve the Current Client URL, Preferring The Linked WFM Tab
async function getClientUrl() {
  // prefer the linked tab's origin if available
  try {
    if (window.HermesLink && typeof HermesLink.getBaseUrl === 'function') {
      const linkedBase = await HermesLink.getBaseUrl(); // e.g., https://foo.mykronos.com
	  // warn if linked status isn't "ok"
		try {
		  const { hermesLinkedStatus } = await chrome.storage.session.get('hermesLinkedStatus');
		  if (hermesLinkedStatus && hermesLinkedStatus !== 'ok') {
		    appLogger.info('Hermes linked tab status:', hermesLinkedStatus, '(you may need to re-auth or relink).');
		  }
		} catch {}

      if (linkedBase) {
        const validation = validateWebPage(linkedBase);
        if (validation?.valid) {
          const vanityUrl = getVanityUrl(linkedBase);
          return vanityUrl || null;
        } else {
          cappLogger.info(validation?.message || 'Linked base URL failed validation.');
          // fall through to active-tab mode
        }
      }
    }
  } catch (e) {
    // non-fatal: just fall back to active-tab mode
    appLogger.info('HermesLink.getBaseUrl failed; falling back to active tab.', e);
  }

  // 2) fallback: use the active tab
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        const tabUrl = tabs[0].url;

        const validation = validateWebPage(tabUrl);
        if (!validation.valid) {
          appLogger.info(validation.message);
          resolve(null);
        } else {
          const vanityUrl = getVanityUrl(tabUrl);
          resolve(vanityUrl || null);
        }
      } else {
        appLogger.info('No active tab detected.');
        resolve(null);
      }
    });
  });
}

// HermesLink: Enhanced tab management and session tracking
window.HermesLink = (function () {
    const PING_INTERVAL = 60 * 1000; // 1 minute
    const SESSION_KEYS = {
        TAB_ID: 'hermesLinkedTabId',
        WINDOW_ID: 'hermesLinkedWindowId',
        URL: 'hermesLinkedUrl',
        ORIGIN: 'hermesLinkedOrigin',
        TITLE: 'hermesLinkedTitle',
        STATUS: 'hermesLinkedStatus',
        LAST_VALIDATION: 'hermesLastValidation',
        VALIDATION_MESSAGE: 'hermesValidationMessage'
    };

    // status messages
    const STATUS_MESSAGES = {
        OK: {
            banner: 'Linked',
            hint: 'Session active in this tab',
            overlay: null
        },
        STALE: {
            banner: 'Session Needs Attention',
            hint: 'Your session may have expired. Please refresh the page.',
            overlay: 'Session may have expired. Return to WFM to refresh your session.'
        },
        INVALID: {
            banner: 'Invalid Session',
            hint: 'Please return to a valid WFM page.',
            overlay: 'Invalid WFM session. Return to a valid WFM page to continue.'
        },
        WRONG_TAB: {
            banner: 'Not Active Tab',
            hint: 'Return to linked tab to use Hermes',
            overlay: 'Hermes is active in another tab. Click below to return.'
        }
    };

    // state management
    const state = {
        isInitialized: false,
        checkingState: false
    };

    // helper functions
    const getActiveTab = async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return tab || null;
        } catch (e) {
            appLogger.error('Failed to get active tab:', e);
            return null;
        }
    };

    const getLinkedState = async () => {
        try {
            return await chrome.storage.session.get(Object.values(SESSION_KEYS));
        } catch (e) {
            appLogger.error('Failed to get linked state:', e);
            return {};
        }
    };

    const updateLinkedState = async (newState) => {
        try {
            const timestamp = new Date().toISOString();
            await chrome.storage.session.set({
                ...newState,
                hermesLastValidation: timestamp
            });
            appLogger.debug('Updated linked state:', { ...newState, timestamp });
        } catch (e) {
            appLogger.error('Failed to update linked state:', e);
        }
    };

    // enhanced UI management
    const updateUI = async (validationResult = null) => {
        const { 
            hermesLinkedTabId, 
            hermesLinkedStatus,
            hermesValidationMessage
        } = await getLinkedState();
        
        const currentTab = await getActiveTab();
        const isLinkedTab = currentTab?.id === hermesLinkedTabId;
        
        // determine current status
        let currentStatus = 'OK';
        if (!isLinkedTab) {
            currentStatus = 'WRONG_TAB';
        } else if (hermesLinkedStatus === 'stale') {
            currentStatus = 'STALE';
        } else if (validationResult && !validationResult.valid) {
            currentStatus = 'INVALID';
        }

        const statusConfig = STATUS_MESSAGES[currentStatus];
        
        // update overlay
        const overlay = document.getElementById('hermes-overlay');
        if (overlay) {
            const overlayMessage = document.querySelector('.overlay-content p');
            if (overlayMessage && statusConfig.overlay) {
                overlayMessage.textContent = statusConfig.overlay;
            }
            overlay.classList.toggle('visible', currentStatus !== 'OK');
        }
        
        // update banner
        const banner = document.getElementById('hermes-link-banner');
        if (banner) {
            const status = document.getElementById('hermes-link-status');
            const target = document.getElementById('hermes-link-target');
            const hint = document.getElementById('hermes-link-hint');
            
            if (status) status.textContent = statusConfig.banner;
            if (target) target.textContent = currentTab?.title || '';
            if (hint) hint.textContent = hermesValidationMessage || statusConfig.hint;
        }
        
        // update body state - This is critical for the overlay functionality
        document.body.classList.toggle('tab-inactive', currentStatus !== 'OK');

        appLogger.info('UI Updated:', { status: currentStatus, isLinkedTab });
    };

    // Session validation
    const validateSession = async () => {
        const { hermesLinkedUrl, hermesLinkedTabId } = await getLinkedState();
        
        if (!hermesLinkedUrl || !hermesLinkedTabId) {
            return { ok: false, code: 'nolink', message: 'No linked session found' };
        }

        try {
            const tab = await chrome.tabs.get(hermesLinkedTabId).catch(() => null);
            if (!tab) {
                await updateLinkedState({ 
                    hermesLinkedStatus: 'stale',
                    hermesValidationMessage: 'Linked tab was closed'
                });
                return { ok: false, code: 'closed', message: 'Linked tab was closed' };
            }

            const validation = validateWebPage(tab.url);
            if (!validation.valid) {
                await updateLinkedState({ 
                    hermesLinkedStatus: 'stale',
                    hermesValidationMessage: validation.message
                });
                return { ok: false, code: 'invalid', validation };
            }

            await updateLinkedState({ 
                hermesLinkedStatus: 'ok',
                hermesValidationMessage: 'Session active'
            });

            return { ok: true, code: 'ok', validation };
        } catch (e) {
            appLogger.error('Session validation failed:', e);
            await updateLinkedState({ 
                hermesLinkedStatus: 'stale',
                hermesValidationMessage: 'Unable to verify session'
            });
            return { ok: false, code: 'error', message: 'Session check failed' };
        }
    };

    // Core functionality
    const core = {
        async validateAndUpdateState() {
            if (state.checkingState) return;
            state.checkingState = true;

            try {
                const validationResult = await validateSession();
                await updateUI(validationResult.validation);
                return validationResult;
            } catch (e) {
                appLogger.error('State check failed:', e);
            } finally {
                state.checkingState = false;
            }
        },

		async switchToLinkedTab() {
			try {
				const { hermesLinkedTabId } = await getLinkedState();
				if (!hermesLinkedTabId) {
					throw new Error('No linked tab found');
				}
		
				const tab = await chrome.tabs.get(hermesLinkedTabId).catch(() => null);
				if (!tab) {
					throw new Error('Linked tab no longer exists');
				}
		
				// Get current window state
				const currentWindow = await chrome.windows.get(tab.windowId);
				appLogger.debug('Current window state:', currentWindow.state);
		
				// Switch to window while preserving its state
				await chrome.windows.update(tab.windowId, {
					focused: true,
					// Only pass state if it's not 'normal' to preserve maximized/fullscreen
					...(currentWindow.state !== 'normal' && { state: currentWindow.state })
				});
		
				// Small delay before activating tab
				await new Promise(resolve => setTimeout(resolve, 100));
		
				// Activate the tab
				await chrome.tabs.update(hermesLinkedTabId, { active: true });
				await new Promise(resolve => setTimeout(resolve, 250));
				await this.validateAndUpdateState();
		
			} catch (error) {
				appLogger.error('Tab switch failed:', error);
				throw error;
			}
		},

        async initialize() {
            if (state.isInitialized) return;
            
            appLogger.info('Initializing HermesLink');

            // Initial state check
            await this.validateAndUpdateState();

            // Set up periodic check
            setInterval(() => {
                this.validateAndUpdateState().catch(e => 
                    appLogger.error('Periodic check failed:', e)
                );
            }, PING_INTERVAL);

            state.isInitialized = true;
            appLogger.info('HermesLink initialized');
        }
    };

    // Initialize core
    core.initialize().catch(e => appLogger.error('Failed to initialize HermesLink:', e));

    // Public API
    return {
        checkState: () => core.validateAndUpdateState(),
        goToLinkedTab: () => core.switchToLinkedTab(),
        relinkToCurrentTab: async (tab) => {
            if (!tab?.url) {
                throw new Error('No active tab');
            }

            const validation = validateWebPage(tab.url);
            if (!validation.valid) {
                throw new Error(validation.message);
            }

            await updateLinkedState({
                [SESSION_KEYS.TAB_ID]: tab.id,
                [SESSION_KEYS.WINDOW_ID]: tab.windowId,
                [SESSION_KEYS.URL]: tab.url,
                [SESSION_KEYS.ORIGIN]: new URL(tab.url).origin,
                [SESSION_KEYS.TITLE]: tab.title || '',
                [SESSION_KEYS.STATUS]: 'ok',
                hermesValidationMessage: 'Successfully linked to current tab'
            });

            await core.validateAndUpdateState();
        },
        getBaseUrl: async () => {
            const { hermesLinkedOrigin, hermesLinkedStatus } = await getLinkedState();
            return hermesLinkedStatus === 'ok' ? hermesLinkedOrigin : null;
        }
    };
})();



// ===== EVENT LISTENERS ===== //
document.addEventListener("DOMContentLoaded", async () => {
	console.log("DOMContentLoaded event fired. Initializing Hermes extension...");

    const vanityUrl = await getClientUrl();
    if (vanityUrl) {
        console.log("Client URL (vanity):", vanityUrl);
    } else {
        console.log("No valid client URL detected.");
    }

	await populateClientUrlField();
    await populateClientID();
    await populateAccessToken();
	await populateClientSecret();
    await populateRefreshToken();
    await restoreTokenTimers();
    await populateThemeDropdown();
    await restoreSelectedTheme();
    await populateApiDropdown();

	
	// Event listeners for Admin Menu
	document.getElementById("clear-all-data").addEventListener("click", clearAllData);
	document.getElementById("clear-client-data").addEventListener("click", clearClientData);
	document.getElementById("view-client-data").addEventListener("click", viewClientData);
	document.getElementById("export-csv").addEventListener("click", exportCSV);
	document.getElementById("export-json").addEventListener("click", exportJSON);
	document.getElementById("import-data").addEventListener("click", importData);

	// Event Listeners for Links Menu
	document.getElementById("links-boomi").addEventListener("click", linksBoomi);
	document.getElementById("links-install-integrations").addEventListener("click", linksInstallIntegrations);
	document.getElementById("links-developer-portal").addEventListener("click", linksDeveloperPortal);

	// Event Listeners for Theme Menu
	document.getElementById("theme-selector")?.addEventListener("change", themeSelection);

	// Event Listeners for Help Menu
	document.getElementById("help-about").addEventListener("click", helpAbout);
	document.getElementById("help-support").addEventListener("click", helpSupport);

    // Event Listener for API Access Client URL
	document.getElementById("refresh-client-url")?.addEventListener("click", refreshClientUrlClick);
	document.getElementById("copy-client-url")?.addEventListener("click", copyClientUrlClick);
	
	// Event Listener for Save Client ID Button
	const saveClientIDButton = document.getElementById("save-client-id");
	if (saveClientIDButton) {
		saveClientIDButton.addEventListener("click", saveClientIDClick);
	}
	
	// Event Listener for Get Access Token Button
	const getTokenButton = document.getElementById("get-token");
	if (getTokenButton) {
		getTokenButton.addEventListener("click", fetchToken);
	}

	// Event Listener for Copy Access Token Button
	document.getElementById("copy-token")?.addEventListener("click", copyAccessToken);

	// Event Listners for Refresh Token Options Visibility
	document.getElementById("toggle-refresh-token-options")?.addEventListener("click", toggleRefreshTokenOptions);
		restoreRefreshTokenOptions();

	// Event Listener for Save Client Secret Button
	const saveClientSecretButton = document.getElementById("save-client-secret");
	if (saveClientSecretButton) {
		saveClientSecretButton.addEventListener("click", saveClientSecretClick);
	}

	// Event Listener for Toggling Client Secret Visibility
	document.getElementById("toggle-client-secret").addEventListener("click", toggleClientSecretVisibility);

	// Event Listener for Refresh Access Token Button
	const refreshTokenButton = document.getElementById("refresh-access-token");
	if (refreshTokenButton) {
		refreshTokenButton.addEventListener("click", refreshAccessToken);
	}

	// Event Listener for Copy Refresh Token button
	document.getElementById("copy-refresh-token")?.addEventListener("click", copyRefreshToken);

	// Event Listeners for API Library
	document.getElementById("toggle-api-library")?.addEventListener("click", toggleApiLibrary);
		restoreApiLibrary();	
    document.getElementById("api-selector").addEventListener("change", (event) => 
        handleApiSelection(event.target.value));
	document.getElementById("execute-api").addEventListener("click", executeApiCall);
	document.getElementById("copy-api-response").addEventListener("click", copyApiResponse);
	document.getElementById("view-request-details").addEventListener("click", showRequestDetails);
	
	const popoutResponseButton = document.getElementById("popout-response");
	if (popoutResponseButton) {
		popoutResponseButton.addEventListener("click", popoutResponse);
	}


    // HermesLink button handlers
    const returnButton = document.getElementById('hermes-return-to-tab');
    if (returnButton) {
        returnButton.addEventListener('click', async () => {
            try {
                returnButton.disabled = true;
                await HermesLink.goToLinkedTab();
            } catch (error) {
                appLogger.error('Failed to return to linked tab:', error);
                alert('Unable to return to linked tab: ' + error.message);
            } finally {
                returnButton.disabled = false;
            }
        });
    }

    // Set up visibility change handler
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            HermesLink.checkState().catch(e => 
                appLogger.error('Visibility check failed:', e)
            );
        }
    });

    // Set up focus handler
    window.addEventListener('focus', () => {
        HermesLink.checkState().catch(e => 
            appLogger.error('Focus check failed:', e)
        );
    });


});