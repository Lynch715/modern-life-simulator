/* 指令闭环自测：node test/closure.js
   前半段只跑引擎；后半段开真页面、接口用假的，测请求失败后的重试和读档 */
const E = require("../src/engine.js");
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

{ // 13 到期的约定
  const S = mk(); E.addPledge(S, { who: '赵鹏', what: '帮他搬家', kind: '主角答应', inDays: 4 });
  const a = E.advance(S, { maxDays: 35, rng: E.mkRng(2) });
  ok(a.stop.kind === '承诺' && a.days === 4 && a.stop.promise.who === '赵鹏', '答应的事到期那天停下来', `${a.days}天 ${a.stop.detail}`);
  const dt = E.delayPromise(S, a.stop.promise, 3);
  const b2 = E.advance(S, { maxDays: 35, rng: E.mkRng(3) });
  ok(b2.stop.kind === '承诺' && b2.days === 3, '改期以后到新日子再停', `${b2.days}天`);
  E.breakPromise(S, b2.stop.promise);
  ok(!S.pledges.length && S.rifts.some(r => r.who === '赵鹏'), '不去了：销账、留裂痕');
  const S2 = mk(); S2.appts.push(Object.assign(E.addDays(S2.date, 2), { title: '孙姐介绍的人：见面', kind: '约', done: false }));
  const c = E.advance(S2, { maxDays: 35, quiet: true });
  ok(c.stop.kind === '约' && c.stop.promise.who === '孙姐', '约好的事也停，认得出是跟谁', c.stop.promise.who);
}

