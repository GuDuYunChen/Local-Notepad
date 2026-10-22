$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# This process serves only the isolated desktop acceptance driver.
# Compile once, before editing begins; never launch a compiler during WM_CLOSE.
try {
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
  $uiaReferences = @('System.dll', [System.Windows.Automation.AutomationElement].Assembly.Location,
    [System.Windows.Automation.TreeScope].Assembly.Location, [System.Windows.DependencyObject].Assembly.Location)
} catch {
  [Console]::WriteLine((ConvertTo-Json -InputObject @{protocol=1;ready=$false;error='UIA_ASSEMBLY_UNAVAILABLE';diagnostic=@{source='UIAutomation';errorType=$_.Exception.GetType().FullName;hresult=$_.Exception.HResult}} -Depth 4 -Compress))
  exit 1
}
try {
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;
using System.Windows.Automation;
public class DesktopWindow {
  public long handle; public uint pid; public string title; public string cls;
  public string image;
  public bool visible; public List<string> childText = new List<string>();
  public DesktopAccessibilityResult accessibility;
}
public class DesktopWindowIdentity {
  public long handle; public uint pid; public string title; public string cls; public string image; public bool visible;
  public static DesktopWindowIdentity From(DesktopWindow window) {
    return new DesktopWindowIdentity {handle=window.handle,pid=window.pid,title=window.title,cls=window.cls,image=window.image,visible=window.visible};
  }
}
public class DesktopAccessibleElement {
  public uint pid; public long handle; public string name; public string cls;
}
public class DesktopAccessibilityResult {
  public string source = "UIAutomation.FromHandle.FindAll.Descendants";
  public string status; public string errorCode; public string errorType;
  public int budgetMs = 2000; public double elapsedMs;
  public DesktopWindowIdentity boundWindow; public DesktopWindowIdentity revalidatedWindow;
  public DesktopAccessibleElement root;
  public List<DesktopAccessibleElement> elements = new List<DesktopAccessibleElement>();
  public static DesktopAccessibilityResult Refused(DesktopWindow window, string status, string code, Exception error) {
    return new DesktopAccessibilityResult {boundWindow=DesktopWindowIdentity.From(window),status=status,errorCode=code,errorType=error==null?null:error.GetType().FullName};
  }
}
public class DesktopDismissResult {
  public bool posted; public string reason; public DesktopWindow window;
  public List<DesktopWindow> windows;
}
// One MTA reader is created before the helper announces readiness. A deadline
// does not cancel a provider call: poison this reader after timeout, ignore its
// private late result, and never enqueue another operation on that thread.
public static class DesktopAccessibilityReader {
  class Job {
    public DesktopWindow window;
    public readonly ManualResetEvent done = new ManualResetEvent(false);
    public DesktopAccessibilityResult result;
  }
  static readonly object gate = new object();
  static readonly AutoResetEvent work = new AutoResetEvent(false);
  static readonly ManualResetEvent ready = new ManualResetEvent(false);
  static Job pending; static bool poisoned; static Exception startupError;
  public static void Warmup() {
    var thread = new Thread(() => {
      try { var property = AutomationElement.NameProperty; if (property == null) throw new NotSupportedException(); }
      catch (Exception error) { startupError=error; }
      ready.Set();
      if (startupError != null) return;
      while (work.WaitOne()) {
        Job job; lock (gate) { job=pending; }
        if (job == null) continue;
        try { job.result=Collect(job.window); }
        catch (Exception error) {
          var status=error is NotSupportedException?"unsupported":error is ElementNotAvailableException?"unavailable":"error";
          job.result=DesktopAccessibilityResult.Refused(job.window,status,
            status=="unsupported"?"UIA_UNSUPPORTED":status=="unavailable"?"UIA_ELEMENT_UNAVAILABLE":"UIA_READ_FAILED",error);
        }
        job.done.Set();
      }
    });
    thread.IsBackground=true; thread.SetApartmentState(ApartmentState.MTA); thread.Start();
    if (!ready.WaitOne(2000)) throw new TimeoutException("UIA_PREWARM_TIMEOUT");
    if (startupError != null) throw startupError;
  }
  public static DesktopAccessibilityResult Read(DesktopWindow window) {
    var watch=Stopwatch.StartNew();
    Job job;
    lock (gate) {
      if (poisoned) return DesktopAccessibilityResult.Refused(window,"unavailable","UIA_WORKER_UNAVAILABLE",null);
      job=new Job {window=window}; pending=job;
    }
    work.Set();
    bool completed=job.done.WaitOne(2000);
    if (!completed || watch.Elapsed.TotalMilliseconds > 2000) {
      lock (gate) { poisoned=true; }
      var refused=DesktopAccessibilityResult.Refused(window,"timeout","UIA_TIMEOUT",null);
      refused.elapsedMs=watch.Elapsed.TotalMilliseconds; return refused;
    }
    job.result.elapsedMs=watch.Elapsed.TotalMilliseconds;
    return job.result;
  }
  static DesktopAccessibleElement Element(AutomationElement element, uint expectedPID, long expectedHandle) {
    var value=element.Current;
    uint pid=unchecked((uint)value.ProcessId); long handle=unchecked((uint)value.NativeWindowHandle);
    // Check provider identity before asking for text, including each descendant.
    if (pid!=expectedPID || (expectedHandle>0 && handle!=expectedHandle)) return null;
    return new DesktopAccessibleElement {pid=pid,handle=handle,name=value.Name,cls=value.ClassName};
  }
  static DesktopAccessibilityResult Collect(DesktopWindow window) {
    var result=DesktopAccessibilityResult.Refused(window,"error","UIA_IDENTITY_MISMATCH",null);
    // Recheck the same process/image/unique HWND before requesting any UIA data.
    var before=DesktopInspect.UniqueError(DesktopInspect.Read(window.pid),window.image);
    if (!DesktopInspect.SameWindow(before,window)) return result;
    var root=AutomationElement.FromHandle(new IntPtr(window.handle));
    if (root == null) { result.errorCode="UIA_ELEMENT_UNAVAILABLE"; result.status="unavailable"; return result; }
    result.root=Element(root,window.pid,window.handle);
    if (result.root==null) return result;
    var descendants=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);
    if (descendants.Count > 64) { result.errorCode="UIA_ELEMENT_LIMIT"; return result; }
    for (int index=0; index<descendants.Count; index++) {
      var element=Element(descendants[index],window.pid,0);
      if (element==null) return result;
      result.elements.Add(element);
    }
    var all=new List<DesktopAccessibleElement>(result.elements); all.Add(result.root);
    int characters=0;
    foreach (var element in all) {
      if (element.pid != window.pid) return result;
      if (element.name == null || element.cls == null || element.name.Length > 4096 || element.cls.Length > 256) {
        result.errorCode="UIA_TEXT_LIMIT"; return result;
      }
      characters+=element.name.Length+element.cls.Length;
    }
    if (characters > 32768) { result.errorCode="UIA_TEXT_LIMIT"; return result; }
    var after=DesktopInspect.UniqueError(DesktopInspect.Read(window.pid),window.image);
    if (after != null) result.revalidatedWindow=DesktopWindowIdentity.From(after);
    if (!DesktopInspect.SameWindow(after,window)) return result;
    result.status="complete"; result.errorCode=null; result.errorType=null; return result;
  }
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
    string image = System.Diagnostics.Process.GetProcessById((int)expected).MainModule.FileName;
    EnumWindows((h,p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != expected) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      var x = new DesktopWindow { handle=h.ToInt64(), pid=pid, title=Text(h),
        cls=cls.ToString(), visible=IsWindowVisible(h), image=image };
      EnumChildWindows(h, (c,q) => {
        var value=Text(c); if(value.Length>0) x.childText.Add(value); return true;
      }, IntPtr.Zero);
      result.Add(x); return true;
    }, IntPtr.Zero);
    return result;
  }
  public static bool SameWindow(DesktopWindow left, DesktopWindow right) {
    return left != null && right != null && left.pid==right.pid && left.handle==right.handle &&
      left.visible && right.visible && left.title==right.title && left.cls==right.cls && SameImage(left.image,right.image);
  }
  static bool SameImage(string left, string right) {
    return !String.IsNullOrEmpty(left) && !String.IsNullOrEmpty(right) &&
      System.IO.Path.IsPathRooted(left) && System.IO.Path.IsPathRooted(right) &&
      String.Equals(System.IO.Path.GetFullPath(left),System.IO.Path.GetFullPath(right),StringComparison.OrdinalIgnoreCase);
  }
  public static DesktopWindow UniqueError(List<DesktopWindow> windows, string executablePath) {
    DesktopWindow chosen=null;
    foreach (var item in windows) {
      if (!item.visible || item.title!="Error" || item.cls!="#32770") continue;
      if (chosen != null || !SameImage(item.image,executablePath)) return null;
      chosen=item;
    }
    return chosen;
  }
  public static List<DesktopWindow> Read(uint expected, string executablePath) {
    var windows=Read(expected);
    if (String.IsNullOrEmpty(executablePath)) return windows;
    var candidates=new List<DesktopWindow>();
    foreach (var item in windows) if (item.visible && item.title=="Error" && item.cls=="#32770") candidates.Add(item);
    if (candidates.Count==0) return windows;
    var chosen=UniqueError(windows,executablePath);
    if (chosen==null) {
      foreach (var item in candidates) item.accessibility=DesktopAccessibilityResult.Refused(item,"error",
        candidates.Count>1?"UIA_AMBIGUOUS_WINDOW":"UIA_IMAGE_MISMATCH",null);
      return windows;
    }
    bool hasTitle=false,hasMessage=false;
    foreach (var text in chosen.childText) {
      if (text.Contains("退出未完成，窗口已保留")) hasTitle=true;
      if (text.Contains("公式、嵌入内容或源码有尚未应用的更改。请返回编辑，完成或取消这些更改后再退出。")) hasMessage=true;
    }
    if (!hasTitle || !hasMessage) chosen.accessibility=DesktopAccessibilityReader.Read(chosen);
    return windows;
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
  public static DesktopDismissResult DismissUnapplied(uint pid, long handle, string executablePath) {
    const string caption = "Error";
    const string title = "退出未完成，窗口已保留";
    const string message = "公式、嵌入内容或源码有尚未应用的更改。请返回编辑，完成或取消这些更改后再退出。";
    var result=new DesktopDismissResult {reason="FRESH_DIALOG_NOT_VERIFIED",windows=Read(pid,executablePath)};
    DesktopWindow chosen=UniqueError(result.windows,executablePath); result.window=chosen;
    if (chosen==null || chosen.handle!=handle) return result;
    if (!chosen.visible || chosen.title != caption || chosen.cls != "#32770") return result;
    bool matchesTitle = false, matchesMessage = false;
    var names=new List<string>(chosen.childText);
    if (chosen.accessibility!=null) {
      if (chosen.accessibility.status!="complete") { result.reason=chosen.accessibility.errorCode; return result; }
      names.Add(chosen.accessibility.root.name);
      foreach (var element in chosen.accessibility.elements) names.Add(element.name);
    }
    foreach (var text in names) {
      if (text.Contains(title)) matchesTitle = true;
      if (text.Contains(message)) matchesMessage = true;
    }
    if (!matchesTitle || !matchesMessage) return result;
    result.reason=null;
    if (!SameWindow(UniqueError(Read(pid),executablePath),chosen)) { result.reason="FRESH_WINDOW_CHANGED"; return result; }
    uint owner;
    var hwnd = new IntPtr(handle);
    GetWindowThreadProcessId(hwnd, out owner);
    // Only dismiss this revalidated error box. No arbitrary-dialog or process
    // termination operation is exposed, and no failed request is replayed.
    result.posted=owner == pid && IsWindowVisible(hwnd) &&
      PostMessage(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
    if (!result.posted) result.reason="NATIVE_DISMISS_NOT_POSTED";
    return result;
  }
}
'@ -ReferencedAssemblies $uiaReferences
[DesktopAccessibilityReader]::Warmup()
} catch {
  [Console]::WriteLine((ConvertTo-Json -InputObject @{protocol=1;ready=$false;error='UIA_PREWARM_FAILED';diagnostic=@{source='UIAutomation';errorType=$_.Exception.GetType().FullName;hresult=$_.Exception.HResult}} -Depth 4 -Compress))
  exit 1
}
[Console]::WriteLine('{"protocol":1,"ready":true}')
while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    if ($line.Length -gt 8192) { throw 'invalid request' }
    $request = $line | ConvertFrom-Json
    if ($request.id -le 0 -or $request.pid -le 0) { throw 'invalid identity' }
    if ($request.op -eq 'inspect') {
      $reply = @{ id=$request.id; ok=$true; windows=@([DesktopInspect]::Read([uint32]$request.pid, [string]$request.executablePath)) }
    } elseif ($request.op -eq 'close') {
      $posted = [DesktopInspect]::Close([uint32]$request.pid, [long]$request.handle, [string]$request.title)
      $reply = @{ id=$request.id; ok=$posted; posted=$posted }
    } elseif ($request.op -eq 'dismiss-unapplied') {
      $dismissed = [DesktopInspect]::DismissUnapplied([uint32]$request.pid, [long]$request.handle, [string]$request.executablePath)
      $reply = @{ id=$request.id; ok=$true; posted=$dismissed.posted; window=$dismissed.window; windows=$dismissed.windows; reason=$dismissed.reason }
    } else { throw 'unknown operation' }
    [Console]::WriteLine((ConvertTo-Json -InputObject $reply -Depth 6 -Compress))
  } catch {
    # Do not print raw exceptions, command text or local paths into the protocol.
    [Console]::WriteLine((ConvertTo-Json -InputObject @{id=$request.id;ok=$false} -Compress))
  }
}
