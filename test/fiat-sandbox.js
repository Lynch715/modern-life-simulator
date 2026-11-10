/* 完全沙盒：世界改写、任意成果、事务、时间、失败恢复与普通档隔离。 */
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path'),E=require('../src/engine');
let checks=0;const ok=(v,m)=>{assert(v,m);checks++;}, clone=x=>JSON.parse(JSON.stringify(x));
const mk=(freedom='心想事成')=>E.newState({name:'沙盒测试',gender:'男',city:'新一线',origin:'普通家庭',track:'职场',freedom,rngSeed:7});
function settle(s,c,action='改写世界') {return E.settleFiatTurn(s,{narrative:'指令已经兑现。',summary:action,fiatChanges:c,options:['继续']},action).state;}
{let s=mk();s.status=[{name:'病',days:90}];s.chronic=Array.from({length:5},(_,i)=>({name:'病根'+i}));s.over=true;s.promiseAsk={title:'旧约'};s.stopQueue=[{kind:'身体'}];
 s=settle(s,{player:{money:1e25,energy:100000,attributes:{专业:1000000},age:18},job:{title:'星际联盟元首',lv:9999,salary:1e22},health:{clear:true},clearDebts:true,clearEvents:true,over:false,date:{y:2126,m:11,d:9},rules:[{name:'永生',detail:'保持十八岁，永不生病'}],facts:[{name:'任意传送',detail:'随意到达任何地方'}]});
 ok(s.player.money===1e25&&s.ledger.salary===1e22,'财富和工资突破旧金额边界');ok(s.player.energy===100000&&s.player.attrs.专业===1000000,'属性精力突破旧量表');
 ok(E.jobTitle(s)==='星际联盟元首'&&s.job.lv===9999,'自定义头衔和任意级别');ok(!s.chronic.length&&!s.status.length&&!s.over&&!s.key&&!s.promiseAsk&&!s.stopQueue.length,'直接清除病根和旧阻挡');
 ok(s.date.y===2126&&s.player.age===18&&s.fiatWorld.rules[0].name==='永生','时间跃迁与永生规则均落档');
 const w=JSON.stringify(s.fiatWorld),cash=s.player.money,energy=s.player.energy;E.advance(s,{maxDays:365});
 ok(!E.endReason(s)&&s.player.money===cash&&s.player.energy===energy&&s.player.age===18,'自动日结不打折财富、精力、青春或强迫结局');
 // 永生规则不被自动年龄推进覆盖，普通年龄推进另有单独约定。
 const loaded=E.migrate(clone(s));ok(JSON.stringify(loaded.fiatWorld)===w&&loaded.job.lv===9999&&loaded.player.attrs.专业===1000000,'世界规则、头衔、超量表属性跨读档保留');}
{let s=mk();s=settle(s,{assets:Array.from({length:35},(_,i)=>({name:'自定义资产'+i,detail:'可自由使用',quantity:i+1})),businesses:Array.from({length:18},(_,i)=>({name:'事业'+i,kind:'星际公司'})),npcs:Array.from({length:25},(_,i)=>({name:'人物'+i,age:25,rel:1000,job:'神话人物'})),home:{name:'天空城',price:1e20},facts:[{name:'全城归我所有'}],weather:{name:'永远晴天'}});
 ok(s.fiatWorld.assets.length===35&&s.fiatWorld.businesses.length===18&&s.npcs.length===25,'资产事业人物不再按步骤或条数截断');
 ok(s.home.kind==='买'&&!s.home.loan&&s.fiatWorld.homes[0].name==='天空城','获得自定义房产不额外添加房贷');
 ok(s.fiatWorld.facts.some(x=>x.name==='weather'),'未预设的世界字段仍有持久落点');
 s=settle(s,{assets:[{name:'自定义资产0',remove:true},{name:'自定义资产1',quantity:999}],businesses:[{name:'事业17',remove:true}]});
 ok(s.fiatWorld.assets.length===34&&s.fiatWorld.assets.find(x=>x.name==='自定义资产1').quantity===999&&s.fiatWorld.businesses.length===17,'后续指令可撤销和改写已有成果');
 ok(E.fiatContext(s).includes('全城归我所有')&&E.fiatContext(s).includes('自定义资产1'),'后续模型上下文获得真实世界状态');}
{let s=mk();s=settle(s,{date:{y:2000,m:1,d:1},player:{age:0,attributes:{专业:0}},npcs:[{name:'重生者',age:18,gender:'女'}]});
 ok(s.date.y===2000&&s.player.age===0&&s.npcs[0].ageY===2000,'回到过去、归零年龄与新人物年龄基准一致');
 s=E.migrate(clone(s));ok(s.player.age===0&&s.player.attrs.专业===0,'零岁和零属性也不会被旧档补丁重置');
 E.applyFiatChanges(s,{npcs:[{oldName:'重生者',name:'新的名字',job:'校长'}]});ok(s.npcs.length===1&&s.npcs[0].name==='新的名字'&&s.npcs[0].job==='校长','人物可直接改名和改身份');}
{let s=mk();s=settle(s,{player:{money:'无限'}});ok(s.player.wealthLabel==='无限'&&Number.isFinite(s.player.money),'无限财富有展示标签和有效数值');
 s=settle(s,{player:{money:100}});ok(s.player.money===100&&!s.player.wealthLabel,'可以主动把无限财富改回具体金额');}
{const s=mk();s.ideal.stages=[{name:'阶梯',milestones:[{title:'第一步',done:false},{title:'顶点',done:false}]}];E.applyFiatChanges(s,{milestones:['顶点']});ok(!s.ideal.stages[0].milestones[0].done&&s.ideal.stages[0].milestones[1].done,'指定跳级不再受前置步骤限制');}
{const s=mk(),before=JSON.stringify(s);assert.throws(()=>settle(s,{player:{money:1e9},date:{y:2026,m:2,d:30}}));ok(JSON.stringify(s)===before,'无效数据不会落半笔钱');assert.throws(()=>E.applyFiatChanges(s,{moneyDelta:100,date:{y:2026,m:99,d:1}}));ok(JSON.stringify(s)===before,'聊天使用的改写同样为原子操作');
 assert.throws(()=>E.settleFiatTurn(s,{narrative:'只有正文',_partial:true,fiatChanges:{}},'测试'));ok(JSON.stringify(s)===before,'截断回复不确认成果');
 const polluted=JSON.parse('{"facts":[{"name":"安全"}],"__proto__":{"polluted":true},"constructor":{"x":1}}');E.applyFiatChanges(s,polluted);ok(!({}).polluted&&!Object.prototype.hasOwnProperty.call(s.fiatWorld,'constructor'),'不把指令数据当代码或原型执行');}
