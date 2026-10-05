#!/usr/bin/env python3
"""把 src/engine.js + src/art.js + src/ui.js + src/install.js 塞进 src/template.html，产出单文件 index.html。
（母版必须待在 src/ 下：仓库顶层只留 index.html，push 脚本才不会把它当母版覆盖掉）
用法：python3 tools/build.py"""
import pathlib, sys, re

root = pathlib.Path(__file__).resolve().parent.parent
tpl = (root / 'src' / 'template.html').read_text(encoding='utf-8')
eng = (root / 'src' / 'engine.js').read_text(encoding='utf-8')
ui = (root / 'src' / 'ui.js').read_text(encoding='utf-8')
art = (root / 'src' / 'art.js').read_text(encoding='utf-8')
# 只引用已经做出来的图
import json
ready = sorted(p.stem for p in (root / 'assets' / 'art' / 'scenes').glob('*.webp'))
art = art.replace('/*==ART_READY==*/null', json.dumps(ready), 1)
print(f'已就位的图 {len(ready)} 张' + ('：' + '、'.join(ready) if ready else ''))
avs = sorted(p.stem for p in (root / 'assets' / 'art' / 'avatars').glob('*.webp'))
art = art.replace('/*==AVATAR_READY==*/null', json.dumps(avs), 1)
print(f'已就位的头像 {len(avs)} 张')
inst = (root / 'src' / 'install.js').read_text(encoding='utf-8')

for name, code in (('ENGINE', eng), ('ART', art), ('UI', ui), ('INSTALL', inst)):
    if '</script' in code.lower():
        sys.exit(f'{name} 里出现了 </script，会把页面截断')
    tpl = tpl.replace(f'/*=={name}==*/', '\n' + code + '\n')

out = root / 'index.html'
out.write_text(tpl, encoding='utf-8')
print(f'写好了 {out}（{len(tpl)/1024:.1f} KB）')
