"""Dataset normalisation: DataFrame / records / columns / files -> data-contract JSON (architecture.md §4.1).

pandas and numpy are optional. They are never imported at module import time; numpy / pandas
values are recognised by duck typing, and pandas is imported lazily only to read .parquet / .xlsx
files or when a DataFrame is passed in (in which case it is already imported by the caller).
"""
from __future__ import annotations

import csv
import dataclasses
import io
import datetime as _dt
import enum
import fractions
import json
import math
import re
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Mapping

from ._util import as_list, iso_date
from .errors import DataError

__all__ = [
    "FIELD_TYPES", "LARGE_DATASET_ROWS", "Table", "to_json_value", "infer_type", "normalize_dataset",
    "read_table", "normalize_computed", "is_iso_date",
]

FIELD_TYPES = ("string", "number", "date", "boolean")
EXTRA_FIELD_TYPES = ("array", "object")   # list / dict cells (e.g. sparkline series in kpi-tiles)
LARGE_DATASET_ROWS = 50_000

# Strict ISO date / datetime (the builder always writes explicit types, so we can be stricter
# than the browser's fallback inference: '2025-26' fiscal labels stay strings).
_ISO_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$"
)


def is_iso_date(s: str) -> bool:
    m = _ISO_RE.match(s)
    if not m:
        return False
    mo, d = int(m.group(2)), int(m.group(3))
    return 1 <= mo <= 12 and 1 <= d <= 31


# --------------------------------------------------------------------------------------------
# Scalars
# --------------------------------------------------------------------------------------------
def _iso_datetime(v: _dt.datetime) -> str:
    suffix = ""
    if v.tzinfo is not None and v.utcoffset() is not None:
        v = v.astimezone(_dt.timezone.utc).replace(tzinfo=None)
        suffix = "Z"
    if v.hour == 0 and v.minute == 0 and v.second == 0 and v.microsecond == 0:
        return v.date().isoformat()
    spec = "milliseconds" if v.microsecond else "seconds"
    return v.isoformat(timespec=spec) + suffix


def _finite(f: float) -> float | None:
    return f if math.isfinite(f) else None


def to_json_value(v: Any) -> Any:
    """Convert one value to a JSON-safe Python value.

    numpy scalars -> Python; NaN / NaT / pd.NA / +-inf -> None; datetime / date -> ISO
    ('YYYY-MM-DD', or 'YYYY-MM-DDTHH:MM:SS' when a time of day is present); Decimal -> float;
    containers recurse; unknown objects -> str(v).
    """
    if v is None:
        return None
    t = type(v)
    if t is str:
        return v
    if t is bool:
        return v
    if t is int:
        return v
    if t is float:
        return _finite(v)
    tname = t.__name__
    if tname in ("NaTType", "NAType"):  # pandas.NaT / pandas.NA (NaT subclasses datetime!)
        return None
    mod = t.__module__ or ""
    if mod.startswith("numpy"):
        if tname.startswith("datetime64"):
            try:
                v = v.astype("datetime64[us]").item()  # -> datetime | None (NaT)
            except Exception:  # pragma: no cover - exotic units
                return str(v)
            return to_json_value(v)
        if tname.startswith("timedelta64"):
            try:
                v = v.astype("timedelta64[us]").item()
            except Exception:  # pragma: no cover
                return str(v)
            return to_json_value(v)
        if hasattr(v, "tolist"):  # ndarray and numpy scalars (.tolist() on a scalar == .item())
            return to_json_value(v.tolist())
    if isinstance(v, bool):
        return bool(v)
    if isinstance(v, int):
        return int(v)
    if isinstance(v, float):
        return _finite(float(v))
    if isinstance(v, str):
        return str(v)
    if isinstance(v, _dt.datetime):
        if hasattr(v, "to_pydatetime"):  # pandas.Timestamp
            v = v.to_pydatetime()
        return _iso_datetime(v)
    if isinstance(v, _dt.date):
        return v.isoformat()
    if isinstance(v, _dt.time):
        return v.isoformat()
    if isinstance(v, _dt.timedelta):
        return v.total_seconds()
    if isinstance(v, Decimal):
        if not v.is_finite():
            return None
        return float(v)
    if isinstance(v, fractions.Fraction):
        return float(v)
    if isinstance(v, enum.Enum):
        return to_json_value(v.value)
    if isinstance(v, (bytes, bytearray)):
        return bytes(v).decode("utf-8", "replace")
    if isinstance(v, Mapping):
        return {str(k): to_json_value(x) for k, x in v.items()}
    if isinstance(v, (set, frozenset)):
        return sorted((to_json_value(x) for x in v), key=lambda x: (str(type(x)), str(x)))
    if isinstance(v, (list, tuple)):
        return [to_json_value(x) for x in v]
    if dataclasses.is_dataclass(v) and not isinstance(v, type):
        return to_json_value(dataclasses.asdict(v))
    if hasattr(v, "item") and callable(v.item):  # other array-likes / scalars
        try:
            return to_json_value(v.item())
        except Exception:
            pass
    if isinstance(v, complex):
        return str(v)
    try:
        f = float(v)  # numbers.Real implementations
        if not isinstance(v, (str, bytes)):
            return _finite(f)
    except (TypeError, ValueError):
        pass
    return str(v)


