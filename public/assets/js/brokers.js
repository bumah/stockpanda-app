// ── Broker catalog + Trade modal ─────────────────────────────────────────────
// Each broker entry has:
//   key, name, regions[], icon (emoji or short label), urlBuilder(ticker, country)
// urlBuilder returns the URL to open. For brokers without a public deep link,
// we return the homepage and the modal copy nudges the user to search there.
'use strict';

(function () {
  if (window.SP_BROKERS) return;

  const BROKERS = {
    t212:        { name: 'Trading 212',        regions: ['uk','eu'],
                   url: t => 'https://www.trading212.com/trading-instruments?q=' + encodeURIComponent(t),
                   deep: true },
    hl:          { name: 'Hargreaves Lansdown', regions: ['uk'],
                   url: t => 'https://www.hl.co.uk/shares/shares-search-results/' + encodeURIComponent(t),
                   deep: true },
    freetrade:   { name: 'Freetrade',           regions: ['uk'],
                   url: ()=> 'https://freetrade.io/', deep: false },
    ajbell:      { name: 'AJ Bell',             regions: ['uk'],
                   url: t => 'https://www.youinvest.co.uk/markets/search?searchTerm=' + encodeURIComponent(t),
                   deep: true },
    iiuk:        { name: 'Interactive Investor', regions: ['uk'],
                   url: t => 'https://www.ii.co.uk/search?term=' + encodeURIComponent(t),
                   deep: true },

    robinhood:   { name: 'Robinhood',           regions: ['us'],
                   url: t => 'https://robinhood.com/stocks/' + encodeURIComponent(t),
                   deep: true },
    schwab:      { name: 'Charles Schwab',      regions: ['us'],
                   url: t => 'https://www.schwab.com/research/stocks/quotes/summary/' + encodeURIComponent(t),
                   deep: true },
    fidelity:    { name: 'Fidelity',            regions: ['us'],
                   url: t => 'https://digital.fidelity.com/prgw/digital/research/quote?symbol=' + encodeURIComponent(t),
                   deep: true },
    etrade:      { name: 'E*TRADE',             regions: ['us'],
                   url: t => 'https://us.etrade.com/etx/mkt/quotes?symbol=' + encodeURIComponent(t),
                   deep: true },
    sofi:        { name: 'SoFi',                regions: ['us','hk'],
                   url: t => 'https://www.sofi.com/invest/buy/' + encodeURIComponent(t),
                   deep: true },

    traderep:    { name: 'Trade Republic',      regions: ['eu'],
                   url: ()=> 'https://traderepublic.com/', deep: false },
    degiro:      { name: 'DEGIRO',              regions: ['eu','uk'],
                   url: ()=> 'https://www.degiro.com/', deep: false },
    scalable:    { name: 'Scalable Capital',    regions: ['eu'],
                   url: ()=> 'https://scalable.capital/', deep: false },
    bux:         { name: 'BUX',                 regions: ['eu'],
                   url: ()=> 'https://getbux.com/', deep: false },

    futu:        { name: 'Futu / moomoo',       regions: ['hk'],
                   url: t => 'https://www.futubull.com/en/quote/us/' + encodeURIComponent(t),
                   deep: true },
    tiger:       { name: 'Tiger Brokers',       regions: ['hk'],
                   url: ()=> 'https://www.tigerbrokers.com.sg/', deep: false },
    hsbchk:      { name: 'HSBC InvestDirect',   regions: ['hk'],
                   url: ()=> 'https://www.invest.hsbc.com.hk/', deep: false },
    webull:      { name: 'Webull',              regions: ['us','hk'],
                   url: t => 'https://www.webull.com/quote/' + encodeURIComponent(t.toLowerCase()),
                   deep: true },

    ibkr:        { name: 'Interactive Brokers', regions: ['global'],
                   url: t => 'https://www.interactivebrokers.com/portal/?action=Quote&Tab=Quote&symbol=' + encodeURIComponent(t),
                   deep: true },
    etoro:       { name: 'eToro',               regions: ['global'],
                   url: t => 'https://www.etoro.com/markets/' + encodeURIComponent(t.toLowerCase()),
                   deep: true },
  };

  const REGION_DEFAULTS = {
    uk: ['t212','hl','freetrade'],
    us: ['robinhood','schwab','fidelity'],
    eu: ['traderep','degiro','scalable'],
    hk: ['futu','tiger','webull'],
  };
  const GLOBAL_PINNED = ['ibkr','etoro'];

  // ── Region detection (no permission, runs client-side) ───────────────────
  function inferRegion() {
    try {
      const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
      const lang = (navigator.language || '').toLowerCase();
      if (tz.includes('europe/london') || lang === 'en-gb') return 'uk';
      if (tz.startsWith('america/') || lang === 'en-us') return 'us';
      if (tz.includes('hong_kong') || tz.includes('macau') || lang === 'zh-hk') return 'hk';
      if (tz.startsWith('europe/')) return 'eu';
    } catch (e) {}
    return 'global';
  }

  // ── User picks (localStorage; auth.js syncs to Supabase when signed in) ──
  const USER_BROKERS_KEY = 'sp_brokers';
  function getUserBrokers() {
    try {
      const raw = localStorage.getItem(USER_BROKERS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.filter(k => BROKERS[k]).slice(0, 3) : [];
    } catch (e) { return []; }
  }
  function setUserBrokers(list) {
    const clean = (Array.isArray(list) ? list : []).filter(k => BROKERS[k]).slice(0, 3);
    localStorage.setItem(USER_BROKERS_KEY, JSON.stringify(clean));
    return clean;
  }

  // ── Resolve which brokers to show in the picker ──────────────────────────
  function resolvePickerBrokers() {
    const picks = getUserBrokers();
    if (picks.length > 0) return { keys: picks, source: 'user' };
    const region = inferRegion();
    const regional = REGION_DEFAULTS[region] || [];
    const keys = regional.concat(GLOBAL_PINNED.filter(g => regional.indexOf(g) === -1));
    return { keys: keys, source: 'defaults', region: region };
  }

  // ── Trade modal ──────────────────────────────────────────────────────────
  function ensureModalRoot() {
    let root = document.getElementById('sp-trade-modal');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'sp-trade-modal';
    root.className = 'sp-trade-overlay';
    root.style.display = 'none';
    root.addEventListener('click', e => { if (e.target === root) closeTradeModal(); });
    document.body.appendChild(root);
    return root;
  }

  function openTradeModal(ticker, opts) {
    if (!ticker) return;
    const country = (opts && opts.country) || '';
    const company = (opts && opts.company) || '';
    const root = ensureModalRoot();
    const resolved = resolvePickerBrokers();
    const banner = resolved.source === 'defaults'
      ? '<p class="sp-trade-banner">Showing region defaults. <a href="brokers.html">Pick your brokers</a> to personalise this list.</p>'
      : '';
    const rows = resolved.keys.map(function(k) {
      const b = BROKERS[k];
      if (!b) return '';
      const url = b.url(ticker, country);
      const hint = b.deep ? '' : '<span class="sp-broker-hint">search ' + escHtml(ticker) + '</span>';
      return '<a class="sp-broker-row" href="' + url + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="sp-broker-name">' + escHtml(b.name) + '</span>' +
        '<span class="sp-broker-end">' + hint + '<span class="sp-broker-arrow" aria-hidden="true">\u2192</span></span>' +
      '</a>';
    }).join('');
    root.innerHTML =
      '<div class="sp-trade-box">' +
        '<button class="sp-trade-close" onclick="window.SP_BROKERS.close()" aria-label="Close">&times;</button>' +
        '<div class="sp-trade-title">Continue at your broker</div>' +
        '<div class="sp-trade-sub">' + escHtml(ticker) + (company ? ' &middot; ' + escHtml(company) : '') + '</div>' +
        banner +
        '<div class="sp-broker-list">' + rows + '</div>' +
        '<p class="sp-trade-note">StockPanda doesn\u2019t execute trades. Your broker handles the order.</p>' +
        '<div class="sp-trade-foot">' +
          '<a href="brokers.html">Manage your brokers</a>' +
        '</div>' +
      '</div>';
    root.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeTradeModal() {
    const root = document.getElementById('sp-trade-modal');
    if (!root) return;
    root.style.display = 'none';
    document.body.style.overflow = '';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // Public surface
  window.SP_BROKERS = {
    BROKERS:         BROKERS,
    REGION_DEFAULTS: REGION_DEFAULTS,
    GLOBAL_PINNED:   GLOBAL_PINNED,
    inferRegion:     inferRegion,
    getUserBrokers:  getUserBrokers,
    setUserBrokers:  setUserBrokers,
    resolvePicker:   resolvePickerBrokers,
    open:            openTradeModal,
    close:           closeTradeModal,
  };
})();
