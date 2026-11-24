#!/usr/bin/env python3
"""Track changes between two versions of a dossier (Python 3.10+ stdlib only).

Compares entities, relationships (including percent and status shifts),
claims, sources, metrics, evidence and narrative records.  Removals declared in
the new version's ``revision.retired_ids`` are reported as retired; other
removals are flagged as unexplained.  Relationships whose ID changed are
re-matched by their semantic key (from, to, type).

Examples:
  python diff_dossier.py old.json new.json
  python diff_dossier.py old.json new.json --md --out changes.md
  python diff_dossier.py old.json new.json --json
"""

import argparse
import json
from pathlib import Path
import sys

import network_core as nc
from validate_dossier import load_json

TRACKED = ("entities", "relationships", "claims", "sources", "assets", "evidence_manifest",
           "sections", "questions", "archives", "findings", "events")
KIND_ALIASES = {"entity": "entities", "relationship": "relationships", "source": "sources", "asset": "assets",
                "section": "sections", "question": "questions", "archive": "archives", "claim": "claims",
                "snapshot": "evidence_manifest", "finding": "findings", "event": "events"}
LABELS = {"entities": "主体", "relationships": "关系", "claims": "主张", "sources": "来源", "assets": "图片",
          "evidence_manifest": "证据留存", "sections": "章节", "questions": "问题", "archives": "档案",
          "findings": "关键判断", "events": "事件", "metrics": "指标", "timeline": "时间线"}
WATCH = {
    "entities": ("name", "type", "status", "registry_status", "role", "summary", "aliases", "identifiers"),
    "relationships": ("from", "to", "type", "label", "status", "edge_class", "percent", "amount", "currency",
                      "role", "role_code", "valid_from", "valid_to", "date", "nature", "disputed"),
    "claims": ("text", "kind", "status", "as_of", "effective_at", "published_at", "accessed_at", "source_ids"),
    "sources": ("title", "url", "kind", "status", "observed_at", "published_at", "locator"),
}
VOLATILE = {"x_cases"}


def label(record):
    for key in ("name", "title", "label", "question", "text"):
        if isinstance(record.get(key), str) and record[key].strip():
            text = record[key].strip()
            return text if len(text) <= 60 else text[:57] + "…"
    return record.get("id", "")


def index(data, kind):
    return {r["id"]: r for r in nc._rows(data, kind) if isinstance(r.get("id"), str)}


def changed_fields(old, new, kind):
    keys = WATCH.get(kind)
    if keys is None:
        keys = sorted((set(old) | set(new)) - {"id"} - VOLATILE)
    changes = {}
    for key in keys:
        if old.get(key) != new.get(key):
            changes[key] = [old.get(key), new.get(key)]
    if kind in WATCH:
        others = sorted(k for k in (set(old) | set(new)) - set(keys) - {"id"} - VOLATILE if old.get(k) != new.get(k))
        if others:
            changes["_other_fields"] = others
    return changes


