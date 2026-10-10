/* ===== 现代生活模拟器 · 引擎（无 DOM，可在 node 里直接跑） ===== */
(function(root){
'use strict';

const SAVE_VERSION = 1;

/* ---------- 基础 ---------- */
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = v => Math.round(v * 100) / 100;

/* ---------- 出身 / 城市 / 自由度 / 赛道 ---------- */
/* ---------- 捏人：学历、学校、专业、性格、长相 ---------- */
const EDUS = {
  '大专': { age: 21, pay: 0.85, attrs: { '专业': 2, '谋划': -2 }, desc: '21岁出来，手上活练得早，简历上吃点亏' },
  '本科': { age: 22, pay: 1, attrs: {}, desc: '22岁出来，大多数人走的那条路' },
  '硕士': { age: 25, pay: 1.22, attrs: { '专业': 6, '谋划': 3, '体能': -2 }, desc: '25岁才出来，起薪高一截，同龄人已经工作三年了' }
};
const SCHOOLS = {
  '名校': { pay: 1.15, rep: 6, attrs: { '表达': 2, '谋划': 2 }, desc: '名字说出去有人认，同学里不少去了好地方' },
  '重点': { pay: 1.06, rep: 3, attrs: { '谋划': 1 }, desc: '说得过去的学校，简历能过第一轮' },
  '普通': { pay: 1, rep: 0, attrs: {}, desc: '没人问你哪个学校，也没人因为学校多看你一眼' },
  '民办': { pay: 0.94, rep: -2, attrs: { '情绪': 1 }, desc: '学费贵，名气小，出来全凭自己' }
};
const MAJORS = {
  '理工': { '专业': 3 }, '文科': { '表达': 3 }, '商科': { '谋划': 3 }, '艺术': { '专业': 2, '表达': 1 },
  '医学': { '专业': 4, '体能': -1 }, '法学': { '谋划': 2, '表达': 1 }, '师范': { '表达': 2, '情绪': 1 }, '体育': { '体能': 6 }
};
const PERSONAS = {
  '内向': { attrs: { '情绪': 3, '表达': -3 }, desc: '话少，心里有数，跟生人熟得慢' },
  '外向': { attrs: { '表达': 4, '情绪': -1 }, desc: '爱说话、能来事，情绪也来得快' },
  '稳重': { attrs: { '谋划': 3, '表达': -1 }, desc: '想好了再动，不容易出错，也不容易出彩' },
  '要强': { attrs: { '专业': 2, '体能': 1, '情绪': -2 }, desc: '什么都想争个第一，累了也不说' },
  '随和': { attrs: { '情绪': 3, '谋划': -1 }, desc: '好相处，不跟人较劲，也不太替自己争' }
};
const LOOKS = { '普通': '长相普通，扔进人堆里找不着', '周正': '长得周正，看着让人放心', '出挑': '长得出挑，走哪儿都有人多看两眼' };
function bgEffect(o) {
  const ed = EDUS[o.edu] || EDUS['本科'], sc = SCHOOLS[o.school] || SCHOOLS['普通'];
  const add = {};
  for (const src of [ed.attrs, sc.attrs, MAJORS[o.major] || {}, (PERSONAS[o.persona] || {}).attrs || {}])
    for (const k in src) add[k] = (add[k] || 0) + src[k];
  return { age: ed.age, pay: ed.pay * sc.pay, rep: sc.rep, add };
}
// 给模型看的一句背景
function bgLine(p) {
  const b = p && p.bg;
  if (!b) return '';
  return [`${b.school}${b.school === '名校' || b.school === '重点' ? '' : '学校'}${b.major ? b.major + '专业' : ''}${b.edu}毕业`,
    b.persona ? `性子${b.persona}（${PERSONAS[b.persona].desc}）` : '', b.looks ? LOOKS[b.looks] : ''].filter(Boolean).join('，');
}

const ORIGINS = {
  '普通家庭': { money: 8000, remit: 0, subsidy: 0, rentCut: 1, retreat: true,
    desc: '家里供你念完了书，往后就得靠你自己。手头这点钱，够撑两个月。',
    story: '从一个普通的工作日切进去，家里人的电话里带着"在外面别委屈自己"那种话。' },
  '家里托底': { money: 30000, remit: 0, subsidy: 1200, rentCut: 0.5, retreat: true,
    desc: '爸妈在老家有房有退休金，房租他们帮着出一半，每月还给你打点钱。你可以不慌，但也总有人问你什么时候回去考个编。',
    story: '写家里人送他来、或者打电话来，话里话外是"实在不行就回来"。' },
  '一人进城': { money: 2000, remit: 900, subsidy: 0, rentCut: 1, retreat: false,
    desc: '你是家里第一个出来的，每月还得往回寄一点。没有退路，也没人兜底。',
    story: '写他兜里那点钱、第一次一个人租房的手忙脚乱，家里人打来电话问工资什么时候发。' },
  '红二代': { money: 50000, remit: 0, subsidy: 3000, rentCut: 0.5, retreat: true, attrs: { '谋划': 4, '情绪': 2 }, rep: 6,
    ease: { '从政': 12, '职场': 6, job: 6 }, askEase: -6,
    npc: { tie: '爷爷的老部下', job: '退下来的老干部', age: 68, rel: 45, note: '看着主角长大的，说话慢，分量重', care: '规矩和体面', fact: '是主角爷爷当年的老部下' },
    risk: { p: 0.5, rep: -2, text: '家里对你的路另有安排，老爷子发话了，要你按他的意思走' },
    desc: '爷爷那一辈打过天下，家里是大院出来的。门好进，话有人听；可一举一动都有人盯着，出了点事会被放大，家里对你的路也早有安排。',
    story: '从大院写起：门口的岗哨、老爷子饭桌上的规矩、叔伯们说话留半句。他出来自己干，家里有人不以为然。' },
  '官二代': { money: 80000, remit: 0, subsidy: 5000, rentCut: 0.3, retreat: true, attrs: { '表达': 3, '谋划': 3 }, rep: 3,
    ease: { '从政': 10, job: 5 }, askEase: -8,
    npc: { tie: '父亲的同事', job: '机关里的副处长', age: 46, rel: 40, note: '逢年过节来家里坐，嘴上叫你小名', care: '人情往来', fact: '是主角父亲的同事，欠过主角父亲人情' },
    risk: { p: 0.7, cut: true, rep: -6, text: '父亲那边出了事，被叫去谈话了，家里的钱先停了，平时围着你转的人一下子少了一大半' },
    desc: '父亲在体制里有个位置，办事托人比别人容易，开口求人也好使。可父亲那边一出事，你跟着倒霉。',
    story: '写家里饭桌上的规矩：谁先动筷子、父亲接电话时大家都不出声。他第一份工作是不是托人找的，他自己心里清楚。' },
  '富二代': { money: 300000, remit: 0, subsidy: 8000, rentCut: 0, retreat: true, livingX: 1.8, attrs: { '表达': 3, '情绪': -2 },
    ease: { '创业': 6, '手艺': 4 }, items: ['car', 'suit', 'coat'],
    npc: { tie: '家里公司的老会计', job: '家族企业的财务', age: 52, rel: 35, note: '替主角父亲管账，什么都往上报', care: '公司账目', fact: '是主角家族企业的老会计，会把主角的事报给他父亲' },
    risk: { p: 0.8, text: '家里生意出了状况，父亲打电话来，要你回去接班，话说得很硬' },
    desc: '家里做生意，钱是不缺的，起手就有车有存款。可家里逼着你接班，身边总有人把你当提款机，花钱也大手大脚惯了。',
    story: '写他开着家里给的车去上一份月薪几千的班，同事看他的眼神；父亲的电话里只问什么时候回来接手。' },
  '拆二代': { money: 150000, remit: 0, subsidy: 2000, rentCut: 0, retreat: true, house: true, attrs: { '谋划': -3, '情绪': 2 },
    risk: { p: 1, money: 0, text: '老家的亲戚上门来借钱，说是急用，开口就是一个大数' },
    desc: '老家那片拆了，家里分了几套房和一笔钱。你有房住、每月还有租金，可文化底子薄了点，亲戚们也都惦记着你家的钱。',
    story: '写拆迁之后家里的变化：亲戚多了，饭局多了，父母说话的口气变了。他住进自家的房子，楼下的人都知道他家是拆迁户。' },
  '刑二代': { money: 1500, remit: 0, subsidy: 0, rentCut: 1, retreat: false, attrs: { '情绪': 3, '体能': 2 }, rep: -4,
    ease: { '捞偏门': 12 }, block: /公务员|银行柜员/,
    npc: { tie: '父亲的老朋友', job: '刚出来没多久的人', age: 50, rel: 35, note: '跟主角父亲在里面认识的，说话不多，讲义气', care: '义气和面子', fact: '是主角父亲在牢里认识的老朋友' },
    risk: { p: 0.8, text: '父亲当年的事又被人翻出来了，有人找上门，说你爸欠他的' },
    desc: '父亲坐过牢，家里有人在道上混过。政审过不了，考公、进体制、银行这类地方的门对你是关着的；可道上的门路你熟。',
    story: '从探监或者父亲刚出狱写起：铁门、登记表、父亲老了一截。他填简历时"家庭成员"那一栏停了很久。' },
  '黑二代': { money: 60000, remit: 0, subsidy: 4000, rentCut: 0.5, retreat: true, attrs: { '情绪': 2, '谋划': 2 }, rep: -2,
    ease: { '捞偏门': 15, '创业': 4 }, block: /公务员|银行柜员/, askEase: -4,
    npc: { tie: '家里的老伙计', job: '帮主角家里看场子的', age: 44, rel: 45, note: '从小叫主角少爷，手上有疤', care: '规矩和地盘', fact: '是替主角家里看场子的老人' },
    risk: { p: 1, rep: -3, text: '家里的生意被查了，几处场子贴了封条，有人放话要找你家算旧账' },
    desc: '家里本身就是做灰色生意的，场子、放贷、工程，什么都沾一点。钱不缺，道上的人认你；可体制的门关着，仇家和警察都记着你家。',
    story: '写家里的场面：烟雾缭绕的茶楼、叫他少爷的人、父亲交代事情从来不说全。他出来上班，是想跟家里撇清，还是被派出来的，开局要写出来。' },
  '星二代': { money: 50000, remit: 0, subsidy: 3000, rentCut: 0.5, retreat: true, attrs: { '表达': 5 }, rep: 8,
    ease: { '表演': 12, '做博主': 12 },
    npc: { tie: '母亲的经纪人', job: '娱乐公司的经纪人', age: 40, female: true, rel: 40, note: '说话快，看人先看能不能红', care: '流量和资源', fact: '是主角母亲多年的经纪人' },
    risk: { p: 1.2, rep: -2, text: '你的一件小事被人拍了发上网，配的标题拿你爸妈做文章，上了热搜' },
    desc: '父母是明星，你一出生就被人认识。做博主、上台都有人看；可永远被拿来跟爸妈比，一点小事就上热搜。',
    story: '写他走在街上被人认出来、被叫成"谁谁家的孩子"；他想靠自己，可第一份活就是冲着他爸妈的名字来的。' },
  '学术世家': { money: 20000, remit: 0, subsidy: 1500, rentCut: 0.7, retreat: true, attrs: { '专业': 6, '谋划': 3, '表达': -2 },
    ease: { '科研': 12, '教书': 10 },
    npc: { tie: '父亲的学生', job: '大学里的副教授', age: 38, rel: 40, note: '叫主角父亲"老师"，对主角客客气气', care: '学术名声', fact: '是主角父亲带出来的学生' },
    risk: { p: 0.6, text: '家里开了一次饭桌会，父亲当着亲戚的面问你：什么时候回来读博' },
    desc: '父母都是教授，家里书比家具多。科研、教书的路你走得顺，专业底子厚；可家里只认读书这一条路，干别的都被看不起。',
    story: '写书房、饭桌上谈的论文和基金；他没读博出来工作，父亲到现在没正眼看过他的工作单位。' },
  '军人家庭': { money: 10000, remit: 0, subsidy: 0, rentCut: 1, retreat: true, attrs: { '体能': 6, '情绪': 4, '表达': -2 }, rep: 2,
    ease: { '体育': 6, '从政': 4 },
    npc: { tie: '父亲的老战友', job: '转业到地方的科长', age: 50, rel: 40, note: '说话嗓门大，一喝酒就讲当年', care: '规矩和担当', fact: '是主角父亲的老战友' },
    risk: { p: 0.5, text: '父亲打电话来，嫌你这阵子过得没个样子，话说得很冲，要你给个交代' },
    desc: '父亲当了半辈子兵，家里讲规矩。你体格好、扛得住事；可家里管得严，跟父亲说话常常硬碰硬。',
    story: '写早上六点自己就醒、被子叠得方方正正；父亲的电话一共三句话，最后一句是"别给家里丢人"。' },
  '个体户家庭': { money: 15000, remit: 0, subsidy: 0, rentCut: 1, retreat: true, attrs: { '表达': 5, '谋划': 2 },
    ease: { '创业': 6, '手艺': 6 },
    risk: { p: 1.2, money: 3000, text: '家里的店周转不开，你妈打电话来让你先垫三千，过阵子再还' },
    desc: '家里开了个小店，你从小在柜台后面长大，会说话、懂做买卖。可家里的店时好时坏，隔一阵就要你回去帮忙、垫钱。',
    story: '写家里那间店：卷帘门、计算器、你妈算账时嘴里念念有词。他出来上班，家里人觉得"给人打工能有什么出息"。' },
  '单亲家庭': { money: 3000, remit: 600, subsidy: 0, rentCut: 1, retreat: false, attrs: { '情绪': 5, '谋划': 2 },
    risk: { p: 1, money: 2000, text: '家里那一个人病倒了，住了院，没人照顾，医药费也要你出' },
    desc: '从小跟着妈或者爸一个人过，早早就懂事。你遇事稳得住；可家里只有那一个人，生病了全靠你。',
    story: '写他每天给家里那一个人打的电话，问吃了没、药按时吃了没；他攒钱比谁都狠，因为知道没人兜底。' },
  '留守长大': { money: 2000, remit: 1000, subsidy: 0, rentCut: 1, retreat: false, attrs: { '体能': 5, '情绪': 2, '表达': -3 },
    risk: { p: 1, money: 1500, text: '老家的奶奶摔了一跤，爸妈还在外地打工回不来，电话打到你这儿' },
    desc: '爸妈在外地打工，你跟爷爷奶奶长大。能吃苦、能熬；可跟爸妈不亲，爷爷奶奶老了也得你来管。',
    story: '写他跟爸妈的电话总是冷场，跟奶奶的电话一打半小时；他寄回去的钱，一半给爸妈，一半偷偷给奶奶。' },
  '孤儿院长大': { money: 1000, remit: 0, subsidy: 0, rentCut: 1, retreat: false, attrs: { '情绪': 6, '体能': 3 }, nokin: true,
    npc: { tie: '院里一起长大的', job: '在工地上干活', age: 24, rel: 60, close: true, note: '比主角大两岁，小时候替主角打过架', care: '兄弟情义', fact: '是跟主角在孤儿院一起长大的' },
    risk: { p: 0.6, text: '孤儿院的老院长打电话来，说院里要拆了，问你能不能回来看看' },
    desc: '你在福利院长大，十八岁那年自己出来。没人催没人管，心里硬；可没有家里人能借钱、能托底，逢年过节也没地方去。',
    story: '从他离开福利院那天写起，或者写他开始工作后第一次回院里；他的手机通讯录很短。' }
};

const CITIES = {
  // rent：合租一间次卧的行情；shop：铺面、房价、办酒照这个算（老数，别跟着房租动）
  '一线': { rent: 1900, shop: 2600, living: 2400, pay: 6300, dense: 1.25, desc: '机会多，人也多，房租能吃掉你小三成工资。' },
  '新一线': { rent: 1100, shop: 1700, living: 1800, pay: 4800, dense: 1.0, desc: '不上不下的地方，日子能过，风口小一些。' },
  '老家县城': { rent: 450, shop: 700, living: 1200, pay: 3000, dense: 0.62, desc: '花销低，熟人多，想干点新鲜事没什么人接得住。' }
};

const FREEDOM = {
  '心想事成': { check: 15, cost: 0.4, badMul: 0.45, growth: 1.35, keyEase: 18, bizEase: 1.25,
    fiat: true, fateFloor: 11,
    tone: `【本局口径·心想事成】这一局是玩家点单，他说什么就是什么。
玩家写下的行动，一律视为已经办成，你只负责写它是怎么办成的。不许判断它合不合理，不许替他打折。
这一局里没有"差一点""再等等""先试试看"这种东西；也不要写倒霉事、不要写他被人晾着、被拒绝、被放鸽子。
他要见的人见得到，要的东西拿得到，开的口对方接得住。荒唐的事也照办，但要写得像真的发生过。
只有两种例外照实写：引擎标了【没成】的硬条件（钱不够、本来就没有这样东西），和关键局已经定下的结果。` },
  '都市传奇': { check: 6, cost: 0.7, badMul: 0.75, growth: 1.15, keyEase: 5, bizEase: 1.1,
    tone: '【本局口径】都市传奇：比现实好走一些，主角有主角的运气，但该付的代价要付，失败是真失败。' },
  '写实人生': { check: 0, cost: 1, badMul: 1, growth: 1, keyEase: 0, bizEase: 1,
    tone: '【本局口径】写实人生：概率贴着现实来。跳槽大多只涨一点，创业大概率黄，贵人不常有，好事不扎堆。别写爽文。' }
};

const TRACKS = {
  '创作':   { skill: '笔力', ph: '写出一本有人愿意掏钱买的书' },
  '创业':   { skill: '经营', ph: '做出一个能养活自己和几个人的东西' },
  '手艺':   { skill: '手艺', ph: '开一家自己的店，做的东西有人专程来吃' },
  '职场':   { skill: '业务', ph: '做到能自己拍板的位置' },
  '科研':   { skill: '研究', ph: '把一个问题真正解决掉，署自己的名' },
  '表演':   { skill: '台风', ph: '站上一个像样的舞台，底下坐满人' },
  '教书':   { skill: '教学', ph: '教出一批真正被我改变过的人' },
  '公益':   { skill: '组织', ph: '把一件没人管的事管起来' },
  '把家过好': { skill: '持家', ph: '有个踏实的小家，谁都不必再漂着' },
  '从政':   { skill: '政务', ph: '从基层干起，做到能真正管一方事的位置',
    rule: '体制内的路：先考进去（公务员、选调、事业编），再一级一级往上走。升迁看资历、政绩、站队和机会，考不上、卡在一个位置上好多年都是常事。写真实的机关日子，不写官场爽文。' },
  '体育':   { skill: '竞技', ph: '拿一个像样的冠军，名字写进成绩单',
    rule: '刚出校门才正式走这条路，当职业运动员的门很窄：更现实的是业余赛、半职业联赛、教练、裁判、体育机构。伤病和年龄是硬约束，练坏了就是练坏了。' },
  '捞偏门': { skill: '门道', ph: '在道上站稳，有自己的一摊和规矩',
    rule: '这是一条灰色、违法的路：可以写主角被卷进去、一步步陷深、赚到快钱、结仇、被查、被抓、判刑坐牢，后果必须是真的，不许轻轻带过。只写人、事和代价，不写任何能照着做的具体手法——怎么骗、怎么做货、怎么洗钱这类细节一律虚写带过。' },
  '行医':   { skill: '医术', ph: '成为一个病人会点名来找的医生',
    rule: '规培、考证、熬资历是躲不过去的；医疗上的事写得真实克制，不给读者当诊疗建议。' },
  '法律':   { skill: '法务', ph: '打赢一场所有人都说赢不了的官司' },
  '做博主': { skill: '内容', ph: '做一个几十万人愿意追着看的账号' },
  '投资':   { skill: '眼光', ph: '靠自己的判断攒下第一个一百万',
    rule: '赚赔都要听引擎的判定，不许让主角靠预知或内幕暴富；亏起来是真亏，可以亏到借钱。' },
  '回乡':   { skill: '农事', ph: '回老家把一片地、一个村子做起来' }
};

/* ---------- 日程 ---------- */
const SLOTS = ['早', '白天', '晚上', '深夜'];
const ACTS = {
  '主业': { en: -9,  gain: { '专业': 0.03 }, work: 1 },
  '理想': { en: -8,  gain: { '专业': 0.028 }, ideal: 1 },
  '人情': { en: -5,  gain: { '表达': 0.028 }, social: 1 },
  '身心': { en: 6,   gain: { '体能': 0.03, '情绪': 0.014 } },
  '学习': { en: -7,  gain: { '谋划': 0.028, '专业': 0.018 } },
  '顾家': { en: -3,  gain: { '情绪': 0.02 }, home: 1 },
  '闲着': { en: 4,   gain: {} },
  '睡觉': { en: 0,   gain: {}, sleep: 1 },
  '兼职': { en: 0,   gain: {}, gig: 1 }
};
const SLEEP_EN = { '早': 5, '白天': 6, '晚上': 7, '深夜': 14 };
const ATTRS = ['专业', '表达', '谋划', '情绪', '体能'];

const DEF_SCHEDULE = {
  work: { '早': '睡觉', '白天': '主业', '晚上': '理想', '深夜': '睡觉' },
  rest: { '早': '睡觉', '白天': '身心', '晚上': '人情', '深夜': '睡觉' }
};
// 这阵子的重心：玩家只挑一个，引擎照着排工作日和周末的时段
// w/r = [工作日晚上, 周末白天, 周末晚上]；工作日白天都是上班，早上和深夜都在睡
const PACES = {
  '两头兼顾': { w: '理想', r: ['身心', '人情'], say: '下班弄点自己的事，周末歇一天、见见人', gain: '样样都沾一点，样样都不快', story: '工作日下班后弄自己的事，周末休息、见朋友，日子不紧不松' },
  '拼工作': { w: '主业', r: ['主业', '闲着'], say: '下了班接着干，周末也泡在活上', gain: '绩效和生意涨得快；人累，朋友和家里慢慢凉', story: '一门心思扑在工作上，天天加班，周末也在干活，顾不上别的' },
  '搞理想': { w: '理想', r: ['理想', '理想'], say: '下班回来就弄自己的事，周末整天扑在上面', gain: '理想的功夫攒得快；朋友和家里顾不上', story: '下班和周末的时间几乎全给了自己想干成的那件事' },
  '多走动': { w: '人情', r: ['人情', '人情'], say: '晚上和周末都在外面见人、吃饭、帮忙', gain: '关系往上走，嘴皮子练出来；自己的事停着', story: '下班和周末常在外面约人吃饭、帮忙、走动，人情上花心思' },
  '顾家': { w: '顾家', r: ['顾家', '顾家'], say: '下班就回家，周末陪家里人', gain: '家里热乎、心里安稳；别的只保底', story: '下班就回家，周末都陪着家里人' },
  '充电': { w: '学习', r: ['学习', '身心'], say: '晚上和周末上课、看书、考证', gain: '本事和脑子长得快；累，顾不上人', story: '下班和周末在上课、看书、备考，给自己充电' },
  '歇一歇': { w: '闲着', r: ['身心', '闲着'], say: '上班之外什么都不干，睡够，出去走走', gain: '精力和身体回得快；什么都不涨', story: '上班之外什么都不干，好好睡觉、出去走走，让自己缓一缓' }
};
function setPace(S, name) {
  const P = PACES[name] || PACES['两头兼顾'];
  if (S.pace && S.pace !== name) S.paceFrom = { name: S.pace, day: S.stats ? S.stats.days : 0 };
  S.pace = PACES[name] ? name : '两头兼顾';
  S.schedule = {
    work: { '早': '睡觉', '白天': '主业', '晚上': P.w, '深夜': '睡觉' },
    rest: { '早': '睡觉', '白天': P.r[0], '晚上': P.r[1], '深夜': '睡觉' }
  };
  return S.pace;
}
function fixPace(S) { if (!S.pace || !PACES[S.pace]) setPace(S, '两头兼顾'); }

/* ---------- 日期 ---------- */
const WD = ['日', '一', '二', '三', '四', '五', '六'];
function dOf(s) { return new Date(s.y, s.m - 1, s.d); }
function fromDate(dt) { return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() }; }
function addDays(s, n) { const dt = dOf(s); dt.setDate(dt.getDate() + n); return fromDate(dt); }
function wdOf(s) { return WD[dOf(s).getDay()]; }
function isRest(s) { const w = dOf(s).getDay(); return w === 0 || w === 6; }
function dateStr(s) { return `${s.y}年${s.m}月${s.d}日 星期${wdOf(s)}`; }
function shortDate(s) { return `${s.m}月${s.d}日`; }
function daysBetween(a, b) { return Math.round((dOf(b) - dOf(a)) / 86400000); }
// 节日：只挑对生活真有影响的几个
function festivalOf(s) {
  if (s.m === 1 && s.d === 1) return '元旦';
  if (s.m === 2 && s.d === 14) return '情人节';
  if (s.m === 5 && s.d === 1) return '劳动节';
  if (s.m === 10 && s.d === 1) return '国庆';
  if (s.m === 12 && s.d === 31) return '除夕前后';  // 农历不算，粗略给个年关
  return null;
}

/* ---------- 骰 ---------- */
const mkRng = seed => {
  let x = seed >>> 0 || 88172645;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
};
const d20 = rng => 1 + Math.floor(rng() * 20);
const rollMod = r => Math.round((r - 10.5) * 4);
const rnd = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

function fateInfo(r) {
  if (r <= 3) return { label: '大凶', cls: 'bad', short: '这几天走背字', desc: '这几天走背字，事情横生变故' };
  if (r <= 8) return { label: '不顺', cls: 'bad', short: '磕磕绊绊', desc: '不太顺当，有小挫折或小代价，收获打折' };
  if (r <= 14) return { label: '平常', cls: '', short: '不好不坏', desc: '按常理发展，不好不坏' };
  if (r <= 18) return { label: '顺遂', cls: 'good', short: '事情顺手', desc: '事情顺利，略有收获' };
  return { label: '大吉', cls: 'great', short: '撞上好事了', desc: '意外之喜：贵人、机会、横财、被人看见，须与眼下的事相合' };
}
// 天命落到身上的那一点：只动精力和口碑，大头还是交给剧情
function applyFate(S, r) {
  const p = S.player;
  let en = 0, rep = 0;
  if (r <= 3) en = -8; else if (r <= 8) en = -3; else if (r >= 19) { en = 6; rep = 1; } else if (r >= 15) en = 3;
  if (en) p.energy = clamp(p.energy + en, 0, energyCap(S));
  if (rep) p.信誉 = clamp(p.信誉 + rep, 0, 100);
  return [en ? `精力${en > 0 ? '+' : ''}${en}` : '', rep ? `口碑+${rep}` : ''].filter(Boolean).join('　');
}

function fdm(S) { return FREEDOM[S.freedom] || FREEDOM['写实人生']; }

function attrVal(S, name) {
  const p = S.player;
  let v = num(p.attrs[name]);
  if (p.energy < 30) v -= Math.round((30 - p.energy) * 0.5);
  if (S.broke) v -= 6;
  v -= Math.round(chronicLoad(S) * 2);
  v += fdm(S).check;
  return Math.round(v);
}

function rollCheck(S, attr, need, rng) {
  const val = attrVal(S, attr);
  const roll = d20(rng);
  const total = val + rollMod(roll);
  const dc = Math.max(20, num(need));
  const fiat = !!fdm(S).fiat;                       // 言出法随：判定只是走个过场
  const crit = fiat ? (roll >= 18 ? '大成功' : '') : (roll === 20 ? '大成功' : (roll === 1 ? '大失败' : ''));
  const success = fiat ? true : (roll === 20 ? true : (roll === 1 ? false : total >= dc));
  return { attr, val, roll, mod: rollMod(roll), need: dc, total, success, crit, fiat };
}

/* ---------- 开局 ---------- */
function newState(o) {
  const city = CITIES[o.city] || CITIES['新一线'];
  const org = ORIGINS[o.origin] || ORIGINS['普通家庭'];
  const track = TRACKS[o.track] || TRACKS['职场'];
  const startY = o.startYear || new Date().getFullYear();
  const start = { y: startY, m: 7, d: 1 };
  const bg = bgEffect(o);
  const pay = Math.round(city.pay * (0.82 + (o.payRoll || 0.3) * 0.26) * bg.pay / 100) * 100;
  const attrs = { '专业': 22, '表达': 20, '谋划': 20, '情绪': 24, '体能': 30 };
  for (const k in bg.add) attrs[k] = clamp(attrs[k] + bg.add[k], 5, 60);
  for (const k in (org.attrs || {})) attrs[k] = clamp(attrs[k] + org.attrs[k], 5, 60);
  const S0 = {
    v: SAVE_VERSION,
    runId: 'r' + startY + '-' + Math.floor((o.rngSeed || 1) % 100000),
    seg: 0,
    date: start, startDate: start,
    freedom: o.freedom || '都市传奇',
    origin: o.origin, city: o.city,
    player: {
      name: o.name || '无名', gender: o.gender || '男', age: bg.age, age0: bg.age, face: String(o.face || ''),
      bg: { edu: EDUS[o.edu] ? o.edu : '本科', school: SCHOOLS[o.school] ? o.school : '普通', major: MAJORS[o.major] ? o.major : '', persona: PERSONAS[o.persona] ? o.persona : '', looks: LOOKS[o.looks] ? o.looks : '' },
      track: o.track, skillName: track.skill,
      ideal: o.ideal || track.ph,
      job: o.job || '一份刚找到的活',
      attrs: Object.assign({}, attrs),
      attrF: Object.assign({}, attrs),
      energy: 78,
      money: org.money,
      信誉: clamp(8 + bg.rep + num(org.rep), 0, 100), 人品: 50,
      资历天: 0
    },
    ledger: {
      rent: Math.round(city.rent * org.rentCut), living: Math.round(city.living * (org.livingX || 1) / 100) * 100,
      remit: org.remit, subsidy: org.subsidy, salary: pay,
      rentDay: 1, salaryDay: 10, loan: 0, base: pay
    },
    job: { employer: '', post: '', title: '', lv: 0, perf: 0, probation: false, quarters: 0, days: 0, mood: 0, out: false, strain: 1 },
    debts: [], rifts: [], ailLog: {}, moments: [], momentId: 0,
    biz: null, bizPast: [], wind: null, era: [], eraLeft: 0, years: [],
    home: { kind: '租', since: '', place: '', tier: '合租次卧' },
    gigs: [], bag: [],
    family: { partner: null, kids: [], past: [] },
    retireAge: 60, endedOnce: [],
    pace: '两头兼顾',
    schedule: { work: Object.assign({}, DEF_SCHEDULE.work), rest: Object.assign({}, DEF_SCHEDULE.rest) },
    ideal: { progress: 0, stages: [] },
    key: null,
    npcs: [], peers: [], msgs: [], appts: [], unresolved: [],
    status: [], chronic: [],
    focus: null, stopWhen: [], pledges: [], plan: null,
    place: '', scene: null,
    recent: [], history: [], volumes: [], chapters: [],
    pending: null, lastOptions: [], lastAction: null, lastJudge: null,
    stats: { segs: 0, days: 0, stops: {}, checks: 0, wins: 0, keys: 0, keyWins: 0 },
    flags: { nightCnt: 0, cool: 0, firstPay: false, firstRent: false, lastPeer: 0, lastEvt: -99, monthNet: 0, rent2: 1 },
    broke: false, brokeMonths: 0, over: false, ending: null,
    booted: false
  };
  applyOrigin(S0, mkRng((o.rngSeed || 1) * 7 + 3));
  return S0;
}
// 出身带来的东西：房子、车、起手的熟人
function applyOrigin(S, rng) {
  const O = ORIGINS[S.origin];
  if (!O) return;
  if (O.house) {
    S.home = { kind: '买', since: '家里分的', place: '', tier: '合租次卧', price: housePrice(S), loan: { left: 0, monthly: 0, months: 0, paid: 0, done: true } };
    S.ledger.rent = 0;
  }
  for (const id of (O.items || [])) {
    const it = itemOf(id); if (!it) continue;
    S.bagId = num(S.bagId) + 1;
    S.bag.push({ uid: S.bagId, id, name: it.name, cat: it.cat, keep: !!it.keep, gift: !!it.gift, tags: it.tags.slice(), price: it.price, day: 0, date: '家里给的', uses: 1 });
  }
  originNpc(S, rng);
}

// 老存档补齐：开局那会儿没记单位名
function fixJob(S) {
  if (!S.job) S.job = { employer: '', post: '', title: '', lv: 0, perf: 0, probation: false, quarters: 0, days: 0, mood: 0, out: false };
  S.job.probation = false;                        // 不再有试用期
  // 老存档：岗位和职级以前搅在一起，拆出来
  if (S.job.post === undefined) {
    const t = String(S.job.title || '');
    S.job.post = LEVELS.some(x => x.t === t) ? '' : t;
  }
  if (!S.job.employer && !S.job.out && S.player && S.player.job) {
    const m = String(S.player.job).match(/^(.{2,10}?)(的)?(实习|助理|专员|编辑|设计|运营|职员|工程师|学徒|服务员|销售)?$/);
    S.job.employer = (m && m[1]) ? m[1] : String(S.player.job).slice(0, 10);
  }
  fixLife(S);
  return S.job;
}

/* ---------- 一天 ---------- */
const HEAL_PLAN = { '早': '睡觉', '白天': '身心', '晚上': '闲着', '深夜': '睡觉' };
function todayPlan(S) {
  // 在养病就不上班：这几天的作息由不得你排
  if (S.focus && S.focus.heal) return SLOTS.map(sl => ({ slot: sl, act: HEAL_PLAN[sl] }));
  const t = isRest(S.date) ? S.schedule.rest : S.schedule.work;
  const gig = {};
  for (const g of gigToday(S)) gig[GIGS[g.name].slot] = g.name;
  return SLOTS.map(sl => gig[sl] ? { slot: sl, act: '兼职', gig: gig[sl] } : { slot: sl, act: t[sl] || '闲着' });
}

function growAttr(S, name, amt) {
  const p = S.player;
  const cur = num(p.attrF[name]);
  const room = Math.max(0.08, 1 - cur / 100);
  const gain = amt * room * fdm(S).growth * (p.energy >= 40 ? 1 : 0.6);
  p.attrF[name] = r2(cur + gain);
  p.attrs[name] = Math.round(p.attrF[name]);
}

// 跑一天。返回这天攒下的小事（不一定停）
function dayTick(S, rng) {
  const ev = [];
  const p = S.player;
  const plan = todayPlan(S);
  const BF = bagFx(S);
  let en = -6, slept = 0;   // 活着本身的消耗

  for (const it of plan) {
    const a = ACTS[it.act] || ACTS['闲着'];
    if (a.sleep) { slept++; en += Math.round((SLEEP_EN[it.slot] || 8) * (slept >= 3 ? 0.4 : 1)); }
    else if (a.gig) {
      const G = GIGS[it.gig];
      en -= G ? G.en : 6;
      if (G) growAttr(S, G.attr, 0.02);
    }
    else {
      en += a.en;
      for (const k in a.gain) growAttr(S, k, a.gain[k]);
      if (a.work) { p.资历天 = (p.资历天 || 0) + 1; if (!S.job.out && !(S.biz && !S.biz.dead)) en += STRAIN_EN[clamp(num(S.job.strain === undefined ? 1 : S.job.strain), 0, 3)]; }
      if (a.ideal) S.ideal.progress = r2(S.ideal.progress + 0.6 + p.attrs['专业'] / 150);
      if (a.social) S.flags.socialToday = 1;
      if (a.home) S.flags.homeDays = (S.flags.homeDays || 0) + 0.5;
    }
    if (it.slot === '深夜' && !a.sleep) { en -= 7; S.flags.nightCnt++; }
  }
  if (S.biz && !S.biz.dead) bizTend(S, plan); else jobTick(S, plan);

  if (S.focus) {
    const f = S.focus;
    if (f.heal) { f.left--; en += 4; }        // 养病：反过来往回补
    else {                                     // 干活：投入期间压榨自己
      const eff = (1 + (p.attrs[f.attr] || 20) / 80 + (p.energy > 60 ? 0.2 : -0.2)) * (1 + num(BF.workX) * (/专业|谋划/.test(f.attr) ? 1 : 0.5) + num(BF.camera) * (/拍|视频|博主|摄影|vlog/i.test(f.what) ? 1 : 0));
      f.progress = r2(f.progress + eff);
      f.left--;
      en -= 3;
    }
  }
  // 住处、床垫、通勤、宿醉
  if (S.home && S.home.kind !== '买') { const H = HOUSING[homeTier(S)]; en += H.en - (plan.some(x => x.act === '主业') ? H.commute : 0); }
  else if (S.home && S.home.kind === '买') en += 2;
  en += Math.round(num(BF.sleep));
  if (BF.back && S.chronic.length) en += 1;
  if (S.flags.hangover) { en -= 10; S.flags.hangover = 0; }
  for (const st of S.status) { en -= 3; st.days--; }
  const healed = S.status.filter(s => s.days <= 0);
  if (healed.length) { S.status = S.status.filter(s => s.days > 0); for (const h of healed) ev.push({ t: '身体', s: `${h.name}好了` }); }

  p.energy = clamp(Math.round(p.energy + en), 0, energyCap(S));

  // 关系自己凉：越久没来往掉得越快，家里人和天天见面的慢一些
  for (const n of S.npcs) {
    if (n.rel == null) continue;
    const gap = S.stats.days - (n.lastSeen || 0);
    if (S.flags.socialToday && n.close) { n.rel = r2(Math.min(100, n.rel + 0.35)); continue; }
    if (gap < 7) continue;
    let rate = gap > 60 ? 0.11 : gap > 25 ? 0.07 : 0.035;
    if (n.close) rate *= 0.5;
    n.rel = r2(Math.max(0, n.rel - rate));
  }
  S.flags.socialToday = 0;

  // 熬夜和低精力要还
  if (p.energy < 25 && rng() < 0.09 && !S.status.some(s => s.name === '感冒')) {
    S.status.push({ name: '感冒', desc: '扛不住了，嗓子先坏的', days: rnd(rng, 3, 6) });
    const got = noteAil(S, '感冒');
    return { ev, stop: { kind: '身体', detail: got ? '又病倒了，这回是老毛病了' : '撑不住病倒了' } };
  }
  if (S.flags.nightCnt >= 12 && !S.status.some(s => s.name === '失眠')) {
    S.flags.nightCnt = 0;
    S.status.push({ name: '失眠', desc: '作息彻底乱了，躺下就是睁着眼', days: rnd(rng, 8, 16) });
    const got2 = noteAil(S, '失眠');
    return { ev, stop: { kind: '身体', detail: got2 ? '又睡不着了，这回落下了' : '连着熬，睡不着了' } };
  }

  return { ev, stop: null };
}

/* ---------- 明细账 ---------- */
// 每笔进出记一行，按月归档；月底对不上的差额在账本里显示成「零碎」
function acctKey(d) { return d.y + '-' + String(d.m).padStart(2, '0'); }
function acct(S, item, amt, note, moneyBefore) {
  amt = Math.round(num(amt));
  if (!amt) return;
  S.acct = S.acct || {};
  const k = acctKey(S.date);
  if (!S.acct[k]) {
    const before = moneyBefore != null ? moneyBefore : S.player.money - amt;
    S.acct[k] = { open: before, rows: [] };
    const ks = Object.keys(S.acct).sort();
    while (ks.length > 13) delete S.acct[ks.shift()];
  }
  S.acct[k].rows.push({ d: S.date.d, item, amt, note: note ? String(note).slice(0, 30) : '' });
}

/* ---------- 月度收支（挂在日历上） ---------- */
function moneyTick(S, rng) {
  const L = S.ledger, p = S.player, d = S.date, ev = [];
  let stop = null;
  if (d.d === L.rentDay && S.biz && !S.biz.dead) {
    const b = bizMonth(S, rng);
    if (b) {
      ev.push({ t: '钱', s: `${S.biz.name}这个月进${b.rev}、出${b.cost}，${b.net >= 0 ? '剩' + b.net : '亏了' + (-b.net)}` });
      if (b.gone.length) ev.push({ t: '人情', s: `${b.gone.join('、')}不干了` });
      if (b.danger) stop = { kind: '生意', detail: `${S.biz.name}连亏${b.lossMonths}个月，再这样撑不下去` };
      else if (b.gone.length) stop = { kind: '生意', detail: `${b.gone.join('、')}从${S.biz.name}走了` };
      else if (S.biz.months <= 1) stop = { kind: '生意', detail: `${S.biz.name}的第一个月：进${b.rev}，出${b.cost}` };
    }
  }
  if (d.d === L.rentDay) {
    const kid = kidCost(S);
    const loan = num(L.loan);
    if (loan) homeTick(S);
    const out = L.rent + loan + L.living + L.remit + kid;
    const m0 = p.money;
    if (S.flags.rentAdj) { acctNote(S, '房租调整', `${S.flags.rentAdj.from}→${S.flags.rentAdj.to}，按行情`); S.flags.rentAdj = null; }
    p.money -= out;
    if (L.rent) acct(S, '房租', -L.rent, '', m0);
    if (loan) acct(S, '房贷月供', -loan, '', m0);
    acct(S, '吃穿用度', -L.living, '', m0);
    if (kid) acct(S, '养孩子', -kid, '', m0);
    if (L.remit) acct(S, '寄回家', -L.remit, '', m0);
    S.flags.monthNet -= out;
    ev.push({ t: '钱', s: `${L.rent ? `房租${L.rent}、` : ''}${loan ? `月供${loan}、` : ''}生活${L.living}${kid ? `、孩子${kid}` : ''}${L.remit ? `、寄回家${L.remit}` : ''}，一共去了${out}` });
    if (!S.flags.firstRent) { S.flags.firstRent = true; stop = { kind: '钱', detail: '第一次自己交这些钱' }; }
    const lt = loanTick(S);
    ev.push(...lt.ev);
    if (lt.stop) stop = lt.stop;
  }
  if (d.d === L.salaryDay && !S.job.out) {
    // 看提成的活：每个月不一样，表达好的拿得多
    const sal = S.job.vary ? Math.round(L.salary * clamp(0.7 + (attrVal(S, '表达') - 25) / 90 + rng() * 0.35, 0.55, 1.6) / 10) * 10 : L.salary;
    const inc = sal + L.subsidy;
    const m0 = p.money;
    p.money += inc;
    acct(S, S.job.vary ? '工资（含提成）' : '工资', sal, S.job.employer || '', m0);
    if (L.subsidy) acct(S, '家里给的', L.subsidy, '', m0);
    S.flags.monthNet += inc;
    ev.push({ t: '钱', s: `发了${sal}${S.job.vary ? '（底薪加提成）' : ''}${L.subsidy ? `，家里又打来${L.subsidy}` : ''}` });
    if (!S.flags.firstPay) { S.flags.firstPay = true; stop = { kind: '钱', detail: '第一笔自己挣的工资到账' }; }
  }
  if (d.d === L.salaryDay && S.job.out) {
    if (L.subsidy) { p.money += L.subsidy; acct(S, '家里给的', L.subsidy); S.flags.monthNet += L.subsidy; ev.push({ t: '钱', s: `没有工资，家里打来${L.subsidy}` }); }
    else ev.push({ t: '钱', s: '这个月没有工资' });
  }
  if (d.d === 28) {   // 月末看账
    const net = S.flags.monthNet;
    const floor = L.rent + L.living + bankOf(S).loans.reduce((a, x) => a + (x.left > 0 ? x.monthly : 0), 0);
    S.flags.monthNet = 0;
    if (p.money < 0) {
      S.broke = true; S.brokeMonths++;
      stop = { kind: '钱', detail: `账上是负的（${p.money}），得想办法` };
    } else if (p.money < floor + num(L.loan)) {
      stop = { kind: '钱', detail: `剩下的钱撑不到下个月（${p.money}）` };
    } else if (net < 0) {
      stop = { kind: '钱', detail: `这个月倒贴了${-net}` };
    } else { S.broke = false; }
  }
  return { ev, stop };
}

/* ---------- 同辈对照组 ---------- */
// 每条：动静、朋友圈怎么说、这件事让他涨还是跌、会不会来找你（找你干嘛）
const PEER_MOVES = [
  ['升了职', ['转正了，组长', '今天起换了个title，活还是那些活'], 8, '挖你'],
  ['跳了家公司', ['下周入职新的地方，江湖再见', '换东家了，涨了一点'], 5, '挖你'],
  ['辞职去做自己的东西了', ['辞了。想清楚了，不干了', '最后一天，工位收拾干净了'], 2, '合伙'],
  ['拿到一笔钱', ['谈下来了，下周打款', '见了三个人，有一个给钱了'], 12, '合伙'],
  ['搬去了别的城市', ['搬走啦，有空来玩', '换个城市重来一次'], 0, null],
  ['结婚了', ['领证了', '下个月办酒，记得来'], 2, '喜事'],
  ['分手了', ['分了。别问', '一个人住了'], -2, '求助'],
  ['买了房', ['签了，三十年', '钥匙拿到手了，空的，什么都没有'], 6, null],
  ['创业黄了', ['关了。欠的慢慢还', '散伙了，挺好的'], -15, '借钱'],
  ['回老家考编了', ['回去了，考编', '不折腾了'], -3, null],
  ['出了点成绩被人认识了', ['被人转了一圈，有点懵', '有人找我约稿了'], 10, '抢'],
  ['生病歇了一阵', ['住了几天院，没大事', '歇了半个月，现在能下床了'], -6, '求助']
];
// 主角自己混到什么水位，用来跟同期对照
function selfLevel(S) {
  const p = S.player;
  const miles = S.ideal.stages.reduce((a, st) => a + st.milestones.filter(m => m.done).length, 0);
  const b = S.biz && !S.biz.dead ? num(S.biz.rep) * 0.22 + (num(S.biz.net) > 0 ? 6 : 0) : 0;
  return clamp(Math.round(p.信誉 * 0.32 + Math.min(32, Math.max(0, p.money) / 9000) + miles * 7 + num(S.job.lv) * 3 + b), 0, 100);
}
function peerWord(S, pr) {
  const d = num(pr.level) - selfLevel(S);
  if (d >= 22) return '混得比你好不少';
  if (d >= 8) return '比你强一点';
  if (d > -8) return '跟你差不多';
  if (d > -22) return '不如你';
  return '过得比你差远了';
}
const PEER_HOOK = {
  '合伙': p => `${p.name}来找你合伙`,
  '挖你': p => `${p.name}想把你挖过去`,
  '抢':   p => `${p.name}跟你盯上了同一个机会`,
  '借钱': p => `${p.name}开口要跟你借钱`,
  '求助': p => `${p.name}遇上事了，来找你`,
  '喜事': p => `${p.name}的喜事，要你到场`
};
function peerTick(S, rng) {
  const ev = [];
  if (!S.peers.length) return { ev, stop: null };
  S.flags.lastPeer++;
  if (S.flags.lastPeer < rnd(rng, 12, 28)) return { ev, stop: null };
  S.flags.lastPeer = 0;
  const pr = pick(rng, S.peers);
  if (pr.level == null) pr.level = rnd(rng, 38, 58);
  const mvRow = pick(rng, PEER_MOVES);
  const mv = mvRow[0], says = mvRow[1], up = mvRow[2], hook = mvRow[3];
  pr.track = (pr.track || []).concat([mv]).slice(-4);
  pr.level = clamp(num(pr.level) + num(up) + rnd(rng, -2, 3), 0, 100);
  pr.last = mv;
  ev.push({ t: '人情', s: `${pr.name}${mv}` });
  addMoment(S, pr.name, pick(rng, says), 'peer');

  // 这件事要不要牵到主角身上
  const gap = num(pr.level) - selfLevel(S);
  let use = null, p0 = 0.5;
  if (hook === '挖你' && gap >= 6) { use = '挖你'; p0 = 0.6; }
  else if (hook === '借钱' && gap <= -6) { use = '借钱'; p0 = 0.6; }
  else if (hook === '抢' && Math.abs(gap) <= 20) { use = '抢'; p0 = 0.65; }
  else if (hook === '合伙' && gap >= -12) { use = '合伙'; p0 = 0.6; }
  else if (hook === '喜事') { use = '喜事'; p0 = 0.45; }
  else if (hook === '求助' && gap <= 12) { use = '求助'; p0 = 0.3; }   // 这个别太频繁
  if (use && rng() < p0) {
    // 从此他是个能说上话的人，不再只是朋友圈里的名字
    if (!S.npcs.some(n => n.name === pr.name)) {
      S.npcs.push({ name: pr.name, age: S.player.age, job: pr.note || '同期', rel: 38, tie: '同学',
        care: '', note: (pr.track || []).slice(-2).join('，'), close: false, mem: [], lastSeen: S.stats.days,
        gender: guessGender(pr.gender, '同学', pr.note, pr.name), ageY: S.date.y });
    }
    pr.npc = true;
    return { ev, stop: { kind: '同期', detail: PEER_HOOK[use](pr) + `（他${mv}，${peerWord(S, pr)}）`, peer: pr.name, hook: use } };
  }
  if (/升了职|拿到一笔钱|出了点成绩|买了房/.test(mv) && rng() < 0.4)
    return { ev, stop: { kind: '人情', detail: `${pr.name}${mv}，消息传到你这儿（${peerWord(S, pr)}）` } };
  return { ev, stop: null };
}

/* ---------- 认识的人主动找你 ---------- */
function npcTick(S, rng) {
  if (!S.npcs.length) return { ev: [], stop: null };
  if (rng() > 0.022) return { ev: [], stop: null };
  const cand = S.npcs.filter(n => {
    const gap = S.stats.days - (n.lastSeen || 0);
    return n.rel >= 25 && gap >= 18;
  });
  if (!cand.length) return { ev: [], stop: null };
  cand.sort((a, b) => (a.lastSeen || 0) - (b.lastSeen || 0));
  const n = cand[Math.min(cand.length - 1, Math.floor(rng() * 2))];
  const gap = S.stats.days - (n.lastSeen || 0);
  return { ev: [], stop: { kind: '找上门', detail: `${n.name}（${n.tie}）${gap}天没联系了，忽然来找你`, npc: n.name } };
}

/* ---------- 随机事件（只给种类，内容交给 LLM） ---------- */
const EVT_TAGS = ['工作', '钱', '身体', '人情', '机会', '家里'];
function evtChance(S) {
  let p = 0.040;   // 停点的总数攒多了，随机事件让一让
  const pl = S.player;
  if (pl.energy < 35) p += 0.025;
  if (S.unresolved.length >= 3) p += 0.02;
  if (S.broke) p += 0.03;
  if (S.home && homeTier(S) === '城中村单间' && S.home.kind !== '买') p += 0.008;
  p *= (CITIES[S.city] || CITIES['新一线']).dense;
  return p;
}
function pickTag(S, rng) {
  const bad = num(fdm(S).badMul);
  const w = { '工作': 3, '钱': 2 * bad, '身体': 1 * bad, '人情': 3, '机会': 2 / Math.max(0.5, bad), '家里': 1.5 };
  if (S.broke) w['钱'] += 3;
  if (S.player.energy < 35) w['身体'] += 2;
  if (S.focus) w['工作'] += 1;
  const band = standing(S);
  if (band >= 2) { w['人情'] += band; w['找你办事的人'] = band * 1.5; w['有人盯着你'] = (band - 1) * 0.8; w['钱'] *= 0.6; }
  let tot = 0; for (const k in w) tot += w[k];
  let r = rng() * tot;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return '人情';
}

/* ---------- 推进器：一天天跑，跑到该停为止 ---------- */
function advance(S, opt) {
  opt = opt || {};
  const rng = opt.rng || Math.random;
  const quiet = !!opt.quiet;          // 就地办事的短段：只认躲不开的事，别拿闲事打断
  const maxDays = opt.maxDays !== undefined ? opt.maxDays : 35;
  const from = S.date;
  const events = [];
  let stop = null, days = 0;

  while (days < maxDays) {
    S.date = addDays(S.date, 1);
    days++;
    S.stats.days++;
    if (S.flags.cool > 0) S.flags.cool--;

    // 生日：开局那个月日
    if (S.date.m === S.startDate.m && S.date.d === S.startDate.d && S.date.y > S.startDate.y) {
      S.player.age = (S.player.age0 || 22) + (S.date.y - S.startDate.y);
      kidsGrow(S);
      events.push({ t: '家里', s: `你${S.player.age}岁了${(S.family.kids || []).filter(k => !k.unborn).length ? `，${S.family.kids.filter(k => !k.unborn).map(k => k.name + k.age + '岁').join('、')}` : ''}` });
    }

    // 到头了：这两件事排在所有停点前面
    const en = endReason(S);
    if (en && !S.over) { stop = { kind: '结局', detail: en.text, why: en.why }; break; }

    // 一年到头，别的什么都往后排
    if (S.date.m === 12 && S.date.d === 31) {
      const yp = newYearPackets(S);
      if (yp.length) events.push({ t: '家里', s: `${yp.map(p => p.from).join('、')}发了过年红包` });
      stop = { kind: '年终', detail: `${S.date.y}年过完了` };
      break;
    }

    const day = dayTick(S, rng);
    events.push(...day.ev);
    if (day.stop) { stop = day.stop; break; }

    const mon = moneyTick(S, rng);
    events.push(...mon.ev);
    if (mon.stop) { stop = mon.stop; break; }

    const dt = debtTick(S);
    events.push(...dt.ev);
    if (dt.stop) { stop = dt.stop; break; }

    const bk = bankTick(S, rng);
    events.push(...bk.ev);
    if (bk.stop && !quiet) { stop = bk.stop; break; }

    const wd = windTick(S, rng);
    events.push(...wd.ev);
    if (wd.stop && !quiet && S.flags.cool <= 0) { stop = wd.stop; break; }

    const fm = familyTick(S, rng);
    events.push(...fm.ev);
    if (fm.stop) { stop = fm.stop; break; }

    const rt = riftTick(S, rng);
    events.push(...rt.ev);
    if (rt.stop && !quiet && S.flags.cool <= 0) { stop = rt.stop; break; }

    // 季度考核
    if (S.date.d === 26 && [3, 6, 9, 12].includes(S.date.m) && !S.job.out) {
      const rv = review(S, rng);
      if (rv) {
        events.push({ t: '工作', s: rv.text });
        S.lastReview = rv;
        notePos(S);
        stop = { kind: '考核', detail: `${rv.kind}：${rv.text}`, review: rv };
        break;
      }
    }

    const fes = festivalOf(S.date);
    if (fes) events.push({ t: '家里', s: fes + '到了' });

    // 投入做完了
    if (S.focus && S.focus.left <= 0) {
      stop = { kind: '投入', detail: `${S.focus.what}这一摊子，到点了` };
      break;
    }

    // 约好的事
    const ap = S.appts.find(a => a.y === S.date.y && a.m === S.date.m && a.d === S.date.d && !a.done);
    if (ap) { ap.done = true; stop = { kind: '约', detail: ap.title, apptKind: ap.kind || '', promise: { type: 'appt', title: ap.title, kind: ap.kind || '', who: ap.wed ? ap.wed.who : apptWho(S, ap), post: ap.post || null, wed: ap.wed || null } }; break; }
    // 主角答应别人的事，到了日子：停下来问他去不去
    const pl = (S.pledges || []).find(x => !x.done && !x.asked && x.kind === '主角答应' && x.due && daysBetween(S.date, x.due) === 0);
    if (pl) { pl.asked = true; stop = { kind: '承诺', detail: `答应${pl.who}的「${pl.what}」`, promise: { type: 'pledge', who: pl.who, what: pl.what, title: `答应${pl.who}：${pl.what}` } }; break; }

    // 自设的停下条件
    const sw = checkStopWhen(S);
    if (sw) { stop = sw; break; }
    const pt = pledgeTick(S);
    events.push(...pt.ev);

    events.push(...lifeTick(S, rng));
    const og = originTick(S, rng);
    if (og && !quiet) { stop = og; break; }
    const ps = posTick(S);
    if (ps) { stop = ps; break; }

    const nt = npcTick(S, rng);
    if (nt.stop && !quiet && S.flags.cool <= 0) { stop = nt.stop; break; }

    const pe = peerTick(S, rng);
    events.push(...pe.ev);
    if (pe.stop && !quiet && S.flags.cool <= 0) { stop = pe.stop; break; }

    // 天命：偶尔掷一把，大吉大凶才停
    if (!quiet && S.flags.cool <= 0 && rng() < 0.022) {
      const f = d20(rng);
      if (f <= 3 || f >= 18) { stop = { kind: '运', detail: fateInfo(f).label, fate: f }; break; }
    }

    // 随机事件
    if (!quiet && S.flags.cool <= 0 && rng() < evtChance(S)) {
      stop = { kind: '事', detail: pickTag(S, rng) };
      break;
    }
  }

  if (!stop) stop = quiet ? { kind: '就地', detail: '' } : { kind: '久', detail: '这么些天过去，日子太静了' };
  if (!quiet) S.flags.cool = 2;
  S.stats.stops[stop.kind] = (S.stats.stops[stop.kind] || 0) + 1;
  if (S.focus && S.focus.left <= 0) { /* 交给 UI 结算 */ }

  return { from, to: S.date, days, events, stop };
}

/* ---------- 玩家一句话 → 引擎动作 ---------- */
// 难度档：按事情本身，不按年龄。属性起步二十来点，d20 修正 ±38
const DIFFS = { '顺手': 0, '普通': 20, '费劲': 32, '难': 45, '很难': 60 };
const STEP_TYPES = ['quit', 'repay', 'startBiz', 'closeBiz', 'spend', 'seekMoney', 'jobHunt', 'meet', 'focus', 'rest', 'loan', 'deposit', 'invest', 'other'];
function guessAttr(a) {
  a = String(a || '');
  if (/谈|说服|聊|讲|面试|汇报|推销|争|解释|道歉/.test(a)) return '表达';
  if (/查|想|算|计划|打听|研究|分析|找路子|比较/.test(a)) return '谋划';
  if (/跑|熬|扛|搬|加班|通宵|锻炼/.test(a)) return '体能';
  if (/忍|稳住|顶住|面对|撑/.test(a)) return '情绪';
  return '专业';
}
// 括号里的话：（……）或(...)
function splitAct(act) {
  const asks = [];
  const doing = String(act || '').replace(/[（(]([^（）()]*)[）)]/g, (_, x) => { if (x.trim()) asks.push(x.trim()); return ' '; }).replace(/\s+/g, ' ').trim();
  return { doing: doing || String(act || ''), asks };
}
// 解析调用失败时的兜底：括号里像"别替我做主"的算限制，其余算写法要求
const LIMIT_RE = /不要|不许|不准|别|先别|等我|让我|我来|不能|问我|我选|我决定|我确认|不替|不帮我|只.{0,6}不/;
function splitAsks(asks) {
  const limits = [], style = [];
  for (const a of asks || []) (LIMIT_RE.test(a) ? limits : style).push(a);
  return { limits, style };
}
// 选项按钮、兜底：整句当一件普通的事
function simplePlan(act, typed) {
  const sp = typed ? splitAct(act) : { doing: String(act || ''), asks: [] };
  const sa = splitAsks(sp.asks);
  return { steps: [{ type: 'other', text: sp.doing.slice(0, 60), diff: '普通', attr: guessAttr(sp.doing) }], limits: sa.limits, style: sa.style, days: 1, stopWhen: null, parsed: false };
}
// 解析调用返回的东西：只认白名单
function sanitizePlan(raw, act, typed) {
  const d = T.obj(raw);
  const base = simplePlan(act, typed);
  if (!d || !Array.isArray(d.steps) || !d.steps.length) return base;
  const steps = [];
  for (const x0 of d.steps) {
    const x = T.obj(x0);
    if (!x || !STEP_TYPES.includes(x.type)) continue;
    const st = { type: x.type, text: T.str(x.text, 60) || x.type, diff: DIFFS[x.diff] !== undefined ? x.diff : '普通', attr: ATTRS.includes(x.attr) ? x.attr : guessAttr(x.text) };
    if (x.who) st.who = T.str(x.who, 12);
    if (x.amount !== undefined) st.amount = Math.round(T.num(x.amount, 0, 1e9));
    if (x.days !== undefined) st.days = Math.round(T.num(x.days, 0, 365));
    if (x.kind) st.kind = T.str(x.kind, 6);
    if (x.term !== undefined) st.term = Math.round(T.num(x.term, 0, 120));
    if (x.name) st.name = T.str(x.name, 14);
    if (x.target) st.target = T.str(x.target, 20);
    if (x.borrow === true) st.borrow = true;
    steps.push(st);
  }
  if (!steps.length) return base;
  if (steps.length > 3) {                          // 一次最多三步，多的并成最后一件
    const rest = steps.splice(2);
    steps.push({ type: 'other', text: rest.map(r => r.text).join('，').slice(0, 60), diff: rest.reduce((a, r) => DIFFS[r.diff] > DIFFS[a] ? r.diff : a, '普通'), attr: rest[0].attr });
  }
  const limits = T.arr(d.limits, 5).map(x => T.str(x, 60)).filter(Boolean);
  const style = T.arr(d.style, 5).map(x => T.str(x, 80)).filter(Boolean);
  return {
    steps,
    limits: limits.length || style.length ? limits : base.limits,
    style: limits.length || style.length ? style : base.style,
    days: Math.round(T.num(d.days, 1, 365)) || 1,
    stopWhen: sanitizeStop(d.stopWhen),
    parsed: true
  };
}
// 这一步难不难
function stepNeed(S, st) {
  let need = DIFFS[st.diff] !== undefined ? DIFFS[st.diff] : 20;
  if (st.attr === '体能') need += Math.max(0, S.player.age - 35) * 0.8;
  if (st.who && /seekMoney|meet|other|jobHunt/.test(st.type)) need += askMod(S, st.who);
  if (st.type === 'jobHunt' || /面试|谈判|见客户/.test(st.text || '')) need -= num(bagFx(S).formal);
  return Math.round(need);
}
function stepCheck(S, st, rng) {
  if (st.diff === '顺手') return null;
  const ck = rollCheck(S, st.attr || guessAttr(st.text), stepNeed(S, st), rng);
  S.stats.checks++; if (ck.success) S.stats.wins++;
  return ck;
}
// 三档能要到的钱
function moneyCeil(S) {
  const c = capMoney(S);
  return fdm(S).fiat ? c * 50 : S.freedom === '都市传奇' ? c * 2 : c;
}
// 找人借：看对方拿不拿得出
const LEND_K = [[/家里人|妈|爸|父|母|爷|奶|外公|外婆|哥|姐|叔|伯|姨|舅|姑/, 6], [/爱人|对象|老公|老婆|女朋友|男朋友|伴侣/, 4], [/朋友|同学|发小|兄弟|闺蜜/, 2], [/同事|室友|老板|领导|师傅/, 1]];
function lendCap(S, n) {
  const city = CITIES[S.city] || CITIES['新一线'];
  const tie = String((n && n.tie) || '');
  let k = 0.5;
  for (const [re, v] of LEND_K) if (re.test(tie)) { k = v; break; }
  if (partnerOf(S) && n && partnerOf(S).name === n.name) k = Math.max(k, 4);
  // 关系档定倍数；家里人、伴侣再宽一些
  const tier = relTier(n && n.rel);
  let cap = city.pay * TIER_LEND[tier] * (k >= 6 ? 1.5 : k >= 4 ? 1.3 : 1);
  if (tier >= 1 && k >= 6) cap = Math.max(cap, city.pay * 0.8);
  if (fdm(S).fiat) cap *= 5;
  return Math.round(cap / 100) * 100;
}
function findDebt(S, st) {
  const L = (S.debts || []).map((d, i) => ({ d, i })).filter(x => x.d.left > 0);
  if (!L.length) return null;
  const who = st.who ? whoIs(S, st.who) : '';
  const hit = L.find(x => who && (x.d.who === who || x.d.who.indexOf(who) >= 0 || who.indexOf(x.d.who) >= 0));
  if (hit) return hit;
  if (num(st.amount) > 0) return L.slice().sort((a, b) => Math.abs(a.d.left - st.amount) - Math.abs(b.d.left - st.amount))[0];
  return L.length === 1 ? L[0] : null;
}
function bizKindOf(st) {
  if (BIZ_KINDS[st.kind]) return st.kind;
  const t = (st.kind || '') + (st.name || '') + (st.text || '');
  if (/公司/.test(t)) return '小公司';
  if (/店|馆|铺|摊|档|吧|坊/.test(t)) return '小店';
  return '工作室';
}
// 逐步执行。返回每一步的结果；钱、工作、债、店在这里就落账
function runSteps(S, plan, rng) {
  rng = rng || Math.random;
  const out = [];
  let long = 0;
  const fiat = !!fdm(S).fiat;
  for (const st of (plan.steps || [])) {
    const r = { type: st.type, text: st.text, ok: false, note: '', ck: null };
    const p = S.player;
    switch (st.type) {
      case 'quit': {
        const q = quitJob(S);
        if (q) { r.ok = true; r.note = q.text; } else r.note = '本来就没有工作';
        break;
      }
      case 'repay': {
        const hit = findDebt(S, st);
        if (!hit) {
          // 没有欠条，那就是还人情钱：照花钱算
          const amt = Math.round(num(st.amount));
          if (amt > 0 && p.money >= amt) { p.money -= amt; acct(S, '还人情', -amt, st.who || ''); r.ok = true; r.note = `给了${st.who || '对方'}${amt}元，账上剩${p.money}`; }
          else r.note = amt > 0 ? `要${amt}元，手头只有${p.money}` : '账上查不到欠谁的钱';
          break;
        }
        const want = num(st.amount) > 0 ? Math.min(num(st.amount), hit.d.left) : hit.d.left;
        const pr = payDebt(S, hit.i, want);
        if (!pr) { r.note = `欠${hit.d.who}${hit.d.left}元，手头只有${p.money}，一分都拿不出`; break; }
        r.ok = true;
        r.note = `还了${pr.who}${pr.pay}元${pr.left ? `，还欠${pr.left}` : '，清了'}；账上剩${p.money}`;
        if (pr.pay < want) r.note += `（想还${want}，钱不够）`;
        break;
      }
      case 'startBiz': {
        if (S.biz && !S.biz.dead) { r.note = `手上已经有「${S.biz.name}」了`; break; }
        const kind = bizKindOf(st);
        const ob = openBiz(S, { kind, name: st.name || (st.text || '').replace(/^开(个|一家|一间)?/, '').slice(0, 14) || kind }, rng);
        if (!ob.ok) { r.note = ob.why; break; }
        r.ok = true; r.ck = ob.ck;
        r.note = `${kind}「${S.biz.name}」开起来了，本钱${ob.need}，账上剩${p.money}${ob.ck.success ? '' : '；开头不太顺，口碑起手低'}`;
        break;
      }
      case 'closeBiz': {
        if (!S.biz || S.biz.dead) { r.note = '手上没有生意'; break; }
        const cb = closeBiz(S);
        r.ok = true; r.note = `「${cb.name}」关了，开了${cb.months}个月，一共${cb.total >= 0 ? '赚' : '亏'}${Math.abs(cb.total)}`;
        break;
      }
      case 'spend': {
        const amt = Math.round(num(st.amount));
        if (amt <= 0) { r.ok = true; r.note = '花了点小钱'; break; }
        if (p.money < amt) { r.note = `要${amt}元，手头只有${p.money}`; break; }
        p.money -= amt; acct(S, '花销', -amt, st.text || '');
        r.ok = true; r.note = `花了${amt}元，账上剩${p.money}`;
        break;
      }
      case 'seekMoney': {
        r.ck = fiat ? null : stepCheck(S, st, rng);
        if (r.ck && !r.ck.success) { r.note = '没要到'; break; }
        const want = Math.round(num(st.amount)) || Math.round(capMoney(S) * 0.3);
        let ceil = moneyCeil(S);
        const n = st.who ? S.npcs.find(x => x.name === whoIs(S, st.who)) : null;
        if (n && st.borrow) ceil = Math.min(ceil, lendCap(S, n));
        const got = Math.min(want, ceil);
        if (st.borrow) addDebt(S, n ? n.name : (st.who || '某人'), got, num(st.days) || 60);
        else { p.money += got; acct(S, '进账', got, st.text || ''); }
        r.ok = true;
        r.note = `${st.borrow ? '借到' : '拿到'}${got}元${got < want ? `（要的是${want}，引擎只认${got}）` : ''}${st.borrow ? `，${num(st.days) || 60}天内要还` : ''}；账上${p.money}`;
        break;
      }
      case 'jobHunt': {
        r.ck = stepCheck(S, st, rng);
        if (r.ck && !r.ck.success) { r.note = '递出去的没回音'; break; }
        const inD = rnd(rng, 2, 5), dt = addDays(S.date, inD);
        const title = `${st.target || '一家单位'}的面试`.slice(0, 30);
        S.appts.push({ y: dt.y, m: dt.m, d: dt.d, title, kind: '面试', done: false });
        r.ok = true; r.note = `约上了${dt.m}月${dt.d}日${title}`;
        break;
      }
      case 'meet': {
        r.ck = stepCheck(S, st, rng);
        r.ok = !r.ck || r.ck.success;
        if (st.who && !S.npcs.some(x => x.name === whoIs(S, st.who)) && String(st.who).length <= 6) {
          addNpcs(S, [{ name: st.who, tie: '', note: '', rel: 30 }], 1);
          r.newNpc = st.who;
        }
        const n = st.who ? S.npcs.find(x => x.name === whoIs(S, st.who)) : null;
        if (n) { n.lastSeen = S.stats.days; r.who = n.name; }
        r.note = r.ok ? (n ? `见到了${n.name}` : '人见到了') : (st.who ? `${st.who}那边没接住` : '没见成');
        break;
      }
      case 'loan': {
        const kind = LOANS[st.kind] ? st.kind : (S.biz && !S.biz.dead && /店|生意|经营/.test(st.text) ? '经营贷' : loanQuote(S, '信用贷').ok ? '信用贷' : '消费贷');
        const want = Math.round(num(st.amount)) || loanQuote(S, kind).cap;
        const tl = takeLoan(S, kind, want, num(st.term) || 0);
        r.ok = tl.ok; r.note = tl.ok ? tl.note : `去银行办${kind}，没批：${tl.why}`;
        break;
      }
      case 'deposit': {
        const t = DEPO[num(st.term)] ? num(st.term) : /三年/.test(st.text) ? 36 : /三个月|季/.test(st.text) ? 3 : 12;
        const dp = deposit(S, num(st.amount) || Math.floor(p.money * 0.5), t);
        r.ok = dp.ok; r.note = dp.ok ? dp.note : dp.why;
        break;
      }
      case 'invest': {
        const k = /货币|余额|零钱/.test(st.kind + st.text) ? '货币基金' : /理财/.test(st.kind + st.text) && !/股|基金/.test(st.text) ? '银行理财' : '股票基金';
        const iv = invest(S, k, num(st.amount) || Math.floor(p.money * 0.3), rng);
        r.ok = iv.ok; r.note = iv.ok ? iv.note : iv.why;
        break;
      }
      case 'focus':
      case 'rest': {
        const days = clamp(Math.round(num(st.days) || num(plan.days) || 10), 3, 120);
        if (S.focus) { r.note = `手头「${S.focus.what}」还没做完`; break; }
        const heal = st.type === 'rest';
        const what = (st.text || '').slice(0, 30);
        S.focus = { what, days, left: days, progress: 0, attr: heal ? '体能' : (st.attr || guessAttr(what)), heal,
          ideal: !heal && /理想|作品|写|做|练|学|产品|店/.test(what) ? 1 : 0, need: 55 + days * 1.1 };
        long = days;
        r.ok = true; r.note = `接下来${days}天${heal ? '先养身体' : '闷头做这件事'}，做完引擎再结算`;
        break;
      }
      default: {
        r.ck = stepCheck(S, st, rng);
        r.ok = !r.ck || r.ck.success;
      }
    }
    out.push(r);
  }
  // 玩家说的长时间、但没说是闷头做什么的：照投入算
  if (!long && num(plan.days) >= 3 && !S.focus && out.length) {
    const days = clamp(num(plan.days), 3, 120);
    const what = (plan.steps[0].text || '').slice(0, 30);
    S.focus = { what, days, left: days, progress: 0, attr: plan.steps[0].attr || guessAttr(what), heal: false,
      ideal: /理想|作品|写|做|练|学|产品|店/.test(what) ? 1 : 0, need: 55 + days * 1.1 };
    long = days;
  }
  if (plan.stopWhen) addStopWhen(S, plan.stopWhen, rng);
  return { results: out, long };
}

/* ---------- 手机上的钱：转账、红包 ---------- */
// 所有收付都挂在 S.pays 里，聊天记录只存编号
function payList(S) { if (!S.pays) S.pays = []; return S.pays; }
function newPay(S, o) {
  S.payId = num(S.payId) + 1;
  const p = Object.assign({ id: S.payId, date: shortDate(S.date), day: S.stats.days, note: '' }, o);
  payList(S).push(p);
  S.pays = S.pays.slice(-300);
  return p;
}
function findPay(S, id) { return payList(S).find(p => p.id === id) || null; }
// 别人给你：拿得出多少
function giftCap(S, n) { return Math.max(100, Math.round(lendCap(S, n) * 0.5 / 100) * 100); }
function npcByName(S, name) { return S.npcs.find(x => x.name === whoIs(S, name)) || null; }
// 给钱换关系：看钱占月薪多少，红包多一点，一次最多 6，同一个人一天只算第一笔
function giftRel(S, n, amount, kind) {
  if (!n || n.giftDay === S.stats.days) return 0;
  const city = CITIES[S.city] || CITIES['新一线'];
  const g = clamp(Math.round(amount / city.pay * (kind === '红包' ? 14 : 10)), 1, 6);
  n.rel = clamp(r2(n.rel + g), 0, 100);
  n.giftDay = S.stats.days;
  return g;
}
// 主角给某人转账 / 发红包
function payOut(S, name, amount, kind, note) {
  amount = Math.round(num(amount));
  kind = kind === '红包' ? '红包' : '转账';
  const n = npcByName(S, name);
  const who = n ? n.name : String(name || '').slice(0, 12);
  if (amount <= 0) return { ok: false, why: '金额不对' };
  if (S.player.money < amount) return { ok: false, why: `账上只有${S.player.money}` };
  if (kind === '红包' && amount > 20000) return { ok: false, why: '红包一次最多两万' };
  S.player.money -= amount;
  let debt = '';
  let toDebt = 0;
  if (kind === '转账') {
    const i = (S.debts || []).findIndex(d => d.who === who && d.left > 0);
    if (i >= 0) {
      const d = S.debts[i];
      toDebt = Math.min(amount, d.left);
      d.left -= toDebt;
      if (d.left <= 0) { d.late = false; easeRift(S, who, 60); if (n) n.rel = clamp(n.rel + 6, 0, 100); }
      debt = d.left > 0 ? `算还债，还欠${d.left}` : '欠条清了';
    }
  }
  if (toDebt) acct(S, '还债', -toDebt, who);
  if (amount - toDebt > 0) acct(S, kind === '红包' ? `给${who}发红包` : `转账给${who}`, -(amount - toDebt), String(note || '').slice(0, 20));
  const gain = toDebt >= amount ? 0 : giftRel(S, n, amount - toDebt, kind);
  if (n) { npcMem(S, n, `主角${kind === '红包' ? '发了红包' : '转了'}${amount}元${note ? '（' + String(note).slice(0, 16) + '）' : ''}${debt ? '，' + debt : ''}`); n.lastSeen = S.stats.days; }
  const p = newPay(S, { from: '我', to: who, kind, amount, note: String(note || '').slice(0, 30), state: '已付', toDebt, gain });
  return { ok: true, pay: p, debt, gain };
}
// 对方把主角给的钱推回来（还债那部分不退）
function payBack(S, id) {
  const p = findPay(S, id);
  if (!p || p.from !== '我' || p.state !== '已付') return null;
  const back = p.amount - num(p.toDebt);
  if (back <= 0) return null;
  S.player.money += back;
  acct(S, `${p.to}退回`, back, p.kind);
  const n = npcByName(S, p.to);
  if (n && p.gain) n.rel = clamp(r2(n.rel - p.gain), 0, 100);
  p.state = '退回';
  return p;
}
// 别人给主角：先挂着，点了才入账
function payIn(S, name, amount, kind, note, src) {
  const n = npcByName(S, name);
  const who = n ? n.name : String(name || '').slice(0, 12);
  amount = Math.round(num(amount));
  if (amount <= 0 || !who) return null;
  let cap = n ? giftCap(S, n) : 500;
  // 同一个人当天给的合计不超过他的额度
  const today = payList(S).filter(p => p.from === who && p.day === S.stats.days && p.state !== '退还').reduce((a, p) => a + p.amount, 0);
  cap = Math.max(0, cap - today);
  // 一段故事里从消息进来的钱也有总数
  if (src === 'msg') {
    S.flags.payInSeg = S.flags.payInSeg && S.flags.payInSeg.seg === S.seg ? S.flags.payInSeg : { seg: S.seg, sum: 0 };
    cap = Math.min(cap, Math.max(0, Math.round(capMoney(S) * 0.5) - S.flags.payInSeg.sum));
  }
  const got = Math.min(amount, cap);
  if (got <= 0) return null;
  if (src === 'msg') S.flags.payInSeg.sum += got;
  return newPay(S, { from: who, to: '我', kind: kind === '红包' ? '红包' : '转账', amount: got, asked: amount, note: String(note || '').slice(0, 30), state: '待收' });
}
function claimPay(S, id, take) {
  const p = findPay(S, id);
  if (!p || p.to !== '我' || p.state !== '待收') return null;
  const n = npcByName(S, p.from);
  if (take && p.loan) {
    addDebt(S, p.from, p.amount, 90);
    p.state = '已收';
    if (n) npcMem(S, n, `主角手头紧，借给他${p.amount}元，说好不急着还`);
    return p;
  }
  if (take) {
    S.player.money += p.amount;
    acct(S, `收到${p.from}的${p.kind}`, p.amount, p.note);
    p.state = '已收';
    if (n) npcMem(S, n, `给主角${p.kind === '红包' ? '发了红包' : '转了'}${p.amount}元，主角收了`);
  } else {
    p.state = '退还';
    if (n) { n.rel = clamp(r2(n.rel - (p.kind === '红包' ? 1 : 0.5)), 0, 100); npcMem(S, n, `给主角的${p.amount}元${p.kind}被退回来了`); }
  }
  return p;
}
// 过年：关系过得去的家里人发个红包
const KIN_RE = /家里人|妈|爸|父|母|爷|奶|外公|外婆|叔|伯|姨|舅|姑/;
function newYearPackets(S) {
  const org = ORIGINS[S.origin] || ORIGINS['普通家庭'];
  const base = org.money >= 30000 ? 2000 : org.money >= 8000 ? 800 : 300;
  const out = [];
  for (const n of S.npcs) {
    if (!KIN_RE.test(String(n.tie || '') + n.name)) continue;
    if (num(n.rel) < 25) { S.msgs.push({ from: n.name, text: '过年也不说寄点钱回来', date: shortDate(S.date), kind: 'chat', read: false }); continue; }
    if (num(n.rel) < 40) continue;
    const p = payIn(S, n.name, Math.round(base * (num(n.rel) >= 80 ? 2 : num(n.rel) >= 60 ? 1.4 : 1)), '红包', '过年了', 'year');
    if (!p) continue;
    S.msgs.push({ from: n.name, text: '过年了 拿着', date: shortDate(S.date), kind: 'chat', read: false, payId: p.id });
    out.push(p);
  }
  return out;
}

/* ---------- 群 ---------- */
function groupList(S) { if (!S.groups) S.groups = []; return S.groups; }
function makeGroup(S, members, name) {
  const ms = [...new Set((members || []).map(m => whoIs(S, m)).filter(m => S.npcs.some(n => n.name === m)))].slice(0, 8);
  if (ms.length < 2) return null;
  S.groupId = num(S.groupId) + 1;
  const g = { id: 'g' + S.groupId, name: String(name || '').trim().slice(0, 14) || ms.slice(0, 3).join('、') + (ms.length > 3 ? '…' : ''), members: ms, msgs: [], gist: '', since: shortDate(S.date) };
  groupList(S).push(g);
  return g;
}
// 拼手气：每人至少 1 元，加起来正好是总数
function splitPacket(amount, k, rng) {
  rng = rng || Math.random;
  amount = Math.round(num(amount)); k = Math.max(1, Math.round(num(k)));
  if (amount < k) return null;
  const w = Array.from({ length: k }, () => 0.2 + rng());
  const sw = w.reduce((a, b) => a + b, 0);
  const out = w.map(x => 1 + Math.floor((amount - k) * x / sw));
  let rest = amount - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % k, rest--) out[i]++;
  return out;
}
function groupPacket(S, g, amount, note, rng) {
  amount = Math.round(num(amount));
  if (!g || amount <= 0) return { ok: false, why: '金额不对' };
  if (S.player.money < amount) return { ok: false, why: `账上只有${S.player.money}` };
  if (amount < g.members.length) return { ok: false, why: `${g.members.length}个人，至少得${g.members.length}块` };
  if (amount > 20000) return { ok: false, why: '红包一次最多两万' };
  const parts = splitPacket(amount, g.members.length, rng);
  S.player.money -= amount;
  acct(S, `在「${g.name}」发红包`, -amount, String(note || '').slice(0, 20));
  const got = g.members.map((m, i) => {
    const n = npcByName(S, m);
    let gain = 0;
    if (n && n.giftDay !== S.stats.days) { gain = clamp(Math.round(parts[i] / ((CITIES[S.city] || CITIES['新一线']).pay) * 14), 0, 2); n.rel = clamp(n.rel + gain, 0, 100); n.giftDay = S.stats.days; }
    return { who: m, amount: parts[i], gain };
  }).sort((a, b) => b.amount - a.amount);
  const p = newPay(S, { from: '我', to: g.name, group: g.id, kind: '红包', amount, note: String(note || '').slice(0, 30), state: '已抢完', split: got });
  return { ok: true, pay: p, split: got };
}

