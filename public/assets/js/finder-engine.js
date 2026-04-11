/* ── StockPanda Finder Engine ─────────────────────────────────────────────────
   Shared constants, data functions, and rendering for Quick Trap & Custom Trap.
   Loaded after mood.js — uses esc(), MOOD, MOOD_DESC, DataCache from mood.js.
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

// ── Indicator constants ──────────────────────────────────────────────────────
const IC_ORDER = ['volatility','volSpike','vsPeak','shortTrend','longTrend','maCross','momentum','return1M','return1Y','range52W','cagr5Y'];
const IC_MAP   = {g:'green', a:'amber', r:'red'};
const MOOD_COLOR_LABELS = {'mc-blue':'Level 1','mc-green':'Level 2','mc-amber':'Level 3','mc-orange':'Level 4','mc-red':'Level 5'};

// ── Hunting style presets ────────────────────────────────────────────────────
const PRESETS = {
  optimistic:   { label: 'Optimistic',   sub: 'Turnaround stocks starting to recover after a rough patch.',                          a: { sector:'all', size:'any', return1m:'positive', growth5y:'any',    momentum:'any',      matrend:'any',        range52w:'lows',  drawdown:'deep',      vol:'any',      analyst:'any',     profit:'any'        } },
  nimble:       { label: 'Nimble',       sub: 'Targets early breakouts with strong participation before they become overextended.',   a: { sector:'all', size:'any', return1m:'positive', growth5y:'any',    momentum:'positive', matrend:'above_50',   range52w:'any',   drawdown:'any',       vol:'any',      analyst:'any',     profit:'any'        } },
  momentum:     { label: 'Momentum',     sub: 'Identifies stocks in sustained uptrends across multiple timeframes.',                 a: { sector:'all', size:'any', return1m:'positive', growth5y:'strong', momentum:'positive', matrend:'above_both', range52w:'highs', drawdown:'near_peak', vol:'any',      analyst:'any',     profit:'any'        } },
  pack:         { label: 'Pack',         sub: 'Follows institutional flows and consensus sentiment backed by strong participation.',  a: { sector:'all', size:'large', return1m:'positive', growth5y:'any',  momentum:'positive', matrend:'above_50',   range52w:'highs', drawdown:'any',       vol:'any',      analyst:'buy',     profit:'any'        } },
  patient:      { label: 'Patient',      sub: 'Screens for high-quality stocks consolidating before a potential breakout.',           a: { sector:'all', size:'any', return1m:'any',      growth5y:'strong', momentum:'any',      matrend:'any',        range52w:'lows',  drawdown:'moderate',  vol:'any',      analyst:'any',     profit:'profitable' } },
  safe:         { label: 'Careful',      sub: 'Targets stable, low-risk companies with strong balance sheets and low sensitivity.',   a: { sector:'all', size:'large', return1m:'any',    growth5y:'strong', momentum:'neutral',  matrend:'above_both', range52w:'any',   drawdown:'any',       vol:'low',      analyst:'any',     profit:'profitable' } },
  trophy:       { label: 'Trophy',       sub: 'Focuses on proven long-term winners with strong earnings and dominant positioning.',   a: { sector:'all', size:'large', return1m:'positive', growth5y:'strong', momentum:'positive', matrend:'above_both', range52w:'highs', drawdown:'near_peak', vol:'any',  analyst:'buy',     profit:'profitable' } },
  wild_beast:   { label: 'Wild Beast',   sub: 'Captures high-volatility assets with extreme upside (and downside) potential.',        a: { sector:'all', size:'any', return1m:'any',      growth5y:'any',    momentum:'any',      matrend:'any',        range52w:'any',   drawdown:'any',       vol:'moderate', analyst:'any',     profit:'any'        } },
  zombie:       { label: 'Zombie',       sub: 'Finds heavily beaten-down stocks showing early signs of revival and accumulation.',    a: { sector:'all', size:'any', return1m:'recovery', growth5y:'recovery', momentum:'any',    matrend:'any',        range52w:'lows',  drawdown:'deep',      vol:'any',      analyst:'any',     profit:'any'        } },
};

const STYLE_ICONS = { optimistic:'🐇', nimble:'⚡', momentum:'🚀', pack:'🐺', patient:'🧘', safe:'🛡️', trophy:'🏆', wild_beast:'🧬', zombie:'🧟' };
const STYLE_NAMES = { optimistic:'Optimistic', nimble:'Nimble', momentum:'Momentum', pack:'Pack', patient:'Patient', safe:'Careful', trophy:'Trophy', wild_beast:'Wild Beast', zombie:'Zombie' };
const STYLE_DESCS = { optimistic:'Turnaround recovery', nimble:'Early breakouts', momentum:'Sustained uptrends', pack:'Institutional flows', patient:'Consolidating', safe:'Stable, low-risk', trophy:'Proven winners', wild_beast:'High-volatility', zombie:'Beaten-down revival' };

// ── Region / sector config ───────────────────────────────────────────────────
const EUROPE_COUNTRIES = new Set(['United Kingdom','Ireland','Sweden','France','Germany','Italy','Switzerland','Poland','Norway','Spain','Russian Federation','Finland','Denmark','Netherlands','Belgium','Greece','Austria','Luxembourg','Portugal','Bulgaria','Croatia','Romania','Hungary','Iceland','Slovenia','Lithuania','Estonia','Malta','Latvia','Slovakia','Czech Republic','Liechtenstein','Monaco','Serbia','Cyprus']);
const MIDDLEEAST_COUNTRIES = new Set(['Saudi Arabia','United Arab Emirates','Israel','Kuwait','Qatar','Bahrain','Egypt','Jordan','Morocco','Tunisia','Nigeria','Kenya','South Africa']);
const REGION_CONFIG = {
  global:     { countries: null },
  us:         { countries: new Set(['United States','Canada']) },
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
    _y5:           e.y5,
    _ma50:         e.ma50,
    _ma200:        e.ma200,
    _dte:          e.dte,
    _fcf:          e.fcf,
    _ni:           e.ni,
    _ps:           e.ps || {},
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

function scoreByAnswers(stock, ans) {
  const col = key => getIndicatorColor(stock, key);
  const gs = key => col(key) === 'green' ? 1 : col(key) === 'amber' ? 0.5 : 0;
  const ms = key => col(key) === 'amber' ? 1 : col(key) === 'green' ? 0.5 : 0;
  const rs = key => col(key) === 'red'   ? 1 : col(key) === 'amber' ? 0.5 : 0;

  const mc  = stock._mc;
  const r52 = stock._r52;
  const eps = stock._eps;
  const ar  = stock._ar || '';

  const qSize = ans.size === 'large' ? (mc >= 10e9 ? 1 : mc >= 2e9 ? 0.5 : 0)
              : ans.size === 'mid'   ? (mc >= 2e9 && mc < 10e9 ? 1 : mc >= 500e6 ? 0.5 : 0)
              : ans.size === 'small' ? (mc < 2e9 ? 1 : mc < 10e9 ? 0.5 : 0)
              : 1;

  const q1M  = ans.return1m === 'positive' ? gs('return1M')
             : ans.return1m === 'recovery'  ? rs('return1M')
             : 1;

  const q5Y  = ans.growth5y === 'strong'   ? gs('cagr5Y')
             : ans.growth5y === 'recovery'  ? rs('cagr5Y')
             : 1;

  const qMom = ans.momentum === 'positive' ? gs('momentum')
             : ans.momentum === 'neutral'   ? ms('momentum')
             : 1;

  const sCol = col('shortTrend');
  const lCol = col('longTrend');
  const qMA  = ans.matrend === 'above_both' ? (sCol === 'green' && lCol === 'green' ? 1 : (sCol === 'green' || lCol === 'green') ? 0.5 : 0)
             : ans.matrend === 'above_50'    ? (sCol === 'green' ? 1 : sCol === 'amber' ? 0.5 : 0)
             : ans.matrend === 'below_both'  ? (sCol === 'red' && lCol === 'red' ? 1 : (sCol === 'red' || lCol === 'red') ? 0.5 : 0)
             : 1;

  const qR52 = ans.range52w === 'highs'  ? gs('range52W')
             : ans.range52w === 'middle'  ? ms('range52W')
             : ans.range52w === 'lows'    ? rs('range52W')
             : 1;

  const qDD  = ans.drawdown === 'near_peak' ? (r52 != null ? (r52 >= 80 ? 1 : r52 >= 50 ? 0.5 : 0) : 0.5)
             : ans.drawdown === 'moderate'   ? (r52 != null ? (r52 >= 40 && r52 < 80 ? 1 : r52 >= 20 ? 0.5 : 0) : 0.5)
             : ans.drawdown === 'deep'       ? (r52 != null ? (r52 < 40 ? 1 : r52 < 60 ? 0.5 : 0) : 0.5)
             : 1;

  const qVol = ans.vol === 'low'      ? gs('volatility')
             : ans.vol === 'moderate' ? ms('volatility')
             : 1;

  const BUY_SET  = new Set(['Strong buy','Buy']);
  const NEUT_SET = new Set(['Strong buy','Buy','Neutral']);
  const qAn  = ans.analyst === 'buy'     ? (BUY_SET.has(ar) ? 1 : ar === 'Neutral' ? 0.5 : 0)
             : ans.analyst === 'neutral'  ? (NEUT_SET.has(ar) ? 1 : 0.5)
             : 1;

  const qPr  = ans.profit === 'profitable' ? (eps != null ? (eps > 0 ? 1 : 0) : 0.5)
             : 1;

  const scores = [qSize, q1M, q5Y, qMom, qMA, qR52, qDD, qVol, qAn, qPr];
  const total  = scores.reduce((a, b) => a + b, 0);
  const pct    = Math.round((total / 10) * 100);
  return { scores, total, pct };
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
    if (!sectorMatches(stock, answers)) continue;
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
const _PRESET_ORDER = ['optimistic','nimble','momentum','pack','patient','safe','trophy','wild_beast','zombie'];

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
  const top3 = sorted.slice(0, 3);
  const worst = sorted[sorted.length - 1];
  const chip = (key, pct) => {
    const col = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
    return `<span class="sc" style="border-color:${col};color:${col};" data-tip="${esc(STYLE_NAMES[key] || key)} — ${esc(STYLE_DESCS[key] || '')}">${STYLE_ICONS[key] || ''} ${pct}%</span>`;
  };
  return `<div class="rc-styles">
    ${top3.map(([k, p]) => chip(k, p)).join('')}
    <span style="font-size:0.5rem;color:var(--muted);">&middot;</span>
    ${chip(worst[0], worst[1])}
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
