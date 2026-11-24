#!/usr/bin/env python3
"""Shared, dependency-free graph analytics for dossier JSON (Python 3.10+ stdlib).

The functions here only read a dossier; they never mutate it.  Everything is
derived from the single data source so that report, CLI tools and tests share
one implementation:

* edge classification (confirmed fact / signal / derived / candidate / disputed)
* penetrating (look-through) ownership with multi-path sums and a cycle guard
* two-hop person co-occurrence scoring over active and dissolved organizations
* evidence confidence grades with repost (``origin_id``) collapsing
* degree and betweenness centrality
* shortest A<->B relationship paths that keep each edge's original direction

``compute_analytics(data)`` returns the ``__computed`` payload embedded by
``build_report.py`` and consumed by ``assets/report.js``.
"""

from __future__ import annotations

from collections import deque
import io
import math
import re
import sys

ANALYTICS_VERSION = 1

EDGE_CLASSES = {"fact", "signal", "derived"}
REGISTRY_STATUSES = {"active", "dissolved", "revoked", "deregistered", "unknown"}
DISSOLVED_STATUSES = {"dissolved", "revoked", "deregistered"}
CANDIDATE_TYPES = {"candidate", "same_as_candidate"}
OWNERSHIP_TYPES = {"ownership", "investment", "shareholding", "equity"}
STRONG_SOURCE_KINDS = {"registry", "court", "official"}

ROLE_CODES = {
    "founder", "shareholder", "director", "supervisor", "executive", "legal_rep",
    "gp", "lp", "partner", "employee", "advisor", "auditor", "agent", "other",
}
ROLE_WEIGHTS = {
    "founder": 1.0, "shareholder": 0.9, "gp": 0.9, "legal_rep": 0.9,
    "director": 0.8, "executive": 0.8, "supervisor": 0.7, "partner": 0.7,
    "lp": 0.6, "employee": 0.5, "auditor": 0.4, "agent": 0.4, "advisor": 0.4,
    "other": 0.5,
}
# Generic, industry-neutral title keywords (Chinese + English) used only when a
# relationship has no explicit role_code.  Order matters: first match wins.
ROLE_KEYWORDS = (
    ("legal_rep", ("法定代表人", "法人代表", "legal representative", "legal rep")),
    ("gp", ("执行事务合伙人", "普通合伙人", "general partner", "managing partner")),
    ("lp", ("有限合伙人", "limited partner")),
    ("founder", ("联合创始", "创始", "创办", "co-founder", "cofounder", "founder")),
    ("supervisor", ("监事", "supervisor", "supervisory")),
    ("director", ("董事", "理事", "director", "board member", "chairman", "chairperson")),
    ("executive", ("总经理", "经理", "总裁", "财务负责人", "财务总监", "负责人", "首席", "主管",
                   "ceo", "cfo", "cto", "coo", "president", "executive", "officer", "manager", "head of")),
    ("shareholder", ("股东", "出资", "持股", "shareholder", "stockholder", "equity holder")),
    ("advisor", ("顾问", "advisor", "adviser", "consultant")),
    ("employee", ("员工", "雇员", "工程师", "employee", "engineer", "staff")),
)
TYPE_ROLE_DEFAULTS = {
    "ownership": "shareholder", "investment": "shareholder", "shareholding": "shareholder",
    "equity": "shareholder", "co_founding": "founder", "founding": "founder", "creation": "founder",
    "officer": "executive", "directorship": "director", "legal_representative": "legal_rep",
    "employment": "employee", "partnership": "partner", "fund_manager": "gp",
}

MAX_PATH_DEPTH = 12
MAX_STORED_PATHS = 64
MAX_ENUMERATION_STEPS = 200_000


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def utf8_stdio():
    """Make CLI output UTF-8 clean on Windows consoles and pipes."""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name)
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, io.UnsupportedOperation):
            pass


def _rows(data, key):
    value = data.get(key, []) if isinstance(data, dict) else []
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _ids(value):
    return [x for x in value if isinstance(x, str)] if isinstance(value, list) else []


def round_num(value, digits=4):
    rounded = round(float(value), digits)
    return 0.0 if rounded == 0 else rounded


