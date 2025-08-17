// content.js

// Extract visible page text + meta
function extractPageText() {
  let bodyText = document.body ? document.body.innerText : "";
  const metas = Array.from(document.getElementsByTagName("meta")).map(m => m.content || "").join(" ");
  return (bodyText + " " + metas).toLowerCase();
}

// Show a non-destructive overlay
function showBlockingOverlay(category, originalUrl) {
  // avoid duplicate overlays
  if (document.getElementById("__pg_block_overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "__pg_block_overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    background: "rgba(0,0,0,0.98)",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999999,
    padding: "20px",
    textAlign: "center",
  });

  const box = document.createElement("div");
  box.style.maxWidth = "720px";

  box.innerHTML = `
    <h1 style="font-size:28px; margin:0 0 8px 0;">⚠️ Access Blocked</h1>
    <p style="color:#d1d5db; margin:8px 0 18px 0;">This page is blocked under the <strong>${category}</strong> category.</p>
    <div style="margin-top:12px;">
      <input id="__pg_override_pin" type="password" placeholder="Enter PIN to override" style="padding:10px 12px; border-radius:8px; border:1px solid #374151; width:220px;"/>
      <button id="__pg_override_btn" style="margin-left:10px;padding:10px 14px;border-radius:8px;border:none;background:#4f46e5;color:white;cursor:pointer;">Unlock</button>
    </div>
    <div style="margin-top:16px;color:#9ca3af;font-size:13px;">
      <a id="__pg_more_info" href="#" style="color:#9ca3af;text-decoration:underline;">More info</a>
    </div>
  `;

  overlay.appendChild(box);
  document.documentElement.appendChild(overlay);

  document.getElementById("__pg_override_btn").addEventListener("click", () => {
    const pin = document.getElementById("__pg_override_pin").value;
    chrome.runtime.sendMessage({ action: "verifyPin", pin }, (res) => {
      if (res && res.valid) {
        // remove overlay and allow access (we can't "unblock" a redirect, but if this was overlay-based we can)
        const ov = document.getElementById("__pg_block_overlay");
        if (ov) ov.remove();
        // reload page to remove redirect (best effort)
        try { location.reload(); } catch(e) {}
      } else {
        alert("Invalid PIN.");
      }
    });
  });

  document.getElementById("__pg_more_info").addEventListener("click", (e) => {
    e.preventDefault();
    // Open extension blocked page for details
    chrome.runtime.sendMessage({ action: "openBlockedPage", url: originalUrl }, () => {});
  });
}

// Ask background to verify page content
function scanAndCheckPage() {
  const pageContent = extractPageText();
  chrome.runtime.sendMessage({
    action: "verifyPageContent",
    pageText: pageContent,
    url: window.location.href
  }, (response) => {
    if (response && response.shouldBlock) {
      showBlockingOverlay(response.category, window.location.href);
    }
  });
}

// Run after DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scanAndCheckPage);
} else {
  scanAndCheckPage();
}
