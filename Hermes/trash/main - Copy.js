// main.js: Core functionality for Hermes extension UI console.log("");

// GLOBALS
const storageKey = "clientdata";
let accessTokenTimerInterval = null;
let refreshTokenTimerInterval = null;
let lastRequestDetails = null;

// HELPER UTILITIES
// Download Utility for Export Functions
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], {
    type: mimeType,
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

// Open URLs in normal mode safely
function openURLNormally(url) {
  const newTab = document.createElement("a");
  newTab.href = url;
  newTab.target = "_blank";
  newTab.rel = "noopener noreferrer";
  document.body.appendChild(newTab);
  newTab.click();
  document.body.removeChild(newTab);
}

// Logger
function appendLog(message) {
  const timestamp = new Date().toISOString();
  chrome.storage.local.get({ logs: [] }, (result) => {
    const logs = result.logs;
    logs.push(`[${timestamp}] ${message}`);
    chrome.storage.local.set({ logs });
  });
}

// Local Storage: Load client data
async function loadClientData() {
  return new Promise((resolve) => {
    chrome.storage.local.get([storageKey], (result) => {
      resolve(result[storageKey] || {});
    });
  });
}

// Local Storage: Save client data
async function saveClientData(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [storageKey]: data,
      },
      () => resolve(),
    );
  });
}

// Restore Token Timers
async function restoreTokenTimers() {
  console.log("Restoring token timers...");

  const clienturl = await getClientUrl();
  if (!clienturl) {
    console.log("No valid client environment detected. Resetting all timers.");
    const accessTokenTimerBox = document.getElementById("timer");
    const refreshTokenTimerBox = document.getElementById("refresh-timer");

    // Reset timers in the UI
    stopAccessTokenTimer(accessTokenTimerBox);
    stopRefreshTokenTimer(refreshTokenTimerBox);
    return;
  }

  const data = await loadClientData();
  const clientData = data[clienturl] || {};
  const currentDateTime = new Date();

  // Restore Access Token Timer
  const accessTokenTimerBox = document.getElementById("timer");
  if (clientData.accesstoken) {
    const expirationTime = new Date(clientData.expirationdatetime);
    if (currentDateTime < expirationTime) {
      const remainingSeconds = Math.floor(
        (expirationTime - currentDateTime) / 1000,
      );
      startAccessTokenTimer(remainingSeconds, accessTokenTimerBox);
    } else {
      console.log("Access token expired; resetting timer.");
      accessTokenTimerBox.textContent = "--:--";
    }
  } else {
    accessTokenTimerBox.textContent = "--:--";
  }

  // Restore Refresh Token Timer
  const refreshTokenTimerBox = document.getElementById("refresh-timer");
  if (clientData.refreshtoken) {
    const refreshExpirationTime = new Date(
      clientData.refreshExpirationDateTime,
    );
    if (currentDateTime < refreshExpirationTime) {
      const remainingSeconds = Math.floor(
        (refreshExpirationTime - currentDateTime) / 1000,
      );
      startRefreshTokenTimer(remainingSeconds, refreshTokenTimerBox);
    } else {
      console.log("Refresh token expired; resetting timer.");
      refreshTokenTimerBox.textContent = "--:--";
    }
  } else {
    refreshTokenTimerBox.textContent = "--:--";
  }
}

// Buttons: Set a button success text temporarily, then restore
function setButtonTempText(btn, okText, ms = 2000) {
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = okText;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, ms);
}

// Buttons: Set a button failure text temporarily (optional)
function setButtonFailText(btn, failText, ms = 2000) {
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = failText;
  btn.disabled = false; // leave enabled so user can try again
  setTimeout(() => {
    btn.textContent = original;
  }, ms);
}

