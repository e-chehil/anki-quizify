"""Build the installable Quizify Markdown .ankiaddon archive."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import stat
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ADDON_ROOT = PROJECT_ROOT / "quizify_addon"
DEFAULT_OUTPUT = ADDON_ROOT / "quizify_markdown.ankiaddon"
ZIP_TIMESTAMP = (2026, 1, 1, 0, 0, 0)
ZIP_CREATE_SYSTEM = 3
ZIP_FILE_MODE = stat.S_IFREG | 0o644
KATEX_FONT_NAME = re.compile(r"_quizify-katex-[A-Za-z0-9_.-]+\.woff2")
PACKAGE_MEMBERS = frozenset(
    {
        "__init__.py",
        "_persistence.js",
        "_quizify.css",
        "_quizify.js",
        "bridge.py",
        "config.json",
        "configuration.py",
        "core.py",
        "importer/__init__.py",
        "importer/dialog.py",
        "importer/media.py",
        "importer/parser.py",
        "importer/service.py",
        "licenses/DOMPurify-Apache-LICENSE.txt",
        "licenses/DOMPurify-MPL-LICENSE.txt",
        "licenses/anki-persistence-LICENSE.txt",
        "licenses/highlight.js-LICENSE.txt",
        "licenses/katex-LICENSE.txt",
        "licenses/marked-LICENSE.txt",
        "manifest.json",
        "media-manifest.json",
        "media.py",
        "notetype.py",
        "package.json",
        "settings.py",
        "templates/back.html",
        "templates/front.html",
        "THIRD_PARTY_LICENSES.md",
        "user_files/README.txt",
        "web/editor-preview.js",
        "web/editor.css",
        "web/editor.js",
        "web/syntax-tools.js",
    }
)


def should_package(relative: Path) -> bool:
    if not relative.parts or relative.is_absolute() or ".." in relative.parts:
        return False
    normalized = relative.as_posix()
    return normalized in PACKAGE_MEMBERS or (
        len(relative.parts) == 1 and KATEX_FONT_NAME.fullmatch(relative.name) is not None
    )


def package_files() -> list[Path]:
    paths = [ADDON_ROOT / Path(member) for member in PACKAGE_MEMBERS]
    fonts = [
        path
        for path in ADDON_ROOT.iterdir()
        if path.is_file()
        and not path.is_symlink()
        and KATEX_FONT_NAME.fullmatch(path.name)
    ]
    if not fonts:
        raise FileNotFoundError("Missing bundled KaTeX WOFF2 fonts")
    paths.extend(fonts)
    missing_or_unsafe = sorted(
        path.relative_to(ADDON_ROOT).as_posix()
        for path in paths
        if not path.is_file() or path.is_symlink()
    )
    if missing_or_unsafe:
        raise FileNotFoundError(
            f"Missing or unsafe add-on files: {', '.join(missing_or_unsafe)}"
        )
    return sorted(paths, key=lambda path: path.relative_to(ADDON_ROOT).as_posix())


def manifest_version() -> str:
    manifest = json.loads((ADDON_ROOT / "manifest.json").read_text(encoding="utf-8"))
    return str(manifest.get("version", "unknown"))


def build(output: Path = DEFAULT_OUTPUT) -> Path:
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f"{output.name}.building")
    temporary.unlink(missing_ok=True)

    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for source in package_files():
                relative = source.relative_to(ADDON_ROOT).as_posix()
                info = ZipInfo(relative, date_time=ZIP_TIMESTAMP)
                info.create_system = ZIP_CREATE_SYSTEM
                info.compress_type = ZIP_DEFLATED
                info.external_attr = ZIP_FILE_MODE << 16
                archive.writestr(info, source.read_bytes(), compresslevel=9)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="output .ankiaddon path",
    )
    args = parser.parse_args()
    output = build(args.output)
    print(f"Built Quizify Markdown {manifest_version()}: {output}")


if __name__ == "__main__":
    main()
