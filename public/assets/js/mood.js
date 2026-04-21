/* ── StockPanda — Mood Engine (client-side) ──────────────────────────────── */
'use strict';

/* ── HTML escaping (used by chip() for legacy innerHTML call sites) ───────── */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MOOD_DESC = {
  'Level 1':  'Level 1 — Suitable for Level 1 StockPandas. The stock is stable and steady — smooth sailing, with no signs of immediate danger.',
  'Level 2':  'Level 2 — Suitable for Level 2 StockPandas. The stock is stable with mild movement — stay aware, but no need to panic.',
  'Level 3':  'Level 3 — Suitable for Level 3 StockPandas. The stock is unsettled and can shift quickly — watch closely and keep your rules tight.',
  'Level 4':  'Level 4 — Suitable for Level 4 StockPandas. The stock is unpredictable and risk is rising — stay on guard and move with discipline.',
  'Level 5':  'Level 5 — Suitable for Level 5 StockPandas. The stock is highly volatile and can turn sharply at any moment — proceed with extreme caution.',
};

const MOOD = {
  BANDS: [
    { lo:  0, hi: 20,  label: 'Level 1',  key: 'vcalm',     color: '#60A5FA', cls: 'mc-blue',   img: 'panda-vcalm.png'     },
    { lo: 20, hi: 40,  label: 'Level 2',  key: 'calm',      color: '#4ADE80', cls: 'mc-green',  img: 'panda-calm.png'      },
    { lo: 40, hi: 60,  label: 'Level 3',  key: 'unsettled', color: '#FBBF24', cls: 'mc-amber',  img: 'panda-unsettled.png' },
    { lo: 60, hi: 80,  label: 'Level 4',  key: 'stressed',  color: '#FB923C', cls: 'mc-orange', img: 'panda-stressed.png'  },
    { lo: 80, hi: 101, label: 'Level 5',  key: 'danger',    color: '#F87171', cls: 'mc-red',    img: 'panda-danger.png'    },
  ],

  band(label) {
    return this.BANDS.find(b => b.label === label) || this.BANDS[2];
  },

  pandaImg(label, basePath = 'assets/img/') {
    const b = this.band(label);
    return `${basePath}${b.img}`;
  },

  /* Returns an HTML string — safe for innerHTML call sites in HTML files.
     label is always run through esc() before insertion. */
  chip(label) {
    const display = label;
    const b = this.band(label);
    const desc = MOOD_DESC[label] || '';
    return `<span class="mood-chip ${b.cls}" title="${esc(desc)}">${esc(display)}</span>`;
  },

  /* Returns an HTML string — safe for innerHTML call sites in HTML files.
     Only uses Math.abs() on a numeric delta, never raw user data. */
  swingHtml(swing) {
    if (!swing || swing.state === 'flat' || swing.delta === 0) {
      return `<span class="swing sw-flat">● 0</span>`;
    }
    const abs = Math.abs(swing.delta);
    if (swing.state === 'up') {
      return `<span class="swing sw-up">↑ ${abs}</span>`;
    }
    if (swing.state === 'red') {
      return `<span class="swing sw-red">↓ ${abs}</span>`;
    }
    return `<span class="swing sw-amber">↓ ${abs}</span>`;
  },

  dotColor(color) {
    return { green: 'd-green', amber: 'd-amber', red: 'd-red' }[color] || 'd-amber';
  },

  scorePillClass(pct) {
    if (pct <= 10)  return 'sp-blue';
    if (pct <= 20)  return 'sp-green';
    if (pct <= 50)  return 'sp-amber';
    if (pct <= 70)  return 'sp-orange';
    return 'sp-red';
  },
};

