const TOOLBAR_THEME_VARIABLES = [
  "--qt-surface",
  "--qt-surface-soft",
  "--qt-surface-raised",
  "--qt-text",
  "--qt-muted",
  "--qt-border",
  "--qt-border-strong",
  "--qt-primary",
  "--qt-primary-strong",
  "--qt-primary-soft",
  "--qt-accent",
  "--qt-blue",
  "--qt-green",
  "--qt-purple",
  "--qt-amber",
  "--qt-red",
  "--qt-shadow"
];

function hasClassName(element, name) {
  return String(element?.className || "")
    .split(/\s+/)
    .includes(name);
}

function addClassName(element, name) {
  if (!element || hasClassName(element, name)) return;
  element.className = `${element.className || ""} ${name}`.trim();
}

function removeClassName(element, name) {
  if (!element) return;
  element.className = String(element.className || "")
    .split(/\s+/)
    .filter((item) => item && item !== name)
    .join(" ");
}

export function createFloatingPanelManager(root = globalThis, documentRef = document) {
  const registrations = new Set();
  let eventsBound = false;

  function close(owner) {
    if (!owner) return;
    owner.open = false;
    const registration = Array.from(registrations).find((item) => item.owner === owner);
    const panel = registration?.panel;
    owner.querySelector?.("summary")?.setAttribute?.("aria-expanded", "false");
    if (!panel) return;
    panel.hidden = true;
    removeClassName(panel, "quizify-panel-portal");
    if (owner.appendChild && panel.parentNode !== owner) owner.appendChild(panel);
  }

  function closeTop(focusAnchor = false) {
    const registration = Array.from(registrations)
      .filter(({ owner }) => owner.open)
      .at(-1);
    if (!registration) return false;
    close(registration.owner);
    if (focusAnchor) registration.owner.querySelector?.("summary")?.focus?.();
    return true;
  }

  function position(owner, panel, preferredWidth) {
    const anchor = owner?.querySelector?.("summary");
    if (!anchor?.getBoundingClientRect || !panel?.style) return;
    if (owner.isConnected === false) {
      close(owner);
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const toolbar = owner.closest?.(".quizify-toolbar");
    const toolbarStyle = toolbar && root.getComputedStyle?.(toolbar);
    if (toolbarStyle) {
      TOOLBAR_THEME_VARIABLES.forEach((name) => {
        panel.style.setProperty(name, toolbarStyle.getPropertyValue(name));
      });
      panel.style.fontFamily = toolbarStyle.fontFamily;
      panel.style.colorScheme = toolbarStyle.colorScheme;
    }

    const viewportWidth =
      documentRef.documentElement?.clientWidth || root.innerWidth || 320;
    const viewportHeight =
      documentRef.documentElement?.clientHeight || root.innerHeight || 320;
    const margin = 8;
    const gap = 7;
    const width = Math.min(preferredWidth, Math.max(0, viewportWidth - margin * 2));
    const left = Math.max(
      margin,
      Math.min(rect.right - width, viewportWidth - width - margin)
    );
    const below = Math.max(0, viewportHeight - rect.bottom - gap - margin);
    const above = Math.max(0, rect.top - gap - margin);
    const openAbove = below < 220 && above > below;
    const availableHeight = openAbove ? above : below;

    panel.style.position = "fixed";
    panel.style.left = `${Math.round(left)}px`;
    panel.style.right = "auto";
    panel.style.width = `${Math.round(width)}px`;
    panel.style.maxWidth = `${Math.round(Math.max(0, viewportWidth - margin * 2))}px`;
    panel.style.maxHeight = `${Math.round(availableHeight)}px`;
    if (openAbove) {
      panel.style.top = "auto";
      panel.style.bottom = `${Math.round(viewportHeight - rect.top + gap)}px`;
    } else {
      panel.style.top = `${Math.round(rect.bottom + gap)}px`;
      panel.style.bottom = "auto";
    }
  }

  function update() {
    registrations.forEach(({ owner, panel, preferredWidth }) => {
      if (owner.open && !panel.hidden) position(owner, panel, preferredWidth);
    });
  }

  function bindGlobalEvents() {
    if (eventsBound) return;
    eventsBound = true;
    root.addEventListener?.("resize", update);
    documentRef.addEventListener("scroll", update, true);
    const closeOutside = (event) => {
      registrations.forEach(({ owner, panel }) => {
        if (!owner.open) return;
        const inOwner = owner.contains?.(event.target);
        const inPanel = panel.contains?.(event.target);
        if (!inOwner && !inPanel) close(owner);
      });
    };
    documentRef.addEventListener("pointerdown", closeOutside, true);
    documentRef.addEventListener("focusin", closeOutside, true);
  }

  function focusFirstControl(panel) {
    for (const selector of [
      "button:not([disabled])",
      "input:not([disabled])",
      "[tabindex='0']"
    ]) {
      const focusable = panel.querySelector?.(selector);
      if (focusable?.focus) {
        focusable.focus();
        return;
      }
    }
    panel?.focus?.();
  }

  function bind(owner, panel, preferredWidth) {
    if (!owner || !panel || owner.__quizifyFloatingPanelBound) return;
    owner.__quizifyFloatingPanelBound = true;
    owner.__quizifyFloatingPanel = panel;
    panel.__quizifyFloatingOwner = owner;
    panel.hidden = true;
    panel.setAttribute("tabindex", "-1");
    const registration = { owner, panel, preferredWidth };
    registrations.add(registration);

    const anchor = owner.querySelector?.("summary");
    const panelId = `quizify-floating-panel-${registrations.size}`;
    panel.id = panelId;
    panel.setAttribute("role", "dialog");
    const explicitPanelLabel = String(panel.getAttribute?.("aria-label") || "").trim();
    panel.setAttribute(
      "aria-label",
      explicitPanelLabel ||
        anchor?.getAttribute?.("aria-label") ||
        anchor?.textContent ||
        "Quizify 工具面板"
    );
    anchor?.setAttribute?.("aria-controls", panelId);
    anchor?.setAttribute?.("aria-haspopup", "dialog");
    anchor?.setAttribute?.("aria-expanded", "false");
    anchor?.addEventListener?.("keydown", (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        owner.__quizifyOpenedByKeyboard = true;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          owner.open = true;
        }
      }
    });

    owner.addEventListener("toggle", () => {
      anchor?.setAttribute?.("aria-expanded", String(Boolean(owner.open)));
      if (owner.open) {
        registrations.forEach(({ owner: itemOwner }) => {
          if (itemOwner !== owner) close(itemOwner);
        });
        documentRef.body.appendChild(panel);
        panel.hidden = false;
        addClassName(panel, "quizify-panel-portal");
        position(owner, panel, preferredWidth);
        if (owner.__quizifyOpenedByKeyboard) {
          owner.__quizifyOpenedByKeyboard = false;
          root.setTimeout?.(() => focusFirstControl(panel), 0);
        }
      } else {
        close(owner);
      }
    });

    bindGlobalEvents();
  }

  function closeAll() {
    registrations.forEach(({ owner }) => close(owner));
  }

  return Object.freeze({ bind, closeAll, closeTop, update });
}
