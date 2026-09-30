'use strict';
/* 人物卡扩展指令（对齐 Dice-Next 的 .pc/.npc/.nn/.nnn/.sn/.coc/.dnd）：
 *   .pc  [list|show|new|del|bind] ...   PC 玩家卡管理
 *   .npc [list|show|new|del] ...        NPC 卡管理
 *   .nn  <新名>                          给自己改名（本地会话昵称）
 *   .nnn [种子]                          随机给自己改名
 *   .sn  [新名|off]                      群名片（本地会话显示名）
 *   .coc [人物名]                        随机生成一张 CoC 7th 人物卡
 *   .dnd [人物名]                        随机生成一张 DnD 5e 人物卡
 * 卡片统一存于会话 state.cards，用 kind 标记 pc/npc。 */

const { parseExpr, rollExpr } = require('../../expr');
const { registerCmd } = require('../registry');
const { recordRoll } = require('../CommandBrain');
const { cocGrade, sessionCocRule } = require('../coc-grade');

const argStr = a => (Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a)).trim();
const argsOf = a => (Array.isArray(a) ? a : argStr(a).split(/\s+/).filter(Boolean));
const SUCCESS_LEVELS = ['大成功', '极限成功', '极难成功', '困难成功', '成功'];

function roll(ctx, expr) { return rollExpr(parseExpr(expr), ctx.rng).total; }
function pick(ctx, arr) { return arr[Math.floor(ctx.rng.int(0, arr.length - 1))]; }

const XING = ['林', '沈', '陆', '顾', '苏', '江', '程', '许', '叶', '秦', '谢', '裴', '温', '霍', '萧'];
const MING = ['砚', '舟', '澜', '栖', '翎', '野', '昭', '筠', '序', '矜', '遥', '衍', '晏', '珩', '沐'];
const EN_FIRST = ['Alden', 'Bram', 'Cora', 'Dain', 'Elsa', 'Faye', 'Gwen', 'Hale', 'Isolde', 'Jory'];
const EN_LAST = ['Ashford', 'Blackwood', 'Carrow', 'Dunmore', 'Everly', 'Fairfax', 'Greaves', 'Hollow'];

function randName(ctx) { return pick(ctx, XING) + pick(ctx, MING); }
function randEnName(ctx) { return pick(ctx, EN_FIRST) + ' ' + pick(ctx, EN_LAST); }

function sheet(ctx) { return ctx.data.state; }

function listCards(st, kind) {
  return Object.keys(st.cards).filter(n => (st.cards[n].kind || 'pc') === kind);
}

