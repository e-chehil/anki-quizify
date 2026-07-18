from __future__ import annotations

from pathlib import Path

from .configuration import config_script, note_type_name


LEGACY_DEFAULT_CSS = (
    "/* Quizify 1.0 styling is provided by _quizify.css. */\n"
    ".card { margin: 0; }\n"
)
MANAGED_CSS_START = "/* quizify-managed-css:v1:start */"
MANAGED_CSS_END = "/* quizify-managed-css:v1:end */"
MANAGED_CSS_BLOCK = (
    f"{MANAGED_CSS_START}\n"
    "/* Quizify styling is provided by _quizify.css. */\n"
    ".card { margin: 0; }\n"
    f"{MANAGED_CSS_END}"
)
DEFAULT_CSS = f"{MANAGED_CSS_BLOCK}\n"
MANAGED_TEMPLATE_NAME = "Quizify"
MANAGED_TEMPLATE_MARKER = "<!-- quizify-managed-template:v1 -->"
LEGACY_TEMPLATE_MARKERS = ('id="quizify-config"', "_quizify.js")


def template_html(addon_dir: Path, name: str, config: dict) -> str:
    body = (addon_dir / "templates" / name).read_text(encoding="utf-8")
    return f"{MANAGED_TEMPLATE_MARKER}\n{config_script(config)}\n{body}"


def _is_managed_template(template: dict) -> bool:
    source = f'{template.get("qfmt", "")}\n{template.get("afmt", "")}'
    if MANAGED_TEMPLATE_MARKER in source:
        return True
    # Legacy templates had no ownership marker. Require the complete runtime
    # signature; a name or one common asset reference is not enough to claim it.
    return all(marker in source for marker in LEGACY_TEMPLATE_MARKERS)


def _available_name(models, requested: str) -> str:
    candidate = f"{requested} (Quizify)"
    suffix = 2
    while models.by_name(candidate):
        candidate = f"{requested} (Quizify {suffix})"
        suffix += 1
    return candidate


def _write_managed_template(
    template: dict, addon_dir: Path, config: dict, name: str
) -> bool:
    managed_config = {**config, "note_type": name}
    qfmt = template_html(addon_dir, "front.html", managed_config)
    afmt = template_html(addon_dir, "back.html", managed_config)
    changed = template.get("qfmt") != qfmt or template.get("afmt") != afmt
    if changed:
        template["qfmt"] = qfmt
        template["afmt"] = afmt
    return changed


def _css_with_managed_block(css) -> str:
    current = css if isinstance(css, str) else ""
    start = current.find(MANAGED_CSS_START)
    end = current.find(MANAGED_CSS_END, start + len(MANAGED_CSS_START))
    if start >= 0 and end >= 0:
        end += len(MANAGED_CSS_END)
        return current[:start] + MANAGED_CSS_BLOCK + current[end:]
    if current.startswith(LEGACY_DEFAULT_CSS):
        return DEFAULT_CSS + current[len(LEGACY_DEFAULT_CSS) :]
    if not current.strip():
        return DEFAULT_CSS
    # Put the managed defaults first so later user CSS keeps normal cascade
    # precedence and remains byte-for-byte intact.
    return f"{DEFAULT_CSS}\n{current}"


def _save_model(models, model: dict) -> None:
    update = getattr(models, "update_dict", None)
    if callable(update):
        update(model)
    else:  # compatibility with older Anki test doubles/legacy releases
        models.save(model)


def _new_model(models, name: str, addon_dir: Path, config: dict):
    model = models.new(name)
    for field_name in ("Front", "Back"):
        field = models.new_field(field_name)
        field["plainText"] = True
        models.add_field(model, field)
    template = models.new_template(MANAGED_TEMPLATE_NAME)
    models.add_template(model, template)
    _write_managed_template(template, addon_dir, config, name)
    model["css"] = DEFAULT_CSS
    # Anki validates field replacements inside templates during add(). The
    # complete template must therefore be present before the model is added.
    models.add(model)
    managed = next(
        (item for item in model.get("tmpls", []) if _is_managed_template(item)),
        template,
    )
    return model, managed


def ensure_notetype(mw, addon_dir: Path, config: dict) -> str:
    models = mw.col.models
    requested_name = note_type_name(config)
    name = requested_name
    model = models.by_name(requested_name)
    managed = None
    created = False

    if not model:
        model, managed = _new_model(models, name, addon_dir, config)
        created = True
    else:
        managed = next(
            (
                template
                for template in model.get("tmpls", [])
                if _is_managed_template(template)
            ),
            None,
        )
        if managed is None:
            name = _available_name(models, requested_name)
            model, managed = _new_model(models, name, addon_dir, config)
            created = True

    if created:
        return name

    fields = model.setdefault("flds", [])
    changed = False
    for required in ("Front", "Back"):
        field = next((item for item in fields if item.get("name") == required), None)
        if not field:
            field = models.new_field(required)
            models.add_field(model, field)
            changed = True
        if field.get("plainText") is not True:
            field["plainText"] = True
            changed = True

    if managed is None:
        managed = models.new_template(MANAGED_TEMPLATE_NAME)
        models.add_template(model, managed)
        changed = True
    changed = _write_managed_template(managed, addon_dir, config, name) or changed
    desired_css = _css_with_managed_block(model.get("css"))
    if model.get("css") != desired_css:
        model["css"] = desired_css
        changed = True
    if changed:
        _save_model(models, model)
    return name
