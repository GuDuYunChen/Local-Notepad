import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

// Chromium may expose a visible untitled auxiliary HWND ahead of the actual
// BrowserWindow. Process.MainWindowHandle is not a reliable selector here.
export function selectDesktopMainWindow(windows, pid, title) {
  assert.ok(Array.isArray(windows)); assert.ok(Number.isInteger(pid) && pid > 0)
  assert.ok(typeof title === 'string' && title.trim().length > 0)
  const matches = windows.filter(w => w.pid === pid && w.visible === true &&
    w.cls === 'Chrome_WidgetWin_1' && w.title === title &&
    Array.isArray(w.childText) && w.childText.includes('Chrome Legacy Window') &&
    Number.isSafeInteger(w.handle) && w.handle > 0)
  assert.equal(matches.length, 1, 'Expected one owned, titled application renderer window')
  return matches[0]
}

function powershell(script) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

export function inspectDesktopWindows(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0)
  const script = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new();Add-Type -TypeDefinition @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class DesktopWindow { public long handle;public uint pid;public string title;public string cls;public bool visible;public List<string> childText=new List<string>();}
public static class DesktopInspect {
public delegate bool Callback(IntPtr h,IntPtr p);
[DllImport("user32.dll")]static extern bool EnumWindows(Callback cb,IntPtr p);
[DllImport("user32.dll")]static extern bool EnumChildWindows(IntPtr h,Callback cb,IntPtr p);
[DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
static string Text(IntPtr h){var s=new StringBuilder(2048);GetWindowText(h,s,2048);return s.ToString();}
public static List<DesktopWindow> Read(uint pid){var a=new List<DesktopWindow>();EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id!=pid)return true;var s=new StringBuilder(256);GetClassName(h,s,256);var x=new DesktopWindow{handle=h.ToInt64(),pid=id,title=Text(h),cls=s.ToString(),visible=IsWindowVisible(h)};EnumChildWindows(h,(c,q)=>{var t=Text(c);if(t.Length>0)x.childText.Add(t);return true;},IntPtr.Zero);a.Add(x);return true;},IntPtr.Zero);return a;}
}
'@
ConvertTo-Json -InputObject @([DesktopInspect]::Read(${pid})) -Depth 5 -Compress`
  const result = JSON.parse(powershell(script))
  // Some PowerShell versions serialize a one-list wrapper differently.
  return Array.isArray(result[0]) ? result[0] : result
}

export function postDesktopClose(window) {
  assert.ok(Number.isInteger(window.pid) && window.pid > 0)
  assert.ok(Number.isSafeInteger(window.handle) && window.handle > 0)
  const script = `$ErrorActionPreference='Stop';Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class CloseTestWindow {
[DllImport("user32.dll",SetLastError=true)]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
public static bool Close(long h,uint expected){uint pid;var handle=new IntPtr(h);GetWindowThreadProcessId(handle,out pid);return pid==expected&&IsWindowVisible(handle)&&PostMessage(handle,0x0010,IntPtr.Zero,IntPtr.Zero);}
}
'@
if(-not [CloseTestWindow]::Close(${window.handle},${window.pid})){throw 'Owned main-window WM_CLOSE failed'}`
  powershell(script)
}
