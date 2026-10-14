"""Tests for the ReportKit Python builder (stdlib unittest; pandas tests are skipped if pandas is missing).

Run:  cd <repo> && python3 -m unittest discover -s tests/py -v

Every test builds against a temporary *fake* kit root (selected through $REPORTKIT_HOME), so the
suite does not depend on the real components / vendor files being present.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import io
import json
import math
import os
import sys
import tempfile
import unittest
import warnings
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "py"))

from reportkit import (  # noqa: E402
    BuildError, DataError, Kit, KitNotFoundError, Report, ReportValidationError, SpecError,
    normalize_dataset, to_json_value,
)
from reportkit import cli  # noqa: E402
from reportkit.build import bundle_js_text  # noqa: E402

try:
    import pandas as pd  # noqa: F401
    import numpy as np  # noqa: F401
    HAVE_PANDAS = True
except ImportError:  # pragma: no cover
    HAVE_PANDAS = False


# ---------------------------------------------------------------------------------------------
# Fake kit
# ---------------------------------------------------------------------------------------------
def _w(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _manifest(cid, category, deps=(), channels=None, needs_data=None, name=None):
    m = {"id": cid, "name": name or cid.title(), "category": category, "deps": list(deps),
         "channels": channels or {}}
    if needs_data is not None:
        m["needs_data"] = needs_data
    return json.dumps(m)


def make_fake_kit(root: Path, *, fonts: bool = True) -> Path:
    _w(root / "kit/build.json", json.dumps({
        "core": ["core/rk.core.js", "core/rk.data.js"],
        "styles": ["styles/tokens.css", "styles/themes/navy.css", "styles/themes/ink.css"],
        "themes": ["navy", "ink"], "defaultTheme": "navy", "version": "9.9.9",
    }))
    _w(root / "kit/core/rk.core.js", "/* CORE-1 */\nwindow.RK = window.RK || {};\n")
    _w(root / "kit/core/rk.data.js", "/* CORE-2 */\nRK.data = {preload: function (b) { RK._b = b; }};")
    _w(root / "kit/styles/tokens.css", "/* TOKENS */ :root{--x:1}\n")
    _w(root / "kit/styles/themes/navy.css", "/* NAVY */\n")
    _w(root / "kit/styles/themes/ink.css", "/* INK */\n")
    comps = root / "kit/components"
    _w(comps / "chart/manifest.json", _manifest("chart", "comparison", ["echarts"], {
        "x": {"type": "string", "required": True},
        "y": {"type": "number", "required": True, "default": "value"},
        "series": {"type": "string", "required": False}}, name="Chart"))
    _w(comps / "chart/chart.js", "RK.component({id:'chart'}); /* CHART-JS */\n")
    _w(comps / "chart/chart.css", "/* CHART-CSS */\n")
    _w(comps / "geo-map/manifest.json", _manifest("geo-map", "geo", ["leaflet-markercluster"], {
        "lat": {"type": "number", "required": True}, "lon": {"type": "number", "required": True}}))
    _w(comps / "geo-map/geo-map.js", "/* MAP-JS */\n")
    _w(comps / "filter-bar/manifest.json", _manifest("filter-bar", "controls", [], {}, needs_data=False))
    _w(comps / "filter-bar/filter-bar.js", "/* FILTER-JS */\n")
    _w(comps / "filter-bar/filter-bar.css", "/* FILTER-CSS */\n")
    _w(comps / "note/manifest.json", _manifest("note", "layout", [], {}, needs_data=False))
    _w(comps / "note/note.js", "/* NOTE-JS */\n")
    _w(comps / "unused/manifest.json", _manifest("unused", "table", ["echarts"]))
    _w(comps / "unused/unused.js", "/* UNUSED-JS */\n")

    vendor = root / "vendor"
    _w(vendor / "vendor.json", json.dumps({"packages": [
        {"id": "echarts", "files": {"dist/echarts.min.js": "echarts.min.js", "LICENSE": "LICENSE"}},
        {"id": "leaflet", "files": {"dist/leaflet.js": "leaflet.js", "dist/leaflet.css": "leaflet.css",
                                    "dist/images/": "images/", "LICENSE": "LICENSE"}},
        {"id": "leaflet-markercluster", "files": {"dist/mc.js": "leaflet.markercluster.js",
                                                  "dist/MarkerCluster.css": "MarkerCluster.css",
                                                  "dist/MarkerCluster.Default.css": "MarkerCluster.Default.css",
                                                  "LICENSE": "LICENSE"}},
        {"id": "unused-lib", "files": {"x.js": "x.js", "LICENSE": "LICENSE"}},
    ]}))
    _w(vendor / "LICENSES.md", "# Third-party licenses\n")
    _w(vendor / "echarts/echarts.min.js", "/* ECHARTS */\n")
    _w(vendor / "echarts/LICENSE", "Apache-2.0\n")
    _w(vendor / "leaflet/leaflet.js", "/* LEAFLET */\n")
    _w(vendor / "leaflet/leaflet.css", "/* LEAFLET-CSS */\n")
    _w(vendor / "leaflet/images/marker.png", "PNG")
    _w(vendor / "leaflet/LICENSE", "BSD\n")
    _w(vendor / "leaflet/.DS_Store", "junk")
    _w(vendor / "leaflet-markercluster/leaflet.markercluster.js", "/* MC */\n")
    _w(vendor / "leaflet-markercluster/MarkerCluster.css", "/* MC-CSS */\n")
    _w(vendor / "leaflet-markercluster/MarkerCluster.Default.css", "/* MC-DEF-CSS */\n")
    _w(vendor / "leaflet-markercluster/LICENSE", "MIT\n")
    _w(vendor / "unused-lib/x.js", "/* X */\n")
    _w(vendor / "unused-lib/LICENSE", "MIT\n")
    if fonts:
        _w(root / "kit/fonts/inter/inter.woff2", "FONT")
    return root


class KitTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.kit_root = make_fake_kit(self.tmp / "kitroot")
        self._old_home = os.environ.get("REPORTKIT_HOME")
        os.environ["REPORTKIT_HOME"] = str(self.kit_root)
        self.out = self.tmp / "out"

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("REPORTKIT_HOME", None)
        else:
            os.environ["REPORTKIT_HOME"] = self._old_home
        self._tmp.cleanup()

    # a small but complete report used by many tests
    def make_report(self, **kw) -> Report:
        r = Report("Project Atlas", subtitle="Discussion materials", client="Board of Directors",
                   date="2026-10-14", firm="Northbridge Partners", **kw)
        r.dataset("peers", [
            {"company": "Alpha Corp", "sector": "Software", "ev": 1200.5, "ebitda": 100},
            {"company": "Beta Holdings", "sector": "Hardware", "ev": 800, "ebitda": 0},
            {"company": "Gamma Ltd", "sector": "Software", "ev": None, "ebitda": 50},
        ], title="Trading comparables", source="Company filings; market data as of 10-Oct-2026",
            fields={"ev": {"title": "EV", "format": "$#,##0"}},
            computed=[{"name": "ev_ebitda", "formula": "ev / ebitda * @adj", "format": "0.0x"}])
        r.param("adj", 1.0, min=0.5, max=1.5, step=0.05, format="0.00x", title="Adjustment")
        r.topbar_block("filter-bar", data="peers", options={"fields": ["sector"]})
        r.cover()
        r.section("Valuation")
        p = r.page("Peers trade at a median 9.5x EBITDA", kicker="Trading comparables",
                   subtitle="USD m unless otherwise stated", notes="Excludes outliers")
        p.block("chart", data="peers", title="EV / EBITDA", subtitle="2025E",
                encode={"x": "company", "y": "ev_ebitda"}, span=7, height=340)
        p.block("note", title="Commentary", options={"text": "Premium to peers"}, span=5)
        return r

    def build(self, r: Report, out: Path | None = None, **kw) -> Path:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return r.build(out or self.out, **kw)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_bundle(text: str) -> dict:
    assert text.startswith("RK.data.preload(") and text.rstrip().endswith(");"), text[:80]
    return json.loads(text[len("RK.data.preload("):text.rstrip().rindex(");")])


def tree(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


# ---------------------------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------------------------
class TestNormalisation(KitTestCase):
    def test_scalars(self):
        self.assertIsNone(to_json_value(float("nan")))
        self.assertIsNone(to_json_value(float("inf")))
        self.assertIsNone(to_json_value(-math.inf))
        self.assertEqual(to_json_value(Decimal("1.25")), 1.25)
        self.assertIsNone(to_json_value(Decimal("NaN")))
        self.assertEqual(to_json_value(dt.date(2026, 10, 14)), "2026-10-14")
        self.assertEqual(to_json_value(dt.datetime(2026, 10, 14)), "2026-10-14")
        self.assertEqual(to_json_value(dt.datetime(2026, 10, 14, 9, 30)), "2026-10-14T09:30:00")
        self.assertIs(to_json_value(True), True)
        self.assertEqual(to_json_value((1, float("nan"))), [1, None])
        self.assertEqual(to_json_value({"a": Decimal("2")}), {"a": 2.0})

    def test_records_types_and_values(self):
        ds, warns = normalize_dataset("t", [
            {"name": "A", "v": 1, "d": dt.date(2026, 1, 2), "flag": True, "x": Decimal("1.5")},
            {"name": "B", "v": float("nan"), "d": None, "flag": False, "x": None, "extra": "late"},
        ])
        fields = {f["name"]: f for f in ds["schema"]["fields"]}
        self.assertEqual([f["name"] for f in ds["schema"]["fields"]], ["name", "v", "d", "flag", "x", "extra"])
        self.assertEqual(fields["name"]["type"], "string")
        self.assertEqual(fields["v"]["type"], "number")
        self.assertEqual(fields["d"]["type"], "date")
        self.assertEqual(fields["flag"]["type"], "boolean")
        self.assertEqual(fields["x"]["type"], "number")
        self.assertEqual(ds["data"][0], {"name": "A", "v": 1, "d": "2026-01-02", "flag": True, "x": 1.5, "extra": None})
        self.assertEqual(ds["data"][1]["v"], None)
        self.assertEqual(ds["title"], "t")
        self.assertEqual(warns, [])

    def test_mixed_column_is_string_and_fiscal_labels_not_dates(self):
        ds, _ = normalize_dataset("t", {"a": [1, "x"], "fy": ["2025-26", "2026-27"], "d": ["2026-01-31", None]})
        types = {f["name"]: f["type"] for f in ds["schema"]["fields"]}
        self.assertEqual(types, {"a": "string", "fy": "string", "d": "date"})

    def test_list_cells_are_arrays(self):
        ds, warns = normalize_dataset("k", [{"label": "Revenue", "spark": [1, 2, float("nan")]}],
                                      fields={"label": {"type": "category"}})
        types = {f["name"]: f["type"] for f in ds["schema"]["fields"]}
        self.assertEqual(types, {"label": "category", "spark": "array"})
        self.assertEqual(ds["data"][0]["spark"], [1, 2, None])
        self.assertTrue(any("non-standard type 'category'" in w for w in warns))

    def test_columns_dict_and_length_mismatch(self):
        ds, _ = normalize_dataset("t", {"k": ["a", "b"], "v": [1, 2]})
        self.assertEqual(ds["data"], [{"k": "a", "v": 1}, {"k": "b", "v": 2}])
        with self.assertRaises(DataError):
            normalize_dataset("t", {"k": ["a", "b"], "v": [1]})

    def test_field_overrides_and_meta(self):
        ds, warns = normalize_dataset(
            "comps", [{"ev_ebitda": 9.5, "co": "A"}], title="Comps",
            fields={"ev_ebitda": {"title": "EV/EBITDA", "format": "0.0x"}, "co": "Company", "nope": {"title": "x"}},
            source="FactSet", notes="Excl. outliers", unit="USD m", as_of=dt.date(2026, 10, 10),
            computed={"double": "ev_ebitda * 2"})
        f = {x["name"]: x for x in ds["schema"]["fields"]}
        self.assertEqual(f["ev_ebitda"], {"name": "ev_ebitda", "type": "number", "title": "EV/EBITDA", "format": "0.0x"})
        self.assertEqual(f["co"]["title"], "Company")
        self.assertEqual(ds["meta"], {"asOf": "2026-10-10", "notes": ["Excl. outliers"], "source": "FactSet", "unit": "USD m"})
        self.assertEqual(ds["computed"], [{"name": "double", "formula": "ev_ebitda * 2"}])
        self.assertEqual(len(warns), 1)
        self.assertIn("nope", warns[0])

    def test_contract_form_input_with_array_rows(self):
        contract = {"id": "x", "title": "From API",
                    "schema": {"fields": [{"name": "a", "type": "string", "title": "A"}, {"name": "b", "type": "number"}]},
                    "data": [["p", 1], ["q", None]], "meta": {"source": "API"},
                    "computed": [{"name": "c", "formula": "b * 2"}]}
        ds, _ = normalize_dataset("x", contract)
        self.assertEqual(ds["title"], "From API")
        self.assertEqual(ds["data"], [{"a": "p", "b": 1}, {"a": "q", "b": None}])
        self.assertEqual(ds["schema"]["fields"][0], {"name": "a", "type": "string", "title": "A"})
        self.assertEqual(ds["meta"], {"source": "API"})
        self.assertEqual(ds["computed"][0]["name"], "c")
        ds2, _ = normalize_dataset("x", contract, title="Override", source="Mine")
        self.assertEqual((ds2["title"], ds2["meta"]["source"]), ("Override", "Mine"))

    def test_csv_file(self):
        p = self.tmp / "d.csv"
        p.write_text("company,region,mkt_cap,zip,listed,date,growth\n"
                     'Alpha,NA,"1,234.5",00123,true,2026-01-31,n.a.\n'
                     "Beta,EMEA,800,04567,FALSE,2026-02-28,0.05\n"
                     "Gamma,,#N/A,11111,true,,-0.10\n", encoding="utf-8")
        ds, _ = normalize_dataset("d", p)
        types = {f["name"]: f["type"] for f in ds["schema"]["fields"]}
        self.assertEqual(types, {"company": "string", "region": "string", "mkt_cap": "number", "zip": "string",
                                 "listed": "boolean", "date": "date", "growth": "number"})
        self.assertEqual(ds["data"][0], {"company": "Alpha", "region": "NA", "mkt_cap": 1234.5, "zip": "00123",
                                         "listed": True, "date": "2026-01-31", "growth": None})
        self.assertEqual(ds["data"][2]["mkt_cap"], None)
        self.assertEqual(ds["data"][2]["region"], None)
        self.assertEqual(ds["data"][1]["listed"], False)
        self.assertEqual(ds["data"][1]["mkt_cap"], 800)

    def test_csv_semicolon_and_multiline_cells(self):
        p = self.tmp / "eu.csv"
        p.write_text('name;comment;value\nA;"line one\nline two";1.5\nB;"has, comma";2\n', encoding="utf-8")
        ds, _ = normalize_dataset("eu", p)
        self.assertEqual(ds["data"][0], {"name": "A", "comment": "line one\nline two", "value": 1.5})
        self.assertEqual(ds["data"][1]["comment"], "has, comma")

    def test_json_file_records(self):
        p = self.tmp / "d.json"
        p.write_text(json.dumps([{"a": 1}, {"a": 2}]), encoding="utf-8")
        ds, _ = normalize_dataset("d", p)
        self.assertEqual(ds["data"], [{"a": 1}, {"a": 2}])

    def test_unsupported_input(self):
        with self.assertRaises(DataError):
            normalize_dataset("d", 42)
        with self.assertRaises(DataError):
            normalize_dataset("d", self.tmp / "missing.csv")
        with self.assertRaises(DataError):
            normalize_dataset("d", [[1, 2]])  # arrays need field names

    def test_arrays_with_field_list(self):
        ds, _ = normalize_dataset("d", [["a", 1], ["b", 2]], fields=["k", {"name": "v", "format": "0.0"}])
        self.assertEqual(ds["data"][1], {"k": "b", "v": 2})
        self.assertEqual(ds["schema"]["fields"][1]["format"], "0.0")

    @unittest.skipUnless(HAVE_PANDAS, "pandas not installed")
    def test_pandas_dataframe(self):
        import numpy as np
        import pandas as pd
        df = pd.DataFrame({
            "company": ["A", "B", "C"],
            "ev": np.array([1.5, np.nan, np.inf]),
            "n": np.array([1, 2, 3], dtype="int64"),
            "when": pd.to_datetime(["2026-01-01", None, "2026-03-31"]),
            "ts": pd.to_datetime(["2026-01-01 09:30", "2026-01-02 00:00", None]),
            "cat": pd.Categorical(["x", "y", "x"]),
            "ok": np.array([True, False, True]),
            "nullable": pd.array([1, None, 3], dtype="Int64"),
        })
        ds, _ = normalize_dataset("df", df)
        rows = ds["data"]
        self.assertEqual(rows[0], {"company": "A", "ev": 1.5, "n": 1, "when": "2026-01-01", "ts": "2026-01-01T09:30:00",
                                   "cat": "x", "ok": True, "nullable": 1})
        self.assertIsNone(rows[1]["ev"])
        self.assertIsNone(rows[2]["ev"])
        self.assertIsNone(rows[1]["when"])
        self.assertIsNone(rows[2]["ts"])
        self.assertIsNone(rows[1]["nullable"])
        for r in rows:
            for v in r.values():
                self.assertIn(type(v), (str, int, float, bool, type(None)))
        types = {f["name"]: f["type"] for f in ds["schema"]["fields"]}
        self.assertEqual(types["when"], "date")
        self.assertEqual(types["n"], "number")
        self.assertEqual(types["ok"], "boolean")
        json.dumps(ds, allow_nan=False)

    @unittest.skipUnless(HAVE_PANDAS, "pandas not installed")
    def test_pandas_index_and_numpy_scalars(self):
        import numpy as np
        import pandas as pd
        named = pd.DataFrame({"v": [1.0, 2.0]}, index=pd.Index(["a", "b"], name="key"))
        ds, _ = normalize_dataset("x", named)
        self.assertEqual([f["name"] for f in ds["schema"]["fields"]], ["key", "v"])
        filtered = pd.DataFrame({"v": [1, 2, 3]}).iloc[[0, 2]]  # unnamed non-range index is dropped
        ds, _ = normalize_dataset("x", filtered)
        self.assertEqual([f["name"] for f in ds["schema"]["fields"]], ["v"])
        ds, _ = normalize_dataset("x", [{"a": np.int64(3), "b": np.float32(0.5), "c": np.bool_(True),
                                         "d": np.datetime64("2026-10-14"), "e": np.datetime64("NaT", "D")}])
        self.assertEqual(ds["data"][0], {"a": 3, "b": 0.5, "c": True, "d": "2026-10-14", "e": None})
        self.assertIs(type(ds["data"][0]["a"]), int)
        s = pd.Series([1, 2], name="val")
        ds, _ = normalize_dataset("s", s)
        self.assertEqual(ds["data"], [{"val": 1}, {"val": 2}])

    def test_report_dataset_returns_id_and_records_duplicates(self):
        r = Report("T")
        self.assertEqual(r.dataset("a", [{"x": 1}]), "a")
        r.dataset("a", [{"x": 2}])
        errors, _ = r.check()
        self.assertTrue(any("duplicate dataset id 'a'" in e for e in errors))


# ---------------------------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------------------------
class TestValidation(KitTestCase):
    def test_valid_report_passes(self):
        r = self.make_report()
        self.assertEqual(r.validate(), [])

    def test_collects_all_problems(self):
        r = Report("T", theme="purple")
        r.dataset("d", [{"k": "a", "value": 1}], computed=[{"name": "c", "formula": "value * @missing"},
                                                          {"name": "c2", "formula": "nope + 1"}])
        r.param("p", 5, min=0, max=1)
        p = r.page("Page", id="dup")
        p.block("no-such-component", data="d")
        p.block("chart", data="ghost", encode={"x": "k"})
        p.block("chart")                                     # needs data
        p.block("chart", data="d", encode={"x": "kk"}, id="dup")   # bad field; duplicate id
        p.block("chart", data="d", encode={"y": "value"})   # required channel x unmapped
        p.block("chart", data="d", encode={"x": "k"}, span=13)
        p.block("note", options={"eventsData": "nowhere"})
        with self.assertRaises(ReportValidationError) as cm:
            r.validate()
        errs = "\n".join(cm.exception.errors)
        expected = [
            "unknown theme 'purple'",
            "unknown component 'no-such-component'",
            "unknown dataset 'ghost'",
            "component 'chart' needs data",
            "encode.x -> field 'kk' is not in dataset 'd'",
            "required channel 'x' is not mapped",
            "duplicate id 'dup'",
            "uses @missing but no param 'missing' is defined",
            "references unknown field 'nope'",
            "param 'p': value 5 is outside [0, 1]",
            "span must be an integer 1-12",
            "options.eventsData refers to unknown dataset 'nowhere'",
        ]
        for e in expected:
            self.assertIn(e, errs)
        self.assertGreaterEqual(len(cm.exception.errors), len(expected))
        self.assertIn("problems", str(cm.exception))

    def test_required_channel_satisfied_by_default_field(self):
        r = Report("T")
        r.dataset("d", [{"k": "a", "value": 1}])
        r.page("P").block("chart", data="d", encode={"x": "k"})  # y -> default "value" exists
        self.assertEqual(r.validate(), [])

    def test_encode_accepts_computed_fields_and_lists(self):
        r = Report("T")
        r.dataset("d", [{"k": "a", "v": 1, "w": 2}], computed={"ratio": "v / w"})
        r.page("P").block("chart", data="d", encode={"x": "k", "y": ["v", "ratio"]})
        self.assertEqual(r.validate(), [])

    def test_formula_params_and_titles(self):
        r = Report("T")
        r.dataset("d", [{"ev": 1, "ebitda": 2}], fields={"ebitda": "EBITDA 2025E"},
                  computed=[{"name": "m", "formula": "ev / `EBITDA 2025E` * (1 + @g) + [m]"}])
        errors, _ = r.check()
        self.assertTrue(any("@g" in e for e in errors), errors)
        r.param("g", 0.02)
        errors, _ = r.check()
        # [m] refers to a computed field defined by this very formula -> unknown at that point
        self.assertTrue(any("unknown field 'm'" in e or "self-referential" in e for e in errors), errors)

    def test_ui_component_without_data_and_topbar(self):
        r = Report("T")
        r.topbar_block("filter-bar")
        r.page("P").block("note")
        self.assertEqual(r.validate(), [])

    def test_large_dataset_warning(self):
        r = Report("T")
        r.dataset("big", {"v": list(range(50_001))})
        r.page("P").block("chart", data="big", encode={"x": "v", "y": "v"})
        warns = r.validate()
        self.assertTrue(any("50,001 rows" in w for w in warns), warns)

    def test_build_validates_by_default(self):
        r = Report("T")
        r.page("P").block("nope")
        with self.assertRaises(ReportValidationError):
            r.build(self.out)
        self.assertFalse((self.out / "index.html").exists())

    def test_missing_vendor_files_reported(self):
        (self.kit_root / "vendor/echarts/echarts.min.js").unlink()
        r = Report("T")
        r.dataset("d", [{"x": "a", "value": 1}])
        r.page("P").block("chart", data="d", encode={"x": "x"})
        errors, _ = r.check()
        self.assertTrue(any("vendor/echarts/" in e and "tools/vendor.py" in e for e in errors), errors)


# ---------------------------------------------------------------------------------------------
# Build output
# ---------------------------------------------------------------------------------------------
class TestBuild(KitTestCase):
    def test_file_layout(self):
        out = self.build(self.make_report())
        files = set(tree(out))
        for f in ["index.html", "assets/css/reportkit.css", "assets/js/reportkit.js",
                  "assets/js/components/chart.js", "assets/js/components/filter-bar.js",
                  "assets/js/components/note.js", "assets/vendor/echarts/echarts.min.js",
                  "assets/vendor/echarts/LICENSE", "assets/vendor/LICENSES.md", "assets/fonts/inter/inter.woff2",
                  "data/manifest.json", "data/datasets/peers.json", "data/bundle.js"]:
            self.assertIn(f, files)
        self.assertNotIn("assets/js/components/unused.js", files)
        self.assertNotIn("assets/js/components/geo-map.js", files)
        self.assertFalse(any(f.startswith("assets/vendor/leaflet") for f in files))
        self.assertFalse(any(f.startswith("assets/vendor/unused-lib") for f in files))

    def test_core_js_and_css_concatenation(self):
        out = self.build(self.make_report())
        js = read(out / "assets/js/reportkit.js")
        self.assertTrue(js.startswith("/*! ReportKit 9.9.9 | built 2026-10-14"))
        self.assertLess(js.index("CORE-1"), js.index("CORE-2"))
        css = read(out / "assets/css/reportkit.css")
        order = [css.index(m) for m in ("TOKENS", "NAVY", "INK", "CHART-CSS", "FILTER-CSS")]
        self.assertEqual(order, sorted(order))
        self.assertEqual(read(out / "assets/js/components/chart.js"),
                         read(self.kit_root / "kit/components/chart/chart.js"))

    def test_build_date_override(self):
        out = self.build(self.make_report(), build_date="2030-01-01")
        self.assertIn("built 2030-01-01", read(out / "assets/js/reportkit.js"))

    def test_vendor_requirements_css_and_script_order(self):
        r = Report("Map")
        r.dataset("pts", [{"lat": 1.0, "lon": 2.0, "x": "a", "value": 1}])
        p = r.page("Map")
        p.block("geo-map", data="pts", encode={"lat": "lat", "lon": "lon"})
        p.block("chart", data="pts", encode={"x": "x"})
        out = self.build(r)
        files = set(tree(out))
        self.assertIn("assets/vendor/leaflet/leaflet.js", files)            # implicit requirement
        self.assertIn("assets/vendor/leaflet/images/marker.png", files)
        self.assertIn("assets/vendor/leaflet/LICENSE", files)
        self.assertIn("assets/vendor/leaflet-markercluster/LICENSE", files)
        self.assertNotIn("assets/vendor/leaflet/.DS_Store", files)
        html = read(out / "index.html")
        css_links = [line.split('href="')[1].split('"')[0] for line in html.splitlines() if "<link " in line]
        self.assertEqual(css_links, ["assets/vendor/leaflet/leaflet.css",
                                     "assets/vendor/leaflet-markercluster/MarkerCluster.css",
                                     "assets/vendor/leaflet-markercluster/MarkerCluster.Default.css",
                                     "assets/css/reportkit.css"])
        scripts = [line.split('src="')[1].split('"')[0] for line in html.splitlines() if "<script src=" in line]
        self.assertEqual(scripts, ["assets/vendor/echarts/echarts.min.js", "assets/vendor/leaflet/leaflet.js",
                                   "assets/vendor/leaflet-markercluster/leaflet.markercluster.js",
                                   "assets/js/reportkit.js", "assets/js/components/chart.js",
                                   "assets/js/components/geo-map.js", "data/bundle.js"])

    def test_data_files_and_bundle(self):
        r = self.make_report()
        out = self.build(r)
        manifest = json.loads(read(out / "data/manifest.json"))
        self.assertEqual(manifest["reportkit"], "0.1")
        self.assertEqual(manifest["report"]["title"], "Project Atlas")
        self.assertEqual(manifest["report"]["date"], "2026-10-14")
        self.assertEqual(manifest["datasets"], {"peers": {"path": "datasets/peers.json",
                                                          "title": "Trading comparables", "rows": 3}})
        self.assertEqual(manifest["params"]["adj"], {"value": 1.0, "min": 0.5, "max": 1.5, "step": 0.05,
                                                     "format": "0.00x", "title": "Adjustment"})
        ds = json.loads(read(out / "data/datasets/peers.json"))
        self.assertEqual(ds["id"], "peers")
        self.assertEqual(ds["data"][2]["ev"], None)
        self.assertEqual(ds["meta"]["source"], "Company filings; market data as of 10-Oct-2026")
        bundle_text = read(out / "data/bundle.js")
        bundle = parse_bundle(bundle_text)
        self.assertEqual(bundle["manifest"], manifest)
        self.assertEqual(bundle["datasets"]["peers"], ds)
        self.assertEqual(bundle_text, bundle_js_text(r.manifest(), r.datasets))
        self.assertTrue(bundle_text.startswith('RK.data.preload({"manifest": '))

    def test_index_html_structure(self):
        out = self.build(self.make_report())
        html = read(out / "index.html")
        self.assertTrue(html.startswith("<!DOCTYPE html>\n<html lang=\"en-US\" data-rk-theme=\"navy\">"))
        for snippet in [
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            "<title>Project Atlas — Discussion materials</title>",
            '<meta name="rk:data" content="data/">',
            '<meta name="generator" content="ReportKit">',
            '<body class="rk-report">',
            '<header class="rk-topbar">',
            '<span class="rk-topbar__firm">Northbridge Partners</span>',
            '<div class="rk-topbar__controls">',
            '<select class="rk-select" data-rk-theme-switch',
            '<option value="navy" selected>Navy classic</option>',
            '<option value="ink">Ink (dark)</option>',
            "data-rk-print>",
            '<nav class="rk-nav" data-rk-nav',
            '<main class="rk-deck">',
            '<section class="rk-page rk-page--cover" id="cover"',
            '<h1 class="rk-cover__title">Project Atlas</h1>',
            '<span class="rk-cover__client">Board of Directors</span>',
            '<time datetime="2026-10-14">October 14, 2026</time>',
            '<p class="rk-cover__conf">Strictly private &amp; confidential</p>',
            '<section class="rk-page rk-page--section" id="valuation" data-rk-page="Valuation">',
            '<p class="rk-section__num">01</p>',
            '<h2 class="rk-section__title">Valuation</h2>',
            '<section class="rk-page" id="trading-comparables" data-rk-page="Trading comparables">',
            '<p class="rk-page__kicker">Trading comparables</p>',
            '<h2 class="rk-page__title">Peers trade at a median 9.5x EBITDA</h2>',
            '<p class="rk-page__subtitle">USD m unless otherwise stated</p>',
            '<div class="rk-page__body rk-grid">',
            '<figure class="rk-block" style="--rk-span:7" data-rk="chart" data-rk-data="peers" id="trading-comparables-ev-ebitda">',
            '<h3 class="rk-block__title">EV / EBITDA</h3>',
            '<p class="rk-block__subtitle">2025E</p>',
            '<div class="rk-block__body" style="--rk-h:340px"></div>',
            '<script type="application/json" data-rk-options>{"encode": {"x": "company", "y": "ev_ebitda"}}</script>',
            '<figure class="rk-block" style="--rk-span:5" data-rk="note" id="trading-comparables-commentary">',
            '<span class="rk-page__source">Source: Company filings; market data as of 10-Oct-2026'
            '<span class="rk-page__notes">Note: Excludes outliers</span></span>',
            '<span class="rk-page__conf">Strictly private &amp; confidential</span><span class="rk-page__num"></span>',
            '<div class="rk-block rk-topbar__item" data-rk="filter-bar" data-rk-data="peers" id="topbar-filter-bar">',
            '{"tools": false, "fields": ["sector"]}',
        ]:
            self.assertIn(snippet, html)
        self.assertTrue(html.rstrip().endswith('<script src="data/bundle.js"></script>\n</body>\n</html>'))
        # a block without title/subtitle has no figcaption
        chunk = html.split('id="trading-comparables-commentary">')[1].split("</figure>")[0]
        self.assertIn("rk-block__head", chunk)  # has title
        r = Report("T")
        r.page("P").block("note", id="plain")
        html2 = r.html()
        chunk = html2.split('id="plain">')[1].split("</figure>")[0]
        self.assertNotIn("figcaption", chunk)
        self.assertNotIn("data-rk-options", chunk)
        self.assertNotIn("data-rk-data", html2.split('id="plain"')[0].split("<figure")[-1])

    def test_escaping(self):
        r = Report('A & B <Co> "Quoted"', subtitle="It's <b>bold</b>", client="Ops & Co",
                   confidentiality="Strictly <private>", date="2026-10-14")
        r.dataset("d", [{"k": "</script><script>alert(1)</script>", "value": 1}])
        p = r.page("Title with <script>alert('x')</script>", kicker="K&K", source="S <1>",
                   notes=["n1 & co", "n2"])
        p.block("chart", data="d", encode={"x": "k"}, title="T<1>", notes="b<2>", source="Source: X & Y",
                options={"label": "</script><!-- x -->", "q": "\"'&"})
        r.cover()
        out = self.build(r)
        html = read(out / "index.html")
        self.assertNotIn("<script>alert", html)
        self.assertNotIn("<b>bold", html)
        self.assertIn("<title>A &amp; B &lt;Co&gt; &quot;Quoted&quot; — It&#x27;s &lt;b&gt;bold&lt;/b&gt;</title>", html)
        self.assertIn("Title with &lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;", html)
        self.assertIn('<p class="rk-page__kicker">K&amp;K</p>', html)
        self.assertIn("Source: S &lt;1&gt;", html)
        self.assertIn("Notes: (1) n1 &amp; co (2) n2", html)
        self.assertIn('<p class="rk-block__source">Source: X &amp; Y</p>', html)
        self.assertIn('<p class="rk-block__notes">Note: b&lt;2&gt;</p>', html)
        self.assertIn('<p class="rk-cover__conf">Strictly &lt;private&gt;</p>', html)
        # options JSON: '</' -> '<\/' and '<!--' escaped; still valid JSON with the original value
        line = next(l for l in html.splitlines() if "data-rk-options" in l and "label" in l)
        payload = line.split("data-rk-options>")[1].rsplit("</script>", 1)[0]
        self.assertNotIn("</", payload)
        self.assertNotIn("<!--", payload)
        self.assertEqual(json.loads(payload)["label"], "</script><!-- x -->")
        self.assertEqual(json.loads(payload)["q"], "\"'&")
        # the dataset value is not in the HTML at all (data lives in data/)
        self.assertNotIn("alert(1)", html)
        self.assertEqual(parse_bundle(read(out / "data/bundle.js"))["datasets"]["d"]["data"][0]["k"],
                         "</script><script>alert(1)</script>")

    def test_deterministic_output(self):
        a = self.build(self.make_report(), self.tmp / "a")
        b = self.build(self.make_report(), self.tmp / "b")
        ta, tb = tree(a), tree(b)
        self.assertEqual(sorted(ta), sorted(tb))
        for k in ta:
            self.assertEqual(ta[k], tb[k], k)
        # rebuilding into the same folder is byte-identical too
        before = tree(a)
        self.build(self.make_report(), a)
        self.assertEqual(before, tree(a))

    def test_definition_order_is_kept(self):
        r = Report("T", date="2026-01-01")
        r.dataset("zeta", [{"x": "a", "value": 1}])
        r.dataset("alpha", [{"x": "a", "value": 1}])
        r.param("wacc", 0.09)
        r.param("g", 0.02)
        r.page("P").block("chart", data="zeta", options={"groups": {"Market": 1, "Intrinsic": 2}},
                          encode={"x": "x"})
        self.assertIn('{"groups": {"Market": 1, "Intrinsic": 2}, "encode": {"x": "x"}}', r.html())
        m = r.manifest()
        self.assertEqual(list(m["datasets"]), ["zeta", "alpha"])
        self.assertEqual(list(m["params"]), ["wacc", "g"])
        self.assertEqual(list(parse_bundle(bundle_js_text(m, r.datasets))["datasets"]), ["zeta", "alpha"])

    def test_clean_removes_stale_files_and_protects_foreign_folders(self):
        r = self.make_report()
        out = self.build(r)
        (out / "assets/js/components/stale.js").write_text("old")
        (out / "keep.txt").write_text("analyst notes")
        self.build(self.make_report(), out)
        self.assertFalse((out / "assets/js/components/stale.js").exists())
        self.assertTrue((out / "keep.txt").exists())
        # a folder whose data/ is not ours is never wiped
        foreign = self.tmp / "project"
        (foreign / "data").mkdir(parents=True)
        (foreign / "data/raw.csv").write_text("a,b\n1,2\n")
        with self.assertRaises(BuildError):
            self.build(self.make_report(), foreign)
        self.assertTrue((foreign / "data/raw.csv").exists())
        with self.assertRaises(BuildError):
            self.build(self.make_report(), self.kit_root)

    def test_auto_ids_are_unique_and_explicit_ids_win(self):
        r = Report("T")
        r.dataset("d", [{"x": "a", "value": 1}])
        p1 = r.page("Same", id="same-2")
        p2 = r.page("Same")
        p3 = r.page("Same")
        b1 = p2.block("chart", data="d", encode={"x": "x"})
        b2 = p2.block("chart", data="d", encode={"x": "x"})
        r.validate()
        self.assertEqual([p1.id, p2.id, p3.id], ["same-2", "same", "same-3"])
        self.assertEqual([b1.id, b2.id], ["same-chart", "same-chart-2"])

    def test_inline_dataframe_like_block_data(self):
        r = Report("T")
        p = r.page("P")
        b = p.block("chart", data=[{"x": "a", "value": 1}], title="Revenue mix")
        self.assertEqual(b.data, "revenue-mix")
        self.assertIn("revenue-mix", r.datasets)
        r.validate()

    def test_locale_labels_and_dates(self):
        r = Report("项目", date="2026-10-14", locale="zh-CN", client="董事会")
        r.cover()
        p = r.page("标题", source="公司公告")
        p.block("note")
        html = r.html()
        self.assertIn('lang="zh-CN"', html)
        self.assertIn("2026年10月14日", html)
        self.assertIn("来源：公司公告", html)
        self.assertIn('id="page-2"', html)  # non-ASCII titles fall back to page-N ids


# ---------------------------------------------------------------------------------------------
# JSON layout spec
# ---------------------------------------------------------------------------------------------
class TestSpec(KitTestCase):
    def test_round_trip_inline(self):
        r = self.make_report()
        spec = r.to_spec()
        json.dumps(spec)
        r2 = Report.from_spec(spec)
        self.assertEqual(r.html(), r2.html())
        self.assertEqual(r.manifest(), r2.manifest())
        self.assertEqual(r.datasets, r2.datasets)

    def test_save_spec_and_build_from_file(self):
        r = self.make_report()
        spec_path = r.save_spec(self.tmp / "spec/report.json")
        self.assertTrue((self.tmp / "spec/datasets/peers.json").is_file())
        spec = json.loads(read(spec_path))
        self.assertEqual(spec["datasets"]["peers"], {"path": "datasets/peers.json"})
        r2 = Report.from_spec(spec_path)
        a = self.build(r, self.tmp / "a")
        b = self.build(r2, self.tmp / "b")
        self.assertEqual(tree(a), tree(b))

    def test_hand_written_spec_with_csv(self):
        d = self.tmp / "hand"
        _w(d / "comps.csv", "company,ev_ebitda\nAlpha,9.5\nBeta,11.0\n")
        _w(d / "report.json", json.dumps({
            "report": {"title": "Hand made", "date": "2026-10-14"},
            "params": {"g": 0.02},
            "datasets": {"comps": {"path": "comps.csv", "fields": {"ev_ebitda": {"format": "0.0x"}},
                                   "source": "FactSet", "computed": [{"name": "x", "formula": "ev_ebitda * (1 + @g)"}]},
                         "inline": {"data": {"k": ["a"], "value": [1]}}},
            "pages": [{"title": "Comps", "blocks": [
                {"component": "chart", "data": "comps", "encode": {"x": "company", "y": "x"}, "span": 6},
                {"component": "chart", "data": "inline", "encode": {"x": "k"}}]}],
        }))
        r = Report.from_spec(d / "report.json")
        self.assertEqual(r.datasets["comps"]["schema"]["fields"][1]["format"], "0.0x")
        self.assertEqual(r.params["g"], {"value": 0.02})
        self.assertEqual(r.validate(), [])

    def test_spec_errors(self):
        with self.assertRaises(SpecError) as cm:
            Report.from_spec({"report": {"title": "T", "colour": "x"},
                              "pages": [{"title": "P", "blocks": [{"component": "chart", "heigth": 3}]}]})
        msg = str(cm.exception)
        self.assertIn("colour", msg)
        self.assertIn("heigth", msg)
        with self.assertRaises(SpecError):
            Report.from_spec({"report": {}})


# ---------------------------------------------------------------------------------------------
# Kit / CLI
# ---------------------------------------------------------------------------------------------
class TestKitAndCli(KitTestCase):
    def run_cli(self, *argv) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_locate(self):
        kit = Kit.locate()
        self.assertEqual(kit.root, self.kit_root.resolve())
        self.assertEqual(Kit(self.kit_root / "kit").root, self.kit_root.resolve())  # kit/ dir accepted
        os.environ["REPORTKIT_HOME"] = str(self.tmp / "nowhere")
        with self.assertRaises(KitNotFoundError):
            Kit.locate()

    def test_components_command(self):
        code, out, _ = self.run_cli("components")
        self.assertEqual(code, 0)
        self.assertIn("ID", out.splitlines()[0])
        self.assertIn("chart", out)
        self.assertIn("comparison", out)
        self.assertIn("Chart", out)
        code, out, _ = self.run_cli("components", "--json")
        ids = [c["id"] for c in json.loads(out)]
        self.assertEqual(ids, sorted(ids))

    def test_validate_and_build_commands(self):
        spec_path = self.make_report().save_spec(self.tmp / "s/report.json")
        code, out, _ = self.run_cli("validate", str(spec_path))
        self.assertEqual(code, 0, out)
        self.assertIn("OK", out)
        code, out, _ = self.run_cli("build", str(spec_path), str(self.out))
        self.assertEqual(code, 0)
        self.assertTrue((self.out / "index.html").is_file())
        bad = json.loads(read(spec_path))
        bad["pages"][-1]["blocks"][0]["component"] = "ghost"
        _w(self.tmp / "s/bad.json", json.dumps(bad))
        code, _, err = self.run_cli("validate", str(self.tmp / "s/bad.json"))
        self.assertEqual(code, 1)
        self.assertIn("unknown component 'ghost'", err)

    def test_new_component_scaffold(self):
        code, out, _ = self.run_cli("new-component", "waterfall-pro", "--category", "bridge")
        self.assertEqual(code, 0)
        d = self.kit_root / "kit/components/waterfall-pro"
        m = json.loads(read(d / "manifest.json"))
        self.assertEqual((m["id"], m["category"], m["deps"]), ("waterfall-pro", "bridge", ["echarts"]))
        js = read(d / "waterfall-pro.js")
        self.assertIn("RK.component({", js)
        self.assertIn("id: 'waterfall-pro'", js)
        self.assertIn("RK.chart(", js)
        code, out, _ = self.run_cli("new-component", "badge", "--category", "layout", "--engine", "dom")
        self.assertEqual(code, 0)
        self.assertFalse(json.loads(read(self.kit_root / "kit/components/badge/manifest.json"))["needs_data"])
        code, _, err = self.run_cli("new-component", "waterfall-pro", "--category", "bridge")
        self.assertEqual(code, 2)
        self.assertIn("already exists", err)
        code, _, err = self.run_cli("new-component", "Bad_Id", "--category", "bridge")
        self.assertEqual(code, 2)
        _, out, _ = self.run_cli("components")
        self.assertIn("waterfall-pro", out)
        # the scaffold is buildable straight away
        r = Report("T")
        r.dataset("d", [{"x": "a", "y": 1}])
        r.page("P").block("waterfall-pro", data="d")
        self.assertEqual(r.validate(), [])


if __name__ == "__main__":
    unittest.main()


class DataSourceAndAutoHeightTests(unittest.TestCase):
    """height='auto' and the http / api data-source modes."""

    def test_auto_height_and_api_mode(self):
        import tempfile
        from pathlib import Path
        from reportkit import Report
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as tmp:
            r = Report("T")
            r.dataset("kpis", root / "kit/samples/datasets/kpis.json")
            r.page("P").block("kpi-tiles", data="kpis", height="auto")
            out = r.build(Path(tmp) / "a", kit=root)
            html = (out / "index.html").read_text()
            self.assertIn('class="rk-block__body is-auto"', html)
            self.assertIn('data/bundle.js', html)
            out2 = r.build(Path(tmp) / "b", kit=root, data_source="api", api="https://example.test/api/r/1/")
            html2 = (out2 / "index.html").read_text()
            self.assertNotIn('src="data/bundle.js"', html2)
            self.assertIn('<meta name="rk:data-source" content="api">', html2)
            self.assertIn('<meta name="rk:api" content="https://example.test/api/r/1/">', html2)


class SelfReferenceTests(unittest.TestCase):
    def test_self_referencing_computed_field_is_rejected(self):
        from reportkit import Report
        r = Report("T")
        r.dataset("d", [{"ev": 1.0}], computed=[{"name": "ev", "formula": "ev * 1.1"}])
        r.page("P").block("bar", data="d", options={"encode": {"x": "ev", "y": "ev"}})
        errors, _ = r.check()
        self.assertTrue(any("self-referential" in e for e in errors), errors)


class PageSizeTests(unittest.TestCase):
    def test_letter_page_size(self):
        import tempfile
        from pathlib import Path
        from reportkit import Report
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as tmp:
            r = Report("T", page_size="letter")
            r.dataset("kpis", root / "kit/samples/datasets/kpis.json")
            r.page("P").block("kpi-tiles", data="kpis", height="auto")
            out = r.build(Path(tmp) / "a", kit=root)
            self.assertIn('data-rk-page-size="letter"', (out / "index.html").read_text())
            self.assertIn("@page { size: 11in 8.5in; margin: 0; }", (out / "assets/css/reportkit.css").read_text())
            self.assertIn('<meta name="rk:themes"', (out / "index.html").read_text())
        with self.assertRaises(ValueError):
            Report("T", page_size="legal")


class HardeningTests(unittest.TestCase):
    def test_dataset_id_rejected_early(self):
        from reportkit import Report
        r = Report("T")
        for bad in ("../x", "a/b", "peers\n", "__proto__"):
            with self.assertRaises(ValueError):
                r.dataset(bad, [{"a": 1}])

    def test_clean_keeps_foreign_files(self):
        import tempfile
        from pathlib import Path
        from reportkit import Report
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as tmp:
            r = Report("T")
            r.dataset("kpis", root / "kit/samples/datasets/kpis.json")
            r.page("P").block("kpi-tiles", data="kpis", height="auto")
            out = r.build(Path(tmp) / "a", kit=root)
            (out / "data" / "analyst-notes.txt").write_text("keep me")
            r.build(out, kit=root)
            self.assertTrue((out / "data" / "analyst-notes.txt").exists())
