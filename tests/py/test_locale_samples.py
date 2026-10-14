"""Builder localisation (zh-CN sources / confidentiality / theme menu / slugs), the validator against every
gallery sample in kit/components/*/manifest.json, and the sample-data reference prices.

Run:  cd <repo> && python3 -m unittest discover -s tests/py -v

Unlike test_builder.py these tests use the real kit (components, manifests, kit/samples) — they guard the
contract between the builder and what the gallery shows.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import unittest
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "py"))

from reportkit import Kit, Report  # noqa: E402
from reportkit._util import colon, list_sep, notes_text, slugify, source_text  # noqa: E402
from reportkit.kit import THEME_LABELS_BY_LANG  # noqa: E402
from reportkit.report import default_confidentiality  # noqa: E402

SAMPLES = ROOT / "kit" / "samples" / "datasets"
# report params every gallery sample may use (gallery/gallery.js PARAMS)
GALLERY_PARAMS = {"wacc": dict(value=0.09, min=0.07, max=0.11, step=0.0025, format="0.00%", title="WACC"),
                  "tgr": dict(value=0.025, min=0.01, max=0.04, step=0.0025, format="0.00%", title="Terminal growth")}


def sample(did: str) -> dict:
    return json.loads((SAMPLES / f"{did}.json").read_text(encoding="utf-8"))


def kit() -> Kit:
    return Kit(ROOT)


# ---------------------------------------------------------------------------------------------
# Slugs
# ---------------------------------------------------------------------------------------------
class SlugTests(unittest.TestCase):
    def test_ascii_behaviour_unchanged(self):
        cases = {
            "Implied value — $4.2bn": "implied-value-4-2bn",
            "Café crème": "cafe-creme",
            "Kingsgate’s 8.5× deal": "kingsgates-8-5-deal",       # non-ASCII symbols are dropped, as before
            "Δ EBITDA margin FY22A–25A": "ebitda-margin-fy22a25a",  # Greek symbols in English text: as before
            "ＡＢＣ１２３": "abc123",
            "": "", "—": "",
        }
        for text, slug in cases.items():
            self.assertEqual(slugify(text), slug, text)
        self.assertEqual(slugify("abc-def-" * 10), "abc-def-abc-def-abc-def-abc-def-abc-def-abc-def")
        self.assertEqual(slugify("x" * 60, 32), "x" * 32)

    def test_cjk_titles_keep_their_characters(self):
        self.assertEqual(slugify("远航项目"), "远航项目")
        self.assertEqual(slugify("估值：DCF 与可比公司"), "估值-dcf-与可比公司")
        self.assertEqual(slugify("华辰智能（A+H）收购凯斯勒"), "华辰智能-a-h-收购凯斯勒")
        self.assertEqual(slugify("交易结构 · 2025年10月9日"), "交易结构-2025年10月9日")
        self.assertEqual(slugify("がぎ ポンプ"), "がぎ-ポンプ")
        self.assertEqual(slugify("Москва 2025"), "москва-2025")
        # a wide character counts two columns towards max_len
        self.assertEqual(slugify("很长的标题" * 20, 32), "很长的标题很长的标题很长的标题很")
        # ascii_only: dataset ids stay ASCII
        self.assertEqual(slugify("估值：DCF 与可比公司", ascii_only=True), "dcf")
        self.assertEqual(slugify("远航项目", ascii_only=True), "")

    def test_chinese_report_ids_file_names_and_auto_datasets(self):
        r = Report("远航项目", locale="zh-CN", date="2026-10-14")
        p = r.page("估值汇总", kicker="估值")
        b = p.block("kpi-tiles", data=[{"label": "企业价值", "value": 93.6}], title="关键指标")
        p2 = r.page("交易结构")
        r.resolve_ids()
        self.assertEqual(p.id, "估值")
        self.assertEqual(p2.id, "交易结构")
        self.assertEqual(b.id, "估值-关键指标")
        self.assertEqual(b.data, "data")                 # auto dataset ids stay ASCII (file names, JS keys)
        from reportkit.build import report_slug
        self.assertEqual(report_slug(r), "远航项目")
        with tempfile.TemporaryDirectory() as tmp, warnings.catch_warnings():
            warnings.simplefilter("ignore")
            out = r.build(Path(tmp), single_file=True, kit=ROOT)
            self.assertEqual(out.name, "远航项目.html")
            html = out.read_text(encoding="utf-8")
            self.assertIn('id="估值"', html)


# ---------------------------------------------------------------------------------------------
# Sources / notes / confidentiality / theme menu
# ---------------------------------------------------------------------------------------------
class LocaleTextTests(unittest.TestCase):
    def test_source_line(self):
        self.assertEqual(source_text("FactSet", "en-US"), "Source: FactSet")
        self.assertEqual(source_text(["FactSet", "Company filings"], "en-US"), "Sources: FactSet; Company filings")
        self.assertEqual(source_text("Sources: A; B", "en-US"), "Sources: A; B")
        self.assertEqual(source_text("万得", "zh-CN"), "资料来源：万得")
        self.assertEqual(source_text(["万得", "公司公告"], "zh-CN"), "资料来源：万得；公司公告")
        # text that already carries a label is printed as is (no "资料来源：资料来源：…")
        self.assertEqual(source_text("资料来源：万得；公司公告", "zh-CN"), "资料来源：万得；公司公告")
        self.assertEqual(source_text("来源：公司公告", "zh-CN"), "来源：公司公告")
        self.assertEqual(source_text(None, "zh-CN"), "")
        self.assertEqual((colon("zh-CN"), list_sep("zh-CN"), colon("en"), list_sep("en")), ("：", "；", ": ", "; "))

    def test_notes_line(self):
        self.assertEqual(notes_text("示例数据", "zh-CN"), "注：示例数据")
        self.assertEqual(notes_text("注：示例数据", "zh-CN"), "注：示例数据")
        self.assertEqual(notes_text("注册资本按期末汇率折算", "zh-CN"), "注：注册资本按期末汇率折算")
        self.assertEqual(notes_text(["A", "B"], "en-US"), "Notes: (1) A (2) B")

    def test_page_footer_sources_in_chinese(self):
        r = Report("项目", locale="zh-CN", date="2026-10-14")
        r.dataset("a", [{"x": "甲", "value": 1}], source="万得")
        r.dataset("b", [{"x": "乙", "value": 2}], source=["公司公告", "万得"])
        p = r.page("标题")
        p.block("bar", data="a", encode={"x": "x", "y": "value"}, span=6)
        p.block("bar", data="b", encode={"x": "x", "y": "value"}, span=6)
        html = r.html(kit=ROOT)
        self.assertIn('<span class="rk-page__source">资料来源：万得；公司公告</span>', html)

    def test_default_confidentiality_follows_locale(self):
        self.assertEqual(Report("T").confidentiality, "Strictly private & confidential")
        self.assertEqual(Report("T", locale="zh-CN").confidentiality, "严格保密")
        self.assertEqual(Report("T", locale="zh").confidentiality, "严格保密")
        self.assertEqual(Report("T", locale="en-GB").confidentiality, "Strictly private & confidential")
        self.assertIsNone(Report("T", locale="zh-CN", confidentiality=None).confidentiality)
        self.assertEqual(Report("T", locale="zh-CN", confidentiality="机密").confidentiality, "机密")
        self.assertEqual(default_confidentiality("zh-Hans"), "严格保密")
        # spec round trip keeps the line; an explicit null in a spec still means "no line"
        r = Report("T", locale="zh-CN")
        self.assertEqual(Report.from_spec(r.to_spec()).confidentiality, "严格保密")
        spec = {"report": {"title": "T", "locale": "zh-CN", "confidentiality": None}}
        self.assertIsNone(Report.from_spec(spec).confidentiality)
        r.page("P")
        html = r.html(kit=ROOT)
        self.assertIn('<span class="rk-page__conf">严格保密</span>', html)

    def test_theme_menu_is_localised_and_matches_the_runtime_labels(self):
        html = Report("T", locale="zh-CN").html(kit=ROOT)
        for tid, lab in THEME_LABELS_BY_LANG["zh"].items():
            self.assertIn(f'<option value="{tid}"{" selected" if tid == "navy" else ""}>{lab}</option>', html)
        self.assertIn('>Navy classic</option>', Report("T").html(kit=ROOT))
        # the builder's labels are the runtime's i18n strings ('theme.<id>' in kit/core/rk.core.js)
        core = (ROOT / "kit/core/rk.core.js").read_text(encoding="utf-8")
        packs = {"en": core[core.index("PACKS.en = {"):core.index("PACKS['zh-CN'] = {")],
                 "zh": core[core.index("PACKS['zh-CN'] = {"):]}
        for lang, text in packs.items():
            runtime = dict(re.findall(r"'theme\.(\w+)':\s*'([^']*)'", text)[:len(kit().themes)])
            for tid in kit().themes:
                self.assertEqual(kit().theme_label(tid, "zh-CN" if lang == "zh" else "en-US"), runtime.get(tid),
                                 f"theme label {lang}/{tid}")

    def test_excel_button_has_no_inline_style(self):
        from reportkit.build import plan
        from reportkit.render import render_index
        r = Report("T")
        html = render_index(r, plan(r, ROOT), excel_href="data/t.xlsx")
        m = re.search(r'<a class="rk-btn"[^>]*data-rk-download="excel"[^>]*>', html)
        self.assertIsNotNone(m)
        self.assertNotIn("style=", m.group(0))
        css = (ROOT / "kit/styles/components.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"a\.rk-btn\s*\{[^}]*text-decoration:\s*none")   # the kit styles the anchor


# ---------------------------------------------------------------------------------------------
# Validator vs. the gallery samples
# ---------------------------------------------------------------------------------------------
def sample_report(manifest: dict, s: dict, locale: str = "en-US") -> Report:
    """The report the gallery's Python snippet for sample *s* builds (one page, one block)."""
    opts = dict(s.get("options") or {})
    ids = [s["data"]] if s.get("data") else []
    ids += [v for k, v in opts.items() if k.endswith("Data") and isinstance(v, str) and v not in ids]
    r = Report("Project Atlas", client="Board of Directors", date="2026-10-14", locale=locale)
    for did in ids:
        r.dataset(did, SAMPLES / f"{did}.json")
    names = set(re.findall(r"@([A-Za-z_]\w*)", json.dumps(opts)))
    if isinstance(opts.get("params"), list):
        names |= {p if isinstance(p, str) else p.get("name") for p in opts["params"]}
    if manifest["id"] == "param-slider" and opts.get("params") is None:
        names |= set(GALLERY_PARAMS)
    for name in sorted(n for n in names if n):
        spec = dict(GALLERY_PARAMS.get(name, {"value": 0}))
        r.param(name, spec.pop("value"), **spec)
    r.page(s.get("title") or manifest["id"]).block(
        manifest["id"], data=s.get("data"), title=s.get("title"), span=s.get("span", 12), height=s.get("height"),
        options=opts)
    return r


