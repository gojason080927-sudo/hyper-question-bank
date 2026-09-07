"""Render the same page+bbox crops for every engine."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "site-packages"))

import pypdfium2 as pdfium

from render_pages import PDF, crop_region, render_page

SAMPLES = ROOT / "samples.json"
PAGES = ROOT / "data" / "pages_hi"
CROPS = ROOT / "data" / "crops"


def main() -> None:
    spec = json.loads(SAMPLES.read_text(encoding="utf-8"))
    scale = float(spec["render_scale"])
    pdf = pdfium.PdfDocument(str(PDF))
    needed = sorted({row["page_number"] for row in spec["samples"]})
    for page_number in needed:
        render_page(pdf, page_number, scale, PAGES / f"p{page_number:03d}.png")
        print("page", page_number)
    pdf.close()
    for row in spec["samples"]:
        crop_region(
            PAGES / f"p{row['page_number']:03d}.png",
            row["bbox"],
            CROPS / f"{row['id']}.png",
            pad=0.004,
        )
        print("crop", row["id"])


if __name__ == "__main__":
    main()
