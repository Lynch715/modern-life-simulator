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
  employer: '明河设计', title: '设计助理',
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

const YEAR = {
  narrative: '年底最后一天在公司加班，楼下便利店的关东煮涨了五毛。\n七月搬进来的时候箱子还没拆完，现在次卧里堆了三摞废稿。赵鹏年中说要回老家，到现在也没走。',
  summary: '第一年，写废了三摞稿子',
  options: ['把废稿整理一遍', '年后跟周越再联系', '给家里打个电话', '先把身体养养']
};
const END = {
  narrative: '六十岁生日那天你在店里，第一锅出得晚了十分钟。\n沈知打电话来问要不要回家吃饭，你说不了，晚上还有两桌。挂了电话才想起来今天是自己生日。',
  summary: '还在店里，第一锅出晚了',
  title: '还在灶台前'
};
const LOVE = {
  narrative: '话是在地铁口说的，风大，她把围巾往上拉了拉，说：那就试试。',
  summary: '跟许宁在一起了',
  scene: { location: '地铁口', unresolved: [] },
  playerChanges: { energy: -4 },
  options: ['一起吃个饭', '接着写东西', '告诉赵鹏', '回去睡觉'],
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
  moments: n === 1 ? [{ who: '孙姐', text: '空调修了三天了 还是三十度 谁受得了' }] : [],
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
    else if (post.includes('这场是怎么打下来的')) { body = post.includes('面试') ? KEY_JOB : post.includes('把话挑明') ? LOVE : KEY_END; }
    else if (post.includes('写这一局的结尾')) { body = END; }
    else if (post.includes('写一篇 320-450 字的年终小结')) { body = YEAR; }
    else if (post.includes('在朋友圈发了一条') && post.includes('挑其中')) {
      body = { cs: [{ who: '赵鹏', text: '哥们 慢点搬' }, { who: '孙姐', text: '明天别迟到啊' }] };
    }
    else if (post.includes('在朋友圈发了一条')) { body = { reply: '可不是嘛', rel: 2 }; }
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
    // 每次 launch 都是全新的浏览器环境，本来就没有存档；以前这里按 sessionStorage 清存档，刷新时会撞上竞态把存档误删
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

  // 自己动手做四件事：每件只该过一天
  for (let i = 0; i < 4; i++) {
    const before = await pg.evaluate(() => ENGINE.dateStr(S.date));
    await pg.click('#acts .act-btn');
    await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
    const d = await pg.textContent('#topDate');
    console.log(`做第${i + 1}件事：${before.slice(5)} → ${d.slice(5)}`);
  }
  // 再点「往下过日子」，这才该跳一大截
  const b1 = await pg.evaluate(() => S.stats.days);
  await pg.click('#skipBtn');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  const b2 = await pg.evaluate(() => ({ d: S.stats.days, head: document.querySelectorAll('.chapmark')[document.querySelectorAll('.chapmark').length - 1].textContent }));
  console.log(`往下过日子：跳了 ${b2.d - b1} 天，章头「${b2.head}」`);
  await pg.screenshot({ path: 'test/shot-2-run.png' });

  // 投入
  await pg.click('#focusBtn');
  await pg.fill('#fcWhat', '把前三章写完');
  await pg.click('#fcGo');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  console.log('投入之后：', await pg.textContent('#topDate'));

  // 五个 tab 都打开看看
  for (const t of ['phone', 'ideal', 'home', 'book', 'me']) {
    await pg.click(`.tab[data-t="${t}"]`);
    await pg.waitForTimeout(150);
    const txt = (await pg.textContent('#panelBody')).replace(/\s+/g, ' ').slice(0, 80);
    console.log(`[${t}] ${txt}`);
    await pg.screenshot({ path: `test/shot-tab-${t}.png` });
    await pg.click('#panelClose');
  }

  // 朋友圈：看、赞、留言、自己发
  await pg.click('.tab[data-t="phone"]');
  await pg.waitForTimeout(150);
  await pg.click('.phoneseg .seg:has-text("朋友圈")');
  await pg.waitForTimeout(200);
  const moms = await pg.evaluate(() => (S.moments || []).map(m => m.who + '：' + m.text));
  console.log('朋友圈里有：', JSON.stringify(moms));
  if (moms.length) {
    await pg.click('.momfoot button:has-text("赞")');
    await pg.waitForTimeout(150);
    await pg.click('.momfoot button:has-text("留言")');
    await pg.waitForSelector('#askMask.on');
    await pg.fill('#askIn', '这天儿是够呛');
    await pg.click('#askOk');
    await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
    const one = await pg.evaluate(() => { const m = S.moments.find(x => x.cs.length); return m ? { who: m.who, 赞: m.likes, 留言: m.cs.map(c => c.who + ':' + c.text) } : null; });
    console.log('互动之后：', JSON.stringify(one));
  }
  await pg.fill('#momIn', '搬完了 累死');
  await pg.click('.mompost button');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  const mine = await pg.evaluate(() => { const m = S.moments[S.moments.length - 1]; return { who: m.who, text: m.text, 底下: m.cs.map(c => c.who + ':' + c.text) }; });
  console.log('自己发的那条：', JSON.stringify(mine));
  await pg.screenshot({ path: 'test/moments.png' });
  await pg.click('.phoneseg .seg:has-text("通讯录")');
  await pg.waitForTimeout(150);
  await pg.click('#panelClose');

  // 私聊：打开消息里的会话，聊两轮，其中一轮触发判定
  await pg.click('.tab[data-t="phone"]');
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

  // 不在通讯录里的人发来消息：点开也要能直接聊
  await pg.click('.tab[data-t="phone"]');
  await pg.waitForTimeout(150);
  await pg.click('.thread:has-text("房东")');
  await pg.waitForTimeout(200);
  console.log('点开房东：', await pg.evaluate(() => `${document.getElementById('chat').classList.contains('on') ? '进了对话框（对）' : '没进对话框（不对）'}｜历史${document.querySelectorAll('#chatBody .bub').length}条｜通讯录里${S.npcs.some(n => n.name === '房东') ? '有' : '没有'}他`));
  await pg.click('#chatBack');
  await pg.waitForTimeout(150);
  await pg.click('#panelClose');

  // 从手机点进聊天，点返回应该回到手机
  await pg.click('.tab[data-t="phone"]');
  await pg.waitForTimeout(150);
  await pg.click('.thread:has-text("赵鹏")');
  await pg.waitForSelector('#chat.on');
  await pg.click('#chatBack');
  await pg.waitForTimeout(200);
  console.log('聊天点返回后：', await pg.evaluate(() => `手机面板${document.getElementById('panel').classList.contains('on') && curTab === 'phone' ? '开着（对）' : '关了（不对）'}`));
  await pg.click('#panelClose');

  // 人物名片：从聊天界面顶上点名字进去
  await pg.click('.tab[data-t="phone"]');
  await pg.waitForTimeout(150);
  await pg.click('.thread:has-text("赵鹏")');
  await pg.waitForSelector('#chat.on');
  await pg.click('#chatName');
  await pg.waitForSelector('#npcMask.on');
  console.log('人物卡：', (await pg.textContent('#npcBox')).replace(/\s+/g, ' ').slice(0, 70));
  await pg.screenshot({ path: 'test/shot-4-npc.png' });
  await pg.click('#npcMask .ghost');
  await pg.click('#chatBack', { timeout: 5000 });
  console.log('名片→返回后：', await pg.evaluate(() => curTab === 'phone' ? '回到手机（对）' : '在' + (curTab || '推演页')));
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
  console.log('事业卡：', ((await pg.textContent('#panelBody')).replace(/\s+/g, ' ').match(/事业.{0,60}/) || ['(没找到)'])[0]);
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
  await pg.evaluate(() => {
    S.player.money = 300;
    const m = S.npcs.find(n => n.name === '妈'); if (m) { m.rel = 62; m.close = true; }
    saveGame(); rebuildTop();
  });
  await pg.click('.tab[data-t="book"]');
  await pg.waitForTimeout(150);
  await pg.click('button:has-text("找人借钱")');
  await pg.waitForSelector('#npcMask.on');
  const borrowList = await pg.textContent('#npcBox');
  console.log('借钱名单里有谁：', borrowList.replace(/\s+/g, ' ').slice(0, 100));
  console.log('通讯录：', await pg.evaluate(() => S.npcs.map(n => n.name + ':' + Math.round(n.rel)).join(' ')));
  await pg.click('#npcBox .li:has-text("妈")');
  await pg.waitForTimeout(300);
  const st = await pg.evaluate(() => ({ chat: document.getElementById('chat').className, convo: !!S.convo, busy: document.getElementById('busy').className, npcs: S.npcs.map(n => n.name + ':' + Math.round(n.rel)) }));
  if (!st.convo) { console.log('借钱这步卡住了：', JSON.stringify(st), '｜名单：', borrowList.replace(/\s+/g, ' ').slice(0, 120)); }
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

  // 梁子：欠钱过期 → 结梁子 → 找上门 → 还清就凉
  const rift = await pg.evaluate(() => {
    ENGINE.addDebt(S, '赵鹏', 2000, 1);
    S.date = ENGINE.addDays(S.date, 3);
    const r1 = ENGINE.debtTick(S);
    const before = JSON.parse(JSON.stringify(S.rifts));
    S.rifts[0].heat = 80;
    let came = null;
    for (let i = 0; i < 200 && !came; i++) { const t = ENGINE.riftTick(S, Math.random); if (t.stop) came = t.stop.detail; }
    S.player.money = 5000;
    ENGINE.payDebt(S, S.debts.findIndex(d => d.who === '赵鹏'), 2000);
    saveGame(); renderPanel();
    return { 过期: r1.stop && r1.stop.detail, 结下: before.map(x => x.who + '/' + x.kind), 找上门: came, 还清后: S.rifts.map(x => x.who + ':' + Math.round(x.heat)) };
  });
  console.log('梁子：', JSON.stringify(rift, null, 0));

  // 养病
  await pg.evaluate(() => { S.focus = null; S.status = [{ name: '感冒', desc: 'x', days: 4 }, { name: '腰伤', desc: 'y', days: 30 }]; S.chronic = [{ name: '老失眠', desc: 'z', eased: 0 }]; saveGame(); rebuildTop(); });
  await pg.click('#focusBtn');
  await pg.fill('#fcWhat', '回老家歇一阵');
  await pg.evaluate(() => { document.getElementById('fcHeal').checked = true; document.getElementById('fcDays').value = 20; });
  await pg.click('#fcGo');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  const heal = await pg.evaluate(() => ({ 毛病: S.status.map(x => x.name + x.days + '天'), 精力: S.player.energy, 上限: ENGINE.energyCap(S), 骰子条: [...document.querySelectorAll('.chapter:last-child .fate b, .chapter:last-child .die')].map(e => e.textContent).join(' ') }));
  console.log('养病：', JSON.stringify(heal));

  await pg.click('.tab[data-t="me"]');
  await pg.waitForTimeout(150);
  const me = (await pg.textContent('#panelBody')).replace(/\s+/g, ' ');
  console.log('我·梁子：', (me.match(/梁子.{0,60}/) || [''])[0]);
  await pg.screenshot({ path: 'test/shot-10-rift.png' });
  await pg.click('#panelClose');

  // 生意：开店 → 招人 → 月结 → 关店
  await pg.evaluate(() => { S.player.money = 400000; S.player.attrs['谋划'] = 55; S.player.attrs['专业'] = 50; saveGame(); rebuildTop(); });
  await pg.click('.tab[data-t="book"]');
  await pg.waitForTimeout(150);
  await pg.click('button:has-text("就开这个")');
  await pg.waitForSelector('#askMask.on');
  await pg.fill('#askIn', '巷口那家');
  await pg.click('#askOk');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  console.log('开张：', await pg.evaluate(() => S.biz ? `${S.biz.name}／${S.biz.kind}　口碑${Math.round(S.biz.rep)}　场地${S.biz.rent}／月　存款${S.player.money}` : '没开成'));
  await pg.click('.tab[data-t="book"]');
  await pg.waitForTimeout(150);
  await pg.click('button:has-text("招人")');
  await pg.waitForSelector('#npcMask.on');
  await pg.click('#npcBox button:has-text("要他")');
  await pg.waitForTimeout(150);
  const biz = await pg.evaluate(() => {
    S.biz.tend = 24;
    const r = ENGINE.bizMonth(S, Math.random);
    saveGame(); renderPanel();
    return { 人手: S.biz.staff.map(s => s.name + '/' + s.role + '/' + s.pay), 月结: `进${r.rev} 出${r.cost} 净${r.net} 口碑${r.rep}` };
  });
  console.log('生意：', JSON.stringify(biz));
  await pg.screenshot({ path: 'test/shot-11-biz.png' });
  await pg.click('#panelClose');

  // 年终
  await pg.evaluate(() => { S.date = { y: 2026, m: 12, d: 30 }; saveGame(); });
  await pg.click('#acts .act-btn');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 20000 });
  const yr = await pg.evaluate(() => ({
    年: (S.years || []).map(y => y.y + '：' + y.summary),
    章头: document.querySelectorAll('.chapmark')[document.querySelectorAll('.chapmark').length - 1].textContent,
    副: document.querySelectorAll('.chaptime')[document.querySelectorAll('.chaptime').length - 1].textContent
  }));
  console.log('年终：', JSON.stringify(yr));
  await pg.screenshot({ path: 'test/shot-12-year.png' });

  // 导出的全本长什么样
  const book = await pg.evaluate(async () => {
    let txt = '';
    const realBlob = window.Blob;
    window.Blob = function (a) { txt = a.join(''); return new realBlob(a, { type: 'text/plain' }); };
    const a = document.createElement('a'); const oc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { };
    await exportBook();
    HTMLAnchorElement.prototype.click = oc; window.Blob = realBlob;
    return txt.slice(0, 220);
  });
  console.log('全本开头：\n' + book.split('\n').map(l => '   ' + l).join('\n'));

  // 三档口径的差别
  const fdm = await pg.evaluate(() => ['心想事成', '都市传奇', '写实人生'].map(f => {
    S.freedom = f;
    const S2 = JSON.parse(JSON.stringify(S));
    ENGINE.startKey(S2, { scene: '谈判', name: 'x', type: '务实', hard: 60 });
    return `${f}：判定+${ENGINE.FREEDOM[f].check}　门槛60→${S2.key.hard}　生意×${ENGINE.FREEDOM[f].bizEase}　坏事×${ENGINE.FREEDOM[f].badMul}`;
  }));
  console.log('三档：', fdm.join(' ｜ '));
  await pg.evaluate(() => { S.freedom = '写实人生'; saveGame(); });

  // 家：买房 → 挑明 → 结婚 → 孩子
  await pg.evaluate(() => {
    S.player.money = 400000; S.player.attrs['谋划'] = 60; S.player.attrs['体能'] = 70;
    const n = S.npcs.find(x => x.name === '孙姐') || S.npcs[0]; n.rel = 78; n.tie = '朋友';
    saveGame(); rebuildTop();
  });
  await pg.click('.tab[data-t="home"]');
  await pg.waitForTimeout(150);
  console.log('家·租房时：', (await pg.textContent('#panelBody')).replace(/\s+/g, ' ').slice(0, 76));
  await pg.click('button:has-text("付首付，买")');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  console.log('买房后：', await pg.evaluate(() => `${S.home.kind}｜月供${S.ledger.loan}｜房租${S.ledger.rent}｜净值${ENGINE.homeWorth(S)}｜存款${S.player.money}`));

  // 挑明：手机 → 聊天 → 名片 → 把话挑明
  await pg.evaluate(() => {
    const n = S.npcs.find(x => x.name === '孙姐') || S.npcs[0];
    n.rel = 78; n.tie = '朋友'; n.lastSeen = S.stats.days;
    saveGame();
  });
  const who = await pg.evaluate(() => (S.npcs.find(x => x.name === '孙姐') || S.npcs[0]).name);
  await pg.click('.tab[data-t="phone"]');
  await pg.waitForTimeout(150);
  await pg.click(`.thread:has-text("${who}")`);
  await pg.waitForSelector('#chat.on');
  await pg.click('#chatName');
  await pg.waitForSelector('#npcMask.on');
  await pg.click('#npcBox button:has-text("把话挑明")');
  await pg.waitForSelector('#key.on', { timeout: 15000 });
  await pg.evaluate(() => { S.key.interest = 75; S.key.guard = 28; });
  for (let i = 0; i < 8 && await pg.evaluate(() => S.key && !S.key.over); i++) {   // 掷骰有随机，一招不一定谈完
    const btn = await pg.$('.kmove:not([disabled])'); if (!btn) break;
    await btn.click(); await pg.waitForTimeout(80);
  }
  await pg.click('#keyEnd');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 15000 });
  console.log('挑明：', await pg.evaluate(() => { const P = ENGINE.partnerOf(S); return P ? `${P.name}／${P.stage}／热乎${Math.round(P.warm)}` : '没成'; }));

  const fam = await pg.evaluate(() => {
    const P = ENGINE.partnerOf(S);
    ENGINE.marry(S, 51000);
    let t = 0, r; do { r = ENGINE.wantKid(S, Math.random); t++; } while (!r.ok && t < 30);
    S.stats.days += 280;
    const f = ENGINE.familyTick(S, Math.random);
    S.family.kids[0].age = 7;
    saveGame(); renderPanel();
    return { 婚: P.stage, 孩子: S.family.kids.map(k => k.name + k.age + '岁'), 月养: ENGINE.kidCost(S), 出生停点: f.stop && f.stop.detail };
  });
  console.log('成家：', JSON.stringify(fam));
  await pg.click('.tab[data-t="home"]');
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: 'test/shot-13-home.png' });
  await pg.click('#panelClose');

  // 结局 + 接着过
  const lines4 = await pg.evaluate(() => { S.player.age = 60; saveGame(); return ENGINE.endingScore(S); });
  console.log('四条线：', JSON.stringify(lines4));
  await pg.click('#acts .act-btn');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 20000 });
  const ended = await pg.evaluate(() => ({ over: S.over, title: S.endTitle, 条: [...document.querySelectorAll('.endblock .kbar span')].map(x => x.textContent), 按钮: [...document.querySelectorAll('#acts .act-btn')].map(b => b.textContent) }));
  console.log('结局：', JSON.stringify(ended));
  await pg.screenshot({ path: 'test/shot-14-end.png' });
  await pg.click('#acts .act-btn');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 20000 });
  console.log('接着过：', await pg.evaluate(() => `over=${S.over}　退休线${S.retireAge}岁　还在走到 ${ENGINE.dateStr(S.date)}`));

  // 心想事成：看送进模型的 prompt 里到底写了什么
  let lastPrompt = '';
  pg.on('request', r => { if (/chat\/completions/.test(r.url())) { const d = r.postData(); if (d && d.includes('本段引擎判定')) lastPrompt = d; } });
  await pg.evaluate(() => { S.over = false; S.freedom = '心想事成'; saveGame(); renderOptions(S.lastOptions.length ? S.lastOptions : ['随便走走']); });
  await pg.fill('#freeAct', '路上捡到一个皮夹，里面有二十万现金（详细写他数钱时手在抖，最后把钱存进了银行）');
  await pg.click('#goBtn');
  await pg.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), null, { timeout: 20000 });
  const p = JSON.parse(lastPrompt).messages[1].content;
  const has = t => p.includes(t) ? '有' : '没有';
  console.log('言出法随的 prompt 检查：');
  console.log('   铁律块：', has('【本段铁律·压过下面所有条目】'));
  console.log('   玩家原话嵌进去：', has('路上捡到一个皮夹，里面有二十万现金'));
  console.log('   禁“差一点”：', has('差一点'));
  console.log('   禁转折词：', has('不许用"但是"'));
  console.log('   口径段：', has('这一局是玩家点单'));
  console.log('   头等大事那条：', has('这一段的头等大事'));
  console.log('   还带不带属性判定：', p.includes('属性判定') ? '带（不对）' : '不带（对）');
  console.log('   括号要求单列：', has('【玩家在括号里提的要求·无条件照办·优先级最高】'), '｜内容：', has('1. 详细写他数钱时手在抖，最后把钱存进了银行'), '｜字数放开：', has('至少 600 字，不设上限'));
  console.log('   天命骰：', (p.match(/天命骰：(\d+)（(..)）/) || []).slice(1).join(' ') || '没掷');
  const fates = await pg.evaluate(() => {
    const out = [];
    for (let i = 0; i < 400; i++) { let f = ENGINE.d20(Math.random); f = Math.max(ENGINE.num(ENGINE.fdm(S).fateFloor), f); out.push(f); }
    return { 最低: Math.min(...out), 大凶次数: out.filter(x => x <= 3).length };
  });
  console.log('   四百次天命骰：', JSON.stringify(fates));
  await pg.evaluate(() => { S.freedom = '写实人生'; saveGame(); });

  // 改作息
  await pg.click('.tab[data-t="me"]');
  await pg.waitForTimeout(150);
  await pg.click('.paces .seg:has-text("搞理想")');
  await pg.waitForTimeout(150);
  
  const sc = await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('mls_save')); return s.pace + ' 周末=' + s.schedule.rest['白天'] + '/' + s.schedule.rest['晚上'] + ' 顶栏=' + document.getElementById('topSub').textContent; });
  console.log('重心改成：' + sc);
  await pg.click('#panelClose');

  // 刷新看存档
  await pg.reload();
  await pg.waitForTimeout(800);
  if (!(await pg.$('.act-btn'))) {
    console.log('刷新后没按钮：', await pg.evaluate(() => ({
      有存档: !!localStorage.getItem('mls_save'), 键: Object.keys(localStorage).join(','), 地址: location.href.slice(-30),
      存档KB: Math.round((localStorage.getItem('mls_save') || '').length / 1024),
      S有没有: !!window.S, over: window.S && S.over, opts: window.S && S.lastOptions,
      开局弹窗: document.getElementById('startMask').className, acts: document.getElementById('acts').innerHTML.slice(0, 80)
    })));
  }
  await pg.waitForSelector('.act-btn', { timeout: 10000 });
  const after = await pg.textContent('#topDate');
  const chapters = await pg.$$eval('.chapter', e => e.length);
  console.log('刷新后：', after, `共 ${chapters} 段`);

  console.log(errs.length ? '\n发现报错：\n' + errs.join('\n') : '\n没有 JS 报错');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
