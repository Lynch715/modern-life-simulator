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
  document.documentElement.dataset.font = ['s', 'm', 'l', 'xl'].indexOf(cfg.font) >= 0 ? cfg.font : 'm';
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
// 网络断、接口忙（429/5xx）、传到一半断了：自己再试两次，别让玩家看见失败
async function callLLM(prompt, onPartial, opt) {
  const waits = [1500, 4000];
  for (let i = 0; ; i++) {
    try { return await callLLMOnce(prompt, onPartial, opt); }
    catch (e) {
      const m = String((e && e.message) || e);
      const transient = !(opt && opt.noRetry) && !/HTTP (400|401|402|403|404|422)|请先在设置/.test(m);
      if (!transient || i >= waits.length) throw e;
      if (typeof setBusy === 'function' && busy) setBusy(true, `接口没接住，第${i + 2}次再试……`);
      await new Promise(r => setTimeout(r, waits[i]));
    }
  }
}
async function callLLMOnce(prompt, onPartial, opt) {
  opt = opt || {};
  lastFinish = null;
  if (!cfg.key) { openSettings(); throw new Error('请先在设置里填密钥'); }
  const url = cfg.base.replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model: cfg.model || 'deepseek-v4-flash',
    messages: [{ role: 'system', content: opt.system || styleSystem() }, { role: 'user', content: prompt }],
    temperature: opt.temperature != null ? opt.temperature : 1.02,
    max_tokens: opt.maxTokens || 8000,
    stream: true,
    response_format: { type: 'json_object' }
  };
  if (/deepseek/i.test(body.model)) body.thinking = { type: cfg.think && !opt.noThink ? 'enabled' : 'disabled' };
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
  const body = b > 0 ? t.slice(0, b + 1) : t;
  try { return JSON.parse(body); } catch (_) { }
  try { return JSON.parse(fixQuotes(body)); } catch (_) { }
  return JSON.parse(repairJSON(fixQuotes(t)));
}
// 字符串里混进了没转义的英文双引号（对白常见）：后面不是 , } ] : 的，当成正文里的引号转义掉
function fixQuotes(t) {
  let out = '', inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr && c === '\\') { out += c + (t[i + 1] || ''); i++; continue; }
    if (c === '"') {
      if (!inStr) { inStr = true; out += c; continue; }
      let j = i + 1; while (j < t.length && /\s/.test(t[j])) j++;
      if (j >= t.length || /[,}\]:]/.test(t[j])) { inStr = false; out += c; }
      else out += '\\"';
      continue;
    }
    if (inStr && c === '\n') { out += '\\n'; continue; }
    out += c;
  }
  return out;
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
    // 正文已经写出来了：留下正文，别的字段算了，不整段重写
    const fixed = raw ? fixQuotes(raw) : '';
    const nar = fixed ? extractPartialField(fixed, 'narrative') : '';
    if (nar && nar.replace(/\s/g, '').length >= 30) {
      const keep = { narrative: nar };
      for (const k of ['summary', 'reply']) { const v = extractPartialField(fixed, k); if (v) keep[k] = v; }
      console.warn('格式不全，只留正文');
      return keep;
    }
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
    ✓ “没拍。”他把本子往前推了推，“写完了，二十分钟的。还没打印。”
- 对白一律用中文引号“”或「」，正文里不许出现英文双引号，否则整段会作废重写。
- 对白要像真人说话：短句、口语、半截话、答非所问、被打断、有停顿。不许每个人都说完整漂亮的长句，不许拿对白交代设定。
- 说话的人可以带一个很小的动作或语气（把手机扣在桌上、笑了一下、没接这句），但别在每句后面都缀一串形容。`;

/* ---- 文风：只管正文怎么写；聊天、朋友圈、消息不套 ---- */
const STYLE_COMMON = `你是一个中文现代生活模拟游戏的叙事引擎。你只负责把引擎给定的结果写成故事，不负责决定成败。

不管哪种文风都要守的：
- 引擎给的结果、钱数、日期、身体状况照写，文风只管怎么写，不管写什么。
- 不许写"他终于明白了""这一刻他忽然懂得""生活就是这样"之类的感悟句，不许总结升华，尤其不许拿它收尾。
- 不出现真实存在的公司、平台、品牌、真人姓名，用虚构的名字。
- 下面说的是一种写法的技巧，不是让你抄谁：不许照搬任何作家原作里的句子、人物名、地名、口头禅，也不许在文中提到这位作家。
- 微信消息要像真的微信：短、有语气词、有错字也行、有人发两条、有人只回一个字——不管正文用什么文风，消息、朋友圈都是人物自己在说话。`;
const STYLES = {
  '白描': { note: '短句，名词具体，不抒情，不升华。',
    rule: `【文风·白描】
- 像一个会写小说的人在写一个具体的人过的具体日子。名词要具体：几路公交、几块钱的面、几层的办公楼、几点几分的消息。
- 人说话就是人说话：有口语、有废话、会打断、会答非所问、会说一半不说了。
- 不许排比句，不许"不是……而是……"的句式堆叠，不许成语连用。
- 不许每段都用天色、窗外、灯光收尾。写失败和难堪时不要找补，写顺利时不要煽情。` },
  '余华': { note: '冷，短，同一个动作反复出现；越苦的事写得越平静，带点黑色幽默。',
    rule: `【文风·冷静的重复】
- 句子短，叙述冷静，几乎不用形容词，情绪一个字都不直接写。
- 越是难堪、倒霉、疼的事，越要写得平平淡淡，像在说吃了一碗面；荒唐处让人想笑又笑不出来。
- 用重复：同一个动作、同一句话、同一个数字，在这一段里出现两三次，每次只变一点点。
- 人物说话简单直接，常常答非所问或者说得一本正经地荒唐；用"他想了想，觉得也是"这类憨直的逻辑往下推。
- 不渲染环境，不写比喻，或者只写最土最朴素的比喻。` },
  '莫言': { note: '气味颜色声音都浓，长句一层层铺；比喻夸张，往土里、往身体上落。',
    rule: `【文风·浓烈的感官】
- 气味、颜色、声音、身体的感觉要写得浓、写得满，一样东西要让人闻得到、看得见、摸得着。
- 长句一层层往下铺，逗号连着逗号，一口气写下去；中间可以夹短促的一句断开。
- 比喻夸张、大胆、往土里和身体上落：拿吃的、牲口、庄稼、泥土、汗、血来比城里的事，越不搭越好。
- 叙述可以夹民间口语、俗话、骂人话，带一股野气；可以有一点点超出常理的夸张（声音震得墙皮掉、汗流成河），但事情本身照引擎给的写。
- 允许排比和铺陈，但对白仍是人的口语。` },
  '刘震云': { note: '一件事套一件事，一句话顶一句话地绕；把人和人的拧巴绕出来，冷着脸说笑话。',
    rule: `【文风·绕】
- 叙述爱绕：一件事背后还有一件事，这件事又是因为另一个人的另一件事。"本来是件简单的事，但……不光是……"这样一层层剥开。
- 爱讲道理，讲的却是拧巴的道理：一个说的是这个，一个说的是那个，两人说的都是一回事，又都不是一回事。
- 句子平实，重复关键词，像在跟人掰扯；语气冷，事情荒唐，作者从不笑。
- 人说话也绕，一句话里藏着另一句话，谁也不把话说透。
- 不写景，不抒情，只写人和人之间的账。` },
  '王朔': { note: '京味贫嘴，满嘴俏皮话，没正形；什么正经事都拿来调侃。',
    rule: `【文风·贫嘴】
- 叙述和对白都贫：俏皮话、反话、抬杠、拿大词说小事、拿正经话说不正经的事，一本正经地胡说八道。
- 节奏快，对白多，人物互相挤兑、互相拆台，谁都不肯好好说话；叙述人也跟着耍贫，对主角也不客气。
- 口语化，北方口语味，可以用"丫""得嘞""您受累"之类的口头词，但别堆砌方言。
- 底子是混不吝，但贫嘴底下要有一点实在的东西：钱的窟窿、面子、怕。
- 不煽情，正经时刻也用一句玩笑岔过去。` },
  '张爱玲': { note: '冷眼、刻薄、精致；写人心里那点算计，比喻又新又冷。',
    rule: `【文风·冷眼】
- 叙述精致、冷，带着看透的刻薄：写人心里那点算计、体面、虚荣、自欺，一针见血又不动声色。
- 比喻新奇、冷、出人意料，常拿衣料、颜色、器物、光线来比人和人的关系。
- 细节写衣着、房间的陈设、颜色、光，借物写人；一句漂亮的、凉薄的判断可以落在段中，但不许落在段尾升华。
- 对白照样要有，句子短，每句都暗藏机锋，话里有话，彼此试探。
- 写城市的现代生活也照样冷眼，写出体面底下的寒酸。` },
  '网文': { note: '都市爽文腔：一两句一段，节奏快，心里话多，旁人震惊，段尾留钩子。成败照引擎，输了就写憋屈和不服。',
    rule: `【文风·都市网文】
- 段落短，一两句一段，经常一句话单独成段制造停顿；节奏快，不在景物上停留。
- 主角心里话多、外露（照上面定的人称写：第二人称就是"你心里冷笑""你眯了眯眼"）；情绪直给，憋屈就是憋屈，痛快就是痛快。
- 配角反应写足：有人看不起主角、有人震惊、有人后悔，"周围几个人都愣住了"这种旁观者镜头要有。
- 有好事时写出打脸和反转的爽感；引擎判了失败，就写憋屈、隐忍、记下这笔账，不许写成赢了。
- 段尾留一个钩子：一条消息、一个人出现、一句没说完的话，让人想看下一段。钩子是悬念，不是感悟。
- 可以用适量网络口语，但别满篇"卧槽""牛逼"。` },
  '金庸': { note: '叙述用章回江湖腔，写的却是房租加班相亲；对白保持现代口语，靠反差出效果。',
    rule: `【文风·江湖说书】
- 叙述用说书人的江湖腔、半文半白：「这一日」「只见」「但见」「原来」「当下」「心中暗叫」「却说」，写得像武侠小说的章节。
- 写的是现代生活里的事：房租、加班、相亲、地铁、外卖，拿江湖的气派写出来——收租的是"一方豪强"，开会像"群雄聚首"，谈判像"过招"，但别真打起来，也别出现武功。
- 人物出场交代来历、给个外号（自己编，别用任何武侠小说里的人名和外号）。
- **对白保持现代人说话**，该怎么说就怎么说，跟叙述的江湖腔形成反差。
- 动作写得干脆、有招式感；心理用"心中暗想""暗叫不好"这类说法。` }
};
function styleOf() { const k = S && S.style; return STYLES[k] ? k : '白描'; }
// 写故事的每一种请求都用这一份系统提示；按「越不变越靠前」排，接口的前缀缓存才吃得上
const styleSystem = () => `${PERSON()}
${SAY_RULE}

${STYLE_COMMON}

${STYLES[styleOf()].rule}

${WORLD_FIXED}

${LIFE_FIXED}

${(E.FREEDOM[S && S.freedom] || E.FREEDOM['都市传奇']).tone}

${NARR_COMMON()}`;
const WORLD_FIXED = `【世界观】当代中国都市，一切公司、平台、店铺、小区都是虚构的名字。主角从刚出校门那年开始，一年年往下过，眼下多大看【主角眼下】。
这是一个普通人怎么把自己想干的事一点点干起来，以及为此付出什么。日子好走还是难走，照【本局口径】；怎么写，照【文风】。

【铁律】
- 引擎的判定结果不可更改：成就是成，败就是败，钱的加减、身体的毛病、日期的推移，都必须照引擎给的写。
- 你不能宣布主角达成了理想的里程碑，那由引擎裁定。你只能把过程写出来，并在 milestoneClaim 里申报。
- 新出现的人要有来由，但生活里本来就会有人主动找上门：老同学的电话、中介的骚扰、前同事拉你入伙、家里催你，都不必事先铺垫。
- 钱要具体到数。时间要具体到日子。`;
// 每一段都要做到的、跟这一段写什么无关的要求，和返回格式

// 关系五档的态度：私聊和写故事共用，一字不变
const TIER_ATTITUDE = `【关系五档，决定人家怎么对主角】（家里人叫法不同，档位照样算）
- 生分：客气，回得慢，话短，不接私事，不借钱。
- 点头之交：礼貌，事说完就散。
- 熟人：正常来往，肯帮小忙。
- 朋友：开玩笑、吐槽、主动讲自己的事、问主角近况。
- 交心：不客气，说狠话也说真话，记得主角上回说过的话、会追问，肯帮大忙。`;
const LIFE_FIXED = `【日子里的规矩（账是引擎管的，你照写）】
- 住处分四档：城中村单间（便宜、乱、离上班远）、合租次卧（跟生人合租，厨房厕所共用）、单身公寓（一个人住、安静、能带人回来）、整租一居（一室一厅、体面、伴侣能一起住）。主角住哪一档看【家】，写住的地方要对得上；搬家只走引擎。
- 兼职看【兼职】：做什么、哪天哪个时段。写到那个时段就写他在干这个；钱引擎每周记，正文和 playerChanges 不另给。
- 东西看【手里的东西】：有的才能用、能提；没有的不许让主角凭空拿出来。买东西、送东西都要经过引擎，playerChanges 和正文里不许另给主角添物件、添收入。
- 存款、理财、贷款看【银行】，数目照引擎写：不许凭空给主角利息和收益，不许让主角凭一句话就贷到钱；银行的事只走引擎。
- 看电影、KTV、健身、酒吧、旅行这类乐子，引擎已经算过花销、精力和谁一起去，你只写过程。
- 每个人有自己的日子（【用得上的人】里写了他最近在忙什么），出场时带出他自己的事，别只围着主角转。
${TIER_ATTITUDE}`;
// 聊天、群、朋友圈：人物自己说话，不套文风
const CHAT_SYSTEM = `你在一个中文现代生活模拟游戏里扮演主角手机上的联系人。像真人发微信、真人当面说话：短、口语、有语气词，可以答非所问。不许旁白，不许升华，不许说教。不出现真实存在的公司、品牌、真人姓名。`;
// 私聊专用：规矩和返回格式放系统提示，每轮一字不差，后面的对话记录只往后加，缓存能吃满
const CONVO_SYSTEM = CHAT_SYSTEM + `

你扮演的是下面写明的那个人，不是主角。只说他的话，像真人发微信：一次发 1 到 3 条，每条都短，有口语，可以答非所问、可以不接主角的话茬。该一条就一条，别硬凑三条。
不许旁白，不许描写主角的动作和心理，不许替主角说话。不许说教，不许煽情。

怎么回：
- 只接主角最后发的那句。他问什么就答什么，他说什么就接什么；上文只用来让你的话前后对得上，不许回头去接很早以前的话茬，除非主角刚好提到。
- 这次对话里你已经说过的意思和句子不许再说一遍。
- 就算你不想聊了，主角发来的话也照样回，可以冷淡、敷衍、只回一两个字，但得是对这句的回应。
- 你记得以前跟主角的来往和说定的事，对得上就自然带出来，别装不知道。
- 说话照【他的说话习惯】来，一直是这个味儿，别聊着聊着变成另一个人。
- 你有自己的日子（【他最近在忙】）。聊天里会带出自己的事、自己的情绪，不是只围着主角转。
- 对主角的态度照你们眼下的关系档（见下面五档），档位不到的事不做。
- 主角送你东西时，引擎已经算好你心里怎么想（合不合心意、贵不贵重、收不收），照它回。
- 主角给你转账、发红包，要对这笔钱有反应：收下、道谢、嘴上推两句、或者真不要退回去（refund 填 true），看你们的关系和你的性子。
- 你真要给主角钱（借他、给他、发红包、还他钱）时才填 pay，数目要跟你的身份和家底对得上。
- ask：只有主角在最后那句里明确开口求你帮忙才填；你求主角的事不算，主角答应不答应由他自己说。给了【引擎判定】的那一轮，ask 填 null，答复必须照判定结果来：答应也可以有条件、有犹豫；不答应也可以留余地或者干脆拒绝，但不许含糊其辞。
- deal：只有这一轮真说定了事才写，没有就空数组。

${TIER_ATTITUDE}

只输出一个合法 JSON：
{"reply":["你这一轮发的第一条","第二条（没有就别写）","第三条（没有就别写）"],"mood":"你此刻什么状态（4字内）","rel":关系增减(-3到3的整数),
"gist":"这次对话从头到现在的要点，按先后，60字内；说定的事、提过的请求、吵过的架都要留着",
"ask":null 或 {"what":"主角求的事","kind":"borrow（借钱）|interview（帮忙约面试、推工作）|intro（介绍人）|favor（别的忙）","attr":"表达|情绪|谋划|专业","need":40到85,"money":借钱就写数额否则0,"days":借钱写多少天内还，帮忙写几天内办},
"deal":[{"kind":"主角答应|对方答应|主角拒绝","what":"这一来一回里说定或回绝的具体事（20字内）","inDays":几天内办，没期限填0}],
"pay":null或{"kind":"转账|红包","amount":数额,"note":"附言"},"refund":主角刚给你的钱你退回去就true,
"cold":你不想再聊了就true,"summary":"一句话（20字内）",
"quick":["主角接下来可能回你的三句话，每句14字内，口吻像主角，三句意思各不一样（一句顺着、一句岔开或追问、一句冷一点）"]}`;

// 每次写故事的请求最后都贴这一段：系统提示里的规矩模型容易读着读着就忘，最后再压一遍
function finalCheck(extra) {
  return `【交稿前逐条对一遍，有一条不对就改了再交】
1. 上面【引擎已经结算】【本段引擎判定】【最终结果】里写的成败、钱数、日期、身体状况，正文一个字都不许改，不许把失败写成成功，也不许把成功写成"差一点"。
2. 钱的数目照引擎给的写；playerChanges 只写这一段另外的零碎增减。
3. ${cfg.person === 'ta' ? '通篇第三人称' : '通篇用"你"称呼主角'}；有人出场就有直接对白，用中文引号，不许转述。
4. 文风照系统说明里的【文风】写；不许感悟、不许升华、不许拿感慨收尾。
5. 玩家括号里的限制和要求照办；玩家没让你替他做的决定，不许替他做。
6. 不许替引擎宣布里程碑达成；不许跳过时间。
7. 人物照【人物名册】写：名字一字不差，性别、年龄、跟主角的关系、干什么的、要一直记着的事都不许写错；名册里有的人是老相识，不许写成初次见面；名册里没有的人才算新登场，要写进 newNpcs。出场和被提到的已有人物，每人在 npcUpdates 里写一条 mem。${extra ? '\n' + extra : ''}
8. 住处、兼职、手里的东西、银行里的钱照【家】【兼职】【手里的东西】【银行】写：不许凭空给主角添东西、换住处、加兼职收入，买东西、送东西只认引擎结算的。
9. 只输出一个合法 JSON，字段照系统说明里的格式，不要任何别的字。`;
}
function NARR_COMMON() {
  return `【每一段都要做到的】
