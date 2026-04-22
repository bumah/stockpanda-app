#!/usr/bin/env python3
"""
StockPanda ETF data pipeline.
Reads data/ETF-YYYY-MM-DD.csv and writes public/data/etfs.json.

Keeps the ETF experience deliberately simpler than stocks:
  - Filter to US / UK / Japan registered funds with a real Asset class.
  - Dedupe by Description (a given fund often has multiple listings).
  - Precompute 5 health signals (cost / size / demand / momentum /
    tracking) so the client just renders coloured dots.

Usage:
    python3 build_etfs.py
    python3 build_etfs.py path/to/ETF.csv
"""

import csv
import glob
import json
import os
import re
import sys
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────────

DATA_DIR = os.path.join("public", "data")
CSV_DIR  = "data"

COUNTRY_MAP = {
    "United States":  "us",
    "United Kingdom": "uk",
    "Japan":          "japan",
}

# Rough FX rates for converting flows/AUM to USD for %-of-AUM math only.
# Not used for display values — display keeps the native currency.
FX_TO_USD = {
    "USD": 1.0,
    "GBP": 1.27,   "GBX": 0.0127,
    "EUR": 1.08,
    "JPY": 0.0067,
    "CAD": 0.73,
    "HKD": 0.128,
    "CHF": 1.13,
    "AUD": 0.66,
    "CNY": 0.14,
    "KRW": 0.00075,
    "INR": 0.012,
    "SGD": 0.74,
    "MXN": 0.051,
    "BRL": 0.20,
    "ZAR": 0.054,
    "TRY": 0.031,
    "NOK": 0.093,
    "SEK": 0.094,
    "DKK": 0.145,
    "TWD": 0.031,
    "THB": 0.028,
    "NZD": 0.60,
    "ILS": 0.27,
    "PLN": 0.25,
}

# AUM size tiers (USD)
AUM_LARGE  = 1_000_000_000    # ≥ $1B → green
AUM_MEDIUM =   100_000_000    # $100M–$1B → amber; below → red
MIN_AUM    =    10_000_000    # drop funds below $10M (zombies)

# For "Demand" (flow %) — only compute when AUM is meaningful; else grey
MIN_AUM_FOR_FLOW_SIG = 500_000_000

# ── Helpers ───────────────────────────────────────────────────────────────────

def _f(s):
    """Parse a numeric string. Empty/whitespace → None."""
    if s is None: return None
    s = str(s).strip()
    if not s: return None
    try:
        return float(s)
    except ValueError:
        return None

def _round(x, n=2):
    return None if x is None else round(x, n)

def _usd(value, currency):
    """Convert value to USD (approx). Unknown currency → None."""
    if value is None or currency is None: return None
    rate = FX_TO_USD.get(currency.strip().upper())
    if rate is None: return None
    return value * rate

def _aum_tier(aum_usd):
    """Tier label for quick filter chips."""
    if aum_usd is None:       return None
    if aum_usd >= 100e9:       return "100b"
    if aum_usd >= 10e9:        return "10b"
    if aum_usd >= 1e9:         return "1b"
    if aum_usd >= 100e6:       return "100m"
    return "sub100m"

def _fmt_money(value, currency):
    """Human-readable AUM / flow. Returns string like '$908B' or '£2.3B'."""
    if value is None or currency is None: return None
    sym = {"USD":"$","GBP":"£","GBX":"p","JPY":"¥","EUR":"€","CAD":"C$","HKD":"HK$","CHF":"CHF "}.get(
        currency.upper(), currency.upper()+" "
    )
    v = abs(value)
    sign = "-" if value < 0 else ""
    if v >= 1e12: return f"{sign}{sym}{v/1e12:.1f}T"
    if v >= 1e9:  return f"{sign}{sym}{v/1e9:.1f}B"
    if v >= 1e6:  return f"{sign}{sym}{v/1e6:.0f}M"
    if v >= 1e3:  return f"{sign}{sym}{v/1e3:.0f}K"
    return f"{sign}{sym}{v:.0f}"

