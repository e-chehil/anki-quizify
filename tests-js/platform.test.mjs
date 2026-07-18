import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { createPlatform } from "../src/review/platform.js";

const PLATFORM_SOURCE = readFileSync(
  new URL("../src/review/platform.js", import.meta.url),
  "utf8"
);

function androidDocument(isAndroid = true) {
  return {
    documentElement: {
      classList: {
        contains(name) {
          return isAndroid && name === "android";
        }
      }
    }
  };
}

function loadPlatformAsClassicScript(context) {
  const script = PLATFORM_SOURCE.replace(
    "export function createPlatform",
    "globalThis.createPlatform = function createPlatform"
  );
  assert.notEqual(script, PLATFORM_SOURCE, "platform export must be transformed");
  vm.runInContext(script, context, { filename: "src/review/platform.js" });
}

test("desktop bridge sends namespaced JSON and validates ease", async () => {
  const messages = [];
  const target = {
    setTimeout,
    pycmd(message, callback) {
      const payload = JSON.parse(message);
      messages.push(payload);
      callback(
        payload.action === "describe"
          ? '{"ok":true,"value":{"apiVersion":"1.0.0","capabilities":["showAnswer","answerEase"]}}'
          : '{"ok":true,"value":true}'
      );
    }
  };
  const platform = createPlatform({}, target);
  assert.equal(platform.describe().platform, "anki-desktop");
  assert.equal(platform.supports("showAnswer"), false);
  await platform.ready();
  assert.equal(platform.supports("showAnswer"), true);
  assert.equal((await platform.showAnswer()).success, true);
  assert.equal((await platform.answerEase(3)).success, true);
  assert.deepEqual(messages, [
    { type: "quizify:v1", action: "describe" },
    { type: "quizify:v1", action: "showAnswer" },
    { type: "quizify:v1", action: "answerEase", ease: 3 }
  ]);
  assert.equal((await platform.answerEase(0)).reason, "ease_must_be_1_to_4");
});

test("desktop bridge rejects null, malformed and negative protocol responses", async () => {
  for (const [raw, reason] of [
    [null, "invalid_response"],
    ["not-json", "invalid_response"],
    ['{"value":true}', "invalid_response"],
    ['{"ok":false,"code":"no_active_card","value":false}', "no_active_card"]
  ]) {
    const platform = createPlatform({}, {
      setTimeout,
      clearTimeout,
      pycmd(_message, callback) {
        callback(raw);
      }
    });
    const result = await platform.showAnswer();
    assert.equal(result.success, false, String(raw));
    assert.equal(result.reason, reason, String(raw));
  }
});

test("desktop bridge validates every action response after a valid handshake", async () => {
  for (const [raw, reason] of [
    [null, "invalid_response"],
    ["not-json", "invalid_response"],
    ['{"ok":false,"code":"wrong_state","value":false}', "wrong_state"]
  ]) {
    const platform = createPlatform({}, {
      setTimeout,
      clearTimeout,
      pycmd(message, callback) {
        const payload = JSON.parse(message);
        callback(
          payload.action === "describe"
            ? '{"ok":true,"value":{"apiVersion":"1.0.0","capabilities":["showAnswer","answerEase"]}}'
            : raw
        );
      }
    });
    await platform.ready();
    const result = await platform.showAnswer();
    assert.equal(result.success, false, String(raw));
    assert.equal(result.reason, reason, String(raw));
  }
});

test("desktop bridge requires a valid describe capability handshake", async () => {
  for (const value of [
    true,
    { apiVersion: "0.9.0", capabilities: ["showAnswer"] },
    { apiVersion: "1.0.0", capabilities: "showAnswer" },
    { apiVersion: "1.0.0", capabilities: ["answerEase"] }
  ]) {
    const messages = [];
    const platform = createPlatform({}, {
      setTimeout,
      clearTimeout,
      pycmd(message, callback) {
        messages.push(JSON.parse(message));
        callback(JSON.stringify({ ok: true, value }));
      }
    });
    await platform.ready();
    assert.equal(platform.supports("showAnswer"), false);
    const result = await platform.showAnswer();
    assert.equal(result.success, false);
    assert.equal(messages.length, 1);
    assert.match(result.reason, /invalid_describe_response|unsupported_capability/);
  }
});

test("desktop bridge treats a missing callback as a timeout failure", async () => {
  const timers = new Map();
  let nextTimer = 0;
  const target = {
    setTimeout(callback) {
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
    },
    pycmd() {}
  };
  const platform = createPlatform({}, target);
  const pending = platform.showAnswer();
  assert.equal(timers.size, 1);
  timers.values().next().value();
  const result = await pending;
  assert.equal(result.success, false);
  assert.equal(result.reason, "bridge_timeout");
});