{ // 14 朋友圈
  const S = mk(); const n = S.npcs.find(x => x.name === '赵鹏'); const r0 = n.rel;
  for (let i = 0; i < 5; i++) E.momentRel(S, n, 2);
  ok(n.rel - r0 === 2, '朋友圈涨关系每人每天最多2', `${r0}→${n.rel}`);
  E.applyTurn(S, { moments: [{ who: '孙姐', text: '加班到十点', likes: ['赵鹏', '路人甲'], cs: [{ who: '赵鹏', text: '辛苦', to: '' }, { who: '路人乙', text: '不该出现' }, { who: '测', text: '主角不该被代写' }] }] });
  const m = S.moments[S.moments.length - 1];
  ok(m.likers.join() === '赵鹏' && m.cs.length === 1 && m.cs[0].who === '赵鹏', '别人的朋友圈只认通讯录里的人，不替主角留言', JSON.stringify([m.likers, m.cs.map(c => c.who)]));
  const c = E.commentMoment(S, m.id, '孙姐', '你也是', '赵鹏');
  ok(c.to === '赵鹏', '留言记下回复谁');
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
  const pg = await b.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
  const shot = async n => { if (process.env.SHOT) { await pg.waitForTimeout(300); await pg.screenshot({ path: `${process.env.SHOT}/${n}.png` }); } };
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  let lastSegRaw = '', lastConvoRaw = '', groupCalls = 0, lastGroup = '', segCalls = 0, failNext = 0, parseCalls = 0, lastSeg = '', convoCalls = 0, lastConvo = '';
  await pg.route('**/chat/completions', async route => {
    const post = route.request().postData() || '';
    if (post.includes('指令解析器')) {
      parseCalls++;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse({ steps: [
        { type: 'quit', text: '辞职', diff: '普通', attr: '表达' }, { type: 'spend', text: '请赵鹏吃饭', amount: 200, diff: '顺手' }],
        days: 1, limits: ['别替我答应任何事'], style: [], stopWhen: null }) });
    }
    if (post.includes('这一轮写谁会接主角刚发的这句')) {
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse({ cs: [{ who: '孙姐', to: '', text: '行 周六来', rel: 1 }], deal: [{ who: '孙姐', kind: '对方答应', what: '周六来家里吃饭', inDays: 4 }, { who: '外人', kind: '对方答应', what: '不该记' }] }) });
    }
    if (post.includes('拉的微信群')) {
      groupCalls++; lastGroup = post;
      const body = { replies: [{ who: '赵鹏', text: '收到' }, { who: '孙姐', text: '谢谢老板' }, { who: '外人', text: '不该出现' }], gist: '群里抢红包', deal: [], summary: '群聊' };
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse(body) });
    }
    if (post.includes('你现在扮演的是')) {
      convoCalls++; lastConvo = post; lastConvoRaw = post;
      const say = (JSON.parse(post).messages[1].content.match(/【主角刚发的这句——你这一轮要回的就是它】(.*)/) || [])[1] || '';
      let body = { reply: '回：' + say, mood: '平常', rel: 3, gist: '一路聊着', ask: null, deal: [], cold: convoCalls > 3, summary: '聊天' };
      if (post.includes('引擎判定（不可更改）')) body = { reply: '行 借你', mood: '爽快', rel: 1, ask: null, deal: [], cold: false, summary: '借钱' };
      else if (say.includes('借我')) body = { reply: '这句不该出现', mood: '', rel: 0, ask: { what: '借两千', kind: 'borrow', attr: '表达', need: 20, money: 2000, days: 30 }, deal: [], summary: '借钱' };
      else if (say.includes('[给你转账') && say.includes('不要')) body = { reply: '你留着吧 我不要', mood: '推', rel: 0, ask: null, deal: [], refund: true, summary: '退回' };
      else if (say.includes('[给你')) body = { reply: '谢了啊', mood: '高兴', rel: 1, ask: null, deal: [], summary: '收钱' };
      else if (say.includes('给我点钱')) body = { reply: '拿着', mood: '大方', rel: 0, ask: null, deal: [], pay: { kind: '红包', amount: 1000000, note: '别乱花' }, summary: '给钱' };
      else if (say.includes('来住')) body = { reply: '那我周五搬过来', mood: '高兴', rel: 2, ask: null, deal: [{ kind: '主角答应', what: '让她来借住两天', inDays: 5 }], summary: '借住' };
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse(body) });
    }
    if (post.includes('请铸造开局')) return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse(BOOT) });
    if (failNext > 0) { failNext--; return route.fulfill({ status: 503, body: '{"error":{"message":"忙"}}' }); }
    segCalls++; lastSegRaw = post; lastSeg = post;
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

  // 聊天：一直能聊，接的是刚发的那句，求人只回一条，说定的事记下来
  await pg.evaluate(() => openConvo('赵鹏'));
  const send = async t => { await pg.fill('#chatIn', t); await pg.click('#chatSend'); await idle(); };
  for (let i = 1; i <= 12; i++) await send('第' + i + '句话');
  const cv = await pg.evaluate(() => ({ ta: S.convo.lines.filter(l => l.who === 'ta').length, sys: S.convo.lines.filter(l => l.who === 'sys').map(l => l.text), last: S.convo.lines.filter(l => l.who === 'ta').pop().text, rel: S.convo.rel, dis: document.getElementById('chatIn').disabled }));
  ok(cv.ta === 12 && !cv.dis, '聊了12句，句句有回，输入框没锁', `回了${cv.ta}句`);
  ok(cv.last === '回：第12句话', '回的是刚发的那句', cv.last);
  ok(!cv.sys.some(t => /聊得差不多/.test(t)) && cv.sys.filter(t => /不太想聊/.test(t)).length === 1, '不想聊的提示只出一次，没有"聊得差不多了"', JSON.stringify(cv.sys));
  ok(cv.rel === 12, '一场聊天关系最多动12', `rel=${cv.rel}`);
  ok(/你已经说过/.test(lastConvo) && /要点/.test(lastConvo), '提示词带着说过的话和要点');
  const n0 = await pg.evaluate(() => S.convo.lines.filter(l => l.who === 'ta').length);
  await send('能借我两千吗');
  const ak = await pg.evaluate(() => ({ ta: S.convo.lines.filter(l => l.who === 'ta').map(l => l.text), sys: S.convo.lines.filter(l => l.who === 'sys').map(l => l.text) }));
  ok(ak.ta.length === n0 + 1 && !ak.ta.includes('这句不该出现'), '开口求人只回一条', ak.ta.slice(-1)[0]);
  ok(ak.sys.some(t => /^求他：借两千/.test(t)), '判定那行写明求的是什么');
  await send('你来住吧');
  const pl = await pg.evaluate(() => (S.pledges || []).map(p => p.kind + p.who + p.what));
  ok(pl.some(t => /主角答应赵鹏让她来借住两天/.test(t)), '聊天里说定的事进了承诺表', pl.join('｜'));
  await pg.click('#chatDone'); await idle();
  ok(await pg.evaluate(() => (S.npcs.find(n => n.name === '赵鹏').mem || []).some(m => /一路聊着/.test(m))), '聊完记住了要点');

  // 底栏常驻
  await pg.click('.tab[data-t="home"]'); await pg.waitForTimeout(350);
  const lay = await pg.evaluate(() => { const p = document.getElementById('panel').getBoundingClientRect(), t = document.getElementById('tabs').getBoundingClientRect(); return { pb: Math.round(p.bottom), tt: Math.round(t.top), on: document.querySelector('.tab.on').dataset.t }; });
  await shot('1-home-tabs');
  ok(lay.pb <= lay.tt + 1 && lay.on === 'home', '面板停在底栏上面，底栏标着当前面板', JSON.stringify(lay));
  await pg.click('.tab[data-t="book"]'); await pg.waitForTimeout(350);
  ok(await pg.evaluate(() => curTab === 'book' && document.getElementById('panel').classList.contains('on')), '点别的图标直接切过去');
  await pg.click('.tab[data-t="book"]'); await pg.waitForTimeout(350);
  ok(await pg.evaluate(() => !curTab), '再点当前图标就收起');

  // 转账、红包
  await pg.evaluate(() => { S.debts = []; E.addDebt(S, '赵鹏', 300, 30); openConvo('赵鹏'); });
  const m0 = await pg.evaluate(() => S.player.money);
  const pay = async (kind, v) => { await pg.click('#chatPlus'); await pg.click(`#plusMenu button:has-text("${kind}")`); await pg.fill('#askIn', v); await pg.click('#askOk'); await idle(); };
  await pay('转账', '500 房租');
  const t1 = await pg.evaluate(() => ({ m: S.player.money, debt: (S.debts || []).filter(d => d.left > 0).length, book: Object.values(S.ledger.book || {}).length, cards: document.querySelectorAll('#chatBody .paycard').length }));
  ok(m0 - t1.m === 500 && t1.debt === 0 && t1.cards >= 1, '转账扣钱、先冲欠条、聊天里有转账卡片', `扣${m0 - t1.m}`);
  ok(await pg.evaluate(() => S.pays.filter(p => p.from === '我').pop().toDebt === 300), '500里300算还债、200算转账');
  await pay('转账', '200 不要也得要');
  const t2 = await pg.evaluate(() => S.player.money);
  ok(t2 === t1.m, '对方退回，钱回到账上', `${t1.m}→${t2}`);
  await send('给我点钱');
  const t3 = await pg.evaluate(() => { const p = S.pays.filter(p => p.to === '我').pop(); return { amt: p.amount, st: p.state, m: S.player.money, btn: !!document.querySelector('.paybtns button') }; });
  await shot('2-chat-pending');
  ok(t3.st === '待收' && t3.m === t2 && t3.btn && t3.amt < 1000000, '对方给的钱先挂着、被额度截了', `给${t3.amt}`);
  await pg.click('.paybtns button'); await pg.waitForTimeout(200);
  const t4 = await pg.evaluate(() => S.player.money);
  await shot('3-chat-pay');
  ok(t4 - t2 === t3.amt, '点了才入账');
  ok(await pg.evaluate(() => { const L = Object.values(S.acct || {}); return JSON.stringify(S).includes('收到赵鹏的红包') && JSON.stringify(S).includes('转账给赵鹏'); }), '账本记上了');
  await pg.click('#chatDone'); await idle();

  // 群
  await pg.evaluate(() => { const g = E.makeGroup(S, ['赵鹏', '孙姐', '妈'], '一家人'); openGroup(g.id); });
  await send('晚上吃啥');
  const g1 = await pg.evaluate(() => S.convo.lines.filter(l => l.who === 'ta').map(l => l.from + ':' + l.text));
  ok(g1.length === 2 && !g1.join().includes('外人'), '群里多人回话，不在群里的人说不了话', g1.join('｜'));
  const gm0 = await pg.evaluate(() => S.player.money);
  await pg.click('#chatPlus'); await shot('4a-plus');
  await pg.click('#plusMenu button:has-text("发红包")'); await pg.fill('#askIn', '100 抢'); await pg.click('#askOk'); await idle();
  const g2 = await pg.evaluate(() => { const p = S.pays.filter(p => p.group).pop(); return { sum: p.split.reduce((a, x) => a + x.amount, 0), n: p.split.length, m: S.player.money }; });
  await shot('4-group');
  ok(g2.sum === 100 && g2.n === 3 && gm0 - g2.m === 100, '群红包拆给三个人，加起来正好100');
  ok(/引擎分好了/.test(lastGroup), '群里知道谁抢了多少');
  await pg.click('#chatDone'); await idle();
  await pg.click('.tab[data-t="phone"]'); await shot('5-phone'); await pg.evaluate(() => openMakeGroup()); await shot('6-make-group'); await pg.evaluate(() => mask('npcMask', false));
  ok(await pg.evaluate(() => S.groups[0].msgs.length >= 3 && S.npcs.find(n => n.name === '孙姐').mem.some(m => /一家人/.test(m))), '退出群聊，消息和要点都留下了');

  // 到期提醒卡
  await pg.evaluate(() => { closePanel(); S.pledges = []; S.rifts = []; E.addPledge(S, { who: '孙姐', what: '帮她带份材料', kind: '主角答应', inDays: 2 }); S.flags.cool = 0; renderOptions(S.lastOptions); });
  await pg.click('#skipBtn'); await idle();
  const pc = await pg.evaluate(() => ({ ask: !!S.promiseAsk, card: !!document.querySelector('#acts .promise'), skip: !!document.getElementById('skipBtn') }));
  ok(pc.ask && pc.card && !pc.skip, '往下过日子碰上到期的事：停下来推一张卡，别的按钮收起');
  ok(/不许写他去没去/.test(lastSeg), '那一段只写到那天早上');
  await shot('7-promise');
  await pg.reload(); await pg.waitForSelector('#acts .promise', { timeout: 15000 });
  ok(true, '刷新以后卡还在');
  await pg.click('.prbtns button:has-text("不去了")'); await pg.click('#askOk'); await pg.waitForTimeout(200);
  const pb = await pg.evaluate(() => ({ ask: !!S.promiseAsk, rift: S.rifts.some(r => r.who === '孙姐'), skip: !!document.getElementById('skipBtn') }));
  ok(!pb.ask && pb.rift && pb.skip, '点不去了：留裂痕，按钮回来');
  await pg.evaluate(() => { E.addPledge(S, { who: '赵鹏', what: '陪他去医院', kind: '主角答应', inDays: 1 }); });
  await pg.click('#skipBtn'); await idle();
  const segs0 = segCalls;
  await pg.click('.prbtns button:has-text("去办")'); await idle();
  ok(segCalls === segs0 + 1 && /去办说好的事：陪他去医院/.test(lastSeg) && await pg.evaluate(() => !S.pledges.some(p => p.what === '陪他去医院')), '点去办：当天去做，承诺销账');

  // 通讯录：没消息就不写，点头像看名片
  await pg.evaluate(() => { closePanel(); E.addNpcs(S, [{ name: '周德贵', tie: '房东', note: '穿拖鞋，收钱爽快', rel: 20 }], 1); });
  await pg.click('.tab[data-t="phone"]'); await pg.waitForTimeout(300);
  const row = await pg.evaluate(() => { const r = [...document.querySelectorAll('.thread')].find(x => x.textContent.includes('周德贵')); return r ? { txt: r.textContent, mt: !!r.querySelector('.mtext') } : null; });
  ok(row && !row.mt && !/拖鞋/.test(row.txt), '没消息的人不写他的情况', row && row.txt.replace(/\s+/g, ''));
  await pg.evaluate(() => [...document.querySelectorAll('.thread')].find(x => x.textContent.includes('周德贵')).querySelector('.facetap .face, .facetap img').click());
  await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => document.getElementById('npcMask').classList.contains('on') && document.getElementById('npcBox').textContent.includes('周德贵') && !document.getElementById('chat').classList.contains('on')), '点头像打开名片，不进聊天');
  await pg.evaluate(() => { mask('npcMask', false); closePanel(); });

  // 朋友圈接进世界
  await pg.evaluate(() => { const m = E.addMoment(S, '孙姐', '新买了个锅', 'npc'); window.__mid = m.id; });
  await pg.evaluate(() => { doComment(window.__mid, ''); });
  await pg.waitForSelector('#askMask.on'); await pg.fill('#askIn', '周六去你家蹭饭'); await pg.click('#askOk'); await idle();
  const mw = await pg.evaluate(() => ({ pl: S.pledges.map(p => p.who + p.what), hist: S.history.slice(-1)[0].summary }));
  ok(mw.pl.includes('孙姐周六来家里吃饭') && !mw.pl.some(t => t.includes('不该记')), '朋友圈里说定的事进承诺表', mw.pl.join('｜'));
  ok(/朋友圈：在孙姐那条底下说「周六去你家蹭饭」，孙姐回「行 周六来」/.test(mw.hist), '朋友圈来回进往事提要', mw.hist);
  await pg.evaluate(() => { closePanel(); S.promiseAsk = null; renderOptions(S.lastOptions); });
  await pg.click('#acts .act-btn'); await idle();
  ok(/【朋友圈近况/.test(lastSeg) && /孙姐发：「新买了个锅」｜底下：主角：周六去你家蹭饭/.test(lastSeg), '写故事时带着朋友圈近况');

  // 文风
  await pg.evaluate(() => { closePanel(); S.promiseAsk = null; S.style = '余华'; renderOptions(S.lastOptions); });
  await pg.click('#acts .act-btn'); await idle();
  const sys0 = JSON.parse(lastSegRaw).messages[0].content;
  ok(/文风·冷静的重复/.test(sys0) && !/文风·白描/.test(sys0) && /文风·冷静的重复/.test(lastSeg), '选了余华，正文按余华写');
  await pg.evaluate(() => openConvo('赵鹏')); await send('在吗');
  ok(!/文风·/.test(lastConvoRaw) && /扮演主角手机上的联系人/.test(lastConvoRaw), '聊天不套文风');
  await pg.click('#chatDone'); await idle();
  await pg.evaluate(() => { closePanel(); S.promiseAsk = null; openSettings(); });
  await shot('8-settings-style');
  await pg.click('#setStyle .seg:has-text("金庸")');
  ok(await pg.evaluate(() => S.style === '金庸'), '设置里能改文风');
  await pg.evaluate(() => mask('setMask', false));

  ok(!errs.length, '没有 JS 报错', errs.join(' | '));
  await b.close();
  done();
})();
function done() { console.log(bad ? `\n${bad} 项没过` : '\n全部通过'); process.exitCode = bad ? 1 : 0; }
