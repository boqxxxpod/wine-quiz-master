"""Conservative, local yellow-marker extraction. No inference service is used here.

Coordinates refer to the EXIF-oriented source image, not a resized preview. An
OCR result is a candidate, never a licence to invent missing characters. Every
generated question still requires explicit review in the application.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

EXTRACTION_VERSION = "yellow-local-v1"
MAX_REGIONS = 24


def _yellow_mask(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    hsv = np.asarray(image.convert("HSV"))
    # Require both yellow hue and a blue deficit; beige paper alone is excluded.
    return ((hsv[:, :, 0] >= 24) & (hsv[:, :, 0] <= 50)
            & (hsv[:, :, 1] >= 48) & (hsv[:, :, 2] >= 125)
            & (rgb[:, :, 0] >= 125) & (rgb[:, :, 1] >= 120)
            & (rgb[:, :, 2] < np.minimum(rgb[:, :, 0], rgb[:, :, 1]) * .88))


def _components(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Connected components via row runs, avoiding a dependency on OpenCV."""
    parent: list[int] = []
    bounds: list[list[int]] = []

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    previous: list[tuple[int, int, int]] = []
    for y, row in enumerate(mask):
        changes = np.diff(np.pad(row.astype(np.int8), (1, 1)))
        starts = np.flatnonzero(changes == 1)
        ends = np.flatnonzero(changes == -1)
        current = []
        previous_index = 0
        for start, end in zip(starts.tolist(), ends.tolist()):
            while previous_index < len(previous) and previous[previous_index][1] < start:
                previous_index += 1
            neighbours = []
            cursor = previous_index
            while cursor < len(previous) and previous[cursor][0] <= end:
                neighbours.append(find(previous[cursor][2]))
                cursor += 1
            if neighbours:
                label = min(neighbours)
                for neighbour in neighbours:
                    root = find(neighbour)
                    if root != label:
                        parent[root] = label
                        a, b = bounds[label], bounds[root]
                        a[:] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                bounds[label][0] = min(bounds[label][0], start)
                bounds[label][2] = max(bounds[label][2], end)
                bounds[label][3] = y + 1
            else:
                label = len(parent)
                parent.append(label)
                bounds.append([start, y, end, y + 1])
            current.append((start, end, label))
        previous = current
    return [tuple(box) for index, box in enumerate(bounds) if find(index) == index]


def _ocr_capability() -> tuple[str | None, str | None]:
    command = shutil.which("tesseract")
    if not command:
        return None, "日本語OCRが未設定です。サーバーに tesseract-ocr と tesseract-ocr-jpn をインストールしてください。"
    try:
        result = subprocess.run([command, "--list-langs"], capture_output=True, text=True, timeout=10, check=True)
        if "jpn" not in result.stdout.split():
            return None, "日本語OCR辞書 jpn がありません。サーバーに tesseract-ocr-jpn をインストールして取り込みを再実行してください。"
    except (subprocess.SubprocessError, OSError):
        return None, "日本語OCRの起動確認に失敗しました。サーバーの tesseract と日本語辞書 jpn を確認してください。"
    return command, None


def _read_text(command: str, path: Path) -> tuple[str, float, str | None]:
    try:
        result = subprocess.run(
            [command, str(path), "stdout", "-l", "jpn", "--psm", "6", "-c", "tessedit_create_tsv=1"],
            capture_output=True, text=True, timeout=35, check=True,
        )
        words = []
        confidences = []
        last_line = None
        for row in csv.DictReader(io.StringIO(result.stdout), delimiter="\t"):
            value = (row.get("text") or "").strip()
            if not value:
                continue
            confidence = float(row.get("conf", "-1"))
            if confidence < 0:
                continue
            line = (row.get("block_num"), row.get("par_num"), row.get("line_num"))
            if last_line is not None and last_line != line:
                words.append("\n")
            words.append(value)
            confidences.append(confidence)
            last_line = line
        text = "".join(words)
        confidence = min(confidences) if confidences else 0.0
        if len(text.strip()) < 2:
            return text, confidence, "黄色部分の文字を十分に読み取れません。元写真で確認してください。"
        if confidence < 85 or any(char in text for char in "�□"):
            return text, confidence, "OCRの確信度が不足しています。数値・名称を補わず、元写真で文字を確認してください。"
        return text, confidence, None
    except (subprocess.SubprocessError, OSError, ValueError, csv.Error):
        return "", 0.0, "日本語OCRの実行に失敗しました。文字は推測せず、要確認として保存しました。"


