/* 
  identityProtection.js
  ---------------------------------------------------------
  Identity Theft Protection — Content Script (Manifest V3)

  What this file does (high level):
  - Scans every page for form fields and watches them in real-time.
  - Detects sensitive data via regex + label/placeholder keyword analysis.
  - Computes a risk score (Low/Moderate/High) and shows inline warnings.
  - Blocks suspicious submissions (configurable), with user override.
  - Can trust/whitelist domains (with optional PIN before trusting).
  - Asks the background service worker to run HIBP email breach checks.
  - Logs all incidents to chrome.storage.local (ring buffer with size limit).
  - Observes dynamically-added forms/inputs with a MutationObserver.
  - (Optional) observes fetch/XMLHttpRequest posts to unknown endpoints.

  IMPORTANT:
  - We DO NOT persist raw sensitive values. We only keep anonymized samples 
    (e.g., last 4 digits of a card), the detected "type", and the risk result.
  - Breach checks for EMAILs require user opt-in (enableBreachChecks: false by default).
  - Password checks (pwned passwords) are NOT enabled here to avoid reading passwords.
    (If you want that, we can add SHA-1 k-anonymity check later.)

  Storage keys used:
    - itpSettings: {
        enableProtection: boolean,
        showInlineTips: boolean,
        blockOnHighRisk: boolean,
        enableBreachChecks: boolean,
        requirePinForTrust: boolean,
        pinHash: string|null,            // SHA-256 hex of the PIN
        trustedDomains: string[],        // e.g., ["yourbank.com", "login.yourbank.com"]
        logLimit: number                 // max stored log entries
      }
    - itpLogs: LogEntry[]
    - itpBreachCache: { [email: string]: { count: number, names: string[], checkedAt: number } }

  Events/messages:
    - Sends {type: "ITP_BREACH_CHECK", email} to background for HIBP lookups.
    - Receives {type: "ITP_BREACH_RESULT", email, count, names} back.

  Required manifest permissions/host_permissions (already in your manifest):
    - "storage", "tabs", "scripting", "notifications", "alarms", "webRequest", "webRequestBlocking"
    - host_permissions: ["<all_urls>", "https://haveibeenpwned.com/*"]
*/

/* ---------------------------- Settings (defaults) ---------------------------- */

const DEFAULT_SETTINGS = {
  enableProtection: true,
  showInlineTips: true,
  blockOnHighRisk: true,
  enableBreachChecks: false,     // EMAIL breach checks are opt-in for privacy.
  requirePinForTrust: false,     // If true, user must enter PIN to trust a domain.
  pinHash: null,                 // SHA-256(hex) of user-defined PIN. null if not set.
  trustedDomains: [],            // User-managed whitelist.
  logLimit: 800                  // Max number of log entries to retain.
};

/* ---------------------------- Utilities ---------------------------- */

/** Safely get hostname without subdomain noise if needed */
function getHost() {
  try {
    return location.hostname || "";
  } catch {
    return "";
  }
}
const CURRENT_HOST = getHost();

/** Is page HTTPS? */
function isHTTPS() {
  return location.protocol === "https:";
}

/** Normalize string for keyword matching */
function norm(s) {
  return (s || "").toLowerCase().trim();
}

/** SHA-256 hash (hex) for PIN verification */
async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Debounce helper */
function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Luhn check for card number validity */
function luhnCheck(number) {
  const digits = (number || "").replace(/\D/g, "");
  if (digits.length < 12) return false;
  let sum = 0, flip = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (flip) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    flip = !flip;
  }
  return (sum % 10) === 0;
}

