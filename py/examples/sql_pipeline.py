#!/usr/bin/env python3
"""Raw data in SQL -> Python analysis -> metrics -> ReportKit report folder ("Project Kestrel").

    python3 py/examples/sql_pipeline.py                       # -> examples/sql-pipeline-report/
    python3 py/examples/sql_pipeline.py out/kestrel           # custom output folder
    python3 py/examples/sql_pipeline.py --no-pandas           # force the plain sqlite3 rows / dicts path
    python3 py/examples/sql_pipeline.py --parity              # also run the other path and diff every dataset
    python3 py/examples/sql_pipeline.py --check               # validate only (r.check()), write nothing
    python3 py/examples/sql_pipeline.py --dump-db raw.sqlite  # save the database (raw tables + views)

The four stages map 1:1 to what an analyst does on a deal team:

  1. RAW     an in-memory sqlite3 database with raw tables — companies, daily prices (10 tickers,
             2 years), dividends, annual financials (FY21A–FY27E), precedent transactions and the
             targets' pre-announcement trading — generated deterministically with random.Random(7).
             In real life these tables come from your data warehouse / FactSet / Capital IQ extracts.
  2. SQL     views built with CTEs, window functions and GROUP BY compute the metrics: market cap,
             EV, calendarised LTM / NTM financials and multiples, revenue CAGR, margin deltas, 1-year
             TSR (with dividends), rolling 30-day volatility, deal premiums and peer medians.
  3. PYTHON  pandas (read_sql + reshaping: pivots, melts, quantiles, regression) when installed;
             otherwise the same transformations on plain sqlite3 rows / dicts. Both paths produce
             identical datasets (--parity proves it).
  4. REPORT  reportkit.Report: datasets with field titles / formats / units / sources / notes, a
             what-if param + computed fields, pages and blocks using only the components present
             in kit/components/, validated with r.check() and built into a self-contained folder.

See docs/pipeline-guide.md for the step-by-step guide.
"""
from __future__ import annotations

import argparse
import math
import random
import sqlite3
import statistics
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "py"))

from reportkit import Kit, Report, to_json_value  # noqa: E402

DEFAULT_OUT = ROOT / "examples" / "sql-pipeline-report"

# ----------------------------------------------------------------------------- assumptions
SEED = 7
PRICE_START = date(2024, 10, 14)   # two years of daily closes ...
AS_OF = date(2026, 10, 13)         # ... up to the last trading day before the report date
REPORT_DATE = "2026-10-14"
FY = 2026                          # current fiscal year (December year-ends): FY2026E
LTM_WEIGHT = 0.75                  # last reported quarter is Q3-26 -> 9/12 of FY2026 has elapsed
CAGR_YEARS = 3                     # revenue CAGR / margin change FY22A -> FY25A
PE_NM_MAX = 60.0                   # P/E <= 0x or > 60x is "n.m." (table display and peer statistics)
BASE_PREMIUM = 0.30                # default of the what-if "premium" param
FIRM = "Northbridge Partners · Investment Banking"

SRC_MARKET = "Synthetic market data (sqlite3 pipeline, random.Random(7)); prices to 13-Oct-2026"
SRC_FIN = "Synthetic company financials FY21A–FY27E"
SRC_DEALS = "Synthetic precedent transactions 2019–2026 and pre-announcement trading"
SRC_ANALYSIS = "Northbridge Partners analysis"
FICTIONAL = "Illustrative only: fictional companies and synthetic data."


# =============================================================================
# 1. RAW DATA — deterministic generator (stand-in for your warehouse extracts)
# =============================================================================
@dataclass(frozen=True)
class Co:
    ticker: str
    company: str
    sector: str
    region: str
    target: bool
    ev_ntm: float     # where the stock ends up: EV / NTM EBITDA on AS_OF (anchors the price path)
    ret_2y: float     # log price return over the two years (sets the starting price)
    vol: float        # annual idiosyncratic volatility
    beta: float
    shares: float     # diluted shares, m
    debt: float       # USD m
    cash: float
    minorities: float
    rev0: float       # revenue in the first fiscal year, USD m
    growth: float     # revenue growth p.a.
    margin0: float    # EBITDA margin FY2021
    margin_step: float  # margin change p.a.
    conv: float       # net income / EBITDA
    fixed: float      # below-EBITDA fixed costs (D&A, interest), USD m
    div_yield: float
    first_fy: int = 2021


COMPANIES = [
    #  ticker  company                       sector                 region          target
    #  EV/NTM  ret2y  vol   beta  shares  debt    cash   min   rev0    g      m0     dm     conv  fixed  div
    Co("KSTL", "Kestrel Automation", "Automation", "North America", True,
       9.6, -0.06, 0.27, 1.05, 182.0, 1650.0, 420.0, 35.0, 1900.0, 0.060, 0.160, 0.007, 0.52, 40.0, 0.012),
    Co("ORVX", "Orvanta Controls", "Automation", "Europe", False,
       12.4, 0.22, 0.24, 0.95, 140.0, 1900.0, 610.0, 60.0, 2600.0, 0.070, 0.190, 0.004, 0.55, 30.0, 0.018),
    Co("VDRX", "Vedrix Robotics", "Automation", "North America", False,
       19.5, 0.45, 0.42, 1.35, 260.0, 900.0, 520.0, 0.0, 600.0, 0.200, 0.080, 0.012, 0.50, 120.0, 0.0),
    Co("HLMN", "Halmaren Motion", "Motion Control", "Europe", False,
       10.2, 0.08, 0.23, 0.90, 120.0, 1200.0, 300.0, 20.0, 2100.0, 0.050, 0.170, 0.003, 0.55, 20.0, 0.025),
    Co("TRVD", "Torvald Drives", "Motion Control", "Asia Pacific", False,
       8.9, 0.02, 0.28, 1.10, 210.0, 800.0, 450.0, 45.0, 2900.0, 0.055, 0.140, 0.002, 0.50, 10.0, 0.020),
    Co("PRSN", "Prisane Sensing", "Sensors & Vision", "North America", False,
       14.8, 0.30, 0.29, 1.15, 95.0, 1100.0, 380.0, 0.0, 1500.0, 0.110, 0.240, 0.004, 0.60, 15.0, 0.008),
    Co("LMNO", "Lumeno Optics", "Sensors & Vision", "Asia Pacific", False,
       13.1, 0.18, 0.33, 1.20, 150.0, 500.0, 600.0, 30.0, 1200.0, 0.090, 0.210, 0.005, 0.58, 10.0, 0.0),
    Co("BRKW", "Brookwick Instruments", "Sensors & Vision", "Europe", False,
       11.0, 0.05, 0.21, 0.85, 110.0, 950.0, 260.0, 15.0, 1800.0, 0.045, 0.200, 0.002, 0.57, 25.0, 0.022),
    Co("CRDW", "Cardwell Software", "Industrial Software", "North America", False,   # listed 2023:
       21.0, 0.35, 0.31, 1.25, 80.0, 600.0, 900.0, 0.0, 950.0, 0.160, 0.290, 0.010, 0.65, 0.0, 0.0, 2023),
    Co("NXRY", "Nexory Industrial Software", "Industrial Software", "Europe", False,
       17.5, 0.25, 0.26, 1.10, 105.0, 700.0, 350.0, 10.0, 1100.0, 0.120, 0.280, 0.006, 0.62, 5.0, 0.010),
]

# deal_id, announced, target, acquirer, sector, acquirer type, consideration
DEALS = [
    ("D01", "2019-06-17", "Arvane Systems", "Orvanta Controls", "Automation", "Strategic", "Cash"),
    ("D02", "2019-11-04", "Bellcrest Motion", "Saltmarsh Capital", "Motion Control", "Sponsor", "Cash"),
    ("D03", "2020-09-21", "Corwen Vision", "Prisane Sensing", "Sensors & Vision", "Strategic", "Cash & stock"),
    ("D04", "2021-03-08", "Dunmore Drives", "Torvald Drives", "Motion Control", "Strategic", "Stock"),
    ("D05", "2021-07-26", "Elstree Robotics", "Highmoor Partners", "Automation", "Sponsor", "Cash"),
    ("D06", "2022-01-18", "Fenmoor Instruments", "Brookwick Instruments", "Sensors & Vision", "Strategic", "Cash"),
    ("D07", "2022-05-23", "Glenhaven Software", "Nexory Industrial Software", "Industrial Software", "Strategic",
     "Cash & stock"),
    ("D08", "2022-10-10", "Harwell Controls", "Saltmarsh Capital", "Automation", "Sponsor", "Cash"),
    ("D09", "2023-04-03", "Ivers Optics", "Lumeno Optics", "Sensors & Vision", "Strategic", "Stock"),
    ("D10", "2023-09-11", "Jessop Automation", "Orvanta Controls", "Automation", "Strategic", "Cash"),
    ("D11", "2024-02-26", "Kelbourne Motion Systems", "Ashgrove Equity", "Motion Control", "Sponsor", "Cash"),
    ("D12", "2024-08-19", "Larkspur Software", "Cardwell Software", "Industrial Software", "Strategic",
     "Cash & stock"),
    ("D13", "2025-05-12", "Merrin Robotics", "Vedrix Robotics", "Automation", "Strategic", "Cash"),
    ("D14", "2026-03-30", "Nethercott Sensing", "Highmoor Partners", "Sensors & Vision", "Sponsor", "Cash"),
]
UNDISCLOSED_EBITDA = {"D10"}   # target EBITDA not disclosed -> NULL -> "n.a." in the report

