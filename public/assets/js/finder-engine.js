/* ── StockPanda Finder Engine ─────────────────────────────────────────────────
   Shared constants, data functions, and rendering for Quick Trap & Custom Trap.
   Loaded after mood.js — uses esc(), MOOD, MOOD_DESC, DataCache from mood.js.
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

// ── Indicator constants ──────────────────────────────────────────────────────
const IC_ORDER = ['volatility','volSpike','vsPeak','shortTrend','longTrend','maCross','momentum','return1M','return1Y','range52W','cagr5Y'];
const IC_MAP   = {g:'green', a:'amber', r:'red'};
const MOOD_COLOR_LABELS = {'mc-blue':'Level 1','mc-green':'Level 2','mc-amber':'Level 3','mc-orange':'Level 4','mc-red':'Level 5'};

// ── Hunting style presets v2 — weighted scoring ─────────────────────────────
// Each criterion: core (×2) or supporting (×1). Only active criteria count.
// score = (weighted sum) / (max weighted sum) × 100
const PRESETS = {
  trophy: { label: 'Trophy', sub: 'Focuses on proven long-term winners with strong earnings and dominant positioning.',
    criteria: [
      { key:'growth5y', expect:'strong',      weight:2 },
      { key:'profit',   expect:'profitable',  weight:2 },
      { key:'momentum', expect:'positive',    weight:1 },
      { key:'matrend',  expect:'above_both',  weight:1 },
      { key:'size',     expect:'large',       weight:1 },
      { key:'analyst',  expect:'buy',         weight:1 },
      { key:'drawdown', expect:'near_peak',   weight:1 },
    ],
  },
  wild_beast: { label: 'Rollercoaster', sub: 'High-volatility large/mid caps with strong recent gains. Volatile big winners — not for the faint-hearted.',
    criteria: [
      { key:'vol',      expect:'high',            weight:2 },
      { key:'return1y', expect:'strong_positive', weight:2 },
      { key:'momentum', expect:'positive',        weight:1 },
      { key:'return1m', expect:'positive',        weight:1 },
      { key:'size',     expect:'mid_or_small',    weight:1 },
      { key:'range52w', expect:'highs',           weight:1 },
    ],
  },
  scavenger: { label: 'Scavenger', sub: 'Finds high-quality stocks that have been beaten down — real bargains with proven fundamentals.',
    criteria: [
      { key:'profit',   expect:'profitable', weight:2 },
      { key:'growth5y', expect:'strong',     weight:2 },
      { key:'drawdown', expect:'deep',       weight:2 },
      { key:'range52w', expect:'lows',       weight:1 },
      { key:'analyst',  expect:'buy',        weight:1 },
      { key:'size',     expect:'large',      weight:1 },
    ],
  },
  momentum: { label: 'Momentum', sub: 'Identifies stocks in sustained uptrends across multiple timeframes.',
    criteria: [
      { key:'momentum', expect:'positive',   weight:2 },
      { key:'matrend',  expect:'above_both', weight:2 },
      { key:'return1m', expect:'positive',   weight:1 },
      { key:'growth5y', expect:'strong',     weight:1 },
      { key:'range52w', expect:'highs',      weight:1 },
      { key:'drawdown', expect:'near_peak',  weight:1 },
    ],
  },
  rebound: { label: 'Rebound', sub: 'Stocks that had a rough patch and are now climbing back — V-shape recoveries in motion.',
    criteria: [
      { key:'drawdown', expect:'deep',     weight:2 },
      { key:'matrend',  expect:'above_50', weight:2 },
      { key:'return1m', expect:'positive', weight:2 },
      { key:'momentum', expect:'positive', weight:1 },
      { key:'range52w', expect:'middle',   weight:1 },
    ],
  },
  moonshot: { label: 'Moonshot', sub: 'Small, volatile companies running hot with successive wins and a Golden Cross. Micro-cap lottery tickets — big upside, big downside.',
    advanced: true,  // surface with "advanced" copy in the style picker
    criteria: [
      { key:'size',     expect:'micro',         weight:2 },
      { key:'vol',      expect:'high',          weight:2 },
      { key:'return1y', expect:'very_positive', weight:2 },
      { key:'matrend',  expect:'above_both',    weight:2 },  // Golden Cross
      { key:'momentum', expect:'positive',      weight:2 },  // successive wins (3M)
      { key:'return1m', expect:'positive',      weight:2 },  // successive wins (1M)
      { key:'range52w', expect:'highs',         weight:1 },
    ],
  },
};

// Display labels — internal keys stay stable; labels are what users see.
const STYLE_ICONS = {
  trophy:'🏆', wild_beast:'🎢', scavenger:'🐘', momentum:'🚀', rebound:'🐇', moonshot:'🦄',
  neutral_mega:'🐳', neutral_large:'🦒', neutral_small:'🦌', neutral_micro:'🐹',
};
const STYLE_NAMES = {
  trophy:'Pack Leader', wild_beast:'Rollercoaster', scavenger:'Sleeping Giant',
  momentum:'High Flyer', rebound:'Recovery', moonshot:'Moonshot',
  neutral_mega:'Neutral Mega', neutral_large:'Neutral Large',
  neutral_small:'Neutral Small', neutral_micro:'Neutral Micro',
};
const STYLE_DESCS = {
  trophy:'Big proven compounders', wild_beast:'Volatile quality large caps',
  scavenger:'Big fallers not recovering', momentum:'On a sustained roll',
  rebound:'Bouncing back from drawdown', moonshot:'Small caps doing well',
  neutral_mega:'Mega-cap, no strong style right now ($200B+)',
  neutral_large:'Large-cap, no strong style right now ($10B+)',
  neutral_small:'Small/mid-cap, no strong style right now ($2B+)',
  neutral_micro:'Micro-cap, no strong style right now ($500M+)',
};

// ── Region / sector config ───────────────────────────────────────────────────
const EUROPE_COUNTRIES = new Set(['United Kingdom','Ireland','Sweden','France','Germany','Italy','Switzerland','Poland','Norway','Spain','Russian Federation','Finland','Denmark','Netherlands','Belgium','Greece','Austria','Luxembourg','Portugal','Bulgaria','Croatia','Romania','Hungary','Iceland','Slovenia','Lithuania','Estonia','Malta','Latvia','Slovakia','Czech Republic','Liechtenstein','Monaco','Serbia','Cyprus']);
const MIDDLEEAST_COUNTRIES = new Set(['Saudi Arabia','United Arab Emirates','Israel','Kuwait','Qatar','Bahrain','Egypt','Jordan','Morocco','Tunisia','Nigeria','Kenya','South Africa']);
const REGION_CONFIG = {
  global:     { countries: null },
  us:         { countries: new Set(['United States']) },
  uk:         { countries: new Set(['United Kingdom','Ireland']) },
  europe:     { countries: EUROPE_COUNTRIES },
  hk:         { countries: new Set(['Hong Kong','Macau']) },
  china:      { countries: new Set(['China','Hong Kong']) },
  japan:      { countries: new Set(['Japan']) },
  germany:    { countries: new Set(['Germany']) },
  france:     { countries: new Set(['France']) },
  india:      { countries: new Set(['India']) },
  middleeast: { countries: MIDDLEEAST_COUNTRIES },
};

const SECTOR_GROUPS = {
  tech:       new Set(['Electronic technology', 'Technology services']),
  health:     new Set(['Health technology', 'Health services']),
  finance:    new Set(['Finance']),
  energy:     new Set(['Energy minerals', 'Non-energy minerals', 'Process industries']),
  consumer:   new Set(['Consumer non-durables', 'Consumer durables', 'Consumer services', 'Retail trade']),
  industrial: new Set(['Producer manufacturing', 'Industrial services', 'Distribution services', 'Transportation']),
  utilities:  new Set(['Utilities', 'Communications']),
};

// ── Country flag mapping ─────────────────────────────────────────────────────
const COUNTRY_FLAGS = {
  'United States':'🇺🇸','Canada':'🇨🇦','United Kingdom':'🇬🇧','Ireland':'🇮🇪','France':'🇫🇷','Germany':'🇩🇪',
  'Italy':'🇮🇹','Switzerland':'🇨🇭','Spain':'🇪🇸','Netherlands':'🇳🇱','Sweden':'🇸🇪','Norway':'🇳🇴','Denmark':'🇩🇰',
  'Finland':'🇫🇮','Belgium':'🇧🇪','Austria':'🇦🇹','Poland':'🇵🇱','Portugal':'🇵🇹','Greece':'🇬🇷',
  'Japan':'🇯🇵','China':'🇨🇳','Hong Kong':'🇭🇰','Taiwan':'🇹🇼','South Korea':'🇰🇷','India':'🇮🇳',
  'Singapore':'🇸🇬','Thailand':'🇹🇭','Indonesia':'🇮🇩','Malaysia':'🇲🇾','Philippines':'🇵🇭','Vietnam':'🇻🇳',
  'Australia':'🇦🇺','New Zealand':'🇳🇿','Brazil':'🇧🇷','Mexico':'🇲🇽','Argentina':'🇦🇷','Chile':'🇨🇱','Colombia':'🇨🇴',
  'Saudi Arabia':'🇸🇦','United Arab Emirates':'🇦🇪','Israel':'🇮🇱','South Africa':'🇿🇦','Nigeria':'🇳🇬',
  'Egypt':'🇪🇬','Kuwait':'🇰🇼','Qatar':'🇶🇦','Turkey':'🇹🇷','Russian Federation':'🇷🇺',
};

// ── Data functions ───────────────────────────────────────────────────────────

function getIndicatorColor(stock, key) {
  if (stock.indicators) return stock.indicators[key]?.color;
  const ic = stock._ic || '';
  const idx = IC_ORDER.indexOf(key);
  return idx >= 0 ? IC_MAP[ic[idx]] : undefined;
}

function normalizeSearchEntry(e, exchLabels) {
  const ic = e.ic || '';
  const indicators = {};
  IC_ORDER.forEach((key, i) => {
    const c = IC_MAP[ic[i]];
    if (c) indicators[key] = { color: c, label: c.charAt(0).toUpperCase() + c.slice(1) };
  });
  return {
    ticker:        e.t,
    company:       e.n,
    price:         e.p,
    currency:      e.c,
    priceChange:   0,
    mood:          { label: MOOD_COLOR_LABELS[e.m] || e.m || 'Level 3', colorKey: e.m, score: e.s, pct: e.r ?? 50 },
    indicators,
    exchangeKey:   e.x || 'global',
    exchangeLabel: (exchLabels && exchLabels[e.x]) || e.co || 'Global',
    country:       e.co,
    sector:        e.sec,
    _ic:           ic,
    _fromSearch:   true,
    _mc:           e.mc,
    _r52:          e.r52,
    _eps:          e.eps,
    _ar:           e.ar,
    _m1:           e.m1,
    _m3:           e.m3,
    _y1:           e.y1,
    _y5:           e.y5,
    _ma50:         e.ma50,
    _ma200:        e.ma200,
    _dte:          e.dte,
    _fcf:          e.fcf,
    _ni:           e.ni,
    _ps:           e.ps || {},
    lbs:           e.lbs || [],
  };
}

function sectorMatches(stock, ans) {
  const sec = ans.sector;
  if (!sec || sec === 'all') return true;
  const groups = Array.isArray(sec) ? sec : [sec];
  const stockSec = stock.sector || '';
  for (const g of groups) {
    const set = SECTOR_GROUPS[g];
    if (set && set.has(stockSec)) return true;
  }
  return false;
}

// ── Single criterion scorer (shared by presets and quiz) ─────────────────────
function _scoreCriterion(key, expect, stock) {
  const col = k => getIndicatorColor(stock, k);
  const gs = k => col(k) === 'green' ? 1 : col(k) === 'amber' ? 0.5 : 0;
  const ms = k => col(k) === 'amber' ? 1 : col(k) === 'green' ? 0.5 : 0;
  const rs = k => col(k) === 'red'   ? 1 : col(k) === 'amber' ? 0.5 : 0;
  const mc  = stock._mc;
  const r52 = stock._r52;
  const eps = stock._eps;
  const ar  = stock._ar || '';

  if (key === 'size') {
    if (expect === 'large') return mc >= 10e9 ? 1 : mc >= 2e9 ? 0.5 : 0;
    if (expect === 'mid')   return mc >= 2e9 && mc < 10e9 ? 1 : mc >= 500e6 ? 0.5 : 0;
    if (expect === 'small') return mc < 2e9 ? 1 : mc < 10e9 ? 0.5 : 0;
  }
  if (key === 'return1m') {
    if (expect === 'positive') return gs('return1M');
    if (expect === 'recovery') return rs('return1M');
  }
  if (key === 'growth5y') {
    if (expect === 'strong')   return gs('cagr5Y');
    if (expect === 'recovery') return rs('cagr5Y');
  }
  if (key === 'momentum') {
    if (expect === 'positive') return gs('momentum');
    if (expect === 'neutral') {
      // green → 1 (not 0.5): "not falling" rather than "must be flat"
      const c = col('momentum');
      return (c === 'amber' || c === 'green') ? 1 : 0;
    }
  }
  if (key === 'matrend') {
    const sCol = col('shortTrend'), lCol = col('longTrend');
    if (expect === 'above_both') return sCol === 'green' && lCol === 'green' ? 1 : (sCol === 'green' || lCol === 'green') ? 0.5 : 0;
    if (expect === 'above_50')   return sCol === 'green' ? 1 : sCol === 'amber' ? 0.5 : 0;
    if (expect === 'below_both') return sCol === 'red' && lCol === 'red' ? 1 : (sCol === 'red' || lCol === 'red') ? 0.5 : 0;
  }
  if (key === 'range52w') {
    if (expect === 'highs')  return gs('range52W');
    if (expect === 'middle') return ms('range52W');
    if (expect === 'lows')   return rs('range52W');
  }
  if (key === 'drawdown') {
    // Uses range52w_pct directly — finer thresholds than indicator colors
    if (expect === 'near_peak') return r52 != null ? (r52 >= 80 ? 1 : r52 >= 50 ? 0.5 : 0) : 0.5;
    if (expect === 'moderate')  return r52 != null ? (r52 >= 40 && r52 < 80 ? 1 : r52 >= 20 ? 0.5 : 0) : 0.5;
    if (expect === 'deep')      return r52 != null ? (r52 < 40 ? 1 : r52 < 60 ? 0.5 : 0) : 0.5;
  }
  if (key === 'vol') {
    if (expect === 'low')      return gs('volatility');
    if (expect === 'moderate') return ms('volatility');
    if (expect === 'high')     return rs('volatility');
  }
  if (key === 'analyst') {
    const BUY_SET  = new Set(['Strong buy','Buy']);
    const NEUT_SET = new Set(['Strong buy','Buy','Neutral']);
    if (expect === 'buy')     return BUY_SET.has(ar) ? 1 : ar === 'Neutral' ? 0.5 : 0;
    if (expect === 'neutral') return NEUT_SET.has(ar) ? 1 : 0.5;
  }
  if (key === 'profit') {
    if (expect === 'profitable') return eps != null ? (eps > 0 ? 1 : 0) : 0.5;
  }
  return 1;
}

function scoreByAnswers(stock, ans) {
  // v2: skip "any"/"all" criteria entirely — no free passes
  // All active criteria weighted equally (×1) for quiz answers
  const CRITERIA_KEYS = [
    { key:'size',     ansKey:'size' },
    { key:'return1m', ansKey:'return1m' },
    { key:'growth5y', ansKey:'growth5y' },
    { key:'momentum', ansKey:'momentum' },
    { key:'matrend',  ansKey:'matrend' },
    { key:'range52w', ansKey:'range52w' },
    { key:'drawdown', ansKey:'drawdown' },
    { key:'vol',      ansKey:'vol' },
    { key:'analyst',  ansKey:'analyst' },
    { key:'profit',   ansKey:'profit' },
  ];

  const scores = [];
  let activeSum = 0;
  let activeCount = 0;

  for (const c of CRITERIA_KEYS) {
    const expect = ans[c.ansKey];
    if (!expect || expect === 'any' || expect === 'all') continue; // skip — not active
    // Multi-select answers come through as arrays; user matches if ANY value scores.
    const raw = Array.isArray(expect)
      ? Math.max(...expect.map(e => _scoreCriterion(c.key, e, stock)))
      : _scoreCriterion(c.key, expect, stock);
    scores.push(raw);
    activeSum += raw;
    activeCount++;
  }

  const pct = activeCount > 0 ? Math.round((activeSum / activeCount) * 100) : 0;
  return { scores, total: activeSum, pct };
}

const _EXCH_LABELS = { sp500:'S&P 500', ftse100:'FTSE 100', hsi:'Hang Seng', nikkei225:'Nikkei 225', nasdaq100:'NASDAQ 100', nasdaq_financial:'NASDAQ Financial', nasdaq_biotech:'NASDAQ Biotech' };

async function loadAllStocks(answers) {
  const region  = answers.region || 'global';
  const isGlobal = region === 'global' || region === 'all';
  const regions  = isGlobal ? ['global'] : (Array.isArray(region) ? region : [region]);

  let countrySet = isGlobal ? null : new Set();
  for (const r of regions) {
    const cfg = REGION_CONFIG[r] || {};
    if (countrySet !== null && cfg.countries) cfg.countries.forEach(c => countrySet.add(c));
  }

  const searchData = await DataCache.getSearchIndex();
  const all = [];
  for (const e of searchData) {
    if (countrySet !== null && !countrySet.has(e.co)) continue;
    const stock = normalizeSearchEntry(e, _EXCH_LABELS);
    if (!answers._skipSectorFilter && !sectorMatches(stock, answers)) continue;
    all.push(stock);
  }
  return all;
}

// ── Rendering: Option C (cards) + Option D (table) ───────────────────────────

let _currentView = 'cards';
let _renderedSubset = [];
let _currentScoredCache = [];
let _currentPresetMode = false;
const RENDER_CAP = 200;
const _PRESET_ORDER = ['trophy','scavenger','rebound','momentum','wild_beast','moonshot','neutral_mega','neutral_large','neutral_small','neutral_micro'];

function _countSignals(s) {
  let r = 0, a = 0, g = 0;
  IC_ORDER.forEach(key => {
    const c = s.indicators?.[key]?.color || 'amber';
    if (c === 'red') r++; else if (c === 'amber') a++; else g++;
  });
  if (s._dte != null) { s._dte < 100 ? g++ : s._dte < 200 ? a++ : r++; }
  if (s._fcf != null) { s._fcf > 0 ? g++ : r++; }
  if (s._fcf != null && s._ni != null && s._ni > 0) { const cv = (s._fcf / s._ni) * 100; cv >= 80 ? g++ : cv >= 50 ? a++ : r++; }
  return { g, a, r, total: g + a + r };
}

function _fmt3M(v) {
  if (v == null) return '';
  const col = v >= 0 ? 'pct-pos' : 'pct-neg';
  const sign = v >= 0 ? '+' : '';
  return `<span class="${col}" data-tip="3-month return">${sign}${v.toFixed(1)}%</span>`;
}

function _buildStyleChips(ps) {
  if (!ps || !Object.keys(ps).length) return '';
  const sorted = Object.entries(ps).sort((a, b) => b[1] - a[1]);
  // Only show styles ≥ 40%
  const visible = sorted.filter(([, p]) => p >= 40);
  if (!visible.length) return '';
  const top3 = visible.slice(0, 3);
  const chip = (key, pct) => {
    const col = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
    return `<span class="sc" style="border-color:${col};color:${col};" data-tip="${esc(STYLE_NAMES[key] || key)} — ${esc(STYLE_DESCS[key] || '')}">${STYLE_ICONS[key] || ''} ${pct}%</span>`;
  };
  return `<div class="rc-styles">
    ${top3.map(([k, p]) => chip(k, p)).join('')}
  </div>`;
}

function buildCard(item, rank) {
  const s = item.stock;
  const b = MOOD.band(s.mood?.label || 'Level 3');
  const accent = { 'mc-blue':'#60A5FA','mc-green':'#4ADE80','mc-amber':'#FBBF24','mc-orange':'#FB923C','mc-red':'#F87171' }[b.cls] || '#FBBF24';
  const sig = _countSignals(s);
  const flag = COUNTRY_FLAGS[s.country] || '';
  const href = `stock.html?ticker=${encodeURIComponent(s.ticker)}&country=${encodeURIComponent(s.country || '')}`;

  return `<div class="rc" style="border-left-color:${accent};" onclick="window.location.href='${href}'">
    <div class="rc-rank${rank <= 3 ? ' top' : ''}">${rank}</div>
    <div class="rc-id">
      <div class="rc-ticker">${esc(s.ticker)}</div>
      <div class="rc-company">${esc(s.company || '—')}</div>
      <div class="rc-geo">
        <span class="rc-country">${flag} ${esc(s.country || '')}</span>
        ${_fmt3M(s._m3)}
      </div>
    </div>
    <div class="rc-center">
      <div class="rc-top">
        <span class="mood-chip ${b.cls}" data-tip="${esc(MOOD_DESC[b.label] || '')}">${b.label}</span>
        <div class="rc-counts">
          ${sig.g > 0 ? `<span class="sig-badge-green" data-tip="${sig.g} positive signals">${sig.g}</span>` : ''}
          ${sig.a > 0 ? `<span class="sig-badge-amber" data-tip="${sig.a} cautionary signals">${sig.a}</span>` : ''}
          ${sig.r > 0 ? `<span class="sig-badge-red" data-tip="${sig.r} warning signals">${sig.r}</span>` : ''}
        </div>
      </div>
      ${_buildStyleChips(s._ps)}
    </div>
    <button class="rc-view" onclick="event.stopPropagation();window.location.href='${href}'">View &rarr;</button>
  </div>`;
}

function buildTableRow(item, rank) {
  const s = item.stock;
  const b = MOOD.band(s.mood?.label || 'Level 3');
  const sig = _countSignals(s);
  const flag = COUNTRY_FLAGS[s.country] || '';
  const href = `stock.html?ticker=${encodeURIComponent(s.ticker)}&country=${encodeURIComponent(s.country || '')}`;
  const m3 = s._m3;
  const m3Html = m3 != null ? `<span class="${m3 >= 0 ? 'pct-pos' : 'pct-neg'}">${m3 >= 0 ? '+' : ''}${m3.toFixed(1)}%</span>` : '—';

  const ps = s._ps || {};
  const styleCells = _PRESET_ORDER.map(k => {
    const p = ps[k];
    if (p == null) return '<td class="center">—</td>';
    if (p < 40) return '<td class="center"><span class="t-style-pct dim">—</span></td>';
    const cls = p >= 80 ? 'hi' : p >= 50 ? 'mid' : 'lo';
    return `<td class="center"><span class="t-style-pct ${cls}">${p}</span></td>`;
  }).join('');

  return `<tr onclick="window.location.href='${href}'">
    <td class="t-rank${rank <= 3 ? ' top' : ''}">${rank}</td>
    <td><span class="t-ticker">${esc(s.ticker)}</span><span class="t-company">${esc(s.company || '')}</span></td>
    <td class="t-country">${flag} ${esc(s.country || '')}</td>
    <td class="center">${m3Html}</td>
    <td class="center"><span class="mood-chip ${b.cls}">${b.label.replace('Level ','L')}</span></td>
    <td class="center">${sig.g > 0 ? `<span class="sig-badge-green">${sig.g}</span>` : ''}</td>
    <td class="center">${sig.a > 0 ? `<span class="sig-badge-amber">${sig.a}</span>` : ''}</td>
    <td class="center">${sig.r > 0 ? `<span class="sig-badge-red">${sig.r}</span>` : ''}</td>
    ${styleCells}
  </tr>`;
}

function buildTableHeader() {
  return `<thead><tr>
    <th>#</th>
    <th>Stock</th>
    <th>Country</th>
    <th class="center"><span data-tip="3-month price change">3M</span></th>
    <th class="center">Level</th>
    <th class="center"><span data-tip="Positive signals">🟢</span></th>
    <th class="center"><span data-tip="Cautionary signals">🟡</span></th>
    <th class="center"><span data-tip="Warning signals">🔴</span></th>
    ${_PRESET_ORDER.map(k => `<th class="center"><span data-tip="${esc(STYLE_NAMES[k])} — ${esc(STYLE_DESCS[k])}">${STYLE_ICONS[k]}</span></th>`).join('')}
  </tr></thead>`;
}

function renderFilteredList(subset, scoredCache, presetMode) {
  _renderedSubset = subset;
  _currentScoredCache = scoredCache;
  _currentPresetMode = presetMode;
  const total = scoredCache.length;
  const isFiltered = subset.length !== total;
  const listEl = document.getElementById('results-list');
  const countEl = document.getElementById('filter-count');
  const titleEl = document.getElementById('results-title');

  if (!subset.length) {
    listEl.innerHTML = `<div class="no-results">${presetMode ? 'No stocks found for this filter.' : 'No stocks scored 80%+ — try broadening preferences.'}</div>`;
    if (countEl) countEl.textContent = '0 shown';
    if (titleEl) titleEl.textContent = presetMode ? `0 of ${total} stocks match` : `0 of ${total} fits match`;
    return;
  }

  if (_currentView === 'table') {
    const visible = subset.slice(0, RENDER_CAP);
    const hasMore = subset.length > RENDER_CAP;
    listEl.innerHTML = `<div class="tbl-wrap"><table class="tbl">
      ${buildTableHeader()}
      <tbody>${visible.map((item, i) => buildTableRow(item, i + 1)).join('')}</tbody>
    </table></div>
    ${hasMore ? `<div class="load-more-wrap"><button class="btn-next" onclick="loadMoreResults()">Show more (${subset.length - RENDER_CAP} remaining)</button></div>` : ''}`;
  } else {
    const visible = subset.slice(0, RENDER_CAP);
    const hasMore = subset.length > RENDER_CAP;
    let html = visible.map((item, i) => buildCard(item, i + 1)).join('');
    if (hasMore) {
      html += `<div class="load-more-wrap"><button class="btn-next" onclick="loadMoreResults()">Show more (${subset.length - RENDER_CAP} remaining)</button></div>`;
    }
    listEl.innerHTML = html;
  }

  if (countEl) countEl.textContent = subset.length > RENDER_CAP
    ? `${Math.min(RENDER_CAP, subset.length)} of ${subset.length} shown`
    : `${subset.length} shown`;
  if (titleEl) titleEl.textContent = isFiltered
    ? (presetMode ? `${subset.length} of ${total} stocks match` : `${subset.length} of ${total} fits match`)
    : (presetMode ? `${total} stocks in this filter` : `${total} good & great fits`);
}

function loadMoreResults() {
  const list = document.getElementById('results-list');
  const currentCount = _currentView === 'table'
    ? list.querySelectorAll('.tbl tbody tr').length
    : list.querySelectorAll('.rc').length;
  const nextBatch = _renderedSubset.slice(currentCount, currentCount + RENDER_CAP);
  const hasMore = currentCount + nextBatch.length < _renderedSubset.length;

  const loadMoreWrap = list.querySelector('.load-more-wrap');
  if (loadMoreWrap) loadMoreWrap.remove();

  if (_currentView === 'table') {
    const tbody = list.querySelector('.tbl tbody');
    if (tbody) tbody.insertAdjacentHTML('beforeend', nextBatch.map((item, i) => buildTableRow(item, currentCount + i + 1)).join(''));
  } else {
    const html = nextBatch.map((item, i) => buildCard(item, currentCount + i + 1)).join('');
    // Insert before the end of results-list
    list.insertAdjacentHTML('beforeend', html);
  }

  if (hasMore) {
    const remaining = _renderedSubset.length - currentCount - nextBatch.length;
    list.insertAdjacentHTML('beforeend', `<div class="load-more-wrap"><button class="btn-next" onclick="loadMoreResults()">Show more (${remaining} remaining)</button></div>`);
  }

  const countEl = document.getElementById('filter-count');
  if (countEl) countEl.textContent = hasMore
    ? `${currentCount + nextBatch.length} of ${_renderedSubset.length} shown`
    : `${_renderedSubset.length} shown`;
}
window.loadMoreResults = loadMoreResults;

function switchView(view) {
  _currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  // Re-render with current data
  if (_renderedSubset.length > 0 || _currentScoredCache.length > 0) {
    renderFilteredList(_renderedSubset, _currentScoredCache, _currentPresetMode);
  }
}
window.switchView = switchView;

// ── Filter helpers ───────────────────────────────────────────────────────────

function applyFinderFilter(scoredCache, presetMode, maxLevel) {
  const txt  = (document.getElementById('filter-text')?.value || '').toLowerCase();
  const mood = (document.getElementById('filter-mood')?.value || '').toLowerCase();
  const territory = document.getElementById('filter-territory')?.value || '';
  const country = document.getElementById('filter-country')?.value || '';
  const sector = document.getElementById('filter-sector')?.value || '';
  const terrSet = territory && REGION_CONFIG[territory]?.countries ? REGION_CONFIG[territory].countries : null;
  const maxLvlNum = maxLevel ? parseInt(maxLevel.replace(/\D/g, '')) || 99 : 99;

  const filtered = scoredCache.filter(item => {
    const s = item.stock;
    if (txt && !s.ticker.toLowerCase().includes(txt) && !(s.company||'').toLowerCase().includes(txt)) return false;
    if (mood && (s.mood?.label || '').toLowerCase() !== mood) return false;
    if (maxLevel) {
      const stockLvl = parseInt((s.mood?.label || '').replace(/\D/g, '')) || 99;
      if (stockLvl > maxLvlNum) return false;
    }
    if (terrSet && !terrSet.has(s.country)) return false;
    if (country && s.country !== country) return false;
    if (sector && (s.sector || '') !== sector) return false;
    return true;
  });
  renderFilteredList(filtered, scoredCache, presetMode);
}

function populateFilterDropdowns(scoredCache) {
  const ft = document.getElementById('filter-territory'); if (ft) ft.value = '';
  const fcSel = document.getElementById('filter-country');
  if (fcSel) {
    fcSel.innerHTML = '<option value="">All Countries</option>';
    const cs = new Set(); scoredCache.forEach(item => { if (item.stock.country) cs.add(item.stock.country); });
    [...cs].sort().forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; fcSel.appendChild(o); });
  }
  const fsSel = document.getElementById('filter-sector');
  if (fsSel) {
    fsSel.innerHTML = '<option value="">All Sectors</option>';
    const ss = new Set(); scoredCache.forEach(item => { if (item.stock.sector) ss.add(item.stock.sector); });
    [...ss].sort().forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; fsSel.appendChild(o); });
  }
}

function onFinderTerritoryChange(scoredCache) {
  const territory = document.getElementById('filter-territory')?.value || '';
  const fc = document.getElementById('filter-country');
  if (!fc) return;
  fc.innerHTML = '<option value="">All Countries</option>';
  const terrSet = territory && REGION_CONFIG[territory]?.countries ? REGION_CONFIG[territory].countries : null;
  const countriesInResults = new Set();
  scoredCache.forEach(item => {
    const co = item.stock.country;
    if (terrSet ? terrSet.has(co) : co) countriesInResults.add(co);
  });
  [...countriesInResults].sort().forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c; fc.appendChild(o);
  });
}
