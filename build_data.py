#!/usr/bin/env python3
"""
StockPanda data pipeline.
Reads the master TradingView CSV from data/stocks.csv and regenerates all
JSON data files in public/data/.

Usage:
    python3 build_data.py
    python3 build_data.py path/to/custom.csv
"""

import csv
import json
import math
import os
import re
import sys
import glob as _glob
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────

DATA_DIR  = os.path.join("public", "data")
CSV_DIR   = "data"

INDEX_TO_EXCHANGE = {
    "NASDAQ 100":                        "nasdaq100",
    "S&P 500":                           "sp500",
    "FTSE 100":                          "ftse100",
    "Hang Seng":                         "hsi",
    "Nikkei 225":                        "nikkei225",
    "KBW NASDAQ Financial Technology":   "nasdaq_financial",
    "NASDAQ Biotechnology":              "nasdaq_biotech",
}

EXCHANGE_LABELS = {
    "nasdaq100":        "NASDAQ 100",
    "sp500":            "S&P 500",
    "ftse100":          "FTSE 100",
    "hsi":              "Hang Seng",
    "nikkei225":        "Nikkei 225",
    "nasdaq_financial": "NASDAQ Financial",
    "nasdaq_biotech":   "NASDAQ Biotech",
}

MOOD_BANDS = [
    {"lo":  0, "hi": 20,  "label": "Level 1",   "colorKey": "blue",   "color": "#60A5FA"},
    {"lo": 20, "hi": 40,  "label": "Level 2",   "colorKey": "green",  "color": "#4ADE80"},
    {"lo": 40, "hi": 60,  "label": "Level 3",   "colorKey": "amber",  "color": "#FBBF24"},
    {"lo": 60, "hi": 80,  "label": "Level 4",   "colorKey": "orange", "color": "#FB923C"},
    {"lo": 80, "hi": 101, "label": "Level 5",   "colorKey": "red",    "color": "#F87171"},
]

# Indicator order — matches stock.html IND_ORDER (11 indicators)
IND_ORDER = [
    "volatility", "volSpike", "vsPeak", "shortTrend", "longTrend",
    "maCross", "momentum", "return1M", "return1Y", "range52W", "cagr5Y",
]

COLOR_MAP = {"green": "g", "amber": "a", "red": "r"}

# ── Hunting style presets v2 — weighted scoring ───────────────────────────────
# Each criterion is tagged as "core" (×2 weight) or "supporting" (×1 weight).
# Only active criteria count — "any" values are excluded entirely (no free passes).
# Score = (weighted sum of active criteria) / (max possible weighted sum) × 100