// Construct safe API url
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
    // Fallback if URL constructor fails
    let s = (url.split(/[?#]/)[0] || "").replace(/\/+$/, "");
    return s + "/api";
  }
}



// MENU FUNCTIONS
// Admin > Clear All Data
async function clearAllData() {
  if (!confirm("Are you sure you want to clear ALL stored client data?"))
    return;

  await new Promise((resolve) => {
    chrome.storage.local.remove(storageKey, () => {
      console.log("All client data cleared.");
      resolve();
    });
  });

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
}

// Admin > Clear Client Data
async function clearClientData() {
  const clienturl = await getClientUrl();
  if (!clienturl) {
    alert("No valid client environment detected.");
    return;
  }

  if (!confirm(`Are you sure you want to clear data for: ${clienturl}?`))
    return;

  const data = await loadClientData();
  if (data[clienturl]) {
    delete data[clienturl];
    await saveClientData(data);
    console.log(`Data cleared for ${clienturl}`);
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

// Admin > View Client Data
async function viewClientData() {
  console.log("View Client Data clicked.");

  // Get the client URL
  const clienturl = await getClientUrl();
  if (!clienturl) {
    alert("No valid client URL detected.");
    return;
  }

  // Load data from local storage
  const data = await loadClientData();
  const clientData = data[clienturl];

  if (!clientData) {
    alert("No data exists for the current client.");
    return;
  }

  // Format client data for display
  const formattedData = JSON.stringify(clientData, null, 2);

  // Open a new popup window to display the client data
  const popupWindow = window.open(
    "",
    "_blank",
    "width=850,height=350,scrollbars=yes,resizable=yes",
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
    alert(
      "Unable to open the popup window. Please check your browser settings.",
    );
  }
}

// Admin > Export CSV
async function exportCSV() {
  const data = await loadClientData();
  if (!Object.keys(data).length) {
    alert("No client data available to export.");
    return;
  }

  let csvContent =
    "Client URL,Client ID,Client Secret,Token URL,API URL,Effective Date,Expiration Date,Edit Date\n";

  for (const [url, details] of Object.entries(data)) {
    csvContent += `"${url}","${details.clientid || ""}","${details.clientsecret || ""}","${details.tokenurl || ""}","${details.apiurl || ""}","${details.effectivedatetime || ""}","${details.expirationdatetime || ""}","${details.editdatetime || ""}"\n`;
  }

  const fileName = `hermes-clientdata-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadFile(fileName, csvContent, "text/csv");

  console.log("Client data exported as CSV.");

  // Show a notification after export
  alert(
    ` CSV exported successfully!\nCheck your downloads folder for:\n ${fileName}`,
  );
}

// Admin > Export JSON
async function exportJSON() {
  const data = await loadClientData();
  if (!Object.keys(data).length) {
    alert("No client data available to export.");
    return;
  }

  const sanitizedData = JSON.parse(
    JSON.stringify(data, (key, value) => {
      return key === "accesstoken" || key === "refreshtoken"
        ? undefined
        : value;
    }),
  );

  const fileName = `hermes-clientdata-${new Date().toISOString().slice(0, 10)}.json`;
  downloadFile(
    fileName,
    JSON.stringify(sanitizedData, null, 2),
    "application/json",
  );

  console.log("Client data exported as JSON.");

  alert(
    `JSON exported successfully!\nCheck your downloads folder for:\n${fileName}`,
  );
}

// Admin > Import
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
              accesstoken: null, // Clear sensitive fields
              refreshtoken: null, // Clear sensitive fields
              editdatetime: new Date().toISOString(),
            };
          }
        } else if (file.name.endsWith(".csv")) {
          const rows = content.split("\n").slice(1); // Skip header
          for (const row of rows) {
            const [url, clientid, clientsecret, tokenurl, apiurl] = row
              .split(",")
              .map((field) => field.replace(/"/g, "").trim());
            if (url) {
              data[url] = {
                clientid: clientid || "",
                clientsecret: clientsecret || "",
                tokenurl: tokenurl || "",
                apiurl: apiurl || "",
                accesstoken: null, // Clear sensitive fields
                refreshtoken: null, // Clear sensitive fields
                editdatetime: new Date().toISOString(),
              };
            }
          }
        } else {
          throw new Error("Unsupported file format.");
        }

        await saveClientData(data);
        alert("Data imported successfully.");
        console.log("Client data imported.");

        // Refresh the UI
        await populateClientID();
        await populateAccessToken();
        await populateClientSecret();
        await populateRefreshToken();
        await restoreTokenTimers();
      } catch (error) {
        console.log("Import failed:", error);
        alert(
          "Failed to import data. Ensure the file is in the correct format.",
        );
      }
    };
    reader.readAsText(file);
  });

  input.click();
}

// Links > Boomi
async function linksBoomi() {
  if (!(await isValidSession())) {
    alert("Requires a valid ADP Workforce Manager session.");
    return;
  }

  const clienturl = await getClientUrl();
  if (!clienturl) {
    console.log("Client URL not found.");
    return;
  }

  // Remove -nosso if it exists
  const sanitizedClientUrl = clienturl.replace("-nosso.", ".");

  // Construct the Boomi URL dynamically
  const boomiURL = `${sanitizedClientUrl}ihub#/integrationTemplatesDesigner?ctxt=designIntegrationTemplates&pageId=58`;
  console.log("Opening Boomi URL:", boomiURL);
  appendLog(boomiURL);

  // Detect if in incognito mode
  chrome.windows.getCurrent({ populate: false }, (window) => {
    if (chrome.runtime.lastError) {
      console.log("Error detecting incognito mode:", chrome.runtime.lastError);
      openURLNormally(boomiURL); // Fallback
      return;
    }

    if (window.incognito) {
      console.log("Opening in the same incognito session...");
      chrome.tabs.create({ url: boomiURL, active: true });
    } else {
      console.log("Opening in a normal window...");
      openURLNormally(boomiURL);
    }
  });
}

// Links > Install Integrations
async function linksInstallIntegrations() {
  if (!(await isValidSession())) {
    alert("Requires a valid ADP Workforce Manager session.");
    return;
  }

  const clienturl = await getClientUrl();
  if (!clienturl) {
    console.log("Client URL not found.");
    return;
  }

  // Remove -nosso if it exists
  const sanitizedClientUrl = clienturl.replace("-nosso.", ".");

  // Construct the Install Integrations URL dynamically
  const installIntegrationsURL = `${sanitizedClientUrl}metaui#/list/integration/?ctxt=configureIntegrations&pageId=57`;
  console.log("Opening Install Integrations URL:", installIntegrationsURL);

  // Detect if in incognito mode
  chrome.windows.getCurrent({ populate: false }, (window) => {
    if (chrome.runtime.lastError) {
      console.log("Error detecting incognito mode:", chrome.runtime.lastError);
      openURLNormally(installIntegrationsURL); // Fallback
      return;
    }

    if (window.incognito) {
      console.log("Opening in the same incognito session...");
      chrome.tabs.create({ url: installIntegrationsURL, active: true });
    } else {
      console.log("Opening in a normal window...");
      openURLNormally(installIntegrationsURL);
    }
  });
}

// Links > Developer Portal
async function linksDeveloperPortal() {
  try {
    const hermesData = await fetch("hermes.json").then((res) => res.json());
    const developerPortalURL = hermesData.details.urls.developerPortal;

    if (!developerPortalURL) {
      console.log("Developer Portal URL not found in hermes.json.");
      return;
    }

    console.log("Opening Developer Portal URL:", developerPortalURL);

    // Store a reference to the global window object
    const globalWindow = window;

    // Detect if in incognito mode
    chrome.windows.getCurrent({ populate: false }, (win) => {
      if (win.incognito) {
        console.log("Opening in the same incognito session...");
        chrome.tabs.create({ url: developerPortalURL, active: true });
      } else {
        console.log("Opening in a normal window...");
        globalWindow.open(developerPortalURL, "_blank");
      }
    });
  } catch (error) {
    console.log("Failed to load Developer Portal URL:", error);
  }
}

// Themes > Load dropdown menu selector from /themes/themes.json
async function loadThemes() {
  try {
    const response = await fetch("themes/themes.json");
    if (!response.ok)
      throw new Error(
        `Failed to fetch themes. HTTP status: ${response.status}`,
      );
    const themesData = await response.json();
    //console.log("Themes loaded:", themesData);
    return themesData.themes;
  } catch (error) {
    console.log("Error loading themes:", error);
    return {};
  }
}

// Themes > Populate themes dropdown
async function populateThemeDropdown() {
  const themes = await loadThemes();
  const dropdown = document.getElementById("theme-selector");
  if (!dropdown) {
    console.log("Theme dropdown element not found in DOM.");
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

// Themes > Apply the selected theme
async function applyTheme(themeKey) {
  const themes = await loadThemes();
  const selectedTheme = themes[themeKey];

  if (!selectedTheme) {
    console.log(`Theme "${themeKey}" not found.`);
    return;
  }

  const root = document.documentElement;
  const colors = selectedTheme.colors;

  // Update color variables
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--${key}`, value);
  }

  // Update font variables
  const fonts = selectedTheme.fonts;
  root.style.setProperty("--font-family", fonts["font-family-primary"]);
  root.style.setProperty("--title-font", fonts["title-font-primary"]);

  // Save the selected theme in local storage
  chrome.storage.local.set({ selectedTheme: themeKey });
  console.log(`Theme "${themeKey}" applied.`);
}

// Themes > Selection
function themeSelection(event) {
  const selectedTheme = event.target.value;
  applyTheme(selectedTheme);
}

// Themes > Restore the last selected theme
async function restoreSelectedTheme() {
  chrome.storage.local.get("selectedTheme", async (result) => {
    const themeKey = result.selectedTheme || "hermes"; // Default theme
    await applyTheme(themeKey);

    const dropdown = document.getElementById("theme-selector");
    if (dropdown) dropdown.value = themeKey;
  });
}

// Help > About
async function helpAbout() {
  try {
    const hermesData = await fetch("hermes.json").then((res) => res.json());
    const aboutMessage = `
            Name: ${hermesData.name}
            Description: ${hermesData.details.description}
            Version: ${hermesData.details.version}
            Release Date: ${hermesData.details.release_date}
            Author: ${hermesData.details.author}`;

    // Clean up the message to remove tabs
    const cleansedAboutMessage = aboutMessage.replace(/\t/g, "");
    alert(cleansedAboutMessage);
  } catch (error) {
    console.log("Failed to load About information:", error);
  }
}

// Help > Support
async function helpSupport() {
  try {
    const hermesData = await fetch("hermes.json").then((res) => res.json());
    const contactEmail = hermesData.details.contact;

    const userConfirmed = confirm("Would you like to open a support ticket?");
    if (!userConfirmed) return;

    const mailtoLink = `mailto:${contactEmail}?subject=Hermes: Support Ticket Request&body=Please describe the support request here.`;
    window.location.href = mailtoLink;
    console.log("Support mail opened");
  } catch (error) {
    console.log("Failed to load support contact information:", error);
  }
}



// SESSION FUNCTIONS
// Get the base URL (vanity URL) from active tab
function getVanityUrl(tabUrl) {
  let url = new URL(tabUrl);
  let hostname = url.hostname;

  // Handle the SSO URL adjustments
  if (hostname.includes(".mykronos.com")) {
    if (hostname.includes(".prd.mykronos.com")) {
      hostname = hostname.replace(
        ".prd.mykronos.com",
        "-nosso.prd.mykronos.com",
      );
    } else if (hostname.includes(".npr.mykronos.com")) {
      hostname = hostname.replace(
        ".npr.mykronos.com",
        "-nosso.npr.mykronos.com",
      );
    }
  }

  return `${url.protocol}//${hostname}/`;
}

// Validate if the current webpage is a valid ADP WFMgr session
function validateWebPage(url) {
  if (!url.includes("mykronos.com")) {
    return { valid: false, message: "Invalid Domain" };
  }
  if (url.includes("mykronos.com/authn/")) {
    return { valid: false, message: "Invalid Login" };
  }
  if (/:\/\/adp-developer\.mykronos\.com\//i.test(url)) {
    return {
      valid: false,
      message: "Developer Portal not supported for API session",
    };
  }
  return { valid: true, message: "Valid" };
}

// Retrieve the current client URL
async function getClientUrl() {
  // 1) Prefer the linked tab's origin if available
  try {
    if (window.HermesLink && typeof HermesLink.getBaseUrl === "function") {
      const linkedBase = await HermesLink.getBaseUrl(); // e.g., https://*.mykronos.com
      // Warn if linked status isn't "ok"
      try {
        const { hermesLinkedStatus } =
          await chrome.storage.session.get("hermesLinkedStatus");
        if (hermesLinkedStatus && hermesLinkedStatus !== "ok") {
          console.log(
            "Hermes linked tab status:",
            hermesLinkedStatus,
            "(you may need to re-auth or relink).",
          );
        }
      } catch {}

      if (linkedBase) {
        const validation = validateWebPage(linkedBase);
        if (validation?.valid) {
          const vanityUrl = getVanityUrl(linkedBase);
          return vanityUrl || null;
        } else {
          console.log(
            validation?.message || "Linked base URL failed validation.",
          );
          // fall through to active-tab mode
        }
      }
    }
  } catch (e) {
    // Non-fatal: just fall back to active-tab mode
    console.log("HermesLink.getBaseUrl failed; falling back to active tab.", e);
  }

  // 2) Fallback: use the active tab
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        const tabUrl = tabs[0].url;

        const validation = validateWebPage(tabUrl);
        if (!validation.valid) {
          console.log(validation.message);
          resolve(null);
        } else {
          const vanityUrl = getVanityUrl(tabUrl);
          resolve(vanityUrl || null);
        }
      } else {
        console.log("No active tab detected.");
        resolve(null);
      }
    });
  });
}