def diff(old, new):
    retired = {}
    revision = new.get("revision") if isinstance(new.get("revision"), dict) else {}
    for item in revision.get("retired_ids", []) if isinstance(revision.get("retired_ids"), list) else []:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            kind = KIND_ALIASES.get(item.get("kind"), item.get("kind"))
            retired[(kind, item["id"])] = item
    result = {"meta": {}, "collections": {}, "highlights": [], "summary": {}}
    old_meta = old.get("meta") if isinstance(old.get("meta"), dict) else {}
    new_meta = new.get("meta") if isinstance(new.get("meta"), dict) else {}
    for key in ("title", "root_id", "root_type", "as_of", "snapshot_at", "generated_at", "summary"):
        if old_meta.get(key) != new_meta.get(key):
            result["meta"][key] = [old_meta.get(key), new_meta.get(key)]
    if revision:
        result["revision"] = {"kind": revision.get("kind"), "retired": len(retired)}
    old_entities, new_entities = index(old, "entities"), index(new, "entities")

    def name(ident):
        return (new_entities.get(ident) or old_entities.get(ident) or {}).get("name", ident)

    for kind in TRACKED:
        before, after = index(old, kind), index(new, kind)
        added = sorted(set(after) - set(before))
        removed = sorted(set(before) - set(after))
        rekeyed = []
        if kind == "relationships":
            def sem(r):
                return (r.get("from"), r.get("to"), r.get("type"))
            pool = {}
            for ident in added:
                pool.setdefault(sem(after[ident]), []).append(ident)
            still_removed = []
            for ident in removed:
                bucket = pool.get(sem(before[ident]))
                if bucket and (kind, ident) not in retired:
                    match = bucket.pop(0)
                    rekeyed.append({"old_id": ident, "new_id": match,
                                    "changes": changed_fields(before[ident], after[match], kind)})
                    added.remove(match)
                else:
                    still_removed.append(ident)
            removed = still_removed
        changed = []
        for ident in sorted(set(before) & set(after)):
            fields = changed_fields(before[ident], after[ident], kind)
            if fields:
                changed.append({"id": ident, "label": label(after[ident]), "changes": fields})
        section = {
            "added": [{"id": i, "label": label(after[i])} for i in added],
            "removed_retired": [{"id": i, "label": label(before[i]), "reason": retired[(kind, i)].get("reason"),
                                 "replacement_id": retired[(kind, i)].get("replacement_id")}
                                for i in removed if (kind, i) in retired],
            "removed_unexplained": [{"id": i, "label": label(before[i])} for i in removed if (kind, i) not in retired],
            "changed": changed,
        }
        if rekeyed:
            section["rekeyed"] = rekeyed
        if any(section.values()):
            result["collections"][kind] = section
        result["summary"][kind] = {"added": len(section["added"]), "changed": len(changed),
                                   "removed": len(removed), "unexplained_removals": len(section["removed_unexplained"])}
        # Highlights: equity and status shifts people actually need to read.
        if kind == "relationships":
            pairs = [(c["id"], before[c["id"]], after[c["id"]], c["changes"]) for c in changed]
            pairs += [(r["new_id"], before[r["old_id"]], after[r["new_id"]], r["changes"]) for r in rekeyed]
            for ident, b, a, ch in pairs:
                arrow = f"{name(a.get('from'))} → {name(a.get('to'))}"
                if "percent" in ch:
                    result["highlights"].append({"kind": "percent", "id": ident, "text": f"{arrow}：持股/比例 {b.get('percent')}% → {a.get('percent')}%"})
                if "status" in ch:
                    result["highlights"].append({"kind": "relationship_status", "id": ident, "text": f"{arrow}（{a.get('label')}）：状态 {b.get('status') or 'current'} → {a.get('status') or 'current'}"})
                if "edge_class" in ch:
                    result["highlights"].append({"kind": "edge_class", "id": ident, "text": f"{arrow}：关系类别 {b.get('edge_class') or 'fact'} → {a.get('edge_class') or 'fact'}"})
            for item in section["added"]:
                a = after[item["id"]]
                if a.get("percent") is not None:
                    result["highlights"].append({"kind": "new_holding", "id": item["id"], "text": f"新增：{name(a.get('from'))} → {name(a.get('to'))} {a.get('percent')}%（{a.get('label')}）"})
        if kind == "entities":
            for c in changed:
                for field in ("status", "registry_status"):
                    if field in c["changes"]:
                        b, a = c["changes"][field]
                        result["highlights"].append({"kind": field, "id": c["id"], "text": f"{c['label']}：{'登记状态' if field == 'registry_status' else '状态'} {b or '—'} → {a or '—'}"})
            for item in section["added"]:
                result["highlights"].append({"kind": "new_entity", "id": item["id"], "text": f"新增主体：{item['label']}（{after[item['id']].get('type')}）"})
        for item in section["removed_unexplained"]:
            result["highlights"].append({"kind": "unexplained_removal", "id": item["id"], "text": f"{LABELS[kind]}消失且未在 revision.retired_ids 说明：{item['id']}"})
    # Metrics are keyed by label (no IDs in the model).
    old_metrics = {m.get("label"): m for m in nc._rows(old, "metrics")}
    new_metrics = {m.get("label"): m for m in nc._rows(new, "metrics")}
    metric_changes = {
        "added": sorted(k for k in new_metrics if k not in old_metrics and isinstance(k, str)),
        "removed": sorted(k for k in old_metrics if k not in new_metrics and isinstance(k, str)),
        "changed": [{"label": k, "value": [old_metrics[k].get("value"), new_metrics[k].get("value")],
                     "detail": [old_metrics[k].get("detail"), new_metrics[k].get("detail")]}
                    for k in sorted(k for k in old_metrics if k in new_metrics and isinstance(k, str))
                    if (old_metrics[k].get("value"), old_metrics[k].get("detail")) != (new_metrics[k].get("value"), new_metrics[k].get("detail"))],
    }
    if any(metric_changes.values()):
        result["collections"]["metrics"] = metric_changes
        for m in metric_changes["changed"]:
            result["highlights"].append({"kind": "metric", "id": m["label"], "text": f"指标 {m['label']}：{m['value'][0]} → {m['value'][1]}"})
    result["summary"]["metrics"] = {k: len(v) for k, v in metric_changes.items()}
    old_tl = {json.dumps(t, sort_keys=True, ensure_ascii=False) for t in nc._rows(old, "timeline")}
    new_tl = {json.dumps(t, sort_keys=True, ensure_ascii=False) for t in nc._rows(new, "timeline")}
    result["summary"]["timeline"] = {"added": len(new_tl - old_tl), "removed": len(old_tl - new_tl)}
    result["unexplained_removals"] = sum(s.get("unexplained_removals", 0) for s in result["summary"].values())
    return result