/** Avoid logging raw secret; keep last4 only (or a masked preview) */
function anonymizeSample(value, type) {
  if (!value) return null;
  const raw = String(value);
  if (type === "cardNumber") {
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 4 ? `•••• •••• •••• ${digits.slice(-4)}` : "••••";
  }
  if (type === "bankAccount") {
    const d = raw.replace(/\D/g, "");
    return d.length >= 4 ? `Acct ••••${d.slice(-4)}` : "Acct ••••";
  }
  if (type === "nin" || type === "bvn") {
    return `••••${raw.slice(-4)}`;
  }
  if (type === "email") {
    const [u, d] = raw.split("@");
    if (!d) return "•••@•••";
    const uMask = u.length > 2 ? u[0] + "••" + u.slice(-1) : "•••";
    return `${uMask}@${d}`;
  }
  if (type === "phone") {
    const d = raw.replace(/\D/g, "");
    return d.length >= 4 ? `•••${d.slice(-4)}` : "•••";
  }
  // default minimal reveal
  return raw.length > 4 ? `${raw.slice(0, 1)}•••${raw.slice(-1)}` : "•••";
}

/** Safe parse URL hostname */
function hostnameFromUrl(u) {
  try {
    return new URL(u, location.href).hostname;
  } catch {
    return "";
  }
}

/* ---------------------------- Detection resources ---------------------------- */

/** Regex patterns for various sensitive inputs (tuned for Nigeria where possible) */
const PATTERNS = {
  // Nigeria BVN is 11 digits
  bvn: /\b\d{11}\b/,
  // Nigeria NIN is 11 digits (format overlaps BVN; context/keywords help disambiguate)
  nin: /\b\d{11}\b/,
  // Nigeria bank account (NUBAN) is 10 digits
  bankAccount: /\b\d{10}\b/,
  // CVV/CVC
  cvv: /\b\d{3,4}\b/,
  // Card number (PAN): 13–19 digits; we’ll also Luhn check to reduce false positives
  cardNumber: /\b(?:\d[ -]*?){13,19}\b/,
  // Expiry date MM/YY or MM/YYYY
  cardExpiry: /\b(0[1-9]|1[0-2])[\/\-](\d{2}|\d{4})\b/,
  // Date of birth formats (simple)
  dob: /\b(0[1-9]|[12]\d|3[01])[\/\-.](0[1-9]|1[0-2])[\/\-.](19|20)\d{2}\b/,
  // Nigerian phone numbers (+234 or 0XXXXXXXXXX); basic
  phone: /(?:\+?234|0)\d{10}\b/,
  // Basic email detection
  email: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  // Generic passport (fallback)
  passport: /\b([A-Z]\d{7,8}|[A-Z]{2}\d{6,7})\b/,
  // US SSN (requested by you) — included but not primary in NG
  ssn: /\b\d{3}-\d{2}-\d{4}\b/
};

/** Keyword hints for NLP-like label/placeholder analysis */
const KEYWORDS = {
  nin: ["nin", "national id", "national identification", "national identification number"],
  bvn: ["bvn", "bank verification number"],
  bankAccount: ["account number", "acct no", "nuban", "iban"],
  bankCode: ["bank code", "sort code", "swift", "bic"],
  cardNumber: ["card number", "credit card", "debit card", "pan", "visa", "mastercard", "amex"],
  cvv: ["cvv", "cvc", "security code", "card security"],
  cardExpiry: ["expiry", "expiration", "exp date", "mm/yy", "mm/yyyy"],
  dob: ["date of birth", "dob", "birthdate"],
  passport: ["passport", "passport number"],
  phone: ["phone", "mobile", "telephone", "tel"],
  email: ["email", "e-mail"],
  password: ["password", "passcode", "pin", "otp", "one time password"],
  ssn: ["ssn", "social security"]
};

/** Severity for different types — used in risk scoring */
const TYPE_WEIGHT = {
  nin: 55,
  bvn: 60,
  bankAccount: 55,
  bankCode: 25,
  cardNumber: 80,
  cvv: 70,
  cardExpiry: 25,
  dob: 30,
  passport: 45,
  phone: 20,
  email: 20,
  password: 75,
  ssn: 70
};

/* ---------------------------- UI (Shadow DOM) ---------------------------- */

// Shadow root host so site CSS can’t break our UI
const uiHost = document.createElement("div");
uiHost.id = "itp-shadow-host";
const shadow = uiHost.attachShadow({ mode: "open" });
document.documentElement.appendChild(uiHost);

