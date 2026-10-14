"""ReportKit — build offline, data-separated, interactive client reports from Python.

    from reportkit import Report

    r = Report("Project Atlas", subtitle="Discussion materials", client="Board of Directors",
               date="2026-10-14", firm="Northbridge Partners")
    r.dataset("comps", df, source="FactSet; market data as of 10-Oct-2026",
              fields={"ev_ebitda": {"title": "EV/EBITDA 2025E", "format": "0.0x"}})
    r.cover()
    p = r.page("Peers trade at a median 9.5x EBITDA", kicker="Trading comparables")
    p.block("bar", data="comps", encode={"x": "company", "y": "ev_ebitda"}, span=7, height=340)
    r.build("out/atlas")          # -> out/atlas/index.html (double-click to open)

See py/README.md and docs/architecture.md (the binding contract).
"""
from __future__ import annotations

__version__ = "0.1.0"

from .errors import BuildError, DataError, KitNotFoundError, ReportKitError, ReportValidationError  # noqa: E402
from .kit import Kit  # noqa: E402
from .report import Block, Page, Report, SpecError  # noqa: E402
from .build import ReportKitWarning  # noqa: E402
from .data import normalize_dataset, to_json_value  # noqa: E402

__all__ = [
    "__version__", "Report", "Page", "Block", "Kit",
    "ReportKitError", "ReportValidationError", "BuildError", "KitNotFoundError", "DataError", "SpecError",
    "ReportKitWarning", "normalize_dataset", "to_json_value",
]
