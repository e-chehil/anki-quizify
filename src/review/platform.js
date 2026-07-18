const CONTRACT_VERSION = "0.0.3";
const DEVELOPER = "chehil@163.com";
const API_VERSION = "1.0.0";
const DESKTOP_TIMEOUT_MS = 800;
const DESKTOP_CAPABILITIES = Object.freeze(["showAnswer", "answerEase"]);
const ANDROID_LEGACY_TRANSPORT = "ankidroid-legacy";

function response(success, value, capability, transport, reason = "") {
  return Object.freeze({
    success: Boolean(success),
    value,
    capability,
    transport,
    stable: transport === "ankidroid-js",
    reason
  });
}

function unavailable(capability, reason = "unavailable") {
  return Promise.resolve(response(false, false, capability, "none", reason));
}

function hasDocumentClass(target, name) {
  return Boolean(
    target.document?.documentElement?.classList?.contains?.(name) ||
      target.document?.body?.classList?.contains?.(name)
  );
}

function isAndroidReviewer(target) {
  return hasDocumentClass(target, "android");
}

function resolveAndroidConstructor(target) {
  // AnkiDroid loads its API as a classic script containing a top-level
  // `class AnkiDroidJS`. That creates a global lexical binding, not a
  // `window.AnkiDroidJS` property, so the bare identifier must be checked.
  if (typeof AnkiDroidJS === "function") return AnkiDroidJS;
  return typeof target.AnkiDroidJS === "function" ? target.AnkiDroidJS : null;
}

function createAndroidApi(config, AndroidConstructor) {
  if (config.platform?.ankidroid_api === false) return null;
  if (typeof AndroidConstructor !== "function") return null;
  try {
    return new AndroidConstructor({ version: CONTRACT_VERSION, developer: DEVELOPER });
  } catch {
    return null;
  }
}

async function callAndroid(api, method, capability) {
  if (!api || typeof api[method] !== "function") return unavailable(capability);
  try {
    const result = await api[method]();
    if (
      !result ||
      typeof result !== "object" ||
      typeof result.success !== "boolean"
    ) {
      return response(
        false,
        false,
        capability,
        "ankidroid-js",
        "invalid_response"
      );
    }
    return response(
      result.success,
      result.value,
      capability,
      "ankidroid-js",
      result.reason
    );
  } catch (error) {
    return response(false, false, capability, "ankidroid-js", error?.message || "failed");
  }
}

async function callAndroidLegacy(target, method, capability) {
  if (typeof target[method] !== "function") return unavailable(capability);
  try {
    const result = await target[method]();
    if (result && typeof result === "object" && "success" in result) {
      if (typeof result.success !== "boolean") {
        return response(
          false,
          false,
          capability,
          ANDROID_LEGACY_TRANSPORT,
          "invalid_response"
        );
      }
      return response(
        result.success,
        result.value,
        capability,
        ANDROID_LEGACY_TRANSPORT,
        result.reason
      );
    }
    return response(
      true,
      result ?? true,
      capability,
      ANDROID_LEGACY_TRANSPORT
    );
  } catch (error) {
    return response(
      false,
      false,
      capability,
      ANDROID_LEGACY_TRANSPORT,
      error?.message || "failed"
    );
  }
}

function callDesktop(target, payload, capability) {
  if (typeof target.pycmd !== "function") return unavailable(capability);
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const cancelTimeout = () => {
      if (timeoutId === null) return;
      if (typeof target.clearTimeout === "function") {
        target.clearTimeout(timeoutId);
      } else {
        globalThis.clearTimeout?.(timeoutId);
      }
      timeoutId = null;
    };
    const settle = (result) => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      resolve(result);
    };
    const finish = (raw) => {
      if (settled) return;
      let value;
      try {
        value = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        settle(response(false, false, capability, "anki-desktop-addon", "invalid_response"));
        return;
      }
      if (!value || typeof value !== "object" || Array.isArray(value) || value.ok !== true) {
        const reason =
          value && typeof value === "object" && typeof value.code === "string" && value.code
            ? value.code
            : "invalid_response";
        settle(response(false, false, capability, "anki-desktop-addon", reason));
        return;
      }
      settle(
        response(
          true,
          value.value ?? true,
          capability,
          "anki-desktop-addon",
          typeof value.code === "string" ? value.code : ""
        )
      );
    };
    try {
      const schedule = target.setTimeout || globalThis.setTimeout;
      if (typeof schedule !== "function") {
        settle(response(false, false, capability, "anki-desktop-addon", "timeout_unavailable"));
        return;
      }
      timeoutId = schedule.call(
        target,
        () =>
          settle(
            response(false, false, capability, "anki-desktop-addon", "bridge_timeout")
          ),
        DESKTOP_TIMEOUT_MS
      );
      target.pycmd(JSON.stringify(payload), finish);
    } catch (error) {
      settle(
        response(
          false,
          false,
          capability,
          "anki-desktop-addon",
          error?.message || "failed"
        )
      );
    }
  });
}

