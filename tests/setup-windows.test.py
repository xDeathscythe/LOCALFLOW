"""Installer preparation validates the automatic profile without host overrides."""
import importlib.util
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("setup_windows", root / "scripts/setup-windows.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
calls = []
worker = SimpleNamespace(
    warmup_model=lambda request: calls.append((request, os.environ["LOCALFLOW_WHISPER_MODEL"], os.environ["LOCALFLOW_WHISPER_DEVICE"])),
    reset_whisper_model=lambda: calls.append("reset"),
)
original_path = sys.path[:]
try:
    with patch.dict(os.environ, {"LOCALFLOW_WHISPER_MODEL": "absent-host-model", "LOCALFLOW_WHISPER_DEVICE": "cuda"}), \
         patch.dict(sys.modules, {"worker": worker}), \
         patch.object(setup, "exclude_from_windhawk") as exclude:
        setup.prepare(root)
        assert calls == [("installer", "large-v3", "auto"), "reset"]
        assert os.environ['PATH'].split(os.pathsep)[0] == str(root / 'runtime/cuda/bin')
        exclude.assert_called_once_with(str(root.parent / "LocalFlow.exe"))
    with patch.dict(os.environ), patch.dict(sys.modules, {"worker": worker}), \
         patch.object(worker, "warmup_model", side_effect=RuntimeError("missing dependency")), \
         patch.object(setup, "exclude_from_windhawk") as exclude:
        try:
            setup.prepare(root)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Setup must fail when model initialization fails")
        exclude.assert_not_called()
finally:
    sys.path[:] = original_path
print("INSTALLER_LARGE_HOST_ISOLATION_AND_FAILURE_OK")
