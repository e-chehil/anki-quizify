# Quizify 1.0 review platform API

Quizify exposes the active review host as `window.Quizify.platform` after
`Quizify.boot()` has completed. The old public `quizifyAnkiDroid` /
`_ankidroid.js` adapter, AnkiMobile tap simulation and AnkiWeb fallback
interfaces were removed in 1.0. Android's reviewer globals are retained only
as an internal, Android-scoped compatibility transport.

## Public diagnostics

```js
await window.Quizify.platform.ready();
const info = window.Quizify.platform.describe();
```

`describe()` returns the API version, detected platform, active transports and
the `showAnswer`/`answerEase` capability map. Desktop capabilities remain false
until `ready()` completes the add-on handshake. Call `supports(name)` before
using an optional operation; the operations themselves also re-check the
negotiated capability and fail closed.

Both actions resolve to:

```js
{
  success: true,
  value: true,
  capability: "showAnswer",
  transport: "ankidroid-js",
  stable: true,
  reason: ""
}
```

## Desktop transport

The browser bundle sends JSON through Anki's `pycmd()` bridge:

```json
{"type":"quizify:v1","action":"describe"}
{"type":"quizify:v1","action":"showAnswer"}
{"type":"quizify:v1","action":"answerEase","ease":3}
```

`describe` must return API `1.0.0` and an allow-listed capability array before
the control is enabled. Action messages are then accepted only from the current
Reviewer context with an active card; showing the answer requires question
state and grading requires answer state. Actions and ease values are
allow-listed, malformed/null/timeout responses are failures. The public
`webview_did_receive_js_message` hook is used as the integration boundary;
calls into the current Reviewer are kept in `bridge.py` so version-specific
changes remain isolated.

## AnkiDroid transport

Quizify first resolves AnkiDroid's classic-script lexical `AnkiDroidJS`
binding, then the window property used by some older or test environments. It
initializes contract 0.0.3 with the fixed Quizify developer identity and calls
only the instance methods `ankiShowAnswer()` and `ankiAnswerEase1..4()`.

If the constructor is unavailable, initialization fails, a method is absent,
or `platform.ankidroid_api` is disabled, Quizify may fall back only when the
document is explicitly marked with AnkiDroid's `android` class. The fallback
uses the documented `showAnswer()` and `buttonAnswerEase1..4()` reviewer
globals, plus the historical `ankiAnswerEase1..4()` globals for older clients.
This compatibility transport is reported as `ankidroid-legacy` and is not
treated as stable. Once a formal API method has been invoked, a rejected or
malformed result is returned as a failure instead of retrying a legacy rating
action, preventing duplicate submissions across cards.

The `platform.ankidroid_api` setting gates only contract initialization. It
does not disable Android-scoped reviewer fallbacks, so migrated configurations
remain usable on clients that provide only the older functions.

## Unsupported clients

AnkiMobile and AnkiWeb can render the synchronized template assets, including
Markdown, KaTeX and Quizify widgets, and can use the floating control for local
progressive reveal. They do not receive semantic show-answer or grading
capabilities, so the control asks the user to use client buttons instead of
simulating private tap locations.

## References

- [Anki add-on WebView hooks](https://addon-docs.ankiweb.net/hooks-and-filters.html)
- [AnkiDroid JavaScript API](https://github.com/ankidroid/Anki-Android/wiki/AnkiDroid-Javascript-API)
