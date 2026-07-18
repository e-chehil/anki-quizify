# Quizify Markdown Refactor Plan

## Historical Shape

The root template is already a Markdown template. It uses `marked` plus custom extensions in `_myquizify.js`, then adds runtime behavior for fill-in-the-blank, single/multiple choice, reveal spans, annotations, tabs, collapses, audio looping, code highlighting, and KaTeX.

The original weakness was that parsing, rendering, state persistence, UI behavior, and Anki integration were mixed in one file. The v1.0.2 refactor below removes that single-file boundary while preserving the public card API.

## External Constraints

- Marked recommends `marked.use()` for extensions, and warns that extensions should be registered once or stored on an independent `Marked` instance when code can run repeatedly.
- Marked custom extensions should expose explicit `name`, `level`, `start`, `tokenizer`, and `renderer` functions. Container tokens should use `this.lexer.blockTokens()` and render child blocks with `this.parser.parse()`.
- Anki add-ons should use `gui_hooks` for integration. Web assets can be exposed with `mw.addonManager.setWebExports()` and injected with `gui_hooks.webview_will_set_content`.
- Anki cards can run JavaScript, but the manual warns that behavior differs by client and must be tested across platforms.
- AnkiDroid exposes an advanced `AnkiDroidJS` API for native reviewer functions. It requires a `jsApiContract` with a version and developer contact. This is useful for reviewer controls and state, not as a replacement for the desktop add-on.

References:

- https://marked.js.org/using_pro
- https://addon-docs.ankiweb.net/hooks-and-filters.html
- https://docs.ankiweb.net/templates/styling.html#javascript
- https://github.com/ankidroid/Anki-Android/wiki/AnkiDroid-Javascript-API

## Target Architecture

```text
quizify_addon/
  __init__.py              Anki note type, media sync, editor hooks
  templates/
    front.html             Thin review shell
    back.html              Thin review shell
  web/
    editor.js              Desktop editor enhancement
    editor.css
  _quizify.js              Mobile-synced review runtime
  _quizify.css             Mobile-synced review styles
```

Implemented source split:

```text
src/
  shared/
    markdown-structure.js   Fence and choice normalization shared by review/editor
    syntax-tools.js         Editor diagnostics and structure preview
  review/
    orchestrator.js         Render lifecycle and public compatibility API
    lifecycle.js            Deterministic global-listener cleanup registry
    markdown/
      parsers.js            Pure Quizify block/inline parsers
      extensions.js         Marked tokenizers and renderers
    runtime/
      persistence.js
      fitb.js
      recite.js
      choices.js
      disclosure.js
      audio.js
      annotations.js
      floating-control.js
  editor/
    anki-adapter.js         Boundary around Anki internal editor modules
    floating-panels.js      Viewport-safe toolbar overlays and keyboard lifecycle
    legacy-editor.js        DOM compatibility implementation
    preview.js
    text-commands.js        CodeMirror 5/6 insertion and selection behavior
```

## Syntax Design Rules

1. Each question type gets a stable token schema before UI details are added.
2. Tokenizers only parse source into tokens. They should not create random IDs or depend on DOM state.
3. Renderers only turn tokens into HTML with `data-quizify-*` attributes.
4. Runtime modules attach behavior after rendering.
5. Answer state keys should be deterministic from card id, side, field name, and token index.
6. Unsafe HTML should either be sanitized or explicitly allowed by rule.
7. Desktop editor support should validate syntax before review-side behavior is expanded.

## First Plugin Milestone

Done in this workspace:

- `quizify_addon` add-on skeleton.
- Automatic `Quizify Markdown` note type creation.
- Media sync for `_quizify.js`, `_quizify.css`, and `_persistence.js`.
- Thin front/back templates with guarded marked extension registration.
- Editor hook injection with a first toolbar for Quizify syntax snippets.
- `_quizify.js` has been rewritten into a clearer browser/CommonJS module boundary:
  - `createQuizifyExtensions()` owns marked tokenizer/renderer definitions.
  - `renderQuizify()` owns field decoding and render-state reset.
  - `initAllQuizFeatures()` delegates to per-feature runtime initializers.
  - answer persistence no longer throws when `Persistence` is absent.
  - generated HTML now escapes user-controlled text and attributes.
