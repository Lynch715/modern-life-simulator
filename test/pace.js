/* 跑一年，看停下来的次数和理由分布。node test/pace.js */
const E = require('../src/engine.js');

function run(seed, days, opt) {
  opt = opt || {};
  const rng = E.mkRng(seed);
  const S = E.newState({
    name: '测试', gender: '男', city: opt.city || '新一线', origin: opt.origin || '普通家庭',
    track: '创作', freedom: opt.freedom || '写实人生', startYear: 2026, rngSeed: seed, payRoll: rng()
  });
  S.peers = ['周野', '陈可', '许宁', '方越', '李真'].map(n => ({ name: n, note: '同期', track: [] }));
  const stops = [];
  let used = 0;
  while (used < days) {
    const r = E.advance(S, { rng, maxDays: Math.min(35, days - used) });
    used += r.days;
    stops.push({ kind: r.stop.kind, detail: r.stop.detail, days: r.days, date: E.shortDate(r.to) });
    // 模拟玩家做了点什么：偶尔投入一段
    if (!S.focus && rng() < 0.18) S.focus = { what: '赶一件事', days: E.rnd(rng, 5, 20), left: 0, progress: 0, attr: '专业', ideal: 1 };
    if (S.focus && S.focus.left === 0) { S.focus.left = S.focus.days; }
    if (r.stop.kind === '投入') E.settleFocus(S, rng);
  }
  return { S, stops };
}

function stat(list) {
  const by = {};
  for (const s of list) by[s.kind] = (by[s.kind] || 0) + 1;
  return by;
}

let total = 0, runs = 8;
const agg = {};
for (let i = 1; i <= runs; i++) {
  const { S, stops } = run(i * 7919, 365);
  total += stops.length;
  const by = stat(stops);
  for (const k in by) agg[k] = (agg[k] || 0) + by[k];
  if (i === 1) {
    console.log('--- 第一局 365 天的停点 ---');
    for (const s of stops) console.log(`${s.date}  跑了${String(s.days).padStart(2)}天  [${s.kind}] ${s.detail}`);
    console.log('--- 一年后的人 ---');
    console.log('属性', S.player.attrs, '精力', S.player.energy, '存款', S.player.money, '理想进度', S.ideal.progress, '资历', S.player.资历);
    console.log('身上的毛病', S.status.map(x => x.name + x.days + '天'));
  }
}
console.log(`\n平均一年停 ${(total / runs).toFixed(1)} 次`);
console.log('理由分布（8 局合计）', agg);

// 三种城市/出身的对照
for (const c of ['一线', '新一线', '老家县城']) {
  let t = 0;
  for (let i = 1; i <= 5; i++) t += run(i * 104729, 365, { city: c }).stops.length;
  console.log(`${c}：一年 ${(t / 5).toFixed(1)} 次`);
}
