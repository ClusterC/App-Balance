# Generates the PNG and ICO icon set Tauri needs, with no image-library
# dependency. Draws a simple teal rounded "wallet" mark: a dark card with a
# lighter band and a coin dot.
#
# Output goes to src-tauri/icons/.
param(
  [string]$OutDir = "src-tauri/icons"
)

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $OutDir | Out-Null

function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = [double]$size
  # Rounded-square background in deep teal.
  $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 105, 92))
  $radius = $s * 0.22
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($s - $d, 0, $d, $d, 270, 90)
  $path.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
  $path.AddArc(0, $s - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($bg, $path)

  # Card body.
  $card = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 178, 223, 219))
  $cx = $s * 0.16; $cy = $s * 0.30
  $cw = $s * 0.68; $ch = $s * 0.44
  $g.FillRectangle($card, [single]$cx, [single]$cy, [single]$cw, [single]$ch)

  # Coin dot on the card.
  $coin = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 105, 92))
  $cd = $s * 0.14
  $g.FillEllipse($coin, [single]($cx + $cw * 0.60), [single]($cy + $ch * 0.30), [single]$cd, [single]$cd)

  $g.Dispose()
  return $bmp
}

$sizes = @{
  "32x32.png"     = 32
  "64x64.png"     = 64
  "128x128.png"   = 128
  "128x128@2x.png"= 256
  "icon.png"      = 512
}

foreach ($name in $sizes.Keys) {
  $bmp = New-IconBitmap $sizes[$name]
  $target = Join-Path $OutDir $name
  $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "wrote $target"
}

# ── ICO: 16/24/32/48/64/256, 32bpp BGRA, stored as PNG frames ───────────────
$icoSizes = @(16, 24, 32, 48, 64, 256)
$frames = @()
foreach ($sz in $icoSizes) {
  $bmp = New-IconBitmap $sz
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $frames += ,@{ Size = $sz; Bytes = $ms.ToArray() }
  $ms.Dispose(); $bmp.Dispose()
}

$icoPath = Join-Path $OutDir "icon.ico"
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$frames.Count)

$offset = 6 + (16 * $frames.Count)
foreach ($f in $frames) {
  $dim = $f.Size
  if ($dim -ge 256) { $dim = 0 }   # 0 means 256 in the ICO header
  $bw.Write([byte]$dim); $bw.Write([byte]$dim)
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$f.Bytes.Length)
  $bw.Write([uint32]$offset)
  $offset += $f.Bytes.Length
}
foreach ($f in $frames) { $bw.Write($f.Bytes) }

$bw.Flush(); $bw.Close(); $fs.Close()
"wrote $icoPath ($((Get-Item $icoPath).Length) bytes, $($frames.Count) frames)"