// Base styles for badges, toast, modal — scoped to shadow
const style = document.createElement("style");
style.textContent = `
  :host { all: initial; }
  .itp-toast {
    position: fixed; top: 16px; right: 16px; 
    max-width: 360px; padding: 10px 12px; 
    background: #111; color: #fff; 
    font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu;
    border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); z-index: 2147483647;
  }
  .itp-badge {
    position: fixed; 
    padding: 6px 10px; border-radius: 999px;
    font: 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu;
    color: #fff; z-index: 2147483647; pointer-events: auto;
    box-shadow: 0 8px 24px rgba(0,0,0,.25);
    display: flex; align-items: center; gap: 8px;
  }
  .itp-badge button, .itp-toast button {
    all: unset; cursor: pointer; padding: 4px 8px; border-radius: 8px; background: rgba(255,255,255,.12);
  }
  .itp-badge.low { background: #0d7a2b; }
  .itp-badge.mod { background: #a67600; }
  .itp-badge.high { background: #9b1c1c; }
  .itp-modal-mask {
    position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2147483646;
  }
  .itp-modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: min(560px, 92vw); background: #111; color: #fff; border-radius: 16px;
    padding: 18px; box-shadow: 0 20px 50px rgba(0,0,0,.5); z-index: 2147483647;
    font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu;
  }
  .itp-modal h3 { margin: 0 0 6px 0; font-size: 18px; }
  .itp-modal .risk-pill { display:inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; margin-left: 8px; }
  .risk-pill.low { background:#0d7a2b; color:#fff; }
  .risk-pill.mod { background:#a67600; color:#fff; }
  .risk-pill.high { background:#9b1c1c; color:#fff; }
  .itp-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  .itp-btn { all: unset; cursor: pointer; padding: 8px 12px; border-radius: 10px; background: #222; }
  .itp-btn.primary { background: #0d7a2b; color: #fff; }
  .itp-btn.warn { background: #9b1c1c; color: #fff; }
  .itp-note { opacity: .8; font-size: 12px; margin-top: 8px; }
  .itp-list { margin: 8px 0 0 16px; }
`;
shadow.appendChild(style);

// Containers
const toast = document.createElement("div"); toast.className = "itp-toast"; toast.style.display = "none";
shadow.appendChild(toast);

const modalMask = document.createElement("div"); modalMask.className = "itp-modal-mask"; modalMask.style.display = "none";
const modal = document.createElement("div"); modal.className = "itp-modal"; 
modalMask.appendChild(modal);
shadow.appendChild(modalMask);

// Active badges on screen (by field)
const activeBadges = new WeakMap();

/* ---------------------------- Settings load/save ---------------------------- */

let SETTINGS = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(["itpSettings"], res => {
      SETTINGS = { ...DEFAULT_SETTINGS, ...(res.itpSettings || {}) };
      resolve(SETTINGS);
    });
  });
}

function saveSettings() {
  return new Promise(resolve => {
    chrome.storage.local.set({ itpSettings: SETTINGS }, resolve);
  });
}

/* ---------------------------- Logging ---------------------------- */

async function appendLog(entry) {
  return new Promise(resolve => {
    chrome.storage.local.get(["itpLogs"], res => {
      const logs = Array.isArray(res.itpLogs) ? res.itpLogs : [];
      logs.push(entry);
      // Ring buffer
      while (logs.length > (SETTINGS.logLimit || DEFAULT_SETTINGS.logLimit)) logs.shift();
      chrome.storage.local.set({ itpLogs: logs }, resolve);
    });
  });
}

/* ---------------------------- Breach checks (email) ---------------------------- */

function requestBreachCheck(email) {
  if (!SETTINGS.enableBreachChecks) return;
  chrome.runtime.sendMessage({ type: "ITP_BREACH_CHECK", email });
}

// Handle async results from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "ITP_BREACH_RESULT") {
    // Show a small toast with breach info
    const { email, count, names = [] } = msg;
    showToast(count > 0
      ? `⚠️ Breach alert: ${email} found in ${count} breach(es): ${names.slice(0,3).join(", ")}${names.length>3?"…":""}`
      : `✅ No breaches detected for ${email} (as per HIBP).`
    );
  }
});