SCHEMA = """
CREATE TABLE companies (
    ticker      TEXT PRIMARY KEY,
    company     TEXT NOT NULL,
    sector      TEXT NOT NULL,
    region      TEXT NOT NULL,
    is_target   INTEGER NOT NULL DEFAULT 0,      -- SQLite has no BOOLEAN: 0 / 1
    shares_out  REAL NOT NULL,                   -- diluted shares, m
    total_debt  REAL NOT NULL,                   -- USD m, latest balance sheet
    cash        REAL NOT NULL,
    minorities  REAL NOT NULL
);
CREATE TABLE prices (
    ticker TEXT NOT NULL REFERENCES companies(ticker),
    date   TEXT NOT NULL,                        -- ISO 'YYYY-MM-DD' sorts and compares correctly
    close  REAL NOT NULL,
    volume INTEGER NOT NULL,
    PRIMARY KEY (ticker, date)
);
CREATE TABLE dividends (
    ticker  TEXT NOT NULL REFERENCES companies(ticker),
    ex_date TEXT NOT NULL,
    amount  REAL NOT NULL                        -- USD per share
);
CREATE TABLE financials (
    ticker      TEXT NOT NULL REFERENCES companies(ticker),
    fiscal_year INTEGER NOT NULL,
    period      TEXT NOT NULL CHECK (period IN ('A', 'E')),   -- actual / consensus estimate
    revenue     REAL NOT NULL,
    ebitda      REAL NOT NULL,
    net_income  REAL NOT NULL,
    PRIMARY KEY (ticker, fiscal_year)
);
CREATE TABLE transactions (
    deal_id            TEXT PRIMARY KEY,
    announced          TEXT NOT NULL,
    target             TEXT NOT NULL,
    acquirer           TEXT NOT NULL,
    sector             TEXT NOT NULL,
    acquirer_type      TEXT NOT NULL,
    consideration      TEXT NOT NULL,
    offer_price        REAL NOT NULL,            -- USD per share
    target_shares      REAL NOT NULL,            -- m
    target_net_debt    REAL NOT NULL,            -- USD m
    target_ltm_revenue REAL,
    target_ltm_ebitda  REAL                      -- NULL = not disclosed
);
CREATE TABLE deal_prices (                       -- target's undisturbed trading before announcement
    deal_id TEXT NOT NULL REFERENCES transactions(deal_id),
    date    TEXT NOT NULL,
    close   REAL NOT NULL,
    volume  INTEGER NOT NULL,
    PRIMARY KEY (deal_id, date)
);
CREATE TABLE settings (                          -- one row of assumptions; views CROSS JOIN it
    as_of       TEXT NOT NULL,                   -- (views cannot take bind parameters)
    fy          INTEGER NOT NULL,
    ltm_weight  REAL NOT NULL,
    cagr_years  INTEGER NOT NULL,
    pe_nm_max   REAL NOT NULL
);
"""


def business_days(start: date, end: date) -> list[date]:
    out, d = [], start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def generate_raw(conn: sqlite3.Connection, seed: int = SEED) -> None:
    """Create and fill the raw tables. Same seed -> same database, row for row."""
    rng = random.Random(seed)
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO settings VALUES (?, ?, ?, ?, ?)",
                 (AS_OF.isoformat(), FY, LTM_WEIGHT, CAGR_YEARS, PE_NM_MAX))

    days = business_days(PRICE_START, AS_OF)
    sell_off = (date(2025, 3, 31), date(2025, 4, 21))     # a market shock, then a recovery
    stress = (date(2025, 3, 31), date(2025, 5, 23))

    def in_(d: date, window: tuple[date, date]) -> bool:
        return window[0] <= d <= window[1]

    market = []
    for d in days:
        mu = -0.0028 if in_(d, sell_off) else (0.0022 if in_(d, stress) else 0.00035)
        market.append(rng.gauss(mu, 0.009 * (2.4 if in_(d, stress) else 1.0)))

    for c in COMPANIES:
        conn.execute("INSERT INTO companies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (c.ticker, c.company, c.sector, c.region, int(c.target), c.shares, c.debt, c.cash,
                      c.minorities))

        # annual financials (actuals to FY25A, consensus estimates FY26E-FY27E)
        fin, rev = {}, c.rev0
        for fy in range(c.first_fy, FY + 2):
            if fy > c.first_fy:
                rev *= 1 + c.growth + rng.gauss(0, 0.02)
            margin = c.margin0 + c.margin_step * (fy - 2021) + rng.gauss(0, 0.005)
            fin[fy] = (round(rev, 1), round(rev * margin, 1), round(rev * margin * c.conv - c.fixed, 1))
            conn.execute("INSERT INTO financials VALUES (?, ?, ?, ?, ?, ?)",
                         (c.ticker, fy, "A" if fy < FY else "E", *fin[fy]))

        # daily closes: market factor x beta + idiosyncratic shocks, bridged so the path ends at the
        # price implied by c.ev_ntm and starts c.ret_2y below it (keeps the synthetic multiples sane)
        ntm_ebitda = (1 - LTM_WEIGHT) * fin[FY][1] + LTM_WEIGHT * fin[FY + 1][1]
        log_end = math.log((c.ev_ntm * ntm_ebitda - c.debt - c.minorities + c.cash) / c.shares)
        log_start = log_end - c.ret_2y
        x, walk = 0.0, [0.0]
        for d, m in zip(days[1:], market[1:]):
            shock = 1.6 if in_(d, stress) else 1.0
            x += c.beta * m + rng.gauss(0, c.vol / math.sqrt(252) * shock)
            walk.append(x)
        n, rows = len(walk) - 1, []
        base_volume = c.shares * 1e6 * 0.004
        for i, (d, xi) in enumerate(zip(days, walk)):
            log_p = log_start + xi + (i / n) * (log_end - log_start - walk[-1])
            shock = 1.6 if in_(d, stress) else 1.0
            volume = int(base_volume * rng.lognormvariate(0, 0.35) * shock)
            rows.append((c.ticker, d.isoformat(), round(math.exp(log_p), 2), volume))
        conn.executemany("INSERT INTO prices VALUES (?, ?, ?, ?)", rows)

        if c.div_yield:   # quarterly dividends, ex-date on the first trading day on/after the 15th
            close_on = {r[1]: r[2] for r in rows}
            for y in (2024, 2025, 2026):
                for mth in (2, 5, 8, 11):
                    ex = date(y, mth, 15)
                    while ex.weekday() >= 5:
                        ex += timedelta(days=1)
                    if PRICE_START < ex <= AS_OF:
                        amount = round(close_on[ex.isoformat()] * c.div_yield / 4, 2)
                        conn.execute("INSERT INTO dividends VALUES (?, ?, ?)", (c.ticker, ex.isoformat(), amount))

    for deal_id, announced, target, acquirer, sector, buyer_type, consideration in DEALS:
        ann = date.fromisoformat(announced)
        pre = business_days(ann - timedelta(days=95), ann - timedelta(days=1))[-60:]
        p, vol = rng.uniform(18, 75), rng.uniform(0.22, 0.38)
        run_up = rng.random() < 0.35            # some deals leak: the stock drifts up before the news
        volume0 = rng.uniform(0.3, 1.5) * 1e6
        for i, d in enumerate(pre):
            mu = 0.012 if run_up and i >= len(pre) - 6 else 0.0
            p *= math.exp(rng.gauss(mu, vol / math.sqrt(252)))
            conn.execute("INSERT INTO deal_prices VALUES (?, ?, ?, ?)",
                         (deal_id, d.isoformat(), round(p, 2), int(volume0 * rng.lognormvariate(0, 0.3))))
        unaffected = round(p, 2)
        offer = round(unaffected * (1 + rng.uniform(0.17, 0.48)), 2)
        shares = round(rng.uniform(30, 220), 1)
        net_debt = round(offer * shares * rng.uniform(-0.05, 0.35), 1)
        ev = offer * shares + net_debt
        multiple = rng.uniform(9.0, 14.5) + (2.0 if sector == "Industrial Software" else 0.0)
        ebitda = round(ev / multiple, 1)
        revenue = round(ebitda / rng.uniform(0.13, 0.27), 1)
        conn.execute("INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (deal_id, announced, target, acquirer, sector, buyer_type, consideration, offer, shares,
                      net_debt, revenue, None if deal_id in UNDISCLOSED_EBITDA else ebitda))
    conn.commit()


