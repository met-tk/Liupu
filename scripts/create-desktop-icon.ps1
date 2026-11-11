$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$brandRoot = Join-Path $projectRoot 'src\assets\brand'
$iconRoot = Join-Path $projectRoot 'desktop'
$source = [System.Drawing.Bitmap]::new((Join-Path $projectRoot 'ICON.png'))
$bitmap = [System.Drawing.Bitmap]::new(1024, 1024)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.Clear([System.Drawing.Color]::Transparent)
$tile = [System.Drawing.Drawing2D.GraphicsPath]::new()
$tile.AddArc(0, 0, 448, 448, 180, 90); $tile.AddArc(576, 0, 448, 448, 270, 90)
$tile.AddArc(576, 576, 448, 448, 0, 90); $tile.AddArc(0, 576, 448, 448, 90, 90); $tile.CloseFigure()
$graphics.FillPath([System.Drawing.Brushes]::White, $tile)
$scale = 928.0 / [Math]::Max($source.Width, $source.Height)
$width = [single]($source.Width * $scale); $height = [single]($source.Height * $scale)
$graphics.DrawImage($source, [single]((1024 - $width) / 2), [single]((1024 - $height) / 2), $width, $height)
$graphics.Dispose(); $tile.Dispose()
$bitmap.Save((Join-Path $iconRoot 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Save((Join-Path $brandRoot 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
# Keep the transparent mark square so the header's existing white inversion does not distort it.
$mark = [System.Drawing.Bitmap]::new(256, 256)
$g = [System.Drawing.Graphics]::FromImage($mark)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$scale = 256.0 / [Math]::Max($source.Width, $source.Height)
$width = [single]($source.Width * $scale); $height = [single]($source.Height * $scale)
$g.DrawImage($source, [single]((256 - $width) / 2), [single]((256 - $height) / 2), $width, $height)
$mark.Save((Join-Path $brandRoot 'mark.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $mark.Dispose(); $source.Dispose()
$images = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $small = [System.Drawing.Bitmap]::new($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($small)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($bitmap, 0, 0, $size, $size)
    $stream = [System.IO.MemoryStream]::new()
    $small.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $images += ,@{ Size = $size; Bytes = $stream.ToArray() }
    $stream.Dispose(); $g.Dispose(); $small.Dispose()
}
$file = [System.IO.File]::Create((Join-Path $iconRoot 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($file)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($image in $images) {
    $dimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([uint16]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$image.Bytes.Length); $writer.Write([uint32]$offset)
    $offset += $image.Bytes.Length
}
foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
$writer.Dispose(); $bitmap.Dispose()
Write-Output 'Created header PNG, favicon, 1024px desktop PNG and seven-size ICO from ICON.png.'
