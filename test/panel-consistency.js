/* node test/panel-consistency.js：十项修复、失败恢复和旧档兼容。UI 使用 DOM 替身，真实点击另由应用内浏览器验收。 */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const E = require('../src/engine.js');
const legacy = require('./fixtures/legacy-v1.json');
let checks = 0;
function ok(x, msg) { assert(x, msg); checks++; }
const mk = (freedom='写实人生', city='新一线', origin='普通家庭') => E.newState({name:'回归角色',gender:'男',city,origin,track:'职场',freedom,startYear:2026,rngSeed:7});
const clone = x => JSON.parse(JSON.stringify(x));
const rows = S => Object.values(S.acct || {}).flatMap(x=>x.rows);
const els = new Map(), store = new Map();
function el(id) {
  if (!els.has(id)) els.set(id,{innerHTML:'',textContent:'',style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll(){return []},querySelector(){return {insertAdjacentHTML(){}}},appendChild(){},setAttribute(){}});
  return els.get(id);
}
const ctx = vm.createContext({ENGINE:E,console,Math:Object.assign(Object.create(Math),{random:()=>0.5}),localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},document:{getElementById:el,querySelectorAll(){return []},querySelector(){return null},createElement(){return el('created')},head:el('head'),documentElement:el('root')},window:{},navigator:{},location:{href:'http://127.0.0.1/',pathname:'/',search:''},setTimeout(){},clearTimeout(){},URL,Blob});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8').replace(/boot\(\);\s*$/, ''),ctx);
ctx.mk = mk;
vm.runInContext(`toast=()=>{};closePanel=()=>{};rebuildTop=()=>{};renderOptions=()=>{};finishChapter=async()=>{};beginChapter=()=>{};updateChapterNarrative=()=>{};faceHtml=()=>'';artImg=()=>'';HOME_ART={};BIZ_ART={};icon=()=>'';`,ctx);
const run = x => vm.runInContext(x,ctx);
async function main() {
  // 日历停点必须完成整天的固定结算，多个到期事项不得丢失。
  for (const mode of Object.keys(E.FREEDOM)) {
    const S=mk(mode); S.date={y:2026,m:6,d:30};S.flags.nightCnt=12;S.player.money=100000;
    S.appts.push({y:2026,m:7,d:1,title:'见朋友甲',done:false},{y:2026,m:7,d:1,title:'见朋友乙',done:false});
    const r=E.advance(S,{maxDays:1,quiet:true,rng:()=>0.5});
    ok(S.player.money===97100 && rows(S).filter(x=>x.item==='房租').length===1,mode+'身体停点仍扣月初账');
    const before=S.player.money, found=[];
    while(S.stopQueue.length) found.push(E.advance(S,{maxDays:1,quiet:true,rng:()=>0.5}).stop);
    ok(found.filter(x=>x.promise).length===2 && S.stats.days===1 && S.date.d===1 && S.player.money===before,mode+'同日两约无丢失、无重复扣款');
    ok(r.stop.kind==='身体',mode+'保留原停点优先级');
  }
  {const S=mk();S.date={y:2026,m:7,d:9};S.flags.nightCnt=12;const before=S.player.money;E.advance(S,{maxDays:1,quiet:true,rng:()=>0.5});ok(S.player.money===before+S.ledger.salary,'身体停点仍发工资');}
  {const S=mk();S.date={y:2026,m:7,d:31};S.player.money=100000;E.deposit(S,1000,3);E.bankOf(S).fixed[0].dueDay=1;E.advance(S,{maxDays:1,quiet:true,rng:()=>0.5});ok(!E.bankOf(S).fixed.length && rows(S).some(x=>x.item==='定期到期'),'交租停点仍结算到期存款');}
  {const S=mk();S.date={y:2026,m:12,d:30};S.flags.nightCnt=12;const r=E.advance(S,{maxDays:1,quiet:true,rng:()=>0.5});ok(r.stop.kind==='年终' && S.status.some(x=>x.name==='失眠'),'年终也完成当天身体结算');}
  // 金额校验：错误输入完全不改变状态；0的已有全卖语义保留。
  for(const value of [-1000,NaN,Infinity,-Infinity,'abc',0.1]) {
    const S=mk();S.player.money=100000;E.invest(S,'股票基金',10000,()=>0.5);const before=JSON.stringify(S);
    ok(!E.redeem(S,'股票基金',value).ok && JSON.stringify(S)===before,'拒绝无效卖出 '+String(value));
  }
  {const S=mk();S.player.money=100000;E.invest(S,'股票基金',10000,()=>0.5);ok(E.redeem(S,'股票基金',1000).ok && E.fundValue(S)===9000 && S.player.money===90995,'正常部分卖出与手续费');ok(E.redeem(S,'股票基金',0).ok && E.fundValue(S)===0,'0仍全部卖出');}
  // 新房贷逐期与期末；旧贷的余额、月供、已付记录不追溯变动。
  for(const city of Object.keys(E.CITIES)) {
    const S=mk('写实人生',city);S.player.money=1e8;E.buyHouse(S,()=>0.5);const monthly=S.ledger.loan;
    for(let i=1;i<=360;i++){S.date={y:2027+Math.floor((i-1)/12),m:(i-1)%12+1,d:1};E.moneyTick(S,()=>0.5);ok(S.home.loan.paid===i && (i===360 || S.home.loan.left>0),city+'按期还款 '+i);}
    ok(S.home.loan.done && S.home.loan.left===0 && !S.ledger.loan,city+'360期结清');const cash=S.player.money;S.date={y:2057,m:1,d:1};E.moneyTick(S,()=>0.5);ok(cash-S.player.money===S.ledger.living+S.ledger.remit,city+'结清后不再扣房贷');ok(rows(S).every(x=>Number.isFinite(x.amt)) && monthly>0,city+'账目有效');
  }
  for(const paid of [0,100,359,360,400]) {
    const S=clone(legacy.mortgage);
    S.home.loan.paid=paid;S.home.loan.left=Math.max(1,333200-728*paid);S.player.money=12345;S.stats.days=271;S.date={y:2027,m:4,d:21};S.history.push({summary:'原历史'});S.chapters.push('<p>原章节</p>');
    const orig=clone(S), T=E.migrate(clone(S));
    ok(T.player.money===orig.player.money && T.stats.days===271 && JSON.stringify(T.date)===JSON.stringify(orig.date),'旧贷不补算历史 '+paid);
    ok(T.home.loan.left===orig.home.loan.left && T.home.loan.monthly===orig.home.loan.monthly && T.home.loan.paid===paid,'旧贷三项数值保留 '+paid);
    ok(T.home.loan.plan==='legacy42' && T.home.loan.months>paid && T.history.at(-1).summary==='原历史' && T.chapters[0]==='<p>原章节</p>','旧贷显示真实余期、历史章节保留 '+paid);
    const once=JSON.stringify(T);E.migrate(T);ok(JSON.stringify(T)===once,'迁移幂等 '+paid);
  }
  {const S=mk();S.player.money=1e6;E.bankOf(S).credit=30;const cash=S.player.money;ok(!E.canBuy(S).ok && !E.buyHouse(S).ok && cash===S.player.money,'购房报价与审批都拒绝低征信');E.bankOf(S).credit=60;ok(E.canBuy(S).ok && E.buyHouse(S,()=>0.5).ok && !E.canBuy(S).ok,'正常购房通过、已有房不能重买');}
  {const S=mk();S.home={kind:'买',price:490000};S.ledger.loan=1733;const T=E.migrate(clone(S));ok(E.homePayment(T)===1733 && T.ledger.loan===1733,'只有月供记录的更早旧档不擅自免债');}
  // 关键局正常跨日、失败、迁移后重试：只结算一次。
  let x=await run(`(async()=>{S=mk();S.date={y:2026,m:7,d:9};E.startKey(S,{scene:'谈判',name:'老板',kind:'raise',hard:20});S.key.over=true;S.key.result='留口子';llmJSON=async()=>({narrative:'谈完',options:['继续']});await keyFinish();return {date:S.date,days:S.stats.days,money:S.player.money,salary:S.ledger.salary,pending:S.pending}})()`);
  ok(x.date.d===10 && x.days===1 && x.money===8000+x.salary && !x.pending,'关键局跨到10号正常发薪');
  x=await run(`(async()=>{S=mk();S.date={y:2026,m:7,d:31};S.player.money=100000;E.startKey(S,{scene:'谈判',name:'老板',kind:'raise',hard:20});S.key.over=true;S.key.result='谈成';llmJSON=async()=>{throw Error('模拟失败')};await keyFinish();const snapshot=JSON.stringify(S),salary=S.ledger.salary,cash=S.player.money;S=E.migrate(JSON.parse(snapshot));llmJSON=async()=>({narrative:'重试完成',options:['继续']});await retryPending();await retryPending();return {date:S.date,days:S.stats.days,salaryBefore:salary,salary:S.ledger.salary,cashBefore:cash,cash:S.player.money,pending:S.pending,key:S.key,keys:S.stats.keys}})()`);
  ok(x.date.m===8 && x.date.d===1 && x.days===1 && x.salary===x.salaryBefore && x.cash===x.cashBefore && !x.pending && !x.key && x.keys===1,'关键局失败读档重试不重复加薪、扣款、跨日');
  x=await run(`(async()=>{S=mk();S.job.out=true;S.ledger.salary=0;E.startKey(S,{scene:'面试',name:'面试官',kind:'job',hard:20});S.key.over=true;S.key.result='谈崩';llmJSON=async()=>({narrative:'没谈成',newJob:{employer:'错误新工作',salary:10000}});await keyFinish();return S.job.out})()`);ok(x,'关键局失败模型不能额外发入职');
  // 同一动作的快捷和手输路径一致；解析失败不推进日子。
  for(const mode of Object.keys(E.FREEDOM)) for(const typed of [false,true]) {
    ctx.mode=mode;ctx.typed=typed;
    x=await run(`(async()=>{S=mk(mode);busy=false;let parsed=0;llmJSON=async(p,cb,o)=>{if(o&&o.system===PARSE_SYSTEM){parsed++;return {steps:[{type:'quit',text:'辞职'}]}}return {narrative:'辞职完成',options:['继续']}};await doAction('辞职',typed);return {parsed,out:S.job.out,salary:S.ledger.salary,days:S.stats.days}})()`);
    ok(x.parsed===1 && x.out && x.salary===0 && x.days===1,mode+'快捷/手输同源 '+typed);
  }
  x=await run(`(async()=>{S=mk();const before=JSON.stringify(S);llmJSON=async()=>{throw Error('解析断网')};await doAction('辞职',false);return JSON.stringify(S)===before})()`);ok(x,'解析失败不伪造成功或改变状态');
  x=await run(`(async()=>{S=mk();const before=JSON.stringify(S);llmJSON=async()=>({steps:[{type:'unknown'}]});await doAction('辞职',false);return JSON.stringify(S)===before})()`);ok(x,'无效解析类型也不执行');
  // 所有面板变更在五类冻结状态下均拒绝。
  const calls=['pickPace("拼工作")','askJob()','askRaise()','runKey({})','doBuyHouse()','doBreak()','doWantKid()','askOpenBiz("小店")','openHire()','doHire({})','doFire(0)','doRaise(0)','doCloseBiz()','doQuit()','doPay(0)','doFocus()','doMove("整租一居")','doBuy("fruit")','doUse(1)','doGive("朋友",1)','doFunGo()','openBoard()','doApply(1)','doTakeGig("跑外卖")','doDropGig("跑外卖")','bankDo("fundOut")','doDeposit(3)','doInvest("股票基金")','doLoan("消费贷",12)','doLike(1)','doComment(1)','postMoment()','takePay(1,true)','chatPay("红包")','doMakeGroup()'];
  for(const frozen of ['busy=true','S.pending={prompt:"原请求"}','S.over=true','S.key={over:true}','S.promiseAsk={title:"约定"}','S.stopQueue=[{kind:"年终"}]']) for(const call of calls) {
    x=await run(`(async()=>{S=mk();busy=false;${frozen};const before=JSON.stringify(S);await ${call};return JSON.stringify(S)===before})()`);ok(x,frozen+' 阻止 '+call);
  }
  x=await run(`(async()=>{S=mk();busy=false;ask=async()=>{S.seg++;return true};await doQuit();return !S.job.out})()`);ok(x,'确认框返回后重新校验段落状态');
  x=await run(`(async()=>{S=mk();S.promiseAsk={type:'appt',kind:'面试',title:'今天的面试'};S.stopQueue=[{kind:'约',detail:'另一个约定'}];llmJSON=async()=>({opening:'请坐',opp:{name:'面试官',type:'务实'},where:'会议室'});await promiseGo();await Promise.resolve();await Promise.resolve();return !!S.key && S.stopQueue.length===1 && !S.promiseAsk})()`);ok(x,'同日多个停点仍允许赴当前已确认的面试');
  run('S=mk();busy=false');
  x=await run(`(async()=>{S=mk();E.addDebt(S,'甲',1000,60);E.addDebt(S,'乙',2000,60);ask=async()=>{S.debts.shift();return '1000'};await doPay(0);return S.debts[0].left===2000})()`);ok(x,'过期还款确认不扣另一位债主');
  x=run(`(()=>{S=mk();busy=false;E.takeJob(S,{employer:'甲公司',title:'编辑',salary:5000});E.quitJob(S);curTab='me';renderPanel();const me=$('panelBody').innerHTML;E.addDebt(S,'朋友',1000,60);E.payDebt(S,0,1000);curTab='book';renderPanel();return {me,book:$('panelBody').innerHTML,home:renderHome(),job:S.player.job}})()`);
  ok(x.job==='待业' && !x.me.includes('甲公司的编辑') && x.me.includes('没有工作'),'职业与事业面板一致');
  ok(!x.book.includes('onclick="doPay(') && !x.home.includes('欠人的'),'结清债务不显示欠款和还款入口');
  x=run(`(()=>{S=mk();S.player.money=1000000;E.bankOf(S).credit=30;return renderHome()})()`);ok(x.includes('disabled') && x.includes('房贷批不下来'),'购房面板展示实际审批原因');
  // 老普通待重试段落仍可恢复，且不改变已推进日期和资产。
  x=await run(`(async()=>{S=mk();S.pending={prompt:'旧格式待完成正文',head:'7月1日',sub:'',action:'原行动'};S.date={y:2027,m:2,d:3};S.stats.days=99;S=E.migrate(JSON.parse(JSON.stringify(S)));llmJSON=async()=>({narrative:'旧请求恢复',options:['继续']});await retryPending();return {date:S.date,days:S.stats.days,money:S.player.money,pending:S.pending}})()`);
  ok(x.date.y===2027 && x.date.d===3 && x.days===99 && x.money===8000 && !x.pending,'旧格式pending恢复不重新结算');
  // 144种开局各跑三年，日历与累计天数保持一致，停点队列不造成死循环。
  let days=0, callsN=0;
  for(const mode of Object.keys(E.FREEDOM)) for(const city of Object.keys(E.CITIES)) for(const origin of Object.keys(E.ORIGINS)) {
    const S=mk(mode,city,origin), rng=E.mkRng(131);let turns=0;
    while(S.stats.days<1095 && turns++<5000){const r=E.advance(S,{maxDays:1,quiet:true,rng});callsN++;if(r.stop.kind==='投入')E.settleFocus(S,rng);ok(E.daysBetween(S.startDate,S.date)===S.stats.days && Number.isFinite(S.player.money) && Number.isFinite(S.player.energy),mode+city+origin+'日历和数值一致');}
    ok(S.stats.days===1095,mode+city+origin+'三年不死循环');days+=S.stats.days;
  }
  const report={checks,longRunStarts:144,longRunDays:days,advanceCalls:callsN,passed:true};
  fs.mkdirSync(path.join(__dirname,'../output'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'../output/十项修复_回归结果.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1});
