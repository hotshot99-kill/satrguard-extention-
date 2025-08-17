// background.js
// Robust background script for category-based blocking and content verification.

// State
let domainList = {};
let blockedCategories = {}; // e.g., { adultContent: true, gambling: false, ... }
let userSettings = { schedule: [], activeProfile: null, parentalPIN: null };
let rulesLoaded = false;
let settingsLoaded = false;

// Load rules.json (domain lists)
(async function loadRules() {
  try {
    const res = await fetch(chrome.runtime.getURL("rules.json"));
    domainList = await res.json();
    rulesLoaded = true;
    console.log("[BG] rules.json loaded");
  } catch (err) {
    console.error("[BG] Failed to load rules.json:", err);
  }
})();

// Load user settings
function loadSettings() {
  chrome.storage.local.get(
    ["preferences", "schedule", "activeProfile", "parentalPin", "blockedCategories"],
    (data) => {
      // Backwards compatibility: preferences object (from your popup.js) or blockedCategories
      if (data.blockedCategories) {
        blockedCategories = data.blockedCategories;
      } else if (data.preferences) {
        // Map popup preference names to the same keys used in rules.json
        blockedCategories = data.preferences;
      } else {
        blockedCategories = {};
      }

      userSettings.schedule = data.schedule || [];
      userSettings.activeProfile = data.activeProfile || null;
      userSettings.parentalPIN = data.parentalPin || null;
      settingsLoaded = true;
      console.log("[BG] settings loaded:", { blockedCategories, userSettings });
    }
  );
}

chrome.runtime.onInstalled.addListener(loadSettings);
chrome.runtime.onStartup.addListener(loadSettings);

// Listen for storage changes so updates apply immediately
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.blockedCategories) {
    blockedCategories = changes.blockedCategories.newValue || {};
    console.log("[BG] blockedCategories updated (storage.onChanged).", blockedCategories);
  }
  if (changes.preferences) {
    blockedCategories = changes.preferences.newValue || {};
    console.log("[BG] preferences updated.", blockedCategories);
  }
  if (changes.schedule) {
    userSettings.schedule = changes.schedule.newValue || [];
    console.log("[BG] schedule updated.", userSettings.schedule);
  }
  if (changes.parentalPin) {
    userSettings.parentalPIN = changes.parentalPin.newValue || null;
    console.log("[BG] parentalPin updated.");
  }
});

// Helper: normalize hostnames (strip www.)
function normalizeHost(hostname) {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

// Helper: check subdomain/domain match
function hostMatches(hostname, ruleDomain) {
  hostname = hostname.toLowerCase();
  ruleDomain = ruleDomain.toLowerCase();
  return hostname === ruleDomain || hostname.endsWith(`.${ruleDomain}`);
}

// Helper: check schedule active for a category (if schedule rules exist)
function isBlockedBySchedule(category) {
  if (!Array.isArray(userSettings.schedule)) return false;
  const now = new Date();
  const dayMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDayString = dayMap[now.getDay()];
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  for (const rule of userSettings.schedule) {
    // Each rule expected like: { category: "adultContent", start: "08:00", end: "17:00", days: ["Monday", ...] }
    if (rule.category !== category) continue;
    if (!Array.isArray(rule.days) || !rule.days.includes(currentDayString)) continue;
    if (rule.start && rule.end && currentTime >= rule.start && currentTime <= rule.end) {
      return true;
    }
  }
  return false;
}

// Main URL interception (blocks via redirect to extension's blocked.html)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Don't attempt to block if resources haven't loaded yet
    if (!rulesLoaded || !settingsLoaded) return { cancel: false };

    try {
      const url = new URL(details.url);
      const hostname = normalizeHost(url.hostname);

      // Direct domain-based blocking
      for (const [category, domains] of Object.entries(domainList)) {
        if (!blockedCategories[category]) continue; // user hasn't enabled this category
        // If schedule exists, consider schedule rules (if present)
        const scheduleBlocks = isBlockedBySchedule(category);
        // If schedule rules are present for this category, block only during schedule; otherwise block always if enabled
        const shouldConsider = (userSettings.schedule && userSettings.schedule.length > 0) ? scheduleBlocks : true;
        if (!shouldConsider) continue;

        for (const domain of domains) {
          if (hostMatches(hostname, domain)) {
            console.log(`[BG] Blocking ${details.url} due to category ${category}`);
            const redirectUrl = chrome.runtime.getURL(`blocked.html?category=${encodeURIComponent(category)}&url=${encodeURIComponent(details.url)}`);
            return { redirectUrl };
          }
        }
      }
    } catch (err) {
      console.error("[BG] Error in onBeforeRequest listener:", err);
    }

    return { cancel: false };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

// Handle runtime messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  if (message.action === "verifyPageContent") {
    // message: { action: "verifyPageContent", pageText, url }
    try {
      const urlObj = new URL(message.url);
      const hostname = normalizeHost(urlObj.hostname);
      // check domainList first
      for (const [category, domains] of Object.entries(domainList)) {
        if (!blockedCategories[category]) continue;
        for (const domain of domains) {
          if (hostMatches(hostname, domain)) {
            sendResponse({ shouldBlock: true, category });
            return; // early return
          }
        }
      }

      // As a fallback, check if any domain keywords appear in page text (simple heuristic)
      const pageLower = (message.pageText || "").toLowerCase();
      for (const [category, domains] of Object.entries(domainList)) {
        if (!blockedCategories[category]) continue;
        for (const token of domains) {
          // don't use full domain match; check token presence (e.g., "porn", "sex", etc.)
          const word = token.split(".")[0]; // crude token
          if (word && pageLower.includes(word)) {
            sendResponse({ shouldBlock: true, category });
            return;
          }
        }
      }

      sendResponse({ shouldBlock: false });
    } catch (err) {
      console.error("[BG] verifyPageContent error:", err);
      sendResponse({ shouldBlock: false });
    }
    return true; // indicate we'll send response asynchronously (keeps channel open)
  }

  if (message.action === "verifyPin") {
    const provided = (message.pin || "").toString();
    const valid = userSettings.parentalPIN && provided === userSettings.parentalPIN;
    sendResponse({ valid: !!valid });
    return true;
  }

  if (message.action === "updatePreferences") {
    // message.data = preferences object
    blockedCategories = message.data || {};
    chrome.storage.local.set({ blockedCategories });
    sendResponse({ success: true });
    return;
  }

  // default
  sendResponse({ ok: true });
});
