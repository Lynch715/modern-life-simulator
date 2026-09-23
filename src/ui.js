/* ===== 现代生活模拟器 · 界面与叙事层 ===== */
const E = ENGINE;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS_CFG = 'mls_cfg', LS_SAVE = 'mls_save';
const IDB_NAME = 'mls_book', IDB_STORE = 'chapters';

let S = null;
let cfg = { base: 'https://api.deepseek.com', key: '', model: 'deepseek-v4-flash', think: false };
try { const c = JSON.parse(localStorage.getItem(LS_CFG) || 'null'); if (c) cfg = Object.assign(cfg, c); } catch (_) { }
// 老存的模型名已经停用了，悄悄换掉
if (/^deepseek-(chat|reasoner)$/i.test(cfg.model || '')) { cfg.model = 'deepseek-v4-flash'; try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (_) { } }
let busy = false, lastFinish = null, curChapter = null;

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
    messages: [{ role: 'system', content: STYLE_SYSTEM }, { role: 'user', content: prompt }],
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

/* ================= 口径 ================= */
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
  return `【世界观】当代中国都市，一切公司、平台、店铺、小区都是虚构的名字。主角22岁刚出校门，从零开始。
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
"npcUpdates":[{"name":"","rel":0,"tie":null,"note":null,"mem":"这次和主角之间发生的一句话"}],
"newNpcs":[{"name":"","age":0,"job":"","tie":"跟主角什么关系","care":"他在意什么","note":"一句话的人","rel":20,"close":false}],
"messages":[{"from":"谁","text":"手机上收到的一条消息，像真的微信"}],
"appointments":[{"title":"约好的事","inDays":3,"kind":"约"}],
"milestoneClaim":[],
"newRifts":[{"who":"跟主角结下梁子的人","reason":"为什么","kind":"债主|前东家|竞对|私怨|甲方","heat":20}],
"riftEased":["这一段里主角把梁子解开了的人名"],
"newJob":null或{"employer":"新东家名字","title":"职位","salary":月薪数字,"lv":0到5的职级,"probation":是否试用期},
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
    `${n.name}（${n.age || '?'}岁，${n.job || '不详'}，${n.tie}，关系${relWord(n.rel, n.tie)}${n.care ? '，在意' + n.care : ''}）${(n.mem || []).slice(-2).join('；')}`).join('\n') || '（还没认识什么人）';
  const peers = S.peers.map(pr => `${pr.name}：${(pr.track || []).slice(-2).join('，') || pr.note || '还是老样子'}`).join('\n') || '（无）';
  const plan = ['工作日', '周末'].map((lab, i) => {
    const t = i ? S.schedule.rest : S.schedule.work;
    return `${lab}：${E.SLOTS.map(s => s + '=' + t[s]).join('，')}`;
  }).join('；');
  return `【今天】${E.dateStr(S.date)}
【人在哪】${S.place || '不详'}
【主角】${p.name}，${p.gender}，${p.age}岁，${S.city}。眼下的营生：${p.job}
【理想】${p.ideal}（赛道：${p.track}，看家本事叫「${p.skillName}」）
【志业阶梯】${E.ladderBlock(S)}
【属性】专业${p.attrs['专业']} 表达${p.attrs['表达']} 谋划${p.attrs['谋划']} 情绪${p.attrs['情绪']} 体能${p.attrs['体能']}｜精力${p.energy}
【饭碗】${S.job.out ? `没有工作（${S.job.was ? '从' + S.job.was + '出来了' : '被放走了'}），已经没有工资进账` : `${S.job.employer || '眼下这家'}，${E.LEVELS[E.num(S.job.lv)].t}${S.job.probation ? '（还在试用期）' : ''}，这个季度的绩效${Math.round(S.job.perf)}，下次考核还有${E.nextReview(S)}天`}
${(S.rifts || []).filter(r => !r.done).length ? `【结下的梁子】${S.rifts.filter(r => !r.done).map(r => `${r.who}（${r.kind}）：${r.reason}${r.heat >= 62 ? '，眼看压不住了' : r.heat >= 35 ? '，还没翻篇' : '，快淡了'}${r.came ? `，已经找过${r.came}回` : ''}`).join('；')}\n` : ''}${(S.debts || []).length ? `【欠的钱】${S.debts.map(d => `欠${d.who}${d.left}元（${d.due.m}月${d.due.d}日到期${d.late ? '，已经过期了' : ''}）`).join('；')}` : ''}
【钱】存款${p.money}元，月薪${L.salary}${L.subsidy ? `，家里每月给${L.subsidy}` : ''}，房租${L.rent}，生活${L.living}${L.remit ? `，每月往家寄${L.remit}` : ''}${S.broke ? '。【已经透支，账上是负的】' : ''}
【名声】行业口碑${p.信誉}，做人${p.人品}
【身上的毛病】${S.status.map(s => `${s.name}（还有${s.days}天）`).join('、') || '没有'}${S.chronic.length ? `｜去不掉的：${S.chronic.map(c => c.name).join('、')}` : ''}
【作息】${plan}
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
  '事': d => `这一段结束在一件突然冒出来的事上，类别是【${d}】。你来决定具体是什么事，要具体、可信、跟主角眼下的处境有关系。写到事情刚砸下来、主角还没来得及反应。`,
  '钱': d => `这一段结束在钱上：${d}。把数字写清楚，不要用"捉襟见肘"这类词糊过去。`,
  '运': d => `这一段结束在一件${d}的事上。大吉就给一桩真机缘（有人看见他、一笔意外的钱、一个够得着的门路），大凶就给一记实实在在的打击，都不要写成梦一场。`,
  '投入': d => `这一段是主角闷头做一件事：${d}。引擎已经给出了成败，照着写，不要另作判断。`,
  '人情': d => `这一段结束在别人的消息上：${d}。写主角是怎么知道的，以及他什么反应——不要替他升华，就写反应。`,
  '久': d => `这一段日子很太平。写出日子的质地（重复的通勤、便利店、群里没人说话），结尾给一点隐隐的不对劲或一个很小的苗头，别写成心灵鸡汤。`,
  '条件': d => `这一段结束在主角等的那件事上：${d}。`,
  '考核': d => `这一段结束在季度考核上：${d}。写清楚是谁跟他说的、在哪儿说的、原话大概什么样。结果不许改。`,
  '裂痕': d => `这一段结束在一个跟主角有梁子的人身上：${d}。他可以是直接堵上门、打电话、找到单位去、或者把事捅到别人那儿——挑一个最难堪的方式。写到他把话撂下为止，别替主角解决。`,
  '找上门': d => `这一段结束在一个人身上：${d}。写他是怎么找来的（电话、微信、直接堵在楼下都行）、开口第一句说了什么，别把来意一次交代完。`
};

