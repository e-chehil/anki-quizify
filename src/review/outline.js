import { t } from "../shared/i18n.js";

let outlineId = 0;

function directChildLists(item) {
  return Array.from(item?.children || []).filter((child) => {
    const tagName = String(child.tagName || "").toLowerCase();
    return tagName === "ul" || tagName === "ol";
  });
}

function directItems(list) {
  return Array.from(list?.children || []).filter(
    (child) => String(child.tagName || "").toLowerCase() === "li"
  );
}

function interactiveDiv(documentRef, className, action, label, activate) {
  const element = documentRef.createElement("div");
  element.className = className;
  element.dataset.action = action;
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute("aria-label", label);
  element.title = label;
  if (activate) {
    element.addEventListener("click", activate);
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate(event);
    });
  }
  return element;
}

function itemLabel(item) {
  const label = item.querySelector?.(".quizify-outline-content")?.textContent || "";
  return label.replace(/\s+/g, " ").trim().slice(0, 80) || t("review.outline.unnamed");
}

function setExpanded(collapse, bullet, childLists, expanded) {
  collapse.setAttribute("aria-expanded", String(expanded));
  const label = t(expanded ? "review.outline.collapse" : "review.outline.expand");
  collapse.setAttribute("aria-label", label);
  collapse.title = label;
  collapse.classList.toggle("collapsed", !expanded);
  bullet.classList.toggle("collapsed-with-children", !expanded);
  childLists.forEach((list) => {
    list.hidden = !expanded;
  });
}

function parentItem(item, root) {
  const list = item.parentElement;
  const parent = list?.parentElement;
  return parent?.classList?.contains("quizify-outline-item") && root.contains(parent)
    ? parent
    : null;
}

function ancestry(item, root) {
  const items = [];
  let current = item;
  while (current) {
    items.unshift(current);
    current = parentItem(current, root);
  }
  return items;
}

function makeCrumb(documentRef, label, activate, current = false) {
  const crumb = documentRef.createElement("div");
  crumb.className = `quizify-outline-crumb${current ? " current" : ""}`;
  crumb.textContent = label;
  if (!current) {
    crumb.setAttribute("role", "button");
    crumb.setAttribute("tabindex", "0");
    crumb.addEventListener("click", activate);
    crumb.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
  }
  return crumb;
}

function applyZoom(root, breadcrumb, target) {
  const items = Array.from(root.querySelectorAll(".quizify-outline-item"));
  const branches = Array.from(root.querySelectorAll(".quizify-outline-branch"));
  items.forEach((item) => {
    item.classList.remove(
      "quizify-outline-filtered",
      "quizify-outline-zoom-ancestor",
      "quizify-outline-zoom-focus"
    );
    item.querySelector?.(".quizify-outline-row > .quizify-outline-bullet")
      ?.setAttribute("aria-pressed", "false");
  });
  branches.forEach((branch) => branch.classList.remove("quizify-outline-zoom-path"));

  if (!target) {
    root.classList.remove("quizify-outline-zoomed");
    breadcrumb.hidden = true;
    breadcrumb.replaceChildren();
    return;
  }

  const path = ancestry(target, root);
  root.classList.add("quizify-outline-zoomed");
  items.forEach((item) => {
    if (!target.contains(item) && !path.includes(item)) {
      item.classList.add("quizify-outline-filtered");
    }
  });
  path.slice(0, -1).forEach((ancestor, index) => {
    ancestor.classList.add("quizify-outline-zoom-ancestor");
    const nextItem = path[index + 1];
    directChildLists(ancestor)
      .find((branch) => branch.contains(nextItem))
      ?.classList.add("quizify-outline-zoom-path");
  });
  target.classList.add("quizify-outline-zoom-focus");
  target.querySelector?.(".quizify-outline-row > .quizify-outline-bullet")
    ?.setAttribute("aria-pressed", "true");

  breadcrumb.replaceChildren();
  const documentRef = root.ownerDocument;
  breadcrumb.appendChild(
    makeCrumb(documentRef, t("review.outline.all"), () => applyZoom(root, breadcrumb, null))
  );
  path.forEach((item, index) => {
    const separator = documentRef.createElement("span");
    separator.className = "quizify-outline-crumb-separator";
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "/";
    breadcrumb.appendChild(separator);
    breadcrumb.appendChild(
      makeCrumb(
        documentRef,
        itemLabel(item),
        () => applyZoom(root, breadcrumb, item),
        index === path.length - 1
      )
    );
  });
  breadcrumb.hidden = false;
}

