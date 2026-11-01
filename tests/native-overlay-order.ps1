param([Parameter(Mandatory)][uint32]$NativeProcessId,
    [ValidateSet('edge', 'recording')][string]$Surface = 'edge', [switch]$Hidden)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OverlayOrder {
    delegate bool Visitor(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visit, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    public static void Check(uint expected, string title, bool hidden) {
        bool found = false, ordinaryAbove = false;
        EnumWindows((window, state) => {
            uint pid; GetWindowThreadProcessId(window, out pid);
            int style = GetWindowLong(window, -20);
            var text = new StringBuilder(256); GetWindowText(window, text, text.Capacity);
            if (pid == expected && text.ToString() == title) {
                found = true;
                if (hidden) {
                    if (IsWindowVisible(window)) throw new Exception("Disabled overlay must be hidden");
                    return false;
                }
                if (!IsWindowVisible(window)) throw new Exception("Overlay must be visible");
                if ((style & 8) == 0) throw new Exception("Overlay must retain WS_EX_TOPMOST");
                if ((style & 0x08000000) == 0) throw new Exception("Overlay must retain WS_EX_NOACTIVATE; style=" + style.ToString("X8"));
                if (window == GetForegroundWindow()) throw new Exception("Overlay must not take keyboard focus");
                if (ordinaryAbove) throw new Exception("Overlay is below an ordinary window despite WS_EX_TOPMOST");
                return false;
            }
            ordinaryAbove |= IsWindowVisible(window) && !IsIconic(window) && (style & 8) == 0;
            return true;
        }, IntPtr.Zero);
        if (!found) throw new Exception("Owned overlay unavailable: " + title);
    }
}
'@
[OverlayOrder]::Check($NativeProcessId, $(if ($Surface -eq 'edge') { 'LocalFlow Edge' } else { 'LocalFlow dictation' }), [bool]$Hidden)
Write-Output "NATIVE_OVERLAY_ORDER_OK $Surface"
