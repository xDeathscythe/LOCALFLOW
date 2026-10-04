from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import os
import queue
import sys
import threading
from paste_input import paste_clipboard


WH_KEYBOARD_LL = 13
WH_MOUSE_LL = 14
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_SYSKEYDOWN = 0x0104
WM_SYSKEYUP = 0x0105
WM_XBUTTONDOWN = 0x020B
WM_XBUTTONUP = 0x020C
VK_SHIFT = 0x10
VK_CONTROL = 0x11
VK_MENU = 0x12
VK_CAPITAL = 0x14
VK_XBUTTON1 = 0x05
VK_XBUTTON2 = 0x06
KEYEVENTF_KEYUP = 0x0002
LOCALFLOW_INJECTED_MARKER = 0x4C464C57
MODIFIER_SIDES = {
    VK_SHIFT: {0xA0, 0xA1},
    VK_CONTROL: {0xA2, 0xA3},
    VK_MENU: {0xA4, 0xA5},
}
DEFAULT_SHORTCUTS = {
    "dictation": {"keys": [0x11, 0x10], "label": "Ctrl + Shift"},
    "import-audio": {"keys": [0x11, 0x4F], "label": "Ctrl + O"},
    "reset-session": {"keys": [0x11, 0x52], "label": "Ctrl + R"},
    "niwa-agent": {"keys": [0x11, 0x14], "label": "Ctrl + Caps Lock"},
}
output = queue.SimpleQueue()


def emit(event: str, action: str, label: str) -> None:
    output.put({"type": "hotkey", "event": event, "action": action, "hotkey": label})


