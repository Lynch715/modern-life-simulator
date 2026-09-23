/* 开店回本测算：node test/biz.js —— 三种经营法跑 48 个月，看多久回本 */
const E = require('../src/engine.js');
function sim(kind, city, pace, staffN, freedom, seed) {
  const rng = E.mkRng(seed);
  const S = E.newState({ name: '测', gender: '男', city, origin: '普通家庭', track: '创业', freedom, startYear: 2026, rngSeed: seed, payRoll: 0.5 });
  S.player.money = 1e7; S.player.attrs['专业'] = 45; S.player.attrs['谋划'] = 50; S.player.attrF['专业'] = 45;
  const r = E.openBiz(S, { kind, name: '店' }, rng);
  if (!r.ok) return null;
  for (let i = 0; i < staffN; i++) { const c = E.bizCandidates(S, rng).sort((a, b) => b.skill - a.skill)[0]; E.hireBiz(S, c); }
  E.setPace(S, pace);
  let cum = 0, back = null; const need = r.need;
  for (let m = 1; m <= 48; m++) {
    for (let d = 0; d < 30; d++) {   // 22 个工作日 + 8 个周末，照重心排出来的时段算盯店
      const t = d < 22 ? S.schedule.work : S.schedule.rest;
      for (const sl of E.SLOTS) if (t[sl] === '主业') S.biz.tend += (sl === '晚上' || sl === '深夜') ? 1.3 : 1;
    }
    // 招的人走了就再补
    while (S.biz.staff.length < staffN) { const c = E.bizCandidates(S, rng).sort((a, b) => b.skill - a.skill)[0]; E.hireBiz(S, c); }
    const b = E.bizMonth(S, rng); cum += b.net;
    if (back === null && cum >= need) back = m;
  }
  return { need, avgNet: Math.round(cum / 48), back, rep: Math.round(S.biz.rep) };
}
for (const city of ['一线', '新一线', '老家县城']) for (const kind of ['小店', '工作室', '小公司']) {
  const row = [];
  for (const [pace, n] of [['拼工作', kind === '小公司' ? 3 : 2], ['两头兼顾', 1], ['歇一歇', 1]]) {
    let backs = [], nets = [];
    for (let s = 1; s <= 12; s++) { const r = sim(kind, city, pace, n, '都市传奇', s * 131); nets.push(r.avgNet); backs.push(r.back || 99); }
    backs.sort((a, b) => a - b);
    row.push(`${pace}${n}人 月均净${Math.round(nets.reduce((a, b) => a + b) / nets.length)} 回本中位${backs[6] === 99 ? '没回' : backs[6] + '月'}`);
  }
  console.log(city, kind, E.bizSetup({ city }, kind), '｜', row.join('｜'));
}