// Validate session based on the active tab URL
async function isValidSession() {
  const clientUrl = await getClientUrl();
  return clientUrl !== null; // If getClientUrl resolves null, the session is invalid
}

// ===== HermesLink: Linked-tab utility for tab browsing =====
window.HermesLink = (function () {
  const WFM_REGEX = /:\/\/.*\.mykronos\.com\//i;

  function isWfmUrl(url) {
    return !!url && WFM_REGEX.test(url);
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab || null;
  }

  async function getLinkedState() {
    return chrome.storage.session.get([
      "hermesLinkedTabId",
      "hermesLinkedUrl",
      "hermesLinkedOrigin",
      "hermesLinkedTitle",
      "hermesLinkedStatus",
    ]);
  }

  async function setLinkedToTab(tab) {
    if (!tab?.id) throw new Error("No active tab.");

    const url = tab.url || "";

    // Prefer your app's validator if available
    let valid = true,
      message = "Valid";
    if (typeof window.validateWebPage === "function") {
      const v = window.validateWebPage(url) || {};
      valid = !!v.valid;
      message = v.message || message;
    } else {
      // Fallback: same rules as validateWebPage
      if (!/mykronos\.com/i.test(url)) {
        valid = false;
        message = "Invalid Domain";
      } else if (/mykronos\.com\/authn\//i.test(url)) {
        valid = false;
        message = "Invalid Login";
      } else if (/:\/\/adp-developer\.mykronos\.com\//i.test(url)) {
        valid = false;
        message = "Developer Portal not supported for API session";
      }
    }

    if (!valid) {
      throw new Error(message);
    }

    // Store the link (valid session page)
    await chrome.storage.session.set({
      hermesLinkedTabId: tab.id,
      hermesLinkedUrl: url,
      hermesLinkedOrigin: new URL(url).origin,
      hermesLinkedTitle: tab.title || "",
      hermesLinkedStatus: "ok",
    });
  }

  async function relinkToCurrentTab() {
    const tab = await getActiveTab();
    if (!tab) throw new Error("No active tab.");
    return setLinkedToTab(tab);
  }

  async function goToLinkedTab() {
    const { hermesLinkedTabId } = await getLinkedState();
    if (!hermesLinkedTabId) throw new Error("No linked tab.");
    try {
      const tab = await chrome.tabs.get(hermesLinkedTabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(hermesLinkedTabId, { active: true });
    } catch (e) {
      throw new Error("Linked tab not found.");
    }
  }

  async function getBaseUrl() {
    // Prefer the linked origin
    const { hermesLinkedOrigin, hermesLinkedStatus } = await getLinkedState();
    if (hermesLinkedOrigin && hermesLinkedStatus !== "closed") {
      return hermesLinkedOrigin; // e.g., https://*.mykronos.com
    }

    // Fallback: derive from current active tab (legacy behavior)
    const tab = await getActiveTab();
    if (tab?.url && isWfmUrl(tab.url)) {
      try {
        return new URL(tab.url).origin;
      } catch {}
    }
    // If neither linked nor current tab is WFM, return null to let caller decide.
    return null;
  }

  async function ping(options = {}) {
    const { hermesLinkedUrl, hermesLinkedStatus } = await getLinkedState();
    if (!hermesLinkedUrl || hermesLinkedStatus === "closed")
      return { ok: false, code: "nolink" };

    // Try a benign GET (or HEAD) to the linked URL (host permission lets this pass).
    // NOTE: Adjust path to a light, always-allowed endpoint if you have one.
    const url = hermesLinkedUrl;
    try {
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        method: "GET",
      });
      if (res.ok) {
        // Consider 2xx as healthy
        if (hermesLinkedStatus !== "ok") {
          await chrome.storage.session.set({ hermesLinkedStatus: "ok" });
        }
        return { ok: true, status: res.status };
      }
      // 401/403/3xx etc — mark stale
      await chrome.storage.session.set({ hermesLinkedStatus: "stale" });
      return { ok: false, status: res.status, code: "auth" };
    } catch (e) {
      await chrome.storage.session.set({ hermesLinkedStatus: "stale" });
      return { ok: false, code: "network" };
    }
  }

  // --- Banner wiring (optional UI feedback) ---
  async function refreshBanner() {
    const banner = document.getElementById("hermes-link-banner");
    if (!banner) return; // allow running even if banner not present

    const elStatus = document.getElementById("hermes-link-status");
    const elTarget = document.getElementById("hermes-link-target");
    const elHint = document.getElementById("hermes-link-hint");

    const {
      hermesLinkedTabId,
      hermesLinkedTitle,
      hermesLinkedOrigin,
      hermesLinkedStatus,
    } = await getLinkedState();

    // Determine what to show
    let show = true;
    let statusText = "Not linked";
    let hint = "Open Hermes on a WFM tab or click “Relink to this tab”.";
    let target = "";

    if (hermesLinkedTabId && hermesLinkedOrigin) {
      target = `Linked to: ${hermesLinkedTitle || hermesLinkedOrigin}`;
      if (hermesLinkedStatus === "ok") {
        statusText = "Linked";
        hint =
          "Hermes will use this WFM tab’s session even while you browse elsewhere.";
        document.documentElement.classList.remove("hermes-dim");
        document.body.classList.remove("hermes-dim");
      } else if (hermesLinkedStatus === "stale") {
        statusText = "Linked (needs attention)";
        hint =
          "Session may be expired or tab moved off WFM. Click “Go to linked tab” to re-auth or “Relink to this tab”.";
        document.documentElement.classList.add("hermes-dim");
        document.body.classList.add("hermes-dim");
      } else if (hermesLinkedStatus === "closed") {
        statusText = "Link lost";
        hint = "Linked tab was closed. Relink to a WFM tab.";
        document.documentElement.classList.add("hermes-dim");
        document.body.classList.add("hermes-dim");
      }
    } else {
      // No link yet
      document.documentElement.classList.add("hermes-dim");
      document.body.classList.add("hermes-dim");
    }

    banner.dataset.show = show ? "true" : "false";
    if (elStatus) elStatus.textContent = statusText;
    if (elTarget) elTarget.textContent = target;
    if (elHint) elHint.textContent = hint;
  }

  function wireBannerButtons() {
    const btnRelink = document.getElementById("hermes-btn-relink");
    const btnGoto = document.getElementById("hermes-btn-goto");

    if (btnRelink) {
      btnRelink.addEventListener("click", async () => {
        try {
          await relinkToCurrentTab();
          await refreshBanner();
        } catch (e) {
          alert(e.message || "Failed to relink.");
        }
      });
    }
    if (btnGoto) {
      btnGoto.addEventListener("click", async () => {
        try {
          await goToLinkedTab();
        } catch (e) {
          alert(e.message || "No linked tab to switch to.");
        }
      });
    }
  }

  async function autoLinkIfNeeded() {
    // If we already have a good link, do nothing.
    const { hermesLinkedTabId, hermesLinkedStatus } = await getLinkedState();
    if (hermesLinkedTabId && hermesLinkedStatus === "ok") return;

    // Try to link to the current active tab if it's a valid WFM session.
    const tab = await getActiveTab();
    if (!tab) return;

    // Use your validator if available; fallback to the same rules.
    let valid = true;
    if (typeof window.validateWebPage === "function") {
      const v = window.validateWebPage(tab.url || "") || {};
      valid = !!v.valid;
    } else {
      valid =
        /mykronos\.com/i.test(tab.url || "") &&
        !/mykronos\.com\/authn\//i.test(tab.url || "");
    }

    if (valid) {
      try {
        await setLinkedToTab(tab);
      } catch {
        // ignore; if something races, banner/refresh will reflect actual state
      }
    }
  }

  async function init() {
    wireBannerButtons();

    // NEW: try to auto-link on initial load if we're already on a valid WFM page
    await autoLinkIfNeeded();

    await refreshBanner();

    // Re-check on focus/visibility changes
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden) {
        await autoLinkIfNeeded(); // NEW: try again if the user logged in just before focusing Hermes
        refreshBanner();
      }
    });
    window.addEventListener("focus", async () => {
      await autoLinkIfNeeded(); // NEW: same on focus
      refreshBanner();
    });

    // React to background changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (
        area === "session" &&
        (changes.hermesLinkedStatus ||
          changes.hermesLinkedTabId ||
          changes.hermesLinkedOrigin)
      ) {
        refreshBanner();
      }
    });

    // Lightweight heartbeat every X minutes (adjust as desired)
    setInterval(
      () => {
        ping().then(refreshBanner);
      },
      1 * 60 * 1000,
    );
  }

  init();

  return {
    getBaseUrl,
    relinkToCurrentTab,
    goToLinkedTab,
    ping,
  };
})();