def _page_orientation(image: Image.Image) -> tuple[int, float]:
    """Use local OSD only; a low-confidence result never rotates evidence."""
    command = shutil.which("tesseract")
    if not command:
        return 0, 0.0
    preview = image.copy()
    preview.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    preview.save(buffer, format="PNG")
    environment = dict(os.environ)
    # A project-local Japanese dictionary should not hide the system OSD data.
    environment.pop("TESSDATA_PREFIX", None)
    try:
        run = subprocess.run([command, "stdin", "stdout", "-l", "osd", "--psm", "0"],
                             input=buffer.getvalue(), capture_output=True, timeout=20, check=True, env=environment)
        response = run.stdout.decode("utf-8", errors="replace")
        angle = re.search(r"Rotate:\s*(\d+)", response)
        confidence = re.search(r"Orientation confidence:\s*([\d.]+)", response)
        if angle and confidence and int(angle[1]) in (0, 90, 180, 270):
            return int(angle[1]), float(confidence[1])
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    return 0, 0.0


def _save_manifest(output_dir: Path, result: dict) -> dict:
    temporary = output_dir / "extraction.json.tmp"
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(output_dir / "extraction.json")
    return result


def extract_image(image_path: Path, output_dir: Path) -> dict:
    """Persist yellow candidates, masks and local OCR; fail closed on uncertainty."""
    image_path, output_dir = Path(image_path), Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    result = {"version": EXTRACTION_VERSION, "status": "needs_review", "reason": "", "regions": [],
              "source_path": str(image_path), "source_size": [], "coordinate_space": "exif_oriented_pixels",
              "ocr_available": False}
    try:
        with Image.open(image_path) as source:
            if source.width * source.height > 50_000_000:
                result["reason"] = "写真が大きすぎます。5,000万画素以下の写真で再実行してください。"
                return _save_manifest(output_dir, result)
            image = ImageOps.exif_transpose(source).convert("RGB")
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
        result["reason"] = "写真を開けません。対応する画像ファイルか、破損していないかを確認してください。"
        return _save_manifest(output_dir, result)
    width, height = image.size
    result["source_size"] = [width, height]
    command, ocr_reason = _ocr_capability()
    result["ocr_available"] = bool(command)
    rotation, orientation_confidence = _page_orientation(image)
    rotate_evidence = rotation if orientation_confidence >= 8 else 0
    result["orientation"] = {"clockwise_degrees": rotate_evidence, "confidence": orientation_confidence,
                             "verified": orientation_confidence >= 8}
    preview = image.copy()
    preview.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    scale_x, scale_y = width / preview.width, height / preview.height
    raw_mask = _yellow_mask(preview)
    joined = np.asarray(Image.fromarray(raw_mask.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))) > 0
    candidates = []
    for x0, y0, x1, y1 in _components(joined):
        w, h = x1 - x0, y1 - y0
        long_side, short_side = max(w, h), min(w, h)
        if long_side < 12 or short_side < 4 or long_side / short_side < 1.5 or short_side > min(preview.size) * .13:
            continue
        count = int(raw_mask[y0:y1, x0:x1].sum())
        # Sparse warm-colored photo/text fringes are not marker regions. Keeping
        # them would crowd real highlighted text out of the bounded review list.
        if count < 20 or count / (w * h) < .12:
            continue
        candidates.append((x0, y0, x1, y1))
    candidates.sort(key=lambda box: (box[1], box[0]))
    too_many = len(candidates) > MAX_REGIONS
    for index, (px0, py0, px1, py1) in enumerate(candidates[:MAX_REGIONS], 1):
        x0, y0 = max(0, math.floor(px0 * scale_x)), max(0, math.floor(py0 * scale_y))
        x1, y1 = min(width, math.ceil(px1 * scale_x)), min(height, math.ceil(py1 * scale_y))
        crop = image.crop((x0, y0, x1, y1))
        if rotate_evidence:
            crop = crop.rotate(-rotate_evidence, expand=True)
        mask = _yellow_mask(crop)
        # Close tiny glyph holes, but retain the actual highlight boundary. The
        # OCR image whites out everything outside that conservative boundary.
        radius = max(3, min(15, round(crop.height * .20)))
        radius += 1 - radius % 2
        binary = Image.fromarray(mask.astype(np.uint8) * 255)
        scope = binary.filter(ImageFilter.MaxFilter(radius)).filter(ImageFilter.MinFilter(radius))
        scope_image = Image.composite(crop, Image.new("RGB", crop.size, "white"), scope)
        region_id = f"region_{index:03d}"
        crop_path = output_dir / f"{region_id}_crop.png"
        mask_path = output_dir / f"{region_id}_yellow.png"
        scope_path = output_dir / f"{region_id}_scope.png"
        crop.save(crop_path)
        binary.save(mask_path)
        scope_image.save(scope_path)
        gray = np.asarray(scope_image.convert("L"), dtype=np.float32)
        laplacian = (gray[:-2, 1:-1] + gray[2:, 1:-1] + gray[1:-1, :-2]
                     + gray[1:-1, 2:] - 4 * gray[1:-1, 1:-1])
        sharpness = float(laplacian.var()) if laplacian.size else 0.0
        density = float(mask.mean())
        region = {"id": region_id, "bbox": [x0, y0, x1 - x0, y1 - y0],
                  "crop_path": str(crop_path), "mask_path": str(mask_path), "scope_path": str(scope_path),
                  "text": "", "confidence": 0.0, "status": "needs_review", "reason": "",
                  "yellow_density": round(density, 4), "sharpness": round(sharpness, 2)}
        region["clockwise_rotation"] = rotate_evidence
        orientation_uncertain = crop.height > crop.width
        geometry_uncertain = (density < .24 or crop.width / crop.height < 2.2 or too_many)
        if command and not (geometry_uncertain or orientation_uncertain or sharpness < 30):
            text_value, confidence, read_reason = _read_text(command, scope_path)
            region["text"], region["confidence"] = text_value, round(confidence, 2)
        else:
            read_reason = ocr_reason
        if orientation_uncertain:
            region["reason"] = "写真の向きが確認できません。黄色の文字が横向きになるよう写真を回転し、再取り込みしてください。"
        elif geometry_uncertain:
            region["reason"] = "黄色の範囲が曖昧です。写真・図版の色の可能性もあるため、元写真で確認してください。"
        elif sharpness < 30:
            region["reason"] = "黄色部分の文字が不鮮明です。鮮明な写真で再取り込みしてください。"
        elif read_reason:
            region["reason"] = read_reason
        else:
            region["status"] = "ready"
            region["reason"] = "黄色範囲と日本語OCRの検査を通過しました。生成後の問題は承認前に根拠と照合してください。"
        result["regions"].append(region)
    ready = sum(region["status"] == "ready" for region in result["regions"])
    if ready:
        result["status"] = "ready"
        result["reason"] = f"{ready}箇所を読み取りました。未確認箇所は出題に使用しません。"
    elif not candidates:
        result["reason"] = "明確な黄色のマーカー部分が見つかりません。黄色の範囲が写った鮮明な写真を確認してください。"
    else:
        result["reason"] = ocr_reason or "黄色の範囲または文字に不確実な箇所があるため、要確認として保存しました。"
    if too_many:
        result["reason"] = "黄色候補が多く範囲を特定できません。24箇所までを保存しました。黄色部分が写る範囲に写真を分割してください。"
    return _save_manifest(output_dir, result)