class KeyboardHookData(ctypes.Structure):
    _fields_ = [
        ("vk_code", wintypes.DWORD),
        ("scan_code", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("extra_info", ctypes.c_size_t),
    ]


class MouseHookData(ctypes.Structure):
    _fields_ = [
        ("point", wintypes.POINT),
        ("mouse_data", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("extra_info", ctypes.c_size_t),
    ]


HOOK_CALLBACK = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOK_CALLBACK, wintypes.HINSTANCE, wintypes.DWORD]
user32.SetWindowsHookExW.restype = wintypes.HANDLE
user32.CallNextHookEx.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
user32.CallNextHookEx.restype = ctypes.c_ssize_t
user32.UnhookWindowsHookEx.argtypes = [wintypes.HANDLE]
user32.UnhookWindowsHookEx.restype = wintypes.BOOL
user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
user32.GetMessageW.restype = ctypes.c_int
user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
kernel32.GetModuleHandleW.restype = wintypes.HMODULE


def tap_key(key: int) -> None:
    user32.keybd_event(key, 0, 0, LOCALFLOW_INJECTED_MARKER)
    user32.keybd_event(key, 0, KEYEVENTF_KEYUP, LOCALFLOW_INJECTED_MARKER)


def normalize_shortcuts(value: object) -> list[tuple[str, str, tuple[int, ...]]]:
    source = value if isinstance(value, dict) else DEFAULT_SHORTCUTS
    shortcuts: list[tuple[str, str, tuple[int, ...]]] = []
    actions = list(DEFAULT_SHORTCUTS)
    for action in actions:
        binding = source.get(action) if isinstance(source, dict) else None
        if binding is None:
            binding = DEFAULT_SHORTCUTS.get(action)
        keys = binding.get("keys") if isinstance(binding, dict) else None
        label = binding.get("label") if isinstance(binding, dict) else None
        if not isinstance(keys, list) or not keys or not all(isinstance(key, int) and 0 < key <= 0xFF for key in keys):
            if action not in DEFAULT_SHORTCUTS:
                continue
            binding = DEFAULT_SHORTCUTS[action]
            keys = binding["keys"]
            label = binding["label"]
        shortcuts.append((action, str(label or action), tuple(dict.fromkeys(keys))))
    return shortcuts


def load_shortcuts() -> list[tuple[str, str, tuple[int, ...]]]:
    try:
        return normalize_shortcuts(json.loads(os.environ.get("LOCALFLOW_SHORTCUTS_JSON", "")))
    except (TypeError, ValueError):
        return normalize_shortcuts(DEFAULT_SHORTCUTS)


def effective_down_keys(physical_keys: set[int]) -> set[int]:
    keys = set(physical_keys)
    for generic, sides in MODIFIER_SIDES.items():
        if keys.intersection(sides):
            keys.add(generic)
    return keys


def current_action(shortcuts: list[tuple[str, str, tuple[int, ...]]], down_keys: set[int]) -> tuple[str, str, tuple[int, ...]] | None:
    matches = [shortcut for shortcut in shortcuts if all(key in down_keys for key in shortcut[2])]
    return max(matches, key=lambda shortcut: len(shortcut[2]), default=None)


def restore_caps_after_shortcut(keys: tuple[int, ...]) -> None:
    if VK_CAPITAL not in keys:
        return
    threading.Timer(0.04, tap_key, args=(VK_CAPITAL,)).start()


def main() -> None:
    shortcuts = load_shortcuts()
    physical_keys: set[int] = set()
    active: tuple[str, str, tuple[int, ...]] | None = None
    capture_mode = threading.Event()
    if os.environ.get("LOCALFLOW_SHORTCUT_CAPTURE") == "1":
        capture_mode.set()

    # Never wait on the host's stdout pipe inside a Windows input hook.
    def write_events() -> None:
        while True:
            print(json.dumps(output.get()), flush=True)

    def read_commands() -> None:
        nonlocal shortcuts
        for line in sys.stdin:
            try:
                command = json.loads(line)
            except (TypeError, ValueError):
                continue
            if not isinstance(command, dict):
                continue
            if command.get("type") == "paste":
                try:
                    paste_clipboard(LOCALFLOW_INJECTED_MARKER)
                    output.put({"type": "paste-result", "id": command.get("id"), "ok": True})
                except Exception as error:
                    output.put({"type": "paste-result", "id": command.get("id"), "ok": False, "error": str(error)})
            if isinstance(command.get("shortcuts"), dict):
                shortcuts = normalize_shortcuts(command["shortcuts"])
            if isinstance(command.get("capture"), bool):
                if command["capture"]:
                    capture_mode.set()
                else:
                    capture_mode.clear()
                output.put({"type": "capture-state", "active": capture_mode.is_set()})

    def update_active() -> None:
        nonlocal active
        if capture_mode.is_set():
            active = None
            return
        now = current_action(shortcuts, effective_down_keys(physical_keys))
        if now != active:
            if active is not None:
                emit("released", active[0], active[1])
                restore_caps_after_shortcut(active[2])
            if now is not None:
                emit("pressed", now[0], now[1])
            active = now

    @HOOK_CALLBACK
    def keyboard_hook(code: int, message: int, data_pointer: int) -> int:
        if code >= 0:
            data = ctypes.cast(data_pointer, ctypes.POINTER(KeyboardHookData)).contents
            if data.extra_info != LOCALFLOW_INJECTED_MARKER:
                if message in (WM_KEYDOWN, WM_SYSKEYDOWN):
                    physical_keys.add(data.vk_code)
                    update_active()
                elif message in (WM_KEYUP, WM_SYSKEYUP):
                    physical_keys.discard(data.vk_code)
                    update_active()
        return user32.CallNextHookEx(None, code, message, data_pointer)

    @HOOK_CALLBACK
    def mouse_hook(code: int, message: int, data_pointer: int) -> int:
        if code >= 0 and message in (WM_XBUTTONDOWN, WM_XBUTTONUP):
            data = ctypes.cast(data_pointer, ctypes.POINTER(MouseHookData)).contents
            key = VK_XBUTTON1 if (data.mouse_data >> 16) & 0xFFFF == 1 else VK_XBUTTON2
            if capture_mode.is_set():
                if message == WM_XBUTTONDOWN:
                    binding = {"keys": [key], "label": "Mouse Back" if key == VK_XBUTTON1 else "Mouse Forward"}
                    output.put({"type": "shortcut-captured", "binding": binding})
                return 1
            was_assigned = active is not None and key in active[2]
            if message == WM_XBUTTONDOWN:
                physical_keys.add(key)
            else:
                physical_keys.discard(key)
            update_active()
            if was_assigned or (active is not None and key in active[2]):
                return 1
        return user32.CallNextHookEx(None, code, message, data_pointer)

    module = kernel32.GetModuleHandleW(None)
    keyboard_handle = user32.SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_hook, module, 0)
    if not keyboard_handle:
        raise ctypes.WinError(ctypes.get_last_error())
    # The editor must receive side buttons before any mouse shortcut is assigned.
    mouse_handle = user32.SetWindowsHookExW(WH_MOUSE_LL, mouse_hook, module, 0)
    if not mouse_handle:
        user32.UnhookWindowsHookEx(keyboard_handle)
        raise ctypes.WinError(ctypes.get_last_error())

    try:
        threading.Thread(target=write_events, daemon=True).start()
        threading.Thread(target=read_commands, daemon=True).start()
        output.put({"type": "ready"})
        message = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))
    finally:
        if mouse_handle:
            user32.UnhookWindowsHookEx(mouse_handle)
        user32.UnhookWindowsHookEx(keyboard_handle)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        configured = normalize_shortcuts({
            "dictation": {"keys": [5], "label": "Mouse Back"},
            "niwa-agent": {"keys": [0x11, VK_CAPITAL], "label": "Ctrl + Caps Lock"},
        })
        assert configured[0] == ("dictation", "Mouse Back", (5,))
        assert configured[-1] == ("niwa-agent", "Ctrl + Caps Lock", (0x11, VK_CAPITAL))
        assert effective_down_keys({0xA2, 0xA0}) >= {VK_CONTROL, VK_SHIFT}
        assert current_action(configured, {VK_XBUTTON1}) == configured[0]
        print("hotkey watcher config check passed")
    else:
        main()
