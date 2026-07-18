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
    qualified = f"{PACKAGE}.{name}"
    if qualified in sys.modules:
        return sys.modules[qualified]
    spec = importlib.util.spec_from_file_location(qualified, ADDON_ROOT / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[qualified] = module
    spec.loader.exec_module(module)
    return module