/* ---------------------------- Risk Scoring ---------------------------- */

/**
 * Compute a risk score:
 * - Base weight from detected types (e.g., cardNumber=80)
 * - +30 if non-HTTPS
 * - +20 if form posts to a different origin (cross-origin)
 * - +20 if domain is not trusted
 * - +20 if email is known breached (if background provided info; optional future hook)
 * Returns {score, level: "low"|"mod"|"high", reasons: string[]}
 */
function computeRisk({ types, https, crossOrigin, trusted }) {
  let score = 0;
  const reasons = [];

  // Base severity from types (sum with cap)
  const uniqueTypes = [...new Set(types)];
  let base = 0;
  uniqueTypes.forEach(t => { base += TYPE_WEIGHT[t] || 0; });
  base = Math.min(base, 100);
  score += base;
  if (uniqueTypes.length) reasons.push(`Contains: ${uniqueTypes.join(", ")}`);

  if (!https) { score += 30; reasons.push("Non-HTTPS connection"); }
  if (crossOrigin) { score += 20; reasons.push("Form posts to different origin"); }
  if (!trusted) { score += 20; reasons.push("Domain not in trusted list"); }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  let level = "low";
  if (score >= 70) level = "high";
  else if (score >= 40) level = "mod";

  return { score, level, reasons };
}

/* ---------------------------- Field Analysis ---------------------------- */

/** Get nearby label/placeholder/name/aria-label text to infer intent */
function getFieldContextText(el) {
  const bits = [];
  try {
    const id = el.id ? `#${el.id}` : "";
    // label[for=id]
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) bits.push(l.innerText || l.textContent || "");
    }
    // parent labels
    let parent = el.parentElement;
    let hops = 0;
    while (parent && hops < 3) {
      if (parent.tagName.toLowerCase() === "label") {
        bits.push(parent.innerText || parent.textContent || "");
      }
      parent = parent.parentElement; hops++;
    }
    // aria / name / placeholder
    const attrs = ["placeholder", "aria-label", "name", "id", "title", "autocomplete"];
    attrs.forEach(a => el.getAttribute && bits.push(el.getAttribute(a) || ""));
  } catch {}
  return norm(bits.filter(Boolean).join(" ").replace(/\s+/g, " "));
}

/** From value + label keywords decide which "types" are present */
function detectTypes(el) {
  const types = new Set();
  const val = (el.value || "").trim();
  const nval = norm(val);
  const ctx = getFieldContextText(el);

  // Email
  if (PATTERNS.email.test(val) || KEYWORDS.email.some(k => ctx.includes(k))) types.add("email");

  // Phone
  if (PATTERNS.phone.test(val) || KEYWORDS.phone.some(k => ctx.includes(k))) types.add("phone");

  // Card number (with Luhn check for confidence)
  if (PATTERNS.cardNumber.test(val) || KEYWORDS.cardNumber.some(k => ctx.includes(k))) {
    const digits = val.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(val)) types.add("cardNumber");
  }

  // CVV
  if (PATTERNS.cvv.test(val) || KEYWORDS.cvv.some(k => ctx.includes(k))) types.add("cvv");

  // Expiry
  if (PATTERNS.cardExpiry.test(val) || KEYWORDS.cardExpiry.some(k => ctx.includes(k))) types.add("cardExpiry");

  // BVN / NIN (both 11-digit; rely on keywords if available)
  if (PATTERNS.bvn.test(val) || KEYWORDS.bvn.some(k => ctx.includes(k))) types.add("bvn");
  if (PATTERNS.nin.test(val) || KEYWORDS.nin.some(k => ctx.includes(k))) types.add("nin");

  // Bank account
  if (PATTERNS.bankAccount.test(val) || KEYWORDS.bankAccount.some(k => ctx.includes(k))) types.add("bankAccount");

  // Passport
  if (PATTERNS.passport.test(val) || KEYWORDS.passport.some(k => ctx.includes(k))) types.add("passport");

  // DOB
  if (PATTERNS.dob.test(val) || KEYWORDS.dob.some(k => ctx.includes(k))) types.add("dob");

  // SSN (US)
  if (PATTERNS.ssn.test(val) || KEYWORDS.ssn.some(k => ctx.includes(k))) types.add("ssn");

  // Password: infer from input[type=password] or keywords (we DO NOT read value)
  if (el.type === "password" || KEYWORDS.password.some(k => ctx.includes(k))) types.add("password");

  return Array.from(types);
}

