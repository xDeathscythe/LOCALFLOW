"""Paste the existing clipboard through the persistent keyboard helper."""
import ctypes
from ctypes import wintypes


class KeyboardInput(ctypes.Structure):
    _fields_ = [("key", wintypes.WORD), ("scan", wintypes.WORD),
                ("flags", wintypes.DWORD), ("time", wintypes.DWORD),
                ("extra", ctypes.c_size_t)]


class MouseInput(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG),
                ("data", wintypes.DWORD), ("flags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("extra", ctypes.c_size_t)]


class InputData(ctypes.Union):
    _fields_ = [("keyboard", KeyboardInput), ("mouse", MouseInput)]


class Input(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("data", InputData)]


def paste_clipboard(marker: int) -> None:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int]
    user32.SendInput.restype = wintypes.UINT
    # Preserve a physically held Ctrl key; tag our input so it cannot trigger dictation.
    control_held = bool(user32.GetAsyncKeyState(0x11) & 0x8000)
    keys = [(0x56, 0), (0x56, 2)]
    if not control_held:
        keys = [(0x11, 0), *keys, (0x11, 2)]
    events = (Input * len(keys))(*[
        Input(1, InputData(keyboard=KeyboardInput(key, 0, flags, 0, marker)))
        for key, flags in keys
    ])
    if user32.SendInput(len(events), events, ctypes.sizeof(Input)) != len(events):
        raise RuntimeError("Windows could not deliver paste input to the active window")
