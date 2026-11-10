/* node test/fiat.js：言出法随结算、普通模式隔离、失败重试和旧档恢复；不请求真实模型。 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const E = require('../src/engine.js');
let checks = 0;
const ok = (value, label) => { assert(value, label); checks++; };
const clone = value => JSON.parse(JSON.stringify(value));
const rows = s => Object.values(s.acct || {}).flatMap(a => a.rows);
const mk = (freedom = '心想事成') => {
  const s = E.newState({ name:'自由回归', gender:'男', city:'新一线', origin:'刑二代', track:'职场', freedom, edu:'大专', rngSeed:7 });
  E.addNpcs(s, [{name:'周青',tie:'同事',rel:1},{name:'陈晓',tie:'朋友',rel:1}], 2);
  return s;
};
const steps = (s, list) => E.runSteps(s, E.sanitizePlan({steps:list}, '回归行动', true, s), () => 0);

// 同一笔五十亿元的收入和借款，不受收入、关系、身份或旧的一亿/十亿元上限截断。
for (const borrow of [false,true]) {
  const s = mk(), before = s.player.money;
  const r = steps(s, [{type:'seekMoney',text:'周青给我五十亿元',who:'周青',amount:5e9,borrow,diff:'很难'}]);
  ok(r.results[0].ok && s.player.money - before === 5e9, '五十亿元完整到账 ' + borrow);
  ok(borrow ? s.debts.at(-1).left === 5e9 : !s.debts.length, '只在明确借钱时记欠条');
}
{const s=mk(), p=E.sanitizePlan({steps:Array.from({length:8},(_,i)=>({type:'seekMoney',text:'进账'+i,amount:1e6}))},'',true,s), before=s.player.money;
 ok(p.steps.length===8,'复合行动保留八个结算步骤');E.runSteps(s,p,()=>0);ok(s.player.money-before===8e6,'八笔收入逐笔落账');}

// 花销、还债、开业、银行和生活面板共用资金补足，收支可核对，失败不能凭空补钱。
for (const action of [
  s=>steps(s,[{type:'spend',amount:2e6,text:'付项目款'}]).results[0],
  s=>E.openBiz(s,{kind:'小公司',name:'自由公司'},()=>0),
  s=>E.buyHouse(s,()=>0), s=>E.buyItem(s,'car'), s=>E.moveHome(s,'整租一居'),
  s=>E.deposit(s,2e6,12), s=>E.invest(s,'股票基金',2e6,()=>0),
  s=>E.payOut(s,'周青',2e6,'红包'), s=>E.doFun(s,'trip',['周青'],true,()=>0)
]) {
  const s=mk();s.player.money=0;E.bankOf(s).credit=1;
  const r=action(s);
  ok(r.ok && s.player.money>=0,'无存款、低征信仍可完成授权行动');
  ok(rows(s).some(x=>x.item==='言出法随·资金到位'),'资金补足有流水');
  ok(rows(s).reduce((a,x)=>a+x.amt,0)===s.player.money,'补足与支出守恒');
  ok(!s.debts.length,'补足资金不偷偷变成债务');
}
{const s=mk();E.addDebt(s,'周青',2e6,60);s.player.money=0;const r=E.payDebt(s,0,2e6);ok(r.pay===2e6 && !r.left && s.player.money===0,'没钱也能还清指定欠款');}
for(const kind of Object.keys(E.LOANS)) {
 const s=mk();s.job.out=true;s.ledger.salary=0;E.bankOf(s).credit=1;
 const before=s.player.money,r=E.takeLoan(s,kind,5000000123,12);
 ok(r.ok && r.loan.amount===5000000123 && s.player.money-before===5000000123,'无收入、低征信大额贷款按元到账 '+kind);
 ok(r.loan.left===5000000123 && r.loan.monthly>0,'明确申请贷款仍保留还款义务');
}
{const s=mk();s.player.money=0;const g=E.makeGroup(s,['周青','陈晓'],'回归群'),r=E.groupPacket(s,g,1e6,'回归',()=>0.5);ok(r.ok && s.player.money===0,'群红包也解除金额和资金门槛');}
{const s=mk();for(const source of ['chat','msg']) for(let i=0;i<3;i++){const p=E.payIn(s,'周青',5e9,'转账','回归',source);ok(p && p.amount===5e9,'聊天与消息多笔大额收款不截断');}const py=E.payList(s)[0],cash=s.player.money;E.claimPay(s,py.id,true);E.claimPay(s,py.id,true);ok(s.player.money-cash===5e9,'大额收款仍只能领取一次');}
for(const action of [s=>E.buyItem(s,'不存在'),s=>E.invest(s,'不存在',100000),s=>E.takeLoan(s,'不存在',100000),s=>E.groupPacket(s,null,1e6),s=>E.fundAction(s,Infinity),s=>E.fundAction(s,-1)]) {
 const s=mk();s.player.money=0;const before=JSON.stringify(s);action(s);ok(JSON.stringify(s)===before,'无效输入不补钱、不改状态');
}

// 在职升职、跳槽、月薪、成长、关系与痊愈要反映在面板所读的状态中。
{const s=mk();E.applyTurn(s,{newJob:{employer:'自由集团',title:'董事长',lv:7,salary:5e9}});
 ok(s.job.lv===7 && s.ledger.salary===5e9 && s.player.job==='自由集团的董事长','在职直接跃升并保留五十亿元月薪');
 const old=clone(s);s.freedom='写实人生';ok(s.ledger.salary===old.ledger.salary && s.job.lv===7,'切回普通模式不追溯扣回既有成果');
 E.applyTurn(s,{newJob:{employer:'其他公司',title:'经理',salary:10000}});ok(s.job.employer==='自由集团','普通模式在职时仍不能由模型擅自换岗');}
{const s=mk();s.job.lv=7;const salary=s.ledger.salary;E.applyTurn(s,{newJob:{employer:'新集团',title:'董事长'}});ok(s.job.lv===7 && s.ledger.salary===salary,'身份变化没指定职级和月薪时保留现值');E.applyTurn(s,{newJob:{employer:'新集团',title:'志愿者',salary:0,lv:0}});ok(s.job.lv===0 && s.ledger.salary===0,'明确指定零薪和初级身份也按玩家意愿兑现');}
{const s=mk();s.status=[{name:'扭伤',days:90}];const before=s.player.money;
 E.applyTurn(s,{playerChanges:{money:5e9,attributes:{专业:80},energy:80,信誉:80,人品:80,idealProgress:500,statusRemove:['扭伤']},npcUpdates:[{name:'周青',rel:99}]});
 ok(s.player.money-before===5e9 && !s.capNote,'大额额外成果不被零碎额度截断');
 ok(s.player.attrs.专业===100 && s.player.信誉>=80 && s.player.信誉<=100 && s.player.energy<=E.energyCap(s),'取消单段成长上限并保持量表有效');
 ok(s.ideal.progress===500 && s.npcs.find(n=>n.name==='周青').rel===100 && !s.status.length,'进度、关系跃升和立即痊愈');}
{const s=mk();s.board={list:[{id:1,job:'公务员',employer:'自由街道',cert:true,attr:'谋划',need:100,state:''}]};ok(!E.originBlocked(s,'公务员') && E.applyPost(s,1,()=>0).pass,'出身、证书和低骰不拦考公申请');}
{const s=mk();s.player.money=1e6;const item=E.buyItem(s,'jewel').item;ok(!E.giveItem(s,'周青',item.uid,()=>0).back,'生分关系也能收下指定礼物');ok(E.doFun(s,'movie',['周青'],true,()=>0.99).ok,'低关系仍可邀约');}

// 当前里程碑不再要求攒指标、另打一局；不跳过未指定的前置步骤，也不能重复领奖。
const ladder = s => {s.ideal.stages=[{name:'自由阶梯',milestones:[{id:1,title:'完成首个项目',metric:'money',need:1e9,scene:'谈判',done:false},{id:2,title:'成为行业标杆',metric:'money',need:1e10,scene:'谈判',done:false}]}];};
{const s=mk();ladder(s);ok(E.mileStat(s,E.curMile(s).m).ok,'不足指标仍能发起关键局');
 ok(!E.judgeClaim(s,['成为行业标杆']) && !s.ideal.stages[0].milestones[1].done,'不跨过玩家未要求的当前一步');
 ok(E.judgeClaim(s,['完成首个项目','成为行业标杆']).done && !E.curMile(s),'连续指定两步直接落地');
 const before=JSON.stringify(s);E.judgeClaim(s,['完成首个项目']);ok(JSON.stringify(s)===before,'重复申报无重复结算');}
for(const move of ['摆事实','讲故事','共情','施压','让步','亮底牌']) for(const type of Object.keys(E.OPP_TYPES)) {
 const s=mk();for(const a of E.ATTRS)s.player.attrs[a]=0;s.player.energy=0;E.startKey(s,{type,hard:95,kind:'raise'});
 const r=E.keyRound(s,move,()=>0);ok(r.result==='谈成' && s.key.cost===0,'最低能力与最低骰仍谈成 '+type+move);
 const salary=s.ledger.salary;E.settleKey(s);ok(s.ledger.salary>salary && s.stats.keyWins===1,'谈成后实际兑现');
}
{const s=mk();E.startKey(s,{hard:95});E.keyRound(s,'稳一稳',()=>0);ok(!s.key.over,'稳一稳保留继续选择');E.keyRound(s,'改期',()=>0);ok(s.key.result==='留口子','玩家主动改期不强迫谈成');}

// 两个普通模式继续使用原有资金、薪资、成长、疾病、贷款和里程碑规则。
for(const mode of ['写实人生','都市传奇']) {
 const s=mk(mode);s.player.money=0;ok(!E.buyHouse(s).ok && !E.buyItem(s,'car').ok && !E.openBiz(s,{kind:'小店'}).ok,'普通模式保留财力门槛 '+mode);
 ok(!rows(s).some(x=>x.item==='言出法随·资金到位'),'普通模式无补钱');ok(E.originBlocked(s,'公务员'),'普通模式仍有出身门槛');
 s.status=[{name:'扭伤',days:90}];const a=s.player.attrs.专业;E.applyTurn(s,{playerChanges:{money:5e9,attributes:{专业:80},statusRemove:['扭伤']}});
 ok(s.player.money<5e9 && s.player.attrs.专业-a<=3 && s.status.length===1,'普通模式仍截大钱成长且不能瞬间痊愈');
 E.bankOf(s).credit=1;ok(!E.takeLoan(s,'信用贷',5e9).ok,'普通模式仍拒绝低征信贷款');ladder(s);ok(!E.judgeClaim(s,['完成首个项目']).ok,'普通模式里程碑仍校验指标');
 ok(E.sanitizePlan({steps:Array.from({length:8},()=>({type:'spend',amount:1}))},'',true,s).steps.length===3,'普通模式保留三步上限');
}

// 用完整 UI 调用链验证两次清洗、大额成果、断线读档重试；只使用内存存储和假模型。
const els=new Map(),store=new Map();
function el(id){if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',value:'',style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],querySelector:()=>({insertAdjacentHTML(){}}),appendChild(){},setAttribute(){}});return els.get(id);}
const ctx=vm.createContext({ENGINE:E,console,Math:Object.assign(Object.create(Math),{random:()=>0.5}),URL,Blob,setTimeout(){},clearTimeout(){},window:{},navigator:{},location:{href:'http://127.0.0.1/',pathname:'/',search:''},document:{getElementById:el,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>el('created'),head:el('head'),documentElement:el('root')},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8').replace(/boot\(\);\s*$/,''),ctx);
ctx.mk=mk;ctx.ladder=ladder;const run=code=>vm.runInContext(code,ctx);
run(`toast=()=>{};rebuildTop=()=>{};renderOptions=()=>{};renderPanel=()=>{};beginChapter=()=>{};finishChapter=async()=>{};updateChapterNarrative=()=>{};faceHtml=()=>'';artImg=()=>'';icon=()=>'';HOME_ART={};BIZ_ART={};`);
(async()=>{
 let r=await run(`(async()=>{S=mk();busy=false;S.player.money=0;ladder(S);let parses=0;llmJSON=async(p,cb,o)=>{if(o&&o.system===PARSE_SYSTEM)parses++;throw Error('叙事断线')};await doAction('让我直接任董事长并获得五十亿元，完成首个项目',true);const before=JSON.stringify({money:S.player.money,rows:S.acct,days:S.stats.days});S=E.migrate(JSON.parse(JSON.stringify(S)));llmJSON=async()=>({narrative:'项目办成，直接任董事长，五十亿元到账。',summary:'项目完成',fiatChanges:{player:{money:5e9},job:{employer:'自由集团',title:'董事长',salary:5e9,lv:7},milestones:['完成首个项目']}});await retryPending();const once=JSON.stringify(S);await retryPending();return {parses,before,once,after:JSON.stringify(S),salary:S.ledger.salary,done:S.ideal.stages[0].milestones[0].done,pending:S.pending}})()`);
 ok(r.parses===0 && r.once===r.after && !r.pending,'沙盒不走固定解析，断线读档重试只结算一次');
 ok(r.salary===5e9 && r.done,'UI世界改写同步月薪并直接达成里程碑');
 run(`S=mk();S.convo={hist:[],lines:[]};`);
 ok(run(`styleSystem().includes('可以改写已发生的结果') && !styleSystem().includes('不许跳过时间')`),'独立提示词支持改写旧事实和时间');
 ok(run(`fiatSystem().includes('没有商品目录限制') && fiatSystem().includes('不要返回代码')`),'任意成果有落点，输出只收数据');
 ok(run(`fiatChatSystem(false).includes('必须兑现')`),'私聊也使用沙盒规则');
 run(`S.plan={limits:['不要替我签约'],style:[]};`);ok(run(`fiatSystem().includes('别替我答应')`),'玩家限制仍然优先');
 const legacy=require('./fixtures/legacy-v1.json');
 for(const old of Object.values(legacy)) {
   if(!old.player)continue;const s=clone(old);s.freedom='心想事成';const before=clone(s),t=E.migrate(s);
   ok(t.player.money===before.player.money && JSON.stringify(t.date)===JSON.stringify(before.date),'旧档加载不补钱、不改日期');
   ok(JSON.stringify(t.history)===JSON.stringify(before.history) && JSON.stringify(t.chapters)===JSON.stringify(before.chapters),'旧档保留历史和章节');
 }
 fs.mkdirSync(path.join(__dirname,'../output'),{recursive:true});
 fs.writeFileSync(path.join(__dirname,'../output/言出法随_回归结果.json'),JSON.stringify({passed:true,checks},null,2));
 console.log(`PASS：${checks} 项言出法随、普通模式隔离、收支核对、失败重试和旧档兼容断言`);
})().catch(e=>{console.error(e);process.exitCode=1});
