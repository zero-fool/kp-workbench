'use strict';
/* 娱乐扩展指令（对齐 Dice-Next）：
 *   .name [类型] / .gn      随机起名（默认中文，en 英文）
 *   .me <动作>              第三人称动作描述
 *   .ak <选项...>           抉择分歧：从选项里随机挑一个
 *   .sleep                  小憩：恢复人物卡生命
 *   .gacha [卡池]           抽卡（SSR/SR/R/N 档）
 *   .favor [对象] [+n]      好感度查询/增减
 *   .hiy [技能]             检定统计（别名 .打招呼）
 *   .ob join|exit|list|...  旁观名单管理（别名 .旁观） */
const { registerCmd } = require('../registry');
const { boundCard } = require('../CommandBrain');
const { displayName } = require('./card');

const argStr = a => (Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a)).trim();
const argsOf = a => (Array.isArray(a) ? a : argStr(a).split(/\s+/).filter(Boolean));
const pick = (ctx, arr) => arr[ctx.rng.int(0, arr.length - 1)];

const XING = ['林', '沈', '陆', '顾', '苏', '江', '程', '许', '叶', '秦', '谢', '裴', '温', '霍', '萧', '白', '傅', '姜'];
const MING1 = ['砚', '舟', '澜', '栖', '翎', '野', '昭', '筠', '序', '矜', '遥', '衍', '晏', '珩', '沐', '清'];
const MING2 = ['之', '川', '辞', '书', '秋', '冬', '言', '屿'];
const EN_FIRST = ['Alden', 'Bram', 'Cora', 'Dain', 'Elsa', 'Faye', 'Gwen', 'Hale', 'Isolde', 'Jory', 'Kiran', 'Lyra'];
const EN_LAST = ['Ashford', 'Blackwood', 'Carrow', 'Dunmore', 'Everly', 'Fairfax', 'Greaves', 'Hollow', 'Ives', 'Lockhart'];
const JP_XING = ['佐藤', '铃木', '高桥', '田中', '伊藤', '渡边', '山本', '中村', '小林', '加藤', '吉田', '山田'];
const JP_MING = ['莲', '结衣', '翔太', '美咲', '大辅', '葵', '凛', '悠真', '阳菜', '拓海', '枫', '千夏'];

function cnName(ctx) {
  return pick(ctx, XING) + pick(ctx, MING1) + (ctx.rng.int(0, 1) ? pick(ctx, MING2) : '');
}
function enName(ctx) { return pick(ctx, EN_FIRST) + ' ' + pick(ctx, EN_LAST); }
function jpName(ctx) { return pick(ctx, JP_XING) + ' ' + pick(ctx, JP_MING); }

function runName(ctx, args) {
  const toks = argsOf(args);
  const t = (toks[0] || '').toLowerCase();
  // Dice-Next 兼容：.name [cn/en/jp] [数量]，默认中文。
  const lang = (t === 'en' || t === '英' || t === 'english') ? 'en'
    : (t === 'jp' || t === '日' || t === 'ja' || t === '日本語') ? 'jp' : 'cn';
  const n = Math.max(1, Math.min(9, Number(toks.find(x => /^\d+$/.test(x))) || 1));
  const gen = lang === 'en' ? enName : lang === 'jp' ? jpName : cnName;
  const label = lang === 'en' ? '英文' : lang === 'jp' ? '日文' : '中文';
  const names = Array.from({ length: n }, () => gen(ctx));
  return { text: `随机${label}名字：${names.join('、')}` };
}

function runMe(ctx, args) {
  const body = argStr(args);
  const s = ctx.session;
  s.settings = s.settings || {};
  s.settings.switches = s.settings.switches || {};
  const low = body.toLowerCase();
  // Dice-Next 兼容：.me on|off 开关本群动作代述。
  if (low === 'on' || low === 'off') {
    s.settings.switches.me = low === 'on';
    return { text: `动作代述已${low === 'on' ? '开启' : '关闭'}` };
  }
  if (!body) return { text: '用法：.me <动作>，例如 .me 端起酒杯，望向窗外的雨夜；.me on|off 开关代述' };
  if (s.settings.switches.me === false) return { text: '动作代述已关闭（.me on 可开启）' };
  return { text: `* ${displayName(ctx)} ${body}` };
}

