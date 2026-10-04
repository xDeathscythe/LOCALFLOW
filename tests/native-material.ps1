param([Parameter(Mandatory)][uint32]$NativeProcessId, [switch]$Opaque)
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
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr handle);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr handle, IntPtr dc);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("gdi32.dll")] static extern uint GetPixel(IntPtr dc, int x, int y);
    static void Paint() { Application.DoEvents(); Thread.Sleep(400); Application.DoEvents(); }
    static int[] Pixel(int x, int y) {
        var dc = GetDC(IntPtr.Zero);
        try { var value=GetPixel(dc,x,y); if(value==0xffffffff)throw new Exception("Desktop pixel unavailable");return new[]{(int)(value&255),(int)((value>>8)&255),(int)((value>>16)&255)}; }
        finally { ReleaseDC(IntPtr.Zero,dc); }
    }
    public static int[][] Run(uint expected, bool opaque) {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        IntPtr main=IntPtr.Zero, previous=GetForegroundWindow();
        EnumWindows((handle,state)=>{ uint owner;GetWindowThreadProcessId(handle,out owner);if(owner==expected){var title=new StringBuilder(256);GetWindowText(handle,title,title.Capacity);if(title.ToString()=="LocalFlow")main=handle;}return true;},IntPtr.Zero);
        if(main==IntPtr.Zero)throw new Exception("Owned native test window unavailable");
        Rect rect;if(!GetWindowRect(main,out rect))throw new Exception("Native window bounds unavailable");
        using(var board=new MaterialBackdrop())using(var focus=new Form()) {
            board.FormBorderStyle=FormBorderStyle.None;board.ShowInTaskbar=false;board.StartPosition=FormStartPosition.Manual;
            board.Bounds=new Rectangle(rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);
            board.BackColor=Color.FromArgb(245,25,25);board.Show();
            SetWindowPos(board.Handle,main,0,0,0,0,0x13);SetForegroundWindow(main);Paint();
            var red=Pixel(rect.left+40,rect.top+600);var opaqueRed=Pixel(rect.right-30,rect.bottom-80);
            board.BackColor=Color.FromArgb(25,25,245);Paint();
            var blue=Pixel(rect.left+40,rect.top+600);var opaqueBlue=Pixel(rect.right-30,rect.bottom-80);
            focus.ShowInTaskbar=false;focus.StartPosition=FormStartPosition.Manual;
            focus.Bounds=new Rectangle(rect.right-200,rect.top+100,120,60);focus.Show();SetForegroundWindow(focus.Handle);Paint();
            board.BackColor=Color.FromArgb(245,25,25);Paint();var unfocused=Pixel(rect.left+40,rect.top+600);
            if(opaque) {
                for(int i=0;i<3;i++)if(Math.Abs(red[i]-blue[i])>5||Math.Abs(red[i]-unfocused[i])>5)throw new Exception("Static theme must remain opaque");
            } else {
                if(red[0]-blue[0]<40||blue[2]-red[2]<40)throw new Exception("Glass sidebar does not reveal the changing desktop backdrop: "+string.Join(",",red)+" / "+string.Join(",",blue));
                if(unfocused[0]-unfocused[2]<40)throw new Exception("Glass becomes opaque after focus loss");
            }
            for(int i=0;i<3;i++)if(Math.Abs(opaqueRed[i]-opaqueBlue[i])>5)throw new Exception("The workspace must remain opaque");
            SetForegroundWindow(previous);return new[]{red,blue,unfocused,opaqueRed,opaqueBlue};
        }
    }
}
'@
[LocalFlowMaterialCheck]::Run($NativeProcessId, [bool]$Opaque) | ConvertTo-Json -Compress -Depth 4
