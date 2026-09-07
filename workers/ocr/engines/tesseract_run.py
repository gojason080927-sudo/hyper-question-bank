"""Tesseract Korean+English runner if a local binary exists. No guessing."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "site-packages"))


def find_tesseract() -> str | None:
    env = os.environ.get("TESSERACT_EXE")
    if env and Path(env).exists():
        return env
    local = ROOT / "tesseract" / "tesseract.exe"
    if local.exists():
        return str(local)
    return shutil.which("tesseract")


def main() -> None:
    exe = find_tesseract()
    out_dir = ROOT / "runs" / "tesseract"
    out_dir.mkdir(parents=True, exist_ok=True)
    if not exe:
        (out_dir / "SKIPPED.json").write_text(
            json.dumps({"skipped": True, "reason": "tesseract binary not installed in worker dir"}, indent=2),
            encoding="utf-8",
        )
        print("SKIPPED: tesseract binary not found")
        return
    crops = ROOT / "data" / "crops"
    rows = []
    for path in sorted(crops.glob("S*.png")):
        started = time.perf_counter()
        try:
            completed = subprocess.run(
                [exe, str(path), "stdout", "-l", "kor+eng", "--psm", "6"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            text = (completed.stdout or "").strip()
            error = None if completed.returncode == 0 else (completed.stderr or "tesseract failed")
        except Exception as exc:  # noqa: BLE001
            text = ""
            error = str(exc)
        elapsed = time.perf_counter() - started
        row = {
            "sample_id": path.stem,
            "engine": "tesseract-kor-eng",
            "engine_version": "unknown",
            "processing_mode": "SCAN_OCR",
            "seconds": round(elapsed, 3),
            "raw_text": text,
            "lines": [line for line in text.splitlines() if line.strip()],
            "error": error,
        }
        (out_dir / f"{path.stem}.json").write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
        rows.append(row)
        print(path.stem, elapsed, "ok" if not error else str(error)[:80])
    (out_dir / "all.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