/* ---------- 自设的停下条件 ---------- */
function stopList(S) {
  if (!S.stopWhen) S.stopWhen = [];
  if (!Array.isArray(S.stopWhen)) S.stopWhen = [S.stopWhen];       // 老存档是单个对象
  return S.stopWhen;
}
function addStopWhen(S, w, rng) {
  w = sanitizeStop(w);
  if (!w) return null;
  rng = rng || Math.random;
  const L = stopList(S);
  if (w.type === 'days') { const dt = addDays(S.date, w.n); w = { type: 'date', y: dt.y, m: dt.m, d: dt.d, label: `${w.n}天后` }; }
  if (w.type === 'npc') { w.who = whoIs(S, w.who); w.at = S.stats.days + rnd(rng, 1, 6); }    // 对方哪天回话，挂上的时候就定了
  if (L.some(x => JSON.stringify(x) === JSON.stringify(w))) return null;
  L.push(w);
  S.stopWhen = L.slice(-4);
  return w;
}
function checkStopWhen(S) {
  const L = stopList(S);
  for (let i = 0; i < L.length; i++) {
    const w = L[i];
    let hit = null;
    if (w.type === 'money' && S.player.money >= w.n) hit = `存款到了${w.n}`;
    else if (w.type === 'date' && daysBetween(S.date, w) <= 0) hit = `${w.label || '约定的日子'}到了`;
    else if (w.type === 'npc' && S.stats.days >= num(w.at)) {
      hit = `${w.who}回话了`;
      const n = S.npcs.find(x => x.name === w.who);
      if (n) n.lastSeen = S.stats.days;
    }
    if (hit) { L.splice(i, 1); return { kind: '条件', detail: hit, who: w.who || null }; }
  }
  return null;
}

