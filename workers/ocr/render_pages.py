"""Render selected SCAN pages from the local 쎈수학 PDF copy. Does not modify the original."""
from __future__ import annotations

import argparse
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image

ROOT = Path(__file__).resolve().parent
PDF = ROOT / "data" / "ssen-common-math1.pdf"
OUT = ROOT / "data" / "pages"


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
    x = max(0.0, bbox["x"] - pad)
    y = max(0.0, bbox["y"] - pad)
    width = min(1.0 - x, bbox["width"] + pad)
    height = min(1.0 - y, bbox["height"] + pad)
    box = (int(x * w), int(y * h), int((x + width) * w), int((y + height) * h))
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.crop(box).save(dest, format="PNG")
    return dest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", default="8,12,20,28,36,44,52,60,72,84,96,108,120,132,144,156,168,180")
    parser.add_argument("--scale", type=float, default=1.6, help="1.6 ≈ 115 DPI survey; 2.5 ≈ 180 DPI crops")
    args = parser.parse_args()
    if not PDF.exists():
        raise SystemExit(f"missing local PDF copy: {PDF}")
    pdf = pdfium.PdfDocument(str(PDF))
    print(f"page_count={len(pdf)}")
    for raw in args.pages.split(","):
        page_number = int(raw.strip())
        dest = OUT / f"p{page_number:03d}.png"
        render_page(pdf, page_number, args.scale, dest)
        print(dest)
    pdf.close()


if __name__ == "__main__":
    main()
