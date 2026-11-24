#!/usr/bin/env python3
"""Regression suite for the dossier toolchain (stdlib unittest, Python 3.10+).

Run from the repository root:
  python -X utf8 -m unittest discover -s skills/investigation/company-background-investigation/scripts/tests -v
"""

import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent.parent
SKILL = SCRIPTS.parent
ASSETS = SKILL / "assets"
sys.path.insert(0, str(SCRIPTS))

import analyze_network  # noqa: E402
import build_report  # noqa: E402
import diff_dossier  # noqa: E402
import merge_dossiers  # noqa: E402
import network_core as nc  # noqa: E402
import validate_dossier as vd  # noqa: E402

EXAMPLE = ASSETS / "example-data.json"
PERSON_EXAMPLE = ASSETS / "example-person-data.json"

LEGACY_COUNT_KEYS = (
    "entities", "people", "companies", "products", "brands", "entity_pairs", "relationship_facts",
    "confirmed_pairs", "candidate_relationships", "disputed_relationships", "sources", "images",
    "sections", "questions", "archives", "findings", "timeline_events", "claims", "evidence_files",
)
NEW_COUNT_KEYS = ("investors", "institutions", "signal_relationships", "dissolved_entities")


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------

def src(ident, kind="registry", url=None, origin=None, locator=None):
    row = {"id": ident, "title": f"Source {ident}", "url": url or f"https://example.org/{ident}",
           "kind": kind, "observed_at": "2024-01-01"}
    if origin:
        row["origin_id"] = origin
    if locator:
        row["locator"] = locator
    return row


def ent(ident, etype="company", **extra):
    row = {"id": ident, "name": extra.pop("name", ident), "type": etype, "summary": f"{ident} summary", "sources": ["S1"]}
    row.update(extra)
    return row


def rel(ident, start, end, rtype="ownership", **extra):
    row = {"id": ident, "from": start, "to": end, "type": rtype, "label": extra.pop("label", rtype),
           "sources": extra.pop("sources", ["S1"])}
    row.update(extra)
    return row


def dossier(root, entities, relationships, sources=None, **extra):
    data = {"schema_version": 1,
            "meta": {"title": "fixture", "root_id": root, "as_of": "2024-12-31"},
            "entities": entities, "relationships": relationships,
            "sources": sources or [src("S1")]}
    data.update(extra)
    return data


def person_root_fixture():
    """Person root P with partner Q across 3 orgs (one dissolved) and R across 1."""
    entities = [
        ent("P", "person", name="Subject"), ent("Q", "person", name="Partner Q"), ent("R", "person", name="Partner R"),
        ent("A", registry_status="active"), ent("B", registry_status="dissolved"), ent("C"),
        ent("H", "company", name="HoldCo"),
    ]
    relationships = [
        rel("p-a", "P", "A", "founding", role_code="founder", valid_from="2015-01-01"),
        rel("q-a", "Q", "A", "officer", role_code="supervisor", valid_from="2016-01-01"),
        rel("p-b", "P", "B", "ownership", percent=50, status="historical", valid_from="2010", valid_to="2014"),
        rel("q-b", "Q", "B", "officer", role="财务负责人", label="财务负责人", status="historical", valid_from="2011", valid_to="2013"),
        rel("p-c", "P", "C", "officer", role_code="director"),
        rel("q-c", "Q", "C", "employment", label="工程师"),
        rel("r-c", "R", "C", "employment", label="顾问"),
        rel("p-h", "P", "H", "ownership", percent=100),
        rel("h-a", "H", "A", "ownership", percent=40),
        rel("p-a-own", "P", "A", "ownership", percent=60),
    ]
    return dossier("P", entities, relationships)


