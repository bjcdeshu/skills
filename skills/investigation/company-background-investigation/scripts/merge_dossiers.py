#!/usr/bin/env python3
"""Merge several case dossiers into one unified intelligence graph (stdlib only).

Rules:
* Entities merge ONLY on an exact identifier match: same normalized
  ``(scheme, value)`` in ``identifiers[]``.  Names alone never merge anything.
* People sharing a name plus at least two context anchors (shared organization,
  overlapping tenure, shared place/network) get a ``same_as_candidate`` signal
  edge for review, never an automatic merge.
* Colliding local IDs are namespaced as ``<case_slug>:<id>``; every reference
  (relationships, claims, evidence, sections, timeline ...) is rewritten.
* Sources are de-duplicated by normalized URL + locator; internal ``#source-``
  anchors stay case-local.
* ``x_cases`` keeps the provenance of merged entities, relationships and sources.
* Stored evidence and image paths are rebased to the output directory.

The output is a schema_version 1 dossier validated with validate_dossier.py.

Example:
  python merge_dossiers.py caseA/dossier.json caseB/dossier.json --out merged/dossier.json --report merged/report.json
"""

import argparse
import copy
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse

import network_core as nc
from validate_dossier import load_json, validate_dossier

ID_COLLECTIONS = ("entities", "sources", "assets", "claims", "evidence_manifest", "events",
                  "relationships", "sections", "questions", "archives", "findings")
LIST_REFS = {"sources": "sources", "source_ids": "sources", "entity_ids": "entities", "image_ids": "assets",
             "claim_ids": "claims", "input_claim_ids": "claims"}
ONE_REFS = {"from": "entities", "to": "entities", "source_id": "sources", "origin_id": "sources",
            "snapshot_id": "evidence_manifest", "parent_snapshot_id": "evidence_manifest", "event_id": "events"}
LIST_MERGE_KEYS = ("sources", "image_ids", "claim_ids", "aliases")
NESTED_MERGE_KEYS = ("fields", "facts", "career", "sections")


def slugify(text):
    slug = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")
    return slug[:40].strip("-")


def case_slug(path, index, used):
    path = Path(path)
    stem = path.stem
    base = slugify(path.resolve().parent.name if stem.lower() in {"dossier", "data", "index"} else stem)
    base = base or f"case{index + 1}"
    slug, n = base, 2
    while slug in used:
        slug, n = f"{base}-{n}", n + 1
    used.add(slug)
    return slug


def norm_identifier(item):
    if not isinstance(item, dict):
        return None
    scheme, value = item.get("scheme"), item.get("value")
    if not isinstance(scheme, str) or not isinstance(value, str) or not scheme.strip() or not value.strip():
        return None
    return scheme.strip().casefold(), re.sub(r"\s+", "", value).casefold()


def norm_name(text):
    return re.sub(r"[\s·•.\-_]+", "", str(text or "")).casefold()


def source_key(source, slug):
    url = source.get("url") if isinstance(source.get("url"), str) else ""
    locator = re.sub(r"\s+", " ", str(source.get("locator") or "")).strip().casefold()
    if not url or url.startswith("#"):
        return ("local", slug, url, locator)
    parts = urllib.parse.urlsplit(url.strip())
    host = (parts.hostname or "").casefold()
    if parts.port and not ((parts.scheme == "https" and parts.port == 443) or (parts.scheme == "http" and parts.port == 80)):
        host += f":{parts.port}"
    path = parts.path.rstrip("/") or "/"
    return ("url", parts.scheme.casefold(), host, path, parts.query, locator)


def rewrite(node, maps):
    if isinstance(node, dict):
        out = {}
        for key, value in node.items():
            if key in LIST_REFS and isinstance(value, list):
                mapped = [maps[LIST_REFS[key]].get(x, x) if isinstance(x, str) else x for x in value]
                out[key] = list(dict.fromkeys(mapped)) if all(isinstance(x, str) for x in mapped) else mapped
            elif key in ONE_REFS and isinstance(value, str):
                out[key] = maps[ONE_REFS[key]].get(value, value)
            else:
                out[key] = rewrite(value, maps)
        return out
    if isinstance(node, list):
        return [rewrite(item, maps) for item in node]
    return node


