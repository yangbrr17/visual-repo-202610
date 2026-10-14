#!/usr/bin/env python3
"""构建中文示例报告「远航项目」（Simplified Chinese demo pitchbook）。

    python3 py/examples/build_demo_zh.py                  # -> examples/demo-zh-cn/
    python3 py/examples/build_demo_zh.py out/voyager      # 自定义输出目录
    python3 py/examples/build_demo_zh.py out/x --single-file --excel

故事（全部为虚构的示例数据）：A+H 上市的工业自动化公司「华辰智能」（总部江苏苏州）拟以企业价值 12.0 亿欧元
（按 7.80 折合约 93.6 亿元人民币）收购德国精密驱动企业「凯斯勒驱动技术」100% 股权，北桥资本担任买方财务顾问。
报告为中国客户而做：Report(locale="zh-CN", updown="cn")——界面文字为简体中文，紧凑数字使用万 / 亿，红涨绿跌；
版式遵循国内投行材料惯例（「单位：人民币亿元」副标题、资料来源 / 注、机密字样；多条来源以「；」连接）。

交互：顶栏按「上市地 / 细分领域」筛选可比公司；可比公司页标题、估值页副标题、假设分析页标题与国内布局页右图副标题
是 {{…}} 实时模板；省级方块图与可比公司散点图带指标切换（choices）；敏感性表点击单元格切换 DCF 基准（@wacc / @tgr）；
三个滑块（协同效应实现率、并购贷款利率、欧元汇率）实时重算每股收益增厚；免责声明页 filters=False。

检查：node tests/e2e/demo.cjs --dir examples/demo-zh-cn [--pdf]（--pdf 写出 examples/demo-zh-cn.pdf）。

所有标题中的数字都由下面的数据计算得出（或由运行时的 {{…}} 标题模板实时计算），因此「结论」与图表一致。
中国省级数据使用 china-tilemap（等大方块示意图，不绘制边界），不使用中国多边形地图：瓦片示意图不含行政区划边界，
通常不涉及审图号，但对外发布前请法务确认。

页面预算：屏幕上一页为 16:9（1440 px 宽窗口、含左侧目录时约 1135 × 638 px），打印为 1280 × 720 px。
一行图表约有 400 px 绘图高度。中文标题字号 27 px，一行约容纳 36 个汉字。
"""
from __future__ import annotations

import datetime as dt
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "py"))

from reportkit import Report  # noqa: E402

# ---------------------------------------------------------------------------------------------- 常量
FIRM = "北桥资本"
ACQ = "华辰智能"                 # 收购方（A+H 上市）
TGT = "凯斯勒"                   # 标的：Kessler Antriebstechnik GmbH（德国斯图加特）
FX = 7.80                        # 欧元兑人民币（示例）
EV_EUR = 12.0                    # 企业价值，亿欧元
EV = round(EV_EUR * FX, 1)       # 93.6 亿元
DEBT, CASH, PENSION = 12.9, 3.6, 2.4
EQUITY = round(EV - DEBT + CASH - PENSION, 1)   # 81.9 亿元
TAX_CN = 0.25

SRC_MKT = "示例市场数据，截至2026年10月9日"
SRC_TGT = "凯斯勒管理层预测（示例）"
SRC_NB = f"{FIRM}分析"
DEMO = "示例数据：文中公司、机构与数据均为虚构，仅用于演示。"


def cjk_len(text: str) -> float:
    """标题宽度（以汉字为 1）：拉丁字母、数字约占半个汉字宽。"""
    return sum(1.0 if ord(c) > 0x2E80 else 0.55 for c in text)


def plot_h(title: str, *, block_sub: bool = False, block_head: bool = True, page_sub: bool = True,
           notes: bool = True) -> int:
    """单行图表在 1440 px 宽屏幕上保持 16:9 的绘图高度（px）。一行标题约 36 个汉字，超出则换行（-34 px）；
    页脚除来源外还有「注：」一行时再减 14 px。"""
    h = 404 if cjk_len(title) <= 35 else 370
    h += 0 if page_sub else 26
    h -= 26 if block_sub else 0
    h += 0 if block_head else 36
    h -= 14 if notes else 0
    return h


def r1(v: float) -> float:
    return round(v + 0.0, 1)


# ---------------------------------------------------------------------------------------------- 数据
def provinces() -> list[dict]:
    """华辰智能 2025A 国内（含港澳台）收入按省级行政区，人民币亿元。"""
    rows = [  # 省份, adcode, 区域, 收入, 同比增速, 服务网点
        ("上海市", "310000", "华东", 12.6, 0.112, 9), ("江苏省", "320000", "华东", 31.8, 0.094, 22),
        ("浙江省", "330000", "华东", 18.4, 0.128, 15), ("安徽省", "340000", "华东", 7.2, 0.176, 8),
        ("福建省", "350000", "华东", 5.1, 0.103, 6), ("江西省", "360000", "华东", 3.0, 0.142, 4),
        ("山东省", "370000", "华东", 11.2, 0.087, 11),
        ("广东省", "440000", "华南", 21.5, 0.135, 16), ("广西壮族自治区", "450000", "华南", 1.6, 0.118, 2),
        ("海南省", "460000", "华南", 0.4, 0.064, 1),
        ("北京市", "110000", "华北", 4.2, 0.052, 5), ("天津市", "120000", "华北", 3.1, 0.071, 4),
        ("河北省", "130000", "华北", 3.6, 0.083, 4), ("山西省", "140000", "华北", 1.2, 0.046, 2),
        ("内蒙古自治区", "150000", "华北", 0.9, 0.039, 1),
        ("河南省", "410000", "华中", 4.3, 0.157, 5), ("湖北省", "420000", "华中", 5.8, 0.189, 6),
        ("湖南省", "430000", "华中", 3.9, 0.164, 4),
        ("重庆市", "500000", "西南", 3.4, 0.206, 4), ("四川省", "510000", "西南", 5.2, 0.231, 6),
        ("贵州省", "520000", "西南", 0.9, 0.172, 1), ("云南省", "530000", "西南", 1.0, 0.149, 1),
        ("西藏自治区", "540000", "西南", 0.1, 0.081, 1),
        ("陕西省", "610000", "西北", 3.1, 0.198, 4), ("甘肃省", "620000", "西北", 0.5, 0.122, 1),
        ("青海省", "630000", "西北", 0.2, 0.094, 1), ("宁夏回族自治区", "640000", "西北", 0.4, 0.137, 1),
        ("新疆维吾尔自治区", "650000", "西北", 0.8, 0.211, 1),
        ("辽宁省", "210000", "东北", 2.6, 0.048, 3), ("吉林省", "220000", "东北", 1.4, 0.036, 2),
        ("黑龙江省", "230000", "东北", 0.8, 0.029, 1),
        ("香港特别行政区", "810000", "港澳台", 1.1, 0.061, 1), ("澳门特别行政区", "820000", "港澳台", 0.1, 0.044, 1),
        ("台湾省", "710000", "港澳台", 1.4, 0.058, 1),
    ]
    return [{"province": p, "adcode": a, "region": rg, "revenue": rev, "growth": g, "service_points": sp}
            for p, a, rg, rev, g, sp in rows]


