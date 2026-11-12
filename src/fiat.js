/* 言出法随：独立的世界改写通道。只校验存档数据结构，不执行玩法门槛。 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else factory(root.ENGINE);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(E) {
'use strict';
const obj = v => v && typeof v === 'object' && !Array.isArray(v);
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const safeAdd = (a, b) => { const v = finite(a) + finite(b); return Number.isFinite(v) ? v : Math.sign(v) * Number.MAX_VALUE; };
// 仅过滤无法保存的值和原型键，不对指令、条目数量、金额或文字长度设玩法上限。
function clean(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return E.finiteNumber(v);
  if (Array.isArray(v)) return v.map(clean).filter(x => x !== undefined);
  if (!obj(v)) return undefined;
  const out = {};
  for (const k of Object.keys(v)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
    const value = clean(v[k]);
    if (value !== undefined) out[k] = value;
  }
  return out;
}
function worldOf(S) {
  const W=obj(S.fiatWorld)?S.fiatWorld:(S.fiatWorld={});
  for(const k of ['facts','rules','assets','businesses','homes','commands']) if(!Array.isArray(W[k])) W[k]=[];
  return W;
}
function normalizeState(S) {
  const numbers = (x, defaults) => { for (const [k,v] of Object.entries(defaults)) x[k]=finite(x[k],v); };
  const strings = (x, keys) => { for (const k of keys) if (x[k] !== undefined) x[k]=String(x[k] ?? ''); };
  if (obj(S.fiatWorld)) {
    for(const k of ['facts','rules','assets','businesses','homes']) S.fiatWorld[k]=(Array.isArray(S.fiatWorld[k])?S.fiatWorld[k]:[])
      .map(x=>typeof x==='string'?{name:x,detail:''}:x).filter(x=>obj(x)&&(x.name||x.title||x.what)).map(x=>({...x,name:String(x.name||x.title||x.what)}));
    S.fiatWorld.commands=(Array.isArray(S.fiatWorld.commands)?S.fiatWorld.commands:[]).filter(obj);
  }
  const business = b => {
    strings(b,['name','kind','since','detail']);
    numbers(b,{months:0,rent:0,rep:100,tend:0,rev:0,cost:0,net:0,lossMonths:0,best:0,total:0,setup:0});
    b.staff=(Array.isArray(b.staff)?b.staff:[]).filter(obj).map(st=>{
      const n=Object.assign({name:'员工',role:'员工'},st); strings(n,['name','role']);
      numbers(n,{skill:50,pay:0,loyal:60,months:0}); return n;
    });
  };
  if (obj(S.biz)) business(S.biz);
  if (obj(S.fiatWorld)) for (const b of (S.fiatWorld.businesses||[]).filter(obj)) business(b);
  if (obj(S.family)) {
    if (S.family.partner !== null && !obj(S.family.partner)) S.family.partner=null;
    if (S.family.partner) { strings(S.family.partner,['name','stage','since','marriedAt']); numbers(S.family.partner,{warm:100,sinceDay:S.stats.days}); }
    S.family.kids=(Array.isArray(S.family.kids)?S.family.kids:[]).filter(obj).map(k=>{strings(k,['name','born']);numbers(k,{age:0,bornY:S.date.y,dueDay:S.stats.days});return k;});
  }
  for (const key of ['status','chronic']) S[key]=(Array.isArray(S[key])?S[key]:[]).filter(obj).map(x=>{strings(x,['name','desc']);numbers(x,{days:1,eased:0});return x;});
  const B=E.bankOf(S);
  numbers(B,{mmf:0,mmfGain:0,nav:1,credit:60,curAcc:0,id:0});
  B.nav=Math.max(Number.MIN_VALUE,B.nav);
  B.fund=obj(B.fund)?B.fund:{};numbers(B.fund,{units:0,cost:0,mark:0});
  for (const key of ['fixed','wm','loans']) B[key]=(Array.isArray(B[key])?B[key]:[]).filter(obj).map(x=>{
    if (!Number.isFinite(Number(x.id))) x.id=++B.id;
    else { x.id=Number(x.id); B.id=Math.max(B.id,x.id); }
    numbers(x,{amount:0,rate:0,day:S.stats.days,dueDay:S.stats.days+365});
    if (key==='loans') { strings(x,['kind','date']); if(!x.kind)x.kind='信用贷'; numbers(x,{left:x.amount,monthly:0,months:12,paid:0,owe:0,late:0}); }
    else { strings(x,['due']); if(!x.due)x.due=E.shortDate(S.date); if(key==='fixed')numbers(x,{term:12}); }
    return x;
  });
  if (obj(S.home.loan)) numbers(S.home.loan,{left:0,monthly:0,months:360,paid:0});
  return E.finiteState(S);
}
function renamePerson(S, before, after) {
  const fields=(list,keys)=>{for(const x of list||[])if(obj(x))for(const k of keys)if(x[k]===before)x[k]=after;};
  fields(S.msgs,['from']); fields(S.debts,['who']); fields(S.pays,['from','to']); fields(S.rifts,['who']); fields(S.pledges,['who']); fields(S.stopWhen,['who']); fields(S.stopQueue,['who']); fields(S.appts,['who']);
  for(const a of S.appts||[]) if(a.wed) fields([a.wed],['who']);
  for(const g of S.groups||[]) { g.members=g.members.map(n=>n===before?after:n); fields(g.msgs,['from']); }
  for(const m of S.moments||[]) { fields([m],['who']); fields(m.cs,['who','to']); for(const k of ['likers','likes']) if(Array.isArray(m[k]))m[k]=m[k].map(n=>n===before?after:n); }
  fields([S.family.partner,S.promiseAsk],['name','who']); fields(S.family.kids,['name']); fields(S.peers,['name']);
  if(S.key) { fields([S.key],['who']); fields([S.key.opp],['name']); }
  if(S.convo) { fields([S.convo],['name']); fields(S.convo.lines,['from']); fields(S.convo.hist,['from']); }
}
function upsert(list, entries, make) {
  for (const raw of Array.isArray(entries) ? entries : []) {
    const x = typeof raw === 'string' ? { name: raw } : raw;
    if (!obj(x)) continue;
    const name = String(x.name || x.title || x.what || '').trim();
    if (!name) continue;
    const at = list.findIndex(y => String(y.name || y.title || y.what || y) === String(x.oldName || name));
    if (x.remove === true) { if (at >= 0) list.splice(at, 1); continue; }
    const value = Object.assign({}, at >= 0 && obj(list[at]) ? list[at] : make(name), x, { name });
    delete value.remove;
    if (at >= 0) list[at] = value; else list.push(value);
  }
}
function validDate(d) {
  if (typeof d === 'string') {
    const m = d.match(/^(-?\d+)[年\/-](\d+)[月\/-](\d+)/);
    if (m) d = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }
  if (!obj(d) || ![d.y, d.m, d.d].every(Number.isInteger)) throw Error('时间改写缺少有效的年月日，请重试');
  const dt = new Date(0); dt.setFullYear(d.y, d.m - 1, d.d); dt.setHours(12, 0, 0, 0);
  if (!Number.isFinite(dt.getTime()) || dt.getFullYear() !== d.y || dt.getMonth() + 1 !== d.m || dt.getDate() !== d.d) throw Error('时间改写的日期格式有误，请重试');
  return { y: d.y, m: d.m, d: d.d };
}
function setTime(S, date, days, explicitAge) {
  const old = S.date;
  const next = date !== undefined ? validDate(date) : E.addDays(old, finite(days));
  validDate(next);
  const delta = E.daysBetween(old, next);
  S.date = next;
  S.stats.days = finite(S.stats.days) + delta;
  // 沙盒里推进日期本身不改年龄；年龄变化由同一条指令的player.age明确给出。
  for (const n of S.npcs) { n.age=finite(n.age)+(old.y-finite(n.ageY,old.y)); n.ageY=next.y; }
  S.player.age0 = S.player.age - (next.y - S.startDate.y);
  // 时间是玩家直接改写的，不逐日强制触发账单、衰老、退休、失败或到期弹窗。
  return delta;
}
function applyChanges(S, input) {
  if (!E.fdm(S).fiat || !obj(input)) return false;
  const c = clean(input), W = worldOf(S), p = S.player;
  normalizeState(S);
  const beforeMoney = finite(p.money);
  const P = obj(c.player) ? c.player : {};
  if (P.money === '无限' || P.money === '无穷') {
    p.wealthLabel = P.money; P.money = Number.MAX_VALUE;
    upsert(W.facts, [{ name:'财富设定', detail:p.wealthLabel }], name=>({name}));
  } else if (own(P,'money')) { delete p.wealthLabel; }
  for (const k of ['name', 'gender', 'ideal', 'skillName', 'face']) if (typeof P[k] === 'string') p[k] = P[k];
  for (const k of ['money', 'energy', 'age', '信誉', '人品', '资历天']) if (own(P, k)) p[k] = finite(P[k], p[k]);
  if (own(c, 'moneyDelta')) p.money = safeAdd(p.money, c.moneyDelta);
  if (obj(P.attributes)) for (const k of E.ATTRS) if (own(P.attributes, k)) p.attrs[k] = p.attrF[k] = finite(P.attributes[k], p.attrs[k]);
  if (c.date !== undefined || own(c, 'days')) setTime(S, c.date, c.days, own(P, 'age'));
  else if (own(P, 'age')) p.age0 = p.age - (S.date.y - S.startDate.y);
  if (obj(P.bg)) for (const k of ['edu', 'school', 'major', 'persona', 'looks']) if (typeof P.bg[k] === 'string') p.bg[k] = P.bg[k];
  if (typeof P.track === 'string') {
    if (E.TRACKS[P.track]) p.track = P.track;
    else upsert(W.facts, [{ name: '当前身份与赛道', detail: P.track }], name => ({ name }));
  }
  if (typeof c.origin === 'string') {
    if (E.ORIGINS[c.origin]) S.origin = c.origin;
    else upsert(W.facts, [{ name: '改写后的出身', detail: c.origin }], name => ({ name }));
  }
  if (typeof c.city === 'string') {
    if (E.CITIES[c.city]) S.city = c.city;
    else upsert(W.facts, [{ name: '当前城市与世界', detail: c.city }], name => ({ name }));
  }
  if (typeof c.place === 'string') S.place = c.place;
  if (obj(c.ledger)) for (const k of ['salary', 'base', 'rent', 'living', 'remit', 'subsidy', 'loan']) if (own(c.ledger, k)) S.ledger[k] = finite(c.ledger[k], S.ledger[k]);
  if (obj(c.job)) {
    const J = S.job;
    for (const k of ['employer', 'post', 'title']) if (typeof c.job[k] === 'string') J[k === 'title' ? 'post' : k] = c.job[k];
    if (own(c.job, 'lv')) J.lv = Math.max(0, finite(c.job.lv));
    if (own(c.job, 'out')) J.out = c.job.out === true;
    else if (c.job.employer || c.job.title || c.job.post) J.out = false;
    if (c.job.title || c.job.post) J.fiatTitle = String(c.job.title || c.job.post);
    if (own(c.job, 'salary')) S.ledger.salary = Math.max(0, finite(c.job.salary));
    if (J.out) { J.fiatTitle = ''; S.ledger.salary = 0; }
    J.title = E.jobTitle(S); J.probation = false; J.vary = 0;
    S.ledger.base = S.ledger.salary / E.payMul(S, J.lv);
  }
  if (obj(c.health)) {
    if (c.health.clear === true) { S.status = []; S.chronic = []; S.ailLog = {}; S.flags.nightCnt = 0; }
    for (const key of ['status', 'chronic']) if (Array.isArray(c.health[key])) S[key] = c.health[key].filter(x => obj(x) && x.name).map(x => Object.assign({ desc: '', days: 1, eased: 0 }, x));
  }
  if (c.clearDebts === true) {
    S.debts = []; E.bankOf(S).loans = [];
    if (S.home && S.home.loan) { S.home.loan.left = 0; S.home.loan.done = true; }
    S.ledger.loan = 0;
    for (const r of S.rifts) if (r.kind === '债主') r.done = true;
  }
  if (obj(c.bank)) {
    const B = E.bankOf(S);
    if (own(c.bank, 'credit')) B.credit = finite(c.bank.credit, B.credit);
    if (own(c.bank, 'mmf')) B.mmf = finite(c.bank.mmf, B.mmf);
    if (own(c.bank, 'nav')) B.nav = Math.max(Number.MIN_VALUE, finite(c.bank.nav, B.nav));
    if (obj(c.bank.fund)) for (const k of ['units', 'cost', 'mark']) if (own(c.bank.fund, k)) B.fund[k] = finite(c.bank.fund[k], B.fund[k]);
    for (const k of ['fixed', 'wm', 'loans']) if (Array.isArray(c.bank[k])) {
      B[k] = c.bank[k].filter(x => obj(x) && x.amount !== undefined).map(x => {
        const id = ++B.id, amount = finite(x.amount), months = Math.max(1, finite(x.months, 12));
        return Object.assign({ id, amount, left: amount, rate: 0, months, monthly: amount / months, paid: 0, owe: 0, late: 0, term: 12, day: S.stats.days, dueDay: S.stats.days + 365, due: E.shortDate(E.addDays(S.date, 365)), date: E.shortDate(S.date) }, x, { id });
      });
    }
  }
  if (Array.isArray(c.debts)) S.debts = c.debts.filter(x => obj(x) && x.who).map(x => ({ who: String(x.who), amount: finite(x.amount), left: finite(x.left, finite(x.amount)), due: x.due ? validDate(x.due) : E.addDays(S.date, 60), late: false }));
  if (obj(c.home)) {
    const h = c.home, oldLoan=S.home.loan;
    const acquired=!!(h.name && h.name!==S.home.name) || (h.kind==='买' && S.home.kind!=='买');
    if (S.home && h.name && S.home.name && S.home.name !== h.name) upsert(W.homes, [Object.assign({ name: S.home.name }, S.home)], name => ({ name }));
    S.home = Object.assign({}, S.home, h, { kind: h.kind || (acquired ? '买' : S.home.kind), since: acquired ? E.shortDate(S.date) : S.home.since });
    if (S.home.kind === '买') {
      S.ledger.rent = 0;
      // 指令直接获得的房子默认为全款，只有明确给出贷款才保留贷款。
      if(own(h,'loan') || acquired) S.home.loan = obj(h.loan) ? Object.assign({ left: 0, monthly: 0, months: 360, paid: 0 }, !acquired&&obj(oldLoan)?oldLoan:{}, h.loan) : null;
      S.ledger.loan = S.home.loan ? finite(S.home.loan.monthly) : 0;
    } else {
      if (!E.HOUSING[S.home.tier]) S.home.tier = '整租一居';
      if (own(h, 'rent')) S.ledger.rent = finite(h.rent);
    }
    upsert(W.homes, [Object.assign({}, S.home, { name: S.home.name || h.place || '当前住处' })], name => ({ name }));
  }
  for (const x of Array.isArray(c.npcs) ? c.npcs : []) if (obj(x) && x.oldName && x.name && x.oldName!==x.name) renamePerson(S,x.oldName,x.name);
  upsert(S.npcs, c.npcs, name => ({ name, age: 0, ageY: S.date.y, gender: '', job: '', tie: '新相识', care: '', note: '', rel: 50, close: false, facts: [], mem: [], lastSeen: S.stats.days }));
  for(const x of Array.isArray(c.npcs)?c.npcs:[]) if(obj(x)) {
    const n=S.npcs.find(n=>n.name===x.name); if(!n)continue;
    if(own(x,'age')) n.ageY=S.date.y;
    if(x.oldName && x.oldName!==x.name) n.aliases=[...new Set([...(n.aliases||[]),x.oldName])];
  }
  for (const n of S.npcs) {
    if (!Array.isArray(n.facts)) n.facts = [];
    if (!Array.isArray(n.mem)) n.mem = [];
    n.rel = finite(n.rel); n.age = finite(n.age); n.talk = E.talkOf(n);
    if (n.intimate===true) { delete n.intimate; E.markIntimate(S,n); }
    if (n.intimate===false) delete n.intimate;
  }
  if (obj(c.family)) {
    if (own(c.family,'partner') && c.family.partner!==null && !obj(c.family.partner)) throw Error('伴侣资料需要是一个对象或空值');
    if (own(c.family, 'partner')) S.family.partner = c.family.partner === null ? null : Object.assign({ name: '', stage: '在一起', warm: 100, since: E.shortDate(S.date), sinceDay: S.stats.days, over: false }, S.family.partner||{}, c.family.partner);
    if (Array.isArray(c.family.kids)) S.family.kids = c.family.kids.filter(x => obj(x) && x.name).map(x => Object.assign({ age: 0, unborn: false, born: E.shortDate(S.date), bornY: S.date.y }, x));
  }
  upsert(W.assets, c.assets, name => ({ name, detail: '', quantity: 1 }));
  const businesses=(Array.isArray(c.businesses)?c.businesses:[]).map(b=>typeof b==='string'?{name:b}:b).filter(obj);
  if(S.biz && !S.biz.dead && businesses.some(b=>(b.oldName||b.name)===S.biz.name)) {
    const cached=W.businesses.find(b=>b.name===S.biz.name), previousKind=cached&&cached.kind;
    upsert(W.businesses,[S.biz],name=>({name}));
    if(previousKind) W.businesses.find(b=>b.name===S.biz.name).kind=previousKind;
  }
  const existingNames=new Set(W.businesses.map(b=>b.name));
  upsert(W.businesses, businesses, name => ({ name, kind: '自定义事业', staff: [], detail: '', dead: false }));
  for (const b of W.businesses) if (!Array.isArray(b.staff)) b.staff = [];
  if (businesses.length) {
    const removed=businesses.some(b=>b.remove && S.biz && (b.oldName||b.name)===S.biz.name);
    const newly=businesses.filter(b=>!b.remove&&!existingNames.has(b.name)).at(-1);
    const current=S.biz && W.businesses.find(b=>b.name===S.biz.name);
    const b = newly ? W.businesses.find(b=>b.name===newly.name) : current || ((!S.biz||removed)?W.businesses[W.businesses.length-1]:null);
    if (b) S.biz = Object.assign({ name: b.name, kind: '小公司', since: E.shortDate(S.date), sinceY: S.date.y, rent: 0, staff: [], rep: 100, tend: 0, months: 0, rev: 0, cost: 0, net: 0, lossMonths: 0, best: 0, total: 0, setup: 0, dead: false }, b, { kind: E.BIZ_KINDS[b.kind] ? b.kind : '小公司' });
    else if (removed) S.biz=null;
  }
  upsert(W.facts, c.facts, name => ({ name, detail: '' }));
  upsert(W.rules, c.rules, name => ({ name, detail: '' }));
  const known = new Set(['player','moneyDelta','origin','city','place','ledger','job','health','clearDebts','bank','debts','home','npcs','family','assets','businesses','facts','rules','milestones','date','days','clearEvents','over','ending']);
  for (const k of Object.keys(c)) if (!known.has(k)) upsert(W.facts, [{ name: k, detail: typeof c[k] === 'string' ? c[k] : JSON.stringify(c[k]) }], name => ({ name }));
  for (const name of Array.isArray(c.milestones) ? c.milestones : []) {
    let hit = false;
    for (const st of S.ideal.stages) for (const m of st.milestones) if (m.title === name || name === '*') { m.done = true; m.doneDate = E.shortDate(S.date); hit = true; }
    if (!hit) upsert(W.facts, [{ name: String(name), detail: '已达成' }], name => ({ name }));
  }
  if (c.clearEvents === true) { S.promiseAsk = null; S.stopQueue = []; S.key = null; S.focus = null; S.interview = null; S.appts = []; S.pledges = []; S.stopWhen = []; }
  if (own(c, 'over')) { S.over = c.over === true; S.ending = S.over ? String(c.ending || '按你的意思收尾') : null; }
  p.job = E.jobLabel(S); S.broke = false; S.capNote = null; S.claimNote = null;
  normalizeState(S);
  const money = p.money - beforeMoney;
  if (Number.isFinite(money) && money) E.acct(S, '言出法随·世界改写', money, S.lastAction || '', beforeMoney);
  return true;
}
// 世界设定照常发送，旧命令和人物记忆只在本轮用得上时带入。
function context(S, action, chat = false) {
  const { name, gender, ideal, skillName, bg, track, ...mutable } = S.player;
  const { commands = [], ...world } = S.fiatWorld || {};
  const targeted = action !== undefined;
  const npcs = targeted ? S.npcs.map(n => ({
    ...n, talk: E.talkOf(n), mem: relevantHistory(n.mem, action, t => [t], 2)
  })) : S.npcs;
  let unresolved = S.unresolved;
  if (targeted) unresolved = chat ? relevantHistory(S.unresolved, action, t => [t], 5) : storyTopics(S, action);
  return JSON.stringify({
    identity: { name, gender, ideal, skillName, bg, track }, origin: S.origin, city: S.city, world,
    commands: targeted ? relevantHistory(commands, action, c => [c.command, c.result], 4) : commands.slice(-12),
    player: mutable, place: S.place, job: S.job, ledger: S.ledger, home: S.home, biz: S.biz, bank: S.bank, debts: S.debts,
    health: { status: S.status, chronic: S.chronic }, family: S.family, npcs, ideal: S.ideal, unresolved,
    recent: targeted ? relevantHistory(S.history, action, h => [h.act, h.summary], 4) : S.history.slice(-12),
    events: { promise: S.promiseAsk, key: S.key, focus: S.focus, queue: S.stopQueue }, over: S.over, date: S.date
  });
}
const topicKey=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s，。！？、；：,.!?;:「」“”"'（）()…—-]/g,'');
const sameTopic=(a,b)=>!!topicKey(a)&&topicKey(a)===topicKey(b);
const recallCue=s=>/(回顾|还记得|记不记得|以前|当年|之前|上次|曾经|历史|原先|最早|那件事|刚才|前面说|earlier|previous|recall|before)/i.test(String(s||''));
const quietScene=s=>/(亲热|亲昵|亲吻|接吻|亲了|吻了|亲一下|拥抱|抱抱|抱一会|抱着|依偎|靠在.{0,5}肩|靠着.{0,5}肩|独处|温存|说悄悄话|安静待|静静待)/.test(String(s||''));
const topicPivot=s=>quietScene(s)||/(换个话题|不说这个|先不聊|聊点别的|别再提)/.test(String(s||''));
const continueScene=s=>!topicKey(s)||/^(继续|下一段|接着|接下去|往下走|然后呢)[吧啊。！？!?]*$/.test(String(s).trim());
function topicTerms(s) {
  const cue = String(s || '').normalize('NFKC').toLowerCase()
    .replace(/回顾|记不记得|还记得|以前|之前|上次|刚才|那个|这个|那件事|怎么样|怎么回事|跟我说|说一下|一下|今天|现在|咱们|我们|一起|给我|想要|可以|好不好|要不要|的/g, ' ');
  const parts = cue.match(/[a-z0-9]{2,}|[\u3400-\u9fff]{2,}/g) || [];
  const terms = new Set();
  for (const part of parts) {
    if (/^[a-z0-9]+$/.test(part)) terms.add(part);
    else for (let i = 0; i < part.length - 1; i++) terms.add(part.slice(i, i + 2));
  }
  return terms;
}
function hasTopicTerm(terms, text) {
  const hay = topicKey(text);
  for (const term of terms) if (hay.includes(term)) return true;
  return false;
}
function relatedTo(action, text) { return hasTopicTerm(topicTerms(action), text); }
function relevantHistory(rows, action, fields, max) {
  const list = (rows || []).slice(-120);
  const terms = topicTerms(action);
  const hits = list.filter(row => fields(row).some(text => hasTopicTerm(terms, text)));
  const broadRecall = !hits.length && recallCue(action) && !topicPivot(action);
  return (broadRecall ? list : hits).slice(-max);
}
function storyCue(S, action) {
  let cue = String(action || '');
  if (recallCue(cue) && !topicPivot(cue)) return cue;
  for (const n of S.npcs) if (String(n.name || '').length >= 2) cue = cue.split(n.name).join(' ');
  return cue.trim() || String(action || '');
}
function storyTopics(S, cue) {
  const topics = S.unresolved || [];
  if (/未了|未决|待办|所有事项|全部事情/.test(String(cue))) return topics;
  if (continueScene(cue)) return topics.slice(-12);
  return relevantHistory(topics, cue, t => [t], 5);
}
function mergeStoryTopics(S, action, next) {
  const visible = new Set(storyTopics(S, storyCue(S, action)));
  // 模型只能结掉它读到的待办，未送入本段的仍留在存档。
  const hidden = (S.unresolved || []).filter(t => !visible.has(t));
  return [...new Set(next.concat(hidden))];
}
function cleanProgress(p) {
  if(!obj(p))return undefined;
  return {focus:String(p.focus||''),change:String(p.change||''),closed:Array.isArray(p.closed)?p.closed.map(String).filter(Boolean):[]};
}
function recordProgress(S,d,action) {
  const p=cleanProgress(d.progress), closed=[...(Array.isArray(d.resolvedInfo)?d.resolvedInfo:[]),...(p?p.closed:[])];
  if(!p&&!closed.length&&!S.storyProgress)return;
  const R=S.storyProgress || (S.storyProgress={resolved:[],beats:[]});
  if(!Array.isArray(R.resolved))R.resolved=[];
  if(!Array.isArray(R.beats))R.beats=[];
  // 只过滤同名的已结事项，不凭相似度删除玩家的其他目标。玩家点名重提时可重新挂起。
  const mentioned=t=>!!topicKey(t)&&topicKey(action).includes(topicKey(t));
  R.resolved=R.resolved.filter(t=>!mentioned(t));
  for(const t of closed)if(!R.resolved.some(x=>sameTopic(x,t)))R.resolved.push(String(t));
  S.unresolved=(S.unresolved||[]).filter(t=>!R.resolved.some(x=>sameTopic(x,t)));
  if(p)R.beats.push({seg:S.seg,focus:p.focus,change:p.change});
  R.beats=R.beats.slice(-8);
}
function storyContext(S,action) {
  const R=S.storyProgress||{}, beats=(R.beats||[]).slice(-3);
  const focus=beats.at(-1)?.focus;
  const repeated=!!focus&&beats.length>=2&&beats.slice(-2).every(b=>sameTopic(b.focus,focus));
  const similarity=E.stuckLevel(S);
  const relevant=relevantHistory(beats,action,b=>[b.focus,b.change],2);
  const current = {
    已结案或放下: relevantHistory(R.resolved, action, t => [t], 6),
    相关进展: continueScene(action) && !repeated ? beats.slice(-1) : relevant,
    当前相关未决: storyTopics(S, action)
  };
  return `【剧情进度，记忆保留但不要把旧事重演】\n${JSON.stringify(current)}\n${repeated||similarity>=45?'连续聚焦同一件事或正文高度相似。只有与本次行动有关才继续写它，并给出新信息或结果。':'写玩家此刻做的事，从当前状态往下接。'}玩家本次明确要求细写、追问、重提或继续某事时照办。同一场景可以只写一句新回应或一个新的动作。旧事已讲清就让它过去，无关小事不进正文、消息和选项。不得为了换话题代替玩家决策、强迫失败、添代价或擅自快进。`;
}
function settle(S, raw, action) {
  if (!E.fdm(S).fiat) throw Error('当前不是言出法随');
  if (!obj(raw) || typeof raw.narrative !== 'string' || !raw.narrative.trim() || raw._partial || !obj(raw.fiatChanges)) throw Error('这一段的世界改写数据没收完整，尚未结算，请重试');
  const next = clean(S), d = clean(raw);
  // 在副本里完成所有改写，任何数据错误都不会留下半笔账或半个新身份。
  applyChanges(next, d.fiatChanges);
  if (!own(d.fiatChanges,'over')) { next.over=false; next.ending=null; }
  const W = worldOf(next);
  W.commands.push({ seg:S.seg, date:E.dateStr(next.date), command:String(action), result:String(d.summary || d.narrative) });
  rememberDirectives(W, action);
  next.history.push({ seg:S.seg, date:E.shortDate(next.date), summary:String(d.summary || d.narrative), act:String(action) });
  next.recent.push({ seg:S.seg, action:String(action), narrative:d.narrative });
  if(Array.isArray(d.unresolved)) next.unresolved=mergeStoryTopics(S,action,d.unresolved.map(String));
  recordProgress(next,d,action);
  next.lastOptions = Array.isArray(d.options) ? d.options.map(String).filter(Boolean) : [];
  next.pending = null; next.plan = null; next.lastAction = null; next.actTyped = false;
  return { state:next, narrative:d.narrative };
}
function advance(S, opt) {
  const from = Object.assign({}, S.date), days = Math.max(0, finite(opt.maxDays, 1));
  setTime(S, undefined, days, false);
  const stop = { kind: '久', detail: '按你的世界设定继续，日常结算不擅自推翻已兑现的指令' };
  S.stats.stops[stop.kind] = finite(S.stats.stops[stop.kind]) + 1;
  return { from, to:S.date, days, events:[], stop };
}
function applyAtomic(S, changes) {
  if (!E.fdm(S).fiat) return false;
  const next=clean(S), convo=S.convo;
  applyChanges(next,changes);
  if(convo && next.convo) { Object.assign(convo,next.convo); next.convo=convo; }
  Object.assign(S,next);
  return true;
}
// 明示的持续要求保留原句。完整历史另行归档，当前世界事实始终完整发送。
function rememberDirectives(W, action) {
  if (!/(永远|一直|每次|每逢|今后|以后|从此|持续|始终|不要|不许|不得|不能|禁止|never|always|every time|from now on|do not|don't)/i.test(String(action))) return;
  if(!Array.isArray(W.directives)) W.directives=[];
  if(!W.directives.includes(String(action))) W.directives.push(String(action));
}
function archivePlan(S) {
  const W=S.fiatWorld;
  if (!obj(W)) return [];
  for (const r of W.commands||[]) rememberDirectives(W,r.command);
  return [['commands',W,'commands',24],['history',S,'history',120],['recent',S,'recent',12]].flatMap(([kind,owner,key,keep])=>{
    const list=owner[key];
    return Array.isArray(list)&&list.length>keep ? [{kind,owner,key,count:list.length-keep,values:list.slice(0,-keep)}] : [];
  });
}
Object.assign(E, { cleanFiat:clean, normalizeFiatState:normalizeState, applyFiatChanges:applyAtomic, fiatContext:context, settleFiatTurn:settle, fiatAdvance:advance,
  fiatArchivePlan:archivePlan, cleanStoryProgress:cleanProgress, recordStoryProgress:recordProgress, storyContext,
  topicKey, recallCue, topicPivot, continueScene, relatedTo, relevantHistory, storyCue, storyTopics, mergeStoryTopics });
});