def rebase_path(raw, case_dir, out_dir):
    if not isinstance(raw, str) or not raw.strip():
        return raw
    candidate = Path(raw).expanduser()
    if candidate.is_absolute() or raw.startswith(("//", "\\\\")) or re.match(r"^[a-z][a-z0-9+.-]*:", raw, re.I):
        return raw
    absolute = (Path(case_dir) / candidate).resolve()
    try:
        return Path(os.path.relpath(absolute, out_dir)).as_posix()
    except ValueError:  # different drive on Windows
        return absolute.as_posix()


def _union(a, b):
    return list(dict.fromkeys([*(a or []), *(b or [])]))


def merge_entity(base, extra, report, case):
    for key, value in extra.items():
        if key == "id":
            continue
        current = base.get(key)
        if key not in base or current in (None, "", []):
            base[key] = copy.deepcopy(value)
        elif key in LIST_MERGE_KEYS and isinstance(current, list) and isinstance(value, list):
            base[key] = _union(current, value)
        elif key == "identifiers" and isinstance(current, list) and isinstance(value, list):
            seen = {norm_identifier(i) for i in current}
            base[key] = current + [i for i in value if norm_identifier(i) not in seen]
        elif key in NESTED_MERGE_KEYS and isinstance(current, list) and isinstance(value, list):
            known = {json.dumps(i, sort_keys=True, ensure_ascii=False) for i in current}
            base[key] = current + [i for i in value if json.dumps(i, sort_keys=True, ensure_ascii=False) not in known]
        elif key == "x_cases" and isinstance(current, list):
            base[key] = current + [c for c in value if c not in current]
        elif key == "name" and value != current:
            base["aliases"] = _union(base.get("aliases"), [value])
        elif key == "importance" and nc._finite(value) and nc._finite(current):
            base[key] = max(current, value)
        elif key == "type" and value != current:
            report["conflicts"].append({"entity_id": base["id"], "case": case, "field": "type",
                                        "kept": current, "ignored": value})