def entity_index(data):
    return {row["id"]: row for row in _rows(data, "entities") if isinstance(row.get("id"), str)}


def source_index(data):
    return {row["id"]: row for row in _rows(data, "sources") if isinstance(row.get("id"), str)}


def edge_class(rel):
    value = rel.get("edge_class")
    return value if isinstance(value, str) and value in EDGE_CLASSES else "fact"


def is_candidate(rel):
    return rel.get("status") == "candidate" or rel.get("type") in CANDIDATE_TYPES


def is_disputed(rel):
    return rel.get("status") == "disputed" or rel.get("disputed") is True


def is_signal(rel):
    return edge_class(rel) == "signal"


def is_confirmed(rel, source_ids=None):
    """A sourced, non-candidate, non-disputed fact edge (signal/derived excluded)."""
    if is_candidate(rel) or is_disputed(rel) or edge_class(rel) != "fact":
        return False
    refs = rel.get("sources")
    if not isinstance(refs, list) or not refs:
        return False
    if source_ids is not None and not all(isinstance(x, str) and x in source_ids for x in refs):
        return False
    return True


def is_dissolved(entity):
    return isinstance(entity, dict) and entity.get("registry_status") in DISSOLVED_STATUSES


def valid_relationships(data):
    """Relationships whose endpoints exist, in document order."""
    entities = entity_index(data)
    return [rel for rel in _rows(data, "relationships")
            if isinstance(rel.get("from"), str) and isinstance(rel.get("to"), str)
            and rel["from"] in entities and rel["to"] in entities]


def _date_bound(value, upper=False):
    """Normalize YYYY / YYYY-MM / YYYY-MM-DD / ISO timestamps to a comparable YYYY-MM-DD."""
    if not isinstance(value, str):
        return None
    match = re.match(r"^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?", value.strip())
    if not match:
        return None
    year, month, day = match.group(1), match.group(2), match.group(3)
    if month is None:
        month, day = ("12", "31") if upper else ("01", "01")
    elif day is None:
        day = "31" if upper else "01"
    return f"{year}-{month}-{day}"


def _active_on(rel, as_of):
    if not as_of:
        return True
    point = _date_bound(as_of)
    start = _date_bound(rel.get("valid_from") or rel.get("date"))
    end = _date_bound(rel.get("valid_to"), upper=True)
    if point is None:
        return True
    if start and start > point:
        return False
    if end and end < point:
        return False
    return True


def _interval(rel):
    start = _date_bound(rel.get("valid_from") or rel.get("date"))
    end = _date_bound(rel.get("valid_to"), upper=True)
    if end is None and rel.get("status") == "historical" and start is not None:
        end = _date_bound(rel.get("valid_from") or rel.get("date"), upper=True)
    return start, end


def _overlaps(a, b):
    """True/False when both starts are known, otherwise None (unknown)."""
    (s1, e1), (s2, e2) = a, b
    if s1 is None or s2 is None:
        return None
    return max(s1, s2) <= min(e1 or "9999-12-31", e2 or "9999-12-31")


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

def infer_role_code(rel):
    code = rel.get("role_code")
    if isinstance(code, str) and code.strip():
        return code.strip()
    text = " ".join(str(rel.get(k) or "") for k in ("role", "label")).lower()
    for role, words in ROLE_KEYWORDS:
        if any(word in text for word in words):
            return role
    return TYPE_ROLE_DEFAULTS.get(rel.get("type"), "other")


def role_weight(code):
    return ROLE_WEIGHTS.get(code, ROLE_WEIGHTS["other"])


def role_text(rel):
    for key in ("role", "label"):
        value = rel.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return infer_role_code(rel)


# ---------------------------------------------------------------------------
# Penetrating ownership
# ---------------------------------------------------------------------------

def _edge_rank(rel):
    return (_date_bound(rel.get("valid_from") or rel.get("date")) or "", float(rel.get("percent") or 0))