function runAk(ctx, args) {
  const raw = argStr(args);
  const s = ctx.session;
  s.akLists = s.akLists || {};
  // Dice-Next 兼容：.ak#列表+选项1|选项2 建/加选项；.ak=列表 抽取并清空。
  if (raw.startsWith('#')) {
    const body = raw.slice(1);
    const plus = body.indexOf('+');
    const name = (plus > 0 ? body.slice(0, plus) : body).trim() || 'default';
    const opts = plus > 0 ? body.slice(plus + 1).split(/[+|、\s]+/).filter(Boolean) : [];
    if (!opts.length) {
      const cur = s.akLists[name] || [];
      return { text: cur.length
        ? `选项列表「${name}」（${cur.length}）：${cur.join('、')}\n抽取：.ak=${name}`
        : `选项列表「${name}」为空，用 .ak#${name}+选项1|选项2 添加` };
    }
    s.akLists[name] = (s.akLists[name] || []).concat(opts);
    return { text: `已向选项列表「${name}」添加 ${opts.length} 项（现有 ${s.akLists[name].length} 项）\n抽取：.ak=${name}` };
  }
  if (raw.startsWith('=')) {
    const name = raw.slice(1).trim() || 'default';
    const cur = s.akLists[name] || [];
    if (!cur.length) return { text: `选项列表「${name}」为空，先 .ak#${name}+选项1|选项2 添加` };
    const i = ctx.rng.int(0, cur.length - 1);
    const chosen = cur[i];
    delete s.akLists[name]; // 抽取后清空（对齐 Dice-Next）
    return { text: `从「${name}」中抽出：\n${cur.map((o, k) => (k === i ? `▶ ${o}` : `　 ${o}`)).join('\n')}\n最终决定：【${chosen}】` };
  }
  const options = raw.split(/[\s/|、]+/).filter(Boolean);
  if (options.length < 2) return { text: '用法：.ak <选项1> <选项2> [...]，例如 .ak 相信他 转身离开；或用 .ak#列表+选项1|选项2 后 .ak=列表 抽取' };
  const i = ctx.rng.int(0, options.length - 1);
  return { text: `面对分歧，命运替你做了选择：\n${options.map((o, k) => (k === i ? `▶ ${o}` : `　 ${o}`)).join('\n')}\n最终决定：【${options[i]}】` };
}

function runSleep(ctx, args) {
  const card = boundCard(ctx);
  if (card && Number.isFinite(Number(card.fields['生命'])) && Number.isFinite(Number(card.fields['生命上限']))) {
    card.fields['生命'] = Number(card.fields['生命上限']);
    card.updatedAt = new Date().toISOString();
    return { text: `${displayName(ctx)} 蜷在角落小憩了一会儿，生命恢复至 ${card.fields['生命']}。` };
  }
  const t = pick(ctx, ['呼……（打了个哈欠）', '（翻身把被子蒙住头）', '（蜷成一团睡熟了）']);
  return { text: `${displayName(ctx)} 小憩了一会儿。${t}` };
}

const RARITY = [
  ['N', 60], ['R', 28], ['SR', 9], ['SSR', 3]
];
function runGacha(ctx, args) {
  const pool = argStr(args) || '命运卡池';
  const total = RARITY.reduce((s, r) => s + r[1], 0);
  let roll = ctx.rng.int(1, total), acc = 0, got = 'N';
  for (const [name, w] of RARITY) { acc += w; if (roll <= acc) { got = name; break; } }
  const items = {
    SSR: ['黄金沙漏·逆流之匙', '守秘人的面具', '旧神的一页'],
    SR: ['银质怀表', '褪色的护身符', '无名者的笔记'],
    R: ['一枚旧硬币', '半截蜡烛', '生锈的钥匙'],
    N: ['一张旧车票', '干枯的花瓣', '空白的信纸']
  };
  return { text: `在「${pool}」里抽一张……\n✦ ${got} ✦ ${pick(ctx, items[got])}` };
}

