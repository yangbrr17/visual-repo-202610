#!/usr/bin/env python3
"""Build the "Project Atlas" demo pitchbook from the kit sample datasets.

    python3 py/examples/build_demo.py              # -> examples/demo-pitchbook/
    python3 py/examples/build_demo.py out/atlas    # custom output folder
    python3 py/examples/build_demo.py out/x --single-file --excel   # -> out/x/project-atlas.html + .xlsx
    python3 py/examples/build_demo.py out/x --theme bronze          # another house theme

In a real engagement the datasets come from your SQL / pandas pipeline:
    r.dataset("peers", df_peers, title=..., fields={"ev_ebitda_25e": {"format": "0.0x"}})
Here we load the synthetic sample files (already in the dataset contract format) from kit/samples/datasets/,
plus three small hand-written inputs in py/examples/data/ (approach chronology, buyer assessment, auction
funnel). Every derived number (unaffected price, VWAPs, ability to pay, cash capacity, SOTP mix ...) is
computed below from those files, so titles, tables and charts agree.

Story (kit/samples/README.md): Helios Industrial (HLX) trades at $42.50 (158.0m diluted shares,
market cap $6,715m, net debt $1,490m, EV $8,205m = 9.1x 2025A EBITDA of $897m). Since press reports of
sponsor interest in June, Granite Arch Partners has made three unsolicited proposals ($47.00, $49.50 and a
"best and final" $52.00). Northbridge Capital advises the Board ("Project Atlas"): valuation perspectives,
the proposal in context, the buyer universe and a targeted two-stage auction with Granite Arch as the floor.

Live features used the way a deal team would:
  * title templates ({{dataset: expr | format}} / {{@param}}) on the comps, relative-valuation, what-if,
    precedents, proposal and scenario pages, so headlines follow the filters, the sliders and the offer stepper;
  * metric pickers ("choices") on the peer ranking, the valuation-vs-fundamentals scatter and the box plot;
  * filters=False on pages whose numbers must never be filtered (valuation, SOTP, DCF, LBO, proposal,
    financing, credentials, disclaimer);
  * Report.build(single_file=..., excel=...) through --single-file / --excel.

Page budget: on screen a page is 16:9 (1135 x 638 px at a 1440 px wide window with the side navigation);
print lays every page out at that size (print.css) and RK.runtime.printFit() shrinks overflowing blocks, so
blocks are sized to fit without it. One row of charts gets about 380 px of plot height; two rows about
110 + 230 px.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "py"))

from reportkit import Report  # noqa: E402

SAMPLES = ROOT / "kit" / "samples" / "datasets"
LOCAL = Path(__file__).resolve().parent / "data"

FIRM = "Northbridge Capital"
NUM = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine"}
CURRENT_PRICE = 42.5
CURRENT = {"value": CURRENT_PRICE, "label": "Current $42.50"}
OFFER = 52.0                       # Granite Arch's final ("best and final") proposal, offer_prices.json
PROPOSALS = [(47.0, "Initial $47.00"), (49.5, "Revised $49.50"), (OFFER, "Final $52.00")]

# Capital structure used by the live DCF (same constants as tools/make_sample_data.py).
NET_DEBT = 1490.0
OTHER_ADJ = -145.0        # - pension (120) - minorities (85) + associates (60)
SHARES = 158.0
EBITDA_25A, EBITDA_26E = 897.2, 996.5
NI_26E = 510.8            # net income 2026E (financials.json)

# Buyer analysis conventions (Northbridge house assumptions)
SYNERGY_MULTIPLE = 7.5    # run-rate synergies capitalised at 7.5x, net of integration costs
MAX_LEVERAGE = 3.0        # pro forma net debt / EBITDA a strategic can carry and stay investment grade
# Kanemori's pending acquisition of Tarrant Automation (credentials / precedents: $8.3bn EV at 9.3x,
# $5.0bn acquisition financing) is added to its balance sheet before measuring its capacity.
TARRANT_EBITDA = round(8334.7 / 9.26, 1)
TARRANT_DEBT = 5000.0

SRC_MKT = "FactSet, company filings; market data as of 10-Oct-2026"
SRC_PLAN = "Company filings, Helios management plan (FY26E–FY28E)"
SRC_NB = f"{FIRM} analysis"
FICTIONAL = "Illustrative: all companies, banks and investors are fictional."


def sample(name: str) -> dict:
    return json.loads((SAMPLES / f"{name}.json").read_text(encoding="utf-8"))


def local(name: str) -> dict:
    return json.loads((LOCAL / f"{name}.json").read_text(encoding="utf-8"))


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
           notes: bool = False, choices: bool = False, above: int = 0) -> int:
    """Plot height (px) that keeps a one-row page at 16:9 on a 1440 px wide screen.

    A one-line action title holds ~66 characters; longer titles wrap to two lines (-32 px). For a title
    template pass the text as it renders by default. notes: the page footer has a notes line (-15 px);
    choices: a metric picker sits in the block head (-6 px). `above` = height of a row stacked above
    (incl. its head and the 20 px row gap)."""
    h = 404 if len(title) <= 66 else 372
    h += 0 if page_sub else 26
    h -= 26 if block_sub else 0
    h += 0 if block_head else 36
    h -= 15 if notes else 0
    h -= 6 if choices else 0
    return h - above


# ---------------------------------------------------------------------------------------------- derived data
def segment_totals() -> list[dict]:
    """Revenue by segment and year (the sample is by segment x region): aggregate in Python."""
    tot: dict[tuple, float] = {}
    for r in sample("segment_revenue")["data"]:
        k = (r["year"], r["segment"])
        tot[k] = tot.get(k, 0.0) + r["revenue"]
    return [{"year": y, "segment": s, "revenue": round(v, 1)} for (y, s), v in tot.items()]


def dcf_rows(key: str = "scenario") -> list[dict]:
    """One row per management-plan scenario with its 2026E–2030E unlevered FCF (case name in column *key*)."""
    rows: dict[str, dict] = {}
    for r in sample("scenarios")["data"]:
        if r["year"].endswith("E"):
            rows.setdefault(r["scenario"], {key: r["scenario"]})[f"fcf_{r['year'][2:4]}"] = r["fcf"]
    order = ["Downside", "Base", "Upside"]
    return [dict(rows[s], net_debt=NET_DEBT, other_adj=OTHER_ADJ, shares=SHARES) for s in order]


def scenario_long() -> list[dict]:
    """scenarios (wide: revenue / EBITDA / FCF per year) -> long rows for one small-multiple panel per metric."""
    out = []
    for r in sample("scenarios")["data"]:
        for name, f in (("Revenue", "revenue"), ("EBITDA", "ebitda"), ("Unlevered FCF", "fcf")):
            out.append({"scenario": r["scenario"], "year": r["year"], "metric": name, "value": r[f]})
    return out


def price_refs() -> dict:
    """Reference share prices for the proposal, read off the daily price file (price_ohlc)."""
    px = sample("price_ohlc")["data"]

    def vwap(rows: list[dict]) -> float:
        return sum(r["close"] * r["volume"] for r in rows) / sum(r["volume"] for r in rows)

    by_date = {r["date"]: r for r in px}
    pre_leak = [r for r in px if r["date"] < "2026-06-18"]          # press reports of sponsor interest 18-Jun
    to_date = [r for r in px if r["date"] <= "2026-10-09"]
    year = [r for r in to_date if r["date"] > "2025-10-09"]
    return {
        "current": CURRENT_PRICE,
        "unaffected": by_date["2026-06-17"]["close"],                 # last close before the leak
        "vwap30_unaffected": round(vwap(pre_leak[-30:]), 2),        # 30 trading days to 17-Jun-2026
        "vwap30": round(vwap(to_date[-30:]), 2),                    # 30 trading days to 09-Oct-2026
        "high52": max(r["close"] for r in year),                    # closing basis, as the football field
    }


def deal_terms(refs: dict) -> dict:
    """One-row dataset: the inputs of the proposal maths; computed fields follow the @offer param."""
    row = {"current": refs["current"], "unaffected": refs["unaffected"], "vwap30_unaffected": refs["vwap30_unaffected"],
           "shares": SHARES, "net_debt": NET_DEBT, "ebitda_25a": EBITDA_25A, "ebitda_26e": EBITDA_26E,
           "ni_26e": NI_26E}
    fields = {"current": {"title": "Current share price", "format": "$0.00"},
              "unaffected": {"title": "Unaffected share price (17-Jun-2026)", "format": "$0.00"},
              "vwap30_unaffected": {"title": "Unaffected 30-day VWAP", "format": "$0.00"},
              "shares": {"title": "Diluted shares (m)", "format": "#,##0.0"},
              "net_debt": {"title": "Net debt", "format": "$#,##0"},
              "ebitda_25a": {"title": "EBITDA 2025A", "format": "$#,##0.0"},
              "ebitda_26e": {"title": "EBITDA 2026E", "format": "$#,##0.0"},
              "ni_26e": {"title": "Net income 2026E", "format": "$#,##0.0"}}
    computed = [
        {"name": "equity_value", "title": "Implied equity value", "format": "$#,##0", "formula": "@offer * shares"},
        {"name": "implied_ev", "title": "Implied enterprise value", "format": "$#,##0", "formula": "equity_value + net_debt"},
        {"name": "ev_ebitda_25a", "title": "Implied EV / EBITDA 2025A", "format": "0.0x", "formula": "implied_ev / ebitda_25a"},
        {"name": "ev_ebitda_26e", "title": "Implied EV / EBITDA 2026E", "format": "0.0x", "formula": "implied_ev / ebitda_26e"},
        {"name": "pe_26e", "title": "Implied P / E 2026E", "format": "0.0x", "formula": "equity_value / ni_26e"},
        {"name": "prem_current", "title": "Premium to current", "format": "0%", "formula": "@offer / current - 1"},
        {"name": "prem_unaffected", "title": "Premium to unaffected", "format": "0%", "formula": "@offer / unaffected - 1"},
        {"name": "prem_vwap_unaffected", "title": "Premium to unaffected 30-day VWAP", "format": "0%",
         "formula": "@offer / vwap30_unaffected - 1"},
    ]
    return {"data": [row], "fields": fields, "computed": computed}


def buyers() -> dict:
    """buyers.json + ability to pay with synergies and (strategics) cash capacity from the peers balance sheets."""
    ds = local("buyers")
    peers = {p["ticker"]: p for p in sample("peers")["data"]}
    for b in ds["data"]:
        syn_ps = b["synergies"] * SYNERGY_MULTIPLE / SHARES
        b["synergy_ps"] = round(syn_ps, 2)
        b["with_synergies"] = round(b["standalone"] + syn_ps, 2)
        cap = None
        p = peers.get(b["ticker"] or "")
        if p:
            ebitda, net_debt = p["ebitda_26e"], p["net_debt"]
            if b["ticker"] == "KNMR":
                ebitda, net_debt = ebitda + TARRANT_EBITDA, net_debt + TARRANT_DEBT
            # cash the buyer can pay for Helios' equity with debt at MAX_LEVERAGE pro forma (Helios' net debt assumed)
            cap = round(MAX_LEVERAGE * (ebitda + EBITDA_26E) - net_debt - NET_DEBT, 1)
        b["cash_capacity"] = cap
    ds["schema"]["fields"] += [
        {"name": "synergy_ps", "type": "number", "title": "Synergy value per share", "format": "$#,##0.00"},
        {"name": "with_synergies", "type": "number", "title": "Ability to pay, with synergies", "format": "$#,##0.00"},
        {"name": "cash_capacity", "type": "number", "title": "Cash capacity at 3.0x leverage", "format": '$#,##0.0,"bn"',
         "unit": "USD m"},
    ]
    return ds


def sotp_mix() -> list[dict]:
    """Mid-point SOTP enterprise value by segment (corporate costs excluded) — the waffle beside the build-up."""
    rows = []
    for r in sample("sotp")["data"]:
        if r["metric_value"] > 0:
            mid = r["metric_value"] * (r["multiple_low"] + r["multiple_high"]) / 2
            rows.append({"segment": r["segment"], "ev_mid": round(mid, 1)})
    return rows


def site_regions() -> dict:
    """Operating sites per region (assets_locations has countries; revenue_by_country maps them to regions)."""
    region = {c["country"]: c["region"] for c in sample("revenue_by_country")["data"]}
    out: dict[str, int] = defaultdict(int)
    for a in sample("assets_locations")["data"]:
        out[region[a["country"]]] += 1
    return out


def revenue_growth() -> dict:
    """2021A–2026E revenue CAGR by segment, by region and by segment x region cell (segment_revenue)."""
    by: dict[str, dict] = {"segment": defaultdict(lambda: defaultdict(float)),
                           "region": defaultdict(lambda: defaultdict(float)), "cell": defaultdict(lambda: defaultdict(float))}
    for x in sample("segment_revenue")["data"]:
        for k, key in (("segment", x["segment"]), ("region", x["region"]), ("cell", (x["segment"], x["region"]))):
            by[k][key][x["year"]] += x["revenue"]

    def best(d: dict) -> tuple:
        return max(((k, (v["2026E"] / v["2021A"]) ** (1 / 5) - 1) for k, v in d.items()), key=lambda kv: kv[1])
    return {k: best(v) for k, v in by.items()}


def flow_stats() -> dict:
    """Headline numbers of the cross-border flows (chord appendix)."""
    flows = sample("deal_flows")["data"]
    total = sum(f["value"] for f in flows)
    out_by, in_by = defaultdict(float), defaultdict(float)
    for f in flows:
        out_by[f["from_country"]] += f["value"]
        in_by[f["to_country"]] += f["value"]
    top_out = max(out_by.items(), key=lambda kv: kv[1])
    top_in = max(in_by.items(), key=lambda kv: kv[1])
    us_in = in_by["United States"]
    return {"total": total, "top_out": top_out, "top_in": top_in, "us_in_share": us_in / total,
            "biggest": max(flows, key=lambda f: f["value"])}


def league_ranks() -> list[dict]:
    """league_table (rank and prior_rank columns) -> long rows (period, bank, rank) for the bump chart."""
    out = []
    for period, f in (("FY2025", "prior_rank"), ("LTM Sep-26", "rank")):
        out += [{"period": period, "bank": x["bank"], "rank": x[f]} for x in sample("league_table")["data"]]
    return out


def credentials() -> dict:
    """Credentials from the sample file, attributed to the adviser of this book, sector names shortened."""
    ds = relabel("credentials", "sector", SECTOR_SHORT)
    ds["meta"] = dict(ds.get("meta") or {}, source=f"{FIRM} deal records")
    return ds


def offer_prices(refs: dict) -> dict:
    """offer_prices with notes that match the reference prices this book computes from price_ohlc."""
    ds = sample("offer_prices")
    ds["meta"] = dict(ds.get("meta") or {}, notes=[
        f"Reference prices: current ${refs['current']:.2f} (09-Oct-2026 close), 30-day VWAP ${refs['vwap30']:.2f}, "
        f"52-week closing high ${refs['high52']:.2f}, unaffected ${refs['unaffected']:.2f} (17-Jun-2026, the last "
        "close before press reports of sponsor interest).",
        "kind: current = current share price; proposal = proposal received; offer = final proposal; level = "
        "illustrative price level.", FICTIONAL])
    return ds


def dcf_dataset(r: Report, did: str, key: str, pv: str) -> None:
    """Register a live DCF dataset (computed fields re-evaluate when the WACC / TGR sliders move)."""
    r.dataset(
        did, dcf_rows(key),
        title="Live DCF by management-plan scenario",
        fields={
            key: {"title": "Scenario"},
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


# ---------------------------------------------------------------------------------------------- the book
def build(out: Path, *, theme: str = "navy", **build_kw) -> Path:
    """Build the demo into *out*; extra keyword arguments go to Report.build (single_file=, excel= ...)."""
    r = Report(
        "Project Atlas",
        subtitle="Discussion materials for the Board of Directors of Helios Industrial",
        client="Board of Directors, Helios Industrial",
        date="2026-10-14",
        theme=theme,
        confidentiality="Strictly private & confidential",
        firm=f"{FIRM} · Investment Banking",
    )
    refs = price_refs()
    prem_vwap_unaff = OFFER / refs["vwap30_unaffected"] - 1
    buyer_ds = buyers()
    bmap = {b["buyer"]: b for b in buyer_ds["data"]}
    strat_over = sorted([b for b in buyer_ds["data"] if b["type"] == "Strategic" and b["with_synergies"] > OFFER],
                        key=lambda b: -b["with_synergies"])
    equity_at_offer = OFFER * SHARES
    sotp_rows = sample("sotp")["data"]
    sotp_lo = sum(x["metric_value"] * x["multiple_low"] for x in sotp_rows)
    sotp_hi = sum(x["metric_value"] * x["multiple_high"] for x in sotp_rows)
    ps_lo, ps_hi = [(v - NET_DEBT + OTHER_ADJ) / SHARES for v in (sotp_lo, sotp_hi)]
    mix = sotp_mix()
    sens_sw_share = sum(m["ev_mid"] for m in mix if m["segment"] in ("Sensors & Instrumentation", "Software & Services")) \
        / sum(m["ev_mid"] for m in mix)
    cred = credentials()
    cred_total = sum(c["deal_value_bn"] for c in cred["data"])

    # ------------------------------------------------------------------ data
    for ds in ["price_ohlc", "price_perf", "price_events", "ntm_multiple", "financials", "quarterly",
               "segment_revenue", "ebitda_bridge", "ev_equity_bridge", "valuation_ranges", "sensitivity_dcf",
               "sensitivity_lbo", "revenue_by_country", "assets_locations", "market_share", "peer_scores",
               "ownership", "org_structure", "deal_timeline", "segments_tree", "pnl_flow", "league_table",
               "scenarios", "sotp", "sources_uses", "network_nodes", "network_edges",
               "monthly_returns", "daily_activity"]:
        r.dataset(ds, SAMPLES / f"{ds}.json")
    r.dataset("kpis", kpis())
    r.dataset("segment_totals", segment_totals(), title="Revenue by segment",
              fields={"year": {"title": "Year"}, "segment": {"title": "Segment"},
                      "revenue": {"title": "Revenue", "format": "$#,##0", "unit": "USD m"}},
              source=SRC_PLAN, unit="USD m")
    for ds in ["peers", "precedents", "deal_flows"]:
        r.dataset(ds, relabel(ds, "sector", SECTOR_SHORT))
    r.dataset("credentials", cred)
    r.dataset("league_ranks", league_ranks(), title="M&A adviser league table rank, prior year vs. LTM",
              fields={"period": {"title": "Period"}, "bank": {"title": "Adviser"}, "rank": {"title": "Rank", "format": "0"}},
              source="Mergermarket league table LTM Sep-2026")
    r.dataset("offer_prices", offer_prices(refs))
    r.dataset("approach_events", LOCAL / "approach_events.json")
    r.dataset("outreach_funnel", LOCAL / "outreach_funnel.json")
    r.dataset("buyers", buyer_ds)
    r.dataset("scenario_long", scenario_long(), title="Management plan scenarios (long format)",
              fields={"scenario": {"title": "Scenario"}, "year": {"title": "Year"}, "metric": {"title": "Metric"},
                      "value": {"title": "USD m", "format": "$#,##0", "unit": "USD m"}},
              source="Helios management plan scenarios", unit="USD m")
    r.dataset("sotp_mix", mix, title="SOTP enterprise value by segment (mid-point)",
              fields={"segment": {"title": "Segment"},
                      "ev_mid": {"title": "Enterprise value (mid-point)", "format": "$#,##0", "unit": "USD m"}},
              source=SRC_NB, unit="USD m",
              notes="Mid-point of the low and high multiples; unallocated corporate costs excluded.")

    # Live DCF: the computed fields re-evaluate in the browser when the WACC / TGR sliders move.
    # Same maths as sensitivity_dcf (end-year discounting of 2026E–2030E FCF + Gordon growth TV),
    # so the base case (9.0% / 2.5%) reproduces the $50.88 shown in the sensitivity table.
    r.param("wacc", 0.09, min=0.075, max=0.105, step=0.0025, format="0.00%", title="WACC")
    r.param("tgr", 0.025, min=0.015, max=0.035, step=0.0025, format="0.00%", title="Terminal growth")
    # The proposal under review; the AVP table's stepper (and a click on a price column) moves it.
    r.param("offer", OFFER, min=42.5, max=60.0, step=0.25, format="$0.00", title="Offer price per share")
    pv = " + ".join(f"fcf_{y} / (1 + @wacc) ^ {i}" for i, y in enumerate(["26", "27", "28", "29", "30"], 1))
    # Two copies of the live DCF: "dcf_live" (what-if page; case column "case") always shows all three cases,
    # while "dcf_scenario" has a "scenario" column, so the scenario switch's filter (field "scenario") narrows it
    # to the selected case on the scenario page without touching the what-if page.
    for did, key in (("dcf_live", "case"), ("dcf_scenario", "scenario")):
        dcf_dataset(r, did, key, pv)
    terms = deal_terms(refs)
    r.dataset("deal_terms", terms["data"], title="Proposal terms (live with the offer price)", fields=terms["fields"],
              computed=terms["computed"], source=f"{SRC_NB}; {SRC_MKT}", unit="USD m")

    # Global filters in the sticky top bar. Scoped with `datasets` so the peer screen drives the
    # peer- and precedent-based pages only (segment / country charts also have a 'region' field).
    r.topbar_block("filter-bar", data="peers", options={
        "countLabel": "peers",
        "filters": [
            {"field": "sector", "type": "multi", "label": "Sector", "datasets": ["peers", "precedents"]},
            {"field": "region", "type": "multi", "label": "Region", "datasets": ["peers"]},
        ]})

    # ================================================================== cover & summary
    r.cover(kicker="Discussion materials", subtitle="Valuation perspectives, Granite Arch's proposal and a path to "
                                                    "maximising value")

    t = "Value of $45–55 per share: an auction should improve on $52.00"
    p = r.page(t, kicker="Executive summary", id="summary", nav="Executive summary",
               subtitle="USD unless otherwise stated; market data as of 10-Oct-2026",
               source=[SRC_MKT, SRC_NB], notes=FICTIONAL)
    p.block("kpi-tiles", data="kpis", height=150, options={"variant": "boxed", "columns": 6})
    p.block("text-block", height=150, options={
        "variant": "takeaways", "columns": 4,
        "items": [
            {"title": "Discount to peers",
             "text": "**9.2x** 2025E EBITDA vs. a peer median of **10.7x**, despite in-line margins of 18.5%."},
            {"title": "Value of $45–55 per share",
             "text": "DCF, sum-of-the-parts, precedents and premiums paid: a **6–29%** premium to $42.50."},
            {"title": "Granite Arch at $52.00",
             "text": f"Third proposal in eight weeks: **{OFFER / CURRENT_PRICE - 1:.0%}** premium to current, "
                     f"**{OFFER / refs['unaffected'] - 1:.0%}** to the unaffected price."},
            {"title": "Strategics can pay more",
             "text": f"With synergies, **{NUM[len(strat_over)]} strategics** can pay "
                     f"${min(b['with_synergies'] for b in strat_over):.0f}–{max(b['with_synergies'] for b in strat_over):.0f} "
                     "per share; sponsors are capped near $52."},
        ]})
    p.block("text-block", height=80, options={
        "variant": "callout", "kicker": "Recommendation", "tone": "accent2",
        "title": "Do not grant exclusivity at $52.00: run a targeted two-stage auction with Granite Arch as the floor",
        "text": "Board approval on 20-Oct; indicative offers due 11-Dec; final binding bids on 5-Mar-2027; signing by "
                "end-March."})

    # ================================================================== 01 business
    r.section("Business overview", subtitle="Financial profile, market position, business mix and global footprint")

    t = "Revenue has compounded at 6% since 2019 with a 270bp margin uplift; the plan adds 7% a year"
    p = r.page(t, kicker="Financial overview", id="financials", subtitle="USD m; FY26E–FY28E = management plan",
               source=SRC_PLAN)
    p.block("combo", data="financials", span=7, height=plot_h(t), title="Revenue and EBITDA margin, 2019A–2028E",
            options={"encode": {"x": "year", "bars": ["revenue"], "line": ["ebitda_margin"]},
                     "format": "$#,##0", "cagr": "split"})
    p.block("waterfall", data="ebitda_bridge", span=5, height=plot_h(t), title="EBITDA bridge FY25A to FY26E",
            options={"encode": {"label": "step", "value": "value", "kind": "kind", "category": "category"},
                     "orientation": "horizontal", "connectors": "dashed"})

    q = sample("quarterly")["data"]
    beats = sum(1 for x in q if x["beat_miss_pct"] > 0)
    surprise = sum(x["beat_miss_pct"] for x in q) / len(q)
    t = f"Helios has beaten revenue consensus in {beats} of the last {len(q)} quarters; average surprise {surprise:+.1%}"
    p = r.page(t, kicker="Track record", id="track-record", subtitle="Quarterly revenue vs. consensus at the time of "
               "reporting, USD m", source="Company filings; consensus per FactSet (pre-results)")
    p.block("bullet", data="quarterly", span=7, height=plot_h(t), title="Reported revenue vs. consensus",
            options={"encode": {"label": "quarter", "value": "revenue", "target": "consensus_revenue"},
                     "bands": [0.98, 1.02], "bandLabels": ["Miss (< 98%)", "In line", "Beat (> 102%)"],
                     "valueTitle": "Revenue", "varianceTitle": "vs. cons.", "targetLabel": "Consensus"})
    p.block("diverging-bar", data="quarterly", span=5, height=plot_h(t), title="Revenue beat / (miss) vs. consensus",
            options={"encode": {"label": "quarter", "value": "beat_miss_pct"}, "orientation": "vertical",
                     "sort": None, "highlight": "Q3-26"})

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

    t = "Helios is a top-3 player in each of its five markets, with 11% of a $44bn addressable market"
    p = r.page(t, kicker="Market position", id="market-position",
               subtitle="Addressable market by segment and player, 2025 (USD m); column width = segment size",
               source="Company information; Northbridge Capital market model (2025)")
    p.block("marimekko", data="market_share", height=plot_h(t, block_head=False),
            options={"encode": {"x": "segment", "series": "player", "value": "revenue"},
                     "highlight": "Helios Industrial"})

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

    # ================================================================== 02 market
    r.section("Market perspectives", subtitle="Share price performance, trading multiples and peer positioning")

    t = "Shares are up 21% in two years but have lagged peers since the June bid speculation faded"
    p = r.page(t, kicker="Trading performance", id="trading", subtitle="Two years to 13-Oct-2026", source=SRC_MKT)
    p.block("price-volume", data="price_ohlc", span=7, height=plot_h(t), title="Helios share price (USD) and volume",
            options={"eventsData": "price_events", "range52w": "band"})
    p.block("line", data="price_perf", span=5, height=plot_h(t), title="Relative performance (rebased to 100)",
            options={"encode": {"x": "date", "y": "value", "series": "series"}, "rebase": 100,
                     "highlight": "Helios Industrial"})

    t = "Helios has traded at an average 1.2x NTM EBITDA discount to peers over the past two years"
    p = r.page(t, kicker="Trading multiples", id="multiples", subtitle="Enterprise value / NTM EBITDA; peer ranking "
               "by the multiple selected", source=SRC_MKT)
    p.block("multiple-history", data="ntm_multiple", span=7, height=plot_h(t),
            title="NTM EV / EBITDA — Helios vs. peer median",
            options={"encode": {"x": "date", "y": "target", "compare": "peer_median"}, "sigma": 1})
    p.block("bar", data="peers", span=5, height=plot_h(t), title="Peer ranking",
            options={"encode": {"x": "ticker", "y": "ev_ebitda_25e"}, "orientation": "horizontal", "sort": "desc",
                     "highlight": "HLX", "avgLine": True,
                     "choices": {"y": ["ev_ebitda_25e", "ev_ebitda_26e", "ev_revenue_25e", "pe_25e"]}})

    t = ('Core peers trade at a median {{peers: median(if(sector != "Software & Sensors" and not is_target, '
         'ev_ebitda_25e)) | 0.0x}} 2025E EBITDA vs. 9.2x for Helios')
    t_len = "Core peers trade at a median 9.9x 2025E EBITDA vs. 9.2x for Helios"
    p = r.page(t, kicker="Trading comparables", id="comps",
               subtitle="Automation and Motion & Power peers; market data as of 10-Oct-2026; USD m", source=SRC_MKT,
               notes="Mean and median exclude Helios. Software & Sensors peers (median 15.5x 2025E EBITDA) are "
                     "shown on the peer positioning page; n.m. = not meaningful.")
    p.block("comps-table", data="peers", height=plot_h(t_len, block_head=False), options={
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

    t = ("{{peers: count(if(not is_target, ticker)) | 0}} listed peers trade at a median "
         "{{peers: median(if(not is_target, ev_ebitda_25e)) | 0.0x}} 2025E and "
         "{{peers: median(if(not is_target, ev_ebitda_26e)) | 0.0x}} 2026E EBITDA, vs. 9.2x and 8.2x for Helios")
    t_len = "17 listed peers trade at a median 10.7x 2025E and 9.5x 2026E EBITDA, vs. 9.2x and 8.2x for Helios"
    p = r.page(t, kicker="Relative valuation", id="relative",
               subtitle="EV / EBITDA; Helios highlighted; peers follow the sector and region filters", source=SRC_MKT,
               notes="Box = interquartile range, whiskers = 1.5x IQR; medians exclude Helios.")
    p.block("boxplot", data="peers", span=6, height=plot_h(t_len, notes=True, choices=True), title="Dispersion by sector",
            options={"encode": {"group": "sector", "value": "ev_ebitda_25e", "label": "ticker", "name": "company"},
                     "sort": "median",
                     "choices": {"value": ["ev_ebitda_25e", "ev_ebitda_26e", "ev_revenue_25e", "pe_25e"]}})
    p.block("slope", data="peers", span=6, height=plot_h(t_len, notes=True, choices=True), title="EV / EBITDA 2025E to 2026E",
            options={"encode": {"label": "ticker", "from": "ev_ebitda_25e", "to": "ev_ebitda_26e",
                                "highlight": "is_target"},
                     "colorBy": "neutral", "median": True, "headers": ["2025E", "2026E"]})

    t = "Growth explains half of the multiple dispersion; on its growth Helios would trade at ~10.7x"
    p = r.page(t, kicker="Peer positioning", id="positioning", subtitle="All 17 listed peers, 2025E; Helios "
               "highlighted; pick other metrics in the chart headers",
               source=SRC_MKT, notes="Regression across 17 listed peers (Helios excluded).")
    p.block("scatter", data="peers", span=7, height=plot_h(t, block_sub=True, notes=True, choices=True),
            title="Valuation drivers",
            subtitle="Line = least-squares fit across peers",
            options={"encode": {"x": "rev_growth_25e", "y": "ev_ebitda_25e", "label": "ticker", "name": "company"},
                     "regression": True, "tooltipFields": ["sector", "ebitda_margin_25e", "mkt_cap"],
                     "choices": {"x": ["rev_growth_25e", "ebitda_margin_25e", "tsr_1y", "net_debt_ebitda"],
                                 "y": ["ev_ebitda_25e", "ev_ebitda_26e", "ev_revenue_25e", "pe_25e", "*computed"]}})
    p.block("bubble", data="peers", span=5, height=plot_h(t, block_sub=True, notes=True, choices=True),
            title="EBITDA margin vs. revenue growth",
            subtitle="Bubble size = market capitalisation",
            options={"encode": {"x": "rev_growth_25e", "y": "ebitda_margin_25e", "size": "mkt_cap", "color": "sector",
                                "label": "ticker", "name": "company"},
                     "tooltipFields": ["ev_ebitda_25e"]})

    t = "Helios screens as the cheapest of its automation peers but below their median on growth, margin and returns"
    p = r.page(t, kicker="Peer scorecard", id="scorecard",
               subtitle="Percentile rank among the 18 listed companies (0–100, higher = better; valuation and "
                        "leverage inverted)", source=f"{SRC_MKT}; {SRC_NB}")
    p.block("radar", data="peer_scores", span=5, height=plot_h(t), title="Helios vs. automation peers",
            options={"encode": {"series": "company", "axis": "metric", "value": "score"},
                     "highlight": "Helios Industrial", "max": 100, "median": True, "peers": "muted"})
    p.block("heatmap", data="peer_scores", span=7, height=plot_h(t), title="Scorecard by metric",
            options={"encode": {"x": "metric", "y": "company", "value": "score"}, "scale": "sequential",
                     "xPosition": "top", "sortY": "value", "highlight": "Helios Industrial",
                     "summary": "mean", "summaryLabel": "Avg.", "format": "0"})

    # ================================================================== 03 valuation
    r.section("Valuation perspectives", subtitle="Intrinsic, market and transaction-based reference points")

    t = "Fundamental analyses support $45–55 per share, a 6–29% premium to the current $42.50"
    p = r.page(t, kicker="Valuation summary", id="valuation", subtitle="USD per share; share price as of 09-Oct-2026",
               source=SRC_NB, filters=False,
               notes=["DCF: 2026E–2030E management plan, end-year discounting.",
                      "LBO: 5.0x opening leverage, 20–25% sponsor IRR, 9.0x exit."])
    p.block("football-field", data="valuation_ranges", span=7, height=plot_h(t, block_sub=True, notes=True),
            title="Implied value per share by methodology", subtitle="Intrinsic, market and transaction-based ranges",
            options={"encode": {"label": "method", "low": "low", "high": "high", "group": "group", "note": "basis"},
                     "refLines": [CURRENT, {"value": OFFER, "label": "Granite Arch $52.00"}],
                     "refBand": {"from": 45, "to": 55, "label": "Indicative range $45–55"}})
    p.block("sensitivity-table", data="sensitivity_dcf", span=5, height=plot_h(t, block_sub=True, notes=True),
            title="DCF sensitivity: value per share", subtitle="Click a cell to move the base case",
            options={"encode": {"row": "wacc", "col": "tgr", "value": "value"},
                     "rowTitle": "WACC", "colTitle": "Terminal growth rate", "base": {"row": "@wacc", "col": "@tgr"}})

    t = (f"Sum-of-the-parts supports ${ps_lo:.0f}–{ps_hi:.0f} per share; Sensors and Software carry "
         f"{sens_sw_share:.0%} of the value")
    p = r.page(t, kicker="Sum-of-the-parts", id="sotp",
               subtitle="Segment EBITDA / revenue 2026E x peer-based multiple ranges; USD m unless stated",
               source=f"{SRC_NB}; {SRC_PLAN}", filters=False,
               notes="Software & Services on EV / Revenue; corporate costs at the blended multiple. Sensors and "
                     "Software are 36% of FY25A revenue.")
    p.block("sotp", data="sotp", span=8, height=plot_h(t, notes=True), title="Enterprise value build-up to value per share",
            options={"encode": {"note": "note"}, "netDebt": NET_DEBT, "netDebtNote": "Gross debt $2,105m less cash $615m",
                     "deductions": [{"label": "Less: other adjustments", "value": -OTHER_ADJ,
                                     "note": "Pension (120), minorities (85), associates +60"}],
                     "shares": SHARES, "refPrice": CURRENT_PRICE,
                     "refLines": [{"price": OFFER, "label": "Granite Arch $52.00"}],
                     "evMetric": {"label": "EV / EBITDA 2026E", "value": EBITDA_26E}})
    p.block("waffle", data="sotp_mix", span=4, height=plot_h(t, notes=True), title="Value mix (mid-point EV)",
            options={"encode": {"label": "segment", "value": "ev_mid"}, "sort": None, "format": "$#,##0"})

    t = ("Each 50bp of WACC moves DCF value by c.$5 per share; at {{@wacc | 0.00%}} WACC the base case "
         "implies {{dcf_live: first(if(case == \"Base\", implied_price)) | $0.00}}")
    t_len = "Each 50bp of WACC moves DCF value by c.$5 per share; at 9.00% WACC the base case implies $50.88"
    p = r.page(t, kicker="Valuation · what-if", id="what-if",
               subtitle="Drag the sliders: values recompute live in the browser", filters=False,
               source=f"{SRC_NB}; management plan scenarios. DCF on 2026E–2030E unlevered FCF with Gordon-growth "
                      "terminal value.")
    p.block("param-slider", data="dcf_live", span=6, height=plot_h(t_len), title="DCF assumptions", options={
        "params": ["wacc", "tgr"], "columns": 1,
        "preview": {"fields": ["case", "implied_ev", "implied_price", "premium"], "title": "Live output (USD m)"}})
    p.block("bar", data="dcf_live", span=6, height=plot_h(t_len), title="Implied value per share by scenario",
            options={"encode": {"x": "case", "y": "implied_price"}, "orientation": "horizontal",
                     "highlight": "Base", "refLines": [CURRENT], "format": "$0.00"})

    t = ('{{scenarios: first(scenario)}} case: revenue grows {{scenarios: cagr(sum(if(year == "2030E", revenue, 0)), '
         'sum(if(year == "2025A", revenue, 0)), 5) | 0.0%}} a year to 2030E; the DCF implies '
         '{{dcf_scenario: first(implied_price) | $0.00}} per share')
    t_len = "Base case: revenue grows 6.6% a year to 2030E; the DCF implies $50.88 per share"
    p = r.page(t, kicker="Scenario analysis", id="scenarios",
               subtitle="Management plan cases, 2025A–2030E (USD m); choose a case — the charts, DCF and headline follow",
               source=f"Helios management plan scenarios; {SRC_NB}",
               notes="DCF at the WACC and terminal growth set on the what-if page (default 9.0% / 2.5%).")
    sw_h = 74   # the switch sizes to its content (label, buttons, caption)
    p.block("scenario-switch", data="scenarios", height=sw_h, options={
        "field": "scenario", "label": "Management plan case", "default": "Base",
        "metric": {"field": "ebitda", "where": "year == \"2030E\"", "format": "$#,##0\"m\"", "label": "EBITDA 2030E"},
        "descriptions": {
            "Base": "Management plan: 6.6% revenue CAGR 2025A–30E, EBITDA margin expanding to 20.5%.",
            "Upside": "Accelerated automation demand: 8.8% revenue CAGR, 22.0% EBITDA margin by 2030E.",
            "Downside": "Industrial slowdown: 3.2% revenue CAGR, margins flat at c.18.5%."}})
    row2 = plot_h(t_len, notes=True, above=sw_h + 36 + 20)
    p.block("small-multiples", data="scenario_long", span=8, height=row2, title="Revenue, EBITDA and unlevered FCF",
            options={"encode": {"x": "year", "y": "value", "facet": "metric"}, "type": "bar", "sharedY": False,
                     "columns": 3, "format": "$#,##0"})
    p.block("text-block", data="dcf_scenario", span=4, height=row2, title="DCF for the selected case", options={
        "variant": "stats", "columns": 1,
        "items": [
            {"field": "implied_price", "label": "Value per share", "note": "Premium to current {{premium|+0%;-0%}}",
             "tone": "accent2"},
            {"field": "implied_ev", "format": "$#,##0\"m\"", "label": "Enterprise value",
             "note": "PV of terminal value {{pv_tv|$#,##0\"m\"}}"},
        ]})

    t = ("Precedent deals were struck at a median {{precedents: median(ev_ebitda) | 0.0x}} LTM EBITDA and a "
         "{{precedents: median(premium_30d) | 0%}} premium to the 30-day VWAP")
    t_len = "Precedent deals were struck at a median 10.3x LTM EBITDA and a 37% premium to the 30-day VWAP"
    p = r.page(t, kicker="Precedent transactions", id="precedents",
               subtitle="Selected industrial-technology transactions announced since 2023; headline and premia 2019–2026",
               source="Mergermarket, company announcements",
               notes="Brennick Robotics was acquired by Helios (Jul-2025). Full list in the appendix.")
    p.block("comps-table", data="precedents", span=9, height=plot_h(t_len, notes=True) - 4,
            title="Selected precedent transactions",
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
    p.block("histogram", data="precedents", span=3, height=plot_h(t_len, block_sub=True, notes=True) - 4,
            title="Premia paid", subtitle="To 30-day VWAP, 2019–26",
            options={"encode": {"value": "premium_30d", "label": "target", "name": "target"},
                     "binWidth": 0.05, "format": "0%", "stats": ["median"]})

    t = "A sponsor can pay c.$46 per share (9.0x FY26E EBITDA) and still earn a 20% IRR"
    p = r.page(t, kicker="Value to shareholders", id="bridge",
               subtitle="DCF base case enterprise value to equity value (USD m); LBO sponsor IRR", filters=False,
               source=f"{SRC_NB}; Helios balance sheet as of 30-Sep-2026",
               notes="LBO: entry 31-Dec-2026, exit 31-Dec-2030; 5.0x opening leverage at 8.5%, 2.5% fees.")
    p.block("waterfall", data="ev_equity_bridge", span=7, height=plot_h(t, block_sub=True, notes=True),
            title="Enterprise value to equity value",
            subtitle="DCF base case (WACC 9.0%, terminal growth 2.5%) = $50.88 per share",
            options={"encode": {"label": "step", "value": "value", "kind": "kind"}, "format": "$#,##0"})
    p.block("sensitivity-table", data="sensitivity_lbo", span=5, height=plot_h(t, block_sub=True, notes=True),
            title="LBO sponsor IRR", subtitle="Entry vs. exit EV / EBITDA multiple",
            options={"encode": {"row": "entry_multiple", "col": "exit_multiple", "value": "irr"},
                     "rowTitle": "Entry multiple", "colTitle": "Exit multiple", "mid": 0.2, "base": {"row": 9, "col": 9}})

    # ================================================================== 04 M&A process
    r.section("Strategic alternatives & sale process",
              subtitle="Granite Arch's proposal, buyer universe, process, timetable and financing")

    t = (f"Granite Arch has raised its proposal twice in eight weeks, to $52.00: "
         f"{OFFER / refs['unaffected'] - 1:.0%} above the unaffected price")
    p = r.page(t, kicker="Situation overview", id="situation",
               subtitle=f"Helios share price (USD) since April 2026; unaffected price ${refs['unaffected']:.2f} "
                        "(17-Jun-2026 close)",
               source=f"{SRC_MKT}; company information",
               notes="Proposals are confidential and non-binding; none has been disclosed to the market.")
    p.block("candlestick", data="price_ohlc", span=7, height=plot_h(t, notes=True), title="Share price and proposal levels",
            options={"where": "date >= \"2026-04-13\"", "ma": [50], "rangeSelector": False, "zoom": False,
                     "refLines": [{"value": v, "label": lab} for v, lab in PROPOSALS]})
    p.block("timeline", data="approach_events", span=5, height=plot_h(t, notes=True), title="Chronology of the approach",
            options={"orientation": "vertical", "showDetail": "auto", "today": "2026-10-14",
                     "highlight": "Final proposal: $52.00", "selectBy": None,
                     "kindLabels": {"market": "Market", "proposal": "Proposal", "board": "Board"},
                     "kindColors": {"market": "ink2", "proposal": "accent3", "board": "accent"}})

    t = ("{{@offer | $0.00}} values Helios at {{deal_terms: ev_ebitda_26e | 0.0x}} FY26E EBITDA: "
         "{{deal_terms: prem_unaffected | 0%}} above unaffected")
    t_len = "$52.00 values Helios at 9.7x FY26E EBITDA: 32% above unaffected"
    p = r.page(t, kicker="The proposal in context", id="proposal",
               subtitle="Analysis at various prices (USD; 158.0m diluted shares, net debt $1,490m); step the offer "
                        "to update the table and the headline",
               source=f"{SRC_NB}; {SRC_MKT}; Mergermarket", filters=False,
               notes="Current = 09-Oct-2026 close; 52-week high on a closing basis; unaffected = 17-Jun-2026 close, "
                     "the day before press reports of sponsor interest.")
    p.block("avp-table", data="offer_prices", span=8, height=plot_h(t_len, notes=True), title="Analysis at various prices",
            options={
                "where": "price != 45",   # current price, the three proposals and the $55.00 level
                "offer": "@offer", "offerStep": 0.25, "shares": SHARES, "netDebt": NET_DEBT, "autoNotes": False,
                "references": [
                    {"label": "Current", "value": refs["current"]},
                    {"label": "52-week high", "value": refs["high52"]},
                    {"label": "Unaffected", "value": refs["unaffected"]}],
                "metrics": [
                    {"group": "Implied EV / EBITDA", "label": "2025A", "name": "EBITDA 2025A", "value": EBITDA_25A,
                     "kind": "ev", "metricFormat": "$#,##0.0"},
                    {"group": "Implied EV / EBITDA", "label": "2026E", "name": "EBITDA 2026E", "value": EBITDA_26E,
                     "kind": "ev", "metricFormat": "$#,##0.0"}]})
    p.block("beeswarm", data="precedents", span=4, height=plot_h(t_len, block_sub=True, notes=True),
            title="Premia paid vs. the proposal",
            subtitle=f"To 30-day VWAP; proposal vs. unaffected ${refs['vwap30_unaffected']:.2f}",
            options={"encode": {"label": "target", "value": "premium_30d", "group": "consideration"},
                     "symbolSize": 10, "overall": False, "format": "0%",
                     "refLines": [{"value": round(prem_vwap_unaff, 4), "label": f"$52.00: {prem_vwap_unaff:.0%}"}]})

    t = "$165bn of cross-border industrials M&A since 2021 points to a deep, global buyer universe"
    p = r.page(t, kicker="M&A landscape", id="ma",
               subtitle="Announced cross-border deals by acquirer and target country, 2021–2026 YTD (USD bn)",
               source="Mergermarket; league table LTM Sep-2026")
    p.block("flow-map", data="deal_flows", span=7, height=plot_h(t), title="Cross-border industrials M&A flows",
            options={"labels": 6, "maxFlows": 18})
    p.block("league-table", data="league_table", span=5, height=plot_h(t), title="M&A adviser league table",
            options={"highlight": FIRM, "top": 10, "titles": {"value": "Value", "count": "Deals"}})

    t = (f"{NUM[len(strat_over)].capitalize()} strategics can top $52.00 once synergies are shared; Granite Arch "
         f"is close to its ${bmap['Granite Arch Partners']['with_synergies']:.0f} ceiling")
    p = r.page(t, kicker="Buyer universe · ability to pay", id="buyers",
               subtitle="USD per share unless stated; synergies capitalised at 7.5x net of integration costs",
               source=f"{SRC_NB}; {SRC_MKT}",
               notes=f"Cash capacity: equity price fundable with debt at {MAX_LEVERAGE:.1f}x pro forma net debt / "
                     "2026E EBITDA incl. Helios' net debt; Kanemori pro forma for Tarrant.")
    p.block("dumbbell", data="buyers", span=7, height=plot_h(t, notes=True), title="Ability to pay: without and with synergies",
            options={"encode": {"label": "buyer", "from": "standalone", "to": "with_synergies"},
                     "colorBy": "single", "sort": "to", "delta": "abs", "deltaTitle": "Synergies",
                     "fromLabel": "No synergies", "toLabel": "With synergies", "highlight": "Granite Arch Partners",
                     "refLines": [CURRENT, {"value": OFFER, "label": "Final proposal $52.00"}]})
    p.block("lollipop", data="buyers", span=5, height=plot_h(t, notes=True), title="Strategics' cash capacity at 3.0x leverage",
            options={"where": "type == \"Strategic\"", "encode": {"label": "buyer", "value": "cash_capacity"},
                     "refLine": None, "format": "$#,##0.0,\"bn\"",
                     "refLines": [{"value": round(equity_at_offer, 1),
                                   "label": "At $52:"}]})

    t = "Kanemori, Valdris and Corvane overlap with c.$1bn of Helios revenue each: most synergies, most antitrust risk"
    p = r.page(t, kicker="Buyer universe · strategic logic", id="buyer-map",
               subtitle="Helios' ecosystem (USD m of annual sales, spend or overlapping revenue); buyer screen "
                        "(scores 1–5)", source=f"{SRC_NB}; company information",
               notes="Brush an axis of the buyer screen to shortlist; regulatory axis inverted (top = lowest risk).")
    p.block("network", data="network_edges", span=7, height=plot_h(t, notes=True), title="Customers, suppliers, competitors, "
            "partners", options={
                "nodesData": "network_nodes", "highlight": "helios-industrial", "labelTop": 14, "roam": False,
                # node channels (id / name / category / size) keep their defaults: id, name, type, size of nodesData
                "encode": {"source": "source", "target": "target", "value": "value", "edgeType": "type"}})
    p.block("parallel", data="buyers", span=5, height=plot_h(t, notes=True), title="Buyer screen",
            options={"encode": {"label": "buyer", "color": "type"}, "median": False,
                     "highlight": "Granite Arch Partners",
                     "dims": [{"field": "fit", "title": "Fit", "min": 1, "max": 5},
                              {"field": "synergies", "title": "Synergies"},
                              {"field": "with_synergies", "title": "Ability to pay"},
                              {"field": "regulatory", "title": "Reg. risk", "inverse": True, "min": 1, "max": 5},
                              {"field": "certainty", "title": "Certainty", "min": 1, "max": 5}]})

    t = "Twelve institutions and strategics hold 46% of the shares; Ardent Family (7.5%) is pivotal"
    p = r.page(t, kicker="Shareholder base", id="ownership", subtitle="Basic shares outstanding 155.2m",
               source="Share register as of 30-Sep-2026; company information")
    p.block("donut", data="ownership", span=5, height=plot_h(t), title="Shareholders by investor type",
            options={"encode": {"label": "type", "value": "shares_m"}, "centerLabel": "Shares (m)"})
    p.block("comps-table", data="ownership", span=7, height=plot_h(t), title="Largest shareholders", options={
        "encode": {"label": "holder"}, "labelTitle": "Holder", "where": "type != \"Retail\" and type != \"Insider\"",
        "highlight": "Ardent Family Holdings", "stats": [], "dense": True, "scroll": False, "crossFilter": False,
        "sort": {"field": "pct", "dir": "desc"},
        "columns": [{"field": "type", "title": "Type"},
                    {"field": "shares_m", "title": "Shares (m)"}, {"field": "pct", "title": "% of total", "heat": "seq"},
                    {"field": "change_qoq_m", "title": "QoQ (m)", "sign": True}]})

    t = "A targeted auction: c.40 parties approached to secure 3 binding bids by 5-March 2027"
    p = r.page(t, kicker="Process design", id="process",
               subtitle="Expected buyer funnel and key milestones of a two-stage process",
               source=f"{FIRM}; median of 12 industrials sale processes advised since 2022",
               notes="Granite Arch would be invited to participate on the same terms as other bidders.")
    p.block("funnel", data="outreach_funnel", span=6, height=plot_h(t, notes=True), title="Expected buyer funnel",
            options={"encode": {"stage": "stage", "value": "parties", "secondary": "strategics"},
                     "cumulative": False, "highlight": "Final binding bids", "crossFilter": False})
    p.block("timeline", data="deal_timeline", span=6, height=plot_h(t, notes=True), title="Key milestones",
            options={"where": "milestone == true",
                     "encode": {"date": "start", "label": "task", "kind": "phase", "detail": "owner"},
                     "marker": "number", "today": "2026-10-14", "selectBy": None, "labelWidth": 150})

    t = "A two-stage auction can deliver signing by end-March 2027 and closing in July"
    p = r.page(t, kicker="Next steps · indicative timetable", id="timetable", source=FIRM)
    p.block("gantt", data="deal_timeline", height=plot_h(t, block_head=False, page_sub=False),
            options={"today": "2026-10-14", "calendar": "months", "zoom": False})

    t = "Granite Arch's $52.00 is fully financed: 5.0x FY26E EBITDA of debt and a $4.9bn equity cheque"
    p = r.page(t, kicker="Financing", id="financing",
               subtitle="Illustrative LBO sources & uses at $52.00 per share (USD m)",
               source=f"{SRC_NB}; bank financing letters; {SRC_PLAN}", filters=False,
               notes="Multiples of 2026E EBITDA of $996.5m. Floating rates at 3-month SOFR of 4.33% plus margin.")
    p.block("sources-uses", data="sources_uses", height=plot_h(t, notes=True), title="Sources and uses of funds",
            options={"highlight": "Sponsor equity", "columns": ["amount", "pct", "multiple"]})

    t = f"Northbridge is the #1 adviser in industrials M&A, with ${cred_total:.0f}bn of sector deals since 2024"
    p = r.page(t, kicker="Why Northbridge", id="credentials",
               subtitle="Selected transactions advised by Northbridge Capital; league table rank, prior year vs. LTM",
               source=f"{FIRM} deal records; Mergermarket league table LTM Sep-2026", filters=False, notes=FICTIONAL)
    p.block("tombstones", data="credentials", span=8, height=plot_h(t, notes=True), title="Selected credentials",
            options={"where": "deal_type != \"Acquisition financing\"", "columns": 3, "max": 6,
                     "highlight": "Helios Industrial", "facets": [], "variant": "minimal",
                     "monogram": False, "crossFilterScope": "dataset"})
    p.block("bump", data="league_ranks", span=4, height=plot_h(t, notes=True), title="League table rank",
            options={"encode": {"x": "period", "series": "bank", "rank": "rank"},
                     "highlight": FIRM, "top": 8, "showValue": False})

    # ================================================================== appendix
    r.section("Appendix", subtitle="Supplementary analysis, client tools and data")

    t = "Appendix: explore the data and build your own metrics and queries"
    p = r.page(t, nav="Appendix · client analysis", id="explore",   # no kicker: the console needs the room
               source="Runs locally in your browser and respects the top-bar filters; no data leaves this file.")
    p.block("query-console", data="peers", height=480, options={   # the console needs >= 480 px
        "datasets": ["peers", "financials", "precedents", "segment_revenue", "buyers"],
        "highlight": "Helios Industrial", "tab": "query",
        "builder": {"values": [{"agg": "median", "field": "ev_ebitda_25e"}, {"agg": "median", "field": "ebitda_margin_25e"}],
                    "rows": ["sector"], "sort": {"col": "v0", "dir": "desc"}},
        "examples": [
            {"label": "Sector medians", "query": "median(ev_ebitda_25e), median(ebitda_margin_25e) by sector from peers"},
            {"label": "European peers by EV/EBITDA",
             "query": "company, ev / ebitda_25e as \"EV/EBITDA\" format \"0.0x\" from peers where region == \"Europe\" sort 2 desc"},
            {"label": "FY25A revenue by segment",
             "query": "sum(revenue) as \"Revenue\" by segment from segment_revenue where year == \"2025A\" sort 2 desc"},
            {"label": "Buyers above $52.00",
             "query": "buyer, type, with_synergies from buyers where with_synergies > 52 sort 3 desc"},
        ]})

    fs = flow_stats()
    peak = max(sample("daily_activity")["data"], key=lambda d: d["value"])
    avg_act = sum(d["value"] for d in sample("daily_activity")["data"]) / len(sample("daily_activity")["data"])
    t = (f"Trading volume hit {peak['value'] / avg_act:.0f}x its 2026 average on the June press reports; "
         "returns have been volatile month to month")
    p = r.page(t, kicker="Appendix · trading statistics", id="appendix-trading",
               subtitle="Daily trading activity 2026 YTD (volume index, 2026 average ≈ 100); monthly total shareholder "
                        "return", source=SRC_MKT)
    cal_h = 150
    p.block("calendar-heatmap", data="daily_activity", height=cal_h, title="Daily trading activity, 2026 YTD",
            options={"mode": "daily"})
    p.block("calendar-heatmap", data="monthly_returns", height=plot_h(t, above=cal_h + 36 + 20),
            title="Monthly total shareholder return",
            options={"mode": "monthly", "encode": {"year": "year", "month": "month", "value": "return"}})

    sites = site_regions()
    t = (f"{sum(sites.values())} sites in 24 countries, spread across Asia Pacific ({sites['Asia Pacific']}), "
         f"Europe ({sites['Europe']}) and the Americas ({sites['North America'] + sites['Latin America']})")
    p = r.page(t, kicker="Appendix · footprint", id="appendix-footprint",
               subtitle="Operating sites by type; floor area ('000 sq m)", source="Company information (FY25A)")
    p.block("cluster-map", data="assets_locations", span=6, height=plot_h(t), title="Sites clustered by proximity",
            options={"encode": {"lat": "lat", "lon": "lon", "label": "name", "color": "type", "value": "capacity"},
                     "tooltip": ["city", "country", "utilization", "opened"]})
    p.block("geo-heat", data="assets_locations", span=6, height=plot_h(t), title="Floor-area density",
            options={"encode": {"lat": "lat", "lon": "lon", "weight": "capacity", "label": "name"},
                     "tooltip": ["type", "city"]})

    g = revenue_growth()
    t = (f"Revenue detail: {g['segment'][0]} ({g['segment'][1]:.1%} a year) and {g['region'][0]} "
         f"({g['region'][1]:.1%}) have compounded fastest since 2021")
    p = r.page(t, kicker="Appendix · revenue detail", id="appendix-revenue",
               subtitle="Revenue by segment, 2021A–2026E (USD m; expand a segment for its regions); FY25A product lines",
               source=SRC_PLAN)
    piv_h = 222
    p.block("pivot-table", data="segment_revenue", span=8, height=piv_h, title="Revenue by segment and region",
            options={"rows": ["segment", "region"], "cols": "year", "value": "revenue", "agg": "sum",
                     "format": "#,##0", "cagr": True, "sort": "total-desc", "collapsed": True})
    p.block("sunburst", data="segments_tree", span=4, height=piv_h, title="FY25A product lines",
            options={"encode": {"id": "id", "parent": "parent", "name": "name", "value": "value"}})
    cell = g["cell"]
    p.block("text-block", height=plot_h(t, above=piv_h + 36 + 20), title="Fastest-growing, 2021A–2026E CAGR",
            options={"variant": "stats", "columns": 3, "items": [
                {"value": f"{g['segment'][1]:.1%}", "label": f"Segment: {g['segment'][0]}", "tone": "accent2"},
                {"value": f"{g['region'][1]:.1%}", "label": f"Region: {g['region'][0]}"},
                {"value": f"{cell[1]:.1%}", "label": f"Cell: {cell[0][0]}, {cell[0][1]}"}]})

    t = (f"US and German companies lead ${fs['total']:.0f}bn of cross-border industrials M&A; the US is the "
         f"largest target market ({fs['us_in_share']:.0%})")
    p = r.page(t, kicker="Appendix · M&A corridors", id="appendix-corridors",
               subtitle="Announced cross-border deal value by acquirer and target country, 2021–2026 YTD (USD bn)",
               source="Mergermarket")
    p.block("chord", data="deal_flows", span=7, height=plot_h(t), title="Acquirer to target country",
            options={"encode": {"source": "from_country", "target": "to_country", "value": "value", "count": "deals"},
                     "top": 9, "highlight": "United States"})
    big = fs["biggest"]
    rbc = sample("revenue_by_country")["data"]
    us_rev = sum(c["revenue"] for c in rbc if c["country"] == "United States") / sum(c["revenue"] for c in rbc)
    p.block("text-block", span=5, height=plot_h(t), title="Reading the corridors", options={
        "variant": "stats", "columns": 1,
        "items": [
            {"value": f"${fs['top_out'][1]:.0f}bn", "label": f"Largest acquirer market: {fs['top_out'][0]}",
             "note": f"{fs['top_out'][1] / fs['total']:.0%} of cross-border value"},
            {"value": f"${fs['top_in'][1]:.0f}bn", "label": f"Largest target market: {fs['top_in'][0]}",
             "note": f"Where Helios earns {us_rev:.0%} of its revenue"},
            {"value": f"${big['value']:.1f}bn", "label": f"Largest corridor: {big['from_country']} to {big['to_country']}",
             "note": f"{big['deals']} deals, {SECTOR_SHORT.get(big['sector'], big['sector'])}", "tone": "accent2"},
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

    t = "Important notice"
    p = r.page(t, kicker="Disclaimer", id="disclaimer", filters=False, source=FIRM, notes=FICTIONAL)
    p.block("text-block", height=plot_h(t, block_head=False, page_sub=False), options={
        "variant": "prose", "columns": 2,
        "text": (
            "These materials have been prepared by Northbridge Capital (\"Northbridge\") for the exclusive use of the "
            "Board of Directors of Helios Industrial (the \"Company\") in connection with its evaluation of the "
            "proposal received from Granite Arch Partners and of other strategic alternatives. They may not be "
            "used for any other purpose, or disclosed, reproduced or distributed to any other person, without "
            "Northbridge's prior written consent.\n\n"
            "The materials are based on publicly available information and on information provided by the Company, "
            "which Northbridge has assumed to be accurate and complete without independent verification. "
            "Projections reflect the Company's management plan and Northbridge's judgement as of the date shown; "
            "they are inherently uncertain and actual results may differ materially.\n\n"
            "Nothing in these materials constitutes a fairness opinion, a recommendation to any shareholder, or an "
            "offer to buy or sell any security. Valuation ranges are preliminary and illustrative, do not reflect "
            "every factor a buyer may consider, and will change with market conditions and further due diligence.\n\n"
            "Northbridge is acting for the Company and no one else and will not be responsible to anyone other than "
            "the Company for providing the protections afforded to its clients. Northbridge and its affiliates may "
            "hold positions in, or provide services to, companies mentioned in these materials.\n\n"
            "Interactive features (filters, sliders, metric pickers and queries) recompute figures in the reader's "
            "browser; pages marked as unfiltered always show the base analysis. "
            "Illustrative: all companies, banks and investors in this document are fictional.")})

    return r.build(out, **build_kw)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build the Project Atlas demo pitchbook.")
    ap.add_argument("out", nargs="?", default=str(ROOT / "examples" / "demo-pitchbook"), help="output folder")
    ap.add_argument("--single-file", action="store_true", help="write one self-contained HTML file")
    ap.add_argument("--excel", action="store_true", help="also export every dataset to data/<slug>.xlsx (openpyxl)")
    ap.add_argument("--theme", default="navy", choices=["navy", "bronze", "slate", "ink"], help="house theme")
    a = ap.parse_args(argv)
    path = build(Path(a.out), theme=a.theme, single_file=a.single_file, excel=a.excel)
    print(f"built {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
