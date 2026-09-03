# אורז את `native/web/**` לגוש אחד שנכנס ל-exe כ-resource, וממנו ה-host
# מגיש את הממשק ישירות מהזיכרון.
#
# **למה לא לפרוס לדיסק** (כמו ש-`windows_stub` עשה): התוכנה הזאת היא קובץ
# אחד. הגשה מהזיכרון דרך `WebResourceRequested` פירושה שאין שום קובץ ממשק
# ליד ה-exe, אין תיקיית חילוץ, ואין מרקר שצריך להחליט אם לחלץ מחדש.
#
# הפורמט — little-endian, נקרא ע"י `WebBundle::Load` ב-webres.cpp:
#
#   "OTZWEB1\0"       8 בתים
#   uint32 algorithm  אלגוריתם ה-Compression API (LZMS = 5)
#   uint32 fileCount
#   uint64 rawSize    גודל הגוש אחרי פרישה
#   בתים דחוסים...
#
# הגוש הפרוש: טבלה של fileCount רשומות
# (uint32 pathBytes, uint32 dataBytes, ואחריהן הנתיב ב-UTF-8 עם `/`),
# ואחריה תוכן הקבצים באותו סדר.
#
# זהו בדיוק הפורמט של `windows_stub/pack_payload.ps1` שהוכיח את עצמו,
# בלי החלק של החילוץ לדיסק.
param(
  [string]$SourceDir,
  [string]$OutFile
)
$ErrorActionPreference = 'Stop'

$nativeRoot = Split-Path -Parent $PSScriptRoot
if (-not $SourceDir) { $SourceDir = Join-Path $nativeRoot 'web' }
if (-not $OutFile) { $OutFile = Join-Path $nativeRoot 'build\web_bundle.bin' }

New-Item -ItemType Directory -Force (Split-Path -Parent $OutFile) | Out-Null

# חייב להתאים ל-kWebBundleMagic ול-COMPRESS_ALGORITHM_LZMS שב-webres.cpp.
$magic = [Text.Encoding]::ASCII.GetBytes("OTZWEB1`0")
$algorithm = 5

Add-Type -Namespace Otz -Name WebCab -MemberDefinition @'
[DllImport("cabinet.dll", SetLastError = true)]
public static extern bool CreateCompressor(uint algorithm, IntPtr allocRoutines, out IntPtr handle);
[DllImport("cabinet.dll", SetLastError = true)]
public static extern bool Compress(IntPtr handle, byte[] uncompressed, IntPtr uncompressedSize,
    byte[] compressed, IntPtr compressedBufferSize, out IntPtr compressedDataSize);
[DllImport("cabinet.dll", SetLastError = true)]
public static extern bool CloseCompressor(IntPtr handle);
'@

# הנתיב היחסי נבנה תוך כדי הירידה בעץ ולא בחיתוך תחילית מ-FullName —
# אותו שיקול כמו ב-pack_payload.ps1: שם 8.3 מול השם המלא מזיזים את החיתוך.
function Get-WebEntries([string]$dir, [string]$prefix) {
  foreach ($entry in Get-ChildItem -LiteralPath $dir -Force | Sort-Object -Property Name) {
    $relative = if ($prefix -eq '') { $entry.Name } else { "$prefix/$($entry.Name)" }
    if ($entry.PSIsContainer) {
      Get-WebEntries $entry.FullName $relative
    } else {
      [pscustomobject]@{ Relative = $relative; Path = $entry.FullName; Length = $entry.Length }
    }
  }
}

$root = (Get-Item -LiteralPath $SourceDir).FullName.TrimEnd('\')
$files = @(Get-WebEntries $root '')
if ($files.Count -eq 0) { throw "No files under $root." }

$blob = New-Object IO.MemoryStream
$writer = New-Object IO.BinaryWriter($blob)
$writer.Write([uint32]$files.Count)
foreach ($file in $files) {
  $pathBytes = [Text.Encoding]::UTF8.GetBytes($file.Relative)
  $writer.Write([uint32]$pathBytes.Length)
  $writer.Write([uint32]$file.Length)
  $writer.Write($pathBytes)
}
foreach ($file in $files) {
  $writer.Write([IO.File]::ReadAllBytes($file.Path))
}
$writer.Flush()
$raw = $blob.ToArray()
$writer.Dispose()

$handle = [IntPtr]::Zero
if (-not [Otz.WebCab]::CreateCompressor($algorithm, [IntPtr]::Zero, [ref]$handle)) {
  throw "CreateCompressor failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
try {
  # שוליים לגודל: על נתונים שאינם נדחסים הפלט עלול לעלות במעט על הקלט.
  $buffer = New-Object byte[] ($raw.Length + 1MB)
  $written = [IntPtr]::Zero
  $ok = [Otz.WebCab]::Compress($handle, $raw, [IntPtr]$raw.Length,
    $buffer, [IntPtr]$buffer.Length, [ref]$written)
  if (-not $ok) {
    throw "Compress failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
} finally { [void][Otz.WebCab]::CloseCompressor($handle) }

$compressedSize = $written.ToInt64()
$out = New-Object IO.MemoryStream
$header = New-Object IO.BinaryWriter($out)
$header.Write($magic)
$header.Write([uint32]$algorithm)
$header.Write([uint32]$files.Count)
$header.Write([uint64]$raw.Length)
$header.Write($buffer, 0, $compressedSize)
$header.Flush()
[IO.File]::WriteAllBytes($OutFile, $out.ToArray())
$header.Dispose()

$rawKb = [math]::Round($raw.Length / 1KB, 1)
$outKb = [math]::Round((Get-Item $OutFile).Length / 1KB, 1)
Write-Host "Packed $($files.Count) web files: $rawKb KB -> $outKb KB ($OutFile)"
