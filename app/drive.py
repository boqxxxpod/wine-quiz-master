"""Google Drive readonly API access with credentials confined to the server."""
from __future__ import annotations

import os
import re
import hashlib
from pathlib import Path

import requests

SCOPE = "https://www.googleapis.com/auth/drive.readonly"
BASE = "https://www.googleapis.com/drive/v3"
MAX_IMAGE_BYTES = 20 * 1024 * 1024
SETUP = [
    "Google CloudでGoogle Drive APIを有効にしてください。",
    "サービスアカウントの場合: JSON認証ファイルをGit管理外に置き、GOOGLE_APPLICATION_CREDENTIALSに絶対パスを設定し、対象フォルダをそのサービスアカウントのメールに閲覧者として共有してください。",
    "OAuthの場合: drive.readonlyスコープとオフラインアクセスで取得したGOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、GOOGLE_REFRESH_TOKENをサーバー環境変数に設定してください。",
    "ChatGPTのGoogle Drive接続はこのWebアプリのサーバー認証に引き継がれません。設定後にサーバーを再起動してください。",
]


class DriveError(Exception):
    def __init__(self, message: str, code="drive_error"):
        super().__init__(message)
        self.code = code


def valid_id(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{10,160}", value))


def drive_configuration() -> dict:
    service_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
    oauth_fields = [os.getenv(key, "") for key in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN")]
    configured = bool(service_path or all(oauth_fields))
    return {
        "configured": configured,
        "auth_type": "service_account" if service_path else "oauth" if all(oauth_fields) else None,
        "message": "サーバー認証情報が設定されています。接続はフォルダ検索または同期で確認します。" if configured else "Google Driveのサーバー認証情報が未設定です。",
        "setup": SETUP,
    }


class DriveClient:
    def __init__(self):
        config = drive_configuration()
        if not config["configured"]:
            raise DriveError("Google Driveのサーバー認証情報が未設定です。接続手順を確認してください。", "drive_not_configured")
        try:
            if config["auth_type"] == "service_account":
                from google.oauth2 import service_account
                credential_path = Path(os.environ["GOOGLE_APPLICATION_CREDENTIALS"]).expanduser()
                if not credential_path.is_absolute() or not credential_path.is_file():
                    raise DriveError("GOOGLE_APPLICATION_CREDENTIALSに読み取り可能な認証JSONの絶対パスを指定してください。", "credentials_path")
                self.credentials = service_account.Credentials.from_service_account_file(str(credential_path), scopes=[SCOPE])
            else:
                from google.oauth2.credentials import Credentials
                self.credentials = Credentials(None, refresh_token=os.environ["GOOGLE_REFRESH_TOKEN"], token_uri="https://oauth2.googleapis.com/token", client_id=os.environ["GOOGLE_CLIENT_ID"], client_secret=os.environ["GOOGLE_CLIENT_SECRET"], scopes=[SCOPE])
        except DriveError:
            raise
        except Exception:
            raise DriveError("Google認証情報を読み取れません。JSON形式またはOAuth環境変数を確認してください。", "credentials_invalid") from None

    def _headers(self) -> dict:
        try:
            if not self.credentials.valid:
                from google.auth.transport.requests import Request
                self.credentials.refresh(Request())
            return {"Authorization": f"Bearer {self.credentials.token}"}
        except Exception:
            raise DriveError("Google認証の更新に失敗しました。認証情報、有効期限、Driveの読み取りスコープ、通信設定を確認してください。", "drive_authentication") from None

    def _get(self, suffix: str, params=None, *, stream=False):
        try:
            response = requests.get(BASE + suffix, params=params, headers=self._headers(), timeout=(10, 60), stream=stream, allow_redirects=False)
        except requests.RequestException:
            raise DriveError("Google Driveへの通信に失敗しました。ネットワークとGoogle APIへの接続を確認してください。", "drive_network") from None
        if response.status_code != 200:
            status = response.status_code
            response.close()
            if status in (401, 403):
                raise DriveError("Google Driveへの認証または閲覧権限がありません。Drive APIの有効化、drive.readonlyスコープ、対象フォルダの共有を確認してください。", "drive_permission")
            if status == 404:
                raise DriveError("フォルダまたは写真が見つかりません。IDと閲覧権限を確認してください。", "drive_not_found")
            raise DriveError(f"Google DriveがHTTP {status}を返しました。時間をおいて再試行してください。", "drive_http")
        return response

    def _list(self, query: str, fields: str) -> list[dict]:
        result, token = [], None
        while True:
            params = {"q": query, "pageSize": 100, "fields": f"nextPageToken,files({fields})", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}
            if token:
                params["pageToken"] = token
            response = self._get("/files", params)
            try:
                data = response.json()
                result.extend(data.get("files", []))
                token = data.get("nextPageToken")
            except (ValueError, TypeError):
                raise DriveError("Google Driveの応答を読み取れませんでした。", "drive_response") from None
            finally:
                response.close()
            if not token:
                return result

    def folders(self) -> list[dict]:
        return self._list("name = 'ワイン検定' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", "id,name")

    def folder(self, folder_id: str) -> dict:
        if not valid_id(folder_id):
            raise DriveError("Google DriveのフォルダIDの形式が正しくありません。URLのfolders/以降のIDを指定してください。", "folder_id_invalid")
        response = self._get(f"/files/{folder_id}", {"fields": "id,name,mimeType,trashed", "supportsAllDrives": "true"})
        try:
            data = response.json()
        finally:
            response.close()
        if data.get("mimeType") != "application/vnd.google-apps.folder" or data.get("trashed"):
            raise DriveError("指定IDは利用できるGoogle Driveフォルダではありません。", "not_folder")
        return {"id": data["id"], "name": data["name"]}

    def images(self, folder_id: str) -> list[dict]:
        self.folder(folder_id)
        files = self._list(f"'{folder_id}' in parents and trashed = false and mimeType contains 'image/'", "id,name,mimeType,md5Checksum,modifiedTime,size")
        return sorted(files, key=lambda item: (item.get("name", ""), item["id"]))

    def download(self, meta: dict, destination: Path):
        if not valid_id(str(meta.get("id", ""))):
            raise DriveError("写真のIDが不正です。", "file_id_invalid")
        if int(meta.get("size") or 0) > MAX_IMAGE_BYTES:
            raise DriveError("写真が20MBを超えるため取り込めません。画像を縮小して再追加してください。", "image_too_large")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".part")
        response = self._get(f"/files/{meta['id']}", {"alt": "media", "supportsAllDrives": "true"}, stream=True)
        try:
            size = 0
            checksum = hashlib.md5()
            with temporary.open("wb") as handle:
                for chunk in response.iter_content(128 * 1024):
                    size += len(chunk)
                    if size > MAX_IMAGE_BYTES:
                        raise DriveError("写真が20MBを超えるため取り込めません。", "image_too_large")
                    checksum.update(chunk)
                    handle.write(chunk)
            if not size:
                raise DriveError("写真が空のため取り込めません。", "empty_image")
            if meta.get("md5Checksum") and checksum.hexdigest() != meta["md5Checksum"]:
                raise DriveError("同期中に写真が変更されたか、転送結果が一致しません。写真の同期を再実行してください。", "image_revision_mismatch")
            temporary.replace(destination)
        except requests.RequestException:
            raise DriveError("写真のダウンロードが中断されました。同期を再実行してください。", "drive_network") from None
        finally:
            response.close()
            temporary.unlink(missing_ok=True)