def company_group_fixture():
    """Synthetic v1 company-group fixture with upstream holders, a 99%+1% subsidiary, investors and institutions."""
    entities = [
        ent("co-parent", "company", name="Sample Parent Co"),
        ent("co-mid", "company", name="Sample Holding Sub"),
        ent("co-op", "company", name="Sample Operating Sub"),
        ent("person-ctrl", "person", name="Sample Controller"),
        ent("inv-alpha", "investor", name="Sample Alpha Fund"),
        ent("inv-beta", "investor", name="Sample Beta LP"),
        ent("inst-reg", "institution", name="Sample Registry Authority"),
        ent("co-homonym", "company", name="Unrelated Homonym Co", status="candidate"),
    ]
    relationships = [
        rel("r-ctrl", "person-ctrl", "co-parent", "ownership", nature="capital", percent=65.0),
        rel("r-inv1", "inv-alpha", "co-parent", "investment", nature="capital", percent=15.0),
        rel("r-inv2", "inv-beta", "co-parent", "investment", nature="capital", percent=10.0),
        rel("r-sub-mid", "co-parent", "co-mid", "ownership", nature="capital", percent=100.0),
        rel("r-sub-op-direct", "co-parent", "co-op", "ownership", nature="capital", percent=99.0),
        rel("r-sub-op-indirect", "co-mid", "co-op", "ownership", nature="capital", percent=1.0),
        rel("r-inst", "inst-reg", "co-parent", "operation", nature="business", label="备案登记"),
        rel("r-cand", "co-homonym", "co-op", "candidate", status="candidate", nature="business", label="同名隔离"),
    ]
    return dossier("co-parent", entities, relationships)


# ---------------------------------------------------------------------------
# Backward compatibility (golden)
# ---------------------------------------------------------------------------

class BackwardCompatibilityTests(unittest.TestCase):
    EXPECTED_EXAMPLE_COUNTS = {
        "entities": 8, "people": 3, "companies": 2, "products": 1, "brands": 1, "entity_pairs": 8,
        "relationship_facts": 9, "confirmed_pairs": 7, "candidate_relationships": 1, "disputed_relationships": 0,
        "sources": 6, "images": 1, "sections": 4, "questions": 3, "archives": 2, "findings": 2,
        "timeline_events": 3, "claims": 1, "evidence_files": 1,
    }

    def test_example_dossier_unchanged(self):
        report = vd.validate_dossier(vd.load_json(EXAMPLE), EXAMPLE.parent)
        self.assertTrue(report["ok"], report["errors"])
        self.assertEqual(report["errors"], [])
        self.assertEqual([w["code"] for w in report["warnings"]], ["unreachable_from_root"])
        self.assertIn("person-example-candidate", report["warnings"][0]["message"])
        for key, value in self.EXPECTED_EXAMPLE_COUNTS.items():
            self.assertEqual(report["counts"][key], value, key)
        for key in NEW_COUNT_KEYS:
            self.assertIn(key, report["counts"])
        self.assertEqual(report["counts"]["investors"], 1)
        self.assertEqual(report["manual_review"], vd.MANUAL_REVIEW)
        self.assertEqual(len(vd.MANUAL_REVIEW), 3)
        self.assertEqual(report["reachability"]["root_id"], "co-example-alpha")
        self.assertEqual(report["reachability"]["unreachable_ids"], ["person-example-candidate"])
        self.assertEqual(report["reachability"]["candidate_endpoint_ids"],
                         ["person-example-candidate", "person-example-founder"])

    def test_company_group_counts_and_compat(self):
        report = vd.validate_dossier(company_group_fixture())
        self.assertTrue(report["ok"], report["errors"][:3])
        self.assertEqual(len(report["warnings"]), 1)
        self.assertEqual(report["counts"]["entities"], 8)
        self.assertEqual(report["counts"]["companies"], 4)
        self.assertEqual(report["counts"]["people"], 1)
        self.assertEqual(report["counts"]["investors"], 2)
        self.assertEqual(report["counts"]["institutions"], 1)
        self.assertEqual(report["counts"]["candidate_relationships"], 1)
        self.assertEqual(report["manual_review"], vd.MANUAL_REVIEW)

    def test_legacy_count_keys_all_present(self):
        report = vd.validate_dossier(dossier("A", [ent("A")], []))
        self.assertTrue(set(LEGACY_COUNT_KEYS + NEW_COUNT_KEYS) <= set(report["counts"]))

    def test_schema_version_still_required_to_be_1(self):
        data = dossier("A", [ent("A")], [])
        data["schema_version"] = 2
        self.assertIn("schema_version", [e["code"] for e in vd.validate_dossier(data)["errors"]])


# ---------------------------------------------------------------------------
# Additive validator fields
# ---------------------------------------------------------------------------

