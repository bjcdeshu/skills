#!/usr/bin/env python3
"""Build a portable, offline dossier HTML from its one JSON data source.

The dossier JSON is never modified.  Graph analytics (penetrating ownership,
co-occurrence, confidence grades, centrality) are computed from it at build time
and embedded into the HTML payload only, as ``__computed``.
"""

import argparse
import base64
import copy
import json
from pathlib import Path
import re
import sys

from validate_dossier import load_json, print_report, read_asset, validate_dossier
from network_core import compute_analytics, utf8_stdio


def build_payload(data, base_dir, analytics=True, threshold=25.0):
    """Return the embedded copy: data URIs for images plus ``__computed`` analytics."""
    embedded = copy.deepcopy(data)
    for asset in embedded.get("assets", []):
        mime, raw = read_asset(asset, base_dir)
        asset["mime"] = mime
        asset["data_uri"] = "data:" + mime + ";base64," + base64.b64encode(raw).decode("ascii")
    if analytics:
        embedded["__computed"] = compute_analytics(data, threshold=threshold)
    return embedded


def serialize_payload(embedded):
    payload = json.dumps(embedded, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    payload = payload.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    return payload.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def build_report(input_path, output_path, analytics=True, threshold=25.0):
    input_path = Path(input_path).resolve()
    output_path = Path(output_path).resolve()
    if input_path == output_path:
        raise ValueError("输出路径不能覆盖原始 JSON 数据文件")
    data = load_json(input_path)
    report = validate_dossier(data, input_path.parent)
    print_report(report)
    if not report["ok"]:
        raise ValueError("数据验证失败，未生成报告")
    embedded = build_payload(data, input_path.parent, analytics, threshold)
    assets_dir = Path(__file__).resolve().parent.parent / "assets"
    template = (assets_dir / "report.html").read_text(encoding="utf-8")
    css = (assets_dir / "report.css").read_text(encoding="utf-8")
    javascript = (assets_dir / "report.js").read_text(encoding="utf-8")
    payload = serialize_payload(embedded)
    replacements = {"__DOSSIER_JSON__": payload, "__DOSSIER_CSS__": css, "__DOSSIER_JS__": javascript}
    for token in replacements:
        if template.count(token) != 1:
            raise ValueError(f"模板占位符 {token} 必须恰好出现一次")
    if re.search(r"</\s*style", css, re.I) or re.search(r"</\s*script", javascript, re.I):
        raise ValueError("CSS/JS 模板含结束标签，不能安全内联")
    pattern = re.compile("|".join(re.escape(token) for token in replacements))
    html = pattern.sub(lambda match: replacements[match.group(0)], template)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    return output_path


def main():
    utf8_stdio()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dossier", type=Path, help="统一资料 JSON")
    parser.add_argument("--out", required=True, type=Path, help="输出 HTML 文件")
    parser.add_argument("--threshold", type=float, default=25.0, help="重要股东穿透比例阈值（%%，默认 25）")
    parser.add_argument("--no-analytics", action="store_true", help="不嵌入 __computed 图谱分析结果")
    args = parser.parse_args()
    try:
        destination = build_report(args.dossier, args.out, not args.no_analytics, args.threshold)
    except (OSError, ValueError, TypeError, RecursionError) as exc:
        print("构建失败：" + str(exc), file=sys.stderr)
        return 1
    print("已生成：" + str(destination))
    return 0


if __name__ == "__main__":
    sys.exit(main())
