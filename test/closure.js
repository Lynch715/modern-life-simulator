/* 指令闭环自测：node test/closure.js
   前半段只跑引擎；后半段开真页面、接口用假的，测请求失败后的重试和读档 */
const E = require('../src/engine.js');
const path = require('path');

let bad = 0;
const ok = (cond, name, more) => { console.log(`${cond ? '过' : '✗ '} ${name}${more ? '　' + more : ''}`); if (!cond) bad++; };
const mk = (freedom, seed) => {
  const S = E.newState({ name: '测', gender: '男', city: '新一线', origin: '普通家庭', track: '创作', freedom: freedom || '写实人生', startYear: 2026, rngSeed: seed || 7 });
  S.job.employer = '明河设计';
  E.addNpcs(S, [{ name: '赵鹏', tie: '朋友', rel: 50 }, { name: '孙姐', tie: '同事', rel: 30 }], 2);
  return S;
};

console.log('—— 引擎 ——');
{ // 1 辞职：绩效好不留裂痕，绩效差才留
  const S = mk(); S.job.perf = 40; E.quitJob(S);
  ok(!S.rifts.length, '绩效好的辞职不留裂痕');
  const S2 = mk(); S2.job.perf = 3; E.quitJob(S2);
  ok(S2.rifts.length === 1, '绩效差的辞职留裂痕');
}
{ // 2 gameOver 只认 true
  const S = mk(); E.applyTurn(S, { gameOver: 'false' }); ok(!S.over, 'gameOver:"false" 不结束');
  E.applyTurn(S, { gameOver: 1 }); ok(!S.over, 'gameOver:1 不结束');
  E.applyTurn(S, { gameOver: true, ending: '收' }); ok(S.over, 'gameOver:true 结束');
}
{ // 3 新工作月薪
  const S = mk(); E.applyTurn(S, { newJob: { employer: '大厂', salary: 1e9, lv: 5 } });
  const R = E.salaryRange(S, S.job.lv);
  ok(S.ledger.salary <= R.hi && S.job.lv <= 2, '十亿月薪被截', `月薪${S.ledger.salary}　职级${S.job.lv}　${S.capNote}`);
  const F = mk('心想事成'); E.applyTurn(F, { newJob: { employer: '大厂', salary: 50000, lv: 4 } });
  ok(F.ledger.salary === 50000 && F.job.lv === 4, '心想事成放宽', `月薪${F.ledger.salary}`);
}
{ // 4 复合指令：辞职 + 还钱 + 开店
  const S = mk(); S.player.money = 6000; E.addDebt(S, '赵鹏', 3000, 60);
  const plan = E.sanitizePlan({ steps: [
    { type: 'quit', text: '辞职' }, { type: 'repay', who: '赵鹏', amount: 3000, text: '还赵鹏三千' },
    { type: 'startBiz', kind: '小店', name: '巷口咖啡', text: '开咖啡店' }] }, '辞职，还清赵鹏三千，然后开咖啡店', true);
  const r = E.runSteps(S, plan, E.mkRng(3));
  ok(S.job.out && S.ledger.salary === 0, '辞职落账', `在职=${!S.job.out} 月薪=${S.ledger.salary}`);
  ok(!(S.debts || []).some(d => d.left > 0), '债务清零');
  ok(!r.results[2].ok && !S.biz, '钱不够开店就没开', r.results[2].note);
  const S2 = mk(); S2.player.money = 500000;
  const r2 = E.runSteps(S2, plan, E.mkRng(3));
  ok(r2.results[2].ok && S2.biz && S2.biz.name === '巷口咖啡', '钱够就开起来', r2.results[2].note);
}
{ // 5 三档要钱
  const out = [];
  for (const f of ['写实人生', '都市传奇', '心想事成']) {
    const S = mk(f); const m0 = S.player.money;
    const r = E.runSteps(S, E.sanitizePlan({ steps: [{ type: 'seekMoney', amount: 1000000, diff: '顺手', text: '找家里要一百万' }] }, 'x', true), E.mkRng(1));
    out.push(`${f} ${r.results[0].ok ? S.player.money - m0 : '没要到'}`);
    if (f === '心想事成') ok(S.player.money - m0 > 500000, '心想事成要一百万给得出大头', out.join('｜'));
  }
}
{ // 6 难度看事不看年龄
  const S = mk(); S.player.age = 45;
  ok(E.stepNeed(S, { diff: '普通', attr: '表达' }) === 20, '45岁做普通的事难度还是20');
  ok(E.stepNeed(S, { diff: '普通', attr: '体能' }) > 20, '体能的事年龄才加难度');
  const r = E.runSteps(S, E.sanitizePlan({ steps: [{ type: 'other', text: '下楼买早饭', diff: '顺手' }] }, 'x', true));
  ok(r.results[0].ok && !r.results[0].ck, '顺手的事不掷骰');
}
{ // 7 长期指令
  const S = mk();
  const r = E.runSteps(S, E.sanitizePlan({ steps: [{ type: 'focus', text: '闭关写作', days: 90 }], days: 90 }, 'x', true));
  ok(r.long === 90 && S.focus && S.focus.days === 90, '闭关三个月转成投入', `long=${r.long}`);
  const S2 = mk();
  const r2 = E.runSteps(S2, E.sanitizePlan({ steps: [{ type: 'other', text: '连续经营' }], days: 30 }, 'x', true));
  ok(r2.long === 30 && S2.focus, '说了天数但没说闷头的，也转成投入');
}
{ // 8 等人回话
  const S = mk(); E.addStopWhen(S, { type: 'npc', who: '孙姐' });
  const a = E.advance(S, { maxDays: 35, rng: E.mkRng(5) });
  ok(a.stop.kind === '条件' && /孙姐/.test(a.stop.detail) && a.days <= 6, '等孙姐回话，停得下来', `${a.days}天 ${a.stop.detail}`);
  const S2 = mk(); E.applyTurn(S2, { nextStop: { type: 'npc', who: '赵鹏' } });
  ok(E.stopList(S2).length === 1, 'nextStop 有人接了');
  const S3 = mk(); S3.stopWhen = { type: 'money', n: 1 };     // 老存档的单个对象
  const a3 = E.advance(S3, { maxDays: 5 });
  ok(a3.stop.kind === '条件', '老存档的停下条件还认');
}
{ // 9 括号：限制和写法要求分开，三档都认
  const p = E.simplePlan('去谈合作（不要替我答应对方条件，等我选择）（写细一点）', true);
  ok(p.limits.length === 1 && p.style.length === 1, '兜底时限制和写法要求分得开', JSON.stringify([p.limits, p.style]));
}
{ // 10 返回值乱写不坏状态
  const S = mk(); const m0 = S.player.money;
  E.applyTurn(S, { playerChanges: { money: 'abc', energy: Infinity, attributes: 'x', statusAdd: 'x' }, npcUpdates: 'x', newNpcs: [{ name: '李', age: 'abc' }], messages: {}, appointments: [{ title: 'a', inDays: 1e9 }], together: { a: 1 }, scene: 'x' });
  ok(S.player.money === m0 && Number.isFinite(S.player.energy) && S.npcs.length === 3, '畸形返回值不出 NaN', `钱${S.player.money} 精力${S.player.energy}`);
  E.applyTurn(S, { playerChanges: { money: 1e8 } });
  ok(S.player.money - m0 <= E.capMoney(S), '叙事里的大钱被截', S.capNote);
}
{ // 11 聊天借钱的额度
  const S = mk(); const n = S.npcs.find(x => x.name === '孙姐');
  const cap = E.lendCap(S, n);
  ok(cap > 0 && cap < 20000, '跟同事借钱有上限', `孙姐最多${cap}`);
  const c = E.sanitizeConvo({ reply: 1, ask: { what: '借五十万', money: 500000 } });
  ok(c.ask.kind === 'borrow' && c.reply === '1', '聊天返回清洗');
}
{ // 12 承诺
  const S = mk(); E.applyTurn(S, { pledges: [{ who: '赵鹏', what: '周末帮他搬家', kind: '主角答应', inDays: 3 }] });
  ok(S.pledges.length === 1, '答应的事记下了');
  E.advance(S, { maxDays: 5, quiet: true }); E.advance(S, { maxDays: 5, quiet: true });
  ok(S.pledges.length === 0 && S.rifts.some(r => r.who === '赵鹏'), '到期没办留裂痕');
  const S2 = mk(); E.applyTurn(S2, { pledges: [{ who: '孙姐', what: '帮她带份材料' }] }); E.applyTurn(S2, { pledgeDone: ['帮她带份材料'] });
  ok(!S2.pledges.length, '办掉的事销账');
}