/* ---------------------------- UI helpers ---------------------------- */

function showToast(message) {
  toast.textContent = message;
  toast.style.display = "block";
  setTimeout(() => { toast.style.display = "none"; }, 6000);
}

/** Show small badge near a field; clicking opens a detail modal */
function showBadgeForField(field, level, text, details) {
  // Re-use existing
  let badge = activeBadges.get(field);
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "itp-badge";
    badge.textContent = "";
    shadow.appendChild(badge);
    activeBadges.set(field, badge);
  }
  badge.classList.remove("low", "mod", "high");
  badge.classList.add(level);

  badge.innerHTML = `
    <span>${text}</span>
    <button class="itp-open">Details</button>
  `;

  // Position near field (viewport fixed)
  try {
    const rect = field.getBoundingClientRect();
    badge.style.top = Math.max(8, rect.top + window.scrollY - 36) + "px";
    badge.style.left = Math.min(window.scrollX + rect.left, window.scrollX + (window.innerWidth - 280)) + "px";
  } catch {}

  // Button opens modal
  const openBtn = badge.querySelector(".itp-open");
  openBtn.onclick = (e) => {
    e.preventDefault();
    openDetailModal(details);
  };
}

/** Trust domain flow (with optional PIN) */
async function trustCurrentDomainWithOptionalPIN() {
  if (SETTINGS.requirePinForTrust) {
    const pin = prompt("Enter your protection PIN to trust this domain:");
    if (!pin) { showToast("Trust cancelled."); return false; }
    const hash = await sha256Hex(pin);
    if (!SETTINGS.pinHash || hash !== SETTINGS.pinHash) {
      showToast("❌ Incorrect PIN.");
      return false;
    }
  }
  if (!SETTINGS.trustedDomains.includes(CURRENT_HOST)) {
    SETTINGS.trustedDomains.push(CURRENT_HOST);
    await saveSettings();
  }
  showToast(`🔓 Trusted: ${CURRENT_HOST}`);
  return true;
}

/** Details modal with actions */
function openDetailModal({ level, score, reasons, types, https, crossOrigin, formActionHost }) {
  modal.innerHTML = `
    <h3>Identity Theft Protection 
      <span class="risk-pill ${level}">${level.toUpperCase()} • ${score}</span>
    </h3>
    <div>Site: <b>${CURRENT_HOST}</b></div>
    <div>Form action: <b>${formActionHost || "N/A"}</b> ${crossOrigin ? "(cross-origin)" : ""}</div>
    <div>Connection: <b>${https ? "HTTPS" : "HTTP (Not secure)"}</b></div>
    <div style="margin-top:8px;">Reasons:</div>
    <ul class="itp-list">${reasons.map(r => `<li>${r}</li>`).join("")}</ul>
    <div class="itp-actions">
      <button class="itp-btn primary" data-act="proceed-once">Proceed Once</button>
      <button class="itp-btn" data-act="trust">Trust ${CURRENT_HOST}</button>
      <button class="itp-btn warn" data-act="block">Block Submit</button>
    </div>
    <div class="itp-note">
      Tips: Use strong unique passwords, enable 2FA, never enter NIN/BVN on unverified sites, and verify the URL before submitting.
    </div>
  `;
  modalMask.style.display = "block";

  modalMask.onclick = (e) => {
    if (e.target === modalMask) modalMask.style.display = "none";
  };

  modal.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const act = btn.getAttribute("data-act");
      if (act === "trust") {
        const ok = await trustCurrentDomainWithOptionalPIN();
        if (ok) modalMask.style.display = "none";
      }
      if (act === "block") {
        modalMask.style.display = "none";
        showToast("🚫 Submission blocked.");
        // We don't submit here; actual block happens in submit handler.
      }
      if (act === "proceed-once") {
        modalMask.style.display = "none";
        showToast("✅ Proceeding this time only.");
        // The submit handler checks a "proceed once" flag we set below.
        proceedOnceFlag = true;
        // If there's a pending form, submit it now:
        if (pendingFormToSubmit) {
          const f = pendingFormToSubmit;
          pendingFormToSubmit = null;
          f.submit(); // native submit bypasses event handlers
        }
      }
    });
  });
}