/* ---------- 答应过的事 ---------- */
function addPledge(S, pl) {
  if (!pl || !pl.who || !pl.what) return null;
  S.pledges = S.pledges || [];
  const who = whoIs(S, pl.who);
  if (S.pledges.some(x => !x.done && x.who === who && sameThing(x.what, pl.what)) || recentlyDone(S, pl.what)) return null;
  const due = num(pl.inDays) > 0 ? addDays(S.date, num(pl.inDays)) : null;
  const o = { who, what: String(pl.what).slice(0, 40), kind: PLEDGE_KINDS.includes(pl.kind) ? pl.kind : '主角答应', made: shortDate(S.date), due, done: false };
  S.pledges.push(o);
  S.pledges = S.pledges.filter(x => !x.done).slice(-20);
  return o;
}
function donePledge(S, what) {
  const t = String(what || '');
  const p = (S.pledges || []).find(x => !x.done && (x.what === t || (t.length >= 4 && (x.what.indexOf(t) >= 0 || t.indexOf(x.what) >= 0))));
  if (p) p.done = true;
  S.pledges = (S.pledges || []).filter(x => !x.done);
  return p || null;
}
function pledgeTick(S) {
  const ev = [];
  for (const p of (S.pledges || [])) {
    if (p.done || !p.due || daysBetween(S.date, p.due) >= 0) continue;     // 当天由停点去问，过了日子还没办才算失约
    p.done = true;
    if (p.kind === '主角答应') {
      ev.push({ t: '人情', s: `答应${p.who}的「${p.what}」到日子了，没办` });
      addRift(S, p.who, `答应的「${p.what}」没兑现`, '私怨', 15);
    } else if (p.kind === '对方答应') {
      ev.push({ t: '人情', s: `${p.who}答应的「${p.what}」，到日子也没动静` });
    }
  }
  S.pledges = (S.pledges || []).filter(x => !x.done);
  return { ev };
}

/* ---------- 到期的约定：去、改期、不去 ---------- */
function apptWho(S, ap) {
  const t = String(ap.title || '');
  const n = S.npcs.slice().sort((a, b) => b.name.length - a.name.length).find(x => x.name && t.indexOf(x.name) >= 0);
  return n ? n.name : '';
}
function findPromisePledge(S, pr) { return (S.pledges || []).find(x => !x.done && x.who === pr.who && x.what === pr.what) || null; }
function keepPromise(S, pr) {
  if (!pr) return null;
  noteDone(S, pr.what || pr.title);
  if (pr.type === 'pledge') { const p = findPromisePledge(S, pr); if (p) p.done = true; S.pledges = (S.pledges || []).filter(x => !x.done); }
  const n = pr.who ? S.npcs.find(x => x.name === pr.who) : null;
  if (n) n.lastSeen = S.stats.days;
  return pr;
}
function breakPromise(S, pr) {
  if (!pr) return null;
  noteDone(S, pr.what || pr.title);
  const n = pr.who ? S.npcs.find(x => x.name === pr.who) : null;
  const what = pr.what || pr.title;
  if (pr.type === 'pledge') {
    const p = findPromisePledge(S, pr); if (p) p.done = true;
    S.pledges = (S.pledges || []).filter(x => !x.done);
    if (n) addRift(S, n.name, `说好的「${String(what).slice(0, 16)}」没去`, '私怨', 20);
  }
  if (n) { n.rel = clamp(r2(n.rel - (pr.type === 'pledge' ? 5 : 3)), 0, 100); npcMem(S, n, `说好的「${String(what).slice(0, 20)}」，主角没去`); }
  S.history.push({ seg: S.seg, date: shortDate(S.date), summary: `爽约：${String(what).slice(0, 30)}` });
  return pr;
}
function delayPromise(S, pr, days) {
  days = clamp(Math.round(num(days)) || 1, 1, 60);
  if (!pr) return null;
  noteDone(S, pr.what || pr.title);
  const dt = addDays(S.date, days);
  const n = pr.who ? S.npcs.find(x => x.name === pr.who) : null;
  if (pr.type === 'pledge') {
    const p = findPromisePledge(S, pr);
    if (p) { p.due = dt; p.asked = false; }
  } else {
    S.appts.push({ y: dt.y, m: dt.m, d: dt.d, title: pr.title, kind: pr.kind || '', done: false });
  }
  if (n) { n.rel = clamp(r2(n.rel - 1), 0, 100); npcMem(S, n, `「${String(pr.what || pr.title).slice(0, 20)}」主角说改到${dt.m}月${dt.d}日`); }
  return dt;
}

/* ---------- 投入结算 ---------- */
function settleFocus(S, rng) {
  const f = S.focus;
  if (!f) return null;
  if (f.heal) {
    S.focus = null;
    const ck = rollCheck(S, '体能', Math.max(25, 62 - f.days * 1.2), rng || Math.random);
    const healed = [];
    const keep = [];
    for (const st of S.status) {
      if (ck.success || st.days <= f.days) healed.push(st.name); else { st.days = Math.max(1, st.days - Math.round(f.days * 0.7)); keep.push(st); }
    }
    S.status = keep;
    S.player.energy = clamp(S.player.energy + Math.round(f.days * 1.6), 0, energyCap(S));
    let eased = null;
    if (ck.success && f.days >= 14 && (S.chronic || []).length) {
      const c = S.chronic.reduce((a, b) => (num(a.eased) <= num(b.eased) ? a : b));
      c.eased = num(c.eased) + 1;
      eased = c.name;
    }
    return Object.assign({ what: f.what, days: f.days, heal: true, healed, eased }, ck);
  }
  const need = f.need || (60 + f.days * 1.2);
  const ck = rollCheck(S, f.attr, need - Math.min(40, f.progress * 0.8), rng || Math.random);
  S.focus = null;
  S.player.energy = clamp(S.player.energy - Math.round(f.days * 0.5 * fdm(S).cost), 0, 100);
  if (f.ideal) S.ideal.progress = r2(S.ideal.progress + f.progress * 0.5);
  return Object.assign({ what: f.what, days: f.days, progress: Math.round(f.progress) }, ck);
}

/* ---------- 模型返回值清洗 ---------- */
// 只管类型和长度，不管业务：数字一律有限数，布尔只认 true，字符串截长，数组截条数，不认识的字段扔掉
const T = {
  str: (v, n) => (v === null || v === undefined) ? '' : String(typeof v === 'object' ? '' : v).trim().slice(0, n || 200),
  num: (v, lo, hi) => clamp(num(v), lo === undefined ? -1e9 : lo, hi === undefined ? 1e9 : hi),
  bool: v => v === true,
  arr: (v, n) => Array.isArray(v) ? v.slice(0, n || 10) : [],
  obj: v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : null
};
function sanitizeTurn(d) {
  d = T.obj(d) || {};
  const o = {};
  if (d._partial === true) o._partial = true;
  if (d.narrative !== undefined) o.narrative = T.str(d.narrative, 6000);
  if (d.summary !== undefined) o.summary = T.str(d.summary, 60);
  if (d.ending !== undefined && d.ending !== null) o.ending = T.str(d.ending, 80);
  o.gameOver = T.bool(d.gameOver);
  if (d.npcMax !== undefined) o.npcMax = T.num(d.npcMax, 1, 6);
  const sc = T.obj(d.scene);
  if (sc) o.scene = { location: T.str(sc.location, 24) || undefined, unresolved: Array.isArray(sc.unresolved) ? T.arr(sc.unresolved, 5).map(x => T.str(x, 40)).filter(Boolean) : undefined };
  o.resolvedInfo = T.arr(d.resolvedInfo, 6).map(x => T.str(x, 40)).filter(Boolean);
  const pc = T.obj(d.playerChanges) || {};
  const P = {};
  const at = T.obj(pc.attributes);
  if (at) { P.attributes = {}; for (const k of ATTRS) P.attributes[k] = T.num(at[k], -100, 100); }
  for (const k of ['energy', 'money', '信誉', '人品', 'idealProgress']) P[k] = T.num(pc[k]);
  P.job = pc.job ? T.str(pc.job, 30) || null : null;
  P.salary = pc.salary === null || pc.salary === undefined ? null : T.num(pc.salary, 0, 1e7);
  P.statusAdd = T.arr(pc.statusAdd, 3).map(T.obj).filter(x => x && x.name).map(x => ({ name: T.str(x.name, 8), desc: T.str(x.desc, 40), days: T.num(x.days, 1, 120) }));
  P.statusRemove = T.arr(pc.statusRemove, 6).map(x => T.str(x, 8)).filter(Boolean);
  P.chronicAdd = T.arr(pc.chronicAdd, 2).map(T.obj).filter(x => x && x.name).map(x => ({ name: T.str(x.name, 10), desc: T.str(x.desc, 50) }));
  o.playerChanges = P;
  o.npcUpdates = T.arr(d.npcUpdates, 12).map(T.obj).filter(x => x && x.name).map(x => ({
    name: T.str(x.name, 12), rel: T.num(x.rel, -20, 20), tie: x.tie ? T.str(x.tie, 12) : null, note: x.note ? T.str(x.note, 50) : null,
    mem: x.mem ? T.str(x.mem, 60) : null, intimate: T.bool(x.intimate),
    fact: x.fact ? T.str(x.fact, 40) : null, job: x.job ? T.str(x.job, 20) : null, age: T.num(x.age, 0, 100), gender: T.str(x.gender, 2),
    pos: x.pos ? T.str(x.pos, 16) : null, lv: x.lv === undefined || x.lv === null || x.lv === '' ? null : T.num(x.lv, 0, 12), circle: x.circle === 'work' || x.circle === 'field' ? x.circle : null }));
  o.newNpcs = T.arr(d.newNpcs, 6).map(T.obj).filter(x => x && x.name).map(x => ({
    name: T.str(x.name, 12), age: T.num(x.age, 0, 100), gender: T.str(x.gender, 2), job: T.str(x.job, 20), intimate: T.bool(x.intimate),
    tie: T.str(x.tie, 12), care: T.str(x.care, 30), note: T.str(x.note, 50), rel: T.num(x.rel, 0, 100), close: T.bool(x.close),
    pos: x.pos ? T.str(x.pos, 16) : '', lv: x.lv === undefined || x.lv === null || x.lv === '' ? null : T.num(x.lv, 0, 12), circle: x.circle === 'work' || x.circle === 'field' ? x.circle : '' }));
  o.messages = T.arr(d.messages, 4).map(T.obj).filter(x => x && x.text).map(x => ({ from: T.str(x.from, 12), text: T.str(x.text, 120), pay: sanitizePay(x.pay) }));
  o.moments = T.arr(d.moments, 2).map(T.obj).filter(x => x && x.who && x.text).map(x => ({ who: T.str(x.who, 12), text: T.str(x.text, 80),
    cs: T.arr(x.cs, 2).map(T.obj).filter(c => c && c.who && c.text).map(c => ({ who: T.str(c.who, 12), to: T.str(c.to, 12), text: T.str(c.text, 60) })),
    likes: T.arr(x.likes, 6).map(v => T.str(v, 12)).filter(Boolean) }));
  o.appointments = T.arr(d.appointments, 3).map(T.obj).filter(x => x && x.title).map(x => ({ title: T.str(x.title, 30), inDays: T.num(x.inDays, 1, 120), kind: T.str(x.kind, 8) }));
  o.milestoneClaim = T.arr(d.milestoneClaim, 3).map(x => T.str(typeof x === 'object' && x ? x.title : x, 40)).filter(Boolean);
  o.together = typeof d.together === 'string' ? T.str(d.together, 12) : '';
  o.newRifts = T.arr(d.newRifts, 1).map(T.obj).filter(x => x && x.who).map(x => ({ who: T.str(x.who, 12), reason: T.str(x.reason, 40), kind: RIFT_KINDS[x.kind] ? x.kind : '私怨', heat: T.num(x.heat, 5, 60) }));
  o.riftEased = T.arr(d.riftEased, 3).map(x => T.str(typeof x === 'object' && x ? x.who : x, 12)).filter(Boolean);
  const nj = T.obj(d.newJob);
  o.newJob = nj && nj.employer ? { employer: T.str(nj.employer, 16), title: T.str(nj.title || nj.post, 10), salary: T.num(nj.salary, 0, 1e7), lv: T.num(nj.lv, 0, 10), probation: false } : null;
  o.options = T.arr(d.options, 4).map(x => T.str(x, 30)).filter(Boolean);
  o.nextStop = sanitizeStop(d.nextStop);
  o.pledges = T.arr(d.pledges, 2).map(T.obj).filter(x => x && x.who && x.what).map(x => ({
    who: T.str(x.who, 12), what: T.str(x.what, 40), kind: PLEDGE_KINDS.includes(x.kind) ? x.kind : '主角答应', inDays: T.num(x.inDays, 0, 365) }));
  o.pledgeDone = T.arr(d.pledgeDone, 4).map(x => T.str(typeof x === 'object' && x ? x.what : x, 40)).filter(Boolean);
  return o;
}
// 停下条件：存款到数 / 到某天 / 等某人回话
function sanitizeStop(v) {
  const o = T.obj(v);
  if (!o) return null;
  if (o.type === 'money' && num(o.n) > 0) return { type: 'money', n: Math.round(T.num(o.n, 1, 1e9)) };
  if (o.type === 'days' && num(o.n) > 0) return { type: 'days', n: Math.round(T.num(o.n, 1, 365)) };
  if (o.type === 'npc' && o.who) return { type: 'npc', who: T.str(o.who, 12) };
  return null;
}
function sanitizePay(v) {
  const o = T.obj(v);
  if (!o || !(num(o.amount) > 0)) return null;
  return { kind: o.kind === '红包' ? '红包' : '转账', amount: Math.round(T.num(o.amount, 1, 1e7)), note: T.str(o.note, 30) };
}
function sanitizeGroup(d, members) {
  d = T.obj(d) || {};
  const ok = new Set(members || []);
  return {
    replies: T.arr(d.replies, 3).map(T.obj).filter(x => x && x.who && x.text && ok.has(String(x.who).trim())).map(x => ({ who: T.str(x.who, 12), text: T.str(x.text, 200) })),
    gist: T.str(d.gist, 80), summary: T.str(d.summary, 30),
    deal: T.arr(d.deal, 2).map(T.obj).filter(x => x && x.what && x.who && ok.has(String(x.who).trim())).map(x => ({ who: T.str(x.who, 12), kind: PLEDGE_KINDS.includes(x.kind) ? x.kind : '主角答应', what: T.str(x.what, 40), inDays: T.num(x.inDays, 0, 365) }))
  };
}
function sanitizeConvo(d) {
  d = T.obj(d) || {};
  const a = T.obj(d.ask);
  return {
    replies: (Array.isArray(d.reply) ? d.reply : [d.reply]).map(x => T.str(x, 160)).filter(Boolean).slice(0, 3),
    quick: T.arr(d.quick, 3).map(x => T.str(x, 20)).filter(Boolean),
    reply: (Array.isArray(d.reply) ? d.reply.map(x => T.str(x, 160)).filter(Boolean).join(' ') : T.str(d.reply, 300)) || '……', mood: T.str(d.mood, 6), rel: T.num(d.rel, -3, 3),
    gist: T.str(d.gist, 80), cold: T.bool(d.cold) || T.bool(d.end),
    pay: sanitizePay(d.pay), refund: T.bool(d.refund),
    deal: T.arr(d.deal, 2).map(T.obj).filter(x => x && x.what).map(x => ({ kind: PLEDGE_KINDS.includes(x.kind) ? x.kind : '主角答应', what: T.str(x.what, 40), inDays: T.num(x.inDays, 0, 365) })),
    ask: a && a.what ? { what: T.str(a.what, 40), kind: ASK_KINDS.includes(a.kind) ? a.kind : (num(a.money) > 0 ? 'borrow' : 'favor'),
      attr: ATTRS.includes(a.attr) ? a.attr : '表达', need: T.num(a.need, 20, 90) || 60, money: T.num(a.money, 0, 1e9), days: T.num(a.days, 0, 720) } : null,
    end: T.bool(d.end), summary: T.str(d.summary, 30)
  };
}
const ASK_KINDS = ['borrow', 'interview', 'intro', 'favor'];
const PLEDGE_KINDS = ['主角答应', '对方答应', '主角拒绝'];