def infer_type(values: Iterable[Any]) -> str:
    """Field type for a column of already-normalised values."""
    seen: set[str] = set()
    for v in values:
        if v is None or v == "":
            continue
        if isinstance(v, bool):
            seen.add("boolean")
        elif isinstance(v, (int, float)):
            seen.add("number")
        elif isinstance(v, str):
            seen.add("date" if is_iso_date(v) else "string")
        elif isinstance(v, list):
            seen.add("array")
        elif isinstance(v, dict):
            seen.add("object")
        else:
            seen.add("string")
        if len(seen) > 1:
            return "string"
    return seen.pop() if seen else "string"


# --------------------------------------------------------------------------------------------
# Readers -> (names, columns)
# --------------------------------------------------------------------------------------------
Columns = tuple[list[str], list[list[Any]]]


class Table(tuple):
    """(names, columns) parsed from a CSV file by the stdlib reader."""
    __slots__ = ()

    def __new__(cls, names: list[str], columns: list[list[Any]]):
        return super().__new__(cls, (names, columns))

    @property
    def names(self) -> list[str]:
        return self[0]

    @property
    def columns(self) -> list[list[Any]]:
        return self[1]

_NA_TOKENS = {"", "na", "n/a", "#n/a", "nan", "null", "none", "n.a.", "n.m.", "nm", "-", "--", "—", "#value!", "#div/0!"}
_NUM_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")
_NUM_THOUSANDS_RE = re.compile(r"^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$")
_LEADING_ZERO_RE = re.compile(r"^[+-]?0\d")


def _parse_number(s: str) -> int | float:
    s = s.replace(",", "")
    if re.match(r"^[+-]?\d+$", s):
        return int(s)
    return float(s)


def _csv_columns(path: Path, delimiter: str | None = None) -> Table:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        text = fh.read()
    if delimiter is None:  # predictable: decided by the header line only
        header_line = text.split("\n", 1)[0]
        delimiter = next((d for d in (",", ";", "\t", "|") if d in header_line), ",")
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        return Table([], [])
    header = [h.strip() for h in rows[0]]
    width = max(len(r) for r in rows)
    header += [""] * (width - len(header))
    used: set[str] = set()
    names = []
    for i, h in enumerate(header):
        h = h or f"column_{i + 1}"
        base, n = h, 2
        while h in used:
            h, n = f"{base}_{n}", n + 1
        used.add(h)
        names.append(h)
    body = [r + [""] * (width - len(r)) for r in rows[1:]]
    columns = [_parse_csv_column([r[i] for r in body]) for i in range(width)]
    return Table(names, columns)


def _parse_csv_column(raw: list[str]) -> list[Any]:
    """Column-level typing so 'NA' (North America) stays a string unless the column is numeric."""
    stripped = [c.strip() for c in raw]
    real = [c for c in stripped if c.lower() not in _NA_TOKENS]
    if real and all(_NUM_RE.match(c) or _NUM_THOUSANDS_RE.match(c) for c in real) \
            and not any(_LEADING_ZERO_RE.match(c) and "." not in c for c in real):
        return [None if c.lower() in _NA_TOKENS else _parse_number(c) for c in stripped]
    if real and all(c.lower() in ("true", "false") for c in real):
        return [None if c.lower() in _NA_TOKENS else c.lower() == "true" for c in stripped]
    return [None if c == "" else c for c in raw]


