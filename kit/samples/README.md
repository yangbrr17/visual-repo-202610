# ReportKit sample datasets

Synthetic, internally consistent investment-banking datasets shared by the gallery and the demo reports.
Every file follows the dataset contract in `docs/architecture.md` §4.1 (`id`, `title`, `schema.fields`, `data`, `meta`).

**Story.** *Helios Industrial* (HLX), a fictional listed industrial-technology company, is being evaluated for a sale
("Project Atlas") against 17 fictional peers in three sectors (Industrial Automation, Motion & Power Control,
Industrial Software & Sensors) and four regions (North America, Europe, Asia Pacific, Latin America).
Current share price **$42.50**, 158.0m diluted shares, market cap $6,715m, net debt $1,490m,
EV $8,205m. Data as of 2026-10-10. All companies, banks, investors and agencies are invented.

**Regenerate** (deterministic, seed 2026, stdlib only):

```bash
python3 tools/make_sample_data.py          # writes datasets/*.json, index.json, README.md
python3 tools/make_sample_data.py --check  # validates the files on disk against a fresh in-memory build
```

**Conventions.** Amounts in USD m unless the field `unit` says otherwise; percentages and growth rates are decimals
(`0.185` = 18.5%, formatted with `0.0%`); dates are ISO `YYYY-MM-DD`; missing values are `null` (rendered `n.a.`).
Formats are Excel-style codes understood by `RK.format`. `kpis.spark` is an array field (`type: "array"`).

**Consistency guarantees** (checked by `--check`): peers EV = market cap + net debt and multiples = EV / metric;
segment x region revenue sums to group revenue; countries sum to regions; Chinese provinces sum to China;
quarters sum to fiscal years; bridges and the Sankey balance; tree parents equal the sum of children;
DCF grid is monotonic (down in WACC, up in TGR) and LBO IRR is monotonic (down in entry, up in exit);
the football field (`valuation_ranges`) is derived from peers, precedents and the DCF / LBO grids;
price jumps in `price_ohlc` line up with `price_events`.

## Datasets (39 files, 2,095 rows)

