/* ── StockPanda auth + Catch sync (Supabase) ─────────────────
 * Optional layer. When SP_SUPABASE config is empty OR the Supabase
 * SDK didn't load, this module does nothing and the app keeps using
 * localStorage alone.
 *
 * When configured:
 *   - Google OAuth sign-in / sign-out
 *   - On sign-in: merge localStorage catches with server, pull back
 *     a unified list, overwrite local
 *   - On catch change: push diffs to server (debounced)
 *   - On page load (signed in): pull server → overwrite local
 * ────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const cfg = window.SP_SUPABASE || {};
  const ENABLED = !!(cfg.url && cfg.anonKey);
  const WL_KEY = 'sp_watchlist';

  let client = null;
  let session = null;
  let syncing = false;
  let pushTimer = null;

  function $$(sel) { return document.querySelectorAll(sel); }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(WL_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function writeLocal(list) {
    localStorage.setItem(WL_KEY, JSON.stringify(list));
  }
  function keyOf(item) { return (item.ticker || '') + '|' + (item.country || ''); }

  // ── UI updates ─────────────────────────────────────────────
  function updateUI() {
    // When auth isn't configured, hide every auth-related control so the app
    // looks identical to before login was added.
    if (!ENABLED) {
      $$('.sp-auth-signin, .sp-auth-signout, .sp-auth-only-in, .sp-auth-only-out')
        .forEach(el => el.style.display = 'none');
      return;
    }
    const signedIn = !!(session && session.user);
    const email = session && session.user ? (session.user.email || '') : '';
    const nameOrEmail = session && session.user ?
      (session.user.user_metadata?.full_name || email) : '';

    $$('.sp-auth-signin').forEach(el => el.style.display = signedIn ? 'none' : '');
    $$('.sp-auth-signout').forEach(el => el.style.display = signedIn ? '' : 'none');
    $$('.sp-auth-email').forEach(el => el.textContent = email);
    $$('.sp-auth-email-title').forEach(el => { if (email) el.title = email; else el.removeAttribute('title'); });
    $$('.sp-auth-name').forEach(el => el.textContent = nameOrEmail);
    $$('.sp-auth-only-in').forEach(el => el.style.display = signedIn ? '' : 'none');
    $$('.sp-auth-only-out').forEach(el => el.style.display = signedIn ? 'none' : '');
  }

  // ── Sync: pull, merge, push ─────────────────────────────────
  async function pullFromServer() {
    if (!client || !session) return [];
    const { data, error } = await client
      .from('catches')
      .select('ticker, country, company, added_at')
      .order('added_at', { ascending: false });
    if (error) { console.warn('[auth] pull failed', error); return []; }
    return (data || []).map(r => ({
      ticker: r.ticker,
      country: r.country || '',
      company: r.company || '',
      addedAt: r.added_at ? Date.parse(r.added_at) : Date.now(),
    }));
  }

  async function mergeOnSignIn() {
    if (!client || !session || syncing) return;
    syncing = true;
    try {
      const local = readLocal();
      const server = await pullFromServer();
      const serverKeys = new Set(server.map(keyOf));
      const toUpload = local.filter(l => !serverKeys.has(keyOf(l)));

      if (toUpload.length) {
        const rows = toUpload.map(l => ({
          ticker: l.ticker,
          country: l.country || '',
          company: l.company || '',
          added_at: new Date(l.addedAt || Date.now()).toISOString(),
        }));
        const { error } = await client.from('catches').insert(rows);
        if (error && error.code !== '23505') console.warn('[auth] merge insert failed', error);
      }

      const merged = await pullFromServer();
      // Union: keep local items that aren't in server (shouldn't happen post-merge, but safe)
      const seen = new Set(merged.map(keyOf));
      for (const l of local) if (!seen.has(keyOf(l))) merged.push(l);
      writeLocal(merged);
      document.dispatchEvent(new CustomEvent('sp:catch-sync', { detail: { source: 'server' } }));
    } finally {
      syncing = false;
    }
  }

  // Debounced push of the full local list to server (simple idempotent upsert)
  function schedulePushToServer() {
    if (!client || !session) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushToServer, 400);
  }

  async function pushToServer() {
    if (!client || !session || syncing) return;
    const local = readLocal();
    const server = await pullFromServer();
    const localKeys = new Set(local.map(keyOf));
    const serverKeys = new Set(server.map(keyOf));

    // Upserts: local items not on server
    const toAdd = local.filter(l => !serverKeys.has(keyOf(l)));
    if (toAdd.length) {
      const rows = toAdd.map(l => ({
        ticker: l.ticker,
        country: l.country || '',
        company: l.company || '',
        added_at: new Date(l.addedAt || Date.now()).toISOString(),
      }));
      const { error } = await client.from('catches').insert(rows);
      if (error && error.code !== '23505') console.warn('[auth] push add failed', error);
    }

    // Deletes: server items not in local
    const toRemove = server.filter(s => !localKeys.has(keyOf(s)));
    for (const r of toRemove) {
      const { error } = await client
        .from('catches').delete()
        .match({ ticker: r.ticker, country: r.country || '' });
      if (error) console.warn('[auth] push remove failed', error);
    }
  }

  // ── Rule sync (Quick + Custom) — server-of-truth for signed-in users ──
  // localStorage stays as the primary cache (works offline / for anonymous users);
  // when signed in we additionally push/pull the rules from the user_rules table.
  const RULES_QUICK_KEY  = 'sp_trapCriteria';
  const RULES_QUICK_AT   = 'sp_trapCriteria_at';
  const RULES_CUSTOM_KEY = 'sp_trap_answers';
  const RULES_CUSTOM_AT  = 'sp_trap_answers_at';

  function _readJSON(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  }
  function _localRulesPayload() {
    return {
      quick_rules:  _readJSON(RULES_QUICK_KEY),
      custom_rules: _readJSON(RULES_CUSTOM_KEY),
    };
  }
  function _localRulesNewest() {
    const a = parseInt(localStorage.getItem(RULES_QUICK_AT)  || '0', 10);
    const b = parseInt(localStorage.getItem(RULES_CUSTOM_AT) || '0', 10);
    return Math.max(a, b);
  }

  let rulesPushTimer = null;
  function scheduleRulesPush() {
    if (!client || !session) return;
    clearTimeout(rulesPushTimer);
    rulesPushTimer = setTimeout(pushRulesToServer, 600);
  }

  async function pushRulesToServer() {
    if (!client || !session) return;
    const payload = _localRulesPayload();
    const { error } = await client
      .from('user_rules')
      .upsert({
        user_id:      session.user.id,
        quick_rules:  payload.quick_rules,
        custom_rules: payload.custom_rules,
        updated_at:   new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) console.warn('[auth] rules push failed', error);
  }

  async function pullRulesFromServer() {
    if (!client || !session) return null;
    const { data, error } = await client
      .from('user_rules')
      .select('quick_rules, custom_rules, updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) { console.warn('[auth] rules pull failed', error); return null; }
    return data || null;
  }

  async function mergeRulesOnSignIn() {
    if (!client || !session) return;
    const server = await pullRulesFromServer();
    if (!server) {
      // First-time sign-in for this user — push whatever local rules exist.
      if (_readJSON(RULES_QUICK_KEY) || _readJSON(RULES_CUSTOM_KEY)) {
        await pushRulesToServer();
      }
      return;
    }
    const serverAt = server.updated_at ? Date.parse(server.updated_at) : 0;
    const localAt  = _localRulesNewest();
    if (serverAt > localAt) {
      // Server is newer — write into local cache.
      const now = Date.now().toString();
      if (server.quick_rules)  { localStorage.setItem(RULES_QUICK_KEY,  JSON.stringify(server.quick_rules));  localStorage.setItem(RULES_QUICK_AT,  now); }
      if (server.custom_rules) { localStorage.setItem(RULES_CUSTOM_KEY, JSON.stringify(server.custom_rules)); localStorage.setItem(RULES_CUSTOM_AT, now); }
      // Notify pages that may want to re-render with restored rules.
      document.dispatchEvent(new CustomEvent('sp:rules-sync', { detail: { source: 'server' } }));
    } else if (localAt > serverAt) {
      // Local is newer — push it up.
      await pushRulesToServer();
    }
  }

  // ── Intercept writes to sp_watchlist + rule keys so we auto-push ────────
  (function patchStorage() {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      orig.apply(this, arguments);
      if (this !== localStorage) return;
      if (key === WL_KEY && client && session) {
        schedulePushToServer();
        return;
      }
      if (key === RULES_QUICK_KEY || key === RULES_CUSTOM_KEY) {
        // Stamp the timestamp so we can compare against the server later.
        const atKey = key === RULES_QUICK_KEY ? RULES_QUICK_AT : RULES_CUSTOM_AT;
        orig.call(this, atKey, Date.now().toString());
        if (client && session) scheduleRulesPush();
      }
    };
  })();

  // ── Public API ──────────────────────────────────────────────
  window.spAuthEnabled = function () { return ENABLED; };
  window.spAuthSession = function () { return session; };
  window.spAuthUser    = function () { return session ? session.user : null; };

  window.spSignInGoogle = async function () {
    if (!client) { alert('Sign-in not configured yet. Check back soon.'); return; }
    // Send signed-in users straight to Ideas — that's the home of the app.
    // Already-signed-in users stay where they are because OAuth still respects
    // the current origin, but new sign-ins always land on /finder.html.
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/finder.html' },
    });
    if (error) alert('Sign-in failed: ' + error.message);
  };

  window.spSignOut = async function () {
    if (!client) return;
    await client.auth.signOut();
  };

  // ── Init ────────────────────────────────────────────────────
  function init() {
    if (!ENABLED) { updateUI(); return; }
    if (!window.supabase || !window.supabase.createClient) {
      console.warn('[auth] Supabase SDK not loaded; skipping init');
      updateUI();
      return;
    }
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    client.auth.getSession().then(({ data }) => {
      session = data.session || null;
      updateUI();
      if (session) { mergeOnSignIn(); mergeRulesOnSignIn(); }
    });

    client.auth.onAuthStateChange(async (event, s) => {
      session = s;
      updateUI();
      if (event === 'SIGNED_IN') { await mergeOnSignIn(); await mergeRulesOnSignIn(); }
      if (event === 'SIGNED_OUT') {
        // Keep local list as-is; user may want to keep an offline copy
        document.dispatchEvent(new CustomEvent('sp:catch-sync', { detail: { source: 'signout' } }));
      }
    });

    // Push on page unload to flush any debounced changes
    window.addEventListener('beforeunload', () => { if (session) pushToServer(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
