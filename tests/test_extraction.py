import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

from app.extraction import _components, _read_text, _yellow_mask, extract_image


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.orientation = patch("app.extraction._page_orientation", return_value=(0, 20))
        self.orientation.start()
        self.addCleanup(self.orientation.stop)
        self.addCleanup(self.temporary.cleanup)

    def image(self, vertical=False):
        image = Image.new("RGB", (800, 600), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((100, 200, 500, 250), fill=(255, 240, 70))
        # Sharp black glyph-like bars inside the marked range.
        for x in range(115, 485, 25):
            draw.rectangle((x, 210, x + 8, 238), fill="black")
        draw.text((100, 100), "UNMARKED TEXT", fill="black")
        if vertical:
            image = image.rotate(90, expand=True)
        path = self.root / "source.png"
        image.save(path)
        return path

    def test_mask_excludes_plain_paper_and_blue(self):
        image = Image.new("RGB", (3, 1))
        image.putdata([(255, 255, 255), (30, 120, 255), (255, 240, 70)])
        self.assertEqual(_yellow_mask(image).tolist(), [[False, False, True]])

    def test_component_union_merges_connected_runs(self):
        mask = np.array([[1, 1, 0, 1, 1], [0, 1, 1, 1, 0]], dtype=bool)
        self.assertEqual(_components(mask), [(0, 0, 5, 2)])

    def test_missing_japanese_ocr_preserves_evidence_and_blocks_generation(self):
        with patch("app.extraction._ocr_capability", return_value=(None, "日本語OCR辞書 jpn がありません。")):
            result = extract_image(self.image(), self.root / "out")
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(len(result["regions"]), 1)
        region = result["regions"][0]
        self.assertEqual(region["status"], "needs_review")
        self.assertEqual(region["text"], "")
        for key in ("crop_path", "mask_path", "scope_path"):
            self.assertTrue(Path(region[key]).is_file())
        x, y, width, height = region["bbox"]
        self.assertLessEqual(x, 100)
        self.assertLessEqual(y, 200)
        self.assertGreaterEqual(x + width, 500)
        self.assertGreaterEqual(y + height, 250)
        self.assertGreater(y, 100)  # unmarked text is not included
        manifest = json.loads((self.root / "out/extraction.json").read_text())
        self.assertEqual(manifest["regions"][0]["bbox"], region["bbox"])

    def test_high_confidence_scoped_ocr_is_ready_but_low_confidence_is_not(self):
        with patch("app.extraction._ocr_capability", return_value=("tesseract", None)), patch(
            "app.extraction._read_text", return_value=("黄色の根拠", 95.0, None)
        ):
            result = extract_image(self.image(), self.root / "ready")
        self.assertEqual(result["regions"][0]["status"], "ready")
        with patch("app.extraction._ocr_capability", return_value=("tesseract", None)), patch(
            "app.extraction._read_text", return_value=("曖昧", 45.0, "文字は要確認")
        ):
            result = extract_image(self.image(), self.root / "review")
        self.assertEqual(result["regions"][0]["status"], "needs_review")

    def test_no_yellow_does_not_create_a_question_region(self):
        path = self.root / "plain.png"
        Image.new("RGB", (300, 300), "white").save(path)
        with patch("app.extraction._ocr_capability", return_value=(None, "辞書なし")):
            result = extract_image(path, self.root / "plain")
        self.assertEqual(result["regions"], [])
        self.assertIn("見つかりません", result["reason"])

    def test_vertical_highlight_is_preserved_with_orientation_guidance(self):
        with patch("app.extraction._ocr_capability", return_value=(None, "辞書なし")):
            result = extract_image(self.image(vertical=True), self.root / "vertical")
        self.assertEqual(len(result["regions"]), 1)
        self.assertIn("写真の向き", result["regions"][0]["reason"])

    def test_osd_rotation_only_changes_crop_not_source_bbox(self):
        path = self.image(vertical=True)
        with patch("app.extraction._page_orientation", return_value=(90, 18)), patch(
            "app.extraction._ocr_capability", return_value=("tesseract", None)
        ), patch("app.extraction._read_text", return_value=("黄色の根拠", 95.0, None)):
            result = extract_image(path, self.root / "oriented")
        region = result["regions"][0]
        self.assertEqual(region["clockwise_rotation"], 90)
        self.assertGreater(region["bbox"][3], region["bbox"][2])
        with Image.open(region["crop_path"]) as crop:
            self.assertGreater(crop.width, crop.height)

    def test_unreadable_image_is_review_without_throwing(self):
        path = self.root / "broken.jpg"
        path.write_bytes(b"not an image")
        result = extract_image(path, self.root / "broken")
        self.assertEqual(result["status"], "needs_review")
        self.assertFalse(result["regions"])

    def test_ocr_uses_lowest_word_confidence_and_never_repairs_text(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tconf\ttext\n"
        tsv = header + "5\t1\t1\t1\t1\t1\t99\tアルコール\n5\t1\t1\t1\t1\t2\t31\t1?%\n"
        with patch("app.extraction.subprocess.run") as run:
            run.return_value.stdout = tsv
            text, confidence, reason = _read_text("tesseract", Path("scope.png"))
        self.assertEqual(text, "アルコール1?%")
        self.assertEqual(confidence, 31)
        self.assertIsNotNone(reason)


if __name__ == "__main__":
    unittest.main()