# ── Signal scoring ────────────────────────────────────────────────────────────

def sig_cost(expense):
    """Expense ratio (as percent, e.g. 0.03 means 0.03%)."""
    if expense is None: return "grey"
    if expense <= 0.20: return "green"
    if expense <= 0.70: return "amber"
    return "red"

def sig_size(aum_usd):
    if aum_usd is None: return "grey"
    if aum_usd >= AUM_LARGE:  return "green"
    if aum_usd >= AUM_MEDIUM: return "amber"
    return "red"

def sig_demand(flow_1y_usd, aum_usd):
    """1y fund flows as % of AUM. Needs meaningful AUM to avoid noise."""
    if flow_1y_usd is None or aum_usd is None: return "grey"
    if aum_usd < MIN_AUM_FOR_FLOW_SIG:           return "grey"
    pct = (flow_1y_usd / aum_usd) * 100
    if pct > 0:    return "green"
    if pct >= -5:  return "amber"
    return "red"

def sig_momentum(aum_perf_1y):
    """AUM % change over 1 year (the CSV provides this directly)."""
    if aum_perf_1y is None: return "grey"
    if aum_perf_1y > 5:    return "green"
    if aum_perf_1y >= -5:  return "amber"
    return "red"

def sig_tracking(nav_3m, price_3m):
    """Gap between NAV return and price return (3m). Small = efficient."""
    if nav_3m is None or price_3m is None: return "grey"
    gap = abs(nav_3m - price_3m)
    if gap < 0.5:  return "green"
    if gap <= 1.5: return "amber"
    return "red"

# ── CSV discovery ─────────────────────────────────────────────────────────────

def find_csv():
    if len(sys.argv) > 1:
        return sys.argv[1]
    dated = sorted(glob.glob(os.path.join(CSV_DIR, "ETF-*.csv")))
    if dated:
        return dated[-1]
    plain = os.path.join(CSV_DIR, "ETF.csv")
    if os.path.exists(plain):
        return plain
    raise FileNotFoundError(f"No ETF CSV found in {CSV_DIR}/")

def parse_data_date(csv_path):
    m = re.search(r'(\d{4}-\d{2}-\d{2})', os.path.basename(csv_path))
    return m.group(1) if m else datetime.now().strftime("%Y-%m-%d")

# ── Dedup ─────────────────────────────────────────────────────────────────────

TICKER_CLEAN_RE = re.compile(r'^[A-Z]{2,5}$')  # e.g. VOO, SPY, AGG

def _tidy(s):
    return (s or "").strip()

def dedupe(rows):
    """Collapse duplicate listings.
    TradingView sometimes returns the same fund twice (same Symbol +
    country, slightly different Description) and the same fund lists
    across countries. We dedupe twice:
      1. By (Symbol, Country) — removes intra-country dupes (SPY×2, etc.)
      2. By Description          — removes cross-country dupes (VOO vs 0LO6)
    In each round, prefer the US-registered row with a clean alphabetic
    ticker (primary listing); fall back to highest AUM.
    """
    def score(r):
        ticker = _tidy(r["Symbol"])
        country = _tidy(r["Country or region of registration"])
        primary = 1 if (country == "United States" and TICKER_CLEAN_RE.match(ticker)) else 0
        aum = _f(r.get("Assets under management")) or 0
        return (primary, aum)

    def collapse(rs, key_fn):
        groups = {}
        for r in rs:
            k = key_fn(r)
            if not k: continue
            groups.setdefault(k, []).append(r)
        out = []
        for group in groups.values():
            group.sort(key=score, reverse=True)
            out.append(group[0])
        return out

    rows = collapse(rows, lambda r: (_tidy(r["Symbol"]), _tidy(r["Country or region of registration"])))
    rows = collapse(rows, lambda r: _tidy(r["Description"]))
    return rows

# ── Row → ETF record ─────────────────────────────────────────────────────────

