import importlib.util
from pathlib import Path
import sys
import types


ADDON_ROOT = Path(__file__).resolve().parents[1] / "quizify_addon"
PACKAGE = "quizify_pure_test"


def load_module(name: str):
    package = sys.modules.get(PACKAGE)
    if package is None:
        package = types.ModuleType(PACKAGE)
        package.__path__ = [str(ADDON_ROOT)]
        sys.modules[PACKAGE] = package
    parts = name.split(".")
    qualified = f"{PACKAGE}.{name}"
    if qualified in sys.modules:
        return sys.modules[qualified]
    for index in range(1, len(parts)):
        parent_name = f"{PACKAGE}." + ".".join(parts[:index])
        if parent_name not in sys.modules:
            parent = types.ModuleType(parent_name)
            parent.__path__ = [str(ADDON_ROOT.joinpath(*parts[:index]))]
            sys.modules[parent_name] = parent
    path = ADDON_ROOT.joinpath(*parts).with_suffix(".py")
    spec = importlib.util.spec_from_file_location(qualified, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[qualified] = module
    spec.loader.exec_module(module)
    return module
