// popup.js — Identity Theft Protection UI
// Reads/writes settings & keys, manages trusted domains, shows/export logs.
// NOTE: Keep in sync with DEFAULT_SETTINGS used in identityProtection.js

const DEFAULT_SETTINGS = {
  enableProtection: true,
  showInlineTips: true,
  blockOnHighRisk: true,
  enableBreachChecks: false,
  requirePinForTrust: false,
  pinHash: null,
  trustedDomains: [],
  logLimit: 800
};

// --------- Helpers ---------
function $(sel) { return document.querySelector(sel); }
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") n.className = v; else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k in n) n[k] = v; else n.setAttribute(k, v);
  });
  children.forEach(c => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return n;
}
function fmtTs(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch { return String(ts); }
}
async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

// --------- DOM refs ---------
const enableProtection = $("#enableProtection");
const blockOnHighRisk  = $("#blockOnHighRisk");
const showInlineTips    = $("#showInlineTips");
const enableBreachChecks= $("#enableBreachChecks");
const requirePinForTrust= $("#requirePinForTrust");
const pinInput          = $("#pinInput");
const savePinBtn        = $("#savePinBtn");
const clearPinBtn       = $("#clearPinBtn");
const trustDomainInput  = $("#trustDomainInput");
const addTrustBtn       = $("#addTrustBtn");
const trustedList       = $("#trustedList");
const hibpKeyInput      = $("#hibpKeyInput");
const saveHibpKeyBtn    = $("#saveHibpKeyBtn");
const levelFilter       = $("#levelFilter");
const refreshLogsBtn    = $("#refreshLogsBtn");
const clearLogsBtn      = $("#clearLogsBtn");
const exportJsonBtn     = $("#exportJsonBtn");
const exportCsvBtn      = $("#exportCsvBtn");
const logsTbody         = $("#logsTbody");
const logsCount         = $("#logsCount");
const quickDefaultsBtn  = $("#quickDefaultsBtn");
const extVersionLabel   = $("#extVersion");

// --------- State ---------
let SETTINGS = { ...DEFAULT_SETTINGS };
let LOGS = [];

// --------- Load on open ---------
document.addEventListener("DOMContentLoaded", async () => {
  // show version (optional)
  try {
    const manifest = chrome.runtime.getManifest();
    extVersionLabel.textContent = `v${manifest.version}`;
  } catch {}

  await loadSettings();
  await loadHibpKey();
  await loadLogs();
  attachHandlers();
});

// --------- Load/save settings ---------
async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(["itpSettings"], res => {
      SETTINGS = { ...DEFAULT_SETTINGS, ...(res.itpSettings || {}) };
      // hydrate UI
      enableProtection.checked   = !!SETTINGS.enableProtection;
      blockOnHighRisk.checked    = !!SETTINGS.blockOnHighRisk;
      showInlineTips.checked     = !!SETTINGS.showInlineTips;
      enableBreachChecks.checked = !!SETTINGS.enableBreachChecks;
      requirePinForTrust.checked = !!SETTINGS.requirePinForTrust;
      renderTrusted();
      resolve();
    });
  });
}

async function saveSettings() {
  return new Promise(resolve => {
    chrome.storage.local.set({ itpSettings: SETTINGS }, resolve);
  });
}

// --------- Load/save HIBP key ---------
async function loadHibpKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(["hibpApiKey"], res => {
      hibpKeyInput.value = res.hibpApiKey ? "••••••••••••" : "";
      resolve();
    });
  });
}

async function saveHibpKey() {
  const raw = hibpKeyInput.value.trim();
  if (!raw || raw.startsWith("•••")) {
    // unchanged
    return;
  }
  await new Promise(resolve => chrome.storage.local.set({ hibpApiKey: raw }, resolve));
  hibpKeyInput.value = "••••••••••••";
  toast("HIBP API key saved.");
}

// --------- Logs ---------
async function loadLogs() {
  return new Promise(resolve => {
    chrome.storage.local.get(["itpLogs"], res => {
      LOGS = Array.isArray(res.itpLogs) ? res.itpLogs.slice().reverse() : [];
      renderLogs();
      resolve();
    });
  });
}

function renderLogs() {
  const filter = levelFilter.value;
  logsTbody.innerHTML = "";
  let shown = 0;

  LOGS.forEach(entry => {
    if (filter && entry.level !== filter) return;
    const tr = el("tr", {},
      el("td", {}, fmtTs(entry.ts || 0)),
      el("td", {}, pill(entry.level)),
      el("td", {}, entry.host || ""),
      el("td", {}, Array.isArray(entry.types) ? entry.types.join(", ") : ""),
      el("td", {}, String(entry.risk ?? "")),
      el("td", {}, entry.action || ""),
      el("td", {}, safe(entry.sample))
    );
    logsTbody.appendChild(tr);
    shown++;
  });

  logsCount.textContent = `${shown} ${shown === 1 ? "entry" : "entries"}`;
}

function pill(level) {
  const span = el("span", { class: `level-pill ${cls(level)}` }, (level || "").toUpperCase() || "—");
  return span;
}
function cls(level) {
  if (level === "high") return "level-high";
  if (level === "mod")  return "level-mod";
  return "level-low";
}
function safe(v) { return v == null ? "" : String(v); }

