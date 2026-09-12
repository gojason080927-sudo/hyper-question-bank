#!/usr/bin/env python3
"""Render all 192 SSEN pages from a hash-checked original PDF. Gitignored output."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import pypdfium2 as pdfium

EXPECTED_SHA256 = "ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292"
EXPECTED_PAGES = 192


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ink_ratio(image) -> float:
    gray = image.convert("L")
    hist = gray.histogram()
    dark = sum(hist[:200])
    return dark / max(1, gray.size[0] * gray.size[1])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--scale", type=float, default=2.0)
    parser.add_argument("--from-page", type=int, default=1)
    parser.add_argument("--to-page", type=int, default=EXPECTED_PAGES)
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    out = Path(args.out)
    pages_dir = out / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    if not pdf_path.exists():
        raise SystemExit(f"missing pdf: {pdf_path}")
    digest = sha256_file(pdf_path)
    if digest != EXPECTED_SHA256:
        raise SystemExit(f"PDF hash mismatch: {digest}")

    pdf = pdfium.PdfDocument(str(pdf_path))
    page_count = len(pdf)
    if page_count != EXPECTED_PAGES:
        pdf.close()
        raise SystemExit(f"page count {page_count} != {EXPECTED_PAGES}")

    start = max(1, args.from_page)
    end = min(page_count, args.to_page)
    rows = []
    for page_number in range(start, end + 1):
        dest = pages_dir / f"p{page_number:03d}.png"
        page = pdf[page_number - 1]
        bitmap = page.render(scale=args.scale)
        image = bitmap.to_pil()
        image.save(dest, format="PNG")
        blob = dest.read_bytes()
        rows.append(
            {
                "page": page_number,
                "path": str(dest),
                "bytes": len(blob),
                "sha256": hashlib.sha256(blob).hexdigest(),
                "width": image.size[0],
                "height": image.size[1],
                "ink_ratio": round(ink_ratio(image), 6),
            }
        )
        print(f"page {page_number}/{end}", dest.name, len(blob), flush=True)
    pdf.close()

    inventory = {
        "pdf_sha256": digest,
        "page_count": page_count,
        "scale": args.scale,
        "from_page": start,
        "to_page": end,
        "rendered": len(rows),
        "pages": rows,
    }
    (out / "page-inventory.json").write_text(json.dumps(inventory, indent=2), encoding="utf-8")
    print("rendered", len(rows), "pages", file=sys.stderr)


if __name__ == "__main__":
    main()
