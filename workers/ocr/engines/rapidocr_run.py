"""RapidOCR ONNX CPU runner. Same crops. No guessing."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "site-packages"))

from rapidocr_onnxruntime import RapidOCR


def main() -> None:
    out_dir = ROOT / "runs" / "rapidocr"
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        engine = RapidOCR()
    except Exception as exc:  # noqa: BLE001
        (out_dir / "SKIPPED.json").write_text(
            json.dumps({"skipped": True, "reason": f"RapidOCR init failed: {exc}"}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print("SKIPPED", exc)
        return
    rows = []
    for path in sorted((ROOT / "data" / "crops").glob("S*.png")):
        started = time.perf_counter()
        try:
            result, _elapse = engine(str(path))
            lines = [str(item[1]) for item in (result or []) if item and len(item) > 1]
            error = None
        except Exception as exc:  # noqa: BLE001
            lines = []
            error = str(exc)
        elapsed = time.perf_counter() - started
        text = "\n".join(lines)
        row = {
            "sample_id": path.stem,
            "engine": "rapidocr-onnxruntime",
            "engine_version": "unknown",
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