function runFavor(ctx, args) {
  const list = argsOf(args);
  const st = ctx.data.state;
  const me = ctx.sender.id;
  st.favor = st.favor || {};
  const mine = st.favor[me] = st.favor[me] || {};
  const head = (list[0] || '');

  // 中文/英文子命令（对齐 Dice-Next：好感 / 好感排行 / 好感增加 / 好感成长 / 好感覆写 / 好感擦除）
  if (head === '排行' || head.toLowerCase() === 'rank') return favorRank(ctx);
  if (head === '增加' || head.toLowerCase() === 'add') return favorAmount(ctx, list.slice(1), 'add');
  if (head === '覆写' || head.toLowerCase() === 'set') return favorAmount(ctx, list.slice(1), 'set');
  if (head === '擦除' || head.toLowerCase() === 'erase') return favorAmount(ctx, list.slice(1), 'erase');
  if (head === '成长' || head.toLowerCase() === 'grow') {
    const d = ctx.rng.int(1, 6);
    mine[me] = Math.max(0, Math.min(100, (mine[me] || 0) + d));
    return { text: `${displayName(ctx)} 与骰娘的好感成长了 +${d} → ${mine[me]}/100` };
  }

  const target = list.find(a => !/^[+-]\d+$/.test(a)) || me;
  const deltaTok = list.find(a => /^[+-]\d+$/.test(a));
  if (deltaTok) mine[target] = Math.max(0, Math.min(100, (mine[target] || 0) + Number(deltaTok)));
  const val = mine[target] || 0;
  const tier = val >= 80 ? '生死之交' : val >= 60 ? '亲密' : val >= 40 ? '友好' : val >= 20 ? '熟识' : '陌生';
  const who = target === me ? displayName(ctx) : target;
  return { text: `${who} 的好感度：${val}/100（${tier}）` + (deltaTok ? `（${deltaTok}）` : '') };
}

/* 好感增减/覆写/擦除：仅管理员（高信任）可用，可带 @对象（此处以用户号/名字代替）。 */
function favorAmount(ctx, rest, mode) {
  const st = ctx.data.state;
  const me = ctx.sender.id;
  st.favor = st.favor || {};
  const mine = st.favor[me] = st.favor[me] || {};
  if (!isAdmin(ctx)) return { text: '没有权限：好感调控需要管理员或高信任（≥4）' };
  const target = rest.find(a => !/^[+-]?\d+$/.test(a)) || me;
  const numTok = rest.find(a => /^[+-]?\d+$/.test(a));
  const cur = mine[target] || 0;
  const who = target === me ? displayName(ctx) : target;
  if (mode === 'erase') { delete mine[target]; return { text: `已擦除「${who}」的好感度记录` }; }
  const n = Number(numTok);
  if (!Number.isFinite(n)) return { text: `用法：.好感${mode === 'set' ? '覆写' : '增加'} <数值> [对象]` };
  mine[target] = mode === 'set' ? Math.max(0, Math.min(100, n)) : Math.max(0, Math.min(100, cur + n));
  return { text: `已将「${who}」的好感度${mode === 'set' ? '覆写为' : '调整为'} ${mine[target]}/100` };
}

function isAdmin(ctx) { const r = ctx.sender && ctx.sender.role; return r === 'owner' || r === 'admin' || r === 'gm' || r === 'kp' || r === 'master'; }

function favorRank(ctx) {
  const st = ctx.data.state;
  const totals = {};
  for (const byUser of Object.values(st.favor || {})) {
    for (const [t, v] of Object.entries(byUser)) totals[t] = Math.max(totals[t] || 0, Number(v) || 0);
  }
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!rows.length) return { text: '还没有好感度记录' };
  return { text: '好感度排行：\n' + rows.map((r, i) => `${i + 1}. ${r[0]}　${r[1]}/100`).join('\n') };
}

const SUCCESS_LEVELS = ['大成功', '极限成功', '极难成功', '困难成功', '成功'];

function runHiy(ctx, args) {
  const skill = argStr(args);
  const logs = (ctx.session.logs || []).filter(l => l.rule === 'coc7' || l.skill);
  const pool = skill ? logs.filter(l => l.skill === skill) : logs;
  if (!pool.length) {
    return { text: skill ? `本会话还没有「${skill}」的检定记录` : '本会话还没有检定记录（先进行 .ra / .rc 检定）' };
  }
  const stat = (rows) => {
    const ok = rows.filter(l => SUCCESS_LEVELS.includes(l.level)).length;
    const pct = rows.length ? Math.round((ok / rows.length) * 100) : 0;
    return `检定 ${rows.length} 次，成功 ${ok} 次（${pct}%）`;
  };
  if (skill) return { text: `检定统计「${skill}」：${stat(pool)}` };
  // 分技能汇总
  const bySkill = {};
  for (const l of pool) { const k = l.skill || '（未记录技能）'; (bySkill[k] = bySkill[k] || []).push(l); }
  const lines = Object.entries(bySkill).map(([k, rows]) => `· ${k}：${stat(rows)}`);
  return { text: `检定统计（共 ${pool.length} 次）：\n${lines.join('\n')}` };
}

