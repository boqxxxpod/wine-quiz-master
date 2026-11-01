"""Local-first wine study app. Inference happens only during explicit ingestion."""
from __future__ import annotations

import hashlib
import os
import threading
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.drive import DriveClient, DriveError, SETUP, drive_configuration, valid_id
from app.store import Store, utcnow

APP_DIR = Path(__file__).resolve().parent.parent
EXPECTED_MODEL = "gpt-6-luna"
LUNA_SETUP = [
    "OpenAI APIの利用権限と課金設定を確認し、APIキーをサーバーのOPENAI_API_KEYに設定してください。ChatGPTの契約や接続とは別の設定です。",
    "OPENAI_MODEL=gpt-6-luna を設定してください。luna単独の文字列や別モデルは使用できません。",
    "「lunaを確認」でモデル取得APIの成功と正式IDを確認します。画像入力とStructured Outputsは公式仕様で確認済みです。実際の生成権限は取り込み時にも確認し、エラー時は停止します。",
    "別モデルへの自動切り替えは行いません。環境変数変更後はサーバーを再起動してください。",
]


class FolderBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    folder_id: str | None = None


class ReviewBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    approved: bool


class EmptyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


def failure(code: str, message: str, status=400, setup=None):
    detail = {"code": code, "message": message}
    if setup:
        detail["setup"] = setup
    raise HTTPException(status, detail=detail)


def public_data(value):
    """Disk locations remain private even when future extraction fields are added."""
    if isinstance(value, dict):
        return {key: public_data(item) for key, item in value.items() if not key.endswith("_path") and key != "manifest"}
    if isinstance(value, list):
        return [public_data(item) for item in value]
    return value


def safe_region(region: dict) -> dict:
    return public_data(region)


def safe_source(store: Store, source: dict, *, detail=False) -> dict:
    extraction = source["extraction"]
    result = {key: source[key] for key in ("id", "folder_id", "file_name", "mime_type", "status", "reason", "active", "downloaded", "generation_error", "modified_time", "size", "created_at", "updated_at")}
    result.update(
        regions_count=len(extraction.get("regions", [])),
        questions_count=len(store.questions(source_id=source["id"])),
        needs_review_count=sum(r.get("status") == "needs_review" for r in extraction.get("regions", [])),
        extraction_status=extraction.get("status"),
        extraction_reason=extraction.get("reason", ""),
    )
    if detail:
        result["regions"] = [safe_region(r) for r in extraction.get("regions", [])]
        result["questions"] = [q for q in store.questions(source_id=source["id"], approved_only=False, current_revision_only=True) if q["status"] != "invalidated"]
        result["extraction"] = public_data({k: v for k, v in extraction.items() if k != "regions"})
    return result


