"""STEP 8.22 visual figure detector v1.

Source of truth: original page PNG (or a local PDF render copy).
No paid OCR. No cloud vision. PIL only.
Does not overwrite source PDFs or production storage.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "workers" / "ocr"))
sys.path.insert(0, str(ROOT / "workers" / "ocr" / "site-packages"))

from PIL import Image

DEFAULTS = {
    "ink": 200,
    "max_w": 420,
    "dilate": 2,
    "min_area_frac": 0.0032,
    "max_area_frac": 0.36,
    "min_w": 0.055,
    "min_h": 0.028,
    "merge_gap": 0.026,
    "text_keep": 0.42,
    "header_y": 0.072,
    "footer_y": 0.955,
}


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def downsample(image: Image.Image, max_w: int) -> tuple[Image.Image, float]:
    rgb = image.convert("RGB")
    w, h = rgb.size
    if w <= max_w:
        return rgb, 1.0
    scale = max_w / w
    return rgb.resize((max_w, max(1, int(h * scale))), Image.Resampling.BILINEAR), scale


def ink_mask(gray: Image.Image, ink: int) -> list[list[bool]]:
    rgb = gray.convert("RGB")
    pixels = rgb.load()
    w, h = rgb.size
    out: list[list[bool]] = []
    for y in range(h):
        row: list[bool] = []
        for x in range(w):
            r, g, b = pixels[x, y]
            mean = (r + g + b) / 3
            chroma = max(r, g, b) - min(r, g, b)
            row.append(mean < ink or (chroma >= 18 and mean < 248))
        out.append(row)
    return out


def dilate(mask: list[list[bool]], radius: int) -> list[list[bool]]:
    if radius <= 0:
        return mask
    h = len(mask)
    w = len(mask[0]) if h else 0
    out = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if not mask[y][x]:
                continue
            for dy in range(-radius, radius + 1):
                yy = y + dy
                if yy < 0 or yy >= h:
                    continue
                for dx in range(-radius, radius + 1):
                    xx = x + dx
                    if 0 <= xx < w:
                        out[yy][xx] = True
    return out


def apply_text_keep(mask: list[list[bool]], boxes: list[dict], keep: float, w: int, h: int) -> list[list[bool]]:
    """Down-weight text ink without permanently erasing potential figure lines."""
    if keep >= 0.99 or not boxes:
        return mask
    text = [[False] * w for _ in range(h)]
    for box in boxes:
        bb = box.get("bbox") or box
        x0 = max(0, int(float(bb["x"]) * w))
        y0 = max(0, int(float(bb["y"]) * h))
        x1 = min(w, int((float(bb["x"]) + float(bb["width"])) * w))
        y1 = min(h, int((float(bb["y"]) + float(bb["height"])) * h))
        for y in range(y0, y1):
            row = text[y]
            for x in range(x0, x1):
                row[x] = True
    out = [row[:] for row in mask]
    stride = 2 if keep < 0.5 else 3
    for y in range(h):
        for x in range(w):
            if text[y][x] and out[y][x] and ((x + y) % stride):
                out[y][x] = False
    return out


def connected_components(mask: list[list[bool]], min_area: int) -> list[tuple[int, int, int, int, int]]:
    h = len(mask)
    w = len(mask[0]) if h else 0
    seen = [[False] * w for _ in range(h)]
    comps = []
    for y in range(h):
        for x in range(w):
            if not mask[y][x] or seen[y][x]:
                continue
            q = deque([(x, y)])
            seen[y][x] = True
            minx = maxx = x
            miny = maxy = y
            area = 0
            while q:
                cx, cy = q.popleft()
                area += 1
                if cx < minx:
                    minx = cx
                if cx > maxx:
                    maxx = cx
                if cy < miny:
                    miny = cy
                if cy > maxy:
                    maxy = cy
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if area >= min_area:
                comps.append((minx, miny, maxx, maxy, area))
    return comps


def _gap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    dx = 0.0 if ax1 >= bx0 and bx1 >= ax0 else min(abs(ax1 - bx0), abs(bx1 - ax0))
    dy = 0.0 if ay1 >= by0 and by1 >= ay0 else min(abs(ay1 - by0), abs(by1 - ay0))
    return (dx * dx + dy * dy) ** 0.5


def merge_boxes(boxes: list[tuple[float, float, float, float, int]], gap: float) -> list[tuple[float, float, float, float, int]]:
    items = [list(b) for b in boxes]
    changed = True
    while changed:
        changed = False
        i = 0
        while i < len(items):
            j = i + 1
            while j < len(items):
                a = items[i]
                b = items[j]
                ax0, ay0, ax1, ay1 = a[0], a[1], a[2], a[3]
                bx0, by0, bx1, by1 = b[0], b[1], b[2], b[3]
                a_cx = (ax0 + ax1) / 2
                b_cx = (bx0 + bx1) / 2
                split_cols = (a_cx < 0.48 and b_cx > 0.52) or (b_cx < 0.48 and a_cx > 0.52)
                y_overlap = min(ay1, by1) - max(ay0, by0)
                h_min = min(ay1 - ay0, by1 - by0)
                paired = y_overlap > 0.5 * max(1e-6, h_min) and abs((ay1 - ay0) - (by1 - by0)) < 0.07
                allowed = 0.09 if paired else gap
                separated_cols = (ax1 < bx0 - 0.035 or bx1 < ax0 - 0.035) and (min(ay1, by1) - max(ay0, by0) > 0.02)
                if not split_cols and not separated_cols and _gap((ax0, ay0, ax1, ay1), (bx0, by0, bx1, by1)) <= allowed:
                    a[0] = min(a[0], b[0])
                    a[1] = min(a[1], b[1])
                    a[2] = max(a[2], b[2])
                    a[3] = max(a[3], b[3])
                    a[4] += b[4]
                    items.pop(j)
                    changed = True
                    continue
                j += 1
            i += 1
    return [tuple(x) for x in items]


def line_scores(mask: list[list[bool]], x0: int, y0: int, x1: int, y1: int) -> tuple[int, int, float]:
    hspan = max(1, x1 - x0)
    vspan = max(1, y1 - y0)
    h_hits = 0
    v_hits = 0
    ink = 0
    total = max(1, hspan * vspan)
    thresh_h = 0.45 * hspan
    thresh_v = 0.45 * vspan
    for y in range(y0, y1):
        row = sum(1 for x in range(x0, x1) if mask[y][x])
        ink += row
        if row >= thresh_h:
            h_hits += 1
    for x in range(x0, x1):
        col = sum(1 for y in range(y0, y1) if mask[y][x])
        if col >= thresh_v:
            v_hits += 1
    return h_hits, v_hits, ink / total


def text_overlap(bbox: dict, boxes: list[dict]) -> float:
    if not boxes:
        return 0.0
    x, y, w, h = bbox["x"], bbox["y"], bbox["width"], bbox["height"]
    area = max(1e-9, w * h)
    acc = 0.0
    for box in boxes:
        bb = box.get("bbox") or box
        ix0 = max(x, float(bb["x"]))
        iy0 = max(y, float(bb["y"]))
        ix1 = min(x + w, float(bb["x"]) + float(bb["width"]))
        iy1 = min(y + h, float(bb["y"]) + float(bb["height"]))
        if ix1 > ix0 and iy1 > iy0:
            acc += (ix1 - ix0) * (iy1 - iy0)
    return min(1.0, acc / area)


def classify(h_hits: int, v_hits: int, fill: float, width: float, height: float, text_ov: float) -> tuple[str, list[str], float]:
    evidence = []
    aspect = width / max(1e-6, height)
    if h_hits >= 3 and v_hits >= 3:
        evidence += ["grid_structure", f"h_{h_hits}", f"v_{v_hits}"]
        return "TABLE", evidence, 0.78
    if width >= 0.22 and height <= 0.085 and h_hits >= 1:
        evidence += ["wide_thin", "axis_like"]
        return "NUMBER_LINE", evidence, 0.74
    if h_hits >= 1 and v_hits >= 1 and 0.08 <= fill <= 0.42:
        evidence += ["axes", "line_crossing"]
        kind = "COORDINATE_PLANE" if abs(aspect - 1) < 0.45 else "GRAPH"
        return kind, evidence, 0.7
    if 0.04 <= fill <= 0.38 and width >= 0.08 and height >= 0.06:
        evidence += ["sparse_geometry", f"fill_{fill:.2f}"]
        return "GEOMETRY_DIAGRAM", evidence, 0.72
    if fill > 0.42 and text_ov > 0.55:
        evidence += ["dense_text"]
        return "SKIP_TEXT", evidence, 0.2
    if text_ov > 0.40 and h_hits < 2 and v_hits < 2 and fill < 0.22:
        evidence += ["text_overlap_no_structure"]
        return "SKIP_TEXT", evidence, 0.2
    evidence += ["dense_nontext_cluster"]
    return "UNKNOWN_VISUAL", evidence, 0.58


def is_decoration(bbox: dict, fill: float, text_ov: float, h_hits: int, v_hits: int, header_y: float = 0.072) -> str | None:
    x, y, w, h = bbox["x"], bbox["y"], bbox["width"], bbox["height"]
    cx, cy = x + w / 2, y + h / 2
    if cy < header_y and h < 0.16:
        return "header"
    if cy > 0.97 or y > 0.955:
        return "footer"
    if w < 0.018 and h > 0.45:
        return "column_divider"
    if x >= 0.88 and w < 0.12:
        return "sidebar"
    if 0.035 <= w <= 0.11 and 0.035 <= h <= 0.11 and abs(w / max(h, 1e-6) - 1) < 0.28 and fill > 0.28 and (cy < 0.14 or cx > 0.86 or cx < 0.12):
        return "qr_or_badge"
    if w < 0.12 and h < 0.045 and (cx < 0.22 or cy < 0.1):
        return "badge"
    if text_ov > 0.62 and h_hits < 3 and v_hits < 3 and fill > 0.18:
        return "boxed_text"
    if h > 0.48 and fill < 0.08:
        return "page_watermark"
    if w * h > 0.22 and fill < 0.05 and h > 0.35:
        return "page_watermark"
    if w * h > 0.36:
        return "page_watermark"
    return None


def split_column_span(box: tuple[float, float, float, float, int]) -> list[tuple[float, float, float, float, int]]:
    x0, y0, x1, y1, area = box
    if x0 < 0.46 and x1 > 0.54 and (x1 - x0) >= 0.55:
        mid = 0.5
        left_area = max(1, int(area * (mid - x0) / max(1e-6, x1 - x0)))
        right_area = max(1, area - left_area)
        return [(x0, y0, mid, y1, left_area), (mid, y0, x1, y1, right_area)]
    return [box]


def split_stem_figure(
    mask: list[list[bool]],
    box: tuple[float, float, float, float, int],
    dw: int,
    dh: int,
) -> list[tuple[float, float, float, float, int]]:
    """Split a wide stem+diagram blob at a low-ink vertical valley."""
    x0, y0, x1, y1, area = box
    if (x1 - x0) < 0.48 or x0 > 0.38 or x1 < 0.62:
        return [box]
    py0 = max(0, int(y0 * dh))
    py1 = min(dh, max(py0 + 1, int(y1 * dh)))
    best_x = None
    best_frac = 1.0
    for px in range(int(0.42 * dw), int(0.74 * dw)):
        xn = px / dw
        if xn <= x0 + 0.08 or xn >= x1 - 0.08:
            continue
        ink = 0
        total = 0
        for y in range(py0, py1):
            total += 1
            if mask[y][px]:
                ink += 1
        frac = ink / max(1, total)
        if frac < best_frac:
            best_frac = frac
            best_x = xn
    if best_x is None or best_frac > 0.12:
        return [box]
    left_area = max(1, int(area * (best_x - x0) / max(1e-6, x1 - x0)))
    return [(x0, y0, best_x, y1, left_area), (best_x, y0, x1, y1, max(1, area - left_area))]


def tighten_box(mask: list[list[bool]], box: tuple[float, float, float, float, int]) -> tuple[float, float, float, float, int]:
    h = len(mask)
    w = len(mask[0]) if h else 0
    x0, y0, x1, y1, _ = box
    px0, py0 = max(0, int(x0 * w)), max(0, int(y0 * h))
    px1, py1 = min(w, max(px0 + 1, int(x1 * w))), min(h, max(py0 + 1, int(y1 * h)))
    minx, miny, maxx, maxy = px1, py1, px0, py0
    ink = 0
    for y in range(py0, py1):
        row = mask[y]
        for x in range(px0, px1):
            if row[x]:
                ink += 1
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
    if ink < 8 or maxx < minx:
        return box
    pad_x = max(1, int(0.006 * w))
    pad_y = max(1, int(0.006 * h))
    minx = max(0, minx - pad_x)
    miny = max(0, miny - pad_y)
    maxx = min(w - 1, maxx + pad_x)
    maxy = min(h - 1, maxy + pad_y)
    return (minx / w, miny / h, (maxx + 1) / w, (maxy + 1) / h, ink)


def detect_page(path: Path, text_boxes: list[dict], cfg: dict) -> dict:
    original = Image.open(path).convert("RGB")
    ow, oh = original.size
    gray, _ = downsample(original, int(cfg["max_w"]))
    dw, dh = gray.size
    raw = ink_mask(gray, int(cfg["ink"]))
    visual = apply_text_keep(raw, text_boxes, float(cfg["text_keep"]), dw, dh)
    closed = dilate(visual, int(cfg["dilate"]))
    min_area = max(12, int(dw * dh * float(cfg["min_area_frac"]) * 0.15))
    comps = connected_components(closed, min_area)
    boxes = []
    for minx, miny, maxx, maxy, area in comps:
        boxes.append((minx / dw, miny / dh, (maxx + 1) / dw, (maxy + 1) / dh, area))
    split: list[tuple[float, float, float, float, int]] = []
    for box in boxes:
        for part in split_column_span(box):
            split.extend(split_stem_figure(closed, part, dw, dh))
    merged = merge_boxes(split, float(cfg["merge_gap"]))
    header_y = float(cfg.get("header_y", 0.072))
    refined = []
    for box in merged:
        tight = tighten_box(visual, box)
        x0, y0, x1, y1, area = tight
        if y0 < header_y and (y1 - header_y) >= 0.08:
            tight = tighten_box(visual, (x0, header_y, x1, y1, area))
        refined.append(tight)
    candidates = []
    skipped = []
    for x0, y0, x1, y1, area in refined:
        bbox = {
            "x": round(x0, 4),
            "y": round(y0, 4),
            "width": round(max(0.001, x1 - x0), 4),
            "height": round(max(0.001, y1 - y0), 4),
            "unit": "normalized",
            "origin": "top-left",
        }
        w, h = bbox["width"], bbox["height"]
        area_frac = w * h
        if area_frac < float(cfg["min_area_frac"]) or area_frac > float(cfg["max_area_frac"]):
            skipped.append({"reason": "area", "bbox": bbox})
            continue
        if w < float(cfg["min_w"]) or h < float(cfg["min_h"]):
            skipped.append({"reason": "size", "bbox": bbox})
            continue
        px0, py0 = int(x0 * dw), int(y0 * dh)
        px1, py1 = min(dw, int(x1 * dw)), min(dh, int(y1 * dh))
        h_hits, v_hits, fill = line_scores(raw, px0, py0, max(px0 + 1, px1), max(py0 + 1, py1))
        text_ov = text_overlap(bbox, text_boxes)
        deco = is_decoration(bbox, fill, text_ov, h_hits, v_hits, float(cfg.get("header_y", 0.072)))
        if deco:
            skipped.append({"reason": deco, "bbox": bbox})
            continue
        kind, evidence, conf = classify(h_hits, v_hits, fill, w, h, text_ov)
        if kind == "SKIP_TEXT":
            skipped.append({"reason": "formula_or_boxed_text", "bbox": bbox})
            continue
        isolation = 1.0 - min(1.0, text_ov)
        conf = round(min(0.92, conf + 0.08 * isolation - 0.12 * max(0.0, text_ov - 0.4)), 3)
        candidates.append(
            {
                "figure_id": f"p{path.stem}-x{int(bbox['x']*1000)}-y{int(bbox['y']*1000)}",
                "page": None,
                "bbox": bbox,
                "figure_type": kind,
                "figure_confidence": conf,
                "visual_evidence": evidence + [f"fill_{fill:.2f}", f"isolation_{isolation:.2f}"],
                "text_overlap": round(text_ov, 3),
                "region_membership": "page_body",
                "pixel_bbox": {
                    "x": int(bbox["x"] * ow),
                    "y": int(bbox["y"] * oh),
                    "width": int(bbox["width"] * ow),
                    "height": int(bbox["height"] * oh),
                },
            }
        )
    return {
        "source_path": str(path),
        "width": ow,
        "height": oh,
        "candidates": candidates,
        "skipped": skipped[:80],
        "component_count": len(comps),
        "merged_count": len(merged),
        "text_boxes": len(text_boxes),
        "config": {k: cfg[k] for k in DEFAULTS},
    }


def render_pdf_pages(pdf_path: Path, pages: list[int], dest: Path, scale: float = 2.2) -> list[dict]:
    sys.path.insert(0, str(ROOT / "workers" / "ocr" / "site-packages"))
    import pypdfium2 as pdfium

    if not pdf_path.exists():
        raise SystemExit("source PDF missing")
    dest.mkdir(parents=True, exist_ok=True)
    doc = pdfium.PdfDocument(str(pdf_path))
    written = []
    for page in pages:
        out = dest / f"page-{page:03d}.png"
        if out.exists():
            written.append({"page": page, "path": str(out), "reused": True})
            continue
        bitmap = doc[page - 1].render(scale=scale)
        bitmap.to_pil().save(out, format="PNG")
        written.append({"page": page, "path": str(out), "reused": False})
    doc.close()
    return written


def render_ssen_pages(pages: list[int], dest: Path, scale: float = 2.2) -> list[dict]:
    return render_pdf_pages(ROOT / "workers" / "ocr" / "data" / "ssen-common-math1.pdf", pages, dest, scale)


def extract_layout(pdf_path: Path, pages: list[int]) -> list[dict]:
    sys.path.insert(0, str(ROOT / "workers" / "ocr" / "site-packages"))
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf_path))
    out = []
    for page_no in pages:
        page = doc[page_no - 1]
        pw, ph = page.get_size()
        textpage = page.get_textpage()
        blocks = []
        for i in range(textpage.count_rects()):
            left, bottom, right, top = textpage.get_rect(i)
            content = (textpage.get_text_bounded(left=left, bottom=bottom, right=right, top=top) or "").strip()
            if not content:
                continue
            width = (right - left) / pw
            height = (top - bottom) / ph
            if width <= 0 or height <= 0:
                continue
            blocks.append(
                {
                    "content": content,
                    "bbox": {
                        "x": round(float(left / pw), 4),
                        "y": round(float(1.0 - (top / ph)), 4),
                        "width": round(float(width), 4),
                        "height": round(float(height), 4),
                        "unit": "normalized",
                        "origin": "top-left",
                    },
                }
            )
        out.append({"page": page_no, "blocks": blocks})
    doc.close()
    return out


def crop_original(page_path: Path, bbox: dict, dest: Path, pad: float = 0.012) -> dict:
    image = Image.open(page_path)
    w, h = image.size
    x = max(0.0, float(bbox["x"]) - pad)
    y = max(0.0, float(bbox["y"]) - pad)
    width = min(1.0 - x, float(bbox["width"]) + 2 * pad)
    height = min(1.0 - y, float(bbox["height"]) + 2 * pad)
    box = (int(x * w), int(y * h), int((x + width) * w), int((y + height) * h))
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.crop(box).save(dest, format="PNG")
    return {"path": str(dest), "pixel": {"x0": box[0], "y0": box[1], "x1": box[2], "y1": box[3]}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages-json")
    parser.add_argument("--out")
    parser.add_argument("--config-json")
    parser.add_argument("--render-ssen")
    parser.add_argument("--render-pages")
    parser.add_argument("--extract-layout")
    parser.add_argument("--crop-json")
    args = parser.parse_args()
    cfg = dict(DEFAULTS)
    if args.config_json:
        cfg.update(_load_json(Path(args.config_json)))
    if args.render_ssen:
        spec = _load_json(Path(args.render_ssen))
        written = render_ssen_pages(spec["pages"], Path(spec["dest"]), float(spec.get("scale", 2.2)))
        Path(spec["out"]).write_text(json.dumps({"written": written, "pdf_untouched": True}, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    if args.render_pages:
        spec = _load_json(Path(args.render_pages))
        written = render_pdf_pages(Path(spec["pdf"]), spec["pages"], Path(spec["dest"]), float(spec.get("scale", 2.2)))
        Path(spec["out"]).write_text(json.dumps({"written": written, "pdf_untouched": True}, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    if args.extract_layout:
        spec = _load_json(Path(args.extract_layout))
        pages = extract_layout(Path(spec["pdf"]), spec["pages"])
        Path(spec["out"]).write_text(json.dumps({"pages": pages}, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    if args.crop_json:
        spec = _load_json(Path(args.crop_json))
        rows = []
        for item in spec.get("items") or []:
            rows.append({"id": item["id"], **crop_original(Path(item["page_path"]), item["bbox"], Path(item["dest"]), float(item.get("pad", 0.012)))})
        Path(spec["out"]).write_text(json.dumps({"crops": rows, "generated": False, "original_render": True}, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    pages = _load_json(Path(args.pages_json))
    results = []
    for row in pages:
        path = Path(row["path"])
        boxes = row.get("text_boxes") or []
        detected = detect_page(path, boxes, cfg)
        detected["page"] = row.get("page")
        detected["book"] = row.get("book")
        for cand in detected["candidates"]:
            cand["page"] = row.get("page")
            cand["figure_id"] = f"{row.get('book','x')}-{row.get('page')}-{cand['figure_id']}"
        results.append(detected)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"engine": "visual-figure-detect-v1", "config": cfg, "pages": results}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
