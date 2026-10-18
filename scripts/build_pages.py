"""Build the public Pages artifact from an explicit source-file allowlist."""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = (
    "static/index.html", "static/app.js", "static/quiz.js",
    "static/pages.js", "static/style.css",
)
MARKER = ".wine-pages-artifact"


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
        for name in PUBLIC_FILES:
            source = source_root / name
            if source.is_symlink() or source.parent.is_symlink() or not source.resolve().is_relative_to(source_root) or not source.is_file():
                raise ValueError(f"公開用ソースが見つかりません: {name}")
            relative = "index.html" if name == "static/index.html" else name
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (temporary / "static/runtime.js").write_text("export const mode = 'pages';\n", encoding="utf-8")
        (temporary / ".nojekyll").touch()
        (temporary / MARKER).write_text("Generated public frontend only; no private data.\n", encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        temporary.replace(output)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return output


if __name__ == "__main__":
    result = build()
    print(f"Pages artifact ready: {result} (private data excluded)")