/* ── Indicator metadata ──────────────────────────────────────────────────── */
const IND_META = {
  volatility:  { label: 'Volatility',        short: 'Vol',   desc: '1-year annualised price swing. High volatility = bigger day-to-day moves and more risk.' },
  volSpike:    { label: 'Unusual Activity',   short: 'Spike', desc: 'Recent volatility vs 12-month average. Above 1.5× means something unusual is happening.' },
  vsPeak:      { label: 'vs ATH',              short: 'Peak',  desc: 'How far the price is from its all-time high. Large drawdowns signal sustained weakness.' },
  shortTrend:  { label: 'Short-Term Trend',   short: '50D',   desc: 'Price vs 50-day moving average. Positive = trading above short-term trend (bullish).' },
  longTrend:   { label: 'Long-Term Trend',    short: '200D',  desc: 'Price vs 200-day moving average. Positive = sustained long-term uptrend intact.' },
  maCross:     { label: 'MA Cross',           short: 'Cross', desc: 'Golden Cross (bullish) when 50D MA is above 200D MA. Death Cross signals a downtrend.' },
  momentum:    { label: 'Momentum',           short: 'Mom.',  desc: 'Price direction based on recent and long-term return trajectory. This ranges from +1 to -1. Positive value means the stock has positive momentum. Negative value means it\'s trending down.' },
  return1M:    { label: '1M Return',          short: '1M',    desc: 'Total price return over the past 30 trading days.' },
  return1Y:    { label: '1Y Return',          short: '1Y',    desc: 'Total price return over the past 12 months.' },
  range52W:    { label: '52-Week Range',      short: '52W',   desc: 'Where the price sits within its 52-week high/low band. Near bottom = bearish.' },
  cagr5Y:      { label: '5Y CAGR',            short: 'CAGR',  desc: 'Compound annual growth rate over 5 years. Negative CAGR = long-term value destruction.' },
};

// The 11 scoring indicators (in display order)
const IND_ORDER = ['volatility','volSpike','vsPeak','shortTrend','longTrend','maCross','momentum','return1M','return1Y','range52W','cagr5Y'];

/* ── Data cache ──────────────────────────────────────────────────────────── */
const EXCHANGE_LABELS = {
  sp500:'S&P 500', ftse100:'FTSE 100', hsi:'Hang Seng', nikkei225:'Nikkei 225',
  nasdaq100:'NASDAQ 100', nasdaq_financial:'NASDAQ Financial', nasdaq_biotech:'NASDAQ Biotech',
};

const MOOD_BANDS_JS = [
  {lo:0,  hi:20,  label:'Level 1',  colorKey:'blue',   color:'#60A5FA'},
  {lo:20, hi:40,  label:'Level 2',  colorKey:'green',  color:'#4ADE80'},
  {lo:40, hi:60,  label:'Level 3',  colorKey:'amber',  color:'#FBBF24'},
  {lo:60, hi:80,  label:'Level 4',  colorKey:'orange', color:'#FB923C'},
  {lo:80, hi:101, label:'Level 5',  colorKey:'red',    color:'#F87171'},
];

function moodFromScore(score) {
  const pct = Math.round(score / 20 * 1000) / 10;
  for (const b of MOOD_BANDS_JS) {
    if (pct >= b.lo && pct < b.hi) return {label:b.label, colorKey:b.colorKey, color:b.color, score, pct};
  }
  const b = MOOD_BANDS_JS[MOOD_BANDS_JS.length-1];
  return {label:b.label, colorKey:b.colorKey, color:b.color, score, pct};
}

/* Compute mood from indicator colours using the scoring formula:
   Green=1pt, Amber=2pt, Red=3pt → normalise to 0–100% risk. */
function moodFromIndicators(indicators) {
  const vals = Object.values(indicators || {});
  if (!vals.length) return { label: 'Level 1', color: '#60A5FA', colorKey: 'blue', riskPct: 0 };
  const scoreMap = { green: 1, amber: 2, red: 3 };
  const actual  = vals.reduce((sum, i) => sum + (scoreMap[i.color] || 1), 0);
  const n       = vals.length;
  const riskPct = (actual - n) / (n * 2) * 100;
  for (const b of MOOD_BANDS_JS) {
    if (riskPct >= b.lo && riskPct < b.hi) return { label: b.label, color: b.color, colorKey: b.colorKey, riskPct };
  }
  const last = MOOD_BANDS_JS[MOOD_BANDS_JS.length - 1];
  return { label: last.label, color: last.color, colorKey: last.colorKey, riskPct };
}