def market() -> list[dict]:
    """2025 年中国运动控制与工业自动化核心部件市场（人民币亿元），细分 × 厂商。"""
    seg = {  # 细分: [(厂商, 外资/内资, 收入)]
        "工业机器人": [("外资品牌A", "外资", 96.0), ("外资品牌B", "外资", 71.0), ("内资品牌C", "内资", 58.0),
                    (ACQ, "内资", 52.0), ("内资品牌D", "内资", 35.0), ("其他", "其他", 138.0)],
        "变频器": [("外资品牌A", "外资", 68.0), ("外资品牌E", "外资", 44.0), ("内资品牌C", "内资", 52.0),
                (ACQ, "内资", 31.0), (TGT, "外资", 1.6), ("其他", "其他", 83.0)],
        "伺服系统": [("外资品牌B", "外资", 62.0), ("外资品牌E", "外资", 41.0), ("内资品牌C", "内资", 38.0),
                 (ACQ, "内资", 38.0), (TGT, "外资", 3.2), ("其他", "其他", 47.0)],
        "PLC/控制器": [("外资品牌A", "外资", 61.0), ("外资品牌B", "外资", 24.0), (ACQ, "内资", 18.5),
                       ("内资品牌D", "内资", 12.0), (TGT, "外资", 0.8), ("其他", "其他", 26.0)],
        "视觉与传感": [("外资品牌F", "外资", 33.0), ("内资品牌D", "内资", 21.0), (ACQ, "内资", 15.0),
                     ("内资品牌C", "内资", 9.0), ("其他", "其他", 64.0)],
    }
    return [{"segment": s, "player": p, "origin": o, "revenue": v} for s, rows in seg.items() for p, o, v in rows]


def target_financials() -> list[dict]:
    """凯斯勒 2021A–2028E（人民币亿元，按 7.80 折算）。"""
    rev = [42.6, 46.1, 49.8, 52.9, 56.2, 60.4, 65.1, 70.2]
    mgn = [0.132, 0.138, 0.141, 0.146, 0.150, 0.154, 0.158, 0.163]
    out = []
    for i, y in enumerate(range(2021, 2029)):
        ebitda = rev[i] * mgn[i]
        ni = (ebitda - 0.034 * rev[i]) * (1 - 0.30)          # D&A ≈ 3.4% of revenue, German tax ≈ 30%
        out.append({"year": f"{y}{'A' if y <= 2025 else 'E'}", "revenue": rev[i], "ebitda": round(ebitda, 2),
                    "ebitda_margin": mgn[i], "net_income": round(ni, 2),
                    "overseas_share": round(0.90 - 0.004 * i, 3)})
    return out


def target_tree() -> list[dict]:
    """凯斯勒 2025A 收入按业务线（人民币亿元），颜色 = 同比增速。"""
    leaves = [  # (一级, 二级, 收入, 增速)
        ("伺服驱动器", "高端伺服驱动", 14.1, 0.092), ("伺服驱动器", "通用伺服驱动", 8.3, 0.041),
        ("精密电机", "直驱力矩电机", 9.6, 0.124), ("精密电机", "伺服电机", 7.2, 0.052),
        ("运动控制系统", "多轴控制器", 6.5, 0.108), ("运动控制系统", "软件与授权", 4.7, 0.183),
        ("售后服务", "备件", 3.6, 0.031), ("售后服务", "维保与改造", 2.2, 0.071),
    ]
    rows = [{"id": "root", "parent": "", "name": TGT, "value": None, "growth": None}]
    for grp in dict.fromkeys(l[0] for l in leaves):
        rows.append({"id": grp, "parent": "root", "name": grp, "value": None, "growth": None})
    for grp, name, v, g in leaves:
        rows.append({"id": name, "parent": grp, "name": name, "value": v, "growth": g})
    return rows


PEERS = [  # 简称, 市场, 细分, 总部, 市值(亿元), 净债务, EV/EBITDA 26E, P/E 26E, 收入增速 26E, EBITDA 利润率 26E, EV/EBITDA 25E
    (ACQ, "A股", "运动控制", "苏州", 583.2, -22.0, None, 26.5, 0.120, 0.174, None),
    ("鼎峰自动化", "A股", "运动控制", "深圳", 412.0, -18.5, 18.2, 30.5, 0.155, 0.189, 21.4),
    ("恒拓机电", "A股", "运动控制", "杭州", 186.5, 6.2, 13.6, 22.4, 0.098, 0.162, 15.1),
    ("启衡机器人", "A股", "工业机器人", "沈阳", 228.0, -9.4, 21.4, 41.2, 0.186, 0.115, 25.9),
    ("中川精密", "A股", "精密传动", "宁波", 152.3, 4.8, 14.8, 24.9, 0.112, 0.213, 16.6),
    ("卓延控制", "A股", "运动控制", "北京", 98.6, -3.1, 16.9, 28.1, 0.092, 0.151, 19.4),
    ("远图传感", "A股", "传感与视觉", "武汉", 135.4, -6.6, 24.6, 45.3, 0.168, 0.148, 30.3),
    ("宏晟工业", "港股", "精密传动", "香港", 88.2, 12.4, 9.8, 14.6, 0.094, 0.175, 10.4),
    ("粤科精工", "港股", "运动控制", "深圳", 121.7, 8.9, 11.4, 17.2, 0.088, 0.156, 12.5),
    ("泰隆机电", "港股", "工业机器人", "东莞", 46.3, 5.5, 8.6, 13.1, 0.049, 0.124, 9.0),
    ("澜禾智造", "港股", "传感与视觉", "深圳", 72.5, -4.2, 12.9, 21.8, 0.171, 0.132, 14.7),
]
ACQ_EBITDA_26E = 36.3


def cn_peers() -> list[dict]:
    """A股 / 港股可比公司（人民币亿元；港股按港元兑人民币 0.92 折算）。所有倍数由市值、净债务与盈利预测推导，互相一致。"""
    out = []
    for name, mkt, seg, hq, cap, nd, m26, pe, g, mg, m25 in PEERS:
        ev = cap + nd
        ebitda26 = ACQ_EBITDA_26E if m26 is None else ev / m26
        rev26 = ebitda26 / mg
        rev25 = rev26 / (1 + g)
        ebitda25 = ev / m25 if m25 is not None else ebitda26 / 1.15
        out.append({
            "company": name, "market": mkt, "segment": seg, "hq": hq, "is_acquirer": name == ACQ,
            "mkt_cap": cap, "net_debt": nd, "ev": round(ev, 1),
            "revenue_25e": round(rev25, 2), "revenue_26e": round(rev26, 2),
            "ebitda_25e": round(ebitda25, 2), "ebitda_26e": round(ebitda26, 2), "net_income_26e": round(cap / pe, 2),
            "ev_ebitda_25e": round(ev / ebitda25, 2), "ev_ebitda_26e": round(ev / ebitda26, 2),
            "ev_revenue_26e": round(ev / rev26, 2), "pe_26e": pe,
            "rev_growth_26e": g, "ebitda_margin_26e": mg,
        })
    return out


# ---- DCF（凯斯勒，人民币亿元）：与 sensitivity 表、dcf_live 计算字段使用同一公式
FCF = {"26": 4.6, "27": 5.3, "28": 6.0, "29": 6.6, "30": 7.1}


def dcf_ev(wacc: float, tgr: float) -> float:
    pv = sum(v / (1 + wacc) ** i for i, v in enumerate(FCF.values(), 1))
    tv = FCF["30"] * (1 + tgr) / (wacc - tgr) / (1 + wacc) ** 5
    return pv + tv


def synergy_pv(wacc: float, tgr: float, realisation: float = 0.75) -> float:
    """税后协同效应现值（2027E 起，2029E 达到全面实现，此后按永续增长）。"""
    flows = [0.0, 1.6, 2.6, 3.2, 3.2 * (1 + tgr)]                   # 2026E–2030E, 税前
    pv = sum(f * (1 - TAX_CN) / (1 + wacc) ** i for i, f in enumerate(flows, 1))
    tv = flows[-1] * (1 - TAX_CN) * (1 + tgr) / (wacc - tgr) / (1 + wacc) ** 5
    return (pv + tv) * realisation - 3.0                            # 一次性整合成本 3.0 亿元


def sensitivity() -> list[dict]:
    return [{"wacc": w / 1000, "tgr": g / 1000, "value": round(dcf_ev(w / 1000, g / 1000), 1)}
            for w in range(75, 100, 5) for g in range(10, 35, 5)]