# =============================================================================
# 2. SQL — metrics as views (CTEs, window functions, GROUP BY)
# =============================================================================
VIEWS = """
-- Market data: latest close, 52-week range, 30-day VWAP, market cap and EV ----------------------
CREATE VIEW v_market AS
WITH ranked AS (
    SELECT p.ticker, p.date, p.close, p.volume,
           ROW_NUMBER() OVER (PARTITION BY p.ticker ORDER BY p.date DESC) AS rn      -- 1 = latest
    FROM prices p CROSS JOIN settings s
    WHERE p.date <= s.as_of
),
latest AS (SELECT ticker, date AS price_date, close AS price FROM ranked WHERE rn = 1),
range_52w AS (
    SELECT r.ticker, MAX(r.close) AS high_52w, MIN(r.close) AS low_52w
    FROM ranked r JOIN latest l ON l.ticker = r.ticker
    WHERE r.date > date(l.price_date, '-1 year')
    GROUP BY r.ticker
),
vwap AS (
    SELECT ticker, SUM(close * volume) / SUM(volume) AS vwap_30d
    FROM ranked WHERE rn <= 30
    GROUP BY ticker
)
SELECT c.ticker, c.company, c.sector, c.region, c.is_target,
       l.price_date, l.price, h.high_52w, h.low_52w, v.vwap_30d,
       c.shares_out, c.total_debt, c.cash, c.minorities,
       l.price * c.shares_out                                          AS mkt_cap,
       c.total_debt - c.cash                                           AS net_debt,
       l.price * c.shares_out + c.total_debt + c.minorities - c.cash   AS ev
FROM companies c
JOIN latest l    ON l.ticker = c.ticker
JOIN range_52w h ON h.ticker = c.ticker
JOIN vwap v      ON v.ticker = c.ticker;

-- Fundamentals: calendarised LTM / NTM, revenue CAGR, EBITDA margin change -----------------------
--   LTM Sep-26 = 25% x FY25A + 75% x FY26E ;  NTM = 25% x FY26E + 75% x FY27E   (ltm_weight = 0.75)
CREATE VIEW v_fundamentals AS
WITH pivot AS (                       -- conditional aggregation: the fiscal years we need side by side
    SELECT f.ticker,
           MAX(CASE WHEN f.fiscal_year = s.fy - 1 - s.cagr_years THEN f.revenue END) AS rev_base,
           MAX(CASE WHEN f.fiscal_year = s.fy - 1 THEN f.revenue    END) AS rev_last,
           MAX(CASE WHEN f.fiscal_year = s.fy     THEN f.revenue    END) AS rev_cur,
           MAX(CASE WHEN f.fiscal_year = s.fy + 1 THEN f.revenue    END) AS rev_next,
           MAX(CASE WHEN f.fiscal_year = s.fy - 1 THEN f.ebitda     END) AS ebitda_last,
           MAX(CASE WHEN f.fiscal_year = s.fy     THEN f.ebitda     END) AS ebitda_cur,
           MAX(CASE WHEN f.fiscal_year = s.fy + 1 THEN f.ebitda     END) AS ebitda_next,
           MAX(CASE WHEN f.fiscal_year = s.fy - 1 THEN f.net_income END) AS ni_last,
           MAX(CASE WHEN f.fiscal_year = s.fy     THEN f.net_income END) AS ni_cur,
           MAX(CASE WHEN f.fiscal_year = s.fy + 1 THEN f.net_income END) AS ni_next
    FROM financials f CROSS JOIN settings s
    GROUP BY f.ticker
),
margins AS (                          -- LAG over fiscal years; guard against gaps in the history
    SELECT ticker, fiscal_year,
           ebitda / revenue                                                    AS margin,
           LAG(fiscal_year, 3)     OVER (PARTITION BY ticker ORDER BY fiscal_year) AS base_year,
           LAG(ebitda / revenue, 3) OVER (PARTITION BY ticker ORDER BY fiscal_year) AS base_margin
    FROM financials
)
SELECT p.ticker,
       (1 - s.ltm_weight) * p.rev_last    + s.ltm_weight * p.rev_cur      AS ltm_revenue,
       (1 - s.ltm_weight) * p.ebitda_last + s.ltm_weight * p.ebitda_cur   AS ltm_ebitda,
       (1 - s.ltm_weight) * p.ni_last     + s.ltm_weight * p.ni_cur       AS ltm_net_income,
       (1 - s.ltm_weight) * p.rev_cur     + s.ltm_weight * p.rev_next     AS ntm_revenue,
       (1 - s.ltm_weight) * p.ebitda_cur  + s.ltm_weight * p.ebitda_next  AS ntm_ebitda,
       (1 - s.ltm_weight) * p.ni_cur      + s.ltm_weight * p.ni_next      AS ntm_net_income,
       power(p.rev_last / p.rev_base, 1.0 / s.cagr_years) - 1             AS rev_cagr,  -- NULL if no base year
       CASE WHEN m.base_year = m.fiscal_year - s.cagr_years
            THEN (m.margin - m.base_margin) * 10000 END                   AS margin_delta_bps
FROM pivot p
CROSS JOIN settings s
LEFT JOIN margins m ON m.ticker = p.ticker AND m.fiscal_year = s.fy - 1;

-- Rolling 30-day volatility (annualised, sample stdev of daily log returns) ----------------------
CREATE VIEW v_vol AS
WITH r AS (
    SELECT ticker, date, close,
           ln(close / LAG(close) OVER (PARTITION BY ticker ORDER BY date)) AS lr
    FROM prices
),
w AS (
    SELECT ticker, date, close,
           COUNT(lr)    OVER win AS n,
           AVG(lr)      OVER win AS mu,
           AVG(lr * lr) OVER win AS m2
    FROM r
    WINDOW win AS (PARTITION BY ticker ORDER BY date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW)
)
SELECT ticker, date, close,
       CASE WHEN n = 30 THEN sqrt(MAX(m2 - mu * mu, 0) * n / (n - 1)) * sqrt(252) END AS vol_30d,
       ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC)                   AS rn_desc
FROM w;

-- 1-year total shareholder return: price change + dividends with ex-date inside the window -------
CREATE VIEW v_tsr AS
WITH ends AS (
    SELECT p.ticker, MAX(p.date) AS d1
    FROM prices p CROSS JOIN settings s WHERE p.date <= s.as_of
    GROUP BY p.ticker
),
starts AS (                           -- last close on or before the same day one year earlier
    SELECT p.ticker, MAX(p.date) AS d0
    FROM prices p JOIN ends e ON e.ticker = p.ticker
    WHERE p.date <= date(e.d1, '-1 year')
    GROUP BY p.ticker
),
divs AS (
    SELECT d.ticker, SUM(d.amount) AS dps_1y
    FROM dividends d
    JOIN starts s ON s.ticker = d.ticker
    JOIN ends e   ON e.ticker = d.ticker
    WHERE d.ex_date > s.d0 AND d.ex_date <= e.d1
    GROUP BY d.ticker
)
SELECT e.ticker, s.d0 AS start_date, e.d1 AS end_date, p0.close AS price_start, p1.close AS price_end,
       COALESCE(dv.dps_1y, 0)                                AS dps_1y,
       (p1.close + COALESCE(dv.dps_1y, 0)) / p0.close - 1    AS tsr_1y
FROM ends e
JOIN starts s  ON s.ticker = e.ticker
JOIN prices p0 ON p0.ticker = s.ticker AND p0.date = s.d0
JOIN prices p1 ON p1.ticker = e.ticker AND p1.date = e.d1
LEFT JOIN divs dv ON dv.ticker = e.ticker;

-- The comps sheet: one row per company, every metric, rounded for delivery ----------------------
CREATE TABLE comps AS
SELECT m.ticker, m.company, m.sector, m.region, m.is_target,
       ROUND(m.price, 2)                                   AS price,
       ROUND(m.high_52w, 2)                                AS high_52w,
       ROUND(m.low_52w, 2)                                 AS low_52w,
       ROUND(m.vwap_30d, 2)                                AS vwap_30d,
       ROUND(m.price / m.high_52w, 6)                      AS pct_52w_high,
       ROUND(m.shares_out, 1)                              AS shares_out,
       ROUND(m.mkt_cap, 1)                                 AS mkt_cap,
       ROUND(m.total_debt, 1)                              AS total_debt,
       ROUND(m.cash, 1)                                    AS cash,
       ROUND(m.minorities, 1)                              AS minorities,
       ROUND(m.net_debt, 1)                                AS net_debt,
       ROUND(m.ev, 1)                                      AS ev,
       ROUND(f.ltm_revenue, 1)                             AS ltm_revenue,
       ROUND(f.ltm_ebitda, 1)                              AS ltm_ebitda,
       ROUND(f.ntm_revenue, 1)                             AS ntm_revenue,
       ROUND(f.ntm_ebitda, 1)                              AS ntm_ebitda,
       ROUND(f.ntm_net_income, 1)                          AS ntm_net_income,
       ROUND(m.ev / f.ltm_ebitda, 6)                       AS ev_ltm_ebitda,
       ROUND(m.ev / f.ntm_ebitda, 6)                       AS ev_ntm_ebitda,
       ROUND(m.ev / f.ntm_revenue, 6)                      AS ev_ntm_revenue,
       ROUND(m.mkt_cap / f.ntm_net_income, 6)              AS pe_ntm,       -- kept as is; n.m. at display
       ROUND(f.rev_cagr, 6)                                AS rev_cagr_3y,
       ROUND(f.ltm_ebitda / f.ltm_revenue, 6)              AS ebitda_margin_ltm,
       ROUND(f.margin_delta_bps, 1)                        AS margin_delta_3y_bps,
       ROUND((f.ntm_ebitda / f.ntm_revenue - f.ltm_ebitda / f.ltm_revenue) * 10000, 1) AS margin_delta_ntm_bps,
       ROUND(t.tsr_1y, 6)                                  AS tsr_1y,
       ROUND(v.vol_30d, 6)                                 AS vol_30d
FROM v_market m
JOIN v_fundamentals f ON f.ticker = m.ticker
JOIN v_tsr t          ON t.ticker = m.ticker
JOIN v_vol v          ON v.ticker = m.ticker AND v.rn_desc = 1
ORDER BY m.is_target DESC, m.sector, m.ev DESC;

-- Peer medians (target excluded) — the classic ROW_NUMBER / COUNT median ------------------------
CREATE VIEW v_peer_stats AS
WITH long AS (
              SELECT 'ev_ltm_ebitda' AS metric, ev_ltm_ebitda AS v FROM comps WHERE is_target = 0
    UNION ALL SELECT 'ev_ntm_ebitda',        ev_ntm_ebitda        FROM comps WHERE is_target = 0
    UNION ALL SELECT 'ev_ntm_revenue',       ev_ntm_revenue       FROM comps WHERE is_target = 0
    UNION ALL SELECT 'pe_ntm',               pe_ntm               FROM comps, settings s
              WHERE is_target = 0 AND pe_ntm > 0 AND pe_ntm <= s.pe_nm_max            -- n.m. excluded
    UNION ALL SELECT 'rev_cagr_3y',          rev_cagr_3y          FROM comps WHERE is_target = 0
    UNION ALL SELECT 'ebitda_margin_ltm',    ebitda_margin_ltm    FROM comps WHERE is_target = 0
    UNION ALL SELECT 'margin_delta_3y_bps',  margin_delta_3y_bps  FROM comps WHERE is_target = 0
    UNION ALL SELECT 'tsr_1y',               tsr_1y               FROM comps WHERE is_target = 0
    UNION ALL SELECT 'vol_30d',              vol_30d              FROM comps WHERE is_target = 0
),
ranked AS (
    SELECT metric, v,
           ROW_NUMBER() OVER (PARTITION BY metric ORDER BY v) AS k,
           COUNT(*)     OVER (PARTITION BY metric)             AS n
    FROM long WHERE v IS NOT NULL
)
SELECT metric,
       AVG(CASE WHEN k IN ((n + 1) / 2, (n + 2) / 2) THEN v END) AS median,
       MIN(v) AS low, MAX(v) AS high, MAX(n) AS n
FROM ranked
GROUP BY metric;

-- Precedent transactions: deal EV, multiples, 1-day and 30-day VWAP premiums ---------------------
CREATE VIEW v_deals AS
WITH pre AS (
    SELECT dp.deal_id, dp.close, dp.volume,
           ROW_NUMBER() OVER (PARTITION BY dp.deal_id ORDER BY dp.date DESC) AS k   -- 1 = unaffected day
    FROM deal_prices dp JOIN transactions t ON t.deal_id = dp.deal_id
    WHERE dp.date < t.announced
),
ref AS (
    SELECT deal_id,
           MAX(CASE WHEN k = 1 THEN close END)                                           AS unaffected_price,
           SUM(CASE WHEN k <= 30 THEN close * volume END) / SUM(CASE WHEN k <= 30 THEN volume END) AS vwap_30d
    FROM pre
    GROUP BY deal_id
)
SELECT t.deal_id, t.announced, t.target, t.acquirer, t.sector, t.acquirer_type, t.consideration,
       t.offer_price,
       ROUND(r.unaffected_price, 2)                                               AS unaffected_price,
       ROUND(r.vwap_30d, 2)                                                       AS vwap_30d,
       ROUND(t.offer_price * t.target_shares, 1)                                  AS equity_value,
       ROUND(t.offer_price * t.target_shares + t.target_net_debt, 1)              AS deal_ev,
       ROUND((t.offer_price * t.target_shares + t.target_net_debt) / t.target_ltm_revenue, 6) AS ev_ltm_revenue,
       ROUND((t.offer_price * t.target_shares + t.target_net_debt) / t.target_ltm_ebitda, 6)  AS ev_ltm_ebitda,
       ROUND(t.offer_price / r.unaffected_price - 1, 6)                           AS premium_1d,
       ROUND(t.offer_price / r.vwap_30d - 1, 6)                                   AS premium_30d_vwap
FROM transactions t
LEFT JOIN ref r ON r.deal_id = t.deal_id;
"""