/* ─── .pc ─────────────────────────────────────────────── */
function runPc(ctx, args) {
  const st = sheet(ctx);
  const [sub, name] = argsOf(args);
  if (!sub || sub === 'list') {
    const names = listCards(st, 'pc');
    return { text: `PC 人物卡（${names.length}）：` + (names.join('、') || '（空）') + '\n用 .pc new <名> 新建，.pc show <名> 查看，.pc tag <名> 绑定' };
  }
  if (sub === 'new') {
    if (!name) return { text: '用法：.pc new <人物名>' };
    if (st.cards[name]) return { text: `「${name}」已存在` };
    st.cards[name] = { name, kind: 'pc', fields: { 力量: 50, 敏捷: 50, 意志: 50, 理智: 50 }, updatedAt: new Date().toISOString() };
    return { text: `已新建 PC「${name}」，可用 .st 录入 ${name} 侦查=60 补充字段，.pc tag ${name} 绑定` };
  }
  if (sub === 'bind' || sub === 'tag') {
    if (!name || !st.cards[name]) return { text: `没有找到人物卡「${name || ''}」` };
    st.bind = name;
    return { text: `已绑定 PC「${name}」` };
  }
  if (sub === 'untag') {
    if (!st.bind) return { text: '当前没有绑定的人物卡' };
    const old = st.bind;
    st.bind = null;
    return { text: `已解除人物卡「${old}」的绑定` };
  }
  if (sub === 'rename') {
    const cur = st.bind;
    if (!cur) return { text: '当前没有绑定的人物卡，先 .pc tag <名> 绑定' };
    if (!name) return { text: '用法：.pc rename <新名>' };
    if (st.cards[name]) return { text: `「${name}」已存在` };
    const card = st.cards[cur];
    delete st.cards[cur];
    card.name = name;
    st.cards[name] = card;
    st.bind = name;
    return { text: `人物卡「${cur}」已更名为「${name}」` };
  }
  if (sub === 'lock' || sub === 'unlock') {
    const card = st.bind && st.cards[st.bind];
    if (!card) return { text: '当前没有绑定的人物卡' };
    const what = (name || 'w').toLowerCase() === 'r' ? 'r' : 'w';
    card.locks = card.locks || {};
    card.locks[what] = sub === 'lock';
    return { text: `${sub === 'lock' ? '已锁定' : '已解除锁定'}人物卡「${card.name}」的${what === 'r' ? '读取' : '写入'}` };
  }
  if (sub === 'build' || sub === 'redo') {
    const cur = st.bind;
    if (!cur) return { text: '当前没有绑定的人物卡，先 .pc new <名> 再 .pc tag <名>' };
    st.cards[cur].fields = Object.assign({}, cocFields(ctx));
    st.cards[cur].updatedAt = new Date().toISOString();
    return { text: `已为「${cur}」${sub === 'redo' ? '重新' : ''}生成属性：` + Object.keys(st.cards[cur].fields).map(k => `${k}=${st.cards[cur].fields[k]}`).join(' ') };
  }
  if (sub === 'del') {
    if (!name || !st.cards[name]) return { text: `没有找到人物卡「${name || ''}」` };
    delete st.cards[name];
    if (st.bind === name) st.bind = null;
    return { text: `已删除人物卡「${name}」` };
  }
  if (sub === 'stat') {
    // Dice-Next：.pc stat [技能] → 本会话检定统计（缺省汇总各技能）
    const logs = (ctx.session.logs || []).filter(l => l.rule === 'coc7' || l.skill);
    const pool = name ? logs.filter(l => l.skill === name) : logs;
    if (!pool.length) return { text: name ? `本会话还没有「${name}」的检定记录` : '本会话还没有检定记录（先进行 .ra / .rc 检定）' };
    const ok = pool.filter(l => SUCCESS_LEVELS.includes(l.level)).length;
    const pct = Math.round((ok / pool.length) * 100);
    return { text: `检定统计${name ? `「${name}」` : ''}（共 ${pool.length} 次）：成功 ${ok} 次（${pct}%）` };
  }
  if (sub === 'tojson') {
    // Dice-Next：.pc tojson → 导出当前绑定卡的 JSON
    const key = name || st.bind;
    const card = key && st.cards[key];
    if (!card) return { text: '当前没有绑定的人物卡，先 .pc new <名> 再 .pc tag <名>' };
    return { text: `\`\`\`json\n${JSON.stringify({ name: card.name, kind: card.kind || 'pc', fields: card.fields, updatedAt: card.updatedAt }, null, 2)}\n\`\`\`` };
  }
  if (sub === 'cloud') {
    // Dice-Next：.pc cloud auth|confirm|... 云人物卡；本地工作台未接入云，仅回执。
    const act = name || 'auth';
    return { text: `云人物卡服务：已受理「${act}」（本地工作台未接入云端，可用 .pc tojson 导出卡片）` };
  }
  if (sub === 'show' || st.cards[sub]) {
    const key = sub === 'show' ? name : sub;
    const card = key && st.cards[key];
    if (!card) return { text: `没有找到人物卡「${key || ''}」` };
    const fields = Object.entries(card.fields).map(([k, v]) => `${k}=${v}`).join(' ');
    const mark = st.bind === card.name ? '（当前绑定）' : '';
    return { text: `「${card.name}」${mark}：${fields || '（暂无字段）'}` };
  }
  return { text: '用法：.pc list / .pc new <名> / .pc tag <名> / .pc untag / .pc rename <名> / .pc show <名> / .pc del <名> / .pc lock|unlock <w|r>' };
}