for(const mode of ['写实人生','都市传奇']){const s=mk(mode),before=JSON.stringify(s);ok(!E.applyFiatChanges(s,{player:{money:1e25},rules:[{name:'无敌'}]}),'普通档拒绝世界改写 '+mode);ok(before===JSON.stringify(s),'普通档完全不受沙盒字段影响');}
{const s=mk(),raw={steps:Array.from({length:40},(_,i)=>({type:'custom-'+i,text:'任意命令'+i}))};ok(E.sanitizePlan(raw,'指令',true,s).steps.length===40,'旧结构也不再丢弃自定义步骤或截成十二步');}
{const s=mk();E.applyFiatChanges(s,{npcs:[{name:'无限关系',rel:10000}]});E.applyConvo(s,'无限关系',{rel:2});ok(s.npcs[0].rel===10002,'聊天收尾不会把超量表关系截回100');}

const els=new Map(),store=new Map();function el(id){if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',value:'',style:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],querySelector:()=>({insertAdjacentHTML(){}}),appendChild(){},setAttribute(){},addEventListener(){},focus(){}});return els.get(id);}
const ctx=vm.createContext({ENGINE:E,console,Math,URL,Blob,window:{},navigator:{},setTimeout(){},clearTimeout(){},location:{href:'http://localhost/',pathname:'/',search:''},document:{getElementById:el,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>el('created'),documentElement:el('root')},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8').replace(/boot\(\);\s*$/,''),ctx);ctx.mk=mk;const run=x=>vm.runInContext(x,ctx);
run(`toast=()=>{};closePanel=()=>{};rebuildTop=()=>{};renderOptions=()=>{};renderPanel=()=>{};beginChapter=()=>{};finishChapter=async()=>{};updateChapterNarrative=()=>{};`);
(async()=>{
 for(const lock of ['S.over=true','S.key={opp:{name:"旧对手"},log:[]}','S.promiseAsk={title:"旧约"}','S.stopQueue=[{kind:"旧事"}]','S.pending={prompt:"旧请求"}']){
  ctx.lock=lock;const r=await run(`(async()=>{S=mk();busy=false;eval(lock);let calls=0;llmJSON=async(p,cb,o)=>{calls++;return {narrative:'世界已经改写',fiatChanges:{player:{money:9e20},over:false,clearEvents:true}}};await doAction('越过旧事，直接获得九千亿亿财富',true);return {calls,money:S.player.money,pending:S.pending,days:S.stats.days,commands:S.fiatWorld.commands.length}})()`);
  ok(r.calls===1&&r.money===9e20&&!r.pending&&r.days===0&&r.commands===1,'结束、关键局、约定、队列和失败请求不拦新指令 '+lock);
 }
 let r=await run(`(async()=>{S=mk();busy=false;llmJSON=async()=>({narrative:'不完整的回复',_partial:true});await doAction('给我一座天空城',true);const before=S.player.money,date=JSON.stringify(S.date);S=E.migrate(JSON.parse(JSON.stringify(S)));llmJSON=async()=>({narrative:'天空城属于你',fiatChanges:{assets:[{name:'天空城'}],player:{money:1e20}},options:['继续']});await retryPending();const once=JSON.stringify(S);await retryPending();return {before,date,once,after:JSON.stringify(S),assets:S.fiatWorld.assets.length}})()`);
 ok(r.once===r.after&&r.assets===1,'沙盒失败读档重试只兑现一次');
 ok(run(`fiatSystem().includes('不设固定动作白名单')&&!fiatSystem().includes('已经定下的事实')`),'新提示不再让旧引擎判定压过玩家输入');
 ok(run(`fiatWorldCard().includes('天空城')&&fiatWorldCard().includes('已兑现')`),'玩家面板展示任意成果');
 fs.mkdirSync(path.join(__dirname,'../output'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../output/完全沙盒_回归结果.json'),JSON.stringify({passed:true,checks},null,2));console.log('PASS：'+checks+' 项完全沙盒断言');
})().catch(e=>{console.error(e);process.exitCode=1});
