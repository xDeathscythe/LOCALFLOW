param([Parameter(Mandatory)][uint32]$NativeProcessId, [switch]$Opaque,
    [ValidateSet('main','edge','recording')][string]$Surface = 'main',
    [string]$WindowTitle, [string]$ImagePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Windows.Forms;

public class MaterialBackdrop : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get { var value = base.CreateParams; value.ExStyle |= 0x08000080; return value; }
    }
}
public class LocalFlowMaterialCheck {
    delegate bool Visitor(IntPtr handle, IntPtr state);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visit, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr handle, out Rect rect);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr handle, int attribute, out Rect rect, int size);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr handle);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr handle, IntPtr dc);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("gdi32.dll")] static extern uint GetPixel(IntPtr dc, int x, int y);
    static void Paint() { Application.DoEvents(); Thread.Sleep(400); Application.DoEvents(); }
    static void Focus(IntPtr window) {
        uint owner;uint current=GetCurrentThreadId(),foreground=GetWindowThreadProcessId(GetForegroundWindow(),out owner);
        bool attached=current!=foreground&&AttachThreadInput(current,foreground,true);
        try { if(!SetForegroundWindow(window))throw new Exception("Could not focus the material fixture"); }
        finally { if(attached)AttachThreadInput(current,foreground,false); }
    }
    static int[] Pixel(int x, int y) {
        var dc = GetDC(IntPtr.Zero);
        try { var value=GetPixel(dc,x,y); if(value==0xffffffff)throw new Exception("Desktop pixel unavailable");return new[]{(int)(value&255),(int)((value>>8)&255),(int)((value>>16)&255)}; }
        finally { ReleaseDC(IntPtr.Zero,dc); }
    }
    static void Capture(Rect rect, string image, int margin=0) {
        if(!string.IsNullOrEmpty(image))using(var shot=new Bitmap(rect.right-rect.left+margin*2,rect.bottom-rect.top+margin*2))using(var graphics=Graphics.FromImage(shot)) {
            graphics.CopyFromScreen(rect.left-margin,rect.top-margin,0,0,shot.Size);shot.Save(image,System.Drawing.Imaging.ImageFormat.Png);
        }
    }
    public static int[][] Run(uint expected, bool opaque, string image) {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        IntPtr main=IntPtr.Zero, previous=GetForegroundWindow();
        EnumWindows((handle,state)=>{ uint owner;GetWindowThreadProcessId(handle,out owner);if(owner==expected){var title=new StringBuilder(256);GetWindowText(handle,title,title.Capacity);if(title.ToString()=="LocalFlow")main=handle;}return true;},IntPtr.Zero);
        if(main==IntPtr.Zero)throw new Exception("Owned native test window unavailable");
        Rect rect;if(!GetWindowRect(main,out rect))throw new Exception("Native window bounds unavailable");
        Rect visible;int frameResult=DwmGetWindowAttribute(main,9,out visible,Marshal.SizeOf(typeof(Rect)));
        if(frameResult<0)Marshal.ThrowExceptionForHR(frameResult);
        using(var board=new MaterialBackdrop())using(var focus=new Form()) {
            board.FormBorderStyle=FormBorderStyle.None;board.ShowInTaskbar=false;board.StartPosition=FormStartPosition.Manual;
            board.Bounds=new Rectangle(visible.left,visible.top,visible.right-visible.left,visible.bottom-visible.top);
            board.BackColor=Color.FromArgb(245,25,25);board.Show();
            Focus(main);SetWindowPos(board.Handle,main,0,0,0,0,0x13);Paint();
            var red=Pixel(rect.left+40,rect.top+600);var opaqueRed=Pixel(rect.right-30,rect.bottom-80);
            board.BackColor=Color.FromArgb(25,25,245);Paint();
            var blue=Pixel(rect.left+40,rect.top+600);var opaqueBlue=Pixel(rect.right-30,rect.bottom-80);
            focus.ShowInTaskbar=false;focus.StartPosition=FormStartPosition.Manual;
            focus.Bounds=new Rectangle(rect.right-200,rect.top+100,120,60);focus.Show();Focus(focus.Handle);Paint();
            board.BackColor=Color.FromArgb(245,25,25);Paint();var unfocused=Pixel(rect.left+40,rect.top+600);
            Capture(visible,image);
            if(opaque) {
                for(int i=0;i<3;i++)if(Math.Abs(red[i]-blue[i])>5||Math.Abs(red[i]-unfocused[i])>5)throw new Exception("Static theme must remain opaque");
            } else {
                if(red[0]-blue[0]<40||blue[2]-red[2]<40)throw new Exception("Glass sidebar does not reveal the changing desktop backdrop: "+string.Join(",",red)+" / "+string.Join(",",blue));
                if(unfocused[0]-unfocused[2]<40)throw new Exception("Glass becomes opaque after focus loss");
            }
            for(int i=0;i<3;i++)if(Math.Abs(opaqueRed[i]-opaqueBlue[i])>5)throw new Exception("The workspace must remain opaque");
            Focus(previous);return new[]{red,blue,unfocused,opaqueRed,opaqueBlue};
        }
    }
    public static int[][] Shape(uint expected, string title, string image) {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        IntPtr target=IntPtr.Zero;
        EnumWindows((handle,state)=>{uint owner;GetWindowThreadProcessId(handle,out owner);if(owner==expected){var text=new StringBuilder(256);GetWindowText(handle,text,text.Capacity);if(text.ToString()==title)target=handle;}return true;},IntPtr.Zero);
        if(target==IntPtr.Zero)throw new Exception("Owned shaped window unavailable: "+title);
        Rect rect;if(!GetWindowRect(target,out rect))throw new Exception("Window bounds unavailable");
        Rect original=rect;var area=Screen.FromHandle(target).WorkingArea;
        SetWindowPos(target,new IntPtr(-1),area.Left+area.Width/2,area.Top+80,0,0,0x11);
        GetWindowRect(target,out rect);
        try {
        using(var board=new MaterialBackdrop()) {
            board.FormBorderStyle=FormBorderStyle.None;board.ShowInTaskbar=false;board.TopMost=true;board.StartPosition=FormStartPosition.Manual;
            board.Bounds=new Rectangle(rect.left-4,rect.top-4,rect.right-rect.left+8,rect.bottom-rect.top+8);
            board.Show();SetWindowPos(target,new IntPtr(-1),0,0,0,0,0x13);
            var pixels=new int[4][];var colors=new[]{Color.FromArgb(245,25,25),Color.FromArgb(25,25,245)};
            for(int pass=0;pass<2;pass++) {
                board.BackColor=colors[pass];Paint();
                pixels[pass*2]=Pixel(rect.left+1,rect.top+2);
                pixels[pass*2+1]=Pixel(rect.left-3,rect.top+(rect.bottom-rect.top)/2);
            }
            Capture(rect,image,4);
            for(int pass=0;pass<2;pass++)for(int point=0;point<2;point++)for(int channel=0;channel<3;channel++) {
                int expectedColor=channel==0?colors[pass].R:channel==1?colors[pass].G:colors[pass].B;
                if(Math.Abs(pixels[pass*2+point][channel]-expectedColor)>3)throw new Exception("Window frame or shadow covers the transparent shape: "+title+" "+string.Join(",",pixels[pass*2+point]));
            }
            return pixels;
        }
        } finally { SetWindowPos(target,IntPtr.Zero,original.left,original.top,0,0,0x15); }
    }
}
'@
if ($Surface -eq 'main') {
    [LocalFlowMaterialCheck]::Run($NativeProcessId, [bool]$Opaque, $ImagePath) | ConvertTo-Json -Compress -Depth 4
} else {
    if (-not $WindowTitle) { $WindowTitle = if ($Surface -eq 'edge') {'LocalFlow Edge'} else {'LocalFlow dictation'} }
    [LocalFlowMaterialCheck]::Shape($NativeProcessId, $WindowTitle, $ImagePath) | ConvertTo-Json -Compress -Depth 4
}