(async () => {
  console.log('—— 页面 ——');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) { console.log('没装 playwright，页面部分跳过'); return done(); }
  const sse = obj => { const s = JSON.stringify(obj); const out = []; for (let i = 0; i < s.length; i += 60) out.push('data: ' + JSON.stringify({ choices: [{ delta: { content: s.slice(i, i + 60) } }] }) + '\n\n'); return out.join('') + 'data: [DONE]\n\n'; };
  const BOOT = { narrative: '七月一日，你搬进了城西的次卧。“押金这周补上啊。”房东说。', summary: '搬进来', employer: '明河设计', title: '设计助理', place: '城西次卧',
    scene: { location: '城西次卧', unresolved: ['押金还差两千'] },
    npcs: [{ name: '赵鹏', age: 26, job: '跑外卖', tie: '室友', rel: 45, close: true }, { name: '孙姐', age: 38, job: '行政', tie: '同事', rel: 30 }, { name: '妈', age: 52, tie: '家里人', rel: 60 }],
    peers: [{ name: '周野', note: '大厂' }], messages: [], options: ['去楼下吃碗面', '给妈回个电话', '把押金的事想清楚', '早点睡'],
    ladder: [{ name: '先写出来', milestones: [{ title: '写完一个短篇', metric: '投入', need: 50, scene: '提案', gate: '投稿' }] }] };
  const SEG = n => ({ narrative: `第${n}段。“行。”赵鹏说。`, summary: `第${n}段`, scene: { location: '城西次卧', unresolved: [] }, playerChanges: { money: -20 }, options: ['甲', '乙', '丙', '丁'], gameOver: false });
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 375, height: 740 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  let segCalls = 0, failNext = 0, parseCalls = 0, lastSeg = '';
  await pg.route('**/chat/completions', async route => {
    const post = route.request().postData() || '';
    if (post.includes('指令解析器')) {
      parseCalls++;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse({ steps: [
        { type: 'quit', text: '辞职', diff: '普通', attr: '表达' }, { type: 'spend', text: '请赵鹏吃饭', amount: 200, diff: '顺手' }],
        days: 1, limits: ['别替我答应任何事'], style: [], stopWhen: null }) });
    }
    if (post.includes('请铸造开局')) return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse(BOOT) });
    if (failNext > 0) { failNext--; return route.fulfill({ status: 503, body: '{"error":{"message":"忙"}}' }); }
    segCalls++; lastSeg = post;
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse(SEG(segCalls)) });
  });
  await pg.addInitScript(() => localStorage.setItem('mls_cfg', JSON.stringify({ base: 'https://api.deepseek.com', key: 'sk-test', model: 'deepseek-chat' })));
  await pg.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await pg.waitForSelector('#startMask.on');
  await pg.fill('#sName', '沈昭');
  await pg.click('#sFree .seg[data-v="写实人生"]');
  await pg.click('#startGo');
  await pg.waitForSelector('.act-btn', { timeout: 15000 });
  const idle = () => pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });

  // 自由输入走解析 → 引擎办掉 → 叙事拿到结算块
  await pg.fill('#freeAct', '辞职，请赵鹏吃顿饭（别替我答应任何事）');
  await pg.click('#goBtn'); await idle();
  const st = await pg.evaluate(() => ({ out: S.job.out, sal: S.ledger.salary }));
  ok(parseCalls === 1, '自由输入先走了一次解析');
  ok(st.out && st.sal === 0, '辞职在账上落实了');
  ok(/引擎已经结算/.test(lastSeg) && /玩家的限制/.test(lastSeg) && /别替我答应任何事/.test(lastSeg), '叙事请求带着结算块和限制');

  // 请求失败：日子只过一次，重试不重掷
  const before = await pg.evaluate(() => ({ days: S.stats.days, seg: S.seg }));
  failNext = 2;                       // llmJSON 自己会重试一次，两次都失败才算失败
  await pg.click('#acts .act-btn'); await idle();
  const mid = await pg.evaluate(() => ({ days: S.stats.days, seg: S.seg, pending: !!S.pending, btn: document.querySelector('#acts .act-btn').textContent, fate: S.pending && S.pending.judge && S.pending.judge.fate }));
  ok(mid.pending && /再写一次/.test(mid.btn), '失败后只留一个"再写一次"', mid.btn);
  ok(mid.days - before.days === 1, '失败那一段只过了一天', `${before.days}→${mid.days}`);
  // 刷新读档
  await pg.reload();
  await pg.waitForSelector('#acts .act-btn', { timeout: 15000 });
  const re = await pg.evaluate(() => ({ pending: !!S.pending, btn: document.querySelector('#acts .act-btn').textContent }));
  ok(re.pending && /再写一次/.test(re.btn), '刷新以后还能接着写');
  failNext = 0;
  await pg.click('#acts .act-btn'); await idle();
  const after = await pg.evaluate(() => ({ days: S.stats.days, seg: S.seg, pending: !!S.pending }));
  ok(!after.pending && after.days === mid.days && after.seg === mid.seg, '重试不再推进日子', `${mid.days}→${after.days}`);
  ok(/天命骰：/.test(lastSeg) && lastSeg.includes(`天命骰：${mid.fate}`), '重试用的是原来那颗骰子');

  ok(!errs.length, '没有 JS 报错', errs.join(' | '));
  await b.close();
  done();
})();
function done() { console.log(bad ? `\n${bad} 项没过` : '\n全部通过'); process.exitCode = bad ? 1 : 0; }