| id | title | rows | fields | feeds |
|---|---|---:|---|---|
| `peers` | Trading comparables | 18 | `company`, `ticker`, `sector`, `region`, `country`, `hq_city`, `lat`, `lon`, `is_target`, `share_price`, `mkt_cap`, `net_debt`, `ev`, `revenue_24a`, `revenue_25e`, `revenue_26e`, `ebitda_25e`, `ebitda_26e`, `ebitda_margin_25e`, `rev_growth_25e`, `ev_revenue_25e`, `ev_ebitda_25e`, `ev_ebitda_26e`, `pe_25e`, `net_debt_ebitda`, `price_52w_low`, `price_52w_high`, `dividend_yield`, `tsr_1y` | Comps table, scatter (EV/EBITDA vs growth / margin), bubble, ranked bar, box plot, geo markers (lat/lon), global filters on sector / region |
| `price_ohlc` | Helios Industrial (HLX) daily share price | 522 | `date`, `open`, `high`, `low`, `close`, `volume` | Candlestick + volume, line with dataZoom, event annotations (with price_events) |
| `price_perf` | Relative share price performance | 424 | `date`, `series`, `value` | Multi-series rebased line chart (long format: date / series / value) |
| `price_events` | Helios Industrial share price events | 12 | `date`, `label`, `kind`, `detail` | Event markers / annotations on price charts, event timeline |
| `ntm_multiple` | NTM EV/EBITDA history | 106 | `date`, `target`, `peer_median` | Two-line trading-multiple history, premium/discount area |
| `financials` | Helios Industrial financial summary | 10 | `year`, `period`, `fiscal_year`, `revenue`, `gross_profit`, `ebitda`, `ebit`, `net_income`, `capex`, `fcf`, `ebitda_margin`, `revenue_growth` | Financial summary table, combo bar+line (revenue + margin), A/E styling |
| `segment_revenue` | Revenue by segment and region | 96 | `year`, `segment`, `region`, `revenue` | Stacked bar / area by segment or region, pivot table, small multiples |
| `quarterly` | Quarterly results vs. consensus | 11 | `quarter`, `date`, `revenue`, `ebitda`, `ebitda_margin`, `consensus_revenue`, `beat_miss_pct` | Beat/miss bars, actual vs consensus columns, margin line |
| `valuation_ranges` | Valuation summary: implied value per share | 8 | `method`, `group`, `low`, `high`, `basis`, `order` | Football field (low/high by method, grouped) |
| `ebitda_bridge` | EBITDA bridge FY25A to FY26E | 11 | `step`, `value`, `kind`, `category` | Waterfall / bridge (total + delta steps, colour by category) |
| `ev_equity_bridge` | Enterprise value to equity value bridge | 7 | `step`, `value`, `kind` | Waterfall from EV to equity value |
| `sensitivity_dcf` | DCF sensitivity: implied share price | 35 | `wacc`, `tgr`, `value` | Sensitivity heat table (WACC x TGR), what-if param demos |
| `sensitivity_lbo` | LBO sensitivity: sponsor IRR | 25 | `entry_multiple`, `exit_multiple`, `irr` | IRR heat table (entry x exit multiple) |
| `revenue_by_country` | Revenue by country (FY25A) | 36 | `iso3`, `iso_num`, `country`, `region`, `revenue`, `growth`, `employees`, `lat`, `lon` | World choropleth (iso_num = world-atlas id), bubble map, ranked bar |
| `assets_locations` | Global footprint | 47 | `name`, `type`, `city`, `country`, `lat`, `lon`, `capacity`, `utilization`, `opened` | Point / cluster / heat map (Leaflet), footprint table |
| `deal_flows` | Cross-border industrials M&A flows (2021–2026 YTD) | 26 | `from_country`, `from_lat`, `from_lon`, `to_country`, `to_lat`, `to_lon`, `value`, `deals`, `sector` | Flow / arc map (lines between lat/lon), chord-style flows |
| `china_provinces` | Greater China revenue by province (FY25A) | 34 | `province`, `province_zh`, `adcode`, `revenue`, `growth`, `stores` | China province choropleth (adcode), ranked bar |
| `market_share` | Market share by segment (2025) | 30 | `segment`, `player`, `revenue` | Marimekko / mosaic, 100% stacked bar |
| `ownership` | Shareholder structure | 15 | `holder`, `type`, `shares_m`, `pct`, `change_qoq_m`, `country` | Shareholder table, donut by investor type, bar of holders |
| `deal_timeline` | Project Atlas indicative timetable | 22 | `workstream`, `task`, `start`, `end`, `phase`, `milestone`, `owner` | Gantt with phases and milestones |
| `league_table` | Global industrials M&A league table (LTM Sep-2026) | 12 | `rank`, `bank`, `deal_value_bn`, `deals`, `market_share`, `prior_rank` | Ranked league table, horizontal bar with rank change |
| `precedents` | Selected precedent transactions | 21 | `date`, `target`, `acquirer`, `target_country`, `sector`, `ev`, `ev_revenue`, `ev_ebitda`, `premium_1d`, `premium_30d`, `consideration`, `status` | Precedent transactions table, scatter of EV/EBITDA over time, premium box plot |
| `segments_tree` | Revenue hierarchy: group > segment > product line (FY25A) | 18 | `id`, `parent`, `name`, `value`, `growth` | Treemap, sunburst, indented tree (id / parent) |
| `pnl_flow` | FY25A P&L flow (revenue to net income) | 13 | `source`, `target`, `value` | Sankey (revenue to net income) |
| `corr_matrix` | 1-year daily return correlation | 64 | `x`, `y`, `value` | Correlation heatmap |
| `peer_scores` | Peer scorecard | 30 | `company`, `metric`, `score` | Radar / spider chart, scorecard heatmap |
| `kpis` | Key performance indicators | 6 | `id`, `label`, `value`, `format`, `delta`, `delta_format`, `period`, `spark`, `good` | KPI tiles with delta and sparkline |
| `org_structure` | Simplified legal entity structure | 15 | `id`, `parent`, `name`, `country`, `ownership_pct`, `entity_type` | Org / legal-entity tree diagram |
| `pipeline_funnel` | Commercial pipeline (LTM Sep-26) | 5 | `stage`, `count`, `value` | Funnel chart |
| `scenarios` | Management plan scenarios | 18 | `scenario`, `year`, `revenue`, `ebitda`, `fcf` | Scenario line / fan chart, grouped bars |
| `monthly_returns` | Helios Industrial monthly TSR | 57 | `year`, `month`, `return` | Year x month heatmap of returns |
| `daily_activity` | Daily trading activity 2026 YTD | 204 | `date`, `value` | Calendar heatmap |
| `network_nodes` | Ecosystem map: nodes | 24 | `id`, `name`, `type`, `size` | Force-directed network graph (nodes) |
| `network_edges` | Ecosystem map: relationships | 35 | `source`, `target`, `value`, `type` | Force-directed network graph (edges) |
| `debt_maturity` | Debt maturity profile | 40 | `year`, `instrument`, `amount` | Stacked maturity-profile bars |
| `yield_curve` | USD sovereign yield curve | 10 | `tenor`, `tenor_years`, `current`, `one_month_ago`, `one_year_ago` | Multi-line yield curve (tenor_years as numeric x) |
| `credentials` | Selected transaction credentials | 12 | `date`, `target`, `acquirer`, `deal_value_bn`, `deal_type`, `role`, `sector`, `region`, `description` | Deal credentials / tombstone grid (deal type, parties, value, role), filterable by sector / region |
| `sources_uses` | Illustrative LBO sources & uses at $52.00 per share | 11 | `side`, `item`, `amount`, `multiple_of_ebitda`, `pct`, `notes` | LBO sources & uses table (two balancing sides, % of total, x EBITDA, footnotes) |
| `capital_structure` | Pro forma capitalisation at close | 5 | `instrument`, `amount`, `rate`, `maturity`, `multiple_cum` | Pro forma capitalisation table (tranches, rates, maturities, cumulative leverage) |

`peer_returns_dist` from the original wish-list is intentionally omitted: bucket `peers.ev_ebitda_25e` client-side.
