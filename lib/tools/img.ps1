# img.ps1 — imágenes para el REPL (Windows). Imprime UNA línea: media_type|ancho|alto|base64
#   powershell -File lib/tools/img.ps1 clip            # imagen del portapapeles (PNG)
#   powershell -File lib/tools/img.ps1 file <ruta>     # archivo png/jpg/gif/webp
# Reduce el lado mayor a 1568 px (lo que un modelo con visión aprovecha) y saca PNG, o JPEG si queda pesado.
param([string]$Mode, [string]$Path)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if ($Mode -eq "clip") {
    $img = [System.Windows.Forms.Clipboard]::GetImage()
    if ($null -eq $img) { Write-Output "ERROR|no hay una imagen en el portapapeles (copiá una captura o una imagen y repetí /paste)"; exit 0 }
} else {
    if (-not (Test-Path -LiteralPath $Path)) { Write-Output "ERROR|no existe $Path"; exit 0 }
    $img = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Path).Path)
}

$max = 1568
$scale = [Math]::Min(1.0, $max / [Math]::Max($img.Width, $img.Height))
$w = [int][Math]::Round($img.Width * $scale); $h = [int][Math]::Round($img.Height * $scale)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, $w, $h); $g.Dispose()

$ms = New-Object IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$type = "image/png"
if ($ms.Length -gt 1400000) {
    $ms = New-Object IO.MemoryStream
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $params = New-Object System.Drawing.Imaging.EncoderParameters 1
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 85L
    $bmp.Save($ms, $codec, $params); $type = "image/jpeg"
}
Write-Output ("{0}|{1}|{2}|{3}" -f $type, $w, $h, [Convert]::ToBase64String($ms.ToArray()))
