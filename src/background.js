const DEFAULT_OPTIONS = {
  includeFrames: true,
  inlineImages: true,
  inlineStyles: true,
  removeScripts: true,
  includeMetadata: true,
  filenameTemplate: "{title}-{date}.html",
  autoSave: false
};

const MENU_IDS = {
  savePage: "save-pagevault-page",
  saveSelection: "save-pagevault-selection",
  saveLink: "save-pagevault-link",
  saveAllTabs: "save-pagevault-all-tabs",
  autoSave: "save-pagevault-auto-save"
};

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  const savedOptions = await chrome.storage.sync.get(DEFAULT_OPTIONS);
  const options = { ...DEFAULT_OPTIONS, ...savedOptions };
  await chrome.storage.sync.set(options);
  createContextMenus(options);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_IDS.savePage && tab?.id) {
    await saveTab(tab.id, { quiet: true, mode: "page" });
  }
  if (info.menuItemId === MENU_IDS.saveSelection && tab?.id) {
    await saveTab(tab.id, { quiet: true, mode: "selection" });
  }
  if (info.menuItemId === MENU_IDS.saveLink && info.linkUrl) {
    await saveLinkedPage(info.linkUrl);
  }
  if (info.menuItemId === MENU_IDS.saveAllTabs) {
    await saveCurrentWindowTabs();
  }
  if (info.menuItemId === MENU_IDS.autoSave) {
    await setAutoSave(Boolean(info.checked));
  }
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== "save-current-page") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await saveTab(tab.id, { quiet: true, mode: "page" });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }

  const options = await chrome.storage.sync.get(DEFAULT_OPTIONS);
  if (options.autoSave) {
    await saveTab(tabId, { quiet: true, mode: "page" });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const knownTypes = new Set([
    "save-active-tab",
    "save-selection",
    "save-all-tabs",
    "get-options",
    "set-auto-save"
  ]);

  if (!knownTypes.has(message?.type)) {
    return false;
  }

  (async () => {
    if (message.type === "get-options") {
      sendResponse({ ok: true, options: await chrome.storage.sync.get(DEFAULT_OPTIONS) });
      return;
    }

    if (message.type === "set-auto-save") {
      await setAutoSave(Boolean(message.autoSave));
      sendResponse({ ok: true, autoSave: Boolean(message.autoSave) });
      return;
    }

    if (message.type === "save-all-tabs") {
      sendResponse({ ok: true, result: await saveCurrentWindowTabs() });
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab was found.");
    }

    const result = await saveTab(tab.id, {
      quiet: false,
      mode: message.type === "save-selection" ? "selection" : "page"
    });
    sendResponse({ ok: true, result });
  })().catch(error => {
    sendResponse({ ok: false, error: formatError(error) });
  });

  return true;
});

async function saveTab(tabId, { quiet, mode = "page" }) {
  try {
    const tab = await chrome.tabs.get(tabId);
    assertCaptureAllowed(tab.url);

    await setBadge(tabId, "...", "#2563eb");
    await chrome.scripting.executeScript({
      target: { tabId },
      func: captureMode => {
        globalThis.__PAGEVAULT_CAPTURE_MODE = captureMode;
      },
      args: [mode]
    });

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/capture.js"]
    });

    const result = injection?.result;
    if (!result?.ok) {
      throw new Error(result?.error || "The page could not be captured.");
    }

    const downloadId = await downloadArchive(result);
    await setBadge(tabId, "OK", "#15803d");
    return { ...result, downloadId, html: undefined };
  } catch (error) {
    await setBadge(tabId, "ERR", "#b91c1c").catch(() => {});
    if (!quiet) {
      throw error;
    }
    console.info(formatError(error));
    return { ok: false, error: formatError(error) };
  } finally {
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }), 1800);
  }
}

async function saveCurrentWindowTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const results = [];

  for (const tab of tabs) {
    if (tab.id) {
      results.push(await saveTab(tab.id, { quiet: true, mode: "page" }));
    }
  }

  return {
    saved: results.filter(result => result?.ok !== false).length,
    total: results.length
  };
}

async function saveLinkedPage(url) {
  let tab;
  try {
    assertCaptureAllowed(url);
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabComplete(tab.id);
    return await saveTab(tab.id, { quiet: true, mode: "page" });
  } catch (error) {
    console.info(formatError(error));
    return { ok: false, error: formatError(error) };
  } finally {
    if (tab?.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Linked page took too long to load."));
    }, 30000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function downloadArchive(result) {
  if (!result.html || !result.filename) {
    throw new Error("The page was captured, but no downloadable archive was produced.");
  }

  const url = `data:text/html;charset=utf-8,${encodeURIComponent(result.html)}`;
  return chrome.downloads.download({
    url,
    filename: result.filename,
    conflictAction: "uniquify",
    saveAs: false
  });
}

async function setAutoSave(autoSave) {
  await chrome.storage.sync.set({ autoSave });
  await chrome.contextMenus.update(MENU_IDS.autoSave, { checked: autoSave }).catch(() => {});
}

async function setBadge(tabId, text, color) {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
}

function createContextMenus(options) {
  chrome.contextMenus.create({
    id: MENU_IDS.savePage,
    title: "Save page as single HTML",
    contexts: ["page"]
  });
  chrome.contextMenus.create({
    id: MENU_IDS.saveSelection,
    title: "Save selected content as single HTML",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: MENU_IDS.saveLink,
    title: "Save linked page as single HTML",
    contexts: ["link"]
  });
  chrome.contextMenus.create({
    id: MENU_IDS.saveAllTabs,
    title: "Save all tabs in this window",
    contexts: ["page", "action"]
  });
  chrome.contextMenus.create({
    id: MENU_IDS.autoSave,
    title: "Auto-save pages after load",
    contexts: ["page", "action"],
    type: "checkbox",
    checked: Boolean(options.autoSave)
  });
}

function assertCaptureAllowed(url = "") {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("This tab does not have a normal web page URL.");
  }

  const protectedProtocols = new Set(["chrome:", "chrome-extension:", "edge:", "about:", "devtools:"]);
  const protectedHosts = new Set(["chromewebstore.google.com", "chrome.google.com"]);

  if (
    protectedProtocols.has(parsedUrl.protocol) ||
    protectedHosts.has(parsedUrl.hostname) ||
    parsedUrl.hostname.endsWith(".chrome.google.com")
  ) {
    throw new Error("Chrome blocks extensions from saving this protected page. Try a regular website tab.");
  }
}

function formatError(error) {
  return error?.message || String(error || "Unknown error");
}
