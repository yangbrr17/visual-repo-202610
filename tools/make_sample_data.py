#!/usr/bin/env python3
"""Deterministic synthetic sample datasets for ReportKit (gallery + demo reports).

The story: a fictional listed industrial-technology company, **Helios Industrial**
(ticker HLX), is being evaluated for a sale ("Project Atlas") against 17 fictional
peers in three sectors and four regions. Every company, bank, fund, person and
rating agency in these files is invented.

All numbers come from one small, internally consistent model:

* one financial model (revenue -> EBITDA -> EBIT -> net income -> unlevered FCF)
  feeds ``financials``, ``quarterly``, ``scenarios``, ``pnl_flow``, ``ebitda_bridge``,
  the DCF (``sensitivity_dcf``, ``ev_equity_bridge``) and the LBO (``sensitivity_lbo``);
* one simulated daily market (market factor + sector factors + idiosyncratic noise
  + event jumps) feeds ``price_ohlc``, ``price_perf``, ``ntm_multiple``,
  ``corr_matrix``, ``monthly_returns``, ``daily_activity`` and the 52-week / TSR
  columns of ``peers``;
* ``valuation_ranges`` is derived from the datasets above (peer multiples, precedent
  multiples and premiums, DCF and LBO grids, 52-week range), so the football field
  agrees with every other page.

Usage::

    python3 tools/make_sample_data.py              # write kit/samples/{datasets/*.json,index.json,README.md}
    python3 tools/make_sample_data.py --check      # regenerate in memory and validate the files on disk
    python3 tools/make_sample_data.py --out DIR    # write somewhere else

Library use::

    from make_sample_data import generate, write
    datasets = generate()            # {id: dataset-dict in the ReportKit data contract}
    write(datasets, Path("out"))

Python 3.10+ standard library only. Same seed -> byte-identical files.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import random
import re
import statistics
import sys
from pathlib import Path

__all__ = ["SEED", "AS_OF", "generate", "write", "validate", "check_consistency", "PURPOSE", "main"]

SEED = 2026
AS_OF = "2026-10-10"
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "kit" / "samples"
WORLD_ATLAS = ROOT / "vendor" / "world-atlas" / "countries-110m.json"
MAX_FOLDER_BYTES = 2_500_000

# ----------------------------------------------------------------------------
# Excel-style format codes (see kit/core/rk.format.js)
# ----------------------------------------------------------------------------
F_USDM = "$#,##0"            # USD m, no decimals
F_USDM1 = "$#,##0.0"         # USD m, one decimal
F_USDBN = "$#,##0.0\"bn\""
F_PX = "$#,##0.00"           # per-share prices
F_MULT = "0.0x"
F_PCT = "0.0%"
F_PCT0 = "0%"
F_PCT2 = "0.00%"
F_DPCT = "+0.0%;-0.0%;0.0%"
F_NUM = "#,##0.0"
F_NUM2 = "#,##0.00"
F_INT = "#,##0"
F_YEAR = "0"
F_DATE = "dd mmm yyyy"
F_COORD = "0.00"

SRC_CO = "Helios Industrial filings and management information; ReportKit synthetic data"
SRC_MKT = "Market data provider (synthetic); market data as of 10-Oct-2026"
SRC_ANALYSIS = "Project Atlas analysis (synthetic); Helios Industrial management plan"
SYNTH_NOTE = "Illustrative synthetic data (tools/make_sample_data.py, seed 2026); all companies, banks and investors are fictional."

# ----------------------------------------------------------------------------
# Target capital structure (USD m unless stated)
# ----------------------------------------------------------------------------
PRICE = 42.50                 # current share price, close 09-Oct-2026 (last close before asOf)
START_PRICE = 35.20           # close 14-Oct-2024 (first day of price history)
SHARES = 158.0                # diluted shares, m
BASIC_SHARES = 155.2          # basic shares outstanding, m (ownership table)
GROSS_DEBT = 2105.0
CASH = 615.0
NET_DEBT = GROSS_DEBT - CASH  # 1,490.0
PENSION = 120.0
MINORITIES = 85.0
ASSOCIATES = 60.0
OTHER_ADJ = -PENSION - MINORITIES + ASSOCIATES   # -145.0
MKT_CAP = PRICE * SHARES      # 6,715.0
EV = MKT_CAP + NET_DEBT       # 8,205.0
DIV_YIELD = 0.016
NET_DEBT_2024 = 1640.0        # net debt at 14-Oct-2024 (for NTM multiple history)

TAX = 0.25
DA_PCT = 0.045
NWC_PCT = 0.14                # incremental NWC as % of incremental revenue

DCF_WACC = [0.075, 0.080, 0.085, 0.090, 0.095, 0.100, 0.105]
DCF_TGR = [0.015, 0.020, 0.025, 0.030, 0.035]
DCF_BASE = (0.090, 0.025)
LBO_MULTS = [8.0, 9.0, 10.0, 11.0, 12.0]
LBO_LEVERAGE = 5.0            # x FY26E EBITDA
LBO_RATE = 0.085
LBO_FEES = 0.025              # of entry EV
LBO_EXIT_REF = 9.0            # exit multiple used for the football-field LBO bar

DAY0 = dt.date(2024, 10, 14)
DAY_END = dt.date(2026, 10, 13)
REF_DAY = dt.date(2026, 10, 9)        # last trading day on/before asOf (10-Oct-2026 is a Saturday)
ONE_YEAR_AGO = dt.date(2025, 10, 9)

REGIONS = ["North America", "Europe", "Asia Pacific", "Latin America"]
SECTORS = ["Industrial Automation", "Motion & Power Control", "Industrial Software & Sensors"]
IA, MPC, ISS = SECTORS

# ----------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------

def rnd(x, n=1):
    """Round to n decimals; None passes through; never returns -0.0."""
    if x is None:
        return None
    v = round(float(x), n)
    return 0.0 if v == 0 else v


def iso(d: dt.date) -> str:
    return d.isoformat()


def _f(name, type_, title, fmt=None, unit=None, **extra):
    d = {"name": name, "type": type_, "title": title}
    if fmt:
        d["format"] = fmt
    if unit:
        d["unit"] = unit
    d.update(extra)
    return d


def S(name, title, **kw):
    return _f(name, "string", title, **kw)


def N(name, title, fmt=None, unit=None, **kw):
    return _f(name, "number", title, fmt, unit, **kw)


def D(name, title, fmt=F_DATE, **kw):
    return _f(name, "date", title, fmt, **kw)


def B(name, title, **kw):
    return _f(name, "boolean", title, **kw)


def A(name, title, **kw):
    return _f(name, "array", title, **kw)


def make_ds(id_, title, fields, rows, *, source, notes=(), unit=None):
    names = [f["name"] for f in fields]
    nameset = set(names)
    data = []
    for i, r in enumerate(rows):
        if set(r) != nameset:
            raise ValueError(f"{id_}[{i}]: keys {sorted(set(r) ^ nameset)} do not match schema")
        data.append({n: r[n] for n in names})
    meta = {"source": source}
    if unit:
        meta["unit"] = unit
    meta["notes"] = [*notes, SYNTH_NOTE]
    meta["asOf"] = AS_OF
    return {"id": id_, "title": title, "schema": {"fields": fields}, "data": data, "meta": meta}


def bdays(start: dt.date, end: dt.date) -> list[dt.date]:
    out, d = [], start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def quantile(values, q):
    """Linear-interpolated quantile (Excel PERCENTILE.INC)."""
    xs = sorted(values)
    pos = (len(xs) - 1) * q
    lo = math.floor(pos)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def pct_rank(values, v):
    xs = sorted(values)
    below = sum(1 for x in xs if x < v)
    equal = sum(1 for x in xs if x == v)
    return (below + 0.5 * (equal - 1)) / (len(xs) - 1)


def allocate(total, weights, n=1):
    """Split `total` by weights, rounded to n decimals, residual pushed to the largest bucket."""
    s = sum(weights)
    parts = [rnd(total * w / s, n) for w in weights]
    k = max(range(len(parts)), key=lambda i: parts[i])
    parts[k] = rnd(parts[k] + (rnd(total, n) - sum(parts)), n)
    return parts


def ylabel(y: int) -> str:
    return f"{y}{'A' if y <= 2025 else 'E'}"


# ----------------------------------------------------------------------------
# Static reference data
# ----------------------------------------------------------------------------
# company, ticker, sector, region, ISO3, HQ city, lat, lon
PEERS = [
    ("Helios Industrial", "HLX", IA, "North America", "USA", "Pittsburgh", 40.44, -80.00),
    ("Corvane Automation", "CRVA", IA, "Europe", "DEU", "Stuttgart", 48.78, 9.18),
    ("Valdris Controls", "VLDS", IA, "Europe", "CHE", "Zurich", 47.38, 8.54),
    ("Tessaro Robotics", "TSRO", IA, "North America", "USA", "Boston", 42.36, -71.06),
    ("Kanemori Systems", "KNMR", IA, "Asia Pacific", "JPN", "Nagoya", 35.18, 136.91),
    ("Vantoro Industrial", "VTRO", IA, "Latin America", "BRA", "Sao Paulo", -23.55, -46.63),
    ("Norrvik Drives", "NRVK", MPC, "Europe", "SWE", "Gothenburg", 57.71, 11.97),
    ("Ironvale Power Systems", "IVPS", MPC, "North America", "USA", "Milwaukee", 43.04, -87.91),
    ("Castellari Motion", "CSTM", MPC, "Europe", "ITA", "Milan", 45.46, 9.19),
    ("Sohwa Motion", "SOHW", MPC, "Asia Pacific", "KOR", "Changwon", 35.23, 128.68),
    ("Qingtai Electromech", "QTEM", MPC, "Asia Pacific", "CHN", "Shenzhen", 22.54, 114.06),
    ("Sierra Alta Industrial", "SAIN", MPC, "Latin America", "MEX", "Monterrey", 25.69, -100.32),
    ("Quintar Sensing", "QNTR", ISS, "North America", "CAN", "Toronto", 43.65, -79.38),
    ("Orbisant Software", "ORBT", ISS, "Europe", "GBR", "Cambridge", 52.21, 0.12),
    ("Halvern Instruments", "HLVN", ISS, "North America", "USA", "Austin", 30.27, -97.74),
    ("Meridale Metrology", "MRDL", ISS, "Europe", "FRA", "Lyon", 45.76, 4.84),
    ("Tasman Crest Instruments", "TCIN", ISS, "Asia Pacific", "AUS", "Sydney", -33.87, 151.21),
    ("Andalina Digital", "ANDL", ISS, "Latin America", "CHL", "Santiago", -33.45, -70.67),
]

SECTOR_PARAMS = {
    #          revenue range      growth 25E      EBITDA margin   EV/EBITDA 25E   ND/EBITDA      div. yield      ROIC
    IA: dict(rev=(2200, 14000), g=(0.03, 0.10), m=(0.16, 0.24), mult=(9.4, 12.2), lev=(0.3, 2.2), dy=(0.008, 0.026), roic=(0.09, 0.17)),
    MPC: dict(rev=(1800, 16000), g=(0.01, 0.07), m=(0.12, 0.19), mult=(7.2, 10.2), lev=(0.6, 2.8), dy=(0.012, 0.034), roic=(0.07, 0.13)),
    ISS: dict(rev=(900, 6000), g=(0.08, 0.18), m=(0.22, 0.33), mult=(12.5, 19.0), lev=(-0.6, 1.2), dy=(0.0, 0.012), roic=(0.12, 0.24)),
}
SECTOR_DRIFT = {IA: 0.00012, MPC: -0.00008, ISS: 0.00030}

# iso3, iso numeric (world-atlas id), name, region, centroid lat, lon, weight within region, revenue/employee (USD k)
COUNTRIES = [
    ("USA", "840", "United States", "North America", 39.80, -98.60, 88.0, 315),
    ("CAN", "124", "Canada", "North America", 56.10, -106.30, 12.0, 290),
    ("DEU", "276", "Germany", "Europe", 51.20, 10.40, 27.0, 265),
    ("GBR", "826", "United Kingdom", "Europe", 54.00, -2.00, 13.0, 270),
    ("FRA", "250", "France", "Europe", 46.60, 2.20, 12.0, 260),
    ("ITA", "380", "Italy", "Europe", 42.80, 12.60, 9.0, 240),
    ("ESP", "724", "Spain", "Europe", 40.40, -3.70, 6.0, 230),
    ("NLD", "528", "Netherlands", "Europe", 52.10, 5.30, 5.0, 285),
    ("CHE", "756", "Switzerland", "Europe", 46.80, 8.20, 5.0, 330),
    ("SWE", "752", "Sweden", "Europe", 60.10, 18.60, 4.0, 280),
    ("POL", "616", "Poland", "Europe", 51.90, 19.10, 5.0, 140),
    ("CZE", "203", "Czechia", "Europe", 49.80, 15.50, 3.0, 150),
    ("AUT", "040", "Austria", "Europe", 47.50, 14.60, 3.0, 255),
    ("BEL", "056", "Belgium", "Europe", 50.50, 4.50, 3.0, 260),
    ("DNK", "208", "Denmark", "Europe", 56.30, 9.50, 1.5, 290),
    ("NOR", "578", "Norway", "Europe", 60.50, 8.50, 1.5, 300),
    ("FIN", "246", "Finland", "Europe", 61.90, 25.70, 1.2, 270),
    ("IRL", "372", "Ireland", "Europe", 53.40, -8.20, 1.0, 320),
    ("PRT", "620", "Portugal", "Europe", 39.40, -8.20, 1.3, 190),
    ("CHN", "156", "China", "Asia Pacific", 35.90, 104.20, 38.0, 150),
    ("JPN", "392", "Japan", "Asia Pacific", 36.20, 138.30, 20.0, 280),
    ("KOR", "410", "South Korea", "Asia Pacific", 35.90, 127.80, 10.0, 250),
    ("IND", "356", "India", "Asia Pacific", 20.60, 79.00, 9.0, 70),
    ("AUS", "036", "Australia", "Asia Pacific", -25.30, 133.80, 8.0, 290),
    ("IDN", "360", "Indonesia", "Asia Pacific", -0.80, 113.90, 3.5, 90),
    ("THA", "764", "Thailand", "Asia Pacific", 15.90, 101.00, 3.5, 110),
    ("VNM", "704", "Vietnam", "Asia Pacific", 14.10, 108.30, 2.5, 85),
    ("MYS", "458", "Malaysia", "Asia Pacific", 4.20, 102.00, 2.5, 120),
    ("PHL", "608", "Philippines", "Asia Pacific", 12.90, 121.80, 1.5, 80),
    ("NZL", "554", "New Zealand", "Asia Pacific", -40.90, 174.90, 1.0, 260),
    ("BRA", "076", "Brazil", "Latin America", -14.20, -51.90, 42.0, 120),
    ("MEX", "484", "Mexico", "Latin America", 23.60, -102.50, 33.0, 115),
    ("ARG", "032", "Argentina", "Latin America", -38.40, -63.60, 8.0, 110),
    ("CHL", "152", "Chile", "Latin America", -35.70, -71.50, 8.0, 140),
    ("COL", "170", "Colombia", "Latin America", 4.60, -74.30, 5.0, 100),
    ("PER", "604", "Peru", "Latin America", -9.20, -75.00, 4.0, 100),
]
COUNTRY_BY_NAME = {c[2]: c for c in COUNTRIES}
EXTRA_COORDS = {"Singapore": (1.35, 103.82), "United Arab Emirates": (24.0, 54.0), "Israel": (31.0, 34.9)}

# English, Chinese (official full name), adcode, weight
CHINA_PROVINCES = [
    ("Beijing", "北京市", "110000", 4.2), ("Tianjin", "天津市", "120000", 2.2), ("Hebei", "河北省", "130000", 3.2),
    ("Shanxi", "山西省", "140000", 1.5), ("Inner Mongolia", "内蒙古自治区", "150000", 1.3),
    ("Liaoning", "辽宁省", "210000", 2.4), ("Jilin", "吉林省", "220000", 0.9), ("Heilongjiang", "黑龙江省", "230000", 0.9),
    ("Shanghai", "上海市", "310000", 6.0), ("Jiangsu", "江苏省", "320000", 12.0), ("Zhejiang", "浙江省", "330000", 8.0),
    ("Anhui", "安徽省", "340000", 3.8), ("Fujian", "福建省", "350000", 4.4), ("Jiangxi", "江西省", "360000", 2.2),
    ("Shandong", "山东省", "370000", 8.0), ("Henan", "河南省", "410000", 4.5), ("Hubei", "湖北省", "420000", 4.3),
    ("Hunan", "湖南省", "430000", 3.6), ("Guangdong", "广东省", "440000", 12.5), ("Guangxi", "广西壮族自治区", "450000", 1.6),
    ("Hainan", "海南省", "460000", 0.4), ("Chongqing", "重庆市", "500000", 2.6), ("Sichuan", "四川省", "510000", 4.2),
    ("Guizhou", "贵州省", "520000", 1.1), ("Yunnan", "云南省", "530000", 1.6), ("Tibet", "西藏自治区", "540000", 0.1),
    ("Shaanxi", "陕西省", "610000", 2.6), ("Gansu", "甘肃省", "620000", 0.6), ("Qinghai", "青海省", "630000", 0.25),
    ("Ningxia", "宁夏回族自治区", "640000", 0.35), ("Xinjiang", "新疆维吾尔自治区", "650000", 1.0),
    ("Taiwan", "台湾省", "710000", 2.0), ("Hong Kong", "香港特别行政区", "810000", 1.8), ("Macao", "澳门特别行政区", "820000", 0.15),
]

SEGMENTS = ["Factory Automation", "Motion Control", "Sensors & Instrumentation", "Software & Services"]
SEG_SHARE = {  # 2021 -> 2026 linear
    "Factory Automation": (0.405, 0.368),
    "Motion Control": (0.282, 0.262),
    "Sensors & Instrumentation": (0.193, 0.212),
}
SEG_REGION = {
    "Factory Automation": (0.40, 0.33, 0.21, 0.06),
    "Motion Control": (0.36, 0.37, 0.21, 0.06),
    "Sensors & Instrumentation": (0.38, 0.27, 0.29, 0.06),
    "Software & Services": (0.52, 0.29, 0.15, 0.04),
}
PRODUCT_LINES = {
    "Factory Automation": [("fa-cells", "Robotic work cells", 0.34), ("fa-plc", "PLCs & controllers", 0.29),
                           ("fa-vision", "Machine vision systems", 0.17), ("fa-handling", "Conveyors & handling", 0.20)],
    "Motion Control": [("mc-servo", "Servo drives", 0.44), ("mc-motors", "Precision motors", 0.33),
                       ("mc-gear", "Gearboxes & actuators", 0.23)],
    "Sensors & Instrumentation": [("si-sensors", "Industrial sensors", 0.47), ("si-metrology", "Metrology instruments", 0.31),
                                  ("si-cm", "Condition monitoring", 0.22)],
    "Software & Services": [("ss-mes", "Factory software (MES)", 0.36), ("ss-field", "Field services", 0.38),
                            ("ss-parts", "Spare parts & retrofits", 0.26)],
}
SEG_IDS = {"Factory Automation": "fa", "Motion Control": "mc", "Sensors & Instrumentation": "si", "Software & Services": "ss"}

# date, label, kind, jump (daily return), detail (None -> built from the quarterly beat)
EVENTS = [
    ("2024-11-05", "Q3-24 results", "earnings", 0.048, "Q3-24"),
    ("2025-02-11", "FY24 results; soft FY25 guide", "guidance", -0.062, None),
    ("2025-05-06", "Q1-25 beat", "earnings", 0.055, "Q1-25"),
    ("2025-07-15", "Acquires Brennick Robotics", "m&a", 0.030, None),
    ("2025-08-05", "Q2-25 miss", "earnings", -0.075, "Q2-25"),
    ("2025-09-16", "Credit upgrade to BBB", "rating", 0.018, None),
    ("2025-11-04", "Q3-25 results", "earnings", 0.061, "Q3-25"),
    ("2026-02-10", "FY25 results; FY26 guide", "guidance", 0.040, None),
    ("2026-05-05", "Q1-26 beat", "earnings", 0.032, "Q1-26"),
    ("2026-06-18", "Press reports of sponsor interest", "m&a", 0.095, None),
    ("2026-08-04", "Q2-26 beat; guidance raised", "guidance", 0.050, None),
    ("2026-10-06", "Q3-26 trading update", "earnings", -0.024, "Q3-26"),
]
BEATS = {"Q1-24": 0.012, "Q2-24": 0.008, "Q3-24": 0.024, "Q4-24": -0.006, "Q1-25": 0.021, "Q2-25": -0.031,
         "Q3-25": 0.026, "Q4-25": 0.014, "Q1-26": 0.018, "Q2-26": 0.029, "Q3-26": 0.003}

# ----------------------------------------------------------------------------
# Financial model (deterministic)
# ----------------------------------------------------------------------------
REVENUE = {2018: 3240.0, 2019: 3385.0, 2020: 3230.0, 2021: 3612.0, 2022: 3978.0, 2023: 4262.0,
           2024: 4515.0, 2025: 4850.0, 2026: 5190.0, 2027: 5560.0, 2028: 5940.0}
EBITDA_MARGIN = {2019: 0.158, 2020: 0.146, 2021: 0.161, 2022: 0.169, 2023: 0.174, 2024: 0.179,
                 2025: 0.185, 2026: 0.192, 2027: 0.196, 2028: 0.200, 2029: 0.203, 2030: 0.205}
GROSS_MARGIN = {2019: 0.338, 2020: 0.329, 2021: 0.341, 2022: 0.347, 2023: 0.352, 2024: 0.356,
                2025: 0.361, 2026: 0.366, 2027: 0.369, 2028: 0.372}
CAPEX_PCT = {2019: 0.047, 2020: 0.039, 2021: 0.045}  # 5.0% otherwise
INTEREST = {2019: 70.0, 2020: 74.0, 2021: 68.0, 2022: 72.0, 2023: 88.0, 2024: 92.0, 2025: 86.0,
            2026: 82.0, 2027: 76.0, 2028: 70.0, 2029: 64.0, 2030: 58.0}
BASE_GROWTH_EXT = {2029: 0.063, 2030: 0.058}
SCEN_DELTA = {  # (growth delta, margin delta) for 2026..2030
    "Upside": ([0.015, 0.020, 0.025, 0.025, 0.025], [0.004, 0.008, 0.011, 0.013, 0.015]),
    "Downside": ([-0.035, -0.040, -0.035, -0.030, -0.030], [-0.008, -0.013, -0.016, -0.018, -0.020]),
}


def fin_year(y, revenue, prev_revenue, margin, gross_margin=None):
    """One year of the P&L / cash-flow model, rounded to 0.1 with exact identities."""
    rev = rnd(revenue)
    ebitda = rnd(rev * margin)
    da = rnd(rev * DA_PCT)
    ebit = rnd(ebitda - da)
    interest = INTEREST.get(y, 60.0)
    tax = rnd((ebit - interest) * TAX)
    ni = rnd(ebit - interest - tax)
    capex = rnd(rev * CAPEX_PCT.get(y, 0.050))
    nwc = rnd((rev - prev_revenue) * NWC_PCT)
    ufcf = rnd(ebitda - capex - ebit * TAX - nwc)
    gp = rnd(rev * gross_margin) if gross_margin else None
    return dict(year=y, revenue=rev, gross_profit=gp, ebitda=ebitda, da=da, ebit=ebit, interest=interest,
                tax=tax, net_income=ni, capex=capex, nwc=nwc, fcf=ufcf,
                ebitda_margin=round(ebitda / rev, 4), revenue_growth=round(rev / prev_revenue - 1, 4))


def build_financial_model():
    fin = {}
    for y in range(2019, 2029):
        fin[y] = fin_year(y, REVENUE[y], REVENUE[y - 1], EBITDA_MARGIN[y], GROSS_MARGIN[y])
    scen = {"Base": {2025: fin[2025]}}
    for y in (2026, 2027, 2028):
        scen["Base"][y] = fin[y]
    prev = REVENUE[2028]
    for y in (2029, 2030):
        rev = prev * (1 + BASE_GROWTH_EXT[y])
        scen["Base"][y] = fin_year(y, rev, prev, EBITDA_MARGIN[y])
        prev = scen["Base"][y]["revenue"]
    for name, (gd, md) in SCEN_DELTA.items():
        scen[name] = {2025: fin[2025]}
        prev = fin[2025]["revenue"]
        for i, y in enumerate(range(2026, 2031)):
            base = scen["Base"][y]
            g = base["revenue_growth"] + gd[i]
            rev = prev * (1 + g)
            scen[name][y] = fin_year(y, rev, prev, EBITDA_MARGIN[y] + md[i])
            prev = scen[name][y]["revenue"]
    return fin, scen


def equity_per_share(ev):
    return (ev - NET_DEBT + OTHER_ADJ) / SHARES


def dcf_ev(fcfs, wacc, g):
    pv = sum(f / (1 + wacc) ** (t + 1) for t, f in enumerate(fcfs))
    tv = fcfs[-1] * (1 + g) / (wacc - g)
    return pv + tv / (1 + wacc) ** len(fcfs)


def lbo_irr(entry_mult, exit_mult, ebitda_entry, ebitda_exit, fcfs):
    ev = entry_mult * ebitda_entry
    debt = LBO_LEVERAGE * ebitda_entry
    equity = ev * (1 + LBO_FEES) - debt
    d = debt
    for f in fcfs:
        interest = d * LBO_RATE
        d = max(d - (f - interest * (1 - TAX)), 0.0)
    exit_equity = exit_mult * ebitda_exit - d
    return (exit_equity / equity) ** (1 / len(fcfs)) - 1


# ----------------------------------------------------------------------------
# Generator
# ----------------------------------------------------------------------------

class _Gen:
    def __init__(self, seed: int):
        self.seed = seed
        self.master = random.Random(seed)          # random.Random(seed=2026)
        self._sub = {}
        self.out = {}

    def rng(self, tag: str) -> random.Random:
        """Independent, order-insensitive stream per section (stable when other sections change)."""
        if tag not in self._sub:
            self._sub[tag] = random.Random(f"{self.seed}:{tag}")
        return self._sub[tag]

    def add(self, ds):
        self.out[ds["id"]] = ds

    # ------------------------------------------------------------------ model
    def build_model(self):
        self.fin, self.scen = build_financial_model()
        self.days = bdays(DAY0, DAY_END)
        self.di = {d: i for i, d in enumerate(self.days)}
        self.ref = self.di[REF_DAY]
        self.i1y = max(i for i, d in enumerate(self.days) if d <= ONE_YEAR_AGO)
        self._quarterly_model()
        self._peer_fundamentals()
        self._simulate_market()

    def _quarterly_model(self):
        r = self.rng("quarterly")
        seas = [0.236, 0.249, 0.246, 0.269]
        moff = [-0.009, -0.001, 0.002, 0.007]
        qrows = []
        for y in (2024, 2025, 2026):
            w = [s * (1 + r.uniform(-0.012, 0.012)) for s in seas]
            ann = self.fin[y]
            if y < 2026:
                revs = allocate(ann["revenue"], w)
            else:
                revs = [rnd(ann["revenue"] * x / sum(w)) for x in w][:3]
            ebitdas = [rnd(rv * (ann["ebitda_margin"] + moff[q] + r.uniform(-0.002, 0.002))) for q, rv in enumerate(revs)]
            if y < 2026:
                ebitdas[3] = rnd(ann["ebitda"] - sum(ebitdas[:3]))
            for q, (rv, eb) in enumerate(zip(revs, ebitdas)):
                label = f"Q{q + 1}-{str(y)[2:]}"
                end = [dt.date(y, 3, 31), dt.date(y, 6, 30), dt.date(y, 9, 30), dt.date(y, 12, 31)][q]
                cons = rnd(rv / (1 + BEATS[label]))
                qrows.append(dict(quarter=label, date=iso(end), revenue=rv, ebitda=eb,
                                  ebitda_margin=round(eb / rv, 4), consensus_revenue=cons,
                                  beat_miss_pct=round(rv / cons - 1, 4)))
        self.quarters = qrows
        self.q_by = {q["quarter"]: q for q in qrows}

    def _peer_fundamentals(self):
        r = self.rng("peers")
        fin = self.fin
        rows, extra = [], {}
        for company, ticker, sector, region, iso3, city, lat, lon in PEERS:
            if ticker == "HLX":
                rev24, rev25, rev26 = fin[2024]["revenue"], fin[2025]["revenue"], fin[2026]["revenue"]
                e25, e26 = fin[2025]["ebitda"], fin[2026]["ebitda"]
                mkt, nd = rnd(MKT_CAP), rnd(NET_DEBT)
                price = PRICE
                ni = fin[2025]["net_income"]
                dy = DIV_YIELD
                roic = 0.112
                esg = 71.0
                e24, e27 = fin[2024]["ebitda"], fin[2027]["ebitda"]
            else:
                p = SECTOR_PARAMS[sector]
                rev25 = math.exp(r.uniform(math.log(p["rev"][0]), math.log(p["rev"][1])))
                g25 = r.uniform(*p["g"])
                m25 = r.uniform(*p["m"])
                mult = r.uniform(*p["mult"])
                if region == "Latin America":
                    g25 += r.uniform(-0.04, 0.03)
                    mult *= 0.86
                g25 = min(max(g25, -0.05), 0.25)
                m25 = min(max(m25, 0.08), 0.35)
                g26 = min(max(g25 + r.uniform(-0.02, 0.02), -0.05), 0.25)
                m26 = min(max(m25 + r.uniform(-0.002, 0.012), 0.08), 0.35)
                lev = r.uniform(*p["lev"])
                price = rnd(r.uniform(18, 185), 2)
                dy = round(r.uniform(*p["dy"]), 4)
                da_pct = r.uniform(0.03, 0.055)
                roic = r.uniform(*p["roic"])
                esg = rnd(r.uniform(42, 90), 0)
                rev25 = rnd(rev25)
                rev24 = rnd(rev25 / (1 + g25))
                rev26 = rnd(rev25 * (1 + g26))
                e25 = rnd(rev25 * m25)
                e26 = rnd(rev26 * m26)
                nd = rnd(lev * e25)
                mkt = rnd(mult * e25 - nd)
                ni = (e25 - da_pct * rev25 - max(nd, 0) * 0.055 - 4) * (1 - 0.24)
                e24 = rev24 * (m25 - 0.004)
                e27 = rev26 * (1 + g26) * min(m26 + 0.004, 0.35)
            ev = rnd(mkt + nd)
            rows.append(dict(
                company=company, ticker=ticker, sector=sector, region=region, country=iso3, hq_city=city,
                lat=lat, lon=lon, is_target=ticker == "HLX", share_price=price, mkt_cap=mkt, net_debt=nd, ev=ev,
                revenue_24a=rev24, revenue_25e=rev25, revenue_26e=rev26, ebitda_25e=e25, ebitda_26e=e26,
                ebitda_margin_25e=round(e25 / rev25, 4), rev_growth_25e=round(rev25 / rev24 - 1, 4),
                ev_revenue_25e=round(ev / rev25, 2), ev_ebitda_25e=round(ev / e25, 2), ev_ebitda_26e=round(ev / e26, 2),
                pe_25e=rnd(mkt / ni, 1), net_debt_ebitda=round(nd / e25, 2),
                price_52w_low=None, price_52w_high=None, dividend_yield=dy, tsr_1y=None))
            extra[ticker] = dict(roic=roic, esg=esg, e24=e24, e27=e27, sector=sector)
        self.peer_rows = rows
        self.peer_extra = extra

    def _simulate_market(self):
        r = self.rng("market")
        days, n = self.days, len(self.days)
        M = [0.0] * n
        for t in range(1, n):
            d = days[t]
            mu, sd = 0.00040, 0.0072
            if dt.date(2025, 3, 10) <= d <= dt.date(2025, 4, 8):
                mu, sd = -0.0028, 0.0130
            elif dt.date(2025, 4, 9) <= d <= dt.date(2025, 5, 20):
                mu, sd = 0.0022, 0.0105
            elif dt.date(2026, 2, 23) <= d <= dt.date(2026, 3, 13):
                mu, sd = -0.0014, 0.0095
            M[t] = r.gauss(mu, sd)
        spx = [0.0] + [M[t] + r.gauss(0.00004, 0.0012) for t in range(1, n)]
        msci = [0.0] + [0.9 * M[t] + r.gauss(-0.00003, 0.0021) for t in range(1, n)]
        sector = {k: [0.0] + [r.gauss(SECTOR_DRIFT[k], 0.0038) for _ in range(1, n)] for k in SECTORS}

        # peers
        rp = self.rng("peer-returns")
        rets = {}
        for row in self.peer_rows:
            if row["is_target"]:
                continue
            beta = rp.uniform(0.8, 1.3)
            idio = rp.uniform(0.0075, 0.0125)
            drift = rp.gauss(0.0001, 0.00025)
            k = row["sector"]
            ret = [0.0] + [beta * M[t] + sector[k][t] + rp.gauss(drift, idio) for t in range(1, n)]
            # keep 1-year price returns in a plausible band (-20%..+42%) by tilting last-year drift
            logs = [math.log1p(x) for x in ret]
            one_y = sum(logs[self.i1y + 1:self.ref + 1])
            tgt = min(max(one_y, math.log(0.80)), math.log(1.42))
            if tgt != one_y:
                c = (tgt - one_y) / (self.ref - self.i1y)
                for t in range(self.i1y + 1, self.ref + 1):
                    logs[t] += c
                ret = [math.expm1(x) for x in logs]
            rets[row["ticker"]] = ret

        # target: factor model + event jumps, drift calibrated to START_PRICE -> PRICE
        rt = self.rng("target-returns")
        ev_jump = {self.di[dt.date.fromisoformat(e[0])]: e[3] for e in EVENTS}
        hr = [0.0] * n
        for t in range(1, n):
            if t in ev_jump:
                hr[t] = ev_jump[t] + 0.5 * M[t]
            else:
                hr[t] = 1.1 * M[t] + sector[IA][t] + rt.gauss(0, 0.0085)
        logs = [math.log1p(x) for x in hr]
        free = [t for t in range(1, self.ref + 1) if t not in ev_jump]
        c = (math.log(PRICE / START_PRICE) - sum(logs[1:self.ref + 1])) / len(free)
        for t in free:
            logs[t] += c
        assert n - 1 - self.ref == 2, "expected two trading days after the reference day"
        logs[self.ref + 1] = math.log1p(0.0071)
        logs[self.ref + 2] = -logs[self.ref + 1]
        rets["HLX"] = [math.expm1(x) for x in logs]

        def levels(ret, anchor_value):
            cum, s = [], 0.0
            for x in ret:
                s += math.log1p(x)
                cum.append(s)
            return [anchor_value * math.exp(cv - cum[self.ref]) for cv in cum]

        self.rets = rets
        self.px = {row["ticker"]: levels(rets[row["ticker"]], row["share_price"]) for row in self.peer_rows}
        self.idx = {"S&P 500": levels(spx, 100.0), "MSCI World": levels(msci, 100.0)}
        self.ev_jump = ev_jump

        # 52-week range and 1y TSR for every company (closing prices)
        for row in self.peer_rows:
            p = self.px[row["ticker"]]
            win = p[self.i1y:self.ref + 1]
            row["price_52w_low"] = rnd(min(win), 2)
            row["price_52w_high"] = rnd(max(win), 2)
            row["tsr_1y"] = round(p[self.ref] / p[self.i1y] - 1 + row["dividend_yield"], 4)

        # OHLC + volume for the target
        ro = self.rng("ohlc")
        close = self.px["HLX"]
        ohlc = []
        for t, d in enumerate(days):
            c1 = close[t]
            c0 = close[t - 1] if t else c1 / (1 + ro.gauss(0, 0.01))
            ev = t in ev_jump
            gap = 0.75 * (c1 / c0 - 1) if ev else ro.gauss(0, 0.0035)
            o = c0 * (1 + gap)
            hi = max(o, c1) * (1 + abs(ro.gauss(0, 0.0055)))
            lo = min(o, c1) * (1 - abs(ro.gauss(0, 0.0055)))
            o, c, hi, lo = rnd(o, 2), rnd(c1, 2), rnd(hi, 2), rnd(lo, 2)
            hi, lo = max(hi, o, c), min(lo, o, c)
            vol = 1_100_000 * math.exp(ro.gauss(0, 0.22)) * (1 + 18 * abs(c1 / c0 - 1)) * (2.6 if ev else 1.0)
            ohlc.append(dict(date=iso(d), open=o, high=hi, low=lo, close=c, volume=int(round(vol, -2))))
        self.ohlc = ohlc

    # ------------------------------------------------------------------ datasets
    def peers(self):
        fields = [
            S("company", "Company"), S("ticker", "Ticker"), S("sector", "Sector"), S("region", "Region"),
            S("country", "Country (ISO3)"), S("hq_city", "HQ city"),
            N("lat", "Latitude", F_COORD), N("lon", "Longitude", F_COORD), B("is_target", "Target"),
            N("share_price", "Share price", F_PX, "USD"), N("mkt_cap", "Market cap", F_USDM, "USD m"),
            N("net_debt", "Net debt", F_USDM, "USD m"), N("ev", "Enterprise value", F_USDM, "USD m"),
            N("revenue_24a", "Revenue 2024A", F_USDM, "USD m"), N("revenue_25e", "Revenue 2025E", F_USDM, "USD m"),
            N("revenue_26e", "Revenue 2026E", F_USDM, "USD m"), N("ebitda_25e", "EBITDA 2025E", F_USDM, "USD m"),
            N("ebitda_26e", "EBITDA 2026E", F_USDM, "USD m"), N("ebitda_margin_25e", "EBITDA margin 2025E", F_PCT),
            N("rev_growth_25e", "Revenue growth 2025E", F_PCT), N("ev_revenue_25e", "EV/Revenue 2025E", F_MULT),
            N("ev_ebitda_25e", "EV/EBITDA 2025E", F_MULT), N("ev_ebitda_26e", "EV/EBITDA 2026E", F_MULT),
            N("pe_25e", "P/E 2025E", F_MULT), N("net_debt_ebitda", "Net debt / EBITDA 2025E", F_MULT),
            N("price_52w_low", "52-week low", F_PX, "USD"), N("price_52w_high", "52-week high", F_PX, "USD"),
            N("dividend_yield", "Dividend yield", F_PCT), N("tsr_1y", "1-year TSR", F_PCT),
        ]
        self.add(make_ds("peers", "Trading comparables", fields, self.peer_rows, source=SRC_MKT, unit="USD m",
                         notes=["EV = market cap + net debt; multiples calendarised to December year-end.",
                                "Helios Industrial 2025 figures are reported actuals (FY25A).",
                                "52-week range and TSR based on daily closes to 09-Oct-2026; TSR includes dividends."]))

    def price_ohlc(self):
        fields = [D("date", "Date"), N("open", "Open", F_PX, "USD"), N("high", "High", F_PX, "USD"),
                  N("low", "Low", F_PX, "USD"), N("close", "Close", F_PX, "USD"), N("volume", "Volume", F_INT, "shares")]
        self.add(make_ds("price_ohlc", "Helios Industrial (HLX) daily share price", fields, self.ohlc, source=SRC_MKT,
                         unit="USD", notes=["Business days (Mon–Fri); exchange holidays not removed.",
                                            "Large moves coincide with the events in price_events."]))

    def _weekly_idx(self):
        idx = {0, len(self.days) - 1} | {i for i, d in enumerate(self.days) if d.weekday() == 4}
        return sorted(idx)

    def price_perf(self):
        wk = self._weekly_idx()
        hlx = self.px["HLX"]
        peers = [t for t in self.px if t != "HLX"]
        series = {
            "Helios Industrial": [hlx[i] / hlx[0] * 100 for i in range(len(self.days))],
            "Peer median": [statistics.median(self.px[t][i] / self.px[t][0] for t in peers) * 100 for i in range(len(self.days))],
            "S&P 500": [v / self.idx["S&P 500"][0] * 100 for v in self.idx["S&P 500"]],
            "MSCI World": [v / self.idx["MSCI World"][0] * 100 for v in self.idx["MSCI World"]],
        }
        rows = [dict(date=iso(self.days[i]), series=s, value=rnd(vals[i], 2)) for s, vals in series.items() for i in wk]
        self.perf_series = series
        fields = [D("date", "Date"), S("series", "Series"), N("value", "Rebased price (14-Oct-2024 = 100)", F_NUM)]
        self.add(make_ds("price_perf", "Relative share price performance", fields, rows, source=SRC_MKT,
                         notes=["Weekly (Friday) closes, rebased to 100 on 14-Oct-2024; price return.",
                                "Peer median = median of the 17 rebased peer share prices on each date."]))

    def price_events(self):
        rows = []
        for d, label, kind, jump, q in EVENTS:
            if q:
                qq = self.q_by[q]
                b = qq["beat_miss_pct"]
                word = "above" if b > 0.004 else ("below" if b < -0.004 else "in line with")
                detail = f"{q} revenue ${qq['revenue']:,.0f}m, {abs(b):.1%} {word} consensus; EBITDA margin {qq['ebitda_margin']:.1%}"
                if q == "Q3-26":
                    detail = f"Preliminary Q3-26 revenue ${qq['revenue']:,.0f}m, in line with consensus; FY26 guidance reiterated"
            else:
                detail = {
                    "2025-02-11": f"FY24 revenue ${self.fin[2024]['revenue']:,.0f}m; FY25 guide of +5–7% growth below consensus",
                    "2025-07-15": "Agreed to acquire Brennick Robotics for $420m (15.0x EBITDA), funded from cash and RCF",
                    "2025-09-16": "Sterling Ratings upgrades long-term issuer rating to BBB (stable)",
                    "2026-02-10": f"FY25 revenue ${self.fin[2025]['revenue']:,.0f}m; FY26 guide: revenue +6–8%, EBITDA margin above 19%",
                    "2026-06-18": "Media reports of private-equity approach; company declines to comment",
                    "2026-08-04": f"Q2-26 revenue {self.q_by['Q2-26']['beat_miss_pct']:.1%} above consensus; FY26 EBITDA guide raised",
                }[d]
            t = self.di[dt.date.fromisoformat(d)]
            move = self.px["HLX"][t] / self.px["HLX"][t - 1] - 1
            rows.append(dict(date=d, label=label, kind=kind, detail=f"{detail} (shares {move:+.1%} on the day)"))
        fields = [D("date", "Date"), S("label", "Event"), S("kind", "Type"), S("detail", "Detail")]
        self.add(make_ds("price_events", "Helios Industrial share price events", fields, rows, source=SRC_CO,
                         notes=["kind: earnings | m&a | guidance | rating. Each date is a trading day in price_ohlc."]))

    def ntm_multiple(self):
        wk = self._weekly_idx()
        fin = self.fin
        e_t = {2024: fin[2024]["ebitda"], 2025: fin[2025]["ebitda"], 2026: fin[2026]["ebitda"], 2027: fin[2027]["ebitda"]}

        def ntm(e, d):
            y = d.year
            yf = (d - dt.date(y, 1, 1)).days / 365.0
            return (1 - yf) * e[y] + yf * e[y + 1]

        rows = []
        n = len(self.days)
        hist = {}
        for i in range(n):
            d = self.days[i]
            nd = NET_DEBT_2024 + (NET_DEBT - NET_DEBT_2024) * min(i / self.ref, 1.0)
            tgt = (self.px["HLX"][i] * SHARES + nd) / ntm(e_t, d)
            mults = []
            for row in self.peer_rows:
                if row["is_target"]:
                    continue
                x = self.peer_extra[row["ticker"]]
                e = {2024: x["e24"], 2025: row["ebitda_25e"], 2026: row["ebitda_26e"], 2027: x["e27"]}
                evt = row["mkt_cap"] * self.px[row["ticker"]][i] / row["share_price"] + row["net_debt"]
                mults.append(evt / ntm(e, d))
            hist[i] = (tgt, statistics.median(mults))
        for i in wk:
            rows.append(dict(date=iso(self.days[i]), target=rnd(hist[i][0], 2), peer_median=rnd(hist[i][1], 2)))
        self.ntm_hist = hist
        fields = [D("date", "Date"), N("target", "Helios Industrial", F_MULT), N("peer_median", "Peer median", F_MULT)]
        self.add(make_ds("ntm_multiple", "NTM EV/EBITDA history", fields, rows, source=SRC_MKT,
                         notes=["NTM EBITDA = time-weighted blend of current and next fiscal-year consensus EBITDA.",
                                "Weekly (Friday) observations; peer median across 17 peers."]))

    def financials(self):
        rows = []
        for y in range(2019, 2029):
            f = self.fin[y]
            rows.append(dict(year=ylabel(y), period="A" if y <= 2025 else "E", fiscal_year=y, revenue=f["revenue"],
                             gross_profit=f["gross_profit"], ebitda=f["ebitda"], ebit=f["ebit"], net_income=f["net_income"],
                             capex=f["capex"], fcf=f["fcf"], ebitda_margin=f["ebitda_margin"], revenue_growth=f["revenue_growth"]))
        fields = [S("year", "Year"), S("period", "Actual / estimate"), N("fiscal_year", "Fiscal year", F_YEAR),
                  N("revenue", "Revenue", F_USDM1, "USD m"), N("gross_profit", "Gross profit", F_USDM1, "USD m"),
                  N("ebitda", "EBITDA", F_USDM1, "USD m"), N("ebit", "EBIT", F_USDM1, "USD m"),
                  N("net_income", "Net income", F_USDM1, "USD m"), N("capex", "Capex", F_USDM1, "USD m"),
                  N("fcf", "Unlevered free cash flow", F_USDM1, "USD m"), N("ebitda_margin", "EBITDA margin", F_PCT),
                  N("revenue_growth", "Revenue growth", F_PCT)]
        self.add(make_ds("financials", "Helios Industrial financial summary", fields, rows, source=SRC_CO, unit="USD m",
                         notes=["Fiscal year ends 31-Dec. 2026E–2028E per management plan (Base case).",
                                "Unlevered FCF = EBITDA – capex – tax on EBIT (25%) – increase in NWC (14% of revenue growth)."]))

    def segment_revenue(self):
        r = self.rng("segments")
        rows, totals = [], {}
        for y in range(2021, 2027):
            k = (y - 2021) / 5
            shares = {s: a + (b - a) * k for s, (a, b) in SEG_SHARE.items()}
            shares["Software & Services"] = 1 - sum(shares.values())
            cells, keys = [], []
            for s in SEGMENTS:
                na, eu, ap, la = SEG_REGION[s]
                drift = y - 2021
                reg = [na - 0.002 * drift, eu - 0.002 * drift, ap + 0.004 * drift, la]
                reg = [x * (1 + r.uniform(-0.03, 0.03)) for x in reg]
                tot = sum(reg)
                for rg, x in zip(REGIONS, reg):
                    cells.append(shares[s] * x / tot)
                    keys.append((s, rg))
            vals = allocate(self.fin[y]["revenue"], cells)
            for (s, rg), v in zip(keys, vals):
                rows.append(dict(year=ylabel(y), segment=s, region=rg, revenue=v))
                totals[(y, s, rg)] = v
        self.seg_cells = totals
        fields = [S("year", "Year"), S("segment", "Segment"), S("region", "Region"), N("revenue", "Revenue", F_USDM1, "USD m")]
        self.add(make_ds("segment_revenue", "Revenue by segment and region", fields, rows, source=SRC_CO, unit="USD m",
                         notes=["Segment x region cells sum to group revenue in financials for each year."]))

    def _seg_total(self, y, seg=None, region=None):
        return rnd(sum(v for (yy, s, rg), v in self.seg_cells.items()
                       if yy == y and (seg is None or s == seg) and (region is None or rg == region)))

    def revenue_by_country(self):
        r = self.rng("countries")
        rows = []
        self.country_rev = {}
        for region in REGIONS:
            cs = [c for c in COUNTRIES if c[3] == region]
            tot25 = self._seg_total(2025, region=region)
            tot24 = self._seg_total(2024, region=region)
            g_reg = tot25 / tot24 - 1
            vals = allocate(tot25, [c[6] * r.uniform(0.9, 1.1) for c in cs])
            for c, v in zip(cs, vals):
                g = min(max(g_reg + r.gauss(0, 0.025), -0.05), 0.25)
                emp = int(round(v * 1000 / c[7] * r.uniform(0.92, 1.08), -1))
                rows.append(dict(iso3=c[0], iso_num=c[1], country=c[2], region=region, revenue=v,
                                 growth=round(g, 4), employees=max(emp, 10), lat=c[4], lon=c[5]))
                self.country_rev[c[2]] = v
        fields = [S("iso3", "ISO3"), S("iso_num", "ISO numeric"), S("country", "Country"), S("region", "Region"),
                  N("revenue", "Revenue 2025A", F_USDM1, "USD m"), N("growth", "Revenue growth 2025A", F_PCT),
                  N("employees", "Employees", F_INT), N("lat", "Latitude", F_COORD), N("lon", "Longitude", F_COORD)]
        self.add(make_ds("revenue_by_country", "Revenue by country (FY25A)", fields, rows, source=SRC_CO, unit="USD m",
                         notes=["iso_num matches world-atlas (countries-110m) feature ids.",
                                "Country revenues sum to the 2025A regional totals in segment_revenue.",
                                "lat/lon are approximate country centroids."]))

    def assets_locations(self):
        r = self.rng("assets")
        sites = [
            ("Pittsburgh Assembly", "Plant", "Pittsburgh", "United States", 40.44, -80.00),
            ("Greenville Drives Plant", "Plant", "Greenville", "United States", 34.85, -82.40),
            ("Monterrey Plant", "Plant", "Monterrey", "Mexico", 25.69, -100.32),
            ("Queretaro Motors Plant", "Plant", "Queretaro", "Mexico", 20.59, -100.39),
            ("Campinas Plant", "Plant", "Campinas", "Brazil", -22.91, -47.06),
            ("Esslingen Works", "Plant", "Esslingen", "Germany", 48.74, 9.31),
            ("Brno Plant", "Plant", "Brno", "Czechia", 49.20, 16.61),
            ("Wroclaw Plant", "Plant", "Wroclaw", "Poland", 51.11, 17.03),
            ("Lyon Sensors Plant", "Plant", "Lyon", "France", 45.76, 4.84),
            ("Suzhou Plant", "Plant", "Suzhou", "China", 31.30, 120.59),
            ("Tianjin Plant", "Plant", "Tianjin", "China", 39.13, 117.20),
            ("Chongqing Plant", "Plant", "Chongqing", "China", 29.56, 106.55),
            ("Pune Plant", "Plant", "Pune", "India", 18.52, 73.86),
            ("Nagoya Plant", "Plant", "Nagoya", "Japan", 35.18, 136.91),
            ("Changwon Plant", "Plant", "Changwon", "South Korea", 35.23, 128.68),
            ("Rayong Plant", "Plant", "Rayong", "Thailand", 12.68, 101.28),
            ("Penang Electronics Plant", "Plant", "Penang", "Malaysia", 5.41, 100.33),
            ("Helios Robotics Lab", "R&D Center", "Pittsburgh", "United States", 40.45, -79.95),
            ("Brennick Robotics Center", "R&D Center", "Boston", "United States", 42.36, -71.06),
            ("Munich Software Center", "R&D Center", "Munich", "Germany", 48.14, 11.58),
            ("Cambridge Sensing Lab", "R&D Center", "Cambridge", "United Kingdom", 52.21, 0.12),
            ("Shanghai Innovation Center", "R&D Center", "Shanghai", "China", 31.23, 121.47),
            ("Bengaluru Engineering Center", "R&D Center", "Bengaluru", "India", 12.97, 77.59),
            ("Tokyo Motion Lab", "R&D Center", "Tokyo", "Japan", 35.68, 139.69),
            ("Eindhoven Vision Lab", "R&D Center", "Eindhoven", "Netherlands", 51.44, 5.47),
            ("Group Headquarters", "Office", "Pittsburgh", "United States", 40.44, -80.00),
            ("Chicago Sales Office", "Office", "Chicago", "United States", 41.88, -87.63),
            ("Toronto Office", "Office", "Toronto", "Canada", 43.65, -79.38),
            ("London Office", "Office", "London", "United Kingdom", 51.51, -0.13),
            ("Paris Office", "Office", "Paris", "France", 48.86, 2.35),
            ("Milan Office", "Office", "Milan", "Italy", 45.46, 9.19),
            ("Madrid Office", "Office", "Madrid", "Spain", 40.42, -3.70),
            ("Zurich Office", "Office", "Zurich", "Switzerland", 47.38, 8.54),
            ("Stockholm Office", "Office", "Stockholm", "Sweden", 59.33, 18.07),
            ("Sydney Office", "Office", "Sydney", "Australia", -33.87, 151.21),
            ("Seoul Office", "Office", "Seoul", "South Korea", 37.57, 126.98),
            ("Sao Paulo Office", "Office", "Sao Paulo", "Brazil", -23.55, -46.63),
            ("Mexico City Office", "Office", "Mexico City", "Mexico", 19.43, -99.13),
            ("Mumbai Office", "Office", "Mumbai", "India", 19.08, 72.88),
            ("Memphis Distribution Center", "Warehouse", "Memphis", "United States", 35.15, -90.05),
            ("Rotterdam Distribution Center", "Warehouse", "Rotterdam", "Netherlands", 51.92, 4.48),
            ("Duisburg Logistics Hub", "Warehouse", "Duisburg", "Germany", 51.43, 6.76),
            ("Shenzhen Logistics Hub", "Warehouse", "Shenzhen", "China", 22.54, 114.06),
            ("Melbourne Warehouse", "Warehouse", "Melbourne", "Australia", -37.81, 144.96),
            ("Santiago Warehouse", "Warehouse", "Santiago", "Chile", -33.45, -70.67),
            ("Jakarta Warehouse", "Warehouse", "Jakarta", "Indonesia", -6.21, 106.85),
            ("Ho Chi Minh City Warehouse", "Warehouse", "Ho Chi Minh City", "Vietnam", 10.82, 106.63),
        ]
        spec = {"Plant": ((18, 120), (0.62, 0.95), (1958, 2023)), "R&D Center": ((3, 16), (0.60, 0.92), (1985, 2025)),
                "Office": ((1, 14), (0.45, 0.88), (1972, 2024)), "Warehouse": ((15, 65), (0.58, 0.96), (1995, 2024))}
        rows = []
        for name, kind, city, country, lat, lon in sites:
            cap, util, yrs = spec[kind]
            opened = r.randint(*yrs)
            if name == "Group Headquarters":
                opened = 1962
            if name == "Brennick Robotics Center":
                opened = 2025
            rows.append(dict(name=name, type=kind, city=city, country=country, lat=lat, lon=lon,
                             capacity=rnd(r.uniform(*cap)), utilization=round(r.uniform(*util), 3), opened=opened))
        fields = [S("name", "Site"), S("type", "Type"), S("city", "City"), S("country", "Country"),
                  N("lat", "Latitude", F_COORD), N("lon", "Longitude", F_COORD),
                  N("capacity", "Floor area ('000 sq m)", F_NUM, "'000 sq m"), N("utilization", "Utilisation", F_PCT),
                  N("opened", "Opened", F_YEAR)]
        self.add(make_ds("assets_locations", "Global footprint", fields, rows, source=SRC_CO,
                         notes=["type: Plant | Office | R&D Center | Warehouse; country names match revenue_by_country."]))

    def deal_flows(self):
        r = self.rng("flows")
        pairs = [
            ("United States", "Germany", IA), ("United States", "United Kingdom", ISS), ("Germany", "United States", IA),
            ("Japan", "United States", MPC), ("United Kingdom", "United States", ISS), ("France", "United States", ISS),
            ("Switzerland", "Germany", IA), ("China", "Germany", MPC), ("Japan", "Germany", IA),
            ("United States", "Japan", ISS), ("Canada", "United States", ISS), ("Sweden", "Finland", MPC),
            ("Germany", "China", IA), ("United States", "Mexico", MPC), ("South Korea", "United States", MPC),
            ("United States", "India", ISS), ("Netherlands", "United States", IA), ("Singapore", "Australia", ISS),
            ("United Arab Emirates", "United Kingdom", MPC), ("United States", "Brazil", IA), ("France", "Italy", MPC),
            ("Germany", "Poland", MPC), ("United States", "Israel", ISS), ("Japan", "Thailand", IA),
            ("China", "Brazil", MPC), ("United Kingdom", "Australia", ISS),
        ]
        big = {"United States", "Germany", "United Kingdom", "Japan"}
        rows = []
        for a, b, sector in pairs:
            la, lo = self._coords(a)
            lb, lob = self._coords(b)
            scale = 1.0 + 1.6 * ((a in big) + (b in big))
            val = math.exp(r.uniform(math.log(0.6), math.log(6.0))) * scale
            deals = max(2, int(round(val * r.uniform(1.6, 3.2))))
            rows.append(dict(from_country=a, from_lat=la, from_lon=lo, to_country=b, to_lat=lb, to_lon=lob,
                             value=rnd(val, 1), deals=deals, sector=sector))
        rows.sort(key=lambda x: -x["value"])
        fields = [S("from_country", "Acquirer country"), N("from_lat", "From latitude", F_COORD), N("from_lon", "From longitude", F_COORD),
                  S("to_country", "Target country"), N("to_lat", "To latitude", F_COORD), N("to_lon", "To longitude", F_COORD),
                  N("value", "Deal value", F_USDBN, "USD bn"), N("deals", "Number of deals", F_INT), S("sector", "Sector")]
        self.add(make_ds("deal_flows", "Cross-border industrials M&A flows (2021–2026 YTD)", fields, rows, source=SRC_MKT,
                         unit="USD bn", notes=["Aggregate announced deal value by acquirer -> target country; coordinates are country centroids."]))

    @staticmethod
    def _coords(name):
        if name in COUNTRY_BY_NAME:
            c = COUNTRY_BY_NAME[name]
            return c[4], c[5]
        return EXTRA_COORDS[name]

    def china_provinces(self):
        r = self.rng("china")
        total = self.country_rev["China"]
        vals = allocate(total, [p[3] * r.uniform(0.85, 1.15) for p in CHINA_PROVINCES])
        rows = []
        for (en, zh, code, w), v in zip(CHINA_PROVINCES, vals):
            coastal = code[:2] in {"11", "12", "31", "32", "33", "35", "37", "44"}
            g = r.gauss(0.085 if coastal else 0.055, 0.03)
            stores = max(1, int(round(v ** 0.85 * r.uniform(0.9, 1.2))))
            rows.append(dict(province=en, province_zh=zh, adcode=code, revenue=v, growth=round(min(max(g, -0.05), 0.25), 4),
                             stores=stores))
        fields = [S("province", "Province"), S("province_zh", "省级行政区"), S("adcode", "Adcode"),
                  N("revenue", "Revenue 2025A", F_USDM1, "USD m"), N("growth", "Revenue growth 2025A", F_PCT),
                  N("stores", "Service points", F_INT)]
        self.add(make_ds("china_provinces", "Greater China revenue by province (FY25A)", fields, rows, source=SRC_CO, unit="USD m",
                         notes=["All 34 provincial-level divisions; adcode = GB/T 2260 code used by DataV/ECharts China GeoJSON.",
                                "province_zh uses the official full name (e.g. 广东省, 内蒙古自治区).",
                                "Province revenues sum to China revenue in revenue_by_country (Greater China reporting basis)."]))

    def market_share(self):
        r = self.rng("market-share")
        sizes = {"Factory automation": 14800, "Motion control": 10200, "Machine vision": 4600,
                 "Industrial sensors": 7900, "Industrial software": 6400}
        shares = {
            "Factory automation": [0.118, 0.155, 0.092, 0.131, 0.035],
            "Motion control": [0.121, 0.061, 0.044, 0.088, 0.172],
            "Machine vision": [0.094, 0.072, 0.118, 0.145, 0.012],
            "Industrial sensors": [0.108, 0.052, 0.136, 0.061, 0.028],
            "Industrial software": [0.086, 0.113, 0.071, 0.039, 0.015],
        }
        players = ["Helios Industrial", "Corvane Automation", "Valdris Controls", "Kanemori Systems", "Norrvik Drives"]
        rows = []
        for seg, size in sizes.items():
            size = size * r.uniform(0.97, 1.03)
            vals = [rnd(size * s * r.uniform(0.95, 1.05)) for s in shares[seg]]
            for p, v in zip(players, vals):
                rows.append(dict(segment=seg, player=p, revenue=v))
            rows.append(dict(segment=seg, player="Others", revenue=rnd(size - sum(vals))))
        fields = [S("segment", "Market segment"), S("player", "Player"), N("revenue", "Revenue 2025", F_USDM, "USD m")]
        self.add(make_ds("market_share", "Market share by segment (2025)", fields, rows, source=SRC_ANALYSIS, unit="USD m",
                         notes=["Addressable market = sum of players per segment (Marimekko input)."]))

    def ownership(self):
        r = self.rng("ownership")
        holders = [
            ("Granite Peak Asset Management", "Institutional", 12.4, "United States"),
            ("Ardent Family Holdings", "Strategic", 11.6, "United States"),
            ("Pinnacle Index Funds", "Index fund", 10.9, "United States"),
            ("Summit Broad Market Trust", "Index fund", 8.7, "United States"),
            ("Harrowgate Investors", "Institutional", 6.1, "United Kingdom"),
            ("Lakeshore Capital Advisors", "Institutional", 5.4, "United States"),
            ("Nordlys Kapitalforvaltning", "Institutional", 3.9, "Norway"),
            ("Tokai Mutual Asset Management", "Institutional", 3.1, "Japan"),
            ("Bellwether Value Partners", "Institutional", 2.9, "United States"),
            ("Crescent Ridge Index Partners", "Index fund", 2.6, "United States"),
            ("Rheinauen Investment", "Institutional", 2.2, "Germany"),
            ("Elmstead Pension Plan", "Institutional", 1.9, "Canada"),
            ("Directors & officers", "Insider", 2.4, "United States"),
            ("Employee share plan", "Insider", 1.6, "United States"),
        ]
        rows = []
        for name, kind, sh, country in holders:
            chg = 1.25 if name == "Bellwether Value Partners" else (0.0 if kind in ("Strategic", "Insider") else r.uniform(-0.6, 0.6))
            rows.append(dict(holder=name, type=kind, shares_m=sh, pct=round(sh / BASIC_SHARES, 4), change_qoq_m=rnd(chg, 2), country=country))
        rest = rnd(BASIC_SHARES - sum(x["shares_m"] for x in rows))
        rows.append(dict(holder="Retail & other", type="Retail", shares_m=rest, pct=round(rest / BASIC_SHARES, 4),
                         change_qoq_m=rnd(-sum(x["change_qoq_m"] for x in rows), 2), country="Various"))
        fields = [S("holder", "Holder"), S("type", "Investor type"), N("shares_m", "Shares held", F_NUM, "m"),
                  N("pct", "% of shares outstanding", F_PCT), N("change_qoq_m", "Change QoQ", "+#,##0.00;-#,##0.00;0.00", "m"),
                  S("country", "Country")]
        self.add(make_ds("ownership", "Shareholder structure", fields, rows, source="Share register analysis (synthetic), 30-Sep-2026",
                         unit="m shares", notes=[f"Basic shares outstanding {BASIC_SHARES:.1f}m; rows sum to 100%."]))

    def deal_timeline(self):
        NB, MG, LG, BD, VD = ("Northbridge Capital", "Helios management", "Harrow & Lyle LLP", "Board of Directors",
                              "Ashby Grant (VDD)")
        tasks = [
            ("Process management", "Kick-off meeting", "2026-09-07", "2026-09-07", "Preparation", True, NB),
            ("Financial", "Business plan & model", "2026-09-08", "2026-10-23", "Preparation", False, MG),
            ("Financial", "Vendor due diligence report", "2026-09-14", "2026-11-13", "Preparation", False, VD),
            ("Marketing", "Teaser & information memorandum", "2026-09-08", "2026-10-16", "Preparation", False, NB),
            ("Marketing", "Buyer universe & outreach list", "2026-09-14", "2026-10-02", "Preparation", False, NB),
            ("Legal", "Legal vendor due diligence", "2026-09-21", "2026-11-20", "Preparation", False, LG),
            ("Process management", "Board approval to launch", "2026-10-20", "2026-10-20", "Preparation", True, BD),
            ("Marketing", "Teaser distribution & NDAs", "2026-10-26", "2026-11-13", "Marketing", False, NB),
            ("Marketing", "Information memorandum distribution", "2026-11-16", "2026-11-20", "Marketing", False, NB),
            ("Process management", "Indicative offers due", "2026-12-11", "2026-12-11", "Marketing", True, NB),
            ("Process management", "Shortlist bidders", "2026-12-14", "2026-12-18", "Marketing", False, BD),
            ("Due diligence", "Virtual data room open", "2027-01-04", "2027-02-19", "Due diligence", False, LG),
            ("Due diligence", "Management presentations", "2027-01-11", "2027-01-22", "Due diligence", False, MG),
            ("Due diligence", "Site visits", "2027-01-18", "2027-02-05", "Due diligence", False, MG),
            ("Due diligence", "Confirmatory Q&A", "2027-01-25", "2027-02-26", "Due diligence", False, MG),
            ("Legal", "SPA mark-ups", "2027-02-01", "2027-03-05", "Negotiation", False, LG),
            ("Process management", "Final binding bids", "2027-03-05", "2027-03-05", "Negotiation", True, NB),
            ("Process management", "Exclusivity & final negotiations", "2027-03-08", "2027-03-26", "Negotiation", False, NB),
            ("Process management", "Signing & announcement", "2027-03-31", "2027-03-31", "Signing & closing", True, BD),
            ("Regulatory", "Antitrust & FDI approvals", "2027-04-01", "2027-06-25", "Signing & closing", False, LG),
            ("Legal", "Shareholder vote", "2027-05-20", "2027-05-20", "Signing & closing", True, BD),
            ("Process management", "Closing", "2027-07-01", "2027-07-01", "Signing & closing", True, NB),
        ]
        rows = [dict(workstream=w, task=t, start=s, end=e, phase=p, milestone=m, owner=o) for w, t, s, e, p, m, o in tasks]
        fields = [S("workstream", "Workstream"), S("task", "Task"), D("start", "Start"), D("end", "End"),
                  S("phase", "Phase"), B("milestone", "Milestone"), S("owner", "Owner")]
        self.add(make_ds("deal_timeline", "Project Atlas indicative timetable", fields, rows, source="Northbridge Capital (fictional sell-side adviser)",
                         notes=["Milestones have start = end. Indicative and subject to change."]))

    def league_table(self):
        r = self.rng("league")
        banks = ["Northbridge Capital", "Harborline Partners", "Ashcombe & Co.", "Sterling Vale Securities",
                 "Kingsgate Advisory", "Thornbury Brothers", "Calder Rowe", "Eastwick Mercantile", "Lindqvist Bank",
                 "Oriel Bay Capital", "Montclair Hayes", "Redwood Arch Securities"]
        shares = [0.142, 0.128, 0.119, 0.101, 0.087, 0.079, 0.064, 0.058, 0.049, 0.041, 0.036, 0.030]
        prior = [2, 1, 4, 3, 7, 5, 6, 10, 8, 12, 9, 11]
        market = 385.0
        rows = []
        for i, (b, s, p) in enumerate(zip(banks, shares, prior)):
            s = s * r.uniform(0.985, 1.015) if i else s
            rows.append(dict(rank=i + 1, bank=b, deal_value_bn=rnd(market * s, 1), deals=int(round(70 * s / 0.142 * r.uniform(0.75, 1.15))),
                             market_share=round(s, 4), prior_rank=p))
        for i in range(1, len(rows)):  # keep ranks consistent with values
            rows[i]["deal_value_bn"] = min(rows[i]["deal_value_bn"], rnd(rows[i - 1]["deal_value_bn"] - 0.3, 1))
            rows[i]["market_share"] = round(rows[i]["deal_value_bn"] / market, 4)
        fields = [N("rank", "Rank", F_YEAR), S("bank", "Adviser"), N("deal_value_bn", "Deal value", F_USDBN, "USD bn"),
                  N("deals", "Number of deals", F_INT), N("market_share", "Market share", F_PCT), N("prior_rank", "Prior-year rank", F_YEAR)]
        self.add(make_ds("league_table", "Global industrials M&A league table (LTM Sep-2026)", fields, rows, source=SRC_MKT,
                         unit="USD bn", notes=[f"Announced deals, full credit to each adviser; total market ${market:.0f}bn."]))

    def precedents(self):
        r = self.rng("precedents")
        deals = [
            ("2019-03-18", "Aldermere Controls", "Corvane Automation", "United Kingdom", IA, True),
            ("2019-07-22", "Brightwell Motion", "Granite Arch Partners", "United States", MPC, True),
            ("2019-11-04", "Caldera Sensing", "Quintar Sensing", "Canada", ISS, False),
            ("2020-02-10", "Dunmore Robotics", "Kanemori Systems", "United States", IA, True),
            ("2020-09-14", "Eastvale Drives", "Norrvik Drives", "Germany", MPC, True),
            ("2021-01-25", "Fennick Instruments", "Halvern Instruments", "United Kingdom", ISS, True),
            ("2021-05-17", "Glenrock Automation", "Bluefield Capital Partners", "United States", IA, False),
            ("2021-10-11", "Harwick Systems", "Tessaro Robotics", "France", IA, True),
            ("2022-03-07", "Ivybridge Software", "Orbisant Software", "United States", ISS, True),
            ("2022-08-29", "Kingsmere Components", "Ironvale Power Systems", "Mexico", MPC, False),
            ("2023-01-16", "Larchmont Precision", "Ashgrove Equity", "Italy", MPC, True),
            ("2023-06-12", "Morrow Electromech", "Sohwa Motion", "Japan", MPC, True),
            ("2023-11-20", "Northam Sensors", "Meridale Metrology", "Sweden", ISS, False),
            ("2024-04-08", "Oakhurst Motion", "Corvane Automation", "United States", MPC, True),
            ("2024-09-23", "Pellston Automation", "Granite Arch Partners", "Netherlands", IA, True),
            ("2025-02-03", "Queensbury Controls", "Valdris Controls", "Australia", IA, True),
            ("2025-07-15", "Brennick Robotics", "Helios Industrial", "United States", IA, False),
            ("2025-11-10", "Redmere Instruments", "Quintar Sensing", "Germany", ISS, True),
            ("2026-03-02", "Sefton Industrial Software", "Bluefield Capital Partners", "United Kingdom", ISS, False),
            ("2026-05-11", "Upland Drives", "Norrvik Drives", "Brazil", MPC, True),
            ("2026-08-24", "Tarrant Automation", "Kanemori Systems", "United States", IA, True),
        ]
        mult_mu = {IA: (11.4, 1.1), MPC: (10.2, 0.9), ISS: (14.0, 1.5)}
        margin_rng = {IA: (0.14, 0.24), MPC: (0.12, 0.19), ISS: (0.20, 0.32)}
        rows = []
        for d, tgt, acq, ctry, sector, public in deals:
            if tgt == "Brennick Robotics":
                ev, m, margin = 420.0, 15.0, 0.1667
            else:
                ev = rnd(math.exp(r.uniform(math.log(350), math.log(9500))))
                m = min(max(r.gauss(*mult_mu[sector]), 7.5), 17.0)
                margin = r.uniform(*margin_rng[sector])
            ebitda = ev / m
            revenue = ebitda / margin
            p1 = r.uniform(0.18, 0.42) if public else None
            p30 = p1 + r.uniform(0.01, 0.09) if public else None
            cons = r.choices(["Cash", "Stock", "Mixed"], weights=[0.6, 0.15, 0.25])[0]
            if "Partners" in acq or "Equity" in acq or tgt == "Brennick Robotics":
                cons = "Cash"
            rows.append(dict(date=d, target=tgt, acquirer=acq, target_country=ctry, sector=sector, ev=rnd(ev),
                             ev_revenue=round(ev / revenue, 2), ev_ebitda=round(ev / ebitda, 2),
                             premium_1d=None if p1 is None else round(p1, 4), premium_30d=None if p30 is None else round(p30, 4),
                             consideration=cons, status="Completed" if d < "2026-04-01" else "Pending"))
        self.precedent_rows = rows
        fields = [D("date", "Announced"), S("target", "Target"), S("acquirer", "Acquirer"), S("target_country", "Target country"),
                  S("sector", "Sector"), N("ev", "Enterprise value", F_USDM, "USD m"), N("ev_revenue", "EV/LTM revenue", F_MULT),
                  N("ev_ebitda", "EV/LTM EBITDA", F_MULT), N("premium_1d", "Premium to 1-day price", F_PCT),
                  N("premium_30d", "Premium to 30-day VWAP", F_PCT), S("consideration", "Consideration"), S("status", "Status")]
        self.add(make_ds("precedents", "Selected precedent transactions", fields, rows, source=SRC_MKT, unit="USD m",
                         notes=["Premiums shown for public targets only (null = private target, shown as n.a.).",
                                "Brennick Robotics is Helios Industrial's July-2025 bolt-on acquisition."]))

    def segments_tree(self):
        r = self.rng("tree")
        rows = [dict(id="helios", parent="", name="Helios Industrial", value=self.fin[2025]["revenue"],
                     growth=self.fin[2025]["revenue_growth"])]
        for seg in SEGMENTS:
            v25 = self._seg_total(2025, seg)
            g = v25 / self._seg_total(2024, seg) - 1
            sid = SEG_IDS[seg]
            rows.append(dict(id=sid, parent="helios", name=seg, value=v25, growth=round(g, 4)))
            lines = PRODUCT_LINES[seg]
            vals = allocate(v25, [w * r.uniform(0.92, 1.08) for _, _, w in lines])
            for (lid, lname, _), v in zip(lines, vals):
                rows.append(dict(id=lid, parent=sid, name=lname, value=v, growth=round(min(max(g + r.gauss(0, 0.03), -0.05), 0.25), 4)))
        fields = [S("id", "Id"), S("parent", "Parent"), S("name", "Name"), N("value", "Revenue 2025A", F_USDM1, "USD m"),
                  N("growth", "Revenue growth 2025A", F_PCT)]
        self.add(make_ds("segments_tree", "Revenue hierarchy: group > segment > product line (FY25A)", fields, rows, source=SRC_CO,
                         unit="USD m", notes=["parent = '' for the root; each parent's value equals the sum of its children."]))

    def pnl_flow(self):
        f = self.fin[2025]
        segs = [(s, self._seg_total(2025, s)) for s in SEGMENTS]
        rev = f["revenue"]
        gp, ebitda, ebit, ni, interest = f["gross_profit"], f["ebitda"], f["ebit"], f["net_income"], f["interest"]
        links = [(s, "Revenue", v) for s, v in segs]
        links += [("Revenue", "Cost of goods sold", rnd(rev - gp)), ("Revenue", "Gross profit", gp),
                  ("Gross profit", "Operating expenses", rnd(gp - ebitda)), ("Gross profit", "EBITDA", ebitda),
                  ("EBITDA", "D&A", rnd(ebitda - ebit)), ("EBITDA", "EBIT", ebit),
                  ("EBIT", "Net interest", interest), ("EBIT", "Income tax", rnd(ebit - interest - ni)), ("EBIT", "Net income", ni)]
        rows = [dict(source=a, target=b, value=v) for a, b, v in links]
        fields = [S("source", "From"), S("target", "To"), N("value", "Value", F_USDM1, "USD m")]
        self.add(make_ds("pnl_flow", "FY25A P&L flow (revenue to net income)", fields, rows, source=SRC_CO, unit="USD m",
                         notes=["Sankey links; inflow equals outflow at every intermediate node. Opex excludes D&A."]))

    def corr_matrix(self):
        tickers = ["HLX", "CRVA", "VLDS", "TSRO", "KNMR", "VTRO", "NRVK", "IVPS"]
        lo, hi = self.ref - 251, self.ref + 1
        series = {t: self.rets[t][lo:hi] for t in tickers}
        rows = []
        for x in tickers:
            for y in tickers:
                v = 1.0 if x == y else round(statistics.correlation(series[x], series[y]), 2)
                rows.append(dict(x=x, y=y, value=v))
        fields = [S("x", "Ticker"), S("y", "Ticker"), N("value", "Correlation", "0.00")]
        self.add(make_ds("corr_matrix", "1-year daily return correlation", fields, rows, source=SRC_MKT,
                         notes=["Pearson correlation of 252 daily price returns to 09-Oct-2026; symmetric with unit diagonal."]))

    def peer_scores(self):
        r = self.rng("scores")
        rows_all = self.peer_rows
        metrics = {
            "Growth": (lambda p: p["rev_growth_25e"], 1),
            "Margin": (lambda p: p["ebitda_margin_25e"], 1),
            "ROIC": (lambda p: self.peer_extra[p["ticker"]]["roic"], 1),
            "Leverage": (lambda p: p["net_debt_ebitda"], -1),
            "Valuation": (lambda p: p["ev_ebitda_26e"], -1),
            "ESG": (lambda p: self.peer_extra[p["ticker"]]["esg"], 1),
        }
        companies = ["Helios Industrial", "Corvane Automation", "Valdris Controls", "Tessaro Robotics", "Kanemori Systems"]
        rows = []
        for c in companies:
            p = next(x for x in rows_all if x["company"] == c)
            for m, (fn, sign) in metrics.items():
                vals = [sign * fn(x) for x in rows_all]
                score = 8 + 88 * pct_rank(vals, sign * fn(p)) + r.uniform(-3, 3)
                rows.append(dict(company=c, metric=m, score=rnd(min(max(score, 0), 100), 0)))
        fields = [S("company", "Company"), S("metric", "Metric"), N("score", "Score (0–100)", "0")]
        self.add(make_ds("peer_scores", "Peer scorecard", fields, rows, source=SRC_ANALYSIS,
                         notes=["Score = percentile rank among the 18 companies in peers (higher = better; Leverage and Valuation inverted: lower debt / cheaper = higher score)."]))

    def kpis(self):
        r = self.rng("kpis")
        q = self.q_by
        ltm = ["Q4-25", "Q1-26", "Q2-26", "Q3-26"]
        prior = ["Q4-24", "Q1-25", "Q2-25", "Q3-25"]
        rev_ltm = sum(q[k]["revenue"] for k in ltm)
        rev_prior = sum(q[k]["revenue"] for k in prior)
        e_ltm = sum(q[k]["ebitda"] for k in ltm)
        e_prior = sum(q[k]["ebitda"] for k in prior)
        m_ltm, m_prior = e_ltm / rev_ltm, e_prior / rev_prior
        month_rev, month_margin = [], []
        for k in ltm:
            w = [0.31 + r.uniform(-0.01, 0.01), 0.33 + r.uniform(-0.01, 0.01), 0.36]
            parts = allocate(q[k]["revenue"], w)
            month_rev += parts
            month_margin += [round(q[k]["ebitda_margin"] + r.uniform(-0.004, 0.004), 4) for _ in parts]
        # month-end closes Nov-25..Sep-26 + latest
        closes, ntms = [], []
        for y, m in [(2025, 11), (2025, 12)] + [(2026, k) for k in range(1, 10)]:
            last = max(i for i, d in enumerate(self.days) if (d.year, d.month) == (y, m))
            closes.append(rnd(self.px["HLX"][last], 2))
            ntms.append(rnd(self.ntm_hist[last][0], 2))
        closes.append(PRICE)
        ntms.append(rnd(self.ntm_hist[self.ref][0], 2))
        ntm_now, ntm_1y = self.ntm_hist[self.ref][0], self.ntm_hist[self.i1y][0]
        lev_now = NET_DEBT / e_ltm
        lev_prior = (NET_DEBT_2024 + 30.0) / e_prior
        lev_spark = [rnd(lev_prior + (lev_now - lev_prior) * (i / 11) + (r.uniform(-0.03, 0.03) if 0 < i < 11 else 0), 2) for i in range(12)]
        backlog, backlog_prior = 3965.0, 3965.0 / 1.084
        bl = [backlog_prior * (1.084 ** (i / 11)) * (1 + (r.uniform(-0.012, 0.012) if 0 < i < 11 else 0)) for i in range(12)]
        rows = [
            dict(id="revenue_ltm", label="Revenue (LTM)", value=rnd(rev_ltm), format="$#,##0\"m\"",
                 delta=round(rev_ltm / rev_prior - 1, 4), delta_format=F_DPCT, period="LTM Sep-26 vs. LTM Sep-25",
                 spark=month_rev, good="up"),
            dict(id="ebitda_margin_ltm", label="EBITDA margin (LTM)", value=round(m_ltm, 4), format=F_PCT,
                 delta=rnd((m_ltm - m_prior) * 10000, 0), delta_format="+#,##0\" bps\";-#,##0\" bps\";0\" bps\"",
                 period="LTM Sep-26 vs. LTM Sep-25", spark=month_margin, good="up"),
            dict(id="share_price", label="Share price", value=PRICE, format=F_PX,
                 delta=round(PRICE / self.px["HLX"][self.i1y] - 1, 4), delta_format=F_DPCT, period="09-Oct-2026 vs. 1 year ago",
                 spark=closes, good="up"),
            dict(id="ev_ebitda_ntm", label="EV / NTM EBITDA", value=rnd(ntm_now, 2), format=F_MULT,
                 delta=rnd(ntm_now - ntm_1y, 2), delta_format="+0.0x;-0.0x;0.0x", period="vs. 1 year ago",
                 spark=ntms, good="up"),
            dict(id="net_leverage", label="Net debt / LTM EBITDA", value=rnd(lev_now, 2), format=F_MULT,
                 delta=rnd(lev_now - lev_prior, 2), delta_format="+0.0x;-0.0x;0.0x", period="Sep-26 vs. Sep-25",
                 spark=lev_spark, good="down"),
            dict(id="order_backlog", label="Order backlog", value=backlog, format="$#,##0\"m\"",
                 delta=0.084, delta_format=F_DPCT, period="30-Sep-2026 vs. 30-Sep-2025",
                 spark=[rnd(x) for x in bl[:-1]] + [backlog], good="up"),
        ]
        fields = [S("id", "Id"), S("label", "KPI"), N("value", "Value"), S("format", "Value format"), N("delta", "Change"),
                  S("delta_format", "Change format"), S("period", "Period"), A("spark", "Trend (12 points)"),
                  S("good", "Favourable direction")]
        self.add(make_ds("kpis", "Key performance indicators", fields, rows, source=SRC_CO,
                         notes=["Each row carries its own value/delta format code; spark = 12 monthly points, oldest first.",
                                "good = direction of change that is favourable ('up' | 'down')."]))

    def org_structure(self):
        rows = [
            ("hlx", "", "Helios Industrial Inc.", "United States", 1.0, "Listed parent"),
            ("hold", "hlx", "Helios Holdings LLC", "United States", 1.0, "Holding company"),
            ("intl", "hold", "Helios International B.V.", "Netherlands", 1.0, "Holding company"),
            ("fin", "hlx", "Helios Finance Ireland DAC", "Ireland", 1.0, "Finance vehicle"),
            ("us-ops", "hold", "Helios Automation Inc.", "United States", 1.0, "Operating subsidiary"),
            ("brennick", "hold", "Brennick Robotics Inc.", "United States", 1.0, "Operating subsidiary"),
            ("mx", "hold", "Helios Mexico S. de R.L. de C.V.", "Mexico", 1.0, "Operating subsidiary"),
            ("de", "intl", "Helios Automation GmbH", "Germany", 1.0, "Operating subsidiary"),
            ("uk", "intl", "Helios Sensing Ltd", "United Kingdom", 1.0, "Operating subsidiary"),
            ("pl", "intl", "Helios Software Sp. z o.o.", "Poland", 1.0, "Operating subsidiary"),
            ("cn", "intl", "Helios Industrial (Suzhou) Co., Ltd.", "China", 1.0, "Operating subsidiary"),
            ("jv", "intl", "Helios-Kanemori Motion K.K.", "Japan", 0.51, "Joint venture"),
            ("in", "intl", "Helios Industrial India Pvt. Ltd.", "India", 0.74, "Operating subsidiary"),
            ("br", "intl", "Helios do Brasil Ltda.", "Brazil", 1.0, "Operating subsidiary"),
            ("kr-br", "intl", "Helios Korea (branch)", "South Korea", 1.0, "Branch"),
        ]
        data = [dict(id=a, parent=b, name=c, country=d, ownership_pct=e, entity_type=f) for a, b, c, d, e, f in rows]
        fields = [S("id", "Id"), S("parent", "Parent"), S("name", "Legal entity"), S("country", "Country"),
                  N("ownership_pct", "Ownership", F_PCT0), S("entity_type", "Entity type")]
        self.add(make_ds("org_structure", "Simplified legal entity structure", fields, data, source=SRC_CO,
                         notes=["parent = '' for the ultimate parent; ownership_pct is the direct holding by the parent entity."]))

    def pipeline_funnel(self):
        rows = [("Leads identified", 1240, 9850.0), ("Qualified opportunities", 612, 6125.0), ("Proposal submitted", 284, 3940.0),
                ("Negotiation", 118, 2185.0), ("Closed won", 76, 1410.0)]
        data = [dict(stage=s, count=c, value=v) for s, c, v in rows]
        fields = [S("stage", "Stage"), N("count", "Opportunities", F_INT), N("value", "Pipeline value", F_USDM, "USD m")]
        self.add(make_ds("pipeline_funnel", "Commercial pipeline (LTM Sep-26)", fields, data, source=SRC_CO, unit="USD m",
                         notes=["Stages are cumulative-exclusive snapshots; values are total contract value."]))

    def scenarios(self):
        rows = []
        for name in ("Base", "Upside", "Downside"):
            for y in range(2025, 2031):
                f = self.scen[name][y]
                rows.append(dict(scenario=name, year=ylabel(y), revenue=f["revenue"], ebitda=f["ebitda"], fcf=f["fcf"]))
        fields = [S("scenario", "Scenario"), S("year", "Year"), N("revenue", "Revenue", F_USDM1, "USD m"),
                  N("ebitda", "EBITDA", F_USDM1, "USD m"), N("fcf", "Unlevered free cash flow", F_USDM1, "USD m")]
        self.add(make_ds("scenarios", "Management plan scenarios", fields, rows, source=SRC_ANALYSIS, unit="USD m",
                         notes=["Base case 2025A–2028E matches financials; DCF and LBO use Base case 2026E–2030E."]))

    def monthly_returns(self):
        r = self.rng("monthly")
        dy_m = DIV_YIELD / 12
        month_end = {}
        for i, d in enumerate(self.days):
            month_end[(d.year, d.month)] = i
        rows = []
        for y in range(2022, 2027):
            for m in range(1, 13):
                if (y, m) > (2026, 9):
                    break
                prev = (y, m - 1) if m > 1 else (y - 1, 12)
                if (y, m) >= (2024, 11):
                    p = self.px["HLX"]
                    ret = p[month_end[(y, m)]] / p[month_end[prev]] - 1 + dy_m
                else:
                    mu, sd = {2022: (-0.011, 0.068), 2023: (0.013, 0.055), 2024: (0.008, 0.050)}[y]
                    ret = r.gauss(mu, sd)
                rows.append(dict(year=y, month=m, **{"return": round(ret, 4)}))
        fields = [N("year", "Year", F_YEAR), N("month", "Month", F_YEAR), N("return", "Total shareholder return", F_PCT)]
        self.add(make_ds("monthly_returns", "Helios Industrial monthly TSR", fields, rows, source=SRC_MKT,
                         notes=["Month-end to month-end, dividends included. Nov-2024 onwards computed from price_ohlc closes."]))

    def daily_activity(self):
        vols = {r_["date"]: r_["volume"] for r_ in self.ohlc}
        avg25 = statistics.mean(v for d, v in vols.items() if d.startswith("2025"))
        rows = [dict(date=d, value=rnd(v / avg25 * 100)) for d, v in vols.items() if d >= "2026-01-01"]
        fields = [D("date", "Date"), N("value", "Volume index (2025 average = 100)", F_NUM)]
        self.add(make_ds("daily_activity", "Daily trading activity 2026 YTD", fields, rows, source=SRC_MKT,
                         notes=["Trading days only (weekends absent). Derived from price_ohlc volume."]))

    def network(self):
        r = self.rng("network")
        customers = ["Aurelia Motors", "Brightline Packaging", "Cobalt Aerospace", "Delmar Foods", "Everstone Pharma",
                     "Fairhaven Semiconductors", "Granton Logistics", "Hollis Energy"]
        suppliers = ["Ingram Castings", "Jansen Electronics", "Kobold Bearings", "Lorrimer Microchips", "Marlow Polymers", "Ostend Steel"]
        competitors = ["Corvane Automation", "Valdris Controls", "Tessaro Robotics", "Kanemori Systems", "Norrvik Drives"]
        partners = ["Quillon Cloud", "Rhodes Systems Integration", "Tamsin Institute of Technology", "Ulric Integrators"]
        ids = {}

        def nid(name):
            if name not in ids:
                ids[name] = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            return ids[name]

        edges = []
        for c in customers:
            edges.append((nid("Helios Industrial"), nid(c), rnd(r.uniform(60, 340)), "Sales"))
        for s in suppliers:
            edges.append((nid(s), nid("Helios Industrial"), rnd(r.uniform(35, 210)), "Supply"))
        for c in competitors:
            edges.append((nid("Helios Industrial"), nid(c), rnd(r.uniform(250, 1200)), "Competition"))
        for p in partners:
            edges.append((nid("Helios Industrial"), nid(p), rnd(r.uniform(15, 90)), "Partnership"))
        cross = [("Corvane Automation", "Aurelia Motors", "Sales"), ("Kanemori Systems", "Fairhaven Semiconductors", "Sales"),
                 ("Valdris Controls", "Everstone Pharma", "Sales"), ("Norrvik Drives", "Granton Logistics", "Sales"),
                 ("Tessaro Robotics", "Cobalt Aerospace", "Sales"), ("Jansen Electronics", "Corvane Automation", "Supply"),
                 ("Kobold Bearings", "Norrvik Drives", "Supply"), ("Lorrimer Microchips", "Kanemori Systems", "Supply"),
                 ("Rhodes Systems Integration", "Aurelia Motors", "Partnership"), ("Quillon Cloud", "Valdris Controls", "Partnership"),
                 ("Ostend Steel", "Tessaro Robotics", "Supply"), ("Corvane Automation", "Valdris Controls", "Competition")]
        for a, b, t in cross:
            edges.append((nid(a), nid(b), rnd(r.uniform(20, 260)), t))
        size = {}
        for a, b, v, _ in edges:
            size[a] = size.get(a, 0) + v
            size[b] = size.get(b, 0) + v
        nodes = [dict(id=nid("Helios Industrial"), name="Helios Industrial", type="Target", size=self.fin[2025]["revenue"])]
        for group, kind in ((customers, "Customer"), (suppliers, "Supplier"), (competitors, "Competitor"), (partners, "Partner")):
            for name in group:
                nodes.append(dict(id=nid(name), name=name, type=kind, size=rnd(size[nid(name)])))
        nf = [S("id", "Id"), S("name", "Name"), S("type", "Type"), N("size", "Relationship value", F_USDM, "USD m")]
        ef = [S("source", "Source"), S("target", "Target"), N("value", "Value", F_USDM, "USD m"), S("type", "Relationship")]
        note = "network_nodes.id is referenced by network_edges.source / target."
        self.add(make_ds("network_nodes", "Ecosystem map: nodes", nf, nodes, source=SRC_ANALYSIS, unit="USD m",
                         notes=[note, "size: Helios = FY25A revenue; others = sum of their edge values."]))
        self.add(make_ds("network_edges", "Ecosystem map: relationships", ef,
                         [dict(source=a, target=b, value=v, type=t) for a, b, v, t in edges], source=SRC_ANALYSIS, unit="USD m",
                         notes=[note, "value: annual sales / spend / overlapping revenue (Competition) in USD m."]))

    def debt_maturity(self):
        tlb_amort = 8.05
        sched = {
            "Term Loan B": {2026: tlb_amort, 2027: tlb_amort, 2028: tlb_amort, 2029: tlb_amort, 2030: tlb_amort, 2031: rnd(805 - 5 * tlb_amort, 2)},
            "Senior Notes": {2028: 400.0, 2033: 450.0},
            "RCF": {2029: 200.0},
            "Convertible": {2030: 250.0},
        }
        rows = [dict(year=y, instrument=i, amount=rnd(sched[i].get(y, 0.0), 2)) for y in range(2026, 2036) for i in sched]
        fields = [N("year", "Year", F_YEAR), S("instrument", "Instrument"), N("amount", "Principal maturing", F_USDM1, "USD m")]
        self.add(make_ds("debt_maturity", "Debt maturity profile", fields, rows, source=SRC_CO, unit="USD m",
                         notes=[f"Total {GROSS_DEBT:,.0f} = gross debt; full year x instrument grid (zeros included). TLB amortises 1% p.a."]))

    def yield_curve(self):
        tenors = [("3M", 0.25), ("6M", 0.5), ("1Y", 1), ("2Y", 2), ("3Y", 3), ("5Y", 5), ("7Y", 7), ("10Y", 10), ("20Y", 20), ("30Y", 30)]
        cur = [3.86, 3.79, 3.66, 3.51, 3.48, 3.56, 3.71, 3.93, 4.36, 4.46]
        m1 = [3.95, 3.88, 3.74, 3.60, 3.57, 3.63, 3.77, 3.98, 4.39, 4.48]
        y1 = [4.62, 4.48, 4.27, 3.98, 3.89, 3.88, 3.97, 4.11, 4.48, 4.52]
        rows = [dict(tenor=t, tenor_years=ty, current=round(a / 100, 4), one_month_ago=round(b / 100, 4), one_year_ago=round(c / 100, 4))
                for (t, ty), a, b, c in zip(tenors, cur, m1, y1)]
        fields = [S("tenor", "Tenor"), N("tenor_years", "Tenor (years)", "0.00"), N("current", "Current", F_PCT2),
                  N("one_month_ago", "1 month ago", F_PCT2), N("one_year_ago", "1 year ago", F_PCT2)]
        self.add(make_ds("yield_curve", "USD sovereign yield curve", fields, rows, source=SRC_MKT,
                         notes=["Illustrative curve; yields as decimals (0.0386 = 3.86%)."]))

    # ------------------------------------------------- ib-pitch: credentials, sources & uses, capitalisation
    def credentials(self):
        """Tombstones of the (fictional) advisory bank; deals that are also rows of `precedents` share their EV."""
        prec = {p["target"]: p for p in self.precedent_rows}

        def bn(target):
            return rnd(prec[target]["ev"] / 1000, 1)
        deals = [
            ("2026-09-08", "Tarrant Automation", "Kanemori Systems", 5.0, "Acquisition financing", "Joint lead arranger & bookrunner", IA, "Asia Pacific",
             "Committed bridge and term-loan financing for Kanemori Systems' all-cash acquisition of Tarrant Automation."),
            ("2026-08-24", "Tarrant Automation", "Kanemori Systems", bn("Tarrant Automation"), "Sell-side M&A", "Exclusive financial advisor", IA, "North America",
             "Sale of US machine-vision and motion-control specialist Tarrant Automation; pending regulatory approvals."),
            ("2026-05-11", "Upland Drives", "Norrvik Drives", bn("Upland Drives"), "Buy-side M&A", "Financial advisor", MPC, "Latin America",
             "Acquisition of Brazilian industrial-drives maker Upland Drives, extending Norrvik's Latin American footprint."),
            ("2026-03-20", "Sefton Industrial Software", "Bluefield Capital Partners", 1.6, "Acquisition financing", "Joint lead arranger", ISS, "Europe",
             "Unitranche and term-loan package supporting Bluefield Capital Partners' take-private of Sefton."),
            ("2026-03-02", "Sefton Industrial Software", "Bluefield Capital Partners", bn("Sefton Industrial Software"), "Sell-side M&A",
             "Lead financial advisor", ISS, "Europe", "Recommended take-private of UK asset-performance software provider Sefton."),
            ("2025-11-10", "Redmere Instruments", "Quintar Sensing", bn("Redmere Instruments"), "Sell-side M&A", "Joint financial advisor", ISS, "Europe",
             "Sale of German process-instrumentation group Redmere Instruments for cash and shares."),
            ("2025-10-21", "Lumora Sensing", None, 1.2, "IPO", "Joint global coordinator", ISS, "North America",
             "US initial public offering of industrial sensing platform Lumora Sensing; priced at the top of the range."),
            ("2025-07-15", "Brennick Robotics", "Helios Industrial", bn("Brennick Robotics"), "Buy-side M&A", "Exclusive financial advisor", IA, "North America",
             "Acquisition of collaborative-robotics developer Brennick Robotics, adding cobot software to Helios' portfolio."),
            ("2025-06-16", "Sierra Alta Castings", "Ashgrove Equity", 0.6, "Divestiture", "Exclusive financial advisor", MPC, "Latin America",
             "Carve-out sale of Sierra Alta Industrial's precision-castings division."),
            ("2025-02-03", "Queensbury Controls", "Valdris Controls", bn("Queensbury Controls"), "Buy-side M&A", "Lead financial advisor", IA, "Asia Pacific",
             "Acquisition of Australian building- and process-controls group Queensbury Controls."),
            ("2024-11-18", "Haldane Pumps", "Ostrava Fluid Systems", 4.6, "Merger", "Financial advisor", MPC, "Europe",
             "All-share merger of equals creating a European flow-control group with $6bn of combined revenue."),
            ("2024-04-08", "Oakhurst Motion", "Corvane Automation", bn("Oakhurst Motion"), "Buy-side M&A", "Joint financial advisor", MPC, "North America",
             "Acquisition of US motion-control leader Oakhurst Motion, Corvane's largest transaction to date."),
        ]
        rows = [dict(date=d, target=t, acquirer=a, deal_value_bn=v, deal_type=k, role=ro, sector=s, region=rg, description=ds)
                for d, t, a, v, k, ro, s, rg, ds in deals]
        fields = [D("date", "Announced", "mmmm yyyy"), S("target", "Target / issuer"), S("acquirer", "Acquirer / borrower"),
                  N("deal_value_bn", "Deal value", F_USDBN, "USD bn"), S("deal_type", "Deal type"), S("role", "Role"),
                  S("sector", "Sector"), S("region", "Region"), S("description", "Description")]
        self.add(make_ds("credentials", "Selected transaction credentials", fields, rows,
                         source="Kingsgate Advisory deal records (synthetic)", unit="USD bn",
                         notes=["Deal value: enterprise value at announcement (M&A), committed facilities (financing) or offering size (IPO).",
                                "M&A rows that also appear in precedents share their enterprise value; region = target / issuer / borrower region."]))

    def sources_uses(self):
        """LBO of Helios at the $52.00 offer: 5.0x 2026E EBITDA of debt (LBO_LEVERAGE), fees = LBO_FEES of EV, equity plug."""
        e26, offer = self.fin[2026]["ebitda"], 52.00
        equity = rnd(offer * SHARES, 1)
        debt = [("Term Loan B", 2990.0, "7-year senior secured term loan; SOFR + 325 bps, 99.5 OID, 1.0% annual amortisation."),
                ("Senior secured notes", 995.0, None), ("Senior unsecured notes", 995.0, None)]
        total_debt = sum(a for _, a, _ in debt)
        fin_fees = rnd(0.02 * total_debt, 1)
        txn_fees = rnd(LBO_FEES * (equity + NET_DEBT) - fin_fees, 1)
        uses = [("Purchase of equity", equity, f"{SHARES:.1f}m diluted shares at the ${offer:.2f} offer price, a {offer / PRICE - 1:.1%} premium "
                 f"to the 09-Oct-2026 close of ${PRICE:.2f}."),
                ("Refinancing of existing debt", GROSS_DEBT, "Gross debt at 30-Sep-2026 (senior notes, term loan, RCF drawings and convertible)."),
                ("Transaction fees & expenses", txn_fees, None),
                ("Financing fees", fin_fees, "2.0% of funded debt; capitalised and amortised over the life of the facilities."),
                ("Cash to balance sheet", 150.0, None)]
        total_uses = rnd(sum(a for _, a, _ in uses), 1)
        rollover = 250.0
        sponsor = rnd(total_uses - total_debt - CASH - rollover, 1)
        sources = debt + [("Existing cash on balance sheet", CASH, None), ("Management rollover equity", rollover, None),
                          ("Sponsor equity", sponsor, "Balancing item: Granite Arch Partners Fund VII and co-investors (fictional).")]
        rows = []
        for side, items in (("Sources", sources), ("Uses", uses)):
            tot = sum(a for _, a, _ in items)
            rows += [dict(side=side, item=i, amount=a, multiple_of_ebitda=round(a / e26, 2), pct=round(a / tot, 4), notes=n)
                     for i, a, n in items]
        fields = [S("side", "Side"), S("item", "Item"), N("amount", "Amount", F_USDM1, "USD m"),
                  N("multiple_of_ebitda", "x 2026E EBITDA", F_MULT), N("pct", "% of total", F_PCT), S("notes", "Notes")]
        self.add(make_ds("sources_uses", "Illustrative LBO sources & uses at $52.00 per share", fields, rows, source=SRC_ANALYSIS,
                         unit="USD m", notes=[f"Multiples of 2026E EBITDA of ${e26:,.1f}m; total sources equal total uses.",
                                              "pct = amount / side total."]))

    def capital_structure(self):
        """Pro forma capitalisation at close of the sources_uses LBO; multiple_cum = cumulative amount / 2026E EBITDA."""
        e26 = self.fin[2026]["ebitda"]
        amt = {r["item"]: r["amount"] for r in self.out["sources_uses"]["data"]}
        tranches = [("Revolving credit facility ($500m)", 0.0, 0.0758, "2031-10-31"),
                    ("Term Loan B", amt["Term Loan B"], 0.0758, "2033-10-31"),
                    ("Senior secured notes", amt["Senior secured notes"], 0.0725, "2034-10-15"),
                    ("Senior unsecured notes", amt["Senior unsecured notes"], 0.0875, "2034-10-15"),
                    ("Sponsor & rollover equity", rnd(amt["Sponsor equity"] + amt["Management rollover equity"], 1), None, None)]
        rows, cum = [], 0.0
        for name, a, rate, mat in tranches:
            cum += a
            rows.append(dict(instrument=name, amount=a, rate=rate, maturity=mat, multiple_cum=round(cum / e26, 2)))
        fields = [S("instrument", "Instrument"), N("amount", "Amount", '$#,##0.0;($#,##0.0);"–"', "USD m"),
                  N("rate", "Rate", F_PCT2), D("maturity", "Maturity", "mmm yyyy"), N("multiple_cum", "Cumulative x 2026E EBITDA", F_MULT)]
        self.add(make_ds("capital_structure", "Pro forma capitalisation at close", fields, rows, source=SRC_ANALYSIS, unit="USD m",
                         notes=["Floating rates at 3-month SOFR of 4.33% plus margin; RCF undrawn at close.",
                                "Debt tranches equal the sources in sources_uses."]))

    # ------------------------------------------------------------- valuation
    def valuation_block(self):
        base = self.scen["Base"]
        fcfs = [base[y]["fcf"] for y in range(2026, 2031)]
        # --- DCF grid
        rows = []
        grid = {}
        for w in DCF_WACC:
            for g in DCF_TGR:
                v = rnd(equity_per_share(dcf_ev(fcfs, w, g)), 2)
                grid[(w, g)] = v
                rows.append(dict(wacc=w, tgr=g, value=v))
        fields = [N("wacc", "WACC", F_PCT), N("tgr", "Terminal growth", F_PCT), N("value", "Implied share price", F_PX, "USD")]
        self.add(make_ds("sensitivity_dcf", "DCF sensitivity: implied share price", fields, rows, source=SRC_ANALYSIS, unit="USD per share",
                         notes=["Base-case unlevered FCF 2026E–2030E, end-year discounting; Gordon-growth terminal value on 2030E FCF.",
                                f"Equity value = EV – net debt ({NET_DEBT:,.0f}) – pension ({PENSION:.0f}) – minorities ({MINORITIES:.0f}) + associates ({ASSOCIATES:.0f}); {SHARES:.1f}m diluted shares.",
                                f"Base case WACC {DCF_BASE[0]:.1%}, TGR {DCF_BASE[1]:.1%} = ${grid[DCF_BASE]:.2f}."]))
        self.dcf_grid = grid
        # --- EV -> equity bridge (DCF base case)
        ev_dcf = rnd(dcf_ev(fcfs, *DCF_BASE))
        eq = rnd(ev_dcf - GROSS_DEBT + CASH - PENSION - MINORITIES + ASSOCIATES)
        bridge = [("Enterprise value (DCF base case)", ev_dcf, "total"), ("Less: gross debt", -GROSS_DEBT, "delta"),
                  ("Plus: cash & equivalents", CASH, "delta"), ("Less: pension deficit", -PENSION, "delta"),
                  ("Less: minority interests", -MINORITIES, "delta"), ("Plus: equity-accounted associates", ASSOCIATES, "delta"),
                  ("Equity value", eq, "total")]
        self.add(make_ds("ev_equity_bridge", "Enterprise value to equity value bridge", [S("step", "Step"),
                         N("value", "Value", "#,##0.0;(#,##0.0)", "USD m"), S("kind", "Kind")],
                         [dict(step=s, value=v, kind=k) for s, v, k in bridge], source=SRC_ANALYSIS, unit="USD m",
                         notes=[f"Implied equity value per share ${eq / SHARES:.2f} on {SHARES:.1f}m diluted shares (= sensitivity_dcf at WACC {DCF_BASE[0]:.1%}, TGR {DCF_BASE[1]:.1%}).",
                                "kind: total = absolute bar; delta = floating step."]))
        # --- LBO grid
        e26, e30 = base[2026]["ebitda"], base[2030]["ebitda"]
        lfcf = [base[y]["fcf"] for y in range(2027, 2031)]
        lrows = []
        for en in LBO_MULTS:
            for ex in LBO_MULTS:
                lrows.append(dict(entry_multiple=en, exit_multiple=ex, irr=round(lbo_irr(en, ex, e26, e30, lfcf), 4)))
        self.add(make_ds("sensitivity_lbo", "LBO sensitivity: sponsor IRR", [N("entry_multiple", "Entry EV/EBITDA 2026E", F_MULT),
                         N("exit_multiple", "Exit EV/EBITDA 2030E", F_MULT), N("irr", "Sponsor IRR", F_PCT)], lrows,
                         source=SRC_ANALYSIS, notes=[f"Entry 31-Dec-2026 on FY26E EBITDA ({e26:,.1f}); exit 31-Dec-2030 on FY30E EBITDA ({e30:,.1f}).",
                                                     f"{LBO_LEVERAGE:.1f}x opening leverage at {LBO_RATE:.1%} cash interest, 100% cash sweep, {LBO_FEES:.1%} fees."]))

        def solve_entry(target_irr):
            lo, hi = 3.0, 20.0
            for _ in range(80):
                mid = (lo + hi) / 2
                if lbo_irr(mid, LBO_EXIT_REF, e26, e30, lfcf) > target_irr:
                    lo = mid
                else:
                    hi = mid
            return (lo + hi) / 2

        lbo_hi_m, lbo_lo_m = solve_entry(0.20), solve_entry(0.25)
        # --- market-based ranges
        core = [p for p in self.peer_rows if p["sector"] in (IA, MPC) and not p["is_target"]]
        ev26 = [p["ev_ebitda_26e"] for p in core]
        m26_lo, m26_hi = round(quantile(ev26, 0.25), 1), round(quantile(ev26, 0.75), 1)
        pe_core = [p["pe_25e"] for p in self.peer_rows if p["sector"] in (IA, MPC) and not p["is_target"]]
        pe_lo, pe_hi = round(quantile(pe_core, 0.25), 1), round(quantile(pe_core, 0.75), 1)
        eps25 = self.fin[2025]["net_income"] / SHARES
        prec = [p["ev_ebitda"] for p in self.precedent_rows if p["sector"] in (IA, MPC)]
        pr_lo, pr_hi = round(quantile(prec, 0.25), 1), round(quantile(prec, 0.75), 1)
        prem = [p["premium_1d"] for p in self.precedent_rows if p["premium_1d"] is not None]
        pm_lo, pm_hi = quantile(prem, 0.25), quantile(prem, 0.75)
        e25 = self.fin[2025]["ebitda"]
        hlx = next(p for p in self.peer_rows if p["is_target"])
        lo_dcf = min(grid[(w, g)] for w in (0.085, 0.090, 0.095) for g in (0.020, 0.025, 0.030))
        hi_dcf = max(grid[(w, g)] for w in (0.085, 0.090, 0.095) for g in (0.020, 0.025, 0.030))
        ranges = [
            ("DCF (perpetuity growth)", "Intrinsic", lo_dcf, hi_dcf, "WACC 8.5%–9.5%, terminal growth 2.0%–3.0%"),
            ("LBO analysis", "Intrinsic", equity_per_share(lbo_lo_m * e26), equity_per_share(lbo_hi_m * e26),
             f"20%–25% sponsor IRR, {LBO_EXIT_REF:.1f}x exit ({lbo_lo_m:.1f}x–{lbo_hi_m:.1f}x entry EV/EBITDA 2026E)"),
            ("Trading comparables (EV/EBITDA)", "Market", equity_per_share(m26_lo * self.fin[2026]["ebitda"]),
             equity_per_share(m26_hi * self.fin[2026]["ebitda"]), f"{m26_lo:.1f}x–{m26_hi:.1f}x EV/EBITDA 2026E (core peers)"),
            ("Trading comparables (P/E)", "Market", pe_lo * eps25, pe_hi * eps25, f"{pe_lo:.1f}x–{pe_hi:.1f}x P/E 2025E (core peers)"),
            ("Precedent transactions", "Transaction", equity_per_share(pr_lo * e25), equity_per_share(pr_hi * e25),
             f"{pr_lo:.1f}x–{pr_hi:.1f}x EV/LTM EBITDA"),
            ("Premiums paid", "Transaction", PRICE * (1 + pm_lo), PRICE * (1 + pm_hi),
             f"{pm_lo:.0%}–{pm_hi:.0%} premium to current price"),
            ("52-week trading range", "Reference", hlx["price_52w_low"], hlx["price_52w_high"], "Closing prices, 52 weeks to 09-Oct-2026"),
            ("Analyst price targets", "Reference", 38.00, 54.00, "Range of 14 broker targets (median $47.00)"),
        ]
        vrows = [dict(method=m, group=g, low=rnd(lo, 2), high=rnd(hi, 2), basis=b, order=i + 1)
                 for i, (m, g, lo, hi, b) in enumerate(ranges)]
        fields = [S("method", "Methodology"), S("group", "Group"), N("low", "Low", F_PX, "USD"), N("high", "High", F_PX, "USD"),
                  S("basis", "Basis"), N("order", "Order", F_YEAR)]
        self.add(make_ds("valuation_ranges", "Valuation summary: implied value per share", fields, vrows, source=SRC_ANALYSIS,
                         unit="USD per share", notes=[f"Current share price ${PRICE:.2f} (09-Oct-2026).",
                                                      "Ranges derived from peers (core = Industrial Automation + Motion & Power Control), precedents, sensitivity_dcf and sensitivity_lbo."]))

    # ------------------------------------------------- ib-valuation: sum-of-the-parts, offer price levels (AVP)
    def ib_valuation(self):
        """sotp: segments on FY26E (segment EBITDA + corporate costs = group EBITDA); offer_prices: AVP column levels."""
        e26 = self.fin[2026]["ebitda"]
        rev26 = {s: self._seg_total(2026, seg=s) for s in SEGMENTS}
        margin = {"Factory Automation": 0.195, "Motion Control": 0.168, "Sensors & Instrumentation": 0.225, "Software & Services": 0.256}
        seg_e = {s: rnd(rev26[s] * margin[s]) for s in SEGMENTS}
        corporate = rnd(e26 - sum(seg_e.values()))          # unallocated corporate costs (negative) close the tie-out
        others = [p for p in self.peer_rows if not p["is_target"]]

        def peer_note(sector, fn, label):
            xs = [fn(p) for p in others if p["sector"] == sector]
            lo, md, hi = quantile(xs, 0.25), quantile(xs, 0.5), quantile(xs, 0.75)
            return f"{sector} peers: {lo:.1f}x–{hi:.1f}x {label} (interquartile), median {md:.1f}x"
        m_e, m_r = "EV / EBITDA 2026E", "EV / Revenue 2026E"
        parts = [
            ("Factory Automation", "EBITDA 2026E", seg_e["Factory Automation"], 8.0, 9.0, m_e,
             peer_note(IA, lambda p: p["ev_ebitda_26e"], m_e)),
            ("Motion Control", "EBITDA 2026E", seg_e["Motion Control"], 7.0, 8.0, m_e, peer_note(MPC, lambda p: p["ev_ebitda_26e"], m_e)),
            ("Sensors & Instrumentation", "EBITDA 2026E", seg_e["Sensors & Instrumentation"], 9.5, 11.0, m_e,
             peer_note(ISS, lambda p: p["ev_ebitda_26e"], m_e) + "; discount for hardware mix"),
            ("Software & Services", "Revenue 2026E", rev26["Software & Services"], 2.5, 3.25, m_r,
             peer_note(ISS, lambda p: p["ev"] / p["revenue_26e"], m_r) + "; discount for scale"),
        ]
        # corporate costs capitalised at the blended segment multiple (segment EV / segment EBITDA, rounded to 0.5x)
        blend = [round(2 * sum(p[2] * p[3 + k] for p in parts) / sum(seg_e.values())) / 2 for k in (0, 1)]
        parts.append(("Unallocated corporate costs", "Corporate costs 2026E", corporate, blend[0], blend[1], m_e,
                      "Capitalised at the blended segment multiple"))
        rows = [dict(segment=s, metric_name=mn, metric_value=mv, multiple_low=lo, multiple_high=hi, method=me,
                     ebitda=seg_e.get(s, corporate), note=nt) for s, mn, mv, lo, hi, me, nt in parts]
        ev = [sum(r["metric_value"] * r[k] for r in rows) for k in ("multiple_low", "multiple_high")]
        eq = [v - NET_DEBT + OTHER_ADJ for v in ev]
        f_m = "$#,##0.0;($#,##0.0)"
        fields = [S("segment", "Segment"), S("metric_name", "Metric"), N("metric_value", "Metric value", f_m, "USD m"),
                  N("multiple_low", "Multiple (low)", F_MULT), N("multiple_high", "Multiple (high)", F_MULT), S("method", "Method"),
                  N("ebitda", "EBITDA 2026E", f_m, "USD m"), S("note", "Basis")]
        self.add(make_ds("sotp", "Sum-of-the-parts valuation", fields, rows, source=SRC_ANALYSIS, unit="USD m", notes=[
            f"Segment EBITDA plus unallocated corporate costs = FY26E group EBITDA (${e26:,.1f}m); Software & Services valued on revenue.",
            f"Implied EV ${ev[0]:,.0f}m–${ev[1]:,.0f}m ({ev[0] / e26:.1f}x–{ev[1] / e26:.1f}x EBITDA 2026E); less net debt ${NET_DEBT:,.0f}m "
            f"and other adjustments ${-OTHER_ADJ:,.0f}m = equity ${eq[0]:,.0f}m–${eq[1]:,.0f}m, "
            f"${eq[0] / SHARES:.2f}–${eq[1] / SHARES:.2f} per share on {SHARES:.1f}m diluted shares."]))
        # --- offer price levels for the analysis at various prices (AVP): current price, proposals received, levels
        vwap_30d, high_52w = 41.10, 47.90
        levels = [(PRICE, "Current", "current", iso(REF_DAY)), (45.00, None, "level", None),
                  (47.00, "Initial proposal", "proposal", "2026-08-12"), (49.50, "Revised proposal", "proposal", "2026-09-15"),
                  (52.00, "Final proposal", "offer", "2026-10-06"), (55.00, None, "level", None)]
        self.add(make_ds("offer_prices", "Offer price levels for the analysis at various prices", [
            N("price", "Price per share", F_PX, "USD"), S("label", "Label"), S("kind", "Kind"), D("date", "Received")],
            [dict(price=p, label=lb, kind=k, date=d) for p, lb, k, d in levels], source=SRC_ANALYSIS, unit="USD per share", notes=[
                f"Reference prices: unaffected ${PRICE:.2f} (09-Oct-2026 close), 30-day VWAP ${vwap_30d:.2f}, 52-week high ${high_52w:.2f}.",
                "kind: current = current share price; proposal = indicative proposal received; offer = final proposal; level = illustrative."]))

    def ebitda_bridge(self):
        e25, e26 = self.fin[2025]["ebitda"], self.fin[2026]["ebitda"]
        steps = [("Volume", 74.0, "Organic"), ("Pricing", 52.5, "Organic"), ("Mix", 10.0, "Organic"),
                 ("Input cost inflation", -41.0, "Cost"), ("Wage inflation", -24.5, "Cost"),
                 ("Productivity & procurement", 36.0, "Cost"), ("Brennick Robotics (full year)", 12.5, "M&A"),
                 ("FX translation", -6.5, "FX")]
        plug = rnd(e26 - e25 - sum(v for _, v, _ in steps))
        steps.append(("Growth investments (R&D, digital)", plug, "Investment"))
        rows = [dict(step="FY25A EBITDA", value=e25, kind="total", category="Total")]
        rows += [dict(step=s, value=v, kind="delta", category=c) for s, v, c in steps]
        rows.append(dict(step="FY26E EBITDA", value=e26, kind="total", category="Total"))
        fields = [S("step", "Step"), N("value", "EBITDA impact", "#,##0.0;(#,##0.0)", "USD m"), S("kind", "Kind"), S("category", "Category")]
        self.add(make_ds("ebitda_bridge", "EBITDA bridge FY25A to FY26E", fields, rows, source=SRC_ANALYSIS, unit="USD m",
                         notes=["kind: total = absolute bar; delta = floating step. Deltas sum exactly to the change in EBITDA."]))

    # ------------------------------------------------------------------ run
    def run(self):
        self.build_model()
        order = [self.peers, self.price_ohlc, self.price_perf, self.price_events, self.ntm_multiple, self.financials,
                 self.segment_revenue, self.quarterly, self.precedents, self.valuation_block, self.ebitda_bridge,
                 self.revenue_by_country, self.assets_locations, self.deal_flows, self.china_provinces, self.market_share,
                 self.ownership, self.deal_timeline, self.league_table, self.segments_tree, self.pnl_flow,
                 self.corr_matrix, self.peer_scores, self.kpis, self.org_structure, self.pipeline_funnel, self.scenarios,
                 self.monthly_returns, self.daily_activity, self.network, self.debt_maturity, self.yield_curve]
        order += [self.credentials, self.sources_uses, self.capital_structure]   # ib-pitch (after precedents)
        order += [self.ib_valuation]   # ib-valuation (after segment_revenue, peers)
        for fn in order:
            fn()
        return {k: self.out[k] for k in DATASET_ORDER}

    def quarterly(self):
        fields = [S("quarter", "Quarter"), D("date", "Quarter end"), N("revenue", "Revenue", F_USDM1, "USD m"),
                  N("ebitda", "EBITDA", F_USDM1, "USD m"), N("ebitda_margin", "EBITDA margin", F_PCT),
                  N("consensus_revenue", "Consensus revenue", F_USDM1, "USD m"), N("beat_miss_pct", "Beat / (miss) vs. consensus", F_DPCT)]
        self.add(make_ds("quarterly", "Quarterly results vs. consensus", fields, self.quarters, source=SRC_CO, unit="USD m",
                         notes=["Quarters of FY24 and FY25 sum to annual figures in financials.",
                                "Q3-26 from the preliminary trading update of 06-Oct-2026 (unaudited)."]))


DATASET_ORDER = [
    "peers", "price_ohlc", "price_perf", "price_events", "ntm_multiple", "financials", "segment_revenue", "quarterly",
    "valuation_ranges", "ebitda_bridge", "ev_equity_bridge", "sensitivity_dcf", "sensitivity_lbo", "revenue_by_country",
    "assets_locations", "deal_flows", "china_provinces", "market_share", "ownership", "deal_timeline", "league_table",
    "precedents", "segments_tree", "pnl_flow", "corr_matrix", "peer_scores", "kpis", "org_structure", "pipeline_funnel",
    "scenarios", "monthly_returns", "daily_activity", "network_nodes", "network_edges", "debt_maturity", "yield_curve",
    "credentials", "sources_uses", "capital_structure",
    "sotp", "offer_prices",
]

# id -> which chart types / components it is meant to feed (README + index.json)
PURPOSE = {
    "peers": "Comps table, scatter (EV/EBITDA vs growth / margin), bubble, ranked bar, box plot, geo markers (lat/lon), global filters on sector / region",
    "price_ohlc": "Candlestick + volume, line with dataZoom, event annotations (with price_events)",
    "price_perf": "Multi-series rebased line chart (long format: date / series / value)",
    "price_events": "Event markers / annotations on price charts, event timeline",
    "ntm_multiple": "Two-line trading-multiple history, premium/discount area",
    "financials": "Financial summary table, combo bar+line (revenue + margin), A/E styling",
    "segment_revenue": "Stacked bar / area by segment or region, pivot table, small multiples",
    "quarterly": "Beat/miss bars, actual vs consensus columns, margin line",
    "valuation_ranges": "Football field (low/high by method, grouped)",
    "ebitda_bridge": "Waterfall / bridge (total + delta steps, colour by category)",
    "ev_equity_bridge": "Waterfall from EV to equity value",
    "sensitivity_dcf": "Sensitivity heat table (WACC x TGR), what-if param demos",
    "sensitivity_lbo": "IRR heat table (entry x exit multiple)",
    "revenue_by_country": "World choropleth (iso_num = world-atlas id), bubble map, ranked bar",
    "assets_locations": "Point / cluster / heat map (Leaflet), footprint table",
    "deal_flows": "Flow / arc map (lines between lat/lon), chord-style flows",
    "china_provinces": "China province choropleth (adcode), ranked bar",
    "market_share": "Marimekko / mosaic, 100% stacked bar",
    "ownership": "Shareholder table, donut by investor type, bar of holders",
    "deal_timeline": "Gantt with phases and milestones",
    "league_table": "Ranked league table, horizontal bar with rank change",
    "precedents": "Precedent transactions table, scatter of EV/EBITDA over time, premium box plot",
    "segments_tree": "Treemap, sunburst, indented tree (id / parent)",
    "pnl_flow": "Sankey (revenue to net income)",
    "corr_matrix": "Correlation heatmap",
    "peer_scores": "Radar / spider chart, scorecard heatmap",
    "kpis": "KPI tiles with delta and sparkline",
    "org_structure": "Org / legal-entity tree diagram",
    "pipeline_funnel": "Funnel chart",
    "scenarios": "Scenario line / fan chart, grouped bars",
    "monthly_returns": "Year x month heatmap of returns",
    "daily_activity": "Calendar heatmap",
    "network_nodes": "Force-directed network graph (nodes)",
    "network_edges": "Force-directed network graph (edges)",
    "debt_maturity": "Stacked maturity-profile bars",
    "yield_curve": "Multi-line yield curve (tenor_years as numeric x)",
    "credentials": "Deal credentials / tombstone grid (deal type, parties, value, role), filterable by sector / region",
    "sources_uses": "LBO sources & uses table (two balancing sides, % of total, x EBITDA, footnotes)",
    "capital_structure": "Pro forma capitalisation table (tranches, rates, maturities, cumulative leverage)",
    "sotp": "Sum-of-the-parts build-up: segment metric x multiple range -> EV -> equity value and value per share",
    "offer_prices": "Analysis at various prices (AVP) columns: current price, proposals received, final proposal, levels",
}


# ----------------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------------

def generate(seed: int = SEED) -> dict:
    """Return {dataset id: dataset dict} in the ReportKit data contract (deterministic for a given seed)."""
    return _Gen(seed).run()


def dumps_dataset(ds: dict) -> str:
    """Stable JSON: header pretty-printed, one record per line (diff-friendly, compact)."""
    def j(x):
        return json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    lines = ["{", f' "id":{j(ds["id"])},', f' "title":{j(ds["title"])},', ' "schema":{"fields":[']
    fl = ds["schema"]["fields"]
    lines += [f"  {j(f)}{',' if i < len(fl) - 1 else ''}" for i, f in enumerate(fl)]
    lines.append(" ]},")
    lines.append(' "data":[')
    lines += [f"  {j(r)}{',' if i < len(ds['data']) - 1 else ''}" for i, r in enumerate(ds["data"])]
    lines.append(" ],")
    extra = [k for k in ds if k not in ("id", "title", "schema", "data", "meta")]
    for k in extra:
        lines.append(f" {j(k)}:{j(ds[k])},")
    lines.append(f' "meta":{j(ds["meta"])}')
    lines.append("}")
    return "\n".join(lines) + "\n"


def build_index(datasets: dict) -> dict:
    return {
        "reportkit": "0.1",
        "generator": "tools/make_sample_data.py",
        "seed": SEED,
        "asOf": AS_OF,
        "datasets": {k: {"title": d["title"], "rows": len(d["data"]), "fields": [f["name"] for f in d["schema"]["fields"]],
                         "path": f"datasets/{k}.json", "purpose": PURPOSE.get(k, "")} for k, d in datasets.items()},
    }


def build_readme(datasets: dict) -> str:
    total = sum(len(d["data"]) for d in datasets.values())
    out = [
        "# ReportKit sample datasets",
        "",
        "Synthetic, internally consistent investment-banking datasets shared by the gallery and the demo reports.",
        "Every file follows the dataset contract in `docs/architecture.md` §4.1 (`id`, `title`, `schema.fields`, `data`, `meta`).",
        "",
        "**Story.** *Helios Industrial* (HLX), a fictional listed industrial-technology company, is being evaluated for a sale",
        "(\"Project Atlas\") against 17 fictional peers in three sectors (Industrial Automation, Motion & Power Control,",
        "Industrial Software & Sensors) and four regions (North America, Europe, Asia Pacific, Latin America).",
        f"Current share price **${PRICE:.2f}**, {SHARES:.1f}m diluted shares, market cap ${MKT_CAP:,.0f}m, net debt ${NET_DEBT:,.0f}m,",
        f"EV ${EV:,.0f}m. Data as of {AS_OF}. All companies, banks, investors and agencies are invented.",
        "",
        "**Regenerate** (deterministic, seed 2026, stdlib only):",
        "",
        "```bash",
        "python3 tools/make_sample_data.py          # writes datasets/*.json, index.json, README.md",
        "python3 tools/make_sample_data.py --check  # validates the files on disk against a fresh in-memory build",
        "```",
        "",
        "**Conventions.** Amounts in USD m unless the field `unit` says otherwise; percentages and growth rates are decimals",
        "(`0.185` = 18.5%, formatted with `0.0%`); dates are ISO `YYYY-MM-DD`; missing values are `null` (rendered `n.a.`).",
        "Formats are Excel-style codes understood by `RK.format`. `kpis.spark` is an array field (`type: \"array\"`).",
        "",
        "**Consistency guarantees** (checked by `--check`): peers EV = market cap + net debt and multiples = EV / metric;",
        "segment x region revenue sums to group revenue; countries sum to regions; Chinese provinces sum to China;",
        "quarters sum to fiscal years; bridges and the Sankey balance; tree parents equal the sum of children;",
        "DCF grid is monotonic (down in WACC, up in TGR) and LBO IRR is monotonic (down in entry, up in exit);",
        "the football field (`valuation_ranges`) is derived from peers, precedents and the DCF / LBO grids;",
        "price jumps in `price_ohlc` line up with `price_events`.",
        "",
        f"## Datasets ({len(datasets)} files, {total:,} rows)",
        "",
        "| id | title | rows | fields | feeds |",
        "|---|---|---:|---|---|",
    ]
    for k, d in datasets.items():
        fields = ", ".join(f"`{f['name']}`" for f in d["schema"]["fields"])
        out.append(f"| `{k}` | {d['title']} | {len(d['data'])} | {fields} | {PURPOSE.get(k, '')} |")
    out += ["", "`peer_returns_dist` from the original wish-list is intentionally omitted: bucket `peers.ev_ebitda_25e` client-side.", ""]
    return "\n".join(out)


def write(datasets: dict, out_dir: Path = DEFAULT_OUT) -> list[Path]:
    out_dir = Path(out_dir)
    ds_dir = out_dir / "datasets"
    ds_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for k, d in datasets.items():
        p = ds_dir / f"{k}.json"
        p.write_text(dumps_dataset(d), encoding="utf-8")
        written.append(p)
    p = out_dir / "index.json"
    p.write_text(json.dumps(build_index(datasets), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    written.append(p)
    p = out_dir / "README.md"
    p.write_text(build_readme(datasets), encoding="utf-8")
    written.append(p)
    return written


# ----------------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------------
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _type_ok(t, v):
    if v is None:
        return True
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    if t == "string":
        return isinstance(v, str)
    if t == "date":
        return isinstance(v, str) and bool(_ISO_DATE.match(v))
    if t == "boolean":
        return isinstance(v, bool)
    if t == "array":
        return isinstance(v, list)
    return False


def validate(datasets: dict) -> list[str]:
    """Contract checks: shape, field names and types per record."""
    errs = []
    for k, d in datasets.items():
        if d.get("id") != k:
            errs.append(f"{k}: id mismatch")
        fields = d["schema"]["fields"]
        names = [f["name"] for f in fields]
        if len(set(names)) != len(names):
            errs.append(f"{k}: duplicate field names")
        for f in fields:
            if f["type"] not in ("string", "number", "date", "boolean", "array"):
                errs.append(f"{k}.{f['name']}: bad type {f['type']}")
        for i, r in enumerate(d["data"]):
            if list(r) != names:
                errs.append(f"{k}[{i}]: keys {list(r)} != schema {names}")
                continue
            for f in fields:
                if not _type_ok(f["type"], r[f["name"]]):
                    errs.append(f"{k}[{i}].{f['name']}: {r[f['name']]!r} is not {f['type']}")
        m = d.get("meta", {})
        for key in ("source", "notes", "asOf"):
            if key not in m:
                errs.append(f"{k}: meta.{key} missing")
        if m.get("asOf") != AS_OF:
            errs.append(f"{k}: meta.asOf != {AS_OF}")
        if not d["data"]:
            errs.append(f"{k}: empty")
    missing = set(DATASET_ORDER) - set(datasets)
    if missing:
        errs.append(f"missing datasets: {sorted(missing)}")
    return errs


def check_consistency(ds: dict) -> list[str]:
    """Business-logic checks across datasets."""
    errs = []

    def chk(cond, msg):
        if not cond:
            errs.append(msg)

    rows = lambda k: ds[k]["data"]  # noqa: E731
    # peers
    peers = rows("peers")
    chk(len(peers) == 18 and sum(p["is_target"] for p in peers) == 1, "peers: 18 rows with one target")
    chk({p["sector"] for p in peers} == set(SECTORS) and {p["region"] for p in peers} == set(REGIONS), "peers: 3 sectors x 4 regions")
    for p in peers:
        n = p["ticker"]
        chk(abs(p["ev"] - (p["mkt_cap"] + p["net_debt"])) < 0.051, f"peers {n}: EV != mkt cap + net debt")
        chk(abs(p["ev_ebitda_25e"] - p["ev"] / p["ebitda_25e"]) < 0.006, f"peers {n}: EV/EBITDA 25E")
        chk(abs(p["ev_ebitda_26e"] - p["ev"] / p["ebitda_26e"]) < 0.006, f"peers {n}: EV/EBITDA 26E")
        chk(abs(p["ev_revenue_25e"] - p["ev"] / p["revenue_25e"]) < 0.006, f"peers {n}: EV/Revenue 25E")
        chk(abs(p["net_debt_ebitda"] - p["net_debt"] / p["ebitda_25e"]) < 0.006, f"peers {n}: ND/EBITDA")
        chk(0.08 <= p["ebitda_margin_25e"] <= 0.35, f"peers {n}: margin out of range")
        chk(-0.05 <= p["rev_growth_25e"] <= 0.25, f"peers {n}: growth out of range")
        chk(p["price_52w_low"] <= p["share_price"] <= p["price_52w_high"], f"peers {n}: price outside 52w range")
        chk(p["mkt_cap"] > 0 and p["pe_25e"] > 0, f"peers {n}: non-positive mkt cap / PE")
    hlx = next(p for p in peers if p["is_target"])
    chk(hlx["share_price"] == PRICE, "peers: target price")
    # price
    ohlc = rows("price_ohlc")
    for r in ohlc:
        chk(r["low"] <= min(r["open"], r["close"]) and r["high"] >= max(r["open"], r["close"]) and r["volume"] > 0,
            f"price_ohlc {r['date']}: OHLC ordering")
    by_date = {r["date"]: r for r in ohlc}
    chk(by_date[iso(REF_DAY)]["close"] == PRICE and ohlc[-1]["close"] == PRICE, "price_ohlc: current price pinned")
    chk(ohlc[0]["date"] == iso(DAY0) and ohlc[-1]["date"] == iso(DAY_END), "price_ohlc: date span")
    dates = [r["date"] for r in ohlc]
    for e in rows("price_events"):
        i = dates.index(e["date"]) if e["date"] in dates else -1
        chk(i > 0, f"price_events {e['date']}: not a trading day")
        if i > 0:
            mv = abs(ohlc[i]["close"] / ohlc[i - 1]["close"] - 1)
            chk(mv > 0.009, f"price_events {e['date']}: no visible move ({mv:.3%})")
    chk(8 <= len(rows("price_events")) <= 12, "price_events: 8-12 events")
    perf = rows("price_perf")
    first = [r for r in perf if r["date"] == iso(DAY0)]
    chk(len(first) == 4 and all(r["value"] == 100.0 for r in first), "price_perf: rebased to 100")
    # financial identities
    fin = {r["fiscal_year"]: r for r in rows("financials")}
    for y in range(2021, 2027):
        tot = sum(r["revenue"] for r in rows("segment_revenue") if r["year"] == ylabel(y))
        chk(abs(tot - fin[y]["revenue"]) < 0.05, f"segment_revenue {y}: {tot} != {fin[y]['revenue']}")
    q = rows("quarterly")
    for y in (2024, 2025):
        sfx = str(y)[2:]
        chk(abs(sum(r["revenue"] for r in q if r["quarter"].endswith(sfx)) - fin[y]["revenue"]) < 0.05, f"quarterly {y} revenue")
        chk(abs(sum(r["ebitda"] for r in q if r["quarter"].endswith(sfx)) - fin[y]["ebitda"]) < 0.05, f"quarterly {y} EBITDA")
    for r in rows("scenarios"):
        if r["scenario"] == "Base" and r["year"] in ("2025A", "2026E", "2027E", "2028E"):
            f = fin[int(r["year"][:4])]
            chk(r["revenue"] == f["revenue"] and r["ebitda"] == f["ebitda"] and r["fcf"] == f["fcf"], f"scenarios Base {r['year']}")
    # geography
    seg25 = {rg: sum(r["revenue"] for r in rows("segment_revenue") if r["year"] == "2025A" and r["region"] == rg) for rg in REGIONS}
    for rg in REGIONS:
        tot = sum(r["revenue"] for r in rows("revenue_by_country") if r["region"] == rg)
        chk(abs(tot - seg25[rg]) < 0.05, f"revenue_by_country {rg}: {tot} != {seg25[rg]}")
    china = next(r["revenue"] for r in rows("revenue_by_country") if r["iso3"] == "CHN")
    prov = rows("china_provinces")
    chk(abs(sum(r["revenue"] for r in prov) - china) < 0.05, "china_provinces: sum != China revenue")
    chk(len(prov) == 34 and len({r["adcode"] for r in prov}) == 34 and all(re.fullmatch(r"\d{6}", r["adcode"]) for r in prov),
        "china_provinces: 34 unique 6-digit adcodes")
    if WORLD_ATLAS.exists():
        atlas = json.loads(WORLD_ATLAS.read_text(encoding="utf-8"))
        ids = {g.get("id") for g in atlas["objects"]["countries"]["geometries"]}
        for r in rows("revenue_by_country"):
            chk(r["iso_num"] in ids, f"revenue_by_country {r['iso3']}: iso_num {r['iso_num']} not in world-atlas")
    # bridges / flows / trees
    eb = rows("ebitda_bridge")
    chk(abs(eb[0]["value"] + sum(r["value"] for r in eb if r["kind"] == "delta") - eb[-1]["value"]) < 0.05, "ebitda_bridge: does not sum")
    chk(eb[0]["value"] == fin[2025]["ebitda"] and eb[-1]["value"] == fin[2026]["ebitda"], "ebitda_bridge: endpoints")
    vb = rows("ev_equity_bridge")
    chk(abs(vb[0]["value"] + sum(r["value"] for r in vb if r["kind"] == "delta") - vb[-1]["value"]) < 0.05, "ev_equity_bridge: does not sum")
    chk(abs(vb[-1]["value"] / SHARES - next(r["value"] for r in rows("sensitivity_dcf") if (r["wacc"], r["tgr"]) == DCF_BASE)) < 0.01,
        "ev_equity_bridge: per-share != DCF base")
    flow = rows("pnl_flow")
    nodes = {n for r in flow for n in (r["source"], r["target"])}
    for n in nodes:
        inflow = sum(r["value"] for r in flow if r["target"] == n)
        outflow = sum(r["value"] for r in flow if r["source"] == n)
        if inflow and outflow:
            chk(abs(inflow - outflow) < 0.05, f"pnl_flow {n}: in {inflow} != out {outflow}")
    chk(abs(sum(r["value"] for r in flow if r["target"] == "Revenue") - fin[2025]["revenue"]) < 0.05, "pnl_flow: revenue")
    tree = rows("segments_tree")
    for t in tree:
        kids = [c["value"] for c in tree if c["parent"] == t["id"]]
        if kids:
            chk(abs(sum(kids) - t["value"]) < 0.05, f"segments_tree {t['id']}: children do not sum")
    chk(sum(1 for t in tree if t["parent"] == "") == 1, "segments_tree: single root")
    org = rows("org_structure")
    oid = {o["id"] for o in org}
    chk(all(o["parent"] in oid or o["parent"] == "" for o in org), "org_structure: dangling parent")
    nid = {n["id"] for n in rows("network_nodes")}
    chk(all(e["source"] in nid and e["target"] in nid for e in rows("network_edges")), "network_edges: dangling node id")
    chk(abs(sum(r["amount"] for r in rows("debt_maturity")) - GROSS_DEBT) < 0.05, "debt_maturity: != gross debt")
    # ib-pitch: sources & uses balance, capitalisation ties to the sources, credentials reuse precedent EVs
    su = rows("sources_uses")
    side = lambda s: sum(r["amount"] for r in su if r["side"] == s)  # noqa: E731
    chk(abs(side("Sources") - side("Uses")) < 0.05, "sources_uses: sources != uses")
    cap = rows("capital_structure")
    chk(abs(sum(r["amount"] for r in cap) - (side("Sources") - CASH)) < 0.05, "capital_structure: != sources excl. cash")
    chk(all(a["multiple_cum"] <= b["multiple_cum"] for a, b in zip(cap, cap[1:])), "capital_structure: multiple_cum not cumulative")
    pev = {p["target"]: p["ev"] for p in rows("precedents")}
    for c in rows("credentials"):
        if c["deal_type"].endswith("M&A") and c["target"] in pev:
            chk(abs(c["deal_value_bn"] - pev[c["target"]] / 1000) < 0.051, f"credentials {c['target']}: value != precedents EV")
    chk(abs(sum(r["pct"] for r in rows("ownership")) - 1) < 0.002, "ownership: pct != 100%")
    # sensitivities
    dcf = {(r["wacc"], r["tgr"]): r["value"] for r in rows("sensitivity_dcf")}
    for i, w in enumerate(DCF_WACC):
        for j, g in enumerate(DCF_TGR):
            if i:
                chk(dcf[(w, g)] < dcf[(DCF_WACC[i - 1], g)], f"sensitivity_dcf not decreasing in WACC at {w},{g}")
            if j:
                chk(dcf[(w, g)] > dcf[(w, DCF_TGR[j - 1])], f"sensitivity_dcf not increasing in TGR at {w},{g}")
    chk(len(dcf) == 35, "sensitivity_dcf: 7x5 grid")
    lbo = {(r["entry_multiple"], r["exit_multiple"]): r["irr"] for r in rows("sensitivity_lbo")}
    for i, en in enumerate(LBO_MULTS):
        for j, ex in enumerate(LBO_MULTS):
            if i:
                chk(lbo[(en, ex)] < lbo[(LBO_MULTS[i - 1], ex)], f"sensitivity_lbo not decreasing in entry at {en},{ex}")
            if j:
                chk(lbo[(en, ex)] > lbo[(en, LBO_MULTS[j - 1])], f"sensitivity_lbo not increasing in exit at {en},{ex}")
    # correlation
    cm = {(r["x"], r["y"]): r["value"] for r in rows("corr_matrix")}
    tick = sorted({x for x, _ in cm})
    chk(len(tick) == 8, "corr_matrix: 8 tickers")
    for a in tick:
        chk(cm[(a, a)] == 1.0, f"corr_matrix: diagonal {a}")
        for b in tick:
            chk(cm[(a, b)] == cm[(b, a)] and -1 <= cm[(a, b)] <= 1, f"corr_matrix: symmetry {a},{b}")
    # valuation
    for v in rows("valuation_ranges"):
        chk(0 < v["low"] < v["high"], f"valuation_ranges {v['method']}: low >= high")
        chk(20 < v["low"] and v["high"] < 80, f"valuation_ranges {v['method']}: implausible")
    chk(any(v["low"] <= PRICE <= v["high"] for v in rows("valuation_ranges")), "valuation_ranges: none straddles price")
    # ib-valuation: SOTP ties to FY26E EBITDA and segment revenue; offer levels ascending with one current / one offer
    so = rows("sotp")
    chk(abs(sum(r["ebitda"] for r in so) - fin[2026]["ebitda"]) < 0.05, "sotp: segment EBITDA + corporate != FY26E EBITDA")
    chk(all(0 < r["multiple_low"] < r["multiple_high"] for r in so), "sotp: multiple_low >= multiple_high")
    for r in so:
        if r["metric_name"].startswith("Revenue"):
            seg = sum(x["revenue"] for x in rows("segment_revenue") if x["year"] == "2026E" and x["segment"] == r["segment"])
            chk(abs(r["metric_value"] - seg) < 0.05, f"sotp {r['segment']}: revenue != segment_revenue 2026E")
        elif r["metric_name"].startswith("EBITDA"):
            chk(r["metric_value"] == r["ebitda"], f"sotp {r['segment']}: metric != EBITDA")
    so_px = [(sum(r["metric_value"] * r[k] for r in so) - NET_DEBT + OTHER_ADJ) / SHARES for k in ("multiple_low", "multiple_high")]
    chk(so_px[0] < PRICE * 1.1 and so_px[1] > PRICE and so_px[1] < 80, f"sotp: implausible per-share range {so_px}")
    op = rows("offer_prices")
    chk([r["price"] for r in op] == sorted(r["price"] for r in op), "offer_prices: not ascending")
    chk(sum(r["kind"] == "current" for r in op) == 1 and sum(r["kind"] == "offer" for r in op) == 1, "offer_prices: one current, one offer")
    chk(next(r["price"] for r in op if r["kind"] == "current") == PRICE, "offer_prices: current != PRICE")
    for k in rows("kpis"):
        chk(len(k["spark"]) == 12 and k["good"] in ("up", "down"), f"kpis {k['id']}: spark/good")
    return errs


def _folder_size(out_dir: Path) -> int:
    return sum(p.stat().st_size for p in (out_dir / "datasets").glob("*.json"))


def check_files(out_dir: Path, datasets: dict) -> list[str]:
    """Round-trip every file on disk and compare with a fresh in-memory build."""
    errs = []
    for k, d in datasets.items():
        p = out_dir / "datasets" / f"{k}.json"
        if not p.exists():
            errs.append(f"{p}: missing")
            continue
        loaded = json.loads(p.read_text(encoding="utf-8"))
        if loaded != json.loads(json.dumps(d, ensure_ascii=False)):
            errs.append(f"{p}: differs from a fresh build (stale? re-run the generator)")
    extra = {p.stem for p in (out_dir / "datasets").glob("*.json")} - set(datasets)
    if extra:
        errs.append(f"unexpected dataset files: {sorted(extra)}")
    idx = json.loads((out_dir / "index.json").read_text(encoding="utf-8"))
    for k, d in datasets.items():
        meta = idx["datasets"].get(k)
        if not meta or meta["rows"] != len(d["data"]) or meta["fields"] != [f["name"] for f in d["schema"]["fields"]]:
            errs.append(f"index.json: entry for {k} out of date")
    size = _folder_size(out_dir)
    if size > MAX_FOLDER_BYTES:
        errs.append(f"datasets folder is {size:,} bytes (> {MAX_FOLDER_BYTES:,})")
    return errs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output folder (default: kit/samples)")
    ap.add_argument("--check", action="store_true", help="validate files on disk instead of writing")
    ap.add_argument("--seed", type=int, default=SEED)
    args = ap.parse_args(argv)
    datasets = generate(args.seed)
    errs = validate(datasets) + check_consistency(datasets)
    if not args.check and not errs:
        write(datasets, args.out)
    if not errs:
        errs = check_files(args.out, datasets)
    if errs:
        for e in errs:
            print("ERROR", e, file=sys.stderr)
        return 1
    rows = sum(len(d["data"]) for d in datasets.values())
    print(f"{'checked' if args.check else 'wrote'} {len(datasets)} datasets, {rows:,} rows, "
          f"{_folder_size(args.out):,} bytes -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
