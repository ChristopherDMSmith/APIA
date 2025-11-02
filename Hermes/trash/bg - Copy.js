// scripts/bg.js: Background service for Hermes extension UI console.log("");

// GLOBALS
let HERMES_GLOBAL_OPEN = false;
const WFM_REGEX = /:\/\/.*\.mykronos\.com\//i;


chrome.runtime.onStartup?.addListener(async () => {
  try {
    const { hermesGlobalOpen } =
      await chrome.storage.session.get("hermesGlobalOpen");
    HERMES_GLOBAL_OPEN = !!hermesGlobalOpen;
  } catch {}
});


function isValidWfmSessionUrl(url) {
  if (!url) return false;
  if (!/mykronos\.com/i.test(url)) return false; // must be on mykronos.com
  if (/mykronos\.com\/authn\//i.test(url)) return false; // must NOT be on /authn/
  if (/:\/\/adp-developer\.mykronos\.com\//i.test(url)) return false; // must NOT be the Developer Portal
  return true;
}


function isWfmUrl(url) {
  return !!url && WFM_REGEX.test(url);
}


function getOrigin(u) {
  try {
    const url = new URL(u);
    return url.origin; // e.g., https://tenant.mykronos.com
  } catch {
    return null;
  }
}


async function setLinkedContext(tab) {
  if (!tab?.id || !isValidWfmSessionUrl(tab.url)) return;

  const payload = {
    hermesLinkedTabId: tab.id,
    hermesLinkedUrl: tab.url,
    hermesLinkedOrigin: getOrigin(tab.url),
    hermesLinkedTitle: tab.title || "",
    hermesLinkedStatus: "ok", // ok | stale | closed
  };
  await chrome.storage.session.set(payload);
}


async function clearLinkedContext(reason = "closed") {
  await chrome.storage.session.set({
    hermesLinkedTabId: null,
    hermesLinkedUrl: null,
    hermesLinkedOrigin: null,
    hermesLinkedTitle: "",
    hermesLinkedStatus: reason, // stale|closed
  });
}


async function setSidePanelEnabledForAll(enabled) {
  const tabs = await chrome.tabs.query({});
  const ops = tabs.map((t) =>
    chrome.sidePanel
      .setOptions({ tabId: t.id, path: "hermes.html", enabled })
      .catch(() => {}),
  );
  await Promise.all(ops);
}


async function getGlobalOpen() {
  const { hermesGlobalOpen } =
    await chrome.storage.session.get("hermesGlobalOpen");
  return !!hermesGlobalOpen;
}


async function setGlobalOpen(value) {
  await chrome.storage.session.set({ hermesGlobalOpen: !!value });
}


// Open side panel on toolbar click; if current tab is WFM, link to it.
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  if (HERMES_GLOBAL_OPEN) {
    // CLOSE EVERYWHERE (no awaits)
    setSidePanelEnabledForAll(false).catch(() => {});
    HERMES_GLOBAL_OPEN = false;
    chrome.storage.session.set({ hermesGlobalOpen: false }).catch(() => {});
    return;
  }

  // OPEN path:
  // 1) Ensure the current tab’s panel is enabled (don’t await)
  chrome.sidePanel
    .setOptions({ tabId: tab.id, path: "hermes.html", enabled: true })
    .catch(() => {});

  // 2) Call open() immediately while still in the user gesture
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});

  // 3) Enable for all tabs so it persists across tab switches
  setSidePanelEnabledForAll(true).catch(() => {});

  // 4) Flip caches
  HERMES_GLOBAL_OPEN = true;
  chrome.storage.session.set({ hermesGlobalOpen: true }).catch(() => {});

  // 5) (Optional) link if this tab is a valid WFM session — do it after open
  try {
    if (isValidWfmSessionUrl(tab.url)) {
      setLinkedContext(tab);
    } else if (/mykronos\.com\/authn\//i.test(tab?.url || "")) {
      chrome.storage.session.set({ hermesLinkedStatus: "stale" });
    }
  } catch {}
});


chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Ensure per-tab enabled state follows the global toggle
  try {
    const isOpen = await getGlobalOpen();
    await chrome.sidePanel.setOptions({
      tabId,
      path: "hermes.html",
      enabled: isOpen,
    });
  } catch {}

  // Existing linked-tab tracking
  try {
    const { hermesLinkedTabId } =
      await chrome.storage.session.get("hermesLinkedTabId");
    if (!hermesLinkedTabId || tabId !== hermesLinkedTabId) return;

    if (changeInfo.url) {
      if (isValidWfmSessionUrl(changeInfo.url)) {
        await setLinkedContext({
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
  } catch {}
});


// 3) If the linked tab is closed, clear the context.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const { hermesLinkedTabId } =
      await chrome.storage.session.get("hermesLinkedTabId");
    if (hermesLinkedTabId && tabId === hermesLinkedTabId) {
      await clearLinkedContext("closed");
    }
  } catch {
    /* ignore */
  }
});









