# StockPanda — Supabase Setup Guide

Phase 1: **Google login + Catch sync**. Follow these steps end-to-end; nothing goes live until you paste credentials into `public/assets/js/supabase-config.js`.

---

## 1. Create a Supabase project

1. Go to https://supabase.com → Sign up / log in (GitHub is fastest).
2. Click **New Project**.
3. Name it `stockpanda`, set a strong DB password (save it somewhere safe), pick the region closest to your users, and hit **Create new project**.
4. Wait ~2 minutes for provisioning.

---

## 2. Create the `catches` table

Open **SQL Editor** in the Supabase dashboard and paste the contents of [`supabase-schema.sql`](./supabase-schema.sql). Click **Run**.

What it does:
- Creates a `catches` table keyed by `user_id + ticker + country` (unique)
- Enables Row-Level Security so users can only read/write their own rows
- Auto-sets `user_id` on insert via a trigger (clients never send it explicitly)

---

## 3. Enable Google OAuth

### 3a. In Google Cloud Console

1. Go to https://console.cloud.google.com/
2. Create (or pick) a project.
3. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - Fill in App name ("StockPanda"), support email, developer email
   - Scopes: add `email`, `profile`, `openid`
   - Save.
4. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `StockPanda Web`
   - **Authorized JavaScript origins**:
     - `https://your-netlify-domain.netlify.app` (or your custom domain)
     - `http://localhost:8080` (for local dev)
   - **Authorized redirect URIs** — paste the Supabase callback URL (next step provides it)
5. Copy the **Client ID** and **Client secret**.

### 3b. In Supabase

1. **Authentication → Providers → Google**
2. Toggle **Enable**.
3. Paste the **Client ID** and **Client secret** from Google Cloud.
4. Copy the **Callback URL** Supabase shows and paste it into the Google Cloud OAuth client's **Authorized redirect URIs** (step 3a.4 above).
5. Save.

### 3c. Add your site to Supabase's allowed redirect list

1. **Authentication → URL Configuration**
2. **Site URL**: `https://your-netlify-domain.netlify.app`
3. **Redirect URLs** (add each):
   - `https://your-netlify-domain.netlify.app/*`
   - `http://localhost:8080/*`
4. Save.

---

## 4. Grab your public keys

1. **Project Settings → API**
2. Copy **Project URL** (e.g. `https://xyz.supabase.co`)
3. Copy **`anon` public** key (long `eyJ…` JWT). This key is safe to ship in client-side code — RLS policies keep users scoped to their own rows.

---

## 5. Paste keys into the app

Open `public/assets/js/supabase-config.js` and fill in:

```js
window.SP_SUPABASE = {
  url:      'https://xyz.supabase.co',
  anonKey:  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....',
};
```

Commit, push, deploy. Done.

---

## 6. Test the end-to-end flow

1. Open the app on two browsers or two devices.
2. On device A: Tools dropdown → **Sign in with Google** → complete Google flow → you land back on the site, now signed in.
3. Add a stock to Catch.
4. On device B: sign in with the same Google account → your Catch appears.

---

## 7. What's stored

Only three fields per catch:
- `ticker`
- `country`
- `company` (optional, for display)

Plus `user_id` (Supabase-managed) and `added_at` (timestamp).

No other data is synced. Anonymous users continue to use localStorage only; nothing leaves their device.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Click "Sign in with Google" → alert "Sign-in not configured yet" | `supabase-config.js` still empty |
| OAuth redirects but comes back not signed in | Google redirect URI doesn't exactly match the one Supabase provides |
| Catches don't sync across devices | Check browser console for Supabase errors; likely RLS policy issue (re-run the schema SQL) |
| "Failed to validate nonce" on Google | Site URL in Supabase **Authentication → URL Configuration** doesn't match the actual domain |

---

## Rollback

To disable auth entirely, just empty the config:

```js
window.SP_SUPABASE = { url: '', anonKey: '' };
```

The app falls back to localStorage-only. Existing users' Catch lists are unaffected.
