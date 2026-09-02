# בונה את `windows/runner/resources/app_icon.ico` מתמונת מקור אחת.
#
#   tool\make_app_icon.ps1 -Source C:\path\to\icon.png
#
# למה סקריפט ולא כלי חיצוני: ל-ICO תקין צריך **כמה גדלים באותו קובץ** —
# ווינדוס בוחרת ביניהם לפי ההקשר (16 בשורת הכותרת של Explorer, 32 בשורת
# המשימות, 256 ב"אריחים גדולים"). קובץ עם גודל אחד נראה מטושטש בכל השאר,
# וזו בדיוק התקלה שמתגלה אחרי ההפצה.
#
# הגדלים והסדר תואמים למה שפלאטר מייצר בתבנית ברירת המחדל.
#
# דורש .NET (System.Drawing) — קיים בכל ווינדוס. אין תלות ב-ImageMagick.

# ⚠️ `param` חייב להיות ההצהרה הראשונה בסקריפט — כל שורת קוד לפניו היא
# שגיאת פרסור, כולל הצבה של $ErrorActionPreference.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$Out
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Out) {
  $Out = Join-Path $projectRoot 'windows\runner\resources\app_icon.ico'
}

if (-not (Test-Path -LiteralPath $Source)) {
  throw "Source image not found: $Source"
}

# 256 חייב להיות ראשון: ווינדוס קוראת את הרשומה הראשונה בכמה מסלולי תצוגה
# ותיקים, ותמונה קטנה שם נמתחת. הסדר בקובץ אינו חייב להיות ממוין, אבל
# מ-256 ומטה זה מה שפלאטר מייצר וזה מה שנבדק בפועל.
$sizes = @(256, 128, 64, 48, 32, 16)

$src = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Source).Path)
try {
  Write-Host "Source: $($src.Width)x$($src.Height) $($src.PixelFormat)"

  $pngs = @()
  foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      # שקיפות נשמרת: הרקע אינו נצבע, ורק התמונה מוטבעת עליו.
      $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
    } finally {
      $g.Dispose()
    }

    $stream = New-Object System.IO.MemoryStream
    try {
      $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      $pngs += , @{ Size = $size; Bytes = $stream.ToArray() }
    } finally {
      $stream.Dispose()
      $bmp.Dispose()
    }
  }
} finally {
  $src.Dispose()
}

# ── מכל ה-ICO ────────────────────────────────────────────────────────────────
# ICONDIR:   reserved(2)=0, type(2)=1, count(2)
# ICONDIRENTRY (16 בתים ×count): width(1), height(1), colors(1)=0,
#   reserved(1)=0, planes(2)=1, bpp(2)=32, bytesInRes(4), offset(4)
# ואחריהן גופי ה-PNG. רשומות PNG בתוך ICO נתמכות מוינדוס ויסטה והלאה;
# `width`/`height` של 256 נכתבים כ-0, כפי שהפורמט דורש.
#
# ⚠️ **לא** `$out`: הפרמטר נקרא `$Out`, שמות משתנים ב-PowerShell אינם
# תלויי-רישיות, ו-`[string]` שעליו היה ממיר את ה-stream למחרוזת
# "System.IO.MemoryStream" — ואז ה-BinaryWriter נכשל בלי שום קשר נראה
# לעין (וגם נתיב היעד היה נדרס).
$icoStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($icoStream)
try {
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$pngs.Count)

  $offset = 6 + (16 * $pngs.Count)
  foreach ($png in $pngs) {
    $dim = if ($png.Size -ge 256) { 0 } else { $png.Size }
    $writer.Write([byte]$dim)
    $writer.Write([byte]$dim)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$png.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $png.Bytes.Length
  }
  foreach ($png in $pngs) { $writer.Write($png.Bytes) }

  $writer.Flush()
  [System.IO.File]::WriteAllBytes($Out, $icoStream.ToArray())
} finally {
  $writer.Dispose()
  $icoStream.Dispose()
}

$kb = [math]::Round((Get-Item -LiteralPath $Out).Length / 1KB, 1)
Write-Host "Wrote $Out ($kb KB, sizes: $($sizes -join ', '))"

# ── הנכס שבתוך התוכנה ────────────────────────────────────────────────────────
# `AppTitleBar` מציג את אותו אייקון לצד שם התוכנה. הוא נכתב **מכאן** ולא
# מועתק ביד, כדי שאייקון קובץ ההרצה והאייקון שבחלון לא ייפרדו: קודם ישב שם
# הלוגו של אוצריא, וזה נראה כמו תוכנה אחרת מזו שלחצו עליה בשורת המשימות.
$assetPng = Join-Path $projectRoot 'assets\images\app_icon.png'
$png256 = ($pngs | Where-Object { $_.Size -eq 256 } | Select-Object -First 1)
if (-not $png256) { throw 'No 256px rendition was produced.' }
[System.IO.File]::WriteAllBytes($assetPng, $png256.Bytes)
Write-Host "Wrote $assetPng ($([math]::Round($png256.Bytes.Length / 1KB, 1)) KB, 256px)"

Write-Host 'Rebuild to pick it up:  flutter build windows --release ; .\windows_stub\package.ps1'
