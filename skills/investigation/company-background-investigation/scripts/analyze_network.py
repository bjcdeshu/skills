#!/usr/bin/env python3
"""Analyze a dossier's relationship graph (Python 3.10+ stdlib only).

Reports penetrating (look-through) ownership, two-hop person co-occurrence,
shortest A<->B paths, confidence grades and centrality.  Read-only: the dossier
is never modified.  Analysis is structural; the investigating agent still checks
each path's sources, identities and direction against the original material.

Examples:
  python analyze_network.py dossier.json                      # overview
  python analyze_network.py dossier.json --ownership --threshold 10
  python analyze_network.py dossier.json --cooccur person-a
  python analyze_network.py dossier.json --path person-a co-b --include-historical
  python analyze_network.py dossier.json --json --out analytics.json
"""

import argparse
import json
from pathlib import Path
import sys

import network_core as nc
from validate_dossier import load_json, validate_dossier


def ownership_report(data, root_id, threshold, as_of, include_historical):
    ownership = nc.penetrating_ownership(data, root_id, as_of=as_of, include_historical=include_historical)
    meta = dict(data.get("meta") or {})
    meta["root_id"] = root_id
    summary = nc.ownership_summary(ownership, {**data, "meta": meta}, threshold)
    return {"root_id": root_id, "as_of": as_of, "ownership": ownership, "summary": summary}


def run(args):
    data = load_json(args.dossier)
    report = validate_dossier(data, args.dossier.resolve().parent)
    entities = nc.entity_index(data)
    root_id = args.root or (data.get("meta") or {}).get("root_id")
    if root_id not in entities:
        raise ValueError(f"根主体不存在：{root_id}")
    for ident in [args.cooccur] + (args.path or []):
        if ident is not None and ident not in entities:
            raise ValueError(f"主体不存在：{ident}")
    out = {"dossier": str(args.dossier), "root_id": root_id,
           "validation": {"ok": report["ok"], "errors": len(report["errors"]),
                          "warnings": len(report["warnings"])}}
    focused = args.ownership or args.cooccur or args.path
    if args.ownership or not focused:
        out["ownership"] = ownership_report(data, root_id, args.threshold, args.as_of, args.include_historical)
    if args.cooccur:
        out["co_occurrence"] = {"subject_id": args.cooccur, "rows": nc.co_occurrence_rows(data, args.cooccur)}
    elif not focused:
        meta = dict(data.get("meta") or {})
        meta["root_id"] = root_id
        out["co_occurrence"] = nc.co_occurrence({**data, "meta": meta},
                                                ownership=out["ownership"]["ownership"])
    if args.path:
        start, end = args.path
        out["paths"] = {"from": start, "to": end, "max_hops": args.max_hops,
                        "include_historical": args.include_historical,
                        "include_signals": args.include_signals,
                        "include_candidates": args.include_candidates,
                        "results": nc.find_paths(data, start, end, args.max_hops, args.include_historical,
                                                 args.include_signals, args.include_candidates, args.limit)}
    if not focused:
        out["confidence"] = nc.confidence(data)
        out["centrality"] = nc.centrality(data)
    return out, report


def name_of(entities, ident):
    entity = entities.get(ident, {})
    return f"{entity.get('name', ident)}（{ident}）"