def parse_etf(row):
    ticker   = _tidy(row["Symbol"])
    name     = _tidy(row["Description"])
    country  = COUNTRY_MAP.get(_tidy(row["Country or region of registration"]))
    if not country: return None

    asset_class = _tidy(row["Asset class"])
    if not asset_class: return None

    price       = _f(row.get("Price"))
    price_cur   = _tidy(row.get("Price - Currency")) or "USD"

    aum         = _f(row.get("Assets under management"))
    aum_cur     = _tidy(row.get("Assets under management - Currency")) or price_cur
    aum_usd     = _usd(aum, aum_cur)

    # Drop zombie funds
    if aum_usd is not None and aum_usd < MIN_AUM:
        return None

    expense     = _f(row.get("Expense ratio"))
    div_yield   = _f(row.get("Dividend yield % (indicated)"))
    div_freq    = _tidy(row.get("Dividends frequency"))
    hedged      = _tidy(row.get("Currency hedged"))
    transparency = _tidy(row.get("Portfolio transparency"))

    # Performance (price)
    perf = {
        "w1":  _round(_f(row.get("Performance % 1 week")), 2),
        "m1":  _round(_f(row.get("Performance % 1 month")), 2),
        "m3":  _round(_f(row.get("Performance % 3 months")), 2),
        "m6":  _round(_f(row.get("Performance % 6 months")), 2),
        "ytd": _round(_f(row.get("Performance % Year to date")), 2),
        "y1":  _round(_f(row.get("Performance % 1 year")), 2),
        "y5":  _round(_f(row.get("Performance % 5 years")), 2),
        "y10": _round(_f(row.get("Performance % 10 years")), 2),
    }

    # NAV performance
    nav = {
        "m1":  _round(_f(row.get("NAV performance % 1 month")), 2),
        "m3":  _round(_f(row.get("NAV performance % 3 months")), 2),
        "ytd": _round(_f(row.get("NAV performance % Year to date")), 2),
        "y1":  _round(_f(row.get("NAV performance % 1 year")), 2),
        "y3":  _round(_f(row.get("NAV performance % 3 years")), 2),
        "y5":  _round(_f(row.get("NAV performance % 5 years")), 2),
    }

    # AUM growth
    aum_perf = {
        "m3":  _round(_f(row.get("AUM performance % 3 months")), 2),
        "ytd": _round(_f(row.get("AUM performance % Year to date")), 2),
        "y1":  _round(_f(row.get("AUM performance % 1 year")), 2),
        "y3":  _round(_f(row.get("AUM performance % 3 years")), 2),
        "y5":  _round(_f(row.get("AUM performance % 5 years")), 2),
    }

    # Fund flows (values are in the ETF's native currency)
    flow_ytd    = _f(row.get("Fund flows Year to date"))
    flow_ytd_c  = _tidy(row.get("Fund flows Year to date - Currency")) or aum_cur
    flow_1m     = _f(row.get("Fund flows 1 month"))
    flow_1m_c   = _tidy(row.get("Fund flows 1 month - Currency")) or aum_cur
    flow_3m     = _f(row.get("Fund flows 3 months"))
    flow_3m_c   = _tidy(row.get("Fund flows 3 months - Currency")) or aum_cur
    flow_1y     = _f(row.get("Fund flows 1 year"))
    flow_1y_c   = _tidy(row.get("Fund flows 1 year - Currency")) or aum_cur
    flow_3y     = _f(row.get("Fund flows 3 years"))
    flow_3y_c   = _tidy(row.get("Fund flows 3 years - Currency")) or aum_cur

    flow_1y_usd = _usd(flow_1y, flow_1y_c)
    flow_1y_pct = None
    if flow_1y_usd is not None and aum_usd and aum_usd > 0:
        flow_1y_pct = _round((flow_1y_usd / aum_usd) * 100, 1)

    # Highs/lows
    high_52w = _f(row.get("High 52 weeks"))
    low_52w  = _f(row.get("Low 52 weeks"))
    high_all = _f(row.get("High All Time"))
    low_all  = _f(row.get("Low All Time"))

    # Signals
    signals = {
        "cost":     sig_cost(expense),
        "size":     sig_size(aum_usd),
        "demand":   sig_demand(flow_1y_usd, aum_usd),
        "momentum": sig_momentum(aum_perf.get("y1")),
        "tracking": sig_tracking(nav.get("m3"), perf.get("m3")),
    }

    return {
        "ticker":        ticker,
        "name":          name,
        "country":       country,
        "assetClass":    asset_class,
        "focus":         _tidy(row.get("Focus")),
        "category":      _tidy(row.get("Category")),
        "strategy":      _tidy(row.get("Strategy")),
        "indexTracked":  _tidy(row.get("Index tracked")),
        "price":         _round(price, 4),
        "priceCurrency": price_cur,
        "change1d":      _round(_f(row.get("Price Change % 1 day")), 2),
        "expense":       _round(expense, 2),
        "aum":           _round(aum, 0),
        "aumCurrency":   aum_cur,
        "aumUsd":        _round(aum_usd, 0),
        "aumLabel":      _fmt_money(aum, aum_cur),
        "aumTier":       _aum_tier(aum_usd),
        "divYield":      _round(div_yield, 2),
        "divFreq":       div_freq,
        "hedged":        hedged,
        "transparency":  transparency,
        "performance":   perf,
        "nav":           nav,
        "aumPerf":       aum_perf,
        "flow": {
            "m1":  {"v": _round(flow_1m, 0),  "c": flow_1m_c,  "lbl": _fmt_money(flow_1m, flow_1m_c)},
            "m3":  {"v": _round(flow_3m, 0),  "c": flow_3m_c,  "lbl": _fmt_money(flow_3m, flow_3m_c)},
            "ytd": {"v": _round(flow_ytd, 0), "c": flow_ytd_c, "lbl": _fmt_money(flow_ytd, flow_ytd_c)},
            "y1":  {"v": _round(flow_1y, 0),  "c": flow_1y_c,  "lbl": _fmt_money(flow_1y, flow_1y_c), "pctAum": flow_1y_pct},
            "y3":  {"v": _round(flow_3y, 0),  "c": flow_3y_c,  "lbl": _fmt_money(flow_3y, flow_3y_c)},
        },
        "high52w":       _round(high_52w, 2),
        "low52w":        _round(low_52w, 2),
        "highAll":       _round(high_all, 2),
        "lowAll":        _round(low_all, 2),
        "signals":       signals,
    }

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    csv_path  = find_csv()
    data_date = parse_data_date(csv_path)
    print(f"Reading ETF CSV: {csv_path}  (data date: {data_date})")

    with open(csv_path, "r", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    print(f"  {len(rows):,} rows")

    # Filter to target countries + real ETFs
    rows = [r for r in rows
            if r.get("Country or region of registration", "").strip() in COUNTRY_MAP
            and r.get("Asset class", "").strip()]
    print(f"  {len(rows):,} after country + asset-class filter")

    rows = dedupe(rows)
    print(f"  {len(rows):,} after dedupe")

    etfs = []
    for r in rows:
        etf = parse_etf(r)
        if etf is not None:
            etfs.append(etf)
    print(f"  {len(etfs):,} final ETFs")

    # Breakdown
    from collections import Counter
    c_country = Counter(e["country"] for e in etfs)
    c_class   = Counter(e["assetClass"] for e in etfs)
    print(f"  By country: {dict(c_country)}")
    print(f"  By asset class: {dict(c_class)}")

    os.makedirs(DATA_DIR, exist_ok=True)
    out_path = os.path.join(DATA_DIR, "etfs.json")
    payload = {
        "dataDate":    data_date,
        "generatedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":      "TradingView CSV",
        "count":       len(etfs),
        "etfs":        etfs,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
    size_mb = os.path.getsize(out_path) / 1e6
    print(f"  Wrote {out_path}  ({size_mb:.2f} MB)")

    print("\nDone!")

if __name__ == "__main__":
    main()
