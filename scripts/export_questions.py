"""Export only current, approved practice questions for local browser import."""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.store import Store


def export_questions(data_dir: Path, output: Path) -> int:
    data_dir = data_dir.resolve()
    output = output.resolve()
    repository = Path(__file__).resolve().parents[1]
    export_directory = data_dir / "exports"
    if (output.suffix != ".json" or not output.is_relative_to(export_directory)
            or (output.is_relative_to(repository) and not output.is_relative_to(repository / "data"))):
        raise ValueError("問題ファイルは Git 管理外の DATA_DIR/exports/ 内に .json 形式で保存してください。")
    if output.exists():
        try:
            previous = json.loads(output.read_text(encoding="utf-8"))
            if not isinstance(previous, dict) or previous.get("version") != 1 or not isinstance(previous.get("questions"), list):
                raise ValueError("別用途のファイルは上書きできません。")
        except (OSError, UnicodeError, json.JSONDecodeError):
            raise ValueError("別用途のファイルは上書きできません。") from None
    store = Store(data_dir)
    questions = []
    for row in store.questions():
        source = store.get_source(row["source"]["id"])
        # Validate again at export; never export rejected or obsolete evidence.
        question = store.validate_question(row, source)
        questions.append({**question, "id": row["id"],
                          "source_id": row["source"]["id"], "file_name": row["source"]["file_name"]})
    payload = {"version": 1, "questions": questions}
    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    if len(questions) > 2000 or len(serialized.encode("utf-8")) > 2_000_000:
        raise ValueError("Pagesの読み込み上限（2,000問・2MB）を超えています。問題を分割してください。")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                     prefix=".questions-", suffix=".tmp", delete=False) as handle:
        handle.write(serialized)
        temporary = Path(handle.name)
    try:
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return len(questions)


def main():
    parser = argparse.ArgumentParser(description="承認済み問題をブラウザ読み込み用にエクスポート")
    parser.add_argument("--data-dir", type=Path, default=Path(os.getenv("DATA_DIR", "data")))
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    count = export_questions(args.data_dir, args.output or args.data_dir / "exports/questions.json")
    print(f"{count}問を保存しました。ファイルをGitへ追加せず、Pagesの画面で読み込んでください。")


if __name__ == "__main__":
    main()