def _records_to_columns(records: list[Any]) -> Columns:
    names: list[str] = []
    index: dict[str, int] = {}
    dict_rows = []
    for i, r in enumerate(records):
        if dataclasses.is_dataclass(r) and not isinstance(r, type):
            r = dataclasses.asdict(r)
        elif hasattr(r, "_asdict"):  # namedtuple
            r = r._asdict()
        elif not isinstance(r, Mapping):
            raise DataError(f"row {i} is a {type(r).__name__}; expected a dict (record)")
        dict_rows.append(r)
        for k in r:
            ks = str(k)
            if ks not in index:
                index[ks] = len(names)
                names.append(ks)
    columns = [[None] * len(dict_rows) for _ in names]
    for ri, r in enumerate(dict_rows):
        for k, v in r.items():
            columns[index[str(k)]][ri] = to_json_value(v)
    return names, columns


def _arrays_to_columns(rows: list[Any], names: list[str]) -> Columns:
    columns = [[None] * len(rows) for _ in names]
    for ri, r in enumerate(rows):
        if len(r) > len(names):
            raise DataError(f"row {ri} has {len(r)} values but only {len(names)} fields are defined")
        for ci, v in enumerate(r):
            columns[ci][ri] = to_json_value(v)
    return names, columns


def _dict_to_columns(d: Mapping) -> Columns:
    """{col: [values]} or pandas-style {col: {index: value}}."""
    names = [str(k) for k in d]
    vals = list(d.values())
    if vals and all(isinstance(v, Mapping) for v in vals):
        # orient="columns": union of index keys in first-seen order
        keys: list[Any] = []
        seen = set()
        for v in vals:
            for k in v:
                if k not in seen:
                    seen.add(k)
                    keys.append(k)
        return names, [[to_json_value(v.get(k)) for k in keys] for v in vals]
    cols = []
    length = None
    for name, v in zip(names, vals):
        if isinstance(v, (str, bytes)) or not hasattr(v, "__iter__"):
            raise DataError(f"column '{name}' is not a list of values")
        col = [to_json_value(x) for x in v]
        if length is not None and len(col) != length:
            raise DataError(f"columns have different lengths ('{name}' has {len(col)}, expected {length})")
        length = len(col)
        cols.append(col)
    return names, cols


def _frame_to_columns(df: Any) -> Columns:
    """pandas DataFrame -> columns. A named / datetime index becomes a leading column."""
    import pandas as pd  # the caller already has pandas if they passed a DataFrame

    if isinstance(df, pd.Series):
        df = df.to_frame(name=df.name if df.name is not None else "value")
    idx = df.index
    keep_index = (any(n is not None for n in idx.names) or isinstance(idx, pd.DatetimeIndex)
                  or isinstance(idx, pd.PeriodIndex))
    if keep_index:
        if isinstance(idx, pd.PeriodIndex):
            df = df.copy()
            df.index = idx.to_timestamp()
        df = df.reset_index()
    cols = df.columns
    if isinstance(cols, pd.MultiIndex):
        names = ["_".join(str(p) for p in tup if p is not None and str(p) != "") for tup in cols]
    else:
        names = ["index" if c is None else str(c) for c in cols]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        raise DataError(f"DataFrame has duplicate column names: {', '.join(dupes)}")
    columns = []
    for i in range(df.shape[1]):
        s = df.iloc[:, i]
        if hasattr(s.dtype, "kind") and s.dtype.kind == "M" or str(s.dtype).startswith("datetime64"):
            values = list(s)  # Timestamps / NaT
        elif str(s.dtype).startswith("period"):
            values = [None if p is pd.NaT else p.to_timestamp() for p in s]
        else:
            values = s.tolist()
        columns.append([to_json_value(v) for v in values])
    return names, columns


def _is_dataframe(obj: Any) -> bool:
    t = type(obj)
    return t.__module__.startswith("pandas") and t.__name__ in ("DataFrame", "Series")


def _pandas(feature: str):
    try:
        import pandas as pd
    except ImportError as e:  # pragma: no cover - depends on environment
        raise DataError(f"{feature} requires pandas (pip install 'reportkit[pandas]')") from e
    return pd


