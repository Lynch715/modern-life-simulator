/* ===== 现代生活模拟器 · 美术层：图标与图片映射 =====
   图标全部内联 SVG，用 currentColor，选中/禁用交给 CSS。
   图片放 assets/art/scenes/<id>.webp，缺图时整块隐藏，不影响玩。 */

const ICONS = {
  // 赛道 17
  track_creation: '<path d="M7 8l5-5 5 5-5 13z"/><path d="M12 11v9"/><circle cx="12" cy="9" r="1.2" fill="currentColor" stroke="none"/>',
  track_startup: '<path d="M12 21v-7"/><path d="M12 14c-4 0-6-3-6-6 3 0 6 2 6 6z"/><path d="M12 14c4 0 6-3 6-6-3 0-6 2-6 6z"/><path d="M6 21h12"/>',
  track_craft: '<path d="M3 21l8-8"/><path d="M9 11l5-5 4 4-5 5z"/><path d="M14 6l2-2 4 4-2 2"/>',
  track_career: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  track_research: '<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/>',
  track_performance: '<rect x="9" y="3" width="6" height="10" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4"/><path d="M9 21h6"/>',
  track_teaching: '<rect x="4" y="4" width="16" height="11" rx="1"/><path d="M8 20l4-5 4 5"/><path d="M8 8h5M8 11h8"/>',
  track_charity: '<path d="M4 14c2-2 4-2 6-1l3 1h4a2 2 0 0 1 0 4h-6"/><path d="M4 14v6"/><path d="M4 20h7l6-2"/><path d="M14 6a2.5 2.5 0 0 1 5 0c0 2-2.5 3.5-2.5 3.5S14 8 14 6z"/>',
  track_family: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M12 13v1"/><circle cx="12" cy="16.5" r="2.2"/>',
  track_publicservice: '<path d="M9 4h6v5H9z"/><path d="M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2H5z"/><path d="M5 20h14"/>',
  track_sports: '<circle cx="12" cy="15" r="5"/><path d="M8.5 11L6 3h4l2 5 2-5h4l-2.5 8"/>',
  track_gray: '<path d="M5 3h10v18H5z"/><path d="M15 5l4 1v14l-4 1"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/>',
  track_medicine: '<path d="M7 3v5a5 5 0 0 0 10 0V3"/><path d="M12 13v3a4 4 0 0 0 8 0v-1"/><circle cx="20" cy="13" r="2"/>',
  track_law: '<path d="M12 3v18"/><path d="M8 21h8"/><path d="M4 7h16"/><path d="M6 7l-3 7a3 3 0 0 0 6 0z"/><path d="M18 7l-3 7a3 3 0 0 0 6 0z"/>',
  track_creator: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 4v2M20 12h-2M12 20v-2M4 12h2"/>',
  track_invest: '<path d="M3 17l5-5 4 3 6-7"/><path d="M14 8h4v4"/><path d="M3 21h18"/>',
  track_rural: '<path d="M12 21V8"/><path d="M12 8c0-3 2-5 4-5 0 3-2 5-4 5z"/><path d="M12 12c0-3-2-5-4-5 0 3 2 5 4 5z"/><path d="M12 16c0-3 2-5 4-5 0 3-2 5-4 5z"/><path d="M12 16c0-3-2-5-4-5 0 3 2 5 4 5z"/>',
  // 招式 8
  move_facts: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 14l2 2 4-4"/>',
  move_story: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 11c1.5 1.5 6.5 1.5 8 0"/>',
  move_empathy: '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
  move_pressure: '<path d="M12 4v13"/><path d="M6 11l6 6 6-6"/><path d="M5 21h14"/>',
  move_concession: '<path d="M18 5v6a3 3 0 0 1-3 3H6"/><path d="M9 11l-3 3 3 3"/>',
  move_card: '<rect x="4" y="5" width="10" height="14" rx="1.5"/><path d="M14 7l5 1.5-3.5 11.5"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>',
  move_steady: '<path d="M4 15h16"/><circle cx="12" cy="10" r="2.2"/><path d="M8 19h8"/>',
  move_reschedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/><path d="M15 21v-5h6"/>'
};
const TRACK_ICON = {
  '创作': 'track_creation', '创业': 'track_startup', '手艺': 'track_craft', '职场': 'track_career', '科研': 'track_research',
  '表演': 'track_performance', '教书': 'track_teaching', '公益': 'track_charity', '把家过好': 'track_family', '从政': 'track_publicservice',
  '体育': 'track_sports', '捞偏门': 'track_gray', '行医': 'track_medicine', '法律': 'track_law', '做博主': 'track_creator',
  '投资': 'track_invest', '回乡': 'track_rural'
};
const MOVE_ICON = {
  '摆事实': 'move_facts', '讲故事': 'move_story', '共情': 'move_empathy', '施压': 'move_pressure',
  '让步': 'move_concession', '亮底牌': 'move_card', '稳一稳': 'move_steady', '改期': 'move_reschedule'
};
function icon(id, cls) {
  const d = ICONS[id];
  if (!d) return '';
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
}