/* ---------- 吃 LLM 返回的 JSON ---------- */
// 一段里能改多少，引擎说了算
function capMoney(S) {
  const inc = num(S.ledger.salary) + (S.biz && !S.biz.dead ? Math.max(0, num(S.biz.rev)) : 0);
  return Math.max(12000, Math.round(inc * 2.5 + Math.abs(S.player.money) * 0.35));
}
function applyTurn(S, d) {
  d = sanitizeTurn(d);
  const p = S.player;
  const pc = d.playerChanges || {};
  const cut = [];   // 被截下来的，下一段要告诉模型
  const cap = (label, v, lim) => {
    const n = num(v);
    if (Math.abs(n) <= lim) return n;
    cut.push(`${label}你写了${n}，引擎只认${n > 0 ? lim : -lim}`);
    return n > 0 ? lim : -lim;
  };
  if (pc.attributes) for (const k of ATTRS) if (num(pc.attributes[k])) {
    p.attrF[k] = r2(clamp(num(p.attrF[k]) + cap(k, pc.attributes[k], 2.5), 0, 100));
    p.attrs[k] = Math.round(p.attrF[k]);
  }
  if (num(pc.energy)) p.energy = clamp(p.energy + cap('精力', pc.energy, 35), 0, energyCap(S));
  if (num(pc.money)) { const mv = cap('零碎进出的钱', pc.money, Math.round(capMoney(S) * 0.3)); p.money += mv; acct(S, mv > 0 ? '额外进账' : '额外花销', mv, d.summary || ''); }   // 大钱走行动结算，叙事里只认零碎
  if (num(pc.信誉)) p.信誉 = clamp(p.信誉 + cap('行业口碑', pc.信誉, 8), 0, 100);
  if (num(pc.人品)) p.人品 = clamp(p.人品 + cap('做人', pc.人品, 8), 0, 100);
  if (num(pc.idealProgress)) S.ideal.progress = r2(S.ideal.progress + cap('理想的功夫', pc.idealProgress, 35));
  // 工资、饭碗只走引擎：考核、谈加薪、招聘；剧情里新找的工作只在失业时才认
  if (d.newJob && d.newJob.employer && S.job.out) { const tj = takeJob(S, d.newJob); if (tj.note) cut.push(tj.note); }

  for (const st of (pc.statusAdd || [])) {
    if (!st || !st.name) continue;
    const name = String(st.name).slice(0, 8);
    if (S.status.some(x => x.name === name)) continue;
    S.status.push({ name, desc: String(st.desc || '').slice(0, 40), days: clamp(num(st.days) || 5, 1, 120) });
    noteAil(S, name);
  }
  // 病好了：只认快好了的（还剩三天以内），别的照引擎的日子养
  for (const nm of (pc.statusRemove || [])) S.status = S.status.filter(x => x.name !== nm || num(x.days) > 3);
  for (const c of (pc.chronicAdd || [])) if (c && c.name && !S.chronic.some(x => x.name === c.name))
    S.chronic.push({ name: String(c.name).slice(0, 10), desc: String(c.desc || '').slice(0, 50) });

  addNpcs(S, d.newNpcs, d.npcMax || 2);

  const memo = {};
  for (const u of (d.npcUpdates || [])) {
    const n = S.npcs.find(x => x.name === whoIs(S, u.name));
    if (!n) continue;
    if (num(u.rel)) n.rel = clamp(r2(n.rel + num(u.rel)), 0, 100);
    if (u.tie) n.tie = String(u.tie).slice(0, 12);
    if (u.note && !n.note) n.note = String(u.note).slice(0, 50);      // 一句话的人设只补不改，免得写着写着变了个人
    // 身份只补空着的：年龄、干什么的、性别一旦有了就不许模型改
    if (u.job && !n.job) n.job = u.job;
    if (num(u.age) && !num(n.age)) { n.age = Math.round(num(u.age)); n.ageY = S.date.y; }
    if ((u.gender === '男' || u.gender === '女') && !n.gender) n.gender = u.gender;
    if (u.fact) addFact(n, u.fact);
    if (u.pos || u.circle || u.lv != null) setNpcPos(S, n, u, false);
    if (u.mem) { npcMem(S, n, u.mem); memo[n.name] = 1; n.lastSeen = S.stats.days; }
    if (u.intimate === true) { markIntimate(S, n); n.lastSeen = S.stats.days; }
  }
  // 剧情里点到名、模型又没给他记一笔的，引擎替他记下这一段是怎么回事——不然过两天他就忘了
  if (d.narrative && (d.summary || d._partial)) for (const n of S.npcs) {
    if (memo[n.name] || !n.name || String(d.narrative).indexOf(n.name) < 0) continue;
    npcMem(S, n, `${d.summary || String(d.narrative).replace(/\s+/g, '').slice(0, 24)}${S.lastAction ? `（那回主角在：${String(S.lastAction).slice(0, 20)}）` : ''}`);
  }
  // 剧情里两人说开、确定在一起了：记成伴侣（还没有伴侣时）
  if (d.together && !partnerOf(S)) {
    const who = whoIs(S, String(d.together).slice(0, 12));
    const n = S.npcs.find(x => x.name === who);
    if (n && !(num(n.age) && num(n.age) < 18)) startRomance(S, n.name, '在一起');
  }
  for (const r of (d.newRifts || []).slice(0, 1)) {
    if (r && r.who) addRift(S, r.who, r.reason, r.kind, num(r.heat) || 22);
  }
  for (const e of (d.riftEased || [])) easeRift(S, typeof e === 'string' ? e : e.who, 35);

  for (const mo of (d.moments || []).slice(0, 2)) {
    if (!mo || !mo.who || !mo.text) continue;
    const m = addMoment(S, whoIs(S, mo.who), mo.text, 'npc');
    if (!m) continue;
    const known = w => w === S.player.name || S.npcs.some(n => n.name === w);
    for (const c of (mo.cs || [])) { const w = whoIs(S, c.who); if (w !== S.player.name && known(w)) commentMoment(S, m.id, w, c.text, c.to && known(whoIs(S, c.to)) ? whoIs(S, c.to) : ''); }
    for (const l of (mo.likes || [])) addLiker(S, m, l);
  }


  for (const m of (d.messages || []).slice(0, 4)) {
    if (!m || !m.text) continue;
    const who = whoIs(S, String(m.from || '某人').slice(0, 12));
    const msg = { from: who, text: String(m.text).slice(0, 120), date: shortDate(S.date), kind: 'chat', read: false };
    if (m.pay && m.pay.amount > 0) {
      const py = payIn(S, who, m.pay.amount, m.pay.kind, m.pay.note || m.text, 'msg');
      if (py) { msg.payId = py.id; if (py.amount < py.asked) cut.push(`${who}的${py.kind}你写了${py.asked}，引擎只认${py.amount}`); }
    }
    S.msgs.push(msg);
    const nn = S.npcs.find(x => x.name === who);
    if (nn) nn.lastSeen = S.stats.days;
  }
  S.msgs = S.msgs.slice(-240);

  for (const a of (d.appointments || []).slice(0, 3)) {
    if (!a || !a.title) continue;
    // 已经约着的、刚办掉的同一件事，不再挂一遍（不然天天弹提醒）
    if (S.appts.some(x => !x.done && sameThing(x.title, a.title)) || recentlyDone(S, a.title)) continue;
    if ((S.pledges || []).some(p => !p.done && p.due && sameThing(p.what, a.title))) continue;
    const inD = clamp(num(a.inDays) || 3, 1, 120);
    const dt = addDays(S.date, inD);
    S.appts.push({ y: dt.y, m: dt.m, d: dt.d, title: String(a.title).slice(0, 30), kind: String(a.kind || '').slice(0, 8), done: false });
  }
  S.appts = S.appts.filter(a => !a.done && daysBetween(S.date, a) >= 0).slice(-12);

  if (d.scene) {
    S.place = String(d.scene.location || S.place).slice(0, 24);
    if (Array.isArray(d.scene.unresolved)) S.unresolved = d.scene.unresolved.map(x => String(x).slice(0, 40)).slice(0, 5);
  }
  for (const r of (d.resolvedInfo || [])) S.unresolved = S.unresolved.filter(u => u !== r);

  if (d.summary) {
    S.history.push({ seg: S.seg, date: shortDate(S.date), summary: String(d.summary).slice(0, 40), act: S.lastAction ? String(S.lastAction).slice(0, 40) : '' });
    S.history = S.history.slice(-120);
  }
  if (d.narrative) {
    S.recent.push({ seg: S.seg, action: S.lastAction || '', narrative: d.narrative });
    S.recent = S.recent.slice(-8);
  }
  // 答应的事、拒绝的事
  for (const pl of d.pledges) addPledge(S, pl);
  for (const w of d.pledgeDone) donePledge(S, w);
  if (d.nextStop) addStopWhen(S, d.nextStop);
  if (d.gameOver === true) { S.over = true; S.ending = d.ending || '此局终了'; }
  S.capNote = cut.length ? cut.slice(0, 3).join('；') : null;
  return S;
}

/* ---------- 一场聊天的结算 ---------- */
// 模型常把发件人写成「妈妈」「房东」这种称呼，这里对回通讯录里那个人的真名
const WHO_KEY = { '妈': '妈妈', '妈妈': '妈妈', '老妈': '妈妈', '母亲': '妈妈', '母子': '妈妈', '母女': '妈妈', '妈妈（家里人）': '妈妈',
  '爸': '爸爸', '爸爸': '爸爸', '老爸': '爸爸', '父亲': '爸爸', '父子': '爸爸', '父女': '爸爸', '雇主': '老板', '老板': '老板', '领导': '老板', '同期': '同学' };
const whoKey = t => { t = String(t || '').trim(); return WHO_KEY[t] || t; };
function whoIs(S, who) {
  who = String(who || '').trim();
  if (!who || S.npcs.some(n => n.name === who)) return who;
  // 「周德胜（房东）」「房东周德胜」这种：括号去掉、名字包在里面的，都认回通讯录里那个人
  const base = who.replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, '').trim();
  if (base && base !== who && S.npcs.some(n => n.name === base)) return base;
  const TITLE = /^(房东|老板|领导|同事|室友|邻居|阿姨|叔叔|大姐|大哥|姐|哥|老师|师傅|总|经理|主管|HR|hr|同学|表姐|表哥|医生|中介)$/;
  const inside = S.npcs.filter(n => n.name && n.name.length >= 2 && who.indexOf(n.name) >= 0 && TITLE.test(base.replace(n.name, '')))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (inside) return inside.name;
  const k = whoKey(base || who);
  const hit = S.npcs.filter(n => whoKey(n.tie) === k || whoKey(n.name) === k
    || (n.tie === '家里人' && (k === '妈妈' || k === '爸爸') && whoKey(n.name) === k));
  if (hit.length) return hit.sort((a, b) => b.rel - a.rel)[0].name;
  return who;
}
// 老存档：已经收到的消息和朋友圈，发件人对回真名
function fixWho(S) {
  // 通讯录里「周德胜（房东）」和「周德胜」两条：并成一个，记忆合在一起
  for (const n of S.npcs.slice()) {
    const base = String(n.name).replace(/[（(][^）)]*[）)]/g, '').trim();
    const keep = base && base !== n.name && S.npcs.find(x => x !== n && x.name === base);
    if (!keep) continue;
    keep.mem = (keep.mem || []).concat(n.mem || []).slice(-16);
    keep.rel = Math.max(num(keep.rel), num(n.rel));
    S.npcs.splice(S.npcs.indexOf(n), 1);
  }
  for (const m of (S.msgs || [])) m.from = whoIs(S, m.from);
  for (const m of (S.moments || [])) if (m.who) m.who = whoIs(S, m.who);
}
// 跟谁发生过关系：只记成年人，记第一次、最近一次和次数
function markIntimate(S, n) {
  if (!n || (num(n.age) && num(n.age) < 18)) return;
  const d = shortDate(S.date);
  if (!n.intimate) n.intimate = { first: d, firstY: S.date.y, times: 0 };
  if (n.intimate.lastDay === S.stats.days) return;
  n.intimate.times++; n.intimate.last = d; n.intimate.lastDay = S.stats.days;
}
function lovers(S) { return S.npcs.filter(n => n.intimate).sort((a, b) => (b.intimate.lastDay || 0) - (a.intimate.lastDay || 0)); }
// 人物记事：带日子，留最近 16 条
function npcMem(S, n, text) {
  const line = `${shortDate(S.date)} ${String(text).replace(/\s+/g, '').slice(0, 60)}`;
  n.mem = n.mem || [];
  const last = n.mem[n.mem.length - 1] || '';
  if (last.slice(last.indexOf(' ') + 1) === line.slice(line.indexOf(' ') + 1)) return;
  n.mem = n.mem.concat([line]).slice(-16);
}
function applyConvo(S, name, res) {
  const n = S.npcs.find(x => x.name === name);
  if (!n) return;
  if (num(res.rel)) n.rel = clamp(r2(n.rel + num(res.rel)), 0, 100);
  n.lastSeen = S.stats.days;
  if (res.mem) npcMem(S, n, `聊过：${res.mem}`);
  if (res.note) n.note = String(res.note).slice(0, 50);
}






/* ================= 家：住处、伴侣、孩子 ================= */
function housePrice(S) {
  const city = CITIES[S.city] || CITIES['新一线'];
  return Math.round(city.shop * 290 / 10000) * 10000;        // 一套普通两居，按房租倒推
}
function canBuy(S) {
  const price = housePrice(S);
  const down = Math.round(price * 0.32);
  const loan = price - down;
  const monthly = Math.round(loan * 0.0052);                  // 三十年，粗算
  return { price, down, loan, monthly, ok: S.player.money >= down };
}
function buyHouse(S, rng) {
  const b = canBuy(S);
  if (!b.ok) return { ok: false, why: `首付要 ${b.down}，你手头 ${S.player.money}` };
  if (bankOf(S).credit < 45) return { ok: false, why: `征信${creditWord(bankOf(S).credit)}，房贷批不下来` };
  const ck = rollCheck(S, '谋划', 48, rng || Math.random);
  const cut = ck.success ? Math.round(b.price * 0.03) : 0;    // 砍下来一点
  S.player.money -= (b.down - cut);
  acct(S, '买房首付', -(b.down - cut));
  S.home = {
    kind: '买', since: shortDate(S.date), price: b.price - cut,
    loan: { left: b.loan, monthly: b.monthly, months: 360, paid: 0 }
  };
  S.ledger.rent = 0;
  S.ledger.loan = b.monthly;
  return { ok: true, price: b.price - cut, down: b.down - cut, monthly: b.monthly, cut, ck };
}
function homeTick(S) {
  // 月供跟着房租一起在 1 号扣，在 moneyTick 里算
  const H = S.home;
  if (!H || H.kind !== '买' || !H.loan) return;
  H.loan.left = Math.max(0, H.loan.left - Math.round(H.loan.monthly * 0.42));   // 本金部分
  H.loan.paid++;
  if (H.loan.left <= 0) { S.ledger.loan = 0; H.loan.done = true; }
}
function homeWorth(S) {
  const H = S.home;
  if (!H || H.kind !== '买') return 0;
  return Math.max(0, num(H.price) - (H.loan && !H.loan.done ? num(H.loan.left) : 0));
}

/* ---- 伴侣 ---- */
function partnerOf(S) { return S.family && S.family.partner && !S.family.partner.over ? S.family.partner : null; }
function startRomance(S, name, stage) {
  S.family = S.family || { partner: null, kids: [], past: [] };
  const n = S.npcs.find(x => x.name === name);
  S.family.partner = {
    name, since: shortDate(S.date), sinceDay: S.stats.days,
    stage: stage || '在一起', warm: Math.max(55, n ? n.rel : 55), over: false
  };
  if (n) { n.close = true; n.tie = stage === '结婚' ? '爱人' : '对象'; }
  return S.family.partner;
}
function marry(S, cost) {
  const P = partnerOf(S);
  if (!P) return null;
  P.stage = '结婚';
  P.marriedAt = shortDate(S.date);
  S.player.money -= num(cost);
  acct(S, '办婚事', -num(cost));
  const n = S.npcs.find(x => x.name === P.name);
  if (n) { n.tie = '爱人'; n.rel = clamp(n.rel + 10, 0, 100); }
  return P;
}
function breakUp(S, why) {
  const P = partnerOf(S);
  if (!P) return null;
  P.over = true; P.endedAt = shortDate(S.date); P.why = String(why || '过不下去了').slice(0, 30);
  const wasMarried = P.stage === '结婚';
  S.family.past = (S.family.past || []).concat([P]).slice(-4);
  const n = S.npcs.find(x => x.name === P.name);
  if (n) { n.tie = wasMarried ? (S.player.gender === '女' ? '前夫' : '前妻') : '前任'; n.rel = clamp(n.rel - 30, 0, 100); }
  if (wasMarried) {
    // 分一半家当
    const half = Math.round(S.player.money * 0.42);
    S.player.money -= Math.max(0, half);
    acct(S, '离婚分家当', -Math.max(0, half));
    S.family.partner = null;
    return { wasMarried, half };
  }
  S.family.partner = null;
  return { wasMarried, half: 0 };
}
function wantKid(S, rng) {
  const P = partnerOf(S);
  if (!P || P.stage !== '结婚') return { ok: false, why: '这事得两个人，而且得先成家' };
  if ((S.family.kids || []).some(k => k.unborn)) return { ok: false, why: '已经在等了' };
  const ck = rollCheck(S, '体能', 46 + (S.player.age - 26) * 1.5, rng || Math.random);
  if (!ck.success) return { ok: false, why: '这回没成', ck };
  S.family.kids = (S.family.kids || []).concat([{ unborn: true, dueDay: S.stats.days + 270, name: '', age: 0 }]);
  return { ok: true, ck };
}
const KID_MING = ['念','安','一','小满','年年','知','麦','屿','禾','早早','团团','多多','星','沐','昀'];
function familyTick(S, rng) {
  const ev = [];
  let stop = null;
  S.family = S.family || { partner: null, kids: [], past: [] };
  const P = partnerOf(S);

  // 孩子出生
  for (const k of (S.family.kids || [])) {
    if (k.unborn && S.stats.days >= k.dueDay) {
      k.unborn = false;
      k.name = (S.player.name || '').slice(0, 1) + pick(rng, KID_MING);
      k.bornY = S.date.y; k.born = shortDate(S.date); k.age = 0;
      ev.push({ t: '家里', s: `孩子出生了，叫${k.name}` });
      stop = { kind: '家里', detail: `孩子生下来了，${k.name}` };
    }
  }
  // 过日子的热乎气
  if (P) {
    const days = S.stats.days;
    if (days % 7 === 0) {
      const tended = S.flags.homeDays || 0;
      P.warm = clamp(P.warm + (tended >= 2 ? 2.5 : tended >= 1 ? 0.5 : -2.2) - ((S.biz && !S.biz.dead) || S.focus ? 0.6 : 0), 0, 100);
      S.flags.homeDays = 0;
      if (P.warm <= 18 && rng() < 0.25) {
        stop = { kind: '家里', detail: `跟${P.name}到了要说清楚的时候（这阵子几乎没在一起过）` };
        P.warned = (P.warned || 0) + 1;
        if (P.warned >= 3 && rng() < 0.5) {
          const r = breakUp(S, '各过各的太久了');
          stop = { kind: '家里', detail: `跟${P.name}${r.wasMarried ? '离了，家当分走一半' : '分了'}` };
        }
      }
    }
  }
  return { ev, stop };
}
function kidCost(S) {
  const city = CITIES[S.city] || CITIES['新一线'];
  let c = 0;
  for (const k of (S.family.kids || [])) {
    if (k.unborn) continue;
    c += Math.round(city.living * (k.age < 3 ? 0.5 : k.age < 6 ? 0.42 : k.age < 18 ? 0.62 : 0));
  }
  return c;
}
function kidsGrow(S) {
  for (const k of (S.family.kids || [])) if (!k.unborn) k.age++;
}
function kidStage(k) {
  if (k.unborn) return '还没出生';
  if (k.age < 1) return '刚出生';
  if (k.age < 3) return '会走了';
  if (k.age < 6) return '上幼儿园';
  if (k.age < 12) return '小学';
  if (k.age < 15) return '初中';
  if (k.age < 18) return '高中';
  return '大了，自己过';
}

/* ================= 结局 ================= */
function scoreLines(S) {
  const p = S.player;
  const total = S.ideal.stages.reduce((a, st) => a + st.milestones.length, 0) || 1;
  const done = S.ideal.stages.reduce((a, st) => a + st.milestones.filter(m => m.done).length, 0);
  const wealth = p.money + homeWorth(S) + (S.biz && !S.biz.dead ? Math.max(0, S.biz.total) : 0);
  const city = CITIES[S.city] || CITIES['新一线'];
  const P = partnerOf(S);
  const kids = (S.family && S.family.kids || []).filter(k => !k.unborn).length;
  return {
    志业: clamp(Math.round(done / total * 78 + Math.min(22, S.ideal.progress / 200)), 0, 100),
    财务: clamp(Math.round(wealth / (city.living * 220) * 100), 0, 100),
    关系: clamp(Math.round(S.npcs.filter(n => n.rel >= 55).length * 9 + (P ? (P.stage === '结婚' ? 26 : 14) : 0) + kids * 9 + (S.rifts || []).filter(r => !r.done).length * -6), 0, 100),
    身心: clamp(Math.round(p.energy * 0.6 + (100 - chronicLoad(S) * 22) * 0.4), 0, 100)
  };
}
function endReason(S) {
  const p = S.player;
  if (p.age >= (S.retireAge || 60)) return { why: '到了岁数', text: `${p.age}岁，该收了` };
  if ((S.chronic || []).length >= 4) return { why: '身体垮了', text: '一身的毛病，跑不动了' };
  if (p.money < -50000 && S.job.out && !(S.biz && !S.biz.dead)) return { why: '撑不住了', text: '没活干、没进项，窟窿越来越大' };
  return null;
}
function endingScore(S) {
  const L = scoreLines(S);
  const avg = Math.round((L.志业 + L.财务 + L.关系 + L.身心) / 4);
  const top = Object.keys(L).sort((a, b) => L[b] - L[a])[0];
  const low = Object.keys(L).sort((a, b) => L[a] - L[b])[0];
  return { lines: L, avg, top, low };
}
// 结局之后还想过下去
function keepGoing(S, years) {
  S.over = false;
  S.retireAge = (S.retireAge || 60) + (num(years) || 10);
  S.endedOnce = (S.endedOnce || []).concat([{ at: shortDate(S.date), age: S.player.age }]).slice(-4);
  return S.retireAge;
}

/* ================= 自立门户 ================= */
const BIZ_KINDS = {
  '小店':   { setupX: 80,  rentX: 1.6, baseX: 1.35, attr: '谋划', cap: 3, desc: '铺面、货、一个帮手，开门就要钱' },
  '工作室': { setupX: 40,  rentX: 0.8, baseX: 1.05, attr: '专业', cap: 4, desc: '几个人一间屋，靠手艺接活' },
  '小公司': { setupX: 140, rentX: 2.4, baseX: 1.7, attr: '谋划', cap: 5, desc: '要养人、要签合同、要交社保' }
};
const XING = '王李张刘陈杨黄周吴徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹彭'.split('');
const MING = ['杰','磊','敏','静','强','洋','艳','勇','军','丽','涛','明','超','秀','霞','平','刚','桂','文','辉','力','薇','娟','浩','鹏','宇','晨','菲','然','宁','川','舟','野','可','真','越','岚','昭','池','屿'];
function madeName(rng, used) {
  for (let i = 0; i < 40; i++) {
    const n = pick(rng, XING) + pick(rng, MING) + (rng() < 0.35 ? pick(rng, MING) : '');
    if (!used.includes(n)) return n;
  }
  return pick(rng, XING) + pick(rng, MING);
}
const BIZ_REV = 1;   // 总系数，留着以后整体调；各类店的差别在 BIZ_KINDS.baseX
function bizBase(S) {
  const city = CITIES[S.city] || CITIES['新一线'];
  const K = BIZ_KINDS[S.biz ? S.biz.kind : '工作室'];
  // 营业额按城市的铺面贵贱校准：本钱是照房租算的，营业额也得跟着房租走，不然一线城市开店永远回不了本
  const cityK = Math.pow((city.shop / city.pay) / (1700 / 4800), 0.45);
  return Math.round(city.pay * K.baseX * BIZ_REV * cityK);
}
function bizSetup(S, kind) {
  const city = CITIES[S.city] || CITIES['新一线'];
  return Math.round(city.shop * BIZ_KINDS[kind].setupX);
}
function openBiz(S, o, rng) {
  rng = rng || Math.random;
  const kind = BIZ_KINDS[o.kind] ? o.kind : '工作室';
  const K = BIZ_KINDS[kind];
  const need = bizSetup(S, kind);
  if (S.player.money < need) return { ok: false, why: `启动得要 ${need} 元，你手头只有 ${S.player.money}` };
  const ck = rollCheck(S, K.attr, 46 + (kind === '小公司' ? 12 : kind === '小店' ? 4 : 0), rng);
  const city = CITIES[S.city] || CITIES['新一线'];
  S.player.money -= need;
  acct(S, '开店本钱', -need, o.name || '');
  S.biz = {
    name: String(o.name || '没名字的店').slice(0, 14), kind,
    since: shortDate(S.date), sinceY: S.date.y,
    rent: Math.round(city.shop * K.rentX), staff: [],
    rep: ck.success ? 42 : 30, tend: 0, months: 0,
    rev: 0, cost: 0, net: 0, lossMonths: 0, best: 0, total: 0, dead: false, setup: need
  };
  if (S.job && !S.job.out) quitJob(S);
  S.player.job = `自己的${kind}「${S.biz.name}」`;
  return { ok: true, need, ck, rep: S.biz.rep };
}
function bizCandidates(S, rng) {
  const used = S.npcs.map(n => n.name).concat((S.biz.staff || []).map(s => s.name));
  const city = CITIES[S.city] || CITIES['新一线'];
  return [0, 1, 2].map(() => {
    const skill = rnd(rng, 22, 78);
    return {
      name: madeName(rng, used),
      role: pick(rng, ['帮手', '师傅', '跑单的', '做事的', '管账的']),
      skill,
      pay: Math.round(city.pay * (0.45 + skill / 140) / 100) * 100,
      loyal: rnd(rng, 45, 70)
    };
  });
}
function hireBiz(S, c) {
  const B = S.biz;
  if (!B || B.dead) return null;
  if (B.staff.length >= BIZ_KINDS[B.kind].cap) return { ok: false, why: '地方就这么大，塞不下人了' };
  B.staff.push(Object.assign({ months: 0 }, c));
  return { ok: true, who: c.name };
}
function fireBiz(S, i) {
  const B = S.biz;
  const s = B && B.staff[i];
  if (!s) return null;
  const pay = s.pay;          // 遣散
  S.player.money -= pay;
  acct(S, '遣散', -pay, s.name);
  B.staff.splice(i, 1);
  B.rep = clamp(B.rep - 3, 0, 100);
  return { who: s.name, pay };
}
function raiseBiz(S, i, up) {
  const s = S.biz && S.biz.staff[i];
  if (!s) return null;
  s.pay = Math.max(0, Math.round(s.pay + num(up)));
  s.loyal = clamp(s.loyal + (num(up) > 0 ? 14 : -18), 0, 100);
  return s;
}
// 有生意的时候，日程里的「主业」就是照看自己的摊子
function bizTend(S, plan) {
  const B = S.biz;
  if (!B || B.dead) return;
  let w = 0;
  for (const it of plan) if (it.act === '主业') w += (it.slot === '晚上' || it.slot === '深夜') ? 1.3 : 1;
  if (w) B.tend = r2(B.tend + w);
}
function bizMonth(S, rng) {
  const B = S.biz;
  if (!B || B.dead) return null;
  B.months++;
  const K = BIZ_KINDS[B.kind];
  const skill = B.staff.reduce((a, s) => a + s.skill, 0);
  const tendK = clamp(0.55 + B.tend / 60, 0.55, 1.35);          // 自己盯得越紧越好
  const mine = S.player.attrs['专业'] * 1.1;                     // 自己的本事也算一份
  const rev = Math.round(bizBase(S) * (0.45 + B.rep / 110) * (1 + (skill + mine) / 230) * tendK * windMul(S) * num(fdm(S).bizEase) * (0.85 + rng() * 0.3));
  const pay = B.staff.reduce((a, s) => a + s.pay, 0);
  const cost = B.rent + pay;
  const net = rev - cost;
  const m0 = S.player.money;
  S.player.money += net;
  acct(S, '店里营业额', rev, B.name, m0);
  if (B.rent) acct(S, '店面租金', -B.rent, B.name, m0);
  if (pay) acct(S, '店员工资', -pay, B.staff.map(s => s.name).join('、'), m0);
  B.rev = rev; B.cost = cost; B.net = net; B.lastTend = r2(B.tend); B.total += net; B.best = Math.max(B.best, net);
  B.tend = 0;

  // 口碑：人手够不够、自己在不在
  const load = rev / Math.max(1, (B.staff.length + 1) * bizBase(S) * 0.75);
  if (load > 1.2) B.rep = clamp(B.rep - 3, 0, 100);              // 接得下但做不好，口碑就掉
  else if (tendK > 0.9) B.rep = clamp(B.rep + 3 + (S.player.attrs['专业'] > 50 ? 1 : 0) + (skill > 100 ? 1 : 0), 0, 100);
  else B.rep = clamp(B.rep + 0.5, 0, 100);

  // 人心
  const gone = [];
  for (const s of B.staff) {
    s.months++;
    const fair = s.pay >= Math.round((CITIES[S.city] || CITIES['新一线']).pay * (0.45 + s.skill / 140)) ? 6 : -9;
    s.loyal = clamp(s.loyal + fair + (tendK > 1 ? 2 : -3) + (net < 0 ? -4 : 1), 0, 100);
    s.skill = clamp(s.skill + (tendK > 1 ? 0.6 : 0.2), 0, 100);
    if (s.loyal < 22 && rng() < 0.45) gone.push(s.name);
  }
  if (gone.length) { B.staff = B.staff.filter(s => gone.indexOf(s.name) < 0); B.rep = clamp(B.rep - 2, 0, 100); }

  B.lossMonths = net < 0 ? B.lossMonths + 1 : 0;
  const out = { rev, cost, net, rep: Math.round(B.rep), gone, lossMonths: B.lossMonths };
  // 开头亏几个月是常事，钱还够就不算危；钱不够了才叫危
  if (B.lossMonths >= 5 || (B.lossMonths >= 3 && S.player.money < cost * 3) || S.player.money < -Math.abs(cost)) out.danger = true;
  return out;
}
function closeBiz(S) {
  const B = S.biz;
  if (!B || B.dead) return null;
  const back = Math.round(B.setup * 0.3);
  const sever = B.staff.reduce((a, s) => a + s.pay, 0);
  const m0 = S.player.money;
  S.player.money += back - sever;
  acct(S, '关店回收', back, B.name, m0);
  if (sever) acct(S, '遣散', -sever, B.name, m0);
  const out = { name: B.name, months: B.months, total: B.total, back, sever, staff: B.staff.map(s => s.name) };
  for (const s of B.staff) if (rng0() < 0.3) addRift(S, s.name, '店关了，欠他一个交代', '私怨', 18);
  B.dead = true; B.closedAt = shortDate(S.date);
  S.bizPast = (S.bizPast || []).concat([out]).slice(-3);
  S.biz = null;
  S.player.job = '待业';
  S.job.out = true; S.ledger.salary = 0;
  return out;
}
function rng0() { return Math.random(); }