def render(result, markdown=False):
    h2, h3, bullet = ("## ", "### ", "- ") if markdown else ("== ", "-- ", "  · ")
    lines = ["# 调查数据变更" if markdown else "调查数据变更", ""]
    if result["meta"]:
        lines.append(h2 + "元数据")
        for key, (a, b) in result["meta"].items():
            lines.append(f"{bullet}{key}：{a} → {b}")
        lines.append("")
    lines.append(h2 + "重点变化")
    if result["highlights"]:
        lines += [bullet + h["text"] for h in result["highlights"]]
    else:
        lines.append(bullet + "无关键权益、状态或指标变化")
    lines.append("")
    lines.append(h2 + "数量汇总")
    if markdown:
        lines += ["| 集合 | 新增 | 修改 | 移除 | 未说明移除 |", "| --- | --- | --- | --- | --- |"]
    for kind, s in result["summary"].items():
        if kind in ("metrics", "timeline"):
            continue
        if markdown:
            lines.append(f"| {LABELS[kind]} | {s['added']} | {s['changed']} | {s['removed']} | {s['unexplained_removals']} |")
        elif any(s.values()):
            lines.append(f"{bullet}{LABELS[kind]}：新增 {s['added']}，修改 {s['changed']}，移除 {s['removed']}（未说明 {s['unexplained_removals']}）")
    t = result["summary"]["timeline"]
    lines.append(("" if markdown else bullet) + f"时间线：新增 {t['added']}，移除 {t['removed']}")
    for kind, section in result["collections"].items():
        if kind == "metrics":
            continue
        lines.append("")
        lines.append(h3 + LABELS[kind])
        for item in section.get("added", []):
            lines.append(f"{bullet}新增 `{item['id']}` {item['label']}" if markdown else f"{bullet}新增 {item['id']} {item['label']}")
        for item in section.get("changed", []):
            fields = ", ".join(k for k in item["changes"] if k != "_other_fields")
            others = item["changes"].get("_other_fields")
            text = fields + (("；其他字段 " + ", ".join(others)) if others else "")
            lines.append(f"{bullet}修改 {item['id']}：{text}")
        for item in section.get("rekeyed", []):
            lines.append(f"{bullet}ID 变更 {item['old_id']} → {item['new_id']}")
        for item in section.get("removed_retired", []):
            lines.append(f"{bullet}已声明退出 {item['id']}：{item['reason']}" + (f"（替代 {item['replacement_id']}）" if item.get("replacement_id") else ""))
        for item in section.get("removed_unexplained", []):
            lines.append(f"{bullet}⚠ 未说明移除 {item['id']} {item['label']}")
    return "\n".join(lines).rstrip() + "\n"


def main():
    nc.utf8_stdio()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("old", type=Path, help="旧版 dossier JSON")
    parser.add_argument("new", type=Path, help="新版 dossier JSON")
    fmt = parser.add_mutually_exclusive_group()
    fmt.add_argument("--json", action="store_true", help="输出 JSON")
    fmt.add_argument("--md", action="store_true", help="输出 Markdown")
    parser.add_argument("--out", type=Path, help="写入文件而非标准输出")
    parser.add_argument("--fail-on-unexplained", action="store_true", help="存在未说明的移除时返回 1")
    args = parser.parse_args()
    try:
        result = diff(load_json(args.old), load_json(args.new))
    except (OSError, ValueError, TypeError, RecursionError) as exc:
        print("比较失败：" + str(exc), file=sys.stderr)
        return 2
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n" if args.json else render(result, args.md)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
        print("已写入：" + str(args.out.resolve()))
    else:
        sys.stdout.write(text)
    return 1 if args.fail_on_unexplained and result["unexplained_removals"] else 0


if __name__ == "__main__":
    sys.exit(main())
