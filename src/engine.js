/* ===== 现代生活模拟器 · 引擎（无 DOM，可在 node 里直接跑） ===== */
(function(root){
'use strict';

const SAVE_VERSION = 1;

/* ---------- 基础 ---------- */
const num = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = v => Math.round(v * 100) / 100;

/* ---------- 出身 / 城市 / 自由度 / 赛道 ---------- */
const ORIGINS = {
  '家里托底': { money: 30000, remit: 0, subsidy: 1200, rentCut: 0.5, retreat: true,
    desc: '爸妈在老家有房有退休金，房租他们帮着出一半，每月还给你打点钱。你可以不慌，但也总有人问你什么时候回去考个编。' },
  '普通家庭': { money: 8000, remit: 0, subsidy: 0, rentCut: 1, retreat: true,
    desc: '家里供你念完了书，往后就得靠你自己。手头这点钱，够撑两个月。' },
  '一人进城': { money: 2000, remit: 900, subsidy: 0, rentCut: 1, retreat: false,
    desc: '你是家里第一个出来的，每月还得往回寄一点。没有退路，也没人兜底。' }
};

const CITIES = {
  '一线': { rent: 2600, living: 2400, pay: 6300, dense: 1.25, desc: '机会多，人也多，房租能吃掉你小半个月工资。' },
  '新一线': { rent: 1700, living: 1800, pay: 4800, dense: 1.0, desc: '不上不下的地方，日子能过，风口小一些。' },
  '老家县城': { rent: 700, living: 1200, pay: 3000, dense: 0.62, desc: '花销低，熟人多，想干点新鲜事没什么人接得住。' }
};

const FREEDOM = {
  '心想事成': { check: 15, cost: 0.4, badMul: 0.45, growth: 1.35, keyEase: 12, bizEase: 1.25,
    tone: '【本局口径】心想事成：主角运气极好，玩家自己写的行动只要不荒诞就当作做成了，失败也写成有惊无险。代价从轻，别让人难受。' },
  '都市传奇': { check: 6, cost: 0.7, badMul: 0.75, growth: 1.15, keyEase: 5, bizEase: 1.1,
    tone: '【本局口径】都市传奇：比现实好走一些，主角有主角的运气，但该付的代价要付，失败是真失败。' },
  '写实人生': { check: 0, cost: 1, badMul: 1, growth: 1, keyEase: 0, bizEase: 1,
    tone: '【本局口径】写实人生：概率贴着现实来。跳槽大多只涨一点，创业大概率黄，贵人不常有，好事不扎堆。别写爽文。' }
};

const TRACKS = {
  '创作':   { skill: '笔力', ph: '写出一本有人愿意掏钱买的书' },
  '创业':   { skill: '经营', ph: '做出一个能养活自己和几个人的东西' },
  '手艺':   { skill: '手艺', ph: '开一家自己的店，做的东西有人专程来吃' },
  '职场':   { skill: '业务', ph: '做到能自己拍板的位置' },
  '科研':   { skill: '研究', ph: '把一个问题真正解决掉，署自己的名' },
  '表演':   { skill: '台风', ph: '站上一个像样的舞台，底下坐满人' },
  '教书':   { skill: '教学', ph: '教出一批真正被我改变过的人' },
  '公益':   { skill: '组织', ph: '把一件没人管的事管起来' },
  '把家过好': { skill: '持家', ph: '有个踏实的小家，谁都不必再漂着' }
};

/* ---------- 日程 ---------- */
const SLOTS = ['早', '白天', '晚上', '深夜'];
const ACTS = {
  '主业': { en: -9,  gain: { '专业': 0.03 }, work: 1 },
  '理想': { en: -8,  gain: { '专业': 0.028 }, ideal: 1 },
  '人情': { en: -5,  gain: { '表达': 0.028 }, social: 1 },
  '身心': { en: 6,   gain: { '体能': 0.03, '情绪': 0.014 } },
  '学习': { en: -7,  gain: { '谋划': 0.028, '专业': 0.018 } },
  '顾家': { en: -3,  gain: { '情绪': 0.02 }, home: 1 },
  '闲着': { en: 4,   gain: {} },
  '睡觉': { en: 0,   gain: {}, sleep: 1 }
};
const SLEEP_EN = { '早': 5, '白天': 6, '晚上': 7, '深夜': 14 };
const ATTRS = ['专业', '表达', '谋划', '情绪', '体能'];

const DEF_SCHEDULE = {
  work: { '早': '睡觉', '白天': '主业', '晚上': '理想', '深夜': '睡觉' },
  rest: { '早': '睡觉', '白天': '身心', '晚上': '人情', '深夜': '睡觉' }
};

/* ---------- 日期 ---------- */
const WD = ['日', '一', '二', '三', '四', '五', '六'];
function dOf(s) { return new Date(s.y, s.m - 1, s.d); }
function fromDate(dt) { return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() }; }
function addDays(s, n) { const dt = dOf(s); dt.setDate(dt.getDate() + n); return fromDate(dt); }
function wdOf(s) { return WD[dOf(s).getDay()]; }
function isRest(s) { const w = dOf(s).getDay(); return w === 0 || w === 6; }
function dateStr(s) { return `${s.y}年${s.m}月${s.d}日 星期${wdOf(s)}`; }
function shortDate(s) { return `${s.m}月${s.d}日`; }
function daysBetween(a, b) { return Math.round((dOf(b) - dOf(a)) / 86400000); }
// 节日：只挑对生活真有影响的几个
function festivalOf(s) {
  if (s.m === 1 && s.d === 1) return '元旦';
  if (s.m === 2 && s.d === 14) return '情人节';
  if (s.m === 5 && s.d === 1) return '劳动节';
  if (s.m === 10 && s.d === 1) return '国庆';
  if (s.m === 12 && s.d === 31) return '除夕前后';  // 农历不算，粗略给个年关
  return null;
}

/* ---------- 骰 ---------- */
const mkRng = seed => {
  let x = seed >>> 0 || 88172645;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
};
const d20 = rng => 1 + Math.floor(rng() * 20);
const rollMod = r => Math.round((r - 10.5) * 4);
const rnd = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

function fateInfo(r) {
  if (r <= 3) return { label: '大凶', cls: 'bad', desc: '这几天走背字，事情横生变故' };
  if (r <= 8) return { label: '不顺', cls: 'bad', desc: '不太顺当，有小挫折或小代价，收获打折' };
  if (r <= 14) return { label: '平常', cls: '', desc: '按常理发展，不好不坏' };
  if (r <= 18) return { label: '顺遂', cls: 'good', desc: '事情顺利，略有收获' };
  return { label: '大吉', cls: 'great', desc: '意外之喜：贵人、机会、横财、被人看见，须与眼下的事相合' };
}

function fdm(S) { return FREEDOM[S.freedom] || FREEDOM['写实人生']; }

function attrVal(S, name) {
  const p = S.player;
  let v = num(p.attrs[name]);
  if (p.energy < 30) v -= Math.round((30 - p.energy) * 0.5);
  if (S.broke) v -= 6;
  v -= Math.round(chronicLoad(S) * 2);
  v += fdm(S).check;
  return Math.round(v);
}

function rollCheck(S, attr, need, rng) {
  const val = attrVal(S, attr);
  const roll = d20(rng);
  const total = val + rollMod(roll);
  const dc = Math.max(20, num(need));
  const crit = roll === 20 ? '大成功' : (roll === 1 ? '大失败' : '');
  const success = roll === 20 ? true : (roll === 1 ? false : total >= dc);
  return { attr, val, roll, mod: rollMod(roll), need: dc, total, success, crit };
}

/* ---------- 开局 ---------- */
function newState(o) {
  const city = CITIES[o.city] || CITIES['新一线'];
  const org = ORIGINS[o.origin] || ORIGINS['普通家庭'];
  const track = TRACKS[o.track] || TRACKS['职场'];
  const startY = o.startYear || new Date().getFullYear();
  const start = { y: startY, m: 7, d: 1 };
  const pay = Math.round(city.pay * (0.82 + (o.payRoll || 0.3) * 0.26));
  const attrs = { '专业': 22, '表达': 20, '谋划': 20, '情绪': 24, '体能': 30 };
  return {
    v: SAVE_VERSION,
    runId: 'r' + startY + '-' + Math.floor((o.rngSeed || 1) % 100000),
    seg: 0,
    date: start, startDate: start,
    freedom: o.freedom || '都市传奇',
    origin: o.origin, city: o.city,
    player: {
      name: o.name || '无名', gender: o.gender || '男', age: 22,
      track: o.track, skillName: track.skill,
      ideal: o.ideal || track.ph,
      job: o.job || '一份刚找到的活',
      attrs: Object.assign({}, attrs),
      attrF: Object.assign({}, attrs),
      energy: 78,
      money: org.money,
      信誉: 8, 人品: 50,
      资历天: 0
    },
    ledger: {
      rent: Math.round(city.rent * org.rentCut), living: city.living,
      remit: org.remit, subsidy: org.subsidy, salary: pay,
      rentDay: 1, salaryDay: 10, loan: 0, base: pay
    },
    job: { employer: '', title: '实习', lv: 0, perf: 0, probation: true, quarters: 0, days: 0, mood: 0, out: false },
    debts: [], rifts: [], ailLog: {},
    biz: null, bizPast: [], wind: null, era: [], eraLeft: 0, years: [],
    home: { kind: '租', since: '', place: '' },
    family: { partner: null, kids: [], past: [] },
    retireAge: 60, endedOnce: [],
    schedule: { work: Object.assign({}, DEF_SCHEDULE.work), rest: Object.assign({}, DEF_SCHEDULE.rest) },
    ideal: { progress: 0, stages: [] },
    key: null,
    npcs: [], peers: [], msgs: [], appts: [], unresolved: [],
    status: [], chronic: [],
    focus: null, stopWhen: null,
    place: '', scene: null,
    recent: [], history: [], volumes: [], chapters: [],
    pending: null, lastOptions: [], lastAction: null, lastJudge: null,
    stats: { segs: 0, days: 0, stops: {}, checks: 0, wins: 0, keys: 0, keyWins: 0 },
    flags: { nightCnt: 0, cool: 0, firstPay: false, firstRent: false, lastPeer: 0, lastEvt: -99, monthNet: 0 },
    broke: false, brokeMonths: 0, over: false, ending: null,
    booted: false
  };
}

/* ---------- 一天 ---------- */
const HEAL_PLAN = { '早': '睡觉', '白天': '身心', '晚上': '闲着', '深夜': '睡觉' };
function todayPlan(S) {
  // 在养病就不上班：这几天的作息由不得你排
  if (S.focus && S.focus.heal) return SLOTS.map(sl => ({ slot: sl, act: HEAL_PLAN[sl] }));
  const t = isRest(S.date) ? S.schedule.rest : S.schedule.work;
  return SLOTS.map(sl => ({ slot: sl, act: t[sl] || '闲着' }));
}

function growAttr(S, name, amt) {
  const p = S.player;
  const cur = num(p.attrF[name]);
  const room = Math.max(0.08, 1 - cur / 100);
  const gain = amt * room * fdm(S).growth * (p.energy >= 40 ? 1 : 0.6);
  p.attrF[name] = r2(cur + gain);
  p.attrs[name] = Math.round(p.attrF[name]);
}

// 跑一天。返回这天攒下的小事（不一定停）
function dayTick(S, rng) {
  const ev = [];
  const p = S.player;
  const plan = todayPlan(S);
  let en = -6, slept = 0;   // 活着本身的消耗

  for (const it of plan) {
    const a = ACTS[it.act] || ACTS['闲着'];
    if (a.sleep) { slept++; en += Math.round((SLEEP_EN[it.slot] || 8) * (slept >= 3 ? 0.4 : 1)); }
    else {
      en += a.en;
      for (const k in a.gain) growAttr(S, k, a.gain[k]);
      if (a.work) p.资历天 = (p.资历天 || 0) + 1;
      if (a.ideal) S.ideal.progress = r2(S.ideal.progress + 0.6 + p.attrs['专业'] / 150);
      if (a.social) S.flags.socialToday = 1;
      if (a.home) S.flags.homeDays = (S.flags.homeDays || 0) + 0.5;
    }
    if (it.slot === '深夜' && !a.sleep) { en -= 7; S.flags.nightCnt++; }
  }
  if (S.biz && !S.biz.dead) bizTend(S, plan); else jobTick(S, plan);

  if (S.focus) {
    const f = S.focus;
    if (f.heal) { f.left--; en += 4; }        // 养病：反过来往回补
    else {                                     // 干活：投入期间压榨自己
      const eff = 1 + (p.attrs[f.attr] || 20) / 80 + (p.energy > 60 ? 0.2 : -0.2);
      f.progress = r2(f.progress + eff);
      f.left--;
      en -= 3;
    }
  }
  for (const st of S.status) { en -= 3; st.days--; }
  const healed = S.status.filter(s => s.days <= 0);
  if (healed.length) { S.status = S.status.filter(s => s.days > 0); for (const h of healed) ev.push({ t: '身体', s: `${h.name}好了` }); }

  p.energy = clamp(Math.round(p.energy + en), 0, energyCap(S));

  // 关系自己凉：越久没来往掉得越快，家里人和天天见面的慢一些
  for (const n of S.npcs) {
    if (n.rel == null) continue;
    const gap = S.stats.days - (n.lastSeen || 0);
    if (S.flags.socialToday && n.close) { n.rel = r2(Math.min(100, n.rel + 0.35)); continue; }
    if (gap < 7) continue;
    let rate = gap > 60 ? 0.11 : gap > 25 ? 0.07 : 0.035;
    if (n.close) rate *= 0.5;
    n.rel = r2(Math.max(0, n.rel - rate));
  }
  S.flags.socialToday = 0;

  // 熬夜和低精力要还
  if (p.energy < 25 && rng() < 0.09 && !S.status.some(s => s.name === '感冒')) {
    S.status.push({ name: '感冒', desc: '扛不住了，嗓子先坏的', days: rnd(rng, 3, 6) });
    const got = noteAil(S, '感冒');
    return { ev, stop: { kind: '身体', detail: got ? '又病倒了，这回是老毛病了' : '撑不住病倒了' } };
  }
  if (S.flags.nightCnt >= 12 && !S.status.some(s => s.name === '失眠')) {
    S.flags.nightCnt = 0;
    S.status.push({ name: '失眠', desc: '作息彻底乱了，躺下就是睁着眼', days: rnd(rng, 8, 16) });
    const got2 = noteAil(S, '失眠');
    return { ev, stop: { kind: '身体', detail: got2 ? '又睡不着了，这回落下了' : '连着熬，睡不着了' } };
  }

  return { ev, stop: null };
}

/* ---------- 月度收支（挂在日历上） ---------- */
function moneyTick(S, rng) {
  const L = S.ledger, p = S.player, d = S.date, ev = [];
  let stop = null;
  if (d.d === L.rentDay && S.biz && !S.biz.dead) {
    const b = bizMonth(S, rng);
    if (b) {
      ev.push({ t: '钱', s: `${S.biz.name}这个月进${b.rev}、出${b.cost}，${b.net >= 0 ? '剩' + b.net : '亏了' + (-b.net)}` });
      if (b.gone.length) ev.push({ t: '人情', s: `${b.gone.join('、')}不干了` });
      if (b.danger) stop = { kind: '生意', detail: `${S.biz.name}连亏${b.lossMonths}个月，再这样撑不下去` };
      else if (b.gone.length) stop = { kind: '生意', detail: `${b.gone.join('、')}从${S.biz.name}走了` };
      else if (S.biz.months <= 1) stop = { kind: '生意', detail: `${S.biz.name}的第一个月：进${b.rev}，出${b.cost}` };
    }
  }
  if (d.d === L.rentDay) {
    const kid = kidCost(S);
    const loan = num(L.loan);
    if (loan) homeTick(S);
    const out = L.rent + loan + L.living + L.remit + kid;
    p.money -= out;
    S.flags.monthNet -= out;
    ev.push({ t: '钱', s: `${L.rent ? `房租${L.rent}、` : ''}${loan ? `月供${loan}、` : ''}生活${L.living}${kid ? `、孩子${kid}` : ''}${L.remit ? `、寄回家${L.remit}` : ''}，一共去了${out}` });
    if (!S.flags.firstRent) { S.flags.firstRent = true; stop = { kind: '钱', detail: '第一次自己交这些钱' }; }
  }
  if (d.d === L.salaryDay && !S.job.out) {
    const inc = L.salary + L.subsidy;
    p.money += inc;
    S.flags.monthNet += inc;
    ev.push({ t: '钱', s: `发了${L.salary}${L.subsidy ? `，家里又打来${L.subsidy}` : ''}` });
    if (!S.flags.firstPay) { S.flags.firstPay = true; stop = { kind: '钱', detail: '第一笔自己挣的工资到账' }; }
  }
  if (d.d === L.salaryDay && S.job.out) {
    if (L.subsidy) { p.money += L.subsidy; S.flags.monthNet += L.subsidy; ev.push({ t: '钱', s: `没有工资，家里打来${L.subsidy}` }); }
    else ev.push({ t: '钱', s: '这个月没有工资' });
  }
  if (d.d === 28) {   // 月末看账
    const net = S.flags.monthNet;
    const floor = L.rent + L.living;
    S.flags.monthNet = 0;
    if (p.money < 0) {
      S.broke = true; S.brokeMonths++;
      stop = { kind: '钱', detail: `账上是负的（${p.money}），得想办法` };
    } else if (p.money < floor + num(L.loan)) {
      stop = { kind: '钱', detail: `剩下的钱撑不到下个月（${p.money}）` };
    } else if (net < 0) {
      stop = { kind: '钱', detail: `这个月倒贴了${-net}` };
    } else { S.broke = false; }
  }
  return { ev, stop };
}

/* ---------- 同辈对照组 ---------- */
const PEER_MOVES = [
  ['升了职', ['转正了，组长', '今天起换了个title，活还是那些活']],
  ['跳了家公司', ['下周入职新的地方，江湖再见', '换东家了，涨了一点']],
  ['辞职去做自己的东西了', ['辞了。想清楚了，不干了', '最后一天，工位收拾干净了']],
  ['拿到一笔钱', ['谈下来了，下周打款', '见了三个人，有一个给钱了']],
  ['搬去了别的城市', ['搬走啦，有空来玩', '换个城市重来一次']],
  ['结婚了', ['领证了', '下个月办酒，记得来']],
  ['分手了', ['分了。别问', '一个人住了']],
  ['买了房', ['签了，三十年', '钥匙拿到手了，空的，什么都没有']],
  ['创业黄了', ['关了。欠的慢慢还', '散伙了，挺好的']],
  ['回老家考编了', ['回去了，考编', '不折腾了']],
  ['出了点成绩被人认识了', ['被人转了一圈，有点懵', '有人找我约稿了']],
  ['生病歇了一阵', ['住了几天院，没大事', '歇了半个月，现在能下床了']]
];
function peerTick(S, rng) {
  const ev = [];
  if (!S.peers.length) return { ev, stop: null };
  S.flags.lastPeer++;
  if (S.flags.lastPeer < rnd(rng, 14, 32)) return { ev, stop: null };
  S.flags.lastPeer = 0;
  const pr = pick(rng, S.peers);
  const [mv, says] = pick(rng, PEER_MOVES);
  pr.track = (pr.track || []).concat([mv]).slice(-4);
  ev.push({ t: '人情', s: `${pr.name}${mv}` });
  S.msgs.push({ from: pr.name, text: pick(rng, says), date: shortDate(S.date), kind: 'peer', read: false });
  S.msgs = S.msgs.slice(-80);
  // 大动静才值得停下来
  if (/升了职|拿到一笔钱|出了点成绩|买了房|结婚/.test(mv) && rng() < 0.45)
    return { ev, stop: { kind: '人情', detail: `${pr.name}${mv}，消息传到你这儿` } };
  return { ev, stop: null };
}

/* ---------- 认识的人主动找你 ---------- */
function npcTick(S, rng) {
  if (!S.npcs.length) return { ev: [], stop: null };
  if (rng() > 0.03) return { ev: [], stop: null };
  const cand = S.npcs.filter(n => {
    const gap = S.stats.days - (n.lastSeen || 0);
    return n.rel >= 25 && gap >= 18;
  });
  if (!cand.length) return { ev: [], stop: null };
  cand.sort((a, b) => (a.lastSeen || 0) - (b.lastSeen || 0));
  const n = cand[Math.min(cand.length - 1, Math.floor(rng() * 2))];
  const gap = S.stats.days - (n.lastSeen || 0);
  return { ev: [], stop: { kind: '找上门', detail: `${n.name}（${n.tie}）${gap}天没联系了，忽然来找你`, npc: n.name } };
}

/* ---------- 随机事件（只给种类，内容交给 LLM） ---------- */
const EVT_TAGS = ['工作', '钱', '身体', '人情', '机会', '家里'];
function evtChance(S) {
  let p = 0.052;
  const pl = S.player;
  if (pl.energy < 35) p += 0.025;
  if (S.unresolved.length >= 3) p += 0.02;
  if (S.broke) p += 0.03;
  p *= (CITIES[S.city] || CITIES['新一线']).dense;
  return p;
}
function pickTag(S, rng) {
  const bad = num(fdm(S).badMul);
  const w = { '工作': 3, '钱': 2 * bad, '身体': 1 * bad, '人情': 3, '机会': 2 / Math.max(0.5, bad), '家里': 1.5 };
  if (S.broke) w['钱'] += 3;
  if (S.player.energy < 35) w['身体'] += 2;
  if (S.focus) w['工作'] += 1;
  let tot = 0; for (const k in w) tot += w[k];
  let r = rng() * tot;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return '人情';
}

/* ---------- 推进器：一天天跑，跑到该停为止 ---------- */
function advance(S, opt) {
  opt = opt || {};
  const rng = opt.rng || Math.random;
  const maxDays = opt.maxDays || 35;
  const from = S.date;
  const events = [];
  let stop = null, days = 0;

  while (days < maxDays) {
    S.date = addDays(S.date, 1);
    days++;
    S.stats.days++;
    if (S.flags.cool > 0) S.flags.cool--;

    // 生日：开局那个月日
    if (S.date.m === S.startDate.m && S.date.d === S.startDate.d && S.date.y > S.startDate.y) {
      S.player.age = 22 + (S.date.y - S.startDate.y);
      kidsGrow(S);
      events.push({ t: '家里', s: `你${S.player.age}岁了${(S.family.kids || []).filter(k => !k.unborn).length ? `，${S.family.kids.filter(k => !k.unborn).map(k => k.name + k.age + '岁').join('、')}` : ''}` });
    }

    // 到头了：这两件事排在所有停点前面
    const en = endReason(S);
    if (en && !S.over) { stop = { kind: '结局', detail: en.text, why: en.why }; break; }

    // 一年到头，别的什么都往后排
    if (S.date.m === 12 && S.date.d === 31) {
      stop = { kind: '年终', detail: `${S.date.y}年过完了` };
      break;
    }

    const day = dayTick(S, rng);
    events.push(...day.ev);
    if (day.stop) { stop = day.stop; break; }

    const mon = moneyTick(S, rng);
    events.push(...mon.ev);
    if (mon.stop) { stop = mon.stop; break; }

    const dt = debtTick(S);
    events.push(...dt.ev);
    if (dt.stop) { stop = dt.stop; break; }

    const wd = windTick(S, rng);
    events.push(...wd.ev);
    if (wd.stop && S.flags.cool <= 0) { stop = wd.stop; break; }

    const fm = familyTick(S, rng);
    events.push(...fm.ev);
    if (fm.stop) { stop = fm.stop; break; }

    const rt = riftTick(S, rng);
    events.push(...rt.ev);
    if (rt.stop && S.flags.cool <= 0) { stop = rt.stop; break; }

    // 季度考核
    if (S.date.d === 26 && [3, 6, 9, 12].includes(S.date.m) && !S.job.out) {
      const rv = review(S, rng);
      if (rv) {
        events.push({ t: '工作', s: rv.text });
        S.lastReview = rv;
        stop = { kind: '考核', detail: `${rv.kind}：${rv.text}`, review: rv };
        break;
      }
    }

    const fes = festivalOf(S.date);
    if (fes) events.push({ t: '家里', s: fes + '到了' });

    // 投入做完了
    if (S.focus && S.focus.left <= 0) {
      stop = { kind: '投入', detail: `${S.focus.what}这一摊子，到点了` };
      break;
    }

    // 约好的事
    const ap = S.appts.find(a => a.y === S.date.y && a.m === S.date.m && a.d === S.date.d && !a.done);
    if (ap) { ap.done = true; stop = { kind: '约', detail: ap.title }; break; }

    // 自设的停下条件
    if (S.stopWhen && S.stopWhen.type === 'money' && S.player.money >= S.stopWhen.n) {
      stop = { kind: '条件', detail: `存款到了${S.stopWhen.n}` }; S.stopWhen = null; break;
    }

    const nt = npcTick(S, rng);
    if (nt.stop && S.flags.cool <= 0) { stop = nt.stop; break; }

    const pe = peerTick(S, rng);
    events.push(...pe.ev);
    if (pe.stop && S.flags.cool <= 0) { stop = pe.stop; break; }

    // 天命：偶尔掷一把，大吉大凶才停
    if (S.flags.cool <= 0 && rng() < 0.022) {
      const f = d20(rng);
      if (f <= 3 || f >= 18) { stop = { kind: '运', detail: fateInfo(f).label, fate: f }; break; }
    }

    // 随机事件
    if (S.flags.cool <= 0 && rng() < evtChance(S)) {
      stop = { kind: '事', detail: pickTag(S, rng) };
      break;
    }
  }

  if (!stop) stop = { kind: '久', detail: '这么些天过去，日子太静了' };
  S.flags.cool = 2;
  S.stats.stops[stop.kind] = (S.stats.stops[stop.kind] || 0) + 1;
  if (S.focus && S.focus.left <= 0) { /* 交给 UI 结算 */ }

  return { from, to: S.date, days, events, stop };
}

/* ---------- 投入结算 ---------- */
function settleFocus(S, rng) {
  const f = S.focus;
  if (!f) return null;
  if (f.heal) {
    S.focus = null;
    const ck = rollCheck(S, '体能', Math.max(25, 62 - f.days * 1.2), rng || Math.random);
    const healed = [];
    const keep = [];
    for (const st of S.status) {
      if (ck.success || st.days <= f.days) healed.push(st.name); else { st.days = Math.max(1, st.days - Math.round(f.days * 0.7)); keep.push(st); }
    }
    S.status = keep;
    S.player.energy = clamp(S.player.energy + Math.round(f.days * 1.6), 0, energyCap(S));
    let eased = null;
    if (ck.success && f.days >= 14 && (S.chronic || []).length) {
      const c = S.chronic.reduce((a, b) => (num(a.eased) <= num(b.eased) ? a : b));
      c.eased = num(c.eased) + 1;
      eased = c.name;
    }
    return Object.assign({ what: f.what, days: f.days, heal: true, healed, eased }, ck);
  }
  const need = f.need || (60 + f.days * 1.2);
  const ck = rollCheck(S, f.attr, need - Math.min(40, f.progress * 0.8), rng || Math.random);
  S.focus = null;
  S.player.energy = clamp(S.player.energy - Math.round(f.days * 0.5 * fdm(S).cost), 0, 100);
  if (f.ideal) S.ideal.progress = r2(S.ideal.progress + f.progress * 0.5);
  return Object.assign({ what: f.what, days: f.days, progress: Math.round(f.progress) }, ck);
}

/* ---------- 吃 LLM 返回的 JSON ---------- */
function applyTurn(S, d) {
  d = d || {};
  const p = S.player;
  const pc = d.playerChanges || {};
  if (pc.attributes) for (const k of ATTRS) if (num(pc.attributes[k])) {
    p.attrF[k] = r2(clamp(num(p.attrF[k]) + num(pc.attributes[k]), 0, 100));
    p.attrs[k] = Math.round(p.attrF[k]);
  }
  if (num(pc.energy)) p.energy = clamp(p.energy + num(pc.energy), 0, 100);
  if (num(pc.money)) p.money += num(pc.money);
  if (num(pc.信誉)) p.信誉 = clamp(p.信誉 + num(pc.信誉), 0, 100);
  if (num(pc.人品)) p.人品 = clamp(p.人品 + num(pc.人品), 0, 100);
  if (num(pc.idealProgress)) S.ideal.progress = r2(S.ideal.progress + num(pc.idealProgress));
  if (pc.job) p.job = String(pc.job).slice(0, 30);
  if (num(pc.salary)) S.ledger.salary = Math.max(0, num(pc.salary));
  if (d.newJob && d.newJob.employer) takeJob(S, d.newJob);

  for (const st of (pc.statusAdd || [])) {
    if (!st || !st.name) continue;
    const name = String(st.name).slice(0, 8);
    if (S.status.some(x => x.name === name)) continue;
    S.status.push({ name, desc: String(st.desc || '').slice(0, 40), days: Math.max(1, num(st.days) || 5) });
  }
  for (const nm of (pc.statusRemove || [])) S.status = S.status.filter(x => x.name !== nm);
  for (const c of (pc.chronicAdd || [])) if (c && c.name && !S.chronic.some(x => x.name === c.name))
    S.chronic.push({ name: String(c.name).slice(0, 10), desc: String(c.desc || '').slice(0, 50) });

  for (const n of (d.newNpcs || []).slice(0, 3)) {
    if (!n || !n.name) continue;
    if (S.npcs.some(x => x.name === n.name)) continue;
    S.npcs.push({
      name: String(n.name).slice(0, 12), age: num(n.age) || 0,
      job: String(n.job || '').slice(0, 20), rel: num(n.rel) || 20,
      tie: String(n.tie || '认识的人').slice(0, 12),
      care: String(n.care || '').slice(0, 30), note: String(n.note || '').slice(0, 50),
      close: !!n.close, mem: [], lastSeen: S.stats.days
    });
  }
  for (const u of (d.npcUpdates || [])) {
    const n = S.npcs.find(x => x.name === u.name);
    if (!n) continue;
    if (num(u.rel)) n.rel = clamp(r2(n.rel + num(u.rel)), 0, 100);
    if (u.tie) n.tie = String(u.tie).slice(0, 12);
    if (u.note) n.note = String(u.note).slice(0, 50);
    if (u.mem) {
      const line = String(u.mem).slice(0, 40);
      n.mem = n.mem || [];
      if (n.mem[n.mem.length - 1] !== line) n.mem = n.mem.concat([line]).slice(-6);
      n.lastSeen = S.stats.days;
    }
  }
  for (const r of (d.newRifts || []).slice(0, 2)) {
    if (r && r.who) addRift(S, r.who, r.reason, r.kind, num(r.heat) || 22);
  }
  for (const e of (d.riftEased || [])) easeRift(S, typeof e === 'string' ? e : e.who, 35);

  for (const m of (d.messages || []).slice(0, 4)) {
    if (!m || !m.text) continue;
    const who = String(m.from || '某人').slice(0, 12);
    S.msgs.push({ from: who, text: String(m.text).slice(0, 120), date: shortDate(S.date), kind: 'chat', read: false });
    const nn = S.npcs.find(x => x.name === who);
    if (nn) nn.lastSeen = S.stats.days;
  }
  S.msgs = S.msgs.slice(-80);

  for (const a of (d.appointments || []).slice(0, 3)) {
    if (!a || !a.title) continue;
    const inD = clamp(num(a.inDays) || 3, 1, 120);
    const dt = addDays(S.date, inD);
    S.appts.push({ y: dt.y, m: dt.m, d: dt.d, title: String(a.title).slice(0, 30), kind: String(a.kind || '').slice(0, 8), done: false });
  }
  S.appts = S.appts.filter(a => !a.done).slice(-12);

  if (d.scene) {
    S.place = String(d.scene.location || S.place).slice(0, 24);
    if (Array.isArray(d.scene.unresolved)) S.unresolved = d.scene.unresolved.map(x => String(x).slice(0, 40)).slice(0, 5);
  }
  for (const r of (d.resolvedInfo || [])) S.unresolved = S.unresolved.filter(u => u !== r);

  if (d.summary) {
    S.history.push({ seg: S.seg, date: shortDate(S.date), summary: String(d.summary).slice(0, 40) });
    S.history = S.history.slice(-120);
  }
  if (d.narrative) {
    S.recent.push({ seg: S.seg, action: S.lastAction || '', narrative: d.narrative });
    S.recent = S.recent.slice(-8);
  }
  if (d.gameOver) { S.over = true; S.ending = d.ending || '此局终了'; }
  return S;
}

/* ---------- 一场聊天的结算 ---------- */
function applyConvo(S, name, res) {
  const n = S.npcs.find(x => x.name === name);
  if (!n) return;
  if (num(res.rel)) n.rel = clamp(r2(n.rel + num(res.rel)), 0, 100);
  n.lastSeen = S.stats.days;
  if (res.mem) {
    const line = String(res.mem).slice(0, 40);
    n.mem = n.mem || [];
    if (n.mem[n.mem.length - 1] !== line) n.mem = n.mem.concat([line]).slice(-6);
  }
  if (res.note) n.note = String(res.note).slice(0, 50);
}






/* ================= 家：住处、伴侣、孩子 ================= */
function housePrice(S) {
  const city = CITIES[S.city] || CITIES['新一线'];
  return Math.round(city.rent * 290 / 10000) * 10000;        // 一套普通两居，按房租倒推
}
function canBuy(S) {
  const price = housePrice(S);
  const down = Math.round(price * 0.32);
  const loan = price - down;
  const monthly = Math.round(loan * 0.0052);                  // 三十年，粗算
  return { price, down, loan, monthly, ok: S.player.money >= down };
}
function buyHouse(S, rng) {
  const b = canBuy(S);
  if (!b.ok) return { ok: false, why: `首付要 ${b.down}，你手头 ${S.player.money}` };
  const ck = rollCheck(S, '谋划', 48, rng || Math.random);
  const cut = ck.success ? Math.round(b.price * 0.03) : 0;    // 砍下来一点
  S.player.money -= (b.down - cut);
  S.home = {
    kind: '买', since: shortDate(S.date), price: b.price - cut,
    loan: { left: b.loan, monthly: b.monthly, months: 360, paid: 0 }
  };
  S.ledger.rent = 0;
  S.ledger.loan = b.monthly;
  return { ok: true, price: b.price - cut, down: b.down - cut, monthly: b.monthly, cut, ck };
}
function homeTick(S) {
  // 月供跟着房租一起在 1 号扣，在 moneyTick 里算
  const H = S.home;
  if (!H || H.kind !== '买' || !H.loan) return;
  H.loan.left = Math.max(0, H.loan.left - Math.round(H.loan.monthly * 0.42));   // 本金部分
  H.loan.paid++;
  if (H.loan.left <= 0) { S.ledger.loan = 0; H.loan.done = true; }
}
function homeWorth(S) {
  const H = S.home;
  if (!H || H.kind !== '买') return 0;
  return Math.max(0, num(H.price) - (H.loan && !H.loan.done ? num(H.loan.left) : 0));
}

/* ---- 伴侣 ---- */
function partnerOf(S) { return S.family && S.family.partner && !S.family.partner.over ? S.family.partner : null; }
function startRomance(S, name, stage) {
  S.family = S.family || { partner: null, kids: [], past: [] };
  const n = S.npcs.find(x => x.name === name);
  S.family.partner = {
    name, since: shortDate(S.date), sinceDay: S.stats.days,
    stage: stage || '在一起', warm: Math.max(55, n ? n.rel : 55), over: false
  };
  if (n) { n.close = true; n.tie = stage === '结婚' ? '爱人' : '对象'; }
  return S.family.partner;
}
function marry(S, cost) {
  const P = partnerOf(S);
  if (!P) return null;
  P.stage = '结婚';
  P.marriedAt = shortDate(S.date);
  S.player.money -= num(cost);
  const n = S.npcs.find(x => x.name === P.name);
  if (n) { n.tie = '爱人'; n.rel = clamp(n.rel + 10, 0, 100); }
  return P;
}
function breakUp(S, why) {
  const P = partnerOf(S);
  if (!P) return null;
  P.over = true; P.endedAt = shortDate(S.date); P.why = String(why || '过不下去了').slice(0, 30);
  const wasMarried = P.stage === '结婚';
  S.family.past = (S.family.past || []).concat([P]).slice(-4);
  const n = S.npcs.find(x => x.name === P.name);
  if (n) { n.tie = wasMarried ? '前妻/前夫' : '前任'; n.rel = clamp(n.rel - 30, 0, 100); }
  if (wasMarried) {
    // 分一半家当
    const half = Math.round(S.player.money * 0.42);
    S.player.money -= Math.max(0, half);
    S.family.partner = null;
    return { wasMarried, half };
  }
  S.family.partner = null;
  return { wasMarried, half: 0 };
}
function wantKid(S, rng) {
  const P = partnerOf(S);
  if (!P || P.stage !== '结婚') return { ok: false, why: '这事得两个人，而且得先成家' };
  if ((S.family.kids || []).some(k => k.unborn)) return { ok: false, why: '已经在等了' };
  const ck = rollCheck(S, '体能', 46 + (S.player.age - 26) * 1.5, rng || Math.random);
  if (!ck.success) return { ok: false, why: '这回没成', ck };
  S.family.kids = (S.family.kids || []).concat([{ unborn: true, dueDay: S.stats.days + 270, name: '', age: 0 }]);
  return { ok: true, ck };
}
const KID_MING = ['念','安','一','小满','年年','知','麦','屿','禾','早早','团团','多多','星','沐','昀'];
function familyTick(S, rng) {
  const ev = [];
  let stop = null;
  S.family = S.family || { partner: null, kids: [], past: [] };
  const P = partnerOf(S);

  // 孩子出生
  for (const k of (S.family.kids || [])) {
    if (k.unborn && S.stats.days >= k.dueDay) {
      k.unborn = false;
      k.name = (S.player.name || '').slice(0, 1) + pick(rng, KID_MING);
      k.bornY = S.date.y; k.born = shortDate(S.date); k.age = 0;
      ev.push({ t: '家里', s: `孩子出生了，叫${k.name}` });
      stop = { kind: '家里', detail: `孩子生下来了，${k.name}` };
    }
  }
  // 过日子的热乎气
  if (P) {
    const days = S.stats.days;
    if (days % 7 === 0) {
      const tended = S.flags.homeDays || 0;
      P.warm = clamp(P.warm + (tended >= 2 ? 2.5 : tended >= 1 ? 0.5 : -2.2) - ((S.biz && !S.biz.dead) || S.focus ? 0.6 : 0), 0, 100);
      S.flags.homeDays = 0;
      if (P.warm <= 18 && rng() < 0.25) {
        stop = { kind: '家里', detail: `跟${P.name}到了要说清楚的时候（这阵子几乎没在一起过）` };
        P.warned = (P.warned || 0) + 1;
        if (P.warned >= 3 && rng() < 0.5) {
          const r = breakUp(S, '各过各的太久了');
          stop = { kind: '家里', detail: `跟${P.name}${r.wasMarried ? '离了，家当分走一半' : '分了'}` };
        }
      }
    }
  }
  return { ev, stop };
}
function kidCost(S) {
  const city = CITIES[S.city] || CITIES['新一线'];
  let c = 0;
  for (const k of (S.family.kids || [])) {
    if (k.unborn) continue;
    c += Math.round(city.living * (k.age < 3 ? 0.5 : k.age < 6 ? 0.42 : k.age < 18 ? 0.62 : 0));
  }
  return c;
}
function kidsGrow(S) {
  for (const k of (S.family.kids || [])) if (!k.unborn) k.age++;
}
function kidStage(k) {
  if (k.unborn) return '还没出生';
  if (k.age < 1) return '刚出生';
  if (k.age < 3) return '会走了';
  if (k.age < 6) return '上幼儿园';
  if (k.age < 12) return '小学';
  if (k.age < 15) return '初中';
  if (k.age < 18) return '高中';
  return '大了，自己过';
}

/* ================= 结局 ================= */
function scoreLines(S) {
  const p = S.player;
  const total = S.ideal.stages.reduce((a, st) => a + st.milestones.length, 0) || 1;
  const done = S.ideal.stages.reduce((a, st) => a + st.milestones.filter(m => m.done).length, 0);
  const wealth = p.money + homeWorth(S) + (S.biz && !S.biz.dead ? Math.max(0, S.biz.total) : 0);
  const city = CITIES[S.city] || CITIES['新一线'];
  const P = partnerOf(S);
  const kids = (S.family && S.family.kids || []).filter(k => !k.unborn).length;
  return {
    志业: clamp(Math.round(done / total * 78 + Math.min(22, S.ideal.progress / 200)), 0, 100),
    财务: clamp(Math.round(wealth / (city.living * 220) * 100), 0, 100),
    关系: clamp(Math.round(S.npcs.filter(n => n.rel >= 55).length * 9 + (P ? (P.stage === '结婚' ? 26 : 14) : 0) + kids * 9 + (S.rifts || []).filter(r => !r.done).length * -6), 0, 100),
    身心: clamp(Math.round(p.energy * 0.6 + (100 - chronicLoad(S) * 22) * 0.4), 0, 100)
  };
}
function endReason(S) {
  const p = S.player;
  if (p.age >= (S.retireAge || 60)) return { why: '到了岁数', text: `${p.age}岁，该收了` };
  if ((S.chronic || []).length >= 4) return { why: '身体垮了', text: '一身的毛病，跑不动了' };
  if (p.money < -50000 && S.job.out && !(S.biz && !S.biz.dead)) return { why: '撑不住了', text: '没活干、没进项，窟窿越来越大' };
  return null;
}
function endingScore(S) {
  const L = scoreLines(S);
  const avg = Math.round((L.志业 + L.财务 + L.关系 + L.身心) / 4);
  const top = Object.keys(L).sort((a, b) => L[b] - L[a])[0];
  const low = Object.keys(L).sort((a, b) => L[a] - L[b])[0];
  return { lines: L, avg, top, low };
}
// 结局之后还想过下去
function keepGoing(S, years) {
  S.over = false;
  S.retireAge = (S.retireAge || 60) + (num(years) || 10);
  S.endedOnce = (S.endedOnce || []).concat([{ at: shortDate(S.date), age: S.player.age }]).slice(-4);
  return S.retireAge;
}

/* ================= 自立门户 ================= */
const BIZ_KINDS = {
  '小店':   { setupX: 8,  rentX: 1.6, baseX: 1.15, attr: '谋划', cap: 3, desc: '铺面、货、一个帮手，开门就要钱' },
  '工作室': { setupX: 4,  rentX: 0.8, baseX: 0.95, attr: '专业', cap: 4, desc: '几个人一间屋，靠手艺接活' },
  '小公司': { setupX: 14, rentX: 2.4, baseX: 1.65, attr: '谋划', cap: 5, desc: '要养人、要签合同、要交社保' }
};
const XING = '王李张刘陈杨黄周吴徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹彭'.split('');
const MING = ['杰','磊','敏','静','强','洋','艳','勇','军','丽','涛','明','超','秀','霞','平','刚','桂','文','辉','力','薇','娟','浩','鹏','宇','晨','菲','然','宁','川','舟','野','可','真','越','岚','昭','池','屿'];
function madeName(rng, used) {
  for (let i = 0; i < 40; i++) {
    const n = pick(rng, XING) + pick(rng, MING) + (rng() < 0.35 ? pick(rng, MING) : '');
    if (!used.includes(n)) return n;
  }
  return pick(rng, XING) + pick(rng, MING);
}
function bizBase(S) {
  const city = CITIES[S.city] || CITIES['新一线'];
  const K = BIZ_KINDS[S.biz ? S.biz.kind : '工作室'];
  return Math.round(city.pay * K.baseX);
}
function bizSetup(S, kind) {
  const city = CITIES[S.city] || CITIES['新一线'];
  return Math.round(city.rent * BIZ_KINDS[kind].setupX);
}
function openBiz(S, o, rng) {
  rng = rng || Math.random;
  const kind = BIZ_KINDS[o.kind] ? o.kind : '工作室';
  const K = BIZ_KINDS[kind];
  const need = bizSetup(S, kind);
  if (S.player.money < need) return { ok: false, why: `启动得要 ${need} 元，你手头只有 ${S.player.money}` };
  const ck = rollCheck(S, K.attr, 46 + (kind === '小公司' ? 12 : kind === '小店' ? 4 : 0), rng);
  const city = CITIES[S.city] || CITIES['新一线'];
  S.player.money -= need;
  S.biz = {
    name: String(o.name || '没名字的店').slice(0, 14), kind,
    since: shortDate(S.date), sinceY: S.date.y,
    rent: Math.round(city.rent * K.rentX), staff: [],
    rep: ck.success ? 42 : 30, tend: 0, months: 0,
    rev: 0, cost: 0, net: 0, lossMonths: 0, best: 0, total: 0, dead: false, setup: need
  };
  if (S.job && !S.job.out) quitJob(S);
  S.player.job = `自己的${kind}「${S.biz.name}」`;
  return { ok: true, need, ck, rep: S.biz.rep };
}
function bizCandidates(S, rng) {
  const used = S.npcs.map(n => n.name).concat((S.biz.staff || []).map(s => s.name));
  const city = CITIES[S.city] || CITIES['新一线'];
  return [0, 1, 2].map(() => {
    const skill = rnd(rng, 22, 78);
    return {
      name: madeName(rng, used),
      role: pick(rng, ['帮手', '师傅', '跑单的', '做事的', '管账的']),
      skill,
      pay: Math.round(city.pay * (0.45 + skill / 140) / 100) * 100,
      loyal: rnd(rng, 45, 70)
    };
  });
}
function hireBiz(S, c) {
  const B = S.biz;
  if (!B || B.dead) return null;
  if (B.staff.length >= BIZ_KINDS[B.kind].cap) return { ok: false, why: '地方就这么大，塞不下人了' };
  B.staff.push(Object.assign({ months: 0 }, c));
  return { ok: true, who: c.name };
}
function fireBiz(S, i) {
  const B = S.biz;
  const s = B && B.staff[i];
  if (!s) return null;
  const pay = s.pay;          // 遣散
  S.player.money -= pay;
  B.staff.splice(i, 1);
  B.rep = clamp(B.rep - 3, 0, 100);
  return { who: s.name, pay };
}
function raiseBiz(S, i, up) {
  const s = S.biz && S.biz.staff[i];
  if (!s) return null;
  s.pay = Math.max(0, Math.round(s.pay + num(up)));
  s.loyal = clamp(s.loyal + (num(up) > 0 ? 14 : -18), 0, 100);
  return s;
}
// 有生意的时候，日程里的「主业」就是照看自己的摊子
function bizTend(S, plan) {
  const B = S.biz;
  if (!B || B.dead) return;
  let w = 0;
  for (const it of plan) if (it.act === '主业') w += (it.slot === '晚上' || it.slot === '深夜') ? 1.3 : 1;
  if (w) B.tend = r2(B.tend + w);
}
function bizMonth(S, rng) {
  const B = S.biz;
  if (!B || B.dead) return null;
  B.months++;
  const K = BIZ_KINDS[B.kind];
  const skill = B.staff.reduce((a, s) => a + s.skill, 0);
  const tendK = clamp(0.55 + B.tend / 60, 0.55, 1.35);          // 自己盯得越紧越好
  const mine = S.player.attrs['专业'] * 1.1;                     // 自己的本事也算一份
  const rev = Math.round(bizBase(S) * (0.45 + B.rep / 110) * (1 + (skill + mine) / 230) * tendK * windMul(S) * num(fdm(S).bizEase) * (0.85 + rng() * 0.3));
  const pay = B.staff.reduce((a, s) => a + s.pay, 0);
  const cost = B.rent + pay;
  const net = rev - cost;
  S.player.money += net;
  B.rev = rev; B.cost = cost; B.net = net; B.lastTend = r2(B.tend); B.total += net; B.best = Math.max(B.best, net);
  B.tend = 0;

  // 口碑：人手够不够、自己在不在
  const load = rev / Math.max(1, (B.staff.length + 1) * bizBase(S) * 0.75);
  if (load > 1.2) B.rep = clamp(B.rep - 3, 0, 100);              // 接得下但做不好，口碑就掉
  else if (tendK > 0.9) B.rep = clamp(B.rep + 3 + (S.player.attrs['专业'] > 50 ? 1 : 0) + (skill > 100 ? 1 : 0), 0, 100);
  else B.rep = clamp(B.rep + 0.5, 0, 100);

  // 人心
  const gone = [];
  for (const s of B.staff) {
    s.months++;
    const fair = s.pay >= Math.round((CITIES[S.city] || CITIES['新一线']).pay * (0.45 + s.skill / 140)) ? 6 : -9;
    s.loyal = clamp(s.loyal + fair + (tendK > 1 ? 2 : -3) + (net < 0 ? -4 : 1), 0, 100);
    s.skill = clamp(s.skill + (tendK > 1 ? 0.6 : 0.2), 0, 100);
    if (s.loyal < 22 && rng() < 0.45) gone.push(s.name);
  }
  if (gone.length) { B.staff = B.staff.filter(s => gone.indexOf(s.name) < 0); B.rep = clamp(B.rep - 2, 0, 100); }

  B.lossMonths = net < 0 ? B.lossMonths + 1 : 0;
  const out = { rev, cost, net, rep: Math.round(B.rep), gone, lossMonths: B.lossMonths };
  // 开头亏几个月是常事，钱还够就不算危；钱不够了才叫危
  if (B.lossMonths >= 5 || (B.lossMonths >= 3 && S.player.money < cost * 3) || S.player.money < -Math.abs(cost)) out.danger = true;
  return out;
}
function closeBiz(S) {
  const B = S.biz;
  if (!B || B.dead) return null;
  const back = Math.round(B.setup * 0.3);
  const sever = B.staff.reduce((a, s) => a + s.pay, 0);
  S.player.money += back - sever;
  const out = { name: B.name, months: B.months, total: B.total, back, sever, staff: B.staff.map(s => s.name) };
  for (const s of B.staff) if (rng0() < 0.3) addRift(S, s.name, '店关了，欠他一个交代', '私怨', 18);
  B.dead = true; B.closedAt = shortDate(S.date);
  S.bizPast = (S.bizPast || []).concat([out]).slice(-3);
  S.biz = null;
  S.player.job = '待业';
  S.job.out = true; S.ledger.salary = 0;
  return out;
}
function rng0() { return Math.random(); }

/* ================= 行业风向与时代 ================= */
const WIND = { '热': 1.26, '平': 1.0, '冷': 0.76 };
function windMul(S) { return WIND[(S.wind && S.wind.mood) || '平'] || 1; }
const ERA = {
  '创作': ['平台改了分成规矩', '一批人靠短内容火了', '出版社在砍选题', '有人拿AI写的东西冒名投稿'],
  '创业': ['钱不好拿了', '一个赛道突然被追着投', '监管出了新口径', '大厂下场做同样的事'],
  '手艺': ['房租又涨了一茬', '街上新开了三家同行', '一条街被划进改造范围', '有博主把这行拍火了'],
  '职场': ['行业在裁员', '公司换了新老板', '内部开始查考勤', '同行在高价挖人'],
  '科研': ['经费批得慢了', '一篇同方向的文章先发了', '评审标准变了', '有企业来谈合作'],
  '表演': ['小剧场一个接一个关', '有个综艺在海选', '票务平台改了抽成', '一个前辈退圈了'],
  '教书': ['政策又调了', '家长群里在传新说法', '有机构跑路了', '学校在招编外'],
  '公益': ['资助方换了方向', '一条相关新闻上了热搜', '登记手续变严', '有人捐了一笔'],
  '把家过好': ['房价动了', '菜价涨得离谱', '老家那边在拆迁', '医保报销比例改了']
};
function windTick(S, rng) {
  const ev = [];
  let stop = null;
  S.wind = S.wind || { mood: '平', left: rnd(rng, 90, 210) };
  S.wind.left--;
  if (S.wind.left <= 0) {
    const r = rng();
    const mood = r < 0.28 ? '热' : r < 0.68 ? '平' : '冷';
    const changed = mood !== S.wind.mood;
    S.wind = { mood, left: rnd(rng, 120, 260) };
    if (changed) {
      ev.push({ t: '机会', s: `${S.player.track}这行眼下${mood === '热' ? '正热' : mood === '冷' ? '在过冬' : '不温不火'}` });
      stop = { kind: '风向', detail: `${S.player.track}这行${mood === '热' ? '忽然热起来了' : mood === '冷' ? '开始过冬了' : '慢慢平下来了'}` };
    }
  }
  // 时代的事，隔一阵来一件
  S.eraLeft = num(S.eraLeft) || rnd(rng, 70, 140);
  S.eraLeft--;
  if (S.eraLeft <= 0) {
    S.eraLeft = rnd(rng, 90, 170);
    const pool = ERA[S.player.track] || ERA['职场'];
    const one = pick(rng, pool);
    S.era = (S.era || []).concat([{ text: one, date: shortDate(S.date) }]).slice(-4);
    ev.push({ t: '机会', s: one });
    stop = { kind: '时代', detail: one };
  }
  return { ev, stop };
}

/* ================= 一年过去了 ================= */
function yearSnap(S) {
  const p = S.player;
  return {
    y: S.date.y, money: p.money, salary: S.ledger.salary,
    attrs: Object.assign({}, p.attrs), 信誉: p.信誉, 人品: p.人品,
    energy: p.energy, job: p.job, age: p.age,
    miles: S.ideal.stages.reduce((a, st) => a + st.milestones.filter(m => m.done).length, 0),
    npcs: S.npcs.length, close: S.npcs.filter(n => n.rel >= 55).length,
    chronic: (S.chronic || []).map(c => c.name),
    rifts: (S.rifts || []).filter(r => !r.done).length,
    biz: S.biz ? { name: S.biz.name, net: S.biz.net, rep: Math.round(S.biz.rep), staff: S.biz.staff.length } : null,
    ideal: Math.round(S.ideal.progress)
  };
}
function yearDiff(S) {
  const now = yearSnap(S);
  const last = (S.years || []).length ? S.years[S.years.length - 1].snap : null;
  if (!last) return { now, up: null };
  const up = {
    money: now.money - last.money, salary: now.salary - last.salary,
    attrs: ATTRS.reduce((o, k) => (o[k] = now.attrs[k] - last.attrs[k], o), {}),
    miles: now.miles - last.miles, close: now.close - last.close, ideal: now.ideal - last.ideal
  };
  return { now, up };
}

/* ================= 梁子（结下的与找上门的） ================= */
const RIFT_KINDS = {
  '债主':   { rate: 1.15, word: '钱没还' },
  '前东家': { rate: 0.45, word: '走得不体面' },
  '竞对':   { rate: 0.6,  word: '抢一碗饭' },
  '私怨':   { rate: 0.7,  word: '得罪了人' },
  '甲方':   { rate: 0.85, word: '活没交代好' }
};
function addRift(S, who, reason, kind, heat) {
  S.rifts = S.rifts || [];
  who = String(who || '某人').slice(0, 12);
  const k = RIFT_KINDS[kind] ? kind : '私怨';
  const has = S.rifts.find(r => r.who === who && !r.done);
  if (has) {
    has.heat = clamp(has.heat + (num(heat) || 20), 0, 100);
    has.reason = String(reason || has.reason).slice(0, 40);
    return has;
  }
  const r = { who, reason: String(reason || RIFT_KINDS[k].word).slice(0, 40), kind: k,
    heat: clamp(num(heat) || 25, 0, 100), since: shortDate(S.date), done: false, came: 0 };
  S.rifts.push(r);
  S.rifts = S.rifts.slice(-8);
  return r;
}
function easeRift(S, who, amount) {
  const r = (S.rifts || []).find(x => x.who === who && !x.done);
  if (!r) return null;
  r.heat = clamp(r.heat - (num(amount) || 25), 0, 100);
  if (r.heat <= 8) { r.done = true; r.endedAt = shortDate(S.date); }
  return r;
}
function riftTick(S, rng) {
  const ev = [];
  let stop = null;
  for (const r of (S.rifts || [])) {
    if (r.done) continue;
    let rate = RIFT_KINDS[r.kind].rate * 0.55 * num(fdm(S).badMul);
    if (r.kind === '债主' && !(S.debts || []).some(d => d.who === r.who && d.left > 0)) rate = -0.8;  // 钱还上了自己会凉
    r.heat = clamp(r.heat + rate, 0, 100);
    if (r.heat <= 6) { r.done = true; r.endedAt = shortDate(S.date); ev.push({ t: '人情', s: `跟${r.who}那点事算过去了` }); }
  }
  // 同一个人不会隔三差五堵你，给他二十天的间隔
  const hot = (S.rifts || []).filter(r => !r.done && r.heat >= 62 && S.stats.days - num(r.lastCame) >= 20);
  if (hot.length && rng() < 0.035) {
    const r = pick(rng, hot);
    r.came++;
    r.lastCame = S.stats.days;
    r.heat = clamp(r.heat - 30, 0, 100);
    stop = { kind: '裂痕', detail: `${r.who}（${r.kind}）找上门来了：${r.reason}`, who: r.who, riftKind: r.kind };
  }
  return { ev, stop };
}

/* ================= 老毛病 ================= */
function ailCount(S, name) {
  S.ailLog = S.ailLog || {};
  return num(S.ailLog[name]);
}
// 同一个毛病犯到第三回，就落下病根了
function noteAil(S, name) {
  S.ailLog = S.ailLog || {};
  const n = (num(S.ailLog[name]) || 0) + 1;
  S.ailLog[name] = n;
  if (n >= 3 && !S.chronic.some(c => c.name === '老' + name)) {
    S.chronic.push({ name: ('老' + name).slice(0, 8), desc: `${name}犯过${n}回，落下了`, eased: 0 });
    return true;
  }
  return false;
}
function chronicLoad(S) {
  return (S.chronic || []).reduce((a, c) => a + Math.max(0, 1 - num(c.eased) * 0.34), 0);
}
function energyCap(S) { return Math.round(100 - chronicLoad(S) * 7); }

/* ================= 单位与饭碗 ================= */
const LEVELS = [
  { t: '实习', pay: 1.00 }, { t: '转正', pay: 1.28 }, { t: '熟手', pay: 1.65 },
  { t: '骨干', pay: 2.15 }, { t: '主管', pay: 2.95 }, { t: '负责人', pay: 4.10 }
];
function jobLv(S) { return LEVELS[clamp(num(S.job.lv), 0, LEVELS.length - 1)]; }
function nextReview(S) {
  const d = S.date;
  const qm = [3, 6, 9, 12].find(m => m > d.m || (m === d.m && d.d < 26));
  const y = qm ? d.y : d.y + 1;
  const m = qm || 3;
  return daysBetween(d, { y, m, d: 26 });
}
// 平时干的活攒成绩效
function jobTick(S, plan) {
  const J = S.job;
  if (!J || J.out) return;
  const p = S.player;
  let work = 0;
  for (const it of plan) if (it.act === '主业') work += (it.slot === '晚上' || it.slot === '深夜') ? 1.4 : 1;
  if (!work) return;
  J.perf = r2(J.perf + work * (0.5 + p.attrs['专业'] / 220) * (p.energy < 35 ? 0.6 : 1));
  J.days = (J.days || 0) + 1;
}
// 季度考核：升、涨、平、谈话、走人
function review(S, rng) {
  const J = S.job, p = S.player;
  if (!J || J.out) return null;
  const lv = clamp(num(J.lv), 0, LEVELS.length - 1);
  const score = num(J.perf) + p.attrs['专业'] * 0.8 + p.信誉 * 0.4 + rnd(rng, 0, 20) + (J.mood || 0);
  const need = 52 + lv * 16;
  const f = fdm(S);
  J.perf = 0; J.quarters = (J.quarters || 0) + 1;
  const out = { score: Math.round(score), need, kind: '', text: '' };

  if (J.probation && J.quarters >= 1) {
    J.probation = false;
    if (score < need * 0.55 && f.cost >= 0.7) {
      J.out = true; J.title = '待业'; S.ledger.salary = 0;
      out.kind = '没转正'; out.text = '试用期没过，让你走人';
      return out;
    }
    J.lv = Math.max(1, lv);
    S.ledger.salary = Math.round(S.ledger.base * LEVELS[J.lv].pay);
    J.title = LEVELS[J.lv].t;
    if (J.employer) S.player.job = `${J.employer}的${J.title}`;
    out.kind = '转正'; out.text = `转正了，月薪${S.ledger.salary}`;
    return out;
  }
  if (score >= need * 1.35 && lv < LEVELS.length - 1) {
    J.lv = lv + 1;
    S.ledger.salary = Math.round(S.ledger.base * LEVELS[J.lv].pay * (0.95 + rng() * 0.15));
    J.title = LEVELS[J.lv].t;
    if (J.employer) S.player.job = `${J.employer}的${J.title}`;
    out.kind = '升职'; out.text = `提了${LEVELS[J.lv].t}，月薪${S.ledger.salary}`;
  } else if (score >= need) {
    const up = Math.round(S.ledger.salary * (0.04 + rng() * 0.06));
    S.ledger.salary += up;
    out.kind = '涨薪'; out.text = `涨了${up}，月薪${S.ledger.salary}`;
  } else if (score >= need * 0.6) {
    out.kind = '原地'; out.text = '考核平平，什么都没动';
  } else if (score >= need * 0.4 || f.cost < 0.7) {
    J.mood = -8;
    out.kind = '约谈'; out.text = '被叫去谈话，说下个季度再看看';
  } else {
    J.out = true; J.was = J.employer; J.title = '待业'; S.ledger.salary = 0;
    out.kind = '裁员'; out.text = '这个季度轮到你，让你走人';
  }
  return out;
}
function quitJob(S) {
  const J = S.job;
  if (!J || J.out) return null;
  J.out = true; J.was = J.employer; J.title = '待业'; J.perf = 0; J.mood = 0;
  S.ledger.salary = 0;
  S.player.信誉 = clamp(S.player.信誉 - 1, 0, 100);
  if (J.mood < 0 || num(J.perf) < 12) addRift(S, J.was || '原来那家', '走的时候没处理干净', '前东家', 22);
  return { kind: '辞职', text: `从${J.was || '原来那家'}出来了，下个月起没有工资` };
}
// 新饭碗（LLM 报的）
function takeJob(S, o) {
  const J = S.job;
  J.out = false;
  J.employer = String(o.employer || J.employer || '新东家').slice(0, 16);
  J.title = String(o.title || '正式').slice(0, 10);
  J.lv = clamp(num(o.lv) || Math.max(1, num(J.lv)), 0, LEVELS.length - 1);
  J.probation = !!o.probation;
  J.perf = 0; J.mood = 0; J.quarters = 0;
  S.ledger.base = Math.max(1000, num(o.salary) ? Math.round(num(o.salary) / LEVELS[J.lv].pay) : S.ledger.base);
  S.ledger.salary = num(o.salary) ? Math.round(num(o.salary)) : Math.round(S.ledger.base * LEVELS[J.lv].pay);
  S.player.job = `${J.employer}的${J.title}`;
  return { kind: '新工作', text: `${J.employer}，${J.title}，月薪${S.ledger.salary}` };
}

/* ---------- 欠的钱 ---------- */
function addDebt(S, who, amount, days) {
  S.debts = S.debts || [];
  const due = addDays(S.date, Math.max(15, num(days) || 60));
  S.debts.push({ who: String(who || '某人').slice(0, 12), amount: Math.round(num(amount)), left: Math.round(num(amount)), due, late: false });
  S.player.money += Math.round(num(amount));
}
function debtTick(S) {
  const ev = [];
  let stop = null;
  for (const d of (S.debts || [])) {
    if (d.left <= 0) continue;
    if (daysBetween(S.date, d.due) > 0) continue;
    if (!d.late) {
      d.late = true;
      const n = S.npcs.find(x => x.name === d.who);
      if (n) n.rel = clamp(n.rel - 12, 0, 100);
      ev.push({ t: '钱', s: `欠${d.who}的${d.left}到期了` });
      addRift(S, d.who, `欠他${d.left}元没还`, '债主', 35);
      stop = { kind: '钱', detail: `欠${d.who}的${d.left}元到期了，还不上` };
    }
  }
  S.debts = (S.debts || []).filter(d => d.left > 0);
  return { ev, stop };
}
function payDebt(S, i, amount) {
  const d = (S.debts || [])[i];
  if (!d) return null;
  const pay = Math.min(Math.round(num(amount)), d.left, S.player.money);
  if (pay <= 0) return null;
  d.left -= pay;
  S.player.money -= pay;
  if (d.left <= 0) {
    const n = S.npcs.find(x => x.name === d.who);
    if (n) n.rel = clamp(n.rel + 6, 0, 100);
    d.late = false;
    easeRift(S, d.who, 60);
  }
  return { who: d.who, pay, left: d.left };
}

/* ================= 理想阶梯 ================= */
const METRICS = {
  'money': { label: '存款', get: S => S.player.money, unit: '元' },
  '专业': { label: '看家本事', get: S => S.player.attrs['专业'], unit: '' },
  '表达': { label: '表达', get: S => S.player.attrs['表达'], unit: '' },
  '谋划': { label: '谋划', get: S => S.player.attrs['谋划'], unit: '' },
  '信誉': { label: '行业口碑', get: S => S.player.信誉, unit: '' },
  '人脉': { label: '真认你的人', get: S => S.npcs.filter(n => n.rel >= 55).length, unit: '个' },
  '投入': { label: '在这件事上攒的功夫', get: S => Math.round(S.ideal.progress), unit: '' }
};
const SCENES = ['面试', '提案', '谈判', '路演', '答辩', '演出', '摊牌', '调解', '借钱', '拉人入伙'];

function normLadder(raw) {
  const stages = [];
  let id = 0;
  for (const st of (raw || []).slice(0, 3)) {
    const ms = [];
    for (const m of (st.milestones || []).slice(0, 4)) {
      if (!m || !m.title) continue;
      const key = METRICS[m.metric] ? m.metric : '投入';
      ms.push({
        id: ++id,
        title: String(m.title).slice(0, 24),
        desc: String(m.desc || '').slice(0, 40),
        metric: key,
        need: Math.max(1, num(m.need)),
        scene: SCENES.includes(m.scene) ? m.scene : '谈判',
        gate: String(m.gate || '').slice(0, 24),
        done: false, doneDate: null
      });
    }
    if (ms.length) stages.push({ name: String(st.name || '').slice(0, 16), milestones: ms });
  }
  return stages;
}
function curMile(S) {
  const L = S.ideal;
  for (let i = 0; i < L.stages.length; i++) {
    const ms = L.stages[i].milestones;
    for (let j = 0; j < ms.length; j++) if (!ms[j].done) return { stage: i, idx: j, m: ms[j], stageName: L.stages[i].name };
  }
  return null;
}
function mileStat(S, m) {
  const M = METRICS[m.metric] || METRICS['投入'];
  const cur = M.get(S);
  return { label: M.label, unit: M.unit, cur, need: m.need, ok: cur >= m.need, pct: Math.min(100, Math.round(cur / m.need * 100)) };
}
function ladderBlock(S) {
  const c = curMile(S);
  if (!c) return '（还没立下阶梯）';
  const st = mileStat(S, c.m);
  const done = [];
  for (const s of S.ideal.stages) for (const m of s.milestones) if (m.done) done.push(m.title);
  return `第${c.stage + 1}段【${c.stageName}】，眼下这一步：${c.m.title}${c.m.desc ? `（${c.m.desc}）` : ''}
　硬指标：${st.label} ${st.cur}${st.unit} / ${st.need}${st.unit}${st.ok ? '　已经够了' : `　还差${st.need - st.cur}${st.unit}`}
　门槛：${c.m.gate || c.m.scene}（要打一场${c.m.scene}才算数）
${done.length ? `已经迈过的：${done.join('、')}` : '还没迈过任何一步'}`;
}
// LLM 只能申报，引擎说了算
function judgeClaim(S, claims) {
  const c = curMile(S);
  if (!c || !(claims || []).length) return null;
  const st = mileStat(S, c.m);
  if (!st.ok) return { ok: false, title: c.m.title, short: `${st.label}还差${st.need - st.cur}${st.unit}` };
  return { ok: true, title: c.m.title, scene: c.m.scene, gate: c.m.gate };
}

/* ================= 关键局 ================= */
const OPP_TYPES = {
  '务实': { guard: 62, patience: 70, interest: 22, desc: '只认硬东西，废话听不进去',
    mul: { '摆事实': 1.55, '讲故事': 0.55, '共情': 0.7, '施压': 0.9, '让步': 1.1, '亮底牌': 1.2 } },
  '好面子': { guard: 40, patience: 62, interest: 34, desc: '爱听好听的，也爱被人捧',
    mul: { '摆事实': 0.75, '讲故事': 1.35, '共情': 1.15, '施压': 0.7, '让步': 0.9, '亮底牌': 1.1 } },
  '老江湖': { guard: 72, patience: 80, interest: 20, desc: '什么场面没见过，套路对他没用',
    mul: { '摆事实': 1.15, '讲故事': 0.5, '共情': 0.35, '施压': 0.5, '让步': 1.25, '亮底牌': 1.5 } },
  '和稀泥': { guard: 48, patience: 92, interest: 28, desc: '不表态、不得罪人、能拖就拖',
    mul: { '摆事实': 0.9, '讲故事': 0.9, '共情': 1.1, '施压': 1.6, '让步': 1.0, '亮底牌': 1.15 } },
  '急性子': { guard: 44, patience: 48, interest: 34, desc: '没耐心，要你三句话说清楚',
    mul: { '摆事实': 1.3, '讲故事': 0.85, '共情': 0.8, '施压': 1.15, '让步': 1.05, '亮底牌': 1.35 } }
};
const MOVES = {
  '摆事实': { attr: '专业', cost: 6,  tip: '把做过的、算过的摊出来' },
  '讲故事': { attr: '表达', cost: 7,  tip: '讲你要做的事，讲得让人想看下去' },
  '共情':   { attr: '情绪', cost: 5,  tip: '先站到对方那边去' },
  '施压':   { attr: '谋划', cost: 11, tip: '抬价、给期限、点破他的处境' },
  '让步':   { attr: '谋划', cost: 4,  tip: '让出一块，换他往前走一步' },
  '亮底牌': { attr: '专业', cost: 12, tip: '一局只能用一次' },
  '稳一稳': { attr: '情绪', cost: 0,  tip: '喘口气，把底气找回来' },
  '改期':   { attr: '表达', cost: 0,  tip: '今天不谈了，留个话头' }
};

function startKey(S, o) {
  const t = OPP_TYPES[o.type] ? o.type : pick(o.rng || Math.random, Object.keys(OPP_TYPES));
  const T = OPP_TYPES[t];
  const hard = clamp((num(o.hard) || 50) - num(fdm(S).keyEase), 18, 95);
  S.key = {
    scene: o.scene || '谈判',
    stake: String(o.stake || '').slice(0, 40),
    mileId: o.mileId || null,
    kind: o.kind || 'mile',
    who: o.who || null,
    opp: { name: String(o.name || '对方').slice(0, 12), type: t, note: String(o.note || T.desc).slice(0, 40) },
    hard,
    guard: clamp(T.guard + (hard - 50) * 0.35, 10, 95),
    patience: clamp(T.patience - (hard - 50) * 0.2, 20, 100),
    interest: clamp(T.interest - (hard - 50) * 0.25, 5, 70),
    nerve: clamp(62 + S.player.attrs['情绪'] * 0.35 - (S.player.energy < 40 ? 15 : 0) - S.status.length * 4, 20, 100),
    round: 0, log: [], used: {}, lastMove: null, usedCard: false, over: false, result: null, cost: 0
  };
  return S.key;
}

function keyRound(S, move, rng) {
  rng = rng || Math.random;
  const K = S.key;
  if (!K || K.over) return null;
  const mv = MOVES[move];
  if (!mv) return null;
  if (move === '亮底牌' && K.usedCard) return { bad: '底牌已经亮过了' };
  K.round++;
  const T = OPP_TYPES[K.opp.type];
  let mul = (T.mul && T.mul[move]) || 1;
  // 同一套路使第二遍就不灵了
  K.used = K.used || {};
  const seen = K.used[move] || 0;
  mul *= seen === 0 ? 1 : seen === 1 ? 0.7 : 0.45;
  if (K.lastMove === move) mul *= 0.7;
  K.used[move] = seen + 1;
  K.lastMove = move;
  const roll = d20(rng);
  const val = attrVal(S, mv.attr);
  // 属性和门槛同尺度，骰子给浮动；压过多少折成 -12 到 +12 的力道
  let pw = clamp((val + rollMod(roll) - K.hard) / 4, -14, 14);
  pw = pw >= 0 ? pw * mul : pw / Math.max(0.5, mul);
  const d = { guard: 0, interest: 0, patience: 0, nerve: -mv.cost };
  let note = '';

  if (move === '摆事实') { d.guard = -(5 + pw * 0.9); d.interest = 3 + pw * 0.5; d.patience = -2; }
  else if (move === '讲故事') { d.interest = 6 + pw * 1.0; d.guard = -(1 + pw * 0.3); d.patience = -4; }
  else if (move === '共情') {
    d.patience = 6 + pw * 0.6; d.guard = -(3.5 + pw * 0.7); d.interest = 1;
    if (mul < 0.5 && pw < 0) { d.guard = 6; d.patience = 0; note = '这话他听过太多遍了'; }
  }
  else if (move === '施压') {
    if (pw >= 0) { d.interest = 9 + pw; d.guard = -(7 + pw * 0.8); d.patience = -7; note = '压住了'; }
    else { d.patience = pw * 1.6; d.guard = 9; d.interest = -4; note = '把人惹毛了'; }
  }
  else if (move === '让步') { d.guard = -(10 + pw * 0.4); d.interest = 7; d.patience = 5; K.cost += 1; note = '这一步是拿东西换的'; }
  else if (move === '亮底牌') { K.usedCard = true; d.interest = 16 + pw * 1.2; d.guard = -(13 + pw); d.patience = 3; }
  else if (move === '稳一稳') { d.nerve = 16; d.patience = -6; }
  else if (move === '改期') { K.over = true; K.result = '留口子'; d.guard = 8; }

  K.guard = clamp(K.guard + d.guard, 0, 100);
  K.interest = clamp(K.interest + d.interest, 0, 100);
  K.patience = clamp(K.patience + d.patience, 0, 100);
  K.nerve = clamp(K.nerve + d.nerve, 0, 100);

  // 对方回敬
  let oppMove = '压价';
  if (!K.over) {
    const or = d20(rng);
    const opw = Math.max(0, (K.hard + rollMod(or)) / 8);
    if (K.guard > 58) oppMove = '推'; else if (K.interest > 55) oppMove = '追问'; else if (K.patience < 40) oppMove = '看表'; else oppMove = '压价';
    if (oppMove === '推') K.nerve = clamp(K.nerve - (3 + opw * 0.5), 0, 100);
    else if (oppMove === '追问') { K.nerve = clamp(K.nerve - (1.5 + opw * 0.25), 0, 100); K.guard = clamp(K.guard - 2, 0, 100); }
    else if (oppMove === '看表') { K.patience = clamp(K.patience - 4, 0, 100); K.nerve = clamp(K.nerve - 2.5, 0, 100); }
    else { K.nerve = clamp(K.nerve - 2.5, 0, 100); K.interest = clamp(K.interest - 1.5, 0, 100); }
  }

  const rec = { round: K.round, move, roll, val, pw: Math.round(pw * 10) / 10, note, oppMove,
    st: { guard: Math.round(K.guard), interest: Math.round(K.interest), patience: Math.round(K.patience), nerve: Math.round(K.nerve) } };
  K.log.push(rec);

  if (!K.over) {
    if (K.interest >= 70 && K.guard <= 35) { K.over = true; K.result = '谈成'; }
    else if (K.patience <= 0) { K.over = true; K.result = '谈崩'; K.why = '对方不想再听了'; }
    else if (K.nerve <= 0) { K.over = true; K.result = '留口子'; K.why = '你自己先撑不住了'; }
    else if (K.round >= 8) {
      const score = K.interest - K.guard;
      K.over = true;
      K.result = score >= 15 ? '谈成' : score >= -12 ? '留口子' : '谈崩';
    }
  }
  rec.result = K.result;
  return rec;
}

// 打完了记账：里程碑、代价、名声
function settleKey(S) {
  const K = S.key;
  if (!K) return null;
  const out = { result: K.result, scene: K.scene, opp: K.opp.name, rounds: K.round, cost: K.cost, mile: null, price: [] };
  const f = fdm(S);
  if (K.kind === 'love' || K.kind === 'marry') {
    const who = K.opp.name;
    if (K.result === '谈成') {
      if (K.kind === 'love') { startRomance(S, K.who || who, '在一起'); out.love = K.who || who; }
      else {
        const cost = Math.round((CITIES[S.city] || CITIES['新一线']).rent * 30);
        marry(S, cost);
        out.married = K.who || who; out.cost = cost;
      }
    } else if (K.result === '谈崩') {
      const n = S.npcs.find(x => x.name === (K.who || who));
      if (n) n.rel = clamp(n.rel - 10, 0, 100);
      out.price.push('话说破了，反而远了');
    }
    S.player.energy = clamp(S.player.energy - 8, 0, 100);
    S.stats.keys = (S.stats.keys || 0) + 1;
    if (K.result === '谈成') S.stats.keyWins = (S.stats.keyWins || 0) + 1;
    S.key = null;
    return out;
  }
  if (K.kind === 'raise') {
    if (K.result === '谈成') {
      const up = Math.round(S.ledger.salary * (0.09 + Math.random() * 0.09));
      S.ledger.salary += up;
      S.ledger.base = Math.round(S.ledger.salary / LEVELS[clamp(num(S.job.lv), 0, 5)].pay);
      out.raise = up;
    } else if (K.result === '谈崩') { S.job.mood = (S.job.mood || 0) - 10; out.price.push('老板那边记了一笔'); }
    S.job.askedRaise = shortDate(S.date);
    S.player.energy = clamp(S.player.energy - 6, 0, 100);
    S.stats.keys = (S.stats.keys || 0) + 1;
    if (K.result === '谈成') S.stats.keyWins = (S.stats.keyWins || 0) + 1;
    S.key = null;
    return out;
  }
  if (K.result === '谈成') {
    S.player.信誉 = clamp(S.player.信誉 + 4, 0, 100);
    if (K.mileId) {
      for (const st of S.ideal.stages) for (const m of st.milestones) if (m.id === K.mileId && !m.done) {
        m.done = true; m.doneDate = shortDate(S.date);
        out.mile = m.title;
        // 上一个台阶，是要拿东西换的
        const en = Math.round(12 * f.cost);
        S.player.energy = clamp(S.player.energy - en, 0, 100);
        out.price.push(`精力-${en}`);
        const far = S.npcs.filter(n => !n.close).sort((a, b) => (a.lastSeen || 0) - (b.lastSeen || 0))[0];
        if (far && f.cost >= 0.7) { far.rel = clamp(far.rel - 8, 0, 100); out.price.push(`${far.name}那边疏了`); }
      }
    }
  } else if (K.result === '谈崩') {
    S.player.信誉 = clamp(S.player.信誉 - 2, 0, 100);
    if (K.round >= 4) addRift(S, K.opp.name, `${K.scene}那回谈崩了`, K.kind === 'job' ? '竞对' : '私怨', 18);
    S.player.energy = clamp(S.player.energy - Math.round(10 * f.cost), 0, 100);
    out.price.push('灰头土脸');
  }
  if (K.cost > 0) {
    const money = Math.round(K.cost * 800 * f.cost);
    S.player.money -= money;
    out.price.push(`让出去的折成钱约${money}`);
  }
  S.stats.keys = (S.stats.keys || 0) + 1;
  if (K.result === '谈成') S.stats.keyWins = (S.stats.keyWins || 0) + 1;
  S.key = null;
  return out;
}

/* ---------- 雷同检测（照搬武侠版的思路） ---------- */
function bigrams(s) {
  s = String(s || '').replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}
function simRatio(a, b) {
  const A = bigrams(a), B = new Set(bigrams(b));
  if (!A.length || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / A.length;
}
function stuckLevel(S) {
  const r = S.recent;
  if (r.length < 2) return 0;
  const last = r[r.length - 1].narrative;
  let worst = 0;
  for (let i = Math.max(0, r.length - 4); i < r.length - 1; i++)
    worst = Math.max(worst, simRatio(last, r[i].narrative));
  return Math.round(worst * 100);
}
const NUDGES = [
  '换个地方：把这一段写到一个还没出现过的场所里去',
  '让一个人主动找上门，带着一件跟上一段无关的事',
  '让主角原本打算做的事落空，被别的事插队',
  '把时间推快一些，跳过日常，直接写到下一件有分量的事',
  '让主角知道一件他此前不知道的事，且这件事对他有影响'
];
function pickNudge(rng) { return pick(rng || Math.random, NUDGES); }

/* ---------- 导出 ---------- */
const API = {
  SAVE_VERSION, ORIGINS, CITIES, FREEDOM, TRACKS, SLOTS, ACTS, ATTRS, SLEEP_EN, DEF_SCHEDULE, EVT_TAGS,
  num, clamp, r2, mkRng, d20, rollMod, rnd, pick, fateInfo, fdm,
  dOf, fromDate, addDays, wdOf, isRest, dateStr, shortDate, daysBetween, festivalOf,
  newState, todayPlan, dayTick, moneyTick, peerTick, npcTick, advance, settleFocus, applyConvo,
  rollCheck, attrVal, applyTurn, growAttr,
  simRatio, stuckLevel, pickNudge,
  housePrice, canBuy, buyHouse, homeWorth, partnerOf, startRomance, marry, breakUp, wantKid, familyTick, kidCost, kidsGrow, kidStage,
  scoreLines, endReason, endingScore, keepGoing,
  BIZ_KINDS, bizSetup, bizBase, openBiz, bizCandidates, hireBiz, fireBiz, raiseBiz, bizMonth, closeBiz, madeName,
  WIND, ERA, windMul, windTick, yearSnap, yearDiff,
  RIFT_KINDS, addRift, easeRift, riftTick, noteAil, chronicLoad, energyCap,
  LEVELS, jobLv, nextReview, jobTick, review, quitJob, takeJob, addDebt, debtTick, payDebt,
  METRICS, SCENES, OPP_TYPES, MOVES, normLadder, curMile, mileStat, ladderBlock, judgeClaim,
  startKey, keyRound, settleKey
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.ENGINE = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
