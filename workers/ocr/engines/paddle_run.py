"""PaddleOCR 3.x Korean CPU runner. No guessing / no LLM cleanup."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "site-packages"))

from paddleocr import PaddleOCR


def texts_from_result(result) -> list[str]:
    lines: list[str] = []
    if result is None:
        return lines
    items = result if isinstance(result, list) else [result]
    for item in items:
        if item is None:
            continue
        if isinstance(item, dict):
            rec = item.get("rec_texts") or item.get("rec_text")
            if isinstance(rec, list):
                lines.extend(str(x) for x in rec if x)
            elif rec:
                lines.append(str(rec))
            continue
        if isinstance(item, list):
            for box in item:
                if box and len(box) >= 2 and isinstance(box[1], (list, tuple)):
                    lines.append(str(box[1][0]))
    return lines


def main() -> None:
    crops = ROOT / "data" / "crops"
    out_dir = ROOT / "runs" / "paddleocr"
    out_dir.mkdir(parents=True, exist_ok=True)
    engine = PaddleOCR(lang="korean")
    rows = []
    for path in sorted(crops.glob("S*.png")):
        started = time.perf_counter()
        try:
            raw = engine.predict(str(path))
            lines = texts_from_result(raw)
            error = None
        except Exception as exc:  # noqa: BLE001 — bake-off must record failures
            raw = None
            lines = []
            error = str(exc)
        elapsed = time.perf_counter() - started
        text = "\n".join(lines)
        row = {
            "sample_id": path.stem,
            "engine": "paddleocr-korean-v3",
            "engine_version": "3.7.0",
            "processing_mode": "SCAN_OCR",
            "seconds": round(elapsed, 3),
            "raw_text": text,
            "lines": lines,
            "error": error,
        }
        (out_dir / f"{path.stem}.json").write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
        rows.append(row)
        print(path.stem, elapsed, "ok" if not error else error[:80])
    (out_dir / "all.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