SQL_COMPS = "SELECT * FROM comps"
SQL_PEER_STATS = "SELECT metric, median, low, high, n FROM v_peer_stats ORDER BY metric"
SQL_DEALS = "SELECT * FROM v_deals ORDER BY announced DESC"
SQL_MIX = """
SELECT consideration, COUNT(*) AS deals, ROUND(SUM(deal_ev), 1) AS deal_value
FROM v_deals
GROUP BY consideration
ORDER BY deal_value DESC
"""
# Weekly sample (last trading day of each week since the start) of the rebased price index and the
# rolling volatility — 2 x 105 points per company instead of 2 x 522: pre-aggregate for the browser.
SQL_WEEKLY = """
WITH start AS (SELECT MIN(date) AS d0 FROM prices),
wk AS (
    SELECT v.ticker, v.date, v.close, v.vol_30d,
           ROW_NUMBER() OVER (
               PARTITION BY v.ticker, CAST((julianday(v.date) - julianday(s.d0)) / 7 AS INTEGER)
               ORDER BY v.date DESC) AS k
    FROM v_vol v CROSS JOIN start s
),
base AS (SELECT p.ticker, p.close AS close0 FROM prices p JOIN start s ON p.date = s.d0)
SELECT w.date, w.ticker, c.is_target,
       ROUND(100.0 * w.close / b.close0, 4) AS perf_index,
       ROUND(w.vol_30d, 6)                  AS vol_30d
FROM wk w
JOIN base b      ON b.ticker = w.ticker
JOIN companies c ON c.ticker = w.ticker
WHERE w.k = 1
ORDER BY w.date, w.ticker
"""


def ensure_math_functions(conn: sqlite3.Connection) -> None:
    """ln / sqrt / power are built into most SQLite builds (3.35+ with math functions); register
    Python fallbacks where they are missing so the SQL stays portable."""
    try:
        conn.execute("SELECT ln(2.0), sqrt(4.0), power(2.0, 3.0)").fetchone()
        return
    except sqlite3.OperationalError:
        pass

    def guard(fn):
        def wrapped(*args):
            if any(a is None for a in args):
                return None
            try:
                return fn(*args)
            except (ValueError, ZeroDivisionError, OverflowError):
                return None
        return wrapped

    conn.create_function("ln", 1, guard(math.log), deterministic=True)
    conn.create_function("sqrt", 1, guard(math.sqrt), deterministic=True)
    conn.create_function("power", 2, guard(math.pow), deterministic=True)


def create_database(seed: int = SEED) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    ensure_math_functions(conn)
    generate_raw(conn, seed)
    conn.executescript(VIEWS)
    return conn


# =============================================================================
# 3. PYTHON — the same transformations with pandas or with plain rows / dicts
# =============================================================================
@dataclass
class Stats:
    q1: float | None
    median: float | None
    q3: float | None
    n: int


class PandasBackend:
    """read_sql into DataFrames; reshape with pandas."""
    name = "pandas"

    def __init__(self) -> None:
        import pandas as pd
        self.pd = pd

    def read(self, conn, sql, dates=()):
        return self.pd.read_sql_query(sql, conn, parse_dates=list(dates) or None)

    def records(self, t) -> list[dict]:
        return to_json_value(t.to_dict("records"))     # numpy -> Python, NaN -> None, Timestamp -> ISO

    def nrows(self, t) -> int:
        return int(len(t))

    def flag(self, t, *cols):
        """SQLite stores booleans as 0 / 1 -> real booleans (field type "boolean")."""
        return t.assign(**{c: t[c].astype(bool) for c in cols})

    def values(self, t, col, *, peers_only=False, lo=None, hi=None):
        if peers_only:
            t = t[~t["is_target"].astype(bool)]
        s = t[col].dropna()
        if lo is not None:
            s = s[s > lo]
        if hi is not None:
            s = s[s <= hi]
        return s

    def quartiles(self, t, col, **kw) -> Stats:
        s = self.values(t, col, **kw)
        if s.empty:
            return Stats(None, None, None, 0)
        q = s.quantile([0.25, 0.5, 0.75])                # linear interpolation (Excel QUARTILE.INC)
        return Stats(float(q.iloc[0]), float(q.iloc[1]), float(q.iloc[2]), int(s.size))

    def r_squared(self, t, x, y) -> tuple[float | None, int]:
        d = t.loc[~t["is_target"].astype(bool), [x, y]].dropna()
        if len(d) < 3:
            return None, int(len(d))
        return float(d[x].corr(d[y]) ** 2), int(len(d))

    def target_vs_peers(self, t, value, target_name, peer_label="Peer median"):
        """(date, ticker, is_target, value) -> long (date, series, value): the target + the peer median."""
        is_t = t["is_target"].astype(bool)
        target = t[is_t].set_index("date")[value].rename(target_name)
        peers = t[~is_t].groupby("date")[value].median().rename(peer_label)
        wide = self.pd.concat([target, peers], axis=1).sort_index()
        long = wide.reset_index().melt(id_vars="date", var_name="series", value_name=value)
        return long.dropna(subset=[value]).reset_index(drop=True)

    def melt(self, t, id_cols, value_cols, var_name, value_name, labels):
        long = t.melt(id_vars=id_cols, value_vars=value_cols, var_name=var_name, value_name=value_name)
        long[var_name] = long[var_name].map(labels)
        return long.dropna(subset=[value_name]).reset_index(drop=True)   # charts: drop missing points

    def last_values(self, long, series, value, n) -> list[float]:
        return [float(v) for v in long.loc[long["series"] == series, value].tail(n)]


class PlainBackend:
    """No pandas: sqlite3 rows -> list[dict]; the same transformations with the standard library."""
    name = "sqlite3"

    def read(self, conn, sql, dates=()):
        cur = conn.execute(sql)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def records(self, t) -> list[dict]:
        return [dict(r) for r in t]

    def nrows(self, t) -> int:
        return len(t)

    def flag(self, t, *cols):
        return [{**r, **{c: bool(r[c]) for c in cols}} for r in t]

    def values(self, t, col, *, peers_only=False, lo=None, hi=None):
        out = []
        for r in t:
            v = r[col]
            if v is None or (peers_only and r["is_target"]):
                continue
            if (lo is not None and not v > lo) or (hi is not None and not v <= hi):
                continue
            out.append(v)
        return out

    def quartiles(self, t, col, **kw) -> Stats:
        vals = self.values(t, col, **kw)
        if not vals:
            return Stats(None, None, None, 0)
        if len(vals) == 1:
            return Stats(vals[0], vals[0], vals[0], 1)
        q1, med, q3 = statistics.quantiles(vals, n=4, method="inclusive")   # == pandas default
        return Stats(q1, statistics.median(vals), q3, len(vals))

    def r_squared(self, t, x, y) -> tuple[float | None, int]:
        pts = [(r[x], r[y]) for r in t if not r["is_target"] and r[x] is not None and r[y] is not None]
        if len(pts) < 3:
            return None, len(pts)
        return statistics.correlation(*zip(*pts)) ** 2, len(pts)

    def target_vs_peers(self, t, value, target_name, peer_label="Peer median"):
        target: dict[str, Any] = {}
        peers: dict[str, list] = {}
        for r in t:
            if r["is_target"]:
                target[r["date"]] = r[value]
            elif r[value] is not None:
                peers.setdefault(r["date"], []).append(r[value])
            else:
                peers.setdefault(r["date"], [])
        dates = sorted(set(target) | set(peers))
        out = [{"date": d, "series": target_name, value: target.get(d)} for d in dates]
        out += [{"date": d, "series": peer_label, value: statistics.median(peers[d]) if peers.get(d) else None}
                for d in dates]
        return [row for row in out if row[value] is not None]

    def melt(self, t, id_cols, value_cols, var_name, value_name, labels):
        return [{**{c: r[c] for c in id_cols}, var_name: labels[vc], value_name: r[vc]}
                for vc in value_cols for r in t if r[vc] is not None]

    def last_values(self, long, series, value, n) -> list[float]:
        return [r[value] for r in long if r["series"] == series][-n:]


def pick_backend(no_pandas: bool = False):
    if not no_pandas:
        try:
            return PandasBackend()
        except ImportError:
            print("pandas not installed -> using the plain sqlite3 path", file=sys.stderr)
    return PlainBackend()


@dataclass
class Analysis:
    comps: Any            # DataFrame | list[dict] — one row per company
    deals: Any            # precedent transactions
    perf: Any             # long: date, series, perf_index (target vs. peer median)
    vol: Any              # long: date, series, vol_30d
    premiums: Any         # long: target, measure, premium
    mix: Any              # consideration, deals, deal_value
    peer: dict            # SQL peer statistics: metric -> {median, low, high, n}
    facts: dict = field(default_factory=dict)
    rows: dict = field(default_factory=dict)


def analyse(conn: sqlite3.Connection, B) -> Analysis:
    comps = B.flag(B.read(conn, SQL_COMPS), "is_target")
    deals = B.read(conn, SQL_DEALS, dates=["announced"])
    weekly = B.read(conn, SQL_WEEKLY, dates=["date"])
    mix = B.read(conn, SQL_MIX)
    peer = {r["metric"]: r for r in B.records(B.read(conn, SQL_PEER_STATS))}

    target = next(r for r in B.records(comps) if r["is_target"])
    name = target["company"]
    perf = B.target_vs_peers(weekly, "perf_index", name)
    vol = B.target_vs_peers(weekly, "vol_30d", name)
    premiums = B.melt(deals, ["target", "acquirer_type"], ["premium_1d", "premium_30d_vwap"],
                      "measure", "premium", {"premium_1d": "1-day", "premium_30d_vwap": "30-day VWAP"})

    # cross-check: the SQL medians must equal the Python medians on the same filters
    filters = {"pe_ntm": {"lo": 0.0, "hi": PE_NM_MAX}}
    for metric, row in peer.items():
        py = B.quartiles(comps, metric, peers_only=True, **filters.get(metric, {}))
        if py.n != row["n"] or not math.isclose(py.median, row["median"], rel_tol=1e-9, abs_tol=1e-12):
            raise AssertionError(f"peer median mismatch for {metric}: SQL {row['median']} vs {B.name} {py.median}")

    facts = {
        "target": target,
        "ev_ntm": B.quartiles(comps, "ev_ntm_ebitda", peers_only=True),
        "ev_ltm": B.quartiles(comps, "ev_ltm_ebitda", peers_only=True),
        "pe": B.quartiles(comps, "pe_ntm", peers_only=True, lo=0.0, hi=PE_NM_MAX),
        "deal_ev_ltm": B.quartiles(deals, "ev_ltm_ebitda"),
        "deal_prem_1d": B.quartiles(deals, "premium_1d"),
        "deal_prem_30d": B.quartiles(deals, "premium_30d_vwap"),
        "r2": B.r_squared(comps, "rev_cagr_3y", "ev_ntm_ebitda"),
        "spark_price": B.last_values(perf, name, "perf_index", 26),
        "spark_vol": B.last_values(vol, name, "vol_30d", 26),
        "n_deals": B.nrows(deals),
        "n_prices": conn.execute("SELECT COUNT(*) FROM prices").fetchone()[0],
        "n_deal_prices": conn.execute("SELECT COUNT(*) FROM deal_prices").fetchone()[0],
        "n_financials": conn.execute("SELECT COUNT(*) FROM financials").fetchone()[0],
        "n_dividends": conn.execute("SELECT COUNT(*) FROM dividends").fetchone()[0],
        "deal_years": conn.execute("SELECT MIN(substr(announced, 1, 4)), MAX(substr(announced, 1, 4)) "
                                   "FROM transactions").fetchone(),
    }
    comps_rows = B.records(comps)
    deal_rows = B.records(deals)
    rows = {
        "no_cagr": [r["company"] for r in comps_rows if r["rev_cagr_3y"] is None],
        "pe_nm": [r["company"] for r in comps_rows
                  if r["pe_ntm"] is not None and not 0 < r["pe_ntm"] <= PE_NM_MAX],
        "undisclosed": [r["target"] for r in deal_rows if r["ev_ltm_ebitda"] is None],
    }
    return Analysis(comps=comps, deals=deals, perf=perf, vol=vol, premiums=premiums, mix=mix, peer=peer,
                    facts=facts, rows=rows)