def holding_edges(data, as_of=None, include_historical=False):
    """Representative holder->target equity edge per pair: ``{(from, to): rel}``.

    Uses confirmed fact edges of an equity type (or ``nature: capital``) carrying a
    0<percent<=100.  Several facts for the same pair (e.g. subscribed vs. paid-in,
    different snapshots) are not summed; the latest-dated, then largest, is used.
    """
    sources = set(source_index(data))
    chosen = {}
    for rel in valid_relationships(data):
        equity = rel.get("type") in OWNERSHIP_TYPES or rel.get("nature") == "capital"
        pct = rel.get("percent")
        if not equity or not _finite(pct) or not 0 < pct <= 100:
            continue
        if rel["from"] == rel["to"] or not is_confirmed(rel, sources):
            continue
        if rel.get("status") == "historical" and not include_historical:
            continue
        if not _active_on(rel, as_of):
            continue
        key = (rel["from"], rel["to"])
        if key not in chosen or _edge_rank(rel) > _edge_rank(chosen[key]):
            chosen[key] = rel
    return chosen


def _cycle_nodes(edges):
    graph = {}
    for start, end in edges:
        graph.setdefault(start, set()).add(end)
    cyclic = set()
    for node in graph:
        seen, stack = set(), list(graph[node])
        while stack:
            cur = stack.pop()
            if cur == node:
                cyclic.add(node)
                break
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(graph.get(cur, ()))
    return cyclic


def _enumerate(start, neighbors):
    """Yield every simple path from ``start`` as (node_ids, edge_ids, fraction)."""
    steps = 0
    stack = [(start, (start,), (), 1.0)]
    while stack:
        node, path, edge_ids, fraction = stack.pop()
        if len(path) > MAX_PATH_DEPTH + 1:
            continue
        for nxt, share, rel_id in neighbors.get(node, ()):
            steps += 1
            if steps > MAX_ENUMERATION_STEPS:
                return
            if nxt in path:
                continue
            new_path, new_edges, new_fraction = path + (nxt,), edge_ids + (rel_id,), fraction * share
            yield new_path, new_edges, new_fraction
            stack.append((nxt, new_path, new_edges, new_fraction))


def penetrating_ownership(data, root_id=None, as_of=None, include_historical=False):
    """Look-through equity of ``root_id`` downstream and of its owners upstream.

    Returns ``{entity_id: record}``; record keys: ``effective_pct, direct_pct,
    coverage (full|partial), has_cycle, paths[{ids, edge_ids, pct}], direction
    (downstream|upstream), holder_id, target_id``.  Downstream: root's effective
    interest in the entity.  Upstream: the entity's effective interest in root.
    Paths always list nodes in holder -> ... -> target order.
    """
    if root_id is None:
        root_id = (data.get("meta") or {}).get("root_id")
    entities = entity_index(data)
    if root_id not in entities:
        return {}
    chosen = holding_edges(data, as_of, include_historical)
    out_map, in_map, incoming_total = {}, {}, {}
    for (start, end), rel in chosen.items():
        share = rel["percent"] / 100.0
        out_map.setdefault(start, []).append((end, share, rel.get("id")))
        in_map.setdefault(end, []).append((start, share, rel.get("id")))
        incoming_total[end] = incoming_total.get(end, 0.0) + rel["percent"]
    for table in (out_map, in_map):
        for items in table.values():
            items.sort(key=lambda item: str(item[0]))
    cyclic = _cycle_nodes(chosen)

    def collect(direction):
        neighbors = out_map if direction == "downstream" else in_map
        found = {}
        for path, edge_ids, fraction in _enumerate(root_id, neighbors):
            target = path[-1]
            if direction == "upstream":
                path, edge_ids = tuple(reversed(path)), tuple(reversed(edge_ids))
            entry = found.setdefault(target, {"total": 0.0, "paths": [], "nodes": set(), "held": set()})
            entry["total"] += fraction
            entry["nodes"].update(path)
            entry["held"].update(path[1:])  # every node that is held along the chain
            if len(entry["paths"]) < MAX_STORED_PATHS:
                entry["paths"].append({"ids": list(path), "edge_ids": list(edge_ids),
                                       "pct": round_num(fraction * 100)})
        result = {}
        for target, entry in found.items():
            if direction == "downstream":
                holder, held_target = root_id, target
            else:
                holder, held_target = target, root_id
            direct = chosen.get((holder, held_target))
            coverage = "full" if all(incoming_total.get(n, 0.0) >= 99.5 for n in entry["held"]) else "partial"
            entry["paths"].sort(key=lambda p: (-p["pct"], len(p["ids"])))
            raw = entry["total"] * 100
            record = {
                "effective_pct": round_num(min(raw, 100.0)),
                "direct_pct": round_num(direct["percent"]) if direct else 0.0,
                "coverage": coverage,
                "has_cycle": bool(entry["nodes"] & cyclic),
                "paths": entry["paths"],
                "direction": direction,
                "holder_id": holder,
                "target_id": held_target,
            }
            if raw > 100.0001:
                record["overcounted"] = True
            result[target] = record
        return result

    downstream = collect("downstream")
    upstream = collect("upstream")
    merged = dict(downstream)
    for ident, record in upstream.items():
        if ident in merged:  # cross-holding: entity both holds and is held by root
            record = dict(record)
            record["reverse"] = merged[ident]
        merged[ident] = record
    return merged