/* ================= 行业风向与时代 ================= */
const WIND = { '热': 1.26, '平': 1.0, '冷': 0.76 };
function windMul(S) { return WIND[(S.wind && S.wind.mood) || '平'] || 1; }
const ERA = {
  '创作': ['平台改了分成规矩', '一批人靠短内容火了', '出版社在砍选题', '有人拿AI写的东西冒名投稿'],
  '创业': ['钱不好拿了', '一个赛道突然被追着投', '监管出了新口径', '大厂下场做同样的事'],
  '手艺': ['房租又涨了一茬', '街上新开了三家同行', '一条街被划进改造范围', '有博主把这行拍火了'],
  '职场': ['行业在裁员', '公司换了新老板', '内部开始查考勤', '同行在高价挖人'],
  '科研': ['经费批得慢了', '一篇同方向的文章先发了', '评审标准变了', '有企业来谈合作'],
  '表演': ['小剧场一个接一个关', '有个综艺在海选', '票务平台改了抽成', '一个前辈退圈了'],
  '教书': ['政策又调了', '家长群里在传新说法', '有机构跑路了', '学校在招编外'],
  '公益': ['资助方换了方向', '一条相关新闻上了热搜', '登记手续变严', '有人捐了一笔'],
  '把家过好': ['房价动了', '菜价涨得离谱', '老家那边在拆迁', '医保报销比例改了'],
  '从政': ['上面来了巡视组', '单位换了一把手', '考录政策变了', '一项改革要落地'],
  '体育': ['联赛改了赛制', '有赞助商撤了', '一个老将退役了', '全运会选拔开始了'],
  '捞偏门': ['上面在严打', '道上一个大哥进去了', '有人反水了', '片区新来的所长不好说话'],
  '行医': ['集采又砍了一轮价', '医院在查回扣', '规培政策变了', '一起医闹上了新闻'],
  '法律': ['律所在裁员', '一部新法要施行', '一个大案开庭了', '法援的案子多了'],
  '做博主': ['平台改了推荐', '一批账号被封了', '带货被查税', '一个同行一夜爆了'],
  '投资': ['大盘跌了一个月', '降息了', '一家公司暴雷上了新闻', '有人靠一只票翻了身'],
  '回乡': ['补贴政策下来了', '旱了一个夏天', '电商进了村', '村里的地被人盯上了']
};
function windTick(S, rng) {
  const ev = [];
  let stop = null;
  S.wind = S.wind || { mood: '平', left: rnd(rng, 90, 210) };
  S.wind.left--;
  if (S.wind.left <= 0) {
    const r = rng();
    const mood = r < 0.28 ? '热' : r < 0.68 ? '平' : '冷';
    const changed = mood !== S.wind.mood;
    S.wind = { mood, left: rnd(rng, 120, 260) };
    if (changed) {
      ev.push({ t: '机会', s: `${S.player.track}这行眼下${mood === '热' ? '正热' : mood === '冷' ? '在过冬' : '不温不火'}` });
      stop = { kind: '风向', detail: `${S.player.track}这行${mood === '热' ? '忽然热起来了' : mood === '冷' ? '开始过冬了' : '慢慢平下来了'}` };
    }
  }
  // 时代的事，隔一阵来一件
  S.eraLeft = num(S.eraLeft) || rnd(rng, 70, 140);
  S.eraLeft--;
  if (S.eraLeft <= 0) {
    S.eraLeft = rnd(rng, 90, 170);
    const pool = ERA[S.player.track] || ERA['职场'];
    const one = pick(rng, pool);
    S.era = (S.era || []).concat([{ text: one, date: shortDate(S.date) }]).slice(-4);
    ev.push({ t: '机会', s: one });
    stop = { kind: '时代', detail: one };
  }
  return { ev, stop };
}

/* ================= 一年过去了 ================= */
function yearSnap(S) {
  const p = S.player;
  return {
    y: S.date.y, money: p.money, salary: S.ledger.salary,
    attrs: Object.assign({}, p.attrs), 信誉: p.信誉, 人品: p.人品,
    energy: p.energy, job: p.job, age: p.age,
    miles: S.ideal.stages.reduce((a, st) => a + st.milestones.filter(m => m.done).length, 0),
    npcs: S.npcs.length, close: S.npcs.filter(n => n.rel >= 55).length,
    chronic: (S.chronic || []).map(c => c.name),
    rifts: (S.rifts || []).filter(r => !r.done).length,
    biz: S.biz ? { name: S.biz.name, net: S.biz.net, rep: Math.round(S.biz.rep), staff: S.biz.staff.length } : null,
    ideal: Math.round(S.ideal.progress)
  };
}
function yearDiff(S) {
  const now = yearSnap(S);
  const last = (S.years || []).length ? S.years[S.years.length - 1].snap : null;
  if (!last) return { now, up: null };
  const up = {
    money: now.money - last.money, salary: now.salary - last.salary,
    attrs: ATTRS.reduce((o, k) => (o[k] = now.attrs[k] - last.attrs[k], o), {}),
    miles: now.miles - last.miles, close: now.close - last.close, ideal: now.ideal - last.ideal
  };
  return { now, up };
}

/* ================= 朋友圈 ================= */
// 朋友圈里给的好脸色换关系：每人每天合计最多 2
function momentRel(S, n, amt) {
  if (!n) return 0;
  if (n.momDay !== S.stats.days) { n.momDay = S.stats.days; n.momGain = 0; }
  const g = clamp(num(amt), -3, Math.max(0, 2 - num(n.momGain)));
  if (g > 0) n.momGain = num(n.momGain) + g;
  n.rel = clamp(r2(n.rel + g), 0, 100);
  return g;
}
function addLiker(S, m, who) {
  if (!m) return;
  m.likers = m.likers || [];
  const w = whoIs(S, who);
  if (!w || w === m.who || m.likers.includes(w) || !S.npcs.some(n => n.name === w)) return;
  m.likers.push(w);
  m.likes = num(m.likes) + 1;
}
function addMoment(S, who, text, kind) {
  S.moments = S.moments || [];
  const t = String(text || '').slice(0, 140);
  if (!t) return null;
  const m = {
    id: 'm' + (S.momentId = num(S.momentId) + 1),
    who: String(who || '某人').slice(0, 12),
    text: t, kind: kind || 'npc',
    date: shortDate(S.date), day: S.stats.days, y: S.date.y,
    likes: rnd(Math.random, 0, kind === 'me' ? 0 : 4), likers: [], liked: false, cs: [], read: false
  };
  S.moments.push(m);
  S.moments = S.moments.slice(-60);
  return m;
}
function likeMoment(S, id) {
  const m = (S.moments || []).find(x => x.id === id);
  if (!m || m.liked) return null;
  m.liked = true; m.likes = num(m.likes) + 1;
  momentRel(S, S.npcs.find(x => x.name === m.who), 1);
  return m;
}
function commentMoment(S, id, who, text, to) {
  const m = (S.moments || []).find(x => x.id === id);
  if (!m || !text) return null;
  const c = { who: String(who).slice(0, 12), text: String(text).slice(0, 80), day: S.stats.days };
  if (to && to !== who) c.to = String(to).slice(0, 12);
  m.cs.push(c);
  m.cs = m.cs.slice(-14);
  return c;
}
function unreadMoments(S) { return (S.moments || []).filter(m => !m.read).length; }

/* ================= 梁子（结下的与找上门的） ================= */
const RIFT_KINDS = {
  '债主':   { rate: 1.15, word: '钱没还' },
  '前东家': { rate: 0.45, word: '走得不体面' },
  '竞对':   { rate: 0.6,  word: '抢一碗饭' },
  '私怨':   { rate: 0.7,  word: '得罪了人' },
  '甲方':   { rate: 0.85, word: '活没交代好' }
};
function addRift(S, who, reason, kind, heat) {
  S.rifts = S.rifts || [];
  who = String(who || '某人').slice(0, 12);
  const k = RIFT_KINDS[kind] ? kind : '私怨';
  const has = S.rifts.find(r => r.who === who && !r.done);
  if (has) {
    has.heat = clamp(has.heat + (num(heat) || 20), 0, 100);
    has.reason = String(reason || has.reason).slice(0, 40);
    return has;
  }
  const r = { who, reason: String(reason || RIFT_KINDS[k].word).slice(0, 40), kind: k,
    heat: clamp(num(heat) || 25, 0, 100), since: shortDate(S.date), done: false, came: 0 };
  S.rifts.push(r);
  S.rifts = S.rifts.slice(-8);
  return r;
}
function easeRift(S, who, amount) {
  const r = (S.rifts || []).find(x => x.who === who && !x.done);
  if (!r) return null;
  r.heat = clamp(r.heat - (num(amount) || 25), 0, 100);
  if (r.heat <= 8) { r.done = true; r.endedAt = shortDate(S.date); }
  return r;
}
function riftTick(S, rng) {
  const ev = [];
  let stop = null;
  for (const r of (S.rifts || [])) {
    if (r.done) continue;
    let rate = RIFT_KINDS[r.kind].rate * 0.55 * num(fdm(S).badMul);
    if (r.kind === '债主' && !(S.debts || []).some(d => d.who === r.who && d.left > 0)) rate = -0.8;  // 钱还上了自己会凉
    r.heat = clamp(r.heat + rate, 0, 100);
    if (r.heat <= 6) { r.done = true; r.endedAt = shortDate(S.date); ev.push({ t: '人情', s: `跟${r.who}那点事算过去了` }); }
  }
  // 同一个人不会隔三差五堵你，给他二十天的间隔
  const hot = (S.rifts || []).filter(r => !r.done && r.heat >= 62 && S.stats.days - num(r.lastCame) >= 20);
  if (hot.length && rng() < 0.035) {
    const r = pick(rng, hot);
    r.came++;
    r.lastCame = S.stats.days;
    r.heat = clamp(r.heat - 30, 0, 100);
    stop = { kind: '裂痕', detail: `${r.who}（${r.kind}）找上门来了：${r.reason}`, who: r.who, riftKind: r.kind };
  }
  return { ev, stop };
}

/* ================= 老毛病 ================= */
function ailCount(S, name) {
  S.ailLog = S.ailLog || {};
  return num(S.ailLog[name]);
}
// 同一个毛病犯到第三回，就落下病根了
function noteAil(S, name) {
  S.ailLog = S.ailLog || {};
  const n = (num(S.ailLog[name]) || 0) + 1;
  S.ailLog[name] = n;
  if (n >= 3 && !S.chronic.some(c => c.name === '老' + name)) {
    S.chronic.push({ name: ('老' + name).slice(0, 8), desc: `${name}犯过${n}回，落下了`, eased: 0 });
    return true;
  }
  return false;
}
function chronicLoad(S) {
  return (S.chronic || []).reduce((a, c) => a + Math.max(0, 1 - num(c.eased) * 0.34), 0);
}
function energyCap(S) { return Math.round(100 - chronicLoad(S) * 7 + Math.min(8, num(S.gym && S.gym.cap))); }

/* ================= 单位与饭碗 ================= */
const LEVELS = [
  { t: '实习', pay: 1.00 }, { t: '转正', pay: 1.28 }, { t: '熟手', pay: 1.65 },
  { t: '骨干', pay: 2.15 }, { t: '主管', pay: 2.95 }, { t: '负责人', pay: 4.10 },
  { t: '高层', pay: 5.6 }, { t: '顶层', pay: 7.5 }, { t: '顶层', pay: 10 }, { t: '顶层', pay: 13 }, { t: '顶层', pay: 17 }
];
function jobLv(S) { return LEVELS[clamp(num(S.job.lv), 0, LEVELS.length - 1)]; }
function nextReview(S) {
  const d = S.date;
  const qm = [3, 6, 9, 12].find(m => m > d.m || (m === d.m && d.d < 26));
  const y = qm ? d.y : d.y + 1;
  const m = qm || 3;
  return daysBetween(d, { y, m, d: 26 });
}
// 平时干的活攒成绩效
function jobTick(S, plan) {
  const J = S.job;
  if (!J || J.out) return;
  const p = S.player;
  let work = 0;
  for (const it of plan) if (it.act === '主业') work += (it.slot === '晚上' || it.slot === '深夜') ? 1.4 : 1;
  if (!work) return;
  J.perf = r2(J.perf + work * (0.5 + p.attrs['专业'] / 220) * (p.energy < 35 ? 0.6 : 1) * STRAIN_PERF[clamp(num(J.strain === undefined ? 1 : J.strain), 0, 3)]);
  J.days = (J.days || 0) + 1;
}
// 季度考核：升、涨、平、谈话、走人
function review(S, rng) {
  const J = S.job, p = S.player;
  if (!J || J.out) return null;
  const lv = clamp(num(J.lv), 0, jobMax(S));
  const score = num(J.perf) + p.attrs['专业'] * 0.8 + p.信誉 * 0.4 + rnd(rng, 0, 20) + (J.mood || 0);
  const need = 52 + Math.min(lv, 5) * 16 + Math.max(0, lv - 5) * 6;
  const high = lv >= 5;          // 再往上靠机会：够格了也只有一部分人能上去
  const f = fdm(S);
  J.perf = 0; J.quarters = (J.quarters || 0) + 1;
  const out = { score: Math.round(score), need, kind: '', text: '' };

  if (lv < jobMax(S) && (high ? score >= need * 1.12 && rng() < 0.4 + num(p.信誉) / 250 : score >= need * 1.35)) {
    J.lv = lv + 1;
    S.ledger.salary = Math.round(S.ledger.base * payMul(S, J.lv) * (0.95 + rng() * 0.15));
    J.title = jobTitle(S, J.lv);
    if (J.employer) S.player.job = `${J.employer}的${J.post || J.title}`;
    out.kind = '升职'; out.text = `提了${jobTitle(S, J.lv)}，月薪${S.ledger.salary}`;
  } else if (score >= need) {
    // 同一个级别上涨薪有顶：最多到这一级基准的一倍半；体制内涨得更慢
    const capS = Math.round(S.ledger.base * payMul(S, lv) * 1.5);
    const up = Math.max(0, Math.min(Math.round(S.ledger.salary * (jobLadder(S) === '从政' ? 0.01 + rng() * 0.015 : 0.04 + rng() * 0.06)), capS - S.ledger.salary));
    S.ledger.salary += up;
    out.kind = '涨薪'; out.text = `涨了${up}，月薪${S.ledger.salary}`;
  } else if (score >= need * 0.6) {
    out.kind = '原地'; out.text = '考核平平，什么都没动';
  } else if (score >= need * 0.4 || f.cost < 0.7) {
    J.mood = -8;
    out.kind = '约谈'; out.text = '被叫去谈话，说下个季度再看看';
  } else {
    J.out = true; J.was = J.employer; J.title = '待业'; S.ledger.salary = 0;
    out.kind = '裁员'; out.text = '这个季度轮到你，让你走人';
  }
  return out;
}
function quitJob(S) {
  const J = S.job;
  if (!J || J.out) return null;
  const perf0 = num(J.perf), mood0 = num(J.mood);     // 先记下走之前的样子，再清零
  J.out = true; J.was = J.employer; J.title = '待业'; J.perf = 0; J.mood = 0;
  S.ledger.salary = 0;
  S.player.信誉 = clamp(S.player.信誉 - 1, 0, 100);
  if (mood0 < 0 || perf0 < 12) addRift(S, J.was || '原来那家', '走的时候没处理干净', '前东家', 22);
  return { kind: '辞职', text: `从${J.was || '原来那家'}出来了，下个月起没有工资` };
}
// 新饭碗（LLM 报的）
// 新饭碗的月薪范围：城市行情 × 职级，心想事成放宽到三倍
function salaryRange(S, lv) {
  const city = CITIES[S.city] || CITIES['新一线'];
  const now = num(S.ledger.salary);
  const lo = Math.round(city.pay * 0.6);
  let hi = Math.max(Math.round(city.pay * payMul(S, lv) * 1.6), Math.round(now * 1.8));
  if (fdm(S).fiat) hi *= 3;
  return { lo, hi };
}
function takeJob(S, o) {
  const J = S.job;
  const fiat = !!fdm(S).fiat;
  const lv0 = J.out ? Math.max(0, num(J.lv) - 1) : num(J.lv);
  let lv = clamp(Math.round(num(o.lv)) || Math.max(1, num(J.lv)), 0, jobMax(S));
  let note = null;
  if (!fiat && lv > lv0 + 2) { note = `职级你写成${jobTitle(S, lv)}，引擎只认到${jobTitle(S, lv0 + 2)}`; lv = lv0 + 2; }
  const R = salaryRange(S, lv);
  let pay = num(o.salary) ? Math.round(num(o.salary)) : 0;
  if (pay && (pay > R.hi || pay < R.lo)) { const c = clamp(pay, R.lo, R.hi); note = (note ? note + '；' : '') + `新工作月薪你写成${pay}，引擎只认${c}`; pay = c; }
  J.out = false; J.sinceDay = S.stats.days;
  J.employer = String(o.employer || J.employer || '新东家').slice(0, 16);
  J.post = String(o.title || o.post || J.post || '').slice(0, 10);
  J.lv = lv;
  J.title = jobTitle(S, lv);
  J.probation = false;
  J.perf = 0; J.mood = 0; J.quarters = 0;
  S.ledger.base = Math.max(1000, pay ? Math.round(pay / payMul(S, lv)) : S.ledger.base);
  S.ledger.salary = pay || Math.round(S.ledger.base * payMul(S, lv));
  S.player.job = `${J.employer}的${J.post || J.title}`;
  return { kind: '新工作', text: `${J.employer}，${J.post || J.title}，月薪${S.ledger.salary}`, note };
}

/* ---------- 欠的钱 ---------- */
function addDebt(S, who, amount, days) {
  S.debts = S.debts || [];
  const due = addDays(S.date, Math.max(15, num(days) || 60));
  S.debts.push({ who: String(who || '某人').slice(0, 12), amount: Math.round(num(amount)), left: Math.round(num(amount)), due, late: false });
  S.player.money += Math.round(num(amount));
  acct(S, '借进来', Math.round(num(amount)), String(who || ''));
}
function debtTick(S) {
  const ev = [];
  let stop = null;
  for (const d of (S.debts || [])) {
    if (d.left <= 0) continue;
    if (daysBetween(S.date, d.due) > 0) continue;
    if (!d.late) {
      d.late = true;
      const n = S.npcs.find(x => x.name === d.who);
      if (n) n.rel = clamp(n.rel - 12, 0, 100);
      ev.push({ t: '钱', s: `欠${d.who}的${d.left}到期了` });
      addRift(S, d.who, `欠他${d.left}元没还`, '债主', 35);
      stop = { kind: '钱', detail: `欠${d.who}的${d.left}元到期了，还不上` };
    }
  }
  S.debts = (S.debts || []).filter(d => d.left > 0);
  return { ev, stop };
}
function payDebt(S, i, amount) {
  const d = (S.debts || [])[i];
  if (!d) return null;
  const pay = Math.min(Math.round(num(amount)), d.left, S.player.money);
  if (pay <= 0) return null;
  d.left -= pay;
  S.player.money -= pay;
  acct(S, '还债', -pay, d.who);
  if (d.left <= 0) {
    const n = S.npcs.find(x => x.name === d.who);
    if (n) n.rel = clamp(n.rel + 6, 0, 100);
    d.late = false;
    easeRift(S, d.who, 60);
  }
  return { who: d.who, pay, left: d.left };
}

/* ================= 理想阶梯 ================= */
const METRICS = {
  'money': { label: '存款', get: S => S.player.money, unit: '元' },
  '专业': { label: '看家本事', get: S => S.player.attrs['专业'], unit: '' },
  '表达': { label: '表达', get: S => S.player.attrs['表达'], unit: '' },
  '谋划': { label: '谋划', get: S => S.player.attrs['谋划'], unit: '' },
  '信誉': { label: '行业口碑', get: S => S.player.信誉, unit: '' },
  '投入': { label: '在这件事上攒的功夫', get: S => Math.round(S.ideal.progress), unit: '' }
};
const SCENES = ['面试', '提案', '谈判', '路演', '答辩', '演出', '摊牌', '调解', '借钱', '拉人入伙'];

// 模型给的硬指标常常离谱，按段位拉回合理区间
const NEED_BAND = {
  'money':  [[3000, 30000], [30000, 220000], [200000, 2000000]],
  '专业':   [[28, 46], [46, 66], [64, 90]],
  '表达':   [[28, 46], [46, 66], [64, 90]],
  '谋划':   [[28, 46], [46, 66], [64, 90]],
  '信誉':   [[20, 42], [42, 64], [62, 90]],
  '投入':   [[40, 160], [300, 900], [1500, 4500]]
};
function bandNeed(metric, stage, v) {
  const b = (NEED_BAND[metric] || NEED_BAND['投入'])[clamp(stage, 0, 2)];
  return clamp(Math.round(num(v) || b[0]), b[0], b[1]);
}
const SOCIAL_MILE = /人脉|认识.{0,8}(个|位|名)|结识.{0,6}(个|位|名)|交.{0,3}(个|位|名).{0,4}朋友|加.{0,6}(个|位)好友|圈子里.{0,4}(个|位)人/;
function isSocialMile(m) { return m && (m.metric === '人脉' || SOCIAL_MILE.test(String(m.title || '') + String(m.desc || ''))); }
function normLadder(raw) {
  const stages = [];
  let id = 0;
  for (const st of (raw || []).slice(0, 3)) {
    const ms = [];
    for (const m of (st.milestones || []).slice(0, 4)) {
      if (!m || !m.title) continue;
      if (isSocialMile(m)) continue;            // "认识多少个人"这种台阶不要
      const key = METRICS[m.metric] ? m.metric : '投入';
      ms.push({
        id: ++id,
        title: String(m.title).slice(0, 24),
        desc: String(m.desc || '').slice(0, 40),
        metric: key,
        need: bandNeed(key, stages.length, m.need),
        needRaw: num(m.need),
        scene: SCENES.includes(m.scene) ? m.scene : '谈判',
        gate: String(m.gate || '').slice(0, 24),
        done: false, doneDate: null
      });
    }
    if (ms.length) stages.push({ name: String(st.name || '').slice(0, 16), milestones: ms });
  }
  return stages;
}
function curMile(S) {
  const L = S.ideal;
  for (let i = 0; i < L.stages.length; i++) {
    const ms = L.stages[i].milestones;
    for (let j = 0; j < ms.length; j++) if (!ms[j].done) return { stage: i, idx: j, m: ms[j], stageName: L.stages[i].name };
  }
  return null;
}
function mileStat(S, m) {
  const M = METRICS[m.metric] || METRICS['投入'];
  const cur = M.get(S);
  return { label: M.label, unit: M.unit, cur, need: m.need, ok: cur >= m.need, pct: Math.min(100, Math.round(cur / m.need * 100)) };
}
function ladderBlock(S) {
  const c = curMile(S);
  if (!c) return '（还没立下阶梯）';
  const st = mileStat(S, c.m);
  const done = [];
  for (const s of S.ideal.stages) for (const m of s.milestones) if (m.done) done.push(m.title);
  return `第${c.stage + 1}段【${c.stageName}】，眼下这一步：${c.m.title}${c.m.desc ? `（${c.m.desc}）` : ''}
　硬指标：${st.label} ${st.cur}${st.unit} / ${st.need}${st.unit}${st.ok ? '　已经够了' : `　还差${st.need - st.cur}${st.unit}`}
　门槛：${c.m.gate || c.m.scene}（要打一场${c.m.scene}才算数）
${done.length ? `已经迈过的：${done.join('、')}` : '还没迈过任何一步'}`;
}
// LLM 只能申报，引擎说了算
function judgeClaim(S, claims) {
  const c = curMile(S);
  if (!c || !(claims || []).length) return null;
  const st = mileStat(S, c.m);
  if (!st.ok) return { ok: false, title: c.m.title, short: `${st.label}还差${st.need - st.cur}${st.unit}` };
  return { ok: true, title: c.m.title, scene: c.m.scene, gate: c.m.gate };
}

/* ================= 关键局 ================= */
const OPP_TYPES = {
  '务实': { guard: 62, patience: 70, interest: 22, desc: '只认硬东西，废话听不进去',
    mul: { '摆事实': 1.55, '讲故事': 0.55, '共情': 0.7, '施压': 0.9, '让步': 1.1, '亮底牌': 1.2 } },
  '好面子': { guard: 40, patience: 62, interest: 34, desc: '爱听好听的，也爱被人捧',
    mul: { '摆事实': 0.75, '讲故事': 1.35, '共情': 1.15, '施压': 0.7, '让步': 0.9, '亮底牌': 1.1 } },
  '老江湖': { guard: 72, patience: 80, interest: 20, desc: '什么场面没见过，套路对他没用',
    mul: { '摆事实': 1.15, '讲故事': 0.5, '共情': 0.35, '施压': 0.5, '让步': 1.25, '亮底牌': 1.5 } },
  '和稀泥': { guard: 48, patience: 92, interest: 28, desc: '不表态、不得罪人、能拖就拖',
    mul: { '摆事实': 0.9, '讲故事': 0.9, '共情': 1.1, '施压': 1.6, '让步': 1.0, '亮底牌': 1.15 } },
  '急性子': { guard: 44, patience: 48, interest: 34, desc: '没耐心，要你三句话说清楚',
    mul: { '摆事实': 1.3, '讲故事': 0.85, '共情': 0.8, '施压': 1.15, '让步': 1.05, '亮底牌': 1.35 } }
};
const MOVES = {
  '摆事实': { attr: '专业', cost: 6,  tip: '把做过的、算过的摊出来' },
  '讲故事': { attr: '表达', cost: 7,  tip: '讲你要做的事，讲得让人想看下去' },
  '共情':   { attr: '情绪', cost: 5,  tip: '先站到对方那边去' },
  '施压':   { attr: '谋划', cost: 11, tip: '抬价、给期限、点破他的处境' },
  '让步':   { attr: '谋划', cost: 4,  tip: '让出一块，换他往前走一步' },
  '亮底牌': { attr: '专业', cost: 12, tip: '一局只能用一次' },
  '稳一稳': { attr: '情绪', cost: 0,  tip: '喘口气，把底气找回来' },
  '改期':   { attr: '表达', cost: 0,  tip: '今天不谈了，留个话头' }
};

function startKey(S, o) {
  const t = OPP_TYPES[o.type] ? o.type : pick(o.rng || Math.random, Object.keys(OPP_TYPES));
  const T = OPP_TYPES[t];
  const BF = bagFx(S);
  const hard = clamp((num(o.hard) || 50) - num(fdm(S).keyEase) - (o.kind === 'mile' || o.kind === 'job' || o.kind === 'raise' ? originEase(S, o.kind) : 0) - (/面试|谈判/.test(o.scene || '') || o.kind === 'raise' || o.kind === 'job' ? num(BF.formal) : 0) - (o.kind === 'love' || o.kind === 'marry' ? num(BF.charm) : 0), 18, 95);
  S.key = {
    scene: o.scene || '谈判',
    stake: String(o.stake || '').slice(0, 40),
    mileId: o.mileId || null,
    kind: o.kind || 'mile',
    who: o.who || null, post: o.post || null,
    opp: { name: String(o.name || '对方').slice(0, 12), type: t, note: String(o.note || T.desc).slice(0, 40) },
    hard,
    guard: clamp(T.guard + (hard - 50) * 0.35, 10, 95),
    patience: clamp(T.patience - (hard - 50) * 0.2, 20, 100),
    interest: clamp(T.interest - (hard - 50) * 0.25, 5, 70),
    nerve: clamp(62 + S.player.attrs['情绪'] * 0.35 - (S.player.energy < 40 ? 15 : 0) - S.status.length * 4, 20, 100),
    round: 0, log: [], used: {}, lastMove: null, usedCard: false, over: false, result: null, cost: 0
  };
  return S.key;
}

function keyRound(S, move, rng) {
  rng = rng || Math.random;
  const K = S.key;
  if (!K || K.over) return null;
  const mv = MOVES[move];
  if (!mv) return null;
  if (move === '亮底牌' && K.usedCard) return { bad: '底牌已经亮过了' };
  K.round++;
  const T = OPP_TYPES[K.opp.type];
  let mul = (T.mul && T.mul[move]) || 1;
  // 同一套路使第二遍就不灵了
  K.used = K.used || {};
  const seen = K.used[move] || 0;
  mul *= seen === 0 ? 1 : seen === 1 ? 0.7 : 0.45;
  if (K.lastMove === move) mul *= 0.7;
  K.used[move] = seen + 1;
  K.lastMove = move;
  const roll = d20(rng);
  const val = attrVal(S, mv.attr);
  // 属性和门槛同尺度，骰子给浮动；压过多少折成 -12 到 +12 的力道
  let pw = clamp((val + rollMod(roll) - K.hard) / 4, -14, 14);
  pw = pw >= 0 ? pw * mul : pw / Math.max(0.5, mul);
  const d = { guard: 0, interest: 0, patience: 0, nerve: -mv.cost };
  let note = '';

  if (move === '摆事实') { d.guard = -(5 + pw * 0.9); d.interest = 3 + pw * 0.5; d.patience = -2; }
  else if (move === '讲故事') { d.interest = 6 + pw * 1.0; d.guard = -(1 + pw * 0.3); d.patience = -4; }
  else if (move === '共情') {
    d.patience = 6 + pw * 0.6; d.guard = -(3.5 + pw * 0.7); d.interest = 1;
    if (mul < 0.5 && pw < 0) { d.guard = 6; d.patience = 0; note = '这话他听过太多遍了'; }
  }
  else if (move === '施压') {
    if (pw >= 0) { d.interest = 9 + pw; d.guard = -(7 + pw * 0.8); d.patience = -7; note = '压住了'; }
    else { d.patience = pw * 1.6; d.guard = 9; d.interest = -4; note = '把人惹毛了'; }
  }
  else if (move === '让步') { d.guard = -(10 + pw * 0.4); d.interest = 7; d.patience = 5; K.cost += 1; note = '这一步是拿东西换的'; }
  else if (move === '亮底牌') { K.usedCard = true; d.interest = 16 + pw * 1.2; d.guard = -(13 + pw); d.patience = 3; }
  else if (move === '稳一稳') { d.nerve = 16; d.patience = -6; }
  else if (move === '改期') { K.over = true; K.result = '留口子'; d.guard = 8; }

  K.guard = clamp(K.guard + d.guard, 0, 100);
  K.interest = clamp(K.interest + d.interest, 0, 100);
  K.patience = clamp(K.patience + d.patience, 0, 100);
  K.nerve = clamp(K.nerve + d.nerve, 0, 100);

  // 对方回敬
  let oppMove = '压价';
  if (!K.over) {
    const or = d20(rng);
    const opw = Math.max(0, (K.hard + rollMod(or)) / 8);
    if (K.guard > 58) oppMove = '推'; else if (K.interest > 55) oppMove = '追问'; else if (K.patience < 40) oppMove = '看表'; else oppMove = '压价';
    if (oppMove === '推') K.nerve = clamp(K.nerve - (3 + opw * 0.5), 0, 100);
    else if (oppMove === '追问') { K.nerve = clamp(K.nerve - (1.5 + opw * 0.25), 0, 100); K.guard = clamp(K.guard - 2, 0, 100); }
    else if (oppMove === '看表') { K.patience = clamp(K.patience - 4, 0, 100); K.nerve = clamp(K.nerve - 2.5, 0, 100); }
    else { K.nerve = clamp(K.nerve - 2.5, 0, 100); K.interest = clamp(K.interest - 1.5, 0, 100); }
  }

  const rec = { round: K.round, move, roll, val, pw: Math.round(pw * 10) / 10, note, oppMove,
    st: { guard: Math.round(K.guard), interest: Math.round(K.interest), patience: Math.round(K.patience), nerve: Math.round(K.nerve) } };
  K.log.push(rec);

  if (!K.over) {
    if (K.interest >= 70 && K.guard <= 35) { K.over = true; K.result = '谈成'; }
    else if (K.patience <= 0) { K.over = true; K.result = '谈崩'; K.why = '对方不想再听了'; }
    else if (K.nerve <= 0) { K.over = true; K.result = '留口子'; K.why = '你自己先撑不住了'; }
    else if (K.round >= 8) {
      const score = K.interest - K.guard;
      K.over = true;
      K.result = score >= 15 ? '谈成' : score >= -12 ? '留口子' : '谈崩';
    }
  }
  // 这一档里没有翻脸这回事，最差也就是改天再说
  if (K.over && K.result === '谈崩' && fdm(S).fiat) { K.result = '留口子'; K.why = '话没说死，改天再约'; }
  rec.result = K.result;
  return rec;
}

