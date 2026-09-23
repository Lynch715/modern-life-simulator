#!/usr/bin/env python3
"""把 src/engine.js + src/ui.js + src/install.js 塞进 src/template.html，产出单文件 index.html。
（母版必须待在 src/ 下：仓库顶层只留 index.html，push 脚本才不会把它当母版覆盖掉）
用法：python3 tools/build.py"""
import pathlib, sys, re

root = pathlib.Path(__file__).resolve().parent.parent
tpl = (root / 'src' / 'template.html').read_text(encoding='utf-8')
eng = (root / 'src' / 'engine.js').read_text(encoding='utf-8')
ui = (root / 'src' / 'ui.js').read_text(encoding='utf-8')
inst = (root / 'src' / 'install.js').read_text(encoding='utf-8')

for name, code in (('ENGINE', eng), ('UI', ui), ('INSTALL', inst)):
    if '</script' in code.lower():
        sys.exit(f'{name} 里出现了 </script，会把页面截断')
    tpl = tpl.replace(f'/*=={name}==*/', '\n' + code + '\n')

out = root / 'index.html'
out.write_text(tpl, encoding='utf-8')
print(f'写好了 {out}（{len(tpl)/1024:.1f} KB）')