test("desktop bridge times out an action callback after a valid handshake", async () => {
  const timers = new Map();
  let nextTimer = 0;
  const target = {
    setTimeout(callback) {
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
    },
    pycmd(message, callback) {
      if (JSON.parse(message).action === "describe") {
        callback({
          ok: true,
          value: {
            apiVersion: "1.0.0",
            capabilities: ["showAnswer", "answerEase"]
          }
        });
      }
    }
  };
  const platform = createPlatform({}, target);
  await platform.ready();
  assert.equal(timers.size, 0);
  const pending = platform.answerEase(3);
  await Promise.resolve();
  assert.equal(timers.size, 1);
  timers.values().next().value();
  const result = await pending;
  assert.equal(result.success, false);
  assert.equal(result.reason, "bridge_timeout");
});

test("AnkiDroid formal contract receives the supported API version", async () => {
  let contract;
  class AnkiDroidJS {
    constructor(value) {
      contract = value;
    }
    ankiShowAnswer() {
      return Promise.resolve({ success: true, value: true });
    }
    ankiAnswerEase4() {
      return Promise.resolve({ success: true, value: true });
    }
  }
  const platform = createPlatform(
    { platform: { ankidroid_api: true } },
    { AnkiDroidJS }
  );
  assert.deepEqual(contract, { version: "0.0.3", developer: "chehil@163.com" });
  assert.equal(platform.describe().platform, "ankidroid");
  assert.equal((await platform.showAnswer()).transport, "ankidroid-js");
  assert.equal((await platform.answerEase(4)).success, true);
});

test("AnkiDroid resolves a classic-script lexical class without a window property", async () => {
  const context = vm.createContext({
    contract: null,
    formalCalls: []
  });

  vm.runInContext(
    `
      class AnkiDroidJS {
        constructor(value) {
          globalThis.contract = value;
        }
        ankiShowAnswer() {
          globalThis.formalCalls.push("showAnswer");
          return { success: true, value: "formal-show" };
        }
        ankiAnswerEase1() { return { success: true, value: 1 }; }
        ankiAnswerEase2() { return { success: true, value: 2 }; }
        ankiAnswerEase3() {
          globalThis.formalCalls.push("ease3");
          return { success: true, value: 3 };
        }
        ankiAnswerEase4() { return { success: true, value: 4 }; }
      }
      globalThis.hasAnkiDroidWindowProperty = Object.prototype.hasOwnProperty.call(
        globalThis,
        "AnkiDroidJS"
      );
    `,
    context,
    { filename: "ankidroid-js-api.js" }
  );

  assert.equal(context.hasAnkiDroidWindowProperty, false);
  assert.equal(vm.runInContext("typeof AnkiDroidJS", context), "function");

  loadPlatformAsClassicScript(context);
  const platform = context.createPlatform(
    { platform: { ankidroid_api: true } },
    context
  );

  assert.deepEqual(
    { ...context.contract },
    { version: "0.0.3", developer: "chehil@163.com" }
  );
  assert.equal(platform.describe().platform, "ankidroid");
  assert.equal((await platform.showAnswer()).value, "formal-show");
  assert.equal((await platform.answerEase(3)).value, 3);
  assert.deepEqual([...context.formalCalls], ["showAnswer", "ease3"]);
});

test("Android reviewer globals provide show and ease fallbacks", async () => {
  const calls = [];
  const target = {
    document: androidDocument(),
    showAnswer() {
      calls.push("showAnswer");
      return "legacy-show";
    },
    ankiAnswerEase2() {
      calls.push("ankiAnswerEase2");
      return "legacy-anki-ease";
    },
    buttonAnswerEase3() {
      calls.push("buttonAnswerEase3");
      return "legacy-button-ease";
    }
  };
  const platform = createPlatform({}, target);

  assert.equal((await platform.showAnswer()).value, "legacy-show");
  assert.equal((await platform.answerEase(2)).value, "legacy-anki-ease");
  assert.equal((await platform.answerEase(3)).value, "legacy-button-ease");
  assert.deepEqual(calls, ["showAnswer", "ankiAnswerEase2", "buttonAnswerEase3"]);
});

test("reviewer globals are never invoked outside Android", async () => {
  const calls = [];
  const target = {
    document: androidDocument(false),
    showAnswer() {
      calls.push("showAnswer");
    },
    ankiAnswerEase2() {
      calls.push("ankiAnswerEase2");
    },
    buttonAnswerEase3() {
      calls.push("buttonAnswerEase3");
    }
  };
  const platform = createPlatform({}, target);

  assert.equal((await platform.showAnswer()).success, false);
  assert.equal((await platform.answerEase(2)).success, false);
  assert.equal((await platform.answerEase(3)).success, false);
  assert.deepEqual(calls, []);
  assert.equal(platform.describe().platform, "browser");
});

