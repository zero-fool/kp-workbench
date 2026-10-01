'use strict';
/* CoC 7th 检定分档（本模块为独立实现）。
 *
 * 判定依据《克苏鲁的呼唤》第七版规则书中公开的「成功等级」定义：
 *   大成功 / 极难成功（≤ 技能值 1/5）/ 困难成功（≤ 技能值 1/2）/
 *   成功（≤ 技能值）/ 失败 / 大失败。
 * 同时收录中文跑团社区常见的 0–7 号房规，方便不同 KP 按自己的桌面习惯切换；
 * 各房规之间只在「大成功 / 大失败」的认定上存在差异，中间三档判定一致。
 *
 * 房规由 .setcoc 按会话设置；.ra 走规则包以保持既有行为，
 * .sc / .rx / .rav / .bav 等统一走本模块。 */

const LEVEL = { 5: '大成功', 4: '极难成功', 3: '困难成功', 2: '成功', 1: '失败', 0: '大失败' };

/* 各分档的判定线（向下取整）。 */
const fifth = s => Math.floor(s / 5);   // 极难成功线：技能值的 1/5
const half = s => Math.floor(s / 2);    // 困难成功线：技能值的 1/2
const tenth = s => Math.floor(s / 10);  // 十分之一线：部分房规的大成功线

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* 中间三档（极难 / 困难 / 成功 / 失败），返回档位编号；
 * 是否把「失败」升格为「大失败」由各房规自行处理。 */
function tiers(R, S) {
  if (R <= fifth(S)) return 4;
  if (R <= half(S)) return 3;
  if (R <= S) return 2;
  return 1;
}

/* 房规表：编号 → 判定函数 (R=骰值 1–100, S=技能值) → 中文档位。 */
const RULES = {
  /* 0 规则书默认：仅出 1 为大成功；出 100，或技能低于 50 且 ≥96，为大失败。 */
  0(R, S) {
    if (R === 100) return LEVEL[0];
    if (R === 1) return LEVEL[5];
    const t = tiers(R, S);
    return t === 1 && S < 50 && R >= 96 ? LEVEL[0] : LEVEL[t];
  },
  /* 1：在默认基础上放宽大成功——技能值达到 50 及以上时，1–5 亦计大成功。 */
  1(R, S) {
    if (R === 100) return LEVEL[0];
    if (R === 1 || (R <= 5 && S >= 50)) return LEVEL[5];
    const t = tiers(R, S);
    return t === 1 && S < 50 && R >= 96 ? LEVEL[0] : LEVEL[t];
  },
  /* 2：大成功须出 1–5 且不超过技能值；出 96–100 一律大失败。 */
  2(R, S) {
    if (R === 100) return LEVEL[0];
    if (R <= 5 && R <= S) return LEVEL[5];
    const t = tiers(R, S);
    return t === 1 && R >= 96 ? LEVEL[0] : LEVEL[t];
  },
  /* 3：固定线——01–05 大成功，96–00 大失败，与技能值无关。 */
  3(R, S) {
    if (R >= 96) return LEVEL[0];
    if (R <= 5) return LEVEL[5];
    return LEVEL[tiers(R, S)];
  },
  /* 4：大成功须出 1–5 且不超过技能值的 1/10；
   *    技能不足 50 时，大失败线自 96 起随技能值上浮（96 + 技能值/10）。 */
  4(R, S) {
    if (R === 100) return LEVEL[0];
    if (R <= 5 && R <= tenth(S)) return LEVEL[5];
    const t = tiers(R, S);
    if (t !== 1) return LEVEL[t];
    return S < 50 && R >= 96 + tenth(S) ? LEVEL[0] : LEVEL[1];
  },
  /* 5：99–100 必为大失败；大成功须出 1–2 且小于技能值的 1/10。 */
  5(R, S) {
    if (R >= 99) return LEVEL[0];
    if (R <= 2 && R < tenth(S)) return LEVEL[5];
    const t = tiers(R, S);
    if (t !== 1) return LEVEL[t];
    return S < 50 && R >= 96 ? LEVEL[0] : LEVEL[1];
  },
  /* 6：六版式判定——不区分极难 / 困难；11 的倍数为暴击（成功侧大成功、失败侧大失败），
   *    另 1 为大成功、100 为大失败。 */
  6(R, S) {
    if (R > S) return (R === 100 || R % 11 === 0) ? LEVEL[0] : LEVEL[1];
    return (R === 1 || R % 11 === 0) ? LEVEL[5] : LEVEL[2];
  },
  /* 7：大失败除 100 外，96–99 随「(90 − 技能值)/20 + 骰值 ≥ 100」判定；
   *    出 1 或不高于技能值 1/5 记极难成功（此房规不单列困难档）。 */
  7(R, S) {
    if (R >= 100) return LEVEL[0];
    if (R >= 96) return (R + (90 - S) / 20 >= 100) ? LEVEL[0] : LEVEL[1];
    if (R === 1 || R <= fifth(S)) return LEVEL[4];
    if (R <= S) return LEVEL[2];
    return LEVEL[1];
  }
};

/** 返回 CoC 分档中文名；rule 为 0-7 的房规编号。 */
function cocGrade(res, rate, rule) {
  const R = clamp(Number(res) || 0, 0, 100);
  const S = Math.max(0, Number(rate) || 0);
  const fn = RULES[Number(rule)] || RULES[0];
  return fn(R, S);
}

/* 名次（越大越好），用于对抗比较。 */
const RANK = { 大成功: 5, 极难成功: 4, 极限成功: 4, 困难成功: 3, 成功: 2, 失败: 1, 大失败: 0 };
function cocRank(level) { return RANK[level] == null ? 2 : RANK[level]; }

/* 会话房规编号：ctx.session.cocRule（.setcoc 设置），默认 0。 */
function sessionCocRule(ctx) {
  const r = ctx && ctx.session && ctx.session.cocRule;
  const n = Number(r);
  return Number.isFinite(n) && n >= 0 && n <= 7 ? n : 0;
}

module.exports = { cocGrade, cocRank, sessionCocRule, COC_RULES: [0, 1, 2, 3, 4, 5, 6, 7] };
