# ReportKit 公式与查询语言 · Formula & Query Language

> 面向客户与分析师的参考手册：在 ReportKit 报告中自定义指标（computed fields）、在查询控制台中输入查询、编写筛选条件。
> 本文所有示例均在示例数据上**由脚本实际执行并核对结果**（见[附录 A](#附录-a--appendix-a验证--verification)）。
>
> Reference for clients and analysts: custom metrics (computed fields), the query console and filter expressions in
> ReportKit reports. **Every example below is executed against the sample data and its result checked by a script**
> (see [Appendix A](#附录-a--appendix-a验证--verification)).

**示例数据 / Sample data** — `kit/samples/datasets/`：`peers`（18 家可比公司 / trading comparables）、`financials`
（Helios Industrial 2019A–2028E 财务摘要）、`precedents`（21 宗先例交易 / precedent transactions）、`segment_revenue`
（分业务 × 地区收入 / revenue by segment and region）。示例参数 / sample parameters: `@wacc` = 9.0%, `@g` = 2.0%,
`@multiple` = 10.0x。

**目录 / Contents**

1. [速览 / At a glance](#1-速览--at-a-glance)
2. [在哪里使用 / Where formulas are used](#2-在哪里使用--where-formulas-are-used)
3. [字面量 / Literals](#3-字面量--literals)
4. [字段引用 / Field references](#4-字段引用--field-references)
5. [参数 / Parameters](#5-参数--parameters)
6. [运算符与优先级 / Operators & precedence](#6-运算符与优先级--operators--precedence)
7. [空值与无意义值 / null, n.a. and n.m.](#7-空值与无意义值--null-na-and-nm)
8. [函数 / Functions](#8-函数--functions)
9. [行公式与聚合公式 / Row vs aggregate formulas](#9-行公式与聚合公式--row-vs-aggregate-formulas)
10. [查询语言 / Query language](#10-查询语言--query-language)
11. [实例 / Worked examples](#11-实例--worked-examples)
12. [格式码速查 / Format codes](#12-格式码速查--format-codes)
13. [错误信息 / Error messages](#13-错误信息--error-messages)
14. [技巧与易错点 / Tips & gotchas](#14-技巧与易错点--tips--gotchas)
15. [已知问题 / Known issues](#15-已知问题--known-issues)

---

## 1. 速览 / At a glance

```text
ev / ebitda_25e                                   行公式：每行一个值            row formula: one value per row
ebitda_margin_25e >= 20% and region == "Europe"   条件（筛选 / where）          condition (filter / where)
`EV/EBITDA 2025E` * (1 + @wacc)                   用标题引用字段 + 参数          field by title + parameter
median(ev_ebitda_25e)                             聚合公式：每组一个值          aggregate: one value per group
sum(ev) / sum(ebitda_25e)                         聚合比率（合计倍数）          aggregate ratio
```

```text
median(ev_ebitda_25e) as "Median", count()     ← 选择列 / columns
by sector                                      ← 分组 / group by
from peers                                     ← 数据集 / dataset
where not is_target                            ← 条件 / filter
sort 2 desc                                    ← 排序：第 2 列 = Median（第 1 列是分组列 sector）/ sort by column 2
top 5                                          ← 前 N 行 / first N rows
```

查询可以写在一行，也可以像上面这样分行。A query may be written on one line or across several lines as above.

- 公式语言是**安全的**：不会执行任意代码（没有 `eval`，没有对象属性访问语法），只能读取当前行的字段、报告参数和内置函数。
  The language is **sandboxed**: no `eval`, no property access syntax — a formula can only read fields of the current
  row(s), report parameters and the built-in functions listed below.
- 关键字与函数名**不区分大小写**（`SUM`、`Sum`、`sum` 相同）；字符串比较也**不区分大小写**。
  Keywords and function names are **case-insensitive**; string comparison is **case-insensitive** too.

## 2. 在哪里使用 / Where formulas are used

| 场景 / Where | 写法 / How | 公式类型 / Kind |
|---|---|---|
| 派生字段 / Computed fields | dataset JSON `"computed": [{"name": "ebitda_margin", "formula": "ebitda / revenue", "format": "0.0%"}]`；Python：`r.dataset(..., computed=[...])` | 行公式，可用 `@参数`，参数变化时实时重算 / row formula, may use `@params`, recomputed live |
| 查询控制台 / Query console | `RK.query('median(ev_ebitda_25e) by sector from peers')`（`query-console` 组件） | 完整查询语言（§10）/ full query language |
| 客户自建指标 / Client metrics | `query-console` 的“添加为指标 / Add as metric”；`ds.addComputed({name, formula, format, user: true})` | 行公式；保存在客户本机浏览器（按报告），重开报告自动恢复 / row formula, saved per report in the browser and restored on reopen |
| 标题模板 / Title templates | 页面与模块标题：`{{peers: median(ev_ebitda_25e) \| 0.0x}}`、`{{@wacc \| 0.0%}}`（`docs/architecture.md` §7.1） | 聚合在筛选后的行上求值，行公式取第一行 / aggregates over the filtered rows, row formulas read the first row |
| 筛选 / Filters | `RK.store.setFilter('cheap', {op: 'expr', expr: 'ev_ebitda_25e < 10'})`，`RK.data.view(id, {where: '…'})` | 条件（行公式）/ condition |
| 文本占位符 / Text placeholders | `text-block`：`{{median(ev_ebitda_25e)\|0.0x}}`、`{{@wacc\|0.0%}}` | 行或聚合公式 + 格式码 / row or aggregate + format |
| 开发者 API / Developer API | `RK.expr.compile(src, {fields})`、`RK.expr.evaluate(src, row)`、`RK.expr.check(src)` | — |

Python 构建器在 `build()` 时会检查公式引用的字段与 `@参数` 是否存在，错误一次性列出。
The Python builder validates field and `@param` references of computed formulas at build time and lists every problem at once.

客户自建指标与派生字段遵守同样的规则；保存的指标若在报告更新后不再能编译（字段被删除等）会被跳过，不会报错；与数据中真实列同名时不会覆盖该列。
Client metrics follow the same rules; a saved metric that no longer compiles after the report is updated is skipped, and
it never overrides a real column of the same name.

派生字段**不能引用自身**：`x = x * (1 + @g)` 每次拖动滑块都会在上一次结果上累乘，因此报错
`Computed field "x" cannot reference itself — give the result a new name`；多个派生字段之间也不能循环引用
（`Computed fields cannot reference each other in a loop (a -> b -> a) …`）。重新定义同名派生字段时保留其原有位置，
读取它的字段随之重算。A computed field **cannot reference itself** (it would compound on every slider move) or form a
loop with other computed fields. Redefining a computed field keeps its place, and the fields that read it are recomputed.

## 3. 字面量 / Literals

| 类型 / Type | 写法 / Syntax | 说明 / Notes |
|---|---|---|
| 数字 / Number | `12`, `0.5`, `.5`, `1e6`, `2.5E-3` | 不支持千分位 `1,000` 与十六进制 / no thousands separators, no hex |
| 百分数 / Percent | `20%` = 0.20, `1.5%` = 0.015 | `%` 只能紧跟在数字后面；没有取模运算 / `%` only directly after a number literal; there is no modulo |
| 文本 / Text | `"Asia"` 或 / or `'Asia'` | `\"`、`\'`、`\\` 转义；反斜杠后的字符按原样保留（`"\n"` 即 `n`） / backslash keeps the next character literally |
| 布尔 / Boolean | `true`, `false` | 运算中 true = 1, false = 0 / count as 1 / 0 in arithmetic |
| 空值 / Null | `null` | 显示为 n.a. / shown as n.a. |
| 列表 / List | `["Europe", "Asia Pacific"]` 或 / or `("Europe", "Asia Pacific")` | 用于 `in` / used with `in` |

<!-- verify:expr dataset=peers row=0 -->
| 公式 / Formula | 结果 / Result |
|---|---|
| `20%` | `0.2` |
| `ebitda_margin_25e > 18%` | `true` |
| `1.5e3 + .5` | `1500.5` |
| `"it's"` | `"it's"` |
| `'say \"hi\"'` | `"say \"hi\""` |
| `true + true` | `2` |
| `region in ["Europe", "North America"]` | `true` |

## 4. 字段引用 / Field references

| 写法 / Syntax | 示例 / Example | 说明 / Notes |
|---|---|---|
| 裸名 / Bare name | `ev_ebitda_25e`, `营业收入` | 字母、数字、下划线、中文等（不能以数字开头）/ letters, digits, `_`, CJK and other non-ASCII letters; must not start with a digit |
| 反引号 / Backticks | `` `EV/EBITDA 2025E` ``, `` `HQ city` `` | 任意名称或**字段标题**（含空格、符号、以数字开头）/ any name or **field title** |
| 方括号 / Brackets | `[Enterprise value]` | 同上，但内容不能以数字开头、不能含逗号或引号；在 `in` 之后 `[...]` 一律视为列表 / like backticks, but the text must not start with a digit or contain `,` `"` `'`; after `in` it is always a list |

- **匹配规则**：字段名与标题都可用；不区分大小写；空格与下划线视为相同（`` `ev ebitda 25e` `` = `ev_ebitda_25e`）。
  **Matching**: names and titles both work, case-insensitively, and blanks and underscores are interchangeable.
- 拼写错误会提示最接近的字段：`Unknown field "revnue_25e" — did you mean …?`
  Misspelt names get suggestions.
- 名称与关键字（`and or not in true false null`）相同、或与函数同名且后跟 `(` 时，用反引号：`` `in` ``。
  Quote names that collide with keywords, or with a function name when followed by `(`.
- 中文输入法注意：全角括号、逗号（`（）`、`，`）会被当作名称的一部分，函数调用请用半角 `( , )`。
  Chinese IME: full-width punctuation is part of a name — use half-width `( , )` for calls.

<!-- verify:expr dataset=peers row=0 -->
| 公式 / Formula（Helios Industrial 行 / row） | 结果 / Result |
|---|---|
| `ev / ebitda_25e` | `≈ 9.145` |
| `` `EV/EBITDA 2025E` `` | `9.15` |
| `EV_EBITDA_25E` | `9.15` |
| `` `ev ebitda 25e` `` | `9.15` |
| `[Enterprise value] - [Net debt]` | `6715` |
| `` `HQ city` `` | `"Pittsburgh"` |
| `Company` | `"Helios Industrial"` |

## 5. 参数 / Parameters

`@名称` 读取报告参数（what-if 滑块，定义在 manifest 的 `params` 或 Python `r.param()`）。参数名为 ASCII 标识符
（字母、数字、下划线）。派生字段引用的参数改变时，依赖它的字段会自动重算，图表随之刷新。

`@name` reads a report parameter (what-if slider; manifest `params` or Python `r.param()`). Parameter names are ASCII
identifiers. Computed fields that use a parameter are recomputed when the slider moves.

<!-- verify:expr dataset=financials row=9 -->
| 公式 / Formula（2028E 行 / row） | 结果 / Result |
|---|---|
| `@wacc - @g` | `0.07` |
| `fcf * (1 + @g) / (@wacc - @g)` | `≈ 8853.6` |
| `ebitda * @multiple` | `11880` |

未定义的参数在计算时报错：`Unknown parameter @x`。An undefined parameter raises `Unknown parameter @x` when evaluated.

## 6. 运算符与优先级 / Operators & precedence

从高到低 / Highest to lowest:

| 级别 / Level | 运算符 / Operators | 结合性 / Associativity |
|---|---|---|
| 1 | `( )` 括号、函数调用 / parentheses, calls | — |
| 2 | `^` 乘方 / power | 右结合 / right: `2^3^2` = 2^9 |
| 3 | 一元 `-` `+` / unary minus, plus | `-2^2` = -(2^2) |
| 4 | `*` `/` | 左结合 / left |
| 5 | `+` `-`（`+` 遇到文本时为拼接 / concatenates text） | 左结合 / left |
| 6 | `==` `=` `!=` `<>` `<` `<=` `>` `>=` `in` `not in` | 不可连写 / not chainable (`1 < x < 3` is an error) |
| 7 | `not` `!` | — |
| 8 | `and` `&&` | 左结合 / left |
| 9 | `or` `\|\|` | 左结合 / left |
| 10 | `条件 ? 真值 : 假值` / `cond ? a : b` | 右结合 / right |

> **与 Excel 的差异 / Differences from Excel**：`-2^2` 在这里是 **-4**（Excel 为 4）；`2^3^2` 是 **512**（Excel 为 64）；
> 文本拼接用 `+` 或 `concat()`（不支持 `&`）；`%` 只能用于数字字面量。需要时请加括号。
> `-2^2` is **-4** here (Excel: 4); `2^3^2` is **512** (Excel: 64); concatenate with `+` or `concat()` (no `&`);
> `%` only applies to number literals. Add parentheses when in doubt.

> **比较 / Comparisons**：数字按数值比较；两个文本按字母顺序比较，**不区分大小写**（与 `==` 一致，`"a" >= "A"` 为 true）；
> 数字形式的文本（`"10"`）与数字按数值比较；**非数字文本与数字不可比较**：`<` `>` `<=` `>=` 一律为 false
> （`"n.a." < 6`、`"2021-03-18" < 2021` 都是 false），与 null 相同。
> Numbers compare numerically; two texts compare alphabetically and case-insensitively (consistent with `==`); numeric
> text compares with a number numerically; **non-numeric text is not comparable with a number**: `<` `>` `<=` `>=`
> are all false, as with null — so placeholders such as "n.a." never pass a numeric screen.

<!-- verify:expr -->
| 公式 / Formula | 结果 / Result |
|---|---|
| `1 + 2 * 3` | `7` |
| `(1 + 2) * 3` | `9` |
| `10 - 4 - 3` | `3` |
| `2 ^ 3 ^ 2` | `512` |
| `-2 ^ 2` | `-4` |
| `(-2) ^ 2` | `4` |
| `2 ^ -1` | `0.5` |
| `not 1 == 2` | `true` |
| `true or false and false` | `true` |
| `"EV" + "/" + "EBITDA"` | `"EV/EBITDA"` |
| `"Asia" == "ASIA"` | `true` |
| `"10" < 9` | `false` |
| `"n.a." < 6` | `false` |
| `"n.a." >= 6` | `false` |
| `"2021-03-18" < 2021` | `false` |
| `"a" >= "A"` | `true` |
| `3 in (1, 2, 3)` | `true` |
| `"x" not in ["a", "b"]` | `true` |
| `1 > 2 ? "up" : "down"` | `"down"` |

## 7. 空值与无意义值 / null, n.a. and n.m.

| 情形 / Case | 结果 / Result | 显示 / Shown |
|---|---|---|
| 字段缺失或为 `null` / missing or `null` | `null` | n.a. |
| `null` 参与算术 / `null` in arithmetic | `null`（传播 / propagates） | n.a. |
| 除以零 / division by zero | `NaN` | n.m. |
| `sqrt` / `ln` / `log` 定义域外 / out of domain | `NaN` | n.m. |
| `null` 参与比较 `<` `>` `<=` `>=` / in comparisons | `false`（两个方向都是 / both ways） | — |
| 非数字文本与数字比较 / non-numeric text vs a number | `false`（`"n.a." < 6`、`"n.a." >= 6`） | — |
| `x == null` | 为空（null、缺失、空文本）时为 true / true when null, missing or `""` | — |
| 聚合函数 / aggregates | 忽略 null 与 NaN / skip null and NaN | — |

<!-- verify:expr dataset=precedents row=2 -->
| 公式 / Formula（Caldera Sensing，私有标的 / private target） | 结果 / Result |
|---|---|
| `premium_1d` | `null` |
| `premium_1d * 100` | `null` |
| `premium_1d == null` | `true` |
| `premium_1d > 0.3` | `false` |
| `premium_1d <= 0.3` | `false` |
| `not (premium_1d > 0.3)` | `true` |
| `coalesce(premium_1d, 0)` | `0` |
| `ev / 0` | `NaN` |
| `div(ev, 0)` | `null` |
| `isnull(ev / 0)` | `true` |

> 注意：`not (x > 0.3)` 与 `x <= 0.3` 在 x 为空时结果不同。需要排除空值时写 `x != null and …`。
> `not (x > 0.3)` and `x <= 0.3` differ when x is null — add `x != null and …` to exclude missing values.

## 8. 函数 / Functions

函数名不区分大小写。列表与 `RK.expr.functions` 一致。Function names are case-insensitive; the lists match `RK.expr.functions`.

### 8.1 标量函数 / Scalar functions（逐行计算 / per row）

<!-- verify:expr dataset=peers row=0 -->
| 函数 / Function | 说明 / Description | 示例 / Example（Helios 行 / row） | 结果 / Result |
|---|---|---|---|
| `if(cond, a, b)` / `iif` | 条件；只计算被选中的分支；省略 b 时为 null / conditional, lazy | `if(net_debt < 0, "Net cash", "Net debt")` | `"Net debt"` |
| `coalesce(a, b, …)` | 第一个非空且非 NaN 的值 / first non-null, non-NaN | `coalesce(null, dividend_yield)` | `0.016` |
| `isnull(x)` | 为空或 NaN / null or NaN | `isnull(ev / 0)` | `true` |
| `abs(x)` | 绝对值 / absolute value | `abs(-5)` | `5` |
| `round(x, d)` | 与 Excel ROUND 相同：按 15 位有效数字的十进制值远离零舍入，d 可为负、小数部分截去 / Excel ROUND: half away from zero on the 15-significant-digit value; d may be negative | `round(1234.567, -2)` | `1200` |
| `round(x, d)`（续 / cont.） | `round(1.005, 2)` = 1.01、`round(-2.5)` = -3（与显示的四舍五入一致 / matches display rounding, §12） | `round(-2.5)` | `-3` |
| `floor(x)` / `ceil(x)` | 向下 / 向上取整 / round down / up | `ceil(9.15)` | `10` |
| `sign(x)` | 符号 -1 / 0 / 1 / sign | `sign(net_debt)` | `1` |
| `sqrt(x)` | 平方根（负数为 NaN）/ square root | `sqrt(16)` | `4` |
| `pow(x, y)` | 乘方，同 `x ^ y` / power | `pow(1.09, 5)` | `≈ 1.5386` |
| `exp(x)` / `ln(x)` | e 的幂 / 自然对数 / e^x, natural log | `ln(1)` | `0` |
| `log(x)` / `log(x, base)` / `log10(x)` | 对数（默认以 10 为底）/ logarithm, base 10 by default | `log(8, 2)` | `3` |
| `min(a, b, …)` / `max(a, b, …)` | 两个及以上参数时为标量 / scalar with 2+ arguments | `max(ev_ebitda_25e, pe_25e, 12)` | `15.1` |
| `clamp(x, lo, hi)` | 限制在区间内；lo 或 hi 为 null 时该侧不限 / clamp into [lo, hi]; a null bound is open | `clamp(ev_ebitda_25e, 10, 12)` | `10` |
| `between(x, lo, hi)` | lo ≤ x ≤ hi；null 边界不限 / a null bound is open | `between(ev_ebitda_25e, 8, null)` | `true` |
| `div(a, b)` | 除法，除数为 0 时返回 null（n.a. 而不是 n.m.）/ division, null when b = 0 | `div(ev, 0)` | `null` |
| `pct_change(a, b)` | a / b − 1 | `pct_change(revenue_26e, revenue_25e)` | `≈ 0.0701` |
| `cagr(end, start, years)` | 年复合增长率 / compound annual growth | `cagr(revenue_26e, revenue_24a, 2)` | `≈ 0.0721` |
| `number(x)` | 文本转数字（无法转换为 null）/ text to number | `number("12.5")` | `12.5` |
| `text(x, fmt)` | 按格式码转文本（§12）/ format as text | `text(ebitda_margin_25e, "0.0%")` | `"18.5%"` |
| `concat(a, b, …)` | 拼接，跳过空值 / join, skipping nulls | `concat(ticker, " (", country, ")")` | `"HLX (USA)"` |
| `len(s)` | 长度 / length | `len(company)` | `17` |
| `lower(s)` / `upper(s)` | 小写 / 大写 / lower / upper case | `upper("hlx")` | `"HLX"` |
| `contains(s, sub)` | 包含（不区分大小写）；sub 为 null 时为 false / contains, case-insensitive; false for a null sub | `contains(company, "industrial")` | `true` |
| `startswith(s, p)` / `endswith(s, p)` | 开头 / 结尾匹配（不区分大小写）；空文本 `""` 总是匹配 / an empty `""` always matches | `startswith(company, "HEL")` | `true` |
| `year(d)` / `month(d)` / `quarter(d)` | 日期部分（ISO 日期 `YYYY-MM-DD`，或 1000–9999 的整数年份）；无效日期为 null / date parts of ISO dates or a 4-digit year; invalid dates give null | `quarter("2026-10-14")` | `4` |

### 8.2 聚合函数 / Aggregate functions（每组一个值 / one value per group）

<!-- verify:expr dataset=peers -->
| 函数 / Function | 说明 / Description | 示例 / Example（全部 18 家 / all 18 peers） | 结果 / Result |
|---|---|---|---|
| `sum(x)` | 合计 / total | `sum(ev)` | `161496.1` |
| `avg(x)` / `mean` / `average` | 算术平均（忽略空值）/ mean, nulls skipped | `avg(ev_ebitda_25e)` | `≈ 11.499` |
| `median(x)` | 中位数 / median | `median(ev_ebitda_25e)` | `10.66` |
| `min(x)` / `max(x)` | 最小 / 最大；没有数字的列按文本比较（ISO 日期列给出最早 / 最晚日期）/ smallest / largest; a column without numbers compares as text (earliest / latest ISO date) | `max(ev_ebitda_25e)` | `18.1` |
| `count()` | 行数 / number of rows | `count()` | `18` |
| `count(x)` | 非空值个数 / non-null values | `count(dividend_yield)` | `18` |
| `countd(x)` | 不同值个数（区分大小写）/ distinct values | `countd(sector)` | `3` |
| `stdev(x)` / `stddev` | 样本标准差（STDEV.S）/ sample standard deviation | `stdev(ev_ebitda_25e)` | `≈ 3.2876` |
| `pctl(x, p)` / `percentile` | 分位数，线性插值（PERCENTILE.INC），p 为 0–1 的数字、百分数或 `@参数`（不能是字段），省略为中位数 / quantile; p is a number, percent or `@param` | `pctl(ev_ebitda_25e, 25%)` | `9.3325` |
| `wavg(x, w)` | 加权平均；值或权重为空 / NaN 的行被忽略 / weighted average; rows with a null or NaN value or weight are skipped | `wavg(ev_ebitda_25e, mkt_cap)` | `≈ 12.103` |
| `first(x)` / `last(x)` | 组内第一个 / 最后一个非空值 / first / last non-null | `first(company)` | `"Helios Industrial"` |

参数个数在编译时检查：`wavg(x)`、`sum()`、`sum(x, y)` 报错 `… expects N argument(s), got M`（`count` 接受 0–1 个，`pctl` 1–2 个，
`wavg` 2 个，其余 1 个）。Argument counts are checked when the formula is compiled.

<!-- verify:expr dataset=precedents -->
| 公式 / Formula（precedents，21 宗交易 / 21 deals） | 结果 / Result |
|---|---|
| `min(date)` | `"2019-03-18"` |
| `max(date)` | `"2026-08-24"` |
| `count(premium_1d)` | `15` |

聚合函数可以与运算符、标量函数组合 / Aggregates combine with operators and scalar functions:

<!-- verify:expr dataset=peers -->
| 公式 / Formula | 含义 / Meaning | 结果 / Result |
|---|---|---|
| `sum(ev) / sum(ebitda_25e)` | 合计倍数 / aggregate multiple | `≈ 10.718` |
| `sum(if(region == "Europe", ev, 0)) / sum(ev)` | 欧洲占比（条件聚合）/ Europe share | `≈ 0.3052` |
| `if(median(ev_ebitda_25e) > 10, "Premium", "Discount")` | 聚合放在 if() 里 / aggregate inside if() | `"Premium"` |
| `round(avg(ev_ebitda_25e), 1)` | 标量函数包裹聚合 / scalar around aggregate | `11.5` |
| `max(ev_ebitda_25e) - min(ev_ebitda_25e)` | 倍数区间 / multiple range | `≈ 11.63` |

## 9. 行公式与聚合公式 / Row vs aggregate formulas

- 含有聚合函数（`sum`、`median`、单参数 `min`/`max` …）的公式是**聚合公式**：在查询中每组得到一个值；没有 `by` 时整个数据集为一组。
  A formula that contains an aggregate is an **aggregate formula**: one value per group (the whole dataset without `by`).
- 聚合公式中的**裸字段**读取该组的**第一行**（适合读取分组键）。`company, count() by sector` 中 company 为每组第一家公司。
  A **bare field** inside an aggregate formula reads the **first row** of the group.
- 派生字段（computed）与 `where` 只能用**行公式**；聚合函数**不能嵌套**（`sum(sum(x))` 报错
  `Aggregates cannot be nested …`：先把内层结果做成单独的列或派生字段）。
  Computed fields and `where` take **row formulas** only; aggregates **cannot be nested** — compute the inner value in
  its own column or computed field first.
- 条件聚合用 `sum(if(条件, x, 0))`；占比用 `sum(if(...)) / sum(x)`；没有窗口函数（同一行内不能引用"全体平均"）。
  Conditional aggregates: `sum(if(cond, x, 0))`; shares: `sum(if(...)) / sum(x)`. There are no window functions.
- **合计倍数 ≠ 倍数平均**：`sum(ev) / sum(ebitda_25e)` 是按规模加权的合计倍数；`avg(ev_ebitda_25e)` 是简单平均；投行惯例通常展示中位数与平均数。
  **Aggregate multiple ≠ mean of multiples** — choose deliberately.

## 10. 查询语言 / Query language

```text
[select | show] <列 / items> [from <数据集 / dataset>] [by | group by <字段 / fields>] [where <条件 / condition>]
                [sort | sort by | order by <列 / column> [asc|desc], …] [top | limit <N>]

<item> := * | <公式 / formula> [as <标签 / label>] [format <格式码 / code>]
```

| 子句 / Clause | 说明 / Description |
|---|---|
| items | 逗号分隔；`*` 展开全部字段；省略时等于 `*`。`as "标签"`（含空格时必须加引号，也可用 `'…'`、`` `…` ``）；`format "0.0x"`（含 `"m"` 等字面量的格式码用单引号：`format '$#,##0.0,,"bn"'`）；`as` 与 `format` 顺序不限。Comma-separated; `*` = all fields. Quote labels with blanks; put format codes containing `"` in single quotes; `as` and `format` in either order. |
| `from` | 数据集 id；含空格时可加引号：`from "my data"`。省略时使用控制台当前数据集。Dataset id (quotes optional). |
| `by` / `group by` | 分组字段，逗号分隔；只接受字段（名称、标题、`` `…` `` 或 `[…]`），不接受表达式——需要时先建派生字段（§11.17）。Group-by fields only (name, title, `` `…` `` or `[…]`); for expressions add a computed field first. |
| `where` | 行条件，在分组前过滤；不能用聚合函数（没有 `having`）。Row filter applied before grouping; no aggregates. |
| `sort` / `sort by` / `order by` | 按**结果列**排序：列序号（`sort 2`）、标签（不区分大小写）或字段名；**默认降序**；空值和 n.m. 总在最后；可多列：`sort 3 desc, 1 asc`。分组查询中 `by` 字段排在最前，**序号从分组列开始数**（`… by sector sort 2` 按第一个选择列排序）。Sort by result column position, label or field name; **default desc**; nulls last. In grouped queries the `by` columns come first and **count in positions**. |
| `top` / `limit` | 排序后保留前 N 行；N 必须是正整数（`top 0`、`top -3`、`top ten` 报错）。Keep the first N rows after sorting; N must be a positive whole number. |

- 子句关键字须前后有空格，可任意顺序、任意大小写、可换行；引号（含 `\"` 转义）、反引号、方括号和括号内的关键字不会被识别为子句（`where name == "Sort by"` 安全）。
  Clause keywords need blanks around them, may come in any order / case / line; keywords inside quotes (escapes included), backticks, brackets or parentheses are ignored.
- 每个子句只能写一次（`sort` / `sort by` / `order by` 算同一子句）：多个条件用 `and` 合并，多个排序列用逗号分隔。
  Each clause may appear once (`sort`, `sort by` and `order by` count as one): combine conditions with `and`, list sort columns with commas.
- 结果列：单个字段沿用字段名、标题、格式和类型；其他列命名为 `c1, c2, …`，标题为 `as` 标签（否则为公式文本），格式为 `format`，
  否则按公式推断：保持原字段单位的公式沿用其格式——`sum(x)`、`median(x)`、`min(x)`、`round(avg(x), 1)`、`-x`、`x - y`（x、y 格式相同）、
  `if(c, x, 0)`、`sum(if(c, x, 0))`；`count()` / `countd()` 为 `#,##0`，`pct_change()` / `cagr()` 为 `0.0%`，`year()` / `month()` /
  `quarter()` 为 `0`；比率、乘积和其他函数为 General。列类型（`number` / `string` / `date` / `boolean`）按结果值推断。
  Output columns: a single field keeps its name, title, format and type; other columns are `c1, c2, …` titled by `as`
  (or the formula) and formatted by `format`, else by inference: formulas that keep a field's unit keep its format
  (`sum(x)`, `round(avg(x), 1)`, `-x`, `x - y` with equal formats, `sum(if(c, x, 0))`); `count()` is `#,##0`,
  `pct_change()` / `cagr()` `0.0%`, `year()` `0`; ratios, products and other functions get General. Column types are
  inferred from the values.
- 查询结果会先应用报告的全局筛选（filter bar、交叉筛选）。The report's global filters apply first.
- 有 `by` 或任一列为聚合公式时，结果为分组汇总；否则逐行输出。A query is grouped when it has `by` or any aggregate column.

## 11. 实例 / Worked examples

以下表格由 `node tests/js/formula-doc.test.js --write` 根据实际查询结果生成，并由同一脚本在测试中核对。
The tables below are generated from the live query results and checked by the same script.

### 11.1 分行业估值倍数 / Median multiples by sector（peers）

```rkq
median(ev_ebitda_25e) as "Median EV/EBITDA 25E", median(ev_ebitda_26e) as "Median EV/EBITDA 26E", count() as "Peers" by sector from peers sort 2 desc
```

| Sector | Median EV/EBITDA 25E | Median EV/EBITDA 26E | Peers |
|---|---:|---:|---:|
| Industrial Software & Sensors | 15.5x | 13.1x | 6 |
| Industrial Automation | 10.7x | 9.5x | 6 |
| Motion & Power Control | 9.4x | 8.8x | 6 |

### 11.2 目标公司与高估值同业 / Target vs richly valued peers（peers）

```rkq
company, ev_ebitda_25e, pe_25e, ebitda_margin_25e from peers where is_target or ev_ebitda_25e > 15 sort ev_ebitda_25e desc
```

| Company | EV/EBITDA 2025E | P/E 2025E | EBITDA margin 2025E |
|---|---:|---:|---:|
| Quintar Sensing | 18.1x | 27.0x | 28.6% |
| Orbisant Software | 16.3x | 25.6x | 31.3% |
| Tasman Crest Instruments | 16.1x | 27.0x | 24.2% |
| Helios Industrial | 9.2x | 15.1x | 18.5% |

### 11.3 市值前五与自定义倍数 / Top 5 by market cap with a custom multiple（peers）

```rkq
company, mkt_cap, ev / ebitda_26e as "EV/EBITDA 26E" format "0.0x" from peers sort mkt_cap desc top 5
```

| Company | Market cap | EV/EBITDA 26E |
|---|---:|---:|
| Orbisant Software | $12,961 | 14.1x |
| Kanemori Systems | $11,447 | 9.4x |
| Tessaro Robotics | $11,252 | 10.2x |
| Halvern Instruments | $10,816 | 12.6x |
| Quintar Sensing | $10,761 | 15.7x |

### 11.4 条件筛选：`in` 与百分数 / Screen with `in` and percent literals（peers）

```rkq
company, region, ebitda_margin_25e, ev_ebitda_25e from peers where region in ["Europe", "Asia Pacific"] and ebitda_margin_25e >= 20% sort 3 desc
```

| Company | Region | EBITDA margin 2025E | EV/EBITDA 2025E |
|---|---|---:|---:|
| Orbisant Software | Europe | 31.3% | 16.3x |
| Meridale Metrology | Europe | 28.7% | 13.9x |
| Tasman Crest Instruments | Asia Pacific | 24.2% | 16.1x |
| Kanemori Systems | Asia Pacific | 23.7% | 10.7x |

### 11.5 合计倍数 vs 平均 vs 中位数 / Aggregate vs mean vs median（peers，不含目标 / excluding the target）

```rkq
sum(ev) / sum(ebitda_25e) as "Aggregate" format "0.0x", avg(ev_ebitda_25e) as "Mean", median(ev_ebitda_25e) as "Median", count() as "N" from peers where not is_target
```

| Aggregate | Mean | Median | N |
|---:|---:|---:|---:|
| 10.8x | 11.6x | 10.7x | 17 |

### 11.6 市值加权倍数（按地区）/ Market-cap-weighted multiple by region（peers）

```rkq
wavg(ev_ebitda_25e, mkt_cap) as "Mkt-cap weighted", median(ev_ebitda_25e) as "Median", sum(mkt_cap) as "Total mkt cap" by region from peers sort 2 desc
```

| Region | Mkt-cap weighted | Median | Total mkt cap |
|---|---:|---:|---:|
| North America | 13.5x | 11.1x | $42,052 |
| Europe | 12.6x | 10.8x | $44,230 |
| Asia Pacific | 11.3x | 10.1x | $28,628 |
| Latin America | 10.0x | 8.5x | $26,055 |

### 11.7 先例交易四分位 / Precedent quartiles by sector（precedents）

```rkq
pctl(ev_ebitda, 25%) as "25th pct", median(ev_ebitda) as "Median", pctl(ev_ebitda, 75%) as "75th pct", count() as "Deals" by sector from precedents
```

| Sector | 25th pct | Median | 75th pct | Deals |
|---|---:|---:|---:|---:|
| Industrial Automation | 9.6x | 10.3x | 11.7x | 8 |
| Motion & Power Control | 9.0x | 9.4x | 10.1x | 7 |
| Industrial Software & Sensors | 13.3x | 14.2x | 14.8x | 6 |

### 11.8 近期交易与溢价（空值处理）/ Recent deals with premiums — handling nulls（precedents）

```rkq
date, target, acquirer, ev, premium_1d from precedents where date >= "2023-01-01" and premium_1d != null sort premium_1d desc top 5
```

| Announced | Target | Acquirer | Enterprise value | Premium to 1-day price |
|---|---|---|---:|---:|
| 23 Sep 2024 | Pellston Automation | Granite Arch Partners | $728 | 41.1% |
| 11 May 2026 | Upland Drives | Norrvik Drives | $820 | 39.8% |
| 24 Aug 2026 | Tarrant Automation | Kanemori Systems | $8,335 | 39.3% |
| 16 Jan 2023 | Larchmont Precision | Ashgrove Equity | $376 | 39.0% |
| 12 Jun 2023 | Morrow Electromech | Sohwa Motion | $5,935 | 30.5% |

### 11.9 溢价覆盖率（按对价方式）/ Premium coverage by consideration（precedents）

```rkq
count() as "Deals", count(premium_1d) as "Public targets", avg(premium_1d) as "Avg 1-day premium", max(ev) as "Largest EV" by consideration from precedents sort Deals desc
```

| Consideration | Deals | Public targets | Avg 1-day premium | Largest EV |
|---|---:|---:|---:|---:|
| Cash | 16 | 12 | 32.1% | $9,067 |
| Mixed | 4 | 3 | 33.8% | $7,626 |
| Stock | 1 | 0 | n.a. | $1,272 |

### 11.10 利润率与现金转化 / Margins and cash conversion（financials，实际年份 / actuals）

```rkq
year, revenue, ebitda / revenue as "EBITDA margin" format "0.0%", fcf / ebitda as "Cash conversion" format "0%", capex / revenue as "Capex / sales" format "0.0%" from financials where period == "A"
```

| Year | Revenue | EBITDA margin | Cash conversion | Capex / sales |
|---|---:|---:|---:|---:|
| 2019A | $3,385.0 | 15.8% | 49% | 4.7% |
| 2020A | $3,230.0 | 14.6% | 61% | 3.9% |
| 2021A | $3,612.0 | 16.1% | 45% | 4.5% |
| 2022A | $3,978.0 | 16.9% | 44% | 5.0% |
| 2023A | $4,262.0 | 17.4% | 47% | 5.0% |
| 2024A | $4,515.0 | 17.9% | 49% | 5.0% |
| 2025A | $4,850.0 | 18.5% | 49% | 5.0% |

### 11.11 历史与预测期 CAGR / CAGR of actuals vs plan（financials）

```rkq
first(year) as "From", last(year) as "To", cagr(last(revenue), first(revenue), count() - 1) as "Revenue CAGR" format "0.0%", cagr(last(ebitda), first(ebitda), count() - 1) as "EBITDA CAGR" format "0.0%" by period from financials
```

| Actual / estimate | From | To | Revenue CAGR | EBITDA CAGR |
|---|---|---|---:|---:|
| A | 2019A | 2025A | 6.2% | 9.0% |
| E | 2026E | 2028E | 7.0% | 9.2% |

### 11.12 参数驱动的终值 / Parameter-driven terminal value（financials，@wacc = 9%，@g = 2%）

```rkq
year, fcf, fcf * (1 + @g) / (@wacc - @g) as "Terminal value (Gordon)" format "$#,##0", fcf * (1 + @g) / (@wacc - @g) / ebitda as "Implied TV / EBITDA" format "0.0x" from financials where year == "2028E"
```

| Year | Unlevered free cash flow | Terminal value (Gordon) | Implied TV / EBITDA |
|---|---:|---:|---:|
| 2028E | $607.6 | $8,854 | 7.5x |

### 11.13 隐含股权价值（目标公司）/ Implied equity value at @multiple（peers，@multiple = 10.0x）

```rkq
company, ebitda_26e, net_debt, ebitda_26e * @multiple - net_debt as "Implied equity value" format "$#,##0", (ebitda_26e * @multiple - net_debt) / mkt_cap - 1 as "vs. market cap" format "+0.0%;-0.0%;0.0%" from peers where is_target
```

| Company | EBITDA 2026E | Net debt | Implied equity value | vs. market cap |
|---|---:|---:|---:|---:|
| Helios Industrial | $997 | $1,490 | $8,475 | +26.2% |

### 11.14 业务板块收入与地区占比 / Segment revenue and APAC share（segment_revenue，2025A）

```rkq
sum(revenue) as "Revenue 2025A", sum(if(region == "Asia Pacific", revenue, 0)) / sum(revenue) as "APAC share" format "0.0%", sum(if(region == "North America", revenue, 0)) / sum(revenue) as "N. America share" format "0.0%" by segment from segment_revenue where year == "2025A" sort 2 desc
```

| Segment | Revenue 2025A | APAC share | N. America share |
|---|---:|---:|---:|
| Factory Automation | $1,820.7 | 22.1% | 39.9% |
| Motion Control | $1,290.1 | 22.2% | 34.5% |
| Sensors & Instrumentation | $1,009.7 | 30.6% | 36.5% |
| Software & Services | $729.5 | 16.3% | 52.4% |

### 11.15 板块增长（条件聚合）/ Segment growth with conditional aggregates（segment_revenue）

```rkq
sum(if(year == "2024A", revenue, 0)) as "2024A" format "$#,##0.0", sum(if(year == "2025A", revenue, 0)) as "2025A" format "$#,##0.0", sum(if(year == "2025A", revenue, 0)) / sum(if(year == "2024A", revenue, 0)) - 1 as "Growth" format "+0.0%;-0.0%;0.0%" by segment from segment_revenue sort Growth desc
```

| Segment | 2024A | 2025A | Growth |
|---|---:|---:|---:|
| Software & Services | $644.7 | $729.5 | +13.2% |
| Sensors & Instrumentation | $922.8 | $1,009.7 | +9.4% |
| Motion Control | $1,219.0 | $1,290.1 | +5.8% |
| Factory Automation | $1,728.5 | $1,820.7 | +5.3% |

### 11.16 文本输出与杠杆标签 / Text output and leverage labels（peers）

```rkq
company, if(net_debt < 0, "Net cash", if(net_debt_ebitda > 2, "Levered", "Moderate")) as "Balance sheet", text(net_debt_ebitda, "0.0x") as "ND / EBITDA" from peers where net_debt_ebitda < 1 or net_debt_ebitda > 2 sort 1 asc
```

| Company | Balance sheet | ND / EBITDA |
|---|---|---|
| Andalina Digital | Moderate | 0.7x |
| Castellari Motion | Levered | 2.1x |
| Halvern Instruments | Net cash | -0.2x |
| Ironvale Power Systems | Levered | 2.5x |
| Meridale Metrology | Net cash | -0.1x |
| Qingtai Electromech | Moderate | 0.6x |
| Quintar Sensing | Net cash | -0.1x |
| Sierra Alta Industrial | Levered | 2.6x |
| Sohwa Motion | Levered | 2.5x |
| Tasman Crest Instruments | Net cash | -0.1x |

*… 2 more rows / 另有 2 行*

### 11.17 用派生字段按年份分组 / Group by year via a computed field（precedents）

`by` 只接受字段，所以先建派生字段（报告里写在 dataset 的 `computed` 中；以下为等价的 JavaScript）：
`by` takes fields only, so add a computed field first (in a report: the dataset's `computed` list; equivalent JavaScript below):

```js rk-setup
RK.data.get('precedents').addComputed({ name: 'deal_year', title: 'Deal year', formula: 'year(date)', format: '0' });
```

```rkq
count() as "Deals", sum(ev) as "Total EV", median(ev_ebitda) as "Median EV/EBITDA" by deal_year from precedents where deal_year >= 2022 sort deal_year asc
```

| Deal year | Deals | Total EV | Median EV/EBITDA |
|---:|---:|---:|---:|
| 2022 | 2 | $1,846 | 11.0x |
| 2023 | 3 | $13,937 | 10.3x |
| 2024 | 2 | $9,795 | 10.5x |
| 2025 | 3 | $4,814 | 14.4x |
| 2026 | 3 | $12,102 | 9.3x |

## 12. 格式码速查 / Format codes

`format "…"`、`text(x, "…")`、字段的 `format` 都使用 Excel 风格格式码（`kit/core/rk.format.js`）。
`format "…"`, `text(x, "…")` and field formats all use Excel-style codes.

| 元素 / Element | 含义 / Meaning |
|---|---|
| `0` `#` | 必显 / 可选数位 / required / optional digit |
| `,`（数位中）/ inside digits | 千分位 / thousands separator |
| `,`（数位后）/ after digits | 每个除以 1,000 / scale by 1,000 each: `0.0,,` = millions |
| `%` | ×100 并显示 % / ×100 and show % |
| `"文本"` `\x` | 字面量 / literal text |
| `_)` | 留出 `)` 的宽度（对齐括号负数）/ space the width of `)` |
| `正;负;零` | 分段 / sections: positive;negative;zero；第三段为空（`#,##0;(#,##0);`）时零显示为空白 / an empty third section blanks zeros |
| `[Red]`、`[$-409]` 等 | 忽略 / ignored |
| `[$€-407]`、`[$USD]` | 显示其中的货币符号 / show the currency text |
| `yyyy yy mmmm mmm mm m dddd ddd dd d q` | 日期 / date parts（ISO `YYYY-MM-DD`，或 1000–9999 的整数年份）；`ddd` = Wed，`dddd` = Wednesday |
| 预设 / presets | `mult` `0.0x` · `pct1` `0.0%` · `usd_m` `$#,##0"m"` · `delta_pct` `+0.0%;-0.0%;0.0%` · `acct1` `#,##0.0_);(#,##0.0)` · `date` `dd mmm yyyy` · `auto` 紧凑 / compact … |

- **四舍五入与 Excel 一致**：按数值的 15 位有效数字十进制表示、远离零舍入（10.35 → `10.4x`，2.675 → `$2.68`，0.0705 → `7.1%`）；
  `%` 与千分位缩放只移动小数点，不引入二进制误差。`round()`（§8）使用同一规则，所以计算结果与显示一致。
  **Rounding matches Excel**: half away from zero on the value's 15-significant-digit decimal digits; `%` and
  thousands scaling move the decimal point exactly. `round()` (§8) uses the same rule, so values and display agree.
- **四舍五入后为零的值显示为零**：不会出现 `-0.0`、`(0.0)`、`+0.0%`——有零段时用零段，零段为空时为空白，否则用不带符号的正数段。
  这一点有意与 Excel 不同。A value that rounds to zero shows as zero (zero section, blank with an empty zero section,
  else the unsigned positive section) — never "-0.0", "(0.0)" or "+0.0%". This deliberately differs from Excel.
- **General**（没有格式时）：≥ 10,000 取整并加千分位；否则最多 2 位小数；小于 0.01 的值保留 3 位有效数字（低于 1e-8 用指数形式）。
  拼错的预设名（`usd_mn`）按 General 显示。General (no format): grouped integers from 10,000, else up to 2 decimals,
  3 significant digits below 0.01; a mistyped preset name renders as General.
- **日期**：无效日期（`2026-13-45`、`2026-02-30`）原样显示，不会顺延到下个月。Invalid dates are shown unchanged, never rolled over.
- **中文报告的紧凑单位**：`locale="zh-CN"` 的报告里 `auto` 使用 万 / 亿（`1.5e9` → `15亿`，`25000` → `2.5万`），下表按英文环境验证。
  In zh-CN reports `auto` uses 万 / 亿 (`1.5e9` → `15亿`); the table below is verified in English.

<!-- verify:format -->
| 值 / Value | 格式码 / Code | 显示 / Output |
|---|---|---|
| `8.534` | `0.0x` | `8.5x` |
| `-1234.5` | `#,##0.0;(#,##0.0)` | `(1,234.5)` |
| `0.1234` | `0.0%` | `12.3%` |
| `1234567` | `$#,##0.0,,"m"` | `$1.2m` |
| `1234567` | `#,##0,` | `1,235` |
| `0.052` | `+0.0%;-0.0%;0.0%` | `+5.2%` |
| `-0.052` | `+0.0%;-0.0%;0.0%` | `-5.2%` |
| `0` | `0.0x;(0.0x);"–"` | `–` |
| `125` | `#,##0" bps"` | `125 bps` |
| `12.34` | `0.0\x` | `12.3x` |
| `7` | `000` | `007` |
| `2.5` | `0.0#` | `2.5` |
| `1.5e9` | `auto` | `1.5bn` |
| `4520` | `usd_m` | `$4,520m` |
| `"2026-10-14"` | `dd mmm yyyy` | `14 Oct 2026` |
| `"2026-10-14"` | `mmm-yy` | `Oct-26` |
| `"2026-10-14"` | `"Q"q yyyy` | `Q4 2026` |
| `"2026-10-14"` | `yyyy"年"m"月"d"日"` | `2026年10月14日` |
| `null` | `0.0x` | `n.a.` |
| `NaN` | `0.0x` | `n.m.` |
| `10.35` | `0.0x` | `10.4x` |
| `2.675` | `$#,##0.00` | `$2.68` |
| `0.0705` | `0.0%` | `7.1%` |
| `16450000` | `$#,##0.0,,"m"` | `$16.5m` |
| `-0.0004` | `+0.0%;-0.0%;0.0%` | `0.0%` |
| `-123456` | `General` | `-123,456` |
| `0.000123` | `General` | `0.000123` |
| `999950` | `auto` | `1m` |
| `1234` | `[$€-407]#,##0` | `€1,234` |
| `4520` | `usd_mn` | `4520` |
| `2026` | `yyyy` | `2026` |
| `"2026-10-14"` | `ddd d mmm` | `Wed 14 Oct` |
| `"2026-13-45"` | `dd mmm yyyy` | `2026-13-45` |

## 13. 错误信息 / Error messages

所有语法与引用错误都以 `ExprError` 抛出（`RK.expr.check()` 返回 `{ok: false, error, pos}`，不会抛出），`pos` 为出错字符位置。
Syntax and reference errors are thrown as `ExprError` (`RK.expr.check()` returns `{ok: false, error, pos}` instead); `pos` is the character offset.

<!-- verify:error dataset=peers -->
| 输入 / Input | 信息 / Message | 原因与修正 / Cause & fix |
|---|---|---|
| `revnue_25e * 2` | `Unknown field "revnue_25e" — did you mean…` | 拼写错误；按提示改正 / typo, follow the suggestion |
| `HQ city` | `Unexpected "city"` | 含空格的名称要加反引号 / quote names with blanks: `` `HQ city` `` |
| `foo(ev)` | `Unknown function foo()` | 见 §8 函数表 / see §8 |
| `ev % 2` | `Unexpected character "%"` | 没有取模；`%` 只用于数字 / no modulo; `%` only after numbers |
| `region == "Asia` | `Unterminated string` | 补全引号 / close the quote |
| `ev / (ebitda_25e` | `Expected ")"` | 补全括号 / close the parenthesis |
| `ev /` | `Unexpected end of formula` | 公式不完整 / incomplete formula |
| `and ev > 1` | `Unexpected keyword "and"` | 关键字位置不对 / misplaced keyword |
| `1 < ev < 3` | `Unexpected "<"` | 比较不能连写：`ev > 1 and ev < 3` / comparisons do not chain |
| `ev * @nope` | `Unknown parameter @nope` | 参数未定义 / undefined parameter |
| `@ + 1` | `Expected parameter name after @` | — |
| `if(is_target)` | `if(condition, then, else) needs at least 2 arguments` | — |
| `sum(ev) as Total EV from peers` | `Unexpected "as"` | 含空格的标签加引号 / quote the label: `as "Total EV"` |
| `company from peers where ev > avg(ev)` | `"where" cannot use aggregates` | `where` 只接受行条件 / row conditions only |
| `wavg(ev)` | `wavg() expects 2 arguments, got 1` | 加上权重：`wavg(x, w)` / add the weight |
| `sum()` | `sum() expects 1 argument, got 0` | — |
| `sum(sum(ev))` | `Aggregates cannot be nested: sum() contains another aggregate…` | 内层结果先做成单独的列或派生字段 / compute the inner value first |
| `pctl(ev, mkt_cap)` | `pctl() percentile must be a number or @param…` | 分位数用数字、百分数或参数：`pctl(ev, 75%)` / use a number |
| `company from peers top -3` | `"top" expects a whole number of rows, e.g. top 10 (got "-3")` | — |
| `company from peers where ev > 1000 where region == "Europe"` | `"where" appears more than once…` | 用 `and` 合并条件 / combine with `and` |
| `count() by year(date) from precedents` | `"by" expects field names, got "year(date)"` | 先建派生字段（§11.17）/ add a computed field |
| `company from peers sort mkt_cap` | `Cannot sort by "mkt_cap" — use a column label or position` | 只能按结果列排序；把 mkt_cap 加入选择列 / select the column first |
| `count() from comps` | `Unknown dataset "comps" (available: peers…` | 数据集 id 错误 / wrong dataset id |
| `RK.query("count()")` | `Choose a dataset (from <name>) — available: peers…` | 加 `from` / add `from <dataset>` |

另外 / Also：公式嵌套过深（超过 256 层括号、函数或一元运算）或过长（超过约 1,000 项的连加）时报错
`Formula is too deeply nested or too long — split it into several computed fields`（不会卡死或抛出 RangeError）；
派生字段引用自身或循环引用时的错误见 §2。Formulas nested more than 256 levels deep or chained longer than about
1,000 terms raise that ExprError (never a hang or RangeError); for computed-field self-reference and loops see §2.

## 14. 技巧与易错点 / Tips & gotchas

1. **文本比较不区分大小写**：`region == "europe"` 匹配 "Europe"；`countd()` 与分组则**区分**大小写。
   String equality is case-insensitive, but `countd()` and `by` groups are case-sensitive.
2. **日期是 ISO 文本**：用 `date >= "2023-01-01"` 比较；按年用 `year(date) >= 2023`。日期与数字比较（`date < 2021`）总是 false。
   Dates are ISO text: compare with `"YYYY-MM-DD"` strings, or use `year(date)`; a date compared with a number is always false.
3. **百分数字面量**：`ebitda_margin_25e > 20%` 等同于 `> 0.2`；格式 `0.0%` 只影响显示。
   `20%` is 0.2; `0.0%` formats display only.
4. **排序默认降序**，文本也一样；需要升序写 `asc`。只能按已选择的列排序。
   `sort` defaults to **desc** (text too) and works on selected columns only.
5. **空值**：任何与 null 的比较都为 false；`count(x)` 只数非空值，`count()` 数行数。
   Comparisons with null are false; `count(x)` counts non-null values, `count()` rows.
6. **标签与格式码的引号**：`as "EV / EBITDA"`；`format '$#,##0.0,,"bn"'`（外层单引号）。不加引号的格式码里的逗号会被当作列分隔符。
   Quote labels with blanks; wrap format codes containing `"` in single quotes — an unquoted `,` splits the column list.
7. **不支持 `count(*)`**，请写 `count()`。Use `count()`, not `count(*)`.
8. **`and` 优先于 `or`**：`a or b and c` = `a or (b and c)`；混用时加括号。`and` binds tighter than `or` — add parentheses.
9. **Excel 习惯**：`-2^2` = -4，`2^3^2` = 512；拼接用 `+`；`=` 与 `==` 等价，`<>` 与 `!=` 等价。
   Excel habits: see §6.
10. **全角符号**：中文输入法下的 `（ ） ， ％ ＞` 不是运算符。Full-width punctuation is not an operator.
11. **分组后非聚合列取第一行**：`company, count() by sector` 中的 company 只是每组第一行，不代表全组。
    A non-aggregate column in a grouped query shows the group's first row.
12. **数据集名含空格**：`from "my data"`。Dataset ids with blanks: quote them.
13. **分组查询的列序号**：`by` 字段排在结果最前面，`sort 1` 指的是分组列；按指标排序请用标签：`sort Median desc`。
    In grouped queries the `by` columns come first, so `sort 1` is the group column — sort by label to be explicit.
14. **比率需要格式**：`sum(if(c, x, 0))` 沿用 x 的格式，但比率（`sum(if(...)) / sum(x)`）与乘积显示为 General，请加 `format "0.0%"`。
    `sum(if(c, x, 0))` keeps x's format, but ratios and products show as General — add a `format`.
15. **派生字段不能引用自身**：`x = x * 1.1` 报错；结果请用新名称（`x_adj = x * 1.1`）。A computed field cannot read itself — use a new name.

## 15. 已知问题 / Known issues

目前没有已知问题。引擎审计（`research/engine-audit.md`，2026-10-14）发现的 36 个问题已全部修复，逐项结论见该文件末尾的
"Resolution" 一节；修复带来的行为变化已写入本文（§2、§6–§10、§12–§14）。与 Excel 的有意差异见 §6、§7 与 §12。
There are no known open issues. All 36 findings of the engine audit (`research/engine-audit.md`) are fixed — see its
"Resolution" section; the resulting behaviour is documented above (§2, §6–§10, §12–§14). Deliberate differences from
Excel are listed in §6, §7 and §12.

---

## 附录 A / Appendix A：验证 / Verification

本文中的全部示例由 `tests/js/formula-doc.test.js` 执行并逐一核对：`rkq` 代码块逐条运行 `RK.query` 并与其后的结果表比较；
`verify:expr` / `verify:format` / `verify:error` 表格逐行计算公式、格式码与错误信息。
Every example in this document is executed by `tests/js/formula-doc.test.js`: each `rkq` block runs through `RK.query`
and must reproduce the table below it; each row of the `verify:expr` / `verify:format` / `verify:error` tables is
evaluated and compared.

```bash
node tests/js/formula-doc.test.js            # 核对 / verify
node tests/js/formula-doc.test.js --write    # 文档修改后重新生成结果表 / regenerate the result tables
RK_CORE_DIR=/path/to/other/kit/core node tests/js/formula-doc.test.js     # 对另一份引擎核对 / verify another copy of kit/core
```

验证输出 / Verification output（2026-10-14，`kit/core` 已合入 `research/engine-audit.md` 的全部修复 / with all fixes of
`research/engine-audit.md` merged）。覆盖范围 / coverage：§11 的 17 个查询实例，§3–§9 的 91 个公式，§12 的 33 个格式码，
§13 的 24 条错误信息；并检查引擎的 50 个函数名（含别名）都在 §8 中有说明 / the 17 worked queries of §11, 91 formulas in
§3–§9, 33 format codes (§12) and 24 error messages (§13); it also checks that all 50 engine function names (incl.
aliases) are documented in §8:

```text
$ node tests/js/formula-doc.test.js --verbose
  query 11.1   3 rows x 4 cols  median(ev_ebitda_25e) as "Median EV/EBITDA 25E", median(ev_ebitda_2...
  query 11.2   4 rows x 4 cols  company, ev_ebitda_25e, pe_25e, ebitda_margin_25e from peers where ...
  query 11.3   5 rows x 3 cols  company, mkt_cap, ev / ebitda_26e as "EV/EBITDA 26E" format "0.0x" ...
  query 11.4   4 rows x 4 cols  company, region, ebitda_margin_25e, ev_ebitda_25e from peers where ...
  query 11.5   1 rows x 4 cols  sum(ev) / sum(ebitda_25e) as "Aggregate" format "0.0x", avg(ev_ebit...
  query 11.6   4 rows x 4 cols  wavg(ev_ebitda_25e, mkt_cap) as "Mkt-cap weighted", median(ev_ebitd...
  query 11.7   3 rows x 5 cols  pctl(ev_ebitda, 25%) as "25th pct", median(ev_ebitda) as "Median", ...
  query 11.8   5 rows x 5 cols  date, target, acquirer, ev, premium_1d from precedents where date >...
  query 11.9   3 rows x 5 cols  count() as "Deals", count(premium_1d) as "Public targets", avg(prem...
  query 11.10  7 rows x 5 cols  year, revenue, ebitda / revenue as "EBITDA margin" format "0.0%", f...
  query 11.11  2 rows x 5 cols  first(year) as "From", last(year) as "To", cagr(last(revenue), firs...
  query 11.12  1 rows x 4 cols  year, fcf, fcf * (1 + @g) / (@wacc - @g) as "Terminal value (Gordon...
  query 11.13  1 rows x 5 cols  company, ebitda_26e, net_debt, ebitda_26e * @multiple - net_debt as...
  query 11.14  4 rows x 4 cols  sum(revenue) as "Revenue 2025A", sum(if(region == "Asia Pacific", r...
  query 11.15  4 rows x 4 cols  sum(if(year == "2024A", revenue, 0)) as "2024A" format "$#,##0.0", ...
  query 11.16 12 rows x 3 cols  company, if(net_debt < 0, "Net cash", if(net_debt_ebitda > 2, "Leve...
  query 11.17  5 rows x 4 cols  count() as "Deals", sum(ev) as "Total EV", median(ev_ebitda) as "Me...
formula-doc: 17 queries, 91 formulas, 33 format codes, 24 error messages, 1 setup blocks — 165/165 verified; 50 engine functions documented
core: kit/core, node v22.22.0
```
