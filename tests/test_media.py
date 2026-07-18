import hashlib
import json
from pathlib import Path
import tempfile
import types
import unittest

from helpers import load_module


media_module = load_module("media")


class FakeMedia:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.trashed = []
        self.added = []

    def dir(self):
        return str(self.directory)

    def trash_files(self, names):
        self.trashed.extend(names)
        for name in names:
            (self.directory / name).unlink(missing_ok=True)

    def add_file(self, source):
        source = Path(source)
        (self.directory / source.name).write_bytes(source.read_bytes())
        self.added.append(source.name)


class MediaTest(unittest.TestCase):
    def test_verifies_hashes_and_only_syncs_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            addon = root / "addon"
            target = root / "media"
            addon.mkdir()
            target.mkdir()
            source = addon / "_quizify.js"
            source.write_bytes(b"v1")
            digest = hashlib.sha256(b"v1").hexdigest()
            (addon / "media-manifest.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "files": {
                            "_quizify.js": {"bytes": 2, "sha256": digest}
                        },
                    }
                ),
                encoding="utf-8",
            )
            fake = FakeMedia(target)
            mw = types.SimpleNamespace(col=types.SimpleNamespace(media=fake))
            self.assertEqual(media_module.sync_media(mw, addon), ["_quizify.js"])
            self.assertEqual(media_module.sync_media(mw, addon), [])
            source.write_bytes(b"bad")
            with self.assertRaises(ValueError):
                media_module.sync_media(mw, addon)


if __name__ == "__main__":
    unittest.main()
