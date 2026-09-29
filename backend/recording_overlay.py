"""Antialiased Windows recording pill controlled through JSON lines on stdin."""

from __future__ import annotations

import ctypes
import json
import math
import queue
import sys
import threading
import time
from ctypes import wintypes


WIDTH = 144
HEIGHT = 42
PILL_COLOR = (9, 9, 9)
WHITE = (247, 247, 247)
MUTED = (169, 171, 177)
WAVE_HEIGHTS = (8, 13, 7, 16, 11, 18, 9, 15, 6, 14, 10, 17)
FADE_SECONDS = 0.09
MORPH_SECONDS = 0.34
TRANSITION_SECONDS = FADE_SECONDS + MORPH_SECONDS

WS_POPUP = 0x80000000
WS_EX_TOPMOST = 0x00000008
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_LAYERED = 0x00080000
WS_EX_NOACTIVATE = 0x08000000
SW_HIDE = 0
SW_SHOWNOACTIVATE = 4
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
WM_DESTROY = 0x0002
WM_LBUTTONDOWN = 0x0201
WM_TIMER = 0x0113
WM_APP_COMMAND = 0x8001
ULW_ALPHA = 0x00000002
AC_SRC_OVER = 0x00
AC_SRC_ALPHA = 0x01
BI_RGB = 0
DIB_RGB_COLORS = 0

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32
kernel32.GetModuleHandleW.restype = wintypes.HMODULE
user32.CreateWindowExW.restype = wintypes.HWND
user32.DefWindowProcW.restype = ctypes.c_ssize_t
user32.GetDC.restype = wintypes.HDC
user32.LoadCursorW.restype = wintypes.HANDLE
gdi32.CreateCompatibleDC.restype = wintypes.HDC
gdi32.CreateDIBSection.restype = wintypes.HBITMAP


class POINT(ctypes.Structure):
    _fields_ = (("x", wintypes.LONG), ("y", wintypes.LONG))


class SIZE(ctypes.Structure):
    _fields_ = (("cx", wintypes.LONG), ("cy", wintypes.LONG))


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = (
        ("BlendOp", ctypes.c_byte),
        ("BlendFlags", ctypes.c_byte),
        ("SourceConstantAlpha", ctypes.c_byte),
        ("AlphaFormat", ctypes.c_byte),
    )


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = (
        ("biSize", wintypes.DWORD),
        ("biWidth", wintypes.LONG),
        ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", wintypes.LONG),
        ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    )


