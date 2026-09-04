# מביא את ה-SDK של WebView2 מ-nuget לתוך `native/third_party/`.
#
# ה-SDK אינו בגיט (ראו .gitignore): הוא 87 קבצים שאינם שלנו, והגרסה נעוצה
# כאן כדי שבנייה מקומית ובנייה ב-CI ייקחו בדיוק את אותו דבר.
#
# מה נלקח ממנו בפועל — שני קבצים:
#   build/native/include/WebView2.h        הכותרת
#   build/native/x64/WebView2LoaderStatic.lib   ה-loader **הסטטי**
#
# ⚠️ הסטטי ולא ה-DLL, וזו כל הנקודה של הפרויקט הזה: `WebView2Loader.dll`
# היה חייב לנסוע ליד ה-exe, וה-exe שלנו הוא קובץ אחד בלי שום דבר לידו.
param(
  # ברירת המחדל היא הגרסה הנעוצה. לעדכון — לשנות כאן, במקום אחד.
  [string]$Version = '1.0.3405.78',
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot          # native/
$dest = Join-Path $root 'third_party'
$pkgDir = Join-Path $dest 'Microsoft.Web.WebView2'

$headerPath = Join-Path $pkgDir 'build\native\include\WebView2.h'
$libPath = Join-Path $pkgDir 'build\native\x64\WebView2LoaderStatic.lib'

if (-not $Force -and (Test-Path -LiteralPath $headerPath) -and (Test-Path -LiteralPath $libPath)) {
  Write-Host "WebView2 SDK already present at $pkgDir"
  return
}

New-Item -ItemType Directory -Force $dest | Out-Null

# nuget.exe אם הוא ב-PATH; אחרת מורידים את ה-nupkg ישירות ופורסים אותו
# כ-zip. השני הוא המסלול שעובד גם על סוכן CI נקי בלי nuget מותקן, ו-nupkg
# הוא zip רגיל לכל דבר.
$nuget = Get-Command nuget -ErrorAction SilentlyContinue
if ($nuget) {
  & $nuget.Source install Microsoft.Web.WebView2 -Version $Version `
    -OutputDirectory $dest -ExcludeVersion -NonInteractive | Out-Null
} else {
  $url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$Version/microsoft.web.webview2.$Version.nupkg"
  # ⚠️ הסיומת חייבת להיות `.zip`, גם שהקובץ הוא nupkg: ב-Windows
  # PowerShell 5.1 `Expand-Archive` פוסל כל סיומת אחרת
  # (`NotSupportedArchiveFileExtension`, ראו ValidateArchivePathHelper
  # במודול Microsoft.PowerShell.Archive). בלי זה דווקא המסלול הזה — זה
  # שההערה שמעל מבטיחה שהוא "עובד גם על סוכן CI נקי בלי nuget" — היה
  # היחיד שאינו יכול לעבוד שם. nupkg הוא zip רגיל, רק השם משתנה.
  $tmp = Join-Path ([IO.Path]::GetTempPath()) "webview2-$Version.zip"
  Write-Host "nuget.exe not found — downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
  try {
    if (Test-Path -LiteralPath $pkgDir) { Remove-Item -Recurse -Force $pkgDir }
    Expand-Archive -LiteralPath $tmp -DestinationPath $pkgDir -Force
  } finally {
    Remove-Item -Force $tmp -ErrorAction SilentlyContinue
  }
}

# נכשלים כאן ולא בקומפילציה: הודעת linker על סמל חסר אינה אומרת למי
# שמריץ את זה שה-SDK בכלל לא ירד.
foreach ($required in @($headerPath, $libPath)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "WebView2 SDK incomplete — missing $required (version $Version)."
  }
}

Write-Host "WebView2 SDK $Version ready at $pkgDir"
