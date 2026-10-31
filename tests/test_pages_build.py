"""Pages publishing checks. All private evidence is synthetic temporary data."""
from __future__ import annotations

import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.store import Store
from scripts.build_pages import MARKER, PUBLIC_FILES, PUBLIC_QUESTION_PACK, PUBLIC_PRACTICE_PACK, PUBLIC_QUESTION_PACKS, PUBLIC_PRACTICE_ASSETS, SOURCE_ASSET_VERSION, ROOT, build
from scripts.export_questions import export_questions


class PublicBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wine-pages-build-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / "project"
        self.root.mkdir()
        for relative in PUBLIC_FILES:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"public source: {relative}\n", encoding="utf-8")
        # Packaging tests use an explicitly synthetic pack, never invented study content.
        self.synthetic_pack = json.dumps({"source": "synthetic-build-fixture", "questions": []})
        for relative in PUBLIC_QUESTION_PACKS:
            (self.root / relative).write_text(self.synthetic_pack, encoding="utf-8")
        self.output = self.root / "dist-pages"

    def test_allowlist_artifact_never_contains_private_runtime_or_extra_files(self):
        canary = "DO-NOT-PUBLISH-PRIVATE-EVIDENCE-OR-KEYS"
        for relative in (".env", "data/questions-export.json", "data/wine-quiz.sqlite3",
                         "data/originals/private.jpg", "credentials/service-account.json",
                         "static/unlisted-export.json", "question-packs/private.json",
                         "question-packs/batches/pilot-01.json", "question-packs/pilot-150.json",
                         "question-packs/batches/wine-quiz-01.json", "question-packs/wine-quiz-500.json",
                         "question-packs/coverage.json", "question-packs/highlighted-batches/wine-quiz-01.json", "app/store.py"):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(canary, encoding="utf-8")
        build(self.root, self.output)
        actual = {str(path.relative_to(self.output)) for path in self.output.rglob("*") if path.is_file()}
        expected = {"index.html", "static/app.js", "static/quiz.js", "static/pages.js",
                    "static/style.css", *PUBLIC_QUESTION_PACKS, *PUBLIC_PRACTICE_ASSETS, "static/runtime.js", ".nojekyll", MARKER}
        self.assertEqual(actual, expected)
        for path in self.output.rglob("*"):
            if path.is_file():
                self.assertNotIn(canary, path.read_text(encoding="utf-8"))
        self.assertEqual((self.output / "static/runtime.js").read_text(), "export const mode = 'pages';\n")
        for relative in PUBLIC_QUESTION_PACKS:
            self.assertEqual((self.output / relative).read_text(encoding="utf-8"), self.synthetic_pack)

    def test_missing_practice_pack_preserves_last_complete_artifact(self):
        build(self.root, self.output)
        before = {str(p.relative_to(self.output)): p.read_bytes() for p in self.output.rglob("*") if p.is_file()}
        (self.root / PUBLIC_PRACTICE_PACK).unlink()
        with self.assertRaisesRegex(ValueError, PUBLIC_PRACTICE_PACK):
            build(self.root, self.output)
        self.assertEqual({str(p.relative_to(self.output)): p.read_bytes() for p in self.output.rglob("*") if p.is_file()}, before)

    def test_missing_bundled_questions_fail_explicitly_without_publishing_empty_pack(self):
        (self.root / PUBLIC_QUESTION_PACK).unlink()
        with self.assertRaisesRegex(ValueError, PUBLIC_QUESTION_PACK):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.glob(".pages-build-*")), [])

    def test_registered_pack_is_published_without_modifying_original_bytes(self):
        build(ROOT, self.output)
        for relative in (*PUBLIC_QUESTION_PACKS, *PUBLIC_PRACTICE_ASSETS):
            self.assertEqual((self.output / relative).read_bytes(), (ROOT / relative).read_bytes())

    def test_asset_versions_match_through_imports_and_change_with_pack_bytes(self):
        build(ROOT, self.output)
        html = (self.output / "index.html").read_text(encoding="utf-8")
        version = re.search(r"app\.js\?v=([a-f0-9]{16})", html).group(1)
        self.assertIn(f"style.css?v={version}", html)
        for relative in ("static/app.js", "static/pages.js"):
            content = (self.output / relative).read_text(encoding="utf-8")
            versions = re.findall(r"\.js\?v=([^'\"]+)", content)
            self.assertTrue(versions)
            self.assertEqual(set(versions), {version})
            self.assertNotIn(f"v={SOURCE_ASSET_VERSION}", content)
        for relative in PUBLIC_FILES:
            source = ROOT / relative
            target = self.root / relative
            target.write_bytes(source.read_bytes())
        for relative in PUBLIC_QUESTION_PACKS:
            pack = self.root / relative
            pack.write_bytes(pack.read_bytes() + b"\n")
            build(self.root, self.output)
            updated = (self.output / "index.html").read_text(encoding="utf-8")
            self.assertNotIn(f"app.js?v={version}", updated)
            version = re.search(r"app\.js\?v=([a-f0-9]{16})", updated).group(1)
            self.assertEqual((self.output / relative).read_bytes(), pack.read_bytes())

    def test_unrelated_directory_and_source_ancestors_cannot_be_overwritten(self):
        unrelated = self.base / "important"
        unrelated.mkdir()
        sentinel = unrelated / "keep.txt"
        sentinel.write_text("keep me", encoding="utf-8")
        for destination in (unrelated, self.root, self.base):
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                build(self.root, destination)
        self.assertEqual(sentinel.read_text(), "keep me")

    def test_failed_rebuild_preserves_last_complete_artifact(self):
        build(self.root, self.output)
        before = {str(p.relative_to(self.output)): p.read_bytes() for p in self.output.rglob("*") if p.is_file()}
        (self.root / PUBLIC_QUESTION_PACK).unlink()
        with self.assertRaises(ValueError):
            build(self.root, self.output)
        after = {str(p.relative_to(self.output)): p.read_bytes() for p in self.output.rglob("*") if p.is_file()}
        self.assertEqual(after, before)
        self.assertEqual(list(self.output.parent.glob(".pages-build-*")), [])

    def test_bundled_questions_symlink_cannot_publish_unlisted_data(self):
        outside = self.base / "private-questions.json"
        outside.write_text("PRIVATE QUESTION CANARY", encoding="utf-8")
        source = self.root / PUBLIC_QUESTION_PACK
        source.unlink()
        source.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, PUBLIC_QUESTION_PACK):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())
        source.unlink()
        pack_dir = source.parent
        for sibling in pack_dir.iterdir():
            if sibling.is_dir():
                shutil.rmtree(sibling)
            else:
                sibling.unlink()
        pack_dir.rmdir()
        outside_dir = self.base / "private-packs"
        outside_dir.mkdir()
        (outside_dir / source.name).write_text("PRIVATE QUESTION CANARY", encoding="utf-8")
        pack_dir.symlink_to(outside_dir, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, PUBLIC_QUESTION_PACK):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_practice_pack_symlink_cannot_publish_unlisted_data(self):
        outside = self.base / "private-practice.json"
        outside.write_text("PRIVATE QUESTION CANARY", encoding="utf-8")
        source = self.root / PUBLIC_PRACTICE_PACK
        source.unlink()
        source.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, PUBLIC_PRACTICE_PACK):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_or_symlinked_crop_preserves_last_complete_artifact(self):
        build(self.root, self.output)
        before = {str(p.relative_to(self.output)): p.read_bytes() for p in self.output.rglob("*") if p.is_file()}
        relative = PUBLIC_PRACTICE_ASSETS[0]
        source = self.root / relative
        source.unlink()
        with self.assertRaisesRegex(ValueError, relative):
            build(self.root, self.output)
        private = self.base / "private.png"
        private.write_bytes(b"PRIVATE CANARY")
        source.symlink_to(private)
        with self.assertRaisesRegex(ValueError, relative):
            build(self.root, self.output)
        self.assertEqual({str(p.relative_to(self.output)): p.read_bytes() for p in self.output.rglob("*") if p.is_file()}, before)

    def test_leaf_or_parent_symlink_cannot_copy_outside_source_tree(self):
        outside = self.base / "outside"
        outside.mkdir()
        for relative in PUBLIC_FILES:
            (outside / Path(relative).name).write_text("PRIVATE OUTSIDE FILE", encoding="utf-8")
        leaf = self.root / "static/app.js"
        leaf.unlink()
        leaf.symlink_to(outside / "app.js")
        with self.assertRaises(ValueError):
            build(self.root, self.output)
        leaf.unlink()
        leaf.write_text("public app", encoding="utf-8")
        static = self.root / "static"
        static.rename(self.root / "saved-static")
        static.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())


class PrivateQuestionExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wine-pages-export-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data_dir = self.root / "data"
        self.store = Store(self.data_dir)
        self.output = self.data_dir / "exports/questions.json"

    def add_question(self, sid, status="approved"):
        meta = {"id": sid, "name": f"{sid}.png", "mimeType": "image/png",
                "md5Checksum": "first", "modifiedTime": "2026-01-01T00:00:00Z", "size": 32}
        source = self.store.upsert_source(meta, "synthetic_folder")
        photo = self.data_dir / "originals" / f"{sid}.png"
        photo.parent.mkdir(parents=True, exist_ok=True)
        photo.write_bytes(b"PRIVATE-ORIGINAL-CANARY")
        self.store.set_downloaded(sid, str(photo), source["remote_revision"])
        self.store.save_extraction(sid, {
            "status": "ready", "source_path": str(photo), "private_metadata": "PRIVATE-EXTRACTION-CANARY",
            "regions": [{"id": "r1", "status": "ready", "text": "黄色部分の確認済みの知識です。",
                         "scope_path": str(photo), "crop_path": str(photo), "mask_path": str(photo)}],
        })
        question = {"region_id": "r1", "prompt": f"検証用の問題 {sid}",
                    "choices": [{"id": "a", "text": "答えA"}, {"id": "b", "text": "答えB"}, {"id": "c", "text": "答えC"}],
                    "correct_choice_id": "b", "quote": "確認済みの知識", "explanation": "検証用の解説です。"}
        self.store.save_questions(sid, [question])
        saved = self.store.questions(source_id=sid, approved_only=False)[0]
        if status in {"approved", "rejected"}:
            self.store.review_question(saved["id"], status == "approved")
        return meta, saved, photo

    def test_only_current_approved_questions_export_without_api_or_private_paths(self):
        _, approved, _ = self.add_question("approved")
        self.add_question("pending", "pending_review")
        self.add_question("rejected", "rejected")
        obsolete_meta, _, _ = self.add_question("obsolete")
        self.store.upsert_source({**obsolete_meta, "md5Checksum": "new-revision"}, "synthetic_folder")
        self.add_question("removed")
        self.store.reconcile("synthetic_folder", {"approved", "pending", "rejected", "obsolete"})
        with patch("app.drive.DriveClient", side_effect=AssertionError("Export must not use Google")), patch(
            "app.luna.LunaClient", side_effect=AssertionError("Export must not use OpenAI")
        ):
            count = export_questions(self.data_dir, self.output)
        payload = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(count, 1)
        self.assertEqual(payload["version"], 1)
        self.assertEqual([q["id"] for q in payload["questions"]], [approved["id"]])
        question = payload["questions"][0]
        self.assertEqual(question["source_id"], "approved")
        self.assertEqual(question["file_name"], "approved.png")
        self.assertEqual(question["correct_choice_id"], "b")
        self.assertEqual(question["quote"], "確認済みの知識")
        self.assertEqual(set(question), {"prompt", "choices", "correct_choice_id", "explanation",
                                        "region_id", "quote", "id", "source_id", "file_name"})
        serialized = self.output.read_text(encoding="utf-8")
        self.assertNotIn(str(self.data_dir), serialized)
        self.assertNotIn("PRIVATE-", serialized)

    def test_export_revalidates_current_yellow_evidence_before_overwriting_output(self):
        _, _, _ = self.add_question("approved")
        self.output.parent.mkdir(parents=True, exist_ok=True)
        previous_export = '{"version":1,"questions":[]}'
        self.output.write_text(previous_export, encoding="utf-8")
        source = self.store.get_source("approved")
        extraction = source["extraction"]
        extraction["regions"][0]["text"] = "元の引用を含まない別の文字列"
        self.store.save_extraction("approved", extraction)
        with self.assertRaises(ValueError):
            export_questions(self.data_dir, self.output)
        self.assertEqual(self.output.read_text(), previous_export)

    def test_output_cannot_destroy_database_originals_or_other_existing_files(self):
        _, _, original = self.add_question("approved")
        self.output.parent.mkdir(parents=True, exist_ok=True)
        unrelated = self.output.parent / "important.json"
        unrelated.write_text('{"private":"keep"}', encoding="utf-8")
        for output in (self.store.db_path, original, unrelated):
            with self.subTest(output=output):
                before = output.read_bytes()
                with self.assertRaises(ValueError):
                    export_questions(self.data_dir, output)
                self.assertEqual(output.read_bytes(), before)

    def test_export_does_not_follow_predictable_temporary_symlink(self):
        self.add_question("approved")
        self.output.parent.mkdir(parents=True, exist_ok=True)
        old_temporary = self.output.with_name(self.output.name + ".tmp")
        old_temporary.symlink_to(self.store.db_path)
        before = self.store.db_path.read_bytes()
        self.assertEqual(export_questions(self.data_dir, self.output), 1)
        self.assertEqual(self.store.db_path.read_bytes(), before)
        self.assertTrue(old_temporary.is_symlink())
        self.assertEqual(json.loads(self.output.read_text())["version"], 1)
        self.assertEqual(list(self.output.parent.glob(".questions-*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