PRESETS = {
    # 🏆 Trophy — Proven long-term winners with strong earnings
    "trophy": {
        "criteria": [
            {"key": "growth5y",  "expect": "strong",      "weight": 2},  # core — proven compounder
            {"key": "profit",    "expect": "profitable",   "weight": 2},  # core — sustained earnings
            {"key": "momentum",  "expect": "positive",    "weight": 1},  # supporting — currently in uptrend
            {"key": "matrend",   "expect": "above_both",  "weight": 1},  # supporting — trend-confirmed
            {"key": "size",      "expect": "large",       "weight": 1},  # supporting — established company
            {"key": "analyst",   "expect": "buy",         "weight": 1},  # supporting — consensus on quality
            {"key": "drawdown",  "expect": "near_peak",   "weight": 1},  # supporting — hasn't pulled back
        ],
    },
    # 🧬 Wild Beast — High-volatility with extreme upside potential
    "wild_beast": {
        "criteria": [
            {"key": "vol",       "expect": "high",       "weight": 2},  # core — must be volatile
            {"key": "size",      "expect": "small",      "weight": 2},  # core — small caps have explosive potential
            {"key": "momentum",  "expect": "positive",   "weight": 1},  # supporting — momentum behind the move
            {"key": "return1m",  "expect": "positive",   "weight": 1},  # supporting — recent positive action
            {"key": "drawdown",  "expect": "deep",       "weight": 1},  # supporting — more upside room
            {"key": "range52w",  "expect": "lows",       "weight": 1},  # supporting — coiled spring
        ],
    },
    # 🦅 Scavenger — Quality stocks that have been beaten down
    "scavenger": {
        "criteria": [
            {"key": "profit",    "expect": "profitable", "weight": 2},  # core — real earnings
            {"key": "growth5y",  "expect": "strong",     "weight": 2},  # core — proven quality
            {"key": "drawdown",  "expect": "deep",       "weight": 2},  # core — beaten down
            {"key": "range52w",  "expect": "lows",       "weight": 1},  # supporting — near 52W lows
            {"key": "analyst",   "expect": "buy",        "weight": 1},  # supporting — analysts still believe
            {"key": "size",      "expect": "large",      "weight": 1},  # supporting — established company
        ],
    },
    # 🚀 Momentum — Sustained uptrends across multiple timeframes
    "momentum": {
        "criteria": [
            {"key": "momentum",  "expect": "positive",   "weight": 2},  # core — core identity
            {"key": "matrend",   "expect": "above_both", "weight": 2},  # core — confirmed sustained uptrend
            {"key": "return1m",  "expect": "positive",   "weight": 1},  # supporting — short-term confirms
            {"key": "growth5y",  "expect": "strong",     "weight": 1},  # supporting — not just a spike
            {"key": "range52w",  "expect": "highs",      "weight": 1},  # supporting — confirms strength
            {"key": "drawdown",  "expect": "near_peak",  "weight": 1},  # supporting — hasn't pulled back
        ],
    },
    # 🐇 Rebound — Stocks recovering after a rough patch (V-shape)
    "rebound": {
        "criteria": [
            {"key": "drawdown",  "expect": "deep",       "weight": 2},  # core — had significant fall
            {"key": "matrend",   "expect": "above_50",   "weight": 2},  # core — price now above 50-day MA (recovering)
            {"key": "return1m",  "expect": "positive",   "weight": 2},  # core — bouncing back
            {"key": "momentum",  "expect": "positive",   "weight": 1},  # supporting — momentum turning up
            {"key": "range52w",  "expect": "middle",     "weight": 1},  # supporting — off lows, not at highs
        ],
    },
}

PRESET_LABELS = {
    "trophy": "Trophy", "wild_beast": "Wild Beast", "scavenger": "Scavenger",
    "momentum": "Momentum", "rebound": "Rebound",
}

BUY_SET  = {"Strong buy", "Buy"}
NEUT_SET = {"Strong buy", "Buy", "Neutral"}

def _ind_color(inds, key):
    """Get indicator color, defaulting to 'amber' if missing."""
    ind = inds.get(key)
    return ind["color"] if ind else "amber"

def _green_score(inds, key):
    c = _ind_color(inds, key)
    return 1 if c == "green" else (0.5 if c == "amber" else 0)

def _amber_score(inds, key):
    c = _ind_color(inds, key)
    return 1 if c == "amber" else (0.5 if c == "green" else 0)

def _red_score(inds, key):
    c = _ind_color(inds, key)
    return 1 if c == "red" else (0.5 if c == "amber" else 0)