def ownership_summary(ownership, data, threshold=25.0):
    entities = entity_index(data)
    root_id = (data.get("meta") or {}).get("root_id")
    upstream = {k: v for k, v in ownership.items() if v.get("direction") == "upstream"}
    holders_of = {v["holder_id"] for v in upstream.values()}
    # Top owners: upstream holders that are not themselves held by anybody upstream.
    held_upstream = set()
    for record in upstream.values():
        for path in record["paths"]:
            held_upstream.update(path["ids"][1:])
    top = sorted(holders_of - held_upstream, key=lambda i: (-upstream[i]["effective_pct"], i))
    top_set = set(top)
    significant = sorted((k for k, v in upstream.items() if v["effective_pct"] >= threshold),
                         key=lambda i: (-upstream[i]["effective_pct"], i not in top_set, i))
    return {
        "root_id": root_id,
        "threshold_pct": round_num(threshold),
        "significant_holders": [{"id": i, "name": entities.get(i, {}).get("name", i),
                                 "type": entities.get(i, {}).get("type"),
                                 "effective_pct": upstream[i]["effective_pct"],
                                 "coverage": upstream[i]["coverage"]} for i in significant],
        "top_owners": [{"id": i, "name": entities.get(i, {}).get("name", i),
                        "type": entities.get(i, {}).get("type"),
                        "effective_pct": upstream[i]["effective_pct"]} for i in top],
        "downstream_count": sum(v.get("direction") == "downstream" or "reverse" in v for v in ownership.values()),
        "upstream_count": len(upstream),
    }


# ---------------------------------------------------------------------------
# Two-hop co-occurrence
# ---------------------------------------------------------------------------

def _person_org_links(data):
    """{person_id: {org_id: [rel, ...]}} over confirmed fact edges, historical included."""
    entities = entity_index(data)
    sources = set(source_index(data))
    links = {}
    for rel in valid_relationships(data):
        if not is_confirmed(rel, sources):
            continue
        a, b = entities[rel["from"]], entities[rel["to"]]
        for person, org in ((a, b), (b, a)):
            if person.get("type") == "person" and org.get("type") != "person":
                links.setdefault(person["id"], {}).setdefault(org["id"], []).append(rel)
    return links


def _direct_person_links(data):
    entities = entity_index(data)
    sources = set(source_index(data))
    pairs = {}
    for rel in valid_relationships(data):
        if not is_confirmed(rel, sources) or rel["from"] == rel["to"]:
            continue
        if entities[rel["from"]].get("type") == "person" and entities[rel["to"]].get("type") == "person":
            pairs.setdefault(frozenset((rel["from"], rel["to"])), []).append(rel)
    return pairs


