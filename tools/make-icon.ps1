# Renders the Moggtify app icon (rounded violet square with an "M" stroke)
# into winres/icon-<size>.png using GDI+. Run from the repo root.
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot "..\winres"
New-Item -ItemType Directory -Force $out | Out-Null

foreach ($size in 256, 64, 48, 32, 24, 16) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [Math]::Max(0.5, $size * 0.04)
    $s = $size - 2 * $pad
    $r = $s * 0.28
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($pad, $pad, 2 * $r, 2 * $r, 180, 90)
    $path.AddArc($pad + $s - 2 * $r, $pad, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($pad + $s - 2 * $r, $pad + $s - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $path.AddArc($pad, $pad + $s - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $path.CloseFigure()

    $rect = New-Object System.Drawing.RectangleF $pad, $pad, $s, $s
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 0xC4, 0xB5, 0xFD)), ([System.Drawing.Color]::FromArgb(255, 0x6D, 0x28, 0xD9)), 50
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
    $blend.Colors = @([System.Drawing.Color]::FromArgb(255, 0xC4, 0xB5, 0xFD), [System.Drawing.Color]::FromArgb(255, 0x8B, 0x5C, 0xF6), [System.Drawing.Color]::FromArgb(255, 0x6D, 0x28, 0xD9))
    $blend.Positions = @(0.0, 0.55, 1.0)
    $brush.InterpolationColors = $blend
    $g.FillPath($brush, $path)

    # subtle top highlight
    $hl = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(70, 255, 255, 255)), ([System.Drawing.Color]::FromArgb(0, 255, 255, 255)), 90
    $g.SetClip($path)
    $g.FillRectangle($hl, $pad, $pad, $s, $s * 0.5)
    $g.ResetClip()

    $w = [Math]::Max(1.6, $size * 0.105)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 0x14, 0x0B, 0x2E)), $w
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $u = $size / 24.0
    $pts = @(
        (New-Object System.Drawing.PointF (4.6 * $u), (18.2 * $u)),
        (New-Object System.Drawing.PointF (4.6 * $u), (7.0 * $u)),
        (New-Object System.Drawing.PointF (12.0 * $u), (13.6 * $u)),
        (New-Object System.Drawing.PointF (19.4 * $u), (7.0 * $u)),
        (New-Object System.Drawing.PointF (19.4 * $u), (18.2 * $u))
    )
    $g.DrawLines($pen, $pts)

    $g.Dispose()
    $bmp.Save((Join-Path $out "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Write-Output "icons written to $out"