function judgeBlock(j) {
  let s = '';
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
  const evText = events.length
    ? events.slice(-14).map(e => `[${e.t}] ${e.s}`).join('\n')
    : '（没什么值得记的）';
  const writer = (STOP_WRITE[stop.kind] || STOP_WRITE['事'])(stop.detail);
  const actBlock = S.lastAction
    ? `【上一次主角做的事】${S.lastAction}\n（这一段要先把这件事的结果交代掉，再往下走）`
    : '（这是开局之后的第一段）';
  return `${worldRules()}

${stateBlocks()}

${actBlock}

【本段引擎判定（不可更改）】
${judgeBlock(seg.judge)}${S.claimNote ? `\n【引擎驳回】${S.claimNote}。这一段不许把这一步写成办成了，可以写他差在哪。\n` : ''}

【本段时间】${E.shortDate(from)} 到 ${E.shortDate(to)}，一共${days}天
【这些天里发生的小事（引擎记下的，必须体现，但不必条条都写）】
${evText}

【这一段怎么收尾】${writer}

要求：
- 叙事 ${days >= 10 ? '400-600' : '250-420'} 字。${days >= 8 ? '这是一段被快进的日子，不许写成"第一天……第二天……"的流水账。挑这段时间里真正有分量的两三件事写，其余用一两句带过。' : ''}
- 必须接着上一段的结尾往下走：地点、在场的人、正在办的事都要接得上。
- 这一段比上一段一定要往前一步：地点、身边的人、主角知道的事、和谁的关系，四样里至少一样真的变了。
- 人物说的话要像人说的。手机消息写进 messages，1-3 条，短。
- 数值变化写进 playerChanges，全部是增减量。钱要具体。身体出问题写 statusAdd。
- 新出现的人写 newNpcs（最多2人），已有的人有变化写 npcUpdates。
- 主角这一段要是得罪了谁、坑了谁、欠了谁没还，写进 newRifts；把梁子解开了（道歉认了、钱还了、事办了）写进 riftEased。别滥用，一段最多一条。
- options 给四条，具体到能直接做（"去找周野问问那家公司"好过"寻找机会"），互相不重样，其中至少一条跟理想有关、一条跟眼下这件事有关。
${S.job.out ? `- 主角眼下没有工作，房租和生活费照扣。这一段要让这件事有分量：要么写他去找活（投简历、托人、接零活），要么写钱怎么撑住。他真谈成一份工作时，写进 newJob（给出东家、职位、月薪），引擎据此记账。\n` : ''}${S.broke ? '- 主角账上已经是负数了。这一段不许风花雪月，钱的窟窿必须出现在剧情里。\n' : ''}- 志业阶梯上这一步，只有引擎能宣布迈过去。你觉得主角够格冲了，就把里程碑标题写进 milestoneClaim，由引擎裁定；不许在剧情里直接写成办成了。
- 除非主角死亡或玩家要求收尾，gameOver 必须是 false。

只输出一个合法 JSON，不要任何别的字。格式：
${SCHEMA}`;
}

