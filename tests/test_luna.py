import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from PIL import Image

from app.luna import MODEL_ID, LunaClient, LunaError, validate_questions


def region(region_id="region_001"):
    return {"id": region_id, "text": "黄色の根拠はフランスである。", "status": "ready"}


def payload(region_id="region_001"):
    return {"questions": [{
        "region_id": region_id, "question": "資料で示される国は？",
        "choices": [{"id": "a", "text": "フランス"}, {"id": "b", "text": "イタリア"}, {"id": "c", "text": "スペイン"}],
        "correct_choice_id": "a", "explanation": "黄色部分にフランスと明記されています。",
        "quote": "フランスである", "certainty": "clear", "single_correct_answer": True}], "uncertain_region_ids": []}


class ValidationTests(unittest.TestCase):
    def test_evidence_and_correct_choice_survive_validation(self):
        question = validate_questions(payload(), [region()], "source.jpg")[0]
        self.assertEqual(question["correct_choice_id"], "a")
        self.assertEqual(question["prompt"], "資料で示される国は？")
        self.assertEqual(question["quote"], "フランスである")
        self.assertEqual(question["status"], "pending_review")
        self.assertEqual(question["model"], MODEL_ID)

    def test_bad_quote_duplicate_choices_or_multiple_answers_reject_whole_batch(self):
        mutations = [
            lambda q: q.update(quote="資料にない事実"),
            lambda q: q["choices"][1].update(text=" フランス "),
            lambda q: q["choices"][1].update(id="a"),
            lambda q: q.update(correct_choice_id="d"),
            lambda q: q.update(single_correct_answer=False),
            lambda q: q.update(certainty="uncertain"),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                candidate = payload()
                mutate(candidate["questions"][0])
                with self.assertRaises(LunaError):
                    validate_questions(candidate, [region()], "source.jpg")

    def test_missing_or_overlapping_region_judgment_is_rejected(self):
        for candidate in [
            {"questions": [], "uncertain_region_ids": []},
            payload() | {"uncertain_region_ids": ["region_001"]},
            {"questions": [], "uncertain_region_ids": [{}]},
        ]:
            with self.subTest(candidate=candidate), self.assertRaises(LunaError):
                validate_questions(candidate, [region()], "source.jpg")

    def test_uncertain_region_produces_no_question(self):
        result = validate_questions({"questions": [], "uncertain_region_ids": ["region_001"]}, [region()], "source.jpg")
        self.assertEqual(result, [])


class LunaClientTests(unittest.TestCase):
    def test_missing_key_and_other_model_never_connect(self):
        calls = []
        transport = httpx.MockTransport(lambda request: calls.append(request))
        self.assertEqual(LunaClient(api_key="", transport=transport).check()["code"], "missing_api_key")
        self.assertEqual(LunaClient(api_key="test", model="other-model", transport=transport).check()["code"], "model_mismatch")
        self.assertEqual(calls, [])

    def test_model_check_requires_exact_model_id(self):
        seen = []
        def handler(request):
            seen.append(request)
            return httpx.Response(200, json={"id": MODEL_ID})
        client = LunaClient(api_key="test", transport=httpx.MockTransport(handler))
        self.assertTrue(client.check()["available"])
        self.assertEqual(str(seen[0].url), "https://api.openai.com/v1/models/gpt-6-luna")
        self.assertEqual(seen[0].method, "GET")
        wrong = LunaClient(api_key="test", transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"id": "other-model"})))
        self.assertFalse(wrong.check()["available"])

    def test_error_does_not_expose_api_response_or_secret(self):
        client = LunaClient(api_key="secret-never-print", transport=httpx.MockTransport(
            lambda request: httpx.Response(401, json={"error": "secret-never-print provider internals"})))
        checked = client.check()
        self.assertFalse(checked["available"])
        self.assertIn("OPENAI_API_KEY", checked["reason"])
        self.assertNotIn("secret-never-print", checked["reason"])

    def test_review_only_input_never_calls_api(self):
        calls = []
        client = LunaClient(api_key="test", transport=httpx.MockTransport(lambda request: calls.append(request)))
        with self.assertRaises(LunaError):
            client.generate({"regions": [region() | {"status": "needs_review"}]}, "source.jpg")
        self.assertEqual(calls, [])

    def test_generate_uses_bounded_scoped_images_and_only_luna(self):
        seen = []
        def handler(request):
            seen.append(request)
            if request.method == "GET":
                return httpx.Response(200, json={"id": MODEL_ID})
            return httpx.Response(200, json={"model": MODEL_ID, "status": "completed", "output": [
                {"type": "message", "content": [{"type": "output_text", "text": json.dumps(payload(), ensure_ascii=False)}]}]})
        with tempfile.TemporaryDirectory() as folder:
            image_path = Path(folder) / "scope.png"
            Image.new("RGB", (40, 20), "yellow").save(image_path)
            candidate = region() | {"scope_path": str(image_path), "mask_path": str(image_path)}
            client = LunaClient(api_key="test", transport=httpx.MockTransport(handler))
            result = client.generate({"regions": [candidate]}, "source.jpg")
        self.assertEqual(len(result), 1)
        request_body = json.loads(seen[1].content)
        self.assertEqual(request_body["model"], MODEL_ID)
        self.assertFalse(request_body["store"])
        self.assertEqual(request_body["text"]["format"]["type"], "json_schema")
        images = [part for part in request_body["input"][0]["content"] if part["type"] == "input_image"]
        self.assertEqual(len(images), 2)
        self.assertTrue(all(part["image_url"].startswith("data:image/png;base64,") for part in images))
        self.assertEqual(client.last_uncertain_region_ids, [])

    def test_uncertainty_ids_are_returned_for_persistence(self):
        client = LunaClient(api_key="test")
        uncertain = {"questions": [], "uncertain_region_ids": ["region_001"]}
        with patch.object(client, "check", return_value={"available": True}), patch.object(
            client, "_image_data", return_value="data:image/png;base64,AA=="
        ), patch.object(client, "_request", return_value={"model": MODEL_ID, "status": "completed", "output": [
            {"content": [{"type": "output_text", "text": json.dumps(uncertain)}]}]}
        ):
            self.assertEqual(client.generate({"regions": [region() | {"crop_path": "x", "mask_path": "y"}]}, "source.jpg"), [])
        self.assertEqual(client.last_uncertain_region_ids, ["region_001"])

    def test_bad_inference_model_is_rejected_without_fallback(self):
        client = LunaClient(api_key="test")
        with patch.object(client, "check", return_value={"available": True}), patch.object(
            client, "_image_data", return_value="data:image/png;base64,AA=="
        ), patch.object(client, "_request", return_value={"model": "other-model", "status": "completed", "output": []}):
            with self.assertRaises(LunaError):
                client.generate({"regions": [region() | {"crop_path": "x", "mask_path": "y"}]}, "source.jpg")


if __name__ == "__main__":
    unittest.main()
