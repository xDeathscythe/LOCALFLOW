"""Observe native paste input while swallowing it before it reaches other apps."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
import hotkey_watcher as native

captured = []


@native.HOOK_CALLBACK
def intercept(code, message, pointer):
    if code >= 0:
        data = ctypes.cast(pointer, ctypes.POINTER(native.KeyboardHookData)).contents
        if data.extra_info == native.LOCALFLOW_INJECTED_MARKER:
            captured.append((data.vk_code, message))
            return 1
    return native.user32.CallNextHookEx(None, code, message, pointer)


native.user32.PeekMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT]
handle = native.user32.SetWindowsHookExW(native.WH_KEYBOARD_LL, intercept, native.kernel32.GetModuleHandleW(None), 0)
assert handle, ctypes.WinError(ctypes.get_last_error())
child = None
events = queue.Queue()


def pump_until(check):
    deadline = time.monotonic() + 10
    message = wintypes.MSG()
    while not check():
        assert time.monotonic() < deadline, "Native input timed out"
        while native.user32.PeekMessageW(ctypes.byref(message), None, 0, 0, 1):
            native.user32.TranslateMessage(ctypes.byref(message))
            native.user32.DispatchMessageW(ctypes.byref(message))
        time.sleep(0.001)


def next_event():
    pump_until(lambda: not events.empty())
    return events.get_nowait()


try:
    # Installed after the interceptor, so the real watcher sees injected input first.
    child = subprocess.Popen(
        [sys.executable, str(root / "backend/hotkey_watcher.py")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW,
        env={**os.environ, "LOCALFLOW_SHORTCUTS_JSON": json.dumps({"dictation": {"keys": [17, 86], "label": "Ctrl + V"}})},
    )

    def read_events():
        for line in child.stdout:
            events.put(json.loads(line))

    threading.Thread(target=read_events, daemon=True).start()
    assert next_event()["type"] == "ready"
    times = []
    for request_id in ("first", "second"):
        captured.clear()
        started = time.perf_counter()
        child.stdin.write(json.dumps({"type": "paste", "id": request_id}) + "\n")
        child.stdin.flush()
        assert next_event() == {"type": "paste-result", "id": request_id, "ok": True}
        pump_until(lambda: len(captured) == 4)
        assert captured == [(0xA2, native.WM_KEYDOWN), (86, native.WM_KEYDOWN), (86, native.WM_KEYUP), (0xA2, native.WM_KEYUP)], captured
        times.append(round((time.perf_counter() - started) * 1000, 1))
    # A following command confirms no unwanted dictation event is queued.
    child.stdin.write('{"capture": false}\n')
    child.stdin.flush()
    assert next_event() == {"type": "capture-state", "active": False}
    print(json.dumps({"nativePasteInputMs": times, "workerPid": child.pid, "selfTriggeredHotkeys": 0}))
finally:
    if child:
        child.terminate()
        child.wait(timeout=10)
    native.user32.UnhookWindowsHookEx(handle)