// MAIN UI FUNCTIONS: API ACCESS CLIENT URL
// Populate API Access Client URL: 
async function populateClientUrlField() {
  try {
    const input = document.getElementById("client-url");
    if (!input) return;

    const base = await getClientUrl(); // e.g., https://tenant.mykronos.com/
    input.value = base ? toApiUrl(base) : ""; // -> https://tenant.mykronos.com/api
  } catch (e) {
    console.log("populateClientUrlField failed:", e);
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
    console.error(e);
    setButtonFailText(btn, "Refresh Failed");
  }
}

// Copy URL button
async function copyClientUrlClick() {
  const btn = document.getElementById("copy-client-url");
  try {
    const val = (document.getElementById("client-url") || {}).value || "";
    if (!val) {
      setButtonFailText(btn, "No URL to Copy");
      return;
    }

    // Use Clipboard API; fallback if needed
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(val);
    } else {
      // Fallback approach
      const ta = document.createElement("textarea");
      ta.value = val;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }

    setButtonTempText(btn, "URL Copied");
  } catch (e) {
    console.error("Copy failed:", e);
    setButtonFailText(btn, "Copy Failed");
  }
}



// MAIN UI FUNCTIONS: API ACCESS CLIENT ID
// Populate Client ID Box
async function populateClientID() {
  const clienturl = await getClientUrl();
  const clientIDBox = document.getElementById("client-id");
  console.log("Populating Client ID");

  if (!clienturl) {
    console.log("Client URL not detected.");
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
    clientIDBox.placeholder = "Enter Client ID"; // Reset placeholder
  }
}

// Save Client ID Button
async function saveClientIDClick() {
  console.log("Save Client ID button clicked.");

  if (!(await isValidSession())) {
    alert("Requires a valid ADP Workforce Manager session.");
    return;
  }

  const clienturl = await getClientUrl();
  if (!clienturl) {
    console.log("No client URL detected.");
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
  console.log("Client ID saved:", clientid);

  // Change button text to "Client ID Saved!" temporarily
  const button = document.getElementById("save-client-id");
  const originalText = button.textContent;

  button.textContent = "Client ID Saved!";
  button.disabled = true;

  setTimeout(() => {
    button.textContent = originalText;
    button.disabled = false;
  }, 2000); // 2-second delay
}



// MAIN UI FUNCTIONS: API ACCESS TOKEN
// Fetch Access Token From the Tokenurl and Update Clientdata
async function fetchToken() {
  console.log("Fetching token...");
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
  console.log(`Requesting token from: ${tokenurl}`);

  // Check if the current window is incognito
  chrome.windows.getCurrent({ populate: false }, async (window) => {
    if (window.incognito) {
      console.log(
        "Running in incognito mode. Using tab-based token retrieval...",
      );
      retrieveTokenViaNewTab(tokenurl);
    } else {
      console.log("Running in normal mode. Using fetch...");
      fetchTokenDirectly(tokenurl, clienturl, clientID);
    }
  });
}

// Fetch token using direct API call
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
    console.log("Token response:", result);

    processTokenResponse(result, clienturl, clientID, tokenurl);
  } catch (error) {
    console.log("Error fetching token:", error.message);
    alert(`Failed to fetch token: ${error.message}`);
  }
}

// Open new tab in incognito and scrape token
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
            console.log("Script injection failed:", chrome.runtime.lastError);
          } else {
            console.log("Script executed, processing token...");

            if (injectionResults && injectionResults[0].result) {
              console.log("Scraped token:", injectionResults[0].result);

              //Retrieve the existing client ID from storage
              const baseClientUrl = new URL(tokenurl).origin + "/";
              const storedData = await loadClientData();
              const existingClientID =
                storedData[baseClientUrl]?.clientid || "unknown-client";

              console.log("Using clientid:", existingClientID);

              // Pass the correct client ID instead of "incognito-client"
              processTokenResponse(
                injectionResults[0].result,
                baseClientUrl,
                existingClientID, // Use the stored client ID
                tokenurl,
              );
            } else {
              console.log("No token found on the page.");
              alert("Failed to retrieve token from the page.");
            }
          }

          // Close the tab
          chrome.tabs.remove(tab.id, () => {
            if (chrome.runtime.lastError) {
              console.log("Error closing tab:", chrome.runtime.lastError);
            } else {
              console.log("Tab closed successfully.");
            }
          });
        },
      );
    }, 1500); // Wait for 1.5 seconds to let the page load
  });
}

// Content script to extract token from page
function scrapeTokenFromPage() {
  try {
    const preElement = document.querySelector("pre"); // Assuming the token is inside a <pre> tag
    if (!preElement) return null;

    const jsonText = preElement.innerText;
    return JSON.parse(jsonText);
  } catch (error) {
    console.log("Error parsing token:", error);
    return null;
  }
}

// Process token response
async function processTokenResponse(result, tokenurl, clientID) {
  const { accessToken, refreshToken, expiresInSeconds } = result;

  if (!accessToken || !refreshToken || !expiresInSeconds) {
    console.log("Token response is missing required fields.");
    alert("Failed to fetch token: Invalid response.");
    return;
  }

  const currentDateTime = new Date();
  const accessTokenExpirationDateTime = new Date(
    currentDateTime.getTime() + expiresInSeconds * 1000,
  );
  const refreshTokenExpirationDateTime = new Date(
    currentDateTime.getTime() + 8 * 60 * 60 * 1000,
  ); // 8 hours

  // Extract the BASE URL instead of storing under the full token URL
  const baseClientUrl = new URL(tokenurl).origin + "/";

  const data = await loadClientData();
  data[baseClientUrl] = {
    ...(data[baseClientUrl] || {}), // Preserve existing data
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

  console.log(
    "Updating local storage under key:",
    baseClientUrl,
    data[baseClientUrl],
  );

  await saveClientData(data);

  // Verify data was stored correctly
  chrome.storage.local.get([storageKey], (result) => {
    console.log("Local storage after update:", result);
  });

  console.log("Token fetched and saved successfully.");
  populateAccessToken();
  populateRefreshToken();
  restoreTokenTimers();

  // Visual button feedback
  const button = document.getElementById("get-token");
  const originalText = button.textContent;
  button.textContent = "Token Retrieved!";
  button.disabled = true;

  setTimeout(() => {
    button.textContent = originalText;
    button.disabled = false;
  }, 2000);
}

// Stop access token timer
function stopAccessTokenTimer(timerBox) {
  if (accessTokenTimerInterval) {
    clearInterval(accessTokenTimerInterval);
    accessTokenTimerInterval = null;
    timerBox.textContent = "--:--"; // Reset the timer box
    console.log("Access Token Timer stopped");
  }

  // Clear timer from storage
  //chrome.storage.local.remove("accessTokenTimer");
}

// Start access Token timer
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
      console.log("Access Token Timer expired.");

      // Clear the remaining time in storage
      chrome.storage.local.remove("accessTokenTimer");
    } else {
      const minutes = Math.floor(remainingTime / 60);
      const seconds = remainingTime % 60;
      timerBox.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      remainingTime--;

      // Save the remaining time to storage
      chrome.storage.local.set({
        accessTokenTimer: remainingTime,
      });
    }
  };

  // Update the timer immediately and then every second
  updateTimer();
  accessTokenTimerInterval = setInterval(updateTimer, 1000);
}

// Populate access token box and start timer if token is valid
async function populateAccessToken() {
  console.log("Populating Access Token...");
  const clienturl = await getClientUrl();
  const accessTokenBox = document.getElementById("access-token");
  const timerBox = document.getElementById("timer");

  if (!clienturl) {
    console.log("Client URL not found.");
    accessTokenBox.value = "Requires WFMgr Login";
    timerBox.textContent = "--:--";
    return;
  }

  const data = await loadClientData();
  const currentDateTime = new Date();

  if (data[clienturl]?.accesstoken) {
    const expirationTime = new Date(data[clienturl].expirationdatetime);

    if (currentDateTime > expirationTime) {
      console.log("Access token has expired.");
      accessTokenBox.value = "Access Token Expired";
      timerBox.textContent = "--:--";
    } else {
      console.log("Access token is valid.");
      accessTokenBox.value = data[clienturl].accesstoken;

      // Calculate remaining time and start the timer
      const remainingSeconds = Math.floor(
        (expirationTime - currentDateTime) / 1000,
      );
      console.log(
        `Timer will start with ${remainingSeconds} seconds remaining.`,
      );
      startAccessTokenTimer(remainingSeconds, timerBox);
    }
  } else {
    console.log("No access token found.");
    accessTokenBox.value = "Get Token";
    timerBox.textContent = "--:--";
  }
}