export function createPlatform(config = {}, target = globalThis) {
  const AndroidConstructor = resolveAndroidConstructor(target);
  const androidReviewer = isAndroidReviewer(target);
  const desktopBridgeAvailable = typeof target.pycmd === "function";
  // The document class is authoritative. A constructor-like global injected
  // into Desktop must not shadow the add-on's verified pycmd transport.
  const android =
    androidReviewer || (Boolean(AndroidConstructor) && !desktopBridgeAvailable);
  // Likewise, an unrelated pycmd global must never run a Desktop handshake
  // from inside an Android reviewer.
  const desktop = desktopBridgeAvailable && !android;
  const androidApi = android
    ? createAndroidApi(config, AndroidConstructor)
    : null;
  const platform = android ? "ankidroid" : desktop ? "anki-desktop" : "browser";
  const desktopState = {
    capabilities: new Set(),
    reason: desktop ? "bridge_not_ready" : "unavailable",
    status: desktop ? "pending" : "unavailable"
  };

  const desktopReady = desktop
    ? callDesktop(
        target,
        { type: "quizify:v1", action: "describe" },
        "describe"
      ).then((result) => {
        if (!result.success) {
          desktopState.reason = result.reason || "bridge_unavailable";
          desktopState.status = "failed";
          return;
        }

        const value = result.value;
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          value.apiVersion !== API_VERSION ||
          !Array.isArray(value.capabilities) ||
          !value.capabilities.every((name) => typeof name === "string")
        ) {
          desktopState.reason = "invalid_describe_response";
          desktopState.status = "failed";
          return;
        }

        desktopState.capabilities = new Set(
          value.capabilities.filter((name) => DESKTOP_CAPABILITIES.includes(name))
        );
        desktopState.reason = "";
        desktopState.status = "ready";
      })
    : Promise.resolve();

  function legacyAndroidMethod(capability, ease = null) {
    if (!androidReviewer) return null;
    if (capability === "showAnswer") {
      return typeof target.showAnswer === "function" ? "showAnswer" : null;
    }
    if (capability !== "answerEase") return null;
    const documented = `buttonAnswerEase${ease}`;
    if (typeof target[documented] === "function") return documented;
    const historical = `ankiAnswerEase${ease}`;
    return typeof target[historical] === "function" ? historical : null;
  }

  function supportsAndroidAction(capability, ease = null) {
    if (!android) return false;
    if (capability === "showAnswer") {
      return (
        typeof androidApi?.ankiShowAnswer === "function" ||
        Boolean(legacyAndroidMethod(capability))
      );
    }
    return (
      typeof androidApi?.[`ankiAnswerEase${ease}`] === "function" ||
      Boolean(legacyAndroidMethod(capability, ease))
    );
  }

  function supportsAndroid(name) {
    if (name === "showAnswer") return supportsAndroidAction(name);
    if (name === "answerEase") {
      return [1, 2, 3, 4].every((ease) =>
        supportsAndroidAction(name, ease)
      );
    }
    return false;
  }

  function supportsCapability(name) {
    if (android) return supportsAndroid(name);
    return desktopState.status === "ready" && desktopState.capabilities.has(name);
  }

  function callAndroidAction(capability, formalMethod, legacyMethod) {
    if (typeof androidApi?.[formalMethod] === "function") {
      return callAndroid(androidApi, formalMethod, capability);
    }
    if (legacyMethod) {
      return callAndroidLegacy(target, legacyMethod, capability);
    }
    return unavailable(capability, "unsupported_capability");
  }

  async function callVerifiedDesktop(payload, capability) {
    await desktopReady;
    if (!supportsCapability(capability)) {
      return response(
        false,
        false,
        capability,
        desktop ? "anki-desktop-addon" : "none",
        desktopState.reason || "unsupported_capability"
      );
    }
    return callDesktop(target, payload, capability);
  }

  const host = {
    apiVersion: API_VERSION,
    platform,
    supports(name) {
      return DESKTOP_CAPABILITIES.includes(name) && supportsCapability(name);
    },
    describe() {
      const transports = [];
      if (androidApi) transports.push("ankidroid-js");
      if (
        androidReviewer &&
        (legacyAndroidMethod("showAnswer") ||
          [1, 2, 3, 4].some((ease) =>
            legacyAndroidMethod("answerEase", ease)
          ))
      ) {
        transports.push(ANDROID_LEGACY_TRANSPORT);
      }
      if (!android && desktop) transports.push("anki-desktop-addon");
      return {
        apiVersion: API_VERSION,
        platform,
        transports,
        bridgeStatus: android
          ? transports.length
            ? "ready"
            : "unavailable"
          : desktopState.status,
        capabilities: {
          showAnswer: supportsCapability("showAnswer"),
          answerEase: supportsCapability("answerEase")
        }
      };
    },
    ready() {
      return desktopReady.then(() => host.describe());
    },
    showAnswer() {
      return android
        ? callAndroidAction(
            "showAnswer",
            "ankiShowAnswer",
            legacyAndroidMethod("showAnswer")
          )
        : callVerifiedDesktop(
            { type: "quizify:v1", action: "showAnswer" },
            "showAnswer"
          );
    },
    answerEase(ease) {
      const value = Number(ease);
      if (!Number.isInteger(value) || value < 1 || value > 4) {
        return unavailable("answerEase", "ease_must_be_1_to_4");
      }
      return android
        ? callAndroidAction(
            "answerEase",
            `ankiAnswerEase${value}`,
            legacyAndroidMethod("answerEase", value)
          )
        : callVerifiedDesktop(
            { type: "quizify:v1", action: "answerEase", ease: value },
            "answerEase"
          );
    }
  };
  return Object.freeze(host);
}
