/* v43：局部改写、人物引用、美术身份、剧情结案和缓存上下文；纯合成档，不调用模型。 */
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),E=require('../src/engine');
let checks=0;const ok=(v,m)=>{assert(v,m);checks++;},clone=x=>JSON.parse(JSON.stringify(x));
const mk=(freedom='心想事成')=>E.newState({name:'剧情审计',gender:'男',city:'新一线',origin:'普通家庭',track:'职场',freedom,rngSeed:7});
const turn=(s,raw,action='继续')=>E.settleFiatTurn(s,{narrative:'新的进展。',summary:'结果',fiatChanges:{},...raw},action).state;
{
 const s=mk();s.home={name:'原来的家',kind:'买',since:'2020年1月',price:500000,loan:{left:200000,monthly:1000,months:360,paid:30}};
 E.applyFiatChanges(s,{home:{price:600000}});ok(s.home.loan.left===200000&&s.ledger.loan===1000&&s.home.since==='2020年1月','房屋估值局部修改不重置房贷及获得日期');
 ok(s.fiatWorld.homes.length===1&&s.fiatWorld.homes[0].name==='原来的家','住处记录沿用实际名称');
 E.applyFiatChanges(s,{home:{loan:{left:100000}}});ok(s.home.loan.monthly===1000&&s.home.loan.paid===30&&s.home.loan.left===100000,'局部改贷款余额不重置月供与已还期数');
 s.home={kind:'租',tier:'整租一居',since:'2020年1月'};E.applyFiatChanges(s,{home:{place:'新地址'}});ok(s.home.kind==='租','修改地址不把租屋变成全款买房');
 s.biz={name:'原公司',kind:'小公司',staff:[{name:'员工',role:'研发'}],total:123456,months:33,net:9000,dead:false};
 E.applyFiatChanges(s,{businesses:[{name:'原公司',detail:'扩大研发'}]});ok(s.biz.staff.length===1&&s.biz.total===123456&&s.biz.months===33,'局部事业修改保留团队和经营积累');
 E.applyFiatChanges(s,{businesses:[{oldName:'原公司',name:'新公司'}]});ok(s.biz.name==='新公司'&&s.biz.total===123456,'事业改名保留经营积累');
 s.fiatWorld.businesses=[{name:'闲置甲'},{name:'闲置乙'}];E.applyFiatChanges(s,{businesses:[{name:'闲置甲',remove:true}]});ok(s.biz.name==='新公司'&&s.biz.total===123456,'移除非当前事业不切换或重置当前经营');
 s.family.partner={name:'伴侣',stage:'结婚',warm:88,since:'2010年',sinceDay:20};E.applyFiatChanges(s,{family:{partner:{warm:99}}});ok(s.family.partner.stage==='结婚'&&s.family.partner.since==='2010年','局部家庭修改保留婚姻状态');
 s.job.out=true;E.applyFiatChanges(s,{job:{salary:5000}});ok(s.job.out,'只改薪资不擅自恢复工作');
}
{
 const s=mk();E.applyFiatChanges(s,{npcs:[{name:'旧名',gender:'男',age:35}]});
 s.msgs=[{from:'旧名'}];s.debts=[{who:'旧名',left:100}];s.pays=[{from:'旧名',to:'旧名'}];s.pledges=[{who:'旧名',what:'约定'}];s.rifts=[{who:'旧名'}];s.stopWhen=[{who:'旧名'}];s.stopQueue=[{who:'旧名'}];s.appts=[{wed:{who:'旧名'}}];
 s.groups=[{members:['旧名'],msgs:[{from:'旧名'}]}];s.moments=[{who:'旧名',cs:[{who:'旧名',to:'旧名'}],likes:['旧名']}];s.family.partner={name:'旧名'};s.key={who:'旧名',opp:{name:'旧名'}};s.convo={name:'旧名',lines:[{from:'旧名'}]};
 E.applyFiatChanges(s,{npcs:[{oldName:'旧名',name:'新名',age:18,gender:'女'}]});
 for(const value of [s.msgs[0].from,s.debts[0].who,s.pays[0].from,s.pays[0].to,s.pledges[0].who,s.rifts[0].who,s.stopWhen[0].who,s.stopQueue[0].who,s.appts[0].wed.who,s.groups[0].members[0],s.groups[0].msgs[0].from,s.moments[0].cs[0].who,s.moments[0].likes[0],s.family.partner.name,s.key.opp.name,s.convo.name])ok(value==='新名','改名同步所有结构化引用');
 ok(E.whoIs(s,'旧名')==='新名','历史文字中的旧名能解析为当前人物');
 const long='这是一个超过十二个字的全新名字';const g=E.sanitizeGroup({fiatChanges:{npcs:[{oldName:'新名',name:long}]},replies:[{who:long,text:'回答'.repeat(200)}]},['新名'],s);
 ok(g.replies.length===1&&g.replies[0].who===long&&g.replies[0].text.length===400,'群聊允许本轮改名后的长名字和完整回应');
 ok(E.sanitizeConvo({reply:['答'.repeat(500)]},s).replies[0].length===500,'沙盒私聊不截断完整回应');
}
{
 let s=mk();s=turn(s,{fiatChanges:{date:{y:0,m:1,d:1},player:{age:0},npcs:[{name:'小孩',age:0,gender:'女'}]}});
 ok(E.addDays(s.date,1).y===0&&E.daysBetween(s.date,{y:1,m:1,d:1})===366,'公元0年和0至99年没有1900年偏移');
 ok(E.migrate(clone(s)).date.y===0,'公元0年读档不回到默认时间');
 E.applyFiatChanges(s,{date:{y:50,m:1,d:1},npcs:[{name:'小孩',age:18}]});ok(s.npcs[0].ageY===50,'明确改年龄会更新人物年龄基准');
 const ctx=vm.createContext({ENGINE:E,console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/art.js'),'utf8'),ctx);ctx.s=s;
 ok(vm.runInContext('personAge(s,s.npcs[0])',ctx)===18,'美术年龄与面板改写一致');
 s.npcs[0].face='m01';const face=vm.runInContext('assignFace(s,s.npcs[0])',ctx);ok(face.startsWith('f'),'性别改写后重新选择相应头像');
 s.npcs[0].age=0;ok(vm.runInContext('personAge(s,s.npcs[0])',ctx)===0,'明确0岁不回退成44岁');
 s.npcs[0].ageY=0;s.npcs[0].age=18;ok(vm.runInContext('personAge(s,s.npcs[0],0)',ctx)===18,'旧帖公元0年头像年龄基准保留');
}
{
 let s=mk();s.unresolved=['找回两元钱','筹备新事业'];const time=clone(s.date),money=s.player.money;
 s=turn(s,{progress:{focus:'找零',change:'两元已经找回',closed:['找回两元钱']},unresolved:['找回两元钱','筹备新事业']},'把两元找回');
 ok(!s.unresolved.includes('找回两元钱')&&s.unresolved.includes('筹备新事业'),'小事结案退出待办，其他目标保留');
 s=E.migrate(clone(s));s=turn(s,{progress:{focus:'新事业',change:'获知合伙人安排',closed:[]},unresolved:['找回两元钱。','筹备新事业']});
 ok(!s.unresolved.includes('找回两元钱。')&&s.storyProgress.resolved.includes('找回两元钱'),'跨读档后结案不会以标点变化复活');
 s=turn(s,{progress:{focus:'新事业',change:'拿到场地资料',closed:[]},unresolved:['筹备新事业']});
 ok(E.storyContext(s,'继续').includes('连续聚焦同一件事'),'连续两段相同焦点发出进度提示');
 ok(E.storyContext(s,'继续细聊').includes('玩家本次明确要求细写')&&E.storyContext(s,'继续').includes('擅自快进'),'防重复提示保留玩家细聊和时间控制');
 ok(JSON.stringify(time)===JSON.stringify(s.date)&&s.player.money===money,'节奏机制不自动快进或改钱');
 s=turn(s,{unresolved:['找回两元钱']},'重新调查找回两元钱');ok(s.unresolved.includes('找回两元钱'),'玩家点名可以重新打开已经结案的话题');
 const normal=mk('都市传奇');normal.unresolved=['快递取件'];E.applyTurn(normal,{summary:'取件完成',progress:{focus:'取件',change:'拿到包裹',closed:['快递取件']},scene:{unresolved:['快递取件']}});
 ok(normal.storyProgress.resolved.includes('快递取件')&&!normal.unresolved.length,'普通模式也接入结案机制');
 const old=mk('都市传奇');E.migrate(old);ok(!old.storyProgress,'加载旧档不会凭空添加剧情或追溯结算');
}
{
 const s=mk();s.fiatWorld={facts:Array.from({length:30},(_,i)=>({name:'设定'+i,detail:'长期生效且不应丢弃的游戏世界信息'})),rules:[],assets:[],businesses:[],homes:[],commands:[{command:'此前完整的指令',result:'此前实际成果'}]};
 const common=(a,b)=>{let n=0;while(a[n]&&a[n]===b[n])n++;return n;};
 const before=E.fiatContext(s),oldBefore=JSON.stringify({date:s.date,player:s.player,world:s.fiatWorld});
 E.applyFiatChanges(s,{days:1,moneyDelta:10});const after=E.fiatContext(s),oldAfter=JSON.stringify({date:s.date,player:s.player,world:s.fiatWorld});
 const metrics={before:common(oldBefore,oldAfter),after:common(before,after)};ok(metrics.after>metrics.before+1000,'余额日期变化后完整世界设定前缀仍可复用');
 const parsed=JSON.parse(after);ok(parsed.player.money===s.player.money&&parsed.date.d===s.date.d&&parsed.identity.name===s.player.name&&parsed.world.facts.length===30&&parsed.commands[0].command==='此前完整的指令','缓存重排仍保留最新状态、完整世界和原指令');
 const out=path.join(__dirname,'../output/audit-v43');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'prefix-metrics.json'),JSON.stringify(metrics,null,2));
}
console.log('PASS：'+checks+' 项剧情进度、局部更新、人物引用、美术年龄和缓存完整性断言');