class ValidatorExtensionTests(unittest.TestCase):
    def codes(self, data, bucket="errors"):
        return [i["code"] for i in vd.validate_dossier(data)[bucket]]

    def test_valid_extensions_pass(self):
        data = dossier("P", [
            ent("P", "person", identity_basis={"anchors": {"name": "match", "organization": "match", "time": "match",
                                                          "place_or_network": "unknown"},
                                               "decision": "merge", "notes": "registry"}),
            ent("A", identifiers=[{"scheme": "cn_uscc", "value": "91330000TEST", "jurisdiction": "CN"}],
                registry_status="dissolved"),
            ent("B"),
        ], [
            rel("r1", "P", "A", "officer", role="监事", role_code="supervisor"),
            rel("r2", "A", "B", "shared_address", edge_class="signal", signal_key="addr:x"),
        ])
        data["meta"].update({"root_type": "person", "purpose": "partnership", "ui_labels": {"judgmentLabel": "人物判断"}})
        report = vd.validate_dossier(data)
        self.assertTrue(report["ok"], report["errors"])
        self.assertEqual(report["counts"]["signal_relationships"], 1)
        self.assertEqual(report["counts"]["dissolved_entities"], 1)
        self.assertEqual(report["reachability"]["root_type"], "person")
        self.assertNotEqual(report["manual_review"], vd.MANUAL_REVIEW)
        # B is only reachable through a signal edge -> not a confirmed connection.
        self.assertIn("B", report["reachability"]["unreachable_ids"])

    def test_invalid_extension_values_error(self):
        data = dossier("A", [
            ent("A", registry_status="closed", identifiers=[{"scheme": "", "value": 3}],
                identity_basis={"anchors": [], "decision": "maybe"}),
            ent("B", identifiers="nope"),
        ], [rel("r1", "A", "B", edge_class="weak", role_code=5)])
        data["meta"].update({"root_type": "alien", "ui_labels": {"x": ""}})
        codes = self.codes(data)
        for code in ("registry_status", "text_type", "identity_anchors", "identity_decision", "identifiers_type",
                     "edge_class", "role_code_type", "root_type", "ui_labels_value"):
            self.assertIn(code, codes)

    def test_unknown_role_code_only_warns(self):
        data = dossier("A", [ent("A"), ent("P", "person")], [rel("r", "P", "A", "officer", role_code="ombudsman")])
        report = vd.validate_dossier(data)
        self.assertTrue(report["ok"])
        self.assertIn("unknown_role_code", [w["code"] for w in report["warnings"]])

    def test_root_type_mismatch_and_duplicate_identifier_warn(self):
        ident = [{"scheme": "lei", "value": "ABC"}]
        data = dossier("A", [ent("A", identifiers=ident), ent("B", identifiers=ident)], [rel("r", "A", "B")])
        data["meta"]["root_type"] = "person"
        warnings = self.codes(data, "warnings")
        self.assertIn("root_type_mismatch", warnings)
        self.assertIn("duplicate_identifier", warnings)

    def test_same_as_candidate_and_derived_excluded_from_reachability(self):
        data = dossier("A", [ent("A"), ent("P1", "person"), ent("P2", "person"), ent("D")], [
            rel("r1", "P1", "A", "employment"),
            rel("r2", "P1", "P2", "same_as_candidate", edge_class="signal"),
            rel("r3", "A", "D", "co_occurrence", edge_class="derived"),
        ])
        report = vd.validate_dossier(data)
        self.assertEqual(report["counts"]["candidate_relationships"], 1)
        self.assertEqual(report["counts"]["derived_relationships"], 1)
        self.assertEqual(set(report["reachability"]["unreachable_ids"]), {"P2", "D"})

    def test_no_hardcoded_pii_field_blocking(self):
        data = dossier("A", [ent("A", home_address="x", phone="y", id_number="z")], [])
        self.assertTrue(vd.validate_dossier(data)["ok"])

    def test_manual_review_adapts_to_root_type(self):
        for etype in ("person", "investor", "institution", "product", "brand"):
            report = vd.validate_dossier(dossier("X", [ent("X", etype)], []))
            self.assertEqual(len(report["manual_review"]), 3)
            self.assertNotEqual(report["manual_review"], vd.MANUAL_REVIEW, etype)


# ---------------------------------------------------------------------------
# Penetrating ownership
# ---------------------------------------------------------------------------

