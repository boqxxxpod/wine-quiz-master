"""Persistence and HTTP boundary tests; fixtures are synthetic and never seed the app."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import create_app
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
            for route in ("/api/status", "/api/questions", "/api/sources", f"/api/sources/{self.sid}"):
                self.assertEqual(self.client.get(route).status_code, 200)

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
