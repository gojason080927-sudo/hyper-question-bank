"""Score OCR raw text against human ground truth. No LLM restore."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "site-packages"))

HANGUL = re.compile(r"[가-힣]")
DIGIT = re.compile(r"\d")


def cer(hyp: str, ref: str) -> float:
    if not ref:
        return 1.0 if hyp else 0.0
    rows = [[0] * (len(ref) + 1) for _ in range(len(hyp) + 1)]
    for i in range(len(hyp) + 1):
        rows[i][0] = i
    for j in range(len(ref) + 1):
        rows[0][j] = j
    for i, hc in enumerate(hyp, start=1):
        for j, rc in enumerate(ref, start=1):
            cost = 0 if hc == rc else 1
            rows[i][j] = min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
    return rows[len(hyp)][len(ref)] / len(ref)


def wer(hyp: str, ref: str) -> float:
    return cer(hyp.split(), ref.split()) if isinstance(ref, str) else 1.0


def compact(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def has_all(text: str, tokens: list[str]) -> tuple[int, int]:
    hit = sum(1 for token in tokens if token and token in text)
    return hit, len(tokens)


def critical_errors(text: str, item: dict) -> list[str]:
    errors: list[str] = []
    compact_text = compact(text)
    for rule in item.get("math_critical_if_collapsed") or []:
        src = compact(rule["from"])
        bad = compact(rule["not"])
        if src and src not in compact_text and bad and bad in compact_text:
            errors.append(f"MATH_CRITICAL: {rule['from']} collapsed toward {rule['not']}")
    raw = text or ""
    if item.get("radicals_must") and any("√" in token for token in item["radicals_must"]):
        if "√" not in raw and re.search(r"[Vv√]|루트", raw) is None:
            if any(token.replace("√", "") in compact_text for token in item["radicals_must"]):
                errors.append("MATH_CRITICAL: radical sign missing")
    if item.get("inequalities_must"):
        if "≤" in "".join(item["inequalities_must"]) and "≤" not in raw and "<=" not in raw:
            if "<" in raw:
                errors.append("MATH_CRITICAL: ≤ flattened to <")
        if "≥" in "".join(item["inequalities_must"]) and "≥" not in raw and ">=" not in raw:
            if ">" in raw:
                errors.append("MATH_CRITICAL: ≥ flattened to >")
    if any("|" in token for token in item.get("parens_abs_must") or []):
        if raw.count("|") < 2:
            errors.append("MATH_CRITICAL: absolute-value bars missing")
    return errors


def classify(hit_rate: float, critical: list[str], failed: bool, korean_rate: float) -> str:
    if failed:
        return "RED"
    if critical:
        return "RED"
    if hit_rate >= 0.75 and korean_rate >= 0.7:
        return "GREEN"
    if hit_rate >= 0.4 or korean_rate >= 0.5:
        return "YELLOW"
    return "RED"


def score_engine(name: str, rows: list[dict], truths: list[dict]) -> dict:
    by_id = {row["sample_id"]: row for row in rows}
    details = []
    counts = {"GREEN": 0, "YELLOW": 0, "RED": 0}
    critical_total = 0
    times = []
    failures = 0
    metric_hits = {key: [0, 0] for key in [
        "korean", "digits", "operators", "superscripts", "subscripts",
        "fractions", "radicals", "inequalities", "parens_abs", "choices",
        "problem_number", "figure_table",
    ]}
    for item in truths:
        row = by_id.get(item["sample_id"], {})
        text = row.get("raw_text") or ""
        failed = bool(row.get("error")) or row.get("skipped") or not text.strip()
        if failed:
            failures += 1
        compact_text = compact(text)
        dim = {}
        for key, field in [
            ("korean", "korean_must"),
            ("digits", "digits_must"),
            ("operators", "operators_must"),
            ("superscripts", "superscripts_must"),
            ("subscripts", "subscripts_must"),
            ("fractions", "fractions_must"),
            ("radicals", "radicals_must"),
            ("inequalities", "inequalities_must"),
            ("parens_abs", "parens_abs_must"),
            ("choices", "choices_must"),
        ]:
            hit, total = has_all(text if key != "superscripts" else compact_text, item.get(field) or [])
            if key == "superscripts":
                hit, total = has_all(text, item.get(field) or [])
            dim[key] = {"hit": hit, "total": total}
            metric_hits[key][0] += hit
            metric_hits[key][1] += total
        pn = item.get("problem_number")
        pn_ok = pn is None or (pn in text)
        dim["problem_number"] = {"hit": 1 if pn_ok else 0, "total": 0 if pn is None else 1}
        metric_hits["problem_number"][0] += dim["problem_number"]["hit"]
        metric_hits["problem_number"][1] += dim["problem_number"]["total"]
        figure_needed = bool(item.get("has_figure") or item.get("has_table"))
        fig_ok = bool(re.search(r"그림|표에서|그래프", text)) if figure_needed else False
        dim["figure_table"] = {"hit": 1 if fig_ok else 0, "total": 1 if figure_needed else 0}
        if figure_needed:
            metric_hits["figure_table"][0] += dim["figure_table"]["hit"]
            metric_hits["figure_table"][1] += dim["figure_table"]["total"]
        crit = [] if failed else critical_errors(text, item)
        critical_total += len(crit)
        tokens = []
        for field in ["korean_must", "digits_must", "operators_must", "superscripts_must", "choices_must"]:
            tokens.extend(item.get(field) or [])
        hit, total = has_all(text, tokens)
        korean_hit, korean_total = has_all(text, item.get("korean_must") or [])
        korean_rate = (korean_hit / korean_total) if korean_total else 1.0
        hit_rate = (hit / total) if total else (0.0 if failed else 0.5)
        ref = compact(item.get("ground_truth_text") or "")
        hyp = compact(text)
        sample_cer = cer(hyp, ref)
        verdict = classify(hit_rate, crit, failed, korean_rate)
        counts[verdict] += 1
        if row.get("seconds") is not None:
            times.append(float(row["seconds"]))
        details.append({
            "sample_id": item["sample_id"],
            "category": item["category"],
            "verdict": verdict,
            "cer": round(sample_cer, 3),
            "hit_rate": round(hit_rate, 3),
            "korean_rate": round(korean_rate, 3),
            "critical": crit,
            "seconds": row.get("seconds"),
            "failed": failed,
            "preview": text[:180].replace("\n", " / "),
        })
    rates = {
        key: (round(val[0] / val[1], 3) if val[1] else None)
        for key, val in metric_hits.items()
    }
    return {
        "engine": name,
        "sample_count": len(truths),
        "GREEN": counts["GREEN"],
        "YELLOW": counts["YELLOW"],
        "RED": counts["RED"],
        "math_critical_errors": critical_total,
        "failure_rate": round(failures / len(truths), 3) if truths else 1,
        "sec_per_crop": round(sum(times) / len(times), 3) if times else None,
        "metrics": rates,
        "details": details,
    }


def load_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    if path.name == "SKIPPED.json" or path.name == "RUNTIME_FAIL.json":
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and data.get("skipped"):
        return []
    if isinstance(data, list):
        return data
    return []


def main() -> None:
    truths = json.loads((ROOT / "ground-truth.json").read_text(encoding="utf-8"))["items"]
    engines = {
        "paddleocr-korean-v3": ROOT / "runs" / "paddleocr" / "all.json",
        "tesseract-kor-eng": ROOT / "runs" / "tesseract" / "all.json",
        "tesseractjs-kor-eng": ROOT / "runs" / "tesseractjs" / "all.json",
        "tesseractjs-contrast": ROOT / "runs" / "tesseractjs_contrast" / "all.json",
        "windows-media-ocr": ROOT / "runs" / "winocr" / "all.json",
        "rapidocr": ROOT / "runs" / "rapidocr" / "all.json",
        "pix2text": ROOT / "runs" / "pix2text" / "all.json",
    }
    reports = []
    for name, path in engines.items():
        rows = load_rows(path)
        if not rows:
            fail_note = None
            for extra in [path.with_name("SKIPPED.json"), path.with_name("RUNTIME_FAIL.json")]:
                if extra.exists():
                    fail_note = json.loads(extra.read_text(encoding="utf-8"))
            reports.append({
                "engine": name,
                "ran": False,
                "note": fail_note or {"reason": f"no results at {path}"},
            })
            continue
        reports.append({**score_engine(name, rows, truths), "ran": True})
    out = ROOT / "runs" / "SCOREBOARD.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps([{k: v for k, v in row.items() if k != "details"} for row in reports], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