# =============================================================================
# 4. REPORT — datasets, params, computed fields, pages and blocks
# =============================================================================
USD_M = "$#,##0"
USD_PS = "$#,##0.00"
MULT = "0.0x"
PCT = "0.0%"
DPCT = "+0.0%;-0.0%;0.0%"
BPS = '+#,##0" bps";-#,##0" bps";0" bps"'

COMPS_FIELDS = {
    "ticker": "Ticker", "company": "Company", "sector": "Sector", "region": "Region",
    "is_target": "Target",
    "price": {"title": "Share price", "format": USD_PS, "unit": "USD"},
    "high_52w": {"title": "52-week high", "format": USD_PS, "unit": "USD"},
    "low_52w": {"title": "52-week low", "format": USD_PS, "unit": "USD"},
    "vwap_30d": {"title": "30-day VWAP", "format": USD_PS, "unit": "USD"},
    "pct_52w_high": {"title": "% of 52-week high", "format": "0%"},
    "shares_out": {"title": "Diluted shares", "format": "#,##0.0", "unit": "m"},
    "mkt_cap": {"title": "Market cap", "format": USD_M, "unit": "USD m"},
    "total_debt": {"title": "Total debt", "format": USD_M, "unit": "USD m"},
    "cash": {"title": "Cash", "format": USD_M, "unit": "USD m"},
    "minorities": {"title": "Minorities", "format": USD_M, "unit": "USD m"},
    "net_debt": {"title": "Net debt", "format": USD_M, "unit": "USD m"},
    "ev": {"title": "Enterprise value", "format": USD_M, "unit": "USD m"},
    "ltm_revenue": {"title": "Revenue LTM", "format": USD_M, "unit": "USD m"},
    "ltm_ebitda": {"title": "EBITDA LTM", "format": USD_M, "unit": "USD m"},
    "ntm_revenue": {"title": "Revenue NTM", "format": USD_M, "unit": "USD m"},
    "ntm_ebitda": {"title": "EBITDA NTM", "format": USD_M, "unit": "USD m"},
    "ntm_net_income": {"title": "Net income NTM", "format": USD_M, "unit": "USD m"},
    "ev_ltm_ebitda": {"title": "EV / EBITDA LTM", "format": MULT},
    "ev_ntm_ebitda": {"title": "EV / EBITDA NTM", "format": MULT},
    "ev_ntm_revenue": {"title": "EV / Revenue NTM", "format": MULT},
    "pe_ntm": {"title": "P / E NTM", "format": MULT},
    "rev_cagr_3y": {"title": "Revenue CAGR FY22A–25A", "format": PCT},
    "ebitda_margin_ltm": {"title": "EBITDA margin LTM", "format": PCT},
    "margin_delta_3y_bps": {"title": "Δ EBITDA margin FY22A–25A", "format": BPS},
    "margin_delta_ntm_bps": {"title": "Δ EBITDA margin NTM vs. LTM", "format": BPS},
    "tsr_1y": {"title": "1-year TSR", "format": DPCT},
    "vol_30d": {"title": "30-day volatility (ann.)", "format": PCT},
}

DEAL_FIELDS = {
    "deal_id": "Deal", "announced": {"title": "Announced", "format": "mmm yyyy"},
    "target": "Target", "acquirer": "Acquirer", "sector": "Sector", "acquirer_type": "Acquirer type",
    "consideration": "Consideration",
    "offer_price": {"title": "Offer price", "format": USD_PS, "unit": "USD"},
    "unaffected_price": {"title": "Unaffected price", "format": USD_PS, "unit": "USD"},
    "vwap_30d": {"title": "30-day VWAP", "format": USD_PS, "unit": "USD"},
    "equity_value": {"title": "Equity value", "format": USD_M, "unit": "USD m"},
    "deal_ev": {"title": "Deal EV", "format": USD_M, "unit": "USD m"},
    "ev_ltm_revenue": {"title": "EV / Revenue LTM", "format": MULT},
    "ev_ltm_ebitda": {"title": "EV / EBITDA LTM", "format": MULT},
    "premium_1d": {"title": "Premium 1-day", "format": PCT},
    "premium_30d_vwap": {"title": "Premium 30-day VWAP", "format": PCT},
}

DEFINITIONS = f"""**One in-memory SQLite database, six SQL views and one staging table, one Python step.** \
SQL objects are in *italics*; run the script with --dump-db to open them in any SQL client.

- **Market cap / EV** — latest close × diluted shares; EV = market cap + total debt + minorities − cash \
(*v_market*, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC)).
- **LTM / NTM** — calendarised to the last reported quarter (Q3-26): LTM = 25% FY25A + 75% FY26E, \
NTM = 25% FY26E + 75% FY27E (*v_fundamentals*, conditional aggregation).
- **Revenue CAGR / margin change** — FY22A → FY25A; LAG(…, 3) is guarded so a gap in the history \
returns NULL, never a wrong base year.
- **1-year TSR** — (close today + dividends with an ex-date in the window) / close one year earlier − 1 (*v_tsr*).
- **30-day volatility** — sample standard deviation of daily log returns over a 30-row window × √252 \
(*v_vol*, AVG(…) OVER (ROWS BETWEEN 29 PRECEDING AND CURRENT ROW)).
- **Premiums** — offer price vs. the last undisturbed close (1-day) and the 30-day VWAP before the \
announcement (*v_deals*).
- **Peer medians** — target excluded; P / E ≤ 0x or > {PE_NM_MAX:.0f}x is n.m. and excluded \
(*v_peer_stats*, ROW_NUMBER / COUNT median, cross-checked against the Python median).
- **Ranges** — football-field ranges apply the peer / deal interquartile range (25th–75th percentile, \
linear interpolation) to the target's own EBITDA, EPS and share price."""


def _x(v: float | None) -> str:
    return "n.a." if v is None else f"{v:.1f}x"


def _pct(v: float | None, d: int = 1, sign: bool = False) -> str:
    if v is None:
        return "n.a."
    return f"{v * 100:+.{d}f}%" if sign else f"{v * 100:.{d}f}%"


def _rel(diff: float, noun_neg: str = "discount", noun_pos: str = "premium") -> str:
    return noun_neg if diff < 0 else noun_pos


def ready_components(kit: Kit) -> set[str]:
    """Components usable right now: a manifest *and* the script (other teams add components daily)."""
    return {c for c in kit.component_ids() if kit.component_js(c).is_file()}


