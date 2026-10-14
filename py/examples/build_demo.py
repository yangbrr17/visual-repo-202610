#!/usr/bin/env python3
"""Build the "Project Atlas" demo pitchbook from the kit sample datasets.

    python3 py/examples/build_demo.py              # -> examples/demo-pitchbook/
    python3 py/examples/build_demo.py out/atlas    # custom output folder

In a real engagement the datasets come from your SQL / pandas pipeline:
    r.dataset("peers", df_peers, title=..., fields={"ev_ebitda_25e": {"format": "0.0x"}})
Here we load the synthetic sample files (already in the dataset contract format).

Story (kit/samples/README.md): Helios Industrial (HLX) trades at $42.50 (158.0m diluted shares,
market cap $6,715m, net debt $1,490m, EV $8,205m = 9.1x 2025A EBITDA of $897m). Northbridge Capital
advises the Board on a possible sale ("Project Atlas"). Every number quoted in a title below is
read off the sample data, so the "so what" matches the charts.

Page budget: on screen a page is 16:9 (about 1135 x 638 px at a 1440 px wide window with the side
navigation), in print 1280 x 720 px. One row of charts therefore gets about 380 px of plot height;
two rows about 110 + 230 px.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "py"))

from reportkit import Report  # noqa: E402

SAMPLES = ROOT / "kit" / "samples" / "datasets"

FIRM = "Northbridge Capital"
CURRENT = {"value": 42.5, "label": "Current $42.50"}

# Capital structure used by the live DCF (same constants as tools/make_sample_data.py).
NET_DEBT = 1490.0
OTHER_ADJ = -145.0        # - pension (120) - minorities (85) + associates (60)
SHARES = 158.0

SRC_MKT = "FactSet, company filings; market data as of 10-Oct-2026"
SRC_PLAN = "Company filings, Helios management plan (FY26E–FY28E)"
SRC_NB = f"{FIRM} analysis"
FICTIONAL = "Illustrative: all companies, banks and investors are fictional."


def sample(name: str) -> dict:
    return json.loads((SAMPLES / f"{name}.json").read_text(encoding="utf-8"))


# Short sector names keep legends, filter pills and table columns on one line.
SECTOR_SHORT = {"Industrial Automation": "Automation", "Motion & Power Control": "Motion & Power",
                "Industrial Software & Sensors": "Software & Sensors"}
KPI_LABELS = {"net_leverage": ("Net debt / EBITDA", "vs. Sep-25"), "revenue_ltm": (None, "vs. LTM Sep-25"),
              "ebitda_margin_ltm": (None, "vs. LTM Sep-25"), "share_price": (None, "vs. 1 year ago"),
              "order_backlog": (None, "vs. Sep-25")}


def relabel(name: str, field: str, mapping: dict) -> dict:
    """Load a sample dataset and rename category values (presentation labels only)."""
    ds = sample(name)
    for row in ds["data"]:
        row[field] = mapping.get(row[field], row[field])
    return ds


def kpis() -> dict:
    ds = sample("kpis")
    for row in ds["data"]:
        label, period = KPI_LABELS.get(row["id"], (None, None))
        row["label"] = label or row["label"]
        row["period"] = period or row["period"]
    return ds


def plot_h(title: str, *, block_sub: bool = False, block_head: bool = True, page_sub: bool = True,
           above: int = 0) -> int:
    """Plot height (px) that keeps a one-row page at 16:9 on a 1440 px wide screen.

    A one-line action title holds ~66 characters; longer titles wrap to two lines (-32 px).
    `above` = height of a row stacked above (incl. its head and the 20 px row gap)."""
    h = 404 if len(title) <= 66 else 372
    h += 0 if page_sub else 26
    h -= 26 if block_sub else 0
    h += 0 if block_head else 36
    return h - above


def segment_totals() -> list[dict]:
    """Revenue by segment and year (the sample is by segment x region): aggregate in Python."""
    tot: dict[tuple, float] = {}
    for r in sample("segment_revenue")["data"]:
        k = (r["year"], r["segment"])
        tot[k] = tot.get(k, 0.0) + r["revenue"]
    return [{"year": y, "segment": s, "revenue": round(v, 1)} for (y, s), v in tot.items()]


def dcf_rows() -> list[dict]:
    """One row per management-plan scenario with its 2026E–2030E unlevered FCF."""
    rows: dict[str, dict] = {}
    for r in sample("scenarios")["data"]:
        if r["year"].endswith("E"):
            rows.setdefault(r["scenario"], {"scenario": r["scenario"]})[f"fcf_{r['year'][2:4]}"] = r["fcf"]
    order = ["Downside", "Base", "Upside"]
    return [dict(rows[s], net_debt=NET_DEBT, other_adj=OTHER_ADJ, shares=SHARES) for s in order]


def build(out: Path) -> Path:
    r = Report(
        "Project Atlas",
        subtitle="Discussion materials for the Board of Directors of Helios Industrial",
        client="Board of Directors, Helios Industrial",
        date="2026-10-14",
        theme="navy",
        confidentiality="Strictly private & confidential",
        firm=f"{FIRM} · Investment Banking",
    )

    # ------------------------------------------------------------------ data
    for ds in ["price_ohlc", "price_perf", "price_events", "ntm_multiple", "financials",
               "segment_revenue", "ebitda_bridge", "ev_equity_bridge", "valuation_ranges", "sensitivity_dcf",
               "sensitivity_lbo", "revenue_by_country", "assets_locations",
               "ownership", "org_structure", "deal_timeline", "segments_tree", "pnl_flow", "league_table"]:
        r.dataset(ds, SAMPLES / f"{ds}.json")
    r.dataset("kpis", kpis())
    r.dataset("segment_totals", segment_totals(), title="Revenue by segment",
              fields={"year": {"title": "Year"}, "segment": {"title": "Segment"},
                      "revenue": {"title": "Revenue", "format": "$#,##0", "unit": "USD m"}},
              source=SRC_PLAN, unit="USD m")
    for ds in ["peers", "precedents", "deal_flows"]:
        r.dataset(ds, relabel(ds, "sector", SECTOR_SHORT))

    # Live DCF: the computed fields re-evaluate in the browser when the WACC / TGR sliders move.
    # Same maths as sensitivity_dcf (end-year discounting of 2026E–2030E FCF + Gordon growth TV),
    # so the base case (9.0% / 2.5%) reproduces the $50.88 shown in the sensitivity table.
    r.param("wacc", 0.09, min=0.075, max=0.105, step=0.0025, format="0.00%", title="WACC")
    r.param("tgr", 0.025, min=0.015, max=0.035, step=0.0025, format="0.00%", title="Terminal growth")
    pv = " + ".join(f"fcf_{y} / (1 + @wacc) ^ {i}" for i, y in enumerate(["26", "27", "28", "29", "30"], 1))
    r.dataset(
        "dcf_live", dcf_rows(),
        title="Live DCF by management-plan scenario",
        fields={
            "scenario": {"title": "Scenario"},
            **{f"fcf_{y}": {"title": f"FCF 20{y}E", "format": "$#,##0"} for y in ["26", "27", "28", "29", "30"]},
            "net_debt": {"title": "Net debt", "format": "$#,##0"},
            "other_adj": {"title": "Other EV adjustments", "format": "#,##0;(#,##0)"},
            "shares": {"title": "Diluted shares (m)", "format": "#,##0.0"},
        },
        computed=[
            {"name": "pv_fcf", "title": "PV of FCF 2026E–30E", "format": "$#,##0", "formula": pv},
            {"name": "pv_tv", "title": "PV of terminal value", "format": "$#,##0",
             "formula": "fcf_30 * (1 + @tgr) / (@wacc - @tgr) / (1 + @wacc) ^ 5"},
            {"name": "implied_ev", "title": "Enterprise value", "format": "$#,##0", "formula": "pv_fcf + pv_tv"},
            {"name": "implied_price", "title": "Value per share", "format": "$0.00",
             "formula": "(implied_ev - net_debt + other_adj) / shares"},
            {"name": "premium", "title": "Premium to current", "format": "+0%;-0%;0%",
             "formula": "implied_price / 42.5 - 1"},
        ],
        source=f"{SRC_NB}; Helios management plan scenarios",
        unit="USD m",
    )

    # Global filters in the sticky top bar. Scoped with `datasets` so the peer screen drives the
    # peer- and precedent-based pages only (segment / country charts also have a 'region' field).
    r.topbar_block("filter-bar", data="peers", options={
        "countLabel": "peers",
        "filters": [
            {"field": "sector", "type": "multi", "label": "Sector", "datasets": ["peers", "precedents"]},
            {"field": "region", "type": "multi", "label": "Region", "datasets": ["peers"]},
        ]})

    # ------------------------------------------------------------------ cover & summary
    r.cover(kicker="Discussion materials", subtitle="Preliminary valuation perspectives and strategic alternatives")

    t = "Helios trades 1.5x below peers; our analyses support $45–55 per share"
    p = r.page(t, kicker="Executive summary", id="summary", nav="Executive summary",
               subtitle="USD unless otherwise stated; market data as of 10-Oct-2026",
               source=[SRC_MKT, SRC_NB], notes=FICTIONAL)
    p.block("kpi-tiles", data="kpis", height=150, options={"variant": "boxed", "columns": 6})
    p.block("text-block", height=150, options={
        "variant": "takeaways", "columns": 4,
        "items": [
            {"title": "Discount to peers",
             "text": "**9.2x** 2025E EBITDA vs. a peer median of **10.7x**, despite in-line margins of 18.5%."},
            {"title": "Plan momentum",
             "text": "Revenue CAGR of **7.0%** 2025A–28E with the EBITDA margin expanding to **20.0%**."},
            {"title": "Value of $45–55 per share",
             "text": "DCF, precedents and premiums paid imply a **6–29%** premium to the current $42.50."},
            {"title": "Deep buyer universe",
             "text": "**$165bn** of cross-border industrials M&A since 2021; sponsors can pay c.$46 per share."},
        ]})
    p.block("text-block", height=80, options={
        "variant": "callout", "kicker": "Recommendation", "tone": "accent2",
        "title": "Launch a two-stage auction in late October, targeting signing by end-March 2027",
        "text": "Board approval on 20-Oct; indicative offers due 11-Dec; final binding bids on 5-Mar-2027."})

    # ------------------------------------------------------------------ 01 business
    r.section("Business overview", subtitle="Financial profile, business mix and global footprint")

    t = "Revenue has compounded at 6% since 2019 with a 270bp margin uplift; the plan adds 7% a year"
    p = r.page(t, kicker="Financial overview", id="financials", subtitle="USD m; FY26E–FY28E = management plan",
               source=SRC_PLAN)
    p.block("combo", data="financials", span=7, height=plot_h(t), title="Revenue and EBITDA margin, 2019A–2028E",
            options={"encode": {"x": "year", "bars": ["revenue"], "line": ["ebitda_margin"]},
                     "format": "$#,##0", "cagr": "split"})
    p.block("waterfall", data="ebitda_bridge", span=5, height=plot_h(t), title="EBITDA bridge FY25A to FY26E",
            options={"encode": {"label": "step", "value": "value", "kind": "kind", "category": "category"},
                     "orientation": "horizontal", "connectors": "dashed"})

    t = "Sensors and Software & Services (36% of revenue) grow at 11%, twice the rate of the core"
    p = r.page(t, kicker="Business mix", id="mix", subtitle="Revenue by segment and product line, USD m",
               source=SRC_PLAN)
    p.block("line", data="segment_totals", span=5, height=plot_h(t, block_sub=True), title="Revenue by segment",
            subtitle="Indexed, 2021A = 100",
            options={"encode": {"x": "year", "y": "revenue", "series": "segment"}, "rebase": 100,
                     "endLabels": "name", "legend": False, "labels": False})
    p.block("treemap", data="segments_tree", span=7, height=plot_h(t, block_sub=True),
            title="FY25A revenue by product line", subtitle="Area = revenue; colour = growth vs. the 7.4% group average",
            options={"encode": {"id": "id", "parent": "parent", "name": "name", "value": "value", "color": "growth"},
                     "colorMid": "avg", "rootName": "Helios Industrial"})

    t = "$4.85bn of revenue converts into $897m of EBITDA and $445m of net income"
    p = r.page(t, kicker="Profitability", id="pnl", subtitle="FY25A P&L flow, USD m", source="Company filings (FY25A)")
    p.block("sankey", data="pnl_flow", span=8, height=plot_h(t), title="From segment revenue to net income",
            options={"encode": {"source": "source", "target": "target", "value": "value"},
                     "costNodes": ["Cost of goods sold", "Operating expenses", "D&A", "Net interest", "Income tax"],
                     "highlight": "Net income", "linkColor": "target", "percentOf": "Revenue", "format": "$#,##0"})
    p.block("text-block", data="financials", span=4, height=plot_h(t), title="FY25A margin profile", options={
        "variant": "stats", "columns": 1, "row": "year == \"2025A\"",
        "items": [
            {"field": "ebitda_margin", "label": "EBITDA margin", "note": "Up from 15.8% in FY19A", "tone": "accent2"},
            {"expr": "fcf / ebitda", "format": "0%", "label": "FCF conversion",
             "note": "Free cash flow {{fcf|$#,##0\"m\"}} / EBITDA"},
            {"expr": "capex / revenue", "format": "0.0%", "label": "Capex intensity",
             "note": "Capex {{capex|$#,##0\"m\"}} / revenue"},
        ]})

    t = "60% of revenue is earned outside North America, served from 47 sites in 24 countries"
    p = r.page(t, kicker="Global footprint", id="footprint", subtitle="FY25A revenue by country (USD m); operating sites",
               source="Company information (FY25A)")
    p.block("choropleth", data="revenue_by_country", span=7, height=plot_h(t), title="Revenue by country",
            options={"encode": {"id": "iso_num", "value": "revenue", "label": "country"},
                     "tooltip": ["growth", "employees"], "filterField": "country"})
    p.block("bubble-map", data="assets_locations", span=5, height=plot_h(t), title="Operating sites by floor area",
            options={"encode": {"lat": "lat", "lon": "lon", "size": "capacity", "color": "type", "label": "name"},
                     "labels": 4, "tooltip": ["city", "country", "utilization", "opened"]})

    # ------------------------------------------------------------------ 02 market
    r.section("Market perspectives", subtitle="Share price performance, trading multiples and peer positioning")

    t = "Shares are up 21% in two years but have lagged peers since the June bid speculation faded"
    p = r.page(t, kicker="Trading performance", id="trading", subtitle="Two years to 13-Oct-2026", source=SRC_MKT)
    p.block("price-volume", data="price_ohlc", span=7, height=plot_h(t), title="Helios share price (USD) and volume",
            options={"eventsData": "price_events", "range52w": "band"})
    p.block("line", data="price_perf", span=5, height=plot_h(t), title="Relative performance (rebased to 100)",
            options={"encode": {"x": "date", "y": "value", "series": "series"}, "rebase": 100,
                     "highlight": "Helios Industrial"})

    t = "Helios has traded at an average 1.2x NTM EBITDA discount to peers over the past two years"
    p = r.page(t, kicker="Trading multiples", id="multiples", subtitle="Enterprise value / NTM EBITDA", source=SRC_MKT)
    p.block("multiple-history", data="ntm_multiple", span=7, height=plot_h(t),
            title="NTM EV / EBITDA — Helios vs. peer median",
            options={"encode": {"x": "date", "y": "target", "compare": "peer_median"}, "sigma": 1})
    p.block("bar", data="peers", span=5, height=plot_h(t), title="EV / EBITDA 2025E — peer ranking",
            options={"encode": {"x": "ticker", "y": "ev_ebitda_25e"}, "orientation": "horizontal", "sort": "desc",
                     "highlight": "HLX", "avgLine": True})

    t = "Core peers trade at a median 9.9x 2025E EBITDA vs. 9.2x for Helios"
    p = r.page(t, kicker="Trading comparables", id="comps",
               subtitle="Automation and Motion & Power peers; market data as of 10-Oct-2026; USD m", source=SRC_MKT,
               notes="Mean and median exclude Helios. Software & Sensors peers (median 15.5x 2025E EBITDA) are "
                     "shown on the peer positioning page; n.m. = not meaningful.")
    p.block("comps-table", data="peers", height=plot_h(t, block_head=False), options={
        "where": "sector != \"Software & Sensors\"", "groupBy": "sector", "pinTarget": "top",
        "stats": ["mean", "median"],
        "sort": {"field": "ev_ebitda_25e", "dir": "desc"}, "dense": True, "scroll": False,
        "columns": [
            {"field": "region", "title": "Region"},
            {"field": "mkt_cap", "title": "Equity value", "group": "Market data"},
            {"field": "ev", "title": "EV", "group": "Market data"},
            {"field": "ev_revenue_25e", "title": "2025E", "group": "EV / Revenue"},
            {"field": "ev_ebitda_25e", "title": "2025E", "group": "EV / EBITDA", "heat": "seq"},
            {"field": "ev_ebitda_26e", "title": "2026E", "group": "EV / EBITDA", "heat": "seq"},
            {"field": "pe_25e", "title": "2025E", "group": "P / E", "nm": [0, 50]},
            {"field": "rev_growth_25e", "title": "Growth", "group": "2025E operating", "heat": "div", "mid": 0.065},
            {"field": "ebitda_margin_25e", "title": "EBITDA margin", "group": "2025E operating"},
            {"field": "net_debt_ebitda", "title": "ND / EBITDA", "group": "2025E operating"},
        ]})

    t = "Growth explains half of the multiple dispersion; on its growth Helios would trade at ~10.7x"
    p = r.page(t, kicker="Peer positioning", id="positioning", subtitle="All 17 listed peers, 2025E; Helios highlighted",
               source=SRC_MKT, notes="Regression across 17 listed peers (Helios excluded).")
    p.block("scatter", data="peers", span=6, height=plot_h(t, block_sub=True), title="EV / EBITDA vs. revenue growth",
            subtitle="Line = least-squares fit across peers",
            options={"encode": {"x": "rev_growth_25e", "y": "ev_ebitda_25e", "label": "ticker", "name": "company"},
                     "regression": True, "tooltipFields": ["sector", "ebitda_margin_25e", "mkt_cap"]})
    p.block("bubble", data="peers", span=6, height=plot_h(t, block_sub=True), title="EBITDA margin vs. revenue growth",
            subtitle="Bubble size = market capitalisation",
            options={"encode": {"x": "rev_growth_25e", "y": "ebitda_margin_25e", "size": "mkt_cap", "color": "sector",
                                "label": "ticker", "name": "company"},
                     "tooltipFields": ["ev_ebitda_25e"]})

    # ------------------------------------------------------------------ 03 valuation
    r.section("Valuation perspectives", subtitle="Intrinsic, market and transaction-based reference points")

    t = "Fundamental analyses support $45–55 per share, a 6–29% premium to the current $42.50"
    p = r.page(t, kicker="Valuation summary", id="valuation", subtitle="USD per share; share price as of 09-Oct-2026",
               source=SRC_NB, notes=["DCF: 2026E–2030E management plan, end-year discounting.",
                                      "LBO: 5.0x opening leverage, 20–25% sponsor IRR, 9.0x exit."])
    p.block("football-field", data="valuation_ranges", span=7, height=plot_h(t, block_sub=True),
            title="Implied value per share by methodology", subtitle="Intrinsic, market and transaction-based ranges",
            options={"encode": {"label": "method", "low": "low", "high": "high", "group": "group", "note": "basis"},
                     "refLines": [CURRENT], "refBand": {"from": 45, "to": 55, "label": "Indicative range $45–55"}})
    p.block("sensitivity-table", data="sensitivity_dcf", span=5, height=plot_h(t, block_sub=True),
            title="DCF sensitivity: value per share", subtitle="Click a cell to move the base case",
            options={"encode": {"row": "wacc", "col": "tgr", "value": "value"},
                     "rowTitle": "WACC", "colTitle": "Terminal growth rate", "base": {"row": "@wacc", "col": "@tgr"}})

    t = "Each 50bp of WACC moves DCF value by c.$5 per share; the base case implies $50.88"
    p = r.page(t, kicker="Valuation · what-if", id="what-if",
               subtitle="Drag the sliders: values recompute live in the browser",
               source=f"{SRC_NB}; management plan scenarios. DCF on 2026E–2030E unlevered FCF with Gordon-growth "
                      "terminal value.")
    p.block("param-slider", data="dcf_live", span=5, height=plot_h(t), title="DCF assumptions", options={
        "params": ["wacc", "tgr"], "columns": 1,
        "preview": {"fields": ["scenario", "implied_ev", "implied_price", "premium"], "title": "Live output (USD m)"}})
    p.block("bar", data="dcf_live", span=7, height=plot_h(t), title="Implied value per share by scenario",
            options={"encode": {"x": "scenario", "y": "implied_price"}, "orientation": "horizontal",
                     "highlight": "Base", "refLines": [CURRENT], "format": "$0.00"})

    t = "Precedent deals were struck at a median 10.3x LTM EBITDA and a 37% premium to the 30-day VWAP"
    p = r.page(t, kicker="Precedent transactions", id="precedents",
               subtitle="Selected industrial-technology transactions announced since 2023; premiums 2019–2026",
               source="Mergermarket, company announcements",
               notes="Brennick Robotics was acquired by Helios (Jul-2025). Full list in the appendix.")
    p.block("comps-table", data="precedents", span=8, height=plot_h(t), title="Selected precedent transactions",
            options={
                "encode": {"label": "target"}, "labelTitle": "Target", "where": "date >= \"2023-01-01\"",
                "sort": {"field": "date", "dir": "desc"}, "stats": ["mean", "median"], "dense": True,
                "scroll": False,
                "columns": [
                    {"field": "date", "title": "Announced", "format": "mmm yyyy"},
                    {"field": "target"},
                    {"field": "acquirer", "title": "Acquirer"},
                    {"field": "ev", "title": "EV (USD m)"},
                    {"field": "ev_revenue", "title": "Revenue", "group": "EV / LTM"},
                    {"field": "ev_ebitda", "title": "EBITDA", "group": "EV / LTM", "heat": "seq"},
                    {"field": "premium_30d", "title": "Premium", "group": "30-day VWAP"},
                ]})
    p.block("histogram", data="precedents", span=4, height=plot_h(t, block_sub=True), title="Premium to 30-day VWAP",
            subtitle="Disclosed premia, 2019–2026",
            options={"encode": {"value": "premium_30d", "label": "target", "name": "target"},
                     "binWidth": 0.05, "format": "0%", "stats": ["median"]})

    t = "A sponsor can pay c.$46 per share (9.0x FY26E EBITDA) and still earn a 20% IRR"
    p = r.page(t, kicker="Value to shareholders", id="bridge",
               subtitle="DCF base case enterprise value to equity value (USD m); LBO sponsor IRR",
               source=f"{SRC_NB}; Helios balance sheet as of 30-Sep-2026",
               notes="LBO: entry 31-Dec-2026, exit 31-Dec-2030; 5.0x opening leverage at 8.5%, 2.5% fees.")
    p.block("waterfall", data="ev_equity_bridge", span=7, height=plot_h(t, block_sub=True),
            title="Enterprise value to equity value",
            subtitle="DCF base case (WACC 9.0%, terminal growth 2.5%) = $50.88 per share",
            options={"encode": {"label": "step", "value": "value", "kind": "kind"}, "format": "$#,##0"})
    p.block("sensitivity-table", data="sensitivity_lbo", span=5, height=plot_h(t, block_sub=True),
            title="LBO sponsor IRR", subtitle="Entry vs. exit EV / EBITDA multiple",
            options={"encode": {"row": "entry_multiple", "col": "exit_multiple", "value": "irr"},
                     "rowTitle": "Entry multiple", "colTitle": "Exit multiple", "mid": 0.2, "base": {"row": 9, "col": 9}})

    # ------------------------------------------------------------------ 04 process
    r.section("Strategic alternatives & next steps", subtitle="Buyer universe, shareholder base and process")

    t = "$165bn of cross-border industrials M&A since 2021 points to a deep, global buyer universe"
    p = r.page(t, kicker="M&A landscape", id="ma",
               subtitle="Announced cross-border deals by acquirer and target country, 2021–2026 YTD (USD bn)",
               source="Mergermarket; league table LTM Sep-2026")
    p.block("flow-map", data="deal_flows", span=7, height=plot_h(t), title="Cross-border industrials M&A flows",
            options={"labels": 6, "maxFlows": 18})
    p.block("league-table", data="league_table", span=5, height=plot_h(t), title="M&A adviser league table",
            options={"highlight": FIRM, "top": 10, "titles": {"value": "Value", "count": "Deals"}})

    t = "Twelve institutions and strategics hold 46% of the shares; Ardent Family (7.5%) is pivotal"
    p = r.page(t, kicker="Shareholder base", id="ownership", subtitle="Basic shares outstanding 155.2m",
               source="Share register as of 30-Sep-2026; company information")
    p.block("donut", data="ownership", span=5, height=plot_h(t), title="Shareholders by investor type",
            options={"encode": {"label": "type", "value": "shares_m"}, "centerLabel": "Shares (m)"})
    p.block("comps-table", data="ownership", span=7, height=plot_h(t), title="Largest shareholders", options={
        "encode": {"label": "holder"}, "labelTitle": "Holder", "where": "type != \"Retail\" and type != \"Insider\"",
        "highlight": "Ardent Family Holdings", "stats": [], "dense": True, "scroll": False, "crossFilter": False,
        "sort": {"field": "pct", "dir": "desc"},
        "columns": [{"field": "type", "title": "Type"}, {"field": "country", "title": "Country"},
                    {"field": "shares_m", "title": "Shares (m)"}, {"field": "pct", "title": "% of total", "heat": "seq"},
                    {"field": "change_qoq_m", "title": "QoQ (m)", "sign": True}]})

    t = "A two-stage auction can deliver signing by end-March 2027 and closing in July"
    p = r.page(t, kicker="Next steps · indicative timetable", id="timetable", source=FIRM)
    p.block("gantt", data="deal_timeline", height=plot_h(t, block_head=False, page_sub=False),
            options={"today": "2026-10-14", "calendar": "months", "zoom": False})

    # ------------------------------------------------------------------ appendix
    t = "Appendix: explore the data and build your own metrics and queries"
    p = r.page(t, nav="Appendix · client analysis", id="explore",   # no kicker: the console needs the room
               source="Runs locally in your browser and respects the top-bar filters; no data leaves this file.")
    p.block("query-console", data="peers", height=480, options={   # the console needs >= 480 px
        "datasets": ["peers", "financials", "precedents", "segment_revenue"],
        "highlight": "Helios Industrial", "tab": "query",
        "builder": {"values": [{"agg": "median", "field": "ev_ebitda_25e"}, {"agg": "median", "field": "ebitda_margin_25e"}],
                    "rows": ["sector"], "sort": {"col": "v0", "dir": "desc"}},
        "examples": [
            {"label": "Sector medians", "query": "median(ev_ebitda_25e), median(ebitda_margin_25e) by sector from peers"},
            {"label": "European peers by EV/EBITDA",
             "query": "company, ev / ebitda_25e as \"EV/EBITDA\" format \"0.0x\" from peers where region == \"Europe\" sort 2 desc"},
            {"label": "FY25A revenue by segment",
             "query": "sum(revenue) as \"Revenue\" by segment from segment_revenue where year == \"2025A\" sort 2 desc"},
        ]})

    t = "Appendix: simplified legal structure"
    p = r.page(t, kicker="Appendix · structure", id="appendix-structure",
               subtitle="Principal legal entities; direct ownership shown where below 100%",
               source="Company information as of 30-Sep-2026")
    p.block("tree", data="org_structure", height=plot_h(t, block_head=False),
            options={"encode": {"id": "id", "parent": "parent", "name": "name", "country": "country",
                                "pct": "ownership_pct", "category": "entity_type"},
                     "pctLabels": "partial", "highlight": "hlx", "roam": False})

    t = "Appendix: full precedent transaction set"
    p = r.page(t, kicker="Appendix · data", id="appendix-precedents",
               subtitle="Search, filter, sort and export to CSV", source="Mergermarket, company announcements")
    p.block("data-grid", data="precedents", height=plot_h(t, block_head=False), options={
        "sort": {"field": "date", "dir": "desc"},
        "columns": [{"field": "date", "title": "Announced"}, "target", "acquirer",
                    {"field": "target_country", "title": "Country"}, "sector", {"field": "ev", "title": "EV (USD m)"},
                    {"field": "ev_revenue", "title": "EV / Revenue", "group": "LTM multiples"},
                    {"field": "ev_ebitda", "title": "EV / EBITDA", "group": "LTM multiples"},
                    {"field": "premium_1d", "title": "1-day", "group": "Premium"},
                    {"field": "premium_30d", "title": "30-day VWAP", "group": "Premium"},
                    "consideration", "status"]})

    return r.build(out)


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "examples" / "demo-pitchbook"
    path = build(target)
    print(f"built {path}")
