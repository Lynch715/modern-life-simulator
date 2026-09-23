/* ===== 现代生活模拟器 · 界面与叙事层 ===== */
const E = ENGINE;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS_CFG = 'mls_cfg', LS_SAVE = 'mls_save';
const IDB_NAME = 'mls_book', IDB_STORE = 'chapters';

let S = null;
let cfg = { base: 'https://api.deepseek.com', key: '', model: 'deepseek-v4-flash', think: false, theme: 'dark', font: 'm', person: 'you' };
try { const c = JSON.parse(localStorage.getItem(LS_CFG) || 'null'); if (c) cfg = Object.assign(cfg, c); } catch (_) { }
// 老存的模型名已经停用了，悄悄换掉
if (/^deepseek-(chat|reasoner)$/i.test(cfg.model || '')) { cfg.model = 'deepseek-v4-flash'; try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (_) { } }
let busy = false, lastFinish = null, curChapter = null;

/* ================= 看着舒不舒服 ================= */
const THEME_BG = { dark: '#0f1116', light: '#f7f5f1', paper: '#f2ead9' };
function applySkin() {
  const t = THEME_BG[cfg.theme] ? cfg.theme : 'dark';
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.font = ['s', 'm', 'l'].indexOf(cfg.font) >= 0 ? cfg.font : 'm';
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', THEME_BG[t]);
}
function setSkin(k, v) {
  cfg[k] = v;
  try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (_) { }
  applySkin();
}

/* ================= 提示与开关 ================= */
let toastT = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
}
function setBusy(b, txt) {
  busy = b;
  $('busy').classList.toggle('on', !!b);
  $('busyTxt').textContent = txt || '';
  document.querySelectorAll('.act-btn,#goBtn,#focusBtn').forEach(x => x.disabled = !!b);
}
function mask(id, on) { $(id).classList.toggle('on', on); }

// 游戏自己的问话框，替掉系统的 prompt/confirm
// o: { title, text, quote, input: { value, placeholder, number }, ok, no, danger } → 有输入框返回字符串或 null，没有返回 true/false
function ask(o) {
  return new Promise(res => {
    $('askTitle').textContent = o.title || '';
    $('askText').innerHTML = esc(o.text || '') + (o.quote ? `<q>${esc(o.quote)}</q>` : '');
    const inp = $('askIn');
    inp.hidden = !o.input;
    if (o.input) {
      inp.type = o.input.number ? 'number' : 'text';
      inp.inputMode = o.input.number ? 'numeric' : 'text';
      inp.value = o.input.value != null ? o.input.value : '';
      inp.placeholder = o.input.placeholder || '';
      inp.maxLength = o.input.max || 60;
    }
    $('askOk').textContent = o.ok || '好';
    $('askNo').textContent = o.no || '算了';
    $('askOk').classList.toggle('danger', !!o.danger);
    const done = v => { mask('askMask', false); $('askOk').onclick = $('askNo').onclick = inp.onkeydown = null; res(v); };
    $('askOk').onclick = () => {
      if (!o.input) return done(true);
      const v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      done(v);
    };
    $('askNo').onclick = () => done(o.input ? null : false);
    inp.onkeydown = e => { if (e.key === 'Enter') $('askOk').onclick(); };
    mask('askMask', true);
    if (o.input) setTimeout(() => { inp.focus(); inp.select(); }, 60);
  });
}

/* ================= 全本存 IndexedDB ================= */
let idbP = null;
function idb() {
  if (idbP) return idbP;
  idbP = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no idb'));
    const rq = indexedDB.open(IDB_NAME, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const st = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        st.createIndex('run', 'run', { unique: false });
      }
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }).catch(e => { idbP = null; throw e; });
  return idbP;
}
async function bookPut(rec) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(rec);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function bookAll(run) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const rq = tx.objectStore(IDB_STORE).index('run').getAll(run);
    rq.onsuccess = () => res((rq.result || []).sort((a, b) => a.seq - b.seq));
    rq.onerror = () => rej(rq.error);
  });
}
async function bookClear(run) {
  const db = await idb(), rows = await bookAll(run);
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    for (const r of rows) st.delete(r.id);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

/* ================= 接口 ================= */
async function callLLM(prompt, onPartial, opt) {
  opt = opt || {};
  lastFinish = null;
  if (!cfg.key) { openSettings(); throw new Error('请先在设置里填密钥'); }
  const url = cfg.base.replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model: cfg.model || 'deepseek-v4-flash',
    messages: [{ role: 'system', content: styleSystem() }, { role: 'user', content: prompt }],
    temperature: opt.temperature != null ? opt.temperature : 1.02,
    max_tokens: opt.maxTokens || 8000,
    stream: true,
    response_format: { type: 'json_object' }
  };
  if (/deepseek/i.test(body.model)) body.thinking = { type: cfg.think ? 'enabled' : 'disabled' };
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const ms = opt.timeout || 180000;
  let timer = ac ? setTimeout(() => { try { ac.abort(); } catch (_) { } }, ms) : null;
  const bump = () => { if (!ac) return; clearTimeout(timer); timer = setTimeout(() => { try { ac.abort(); } catch (_) { } }, ms); };
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify(body), signal: ac ? ac.signal : undefined
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    throw new Error('接口调用失败（' + (e && e.name === 'AbortError' ? `等了${Math.round(ms / 1000)}秒没响应` : (e && e.message) || '网络不通') + '）');
  }
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try { const e = await resp.json(); msg += '：' + ((e.error && e.error.message) || JSON.stringify(e)); } catch (_) { }
    throw new Error('接口调用失败（' + msg + '）');
  }
  const reader = resp.body.getReader(), dec = new TextDecoder();
  let raw = '', buf = '';
  while (true) {
    let done, value;
    try { ({ done, value } = await reader.read()); }
    catch (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error('接口调用失败（传到一半断了）');
      throw e;
    }
    if (done) break;
    bump();
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const ln of lines) {
      const t = ln.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const ch = j.choices && j.choices[0];
        if (!ch) continue;
        if (ch.finish_reason) lastFinish = ch.finish_reason;
        const piece = (ch.delta && (ch.delta.content || '')) || '';
        if (piece) { raw += piece; if (onPartial) onPartial(raw); }
      } catch (_) { }
    }
  }
  if (timer) clearTimeout(timer);
  if (!raw.trim()) throw new Error('接口调用失败（没返回内容）');
  return raw;
}

