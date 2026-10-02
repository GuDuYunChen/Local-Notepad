$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# This process serves only the isolated desktop acceptance driver.
# Compile once, before editing begins; never launch a compiler during WM_CLOSE.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class DesktopWindow {
  public long handle; public uint pid; public string title; public string cls;
  public bool visible; public List<string> childText = new List<string>();
}
public static class DesktopInspect {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, Callback cb, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", SetLastError=true)] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  static string Text(IntPtr h) {
    var s = new StringBuilder(2048); GetWindowText(h, s, 2048); return s.ToString();
  }
  public static List<DesktopWindow> Read(uint expected) {
    var result = new List<DesktopWindow>();
    EnumWindows((h,p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != expected) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      var x = new DesktopWindow { handle=h.ToInt64(), pid=pid, title=Text(h),
        cls=cls.ToString(), visible=IsWindowVisible(h) };
      EnumChildWindows(h, (c,q) => {
        var value=Text(c); if(value.Length>0) x.childText.Add(value); return true;
      }, IntPtr.Zero);
      result.Add(x); return true;
    }, IntPtr.Zero);
    return result;
  }
  public static bool Close(uint pid, long handle, string title) {
    // Revalidate the exact main renderer immediately before posting once.
    DesktopWindow chosen = null;
    foreach (var item in Read(pid)) {
      if (!item.visible || item.title != title || item.cls != "Chrome_WidgetWin_1" ||
          !item.childText.Contains("Chrome Legacy Window")) continue;
      if (chosen != null) return false;
      chosen = item;
    }
    if (chosen == null || chosen.handle != handle) return false;
    uint owner;
    var hwnd = new IntPtr(handle);
    GetWindowThreadProcessId(hwnd, out owner);
    return owner == pid && IsWindowVisible(hwnd) &&
      PostMessage(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
  }
}
'@
[Console]::WriteLine('{"protocol":1,"ready":true}')
while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    if ($line.Length -gt 8192) { throw 'invalid request' }
    $request = $line | ConvertFrom-Json
    if ($request.id -le 0 -or $request.pid -le 0) { throw 'invalid identity' }
    if ($request.op -eq 'inspect') {
      $reply = @{ id=$request.id; ok=$true; windows=@([DesktopInspect]::Read([uint32]$request.pid)) }
    } elseif ($request.op -eq 'close') {
      $posted = [DesktopInspect]::Close([uint32]$request.pid, [long]$request.handle, [string]$request.title)
      $reply = @{ id=$request.id; ok=$posted; posted=$posted }
    } else { throw 'unknown operation' }
    [Console]::WriteLine((ConvertTo-Json -InputObject $reply -Depth 6 -Compress))
  } catch {
    # Do not print raw exceptions, command text or local paths into the protocol.
    [Console]::WriteLine((ConvertTo-Json -InputObject @{id=$request.id;ok=$false} -Compress))
  }
}