def _score_criterion(key, expect, inds, mc, r52, eps, ar):
    """Score a single criterion. Returns 0, 0.5, or 1."""
    if key == "size":
        if expect == "large":
            return 1 if mc is not None and mc >= 10e9 else (0.5 if mc is not None and mc >= 2e9 else 0)
        elif expect == "mid":
            return 1 if mc is not None and 2e9 <= mc < 10e9 else (0.5 if mc is not None and mc >= 500e6 else 0)
        elif expect == "small":
            return 1 if mc is not None and mc < 2e9 else (0.5 if mc is not None and mc < 10e9 else 0)
    elif key == "return1m":
        if expect == "positive":  return _green_score(inds, "return1M")
        if expect == "recovery":  return _red_score(inds, "return1M")
    elif key == "growth5y":
        if expect == "strong":    return _green_score(inds, "cagr5Y")
        if expect == "recovery":  return _red_score(inds, "cagr5Y")
    elif key == "momentum":
        if expect == "positive":  return _green_score(inds, "momentum")
        if expect == "neutral":
            # Suggestion applied: green → 1 (not 0.5) — "not falling" rather than "must be flat"
            c = _ind_color(inds, "momentum")
            return 1 if c in ("amber", "green") else 0
    elif key == "matrend":
        s_col = _ind_color(inds, "shortTrend")
        l_col = _ind_color(inds, "longTrend")
        if expect == "above_both":
            return 1 if s_col == "green" and l_col == "green" else (0.5 if s_col == "green" or l_col == "green" else 0)
        if expect == "above_50":
            return 1 if s_col == "green" else (0.5 if s_col == "amber" else 0)
        if expect == "below_both":
            return 1 if s_col == "red" and l_col == "red" else (0.5 if s_col == "red" or l_col == "red" else 0)
    elif key == "range52w":
        if expect == "highs":     return _green_score(inds, "range52W")
        if expect == "middle":    return _amber_score(inds, "range52W")
        if expect == "lows":      return _red_score(inds, "range52W")
    elif key == "drawdown":
        # Uses range52w_pct directly (not indicator colors) — finer thresholds needed
        if expect == "near_peak":
            return 1 if r52 is not None and r52 >= 80 else (0.5 if r52 is not None and r52 >= 50 else 0)
        if expect == "moderate":
            return 1 if r52 is not None and 40 <= r52 < 80 else (0.5 if r52 is not None and r52 >= 20 else 0)
        if expect == "deep":
            return 1 if r52 is not None and r52 < 40 else (0.5 if r52 is not None and r52 < 60 else 0)
    elif key == "vol":
        if expect == "low":       return _green_score(inds, "volatility")
        if expect == "moderate":  return _amber_score(inds, "volatility")
        if expect == "high":      return _red_score(inds, "volatility")
    elif key == "analyst":
        if expect == "buy":
            return 1 if ar in BUY_SET else (0.5 if ar == "Neutral" else 0)
        if expect == "neutral":
            return 1 if ar in NEUT_SET else 0.5
    elif key == "profit":
        if expect == "profitable":
            return 1 if eps is not None and eps > 0 else (0.5 if eps is None else 0)
    return 1  # fallback (should not reach here for valid presets)


def score_preset(inds, preset_def, mc, r52, eps, ar):
    """Score a stock against one preset (v2 weighted). Returns { scores: [...], pct: int }."""
    criteria = preset_def["criteria"]
    weighted_sum = 0
    max_weighted = 0
    scores = []

    for c in criteria:
        raw = _score_criterion(c["key"], c["expect"], inds, mc, r52, eps, ar)
        w = c["weight"]
        weighted_sum += raw * w
        max_weighted += w
        scores.append(raw)

    pct = round(weighted_sum / max_weighted * 100) if max_weighted > 0 else 0
    return {"scores": scores, "pct": pct}


def score_all_presets(inds, mc, r52, eps, ar):
    """Score a stock against all 5 presets. Returns dict of { key: {scores, pct} }."""
    result = {}
    for key, preset_def in PRESETS.items():
        result[key] = score_preset(inds, preset_def, mc, r52, eps, ar)
    return result

# ── Helpers ───────────────────────────────────────────────────────────────────

def _float(val):
    """Parse a CSV string value to float, or None if empty/invalid."""
    if val is None or val == "" or val == "N/A":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

def _round(v, dp=2):
    if v is None:
        return None
    return round(v, dp)

def mood_from_risk(risk_pct):
    for b in MOOD_BANDS:
        if b["lo"] <= risk_pct < b["hi"]:
            return {"label": b["label"], "colorKey": b["colorKey"], "color": b["color"]}
    return {"label": "Furious", "colorKey": "red", "color": "#F87171"}

def compute_mood(indicators):
    """Compute mood from indicator dict using the scoring formula."""
    vals = [v for v in indicators.values() if "color" in v]
    if not vals:
        return {"label": "Level 1", "colorKey": "blue", "color": "#60A5FA", "pct": 0.0}
    score_map = {"green": 1, "amber": 2, "red": 3}
    actual = sum(score_map.get(i["color"], 1) for i in vals)
    n = len(vals)
    risk_pct = (actual - n) / (n * 2) * 100
    risk_pct = max(0.0, min(100.0, risk_pct))
    m = mood_from_risk(risk_pct)
    return {**m, "pct": round(risk_pct, 1), "score": None}

# ── Indicator scoring ─────────────────────────────────────────────────────────

def _color(val, green_thresh, amber_thresh, invert=False):
    """
    Assign green/amber/red based on thresholds.
    invert=False: higher = better (green > green_thresh, amber in middle, red below amber_thresh)
    invert=True:  lower  = better (green < green_thresh, amber in middle, red above amber_thresh)
    """
    if val is None:
        return "amber"
    if not invert:
        if val >= green_thresh:
            return "green"
        if val >= amber_thresh:
            return "amber"
        return "red"
    else:
        if val <= green_thresh:
            return "green"
        if val <= amber_thresh:
            return "amber"
        return "red"