def co_occurrence_rows(data, subject_id, links=None, direct=None, limit=None):
    """Rank people who share organizations (active and dissolved) with ``subject_id``.

    score = sum over shared orgs of w(subject_role) * w(partner_role) * (1 + 0.5 if the
    two tenures overlap) + 0.5 per direct confirmed person-person fact (max 2).
    """
    entities = entity_index(data)
    links = _person_org_links(data) if links is None else links
    direct = _direct_person_links(data) if direct is None else direct
    mine = links.get(subject_id, {})
    partners = {}
    for org_id, my_rels in mine.items():
        for other_id, their_orgs in links.items():
            if other_id == subject_id or org_id not in their_orgs:
                continue
            partners.setdefault(other_id, []).append((org_id, my_rels, their_orgs[org_id]))
    rows = []
    for other_id, shared in partners.items():
        score, organizations, active, dissolved, dates = 0.0, [], 0, 0, []
        for org_id, my_rels, their_rels in sorted(shared, key=lambda s: s[0]):
            org = entities[org_id]
            my_w = max(role_weight(infer_role_code(r)) for r in my_rels)
            their_w = max(role_weight(infer_role_code(r)) for r in their_rels)
            overlap = any(_overlaps(_interval(x), _interval(y)) for x in my_rels for y in their_rels)
            score += my_w * their_w * (1.5 if overlap else 1.0)
            if is_dissolved(org):
                dissolved += 1
            else:
                active += 1
            for rel in (*my_rels, *their_rels):
                for key in ("valid_from", "date", "valid_to"):
                    if isinstance(rel.get(key), str) and _date_bound(rel[key]):
                        dates.append(rel[key])
            organizations.append({
                "id": org_id, "name": org.get("name", org_id), "type": org.get("type"),
                "registry_status": org.get("registry_status") or "unknown",
                "subject_role": "、".join(dict.fromkeys(role_text(r) for r in my_rels)),
                "partner_role": "、".join(dict.fromkeys(role_text(r) for r in their_rels)),
                "overlap": overlap,
            })
        direct_rels = direct.get(frozenset((subject_id, other_id)), [])
        score += 0.5 * min(len(direct_rels), 2)
        union = len(set(mine) | set(links.get(other_id, {})))
        rows.append({
            "partner_id": other_id,
            "partner_name": entities.get(other_id, {}).get("name", other_id),
            "score": round_num(score, 3),
            "shared_count": len(organizations),
            "shared_active": active,
            "shared_dissolved": dissolved,
            "organizations": organizations,
            "first_seen": min(dates, key=lambda d: _date_bound(d)) if dates else None,
            "last_seen": max(dates, key=lambda d: _date_bound(d, upper=True)) if dates else None,
            "direct_links": [r.get("id") for r in direct_rels],
            "jaccard": round_num(len(organizations) / union, 3) if union else 0.0,
        })
    rows.sort(key=lambda r: (-r["score"], -r["shared_count"], r["partner_name"]))
    return rows[:limit] if limit else rows


def key_people(data, root_id=None, ownership=None, limit=6):
    """People most relevant to the root: controllers first, then founders/officers, then degree."""
    entities = entity_index(data)
    root_id = root_id or (data.get("meta") or {}).get("root_id")
    ownership = ownership if ownership is not None else penetrating_ownership(data, root_id)
    links = _person_org_links(data)
    scores = {}
    for pid, entity in entities.items():
        if entity.get("type") != "person" or entity.get("status") == "candidate":
            continue
        record = ownership.get(pid)
        stake = record["effective_pct"] if record and record.get("direction") == "upstream" else 0.0
        to_root = links.get(pid, {}).get(root_id, [])
        role_bonus = max((role_weight(infer_role_code(r)) for r in to_root), default=0.0)
        scores[pid] = (stake, role_bonus, len(links.get(pid, {})), entity.get("importance") or 0)
    ranked = sorted(scores, key=lambda p: tuple(-x for x in scores[p][:3]) + (-scores[p][3], p))
    if entities.get(root_id, {}).get("type") == "person":
        ranked = [root_id] + [p for p in ranked if p != root_id]
    return ranked[:limit]


def co_occurrence(data, subject_id=None, ownership=None, top_people=6):
    entities = entity_index(data)
    root_id = (data.get("meta") or {}).get("root_id")
    links, direct = _person_org_links(data), _direct_person_links(data)
    people = key_people(data, root_id, ownership, top_people)
    by_person = {}
    for pid in people:
        rows = co_occurrence_rows(data, pid, links, direct)
        if rows:
            by_person[pid] = rows
    if subject_id is None:
        if entities.get(root_id, {}).get("type") == "person":
            subject_id = root_id
        else:
            subject_id = next((p for p in people if p in by_person), people[0] if people else None)
    rows = co_occurrence_rows(data, subject_id, links, direct) if subject_id else []
    if subject_id and rows:
        by_person.setdefault(subject_id, rows)
    return {"subject_id": subject_id, "rows": rows, "by_person": by_person}


