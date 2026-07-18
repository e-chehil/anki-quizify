export function createFloatingControlRuntime({
  root,
  clearRevealProgress,
  clearUserAnswers,
  loadFloatingPosition,
  saveFloatingPosition,
  sideRevealControllers,
  persistCurrentRevealProgress,
  prepareRevealContext,
  focusRevealedController,
  prefersReducedMotion,
  platformCallTimeout = 2200,
  transitionWatchdogTimeout = 1800
}) {
  function directionFromDelta(dx, dy, threshold = 48) {
    const distance = Math.hypot(Number(dx) || 0, Number(dy) || 0);
    if (distance < threshold) return null;
    if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? "up" : "down";
    return dx < 0 ? "left" : "right";
  }

  function statusPlacementForCenter(centerX, viewportWidth) {
    const width = Math.max(1, Number(viewportWidth) || 1);
    return (Number(centerX) || 0) <= width / 2 ? "right" : "left";
  }

  function easeForDirection(direction) {
    return { left: 1, down: 2, right: 3, up: 4 }[direction] || null;
  }

  function createFloatingController(config) {
    const enabled = config.review?.floating_control ?? config.enable_floating_ball;
    if (!root.document || enabled === false) return null;
    const cardHost =
      root.document.querySelector(".container") ||
      root.document.getElementById("note-container");
    if (!cardHost) return null;

    const existing = root.document.getElementById("quizify-floating-control");
    if (existing) {
      if (cardHost.contains(existing)) return root.quizifyFloatingControl || null;
      // Remove an orphan created by an older runtime that mounted to body.
      existing.remove();
    }

    const shell = root.document.createElement("div");
    shell.id = "quizify-floating-control";
    shell.className = "quizify-floating-control";
    shell.dataset.side = root.isBack ? "back" : "front";
    shell.innerHTML =
      '<span class="quizify-orb-direction quizify-orb-up">简单</span>' +
      '<span class="quizify-orb-direction quizify-orb-right">良好</span>' +
      '<span class="quizify-orb-direction quizify-orb-down">困难</span>' +
      '<span class="quizify-orb-direction quizify-orb-left">重来</span>' +
      '<button type="button" class="quizify-orb" aria-describedby="quizify-orb-status">' +
      '<span class="quizify-orb-eye" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M2.3 12s3.5-6 9.7-6 9.7 6 9.7 6-3.5 6-9.7 6-9.7-6-9.7-6Zm9.7 3.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Zm0-2a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z"></path></svg>' +
      "</span>" +
      '<span class="quizify-orb-complete" aria-hidden="true">✓</span>' +
      '<span class="quizify-orb-count" aria-hidden="true"></span>' +
      "</button>" +
      '<span id="quizify-orb-status" class="quizify-orb-status" aria-live="polite"></span>';
    // Anki replaces the card container between cards but keeps the outer
    // document. Mounting here guarantees the control and its closure are
    // discarded when the reviewer advances.
    cardHost.appendChild(shell);

    const button = shell.querySelector(".quizify-orb");
    const count = shell.querySelector(".quizify-orb-count");
    const status = shell.querySelector(".quizify-orb-status");
    const platform = root.quizifyPlatform || root.quizifyAnkiDroid;
    const dragThreshold = 48;
    const moveThreshold = 10;
    const longPressDuration = 520;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let initialCenterX = 0;
    let initialCenterY = 0;
    let deltaX = 0;
    let deltaY = 0;
    let dragging = false;
    let positioning = false;
    let longPressTimer = null;
    let busy = false;
    let autoFlipPending = false;
    const pendingTimers = new Set();

    function scheduleTracked(callback, delay) {
      const schedule = root.setTimeout || setTimeout;
      let fired = false;
      let timer = null;
      timer = schedule.call(root, () => {
        fired = true;
        if (timer !== null) pendingTimers.delete(timer);
        callback();
      }, delay);
      if (!fired) pendingTimers.add(timer);
      return timer;
    }

    function clearTracked(timer) {
      if (timer === null || !pendingTimers.has(timer)) return;
      pendingTimers.delete(timer);
      const cancel = root.clearTimeout || clearTimeout;
      cancel.call(root, timer);
    }

    function clearTrackedTimers() {
      Array.from(pendingTimers).forEach(clearTracked);
    }

    function callPlatform(action) {
      return new Promise((resolve) => {
        let settled = false;
        let timeout = null;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTracked(timeout);
          resolve(
            value &&
              typeof value === "object" &&
              typeof value.success === "boolean"
              ? value
              : {
                  success: false,
                  reason: "invalid_platform_response"
                }
          );
        };
        timeout = scheduleTracked(
          () => finish({ success: false, reason: "platform_timeout" }),
          platformCallTimeout
        );
        Promise.resolve()
          .then(action)
          .then(finish, (error) =>
            finish({ success: false, reason: error?.message || "platform_failed" })
          );
      });
    }

    function restoreAfterFailedTransition(message) {
      if (!shell.isConnected) return;
      autoFlipPending = false;
      busy = false;
      button.disabled = false;
      setStatus(message, "error");
    }

    function watchForCardTransition(message) {
      scheduleTracked(
        () => restoreAfterFailedTransition(message),
        transitionWatchdogTimeout
      );
    }

    function viewportSize() {
      return {
        width:
          root.innerWidth ||
          root.document.documentElement?.clientWidth ||
          1,
        height:
          root.innerHeight ||
          root.document.documentElement?.clientHeight ||
          1
      };
    }

    function updateStatusPlacement(centerX = null) {
      const viewport = viewportSize();
      const rect = shell.getBoundingClientRect();
      const resolvedCenterX =
        centerX === null ? rect.left + rect.width / 2 : centerX;
      const placement = statusPlacementForCenter(
        resolvedCenterX,
        viewport.width
      );
      const availableWidth =
        placement === "right"
          ? viewport.width - rect.left - 8
          : rect.right - 8;
      shell.dataset.statusPlacement = placement;
      shell.style.setProperty(
        "--quizify-orb-status-max-width",
        `${Math.max(1, Math.min(240, availableWidth))}px`
      );
    }

    function placeFloatingControl(centerX, centerY, persist = false) {
      const viewport = viewportSize();
      const rect = shell.getBoundingClientRect();
      const width = rect.width || 54;
      const height = rect.height || 54;
      // Keep enough room around the control for a full rating gesture.
      const marginX = Math.min(
        width / 2 + dragThreshold + 8,
        viewport.width / 2
      );
      const marginY = Math.min(
        height / 2 + dragThreshold + 8,
        viewport.height / 2
      );
      const x = Math.max(marginX, Math.min(centerX, viewport.width - marginX));
      const y = Math.max(marginY, Math.min(centerY, viewport.height - marginY));

      shell.style.right = "auto";
      shell.style.bottom = "auto";
      shell.style.left = `${x - width / 2}px`;
      shell.style.top = `${y - height / 2}px`;
      updateStatusPlacement(x);

      if (persist) {
        saveFloatingPosition({
          x: x / viewport.width,
          y: y / viewport.height
        });
      }
    }

    function restoreFloatingPosition() {
      const saved = loadFloatingPosition();
      if (!saved) {
        updateStatusPlacement();
        return;
      }
      const viewport = viewportSize();
      placeFloatingControl(
        saved.x * viewport.width,
        saved.y * viewport.height,
        false
      );
    }

    function stopLongPressTimer() {
      if (longPressTimer !== null) {
        const cancel = root.clearTimeout || clearTimeout;
        cancel.call(root, longPressTimer);
        longPressTimer = null;
      }
    }

    function controllers() {
      return sideRevealControllers();
    }

    function remainingControllers() {
      return controllers().filter((controller) => !controller.isRevealed?.());
    }

    function setStatus(message, stateName = "") {
      status.textContent = message;
      shell.dataset.status = stateName;
    }

    function update() {
      const all = controllers();
      const remaining = remainingControllers();
      const revealedCount = all.length - remaining.length;
      const ratio = all.length ? revealedCount / all.length : 1;
      shell.style.setProperty("--quizify-orb-progress", `${ratio * 360}deg`);
      shell.dataset.complete = remaining.length ? "false" : "true";
      shell.dataset.ratingSupported = platform?.supports?.("answerEase")
        ? "true"
        : "false";
      count.textContent = remaining.length ? String(remaining.length) : "";

      if (!root.isBack) {
        button.setAttribute(
          "aria-label",
          remaining.length
            ? `显示下一个答案，还剩 ${remaining.length} 项`
            : "显示卡片背面"
        );
        button.title = remaining.length
          ? `显示下一个答案（剩余 ${remaining.length}）；长按拖动可调整位置`
          : "显示卡片背面；长按拖动可调整位置";
      } else {
        button.setAttribute(
          "aria-label",
          remaining.length
            ? `显示下一个背面内容，还剩 ${remaining.length} 项；拖拽可评分`
            : "向四个方向拖拽选择复习难度"
        );
        button.title = remaining.length
          ? `显示下一个背面内容（剩余 ${remaining.length}）；长按拖动可调整位置`
          : "拖拽评分：左重来、下困难、右良好、上简单；长按拖动可调整位置";
      }
    }

    async function showAnswerSide() {
      if (!shell.isConnected || root.isBack || autoFlipPending) return;
      persistCurrentRevealProgress(true);
      if (typeof platform?.showAnswer !== "function") {
        setStatus("当前客户端不支持自动翻面", "error");
        return;
      }

      autoFlipPending = true;
      busy = true;
      button.disabled = true;
      setStatus("正在显示答案…", "busy");
      const response = await callPlatform(() => platform.showAnswer());
      if (!shell.isConnected) return;
      if (!response?.success) {
        restoreAfterFailedTransition("自动翻面失败，请使用客户端按钮");
        return;
      }
      watchForCardTransition("客户端未切换到答案面，请使用客户端按钮");
    }

    async function revealNext() {
      if (!shell.isConnected || busy) return;
      const next = remainingControllers()[0];
      if (!next) {
        if (root.isBack) {
          setStatus("答案已全部显示，可拖拽评分", "ready");
        } else {
          await showAnswerSide();
        }
        return;
      }

      prepareRevealContext(next);
      next.reveal();
      persistCurrentRevealProgress(false);
      update();
      await focusRevealedController(next);
      if (!shell.isConnected) return;

      const remaining = remainingControllers();
      if (!remaining.length && !root.isBack) {
        setStatus("答案已全部显示，准备翻面", "ready");
        scheduleTracked(showAnswerSide, prefersReducedMotion() ? 0 : 320);
      } else if (!remaining.length) {
        setStatus("答案已全部显示，可拖拽评分", "ready");
      } else {
        setStatus(`已显示一项，还剩 ${remaining.length} 项`, "progress");
      }
    }

    async function submitEase(direction) {
      if (!shell.isConnected || busy) return;
      if (!root.isBack) {
        setStatus("请先完成答案并翻面", "warning");
        return;
      }

      const ease = easeForDirection(direction);
      if (!ease || typeof platform?.answerEase !== "function") {
        setStatus("当前客户端不支持手势评分", "error");
        return;
      }

      const labels = { 1: "重来", 2: "困难", 3: "良好", 4: "简单" };
      busy = true;
      button.disabled = true;
      setStatus(`正在选择“${labels[ease]}”…`, "busy");
      const response = await callPlatform(() => platform.answerEase(ease));
      if (!response?.success) {
        if (shell.isConnected) {
          restoreAfterFailedTransition("评分失败，请使用客户端按钮");
        }
        return;
      }
      clearUserAnswers();
      clearRevealProgress();
      if (!shell.isConnected) return;
      watchForCardTransition("客户端未完成评分，请使用客户端按钮");
    }

    function resetPointerVisuals() {
      shell.dataset.dragging = "false";
      shell.dataset.positioning = "false";
      delete shell.dataset.direction;
      shell.style.setProperty("--quizify-orb-drag-x", "0px");
      shell.style.setProperty("--quizify-orb-drag-y", "0px");
    }

    function preventInteractionDefault(event) {
      if (event.cancelable !== false) event.preventDefault();
    }

    function beginInteraction(id, clientX, clientY, event) {
      if (busy || pointerId !== null) return false;
      preventInteractionDefault(event);
      pointerId = id;
      startX = Number(clientX) || 0;
      startY = Number(clientY) || 0;
      const rect = shell.getBoundingClientRect();
      initialCenterX = rect.left + rect.width / 2;
      initialCenterY = rect.top + rect.height / 2;
      deltaX = 0;
      deltaY = 0;
      dragging = false;
      positioning = false;
      shell.dataset.dragging = "false";
      stopLongPressTimer();
      const schedule = root.setTimeout || setTimeout;
      longPressTimer = schedule.call(root, () => {
        longPressTimer = null;
        if (
          pointerId === null ||
          dragging ||
          busy ||
          !shell.isConnected
        ) {
          return;
        }
        positioning = true;
        shell.dataset.positioning = "true";
        shell.dataset.dragging = "false";
        setStatus("拖动悬浮球以调整位置", "positioning");
        root.navigator?.vibrate?.(35);
      }, longPressDuration);
      return true;
    }

    function moveInteraction(id, clientX, clientY, event) {
      if (pointerId === null || id !== pointerId) return false;
      preventInteractionDefault(event);
      deltaX = (Number(clientX) || 0) - startX;
      deltaY = (Number(clientY) || 0) - startY;
      if (positioning) {
        placeFloatingControl(
          initialCenterX + deltaX,
          initialCenterY + deltaY,
          false
        );
        return true;
      }

      if (Math.hypot(deltaX, deltaY) >= moveThreshold) {
        stopLongPressTimer();
        dragging = true;
        shell.dataset.dragging = "true";
      }
      if (!dragging) return true;

      const direction = directionFromDelta(deltaX, deltaY, moveThreshold);
      if (direction) shell.dataset.direction = direction;
      const distance = Math.max(1, Math.hypot(deltaX, deltaY));
      const visualDistance = Math.min(distance, 34);
      shell.style.setProperty(
        "--quizify-orb-drag-x",
        `${(deltaX / distance) * visualDistance}px`
      );
      shell.style.setProperty(
        "--quizify-orb-drag-y",
        `${(deltaY / distance) * visualDistance}px`
      );
      return true;
    }

    async function finishInteraction(
      id,
      clientX,
      clientY,
      event,
      { cancelled = false, releaseCapture = null } = {}
    ) {
      if (pointerId === null || id !== pointerId) return;
      preventInteractionDefault(event);
      deltaX = (Number(clientX) || 0) - startX;
      deltaY = (Number(clientY) || 0) - startY;
      stopLongPressTimer();
      const direction = directionFromDelta(deltaX, deltaY, dragThreshold);
      const wasDragging = dragging;
      const wasPositioning = positioning;
      try {
        releaseCapture?.(pointerId);
      } catch {
        // Some embedded WebViews expose capture methods but reject touch ids.
      }
      pointerId = null;
      positioning = false;
      resetPointerVisuals();

      if (wasPositioning) {
        if (cancelled) {
          placeFloatingControl(initialCenterX, initialCenterY, false);
        } else {
          const rect = shell.getBoundingClientRect();
          placeFloatingControl(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
            true
          );
          setStatus("悬浮球位置已保存", "ready");
        }
        return;
      }
      if (cancelled) return;
      if (direction) {
        await submitEase(direction);
      } else if (!wasDragging) {
        await revealNext();
      } else {
        setStatus("拖动距离不足，未执行操作", "warning");
      }
    }

    const interactionListeners = [];
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      interactionListeners.push([target, type, handler, options]);
    }

    function removeInteractionListeners() {
      interactionListeners.forEach(([target, type, handler, options]) => {
        target.removeEventListener(type, handler, options);
      });
      interactionListeners.length = 0;
    }

    const interactionTarget =
      typeof root.addEventListener === "function" ? root : button;
    const hasPointerEvents = typeof root.PointerEvent === "function";
    let suppressClickUntil = 0;
    let suppressMouseUntil = 0;

    if (hasPointerEvents) {
      listen(button, "pointerdown", (event) => {
        if (
          (event.button !== undefined && event.button !== 0) ||
          event.isPrimary === false
        ) {
          return;
        }
        if (
          !beginInteraction(
            event.pointerId,
            event.clientX,
            event.clientY,
            event
          )
        ) {
          return;
        }
        try {
          button.setPointerCapture?.(event.pointerId);
        } catch {
          // The window listeners below still receive uncaptured pointer events.
        }
      });
      listen(interactionTarget, "pointermove", (event) => {
        moveInteraction(event.pointerId, event.clientX, event.clientY, event);
      });
      listen(interactionTarget, "pointerup", (event) => {
        if (pointerId === null || event.pointerId !== pointerId) return;
        suppressClickUntil = Date.now() + 700;
        finishInteraction(
          event.pointerId,
          event.clientX,
          event.clientY,
          event,
          {
            releaseCapture: (id) => button.releasePointerCapture?.(id)
          }
        );
      });
      listen(interactionTarget, "pointercancel", (event) => {
        if (pointerId === null || event.pointerId !== pointerId) return;
        suppressClickUntil = Date.now() + 700;
        finishInteraction(
          event.pointerId,
          event.clientX,
          event.clientY,
          event,
          {
            cancelled: true,
            releaseCapture: (id) => button.releasePointerCapture?.(id)
          }
        );
      });
    } else {
      function findTouch(touches, id = null) {
        for (let index = 0; index < (touches?.length || 0); index += 1) {
          const touch = touches[index];
          if (id === null || touch.identifier === id) return touch;
        }
        return null;
      }

      listen(
        button,
        "touchstart",
        (event) => {
          if ((event.touches?.length || 0) !== 1) return;
          const touch = findTouch(event.changedTouches || event.touches);
          if (!touch) return;
          suppressMouseUntil = Date.now() + 800;
          beginInteraction(
            touch.identifier,
            touch.clientX,
            touch.clientY,
            event
          );
        },
        { passive: false }
      );
      listen(
        interactionTarget,
        "touchmove",
        (event) => {
          const touch = findTouch(event.touches, pointerId);
          if (!touch) return;
          moveInteraction(
            touch.identifier,
            touch.clientX,
            touch.clientY,
            event
          );
        },
        { passive: false }
      );

      const finishTouch = (event, cancelled = false) => {
        const touch = findTouch(event.changedTouches, pointerId);
        if (!touch) return;
        suppressClickUntil = Date.now() + 700;
        suppressMouseUntil = Date.now() + 800;
        finishInteraction(
          touch.identifier,
          touch.clientX,
          touch.clientY,
          event,
          { cancelled }
        );
      };
      listen(
        interactionTarget,
        "touchend",
        (event) => finishTouch(event),
        { passive: false }
      );
      listen(
        interactionTarget,
        "touchcancel",
        (event) => finishTouch(event, true),
        { passive: false }
      );

      listen(button, "mousedown", (event) => {
        if (event.button !== 0 || Date.now() < suppressMouseUntil) return;
        beginInteraction("mouse", event.clientX, event.clientY, event);
      });
      listen(interactionTarget, "mousemove", (event) => {
        if (pointerId !== "mouse") return;
        moveInteraction("mouse", event.clientX, event.clientY, event);
      });
      listen(interactionTarget, "mouseup", (event) => {
        if (pointerId !== "mouse" || event.button !== 0) return;
        suppressClickUntil = Date.now() + 700;
        finishInteraction("mouse", event.clientX, event.clientY, event);
      });
    }

    listen(button, "click", (event) => {
      if (Date.now() < suppressClickUntil) {
        preventInteractionDefault(event);
        return;
      }
      preventInteractionDefault(event);
      revealNext();
    });
    button.addEventListener("contextmenu", (event) => event.preventDefault());

    restoreFloatingPosition();
    const handleViewportResize = () => {
      if (!shell.isConnected) {
        root.removeEventListener?.("resize", handleViewportResize);
        return;
      }
      restoreFloatingPosition();
    };
    root.addEventListener?.("resize", handleViewportResize);

    update();
    if (typeof platform?.ready === "function") {
      Promise.resolve()
        .then(() => platform.ready())
        .then(
          () => {
            if (shell.isConnected) update();
          },
          () => {}
        );
    }
    return {
      element: shell,
      update,
      revealNext,
      submitEase,
      restorePosition: restoreFloatingPosition,
      destroy() {
        stopLongPressTimer();
        clearTrackedTimers();
        removeInteractionListeners();
        root.removeEventListener?.("resize", handleViewportResize);
        shell.remove();
      }
    };
  }

  return Object.freeze({
    createFloatingController,
    directionFromDelta,
    easeForDirection,
    statusPlacementForCenter
  });
}