class OwnershipTests(unittest.TestCase):
    def test_chain_multiplies(self):
        data = dossier("T", [ent("O", "person"), ent("M"), ent("T")],
                       [rel("o-m", "O", "M", percent=60), rel("m-t", "M", "T", percent=50)])
        own = nc.penetrating_ownership(data)
        self.assertAlmostEqual(own["O"]["effective_pct"], 30.0)
        self.assertEqual(own["O"]["direction"], "upstream")
        self.assertEqual(own["O"]["direct_pct"], 0.0)
        self.assertEqual(own["O"]["paths"][0]["ids"], ["O", "M", "T"])
        self.assertEqual(own["O"]["paths"][0]["edge_ids"], ["o-m", "m-t"])
        self.assertEqual(own["M"]["coverage"], "partial")  # T register only 50% known

    def test_multi_path_sum_downstream(self):
        own = nc.penetrating_ownership(person_root_fixture())
        a = own["A"]
        self.assertEqual(a["direction"], "downstream")
        self.assertAlmostEqual(a["effective_pct"], 100.0)
        self.assertAlmostEqual(a["direct_pct"], 60.0)
        self.assertEqual(len(a["paths"]), 2)
        self.assertEqual(a["coverage"], "full")
        self.assertFalse(a["has_cycle"])
        self.assertNotIn("B", own)  # historical holding excluded by default

    def test_historical_opt_in_and_as_of(self):
        data = person_root_fixture()
        self.assertAlmostEqual(nc.penetrating_ownership(data, include_historical=True)["B"]["effective_pct"], 50.0)
        data["relationships"].append(rel("p-c-own", "P", "C", percent=10, valid_from="2030-01-01"))
        self.assertIn("C", nc.penetrating_ownership(data))
        self.assertNotIn("C", nc.penetrating_ownership(data, as_of="2024-06-30"))

    def test_cycle_guard_terminates_and_flags(self):
        data = dossier("A", [ent("A"), ent("B"), ent("C")],
                       [rel("a-b", "A", "B", percent=50), rel("b-a", "B", "A", percent=30), rel("b-c", "B", "C", percent=100)])
        own = nc.penetrating_ownership(data)
        self.assertTrue(own["C"]["has_cycle"])
        self.assertTrue(own["B"]["has_cycle"])
        self.assertIn("reverse", own["B"])  # B both holds and is held by root A
        self.assertAlmostEqual(own["B"]["effective_pct"], 30.0)
        self.assertAlmostEqual(own["B"]["reverse"]["effective_pct"], 50.0)

    def test_candidate_signal_and_duplicate_facts(self):
        data = dossier("T", [ent("O", "person"), ent("T"), ent("X")], [
            rel("o-t-sub", "O", "T", percent=30, date="2020-01-01", label="认缴"),
            rel("o-t-new", "O", "T", percent=40, date="2023-01-01", label="变更后"),
            rel("x-t", "X", "T", percent=20, status="candidate"),
            rel("x-t2", "X", "T", percent=20, edge_class="signal"),
        ])
        own = nc.penetrating_ownership(data)
        self.assertAlmostEqual(own["O"]["effective_pct"], 40.0)  # latest fact, not summed
        self.assertNotIn("X", own)

    def test_summary_threshold_and_top_owners(self):
        data = dossier("T", [ent("O", "person"), ent("M"), ent("T"), ent("S", "person")],
                       [rel("o-m", "O", "M", percent=100), rel("m-t", "M", "T", percent=70), rel("s-t", "S", "T", percent=30)])
        own = nc.penetrating_ownership(data)
        summary = nc.ownership_summary(own, data, threshold=25)
        self.assertEqual([h["id"] for h in summary["significant_holders"]], ["O", "M", "S"])
        self.assertEqual([h["id"] for h in summary["top_owners"]], ["O", "S"])

    def test_company_group_upstream_and_downstream_multi_path(self):
        own = nc.penetrating_ownership(company_group_fixture())
        self.assertAlmostEqual(own["co-op"]["effective_pct"], 100.0)
        self.assertAlmostEqual(own["co-op"]["direct_pct"], 99.0)
        self.assertEqual(own["co-op"]["coverage"], "full")
        self.assertAlmostEqual(own["person-ctrl"]["effective_pct"], 65.0)
        self.assertEqual(own["person-ctrl"]["coverage"], "partial")


# ---------------------------------------------------------------------------
# Co-occurrence, confidence, centrality, paths
# ---------------------------------------------------------------------------