def render_text(out, data):
    entities = nc.entity_index(data)
    lines = [f"根主体：{name_of(entities, out['root_id'])}",
             "结构验证：{}（错误 {}，警告 {}）".format("通过" if out["validation"]["ok"] else "未通过",
                                              out["validation"]["errors"], out["validation"]["warnings"])]
    if "ownership" in out:
        own, summary = out["ownership"]["ownership"], out["ownership"]["summary"]
        lines.append("")
        lines.append(f"== 股权穿透（阈值 {summary['threshold_pct']}%"
                     + (f"，截至 {out['ownership']['as_of']}" if out["ownership"]["as_of"] else "") + "）==")
        upstream = sorted((k for k, v in own.items() if v["direction"] == "upstream"), key=lambda k: -own[k]["effective_pct"])
        downstream = sorted((k for k, v in own.items() if v["direction"] == "downstream" or "reverse" in v),
                            key=lambda k: -(own[k].get("reverse") or own[k])["effective_pct"])
        if upstream:
            lines.append("向上（持有根主体）：")
            for ident in upstream:
                r = own[ident]
                flags = [r["coverage"] == "partial" and "股东名单不完整", r["has_cycle"] and "含交叉持股",
                         r["effective_pct"] >= summary["threshold_pct"] and "达到阈值"]
                lines.append(f"  {name_of(entities, ident)}  穿透 {r['effective_pct']}%  直接 {r['direct_pct']}%"
                             + ("  [" + "、".join(f for f in flags if f) + "]" if any(flags) else ""))
                for path in r["paths"][:5]:
                    lines.append("    · " + " → ".join(entities.get(i, {}).get("name", i) for i in path["ids"]) + f" = {path['pct']}%")
        if downstream:
            lines.append("向下（根主体持有）：")
            for ident in downstream:
                r = own[ident].get("reverse") or own[ident]
                flags = [r["coverage"] == "partial" and "股东名单不完整", r["has_cycle"] and "含交叉持股"]
                lines.append(f"  {name_of(entities, ident)}  穿透 {r['effective_pct']}%  直接 {r['direct_pct']}%"
                             + ("  [" + "、".join(f for f in flags if f) + "]" if any(flags) else ""))
                for path in r["paths"][:5]:
                    lines.append("    · " + " → ".join(entities.get(i, {}).get("name", i) for i in path["ids"]) + f" = {path['pct']}%")
        if not own:
            lines.append("  未发现带比例的确认持股/投资关系。")
    if "co_occurrence" in out:
        co = out["co_occurrence"]
        lines.append("")
        lines.append(f"== 人物二跳共现：{name_of(entities, co['subject_id']) if co.get('subject_id') else '无可分析人物'} ==")
        if not co.get("rows"):
            lines.append("  未发现共同任职/持股的其他人物。")
        for row in co.get("rows", [])[:20]:
            lines.append(f"  {row['partner_name']}（{row['partner_id']}）  得分 {row['score']}  共同主体 {row['shared_count']}"
                         f"（存续/其他 {row['shared_active']}，注销/吊销 {row['shared_dissolved']}）"
                         + (f"  {row['first_seen']} — {row['last_seen']}" if row["first_seen"] else ""))
            for org in row["organizations"]:
                lines.append(f"    · {org['name']} [{org['registry_status']}]  本人：{org['subject_role']}  对方：{org['partner_role']}"
                             + ("  任期重叠" if org["overlap"] else ""))
    if "paths" in out:
        p = out["paths"]
        lines.append("")
        lines.append(f"== 关系路径：{name_of(entities, p['from'])} ↔ {name_of(entities, p['to'])}（最多 {p['max_hops']} 跳）==")
        if not p["results"]:
            lines.append("  在所选关系范围内未找到路径；可尝试 --include-historical / --include-signals / --include-candidates。")
        for index, path in enumerate(p["results"], 1):
            parts = [entities.get(path["ids"][0], {}).get("name", path["ids"][0])]
            for hop, nxt in zip(path["edges"], path["ids"][1:]):
                arrow = "→" if hop["forward"] else "←"
                tag = "" if hop["status"] == "current" and hop["edge_class"] == "fact" else f"·{hop['status'] if hop['status'] != 'current' else hop['edge_class']}"
                parts.append(f" {arrow}[{hop['label']}{tag}]{arrow} " + entities.get(nxt, {}).get("name", nxt))
            lines.append(f"  {index}. {path['hops']} 跳：" + "".join(parts))
    if "centrality" in out:
        lines.append("")
        lines.append("== 中心度（确认关系，前 8）==")
        ranked = sorted(out["centrality"].items(), key=lambda kv: (-kv[1]["betweenness"], -kv[1]["degree"]))[:8]
        for ident, c in ranked:
            lines.append(f"  {name_of(entities, ident)}  介数 {c['betweenness']}  度 {c['degree']}")
    if "confidence" in out:
        counts = {}
        for record in out["confidence"]["relationships"].values():
            counts[record["grade"]] = counts.get(record["grade"], 0) + 1
        lines.append("")
        lines.append("== 关系证据等级 ==")
        lines.append("  " + "；".join(f"{k} {v}" for k, v in sorted(counts.items())) if counts else "  无关系记录")
    return "\n".join(lines)


def main():
    nc.utf8_stdio()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dossier", type=Path, help="统一资料 JSON")
    parser.add_argument("--root", help="分析起点主体 ID（默认 meta.root_id）")
    parser.add_argument("--ownership", action="store_true", help="只输出股权穿透")
    parser.add_argument("--threshold", type=float, default=25.0, help="重要股东穿透比例阈值（%%，默认 25）")
    parser.add_argument("--as-of", help="按 valid_from/valid_to 只计该日期有效的持股关系（YYYY[-MM[-DD]]）")
    parser.add_argument("--cooccur", metavar="PERSON_ID", help="输出该人物的二跳共现伙伴矩阵")
    parser.add_argument("--path", nargs=2, metavar=("FROM_ID", "TO_ID"), help="查找两主体之间的最短关系路径")
    parser.add_argument("--max-hops", type=int, default=6, help="路径最大跳数（默认 6）")
    parser.add_argument("--limit", type=int, default=10, help="最多输出的等长最短路径数（默认 10）")
    parser.add_argument("--include-historical", action="store_true", help="路径与持股计算包含历史关系")
    parser.add_argument("--include-signals", action="store_true", help="路径包含信号边（共同地址、域名等）")
    parser.add_argument("--include-candidates", action="store_true", help="路径包含候选/争议关系")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--out", type=Path, help="写入文件而非标准输出")
    args = parser.parse_args()
    if args.max_hops < 1 or args.limit < 1:
        parser.error("--max-hops 与 --limit 须为正整数")
    try:
        out, _ = run(args)
        data = load_json(args.dossier)
        text = json.dumps(out, ensure_ascii=False, indent=2, allow_nan=False) if args.json else render_text(out, data)
    except (OSError, ValueError, TypeError, RecursionError) as exc:
        print("分析失败：" + str(exc), file=sys.stderr)
        return 2
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n", encoding="utf-8")
        print("已写入：" + str(args.out.resolve()))
    else:
        print(text)
    return 0 if out["validation"]["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
