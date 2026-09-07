"""Same PaddleOCR engine on contrast-normalized crops. Records whether preprocess helps."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "site-packages"))

from paddleocr import PaddleOCR
from preprocess import apply_preprocess
from engines.paddle_run import texts_from_result


def main() -> None:
    crops = ROOT / "data" / "crops"
    prep_dir = ROOT / "data" / "crops_contrast"
    out_dir = ROOT / "runs" / "paddleocr_contrast"
    prep_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    engine = PaddleOCR(lang="korean")
    rows = []
    for path in sorted(crops.glob("S*.png")):
        prepared = apply_preprocess(path, prep_dir / path.name, "contrast")
        started = time.perf_counter()
        try:
            lines = texts_from_result(engine.predict(str(prepared)))
            error = None
        except Exception as exc:  # noqa: BLE001
            lines = []
            error = str(exc)
        elapsed = time.perf_counter() - started
        row = {
            "sample_id": path.stem,
            "engine": "paddleocr-korean-contrast",
            "engine_version": "3.7.0",
            "processing_mode": "SCAN_OCR",
            "seconds": round(elapsed, 3),
            "raw_text": "\n".join(lines),
            "lines": lines,
            "error": error,
        }
        (out_dir / f"{path.stem}.json").write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
        rows.append(row)
        print(path.stem, elapsed, "ok" if not error else error[:80])
    (out_dir / "all.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
