const gpus = window.GPUS || [];
const overviewBody = document.querySelector("#gpus tbody");
const detail = document.querySelector("#detail");
const detailTitle = document.querySelector("#detailTitle");
const listingsBody = document.querySelector("#listings tbody");
const catFilter = document.querySelector("#catFilter");

const euro = n => (n === null || n === undefined) ? "\u2014" : n.toLocaleString("de-DE") + " \u20ac";
const score = n => (n === null || n === undefined) ? "\u2014" : n.toLocaleString("de-DE");
const value = n => (n === null || n === undefined) ? "\u2014" : n.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " pts/\u20ac";
const marginClass = n => n > 0 ? "pos" : n < 0 ? "neg" : "";

// Parse a "dd.mm.yyyy" string into an epoch (ms), or null when unavailable.
function parseDMY(s) {
    if (!s) return null;
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]).getTime();
}

// Human-friendly freshness label for a listing timestamp.
function ageLabel(ts) {
    if (ts === null || ts === undefined) return '<span class="muted">\u2014</span>';
    const days = Math.floor((Date.now() - ts) / 86400000);
    const cls = days <= 2 ? "fresh" : days <= 7 ? "recent" : "stale";
    const txt = days <= 0 ? "today" : days === 1 ? "1d" : `${days}d`;
    return `<span class="age ${cls}">${txt}</span>`;
}

// Precompute a sortable timestamp per listing so the Date column ranks by recency,
// plus a "first seen" epoch used to surface only newly-appeared deals. Until the
// scraper has stamped First Seen, fall back to the posting date so "New" still works.
gpus.forEach(g => (g.listings || []).forEach(l => {
    l._ts = parseDMY(l.date);
    const fs = parseDMY(l.firstSeen);
    l._seen = fs !== null ? fs : l._ts;
}));

const NEW_DAYS = 3;   // "New" = first recorded within this many days
const WEEK_DAYS = 7;
const newCutoff = Date.now() - NEW_DAYS * 86400000;
// Count freshly-seen GPU deals per model so the overview flags where to look.
gpus.forEach(g => {
    g._newGpu = (g.listings || []).filter(
        l => l.category === "GPU" && l._seen !== null && l._seen >= newCutoff).length;
});

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
let selected = null;
let listingSort = { key: "price", dir: 1 };
let category = "ALL";
let ageFilter = "new";   // new | week | all

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

