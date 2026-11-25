let gpus = window.GPUS || [];
const kasMode = Boolean(window.KAS_MODE);
let csrfToken = "";
let currentUser = null;
let userSettings = null;
const overviewBody = document.querySelector("#gpus tbody");
const newListingsBody = document.querySelector("#newListings tbody");
const newListingsCount = document.querySelector("#newListingsCount");
const newListingsPanel = document.querySelector("#newListingsPanel");
const toggleNewListings = document.querySelector("#toggleNewListings");
const toggleLifecycleOnly = document.querySelector("#toggleLifecycleOnly");
const detail = document.querySelector("#detail");
const detailTitle = document.querySelector("#detailTitle");
const listingsBody = document.querySelector("#listings tbody");
const catFilter = document.querySelector("#catFilter");
const accountStatus = document.querySelector("#accountStatus");
const loginButton = document.querySelector("#loginButton");
const settingsButton = document.querySelector("#settingsButton");
const searchConfigButton = document.querySelector("#searchConfigButton");
const logoutButton = document.querySelector("#logoutButton");
const loginDialog = document.querySelector("#loginDialog");
const settingsDialog = document.querySelector("#settingsDialog");
const searchConfigDialog = document.querySelector("#searchConfigDialog");
const loginForm = document.querySelector("#loginForm");
const settingsForm = document.querySelector("#settingsForm");
const searchConfigForm = document.querySelector("#searchConfigForm");
const opportunitiesPanel = document.querySelector("#opportunitiesPanel");
const opportunitiesBody = document.querySelector("#opportunities tbody");
const opportunityCount = document.querySelector("#opportunityCount");

const euro = n => (n === null || n === undefined) ? "\u2014" : n.toLocaleString("de-DE") + " \u20ac";
const score = n => (n === null || n === undefined) ? "\u2014" : n.toLocaleString("de-DE");

// Kleinanzeigen keyword-search URL for a term (same slug shape the scraper uses).
const searchUrl = (term, min, max) => {
    const price = min !== null || max !== null ? `preis:${min ?? ""}:${max ?? ""}/` : "";
    const slug = encodeURIComponent(String(term).trim().toLowerCase().replace(/\s+/g, "-"));
    return `https://www.kleinanzeigen.de/s-${price}${slug}/k0`;
};
const value = n => (n === null || n === undefined) ? "\u2014" : n.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " pts/\u20ac";
const marginClass = n => n > 0 ? "pos" : n < 0 ? "neg" : "";

// Parse a "dd.mm.yyyy" string into an epoch (ms), or null when unavailable.
function parseDMY(s) {
    if (!s) return null;
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]).getTime();
}

function parseFirstSeen(s) {
    if (!s) return null;
    const ts = Date.parse(s);
    return Number.isFinite(ts) ? ts : parseDMY(s);
}

// Human-friendly freshness label for a listing timestamp.
function ageLabel(ts) {
    if (ts === null || ts === undefined) return '<span class="muted">\u2014</span>';
    const days = Math.floor((Date.now() - ts) / 86400000);
    const cls = days <= 2 ? "fresh" : days <= 7 ? "recent" : "stale";
    const txt = days <= 0 ? "today" : days === 1 ? "1d" : `${days}d`;
    return `<span class="age ${cls}">${txt}</span>`;
}

function prepareListingMetadata() {
    gpus.forEach(g => (g.listings || []).forEach(l => {
        l._ts = parseDMY(l.date);
        l._seen = parseFirstSeen(l.firstSeen);
        l._ageTs = l._ts !== null ? l._ts : l._seen;
        l._lifecycleTs = l.isPriceDrop || l.isPriceIncrease
            ? parseFirstSeen(l.lastSeen)
            : l.isNew ? l._seen : null;
    }));
    applyMarketWindow();
}