def valuation_ranges() -> list[dict]:
    e25, e26 = 56.2 * 0.150, 60.4 * 0.154
    rows = [
        ("DCF（永续增长法）", "内在价值", dcf_ev(0.09, 0.015), dcf_ev(0.08, 0.025), "WACC 8.0%–9.0%，永续增长率 1.5%–2.5%"),
        ("DCF（含协同效应）", "内在价值", dcf_ev(0.09, 0.015) + synergy_pv(0.09, 0.015),
         dcf_ev(0.08, 0.025) + synergy_pv(0.08, 0.025), "协同效应实现率 75%，扣除整合成本 3.0 亿元"),
        ("欧洲可比公司", "市场法", 9.5 * e26, 11.5 * e26, "EV/EBITDA 2026E 9.5x–11.5x"),
        ("A股/港股可比公司", "参考", 12.0 * e26, 15.0 * e26, "EV/EBITDA 2026E 12.0x–15.0x（估值重估参考）"),
        ("欧洲先例交易", "交易法", 10.0 * e25, 12.5 * e25, "EV/LTM EBITDA 10.0x–12.5x"),
        ("中资出海并购先例", "交易法", 11.0 * e25, 13.5 * e25, "EV/LTM EBITDA 11.0x–13.5x"),
    ]
    return [{"method": m, "group": g, "low": r1(lo), "high": r1(hi), "basis": b, "order": i}
            for i, (m, g, lo, hi, b) in enumerate(rows, 1)]


# ---- 每股收益增厚（实时，随参数变化）
ACQ_SHARES = 12.0            # 亿股
PLACEMENT, PLACE_PRICE = 30.0, 45.00
NEW_SHARES = PLACEMENT / PLACE_PRICE
LOAN, CASH_USED = 40.0, 28.0
EPS_ROWS = [  # 年度, 华辰独立净利润, 凯斯勒净利润(亿欧元), 税前协同效应(全面实现), 税后 PPA 摊销
    ("2027E", 25.4, 0.64, 1.6, 1.2), ("2028E", 28.9, 0.73, 2.6, 1.2), ("2029E", 32.6, 0.81, 3.2, 1.2),
]
BASE = {"synergy": 0.75, "loan_rate": 0.038, "fx": FX}


def accretion(year_idx: int, synergy=BASE["synergy"], loan_rate=BASE["loan_rate"], fx=BASE["fx"]) -> float:
    _, ni, tni, syn, ppa = EPS_ROWS[year_idx]
    pf = ni + tni * fx + syn * synergy * (1 - TAX_CN) - (LOAN * loan_rate + CASH_USED * 0.015) * (1 - TAX_CN) - ppa
    return (pf / (ACQ_SHARES + NEW_SHARES)) / (ni / ACQ_SHARES) - 1


def eps_rows() -> list[dict]:
    return [{"year": y, "acq_ni": ni, "acq_shares": ACQ_SHARES, "tgt_ni_eur": tni, "syn_full": syn, "ppa": ppa,
             "loan": LOAN, "cash_used": CASH_USED, "new_shares": round(NEW_SHARES, 4)}
            for y, ni, tni, syn, ppa in EPS_ROWS]


# ---- 股价（华辰智能 A股，人民币元）：确定性随机游走，最后收盘 48.60 元
EVENTS = [  # 日期, 标签, 类型, 说明, 当日额外涨跌
    ("2025-10-28", "2025年三季报", "业绩", "前三季度营收同比+11.6%，毛利率提升0.8个百分点", 0.046),
    ("2026-01-15", "回购方案", "资本运作", "拟以3–5亿元回购A股，用于员工持股计划", 0.031),
    ("2026-03-27", "2025年年报", "业绩", "全年营收186.4亿元、归母净利润19.8亿元，同比+14.2%", 0.052),
    ("2026-04-28", "2026年一季报", "业绩", "一季度营收低于市场预期，海外订单放缓", -0.067),
    ("2026-07-09", "行业政策", "政策", "高端装备国产化支持政策出台（示例）", 0.038),
    ("2026-08-27", "2026年中报", "业绩", "上半年归母净利润同比+15.1%，伺服系统收入+21%", 0.044),
    ("2026-09-22", "并购传闻", "并购", "媒体报道公司洽谈欧洲资产（示例）", 0.029),
]


def trading_days(start: dt.date, end: dt.date) -> list[dt.date]:
    out, d = [], start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def prices() -> list[dict]:
    rng = random.Random(20261014)
    days = trading_days(dt.date(2025, 10, 9), dt.date(2026, 10, 9))
    jumps = {dt.date.fromisoformat(e[0]): e[4] for e in EVENTS}
    logp, closes = 0.0, []
    for d in days:
        logp += 0.0009 + rng.gauss(0, 0.017) + math.log(1 + jumps.get(d, 0.0))
        closes.append(logp)
    scale = math.log(48.60) - closes[-1]
    rows, prev = [], None
    for d, lp in zip(days, closes):
        c = math.exp(lp + scale)
        o = prev * math.exp(rng.gauss(0, 0.006)) if prev else c * 0.995
        hi = max(o, c) * (1 + abs(rng.gauss(0, 0.008)))
        lo = min(o, c) * (1 - abs(rng.gauss(0, 0.008)))
        vol = (1150 + abs(rng.gauss(0, 380)) + (1800 if d in jumps else 0)) * 1e4   # 股
        rows.append({"date": d.isoformat(), "open": round(o, 2), "high": round(hi, 2), "low": round(lo, 2),
                     "close": round(c, 2), "volume": round(vol, -2)})
        prev = c
    return rows


def relative_perf(px: list[dict]) -> list[dict]:
    """周度收盘，2025-10-09 = 100：华辰智能 vs 可比公司指数（等权，示例）vs 科创板综合（示例）。"""
    rng = random.Random(7)
    base = px[0]["close"]
    peer, board, out = 100.0, 100.0, []
    for i, r in enumerate(px):
        peer *= math.exp(0.00035 + rng.gauss(0, 0.009))
        board *= math.exp(0.0002 + rng.gauss(0, 0.011))
        if i % 5 == 0 or i == len(px) - 1:
            out += [{"date": r["date"], "series": f"{ACQ}（A股）", "value": round(r["close"] / base * 100, 1)},
                    {"date": r["date"], "series": "可比公司指数", "value": round(peer, 1)},
                    {"date": r["date"], "series": "科创板综合（示例）", "value": round(board, 1)}]
    return out


def timeline() -> list[dict]:
    T = [  # 工作流, 任务, 开始, 结束, 阶段, 负责方
        ("尽职调查与谈判", "财务、法律、税务与技术尽调", "2026-10-19", "2026-12-04", "准备", "华辰智能 / 北桥资本"),
        ("尽职调查与谈判", "提交不具约束力报价", "2026-11-06", "2026-11-06", "准备", "华辰智能"),
        ("尽职调查与谈判", "提交约束性报价", "2026-12-18", "2026-12-18", "谈判", "华辰智能"),
        ("尽职调查与谈判", "股权购买协议（SPA）谈判", "2026-12-07", "2027-01-22", "谈判", "律师 / 北桥资本"),
        ("尽职调查与谈判", "签署 SPA 并公告", "2027-01-29", "2027-01-29", "谈判", "交易双方"),
        ("公司决策", "董事会审议交易方案", "2027-01-27", "2027-01-27", "谈判", "华辰智能董事会"),
        ("公司决策", "股东大会审议", "2027-03-16", "2027-03-16", "审批", "华辰智能股东"),
        ("境内审批", "发改委境外投资项目备案", "2027-02-01", "2027-03-31", "审批", "华辰智能"),
        ("境内审批", "商务部门境外投资备案", "2027-02-08", "2027-04-09", "审批", "华辰智能"),
        ("境内审批", "外汇登记（经办银行）", "2027-04-12", "2027-04-30", "审批", "经办银行"),
        ("境内审批", "经营者集中申报", "2027-02-15", "2027-05-14", "审批", "律师"),
        ("境外审批", "德国外商投资审查", "2027-02-01", "2027-05-28", "审批", "德国律师"),
        ("境外审批", "欧盟反垄断申报", "2027-02-15", "2027-04-30", "审批", "德国律师"),
        ("融资", "并购贷款银团组建", "2026-12-01", "2027-02-26", "融资", "牵头银行"),
        ("融资", "A股定增：审核与注册", "2027-03-22", "2027-07-30", "融资", "保荐机构"),
        ("融资", "定增发行与缴款", "2027-08-02", "2027-08-20", "融资", "保荐机构"),
        ("交割与整合", "交割", "2027-09-15", "2027-09-15", "交割", "交易双方"),
        ("交割与整合", "投后整合百日计划", "2027-09-15", "2027-12-24", "交割", "整合办公室"),
    ]
    return [{"workstream": w, "task": t, "start": s, "end": e, "phase": p, "milestone": s == e, "owner": o}
            for w, t, s, e, p, o in T]


