"""
Gerador de icones e splash screens para Integra360
Logo original: 1408x768
Emblema circular detectado em: x=470..935, y=55..525
"""

from PIL import Image, ImageDraw, ImageFilter
import os

ROOT = r"C:\Users\Herick\Documents\SISTEMA SHAWARMA"
SRC  = os.path.join(ROOT, "integra360logo.png")
OUT  = os.path.join(ROOT, "brand")
os.makedirs(OUT, exist_ok=True)

# Tema
BG_DARK      = (22, 33, 29)
BG_DARK_GRAD = (10, 18, 14)
GOLD         = (200, 140, 30)

# ── 1. Carregar logo ──────────────────────────────────────────────────────────
orig = Image.open(SRC).convert("RGB")
W, H = orig.size
print(f"Original: {W}x{H}")

# ── 2. Crop preciso do emblema circular ──────────────────────────────────────
# Baseado na analise de pixels:
#  - Emblema: y=55..525 (470px), x=470..935 (465px) -> quadrado ~470px
#  - Texto abaixo (Integra360): y=540..620
# Fazemos um crop quadrado bem ajustado ao circulo:
CROP = (468, 48, 942, 522)   # (x1,y1,x2,y2)  474px x 474px
emblem_sq = orig.crop(CROP).resize((1024, 1024), Image.LANCZOS)

# Salvar versao sem mascara para inspecao
emblem_sq.save(os.path.join(OUT, "_debug_crop.png"))
print("  Debug crop salvo: _debug_crop.png")

# ── 3. Mascara circular ────────────────────────────────────────────────────
def circle_mask(size=1024, pad=6, blur=5):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse([pad, pad, size-pad, size-pad], fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur))

icon_rgba = emblem_sq.convert("RGBA")
mask_1024 = circle_mask(1024, pad=8, blur=6)
r2, g2, b2, _ = icon_rgba.split()
icon_circle = Image.merge("RGBA", (r2, g2, b2, mask_1024))

icon_circle.save(os.path.join(OUT, "icon_1024.png"))
print("OK icon_1024.png")

# ── 4. Multiplos tamanhos ─────────────────────────────────────────────────
sizes = [16, 32, 48, 64, 128, 256, 512, 1024]
pngs = {}
for s in sizes:
    img_s = icon_circle.resize((s, s), Image.LANCZOS)
    img_s.save(os.path.join(OUT, f"icon_{s}.png"))
    pngs[s] = img_s
print(f"OK PNGs {sizes}")

# ── 5. icon.ico (Windows / Electron) ─────────────────────────────────────
pngs[256].save(
    os.path.join(OUT, "icon.ico"),
    format="ICO",
    sizes=[(s,s) for s in [16,32,48,64,128,256]]
)
print("OK icon.ico")

# icon.png Electron Linux / macOS (512px, RGBA)
pngs[512].save(os.path.join(OUT, "icon.png"))
print("OK icon.png (512px)")

# ── 6. Icone com fundo escuro (android launcher) ──────────────────────────
def on_dark_bg(icon, size=1024, pad_ratio=0.08):
    bg = Image.new("RGBA", (size, size), (*BG_DARK, 255))
    p = int(size * pad_ratio)
    ic = icon.resize((size-2*p, size-2*p), Image.LANCZOS)
    bg.paste(ic, (p, p), ic)
    return bg

icon_on_bg = on_dark_bg(icon_circle, 1024, 0.08)
icon_on_bg.save(os.path.join(OUT, "icon_bg_1024.png"))
print("OK icon_bg_1024.png")

# Android adaptive icon foreground (margem 18%)
adaptive = Image.new("RGBA", (1024, 1024), (0,0,0,0))
margin = int(1024 * 0.18)
inner = icon_circle.resize((1024-2*margin, 1024-2*margin), Image.LANCZOS)
adaptive.paste(inner, (margin, margin), inner)
adaptive.save(os.path.join(OUT, "android_adaptive_fg.png"))
print("OK android_adaptive_fg.png")

# ── 7. Utilitarios de fundo ───────────────────────────────────────────────
def gradient_bg(w, h, c1=BG_DARK_GRAD, c2=BG_DARK):
    img = Image.new("RGB", (w, h))
    for y in range(h):
        t = y / h
        c = tuple(int(c1[i]+(c2[i]-c1[i])*t) for i in range(3))
        img.paste(c, [0, y, w, y+1])
    return img.convert("RGBA")

