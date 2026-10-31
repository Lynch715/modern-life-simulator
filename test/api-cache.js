/* node test/api-cache.js：缓存前缀、流式用量和请求兼容性；不访问真实接口。 */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const E = require('../src/engine.js');
const elements = new Map(), storage = new Map([['mls_save', 'existing-player-save']]);
function el(id) {
  if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', value: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, parentElement: { style: {} } });
  return elements.get(id);
}
const ctx = vm.createContext({ ENGINE: E, console, Math, URL, Blob, TextDecoder,
  setTimeout() {}, clearTimeout() {}, window: {}, navigator: {}, location: { pathname: '/', search: '', href: 'http://localhost/' },
  localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
  document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, documentElement: el('root') } });
const source = fs.readFileSync(process.env.CACHE_UI_SOURCE || path.join(__dirname, '../src/ui.js'), 'utf8');
vm.runInContext(source.replace(/boot\(\);\s*$/, ''), ctx);
const run = code => vm.runInContext(code, ctx);
const plain = code => JSON.parse(run(`JSON.stringify(${code})`));
const common = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
let checks = 0;
const ok = (value, label) => { assert(value, label); checks++; };
ctx.fixture = E.newState({ name: '林远', gender: '男', city: '新一线', origin: '普通家庭', track: '职场', freedom: '都市传奇', rngSeed: 7 });
E.addNpcs(ctx.fixture, [{ name: '陈晓', tie: '同事', rel: 45 }, { name: '周青', tie: '同学', rel: 40 }], 2);
run('S=fixture');

// 固定规则跨文风、人称、难度口径复用；偏好仍立即写入当前请求。
const baseSystem = run('styleSystem()');
run("cfg.person='ta';S.style='网文';S.freedom='写实人生'");
const changedSystem = run('styleSystem()');
ok(common(baseSystem, changedSystem) > 5000, '切换偏好后仍保留长固定前缀');
ok(changedSystem.includes('通篇用第三人称') && changedSystem.includes('【文风·都市网文】') && changedSystem.includes(E.FREEDOM['写实人生'].tone), '新偏好未因缓存被冻结');
for (const token of ['【世界观】', '【铁律】', '【日子里的规矩', '【主角在世人眼里是哪一档】', '【规矩打架时的先后', '【每一段都要做到的】', '"npcUpdates"', '"newNpcs"', '"pledges"'])
  ok(changedSystem.includes(token), '完整保留规则和返回字段：' + token);

// 摘要更新不再截断增长中的群聊记录；消息内容、当前摘要及最近 30 句窗口仍保留。
run(`S.convo={hist:[],gist:'第一轮摘要',lines:[{who:'me',text:'周末一起吃饭吗'},{who:'ta',from:'陈晓',text:'周六可以'}]};
  var testGroup={name:'老朋友',members:['陈晓','周青']};`);
const firstGroup = run("groupPrompt(testGroup,'周末一起吃饭吗')");
run("S.convo.gist='第二轮摘要';S.convo.lines.push({who:'me',text:'那就周六中午'});");
const secondGroup = run("groupPrompt(testGroup,'那就周六中午')");
ok(common(firstGroup, secondGroup) >= firstGroup.indexOf('陈晓：周六可以') + '陈晓：周六可以'.length, '群聊前缀包含此前完整原话，不被摘要打断');
ok(secondGroup.includes('第二轮摘要') && secondGroup.includes('主角刚在群里发的') && secondGroup.includes('那就周六中午'), '当前摘要与最后发言仍在请求中');
run("S.convo.lines=Array.from({length:40},(_,i)=>({who:'me',text:'消息'+i}));");
const longGroup = run("groupPrompt(testGroup,'消息39')");
ok(!longGroup.includes('林远：消息0\n') && longGroup.includes('林远：消息10\n') && longGroup.includes('林远：消息39'), '长群聊窗口保持最近 30 句，未扩大或缩短');
ok(longGroup.includes('更早的略，要点是：第二轮摘要'), '超出窗口仍保留摘要');
const parse1 = run("parsePrompt('去吃饭')");
run('S.player.money-=50');
const parse2 = run("parsePrompt('回家')");
ok(common(parse1, parse2) > parse1.indexOf('【主角眼下】'), '称呼表在余额与当前行动之前复用');

// 各平台的缓存字段，0 与未报告必须区分，不能虚构命中率。
ok(plain('apiUsageNumbers({prompt_tokens:100,prompt_cache_hit_tokens:0,completion_tokens:20})').hit === 0, '真实零命中保留为零');
ok(plain('apiUsageNumbers({prompt_tokens:100,completion_tokens:20})').hit === null, '缺失缓存数据不伪装成零');
ok(plain('apiUsageNumbers({input_tokens:100,input_tokens_details:{cached_tokens:80},output_tokens:20})').hit === 80, '支持 input_tokens_details');
ok(plain('apiUsageNumbers({prompt_tokens:100,prompt_tokens_details:{cached_tokens:80}})').hit === 80, '支持千问缓存字段');
ok(plain('apiUsageNumbers({prompt_tokens:100,prompt_cache_hit_tokens:200})').hit === null, '无效缓存数不生成超过 100% 的比例');

