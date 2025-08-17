/* logs.js — advanced viewer for itpLogs
   Features:
   - Search, level filter, date range, min/max risk
   - Pagination
   - Live updates via chrome.storage.onChanged
   - Export JSON/CSV
   - Two charts drawn with Canvas 2D (no external libs)
*/

const $ = sel => document.querySelector(sel);
const tbody = $("#tbody");
const count = $("#count");
const pageInfo = $("#pageInfo");
const pageSizeSel = $("#pageSize");

const q = $("#q");
const level = $("#level");
const dateFrom = $("#dateFrom");
const dateTo = $("#dateTo");
const riskMin = $("#riskMin");
const riskMax = $("#riskMax");

const btnReset = $("#btnReset");
const btnRefresh = $("#btnRefresh");
const btnExportJSON = $("#btnExportJSON");
const btnExportCSV = $("#btnExportCSV");
const btnClear = $("#btnClear");
const prev = $("#prev");
const next = $("#next");

const chartLevels = $("#chartLevels");
const chartHosts = $("#chartHosts");

const ver = $("#ver");

// state
let ALL = [];
let VIEW = [];
let page = 1;
let pageSize = parseInt(pageSizeSel.value, 10) || 100;

// --- init
document.addEventListener("DOMContentLoaded", async () => {
  try { ver.textContent = `v${chrome.runtime.getManifest().version}`; } catch {}
  await loadLogs();
  bind();
  draw();
  // Live updates when storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.itpLogs) {
      loadLogs().then(draw);
    }
  });
});

// --- load logs
async function loadLogs() {
  return new Promise(resolve => {
    chrome.storage.local.get(["itpLogs"], res => {
      const logs = Array.isArray(res.itpLogs) ? res.itpLogs.slice() : [];
      // newest first for table browsing
      logs.sort((a,b) => (b.ts||0) - (a.ts||0));
      ALL = logs;
      filter();
      resolve();
    });
  });
}

// --- filtering
function filter() {
  const needle = (q.value || "").toLowerCase();
  const lv = level.value;
  const df = dateFrom.value ? new Date(dateFrom.value + "T00:00:00").getTime() : null;
  const dt = dateTo.value ? new Date(dateTo.value + "T23:59:59").getTime() : null;
  const rmin = riskMin.value !== "" ? +riskMin.value : null;
  const rmax = riskMax.value !== "" ? +riskMax.value : null;

  VIEW = ALL.filter(e => {
    if (lv && e.level !== lv) return false;
    if (df && (e.ts||0) < df) return false;
    if (dt && (e.ts||0) > dt) return false;
    if (rmin !== null && (e.risk ?? 0) < rmin) return false;
    if (rmax !== null && (e.risk ?? 0) > rmax) return false;

    if (needle) {
      const hay = [
        e.host || "",
        e.action || "",
        Array.isArray(e.types) ? e.types.join(" ") : ""
      ].join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // reset to first page on new filter
  page = 1;
  updateSummary();
}

// --- render table
function renderTable() {
  tbody.innerHTML = "";
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, VIEW.length);
  for (let i = start; i < end; i++) {
    const e = VIEW[i];
    const tr = document.createElement("tr");
    tr.append(
      td(fmtTs(e.ts)),
      td(pill(e.level)),
      td(e.host || ""),
      td(Array.isArray(e.types) ? e.types.join(", ") : ""),
      td(String(e.risk ?? "")),
      td(e.action || ""),
      td(String(e.sample ?? ""))
    );
    tbody.appendChild(tr);
  }
  pageInfo.textContent = `Page ${VIEW.length ? (start+1) : 0}-${end} of ${VIEW.length}`;
}

function td(child) {
  const n = document.createElement("td");
  if (child instanceof Node) n.appendChild(child); else n.textContent = child;
  return n;
}

function pill(level) {
  const span = document.createElement("span");
  span.className = "level-pill " + (level === "high" ? "level-high" : level === "mod" ? "level-mod" : "level-low");
  span.textContent = (level || "low").toUpperCase();
  return span;
}

function fmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString();
}

function updateSummary() {
  count.textContent = `${VIEW.length} ${VIEW.length === 1 ? "entry" : "entries"}`;
}

// --- charts
function drawCharts() {
  drawLevelsOverTime();
  drawTopHosts();
}

/* Chart helpers: simple 2D canvas rendering, no external libs */
function clearCanvas(c) {
  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);
  // background stripes
  ctx.fillStyle = "#11141b";
  ctx.fillRect(0,0,c.width,c.height);
}

