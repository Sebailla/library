"""Generate app icon for alejandria-v2 (macOS .icns + PNG set).

Produces a 1024x1024 master PNG and the standard macOS .icns with
all required sizes (16, 32, 64, 128, 256, 512 @1x and @2x).

The design is a stylised open book on a warm parchment background,
keeping the academic library aesthetic.
"""
from PIL import Image, ImageDraw, ImageFont
import os
import subprocess
import sys

OUTPUT_DIR = "apps/mac/build-resources"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 1024x1024 master canvas
SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Rounded-square background (macOS Big Sur icon style)
# Warm parchment color
BG = (242, 232, 213, 255)  # rgb(242,232,213)
INK = (58, 42, 27, 255)       # dark brown text
ACCENT = (148, 95, 47, 255)   # warm brown

# Rounded rect mask for the background
def rounded_rect(w, h, radius):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w, h), radius=radius, fill=BG)
    return img

mask = rounded_rect(SIZE, SIZE, 200)
img.paste(mask, (0, 0), mask)

# Open book: two pages with a slight gap
# Page rectangles
margin = 130
page_w = (SIZE - 2 * margin - 20) // 2
page_h = SIZE - 2 * margin - 60
left_x0 = margin
left_x1 = left_x0 + page_w
right_x0 = left_x1 + 20
right_x1 = right_x0 + page_w
page_y0 = margin + 30
page_y1 = page_y0 + page_h

# Subtle shadow
shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle((left_x0 + 10, page_y0 + 10, left_x1, page_y1), 6, fill=(0, 0, 0, 25))
sd.rounded_rectangle((right_x0 + 10, page_y0 + 10, right_x1, page_y1), 6, fill=(0, 0, 0, 25))
img.paste(shadow, (0, 0), shadow)

# Pages
draw.rounded_rectangle((left_x0, page_y0, left_x1, page_y1), 6, fill=(255, 250, 240, 255), outline=INK, width=3)
draw.rounded_rectangle((right_x0, page_y0, right_x1, page_y1), 6, fill=(255, 250, 240, 255), outline=INK, width=3)

# Text lines on left page (lines of "text")
def draw_text_lines(x0, y0, x1, y1, n_lines=8, line_h=22, indent_px=20):
    for i in range(n_lines):
        y = y0 + 30 + i * line_h
        x_end = x1 - indent_px - (i * 5 % 30)  # slight ragged right edge
        x_start = x0 + indent_px
        draw.line((x_start, y, x_end, y), fill=INK, width=4)

draw_text_lines(left_x0, page_y0, left_x1, page_y1)
draw_text_lines(right_x0, page_y0, right_x1, page_y1)

# Spine accent
spine_x = (left_x1 + right_x0) // 2
draw.line((spine_x, page_y0 - 10, spine_x, page_y1 + 10), fill=ACCENT, width=6)

# Bookmark ribbon (a small accent at the top)
draw.polygon(
    [
        (right_x0 + 80, page_y0 - 20),
        (right_x0 + 80, page_y0 + 60),
        (right_x0 + 70, page_y0 + 60),
        (right_x0 + 70, page_y0 - 10),
    ],
    fill=(192, 41, 41, 255),  # red bookmark
)

# Top "alejandria" text
try:
    # Try a serif font if available
    font_large = ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia.ttf", 72)
    font_small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia.ttf", 28)
except OSError:
    try:
        font_large = ImageFont.truetype("/System/Library/Fonts/Georgia.ttf", 72)
        font_small = ImageFont.truetype("/System/Library/Fonts/Georgia.ttf", 28)
    except OSError:
        font_large = ImageFont.load_default()
        font_small = ImageFont.load_default()

# "alejandria" text on the bottom margin
text = "alejandria"
bbox = draw.textbbox((0, 0), text, font=font_large)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
draw.text(((SIZE - tw) / 2, SIZE - 130), text, font=font_large, fill=INK)

# Save master PNG
master_png = os.path.join(OUTPUT_DIR, "icon.png")
img.save(master_png)
print(f"  master: {master_png} ({SIZE}x{SIZE})")

# Generate PNG set for electron-builder
PNG_SIZES = {
    "icon.png": SIZE,                  # 1024 (default)
    "16x16.png": 16,
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "256x256.png": 256,
    "512x512.png": 512,
    "1024x1024.png": 1024,
}
for name, sz in PNG_SIZES.items():
    if sz == SIZE:
        continue  # already saved as icon.png
    resized = img.resize((sz, sz), Image.LANCZOS)
    out_path = os.path.join(OUTPUT_DIR, name)
    resized.save(out_path)
    print(f"  {name}: {sz}x{sz}")

# Generate .icns using iconutil (macOS only)
icns_path = os.path.join(OUTPUT_DIR, "icon.icns")
iconset_dir = os.path.join(OUTPUT_DIR, "icon.iconset")
os.makedirs(iconset_dir, exist_ok=True)
ICNS_SIZES = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}
for name, sz in ICNS_SIZES.items():
    p = os.path.join(iconset_dir, name)
    img.resize((sz, sz), Image.LANCZOS).save(p)
print(f"  iconset: {len(ICNS_SIZES)} files in {iconset_dir}")

# Build .icns using iconutil (macOS)
if sys.platform == "darwin":
    subprocess.run(["iconutil", "-c", "icns", "-o", icns_path, iconset_dir], check=True)
    print(f"  icns: {icns_path}")
else:
    print("  (skipping icns generation — iconutil only available on macOS)")

print("\nDone.")