const DataCache = {
  _store: {},
  async get(exchange) {
    if (this._store[exchange]) return this._store[exchange];
    try {
      const res = await fetch(`data/${exchange}.json`);
      if (!res.ok) throw new Error(`${exchange}.json: ${res.status}`);
      const json = await res.json();
      this._store[exchange] = json;
      return json;
    } catch(e) {
      console.error('DataCache.get failed:', e);
      return { exchange, label: '', asOf: '', mood: {}, stats: { total: 0, moodCounts: {} }, stocks: [] };
    }
  },
  async getMeta() {
    if (this._store._meta) return this._store._meta;
    try {
      const res = await fetch('data/meta.json');
      if (!res.ok) throw new Error(`meta.json: ${res.status}`);
      this._store._meta = await res.json();
    } catch(e) {
      console.error('DataCache.getMeta failed:', e);
      this._store._meta = { generatedAt: null, csvSource: '', source: '' };
    }
    return this._store._meta;
  },
  async getIndex() {
    if (this._store._index) return this._store._index;
    try {
      const res = await fetch('data/index.json');
      if (!res.ok) throw new Error(`index.json: ${res.status}`);
      this._store._index = await res.json();
    } catch(e) {
      console.error('DataCache.getIndex failed:', e);
      this._store._index = {};
    }
    return this._store._index;
  },
  async getSearchIndex() {
    if (this._store._search) return this._store._search;
    try {
      const res = await fetch('data/search.json?v=20260416a');
      if (!res.ok) throw new Error(`search.json: ${res.status}`);
      this._store._search = await res.json();
    } catch(e) {
      console.error('DataCache.getSearchIndex failed:', e);
      this._store._search = [];
    }
    return this._store._search;
  },
  async getSearchLite() {
    if (this._store._searchLite) return this._store._searchLite;
    try {
      const res = await fetch('data/search-lite.json');
      if (!res.ok) throw new Error(`search-lite.json: ${res.status}`);
      this._store._searchLite = await res.json();
    } catch(e) {
      console.error('DataCache.getSearchLite failed:', e);
      this._store._searchLite = [];
    }
    return this._store._searchLite;
  },
  async getGlobalStock(ticker) {
    const idx = await this.getSearchIndex();
    return idx.find(e => e.t === ticker) || null;
  },
  async getChunk(ticker) {
    const ch = ticker[0].toLowerCase();
    const key = `chunk_${ch}`;
    return this.get(key);
  },
  async getFullStock(ticker, country) {
    try {
      const data = await this.getChunk(ticker);
      const matches = data.stocks.filter(s => s.ticker === ticker);
      if (country && matches.length > 1) {
        return matches.find(s => s.country === country) || matches[0] || null;
      }
      return matches[0] || null;
    } catch(e) { return null; }
  },
  clear() { this._store = {}; },
  async searchAll(query) {
    const q = query.toLowerCase().trim();
    if (!q || q.length < 1) return [];
    const idx = await this.getSearchLite();
    const results = [];
    for (const entry of idx) {
      if (
        entry.t.toLowerCase().includes(q) ||
        (entry.n && entry.n.toLowerCase().includes(q))
      ) {
        const mood = entry.m
          ? (() => { const b = MOOD_BANDS_JS.find(b => b.label === entry.m) || MOOD_BANDS_JS[2];
              return { label: b.label, colorKey: b.colorKey, color: b.color, score: null, pct: 50 }; })()
          : { label: 'Level 3', colorKey: 'neutral', color: '#A3A3A3', score: null, pct: 50 };
        results.push({
          ticker:        entry.t,
          company:       entry.n,
          mood,
          country:       entry.co || '',
          exchange:      entry.x || 'global',
          exchangeLabel: EXCHANGE_LABELS[entry.x] || 'Global',
        });
      }
      if (results.length >= 40) break;
    }
    return results.slice(0, 25);
  },
};

/* ── Nav stamp ───────────────────────────────────────────────────────────── */
async function initNavStamp() {
  try {
    const meta = await DataCache.getMeta();
    const el = document.querySelector('.nav-stamp span');
    if (el && meta.generatedAt) {
      const d = new Date(meta.generatedAt);
      el.textContent = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
  } catch(e) {}
}

/* ── Global tooltip ──────────────────────────────────────────────────────── */
function initTooltip() {
  const tip = document.getElementById('global-tooltip');
  if (!tip) return;
  const lbl = tip.querySelector('.tt-label');
  const val = tip.querySelector('.tt-value');
  const dot = tip.querySelector('.tt-dot');
  const dsc = tip.querySelector('.tt-desc');

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.classList.remove('visible'); return; }
    const { indKey, indColor, indValue } = el.dataset;
    const meta = IND_META[indKey];
    if (!meta) return;
    const colors = { green: '#4ADE80', amber: '#FBBF24', red: '#F87171' };
    lbl.textContent = meta.label;
    dot.style.background = colors[indColor] || '#8A9E8F';
    val.childNodes[val.childNodes.length - 1]?.remove?.();
    val.appendChild(document.createTextNode(indValue || '—'));
    dot.style.display = 'inline-block';
    dsc.textContent = meta.desc;
    const rect = el.getBoundingClientRect();
    tip.style.left = Math.min(rect.left, window.innerWidth - 280) + 'px';
    tip.style.top  = (rect.bottom + 8) + 'px';
    tip.classList.add('visible');
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-tip]')) tip.classList.remove('visible');
  });
}