// Copy Access Token Button
function copyAccessToken() {
  const accessTokenBox = document.getElementById("access-token");
  const accessToken = accessTokenBox?.value;

  // Validate Access Token before copying
  if (
    !accessToken ||
    accessToken === "Get Token" ||
    accessToken === "Access Token Expired"
  ) {
    console.log("No valid Access Token available to copy.");
    return;
  }

  // Copy token to clipboard
  navigator.clipboard
    .writeText(accessToken)
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
      console.log("Failed to copy Access Token:", error);
    });
}



// MAIN UI FUNCTIONS: API REFRESH TOKEN
// Toggle Refresh Token Options Visibility
function toggleRefreshTokenOptions() {
  const toggleButton = document.getElementById("toggle-refresh-token-options");
  const content = document.getElementById("refresh-token-options-content");
  const wrapper = content.parentElement;

  // Toggle expanded/collapsed state
  const isExpanded = content.classList.toggle("expanded");

  // Dynamically calculate the height
  if (isExpanded) {
    wrapper.style.height = `${content.scrollHeight + toggleButton.offsetHeight}px`; // Expand wrapper height
    toggleButton.textContent = "▲ Hide Refresh Token Options ▲";
  } else {
    wrapper.style.height = `${toggleButton.offsetHeight + 15}px`; // Shrink wrapper height (15px padding)
    toggleButton.textContent = "▼ Show Refresh Token Options ▼";
  }

  // Persist the state in local storage
  chrome.storage.local.set({ clientSecretRefreshExpanded: isExpanded });
}

// Restore refresh token options visibility on Load
function restoreRefreshTokenOptions() {
  chrome.storage.local.get("clientSecretRefreshExpanded", (result) => {
    const isExpanded = result.clientSecretRefreshExpanded || false;
    const toggleButton = document.getElementById(
      "toggle-refresh-token-options",
    );
    const content = document.getElementById("refresh-token-options-content");
    const wrapper = content.parentElement;

    // Set initial state based on stored value
    if (isExpanded) {
      content.classList.add("expanded");
      wrapper.style.height = `${content.scrollHeight + toggleButton.offsetHeight}px`; // Expanded height
      toggleButton.textContent = "▲ Hide Refresh Token Options ▲";
    } else {
      content.classList.remove("expanded");
      wrapper.style.height = `${toggleButton.offsetHeight + 15}px`; // Collapsed height
      toggleButton.textContent = "▼ Show Refresh Token Options ▼";
    }
  });
}

// Populate API access client secret box
async function populateClientSecret() {
  const clienturl = await getClientUrl();
  const clientSecretBox = document.getElementById("client-secret");
  console.log("Populating client secret.");

  if (!clienturl) {
    console.log("Client URL not detected.");
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

// Toggle API access client secret visibility
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
  console.log("Save Client Secret button clicked.");

  if (!(await isValidSession())) {
    alert("Requires a valid ADP Workforce Manager session.");
    return;
  }

  const clienturl = await getClientUrl();
  if (!clienturl) {
    console.log("No client URL detected.");
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
  console.log("Client Secret saved:", clientsecret);

  // Change button text to "Client Secret Saved!" temporarily
  const button = document.getElementById("save-client-secret");
  const originalText = button.textContent;

  button.textContent = "Client Secret Saved!";
  button.disabled = true;

  setTimeout(() => {
    button.textContent = originalText;
    button.disabled = false;
  }, 2000); // 2-second delay
}

// Start refresh token timer
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
        refreshTokenTimer: remainingTime,
      });
    }
  };

  updateTimer();
  refreshTokenTimerInterval = setInterval(updateTimer, 1000);
}

// Stop refresh token timer
function stopRefreshTokenTimer(timerBox) {
  if (refreshTokenTimerInterval) {
    clearInterval(refreshTokenTimerInterval);
    refreshTokenTimerInterval = null;
    timerBox.textContent = "--:--";
    console.log("Refresh Token Timer stopped.");
  }

  // Clear timer from storage
  //chrome.storage.local.remove("refreshTokenTimer");
}

// Populate refresh token box and start time if token is valid
async function populateRefreshToken() {
  console.log("Populating Refresh Token...");
  const clienturl = await getClientUrl();
  const refreshTokenBox = document.getElementById("refresh-token");
  const refreshTimerBox = document.getElementById("refresh-timer");

  if (!clienturl) {
    console.log("Client URL not found.");
    refreshTokenBox.value = "Requires WFMgr Login";
    refreshTimerBox.textContent = "--:--";
    return;
  }

  const data = await loadClientData();
  const currentDateTime = new Date();

  if (data[clienturl]?.refreshtoken) {
    const refreshExpirationTime = new Date(
      data[clienturl].refreshExpirationDateTime,
    );

    if (currentDateTime > refreshExpirationTime) {
      console.log("Refresh token has expired.");
      refreshTokenBox.value = "Refresh Token Expired";
      refreshTimerBox.textContent = "--:--";
    } else {
      console.log("Refresh token is valid.");
      refreshTokenBox.value = data[clienturl].refreshtoken;

      // Calculate remaining time and start the timer
      const remainingSeconds = Math.floor(
        (refreshExpirationTime - currentDateTime) / 1000,
      );
      console.log(
        `Refresh Timer will start with ${remainingSeconds} seconds remaining.`,
      );
      startRefreshTokenTimer(remainingSeconds, refreshTimerBox);
    }
  } else {
    console.log("No refresh token found.");
    refreshTokenBox.value = "Refresh Token";
    refreshTimerBox.textContent = "--:--";
  }
}

// Refresh Access Token Button
async function refreshAccessToken() {
  console.log("Refreshing Access Token...");
  const clienturl = await getClientUrl();
  if (!clienturl || !(await isValidSession())) {
    alert("Requires a valid ADP Workforce Manager session.");
    return;
  }

  const data = await loadClientData();
  const client = data[clienturl] || {};
  const { refreshtoken, clientid, clientsecret } = client;

  // Validate refresh token
  if (
    !refreshtoken ||
    refreshtoken === "Refresh Token" ||
    new Date() > new Date(client.refreshExpirationDateTime)
  ) {
    alert(
      "No valid Refresh Token found. Please retrieve an Access Token first.",
    );
    return;
  }

  // Validate client secret
  if (!clientsecret || clientsecret === "Enter Client Secret") {
    alert("Client Secret is required to refresh the Access Token.");
    return;
  }

  const apiurl = `${clienturl}api/authentication/access_token`;

  try {
    console.log(`Requesting new access token via refresh token at: ${apiurl}`);

    // Make API POST request
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
      throw new Error(
        `Failed to refresh access token. HTTP status: ${response.status}`,
      );
    }

    // Parse response
    const result = await response.json();
    console.log("Refresh Token response:", result);

    const { access_token, expires_in } = result;
    if (!access_token || !expires_in) {
      throw new Error(
        "Response is missing required fields: 'access_token' or 'expires_in'.",
      );
    }

    // Calculate expiration time
    const currentDateTime = new Date();
    const accessTokenExpirationDateTime = new Date(
      currentDateTime.getTime() + expires_in * 1000,
    );

    // Update local storage
    data[clienturl] = {
      ...client,
      accesstoken: access_token,
      expirationdatetime: accessTokenExpirationDateTime.toISOString(),
      editdatetime: currentDateTime.toISOString(),
    };

    await saveClientData(data);

    // Update the UI
    console.log("Access Token refreshed and saved successfully.");
    populateAccessToken();
    restoreTokenTimers();

    // Visual feedback: Change button text temporarily
    const button = document.getElementById("refresh-access-token");
    const originalText = button.textContent;

    button.textContent = "Token Refreshed!";
    button.disabled = true; // Temporarily disable the button

    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false; // Re-enable the button
    }, 2000); // 2-second delay
  } catch (error) {
    console.log("Error refreshing access token:", error.message);
    alert(`Failed to refresh access token: ${error.message}`);
  }
}

