"""Apply focus-independent Win32 blur to LocalFlow's own window."""
import ctypes
from ctypes import wintypes
import sys


def apply(handle, process_id, enabled):
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    owner = wintypes.DWORD()
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId(handle, ctypes.byref(owner))
    if owner.value != process_id:
        raise RuntimeError('Window does not belong to LocalFlow.')

    dwm = ctypes.WinDLL('dwmapi')
    dwm.DwmSetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
    corner = ctypes.c_int(2)
    result = dwm.DwmSetWindowAttribute(handle, 33, ctypes.byref(corner), ctypes.sizeof(corner))
    if result:
        raise OSError(f'Window corner preference failed: {result:#x}')

    class Accent(ctypes.Structure):
        _fields_ = [('state', ctypes.c_int), ('flags', ctypes.c_int),
                    ('color', wintypes.DWORD), ('animation', ctypes.c_int)]

    class Composition(ctypes.Structure):
        _fields_ = [('attribute', ctypes.c_int), ('data', ctypes.c_void_p), ('size', ctypes.c_size_t)]

    accent = Accent(4 if enabled else 0, 0, 0x01000000, 0)
    composition = Composition(19, ctypes.addressof(accent), ctypes.sizeof(accent))
    user32.SetWindowCompositionAttribute.argtypes = [wintypes.HWND, ctypes.POINTER(Composition)]
    user32.SetWindowCompositionAttribute.restype = wintypes.BOOL
    if not user32.SetWindowCompositionAttribute(handle, ctypes.byref(composition)):
        raise ctypes.WinError(ctypes.get_last_error())


if __name__ == '__main__':
    apply(int(sys.argv[1]), int(sys.argv[2]), sys.argv[3] == '1')