// 打完了记账：里程碑、代价、名声
function settleKey(S) {
  const K = S.key;
  if (!K) return null;
  const out = { result: K.result, scene: K.scene, opp: K.opp.name, rounds: K.round, cost: K.cost, mile: null, price: [] };
  const f = fdm(S);
  if (K.kind === 'love' || K.kind === 'marry') {
    const who = K.opp.name;
    if (K.result === '谈成') {
      if (K.kind === 'love') { startRomance(S, K.who || who, '在一起'); out.love = K.who || who; }
      else {
        const cost = Math.round((CITIES[S.city] || CITIES['新一线']).shop * 30);
        marry(S, cost);
        out.married = K.who || who; out.cost = cost;
      }
    } else if (K.result === '谈崩') {
      const n = S.npcs.find(x => x.name === (K.who || who));
      if (n) n.rel = clamp(n.rel - 10, 0, 100);
      out.price.push('话说破了，反而远了');
    }
    S.player.energy = clamp(S.player.energy - 8, 0, 100);
    S.stats.keys = (S.stats.keys || 0) + 1;
    if (K.result === '谈成') S.stats.keyWins = (S.stats.keyWins || 0) + 1;
    S.key = null;
    return out;
  }
  if (K.kind === 'raise') {
    if (K.result === '谈成') {
      const up = Math.round(S.ledger.salary * (0.09 + Math.random() * 0.09));
      S.ledger.salary += up;
      S.ledger.base = Math.round(S.ledger.salary / payMul(S, S.job.lv));
      out.raise = up;
    } else if (K.result === '谈崩') { S.job.mood = (S.job.mood || 0) - 10; out.price.push('老板那边记了一笔'); }
    S.job.askedRaise = shortDate(S.date);
    S.player.energy = clamp(S.player.energy - 6, 0, 100);
    S.stats.keys = (S.stats.keys || 0) + 1;
    if (K.result === '谈成') S.stats.keyWins = (S.stats.keyWins || 0) + 1;
    S.key = null;
    return out;
  }
  if (K.kind === 'job' && K.post) {
    if (K.result === '谈成') { const tk = takePost(S, K.post, Math.random); out.job = tk.text; out.pay = tk.pay; }
    else if (K.result === '谈崩') { S.player.energy = clamp(S.player.energy - 6, 0, 100); out.price.push('灰头土脸'); }
    S.lastPost = K.post;
    S.player.energy = clamp(S.player.energy - 5, 0, 100);
    S.stats.keys = (S.stats.keys || 0) + 1;
    if (K.result === '谈成') S.stats.keyWins = (S.stats.keyWins || 0) + 1;
    S.key = null;
    return out;
  }
  if (K.result === '谈成') {
    S.player.信誉 = clamp(S.player.信誉 + 4, 0, 100);
    if (K.mileId) {
      for (const st of S.ideal.stages) for (const m of st.milestones) if (m.id === K.mileId && !m.done) {
        m.done = true; m.doneDate = shortDate(S.date);
        out.mile = m.title;
        // 上一个台阶，是要拿东西换的
        const en = Math.round(12 * f.cost);
        S.player.energy = clamp(S.player.energy - en, 0, 100);
        out.price.push(`精力-${en}`);
        const far = S.npcs.filter(n => !n.close).sort((a, b) => (a.lastSeen || 0) - (b.lastSeen || 0))[0];
        if (far && f.cost >= 0.7) { far.rel = clamp(far.rel - 8, 0, 100); out.price.push(`${far.name}那边疏了`); }
      }
    }
  } else if (K.result === '谈崩') {
    S.player.信誉 = clamp(S.player.信誉 - 2, 0, 100);
    if (K.round >= 4) addRift(S, K.opp.name, `${K.scene}那回谈崩了`, K.kind === 'job' ? '竞对' : '私怨', 18);
    S.player.energy = clamp(S.player.energy - Math.round(10 * f.cost), 0, 100);
    out.price.push('灰头土脸');
  }
  if (K.cost > 0) {
    const money = Math.round(K.cost * 800 * f.cost);
    S.player.money -= money;
    acct(S, '谈判让出去的', -money, K.scene || '');
    out.price.push(`让出去的折成钱约${money}`);
  }
  S.stats.keys = (S.stats.keys || 0) + 1;
  if (K.result === '谈成') S.stats.keyWins = (S.stats.keyWins || 0) + 1;
  S.key = null;
  return out;
}

// 性别：模型给了就用；没给按称呼/职业里的字推；推不出留空（留空的人用姓氏字块，不瞎猜）
const FEMALE_WORDS = /妈|娘|姨|姑|婶|嫂|姐|妹|妻|老婆|媳|女|太太|夫人|奶奶|外婆|闺蜜/;
const MALE_WORDS = /爸|爹|叔|舅|伯|哥|弟|兄|夫|老公|丈夫|男|先生|爷爷|外公|师傅|师父|老板$/;
function guessGender(given, tie, job, name) {
  if (given === '男' || given === '女') return given;
  const t = String(tie || '') + '|' + String(name || '');   // 称呼和名字都看：表姐、孙姐、妈
  if (FEMALE_WORDS.test(t)) return '女';
  if (MALE_WORDS.test(t)) return '男';
  const j = String(job || '');
  if (/女|妈|姐|太太|夫人/.test(j)) return '女';
  if (/先生|大爷|大叔|小伙|哥们/.test(j)) return '男';
  return '';
}
// 一个人身上要一直记着的事（离过婚、是你前任、欠你钱、搬去了外地）：不随普通记忆滚走
function addFact(n, f) {
  f = String(f || '').trim().slice(0, 40);
  if (!n || !f) return;
  n.facts = n.facts || [];
  if (n.facts.some(x => sameThing(x, f))) return;
  n.facts.push(f);
  n.facts = n.facts.slice(-8);
}
function addNpcs(S, list, max) {
  for (const n of (list || []).slice(0, max || 2)) {
    if (!n || !n.name) continue;
    n.name = String(n.name).replace(/[（(][^）)]*[）)]/g, '').trim() || n.name;
    if (S.npcs.some(x => x.name === n.name || x.name === whoIs(S, n.name))) continue;
    if (S.player && n.name === S.player.name) continue;      // 不许造一个跟主角同名的人
    S.npcs.push({
      name: String(n.name).slice(0, 12), age: num(n.age) || 0,
      job: String(n.job || '').slice(0, 20), rel: num(n.rel) || 20,
      tie: String(n.tie || '认识的人').slice(0, 12),
      care: String(n.care || '').slice(0, 30), note: String(n.note || '').slice(0, 50),
      close: !!n.close, mem: [], facts: [], lastSeen: S.stats.days, met: shortDate(S.date) + (S.date.y !== (S.startDate || S.date).y ? `（${S.date.y}年）` : ''),
      gender: guessGender(n.gender, n.tie, n.job, n.name), ageY: S.date.y
    });
    S.npcs[S.npcs.length - 1].talk = talkOf(S.npcs[S.npcs.length - 1]);
    if (n.pos || n.circle || n.lv != null) setNpcPos(S, S.npcs[S.npcs.length - 1], n, true);
    if (n.intimate === true) markIntimate(S, S.npcs[S.npcs.length - 1]);
  }
}

/* ---------- 雷同检测（照搬武侠版的思路） ---------- */
function bigrams(s) {
  s = String(s || '').replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}