// Copy Refresh Token Button
function copyRefreshToken() {
  const refreshTokenBox = document.getElementById("refresh-token");
  const refreshToken = refreshTokenBox?.value;

  // Validate Refresh Token before copying
  if (
    !refreshToken ||
    refreshToken === "Refresh Token" ||
    refreshToken === "Refresh Token Expired"
  ) {
    console.log("No valid Refresh Token available to copy.");
    return;
  }

  // Copy refresh token to clipboard
  navigator.clipboard
    .writeText(refreshToken)
    .then(() => {
      // Visual feedback: Change button text
      const button = document.getElementById("copy-refresh-token");
      const originalText = button.textContent;

      button.textContent = "Copied!";
      button.disabled = true; // Disable temporarily

      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false; // Re-enable
      }, 2000);
    })
    .catch((error) => {
      console.log("Failed to copy Refresh Token:", error);
    });
}



// MAIN UI FUNCTIONS: API LIBRARY
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

// Restore API library visibility on Load
function restoreApiLibrary() {
  chrome.storage.local.get("apiLibraryExpanded", (result) => {
    const isExpanded = result.apiLibraryExpanded || false;
    const toggleButton = document.getElementById("toggle-api-library");
    const content = document.getElementById("api-library-content");
    const wrapper = content.parentElement;

    // Set initial state based on stored value
    if (isExpanded) {
      content.classList.add("expanded");
      wrapper.style.height = `${content.scrollHeight + toggleButton.offsetHeight}px`; // Expanded height
      toggleButton.textContent = "▲ Hide API Library ▲";
    } else {
      content.classList.remove("expanded");
      wrapper.style.height = `${toggleButton.offsetHeight + 15}px`; // Collapsed height
      toggleButton.textContent = "▼ Show API Library ▼";
    }
  });
}

// Load API library dropdown selector from /apilibrary/apilibrary.json
async function loadApiLibrary() {
  try {
    const response = await fetch("apilibrary/apilibrary.json");
    if (!response.ok)
      throw new Error(`Failed to load API Library: ${response.status}`);
    const apiLibraryData = await response.json();
    //console.log("API Library loaded:", apiLibraryData);
    return apiLibraryData.apiLibrary;
  } catch (error) {
    console.log("Error loading API Library:", error);
    return {};
  }
}

// Populate API library dropdown selector
async function populateApiDropdown() {
  try {
    const response = await fetch("apilibrary/apilibrary.json");
    if (!response.ok)
      throw new Error(
        `Failed to fetch API library. HTTP status: ${response.status}`,
      );
    const apiLibraryData = await response.json();
    //console.log("API Library loaded:", apiLibraryData);

    const apiDropdown = document.getElementById("api-selector");
    if (!apiDropdown) {
      console.log("API dropdown element not found.");
      return;
    }

    // Clear existing options in the dropdown
    apiDropdown.innerHTML =
      '<option value="" disabled selected>Select API...</option>';

    const apiLibrary = apiLibraryData.apiLibrary;
    for (const apiKey in apiLibrary) {
      // Skip keys that start with an underscore
      if (apiKey.startsWith("_")) continue;

      const api = apiLibrary[apiKey];
      const option = document.createElement("option");
      option.value = apiKey; // Use the key as the value
      option.textContent = api.name; // Display the name in the dropdown
      apiDropdown.appendChild(option);
    }

    //console.log("API Dropdown populated successfully.");
  } catch (error) {
    console.log("Error populating API dropdown:", error);
  }
}

// Clear existing loaded parameters
function clearParameters() {
  const queryContainer = document.getElementById("query-parameters-container");
  const bodyContainer = document.getElementById("body-parameters-container");

  if (queryContainer) {
    queryContainer.innerHTML = ""; // Clear query parameters
  }
  if (bodyContainer) {
    bodyContainer.innerHTML = ""; // Clear body parameters
  }

  //console.log("API Parameters cleared successfully.");
}

