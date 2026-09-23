#!/usr/bin/env python3
"""Extract 쎈 유형/개념 heading pills from page PNGs. Local cache only. Never writes OCR to the DB."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageOps
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PAGES_DIR = ROOT / ".ocr-temp" / "step8-39" / "pages"
OUT_PATH = ROOT / "ocr-tests" / "taxonomy" / "ssen-classify" / "page-headings.json"


def hsv(im: Image.Image):
    arr = np.array(im.convert("RGB"))
    r, g, b = arr[:, :, 0].astype(np.float32), arr[:, :, 1].astype(np.float32), arr[:, :, 2].astype(np.float32)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    df = np.maximum(mx - mn, 1e-6)
    h = np.zeros_like(mx)
    mask = mx - mn > 2
    idx = (mx == g) & mask
    h[idx] = 60.0 * (b[idx] - r[idx]) / df[idx] + 120.0
    idx = (mx == b) & mask
    h[idx] = 60.0 * (r[idx] - g[idx]) / df[idx] + 240.0
    idx = (mx == r) & mask
    h[idx] = (60.0 * (g[idx] - b[idx]) / df[idx]) % 360.0
    s = np.where(mx == 0, 0.0, (mx - mn) / np.maximum(mx, 1.0))
    v = mx / 255.0
    return h, s, v


def connected(mask: np.ndarray):
    height, width = mask.shape
    vis = np.zeros_like(mask, dtype=bool)
    boxes = []
    ys, xs = np.where(mask)
    for y, x in zip(ys, xs):
        if vis[y, x]:
            continue
        q = deque([(int(y), int(x))])
        vis[y, x] = True
        minx = maxx = int(x)
        miny = maxy = int(y)
        n = 0
        while q:
            cy, cx = q.popleft()
            n += 1
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not vis[ny, nx]:
                    vis[ny, nx] = True
                    q.append((ny, nx))
                    minx = min(minx, nx)
                    maxx = max(maxx, nx)
                    miny = min(miny, ny)
                    maxy = max(maxy, ny)
        boxes.append((minx, miny, maxx, maxy, n))
    return boxes


def tess(im: Image.Image, psm: int = 7) -> str:
    path = "/tmp/ssen-heading-ocr.png"
    im.save(path)
    proc = subprocess.run(
        ["tesseract", path, "stdout", "-l", "kor+eng", "--psm", str(psm)],
        capture_output=True,
        text=True,
        check=False,
    )
    return " ".join(proc.stdout.split())


def prep_badge(im: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(im)
    gray = gray.resize((gray.width * 4, gray.height * 4), Image.Resampling.LANCZOS)
    gray = ImageOps.invert(gray)
    gray = ImageOps.autocontrast(gray)
    return gray.point(lambda x: 0 if x < 140 else 255)


def prep_title(im: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(im)
    gray = gray.resize((gray.width * 3, gray.height * 3), Image.Resampling.LANCZOS)
    return ImageOps.autocontrast(gray)


def is_pill(w: int, h: int, n: int) -> bool:
    if w < 28 or w > 90 or h < 12 or h > 42:
        return False
    if n < 150 or n > 2800:
        return False
    ratio = w / max(h, 1)
    return 1.05 <= ratio <= 4.0


def extract_page(path: Path, page: int) -> list[dict]:
    im = Image.open(path)
    width, height = im.size
    h, s, v = hsv(im)
    green = (h > 80) & (h < 150) & (s > 0.25) & (v > 0.35)
    orange = (h > 8) & (h < 42) & (s > 0.35) & (v > 0.45)
    cyan = (h > 195) & (h < 235) & (s > 0.25) & (v > 0.35)
    hits: list[dict] = []

    top = cyan[: int(height * 0.22), : int(width * 0.45)]
    if int(top.sum()) > 1800:
        hits.append(
            {
                "page": page,
                "y_norm": 0.04,
                "x_norm": 0.08,
                "kind": "c_stage",
                "title_ocr": "실력 굳히기",
                "badge_ocr": "C",
            }
        )

    for kind, mask in (("type_pill", green), ("concept_pill", orange)):
        for x0, y0, x1, y1, n in connected(mask):
            w, ht = x1 - x0 + 1, y1 - y0 + 1
            if not is_pill(w, ht, n):
                continue
            if y0 < 28 and x0 < 80:
                continue
            badge = im.crop((max(0, x0 - 2), max(0, y0 - 2), min(width, x1 + 4), min(height, y1 + 3)))
            title = im.crop((min(width, x1 + 2), max(0, y0 - 8), min(width, x1 + 430), min(height, y1 + 12)))
            badge_ocr = tess(prep_badge(badge), 8)
            title_ocr = tess(prep_title(title), 7)
            hits.append(
                {
                    "page": page,
                    "y_norm": round(((y0 + y1) / 2) / height, 4),
                    "x_norm": round(((x0 + x1) / 2) / width, 4),
                    "kind": kind,
                    "title_ocr": title_ocr,
                    "badge_ocr": badge_ocr,
                }
            )
    return hits


def main() -> int:
    if not PAGES_DIR.is_dir():
        print(f"missing page PNGs at {PAGES_DIR}", file=sys.stderr)
        return 1
    pages = sorted(PAGES_DIR.glob("p*.png"))
    if len(pages) != 192:
        print(f"expected 192 page PNGs, found {len(pages)}", file=sys.stderr)
        return 1
    all_hits: list[dict] = []
    for path in pages:
        page = int(path.stem.lstrip("p"))
        hits = extract_page(path, page)
        all_hits.extend(hits)
        kinds = {}
        for hit in hits:
            kinds[hit["kind"]] = kinds.get(hit["kind"], 0) + 1
        if hits:
            print(f"p{page:03d}", kinds, [hit["kind"][0] + ":" + (hit["title_ocr"][:24] or hit["badge_ocr"][:12]) for hit in hits])
        elif page % 20 == 0:
            print(f"p{page:03d} none")
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "ssen-page-png-pills",
        "page_count": 192,
        "heading_count": len(all_hits),
        "type_pills": sum(1 for row in all_hits if row["kind"] == "type_pill"),
        "concept_pills": sum(1 for row in all_hits if row["kind"] == "concept_pill"),
        "c_stage": sum(1 for row in all_hits if row["kind"] == "c_stage"),
        "hits": all_hits,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: payload[k] for k in payload if k != "hits"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
