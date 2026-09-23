/* 端到端自测：假接口 + 真页面。node test/ui.js */
const { chromium } = require('playwright');
const path = require('path');

const sse = obj => {
  const s = JSON.stringify(obj);
  const chunks = [];
  for (let i = 0; i < s.length; i += 60) chunks.push(s.slice(i, i + 60));
  return chunks.map(c => 'data: ' + JSON.stringify({ choices: [{ delta: { content: c } }] }) + '\n\n').join('') + 'data: [DONE]\n\n';
};

const BOOT = {
  narrative: '七月一日，城西老小区六楼，没有电梯。你把两个行李箱拖上去的时候，T恤已经能拧出水。\n次卧十平米，窗户对着别人家的空调外机。房东说这价格在这一片算良心，你信了，因为你也没得选。\n下午三点，你去那家小设计公司报到。前台指了指角落一张桌子，说以后你坐这儿。',
  summary: '搬进合租次卧，第一天上班',
  job: '一家小设计公司的实习',
  place: '城西老小区的合租次卧',
  scene: { location: '城西老小区的合租次卧', unresolved: ['押一付三还差两千', '实习期三个月没合同', '家里问什么时候回去考编'] },
  npcs: [
    { name: '赵鹏', age: 26, job: '合租室友，跑外卖', tie: '室友', care: '省钱', note: '晚上十一点才回来，进门先脱鞋', rel: 25, close: true },
    { name: '孙姐', age: 38, job: '公司行政', tie: '同事', care: '别给她添麻烦', note: '说话快，什么都知道', rel: 20, close: true },
    { name: '妈', age: 52, job: '在老家', tie: '家里人', care: '你有没有吃饭', note: '每周打两个电话', rel: 60, close: true }
  ],
  peers: [
    { name: '周野', note: '进了本地一家大厂做运营' },
    { name: '陈可', note: '考研二战' },
    { name: '许宁', note: '回老家进了银行' },
    { name: '方越', note: '跟人合伙做咖啡' },
    { name: '李真', note: '还在投简历' }
  ],
  messages: [{ from: '房东', text: '小伙子 押金那两千这周内补上啊' }, { from: '妈', text: '到了吗 吃饭没' }],
  options: ['去楼下便利店买点吃的', '给妈回个电话', '把押金的事想清楚', '整理明天上班要用的东西'],
  ladder: [
    { name: '先写出来', milestones: [
      { title: '写完第一个短篇', desc: '一万字，有头有尾', metric: '投入', need: 50, scene: '提案', gate: '把稿子塞到编辑手里' },
      { title: '第一笔稿费', desc: '哪怕两百块', metric: 'money', need: 9000, scene: '谈判', gate: '跟平台谈稿酬' }]},
    { name: '被人看见', milestones: [
      { title: '有编辑主动找你', metric: '信誉', need: 40, scene: '谈判', gate: '谈一本书的约' }]},
    { name: '靠它吃饭', milestones: [
      { title: '出第一本书', metric: '投入', need: 2000, scene: '路演', gate: '新书分享会' }]}
  ]
};

const KEY_OPEN = {
  opp: { name: '周越', job: '文学期刊编辑', note: '桌上堆着退稿，说话不绕弯，只问数据和交期', type: '务实' },
  where: '期刊社三楼的小会议室',
  opening: '会议室里只有一张长桌，空调开得很足。周越把你的稿子翻到第二页就停了，用笔尖点着那一段：“这儿，为什么是这样写。”'
};
const KEY_JOB = {
  narrative: '面试在一间玻璃隔出来的小屋，对面两个人。问到第三个问题的时候，年纪大的那个把笔放下了。\n出来的时候楼下在下雨。手机响了一下，是offer。',
  summary: '面上了，下周入职',
  scene: { location: '写字楼底下', unresolved: [] },
  playerChanges: { energy: -6 },
  newJob: { employer: '云榆文化', title: '编辑助理', salary: 7400, lv: 1, probation: true },
  options: ['回去跟赵鹏说一声', '先把欠的钱还了', '好好睡一觉', '接着写自己的东西'],
  gameOver: false
};
const KEY_END = {
  narrative: '“你这个短篇，语言我没意见。”周越把稿子推回来，“问题是没人看。”\n你把手机里那条读者留言翻给他看。他看了三秒，把稿子又拽回去了。',
  summary: '周越松口，稿子留下了',
  scene: { location: '期刊社楼下', unresolved: [] },
  playerChanges: { 信誉: 3, energy: -8 },
  options: ['回去等消息', '接着写下一个', '把这事告诉赵鹏', '先睡一觉'],
  gameOver: false
};