function parseJSONLoose(raw) {
  let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'); if (a >= 0) t = t.slice(a);
  const b = t.lastIndexOf('}');
  try { return JSON.parse(b > 0 ? t.slice(0, b + 1) : t); }
  catch (_) { return JSON.parse(repairJSON(t)); }
}
function repairJSON(t) {
  let inStr = false, esc2 = false; const stack = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (esc2) { esc2 = false; continue; }
    if (inStr) { if (c === '\\') esc2 = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = t;
  if (esc2) out = out.slice(0, -1);
  if (inStr) out += '"';
  out = out.replace(/[,:\s]+$/, '');
  if (/"\s*:?\s*$/.test(out) && !inStr) { const lc = out.lastIndexOf(','); if (lc > 0) out = out.slice(0, lc); }
  for (let i = stack.length - 1; i >= 0; i--) out += (stack[i] === '{' ? '}' : ']');
  return out;
}
function extractPartialField(raw, key) {
  const m = raw.match(new RegExp('"' + key + '"\\s*:\\s*"'));
  if (!m) return null;
  let i = m.index + m[0].length, out = '';
  while (i < raw.length) {
    const c = raw[i];
    if (c === '\\') {
      const n = raw[i + 1];
      if (n === undefined) break;
      if (n === 'n') out += '\n'; else if (n === '"') out += '"'; else if (n === '\\') out += '\\';
      else if (n === 'u') { const h = raw.slice(i + 2, i + 6); if (h.length === 4) { out += String.fromCharCode(parseInt(h, 16) || 63); i += 4; } }
      else out += n;
      i += 2; continue;
    }
    if (c === '"') break;
    out += c; i++;
  }
  return out;
}
async function llmJSON(prompt, onPartial, opt) {
  let raw;
  try { raw = await callLLM(prompt, onPartial, opt); return parseJSONLoose(raw); }
  catch (e) {
    if (e.message && (e.message.startsWith('接口调用失败') || e.message.startsWith('请先在设置'))) throw e;
    const truncated = lastFinish === 'length';
    toast(truncated ? '回复太长被截断，重试一次' : '回复格式有误，重试一次');
    const extra = truncated
      ? '\n\n（上次输出太长被截断。这次把叙事压到 300 字内，newNpcs 最多 1 人，务必输出完整合法的单个 JSON）'
      : '\n\n（上次输出的 JSON 不合法，请输出严格合法的单个 JSON 对象）';
    raw = await callLLM(prompt + extra, onPartial, opt);
    try { return parseJSONLoose(raw); }
    catch (_) { throw new Error('模型两次都没给出合法格式，过会儿再试'); }
  }
}

const FREE_NOTE = {
  '心想事成': '言出法随。你自己写的行动一律当作办成了，引擎不掷凶骰，模型也不许给你打折、不许写成"差一点"。关键局门槛降 18，生意好做四分之一，糟心事只剩四成半。',
  '都市传奇': '比现实好走一些，主角有主角的运气，但该付的代价要付，失败是真失败。',
  '写实人生': '概率贴着现实来。跳槽大多只涨一点，创业大概率黄，贵人不常有，好事不扎堆。'
};

/* ================= 口径 ================= */
const PERSON = () => cfg.person === 'ta'
  ? `【人称】通篇用第三人称写主角，主语用他的名字或者"他"。`
  : `【人称】通篇用第二人称写主角：主语是"你"，不许用他的名字当主语，也不许用"他""主角"指代主角。别人说话时可以直接叫他的名字。`;

const SAY_RULE = `【必须有人说话】这是最要紧的一条。
- 但凡有人出现，就得让他开口，把原话用引号写出来。一段里至少三处直接对白，场面戏（见人、谈事、被问、起争执、求人、被拒）必须靠对话推进。
- 不许把话转述掉。下面这种写法是错的：
    ✗ 他说没拍，本子写完了，二十分钟，还没打印。
  要写成：
    ✓ "没拍。"他把本子往前推了推，"写完了，二十分钟的。还没打印。"
- 对白要像真人说话：短句、口语、半截话、答非所问、被打断、有停顿。不许每个人都说完整漂亮的长句，不许拿对白交代设定。
- 说话的人可以带一个很小的动作或语气（把手机扣在桌上、笑了一下、没接这句），但别在每句后面都缀一串形容。`;

const styleSystem = () => `${PERSON()}
${SAY_RULE}

` + STYLE_SYSTEM;
const STYLE_SYSTEM = `你是一个中文现代生活模拟游戏的叙事引擎。你只负责把引擎给定的结果写成故事，不负责决定成败。

怎么写：
- 像一个会写小说的人在写一个具体的人过的具体日子。名词要具体：几路公交、几块钱的面、几层的办公楼、几点几分的消息。
- 人说话就是人说话：有口语、有废话、会打断、会答非所问、会说一半不说了。不许所有人都说完整漂亮的长句。
- 不许写"他终于明白了""这一刻他忽然懂得""生活就是这样"之类的感悟句，尤其不许拿它收尾。
- 不许总结升华，不许每段都用天色、窗外、灯光收尾。
- 不许排比句，不许"不是……而是……"的句式堆叠，不许成语连用。
- 微信消息要像真的微信：短、有语气词、有错字也行、有人发两条、有人只回一个字。
- 写失败和难堪时不要找补，写顺利时不要煽情。
- 不出现真实存在的公司、平台、品牌、真人姓名，用虚构的名字。`;

function worldRules() {
  const f = E.FREEDOM[S.freedom];
  return `${PERSON()}
${SAY_RULE}

【世界观】当代中国都市，一切公司、平台、店铺、小区都是虚构的名字。主角${S && S.player ? S.player.age0 || 22 : 22}岁刚出校门，从零开始。
这不是爽文也不是苦难展览，是一个普通人怎么把自己想干的事一点点干起来，以及为此付出什么。

【铁律】
- 引擎的判定结果不可更改：成就是成，败就是败，钱的加减、身体的毛病、日期的推移，都必须照引擎给的写。
- 你不能宣布主角达成了理想的里程碑，那由引擎裁定。你只能把过程写出来，并在 milestoneClaim 里申报。
- 新出现的人要有来由，但生活里本来就会有人主动找上门：老同学的电话、中介的骚扰、前同事拉你入伙、家里催你，都不必事先铺垫。
- 钱要具体到数。时间要具体到日子。

${f.tone}`;
}

const SCHEMA = `{"narrative":"这一段的叙事","summary":"一句话概括（25字内）",
"scene":{"location":"这段结束时主角人在哪","unresolved":["眼下真正悬着且主角打算管的事，至多4条"]},
"resolvedInfo":["本段了结或放下的事，原样照抄未了之事里的那句"],
"check":null或{"type":"判定名","attr":"属性","need":70,"success":true},
"playerChanges":{"attributes":{"专业":0,"表达":0,"谋划":0,"情绪":0,"体能":0},"energy":0,"money":0,"信誉":0,"人品":0,"idealProgress":0,"job":null,"salary":null,
  "statusAdd":[{"name":"毛病名(4字内)","desc":"一句话","days":几天好}],"statusRemove":["毛病名"],"chronicAdd":[{"name":"","desc":""}]},
"npcUpdates":[{"name":"","rel":0,"tie":null,"note":null,"mem":"这一段他跟主角之间具体发生了什么（谁做了什么、说了什么、钱物往来），30字内，他以后会记得","intimate":false}],
"newNpcs":[{"name":"","age":0,"job":"","intimate":false,"tie":"主角手机里给他存的称呼，一个词，像妈妈、房东、老板、表姐、室友、大学同学；不要写母子、雇主、熟人这种关系词","care":"他在意什么","note":"一句话的人","rel":20,"close":false}],
"messages":[{"from":"发消息的人：写【认识的人】里的名字，不要写妈妈、房东这种称呼","text":"手机上收到的一条消息，像真的微信"}],
"moments":[{"who":"发朋友圈的人（认识的人里的某个）","text":"他发的动态，二十字左右，是他自己的生活，不必跟主角有关"}],
"appointments":[{"title":"约好的事","inDays":3,"kind":"约"}],
"milestoneClaim":[],
"together":"这一段里主角跟谁明确确定了恋爱关系（说开了、答应了、在一起了）就写那人名字，没有就写空字符串",
"newRifts":[{"who":"跟主角结下梁子的人","reason":"为什么","kind":"债主|前东家|竞对|私怨|甲方","heat":20}],
"riftEased":["这一段里主角把梁子解开了的人名"],
"newJob":null或{"employer":"新东家名字","title":"岗位（干什么的，比如「编辑助理」「后厨」「客户经理」）","salary":月薪数字,"lv":0到5的职级,"probation":是否试用期},
"options":["四个下一步的行动，每条12字内，具体、可执行、互相不同"],
"nextStop":null,
"gameOver":false,"ending":null}`;

function memBlocks() {
  const recents = S.recent.slice(-4).map((r, i, a) => {
    const full = i >= a.length - 2;
    const t = full ? r.narrative : String(r.narrative || '').replace(/\s+/g, '').slice(0, 90) + '……';
    return `${r.action ? `【当时的行动】${r.action}\n` : ''}【${full ? '叙事' : '叙事·节略'}】${t}`;
  }).join('\n---\n') || '（还没开始）';
  const sums = S.history.slice(-12).map(h => `${h.date}｜${h.summary}`).join('\n') || '（无）';
  return { recents, sums };
}

function stateBlocks() {
  const p = S.player, L = S.ledger;
  const M = memBlocks();
  const npc = S.npcs.slice(-12).map(n =>
    `${n.name}（${n.age || '?'}岁，${n.job || '不详'}，${n.tie}，关系${relWord(n.rel, n.tie)}${n.care ? '，在意' + n.care : ''}）${(n.mem || []).slice(-4).join('；')}`).join('\n') || '（还没认识什么人）';
  const peers = S.peers.map(pr => `${pr.name}：${(pr.track || []).slice(-2).join('，') || pr.note || '还是老样子'}（${E.peerWord(S, pr)}）`).join('\n') || '（无）';
  E.fixPace(S);
  const PC = E.PACES[S.pace];
  const pf = S.paceFrom && S.stats.days - S.paceFrom.day <= 14 ? `（${S.stats.days - S.paceFrom.day <= 1 ? '刚' : S.stats.days - S.paceFrom.day + '天前'}从「${S.paceFrom.name}」换成这样，这一段要让人看出日子的过法变了）` : '';
  const plan = `「${S.pace}」：${PC.story}${pf}`;
  return `【今天】${E.dateStr(S.date)}
【人在哪】${S.place || '不详'}
【主角】${p.name}，${p.gender}，${p.age}岁，${S.city}。${E.bgLine(p) ? E.bgLine(p) + '。' : ''}眼下的营生：${p.job}
【理想】${p.ideal}（赛道：${p.track}，看家本事叫「${p.skillName}」）${(E.TRACKS[p.track] || {}).rule ? `\n【这条路的规矩】${E.TRACKS[p.track].rule}` : ''}
【志业阶梯】${E.ladderBlock(S)}
【属性】专业${p.attrs['专业']} 表达${p.attrs['表达']} 谋划${p.attrs['谋划']} 情绪${p.attrs['情绪']} 体能${p.attrs['体能']}｜精力${p.energy}
【饭碗】${S.job.out ? `没有工作（${S.job.was ? '从' + S.job.was + '出来了' : '被放走了'}），已经没有工资进账` : `${S.job.employer || '眼下这家'}${S.job.post ? '，干的是' + S.job.post : ''}，职级${E.LEVELS[E.num(S.job.lv)].t}${S.job.probation ? '（还在试用期）' : ''}，这个季度的绩效${Math.round(S.job.perf)}，下次考核还有${E.nextReview(S)}天`}
${(S.rifts || []).filter(r => !r.done).length ? `【结下的梁子】${S.rifts.filter(r => !r.done).map(r => `${r.who}（${r.kind}）：${r.reason}${r.heat >= 62 ? '，眼看压不住了' : r.heat >= 35 ? '，还没翻篇' : '，快淡了'}${r.came ? `，已经找过${r.came}回` : ''}`).join('；')}\n` : ''}${(S.debts || []).length ? `【欠的钱】${S.debts.map(d => `欠${d.who}${d.left}元（${d.due.m}月${d.due.d}日到期${d.late ? '，已经过期了' : ''}）`).join('；')}` : ''}
${S.biz && !S.biz.dead ? `【自己的摊子】${S.biz.name}（${S.biz.kind}，开了${S.biz.months}个月），上月进${S.biz.rev}出${S.biz.cost}${S.biz.net >= 0 ? '剩' + S.biz.net : '亏' + (-S.biz.net)}，口碑${Math.round(S.biz.rep)}，人手${S.biz.staff.length}个${S.biz.staff.length ? `（${S.biz.staff.map(x => x.name + '·' + x.role).join('、')}）` : ''}${S.biz.lossMonths ? `，已连亏${S.biz.lossMonths}个月` : ''}\n` : ''}【家】${(() => {
    const H = S.home || {}; const P = E.partnerOf(S); const kids = (S.family && S.family.kids || []).filter(k => !k.unborn);
    const a = [H.kind === '买' ? `有自己的房子（${H.loan && !H.loan.done ? `月供${H.loan.monthly}，还欠${H.loan.left}` : '贷款还清了'}）` : `还在租房，房租${S.ledger.rent}`];
    a.push(P ? `跟${P.name}${P.stage}${P.warm >= 60 ? '，还热乎' : P.warm >= 30 ? '，不咸不淡' : '，早淡了'}` : '一个人过');
    const lv = E.lovers(S);
    if (lv.length) a.push(`发生过关系的：${lv.map(n => `${n.name}（${P && P.name === n.name ? P.stage : callName(n) || '没名分'}，最近一次${n.intimate.last}）`).join('、')}`);
    if (kids.length) a.push(`孩子${kids.map(k => `${k.name}${k.age}岁`).join('、')}，每月养孩子${E.kidCost(S)}`);
    return a.join('；');
  })()}
【行业风向】${S.player.track}这行眼下${(S.wind && S.wind.mood) || '平'}${(S.era || []).length ? `；近来外面的事：${S.era.map(e => e.text).join('；')}` : ''}
【钱】存款${p.money}元，月薪${L.salary}${L.subsidy ? `，家里每月给${L.subsidy}` : ''}，房租${L.rent}，生活${L.living}${L.remit ? `，每月往家寄${L.remit}` : ''}${S.broke ? '。【已经透支，账上是负的】' : ''}
【名声】行业口碑${p.信誉}，做人${p.人品}
【身上的毛病】${S.status.map(s => `${s.name}（还有${s.days}天）`).join('、') || '没有'}${S.chronic.length ? `｜去不掉的：${S.chronic.map(c => c.name).join('、')}` : ''}
【这阵子的重心】${plan}
【认识的人】
${npc}
【同期的人在做什么】
${peers}
【未了的事】${S.unresolved.join('；') || '暂时没有'}
【往事提要】
${M.sums}
【最近发生的】
${M.recents}`;
}

const STOP_WRITE = {
  '约': d => `这一段收在赴约的当口：${d}。写到主角刚到、事情要开始，不要把结果写出来。`,
  '事': d => E.fdm(S).fiat
    ? `这一段结束在一件冒出来的事上，类别是【${d}】。这一局里这种事往好里写：机会、贵人、意外之财、有人主动找上门帮忙。写到这件好事刚砸到他头上为止。`
    : `这一段结束在一件突然冒出来的事上，类别是【${d}】。你来决定具体是什么事，要具体、可信、跟主角眼下的处境有关系。写到事情刚砸下来、主角还没来得及反应。`,
  '钱': d => `这一段结束在钱上：${d}。把数字写清楚，不要用"捉襟见肘"这类词糊过去。`,
  '运': d => `这一段结束在一件${d}的事上。大吉就给一桩真机缘（有人看见他、一笔意外的钱、一个够得着的门路），大凶就给一记实实在在的打击，都不要写成梦一场。`,
  '投入': d => `这一段是主角闷头做一件事：${d}。引擎已经给出了成败，照着写，不要另作判断。`,
  '人情': d => `这一段结束在别人的消息上：${d}。写主角是怎么知道的，以及他什么反应——不要替他升华，就写反应。`,
  '久': d => `这一段日子很太平。写出日子的质地（重复的通勤、便利店、群里没人说话），结尾给一点隐隐的不对劲或一个很小的苗头，别写成心灵鸡汤。`,
  '条件': d => `这一段结束在主角等的那件事上：${d}。`,
  '考核': d => `这一段结束在季度考核上：${d}。写清楚是谁跟他说的、在哪儿说的、原话大概什么样。结果不许改。`,
  '生意': d => `这一段结束在自己那摊生意上：${d}。写具体的经营场面——来了几个客人、谁催货、账上什么数、人手够不够，不要写心情。`,
  '风向': d => `这一段结束在行业风向变了这件事上：${d}。写他是从哪儿察觉的（群里、同行、客户、招聘网站），先别写他决定怎么办。`,
  '时代': d => `这一段里外面出了一件事：${d}。让它以很日常的方式撞到主角身上——一条推送、一个电话、饭桌上别人在聊。别写成新闻播报。`,
  '年终': d => `${d}`,
  '同期': d => `这一段结束在一个跟主角同期起步的人身上：${d}。
他是带着来意来的——合伙就说他缺什么、挖你就说他能给什么、借钱就说清数目和什么时候还、抢机会就让主角发现两个人报的是同一件事、有喜事就把请柬和日子说清楚。
写到他把来意摆上桌、主角还没答复为止。别替主角决定。同期之间那点不好明说的比较，藏在话里，别写成旁白。`,
  '裂痕': d => `这一段结束在一个跟主角有梁子的人身上：${d}。他可以是直接堵上门、打电话、找到单位去、或者把事捅到别人那儿——挑一个最难堪的方式。写到他把话撂下为止，别替主角解决。`,
  '找上门': d => `这一段结束在一个人身上：${d}。写他是怎么找来的（电话、微信、直接堵在楼下都行）、开口第一句说了什么，别把来意一次交代完。`
};

// 玩家行动里的括号：（……）或(...)，里面是对描写和推演的直接要求
function splitAct(act) {
  const asks = [];
  const doing = String(act || '').replace(/[（(]([^（）()]*)[）)]/g, (_, x) => { if (x.trim()) asks.push(x.trim()); return ' '; }).replace(/\s+/g, ' ').trim();
  return { doing: doing || String(act || ''), asks };
}
// 只在心想事成这一档生效
function fiatAsks() { return E.fdm(S).fiat && S.lastAction && S.actTyped ? splitAct(S.lastAction).asks : []; }
const ASK_RULE = asks => `【玩家在括号里提的要求·无条件照办·优先级最高】
${asks.map((a, i) => `${i + 1}. ${a}`).join('\n')}
这是玩家直接下给你的写作和推演指令，不是剧情里的人说的话：
- 要求写什么场面、什么细节，就写什么，写到他要的那个细度；要求推演出什么结果、什么后续，剧情就走到那一步。
- 不许省略、不许改写、不许打折、不许只写一句带过，也不许以"不合理""太快""不符合现实"为由不写。
- 跟下面的字数、结尾写法、对话条数、选项要求有冲突时，一律以这里为准；要求写得细就写长些，没提篇幅就照常。
- 括号里的话本身不要原样抄进叙事。
`;
const FIAT_RULE = act0 => { const sp = S.actTyped ? splitAct(act0) : { doing: act0, asks: [] }, act = sp.doing; return `${sp.asks.length ? ASK_RULE(sp.asks) + '\n' : ''}【本段铁律·压过下面所有条目】
玩家写的这件事——「${act}」——在这一段里**已经成了**。你要写的是它怎么成的，不是它成不成。
- 不许写成"试了试""差一点""看起来有戏""对方说再看看"，也不许推到下一段去办。
- 不许用"但是""可惜""然而""只是""不过"给它打折，段尾也不许埋一个把它推翻的钩子。
- 该配合的人就配合：他要见的人见得到，要的东西拿得到，开的口对方接得住，要的钱有人给。
- 除非是物理上不可能的事（人不会飞、死人不能复生），一律照办。就算荒唐，也要写得像真发生过。
- 办成之后再往前推一步：随之而来的好处、新认识的人、新冒出来的机会，一并写进去，别只写"成了"两个字。`; };

function judgeBlock(j) {
  let s = '';
  if (j.fiat) return FIAT_RULE(j.fiat) + '\n' + (j.fate >= 15 ? `- 天命骰：${j.fate}（${E.fateInfo(j.fate).label}）——在办成这件事之外，这几天还另有一点运气：${E.fateInfo(j.fate).desc}\n` : '') + (j.stuck >= 55 ? `- ⚑ 最近几段太像了（相似度${j.stuck}%），这一段照样要打破：${j.nudge}。\n` : '');
  if (j.fate) {
    const f = E.fateInfo(j.fate);
    s += `- 天命骰：${j.fate}（${f.label}）——${f.desc}\n`;
  }
  if (j.check) {
    const c = j.check;
    s += `- 属性判定：${c.attr}${c.val}，掷骰${c.roll}（修正${c.mod >= 0 ? '+' : ''}${c.mod}）＝${c.total}，难度${c.need}，判定【${c.success ? '成功' : '失败'}】${c.crit ? '（' + c.crit + '）' : ''}。必须如实体现。\n`;
  }
  if (j.focus) {
    const f = j.focus;
    if (f.heal) {
      s += `- 养病结算：歇了${f.days}天，判定【${f.success ? '养回来了' : '没养利索'}】。${f.healed && f.healed.length ? `好了的：${f.healed.join('、')}。` : ''}${f.eased ? `连${f.eased}都松了些。` : ''}写他这些天怎么过的（在家、在医院、回老家都行），别写成休假散文，钱和活都还在那儿等着。\n`;
    } else {
      s += `- 投入结算：${f.what}，闷头做了${f.days}天，积累${f.progress}，判定【${f.success ? '做成了' : '没做成'}】${f.crit ? '（' + f.crit + '）' : ''}。做成了就写出成果的具体样子，没做成就写卡在哪。\n`;
    }
  }
  if (j.stuck >= 55) s += `- ⚑ 引擎发现最近几段太像了（相似度${j.stuck}%），这一段必须打破：${j.nudge}。这是硬要求。\n`;
  if (!s) s += '- 本段没有预设判定。\n';
  return s;
}

function segPrompt(seg) {
  const { from, to, days, events, stop } = seg.adv;
  if (seg.quick) return quickPrompt(seg);
  const evText = events.length
    ? events.slice(-14).map(e => `[${e.t}] ${e.s}`).join('\n')
    : '（没什么值得记的）';
  const writer = (STOP_WRITE[stop.kind] || STOP_WRITE['事'])(stop.detail);
  const actBlock = S.lastAction
    ? `【主角自己安排的事】${S.lastAction}\n（这一段先把这件事的经过写出来——150 字上下，照玩家写的去办：他写了几件事就写几件，写了去哪、找谁、带什么、怎么说，一样不落，写过程而不是一句话交代结果——然后再往下走）`
    : '（这是开局之后的第一段）';
  return `${worldRules()}

${stateBlocks()}

${actBlock}

【本段引擎判定（不可更改）】
${judgeBlock(seg.judge)}${S.capNote ? `\n【上一段被引擎砍掉的】${S.capNote}。这一段别再往大里写，数值按引擎认的那个来。\n` : ''}${S.claimNote ? `\n【引擎驳回】${S.claimNote}。这一段不许把这一步写成办成了，可以写他差在哪。\n` : ''}

【本段时间】${E.shortDate(from)} 到 ${E.shortDate(to)}，一共${days}天
【这些天里发生的小事（引擎记下的，必须体现，但不必条条都写）】
${evText}

【这一段怎么收尾】${writer}

要求：
${E.fdm(S).fiat && S.lastAction ? `- **这一段的头等大事**：把玩家写的「${S.lastAction}」写成已经办成的事，写足、写具体、写出后续的好处。这一条压过下面所有要求。\n` : ''}- 叙事 ${fiatAsks().length ? '按括号里的要求来，没提篇幅就照常 300-500' : days >= 10 ? '400-600' : '250-420'} 字。${days >= 8 ? '这是一段被快进的日子，不许写成"第一天……第二天……"的流水账。挑这段时间里真正有分量的两三件事写，其余用一两句带过。' : ''}
- 必须接着上一段的结尾往下走：地点、在场的人、正在办的事都要接得上。
- 这一段比上一段一定要往前一步：地点、身边的人、主角知道的事、和谁的关系，四样里至少一样真的变了。
- ${cfg.person === 'ta' ? '通篇第三人称。' : '通篇用"你"称呼主角。'}**这一段里至少要有三处人物直接说话，用引号写原话**，不许把对话转述成"他说……"。
- 手机消息写进 messages，1-3 条，短。
- moments 写 0-2 条朋友圈：发的人得是【认识的人】里已有的某位，内容是他自己的日子（加班、吃饭、孩子、抱怨天气、转发一句什么），不必跟主角有关，也不许全是好事。其中至少一条要来自【认识的人】里已经有的某个人——可以是废话、可以是没头没尾、可以是跟这一段无关的日常（约饭、转发、抱怨、问一句在不在），像真人一样。
- 数值变化写进 playerChanges，全部是增减量。钱要具体。身体出问题写 statusAdd。
- 新出现的人写 newNpcs（最多2人）。**这一段里出场、被提到、或者跟主角有来往的每一个已有人物，都要在 npcUpdates 里写一条 mem**，写具体的事，以后他会凭这个记得主角干过什么。
- 这一段里主角跟谁发生了关系（双方都是成年人），就在那个人的 npcUpdates（新认识的写在 newNpcs）里写 intimate:true，没有就写 false。正文点到为止，不写露骨细节。
- 主角这一段要是得罪了谁、坑了谁、欠了谁没还，写进 newRifts；把梁子解开了（道歉认了、钱还了、事办了）写进 riftEased。别滥用，一段最多一条。
- options 给四条，具体到能直接做（"去找周野问问那家公司"好过"寻找机会"），互相不重样，其中至少一条跟理想有关、一条跟眼下这件事有关。
${S.job.out ? `- 主角眼下没有工作，房租和生活费照扣。这一段要让这件事有分量：要么写他去找活（投简历、托人、接零活），要么写钱怎么撑住。他真谈成一份工作时，写进 newJob（给出东家、职位、月薪），引擎据此记账。\n` : ''}${S.broke ? '- 主角账上已经是负数了。这一段不许风花雪月，钱的窟窿必须出现在剧情里。\n' : ''}- 志业阶梯上这一步，只有引擎能宣布迈过去。你觉得主角够格冲了，就把里程碑标题写进 milestoneClaim，由引擎裁定；不许在剧情里直接写成办成了。
- 除非主角死亡或玩家要求收尾，gameOver 必须是 false。

只输出一个合法 JSON，不要任何别的字。格式：
${SCHEMA}`;
}

// 就地办一件事：只写这一两天
function quickPrompt(seg) {
  const { from, to, events } = seg.adv;
  const ap = seg.adv.stop && seg.adv.stop.kind !== '就地' ? seg.adv.stop : null;
  return `${worldRules()}

${stateBlocks()}

【主角这就要做的事】${fiatAsks().length ? splitAct(S.lastAction).doing + '（括号里的要求见下面引擎判定一栏，必须照办）' : S.lastAction}

【本段引擎判定（不可更改）】
${judgeBlock(seg.judge)}${S.capNote ? `\n【上一段被引擎砍掉的】${S.capNote}。数值按引擎认的那个来。\n` : ''}
【这两天里引擎记下的】${events.length ? events.slice(-6).map(e => `[${e.t}] ${e.s}`).join('；') : '（没什么）'}
【时间】${E.shortDate(from)} 到 ${E.shortDate(to)}${ap ? `，中间撞上一件事：${ap.detail}` : ''}

要求：
${E.fdm(S).fiat ? `- **这一段的头等大事**：玩家写的「${S.lastAction}」已经成了，你只负责写它怎么成的，写足、写出后续的好处。这一条压过下面所有要求。\n` : ''}- **只写这一两天，就写他去做「${fiatAsks().length ? splitAct(S.lastAction).doing : S.lastAction}」这件事**。${fiatAsks().length ? '篇幅按括号里的要求来：要求写细就写长，没提篇幅就 300-500 字。' : '300-500 字。'}
- 照玩家写的原样去办，一个细节都不许丢：他写了几件事就写几件，写了去哪、找谁、带什么、怎么说、想达到什么，都要在剧情里落到实处。玩家没写的细节由你补足，但不许改他写的。
- 写过程，不写梗概：怎么去的、到了看见什么、跟人怎么一来一回谈的、中间哪里卡住了又怎么过去的，最后得到了什么。不许用"经过一番努力""几经周折"这类话把过程跳过去。
- 不许跳过时间，不许写成"接下来的几周""一个月后"，不许把后面的事提前写掉。
- 写具体：去了哪儿、见了谁、花了多少钱、最后手里多了什么少了什么。
- ${cfg.person === 'ta' ? '通篇第三人称。' : '通篇用"你"称呼主角。'}**只要碰上人，就得让他开口说话，用引号写原话**，这一段至少两处直接对白。没有人的时候可以不写对话，但别整段白描。
- 这件事当场是个什么结果就写什么结果，成了就成了，没成就没成，别拖到下次。
- ${ap ? `收尾接上撞见的那件事：${ap.detail}。` : fiatAsks().length ? '结尾照括号里的要求来；括号没提的话，停在事情办完的那一刻。' : '结尾停在事情办完的那一刻，不要展望，不要感慨，不要写天色。'}
- options 给四条，都得是**今天明天就能做的具体事**，别给需要几周的计划。

只输出一个合法 JSON：
${SCHEMA}`;
}

function bootPrompt(o) {
  return `${worldRules()}

现在开局。主角：${o.name}，${o.gender}，${S.player.age}岁，刚从学校出来，落在${o.city}。
背景：${E.bgLine(S.player)}。开场和以后的剧情都要对得上这个背景（学历、学校、专业决定他找到什么样的第一份活，性子决定他怎么说话办事）。
出身：${o.origin}——${E.ORIGINS[o.origin].desc}
城市：${E.CITIES[o.city].desc}
他想干成的事：${o.ideal}（赛道：${o.track}）${(E.TRACKS[o.track] || {}).rule ? `\n这条路的规矩：${E.TRACKS[o.track].rule}` : ''}
手头：存款${S.player.money}元，房租${S.ledger.rent}，一个月生活费${S.ledger.living}${S.ledger.remit ? `，每月还要往家寄${S.ledger.remit}` : ''}，找到的第一份活月薪${S.ledger.salary}。

请铸造开局，写 350-500 字的开场：${cfg.person === 'ta' ? '他' : '你'}住进了什么地方、第一份活是干什么的、7月1日这天在干什么。不要交代背景板，从一个具体的场面切进去。
开场里至少要有两处人说话（房东、同事、家里人、室友都行），用引号写原话。

另外给出：
- employer：他上班那家单位的名字（8字内，虚构，比如"明河设计""云榆文化"）
- title：他在那儿干的岗位（6字内，比如"剪辑助理""跟单""服务员"，别写成"实习"这种级别）
- place：他现在住的地方（比如"城西老小区的合租次卧"）
- npcs：3个他身边现在就有的人（室友/同事/家里人/老同学都行），要有名字、年龄、干什么的、跟他什么关系、在意什么
- peers：5个跟他同期毕业的人（名字 + 一句话现在在干嘛），这些人以后会自己往前走
- troubles：开局就压着他的3件具体麻烦（要具体到数和日子，比如"押一付三还差2000"）
- messages：2条他手机上现在就有的消息
- options：四条他今天可以做的事
- ladder：把他那句理想拆成三段、每段3个里程碑的阶梯。要求：
  · 第一段是三个月到一年内够得着的小事（写完一个东西、拿到第一笔钱、有人认你），越具体越好；第三段是他理想真正兑现的样子。
  · 每个里程碑给一个引擎能算的硬指标 metric，只能从这几个里选：money（存款，给元数）、专业、表达、谋划（属性值 0-100）、信誉（行业口碑 0-100）、人脉（真认他的人几个）、投入（在这件事上攒的功夫，第一段给 40-120，第二段 300-800，第三段 1500-4000）
  · need 给数字，第一段要低（新人刚出校门，属性都在 20 上下，存款四位数）
  · scene 从这几个里选一个：面试/提案/谈判/路演/答辩/演出/摊牌/调解/借钱/拉人入伙
  · gate 用一句话写这道门槛是什么场面（"把稿子塞到编辑手里""让老板同意你带这个项目"）

只输出一个合法 JSON：
{"narrative":"开场","summary":"一句话","employer":"","title":"","place":"","scene":{"location":"","unresolved":["3件麻烦，每条20字内"]},
"ladder":[{"name":"这一段叫什么","milestones":[{"title":"","desc":"","metric":"投入","need":60,"scene":"提案","gate":""}]}],
"npcs":[{"name":"","age":0,"job":"","tie":"主角手机里给他存的称呼：妈妈、房东、老板、表姐、室友这种，不要写母子、雇主","care":"","note":"","rel":30,"close":true}],
"peers":[{"name":"","note":""}],
"messages":[{"from":"","text":""}],
"options":["","","",""]}`;
}

/* ================= 渲染 ================= */
// 手机里怎么存他：妈妈、房东、老板、表姐——不写"母子""雇主"这种关系词
const CALL_FIX = { '母子': '妈妈', '母女': '妈妈', '母亲': '妈妈', '妈': '妈妈', '老妈': '妈妈', '父子': '爸爸', '父女': '爸爸', '父亲': '爸爸', '爸': '爸爸', '老爸': '爸爸',
  '雇主': '老板', '雇员': '员工', '同期': '同学', '认识的人': '', '熟人': '', '朋友关系': '朋友', '房东租客': '房东', '租客': '租客', '师徒': '师傅', '同事关系': '同事' };
function callName(n) {
  const tie = String((n && n.tie) || '').trim();
  if (tie in CALL_FIX) return CALL_FIX[tie];
  if (tie === '家里人' && n && /^(妈|爸)$/.test(n.name)) return n.name === '妈' ? '妈妈' : '爸爸';
  return tie.replace(/关系$/, '');
}
function isKin(tie) { return /家里人|妈|爸|父|母|爷|奶|外公|外婆|叔|伯|姨|舅|姑|表|堂|亲戚|哥哥|姐姐|弟弟|妹妹|^[哥姐弟妹]$|婶|侄|外甥/.test(tie || ''); }
function relWord(v, tie) {
  v = E.num(v);
  if (isKin(tie)) {
    if (v >= 70) return '亲';
    if (v >= 40) return '还好';
    if (v >= 18) return '有点远';
    return '不大来往';
  }
  if (v >= 80) return '交心';
  if (v >= 55) return '朋友';
  if (v >= 30) return '熟人';
  if (v >= 12) return '点头之交';
  if (v >= 0) return '生分了';
  return '闹掰了';
}
function sayHl(html) {
  // 引号里的话挑出来上色，中英文引号和方引号都认
  return html
    .replace(/&quot;([^&]{1,120}?)&quot;/g, '<q class="say">“$1”</q>')
    .replace(/[“]([^”]{1,120}?)[”]/g, '<q class="say">“$1”</q>')
    .replace(/「([^」]{1,120}?)」/g, '<q class="say">「$1」</q>');
}
function narrativeHtml(t) {
  return String(t || '').split(/\n+/).filter(x => x.trim()).map(p => `<p>${sayHl(esc(p.trim()))}</p>`).join('');
}
function beginChapter(head, sub, action, judge) {
  const div = document.createElement('div');
  div.className = 'chapter';
  let dice = '';
  if (judge && (judge.fate || judge.check || judge.focus)) {
    const bits = [];
    if (judge.check) bits.push(`<span class="die ${judge.check.success ? 'good' : 'bad'}">${esc(judge.check.attr)} ${judge.check.total}/${judge.check.need} ${judge.check.success ? '成' : '败'}</span>`);
    if (judge.focus) bits.push(`<span class="die ${judge.focus.success ? 'good' : 'bad'}">${judge.focus.heal ? '养了' : '投入'}${judge.focus.days}天 ${judge.focus.heal ? (judge.focus.success ? '缓过来了' : '没养利索') : (judge.focus.success ? '做成' : '没成')}</span>`);
    const f = judge.fate ? E.fateInfo(judge.fate) : null;
    dice = (f ? `<div class="fate ${f.cls}"><div class="fdie" data-v="${judge.fate}">${judge.fate}</div><div class="ftxt"><b>天命·${f.label}</b><span>${esc(f.short || f.desc)}${judge.fateFx ? `　<em>${esc(judge.fateFx)}</em>` : ''}</span></div></div>` : '')
      + (bits.length ? `<div class="dicebar">${bits.join('')}</div>` : '');
  }
  div.innerHTML = `<div class="chaphead"><span class="chapmark">${esc(head)}</span><span class="chaptime">${esc(sub)}</span></div>
    ${action ? `<div class="action-echo">${esc(action)}</div>` : ''}${dice}<div class="ntext"><p class="typing">……</p></div>`;
  const fd = div.querySelector('.fdie');
  if (fd && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const v = fd.dataset.v; let n = 0;
    fd.classList.add('rolling');
    const t = setInterval(() => {
      fd.textContent = 1 + Math.floor(Math.random() * 20);
      if (++n >= 12) { clearInterval(t); fd.textContent = v; fd.classList.remove('rolling'); fd.classList.add('landed'); }
    }, 55);
  }
  $('story').appendChild(div);
  curChapter = div;
  scrollDown();
  return div;
}
function updateChapterNarrative(t) {
  if (!curChapter) return;
  curChapter.querySelector('.ntext').innerHTML = narrativeHtml(t) || '<p class="typing">……</p>';
  scrollDown();
}
function scrollDown() { const s = $('story'); s.scrollTop = s.scrollHeight; }
async function finishChapter() {
  if (!curChapter) return;
  S.chapters.push(curChapter.outerHTML);
  S.chapters = S.chapters.slice(-40);
  if (S.runId) {
    try { await bookPut({ id: S.runId + '-' + S.seg, run: S.runId, seq: S.seg, html: curChapter.outerHTML }); } catch (_) { }
  }
  curChapter = null;
}

function rebuildTop() {
  if (!S) return;
  const p = S.player;
  $('topDate').textContent = E.dateStr(S.date);
  $('topMoney').textContent = (p.money < 0 ? '−' : '') + '¥' + Math.abs(p.money).toLocaleString('zh-CN');
  $('topMoney').className = 'kv' + (p.money < 0 ? ' bad' : '');
  $('enBar').style.width = p.energy + '%';
  $('enBar').className = 'bar-in' + (p.energy < 30 ? ' bad' : p.energy > 70 ? ' good' : '');
  $('enNum').textContent = p.energy;
  const bad = S.status.length ? `｜${S.status.map(s => s.name).join('、')}` : '';
  E.fixPace(S);
  $('topSub').textContent = [S.place, S.focus && S.focus.heal ? '养病' : S.pace].filter(Boolean).join('｜') + bad;
}

function renderOptions(opts) {
  const box = $('acts');
  box.innerHTML = '';
  if (S.over) {
    box.innerHTML = `<div class="ended">${esc(S.endTitle || '这一局')}　—　${esc(S.ending || '')}</div>`;
    const go = document.createElement('button');
    go.className = 'act-btn'; go.textContent = '日子还得过下去（再给十年）';
    go.onclick = () => { S.over = false; goOn(); };
    box.appendChild(go);
    const ex = document.createElement('div');
    ex.className = 'act-row2';
    ex.innerHTML = `<button class="ghost" onclick="exportBook()">把这一生导出来</button>`;
    box.appendChild(ex);
    return;
  }
  (opts || []).slice(0, 4).forEach(o => {
    const b = document.createElement('button');
    b.className = 'act-btn'; b.textContent = o;
    b.onclick = () => doAction(o);
    box.appendChild(b);
  });
  const row = document.createElement('div');
  row.className = 'act-row';
  const fiat = !!E.fdm(S).fiat;
  row.innerHTML = `<input id="freeAct" placeholder="${fiat ? '想做什么就写，括号里写要怎么写（写细一点）' : '或者自己写一件要做的事'}" maxlength="${fiat ? 300 : 120}"/><button class="act-go" id="goBtn">去做</button>`;
  box.appendChild(row);
  $('goBtn').onclick = () => {
    const v = $('freeAct').value.trim();
    if (!v) { toast('先写点什么'); return; }
    doAction(v, true);
  };
  $('freeAct').addEventListener('keydown', e => { if (e.key === 'Enter') $('goBtn').click(); });
  const sk = document.createElement('div');
  sk.className = 'act-row3';
  sk.innerHTML = `<button class="skip" id="focusBtn">闷头做一阵</button><button class="skip" id="skipBtn">往下过日子</button>`;
  box.appendChild(sk);
  $('skipBtn').onclick = skipAhead;
  $('focusBtn').onclick = openFocus;
}

/* ================= 一段推进 ================= */
async function doAction(action, typed) {
  if (busy || !S || S.over) return;
  S.lastAction = action;
  S.actTyped = !!typed;            // 只有玩家亲手写的，括号才算要求
  await runSegment({ quick: true });     // 自己动手做的事，就写这一两天
}
async function skipAhead() {
  if (busy || !S || S.over) return;
  S.lastAction = null; S.actTyped = false;
  await runSegment({ skip: true });      // 日子往下过，跑到有事为止
}

function makeJudge(action) {
  const rng = Math.random;
  const j = { fate: null, check: null, focus: null, stuck: 0, nudge: null };
  if (E.fdm(S).fiat && action) j.fiat = action;
  const st = E.stuckLevel(S);
  if (st >= 55) { j.stuck = st; j.nudge = E.pickNudge(rng); }
  return j;
}

async function runSegment(opt) {
  if (busy) return;
  opt = opt || {};
  const quick = !!opt.quick && !!S.lastAction;
  const rng = Math.random;
  const judge = makeJudge(S.lastAction);

  // 玩家这次行动先判一把（自由度高的一档基本都过）
  if (S.lastAction && S.freedom !== '心想事成' && Math.random() < 0.55) {
    const attr = guessAttr(S.lastAction);
    judge.check = E.rollCheck(S, attr, 52 + Math.round(S.player.age - 22) * 1.5, rng);
    S.stats.checks++; if (judge.check.success) S.stats.wins++;
  }

  // 投入中的事，跑之前先记一下
  const focusing = !!S.focus;
  const adv = E.advance(S, { rng, maxDays: quick ? 1 : 35, quiet: quick });
  if (focusing && adv.stop.kind === '投入') judge.focus = E.settleFocus(S, rng);
  if (adv.stop.kind === '运') judge.fate = adv.stop.fate;
  else judge.fate = E.d20(rng);
  const floor = E.num(E.fdm(S).fateFloor);
  if (floor) judge.fate = Math.max(floor, judge.fate);          // 言出法随这一档不走背字
  judge.fateFx = E.applyFate(S, judge.fate);

  S.seg++;
  S.stats.segs++;
  const head = adv.stop.kind === '年终' ? `${adv.to.y}年` : adv.days <= 1 ? E.shortDate(adv.to) : `${E.shortDate(adv.from)} — ${E.shortDate(adv.to)}`;
  setBusy(true, quick ? '正在记下这一天……' : adv.days >= 8 ? `${adv.days}天过去了，正在记下这段日子……` : '正在记下这几天……');
  beginChapter(head, adv.stop.kind === '年终' ? '年终' : quick ? '' : `${adv.days}天`, S.lastAction || '', adv.stop.kind === '年终' ? null : judge);
  renderOptions([]);
  S.pending = { action: S.lastAction, stop: adv.stop };
  saveGame();

  if (adv.stop.kind === '结局') {
    S.seg++;
    setBusy(false);
    await runEnding({ why: adv.stop.why, text: adv.stop.detail });
    return;
  }
  const isYear = adv.stop.kind === '年终';
  try {
    const prompt = isYear ? yearPrompt(E.yearDiff(S)) : segPrompt({ adv, judge, quick });
    const d = await llmJSON(prompt, raw => {
      const t = extractPartialField(raw, 'narrative');
      if (t) updateChapterNarrative(t);
    });
    updateChapterNarrative(d.narrative);
    if (isYear) {
      const snap = E.yearSnap(S);
      S.years = (S.years || []).concat([{ y: snap.y, snap, text: d.narrative, summary: d.summary || '' }]).slice(-12);
      S.history.push({ seg: S.seg, date: `${snap.y}年`, summary: `【年终】${d.summary || ''}` });
    }
    E.applyTurn(S, d);
    const claim = E.judgeClaim(S, d.milestoneClaim);
    if (claim && !claim.ok) S.claimNote = `你申报过「${claim.title}」，但${claim.short}，还不够格`;
    else S.claimNote = null;
    S.pending = null;
    S.lastAction = null; S.actTyped = false;
    S.lastOptions = (d.options && d.options.length) ? d.options : ['接着过日子', '找人聊聊', '琢磨一下理想那件事', '出去走走'];
    await finishChapter();
    rebuildTop();
    renderOptions(S.lastOptions);
    renderPanel();
    saveGame();
    if (S.over) { renderOptions([]); }
  } catch (e) {
    updateChapterNarrative('（这一段没写成：' + (e.message || e) + '）');
    renderOptions(S.lastOptions.length ? S.lastOptions : ['再试一次']);
    toast(e.message || '出错了');
  }
  setBusy(false);
}

function guessAttr(a) {
  a = String(a || '');
  if (/谈|说服|聊|讲|面试|汇报|推销|争|解释|道歉/.test(a)) return '表达';
  if (/查|想|算|计划|打听|研究|分析|找路子|比较/.test(a)) return '谋划';
  if (/跑|熬|扛|搬|加班|通宵|锻炼/.test(a)) return '体能';
  if (/忍|稳住|顶住|面对|撑/.test(a)) return '情绪';
  return '专业';
}

/* ================= 开局 ================= */
function renderStart() {
  const o = $('startBox');
  o.innerHTML = `
  <h2>开局</h2>
  <div class="frow"><label>名字</label><input id="sName" maxlength="6" placeholder="随你"/></div>
  <div class="frow"><label>性别</label><div class="segs" id="sGender">${seg(['男', '女'], '男')}</div></div>
  <div class="frow"><label>学历</label><div class="segs" id="sEdu">${seg(Object.keys(E.EDUS), '本科')}</div></div>
  <div class="frow"><label>学校</label><div class="segs" id="sSchool">${seg(Object.keys(E.SCHOOLS), '普通')}</div></div>
  <div class="frow"><label>专业</label><div class="segs wrap" id="sMajor">${seg(Object.keys(E.MAJORS), '文科')}</div></div>
  <div class="frow"><label>性格</label><div class="segs wrap" id="sPersona">${seg(Object.keys(E.PERSONAS), '稳重')}</div></div>
  <div class="frow"><label>长相</label><div class="segs" id="sLooks">${seg(Object.keys(E.LOOKS), '周正')}</div></div>
  <div class="hint" id="bgHint"></div>
  <div class="frow"><label>出身</label><div class="segs" id="sOrigin">${seg(Object.keys(E.ORIGINS), '普通家庭')}</div></div>
  <div class="hint" id="oHint">${E.ORIGINS['普通家庭'].desc}</div>
  <div class="frow"><label>城市</label><div class="segs" id="sCity">${seg(Object.keys(E.CITIES), '新一线')}</div></div>
  <div class="hint" id="cHint">${E.CITIES['新一线'].desc}</div>
  <div class="frow"><label>赛道</label><div class="segs wrap" id="sTrack">${seg(Object.keys(E.TRACKS), '创作')}</div></div>
  <div class="frow col"><label>你想干成的事</label><input id="sIdeal" maxlength="30" placeholder="${E.TRACKS['创作'].ph}"/></div>
  <div class="frow"><label>口径</label><div class="segs" id="sFree">${seg(Object.keys(E.FREEDOM), '都市传奇')}</div></div>
  <div class="hint" id="fHint">${esc(FREE_NOTE['都市传奇'])}</div>
  <div class="btns"><button class="ghost" onclick="openSettings()">接口设置</button><button class="primary" id="startGo">开始</button></div>`;
  bindSeg('sOrigin', v => $('oHint').textContent = E.ORIGINS[v].desc);
  bindSeg('sCity', v => $('cHint').textContent = E.CITIES[v].desc);
  bindSeg('sTrack', v => $('sIdeal').placeholder = E.TRACKS[v].ph);
  bindSeg('sGender');
  const bgUpd = () => {
    const o = { edu: segVal('sEdu'), school: segVal('sSchool'), major: segVal('sMajor'), persona: segVal('sPersona') };
    const f = E.bgEffect(o);
    const d = Math.round((f.pay - 1) * 100);
    const add = Object.entries(f.add).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`).join(' ');
    $('bgHint').textContent = `${f.age}岁出校门｜起薪${d ? (d > 0 ? '高' : '低') + Math.abs(d) + '%' : '照常'}${add ? '｜' + add : ''}。${E.PERSONAS[o.persona].desc}。`;
  };
  ['sEdu', 'sSchool', 'sMajor', 'sPersona', 'sLooks'].forEach(id => bindSeg(id, bgUpd));
  bgUpd();
  bindSeg('sFree', v => $('fHint').textContent = FREE_NOTE[v] || '');
  $('startGo').onclick = startNew;
}
function seg(arr, cur) { return arr.map(a => `<button class="seg${a === cur ? ' on' : ''}" data-v="${esc(a)}">${esc(a)}</button>`).join(''); }
function bindSeg(id, cb) {
  const box = $(id);
  box.querySelectorAll('.seg').forEach(b => b.onclick = () => {
    box.querySelectorAll('.seg').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    if (cb) cb(b.dataset.v);
  });
}
const segVal = id => { const b = $(id).querySelector('.seg.on'); return b ? b.dataset.v : null; };

async function startNew() {
  if (!cfg.key) { toast('先填接口密钥'); openSettings(); return; }
  const track = segVal('sTrack');
  const o = {
    name: $('sName').value.trim() || '林一',
    gender: segVal('sGender'), origin: segVal('sOrigin'), city: segVal('sCity'),
    edu: segVal('sEdu'), school: segVal('sSchool'), major: segVal('sMajor'), persona: segVal('sPersona'), looks: segVal('sLooks'),
    track, ideal: $('sIdeal').value.trim() || E.TRACKS[track].ph,
    freedom: segVal('sFree'),
    startYear: new Date().getFullYear(), rngSeed: Date.now(), payRoll: Math.random()
  };
  S = E.newState(o);
  try { await bookClear(S.runId); } catch (_) { }
  mask('startMask', false);
  $('story').innerHTML = '';
  rebuildTop();
  setBusy(true, '正在铸造开局……');
  beginChapter('开始', `${S.player.age}岁 · ${S.city}`, '', null);
  try {
    const d = await llmJSON(bootPrompt(o), raw => {
      const t = extractPartialField(raw, 'narrative');
      if (t) updateChapterNarrative(t);
    });
    updateChapterNarrative(d.narrative);
    if (d.employer) {
      S.job.employer = String(d.employer).slice(0, 10);
      S.job.post = String(d.title || '实习').slice(0, 8);
      S.job.title = E.LEVELS[0].t;
    }
    S.player.job = d.employer ? `${S.job.employer}的${S.job.post}` : (d.job || S.player.job);
    S.place = d.place || '';
    S.home = { kind: '租', since: E.shortDate(S.date), place: S.place };
    S.ideal.stages = E.normLadder(d.ladder);
    S.peers = (d.peers || []).slice(0, 6).map(p => ({ name: String(p.name || '').slice(0, 8), note: String(p.note || '').slice(0, 30), track: [] }));
    E.applyTurn(S, { newNpcs: d.npcs, npcMax: 4, messages: d.messages, scene: d.scene, summary: d.summary, narrative: d.narrative });
    S.booted = true;
    S.lastOptions = d.options && d.options.length ? d.options : ['出门转转', '给家里打个电话', '把手头的活干完', '想想理想那件事'];
    await finishChapter();
    rebuildTop();
    renderOptions(S.lastOptions);
    renderPanel();
    saveGame();
  } catch (e) {
    updateChapterNarrative('（开局没铸成：' + (e.message || e) + '）');
    toast(e.message || '出错了');
    mask('startMask', true);
  }
  setBusy(false);
}

/* ================= 面板 ================= */
let curTab = '';
function gotoTab(t) {
  if (curTab === t) { closePanel(); return; }
  curTab = t;
  if (t === 'book') acctMonth = null;
  $('panel').classList.add('on');
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  renderPanel();
}
function closePanel() { curTab = ''; $('panel').classList.remove('on'); document.querySelectorAll('.tab').forEach(x => x.classList.remove('on')); }

function renderPanel() {
  if (!S || !curTab) return;
  const box = $('panelBody');
  const p = S.player, L = S.ledger;
  if (curTab === 'phone') {
    const unread = S.msgs.filter(m => !m.read).length;
    const unmom = E.unreadMoments(S);
    const head = `<h3>手机</h3>
      <div class="segs phoneseg">
        <button class="seg${phoneTab === 'msg' ? ' on' : ''}" onclick="setPhoneTab('msg')">通讯录${unread ? `<i class="dot"></i>` : ''}</button>
        <button class="seg${phoneTab === 'mom' ? ' on' : ''}" onclick="setPhoneTab('mom')">朋友圈${unmom ? `<i class="dot"></i>` : ''}</button>
      </div>`;
    if (phoneTab === 'mom') { box.innerHTML = head + renderMoments(); return; }

    // 有消息的排前面，其余按最近来往排
    const threads = {};
    for (const m of S.msgs) {
      if (!threads[m.from]) threads[m.from] = { from: m.from, last: m, n: 0, unread: 0, at: 0 };
      const t = threads[m.from];
      t.last = m; t.n++; t.at = S.msgs.lastIndexOf(m);
      if (!m.read) t.unread++;
    }
    const rows = S.npcs.map(n => {
      const t = threads[n.name];
      if (t) delete threads[n.name];
      return { name: n.name, npc: n, last: t ? t.last : null, unread: t ? t.unread : 0, at: t ? t.at : -1 };
    }).concat(Object.values(threads).map(t => ({ name: t.from, npc: null, last: t.last, unread: t.unread, at: t.at })));
    rows.sort((a, b) => (b.at - a.at) || ((b.npc ? b.npc.rel : 0) - (a.npc ? a.npc.rel : 0)));

    box.innerHTML = head + `<div class="msgs">${rows.map(r => {
        const gap = r.npc ? S.stats.days - (r.npc.lastSeen || 0) : 0;
        const f = faceOf(r.name);
        return `<div class="thread" onclick="openThread('${esc(r.name)}')">
          <div class="face sm" style="--h:${f.hue}">${esc(f.ch)}</div>
          <div class="thbody">
            <div class="mfrom">${esc(r.name)}${(() => { const w = r.npc ? callName(r.npc) : ((S.peers || []).some(p => p.name === r.name) ? '同学' : ''); return w && !w.includes(r.name) && !r.name.includes(w) ? `<em>${esc(w)}</em>` : ''; })()}
              <span>${r.last ? esc(r.last.date) : ''}${r.unread ? ' <i class="dot"></i>' : ''}</span></div>
            <div class="mtext one">${r.last ? (r.last.me ? '我：' : '') + esc(r.last.text) : (r.npc && r.npc.note ? esc(r.npc.note) : '还没说过话')}</div>
            ${r.npc && gap >= 20 ? `<div class="tip"><u>${gap}天没联系了</u></div>` : ''}
          </div></div>`;
      }).join('') || '<div class="card tip">通讯录还是空的</div>'}</div>
      <div class="tip">点开谁都能直接说话。有人给你发消息时这儿会有红点。</div>`;
  } else if (curTab === 'ideal') {
    box.innerHTML = renderLadder();
  } else if (curTab === 'home') {
    box.innerHTML = renderHome();
  } else if (curTab === 'book') {
    const loan = E.num(L.loan), kid = E.kidCost(S);
    const bizNet = S.biz && !S.biz.dead ? E.num(S.biz.net) : 0;
    const inc = L.salary + L.subsidy, out = L.rent + loan + L.living + kid + L.remit;
    const net = (S.job.out ? L.subsidy : inc) - out + bizNet;
    const row = (lab, v, sign) => `<div><b>${lab}</b><span class="${sign < 0 ? 'bad' : ''}">${sign < 0 ? '−' : ''}${Math.abs(v).toLocaleString('zh-CN')}</span></div>`;
    box.innerHTML = `<h3>账本</h3>
    <div class="card"><div class="big${p.money < 0 ? ' bad' : ''}">¥${p.money.toLocaleString('zh-CN')}</div><div class="tip">存款</div></div>
    <h4>每个月固定的</h4>
    <div class="card"><div class="lines">
      ${S.job.out ? '<div><b>工资</b><span class="tip">没有工作</span></div>' : row(`工资（${L.salaryDay}号）`, L.salary, 1)}
      ${L.subsidy ? row('家里给的', L.subsidy, 1) : ''}
      ${bizNet ? row(`${esc(S.biz.name)}（上个月净）`, bizNet, bizNet < 0 ? -1 : 1) : ''}
      ${L.rent ? row(`房租（${L.rentDay}号）`, L.rent, -1) : ''}
      ${loan ? row(`房贷月供（${L.rentDay}号）`, loan, -1) : ''}
      ${row('吃穿用度', L.living, -1)}
      ${kid ? row('养孩子', kid, -1) : ''}
      ${L.remit ? row('寄回家', L.remit, -1) : ''}
      <div class="sum"><b>一个月剩</b><span class="${net < 0 ? 'bad' : 'good'}">${net < 0 ? '−' : ''}${Math.abs(net).toLocaleString('zh-CN')}</span></div>
    </div>
    <div class="tip" style="margin-top:6px">${S.broke ? '账上已经是负的了，做什么都差一口气。'
      : net >= 0 ? `照这样过，一个月能剩 ${net}${bizNet ? '（生意按上个月算）' : ''}。剧情里额外的进出不算在内，看下面的明细。`
      : `每个月倒贴 ${-net}，手上的钱还能撑 ${Math.max(0, Math.floor(p.money / -net))} 个月。`}</div></div>
    <h4>明细</h4>
    <div class="card">${renderAcct()}</div>
    ${renderBiz()}
    <h4>欠的钱</h4>
    <div class="card">${(S.debts || []).length
      ? S.debts.map((d, i) => `<div class="li"><b>${esc(d.who)}</b> <span class="rel${d.late ? ' bad' : ''}">${d.left}元${d.late ? '·过期了' : ''}</span>
          <div class="tip lirow"><span>${d.due.m}月${d.due.d}日之前要还</span><span class="liact"><button class="ghost sm" onclick="doPay(${i})">还一笔</button></span></div></div>`).join('')
      : '<div class="tip">没欠谁的</div>'}
      <div class="btns"><button class="ghost" onclick="openBorrow()">找人借钱</button></div></div>`;
  } else if (curTab === 'me') {
    box.innerHTML = `<h3>我</h3>
    <div class="card"><div class="big">${esc(p.name)}</div><div class="tip">${p.gender}｜${p.age}岁｜${esc(S.city)}｜${esc(p.job)}</div>${p.bg ? `<div class="tip">${esc([p.bg.school + (p.bg.school === '名校' || p.bg.school === '重点' ? '' : '学校'), p.bg.major, p.bg.edu, p.bg.persona, p.bg.looks ? '长相' + p.bg.looks : ''].filter(Boolean).join('｜'))}</div>` : ''}</div>
    <div class="card"><div class="lines">${E.ATTRS.map(a => `<div><b>${a}${a === '专业' ? `（${esc(p.skillName)}）` : ''}</b><span>${p.attrs[a]}</span></div>`).join('')}
      <div><b>精力</b><span>${p.energy}${E.energyCap(S) < 100 ? ` / 上限${E.energyCap(S)}` : ''}</span></div>
      <div><b>行业口碑</b><span>${p.信誉}</span></div>
      <div><b>做人</b><span>${p.人品}</span></div>
      <div><b>干了多久</b><span>${workedText(p.资历天 || 0)}</span></div>
    </div></div>
    <h4>事业</h4>
    <div class="card">${S.job.out
      ? `<div class="big bad">没有工作</div><div class="tip">${S.job.was ? `从${esc(S.job.was)}出来之后` : ''}没有工资进账，房租和生活费照扣。</div>
         <div class="btns"><button class="ghost" onclick="askJob()">去面一场</button></div>`
      : `<div class="lines">
          <div><b>单位</b><span>${esc(S.job.employer || S.player.job || '—')}</span></div>
          <div><b>岗位</b><span>${esc(S.job.post || '没名目')}</span></div>
          <div><b>职级</b><span>${E.LEVELS[E.num(S.job.lv)].t}${S.job.probation ? '（试用期）' : ''}</span></div>
          <div><b>月薪</b><span>${L.salary}</span></div>
          <div><b>下次考核</b><span>${E.nextReview(S)}天后</span></div>
        </div>
        <div class="cardhd" style="margin-top:10px">这个季度的绩效</div>
        <div class="bar"><div class="bar-in${S.job.perf > 45 ? ' good' : S.job.perf < 15 ? ' bad' : ''}" style="width:${Math.min(100, Math.round(S.job.perf / 70 * 100))}%"></div></div>
        <div class="tip">${Math.round(S.job.perf)}　上班就在攒；重心放在「拼工作」攒得最快，代价是精力。${S.job.mood < 0 ? '　上次被约谈过，这个季度要难一些。' : ''}</div>
        <div class="btns"><button class="ghost" onclick="askRaise()">谈加薪</button><button class="ghost" onclick="doQuit()">辞职</button></div>`}
    </div>
    ${S.lastReview ? `<div class="card tip">上次考核：${esc(S.lastReview.kind)}——${esc(S.lastReview.text)}</div>` : ''}
    <h4>这阵子的重心</h4>
    <div class="card">${paceCard()}</div>
    <h4>身上的毛病</h4><div class="card">${S.status.length ? S.status.map(s => `<div class="li"><b>${esc(s.name)}</b><span class="rel">还有${s.days}天</span><div class="tip">${esc(s.desc)}</div></div>`).join('') : '<div class="tip">没有</div>'}
      ${S.chronic.length ? S.chronic.map(c => `<div class="li"><b>${esc(c.name)}</b><span class="rel${E.num(c.eased) ? '' : ' bad'}">${E.num(c.eased) ? '养得松了些' : '去不掉'}</span><div class="tip">${esc(c.desc)}｜压着精力上限，也压着判定</div></div>`).join('') : ''}</div>
    <h4>梁子</h4>
    <div class="card">${(S.rifts || []).filter(r => !r.done).length
      ? S.rifts.filter(r => !r.done).map(r => `<div class="li"><b>${esc(r.who)}</b>
          <span class="rel${r.heat >= 62 ? ' bad' : ''}">${r.heat >= 62 ? '快压不住了' : r.heat >= 35 ? '还没翻篇' : '快淡了'}</span>
          <div class="tip">${esc(r.kind)}｜${esc(r.reason)}｜从${esc(r.since)}起${r.came ? `｜找过你${r.came}回` : ''}</div></div>`).join('')
      : '<div class="tip">眼下没跟谁结梁子</div>'}
      <div class="tip">钱还上、话说开、事办了，梁子自己会凉；不管它就一天天热起来，热到头人家就找上门了。</div></div>
    ${(S.years || []).length ? `<h4>这些年</h4><div class="card">${S.years.slice().reverse().map(y => `<div class="li"><b>${y.y}年</b><span class="rel">${esc(y.summary)}</span>
      <div class="tip">存款${y.snap.money}｜台阶${y.snap.miles}级｜交心的人${y.snap.close}个${y.snap.biz ? `｜${esc(y.snap.biz.name)}` : ''}</div></div>`).join('')}</div>` : ''}
    <h4>这一路</h4><div class="card">${S.history.slice(-14).reverse().map(h => `<div class="li"><span>${esc(h.date)}</span> ${esc(h.summary)}</div>`).join('') || '<div class="tip">还没开始</div>'}</div>
    <div class="btns"><button class="ghost" onclick="exportBook()">导出全本</button><button class="ghost" onclick="openSettings()">设置</button></div>`;

  }
}
function workedText(d) {
  if (d < 60) return d + '天';
  if (d < 365) return Math.floor(d / 30) + '个月';
  return Math.floor(d / 365) + '年' + Math.floor((d % 365) / 30) + '个月';
}
let acctMonth = null;
function renderAcct() {
  const A = S.acct || {};
  const ks = Object.keys(A).sort();
  const cur = E.acctKey(S.date);
  if (!ks.length) return '<div class="tip">从这个月起开始记账，下一笔进出就会出现在这儿。</div>';
  if (!acctMonth || !A[acctMonth]) acctMonth = ks[ks.length - 1];
  const i = ks.indexOf(acctMonth), M = A[acctMonth];
  const isCur = acctMonth === cur || i === ks.length - 1 && acctMonth > cur;
  const close = i < ks.length - 1 ? A[ks[i + 1]].open : S.player.money;
  const rows = M.rows.slice();
  const sum = rows.reduce((a, r) => a + r.amt, 0);
  const odd = Math.round(close - M.open - sum);
  const fmt = v => (v < 0 ? '−' : '+') + Math.abs(v).toLocaleString('zh-CN');
  const [y, m] = acctMonth.split('-').map(Number);
  const tabs = ks.slice(-6).map(k => { const [yy, mo] = k.split('-').map(Number); const mm = yy === S.date.y ? mo : `${yy % 100}年${mo}`; return `<button class="seg${k === acctMonth ? ' on' : ''}" onclick="acctMonth='${k}';renderPanel()">${mm}月</button>`; }).join('');
  const inSum = rows.filter(r => r.amt > 0).reduce((a, r) => a + r.amt, 0) + Math.max(0, odd);
  const outSum = rows.filter(r => r.amt < 0).reduce((a, r) => a + r.amt, 0) + Math.min(0, odd);
  return `<div class="segs wrap acctTabs">${tabs}</div>
    <div class="acct">
      <div class="acctrow open"><span></span><span>${m}月初存款</span><span>${M.open.toLocaleString('zh-CN')}</span></div>
      ${rows.map(r => `<div class="acctrow"><span>${r.d}日</span><span>${esc(r.item)}${r.note ? `<i>${esc(r.note)}</i>` : ''}</span><span class="${r.amt < 0 ? 'bad' : 'good'}">${fmt(r.amt)}</span></div>`).join('')}
      ${odd ? `<div class="acctrow"><span></span><span>零碎<i>没单独记的小进出</i></span><span class="${odd < 0 ? 'bad' : 'good'}">${fmt(odd)}</span></div>` : ''}
    </div>
    <div class="lines acctsum">
      <div><b>这个月进</b><span class="good">+${inSum.toLocaleString('zh-CN')}</span></div>
      <div><b>这个月出</b><span class="bad">−${Math.abs(outSum).toLocaleString('zh-CN')}</span></div>
      <div class="sum"><b>${isCur ? '到今天' : `${m}月底`}存款</b><span class="${close < 0 ? 'bad' : ''}">${close.toLocaleString('zh-CN')}</span></div>
    </div>`;
}
function paceCard() {
  E.fixPace(S);
  const P = E.PACES[S.pace];
  return `<div class="segs wrap paces">${Object.keys(E.PACES).map(k => `<button class="seg${k === S.pace ? ' on' : ''}" onclick="pickPace('${k}')">${k}</button>`).join('')}</div>
    <div class="pacedesc"><b>${esc(P.say)}</b><div class="tip">${esc(P.gain)}</div></div>
    ${S.focus && S.focus.heal ? '<div class="tip">养病这几天不算，歇完照这个过。</div>' : ''}`;
}
function pickPace(k) {
  if (!S || k === S.pace) return;
  E.setPace(S, k);
  S.history.push({ seg: S.seg, date: E.shortDate(S.date), summary: `这阵子改成${k}` });
  saveGame(); rebuildTop(); renderPanel();
  toast(`从明天起照「${k}」过`);
}



/* ================= 理想阶梯 ================= */
function renderLadder() {
  const c = E.curMile(S);
  const box = [];
  box.push(`<h3>理想</h3>
    <div class="card"><div class="big">${esc(S.player.ideal)}</div>
      <div class="tip">${esc(S.player.track)}｜${esc(S.player.skillName)} ${S.player.attrs['专业']}｜在这件事上攒的功夫 ${Math.round(S.ideal.progress)}</div></div>`);
  if (!S.ideal.stages.length) { box.push('<div class="card tip">这一局没立下阶梯（老存档），下一局开局时会生成。</div>'); return box.join(''); }

  S.ideal.stages.forEach((st, i) => {
    box.push(`<h4>第${i + 1}段　${esc(st.name)}</h4><div class="card">`);
    st.milestones.forEach((m, j) => {
      const cur = c && c.m.id === m.id;
      const stt = E.mileStat(S, m);
      box.push(`<div class="mile${m.done ? ' done' : cur ? ' cur' : ''}">
        <div class="mtitle">${m.done ? '✓ ' : ''}${esc(m.title)}${m.done && m.doneDate ? `<span>${esc(m.doneDate)}</span>` : ''}</div>
        ${m.desc && !m.done ? `<div class="tip">${esc(m.desc)}</div>` : ''}
        ${!m.done && cur ? `
          <div class="bar" style="margin-top:8px"><div class="bar-in${stt.ok ? ' good' : ''}" style="width:${stt.pct}%"></div></div>
          <div class="tip">${esc(stt.label)} ${stt.cur}${stt.unit} / ${stt.need}${stt.unit}${stt.ok ? '　够了' : `　还差 ${stt.need - stt.cur}${stt.unit}`}</div>
          <div class="tip">门槛：${esc(m.gate || m.scene)}（得打一场${esc(m.scene)}）</div>
          ${stt.ok ? `<button class="primary sm" style="margin-top:9px" onclick="askKey(${m.id})">去谈这一场</button>`
                   : '<div class="tip dim">硬指标没到，谈也没人听</div>'}` : ''}
      </div>`);
    });
    box.push('</div>');
  });
  box.push(`<h4>未了的事</h4><div class="card">${S.unresolved.map(u => `<div class="li">${esc(u)}</div>`).join('') || '<div class="tip">暂时没有</div>'}</div>`);
  const ap = (S.appts || []).filter(a => !a.done);
  box.push(`<h4>约好的事</h4><div class="card">${ap.length
    ? ap.map(a => `<div class="li"><span>${a.m}月${a.d}日</span> ${esc(a.title)}<span class="rel">${Math.max(0, E.daysBetween(S.date, { y: a.y, m: a.m, d: a.d }))}天后</span></div>`).join('')
    : '<div class="tip">没有</div>'}</div>`);
  if (S.stats.keys) box.push(`<div class="card tip">关键局打过 ${S.stats.keys} 场，谈成 ${S.stats.keyWins || 0} 场。</div>`);
  return box.join('');
}

/* ================= 关键局 ================= */
function keyHard(mileId) {
  let si = 0, mi = 0;
  S.ideal.stages.forEach((st, i) => st.milestones.forEach((m, j) => { if (m.id === mileId) { si = i; mi = j; } }));
  return Math.min(88, 26 + si * 20 + mi * 5);
}
function keyOpenPrompt(m, hard) {
  return `${worldRules()}

${stateBlocks()}

主角要去打一场【${m.scene}】：${m.gate || m.title}。${m.kind === 'raise'
    ? '这是去跟自己的老板谈钱。对手就是他的直属上级或者老板本人，要跟前面剧情里出现过的人对得上（如果出现过）。'
    : m.kind === 'love'
    ? `这是主角要跟${m.who}把话挑明。对手就是${m.who}本人，按【认识的人】里那一条写他，别换人。`
    : m.kind === 'marry'
    ? `这是主角要跟${m.who}谈结婚。对手是${m.who}（也可能连带她/他家里人的态度），按【认识的人】里那一条写。`
    : m.kind === 'job'
    ? `这是一场面试，主角眼下没有工作${S.job.was ? `（刚从${S.job.was}出来）` : ''}。对手是招人的那一方，给出公司叫什么、什么岗位、多少钱一个月（要跟他的资历和这座城市对得上）。`
    : `这关系到他理想路上的这一步：${m.title}${m.desc ? `（${m.desc}）` : ''}。`}

给出这场的对手和开场。要求：
- 对手是个具体的人，有名字、职位、一句让人能摸出他脾气的描述。不要写他属于哪一类，让玩家自己看出来。${m.who ? `本场对手的名字必须是「${m.who}」，不许换人。` : ''}
- type 从这五个里选一个最贴的：务实（只认硬东西）/好面子（爱听好听的）/老江湖（什么场面都见过）/和稀泥（不表态能拖就拖）/急性子（没耐心）
- 开场 180-260 字：主角怎么到的这儿、屋里什么样、对方开口第一句。写到要开谈为止，不要写谈的过程和结果。

只输出一个合法 JSON：
{"opp":{"name":"","job":"","note":"一句话的人，别点破他是哪一类","type":"务实|好面子|老江湖|和稀泥|急性子"},"where":"在哪儿谈","opening":"开场"}`;
}
function keyEndPrompt(res, meta) {
  const K = meta.log.map(l =>
    `第${l.round}回合：主角【${l.move}】${l.pw >= 0 ? '压住了' : '没压住'}（${l.pw >= 0 ? '+' : ''}${l.pw}）${l.note ? '，' + l.note : ''}；对方${{ '推': '把话推回来', '追问': '追着问细节', '看表': '看了眼表', '压价': '往下压条件' }[l.oppMove]}。此刻：对方戒心${l.st.guard}、兴趣${l.st.interest}、耐心${l.st.patience}，主角底气${l.st.nerve}`).join('\n');
  return `${worldRules()}

${stateBlocks()}

主角刚打完一场【${meta.scene}】，对手是${meta.opp.name}（${meta.opp.job || ''}，${meta.opp.note}）。为的是：${meta.stake || '一件要紧事'}。

【这场是怎么打下来的（引擎记录，必须照着写）】
${K}

【最终结果（不可更改）】${res.result}${meta.why ? `——${meta.why}` : ''}${res.mile ? `。这一步「${res.mile}」就算迈过去了` : ''}${res.price.length ? `。代价：${res.price.join('、')}` : ''}

写这一场，500-700 字：
- 以对话为主。八个回合不必逐个写，挑三四个真正有转折的写，其余带过。
- 对方的每一次反应要对得上引擎记录：戒心降了就是他松口了，兴趣涨了就是他开始往下问，耐心掉了就是他开始不耐烦。
- 结尾写到结果落地：谈成写成怎么定下来的，留口子写成话没说死、下次再约，谈崩写成怎么收的场。不许翻案，不许找补，不许煽情。
- ${res.result === '谈成' ? '谈成之后不要写主角感慨万千，写他走出门第一件具体的事。' : '没谈成不要写他发誓要怎样，写他当下做了什么。'}
${meta.kind === 'job' && res.result === '谈成' ? '- 这场是面试而且谈成了：必须把 newJob 填上（东家、职位、月薪、是否试用期），月薪要跟剧情里说的对得上。\n' : ''}${meta.kind === 'love' ? (res.result === '谈成' ? '- 话挑明了，对方也接了：写两个人怎么把这层窗户纸捅破的，别写成偶像剧，写具体的地点和那几句话。\n' : '- 没接住：写清楚是拒绝、是躲开了、还是说再看看，之后两个人怎么把场面收掉。\n') : ''}${meta.kind === 'marry' ? (res.result === '谈成' ? '- 婚事定下来了：写谁先开的口、钱怎么算、家里人什么态度。\n' : '- 婚事没谈成：写卡在哪儿——钱、房、家里、还是对方本来就没想好。\n') : ''}${meta.kind === 'job' && res.result !== '谈成' ? '- 这场面试没成，不要安慰他，写他怎么走出那栋楼。\n' : ''}

只输出一个合法 JSON：
${SCHEMA}`;
}

async function askKey(mileId) {
  let m = null;
  for (const st of S.ideal.stages) for (const x of st.milestones) if (x.id === mileId) m = x;
  if (!m) return;
  runKey({ scene: m.scene, gate: m.gate, title: m.title, desc: m.desc, kind: 'mile', mileId, hard: keyHard(mileId) });
}
function askJob() {
  runKey({ scene: '面试', gate: '一场面试', title: '找个新饭碗', kind: 'job', mileId: null, hard: 28 + E.num(S.job.lv) * 8 });
}
function askRaise() {
  if (S.job.out) { toast('眼下没有工作'); return; }
  const lv = E.num(S.job.lv);
  runKey({ scene: '谈判', gate: '跟老板谈加薪', title: '加薪', kind: 'raise', mileId: null, hard: 40 + lv * 8 });
}
async function runKey(m) {
  if (busy) return;
  if (S.convo) endConvo(false);      // 从聊天里点进来的，先把聊天收掉
  closePanel();
  const hard = m.hard;
  setBusy(true, '正在赶去的路上……');
  beginChapter(E.shortDate(S.date), m.scene, `去谈：${m.gate || m.title}`, null);
  try {
    const d = await llmJSON(keyOpenPrompt(m, hard), raw => {
      const t = extractPartialField(raw, 'opening');
      if (t) updateChapterNarrative(t);
    });
    updateChapterNarrative(d.opening);
    S.seg++;
    await finishChapter();
    const o = d.opp || {};
    E.startKey(S, { scene: m.scene, name: o.name, type: o.type, note: o.note, hard, mileId: m.mileId, kind: m.kind, who: m.who, stake: m.gate || m.title });
    S.key.opp.job = String(o.job || '').slice(0, 16);
    S.key.where = String(d.where || '').slice(0, 20);
    saveGame();
    openKey();
  } catch (e) {
    updateChapterNarrative('（没去成：' + (e.message || e) + '）');
    toast(e.message || '出错了');
  }
  setBusy(false);
}

function openKey() {
  $('key').classList.add('on');
  renderKey();
}
function bandColor(v) { return v >= 66 ? 'good' : v >= 33 ? '' : 'bad'; }
function renderKey() {
  const K = S.key;
  if (!K) { $('key').classList.remove('on'); return; }
  $('keyTitle').textContent = `${K.scene}　${K.opp.name}`;
  $('keySub').textContent = `${K.opp.job ? K.opp.job + '　' : ''}${K.opp.note}`;
  $('keyBars').innerHTML = [
    ['对方耐心', K.patience, bandColor(K.patience)],
    ['对方戒心', K.guard, K.guard >= 60 ? 'bad' : K.guard >= 35 ? '' : 'good'],
    ['对方兴趣', K.interest, bandColor(K.interest)],
    ['你的底气', K.nerve, bandColor(K.nerve)]
  ].map(([lab, v, c]) => `<div class="kbar"><span>${lab}</span><div class="bar"><div class="bar-in ${c}" style="width:${Math.round(v)}%"></div></div><em>${Math.round(v)}</em></div>`).join('');

  $('keyLog').innerHTML = K.log.map(l => {
    const opp = { '推': '把话推了回来', '追问': '追着问细节', '看表': '看了一眼表', '压价': '往下压条件' }[l.oppMove];
    return `<div class="krd"><b>${l.round}　${l.move}</b>
      <span class="${l.pw >= 0 ? 'good' : 'bad'}">${l.pw >= 0 ? '压住 +' : '没压住 '}${l.pw}</span>
      ${l.note ? `<i>${esc(l.note)}</i>` : ''}<div class="tip">对方${opp}。戒心${l.st.guard}　兴趣${l.st.interest}　耐心${l.st.patience}　底气${l.st.nerve}</div></div>`;
  }).join('') || `<div class="tip">${esc(K.where || '')}　八个回合之内定输赢。同一招使第二遍就不灵了。</div>`;
  $('keyLog').scrollTop = $('keyLog').scrollHeight;

  $('keyMoves').innerHTML = Object.keys(E.MOVES).map(k => {
    const mv = E.MOVES[k];
    const dead = (k === '亮底牌' && K.usedCard);
    const seen = (K.used || {})[k] || 0;
    return `<button class="kmove${dead ? ' dead' : ''}" data-m="${k}"${dead ? ' disabled' : ''}>
      <b>${k}</b><i>${mv.tip}</i><u>${mv.attr}${S.player.attrs[mv.attr]}${seen ? `　用过${seen}次` : ''}</u></button>`;
  }).join('');
  $('keyMoves').querySelectorAll('.kmove').forEach(b => b.onclick = () => keyGo(b.dataset.m));
  $('keyMoves').style.display = K.over ? 'none' : '';
  $('keyEnd').style.display = K.over ? '' : 'none';
  if (K.over) $('keyEnd').textContent = `${K.result}　—　看看这一场怎么写`;
}
function keyGo(move) {
  const r = E.keyRound(S, move, Math.random);
  if (r && r.bad) { toast(r.bad); return; }
  renderKey();
  saveGame();
}
async function keyFinish() {
  const K = S.key;
  if (!K || !K.over) return;
  const meta = { scene: K.scene, opp: K.opp, stake: K.stake, kind: K.kind, log: K.log.slice(), why: K.why || '' };
  const res = E.settleKey(S);
  $('key').classList.remove('on');
  setBusy(true, '正在记下这一场……');
  S.seg++;
  beginChapter(E.shortDate(S.date), `${meta.scene}·${res.result}`, `跟${meta.opp.name}谈${meta.stake ? '「' + meta.stake + '」' : ''}`,
    { check: { attr: '这一场', val: meta.log.length + '回合', roll: '', mod: 0, total: res.result, need: '', success: res.result === '谈成' } });
  try {
    const d = await llmJSON(keyEndPrompt(res, meta), raw => {
      const t = extractPartialField(raw, 'narrative');
      if (t) updateChapterNarrative(t);
    });
    updateChapterNarrative(d.narrative);
    E.applyTurn(S, d);
    S.date = E.addDays(S.date, 1);
    S.lastAction = null; S.actTyped = false;
    S.lastOptions = d.options && d.options.length ? d.options : ['缓一缓', '接着往下做'];
    await finishChapter();
    rebuildTop();
    renderOptions(S.lastOptions);
    saveGame();
    if (res.mile) toast(`迈过去了：${res.mile}`);
    if (res.raise) toast(`月薪涨了${res.raise}`);
    if (res.love) toast(`跟${res.love}在一起了`);
    if (res.married) toast(`跟${res.married}成家了，花了${res.cost}`);
  } catch (e) {
    updateChapterNarrative('（这场没写成：' + (e.message || e) + '）');
    renderOptions(S.lastOptions.length ? S.lastOptions : ['缓一缓']);
  }
  setBusy(false);
}

/* ================= 人与聊天 ================= */
function showNpc(name) {
  const n = S.npcs.find(x => x.name === name);
  if (!n) return;
  const gap = S.stats.days - (n.lastSeen || 0);
  $('npcBox').innerHTML = `<h2>${esc(n.name)}</h2>
    <div class="tip" style="margin-top:-10px">${n.age ? n.age + '岁　' : ''}${esc(n.job || '')}${callName(n) ? '　' + esc(callName(n)) : ''}</div>
    <div class="card" style="margin-top:14px"><div class="lines">
      <div><b>关系</b><span class="${n.rel < 12 ? 'bad' : ''}">${relWord(n.rel, n.tie)}</span></div>
      ${n.intimate ? `<div><b>你们之间</b><span>${esc(n.intimate.first)}起有过关系${n.intimate.times > 1 ? `，${n.intimate.times}回` : ''}</span></div>` : ''}
      <div><b>上次来往</b><span>${gap <= 0 ? '就这几天' : gap + '天前'}</span></div>
      ${n.care ? `<div><b>在意</b><span>${esc(n.care)}</span></div>` : ''}
    </div>${n.note ? `<div class="tip">${esc(n.note)}</div>` : ''}</div>
    ${(n.mem || []).length ? `<h4 style="margin-top:8px">你们之间</h4><div class="card">${n.mem.slice(-8).reverse().map(m => `<div class="li">${esc(m)}</div>`).join('')}</div>` : ''}
    <div class="btns"><button class="ghost" onclick="mask('npcMask',false)">关掉</button><button class="primary" onclick="mask('npcMask',false);openConvo('${esc(n.name)}')">找他聊聊</button></div>
    ${!E.partnerOf(S) && (n.rel >= 55 || n.intimate) && !/爱人|前任|前妻|前夫/.test(n.tie || '') && !isKin(n.tie)
      ? `<div class="btns"><button class="ghost" onclick="mask('npcMask',false);askLove('${esc(n.name)}')">把话挑明</button></div>`
      : ''}`;
  mask('npcMask', true);
}
function openThread(from) {
  for (const m of S.msgs) if (m.from === from) m.read = true;
  saveGame();
  if (!S.npcs.some(x => x.name === from)) {
    // 还没进通讯录的人（同学、房东之类）给你发了消息：直接加进来，点开就能回
    const peer = (S.peers || []).find(p => p.name === from);
    E.addNpcs(S, [{ name: from, tie: peer ? '同学' : (/^(房东|老板|领导|同事|室友|邻居|快递|中介|物业)$/.test(from) ? from : ''),
      job: peer ? (peer.note || '') : '', note: peer ? (peer.note || '') : '给你发过消息', rel: peer ? 30 : 18, close: false }], 1);
  }
  openConvo(from);
}

/* ---- 私聊 ---- */
// 最近几段原文里跟这个人有关的句子，原样给模型，细节才对得上
function aboutNpc(n) {
  const hits = [];
  for (const r of S.recent.slice(-6)) {
    for (const s of String(r.narrative || '').split(/(?<=[。！？…”])/)) if (s.indexOf(n.name) >= 0) hits.push(s.trim());
  }
  const t = hits.slice(-8).join('').slice(-420);
  return t ? `【最近剧情里跟${n.name}有关的原话】${t}\n` : '';
}
function convoHead(n) {
  return `${worldRules()}

你现在扮演的是【${n.name}】，不是主角。只说${n.name}的话，一次一两句，像真人发微信或者当面讲话：短、有口语、可以答非所问、可以不接主角的话茬。
不许旁白，不许描写主角的动作和心理，不许替主角说话。不许说教，不许煽情。

【${n.name}是谁】${n.age ? n.age + '岁，' : ''}${n.job || '不详'}，在主角手机里存的是「${callName(n) || '认识的人'}」，眼下关系：${relWord(n.rel, n.tie)}（内部数值${Math.round(n.rel)}）${n.care ? `，他在意的是${n.care}` : ''}。${n.note || ''}
【你们之间的来往（按日子，${n.name}都记得）】
${(n.mem || []).join('\n') || '没什么特别的'}
【主角】${S.player.name}，${S.player.age}岁，${S.player.job}，眼下在${S.place || '外面'}。${E.bgLine(S.player)}。手头存款${S.player.money}元。
【主角这阵子干的事】（${n.name}知道多少看关系：走得近的、家里人大体都知道；不熟的只知道跟自己有关的和传到耳朵里的。知道的就要对得上，别装不知道，也别说错）
${S.history.slice(-10).map(h => `${h.date}｜${h.act ? '他去' + h.act + '：' : ''}${h.summary}`).join('\n') || '（刚开始）'}
${aboutNpc(n)}【就在刚才】${String((S.recent[S.recent.length - 1] || {}).narrative || '').replace(/\s+/g, '').slice(-220)}`;
}
function convoPrompt(n, say, judge) {
  const log = S.convo.lines.map(l => `${l.who === 'me' ? S.player.name : n.name}：${l.text}`).join('\n') || '（刚开口）';
  const past = (S.convo.hist || []).map(m => `${m.date || ''} ${m.me ? S.player.name : n.name}：${m.text}`).join('\n');
  return `${convoHead(n)}
${past ? `\n【手机里之前的来往（主角这次就是接着这些点开的对话框）】\n${past}\n` : ''}
【这次的对话】
${log}

${judge
    ? `【引擎判定（不可更改）】主角求的这件事：${judge.what}。${judge.attr}${judge.val}，掷骰${judge.roll}＝${judge.total}，难度${judge.need}，判定【${judge.success ? '答应' : '没答应'}】${judge.crit ? '（' + judge.crit + '）' : ''}。
这一轮写${n.name}的最终答复，必须照这个结果来。答应也可以有条件、有犹豫；不答应也可以留余地或者干脆拒绝，但不许含糊其辞糊弄过去。`
    : `【主角刚说的】${say}`}

只输出一个合法 JSON：
{"reply":"${n.name}这一轮说的话","mood":"他此刻什么状态（4字内）","rel":关系增减(-8到8的整数),"ask":${judge ? 'null' : 'null 或 {"what":"主角求的事","attr":"表达|情绪|谋划|专业","need":40到85,"money":如果是借钱就写数额否则0,"days":多少天内还}'},"end":对方想结束对话就true,"summary":"这次聊天到现在的一句话（20字内）"}`;
}

let convoFrom = '';     // 从哪个面板点进来的，返回时回那儿
function openConvo(name) {
  const n = S.npcs.find(x => x.name === name);
  if (!n || busy) return;
  convoFrom = curTab || '';
  S.convo = { name, lines: [], turns: 0, summary: '', rel: 0, hist: S.msgs.filter(m => m.from === name).slice(-14) };
  closePanel();
  $('chat').classList.add('on');
  renderConvo();
  $('chatIn').value = '';
  setTimeout(() => $('chatIn').focus(), 200);
}
function renderConvo() {
  const c = S.convo;
  if (!c) return;
  const n = S.npcs.find(x => x.name === c.name) || { name: c.name, rel: 20, tie: '' };
  $('chatName').innerHTML = `${esc(n.name)} <i class="tapcard">名片</i>`;
  $('chatName').onclick = () => showNpc(n.name);
  $('chatSub').textContent = callName(n);
  let lastDate = '';
  const hist = (c.hist || []).map(m => {
    const d = m.date && m.date !== lastDate ? `<div class="sysline">${esc(m.date)}</div>` : '';
    lastDate = m.date || lastDate;
    return d + `<div class="bub ${m.me ? 'me' : 'ta'}">${esc(m.text)}</div>`;
  }).join('');
  const nowD = E.shortDate(S.date);
  const sep = hist && c.lines.length && lastDate !== nowD ? `<div class="sysline">${esc(nowD)}</div>` : '';
  $('chatBody').innerHTML = (hist + sep + c.lines.map(l =>
    l.who === 'sys'
      ? `<div class="sysline">${esc(l.text)}</div>`
      : `<div class="bub ${l.who === 'me' ? 'me' : 'ta'}">${esc(l.text)}${l.mood ? `<i>${esc(l.mood)}</i>` : ''}</div>`).join(''))
    || '<div class="sysline">说点什么</div>';
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
}
async function convoSend() {
  const c = S.convo;
  if (!c || busy) return;
  const say = $('chatIn').value.trim();
  if (!say) return;
  $('chatIn').value = '';
  c.lines.push({ who: 'me', text: say });
  c.turns++;
  renderConvo();
  await convoTurn(say, null);
  if (c.turns >= 8) { c.lines.push({ who: 'sys', text: '聊得差不多了' }); renderConvo(); }
}
async function convoTurn(say, judge) {
  const c = S.convo;
  const n = S.npcs.find(x => x.name === c.name);
  if (!n) return;
  setBusy(true, '对面在打字……');
  $('chatBody').insertAdjacentHTML('beforeend', '<div class="bub ta typing">……</div>');
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
  try {
    const d = await llmJSON(convoPrompt(n, say, judge), null, { maxTokens: 1200, temperature: 1.05 });
    c.lines.push({ who: 'ta', text: d.reply || '……', mood: d.mood || '' });
    c.rel += E.num(d.rel);
    if (d.summary) c.summary = d.summary;
    renderConvo();
    if (d.ask && d.ask.what && !judge) {
      const ck = E.rollCheck(S, d.ask.attr || '表达', E.num(d.ask.need) || 60, Math.random);
      ck.what = d.ask.what;
      ck.money = E.num(d.ask.money); ck.days = E.num(d.ask.days);
      if (ck.success && ck.money > 0) {
        E.addDebt(S, c.name, ck.money, ck.days || 60);
        c.lines.push({ who: 'sys', text: `${c.name}给你转了${ck.money}，说好${ck.days || 60}天内还` });
        rebuildTop();
      }
      c.lines.push({ who: 'sys', text: `${ck.attr}${ck.val}　掷骰${ck.roll}　${ck.total}/${ck.need}　${ck.success ? '成' : '不成'}` });
      renderConvo();
      setBusy(false);
      await convoTurn('', ck);
      return;
    }
    if (d.end) { c.lines.push({ who: 'sys', text: '他看样子要走了' }); renderConvo(); }
  } catch (e) {
    c.lines.push({ who: 'sys', text: '（没说成：' + (e.message || e) + '）' });
    renderConvo();
  }
  setBusy(false);
  saveGame();
}
function endConvo(goOn, toPanel) {
  const c = S.convo;
  if (!c) { $('chat').classList.remove('on'); return; }
  const n = S.npcs.find(x => x.name === c.name);
  const said = c.lines.filter(l => l.who !== 'sys');
  if (n && said.length) {
    E.applyConvo(S, c.name, { rel: c.rel, mem: c.summary || said[said.length - 1].text.slice(0, 30) });
    S.recent.push({
      seg: S.seg, action: `找${c.name}聊了聊`,
      narrative: said.map(l => `${l.who === 'me' ? S.player.name : c.name}：${l.text}`).join('\n')
    });
    S.recent = S.recent.slice(-8);
    S.history.push({ seg: S.seg, date: E.shortDate(S.date), summary: `跟${c.name}聊：${c.summary || '说了会儿话'}` });
    const dt = E.shortDate(S.date);
    for (const l of said) S.msgs.push({ from: c.name, me: l.who === 'me', text: String(l.text).slice(0, 120), date: dt, kind: 'talk', read: true });
    S.msgs = S.msgs.slice(-240);
  }
  const name = c.name, sum = c.summary;
  S.convo = null;
  $('chat').classList.remove('on');
  saveGame();
  rebuildTop();
  const back = convoFrom; convoFrom = '';
  if (toPanel && back) gotoTab(back);         // 只有点返回键才回刚才那个面板；被别的界面收起时不回
  if (goOn && said.length) { S.actTyped = false; S.lastAction = `刚跟${name}聊完（${sum || '说了会儿话'}），接着过日子`; runSegment({ quick: true }); }
}




/* ================= 朋友圈 ================= */
let phoneTab = 'msg';
function setPhoneTab(t) { phoneTab = t; renderPanel(); }
function faceOf(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return { ch: name.slice(0, 1), hue: h % 360 };
}
function renderMoments() {
  const ms = (S.moments || []).slice().reverse();
  for (const m of (S.moments || [])) m.read = true;
  saveGame();
  return `<div class="mombox">
    <div class="mompost"><input id="momIn" placeholder="说点什么…" maxlength="60"/><button class="act-go" onclick="postMoment()">发</button></div>
    ${ms.length ? ms.map(m => {
      const f = faceOf(m.who);
      const mine = m.who === S.player.name;
      return `<div class="mom">
        <div class="face" style="--h:${f.hue}">${esc(f.ch)}</div>
        <div class="mombody">
          <div class="momwho">${esc(m.who)}${mine ? '<em>我</em>' : ''}</div>
          <div class="momtext">${esc(m.text)}</div>
          <div class="momfoot"><span>${esc(m.date)}</span>
            <button class="${m.liked ? 'on' : ''}" onclick="doLike('${m.id}')">${m.liked ? '已赞' : '赞'} ${m.likes}</button>
            ${mine ? '' : `<button onclick="doComment('${m.id}')">留言</button>`}</div>
          ${m.cs.length ? `<div class="momcs">${m.cs.map(c => `<div><b>${esc(c.who)}</b>：${esc(c.text)}</div>`).join('')}</div>` : ''}
        </div></div>`;
    }).join('') : '<div class="card tip">还没人发东西</div>'}
  </div>`;
}
function doLike(id) {
  E.likeMoment(S, id);
  saveGame(); renderPanel();
}
async function doComment(id) {
  const m = (S.moments || []).find(x => x.id === id);
  if (!m || busy) return;
  const txt = await ask({ title: `给${m.who}留一句`, quote: m.text, input: { placeholder: '说点什么', max: 60 }, ok: '留言' });
  if (!txt) return;
  E.commentMoment(S, id, S.player.name, txt);
  saveGame(); renderPanel();
  const n = S.npcs.find(x => x.name === m.who);
  if (!n) { toast('他不一定看得见'); return; }
  setBusy(true, '对面在看……');
  try {
    const d = await llmJSON(`${convoHead(n)}

${n.name}在朋友圈发了一条：「${m.text}」
${S.player.name}在底下留言：「${txt}」
${m.cs.length > 1 ? `这条底下还有别人的留言：${m.cs.slice(0, -1).map(c => c.who + '说' + c.text).join('；')}` : ''}

写${n.name}回他这一句。要求：一句话，十五个字以内，像真人在朋友圈底下回复——可以敷衍、可以玩笑、可以只回两个字。不许长篇大论，不许旁白。

只输出一个合法 JSON：{"reply":"","rel":-2到4的整数}`, null, { maxTokens: 400, temperature: 1.05 });
    E.commentMoment(S, id, n.name, d.reply || '嗯');
    const add = E.num(d.rel) || 1;
    n.rel = Math.max(0, Math.min(100, Math.round((n.rel + add) * 100) / 100));
    n.lastSeen = S.stats.days;
    saveGame(); renderPanel();
  } catch (e) { toast(e.message || '没回上'); }
  setBusy(false);
}
async function postMoment() {
  const v = ($('momIn').value || '').trim();
  if (!v || busy) return;
  $('momIn').value = '';
  E.addMoment(S, S.player.name, v, 'me');
  saveGame(); renderPanel();
  const cand = S.npcs.filter(n => n.rel >= 25).slice(0, 8);
  if (!cand.length) return;
  setBusy(true, '发出去了……');
  try {
    const d = await llmJSON(`${worldRules()}

${S.player.name}在朋友圈发了一条：「${v}」

【能看见的人】
${cand.map(n => `${n.name}（${n.tie}${n.job ? '，' + n.job : ''}，跟他关系${relWord(n.rel, n.tie)}${n.care ? '，在意' + n.care : ''}）`).join('\n')}

挑其中 1-3 个人在底下留言。要求：每条十五字以内，像真人在朋友圈底下说话——可以是玩笑、可以是敷衍的表情、可以答非所问、可以顺嘴提一件别的事。关系远的人可以不吭声。不许所有人都夸他。

只输出一个合法 JSON：{"cs":[{"who":"谁","text":"留言"}]}`, null, { maxTokens: 500, temperature: 1.08 });
    const mm = S.moments[S.moments.length - 1];
    for (const c of (d.cs || []).slice(0, 3)) if (c && c.who && c.text) E.commentMoment(S, mm.id, c.who, c.text);
    saveGame(); renderPanel();
  } catch (e) { toast(e.message || '没人理你'); }
  setBusy(false);
}

/* ================= 家 ================= */
function renderHome() {
  const H = S.home || { kind: '租' };
  const P = E.partnerOf(S);
  const kids = (S.family && S.family.kids || []);
  const b = E.canBuy(S);
  const out = [`<h3>家</h3>`];

  // 住处
  out.push(`<h4>住处</h4><div class="card">`);
  if (H.kind === '买') {
    const left = H.loan && !H.loan.done ? H.loan.left : 0;
    out.push(`<div class="big">自己的房子</div>
      <div class="lines" style="margin-top:8px">
        <div><b>买下来</b><span>${esc(H.since)}｜${H.price}元</span></div>
        ${left ? `<div><b>还欠银行</b><span class="bad">${left}</span></div><div><b>月供</b><span>${H.loan.monthly}｜已还${H.loan.paid}期</span></div>` : '<div><b>贷款</b><span class="good">还清了</span></div>'}
        <div><b>净值</b><span class="good">${E.homeWorth(S)}</span></div>
      </div>`);
  } else {
    out.push(`<div class="big">${esc(H.place || S.place || '租来的地方')}</div>
      <div class="lines" style="margin-top:8px"><div><b>房租</b><span>${S.ledger.rent}/月</span></div></div>
      <div class="tip">买一套要 ${b.price}，首付 ${b.down}，之后每月供 ${b.monthly}。买了就没有房租，但三十年绑在这儿。</div>
      <div class="btns"><button class="${b.ok ? 'primary' : 'ghost'}" ${b.ok ? '' : 'disabled'} onclick="doBuyHouse()">${b.ok ? '付首付，买' : `首付还差 ${b.down - S.player.money}`}</button></div>`);
  }
  out.push(`</div>`);

  // 身边的人
  out.push(`<h4>伴侣</h4><div class="card">`);
  if (P) {
    const warmWord = P.warm >= 75 ? '热乎着' : P.warm >= 50 ? '还好' : P.warm >= 25 ? '淡了' : '快过不下去了';
    out.push(`<div class="big">${esc(P.name)}</div>
      <div class="lines" style="margin-top:8px">
        <div><b>什么关系</b><span>${esc(P.stage)}${P.marriedAt ? `（${esc(P.marriedAt)}领的证）` : `（${esc(P.since)}起）`}</span></div>
        <div><b>过得怎么样</b><span class="${P.warm < 25 ? 'bad' : P.warm >= 75 ? 'good' : ''}">${warmWord}</span></div>
      </div>
      <div class="bar" style="margin-top:8px"><div class="bar-in${P.warm >= 60 ? ' good' : P.warm < 25 ? ' bad' : ''}" style="width:${Math.round(P.warm)}%"></div></div>
      <div class="tip">重心放在「顾家」才顾得上；一直不着家，热乎气一周一周往下掉。</div>
      <div class="btns">
        ${P.stage !== '结婚' ? `<button class="primary" onclick="askMarry()">求婚</button>` : ''}
        <button class="ghost" onclick="openConvo('${esc(P.name)}')">说说话</button>
        <button class="ghost" onclick="doBreak()">分了</button>
      </div>`);
  } else {
    const n = S.npcs.filter(x => x.rel >= 55 && !/爱人|前任|前妻|前夫/.test(x.tie || '') && !isKin(x.tie)).length;
    out.push(`<div class="tip">眼下一个人过。${n ? `手机里有 ${n} 个走得够近的人，点开谁的名片就能把话挑明。` : '手机里还没有走得够近的人——聊得多了才谈得上这个。'}</div>`);
  }
  out.push(`</div>`);

  // 有过关系的人
  const lv = E.lovers(S);
  if (lv.length) {
    out.push(`<h4>有过关系的人</h4><div class="card">${lv.map(n => {
      const st = P && P.name === n.name ? P.stage : /前任|前妻|前夫/.test(n.tie || '') ? n.tie : '没名分';
      return `<div class="li" onclick="showNpc('${esc(n.name)}')"><b>${esc(n.name)}</b><span class="rel">${esc(st)}</span>
        <div class="tip">${esc([callName(n), `${n.intimate.first}头一回`, n.intimate.times > 1 ? `${n.intimate.times}回` : '', `最近${n.intimate.last}`, `关系${relWord(n.rel, n.tie)}`].filter(Boolean).join('｜'))}</div></div>`;
    }).join('')}
      ${!P ? '<div class="tip">想给谁一个名分，点开他的名片「把话挑明」。</div>' : ''}</div>`);
  }

  // 孩子
  out.push(`<h4>孩子</h4><div class="card">`);
  if (kids.length) {
    out.push(kids.map(k => k.unborn
      ? `<div class="li"><b>还在路上</b><div class="tip">还有 ${Math.max(0, k.dueDay - S.stats.days)} 天</div></div>`
      : `<div class="li"><b>${esc(k.name)}</b><span class="rel">${k.age}岁</span><div class="tip">${E.kidStage(k)}｜${esc(k.born)}生的</div></div>`).join(''));
    out.push(`<div class="tip">每月养孩子 ${E.kidCost(S)} 元，上了学还要往上走。</div>`);
  } else out.push(`<div class="tip">还没有。</div>`);
  if (P && P.stage === '结婚' && !kids.some(k => k.unborn)) out.push(`<div class="btns"><button class="ghost" onclick="doWantKid()">要个孩子</button></div>`);
  out.push(`</div>`);

  // 自己的摊子（摘要，细账在账本里）
  if (S.biz && !S.biz.dead) {
    const B = S.biz;
    out.push(`<h4>自己的摊子</h4><div class="card">
      <div class="big">${esc(B.name)}</div>
      <div class="lines" style="margin-top:8px">
        <div><b>${esc(B.kind)}</b><span>开了${B.months}个月</span></div>
        <div><b>上个月</b><span class="${B.net >= 0 ? 'good' : 'bad'}">${B.net >= 0 ? '剩' + B.net : '亏' + (-B.net)}</span></div>
        <div><b>口碑</b><span>${Math.round(B.rep)}</span></div>
        <div><b>人手</b><span>${B.staff.length}个</span></div>
      </div>
      <div class="btns"><button class="ghost" onclick="gotoTab('book')">去账本里看细账</button></div></div>`);
  }
  // 身家
  out.push(`<h4>身家</h4><div class="card"><div class="lines">
    <div><b>存款</b><span class="${S.player.money < 0 ? 'bad' : ''}">${S.player.money}</span></div>
    ${E.homeWorth(S) ? `<div><b>房子净值</b><span>${E.homeWorth(S)}</span></div>` : ''}
    ${S.biz && !S.biz.dead ? `<div><b>摊子累计</b><span class="${S.biz.total < 0 ? 'bad' : ''}">${S.biz.total}</span></div>` : ''}
    ${(S.debts || []).length ? `<div><b>欠人的</b><span class="bad">${S.debts.reduce((a, d) => a + d.left, 0)}</span></div>` : ''}
  </div></div>`);
  return out.join('');
}

function doBuyHouse() {
  const r = E.buyHouse(S, Math.random);
  if (!r.ok) { toast(r.why); return; }
  closePanel();
  S.actTyped = false; S.lastAction = `付了首付，把房子买下来了${r.cut ? `（砍下来${r.cut}）` : ''}`;
  saveGame(); rebuildTop();
  toast(`首付${r.down}，往后每月供${r.monthly}`);
  runSegment({ quick: true });
}
function askLove(name) {
  const n = S.npcs.find(x => x.name === name);
  if (!n) return;
  runKey({ scene: '摊牌', gate: `跟${name}把话挑明`, title: '挑明', kind: 'love', who: name, mileId: null, hard: Math.round(72 - n.rel * 0.42) });
}
function askMarry() {
  const P = E.partnerOf(S);
  if (!P) return;
  const cost = Math.round((E.CITIES[S.city] || E.CITIES['新一线']).rent * 30);
  if (S.player.money < cost) { toast(`办下来少说要 ${cost}，手头不够`); return; }
  runKey({ scene: '摊牌', gate: `跟${P.name}谈结婚的事`, title: '结婚', kind: 'marry', who: P.name, mileId: null, hard: Math.round(64 - P.warm * 0.3) });
}
async function doBreak() {
  const P = E.partnerOf(S);
  if (!P) return;
  const married = P.stage === '结婚';
  if (!await ask({ title: married ? `真要跟${P.name}离？` : `真要跟${P.name}分？`, text: married ? '家当要分走一半，这事没法回头。' : '话说出口，就收不回来了。', no: '再想想', ok: married ? '离' : '分', danger: true })) return;
  const r = E.breakUp(S, '说不下去了');
  closePanel();
  S.actTyped = false; S.lastAction = r.wasMarried ? `跟${P.name}把证退了，家当分了一半` : `跟${P.name}分了`;
  saveGame(); rebuildTop();
  runSegment({ quick: true });
}
function doWantKid() {
  const r = E.wantKid(S, Math.random);
  if (!r.ok) { toast(r.why + (r.ck ? `（${r.ck.attr}${r.ck.val}，掷${r.ck.roll}）` : '')); saveGame(); return; }
  toast('有了');
  closePanel();
  S.actTyped = false; S.lastAction = '要孩子这件事定下来了';
  saveGame();
  runSegment({ quick: true });
}

/* ================= 结局 ================= */
function endPrompt(sc, reason) {
  const L = sc.lines;
  const P = E.partnerOf(S);
  const kids = (S.family && S.family.kids || []).filter(k => !k.unborn);
  const done = [];
  for (const st of S.ideal.stages) for (const m of st.milestones) if (m.done) done.push(m.title);
  return `${worldRules()}

${stateBlocks()}

这一局到头了：${reason.text}（${reason.why}）。${S.player.name}今年${S.player.age}岁。

引擎算完的四条线（满分100，不许改）：
- 志业 ${L.志业}：想干的是「${S.player.ideal}」，迈过的台阶${done.length ? '：' + done.join('、') : '一级都没迈过'}
- 财务 ${L.财务}：存款${S.player.money}${E.homeWorth(S) ? `，房子净值${E.homeWorth(S)}` : '，没有房'}${S.biz && !S.biz.dead ? `，自己的${S.biz.kind}「${S.biz.name}」` : ''}${(S.debts || []).length ? `，还欠人${S.debts.reduce((a, d) => a + d.left, 0)}` : ''}
- 关系 ${L.关系}：${P ? `${P.stage === '结婚' ? '跟' + P.name + '成了家' : '和' + P.name + '在一起'}（${P.warm >= 60 ? '还热乎' : P.warm >= 30 ? '平平淡淡' : '早就淡了'}）` : '一个人'}${kids.length ? `，孩子${kids.map(k => k.name + k.age + '岁').join('、')}` : ''}，真交心的朋友${S.npcs.filter(n => n.rel >= 55).length}个${(S.rifts || []).filter(r => !r.done).length ? `，还有${S.rifts.filter(r => !r.done).length}笔没了的梁子` : ''}
- 身心 ${L.身心}：精力${S.player.energy}${(S.chronic || []).length ? `，${S.chronic.map(c => c.name).join('、')}` : '，还算利索'}

最高的是${sc.top}，最低的是${sc.low}。

写这一局的结尾，450-650 字。要求：
- 从一个具体的场面切进去：某天早上、某个房间、手里正在做的一件事。不要从"回首这些年"开头。
- 结尾这一场里至少要有一两句真的对白。
- 把四条线都落到实处，尤其是最高和最低那两条的对照——他得到的和他搭进去的。
- 不许写成励志故事，也不许写成惨剧。${sc.avg >= 65 ? '他这一局过得不算差，但代价要写出来。' : sc.avg >= 40 ? '有得有失，两边都别美化。' : '过得不顺，但也别把他写成废人。'}
- 不许升华，不许"人生就是"，不许展望。最后一句停在一个动作或者一个具体的东西上。

只输出一个合法 JSON：
{"narrative":"结尾","summary":"一句话（20字内）","title":"给这一局起个四到八个字的名字"}`;
}

async function runEnding(reason) {
  const sc = E.endingScore(S);
  S.over = true;
  S.ending = reason.text;
  setBusy(true, '正在收尾……');
  S.seg++;
  const div = beginChapter(`${S.date.y}年`, `${S.player.age}岁 · 收`, '', null);
  try {
    const d = await llmJSON(endPrompt(sc, reason), raw => {
      const t = extractPartialField(raw, 'narrative');
      if (t) updateChapterNarrative(t);
    });
    updateChapterNarrative(d.narrative);
    S.endTitle = d.title || '';
    S.endText = d.narrative || '';
    S.endScore = sc;
    const bars = Object.keys(sc.lines).map(k =>
      `<div class="kbar"><span>${k}</span><div class="bar"><div class="bar-in ${sc.lines[k] >= 66 ? 'good' : sc.lines[k] >= 33 ? '' : 'bad'}" style="width:${sc.lines[k]}%"></div></div><em>${sc.lines[k]}</em></div>`).join('');
    div.insertAdjacentHTML('beforeend',
      `<div class="endblock"><h4>${esc(d.title || '这一局')}</h4>${bars}
        <div class="tip">最拿得出手的是${sc.top}，最亏的是${sc.low}。四条线平均 ${sc.avg}。</div></div>`);
    S.history.push({ seg: S.seg, date: `${S.date.y}年`, summary: `【收】${d.summary || ''}` });
    await finishChapter();
    rebuildTop();
    saveGame();
    renderOptions([]);
  } catch (e) {
    updateChapterNarrative('（结尾没写成：' + (e.message || e) + '）');
    renderOptions([]);
  }
  setBusy(false);
}
function goOn() {
  const to = E.keepGoing(S, 10);
  S.actTyped = false; S.lastAction = '日子还得往下过';
  saveGame();
  renderOptions([]);
  toast(`接着过，下一个坎在 ${to} 岁`);
  runSegment();
}

/* ================= 生意 ================= */
function renderBiz() {
  const B = S.biz;
  if (!B) {
    const kinds = Object.keys(E.BIZ_KINDS);
    return `<h4>自立门户</h4><div class="card">
      <div class="tip">自己开一摊子：上班的时间从此都拿来照看自己的生意，工资没了，赚多少看本事、口碑和你盯得紧不紧。开之前先攒够启动的钱。</div>
      ${kinds.map(k => {
        const K = E.BIZ_KINDS[k], need = E.bizSetup(S, k);
        const can = S.player.money >= need;
        return `<div class="li"><b>${k}</b><span class="rel${can ? '' : ' bad'}">${need}元</span>
          <div class="tip">${esc(K.desc)}｜看${K.attr}｜最多${K.cap}个人手</div>
          <button class="ghost sm" style="margin-top:6px" ${can ? '' : 'disabled'} onclick="askOpenBiz('${k}')">${can ? '就开这个' : '钱不够'}</button></div>`;
      }).join('')}</div>`;
  }
  const K = E.BIZ_KINDS[B.kind];
  return `<h4>${esc(B.name)}</h4>
  <div class="card">
    <div class="lines">
      <div><b>开了多久</b><span>${B.months}个月（${esc(B.since)}起）</span></div>
      <div><b>上个月</b><span class="${B.net >= 0 ? 'good' : 'bad'}">进${B.rev}　出${B.cost}　${B.net >= 0 ? '剩' + B.net : '亏' + (-B.net)}</span></div>
      <div><b>累计</b><span class="${B.total >= 0 ? 'good' : 'bad'}">${B.total}</span></div>
      <div><b>场地</b><span>${B.rent}/月</span></div>
    </div>
    <div class="cardhd" style="margin-top:10px">口碑</div>
    <div class="bar"><div class="bar-in${B.rep > 55 ? ' good' : B.rep < 25 ? ' bad' : ''}" style="width:${Math.round(B.rep)}%"></div></div>
    <div class="tip">${Math.round(B.rep)}　${B.lossMonths ? `已经连亏${B.lossMonths}个月。` : ''}上个月你盯了${Math.round(E.num(B.lastTend))}分，这个月到现在${Math.round(B.tend)}分（重心放在「拼工作」盯得最紧，盯得越紧生意越好）。</div>
  </div>
  <h4>人手（${B.staff.length}/${K.cap}）</h4>
  <div class="card">
    ${B.staff.length ? B.staff.map((st, i) => `<div class="li"><b>${esc(st.name)}</b><span class="rel${st.loyal < 30 ? ' bad' : ''}">${st.loyal < 30 ? '人心浮动' : st.loyal > 70 ? '跟得住' : '还行'}</span>
      <div class="tip lirow"><span>${esc(st.role)}｜能力${Math.round(st.skill)}｜${st.pay}元/月｜干了${st.months}个月</span>
        <span class="liact"><button class="ghost sm" onclick="doRaise(${i})">加钱</button><button class="ghost sm" onclick="doFire(${i})">辞了</button></span></div></div>`).join('')
      : '<div class="tip">就你一个人</div>'}
    <div class="btns"><button class="ghost" onclick="openHire()">招人</button><button class="ghost" onclick="doCloseBiz()">关了这摊</button></div>
  </div>`;
}
async function askOpenBiz(kind) {
  const need = E.bizSetup(S, kind);
  const name = await ask({ title: `给这个${kind}起个名字`, text: `启动要 ${need.toLocaleString('zh-CN')} 元，从存款里出。`, input: { placeholder: kind === '小店' ? '比如：巷口那家' : kind === '小公司' ? '比如：青禾文化' : '比如：半山工作室', max: 14 }, no: '再想想', ok: '开张' });
  if (!name) return;
  const r = E.openBiz(S, { kind, name }, Math.random);
  if (!r.ok) { toast(r.why); return; }
  closePanel();
  S.actTyped = false; S.lastAction = `把${kind}「${name}」开起来了${r.ck.success ? '' : '（开头就不太顺）'}`;
  saveGame();
  toast(`花了${r.need}，口碑起手${r.rep}`);
  runSegment({ quick: true });
}
function openHire() {
  const B = S.biz;
  if (!B) return;
  if (B.staff.length >= E.BIZ_KINDS[B.kind].cap) { toast('塞不下人了'); return; }
  const cand = E.bizCandidates(S, Math.random);
  $('npcBox').innerHTML = `<h2>招人</h2><div class="tip" style="margin-top:-10px">工资低于他值的价，早晚要走。</div>
    <div class="card" style="margin-top:14px">${cand.map((c, i) => `<div class="li">
      <b>${esc(c.name)}</b><span class="rel">${c.pay}元/月</span>
      <div class="tip lirow"><span>${esc(c.role)}｜能力${c.skill}</span>
        <span class="liact"><button class="ghost sm" onclick='doHire(${JSON.stringify(c).replace(/'/g, "&#39;")})'>要他</button></span></div></div>`).join('')}</div>
    <div class="btns"><button class="ghost" onclick="mask('npcMask',false)">再看看</button></div>`;
  mask('npcMask', true);
}
function doHire(c) {
  const r = E.hireBiz(S, c);
  mask('npcMask', false);
  if (!r || !r.ok) { toast((r && r.why) || '招不进来'); return; }
  toast(`${r.who}来了`);
  saveGame(); renderPanel();
}
async function doFire(i) {
  const s = S.biz.staff[i];
  if (!s) return;
  if (!await ask({ title: `让${s.name}走？`, text: `按规矩多给一个月工资，${s.pay} 元。`, no: '留着', ok: '让他走', danger: true })) return;
  const r = E.fireBiz(S, i);
  toast(`${r.who}走了，给了${r.pay}`);
  saveGame(); rebuildTop(); renderPanel();
}
async function doRaise(i) {
  const s = S.biz.staff[i];
  if (!s) return;
  const v = await ask({ title: `给${s.name}调工资`, text: `现在每月 ${s.pay} 元。填加多少，填负数就是降。`, input: { value: '500', number: true }, ok: '就这么定' });
  if (v === null) return;
  E.raiseBiz(S, i, Number(v));
  saveGame(); renderPanel();
}
async function doCloseBiz() {
  const B = S.biz;
  if (!B) return;
  if (!await ask({ title: `关掉「${B.name}」？`, text: '东西折价能回一点本，跟着你的人得给遣散。', no: '再撑撑', ok: '关', danger: true })) return;
  const r = E.closeBiz(S);
  closePanel();
  S.actTyped = false; S.lastAction = `把「${r.name}」关了`;
  saveGame(); rebuildTop();
  toast(`开了${r.months}个月，一共${r.total >= 0 ? '赚' : '亏'}${Math.abs(r.total)}`);
  runSegment({ quick: true });
}

/* ================= 年终 ================= */
function yearPrompt(dd) {
  const { now, up } = dd;
  const money = up ? `${up.money >= 0 ? '多了' : '少了'}${Math.abs(up.money)}元` : `${now.money}元`;
  const attrs = up ? E.ATTRS.filter(k => up.attrs[k] > 0).map(k => `${k}+${up.attrs[k]}`).join('、') || '没怎么长' : '刚起步';
  return `${worldRules()}

${stateBlocks()}

${now.y}年过完了。这是引擎记下的一年（数字不许改）：
- 年龄：${now.age}岁　营生：${now.job}
- 钱：${money}，年底存款${now.money}元${now.salary ? `，月薪${now.salary}` : '，没有工资进账'}
- 本事：${attrs}　行业口碑${now.信誉}　做人${now.人品}
- 理想：这一年在这件事上的功夫${up ? (up.ideal >= 0 ? '+' + up.ideal : up.ideal) : now.ideal}，迈过的台阶一共${now.miles}级${up && up.miles ? `（今年迈了${up.miles}级）` : '（今年一级没迈）'}
- 人：认识${now.npcs}个，真交心的${now.close}个${up && up.close ? `（今年多了${up.close}个）` : ''}${now.rifts ? `，还有${now.rifts}笔没了的梁子` : ''}
- 身体：精力${now.energy}${now.chronic.length ? `，落下的毛病：${now.chronic.join('、')}` : '，还没落下什么毛病'}
${now.biz ? `- 自己的摊子：${now.biz.name}，上个月净${now.biz.net}，口碑${now.biz.rep}，${now.biz.staff}个人手` : ''}
${(S.era || []).length ? `- 这一年外面发生的：${S.era.map(e => e.text).join('；')}` : ''}

写一篇 320-450 字的年终小结。要求：
- 口气是${cfg.person === 'ta' ? '他' : '你'}自己在年底回头看这一年，不是旁白，也不是总结报告。年终小结可以少些对白，但别一句话都没有。
- 必须落在具体的事上：哪个月在干什么、谁走了谁来了、哪一笔钱花得肉疼、身体是怎么垮下去或者撑住的。
- 数字可以提，但别罗列，别写成流水账。
- 不许升华，不许"这一年我懂得了"，不许展望明年。结尾停在一个具体的场面上就行。

只输出一个合法 JSON：
{"narrative":"年终小结","summary":"一句话概括这一年（20字内）","options":["明年开头能做的四件事，每条12字内"]}`;
}

/* ---- 饭碗与借钱 ---- */
async function doQuit() {
  if (!await ask({ title: '真辞？', text: '下个月起就没工资了，房租和吃穿照样要花。', no: '再干干', ok: '辞', danger: true })) return;
  const r = E.quitJob(S);
  if (!r) return;
  S.actTyped = false; S.lastAction = '把辞职的事办了';
  saveGame();
  closePanel();
  toast(r.text);
  runSegment({ quick: true });
}
async function doPay(i) {
  const d = (S.debts || [])[i];
  if (!d) return;
  const v = await ask({ title: `还给${d.who}`, text: `还欠 ${d.left} 元，手头有 ${S.player.money} 元。`, input: { value: String(Math.min(d.left, Math.max(0, S.player.money))), number: true }, ok: '还' });
  if (v === null) return;
  const r = E.payDebt(S, i, Number(v));
  if (!r) { toast('还不上'); return; }
  toast(`还了${r.who}${r.pay}元${r.left ? `，还欠${r.left}` : '，清了'}`);
  saveGame(); rebuildTop(); renderPanel();
}
function openBorrow() {
  const cand = S.npcs.filter(n => n.rel >= 35);
  if (!cand.length) { toast('眼下没有能开口的人'); return; }
  $('npcBox').innerHTML = `<h2>找谁开口</h2><div class="tip" style="margin-top:-10px">开口是要还的，还不上关系就完了。</div>
    <div class="card" style="margin-top:14px">${cand.sort((a, b) => b.rel - a.rel).map(n =>
      `<div class="li" onclick="mask('npcMask',false);openConvo('${esc(n.name)}')"><b>${esc(n.name)}</b>
        <span class="rel">${relWord(n.rel, n.tie)}</span><div class="tip">${esc(callName(n))}${callName(n) && n.job ? '｜' : ''}${esc(n.job || '')}</div></div>`).join('')}</div>
    <div class="tip">进了聊天之后直接开口，对方答不答应由引擎掷骰。</div>
    <div class="btns"><button class="ghost" onclick="mask('npcMask',false)">算了</button></div>`;
  mask('npcMask', true);
  closePanel();
}

/* ================= 投入 ================= */
function openFocus() {
  if (S.focus) { toast('手头这摊还没做完'); return; }
  mask('focusMask', true);
  $('fcWhat').value = '';
  $('fcHeal').checked = S.status.length > 0;
  $('fcDays').value = 10;
  $('fcDaysN').textContent = '10';
}
function doFocus() {
  const what = $('fcWhat').value.trim();
  if (!what) { toast('写清楚要闷头做什么'); return; }
  const days = Number($('fcDays').value) || 10;
  const heal = $('fcHeal').checked;
  const attr = heal ? '体能' : guessAttr(what);
  S.focus = { what, days, left: days, progress: 0, attr, heal,
    ideal: !heal && /理想|作品|写|做|练|学|产品|店/.test(what) ? 1 : 0, need: 55 + days * 1.1 };
  mask('focusMask', false);
  S.actTyped = false; S.lastAction = heal ? `接下来这${days}天，先把身体养回来（${what}）` : `接下来这${days}天，闷头${what}`;
  saveGame();
  runSegment();
}

/* ================= 设置 / 存档 ================= */
function openSettings() {
  mask('setMask', true);
  $('cfgBase').value = cfg.base; $('cfgKey').value = cfg.key; $('cfgModel').value = cfg.model;
  $('cfgThink').value = cfg.think ? 'on' : 'off';
  document.querySelectorAll('#setTheme .seg').forEach(b => {
    b.classList.toggle('on', b.dataset.v === (cfg.theme || 'dark'));
    b.onclick = () => { setSkin('theme', b.dataset.v); document.querySelectorAll('#setTheme .seg').forEach(x => x.classList.toggle('on', x === b)); };
  });
  document.querySelectorAll('#setPerson .seg').forEach(b => {
    b.classList.toggle('on', b.dataset.v === (cfg.person || 'you'));
    b.onclick = () => { setSkin('person', b.dataset.v); document.querySelectorAll('#setPerson .seg').forEach(x => x.classList.toggle('on', x === b)); };
  });
  document.querySelectorAll('#setFont .seg').forEach(b => {
    b.classList.toggle('on', b.dataset.v === (cfg.font || 'm'));
    b.onclick = () => { setSkin('font', b.dataset.v); document.querySelectorAll('#setFont .seg').forEach(x => x.classList.toggle('on', x === b)); };
  });
  document.querySelectorAll('#modelPick .seg').forEach(b => {
    b.classList.toggle('on', b.dataset.v === cfg.model);
    b.onclick = () => { $('cfgModel').value = b.dataset.v; document.querySelectorAll('#modelPick .seg').forEach(x => x.classList.toggle('on', x === b)); };
  });
  const fb = $('setFree');
  fb.innerHTML = seg(Object.keys(E.FREEDOM), S ? S.freedom : '都市传奇');
  bindSeg('setFree', v => {
    if (!S) return;
    S.freedom = v; saveGame();
    toast(v === '心想事成' ? '言出法随：你写什么就发生什么' : '口径改成' + v);
    $('setFreeNote').textContent = FREE_NOTE[v] || '';
  });
  $('setFreeNote').textContent = FREE_NOTE[S ? S.freedom : '都市传奇'] || '';
  $('setFreeWrap').style.display = S ? '' : 'none';
}
function saveCfg() {
  cfg = {
    base: $('cfgBase').value.trim() || 'https://api.deepseek.com',
    key: $('cfgKey').value.trim(),
    model: $('cfgModel').value.trim() || 'deepseek-v4-flash',
    think: $('cfgThink').value === 'on',
    theme: cfg.theme, font: cfg.font, person: cfg.person
  };
  localStorage.setItem(LS_CFG, JSON.stringify(cfg));
  mask('setMask', false);
  toast('记下了');
}
function saveGame() {
  if (!S) return;
  const j = JSON.stringify(S);
  try { localStorage.setItem(LS_SAVE, j); } catch (_) { }
  try { localStorage.setItem(LS_SAVE + '_bak', j); } catch (_) { }     // 备份一份，主存档万一没了还能接上
}
function loadGame() {
  let raw = localStorage.getItem(LS_SAVE);
  if (!raw) { raw = localStorage.getItem(LS_SAVE + '_bak'); if (raw) { try { localStorage.setItem(LS_SAVE, raw); } catch (_) { } console.warn('主存档不见了，从备份接上'); } }
  if (!raw) return false;
  try { S = JSON.parse(raw); } catch (_) { return false; }
  if (!S || !S.player) return false;
  E.fixJob(S);
  E.fixPace(S);
  E.fixWho(S);
  $('story').innerHTML = S.chapters.join('');
  if (S.runId) bookAll(S.runId).then(rows => {
    if (!rows || rows.length <= S.chapters.length) return;
    $('story').innerHTML = rows.map(r => r.html).join('');
    scrollDown();
  }).catch(() => { });
  rebuildTop();
  renderOptions(S.lastOptions && S.lastOptions.length ? S.lastOptions : ['接着过日子']);
  scrollDown();
  if (S.convo) { $('chat').classList.add('on'); renderConvo(); }
  if (S.key) openKey();
  return true;
}
async function restart() {
  if (!await ask({ title: '重开一局？', text: '这一局的存档就没了。', no: '不了', ok: '重开', danger: true })) return;
  localStorage.removeItem(LS_SAVE);
  localStorage.removeItem(LS_SAVE + '_bak');
  if (S && S.runId) bookClear(S.runId).catch(() => { });
  S = null;
  $('story').innerHTML = '';
  mask('setMask', false);
  closePanel();
  renderStart();
  mask('startMask', true);
}
async function exportSave() {
  if (!S) return;
  let rows = [];
  try { rows = await bookAll(S.runId); } catch (_) { }
  const pack = {
    what: '现代生活模拟器·存档', v: 1, at: new Date().toISOString(),
    who: `${S.player.name} ${S.player.age}岁 ${E.dateStr(S.date)}`,
    save: S, book: rows.map(r => ({ id: r.id, run: r.run, seq: r.seq, html: r.html }))
  };
  const blob = new Blob([JSON.stringify(pack)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${S.player.name}-${S.date.y}年${S.date.m}月.mls.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('存档拿走了，另一台设备上导入就行');
}
function importSave(file) {
  if (!file) return;
  const fr = new FileReader();
  fr.onload = async () => {
    let pack;
    try { pack = JSON.parse(fr.result); } catch (_) { toast('这个文件读不出来'); return; }
    if (!pack || !pack.save || !pack.save.player) { toast('这不是这个游戏的存档'); return; }
    if (S && !await ask({ title: `导入「${pack.who || '别处的存档'}」？`, text: '这台设备上现在这局会被盖掉。', ok: '导入', danger: true })) return;
    try {
      localStorage.setItem(LS_SAVE, JSON.stringify(pack.save));
      for (const r of (pack.book || [])) { try { await bookPut(r); } catch (_) { } }
      toast('导入了，正在重开页面');
      setTimeout(() => location.reload(), 700);
    } catch (e) { toast('写不进去：' + (e.message || e)); }
  };
  fr.readAsText(file);
}

async function exportBook() {
  if (!S) return;
  let rows = [];
  try { rows = await bookAll(S.runId); } catch (_) { }
  const html = rows.length ? rows.map(r => r.html).join('') : S.chapters.join('');
  const div = document.createElement('div'); div.innerHTML = html;
  const done = [];
  for (const st of S.ideal.stages) for (const m of st.milestones) if (m.done) done.push(`${m.doneDate || ''} ${m.title}`);
  const out = [`# ${S.player.name}　${S.startDate.y}年—${S.date.y}年`, '', `> ${S.player.ideal}`, '',
    `${S.player.age}岁｜${S.city}｜${S.player.job}｜存款 ${S.player.money}`,
    done.length ? `\n**迈过的台阶**：${done.join('；')}` : '', ''];
  for (const y of (S.years || [])) {
    out.push(`## ${y.y}年 · 年终`, '', y.text, '');
  }
  if ((S.years || []).length) out.push('---', '');
  div.querySelectorAll('.chapter').forEach(c => {
    const hd = c.querySelector('.chapmark'), tm = c.querySelector('.chaptime'), ac = c.querySelector('.action-echo');
    out.push('## ' + (hd ? hd.textContent.trim() : '') + (tm ? '　' + tm.textContent.trim() : ''));
    if (ac) out.push('> ' + ac.textContent.trim());
    c.querySelectorAll('.ntext p').forEach(p => out.push(p.textContent.trim()));
    out.push('');
  });
  const blob = new Blob([out.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${S.player.name}的这些年.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ================= 启动 ================= */
function boot() {
  applySkin();
  // iOS 上 user-scalable 会被忽略，这里再挡一道
  document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => gotoTab(t.dataset.t));
  $('panelClose').onclick = closePanel;
  $('setSave').onclick = saveCfg;
  $('setClose').onclick = () => mask('setMask', false);
  $('setRestart').onclick = restart;
  $('setExport').onclick = exportSave;
  $('setImport').onclick = () => $('setFile').click();
  $('setFile').onchange = e => { importSave(e.target.files[0]); e.target.value = ''; };
  $('fcGo').onclick = doFocus;
  $('fcClose').onclick = () => mask('focusMask', false);
  $('fcDays').oninput = () => $('fcDaysN').textContent = $('fcDays').value;
  $('topBtn').onclick = openSettings;
  $('keyEnd').onclick = keyFinish;
  $('chatSend').onclick = convoSend;
  $('chatIn').addEventListener('keydown', e => { if (e.key === 'Enter') convoSend(); });
  $('chatBack').onclick = () => endConvo(false, true);
  $('chatDone').onclick = () => endConvo(true);
  // 输入框拿到焦点时浏览器会把整个壳子顶上去，这里按回去
  $('app').addEventListener('scroll', () => { const a = $('app'); a.scrollTop = 0; a.scrollLeft = 0; }, { passive: true });
  // iOS 老版本不认 overscroll-behavior：手指落在不能滚的地方就不让它拖；落在能滚的框里，滚到头也不把整页带起来
  let tY = 0;
  document.addEventListener('touchstart', e => { tY = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1) return;
    const dy = e.touches[0].clientY - tY;
    let el = e.target;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        const atTop = el.scrollTop <= 0, atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if ((dy > 0 && atTop) || (dy < 0 && atEnd)) e.preventDefault();
        return;
      }
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      el = el.parentElement;
    }
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('pagehide', saveGame);
  window.addEventListener('beforeunload', saveGame);
  if (!loadGame()) { renderStart(); mask('startMask', true); }
}
boot();
