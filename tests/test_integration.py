"""Cross-module checks using synthetic photographs and a mocked OpenAI transport.

These fixtures are never imported into the application's real data directory.
No Google or OpenAI network requests are made by this suite.
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from PIL import Image

from app.drive import DriveError
from app.luna import LunaClient as RealLunaClient
from app.main import create_app


FOLDER_ID = "synthetic_folder_12345"
SOURCE_ID = "synthetic_photo_12345"
YELLOW_TEXT = "ブドウの果皮には色素が含まれます。"


class IngestionIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="wine-integration-")
        self.data_dir = Path(self.directory.name)
        self.environment = patch.dict(os.environ, {
            "OPENAI_API_KEY": "synthetic-secret-must-never-appear-in-browser",
            "OPENAI_MODEL": "gpt-6-luna",
            "ALLOWED_HOSTS": "testserver",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.addCleanup(self.directory.cleanup)
        self.metadata = {
            "id": SOURCE_ID, "name": "synthetic-test-only.png", "mimeType": "image/png",
            "size": "300", "md5Checksum": "revision-one", "modifiedTime": "2026-01-01T00:00:00Z",
        }
        self.remote_images = [self.metadata]
        self.fail_download = False
        self.downloads = 0
        self.extractions = 0
        self.model_requests = []
        self.model_uncertain = False
        self.model_bad_quote = False
        case = self

        class SyntheticDrive:
            def images(self, folder_id):
                case.assertEqual(folder_id, FOLDER_ID)
                return [dict(item) for item in case.remote_images]

            def download(self, meta, destination):
                case.downloads += 1
                if case.fail_download:
                    raise DriveError("検証用のダウンロード失敗", "synthetic_failure")
                destination.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGB", (160, 40), (255, 245, 80)).save(destination, format="PNG")

        def synthetic_extract(original, output_dir):
            self.extractions += 1
            output_dir.mkdir(parents=True, exist_ok=True)
            for suffix in ("crop", "scope", "yellow"):
                with Image.open(original) as source:
                    source.save(output_dir / f"region_001_{suffix}.png")
            return {
                "version": "synthetic-test-only", "status": "ready", "reason": "検証専用",
                "source_path": str(original), "source_size": [160, 40],
                "regions": [{
                    "id": "region_001", "status": "ready", "reason": "検証専用",
                    "text": YELLOW_TEXT, "confidence": 99, "bbox": [0, 0, 160, 40],
                    "crop_path": str(output_dir / "region_001_crop.png"),
                    "scope_path": str(output_dir / "region_001_scope.png"),
                    "mask_path": str(output_dir / "region_001_yellow.png"),
                }],
            }

        def provider(request):
            self.model_requests.append((request.method, request.url.path))
            if request.method == "GET" and request.url.path.endswith("/models/gpt-6-luna"):
                return httpx.Response(200, json={"id": "gpt-6-luna"})
            self.assertEqual(request.method, "POST")
            self.assertTrue(request.url.path.endswith("/responses"))
            body = json.loads(request.content)
            self.assertEqual(body["model"], "gpt-6-luna")
            self.assertIs(body["store"], False)
            self.assertLessEqual(body["max_output_tokens"], 3400)
            generated = {
                "questions": [{
                    "region_id": "region_001", "question": "色素が含まれる部位はどれですか。",
                    "choices": [{"id": "skin", "text": "果皮"}, {"id": "seed", "text": "種"}, {"id": "stem", "text": "梗"}],
                    "correct_choice_id": "skin", "explanation": "黄色部分に果皮には色素が含まれるとあります。",
                    "quote": "果皮には色素が含まれます", "certainty": "clear", "single_correct_answer": True,
                }], "uncertain_region_ids": [],
            }
            if self.model_uncertain:
                generated = {"questions": [], "uncertain_region_ids": ["region_001"]}
            elif self.model_bad_quote:
                generated["questions"][0]["quote"] = "黄色部分に含まれない根拠"
            return httpx.Response(200, json={
                "model": "gpt-6-luna", "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(generated, ensure_ascii=False)}]}],
            })

        self.transport = httpx.MockTransport(provider)
        self.patches = [
            patch("app.main.DriveClient", SyntheticDrive),
            patch("app.extraction.extract_image", synthetic_extract),
            patch("app.luna.LunaClient", side_effect=lambda: RealLunaClient(transport=self.transport)),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.app = create_app(self.data_dir)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def post(self, path, body=None):
        response = self.client.post(path, json={} if body is None else body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def ingest_and_approve(self):
        synced = self.post("/api/sync", {"folder_id": FOLDER_ID})
        self.assertTrue(synced["ok"], synced)
        processed = self.post("/api/process")
        self.assertTrue(processed["ok"], processed)
        self.assertEqual(processed["summary"]["questions"], 1, processed)
        self.assertEqual(self.client.get("/api/questions").json(), [])
        detail = self.client.get(f"/api/sources/{SOURCE_ID}").json()
        question = next(q for q in detail["questions"] if q["status"] == "pending_review")
        self.post(f"/api/questions/{question['id']}/review", {"approved": True})
        return question

    def test_real_luna_schema_to_saved_approved_question_and_idempotent_import(self):
        question = self.ingest_and_approve()
        available = self.client.get("/api/questions").json()
        self.assertEqual(len(available), 1)
        self.assertEqual(available[0]["id"], question["id"])
        self.assertEqual(available[0]["prompt"], "色素が含まれる部位はどれですか。")
        self.assertEqual(available[0]["source"]["id"], SOURCE_ID)
        self.assertEqual(available[0]["source"]["file_name"], self.metadata["name"])
        self.assertIn(available[0]["quote"], YELLOW_TEXT)
        requests_before = list(self.model_requests)
        sync = self.post("/api/sync", {"folder_id": FOLDER_ID})
        processed = self.post("/api/process")
        self.assertEqual(sync["summary"]["unchanged"], 1)
        self.assertEqual(processed["summary"]["unchanged"], 1)
        self.assertEqual(self.downloads, 1)
        self.assertEqual(self.extractions, 1)
        self.assertEqual(self.model_requests, requests_before)
        self.assertEqual(sum(method == "POST" for method, _ in self.model_requests), 1)

    def test_normal_practice_and_provenance_reads_make_no_external_requests(self):
        self.ingest_and_approve()
        requests_before = list(self.model_requests)
        for path in ("/api/status", "/api/questions", "/api/sources", f"/api/sources/{SOURCE_ID}",
                     f"/api/images/{SOURCE_ID}", f"/api/images/{SOURCE_ID}?kind=crop&region=region_001",
                     f"/api/images/{SOURCE_ID}?kind=mask&region=region_001"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, response.text[:300])
            if response.headers.get("content-type", "").startswith("application/json"):
                self.assertNotIn("synthetic-secret", response.text)
                self.assertNotIn(str(self.data_dir), response.text, "server paths must stay private")
        self.assertEqual(self.model_requests, requests_before)
        self.assertEqual(self.downloads, 1)

    def test_changed_photo_invalidates_old_answer_even_when_download_fails(self):
        old = self.ingest_and_approve()
        self.metadata.update(md5Checksum="revision-two", modifiedTime="2026-01-02T00:00:00Z")
        self.fail_download = True
        sync = self.post("/api/sync", {"folder_id": FOLDER_ID})
        self.assertFalse(sync["ok"])
        self.assertEqual(self.client.get("/api/questions").json(), [])
        denied = self.client.post(f"/api/questions/{old['id']}/review", json={"approved": True})
        self.assertEqual(denied.status_code, 409)
        self.fail_download = False
        new = self.ingest_and_approve()
        self.assertNotEqual(new["id"], old["id"])
        self.assertEqual(self.extractions, 2)
        self.assertEqual([q["id"] for q in self.client.get("/api/questions").json()], [new["id"]])
        current_detail = self.client.get(f"/api/sources/{SOURCE_ID}").json()
        self.assertNotIn(old["id"], [q["id"] for q in current_detail["questions"]],
                         "an old question must not be paired with the current image's reused region ID")

    def test_removed_then_restored_photo_can_produce_current_reviewable_question(self):
        old = self.ingest_and_approve()
        self.remote_images = []
        self.post("/api/sync", {"folder_id": FOLDER_ID})
        self.assertEqual(self.client.get("/api/questions").json(), [])
        self.remote_images = [self.metadata]
        restored = self.ingest_and_approve()
        self.assertNotEqual(restored["id"], old["id"])
        self.assertEqual([q["id"] for q in self.client.get("/api/questions").json()], [restored["id"]])

    def test_unavailable_luna_stops_without_generation_or_fallback(self):
        self.post("/api/sync", {"folder_id": FOLDER_ID})
        with patch.dict(os.environ, {"OPENAI_MODEL": "another-model"}):
            processed = self.post("/api/process")
        self.assertFalse(processed["ok"])
        self.assertTrue(processed["stopped"])
        self.assertEqual(self.model_requests, [])
        self.assertEqual(self.client.get("/api/questions").json(), [])
        self.assertTrue(self.app.state.store.get_source(SOURCE_ID)["generation_error"])

    def test_model_uncertainty_is_saved_with_reason_and_not_regenerated(self):
        self.model_uncertain = True
        self.post("/api/sync", {"folder_id": FOLDER_ID})
        processed = self.post("/api/process")
        self.assertTrue(processed["ok"], processed)
        self.assertEqual(processed["summary"]["questions"], 0)
        self.assertEqual(processed["summary"]["needs_review"], 1)
        detail = self.client.get(f"/api/sources/{SOURCE_ID}").json()
        self.assertEqual(detail["regions"][0]["status"], "needs_review")
        self.assertTrue(detail["regions"][0]["reason"])
        self.assertEqual(detail["questions"], [])
        before = list(self.model_requests)
        again = self.post("/api/process")
        self.assertEqual(again["summary"]["unchanged"], 1)
        self.assertEqual(self.model_requests, before)

    def test_question_with_quote_outside_yellow_text_is_never_saved(self):
        self.model_bad_quote = True
        self.post("/api/sync", {"folder_id": FOLDER_ID})
        processed = self.post("/api/process")
        self.assertFalse(processed["ok"])
        self.assertTrue(processed["stopped"])
        self.assertEqual(self.app.state.store.questions(approved_only=False), [])
        self.assertEqual(self.client.get("/api/questions").json(), [])
        self.assertIn("引用", self.app.state.store.get_source(SOURCE_ID)["generation_error"])


if __name__ == "__main__":
    unittest.main()
