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
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
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
    n.rel = finite(n.rel); n.age = finite(n.age);
    if (n.intimate===true) { delete n.intimate; E.markIntimate(S,n); }
    if (n.intimate===false) delete n.intimate;
  }
  if (obj(c.family)) {
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
  const money = p.money - beforeMoney;
  if (Number.isFinite(money) && money) E.acct(S, '言出法随·世界改写', money, S.lastAction || '', beforeMoney);
  return true;
}
// 先放稳定设定与追加记录，再放余额、日期；完整状态照常发送，不缓存旧答案。
function context(S) {
  const {name,gender,ideal,skillName,bg,track,...mutable}=S.player;
  const {commands=[],...world}=S.fiatWorld || {};
  return JSON.stringify({ identity:{name,gender,ideal,skillName,bg,track}, origin:S.origin, city:S.city, world, commands,
    player:mutable, place:S.place, job:S.job, ledger:S.ledger, home:S.home, biz:S.biz, bank:S.bank, debts:S.debts,
    health:{status:S.status,chronic:S.chronic}, family:S.family, npcs:S.npcs, ideal:S.ideal, unresolved:S.unresolved,
    recent:S.history.slice(-12), events:{promise:S.promiseAsk,key:S.key,focus:S.focus,queue:S.stopQueue}, over:S.over, date:S.date }, null, 0);
}
const topicKey=s=>String(s||'').replace(/[\s，。！？、；：,.!?;:「」“”]/g,'');
const sameTopic=(a,b)=>!!topicKey(a)&&topicKey(a)===topicKey(b);
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
  const mentioned=t=>topicKey(action).includes(topicKey(t));
  R.resolved=R.resolved.filter(t=>!mentioned(t));
  for(const t of closed)if(!R.resolved.some(x=>sameTopic(x,t)))R.resolved.push(String(t));
  S.unresolved=(S.unresolved||[]).filter(t=>!R.resolved.some(x=>sameTopic(x,t)));
  if(p)R.beats.push({seg:S.seg,focus:p.focus,change:p.change});
  R.beats=R.beats.slice(-8);
}
function storyContext(S,action) {
  const R=S.storyProgress||{}, beats=(R.beats||[]).slice(-3), recent=S.recent||[];
  const focus=beats.at(-1)?.focus;
  const repeated=!!focus&&beats.length>=2&&beats.slice(-2).every(b=>sameTopic(b.focus,focus));
  const similarity=E.stuckLevel(S);
  return `【剧情进度，记忆保留但不要把旧事重演】\n${JSON.stringify({已结案或放下:R.resolved||[],最近进展:beats,最近正文:recent.slice(-2).map(r=>String(r.narrative||'').slice(-700)),当前未决:S.unresolved||[]})}\n${repeated||similarity>=45?'连续聚焦同一件事或正文高度相似。这一段必须带来实际新信息或结果，不能换句话复述疑虑、确认、安慰、手续或等待。':'承接上一段的结果，直接写新的进展。'}玩家本次明确要求细写、追问、重提或继续某事时照办；同一场景也要有新回答。不得为了换话题代替玩家决策、强迫失败、添代价或擅自快进。`;
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
  next.history.push({ seg:S.seg, date:E.shortDate(next.date), summary:String(d.summary || d.narrative), act:String(action) });
  next.recent.push({ seg:S.seg, action:String(action), narrative:d.narrative });
  next.unresolved = Array.isArray(d.unresolved) ? d.unresolved.map(String) : next.unresolved;
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
Object.assign(E, { cleanFiat:clean, applyFiatChanges:applyAtomic, fiatContext:context, settleFiatTurn:settle, fiatAdvance:advance,
  cleanStoryProgress:cleanProgress, recordStoryProgress:recordProgress, storyContext });
});
