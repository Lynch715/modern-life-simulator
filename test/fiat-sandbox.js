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
 const interest=Object.values(s.acct).flatMap(a=>a.rows).filter(r=>r.item==='活期利息').reduce((sum,r)=>sum+r.amt,0);
 ok(!E.endReason(s)&&interest>0&&Math.abs(s.player.money-cash-interest)<cash*1e-14&&s.player.energy===energy&&s.player.age===18,'时间推进只加活期结息，保留永生设定、精力和自由结局');
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

{
 const s=mk();
 s.date={y:2029,m:2,d:7};
 s.stats.days=E.daysBetween(s.startDate,s.date);
 s.family.kids=[{name:'舒一可',born:'2月7日',bornY:2029,age:0}];
 s.player.money=1000000;
 E.invest(s,'货币基金',516600);
 E.deposit(s,100000,12);
 E.invest(s,'银行理财',100000,()=>0.5);
 // 模拟旧版只移动了日期，孩子与三种产品均未结算。
 s.date={y:2030,m:2,d:8};
 s.stats.days=E.daysBetween(s.startDate,s.date);
 const loaded=E.migrate(clone(s)), b=E.bankOf(loaded), kid=loaded.family.kids[0];
 ok(kid.age===1&&E.kidStage(kid)==='会走了','旧档孩子按真正生日长大');
 ok(b.mmfGain>7700&&b.mmfGain<8000&&b.mmf===E.r2(516600+b.mmfGain),'旧档货币基金按已核对的交易补计收益');
 ok(!b.fixed.length&&!b.wm.length&&loaded.acct['2030-02'].rows.some(r=>r.item==='定期到期'&&r.amt===101100)&&loaded.acct['2030-02'].rows.some(r=>r.item==='银行理财到期'&&r.note.includes('收益')),'旧档到期本息一次转回账上并记账');
 ok(JSON.stringify(E.migrate(clone(loaded)))===JSON.stringify(loaded),'读档两次不会重复补息或回款');
 const missing=clone(s); missing.acct={};
 ok(E.bankOf(E.migrate(missing)).mmfGain===0,'旧档缺少购入日期时保留余额');
}
{
 const s=mk();
 s.date={y:2029,m:12,d:19};
 s.family.kids=[{name:'一可',born:'12月21日',bornY:2027,age:1},{unborn:true,dueDay:2}];
 s.player.money=1000000;
 s.ledger.rent=20000;
 E.invest(s,'货币基金',100);
 E.invest(s,'银行理财',50000,()=>0.5);
 E.deposit(s,10000,3);
 E.invest(s,'股票基金',10000);
 const staged=E.migrate(clone(s));
 E.applyFiatChanges(staged,{days:1});
 ok(staged.family.kids[0].age===1&&staged.family.kids[1].unborn,'孩子在生日前一天仍是原周岁');
 E.applyFiatChanges(staged,{days:1});
 ok(staged.family.kids[0].age===2&&staged.family.kids[1].born==='12月21日'&&E.bankOf(staged).mmfGain===0.01,'过生日与到预产期同步，百元货基也累计到分');
 E.applyFiatChanges(staged,{days:95});
 const jumped=settle(E.migrate(clone(s)),{days:97},'快进97天'), bank=E.bankOf(jumped);
 ok(jumped.player.money===staged.player.money&&bank.mmf===E.bankOf(staged).mmf&&bank.nav===E.bankOf(staged).nav,'跨日分段和一次快进得到一致的收益与净值');
 const entries=Object.entries(jumped.acct).flatMap(([m,a])=>a.rows.map(row=>({...row,m})));
 ok(entries.some(r=>r.item==='活期利息'&&r.d===21&&r.m==='2029-12')&&entries.some(r=>r.item==='银行理财到期'&&r.d===19&&r.m==='2030-03')&&entries.some(r=>r.item==='定期到期'&&r.d===20&&r.m==='2030-03')&&!entries.some(r=>r.item==='房租'),'银行按实际结息日、到期日记账');
 E.applyFiatChanges(jumped,{family:{kids:[{name:'新孩子',age:6},{name:'一可',age:8}]}});
 E.applyFiatChanges(jumped,{days:366});
 ok(jumped.family.kids.map(k=>k.age).join(',')==='9,1,7','明确指定的年龄保留，孩子资料局部更新后继续成长');
 const gain=E.bankOf(jumped).mmfGain;
 E.applyFiatChanges(jumped,{days:-15});
 ok(E.bankOf(jumped).mmfGain===gain,'回到以前不会冲销已入账的收益');
 const amount=E.bankOf(jumped).mmf,cash=jumped.player.money;
 E.redeem(jumped,'货币基金',0);
 ok(E.bankOf(jumped).mmf===0&&Math.abs(jumped.player.money-cash-amount)<1e-8,'货币基金全部赎回时余额和收益一起到账');
}
{
 const s=mk('写实人生');
 s.date={y:2029,m:2,d:6};
 s.family.kids=[{name:'小满',born:'2月7日',bornY:2026,age:2}];
 E.advance(s,{maxDays:1,quiet:true,rng:()=>0.5});
 ok(s.family.kids[0].age===3&&E.kidStage(s.family.kids[0])==='上幼儿园'&&s.player.age===22,'普通模式孩子在自己的生日成长');
}

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