const SEG = n => ({
  narrative: `第${n}段：办公室的空调坏了一整周，孙姐说修不了，让大家自己带小风扇。你带了，第二天风扇被人拿走了。\n周三下班，赵鹏在楼道里抽烟，问你这个月房租能不能晚两天。你说行。说完才想起自己卡里剩不到八百。`,
  summary: `第${n}段发生的事`,
  scene: { location: '公司', unresolved: ['押一付三还差两千'] },
  resolvedInfo: [],
  playerChanges: { attributes: { 专业: 0.4 }, energy: -6, money: -320, 信誉: 1, statusAdd: n === 2 ? [{ name: '感冒', desc: '空调房里吹出来的', days: 4 }] : [] },
  npcUpdates: [{ name: '赵鹏', rel: 3, mem: '他问你借房租的时间' }],
  newNpcs: n === 3 ? [{ name: '林工', age: 34, job: '带你的设计师', tie: '师傅', care: '交稿时间', note: '话少，改图很狠', rel: 15 }] : [],
  messages: [{ from: '赵鹏', text: '哥们 谢了' }],
  appointments: n === 1 ? [{ title: '跟房东约好补押金', inDays: 5, kind: '约' }] : [],
  options: ['去找林工问问能不能接私活', '周末回一趟老家', '把押金补上', '晚上留下来练手'],
  gameOver: false
});

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 430, height: 880 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  let calls = 0, convoCalls = 0;
  await pg.route('**/chat/completions', async route => {
    const post = route.request().postData() || '';
    let body;
    if (post.includes('给出这场的对手和开场')) { body = KEY_OPEN; }
    else if (post.includes('这场是怎么打下来的')) { body = post.includes('面试') ? KEY_JOB : KEY_END; }
    else if (post.includes('你现在扮演的是')) {
      convoCalls++;
      if (post.includes('引擎判定（不可更改）')) {
        body = { reply: '行吧 这个月我先垫着 你下个月还我', mood: '不太情愿', rel: 2, ask: null, end: true, summary: '赵鹏答应先垫房租' };
      } else if (post.includes('三千')) {
        body = { reply: '你等我问问你爸', mood: '犹豫', rel: 0, ask: { what: '找家里借三千', attr: '情绪', need: 35, money: 3000, days: 90 }, end: false, summary: '开口跟家里借钱' };
      } else if (convoCalls === 1) {
        body = { reply: '在呢 咋了', mood: '随口', rel: 1, ask: null, end: false, summary: '打了个招呼' };
      } else {
        body = { reply: '你等会儿 我算算', mood: '犹豫', rel: 0, ask: { what: '让赵鹏先垫房租', attr: '表达', need: 55 }, end: false, summary: '开口借钱' };
      }
    } else {
      calls++;
      body = calls === 1 ? BOOT : SEG(calls - 1);
    }
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse(body) });
  });
  await pg.addInitScript(() => {
    localStorage.setItem('mls_cfg', JSON.stringify({ base: 'https://api.deepseek.com', key: 'sk-test', model: 'deepseek-chat' }));
    if (!sessionStorage.getItem('t_started')) { localStorage.removeItem('mls_save'); sessionStorage.setItem('t_started', '1'); }
  });

  await pg.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await pg.waitForSelector('#startMask.on');
  await pg.fill('#sName', '沈昭');
  await pg.click('#sOrigin .seg[data-v="一人进城"]');
  await pg.click('#sCity .seg[data-v="一线"]');
  await pg.click('#sTrack .seg[data-v="创作"]');
  await pg.fill('#sIdeal', '写出一本有人愿意买的书');
  await pg.click('#sFree .seg[data-v="写实人生"]');
  await pg.click('#startGo');
  await pg.waitForSelector('.act-btn', { timeout: 15000 });
  const p0 = await pg.textContent('#topDate');
  console.log('开局：', p0, '|', await pg.textContent('#topMoney'));
  await pg.screenshot({ path: 'test/shot-1-boot.png' });

  // 连点四段
  for (let i = 0; i < 4; i++) {
    await pg.click('#acts .act-btn');
    await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
    const d = await pg.textContent('#topDate');
    const head = await pg.$$eval('.chapmark', els => els[els.length - 1].textContent);
    console.log(`第${i + 1}段：${head}  → ${d}`);
  }
  await pg.screenshot({ path: 'test/shot-2-run.png' });

  // 投入
  await pg.click('#focusBtn');
  await pg.fill('#fcWhat', '把前三章写完');
  await pg.click('#fcGo');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  console.log('投入之后：', await pg.textContent('#topDate'));

  // 五个 tab 都打开看看
  for (const t of ['today', 'msg', 'ideal', 'book', 'me']) {
    await pg.click(`.tab[data-t="${t}"]`);
    await pg.waitForTimeout(150);
    const txt = (await pg.textContent('#panelBody')).replace(/\s+/g, ' ').slice(0, 80);
    console.log(`[${t}] ${txt}`);
    await pg.screenshot({ path: `test/shot-tab-${t}.png` });
    await pg.click('#panelClose');
  }

  // 私聊：打开消息里的会话，聊两轮，其中一轮触发判定
  await pg.click('.tab[data-t="msg"]');
  await pg.waitForTimeout(150);
  await pg.click('.thread:has-text("赵鹏")');
  await pg.waitForSelector('#chat.on');
  await pg.fill('#chatIn', '在吗');
  await pg.click('#chatSend');
  await pg.waitForFunction(() => document.querySelectorAll('#chatBody .bub.ta:not(.typing)').length >= 1, null, { timeout: 15000 });
  await pg.fill('#chatIn', '这个月房租你能先垫一下吗');
  await pg.click('#chatSend');
  await pg.waitForFunction(() => document.querySelectorAll('#chatBody .sysline').length >= 1 && document.querySelectorAll('#chatBody .bub.ta:not(.typing)').length >= 3, null, { timeout: 20000 });
  const bubs = await pg.$$eval('#chatBody .bub, #chatBody .sysline', els => els.map(e => e.className.split(' ')[0] + ':' + e.textContent.slice(0, 26)));
  console.log('聊天记录：'); bubs.forEach(b => console.log('   ' + b));
  await pg.waitForTimeout(400);
  console.log('聊天界面状态：', await pg.evaluate(() => {
    const c = document.getElementById('chat'), p = document.getElementById('panel');
    return JSON.stringify({ chat: c.className, panel: p.className, rect: c.getBoundingClientRect().toJSON(), body: document.body.scrollLeft, win: window.scrollX });
  }));
  await pg.screenshot({ path: 'test/shot-3-chat.png' });
  await pg.click('#chatDone');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  const relAfter = await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('mls_save')); const n = s.npcs.find(x => x.name === '赵鹏'); return { rel: n.rel, mem: n.mem, lastSeen: n.lastSeen, day: s.stats.days }; });
  console.log('聊完之后的赵鹏：', JSON.stringify(relAfter));

  // 人物详情
  await pg.click('.tab[data-t="msg"]');
  await pg.waitForTimeout(150);
  await pg.click('.li:has-text("赵鹏")');
  await pg.waitForSelector('#npcMask.on');
  console.log('人物卡：', (await pg.textContent('#npcBox')).replace(/\s+/g, ' ').slice(0, 70));
  await pg.screenshot({ path: 'test/shot-4-npc.png' });
  await pg.click('#npcMask .ghost');
  await pg.click('#panelClose');

  // 理想阶梯 + 关键局
  await pg.click('.tab[data-t="ideal"]');
  await pg.waitForTimeout(150);
  console.log('阶梯：', (await pg.textContent('#panelBody')).replace(/\s+/g, ' ').slice(0, 120));
  await pg.screenshot({ path: 'test/shot-5-ladder.png' });
  const gated = await pg.$('button:has-text("去谈这一场")');
  console.log('硬指标没到时有没有开谈的按钮：', gated ? '有（不对）' : '没有（对）');
  // 把功夫攒够
  await pg.evaluate(() => { S.ideal.progress = 60; saveGame(); renderPanel(); });
  await pg.waitForTimeout(150);
  await pg.click('button:has-text("去谈这一场")');
  await pg.waitForSelector('#key.on', { timeout: 15000 });
  console.log('对手：', await pg.textContent('#keyTitle'), '|', (await pg.textContent('#keySub')).slice(0, 30));
  const plan = ['摆事实', '讲故事', '共情', '亮底牌', '摆事实', '让步', '施压', '稳一稳'];
  for (const mv of plan) {
    if (!(await pg.$('#keyMoves .kmove:not([disabled])'))) break;
    const over = await pg.evaluate(() => !S.key || S.key.over);
    if (over) break;
    const btn = await pg.$(`.kmove[data-m="${mv}"]:not([disabled])`);
    if (!btn) continue;
    await btn.click();
    await pg.waitForTimeout(60);
  }
  const kr = await pg.evaluate(() => S.key ? { r: S.key.result, round: S.key.round, st: [S.key.guard, S.key.interest, S.key.patience, S.key.nerve].map(Math.round) } : null);
  console.log('打完：', JSON.stringify(kr));
  await pg.screenshot({ path: 'test/shot-6-key.png' });
  await pg.click('#keyEnd');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  const afterKey = await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('mls_save')); return { mile: s.ideal.stages[0].milestones.map(m => m.title + (m.done ? '✓' : '')), 信誉: s.player.信誉, 精力: s.player.energy, keys: s.stats.keys }; });
  console.log('关键局之后：', JSON.stringify(afterKey));

  // 饭碗：季度考核、谈加薪、辞职
  await pg.evaluate(() => { S.job.employer = '明河设计'; S.job.perf = 70; S.player.attrs['专业'] = 45; saveGame(); });
  const rv = await pg.evaluate(() => {
    const rng = () => 0.6;
    S.date = { y: 2026, m: 9, d: 25 };
    const r = ENGINE.advance(S, { rng: Math.random, maxDays: 3 });
    return { stop: r.stop.kind + '：' + r.stop.detail, lv: S.job.lv, salary: S.ledger.salary };
  });
  console.log('季度考核：', JSON.stringify(rv));

  await pg.evaluate(() => { S.ideal.progress = 200; saveGame(); rebuildTop(); renderOptions(S.lastOptions); });
  await pg.click('.tab[data-t="me"]');
  await pg.waitForTimeout(150);
  console.log('饭碗卡：', (await pg.textContent('#panelBody')).replace(/\s+/g, ' ').match(/饭碗.{0,70}/)[0]);
  await pg.screenshot({ path: 'test/shot-7-job.png' });
  await pg.click('button:has-text("谈加薪")');
  await pg.waitForSelector('#key.on', { timeout: 15000 });
  const before = await pg.evaluate(() => S.ledger.salary);
  for (const mv of ['摆事实', '讲故事', '共情', '亮底牌', '摆事实', '让步', '施压', '稳一稳']) {
    if (await pg.evaluate(() => !S.key || S.key.over)) break;
    const btn = await pg.$(`.kmove[data-m="${mv}"]:not([disabled])`);
    if (btn) { await btn.click(); await pg.waitForTimeout(50); }
  }
  const kres = await pg.evaluate(() => S.key.result);
  await pg.click('#keyEnd');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  console.log(`谈加薪：${kres}　月薪 ${before} → ${await pg.evaluate(() => S.ledger.salary)}`);

  // 借钱：私聊里开口，判定成功就入账成债
  await pg.evaluate(() => { S.player.money = 300; saveGame(); rebuildTop(); });
  await pg.click('.tab[data-t="book"]');
  await pg.waitForTimeout(150);
  await pg.click('button:has-text("找人借钱")');
  await pg.waitForSelector('#npcMask.on');
  await pg.click('#npcBox .li:has-text("妈")');
  await pg.waitForSelector('#chat.on');
  await pg.evaluate(() => { window.__r = Math.random; Math.random = () => 0.985; });   // 把这一掷压成必过，好验证入账
  await pg.fill('#chatIn', '妈 能先借我三千吗');
  await pg.click('#chatSend');
  await pg.waitForFunction(() => document.querySelectorAll('#chatBody .bub.ta:not(.typing)').length >= 1, null, { timeout: 15000 });
  await pg.waitForTimeout(600);
  const debt = await pg.evaluate(() => ({ money: S.player.money, debts: (S.debts || []).map(d => d.who + d.left) }));
  await pg.evaluate(() => { Math.random = window.__r; });
  console.log('借钱之后：', JSON.stringify(debt));
  await pg.click('#chatBack');

  // 失业 → 去面一场 → 新饭碗
  await pg.evaluate(() => { ENGINE.quitJob(S); saveGame(); renderPanel(); });
  await pg.click('.tab[data-t="me"]');
  await pg.waitForTimeout(150);
  await pg.click('button:has-text("去面一场")');
  await pg.waitForSelector('#key.on', { timeout: 15000 });
  await pg.evaluate(() => { S.key.interest = 74; S.key.guard = 30; });   // 直接推到谈成那一步
  await pg.click('.kmove[data-m="摆事实"]');
  await pg.waitForTimeout(80);
  await pg.click('#keyEnd');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  console.log('面完之后：', await pg.evaluate(() => JSON.stringify({ job: S.player.job, 东家: S.job.employer, 月薪: S.ledger.salary, 失业: S.job.out })));

  // 改作息
  await pg.click('.tab[data-t="today"]');
  await pg.selectOption('#sc_work_深夜', '理想');
  await pg.waitForTimeout(120);
  const sc = await pg.evaluate(() => JSON.parse(localStorage.getItem('mls_save')).schedule.work['深夜']);
  console.log('作息改成：深夜=' + sc);
  await pg.click('#panelClose');

  // 刷新看存档
  await pg.reload();
  await pg.waitForSelector('.act-btn', { timeout: 10000 });
  const after = await pg.textContent('#topDate');
  const chapters = await pg.$$eval('.chapter', e => e.length);
  console.log('刷新后：', after, `共 ${chapters} 段`);

  console.log(errs.length ? '\n发现报错：\n' + errs.join('\n') : '\n没有 JS 报错');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
