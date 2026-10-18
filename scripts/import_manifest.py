"""Import locally materialized Drive originals without exposing a browser upload API.

The manifest is private runtime data, not an authentication credential. This
command never invokes OpenAI and skips a byte-identical, unchanged original.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.store import Store


def main():
    parser = argparse.ArgumentParser(description="Driveから取得した写真とメタデータをローカル保存")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--data-dir", type=Path, default=Path(os.getenv("DATA_DIR", "data")))
    args = parser.parse_args()
    entries = json.loads(args.manifest.read_text(encoding="utf-8"))
    if not isinstance(entries, list) or not entries:
        parser.error("manifest は写真情報の配列にしてください。")
    folder_ids = {p.get("folder_id") for p in entries}
    if len(folder_ids) != 1 or not next(iter(folder_ids)):
        parser.error("すべての写真に同じ folder_id を指定してください。")
    folder_id = next(iter(folder_ids))
    store = Store(args.data_dir)
    imported = skipped = 0
    for entry in entries:
        path = Path(entry["path"]).resolve(strict=True)
        checksum = hashlib.md5(path.read_bytes(), usedforsecurity=False).hexdigest()
        meta = {"id": entry["file_id"], "name": entry["file_name"],
                "mimeType": entry.get("mime_type", "image/jpeg"),
                "modifiedTime": entry["modified_time"], "size": path.stat().st_size,
                "md5Checksum": checksum}
        source = store.upsert_source(meta, folder_id)
        if source["downloaded"] and Path(source["original_path"]).is_file():
            skipped += 1
            continue
        directory = store.data_dir / "originals"
        directory.mkdir(parents=True, exist_ok=True)
        safe_id = hashlib.sha256(meta["id"].encode()).hexdigest()
        target = directory / f"{safe_id}-{checksum}.image"
        temporary = target.with_suffix(".tmp")
        shutil.copyfile(path, temporary)
        temporary.replace(target)
        store.set_downloaded(source["id"], str(target), source["remote_revision"])
        imported += 1
    store.set_setting("folder_id", folder_id)
    store.set_setting("local_import", {"method": "Google Drive connector materialized originals",
                                      "count": len(entries), "manifest": str(args.manifest.resolve())})
    print(json.dumps({"imported": imported, "skipped": skipped, "api_calls": 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
