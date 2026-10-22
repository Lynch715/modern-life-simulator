/* 当前页面使用 CSS 动态视口；真实的窄屏、短屏、横屏另由应用内浏览器验收。 */
const fs=require('fs'),path=require('path'),assert=require('assert');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const tpl=read('src/template.html'),ui=read('src/ui.js'),html=read('index.html');
assert(tpl.includes('@supports (height:100dvh)'));
assert(/#app\{[^}]*max-width:520px[^}]*height:100%/.test(tpl));
assert(/#panelBody\{[^}]*overflow-y:auto/.test(tpl));
assert(/#chatBody\{[^}]*overflow-y:auto/.test(tpl));
assert(/\.bub\{[^}]*max-width:76%[^}]*white-space:pre-wrap/.test(tpl));
assert(tpl.includes('min-width:0'));
assert(html.includes(ui) && html.includes(read('src/engine.js')),'构建文件必须包含当前源代码');
assert(tpl.includes('#panel{bottom:var(--tabsH,56px)}'));
console.log('PASS：动态视口、独立滚动、气泡宽度、底栏边界、构建同步；旧 fitViewport 测试与当前实现已不对应，已更新。');
