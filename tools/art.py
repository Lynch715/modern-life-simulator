#!/usr/bin/env python3
"""把 assets/art/source/ 里的横图（GPT 出的 PNG/JPG/WebP）统一成运行图：
   居中裁到 16:9 → 缩到 960×540 → 不透明 WebP → 压到单张 ≤150 KB，写入 assets/art/scenes/。
   文件名就是 ID（去扩展名）。只认 src/art.js 里 ART_IDS 列出的 ID，别的报警跳过。
用法：python3 tools/art.py          处理全部
      python3 tools/art.py key_interview home_rent   只处理这几个"""
import pathlib, re, sys
from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = root / 'assets/art/source', root / 'assets/art/scenes'
W, H, LIMIT = 960, 540, 150 * 1024
ids = set(re.findall(r"'([a-z0-9_]+)'", re.search(r'const ART_IDS = \[(.*?)\];', (root / 'src/art.js').read_text('utf-8'), re.S).group(1)))

want = set(sys.argv[1:])
OUT.mkdir(parents=True, exist_ok=True)
rows, total = [], 0
for p in sorted(SRC.iterdir()):
    if p.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'): continue
    aid = p.stem.lower()
    if want and aid not in want: continue
    if aid not in ids: print(f'! {p.name}: 不在 ART_IDS 里，跳过'); continue
    im = Image.open(p).convert('RGB')
    w, h = im.size
    # 居中裁成 16:9
    if w / h > 16 / 9:
        nw = round(h * 16 / 9); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    elif w / h < 16 / 9:
        nh = round(w * 9 / 16); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    if im.size[0] < W: print(f'! {p.name}: 源图只有 {w}×{h}，放大会糊')
    im = im.resize((W, H), Image.LANCZOS)
    dst = OUT / f'{aid}.webp'
    for q in (86, 80, 74, 68, 62, 56, 50):
        im.save(dst, 'WEBP', quality=q, method=6)
        n = dst.stat().st_size
        if n <= LIMIT: break
    total += n
    rows.append((aid, f'{w}×{h}', q, n))
    print(f'{"√" if n <= LIMIT else "×"} {aid:22s} 源{w}×{h:<5} q{q:<3} {n/1024:6.1f} KB')
print(f'— {len(rows)} 张，合计 {total/1024/1024:.2f} MB（上限 2.5 MB）')
