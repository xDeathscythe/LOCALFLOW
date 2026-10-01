"""Offline installer preparation using only the bundled Python and model."""
import contextlib
import os
from pathlib import Path
import sys
import traceback
import winreg


def exclude_from_windhawk(executable):
    # ExcludeCustom survives mod updates; preserve every existing user rule.
    key_path = r"SOFTWARE\Windhawk\Engine\Mods\translucent-windows"
    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path, 0,
                                 winreg.KEY_READ | winreg.KEY_WRITE | view)
        except FileNotFoundError:
            continue
        with key:
            try:
                previous, kind = winreg.QueryValueEx(key, "ExcludeCustom")
                if kind != winreg.REG_SZ:
                    raise ValueError("Windhawk ExcludeCustom must be a string")
            except FileNotFoundError:
                previous = ""
            if executable.casefold() not in [rule.casefold() for rule in previous.split("|")]:
                winreg.SetValueEx(key, "ExcludeCustom", 0, winreg.REG_SZ,
                                 previous + ("|" if previous and not previous.endswith("|") else "") + executable)
                # Windhawk reloads mod configuration when this generation changes.
                try:
                    generation, _ = winreg.QueryValueEx(key, "SettingsChangeTime")
                except FileNotFoundError:
                    generation = 0
                winreg.SetValueEx(key, "SettingsChangeTime", 0, winreg.REG_DWORD,
                                 (generation + 1) & 0xFFFFFFFF)
            print(f"Windhawk exclusion ready: {executable}", flush=True)


def prepare(resources):
    # Ignore host Python/model settings: validate exactly what this installer ships.
    for name in list(os.environ):
        if name.startswith(("LOCALFLOW_", "HF_", "HUGGINGFACE_", "TRANSFORMERS_")):
            del os.environ[name]
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                      LOCALFLOW_WHISPER_DEVICE="cpu", LOCALFLOW_WHISPER_COMPUTE_TYPE="int8",
                      LOCALFLOW_WHISPER_DOWNLOAD_ROOT=str(resources / "models" / "whisper"))
    sys.path[:0] = [str(resources / "runtime" / "python-packages"), str(resources / "backend")]
    from worker import warmup_model
    warmup_model("installer")
    exclude_from_windhawk(str(resources.parent / "LocalFlow.exe"))
    print("LOCALFLOW_SETUP_READY", flush=True)


if __name__ == "__main__":
    resources = Path(__file__).resolve().parents[1]
    with (resources.parent / "setup.log").open("w", encoding="utf-8") as log:
        with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            try:
                prepare(resources)
            except Exception:
                traceback.print_exc()
                sys.exit(1)