/* ─── .ob 旁观（对齐 Dice-Next handleObserve）───────────
 *   .ob join        加入旁观名单（旁观功能开启时）
 *   .ob exit        退出旁观名单
 *   .ob list        查看旁观名单
 *   .ob on|off      群旁观功能开关（群管）
 *   .ob clr         清空旁观名单（群管/GM）
 *   .ob（无参数/其他） 显示用法 */
const OB_USAGE = '用法：.ob join 加入旁观 / .ob exit 退出 / .ob list 查看 / .ob on|off 旁观开关（群管）/ .ob clr 清空（群管）';

function runOb(ctx, args) {
  const s = ctx.session;
  s.observe = s.observe || [];
  const who = displayName(ctx);
  const sub = argStr(args).toLowerCase();
  const isAdmin = !!(ctx.perm && ctx.perm.check(ctx.sender, 'manage'));
  if (!sub) return { text: OB_USAGE };
  if (sub === 'join' || sub === '加入') {
    if (s.obOff) return { text: '本群已关闭旁观功能' };
    if (s.observe.includes(who)) return { text: `${who} 已在旁观名单中` };
    s.observe.push(who);
    return { text: `${who} 已加入旁观` };
  }
  if (sub === 'exit' || sub === '退出') {
    if (!s.observe.includes(who)) return { text: `${who} 不在旁观名单中` };
    s.observe = s.observe.filter(n => n !== who);
    return { text: `${who} 已退出旁观` };
  }
  if (sub === 'list') {
    return { text: s.observe.length ? `旁观名单（${s.observe.length}）：\n${s.observe.join('\n')}` : '当前没有旁观者' };
  }
  if (sub === 'on' || sub === 'off') {
    if (!isAdmin) return { text: '没有权限：该指令仅群管理可用' };
    const on = sub === 'on';
    if (!!s.obOff === !on) return { text: `旁观功能已是${on ? '开启' : '关闭'}状态` };
    s.obOff = !on;
    return { text: `旁观功能已${on ? '开启' : '关闭'}` };
  }
  if (sub === 'clr' || sub === 'clear' || sub === '清空') {
    if (!isAdmin) return { text: '没有权限：该指令仅群管理可用' };
    s.observe = [];
    return { text: '旁观名单已清空' };
  }
  return { text: OB_USAGE };
}

registerCmd({ name: 'name', alias: ['随机起名', '起名'], group: 'fun', handle: runName });
registerCmd({ name: 'gn', alias: [], group: 'fun', handle: runName });
registerCmd({ name: 'me', alias: ['动作'], group: 'fun', handle: runMe });
registerCmd({ name: 'ak', alias: ['抉择'], group: 'fun', handle: runAk });
registerCmd({ name: 'sleep', alias: ['休息', '小憩'], group: 'fun', handle: runSleep });
registerCmd({ name: 'gacha', alias: ['抽卡'], group: 'fun', handle: runGacha });
// Dice-Next 兼容：「好感 / 好感排行 / 好感增加」等中文指令允许无前缀直呼。
registerCmd({ name: 'favor', alias: ['好感', '好感度'], group: 'fun', noPrefix: true, handle: runFavor });
registerCmd({ name: '好感排行', alias: ['好感度排行'], group: 'fun', noPrefix: true, handle: (ctx) => favorRank(ctx) });
registerCmd({ name: '好感增加', alias: [], group: 'fun', noPrefix: true, handle: (ctx, a) => favorAmount(ctx, argsOf(a), 'add') });
registerCmd({ name: '好感成长', alias: [], group: 'fun', noPrefix: true, handle: (ctx) => runFavor(ctx, ['成长']) });
registerCmd({ name: '好感覆写', alias: [], group: 'fun', noPrefix: true, handle: (ctx, a) => favorAmount(ctx, argsOf(a), 'set') });
registerCmd({ name: '好感擦除', alias: [], group: 'fun', noPrefix: true, handle: (ctx, a) => favorAmount(ctx, argsOf(a), 'erase') });
registerCmd({ name: 'hiy', alias: ['打招呼'], group: 'fun', handle: runHiy });
registerCmd({ name: 'ob', alias: ['旁观'], group: 'fun', handle: runOb });

module.exports = { runName, runMe, runAk, runSleep, runGacha, runFavor, runHiy, runOb };