# ---------------------------------------------------------------------------
# Confidence
# ---------------------------------------------------------------------------

def source_root(source_id, sources):
    seen, cursor = set(), source_id
    while isinstance(cursor, str) and cursor in sources and cursor not in seen:
        seen.add(cursor)
        parent = sources[cursor].get("origin_id")
        if not isinstance(parent, str) or parent not in sources:
            return cursor
        cursor = parent
    return cursor


def _grade(source_ids, sources):
    refs = [s for s in dict.fromkeys(source_ids) if s in sources]
    roots = {source_root(s, sources) for s in refs}
    kinds = {sources[s].get("kind") for s in refs} | {sources[r].get("kind") for r in roots if r in sources}
    if kinds & STRONG_SOURCE_KINDS:
        grade = "A_registry"
    elif len(roots) >= 2:
        grade = "B_multi_independent"
    else:
        grade = "C_single"
    return grade, len(roots), sorted(k for k in kinds if isinstance(k, str))


def confidence(data):
    sources = source_index(data)
    claims = {row["id"]: row for row in _rows(data, "claims") if isinstance(row.get("id"), str)}

    def claim_sources(record):
        found = []
        for cid in _ids(record.get("claim_ids")):
            found.extend(_ids(claims.get(cid, {}).get("source_ids")))
        return found

    entity_grades = {}
    for ident, entity in entity_index(data).items():
        refs = _ids(entity.get("sources")) + claim_sources(entity)
        for field in ("fields", "facts", "career", "sections"):
            for item in entity.get(field, []) if isinstance(entity.get(field), list) else []:
                if isinstance(item, dict):
                    refs += _ids(item.get("sources")) + claim_sources(item)
        grade, count, kinds = _grade(refs, sources)
        if entity.get("status") == "candidate":
            grade = "candidate"
        entity_grades[ident] = {"grade": grade, "independent_sources": count, "kinds": kinds}
    rel_grades = {}
    for rel in _rows(data, "relationships"):
        if not isinstance(rel.get("id"), str):
            continue
        grade, count, kinds = _grade(_ids(rel.get("sources")) + claim_sources(rel), sources)
        if is_disputed(rel):
            grade = "disputed"
        elif is_candidate(rel):
            grade = "candidate"
        elif is_signal(rel):
            grade = "signal"
        rel_grades[rel["id"]] = {"grade": grade, "independent_sources": count, "kinds": kinds}
    return {"entities": entity_grades, "relationships": rel_grades}


# ---------------------------------------------------------------------------
# Centrality and paths
# ---------------------------------------------------------------------------

def _confirmed_adjacency(data):
    entities = entity_index(data)
    sources = set(source_index(data))
    adjacency = {ident: set() for ident in entities}
    for rel in valid_relationships(data):
        if rel["from"] != rel["to"] and is_confirmed(rel, sources):
            adjacency[rel["from"]].add(rel["to"])
            adjacency[rel["to"]].add(rel["from"])
    return adjacency


def centrality(data):
    entities = entity_index(data)
    neighbors = {ident: set() for ident in entities}
    for rel in valid_relationships(data):
        if rel["from"] != rel["to"]:
            neighbors[rel["from"]].add(rel["to"])
            neighbors[rel["to"]].add(rel["from"])
    adjacency = _confirmed_adjacency(data)
    nodes = sorted(adjacency)
    betweenness = dict.fromkeys(nodes, 0.0)
    for source in nodes:  # Brandes, unweighted, undirected
        stack, preds = [], {v: [] for v in nodes}
        sigma, dist = dict.fromkeys(nodes, 0.0), dict.fromkeys(nodes, -1)
        sigma[source], dist[source] = 1.0, 0
        queue = deque([source])
        while queue:
            v = queue.popleft()
            stack.append(v)
            for w in sorted(adjacency[v]):
                if dist[w] < 0:
                    dist[w] = dist[v] + 1
                    queue.append(w)
                if dist[w] == dist[v] + 1:
                    sigma[w] += sigma[v]
                    preds[w].append(v)
        delta = dict.fromkeys(nodes, 0.0)
        while stack:
            w = stack.pop()
            for v in preds[w]:
                delta[v] += sigma[v] / sigma[w] * (1 + delta[w])
            if w != source:
                betweenness[w] += delta[w]
    n = len(nodes)
    scale = 1.0 / ((n - 1) * (n - 2)) if n > 2 else 0.0  # undirected: /2 then *2/((n-1)(n-2))
    return {ident: {"degree": len(neighbors[ident]), "confirmed_degree": len(adjacency[ident]),
                    "betweenness": round_num(betweenness[ident] * scale, 4)} for ident in nodes}