# ---------------------------------------------------------------------------------------------- 报告
def build(out: Path, **build_kw) -> Path:
    r = Report(
        "远航项目",
        subtitle="关于收购德国凯斯勒驱动技术有限公司100%股权的初步分析",
        client="华辰智能装备股份有限公司 董事会",
        date="2026-10-14",
        theme="navy",
        confidentiality="机密 · 仅供董事会讨论",
        firm=f"{FIRM} · 投资银行部",
        locale="zh-CN",
        updown="cn",
    )

    # ------------------------------------------------------------------ 数据集
    prov = provinces()
    dom_total = sum(p["revenue"] for p in prov)
    r.dataset("dom_provinces", prov, title="华辰智能国内收入（按省级行政区）",
              fields={"province": {"title": "省级行政区"}, "adcode": {"title": "行政区划代码"},
                      "region": {"title": "区域"},
                      "revenue": {"title": "2025A收入", "format": "#,##0.0", "unit": "人民币亿元"},
                      "growth": {"title": "同比增速", "format": "0.0%"},
                      "service_points": {"title": "服务网点", "format": "#,##0", "unit": "个"}},
              source="华辰智能管理层数据（示例）", unit="人民币亿元",
              notes=["含港澳台；境外收入另计。", DEMO], as_of="2025-12-31")

    mk = market()
    r.dataset("market", mk, title="中国运动控制与自动化核心部件市场（2025年）",
              fields={"segment": {"title": "细分市场"}, "player": {"title": "厂商"}, "origin": {"title": "品牌属性"},
                      "revenue": {"title": "2025年收入", "format": "#,##0.0", "unit": "人民币亿元"}},
              source=f"行业访谈、{SRC_NB}（示例）", unit="人民币亿元", notes=DEMO)

    fin = target_financials()
    r.dataset("target_fin", fin, title="凯斯勒财务概览",
              fields={"year": {"title": "年度"},
                      "revenue": {"title": "营业收入", "format": "#,##0.0", "unit": "人民币亿元"},
                      "ebitda": {"title": "EBITDA", "format": "#,##0.0", "unit": "人民币亿元"},
                      "ebitda_margin": {"title": "EBITDA利润率", "format": "0.0%"},
                      "net_income": {"title": "净利润", "format": "#,##0.0", "unit": "人民币亿元"},
                      "overseas_share": {"title": "中国以外收入占比", "format": "0%"}},
              source=SRC_TGT, unit="人民币亿元", notes=f"按欧元兑人民币 {FX:.2f} 折算。")

    r.dataset("target_tree", target_tree(), title="凯斯勒收入构成（2025A）",
              fields={"id": {"title": "编号"}, "parent": {"title": "上级"}, "name": {"title": "业务"},
                      "value": {"title": "2025A收入", "format": "#,##0.0", "unit": "人民币亿元"},
                      "growth": {"title": "同比增速", "format": "0.0%"}},
              source=SRC_TGT, unit="人民币亿元")

    peers = cn_peers()
    r.dataset("cn_peers", peers, title="A股 / 港股可比公司",
              fields={"company": {"title": "公司"}, "market": {"title": "上市地"}, "segment": {"title": "细分领域"},
                      "hq": {"title": "总部"}, "is_acquirer": {"title": "收购方"},
                      "mkt_cap": {"title": "市值", "format": "#,##0.0", "unit": "人民币亿元"},
                      "net_debt": {"title": "净债务", "format": "#,##0.0;(#,##0.0)", "unit": "人民币亿元"},
                      "ev": {"title": "企业价值", "format": "#,##0.0", "unit": "人民币亿元"},
                      "revenue_25e": {"title": "收入 2025E", "format": "#,##0.0", "unit": "人民币亿元"},
                      "revenue_26e": {"title": "收入 2026E", "format": "#,##0.0", "unit": "人民币亿元"},
                      "ebitda_25e": {"title": "EBITDA 2025E", "format": "#,##0.0", "unit": "人民币亿元"},
                      "ebitda_26e": {"title": "EBITDA 2026E", "format": "#,##0.0", "unit": "人民币亿元"},
                      "net_income_26e": {"title": "净利润 2026E", "format": "#,##0.0", "unit": "人民币亿元"},
                      "ev_ebitda_25e": {"title": "EV/EBITDA 2025E", "format": "0.0x"},
                      "ev_ebitda_26e": {"title": "EV/EBITDA 2026E", "format": "0.0x"},
                      "ev_revenue_26e": {"title": "EV/收入 2026E", "format": "0.0x"},
                      "pe_26e": {"title": "市盈率 2026E", "format": "0.0x"},
                      "rev_growth_26e": {"title": "收入增速 2026E", "format": "0.0%"},
                      "ebitda_margin_26e": {"title": "EBITDA利润率 2026E", "format": "0.0%"}},
              computed=[{"name": "peg", "title": "PEG 2026E", "format": "0.00x",
                         "formula": "pe_26e / (rev_growth_26e * 100)"}],
              source=SRC_MKT, unit="人民币亿元",
              notes=["港股按港元兑人民币 0.92 折算；倍数按日历年调整。", DEMO], as_of="2026-10-09")

    r.dataset("valuation", valuation_ranges(), title="凯斯勒估值区间（企业价值）",
              fields={"method": {"title": "估值方法"}, "group": {"title": "类别"},
                      "low": {"title": "低值", "format": "#,##0.0", "unit": "人民币亿元"},
                      "high": {"title": "高值", "format": "#,##0.0", "unit": "人民币亿元"},
                      "basis": {"title": "依据"}, "order": {"title": "顺序", "format": "0"}},
              source=SRC_NB, unit="人民币亿元")

    r.dataset("sensitivity", sensitivity(), title="DCF敏感性分析：企业价值",
              fields={"wacc": {"title": "WACC", "format": "0.0%"}, "tgr": {"title": "永续增长率", "format": "0.0%"},
                      "value": {"title": "企业价值", "format": "#,##0.0", "unit": "人民币亿元"}},
              source=SRC_NB, unit="人民币亿元",
              notes="2026E–2030E 无杠杆自由现金流，年末折现；终值采用戈登增长模型。")

    # WACC / 永续增长率：敏感性表点击单元格即修改这两个参数，估值页副标题与 dcf_live 随之更新
    r.param("wacc", 0.085, min=0.075, max=0.095, step=0.005, format="0.0%", title="WACC")
    r.param("tgr", 0.02, min=0.01, max=0.03, step=0.005, format="0.0%", title="永续增长率")
    pv = " + ".join(f"fcf_{y} / (1 + @wacc) ^ {i}" for i, y in enumerate(FCF, 1))
    r.dataset("dcf_live", [{"case": "基准情形", **{f"fcf_{y}": v for y, v in FCF.items()}}],
              title="凯斯勒DCF（实时）",
              fields={"case": {"title": "情形"},
                      **{f"fcf_{y}": {"title": f"自由现金流 20{y}E", "format": "#,##0.0"} for y in FCF}},
              computed=[
                  {"name": "pv_fcf", "title": "预测期现金流现值", "format": "#,##0.0", "formula": pv},
                  {"name": "pv_tv", "title": "终值现值", "format": "#,##0.0",
                   "formula": "fcf_30 * (1 + @tgr) / (@wacc - @tgr) / (1 + @wacc) ^ 5"},
                  {"name": "implied_ev", "title": "DCF企业价值", "format": "#,##0.0", "formula": "pv_fcf + pv_tv"},
                  {"name": "vs_offer", "title": "较报价", "format": "+0.0%;-0.0%;0.0%",
                   "formula": f"implied_ev / {EV} - 1"},
              ],
              source=SRC_NB, unit="人民币亿元")

    su = [
        ("资金来源", "自有资金", 28.0, "华辰智能账面现金（2026年6月30日：50.2亿元）"),
        ("资金来源", "并购贷款", 40.0, "境内银团，7年期，利率3.8%（LPR+30bp），以标的股权质押"),
        ("资金来源", "A股定向增发", 30.0, "发行价不低于定价基准日前20个交易日均价的80%"),
        ("资金运用", "股权收购对价", EQUITY, f"企业价值 {EV} 亿元扣除净债务及类债务项目"),
        ("资金运用", "偿还标的有息负债", DEBT, "交割时偿还凯斯勒现有银行借款"),
        ("资金运用", "交易费用及税费", 2.2, "财务顾问、法律、审计及印花税等"),
        ("资金运用", "补充营运资金", round(CASH_USED + LOAN + PLACEMENT - EQUITY - DEBT - 2.2, 1), None),
    ]
    r.dataset("sources_uses", [{"side": s, "item": i, "amount": a, "notes": n} for s, i, a, n in su],
              title="资金来源与运用",
              fields={"side": {"title": "类别"}, "item": {"title": "项目"},
                      "amount": {"title": "金额", "format": "#,##0.0", "unit": "人民币亿元"}, "notes": {"title": "说明"}},
              source=SRC_NB, unit="人民币亿元")

    r.dataset("ev_bridge", [
        {"step": "企业价值（报价）", "value": EV, "kind": "total"},
        {"step": "减：有息负债", "value": -DEBT, "kind": "delta"},
        {"step": "加：现金", "value": CASH, "kind": "delta"},
        {"step": "减：养老金负债", "value": -PENSION, "kind": "delta"},
        {"step": "股权价值", "value": EQUITY, "kind": "total"},
    ], title="企业价值至股权价值",
        fields={"step": {"title": "项目"}, "value": {"title": "金额", "format": "#,##0.0;(#,##0.0)", "unit": "人民币亿元"},
                "kind": {"title": "类型"}},
        source=f"{SRC_NB}；凯斯勒2026年6月30日资产负债表（示例）", unit="人民币亿元")

    px = prices()
    r.dataset("acq_price", px, title="华辰智能A股日线行情",
              fields={"date": {"title": "日期", "format": "yyyy\"年\"m\"月\"d\"日\""},
                      **{k: {"title": t, "format": "0.00", "unit": "元"}
                         for k, t in [("open", "开盘价"), ("high", "最高价"), ("low", "最低价"), ("close", "收盘价")]},
                      "volume": {"title": "成交量", "format": "auto", "unit": "股"}},
              source=SRC_MKT, unit="元", notes="前复权；示例数据。")
    r.dataset("acq_events", [{"date": d, "label": l, "kind": k, "detail": t} for d, l, k, t, _ in EVENTS],
              title="华辰智能重要事件",
              fields={"date": {"title": "日期", "format": "yyyy\"年\"m\"月\"d\"日\""}, "label": {"title": "事件"},
                      "kind": {"title": "类型"}, "detail": {"title": "说明"}},
              source="公司公告（示例）")
    rel = relative_perf(px)
    r.dataset("rel_perf", rel, title="相对股价表现",
              fields={"date": {"title": "日期", "format": "yyyy\"年\"m\"月\"d\"日\""}, "series": {"title": "标的"},
                      "value": {"title": "相对表现", "format": "0.0"}},
              source=SRC_MKT, notes="2025年10月9日 = 100；可比公司指数为第8页A股/港股可比公司等权组合。")

    # what-if：协同效应实现率、并购贷款利率、欧元汇率 -> 每股收益增厚（实时计算字段）
    r.param("synergy", BASE["synergy"], min=0.0, max=1.0, step=0.05, format="0%", title="协同效应实现率")
    r.param("loan_rate", BASE["loan_rate"], min=0.03, max=0.055, step=0.0025, format="0.00%", title="并购贷款利率")
    r.param("fx", BASE["fx"], min=7.4, max=8.2, step=0.05, format="0.00", title="欧元兑人民币")
    r.dataset("eps_accretion", eps_rows(), title="每股收益增厚 / 摊薄（实时）",
              fields={"year": {"title": "年度"},
                      "acq_ni": {"title": "华辰智能独立净利润", "format": "#,##0.0"},
                      "acq_shares": {"title": "现有股本（亿股）", "format": "#,##0.00"},
                      "tgt_ni_eur": {"title": "凯斯勒净利润（亿欧元）", "format": "0.00"},
                      "syn_full": {"title": "税前协同效应（全面实现）", "format": "#,##0.0"},
                      "ppa": {"title": "无形资产摊销（税后）", "format": "#,##0.0"},
                      "loan": {"title": "并购贷款", "format": "#,##0.0"},
                      "cash_used": {"title": "使用自有资金", "format": "#,##0.0"},
                      "new_shares": {"title": "定增新股（亿股）", "format": "0.00"}},
              computed=[
                  {"name": "tgt_ni", "title": "凯斯勒净利润", "format": "#,##0.0", "formula": "tgt_ni_eur * @fx"},
                  {"name": "syn_net", "title": "税后协同效应", "format": "#,##0.0",
                   "formula": f"syn_full * @synergy * (1 - {TAX_CN})"},
                  {"name": "fin_cost", "title": "税后融资成本", "format": "#,##0.0",
                   "formula": f"(loan * @loan_rate + cash_used * 0.015) * (1 - {TAX_CN})"},
                  {"name": "pf_ni", "title": "备考净利润", "format": "#,##0.0",
                   "formula": "acq_ni + tgt_ni + syn_net - fin_cost - ppa"},
                  {"name": "eps_sa", "title": "独立每股收益", "format": "0.00", "formula": "acq_ni / acq_shares"},
                  {"name": "eps_pf", "title": "备考每股收益", "format": "0.00",
                   "formula": "pf_ni / (acq_shares + new_shares)"},
                  {"name": "accretion", "title": "增厚 / (摊薄)", "format": "+0.0%;-0.0%;0.0%",
                   "formula": "eps_pf / eps_sa - 1"},
              ],
              source=f"{SRC_NB}；华辰智能一致预期（示例）", unit="人民币亿元",
              notes="假设2027年1月1日完成交割、收购对价已锁汇；自有资金机会成本按1.5%计。")

    r.dataset("deal_timeline", timeline(), title="交易时间表",
              fields={"workstream": {"title": "工作流"}, "task": {"title": "事项"},
                      "start": {"title": "开始", "format": "yyyy\"年\"m\"月\"d\"日\""},
                      "end": {"title": "结束", "format": "yyyy\"年\"m\"月\"d\"日\""},
                      "phase": {"title": "阶段"}, "milestone": {"title": "里程碑"}, "owner": {"title": "负责方"}},
              source=f"{SRC_NB}（示例）", notes="时间表为初步安排，取决于审批进度。")

    a = [accretion(i) for i in range(3)]
    lev = (-22.0 + CASH_USED + LOAN) / (31.7 + 56.2 * 0.150)     # 交易后净债务 / 备考 2025A EBITDA
    pf_overseas = (23.6 + 56.2 * 0.90) / (186.4 + 56.2)
    r.dataset("kpis", [
        {"id": "ev", "label": "企业价值（人民币）", "value": EV * 1e8, "format": "auto", "delta": None,
         "delta_format": None, "period": f"{EV_EUR:.1f}亿欧元 × {FX:.2f}", "good": "up"},
        {"id": "mult", "label": "EV/EBITDA 2026E", "value": EV / (60.4 * 0.154), "format": "0.0x",
         "delta": None, "delta_format": None, "period": "2025A：11.1x", "good": "down"},
        {"id": "eps", "label": "2027E每股收益增厚", "value": a[0], "format": "+0.0%;-0.0%;0.0%",
         "delta": (a[2] - a[0]) * 100, "delta_format": "+0.0\"个百分点\"", "period": "至2029E", "good": "up"},
        {"id": "overseas", "label": "备考海外收入占比", "value": pf_overseas, "format": "0%",
         "delta": (pf_overseas - 23.6 / 186.4) * 100, "delta_format": "+0\"个百分点\"", "period": "较交易前",
         "good": "up"},
        {"id": "synergy", "label": "年化协同效应（税前）", "value": 3.2e8, "format": "auto", "delta": None,
         "delta_format": None, "period": "2029E全面实现", "good": "up"},
        {"id": "lev", "label": "交易后净杠杆", "value": lev,
         "format": "0.0x", "delta": None, "delta_format": None, "period": "净债务 / 2025A EBITDA", "good": "down"},
    ], title="关键指标",
        fields={"id": {"title": "编号"}, "label": {"title": "指标"}, "value": {"title": "数值"},
                "format": {"title": "格式"}, "delta": {"title": "变化"}, "delta_format": {"title": "变化格式"},
                "period": {"title": "说明"}, "good": {"title": "有利方向"}},
        source=SRC_NB)

    # 顶栏全局筛选：只作用于可比公司数据集（其他页面的数据没有这两个字段）
    r.topbar_block("filter-bar", data="cn_peers", options={
        "countLabel": "家公司",
        "filters": [
            {"field": "market", "type": "multi", "label": "上市地", "datasets": ["cn_peers"]},
            {"field": "segment", "type": "multi", "label": "细分领域", "datasets": ["cn_peers"]},
        ]})

    # ------------------------------------------------------------------ 封面与执行摘要
    r.cover(kicker="董事会讨论材料 · 初稿")

    t = f"以{EV}亿元收购凯斯勒：补齐高端运动控制，2027E每股收益增厚{a[0]:.1%}"
    p = r.page(t, kicker="执行摘要", id="summary", nav="执行摘要",
               subtitle="单位：人民币；市场数据截至2026年10月9日", source=[SRC_MKT, SRC_NB], notes=DEMO)
    p.block("kpi-tiles", data="kpis", height=128, options={"variant": "boxed", "columns": 6, "sparkline": False})
    p.block("text-block", height=172, options={
        "variant": "takeaways", "columns": 4,
        "items": [
            {"title": "战略契合",
             "text": "凯斯勒在**高端伺服与直驱电机**领域拥有40年积累，可补齐华辰在高精度运动控制的产品短板。"},
            {"title": "估值合理",
             "text": f"报价对应 **{EV / (60.4 * 0.154):.1f}x** 2026E EBITDA，低于A股/港股可比公司中位数，位于各估值区间下沿。"},
            {"title": "财务增厚",
             "text": f"首个完整年度（2027E）每股收益增厚 **{a[0]:.1%}**，2029E协同效应全面实现后增至 **{a[2]:.1%}**。"},
            {"title": "风险可控",
             "text": f"交易后净杠杆约 **{lev:.1f}x**；德国外商投资审查为关键路径，建议预留4个月审批窗口。"},
        ]})
    p.block("text-block", height=76, options={
        "variant": "callout", "kicker": "建议", "tone": "accent2",
        "title": "建议董事会授权提交不具约束力报价（企业价值90–95亿元），并同步启动境内外审批准备",
        "text": "11月6日前提交报价；2027年1月签署股权购买协议；预计2027年第三季度完成交割。"})

    # ------------------------------------------------------------------ 01 战略背景
    r.section("战略背景", subtitle="行业格局、国内布局与标的概览", id="part-1")

    seg_tot: dict[str, float] = {}
    for row in mk:
        seg_tot[row["segment"]] = seg_tot.get(row["segment"], 0.0) + row["revenue"]
    mk_total = sum(seg_tot.values())
    def foreign_share(seg: str) -> float:
        return sum(x["revenue"] for x in mk if x["origin"] == "外资" and x["segment"] == seg) / seg_tot[seg]
    plc_f, servo_f = foreign_share("PLC/控制器"), foreign_share("伺服系统")
    t = f"国内市场规模约{mk_total:,.0f}亿元，PLC与伺服外资份额仍达{plc_f:.0%}与{servo_f:.0%}"
    p = r.page(t, kicker="行业格局", id="industry", subtitle="2025年中国运动控制与自动化核心部件市场；单位：人民币亿元",
               source=f"行业访谈、{SRC_NB}（示例）", notes="外资品牌以字母代称；凯斯勒在华收入计入外资品牌。")
    p.block("marimekko", data="market", span=8, height=plot_h(t), title="细分市场规模与竞争格局",
            options={"encode": {"x": "segment", "series": "player", "value": "revenue"},
                     "highlight": [ACQ, TGT], "othersLabel": "其他", "maxSeries": 9})
    p.block("text-block", data="market", span=4, height=plot_h(t), title="关键数据", options={
        "variant": "stats", "columns": 1,
        "items": [
            {"expr": "sum(revenue)", "format": "#,##0\"亿元\"", "label": "2025年市场规模",
             "note": "五个细分市场合计"},
            {"expr": "sum(if(origin == \"外资\", revenue, 0)) / sum(revenue)", "format": "0%",
             "label": "外资品牌份额", "note": f"PLC/控制器 {plc_f:.0%}，伺服系统 {servo_f:.0%}"},
            {"expr": f"sum(if(player == \"{ACQ}\", revenue, 0)) / sum(revenue)", "format": "0.0%",
             "label": f"{ACQ}份额", "note": "内资品牌第二；叠加凯斯勒后合并在华收入{{sum(if(player == \"" + ACQ
             + "\" or player == \"" + TGT + "\", revenue, 0)) | #,##0.0}}亿元", "tone": "accent2"},
        ]})

    east_south = sum(x["revenue"] for x in prov if x["region"] in ("华东", "华南")) / dom_total

    def region_growth(regions: tuple) -> float:
        rows = [x for x in prov if x["region"] in regions]
        return sum(x["revenue"] for x in rows) / sum(x["revenue"] / (1 + x["growth"]) for x in rows) - 1
    g_mid, g_east = region_growth(("华中", "西南", "西北")), region_growth(("华东", "华南"))
    t = f"华东与华南贡献国内收入的{east_south:.0%}；中西部增长{g_mid:.0%}，快于东部的{g_east:.0%}"
    p = r.page(t, kicker="国内布局", id="footprint", subtitle="华辰智能2025A国内收入（含港澳台）；单位：人民币亿元",
               source="华辰智能管理层数据（示例）",
               notes="方块图为示意图，各省级行政区面积相等，不代表实际边界；可切换指标查看增速，点击方块或区域交叉筛选。")
    p.block("china-tilemap", data="dom_provinces", id="footprint-provinces", span=7, height=plot_h(t, block_sub=True),
            title="按省级行政区", subtitle="点击方块筛选右图；颜色分档见图例",
            options={"encode": {"id": "adcode", "value": "revenue"}, "join": "adcode", "lang": "zh",
                     "highlight": ["320000"], "highlightLabel": "总部（江苏苏州）", "note": True, "filterField": "province",
                     "choices": {"value": ["revenue", "growth", "service_points"]}, "choiceLabels": {"value": "指标"}})
    p.block("bar", data="dom_provinces", id="footprint-regions", span=5, height=plot_h(t, block_sub=True), title="按区域",
            subtitle="{{dom_provinces: count()}}个省级行政区 · 收入合计{{dom_provinces: sum(revenue) | #,##0.0}}亿元",
            options={"encode": {"x": "region", "y": "revenue"}, "orientation": "horizontal", "sort": "desc",
                     "highlight": "华东", "choices": {"y": ["revenue", "service_points"]}, "choiceLabels": {"y": "指标"}})

    cagr = (fin[4]["revenue"] / fin[0]["revenue"]) ** (1 / 4) - 1
    t = f"凯斯勒2021A–2025A收入年复合增长{cagr:.1%}，EBITDA利润率提升至{fin[4]['ebitda_margin']:.1%}"
    p = r.page(t, kicker="标的概览", id="target", subtitle="凯斯勒驱动技术有限公司（德国斯图加特）；单位：人民币亿元",
               source=SRC_TGT, notes=f"按欧元兑人民币 {FX:.2f} 折算；2026E–2028E 为管理层预测。")
    p.block("combo", data="target_fin", id="target-financials", span=7, height=plot_h(t), title="营业收入与EBITDA利润率",
            options={"encode": {"x": "year", "bars": ["revenue"], "line": ["ebitda_margin"]},
                     "format": "#,##0.0", "cagr": "split", "forecastLabel": "预测期"})
    p.block("treemap", data="target_tree", id="target-mix", span=5, height=plot_h(t, block_sub=True), title="2025A收入构成",
            subtitle="面积 = 收入；悬停查看同比增速",
            options={"encode": {"id": "id", "parent": "parent", "name": "name", "value": "value", "color": "growth"},
                     "colorBy": "group", "rootName": TGT, "drill": False, "showShare": False})

    # ------------------------------------------------------------------ 02 估值分析
    r.section("估值分析", subtitle="可比公司、估值区间与敏感性分析", id="part-2")

    t = ("可比公司2026E EV/EBITDA中位数{{cn_peers: median(if(not is_acquirer, ev_ebitda_26e, null)) | 0.0x}}，"
         f"报价对应{EV / (60.4 * 0.154):.1f}x")
    p = r.page(t, kicker="可比公司", id="comps", subtitle="A股 / 港股工业自动化可比公司；单位：人民币亿元；市场数据截至2026年10月9日",
               source=SRC_MKT, notes=["均值与中位数不含华辰智能；港股按港元兑人民币0.92折算。",
                                      "可用顶栏「上市地」「细分领域」筛选，标题中位数随之更新。"])
    p.block("comps-table", data="cn_peers", span=7, height=plot_h(t, block_head=False), options={
        "encode": {"label": "company", "highlight": "is_acquirer"}, "labelTitle": "公司",
        "groupBy": "market", "pinTarget": "top", "stats": ["mean", "median"],
        "sort": {"field": "ev_ebitda_26e", "dir": "desc"}, "dense": True, "scroll": False,
        "columns": [
            {"field": "segment", "title": "细分领域"},
            {"field": "mkt_cap", "title": "市值"},
            {"field": "ev_ebitda_25e", "title": "2025E", "group": "EV/EBITDA"},
            {"field": "ev_ebitda_26e", "title": "2026E", "group": "EV/EBITDA", "heat": "seq"},
            {"field": "pe_26e", "title": "2026E", "group": "市盈率"},
            {"field": "rev_growth_26e", "title": "收入增速", "group": "2026E经营指标"},
            {"field": "ebitda_margin_26e", "title": "EBITDA利润率", "group": "2026E经营指标"},
        ]})
    p.block("scatter", data="cn_peers", span=5, height=plot_h(t) - 30, title="估值与成长性",
            options={"encode": {"x": "rev_growth_26e", "y": "ev_ebitda_26e", "label": "company", "target": "is_acquirer"},
                     "choices": {"y": ["ev_ebitda_26e", "pe_26e", "ev_revenue_26e", "*computed"],
                                 "x": ["rev_growth_26e", "ebitda_margin_26e"]},
                     "choiceLabels": {"y": "纵轴", "x": "横轴"},
                     "regression": True, "peerLabel": "可比公司",
                     "tooltipFields": ["market", "segment", "mkt_cap"]})

    vr = valuation_ranges()
    standalone = [v for v in vr if v["group"] != "参考" and "协同" not in v["method"]]
    lo, hi = min(v["low"] for v in standalone), max(v["high"] for v in standalone)
    t = f"独立估值区间{lo:.0f}–{hi:.0f}亿元，{EV}亿元报价位于下半区，协同效应价值留存于买方"
    p = r.page(t, kicker="估值汇总", id="valuation",
               subtitle="单位：人民币亿元；DCF基准：WACC {{@wacc | 0.0%}}、永续增长率{{@tgr | 0.0%}}，"
                        "企业价值{{dcf_live: implied_ev | #,##0.0}}亿元（较报价{{dcf_live: vs_offer}}）",
               source=SRC_NB, notes=["A股/港股可比公司倍数仅作估值重估参考，不作为定价依据。",
                                     "点击敏感性表中的单元格可切换DCF基准假设，副标题实时更新。"])
    p.block("football-field", data="valuation", span=7, height=plot_h(t, block_sub=True),
            title="凯斯勒企业价值区间", subtitle="按估值方法；灰色为参考区间",
            options={"encode": {"label": "method", "low": "low", "high": "high", "group": "group", "note": "basis"},
                     "referenceGroups": ["参考"],
                     "refLines": [{"value": EV, "label": f"报价 {EV}亿元"}],
                     "refBand": {"from": 90, "to": 95, "label": "建议报价区间 90–95亿元"}})
    p.block("sensitivity-table", data="sensitivity", id="valuation-sensitivity", span=5, height=plot_h(t, block_sub=True),
            title="DCF敏感性：企业价值", subtitle="点击单元格切换基准情形",
            options={"encode": {"row": "wacc", "col": "tgr", "value": "value"},
                     "rowTitle": "WACC", "colTitle": "永续增长率", "base": {"row": "@wacc", "col": "@tgr"},
                     "heat": "seq"})

    # ------------------------------------------------------------------ 03 交易方案与执行
    r.section("交易方案与执行", subtitle="交易结构、融资窗口、财务影响与时间表", id="part-3")

    need = CASH_USED + LOAN + PLACEMENT
    t = (f"{need:.1f}亿元资金需求：自有资金、并购贷款与A股定增分别占"
         f"{CASH_USED / need:.0%}、{LOAN / need:.0%}与{PLACEMENT / need:.0%}")
    p = r.page(t, kicker="交易结构", id="structure", subtitle="单位：人民币亿元",
               source=f"{SRC_NB}；凯斯勒2026年6月30日资产负债表（示例）",
               notes="定增规模与发行价以交易所审核及证监会注册结果为准。")
    h_su = plot_h(t, block_sub=True) - 104      # second row: deal metrics strip
    p.block("sources-uses", data="sources_uses", span=8, height=h_su, title="资金来源与运用",
            subtitle="交割时点，备考",
            options={"encode": {"side": "side", "item": "item", "amount": "amount", "notes": "notes"},
                     "sides": ["资金来源", "资金运用"],
                     "totalLabels": {"资金来源": "资金来源合计", "资金运用": "资金运用合计"},
                     "titles": {"item": "项目", "amount": "金额", "pct": "占比"},
                     "columns": ["amount", "pct"], "highlight": "并购贷款"})
    p.block("waterfall", data="ev_bridge", span=4, height=h_su, title="企业价值至股权价值",
            subtitle="报价口径",
            options={"encode": {"label": "step", "value": "value", "kind": "kind"}, "format": "#,##0.0"})
    p.block("text-block", span=12, height=84, options={
        "variant": "stats", "columns": 4,
        "items": [
            {"value": lev, "format": "0.0x", "label": "交易后净杠杆",
             "note": "净债务 / 备考2025A EBITDA"},
            {"value": NEW_SHARES / (ACQ_SHARES + NEW_SHARES), "format": "0.0%", "label": "定增摊薄比例",
             "note": f"新增 {NEW_SHARES:.2f} 亿股，发行价 {PLACE_PRICE:.2f} 元"},
            {"value": 50.2 - CASH_USED, "format": "#,##0.0\"亿元\"", "label": "交易后账面现金",
             "note": "2026年6月30日备考"},
            {"value": (ACQ_EBITDA_26E + 60.4 * 0.154) / (LOAN * BASE["loan_rate"]), "format": "0x",
             "label": "备考利息保障倍数", "note": "2026E EBITDA / 并购贷款利息"},
        ]})

    ret = px[-1]["close"] / px[0]["close"] - 1
    peer_last = [x["value"] for x in rel if x["series"] == "可比公司指数"][-1] / 100 - 1
    avg20 = sum(x["close"] for x in px[-20:]) / 20
    floor = math.floor(avg20 * 0.8 * 100) / 100
    t = f"近一年股价上涨{ret:.0%}，跑赢可比公司指数{(ret - peer_last) * 100:.0f}个百分点，定增窗口有利"
    p = r.page(t, kicker="股价表现", id="trading", subtitle="华辰智能A股（科创板）；2025年10月9日至2026年10月9日",
               source=SRC_MKT, notes=f"定增底价按前20个交易日均价 {avg20:.2f} 元的80%估算；发行价假设 {PLACE_PRICE:.2f} 元。")
    p.block("candlestick", data="acq_price", id="trading-kline", span=7, height=plot_h(t), title="日K线与成交量（元）",
            options={"eventsData": "acq_events", "range": "1y", "ma": [20, 60],
                     "rangeSelector": ["3m", "6m", "1y"],
                     "refLines": [{"value": floor, "label": f"定增底价 {floor:.2f}元"}]})
    p.block("line", data="rel_perf", id="trading-relative", span=5, height=plot_h(t), title="相对表现（2025年10月9日 = 100）",
            options={"encode": {"x": "date", "y": "value", "series": "series"}, "highlight": f"{ACQ}（A股）",
                     "endLabels": "value", "format": "0"})

    t = "协同效应实现{{@synergy | 0%}}时，2028E每股收益增厚{{eps_accretion: sum(if(year == \"2028E\", accretion, 0)) | +0.0%;-0.0%;0.0%}}"
    p = r.page(t, kicker="假设分析", id="what-if", subtitle="拖动滑块，备考每股收益在浏览器中实时重算；单位：人民币亿元",
               source=f"{SRC_NB}；华辰智能一致预期（示例）",
               notes="假设2027年1月1日完成交割、收购对价已锁汇；定增新增股本0.67亿股（发行价45.00元）。")
    p.block("param-slider", data="eps_accretion", span=5, height=plot_h(t), title="关键假设", options={
        "params": ["synergy", "loan_rate", "fx"], "columns": 1,
        "preview": {"fields": ["year", "eps_sa", "eps_pf", "accretion"], "title": "实时结果（元 / 股）"}})
    p.block("diverging-bar", data="eps_accretion", span=7, height=plot_h(t), title="每股收益增厚 / (摊薄)",
            options={"encode": {"label": "year", "value": "accretion"}, "orientation": "vertical", "sort": None,
                     "format": "+0.0%;-0.0%;0.0%", "valueAxis": True})

    t = "预计2027年第三季度完成交割，德国外商投资审查为关键路径"
    p = r.page(t, kicker="交易时间表", id="timetable", source=f"{SRC_NB}（示例）",
               notes="境内审批包括发改委与商务部门备案、外汇登记；如触发申报标准，需进行经营者集中申报。")
    p.block("gantt", data="deal_timeline", height=plot_h(t, block_head=False, page_sub=False),
            options={"encode": {"group": "workstream", "label": "task", "start": "start", "end": "end",
                                "phase": "phase", "milestone": "milestone", "owner": "owner"},
                     "today": "2026-10-14", "todayLabel": "今日", "milestoneName": "里程碑",
                     "calendar": "months", "zoom": False, "sort": "data"})

    # ------------------------------------------------------------------ 附录
    t = "附录：自助分析——用公式查询数据、创建自定义指标"
    p = r.page(t, nav="附录 · 自助分析", id="explore",
               source="在浏览器本地运行，并受顶栏筛选影响；数据不会离开本文件。")
    p.block("query-console", data="cn_peers", height=480, options={
        "datasets": ["cn_peers", "dom_provinces", "market", "target_fin"],
        "highlight": ACQ, "tab": "query",
        "query": "median(ev_ebitda_26e) as \"EV/EBITDA 2026E中位数\" by segment from cn_peers "
                 "where not is_acquirer sort 2 desc",
        "builder": {"values": [{"agg": "median", "field": "ev_ebitda_26e"}, {"agg": "median", "field": "pe_26e"}],
                    "rows": ["market"], "sort": {"col": "v0", "dir": "desc"}},
        "examples": [
            {"label": "按上市地统计估值中位数",
             "query": "median(ev_ebitda_26e) as \"EV/EBITDA 2026E\", median(pe_26e) as \"市盈率 2026E\", count() as \"公司数\" "
                      "by market from cn_peers where not is_acquirer"},
            {"label": "华东各省收入",
             "query": "province, revenue, growth from dom_provinces where region == \"华东\" sort revenue desc"},
            {"label": "各区域收入与增速",
             "query": "sum(revenue) as \"收入（亿元）\", wavg(growth, revenue) as \"加权增速\" format \"0.0%\" "
                      "by region from dom_provinces sort 2 desc"},
            {"label": "细分市场外资份额",
             "query": "sum(revenue) as \"市场规模\", sum(if(origin == \"外资\", revenue, 0)) / sum(revenue) as \"外资份额\" "
                      "format \"0%\" by segment from market sort 3 desc"},
            {"label": "自定义指标：EV/收入",
             "query": "company, ev / revenue_26e as \"EV/收入 2026E\" format \"0.0x\" from cn_peers sort 2 desc"},
        ]})

    p = r.page("重要声明", kicker="免责声明", id="disclaimer", nav="免责声明", filters=False, source=False,
               notes=DEMO)
    p.block("text-block", height=plot_h("重要声明", block_head=False, page_sub=False), options={
        "variant": "prose", "columns": 2,
        "text": (
            f"本材料由{FIRM}（以下简称“本公司”）仅为华辰智能装备股份有限公司（以下简称“贵公司”）董事会讨论之目的而编制，"
            "属机密文件，未经本公司事先书面同意，不得复制、转发或向任何第三方披露全部或部分内容。\n\n"
            "本材料所载信息部分来自公开资料、标的公司管理层及其他第三方，本公司未对该等信息进行独立核实，"
            "亦不对其准确性、完整性作出任何明示或默示的陈述或保证。本材料中的预测、估值及备考财务数据基于多项假设，"
            "实际结果可能与之存在重大差异。\n\n"
            "本材料不构成任何证券的发售要约或购买要约邀请，亦不构成投资、法律、税务或会计建议。"
            "贵公司应就拟议交易咨询独立的法律、税务及会计顾问，并自行作出决策。\n\n"
            "拟议交易需取得贵公司董事会及股东大会批准，并完成发展改革、商务、外汇等境内备案或登记手续，"
            "以及德国外商投资审查、反垄断审查等境外审批；能否取得及取得时间存在不确定性。\n\n"
            "**示例说明：**本报告为 ReportKit 中文示例，文中公司（华辰智能、凯斯勒、可比公司及外资品牌代称）、"
            "机构与全部数据均为虚构，仅用于展示报告框架的版式与交互能力，不代表任何真实公司或交易。"
            "本页不受顶栏筛选与图表交叉选择影响。"
        )})

    return r.build(out, **build_kw)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    target = Path(args[0]) if args else ROOT / "examples" / "demo-zh-cn"
    path = build(target, single_file="--single-file" in flags, excel="--excel" in flags)
    print(f"built {path}")
