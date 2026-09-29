"""Exercise actual Windows side-button hooks without opening the microphone."""
import ctypes
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading


root = Path(__file__).resolve().parents[1]
config = {"dictation": {"keys": [5], "label": "Mouse Back"}}
child = subprocess.Popen(
    [sys.executable, str(root / "backend" / "hotkey_watcher.py")],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, encoding="utf-8",
    env={**os.environ, "LOCALFLOW_SHORTCUTS_JSON": json.dumps(config), "LOCALFLOW_SHORTCUT_CAPTURE": "0"},
    creationflags=subprocess.CREATE_NO_WINDOW,
)
events = queue.Queue()


def read_events():
    for line in child.stdout:
        events.put(json.loads(line))


threading.Thread(target=read_events, daemon=True).start()


def expect(**fields):
    event = events.get(timeout=10)
    assert all(event.get(key) == value for key, value in fields.items()), event
    return event


def capture(active):
    child.stdin.write(json.dumps({"capture": active}) + "\n")
    child.stdin.flush()
    expect(type="capture-state", active=active)


def button(number, down):
    ctypes.windll.user32.mouse_event(0x0080 if down else 0x0100, 0, 0, number, 0)


try:
    expect(type="ready")
    for number, key, label in ((1, 5, "Mouse Back"), (2, 6, "Mouse Forward")):
        capture(True)
        button(number, True)
        expect(type="shortcut-captured", binding={"keys": [key], "label": label})
        button(number, False)
        # The acknowledgement also verifies no dictation event escaped capture mode.
        capture(False)
        button(1, True)
        expect(type="hotkey", event="pressed", action="dictation")
        button(1, False)
        expect(type="hotkey", event="released", action="dictation")
    print("Native mouse capture and dictation press/release passed")
finally:
    child.terminate()
    child.wait(timeout=10)