class BITMAPINFO(ctypes.Structure):
    _fields_ = (("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3))


WNDPROC = ctypes.WINFUNCTYPE(
    ctypes.c_ssize_t,
    wintypes.HWND,
    wintypes.UINT,
    wintypes.WPARAM,
    wintypes.LPARAM,
)


class WNDCLASS(ctypes.Structure):
    _fields_ = (
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    )


class MSG(ctypes.Structure):
    _fields_ = (
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", POINT),
    )


kernel32.GetModuleHandleW.argtypes = (wintypes.LPCWSTR,)
user32.CreateWindowExW.argtypes = (
    wintypes.DWORD,
    wintypes.LPCWSTR,
    wintypes.LPCWSTR,
    wintypes.DWORD,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.HWND,
    wintypes.HMENU,
    wintypes.HINSTANCE,
    ctypes.c_void_p,
)
user32.RegisterClassW.argtypes = (ctypes.POINTER(WNDCLASS),)
user32.RegisterClassW.restype = wintypes.WORD
user32.DefWindowProcW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
user32.GetDC.argtypes = (wintypes.HWND,)
user32.ReleaseDC.argtypes = (wintypes.HWND, wintypes.HDC)
user32.LoadCursorW.argtypes = (wintypes.HINSTANCE, ctypes.c_void_p)
user32.PostMessageW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
user32.DestroyWindow.argtypes = (wintypes.HWND,)
user32.ShowWindow.argtypes = (wintypes.HWND, ctypes.c_int)
user32.SetWindowPos.argtypes = (
    wintypes.HWND,
    wintypes.HWND,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.UINT,
)
user32.SetTimer.argtypes = (wintypes.HWND, ctypes.c_size_t, wintypes.UINT, ctypes.c_void_p)
user32.KillTimer.argtypes = (wintypes.HWND, ctypes.c_size_t)
user32.UpdateLayeredWindow.argtypes = (
    wintypes.HWND,
    wintypes.HDC,
    ctypes.POINTER(POINT),
    ctypes.POINTER(SIZE),
    wintypes.HDC,
    ctypes.POINTER(POINT),
    wintypes.DWORD,
    ctypes.POINTER(BLENDFUNCTION),
    wintypes.DWORD,
)
user32.GetMessageW.argtypes = (ctypes.POINTER(MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT)
user32.TranslateMessage.argtypes = (ctypes.POINTER(MSG),)
user32.DispatchMessageW.argtypes = (ctypes.POINTER(MSG),)
gdi32.CreateCompatibleDC.argtypes = (wintypes.HDC,)
gdi32.CreateDIBSection.argtypes = (
    wintypes.HDC,
    ctypes.POINTER(BITMAPINFO),
    wintypes.UINT,
    ctypes.POINTER(ctypes.c_void_p),
    wintypes.HANDLE,
    wintypes.DWORD,
)
gdi32.SelectObject.argtypes = (wintypes.HDC, wintypes.HANDLE)
gdi32.DeleteObject.argtypes = (wintypes.HANDLE,)
gdi32.DeleteDC.argtypes = (wintypes.HDC,)


GLYPHS = {
    "0": ("111", "101", "101", "101", "111"),
    "1": ("010", "110", "010", "010", "111"),
    "2": ("111", "001", "111", "100", "111"),
    "3": ("111", "001", "111", "001", "111"),
    "4": ("101", "101", "111", "001", "001"),
    "5": ("111", "100", "111", "001", "111"),
    "6": ("111", "100", "111", "101", "111"),
    "7": ("111", "001", "010", "010", "010"),
    "8": ("111", "101", "111", "101", "111"),
    "9": ("111", "101", "111", "001", "111"),
    ":": ("0", "1", "0", "1", "0"),
}


class RecordingOverlay:
    def __init__(self) -> None:
        self.commands: queue.Queue[dict[str, object]] = queue.Queue()
        self.hwnd = wintypes.HWND()
        self.visible = False
        self.elapsed_seconds = 0
        self.animation_frame = 0
        self.transition_position = 0.0
        self.transition_direction = 0
        self.last_tick = time.monotonic()
        self.window_x = 0
        self.window_y = 0
        self._window_proc = WNDPROC(self.window_proc)
        self._bitmap = wintypes.HBITMAP()
        self._memory_dc = wintypes.HDC()
        self._bits = ctypes.c_void_p()
        self._pill_cache: dict[int, bytearray] = {}
        self.starting = False
        self._last_frame = None

    @staticmethod
    def coverage(distance: float) -> float:
        return max(0.0, min(1.0, 0.5 - distance))

    @staticmethod
    def smoothstep(value: float) -> float:
        value = max(0.0, min(1.0, value))
        return value * value * (3 - 2 * value)

    @classmethod
    def animation_values(cls, position: float) -> tuple[float, float]:
        opacity = max(0.0, min(1.0, position / FADE_SECONDS))
        morph = cls.smoothstep((position - FADE_SECONDS) / MORPH_SECONDS)
        return morph, opacity

    def make_base_pixels(self, pill_width: int) -> bytearray:
        pixels = bytearray(WIDTH * HEIGHT * 4)
        radius = HEIGHT / 2
        half_width = pill_width / 2
        for y in range(HEIGHT):
            for x in range(WIDTH):
                px = x + 0.5
                py = y + 0.5
                qx = abs(px - WIDTH / 2) - (half_width - radius)
                qy = abs(py - HEIGHT / 2)
                distance = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - radius
                alpha = round(255 * self.coverage(distance))
                offset = (y * WIDTH + x) * 4
                for channel in range(3):
                    pixels[offset + channel] = round(PILL_COLOR[channel] * alpha / 255)
                pixels[offset + 3] = alpha
        return pixels

    def pill_pixels(self, pill_width: int) -> bytearray:
        pill_width = max(HEIGHT, min(WIDTH, pill_width))
        if pill_width not in self._pill_cache:
            self._pill_cache[pill_width] = self.make_base_pixels(pill_width)
        return self._pill_cache[pill_width]

    @staticmethod
    def blend_pixel(pixels: bytearray, x: int, y: int, color: tuple[int, int, int], coverage: float) -> None:
        if coverage <= 0 or x < 0 or x >= WIDTH or y < 0 or y >= HEIGHT:
            return
        offset = (y * WIDTH + x) * 4
        mask_alpha = pixels[offset + 3] / 255
        if mask_alpha <= 0:
            return
        source_alpha = max(0.0, min(1.0, coverage))
        inverse = 1.0 - source_alpha
        blue, green, red = color[2], color[1], color[0]
        pixels[offset] = round(blue * source_alpha * mask_alpha + pixels[offset] * inverse)
        pixels[offset + 1] = round(green * source_alpha * mask_alpha + pixels[offset + 1] * inverse)
        pixels[offset + 2] = round(red * source_alpha * mask_alpha + pixels[offset + 2] * inverse)

    def draw_circle(self, pixels: bytearray, center_x: float, center_y: float, radius: float, color: tuple[int, int, int], opacity: float = 1.0) -> None:
        for y in range(max(0, math.floor(center_y - radius - 1)), min(HEIGHT, math.ceil(center_y + radius + 1))):
            for x in range(max(0, math.floor(center_x - radius - 1)), min(WIDTH, math.ceil(center_x + radius + 1))):
                distance = math.hypot(x + 0.5 - center_x, y + 0.5 - center_y) - radius
                self.blend_pixel(pixels, x, y, color, self.coverage(distance) * opacity)

    def draw_capsule(self, pixels: bytearray, center_x: float, top: float, bottom: float, radius: float, color: tuple[int, int, int] = WHITE, opacity: float = 1.0) -> None:
        for y in range(max(0, math.floor(top - 1)), min(HEIGHT, math.ceil(bottom + 1))):
            nearest_y = max(top + radius, min(y + 0.5, bottom - radius))
            for x in range(max(0, math.floor(center_x - radius - 1)), min(WIDTH, math.ceil(center_x + radius + 1))):
                distance = math.hypot(x + 0.5 - center_x, y + 0.5 - nearest_y) - radius
                self.blend_pixel(pixels, x, y, color, self.coverage(distance) * opacity)

    def draw_rectangle(self, pixels: bytearray, left: int, top: int, right: int, bottom: int, color: tuple[int, int, int], opacity: float) -> None:
        for y in range(top, bottom):
            for x in range(left, right):
                self.blend_pixel(pixels, x, y, color, opacity)

    def draw_microphone(self, pixels: bytearray, center_x: float, opacity: float) -> None:
        center = round(center_x)
        self.draw_capsule(pixels, center_x, 10, 23, 3, WHITE, opacity)
        self.draw_capsule(pixels, center_x - 5, 17, 25, 1, WHITE, opacity)
        self.draw_capsule(pixels, center_x + 5, 17, 25, 1, WHITE, opacity)
        self.draw_rectangle(pixels, center - 5, 23, center + 6, 25, WHITE, opacity)
        self.draw_capsule(pixels, center_x, 24, 29, 1, WHITE, opacity)
        self.draw_rectangle(pixels, center - 4, 28, center + 5, 30, WHITE, opacity)

    def draw_timer(self, pixels: bytearray, opacity: float) -> None:
        minutes, seconds = divmod(self.elapsed_seconds, 60)
        text = f"{minutes % 100:02d}:{seconds:02d}"
        cursor_x = 96
        top = 16
        for character in text:
            glyph = GLYPHS[character]
            for row, pattern in enumerate(glyph):
                for column, value in enumerate(pattern):
                    if value == "1":
                        for dy in range(2):
                            for dx in range(2):
                                self.blend_pixel(pixels, cursor_x + column * 2 + dx, top + row * 2 + dy, MUTED, opacity)
            cursor_x += (len(glyph[0]) + 1) * 2

    def render(self) -> None:
        morph, window_opacity = self.animation_values(self.transition_position)
        if self.starting:
            morph = 0.0
        pill_width = round(HEIGHT + (WIDTH - HEIGHT) * morph)
        pixels = self.pill_pixels(pill_width).copy()
        control_x = 72 + (21 - 72) * morph
        microphone_opacity = 1 - self.smoothstep(morph / 0.5)
        stop_opacity = self.smoothstep((morph - 0.35) / 0.35)
        content_opacity = self.smoothstep((morph - 0.25) / 0.55)

        if microphone_opacity:
            self.draw_microphone(pixels, control_x, microphone_opacity)
        if stop_opacity:
            self.draw_circle(pixels, control_x, 21, 8, WHITE, stop_opacity)

        for index, base_height in enumerate(WAVE_HEIGHTS if content_opacity else ()):
            phase = (index + self.animation_frame) % len(WAVE_HEIGHTS)
            height = max(3, base_height - abs(phase - 5) * 2)
            center_x = 42 + index * 3
            self.draw_capsule(pixels, center_x, 21 - height / 2, 21 + height / 2, 1, WHITE, content_opacity)

        if content_opacity:
            self.draw_timer(pixels, content_opacity)
        ctypes.memmove(self._bits, bytes(pixels), len(pixels))
        source = POINT(0, 0)
        position = POINT(self.window_x, self.window_y)
        size = SIZE(WIDTH, HEIGHT)
        blend = BLENDFUNCTION(AC_SRC_OVER, 0, round(255 * window_opacity), AC_SRC_ALPHA)
        user32.UpdateLayeredWindow(
            self.hwnd,
            0,
            ctypes.byref(position),
            ctypes.byref(size),
            self._memory_dc,
            ctypes.byref(source),
            0,
            ctypes.byref(blend),
            ULW_ALPHA,
        )

    def show(self) -> None:
        if not self.visible:
            self.visible = True
            self._last_frame = None
            self.transition_position = 0.0
            self.render()
            user32.SetWindowPos(
                self.hwnd,
                wintypes.HWND(-1),
                self.window_x,
                self.window_y,
                WIDTH,
                HEIGHT,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
            user32.ShowWindow(self.hwnd, SW_SHOWNOACTIVATE)
        if self.transition_position < TRANSITION_SECONDS and self.transition_direction != 1:
            self.transition_direction = 1
            self.last_tick = time.monotonic()
            user32.SetTimer(self.hwnd, 1, 33, 0)

    def close(self) -> None:
        if self.visible and self.transition_direction != -1:
            self.transition_direction = -1
            self.last_tick = time.monotonic()
            user32.SetTimer(self.hwnd, 1, 33, 0)

    def animate(self) -> None:
        now = time.monotonic()
        elapsed = now - self.last_tick
        self.last_tick = now
        if self.transition_direction:
            self.transition_position = max(
                0.0,
                min(TRANSITION_SECONDS, self.transition_position + self.transition_direction * elapsed),
            )
            if self.transition_position >= TRANSITION_SECONDS:
                self.transition_direction = 0
                user32.SetTimer(self.hwnd, 1, 90, 0)
            elif self.transition_position <= 0:
                self.transition_direction = 0
                self.visible = False
                user32.KillTimer(self.hwnd, 1)
                user32.ShowWindow(self.hwnd, SW_HIDE)
                return
        self.animation_frame = int(now / 0.09) % len(WAVE_HEIGHTS)
        frame = (self.transition_position, self.starting, 0 if self.starting else self.animation_frame, self.elapsed_seconds, self.window_x, self.window_y)
        if frame == self._last_frame:
            return
        self._last_frame = frame
        self.render()

    def apply_commands(self) -> None:
        try:
            while True:
                command = self.commands.get_nowait()
                if command.get("type") == "quit":
                    user32.DestroyWindow(self.hwnd)
                    return
                self.elapsed_seconds = max(0, int(command.get("elapsedSeconds", 0)))
                starting = command.get("starting") is True
                if self.starting and not starting and self.visible:
                    self.transition_position = FADE_SECONDS
                    self.transition_direction = 0
                self.starting = starting
                self.window_x = int(command.get("x", 0))
                self.window_y = int(command.get("y", 0))
                should_show = command.get("visible") is True
                if should_show:
                    self.show()
                elif self.visible:
                    self.close()
        except queue.Empty:
            return

    def stop(self) -> None:
        if not self.visible:
            return
        self.close()
        print(json.dumps({"type": "stop"}), flush=True)

    def window_proc(self, hwnd: int, message: int, wparam: int, lparam: int) -> int:
        if message == WM_APP_COMMAND:
            self.apply_commands()
            return 0
        if message == WM_TIMER:
            if self.visible:
                self.animate()
            return 0
        if message == WM_LBUTTONDOWN:
            self.stop()
            return 0
        if message == WM_DESTROY:
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, message, wparam, lparam)

    def read_commands(self) -> None:
        for line in sys.stdin:
            try:
                command = json.loads(line)
            except (TypeError, ValueError):
                continue
            if isinstance(command, dict):
                self.commands.put(command)
                if self.hwnd:
                    user32.PostMessageW(self.hwnd, WM_APP_COMMAND, 0, 0)
        self.commands.put({"type": "quit"})
        if self.hwnd:
            user32.PostMessageW(self.hwnd, WM_APP_COMMAND, 0, 0)

    def create_bitmap(self) -> None:
        screen_dc = user32.GetDC(0)
        self._memory_dc = gdi32.CreateCompatibleDC(screen_dc)
        info = BITMAPINFO()
        info.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        info.bmiHeader.biWidth = WIDTH
        info.bmiHeader.biHeight = -HEIGHT
        info.bmiHeader.biPlanes = 1
        info.bmiHeader.biBitCount = 32
        info.bmiHeader.biCompression = BI_RGB
        self._bitmap = gdi32.CreateDIBSection(screen_dc, ctypes.byref(info), DIB_RGB_COLORS, ctypes.byref(self._bits), 0, 0)
        gdi32.SelectObject(self._memory_dc, self._bitmap)
        user32.ReleaseDC(0, screen_dc)

    def run(self) -> None:
        instance = kernel32.GetModuleHandleW(None)
        class_name = "LocalFlowRecordingOverlay"
        window_class = WNDCLASS()
        window_class.lpfnWndProc = self._window_proc
        window_class.hInstance = instance
        window_class.hCursor = user32.LoadCursorW(0, 32649)
        window_class.lpszClassName = class_name
        if not user32.RegisterClassW(ctypes.byref(window_class)):
            raise ctypes.WinError()

        self.hwnd = user32.CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_NOACTIVATE,
            class_name,
            "LocalFlow Recording",
            WS_POPUP,
            0,
            0,
            WIDTH,
            HEIGHT,
            0,
            0,
            instance,
            0,
        )
        if not self.hwnd:
            raise ctypes.WinError()

        self.create_bitmap()
        threading.Thread(target=self.read_commands, daemon=True).start()
        self.apply_commands()

        message = MSG()
        while user32.GetMessageW(ctypes.byref(message), 0, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))

        if self._bitmap:
            gdi32.DeleteObject(self._bitmap)
        if self._memory_dc:
            gdi32.DeleteDC(self._memory_dc)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        assert RecordingOverlay.animation_values(0) == (0.0, 0.0)
        assert RecordingOverlay.animation_values(FADE_SECONDS)[0] == 0.0
        assert RecordingOverlay.animation_values(TRANSITION_SECONDS) == (1.0, 1.0)
        print("recording-overlay animation check passed")
    else:
        RecordingOverlay().run()
