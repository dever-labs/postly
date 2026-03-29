"""
Generates Postly app icons for all platforms.
Produces: resources/icon.png (1024x1024), resources/icon.ico (Windows)

Design: dark rounded-square background with a bold white "P" lettermark,
matching the app's dark theme (#030712 background, white text).

Run with: python scripts/generate-icons.py
"""

from PIL import Image, ImageDraw, ImageFont
import os, struct, io

OUT = os.path.join(os.path.dirname(__file__), '..', 'resources')
os.makedirs(OUT, exist_ok=True)

SIZE = 1024

def make_icon(size: int) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded square background  — dark navy matching app bg (#030712)
    pad = size * 0.08
    r   = size * 0.22        # corner radius
    draw.rounded_rectangle([pad, pad, size - pad, size - pad],
                            radius=r, fill=(3, 7, 18, 255))

    # Only draw the blue border at larger sizes (looks bad when tiny)
    if size >= 48:
        border = size * 0.012
        draw.rounded_rectangle(
            [pad + border, pad + border, size - pad - border, size - pad - border],
            radius=r - border, outline=(59, 130, 246, 120), width=max(1, int(size * 0.012)))

    # White "P" lettermark
    font_size = int(size * 0.56)
    font = None
    candidates = [
        'C:/Windows/Fonts/seguisb.ttf',
        'C:/Windows/Fonts/segoeui.ttf',
        'C:/Windows/Fonts/arialbd.ttf',
        'C:/Windows/Fonts/arial.ttf',
    ]
    for path in candidates:
        try:
            font = ImageFont.truetype(path, font_size)
            break
        except OSError:
            continue

    text = 'P'
    if font:
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = (size - tw) / 2 - bbox[0]
        ty = (size - th) / 2 - bbox[1] - size * 0.02
        draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))
    else:
        lw = int(size * 0.10)
        cx = int(size * 0.34)
        top = int(size * 0.22)
        bot = int(size * 0.78)
        draw.rectangle([cx, top, cx + lw, bot], fill=(255, 255, 255, 255))
        bowl_r = int(size * 0.16)
        draw.ellipse([cx + lw, top, cx + lw + bowl_r * 2, top + bowl_r * 2],
                     fill=(255, 255, 255, 255))
        margin = int(lw * 0.7)
        draw.ellipse([cx + lw + margin, top + margin,
                      cx + lw + bowl_r * 2 - margin, top + bowl_r * 2 - margin],
                     fill=(3, 7, 18, 255))

    return img


# ── 1. Save master 1024×1024 PNG ─────────────────────────────────────────────
master = make_icon(SIZE)
png_path = os.path.join(OUT, 'icon.png')
master.save(png_path, 'PNG')
print(f'✓  {png_path}')


# ── 2. Build a multi-resolution ICO for Windows ──────────────────────────────
ico_sizes = [16, 24, 32, 48, 64, 128, 256]
ico_images = []
for s in ico_sizes:
    ico_images.append(make_icon(s).convert('RGBA'))

def build_ico(images: list) -> bytes:
    """Pack RGBA PIL images into a .ico binary."""
    n = len(images)
    # ICO header: reserved(2) + type(2) + count(2)
    header = struct.pack('<HHH', 0, 1, n)
    # Each directory entry is 16 bytes
    dir_entry_size = 16
    data_offset = 6 + n * dir_entry_size

    entries = b''
    data    = b''
    for img in images:
        w, h = img.size
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        raw = buf.getvalue()
        size = len(raw)
        entries += struct.pack('<BBBBHHII',
                               w if w < 256 else 0,
                               h if h < 256 else 0,
                               0,        # color count (0 = no palette)
                               0,        # reserved
                               1,        # color planes
                               32,       # bits per pixel
                               size,
                               data_offset + len(data))
        data += raw

    return header + entries + data

ico_path = os.path.join(OUT, 'icon.ico')
with open(ico_path, 'wb') as f:
    f.write(build_ico(ico_images))
print(f'✓  {ico_path}')


# ── 3. Note about macOS ICNS ─────────────────────────────────────────────────
# electron-builder on macOS will auto-generate .icns from icon.png when
# the mac "icon" field points to a .png. Alternatively, run iconutil on macOS.
# For cross-platform CI, use: electron-icon-builder --input=resources/icon.png
icns_note = os.path.join(OUT, 'icon.icns.readme')
with open(icns_note, 'w') as f:
    f.write('Generate icon.icns on macOS:\n')
    f.write('  npm install -g electron-icon-builder\n')
    f.write('  electron-icon-builder --input=resources/icon.png --output=resources/ --flatten\n')
print(f'ℹ  ICNS note → {icns_note}  (generate on macOS for distribution)')

print('\nDone! Icons written to resources/')