/* ── Global search ───────────────────────────────────────────────────────── */

function initGlobalSearch(inputSel, resultsSel, onSelect) {
  const input   = document.querySelector(inputSel);
  const results = document.querySelector(resultsSel);
  if (!input || !results) return;

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 1) { results.classList.remove('open'); return; }
      const hits = await DataCache.searchAll(q);
      if (!hits.length) {
        const empty = document.createElement('div');
        empty.className = 'sr-empty';
        empty.textContent = `No stocks found for "${q}"`;
        results.replaceChildren(empty);
      } else {
        const fragment = document.createDocumentFragment();
        hits.forEach(s => {
          const b = MOOD.band(s.mood?.label || 'Level 3');

          const item = document.createElement('div');
          item.className = 'sr-item';
          item.dataset.ticker = s.ticker ?? '';
          item.dataset.exchange = s.exchange ?? '';

          const tickerEl = document.createElement('div');
          tickerEl.className = 'sr-ticker';
          tickerEl.textContent = s.ticker ?? '';

          const companyEl = document.createElement('div');
          companyEl.className = 'sr-company';
          companyEl.textContent = s.company ?? '';

          const exchangeEl = document.createElement('div');
          exchangeEl.className = 'sr-exchange';
          exchangeEl.textContent = s.exchangeLabel ?? '';

          const pandaWrap = document.createElement('div');
          pandaWrap.className = 'sr-panda panda-wrap';

          const img = document.createElement('img');
          img.className = 'panda-img';
          img.src = `assets/img/${b.img}`;
          img.alt = b.label ?? '';

          pandaWrap.appendChild(img);
          item.append(tickerEl, companyEl, exchangeEl, pandaWrap);
          fragment.appendChild(item);
        });
        results.replaceChildren(fragment);
      }
      results.classList.add('open');
    }, 250);
  });

  results.addEventListener('click', e => {
    const item = e.target.closest('.sr-item');
    if (!item) return;
    results.classList.remove('open');
    input.value = '';
    if (onSelect) onSelect(item.dataset.ticker, item.dataset.exchange);
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.classList.remove('open');
    }
  });
}

/* ── DOM helpers (private to this module) ────────────────────────────────── */

/* Creates a mood chip <span> as a DOM node — no innerHTML involved. */
function _chipNode(label) {
  const display = label;
  const b = MOOD.band(label);
  const span = document.createElement('span');
  span.className = `mood-chip ${b.cls}`;
  span.textContent = display ?? '';
  span.title = MOOD_DESC[label] || '';
  return span;
}

/* Creates a swing indicator <span> as a DOM node — no innerHTML involved. */
function _swingNode(swing) {
  const span = document.createElement('span');
  if (!swing || swing.state === 'flat' || swing.delta === 0) {
    span.className = 'swing sw-flat';
    span.textContent = '● 0';
    return span;
  }
  const abs = Math.abs(swing.delta);
  if (swing.state === 'up') {
    span.className = 'swing sw-up';
    span.textContent = `↑ ${abs}`;
  } else if (swing.state === 'red') {
    span.className = 'swing sw-red';
    span.textContent = `↓ ${abs}`;
  } else {
    span.className = 'swing sw-amber';
    span.textContent = `↓ ${abs}`;
  }
  return span;
}

