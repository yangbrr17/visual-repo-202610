"""Exceptions raised by the ReportKit builder."""
from __future__ import annotations

from typing import Iterable

__all__ = ["ReportKitError", "ReportValidationError", "BuildError", "KitNotFoundError", "DataError"]


class ReportKitError(Exception):
    """Base class for every ReportKit error."""


class DataError(ReportKitError, ValueError):
    """A dataset could not be read or normalised."""


class KitNotFoundError(ReportKitError):
    """The kit root (folder containing kit/build.json) could not be located."""


class BuildError(ReportKitError):
    """The report folder could not be written."""


class ReportValidationError(ReportKitError, ValueError):
    """Raised by Report.validate() / build() with *every* problem found (not just the first).

    Attributes:
        errors:   list[str] — blocking problems
        warnings: list[str] — non-blocking notes (large datasets, unused field overrides ...)
    """

    def __init__(self, errors: Iterable[str], warnings: Iterable[str] = ()):
        self.errors = list(errors)
        self.warnings = list(warnings)
        n = len(self.errors)
        lines = [f"Report validation failed with {n} problem{'s' if n != 1 else ''}:"]
        lines += [f"  - {e}" for e in self.errors]
        if self.warnings:
            lines.append(f"({len(self.warnings)} warning{'s' if len(self.warnings) != 1 else ''}:)")
            lines += [f"  ~ {w}" for w in self.warnings]
        super().__init__("\n".join(lines))
