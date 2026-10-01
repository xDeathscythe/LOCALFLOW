"""Installer registry behavior without changing the host's Windhawk settings."""
import importlib.util
from pathlib import Path
from unittest.mock import patch, MagicMock
import winreg

spec = importlib.util.spec_from_file_location("setup", Path(__file__).resolve().parents[1] / "scripts/setup-windows.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
executable = r"C:\Program Files\LocalFlow\LocalFlow.exe"

with patch.object(winreg, "OpenKey", side_effect=FileNotFoundError), patch.object(winreg, "SetValueEx") as write:
    setup.exclude_from_windhawk(executable)
    write.assert_not_called()

for previous, expected in [("other.exe", "other.exe|" + executable), ("", executable),
                           ("other.exe|", "other.exe|" + executable), (executable.upper(), None)]:
    with patch.object(winreg, "OpenKey", return_value=MagicMock()), \
         patch.object(winreg, "QueryValueEx", side_effect=lambda key, name: (previous, winreg.REG_SZ) if name == 'ExcludeCustom' else (100, winreg.REG_DWORD)), \
         patch.object(winreg, "SetValueEx") as write:
        setup.exclude_from_windhawk(executable)
        if expected is None:
            write.assert_not_called()
        else:
            assert write.call_count == 4
            assert [call.args[-1] for call in write.call_args_list] == [expected, 101, expected, 101]

with patch.object(winreg, "OpenKey", side_effect=PermissionError):
    try:
        setup.exclude_from_windhawk(executable)
        raise AssertionError("Do not silently accept an incomplete installation")
    except PermissionError:
        pass
print("WINDOWS_SETUP_ABSENT_PRESERVED_IDEMPOTENT_PERMISSION_OK")
