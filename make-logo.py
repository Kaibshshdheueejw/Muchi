#!/usr/bin/env python3
"""Muchi app mark — rounded M + mochi note on a mint disc."""
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
SCALE = 4
W = SIZE * SCALE


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))


def rounded_rect(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def disc_gradient(img, cx, cy, r, inner, outer):
    px = img.load()
    for y in range(max(0, cy - r), min(img.size[1], cy + r + 1)):
        for x in range(max(0, cx - r), min(img.size[0], cx + r + 1)):
            dx, dy = x - cx, y - cy
            d = (dx * dx + dy * dy) ** 0.5
            if d > r:
                continue
            t = d / r
            # highlight from top-left
            hx, hy = dx / r + 0.35, dy / r + 0.45
            shine = max(0.0, 1 - (hx * hx + hy * hy) ** 0.5)
            col = mix(inner, outer, t ** 0.85)
            col = mix(col, (255, 255, 255), shine * 0.28)
            px[x, y] = col + (255,)


def main():
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # squircle background
    pad = int(W * 0.0)
    bg_r = int(W * 0.23)
    rounded_rect(draw, [pad, pad, W - 1 - pad, W - 1 - pad], bg_r, (8, 22, 18, 255))
    # inner wash
    wash = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wash)
    wd.ellipse(
        [int(W * 0.08), int(W * -0.05), int(W * 0.78), int(W * 0.55)],
        fill=(32, 90, 72, 90),
    )
    img = Image.alpha_composite(img, wash)
    draw = ImageDraw.Draw(img)

    cx = cy = W // 2
    cy = int(W * 0.49)
    r = int(W * 0.33)
    disc = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    disc_gradient(disc, cx, cy, r, (186, 255, 230), (18, 196, 140))
    # soft shadow under disc
    sh = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.ellipse([cx - r + 20, cy - r + 40, cx + r + 20, cy + r + 50], fill=(0, 0, 0, 90))
    sh = sh.filter(ImageFilter.GaussianBlur(int(40 * SCALE / 4)))
    img = Image.alpha_composite(img, sh)
    img = Image.alpha_composite(img, disc)
    draw = ImageDraw.Draw(img)

    # rounded M (waveform mountain)
    ink = (6, 36, 28, 255)
    thick = int(W * 0.086)
    left = (int(W * 0.33), int(W * 0.66))
    left_top = (int(W * 0.33), int(W * 0.355))
    mid = (cx, int(W * 0.60))
    right_top = (int(W * 0.67), int(W * 0.355))
    right = (int(W * 0.67), int(W * 0.66))
    draw.line([left, left_top, mid, right_top, right], fill=ink, width=thick, joint="curve")
    # caps
    for pt in (left, left_top, mid, right_top, right):
        rr = thick // 2
        draw.ellipse([pt[0] - rr, pt[1] - rr, pt[0] + rr, pt[1] + rr], fill=ink)

    # mochi note-head sitting in the M valley
    nr = int(W * 0.046)
    nx, ny = cx, int(W * 0.675)
    draw.ellipse([nx - nr, ny - nr, nx + nr, ny + nr], fill=ink)

    out = img.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    out.save("/home/user/aura/public/logo.png", "PNG", optimize=True)
    print("wrote logo.png", out.size, out.mode)


if __name__ == "__main__":
    main()
