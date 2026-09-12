#!/usr/bin/env python3
"""Render STEP 7 sample crops from a verified SSEN original PDF. Does not write git."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "workers/ocr/samples.json"
MANIFEST = ROOT / "workers/ocr/corpus-manifest.json"


def render_page(pdf: pdfium.PdfDocument, page_number: int, scale: float, dest: Path) -> Path:
    page = pdf[page_number - 1]
    bitmap = page.render(scale=scale)
    image = bitmap.to_pil()
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.save(dest, format="PNG")
    return dest


def crop_region(page_png: Path, bbox: dict, dest: Path, pad: float = 0.0) -> Path:
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
    return dest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--scale", type=float, default=2.5)
    parser.add_argument("--pad", type=float, default=0.004)
    args = parser.parse_args()
    pdf_path = Path(args.pdf)
    out = Path(args.out)
    if not pdf_path.exists():
        raise SystemExit(f"missing pdf: {pdf_path}")
    spec = json.loads(SAMPLES.read_text(encoding="utf-8"))
    pages_dir = out / "pages"
    crops_dir = out / "crops"
    pdf = pdfium.PdfDocument(str(pdf_path))
    needed = sorted({int(row["page_number"]) for row in spec["samples"]})
    for page_number in needed:
        render_page(pdf, page_number, args.scale, pages_dir / f"p{page_number:03d}.png")
    pdf.close()
    rows = []
    for row in spec["samples"]:
        dest = crops_dir / f"{row['id']}.png"
        crop_region(pages_dir / f"p{row['page_number']:03d}.png", row["bbox"], dest, pad=args.pad)
        blob = dest.read_bytes()
        rows.append(
            {
                "sample_id": row["id"],
                "page_number": row["page_number"],
                "path": str(dest),
                "bytes": len(blob),
                "sha256": hashlib.sha256(blob).hexdigest(),
                "width": Image.open(dest).size[0],
                "height": Image.open(dest).size[1],
            }
        )
        print("crop", row["id"], dest)
    (out / "crop-hashes.json").write_text(json.dumps({"scale": args.scale, "pad": args.pad, "crops": rows}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
