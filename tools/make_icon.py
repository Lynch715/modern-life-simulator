#!/usr/bin/env python3
"""现代生活模拟器的图标：深底 + 金色衬线「活」。python3 tools/make_icon.py"""
import io, os, struct, pathlib
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'icon'; OUT.mkdir(exist_ok=True)
SERIF = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'
CH = '活'
BG1, BG2 = (18, 21, 29), (12, 14, 19)
GOLD = (214, 162, 94)
GOLD_HI = (238, 199, 140)

def glyph(size, color, ratio):
    """把字渲染成一张 RGBA，按真实墨迹居中，再按重心补偏移"""
    big = 1024
    f = ImageFont.truetype(SERIF, int(big * 0.78))
    layer = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((big // 2, big // 2), CH, font=f, fill=color + (255,), anchor='mm')
    bb = layer.getbbox()
    cut = layer.crop(bb)
    # 墨迹重心：汉字左右疏密不均，几何居中会看着偏
    px = cut.load()
    sx = sw = 0
    for y in range(0, cut.height, 4):
        for x in range(0, cut.width, 4):
            a = px[x, y][3]
            if a > 40: sx += x * a; sw += a
    cx = sx / sw if sw else cut.width / 2
    shift = int(round((cut.width / 2 - cx) * 0.55))   # 往重心的反方向补一点
    box = size * ratio
    k = box / max(cut.width, cut.height)
    w, h = max(1, int(cut.width * k)), max(1, int(cut.height * k))
    cut = cut.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(cut, ((size - w) // 2 + int(shift * w / max(1, cut.width) * 0.1), (size - h) // 2), cut)
    return canvas

def plate(size, radius_ratio=0.22, border=True):
    """深色圆角底 + 竖向渐变 + 细金边"""
    ss = 4 if size <= 256 else 2
    S = size * ss
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    grad = Image.new('RGB', (1, S))
    for y in range(S):
        t = y / max(1, S - 1)
        grad.putpixel((0, y), tuple(int(BG1[i] + (BG2[i] - BG1[i]) * t) for i in range(3)))
    grad = grad.resize((S, S))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=255)
    im.paste(grad, (0, 0), mask)
    if border:
        d = ImageDraw.Draw(im)
        pad = int(S * 0.075)
        d.rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad],
                            radius=int(S * radius_ratio * 0.66), outline=GOLD + (56,), width=max(2, int(S * 0.005)))
    return im.resize((size, size), Image.LANCZOS)

def render(size, maskable=False):
    # 小尺寸单独走一条路：没有渐变、没有边框、字更大、对比拉满
    if size <= 32:
        im = Image.new('RGBA', (size, size), (13, 15, 20, 255))
        g = glyph(size, GOLD_HI, 0.80)
        im.alpha_composite(g)
        return im
    im = plate(size, 0.22 if not maskable else 0.0, border=not maskable)
    g = glyph(size, GOLD, 0.52 if not maskable else 0.42)
    # 极淡的一层光，别过头
    if size >= 128:
        halo = g.filter(ImageFilter.GaussianBlur(size * 0.035))
        im.alpha_composite(Image.blend(Image.new('RGBA', (size, size), (0, 0, 0, 0)), halo, 0.35))
    im.alpha_composite(g)
    return im

SIZES = [1024, 512, 256, 192, 180, 128, 64, 48, 32, 16]
for s in SIZES:
    render(s).save(OUT / f'icon-{s}.png', 'PNG', optimize=True)
render(512, maskable=True).save(OUT / 'maskable-512.png', 'PNG', optimize=True)

# favicon.ico：六档
ico = [render(s).convert('RGBA') for s in (256, 128, 64, 48, 32, 16)]
ico[0].save(ROOT / 'favicon.ico', append_images=ico[1:], sizes=[(s, s) for s in (256, 128, 64, 48, 32, 16)])

# .icns 自己拼
ICNS = [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128), ("ic08", 256), ("ic09", 512),
        ("ic10", 1024), ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512)]
chunks = b""
for t, s in ICNS:
    buf = io.BytesIO(); render(s).save(buf, "PNG", optimize=True)
    d = buf.getvalue()
    chunks += t.encode() + struct.pack(">I", len(d) + 8) + d
(OUT / '现代生活模拟器.icns').write_bytes(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)

(OUT / '怎么用.txt').write_text('''图标怎么用

Mac 上给文件夹或 app 换图标：
  选中 现代生活模拟器.icns，⌘C 复制；再选中要换的东西，⌘I 打开简介，
  点左上角那个小图标让它高亮，⌘V 粘贴。

iPhone 添加到主屏幕：
  Safari 打开网址 → 底部工具栏的分享按钮 → 往下找「添加到主屏幕」→ 右上角添加。
  图标和名字会自动取网页里配好的那套。

Mac Safari 添加到程序坞：
  菜单栏 文件 → 添加到程序坞。

Chrome / Edge：
  地址栏右侧会有一个安装按钮，或者进游戏玩一会儿会自己问你要不要装。

文件清单：
  icon-1024/512/256/192/180/128/64/48/32/16.png   各处用的方图
  maskable-512.png                                 安卓自适应图标（会被裁成圆角）
  现代生活模拟器.icns                              macOS
  ../favicon.ico                                   浏览器标签页
''', encoding='utf-8')

print('画好了：', ', '.join(p.name for p in sorted(OUT.iterdir())))