function medianNumber(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustLowNumber(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    if (sorted.length < 3) return sorted[0];
    const floor = medianNumber(sorted) * 0.5;
    return sorted.find(item => item >= floor) ?? sorted[0];
}

function applyMarketWindow() {
    const configuredDays = userSettings?.global?.marketWindowDays;
    if (!kasMode && configuredDays === undefined) return;
    const days = Number(configuredDays || 7);
    const cutoff = Date.now() - days * 86400000;
    gpus.forEach(g => {
        const marketListings = (g.listings || []).filter(l =>
            l._ageTs !== null && l._ageTs >= cutoff
            && ["GPU", "PC"].includes(l.category)
        );
        const gpuPrices = marketListings.filter(l => l.category === "GPU").map(l => l.price);
        const pcPrices = marketListings.filter(l => l.category === "PC").map(l => l.price);
        g.gpuLowest = robustLowNumber(gpuPrices);
        g.pcLowest = robustLowNumber(pcPrices);
        g.gpuMedian = medianNumber(gpuPrices);
        g.pcMedian = medianNumber(pcPrices);
        g.gpuAverage = gpuPrices.length ? Math.round(gpuPrices.reduce((a, b) => a + b, 0) / gpuPrices.length) : null;
        g.pcAverage = pcPrices.length ? Math.round(pcPrices.reduce((a, b) => a + b, 0) / pcPrices.length) : null;
        g.margin = g.gpuLowest !== null && g.pcLowest !== null ? g.pcLowest - g.gpuLowest : null;
        g.medianMargin = g.gpuMedian !== null && g.pcMedian !== null ? g.pcMedian - g.gpuMedian : null;
        g.gpuCount = gpuPrices.length;
        g.pcCount = pcPrices.length;
        g.gpuValue = g.score && g.gpuLowest ? Math.round((g.score / g.gpuLowest) * 10) / 10 : null;
        g.gpuMedianValue = g.score && g.gpuMedian
            ? Math.round((g.score / g.gpuMedian) * 10) / 10
            : null;
    });
}

const AGE_WINDOWS = {
    "24h": { label: "24h", ms: 24 * 3600000 },
    "3d": { label: "3d", ms: 3 * 86400000 },
    "7d": { label: "7d", ms: 7 * 86400000 },
    all: { label: "All", ms: null },
};

function activeAgeWindow() {
    return AGE_WINDOWS[ageFilter] || AGE_WINDOWS["24h"];
}

function isInAgeWindow(l) {
    const selectedAgeWindow = activeAgeWindow();
    return selectedAgeWindow.ms === null || (l._ageTs !== null && l._ageTs >= Date.now() - selectedAgeWindow.ms);
}

function isInLifecycleWindow(l) {
    const selectedAgeWindow = activeAgeWindow();
    return selectedAgeWindow.ms === null
        || (l._lifecycleTs !== null
            && l._lifecycleTs !== undefined
            && l._lifecycleTs >= Date.now() - selectedAgeWindow.ms);
}

function ageWindowText() {
    const selectedAgeWindow = activeAgeWindow();
    return selectedAgeWindow.ms === null ? "all listings" : `listings in the last ${selectedAgeWindow.label}`;
}

function listingAgeCell(l) {
    const date = l.date && l.date !== "N/A" ? l.date : "";
    return `${date} ${ageLabel(l._ageTs)}`;
}

// Small inline SVG sparkline of a numeric series.
function sparkline(values, w = 80, h = 22) {
    if (!values || values.length < 2) return '<span class="muted">\u2014</span>';
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const step = w / (values.length - 1);
    const pts = values.map((v, i) =>
        `${(i * step).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
    const up = values[values.length - 1] >= values[0];
    const color = up ? "var(--pos)" : "var(--neg)";
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

let overviewSort = { key: "gpuValue", dir: -1 };
let newListingsSort = { key: "_ageTs", dir: -1 };
let selected = null;
let listingSort = { key: "price", dir: 1 };
let category = "ALL";
let ageFilter = "24h";
let lifecycleOnly = false;

// Market depth per side: few comparable ads -> fragile lowest price / margin.
function depthClass(n) {
    if (n <= 1) return "thin";
    if (n <= 3) return "shallow";
    return "deep";
}
const THIN = 2; // a side with fewer ads than this makes the margin unreliable

function sortRows(rows, key, dir) {
    return rows.slice().sort((a, b) => {
        const x = a[key], y = b[key];
        const xn = x === null || x === undefined, yn = y === null || y === undefined;
        if (xn && yn) return 0;
        if (xn) return 1;          // missing values always last
        if (yn) return -1;
        if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
        return String(x).localeCompare(String(y)) * dir;
    });
}

function listingFlags(l) {
    return [
        l.isNewlyPosted ? '<span class="tag new">New</span>' :
            l.isNew ? '<span class="tag seen">New to scraper</span>' : "",
        l.isPriceDrop ? `<span class="tag drop">${escapeHtml(euro(l.priceChange))}</span>` :
            l.isPriceIncrease ? `<span class="tag increase">+${escapeHtml(euro(l.priceChange))}</span>` : "",
        l.negotiable ? '<span class="tag">VB</span>' : "",
        l.delivery ? '<span class="tag ship">Versand</span>' : "",
        l.instantBuy ? '<span class="tag buy">Direkt</span>' : "",
    ].filter(Boolean).join("");
}

function listingPrice(l) {
    const previous = l.previousPrice === null || l.previousPrice === undefined
        ? ""
        : `<span class="previous-price">${escapeHtml(euro(l.previousPrice))}</span>`;
    return `<span class="listing-price"><span>${euro(l.price)}</span>${previous}</span>`;
}

function escapeAttr(s) {
    return String(s).replace(/[&"<>]/g, c => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[c]));
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[c]));
}

function listingThumb(l) {
    const src = String(l.imageUrl || "").trim();
    if (!/^https?:\/\//i.test(src)) return '<span class="thumb empty-thumb"></span>';
    return `<img class="thumb" src="${escapeAttr(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
}

function listingRoom(l) {
    if (l.category !== "GPU" || l._roomLow === null || l._roomLow === undefined) {
        return '<span class="muted">market ref</span>';
    }
    return `<span class="room ${marginClass(l._roomLow)}"><span class="main">${l._roomLow > 0 ? "+" : ""}${euro(l._roomLow)}</span><span class="sub">vs low${l._roomMedian !== null && l._roomMedian !== undefined ? ` / ${l._roomMedian > 0 ? "+" : ""}${euro(l._roomMedian)} vs med` : ""}</span></span>`;
}

function listingLink(l) {
    const safeUrl = safeExternalUrl(l.url);
    const title = escapeHtml(l.title || "");
    const link = safeUrl
        ? `<a href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener">${title}</a>`
        : title;
    return `<div class="listing-cell">${listingThumb(l)}<span class="listing-title">${link}</span></div>`;
}

function safeExternalUrl(value) {
    try {
        const url = new URL(String(value || ""));
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}

function withMarketContext(g, l) {
    return {
        ...l,
        term: g.term,
        _roomLow: l.category === "GPU" && g.pcLowest !== null && g.pcLowest !== undefined ? g.pcLowest - l.price : null,
        _roomMedian: l.category === "GPU" && g.pcMedian !== null && g.pcMedian !== undefined ? g.pcMedian - l.price : null,
    };
}

async function apiRequest(path, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    if (options.body && typeof options.body !== "string") {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(options.body);
    }
    if (csrfToken && options.method && options.method !== "GET") {
        headers["X-CSRF-Token"] = csrfToken;
    }
    const response = await fetch(path, {
        ...options,
        headers,
        credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `Request failed with HTTP ${response.status}`);
    }
    return data;
}

function renderAccount() {
    if (!kasMode) {
        accountStatus.textContent = "";
        return;
    }
    loginButton.classList.toggle("hidden", Boolean(currentUser));
    settingsButton.classList.toggle("hidden", !currentUser);
    searchConfigButton.classList.toggle("hidden", !currentUser);
    logoutButton.classList.toggle("hidden", !currentUser);
    accountStatus.textContent = currentUser
        ? `Signed in as ${currentUser.email}`
        : "Sign in to sync budgets and daily opportunities.";
}

function currentModelSetting(g) {
    const settings = userSettings && userSettings.models || [];
    return settings.find(item => String(item.id) === String(g.id) || item.term === g.term) || null;
}

function personalMaxFor(g) {
    if (!userSettings) return null;
    const model = currentModelSetting(g);
    if (model && model.maxPrice !== null && model.maxPrice !== undefined) {
        return Number(model.maxPrice);
    }
    const globalMax = userSettings.global && userSettings.global.maxPrice;
    return globalMax === null || globalMax === undefined ? null : Number(globalMax);
}

function renderOpportunities() {
    if (!kasMode || !currentUser || !userSettings || !opportunitiesPanel) {
        opportunitiesPanel.classList.add("hidden");
        return;
    }
    const maxAgeHours = Number(userSettings.global.opportunityMaxAgeHours || 24);
    const cutoff = Date.now() - maxAgeHours * 3600000;
    const rows = [];
    gpus.forEach(g => {
        const modelSetting = currentModelSetting(g);
        if (modelSetting && modelSetting.enabled === false) return;
        const maxPrice = personalMaxFor(g);
        if (maxPrice === null || !Number.isFinite(maxPrice)) return;
        const minimumSpread = Number(modelSetting && modelSetting.minimumSpread);
        (g.listings || []).forEach(l => {
            if (l.category !== "GPU" || l._ageTs === null || l._ageTs < cutoff || l.price > maxPrice) {
                return;
            }
            const spread = g.pcLowest === null || g.pcLowest === undefined ? null : g.pcLowest - l.price;
            if (Number.isFinite(minimumSpread) && minimumSpread > 0
                && (spread === null || spread < minimumSpread)) {
                return;
            }
            rows.push(withMarketContext(g, l));
        });
    });
    rows.sort((a, b) => {
        const lifecycleRank = item =>
            (item.isPriceDrop ? 2000000 : 0)
            + (item.isNewlyPosted ? 1000000 : item.isNew ? 500000 : 0)
            + (item._roomLow || 0);
        return lifecycleRank(b) - lifecycleRank(a);
    });
    opportunitiesPanel.classList.remove("hidden");
    opportunityCount.textContent = `${rows.length} within your settings`;
    if (!rows.length) {
        opportunitiesBody.innerHTML = '<tr><td colspan="7" class="muted empty">No recent GPU ads fit your saved budget.</td></tr>';
        return;
    }
    opportunitiesBody.innerHTML = rows.map(l => {
        const maxPrice = personalMaxFor(gpus.find(g => g.term === l.term));
        return `<tr data-term="${escapeAttr(l.term)}">
          <td class="datecell">${listingAgeCell(l)}</td>
          <td>${escapeHtml(l.term)}</td>
          <td>${listingLink(l)}</td>
          <td class="num">${listingPrice(l)}</td>
          <td class="num ${marginClass(maxPrice - l.price)}">${euro(maxPrice - l.price)}</td>
          <td class="num ${marginClass(l._roomLow)}">${euro(l._roomLow)}</td>
          <td>${escapeHtml(l.city || "")}</td>
        </tr>`;
    }).join("");
}

function renderNewListings() {
    const rows = sortRows(
        gpus.flatMap(g => (g.listings || []).map(l => withMarketContext(g, l)))
            .filter(l => lifecycleOnly ? isInLifecycleWindow(l) : isInAgeWindow(l))
            .filter(l => !lifecycleOnly || l.isNew || l.isPriceDrop || l.isPriceIncrease),
        newListingsSort.key === "_ageTs" && lifecycleOnly ? "_lifecycleTs" : newListingsSort.key,
        newListingsSort.dir
    );
    if (newListingsCount) {
        newListingsCount.textContent = `${rows.length} ${ageWindowText()}`;
    }
    if (!newListingsBody) return;
    if (!rows.length) {
        newListingsBody.innerHTML = `<tr><td colspan="8" class="muted empty">No ${ageWindowText()}.</td></tr>`;
        return;
    }
    newListingsBody.innerHTML = rows.map(l => {
        const badge = categoryBadge(l);
        return `<tr data-term="${escapeAttr(l.term)}">
      <td class="datecell">${listingAgeCell(l)}</td>
      <td>${escapeHtml(l.term)}</td>
      <td>${badge}</td>
      <td>${listingLink(l)}</td>
      <td class="num">${listingPrice(l)}</td>
      <td>${listingFlags(l) || '<span class="muted">\u2014</span>'}</td>
      <td class="num">${listingRoom(l)}</td>
      <td>${escapeHtml(l.city || "")}</td>
    </tr>`;
    }).join("");
}

function renderOverview() {
    const selectedAgeWindow = activeAgeWindow();
    gpus.forEach(g => {
        g._ageGpu = selectedAgeWindow.ms === null ? 0 : (g.listings || [])
            .filter(l => l.category === "GPU" && isInAgeWindow(l)).length;
    });
    const rows = sortRows(gpus, overviewSort.key, overviewSort.dir);
    overviewBody.innerHTML = rows.map(g => {
        const spark = sparkline((g.history || []).map(p => p.margin));
        const delta = g.trend === null || g.trend === undefined
            ? ""
            : `<span class="delta ${marginClass(g.trend)}">${g.trend > 0 ? "+" : ""}${g.trend}</span>`;
        const minimumGpu = Number(userSettings?.global?.minimumGpuSamples || THIN);
        const minimumPc = Number(userSettings?.global?.minimumPcSamples || THIN);
        const thin = g.margin !== null && (g.gpuCount < minimumGpu || g.pcCount < minimumPc);
        const warn = thin ? ` <span class="warn" title="Below your minimum sample settings (${g.gpuCount} GPU, ${g.pcCount} PC ads) \u2013 margin may be unreliable">\u26a0</span>` : "";
        const med = v => v === null || v === undefined ? "" : `<span class="med" title="Median (typical) price">~${euro(v)}</span>`;
        const medValue = v => v === null || v === undefined ? "" : `<span class="med" title="Score per euro at median GPU price">~${value(v)}</span>`;
        const scoreTitle = g.benchmarkName ? ` title="${escapeAttr(g.benchmarkName)}"` : "";
        return `
    <tr data-term="${escapeAttr(g.term)}" class="${selected === g.term ? "selected" : ""}">
    <td>${escapeHtml(g.term)} <a class="searchlink" href="${escapeAttr(searchUrl(g.term, g.gpuMin, g.gpuMax))}" target="_blank" rel="noopener" title="Open '${escapeAttr(g.term)}' search on Kleinanzeigen" aria-label="Open '${escapeAttr(g.term)}' search on Kleinanzeigen">\u2197</a></td>
            <td class="num"${scoreTitle}>${score(g.score)}</td>
      <td class="num">${euro(g.gpuLowest)}${med(g.gpuMedian)}</td>
            <td class="num valuecell">${value(g.gpuValue)}${medValue(g.gpuMedianValue)}</td>
      <td class="num">${euro(g.pcLowest)}${med(g.pcMedian)}</td>
      <td class="num ${marginClass(g.margin)}">${euro(g.margin)}${warn}${med(g.medianMargin)}</td>
      <td class="num trend">${spark}${delta}</td>
            <td class="num depth ${depthClass(g.gpuCount)}">${g.gpuCount}${g._ageGpu ? ` <span class="newpill" title="${g._ageGpu} GPU listing(s) in the last ${selectedAgeWindow.label}">+${g._ageGpu}</span>` : ""}</td>
      <td class="num depth ${depthClass(g.pcCount)}">${g.pcCount}</td>
    </tr>`;
    }).join("");
}

// Multi-series line chart (GPU low, PC low, margin) over time.
function renderChart(g) {
    const chart = document.querySelector("#chart");
    const pts = g.history || [];
    if (pts.length < 2) {
        chart.innerHTML = `<p class="muted">Trend appears after a few scraper runs (${pts.length} snapshot${pts.length === 1 ? "" : "s"} so far).</p>`;
        return;
    }
    const W = 720, H = 200, padL = 48, padR = 12, padT = 12, padB = 24;
    const xs = pts.map((_, i) => i);
    const allVals = pts.flatMap(p => [p.gpuLowest, p.pcLowest, p.margin]);
    const min = Math.min(...allVals), max = Math.max(...allVals);
    const span = max - min || 1;
    const x = i => padL + (i / (xs.length - 1)) * (W - padL - padR);
    const y = v => padT + (1 - (v - min) / span) * (H - padT - padB);
    const line = (key, color) => {
        const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
        return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`;
    };
    const gridY = [min, min + span / 2, max].map(v =>
        `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/>
     <text x="4" y="${(y(v) + 4).toFixed(1)}" class="axis">${Math.round(v)}</text>`).join("");
    chart.innerHTML = `
    <div class="legend">
      <span><i style="background:var(--accent)"></i>PC low</span>
      <span><i style="background:#64d6a4"></i>GPU low</span>
      <span><i style="background:#e0a94f"></i>Margin</span>
      <span class="muted">${pts[0].ts} \u2192 ${pts[pts.length - 1].ts}</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" class="linechart">
      ${gridY}
      ${line("pcLowest", "var(--accent)")}
      ${line("gpuLowest", "#64d6a4")}
      ${line("margin", "#e0a94f")}
    </svg>`;
}

function renderListings() {
    const g = gpus.find(x => x.term === selected);
    if (!g) return;
    const valueInfo = g.score ? ` \u00b7 score ${score(g.score)}${g.gpuValue ? ` \u00b7 ${value(g.gpuValue)}` : ""}` : "";
    detailTitle.textContent = `${g.term} \u2014 listings${valueInfo}`;
    let data = g.listings.filter(l => category === "ALL" || l.category === category);
    data = data.filter(l => lifecycleOnly ? isInLifecycleWindow(l) : isInAgeWindow(l));
    data = data.filter(l => !lifecycleOnly || l.isNew || l.isPriceDrop || l.isPriceIncrease);
    data = data.map(l => withMarketContext(g, l));
    const rows = sortRows(data, listingSort.key, listingSort.dir);
    if (!rows.length) {
        listingsBody.innerHTML = `<tr><td colspan="7" class="muted empty">No ${ageWindowText()} \u2014 switch to "All" for the full history.</td></tr>`;
        return;
    }
    listingsBody.innerHTML = rows.map(l => {
        const badge = categoryBadge(l);
        const flags = listingFlags(l);
        return `<tr>
      <td>${badge}</td>
        <td>${listingLink(l)}</td>
      <td class="num">${listingPrice(l)}</td>
            <td>${flags || '<span class="muted">\u2014</span>'}</td>
            <td class="num">${listingRoom(l)}</td>
    <td class="datecell">${listingAgeCell(l)}</td>
      <td>${escapeHtml(l.city || "")}</td>
    </tr>`;
    }).join("");
}

function categoryBadge(l) {
    const label = l.category === "REVIEW"
        ? "Review"
        : l.category === "BUNDLE"
            ? "Bundle"
            : l.category;
    const title = l.categoryMismatch
        ? `Originally listed under ${l.sourceCategory || "another category"}`
        : l.classificationReasons || "";
    return `<span class="badge ${String(l.category).toLowerCase()}" title="${escapeAttr(title)}">${label}</span>`;
}

function selectGpu(term) {
    selected = term;
    detail.classList.remove("hidden");
    renderOverview();
    renderChart(gpus.find(x => x.term === selected));
    renderListings();
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

overviewBody.addEventListener("click", e => {
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr");
    if (tr) selectGpu(tr.dataset.term);
});

if (newListingsBody) {
    newListingsBody.addEventListener("click", e => {
        if (e.target.closest("a")) return;
        const tr = e.target.closest("tr[data-term]");
        if (tr) selectGpu(tr.dataset.term);
    });
}

if (toggleNewListings && newListingsPanel) {
    toggleNewListings.addEventListener("click", () => {
        const isHidden = newListingsPanel.classList.toggle("hidden");
        toggleNewListings.textContent = isHidden ? "Show listings" : "Hide listings";
        if (!isHidden) newListingsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
}

if (toggleLifecycleOnly) {
    toggleLifecycleOnly.addEventListener("click", () => {
        lifecycleOnly = !lifecycleOnly;
        toggleLifecycleOnly.classList.toggle("active", lifecycleOnly);
        toggleLifecycleOnly.textContent = lifecycleOnly
            ? "Show all listings"
            : "New & price changes";
        renderNewListings();
        renderListings();
    });
}

function bindSort(tableSel, state, rerender) {
    document.querySelectorAll(`${tableSel} th`).forEach(th => {
        th.addEventListener("click", () => {
            const key = th.dataset.key;
            if (state.key === key) {
                state.dir = -state.dir;
            } else {
                state.key = key;
                state.dir = ["term", "title", "city", "category"].includes(key) ? 1 : -1;
            }
            document.querySelectorAll(`${tableSel} th`)
                .forEach(h => h.classList.remove("sorted-asc", "sorted-desc"));
            th.classList.add(state.dir === 1 ? "sorted-asc" : "sorted-desc");
            rerender();
        });
    });
}

bindSort("#gpus", overviewSort, renderOverview);
bindSort("#newListings", newListingsSort, renderNewListings);
bindSort("#listings", listingSort, renderListings);

catFilter.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    category = btn.dataset.cat;
    catFilter.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
    renderListings();
});

document.querySelectorAll(".age-filter").forEach(ageFilterEl => {
    ageFilterEl.addEventListener("click", e => {
        const btn = e.target.closest("button[data-age]");
        if (!btn) return;
        ageFilter = btn.dataset.age;
        document.querySelectorAll(".age-filter button").forEach(b => {
            b.classList.toggle("active", b.dataset.age === ageFilter);
        });
        renderNewListings();
        renderOverview();
        renderOpportunities();
        renderListings();
    });
});

// Top-of-page business snapshot computed from the loaded models.
function renderKpis() {
    const box = document.querySelector("#kpis");
    if (!box) return;
    const minimumGpu = Number(userSettings?.global?.minimumGpuSamples || THIN);
    const minimumPc = Number(userSettings?.global?.minimumPcSamples || THIN);
    const margins = gpus
        .filter(g => g.gpuCount >= minimumGpu && g.pcCount >= minimumPc)
        .map(g => g.margin)
        .filter(m => m !== null && m !== undefined);
    const best = margins.length ? Math.max(...margins) : null;
    const bestModel = best !== null ? (gpus.find(g => g.margin === best
        && g.gpuCount >= minimumGpu && g.pcCount >= minimumPc) || {}).term : null;
    const values = gpus.map(g => g.gpuValue).filter(v => v !== null && v !== undefined);
    const bestValue = values.length ? Math.max(...values) : null;
    const bestValueModel = bestValue !== null ? (gpus.find(g => g.gpuValue === bestValue) || {}).term : null;
    const listingCount = gpus.reduce((n, g) => n + (g.gpuCount || 0) + (g.pcCount || 0), 0);
    const cards = [
        { label: "Models tracked", value: gpus.length },
        { label: "Best value", value: value(bestValue), sub: bestValueModel },
        { label: "Best margin", value: euro(best), sub: bestModel, cls: marginClass(best) },
        { label: "Total listings", value: listingCount.toLocaleString("de-DE") },
    ];
    box.innerHTML = cards.map(c => `
    <div class="kpi">
      <div class="kpi-val ${c.cls || ""}">${c.value}</div>
      <div class="kpi-label">${escapeHtml(c.label)}${c.sub ? ` \u00b7 <span class="muted">${escapeHtml(c.sub)}</span>` : ""}</div>
    </div>`).join("");
}

async function loadSettings() {
    const data = await apiRequest("api/settings.php");
    userSettings = data.settings;
    prepareListingMetadata();
    renderKpis();
    renderOverview();
    renderOpportunities();
    renderListings();
    return userSettings;
}

function fillSettingsForm(settings) {
    const global = settings.global || {};
    document.querySelector("#globalMaxPrice").value = global.maxPrice ?? "";
    document.querySelector("#opportunityAge").value = global.opportunityMaxAgeHours || 24;
    document.querySelector("#marketWindowDays").value = global.marketWindowDays || 7;
    document.querySelector("#minimumGpuSamples").value = global.minimumGpuSamples || 3;
    document.querySelector("#minimumPcSamples").value = global.minimumPcSamples || 3;
    document.querySelector("#modelSettings").innerHTML = (settings.models || []).map(model => `
        <div class="model-setting" data-model-id="${model.id}">
          <strong>${escapeHtml(model.term)}</strong>
          <input class="model-max-price" type="number" min="0" step="1"
            aria-label="${escapeAttr(`${model.term} maximum price`)}"
            placeholder="Global" value="${model.maxPrice ?? ""}">
          <label><input class="model-enabled" type="checkbox" ${model.enabled ? "checked" : ""}> Active</label>
        </div>
    `).join("");
}

async function openSettings() {
    const error = document.querySelector("#settingsError");
    error.textContent = "";
    try {
        fillSettingsForm(await loadSettings());
        settingsDialog.showModal();
    } catch (failure) {
        error.textContent = failure.message;
    }
}

function clearSearchForm() {
    document.querySelector("#searchConfigId").value = "";
    document.querySelector("#searchTerm").value = "";
    document.querySelector("#searchCategory").value = "GPU";
    document.querySelector("#searchMinPrice").value = "";
    document.querySelector("#searchMaxPrice").value = "";
    document.querySelector("#searchMaxAge").value = "";
    document.querySelector("#searchExcludes").value = "";
    document.querySelector("#searchActive").checked = true;
    document.querySelector("#saveSearchConfig").textContent = "Add search";
    document.querySelector("#searchConfigError").textContent = "";
}

function editSearch(search) {
    document.querySelector("#searchConfigId").value = search.id;
    document.querySelector("#searchTerm").value = search.term;
    document.querySelector("#searchCategory").value = search.category;
    document.querySelector("#searchMinPrice").value = search.minPrice ?? "";
    document.querySelector("#searchMaxPrice").value = search.maxPrice ?? "";
    document.querySelector("#searchMaxAge").value = search.maxAgeDays ?? "";
    document.querySelector("#searchExcludes").value = search.excludeTerms || "";
    document.querySelector("#searchActive").checked = Boolean(search.active);
    document.querySelector("#saveSearchConfig").textContent = "Save search";
    searchConfigDialog.scrollTop = 0;
    document.querySelector("#searchTerm").focus();
}

function renderSearchConfigs(searches) {
    const body = document.querySelector("#searchConfigRows");
    if (!searches.length) {
        body.innerHTML = '<tr><td colspan="6" class="muted empty">No KAS search terms yet. Add GPU and PC rows for each model.</td></tr>';
        return;
    }
    body.innerHTML = searches.map(search => {
        const min = search.minPrice === null ? "" : euro(search.minPrice);
        const max = search.maxPrice === null ? "" : euro(search.maxPrice);
        const range = min || max ? `${min || "any"} – ${max || "any"}` : "Any";
        const json = escapeAttr(JSON.stringify(search));
        return `<tr data-search-id="${search.id}" data-search="${json}">
          <td>${escapeHtml(search.term)}</td>
          <td><span class="badge ${search.category.toLowerCase()}">${search.category}</span></td>
          <td>${escapeHtml(range)}</td>
          <td>${search.maxAgeDays ? `${search.maxAgeDays}d` : "Any"}</td>
          <td><span class="tag ${search.active ? "new" : ""}">${search.active ? "Active" : "Off"}</span></td>
          <td><div class="row-actions">
            <button type="button" data-action="edit">Edit</button>
            <button type="button" data-action="delete" class="danger">Delete</button>
          </div></td>
        </tr>`;
    }).join("");
}

async function loadSearchConfigs() {
    const data = await apiRequest("api/search-config.php");
    renderSearchConfigs(data.searches || []);
}

async function openSearchConfig() {
    clearSearchForm();
    try {
        await loadSearchConfigs();
        searchConfigDialog.showModal();
    } catch (failure) {
        document.querySelector("#searchConfigError").textContent = failure.message;
        searchConfigDialog.showModal();
    }
}

if (opportunitiesBody) {
    opportunitiesBody.addEventListener("click", e => {
        if (e.target.closest("a")) return;
        const row = e.target.closest("tr[data-term]");
        if (row) selectGpu(row.dataset.term);
    });
}

if (loginButton) {
    loginButton.addEventListener("click", () => {
        document.querySelector("#loginError").textContent = "";
        loginDialog.showModal();
        document.querySelector("#loginEmail").focus();
    });
}

document.querySelector("#cancelLogin").addEventListener("click", () => loginDialog.close());
document.querySelector("#cancelSettings").addEventListener("click", () => settingsDialog.close());
settingsButton.addEventListener("click", openSettings);
searchConfigButton.addEventListener("click", openSearchConfig);
document.querySelector("#closeSearchConfig").addEventListener("click", () => searchConfigDialog.close());
document.querySelector("#clearSearchForm").addEventListener("click", clearSearchForm);

loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    const error = document.querySelector("#loginError");
    error.textContent = "";
    try {
        const data = await apiRequest("api/session.php", {
            method: "POST",
            body: {
                email: document.querySelector("#loginEmail").value,
                password: document.querySelector("#loginPassword").value,
            },
        });
        currentUser = data.user;
        csrfToken = data.csrfToken;
        document.querySelector("#loginPassword").value = "";
        loginDialog.close();
        renderAccount();
        await loadSettings();
    } catch (failure) {
        error.textContent = failure.message;
    }
});

settingsForm.addEventListener("submit", async e => {
    e.preventDefault();
    const error = document.querySelector("#settingsError");
    error.textContent = "";
    const models = [...document.querySelectorAll(".model-setting")].map(row => ({
        id: Number(row.dataset.modelId),
        maxPrice: row.querySelector(".model-max-price").value,
        enabled: row.querySelector(".model-enabled").checked,
        minimumSpread: currentModelSetting({ id: Number(row.dataset.modelId) })?.minimumSpread ?? null,
    }));
    const globalMax = document.querySelector("#globalMaxPrice").value;
    try {
        const data = await apiRequest("api/settings.php", {
            method: "POST",
            body: {
                global: {
                    maxPrice: globalMax,
                    opportunityMaxAgeHours: Number(document.querySelector("#opportunityAge").value),
                    marketWindowDays: Number(document.querySelector("#marketWindowDays").value),
                    minimumGpuSamples: Number(document.querySelector("#minimumGpuSamples").value),
                    minimumPcSamples: Number(document.querySelector("#minimumPcSamples").value),
                },
                models,
            },
        });
        userSettings = data.settings;
        settingsDialog.close();
        applyMarketWindow();
        renderKpis();
        renderOverview();
        renderOpportunities();
        renderListings();
    } catch (failure) {
        error.textContent = failure.message;
    }
});

searchConfigForm.addEventListener("submit", async e => {
    e.preventDefault();
    const error = document.querySelector("#searchConfigError");
    error.textContent = "";
    const id = document.querySelector("#searchConfigId").value;
    try {
        const data = await apiRequest("api/search-config.php", {
            method: "POST",
            body: {
                id: id ? Number(id) : null,
                term: document.querySelector("#searchTerm").value.trim(),
                category: document.querySelector("#searchCategory").value,
                minPrice: document.querySelector("#searchMinPrice").value,
                maxPrice: document.querySelector("#searchMaxPrice").value,
                maxAgeDays: document.querySelector("#searchMaxAge").value,
                excludeTerms: document.querySelector("#searchExcludes").value,
                active: document.querySelector("#searchActive").checked,
            },
        });
        renderSearchConfigs(data.searches || []);
        clearSearchForm();
    } catch (failure) {
        error.textContent = failure.message;
    }
});

document.querySelector("#searchConfigRows").addEventListener("click", async e => {
    const button = e.target.closest("button[data-action]");
    const row = button && button.closest("tr[data-search]");
    if (!button || !row) return;
    const search = JSON.parse(row.dataset.search);
    if (button.dataset.action === "edit") {
        editSearch(search);
        return;
    }
    if (!window.confirm(`Delete search "${search.term}" (${search.category})?`)) return;
    try {
        const data = await apiRequest(`api/search-config.php?id=${search.id}`, {
            method: "DELETE",
        });
        renderSearchConfigs(data.searches || []);
        if (String(document.querySelector("#searchConfigId").value) === String(search.id)) {
            clearSearchForm();
        }
    } catch (failure) {
        document.querySelector("#searchConfigError").textContent = failure.message;
    }
});

logoutButton.addEventListener("click", async () => {
    try {
        await apiRequest("api/session.php", { method: "DELETE" });
        currentUser = null;
        userSettings = null;
        csrfToken = "";
        renderAccount();
        renderOpportunities();
    } catch (failure) {
        accountStatus.textContent = failure.message;
    }
});

function renderApp() {
    prepareListingMetadata();
    renderKpis();
    renderNewListings();
    renderOverview();
    renderOpportunities();
}

async function initialize() {
    if (kasMode) {
        try {
            const marketData = await apiRequest("api/market.php");
            gpus = marketData.models || [];
            if (marketData.updated) {
                const updated = new Date(marketData.updated);
                document.querySelector("#updated").textContent = Number.isNaN(updated.getTime())
                    ? marketData.updated
                    : updated.toLocaleString("de-DE");
            }
        } catch (failure) {
            accountStatus.textContent = `Market data unavailable: ${failure.message}`;
        }
        try {
            const session = await apiRequest("api/session.php");
            currentUser = session.user;
            csrfToken = session.csrfToken;
            if (currentUser) await loadSettings();
        } catch (failure) {
            accountStatus.textContent = `Sign-in unavailable: ${failure.message}`;
        }
        renderAccount();
    }
    renderApp();
}

initialize();