def merge(paths, out_path, root=None, title=None, force=False):
    out_path = Path(out_path).resolve()
    out_dir = out_path.parent
    merged = {key: [] for key in ID_COLLECTIONS}
    merged.update({"timeline": [], "metrics": []})
    used = {key: set() for key in ID_COLLECTIONS}
    ident_index, src_index, rel_index = {}, {}, {}
    by_id = {key: {} for key in ID_COLLECTIONS}
    report = {"cases": [], "merged_entities": [], "renamed_ids": [], "deduplicated_sources": [],
              "deduplicated_relationships": [], "same_as_candidates": [], "conflicts": [], "dropped": []}
    slugs, metas, case_maps = set(), [], {}

    def allocate(kind, ident, slug):
        new = ident if ident not in used[kind] else f"{slug}:{ident}"
        n = 2
        while new in used[kind]:
            new, n = f"{slug}:{ident}-{n}", n + 1
        used[kind].add(new)
        if new != ident:
            report["renamed_ids"].append({"case": slug, "kind": kind, "from": ident, "to": new})
        return new

    for index, raw_path in enumerate(paths):
        path = Path(raw_path).resolve()
        data = load_json(path)
        check = validate_dossier(data, path.parent)
        if not check["ok"] and not force:
            first = check["errors"][0]
            raise ValueError(f"{path} 未通过结构验证（{len(check['errors'])} 个错误，首个：{first['path']} {first['message']}）；修正后再合并或使用 --force")
        slug = case_slug(path, index, slugs)
        meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
        metas.append((slug, path, meta))
        for key in ("revision", "role_assessment"):
            if key in data:
                report["dropped"].append({"case": slug, "field": key, "reason": "案件专属字段，合并图不继承"})
        maps = {key: {} for key in ID_COLLECTIONS}
        # 1) decide every ID first so forward references resolve.
        for entity in nc._rows(data, "entities"):
            old = entity.get("id")
            if not isinstance(old, str):
                continue
            keys = [k for k in map(norm_identifier, entity.get("identifiers") or []) if k]
            target = next((ident_index[k] for k in keys if k in ident_index), None)
            if target is None:
                target = allocate("entities", old, slug)
            else:
                hit = next(k for k in keys if k in ident_index)
                report["merged_entities"].append({"merged_id": target, "case": slug, "original_id": old,
                                                  "identifier": f"{hit[0]}={hit[1]}"})
            for k in keys:
                ident_index.setdefault(k, target)
            maps["entities"][old] = target
        for source in nc._rows(data, "sources"):
            old = source.get("id")
            if not isinstance(old, str):
                continue
            key = source_key(source, slug)
            if key in src_index:
                maps["sources"][old] = src_index[key]
                report["deduplicated_sources"].append({"case": slug, "original_id": old, "merged_id": src_index[key]})
            else:
                maps["sources"][old] = src_index[key] = allocate("sources", old, slug)
        for kind in ("assets", "claims", "evidence_manifest", "events", "sections", "questions", "archives", "findings"):
            for row in nc._rows(data, kind):
                if isinstance(row.get("id"), str):
                    maps[kind][row["id"]] = allocate(kind, row["id"], slug)
        case_maps[slug] = maps
        # 2) rewrite and insert.
        for entity in nc._rows(data, "entities"):
            if not isinstance(entity.get("id"), str):
                continue
            row = rewrite(entity, maps)
            row["id"] = maps["entities"][entity["id"]]
            row["x_cases"] = [{"case": slug, "id": entity["id"]}]
            if row["id"] in by_id["entities"]:
                merge_entity(by_id["entities"][row["id"]], row, report, slug)
            else:
                by_id["entities"][row["id"]] = row
                merged["entities"].append(row)
        for source in nc._rows(data, "sources"):
            if not isinstance(source.get("id"), str):
                continue
            target = maps["sources"][source["id"]]
            if target in by_id["sources"]:
                existing = by_id["sources"][target]
                existing["x_cases"] = existing.get("x_cases", []) + [{"case": slug, "id": source["id"]}]
                continue
            row = rewrite(source, maps)
            row["id"] = target
            row["x_cases"] = [{"case": slug, "id": source["id"]}]
            by_id["sources"][target] = row
            merged["sources"].append(row)
        for rel in nc._rows(data, "relationships"):
            row = rewrite(rel, maps)
            key = tuple(json.dumps(row.get(k), ensure_ascii=False, sort_keys=True)
                        for k in ("from", "to", "type", "label", "percent", "status", "edge_class",
                                  "valid_from", "valid_to", "date", "amount"))
            provenance = {"case": slug, "id": rel.get("id")}
            if key in rel_index:
                existing = rel_index[key]
                for field in ("sources", "claim_ids"):
                    if isinstance(row.get(field), list):
                        existing[field] = _union(existing.get(field), row[field])
                existing["x_cases"] = existing.get("x_cases", []) + [provenance]
                report["deduplicated_relationships"].append({"case": slug, "original_id": rel.get("id"),
                                                             "merged_id": existing.get("id")})
                continue
            if isinstance(rel.get("id"), str):
                row["id"] = allocate("relationships", rel["id"], slug)
            row["x_cases"] = [provenance]
            rel_index[key] = row
            merged["relationships"].append(row)
        for kind in ("assets", "claims", "evidence_manifest", "events", "sections", "questions", "archives", "findings"):
            for item in nc._rows(data, kind):
                row = rewrite(item, maps)
                if isinstance(item.get("id"), str):
                    row["id"] = maps[kind][item["id"]]
                if kind in ("assets", "evidence_manifest") and row.get("path") is not None and not row.get("data_uri"):
                    row["path"] = rebase_path(row["path"], path.parent, out_dir)
                merged[kind].append(row)
        for item in nc._rows(data, "timeline"):
            row = rewrite(item, maps)
            row["x_case"] = slug
            merged["timeline"].append(row)
        seen_metrics = {(m.get("label"), m.get("value")) for m in merged["metrics"]}
        for item in nc._rows(data, "metrics"):
            row = rewrite(item, maps)
            if (row.get("label"), row.get("value")) not in seen_metrics:
                row["x_case"] = slug
                merged["metrics"].append(row)
        report["cases"].append({"case": slug, "file": str(path), "root_id": meta.get("root_id"),
                                "merged_root_id": maps["entities"].get(meta.get("root_id")),
                                "as_of": meta.get("as_of"), "title": meta.get("title"),
                                "validation_ok": check["ok"]})

    add_same_as_candidates(merged, report)

    # Root and meta.
    roots = [c["merged_root_id"] for c in report["cases"] if c["merged_root_id"]]
    if root:
        if root in by_id["entities"]:
            root_id = root
        else:
            hits = {m["entities"][root] for m in case_maps.values() if root in m["entities"]}
            if len(hits) != 1:
                raise ValueError(f"--root {root} 无法唯一对应合并后的主体")
            root_id = hits.pop()
    elif roots:
        root_id = roots[0]
    else:
        raise ValueError("没有可用的根主体")
    core = [root_id] + roots
    for slug, _, meta in metas:
        core += [case_maps[slug]["entities"].get(i) for i in meta.get("core_ids", []) if isinstance(i, str)]
    as_of_values = [m.get("as_of") for _, _, m in metas if isinstance(m.get("as_of"), str)]
    snapshot_values = [m.get("snapshot_at") for _, _, m in metas if isinstance(m.get("snapshot_at"), str)]
    root_entity = by_id["entities"][root_id]
    titles = [m.get("title") for _, _, m in metas if isinstance(m.get("title"), str)]
    out_meta = {
        "title": title or ("跨案统一情报图｜" + root_entity.get("name", root_id)),
        "subtitle": f"由 {len(metas)} 份调查合并：" + "；".join(titles[:4]),
        "root_id": root_id,
        "root_type": root_entity.get("type"),
        "as_of": max(as_of_values, key=lambda d: nc._date_bound(d) or "") if as_of_values else dt.date.today().isoformat(),
        "summary": f"合并 {len(metas)} 份调查：按登记号等精确标识合并 {len(report['merged_entities'])} 个主体，"
                   f"同名人物仅以待核信号边提示（{len(report['same_as_candidates'])} 条），不作自动合并。",
        "core_ids": list(dict.fromkeys(i for i in core if isinstance(i, str) and i in by_id["entities"])),
        "language": next((m.get("language") for _, _, m in metas if m.get("language")), "zh-CN"),
    }
    if snapshot_values:
        out_meta["snapshot_at"] = max(snapshot_values, key=lambda d: nc._date_bound(d) or "")
    result = {"schema_version": 1, "meta": out_meta}
    for key in ("entities", "relationships", "sources", "assets", "findings", "sections", "questions",
                "archives", "timeline", "claims", "evidence_manifest", "events", "metrics"):
        if merged.get(key) or key in ("entities", "relationships", "sources"):
            result[key] = merged[key]
    result["x_merge"] = {"generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                         "cases": [{k: c[k] for k in ("case", "file", "root_id", "merged_root_id", "as_of")}
                                   for c in report["cases"]]}
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    check = validate_dossier(result, out_dir)
    report["output"] = str(out_path)
    report["validation"] = {"ok": check["ok"], "errors": check["errors"], "warnings": len(check["warnings"]),
                            "counts": check["counts"]}
    return result, report


