/* 
  background.js (Manifest V3, type: module recommended)
  ------------------------------------------------------
  - Listens for ITP_BREACH_CHECK from the content script.
  - Calls Have I Been Pwned (HIBP) email breach API.
  - Returns results to the content script and optionally posts a notification.
  - Persists a small cache to avoid re-querying too often.

  IMPORTANT:
  - Replace YOUR_HIBP_API_KEY_HERE with your API key OR set it via chrome.storage.local:
    chrome.storage.local.set({ hibpApiKey: "..." })
  - HIBP policy: https://haveibeenpwned.com/API/v3
  - We use 'truncateResponse=true' to reduce payload.
*/

const HIBP_ENDPOINT = "https://haveibeenpwned.com/api/v3/breachedaccount/";
const HIBP_HEADERS_BASE = {
  "User-Agent": "IdentityTheftProtection/1.0 (Chrome Extension)"
};

// Load settings quickly (used to respect enableBreachChecks)
let SETTINGS = null;
chrome.storage.local.get(["itpSettings"], res => {
  SETTINGS = res.itpSettings || {};
});

// Update local cache of settings when changed
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.itpSettings) {
    SETTINGS = changes.itpSettings.newValue || {};
  }
});

async function getApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(["hibpApiKey"], res => resolve(res.hibpApiKey || "YOUR_HIBP_API_KEY_HERE"));
  });
}

async function hibpCheckEmail(email) {
  const apiKey = await getApiKey();
  const headers = {
    ...HIBP_HEADERS_BASE,
    "hibp-api-key": apiKey,
    "Accept": "application/json"
  };

  const url = `${HIBP_ENDPOINT}${encodeURIComponent(email)}?truncateResponse=true`;

  try {
    const resp = await fetch(url, { headers });
    if (resp.status === 404) {
      // Not found in any breaches
      return { count: 0, names: [] };
    }
    if (!resp.ok) {
      // Rate limit or other error
      return { error: `HIBP error: ${resp.status}` };
    }
    const data = await resp.json(); // Array of breach objects (truncated)
    const names = Array.isArray(data) ? data.map(b => b.Name).filter(Boolean) : [];
    return { count: names.length, names };
  } catch (e) {
    return { error: String(e) };
  }
}

// Simple cache to avoid repeated checks (in-memory while SW is alive)
const breachCache = new Map(); // key=email, value={count,names,ts}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "ITP_BREACH_CHECK") return;

  if (SETTINGS && SETTINGS.enableBreachChecks === false) return;

  const email = (msg.email || "").trim().toLowerCase();
  if (!email) return;

  const cached = breachCache.get(email);
  const now = Date.now();
  if (cached && (now - cached.ts) < 15 * 60 * 1000) {
    // 15 min cache
    chrome.tabs.sendMessage(sender.tab.id, { type: "ITP_BREACH_RESULT", email, count: cached.count, names: cached.names });
    return;
  }

  hibpCheckEmail(email).then(result => {
    if (result && typeof result.count === "number") {
      breachCache.set(email, { count: result.count, names: result.names, ts: now });

      // Notify content script
      if (sender && sender.tab && sender.tab.id >= 0) {
        chrome.tabs.sendMessage(sender.tab.id, { type: "ITP_BREACH_RESULT", email, count: result.count, names: result.names });
      }

      // Optional browser notification
      if (result.count > 0) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "asset/ext-icon.png",
          title: "Breach Alert",
          message: `${email} found in ${result.count} breach(es). Consider changing passwords & enabling 2FA.`
        });
      }
    }
  });

  // Indicate we’ll respond asynchronously (though we don’t use sendResponse here)
  return true;
});
