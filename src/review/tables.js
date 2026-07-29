import { t } from "../shared/i18n.js";

/**
 * Give Markdown tables a full-width scroll shell. Keeping overflow on a
 * wrapper lets the table retain its native table layout instead of shrinking
 * its row groups to their intrinsic width.
 */
export function enhanceMarkdownTables(host = globalThis.document) {
  if (!host?.querySelectorAll) return [];
  const documentRef = host.ownerDocument || host;
  const tables = Array.from(host.querySelectorAll("table")).filter((table) => {
    if (table.closest?.("pre")) return false;
    return !table.parentElement?.classList?.contains("quizify-table-scroll");
  });

  tables.forEach((table) => {
    const shell = documentRef.createElement("div");
    shell.className = "quizify-table-scroll";
    shell.setAttribute("role", "region");
    shell.setAttribute("aria-label", t("review.table_scrollable"));
    shell.setAttribute("tabindex", "0");
    table.parentNode?.insertBefore(shell, table);
    shell.appendChild(table);
  });
  return tables;
}
