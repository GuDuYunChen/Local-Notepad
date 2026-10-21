$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Isolated Windows acceptance only. The product never loads this worker.
# It operates one uniquely owned native folder dialog; it cannot supply a
# renderer path, override a bridge, dismiss an arbitrary window or kill an app.
$startupStage = 'CONSOLE_ENCODING'
$referenceNames = @()
try {
  [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $startupStage = 'ASSEMBLY_LOAD'
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
  $references = @('System.dll', 'System.Core.dll', [System.Windows.Automation.AutomationElement].Assembly.Location,
    [System.Windows.Automation.TreeScope].Assembly.Location, [System.Windows.DependencyObject].Assembly.Location)
  $referenceNames = @($references | ForEach-Object { [IO.Path]::GetFileName([string]$_) })
  $startupStage = 'SOURCE_COMPILATION'
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Automation;
public class ExportDialogIdentity {
  public long handle; public uint pid; public long owner; public string title; public string cls; public string image;
  public bool visible; public List<long> ownerChain = new List<long>();
}
public class ExportDialogControl {
  public string id; public string name; public string cls; public string type; public bool enabled; public bool offscreen;
}
public class ExportDialogResult {
  public ExportDialogIdentity dialog; public List<ExportDialogControl> controls = new List<ExportDialogControl>();
  public string action; public string selectedPath; public string inputID; public string inputName;
  public string buttonName; public int valueWrites; public int invocations; public int closePosts; public bool dialogClosed;
}
public class ExportWindowSize { public long handle; public uint pid; public int width; public int height; public bool applied; }
public static class ExportDialog {
  public static ExportDialogResult LastObservation;
  delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  [StructLayout(LayoutKind.Sequential)] struct Rect {public int left;public int top;public int right;public int bottom;}
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref uint count);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static string Text(IntPtr hwnd, bool cls) {
    var text = new StringBuilder(4096);
    if (cls) GetClassName(hwnd,text,text.Capacity); else GetWindowText(hwnd,text,text.Capacity);
    return text.ToString();
  }
  static string Image(uint pid) {
    var process=OpenProcess(0x1000,false,pid);
    if(process==IntPtr.Zero)throw new InvalidOperationException("PROCESS_IDENTITY_UNAVAILABLE");
    try {
      var value=new StringBuilder(32768);uint count=(uint)value.Capacity;
      if(!QueryFullProcessImageName(process,0,value,ref count))throw new InvalidOperationException("PROCESS_IMAGE_UNAVAILABLE");
      return Path.GetFullPath(value.ToString());
    } finally {CloseHandle(process);}
  }
  static bool SamePath(string a,string b) {return String.Equals(Path.GetFullPath(a),Path.GetFullPath(b),StringComparison.OrdinalIgnoreCase);}
  static void Main(uint pid,long main,string executable) {
    var hwnd=new IntPtr(main);uint actual;
    GetWindowThreadProcessId(hwnd,out actual);
    if(actual!=pid||!IsWindowVisible(hwnd)||Text(hwnd,true)!="Chrome_WidgetWin_1"||!SamePath(Image(pid),executable))
      throw new InvalidOperationException("MAIN_WINDOW_IDENTITY_CHANGED");
  }
  static ExportDialogIdentity Identity(IntPtr hwnd,uint pid,long main,string executable) {
    uint actual;GetWindowThreadProcessId(hwnd,out actual);
    if(actual!=pid||!IsWindowVisible(hwnd)||Text(hwnd,false)!="选择文档导出目录"||Text(hwnd,true)!="#32770")return null;
    var row=new ExportDialogIdentity {handle=hwnd.ToInt64(),pid=actual,owner=GetWindow(hwnd,4).ToInt64(),
      title=Text(hwnd,false),cls=Text(hwnd,true),image=Image(actual),visible=true};
    if(!SamePath(row.image,executable))return null;
    var owner=GetWindow(hwnd,4);var seen=new HashSet<long>();bool owned=false;
    for(int count=0;owner!=IntPtr.Zero&&count<16;count++) {
      var value=owner.ToInt64();if(!seen.Add(value))return null;
      uint ownerPID;GetWindowThreadProcessId(owner,out ownerPID);if(ownerPID!=pid)return null;
      row.ownerChain.Add(value);if(value==main){owned=true;break;}owner=GetWindow(owner,4);
    }
    return owned?row:null;
  }
  public static ExportDialogIdentity Find(uint pid,long main,string executable) {
    Main(pid,main,executable);var matches=new List<ExportDialogIdentity>();int examined=0;
    EnumWindows((hwnd,param)=> {
      if(++examined>4096)throw new InvalidOperationException("WINDOW_ENUMERATION_LIMIT");
      var row=Identity(hwnd,pid,main,executable);if(row!=null)matches.Add(row);return true;
    },IntPtr.Zero);
    if(matches.Count>1)throw new InvalidOperationException("AMBIGUOUS_OWNED_DIRECTORY_DIALOG");
    return matches.Count==1?matches[0]:null;
  }
  public static ExportWindowSize MinimumWindow(uint pid,long main,string executable) {
    Main(pid,main,executable);
    if(Find(pid,main,executable)!=null)throw new InvalidOperationException("DIRECTORY_DIALOG_STILL_OPEN");
    var hwnd=new IntPtr(main);
    if(!SetWindowPos(hwnd,IntPtr.Zero,0,0,720,520,0x0016))throw new InvalidOperationException("MINIMUM_WINDOW_NOT_APPLIED");
    Main(pid,main,executable);Rect rect;
    if(!GetWindowRect(hwnd,out rect)||rect.right-rect.left!=720||rect.bottom-rect.top!=520)throw new InvalidOperationException("MINIMUM_WINDOW_NOT_CONFIRMED");
    return new ExportWindowSize {handle=main,pid=pid,width=720,height=520,applied=true};
  }
  static void Revalidate(ExportDialogIdentity previous,uint pid,long main,string executable) {
    var fresh=Find(pid,main,executable);
    if(fresh==null||fresh.handle!=previous.handle||fresh.owner!=previous.owner||fresh.pid!=previous.pid)
      throw new InvalidOperationException("DIRECTORY_DIALOG_CHANGED");
  }
  public static ExportDialogResult Act(uint pid,long main,string executable,string action,string directory) {
    LastObservation=null;
    if(action!="choose"&&action!="cancel")throw new ArgumentException("INVALID_ACTION");
    var dialog=Find(pid,main,executable);if(dialog==null)throw new InvalidOperationException("DIRECTORY_DIALOG_MISSING");
    var result=new ExportDialogResult {action=action,dialog=dialog};LastObservation=result;
    if(action=="cancel") {
      Revalidate(dialog,pid,main,executable);
      if(!PostMessage(new IntPtr(dialog.handle),0x0010,IntPtr.Zero,IntPtr.Zero))throw new InvalidOperationException("CANCEL_NOT_POSTED");
      result.closePosts=1;
    } else {
      if(!Path.IsPathRooted(directory)||!Directory.Exists(directory)||directory.Length>1024)throw new ArgumentException("INVALID_OWNED_DIRECTORY");
      var root=AutomationElement.FromHandle(new IntPtr(dialog.handle));
      if(root==null||root.Current.ProcessId!=pid)throw new InvalidOperationException("UIA_ROOT_IDENTITY");
      var nodes=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);
      if(nodes.Count>512)throw new InvalidOperationException("UIA_ELEMENT_LIMIT");
      var inputs=new List<AutomationElement>();var buttons=new List<AutomationElement>();
      for(int i=0;i<nodes.Count;i++) {
        var node=nodes[i];var value=node.Current;
        if(value.ProcessId!=pid)throw new InvalidOperationException("UIA_FOREIGN_PROCESS");
        if(value.ControlType!=ControlType.Edit&&value.ControlType!=ControlType.Button)continue;
        if(result.controls.Count>=128)throw new InvalidOperationException("UIA_CONTROL_LIMIT");
        result.controls.Add(new ExportDialogControl {id=value.AutomationId,name=value.Name,cls=value.ClassName,
          type=value.ControlType.ProgrammaticName,enabled=value.IsEnabled,offscreen=value.IsOffscreen});
        if(!value.IsEnabled||value.IsOffscreen)continue;
        if(value.ControlType==ControlType.Button&&value.Name=="选择此目录")buttons.Add(node);
        if(value.ControlType==ControlType.Edit&&(value.Name=="Folder:"||value.Name=="文件夹:"||value.Name=="文件夹："))inputs.Add(node);
      }
      if(inputs.Count!=1||buttons.Count!=1)throw new InvalidOperationException("DIRECTORY_CONTROLS_MISSING_OR_AMBIGUOUS");
      var input=inputs[0];var button=buttons[0];object rawValue,rawInvoke;
      if(!input.TryGetCurrentPattern(ValuePattern.Pattern,out rawValue)||!button.TryGetCurrentPattern(InvokePattern.Pattern,out rawInvoke))
        throw new InvalidOperationException("DIRECTORY_CONTROL_PATTERN_UNAVAILABLE");
      var valuePattern=(ValuePattern)rawValue;if(valuePattern.Current.IsReadOnly)throw new InvalidOperationException("DIRECTORY_INPUT_READ_ONLY");
      Revalidate(dialog,pid,main,executable);
      valuePattern.SetValue(directory);result.valueWrites=1;
      if(!SamePath(valuePattern.Current.Value,directory))throw new InvalidOperationException("DIRECTORY_INPUT_NOT_CONFIRMED");
      result.selectedPath=Path.GetFullPath(directory);result.inputID=input.Current.AutomationId;result.inputName=input.Current.Name;
      result.buttonName=button.Current.Name;
      Revalidate(dialog,pid,main,executable);((InvokePattern)rawInvoke).Invoke();result.invocations=1;
    }
    var watch=Stopwatch.StartNew();
    while(IsWindow(new IntPtr(dialog.handle))&&IsWindowVisible(new IntPtr(dialog.handle))&&watch.ElapsedMilliseconds<3000)Thread.Sleep(25);
    result.dialogClosed=!IsWindow(new IntPtr(dialog.handle))||!IsWindowVisible(new IntPtr(dialog.handle));
    if(!result.dialogClosed)throw new InvalidOperationException("DIRECTORY_DIALOG_DID_NOT_CLOSE");
    Main(pid,main,executable);return result;
  }
}
'@ -ReferencedAssemblies $references
  $startupStage = 'UIA_READINESS'
  $null = [System.Windows.Automation.AutomationElement]::NameProperty
  [Console]::WriteLine('{"protocol":1,"ready":true}')
} catch {
  # Keep bounded machine diagnostics, never native exception text, source code,
  # command arguments, paths or stderr. A diagnostic failure retains refusal.
  $startupError = $_
  try {
    $allowedTypes = @('System.Exception', 'System.InvalidOperationException',
      'System.ArgumentException', 'System.TypeLoadException', 'System.TypeInitializationException',
      'System.IO.FileNotFoundException', 'System.IO.FileLoadException', 'System.BadImageFormatException',
      'System.Security.SecurityException', 'System.NotSupportedException', 'System.PlatformNotSupportedException',
      'System.Reflection.ReflectionTypeLoadException', 'System.Management.Automation.RuntimeException',
      'System.Management.Automation.PSInvalidOperationException', 'System.Management.Automation.MethodInvocationException',
      'System.Management.Automation.CmdletInvocationException', 'System.Management.Automation.ParseException')
    $errorType = $startupError.Exception.GetType().FullName
    if ($errorType -cnotin $allowedTypes) { $errorType = 'UNKNOWN' }
    $hresult = [int]$startupError.Exception.HResult
    $diagnosticText = [string]$startupError.ToString()
    if ($diagnosticText.Length -gt 16384) { $diagnosticText = $diagnosticText.Substring(0,16384) }
    $compilerCodes = @([regex]::Matches($diagnosticText, '\bCS[0-9]{4}\b') |
      ForEach-Object { $_.Value } | Select-Object -Unique -First 8)
    $powerShellVersion = [string]$PSVersionTable.PSVersion.ToString()
    if ($powerShellVersion -notmatch '^\d{1,5}\.\d{1,5}(?:\.\d{1,5}){0,2}$') { $powerShellVersion = $null }
    $allowedReferences = @('System.dll', 'System.Core.dll', 'UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll')
    $safeReferences = @($referenceNames | Where-Object { $_ -cin $allowedReferences } | Select-Object -Unique -First 5)
    $diagnostic = @{stage=$startupStage;errorType=$errorType;hresult=$hresult;compilerCodes=$compilerCodes;
      powerShellVersion=$powerShellVersion;references=$safeReferences}
    [Console]::WriteLine((ConvertTo-Json -InputObject @{protocol=1;ready=$false;error='DIRECTORY_HELPER_STARTUP';diagnostic=$diagnostic} -Depth 4 -Compress))
  } catch {
    [Console]::WriteLine('{"protocol":1,"ready":false,"error":"DIRECTORY_HELPER_STARTUP"}')
  }
  exit 1
}
while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    if ($line.Length -gt 8192) { throw 'REQUEST_LIMIT' }
    $request = $line | ConvertFrom-Json
    if ($request.id -le 0 -or $request.pid -le 0 -or $request.mainHandle -le 0 -or -not [IO.Path]::IsPathRooted($request.executable)) { throw 'INVALID_IDENTITY' }
    if ($request.op -eq 'minimum-window') {
      $result = [ExportDialog]::MinimumWindow([uint32]$request.pid,[long]$request.mainHandle,[string]$request.executable)
      $reply = @{id=$request.id;ok=$true;result=$result}
    } elseif ($request.op -eq 'inspect') {
      $dialog = [ExportDialog]::Find([uint32]$request.pid,[long]$request.mainHandle,[string]$request.executable)
      $reply = @{id=$request.id;ok=$true;dialog=$dialog}
    } elseif ($request.op -eq 'choose' -or $request.op -eq 'cancel') {
      $result = [ExportDialog]::Act([uint32]$request.pid,[long]$request.mainHandle,[string]$request.executable,[string]$request.op,[string]$request.directory)
      $reply = @{id=$request.id;ok=$true;result=$result}
    } else { throw 'INVALID_OPERATION' }
    [Console]::WriteLine((ConvertTo-Json -InputObject $reply -Depth 8 -Compress))
  } catch {
    # A failed or uncertain operation is never replayed. Preserve a controlled
    # failure code, not arbitrary native exception text or a command payload.
    $code = [string]$_.Exception.InnerException.Message
    if ($code -notmatch '^[A-Z_]{1,80}$') { $code = 'DIRECTORY_HELPER_OPERATION_FAILED' }
    [Console]::WriteLine((ConvertTo-Json -InputObject @{id=$request.id;ok=$false;error=$code;observation=[ExportDialog]::LastObservation} -Depth 8 -Compress))
  }
}