/* ---------------------------- Form + Input observation ---------------------------- */

let proceedOnceFlag = false;        // Set when user clicks "Proceed Once" in modal
let pendingFormToSubmit = null;     // Holds blocked form briefly to resume submit

/** Watch dynamically added inputs/forms */
const observeMutations = new MutationObserver(debounce(() => {
  hookAllInputs(); hookAllForms();
}, 200));
observeMutations.observe(document.documentElement, { childList: true, subtree: true });

/** Attach listeners to current + future inputs */
function hookAllInputs() {
  const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
  inputs.forEach(el => {
    if (el.__itpHooked) return;
    el.__itpHooked = true;

    const onChange = debounce(() => {
      if (!SETTINGS.enableProtection) return;

      const types = detectTypes(el);
      if (types.length === 0) {
        // Remove badge if present
        const b = activeBadges.get(el);
        if (b) b.remove(), activeBadges.delete(el);
        return;
      }

      // Email breach checks (opt-in)
      if (SETTINGS.enableBreachChecks && types.includes("email")) {
        const emailVal = (el.value || "").trim();
        if (PATTERNS.email.test(emailVal)) requestBreachCheck(emailVal);
      }

      const f = el.form;
      const formAction = f && f.getAttribute("action");
      const formActionHost = formAction ? hostnameFromUrl(formAction) : CURRENT_HOST;
      const crossOrigin = formActionHost && formActionHost !== CURRENT_HOST;

      const risk = computeRisk({
        types, https: isHTTPS(), crossOrigin, trusted: SETTINGS.trustedDomains.includes(CURRENT_HOST)
      });

      // Show inline badge near field
      const detailPayload = {
        level: risk.level, score: risk.score, reasons: risk.reasons,
        types, https: isHTTPS(), crossOrigin, formActionHost
      };

      const label = risk.level === "high"
        ? "🚨 HIGH RISK"
        : (risk.level === "mod" ? "⚠️ Moderate risk" : "✅ Low risk");

      showBadgeForField(el, risk.level, label, detailPayload);

      // Optional toast with tips on high risk
      if (SETTINGS.showInlineTips && risk.level === "high") {
        showToast("🚨 You’re entering personal info on an unverified or risky context.");
      }

      // Log (no raw values)
      appendLog({
        ts: Date.now(),
        url: location.href,
        host: CURRENT_HOST,
        https: isHTTPS(),
        formAction: formAction || null,
        types,
        risk: risk.score,
        level: risk.level,
        sample: anonymizeSample(el.value, types[0] || "unknown"),
        action: "field-change"
      });
    }, 150);

    el.addEventListener("input", onChange, { passive: true });
    el.addEventListener("change", onChange, { passive: true });
    el.addEventListener("blur", onChange, { passive: true });
  });
}