// Populate query parameters from selected API
async function populateQueryParameters(selectedApiKey) {
  try {
    const apiLibrary = await loadApiLibrary(); // Load the API library
    const selectedApi = apiLibrary[selectedApiKey];

    if (!selectedApi) {
      //console.log("Selected API not found in the library.");
      return;
    }

    const queryContainer = document.getElementById(
      "query-parameters-container",
    );
    queryContainer.innerHTML = ""; // Clear existing parameters

    // Handle ad-hoc requests
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
      return; // Skip further processing for ad-hoc requests
    }

    // Default behavior for regular APIs
    const queryHeader = document.createElement("div");
    queryHeader.className = "parameter-header";
    queryHeader.textContent = "Query Parameters";
    queryContainer.appendChild(queryHeader);

    // Add Help Text if Available (No impact on logic)
    if (selectedApi.queryParametersHelp) {
      const queryHelpText = document.createElement("p");
      queryHelpText.className = "parameter-help-text"; // Uses existing CSS
      queryHelpText.textContent = selectedApi.queryParametersHelp;
      queryContainer.appendChild(queryHelpText);
    }

    if (
      !selectedApi.queryParameters ||
      selectedApi.queryParameters.length === 0
    ) {
      //console.log("No query parameters for this API.");
      return;
    }

    selectedApi.queryParameters.forEach((param) => {
      const paramWrapper = document.createElement("div");
      paramWrapper.classList.add("query-param-wrapper");

      const label = document.createElement("label");
      label.textContent = `${param.name}:`;
      label.setAttribute("for", `query-${param.name}`);
      paramWrapper.appendChild(label);

      let input; // Declare input variable

      if (param.type === "select") {
        input = document.createElement("select");
        input.classList.add("query-param-input");

        // Create the placeholder option
        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = param.description || "Select an option";
        placeholderOption.disabled = true;
        placeholderOption.selected = true; // Ensure it's selected initially
        input.appendChild(placeholderOption);

        // Add actual options
        param.options.forEach((option) => {
          const optionElement = document.createElement("option");
          optionElement.value = option;
          optionElement.textContent = option;
          input.appendChild(optionElement);
        });

        // Apply class for styling when placeholder is selected
        input.classList.add("placeholder"); // Initially gray

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

        if (
          typeof param.defaultValue === "string" &&
          /^[+-]?\d+$/.test(param.defaultValue)
        ) {
          // Convert relative days (e.g., "-10", "+5") to actual date
          const daysOffset = parseInt(param.defaultValue, 10);
          const calculatedDate = new Date();
          calculatedDate.setDate(calculatedDate.getDate() + daysOffset);
          input.value = calculatedDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD
        } else if (param.defaultValue) {
          input.value = param.defaultValue; // Use fixed date if provided
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

    //console.log("Query parameters populated successfully.");
  } catch (error) {
    console.log("Error populating query parameters:", error);
  }
}

// Populate body parameters from selected API
async function populateBodyParameters(selectedApiKey) {
  try {
    const apiLibrary = await loadApiLibrary();
    const selectedApi = apiLibrary[selectedApiKey];

    const bodyParamContainer = document.getElementById(
      "body-parameters-container",
    );
    if (!bodyParamContainer) {
      console.log("Body Parameters container not found.");
      return;
    }

    // Clear existing body parameters
    bodyParamContainer.innerHTML = "";

    // For adHoc POST requests, show a resizable textarea
    if (selectedApiKey === "adHocPost") {
      const bodyHeader = document.createElement("div");
      bodyHeader.className = "parameter-header";
      bodyHeader.textContent = "Full JSON Body";
      bodyParamContainer.appendChild(bodyHeader);

      const textarea = document.createElement("textarea");
      textarea.id = "adhoc-body";
      textarea.className = "json-textarea"; // Custom style for resizing
      textarea.placeholder = "Enter full JSON body here...";
      bodyParamContainer.appendChild(textarea);

      //console.log("Body Parameters populated for adHoc POST request.");
      return;
    }

    // Skip rendering body parameters for GET requests
    if (selectedApi.method === "GET") {
      //console.log("No Body Parameters needed for GET requests.");
      return;
    }

    // For regular POST requests, add a header
    if (!selectedApi || !selectedApi.bodyParameters) {
      //console.log("No body parameters found for the selected API.");
      return;
    }

    const bodyHeader = document.createElement("div");
    bodyHeader.className = "parameter-header";
    bodyHeader.textContent = "Body Parameters";
    bodyParamContainer.appendChild(bodyHeader);

    // Add Help Text if Available (No impact on logic)
    if (selectedApi.bodyParametersHelp) {
      const bodyHelpText = document.createElement("p");
      bodyHelpText.className = "parameter-help-text"; // Uses existing CSS
      bodyHelpText.textContent = selectedApi.bodyParametersHelp;
      bodyParamContainer.appendChild(bodyHelpText);
    }

    // Generate body parameter inputs for regular POST APIs
    selectedApi.bodyParameters.forEach((param) => {
      const paramWrapper = document.createElement("div");
      paramWrapper.className = "body-param-wrapper";

      let labelText = param.name;

      // Append maxEntered value for multi-text fields
      if (param.type === "multi-text" && param.validation?.maxEntered) {
        labelText += ` (max = ${param.validation.maxEntered})`;
      }

      const label = document.createElement("label");
      label.htmlFor = `body-param-${param.name}`;
      label.textContent = labelText;
      label.className = "body-param-label";
      paramWrapper.appendChild(label);

      let input;

      // Handle different parameter types
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

        // Placeholder option
        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = param.description || "Select an option";
        placeholderOption.disabled = true;
        placeholderOption.selected = true;
        placeholderOption.hidden = true;
        input.appendChild(placeholderOption);

        // Add actual options
        param.options.forEach((option) => {
          const optionElement = document.createElement("option");
          optionElement.value = option;
          optionElement.textContent = option;
          input.appendChild(optionElement);
        });

        // Set the default value properly
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

        // Handle placeholders & default values correctly
        if (param.type === "date") {
          if (param.defaultValue === "") {
            input.placeholder = param.description || "mm/dd/yyyy"; // Gray text
            input.classList.add("placeholder-style"); // Ensure styling for placeholder text
          } else if (
            typeof param.defaultValue === "string" &&
            /^[+-]?\d+$/.test(param.defaultValue)
          ) {
            // Convert relative days (e.g., "-10", "+5") to actual date
            const daysOffset = parseInt(param.defaultValue, 10);
            const calculatedDate = new Date();
            calculatedDate.setDate(calculatedDate.getDate() + daysOffset);
            input.value = calculatedDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD
          } else {
            input.value = param.defaultValue; // Use fixed date if provided
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

    //console.log("Body parameters populated successfully for regular POST request.");
  } catch (error) {
    console.log("Error populating Body Parameters:", error);
  }
}

// Stylizes ad-hoc APIs
function applyDynamicStyles() {
  // Get dynamically generated elements
  const endpointInput = document.getElementById("adhoc-endpoint");
  const bodyTextarea = document.getElementById("adhoc-body");

  // Add classes if necessary (ensure styles match CSS selectors)
  if (endpointInput) {
    endpointInput.classList.add("query-param-input");
  }

  if (bodyTextarea) {
    bodyTextarea.classList.add("json-textarea");
  }
}

// Map user parameter inputs into the request body
function mapUserInputsToRequestProfile(profileTemplate, inputs) {
  console.log("Mapping user inputs to request profile...");
  inputs.forEach((input) => {
    const { path, type } = input.dataset;
    const value = input.value;
    //console.log(`Processing Input - Path: ${path}, Type: ${type}, Value: ${value}`);

    if (!path) return;

    const keys = path.split(".");
    let ref = profileTemplate;

    // Navigate to the appropriate location in the JSON structure
    for (let i = 0; i < keys.length - 1; i++) {
      if (!ref[keys[i]]) ref[keys[i]] = {}; // Create the key if it doesn't exist
      ref = ref[keys[i]];
    }

    const lastKey = keys[keys.length - 1];

    // Handle different parameter types
    if (type === "boolean") {
      // Convert "true"/"false" strings to actual boolean
      ref[lastKey] = value === "true";
    } else if (type === "multi-select") {
      // Collect all selected checkboxes
      const selectedOptions = Array.from(
        document.querySelectorAll(`[data-path="${path}"]:checked`),
      ).map((checkbox) => checkbox.value);
      ref[lastKey] = selectedOptions; // Assign the selected options as an array
    } else if (type === "multi-text") {
      // Collect all text inputs in the container
      const multiTextValues = Array.from(
        document.querySelectorAll(`[data-path="${path}"]`),
      ).map((textInput) => textInput.value.trim());
      ref[lastKey] = multiTextValues.filter((val) => val !== ""); // Remove empty values
    } else if (type === "date") {
      // Assign date as-is
      ref[lastKey] = value;
    } else {
      // Default behavior for text/select
      ref[lastKey] = value;
    }

    //console.log(`Mapped Value - Path: ${path}, Final Value:`, ref[lastKey]);
  });
}

// Wait for fresh access token if current is not valid
async function waitForUpdatedToken(clienturl, maxRetries = 5, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs)); // Wait for storage update
    let updatedData = await loadClientData();
    let updatedClientData = updatedData[clienturl] || {};

    if (updatedClientData.accesstoken) {
      console.log("New access token retrieved:", updatedClientData.accesstoken);
      return updatedClientData;
    }

    console.log(`Retry ${i + 1}/${maxRetries}: Token not available yet...`);
  }

  throw new Error(
    "Failed to retrieve updated access token after multiple attempts.",
  );
}

// Clear any previous API response field for new response
function clearApiResponse() {
  const responseSection = document.getElementById("response-section");
  if (responseSection) {
    responseSection.innerHTML = "<pre>Awaiting API Response...</pre>";
  }
}

// Send Request Button (execute API call with multi-call support)
async function executeApiCall() {
  const button = document.getElementById("execute-api");
  const originalText = button.textContent;
  let animationInterval;
  let rotationAngle = 0;

  try {
    clearApiResponse();
    console.log("Executing API call...");

    const hourglassFrames = ["⏳", "⌛"];
    let frameIndex = 0;

    button.innerHTML = `Waiting... <span class="hourglass">${hourglassFrames[frameIndex]}</span>`;
    button.disabled = true;
    const hourglassSpan = button.querySelector(".hourglass");
    hourglassSpan.style.display = "inline-block";

    animationInterval = setInterval(() => {
      frameIndex = (frameIndex + 1) % hourglassFrames.length;
      rotationAngle += 30;
      hourglassSpan.textContent = hourglassFrames[frameIndex];
      hourglassSpan.style.transform = `rotate(${rotationAngle}deg)`;
    }, 100);

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

    if (
      !clientData.accesstoken ||
      new Date(clientData.expirationdatetime) < new Date()
    ) {
      console.log("Access token expired or missing. Fetching a new token...");
      await fetchToken();
      clientData = await waitForUpdatedToken(clienturl);
    }

    const accessToken = clientData.accesstoken;
    let fullUrl = clientData.apiurl + selectedApi.url;
    let requestBody = null;

    // Handle Query Parameters for Standard GET Requests
    if (selectedApi.method === "GET") {
      const queryParams = new URLSearchParams();
      const queryInputs = document.querySelectorAll(
        "#query-parameters-container .query-param-input",
      );

      queryInputs.forEach((input) => {
        if (
          input.value.trim() !== "" &&
          input.value.trim() !== input.placeholder
        ) {
          queryParams.append(
            input.id.replace("query-", ""),
            input.value.trim(),
          );
        }
      });

      if (queryParams.toString()) {
        fullUrl += "?" + queryParams.toString();
      }
    }

    // Handle Ad-Hoc Requests
    if (selectedApiKey === "adHocGet" || selectedApiKey === "adHocPost") {
      const endpointInput = document.getElementById("adhoc-endpoint");
      if (!endpointInput || !endpointInput.value.trim()) {
        alert("Please provide an endpoint URL.");
        throw new Error("Empty ad-hoc endpoint");
      }
      fullUrl = clientData.apiurl + endpointInput.value.trim();
    }

    // Handle Pre-Request Logic (If Needed)
    if (selectedApi.preRequest) {
      console.log(`Executing pre-request: ${selectedApi.preRequest.apiKey}`);

      const preRequestApi = apiLibrary[selectedApi.preRequest.apiKey];
      const preRequestUrl = clientData.apiurl + preRequestApi.url;

      const preResponse = await fetch(preRequestUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!preResponse.ok) {
        const errorText = await preResponse.text();
        displayApiResponse(
          {
            error: errorText,
          },
          selectedApiKey,
        );
        throw new Error(
          `Pre-request failed. HTTP status: ${preResponse.status}`,
        );
      }

      const preResult = await preResponse.json();
      console.log("Pre-request Response:", preResult);

      const {
        field,
        match,
        mapTo,
        ["data-path"]: dataPath,
      } = selectedApi.preRequest.responseFilter;
      let mappedValues = preResult
        .filter((item) => item[field] === match)
        .map((item) => item[mapTo]);

      const maxLimit =
        selectedApi.bodyParameters.find((p) => p.name === "qualifiers")
          ?.validation?.maxEntered || 1000;
      if (mappedValues.length > maxLimit) {
        alert(
          `Only the first ${maxLimit} entries will be used due to API limitations.`,
        );
        mappedValues = mappedValues.slice(0, maxLimit);
      }

      console.log("Mapped Values (Limited):", mappedValues);

      // Dynamically insert mapped values into requestBody using the correct dataPath
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
      // Handle Request Body for Regular POST APIs
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
          const profileTemplate = JSON.parse(
            JSON.stringify(selectedApi.requestProfile),
          );
          const bodyParamsContainer = document.getElementById(
            "body-parameters-container",
          );
          const paramInputs = Array.from(
            bodyParamsContainer.querySelectorAll("[data-path]"),
          );

          mapUserInputsToRequestProfile(profileTemplate, paramInputs);
          requestBody = profileTemplate;
        }
      }
    }

    console.log("Final Request Body:", JSON.stringify(requestBody, null, 2));

    // Save request details for the Request Details button
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
        error: responseText,
      };
    }

    //console.log("API Response:", result);
    displayApiResponse(result, selectedApiKey);

    button.textContent = response.ok ? "Success!" : "Failed!";
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 2000);
  } catch (error) {
    console.log("Error executing API call:", error);
    alert(`API call failed: ${error.message}`);
    displayApiResponse(
      {
        error: error.message,
      },
      "Error",
    );

    button.textContent = "Failed!";
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 2000);
  }
}

