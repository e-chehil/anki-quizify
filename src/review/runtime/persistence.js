const KEYS = Object.freeze({
  answers: "quizify:v1:answers",
  reveal: "quizify:v1:reveal-progress",
  recite: "quizify:v1:recite-state",
  floatingPosition: "quizify:v1:floating-position"
});

export function createReviewStorage(target = globalThis) {
  function persistence() {
    const store = target.Persistence;
    return store && typeof store.isAvailable === "function" && store.isAvailable()
      ? store
      : null;
  }

  function defaultAnswers() {
    return { fitbs: {}, mcqs: {} };
  }

  function saveUserAnswers(value) {
    persistence()?.setItem(KEYS.answers, value);
  }

  function loadUserAnswers() {
    return persistence()?.getItem(KEYS.answers) || defaultAnswers();
  }

  function clearUserAnswers() {
    persistence()?.removeItem(KEYS.answers);
  }

  function loadRevealProgress() {
    const saved = persistence()?.getItem(KEYS.reveal);
    return saved && Array.isArray(saved.revealed)
      ? saved
      : { revealed: [], completed: false };
  }

  function saveRevealProgress(value) {
    persistence()?.setItem(KEYS.reveal, value);
  }

  function clearRevealProgress() {
    persistence()?.removeItem(KEYS.reveal);
  }

  function loadReciteState() {
    const saved = persistence()?.getItem(KEYS.recite);
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  }

  function saveReciteState(value) {
    persistence()?.setItem(KEYS.recite, value);
  }

  function clearReciteState() {
    persistence()?.removeItem(KEYS.recite);
  }

  function loadFloatingPosition() {
    try {
      const saved = JSON.parse(target.localStorage?.getItem(KEYS.floatingPosition));
      if (
        Number.isFinite(saved?.x) &&
        Number.isFinite(saved?.y) &&
        saved.x >= 0 &&
        saved.x <= 1 &&
        saved.y >= 0 &&
        saved.y <= 1
      ) {
        return saved;
      }
    } catch {
      // Storage is optional in previewers and restricted WebViews.
    }
    return null;
  }

  function saveFloatingPosition(position) {
    try {
      target.localStorage?.setItem(KEYS.floatingPosition, JSON.stringify(position));
    } catch {
      // Keep the current in-memory position when persistent storage is blocked.
    }
  }

  return Object.freeze({
    clearReciteState,
    clearRevealProgress,
    clearUserAnswers,
    loadFloatingPosition,
    loadReciteState,
    loadRevealProgress,
    loadUserAnswers,
    saveFloatingPosition,
    saveReciteState,
    saveRevealProgress,
    saveUserAnswers
  });
}