def add_same_as_candidates(merged, report):
    entities = {e["id"]: e for e in merged["entities"]}
    view = {"entities": merged["entities"], "relationships": merged["relationships"], "sources": merged["sources"]}
    sources = set(nc.source_index(view))
    neighbors, intervals = {}, {}
    for rel in merged["relationships"]:
        a, b = rel.get("from"), rel.get("to")
        if a not in entities or b not in entities or not nc.is_confirmed(rel, sources):
            continue
        neighbors.setdefault(a, set()).add(b)
        neighbors.setdefault(b, set()).add(a)
        for ident in (a, b):
            intervals.setdefault(ident, []).append(nc._interval(rel))
    people = [e for e in merged["entities"] if e.get("type") == "person"]
    existing = {frozenset((r.get("from"), r.get("to"))) for r in merged["relationships"]
                if r.get("type") == "same_as_candidate"}
    counter = 0

    def names(entity):
        return {norm_name(entity.get("name"))} | {norm_name(a) for a in entity.get("aliases") or [] if isinstance(a, str)}

    def org_names(ident):
        return {norm_name(entities[n].get("name")) for n in neighbors.get(ident, ()) if entities[n].get("type") != "person"}

    def second_hop_people(ident):
        found = set()
        for org in neighbors.get(ident, ()):
            if entities[org].get("type") == "person":
                found.add(norm_name(entities[org].get("name")))
                continue
            for other in neighbors.get(org, ()):
                if other != ident and entities[other].get("type") == "person":
                    found.add(norm_name(entities[other].get("name")))
        return found

    def field_pairs(entity):
        return {(norm_name(f.get("label")), norm_name(f.get("value"))) for f in entity.get("fields") or []
                if isinstance(f, dict) and isinstance(f.get("value"), str) and f.get("value").strip()}

    for i, p in enumerate(people):
        for q in people[i + 1:]:
            cases_p = {c.get("case") for c in p.get("x_cases", [])}
            cases_q = {c.get("case") for c in q.get("x_cases", [])}
            if cases_p & cases_q or frozenset((p["id"], q["id"])) in existing:
                continue
            shared_names = (names(p) & names(q)) - {""}
            if not shared_names:
                continue
            anchors = {}
            anchors["organization"] = bool((neighbors.get(p["id"], set()) & neighbors.get(q["id"], set()))
                                           or (org_names(p["id"]) & org_names(q["id"]) - {""}))
            anchors["time"] = any(nc._overlaps(x, y) for x in intervals.get(p["id"], []) for y in intervals.get(q["id"], []))
            own_names = names(p) | names(q)
            anchors["place_or_network"] = bool(((second_hop_people(p["id"]) & second_hop_people(q["id"])) - own_names - {""})
                                               or (field_pairs(p) & field_pairs(q)))
            matched = [k for k, v in anchors.items() if v]
            entry = {"from": p["id"], "to": q["id"], "name": p.get("name"), "anchors": anchors}
            if len(matched) < 2:
                entry["action"] = "none"
                report["same_as_candidates"].append(entry)
                continue
            refs = list(dict.fromkeys([*(p.get("sources") or [])[:1], *(q.get("sources") or [])[:1]]))
            refs = [r for r in refs if r in sources]
            if not refs:
                entry["action"] = "skipped_no_source"
                report["same_as_candidates"].append(entry)
                continue
            counter += 1
            rel_id = f"rel-merge-same-as-{counter}"
            while any(r.get("id") == rel_id for r in merged["relationships"]):
                counter += 1
                rel_id = f"rel-merge-same-as-{counter}"
            labels = {"organization": "机构", "time": "时间", "place_or_network": "地域/关系网"}
            merged["relationships"].append({
                "id": rel_id, "from": p["id"], "to": q["id"], "type": "same_as_candidate",
                "label": "疑似同一人物（待核）", "status": "candidate", "edge_class": "signal",
                "signal_key": "name:" + sorted(shared_names)[0],
                "detail": "跨案合并时发现同名，且" + "、".join(labels[k] for k in matched)
                          + "锚点一致；尚无登记号或本人/雇主材料直接确认，保留为两个主体。",
                "sources": refs,
                "x_cases": [{"case": c, "id": None} for c in sorted(cases_p | cases_q)],
            })
            entry["action"] = "candidate_edge"
            entry["relationship_id"] = rel_id
            report["same_as_candidates"].append(entry)


