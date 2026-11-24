$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildPath = Join-Path $workspacePath 'build'
[System.IO.Directory]::CreateDirectory($buildPath) | Out-Null

function New-RoundRectPath([single] $x, [single] $y, [single] $width, [single] $height, [single] $radius) {
  $shapePath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $shapePath.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $shapePath.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $shapePath.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $shapePath.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $shapePath.CloseFigure()
  return $shapePath
}

function New-IconBitmap([int] $size) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size / 256.0, $size / 256.0)
  $outerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#e8a1b6'))
  $innerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#fff9fb'))
  $petalBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#b3a1cf'))
  $centerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#fff0bb'))
  $outerPath = New-RoundRectPath 12 12 232 232 61
  $innerPath = New-RoundRectPath 37 37 182 182 38
  $graphics.FillPath($outerBrush, $outerPath)
  $graphics.FillPath($innerBrush, $innerPath)
  $letterPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#a65578'), 18)
  $letterPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $letterPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($letterPen, 83, 79, 83, 178)
  $graphics.DrawLine($letterPen, 173, 79, 173, 178)
  $graphics.DrawLine($letterPen, 83, 139, 173, 139)
  for ($i = 0; $i -lt 5; $i++) {
    $saved = $graphics.Save()
    $graphics.TranslateTransform(174, 65)
    $graphics.RotateTransform($i * 72)
    $graphics.FillEllipse($petalBrush, -12, -23, 24, 46)
    $graphics.Restore($saved)
  }
  $graphics.FillEllipse($centerBrush, 167, 58, 14, 14)
  $graphics.Dispose()
  $outerBrush.Dispose(); $innerBrush.Dispose(); $petalBrush.Dispose(); $centerBrush.Dispose()
  $outerPath.Dispose(); $innerPath.Dispose(); $letterPen.Dispose()
  return $bitmap
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
  $iconBitmap = New-IconBitmap $size
  $imageStream = New-Object System.IO.MemoryStream
  $iconBitmap.Save($imageStream, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += ,$imageStream.ToArray()
  if ($size -eq 256) { $iconBitmap.Save((Join-Path $buildPath 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $iconBitmap.Dispose(); $imageStream.Dispose()
}
$fileStream = [System.IO.File]::Create((Join-Path $buildPath 'icon.ico'))
$writer = New-Object System.IO.BinaryWriter($fileStream)
$writer.Write([UInt16] 0); $writer.Write([UInt16] 1); $writer.Write([UInt16] $sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
  $writer.Write([byte] $dimension); $writer.Write([byte] $dimension)
  $writer.Write([byte] 0); $writer.Write([byte] 0)
  $writer.Write([UInt16] 1); $writer.Write([UInt16] 32)
  $writer.Write([UInt32] $images[$i].Length); $writer.Write([UInt32] $offset)
  $offset += $images[$i].Length
}
foreach ($imageBytes in $images) { $writer.Write([byte[]] $imageBytes) }
$writer.Dispose(); $fileStream.Dispose()
Write-Output 'Generated build/icon.ico and build/icon.png'
