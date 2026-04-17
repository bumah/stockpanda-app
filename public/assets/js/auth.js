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

  // ── Intercept writes to sp_watchlist so we auto-push ────────
  (function patchStorage() {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      orig.apply(this, arguments);
      if (this === localStorage && key === WL_KEY && client && session) {
        schedulePushToServer();
      }
    };
  })();

  // ── Public API ──────────────────────────────────────────────
  window.spAuthEnabled = function () { return ENABLED; };
  window.spAuthSession = function () { return session; };
  window.spAuthUser    = function () { return session ? session.user : null; };

  window.spSignInGoogle = async function () {
    if (!client) { alert('Sign-in not configured yet. Check back soon.'); return; }
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
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
      if (session) { mergeOnSignIn(); }
    });

    client.auth.onAuthStateChange(async (event, s) => {
      session = s;
      updateUI();
      if (event === 'SIGNED_IN') { await mergeOnSignIn(); }
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