def main():
    nc.utf8_stdio()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dossiers", nargs="+", type=Path, help="待合并的调查 JSON（至少两份）")
    parser.add_argument("--out", required=True, type=Path, help="合并后的 dossier JSON")
    parser.add_argument("--report", type=Path, help="合并报告 JSON（可选）")
    parser.add_argument("--root", help="合并图的根主体（合并后 ID、原始 ID 或 case:id）")
    parser.add_argument("--title", help="合并图标题")
    parser.add_argument("--force", action="store_true", help="输入未通过结构验证时仍尝试合并")
    args = parser.parse_args()
    if len(args.dossiers) < 2:
        parser.error("至少需要两份调查 JSON")
    resolved = [p.resolve() for p in args.dossiers]
    if args.out.resolve() in resolved:
        parser.error("输出路径不能覆盖输入文件")
    try:
        _, report = merge(args.dossiers, args.out, args.root, args.title, args.force)
    except (OSError, ValueError, TypeError, RecursionError) as exc:
        print("合并失败：" + str(exc), file=sys.stderr)
        return 2
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    v = report["validation"]
    print(f"已合并 {len(report['cases'])} 份调查 → {report['output']}")
    print(f"  标识合并主体 {len(report['merged_entities'])}；重命名 ID {len(report['renamed_ids'])}；"
          f"去重来源 {len(report['deduplicated_sources'])}；去重关系 {len(report['deduplicated_relationships'])}；"
          f"同名待核信号边 {sum(c.get('action') == 'candidate_edge' for c in report['same_as_candidates'])}")
    print("  结构验证：" + ("通过" if v["ok"] else "未通过") + f"（错误 {len(v['errors'])}，警告 {v['warnings']}）")
    for item in v["errors"][:10]:
        print(f"  错误 [{item['code']}] {item['path']}: {item['message']}")
    return 0 if v["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