function createRow(item, childLists, documentRef) {
  const row = documentRef.createElement("div");
  row.className = "quizify-outline-row";
  const content = documentRef.createElement("div");
  content.className = "quizify-outline-content";

  Array.from(item.childNodes)
    .filter((node) => !childLists.includes(node))
    .forEach((node) => content.appendChild(node));

  const bullet = interactiveDiv(
    documentRef,
    "quizify-outline-bullet",
    "zoom",
    t("review.outline.focus")
  );
  bullet.setAttribute("aria-pressed", "false");
  if (!childLists.length) bullet.classList.add("leaf");

  let collapse = null;
  if (childLists.length) {
    collapse = interactiveDiv(
      documentRef,
      "quizify-outline-collapse",
      "toggle",
      t("review.outline.collapse"),
      () => setExpanded(
        collapse,
        bullet,
        childLists,
        collapse.getAttribute("aria-expanded") !== "true"
      )
    );
    const childIds = childLists.map((childList) => {
      if (!childList.id) {
        outlineId += 1;
        childList.id = `quizify-outline-children-${outlineId}`;
      }
      return childList.id;
    });
    collapse.setAttribute("aria-controls", childIds.join(" "));
    setExpanded(collapse, bullet, childLists, true);
    row.appendChild(collapse);
  }

  row.append(bullet, content);
  item.insertBefore(row, childLists[0] || null);
  return { bullet, collapse };
}

function enhanceList(list, documentRef, isRoot = false) {
  list.classList.add(isRoot ? "quizify-outline" : "quizify-outline-branch");
  directItems(list).forEach((item) => {
    item.classList.add("quizify-outline-item");
    if (!item.id) {
      outlineId += 1;
      item.id = `quizify-outline-item-${outlineId}`;
    }
    const childLists = directChildLists(item);
    const controls = createRow(item, childLists, documentRef);
    item.__quizifyOutlineBullet = controls.bullet;
    childLists.forEach((childList) => enhanceList(childList, documentRef));
  });
}

function initializeZoom(root, documentRef) {
  const breadcrumb = documentRef.createElement("nav");
  breadcrumb.className = "quizify-outline-breadcrumbs";
  breadcrumb.setAttribute("aria-label", t("review.outline.breadcrumb"));
  breadcrumb.hidden = true;
  root.parentNode?.insertBefore(breadcrumb, root);

  Array.from(root.querySelectorAll(".quizify-outline-item")).forEach((item) => {
    const bullet = item.__quizifyOutlineBullet;
    if (!bullet) return;
    const zoom = (event) => {
      event?.stopPropagation?.();
      applyZoom(root, breadcrumb, item);
    };
    bullet.addEventListener("click", zoom);
    bullet.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      zoom(event);
    });
    delete item.__quizifyOutlineBullet;
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !root.classList.contains("quizify-outline-zoomed")) return;
    event.preventDefault();
    applyZoom(root, breadcrumb, null);
  });
}

/**
 * Turn nested Markdown lists into independently collapsible, zoomable outlines.
 * Flat lists deliberately keep the normal Markdown presentation.
 */
export function enhanceOutlineLists(host = globalThis.document) {
  if (!host?.querySelectorAll) return [];
  const documentRef = host.ownerDocument || host;
  const roots = Array.from(host.querySelectorAll("ul, ol")).filter((list) => {
    if (list.closest?.(".quizify-outline")) return false;
    if (list.parentElement?.closest?.("ul, ol")) return false;
    return Boolean(list.querySelector("ul, ol"));
  });

  roots.forEach((list) => {
    enhanceList(list, documentRef, true);
    initializeZoom(list, documentRef);
  });
  return roots;
}