def build_report(a: Analysis, available: set[str]) -> Report:
    has = available.__contains__
    f, t, pm = a.facts, a.facts["target"], a.peer
    name, short = t["company"], t["company"].split()[0]
    med = {k: v["median"] for k, v in pm.items()}
    adj_net_debt = t["net_debt"] + t["minorities"]          # EV -> equity bridge items

    def per_share(ev: float) -> float:
        return round((ev - adj_net_debt) / t["shares_out"], 2)

    r = Report("Project Kestrel", subtitle=f"Valuation perspectives on {name}",
               client=f"Board of Directors, {name}", date=REPORT_DATE, theme="navy", firm=FIRM)

    # ------------------------------------------------------------------ datasets
    r.dataset("comps", a.comps, title="Trading comparables", fields=COMPS_FIELDS,
              source=SRC_MARKET + "; " + SRC_FIN, unit="USD m", as_of=AS_OF,
              notes=["LTM / NTM calendarised to December year-ends (LTM Sep-26 = 25% FY25A + 75% FY26E).",
                     f"P / E <= 0x or > {PE_NM_MAX:.0f}x shown as n.m. and excluded from statistics.", FICTIONAL],
              computed=[
                  {"name": "net_leverage", "formula": "net_debt / ltm_ebitda", "title": "Net debt / EBITDA LTM",
                   "format": MULT},
                  {"name": "ebitda_growth_ntm", "formula": "ntm_ebitda / ltm_ebitda - 1",
                   "title": "EBITDA growth NTM vs. LTM", "format": PCT},
              ])
    r.dataset("deals", a.deals, title="Precedent transactions", fields=DEAL_FIELDS, source=SRC_DEALS,
              unit="USD m", notes=["Premiums vs. the last undisturbed close and the 30-day VWAP before announcement.",
                                   FICTIONAL])
    r.dataset("premiums", a.premiums, title="Premiums paid (long format)", source=SRC_DEALS,
              fields={"target": "Target", "acquirer_type": "Acquirer type", "measure": "Measure",
                      "premium": {"title": "Premium", "format": PCT}})
    r.dataset("consideration_mix", a.mix, title="Deal value by consideration", source=SRC_DEALS, unit="USD m",
              fields={"consideration": "Consideration", "deals": {"title": "Deals", "format": "0"},
                      "deal_value": {"title": "Deal value", "format": USD_M, "unit": "USD m"}})
    if has("line"):
        r.dataset("perf", a.perf, title="Share price performance, rebased to 100 (weekly)", source=SRC_MARKET,
                  fields={"date": {"title": "Week", "format": "dd mmm yyyy"}, "series": "Series",
                          "perf_index": {"title": "Rebased price (14-Oct-24 = 100)", "format": "0.0"}},
                  notes="Peer median of the rebased indices; target excluded from the peer set.")
        r.dataset("vol", a.vol, title="Rolling 30-day volatility (weekly)", source=SRC_MARKET,
                  fields={"date": {"title": "Week", "format": "dd mmm yyyy"}, "series": "Series",
                          "vol_30d": {"title": "30-day volatility (ann.)", "format": PCT}})

    # KPI tiles — presentation rows assembled from the metrics (same code for both paths)
    gap_ntm = t["ev_ntm_ebitda"] - med["ev_ntm_ebitda"]
    r.dataset("kpis", [
        {"label": "Share price", "value": t["price"], "format": USD_PS, "delta": t["tsr_1y"],
         "delta_format": DPCT, "period": "1-year TSR", "spark": f["spark_price"], "good": "up"},
        {"label": "Market cap", "value": t["mkt_cap"], "format": '$#,##0"m"', "delta": None, "delta_format": None,
         "period": f"{t['shares_out']:.1f}m diluted shares", "spark": None, "good": "up"},
        {"label": "Enterprise value", "value": t["ev"], "format": '$#,##0"m"', "delta": None, "delta_format": None,
         "period": f"incl. ${adj_net_debt:,.0f}m net debt & minorities", "spark": None, "good": "up"},
        {"label": "EV / EBITDA NTM", "value": t["ev_ntm_ebitda"], "format": MULT, "delta": round(gap_ntm, 6),
         "delta_format": "+0.0x;-0.0x;0.0x", "period": f"vs. peer median {_x(med['ev_ntm_ebitda'])}",
         "spark": None, "good": "up"},
        {"label": "Revenue CAGR 3y", "value": t["rev_cagr_3y"], "format": PCT,
         "delta": round((t["rev_cagr_3y"] - med["rev_cagr_3y"]) * 10000, 1), "delta_format": BPS,
         "period": f"vs. peer median {_pct(med['rev_cagr_3y'])}", "spark": None, "good": "up"},
        {"label": "30-day volatility", "value": t["vol_30d"], "format": PCT,
         "delta": round((t["vol_30d"] - med["vol_30d"]) * 10000, 1), "delta_format": BPS,
         "period": f"vs. peer median {_pct(med['vol_30d'])}", "spark": f["spark_vol"], "good": "down"},
    ], title="Headline metrics", source=SRC_MARKET,
        fields={"label": "Metric", "value": "Value", "delta": "Change", "period": "Comparison",
                "spark": {"title": "Trend (26 weeks)", "type": "array"}})

    # Football field: peer / precedent interquartile ranges applied to the target's own numbers
    ev_ntm, ev_ltm, pe = f["ev_ntm"], f["ev_ltm"], f["pe"]
    d_ev, d_1d = f["deal_ev_ltm"], f["deal_prem_1d"]
    eps_ntm = t["ntm_net_income"] / t["shares_out"]

    def rng(q, fmt=_x) -> str:   # interquartile range as text: "11.0x–17.5x"
        return f"{fmt(q.q1)}–{fmt(q.q3)}"

    valuation = [
        {"method": "Trading comps — EV / EBITDA NTM", "group": "Market", "short": "EV / EBITDA NTM",
         "low": per_share(ev_ntm.q1 * t["ntm_ebitda"]), "high": per_share(ev_ntm.q3 * t["ntm_ebitda"]),
         "range": rng(ev_ntm), "applied": f"NTM EBITDA ${t['ntm_ebitda']:,.0f}m",
         "basis": f"{rng(ev_ntm)} × NTM EBITDA of ${t['ntm_ebitda']:,.0f}m (peer IQR, n={ev_ntm.n})"},
        {"method": "Trading comps — EV / EBITDA LTM", "group": "Market", "short": "EV / EBITDA LTM",
         "low": per_share(ev_ltm.q1 * t["ltm_ebitda"]), "high": per_share(ev_ltm.q3 * t["ltm_ebitda"]),
         "range": rng(ev_ltm), "applied": f"LTM EBITDA ${t['ltm_ebitda']:,.0f}m",
         "basis": f"{rng(ev_ltm)} × LTM EBITDA of ${t['ltm_ebitda']:,.0f}m (peer IQR, n={ev_ltm.n})"},
        {"method": "Trading comps — P / E NTM", "group": "Market", "short": "P / E NTM",
         "low": round(pe.q1 * eps_ntm, 2), "high": round(pe.q3 * eps_ntm, 2),
         "range": rng(pe), "applied": f"NTM EPS ${eps_ntm:.2f}",
         "basis": f"{rng(pe)} × NTM EPS of ${eps_ntm:.2f} (peer IQR, n={pe.n}, n.m. excluded)"},
        {"method": "Precedents — EV / EBITDA LTM", "group": "Transaction", "short": "EV / EBITDA LTM",
         "low": per_share(d_ev.q1 * t["ltm_ebitda"]), "high": per_share(d_ev.q3 * t["ltm_ebitda"]),
         "range": rng(d_ev), "applied": f"LTM EBITDA ${t['ltm_ebitda']:,.0f}m",
         "basis": f"{rng(d_ev)} × LTM EBITDA (deal IQR, n={d_ev.n})"},
        {"method": "Premiums paid — 1-day", "group": "Transaction", "short": "1-day premium",
         "low": round(t["price"] * (1 + d_1d.q1), 2), "high": round(t["price"] * (1 + d_1d.q3), 2),
         "range": rng(d_1d, lambda v: _pct(v, 0)), "applied": f"Current price ${t['price']:.2f}",
         "basis": f"{_pct(d_1d.q1, 0)}–{_pct(d_1d.q3, 0)} premium to the current ${t['price']:.2f} (deal IQR)"},
        {"method": "52-week trading range", "group": "Reference", "short": "52-week range",
         "low": t["low_52w"], "high": t["high_52w"], "range": "Low – high", "applied": "Daily closes, 12 months",
         "basis": "Closing prices, last 12 months"},
    ]
    for i, row in enumerate(valuation, 1):
        row["order"] = i
    r.dataset("valuation", valuation, title="Valuation summary: implied value per share",
              source=SRC_ANALYSIS + "; " + SRC_MARKET, unit="USD",
              fields={"method": "Methodology", "group": "Group", "short": "Benchmark",
                      "low": {"title": "Low", "format": USD_PS, "unit": "USD"},
                      "high": {"title": "High", "format": USD_PS, "unit": "USD"},
                      "range": "Range (IQR)", "applied": "Applied to",
                      "basis": "Basis", "order": {"title": "Order", "format": "0"}})
    deal_rows = [v for v in valuation if v["group"] == "Transaction"]
    lo_deal, hi_deal = min(v["low"] for v in deal_rows), max(v["high"] for v in deal_rows)

    r.dataset("ev_bridge", [
        {"step": "Market cap", "value": t["mkt_cap"], "kind": "total"},
        {"step": "Total debt", "value": t["total_debt"], "kind": "delta"},
        {"step": "Minorities", "value": t["minorities"], "kind": "delta"},
        {"step": "Cash", "value": -t["cash"], "kind": "delta"},
        {"step": "Enterprise value", "value": t["ev"], "kind": "total"},
    ], title=f"{name}: market cap to enterprise value", source=SRC_MARKET, unit="USD m",
        fields={"step": "Step", "value": {"title": "USD m", "format": USD_M, "unit": "USD m"}, "kind": "Kind"})

    # What-if: the offer premium is a param; offer price / EV / multiples are computed in the browser
    r.param("premium", BASE_PREMIUM, min=0.10, max=0.50, step=0.025, format=PCT, title="Offer premium")
    target_terms = {"shares_out": t["shares_out"], "adj_net_debt": round(adj_net_debt, 1),
                    "ltm_ebitda": t["ltm_ebitda"], "ntm_ebitda": t["ntm_ebitda"]}
    r.dataset("offer", [
        {"reference": "Current price", "ref_price": t["price"], **target_terms},
        {"reference": "30-day VWAP", "ref_price": t["vwap_30d"], **target_terms},
        {"reference": "52-week high", "ref_price": t["high_52w"], **target_terms},
    ], title="Illustrative offer at a premium to reference prices", source=SRC_ANALYSIS, unit="USD m",
        fields={"reference": "Reference",
                "ref_price": {"title": "Reference price", "format": USD_PS, "unit": "USD"},
                "shares_out": {"title": "Diluted shares", "format": "#,##0.0", "unit": "m"},
                "adj_net_debt": {"title": "Net debt & minorities", "format": USD_M, "unit": "USD m"},
                "ltm_ebitda": {"title": "EBITDA LTM", "format": USD_M, "unit": "USD m"},
                "ntm_ebitda": {"title": "EBITDA NTM", "format": USD_M, "unit": "USD m"}},
        computed=[   # evaluated in the browser, in order; @premium is the param above
            {"name": "offer_price", "formula": "ref_price * (1 + @premium)", "title": "Offer price",
             "format": USD_PS},
            {"name": "offer_equity", "formula": "offer_price * shares_out", "title": "Offer equity value",
             "format": USD_M},
            {"name": "offer_ev", "formula": "offer_equity + adj_net_debt", "title": "Implied EV", "format": USD_M},
            {"name": "offer_ev_ltm", "formula": "offer_ev / ltm_ebitda", "title": "EV / EBITDA LTM",
             "format": MULT},
            {"name": "offer_ev_ntm", "formula": "offer_ev / ntm_ebitda", "title": "EV / EBITDA NTM",
             "format": MULT},
        ])

    lineage = [
        {"dataset": "comps", "sql": "comps ← v_market, v_fundamentals, v_tsr, v_vol",
         "raw": "companies, prices, dividends, financials", "rows": len(a.comps),
         "python": "0/1 → boolean; 2 computed fields"},
        {"dataset": "deals", "sql": "v_deals", "raw": "transactions, deal_prices", "rows": len(a.deals),
         "python": "announced → date; NULL stays null (n.a.)"},
        {"dataset": "premiums", "sql": "v_deals", "raw": "transactions, deal_prices", "rows": len(a.premiums),
         "python": "melt to long format; drop missing premiums"},
        {"dataset": "consideration_mix", "sql": "v_deals + GROUP BY", "raw": "transactions",
         "rows": len(a.mix), "python": "—"},
    ]
    if has("line"):
        lineage.append({"dataset": "perf, vol", "sql": "weekly sample of v_vol", "raw": "prices, companies",
                        "rows": len(a.perf) + len(a.vol), "python": "peer median per week; long format"})
    lineage += [
        {"dataset": "valuation", "sql": "comps, v_deals", "raw": "all", "rows": len(valuation),
         "python": "quartiles applied to the target's EBITDA, EPS, price"},
        {"dataset": "kpis, ev_bridge, offer", "sql": "comps, v_peer_stats", "raw": "all",
         "rows": sum(len(r.datasets[d]["data"]) for d in ("kpis", "ev_bridge", "offer")),
         "python": "presentation rows; offer uses @premium"},
    ]
    r.dataset("lineage", lineage, title="Data lineage", source=SRC_ANALYSIS,
              fields={"dataset": "Dataset", "sql": "SQL object", "raw": "Raw tables",
                      "rows": {"title": "Rows", "format": "#,##0"}, "python": "Python step"})

    # optional global filter (only if the filter-bar component is installed)
    if has("filter-bar"):
        r.topbar_block("filter-bar", options={"filters": [
            {"field": "sector", "type": "multi", "label": "Sector", "data": "comps"},
            {"field": "region", "type": "multi", "label": "Region", "data": "comps"}]})

    # ------------------------------------------------------------------ pages
    r.cover(kicker="Discussion materials",
            subtitle="Trading, transaction and premium perspectives — built end to end from SQL")

    disc = _rel(gap_ntm)
    p = r.page(f"{short} trades at a {abs(gap_ntm):.1f}x {disc} to peers on NTM EBITDA; "
               f"transaction benchmarks point to ${lo_deal:.0f}–{hi_deal:.0f} per share",
               kicker="Executive summary", subtitle="USD unless otherwise stated",
               source=[SRC_MARKET, SRC_DEALS], notes=FICTIONAL)
    p.block("kpi-tiles", data="kpis", height=150, options={"variant": "plain", "columns": 6})
    takeaways = [
        {"title": "Valuation gap", "text": (
            f"{short} trades at **{_x(t['ev_ntm_ebitda'])} NTM EBITDA** vs. a peer median of "
            f"{_x(med['ev_ntm_ebitda'])} — a {abs(gap_ntm):.1f}x {disc}.")},
        {"title": "Fundamentals", "text": (
            f"Revenue CAGR FY22A–25A of **{_pct(t['rev_cagr_3y'])}** (peers {_pct(med['rev_cagr_3y'])}); "
            f"EBITDA margin {t['margin_delta_3y_bps']:+,.0f} bps over three years "
            f"(peers {med['margin_delta_3y_bps']:+,.0f} bps).")},
        {"title": "Market signals", "text": (
            f"1-year TSR of **{_pct(t['tsr_1y'], sign=True)}** vs. {_pct(med['tsr_1y'], sign=True)} for the "
            f"peer median; 30-day volatility {_pct(t['vol_30d'], 0)} vs. {_pct(med['vol_30d'], 0)}.")},
        {"title": "Transaction benchmarks", "text": (
            f"{f['n_deals']} precedents paid a median **{_pct(f['deal_prem_1d'].median, 0)} 1-day premium** "
            f"and {_x(f['deal_ev_ltm'].median)} LTM EBITDA.")},
    ]
    p.block("text-block", title="Key takeaways",
            options={"variant": "takeaways", "layout": "grid", "columns": 4, "items": takeaways})

    # valuation summary on its own page: one football field per benchmark plus the basis of each range (the
    # tooltips carry the basis on screen; the table keeps it on paper). Clicking a bar filters the table.
    p = r.page(f"Transaction benchmarks point to ${lo_deal:.0f}–{hi_deal:.0f} per share vs. a current "
               f"${t['price']:.2f}", kicker="Valuation summary",
               subtitle="Implied value per share (USD); bars span the interquartile range (IQR) of each benchmark",
               source=[SRC_ANALYSIS, SRC_MARKET],
               notes=f"Trading comps: {ev_ntm.n} peers (P / E: {pe.n}, n.m. excluded); precedents: {d_ev.n} deals "
                     "with disclosed EBITDA; premiums: all deals.")
    p.block("football-field", data="valuation", span=7, height=380, title="Implied value per share",
            encode={"label": "method", "low": "low", "high": "high", "group": "group", "note": "basis"},
            options={"refLines": [{"value": t["price"], "label": f"Current ${t['price']:.2f}"}]})
    p.block("comps-table", data="valuation", span=5, title="Basis of each range",
            encode={"label": "short"},
            options={"groupBy": "group", "stats": [], "scroll": False, "sortable": False, "crossFilter": False,
                     "columns": [{"field": "short"}, {"field": "range"}, {"field": "applied"}]})

    r.section("Trading analysis", subtitle="Peers, multiples, performance and capital structure")

    notes: dict[str, str] = {}      # row label -> footnote marker; the page renders notes as (1), (2) ...
    foot: list[str] = []
    for companies, text in ((a.rows["no_cagr"], "Listed in 2023; no FY22A financials, so CAGR and margin "
                                                 "change are n.a."),
                            (a.rows["pe_nm"], f"P / E n.m. (≤ 0x or > {PE_NM_MAX:.0f}x).")):
        if companies:
            foot.append(text)
            notes.update({c: notes.get(c, "") + f"({len(foot)})" for c in companies})
    p = r.page(f"{short} trades at {_x(t['ev_ntm_ebitda'])} NTM EBITDA vs. a peer median of "
               f"{_x(med['ev_ntm_ebitda'])}", kicker="Trading comparables",
               subtitle=f"Market data as of {AS_OF:%d-%b-%Y}; USD m unless otherwise stated",
               notes=foot + ["Peer median excludes the target."])
    p.block("comps-table", data="comps",
            encode={"label": "company", "highlight": "is_target"},
            options={"groupBy": "sector", "pinTarget": "top", "stats": ["median"], "scroll": False,
                     "dense": True, "notes": notes, "columns": [
                         {"field": "company"},
                         {"field": "mkt_cap", "title": "Mkt cap", "group": "Market data"},
                         {"field": "ev", "title": "EV", "group": "Market data"},
                         {"field": "ev_ltm_ebitda", "title": "LTM", "group": "EV / EBITDA", "heat": "seq"},
                         {"field": "ev_ntm_ebitda", "title": "NTM", "group": "EV / EBITDA", "heat": "seq"},
                         {"field": "ev_ntm_revenue", "title": "NTM", "group": "EV / Revenue"},
                         {"field": "pe_ntm", "title": "NTM", "group": "P / E", "nm": [0, PE_NM_MAX]},
                         {"field": "rev_cagr_3y", "title": "Rev. CAGR 3y", "group": "Operating", "heat": "div"},
                         {"field": "ebitda_margin_ltm", "title": "EBITDA mgn LTM", "group": "Operating"},
                         {"field": "margin_delta_3y_bps", "title": "Δ mgn 3y", "group": "Operating"},
                         {"field": "net_leverage", "title": "ND / EBITDA", "group": "Operating"},
                         {"field": "tsr_1y", "title": "1y TSR", "group": "Trading", "heat": "div", "mid": 0},
                     ]})

    r2, n_r2 = f["r2"]
    p = r.page(f"Growth explains {_pct(r2, 0)} of the dispersion in peer NTM multiples"
               if r2 is not None else "Multiples vs. growth", kicker="Multiples",
               subtitle="EV / EBITDA NTM; revenue CAGR FY22A–25A")
    p.block("bar", data="comps", span=6, height=380, title="EV / EBITDA NTM",
            encode={"x": "company", "y": "ev_ntm_ebitda"},
            options={"orientation": "horizontal", "sort": "desc", "highlight": name,
                     "refLines": [{"value": med["ev_ntm_ebitda"], "label": f"Peer median {_x(med['ev_ntm_ebitda'])}"}]})
    p.block("scatter", data="comps", span=6, height=380, title="EV / EBITDA NTM vs. revenue CAGR",
            subtitle=f"OLS across {n_r2} peers with a FY22A base year; target excluded from the fit",
            encode={"x": "rev_cagr_3y", "y": "ev_ntm_ebitda", "label": "ticker", "name": "company",
                    "color": "sector", "target": "is_target"},
            options={"regression": True, "tooltipFields": ["ebitda_margin_ltm", "mkt_cap"]})

    gap_tsr = t["tsr_1y"] - med["tsr_1y"]
    tsr_bar = dict(encode={"x": "company", "y": "tsr_1y"},
                   options={"orientation": "horizontal", "sort": "desc", "highlight": name,
                            "refLines": [{"value": med["tsr_1y"], "label": "Peer median"}]})
    p = r.page(f"{short} shares {'lagged' if gap_tsr < 0 else 'outperformed'} the peer median by "
               f"{abs(gap_tsr) * 100:.0f} pts over the last year", kicker="Trading performance",
               subtitle="Share price performance and total shareholder return", source=SRC_MARKET)
    if has("line"):
        p.block("line", data="perf", span=7, height=360, title="Share price, rebased to 100",
                subtitle=f"Weekly closes since {PRICE_START:%d-%b-%Y}; peer median of rebased prices",
                encode={"x": "date", "y": "perf_index", "series": "series"}, options={"highlight": name})
        p.block("bar", data="comps", span=5, height=360, title="1-year total shareholder return",
                subtitle="Price change plus dividends", **tsr_bar)
    else:
        p.block("bar", data="comps", span=12, height=360, title="1-year total shareholder return",
                subtitle="Price change plus dividends", **tsr_bar)

    gap_vol = t["vol_30d"] - med["vol_30d"]
    p = r.page(f"{short}'s 30-day volatility of {_pct(t['vol_30d'], 0)} is "
               f"{abs(gap_vol) * 100:.1f} pts {'above' if gap_vol > 0 else 'below'} the peer median",
               kicker="Trading risk", subtitle="Rolling 30-day volatility of daily log returns, annualised",
               source=SRC_MARKET)
    if has("line"):
        p.block("line", data="vol", span=8, height=360, title="Rolling 30-day volatility",
                subtitle="Weekly sample; peer median of the peers' volatilities",
                encode={"x": "date", "y": "vol_30d", "series": "series"}, options={"highlight": name})
    p.block("bar", data="comps", span=4 if has("line") else 12, height=360, title="Current 30-day volatility",
            subtitle=f"As of {AS_OF:%d-%b-%Y}", encode={"x": "company", "y": "vol_30d"},
            options={"orientation": "horizontal", "sort": "desc", "highlight": name,
                     "refLines": [{"value": med["vol_30d"], "label": "Peer median"}]})

    lev = t["net_debt"] / t["ltm_ebitda"]
    p = r.page(f"Enterprise value of ${t['ev'] / 1000:,.1f}bn with net leverage of {lev:.1f}x LTM EBITDA",
               kicker="Capital structure", subtitle="USD m; latest balance sheet",
               source=[SRC_MARKET, SRC_FIN])
    p.block("waterfall", data="ev_bridge", span=7, height=340, title="Market cap to enterprise value",
            encode={"label": "step", "value": "value", "kind": "kind"}, options={"pctOfStart": False})
    p.block("text-block", span=5, title="Key figures", options={"variant": "stats", "columns": 2, "items": [
        {"value": t["ev"], "format": '$#,##0"m"', "label": "Enterprise value"},
        {"value": round(lev, 6), "format": MULT, "label": "Net debt / LTM EBITDA",
         "note": f"Peer median {_x(statistics.median(_peer_leverage(a)))}"},
        {"value": t["ltm_ebitda"], "format": '$#,##0"m"', "label": "EBITDA LTM", "note": "Sep-26, calendarised"},
        {"value": t["ntm_ebitda"], "format": '$#,##0"m"', "label": "EBITDA NTM",
         "note": f"{_pct(t['ntm_ebitda'] / t['ltm_ebitda'] - 1, sign=True)} vs. LTM"},
    ]})

    r.section("Transaction perspectives", subtitle="Precedents, premiums paid and an illustrative offer")

    y0, y1 = f["deal_years"]
    p = r.page(f"Precedent transactions were struck at a median {_x(d_ev.median)} LTM EBITDA",
               kicker="Precedent transactions",
               subtitle=f"Selected industrial-technology transactions, {y0}–{y1}; USD m",
               notes=f"(1) EBITDA not disclosed: {', '.join(a.rows['undisclosed'])}." if a.rows["undisclosed"]
               else None)
    p.block("comps-table", data="deals", title="Selected precedent transactions",
            encode={"label": "target"},
            options={"labelTitle": "Target", "scroll": False, "dense": True,
                     "sort": {"field": "announced", "dir": "desc"}, "stats": ["mean", "median"],
                     "notes": {d: "(1)" for d in a.rows["undisclosed"]}, "columns": [
                         {"field": "target"}, {"field": "announced"}, {"field": "acquirer"},
                         {"field": "consideration"},
                         {"field": "deal_ev", "title": "Deal EV"},
                         {"field": "ev_ltm_revenue", "title": "EV / Rev. LTM"},
                         {"field": "ev_ltm_ebitda", "title": "EV / EBITDA LTM", "heat": "seq"},
                         {"field": "premium_1d", "title": "Premium 1-day", "heat": "seq"},
                         {"field": "premium_30d_vwap", "title": "Premium 30d VWAP"},
                     ]})

    d_30 = f["deal_prem_30d"]
    p = r.page(f"Buyers paid a median {_pct(d_1d.median, 0)} premium to the undisturbed price "
               f"({_pct(d_30.median, 0)} to the 30-day VWAP)", kicker="Premiums paid",
               subtitle="Offer price vs. last undisturbed close and 30-day VWAP before announcement")
    p.block("beeswarm", data="premiums", span=6, height=300, title="Premium distribution",
            encode={"label": "target", "value": "premium", "group": "measure"},
            options={"labels": "extremes", "refLines": [
                {"value": BASE_PREMIUM, "label": f"Illustrative offer {BASE_PREMIUM:.0%}"}]})
    p.block("donut", data="consideration_mix", span=6, height=300, title="Deal value by consideration",
            subtitle="USD m, all precedents",
            encode={"label": "consideration", "value": "deal_value"},
            options={"layout": "labels", "display": "both", "centerLabel": "Deal value"})

    offer_ntm = (t["price"] * (1 + BASE_PREMIUM) * t["shares_out"] + adj_net_debt) / t["ntm_ebitda"]
    peers_ntm = f"{_x(med['ev_ntm_ebitda'])} for peers"
    if has("param-slider"):   # live title: follows the slider (first offer row = the current price)
        title = ("A {{@premium | 0%}} premium implies {{offer: first(offer_ev_ntm) | 0.0x}} NTM EBITDA vs. "
                 + peers_ntm)
    else:
        title = f"A {BASE_PREMIUM:.0%} premium implies {_x(offer_ntm)} NTM EBITDA vs. {peers_ntm}"
    p = r.page(title, kicker="Illustrative offer",
               subtitle=("Move the premium to update every number on this page" if has("param-slider")
                         else f"At the base-case premium of {BASE_PREMIUM:.0%}")
               + f"; precedents paid a median {_x(d_ev.median)} LTM EBITDA; USD",
               source=SRC_ANALYSIS, notes=["Offer value = offer price × diluted shares; implied EV adds net "
                                           "debt and minorities.", FICTIONAL])
    if has("param-slider"):
        p.block("param-slider", data="offer", span=4, height=230, title="Assumption",
                options={"params": ["premium"], "columns": 1,
                         "preview": {"fields": ["reference", "offer_price", "offer_ev_ntm"], "title": "Live output"}})
    p.block("bar", data="offer", span=8 if has("param-slider") else 12, height=230,
            title="Reference vs. implied offer price per share",
            encode={"x": "reference", "y": ["ref_price", "offer_price"]}, options={"crossFilter": False})
    p.block("comps-table", data="offer", title="Implied offer metrics",
            encode={"label": "reference"},
            options={"stats": [], "scroll": False, "sortable": False, "crossFilter": False, "columns": [
                {"field": "reference"}, {"field": "ref_price"}, {"field": "offer_price"},
                {"field": "offer_equity"}, {"field": "offer_ev"},
                {"field": "offer_ev_ltm", "title": "EV / EBITDA LTM"},
                {"field": "offer_ev_ntm", "title": "EV / EBITDA NTM"}]})

    p = r.page("Appendix: how the numbers were built", kicker="Methodology",
               subtitle="Raw tables → SQL views → Python → ReportKit datasets", source=SRC_ANALYSIS)
    p.block("text-block", span=12, title="Metric definitions",
            options={"variant": "prose", "text": DEFINITIONS})

    p = r.page("Appendix: every dataset traces back to a raw table", kicker="Data lineage",
               subtitle="One file per dataset in data/datasets/; open the CSV export from any chart toolbar",
               source=SRC_ANALYSIS)
    p.block("comps-table", data="lineage", title="Data lineage",
            subtitle=(f"Raw: {f['n_prices']:,} daily prices, {f['n_financials']} financial years, "
                      f"{f['n_dividends']} dividends, {f['n_deals']} deals with {f['n_deal_prices']:,} "
                      "pre-announcement closes"),
            encode={"label": "dataset"},
            options={"stats": [], "scroll": False, "sortable": False, "crossFilter": False, "dense": True,
                     "columns": [{"field": "dataset"}, {"field": "sql"}, {"field": "raw"},
                                 {"field": "rows"}, {"field": "python"}]})
    return r


