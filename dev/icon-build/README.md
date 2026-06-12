# Icon build

PWA icons are rasterized from the Bootstrap `bi-table` glyph by
screenshotting these pages with headless Edge:

- `any.html` — blue glyph, transparent background, 92% (purpose `any`)
- `maskable.html` — white glyph on brand blue `#0d6efd`, 62% safe-zone
  padding (purpose `maskable`; also the apple-touch style — iOS fills
  transparency with black, so opaque is required there)

**Render at 512 only.** New headless Edge uses a real window and Windows
clamps the minimum window width (~340 px), so any `--window-size` below
that lays out wider than the screenshot crop and the centered glyph
slides off the right edge — this is exactly how the original 192/180
icons shipped broken. Downscale 512 → smaller sizes instead:

```powershell
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
& $edge --headless --disable-gpu --hide-scrollbars --window-size=512,512 `
    --default-background-color=00000000 `
    --screenshot="...\icons\icon-512.png" "file:///...\dev\icon-build\any.html"
& $edge --headless --disable-gpu --hide-scrollbars --window-size=512,512 `
    --screenshot="...\icons\icon-maskable-512.png" "file:///...\dev\icon-build\maskable.html"

Add-Type -AssemblyName System.Drawing
function Resize($src, $dst, $size) {
    $img = [System.Drawing.Image]::FromFile((Resolve-Path $src))
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.SmoothingMode = 'HighQuality'
    $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.Dispose(); $img.Dispose()
    $bmp.Save("$pwd\$dst", [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Resize 'icons\icon-512.png' 'icons\icon-192.png' 192
Resize 'icons\icon-maskable-512.png' 'icons\apple-touch-icon.png' 180
```
