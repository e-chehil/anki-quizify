/* Quizify 0.6 platform adapter retained as migration reference only. */
(function (root, factory) {
  const adapter = factory(root || {});

  if (typeof module === "object" && module.exports) {
    module.exports = adapter;
  }

  if (root) {
    root.QuizifyPlatform = adapter;
    // Kept for cards or add-ons that used the original adapter name.
    root.QuizifyAnkiDroid = adapter;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function (root) {
  const API_VERSION = "1.0.0";
  const ANKIDROID_CONTRACT_VERSION = "0.0.3";
  const DEFAULT_DEVELOPER = "chehil@163.com";
  const TAP_LOCATIONS = new Set([
    "topLeft",
    "topCenter",
    "topRight",
    "midLeft",
    "midCenter",
    "midRight",
    "bottomLeft",
    "bottomCenter",
    "bottomRight"
  ]);

  function readConfig(target = root) {
    const element = target.document?.getElementById?.("quizify-config");
    if (!element?.textContent) return {};

    try {
      return JSON.parse(element.textContent);
    } catch {
      return {};
    }
  }

  function hasDocumentClass(target, name) {
    return Boolean(target.document?.documentElement?.classList?.contains?.(name));
  }

  function isAndroid(target = root) {
    return hasDocumentClass(target, "android");
  }

  function hasWebkitBridge(target) {
    return typeof target.webkit?.messageHandlers?.cb?.postMessage === "function";
  }

  function hasLegacyMobileBridge(target) {
    return Boolean(
      target.anki &&
        (typeof target.sendMessage === "function" ||
          typeof target.sendMessage2 === "function")
    );
  }

  function isAnkiMobile(target = root) {
    return (
      hasDocumentClass(target, "iphone") ||
      hasDocumentClass(target, "ipad") ||
      hasWebkitBridge(target) ||
      hasLegacyMobileBridge(target)
    );
  }

  function detectPlatform(target = root) {
    if (isAndroid(target)) return "ankidroid";
    if (typeof target.pycmd === "function") return "anki-desktop";
    if (isAnkiMobile(target)) return "ankimobile";
    if (typeof target.AnkiDroidJS === "function") return "ankidroid-compatible";
    if (target.study && typeof target.study.drawAnswer === "function") {
      return "ankiweb-legacy";
    }
    return "unknown";
  }

  function isAvailable(target = root) {
    return typeof target.AnkiDroidJS === "function";
  }

  function result(success, value, capability, platform, transport, stable, reason) {
    const response = {
      success: Boolean(success),
      value,
      capability,
      platform,
      transport,
      stable: Boolean(stable)
    };
    if (reason) response.reason = reason;
    return response;
  }

  function failure(capability, platform, reason = "unavailable", value = false) {
    return result(false, value, capability, platform, "none", false, reason);
  }

  function describeError(error) {
    if (!error) return "host_rejected";
    return String(error.message || error);
  }

  async function callCandidate(capability, platform, candidate) {
    try {
      const raw = await Promise.resolve(candidate.call());
      if (raw && typeof raw.success === "boolean") {
        return result(
          raw.success,
          raw.value,
          capability,
          platform,
          candidate.transport,
          candidate.stable,
          raw.success ? "" : "host_rejected"
        );
      }
      return result(
        true,
        raw === undefined ? true : raw,
        capability,
        platform,
        candidate.transport,
        candidate.stable
      );
    } catch (error) {
      return result(
        false,
        false,
        capability,
        platform,
        candidate.transport,
        candidate.stable,
        describeError(error)
      );
    }
  }

  async function runCandidates(capability, platform, candidates, defaultValue = false) {
    let lastFailure = null;
    for (const candidate of candidates) {
      const response = await callCandidate(capability, platform, candidate);
      if (response.success) return response;
      lastFailure = response;
    }
    return (
      lastFailure ||
      failure(capability, platform, "unavailable", defaultValue)
    );
  }

  function nativeCandidate(api, method, args = []) {
    if (!api || typeof api[method] !== "function") return null;
    return {
      transport: "ankidroid-js",
      stable: true,
      call: () => api[method](...args)
    };
  }

  function functionCandidate(target, name, transport, stable, args = []) {
    if (typeof target[name] !== "function") return null;
    return {
      transport,
      stable,
      call: () => target[name](...args)
    };
  }

  function compact(candidates) {
    return candidates.filter(Boolean);
  }

  function createAnkiDroidApi(target, config) {
    if (
      !config.enable_ankidroid_api ||
      typeof target.AnkiDroidJS !== "function"
    ) {
      return null;
    }

    const contract = {
      version: ANKIDROID_CONTRACT_VERSION,
      developer: config.developer_contact || DEFAULT_DEVELOPER
    };

    try {
      return new target.AnkiDroidJS(contract);
    } catch {
      return null;
    }
  }

  function mobileMessageCandidates(target, scheme, message) {
    const payload = JSON.stringify({ scheme, msg: message });
    return compact([
      hasWebkitBridge(target)
        ? {
            transport: "ankimobile-webkit",
            stable: false,
            call: () => target.webkit.messageHandlers.cb.postMessage(payload)
          }
        : null,
      target.anki && typeof target.sendMessage === "function"
        ? {
            transport: "ankimobile-sendMessage",
            stable: false,
            call: () => target.sendMessage(scheme, message)
          }
        : null,
      target.anki && typeof target.sendMessage2 === "function"
        ? {
            transport: "ankimobile-sendMessage2",
            stable: false,
            call: () => target.sendMessage2(scheme, message)
          }
        : null
    ]);
  }

  function createHost(target = root, config = readConfig(target)) {
    const platform = detectPlatform(target);
    const androidApi = createAnkiDroidApi(target, config);
    // Core reviewer globals require no contract. The setting only gates the
    // optional AnkiDroidJS contract, so reveal/rating can still degrade safely.
    const androidLegacyAllowed = isAndroid(target);

    function pycmdCandidate(command) {
      if (typeof target.pycmd !== "function") return null;
      return {
        transport: "anki-desktop-pycmd",
        stable: false,
        call: () => target.pycmd(command)
      };
    }

    function legacyAndroidCandidate(name, args = []) {
      if (!androidLegacyAllowed) return null;
      return functionCandidate(
        target,
        name,
        "ankidroid-legacy",
        false,
        args
      );
    }

    function studyCandidate() {
      if (typeof target.study?.drawAnswer !== "function") return null;
      return {
        transport: "ankiweb-study",
        stable: false,
        call: () => target.study.drawAnswer()
      };
    }

    function sendMessage(scheme, message) {
      if (!String(scheme || "").trim() || !String(message || "").trim()) {
        return Promise.resolve(
          failure("sendMessage", platform, "invalid_argument")
        );
      }
      return runCandidates(
        "sendMessage",
        platform,
        mobileMessageCandidates(target, String(scheme), String(message))
      );
    }

    function sendTap(location) {
      if (!TAP_LOCATIONS.has(location)) {
        return Promise.resolve(
          failure("sendTap", platform, "invalid_tap_location")
        );
      }
      return runCandidates(
        "sendTap",
        platform,
        mobileMessageCandidates(target, "ankitap", location)
      );
    }

    function showAnswer() {
      return runCandidates(
        "showAnswer",
        platform,
        compact([
          nativeCandidate(androidApi, "ankiShowAnswer"),
          legacyAndroidCandidate("showAnswer"),
          pycmdCandidate("ans"),
          ...mobileMessageCandidates(target, "ankitap", "midCenter"),
          studyCandidate()
        ])
      );
    }

    function answerEase(ease) {
      const normalized = Number(ease);
      if (!Number.isInteger(normalized) || normalized < 1 || normalized > 4) {
        return Promise.resolve(
          failure("answerEase", platform, "ease_must_be_1_to_4")
        );
      }

      return runCandidates(
        "answerEase",
        platform,
        compact([
          nativeCandidate(androidApi, `ankiAnswerEase${normalized}`),
          legacyAndroidCandidate(`ankiAnswerEase${normalized}`),
          legacyAndroidCandidate(`buttonAnswerEase${normalized}`),
          pycmdCandidate(`ease${normalized}`)
        ])
      );
    }

    function toggleFlag(color) {
      return runCandidates(
        "toggleFlag",
        platform,
        compact([nativeCandidate(androidApi, "ankiToggleFlag", [color])])
      );
    }

    function showToast(message) {
      return runCandidates(
        "showToast",
        platform,
        compact([nativeCandidate(androidApi, "ankiShowToast", [String(message)])])
      );
    }

    function isDisplayingAnswer() {
      const local = typeof target.isBack === "boolean"
        ? {
            transport: "quizify-template",
            stable: true,
            call: () => target.isBack
          }
        : null;
      return runCandidates(
        "isDisplayingAnswer",
        platform,
        compact([
          nativeCandidate(androidApi, "ankiIsDisplayingAnswer"),
          local
        ])
      );
    }

    function isNightMode() {
      const dom = target.document
        ? {
            transport: "dom",
            stable: true,
            call: () =>
              hasDocumentClass(target, "nightMode") ||
              hasDocumentClass(target, "night-mode") ||
              Boolean(target.matchMedia?.("(prefers-color-scheme: dark)")?.matches)
          }
        : null;
      return runCandidates(
        "isNightMode",
        platform,
        compact([nativeCandidate(androidApi, "ankiIsInNightMode"), dom])
      );
    }

    const capabilities = Object.freeze({
      showAnswer: Boolean(
        androidApi?.ankiShowAnswer ||
          (androidLegacyAllowed && typeof target.showAnswer === "function") ||
          typeof target.pycmd === "function" ||
          mobileMessageCandidates(target, "ankitap", "midCenter").length ||
          typeof target.study?.drawAnswer === "function"
      ),
      answerEase: Boolean(
        [1, 2, 3, 4].some(
          (ease) =>
            typeof androidApi?.[`ankiAnswerEase${ease}`] === "function" ||
            (androidLegacyAllowed &&
              (typeof target[`ankiAnswerEase${ease}`] === "function" ||
                typeof target[`buttonAnswerEase${ease}`] === "function"))
        ) || typeof target.pycmd === "function"
      ),
      toggleFlag: typeof androidApi?.ankiToggleFlag === "function",
      showToast: typeof androidApi?.ankiShowToast === "function",
      isDisplayingAnswer:
        typeof androidApi?.ankiIsDisplayingAnswer === "function" ||
        typeof target.isBack === "boolean",
      isNightMode:
        typeof androidApi?.ankiIsInNightMode === "function" ||
        Boolean(target.document),
      sendMessage: mobileMessageCandidates(target, "probe", "probe").length > 0,
      sendTap: mobileMessageCandidates(target, "ankitap", "midCenter").length > 0
    });

    const transports = [];
    if (androidApi) transports.push("ankidroid-js");
    if (
      androidLegacyAllowed &&
      (typeof target.showAnswer === "function" ||
        [1, 2, 3, 4].some(
          (ease) =>
            typeof target[`ankiAnswerEase${ease}`] === "function" ||
            typeof target[`buttonAnswerEase${ease}`] === "function"
        ))
    ) {
      transports.push("ankidroid-legacy");
    }
    if (typeof target.pycmd === "function") transports.push("anki-desktop-pycmd");
    for (const candidate of mobileMessageCandidates(target, "probe", "probe")) {
      if (!transports.includes(candidate.transport)) transports.push(candidate.transport);
    }
    if (typeof target.study?.drawAnswer === "function") {
      transports.push("ankiweb-study");
    }

    const actionCapabilities = [
      "showAnswer",
      "answerEase",
      "toggleFlag",
      "showToast",
      "sendMessage",
      "sendTap"
    ];
    const available = actionCapabilities.some((name) => capabilities[name]);

    const host = {
      apiVersion: API_VERSION,
      platform,
      available,
      transports: Object.freeze(transports),
      capabilities,
      supports(name) {
        return capabilities[name] === true;
      },
      describe() {
        return {
          apiVersion: API_VERSION,
          platform,
          available,
          transports: transports.slice(),
          capabilities: { ...capabilities }
        };
      },
      showAnswer,
      answerEase,
      toggleFlag,
      showToast,
      isDisplayingAnswer,
      isNightMode,
      sendMessage,
      sendTap
    };

    return Object.freeze(host);
  }

  function createFallback() {
    return createHost({}, { enable_ankidroid_api: false });
  }

  function init(config = readConfig()) {
    return createHost(root, config);
  }

  return {
    API_VERSION,
    ANKIDROID_CONTRACT_VERSION,
    init,
    createHost,
    createFallback,
    readConfig,
    detectPlatform,
    isAndroid,
    isAnkiMobile,
    isAvailable
  };
});