// --------- Export ---------
function exportJSON() {
  const data = JSON.stringify(LOGS, null, 2);
  downloadBlob(`itp-logs-${Date.now()}.json`, data, "application/json");
}
function exportCSV() {
  const cols = ["ts","level","host","types","risk","action","sample","url","formAction","https"];
  const rows = LOGS.map(e => [
    fmtTs(e.ts||0),
    e.level||"",
    e.host||"",
    Array.isArray(e.types) ? e.types.join("|") : "",
    e.risk ?? "",
    e.action||"",
    e.sample||"",
    e.url||"",
    e.formAction||"",
    e.https ? "true" : "false"
  ]);
  const csv = [cols.join(","), ...rows.map(r => r.map(csvEscape).join(","))].join("\n");
  downloadBlob(`itp-logs-${Date.now()}.csv`, csv, "text/csv");
}
function csvEscape(s) {
  const v = String(s ?? "");
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// --------- Trusted domains ---------
function renderTrusted() {
  trustedList.innerHTML = "";
  (SETTINGS.trustedDomains || []).forEach(host => {
    const li = el("li", {},
      el("span", { class: "chip" }, host),
      el("div", {},
        el("button", { class: "btn btn-ghost", onclick: () => removeTrust(host) }, "Remove")
      )
    );
    trustedList.appendChild(li);
  });
}
function addTrust() {
  const raw = trustDomainInput.value.trim().toLowerCase();
  if (!raw) return;
  try {
    // accept plain host or URL, normalize to host
    const host = raw.includes("://") ? new URL(raw).hostname : raw;
    if (!host || /\s/.test(host)) throw new Error("Invalid host");
    if (!SETTINGS.trustedDomains.includes(host)) {
      SETTINGS.trustedDomains.push(host);
      saveSettings().then(renderTrusted);
      trustDomainInput.value = "";
      toast(`Trusted: ${host}`);
    }
  } catch {
    toast("Enter a valid domain, e.g. example.com");
  }
}
function removeTrust(host) {
  SETTINGS.trustedDomains = (SETTINGS.trustedDomains || []).filter(h => h !== host);
  saveSettings().then(renderTrusted);
  toast(`Removed: ${host}`);
}

// --------- PIN ---------
async function savePin() {
  const pin = pinInput.value.trim();
  if (!pin) { toast("Enter a PIN."); return; }
  const hash = await sha256Hex(pin);
  SETTINGS.pinHash = hash;
  await saveSettings();
  pinInput.value = "";
  toast("PIN saved.");
}
async function clearPin() {
  SETTINGS.pinHash = null;
  await saveSettings();
  toast("PIN cleared.");
}

// --------- UI handlers ---------
function attachHandlers() {
  enableProtection.addEventListener("change", () => { SETTINGS.enableProtection = enableProtection.checked; saveSettings(); });
  blockOnHighRisk.addEventListener("change", () => { SETTINGS.blockOnHighRisk = blockOnHighRisk.checked; saveSettings(); });
  showInlineTips.addEventListener("change", () => { SETTINGS.showInlineTips = showInlineTips.checked; saveSettings(); });
  enableBreachChecks.addEventListener("change", () => { SETTINGS.enableBreachChecks = enableBreachChecks.checked; saveSettings(); });

  requirePinForTrust.addEventListener("change", () => { SETTINGS.requirePinForTrust = requirePinForTrust.checked; saveSettings(); });

  savePinBtn.addEventListener("click", savePin);
  clearPinBtn.addEventListener("click", clearPin);

  addTrustBtn.addEventListener("click", addTrust);
  trustDomainInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addTrust(); });

  saveHibpKeyBtn.addEventListener("click", saveHibpKey);

  levelFilter.addEventListener("change", renderLogs);
  refreshLogsBtn.addEventListener("click", loadLogs);
  clearLogsBtn.addEventListener("click", clearLogs);

  exportJsonBtn.addEventListener("click", exportJSON);
  exportCsvBtn.addEventListener("click", exportCSV);

  quickDefaultsBtn.addEventListener("click", applyRecommendedDefaults);
  const openLogsBtn = document.getElementById("openLogsBtn");
if (openLogsBtn) {
  openLogsBtn.addEventListener("click", () => {
    const url = chrome.runtime.getURL("logs.html");
    chrome.tabs.create({ url });
  });
}
  
}

async function clearLogs() {
  await new Promise(resolve => chrome.storage.local.set({ itpLogs: [] }, resolve));
  LOGS = [];
  renderLogs();
  toast("Logs cleared.");
}

async function applyRecommendedDefaults() {
  SETTINGS.enableProtection   = true;
  SETTINGS.blockOnHighRisk    = true;
  SETTINGS.showInlineTips     = true;
  SETTINGS.enableBreachChecks = true;  // optional; requires API key
  await saveSettings();
  await loadSettings();
  toast("Recommended defaults applied.");
}

// --------- Tiny toast ---------
let toastTimer = null;
function toast(msg) {
  // lightweight in-popup toast
  let box = document.getElementById("__toast");
  if (!box) {
    box = el("div", { id: "__toast", style: `
      position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%);
      background: #111; color: #fff; border: 1px solid #222; border-radius: 10px;
      padding: 8px 10px; z-index: 99999; box-shadow: 0 8px 24px rgba(0,0,0,.3);
      font: 12px/1.3 system-ui, -apple-system, Segoe UI, Roboto;
      max-width: 80%;
    `});
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.style.display = "none"; }, 2000);
}
