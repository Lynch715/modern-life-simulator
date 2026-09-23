/* 装到桌面 + 离线：node test/pwa.js（自己起一个 http 服务） */
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8731;
const BASE = `http://127.0.0.1:${PORT}/`;

const sse = obj => {
  const s = JSON.stringify(obj);
  return `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\ndata: [DONE]\n\n`;
};
const BOOT = {
  narrative: '七月一日，六楼，没有电梯。', summary: '搬进来了', job: '一份实习', place: '合租次卧',
  scene: { location: '次卧', unresolved: ['押金还差两千'] },
  npcs: [{ name: '赵鹏', age: 26, job: '跑外卖', tie: '室友', care: '省钱', note: '话不多', rel: 25, close: true }],
  peers: [{ name: '周野', note: '进了大厂' }], messages: [{ from: '房东', text: '押金这周补上啊' }],
  options: ['出门转转', '给家里打电话', '把押金的事想清楚', '早点睡'],
  ladder: [{ name: '先写出来', milestones: [{ title: '写完第一个短篇', metric: '投入', need: 50, scene: '提案', gate: '塞给编辑' }] }]
};

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  const b = await chromium.launch();
  const errs = [];
  let ok = true;

  // ---- 1. Chrome：一键装 + sw 接管 + 断网还能进 ----
  const ctx = await b.newContext({ viewport: { width: 430, height: 880 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await pg.route('**/chat/completions', r => r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse(BOOT) }));
  await pg.addInitScript(() => {
    localStorage.setItem('mls_cfg', JSON.stringify({ base: 'https://api.deepseek.com', key: 'sk-test', model: 'm' }));
    if (!sessionStorage.getItem('t_started')) {
      localStorage.removeItem('mls_save'); localStorage.removeItem('mls_install');
      sessionStorage.setItem('t_started', '1');
    }
    // headless 不会自己发这个事件，造一个
    setTimeout(() => {
      const e = new Event('beforeinstallprompt');
      e.prompt = () => { window.__prompted = true; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      dispatchEvent(e);
    }, 400);
  });
  await pg.goto(BASE);
  await pg.waitForSelector('#startMask.on');
  await pg.click('#startGo');
  await pg.waitForSelector('.act-btn', { timeout: 15000 });

  const manifest = await pg.evaluate(async () => {
    const r = await fetch('./site.webmanifest'); const j = await r.json();
    return { name: j.name, start: j.start_url, scope: j.scope, display: j.display, icons: j.icons.map(i => i.sizes + (i.purpose ? '/' + i.purpose : '')) };
  });
  console.log('manifest：', JSON.stringify(manifest));
  for (const need of ['192x192', '512x512']) if (!manifest.icons.some(i => i.startsWith(need))) { ok = false; console.log('少了', need); }

  await pg.waitForTimeout(1500);
  const sw = await pg.evaluate(async () => ({
    reg: !!(await navigator.serviceWorker.getRegistration()),
    ctrl: !!navigator.serviceWorker.controller,
    keys: await caches.keys(),
    cached: (await caches.open('mls-v1')).keys ? (await (await caches.open('mls-v1')).keys()).map(r => new URL(r.url).pathname) : []
  }));
  console.log('service worker：', sw.reg ? '装上了' : '没装上', '｜接管：', sw.ctrl, '｜缓存：', sw.keys.join());
  console.log('缓存了：', sw.cached.join(' '));
  if (!sw.reg || !sw.cached.length) ok = false;

  // 手动调出安装弹窗，点「装上」
  await pg.evaluate(() => window.openInstall(false));
  await pg.waitForSelector('#instMask.on');
  console.log('弹窗文案：', (await pg.textContent('#instBody')).replace(/\s+/g, ' ').slice(0, 40));
  await pg.click('#instGo');
  await pg.waitForTimeout(300);
  const prompted = await pg.evaluate(() => window.__prompted === true && localStorage.getItem('mls_install'));
  console.log('一键安装：', prompted === 'installed' ? '走通了' : '没走通（' + prompted + '）');
  if (prompted !== 'installed') ok = false;

  // 断网重进
  await ctx.setOffline(true);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  const offline = await pg.evaluate(() => ({
    title: document.title,
    hasApp: !!document.getElementById('app'),
    story: document.querySelectorAll('.chapter').length,
    acts: document.querySelectorAll('.act-btn').length
  }));
  console.log('断网重进：', JSON.stringify(offline));
  if (!offline.hasApp || !offline.acts) ok = false;
  await ctx.setOffline(false);
  await ctx.close();

  // ---- 2. iPhone：没有一键装，给的是图文指引 ----
  const ios = await b.newContext(devices['iPhone 13']);
  const p2 = await ios.newPage();
  await p2.route('**/chat/completions', r => r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse(BOOT) }));
  await p2.addInitScript(() => localStorage.setItem('mls_cfg', JSON.stringify({ base: 'x', key: 'k', model: 'm' })));
  await p2.goto(BASE);
  await p2.evaluate(() => window.openInstall(false));
  await p2.waitForSelector('#instMask.on');
  const iosTxt = (await p2.textContent('#instBody')).replace(/\s+/g, ' ');
  const iosBtn = await p2.evaluate(() => getComputedStyle(document.getElementById('instGo')).display);
  console.log('iPhone 指引：', iosTxt.slice(0, 46), '｜安装按钮：', iosBtn === 'none' ? '已隐藏（对）' : '还在（不对）');
  if (!/添加到主屏幕/.test(iosTxt) || iosBtn !== 'none') ok = false;
  await p2.screenshot({ path: 'test/shot-8-install.png' });
  await ios.close();

  // ---- 3. 点过「以后再说」就不该再自己弹 ----
  const c3 = await b.newContext();
  const p3 = await c3.newPage();
  await p3.addInitScript(() => { localStorage.setItem('mls_install', 'dismissed'); localStorage.setItem('mls_cfg', JSON.stringify({ base: 'x', key: 'k', model: 'm' })); });
  await p3.goto(BASE);
  await p3.waitForTimeout(800);
  const shown = await p3.evaluate(() => document.getElementById('instMask').classList.contains('on'));
  console.log('说过以后再说：', shown ? '还在弹（不对）' : '不弹了（对）');
  if (shown) ok = false;
  await c3.close();

  await b.close();
  srv.kill();
  console.log(errs.length ? '\n报错：\n' + errs.join('\n') : '\n没有 JS 报错');
  process.exit(ok && !errs.length ? 0 : 1);
})();
