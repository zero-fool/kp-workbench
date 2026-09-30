'use strict';
/* DnD 5e 扩展指令（对齐 Dice-Next 的 .ss/.cast/.longrest/.ds）：
 *   .ss [环位] [±n]        法术位查看/消耗/恢复
 *   .cast <法术名> [环位]   施法：消耗一个对应环位法术位
 *   .longrest              长休：生命回满、法术位全恢复
 *   .ds [reset]            死亡豁免：1d20，累计 3 成功/3 失败
 * 状态按发送者在会话内保存（spellSlots / deathSaves）。 */
const { registerCmd } = require('../registry');
const { boundCard } = require('../CommandBrain');

const argStr = a => (Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a)).trim();
const argsOf = a => (Array.isArray(a) ? a : argStr(a).split(/\s+/).filter(Boolean));

function slotsOf(ctx) {
  const s = ctx.session;
  s.spellSlots = s.spellSlots || {};
  const id = ctx.sender.id;
  if (!s.spellSlots[id]) s.spellSlots[id] = { 1: 4, 2: 3, 3: 2 };
  return s.spellSlots[id];
}

/* 解析环位：支持「3」「3环」「3环位」。非法返回 NaN。 */
function parseLevel(tok) {
  const m = /^(\d+)(?:环|环位)?$/.exec(String(tok == null ? '' : tok).trim());
  return m ? Number(m[1]) : NaN;
}

function runSs(ctx, args) {
  const list = argsOf(args);
  const slots = slotsOf(ctx);
  if (!list.length) {
    const text = Object.keys(slots).sort().map(lv => `${lv} 环：${slots[lv]}`).join('\n');
    return { text: `法术位：\n${text}\n用法：.ss init 4 3 2 初始化 / .ss <环位> -1 消耗 / .ss <环位> +1 恢复 / .ss longrest 全部恢复` };
  }
  if (list[0] === 'longrest' || list[0] === 'rest' || list[0] === '长休') {
    for (const k of Object.keys(slots)) slots[k] = Number(slots[k]) + 0;
    return { text: '法术位已全部恢复（长休）' };
  }
  // Dice-Next 兼容：.ss init 4 3 2 → 依次初始化 1/2/3… 环上限
  if (list[0] === 'init') {
    const nums = list.slice(1).map(Number).filter(n => Number.isInteger(n) && n >= 0);
    if (!nums.length) return { text: '用法：.ss init <1环数> <2环数> ...，例如 .ss init 4 3 2' };
    for (const k of Object.keys(slots)) delete slots[k];
    nums.forEach((n, i) => { slots[i + 1] = n; });
    return { text: '法术位已初始化：\n' + Object.keys(slots).sort().map(lv => `${lv} 环：${slots[lv]}`).join('\n') };
  }
  // Dice-Next 兼容：.ss set <环位> <数量> 直接设定某环法术位；.ss clr 清空。
  if (list[0] === 'set') {
    const lv = parseLevel(list[1]);
    const val = Number(list[2]);
    if (!Number.isInteger(lv) || lv < 1 || lv > 9 || !Number.isFinite(val) || val < 0) {
      return { text: '用法：.ss set <环位> <数量>，例如 .ss set 3环 5' };
    }
    slots[lv] = val;
    return { text: `${lv} 环法术位已设为 ${val}` };
  }
  if (list[0] === 'clr' || list[0] === 'clear') {
    for (const k of Object.keys(slots)) delete slots[k];
    return { text: '法术位已清空' };
  }
  const lv = parseLevel(list[0]);
  if (!Number.isInteger(lv) || lv < 1 || lv > 9) return { text: '环位需为 1-9 的整数（可写 .ss 3环 -1）' };
  const n = Number(list[1] || 0);
  if (!Number.isFinite(n) || n === 0) return { text: `当前 ${lv} 环法术位：${slots[lv] || 0}` };
  slots[lv] = Math.max(0, (slots[lv] || 0) + n);
  return { text: `${lv} 环法术位${n < 0 ? '消耗' : '恢复'} ${Math.abs(n)}，剩余 ${slots[lv]}` };
}

function runCast(ctx, args) {
  const list = argsOf(args);
  const name = list[0];
  if (!name) return { text: '用法：.cast <法术名> [环位]，例如 .cast 火球术 3、.cast 灼热射线 2环' };
  const lv = parseLevel(list[1]) || 1;
  const slots = slotsOf(ctx);
  if ((slots[lv] || 0) <= 0) return { text: `${lv} 环法术位不足，无法施放「${name}」（剩余 ${slots[lv] || 0}）` };
  slots[lv] -= 1;
  const roll = ctx.rng.int(1, 20);
  return { text: `${ctx.sender.name} 施放「${name}」（${lv} 环）！\n法术位剩余 ${slots[lv]}　施法检定 1d20 → ${roll}` };
}

function runLongrest(ctx, args) {
  const card = boundCard(ctx);
  let healed = '';
  if (card && Number.isFinite(Number(card.fields['生命上限']))) {
    card.fields['生命'] = Number(card.fields['生命上限']);
    card.updatedAt = new Date().toISOString();
    healed = `　生命恢复至 ${card.fields['生命']}`;
  }
  const slots = slotsOf(ctx);
  for (const k of Object.keys(slots)) slots[k] = Number(slots[k]) + 0;
  return { text: `${ctx.sender.name} 进行了一次长休。${healed ? '生命回满，' : ''}法术位全部恢复。` };
}

function runDs(ctx, args) {
  const s = ctx.session;
  s.deathSaves = s.deathSaves || {};
  const id = ctx.sender.id;
  if (argStr(args).toLowerCase() === 'reset') { delete s.deathSaves[id]; return { text: '死亡豁免计数已重置' }; }
  const st = s.deathSaves[id] || (s.deathSaves[id] = { s: 0, f: 0 });
  const roll = ctx.rng.int(1, 20);
  if (roll === 20) { delete s.deathSaves[id]; return { text: `死亡豁免 1d20 → 20（大成功）！${ctx.sender.name} 重新站起，生命为 1` }; }
  if (roll === 1) { st.f += 2; } else if (roll >= 10) { st.s += 1; } else { st.f += 1; }
  const verdict = st.s >= 3 ? '（成功×3：稳定下来）' : st.f >= 3 ? '（失败×3：濒死）' : '';
  return { text: `死亡豁免 1d20 → ${roll}　成功 ${st.s}/3　失败 ${st.f}/3 ${verdict}` };
}

registerCmd({ name: 'ss', alias: ['法术位'], group: 'fun', handle: runSs });
registerCmd({ name: 'cast', alias: ['施法'], group: 'fun', handle: runCast });
registerCmd({ name: 'longrest', alias: ['长休'], group: 'fun', handle: runLongrest });
registerCmd({ name: 'ds', alias: ['死亡豁免'], group: 'fun', handle: runDs });

module.exports = { runSs, runCast, runLongrest, runDs };