function renderOverview() {
    const rows = sortRows(gpus, overviewSort.key, overviewSort.dir);
    overviewBody.innerHTML = rows.map(g => {
        const spark = sparkline((g.history || []).map(p => p.margin));
        const delta = g.trend === null || g.trend === undefined
            ? ""
            : `<span class="delta ${marginClass(g.trend)}">${g.trend > 0 ? "+" : ""}${g.trend}</span>`;
        const thin = g.margin !== null && Math.min(g.gpuCount, g.pcCount) < THIN;
        const warn = thin ? ' <span class="warn" title="Backed by fewer than 2 ads on one side \u2013 margin may be unreliable">\u26a0</span>' : "";
        const med = v => v === null || v === undefined ? "" : `<span class="med" title="Median (typical) price">~${euro(v)}</span>`;
          const medValue = v => v === null || v === undefined ? "" : `<span class="med" title="Score per euro at median GPU price">~${value(v)}</span>`;
          const scoreTitle = g.benchmarkName ? ` title="${g.benchmarkName}"` : "";
        return `
    <tr data-term="${g.term}" class="${selected === g.term ? "selected" : ""}">
      <td>${g.term}</td>
        <td class="num"${scoreTitle}>${score(g.score)}</td>
      <td class="num">${euro(g.gpuLowest)}${med(g.gpuMedian)}</td>
        <td class="num valuecell">${value(g.gpuValue)}${medValue(g.gpuMedianValue)}</td>
      <td class="num">${euro(g.pcLowest)}${med(g.pcMedian)}</td>
      <td class="num ${marginClass(g.margin)}">${euro(g.margin)}${warn}${med(g.medianMargin)}</td>
      <td class="num trend">${spark}${delta}</td>
      <td class="num depth ${depthClass(g.gpuCount)}">${g.gpuCount}${g._newGpu ? ` <span class="newpill" title="${g._newGpu} new GPU listing(s) in the last ${NEW_DAYS} days">+${g._newGpu}</span>` : ""}</td>
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
    const maxDays = ageFilter === "new" ? NEW_DAYS : ageFilter === "week" ? WEEK_DAYS : null;
    const cutoff = maxDays === null ? null : Date.now() - maxDays * 86400000;
    let data = g.listings.filter(l => category === "ALL" || l.category === category);
    if (cutoff !== null) data = data.filter(l => l._seen !== null && l._seen >= cutoff);
    data.forEach(l => {
        l._roomLow = l.category === "GPU" && g.pcLowest !== null && g.pcLowest !== undefined ? g.pcLowest - l.price : null;
        l._roomMedian = l.category === "GPU" && g.pcMedian !== null && g.pcMedian !== undefined ? g.pcMedian - l.price : null;
    });
    const rows = sortRows(data, listingSort.key, listingSort.dir);
    if (!rows.length) {
        listingsBody.innerHTML = `<tr><td colspan="7" class="muted empty">No listings first seen in this window \u2014 switch to "All" for the full history.</td></tr>`;
        return;
    }
    listingsBody.innerHTML = rows.map(l => {
        const link = l.url
            ? `<a href="${l.url}" target="_blank" rel="noopener">${l.title}</a>`
            : l.title;
        const flags = [
            l.negotiable ? '<span class="tag">VB</span>' : "",
            l.delivery ? '<span class="tag ship">Versand</span>' : "",
            l.instantBuy ? '<span class="tag buy">Direkt</span>' : "",
        ].filter(Boolean).join("");
        const isNew = l._seen !== null && l._seen >= newCutoff;
        const newTag = isNew ? ' <span class="tag new">new</span>' : "";
        const badge = `<span class="badge ${l.category === "PC" ? "pc" : "gpu"}">${l.category}</span>`;
                const room = l.category === "GPU" && l._roomLow !== null
                        ? `<span class="room ${marginClass(l._roomLow)}"><span class="main">${l._roomLow > 0 ? "+" : ""}${euro(l._roomLow)}</span><span class="sub">vs low${l._roomMedian !== null ? ` / ${l._roomMedian > 0 ? "+" : ""}${euro(l._roomMedian)} vs med` : ""}</span></span>`
                        : '<span class="muted">market ref</span>';
        return `<tr>
      <td>${badge}</td>
            <td>${link}${newTag}</td>
      <td class="num">${euro(l.price)}</td>
            <td>${flags || '<span class="muted">\u2014</span>'}</td>
            <td class="num">${room}</td>
      <td class="datecell">${l.date && l.date !== "N/A" ? l.date : ""} ${ageLabel(l._ts)}</td>
      <td>${l.city || ""}</td>
    </tr>`;
    }).join("");
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
    const tr = e.target.closest("tr");
    if (tr) selectGpu(tr.dataset.term);
});

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
bindSort("#listings", listingSort, renderListings);

catFilter.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    category = btn.dataset.cat;
    catFilter.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
    renderListings();
});

const ageFilterEl = document.querySelector("#ageFilter");
if (ageFilterEl) {
    ageFilterEl.addEventListener("click", e => {
        const btn = e.target.closest("button");
        if (!btn) return;
        ageFilter = btn.dataset.age;
        ageFilterEl.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
        renderListings();
    });
}

// Top-of-page business snapshot computed from the loaded models.
function renderKpis() {
    const box = document.querySelector("#kpis");
    if (!box) return;
    const margins = gpus.map(g => g.margin).filter(m => m !== null && m !== undefined);
    const best = margins.length ? Math.max(...margins) : null;
    const bestModel = best !== null ? (gpus.find(g => g.margin === best) || {}).term : null;
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
      <div class="kpi-label">${c.label}${c.sub ? ` \u00b7 <span class="muted">${c.sub}</span>` : ""}</div>
    </div>`).join("");
}

renderKpis();
renderOverview();