def _peer_leverage(a: Analysis) -> list[float]:
    rows = to_json_value(a.comps.to_dict("records")) if hasattr(a.comps, "to_dict") else a.comps
    return [r["net_debt"] / r["ltm_ebitda"] for r in rows if not r["is_target"] and r["ltm_ebitda"]]


# =============================================================================
# main
# =============================================================================
def print_summary(a: Analysis, backend_name: str) -> None:
    rows = to_json_value(a.comps.to_dict("records")) if hasattr(a.comps, "to_dict") else a.comps
    print(f"[{backend_name}] comps — {len(rows)} companies")
    print(f"  {'company':<28}{'EV $m':>9}{'EV/NTM':>8}{'P/E':>8}{'CAGR':>8}{'TSR 1y':>8}{'vol30':>7}")
    for r in rows:
        pe = r["pe_ntm"]
        pe_s = "n.m." if pe is None or not 0 < pe <= PE_NM_MAX else f"{pe:.1f}x"
        print(f"  {r['company'][:27]:<28}{r['ev']:>9,.0f}{r['ev_ntm_ebitda']:>7.1f}x{pe_s:>8}"
              f"{_pct(r['rev_cagr_3y']):>8}{_pct(r['tsr_1y'], sign=True):>8}{_pct(r['vol_30d'], 0):>7}"
              + ("  <- target" if r["is_target"] else ""))
    print("  peer medians (SQL): " + ", ".join(
        f"{k}={v['median']:.4g}" for k, v in sorted(a.peer.items())))


