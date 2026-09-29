"""Measure the real Windows overlay without activating it or using the microphone."""
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import subprocess
import sys
import time

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
kernel32.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(ctypes.c_ulonglong)] * 4
callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]

child = subprocess.Popen([sys.executable, str(Path(__file__).resolve().parents[1] / "backend" / "recording_overlay.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
hwnd = None

@callback_type
def find_window(handle, _):
    global hwnd
    process_id = wintypes.DWORD()
    user32.GetWindowThreadProcessId(handle, ctypes.byref(process_id))
    name = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(handle, name, len(name))
    if process_id.value == child.pid and name.value == "LocalFlowRecordingOverlay":
        hwnd = handle
        return False
    return True

def wait_for(check):
    deadline = time.monotonic() + 5
    while not check():
        assert child.poll() is None, "Overlay process exited"
        assert time.monotonic() < deadline, "Overlay did not respond"
        time.sleep(0.005)

def cpu_seconds():
    times = [ctypes.c_ulonglong() for _ in range(4)]
    assert kernel32.GetProcessTimes(int(child._handle), *(ctypes.byref(value) for value in times))
    return (times[2].value + times[3].value) / 10_000_000

def send(payload):
    child.stdin.write(json.dumps(payload) + "\n")
    child.stdin.flush()

try:
    wait_for(lambda: (user32.EnumWindows(find_window, 0), hwnd)[1])
    idle_start = cpu_seconds()
    time.sleep(2)
    idle_cpu_ms = round((cpu_seconds() - idle_start) * 1000, 2)
    feedback = []
    for _ in range(3):
        started = time.perf_counter()
        send({"visible": True, "starting": True, "x": 20, "y": 20})
        wait_for(lambda: user32.IsWindowVisible(hwnd))
        feedback.append(round((time.perf_counter() - started) * 1000, 1))
        time.sleep(0.1)
        send({"visible": True, "starting": False, "elapsedSeconds": 1, "x": 20, "y": 20})
        time.sleep(0.5)
        send({"visible": False})
        wait_for(lambda: not user32.IsWindowVisible(hwnd))
    assert max(feedback) < 500
    assert idle_cpu_ms < 50
    print(json.dumps({"nativeOverlayShowMs": feedback, "hiddenCpuMsOver2Seconds": idle_cpu_ms}))
finally:
    send({"type": "quit"})
    child.wait(timeout=5)
    assert child.returncode == 0, child.stderr.read()
