param([Parameter(Mandatory)][uint32]$NativeProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MeetingRegion {
    delegate bool Visitor(IntPtr window, IntPtr state);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visit, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr window, IntPtr region);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] static extern bool PtInRegion(IntPtr region, int x, int y);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr region);
    public static void Check(uint expected) {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        IntPtr window=IntPtr.Zero;
        EnumWindows((handle,state)=> { uint owner; GetWindowThreadProcessId(handle,out owner); var title=new StringBuilder(256); GetWindowText(handle,title,title.Capacity); if(owner==expected && title.ToString()=="LocalFlow Edge")window=handle; return true; },IntPtr.Zero);
        if(window==IntPtr.Zero)throw new Exception("Meeting notch unavailable");
        Rect bounds; if(!GetWindowRect(window,out bounds))throw new Exception("Meeting bounds unavailable");
        double scale=(bounds.bottom-bounds.top)/146.0;
        if(Math.Abs((bounds.right-bounds.left)/scale-320)>2)throw new Exception("Meeting notch must expand to 320 logical pixels");
        var region=CreateRectRgn(0,0,0,0);
        try {
            if(GetWindowRgn(window,region)==0)throw new Exception("No native hit region applied");
            foreach(var point in new[]{new[]{2,2},new[]{2,142},new[]{100,5}})if(PtInRegion(region,(int)(point[0]*scale),(int)(point[1]*scale)))throw new Exception("Transparent notch space intercepts clicks");
            foreach(var point in new[]{new[]{30,70},new[]{160,70},new[]{315,70}})if(!PtInRegion(region,(int)(point[0]*scale),(int)(point[1]*scale)))throw new Exception("Visible meeting controls must accept clicks");
        } finally { DeleteObject(region); }
    }
}
'@
[MeetingRegion]::Check($NativeProcessId)
Write-Output 'NATIVE_MEETING_HIT_REGION_OK'