/* ---- 位图 ---- */
const ART_DIR = 'assets/art/scenes/';
const ART_IDS = [
  'cover_arrival',
  'key_interview', 'key_proposal', 'key_negotiation', 'key_pitch', 'key_defense', 'key_performance', 'key_confrontation', 'key_mediation', 'key_borrow', 'key_partner',
  'home_rent', 'home_owned',
  'biz_shop', 'biz_studio', 'biz_company',
  'ending_ideal', 'ending_finance', 'ending_relationship', 'ending_health', 'ending_neutral'
];
// 构建时由 tools/build.py 填成 assets/art/scenes/ 里实际存在的文件；没出的图不会发请求
const ART_READY = /*==ART_READY==*/null;
const ART = Object.fromEntries(ART_IDS.filter(k => !ART_READY || ART_READY.indexOf(k) >= 0).map(k => [k, 1]));
const KEY_ART = { '面试': 'key_interview', '提案': 'key_proposal', '谈判': 'key_negotiation', '路演': 'key_pitch', '答辩': 'key_defense',
  '演出': 'key_performance', '摊牌': 'key_confrontation', '调解': 'key_mediation', '借钱': 'key_borrow', '拉人入伙': 'key_partner' };
const HOME_ART = { '租': 'home_rent', '买': 'home_owned' };
const BIZ_ART = { '小店': 'biz_shop', '工作室': 'biz_studio', '小公司': 'biz_company' };
const END_ART = { '志业': 'ending_ideal', '财务': 'ending_finance', '关系': 'ending_relationship', '身心': 'ending_health' };