def add_rings(img, cx, cy, alpha=10):
    d = ImageDraw.Draw(img)
    for r in range(120, 900, 90):
        d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(255,255,255,alpha), width=1)

def gold_line(img, cx, y, half=140):
    d = ImageDraw.Draw(img)
    d.line([(cx-half, y), (cx+half, y)], fill=(*GOLD, 180), width=2)
    d.line([(cx-half//2, y+8), (cx+half//2, y+8)], fill=(255,255,255,40), width=1)

# ── 8. Splash MOBILE 1080x1920 ────────────────────────────────────────────
SW, SH = 1080, 1920
bg = gradient_bg(SW, SH)
add_rings(bg, SW//2, SH//2)
lw = int(SW * 0.62)
logo = icon_circle.resize((lw, lw), Image.LANCZOS)
lx, ly = (SW-lw)//2, int(SH*0.22)
bg.paste(logo, (lx, ly), logo)
gold_line(bg, SW//2, ly+lw+50, half=180)
bg.convert("RGB").save(os.path.join(OUT, "splash_mobile_1080x1920.png"))
print("OK splash_mobile_1080x1920.png")

# Splash quadrado 1024x1024 (Android ldpi splash / feature graphic)
SQ = 1024
bg_sq = gradient_bg(SQ, SQ)
add_rings(bg_sq, SQ//2, SQ//2)
lsq = int(SQ * 0.62)
logo_sq = icon_circle.resize((lsq, lsq), Image.LANCZOS)
bg_sq.paste(logo_sq, ((SQ-lsq)//2, (SQ-lsq)//2), logo_sq)
bg_sq.convert("RGB").save(os.path.join(OUT, "splash_square_1024.png"))
print("OK splash_square_1024.png")

# Splash 2048x2048 (Android feature graphic)
SQ2 = 2048
bg_sq2 = gradient_bg(SQ2, SQ2)
add_rings(bg_sq2, SQ2//2, SQ2//2, alpha=8)
lsq2 = int(SQ2 * 0.55)
logo_sq2 = icon_circle.resize((lsq2, lsq2), Image.LANCZOS)
bg_sq2.paste(logo_sq2, ((SQ2-lsq2)//2, (SQ2-lsq2)//2), logo_sq2)
bg_sq2.convert("RGB").save(os.path.join(OUT, "splash_square_2048.png"))
print("OK splash_square_2048.png")

# ── 9. Splash DESKTOP 1920x1080 ───────────────────────────────────────────
DW, DH = 1920, 1080
bg_d = gradient_bg(DW, DH)
add_rings(bg_d, DW//2, DH//2, alpha=8)
ldh = int(DH * 0.60)
logo_d = icon_circle.resize((ldh, ldh), Image.LANCZOS)
dx, dy = (DW-ldh)//2, (DH-ldh)//2-30
bg_d.paste(logo_d, (dx, dy), logo_d)
gold_line(bg_d, DW//2, dy+ldh+44, half=200)
bg_d.convert("RGB").save(os.path.join(OUT, "splash_desktop_1920x1080.png"))
print("OK splash_desktop_1920x1080.png")

# ── 10. Splash ELECTRON 600x400 ───────────────────────────────────────────
EW, EH = 600, 400
bg_e = gradient_bg(EW, EH)
add_rings(bg_e, EW//2, EH//2)
leh = int(EH * 0.62)
logo_e = icon_circle.resize((leh, leh), Image.LANCZOS)
ex, ey = (EW-leh)//2, (EH-leh)//2-18
bg_e.paste(logo_e, (ex, ey), logo_e)
gold_line(bg_e, EW//2, ey+leh+28, half=100)
bg_e.convert("RGB").save(os.path.join(OUT, "splash_electron_600x400.png"))
print("OK splash_electron_600x400.png")

# ── 11. Resumo ────────────────────────────────────────────────────────────
print("\nArquivos gerados em:", OUT)
for f in sorted(os.listdir(OUT)):
    kb = os.path.getsize(os.path.join(OUT, f)) // 1024
    print(f"  {f:<48} {kb:>5} KB")
