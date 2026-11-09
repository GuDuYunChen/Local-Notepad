# Verifier-owned, one request/one process. No display mode, emulation, product
# window policy or foreign HWND is modified. The caller supplies an owned PID,
# exact installed image, and the already identified actual main HWND.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false, $true)
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public sealed class FullAppWindowRect {
  public int left, top, right, bottom, width, height;
}
public sealed class FullAppWindowObservation {
  public long handle;
  public uint pid;
  public string image, windowClass;
  public bool visible;
  public FullAppWindowRect outer, client;
}
public static class FullAppOwnedWindow {
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int length);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder image, ref uint length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static string Image(uint pid) {
    var handle = OpenProcess(0x1000, false, pid);
    if (handle == IntPtr.Zero) throw new InvalidOperationException("OWNED_PROCESS_UNAVAILABLE");
    try {
      var image = new StringBuilder(32768); uint length = 32768;
      if (!QueryFullProcessImageName(handle, 0, image, ref length)) throw new InvalidOperationException("OWNED_IMAGE_UNAVAILABLE");
      return image.ToString();
    } finally { CloseHandle(handle); }
  }
  static FullAppWindowRect Bounds(Rect rect) {
    return new FullAppWindowRect { left=rect.left, top=rect.top, right=rect.right, bottom=rect.bottom,
      width=rect.right-rect.left, height=rect.bottom-rect.top };
  }
  public static void PhysicalPixels() {
    // This changes only this short-lived verifier thread, never the app's DPI.
    if (SetThreadDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero)
      throw new InvalidOperationException("NATIVE_DPI_CONTEXT_UNAVAILABLE");
  }
  public static FullAppWindowObservation Read(uint pid, long handle, string executable) {
    var hwnd = new IntPtr(handle); uint owner;
    if (pid == 0 || handle == 0 || !IsWindow(hwnd) || !IsWindowVisible(hwnd)) throw new InvalidOperationException("OWNED_WINDOW_UNAVAILABLE");
    GetWindowThreadProcessId(hwnd, out owner);
    if (owner != pid) throw new InvalidOperationException("FOREIGN_WINDOW_PID");
    var image = Image(pid);
    if (!Path.IsPathRooted(executable) || !String.Equals(Path.GetFullPath(image), Path.GetFullPath(executable), StringComparison.OrdinalIgnoreCase))
      throw new InvalidOperationException("FOREIGN_WINDOW_IMAGE");
    var name = new StringBuilder(256); GetClassName(hwnd, name, 256);
    if (name.ToString() != "Chrome_WidgetWin_1" || IsZoomed(hwnd)) throw new InvalidOperationException("UNEXPECTED_MAIN_WINDOW_STATE");
    Rect outer, client;
    if (!GetWindowRect(hwnd, out outer) || !GetClientRect(hwnd, out client)) throw new InvalidOperationException("NATIVE_BOUNDS_UNAVAILABLE");
    return new FullAppWindowObservation { handle=handle, pid=pid, image=image, windowClass=name.ToString(), visible=true,
      outer=Bounds(outer), client=Bounds(client) };
  }
  public static FullAppWindowObservation Resize(uint pid, long handle, string executable, int width, int height) {
    var before = Read(pid, handle, executable);
    if (width < 1 || width > 7680 || height < 1 || height > 4320) throw new InvalidOperationException("INVALID_CLIENT_SIZE");
    int insetWidth=before.outer.width-before.client.width, insetHeight=before.outer.height-before.client.height;
    if (insetWidth < 0 || insetWidth > 256 || insetHeight < 0 || insetHeight > 256) throw new InvalidOperationException("INVALID_NATIVE_INSETS");
    if (!SetWindowPos(new IntPtr(handle), IntPtr.Zero, 0, 0, width+insetWidth, height+insetHeight, 0x0014))
      throw new InvalidOperationException("NATIVE_RESIZE_FAILED");
    return Read(pid, handle, executable);
  }
}
'@
try {
  $line = [Console]::ReadLine()
  if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -gt 8192) { throw 'INVALID_REQUEST' }
  $request = ConvertFrom-Json -InputObject $line
  if ($request.protocol -ne 1 -or $request.operation -ne 'resize-owned-client') { throw 'INVALID_PROTOCOL' }
  if ($request.pid -le 0 -or $request.pid -gt [uint32]::MaxValue -or $request.handle -le 0) { throw 'INVALID_IDENTITY' }
  $dpr = [double]$request.devicePixelRatio
  if ([double]::IsNaN($dpr) -or [double]::IsInfinity($dpr) -or $dpr -lt 0.5 -or $dpr -gt 4) { throw 'INVALID_DPR' }
  $width = [int]$request.width; $height = [int]$request.height
  if (!(($width -eq 704 -and $height -eq 455) -or ($width -eq 1280 -and $height -eq 800) -or ($width -eq 1920 -and $height -eq 1080))) { throw 'UNDECLARED_MATRIX_SIZE' }
  $physicalWidth = [int][Math]::Round($width * $dpr)
  $physicalHeight = [int][Math]::Round($height * $dpr)
  [FullAppOwnedWindow]::PhysicalPixels()
  $before = [FullAppOwnedWindow]::Read([uint32]$request.pid, [long]$request.handle, [string]$request.executable)
  # Electron's native menu may occupy client pixels on some Windows builds.
  # Derive that difference from this same HWND and its actual renderer viewport;
  # never hard-code a title/menu border or resize the renderer independently.
  $observedWidth = [double]$request.beforeViewport.width
  $observedHeight = [double]$request.beforeViewport.height
  if ($observedWidth -le 0 -or $observedHeight -le 0) { throw 'MISSING_REAL_VIEWPORT' }
  $insetWidth = $before.client.width - [int][Math]::Round($observedWidth * $dpr)
  $insetHeight = $before.client.height - [int][Math]::Round($observedHeight * $dpr)
  if ($insetWidth -lt 0 -or $insetHeight -lt 0 -or $insetWidth -gt 256 -or $insetHeight -gt 256) { throw 'UNEXPECTED_RENDERER_CLIENT_INSETS' }
  $nativeWidth = $physicalWidth + $insetWidth
  $nativeHeight = $physicalHeight + $insetHeight
  $attempts = @()
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    $observed = [FullAppOwnedWindow]::Resize([uint32]$request.pid, [long]$request.handle, [string]$request.executable, $nativeWidth, $nativeHeight)
    [Threading.Thread]::Sleep(50)
    $observed = [FullAppOwnedWindow]::Read([uint32]$request.pid, [long]$request.handle, [string]$request.executable)
    $attempts += $observed
    if ($observed.client.width -eq $nativeWidth -and $observed.client.height -eq $nativeHeight) { break }
  }
  if ($observed.client.width -ne $nativeWidth -or $observed.client.height -ne $nativeHeight) { throw 'NATIVE_CLIENT_SIZE_CLAMPED' }
  $reply = @{ protocol=1; operation='resize-owned-client'; complete=$true; pid=$request.pid; handle=$request.handle;
    requested=@{width=$width;height=$height}; devicePixelRatio=$dpr;
    beforeViewport=$request.beforeViewport; viewportInsets=@{width=$insetWidth;height=$insetHeight};
    physicalRequested=@{width=$physicalWidth;height=$physicalHeight}; nativeClientRequested=@{width=$nativeWidth;height=$nativeHeight};
    before=$before; attempts=$attempts; after=$observed } |
    ConvertTo-Json -Depth 10 -Compress
  [Console]::WriteLine($reply)
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