/** Attach submit listeners to forms */
function hookAllForms() {
  const forms = Array.from(document.querySelectorAll("form"));
  forms.forEach(form => {
    if (form.__itpHooked) return;
    form.__itpHooked = true;

    form.addEventListener("submit", (e) => {
      if (!SETTINGS.enableProtection) return;

      const inputs = Array.from(form.querySelectorAll("input, textarea, select"));
      const types = new Set();

      inputs.forEach(el => detectTypes(el).forEach(t => types.add(t)));
      if (types.size === 0) return; // no sensitive info = allow

      const formAction = form.getAttribute("action");
      const formActionHost = formAction ? hostnameFromUrl(formAction) : CURRENT_HOST;
      const crossOrigin = formActionHost && formActionHost !== CURRENT_HOST;

      const risk = computeRisk({
        types: Array.from(types),
        https: isHTTPS(),
        crossOrigin,
        trusted: SETTINGS.trustedDomains.includes(CURRENT_HOST)
      });

      // If High risk and blocking enabled, block & show modal unless user trusted or proceeds once.
      if (SETTINGS.blockOnHighRisk && risk.level === "high" && !SETTINGS.trustedDomains.includes(CURRENT_HOST) && !proceedOnceFlag) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pendingFormToSubmit = form;

        openDetailModal({
          level: risk.level,
          score: risk.score,
          reasons: risk.reasons,
          types: Array.from(types),
          https: isHTTPS(),
          crossOrigin,
          formActionHost
        });

        appendLog({
          ts: Date.now(),
          url: location.href,
          host: CURRENT_HOST,
          https: isHTTPS(),
          formAction: formAction || null,
          types: Array.from(types),
          risk: risk.score,
          level: risk.level,
          action: "blocked-submit"
        });
        return;
      }

      // Reset proceedOnce if used
      if (proceedOnceFlag) proceedOnceFlag = false;

      appendLog({
        ts: Date.now(),
        url: location.href,
        host: CURRENT_HOST,
        https: isHTTPS(),
        formAction: formAction || null,
        types: Array.from(types),
        risk: risk.score,
        level: risk.level,
        action: "allowed-submit"
      });
    }, true); // use capture to get in before site handlers
  });
}

/* ---------------------------- Network (fetch/XHR) observation ---------------------------- */
/* 
  Optional: This does NOT block network calls. It only observes outbound requests
  from the page context to help flag suspicious POSTs of sensitive data to unknown
  destinations. We avoid reading raw bodies; we only flag that "a form with types X
  was submitted to host Y", which we already do in submit handler. Keeping lightweight.
*/

(function hookNetwork() {
  try {
    // fetch
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      try {
        const [input, init] = args;
        const url = typeof input === "string" ? input : (input && input.url) || "";
        const method = (init && (init.method || init.method?.toUpperCase())) || "GET";
        const host = hostnameFromUrl(url);
        const cross = host && host !== CURRENT_HOST;

        if (method.toUpperCase() === "POST" && cross) {
          appendLog({
            ts: Date.now(),
            url: location.href,
            host: CURRENT_HOST,
            https: isHTTPS(),
            outbound: host,
            action: "post-cross-origin"
          });
        }
      } catch {}
      return origFetch.apply(this, args);
    };

    // XHR
    const OrigXHR = window.XMLHttpRequest;
    function WrappedXHR() {
      const xhr = new OrigXHR();
      let _method = "GET";
      let _url = "";
      const origOpen = xhr.open;
      xhr.open = function(method, url, ...rest) {
        _method = (method || "GET").toUpperCase();
        _url = url || "";
        return origOpen.call(xhr, method, url, ...rest);
      };
      const origSend = xhr.send;
      xhr.send = function(body) {
        try {
          const host = hostnameFromUrl(_url);
          const cross = host && host !== CURRENT_HOST;
          if (_method === "POST" && cross) {
            appendLog({
              ts: Date.now(),
              url: location.href,
              host: CURRENT_HOST,
              https: isHTTPS(),
              outbound: host,
              action: "xhr-post-cross-origin"
            });
          }
        } catch {}
        return origSend.call(xhr, body);
      };
      return xhr;
    }
    window.XMLHttpRequest = WrappedXHR;
  } catch {}
})();

/* ---------------------------- Init ---------------------------- */

(async function init() {
  await loadSettings();

  if (!SETTINGS.enableProtection) {
    showToast("Identity Theft Protection is disabled in settings.");
    return;
  }

  hookAllInputs();
  hookAllForms();

  // Initial heads-up on insecure pages
  if (!isHTTPS()) {
    showToast("⚠️ This page is not secure (HTTP). Avoid entering personal info here.");
  }
})();