class GallerySampleValidationTests(unittest.TestCase):
    def test_every_manifest_sample_validates(self):
        k = kit()
        n, failures = 0, []
        for cid in k.component_ids():
            m = k.component(cid)
            for i, s in enumerate(m.get("samples") or []):
                n += 1
                errors, _ = sample_report(m, s).check(k)
                failures += [f"{cid} sample {i}: {e}" for e in errors]
        self.assertGreater(n, 100)
        self.assertEqual(failures, [], "\n".join(failures))

    def _errors(self, component, data, options, extra=()):
        r = Report("T", date="2026-10-14")
        for did in (data, *extra):
            r.dataset(did, SAMPLES / f"{did}.json")
        r.page("P").block(component, data=data, options=options)
        return r.check(kit())[0]

    def test_conditional_channels(self):
        # bump: wide rank fields need no period channel; long data still does
        self.assertEqual(self._errors("bump", "league_table", {"encode": {"series": "bank", "rank": ["prior_rank", "rank"]}}), [])
        errs = self._errors("bump", "league_table", {"encode": {"series": "bank", "value": "deals"}})
        self.assertTrue(any("required channel 'x'" in e for e in errs), errs)
        # radar: wide axes need no value channel
        self.assertEqual(self._errors("radar", "peers", {"encode": {"series": "company", "axis": ["pe_25e", "tsr_1y"]}}), [])
        errs = self._errors("radar", "peers", {"encode": {"series": "company", "axis": "sector"}})
        self.assertTrue(any("required channel 'value'" in e for e in errs), errs)
        # sources-uses: capitalization mode has no side; item falls back to an 'instrument' field
        self.assertEqual(self._errors("sources-uses", "capital_structure", {"mode": "capitalization"}), [])
        errs = self._errors("sources-uses", "capital_structure", {})
        self.assertTrue(any("required channel 'side'" in e for e in errs), errs)
        self.assertFalse(any("'item'" in e for e in errs), errs)

    def test_secondary_dataset_channels(self):
        ok = {"nodesData": "network_nodes",
              "encode": {"source": "source", "target": "target", "id": "id", "name": "name", "category": "type", "size": "size"}}
        self.assertEqual(self._errors("network", "network_edges", ok, ["network_nodes"]), [])
        errs = self._errors("network", "network_edges", {"nodesData": "network_nodes", "encode": {"name": "nm"}}, ["network_nodes"])
        self.assertEqual(len(errs), 1, errs)
        self.assertIn("encode.name -> field 'nm' is not in dataset 'network_nodes' (options.nodesData)", errs[0])
        # without a node table the node channels are not read (nodes come from the edges)
        self.assertEqual(self._errors("network", "network_edges", {"encode": {"name": "nm"}}), [])
        # an edge channel is still checked against the edge dataset
        errs = self._errors("network", "network_edges", {"nodesData": "network_nodes", "encode": {"source": "from"}}, ["network_nodes"])
        self.assertTrue(any("encode.source -> field 'from' is not in dataset 'network_edges'" in e for e in errs), errs)

    def test_option_channels(self):
        self.assertEqual(self._errors("pivot-table", "precedents", {"rows": ["sector"], "cols": "year(date)", "value": None, "agg": "count"}), [])
        errs = self._errors("pivot-table", "precedents", {"rows": ["sectr"], "cols": "year(dat)"})
        self.assertTrue(any("options.rows -> field 'sectr'" in e and "did you mean 'sector'" in e for e in errs), errs)
        self.assertTrue(any("options.cols -> field 'dat'" in e for e in errs), errs)
        errs = self._errors("pivot-table", "precedents", {})   # default rows field 'segment' is not in precedents
        self.assertTrue(any("required channel 'rows'" in e and "options={'rows'" in e for e in errs), errs)


# ---------------------------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------------------------
class SampleDataTests(unittest.TestCase):
    def test_reference_prices_match_price_ohlc(self):
        px = [r for r in sample("price_ohlc")["data"] if r["date"] <= "2026-10-09"]
        last30 = px[-30:]
        vwap = sum(r["close"] * r["volume"] for r in last30) / sum(r["volume"] for r in last30)
        high52 = max(r["close"] for r in px if r["date"] >= "2025-10-09")
        notes = " ".join(sample("offer_prices")["meta"]["notes"])
        self.assertIn(f"30-day VWAP ${vwap:.2f}", notes)
        self.assertIn(f"52-week closing high ${high52:.2f}", notes)
        hlx = next(p for p in sample("peers")["data"] if p["is_target"])
        self.assertEqual(hlx["price_52w_high"], high52)

    def test_generator_check_passes(self):
        res = subprocess.run([sys.executable, str(ROOT / "tools/make_sample_data.py"), "--check"],
                             capture_output=True, text=True, timeout=120)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)


if __name__ == "__main__":
    unittest.main()