- 手机消息写进 messages，1-3 条，短。
- moments 写 0-2 条朋友圈：发的人得是【认识的人】里已有的某位，内容是他自己的日子（加班、吃饭、孩子、抱怨天气、转发一句什么），不必跟主角有关，也不许全是好事，像真人一样。
- 数值变化写进 playerChanges，全部是增减量。钱要具体。身体出问题写 statusAdd。
- 新出现的人写 newNpcs（最多2人）。**这一段里出场、被提到、或者跟主角有来往的每一个已有人物，都要在 npcUpdates 里写一条 mem**，写具体的事，以后他会凭这个记得主角干过什么。
- 这一段里主角跟谁发生了关系（双方都是成年人），就在那个人的 npcUpdates（新认识的写在 newNpcs）里写 intimate:true，没有就写 false。正文点到为止，不写露骨细节。
- 主角这一段要是得罪了谁、坑了谁、欠了谁没还，写进 newRifts；把梁子解开了（道歉认了、钱还了、事办了）写进 riftEased。别滥用，一段最多一条。
- 这一段里谁答应了谁什么、主角回绝了什么，写进 pledges；【答应过的事】里这一段办掉的，写进 pledgeDone。
- 志业阶梯上这一步，只有引擎能宣布迈过去。你觉得主角够格冲了，就把里程碑标题写进 milestoneClaim，由引擎裁定；不许在剧情里直接写成办成了。
- 除非主角死亡或玩家要求收尾，gameOver 必须是 false。
- 只输出一个合法 JSON，不要任何别的字。下面另给了格式的（开局、年终、结局、关键局开场），照下面给的；没另给的，一律用这个格式：
${SCHEMA}`;
}
// 系统提示里已经有世界观和规矩了；这里只给聊天类请求一句短的
function worldRules(chat) {
  if (!chat) return '';
  return `【世界观】当代中国都市，公司、平台、店铺、小区都是虚构的名字。主角${S.player.name}刚出校门几年，在一座城市里从零开始过日子。`;
}

const SCHEMA = `{"narrative":"这一段的叙事","summary":"一句话概括（25字内）",
"scene":{"location":"这段结束时主角人在哪","unresolved":["眼下真正悬着且主角打算管的事，至多4条"]},
"resolvedInfo":["本段了结或放下的事，原样照抄未了之事里的那句"],
"check":null或{"type":"判定名","attr":"属性","need":70,"success":true},
"playerChanges":{"attributes":{"专业":0,"表达":0,"谋划":0,"情绪":0,"体能":0},"energy":0,"money":0,"信誉":0,"人品":0,"idealProgress":0,"job":null,"salary":null,
  "statusAdd":[{"name":"毛病名(4字内)","desc":"一句话","days":几天好}],"statusRemove":["毛病名"],"chronicAdd":[{"name":"","desc":""}]},
"npcUpdates":[{"name":"【人物名册】里的名字，一字不差","rel":0,"tie":"关系变了才写（同事→恋人），否则 null","mem":"这一段他跟主角之间具体发生了什么（谁做了什么、说了什么、钱物往来），30字内，他以后会记得","fact":"他身上从此要一直记着的事（离了婚、成了你前任、搬去外地、生了孩子），没有就 null","job":null,"age":0,"gender":null,"note":null,"intimate":false}]（job/age/gender/note 只在名册里这一项还空着时补，已有的不许改）,
"newNpcs":[{"name":"","age":0,"gender":"男或女，拿不准留空","job":"","intimate":false,"tie":"主角手机里给他存的称呼，一个词，像妈妈、房东、老板、表姐、室友、大学同学；不要写母子、雇主、熟人这种关系词","care":"他在意什么","note":"一句话的人","rel":20,"close":false}],
"messages":[{"from":"发消息的人：写【认识的人】里的名字，不要写妈妈、房东这种称呼","text":"手机上收到的一条消息，像真的微信","pay":null或{"kind":"转账|红包","amount":数额,"note":"附言"}（这人真给主角打钱时才填，数目对得上他的家底）}],
"moments":[{"who":"发朋友圈的人（认识的人里的某个）","text":"他发的动态，二十字左右，是他自己的生活，不必跟主角有关","likes":["点赞的人，只能是【认识的人】里跟他也认识的"],"cs":[{"who":"底下留言的人（【认识的人】里跟他也认识的，不能是主角）","to":"回复谁，没有就空","text":"留言，十五字内"}]}],
"appointments":[{"title":"这一段里新约下的事（【约好的事】里已经有的、刚办完的，不要再写）","inDays":3,"kind":"约"}],
"milestoneClaim":[],
"together":"这一段里主角跟谁明确确定了恋爱关系（说开了、答应了、在一起了）就写那人名字，没有就写空字符串",
"newRifts":[{"who":"跟主角结下梁子的人","reason":"为什么","kind":"债主|前东家|竞对|私怨|甲方","heat":20}],
"riftEased":["这一段里主角把梁子解开了的人名"],
"newJob":null或{"employer":"新东家名字","title":"岗位（干什么的，比如「编辑助理」「后厨」「客户经理」）","salary":月薪数字,"lv":0到5的职级,"probation":是否试用期},
"options":["四个下一步的行动，每条12字内，具体、可执行、互相不同"],
"pledges":[{"who":"人名","what":"答应或回绝的具体事（20字内）","kind":"主角答应|对方答应|主角拒绝","inDays":几天内要办，没期限填0}],
"pledgeDone":["【答应过的事】里这一段办掉了的，照抄原话"],
"nextStop":null或{"type":"npc","who":"人名"}（主角托了人、正在等那人回话时才填）,
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

// 这一段要带给模型的人：玩家点名的、要去见的、最近剧情里在场的排前面，剩下按最近来往补满
// 人物名册：所有认识的人，按认识先后排，身份写死在这儿，模型不许改、不许混
function rosterBlock() {
  if (!S.npcs.length) return '【人物名册】（还没认识什么人）';
  return `【人物名册（主角认识的所有人，按认识先后；身份、性别、年龄、关系以这里为准，不许改，不许把两个人当成一个，不许让已经认识的人重新认识主角）】
${S.npcs.slice(0, 80).map(n => {
    const age = n.age ? `${n.age + (S.date.y - (n.ageY || S.date.y))}岁` : '年龄未定';
    const bits = [n.gender || '性别未定', age, callName(n) || n.tie || '关系未定', n.job || '干什么的未定'].join('｜');
    return `- ${n.name}：${bits}${n.note ? '｜' + n.note : ''}${(n.facts || []).length ? `｜要一直记着：${n.facts.join('；')}` : ''}`;
  }).join('\n')}`;
}
// 前几年的年终小结：很少变，放前面
function yearsBlock() {
  const Y = (S.years || []).filter(y => y.summary);
  return Y.length ? `【前几年】${Y.map(y => `${y.y}年：${y.summary}`).join('；')}\n` : '';
}
function pickNpcs(max) {
  const act = String(S.lastAction || '');
  const want = new Set(((S.plan && S.plan.steps) || []).map(x => x.who).filter(Boolean).map(w => E.whoIs(S, w)));
  const near = S.recent.slice(-2).map(r => r.narrative || '').join('') + (S.unresolved || []).join('');
  const tier = n => {
    const call = callName(n);
    if (want.has(n.name) || act.indexOf(n.name) >= 0 || (call && act.indexOf(call) >= 0) || (call && call.length >= 2 && act.indexOf(call.slice(0, 1)) >= 0 && /^(妈妈|爸爸)$/.test(call))) return 0;
    if (near.indexOf(n.name) >= 0) return 1;
    // 欠着钱、有梁子、有约、说定了事、是伴侣的人，哪怕这几天没露面也得带上
    const P = E.partnerOf(S);
    if ((P && P.name === n.name) || (S.debts || []).some(d => d.who === n.name && d.left > 0) || (S.rifts || []).some(r => r.who === n.name && !r.done)
      || (S.pledges || []).some(p => !p.done && p.who === n.name) || (S.appts || []).some(a => !a.done && String(a.title).indexOf(n.name) >= 0)) return 1;
    return 2;
  };
  return S.npcs.map((n, i) => ({ n, i, t: tier(n) }))
    .sort((a, b) => a.t - b.t || (b.n.lastSeen || 0) - (a.n.lastSeen || 0) || b.i - a.i)
    .slice(0, max || 14).map(x => x.n);
}
function pledgeLine(p) {
  const head = p.kind === '主角答应' ? `主角答应${p.who}` : p.kind === '对方答应' ? `${p.who}答应主角` : `主角回绝了${p.who}`;
  return `${p.made}，${head}：${p.what}${p.due ? `（${p.due.m}月${p.due.d}日前）` : ''}`;
}
function pledgeBlock() {
  const L = (S.pledges || []).filter(p => !p.done).slice(-8);
  return L.length ? `【答应过的事、回绝过的事（都还作数，人物要记得）】\n${L.map(pledgeLine).join('\n')}\n` : '';
}
function waitBlock() {
  const L = E.stopList(S);
  const ap = (S.appts || []).filter(a => !a.done).map(a => `${a.m}月${a.d}日：${a.title}`);
  const dn = (S.doneRecent || []).filter(x => S.stats.days - x.day <= 6).map(x => x.t);
  return (L.length ? `【主角在等的】${L.map(w => w.type === 'money' ? `存款到${w.n}` : w.type === 'npc' ? `${w.who}回话` : `${w.label || '到日子'}`).join('；')}\n` : '')
    + (ap.length ? `【约好的事（已经记着了，到日子引擎会提醒，不要再写进 appointments）】${ap.join('；')}\n` : '')
    + (dn.length ? `【这几天刚了结的事（办了、改期了或者没去，别再当成新约定）】${dn.join('；')}\n` : '');
}

// 最近几天跟主角有关的朋友圈：他发的、他留过言的、底下提到他的
function momentsBlock() {
  const me = S.player.name;
  const L = (S.moments || []).filter(m => S.stats.days - E.num(m.day) <= 5 &&
    (m.who === me || m.cs.some(c => c.who === me || c.to === me) || String(m.text).indexOf(me) >= 0)).slice(-5);
  if (!L.length) return '';
  return `【朋友圈近况（这几天跟主角有关的，剧情要接得上，碰上了可以自然带一句，别为了提它硬编情节）】\n${L.map(m =>
    `${m.date} ${m.who === me ? '主角' : m.who}发：「${m.text}」${m.cs.length ? `｜底下：${m.cs.slice(-6).map(c => `${c.who === me ? '主角' : c.who}${c.to ? '回复' + (c.to === me ? '主角' : c.to) : ''}：${c.text}`).join('；')}` : ''}`).join('\n')}\n`;
}
function stateBlocks() {
  const p = S.player, L = S.ledger;
  const M = memBlocks();
  const npc = pickNpcs(14).map(n => {
    E.fixNpcLife(S, n);
    return `${n.name}（眼下${relWord(n.rel, n.tie)}·${E.TIERS[E.relTier(n.rel)]}档${n.care ? '，在意' + n.care : ''}；最近${n.busy.t}）${(n.mem || []).slice(-4).join('；') || '还没什么来往'}`;
  }).join('\n') || '（还没认识什么人）';
  const peers = S.peers.map(pr => `${pr.name}：${(pr.track || []).slice(-2).join('，') || pr.note || '还是老样子'}（${E.peerWord(S, pr)}）`).join('\n') || '（无）';
  E.fixPace(S);
  const PC = E.PACES[S.pace];
  const pf = S.paceFrom && S.stats.days - S.paceFrom.day <= 14 ? `（${S.stats.days - S.paceFrom.day <= 1 ? '刚' : S.stats.days - S.paceFrom.day + '天前'}从「${S.paceFrom.name}」换成这样，这一段要让人看出日子的过法变了）` : '';
  const plan = `「${S.pace}」：${PC.story}${pf}`;
  const L2 = S.ledger;
  const home = (() => {
    const H = S.home || {}; const P = E.partnerOf(S); const kids = (S.family && S.family.kids || []).filter(k => !k.unborn);
    const a = [H.kind === '买' ? `有自己的房子（${H.loan && !H.loan.done ? `月供${H.loan.monthly}，还欠${H.loan.left}` : '贷款还清了'}）` : `租的是${E.homeTier(S)}（${E.HOUSING[E.homeTier(S)].desc}），房租${S.ledger.rent}${H.since ? `，${H.since}搬进来的` : ''}`];
    a.push(P ? `跟${P.name}${P.stage}${P.warm >= 60 ? '，还热乎' : P.warm >= 30 ? '，不咸不淡' : '，早淡了'}` : '一个人过');
    const lv = E.lovers(S);
    if (lv.length) a.push(`发生过关系的：${lv.map(n => `${n.name}（${P && P.name === n.name ? P.stage : callName(n) || '没名分'}，最近一次${n.intimate.last}）`).join('、')}`);
    if (kids.length) a.push(`孩子${kids.map(k => `${k.name}${k.age}岁`).join('、')}，每月养孩子${E.kidCost(S)}`);
    return a.join('；');
  })();
  const rifts = (S.rifts || []).filter(r => !r.done);
  // 顺序：几乎不变的 → 偶尔变的 → 每段都变的（日期放最后），接口的前缀缓存能多吃一截
  return `【主角】${p.name}，${p.gender}，${S.city}。${E.bgLine(p) ? E.bgLine(p) + '。' : ''}
【理想】${p.ideal}（赛道：${p.track}，看家本事叫「${p.skillName}」）${(E.TRACKS[p.track] || {}).rule ? `\n【这条路的规矩】${E.TRACKS[p.track].rule}` : ''}
${rosterBlock()}
${yearsBlock()}【家】${home}
【这阵子的重心】${plan}
【同期的人在做什么】
${peers}
【行业风向】${S.player.track}这行眼下${(S.wind && S.wind.mood) || '平'}${(S.era || []).length ? `；近来外面的事：${S.era.map(e => e.text).join('；')}` : ''}
【志业阶梯】${E.ladderBlock(S)}
【饭碗】${S.job.out ? `没有工作（${S.job.was ? '从' + S.job.was + '出来了' : '被放走了'}），已经没有工资进账` : `${S.job.employer || '眼下这家'}${S.job.post ? '，干的是' + S.job.post : ''}，职级${E.LEVELS[E.num(S.job.lv)].t}${S.job.probation ? '（还在试用期）' : ''}，${E.STRAIN[E.num(S.job.strain === undefined ? 1 : S.job.strain)]}活，这个季度的绩效${Math.round(S.job.perf)}，下次考核还有${E.nextReview(S)}天`}
${S.biz && !S.biz.dead ? `【自己的摊子】${S.biz.name}（${S.biz.kind}，开了${S.biz.months}个月），上月进${S.biz.rev}出${S.biz.cost}${S.biz.net >= 0 ? '剩' + S.biz.net : '亏' + (-S.biz.net)}，口碑${Math.round(S.biz.rep)}，人手${S.biz.staff.length}个${S.biz.staff.length ? `（${S.biz.staff.map(x => x.name + '·' + x.role).join('、')}）` : ''}${S.biz.lossMonths ? `，已连亏${S.biz.lossMonths}个月` : ''}\n` : ''}${rifts.length ? `【结下的梁子】${rifts.map(r => `${r.who}（${r.kind}）：${r.reason}${r.heat >= 62 ? '，眼看压不住了' : r.heat >= 35 ? '，还没翻篇' : '，快淡了'}${r.came ? `，已经找过${r.came}回` : ''}`).join('；')}\n` : ''}${(S.gigs || []).length ? `【兼职】${S.gigs.map(g => `${g.name}（${E.gigWhen(g.name)}）`).join('；')}\n` : ''}【手里的东西】${bagLine()}
【银行】${E.bankLine(S)}
${(S.debts || []).length ? `【欠的钱】${S.debts.map(d => `欠${d.who}${d.left}元（${d.due.m}月${d.due.d}日到期${d.late ? '，已经过期了' : ''}）`).join('；')}\n` : ''}【这一段多半用得上的人·最近的来往（他们记得这些，写的时候要对得上）】
${npc}
${pledgeBlock()}${waitBlock()}${momentsBlock()}【往事提要】
${M.sums}
【最近发生的】
${M.recents}
【未了的事】${S.unresolved.join('；') || '暂时没有'}
【主角眼下】${p.age}岁，营生：${p.job}｜属性 专业${p.attrs['专业']} 表达${p.attrs['表达']} 谋划${p.attrs['谋划']} 情绪${p.attrs['情绪']} 体能${p.attrs['体能']}｜精力${p.energy}｜身上的毛病：${S.status.map(s => `${s.name}（还有${s.days}天）`).join('、') || '没有'}${S.chronic.length ? `，去不掉的：${S.chronic.map(c => c.name).join('、')}` : ''}
【钱】存款${p.money}元，月薪${L2.salary}${L2.subsidy ? `，家里每月给${L2.subsidy}` : ''}，房租${L2.rent}，生活${L2.living}${L2.remit ? `，每月往家寄${L2.remit}` : ''}${S.broke ? '。【已经透支，账上是负的】' : ''}｜行业口碑${p.信誉}，做人${p.人品}
${pingBlock()}【今天】${E.dateStr(S.date)}
【人在哪】${S.place || '不详'}`;
}
function bagLine() {
  const B = E.bag(S);
  if (!B.length) return '没什么值得一提的（不许凭空给他添东西）';
  const keep = B.filter(b => b.keep).map(b => b.name + (E.itemOld(S, b) ? '（旧了，开始卡）' : ''));
  const rest = B.filter(b => !b.keep).map(b => b.name);
  return [keep.length ? '有' + keep.join('、') : '', rest.length ? '还没用掉、没送出去的：' + rest.join('、') : ''].filter(Boolean).join('；') + '（只有这些，不许凭空添）';
}
// 这几天主动找主角的人：他发的第一句由这一段顺带写出来
function pingBlock() {
  const P = (S.pings || []);
  if (!P.length) return '';
  return `【这几天主动找主角的人（引擎定的：每人在 messages 里写一条他发来的消息，from 写他的名字，照他的说话习惯，跟他最近在忙的事挂上）】${P.map(p => `${p.who}：${p.topic}（他最近${p.busy}）`).join('；')}\n`;
}

const STOP_WRITE = {
  '约': d => `这一段收在约好的那天早上：${d}。写这几天怎么过的，最后停在他想起今天有这件事（对方也可以发一句提醒）。不许写他已经去了，去不去由玩家定。`,
  '承诺': d => `这一段收在说好的那件事到期的那天早上：${d}。写这几天怎么过的，最后停在他想起这件事、对方也许发来一句提醒。不许写他去没去，去不去由玩家定。`,
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

// 玩家行动里的括号：（……）或(...)。解析时分成两种：限制（别替我做主）和写法要求
const splitAct = E.splitAct;
function styleAsks() { return S.plan && S.plan.style ? S.plan.style : []; }
function limitAsks() { return S.plan && S.plan.limits ? S.plan.limits : []; }
const LIMIT_RULE = ls => `【玩家的限制·必须遵守·压过下面所有条目】
${ls.map((a, i) => `${i + 1}. ${a}`).join('\n')}
- 写到限制那里就停：替主角拿主意、替他答应、替他签、替他往前推的，一律不许写。
${E.fdm(S).fiat ? '- 心想事成那条"办成之后再往前推一步"，碰到这里的限制就不适用。\n' : ''}- 这几句话本身不要原样抄进叙事。
`;
const ASK_RULE = asks => `【玩家在括号里提的写法要求·照办】
${asks.map((a, i) => `${i + 1}. ${a}`).join('\n')}
这是玩家直接下给你的写作和推演指令，不是剧情里的人说的话：
- 要求写什么场面、什么细节，就写什么，写到他要的那个细度；要求推演出什么结果、什么后续，剧情就走到那一步。
- 不许省略、不许改写、不许打折、不许只写一句带过，也不许以"不合理""太快""不符合现实"为由不写。
- 跟下面的字数、结尾写法、对话条数、选项要求有冲突时，一律以这里为准；要求写得细就写长些，没提篇幅就照常。
- 括号里的话本身不要原样抄进叙事。
`;
const FIAT_RULE = act0 => { const act = splitAct(act0).doing; const res = S.plan && S.plan.results; return `【本段铁律·压过下面所有条目（玩家的限制除外）】
${res ? '上面【引擎已经结算】里标【成了】的事，在这一段里**都已经成了**，你要写的是怎么成的。标【没成】的是硬条件不够（钱不够、本来就没有），照实写，不许改成成了。' : `玩家写的这件事——「${act}」——在这一段里**已经成了**。你要写的是它怎么成的，不是它成不成。`}
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
  if (j.check && !(S.plan && S.plan.results)) {
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

// 引擎替玩家办完的事，原样交给模型
function planBlock() {
  const P = S.plan;
  if (!P || !P.results) return '';
  const fresh = P.results.filter(r => r.newNpc).map(r => r.newNpc);
  const lines = P.results.map((r, i) => `${i + 1}. ${r.text}：【${r.ok ? '成了' : '没成'}】${r.ck ? `（${r.ck.attr}${r.ck.val}，掷骰${r.ck.roll}＝${r.ck.total}，难度${r.ck.need}${r.ck.crit ? '，' + r.ck.crit : ''}）` : ''}${r.note ? '。' + r.note : ''}`).join('\n');
  return `【主角这次做的事·引擎已经结算，结果不许改】
${lines}
- 他写了几件事就写几件，顺序照上面。成了的写成办成，没成的写卡在哪、怎么没成，不许翻过来，也不许拖到下一段。
- 上面的钱数就是实际进出的数，叙事里照这个写；playerChanges.money 只记这几笔之外的零碎花销（打车、买水之类）。${fresh.length ? `\n- ${fresh.join('、')}是玩家这次新提到的人，已经加进名册了，名册里他的身份还空着：照玩家的说法在 npcUpdates 里给他补上 tie、job、age、gender、note，以后就按这个来。` : ''}
${limitAsks().length ? '\n' + LIMIT_RULE(limitAsks()) : ''}${styleAsks().length ? '\n' + ASK_RULE(styleAsks()) : ''}`;
}

function segPrompt(seg) {
  const { from, to, days, events, stop } = seg.adv;
  if (seg.quick) return quickPrompt(seg);
  const evText = events.length
    ? events.slice(-14).map(e => `[${e.t}] ${e.s}`).join('\n')
    : '（没什么值得记的）';
  const writer = (STOP_WRITE[stop.kind] || STOP_WRITE['事'])(stop.detail);
  const actBlock = planBlock() ? `【主角自己安排的事】${splitAct(S.lastAction).doing}\n${planBlock()}\n（先把这件事的经过写出来，150 字上下，写过程，然后再往下走）` : S.lastAction
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
${E.fdm(S).fiat && S.lastAction && !planBlock() ? `- **这一段的头等大事**：把玩家写的「${S.lastAction}」写成已经办成的事，写足、写具体、写出后续的好处。这一条压过下面所有要求。\n` : ''}- 叙事 ${styleAsks().length ? '按括号里的要求来，没提篇幅就照常 300-500' : days >= 10 ? '400-600' : '250-420'} 字。${days >= 8 ? '这是一段被快进的日子，不许写成"第一天……第二天……"的流水账。挑这段时间里真正有分量的两三件事写，其余用一两句带过。' : ''}
- 必须接着上一段的结尾往下走：地点、在场的人、正在办的事都要接得上。
- 这一段比上一段一定要往前一步：地点、身边的人、主角知道的事、和谁的关系，四样里至少一样真的变了。
- ${cfg.person === 'ta' ? '通篇第三人称。' : '通篇用"你"称呼主角。'}**这一段里至少要有三处人物直接说话，用引号写原话**，不许把对话转述成"他说……"。
- options 给四条，具体到能直接做（"去找周野问问那家公司"好过"寻找机会"），互相不重样，其中至少一条跟理想有关、一条跟眼下这件事有关。
${S.job.out ? `- 主角眼下没有工作，房租和生活费照扣。这一段要让这件事有分量：要么写他去找活（投简历、托人、接零活），要么写钱怎么撑住。他真谈成一份工作时，写进 newJob（给出东家、职位、月薪），引擎据此记账。\n` : ''}${S.broke ? '- 主角账上已经是负数了。这一段不许风花雪月，钱的窟窿必须出现在剧情里。\n' : ''}
${finalCheck()}`;
}

// 就地办一件事：只写这一两天
function quickPrompt(seg) {
  const { from, to, events } = seg.adv;
  const ap = seg.adv.stop && seg.adv.stop.kind !== '就地' ? seg.adv.stop : null;
  return `${worldRules()}

${stateBlocks()}

【主角这就要做的事】${planBlock() ? splitAct(S.lastAction).doing + '\n' + planBlock() : S.lastAction}

【本段引擎判定（不可更改）】
${judgeBlock(seg.judge)}${S.capNote ? `\n【上一段被引擎砍掉的】${S.capNote}。数值按引擎认的那个来。\n` : ''}
【这两天里引擎记下的】${events.length ? events.slice(-6).map(e => `[${e.t}] ${e.s}`).join('；') : '（没什么）'}
【时间】${seg.adv.days === 0 ? `${E.shortDate(from)}，就今天这一个时段` : `${E.shortDate(from)} 到 ${E.shortDate(to)}`}${ap ? `，中间撞上一件事：${ap.detail}` : ''}

要求：
${E.fdm(S).fiat && !planBlock() ? `- **这一段的头等大事**：玩家写的「${S.lastAction}」已经成了，你只负责写它怎么成的，写足、写出后续的好处。这一条压过下面所有要求。\n` : ''}- **${seg.adv.days === 0 ? '只写今天这半天，不许写到第二天' : seg.adv.days >= 2 ? `只写这${seg.adv.days}天` : '只写这一两天'}，就写他去做「${S.plan ? splitAct(S.lastAction).doing : S.lastAction}」这件事**。${styleAsks().length ? '篇幅按括号里的要求来：要求写细就写长，没提篇幅就 300-500 字。' : '300-500 字。'}
- 照玩家写的原样去办，一个细节都不许丢：他写了几件事就写几件，写了去哪、找谁、带什么、怎么说、想达到什么，都要在剧情里落到实处。玩家没写的细节由你补足，但不许改他写的。
- 写过程，不写梗概：怎么去的、到了看见什么、跟人怎么一来一回谈的、中间哪里卡住了又怎么过去的，最后得到了什么。不许用"经过一番努力""几经周折"这类话把过程跳过去。
- 不许跳过时间，不许写成"接下来的几周""一个月后"，不许把后面的事提前写掉。
- 写具体：去了哪儿、见了谁、花了多少钱、最后手里多了什么少了什么。
- ${cfg.person === 'ta' ? '通篇第三人称。' : '通篇用"你"称呼主角。'}**只要碰上人，就得让他开口说话，用引号写原话**，这一段至少两处直接对白。没有人的时候可以不写对话，但别整段只有叙述。
- 这件事当场是个什么结果就写什么结果，成了就成了，没成就没成，别拖到下次。
- ${ap && ap.promise ? `收尾停在他想起今天约了这件事：${ap.detail}。不许写他去没去，去不去由玩家定。` : ap ? `收尾接上撞见的那件事：${ap.detail}。` : limitAsks().length ? '结尾停在玩家限制的那个地方，把选择留给主角。' : styleAsks().length ? '结尾照括号里的要求来；括号没提的话，停在事情办完的那一刻。' : (styleOf() === '网文' ? '结尾停在事情办完的那一刻，可以留一个钩子（一条消息、一个人出现），不要感慨。' : '结尾停在事情办完的那一刻，不要展望，不要感慨，不要写天色。')}
- options 给四条，都得是**今天明天就能做的具体事**，别给需要几周的计划。

${finalCheck()}`;
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
"npcs":[{"name":"","age":0,"gender":"男或女，按称呼和名字判断，拿不准留空","job":"","tie":"主角手机里给他存的称呼：妈妈、房东、老板、表姐、室友这种，不要写母子、雇主","care":"","note":"","rel":30,"close":true}],
"peers":[{"name":"","gender":"男或女","note":""}],
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
  if (judge && (judge.fate || judge.check || judge.focus || (judge.steps || []).length)) {
    const bits = [];
    for (const r of (judge.steps || [])) {
      if (r.ck) bits.push(`<span class="die ${r.ck.success ? 'good' : 'bad'}">${esc(r.ck.attr)} ${r.ck.total}/${r.ck.need} ${r.ck.success ? '成' : '败'}</span>`);
      else if (!r.ok) bits.push(`<span class="die bad">${esc(String(r.text).slice(0, 8))} 没成</span>`);
    }
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
    go.className = 'act-btn full'; go.textContent = '日子还得过下去（再给十年）';
    go.onclick = () => { S.over = false; goOn(); };
    box.appendChild(go);
    const ex = document.createElement('div');
    ex.className = 'act-row2';
    ex.innerHTML = `<button class="ghost" onclick="exportBook()">把这一生导出来</button>`;
    box.appendChild(ex);
    return;
  }
  if (S.pending) {
    box.innerHTML = '';
    const b = document.createElement('button');
    b.className = 'act-btn full'; b.textContent = '这一段没写成，再写一次';
    b.onclick = () => retryPending();
    box.appendChild(b);
    const tip = document.createElement('div');
    tip.className = 'tip'; tip.style.marginTop = '8px';
    tip.textContent = '日子已经过了，判定也定了，只是故事没写出来。再写一次不会多花时间。';
    box.appendChild(tip);
    return;
  }
  if (S.promiseAsk) {
    const pr = S.promiseAsk;
    box.innerHTML = `<div class="promise"><div class="prhd">${esc(pr.date || '')}　${pr.type === 'pledge' ? '说好的事到期了' : '约好的日子到了'}</div>
      <div class="prtx">${esc(pr.type === 'pledge' ? `你答应${pr.who}：${pr.what}` : pr.title)}</div>
      <div class="prbtns"><button class="primary" onclick="promiseGo()">${pr.kind === '面试' ? '去面试' : '去办'}</button><button class="ghost" onclick="promiseDelay()">改期</button><button class="ghost" onclick="promiseBreak()">不去了</button></div></div>`;
    return;
  }
  if (S.interview) {
    const b = document.createElement('button');
    b.className = 'act-btn full'; b.textContent = `去面试：${S.interview.title}`;
    b.onclick = () => askJob();
    box.appendChild(b);
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
  sk.innerHTML = `<button class="skip" id="funBtn">找点乐子</button><button class="skip" id="focusBtn">闷头做一阵</button><button class="skip" id="skipBtn">往下过日子</button>`;
  box.appendChild(sk);
  $('funBtn').onclick = openFun;
  $('skipBtn').onclick = skipAhead;
  $('focusBtn').onclick = openFocus;
}

/* ================= 一段推进 ================= */
// 玩家亲手写的一句话，先拆成引擎能执行的步骤（不写故事）
const PARSE_SYSTEM = `你是文字生活模拟游戏的指令解析器。你只把玩家的话拆成结构化步骤，不写故事，不评价，只输出一个合法 JSON。

把玩家这句话拆成步骤。步骤类型只能从这里选：
- quit：辞职
- repay：还钱。who=还给谁，amount=多少（没说数就填0，表示全还）
- startBiz：开店、开工作室、开公司。kind 只能填 小店/工作室/小公司，name=起的名字
- closeBiz：把自己的生意关掉
- spend：花钱（买东西、请客、送礼、交费）。amount=多少钱，玩家没说就按常理估
- seekMoney：去弄钱（找人要、接私活、卖东西、借钱）。amount=要多少，who=找谁，borrow=是不是借（要还的填 true）
- jobHunt：找工作、投简历、托人找活。target=想去的单位或行当
- meet：去见某个人、找某人说事。who=谁（尽量用【认识的人】里的名字）
- focus：接连好几天闷头做一件事（写作、学东西、练手艺、做项目）。days=几天
- rest：休养、养病。days=几天
- loan：去银行贷款。amount=贷多少，kind 填 信用贷/消费贷/经营贷（没说就空），term=几个月（没说填0）
- deposit：存定期。amount=多少，term=3/12/36 个月
- invest：买理财。amount=多少，kind 填 货币基金/银行理财/股票基金
- other：以上都不是

每一步都要有：
- text：这一步是什么，用玩家的话概括，20字内
- diff：这件事本身有多难，只能填 顺手/普通/费劲/难/很难。顺手＝买早饭、回消息、打个电话这种不会失败的；普通＝日常要花点力气；费劲＝要求人、要有点本事；难＝多数人办不成；很难＝几乎办不成。只按事情本身判断，不看主角是谁
- attr：主要靠哪项本事，只能填 专业/表达/谋划/情绪/体能

另外：
- days：玩家要这件事持续几天（"闭关三个月"填90，"这礼拜"填7，没说就是1）
- limits：玩家明确提的限制（"不要替我答应""等我选""先别告诉家里"），照抄原话，没有就空数组
- style：玩家对怎么写的要求（"写细一点""多写对话"），没有就空数组
- stopWhen：玩家说"等到什么时候再叫我"才填：{"type":"money","n":数额} 或 {"type":"days","n":天数} 或 {"type":"npc","who":"人名"}（等某人回话）；没有就 null
- 玩家说了几件事就拆几步，顺序照他说的，最多三步。括号里的话是要求，不算步骤。

只输出 JSON：
{"steps":[{"type":"other","text":"","diff":"普通","attr":"表达","who":"","amount":0,"days":0,"kind":"","name":"","target":"","borrow":false,"term":0}],"days":1,"limits":[],"style":[],"stopWhen":null}`;
function parsePrompt(act) {
  const p = S.player;
  const npcs = S.npcs.slice(-40).map(n => `${n.name}${callName(n) ? '（' + callName(n) + '）' : ''}`).join('、') || '（还没有）';
  return `【主角眼下】${p.age}岁，${S.job.out ? '没有工作' : `在${S.job.employer || '一家单位'}上班，月薪${S.ledger.salary}`}；存款${p.money}元${(S.debts || []).filter(d => d.left > 0).length ? `；欠的钱：${S.debts.filter(d => d.left > 0).map(d => `欠${d.who}${d.left}`).join('、')}` : ''}${S.biz && !S.biz.dead ? `；自己开着${S.biz.kind}「${S.biz.name}」` : '；没有自己的生意'}${S.focus ? `；手头正闷头做「${S.focus.what}」` : ''}
【认识的人】${npcs}
【玩家写的】${act}

按系统说明拆成步骤，只输出 JSON。`;
}
async function doAction(action, typed) {
  if (busy || !S || S.over) return;
  if (S.promiseAsk) { toast('先把约好的事定下来'); return; }
  if (S.pending) { await retryPending(); return; }
  let plan;
  if (typed) {
    setBusy(true, '正在琢磨你要做的事……');
    try {
      const raw = await llmJSON(parsePrompt(action), null, { maxTokens: 800, temperature: 0.2, system: PARSE_SYSTEM, noThink: true, timeout: 45000, noRetry: true });
      plan = E.sanitizePlan(raw, action, true);
    } catch (e) {
      plan = E.simplePlan(action, true);        // 解析不出来也不卡人：整句当一件普通的事
    }
    setBusy(false);
  } else plan = E.simplePlan(action, false);
  S.lastAction = action;
  S.actTyped = !!typed;
  S.plan = plan;
  await runSegment({ quick: true });
}
async function skipAhead() {
  if (busy || !S || S.over) return;
  if (S.promiseAsk) { toast('先把约好的事定下来'); return; }
  if (S.pending) { await retryPending(); return; }
  S.lastAction = null; S.actTyped = false; S.plan = null;
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
  if (S.pending) { await retryPending(); return; }
  opt = opt || {};
  const rng = Math.random;
  const judge = makeJudge(S.lastAction);
  S.interview = null;

  // 玩家这次要做的事，引擎先办：钱、工作、债、店、时长都在这里落账
  let ran = null;
  if (S.plan && !S.plan.results) {
    ran = E.runSteps(S, S.plan, rng);
    S.plan.results = ran.results;
    judge.steps = ran.results;
  }
  const quick = !!opt.quick && !!S.lastAction && !(ran && (ran.long || S.plan.stopWhen));

  const focusing = !!S.focus;
  const adv = E.advance(S, { rng, maxDays: quick ? (opt.span !== undefined ? opt.span : 1) : 35, quiet: quick });
  if (focusing && adv.stop.kind === '投入') judge.focus = E.settleFocus(S, rng);
  if (adv.stop.kind === '运') judge.fate = adv.stop.fate;
  else judge.fate = E.d20(rng);
  const floor = E.num(E.fdm(S).fateFloor);
  if (floor) judge.fate = Math.max(floor, judge.fate);          // 言出法随这一档不走背字
  judge.fateFx = E.applyFate(S, judge.fate);
  rebuildTop();                 // 日子和钱已经动了，顶栏马上跟上，别等故事写完

  S.seg++;
  S.stats.segs++;
  const isYear = adv.stop.kind === '年终';
  const head = isYear ? `${adv.to.y}年` : adv.days <= 1 ? E.shortDate(adv.to) : `${E.shortDate(adv.from)} — ${E.shortDate(adv.to)}`;
  const sub = isYear ? '年终' : quick ? '' : `${adv.days}天`;

  if (adv.stop.kind === '结局') {
    S.plan = null; S.lastAction = null;
    renderOptions([]);
    saveGame();
    await runEnding({ why: adv.stop.why, text: adv.stop.detail });
    return;
  }
  // 状态已经推进了：把这一段要发的请求整个存下来。请求失败只重发它，不再推进日子、不重掷骰子
  S.pending = {
    prompt: isYear ? yearPrompt(E.yearDiff(S)) : segPrompt({ adv, judge, quick }),
    isYear, head, sub, action: S.lastAction || '', judge: isYear ? null : judge,
    busyText: quick ? '正在记下这一天……' : adv.days >= 8 ? `${adv.days}天过去了，正在记下这段日子……` : '正在记下这几天……',
    apptKind: adv.stop.apptKind || null, apptTitle: adv.stop.kind === '约' ? adv.stop.detail : '',
    promise: adv.stop.promise || null
  };
  saveGame();
  beginChapter(head, sub, S.pending.action, S.pending.judge);
  renderOptions([]);
  await writePending();
}

async function writePending() {
  const P = S.pending;
  if (!P) return;
  setBusy(true, P.busyText || '正在记下这几天……');
  let d;
  try {
    const raw = await llmJSON(P.prompt, raw => {
      const t = extractPartialField(raw, 'narrative');
      if (t) updateChapterNarrative(t);
    });
    d = E.sanitizeTurn(raw);
    if (!d.narrative) throw new Error('模型没写出正文');
  } catch (e) {
    updateChapterNarrative('（这一段没写成：' + (e.message || e) + '）');
    renderOptions([]);
    toast(e.message || '出错了');
    setBusy(false);
    return;
  }
  // 正文到手：这一段就算过了。后面哪一步出岔子只记下来，不再让玩家重写同一段
  S.pending = null;
  const step = (name, fn) => { try { fn(); } catch (e) { console.error('记账出错：' + name, e); S.applyErr = `${name}：${e.message || e}`; } };
  step('正文', () => updateChapterNarrative(d.narrative));
  if (P.isYear) step('年终', () => {
    const snap = E.yearSnap(S);
    S.years = (S.years || []).concat([{ y: snap.y, snap, text: d.narrative, summary: d.summary || '' }]).slice(-12);
    S.history.push({ seg: S.seg, date: `${snap.y}年`, summary: `【年终】${d.summary || ''}` });
  });
  const msgs0 = S.msgs.length;
  step('记账', () => E.applyTurn(S, d));
  step('主动找你', () => E.settlePings(S, msgs0));
  step('截账说明', () => { if (S.capNote && curChapter) curChapter.querySelector('.ntext').insertAdjacentHTML('beforeend', `<p class="capnote">（引擎记账：${esc(S.capNote)}）</p>`); });
  step('里程碑', () => {
    const claim = E.judgeClaim(S, d.milestoneClaim);
    S.claimNote = claim && !claim.ok ? `你申报过「${claim.title}」，但${claim.short}，还不够格` : null;
  });
  S.plan = null;
  S.lastAction = null; S.actTyped = false;
  if (P.promise) S.promiseAsk = Object.assign({ date: E.shortDate(S.date) }, P.promise);
  else if (P.apptKind === '面试') S.interview = { title: P.apptTitle || '一场面试' };
  S.lastOptions = (d.options && d.options.length) ? d.options : ['接着过日子', '找人聊聊', '琢磨一下理想那件事', '出去走走'];
  saveGame();
  try { await finishChapter(); } catch (e) { console.error(e); }
  step('界面', () => { rebuildTop(); renderOptions(S.over ? [] : S.lastOptions); renderPanel(); });
  saveGame();
  setBusy(false);
}
// 上一段请求没成：日子已经过了、骰子已经掷了，只把那个请求再发一次
async function retryPending() {
  const P = S.pending;
  if (!P || busy) return;
  if (!curChapter) beginChapter(P.head, P.sub, P.action, P.judge);
  else updateChapterNarrative('');
  await writePending();
}

const guessAttr = E.guessAttr;

// 到期提醒卡的三个按钮
async function promiseGo() {
  const pr = S.promiseAsk;
  if (!pr || busy) return;
  S.promiseAsk = null;
  E.keepPromise(S, pr);
  if (pr.kind === '面试') { S.interview = { title: pr.title, post: pr.post || null }; saveGame(); askJob(); return; }
  if (pr.kind === '随礼' && pr.wed) {
    const city = E.CITIES[S.city] || E.CITIES['新一线'];
    const sug = Math.round(city.pay * (E.relTier((S.npcs.find(x => x.name === pr.wed.who) || {}).rel) >= 3 ? 0.12 : 0.06) / 100) * 100;
    const v = await ask({ title: `${pr.wed.who}${pr.wed.what}，随多少？`, text: `账上有 ${S.player.money}。写 0 就是空手去。`, input: { value: String(sug), number: true }, ok: '就这么多' });
    const r = E.giveLiJin(S, pr.wed.who, Math.max(0, Number(v) || 0), pr.wed.what);
    if (!r.ok) { toast(r.why); S.promiseAsk = pr; renderOptions(S.lastOptions); return; }
    await lifeSeg(`去${pr.wed.who}的${pr.wed.what}酒席`, r.note, pr.wed.who, 0);
    return;
  }
  const what = pr.type === 'pledge' ? pr.what : pr.title;
  S.lastAction = `去办说好的事：${what}`;
  S.actTyped = false;
  S.plan = { steps: [{ type: pr.who ? 'meet' : 'other', who: pr.who || undefined, text: String(what).slice(0, 30), diff: '顺手', attr: E.guessAttr(what) }], limits: [], style: [], days: 1, stopWhen: null, parsed: true };
  saveGame();
  await runSegment({ quick: true });
}
async function promiseDelay() {
  const pr = S.promiseAsk;
  if (!pr || busy) return;
  const v = await ask({ title: '往后推几天？', text: pr.who ? `${pr.who}那边会有点不痛快。` : '', input: { value: '3', number: true }, ok: '就推这么多' });
  if (v === null) return;
  const dt = E.delayPromise(S, pr, Number(v));
  S.promiseAsk = null;
  toast(`改到${dt.m}月${dt.d}日了`);
  saveGame(); renderOptions(S.lastOptions); renderPanel();
}
async function promiseBreak() {
  const pr = S.promiseAsk;
  if (!pr || busy) return;
  if (!await ask({ title: '真不去了？', text: pr.who ? `${pr.who}会记着这件事。` : '错过就错过了。', no: '再想想', ok: '不去了', danger: true })) return;
  E.breakPromise(S, pr);
  S.promiseAsk = null;
  toast(pr.who ? `放了${pr.who}鸽子` : '没去');
  saveGame(); rebuildTop(); renderOptions(S.lastOptions); renderPanel();
}

/* ================= 开局 ================= */
function renderStart() {
  const o = $('startBox');
  o.innerHTML = `
  ${artImg('cover_arrival', 'cover', '', true)}
  <h2>开局</h2>
  <div class="frow"><label>名字</label><input id="sName" maxlength="6" placeholder="随你"/></div>
  <div class="frow"><label>性别</label><div class="segs" id="sGender">${seg(['男', '女'], '男')}</div></div>
  ${avatarsOn() ? `<div class="frow"><label>头像</label><div class="facepick" id="sFace"></div></div>` : ''}
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
  <div class="frow"><label>赛道</label><div class="segs wrap" id="sTrack">${seg(Object.keys(E.TRACKS), '创作', TRACK_ICON)}</div></div>
  <div class="frow col"><label>你想干成的事</label><input id="sIdeal" maxlength="30" placeholder="${E.TRACKS['创作'].ph}"/></div>
  <div class="frow"><label>口径</label><div class="segs" id="sFree">${seg(Object.keys(E.FREEDOM), '都市传奇')}</div></div>
  <div class="hint" id="fHint">${esc(FREE_NOTE['都市传奇'])}</div>
  <div class="frow"><label>文风</label><div class="segs wrap" id="sStyle">${seg(Object.keys(STYLES), '白描')}</div></div>
  <div class="hint" id="stHint">${esc(STYLES['白描'].note)}</div>
  <div class="btns"><button class="ghost" onclick="openSettings()">接口设置</button><button class="primary" id="startGo">开始</button></div>`;
  bindSeg('sOrigin', v => $('oHint').textContent = E.ORIGINS[v].desc);
  bindSeg('sCity', v => $('cHint').textContent = E.CITIES[v].desc);
  bindSeg('sTrack', v => $('sIdeal').placeholder = E.TRACKS[v].ph);
  bindSeg('sGender', v => renderFacePick(v));
  renderFacePick('男');
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
  bindSeg('sStyle', v => $('stHint').textContent = STYLES[v].note);
  $('startGo').onclick = startNew;
}
let pickedFace = '';
function renderFacePick(gender) {
  const box = $('sFace');
  if (!box) return;
  const pool = FACE_POOL[gender] || [];
  const ok = pool.filter(f => avatarSrc(f, 'young'));
  if (!ok.length) { box.innerHTML = ''; pickedFace = ''; return; }
  if (ok.indexOf(pickedFace) < 0) pickedFace = ok[0];
  box.innerHTML = ok.map(f => `<img class="face md${f === pickedFace ? ' on' : ''}" data-f="${f}" src="${avatarSrc(f, 'young')}" alt="" decoding="async"/>`).join('');
  box.querySelectorAll('img').forEach(i => i.onclick = () => { pickedFace = i.dataset.f; renderFacePick(gender); });
}
function seg(arr, cur, ic) { return arr.map(a => `<button class="seg${a === cur ? ' on' : ''}" data-v="${esc(a)}">${ic && ic[a] ? icon(ic[a]) : ''}${esc(a)}</button>`).join(''); }
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
    freedom: segVal('sFree'), face: pickedFace,
    startYear: new Date().getFullYear(), rngSeed: Date.now(), payRoll: Math.random()
  };
  S = E.newState(o);
  S.style = segVal('sStyle') || '白描';
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
    S.peers = (d.peers || []).slice(0, 6).map(p => ({ name: String(p.name || '').slice(0, 8), note: String(p.note || '').slice(0, 30), track: [], gender: E.guessGender(p.gender, '', p.note, p.name) }));
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

    const groups = E.groupList(S).slice().reverse().map(g => {
      const last = g.msgs[g.msgs.length - 1];
      return `<div class="thread" onclick="openGroup('${g.id}')"><div class="face sm" style="--h:200">群</div>
        <div class="thbody"><div class="mfrom">${esc(g.name)}<em>${g.members.length + 1}人</em><span>${last ? esc(last.date) : esc(g.since)}</span></div>
        <div class="mtext one">${last ? (last.me ? '我：' : esc(last.from) + '：') + esc(last.text || (last.payId ? '[红包]' : '')) : '还没人说话'}</div></div></div>`;
    }).join('');
    box.innerHTML = head + `<button class="ghost sm gmake" onclick="openMakeGroup()">＋ 发起群聊</button><div class="msgs">${groups}${rows.map(r => {
        const gap = r.npc ? S.stats.days - (r.npc.lastSeen || 0) : 0;
        return `<div class="thread" onclick="openThread('${esc(r.name)}')">
          <span class="facetap" onclick="event.stopPropagation();openCard('${esc(r.name)}')">${faceHtml(S, r.name, 'sm')}</span>
          <div class="thbody">
            <div class="mfrom">${esc(r.name)}${(() => { const w = r.npc ? callName(r.npc) : ((S.peers || []).some(p => p.name === r.name) ? '同学' : ''); return w && !w.includes(r.name) && !r.name.includes(w) ? `<em>${esc(w)}</em>` : ''; })()}
              <span>${r.last ? esc(r.last.date) : ''}${r.unread ? ' <i class="dot"></i>' : ''}</span></div>
            ${r.last ? `<div class="mtext one">${(r.last.me ? '我：' : '') + esc(r.last.text || '') + (r.last.payId ? ((p => p ? `[${p.kind}${p.state === '待收' ? '·没领' : ''}]` : '')(E.findPay(S, r.last.payId))) : '')}</div>` : ''}
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
    const bankPay = E.bankOf(S).loans.reduce((a, x) => a + (x.left > 0 ? x.monthly : 0), 0);
    const inc = L.salary + L.subsidy, out = L.rent + loan + L.living + kid + L.remit + bankPay;
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
      ${bankPay ? row(`贷款月供（${L.rentDay}号）`, bankPay, -1) : ''}
      ${row('吃穿用度', L.living, -1)}
      ${kid ? row('养孩子', kid, -1) : ''}
      ${L.remit ? row('寄回家', L.remit, -1) : ''}
      <div class="sum"><b>一个月剩</b><span class="${net < 0 ? 'bad' : 'good'}">${net < 0 ? '−' : ''}${Math.abs(net).toLocaleString('zh-CN')}</span></div>
    </div>
    <div class="tip" style="margin-top:6px">${S.broke ? '账上已经是负的了，做什么都差一口气。'
      : net >= 0 ? `照这样过，一个月能剩 ${net}${bizNet ? '（生意按上个月算）' : ''}。剧情里额外的进出不算在内，看下面的明细。`
      : `每个月倒贴 ${-net}，手上的钱还能撑 ${Math.max(0, Math.floor(p.money / -net))} 个月。`}</div></div>
    ${bankCard()}
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
    <div class="card"><div class="cardhead">${faceHtml(S, p.name, 'me')}<div><div class="big">${esc(p.name)}</div><div class="tip">${p.gender}｜${p.age}岁｜${esc(S.city)}｜${esc(p.job)}</div></div></div>${p.bg ? `<div class="tip">${esc([p.bg.school + (p.bg.school === '名校' || p.bg.school === '重点' ? '' : '学校'), p.bg.major, p.bg.edu, p.bg.persona, p.bg.looks ? '长相' + p.bg.looks : ''].filter(Boolean).join('｜'))}</div>` : ''}</div>
    <div class="card"><div class="lines">${E.ATTRS.map(a => `<div><b>${a}${a === '专业' ? `（${esc(p.skillName)}）` : ''}</b><span>${p.attrs[a]}</span></div>`).join('')}
      <div><b>精力</b><span>${p.energy}${E.energyCap(S) < 100 ? ` / 上限${E.energyCap(S)}` : ''}</span></div>
      <div><b>行业口碑</b><span>${p.信誉}</span></div>
      <div><b>做人</b><span>${p.人品}</span></div>
      <div><b>干了多久</b><span>${workedText(p.资历天 || 0)}</span></div>
    </div></div>
    <h4>事业</h4>
    <div class="card">${S.job.out
      ? `<div class="big bad">没有工作</div><div class="tip">${S.job.was ? `从${esc(S.job.was)}出来之后` : ''}没有工资进账，房租和生活费照扣。</div>
         <div class="btns"><button class="primary" onclick="openBoard()">看招聘</button>${S.interview ? `<button class="ghost" onclick="askJob()">去面试</button>` : ''}</div>`
      : `<div class="lines">
          <div><b>单位</b><span>${esc(S.job.employer || S.player.job || '—')}</span></div>
          <div><b>岗位</b><span>${esc(S.job.post || '没名目')}</span></div>
          <div><b>职级</b><span>${E.LEVELS[E.num(S.job.lv)].t}${S.job.probation ? '（试用期）' : ''}</span></div>
          <div><b>月薪</b><span>${L.salary}${S.job.vary ? '（底薪，提成另算）' : ''}</span></div>
          <div><b>累不累</b><span>${E.STRAIN[E.num(S.job.strain === undefined ? 1 : S.job.strain)]}</span></div>
          <div><b>下次考核</b><span>${E.nextReview(S)}天后</span></div>
        </div>
        <div class="cardhd" style="margin-top:10px">这个季度的绩效</div>
        <div class="bar"><div class="bar-in${S.job.perf > 45 ? ' good' : S.job.perf < 15 ? ' bad' : ''}" style="width:${Math.min(100, Math.round(S.job.perf / 70 * 100))}%"></div></div>
        <div class="tip">${Math.round(S.job.perf)}　上班就在攒；重心放在「拼工作」攒得最快，代价是精力。${S.job.mood < 0 ? '　上次被约谈过，这个季度要难一些。' : ''}</div>
        <div class="btns"><button class="ghost" onclick="askRaise()">谈加薪</button><button class="ghost" onclick="openBoard()">看看别的机会</button><button class="ghost" onclick="doQuit()">辞职</button></div>`}
    </div>
    <h4>兼职</h4><div class="card">${gigCard()}</div>
    <h4>东西</h4><div class="card">${bagHtml()}</div>
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
    : m.kind === 'job' && m.post
    ? `这是一场面试：${m.post.employer}招${m.post.job}，月薪${m.post.lo}到${m.post.hi}${m.post.vary ? '（底薪加提成）' : ''}，${E.STRAIN[m.post.strain]}活。公司名、岗位名照这个写，不许改；开场里提到钱只能在这个范围里，具体给多少谈完由引擎定。对手是这家招人的。`
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
${meta.post && res.result === '谈成' ? `- 这场面试谈成了，引擎已经把工作记上：${res.job}。正文里的单位、岗位、月薪照这个写，newJob 填 null。\n` : ''}${meta.kind === 'job' && !meta.post && res.result === '谈成' ? '- 这场是面试而且谈成了：必须把 newJob 填上（东家、职位、月薪、是否试用期），月薪要跟剧情里说的对得上。\n' : ''}${meta.kind === 'love' ? (res.result === '谈成' ? '- 话挑明了，对方也接了：写两个人怎么把这层窗户纸捅破的，别写成偶像剧，写具体的地点和那几句话。\n' : '- 没接住：写清楚是拒绝、是躲开了、还是说再看看，之后两个人怎么把场面收掉。\n') : ''}${meta.kind === 'marry' ? (res.result === '谈成' ? '- 婚事定下来了：写谁先开的口、钱怎么算、家里人什么态度。\n' : '- 婚事没谈成：写卡在哪儿——钱、房、家里、还是对方本来就没想好。\n') : ''}${meta.kind === 'job' && res.result !== '谈成' ? '- 这场面试没成，不要安慰他，写他怎么走出那栋楼。\n' : ''}

${finalCheck()}`;
}

async function askKey(mileId) {
  let m = null;
  for (const st of S.ideal.stages) for (const x of st.milestones) if (x.id === mileId) m = x;
  if (!m) return;
  runKey({ scene: m.scene, gate: m.gate, title: m.title, desc: m.desc, kind: 'mile', mileId, hard: keyHard(mileId) });
}
function askJob() {
  const iv = S.interview; S.interview = null;
  const P = iv && iv.post ? E.findPost(S, iv.post) : null;
  if (P) { runKey({ scene: '面试', gate: `${P.employer}的${P.job}`, title: '找个新饭碗', kind: 'job', mileId: null, post: P, hard: Math.round(22 + P.need * 0.5) }); return; }
  runKey({ scene: '面试', gate: iv ? iv.title : '一场面试', title: '找个新饭碗', kind: 'job', mileId: null, hard: 28 + E.num(S.job.lv) * 8 });
}
function askRaise() {
  if (S.job.out) { toast('眼下没有工作'); return; }
  const lv = E.num(S.job.lv);
  runKey({ scene: '谈判', gate: '跟老板谈加薪', title: '加薪', kind: 'raise', mileId: null, hard: 40 + lv * 8 });
}
async function runKey(m) {
  if (busy) return;
  if (S.pending) { toast('上一段还没写完，先把它写出来'); return; }
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
    E.startKey(S, { scene: m.scene, name: o.name, type: o.type, note: o.note, hard, mileId: m.mileId, kind: m.kind, who: m.who, stake: m.gate || m.title, post: m.post || null });
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
  const ban = $('keyBan');
  if (ban && ban.dataset.scene !== K.scene) { ban.dataset.scene = K.scene; ban.innerHTML = artImg(KEY_ART[K.scene], 'ban', ''); }
  $('keyOpp').innerHTML = S.npcs.some(n => n.name === K.opp.name) ? faceHtml(S, K.opp.name, 'md') : '';
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
      <b>${icon(MOVE_ICON[k])}${k}</b><i>${mv.tip}</i><u>${mv.attr}${S.player.attrs[mv.attr]}${seen ? `　用过${seen}次` : ''}</u></button>`;
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
  const meta = { scene: K.scene, opp: K.opp, stake: K.stake, kind: K.kind, log: K.log.slice(), why: K.why || '', post: K.post || null };
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
    if (meta.post) d.newJob = null;          // 招聘来的岗位，月薪引擎已经定了
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
    if (res.job) toast(`入职了：${res.job}`);
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
  $('npcBox').innerHTML = `<div class="cardhead">${faceHtml(S, n.name, 'lg')}<div><h2>${esc(n.name)}</h2>
    <div class="tip">${n.age ? n.age + '岁　' : ''}${esc(n.job || '')}${callName(n) ? '　' + esc(callName(n)) : ''}</div></div></div>
    <div class="card" style="margin-top:14px"><div class="lines">
      <div><b>关系</b><span class="${n.rel < 12 ? 'bad' : ''}">${relWord(n.rel, n.tie)}</span></div>
      ${n.intimate ? `<div><b>你们之间</b><span>${esc(n.intimate.first)}起有过关系${n.intimate.times > 1 ? `，${n.intimate.times}回` : ''}</span></div>` : ''}
      <div><b>上次来往</b><span>${gap <= 0 ? '就这几天' : gap + '天前'}</span></div>
      ${n.care ? `<div><b>在意</b><span>${esc(n.care)}</span></div>` : ''}
      ${n.busy ? `<div><b>最近</b><span>${esc(n.busy.t)}</span></div>` : ''}
    </div>${n.note ? `<div class="tip">${esc(n.note)}</div>` : ''}</div>
    ${(n.mem || []).length ? `<h4 style="margin-top:8px">你们之间</h4><div class="card">${n.mem.slice(-8).reverse().map(m => `<div class="li">${esc(m)}</div>`).join('')}</div>` : ''}
    <div class="btns"><button class="ghost" onclick="mask('npcMask',false)">关掉</button><button class="ghost" onclick="giveFromCard('${esc(n.name)}')">送东西</button><button class="primary" onclick="mask('npcMask',false);openConvo('${esc(n.name)}')">找他聊聊</button></div>
    ${!E.partnerOf(S) && (n.rel >= 55 || n.intimate) && !/爱人|前任|前妻|前夫/.test(n.tie || '') && !isKin(n.tie)
      ? `<div class="btns"><button class="ghost" onclick="mask('npcMask',false);askLove('${esc(n.name)}')">把话挑明</button></div>`
      : ''}`;
  mask('npcMask', true);
}
function giveFromCard(name) {
  const B = E.bag(S);
  sheet(`<h2>给${esc(name)}送点什么</h2><div class="tip" style="margin-top:-10px">见面送过去。</div>
    <div class="card" style="margin-top:14px">${B.map(b => `<div class="li tap" onclick="doGive('${esc(name)}',${b.uid})"><b>${esc(b.name)}</b><span class="rel">${b.price}元</span><div class="tip">${b.tags.join('、')}</div></div>`).join('') || '<div class="tip">包里没东西可送</div>'}</div>
    <div class="btns"><button class="ghost" onclick="sheetOff()">算了</button><button class="primary" onclick="openShop('礼物','${esc(name)}')">现买一样</button></div>`);
}
// 点头像看名片：只在消息里出现过、还没进通讯录的人，先补进来
function openCard(name) {
  if (!S.npcs.some(x => x.name === name)) {
    const peer = (S.peers || []).find(p => p.name === name);
    E.addNpcs(S, [{ name, tie: peer ? '同学' : (/^(房东|老板|领导|同事|室友|邻居|快递|中介|物业)$/.test(name) ? name : ''), job: peer ? (peer.note || '') : '', note: peer ? (peer.note || '') : '给你发过消息', rel: peer ? 30 : 18, close: false }], 1);
    saveGame();
  }
  showNpc(name);
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
  E.fixNpcLife(S, n);
  return `${worldRules(true)}

你现在扮演的是【${n.name}】。
【${n.name}是谁】${n.gender ? n.gender + '，' : ''}${n.age ? (n.age + (S.date.y - (n.ageY || S.date.y))) + '岁，' : ''}${n.job || '不详'}，在主角手机里存的是「${callName(n) || '认识的人'}」${n.met ? `，${n.met}认识的` : ''}${(n.facts || []).length ? `，要一直记着：${n.facts.join('；')}` : ''}，眼下关系：${relWord(n.rel, n.tie)}（内部数值${Math.round(n.rel)}，属于「${E.TIERS[E.relTier(n.rel)]}」这一档）${n.care ? `，他在意的是${n.care}` : ''}。${n.note || ''}
【他的说话习惯（一直照这个来）】${n.talk || E.talkOf(n)}
【他最近在忙】${(n.busy && n.busy.t) || '老样子'}
【你们之间的来往（按日子，${n.name}都记得）】
${(n.mem || []).join('\n') || '没什么特别的'}
【主角】${S.player.name}，${S.player.age}岁，${S.player.job}，眼下在${S.place || '外面'}。${E.bgLine(S.player)}。
【主角这阵子干的事】（${n.name}知道多少看关系：走得近的、家里人大体都知道；不熟的只知道跟自己有关的和传到耳朵里的。知道的就要对得上，别装不知道，也别说错）
${S.history.slice(-10).map(h => `${h.date}｜${h.act ? '他去' + h.act + '：' : ''}${h.summary}`).join('\n') || '（刚开始）'}
${(S.pledges || []).filter(p => !p.done && p.who === n.name).length ? `【你们之间说定的事】${S.pledges.filter(p => !p.done && p.who === n.name).map(pledgeLine).join('；')}\n` : ''}${aboutNpc(n)}【就在刚才】${String((S.recent[S.recent.length - 1] || {}).narrative || '').replace(/\s+/g, '').slice(-220)}`;
}
// 这次对话：太长了只留最近 30 句原话，更早的靠一路记下来的要点
function lineText(l) {
  const p = l.payId ? E.findPay(S, l.payId) : null;
  const pt = p ? `[${p.kind} ${p.amount}元${p.note ? '：' + p.note : ''}，${p.state}]` : '';
  return [l.text, pt].filter(Boolean).join(' ');
}
function convoLog(n) {
  const L = S.convo.lines.filter(l => l.who !== 'sys');
  const keep = L.slice(-30);
  const head = L.length > keep.length ? `（更早的 ${L.length - keep.length} 句略，要点是：${S.convo.gist || S.convo.summary || '闲聊'}）\n` : '';
  return head + (keep.map(l => `${l.who === 'me' ? S.player.name : (l.from || n.name)}：${lineText(l)}`).join('\n') || '（刚开口）');
}
function convoPrompt(n, say, judge) {
  const c = S.convo;
  const past = (c.hist || []).map(m => `${m.date || ''} ${m.me ? S.player.name : n.name}：${lineText(m)}`).join('\n');
  const said = c.lines.filter(l => l.who === 'ta' && l.text).map(l => l.text);
  // 顺序：这个人是谁（整场不变）→ 以前的来往（整场不变）→ 这次的对话（只往后加）→ 每轮会变的放最后
  return `${convoHead(n)}
${past ? `\n【手机里以前的来往（已经过去的事，不是刚说的）】\n${past}\n` : ''}
【这次的对话（按先后）】
${convoLog(n)}

${c.gist ? `【这次聊到现在的要点】${c.gist}\n` : ''}${said.length ? `【你这次已经说过的，别再说】${said.slice(-6).map(t => '「' + String(t).slice(0, 24) + '」').join('')}\n` : ''}【主角手头】存款${S.player.money}元${c.paidNote ? `\n【刚才】${c.paidNote}` : ''}
${judge
    ? `【引擎判定（不可更改）】主角求的这件事：${judge.what}。${judge.attr}${judge.val}，掷骰${judge.roll}＝${judge.total}，难度${judge.need}，判定【${judge.success ? '答应' : '没答应'}】${judge.crit ? '（' + judge.crit + '）' : ''}。${judge.note ? `引擎落实的：${judge.note}。答复里的数和日子要跟这个对得上。` : ''}\n这一轮写${n.name}对这件事的答复。\n`
    : ''}【主角刚发的这句——你这一轮要回的就是它】${say || '（见上面对话的最后一句）'}

【回之前对一遍】你是${n.name}，不是主角；只回主角刚发的这句，不接很早以前的话茬；这次说过的话不再说；${judge ? '答复照引擎判定的结果来，' : ''}钱、日子、说定的事对得上；只输出系统说明里那个 JSON。`;
}

let convoFrom = '';     // 从哪个面板点进来的，返回时回那儿
function openConvo(name) {
  const n = S.npcs.find(x => x.name === name);
  if (!n || busy) return;
  if (S.pending) { toast('上一段还没写完，先把它写出来'); return; }
  convoFrom = curTab || '';
  S.convo = { name, lines: [], turns: 0, summary: '', rel: 0, hist: S.msgs.filter(m => m.from === name).slice(-14) };
  closePanel();
  $('chat').classList.add('on');
  renderConvo();
  $('chatIn').value = '';
  setTimeout(() => $('chatIn').focus(), 200);
}
// 一笔钱在聊天里的样子
function payCard(id) {
  const p = E.findPay(S, id);
  if (!p) return '';
  const mine = p.from === '我';
  const st = p.state === '待收' ? (p.kind === '红包' ? '待领取' : '待收款') : p.state === '已收' ? '已收' : p.state === '退还' ? '已退还' : p.state === '退回' ? '被退回' : p.state === '已抢完' ? '已被抢完' : (mine ? '已付' : '');
  const btn = !mine && p.state === '待收'
    ? `<div class="paybtns"><button onclick="takePay(${p.id},true)">${p.kind === '红包' ? '领红包' : '收款'}</button><button class="ghost" onclick="takePay(${p.id},false)">退还</button></div>` : '';
  const split = p.split ? `<div class="paysplit">${p.split.map(x => `${esc(x.who)} ${x.amount}`).join('　')}</div>` : '';
  return `<div class="paycard ${p.kind === '红包' ? 'hb' : 'zz'}${p.state === '待收' ? '' : ' done'}"><b>${p.kind === '红包' ? '红包' : '转账'}　¥${p.amount}</b><span>${esc(p.note || (p.kind === '红包' ? '恭喜发财' : ''))}</span><em>${st}${p.toDebt ? `（${p.toDebt}算还债）` : ''}</em>${split}${btn}</div>`;
}
function bubHtml(who, text, opt) {
  opt = opt || {};
  const side = who === 'me' ? 'me' : 'ta';
  const nm = opt.from && side === 'ta' ? `<u class="bfrom">${esc(opt.from)}</u>` : '';
  const t = text ? `<div class="bub ${side}">${nm}${esc(text)}${opt.mood ? `<i>${esc(opt.mood)}</i>` : ''}</div>` : '';
  const pc = opt.payId ? `<div class="paywrap ${side}">${!text && nm ? nm : ''}${payCard(opt.payId)}</div>` : '';
  return t + pc;
}
function renderConvo() {
  const c = S.convo;
  if (!c) return;
  const g = c.group ? E.groupList(S).find(x => x.id === c.group) : null;
  if (g) {
    $('chatName').innerHTML = `${esc(g.name)} <i class="tapcard">${g.members.length + 1}人</i>`;
    $('chatFace').innerHTML = `<div class="face" style="--h:200">群</div>`;
    $('chatFace').onclick = null;
    $('chatName').onclick = () => toast(`群里有：${g.members.join('、')}`);
    $('chatSub').textContent = g.members.join('、');
  } else {
    const n = S.npcs.find(x => x.name === c.name) || { name: c.name, rel: 20, tie: '' };
    $('chatName').innerHTML = `${esc(n.name)} <i class="tapcard">名片</i>`;
    $('chatFace').innerHTML = faceHtml(S, n.name, '');
    $('chatFace').onclick = () => showNpc(n.name);
    $('chatName').onclick = () => showNpc(n.name);
    $('chatSub').textContent = callName(n);
  }
  let lastDate = '';
  const hist = (c.hist || []).map(m => {
    const d = m.date && m.date !== lastDate ? `<div class="sysline">${esc(m.date)}</div>` : '';
    lastDate = m.date || lastDate;
    return d + bubHtml(m.me ? 'me' : 'ta', m.text, { payId: m.payId, from: g ? m.from : '' });
  }).join('');
  const nowD = E.shortDate(S.date);
  const sep = hist && c.lines.length && lastDate !== nowD ? `<div class="sysline">${esc(nowD)}</div>` : '';
  $('chatBody').innerHTML = (hist + sep + c.lines.map(l =>
    l.who === 'sys' ? `<div class="sysline">${esc(l.text)}</div>` : bubHtml(l.who, l.text, { mood: l.mood, payId: l.payId, from: g ? l.from : '' })).join(''))
    || '<div class="sysline">说点什么</div>';
  const q = !g && !busy && (c.quick || []).length ? c.quick : [];
  $('chatQuick').innerHTML = q.map((t, i) => `<button onclick="quickSay(${i})">${esc(t)}</button>`).join('');
  $('chatQuick').classList.toggle('on', q.length > 0);
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
}
// 领钱 / 退还：聊天里、翻旧消息时都能点
function takePay(id, take) {
  const p = E.claimPay(S, id, take);
  if (!p) return;
  toast(take ? `收了${p.from}的${p.amount}` : `退还给${p.from}了`);
  if (S.convo) {
    S.convo.lines.push({ who: 'sys', text: take ? `你收下了${p.from}的${p.kind}，${p.amount}元` : `你把${p.from}的${p.kind}退了回去` });
    S.convo.paidNote = (take ? '主角收下了' : '主角把') + `${p.from}给的${p.amount}元${p.kind}` + (take ? '' : '退了回去');
    renderConvo();
  }
  rebuildTop(); renderPanel(); saveGame();
}
// ＋：转账 / 红包
function chatPlus() {
  const c = S.convo;
  if (!c || busy) return;
  const m = $('plusMenu');
  m.innerHTML = c.group
    ? `<button onclick="chatPay('红包')">发红包（拼手气）</button><button class="ghost" onclick="$('plusMenu').classList.remove('on')">算了</button>`
    : `<button onclick="chatPay('转账')">转账</button><button onclick="chatPay('红包')">红包</button><button onclick="chatGift()">送东西</button><button class="ghost" onclick="$('plusMenu').classList.remove('on')">算了</button>`;
  m.classList.toggle('on');
}
async function chatPay(kind) {
  $('plusMenu').classList.remove('on');
  const c = S.convo;
  if (!c) return;
  const v = await ask({ title: kind === '红包' ? (c.group ? '在群里发红包' : `给${c.name}发红包`) : `转账给${c.name}`,
    text: `账上有 ${S.player.money} 元。先写金额，后面可以跟一句话。`, input: { placeholder: kind === '红包' ? '200 恭喜发财' : '500 房租先给你', max: 40 }, ok: kind === '红包' ? '塞进去' : '转' });
  if (!v) return;
  const mm = v.match(/^\s*(\d+)\s*(.*)$/);
  if (!mm) { toast('先写金额'); return; }
  const amt = Number(mm[1]), note = mm[2].trim();
  if (c.group) {
    const g = E.groupList(S).find(x => x.id === c.group);
    const r = E.groupPacket(S, g, amt, note, Math.random);
    if (!r.ok) { toast(r.why); return; }
    c.lines.push({ who: 'me', text: '', payId: r.pay.id });
    renderConvo(); rebuildTop(); saveGame();
    await groupTurn(`[在群里发了个${amt}元的拼手气红包${note ? '：' + note : ''}。引擎分好了：${r.split.map(x => `${x.who}抢到${x.amount}`).join('，')}]`);
    return;
  }
  const r = E.payOut(S, c.name, amt, kind, note);
  if (!r.ok) { toast(r.why); return; }
  c.lines.push({ who: 'me', text: '', payId: r.pay.id });
  if (r.debt) c.lines.push({ who: 'sys', text: r.debt });
  renderConvo(); rebuildTop(); saveGame();
  await convoTurn(`[给你${kind === '红包' ? '发了个红包' : '转账'} ${amt}元${note ? '：' + note : ''}${r.debt ? `（${r.debt}）` : ''}]`, null);
}
function quickSay(i) {
  const c = S.convo;
  if (!c || busy || !c.quick || !c.quick[i]) return;
  $('chatIn').value = c.quick[i];
  c.quick = [];
  convoSend();
}
async function convoSend() {
  const c = S.convo;
  if (!c || busy) return;
  const say = $('chatIn').value.trim();
  if (!say) return;
  $('chatIn').value = '';
  c.quick = [];
  c.lines.push({ who: 'me', text: say });
  c.turns++;
  renderConvo();
  if (c.group) await groupTurn(say);
  else await convoTurn(say, null);
}
async function convoTurn(say, judge) {
  const c = S.convo;
  const n = S.npcs.find(x => x.name === c.name);
  if (!n) return;
  setBusy(true, '对面在打字……');
  $('chatBody').insertAdjacentHTML('beforeend', '<div class="bub ta typing">……</div>');
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
  try {
    const d = E.sanitizeConvo(await llmJSON(convoPrompt(n, say, judge), null, { maxTokens: 1200, temperature: 1.05, system: CONVO_SYSTEM }));
    if (d.summary) c.summary = d.summary;
    if (d.gist) c.gist = d.gist;
    c.rel = E.clamp(c.rel + d.rel, -12, 12);          // 一场聊天，关系最多动 12
    if (d.ask && !judge) {
      // 主角开口求他：先不让他回，掷完骰拿结果再回一条
      $('chatBody').querySelectorAll('.typing').forEach(x => x.remove());
      const a = d.ask;
      const ck = E.rollCheck(S, a.attr, a.need + E.TIER_ASK[E.relTier(n.rel)], Math.random);
      ck.what = a.what; ck.kind = a.kind; ck.days = a.days;
      if (ck.success) settleAsk(n, a, ck);
      if (ck.sys) c.lines.push({ who: 'sys', text: ck.sys });
      c.lines.push({ who: 'sys', text: `求他：${ck.what}　${ck.attr}${ck.val}　掷骰${ck.roll}　${ck.total}/${ck.need}　${ck.success ? '成' : '不成'}` });
      renderConvo();
      setBusy(false);
      await convoTurn(say, ck);
      return;
    }
    c.paidNote = '';
    c.quick = d.quick;
    const reps = d.replies.length ? d.replies : [d.reply];
    for (const t of reps.slice(0, -1)) c.lines.push({ who: 'ta', text: t });
    const line = { who: 'ta', text: reps[reps.length - 1], mood: d.mood };
    if (d.pay && !judge) {
      const py = E.payIn(S, n.name, d.pay.amount, d.pay.kind, d.pay.note, 'chat');
      if (py) line.payId = py.id;
      else c.lines.push({ who: 'sys', text: `${n.name}今天拿不出更多了` });
    }
    c.lines.push(line);
    if (line.payId) { const py = E.findPay(S, line.payId); if (py.amount < py.asked) c.lines.push({ who: 'sys', text: `${n.name}最多只拿得出${py.amount}` }); }
    if (d.refund) {
      const mine = c.lines.filter(l => l.who === 'me' && l.payId).map(l => E.findPay(S, l.payId)).filter(p => p && p.state === '已付').pop();
      const bk = mine && E.payBack(S, mine.id);
      if (bk) { c.lines.push({ who: 'sys', text: `${n.name}把${bk.amount - (bk.toDebt || 0)}元退了回来` }); rebuildTop(); }
    }
    for (const dl of d.deal) {
      if (E.addPledge(S, { who: n.name, what: dl.what, kind: dl.kind, inDays: dl.inDays }))
        c.lines.push({ who: 'sys', text: `记下了：${dl.kind === '主角答应' ? '你答应' + n.name : dl.kind === '对方答应' ? n.name + '答应你' : '你回绝了' + n.name}「${dl.what}」` });
    }
    if (d.cold && !c.coldShown) { c.coldShown = true; c.lines.push({ who: 'sys', text: `${n.name}看样子不太想聊了` }); }
    else if (!d.cold) c.coldShown = false;
    renderConvo();
  } catch (e) {
    c.lines.push({ who: 'sys', text: '（没说成：' + (e.message || e) + '）' });
    renderConvo();
  }
  setBusy(false);
  if (S.convo === c && (c.quick || []).length) renderConvo();     // 快捷回复要等对面说完才露出来
  saveGame();
}
/* ---- 群聊 ---- */
function openGroup(id) {
  const g = E.groupList(S).find(x => x.id === id);
  if (!g || busy) return;
  if (S.pending) { toast('上一段还没写完，先把它写出来'); return; }
  convoFrom = curTab || '';
  S.convo = { group: g.id, name: g.name, lines: [], turns: 0, summary: '', gist: g.gist || '', rel: 0, hist: g.msgs.slice(-20) };
  closePanel();
  $('chat').classList.add('on');
  renderConvo();
  $('chatIn').value = '';
  setTimeout(() => $('chatIn').focus(), 200);
}
function groupPrompt(g, say) {
  const c = S.convo;
  const who = g.members.map(m => S.npcs.find(n => n.name === m)).filter(Boolean);
  const mem = who.map(n => `- ${n.name}：${n.gender ? n.gender + '，' : ''}${n.age ? (n.age + (S.date.y - (n.ageY || S.date.y))) + '岁，' : ''}${n.job || '不详'}，主角存的是「${callName(n) || '认识的人'}」，跟主角${relWord(n.rel, n.tie)}${n.care ? '，在意' + n.care : ''}。${n.note || ''}${(n.facts || []).length ? `要一直记着：${n.facts.join('；')}。` : ''}${(n.mem || []).length ? `\n  他记得：${n.mem.slice(-4).join('；')}` : ''}`).join('\n');
  const L = c.lines.filter(l => l.who !== 'sys');
  const keep = L.slice(-30);
  const log = (L.length > keep.length ? `（更早的略，要点是：${c.gist || '闲聊'}）\n` : '') + (keep.map(l => `${l.who === 'me' ? S.player.name : l.from}：${lineText(l)}`).join('\n') || '（刚开口）');
  const past = (c.hist || []).map(m => `${m.date || ''} ${m.me ? S.player.name : m.from}：${lineText(m)}`).join('\n');
  return `${worldRules(true)}

这是主角${S.player.name}拉的微信群「${g.name}」，群里除了主角还有：
${mem}
【主角】${S.player.name}，${S.player.age}岁，${S.player.job}。

${past ? `【群里以前的消息（已经过去了）】\n${past}\n` : ''}${c.gist ? `【这个群聊到现在的要点】${c.gist}\n` : ''}
【这次群里的消息（按先后）】
${log}

【主角刚在群里发的——这一轮大家回的就是它】${say}

怎么写：
- 你同时扮演群里这几个人，只写他们发在群里的话，不写旁白，不替主角说话。
- 消息里叫"${S.player.name}"的都是主角说的；群成员以前发过的话就是他自己说的，接着往下说，别把自己当成旁观的外人。
- 挑一到三个最可能接这句的人回，其余的人不出声。谁回、回什么，要对得上他的身份、性子、跟主角的关系，也对得上他跟群里别人熟不熟。
- 群里的人可以互相接话、抬杠、打岔，像真的微信群：短、口语、有人只回表情或者"哈哈"。
- 只接主角刚发的这句和跟它直接相关的上文，不许去接很早以前的话茬；这次已经说过的话不许再说。
- 有红包的话，抢到的人照引擎分的数说话（手气好的嘚瑟、少的吐槽），没必要每个人都开口。

只输出一个合法 JSON：
{"replies":[{"who":"群里某人的名字","text":"他发的话"}],
"gist":"这个群这次从头到现在的要点，60字内",
"deal":[{"who":"跟主角说定事的那个人","kind":"主角答应|对方答应|主角拒绝","what":"具体的事（20字内）","inDays":几天内办，没期限填0}],
"summary":"一句话（20字内）"}`;
}
async function groupTurn(say) {
  const c = S.convo;
  const g = c && E.groupList(S).find(x => x.id === c.group);
  if (!g) return;
  setBusy(true, '群里有人在打字……');
  $('chatBody').insertAdjacentHTML('beforeend', '<div class="bub ta typing">……</div>');
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
  try {
    const d = E.sanitizeGroup(await llmJSON(groupPrompt(g, say), null, { maxTokens: 1400, temperature: 1.05, system: CHAT_SYSTEM }), g.members);
    if (d.gist) c.gist = d.gist;
    if (d.summary) c.summary = d.summary;
    for (const r of d.replies) c.lines.push({ who: 'ta', from: r.who, text: r.text });
    if (!d.replies.length) c.lines.push({ who: 'sys', text: '群里没人接话' });
    for (const dl of d.deal) {
      if (E.addPledge(S, { who: dl.who, what: dl.what, kind: dl.kind, inDays: dl.inDays }))
        c.lines.push({ who: 'sys', text: `记下了：${dl.kind === '主角答应' ? '你答应' + dl.who : dl.kind === '对方答应' ? dl.who + '答应你' : '你回绝了' + dl.who}「${dl.what}」` });
    }
  } catch (e) {
    c.lines.push({ who: 'sys', text: '（没发出去：' + (e.message || e) + '）' });
  }
  renderConvo();
  setBusy(false);
  saveGame();
}
function endGroup(c, toPanel) {
  const g = E.groupList(S).find(x => x.id === c.group);
  const said = c.lines.filter(l => l.who !== 'sys');
  if (g && said.length) {
    const dt = E.shortDate(S.date);
    for (const l of said) g.msgs.push({ from: l.who === 'me' ? '' : l.from, me: l.who === 'me', text: String(l.text || '').slice(0, 200), date: dt, payId: l.payId });
    g.msgs = g.msgs.slice(-200);
    g.gist = c.gist || g.gist;
    const spoke = new Set(said.filter(l => l.who === 'ta').map(l => l.from));
    for (const m of g.members) {
      const n = S.npcs.find(x => x.name === m);
      if (!n) continue;
      if (spoke.has(m)) n.lastSeen = S.stats.days;
      if (c.gist) E.npcMem(S, n, `在群「${g.name}」里：${c.gist}`);
    }
    S.history.push({ seg: S.seg, date: dt, summary: `在群「${g.name}」里聊：${c.summary || '说了会儿话'}` });
  }
  S.convo = null;
  $('chat').classList.remove('on');
  saveGame(); rebuildTop();
  const back = convoFrom; convoFrom = '';
  if (toPanel && back) gotoTab(back);
}
// 建群：勾人、起名
function openMakeGroup() {
  if (S.npcs.length < 2) { toast('通讯录里人还太少'); return; }
  const list = S.npcs.slice().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  $('npcBox').innerHTML = `<h2>发起群聊</h2><div class="tip" style="margin-top:-10px">勾两到八个人。</div>
    <div class="card gpick" style="margin-top:14px">${list.map(n => `<label class="li gli"><input type="checkbox" value="${esc(n.name)}"/>${faceHtml(S, n.name, 'sm')}<b>${esc(n.name)}</b><span class="rel">${esc(callName(n) || '')}</span></label>`).join('')}</div>
    <div class="frow"><label>群名</label><input id="gName" placeholder="不填就用名字拼" maxlength="14"/></div>
    <div class="btns"><button class="ghost" onclick="mask('npcMask',false)">算了</button><button class="primary" onclick="doMakeGroup()">建群</button></div>`;
  mask('npcMask', true);
}
function doMakeGroup() {
  const picked = [...document.querySelectorAll('.gpick input:checked')].map(x => x.value);
  if (picked.length < 2) { toast('至少勾两个人'); return; }
  if (picked.length > 8) { toast('最多八个人'); return; }
  const g = E.makeGroup(S, picked, $('gName').value);
  if (!g) { toast('建不起来'); return; }
  mask('npcMask', false);
  saveGame();
  openGroup(g.id);
}

// 聊天里求的事，答应了就得有着落：钱到账、约上面试、记进约定
function settleAsk(n, a, ck) {
  const rng = Math.random;
  if (a.kind === 'borrow' && a.money > 0) {
    const cap = E.lendCap(S, n);
    const amt = Math.min(Math.round(a.money), cap);
    const days = a.days || 60;
    E.addDebt(S, n.name, amt, days);
    ck.money = amt;
    ck.note = amt < a.money ? `${n.name}最多只拿得出${amt}元（主角开口要的是${a.money}），借了${amt}，${days}天内还` : `借了${amt}元，${days}天内还`;
    ck.sys = `${n.name}给你转了${amt}${amt < a.money ? `（你要的是${a.money}，他只拿得出这么多）` : ''}，说好${days}天内还`;
    rebuildTop();
  } else if (a.kind === 'interview' || a.kind === 'intro') {
    const inD = E.rnd(rng, 2, 6), dt = E.addDays(S.date, inD);
    const title = (a.kind === 'interview' ? `${n.name}帮忙约的面试` : `${n.name}介绍的人：${a.what}`).slice(0, 30);
    S.appts.push({ y: dt.y, m: dt.m, d: dt.d, title, kind: a.kind === 'interview' ? '面试' : '约', done: false });
    ck.note = `约在${dt.m}月${dt.d}日（${inD}天后）`;
    ck.sys = `记下了：${dt.m}月${dt.d}日，${title}`;
  } else {
    E.addPledge(S, { who: n.name, what: a.what, kind: '对方答应', inDays: a.days || 14 });
    ck.note = `记成${n.name}答应的事，${a.days || 14}天内办`;
    ck.sys = `记下了：${n.name}答应「${a.what}」`;
  }
}
function endConvo(goOn, toPanel) {
  const c = S.convo;
  if (!c) { $('chat').classList.remove('on'); return; }
  $('plusMenu').classList.remove('on');
  if (c.group) return endGroup(c, toPanel);
  const n = S.npcs.find(x => x.name === c.name);
  const said = c.lines.filter(l => l.who !== 'sys');
  if (n && said.length) {
    E.applyConvo(S, c.name, { rel: c.rel, mem: c.gist || c.summary || said[said.length - 1].text.slice(0, 30) });
    S.recent.push({
      seg: S.seg, action: `找${c.name}聊了聊`,
      narrative: said.map(l => `${l.who === 'me' ? S.player.name : c.name}：${l.text}`).join('\n')
    });
    S.recent = S.recent.slice(-8);
    S.history.push({ seg: S.seg, date: E.shortDate(S.date), summary: `跟${c.name}聊：${c.summary || '说了会儿话'}` });
    const dt = E.shortDate(S.date);
    for (const l of said) S.msgs.push({ from: c.name, me: l.who === 'me', text: String(l.text || '').slice(0, 120), date: dt, kind: 'talk', read: true, payId: l.payId });
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
function momCs(m) {
  if (!m.cs.length) return '';
  return `<div class="momcs">${m.cs.map((c, i) => {
    const mine = c.who === S.player.name;
    return `<div class="mc${mine ? '' : ' tap'}"${mine ? '' : ` onclick="doComment('${m.id}','${esc(c.who)}')"`}><b>${esc(c.who)}</b>${c.to ? `<i>回复</i><b>${esc(c.to)}</b>` : ''}：${esc(c.text)}</div>`;
  }).join('')}</div>`;
}
function renderMoments() {
  const ms = (S.moments || []).slice().reverse();
  for (const m of (S.moments || [])) m.read = true;
  saveGame();
  return `<div class="mombox">
    <div class="mompost"><input id="momIn" placeholder="说点什么…" maxlength="60"/><button class="act-go" onclick="postMoment()">发</button></div>
    ${ms.length ? ms.map(m => {
      const mine = m.who === S.player.name;
      const lk = (m.likers || []).slice();
      if (m.liked && !mine) lk.unshift(S.player.name);
      const more = Math.max(0, E.num(m.likes) - lk.length);
      const likeLine = lk.length || more ? `<div class="momlike">♥ ${lk.map(esc).join('、')}${lk.length && more ? ` 等${E.num(m.likes)}人` : !lk.length ? `${more}人` : ''}</div>` : '';
      return `<div class="mom">
        ${faceHtml(S, m.who, '', m.y)}
        <div class="mombody">
          <div class="momwho">${esc(m.who)}${mine ? '<em>我</em>' : ''}</div>
          <div class="momtext">${esc(m.text)}</div>
          <div class="momfoot"><span>${esc(m.date)}</span>
            ${mine ? '' : `<button class="${m.liked ? 'on' : ''}" onclick="doLike('${m.id}')">${m.liked ? '已赞' : '赞'}</button>`}
            <button onclick="doComment('${m.id}','')">留言</button></div>
          ${likeLine || m.cs.length ? `<div class="momsoc">${likeLine}${momCs(m)}</div>` : ''}
        </div></div>`;
    }).join('') : '<div class="card tip">还没人发东西</div>'}
    <div class="tip">点别人的留言可以直接回复他。</div>
  </div>`;
}
function doLike(id) {
  E.likeMoment(S, id);
  saveGame(); renderPanel();
}
// 朋友圈里的人：身份、跟主角的关系、记得什么
function momPeople(names) {
  return names.map(w => S.npcs.find(n => n.name === w)).filter(Boolean).map(n =>
    `- ${n.name}：${n.gender ? n.gender + '，' : ''}${n.age ? (n.age + (S.date.y - (n.ageY || S.date.y))) + '岁，' : ''}${n.job || '不详'}，主角存的是「${callName(n) || '认识的人'}」，跟主角${relWord(n.rel, n.tie)}${n.care ? '，在意' + n.care : ''}${(n.facts || []).length ? `；要一直记着：${n.facts.join('；')}` : ''}${(n.mem || []).length ? `；他记得：${n.mem.slice(-3).join('；')}` : ''}`).join('\n');
}
// 留言串：标清楚哪条是主角、哪条是发帖人自己
function momThread(m) {
  const tag = w => w === S.player.name ? `${w}【主角】` : w === m.who ? `${w}【发帖人】` : w;
  return m.cs.map(c => `${tag(c.who)}${c.to ? ' 回复 ' + tag(c.to) : ''}：${c.text}`).join('\n') || '（还没人留言）';
}
// 主角留言 / 回复某人之后，底下谁来接
// 朋友圈里说定的事，跟聊天里说定的一样进承诺表
function momDeals(list, ok) {
  for (const dl of (Array.isArray(list) ? list : []).slice(0, 2)) {
    const x = E.sanitizeGroup({ deal: [dl] }, [...ok]).deal[0];
    if (!x) continue;
    const who = E.whoIs(S, x.who);
    if (E.addPledge(S, { who, what: x.what, kind: x.kind, inDays: x.inDays }))
      toast(`记下了：${x.kind === '主角答应' ? '你答应' + who : x.kind === '对方答应' ? who + '答应你' : '你回绝了' + who}「${x.what}」`);
  }
}
async function doComment(id, to) {
  const m = (S.moments || []).find(x => x.id === id);
  if (!m || busy) return;
  if (to === S.player.name) to = '';
  const txt = await ask({ title: to ? `回复${to}` : `在${m.who === S.player.name ? '自己的' : m.who + '的'}朋友圈底下留言`, quote: m.text, input: { placeholder: '说点什么', max: 60 }, ok: '发' });
  if (!txt) return;
  E.commentMoment(S, id, S.player.name, txt, to || (m.who !== S.player.name ? '' : ''));
  saveGame(); renderPanel();
  const cand = [...new Set([to, m.who, ...m.cs.slice(-6).map(c => c.who)])].filter(w => w && w !== S.player.name && S.npcs.some(n => n.name === w)).slice(0, 4);
  if (!cand.length) return;
  setBusy(true, '对面在看……');
  try {
    const d = await llmJSON(`${worldRules(true)}

${m.who === S.player.name ? `主角${S.player.name}自己` : m.who}在朋友圈发了一条：「${m.text}」（${m.date}）
【底下的留言（按先后）】
${momThread(m)}

【主角刚发的】${S.player.name}${to ? ' 回复 ' + to : ''}：「${txt}」

【可能接话的人】
${momPeople(cand)}

这一轮写谁会接主角刚发的这句。先认清人：
- ${S.player.name}就是主角。留言串里叫"${S.player.name}"的每一条都是主角说的。
- 【可能接话的人】里的每个人，就是留言串里同名的那个人：他以前在底下说过的话就是他自己说的，接着那些话往下说，不许把自己当成旁观的第三个人，不许把主角和自己说成"你俩"。${m.who !== S.player.name ? `\n- 这条朋友圈是${m.who}自己发的，${m.who}回话时是在自己的朋友圈底下回别人。` : ''}
- 回主角的话里，"你"指的是主角。

要求：
- 从【可能接话的人】里挑零到两个人。被回复的人和发帖的人最可能接，但关系远、不想搭理、或者这句话不值得回的，可以不回（cs 留空）。
- 接的话要针对主角刚发的这句，不许重复底下已有的话，十五字以内，像真人在朋友圈底下回复：玩笑、敷衍、一个表情、顺嘴问一句都行。
- to 写他回复的是谁（通常是主角，也可以是底下别的人）。
- rel 是这一来一回让他跟主角近了还是远了，-2 到 2。

- 这一来一回里要是真说定了什么（答应来借住、约了吃饭、答应帮忙），写进 deal；只是嘴上开玩笑的不算。

只输出一个合法 JSON：{"cs":[{"who":"","to":"","text":"","rel":0}],"deal":[{"who":"跟主角说定事的那个人","kind":"主角答应|对方答应|主角拒绝","what":"具体的事（20字内）","inDays":几天内办，没期限填0}]}`, null, { maxTokens: 600, temperature: 1.05, system: CHAT_SYSTEM });
    const ok = new Set(cand), replied = [];
    for (const c of (Array.isArray(d.cs) ? d.cs : []).slice(0, 2)) {
      const w = c && E.whoIs(S, String(c.who || '').trim());
      if (!w || !ok.has(w) || !c.text) continue;
      const toW = c.to ? E.whoIs(S, String(c.to).trim()) : S.player.name;
      E.commentMoment(S, id, w, String(c.text).slice(0, 60), toW === w ? '' : toW);
      const n = S.npcs.find(x => x.name === w);
      if (n) { E.momentRel(S, n, E.num(c.rel)); n.lastSeen = S.stats.days; E.npcMem(S, n, `朋友圈里主角说「${txt.slice(0, 16)}」，他回「${String(c.text).slice(0, 16)}」`); }
      replied.push(`${w}回「${String(c.text).slice(0, 16)}」`);
    }
    momDeals(d.deal, ok);
    S.history.push({ seg: S.seg, date: E.shortDate(S.date), summary: `朋友圈：在${m.who === S.player.name ? '自己' : m.who}那条底下${to ? '回' + to : ''}说「${txt.slice(0, 16)}」${replied.length ? '，' + replied.join('，') : '，没人回'}` });
    S.history = S.history.slice(-120);
    saveGame(); renderPanel();
  } catch (e) { toast(e.message || '没人回'); }
  setBusy(false);
}
// 主角发朋友圈：挑能看见、会搭理的人
function momAudience(text) {
  return S.npcs.filter(n => n.rel >= 15).map(n => {
    const gap = S.stats.days - (n.lastSeen || 0);
    let sc = E.num(n.rel) + Math.max(0, 20 - gap) * 0.6 + (isKin(n.tie) ? 6 : 0);
    if (text.indexOf(n.name) >= 0 || (callName(n) && text.indexOf(callName(n)) >= 0)) sc += 60;
    return { n, sc };
  }).sort((a, b) => b.sc - a.sc).slice(0, 8).map(x => x.n);
}
async function postMoment() {
  const v = ($('momIn').value || '').trim();
  if (!v || busy) return;
  $('momIn').value = '';
  const mm = E.addMoment(S, S.player.name, v, 'me');
  saveGame(); renderPanel();
  const cand = momAudience(v);
  if (!cand.length) { S.history.push({ seg: S.seg, date: E.shortDate(S.date), summary: `朋友圈：发了「${v.slice(0, 20)}」，没人看见` }); saveGame(); return; }
  setBusy(true, '发出去了……');
  try {
    const d = await llmJSON(`${worldRules(true)}

${S.player.name}在朋友圈发了一条：「${v}」

【能看见的人】
${momPeople(cand.map(n => n.name))}

写这条朋友圈底下的动静。${S.player.name}就是主角，这条是主角自己发的；【能看见的人】里每个人都是以自己的身份在主角的朋友圈底下说话。要求：
- likes：谁点了赞（顺手点个赞的人，关系近的、刚联系过的更可能）。
- cs：一到三条留言。每条十五字以内，像真人在朋友圈底下说话——玩笑、敷衍的表情、答非所问、顺嘴提一件别的事都行，要对得上他的身份和他记得的事。不许所有人都夸。关系远的可以只点赞或者不吭声。
- 留言的人之间认识的，可以互相接一句（to 写回复谁），不回复别人就把 to 留空。
- rel 是他看了这条之后跟主角近了还是远了，-2 到 2。

- 底下要是真有人跟主角说定了什么（约饭、要来串门），写进 deal；开玩笑的不算。

只输出一个合法 JSON：{"likes":["名字"],"cs":[{"who":"谁","to":"","text":"留言","rel":0}],"deal":[{"who":"","kind":"主角答应|对方答应|主角拒绝","what":"","inDays":0}]}`, null, { maxTokens: 700, temperature: 1.08, system: CHAT_SYSTEM });
    const ok = new Set(cand.map(n => n.name));
    for (const l of (Array.isArray(d.likes) ? d.likes : []).slice(0, 8)) if (ok.has(E.whoIs(S, String(l).trim()))) E.addLiker(S, mm, String(l).trim());
    for (const c of (Array.isArray(d.cs) ? d.cs : []).slice(0, 3)) {
      const w = c && E.whoIs(S, String(c.who || '').trim());
      if (!w || !ok.has(w) || !c.text) continue;
      const toW = c.to ? E.whoIs(S, String(c.to).trim()) : '';
      E.commentMoment(S, mm.id, w, String(c.text).slice(0, 60), toW && toW !== w && (ok.has(toW) || toW === S.player.name) ? toW : '');
      const n = S.npcs.find(x => x.name === w);
      if (n) { E.momentRel(S, n, E.num(c.rel)); E.npcMem(S, n, `朋友圈看见主角发「${v.slice(0, 16)}」，留言「${String(c.text).slice(0, 16)}」`); }
    }
    momDeals(d.deal, ok);
    S.history.push({ seg: S.seg, date: E.shortDate(S.date), summary: `朋友圈：发了「${v.slice(0, 20)}」${mm.cs.length ? `，${mm.cs.slice(0, 2).map(c => c.who + '回' + String(c.text).slice(0, 10)).join('，')}` : '，没人留言'}` });
    S.history = S.history.slice(-120);
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
  out.push(`<h4>住处</h4><div class="card">${artImg(HOME_ART[H.kind], '', H.kind === '买' ? '自己的房子' : '租的房子')}`);
  if (H.kind === '买') {
    const left = H.loan && !H.loan.done ? H.loan.left : 0;
    out.push(`<div class="big">自己的房子</div>
      <div class="lines" style="margin-top:8px">
        <div><b>买下来</b><span>${esc(H.since)}｜${H.price}元</span></div>
        ${left ? `<div><b>还欠银行</b><span class="bad">${left}</span></div><div><b>月供</b><span>${H.loan.monthly}｜已还${H.loan.paid}期</span></div>` : '<div><b>贷款</b><span class="good">还清了</span></div>'}
        <div><b>净值</b><span class="good">${E.homeWorth(S)}</span></div>
      </div>`);
  } else {
    const tier = E.homeTier(S);
    out.push(`<div class="big">${esc(tier)}</div>
      <div class="lines" style="margin-top:8px"><div><b>房租</b><span>${S.ledger.rent}/月</span></div>${H.since ? `<div><b>搬进来</b><span>${esc(H.since)}</span></div>` : ''}</div>
      <div class="tip">${esc(houseLine(tier))}</div>
      <div class="btns"><button class="ghost" onclick="openMove()">换个地方住</button></div>
      <div class="tip">买一套要 ${b.price}，首付 ${b.down}，之后每月供 ${b.monthly}。买了就没有房租，但三十年绑在这儿。</div>
      <div class="btns"><button class="${b.ok ? 'primary' : 'ghost'}" ${b.ok ? '' : 'disabled'} onclick="doBuyHouse()">${b.ok ? '付首付，买' : `首付还差 ${b.down - S.player.money}`}</button></div>`);
  }
  out.push(`</div>`);
  out.push(`<h4>逛逛</h4><div class="card"><div class="tip">吃的喝的、衣服、数码、书和课、家用、健康、礼物。买了自己用，或者送人。</div>
    <div class="btns"><button class="ghost" onclick="openShop(null,'')">去逛逛</button></div></div>`);

  // 身边的人
  out.push(`<h4>伴侣</h4><div class="card">`);
  if (P) {
    const warmWord = P.warm >= 75 ? '热乎着' : P.warm >= 50 ? '还好' : P.warm >= 25 ? '淡了' : '快过不下去了';
    out.push(`<div class="cardhead">${faceHtml(S, P.name, 'md')}<div class="big">${esc(P.name)}</div></div>
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
  { const hd = div.querySelector('.chaphead'); if (hd) hd.insertAdjacentHTML('afterend', artImg(endingArt(sc, reason), 'ending', '')); }
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
    ${B.dead ? '' : artImg(BIZ_ART[B.kind], '', B.kind)}
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
  if (S.pending) { toast('上一段还没写完，先把它写出来'); return; }
  if (S.promiseAsk) { toast('先把约好的事定下来'); return; }
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
  S.actTyped = false; S.plan = null; S.lastAction = heal ? `接下来这${days}天，先把身体养回来（${what}）` : `接下来这${days}天，闷头${what}`;
  saveGame();
  runSegment();
}


/* ================= 生活：住处、找活、兼职、乐子、商店、送礼 ================= */
function sheet(html) { $('npcBox').innerHTML = html; mask('npcMask', true); }
function sheetOff() { mask('npcMask', false); }
function canAct() {
  if (busy || !S || S.over) return false;
  if (S.pending) { toast('上一段还没写完，先把它写出来'); return false; }
  if (S.promiseAsk) { toast('先把约好的事定下来'); return false; }
  return true;
}
const sgn = v => (v >= 0 ? '+' : '') + v;
// 引擎先把账办完，再写一段故事：结果写死，模型只写过程
async function lifeSeg(action, note, who, span) {
  span = span || 0;
  if (span === 0) E.useSlot(S);
  S.lastAction = action; S.actTyped = false;
  const st = { type: who ? 'meet' : 'other', who: who || undefined, text: action.slice(0, 30), diff: '顺手' };
  S.plan = { steps: [st], results: [{ type: st.type, text: st.text, ok: true, note, ck: null, who: who || undefined }], limits: [], style: [], days: 1, stopWhen: null, parsed: true };
  sheetOff();
  if (S.convo) endConvo(false);
  closePanel();
  saveGame(); rebuildTop();
  await runSegment({ quick: true, span });
}

/* ---- 住处 ---- */
function houseLine(k) {
  const H = E.HOUSING[k];
  return `${H.desc}｜${H.far}｜${H.en ? `睡这儿每天精力${sgn(H.en)}` : '睡得一般'}${H.commute > 0 ? `，上班的日子路上再耗${H.commute}` : H.commute < 0 ? '，上班的日子少耗1' : ''}`;
}
function openMove() {
  if (!canAct()) return;
  if (S.home.kind === '买') { toast('住的是自己的房子'); return; }
  const cur = E.homeTier(S);
  sheet(`<h2>换个地方住</h2><div class="tip" style="margin-top:-10px">搬一次要付中介费和搬家费，大约半个月房租。</div>
    <div class="card" style="margin-top:14px">${Object.keys(E.HOUSING).map(k => `<div class="li${k === cur ? '' : ' tap'}" ${k === cur ? '' : `onclick="doMove('${k}')"`}>
      <b>${k}</b><span class="rel">${E.rentFor(S, k)}/月${k === cur ? '　眼下住这儿' : `　搬过去${E.moveCost(S, k)}`}</span><div class="tip">${esc(houseLine(k))}</div></div>`).join('')}</div>
    <div class="btns"><button class="ghost" onclick="sheetOff()">算了</button></div>`);
}
async function doMove(k) {
  sheetOff();
  if (!await ask({ title: `搬去${k}？`, text: `中介费加搬家 ${E.moveCost(S, k)} 元，往后房租每月 ${E.rentFor(S, k)}。`, ok: '搬' })) return;
  const r = E.moveHome(S, k);
  if (!r.ok) { toast(r.why); return; }
  toast(`搬进了${k}`);
  await lifeSeg(`搬家：从${r.from}搬进${k}`, r.note, '', 1);
}

/* ---- 商店、背包、送礼 ---- */
let shopCat = '吃的喝的', shopFor = '';
function itemDesc(it) {
  const a = [];
  const u = it.use || {}, f = it.fx || {};
  if (u.en) a.push(`精力+${u.en}`);
  if (u.attr) for (const k in u.attr) a.push(`${k}+${u.attr[k]}`);
  if (u.heal) a.push('病好得快');
  if (u.eased) a.push('老毛病能松些');
  if (f.formal) a.push('面试、谈事底气足');
  if (f.charm) a.push('跟人处更顺');
  if (f.workX) a.push(`闷头干活快${Math.round(f.workX * 100)}%`);
  if (f.camera) a.push('拍东西的活快');
  if (f.sleep) a.push(`每天精力+${f.sleep}`);
  if (f.cert) a.push('考公、考证的门槛');
  if (f.back) a.push('有老毛病时每天精力+1');
  if (f.gymX) a.push('健身的劲头足');
  if (it.gift) a.push('专门送人');
  if (it.wear) a.push(`用${Math.round(it.wear / 365)}年开始旧`);
  if (it.uses > 1) a.push(`能用${it.uses}次`);
  return a.join('，');
}
function openShop(cat, forWho) {
  if (busy) return;
  if (cat) shopCat = cat;
  if (forWho !== undefined) shopFor = forWho;
  const fr = E.shopFriend(S, shopCat);
  const list = E.ITEMS.filter(x => x.cat === shopCat);
  sheet(`<h2>逛逛${shopFor ? `<span class="tip">　给${esc(shopFor)}挑</span>` : ''}</h2>
    <div class="segs shopcats">${E.SHOP_CATS.map(c => `<button class="seg${c === shopCat ? ' on' : ''}" onclick="openShop('${c}')">${c}</button>`).join('')}</div>
    ${fr ? `<div class="tip">${esc(fr.name)}干这行，找他拿${Math.round(fr.off * 10)}折</div>` : ''}
    <div class="card">${list.map(it => {
      const pr = E.itemPrice(S, it), off = fr ? Math.round(pr * fr.off / 10) * 10 : pr;
      const own = it.keep && E.hasItem(S, it.id);
      return `<div class="li"><div class="lirow"><b>${esc(it.name)}</b><span class="rel">${fr ? `<s>${pr}</s> ${off}` : pr}元</span></div>
        <div class="tip">${esc(itemDesc(it))}${it.tags.length ? `｜送人：${it.tags.join('、')}` : ''}${it.note ? '｜' + esc(it.note) : ''}</div>
        <div class="lirow">${own ? '<span class="tip">已经有了</span>' : `${shopFor ? '' : `<button class="ghost sm" onclick="doBuy('${it.id}',false)">买</button>`}${fr ? `<button class="ghost sm" onclick="doBuy('${it.id}',true)">找${esc(fr.name)}买</button>` : ''}${shopFor || !it.keep ? `<button class="ghost sm" onclick="doBuy('${it.id}',${fr ? 'true' : 'false'},'${esc(shopFor) || '?'}')">${shopFor ? `买了送${esc(shopFor)}` : '买了送人'}</button>` : ''}`}</div></div>`;
    }).join('')}</div>
    <div class="tip">账上 ${S.player.money} 元。${E.bag(S).length ? `包里有 ${E.bag(S).length} 样东西，在「我」里看。` : ''}</div>
    <div class="btns"><button class="ghost" onclick="shopFor='';sheetOff()">走了</button></div>`);
}
async function doBuy(id, via, giveTo) {
  const r = E.buyItem(S, id, via);
  if (!r.ok) { toast(r.why); return; }
  toast(`买了${r.item.name}，${r.price}元`);
  rebuildTop(); saveGame();
  if (giveTo === '?') { pickGiveTarget(r.item.uid); return; }
  if (giveTo) { shopFor = ''; await doGive(giveTo, r.item.uid); return; }
  openShop();
  if (curTab) renderPanel();
}
function bagHtml() {
  const B = E.bag(S);
  if (!B.length) return '<div class="tip">手里没什么值得一提的东西。缺什么去「家」里逛逛。</div>';
  return B.map(b => {
    const it = E.itemOf(b.id) || {};
    return `<div class="li"><div class="lirow"><b>${esc(b.name)}</b><span class="rel">${b.date}买的${b.uses > 1 ? `｜还能用${b.uses}次` : ''}${E.itemOld(S, b) ? '｜<u>旧了，开始卡</u>' : ''}</span></div>
      <div class="tip">${esc(itemDesc(it))}</div>
      <div class="lirow">${!b.keep && !b.gift ? `<button class="ghost sm" onclick="doUse(${b.uid})">用了</button>` : ''}<button class="ghost sm" onclick="pickGiveTarget(${b.uid})">送人</button></div></div>`;
  }).join('');
}
function doUse(uid) {
  const r = E.useItem(S, uid);
  if (!r.ok) { toast(r.why); return; }
  toast(r.note);
  rebuildTop(); renderPanel(); saveGame();
}
function pickGiveTarget(uid) {
  const b = E.bag(S).find(x => x.uid === uid);
  if (!b) return;
  if (S.convo && !S.convo.group) { doGive(S.convo.name, uid); return; }
  const cand = S.npcs.slice().sort((a, b2) => b2.rel - a.rel).slice(0, 30);
  sheet(`<h2>把${esc(b.name)}送给谁</h2><div class="tip" style="margin-top:-10px">见面送过去。太贵的东西，关系不到的人可能不收。</div>
    <div class="card" style="margin-top:14px">${cand.map(n => `<div class="li tap" onclick="doGive('${esc(n.name)}',${uid})"><b>${esc(n.name)}</b><span class="rel">${relWord(n.rel, n.tie)}</span>
      <div class="tip">${esc(callName(n))}${n.care ? '｜在意' + esc(n.care) : ''}</div></div>`).join('') || '<div class="tip">还不认识什么人</div>'}</div>
    <div class="btns"><button class="ghost" onclick="sheetOff()">算了</button></div>`);
}
async function doGive(name, uid) {
  sheetOff();
  const c = S.convo;
  const inChat = c && !c.group && c.name === name;
  if (!inChat && !canAct()) return;
  const span = inChat ? 0 : await pickSpan(0);
  if (span === null) return;
  const r = E.giveItem(S, name, uid, Math.random);
  if (!r.ok) { toast(r.why); return; }
  saveGame();
  if (inChat) {
    c.lines.push({ who: 'me', text: `[送了你${r.item.name}]` });
    c.lines.push({ who: 'sys', text: r.back ? `${name}没收，${r.item.name}还在你这儿` : `${name}收下了${r.item.name}` });
    c.paidNote = `主角刚送了你${r.item.name}（${r.item.price}元）。引擎算好的：${r.note}。${r.back ? '你这一轮要把东西推回去，说清楚为什么不收。' : '照这个反应：对上心意就真高兴，没对上也别装。'}`;
    renderConvo();
    await convoTurn(`[送了你${r.item.name}]`, null);
    return;
  }
  toast(r.back ? `${name}没收` : `${name}收下了`);
  await lifeSeg(`去给${name}送${r.item.name}`, r.note, name, span);
}
function chatGift() {
  $('plusMenu').classList.remove('on');
  const c = S.convo;
  if (!c || c.group) return;
  const B = E.bag(S);
  sheet(`<h2>送${esc(c.name)}点东西</h2>
    <div class="card">${B.map(b => `<div class="li tap" onclick="doGive('${esc(c.name)}',${b.uid})"><b>${esc(b.name)}</b><span class="rel">${b.price}元</span><div class="tip">${b.tags.join('、')}</div></div>`).join('') || '<div class="tip">包里没东西可送</div>'}</div>
    <div class="btns"><button class="ghost" onclick="sheetOff()">算了</button><button class="primary" onclick="openShop('礼物','${esc(c.name)}')">现买一样</button></div>`);
}

/* ---- 找点乐子 ---- */
let funPick = null;
function openFun() {
  if (!canAct()) return;
  sheet(`<h2>找点乐子</h2><div class="tip" style="margin-top:-10px">钱、精力、关系引擎先算好，再写这一趟。同一样天天去会腻。</div>
    <div class="card" style="margin-top:14px">${E.FUN.map(f => {
      const c = E.funCost(S, f, 0, false);
      const fx = [];
      if (f.fx.en) fx.push(`精力${sgn(f.fx.en)}`);
      if (f.fx.attr) for (const k in f.fx.attr) fx.push(`${k}+${f.fx.attr[k]}`);
      if (f.fx.cap) fx.push('精力上限慢慢涨');
      if (f.fx.heal) fx.push('毛病好得快');
      if (f.meet) fx.push('可能认识新人');
      if (f.fx.drunk) fx.push('喝多了第二天难受');
      if (f.fx.game) fx.push('玩多了耽误正事');
      return `<div class="li tap" onclick="openFunWith('${f.id}')"><b>${f.name}</b><span class="rel">${c ? c + '元' + (f.per ? '/人' : '') : '不花钱'}｜${f.when}</span><div class="tip">${fx.join('，')}</div></div>`;
    }).join('')}</div>
    <div class="btns"><button class="ghost" onclick="sheetOff()">算了</button></div>`);
}
function openFunWith(id) {
  const f = E.funOf(id);
  funPick = { id, treat: false };
  const cand = S.npcs.filter(n => E.relTier(n.rel) >= 1 && !/前任|前妻|前夫/.test(n.tie || '')).sort((a, b) => b.rel - a.rel).slice(0, 14);
  sheet(`<h2>${f.name}</h2><div class="tip" style="margin-top:-10px">叫上谁？最多三个。不熟的人不一定来。</div>
    <div class="card" style="margin-top:14px">${cand.map(n => `<label class="li chk"><input type="checkbox" value="${esc(n.name)}" class="funwho"/> <b>${esc(n.name)}</b><span class="rel">${relWord(n.rel, n.tie)}</span></label>`).join('') || '<div class="tip">没什么人能叫，自己去</div>'}</div>
    ${f.per ? `<div class="segs" id="funPay"><button class="seg on" onclick="setFunPay(false)">AA</button><button class="seg" onclick="setFunPay(true)">我请</button></div>` : ''}
    <div class="btns"><button class="ghost" onclick="openFun()">换一样</button><button class="primary" onclick="doFunGo()">去</button></div>`);
}
function setFunPay(t) {
  funPick.treat = t;
  $('funPay').querySelectorAll('.seg').forEach((b, i) => b.classList.toggle('on', (i === 1) === t));
}
async function doFunGo() {
  const who = [...document.querySelectorAll('.funwho:checked')].map(x => x.value).slice(0, 3);
  sheetOff();
  const span = await pickSpan(funPick.id === 'trip' ? 2 : funPick.id === 'show' ? 1 : 0);
  if (span === null) return;
  const r = E.doFun(S, funPick.id, who, funPick.treat, Math.random);
  if (!r.ok) { toast(r.why); return; }
  sheetOff();
  if (r.no.length) toast(`${r.no.join('、')}没来`);
  await lifeSeg(`${r.came.length ? `叫上${r.came.join('、')}` : '一个人'}去${r.fun.name}`, r.note, r.came[0], span);
}

/* ---- 招聘 ---- */
function openBoard() {
  if (busy) return;
  const B = E.jobBoard(S, Math.random);
  saveGame();
  sheet(`<h2>招聘</h2><div class="tip" style="margin-top:-10px">投了先过筛，过了约面试；面试谈成，岗位和月薪照这里记。${E.boardNext(S) ? `${E.boardNext(S)}天后换一批。` : ''}</div>
    <div class="card" style="margin-top:14px">${B.list.map(P => `<div class="li"><div class="lirow"><b>${esc(P.employer)}·${esc(P.job)}</b><span class="rel">${P.lo}–${P.hi}${P.vary ? '（看提成）' : ''}</span></div>
      <div class="tip">看${P.attr}｜${E.STRAIN[P.strain]}活${P.cert ? '｜要先考试（考证班）' : ''}</div>
      <div class="lirow">${P.state ? `<span class="tip">${P.state}</span>` : `<button class="ghost sm" onclick="doApply(${P.id})">投简历</button>`}</div></div>`).join('')}</div>
    <div class="btns"><button class="ghost" onclick="sheetOff()">关掉</button></div>`);
}
function doApply(id) {
  const r = E.applyPost(S, id, Math.random);
  if (!r.ok) { toast(r.why); return; }
  toast(r.pass ? `过筛了：${r.date.m}月${r.date.d}日去面试` : `${r.post.employer}没回音（${r.ck.attr}${r.ck.val}，掷骰${r.ck.roll}，${r.ck.total}/${r.ck.need}）`);
  saveGame(); openBoard(); if (curTab) renderPanel();
}

/* ---- 兼职 ---- */
function gigCard() {
  const G = S.gigs || [];
  const off = S.gigOffer && S.stats.days - S.gigOffer.day <= 14 && !G.some(x => x.name === S.gigOffer.gig) ? S.gigOffer : null;
  return `${G.map(g => `<div class="li"><div class="lirow"><b>${esc(g.name)}</b><span class="rel">${E.gigWhen(g.name)}</span></div>
      <div class="tip">一次大概${E.gigPay(S, g.name)}，耗精力${E.GIGS[g.name].en}｜${esc(g.since)}起做了${g.times}次，一共挣了${E.num(g.total) + E.num(g.owed)}${g.owed ? `（这周的${g.owed}周日结）` : ''}</div>
      <div class="lirow"><button class="ghost sm" onclick="doDropGig('${esc(g.name)}')">不干了</button></div></div>`).join('') || '<div class="tip">没在做兼职</div>'}
    ${off ? `<div class="li"><b>${esc(off.who)}介绍的${esc(off.gig)}</b><div class="tip">${E.gigWhen(off.gig)}，一次大概${E.gigPay(S, off.gig)}</div><div class="lirow"><button class="ghost sm" onclick="doTakeGig('${esc(off.gig)}',true)">接</button></div></div>` : ''}
    <div class="btns"><button class="ghost" onclick="openGigs()">找份兼职</button></div>
    <div class="tip">最多两份。做兼职那个时段就干不了别的，日程照它排。</div>`;
}
function openGigs() {
  const G = E.GIGS;
  sheet(`<h2>兼职</h2><div class="tip" style="margin-top:-10px">每周按次数记钱，周日结。</div>
    <div class="card" style="margin-top:14px">${Object.keys(G).map(k => `<div class="li tap" onclick="doTakeGig('${k}')"><div class="lirow"><b>${k}</b><span class="rel">一次约${E.gigPay(S, k)}</span></div>
      <div class="tip">${esc(G[k].desc)}｜${E.gigWhen(k)}｜耗精力${G[k].en}｜靠${G[k].attr}${G[k].edu ? '｜要本科' : ''}</div></div>`).join('')}</div>
    <div class="btns"><button class="ghost" onclick="sheetOff()">关掉</button></div>`);
}
function doTakeGig(k, offer) {
  const r = E.takeGig(S, k);
  if (!r.ok) { toast(r.why); return; }
  if (offer && S.gigOffer) { const nn = S.npcs.find(x => x.name === S.gigOffer.who); if (nn) nn.rel = E.clamp(nn.rel + 1, 0, 100); S.gigOffer = null; }
  toast(r.note);
  sheetOff(); saveGame(); renderPanel();
}
async function doDropGig(k) {
  if (!await ask({ title: `不做${k}了？`, text: '这周做了的钱现在结给你。', ok: '不做了' })) return;
  const g = E.dropGig(S, k);
  if (g) toast(`${k}不做了${g.owed ? `，结了${g.owed}` : ''}`);
  saveGame(); rebuildTop(); renderPanel();
}


/* ---- 银行：手机银行办，不占时间 ---- */
const yuan = v => Math.round(v).toLocaleString('zh-CN');
function bankCard() {
  const B = E.bankOf(S);
  const fv = E.fundValue(S);
  const L = B.loans.filter(x => x.left > 0);
  const li = (title, right, tip, btns) => `<div class="li"><div class="lirow"><b>${title}</b><span class="rel">${right}</span></div>${tip ? `<div class="tip">${tip}</div>` : ''}${btns ? `<div class="lirow">${btns}</div>` : ''}</div>`;
  const rows = [];
  for (const f of B.fixed) rows.push(li(`定期${f.term === 36 ? '三年' : f.term === 12 ? '一年' : '三个月'}`, yuan(f.amount), `年利率${(f.rate * 100).toFixed(1)}%｜${esc(f.due)}到期，到期自动转回账上`, `<button class="ghost sm" onclick="bankDo('fixedOut',${f.id})">提前取</button>`));
  if (B.mmf >= 1) rows.push(li('货币基金', yuan(Math.floor(B.mmf)), `年化1.5%上下，累计收益${yuan(B.mmfGain)}`, `<button class="ghost sm" onclick="bankDo('mmfOut')">取出来</button>`));
  for (const w of B.wm) rows.push(li('银行理财', yuan(w.amount), `业绩基准${(w.rate * 100).toFixed(1)}%｜${esc(w.due)}到期，之前取不出来`));
  if (B.fund.units > 0) rows.push(li('股票基金', yuan(fv), `本金${yuan(B.fund.cost)}，<span class="${fv >= B.fund.cost ? 'good' : 'bad'}">${fv >= B.fund.cost ? '赚' : '亏'}${yuan(Math.abs(fv - B.fund.cost))}</span>｜净值${B.nav.toFixed(3)}`, `<button class="ghost sm" onclick="bankDo('fundOut')">卖掉</button>`));
  for (const l of L) rows.push(li(l.kind, `还欠${yuan(l.left)}`, `每月1号还${yuan(l.monthly)}｜年利率${(l.rate * 100).toFixed(1)}%｜还了${l.paid}/${l.months}期${l.late ? `｜<u>逾期${l.late}个月，欠着${yuan(l.owe)}</u>` : ''}`, `<button class="ghost sm" onclick="bankDo('prepay',${l.id})">提前还</button>`));
  return `<h4>银行</h4><div class="card">
    <div class="lines"><div><b>征信</b><span class="${B.credit < 45 ? 'bad' : B.credit >= 65 ? 'good' : ''}">${E.creditWord(B.credit)}</span></div>
    <div><b>活期</b><span>就是账上的钱，年利率0.1%，季度末结息</span></div></div>
    ${rows.join('') || '<div class="tip">没有存款、理财和贷款。</div>'}
    <div class="btns"><button class="ghost" onclick="openDeposit()">存定期</button><button class="ghost" onclick="openInvest()">买理财</button><button class="ghost" onclick="openLoan()">贷款</button></div>
    <div class="tip">月供扣不出来就是逾期：连着三个月会被催收，征信坏了买房、贷款都难。</div></div>`;
}
function bankAfter(r) {
  if (!r.ok) { toast(r.why); return false; }
  toast(r.note);
  sheetOff(); saveGame(); rebuildTop(); renderPanel();
  return true;
}
async function bankDo(what, id) {
  if (busy) return;
  if (what === 'fixedOut') {
    if (!await ask({ title: '提前取出这笔定期？', text: '提前取，利息只按活期算。', ok: '取' })) return;
    return bankAfter(E.withdrawFixed(S, id));
  }
  if (what === 'mmfOut') {
    const v = await ask({ title: '从货币基金取多少', text: `里面有 ${Math.floor(E.bankOf(S).mmf)}。`, input: { value: String(Math.floor(E.bankOf(S).mmf)), number: true }, ok: '取' });
    if (v === null) return;
    return bankAfter(E.redeem(S, '货币基金', Number(v)));
  }
  if (what === 'fundOut') {
    const v = await ask({ title: '卖多少股票基金', text: `眼下值 ${E.fundValue(S)}，卖出收0.5%手续费。`, input: { value: String(E.fundValue(S)), number: true }, ok: '卖' });
    if (v === null) return;
    return bankAfter(E.redeem(S, '股票基金', Number(v)));
  }
  if (what === 'prepay') {
    const l = E.bankOf(S).loans.find(x => x.id === id);
    const v = await ask({ title: `提前还${l.kind}`, text: `还欠 ${l.left}，账上有 ${S.player.money}。${l.kind === '经营贷' ? '' : '提前还收1%违约金。'}`, input: { value: String(Math.min(l.left, Math.max(0, S.player.money))), number: true }, ok: '还' });
    if (v === null) return;
    return bankAfter(E.prepay(S, id, Number(v)));
  }
}
function openDeposit() {
  sheet(`<h2>存定期</h2><div class="tip" style="margin-top:-10px">定期里的钱扣不了房租和月供，提前取只算活期利息。</div>
    <div class="card" style="margin-top:14px">${[3, 12, 36].map(t => `<div class="li tap" onclick="doDeposit(${t})"><b>${t === 36 ? '三年' : t === 12 ? '一年' : '三个月'}</b><span class="rel">年利率${(E.DEPO[t] * 100).toFixed(1)}%</span></div>`).join('')}</div>
    <div class="btns"><button class="ghost" onclick="sheetOff()">算了</button></div>`);
}
async function doDeposit(t) {
  sheetOff();
  const v = await ask({ title: `存${t === 36 ? '三年' : t === 12 ? '一年' : '三个月'}定期`, text: `账上有 ${S.player.money}。`, input: { value: String(Math.max(0, Math.floor(S.player.money / 2 / 100) * 100)), number: true }, ok: '存' });
  if (v === null) return;
  bankAfter(E.deposit(S, Number(v), t));
}
const INV_DESC = { '货币基金': '年化1.5%上下，几乎不亏，随存随取', '银行理财': '年化2.5%–3.2%，极少亏，锁90天', '股票基金': '一年下来可能亏四分之一，也可能赚三成多；跟行业风向走，卖出收0.5%' };
function openInvest() {
  sheet(`<h2>买理财</h2>
    <div class="card">${Object.keys(INV_DESC).map(k => `<div class="li tap" onclick="doInvest('${k}')"><b>${k}</b><div class="tip">${INV_DESC[k]}${k === '股票基金' ? `｜眼下净值${E.bankOf(S).nav.toFixed(3)}` : ''}</div></div>`).join('')}</div>
    <div class="btns"><button class="ghost" onclick="sheetOff()">算了</button></div>`);
}
async function doInvest(k) {
  sheetOff();
  const v = await ask({ title: `买${k}`, text: `账上有 ${S.player.money}。${INV_DESC[k]}。`, input: { value: String(Math.max(0, Math.floor(S.player.money / 3 / 100) * 100)), number: true }, ok: '买' });
  if (v === null) return;
  bankAfter(E.invest(S, k, Number(v), Math.random));
}
function openLoan() {
  sheet(`<h2>贷款</h2><div class="tip" style="margin-top:-10px">额度和利率看月薪、在职多久、口碑和征信。每月1号跟房租一起扣月供。</div>
    <div class="card" style="margin-top:14px">${Object.keys(E.LOANS).map(k => {
      const q = E.loanQuote(S, k);
      return q.ok
        ? `<div class="li"><div class="lirow"><b>${k}</b><span class="rel">最多${yuan(q.cap)}｜年利率${(q.rate * 100).toFixed(1)}%</span></div><div class="lirow">${q.terms.map(t => `<button class="ghost sm" onclick="doLoan('${k}',${t})">${t}个月</button>`).join('')}</div></div>`
        : `<div class="li"><b>${k}</b><div class="tip">${esc(q.why)}</div></div>`;
    }).join('')}</div>
    <div class="btns"><button class="ghost" onclick="sheetOff()">算了</button></div>`);
}
async function doLoan(k, t) {
  sheetOff();
  const q = E.loanQuote(S, k);
  const v = await ask({ title: `${k}，${t}个月`, text: `最多 ${q.cap}，年利率${(q.rate * 100).toFixed(1)}%。贷多少？`, input: { value: String(q.cap), number: true }, ok: '贷' });
  if (v === null) return;
  bankAfter(E.takeLoan(S, k, Number(v), t));
}

/* ---- 小事占多久：一天两个空档 ---- */
async function pickSpan(base) {
  if (base > 0) return base;
  if (E.slotsLeft(S) > 0) return 0;
  return await ask({ title: '今天没空了', text: '白天、晚上都已经安排了事。', ok: '那就明天', no: '算了' }) ? 1 : null;
}

/* ================= 设置 / 存档 ================= */
// 屏幕尺寸的读数：底栏贴不贴底这种事，只能拿真机的数来查
function diagText() {
  const pr = document.createElement('div');
  pr.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0';
  document.body.appendChild(pr);
  const cs = getComputedStyle(pr), sa = `${parseFloat(cs.paddingTop)}/${parseFloat(cs.paddingBottom)}`;
  pr.remove();
  const vv = window.visualViewport ? Math.round(visualViewport.height) : '-';
  const sm = (navigator.standalone === true ? 'S' : '') + (window.matchMedia && matchMedia('(display-mode: standalone)').matches ? 'D' : '');
  let wide = '', wr = innerWidth;
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('#chat,#key,#panel:not(.on)')) continue;
    const q = el.getBoundingClientRect();
    if (q.width && q.right > wr + 1) { wr = q.right; wide = (el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '')) + Math.round(q.right); }
  }
  return `屏幕读数 ${screen.width}×${screen.height}｜排版${innerWidth}｜页宽${document.documentElement.scrollWidth}｜缩放${window.visualViewport ? visualViewport.scale.toFixed(2) : '-'}｜最宽${wide || '无'}｜窗口${innerHeight}｜可视${vv}｜html${document.documentElement.clientHeight}｜body${Math.round(document.body.getBoundingClientRect().height)}｜app${Math.round($('app').getBoundingClientRect().bottom)}｜安全区${sa}｜${sm || '浏览器'}｜${document.documentElement.className || '-'}｜${document.documentElement.dataset.vpfix ? '重设过' + document.documentElement.dataset.vpfix : '没重设'}`;
}
function openSettings() {
  mask('setMask', true);
  const dg = $('setDiag'); if (dg) dg.textContent = diagText();
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
  $('setStyle').innerHTML = seg(Object.keys(STYLES), styleOf());
  $('setStyleNote').textContent = STYLES[styleOf()].note;
  bindSeg('setStyle', v => {
    if (!S) return;
    S.style = v; saveGame();
    toast('文风改成' + v + '，下一段起');
    $('setStyleNote').textContent = STYLES[v].note;
  });
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
// 章节全文另存在 IndexedDB 里，存档只带最近 12 章，免得把浏览器给的那点空间撑满
// （同一个网址下几个游戏共用这点空间，满了存档就悄悄写不进去，刷新后日子会倒回去）
function saveGame() {
  if (!S) return;
  if (S.chapters && S.chapters.length > 12) S.chapters = S.chapters.slice(-12);
  const j = JSON.stringify(S);
  let ok = true;
  try { localStorage.setItem(LS_SAVE, j); }
  catch (_) {
    try { localStorage.removeItem(LS_SAVE + '_bak'); localStorage.setItem(LS_SAVE, j); }
    catch (e2) { ok = false; }
  }
  if (ok) { try { localStorage.setItem(LS_SAVE + '_bak', j); } catch (_) { try { localStorage.removeItem(LS_SAVE + '_bak'); } catch (__) { } } }
  if (!ok && !saveGame.warned) { saveGame.warned = true; toast('存档写不进去了：浏览器空间满了，去设置里导出存档'); }
}
function loadGame() {
  let raw = localStorage.getItem(LS_SAVE);
  if (!raw) { raw = localStorage.getItem(LS_SAVE + '_bak'); if (raw) { try { localStorage.setItem(LS_SAVE, raw); } catch (_) { } console.warn('主存档不见了，从备份接上'); } }
  if (!raw) return false;
  let data = null;
  try { data = JSON.parse(raw); } catch (_) { data = null; }
  if (data && data.save && data.save.player) data = data.save;     // 整个导出包被塞进来的
  try { S = data ? E.migrate(data) : null; } catch (e) { console.error('存档补齐出错', e); S = null; }
  if (!S) {
    // 读不出来：先把原样留一份，别让新开的一局把它盖掉
    try { localStorage.setItem(LS_SAVE + '_broken', raw); } catch (_) { }
    loadErr = '上次的存档读不出来，原样另存了一份，没有被盖掉';
    return false;
  }
  try { ensureFaces(S); } catch (e) { console.error(e); }
  try { $('story').innerHTML = S.chapters.join(''); } catch (_) { $('story').innerHTML = ''; }
  if (S.runId) bookAll(S.runId).then(rows => {
    if (!rows || rows.length <= S.chapters.length) return;
    $('story').innerHTML = rows.map(r => r.html).join('');
    scrollDown();
  }).catch(() => { });
  try {
    rebuildTop();
    renderOptions(S.lastOptions && S.lastOptions.length ? S.lastOptions : ['接着过日子']);
    scrollDown();
  } catch (e) { console.error('读档后画界面出错', e); S.lastOptions = ['接着过日子']; try { renderOptions(S.lastOptions); } catch (_) { } }
  try { if (S.convo) { $('chat').classList.add('on'); renderConvo(); } } catch (e) { S.convo = null; $('chat').classList.remove('on'); }
  try { if (S.key) openKey(); } catch (e) { S.key = null; $('key').classList.remove('on'); }
  saveGame();
  return true;
}
let loadErr = '';
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
    const txt = String(fr.result || '').replace(/^\uFEFF/, '').trim();
    try { pack = JSON.parse(txt); } catch (_) { toast('这个文件读不出来，可能下载时没下完整'); return; }
    if (pack && pack.player && !pack.save) pack = { save: pack, book: [], who: `${pack.player.name || ''}` };   // 直接存的状态，不是导出包
    if (!pack || !pack.save || !pack.save.player) { toast('这不是这个游戏的存档'); return; }
    let fixed = null;
    try { fixed = E.migrate(JSON.parse(JSON.stringify(pack.save))); } catch (e) { console.error(e); }
    if (!fixed) { toast('这个存档缺的东西太多，接不上'); return; }
    if (S && !await ask({ title: `导入「${pack.who || '别处的存档'}」？`, text: '这台设备上现在这局会被盖掉。', ok: '导入', danger: true })) return;
    try {
      // 先腾地方：旧的主存档和备份都占着空间，新存档大一点就写不进去
      const j = JSON.stringify(fixed);
      try { localStorage.removeItem(LS_SAVE + '_bak'); localStorage.removeItem(LS_SAVE + '_broken'); } catch (_) { }
      try { localStorage.setItem(LS_SAVE, j); }
      catch (_) {
        localStorage.removeItem(LS_SAVE);
        if (fixed.chapters && fixed.chapters.length > 4) fixed.chapters = fixed.chapters.slice(-4);   // 全本在 IndexedDB 里，这里只留最近几章
        localStorage.setItem(LS_SAVE, JSON.stringify(fixed));
      }
      for (const r of (pack.book || [])) { try { if (r && r.id && r.html) await bookPut(r); } catch (_) { } }
      // 关页面时会自动存一次当前这局：先把它摘掉，不然刚导入的存档又被盖回去
      S = null;
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
// 装到桌面的模式：页面高度按整块屏幕算
function fitStandalone() {
  const sa = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (!sa) return;
  const root = document.documentElement;
  root.classList.add('pwa');
  const portrait = !window.matchMedia || matchMedia('(orientation: portrait)').matches;
  const long = Math.max(screen.width, screen.height), short = Math.min(screen.width, screen.height);
  root.style.setProperty('--app-h', Math.max(window.innerHeight, portrait ? long : short) + 'px');
}
// 装到桌面后，iOS 偶尔按比屏幕宽的尺寸排版再整页缩小（底下就空一截）：发现了就按屏幕宽度重设视口
function fixViewport() {
  const sa = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (!sa) return;
  const portrait = !window.matchMedia || matchMedia('(orientation: portrait)').matches;
  const w = portrait ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  const vm = document.querySelector('meta[name=viewport]');
  if (vm && innerWidth > w + 2) { vm.setAttribute('content', `width=${w}, initial-scale=1, viewport-fit=cover`); document.documentElement.dataset.vpfix = innerWidth + '>' + w; }
}
// 安装信息用脚本挂上去（跟武侠、修仙一样），不在页面头里写死 manifest 链接：
// iOS 26 认到写死的 manifest 会按另一套方式开桌面应用，页面高度算矮，底下空一截
(function manifest() {
  try {
    const abs = p => new URL(p, location.href).href;
    const mf = {
      name: '现代生活模拟器', short_name: '现代生活', lang: 'zh-CN',
      description: '接入你自己的大模型，在一座虚构的城市里从22岁开始，把想干成的事一点点干起来。',
      start_url: location.pathname + location.search, scope: location.pathname.replace(/[^/]*$/, ''),
      display: 'standalone', orientation: 'portrait', background_color: '#0f1116', theme_color: '#0f1116',
      icons: [{ src: abs('icon/icon-192.png'), sizes: '192x192', type: 'image/png' }, { src: abs('icon/icon-512.png'), sizes: '512x512', type: 'image/png' },
        { src: abs('icon/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
    };
    const l = document.createElement('link'); l.rel = 'manifest';
    l.href = URL.createObjectURL(new Blob([JSON.stringify(mf)], { type: 'application/manifest+json' }));
    document.head.appendChild(l);
  } catch (_) { }
})();
// 面板停在底栏上面
function fitTabs() { const t = $('tabs'); if (t) document.documentElement.style.setProperty('--tabsH', t.offsetHeight + 'px'); }
function boot() {
  applySkin();
  fitTabs();
  window.addEventListener('resize', fitTabs);
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
  $('wxCopy').onclick = () => {
    const no = $('wxNo').textContent;
    const done = () => toast('微信号已复制：' + no);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(no).then(done, () => toast('复制没成，手动记一下：' + no));
    else toast('手动记一下：' + no);
  };
  $('setImport').onclick = () => $('setFile').click();
  $('setFile').onchange = e => { importSave(e.target.files[0]); e.target.value = ''; };
  $('fcGo').onclick = doFocus;
  $('fcClose').onclick = () => mask('focusMask', false);
  $('fcDays').oninput = () => $('fcDaysN').textContent = $('fcDays').value;
  $('topBtn').onclick = openSettings;
  $('keyEnd').onclick = keyFinish;
  $('chatSend').onclick = convoSend;
  $('chatPlus').onclick = chatPlus;
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
  let okLoad = false;
  try { okLoad = loadGame(); } catch (e) { console.error('读档出错', e); loadErr = '存档读到一半出错了：' + (e.message || e); S = null; }
  if (!okLoad) { renderStart(); mask('startMask', true); if (loadErr) setTimeout(() => toast(loadErr), 600); }
}
boot();
