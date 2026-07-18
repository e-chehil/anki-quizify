export function createLifecycle(onError = null) {
  let disposers = [];

  function add(disposer) {
    if (typeof disposer !== "function") return () => {};
    disposers.push(disposer);
    return disposer;
  }

  function listen(target, type, listener, options) {
    if (!target?.addEventListener || !target?.removeEventListener) return () => {};
    target.addEventListener(type, listener, options);
    return add(() => target.removeEventListener(type, listener, options));
  }

  function dispose() {
    const pending = disposers;
    disposers = [];
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      try {
        pending[index]();
      } catch (error) {
        onError?.(error);
      }
    }
  }

  return Object.freeze({
    add,
    listen,
    dispose,
    get size() {
      return disposers.length;
    }
  });
}

const unmanagedLifecycle = Object.freeze({
  add(disposer) {
    return typeof disposer === "function" ? disposer : () => {};
  },
  listen(target, type, listener, options) {
    if (!target?.addEventListener || !target?.removeEventListener) return () => {};
    target.addEventListener(type, listener, options);
    return () => target.removeEventListener(type, listener, options);
  }
});

/**
 * Resolve the lifecycle owned by the active reviewer runtime.
 *
 * Runtime modules are also reused by the isolated editor preview and by unit
 * tests, where no reviewer lifecycle is installed. In those environments the
 * unmanaged adapter preserves the old direct-listener behaviour; in the real
 * reviewer every listener and cleanup is registered with destroyQuizify().
 */
export function resolveRuntimeLifecycle(root, explicit = null) {
  const candidates = [explicit, root?.myquizify?._internal?.runtimeLifecycle];
  return (
    candidates.find(
      (candidate) =>
        candidate &&
        typeof candidate.add === "function" &&
        typeof candidate.listen === "function"
    ) || unmanagedLifecycle
  );
}