- `tests/quizify-smoke.test.js` covers the first tokenizer/renderer smoke checks for fill-in-the-blank, choices, tabs, collapse blocks, annotations, reveal spans, audio blocks, and field HTML decoding.
- `web/syntax-tools.js` provides reusable editor-side Quizify syntax analysis and shared snippets.
- The editor toolbar now shows syntax diagnostics for common Quizify mistakes, including empty fill-in blanks, malformed reveal syntax, invalid choice answers, unclosed collapse blocks, and unclosed tabs.
- The editor toolbar also provides a network-free Quizify structure preview that lists detected fill-in blanks, choices, reveal spans, annotations, collapses, tabs, and audio blocks by field and line.
- `tests/quizify-syntax.test.js` covers the syntax analyzer.
- Templates now receive `config.json` through a `quizify-config` JSON script, following the same broad pattern as the reference add-on.
- The former public `_ankidroid.js` compatibility adapter was retired in 1.0.
  Desktop review messages, the formal AnkiDroidJS contract and Android-scoped
  reviewer-global fallbacks now live in `src/review/platform.js` and are
  covered by source and minified-bundle tests. Private AnkiMobile/AnkiWeb
  fallbacks remain removed.
- The review runtime now registers answer-bearing widgets in DOM order and
  exposes a themed floating control. Clicks reveal fill blanks, choices,
  reveals, annotations, and collapses; completion flips the front, while
  four-way back-side gestures submit ease through `QuizifyPlatform`.
- `tests/floating-control.test.js` covers gesture direction/ease mapping and
  the runtime/style integration contract.
- `settings.py` adds a grouped Anki settings dialog for cardless mode,
  floating review controls, AnkiDroid API enablement, fixed developer
  identity, and offline asset status.
- The review runtime applies the `cardless` setting to rendered containers.
- Before 1.0, review templates could resolve CDN or downloaded assets through
  config placeholders and `assets.py`. That downloader design is historical
  and is no longer part of the release architecture.
- The runtime now prefers an independent `Marked` instance via `new marked.Marked().use(...)`, matching the marked documentation guidance and avoiding repeated global extension registration.
- `tests/marked-integration.test.js` verifies the independent Marked-instance integration boundary with a fake Marked class.
- Version 1.0 bundles all review dependencies and flattens KaTeX WOFF2 fonts
  into underscore-prefixed Anki media names. It removed CDN/downloader
  configuration and its obsolete tests; Python tests now use the single
  `test_*.py` unittest-discovery convention.
- Version 0.3 adds `:::: recite ... ::::` blocks with automatic/manual/mixed masking, `%%...%%` atomic groups, per-review persistence, pointer/keyboard reveal interactions, reshuffling, mask controls, editor diagnostics, and composite floating-control integration.
- Version 0.4 introduces the Knowledge Canvas visual system: semantic Question/Answer shells, unified design tokens, editorial Markdown typography, refreshed states for every interactive question type, responsive mobile rules, reduced-motion support, and a permanent full-component browser preview.
- Version 0.5 extends that system into authoring workflows: a scrollable card-based settings dialog with a fixed action footer and resource states; a branded editor workbench with refined command menus, diagnostics, previews, focus/scroll states, narrow-width validation, and a dedicated workbench preview.
- Version 0.6 hardens the desktop integration boundary: nested config migration, script-safe JSON embedding, constrained offline asset paths and protocols, content-aware media synchronization, and pure-Python tests for paste normalization and upgrade behavior.
- Recite masking now supports continuous reveal gestures: mouse and pen scrubbing starts after a movement threshold, while touch requires a 380ms stationary hold before dragging so normal mobile scrolling remains available. Scrub changes are persisted once at gesture completion.

Still to do:

- Run the release-gate manual matrix in Anki Desktop 25.09.4 and AnkiDroid 2.24.0.
- Add browser screenshot regression automation if a stable Anki WebView harness becomes available.

## Version 1.0 foundation

- `src/` is now the source of truth and esbuild generates the synced review, editor and CSS artifacts.
- Real Marked, DOMPurify and jsdom tests replace the former fake-only integration boundary.
- Marked, highlight.js, KaTeX and WOFF2 fonts are bundled; CDN/downloader configuration was removed.
- A SHA-256 media manifest controls content-aware synchronization.
- Editor preview uses the same parser and sanitizer with a 250ms debounce and Shadow DOM isolation.
- Desktop review actions use namespaced JSON through Anki's WebView message hook; AnkiDroid prefers contract 0.0.3 and safely degrades to Android-only reviewer globals.
- Managed note templates now carry an ownership marker. Unknown same-name note types are preserved and receive a uniquely named Quizify sibling instead of being overwritten.
- Review state, Markdown parsing/extensions, individual question runtimes and the floating controller are separate modules behind `orchestrator.js`.
- Annotation listeners use a deterministic lifecycle registry and are released on every boot/destroy cycle.
- Python tests use one discoverable naming convention, guarded by `tools/check_test_layout.py`.
