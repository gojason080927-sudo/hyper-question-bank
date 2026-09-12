#!/usr/bin/env python3
"""Crop STEP 8.32 problem regions from rendered page PNGs. Gitignored output."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


def crop_region(page_png: Path, bbox: dict, dest: Path, pad: float = 0.004) -> dict:
    image = Image.open(page_png)
    w, h = image.size
    x = max(0.0, float(bbox["x"]) - pad)
    y = max(0.0, float(bbox["y"]) - pad)
    width = min(1.0 - x, float(bbox["width"]) + pad)
    height = min(1.0 - y, float(bbox["height"]) + pad)
    box = (int(x * w), int(y * h), int((x + width) * w), int((y + height) * h))
    dest.parent.mkdir(parents=True, exist_ok=True)
    cropped = image.crop(box)
    cropped.save(dest, format="PNG")
    blob = dest.read_bytes()
    return {
        "path": str(dest),
        "bytes": len(blob),
        "sha256": hashlib.sha256(blob).hexdigest(),
        "width": cropped.size[0],
        "height": cropped.size[1],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages-dir", required=True)
    parser.add_argument("--regions", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--pad", type=float, default=0.004)
    args = parser.parse_args()

    pages_dir = Path(args.pages_dir)
    dest_dir = Path(args.out)
    dest_dir.mkdir(parents=True, exist_ok=True)
    spec = json.loads(Path(args.regions).read_text(encoding="utf-8"))
    rows = []
    for item in spec.get("regions", []):
        page = int(item["page"])
        candidate_id = str(item["candidate_id"])
        page_png = pages_dir / f"p{page:03d}.png"
        if not page_png.exists():
            rows.append({"candidate_id": candidate_id, "page": page, "present": False, "error": "missing_page_png"})
            continue
        dest = dest_dir / f"{candidate_id}.png"
        try:
            meta = crop_region(page_png, item["bbox"], dest, pad=args.pad)
            rows.append({"candidate_id": candidate_id, "page": page, "present": True, **meta, "error": None})
        except Exception as exc:  # noqa: BLE001 — per-item crop must not abort the book
            rows.append({"candidate_id": candidate_id, "page": page, "present": False, "error": str(exc)})
            print("crop-fail", candidate_id, exc, flush=True)
    (dest_dir.parent / "crop-hashes.json").write_text(
        json.dumps({"pad": args.pad, "crops": rows}, indent=2),
        encoding="utf-8",
    )
    print("cropped", sum(1 for row in rows if row.get("present")), "/", len(rows), flush=True)


if __name__ == "__main__":
    main()