/* ─── .npc ────────────────────────────────────────────── */
function runNpc(ctx, args) {
  const st = sheet(ctx);
  const list = argsOf(args);
  const sub = list[0];
  if (!sub || sub === 'list') {
    const names = listCards(st, 'npc');
    return { text: `NPC 卡（${names.length}）：` + (names.join('、') || '（空）') + '\n用 .npc new <名> 新建，.npc <名> st 力量50 录属性，.npc <名> ra 力量 代骰' };
  }
  if (sub === 'new') {
    const name = list[1];
    if (!name) return { text: '用法：.npc new <NPC 名> [备注=值 ...]' };
    if (st.cards[name]) return { text: `「${name}」已存在` };
    st.cards[name] = { name, kind: 'npc', fields: {}, updatedAt: new Date().toISOString() };
    return { text: `已新建 NPC「${name}」` };
  }
  if (sub === 'del') {
    const name = list[1];
    if (!name || !st.cards[name]) return { text: `没有找到 NPC「${name || ''}」` };
    delete st.cards[name];
    return { text: `已删除 NPC「${name}」` };
  }
  if (sub === 'clr') {
    const name = list[1];
    const card = name && st.cards[name];
    if (!card) return { text: `没有找到 NPC「${name || ''}」` };
    card.fields = {};
    card.updatedAt = new Date().toISOString();
    return { text: `已清空 NPC「${name}」的属性` };
  }
  if (sub === 'show') {
    const name = list[1];
    const card = name && st.cards[name];
    if (!card) return { text: `没有找到 NPC「${name || ''}」` };
    const fields = Object.entries(card.fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return { text: `NPC「${card.name}」：${fields || '（暂无字段）'}` };
  }
  // .npc <名> st <属性><值...> / .npc <名> ra <技能>
  const card = st.cards[sub];
  if (card) {
    const act = list[1];
    if (act === 'st') {
      const kvs = list.slice(2);
      if (!kvs.length) return { text: `用法：.npc ${sub} st <属性><值>，例如 .npc ${sub} st 力量50 敏捷=60` };
      for (const kv of kvs) {
        const eq = kv.indexOf('=');
        const m = eq > 0 ? [null, kv.slice(0, eq), kv.slice(eq + 1)] : /^([^\d+\-=]+)([+\-]?\d+)$/.exec(kv);
        if (!m) return { text: `无法解析属性「${kv}」，请用「力量50」或「力量=50」` };
        card.fields[m[1]] = Number(m[2]);
      }
      card.updatedAt = new Date().toISOString();
      return { text: `NPC「${card.name}」：` + Object.entries(card.fields).map(([k, v]) => `${k}=${v}`).join(' ') };
    }
    if (act === 'ra') {
      const skill = list[2];
      if (!skill) return { text: `用法：.npc ${sub} ra <技能|数值>，例如 .npc ${sub} ra 力量` };
      const value = Number.isFinite(Number(card.fields[skill])) ? Number(card.fields[skill]) : (Number(skill) || 50);
      const outcome = roll(ctx, '1d100');
      const lv = cocGrade(outcome, value, sessionCocRule(ctx));
      recordRoll(ctx, { expr: '1d100', seed: ctx.rng.seed, detail: [{ kind: 'num', value: outcome }], total: outcome, rule: 'coc7', hidden: false, skill, level: lv });
      return { text: `${card.name} 的「${skill}」（${value}）检定：1d100 → ${outcome} → ${lv}` };
    }
    if (!act) {
      const fields = Object.entries(card.fields).map(([k, v]) => `${k}=${v}`).join(' ');
      return { text: `NPC「${card.name}」：${fields || '（暂无字段）'}` };
    }
  }
  return { text: '用法：.npc list / .npc new <名> / .npc show <名> / .npc <名> st <属性><值> / .npc <名> ra <技能> / .npc clr <名> / .npc del <名>' };
}

/* ─── 昵称状态 ────────────────────────────────────────── */
function userOf(ctx) {
  const st = ctx.data.state;
  const id = ctx.sender.id;
  const u = st.users[id] || (st.users[id] = { days: 0, favor: 0, lastDate: '' });
  if (!u.nick) u.nick = ctx.sender.name;
  return u;
}
function displayName(ctx) {
  const u = ctx.data.state.users[ctx.sender.id];
  return (u && u.nick) || ctx.sender.name;
}

function runNn(ctx, args) {
  const name = argStr(args);
  // Dice-Next 兼容：.nn（无参）清除个人昵称，恢复本名。
  if (!name) {
    const u = userOf(ctx);
    if (!u.nick) return { text: `${displayName(ctx)} 当前没有自定义昵称。用法：.nn <新名字> 或 .nn clr` };
    const old = u.nick;
    u.nick = '';
    return { text: `已清除昵称「${old}」，恢复本名` };
  }
  if (name === 'clr' || name === 'clear') {
    const u = userOf(ctx);
    const old = u.nick;
    u.nick = '';
    return { text: old ? `已清除昵称「${old}」，恢复本名` : '当前没有自定义昵称' };
  }
  if (name.length > 24) return { text: '名字太长了（最多 24 字）' };
  const u = userOf(ctx);
  const old = displayName(ctx);
  u.nick = name;
  return { text: `${old} 现在改名为「${name}」` };
}
function runNnn(ctx, args) {
  const seed = argStr(args);
  const u = userOf(ctx);
  u.nick = seed ? `${seed}·${randName(ctx)}` : randName(ctx);
  return { text: `随机改名：${u.nick}（用时下流行的名字重新自我介绍）` };
}
function runSn(ctx, args) {
  const name = argStr(args);
  const u = userOf(ctx);
  if (name === 'off') { u.card = null; return { text: '已清除群名片，恢复本名' }; }
  if (!name) return { text: `当前群名片：${u.card || displayName(ctx)}\n用法：.sn <新名片> / .sn off` };
  u.card = name;
  return { text: `群名片已设为「${name}」` };
}

/* ─── .coc 生成 CoC 7th 人物卡 ────────────────────────── */
function genCoc(ctx, name) {
  const int3 = () => roll(ctx, '3d6') * 5;
  const int2p6 = () => (roll(ctx, '2d6') + 6) * 5;
  const fields = {
    力量: int3(), 体质: int3(), 体型: int2p6(), 敏捷: int3(),
    外观: int3(), 智力: int2p6(), 意志: int3(), 教育: int2p6(), 幸运: int3()
  };
  fields.理智 = fields.意志;
  fields.生命 = Math.floor((fields.体质 + fields.体型) / 10);
  fields.魔法 = Math.floor(fields.意志 / 5);
  const text = [`【CoC 7th 人物卡】${name || '（未命名）'}`,
    Object.entries(fields).map(([k, v]) => `${k} ${v}`).join('　')].join('\n');
  if (name) {
    ctx.data.state.cards[name] = { name, kind: 'pc', fields: Object.assign({}, fields), updatedAt: new Date().toISOString() };
    ctx.data.state.bind = name;
    return { text: text + `\n已存入人物卡「${name}」并自动绑定` };
  }
  return { text: text + '\n（未指定名字，未存档；用 .coc <人物名> 直接生成并存档）' };
}

/* ─── .dnd 生成 DnD 5e 人物卡 ─────────────────────────── */
function genDnd(ctx, name) {
  const abil = () => roll(ctx, '4d6kh3');
  const mod = v => Math.floor((v - 10) / 2);
  const f = { 力量: abil(), 敏捷: abil(), 体质: abil(), 智力: abil(), 感知: abil(), 魅力: abil() };
  const cm = mod(f.体质), dm = mod(f.敏捷);
  f.生命上限 = 10 + cm;
  f.防御等级 = 10 + dm;
  f.先攻 = dm;
  const fmt = v => `${v}(${mod(v) >= 0 ? '+' : ''}${mod(v)})`;
  const text = [`【DnD 5e 人物卡】${name || '（未命名）'}`,
    `力量 ${fmt(f.力量)}　敏捷 ${fmt(f.敏捷)}　体质 ${fmt(f.体质)}`,
    `智力 ${fmt(f.智力)}　感知 ${fmt(f.感知)}　魅力 ${fmt(f.魅力)}`,
    `生命上限 ${f.生命上限}　防御等级 ${f.防御等级}　先攻 ${f.先攻 >= 0 ? '+' : ''}${f.先攻}`].join('\n');
  if (name) {
    ctx.data.state.cards[name] = { name, kind: 'pc', fields: f, updatedAt: new Date().toISOString() };
    ctx.data.state.bind = name;
    return { text: text + `\n已存入人物卡「${name}」并自动绑定` };
  }
  return { text: text + '\n（未指定名字，未存档；用 .dnd <人物名> 直接生成并存档）' };
}

registerCmd({ name: 'pc', alias: ['玩家卡'], group: 'core', handle: runPc });
registerCmd({ name: 'npc', alias: [], group: 'core', handle: runNpc });
registerCmd({ name: 'nn', alias: ['改名'], group: 'fun', handle: runNn });
registerCmd({ name: 'nnn', alias: ['随机改名'], group: 'fun', handle: runNnn });
registerCmd({ name: 'sn', alias: ['群名片'], group: 'fun', handle: runSn });
/* .coc7d 3 / .dnd 3：数字参数表示「一次生成 N 张（不入库）」。 */
function genDispatch(gen, ctx, args) {
  const s = argStr(args);
  if (/^\d+$/.test(s)) return { text: Array.from({ length: Math.min(9, Number(s)) }, () => gen(ctx, '').text).join('\n\n') };
  return gen(ctx, s);
}
registerCmd({ name: 'coc', alias: ['coc7', 'coc6', 'cocd', 'coc7d', 'coc6d', '车卡coc'], group: 'fun', handle: (ctx, a) => genDispatch(genCoc, ctx, a) });
registerCmd({ name: 'dnd', alias: ['dnd5e', 'dnd5ed', '车卡dnd'], group: 'fun', handle: (ctx, a) => genDispatch(genDnd, ctx, a) });

module.exports = { runPc, runNpc, runNn, runNnn, runSn, genCoc, genDnd, displayName };
