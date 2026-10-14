#!/usr/bin/env python3
"""Build the "Project Atlas" demo pitchbook from the kit sample datasets.

    python3 py/examples/build_demo.py              # -> examples/demo-pitchbook/
    python3 py/examples/build_demo.py out/atlas    # custom output folder

In a real engagement the datasets come from your SQL / pandas pipeline:
    r.dataset("peers", df_peers, title=..., fields={"ev_ebitda_25e": {"format": "0.0x"}})
Here we load the synthetic sample files (already in the dataset contract format).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "py"))

from reportkit import Report  # noqa: E402

SAMPLES = ROOT / "kit" / "samples" / "datasets"


def sample(name: str) -> dict:
    return json.loads((SAMPLES / f"{name}.json").read_text(encoding="utf-8"))


def build(out: Path) -> Path:
    r = Report(
        "Project Atlas",
        subtitle="Discussion materials for the Board of Directors of Helios Industrial",
        client="Board of Directors, Helios Industrial",
        date="2026-10-14",
        theme="navy",
        confidentiality="Strictly private & confidential",
        firm="Meridian Partners · Investment Banking",
    )

    # ------------------------------------------------------------------ data
    for ds in ["kpis", "peers", "price_ohlc", "price_perf", "price_events", "ntm_multiple", "financials",
               "segment_revenue", "ebitda_bridge", "ev_equity_bridge", "valuation_ranges", "sensitivity_dcf",
               "sensitivity_lbo", "precedents", "revenue_by_country", "assets_locations", "deal_flows",
               "ownership", "org_structure", "deal_timeline", "segments_tree", "pnl_flow", "league_table",
               "scenarios", "market_share"]:
        r.dataset(ds, SAMPLES / f"{ds}.json")

    # live DCF: computed fields re-evaluate when the WACC / TGR sliders move
    r.param("wacc", 0.09, min=0.075, max=0.105, step=0.0025, format="0.00%", title="WACC")
    r.param("tgr", 0.025, min=0.015, max=0.035, step=0.0025, format="0.00%", title="Terminal growth")
    r.dataset(
        "dcf_live",
        [
            {"scenario": "Downside", "fcf_next": 555.0, "net_debt": 1490.0, "shares": 158.0},
            {"scenario": "Base", "fcf_next": 620.0, "net_debt": 1490.0, "shares": 158.0},
            {"scenario": "Upside", "fcf_next": 685.0, "net_debt": 1490.0, "shares": 158.0},
        ],
        title="Live DCF (Gordon growth on next-year FCF)",
        fields={
            "scenario": {"title": "Scenario"},
            "fcf_next": {"title": "FCF 2027E", "format": "$#,##0"},
            "net_debt": {"title": "Net debt", "format": "$#,##0"},
            "shares": {"title": "Diluted shares (m)", "format": "#,##0.0"},
        },
        computed=[
            {"name": "implied_ev", "formula": "fcf_next / (@wacc - @tgr)", "title": "Implied EV", "format": "$#,##0"},
            {"name": "implied_price", "formula": "(fcf_next / (@wacc - @tgr) - net_debt) / shares",
             "title": "Implied value per share", "format": "$0.00"},
        ],
        source="Meridian Partners analysis; illustrative",
        unit="USD m",
    )

    # global filter bar in the sticky top bar (drives every block whose dataset has the field)
    r.topbar_block("filter-bar", options={"filters": [
        {"field": "sector", "type": "multi", "label": "Sector", "data": "peers"},
        {"field": "region", "type": "multi", "label": "Region", "data": "peers"},
    ]})

    src_mkt = "Source: FactSet, company filings; market data as of 10-Oct-2026. Illustrative, fictional companies."

    # ------------------------------------------------------------------ pages
    r.page("Project Atlas", kind="cover", kicker="Discussion materials",
           subtitle="Preliminary valuation perspectives and strategic alternatives")

    p = r.page("Helios trades at a discount to peers despite best-in-class margin expansion",
               kicker="Executive summary", subtitle="USD m unless otherwise stated", source=src_mkt)
    p.block("kpi-tiles", data="kpis", height=150, options={"variant": "plain"})
    p.block("text-block", span=6, height="auto", title="Key takeaways", options={
        "variant": "takeaways",
        "items": [
            {"title": "Re-rating opportunity", "text": "Helios trades at 9.8x NTM EBITDA vs. a peer median of 11.4x despite +240bps margin expansion since FY23."},
            {"title": "Strong strategic interest", "text": "Five strategic and three financial sponsors have the capacity to pay a 25–35% premium."},
            {"title": "Value range $46–58 per share", "text": "Intrinsic and transaction-based methods support a value well above the current $42.50."},
        ]})
    p.block("football-field", data="valuation_ranges", span=6, height=330, title="Valuation summary",
            subtitle="Implied value per share (USD)",
            options={"encode": {"label": "method", "low": "low", "high": "high", "group": "group", "note": "basis"},
                     "refLines": [{"value": 42.5, "label": "Current $42.50"}]})

    r.page("Market & trading performance", kind="section", kicker="01")

    p = r.page("Shares have lagged the peer group since the Q2-26 guidance reset", kicker="Trading performance",
               subtitle="Share price (USD) and volume; indexed performance rebased to 100", source=src_mkt)
    p.block("price-volume", data="price_ohlc", span=7, height=380, title="Helios share price & volume (2 years)",
            options={"eventsData": "price_events"})
    p.block("line", data="price_perf", span=5, height=380, title="Relative performance (rebased)",
            options={"encode": {"x": "date", "y": "value", "series": "series"}, "highlight": "Helios Industrial",
                     "eventsData": "price_events"})

    p = r.page("Valuation gap vs. peers has widened to ~1.6x turns", kicker="Trading multiples",
               subtitle="NTM EV / EBITDA", source=src_mkt)
    p.block("multiple-history", data="ntm_multiple", span=7, height=360, title="NTM EV / EBITDA — Helios vs. peer median",
            options={"encode": {"x": "date", "y": "target", "compare": "peer_median"}})
    p.block("bar", data="peers", span=5, height=360, title="EV / EBITDA 2025E",
            options={"encode": {"x": "company", "y": "ev_ebitda_25e"}, "orientation": "horizontal", "sort": "desc",
                     "highlight": "Helios Industrial", "avgLine": True})

    p = r.page("Trading comparables", kicker="Trading multiples",
               subtitle="Market data as of 10-Oct-2026; USD m", source=src_mkt,
               notes=["Mean and median exclude Helios Industrial.", "n.m. = not meaningful."])
    p.block("comps-table", data="peers", height="auto", title="Selected listed peers", options={
        "groupBy": "sector",
        "columns": [
            {"field": "company"}, {"field": "region"},
            {"field": "mkt_cap", "group": "Size"}, {"field": "ev", "group": "Size"},
            {"field": "rev_growth_25e", "group": "Operating", "heat": "div"},
            {"field": "ebitda_margin_25e", "group": "Operating", "heat": "seq"},
            {"field": "ev_ebitda_25e", "group": "EV / EBITDA"}, {"field": "ev_ebitda_26e", "group": "EV / EBITDA"},
            {"field": "pe_25e", "group": "P / E"}, {"field": "net_debt_ebitda", "group": "Leverage"},
        ],
        "stats": ["mean", "median"]})

    p = r.page("Growth explains most of the multiple dispersion across peers", kicker="Peer positioning",
               subtitle="2025E; bubble size = market capitalisation", source=src_mkt)
    p.block("scatter", data="peers", span=6, height=380, title="EV / EBITDA vs. revenue growth",
            options={"encode": {"x": "rev_growth_25e", "y": "ev_ebitda_25e", "label": "ticker"},
                     "regression": True, "highlight": "Helios Industrial"})
    p.block("bubble", data="peers", span=6, height=380, title="Margin vs. growth vs. size",
            options={"encode": {"x": "rev_growth_25e", "y": "ebitda_margin_25e", "size": "mkt_cap", "color": "sector", "label": "ticker"}})

    p = r.page("Revenue has compounded at 7% with a structural margin uplift", kicker="Financial overview",
               subtitle="USD m; FY26E–FY28E = management plan", source="Source: Company filings, management plan.")
    p.block("combo", data="financials", span=7, height=360, title="Revenue and EBITDA margin",
            options={"encode": {"x": "year", "bars": ["revenue"], "line": ["ebitda_margin"]}, "forecastFrom": "2026E"})
    p.block("waterfall", data="ebitda_bridge", span=5, height=360, title="EBITDA bridge FY25A → FY26E",
            options={"encode": {"step": "step", "value": "value", "kind": "kind"}})

    p = r.page("Automation and software now drive two-thirds of profit", kicker="Business mix",
               subtitle="Revenue by segment (USD m)", source="Source: Company filings, management plan.")
    p.block("bar", data="segment_revenue", span=6, height=340, title="Revenue by segment",
            options={"encode": {"x": "year", "y": "revenue", "series": "segment"}, "stack": True})
    p.block("treemap", data="segments_tree", span=6, height=340, title="FY25 revenue by segment and product line")
    p.block("sankey", data="pnl_flow", span=12, height=300, title="FY25 P&L flow")

    r.page("Valuation", kind="section", kicker="02")

    p = r.page("Intrinsic value of $46–58 per share supports a meaningful premium", kicker="Valuation",
               subtitle="Implied value per share (USD)", source="Source: Meridian Partners analysis.",
               notes=["DCF: 2026E–2030E plan, mid-year convention.", "LBO: 5.5x leverage, 5-year hold, 20–25% IRR."])
    p.block("football-field", data="valuation_ranges", span=7, height=380, title="Valuation summary",
            options={"encode": {"label": "method", "low": "low", "high": "high", "group": "group", "note": "basis"},
                     "refLines": [{"value": 42.5, "label": "Current $42.50"}],
                     "refBand": {"from": 50, "to": 55, "label": "Indicative range"}})
    p.block("sensitivity-table", data="sensitivity_dcf", span=5, height="auto", title="DCF sensitivity",
            subtitle="Implied value per share (USD)",
            options={"encode": {"row": "wacc", "col": "tgr", "value": "value"}})

    p = r.page("What-if: move WACC and terminal growth to see the implied price update live",
               kicker="Valuation · interactive", subtitle="Gordon growth on 2027E FCF; USD",
               source="Source: Meridian Partners analysis. Illustrative only.")
    p.block("param-slider", span=4, height="auto", title="Assumptions", options={"params": [
        {"name": "wacc", "label": "WACC", "min": 0.075, "max": 0.105, "step": 0.0025, "format": "0.00%"},
        {"name": "tgr", "label": "Terminal growth", "min": 0.015, "max": 0.035, "step": 0.0025, "format": "0.00%"}]})
    p.block("bar", data="dcf_live", span=8, height=320, title="Implied value per share by scenario",
            options={"encode": {"x": "scenario", "y": "implied_price"}, "refLines": [{"value": 42.5, "label": "Current $42.50"}]})

    p = r.page("Precedent transactions point to 10.5–13.5x LTM EBITDA", kicker="Valuation",
               subtitle="Selected industrial-technology transactions, 2019–2026", source="Source: Mergermarket, company announcements.")
    p.block("comps-table", data="precedents", span=8, height="auto", title="Selected precedent transactions", options={
        "columns": [{"field": "date"}, {"field": "target"}, {"field": "acquirer"}, {"field": "ev"},
                    {"field": "ev_revenue"}, {"field": "ev_ebitda", "heat": "seq"}, {"field": "premium_30d"}],
        "stats": ["mean", "median"]})
    p.block("histogram", data="precedents", span=4, height=320, title="Premium paid (30-day)",
            options={"encode": {"value": "premium_30d"}})

    p = r.page("A global footprint with 40% of revenue outside North America", kicker="Footprint",
               subtitle="FY25 revenue by country; operating sites", source="Source: Company information.")
    p.block("choropleth", data="revenue_by_country", span=7, height=380, title="Revenue by country",
            options={"encode": {"id": "iso_num", "value": "revenue"}})
    p.block("bubble-map", data="assets_locations", span=5, height=380, title="Operating sites by capacity",
            options={"encode": {"lat": "lat", "lon": "lon", "size": "capacity", "color": "type", "label": "name"}})

    p = r.page("Cross-border appetite for industrial technology remains robust", kicker="M&A landscape",
               subtitle="Announced cross-border deals, 2024–2026 (USD bn)", source="Source: Mergermarket. Fictional data.")
    p.block("flow-map", data="deal_flows", span=8, height=380, title="Cross-border M&A flows")
    p.block("league-table", data="league_table", span=4, height="auto", title="M&A advisory league table")

    p = r.page("Shareholder base and legal structure", kicker="Ownership",
               subtitle="Shares outstanding (m) and principal entities", source="Source: Share register as of 30-Sep-2026.")
    p.block("donut", data="ownership", span=5, height=340, title="Shareholder mix by type")
    p.block("tree", data="org_structure", span=7, height=340, title="Simplified legal structure")

    p = r.page("Indicative process timetable to signing in Q1 2027", kicker="Next steps",
               subtitle="Two-stage auction", source="Source: Meridian Partners.")
    p.block("gantt", data="deal_timeline", height=380, title="Process timetable")

    p = r.page("Explore the data: build your own metrics and queries", kicker="Client analysis",
               subtitle="Type a formula or query — results respect the filters above",
               source="All analysis runs locally in your browser; no data leaves this file.")
    p.block("query-console", height=560, title="Query console", options={
        "datasets": ["peers", "financials", "precedents", "segment_revenue"],
        "examples": [
            "median(ev_ebitda_25e), median(ebitda_margin_25e) by sector from peers",
            "company, ev / ebitda_25e as \"EV/EBITDA\" format \"0.0x\" from peers where region == \"Europe\" sort 2 desc",
            "sum(revenue) as \"Revenue\" by segment from segment_revenue where year == \"2025A\" sort 2 desc",
        ]})

    p = r.page("Appendix: full transaction dataset", kicker="Appendix", source="Source: Mergermarket. Fictional data.")
    p.block("data-grid", data="precedents", height=420, title="Precedent transactions (interactive)")

    return r.build(out)


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "examples" / "demo-pitchbook"
    path = build(target)
    print(f"built {path}")
