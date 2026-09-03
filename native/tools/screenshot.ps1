# כלי פיתוח: מריץ את התוכנה, מצלם את החלון, וסוגר.
#
#   native\tools\screenshot.ps1 [-Out שם.png] [-WaitSeconds 12]
#
# קיים כדי שאפשר יהיה **לראות** את הממשק בפועל, ולא רק לבדוק שאין
# שגיאות ביומן. מדפיס גם את היומן של ההרצה.
param(
  [string]$Out = 'shot.png',
  [int]$WaitSeconds = 12,
  # לחיצה על נקודה בחלון לפני הצילום (למשל כדי לפתוח דף תוסף),
  # בקואורדינטות אזור-הלקוח.
  [int]$ClickX = -1,
  [int]$ClickY = -1,
  # שומר רק את N הפיקסלים העליונים של החלון. שימושי לאימות המסגרת
  # (שורת כותרת, שורת כלים, hero) בלי לגרור לצילום את תוכן התוספים.
  [int]$CropHeight = 0
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  // PrintWindow מצייר את החלון **עצמו**, גם כשחלון אחר מכסה אותו.
  // `CopyFromScreen` צילם את מה שהיה למעלה על המסך, וזה החזיר צילום של
  // תוכנה אחרת לגמרי.
  //
  // PW_RENDERFULLCONTENT (0x2) נדרש כאן: תוכן ה-WebView2 מצויר דרך
  // DirectComposition, ובלי הדגל הזה הוא יוצא שחור.
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  // ⚠️ `GetWindowRect` על חלון עם WS_THICKFRAME מחזיר גם את **המסגרת
  // הבלתי-נראית** ש-DWM מוסיף (כמה פיקסלים בכל צד). PrintWindow מצייר
  // לפי אותו מלבן, ולכן הצילום יוצא מוזז — וזה מה שגרם לצילום להיראות
  // כאילו חסרים בו רכיבים שבפועל היו שם.
  //
  // DWMWA_EXTENDED_FRAME_BOUNDS (9) מחזיר את הגבולות **הנראים**, וההפרש
  // בין השניים הוא בדיוק מה שצריך לחתוך.
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  // ⚠️ **חובה.** בלי זה ווינדוס מווירטואלת ל-PowerShell את
  // `GetWindowRect` לקואורדינטות 96‏ DPI, ואילו PrintWindow מצייר
  // בפיקסלים פיזיים. במסך ב-150% זה נתן חוצץ של 1280x672 לחלון שהוא
  // בפועל 1920x1008 — כלומר צילום של השליש-שתי-שלישים השמאלי-עליון
  // בלבד, שנראה כאילו חסרים בממשק רכיבים שהיו שם כל הזמן.
  //
  // ‎-4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

# לפני כל קריאה שתלויה בקואורדינטות.
try { [void][Win]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}

$nativeRoot = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $nativeRoot 'build\חנות התוספים.exe'
$logDir = Join-Path $nativeRoot 'build\Data\logs'

$process = Start-Process -FilePath $exe -PassThru
try {
  Start-Sleep -Seconds $WaitSeconds

  # דרך התהליך ולא לפי שם מחלקה: `FindWindowA` אינו מוצא מחלקה שנרשמה
  # ב-`RegisterClassExW`, ו-`MainWindowHandle` הוא ממילא הדבר הנכון —
  # יש כאן חלון אחד.
  $process.Refresh()
  $handle = $process.MainWindowHandle
  if ($handle -eq [IntPtr]::Zero) { throw 'החלון לא נמצא' }

  [void][Win]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 500

  $rect = New-Object Win+RECT
  [void][Win]::GetWindowRect($handle, [ref]$rect)
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top

  if ($ClickX -ge 0 -and $ClickY -ge 0) {
    [void][Win]::SetCursorPos($rect.Left + $ClickX, $rect.Top + $ClickY)
    Start-Sleep -Milliseconds 200
    [Win]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)  # LEFTDOWN
    [Win]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)  # LEFTUP
    Start-Sleep -Milliseconds 1200
  }

  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $hdc = $graphics.GetHdc()
  $printed = [Win]::PrintWindow($handle, $hdc, 0x2)  # PW_RENDERFULLCONTENT
  $graphics.ReleaseHdc($hdc)
  $graphics.Dispose()
  if (-not $printed) { throw 'PrintWindow נכשל' }

  $outPath = if ([IO.Path]::IsPathRooted($Out)) { $Out }
             else { Join-Path $nativeRoot "build\$Out" }

  # חיתוך המסגרת הבלתי-נראית של DWM — ראו ההערה ליד
  # DwmGetWindowAttribute.
  $visible = New-Object Win+RECT
  $offsetX = 0
  $offsetY = 0
  $visibleW = $width
  $visibleH = $height
  if ([Win]::DwmGetWindowAttribute($handle, 9, [ref]$visible, 16) -eq 0) {
    $offsetX = $visible.Left - $rect.Left
    $offsetY = $visible.Top - $rect.Top
    $visibleW = $visible.Right - $visible.Left
    $visibleH = $visible.Bottom - $visible.Top
    Write-Host ("מסגרת בלתי-נראית: x+$offsetX y+$offsetY " +
                "(${width}x${height} -> ${visibleW}x${visibleH})")
  }

  $cropW = [Math]::Min($visibleW, $width - $offsetX)
  $cropH = if ($CropHeight -gt 0) { [Math]::Min($CropHeight, $visibleH) }
           else { [Math]::Min($visibleH, $height - $offsetY) }

  $rectCrop = New-Object System.Drawing.Rectangle $offsetX, $offsetY, $cropW, $cropH
  $saved = $bitmap.Clone($rectCrop, $bitmap.PixelFormat)
  $saved.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  if (-not [object]::ReferenceEquals($saved, $bitmap)) { $saved.Dispose() }
  $bitmap.Dispose()
  Write-Host "צולם: $outPath  (${width}x$(if ($CropHeight -gt 0) { $CropHeight } else { $height }))"
} finally {
  if (-not $process.HasExited) { $process.Kill() }
}

Start-Sleep -Milliseconds 800
Write-Host "`n=== יומן ==="
Get-ChildItem $logDir -Filter 'store-*.log' -ErrorAction SilentlyContinue |
  ForEach-Object { Get-Content $_.FullName -Encoding utf8 -Tail 25 }
