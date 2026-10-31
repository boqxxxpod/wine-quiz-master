"""Build the public Pages artifact from an explicit source-file allowlist."""
from __future__ import annotations

import hashlib
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_QUESTION_PACK = "question-packs/wine-quiz-highlighted.json"
PUBLIC_PRACTICE_PACK = "question-packs/wine-quiz-practice-20261031.json"
PUBLIC_QUESTION_PACKS = (PUBLIC_QUESTION_PACK, PUBLIC_PRACTICE_PACK)
PUBLIC_PRACTICE_ASSETS = tuple(f"question-packs/practice-assets/{name}" for name in (
    "fr-002.png", "it-007-2.png", "es-021.png",
    "it-023.jpg", "it-024.jpg", "it-025.jpg", "it-026.jpg",
))
PUBLIC_FILES = (
    "static/index.html", "static/app.js", "static/quiz.js",
    "static/pages.js", "static/style.css", *PUBLIC_QUESTION_PACKS, *PUBLIC_PRACTICE_ASSETS,
)
MARKER = ".wine-pages-artifact"
SOURCE_ASSET_VERSION = "verbatim-20261031"


def build(source_root: Path = ROOT, output: Path | None = None) -> Path:
    source_root = source_root.resolve()
    output = (output or source_root / "dist-pages").resolve()
    if output == source_root or output in source_root.parents:
        raise ValueError("公開成果物の保存先をソースのルートや親に指定できません。")
    if output.exists() and not (output / MARKER).is_file():
        raise ValueError("既存の別用途ディレクトリは上書きしません。")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".pages-build-", dir=output.parent))
    try:
        digest = hashlib.sha256()
        for name in PUBLIC_FILES:
            source = source_root / name
            if any(path.is_symlink() for path in (source, *source.parents) if path.is_relative_to(source_root)) or not source.resolve().is_relative_to(source_root) or not source.is_file():
                raise ValueError(f"公開用ソースが見つかりません: {name}")
            relative = "index.html" if name == "static/index.html" else name
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            digest.update(name.encode("utf-8"))
            digest.update(source.read_bytes())
        # HTML, imported modules, and JSON share a version derived from public bytes.
        version = digest.hexdigest()[:16]
        for name in ("index.html", "static/app.js", "static/pages.js"):
            asset = temporary / name
            asset.write_text(
                asset.read_text(encoding="utf-8").replace(
                    f"v={SOURCE_ASSET_VERSION}", f"v={version}"
                ), encoding="utf-8"
            )
        (temporary / "static/runtime.js").write_text("export const mode = 'pages';\n", encoding="utf-8")
        (temporary / ".nojekyll").touch()
        (temporary / MARKER).write_text("Generated public frontend and bundled question pack; no private data.\n", encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        temporary.replace(output)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return output


if __name__ == "__main__":
    result = build()
    print(f"Pages artifact ready: {result} (bundled questions included; private data excluded)")