function drawLevelsOverTime() {
  const c = chartLevels;
  clearCanvas(c);
  const ctx = c.getContext("2d");

  // Bucket by day
  const buckets = new Map(); // key=YYYY-MM-DD, val={low,mod,high}
  VIEW.forEach(e => {
    const d = new Date(e.ts || 0);
    const k = isNaN(d) ? "" : d.toISOString().slice(0,10);
    if (!k) return;
    if (!buckets.has(k)) buckets.set(k, { low:0, mod:0, high:0 });
    buckets.get(k)[e.level || "low"]++;
  });

  const days = Array.from(buckets.keys()).sort();
  const pad = { l:40, r:10, t:14, b:26 };
  const w = c.width - pad.l - pad.r;
  const h = c.height - pad.t - pad.b;

  // y scale by total per day
  const totals = days.map(d => {
    const v = buckets.get(d);
    return (v.low||0)+(v.mod||0)+(v.high||0);
  });
  const ymax = Math.max(5, ...totals);
  const xStep = w / Math.max(1, days.length - 1);

  // axes
  ctx.strokeStyle = "#2b3044";
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t+h);
  ctx.lineTo(pad.l+w, pad.t+h);
  ctx.stroke();

  // stacked bars
  const barW = Math.max(4, Math.min(20, xStep * 0.6));
  days.forEach((d, i) => {
    const v = buckets.get(d);
    const x = pad.l + i * xStep - barW/2;
    let y0 = pad.t + h;

    const stacks = [
      { key:"low",  color:"#0d7a2b" },
      { key:"mod",  color:"#a67600" },
      { key:"high", color:"#9b1c1c" }
    ];
    stacks.forEach(s => {
      const cnt = v[s.key] || 0;
      const bh = (cnt / ymax) * h;
      ctx.fillStyle = s.color;
      ctx.fillRect(x, y0 - bh, barW, bh);
      y0 -= bh;
    });
  });

  // y labels
  ctx.fillStyle = "#9aa4b2";
  ctx.font = "12px system-ui";
  for (let y=0; y<=ymax; y+=Math.ceil(ymax/4)) {
    const yy = pad.t + h - (y / ymax) * h;
    ctx.fillText(String(y), 6, yy+4);
  }
  // x labels (sparse)
  const step = Math.max(1, Math.floor(days.length / 6));
  days.forEach((d, i) => {
    if (i % step !== 0 && i !== days.length-1) return;
    const x = pad.l + i * xStep;
    ctx.fillText(d.slice(5), x-14, pad.t+h+16);
  });
}

function drawTopHosts() {
  const c = chartHosts;
  clearCanvas(c);
  const ctx = c.getContext("2d");

  // Count by host
  const counts = new Map();
  VIEW.forEach(e => {
    const h = (e.host || "unknown").toLowerCase();
    counts.set(h, (counts.get(h) || 0) + 1);
  });
  const entries = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const pad = { l:120, r:10, t:10, b:14 };
  const w = c.width - pad.l - pad.r;
  const h = c.height - pad.t - pad.b;
  const rowH = h / Math.max(1, entries.length);

  const maxv = Math.max(1, ...entries.map(e=>e[1]));
  ctx.fillStyle = "#9aa4b2";
  ctx.font = "12px system-ui";

  entries.forEach(( [host, val], i ) => {
    const y = pad.t + i * rowH + rowH*0.2;
    // label
    ctx.fillStyle = "#9aa4b2";
    ctx.fillText(host, 8, y+12);
    // bar
    const bw = (val / maxv) * w;
    ctx.fillStyle = "#3aa675";
    ctx.fillRect(pad.l, y, bw, rowH*0.6);
    // value
    ctx.fillStyle = "#e6e9ef";
    ctx.fillText(String(val), pad.l + bw + 6, y+12);
  });
}

// --- wire everything
function bind() {
  q.addEventListener("input", onFilter);
  level.addEventListener("change", onFilter);
  dateFrom.addEventListener("change", onFilter);
  dateTo.addEventListener("change", onFilter);
  riskMin.addEventListener("input", onFilter);
  riskMax.addEventListener("input", onFilter);

  btnReset.addEventListener("click", () => {
    q.value = ""; level.value = "";
    dateFrom.value = ""; dateTo.value = "";
    riskMin.value = ""; riskMax.value = "";
    onFilter();
  });

  pageSizeSel.addEventListener("change", () => {
    pageSize = parseInt(pageSizeSel.value, 10) || 100;
    page = 1; draw();
  });

  prev.addEventListener("click", () => {
    if (page > 1) { page--; draw(); }
  });
  next.addEventListener("click", () => {
    if (page * pageSize < VIEW.length) { page++; draw(); }
  });

  btnRefresh.addEventListener("click", () => loadLogs().then(draw));
  btnExportJSON.addEventListener("click", exportJSON);
  btnExportCSV.addEventListener("click", exportCSV);
  btnClear.addEventListener("click", clearLogs);
}

function onFilter() {
  filter();
  draw();
}

function draw() {
  renderTable();
  drawCharts();
}

// --- export / clear
function exportJSON() {
  const data = JSON.stringify(ALL, null, 2);
  download(`itp-logs-${Date.now()}.json`, data, "application/json");
}
function exportCSV() {
  const cols = ["ts","iso","level","host","types","risk","action","sample","url","formAction","https","outbound"];
  const rows = ALL.map(e => [
    e.ts||"",
    e.ts ? new Date(e.ts).toISOString() : "",
    e.level||"",
    e.host||"",
    Array.isArray(e.types) ? e.types.join("|") : "",
    e.risk ?? "",
    e.action||"",
    safe(e.sample),
    safe(e.url),
    safe(e.formAction),
    e.https ? "true":"false",
    safe(e.outbound)
  ]);
  const csv = [cols.join(","), ...rows.map(r => r.map(csvEscape).join(","))].join("\n");
  download(`itp-logs-${Date.now()}.csv`, csv, "text/csv");
}
function csvEscape(s) {
  const v = String(s ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
}
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
}
function safe(v){ return v==null ? "" : String(v); }

async function clearLogs() {
  if (!confirm("Clear all logs? This cannot be undone.")) return;
  await new Promise(r => chrome.storage.local.set({ itpLogs: [] }, r));
  await loadLogs();
  draw();
}
