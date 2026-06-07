from __future__ import annotations

import ctypes
import json
import sys
import time


VK_SHIFT = 0x10
VK_CONTROL = 0x11


def emit(event: str) -> None:
    sys.stdout.write(json.dumps({"type": "hotkey", "event": event}) + "\n")
    sys.stdout.flush()


def is_down(key: int) -> bool:
    return bool(ctypes.windll.user32.GetAsyncKeyState(key) & 0x8000)


def main() -> None:
    was_down = False
    while True:
        down = is_down(VK_CONTROL) and is_down(VK_SHIFT)
        if down and not was_down:
            emit("pressed")
        elif was_down and not down:
            emit("released")
        was_down = down
        time.sleep(0.025)


if __name__ == "__main__":
    main()
