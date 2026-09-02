# אורז את ההפצה ל-Windows לקובץ exe בודד: ה-stub נושא בתוכו את ערמת הקבצים
# כ-resource ומחלץ אותה לידו בהרצה הראשונה.
# מריצים אחרי `flutter build windows --release`, עם pwsh 7 (או PowerShell 5.1
# — הקובץ הזה נשמר עם BOM כדי שגם היא תקרא את העברית נכון).
#
#   חנות התוספים.exe   ← זה כל מה שמפיצים, וזה מה שהמשתמש לוחץ תמיד
#   app-files\         ← נוצרת לידו בהרצה הראשונה: otzaria_plugin_store.exe +
#                        ה-DLL + data\ + OtzariaData\
$ErrorActionPreference = 'Stop'

# שם הקובץ שהמשתמש רואה — זהה ל-OriginalFilename שב-stub.rc.
#
# ⚠️ **בלי "אוצריא" בשם**, בכוונה: `OtzariaAppLocator.nameLooksLikeOtzaria`
# מזהה לפי השם, ו-exe בשם שמכיל "אוצריא" שיושב ב-`C:\אוצריא` היה נבחר שם
# כהתקנה של אוצריא עצמה. (יש גם רשת ביטחון שנייה — ראו `_ourOwnExeNames`.)
$appFileName = 'חנות התוספים.exe'
$payloadDirName = 'app-files'  # חייב להתאים ל-kPayloadDir שב-stub.c

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'build\windows\x64\runner\Release'
$stageDir = Join-Path $PSScriptRoot 'build\payload'
$payloadFile = Join-Path $PSScriptRoot 'build\payload.otz'  # הנתיב שב-stub.rc
$exePath = Join-Path $projectRoot "build\$appFileName"

if (-not (Test-Path $releaseDir)) {
  throw "Release build not found at $releaseDir — run ``flutter build windows --release`` first."
}

if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
$payloadDir = Join-Path $stageDir $payloadDirName
New-Item -ItemType Directory -Force $payloadDir | Out-Null
Copy-Item (Join-Path $releaseDir '*') $payloadDir -Recurse

# ה-CRT של Visual C++ נוסע איתנו. `otzaria_plugin_store.exe` ושלושה מה-DLL של
# ה-plugins מייבאים אותו בטעינה, ופלאטר **אינו** מעתיק אותו לתיקיית ה-Release
# — כך שבלי זה התוכנה אינה עולה כלל על מכונה שאין בה Redistributable מותקן.
# זו מכונה אפשרית לגמרי: החנות רצה גם על מחשב שאוצריא — שההתקנה
# שלה מביאה את ה-CRT — עדיין לא הותקנה בו.
$requiredCrtDlls = @('msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) {
  throw "vswhere.exe not found at $vswhere — Visual Studio with C++ tools is required."
}
$vsPath = & $vswhere -latest -products '*' `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
  -property installationPath
if (-not $vsPath) { throw 'No Visual Studio installation with C++ tools was found.' }

# תיקיות ה-Redist נקראות לפי גרסת ה-toolset (14.44.35112), ומיון טקסטואלי
# היה מעדיף 14.9 על 14.44 — ולכן מיון כ-[version].
$crtDir = Get-ChildItem -LiteralPath (Join-Path $vsPath 'VC\Redist\MSVC') -Directory |
  Where-Object { $_.Name -match '^\d+(\.\d+)+$' } |
  Sort-Object { [version]$_.Name } -Descending |
  ForEach-Object {
    Get-ChildItem -LiteralPath (Join-Path $_.FullName 'x64') -Directory `
      -Filter 'Microsoft.VC*.CRT' -ErrorAction SilentlyContinue
  } |
  Select-Object -First 1
if (-not $crtDir) {
  throw "No Microsoft.VC*.CRT folder under $vsPath\VC\Redist\MSVC — install the 'C++ Redistributable' component of Visual Studio."
}
Copy-Item (Join-Path $crtDir.FullName '*.dll') $payloadDir -Force

# האריזה נכשלת ברעש ולא מפיצה exe שאינו עולה: זו התקלה שהתגלתה בשטח, והיא
# שקטה לגמרי — הבנייה מצליחה, ה-exe נוצר, והוא פשוט לא רץ אצל המשתמש.
$missingCrt = @($requiredCrtDlls | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $payloadDir $_))
  })
if ($missingCrt.Count -gt 0) {
  throw "CRT DLLs missing from the payload: $($missingCrt -join ', ') (source: $($crtDir.FullName))."
}
Write-Host "Bundled the Visual C++ CRT from $($crtDir.Name)"

# הנתיבים בתוך המכל הם יחסיים ל-$stageDir, כלומר "app-files/..." — וזה מה
# שגורם ל-stub לחלץ ליד עצמו את התיקייה כולה.
if (Test-Path $payloadFile) { Remove-Item -Force $payloadFile }
& (Join-Path $PSScriptRoot 'pack_payload.ps1') -SourceDir $stageDir -OutFile $payloadFile

& (Join-Path $PSScriptRoot 'build_stub.ps1')

Copy-Item (Join-Path $PSScriptRoot 'build\stub.exe') $exePath -Force

$sizeMb = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
Write-Host "Packaged $exePath ($sizeMb MB)"
