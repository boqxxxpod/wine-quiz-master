"""Small, transactional persistence layer for photo evidence and reviewed questions."""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalized(value: str) -> str:
    return re.sub(r"\s+", "", value or "")


def revision_for(meta: dict) -> str:
    value = [meta.get("md5Checksum", ""), meta.get("modifiedTime", ""), str(meta.get("size", ""))]
    return hashlib.sha256(json.dumps(value).encode()).hexdigest()


class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "wine-quiz.sqlite3"
        self._lock = threading.RLock()
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sources (
                    id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, file_name TEXT NOT NULL,
                    mime_type TEXT NOT NULL, remote_revision TEXT NOT NULL,
                    downloaded_revision TEXT, extracted_revision TEXT, generated_revision TEXT,
                    original_path TEXT, extraction_json TEXT, active INTEGER NOT NULL DEFAULT 1,
                    status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '',
                    generation_error TEXT NOT NULL DEFAULT '', modified_time TEXT, size INTEGER,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS questions (
                    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
                    source_revision TEXT NOT NULL, region_id TEXT NOT NULL, question_json TEXT NOT NULL,
                    status TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS questions_source ON questions(source_id);
                CREATE TABLE IF NOT EXISTS source_versions (
                    source_id TEXT NOT NULL, revision TEXT NOT NULL, file_name TEXT NOT NULL,
                    original_path TEXT NOT NULL, extraction_json TEXT NOT NULL, captured_at TEXT NOT NULL,
                    PRIMARY KEY(source_id,revision)
                );
            """)

    def _connect(self):
        db = sqlite3.connect(self.db_path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def set_setting(self, key: str, value: Any):
        with self._lock, self._connect() as db:
            db.execute("INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value, ensure_ascii=False)))

    def get_setting(self, key: str, default=None):
        with self._lock, self._connect() as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            return json.loads(row["value"]) if row else default

    def upsert_source(self, meta: dict, folder_id: str) -> dict:
        """Register remote metadata before download, immediately invalidating changed evidence."""
        source_id = str(meta["id"])
        revision = revision_for(meta)
        now = utcnow()
        with self._lock, self._connect() as db:
            old = db.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
            if old:
                changed = old["remote_revision"] != revision or not old["active"]
                db.execute("""UPDATE sources SET folder_id=?,file_name=?,mime_type=?,remote_revision=?,
                    modified_time=?,size=?,active=1,status=?,reason=?,updated_at=? WHERE id=?""",
                    (folder_id, meta.get("name", source_id), meta.get("mimeType", "image/jpeg"), revision,
                     meta.get("modifiedTime"), int(meta.get("size") or 0),
                     "pending" if changed else old["status"],
                     "写真が更新されたため再取り込みが必要です。" if changed else old["reason"], now, source_id))
                if changed:
                    db.execute("UPDATE questions SET status='invalidated' WHERE source_id=? AND status != 'rejected'", (source_id,))
                    db.execute("UPDATE sources SET generated_revision=NULL WHERE id=?", (source_id,))
            else:
                db.execute("""INSERT INTO sources (id,folder_id,file_name,mime_type,remote_revision,
                    modified_time,size,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)""",
                    (source_id, folder_id, meta.get("name", source_id), meta.get("mimeType", "image/jpeg"), revision,
                     meta.get("modifiedTime"), int(meta.get("size") or 0), now, now))
        return self.get_source(source_id)

    def set_downloaded(self, source_id: str, path: str, revision: str):
        path = str(Path(path).resolve())
        with self._lock, self._connect() as db:
            db.execute("""UPDATE sources SET original_path=?,downloaded_revision=?,status='downloaded',
                reason='',generation_error='',updated_at=? WHERE id=? AND remote_revision=? AND active=1""",
                (path, revision, utcnow(), source_id, revision))

    def set_error(self, source_id: str, message: str, *, generation=False):
        with self._lock, self._connect() as db:
            if generation:
                db.execute("UPDATE sources SET generation_error=?,updated_at=? WHERE id=?", (message, utcnow(), source_id))
            else:
                db.execute("UPDATE sources SET status='error',reason=?,updated_at=? WHERE id=?", (message, utcnow(), source_id))

    def reconcile(self, folder_id: str, current_ids: set[str]):
        """Call only after a complete successful remote listing."""
        with self._lock, self._connect() as db:
            rows = db.execute("SELECT id FROM sources WHERE active=1").fetchall()
            for row in rows:
                if row["id"] not in current_ids:
                    db.execute("UPDATE sources SET active=0,status='removed',reason=?,updated_at=? WHERE id=?",
                               ("対象フォルダに見つからない、または別のフォルダへ切り替えられた資料です。", utcnow(), row["id"]))
                    db.execute("UPDATE questions SET status='invalidated' WHERE source_id=? AND status != 'rejected'", (row["id"],))

    def save_extraction(self, source_id: str, extraction: dict):
        with self._lock, self._connect() as db:
            db.execute("""UPDATE sources SET extraction_json=?,extracted_revision=downloaded_revision,
                status=?,reason=?,generation_error='',updated_at=?
                WHERE id=? AND active=1 AND downloaded_revision=remote_revision""",
                (json.dumps(extraction, ensure_ascii=False), extraction.get("status", "needs_review"),
                 extraction.get("reason", ""), utcnow(), source_id))
            row = db.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
            if row and row["active"] and row["downloaded_revision"] == row["remote_revision"]:
                db.execute("""INSERT INTO source_versions VALUES(?,?,?,?,?,?)
                    ON CONFLICT(source_id,revision) DO UPDATE SET extraction_json=excluded.extraction_json""",
                    (source_id, row["remote_revision"], row["file_name"], row["original_path"],
                     json.dumps(extraction, ensure_ascii=False), utcnow()))

    def _source(self, row) -> dict | None:
        if row is None:
            return None
        result = dict(row)
        result["active"] = bool(result["active"])
        result["extraction"] = json.loads(result.pop("extraction_json") or "{}")
        result["downloaded"] = bool(result["original_path"] and result["downloaded_revision"] == result["remote_revision"])
        return result

    def get_source(self, source_id: str) -> dict | None:
        with self._lock, self._connect() as db:
            return self._source(db.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone())

    def sources(self) -> list[dict]:
        with self._lock, self._connect() as db:
            return [self._source(row) for row in db.execute("SELECT * FROM sources ORDER BY active DESC,file_name,id").fetchall()]

    def validate_question(self, question: dict, source: dict) -> dict:
        if not source["active"] or source["downloaded_revision"] != source["remote_revision"] or source["extracted_revision"] != source["remote_revision"]:
            raise ValueError("根拠となる写真が最新ではありません。再取り込みしてください。")
        region = next((r for r in source["extraction"].get("regions", []) if str(r["id"]) == str(question.get("region_id"))), None)
        if not region or region.get("status") != "ready":
            raise ValueError("鮮明で範囲を確認できた黄色部分が必要です。")
        for key in ("prompt", "explanation", "quote"):
            if not isinstance(question.get(key), str) or not question[key].strip():
                raise ValueError(f"問題の {key} が空です。")
        if len(question["prompt"]) > 500 or len(question["explanation"]) > 1800 or len(question["quote"]) > 600:
            raise ValueError("問題文、解説、引用が長すぎます。")
        choices = question.get("choices")
        if not isinstance(choices, list) or len(choices) != 3:
            raise ValueError("選択肢は必ず3つ必要です。")
        if any(not isinstance(c, dict) or not isinstance(c.get("id"), str) or not c["id"].strip() or not isinstance(c.get("text"), str) or not c["text"].strip() or len(c["text"]) > 300 for c in choices):
            raise ValueError("選択肢のIDと文章が必要です。")
        if len({c["id"] for c in choices}) != 3 or len({normalized(c["text"]) for c in choices}) != 3:
            raise ValueError("重複する選択肢は使用できません。")
        if sum(c["id"] == question.get("correct_choice_id") for c in choices) != 1:
            raise ValueError("正解は3つの選択肢のうち1つにしてください。")
        quote = normalized(question["quote"])
        if len(quote) < 2 or quote not in normalized(region.get("text", "")):
            raise ValueError("引用が黄色部分の抽出テキストと一致しません。")
        return {key: question[key] for key in ("prompt", "choices", "correct_choice_id", "explanation", "region_id", "quote")}

    def save_questions(self, source_id: str, questions: list[dict]):
        source = self.get_source(source_id)
        if source is None:
            raise ValueError("資料が見つかりません。")
        if not isinstance(questions, list) or len(questions) > 30:
            raise ValueError("生成結果の件数が不正です。")
        clean = [self.validate_question(q, source) for q in questions]
        with self._lock, self._connect() as db:
            # Only successful generation completes the revision; rejected questions stay rejected.
            for question in clean:
                qid = uuid.uuid4().hex
                question.update(id=qid, status="pending_review", model="gpt-6-luna")
                db.execute("INSERT INTO questions VALUES(?,?,?,?,?,?,?)", (qid, source_id, source["remote_revision"], str(question["region_id"]), json.dumps(question, ensure_ascii=False), "pending_review", utcnow()))
            db.execute("UPDATE sources SET generated_revision=?,generation_error='',updated_at=? WHERE id=?", (source["remote_revision"], utcnow(), source_id))

    def questions(self, *, source_id: str | None = None, approved_only=True, current_revision_only=False) -> list[dict]:
        query = """SELECT q.*,s.file_name,s.active,s.remote_revision,s.downloaded_revision,s.extracted_revision
            FROM questions q JOIN sources s ON s.id=q.source_id WHERE 1=1"""
        params: list = []
        if source_id:
            query += " AND q.source_id=?"
            params.append(source_id)
        if current_revision_only:
            query += " AND q.source_revision=s.remote_revision"
        if approved_only:
            query += " AND q.status='approved' AND s.active=1 AND q.source_revision=s.remote_revision AND s.downloaded_revision=s.remote_revision AND s.extracted_revision=s.remote_revision"
        query += " ORDER BY q.created_at,q.id"
        with self._lock, self._connect() as db:
            rows = db.execute(query, params).fetchall()
        result = []
        for row in rows:
            question = json.loads(row["question_json"])
            question.update(id=row["id"], status=row["status"], source={"id": row["source_id"], "file_name": row["file_name"]})
            result.append(question)
        return result

    def review_question(self, question_id: str, approved: bool) -> dict:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT * FROM questions WHERE id=?", (question_id,)).fetchone()
            if not row:
                raise KeyError(question_id)
            if row["status"] not in ("pending_review", "approved"):
                raise ValueError("却下済み、または旧版の問題は承認できません。")
            question = json.loads(row["question_json"])
            source = self.get_source(row["source_id"])
            if approved:
                if row["source_revision"] != source["remote_revision"]:
                    raise ValueError("写真が更新されているため承認できません。")
                self.validate_question(question, source)
            status = "approved" if approved else "rejected"
            db.execute("UPDATE questions SET status=? WHERE id=?", (status, question_id))
        question.update(status=status, source={"id": source["id"], "file_name": source["file_name"]})
        return question

    def counts(self) -> dict:
        sources = [s for s in self.sources() if s["active"]]
        pending = sum(q["status"] == "pending_review" for q in self.questions(approved_only=False))
        return {
            "sources": len(sources), "questions": len(self.questions()), "pending_review": pending,
            "needs_review": sum(s["status"] == "needs_review" or any(r.get("status") == "needs_review" for r in s["extraction"].get("regions", [])) for s in sources),
            "errors": sum(s["status"] == "error" or bool(s["generation_error"]) for s in sources),
        }
