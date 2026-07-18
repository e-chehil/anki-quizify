export function loadAnkiEditorAdapter(target = globalThis) {
  const requireModule =
    typeof target.require === "function"
      ? target.require.bind(target)
      : typeof require !== "undefined"
        ? require
        : null;
  if (!requireModule) return null;

  try {
    const { loaded } = requireModule("anki/ui");
    const { instances: noteEditors } = requireModule("anki/NoteEditor");
    const {
      lifecycle: plainTextLifecycle,
      instances: plainTextInputs
    } = requireModule("anki/PlainTextInput");
    return Object.freeze({
      loaded,
      noteEditors,
      plainTextInputs,
      plainTextLifecycle
    });
  } catch (error) {
    target.console?.warn?.("Quizify editor API is unavailable", error);
    return null;
  }
}
