import unittest

from helpers import load_module


configuration = load_module("configuration")


class ConfigurationTest(unittest.TestCase):
    def test_note_type_name_trims_strings_and_rejects_blank_values(self):
        self.assertEqual(
            configuration.note_type_name({"note_type": "  My Quizify Notes  "}),
            "My Quizify Notes",
        )
        self.assertEqual(
            configuration.note_type_name({"note_type": "  "}),
            configuration.DEFAULT_NOTE_TYPE,
        )
        self.assertEqual(
            configuration.note_type_name({"note_type": 42}),
            configuration.DEFAULT_NOTE_TYPE,
        )

    def test_developer_contact_is_fixed_plugin_identity(self):
        self.assertEqual(configuration.DEVELOPER_CONTACT, "chehil@163.com")

    def test_migrates_flat_v06_config_and_drops_asset_settings(self):
        defaults = {
            "schema_version": 1,
            "note_type": "Quizify Markdown",
            "review": {"cardless": False, "floating_control": True},
            "platform": {"ankidroid_api": True},
        }
        migrated = configuration.normalize_config(
            defaults,
            {
                "note_type": "  My Quizify  ",
                "cardless": True,
                "enable_floating_ball": False,
                "enable_ankidroid_api": False,
                "assets": {"marked_js": {}},
                "developer_contact": "attacker@example.com",
            },
        )
        self.assertEqual(migrated["note_type"], "My Quizify")
        self.assertEqual(
            migrated["review"],
            {"cardless": True, "floating_control": False},
        )
        self.assertEqual(migrated["platform"], {"ankidroid_api": False})
        self.assertNotIn("assets", migrated)
        self.assertNotIn("developer_contact", migrated)

    def test_invalid_values_fall_back_to_defaults(self):
        defaults = {
            "schema_version": 1,
            "note_type": "Quizify Markdown",
            "review": {"cardless": False, "floating_control": True},
            "platform": {"ankidroid_api": True},
        }
        value = configuration.normalize_config(
            defaults,
            {"note_type": " ", "review": {"cardless": "yes"}},
        )
        self.assertEqual(value, defaults)

    def test_config_transaction_commits_only_after_dependencies_succeed(self):
        current = {"note_type": "Old", "review": {"cardless": False}}
        proposed = {"note_type": "Old", "review": {"cardless": True}}
        events = []

        result = configuration.apply_config_transaction(
            current,
            proposed,
            sync_media=lambda: events.append("sync"),
            ensure_notetype=lambda value: (
                events.append(("ensure", value)) or "Old (Quizify)"
            ),
            write_config=lambda value: events.append(("write", value)),
        )

        self.assertEqual(
            events,
            [
                "sync",
                ("ensure", proposed),
                (
                    "write",
                    {
                        "note_type": "Old (Quizify)",
                        "review": {"cardless": True},
                    },
                ),
            ],
        )
        self.assertEqual(result["note_type"], "Old (Quizify)")
        self.assertEqual(current["note_type"], "Old")
        self.assertEqual(proposed["note_type"], "Old")

    def test_config_transaction_does_not_commit_after_sync_failure(self):
        calls = []

        def fail_sync():
            raise RuntimeError("media unavailable")

        with self.assertRaisesRegex(RuntimeError, "media unavailable"):
            configuration.apply_config_transaction(
                {"note_type": "Old"},
                {"note_type": "New"},
                sync_media=fail_sync,
                ensure_notetype=lambda value: calls.append(("ensure", value)),
                write_config=lambda value: calls.append(("write", value)),
            )
        self.assertEqual(calls, [])

    def test_config_transaction_rolls_back_after_notetype_failure(self):
        current = {"note_type": "Old"}
        ensures = []

        def ensure(value):
            ensures.append(value)
            if len(ensures) == 1:
                raise RuntimeError("template failed")
            return value["note_type"]

        with self.assertRaisesRegex(RuntimeError, "template failed"):
            configuration.apply_config_transaction(
                current,
                {"note_type": "New"},
                sync_media=lambda: None,
                ensure_notetype=ensure,
                write_config=lambda value: self.fail("config must not be written"),
            )
        self.assertEqual(ensures, [{"note_type": "New"}, current])

    def test_config_transaction_rolls_back_after_config_write_failure(self):
        current = {"note_type": "Old"}
        ensures = []
        writes = []

        def write(value):
            writes.append(value)
            if len(writes) == 1:
                raise OSError("disk full")

        with self.assertRaisesRegex(OSError, "disk full"):
            configuration.apply_config_transaction(
                current,
                {"note_type": "New"},
                sync_media=lambda: None,
                ensure_notetype=lambda value: (
                    ensures.append(value) or value["note_type"]
                ),
                write_config=write,
            )
        self.assertEqual(ensures, [{"note_type": "New"}, current])
        self.assertEqual(writes, [{"note_type": "New"}, current])


if __name__ == "__main__":
    unittest.main()
