from __future__ import annotations

import json


MESSAGE_TYPE = "quizify:v1"
API_VERSION = "1.0.0"
CAPABILITIES = ["showAnswer", "answerEase"]


def _result(ok: bool, code: str = "", value=True) -> str:
    return json.dumps(
        {"ok": bool(ok), "code": code, "value": value},
        ensure_ascii=False,
        separators=(",", ":"),
    )


def parse_message(message: str) -> dict | None:
    try:
        payload = json.loads(message)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("type") != MESSAGE_TYPE:
        return None
    return payload


def handle_reviewer_message(handled, message: str, context, mw):
    payload = parse_message(message)
    if payload is None:
        return handled

    action = payload.get("action")
    if action == "describe":
        return (
            True,
            _result(
                True,
                value={
                    "apiVersion": API_VERSION,
                    "capabilities": list(CAPABILITIES),
                },
            ),
        )

    try:
        from aqt.reviewer import Reviewer
    except ImportError:
        Reviewer = ()  # type: ignore

    if not isinstance(context, Reviewer) or getattr(mw, "state", None) != "review":
        return (True, _result(False, "not_in_reviewer", False))
    reviewer = getattr(mw, "reviewer", None)
    if reviewer is None or getattr(reviewer, "card", None) is None:
        return (True, _result(False, "no_active_card", False))
    if context is not reviewer:
        return (True, _result(False, "stale_reviewer_context", False))

    try:
        if action == "showAnswer":
            if getattr(reviewer, "state", None) != "question":
                return (
                    True,
                    _result(False, "show_answer_requires_question", False),
                )
            reviewer._showAnswer()
        elif action == "answerEase":
            ease = payload.get("ease")
            valid_ease = (
                isinstance(ease, int)
                and not isinstance(ease, bool)
                and 1 <= ease <= 4
            )
            if not valid_ease:
                return (True, _result(False, "invalid_ease", False))
            if getattr(reviewer, "state", None) != "answer":
                return (
                    True,
                    _result(False, "answer_ease_requires_answer", False),
                )
            reviewer._answerCard(ease)
        else:
            return (True, _result(False, "unsupported_action", False))
    except Exception as exc:
        return (True, _result(False, f"reviewer_error:{type(exc).__name__}", False))
    return (True, _result(True))
