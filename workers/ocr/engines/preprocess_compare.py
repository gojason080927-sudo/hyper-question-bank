"""Compare raw vs contrast vs 2x on the same 5 math-heavy crops. Windows OCR only."""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "site-packages"))

from preprocess import apply_preprocess
from engines.winocr_run import ocr_file, pick_engine

SAMPLES = ["S02", "S04", "S09", "S16", "S22"]
KINDS = ["raw", "gray", "contrast", "upscale2", "denoise"]


async def main() -> None:
    engine, lang = pick_engine()
    out_dir = ROOT / "runs" / "preprocess"
    out_dir.mkdir(parents=True, exist_ok=True)
    if engine is None:
        (out_dir / "SKIPPED.json").write_text(json.dumps({"skipped": True, "reason": "no winocr"}), encoding="utf-8")
        print("SKIPPED")
        return
    rows = []
    for sample in SAMPLES:
        src = ROOT / "data" / "crops" / f"{sample}.png"
        for kind in KINDS:
            dest = ROOT / "data" / "crops_prep" / kind / f"{sample}.png"
            dest.parent.mkdir(parents=True, exist_ok=True)
            apply_preprocess(src, dest, kind)
            started = time.perf_counter()
            try:
                text = await ocr_file(engine, dest)
                error = None
            except Exception as exc:  # noqa: BLE001
                text = ""
                error = str(exc)
            elapsed = time.perf_counter() - started
            rows.append({
                "sample_id": sample,
                "preprocess": kind,
                "engine": f"windows-media-ocr-{lang}",
                "seconds": round(elapsed, 3),
                "raw_text": text,
                "error": error,
            })
            preview = (text[:40] or error or "").replace("\n", " ").encode("ascii", "replace").decode("ascii")
            print(sample, kind, elapsed, preview)
    (out_dir / "all.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
