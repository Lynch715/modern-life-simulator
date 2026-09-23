/* 关键局胜率。node test/key.js */
const E = require('../src/engine.js');
function sim(attr, hard, type, seed, policy) {
  const rng = E.mkRng(seed);
  const S = E.newState({ name: 'x', city: '新一线', origin: '普通家庭', track: '职场', freedom: '写实人生', startYear: 2026, rngSeed: seed, payRoll: .5 });
  for (const a of E.ATTRS) { S.player.attrs[a] = attr; S.player.attrF[a] = attr; }
  S.player.energy = 70;
  E.startKey(S, { scene: '谈判', name: '对方', type, hard, rng });
  let n = 0;
  while (!S.key.over && n < 12) {
    const K = S.key;
    let mv;
    if (policy === 'naive') mv = '摆事实';
    else if (K.nerve < 26) mv = '稳一稳';
    else if (!K.usedCard && K.round >= 4) mv = '亮底牌';
    else {
      const T = E.OPP_TYPES[K.opp.type].mul;
      let cand = ['摆事实', '讲故事', '共情', '施压', '让步'].filter(x => x !== K.lastMove);
      if (policy === 'aim') cand = cand.filter(x => (T[x] || 1) >= 1);           // 对症下药
      if (!cand.length) cand = ['摆事实'];
      cand.sort((a, b) => (((K.used || {})[a] || 0) - ((K.used || {})[b] || 0)) || ((T[b] || 1) - (T[a] || 1)));
      mv = cand[0];
    }
    E.keyRound(S, mv, rng);
    n++;
  }
  return S.key ? S.key.result : null;
}
function rate(attr, hard, type, policy) {
  const c = { 谈成: 0, 留口子: 0, 谈崩: 0 };
  for (let i = 1; i <= 600; i++) c[sim(attr, hard, type, i * 2654435761 % 2147483647, policy)]++;
  return `成${(c.谈成 / 6).toFixed(0)}% 口${(c.留口子 / 6).toFixed(0)}% 崩${(c.谈崩 / 6).toFixed(0)}%`;
}
console.log('（会打的人）');
for (const [a, h] of [[25, 32], [25, 45], [25, 60], [45, 45], [45, 60], [65, 60], [65, 75], [85, 80]])
  console.log(` 属性${a} 门槛${h}：${rate(a, h, '务实', 'ok')}`);
console.log('（一直摆事实的人，属性45 门槛45）：' + rate(45, 45, '务实', 'naive'));
console.log('（各种对手，属性45 门槛50）　　乱打 / 会打 / 对症');
for (const t of Object.keys(E.OPP_TYPES))
  console.log(` ${t}：${rate(45, 50, t, 'naive')}　|　${rate(45, 50, t, 'ok')}　|　${rate(45, 50, t, 'aim')}`);
