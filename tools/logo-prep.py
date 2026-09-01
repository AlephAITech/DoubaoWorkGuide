#!/usr/bin/env python3
"""
Logo 后处理（开发用）

1. 从「假矢量」SVG 里取出内嵌的 PNG（尺寸比 favicon 更大）
2. 生成去白底的透明版本，并对边缘做反预乘，避免深色背景上出现白边

    python3 tools/logo-prep.py
"""

import base64
import re
from pathlib import Path

from PIL import Image

BRAND = Path("assets/brand")

# ---- 1. 取出 SVG 内嵌位图 ----------------------------------------------------

svg_path = BRAND / "doubao-logo.svg"
if svg_path.exists():
    svg = svg_path.read_text(encoding="utf-8")
    match = re.search(r'xlink:href="data:image/png;base64,([^"]+)"', svg)
    if match:
        out = BRAND / "doubao-logo-432.png"
        out.write_bytes(base64.b64decode(match.group(1)))
        print(f"取出内嵌位图 → {out} ({Image.open(out).size[0]}px)")

# ---- 2. 去白底 --------------------------------------------------------------

# 只清除「与画布边界相连」以及「面积足够大的封闭白区（环内孔洞）」，
# 图形内部的白色高光会被保留，否则深色背景下会出现斑点。
SAT_MAX = 14
WHITE_HI = 244  # 判定为背景候选的亮度下限
WHITE_LO = 220  # 边缘过渡的亮度下限
MIN_HOLE = 1500  # 封闭白区被视为孔洞的最小面积


def strip_white(src: Path, dst: Path) -> None:
    from collections import deque

    image = Image.open(src).convert("RGBA")
    pixels = image.load()
    width, height = image.size

    def candidate(x, y):
        r, g, b, _ = pixels[x, y]
        mn, mx = min(r, g, b), max(r, g, b)
        return mx - mn <= SAT_MAX and mn >= WHITE_HI

    background = bytearray(width * height)
    visited = bytearray(width * height)

    def flood(seeds, collect=False):
        region = []
        queue = deque(seeds)
        while queue:
            x, y = queue.popleft()
            index = y * width + x
            if visited[index] or not candidate(x, y):
                continue
            visited[index] = 1
            region.append(index)
            if x > 0:
                queue.append((x - 1, y))
            if x < width - 1:
                queue.append((x + 1, y))
            if y > 0:
                queue.append((x, y - 1))
            if y < height - 1:
                queue.append((x, y + 1))
        return region if collect else len(region)

    # 外部背景：从四条边界种子出发
    border = []
    for x in range(width):
        border.append((x, 0))
        border.append((x, height - 1))
    for y in range(height):
        border.append((0, y))
        border.append((width - 1, y))
    for index in flood(border, collect=True):
        background[index] = 1

    # 封闭白区：面积够大的当作孔洞
    holes = 0
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if visited[index] or not candidate(x, y):
                continue
            region = flood([(x, y)], collect=True)
            if len(region) >= MIN_HOLE:
                holes += 1
                for i in region:
                    background[i] = 1

    def is_background(x, y):
        return background[y * width + x] == 1

    # 先把背景清空，再对紧邻背景的过渡像素做 alpha 斜坡
    edges = []
    for y in range(height):
        for x in range(width):
            if is_background(x, y):
                continue
            r, g, b, _ = pixels[x, y]
            mn, mx = min(r, g, b), max(r, g, b)
            if mx - mn > SAT_MAX or mn <= WHITE_LO:
                continue
            near = (
                (x > 0 and is_background(x - 1, y))
                or (x < width - 1 and is_background(x + 1, y))
                or (y > 0 and is_background(x, y - 1))
                or (y < height - 1 and is_background(x, y + 1))
            )
            if near:
                edges.append((x, y, r, g, b, mn))

    for y in range(height):
        for x in range(width):
            if is_background(x, y):
                r, g, b, _ = pixels[x, y]
                pixels[x, y] = (r, g, b, 0)

    for x, y, r, g, b, mn in edges:
        alpha = max(0, min(255, round((WHITE_HI - mn) * 255 / (WHITE_HI - WHITE_LO))))
        if alpha >= 255:
            continue
        if alpha <= 0:
            pixels[x, y] = (r, g, b, 0)
            continue
        ratio = alpha / 255
        # 反预乘：边缘像素本是与白色混合的结果，还原其原色
        unmix = lambda c: max(0, min(255, round((c - 255 * (1 - ratio)) / ratio)))
        pixels[x, y] = (unmix(r), unmix(g), unmix(b), alpha)

    image.save(dst)
    print(
        f"去白底 → {dst}  可见区域 {image.getchannel('A').getbbox()}  "
        f"孔洞 {holes} 处，过渡像素 {len(edges)}"
    )


source = BRAND / "doubao-logo-432.png"
if not source.exists():
    source = BRAND / "doubao-case-library-logo.png"

strip_white(source, BRAND / "doubao-logo-transparent.png")

# ---- 3. 常用尺寸 ------------------------------------------------------------

master = Image.open(BRAND / "doubao-logo-transparent.png")
for size in (512, 256, 128, 64, 32):
    resized = master.resize((size, size), Image.LANCZOS)
    resized.save(BRAND / f"doubao-logo-{size}.png")
print("导出尺寸：512 / 256 / 128 / 64 / 32")

# ---- 4. 站点用的方形标记 ----------------------------------------------------

# 原图四周留白不对称（可见区域 340×360 落在 432 画布里偏上偏右），
# 直接缩到 20px 会显得歪。这里先裁到可见区域再补成正方形居中，
# 让它在字标那种很小的尺寸下也能对齐文字。
SITE = Path("site/assets/brand")
SITE.mkdir(parents=True, exist_ok=True)

box = master.getchannel("A").getbbox()
trimmed = master.crop(box)
side = max(trimmed.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(trimmed, ((side - trimmed.width) // 2, (side - trimmed.height) // 2))

for size in (512, 180, 64, 32):
    square.resize((size, size), Image.LANCZOS).save(SITE / f"doubao-mark-{size}.png")
print(f"站点标记 → {SITE}  裁切前 {master.size} 可见 {trimmed.size} → 方形 {side}px")