function artSrc(id) { return ART[id] ? ART_DIR + id + '.webp' : ''; }
// cls: '' 叙事16:9 / 'cover' 开局 / 'ban' 关键局横幅。缺图 onerror 整块移除，只回退一次。
function artImg(id, cls, alt, eager) {
  const src = artSrc(id);
  if (!src) return '';
  const a = String(alt == null ? '' : alt).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<figure class="art${cls ? ' ' + cls : ''}" data-art="${id}"><img src="${src}" alt="${a}"${eager ? '' : ' loading="lazy"'} decoding="async" onerror="artFail(this)"/></figure>`;
}
function artFail(img) {
  img.onerror = null;
  const f = img.closest('.art');
  if (f) f.remove(); else img.remove();
}
// 结局：最高线 ≥60 且比第二高多 8 以上才用那条线的图；身体垮了/撑不住了一律中性
function endingArt(sc, reason) {
  const L = (sc && sc.lines) || {};
  const ks = Object.keys(L).sort((a, b) => L[b] - L[a]);
  const why = reason && reason.why || '';
  if (ks.length < 2 || why === '身体垮了' || why === '撑不住了') return 'ending_neutral';
  const top = ks[0], second = ks[1];
  if (L[top] >= 60 && L[top] - L[second] >= 8 && END_ART[top]) return END_ART[top];
  return 'ending_neutral';
}

/* ---- 头像 ----
   12 个身份族 × 三龄。脸在第一次需要显示时分配并入存档，之后不变；性别不明的人继续姓氏字块。 */
const AVATAR_DIR = 'assets/art/avatars/';
const AVATAR_READY = /*==AVATAR_READY==*/null;   // 构建时填成实际存在的文件
const FACE_POOL = { '男': ['m01', 'm02', 'm03', 'm04', 'm05', 'm06'], '女': ['f01', 'f02', 'f03', 'f04', 'f05', 'f06'] };
function avatarsOn() { return !!(AVATAR_READY && AVATAR_READY.length); }
function avatarSrc(face, band) {
  const id = `avatar_${face}_${band}`;
  return AVATAR_READY && AVATAR_READY.indexOf(id) >= 0 ? AVATAR_DIR + id + '.webp' : '';
}
function nameHash(name) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return h; }
function ageBand(age) { return age >= 55 ? 'old' : age >= 35 ? 'mid' : 'young'; }
// 某人在某一年的美术年龄；年龄不详按称呼推
function personAge(S, n, year) {
  const y = year || S.date.y;
  if (n === S.player) return S.player.age - (S.date.y - y);
  const base = Number(n.age) || 0;
  if (base) return base + (y - (n.ageY || S.date.y));
  const t = String(n.tie || '');
  if (/同学|室友|对象|同事|同期|朋友|爱人/.test(t)) return S.player.age - (S.date.y - y);
  return 44;
}
// 分配身份族：同性别里当前通讯录用得最少的，并列按名字哈希
function assignFace(S, n) {
  if (n.face) return n.face;
  const pool = FACE_POOL[n.gender];
  if (!pool) return '';
  const used = {};
  for (const x of S.npcs) if (x.face) used[x.face] = (used[x.face] || 0) + 1;
  if (S.player.face) used[S.player.face] = (used[S.player.face] || 0) + 1;
  const min = Math.min(...pool.map(f => used[f] || 0));
  const cands = pool.filter(f => (used[f] || 0) === min);
  n.face = cands[nameHash(n.name) % cands.length];
  return n.face;
}
function facePerson(S, name) {
  if (!S) return null;
  if (name === S.player.name) return S.player;
  return S.npcs.find(x => x.name === name) || null;
}
// 旧存档：补性别、补年份。不动随机序列和数值
function ensureFaces(S) {
  if (!S || !S.npcs) return;
  for (const n of S.npcs) {
    if (n.gender === undefined) n.gender = ENGINE.guessGender('', n.tie, n.job, n.name);
    if (!n.ageY) n.ageY = S.date.y;
  }
}
// size: 'sm' 30 / '' 34 / 'md' 48 / 'me' 64 / 'lg' 80；year 用于朋友圈旧帖
function faceHtml(S, name, size, year) {
  const ch = String(name || '?').slice(0, 1), hue = nameHash(String(name || '')) % 360;
  const cls = 'face' + (size ? ' ' + size : '');
  const block = `<div class="${cls}" style="--h:${hue}">${ch.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</div>`;
  if (!avatarsOn()) return block;
  const p = facePerson(S, name);
  if (!p || !p.gender) return block;
  const had = !!p.face;
  const face = assignFace(S, p);
  if (!face) return block;
  if (!had && typeof saveGame === 'function') saveGame();
  const src = avatarSrc(face, ageBand(personAge(S, p, year)));
  if (!src) return block;
  return `<img class="${cls}" src="${src}" alt="" loading="lazy" decoding="async" data-ch="${ch}" data-h="${hue}" onerror="faceFail(this)"/>`;
}
function faceFail(img) {
  img.onerror = null;
  const d = document.createElement('div');
  d.className = img.className; d.style.setProperty('--h', img.dataset.h); d.textContent = img.dataset.ch || '?';
  img.replaceWith(d);
}
