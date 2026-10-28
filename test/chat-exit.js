/* node test/chat-exit.js：聊天退出、行动冻结和旧档恢复回归；无真实接口请求。 */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const E = require('../src/engine.js');
let checks = 0;
const ok = (x, label) => { assert(x, label); checks++; };
const els = new Map(), store = new Map();
function el(id) {
  if (!els.has(id)) {
    const classes = new Set();
    els.set(id, { innerHTML:'', textContent:'', value:'', style:{setProperty(){}}, dataset:{},
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x)}},
      querySelectorAll:()=>[],querySelector:()=>null,appendChild(){},setAttribute(){},focus(){},addEventListener(){} });
  }
  return els.get(id);
}
const ctx = vm.createContext({ ENGINE:E, console, Math, localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  document:{getElementById:el,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>el('created'),head:el('head'),documentElement:el('root')},
  window:{},navigator:{},location:{href:'http://127.0.0.1/',pathname:'/',search:''},setTimeout(){},clearTimeout(){},URL,Blob });
const ui = process.env.CHAT_UI_SOURCE || path.join(__dirname,'../src/ui.js');
vm.runInContext(fs.readFileSync(ui,'utf8').replace(/boot\(\);\s*$/, ''),ctx);
const run = code => vm.runInContext(code,ctx);
run(`faceHtml=()=>'';ensureFaces=()=>{};bookAll=async()=>[];artImg=()=>'';HOME_ART={};BIZ_ART={};KEY_ART={};MOVE_ICON={};icon=()=>'';
let segments=0,locked;runSegment=()=>{segments++};`);
ctx.mk = () => {
  const s = E.newState({name:'退出回归',gender:'男',city:'新一线',origin:'普通家庭',track:'职场',freedom:'写实人生',startYear:2026,rngSeed:7});
  E.addNpcs(s,[{name:'孙博',tie:'同事',rel:40},{name:'许敏嘉',tie:'同学',rel:45}],2);
  return s;
};
const frozen = {
  promise:`S.promiseAsk={type:'appt',kind:'约',title:'楼下见面',who:'孙博'};`,
  pending:`S.pending={prompt:'原故事请求',action:'原行动',head:'8月26日'};`,
  queue:`S.stopQueue=[{kind:'约',detail:'另一个约定'}];`,
  key:`E.startKey(S,{scene:'谈判',name:'孙博',kind:'raise',hard:20});`,
  over:`S.over=true;S.ending='原结局';`,
  none:''
};
for (const group of [false,true]) for (const [state, freeze] of Object.entries(frozen)) for (const done of [false,true]) for (const said of [false,true]) {
  run(`S=mk();busy=false;segments=0;curTab='phone';${group ? "E.makeGroup(S,['孙博','许敏嘉'],'测试群');openGroup(S.groups[0].id);" : "openConvo('孙博');"}
    ${freeze}
    ${said ? "S.convo.lines=[{who:'me',text:'在吗'},{who:'ta',from:'孙博',text:'在的'}];S.convo.summary='问候';S.convo.rel=2;" : ''}
    saveGame();S=null;loadGame();convoFrom='phone';
  `);
  const label = `${group?'群聊':'私聊'} ${state} ${done?'聊完':'返回'} ${said?'有消息':'仅浏览'}`;
  const before = run(`JSON.stringify({money:S.player.money,date:S.date,days:S.stats.days,ledger:S.ledger,acct:S.acct,pending:S.pending,promise:S.promiseAsk,key:S.key,queue:S.stopQueue,over:S.over,ending:S.ending})`);
  run(`endConvo(${done},${!done})`);
  ok(run(`!S.convo && !$('chat').classList.contains('on')`),label+' 可退出');
  ok(before === run(`JSON.stringify({money:S.player.money,date:S.date,days:S.stats.days,ledger:S.ledger,acct:S.acct,pending:S.pending,promise:S.promiseAsk,key:S.key,queue:S.stopQueue,over:S.over,ending:S.ending})`),label+' 退出不改时间资金和待办');
  ok(run(`segments`) === (!group && state==='none' && done && said ? 1 : 0),label+' 只在正常聊完后继续剧情');
  ok(!JSON.parse(store.get('mls_save')).convo,label+' 保存退出状态');
  if(state==='promise') ok(run(`$('acts').innerHTML.includes('promiseDelay()') && !curTab`),label+' 约定处理入口可达');
  if(state==='queue') ok(run(`$('acts').innerHTML.includes('看看今天还有什么事') && !curTab`),label+' 当天事件入口可达');
  if(state==='key') ok(run(`$('key').classList.contains('on') && !curTab`),label+' 恢复关键局');
  if(state==='none' && !done) ok(run(`curTab==='phone'`),label+' 返回原手机面板');
  if(said) {
    ok(run(group ? `S.groups[0].msgs.filter(m=>m.text==='在吗').length===1` : `S.msgs.filter(m=>m.me && m.text==='在吗').length===1`),label+' 消息归档一次');
    run(`endConvo(false,true)`);
    ok(run(group ? `S.groups[0].msgs.filter(m=>m.text==='在吗').length===1` : `S.msgs.filter(m=>m.me && m.text==='在吗').length===1`),label+' 重复点击不重复归档');
  }
}
for (const freeze of Object.values(frozen).slice(0,-1)) {
  run(`S=mk();busy=false;openConvo('孙博');${freeze}$('chatIn').value='不应发出';locked=JSON.stringify(S);convoSend();`);
  ok(run(`JSON.stringify(S)===locked`),'冻结状态仍禁止发送和更改游戏状态');
}
run(`S=mk();busy=false;openConvo('孙博');busy=true;const active=JSON.stringify(S);endConvo(false,true);`);
ok(run(`JSON.stringify(S)===active && $('chat').classList.contains('on')`),'请求期间不提前结算会话');
run(`busy=false;S.convo=null;S.promiseAsk={title:'旧档约定'};$('chat').classList.add('on');endConvo(true);`);
ok(run(`!$('chat').classList.contains('on') && $('acts').innerHTML.includes('promiseGo()')`),'失去会话对象也可退出');
console.log(`PASS：${checks} 项聊天退出、读档恢复、消息防重和冻结保护断言`);