def create_app(data_dir: Path | str | None = None) -> FastAPI:
    store = Store(Path(data_dir or os.getenv("DATA_DIR", APP_DIR / "data")))
    app = FastAPI(title="ワイン検定 練習帖", docs_url=None, redoc_url=None)
    app.state.store = store
    busy_lock = threading.Lock()
    app.state.busy_lock = busy_lock
    hosts = [value.strip() for value in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,[::1],testserver").split(",") if value.strip()]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)

    @app.middleware("http")
    async def local_security(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            from fastapi.responses import JSONResponse
            origin = request.headers.get("origin")
            expected_host = request.headers.get("host", "")
            if request.headers.get("sec-fetch-site") == "cross-site" or (origin and (urlsplit(origin).netloc != expected_host or urlsplit(origin).scheme not in {"http", "https"})):
                return JSONResponse(status_code=403, content={"detail": {"code": "origin_rejected", "message": "同じアプリ画面から操作してください。"}})
            if request.headers.get("content-type", "").split(";", 1)[0].strip() != "application/json":
                return JSONResponse(status_code=415, content={"detail": {"code": "json_required", "message": "JSON形式で操作してください。"}})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def selected_folder() -> str:
        return store.get_setting("folder_id") or os.getenv("GOOGLE_DRIVE_FOLDER_ID", "")

    def model_configuration_signature() -> str:
        # Used only inside SQLite to invalidate cached availability after credentials change.
        value = os.getenv("OPENAI_API_KEY", "") + "\0" + os.getenv("OPENAI_MODEL", EXPECTED_MODEL).strip()
        return hashlib.sha256(value.encode()).hexdigest()

    def luna_config() -> dict:
        checked = store.get_setting("luna_check", {}) if store.get_setting("luna_check_signature") == model_configuration_signature() else {}
        model = os.getenv("OPENAI_MODEL", EXPECTED_MODEL).strip()
        configured = bool(os.getenv("OPENAI_API_KEY")) and model == EXPECTED_MODEL
        message = "lunaのAPIキーが未設定です。" if not os.getenv("OPENAI_API_KEY") else "正式モデルID gpt-6-luna を設定してください。" if model != EXPECTED_MODEL else checked.get("reason") or checked.get("message") or "設定済みです。「lunaを確認」で利用権限を確認してください。"
        return {**checked, "configured": configured, "model": model, "checked": bool(checked), "available": bool(configured and checked.get("available")), "message": message, "setup": LUNA_SETUP}

    def model_check() -> dict:
        try:
            from app.luna import LunaClient
            result = LunaClient().check()
        except Exception:
            result = {"available": False, "model": os.getenv("OPENAI_MODEL", EXPECTED_MODEL), "reason": "lunaの設定または接続を確認できません。サーバー設定と通信を確認してください。", "code": "luna_check_failed"}
        result["checked_at"] = utcnow()
        store.set_setting("luna_check", result)
        store.set_setting("luna_check_signature", model_configuration_signature())
        return result

    def acquire():
        if not busy_lock.acquire(blocking=False):
            failure("busy", "別の取り込み処理が進行中です。完了後に再実行してください。", 409)

    @app.get("/api/status")
    def status():
        drive = drive_configuration()
        drive["folder_id"] = selected_folder()
        warnings = []
        last_sync = store.get_setting("last_sync")
        if last_sync and not last_sync.get("ok"):
            warnings.append("前回のDrive同期に失敗しました。保存済み資料は最新と確認できていません。")
        if not store.counts()["questions"]:
            warnings.append("利用可能な承認済み問題がありません。写真の取り込み、黄色部分の確認、問題の承認状況を確認してください。")
        return {"counts": store.counts(), "drive": drive, "luna": luna_config(), "processing": {"busy": busy_lock.locked(), "last_sync": last_sync, "last_process": store.get_setting("last_process")}, "local_import": public_data(store.get_setting("local_import")), "warnings": warnings}

    @app.post("/api/check-model")
    def check_model(body: EmptyBody):
        acquire()
        try:
            result = model_check()
            return {**result, "configured": luna_config()["configured"], "message": result.get("reason", ""), "setup": LUNA_SETUP}
        finally:
            busy_lock.release()

    @app.post("/api/folders")
    def folders(body: FolderBody):
        acquire()
        try:
            drive = DriveClient()
            if body.folder_id:
                folder = drive.folder(body.folder_id.strip())
                store.set_setting("folder_id", folder["id"])
                return {"folders": [folder], "selected": folder, "message": "フォルダを確認しました。写真を同期してください。"}
            matches = drive.folders()
            result = {"folders": matches, "message": "同名フォルダが複数あります。IDで対象を選んでください。" if len(matches) > 1 else "「ワイン検定」フォルダが見つかりません。フォルダ名、閲覧権限、IDを確認してください。" if not matches else "フォルダが見つかりました。"}
            if len(matches) == 1:
                store.set_setting("folder_id", matches[0]["id"])
                result["selected"] = matches[0]
            return result
        except DriveError as exc:
            failure(exc.code, str(exc), setup=SETUP)
        finally:
            busy_lock.release()

    @app.post("/api/sync")
    def sync(body: FolderBody):
        folder_id = (body.folder_id or selected_folder()).strip()
        if not folder_id or not valid_id(folder_id):
            failure("folder_required", "対象フォルダIDを指定してください。Google DriveのURLのfolders/以降のIDです。", setup=SETUP)
        acquire()
        result = {"ok": True, "summary": {"found": 0, "downloaded": 0, "unchanged": 0, "failed": 0}, "errors": [], "message": "写真の同期が完了しました。"}
        try:
            drive = DriveClient()
            images = drive.images(folder_id)
            # Only a complete listing may invalidate photos absent from Drive.
            store.reconcile(folder_id, {photo["id"] for photo in images})
            store.set_setting("folder_id", folder_id)
            result["summary"]["found"] = len(images)
            for photo in images:
                source = store.upsert_source(photo, folder_id)
                original = Path(source["original_path"]) if source["original_path"] else None
                if source["downloaded"] and original and original.is_file():
                    result["summary"]["unchanged"] += 1
                    continue
                try:
                    # Filenames are display-only; safe IDs and revision hashes define disk paths.
                    safe_id = hashlib.sha256(source["id"].encode()).hexdigest()[:24]
                    destination = store.data_dir / "originals" / safe_id / source["remote_revision"] / "photo"
                    drive.download(photo, destination)
                    store.set_downloaded(source["id"], str(destination), source["remote_revision"])
                    result["summary"]["downloaded"] += 1
                except (DriveError, OSError) as exc:
                    message = str(exc) if isinstance(exc, DriveError) else "写真を保存できません。サーバーの空き容量と書き込み権限を確認してください。"
                    store.set_error(source["id"], message)
                    result["errors"].append({"source_id": source["id"], "file_name": source["file_name"], "message": message})
                    result["summary"]["failed"] += 1
            if result["errors"]:
                result.update(ok=False, message="一部の写真を同期できませんでした。更新された写真の旧問題は出題されません。")
            elif not images:
                result["message"] = "対象フォルダ直下に写真ファイルがありません。サブフォルダやショートカットは対象外です。"
            result["finished_at"] = utcnow()
            store.set_setting("last_sync", result)
            return result
        except DriveError as exc:
            result.update(ok=False, message=str(exc), finished_at=utcnow())
            store.set_setting("last_sync", result)
            failure(exc.code, str(exc), setup=SETUP)
        finally:
            busy_lock.release()

    @app.post("/api/process")
    def process(body: EmptyBody):
        acquire()
        result = {"ok": True, "summary": {"extracted": 0, "generated": 0, "questions": 0, "unchanged": 0, "needs_review": 0, "failed": 0}, "errors": [], "message": "取り込み処理が完了しました。生成問題は資料と照合して承認してください。"}
        try:
            from app.extraction import extract_image
            from app.luna import LunaClient
            ready = []
            for source in store.sources():
                if not source["active"] or not source["downloaded"]:
                    continue
                if source["generated_revision"] == source["remote_revision"]:
                    result["summary"]["unchanged"] += 1
                    continue
                if source["extracted_revision"] != source["remote_revision"]:
                    try:
                        if not Path(source["original_path"]).is_file():
                            raise OSError("missing")
                        safe_id = hashlib.sha256(source["id"].encode()).hexdigest()[:24]
                        directory = store.data_dir / "extracted" / safe_id / source["remote_revision"]
                        extraction = extract_image(Path(source["original_path"]), directory)
                        store.save_extraction(source["id"], extraction)
                        result["summary"]["extracted"] += 1
                        source = store.get_source(source["id"])
                    except Exception:
                        message = "写真の黄色部分を抽出できません。画像形式、鮮明さ、OCRの日本語データ、サーバー設定を確認してください。"
                        store.set_error(source["id"], message)
                        result["errors"].append({"source_id": source["id"], "message": message})
                        result["summary"]["failed"] += 1
                        continue
                if any(region.get("status") == "ready" for region in source["extraction"].get("regions", [])):
                    ready.append(source)
                else:
                    result["summary"]["needs_review"] += 1
            if ready:
                checked = model_check()
                if not checked.get("available"):
                    message = checked.get("reason") or "lunaを利用できないため問題生成を停止しました。"
                    result.update(ok=False, message=message, stopped=True, setup=LUNA_SETUP)
                    for source in ready:
                        store.set_error(source["id"], message, generation=True)
                else:
                    client = LunaClient()
                    for source in ready:
                        try:
                            extraction = {**source["extraction"], "regions": [r for r in source["extraction"].get("regions", []) if r.get("status") == "ready"]}
                            questions = client.generate(extraction, source["file_name"])
                            uncertain_ids = set(getattr(client, "last_uncertain_region_ids", []))
                            if uncertain_ids:
                                updated = source["extraction"]
                                for region in updated.get("regions", []):
                                    if region.get("id") in uncertain_ids:
                                        region.update(status="needs_review", reason="lunaが黄色部分の意味または正解の一意性を確認できませんでした。問題は作成していません。")
                                updated.update(status="needs_review", reason="問題の根拠が明確か確認が必要な黄色部分があります。")
                                store.save_extraction(source["id"], updated)
                                result["summary"]["needs_review"] += 1
                            store.save_questions(source["id"], questions)
                            result["summary"]["generated"] += 1
                            result["summary"]["questions"] += len(questions)
                        except Exception as exc:
                            # LunaError messages contain actionable public context, never raw response/key.
                            from app.luna import LunaError
                            message = str(exc) if isinstance(exc, (LunaError, ValueError)) else "lunaでの問題生成に失敗しました。接続とサーバー設定を確認してください。"
                            store.set_error(source["id"], message, generation=True)
                            result["errors"].append({"source_id": source["id"], "file_name": source["file_name"], "message": message})
                            result["summary"]["failed"] += 1
                            result.update(ok=False, stopped=True, message="問題生成を停止しました。エラーを解消してから再実行してください。")
                            break
            if result["errors"]:
                result["ok"] = False
            if not ready and result["summary"]["needs_review"]:
                result["message"] = "読み取った資料は要確認です。黄色部分の範囲・写真の向き・文字の鮮明さを資料画面で確認してください。問題は生成していません。"
            elif not ready and not result["summary"]["extracted"] and not result["summary"]["unchanged"]:
                result["message"] = "生成可能な黄色部分がありません。写真の同期状態と要確認の資料を確認してください。"
            result["finished_at"] = utcnow()
            store.set_setting("last_process", result)
            return result
        finally:
            busy_lock.release()

    @app.get("/api/sources")
    def sources():
        return [safe_source(store, source) for source in store.sources()]

    @app.get("/api/sources/{source_id}")
    def source_detail(source_id: str):
        source = store.get_source(source_id)
        if not source:
            failure("source_not_found", "資料が見つかりません。", 404)
        return safe_source(store, source, detail=True)

    @app.get("/api/images/{source_id}")
    def source_image(source_id: str, region: str | None = None, kind: str = "original"):
        source = store.get_source(source_id)
        if not source:
            failure("source_not_found", "資料が見つかりません。", 404)
        if kind not in {"original", "crop", "mask"}:
            failure("image_kind", "画像の種類が正しくありません。")
        image_path = source["original_path"]
        if kind != "original":
            selected = next((r for r in source["extraction"].get("regions", []) if str(r["id"]) == region), None)
            if not selected:
                failure("region_not_found", "黄色部分が見つかりません。", 404)
            image_path = selected.get(f"{kind}_path")
        if not image_path:
            failure("image_not_found", "画像が保存されていません。", 404)
        path = Path(image_path).resolve()
        if not path.is_relative_to(store.data_dir) or not path.is_file():
            failure("image_not_found", "画像が見つからないか、保存先が許可されていません。", 404)
        media = "image/png" if kind != "original" else source["mime_type"]
        return FileResponse(path, media_type=media, headers={"Cache-Control": "no-store"})

    @app.get("/api/questions")
    def questions():
        return store.questions()

    @app.post("/api/questions/{question_id}/review")
    def review(question_id: str, body: ReviewBody):
        acquire()
        try:
            return {"ok": True, "question": store.review_question(question_id, body.approved)}
        except KeyError:
            failure("question_not_found", "問題が見つかりません。", 404)
        except ValueError as exc:
            failure("review_invalid", str(exc), 409)
        finally:
            busy_lock.release()

    @app.get("/question-packs/practice-assets/{filename}", include_in_schema=False)
    def practice_asset(filename: str):
        if filename not in {"fr-002.png", "it-007-2.png", "es-021.png"}:
            failure("question_asset_not_found", "原文画像が見つかりません。", 404)
        pack_dir = APP_DIR / "question-packs"
        asset_dir = pack_dir / "practice-assets"
        asset = asset_dir / filename
        if any(path.is_symlink() for path in (pack_dir, asset_dir, asset)) or not asset.resolve().is_relative_to(APP_DIR.resolve()) or not asset.is_file():
            failure("question_asset_not_found", "原文画像が見つかりません。", 404)
        return FileResponse(asset, media_type="image/png" if filename.endswith(".png") else "image/jpeg")

    @app.get("/question-packs/{filename}", include_in_schema=False)
    def bundled_question_pack(filename: str):
        if filename not in {"wine-quiz-highlighted.json", "wine-quiz-practice-20261031.json", "place-relations.json"}:
            failure("question_pack_not_found", "組み込み問題集が見つかりません。", 404)
        pack_dir = APP_DIR / "question-packs"
        pack = pack_dir / filename
        if pack.is_symlink() or pack_dir.is_symlink() or not pack.resolve().is_relative_to(APP_DIR.resolve()) or not pack.is_file():
            failure("question_pack_not_found", f"組み込み問題集 {filename} が見つかりません。", 404)
        return FileResponse(pack, media_type="application/json")

    static_dir = APP_DIR / "static"
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

        @app.get("/", include_in_schema=False)
        def home():
            return FileResponse(static_dir / "index.html", media_type="text/html")
    return app


app = create_app()