def read_table(path: str | Path) -> Any:
    """Read a .csv / .tsv / .json / .parquet / .xlsx file into something normalize_dataset accepts.

    CSV is read with the stdlib (identical results with or without pandas); parquet / Excel need pandas.
    """
    p = Path(path)
    if not p.is_file():
        raise DataError(f"data file not found: {p}")
    ext = p.suffix.lower()
    if ext in (".csv", ".txt"):
        return _csv_columns(p)
    if ext == ".tsv":
        return _csv_columns(p, delimiter="\t")
    if ext == ".json":
        try:
            return json.loads(p.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as e:
            raise DataError(f"{p}: invalid JSON ({e})") from e
    if ext in (".parquet", ".pq"):
        return _pandas(f"reading {p.name}").read_parquet(p)
    if ext in (".xlsx", ".xls", ".xlsm"):
        return _pandas(f"reading {p.name}").read_excel(p)
    raise DataError(f"unsupported data file type '{ext}' ({p.name}); use .csv, .json, .parquet or .xlsx")


def _is_contract(d: Mapping) -> bool:
    """{"data": [records | arrays], "schema"?, "meta"?, ...} (also "rows" instead of "data")."""
    rows = d.get("data", d.get("rows"))
    if not isinstance(rows, list) or not all(isinstance(r, (Mapping, list)) for r in rows):
        return False
    return bool(rows) or any(k in d for k in ("schema", "fields", "meta", "id", "title", "computed")) or len(d) == 1


def _to_columns(data: Any, field_names: list[str] | None) -> tuple[Columns, dict]:
    """Return ((names, columns), contract_extras) for any supported input."""
    extras: dict = {}
    if isinstance(data, (str, Path)):
        data = read_table(data)
    if isinstance(data, Table):
        return (list(data.names), [list(c) for c in data.columns]), extras
    if _is_dataframe(data):
        return _frame_to_columns(data), extras
    if isinstance(data, Mapping):
        if "columns" in data and "data" in data and isinstance(data.get("columns"), list) \
                and all(isinstance(r, list) for r in data["data"]):  # pandas orient="split"
            return _arrays_to_columns(data["data"], [str(c) for c in data["columns"]]), extras
        if _is_contract(data):
            extras = {k: v for k, v in data.items() if k not in ("data", "rows")}
            schema_fields = (data.get("schema") or {}).get("fields") or data.get("fields")
            rows = data.get("data", data.get("rows")) or []
            if rows and isinstance(rows[0], list):
                names = [f if isinstance(f, str) else f["name"] for f in (schema_fields or [])]
                if not names:
                    raise DataError("dataset rows are arrays but no schema.fields define their names")
                return _arrays_to_columns(rows, names), extras
            names, cols = _records_to_columns(rows)
            # keep schema field order (fields with no values yet still appear)
            if schema_fields:
                order = [f if isinstance(f, str) else f.get("name") for f in schema_fields]
                names, cols = _reorder(names, cols, order)
            return (names, cols), extras
        return _dict_to_columns(data), extras
    if isinstance(data, (list, tuple)) or (hasattr(data, "__iter__") and not isinstance(data, (str, bytes))):
        rows = list(data)
        if rows and (isinstance(rows[0], (list, tuple)) and not hasattr(rows[0], "_asdict")
                     or type(rows[0]).__name__ == "ndarray"):
            if not field_names:
                raise DataError("rows are arrays; pass fields=[...names...] to name the columns")
            return _arrays_to_columns(rows, field_names), extras
        return _records_to_columns(rows), extras
    raise DataError(f"unsupported data type {type(data).__name__}; pass a DataFrame, list of dicts, "
                    "dict of lists, a contract-form dict, or a path to .csv/.json/.parquet")


def _reorder(names: list[str], cols: list[list], order: list[str]) -> Columns:
    n_rows = len(cols[0]) if cols else 0
    pos = {n: i for i, n in enumerate(names)}
    out_names, out_cols = [], []
    for n in order:
        if n is None or n in out_names:
            continue
        out_names.append(n)
        out_cols.append(cols[pos[n]] if n in pos else [None] * n_rows)
    for n, c in zip(names, cols):
        if n not in out_names:
            out_names.append(n)
            out_cols.append(c)
    return out_names, out_cols


# --------------------------------------------------------------------------------------------
# Fields / computed / meta
# --------------------------------------------------------------------------------------------
def _field_overrides(fields: Any) -> tuple[dict[str, dict], list[str] | None]:
    """fields= accepts {name: {...} | "Title"} or [ {name,...} | "name" ]; returns (overrides, order)."""
    if fields is None:
        return {}, None
    out: dict[str, dict] = {}
    order: list[str] | None = None
    if isinstance(fields, Mapping):
        for name, spec in fields.items():
            if isinstance(spec, str):
                spec = {"title": spec}
            elif spec is None:
                spec = {}
            elif not isinstance(spec, Mapping):
                raise DataError(f"fields['{name}'] must be a dict or a title string")
            out[str(name)] = dict(spec)
    elif isinstance(fields, (list, tuple)):
        order = []
        for f in fields:
            if isinstance(f, str):
                f = {"name": f}
            if not isinstance(f, Mapping) or not f.get("name"):
                raise DataError("each entry of fields=[...] needs a 'name'")
            name = str(f["name"])
            order.append(name)
            out[name] = {k: v for k, v in f.items() if k != "name"}
    else:
        raise DataError("fields must be a dict {name: {...}} or a list of field dicts")
    return out, order


def normalize_computed(computed: Any) -> list[dict]:
    """[{name, formula, ...}] or {name: formula | {formula, ...}} -> list of dicts (order kept)."""
    if not computed:
        return []
    items: list[dict] = []
    if isinstance(computed, Mapping):
        for name, spec in computed.items():
            if isinstance(spec, str):
                spec = {"formula": spec}
            items.append({"name": str(name), **dict(spec)})
    else:
        for c in computed:
            if not isinstance(c, Mapping):
                raise DataError("computed entries must be dicts with 'name' and 'formula'")
            items.append(dict(c))
    out = []
    for c in items:
        c = {k: to_json_value(v) for k, v in c.items() if v is not None}
        ordered = {k: c[k] for k in ("name", "formula", "title", "type", "format", "unit") if k in c}
        ordered.update({k: c[k] for k in sorted(c) if k not in ordered})
        out.append(ordered)
    return out


def _order_field(f: dict) -> dict:
    head = {k: f[k] for k in ("name", "type", "title") if k in f}
    head.update({k: f[k] for k in sorted(f) if k not in head})
    return head


def normalize_dataset(
    id: str,
    data: Any,
    *,
    title: str | None = None,
    fields: Any = None,
    source: str | None = None,
    notes: Any = None,
    unit: str | None = None,
    as_of: Any = None,
    computed: Any = None,
) -> tuple[dict, list[str]]:
    """Normalise any supported input to a contract dataset dict.

    Returns (dataset_json, warnings). Keyword arguments override values found in a contract-form input.
    """
    warnings: list[str] = []
    overrides, order = _field_overrides(fields)
    (names, columns), extras = _to_columns(data, order)

    # schema from contract-form input (types / titles / formats the producer already set)
    base_fields: dict[str, dict] = {}
    contract_fields = (extras.get("schema") or {}).get("fields") or extras.get("fields") or []
    for f in contract_fields:
        f = {"name": f} if isinstance(f, str) else dict(f)
        base_fields[str(f["name"])] = {k: to_json_value(v) for k, v in f.items() if k != "name" and v is not None}

    if order:
        names, columns = _reorder(names, columns, order)

    n_rows = len(columns[0]) if columns else 0
    field_list = []
    for name, col in zip(names, columns):
        spec = dict(base_fields.get(name, {}))
        spec.update({k: to_json_value(v) for k, v in overrides.get(name, {}).items() if v is not None})
        ftype = spec.get("type") or infer_type(col)
        if ftype not in FIELD_TYPES + EXTRA_FIELD_TYPES:
            warnings.append(f"dataset '{id}': field '{name}' has non-standard type '{ftype}' "
                            f"(contract types: {', '.join(FIELD_TYPES)})")
        spec["name"] = name
        spec["type"] = ftype
        spec.setdefault("title", name)
        field_list.append(_order_field(spec))

    unknown = [n for n in overrides if n not in names]
    for n in unknown:
        warnings.append(f"dataset '{id}': fields override for '{n}' but the data has no such column "
                        f"(columns: {', '.join(names) or 'none'})")

    rows = [{names[c]: columns[c][r] for c in range(len(names))} for r in range(n_rows)]

    meta = dict(extras.get("meta") or {})
    if source is not None:
        meta["source"] = source
    if unit is not None:
        meta["unit"] = unit
    if notes is not None:
        meta["notes"] = [str(n) for n in as_list(notes)]
    elif isinstance(meta.get("notes"), str):
        meta["notes"] = [meta["notes"]]
    if as_of is not None:
        meta["asOf"] = iso_date(as_of)
    meta = {k: to_json_value(v) for k, v in meta.items() if v is not None}

    comp = normalize_computed(computed if computed is not None else extras.get("computed"))

    out: dict[str, Any] = {
        "id": id,
        "title": title or extras.get("title") or id,
        "schema": {"fields": field_list},
        "data": rows,
        "meta": {k: meta[k] for k in sorted(meta)},
    }
    if comp:
        out["computed"] = comp
    return out, warnings