let responseData, requestCount = 0, request, readError = false, httpError = false;
ctx.fetch = async (url, init) => {
  requestCount++; request = { url, body: JSON.parse(init.body) };
  const bytes = new TextEncoder().encode(responseData);
  let at = 0;
  return { ok: !httpError, status: httpError ? 401 : 200, json: async () => ({ error: { message: 'test failure' } }),
    body: { getReader: () => ({ read: async () => {
      if (readError) throw new Error('test disconnected');
      if (at >= bytes.length) return { done: true };
      const value = bytes.slice(at, at + 7); at += value.length; return { done: false, value };
    } }) } };
};
const frame = data => 'data: ' + JSON.stringify(data) + '\n\n';
const delta = content => ({ choices: [{ delta: { content } }] });
function configure(base, model) { run(`cfg.base=${JSON.stringify(base)};cfg.model=${JSON.stringify(model)};cfg.key='test-only';cfg.think=true;delete cfg.provider;`); }
(async () => {
  configure('https://dashscope.aliyuncs.com/compatible-mode/v1/', 'qwen3.8-flash');
  responseData = frame(delta('{"narrative":"中文剧情"}')) + frame({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    + 'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 2000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1600 } } });
  const partials = []; ctx.partial = raw => partials.push(raw);
  const before = requestCount;
  const text = await run("callLLMOnce('当前行动',partial,{system:'系统 JSON 规则',maxTokens:1200,temperature:1.05})");
  ok(text === '{"narrative":"中文剧情"}' && partials[partials.length - 1] === text, '中文跨字节分块、流式显示和最终正文不变');
  ok(requestCount === before + 1, '统计用量不多发一次请求');
  ok(request.body.stream_options.include_usage === true && request.body.enable_thinking === false, '千问索取流式用量并保留非思考模式');
  ok(request.body.max_tokens === 1200 && request.body.temperature === 1.05 && request.body.response_format.type === 'json_object', '保留回复长度、温度和 JSON 模式');
  ok(request.body.messages[0].content === '系统 JSON 规则' && request.body.messages[1].content === '当前行动', '发送完整原文，不替换成旧回复');
  ok(!JSON.stringify(request.body).includes('cache_control'), '默认不启用有创建溢价的显式缓存');
  ok(plain('apiUsageRows[apiUsageRows.length-1]').hit === 1600 && run('lastFinish') === 'stop', '无 choices、无末尾换行的 usage 帧正确记录');
  ok(el('cfgUsageStats').innerHTML.includes('80.0%'), '按实际 Token 加权展示命中比例');

  configure('https://api.deepseek.com', 'deepseek-v4-flash');
  responseData = frame({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, completion_tokens: 10 } });
  await run("callLLMOnce('JSON',null,{system:'规则'})");
  ok(request.body.thinking.type === 'enabled' && request.body.enable_thinking === undefined, 'DeepSeek 思考参数保持原样');
  ok(run('lastFinish') === 'length' && plain('apiUsageRows[apiUsageRows.length-1]').hit === 0, 'DeepSeek 结束原因和零命中不会丢失');
  ok(el('cfgUsageStats').innerHTML.includes('76.2%'), '累计比例按已报告的输入 Token 加权计算');

  configure('https://custom.example/v1', 'custom-model');
  responseData = frame(delta('{"ok":true}')) + 'data: [DONE]';
  await run("callLLMOnce('JSON',null,{system:'规则'})");
  ok(request.body.stream_options === undefined && request.body.thinking === undefined, '自定义服务商不添加可能不支持的参数');
  ok(plain('apiUsageRows[apiUsageRows.length-1]').hit === null, '未返回用量仍能完成请求');
  ok(el('cfgUsageStats').innerHTML.includes('76.2%'), '未报告用量的请求不扭曲已知命中率');
  readError = true;
  await assert.rejects(run("callLLMOnce('JSON',null,{system:'规则'})"), /test disconnected/);
  ok(plain('apiUsageRows[apiUsageRows.length-1]').status === '中断', '中断请求不伪装成完成');
  readError = false; httpError = true;
  await assert.rejects(run("callLLM('JSON',null,{system:'规则'})"), /HTTP 401/);
  ok(requestCount === 5, '鉴权错误仍不自动重试，未增加无效调用');
  httpError = false;
  for (let i = 0; i < 15; i++) run("recordApiUsage('<img src=x>',null,'完成')");
  ok(run('apiUsageRows.length') === 12 && !el('cfgUsageStats').innerHTML.includes('<img src=x>'), '用量列表有界且转义自定义模型名');
  ok(storage.size === 1 && storage.get('mls_save') === 'existing-player-save', '统计不写入玩家存档或浏览器持久存储');
  console.log(`PASS：${checks} 项缓存前缀、完整上下文、流式回复、平台用量、请求兼容和存档隔离断言`);
})().catch(e => { console.error(e); process.exitCode = 1; });