/* Creates a single indicator row <div> as a DOM node. */
function _indRowNode(key, ind) {
  const meta = IND_META[key];
  if (!meta) return null;
  const colorMap = { green: '#4ADE80', amber: '#FBBF24', red: '#F87171' };
  const c = colorMap[ind.color] || '#8A9E8F';

  const row = document.createElement('div');
  row.className = 'ind-row';

  const dot = document.createElement('div');
  dot.className = 'ind-dot-lg';
  dot.style.background = c;

  const inner = document.createElement('div');

  const name = document.createElement('div');
  name.className = 'ind-name';
  name.textContent = meta.label;

  const value = document.createElement('div');
  value.className = 'ind-value';
  value.style.color = c;
  value.textContent = ind.label ?? '';

  const explain = document.createElement('div');
  explain.className = 'ind-explain';
  explain.textContent = meta.desc;

  inner.append(name, value, explain);
  row.append(dot, inner);
  return row;
}

/* ── Stock sidebar ───────────────────────────────────────────────────────── */
function buildSidebar(stock, exchangeLabel) {
  if (!stock) return;
  const b = MOOD.band(stock.mood?.label || 'Level 3');

  const sidebar = document.getElementById('stock-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar) return;

  /* ── Header ── */
  const hd = document.createElement('div');
  hd.className = 'sidebar-hd';

  const hdLeft = document.createElement('div');

  const tickerEl = document.createElement('div');
  tickerEl.className = 'sidebar-ticker';
  tickerEl.textContent = stock.ticker ?? '';

  const companyEl = document.createElement('div');
  companyEl.className = 'sidebar-company';
  companyEl.textContent = stock.company || exchangeLabel || '';

  const badgeRow = document.createElement('div');
  badgeRow.style.cssText = 'margin-top:6px;display:flex;gap:6px;align-items:center;';
  badgeRow.append(_chipNode(stock.mood?.label), _swingNode(stock.swing));

  hdLeft.append(tickerEl, companyEl, badgeRow);

  const pandaWrap = document.createElement('div');
  pandaWrap.className = 'sidebar-panda panda-wrap';

  const pandaImg = document.createElement('img');
  pandaImg.className = 'panda-img';
  pandaImg.src = `assets/img/${b.img}`;
  pandaImg.alt = b.label;

  pandaWrap.appendChild(pandaImg);
  hd.append(hdLeft, pandaWrap);

  /* ── Body ── */
  const body = document.createElement('div');
  body.className = 'sidebar-body';

  const priceSection = document.createElement('div');
  priceSection.style.marginBottom = '1rem';

  const priceLbl = document.createElement('div');
  priceLbl.style.cssText = 'font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;';
  priceLbl.textContent = 'Current Price';

  const priceVal = document.createElement('div');
  priceVal.style.cssText = 'font-family:var(--mono);font-size:1.2rem;font-weight:700;color:var(--parchment)';
  priceVal.textContent = stock.price != null ? stock.price.toLocaleString() : '—';

  if (stock.priceChange != null) {
    const changeSpan = document.createElement('span');
    changeSpan.style.cssText = `font-size:0.8rem;color:${stock.priceChange >= 0 ? 'var(--green)' : 'var(--red)'}`;
    changeSpan.textContent = ` ${stock.priceChange >= 0 ? '+' : ''}${stock.priceChange.toFixed(2)}`;
    priceVal.appendChild(changeSpan);
  }

  priceSection.append(priceLbl, priceVal);

  const indLbl = document.createElement('div');
  indLbl.style.cssText = 'font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.5rem;';
  indLbl.textContent = '11 Indicators';

  body.append(priceSection, indLbl);

  const inds = stock.indicators || {};
  IND_ORDER.forEach(key => {
    const ind = inds[key];
    if (!ind) return;
    const rowNode = _indRowNode(key, ind);
    if (rowNode) body.appendChild(rowNode);
  });

  /* ── Assemble ── */
  sidebar.replaceChildren(hd, body);

  sidebar.classList.add('open');
  if (overlay) overlay.classList.add('open');

  sidebar.querySelector('.sidebar-close')?.addEventListener('click', closeSidebar);
}

function closeSidebar() {
  document.getElementById('stock-sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
}

/* ── Shared nav close button ─────────────────────────────────────────────── */
function injectSidebarHTML() {
  /* Sidebar overlay */
  const sidebarOverlay = document.createElement('div');
  sidebarOverlay.className = 'sidebar-overlay';
  sidebarOverlay.id = 'sidebar-overlay';
  sidebarOverlay.addEventListener('click', closeSidebar);

  /* Sidebar panel */
  const sidebarPanel = document.createElement('div');
  sidebarPanel.className = 'sidebar';
  sidebarPanel.id = 'stock-sidebar';

  const sidebarHd = document.createElement('div');
  sidebarHd.className = 'sidebar-hd';

  const sidebarHdLeft = document.createElement('div');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sidebar-close';
  closeBtn.textContent = '✕ Close';
  closeBtn.addEventListener('click', closeSidebar);

  sidebarHd.append(sidebarHdLeft, closeBtn);
  sidebarPanel.appendChild(sidebarHd);

  /* Tooltip */
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.id = 'global-tooltip';

  const ttLabel = document.createElement('div');
  ttLabel.className = 'tt-label';

  const ttValue = document.createElement('div');
  ttValue.className = 'tt-value';

  const ttDot = document.createElement('div');
  ttDot.className = 'tt-dot';
  ttValue.appendChild(ttDot);

  const ttDesc = document.createElement('div');
  ttDesc.className = 'tt-desc';

  tooltip.append(ttLabel, ttValue, ttDesc);

  /* Search results */
  const searchResults = document.createElement('div');
  searchResults.className = 'search-results';
  searchResults.id = 'global-search-results';

  /* Pro modal */
  const proModal = document.createElement('div');
  proModal.id = 'pro-modal';
  proModal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(5px);z-index:1200;align-items:center;justify-content:center;';
  proModal.innerHTML =
    '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:2rem;width:min(400px,92vw);text-align:center;">' +
      '<div style="font-family:var(--font);font-size:1.3rem;font-weight:700;color:var(--parchment);margin-bottom:1rem;">Get StockPanda Pro</div>' +
      '<div style="display:flex;flex-direction:column;gap:0.5rem;text-align:left;margin-bottom:1.5rem;">' +
        '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;color:var(--text);"><span style="color:var(--green);">&#10003;</span> Save Scans and Traps</div>' +
        '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;color:var(--text);"><span style="color:var(--green);">&#10003;</span> Historical Trends</div>' +
        '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;color:var(--text);"><span style="color:var(--green);">&#10003;</span> Personalised Styles</div>' +
        '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;color:var(--text);"><span style="color:var(--green);">&#10003;</span> Stock Alerts</div>' +
        '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;color:var(--text);"><span style="color:var(--green);">&#10003;</span> Watchlist and Portfolio</div>' +
      '</div>' +
      '<a href="https://tally.so/r/waqMdX" target="_blank" style="display:block;width:100%;background:var(--green);color:#000;font-weight:700;padding:0.75rem;border-radius:10px;border:none;font-size:0.88rem;cursor:pointer;font-family:var(--font);text-decoration:none;text-align:center;">Get early access</a>' +
      '<button onclick="closeProModal()" style="background:none;border:none;color:var(--muted);font-size:0.75rem;cursor:pointer;margin-top:0.6rem;font-family:var(--font);">Maybe later</button>' +
    '</div>';
  proModal.addEventListener('click', function(e) { if (e.target === proModal) closeProModal(); });

  document.body.append(sidebarOverlay, sidebarPanel, tooltip, searchResults, proModal);
}

function openProModal() {
  document.getElementById('pro-modal').style.display = 'flex';
}
function closeProModal() {
  document.getElementById('pro-modal').style.display = 'none';
}

/* ── PWA: register service worker + expose install prompt ───────── */
(function sp_pwa() {
  // Register service worker once the page is idle
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('[pwa] sw register failed', err);
      });
    });
  }

  // Capture the install prompt event so we can trigger it later
  let _deferredPrompt = null;

  function _showInstallButtons(show) {
    document.querySelectorAll('.sp-install-btn').forEach(el => {
      el.style.display = show ? '' : 'none';
    });
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredPrompt = e;
    _showInstallButtons(true);
  });

  window.addEventListener('appinstalled', () => {
    _deferredPrompt = null;
    _showInstallButtons(false);
    try { localStorage.setItem('sp_installed', '1'); } catch (_) {}
  });

  // Initial state: hide buttons unless the prompt has already fired
  document.addEventListener('DOMContentLoaded', () => {
    _showInstallButtons(!!_deferredPrompt);
  });

  window.spInstallApp = async function spInstallApp() {
    if (!_deferredPrompt) {
      // iOS Safari has no install prompt API — surface the dedicated banner instead
      if (_isIosSafari() && !_isStandalone()) {
        _showIosInstallBanner(true);
        return;
      }
      alert('To get the StockPanda app, use your browser\'s menu → "Add to Home Screen".');
      return;
    }
    _deferredPrompt.prompt();
    try { await _deferredPrompt.userChoice; } catch (_) {}
    _deferredPrompt = null;
    _showInstallButtons(false);
  };

  // ── iOS-only: inline instructional banner (iOS Safari has no install API) ──
  function _isIosSafari() {
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
    if (!isIos) return false;
    // Exclude in-app browsers + Chrome/Firefox on iOS (they can't Add-to-Home-Screen reliably)
    const isInApp = /FBAN|FBAV|Instagram|Line|Twitter|TikTok|Pinterest|Snapchat/i.test(ua);
    const isNonSafari = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
    return !isInApp && !isNonSafari;
  }
  function _isStandalone() {
    return (window.navigator.standalone === true) ||
           (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function _showIosInstallBanner(force) {
    if (!_isIosSafari() || _isStandalone()) return;
    try {
      if (!force && localStorage.getItem('sp_ios_install_dismissed') === '1') return;
    } catch (_) {}
    if (document.getElementById('sp-ios-install-banner')) return;

    const bar = document.createElement('div');
    bar.id = 'sp-ios-install-banner';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Install StockPanda');
    bar.innerHTML =
      '<div class="sp-ios-ib-inner">' +
        '<span class="sp-ios-ib-text">' +
          '<b>Install StockPanda</b> — tap ' +
          '<span class="sp-ios-ib-share" aria-hidden="true">' +
            '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M8 10V1.5"/><path d="M5 4.5L8 1.5l3 3"/><path d="M3 7.5v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-6"/>' +
            '</svg>' +
          '</span> Share, then <b>Add to Home Screen</b>.' +
        '</span>' +
        '<button type="button" class="sp-ios-ib-close" aria-label="Dismiss">\u2715</button>' +
      '</div>';

    document.body.appendChild(bar);
    document.body.classList.add('sp-ios-ib-open');
    bar.querySelector('.sp-ios-ib-close').addEventListener('click', () => {
      bar.remove();
      document.body.classList.remove('sp-ios-ib-open');
      try { localStorage.setItem('sp_ios_install_dismissed', '1'); } catch (_) {}
    });
  }

  // Inject the banner's styles once (scoped)
  (function _injectIosInstallStyles() {
    if (document.getElementById('sp-ios-ib-style')) return;
    const s = document.createElement('style');
    s.id = 'sp-ios-ib-style';
    s.textContent =
      '#sp-ios-install-banner{position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'background:#0E100F;border-bottom:1px solid rgba(74,222,128,0.25);' +
      'color:#e8f0e8;font-family:var(--font, "DM Sans", system-ui, sans-serif);' +
      'font-size:0.82rem;line-height:1.35;padding:0.55rem 0.75rem;box-shadow:0 2px 12px rgba(0,0,0,0.4);}' +
      '#sp-ios-install-banner .sp-ios-ib-inner{display:flex;align-items:center;gap:0.6rem;max-width:720px;margin:0 auto;}' +
      '#sp-ios-install-banner .sp-ios-ib-icon{font-size:1.1rem;flex-shrink:0;}' +
      '#sp-ios-install-banner .sp-ios-ib-text{flex:1;min-width:0;}' +
      '#sp-ios-install-banner .sp-ios-ib-text b{color:#4ADE80;font-weight:600;}' +
      '#sp-ios-install-banner .sp-ios-ib-share{display:inline-flex;align-items:center;justify-content:center;' +
      'vertical-align:middle;padding:1px 4px;border:1px solid rgba(74,222,128,0.4);border-radius:4px;' +
      'color:#4ADE80;margin:0 1px;}' +
      '#sp-ios-install-banner .sp-ios-ib-close{background:none;border:none;color:#8a9f8a;font-size:1rem;' +
      'line-height:1;padding:4px 6px;cursor:pointer;flex-shrink:0;border-radius:4px;}' +
      '#sp-ios-install-banner .sp-ios-ib-close:hover{color:#e8f0e8;background:rgba(255,255,255,0.06);}' +
      /* Push page content down so the fixed banner doesn't cover the nav */
      'body.sp-ios-ib-open{padding-top:56px;}';
    document.head.appendChild(s);
  })();

  document.addEventListener('DOMContentLoaded', () => { _showIosInstallBanner(false); });
})();
