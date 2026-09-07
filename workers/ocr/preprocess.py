from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


def apply_preprocess(src: Path, dest: Path, kind: str) -> Path:
    image = Image.open(src).convert("RGB")
    if kind == "raw":
        image.save(dest)
        return dest
    gray = ImageOps.grayscale(image)
    if kind == "gray":
        gray.convert("RGB").save(dest)
        return dest
    if kind == "contrast":
        ImageOps.autocontrast(gray).convert("RGB").save(dest)
        return dest
    if kind == "upscale2":
        w, h = image.size
        image.resize((w * 2, h * 2), Image.Resampling.LANCZOS).save(dest)
        return dest
    if kind == "denoise":
        gray.filter(ImageFilter.MedianFilter(size=3)).convert("RGB").save(dest)
        return dest
    raise ValueError(kind)