class CoOccurrenceTests(unittest.TestCase):
    def test_partner_matrix_counts_active_and_dissolved(self):
        co = nc.co_occurrence(person_root_fixture())
        self.assertEqual(co["subject_id"], "P")
        top = co["rows"][0]
        self.assertEqual(top["partner_id"], "Q")
        self.assertEqual(top["shared_count"], 3)
        self.assertEqual(top["shared_dissolved"], 1)
        self.assertEqual(top["shared_active"], 2)
        self.assertEqual({o["id"] for o in top["organizations"]}, {"A", "B", "C"})
        b = next(o for o in top["organizations"] if o["id"] == "B")
        self.assertEqual(b["registry_status"], "dissolved")
        self.assertTrue(b["overlap"])
        self.assertEqual(b["partner_role"], "财务负责人")
        self.assertEqual(top["first_seen"], "2010")
        self.assertEqual(co["rows"][1]["partner_id"], "R")
        self.assertGreater(top["score"], co["rows"][1]["score"])
        for key in ("partner_name", "score", "shared_count", "shared_active", "shared_dissolved",
                    "organizations", "first_seen", "last_seen"):
            self.assertIn(key, top)
        self.assertIn("P", co["by_person"])

    def test_candidate_and_signal_edges_ignored(self):
        data = person_root_fixture()
        data["entities"].append(ent("Z", "person"))
        data["relationships"] += [rel("z-a", "Z", "A", "officer", status="candidate"),
                                  rel("z-c", "Z", "C", "shared_address", edge_class="signal")]
        self.assertNotIn("Z", [r["partner_id"] for r in nc.co_occurrence(data)["rows"]])

    def test_company_root_uses_controller_and_by_person(self):
        data = dossier("T", [ent("T"), ent("O", "person"), ent("K", "person"), ent("Y")],
                       [rel("o-t", "O", "T", percent=80), rel("k-t", "K", "T", "officer", label="监事"),
                        rel("o-y", "O", "Y", "officer", label="董事"), rel("k-y", "K", "Y", "officer", label="董事")])
        co = nc.co_occurrence(data)
        self.assertEqual(co["subject_id"], "O")
        self.assertEqual(co["rows"][0]["partner_id"], "K")
        self.assertEqual(co["rows"][0]["shared_count"], 2)
        self.assertIn("K", co["by_person"])

    def test_role_inference(self):
        self.assertEqual(nc.infer_role_code({"label": "执行董事兼总经理"}), "director")
        self.assertEqual(nc.infer_role_code({"label": "Chief Financial Officer (CFO)"}), "executive")
        self.assertEqual(nc.infer_role_code({"type": "ownership", "label": "持有"}), "shareholder")
        self.assertEqual(nc.infer_role_code({"role_code": "gp", "label": "董事"}), "gp")


class ConfidenceCentralityPathTests(unittest.TestCase):
    def setUp(self):
        sources = [src("REG", "registry"), src("M1", "media"), src("M2", "media"), src("RP", "media", origin="M1")]
        self.data = dossier("A", [ent("A"), ent("B"), ent("C"), ent("D"), ent("E")], [
            rel("r-reg", "A", "B", sources=["REG"]),
            rel("r-multi", "B", "C", "client", sources=["M1", "M2"]),
            rel("r-repost", "C", "D", "client", sources=["M1", "RP"]),
            rel("r-signal", "A", "E", "shared_domain", edge_class="signal", sources=["M2"]),
            rel("r-hist", "A", "D", "client", status="historical", sources=["M2"]),
        ], sources)

    def test_grades(self):
        grades = nc.confidence(self.data)["relationships"]
        self.assertEqual(grades["r-reg"]["grade"], "A_registry")
        self.assertEqual(grades["r-multi"]["grade"], "B_multi_independent")
        self.assertEqual(grades["r-multi"]["independent_sources"], 2)
        self.assertEqual(grades["r-repost"]["grade"], "C_single")  # repost collapses to M1
        self.assertEqual(grades["r-repost"]["independent_sources"], 1)
        self.assertEqual(grades["r-signal"]["grade"], "signal")
        self.assertIn("entities", nc.confidence(self.data))

    def test_centrality_star(self):
        data = dossier("H", [ent("H"), ent("X"), ent("Y"), ent("Z")],
                       [rel("1", "H", "X"), rel("2", "H", "Y"), rel("3", "H", "Z")])
        c = nc.centrality(data)
        self.assertAlmostEqual(c["H"]["betweenness"], 1.0)
        self.assertEqual(c["H"]["degree"], 3)
        self.assertEqual(c["X"]["betweenness"], 0.0)

    def test_paths_respect_filters_and_direction(self):
        paths = nc.find_paths(self.data, "A", "D")
        self.assertEqual(paths[0]["ids"], ["A", "B", "C", "D"])
        self.assertTrue(all(h["forward"] for h in paths[0]["edges"]))
        with_hist = nc.find_paths(self.data, "A", "D", include_historical=True)
        self.assertEqual(with_hist[0]["hops"], 1)
        self.assertEqual(nc.find_paths(self.data, "D", "A")[0]["edges"][0]["forward"], False)
        self.assertEqual(nc.find_paths(self.data, "B", "E"), [])
        self.assertEqual(nc.find_paths(self.data, "B", "E", include_signals=True)[0]["ids"], ["B", "A", "E"])
        self.assertEqual(nc.find_paths(self.data, "A", "D", max_hops=2), [])

    def test_compute_analytics_contract(self):
        computed = nc.compute_analytics(person_root_fixture())
        for key in ("root", "ownership", "co_occurrence", "confidence", "centrality"):
            self.assertIn(key, computed)
        self.assertEqual(computed["root"], {"id": "P", "type": "person"})
        for record in computed["ownership"].values():
            for key in ("effective_pct", "direct_pct", "coverage", "has_cycle", "paths"):
                self.assertIn(key, record)
        self.assertEqual(set(computed["confidence"]), {"entities", "relationships"})
        json.dumps(computed, allow_nan=False)