def find_paths(data, start, end, max_hops=6, include_historical=False, include_signals=False,
               include_candidates=False, limit=10):
    """All shortest simple paths (up to ``limit``) between two entities.

    Traversal is undirected; each hop reports the original edge direction via
    ``forward`` (True when the edge points along the path).
    """
    entities = entity_index(data)
    if start not in entities or end not in entities:
        return []
    sources = set(source_index(data))
    usable = {}
    for rel in valid_relationships(data):
        if rel["from"] == rel["to"]:
            continue
        if is_disputed(rel) or is_candidate(rel):
            if not include_candidates:
                continue
        elif edge_class(rel) == "signal":
            if not include_signals:
                continue
        elif edge_class(rel) == "derived" or not is_confirmed(rel, sources):
            continue
        if rel.get("status") == "historical" and not include_historical:
            continue
        for a, b in ((rel["from"], rel["to"]), (rel["to"], rel["from"])):
            usable.setdefault(a, {}).setdefault(b, []).append(rel)
    if start == end:
        return [{"ids": [start], "edges": [], "hops": 0}]
    dist, parents, queue = {start: 0}, {start: []}, deque([start])
    while queue:
        node = queue.popleft()
        if dist[node] >= max_hops:
            continue
        for nxt in sorted(usable.get(node, {})):
            if nxt not in dist:
                dist[nxt] = dist[node] + 1
                parents[nxt] = [node]
                queue.append(nxt)
            elif dist[nxt] == dist[node] + 1:
                parents[nxt].append(node)
    if end not in dist:
        return []
    results = []

    def walk(node, suffix):
        if len(results) >= limit:
            return
        if node == start:
            ids = [start] + suffix
            hops = []
            for a, b in zip(ids, ids[1:]):
                rels = sorted(usable[a][b], key=lambda r: (r.get("status") == "historical",
                                                           edge_class(r) != "fact", str(r.get("id"))))
                rel = rels[0]
                hops.append({"id": rel.get("id"), "from": rel["from"], "to": rel["to"],
                             "type": rel.get("type"), "label": rel.get("label"),
                             "status": rel.get("status") or "current", "edge_class": edge_class(rel),
                             "forward": rel["from"] == a, "parallel": len(rels)})
            results.append({"ids": ids, "edges": hops, "hops": len(hops)})
            return
        for parent in parents[node]:
            walk(parent, [node] + suffix)

    walk(end, [])
    return results


# ---------------------------------------------------------------------------
# Bundle
# ---------------------------------------------------------------------------

def compute_analytics(data, threshold=25.0, as_of=None):
    """Return the ``__computed`` payload for report.js (pure function of ``data``)."""
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    entities = entity_index(data)
    root_id = meta.get("root_id")
    root_type = entities.get(root_id, {}).get("type") or meta.get("root_type")
    ownership = penetrating_ownership(data, root_id, as_of=as_of)
    rels = valid_relationships(data)
    return {
        "version": ANALYTICS_VERSION,
        "root": {"id": root_id, "type": root_type},
        "ownership": ownership,
        "ownership_meta": ownership_summary(ownership, data, threshold),
        "co_occurrence": co_occurrence(data, ownership=ownership),
        "confidence": confidence(data),
        "centrality": centrality(data),
        "stats": {
            "signal_relationships": sum(is_signal(r) for r in rels),
            "derived_relationships": sum(edge_class(r) == "derived" for r in rels),
            "dissolved_entities": sum(is_dissolved(e) for e in entities.values()),
        },
    }
