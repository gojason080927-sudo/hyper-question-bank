"""Windows.Media.Ocr bake-off. No guessing. Korean if the OS pack exists."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "site-packages"))

import asyncio

from winrt.windows.globalization import Language
from winrt.windows.graphics.imaging import BitmapDecoder
from winrt.windows.media.ocr import OcrEngine
from winrt.windows.storage import FileAccessMode, StorageFile


async def ocr_file(engine: OcrEngine, path: Path) -> str:
    file = await StorageFile.get_file_from_path_async(str(path))
    stream = await file.open_async(FileAccessMode.READ)
    decoder = await BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    result = await engine.recognize_async(bitmap)
    return (result.text or "").strip() if result else ""


def pick_engine() -> tuple[OcrEngine | None, str]:
    korean = OcrEngine.try_create_from_language(Language("ko"))
    if korean:
        return korean, "ko"
    korean = OcrEngine.try_create_from_language(Language("ko-KR"))
    if korean:
        return korean, "ko-KR"
    profile = OcrEngine.try_create_from_user_profile_languages()
    if profile:
        return profile, "user-profile"
    return None, "none"


async def main_async() -> None:
    out_dir = ROOT / "runs" / "winocr"
    out_dir.mkdir(parents=True, exist_ok=True)
    engine, lang = pick_engine()
    if engine is None:
        payload = {
            "skipped": True,
            "reason": "Windows OCR engine could not be created. Korean OCR language pack may be missing.",
            "available_languages": [str(item) for item in (OcrEngine.available_recognizer_languages or [])],
        }
        (out_dir / "SKIPPED.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print("SKIPPED: Windows OCR engine unavailable")
        return
    print("winocr lang", lang)
    rows = []
    for path in sorted((ROOT / "data" / "crops").glob("S*.png")):
        started = time.perf_counter()
        try:
            text = await ocr_file(engine, path)
            error = None
        except Exception as exc:  # noqa: BLE001
            text = ""
            error = str(exc)
        elapsed = time.perf_counter() - started
        row = {
            "sample_id": path.stem,
            "engine": f"windows-media-ocr-{lang}",
            "engine_version": "winrt-3.2.1",
            "processing_mode": "SCAN_OCR",
            "seconds": round(elapsed, 3),
            "raw_text": text,
            "lines": [line for line in text.splitlines() if line.strip()],
            "error": error,
        }
        (out_dir / f"{path.stem}.json").write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
        rows.append(row)
        print(path.stem, elapsed, "ok" if not error else error[:80])
    (out_dir / "all.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