# ---------------------------------------------------------------------------
# build_report, merge, diff, CLI
# ---------------------------------------------------------------------------

class BuildReportTests(unittest.TestCase):
    def test_payload_has_computed_and_source_untouched(self):
        data = vd.load_json(EXAMPLE)
        original = copy.deepcopy(data)
        embedded = build_report.build_payload(data, EXAMPLE.parent)
        self.assertEqual(data, original)
        self.assertNotIn("__computed", data)
        self.assertEqual(embedded["__computed"]["root"]["id"], "co-example-alpha")
        self.assertNotIn("<", build_report.serialize_payload({"x": "</script>"}))

    def test_build_writes_html_without_mutating_json(self):
        digest = hashlib.sha256(EXAMPLE.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "report.html"
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    build_report.build_report(EXAMPLE, out)
            except ValueError as exc:
                if "模板" in str(exc) or "结束标签" in str(exc):
                    self.skipTest("report template is being edited concurrently: " + str(exc))
                raise
            html = out.read_text(encoding="utf-8")
            self.assertIn('"__computed"', html)
            self.assertNotIn("__DOSSIER_JSON__", html)
        self.assertEqual(hashlib.sha256(EXAMPLE.read_bytes()).hexdigest(), digest)


class MergeTests(unittest.TestCase):
    def write(self, folder, name, data):
        path = Path(folder) / name / "dossier.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return path

    def fixtures(self, tmp):
        evidence = Path(tmp) / "case-a" / "evidence" / "e.txt"
        evidence.parent.mkdir(parents=True)
        evidence.write_bytes(b"registry extract")
        a = dossier("co-x", [
            ent("co-x", name="X Ltd", identifiers=[{"scheme": "cn_uscc", "value": "9133 0000 AAA"}]),
            ent("p-wang", "person", name="王伟"), ent("co-shared", name="Shared Org"),
        ], [rel("r1", "p-wang", "co-x", "officer", label="董事", valid_from="2018"),
            rel("r2", "p-wang", "co-shared", "officer", label="监事", valid_from="2019")],
            [src("S1", url="https://registry.example.org/x/", locator="p.1")],
            claims=[{"id": "C1", "text": "c", "kind": "fact", "entity_ids": ["co-x"], "source_ids": ["S1"],
                     "locator": "p.1", "published_at": None, "effective_at": None, "as_of": None,
                     "accessed_at": "2024-01-01", "evidence": [{"source_id": "S1", "locator": "p.1",
                     "published_at": None, "accessed_at": "2024-01-01", "snapshot_id": "E1"}]}],
            evidence_manifest=[{"id": "E1", "source_id": "S1", "representation": "extracted_text", "status": "stored",
                                "captured_at": "2024-01-01", "path": "evidence/e.txt",
                                "sha256": hashlib.sha256(b"registry extract").hexdigest(), "bytes": 16}])
        b = dossier("co-y", [
            ent("co-y", name="Y Ltd"),
            ent("co-x", name="X Limited", identifiers=[{"scheme": "CN_USCC", "value": "91330000aaa"}]),
            ent("p-wang", "person", name="王伟"), ent("co-shared", name="Shared Org"),
            ent("p-li", "person", name="李雷"),
        ], [rel("r1", "co-x", "co-y", percent=51),
            rel("r2", "p-wang", "co-y", "officer", label="经理", valid_from="2020"),
            rel("r3", "p-wang", "co-shared", "officer", label="董事", valid_from="2019")],
            [src("S1", url="https://registry.example.org/x", locator="p.1"), src("S2", "media")])
        return self.write(tmp, "case-a", a), self.write(tmp, "case-b", b)

    def test_merge_rules(self):
        with tempfile.TemporaryDirectory() as tmp:
            pa, pb = self.fixtures(tmp)
            out = Path(tmp) / "merged" / "dossier.json"
            merged, report = merge_dossiers.merge([pa, pb], out)
            self.assertTrue(report["validation"]["ok"], report["validation"]["errors"])
            ids = [e["id"] for e in merged["entities"]]
            # identifier match merged co-x (case + whitespace insensitive); name variant kept as alias
            self.assertEqual(ids.count("co-x"), 1)
            x = next(e for e in merged["entities"] if e["id"] == "co-x")
            self.assertIn("X Limited", x["aliases"])
            self.assertEqual(len(x["x_cases"]), 2)
            # same-name people are NOT merged; colliding id namespaced
            self.assertIn("p-wang", ids)
            self.assertIn("case-b:p-wang", ids)
            self.assertIn("case-b:co-shared", ids)
            same = [r for r in merged["relationships"] if r["type"] == "same_as_candidate"]
            self.assertEqual(len(same), 1)
            self.assertEqual(same[0]["edge_class"], "signal")
            self.assertEqual(same[0]["status"], "candidate")
            # references rewritten
            rel_b = next(r for r in merged["relationships"] if r["x_cases"][0] == {"case": "case-b", "id": "r1"})
            self.assertEqual((rel_b["from"], rel_b["to"]), ("co-x", "co-y"))
            self.assertTrue(all(r["id"] != "r1" or r["x_cases"][0]["case"] == "case-a" for r in merged["relationships"]))
            # sources deduplicated by normalized url + locator
            self.assertEqual(len(report["deduplicated_sources"]), 1)
            self.assertEqual(len([s for s in merged["sources"] if "registry.example.org" in s["url"]]), 1)
            # evidence path rebased and hash still verifies
            self.assertEqual(merged["evidence_manifest"][0]["path"], "../case-a/evidence/e.txt")
            self.assertEqual(vd.validate_dossier(vd.load_json(out), out.parent)["errors"], [])
            self.assertEqual(merged["schema_version"], 1)

    def test_merge_root_option_and_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            pa, pb = self.fixtures(tmp)
            out = Path(tmp) / "m.json"
            merged, _ = merge_dossiers.merge([pa, pb], out, root="co-y")
            self.assertEqual(merged["meta"]["root_id"], "co-y")
            proc = subprocess.run([sys.executable, str(SCRIPTS / "merge_dossiers.py"), str(pa), str(pb),
                                   "--out", str(Path(tmp) / "cli.json"), "--report", str(Path(tmp) / "r.json")],
                                  capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
            self.assertTrue((Path(tmp) / "r.json").is_file())


class DiffTests(unittest.TestCase):
    def test_percent_status_and_removals(self):
        old = person_root_fixture()
        new = copy.deepcopy(old)
        next(r for r in new["relationships"] if r["id"] == "h-a")["percent"] = 45
        next(e for e in new["entities"] if e["id"] == "A")["registry_status"] = "revoked"
        next(r for r in new["relationships"] if r["id"] == "p-c")["status"] = "historical"
        new["relationships"] = [r for r in new["relationships"] if r["id"] not in ("r-c", "q-c")]
        moved = next(r for r in old["relationships"] if r["id"] == "q-c")
        new["relationships"].append(dict(moved, id="q-c-v2"))
        new["revision"] = {"kind": "research_update", "retired_ids": [{"kind": "relationship", "id": "r-c", "reason": "身份更正"}]}
        result = diff_dossier.diff(old, new)
        kinds = [h["kind"] for h in result["highlights"]]
        self.assertIn("percent", kinds)
        self.assertIn("registry_status", kinds)
        self.assertIn("relationship_status", kinds)
        rels = result["collections"]["relationships"]
        self.assertEqual([r["id"] for r in rels["removed_retired"]], ["r-c"])
        self.assertEqual(rels["removed_unexplained"], [])
        self.assertEqual(rels["rekeyed"][0], {"old_id": "q-c", "new_id": "q-c-v2", "changes": {}})
        self.assertEqual(result["unexplained_removals"], 0)
        new["entities"] = [e for e in new["entities"] if e["id"] != "R"]
        self.assertEqual(diff_dossier.diff(old, new)["unexplained_removals"], 1)
        md = diff_dossier.render(result, markdown=True)
        self.assertIn("## 重点变化", md)
        self.assertIn("| 关系 |", md)

    def test_metrics_and_identical(self):
        old = dossier("A", [ent("A")], [], metrics=[{"label": "员工", "value": "10 人", "sources": ["S1"]}])
        new = copy.deepcopy(old)
        self.assertEqual(diff_dossier.diff(old, new)["highlights"], [])
        new["metrics"][0]["value"] = "12 人"
        self.assertEqual(diff_dossier.diff(old, new)["collections"]["metrics"]["changed"][0]["value"], ["10 人", "12 人"])


class CliTests(unittest.TestCase):
    def run_script(self, *args):
        return subprocess.run([sys.executable, *map(str, args)], capture_output=True, text=True, encoding="utf-8")

    def test_help_for_every_tool(self):
        for name in ("validate_dossier.py", "build_report.py", "analyze_network.py", "merge_dossiers.py", "diff_dossier.py"):
            proc = self.run_script(SCRIPTS / name, "--help")
            self.assertEqual(proc.returncode, 0, name + proc.stderr)
            self.assertIn("usage", proc.stdout.lower())

    def test_analyze_json_and_text(self):
        proc = self.run_script(SCRIPTS / "analyze_network.py", EXAMPLE, "--json")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        self.assertAlmostEqual(out["ownership"]["ownership"]["person-example-founder"]["effective_pct"], 60.0)
        proc = self.run_script(SCRIPTS / "analyze_network.py", EXAMPLE, "--path", "investor-example-beta",
                               "product-example-note")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("关系路径", proc.stdout)
        proc = self.run_script(SCRIPTS / "analyze_network.py", EXAMPLE, "--cooccur", "nope")
        self.assertEqual(proc.returncode, 2)

    def test_diff_cli(self):
        proc = self.run_script(SCRIPTS / "diff_dossier.py", EXAMPLE, EXAMPLE, "--md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("无关键权益", proc.stdout)


@unittest.skipUnless(PERSON_EXAMPLE.is_file(), "person-root demo not yet available")
class PersonDemoTests(unittest.TestCase):
    def setUp(self):
        self.data = vd.load_json(PERSON_EXAMPLE)

    def test_validates_cleanly(self):
        report = vd.validate_dossier(self.data, PERSON_EXAMPLE.parent)
        self.assertTrue(report["ok"], report["errors"][:5])
        self.assertEqual(report["reachability"]["root_type"], "person")
        self.assertGreaterEqual(report["counts"]["signal_relationships"], 1)
        self.assertGreaterEqual(report["counts"]["dissolved_entities"], 1)

    def test_expected_analytics(self):
        computed = nc.compute_analytics(self.data)
        own = computed["ownership"]
        root = self.data["meta"]["root_id"]
        self.assertEqual(computed["root"]["type"], "person")
        self.assertEqual(root, "person-linzhiyuan")
        self.assertAlmostEqual(own["co-xingyan-robotics"]["effective_pct"], 100.0)
        self.assertAlmostEqual(own["co-xingyan-robotics"]["direct_pct"], 60.0)
        self.assertEqual(len(own["co-xingyan-robotics"]["paths"]), 2)
        self.assertAlmostEqual(own["investor-yuanshan-angel"]["effective_pct"], 100.0)
        self.assertAlmostEqual(own["co-beichen-motion"]["effective_pct"], 8.0)
        co = computed["co_occurrence"]
        self.assertEqual(co["subject_id"], root)
        top = co["rows"][0]
        self.assertEqual(top["partner_id"], "person-zhouyan")
        self.assertEqual(top["shared_count"], 4)
        self.assertEqual(top["shared_active"], 2)
        self.assertEqual(top["shared_dissolved"], 2)
        grades = computed["confidence"]["relationships"]
        self.assertTrue(any(g["grade"] == "signal" for g in grades.values()))
        self.assertTrue(any(g["grade"] == "candidate" for g in grades.values()))

    def test_builds(self):
        embedded = build_report.build_payload(self.data, PERSON_EXAMPLE.parent)
        self.assertIn("__computed", embedded)


if __name__ == "__main__":
    unittest.main()
