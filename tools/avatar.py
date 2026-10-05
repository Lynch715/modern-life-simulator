#!/usr/bin/env python3
"""头像：把 GPT 出的三联图（同一个人 26/44/65 岁横向三格）切成三张头像。
   输入  assets/art/source/avatars/tri_m01.png（任意尺寸，横向三等分）
   产出  assets/art/source/avatars/avatar_m01_{young,mid,old}.png  1024²（正式源图）
         assets/art/avatars/avatar_m01_{young,mid,old}.webp        256²，≤40 KB
   另出接触表 assets/art/avatar_sheet.png：每族一行，三龄原图 + 30px 小图。
用法：python3 tools/avatar.py            处理全部 tri_*.png
      python3 tools/avatar.py m01 f01    只处理这几族
      --square 0.9  每格取中间多大比例的正方形（默认 0.92，脸偏大就调小）"""
import pathlib, sys, re
from PIL import Image, ImageDraw

root = pathlib.Path(__file__).resolve().parent.parent
SRC = root / 'assets/art/source/avatars'; OUT = root / 'assets/art/avatars'
BANDS = ['young', 'mid', 'old']; LIMIT = 40 * 1024
args = sys.argv[1:]
sq = 0.92
if '--square' in args: i = args.index('--square'); sq = float(args[i + 1]); del args[i:i + 2]
want = set(args)
OUT.mkdir(parents=True, exist_ok=True); SRC.mkdir(parents=True, exist_ok=True)

rows = []
for tri in sorted(SRC.glob('tri_*.*')):
    fam = tri.stem[4:].lower()
    if want and fam not in want: continue
    if not re.fullmatch(r'[mf]0[1-6]', fam): print(f'! {tri.name}: 族 ID 不对'); continue
    im = Image.open(tri).convert('RGB'); W, H = im.size; cw = W / 3
    cells = []
    for k, band in enumerate(BANDS):
        cell = im.crop((round(k * cw), 0, round((k + 1) * cw), H))
        side = round(min(cell.size) * sq)
        x0 = (cell.width - side) // 2; y0 = max(0, (cell.height - side) // 2 - round(cell.height * 0.04))   # 略往上，留头顶
        c = cell.crop((x0, y0, x0 + side, y0 + side))
        c.resize((1024, 1024), Image.LANCZOS).save(SRC / f'avatar_{fam}_{band}.png')
        small = c.resize((256, 256), Image.LANCZOS); dst = OUT / f'avatar_{fam}_{band}.webp'
        for q in (88, 82, 76, 70, 64, 58, 50):
            small.save(dst, 'WEBP', quality=q, method=6)
            if dst.stat().st_size <= LIMIT: break
        n = dst.stat().st_size
        print(f'{"√" if n <= LIMIT else "×"} avatar_{fam}_{band:6s} q{q:<3} {n/1024:5.1f} KB')
        cells.append(small)
    rows.append((fam, cells))

if rows:
    CW = 256 + 8; RH = 256 + 40
    sheet = Image.new('RGB', (3 * CW + 3 * 40 + 20, len(rows) * RH), '#1a1c22'); d = ImageDraw.Draw(sheet)
    for r, (fam, cells) in enumerate(rows):
        y = r * RH
        for k, c in enumerate(cells):
            sheet.paste(c, (k * CW, y)); sheet.paste(c.resize((30, 30), Image.LANCZOS), (3 * CW + k * 40, y + 110))
        d.text((4, y + 260), fam, fill='#eee')
    sheet.save(root / 'assets/art/avatar_sheet.png'); print(f'— {len(rows)} 族，接触表 assets/art/avatar_sheet.png')