// Display API response in UI
async function displayApiResponse(response, apiKey) {
  const responseSection = document.getElementById("response-section");

  // Preserve the "Popout Response" button if it exists
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

  // Load API library
  const apiLibrary = await loadApiLibrary();

  //console.log("Raw API Key from executeApiCall:", apiKey);
  //console.log("Available API Keys in Library:", Object.keys(apiLibrary));

  // Retrieve API object using the actual key
  const selectedApi = apiLibrary[apiKey];

  if (!selectedApi) {
    console.log("API Key Not Found in Library:", apiKey);
  } else {
    //console.log("Retrieved API Object:", selectedApi);
    //console.log("Checking ExportMap for:", apiKey, selectedApi?.exportMap);
  }

  // Export CSV button logic
  if (selectedApi?.exportMap) {
    //console.log("ExportMap detected, attempting to create Export CSV button...");

    let exportCsvButton = document.getElementById("export-api-csv"); // Correct
    if (!exportCsvButton) {
      //console.log("Creating Export CSV button..."); // 🔍 Log before creation

      exportCsvButton = document.createElement("button");
      exportCsvButton.id = "export-api-csv"; // Unique ID for API responses

      exportCsvButton.className = "btn3";
      exportCsvButton.innerHTML = `
				Export CSV
				<img src="icons/export-csv.png" alt="CSV" class="btn-icon">
			`;

      exportCsvButton.addEventListener("click", () => {
        //console.log("Export CSV button clicked!"); // 🔍 Log when clicked
        exportApiResponseToCSV(response, selectedApi.exportMap, apiKey);
      });

      // Append to the right of the Popout button
      responseSection.appendChild(exportCsvButton);
      //console.log("Export CSV button added to the UI.");
    } else {
      //console.log("Export CSV button already exists.");
    }
  }

  // Ensure response always displays
  const existingPre = responseSection.querySelector("pre");
  if (existingPre) {
    existingPre.remove();
  }

  const responsePre = document.createElement("pre");
  responsePre.textContent = JSON.stringify(response, null, 2);
  responseSection.appendChild(responsePre);

  // Enable and update the Download Response button
  const downloadButton = document.getElementById("download-response");
  downloadButton.disabled = false;
  downloadButton.onclick = () => downloadApiResponse(response, apiKey);
}

// View Request Details Button (display in popup html)
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

// Download API Response Button
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

      // Write file content
      const writableStream = await fileHandle.createWritable();
      await writableStream.write(JSON.stringify(response, null, 2));
      await writableStream.close();

      //console.log("File successfully saved.");
    } catch (error) {
      if (error.name !== "AbortError") {
        console.log("Error saving file:", error);
        alert("Failed to save the file.");
      }
    }
  } else {
    // Fallback: Trigger file download using Blob and anchor element
    console.log("File System Access API not supported, using fallback method.");

    const blob = new Blob([JSON.stringify(response, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultFileName;
    a.click();
    URL.revokeObjectURL(url);

    console.log("File downloaded using fallback method.");
  }
}

// Copy API Response Button
function copyApiResponse() {
  const responseSection = document.getElementById("response-section");

  // Find the first <pre> or <code> block that contains the JSON response
  const jsonElement = responseSection?.querySelector("pre, code");

  if (jsonElement) {
    const responseContent = jsonElement.innerText.trim();

    if (responseContent) {
      navigator.clipboard
        .writeText(responseContent)
        .then(() => {
          // Visual feedback: Change button text
          const button = document.getElementById("copy-api-response");
          const originalText = button.textContent;

          button.textContent = "Copied!";
          button.disabled = true; // Disable temporarily

          setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false; // Re-enable
          }, 2000);
        })
        .catch((err) => {
          console.log("Failed to copy API response:", err);
        });
    } else {
      console.log("No valid JSON response found.");
    }
  } else {
    console.log("No API Response exists. Send a request first.");
  }
}

// Popout API Response Button (dynamic: display in popup html)
function popoutResponse() {
  const responseSection = document.getElementById("response-section");
  const responseContent = responseSection
    ?.querySelector("pre")
    ?.innerText?.trim();

  if (
    !responseContent ||
    responseContent === "Awaiting API Send Request & Response..."
  ) {
    const noResponseHtml = `
            <html>
            <head>
                <title>No Response</title>
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
                <h1>No response available.</h1>
                <p>Please send an API request to generate a response.</p>
            </body>
            </html>
        `;

    const noResponseWindow = window.open("", "_blank", "width=400,height=300");
    noResponseWindow.document.write(noResponseHtml);
    noResponseWindow.document.close();
    return;
  }

  const responseHtml = `
        <html>
        <head>
            <title>API Response</title>
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
            <h1>API Response</h1>
            <pre>${responseContent}</pre>
        </body>
        </html>
    `;

  const responseWindow = window.open("", "_blank", "width=600,height=800");
  responseWindow.document.write(responseHtml);
  responseWindow.document.close();
}

// Export to CSV Button (dynamic)
async function exportApiResponseToCSV(response, apiKey) {
  //console.log("Exporting API Response to CSV...");
  //console.log("API Key Received for Export:", apiKey);
  //console.log("Full API Response:", response);

  if (!response || (Array.isArray(response) && response.length === 0)) {
    alert("No data available to export.");
    return;
  }

  // Extract array if the response is an object with a nested array
  let extractedArray = response;
  if (!Array.isArray(response)) {
    for (const key in response) {
      if (Array.isArray(response[key])) {
        extractedArray = response[key];
        //console.log(`Extracted nested array from key: ${key}`);
        break;
      }
    }
  }

  if (!Array.isArray(extractedArray) || extractedArray.length === 0) {
    alert("No valid array data found for export.");
    return;
  }

  // Load API Library
  const apiLibrary = await loadApiLibrary();
  //console.log("Loaded API Library for Validation:", apiLibrary);

  // Set the file name based on the API key
  const safeApiName = apiKey ? apiKey : "api-response"; // Ensure safe fallback
  //console.log("CSV File Name Will Be:", safeApiName);

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

  // **Flatten Each Object in the Array**
  extractedArray.forEach((item) => {
    const { flatRow, arrayFields } = flattenObject(item);
    const maxRows = Math.max(
      ...Object.values(arrayFields).map((arr) => arr.length),
      1,
    );

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

  // Remove Empty Columns
  expandedHeaders = Array.from(expandedHeaders);
  const columnsWithData = expandedHeaders.filter((header) =>
    expandedData.some((row) => row[header] !== "" && row[header] !== undefined),
  );

  //console.log("Final CSV Headers (After Cleanup):", columnsWithData);

  //const csvRows = [columnsWithData.join(",")];
  const csvRows = [`"${columnsWithData.join('","')}"`];

  expandedData.forEach((row) => {
    const rowData = columnsWithData.map(
      (header) => `"${row[header] !== undefined ? row[header] : ""}"`,
    );
    csvRows.push(rowData.join(","));
  });

  //console.log("Final CSV Data:\n", csvRows.join("\n"));

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


// EVENT LISTENERS
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
  document.getElementById("view-client-data").addEventListener("click", async () => {
      await viewClientData();
    });
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

  document.getElementById("api-selector").addEventListener("change", (event) => {
      const selectedApiKey = event.target.value;
      clearApiResponse();
      clearParameters();
      populateQueryParameters(selectedApiKey); // Populate query parameters
      populateBodyParameters(selectedApiKey); // For body parameters
      applyDynamicStyles();
    });

  document.getElementById("execute-api").addEventListener("click", executeApiCall);
  document.getElementById("copy-api-response").addEventListener("click", copyApiResponse);
  document.getElementById("view-request-details").addEventListener("click", showRequestDetails);

  const popoutResponseButton = document.getElementById("popout-response");
  if (popoutResponseButton) {
    popoutResponseButton.addEventListener("click", popoutResponse);
  }
});