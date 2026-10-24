param(
    [Parameter(Mandatory=$true)][string]$Source,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'assets')
)

Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Bitmap]::new($Source)
$clean = [System.Drawing.Bitmap]::new(1000, 1000, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($clean)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$path.StartFigure()
$path.AddBezier(326, 384, 326, 366, 336, 357, 350, 357)
$path.AddLine(350, 357, 413, 357)
$path.AddBezier(413, 357, 432, 357, 435, 386, 453, 391)
$path.AddLine(453, 391, 609, 391)
$path.AddBezier(609, 391, 629, 391, 641, 404, 641, 423)
$path.AddLine(641, 423, 641, 590)
$path.AddBezier(641, 590, 641, 611, 629, 621, 609, 621)
$path.AddLine(609, 621, 354, 621)
$path.AddBezier(354, 621, 334, 621, 326, 609, 326, 590)
$path.AddLine(326, 590, 326, 384)
$path.CloseFigure()
$graphics.SetClip($path)
$graphics.DrawImage($image, 0, 0, 1000, 1000)
$graphics.Dispose()
$path.Dispose()
$image.Dispose()

$icon = [System.Drawing.Bitmap]::new(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($icon)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($clean, [System.Drawing.Rectangle]::new(12, 26, 232, 204), [System.Drawing.Rectangle]::new(315, 345, 338, 289), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$clean.Dispose()

$pngPath = Join-Path $OutputDirectory 'icon.png'
$icoPath = Join-Path $OutputDirectory 'icon.ico'
$icon.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Dispose()

$png = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Create($icoPath)
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$png.Length)
$writer.Write([UInt32]22)
$writer.Write($png)
$writer.Dispose()

Write-Output "Created $icoPath from the supplied icon."
