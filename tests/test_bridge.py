import json
import sys
import types
import unittest

from helpers import load_module


bridge = load_module("bridge")


class Reviewer:
    pass


aqt = types.ModuleType("aqt")
reviewer_module = types.ModuleType("aqt.reviewer")
reviewer_module.Reviewer = Reviewer
sys.modules["aqt"] = aqt
sys.modules["aqt.reviewer"] = reviewer_module


class FakeReviewer(Reviewer):
    def __init__(self):
        self.card = object()
        self.actions = []
        self.state = "question"

    def _showAnswer(self):
        self.actions.append(("show",))
        self.state = "answer"

    def _answerCard(self, ease):
        self.actions.append(("answer", ease))
        self.state = "question"


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.reviewer = FakeReviewer()
        self.context = self.reviewer
        self.mw = types.SimpleNamespace(state="review", reviewer=self.reviewer)

    def send(self, payload):
        handled, raw = bridge.handle_reviewer_message(
            (False, None), json.dumps(payload), self.context, self.mw
        )
        self.assertTrue(handled)
        return json.loads(raw)

    def test_show_and_answer_actions(self):
        self.assertTrue(self.send({"type": "quizify:v1", "action": "showAnswer"})["ok"])
        self.assertTrue(
            self.send({"type": "quizify:v1", "action": "answerEase", "ease": 3})["ok"]
        )
        self.assertEqual(self.reviewer.actions, [("show",), ("answer", 3)])

    def test_describe_is_available_without_reviewer_context(self):
        handled, raw = bridge.handle_reviewer_message(
            (False, None),
            json.dumps({"type": "quizify:v1", "action": "describe"}),
            object(),
            types.SimpleNamespace(state="deckBrowser", reviewer=None),
        )

        self.assertTrue(handled)
        self.assertEqual(
            json.loads(raw),
            {
                "ok": True,
                "code": "",
                "value": {
                    "apiVersion": "1.0.0",
                    "capabilities": ["showAnswer", "answerEase"],
                },
            },
        )

    def test_rejects_invalid_or_foreign_messages(self):
        result = self.send({"type": "quizify:v1", "action": "answerEase", "ease": 5})
        self.assertEqual(result["code"], "invalid_ease")
        original = (False, "unchanged")
        self.assertIs(
            bridge.handle_reviewer_message(original, "not-json", self.context, self.mw),
            original,
        )

    def test_rejects_actions_in_the_wrong_reviewer_state(self):
        result = self.send({"type": "quizify:v1", "action": "answerEase", "ease": 2})
        self.assertEqual(result["code"], "answer_ease_requires_answer")
        self.assertEqual(self.reviewer.actions, [])

        self.reviewer.state = "answer"
        result = self.send({"type": "quizify:v1", "action": "showAnswer"})
        self.assertEqual(result["code"], "show_answer_requires_question")
        self.assertEqual(self.reviewer.actions, [])

    def test_rejects_a_stale_reviewer_context(self):
        self.context = FakeReviewer()
        result = self.send({"type": "quizify:v1", "action": "showAnswer"})
        self.assertEqual(result["code"], "stale_reviewer_context")
        self.assertEqual(self.reviewer.actions, [])

    def test_unknown_action_fails_closed(self):
        result = self.send({"type": "quizify:v1", "action": "deleteEverything"})
        self.assertEqual(result["code"], "unsupported_action")
        self.assertFalse(result["ok"])
        self.assertEqual(self.reviewer.actions, [])


if __name__ == "__main__":
    unittest.main()