function bootPrompt(o) {
  return `${worldRules()}

现在开局。主角：${o.name}，${o.gender}，22岁，刚从学校出来，落在${o.city}。
出身：${o.origin}——${E.ORIGINS[o.origin].desc}
城市：${E.CITIES[o.city].desc}
他想干成的事：${o.ideal}（赛道：${o.track}）
手头：存款${S.player.money}元，房租${S.ledger.rent}，一个月生活费${S.ledger.living}${S.ledger.remit ? `，每月还要往家寄${S.ledger.remit}` : ''}，找到的第一份活月薪${S.ledger.salary}。

请铸造开局，写 350-500 字的开场：他住进了什么地方、第一份活是干什么的、7月1日这天在干什么。不要交代背景板，从一个具体的场面切进去。

另外给出：
- job：他这份活的名字（10字内，比如"一家小设计公司的实习"）
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
{"narrative":"开场","summary":"一句话","job":"","place":"","scene":{"location":"","unresolved":["3件麻烦，每条20字内"]},
"ladder":[{"name":"这一段叫什么","milestones":[{"title":"","desc":"","metric":"投入","need":60,"scene":"提案","gate":""}]}],
"npcs":[{"name":"","age":0,"job":"","tie":"","care":"","note":"","rel":30,"close":true}],
"peers":[{"name":"","note":""}],
"messages":[{"from":"","text":""}],
"options":["","","",""]}`;
}