def _diff(x: Any, y: Any, path: str = "") -> list[str]:
    if isinstance(x, dict) and isinstance(y, dict):
        out = [f"{path}.{k}: only in one path" for k in set(x) ^ set(y)]
        for k in sorted(set(x) & set(y), key=str):
            out += _diff(x[k], y[k], f"{path}.{k}")
        return out
    if isinstance(x, list) and isinstance(y, list):
        if len(x) != len(y):
            return [f"{path}: {len(x)} vs {len(y)} items"]
        return [d for i, (u, v) in enumerate(zip(x, y)) for d in _diff(u, v, f"{path}[{i}]")]
    if isinstance(x, (int, float)) and isinstance(y, (int, float)) and not isinstance(x, bool):
        return [] if math.isclose(x, y, rel_tol=1e-9, abs_tol=1e-9) else [f"{path}: {x!r} vs {y!r}"]
    return [] if x == y else [f"{path}: {x!r} vs {y!r}"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("out", nargs="?", default=str(DEFAULT_OUT), help="output folder (default: %(default)s)")
    ap.add_argument("--no-pandas", action="store_true", help="use the plain sqlite3 rows / dicts path")
    ap.add_argument("--parity", action="store_true", help="also run the other path and compare every dataset")
    ap.add_argument("--check", action="store_true", help="validate only (r.check()); do not build")
    ap.add_argument("--dump-db", metavar="PATH", help="save the SQLite database (raw tables + views)")
    args = ap.parse_args(argv)

    conn = create_database()
    if args.dump_db:
        dst_path = Path(args.dump_db)
        dst_path.unlink(missing_ok=True)
        with sqlite3.connect(dst_path) as dst:
            conn.backup(dst)
        print(f"saved database -> {dst_path}")

    backend = pick_backend(args.no_pandas)
    analysis = analyse(conn, backend)
    print_summary(analysis, backend.name)

    kit = Kit.locate()
    available = ready_components(kit)
    report = build_report(analysis, available)
    errors, warnings = report.check(kit)
    for w in warnings:
        print(f"  ~ warning: {w}")
    if errors:
        print(f"{len(errors)} validation error(s):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    used = sorted({b.component for b in report.iter_blocks()})
    print(f"validated: {len(report.pages)} pages, {len(report.datasets)} datasets, components: {', '.join(used)}")

    if args.parity:
        other = PlainBackend() if backend.name == "pandas" else pick_backend(False)
        if other.name == backend.name:
            print("parity: pandas is not installed, nothing to compare")
        else:
            spec_a = report.to_spec()
            spec_b = build_report(analyse(conn, other), available).to_spec()
            diffs = _diff(spec_a, spec_b)
            if diffs:
                print(f"parity FAILED ({backend.name} vs {other.name}): {len(diffs)} difference(s)", file=sys.stderr)
                for d in diffs[:20]:
                    print(f"  {d}", file=sys.stderr)
                return 1
            print(f"parity OK: {backend.name} and {other.name} paths produce identical datasets and layout")

    if args.check:
        return 0
    out = report.build(args.out, kit=kit)
    print(f"built {out / 'index.html'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