test("AnkiDroid formal API takes priority over Android reviewer globals", async () => {
  const calls = [];
  class AnkiDroidJS {
    ankiShowAnswer() {
      calls.push("formal-show");
      return { success: true, value: "formal-show" };
    }
    ankiAnswerEase2() {
      calls.push("formal-ease2");
      return { success: true, value: "formal-ease" };
    }
  }
  const target = {
    AnkiDroidJS,
    document: androidDocument(),
    showAnswer() {
      calls.push("legacy-show");
      return "legacy-show";
    },
    ankiAnswerEase2() {
      calls.push("legacy-anki-ease2");
      return "legacy-anki-ease";
    },
    buttonAnswerEase2() {
      calls.push("legacy-button-ease2");
      return "legacy-button-ease";
    }
  };
  const platform = createPlatform({}, target);

  assert.equal((await platform.showAnswer()).value, "formal-show");
  assert.equal((await platform.answerEase(2)).value, "formal-ease");
  assert.deepEqual(calls, ["formal-show", "formal-ease2"]);
});

test("AnkiDroid initialization errors degrade safely to Android fallbacks", async () => {
  const calls = [];
  class BrokenAnkiDroidJS {
    constructor() {
      throw new Error("unsupported API contract");
    }
  }
  const target = {
    AnkiDroidJS: BrokenAnkiDroidJS,
    document: androidDocument(),
    showAnswer() {
      calls.push("legacy-show");
      return true;
    },
    buttonAnswerEase4() {
      calls.push("legacy-ease4");
      return true;
    }
  };

  const platform = createPlatform({}, target);
  assert.equal((await platform.showAnswer()).success, true);
  assert.equal((await platform.answerEase(4)).success, true);
  assert.deepEqual(calls, ["legacy-show", "legacy-ease4"]);
});

test("disabling the formal AnkiDroid contract keeps Android reviewer fallbacks", async () => {
  let constructorCalls = 0;
  class AnkiDroidJS {
    constructor() {
      constructorCalls += 1;
    }
  }
  const calls = [];
  const platform = createPlatform(
    { platform: { ankidroid_api: false } },
    {
      AnkiDroidJS,
      document: androidDocument(),
      showAnswer() {
        calls.push("showAnswer");
      },
      buttonAnswerEase3() {
        calls.push("ease3");
      }
    }
  );

  assert.equal(constructorCalls, 0);
  assert.equal((await platform.showAnswer()).success, true);
  assert.equal((await platform.answerEase(3)).success, true);
  assert.deepEqual(calls, ["showAnswer", "ease3"]);
});

test("Desktop bridge wins over a stray AnkiDroid constructor", async () => {
  let constructorCalls = 0;
  class AnkiDroidJS {
    constructor() {
      constructorCalls += 1;
    }
  }
  const platform = createPlatform({}, {
    AnkiDroidJS,
    setTimeout,
    clearTimeout,
    pycmd(message, callback) {
      const payload = JSON.parse(message);
      callback(
        payload.action === "describe"
          ? {
              ok: true,
              value: {
                apiVersion: "1.0.0",
                capabilities: ["showAnswer", "answerEase"]
              }
            }
          : { ok: true, value: true }
      );
    }
  });

  assert.equal(platform.describe().platform, "anki-desktop");
  await platform.ready();
  assert.equal((await platform.showAnswer()).transport, "anki-desktop-addon");
  assert.equal(constructorCalls, 0);
});

test("an Android document never probes an unrelated pycmd global", async () => {
  let desktopCalls = 0;
  class AnkiDroidJS {
    ankiShowAnswer() {
      return { success: true, value: true };
    }
  }
  const platform = createPlatform({}, {
    AnkiDroidJS,
    document: androidDocument(),
    pycmd() {
      desktopCalls += 1;
    }
  });

  await platform.ready();
  assert.equal(platform.describe().platform, "ankidroid");
  assert.equal((await platform.showAnswer()).transport, "ankidroid-js");
  assert.equal(desktopCalls, 0);
});

test("a rejected formal AnkiDroid call never retries through a legacy action", async () => {
  for (const formalCall of [
    () => undefined,
    () => ({ success: "yes", value: true }),
    () => Promise.reject(new Error("native rejected"))
  ]) {
    let legacyCalls = 0;
    class AnkiDroidJS {
      ankiShowAnswer() {
        return formalCall();
      }
    }
    const platform = createPlatform({}, {
      AnkiDroidJS,
      document: androidDocument(),
      showAnswer() {
        legacyCalls += 1;
      }
    });

    const result = await platform.showAnswer();
    assert.equal(result.success, false);
    assert.equal(result.transport, "ankidroid-js");
    assert.equal(legacyCalls, 0);
  }
});