/* ================= 渲染 ================= */
function relWord(v, tie) {
  v = E.num(v);
  if (tie && /家|妈|爸|父|母|哥|姐|弟|妹|爷|奶|亲/.test(tie)) {
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
function narrativeHtml(t) {
  return String(t || '').split(/\n+/).filter(x => x.trim()).map(p => `<p>${esc(p.trim())}</p>`).join('');
}
function beginChapter(head, sub, action, judge) {
  const div = document.createElement('div');
  div.className = 'chapter';
  let dice = '';
  if (judge && (judge.fate || judge.check || judge.focus)) {
    const bits = [];
    if (judge.fate) { const f = E.fateInfo(judge.fate); bits.push(`<span class="die ${f.cls}">天命 ${judge.fate} ${f.label}</span>`); }
    if (judge.check) bits.push(`<span class="die ${judge.check.success ? 'good' : 'bad'}">${esc(judge.check.attr)} ${judge.check.total}/${judge.check.need} ${judge.check.success ? '成' : '败'}</span>`);
    if (judge.focus) bits.push(`<span class="die ${judge.focus.success ? 'good' : 'bad'}">${judge.focus.heal ? '养了' : '投入'}${judge.focus.days}天 ${judge.focus.heal ? (judge.focus.success ? '缓过来了' : '没养利索') : (judge.focus.success ? '做成' : '没成')}</span>`);
    dice = `<div class="dicebar">${bits.join('')}</div>`;
  }
  div.innerHTML = `<div class="chaphead"><span class="chapmark">${esc(head)}</span><span class="chaptime">${esc(sub)}</span></div>
    ${action ? `<div class="action-echo">${esc(action)}</div>` : ''}${dice}<div class="ntext"><p class="typing">……</p></div>`;
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
  $('topSub').textContent = `${S.place || ''}${bad}`;
}

function renderOptions(opts) {
  const box = $('acts');
  box.innerHTML = '';
  if (S.over) { box.innerHTML = `<div class="ended">这一局结束了：${esc(S.ending || '')}</div>`; return; }
  (opts || []).slice(0, 4).forEach(o => {
    const b = document.createElement('button');
    b.className = 'act-btn'; b.textContent = o;
    b.onclick = () => doAction(o);
    box.appendChild(b);
  });
  const row = document.createElement('div');
  row.className = 'act-row';
  row.innerHTML = `<input id="freeAct" placeholder="或者自己写一件要做的事" maxlength="40"/><button class="act-go" id="goBtn">去做</button><button class="act-focus" id="focusBtn" title="闷头做一件事">投入</button>`;
  box.appendChild(row);
  $('goBtn').onclick = () => {
    const v = $('freeAct').value.trim();
    if (!v) { toast('先写点什么'); return; }
    doAction(v);
  };
  $('freeAct').addEventListener('keydown', e => { if (e.key === 'Enter') $('goBtn').click(); });
  $('focusBtn').onclick = openFocus;
}

/* ================= 一段推进 ================= */
async function doAction(action) {
  if (busy || !S || S.over) return;
  S.lastAction = action;
  await runSegment();
}

function makeJudge(action) {
  const rng = Math.random;
  const j = { fate: null, check: null, focus: null, stuck: 0, nudge: null };
  const st = E.stuckLevel(S);
  if (st >= 55) { j.stuck = st; j.nudge = E.pickNudge(rng); }
  return j;
}

async function runSegment() {
  if (busy) return;
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
  const adv = E.advance(S, { rng, maxDays: 35 });
  if (focusing && adv.stop.kind === '投入') judge.focus = E.settleFocus(S, rng);
  if (adv.stop.kind === '运') judge.fate = adv.stop.fate;
  else judge.fate = E.d20(rng);

  S.seg++;
  S.stats.segs++;
  const head = adv.days <= 1 ? E.shortDate(adv.to) : `${E.shortDate(adv.from)} — ${E.shortDate(adv.to)}`;
  setBusy(true, adv.days >= 8 ? `${adv.days}天过去了，正在记下这段日子……` : '正在记下这几天……');
  beginChapter(head, `${adv.days}天`, S.lastAction || '', judge);
  renderOptions([]);
  S.pending = { action: S.lastAction, stop: adv.stop };
  saveGame();

  try {
    const prompt = segPrompt({ adv, judge });
    const d = await llmJSON(prompt, raw => {
      const t = extractPartialField(raw, 'narrative');
      if (t) updateChapterNarrative(t);
    });
    updateChapterNarrative(d.narrative);
    E.applyTurn(S, d);
    const claim = E.judgeClaim(S, d.milestoneClaim);
    if (claim && !claim.ok) S.claimNote = `你申报过「${claim.title}」，但${claim.short}，还不够格`;
    else S.claimNote = null;
    S.pending = null;
    S.lastAction = null;
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
  <div class="frow"><label>出身</label><div class="segs" id="sOrigin">${seg(Object.keys(E.ORIGINS), '普通家庭')}</div></div>
  <div class="hint" id="oHint">${E.ORIGINS['普通家庭'].desc}</div>
  <div class="frow"><label>城市</label><div class="segs" id="sCity">${seg(Object.keys(E.CITIES), '新一线')}</div></div>
  <div class="hint" id="cHint">${E.CITIES['新一线'].desc}</div>
  <div class="frow"><label>赛道</label><div class="segs wrap" id="sTrack">${seg(Object.keys(E.TRACKS), '创作')}</div></div>
  <div class="frow col"><label>你想干成的事</label><input id="sIdeal" maxlength="30" placeholder="${E.TRACKS['创作'].ph}"/></div>
  <div class="frow"><label>口径</label><div class="segs" id="sFree">${seg(Object.keys(E.FREEDOM), '都市传奇')}</div></div>
  <div class="hint">${esc('写实人生最难，心想事成最松，随时可以在设置里改')}</div>
  <div class="btns"><button class="ghost" onclick="openSettings()">接口设置</button><button class="primary" id="startGo">开始</button></div>`;
  bindSeg('sOrigin', v => $('oHint').textContent = E.ORIGINS[v].desc);
  bindSeg('sCity', v => $('cHint').textContent = E.CITIES[v].desc);
  bindSeg('sTrack', v => $('sIdeal').placeholder = E.TRACKS[v].ph);
  bindSeg('sGender'); bindSeg('sFree');
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
    S.player.job = d.job || S.player.job;
    S.place = d.place || '';
    S.ideal.stages = E.normLadder(d.ladder);
    S.peers = (d.peers || []).slice(0, 6).map(p => ({ name: String(p.name || '').slice(0, 8), note: String(p.note || '').slice(0, 30), track: [] }));
    E.applyTurn(S, { newNpcs: d.npcs, messages: d.messages, scene: d.scene, summary: d.summary, narrative: d.narrative });
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
  $('panel').classList.add('on');
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  renderPanel();
}
function closePanel() { curTab = ''; $('panel').classList.remove('on'); document.querySelectorAll('.tab').forEach(x => x.classList.remove('on')); }

function renderPanel() {
  if (!S || !curTab) return;
  const box = $('panelBody');
  const p = S.player, L = S.ledger;
  if (curTab === 'today') {
    const t1 = S.schedule.work, t2 = S.schedule.rest;
    box.innerHTML = `<h3>今天</h3>
    <div class="card"><div class="cardhd">${esc(E.dateStr(S.date))}</div>
      <div class="lines">${E.todayPlan(S).map(x => `<div><b>${x.slot}</b><span>${x.act}</span></div>`).join('')}</div></div>
    <h4>作息</h4>
    <div class="card">${schedTable('work', '工作日', t1)}${schedTable('rest', '周末', t2)}
      <div class="tip">改了马上生效。四个时段全排满事情，精力会掉得很快。</div></div>
    ${S.focus ? `<h4>正在闷头做的事</h4><div class="card"><b>${esc(S.focus.what)}</b><div class="tip">还剩 ${S.focus.left} 天，已经攒了 ${Math.round(S.focus.progress)}</div></div>` : ''}
    <h4>约好的事</h4><div class="card">${S.appts.filter(a => !a.done).map(a => `<div class="li"><span>${a.m}月${a.d}日</span> ${esc(a.title)}</div>`).join('') || '<div class="tip">没有</div>'}</div>
    <h4>停下来的条件</h4><div class="card"><div class="frow"><label>存够</label><input id="stopMoney" type="number" placeholder="${S.stopWhen && S.stopWhen.type === 'money' ? S.stopWhen.n : '比如 50000'}"/><button class="ghost sm" onclick="setStopMoney()">记上</button></div></div>`;
    E.SLOTS.forEach(sl => {
      ['work', 'rest'].forEach(k => {
        const el = $(`sc_${k}_${sl}`);
        if (el) el.onchange = () => { S.schedule[k][sl] = el.value; saveGame(); renderPanel(); rebuildTop(); };
      });
    });
  } else if (curTab === 'msg') {
    const threads = {};
    for (const m of S.msgs) {
      const k = m.from;
      if (!threads[k]) threads[k] = { from: k, last: m, n: 0, unread: 0, kind: m.kind };
      threads[k].last = m; threads[k].n++;
      if (!m.read) threads[k].unread++;
    }
    const list = Object.values(threads).sort((a, b) => S.msgs.lastIndexOf(b.last) - S.msgs.lastIndexOf(a.last));
    box.innerHTML = `<h3>消息</h3>` + (list.length
      ? `<div class="msgs">${list.map(t => {
          const n = S.npcs.find(x => x.name === t.from);
          return `<div class="thread" onclick="openThread('${esc(t.from)}')">
            <div class="mfrom">${esc(t.from)}${n ? `<em>${relWord(n.rel, n.tie)}</em>` : t.kind === 'peer' ? '<em>同期</em>' : ''}<span>${esc(t.last.date)}${t.unread ? ' <i class="dot"></i>' : ''}</span></div>
            <div class="mtext one">${esc(t.last.text)}</div></div>`;
        }).join('')}</div>`
      : '<div class="card tip">还没有消息</div>')
      + `<h4>认识的人</h4><div class="card">${S.npcs.length ? S.npcs.slice().sort((a,b)=>b.rel-a.rel).map(n => {
          const gap = S.stats.days - (n.lastSeen || 0);
          return `<div class="li" onclick="showNpc('${esc(n.name)}')"><b>${esc(n.name)}</b> <span class="rel${n.rel < 12 ? ' bad' : ''}">${relWord(n.rel, n.tie)}</span>
            <div class="tip">${esc(n.job || '')}${n.tie ? '｜' + esc(n.tie) : ''}${gap >= 20 ? `｜<u>${gap}天没联系了</u>` : ''}</div></div>`;
        }).join('') : '<div class="tip">还没认识谁</div>'}</div>
      <h4>同期的人</h4><div class="card">${S.peers.map(pr => `<div class="li"><b>${esc(pr.name)}</b><div class="tip">${esc(pr.note || '')}${(pr.track || []).length ? '　→　' + esc((pr.track || []).slice(-3).join('　→　')) : ''}</div></div>`).join('') || '<div class="tip">无</div>'}</div>`;
  } else if (curTab === 'ideal') {
    box.innerHTML = renderLadder();
  } else if (curTab === 'book') {
    const out = L.rent + L.living + L.remit, inc = L.salary + L.subsidy;
    box.innerHTML = `<h3>账本</h3>
    <div class="card"><div class="big${p.money < 0 ? ' bad' : ''}">¥${p.money.toLocaleString('zh-CN')}</div><div class="tip">存款</div></div>
    <div class="card"><div class="lines">
      <div><b>每月进</b><span>${inc}</span></div>
      <div><b>工资（${L.salaryDay}号）</b><span>${L.salary}</span></div>
      ${L.subsidy ? `<div><b>家里给</b><span>${L.subsidy}</span></div>` : ''}
      <div><b>每月出</b><span>${out}</span></div>
      <div><b>房租（${L.rentDay}号）</b><span>${L.rent}</span></div>
      <div><b>生活</b><span>${L.living}</span></div>
      ${L.remit ? `<div><b>寄回家</b><span>${L.remit}</span></div>` : ''}
      <div class="sum"><b>一个月剩</b><span class="${inc - out < 0 ? 'bad' : 'good'}">${inc - out}</span></div>
    </div></div>
    <h4>欠的钱</h4>
    <div class="card">${(S.debts || []).length
      ? S.debts.map((d, i) => `<div class="li"><b>${esc(d.who)}</b> <span class="rel${d.late ? ' bad' : ''}">${d.left}元${d.late ? '·过期了' : ''}</span>
          <div class="tip">${d.due.m}月${d.due.d}日之前要还　<button class="ghost sm" onclick="doPay(${i})">还一笔</button></div></div>`).join('')
      : '<div class="tip">没欠谁的</div>'}
      <div class="btns"><button class="ghost" onclick="openBorrow()">找人借钱</button></div></div>
    <div class="card tip">${S.broke ? '账上已经是负的了，做什么都差一口气。' : `按这个过法，${inc - out > 0 ? `一个月能剩 ${inc - out}` : '每个月都在倒贴'}。`}</div>`;
  } else if (curTab === 'me') {
    box.innerHTML = `<h3>我</h3>
    <div class="card"><div class="big">${esc(p.name)}</div><div class="tip">${p.gender}｜${p.age}岁｜${esc(S.city)}｜${esc(p.job)}</div></div>
    <div class="card"><div class="lines">${E.ATTRS.map(a => `<div><b>${a}${a === '专业' ? `（${esc(p.skillName)}）` : ''}</b><span>${p.attrs[a]}</span></div>`).join('')}
      <div><b>精力</b><span>${p.energy}${E.energyCap(S) < 100 ? ` / 上限${E.energyCap(S)}` : ''}</span></div>
      <div><b>行业口碑</b><span>${p.信誉}</span></div>
      <div><b>做人</b><span>${p.人品}</span></div>
      <div><b>干了多久</b><span>${workedText(p.资历天 || 0)}</span></div>
    </div></div>
    <h4>饭碗</h4>
    <div class="card">${S.job.out
      ? `<div class="big bad">没有工作</div><div class="tip">${S.job.was ? `从${esc(S.job.was)}出来之后` : ''}没有工资进账，房租和生活费照扣。</div>
         <div class="btns"><button class="ghost" onclick="askJob()">去面一场</button></div>`
      : `<div class="lines">
          <div><b>单位</b><span>${esc(S.job.employer || '—')}</span></div>
          <div><b>职级</b><span>${E.LEVELS[E.num(S.job.lv)].t}${S.job.probation ? '（试用期）' : ''}</span></div>
          <div><b>月薪</b><span>${L.salary}</span></div>
          <div><b>下次考核</b><span>${E.nextReview(S)}天后</span></div>
        </div>
        <div class="cardhd" style="margin-top:10px">这个季度的绩效</div>
        <div class="bar"><div class="bar-in${S.job.perf > 45 ? ' good' : S.job.perf < 15 ? ' bad' : ''}" style="width:${Math.min(100, Math.round(S.job.perf / 70 * 100))}%"></div></div>
        <div class="tip">${Math.round(S.job.perf)}　作息里排「主业」才攒得上，晚上和深夜加班攒得更快，代价是精力。${S.job.mood < 0 ? '　上次被约谈过，这个季度要难一些。' : ''}</div>
        <div class="btns"><button class="ghost" onclick="askRaise()">谈加薪</button><button class="ghost" onclick="doQuit()">辞职</button></div>`}
    </div>
    ${S.lastReview ? `<div class="card tip">上次考核：${esc(S.lastReview.kind)}——${esc(S.lastReview.text)}</div>` : ''}
    <h4>身上的毛病</h4><div class="card">${S.status.length ? S.status.map(s => `<div class="li"><b>${esc(s.name)}</b><span class="rel">还有${s.days}天</span><div class="tip">${esc(s.desc)}</div></div>`).join('') : '<div class="tip">没有</div>'}
      ${S.chronic.length ? S.chronic.map(c => `<div class="li"><b>${esc(c.name)}</b><span class="rel${E.num(c.eased) ? '' : ' bad'}">${E.num(c.eased) ? '养得松了些' : '去不掉'}</span><div class="tip">${esc(c.desc)}｜压着精力上限，也压着判定</div></div>`).join('') : ''}</div>
    <h4>梁子</h4>
    <div class="card">${(S.rifts || []).filter(r => !r.done).length
      ? S.rifts.filter(r => !r.done).map(r => `<div class="li"><b>${esc(r.who)}</b>
          <span class="rel${r.heat >= 62 ? ' bad' : ''}">${r.heat >= 62 ? '快压不住了' : r.heat >= 35 ? '还没翻篇' : '快淡了'}</span>
          <div class="tip">${esc(r.kind)}｜${esc(r.reason)}｜从${esc(r.since)}起${r.came ? `｜找过你${r.came}回` : ''}</div></div>`).join('')
      : '<div class="tip">眼下没跟谁结梁子</div>'}
      <div class="tip">钱还上、话说开、事办了，梁子自己会凉；不管它就一天天热起来，热到头人家就找上门了。</div></div>
    <h4>这一路</h4><div class="card">${S.history.slice(-14).reverse().map(h => `<div class="li"><span>${esc(h.date)}</span> ${esc(h.summary)}</div>`).join('') || '<div class="tip">还没开始</div>'}</div>
    <div class="btns"><button class="ghost" onclick="exportBook()">导出全本</button><button class="ghost" onclick="openSettings()">设置</button></div>`;
  }
}
function workedText(d) {
  if (d < 60) return d + '天';
  if (d < 365) return Math.floor(d / 30) + '个月';
  return Math.floor(d / 365) + '年' + Math.floor((d % 365) / 30) + '个月';
}
function schedTable(k, lab, t) {
  return `<div class="sched"><div class="schedhd">${lab}</div>${E.SLOTS.map(sl => `<div class="schedrow"><span>${sl}</span>
    <select id="sc_${k}_${sl}">${Object.keys(E.ACTS).map(a => `<option${t[sl] === a ? ' selected' : ''}>${a}</option>`).join('')}</select></div>`).join('')}</div>`;
}
function setStopMoney() {
  const v = Number($('stopMoney').value);
  if (!v) { S.stopWhen = null; toast('取消了'); }
  else { S.stopWhen = { type: 'money', n: v }; toast(`存够${v}就停下来`); }
  saveGame(); renderPanel();
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
    : m.kind === 'job'
    ? `这是一场面试，主角眼下没有工作${S.job.was ? `（刚从${S.job.was}出来）` : ''}。对手是招人的那一方，给出公司叫什么、什么岗位、多少钱一个月（要跟他的资历和这座城市对得上）。`
    : `这关系到他理想路上的这一步：${m.title}${m.desc ? `（${m.desc}）` : ''}。`}

给出这场的对手和开场。要求：
- 对手是个具体的人，有名字、职位、一句让人能摸出他脾气的描述。不要写他属于哪一类，让玩家自己看出来。
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
${meta.kind === 'job' && res.result === '谈成' ? '- 这场是面试而且谈成了：必须把 newJob 填上（东家、职位、月薪、是否试用期），月薪要跟剧情里说的对得上。\n' : ''}${meta.kind === 'job' && res.result !== '谈成' ? '- 这场面试没成，不要安慰他，写他怎么走出那栋楼。\n' : ''}

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
    E.startKey(S, { scene: m.scene, name: o.name, type: o.type, note: o.note, hard, mileId: m.mileId, kind: m.kind, stake: m.gate || m.title });
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
    S.lastAction = null;
    S.lastOptions = d.options && d.options.length ? d.options : ['缓一缓', '接着往下做'];
    await finishChapter();
    rebuildTop();
    renderOptions(S.lastOptions);
    saveGame();
    if (res.mile) toast(`迈过去了：${res.mile}`);
    if (res.raise) toast(`月薪涨了${res.raise}`);
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
    <div class="tip" style="margin-top:-10px">${n.age ? n.age + '岁　' : ''}${esc(n.job || '')}　${esc(n.tie || '')}</div>
    <div class="card" style="margin-top:14px"><div class="lines">
      <div><b>关系</b><span class="${n.rel < 12 ? 'bad' : ''}">${relWord(n.rel, n.tie)}</span></div>
      <div><b>上次来往</b><span>${gap <= 0 ? '就这几天' : gap + '天前'}</span></div>
      ${n.care ? `<div><b>在意</b><span>${esc(n.care)}</span></div>` : ''}
    </div>${n.note ? `<div class="tip">${esc(n.note)}</div>` : ''}</div>
    ${(n.mem || []).length ? `<h4 style="margin-top:8px">你们之间</h4><div class="card">${n.mem.map(m => `<div class="li">${esc(m)}</div>`).join('')}</div>` : ''}
    <div class="btns"><button class="ghost" onclick="mask('npcMask',false)">关掉</button><button class="primary" onclick="mask('npcMask',false);openConvo('${esc(n.name)}')">找他聊聊</button></div>`;
  mask('npcMask', true);
}
function openThread(from) {
  for (const m of S.msgs) if (m.from === from) m.read = true;
  saveGame();
  const n = S.npcs.find(x => x.name === from);
  if (n) openConvo(from);
  else { renderPanel(); toast('这条不是能回的消息'); }
}

/* ---- 私聊 ---- */
function convoHead(n) {
  return `${worldRules()}

你现在扮演的是【${n.name}】，不是主角。只说${n.name}的话，一次一两句，像真人发微信或者当面讲话：短、有口语、可以答非所问、可以不接主角的话茬。
不许旁白，不许描写主角的动作和心理，不许替主角说话。不许说教，不许煽情。

【${n.name}是谁】${n.age ? n.age + '岁，' : ''}${n.job || '不详'}，跟主角是${n.tie}，眼下关系：${relWord(n.rel, n.tie)}（内部数值${Math.round(n.rel)}）${n.care ? `，他在意的是${n.care}` : ''}。${n.note || ''}
【你们之前的来往】${(n.mem || []).join('；') || '没什么特别的'}
【主角】${S.player.name}，${S.player.age}岁，${S.player.job}，眼下在${S.place || '外面'}。手头存款${S.player.money}元。
【最近发生的事】${String((S.recent[S.recent.length - 1] || {}).narrative || '').replace(/\s+/g, '').slice(0, 120)}……`;
}
function convoPrompt(n, say, judge) {
  const log = S.convo.lines.map(l => `${l.who === 'me' ? S.player.name : n.name}：${l.text}`).join('\n') || '（刚开口）';
  return `${convoHead(n)}

【到现在为止的对话】
${log}

${judge
    ? `【引擎判定（不可更改）】主角求的这件事：${judge.what}。${judge.attr}${judge.val}，掷骰${judge.roll}＝${judge.total}，难度${judge.need}，判定【${judge.success ? '答应' : '没答应'}】${judge.crit ? '（' + judge.crit + '）' : ''}。
这一轮写${n.name}的最终答复，必须照这个结果来。答应也可以有条件、有犹豫；不答应也可以留余地或者干脆拒绝，但不许含糊其辞糊弄过去。`
    : `【主角刚说的】${say}`}

只输出一个合法 JSON：
{"reply":"${n.name}这一轮说的话","mood":"他此刻什么状态（4字内）","rel":关系增减(-8到8的整数),"ask":${judge ? 'null' : 'null 或 {"what":"主角求的事","attr":"表达|情绪|谋划|专业","need":40到85,"money":如果是借钱就写数额否则0,"days":多少天内还}'},"end":对方想结束对话就true,"summary":"这次聊天到现在的一句话（20字内）"}`;
}

function openConvo(name) {
  const n = S.npcs.find(x => x.name === name);
  if (!n || busy) return;
  S.convo = { name, lines: [], turns: 0, summary: '', rel: 0 };
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
  $('chatName').textContent = n.name;
  $('chatSub').textContent = `${n.tie || ''}　${relWord(n.rel, n.tie)}${c.rel ? `（${c.rel > 0 ? '+' : ''}${c.rel}）` : ''}`;
  $('chatBody').innerHTML = c.lines.map(l =>
    l.who === 'sys'
      ? `<div class="sysline">${esc(l.text)}</div>`
      : `<div class="bub ${l.who === 'me' ? 'me' : 'ta'}">${esc(l.text)}${l.mood ? `<i>${esc(l.mood)}</i>` : ''}</div>`).join('')
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
function endConvo(goOn) {
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
  }
  const name = c.name, sum = c.summary;
  S.convo = null;
  $('chat').classList.remove('on');
  saveGame();
  rebuildTop();
  if (goOn && said.length) { S.lastAction = `刚跟${name}聊完（${sum || '说了会儿话'}），接着过日子`; runSegment(); }
}

/* ---- 饭碗与借钱 ---- */
function doQuit() {
  if (!confirm('辞了？下个月起没有工资，房租照交。')) return;
  const r = E.quitJob(S);
  if (!r) return;
  S.lastAction = '把辞职的事办了';
  saveGame();
  closePanel();
  toast(r.text);
  runSegment();
}
function doPay(i) {
  const d = (S.debts || [])[i];
  if (!d) return;
  const v = prompt(`还给${d.who}多少？（还欠 ${d.left}，手头 ${S.player.money}）`, String(Math.min(d.left, Math.max(0, S.player.money))));
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
        <span class="rel">${relWord(n.rel, n.tie)}</span><div class="tip">${esc(n.tie)}${n.job ? '｜' + esc(n.job) : ''}</div></div>`).join('')}</div>
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
  S.lastAction = heal ? `接下来这${days}天，先把身体养回来（${what}）` : `接下来这${days}天，闷头${what}`;
  saveGame();
  runSegment();
}

/* ================= 设置 / 存档 ================= */
function openSettings() {
  mask('setMask', true);
  $('cfgBase').value = cfg.base; $('cfgKey').value = cfg.key; $('cfgModel').value = cfg.model;
  $('cfgThink').value = cfg.think ? 'on' : 'off';
  document.querySelectorAll('#modelPick .seg').forEach(b => {
    b.classList.toggle('on', b.dataset.v === cfg.model);
    b.onclick = () => { $('cfgModel').value = b.dataset.v; document.querySelectorAll('#modelPick .seg').forEach(x => x.classList.toggle('on', x === b)); };
  });
  const fb = $('setFree');
  fb.innerHTML = seg(Object.keys(E.FREEDOM), S ? S.freedom : '都市传奇');
  bindSeg('setFree', v => { if (S) { S.freedom = v; saveGame(); toast('口径改成' + v); } });
  $('setFreeWrap').style.display = S ? '' : 'none';
}
function saveCfg() {
  cfg = {
    base: $('cfgBase').value.trim() || 'https://api.deepseek.com',
    key: $('cfgKey').value.trim(),
    model: $('cfgModel').value.trim() || 'deepseek-v4-flash',
    think: $('cfgThink').value === 'on'
  };
  localStorage.setItem(LS_CFG, JSON.stringify(cfg));
  mask('setMask', false);
  toast('记下了');
}
function saveGame() {
  if (!S) return;
  try { localStorage.setItem(LS_SAVE, JSON.stringify(S)); } catch (_) { }
}
function loadGame() {
  const raw = localStorage.getItem(LS_SAVE);
  if (!raw) return false;
  try { S = JSON.parse(raw); } catch (_) { return false; }
  if (!S || !S.player) return false;
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
function restart() {
  if (!confirm('重开一局？这一局的存档会没。')) return;
  localStorage.removeItem(LS_SAVE);
  if (S && S.runId) bookClear(S.runId).catch(() => { });
  S = null;
  $('story').innerHTML = '';
  mask('setMask', false);
  closePanel();
  renderStart();
  mask('startMask', true);
}
async function exportBook() {
  if (!S) return;
  let rows = [];
  try { rows = await bookAll(S.runId); } catch (_) { }
  const html = rows.length ? rows.map(r => r.html).join('') : S.chapters.join('');
  const div = document.createElement('div'); div.innerHTML = html;
  const out = [`# ${S.player.name}　${S.startDate.y}年—${S.date.y}年`, `> ${S.player.ideal}`, ''];
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
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => gotoTab(t.dataset.t));
  $('panelClose').onclick = closePanel;
  $('setSave').onclick = saveCfg;
  $('setClose').onclick = () => mask('setMask', false);
  $('setRestart').onclick = restart;
  $('fcGo').onclick = doFocus;
  $('fcClose').onclick = () => mask('focusMask', false);
  $('fcDays').oninput = () => $('fcDaysN').textContent = $('fcDays').value;
  $('topBtn').onclick = openSettings;
  $('keyEnd').onclick = keyFinish;
  $('chatSend').onclick = convoSend;
  $('chatIn').addEventListener('keydown', e => { if (e.key === 'Enter') convoSend(); });
  $('chatBack').onclick = () => endConvo(false);
  $('chatDone').onclick = () => endConvo(true);
  // 输入框拿到焦点时浏览器会把整个壳子顶上去，这里按回去
  $('app').addEventListener('scroll', () => { const a = $('app'); a.scrollTop = 0; a.scrollLeft = 0; }, { passive: true });
  window.addEventListener('pagehide', saveGame);
  window.addEventListener('beforeunload', saveGame);
  if (!loadGame()) { renderStart(); mask('startMask', true); }
}
boot();