def ind_volatility(vol_m1):
    """Annualised volatility from 1-month daily vol × sqrt(252)."""
    if vol_m1 is None:
        return None
    ann = vol_m1 * math.sqrt(252)
    color = _color(ann, 20, 35, invert=True)   # green<20%, amber 20-35%, red>35%
    return {
        "raw": _round(ann, 1),
        "label": f"{ann:.1f}%",
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

def ind_vol_spike(rel_vol):
    """Relative volume vs 12-month average."""
    if rel_vol is None:
        return None
    color = _color(rel_vol, 1.5, 2.5, invert=True)   # green<1.5, amber 1.5-2.5, red>2.5
    label = f"{rel_vol:.2f}×"
    if rel_vol < 1.5:
        label += " — Normal activity"
    elif rel_vol < 2.5:
        label += " — Elevated activity"
    else:
        label += " — Unusual activity"
    return {
        "raw": _round(rel_vol, 2),
        "label": label,
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

def ind_vs_peak(price, high_all_time):
    """% distance from all-time high."""
    if price is None or high_all_time is None or high_all_time <= 0:
        return None
    raw = (price / high_all_time - 1) * 100
    color = _color(raw, -25, -50)   # green>-25%, amber -25 to -50%, red<-50%
    return {
        "raw": _round(raw, 1),
        "label": f"{raw:+.1f}%",
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

def ind_short_trend(price, ma50):
    """% vs 50-day moving average."""
    if price is None or ma50 is None or ma50 <= 0:
        return None
    raw = (price / ma50 - 1) * 100
    color = _color(raw, 1, -3)   # green>+1%, amber -3 to +1%, red<-3%
    return {
        "raw": _round(raw, 1),
        "label": f"{raw:+.1f}% vs 50D",
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

def ind_long_trend(price, ma200):
    """% vs 200-day moving average."""
    if price is None or ma200 is None or ma200 <= 0:
        return None
    raw = (price / ma200 - 1) * 100
    color = _color(raw, 0, -5)   # green>0%, amber -5 to 0%, red<-5%
    return {
        "raw": _round(raw, 1),
        "label": f"{raw:+.1f}% vs 200D",
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

def ind_ma_cross(ma50, ma200):
    """Golden Cross vs Death Cross."""
    if ma50 is None or ma200 is None or ma200 <= 0:
        return None
    ratio = ma50 / ma200
    is_golden = ratio > 1
    color = "green" if is_golden else "red"
    label = "Golden Cross" if is_golden else "Death Cross"
    return {
        "raw": _round(ratio, 4),
        "label": label,
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

def ind_momentum(perf_m1, perf_y1):
    """Composite momentum score: 50% recent (1M) + 50% long (1Y)."""
    if perf_m1 is None and perf_y1 is None:
        return None
    m1  = max(-10,  min(10,  perf_m1 or 0)) / 10
    y1  = max(-100, min(100, perf_y1 or 0)) / 100
    raw = _round(0.5 * m1 + 0.5 * y1, 4)
    color = _color(raw, 0.6, 0)   # green>0.6, amber 0-0.6, red<0
    pct   = raw * 100
    label = f"{pct:+.0f}%"
    return {
        "raw": raw,
        "label": label,
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

def ind_return1m(perf_m1):
    """1-month return."""
    if perf_m1 is None:
        return None
    color = _color(perf_m1, 0, -5)   # green>0%, amber -5 to 0%, red<-5%
    return {
        "raw": _round(perf_m1, 1),
        "label": f"{perf_m1:+.1f}%",
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

def ind_return1y(perf_y1):
    """1-year return."""
    if perf_y1 is None:
        return None
    color = _color(perf_y1, 10, 0)   # green>10%, amber 0-10%, red<0%
    return {
        "raw": _round(perf_y1, 1),
        "label": f"{perf_y1:+.1f}%",
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

def ind_range52w(price, high52w, low52w):
    """Position within 52-week range."""
    if price is None or high52w is None or low52w is None:
        return None
    span = high52w - low52w
    if span <= 0:
        return None
    raw = (price - low52w) / span * 100
    color = _color(raw, 50, 25)   # green>50%, amber 25-50%, red<25%
    return {
        "raw": _round(raw, 1),
        "label": f"{raw:.0f}%",
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

def ind_cagr5y(perf_y5):
    """5-year CAGR computed from 5Y total return."""
    if perf_y5 is None:
        return None
    # 5Y CAGR: (1 + perf_y5/100)^(1/5) - 1
    factor = 1 + perf_y5 / 100
    if factor <= 0:
        cagr = -100.0
    else:
        cagr = (factor ** (1/5) - 1) * 100
    color = _color(cagr, 8, 0)   # green>8%, amber 0-8%, red<0%
    return {
        "raw": _round(cagr, 1),
        "label": f"{cagr:+.1f}%",
        "color": color,
        "pts": {"green": 0, "amber": 1, "red": 2}[color],
    }

# ── CSV parsing ───────────────────────────────────────────────────────────────

def find_csv():
    """Find the CSV data source. Supports:
    - CLI argument: python3 build_data.py path/to/file.csv
    - Dated files:  data/stocks-2026-04-11.csv (picks the most recent)
    - Plain file:   data/stocks.csv (fallback)
    """
    if len(sys.argv) > 1:
        return sys.argv[1]
    # Look for dated files first (most recent wins)
    dated = sorted(_glob.glob(os.path.join(CSV_DIR, "stocks-*.csv")))
    if dated:
        return dated[-1]
    # Fall back to plain stocks.csv
    plain = os.path.join(CSV_DIR, "stocks.csv")
    if os.path.exists(plain):
        return plain
    raise FileNotFoundError(f"No CSV files found in {CSV_DIR}/")

def parse_data_date(csv_path):
    """Extract the data date from the CSV filename.
    stocks-2026-04-11.csv → '2026-04-11'
    stocks-20260411.csv   → '2026-04-11'
    stocks.csv            → today's date
    """
    base = os.path.basename(csv_path)
    # Try YYYY-MM-DD
    m = re.search(r'(\d{4}-\d{2}-\d{2})', base)
    if m:
        return m.group(1)
    # Try YYYYMMDD
    m = re.search(r'(\d{4})(\d{2})(\d{2})', base)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # Fallback: today
    return datetime.now().strftime("%Y-%m-%d")

def parse_row(row):
    """Parse a CSV row dict into a structured stock dict."""
    p     = _float(row.get("Price"))
    ma50  = _float(row.get("Simple Moving Average (50) 1 day"))
    ma200 = _float(row.get("Simple Moving Average (200) 1 day"))

    perf_w1  = _float(row.get("Performance % 1 week"))
    perf_m1  = _float(row.get("Performance % 1 month"))
    perf_m3  = _float(row.get("Performance % 3 months"))
    perf_m6  = _float(row.get("Performance % 6 months"))
    perf_ytd = _float(row.get("Performance % Year to date"))
    perf_y1  = _float(row.get("Performance % 1 year"))
    perf_y5  = _float(row.get("Performance % 5 years"))
    perf_y10 = _float(row.get("Performance % 10 years"))
    perf_all = _float(row.get("Performance % All Time"))

    vol_d1 = _float(row.get("Volatility 1 day"))
    vol_w1 = _float(row.get("Volatility 1 week"))
    vol_m1 = _float(row.get("Volatility 1 month"))

    high_all  = _float(row.get("High All Time"))
    high_52w  = _float(row.get("High 52 weeks"))
    low_52w   = _float(row.get("Low 52 weeks"))

    rel_vol   = _float(row.get("Relative Volume at Time"))

    beta5y    = _float(row.get("Beta 5 years"))
    epsbasic  = _float(row.get("Earnings per share basic, Annual"))
    epsdilut  = _float(row.get("Earnings per share diluted, Annual"))
    ebitda    = _float(row.get("EBITDA, Annual"))
    grosspft  = _float(row.get("Gross profit, Annual"))
    netinc    = _float(row.get("Net income, Annual"))
    fcf       = _float(row.get("Free cash flow, Annual"))
    dte_ratio = _float(row.get("Debt to equity ratio, Annual"))
    dtr_ratio = _float(row.get("Debt to revenue ratio, Annual"))
    mktcap    = _float(row.get("Market capitalization"))
    divps     = _float(row.get("Dividends per share, Annual"))

    vol_chg_w1 = _float(row.get("Volume Change % 1 week"))
    vol_chg_m1 = _float(row.get("Volume Change % 1 month"))
    gap_m1     = _float(row.get("Gap % 1 month"))
    avg_vol_90 = _float(row.get("Average Volume 90 days"))
    vol_1d     = _float(row.get("Volume 1 day"))

    # Absolute price change from 1D %
    pct_1d = _float(row.get("Price Change % 1 day"))
    if p is not None and pct_1d is not None:
        prev_p = p / (1 + pct_1d / 100)
        price_change = round(p - prev_p, 4)
    else:
        price_change = None

    # debtToEquity stored × 100 for backward compatibility with renderFinancials
    dte_stored = round(dte_ratio * 100, 4) if dte_ratio is not None else None

    # Indicators
    inds = {}
    v = ind_volatility(vol_m1)
    if v: inds["volatility"] = v

    v = ind_vol_spike(rel_vol)
    if v: inds["volSpike"] = v

    v = ind_vs_peak(p, high_all)
    if v: inds["vsPeak"] = v

    v = ind_short_trend(p, ma50)
    if v: inds["shortTrend"] = v

    v = ind_long_trend(p, ma200)
    if v: inds["longTrend"] = v

    v = ind_ma_cross(ma50, ma200)
    if v: inds["maCross"] = v

    v = ind_momentum(perf_m1, perf_y1)
    if v: inds["momentum"] = v

    v = ind_return1m(perf_m1)
    if v: inds["return1M"] = v

    v = ind_return1y(perf_y1)
    if v: inds["return1Y"] = v

    v = ind_range52w(p, high_52w, low_52w)
    if v: inds["range52W"] = v

    v = ind_cagr5y(perf_y5)
    if v: inds["cagr5Y"] = v

    mood = compute_mood(inds)

    # Indicator color string for search.json
    ic_chars = []
    for key in IND_ORDER:
        k = key
        ind = inds.get(k)
        ic_chars.append(COLOR_MAP.get(ind["color"], "a") if ind else "a")
    ic_str = "".join(ic_chars)

    # Performance object (only include non-null values)
    def perf_val(v):
        return _round(v, 4) if v is not None else None

    performance = {
        "w1":  perf_val(perf_w1),
        "m1":  perf_val(perf_m1),
        "m3":  perf_val(perf_m3),
        "m6":  perf_val(perf_m6),
        "ytd": perf_val(perf_ytd),
        "y1":  perf_val(perf_y1),
        "y5":  perf_val(perf_y5),
        "y10": perf_val(perf_y10),
        "all": perf_val(perf_all),
    }

    volatility_obj = {
        "d1": _round(vol_d1, 4),
        "w1": _round(vol_w1, 4),
        "m1": _round(vol_m1, 4),
    }

    financials = {
        "period":          row.get("Fiscal period end date, Annual") or None,
        "epsBasic":        _round(epsbasic, 4),
        "epsDiluted":      _round(epsdilut, 4),
        "ebitda":          _round(ebitda, 0),
        "grossProfit":     _round(grosspft, 0),
        "netIncome":       _round(netinc, 0),
        "freeCashFlow":    _round(fcf, 0),
        "debtToRevenue":   _round(dtr_ratio, 6),
        "debtToEquity":    dte_stored,
        "marketCap":       _round(mktcap, 2),
        "dividendsPerShare": _round(divps, 4),
        "epsReported":     _round(epsdilut, 4),
        "beta":            _round(beta5y, 4),
    }

    range52w_pct = None
    if p is not None and high_52w is not None and low_52w is not None:
        span = high_52w - low_52w
        if span > 0:
            range52w_pct = _round((p - low_52w) / span * 100, 1)

    ann_vol = None
    if vol_m1 is not None:
        ann_vol = _round(vol_m1 * math.sqrt(252), 1)

    # Pre-compute hunting style scores for all 5 presets
    preset_scores = score_all_presets(inds, mktcap, range52w_pct, epsbasic, row.get("Analyst Rating", ""))

    return {
        "ticker":        row["Symbol"],
        "company":       row.get("Description", ""),
        "price":         p,
        "priceChange":   price_change,
        "currency":      row.get("Price - Currency", "USD") or "USD",
        "sector":        row.get("Sector", ""),
        "industry":      row.get("Industry", ""),
        "country":       row.get("Country or region of registration", ""),
        "analystRating": row.get("Analyst Rating", ""),
        "indexList":     row.get("Index", ""),
        "performance":   performance,
        "volatilityRaw": volatility_obj,
        "ma50":          _round(ma50, 4),
        "ma200":         _round(ma200, 4),
        "beta5Y":        _round(beta5y, 4),
        "financials":    financials,
        "indicators":    inds,
        "mood":          mood,
        "prevMood":      dict(mood),
        "swing":         {"delta": 0, "state": "flat"},
        "moodHistory":   {},
        "_ic":           ic_str,
        "_exchange":     None,   # filled later
        "_perf_m1":      perf_m1,
        "_perf_y1":      perf_y1,
        "_perf_m3":      perf_m3,
        "_perf_y5":      perf_y5,
        "_range52w_pct": range52w_pct,
        "_ann_vol":      ann_vol,
        "_rel_vol":      _round(rel_vol, 2),
        "_vol_chg_w1":   _round(vol_chg_w1, 2),
        "_vol_chg_m1":   _round(vol_chg_m1, 2),
        "_gap_m1":       _round(gap_m1, 2),
        "_avg_vol_90":   _round(avg_vol_90, 0),
        "_indices":      {i.strip() for i in row.get("Index", "").split(",") if i.strip()},
        "_mood_score":   mood,
        "_preset_scores": preset_scores,
    }

# ── Exchange tagging ──────────────────────────────────────────────────────────

def get_primary_exchange(stock_indices):
    """Return the primary exchange key for display tagging.
    Uses the first matching index from the CSV Index column.
    Returns None if the stock isn't in any tracked exchange."""
    for idx_name, ex_key in INDEX_TO_EXCHANGE.items():
        if idx_name in stock_indices:
            return ex_key
    return None

# ── Exchange-level mood ───────────────────────────────────────────────────────

def exchange_mood(stocks):
    """Compute aggregate mood for an exchange from its stocks."""
    if not stocks:
        return {"label": "Level 1", "colorKey": "blue", "color": "#60A5FA", "pct": 0.0, "score": None}
    pcts = [s["mood"]["pct"] for s in stocks if s["mood"].get("pct") is not None]
    if not pcts:
        return {"label": "Level 1", "colorKey": "blue", "color": "#60A5FA", "pct": 0.0, "score": None}
    avg = sum(pcts) / len(pcts)
    m = mood_from_risk(avg)
    return {**m, "pct": round(avg, 1), "score": None}

def mood_counts(stocks):
    from collections import Counter
    c = Counter(s["mood"]["label"] for s in stocks)
    return dict(c)

# ── Stock entry for exchange file ─────────────────────────────────────────────

def make_exchange_entry(s):
    """Build the stock object written into exchange JSON files."""
    return {
        "ticker":        s["ticker"],
        "company":       s["company"],
        "price":         s["price"],
        "priceChange":   s["priceChange"],
        "currency":      s["currency"],
        "sector":        s["sector"],
        "industry":      s["industry"],
        "country":       s["country"],
        "analystRating": s["analystRating"],
        "indexList":     s["indexList"],
        "performance":   s["performance"],
        "volatility":    s["volatilityRaw"],
        "ma50":          s["ma50"],
        "ma200":         s["ma200"],
        "beta5Y":        s["beta5Y"],
        "financials":    s["financials"],
        "mood":          s["mood"],
        "prevMood":      s["prevMood"],
        "swing":         s["swing"],
        "indicators":    s["indicators"],
        "moodHistory":   {},
        "presetScores":  s["_preset_scores"],
    }

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    csv_path = find_csv()
    data_date = parse_data_date(csv_path)
    print(f"Reading CSV: {csv_path}  (data date: {data_date})")

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    print(f"  {len(rows):,} rows")

    # Parse all stocks — only filter is: must have a price
    stocks = []
    errors = 0
    for row in rows:
        try:
            s = parse_row(row)
            if s["price"] is None:
                continue
            stocks.append(s)
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  WARNING: parse error on {row.get('Symbol')}: {e}")
    print(f"  {len(stocks):,} stocks parsed ({errors} skipped)")

    # Tag each stock with a primary exchange (for display only)
    for s in stocks:
        s["_exchange"] = get_primary_exchange(s["_indices"])

    # ── Write chunk files ────────────────────────────────────────────────────
    # ALL stocks are grouped by first character of ticker and written to
    # chunk_{char}.json. This is the ONLY source of full stock data.
    os.makedirs(DATA_DIR, exist_ok=True)
    # Use data date from filename for display (e.g., "11 Apr 2026")
    dd = datetime.strptime(data_date, "%Y-%m-%d")
    as_of = dd.strftime("%d %b %Y").lstrip("0")

    chunks = {}
    for s in stocks:
        ch = s["ticker"][0].lower()
        chunks.setdefault(ch, []).append(s)

    for ch, chunk_stocks in sorted(chunks.items()):
        chunk_key = f"chunk_{ch}"
        payload = {
            "exchange": chunk_key,
            "label":    "All",
            "asOf":     as_of,
            "mood":     exchange_mood(chunk_stocks),
            "stats": {
                "total":       len(chunk_stocks),
                "moodCounts":  mood_counts(chunk_stocks),
            },
            "stocks": [make_exchange_entry(s) for s in chunk_stocks],
        }
        out_path = os.path.join(DATA_DIR, f"{chunk_key}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)

    print(f"  Wrote {len(chunks)} chunk files  ({len(stocks):,} stocks total)")

    # ── Write search.json ────────────────────────────────────────────────────
    # Compact index of all stocks for search, Browse, and Finder.
    # x = primary exchange tag (for display/filtering), NOT a file reference.
    search_entries = [
        {
            "t":   s["ticker"],
            "n":   s["company"],
            "p":   s["price"],
            "c":   s["currency"],
            "m":   s["mood"]["label"],
            "r":   s["mood"]["pct"],
            "x":   s["_exchange"],
            "sec": s["sector"],
            "co":  s["country"],
            "ic":  s["_ic"],
            "m1":  s["performance"].get("m1"),
            "m3":  s["performance"].get("m3"),
            "ytd": s["performance"].get("ytd"),
            "y1":  s["performance"].get("y1"),
            "y5":  s["performance"].get("y5"),
            "gp":  s["financials"].get("grossProfit"),
            "ni":  s["financials"].get("netIncome"),
            "ma50":  s["ma50"],
            "ma200": s["ma200"],
            "r52":   s["_range52w_pct"],
            "vol":   s["_ann_vol"],
            "rv":    s["_rel_vol"],
            "vcw":   s["_vol_chg_w1"],
            "vcm":   s["_vol_chg_m1"],
            "gap":   s["_gap_m1"],
            "av90":  s["_avg_vol_90"],
            "beta":  s["beta5Y"],
            "dte":   s["financials"].get("debtToEquity"),
            "fcf":   s["financials"].get("freeCashFlow"),
            "eps":   s["financials"].get("epsBasic"),
            "div":   s["financials"].get("dividendsPerShare"),
            "mc":    s["financials"].get("marketCap"),
            "ar":    s.get("analystRating", ""),
            "ps":    {k: v["pct"] for k, v in s["_preset_scores"].items()},
        }
        for s in stocks
    ]

    search_path = os.path.join(DATA_DIR, "search.json")
    with open(search_path, "w", encoding="utf-8") as f:
        json.dump(search_entries, f, separators=(",", ":"), ensure_ascii=False)
    print(f"  Wrote {search_path}  ({len(search_entries):,} stocks)")

    # ── Write meta.json ──────────────────────────────────────────────────────
    meta = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataDate":    data_date,
        "csvSource":   os.path.basename(csv_path),
        "source": "TradingView CSV",
    }
    meta_path = os.path.join(DATA_DIR, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, separators=(",", ":"), ensure_ascii=False)
    print(f"  Wrote {meta_path}")

    # ── Preserve index.json ──────────────────────────────────────────────────
    index_path = os.path.join(DATA_DIR, "index.json")
    if os.path.exists(index_path):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                existing_index = json.load(f)
            with open(index_path, "w", encoding="utf-8") as f:
                json.dump(existing_index, f, separators=(",", ":"), ensure_ascii=False)
            print(f"  Preserved {index_path}")
        except Exception as e:
            print(f"  WARNING: could not preserve {index_path}: {e}")
    else:
        skeleton = {}
        for ex_key in EXCHANGE_LABELS:
            skeleton[ex_key] = {"price": None, "indicators": {}, "mood": {}, "history": []}
        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(skeleton, f, separators=(",", ":"), ensure_ascii=False)
        print(f"  Generated {index_path}  (skeleton)")

    print("\nDone!")

if __name__ == "__main__":
    main()
