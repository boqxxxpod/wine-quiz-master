"""Persistence and HTTP boundary tests; fixtures are synthetic and never seed the app."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import APP_DIR, create_app
from app.store import Store


def fixture(store: Store):
    meta = {"id": "synthetic_photo_01", "name": "test-only.jpg", "mimeType": "image/jpeg", "md5Checksum": "first", "size": "30"}
    source = store.upsert_source(meta, "synthetic_folder_01")
    path = store.data_dir / "test-only.jpg"
    path.write_bytes(b"synthetic fixture")
    store.set_downloaded(source["id"], str(path), source["remote_revision"])
    store.save_extraction(source["id"], {"status": "ready", "source_path": str(path), "regions": [{"id": "r1", "status": "ready", "text": "黄色部分に書かれた検証用の根拠", "bbox": [1, 2, 3, 4], "crop_path": str(path), "mask_path": str(path), "scope_path": str(path)}]})
    question = {"prompt": "検証用の設問", "choices": [{"id": "a", "text": "検証用A"}, {"id": "b", "text": "検証用B"}, {"id": "c", "text": "検証用C"}], "correct_choice_id": "b", "explanation": "検証用の説明です。", "quote": "検証用の根拠", "region_id": "r1"}
    return meta, source["id"], question


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name))
        self.meta, self.sid, self.q = fixture(self.store)

    def tearDown(self):
        self.temp.cleanup()

    def test_only_approved_valid_questions_are_practice_material(self):
        self.store.save_questions(self.sid, [self.q])
        self.assertEqual(self.store.questions(), [])
        pending = self.store.questions(approved_only=False)[0]
        self.store.review_question(pending["id"], True)
        self.assertEqual(self.store.questions()[0]["correct_choice_id"], "b")
        self.store.upsert_source({**self.meta, "md5Checksum": "changed"}, "synthetic_folder_01")
        self.assertEqual(self.store.questions(), [])
        with self.assertRaises(ValueError):
            self.store.review_question(pending["id"], True)

    def test_duplicate_answers_and_unmatched_quote_rejected(self):
        for broken in (
            {**self.q, "correct_choice_id": "missing"},
            {**self.q, "quote": "資料に記載されていない文"},
            {**self.q, "choices": [self.q["choices"][0]] * 3},
        ):
            with self.subTest(question=broken), self.assertRaises(ValueError):
                self.store.save_questions(self.sid, [broken])
        self.assertEqual(self.store.questions(approved_only=False), [])

    def test_rejected_question_cannot_silently_return(self):
        self.store.save_questions(self.sid, [self.q])
        qid = self.store.questions(approved_only=False)[0]["id"]
        self.store.review_question(qid, False)
        with self.assertRaises(ValueError):
            self.store.review_question(qid, True)
        self.assertEqual(self.store.questions(), [])

    def test_revision_snapshots_are_retained_and_reactivation_invalidates(self):
        self.store.save_questions(self.sid, [self.q])
        first_revision = self.store.get_source(self.sid)["remote_revision"]
        self.store.reconcile("synthetic_folder_01", set())
        source = self.store.upsert_source(self.meta, "synthetic_folder_01")
        self.assertIsNone(source["generated_revision"])
        with self.store._connect() as db:
            saved = db.execute("SELECT * FROM source_versions WHERE source_id=? AND revision=?", (self.sid, first_revision)).fetchone()
        self.assertEqual(json.loads(saved["extraction_json"])["regions"][0]["text"], "黄色部分に書かれた検証用の根拠")


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Path(self.temp.name))
        self.client = TestClient(self.app)
        self.meta, self.sid, self.q = fixture(self.app.state.store)

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def test_readonly_routes_never_call_external_services(self):
        with patch("app.main.DriveClient", side_effect=AssertionError("Drive must not run")), patch("app.luna.LunaClient", side_effect=AssertionError("Luna must not run")):
            for route in ("/api/status", "/api/questions", "/api/sources", f"/api/sources/{self.sid}", "/question-packs/wine-quiz-highlighted.json"):
                self.assertEqual(self.client.get(route).status_code, 200)

    def test_standard_pack_returns_original_json_without_exposing_pack_directory(self):
        with patch("app.main.DriveClient", side_effect=AssertionError("Drive must not run")), patch("app.luna.LunaClient", side_effect=AssertionError("Luna must not run")):
            for filename, count in [("wine-quiz-highlighted.json", 662), ("wine-quiz-practice-20261031.json", 226)]:
                with self.subTest(filename=filename):
                    response = self.client.get(f"/question-packs/{filename}")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["content-type"], "application/json")
                    self.assertEqual(response.content, (APP_DIR / "question-packs" / filename).read_bytes())
                    self.assertEqual(len(response.json()["questions"]), count)
            for route in ("/question-packs/", "/question-packs/README.md", "/question-packs/batches/pilot-01.json", "/question-packs/private.json", "/question-packs/wine-quiz-500.json", "/question-packs/coverage.json", "/question-packs/highlighted-batches/wine-quiz-01.json", "/question-packs/pilot-150.json", "/question-packs/batches/wine-quiz-01.json"):
                with self.subTest(route=route):
                    self.assertEqual(self.client.get(route).status_code, 404)

    def test_bundled_packs_reject_missing_files_and_leaf_or_parent_symlinks(self):
        for filename in ("wine-quiz-highlighted.json", "wine-quiz-practice-20261031.json", "place-relations.json"):
            with self.subTest(filename=filename):
                root = Path(self.temp.name) / filename
                pack_dir = root / "question-packs"
                pack_dir.mkdir(parents=True)
                pack = pack_dir / filename
                outside = root / "private.json"
                outside.write_text('{"private":"do-not-serve"}', encoding="utf-8")
                route = f"/question-packs/{filename}"
                with patch("app.main.APP_DIR", root):
                    self.assertEqual(self.client.get(route).status_code, 404)
                    pack.symlink_to(outside)
                    self.assertEqual(self.client.get(route).status_code, 404)
                    pack.unlink()
                    pack_dir.rmdir()
                    outside_dir = root / "private-packs"
                    outside_dir.mkdir()
                    (outside_dir / filename).write_bytes(outside.read_bytes())
                    pack_dir.symlink_to(outside_dir, target_is_directory=True)
                    self.assertEqual(self.client.get(route).status_code, 404)

    def test_place_data_is_bundled_without_external_services_or_review_files(self):
        with patch("app.main.DriveClient", side_effect=AssertionError("Drive must not run")), patch(
            "app.luna.LunaClient", side_effect=AssertionError("Luna must not run")
        ):
            response = self.client.get("/question-packs/place-relations.json?v=test")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, (APP_DIR / "question-packs/place-relations.json").read_bytes())
            self.assertEqual(len(response.json()["places"]), 15)
            self.assertEqual(self.client.get("/question-packs/place-relations-validation.md").status_code, 404)

    def test_practice_crops_serve_exact_bundled_bytes_without_external_services(self):
        from scripts.build_pages import PUBLIC_PRACTICE_ASSETS
        with patch("app.main.DriveClient", side_effect=AssertionError("Drive must not run")), patch("app.luna.LunaClient", side_effect=AssertionError("Luna must not run")):
            for relative in PUBLIC_PRACTICE_ASSETS:
                response = self.client.get(f"/{relative}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, (APP_DIR / relative).read_bytes())
                self.assertEqual(response.headers["content-type"], "image/png" if relative.endswith(".png") else "image/jpeg")
            for route in ("/question-packs/practice-assets/", "/question-packs/practice-assets/private.jpg",
                          "/question-packs/practice-assets/it-023.jpg", "/question-packs/practice-assets/it-024.jpg",
                          "/question-packs/practice-assets/it-025.jpg", "/question-packs/practice-assets/it-026.jpg",
                          "/question-packs/practice-source-review.json", "/question-packs/practice-assets/%2e%2e%2fprivate.jpg"):
                self.assertEqual(self.client.get(route).status_code, 404)

    def test_practice_crops_reject_missing_files_and_symlinks_at_each_level(self):
        root = Path(self.temp.name) / "assets-test"
        asset_dir = root / "question-packs/practice-assets"
        asset_dir.mkdir(parents=True)
        target = asset_dir / "fr-002.png"
        private = root / "private.png"
        private.write_bytes(b"PRIVATE CANARY")
        route = "/question-packs/practice-assets/fr-002.png"
        with patch("app.main.APP_DIR", root):
            self.assertEqual(self.client.get(route).status_code, 404)
            target.symlink_to(private)
            self.assertEqual(self.client.get(route).status_code, 404)
            target.unlink()
            asset_dir.rmdir()
            asset_dir.symlink_to(root, target_is_directory=True)
            self.assertEqual(self.client.get(route).status_code, 404)
            asset_dir.unlink()
            asset_dir.parent.rmdir()
            asset_dir.parent.symlink_to(root, target_is_directory=True)
            self.assertEqual(self.client.get(route).status_code, 404)

    def test_source_json_never_exposes_server_paths(self):
        result = self.client.get(f"/api/sources/{self.sid}")
        self.assertEqual(result.status_code, 200)
        self.assertNotIn(self.temp.name, result.text)
        self.assertNotIn("scope_path", result.text)

    def test_browser_mutations_reject_cross_origin_and_non_json(self):
        self.assertEqual(self.client.post("/api/process", json={}, headers={"Origin": "https://attacker.invalid"}).status_code, 403)
        self.assertEqual(self.client.post("/api/process", data="{}").status_code, 415)
        self.assertEqual(self.client.get("/api/status", headers={"Host": "attacker.invalid"}).status_code, 400)

    def test_cannot_use_image_endpoint_to_serve_arbitrary_file(self):
        source = self.app.state.store.get_source(self.sid)
        self.app.state.store.set_downloaded(self.sid, "/etc/passwd", source["remote_revision"])
        self.assertEqual(self.client.get(f"/api/images/{self.sid}").status_code, 404)

    def test_secret_configuration_fields_cannot_be_posted(self):
        response = self.client.post("/api/folders", json={"folder_id": "synthetic_folder_01", "GOOGLE_REFRESH_TOKEN": "do-not-save"})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