function simRatio(a, b) {
  const A = bigrams(a), B = new Set(bigrams(b));
  if (!A.length || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / A.length;
}
// 两件事是不是说的同一件：互相包含，或者字面重合一半以上
function sameThing(a, b) {
  a = String(a || '').replace(/[\s，。、！？：「」“”"'（）()]/g, ''); b = String(b || '').replace(/[\s，。、！？：「」“”"'（）()]/g, '');
  if (!a || !b) return false;
  if (a === b || (a.length >= 3 && b.indexOf(a) >= 0) || (b.length >= 3 && a.indexOf(b) >= 0)) return true;
  return Math.max(simRatio(a, b), simRatio(b, a)) >= 0.5;
}
// 刚办掉、刚改期、刚放了鸽子的事记几天，模型再报同一件就不认
function noteDone(S, text) {
  S.doneRecent = (S.doneRecent || []).filter(x => S.stats.days - x.day <= 6);
  S.doneRecent.push({ t: String(text || '').slice(0, 40), day: S.stats.days });
  S.doneRecent = S.doneRecent.slice(-20);
}
function recentlyDone(S, text) { return (S.doneRecent || []).some(x => S.stats.days - x.day <= 6 && sameThing(x.t, text)); }
function stuckLevel(S) {
  const r = S.recent;
  if (r.length < 2) return 0;
  const last = r[r.length - 1].narrative;
  let worst = 0;
  for (let i = Math.max(0, r.length - 4); i < r.length - 1; i++)
    worst = Math.max(worst, simRatio(last, r[i].narrative));
  return Math.round(worst * 100);
}
const NUDGES = [
  '换个地方：把这一段写到一个还没出现过的场所里去',
  '让一个人主动找上门，带着一件跟上一段无关的事',
  '让主角原本打算做的事落空，被别的事插队',
  '把时间推快一些，跳过日常，直接写到下一件有分量的事',
  '让主角知道一件他此前不知道的事，且这件事对他有影响'
];
function pickNudge(rng) { return pick(rng || Math.random, NUDGES); }


/* ================= 生活：住处、找活、兼职、乐子、商店、关系档 ================= */
// 关系分五档：生分 / 点头之交 / 熟人 / 朋友 / 交心。家里人换个叫法，作用照档位算
const TIERS = ['生分', '点头之交', '熟人', '朋友', '交心'];
function relTier(v) { v = num(v); return v >= 80 ? 4 : v >= 55 ? 3 : v >= 30 ? 2 : v >= 12 ? 1 : 0; }
const TIER_LEND = [0, 0.3, 0.8, 2, 4];          // 借钱上限：城市月薪的几倍
const TIER_ASK = [15, 8, 0, -8, -15];           // 开口求人：难度加减
const TIER_OFF = [1, 1, 0.9, 0.8, 0.7];         // 熟人价
const TIER_GIFT = [0.5, 0.8, 1, 1.1, 1.2];      // 送礼、一起玩，关系涨多少
const KIN_TIE = /家里人|妈|爸|父|母|爷|奶|外公|外婆|叔|伯|姨|舅|姑|表|堂|亲戚|哥哥|姐姐|弟弟|妹妹|婶|侄|外甥/;
function isKinNpc(n) { return KIN_TIE.test(String((n && n.tie) || '') + '|' + String((n && n.name) || '')) && !/同事|同学|朋友|室友|邻居/.test(String((n && n.tie) || '')); }
function askMod(S, name) {
  const n = name ? npcByName(S, name) : null;
  return (n ? TIER_ASK[relTier(n.rel)] : 0) + num((ORIGINS[S.origin] || {}).askEase);
}

/* ---- 住处 ---- */
const HOUSING = {
  '城中村单间': { x: 0.55, en: -3, commute: 2, desc: '便宜，楼道里堆着电动车，隔音差，偶尔出点事', far: '离上班远' },
  '合租次卧':   { x: 1,    en: 0,  commute: 0, desc: '跟不认识的人合租，厨房厕所共用', far: '通勤一般' },
  '单身公寓':   { x: 1.7,  en: 2,  commute: -1, desc: '一个人一间，安静，可以带人回来', far: '离上班的地方近' },
  '整租一居':   { x: 2.4,  en: 4,  commute: -1, desc: '一室一厅，体面，伴侣能一起住', far: '离上班的地方近' }
};
function homeTier(S) { const t = S.home && S.home.tier; return HOUSING[t] ? t : '合租次卧'; }
function rentFor(S, tier) {
  const city = CITIES[S.city] || CITIES['新一线'];
  const org = ORIGINS[S.origin] || ORIGINS['普通家庭'];
  return Math.round(city.rent * org.rentCut * (HOUSING[tier] || HOUSING['合租次卧']).x / 50) * 50;
}
function moveCost(S, tier) { return Math.max(300, Math.round(rentFor(S, tier) * 0.5 / 50) * 50); }
function moveHome(S, tier) {
  if (!HOUSING[tier]) return { ok: false, why: '没有这种房子' };
  if (S.home && S.home.kind === '买') return { ok: false, why: '已经住在自己的房子里了' };
  if (homeTier(S) === tier) return { ok: false, why: '眼下住的就是这种' };
  const cost = moveCost(S, tier);
  if (S.player.money < cost) return { ok: false, why: `中介费加搬家要${cost}，账上只有${S.player.money}` };
  const from = homeTier(S), r0 = S.ledger.rent;
  S.player.money -= cost;
  acct(S, '搬家', -cost, `${from}→${tier}`);
  S.home.tier = tier; S.home.since = shortDate(S.date); S.home.place = '';
  S.ledger.rent = rentFor(S, tier);
  return { ok: true, from, tier, cost, rent: S.ledger.rent, rent0: r0,
    note: `从${from}搬进了${tier}，中介费加搬家花了${cost}，房租从每月${r0}变成${S.ledger.rent}，账上剩${S.player.money}` };
}

/* ---- 岗位库：月薪是城市基准的倍数；strain 0轻 1一般 2累 3很累 ---- */
const STRAIN = ['轻', '一般', '累', '很累'];
const STRAIN_EN = [2, 0, -2, -4];                // 每个上班时段多耗的精力
const STRAIN_PERF = [0.85, 1, 1.12, 1.2];        // 绩效涨得快慢
const EDU_LV = { '大专': 0, '本科': 1, '硕士': 2 };
const JOBS = [
  { name: '外卖骑手', org: '配送站', lo: 1.1, hi: 1.4, attr: '体能', strain: 3, edu: 0, need: 18 },
  { name: '店员', org: '便利店', lo: 0.8, hi: 0.95, attr: '表达', strain: 1, edu: 0, need: 18 },
  { name: '收银', org: '超市', lo: 0.8, hi: 0.95, attr: '情绪', strain: 1, edu: 0, need: 16 },
  { name: '客服', org: '客服中心', lo: 0.85, hi: 1, attr: '情绪', strain: 1, edu: 0, need: 22 },
  { name: '销售', org: '销售公司', lo: 0.8, hi: 1.8, attr: '表达', strain: 2, edu: 0, need: 26, vary: 1 },
  { name: '行政文员', org: '商贸公司', lo: 0.9, hi: 1.05, attr: '谋划', strain: 0, edu: 0, need: 28 },
  { name: '前台', org: '写字楼', lo: 0.85, hi: 1, attr: '表达', strain: 0, edu: 0, need: 22 },
  { name: '新媒体运营', org: '文化传媒', lo: 1, hi: 1.3, attr: '表达', strain: 1, edu: 1, need: 32 },
  { name: '电商运营', org: '电商公司', lo: 1, hi: 1.4, attr: '谋划', strain: 2, edu: 0, need: 32 },
  { name: '平面设计', org: '设计工作室', lo: 1, hi: 1.4, attr: '专业', strain: 1, edu: 0, need: 36 },
  { name: '程序员', org: '科技公司', lo: 1.4, hi: 2.2, attr: '专业', strain: 2, edu: 1, need: 46 },
  { name: '数据分析', org: '信息技术', lo: 1.2, hi: 1.8, attr: '谋划', strain: 2, edu: 1, need: 44 },
  { name: '产品助理', org: '网络科技', lo: 1.1, hi: 1.5, attr: '谋划', strain: 2, edu: 1, need: 40 },
  { name: '会计', org: '财务公司', lo: 1, hi: 1.3, attr: '谋划', strain: 1, edu: 1, need: 36 },
  { name: '人事专员', org: '人力资源', lo: 0.95, hi: 1.2, attr: '情绪', strain: 1, edu: 1, need: 32 },
  { name: '编辑文案', org: '出版文化', lo: 0.95, hi: 1.3, attr: '专业', strain: 1, edu: 1, need: 36 },
  { name: '教培老师', org: '培训学校', lo: 1, hi: 1.5, attr: '表达', strain: 1, edu: 1, need: 32 },
  { name: '银行柜员', org: '农商银行', lo: 1, hi: 1.2, attr: '情绪', strain: 1, edu: 1, need: 42 },
  { name: '公务员', org: '街道办', lo: 0.9, hi: 1.1, attr: '谋划', strain: 0, edu: 1, need: 50, cert: 1 },
  { name: '护工', org: '康复医院', lo: 1, hi: 1.3, attr: '体能', strain: 3, edu: 0, need: 24 },
  { name: '帮厨', org: '酒楼', lo: 0.9, hi: 1.3, attr: '专业', strain: 2, edu: 0, need: 20 },
  { name: '咖啡师', org: '咖啡馆', lo: 0.85, hi: 1.05, attr: '专业', strain: 1, edu: 0, need: 20 },
  { name: '工厂普工', org: '电子厂', lo: 1, hi: 1.2, attr: '体能', strain: 3, edu: 0, need: 12 },
  { name: '快递员', org: '快递网点', lo: 1.1, hi: 1.5, attr: '体能', strain: 2, edu: 0, need: 16 },
  { name: '网约车司机', org: '出行公司', lo: 1.1, hi: 1.5, attr: '体能', strain: 2, edu: 0, need: 18 },
  { name: '保险经纪', org: '保险代理', lo: 0.6, hi: 2, attr: '表达', strain: 1, edu: 0, need: 18, vary: 1 },
  { name: '房产中介', org: '地产经纪', lo: 0.7, hi: 2, attr: '表达', strain: 2, edu: 0, need: 22, vary: 1 },
  { name: '导购', org: '商场专柜', lo: 0.85, hi: 1.3, attr: '表达', strain: 1, edu: 0, need: 20, vary: 1 },
  { name: '仓库管理', org: '物流园', lo: 0.95, hi: 1.15, attr: '谋划', strain: 1, edu: 0, need: 24 },
  { name: '健身教练', org: '健身房', lo: 0.9, hi: 1.6, attr: '体能', strain: 2, edu: 0, need: 30, vary: 1 },
  { name: '摄影师', org: '影像工作室', lo: 1, hi: 1.5, attr: '专业', strain: 1, edu: 0, need: 38 },
  { name: '物业管家', org: '物业公司', lo: 0.85, hi: 1.05, attr: '情绪', strain: 1, edu: 0, need: 18 },
  { name: '直播场控', org: '直播公司', lo: 0.9, hi: 1.4, attr: '表达', strain: 2, edu: 0, need: 24 }
];
const ORG_PRE = ['恒信', '启航', '华禾', '明远', '安达', '鑫和', '青禾', '卓越', '新程', '长风', '万象', '和润', '嘉禾', '致远', '光合', '同舟', '东升', '南星', '北辰', '一品', '众诚', '顺丰源', '福满', '宏图'];
function jobByName(name) { return JOBS.find(j => j.name === name) || null; }
function eduLv(S) { return num(EDU_LV[(S.player.bg || {}).edu]); }
function postPay(S, j) {
  const city = CITIES[S.city] || CITIES['新一线'];
  const ek = Math.sqrt((EDUS[(S.player.bg || {}).edu] || EDUS['本科']).pay);
  return { lo: Math.round(city.pay * j.lo * ek / 100) * 100, hi: Math.round(city.pay * j.hi * ek / 100) * 100 };
}
function jobBoard(S, rng, force) {
  rng = rng || Math.random;
  const B = S.board;
  if (B && !force && S.stats.days - num(B.day) < 7) return B;
  const el = eduLv(S);
  const pool = JOBS.filter(j => j.edu <= el && !(S.city === '老家县城' && /程序员|数据分析|产品助理|直播场控/.test(j.name)));
  const w = pool.map(j => 1 + Math.max(0, attrVal(S, j.attr) - j.need) / 20 + rng());
  const picked = [];
  const idx = pool.map((j, i) => i).sort((a, b) => w[b] - w[a]);
  // 前三个挑合适的，后两个随手抓：不全是顺手的活
  for (const i of idx.slice(0, 3)) picked.push(pool[i]);
  const rest = idx.slice(3);
  while (picked.length < 5 && rest.length) picked.push(pool[rest.splice(Math.floor(rng() * rest.length), 1)[0]]);
  S.boardId = num(S.boardId);
  S.board = { day: S.stats.days, list: picked.map(j => {
    S.boardId++;
    const pay = postPay(S, j);
    return { id: S.boardId, job: j.name, employer: pick(rng, ORG_PRE) + j.org, lo: pay.lo, hi: pay.hi,
      attr: j.attr, strain: j.strain, need: j.need + (j.cert ? 0 : 0), vary: !!j.vary, cert: !!j.cert, state: '' };
  }) };
  return S.board;
}
function boardNext(S) { return S.board ? Math.max(0, 7 - (S.stats.days - num(S.board.day))) : 0; }
function applyPost(S, id, rng) {
  rng = rng || Math.random;
  const P = S.board && S.board.list.find(x => x.id === id);
  if (!P) return { ok: false, why: '这条招聘已经下了' };
  if (P.state) return { ok: false, why: '这家已经投过了' };
  if (P.cert && !hasItem(S, 'cert')) return { ok: false, why: '这个岗位要先考试，得先报个考证班' };
  if (originBlocked(S, P.job)) return { ok: false, why: '政审过不了，这个岗位投不进去' };
  const ck = rollCheck(S, P.attr, P.need + (S.job.out ? 0 : 4) + (bankOf(S).credit < 40 ? 5 : 0), rng);
  S.stats.checks++; if (ck.success) S.stats.wins++;
  if (!ck.success) { P.state = '没回音'; return { ok: true, pass: false, ck, post: P }; }
  const inD = rnd(rng, 1, 3), dt = addDays(S.date, inD);
  P.state = '约了面试';
  const title = `${P.employer}${P.job}的面试`;
  S.appts.push({ y: dt.y, m: dt.m, d: dt.d, title, kind: '面试', done: false, post: P.id });
  return { ok: true, pass: true, ck, post: P, date: dt, title };
}
function findPost(S, id) { return (S.board && S.board.list.find(x => x.id === id)) || (S.lastPost && S.lastPost.id === id ? S.lastPost : null); }
// 面试谈成：岗位、月薪、累不累都由引擎写进账
function takePost(S, P, rng) {
  rng = rng || Math.random;
  const val = attrVal(S, P.attr);
  const t = clamp((val - P.need) / 40 + 0.25 + rng() * 0.3, 0, 1);
  const pay = Math.round((P.lo + (P.hi - P.lo) * t) / 100) * 100;
  const J = S.job;
  const lv = (S.player.资历天 || 0) >= 300 ? 1 : 0;
  J.out = false; J.employer = P.employer.slice(0, 16); J.post = P.job.slice(0, 10);
  J.lv = lv; J.title = jobTitle(S, lv); J.probation = false;
  J.perf = 0; J.mood = 0; J.quarters = 0;
  J.strain = P.strain; J.vary = P.vary ? 1 : 0; J.lib = P.job; J.sinceDay = S.stats.days;
  S.ledger.salary = pay;
  S.ledger.base = Math.round(pay / payMul(S, lv));
  S.player.job = `${J.employer}的${J.post}`;
  if (S.board) { const b = S.board.list.find(x => x.id === P.id); if (b) b.state = '入职了'; }
  return { kind: '新工作', text: `${J.employer}，${J.post}，月薪${pay}，${STRAIN[P.strain]}活`, pay };
}

/* ---- 兼职：每周按次数结算 ---- */
// days：星期几（0=周日）；slot：占哪个时段
const GIGS = {
  '家教':     { pay: 180, days: [2, 4], slot: '晚上', en: 5, attr: '表达', edu: 1, desc: '一周两个晚上，给初中生补课' },
  '代驾':     { pay: 160, days: [1, 3, 5], slot: '深夜', en: 9, attr: '体能', desc: '一周三个晚上，接喝了酒的客人' },
  '跑外卖':   { pay: 230, days: [0, 6], slot: '白天', en: 12, attr: '体能', desc: '周末两天，骑着电动车跑单' },
  '摆摊':     { pay: 200, days: [5, 6], slot: '晚上', en: 7, attr: '表达', desc: '周五周六晚上，在夜市摆个小摊', vary: 1 },
  '做翻译':   { pay: 260, days: [3], slot: '晚上', en: 6, attr: '专业', edu: 1, desc: '一周一个晚上，接点文档翻译' },
  '剪视频':   { pay: 220, days: [2, 6], slot: '晚上', en: 6, attr: '专业', desc: '一周两个晚上，帮人剪短视频' },
  '发传单':   { pay: 100, days: [6], slot: '白天', en: 6, attr: '体能', desc: '周六白天，在商场门口发传单' },
  '超市理货': { pay: 140, days: [0], slot: '白天', en: 8, attr: '体能', desc: '周日白天，帮超市上货' },
  '写稿':     { pay: 200, days: [4], slot: '晚上', en: 6, attr: '专业', desc: '一周一个晚上，给公众号写稿' },
  '陪练':     { pay: 150, days: [0], slot: '晚上', en: 5, attr: '情绪', desc: '周日晚上，陪人练口语、练车' },
  '活动礼仪': { pay: 280, days: [6], slot: '白天', en: 7, attr: '表达', desc: '周六白天，商场活动站台' },
  '代写简历': { pay: 120, days: [1], slot: '晚上', en: 4, attr: '谋划', desc: '一周一个晚上，在网上接单' }
};
const WD_NAME = ['日', '一', '二', '三', '四', '五', '六'];
function gigPay(S, name) {
  const g = GIGS[name], city = CITIES[S.city] || CITIES['新一线'];
  return Math.round(g.pay * city.pay / 4800 * (1 + (attrVal(S, g.attr) - 30) / 160) / 10) * 10;
}
function gigWhen(name) { const g = GIGS[name]; return `每周${g.days.slice().sort((a, b) => (a + 6) % 7 - (b + 6) % 7).map(d => '周' + WD_NAME[d]).join('、')}${g.slot}`; }
function takeGig(S, name) {
  const g = GIGS[name];
  if (!g) return { ok: false, why: '没有这种兼职' };
  S.gigs = S.gigs || [];
  if (S.gigs.some(x => x.name === name)) return { ok: false, why: '已经在做了' };
  if (S.gigs.length >= 2) return { ok: false, why: '最多同时做两份' };
  if (g.edu && eduLv(S) < g.edu) return { ok: false, why: '这活要本科以上' };
  const clash = S.gigs.find(x => GIGS[x.name].slot === g.slot && GIGS[x.name].days.some(d => g.days.includes(d)));
  if (clash) return { ok: false, why: `跟${clash.name}的时间撞了` };
  S.gigs.push({ name, since: shortDate(S.date), times: 0, owed: 0, total: 0 });
  return { ok: true, note: `接了${name}：${gigWhen(name)}，一次大概${gigPay(S, name)}` };
}
function dropGig(S, name) {
  S.gigs = (S.gigs || []);
  const i = S.gigs.findIndex(x => x.name === name);
  if (i < 0) return null;
  const g = S.gigs.splice(i, 1)[0];
  if (g.owed) { S.player.money += g.owed; acct(S, `兼职·${g.name}`, g.owed, '结清'); }
  return g;
}
// 今天哪份兼职占了哪个时段
function gigToday(S) {
  const w = dOf(S.date).getDay();
  return (S.gigs || []).filter(x => GIGS[x.name] && GIGS[x.name].days.includes(w));
}

/* ---- 物品 ---- */
// keep：耐用品；gift：专门送人；tags：送礼时对心意用
const ITEMS = [
  { id: 'fruit', cat: '吃的喝的', name: '一箱水果', price: 120, use: { en: 4 }, tags: ['健康', '实用'] },
  { id: 'snack', cat: '吃的喝的', name: '一袋零食', price: 60, use: { en: 3 }, tags: ['好吃', '孩子'] },
  { id: 'tea', cat: '吃的喝的', name: '一盒好茶叶', price: 380, use: { en: 5 }, tags: ['体面', '健康'] },
  { id: 'baijiu', cat: '吃的喝的', name: '两瓶白酒', price: 520, use: { en: 2 }, tags: ['体面', '爱喝'] },
  { id: 'coffee', cat: '吃的喝的', name: '一盒挂耳咖啡', price: 90, use: { en: 4 }, tags: ['实用'] },
  { id: 'cake', cat: '吃的喝的', name: '一个蛋糕', price: 200, use: { en: 3 }, tags: ['好吃', '孩子', '心意'] },
  { id: 'suit', cat: '衣服', name: '一身正装', price: 900, keep: 1, fx: { formal: 5 }, tags: ['体面'] },
  { id: 'sport', cat: '衣服', name: '一套运动服', price: 300, keep: 1, fx: { gymX: 0.15 }, tags: ['健康', '实用'] },
  { id: 'coat', cat: '衣服', name: '一件好看的外套', price: 700, keep: 1, fx: { charm: 4 }, tags: ['体面', '心意'] },
  { id: 'shoes', cat: '衣服', name: '一双好鞋', price: 500, keep: 1, fx: { charm: 2 }, tags: ['体面', '实用'] },
  { id: 'pc_old', cat: '数码', name: '二手电脑', price: 1800, keep: 1, fx: { workX: 0.08 }, wear: 720, tags: ['实用'] },
  { id: 'pc_new', cat: '数码', name: '新电脑', price: 6500, keep: 1, fx: { workX: 0.15 }, wear: 1095, tags: ['实用', '体面'] },
  { id: 'phones', cat: '数码', name: '一副好耳机', price: 900, keep: 1, fx: { sleep: 1 }, tags: ['实用', '心意'] },
  { id: 'camera', cat: '数码', name: '一台相机', price: 4200, keep: 1, fx: { camera: 0.2 }, wear: 1460, tags: ['体面'] },
  { id: 'tablet', cat: '数码', name: '一台平板', price: 2600, keep: 1, fx: { workX: 0.05 }, wear: 1095, tags: ['实用', '孩子'] },
  { id: 'book', cat: '书和课', name: '几本专业书', price: 150, use: { attr: { '专业': 0.6 } }, tags: ['上进'] },
  { id: 'book2', cat: '书和课', name: '几本闲书', price: 90, use: { attr: { '情绪': 0.4 }, en: 2 }, tags: ['上进', '心意'] },
  { id: 'course', cat: '书和课', name: '一门网课', price: 699, use: { attr: { '专业': 1.2, '谋划': 0.4 } }, tags: ['上进'] },
  { id: 'speak', cat: '书和课', name: '口才课', price: 899, use: { attr: { '表达': 1.2 } }, tags: ['上进'] },
  { id: 'cert', cat: '书和课', name: '考证班', price: 3800, keep: 1, fx: { cert: 1 }, tags: ['上进'], note: '考公务员、考证的门槛' },
  { id: 'bed', cat: '家用', name: '一张好床垫', price: 2200, keep: 1, fx: { sleep: 2 }, tags: ['实用', '健康'] },
  { id: 'plant', cat: '家用', name: '几盆绿植', price: 120, keep: 1, fx: { sleep: 0.5 }, tags: ['心意'] },
  { id: 'cooker', cat: '家用', name: '一个小电饭煲', price: 260, keep: 1, fx: { sleep: 0.5 }, tags: ['实用'] },
  { id: 'fan', cat: '家用', name: '一台空气净化器', price: 1200, keep: 1, fx: { sleep: 1 }, tags: ['实用', '健康'] },
  { id: 'check', cat: '健康', name: '体检套餐', price: 680, use: { heal: 1, eased: 1 }, tags: ['健康'] },
  { id: 'massage', cat: '健康', name: '按摩卡（三次）', price: 450, use: { en: 8, heal: 2 }, uses: 3, tags: ['健康'] },
  { id: 'waist', cat: '健康', name: '护腰', price: 260, keep: 1, fx: { back: 1 }, tags: ['健康', '实用'] },
  { id: 'vitamin', cat: '健康', name: '一瓶维生素', price: 160, use: { en: 3, heal: 1 }, tags: ['健康'] },
  { id: 'car', cat: '大件', name: '一辆车', price: 150000, keep: 1, fx: { charm: 3 }, tags: ['体面'] },
  { id: 'flower', cat: '礼物', name: '一束花', price: 199, gift: 1, tags: ['心意', '浪漫'] },
  { id: 'jewel', cat: '礼物', name: '一条项链', price: 1600, gift: 1, tags: ['浪漫', '体面'] },
  { id: 'perfume', cat: '礼物', name: '一瓶香水', price: 780, gift: 1, tags: ['浪漫', '体面'] },
  { id: 'smoke', cat: '礼物', name: '一条好烟', price: 650, gift: 1, tags: ['体面', '爱喝'] },
  { id: 'toy', cat: '礼物', name: '一个玩具', price: 260, gift: 1, tags: ['孩子'] },
  { id: 'wine', cat: '礼物', name: '一瓶红酒', price: 420, gift: 1, tags: ['体面', '浪漫', '爱喝'] },
  { id: 'scarf', cat: '礼物', name: '一条羊毛围巾', price: 360, gift: 1, tags: ['实用', '心意'] },
  { id: 'health', cat: '礼物', name: '一盒保健品', price: 480, gift: 1, tags: ['健康', '体面'] }
];
const SHOP_CATS = ['吃的喝的', '衣服', '数码', '书和课', '家用', '健康', '礼物'];
const CITY_PRICE = { '一线': 1.15, '新一线': 1, '老家县城': 0.85 };
// 心意：礼物的标签对上他在意的
const TAG_CARE = {
  '实用': /省钱|实用|过日子|钱|节俭|房|日子/, '体面': /面子|体面|排场|名声|地位|场面|规矩/, '健康': /健康|身体|养生|病|睡/,
  '孩子': /孩子|娃|儿子|女儿|小孩|宝宝/, '好吃': /吃|美食|嘴|零食/, '浪漫': /感情|浪漫|对象|心意|陪|在乎/,
  '爱喝': /酒|喝|烟/, '上进': /学习|上进|考|前途|工作|事业|升/, '心意': /心意|记得|被重视|陪|朋友|感情/
};
// 熟人价：认识的人里干这一行的
const CAT_JOB = { '吃的喝的': /超市|水果|餐|饭|奶茶|烟酒|零食|食品|茶|酒/, '衣服': /服装|衣|导购|专柜|商场|鞋/, '数码': /数码|手机|电脑|电子|程序|科技|IT/, '书和课': /书店|老师|培训|教|讲师/, '家用': /家居|家具|建材|五金|电器/, '健康': /医|药|护|按摩|理疗|体检|健身/, '礼物': /花店|礼品|珠宝|首饰|香水/ };
function itemOf(id) { return ITEMS.find(x => x.id === id) || null; }
function itemPrice(S, it) { return Math.round(it.price * (CITY_PRICE[S.city] || 1) / 10) * 10; }
function shopFriend(S, cat) {
  const re = CAT_JOB[cat];
  if (!re) return null;
  const c = S.npcs.filter(n => re.test(String(n.job || '')) && relTier(n.rel) >= 2).sort((a, b) => b.rel - a.rel)[0];
  return c ? { name: c.name, off: TIER_OFF[relTier(c.rel)] } : null;
}
function bag(S) { if (!S.bag) S.bag = []; return S.bag; }
function hasItem(S, id) { return bag(S).some(b => b.id === id && b.keep); }
function buyItem(S, id, viaFriend) {
  const it = itemOf(id);
  if (!it) return { ok: false, why: '没有这样东西' };
  let price = itemPrice(S, it);
  const fr = viaFriend ? shopFriend(S, it.cat) : null;
  if (fr) price = Math.round(price * fr.off / 10) * 10;
  if (S.player.money < price) return { ok: false, why: `要${price}，账上只有${S.player.money}` };
  if (it.keep && hasItem(S, id)) return { ok: false, why: `已经有${it.name}了` };
  S.player.money -= price;
  acct(S, `买${it.name}`, -price, fr ? `${fr.name}那儿拿的，${Math.round(fr.off * 10)}折` : '');
  S.bagId = num(S.bagId) + 1;
  const b = { uid: S.bagId, id, name: it.name, cat: it.cat, keep: !!it.keep, gift: !!it.gift, tags: it.tags.slice(), price, day: S.stats.days, date: shortDate(S.date), uses: it.uses || 1 };
  bag(S).push(b);
  if (fr) { const n = npcByName(S, fr.name); if (n) { n.lastSeen = S.stats.days; npcMem(S, n, `主角在他那儿买了${it.name}，给了熟人价`); } }
  return { ok: true, item: b, price, friend: fr };
}
// 耐用品加在一起的效果；旧了的减半
function bagFx(S) {
  const fx = {};
  for (const b of bag(S)) {
    if (!b.keep) continue;
    const it = itemOf(b.id); if (!it || !it.fx) continue;
    const old = it.wear && S.stats.days - b.day > it.wear;
    for (const k in it.fx) fx[k] = num(fx[k]) + it.fx[k] * (old ? 0.5 : 1);
  }
  return fx;
}
function itemOld(S, b) { const it = itemOf(b.id); return !!(it && it.wear && S.stats.days - b.day > it.wear); }
function useItem(S, uid) {
  const i = bag(S).findIndex(b => b.uid === uid);
  if (i < 0) return { ok: false, why: '包里没有这样东西' };
  const b = bag(S)[i], it = itemOf(b.id);
  if (!it || b.keep || it.gift || !it.use) return { ok: false, why: b.keep ? '这是一直摆着用的' : '这是送人的' };
  const u = it.use, p = S.player, done = [];
  if (u.en) { p.energy = clamp(p.energy + u.en, 0, energyCap(S)); done.push(`精力+${u.en}`); }
  if (u.attr) for (const k in u.attr) { p.attrF[k] = r2(num(p.attrF[k]) + u.attr[k]); p.attrs[k] = Math.round(p.attrF[k]); done.push(`${k}+${u.attr[k]}`); }
  if (u.heal && S.status.length) { for (const st of S.status) st.days = Math.max(1, st.days - u.heal); done.push('病好得快了点'); }
  if (u.eased && S.chronic.length) { const c = S.chronic.find(x => !num(x.eased)); if (c) { c.eased = 1; done.push(`${c.name}松了些`); } }
  b.uses = num(b.uses) - 1;
  if (b.uses <= 0) bag(S).splice(i, 1);
  return { ok: true, item: b, note: `用了${b.name}${done.length ? '：' + done.join('，') : ''}` };
}
// 送礼：价钱占他月收入多少、合不合心意、关系到哪一档
function careTags(n) {
  const c = String(n.care || '') + '|' + String(n.note || '');
  const hit = Object.keys(TAG_CARE).filter(t => TAG_CARE[t].test(c));
  const tie = String(n.tie || '');
  if (KIN_TIE.test(tie) && /妈|爸|父|母|爷|奶|外公|外婆|叔|伯|姨|舅|姑|婶/.test(tie + n.name)) hit.push('健康', '实用');
  if (/对象|爱人|老公|老婆|女朋友|男朋友|伴侣/.test(tie)) hit.push('浪漫', '心意');
  if (/孩子|儿子|女儿/.test(n.note || '') || /孩子/.test(n.care || '')) hit.push('孩子');
  return [...new Set(hit)];
}
function giftValue(S, n, b) {
  const city = CITIES[S.city] || CITIES['新一线'];
  const tier = relTier(n.rel);
  const ratio = b.price / city.pay;
  let g = clamp(1 + ratio * 26, 1, 9);
  const care = careTags(n);
  const match = b.tags.filter(t => care.includes(t));
  if (match.length) g *= 2;
  g *= TIER_GIFT[tier];
  let awkward = false;
  if (ratio > 0.25 && tier <= 2) { awkward = true; g = Math.min(g, 1.5); }
  if (n.giftItemDay && S.stats.days - n.giftItemDay < 7) g *= 0.4;
  return { gain: Math.round(clamp(g, 0.5, 12) * 10) / 10, match, awkward, tier };
}
function giveItem(S, name, uid, rng) {
  rng = rng || Math.random;
  const n = npcByName(S, name);
  if (!n) return { ok: false, why: '没有这个人' };
  const i = bag(S).findIndex(b => b.uid === uid);
  if (i < 0) return { ok: false, why: '包里没有这样东西' };
  const b = bag(S)[i];
  const v = giftValue(S, n, b);
  // 太贵、关系又不到：有一半会被推回来
  const back = v.awkward && rng() < 0.5;
  if (back) {
    n.rel = clamp(r2(n.rel + 0.5), 0, 100);
    npcMem(S, n, `主角送来${b.name}，太贵重了，没收，推了回去`);
    return { ok: true, back: true, item: b, gain: 0.5, match: v.match, awkward: true,
      note: `${n.name}觉得${b.name}太贵重，没收，东西还在主角手里` };
  }
  bag(S).splice(i, 1);
  n.rel = clamp(r2(n.rel + v.gain), 0, 100);
  n.giftItemDay = S.stats.days; n.lastSeen = S.stats.days;
  npcMem(S, n, `收了主角送的${b.name}${v.match.length ? '，正合心意' : ''}`);
  const how = v.match.length ? `正对上他在意的（${v.match.join('、')}）` : '没特别对上他在意的';
  return { ok: true, back: false, item: b, gain: v.gain, match: v.match, awkward: v.awkward,
    note: `${n.name}收下了${b.name}，${how}${v.awkward ? '，不过有点太贵重，他收得不太自在' : ''}；关系+${v.gain}` };
}

/* ---- 找点乐子 ---- */
// cost：每人；slot 只是说明；fx：引擎结算；rel：一起去的人关系涨多少
const FUN = [
  { id: 'movie', name: '看电影', cost: 50, per: 1, when: '半天', fx: { en: 6 }, rel: 2 },
  { id: 'ktv', name: '唱KTV', cost: 120, per: 1, when: '晚上', fx: { en: 5, attr: { '表达': 0.3 } }, rel: 3 },
  { id: 'gym', name: '去健身房', cost: 0, card: 200, when: '一个时段', fx: { en: -2, attr: { '体能': 0.4 }, cap: 1 }, rel: 1 },
  { id: 'ball', name: '打球跑步', cost: 0, when: '一个时段', fx: { en: -3, attr: { '体能': 0.3 } }, rel: 2 },
  { id: 'jubensha', name: '剧本杀桌游', cost: 100, per: 1, when: '晚上', fx: { en: 3, attr: { '谋划': 0.3 } }, rel: 3, meet: 0.35 },
  { id: 'bar', name: '去酒吧', cost: 150, per: 1, when: '晚上', fx: { en: 4, drunk: 0.35 }, rel: 3, meet: 0.35 },
  { id: 'walk', name: '公园江边走走', cost: 0, when: '半天', fx: { en: 4, attr: { '情绪': 0.2 } }, rel: 2 },
  { id: 'game', name: '打游戏网吧', cost: 20, per: 1, when: '晚上', fx: { en: 5, game: 1 }, rel: 2 },
  { id: 'show', name: '演唱会看展', cost: 500, per: 1, when: '一天', fx: { en: 10, attr: { '情绪': 0.5 } }, rel: 4 },
  { id: 'trip', name: '短途旅行', cost: 1300, per: 1, when: '周末两天', fx: { en: 20, heal: 3 }, rel: 5 },
  { id: 'fish', name: '钓鱼', cost: 30, per: 1, when: '半天', fx: { en: 6, attr: { '情绪': 0.3 } }, rel: 2 },
  { id: 'cafe', name: '喝茶咖啡馆', cost: 40, per: 1, when: '半天', fx: { en: 3 }, rel: 3 }
];
function funOf(id) { return FUN.find(x => x.id === id) || null; }
function funCost(S, f, k, treat) {
  const pk = CITY_PRICE[S.city] || 1;
  let c = Math.round(f.cost * pk / 10) * 10 * (f.per ? (treat ? 1 + k : 1) : 1);
  if (f.card && !(S.gym && S.gym.until > S.stats.days)) c += Math.round(f.card * pk / 10) * 10;
  return c;
}
function doFun(S, id, withNames, treat, rng) {
  rng = rng || Math.random;
  const f = funOf(id);
  if (!f) return { ok: false, why: '没有这个' };
  const p = S.player;
  // 叫的人来不来，看关系
  const asked = (withNames || []).map(x => npcByName(S, x)).filter(Boolean).slice(0, 3);
  const came = [], no = [];
  for (const n of asked) {
    const t = relTier(n.rel);
    const yes = t >= 2 || rng() < (t === 1 ? 0.6 : 0.3);
    (yes ? came : no).push(n);
  }
  const cost = funCost(S, f, came.length, treat);
  if (p.money < cost) return { ok: false, why: `要${cost}，账上只有${p.money}` };
  const out = [];
  if (cost) { p.money -= cost; acct(S, f.name, -cost, came.length ? `${treat ? '请' : '跟'}${came.map(n => n.name).join('、')}` : ''); out.push(`花了${cost}`); }
  if (f.card && !(S.gym && S.gym.until > S.stats.days)) { S.gym = { until: S.stats.days + 30, cap: num(S.gym && S.gym.cap) }; out.push('办了一张健身月卡'); }
  // 同一样天天去，效果减半
  S.funLog = (S.funLog || []).filter(x => S.stats.days - x.day <= 7);
  const same = S.funLog.filter(x => x.id === id && S.stats.days - x.day <= 3).length;
  const k = same ? 0.5 : 1;
  S.funLog.push({ id, day: S.stats.days });
  const fx = f.fx;
  if (fx.en) { const e = Math.round(fx.en * (fx.en > 0 ? k : 1)); p.energy = clamp(p.energy + e, 0, energyCap(S)); out.push(`精力${e >= 0 ? '+' : ''}${e}`); }
  if (fx.attr) for (const a in fx.attr) { const v = r2(fx.attr[a] * k); p.attrF[a] = r2(num(p.attrF[a]) + v); p.attrs[a] = Math.round(p.attrF[a]); out.push(`${a}+${v}`); }
  if (fx.cap) { S.gym = S.gym || { until: S.stats.days + 30, cap: 0 }; if (num(S.gym.cap) < 8) { S.gym.cap = num(S.gym.cap) + 0.25; } }
  if (fx.heal && S.status.length) { for (const st of S.status) st.days = Math.max(1, st.days - fx.heal); out.push('身上的毛病松快了'); }
  if (fx.drunk && rng() < fx.drunk) { S.flags.hangover = 1; out.push('喝多了，明天要难受'); }
  if (fx.game) {
    const n7 = S.funLog.filter(x => x.id === id).length;
    if (n7 >= 3) { S.ideal.progress = r2(Math.max(0, S.ideal.progress - 1)); out.push('这礼拜玩得太多，正事落下了'); }
  }
  const rel = [];
  for (const n of came) {
    const g = r2(f.rel * TIER_GIFT[relTier(n.rel)] * k + (treat ? 1 : 0));
    n.rel = clamp(r2(n.rel + g), 0, 100); n.lastSeen = S.stats.days;
    npcMem(S, n, `跟主角一起${f.name}${treat ? '，主角请的' : ''}`);
    rel.push(`${n.name}+${g}`);
  }
  for (const n of no) npcMem(S, n, `主角叫他去${f.name}，没去`);
  const meet = f.meet && rng() < f.meet;
  if (same) out.push('这几天去得勤，没那么新鲜了');
  return { ok: true, fun: f, cost, came: came.map(n => n.name), no: no.map(n => n.name), meet, rel,
    note: `${f.name}（${f.when}）${came.length ? `，${came.map(n => n.name).join('、')}一起${treat ? '，主角请客' : '，AA'}` : '，一个人'}${no.length ? `；叫了${no.map(n => n.name).join('、')}，没来` : ''}。${out.join('，')}${rel.length ? `；关系 ${rel.join(' ')}` : ''}${meet ? '；这回认识了一个新的人（写进 newNpcs）' : ''}` };
}

/* ---- 人物：最近在忙什么、说话习惯 ---- */
const BUSY = {
  '学生': ['在准备期末', '在赶论文', '在找实习', '在备考研究生', '在忙社团的事'],
  '上班': ['这阵子天天加班', '在赶一个项目', '刚换了部门，还在适应', '跟领导较着劲', '在偷偷看机会想跳槽', '年假请不下来，憋着火', '在带一个新来的'],
  '长辈': ['在拾掇老家的院子', '腰不太好，在调养', '在帮亲戚带孩子', '迷上了跳广场舞', '在操心家里装修', '在张罗一门亲戚的喜事'],
  '生意': ['店里生意淡，在发愁', '在看一个新铺面', '在跟供货的扯皮', '刚进了一批货', '在琢磨换个做法'],
  '通用': ['刚跟对象吵了架', '在考一个证', '在学车', '在相亲', '刚养了只猫', '在攒钱买车', '在减肥', '在找房子准备搬家', '家里有点事，焦头烂额', '最近迷上了钓鱼', '在装修新租的房子', '在追一部剧']
};
function busyKind(n) {
  const t = String(n.tie || '') + '|' + String(n.job || '');
  const age = num(n.age);
  if (/学生|大学|研究生|中学/.test(t)) return '学生';
  if ((KIN_TIE.test(t) && /妈|爸|父|母|爷|奶|外公|外婆|叔|伯|姨|舅|姑|婶/.test(t + n.name)) || age >= 52) return '长辈';
  if (/老板|店|摊|生意|个体/.test(t)) return '生意';
  if (/同事|上司|领导|公司|职员|工程师|运营|设计|销售|经理|主管|编辑/.test(t)) return '上班';
  return '';
}
function npcBusy(S, n, rng) {
  rng = rng || Math.random;
  const k = busyKind(n);
  const pool = (k ? BUSY[k] : []).concat(BUSY['通用']);
  const kids = /孩子|儿子|女儿/.test(String(n.note || '') + (n.facts || []).join('')) || num(n.age) >= 32;
  if (kids && k !== '学生') pool.push('在忙孩子的事', '孩子病了，在家陪着');
  let t = pick(rng, pool);
  if (n.busy && n.busy.t === t) t = pick(rng, pool);
  n.busy = { t, until: S.stats.days + rnd(rng, 18, 35) };
  return n.busy;
}
const TALK_BASE = {
  '长辈': '发长句，标点打全，爱用感叹号，偶尔一句话分好几段说，叫主角的小名或者全名',
  '上班': '说话客气，带"哈""辛苦了""收到"，事说清楚就停',
  '平辈': '短句，不爱打标点，一句话拆成几条连着发',
  '对象': '说话随意，带撒娇或者抱怨，会接着上次没说完的话'
};
const TALK_EXTRA = ['爱用"哈哈哈"', '爱回"嗯嗯""好嘞"', '说话直，不绕弯子', '爱用反问', '爱带一两个方言词', '爱发省略号', '爱用表情代替说话（写成[捂脸][笑哭]这种）', '话少，能一个字就不两个字', '爱开玩笑损人', '说话慢条斯理，爱讲道理'];
function hashStr(s) { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function talkOf(n) {
  const k = busyKind(n);
  const tie = String(n.tie || '');
  const base = /对象|爱人|老公|老婆|女朋友|男朋友|伴侣/.test(tie) ? '对象' : k === '长辈' ? '长辈' : /同事|上司|领导|老板|客户|房东|HR/.test(tie) ? '上班' : '平辈';
  return `${TALK_BASE[base]}；${TALK_EXTRA[hashStr(n.name) % TALK_EXTRA.length]}`;
}
function fixNpcLife(S, n, rng) {
  if (!n.talk) n.talk = talkOf(n);
  if (!n.busy || num(n.busy.until) <= S.stats.days) npcBusy(S, n, rng);
}

/* ---- 别人主动找你：约饭、吐槽、借东西、问件事 ---- */
const PING_TOPICS = [
  { t: '约饭', min: 2, w: 3, text: '最近有空没 出来吃个饭' },
  { t: '吐槽自己的事', min: 2, w: 3, text: '跟你说个事 气死我了' },
  { t: '问你件事', min: 1, w: 2, text: '在吗 问你个事' },
  { t: '借个东西', min: 2, w: 1, text: '你那有没有充电宝 借我用两天' },
  { t: '分享个东西', min: 3, w: 2, text: '刚看到个东西 想起你了' },
  { t: '约周末出去', min: 3, w: 2, text: '周末有安排没 出去转转' },
  { t: '问你近况', min: 2, w: 2, text: '最近咋样 好久没你消息了' }
];
function pingTick(S, rng) {
  if (S.stats.days - num(S.flags.pingDay) < 3 || rng() > 0.18) return null;
  const cand = S.npcs.filter(n => relTier(n.rel) >= 1 && S.stats.days - num(n.lastSeen) >= 3 && S.stats.days - num(n.pingDay) >= 10 && !/前任|前妻|前夫/.test(n.tie || ''));
  if (!cand.length) return null;
  const w = cand.map(n => relTier(n.rel) * relTier(n.rel) + 0.5);
  let r = rng() * w.reduce((a, b) => a + b, 0), n = cand[0];
  for (let i = 0; i < cand.length; i++) { r -= w[i]; if (r <= 0) { n = cand[i]; break; } }
  const tier = relTier(n.rel);
  const tops = PING_TOPICS.filter(x => tier >= x.min);
  let tw = tops.reduce((a, x) => a + x.w, 0) * rng(), tp = tops[0];
  for (const x of tops) { tw -= x.w; if (tw <= 0) { tp = x; break; } }
  fixNpcLife(S, n, rng);
  n.pingDay = S.stats.days; S.flags.pingDay = S.stats.days;
  S.pings = (S.pings || []).filter(p => S.stats.days - p.day <= 6).concat([{ who: n.name, topic: tp.t, busy: n.busy.t, day: S.stats.days, fall: tp.text }]).slice(-3);
  return { t: '人情', s: `${n.name}发消息来（${tp.t}）` };
}
// 写故事那一段没替他写那条消息：引擎补一条
function settlePings(S, msgs0) {
  const P = S.pings || [];
  for (const p of P) {
    const got = S.msgs.slice(msgs0).some(m => m.from === p.who && !m.me);
    if (!got) S.msgs.push({ from: p.who, text: p.fall, date: shortDate(S.date), kind: 'chat', read: false });
  }
  S.pings = [];
}

/* ---- 关系好的人主动帮忙 / 请柬 ---- */
const INVITES = ['结婚', '搬新家', '孩子满月', '开业'];
function helpTick(S, rng) {
  const p = S.player, L = S.ledger;
  const ev = [];
  // 账上见底：朋友、交心的人可能问一句，或者直接转一笔（算借）
  if (p.money < (L.rent + L.living) * 0.6 && S.stats.days - num(S.flags.helpDay) >= 20 && rng() < 0.05) {
    const c = S.npcs.filter(n => relTier(n.rel) >= 3 && !/前任|前妻|前夫/.test(n.tie || '')).sort((a, b) => b.rel - a.rel);
    const n = c[0] && (relTier(c[0].rel) === 4 || rng() < 0.5) ? c[0] : null;
    if (n) {
      S.flags.helpDay = S.stats.days;
      const city = CITIES[S.city] || CITIES['新一线'];
      const amt = Math.min(lendCap(S, n), Math.round(city.pay * (relTier(n.rel) === 4 ? 0.8 : 0.4) / 100) * 100);
      if (amt > 0 && rng() < 0.6) {
        const py = payIn(S, n.name, amt, '转账', '先拿着用 不急着还', 'help');
        if (py) { py.loan = 1; S.msgs.push({ from: n.name, text: '听说你最近紧 先拿着用 不急着还', date: shortDate(S.date), kind: 'chat', read: false, payId: py.id }); ev.push({ t: '人情', s: `${n.name}听说你手头紧，转来${py.amount}，说不急着还` }); }
      } else {
        S.msgs.push({ from: n.name, text: '最近手头是不是紧 有事你说话', date: shortDate(S.date), kind: 'chat', read: false });
        ev.push({ t: '人情', s: `${n.name}发消息问你手头紧不紧` });
      }
    }
  }
  // 介绍个活
  if (S.stats.days - num(S.flags.introDay) >= 45 && rng() < 0.012) {
    const c = S.npcs.filter(n => relTier(n.rel) >= 3);
    const n = c.length ? pick(rng, c) : null;
    if (n) {
      S.flags.introDay = S.stats.days;
      const gname = pick(rng, Object.keys(GIGS));
      S.gigOffer = { who: n.name, gig: gname, day: S.stats.days };
      S.msgs.push({ from: n.name, text: `我这有个${gname}的活 你要不要接`, date: shortDate(S.date), kind: 'chat', read: false });
      ev.push({ t: '机会', s: `${n.name}给你介绍了一个${gname}的活（${gigWhen(gname)}）` });
    }
  }
  // 请柬：熟人以上
  if (S.stats.days - num(S.flags.inviteDay) >= 40 && rng() < 0.008) {
    const c = S.npcs.filter(n => relTier(n.rel) >= 2 && !/前任|前妻|前夫/.test(n.tie || ''));
    const n = c.length ? pick(rng, c) : null;
    if (n) {
      S.flags.inviteDay = S.stats.days;
      const what = pick(rng, INVITES);
      const dt = addDays(S.date, rnd(rng, 6, 15));
      S.appts.push({ y: dt.y, m: dt.m, d: dt.d, title: `${n.name}${what}请吃饭`, kind: '随礼', done: false, wed: { who: n.name, what } });
      S.msgs.push({ from: n.name, text: `${dt.m}月${dt.d}号我${what} 请大家吃个饭 你一定来啊`, date: shortDate(S.date), kind: 'chat', read: false });
      ev.push({ t: '人情', s: `${n.name}${what}，${dt.m}月${dt.d}日请吃饭，叫了你` });
    }
  }
  return ev;
}
function giveLiJin(S, name, amount, what) {
  const n = npcByName(S, name);
  amount = Math.round(num(amount));
  if (!n) return { ok: false, why: '没有这个人' };
  if (amount < 0 || S.player.money < amount) return { ok: false, why: `账上只有${S.player.money}` };
  const city = CITIES[S.city] || CITIES['新一线'];
  if (amount) { S.player.money -= amount; acct(S, '随礼', -amount, `${n.name}${what || ''}`); }
  const g = amount ? r2(clamp(1.5 + amount / city.pay * 12, 1.5, 9) * TIER_GIFT[relTier(n.rel)]) : 0.5;
  n.rel = clamp(r2(n.rel + g), 0, 100); n.lastSeen = S.stats.days;
  npcMem(S, n, `${what || '办事'}那天主角来了${amount ? `，随了${amount}` : '，没随礼'}`);
  return { ok: true, gain: g, note: `去了${n.name}的${what || '饭局'}${amount ? `，随礼${amount}` : '，没随礼'}；关系+${g}，账上剩${S.player.money}` };
}

/* ---- 每天挂在日历上的 ---- */
function lifeTick(S, rng) {
  const ev = [];
  // 兼职：做了就记上，周日一起结
  const w = dOf(S.date).getDay();
  for (const g of gigToday(S)) {
    const G = GIGS[g.name];
    let pay = gigPay(S, g.name);
    if (G.vary) pay = Math.round(pay * (0.6 + rng() * 0.8) / 10) * 10;
    g.owed = num(g.owed) + pay; g.times = num(g.times) + 1;
  }
  if (w === 0) {
    for (const g of (S.gigs || [])) {
      if (!g.owed) continue;
      const m0 = S.player.money;
      S.player.money += g.owed;
      acct(S, `兼职·${g.name}`, g.owed, '这一周', m0);
      S.flags.monthNet += g.owed;
      g.total = num(g.total) + g.owed;
      ev.push({ t: '钱', s: `${g.name}这周挣了${g.owed}` });
      g.owed = 0;
    }
  }
  // 人物的日子自己往前走
  if (S.stats.days % 3 === 0) for (const n of S.npcs) if (n.busy && num(n.busy.until) <= S.stats.days && relTier(n.rel) >= 1) npcBusy(S, n, rng);
  if (S.gym && S.gym.until === S.stats.days) ev.push({ t: '身体', s: '健身月卡到期了' });
  const pg = pingTick(S, rng);
  if (pg) ev.push(pg);
  ev.push(...helpTick(S, rng));
  return ev;
}

function acctNote(S, item, note) {
  acct(S, item, 1, note);
  const rows = S.acct[acctKey(S.date)].rows;
  rows[rows.length - 1].amt = 0;
}
// 老存档补齐：住处档次、房租按新行情
function fixLife(S) {
  S.home = S.home || { kind: '租', since: '', place: '' };
  if (!S.home.tier) S.home.tier = '合租次卧';
  if (S.job && S.job.strain === undefined) S.job.strain = 1;
  S.gigs = S.gigs || []; S.bag = S.bag || []; bankOf(S);
  if (S.job && S.job.sinceDay === undefined) S.job.sinceDay = 0;
  if (!S.flags.rent2 && S.home.kind !== '买') {
    S.flags.rent2 = 1;
    const r = rentFor(S, homeTier(S));
    if (num(S.ledger.rent) && r < S.ledger.rent) {
      S.flags.rentAdj = { from: S.ledger.rent, to: r };
      S.ledger.rent = r;
    }
  }
  S.flags.rent2 = 1;
  for (const n of S.npcs) if (!n.talk) n.talk = talkOf(n);
  return S;
}


/* ================= 银行：存款、理财、贷款、征信 ================= */
const DEPO = { 3: 0.008, 12: 0.011, 36: 0.015 };        // 定期：月数 → 年利率
const CUR_RATE = 0.001, MMF_RATE = 0.015;
const LOANS = {
  '信用贷': { lo: 0.04, hi: 0.09, terms: [12, 24, 36], fee: 0.01 },
  '消费贷': { lo: 0.09, hi: 0.14, terms: [12], fee: 0.01 },
  '经营贷': { lo: 0.05, hi: 0.08, terms: [36], fee: 0 }
};
function bankOf(S) {
  if (!S.bank) S.bank = { fixed: [], mmf: 0, mmfGain: 0, wm: [], fund: { units: 0, cost: 0, mark: 0 }, nav: 1, loans: [], credit: 60, curAcc: 0, id: 0 };
  return S.bank;
}
function creditWord(c) { return c >= 80 ? '很好' : c >= 65 ? '良好' : c >= 50 ? '一般' : c >= 35 ? '有污点' : '很差'; }
function jobTenure(S) { return S.job && !S.job.out ? S.stats.days - num(S.job.sinceDay) : 0; }
const mPay = (P, rate, n) => { const r = rate / 12; return r ? Math.round(P * r / (1 - Math.pow(1 + r, -n))) : Math.round(P / n); };
// 能贷多少、多少利息：月薪、在职多久、口碑、征信
function loanQuote(S, kind) {
  const B = bankOf(S), L = LOANS[kind];
  if (!L) return { ok: false, why: '没有这种贷款' };
  const f = clamp((B.credit - 40) / 50, 0, 1);
  const rep = clamp(num(S.player.信誉) / 100, 0, 0.6);
  const sal = num(S.ledger.salary);
  const owing = B.loans.filter(x => x.kind === kind && x.left > 0).reduce((a, x) => a + x.left, 0);
  let cap = 0, why = '';
  if (B.credit < 35) why = '征信太差，银行不批';
  else if (kind === '信用贷') {
    if (S.job.out || !sal) why = '没有工作，信用贷批不下来';
    else if (jobTenure(S) < 180) why = `这份工作才干了${jobTenure(S)}天，要满半年`;
    else cap = sal * (3 + 7 * f) * (1 + rep * 0.3);
  } else if (kind === '消费贷') {
    const inc = sal + (S.biz && !S.biz.dead ? Math.max(0, num(S.biz.net)) : 0) + (S.gigs || []).length * 600;
    if (!inc) why = '没有收入，消费贷也批不下来';
    else cap = Math.min(50000, Math.max(5000, inc * 3));
  } else if (kind === '经营贷') {
    if (!S.biz || S.biz.dead) why = '手上没有在开的店';
    else cap = num(S.biz.setup) * 1.5;
  }
  cap = Math.max(0, Math.round((cap - owing) / 1000) * 1000);
  if (!why && cap < 1000) why = '额度已经用完了';
  const rate = r2((L.hi - (L.hi - L.lo) * f) * 1000) / 1000;
  return { ok: !why, why, cap, rate, terms: L.terms, kind };
}
function takeLoan(S, kind, amount, months) {
  const q = loanQuote(S, kind);
  if (!q.ok) return { ok: false, why: q.why, q };
  amount = Math.round(num(amount) / 100) * 100;
  if (amount <= 0) return { ok: false, why: '金额不对' };
  const cut = amount > q.cap;
  amount = Math.min(amount, q.cap);
  months = q.terms.includes(num(months)) ? num(months) : q.terms[0];
  const B = bankOf(S);
  B.id++;
  const ln = { id: B.id, kind, amount, left: amount, rate: q.rate, months, paid: 0, monthly: mPay(amount, q.rate, months), owe: 0, late: 0, date: shortDate(S.date) + `（${S.date.y}年）` };
  B.loans.push(ln);
  S.player.money += amount;
  acct(S, `${kind}到账`, amount, `${months}个月，年利率${(q.rate * 100).toFixed(1)}%`);
  return { ok: true, loan: ln, cut, note: `${kind}批下来${amount}元${cut ? '（额度只有这么多）' : ''}，${months}个月，年利率${(q.rate * 100).toFixed(1)}%，每月还${ln.monthly}，账上${S.player.money}` };
}
function prepay(S, id, amount) {
  const B = bankOf(S), ln = B.loans.find(x => x.id === id && x.left > 0);
  if (!ln) return { ok: false, why: '没有这笔贷款' };
  amount = Math.min(Math.round(num(amount)), ln.left);
  const fee = Math.round(amount * (LOANS[ln.kind] ? LOANS[ln.kind].fee : 0));
  if (amount <= 0) return { ok: false, why: '金额不对' };
  if (S.player.money < amount + fee) return { ok: false, why: `要${amount + fee}（含违约金${fee}），账上只有${S.player.money}` };
  S.player.money -= amount + fee;
  acct(S, `提前还${ln.kind}`, -(amount + fee), fee ? `含违约金${fee}` : '');
  ln.left -= amount;
  const rest = ln.months - ln.paid;
  ln.monthly = ln.left > 0 ? mPay(ln.left, ln.rate, Math.max(1, rest)) : 0;
  return { ok: true, fee, left: ln.left, note: `提前还了${ln.kind}${amount}${fee ? `，违约金${fee}` : ''}，${ln.left ? `还欠${ln.left}，每月${ln.monthly}` : '还清了'}` };
}
// 定期
function deposit(S, amount, term) {
  amount = Math.round(num(amount));
  term = DEPO[num(term)] ? num(term) : 12;
  if (amount < 100) return { ok: false, why: '最少存一百' };
  if (S.player.money < amount) return { ok: false, why: `账上只有${S.player.money}` };
  const B = bankOf(S);
  B.id++;
  const due = addDays(S.date, Math.round(term * 30.4));
  B.fixed.push({ id: B.id, amount, term, rate: DEPO[term], day: S.stats.days, dueDay: S.stats.days + Math.round(term * 30.4), due: shortDate(due) + `（${due.y}年）` });
  S.player.money -= amount;
  acct(S, `存定期${term === 36 ? '三年' : term === 12 ? '一年' : '三个月'}`, -amount);
  return { ok: true, note: `存了${amount}定期，${term}个月，年利率${(DEPO[term] * 100).toFixed(1)}%，${shortDate(due)}到期` };
}
function withdrawFixed(S, id) {
  const B = bankOf(S), i = B.fixed.findIndex(x => x.id === id);
  if (i < 0) return { ok: false, why: '没有这笔定期' };
  const f = B.fixed.splice(i, 1)[0];
  const early = S.stats.days < f.dueDay;
  const days = Math.max(0, S.stats.days - f.day);
  const int = Math.round(f.amount * (early ? CUR_RATE : f.rate) * (early ? days / 365 : f.term / 12));
  S.player.money += f.amount + int;
  acct(S, early ? '定期提前取出' : '定期到期', f.amount + int, `利息${int}`);
  return { ok: true, early, int, note: `${early ? '提前取出' : '到期取出'}定期${f.amount}，利息${int}${early ? '（提前取只算活期）' : ''}` };
}
// 理财
function invest(S, kind, amount, rng) {
  rng = rng || Math.random;
  amount = Math.round(num(amount));
  if (amount < 100) return { ok: false, why: '最少一百' };
  if (S.player.money < amount) return { ok: false, why: `账上只有${S.player.money}` };
  const B = bankOf(S);
  S.player.money -= amount;
  if (kind === '货币基金') { B.mmf = r2(B.mmf + amount); acct(S, '买货币基金', -amount); return { ok: true, note: `${amount}放进了货币基金，年化1.5%上下，随取随用` }; }
  if (kind === '银行理财') {
    B.id++;
    const rate = r2((0.025 + rng() * 0.007) * 1000) / 1000;
    B.wm.push({ id: B.id, amount, rate, day: S.stats.days, dueDay: S.stats.days + 90, due: shortDate(addDays(S.date, 90)) });
    acct(S, '买银行理财', -amount, `90天，业绩基准${(rate * 100).toFixed(1)}%`);
    return { ok: true, note: `买了${amount}银行理财，锁90天，业绩基准年化${(rate * 100).toFixed(1)}%` };
  }
  if (kind === '股票基金') {
    const edge = S.player.track === '投资' ? Math.min(0.02, num(S.player.attrs['专业']) / 3000) : 0;
    const units = amount / (B.nav * (1 - edge));
    B.fund.units = r2(B.fund.units + units); B.fund.cost = Math.round(B.fund.cost + amount);
    if (!B.fund.mark) B.fund.mark = B.fund.cost;
    acct(S, '买股票基金', -amount, `净值${B.nav.toFixed(3)}`);
    return { ok: true, note: `买了${amount}股票基金，净值${B.nav.toFixed(3)}${edge ? '，挑的点位不错' : ''}` };
  }
  S.player.money += amount;
  return { ok: false, why: '没有这种理财' };
}
function fundValue(S) { const B = bankOf(S); return Math.round(B.fund.units * B.nav); }
function redeem(S, kind, amount) {
  const B = bankOf(S);
  if (kind === '货币基金') {
    amount = Math.min(Math.round(num(amount)) || Math.floor(B.mmf), Math.floor(B.mmf));
    if (amount <= 0) return { ok: false, why: '货币基金里没钱' };
    B.mmf = r2(B.mmf - amount); S.player.money += amount; acct(S, '取货币基金', amount);
    return { ok: true, note: `从货币基金取了${amount}` };
  }
  if (kind === '股票基金') {
    const val = fundValue(S);
    if (val <= 0) return { ok: false, why: '没有股票基金' };
    const want = Math.min(Math.round(num(amount)) || val, val);
    const part = want / val;
    const cost = Math.round(B.fund.cost * part);
    const fee = Math.round(want * 0.005);
    B.fund.units = r2(B.fund.units * (1 - part)); B.fund.cost -= cost;
    if (B.fund.units < 0.01) { B.fund = { units: 0, cost: 0, mark: 0 }; }
    else B.fund.mark = B.fund.cost;
    S.player.money += want - fee;
    acct(S, '卖股票基金', want - fee, `${want - cost >= 0 ? '赚' : '亏'}${Math.abs(want - cost)}，手续费${fee}`);
    return { ok: true, gain: want - cost, note: `卖了${want}股票基金，${want - cost >= 0 ? '赚了' : '亏了'}${Math.abs(want - cost)}，手续费${fee}` };
  }
  return { ok: false, why: '这个不能随时取' };
}
// 每天挂在日历上
function bankTick(S, rng) {
  const B = bankOf(S), p = S.player, ev = [];
  let stop = null;
  if (p.money > 0) B.curAcc += p.money * CUR_RATE / 365;
  if (B.mmf > 0) { const g = B.mmf * MMF_RATE / 365 * (0.85 + rng() * 0.3); B.mmf = r2(B.mmf + g); B.mmfGain = r2(B.mmfGain + g); }
  // 季度末结活期息
  if ([3, 6, 9, 12].includes(S.date.m) && S.date.d === 21 && B.curAcc >= 1) {
    const int = Math.round(B.curAcc); B.curAcc = 0;
    p.money += int; acct(S, '活期利息', int);
  }
  for (const f of B.fixed.slice()) if (S.stats.days >= f.dueDay) { const r = withdrawFixed(S, f.id); ev.push({ t: '钱', s: r.note.replace('到期取出', '到期了，转回账上：') }); }
  for (const w of B.wm.slice()) if (S.stats.days >= w.dueDay) {
    const lose = rng() < 0.03;
    const back = Math.round(w.amount * (1 + (lose ? -rng() * 0.005 : w.rate * 90 / 365)));
    B.wm = B.wm.filter(x => x.id !== w.id);
    p.money += back; acct(S, '银行理财到期', back, `本金${w.amount}`);
    ev.push({ t: '钱', s: `银行理财到期，${w.amount}变成${back}${lose ? '，没达到业绩基准' : ''}` });
  }
  // 股票基金：每周走一步，跟风向挂钩
  if (dOf(S.date).getDay() === 5) {
    const mood = (S.wind && S.wind.mood) || '平';
    const mu = 0.001 + (mood === '热' ? 0.002 : mood === '冷' ? -0.002 : 0) - ((S.era || []).length ? 0.0005 : 0);
    const z = (rng() + rng() + rng() + rng() - 2) * 1.73;
    B.nav = Math.max(0.3, r2((B.nav * (1 + mu + z * 0.021)) * 1000) / 1000);
    if (B.fund.units > 0) {
      const val = fundValue(S), mark = B.fund.mark || B.fund.cost;
      const ch = (val - mark) / Math.max(1, mark);
      if (Math.abs(ch) >= 0.2 && B.fund.cost >= 3000) {
        B.fund.mark = val;
        stop = { kind: '钱', detail: `股票基金${ch > 0 ? '涨' : '跌'}了一大截，眼下值${val}（本金${B.fund.cost}）` };
      }
    }
  }
  return { ev, stop };
}
// 每月 1 号扣月供，挂在 moneyTick 里
function loanTick(S) {
  const B = bankOf(S), p = S.player, ev = [];
  let stop = null;
  for (const ln of B.loans) {
    if (ln.left <= 0) continue;
    const due = ln.monthly + ln.owe;
    if (p.money >= due) {
      p.money -= due;
      acct(S, `${ln.kind}月供`, -due, ln.owe ? '含之前欠的' : '');
      for (let k = 0; k < 1 + (ln.owe ? Math.round(ln.owe / ln.monthly) : 0); k++) {
        const int = Math.round(ln.left * ln.rate / 12);
        ln.left = Math.max(0, ln.left - Math.max(0, ln.monthly - int));
        ln.paid++;
      }
      if (ln.paid >= ln.months) ln.left = 0;
      ln.owe = 0; ln.late = 0;
      B.credit = clamp(r2(B.credit + 0.4), 0, 95);
      if (!ln.left) ev.push({ t: '钱', s: `${ln.kind}还清了` });
    } else {
      ln.late++;
      ln.owe += ln.monthly;
      if (ln.late >= 2) ln.owe += Math.round(ln.monthly * 0.05);     // 罚息
      B.credit = clamp(B.credit - (ln.late >= 3 ? 12 : 6), 0, 95);
      if (ln.late === 1) ev.push({ t: '钱', s: `${ln.kind}这个月的月供${ln.monthly}没扣出来，银行发了短信` });
      else if (ln.late === 2) ev.push({ t: '钱', s: `${ln.kind}连着两个月没还上，开始算罚息` });
      else stop = { kind: '钱', detail: `${ln.kind}连着${ln.late}个月没还，银行打电话来催收，欠着${ln.owe}` };
    }
  }
  B.loans = B.loans.filter(x => x.left > 0 || S.stats.days - num(x.endDay || S.stats.days) < 60).map(x => { if (!x.left && !x.endDay) x.endDay = S.stats.days; return x; });
  return { ev, stop };
}
function bankLine(S) {
  const B = bankOf(S), a = [];
  const fx = B.fixed.reduce((s, f) => s + f.amount, 0);
  if (fx) a.push(`定期${fx}`);
  if (B.mmf >= 1) a.push(`货币基金${Math.floor(B.mmf)}`);
  const wm = B.wm.reduce((s, w) => s + w.amount, 0);
  if (wm) a.push(`银行理财${wm}（锁着）`);
  if (B.fund.units > 0) { const v = fundValue(S); a.push(`股票基金眼下值${v}（本金${B.fund.cost}，${v >= B.fund.cost ? '赚' : '亏'}${Math.abs(v - B.fund.cost)}）`); }
  const L = B.loans.filter(x => x.left > 0);
  for (const l of L) a.push(`${l.kind}还欠${l.left}，每月还${l.monthly}${l.late ? `，已经逾期${l.late}个月` : ''}`);
  a.push(`征信${creditWord(B.credit)}`);
  return a.join('；');
}

/* ---- 一天里能就地办事的空档：白天、晚上两个 ---- */
function slotsLeft(S) { const D = S.daySlots; return D && D.day === S.stats.days ? Math.max(0, 2 - D.used) : 2; }
function useSlot(S) {
  if (!S.daySlots || S.daySlots.day !== S.stats.days) S.daySlots = { day: S.stats.days, used: 0 };
  if (S.daySlots.used >= 2) return false;
  S.daySlots.used++;
  return true;
}


/* ---------- 老存档补齐：缺什么照新开局的样子补上，已有的一样不动 ---------- */
const MERGE_DEEP = ['player', 'ledger', 'job', 'flags', 'stats', 'home', 'family', 'schedule', 'ideal'];
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function migrate(S) {
  if (!isObj(S) || !isObj(S.player)) return null;
  const p0 = S.player;
  const tpl = newState({ name: p0.name, gender: p0.gender, city: CITIES[S.city] ? S.city : '新一线', origin: ORIGINS[S.origin] ? S.origin : '普通家庭',
    track: TRACKS[p0.track] ? p0.track : '职场', freedom: FREEDOM[S.freedom] ? S.freedom : '都市传奇', startYear: (S.startDate && S.startDate.y) || (S.date && S.date.y) || 2026 });
  if (!CITIES[S.city]) S.city = '新一线';
  if (!ORIGINS[S.origin]) S.origin = '普通家庭';
  if (!FREEDOM[S.freedom]) S.freedom = '都市传奇';
  const hadRent2 = !!(S.flags && S.flags.rent2);           // 房租按新行情调过没有：老存档没调过，别让模板顶掉
  for (const k in tpl) {
    if (S[k] === undefined || S[k] === null && tpl[k] !== null) { S[k] = tpl[k]; continue; }
    if (MERGE_DEEP.includes(k) && isObj(S[k]) && isObj(tpl[k])) {
      for (const k2 in tpl[k]) if (S[k][k2] === undefined) S[k][k2] = tpl[k][k2];
    }
    if (Array.isArray(tpl[k]) && !Array.isArray(S[k])) S[k] = tpl[k];
  }
  if (!hadRent2) delete S.flags.rent2;
  const p = S.player;
  if (!TRACKS[p.track]) p.track = '职场';
  for (const a of ATTRS) { p.attrs[a] = num(p.attrs[a]) || 20; if (p.attrF[a] === undefined) p.attrF[a] = p.attrs[a]; }
  for (const k of ['money', 'energy', '信誉', '人品', 'age']) p[k] = num(p[k]);
  if (!p.age) p.age = 22;
  for (const k of ['rent', 'living', 'remit', 'subsidy', 'salary', 'loan', 'base']) S.ledger[k] = num(S.ledger[k]);
  if (!isObj(S.date) || !num(S.date.y)) S.date = Object.assign({}, S.startDate || tpl.date);
  if (!isObj(S.startDate)) S.startDate = Object.assign({}, S.date);
  if (!isObj(S.schedule.work)) S.schedule.work = Object.assign({}, DEF_SCHEDULE.work);
  if (!isObj(S.schedule.rest)) S.schedule.rest = Object.assign({}, DEF_SCHEDULE.rest);
  if (!Array.isArray(S.ideal.stages)) S.ideal.stages = [];
  for (const st of S.ideal.stages) if (!Array.isArray(st.milestones)) st.milestones = [];
  for (const st of S.ideal.stages) {
    st.milestones = st.milestones.filter(m => m.done || !isSocialMile(m));
    for (const m of st.milestones) if (!METRICS[m.metric]) m.metric = '投入';
  }
  S.ideal.stages = S.ideal.stages.filter(st => st.milestones.length);
  if (!Array.isArray(S.family.kids)) S.family.kids = [];
  S.npcs = S.npcs.filter(n => isObj(n) && n.name);
  for (const n of S.npcs) {
    n.name = String(n.name); n.rel = num(n.rel);
    if (!Array.isArray(n.mem)) n.mem = [];
    if (!Array.isArray(n.facts)) n.facts = [];
    if (n.tie === undefined) n.tie = '认识的人';
  }
  S.chapters = S.chapters.filter(x => typeof x === 'string');
  S.msgs = S.msgs.filter(isObj);
  S.debts = S.debts.filter(d => isObj(d) && d.due);
  S.appts = S.appts.filter(isObj);
  if (S.convo && !Array.isArray(S.convo.lines)) S.convo = null;
  if (S.key && (!S.key.opp || !Array.isArray(S.key.log))) S.key = null;
  if (S.pending && !S.pending.prompt) S.pending = null;
  if (S.plan && !Array.isArray(S.plan.steps)) S.plan = null;
  S.v = SAVE_VERSION;
  fixJob(S);
  fixPace(S);
  fixWho(S);
  return S;
}


/* ================= 出身的后手、位置、地位 ================= */
const SURN = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '胡', '朱', '郭', '何', '罗', '高', '林', '郑', '梁', '谢', '宋', '唐', '许', '邓', '冯', '韩', '曹'];
const GIVEN_M = ['建国', '国强', '志刚', '卫东', '德胜', '海涛', '永福', '振华', '立军', '宏伟', '长青', '文斌', '树林', '庆丰'];
const GIVEN_F = ['秀兰', '玉梅', '桂英', '丽华', '春燕', '淑芬', '红霞', '晓梅', '海燕', '静'];
function genName(rng, female) { return pick(rng, SURN) + pick(rng, female ? GIVEN_F : GIVEN_M); }
// 起手的熟人：建档写死
function originNpc(S, rng) {
  const O = ORIGINS[S.origin];
  if (!O || !O.npc) return null;
  const x = O.npc;
  let name = genName(rng, !!x.female);
  for (let i = 0; i < 5 && S.npcs.some(n => n.name === name); i++) name = genName(rng, !!x.female);
  addNpcs(S, [{ name, age: x.age, job: x.job, tie: x.tie, note: x.note, care: x.care || '', rel: x.rel, close: !!x.close, gender: x.female ? '女' : '男' }], 1);
  const n = S.npcs.find(v => v.name === name);
  if (n) { addFact(n, x.fact); n.origin = 1; }
  return n;
}
// 隔一阵掷一次的家里事
function originTick(S, rng) {
  const O = ORIGINS[S.origin];
  if (!O || !O.risk || S.stats.days - num(S.flags.originDay) < 150) return null;
  if (rng() > O.risk.p / 365) return null;
  S.flags.originDay = S.stats.days;
  const r = O.risk;
  if (r.cut) { S.ledger.subsidy = 0; }
  if (r.rep) S.player.信誉 = clamp(S.player.信誉 + r.rep, 0, 100);
  if (r.money) { S.player.money -= r.money; acct(S, '家里的事', -r.money, r.text.slice(0, 20)); }
  return { kind: '家里', detail: r.text };
}
function originEase(S, kind) {
  const O = ORIGINS[S.origin];
  if (!O || !O.ease) return 0;
  const track = S.player.track;
  return num(O.ease[track]) + (kind === 'job' ? num(O.ease.job) : 0);
}
function originBlocked(S, jobName) {
  const O = ORIGINS[S.origin];
  return !!(O && O.block && O.block.test(jobName));
}

/* ---- 位置表 ---- */
const RANKS = {
  '从政': ['科员', '副科', '正科', '副处', '正处', '副厅', '正厅', '副部', '正部', '副国', '正国'],
  '职场': ['新人', '专员', '主管', '经理', '总监', '副总', '总经理', '董事长'],
  '行医': ['规培', '住院医', '主治', '副主任医师', '主任医师', '科主任', '副院长', '院长', '卫健系统的头'],
  '教书': ['助教', '讲师', '副教授', '教授', '博导', '院长', '副校长', '校长'],
  '科研': ['研究助理', '助理研究员', '副研究员', '研究员', '学科带头人', '所长', '院士'],
  '法律': ['律师助理', '律师', '资深律师', '合伙人', '高级合伙人', '律所主任', '行业泰斗'],
  '捞偏门': ['跑腿的', '马仔', '小头目', '管一摊', '大哥', '老大', '一方枭雄'],
  '生意': ['打工的', '小老板', '老板', '有几家店', '有名的老板', '企业家', '商界大佬'],
  '名气': ['素人', '小有名气', '圈里有名', '腰部', '头部', '大腕', '家喻户晓'],
  '公益': ['志愿者', '干事', '项目负责人', '机构负责人', '圈里有名', '行业标杆'],
  '回乡': ['回乡青年', '种植户', '合作社带头人', '村干部', '乡里能人', '县里的名人'],
  '通用': ['普通人', '有点本事', '有点头脸', '人物', '大人物']
};
const JOB_LADDER = { '从政': '从政', '行医': '行医', '教书': '教书', '科研': '科研', '法律': '法律' };
const FIELD_LADDER = { '捞偏门': '捞偏门', '创业': '生意', '手艺': '生意', '做博主': '名气', '表演': '名气', '创作': '名气', '体育': '名气', '公益': '公益', '回乡': '回乡' };
function jobLadder(S) { return JOB_LADDER[S.player.track] || '职场'; }
function jobMax(S) { return RANKS[jobLadder(S)].length - 1; }
function jobTitle(S, lv) { const R = RANKS[jobLadder(S)]; return R[clamp(Math.round(num(lv === undefined ? S.job.lv : lv)), 0, R.length - 1)]; }
// 体制内工资涨得慢；其他照职级倍数
function payMul(S, lv) {
  lv = clamp(Math.round(num(lv)), 0, LEVELS.length - 1);
  return jobLadder(S) === '从政' ? 1 + lv * 0.3 : LEVELS[lv].pay;
}
// 圈子里的位置：不挂在工作上的赛道
function fieldLadder(S) { return FIELD_LADDER[S.player.track] || ''; }
function fieldIdx(S) {
  const L = fieldLadder(S);
  if (!L) return 0;
  const max = RANKS[L].length - 1;
  if (L === '生意') {
    const B = S.biz && !S.biz.dead ? S.biz : null;
    if (!B) return 0;
    const t = num(B.total);
    return t > 1e7 ? 6 : t > 2e6 ? 5 : t > 5e5 ? 4 : (B.staff.length >= 3 && num(B.rep) >= 55) ? 3 : B.staff.length >= 1 ? 2 : 1;
  }
  const all = S.ideal.stages.reduce((a, st) => a + st.milestones.length, 0);
  const done = S.ideal.stages.reduce((a, st) => a + st.milestones.filter(m => m.done).length, 0);
  return all ? clamp(Math.round(done / all * max), 0, max) : 0;
}
// 主角眼下的位置：单位里一个，圈子里一个（挂在工作上的赛道两个是一回事）
function posOf(S) {
  const jl = jobLadder(S), jIdx = clamp(num(S.job.lv), 0, jobMax(S));
  const job = { ladder: jl, idx: jIdx, max: jobMax(S), title: RANKS[jl][jIdx], out: !!S.job.out, org: S.job.employer || '' };
  const fl = fieldLadder(S);
  const field = fl ? { ladder: fl, idx: fieldIdx(S), max: RANKS[fl].length - 1, title: RANKS[fl][fieldIdx(S)] } : null;
  return { job, field };
}
// 在世人眼里：底层、普通人、有点头脸、人物、大人物
const BANDS = ['底层', '普通人', '有点头脸', '人物', '大人物'];
const BAND_FLOOR = { '从政': [[8, 4], [6, 3], [4, 2], [2, 1]], '职场': [[6, 3], [4, 2], [2, 1]], '行医': [[6, 3], [4, 2]], '教书': [[6, 3], [4, 2]], '科研': [[5, 3], [3, 2]], '法律': [[5, 3], [3, 2]] };
function standing(S) {
  const P = posOf(S);
  const jr = P.job.out ? P.job.idx / P.job.max * 0.6 : P.job.idx / P.job.max;
  const fr = P.field ? P.field.idx / P.field.max : 0;
  const ratio = Math.max(jr, fr);
  let score = ratio * 55 + selfLevel(S) * 0.45;
  if (S.broke) score -= 10;
  let b = score >= 75 ? 4 : score >= 55 ? 3 : score >= 33 ? 2 : score >= 14 ? 1 : 0;
  if (ratio >= 0.999) b = 4; else if (ratio >= 0.8) b = Math.max(b, 3); else if (ratio >= 0.5) b = Math.max(b, 2);
  // 有些位置本身就压得住人：正厅在一个市里就是人物
  if (!P.job.out) for (const [i, v] of (BAND_FLOOR[P.job.ladder] || [])) if (P.job.idx >= i) { b = Math.max(b, v); break; }
  return b;
}
// 位置有变：记下来，原来的上级落到主角之下的，记一条
function posKey(S) { const P = posOf(S); return `${P.job.out ? '待业' : P.job.title}|${P.field ? P.field.title : ''}`; }
// 档位跟着存款晃：往上只认创了新高，往下要掉两档才算
function bandMove(S) {
  const b = standing(S);
  if (S.bandHi === undefined) { S.bandHi = b; S.bandNow = b; return null; }
  const was = S.bandNow;
  if (b > S.bandHi || b <= S.bandHi - 2) { S.bandHi = b; S.bandNow = b; return b !== was ? [BANDS[was], BANDS[b]] : null; }
  return null;
}
function notePos(S) {
  const k = posKey(S);
  const old = S.posSnap;
  S.posSnap = k;
  const band = bandMove(S);
  if ((!old || old === k) && !band) return null;
  const [oj, of] = (old || k).split('|'), [nj, nf] = k.split('|');
  const ch = { day: S.stats.days, from: [], to: [], band };
  if (oj !== nj) { ch.from.push(oj); ch.to.push(nj); }
  if (of !== nf) { ch.from.push(of); ch.to.push(nf); }
  if (!ch.from.length && !ch.band) return null;
  S.posChange = ch;
  // 原来比主角高、现在不高了的人
  const P = posOf(S);
  for (const n of S.npcs) {
    if (n.lv == null || !n.circle) continue;
    const mine = n.circle === 'work' ? P.job.idx : P.field ? P.field.idx : null;
    if (mine == null) continue;
    const was = n.circle === 'work' ? num(S.posIdx && S.posIdx.job) : num(S.posIdx && S.posIdx.field);
    if (n.lv > was && n.lv <= mine) {
      addFact(n, n.lv === mine ? '原来是主角的上级，现在跟主角平级了' : '原来是主角的上级，现在在主角之下');
      if (/领导|上司|老板|处长|科长|主任|经理|总监|大哥|师傅/.test(n.tie || '') && n.lv < mine) n.tie = ('老' + String(n.tie).replace(/^老/, '')).slice(0, 12);
    }
  }
  S.posIdx = { job: P.job.idx, field: P.field ? P.field.idx : 0 };
  return ch;
}
function posTick(S) {
  if (!S.posSnap) { S.posSnap = posKey(S); bandMove(S); const P = posOf(S); S.posIdx = { job: P.job.idx, field: P.field ? P.field.idx : 0 }; return null; }
  const ch = notePos(S);
  if (!ch) return null;
  const what = ch.from.length ? `从${ch.from.join('、')}到${ch.to.join('、')}` : '';
  return { kind: '身份', detail: [what, ch.band ? `在别人眼里从「${ch.band[0]}」成了「${ch.band[1]}」` : ''].filter(Boolean).join('；') };
}
// 人物跟主角的高低
function npcGap(S, n) {
  if (!n || n.lv == null || !n.circle) return null;
  const P = posOf(S);
  if (n.circle === 'work') { if (P.job.out) return null; return num(n.lv) - P.job.idx; }
  if (n.circle === 'field') { const f = P.field || P.job; return num(n.lv) - f.idx; }
  return null;
}
function gapWord(g) {
  if (g == null) return '';
  if (g >= 2) return `比主角高${g}级，是主角上面的人`;
  if (g === 1) return '比主角高一级，是主角的直接上级';
  if (g === 0) return '跟主角平级';
  if (g === -1) return '比主角低一级，见了主角要敬着';
  return `比主角低${-g}级，在主角面前小心翼翼`;
}
// 你上面是谁、下面是谁
function chainOf(S) {
  const P = posOf(S);
  const work = S.npcs.filter(n => n.circle === 'work' && n.lv != null);
  const up = work.filter(n => n.lv > P.job.idx).sort((a, b) => a.lv - b.lv);
  const down = work.filter(n => n.lv < P.job.idx).sort((a, b) => b.lv - a.lv);
  return { up, down, top: P.job.idx >= P.job.max, out: P.job.out };
}
// 模型报的位置：给了级别就认；没给按名字对位置表
function lvFromPos(S, pos, circle) {
  const L = circle === 'work' ? RANKS[jobLadder(S)] : RANKS[fieldLadder(S) || jobLadder(S)];
  const t = String(pos || '');
  let best = -1, bl = 0;
  L.forEach((r, i) => { if (t.indexOf(r) >= 0 && r.length > bl) { best = i; bl = r.length; } });
  if (best < 0 && circle === 'work' && jobLadder(S) === '从政') {
    const m = [[/副国级/, 9], [/正国级|国家领导/, 10], [/副部级|副部长|副省长/, 7], [/部长|省长|省委书记/, 8], [/副厅|副市长|副局长/, 5], [/厅长|市长|市委书记/, 6], [/副处|副县长/, 3], [/处长|县长|县委书记|区长/, 4], [/副科|副镇长|副乡长/, 1], [/科长|镇长|乡长|镇党委书记/, 2]];
    for (const [re, v] of m) if (re.test(t)) return v;
  }
  return best >= 0 ? best : null;
}
function setNpcPos(S, n, x, fresh) {
  const circle = x.circle === 'work' || x.circle === 'field' ? x.circle : (fresh ? '' : n.circle || '');
  if (x.pos) n.pos = String(x.pos).slice(0, 16);
  if (circle) n.circle = circle;
  if (!n.circle) return;
  const max = n.circle === 'work' ? jobMax(S) : RANKS[fieldLadder(S) || jobLadder(S)].length - 1;
  let lv = x.lv != null && x.lv !== '' && Number.isFinite(Number(x.lv)) ? clamp(Math.round(Number(x.lv)), 0, max) : lvFromPos(S, x.pos || n.pos, n.circle);
  if (lv == null) return;
  if (n.lv == null || fresh) n.lv = lv;
  else if (lv !== n.lv) n.lv = clamp(n.lv + Math.sign(lv - n.lv), 0, max);   // 人物升降一次只认一级
}

/* ---------- 导出 ---------- */
const API = {
  SAVE_VERSION, EDUS, SCHOOLS, MAJORS, PERSONAS, LOOKS, bgEffect, bgLine, ORIGINS, CITIES, FREEDOM, TRACKS, SLOTS, ACTS, ATTRS, SLEEP_EN, DEF_SCHEDULE, PACES, setPace, fixPace, acct, acctKey, EVT_TAGS,
  npcMem, markIntimate, lovers, whoIs, fixWho, guessGender, num, clamp, r2, mkRng, d20, rollMod, rnd, pick, fateInfo, applyFate, fdm,
  dOf, fromDate, addDays, wdOf, isRest, dateStr, shortDate, daysBetween, festivalOf,
  newState, todayPlan, dayTick, moneyTick, peerTick, npcTick, advance, settleFocus, applyConvo,
  rollCheck, attrVal, applyTurn, addNpcs, growAttr, fixJob,
  addMoment, likeMoment, commentMoment, unreadMoments, momentRel, addLiker,
  simRatio, stuckLevel, pickNudge, capMoney, bandNeed, NEED_BAND,
  housePrice, canBuy, buyHouse, homeWorth, partnerOf, startRomance, marry, breakUp, wantKid, familyTick, kidCost, kidsGrow, kidStage,
  scoreLines, endReason, endingScore, keepGoing,
  migrate,
  BIZ_KINDS, bizSetup, bizBase, openBiz, bizCandidates, hireBiz, fireBiz, raiseBiz, bizMonth, closeBiz, madeName,
  PEER_MOVES, PEER_HOOK, selfLevel, peerWord,
  WIND, ERA, windMul, windTick, yearSnap, yearDiff,
  RIFT_KINDS, addRift, easeRift, riftTick, noteAil, chronicLoad, energyCap,
  LEVELS, jobLv, nextReview, jobTick, review, quitJob, takeJob, addDebt, debtTick, payDebt,
  METRICS, SCENES, OPP_TYPES, MOVES, normLadder, curMile, mileStat, ladderBlock, judgeClaim,
  startKey, keyRound, settleKey,
  sanitizeTurn, sanitizeConvo, sanitizeStop, salaryRange, ASK_KINDS, PLEDGE_KINDS,
  DIFFS, STEP_TYPES, guessAttr, splitAct, splitAsks, simplePlan, sanitizePlan, stepNeed, runSteps, moneyCeil, lendCap,
  stopList, addStopWhen, checkStopWhen, addPledge, donePledge, pledgeTick,
  addFact, apptWho, sameThing, noteDone, recentlyDone, keepPromise, breakPromise, delayPromise,
  sanitizePay, sanitizeGroup, payList, findPay, giftCap, payOut, payBack, payIn, claimPay, newYearPackets, groupList, makeGroup, splitPacket, groupPacket,
  RANKS, BANDS, jobLadder, jobMax, jobTitle, payMul, fieldLadder, fieldIdx, posOf, standing, notePos, posTick, npcGap, gapWord, chainOf, lvFromPos, setNpcPos, originNpc, originTick, originEase, originBlocked, genName, applyOrigin,
  TIERS, relTier, TIER_LEND, TIER_ASK, TIER_OFF, askMod, isKinNpc, HOUSING, homeTier, rentFor, moveCost, moveHome,
  STRAIN, JOBS, jobBoard, boardNext, applyPost, findPost, takePost, postPay, GIGS, gigPay, gigWhen, takeGig, dropGig, gigToday,
  ITEMS, SHOP_CATS, itemOf, itemPrice, shopFriend, bag, hasItem, buyItem, bagFx, itemOld, useItem, careTags, giftValue, giveItem,
  DEPO, LOANS, bankOf, creditWord, jobTenure, loanQuote, takeLoan, prepay, deposit, withdrawFixed, invest, fundValue, redeem, bankTick, loanTick, bankLine, slotsLeft, useSlot,
  FUN, funOf, funCost, doFun, BUSY, npcBusy, talkOf, fixNpcLife, pingTick, settlePings, helpTick, giveLiJin, lifeTick, fixLife
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.ENGINE = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
