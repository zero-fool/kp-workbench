'use strict';
/* CoC 7th 分档（忠实移植 Dice-Next 的 RollSuccessLevel）：房规 rule 0-7，
 * 由 .setcoc 按会话设置。.ra 走规则包（保持既有行为），.sc/.rx/.rav/.bav 等走这里。 */

const LEVEL = { 5: '大成功', 4: '极难成功', 3: '困难成功', 2: '成功', 1: '失败', 0: '大失败' };

/** 返回 CoC 分档中文名；rule 为 0-7 的房规编号。 */
function cocGrade(res, rate, rule) {
  const R = Number(res) || 0;
  const S = Number(rate) || 0;
  const r = Number(rule) || 0;
  switch (r) {
    case 1:
      if (R === 100) return LEVEL[0];
      if (R === 1 || (R <= 5 && S >= 50)) return LEVEL[5];
      if (R <= Math.floor(S / 5)) return LEVEL[4];
      if (R <= Math.floor(S / 2)) return LEVEL[3];
      if (R <= S) return LEVEL[2];
      return (S >= 50 || R < 96) ? LEVEL[1] : LEVEL[0];
    case 2:
      if (R === 100) return LEVEL[0];
      if (R <= 5 && R <= S) return LEVEL[5];
      if (R <= Math.floor(S / 5)) return LEVEL[4];
      if (R <= Math.floor(S / 2)) return LEVEL[3];
      if (R <= S) return LEVEL[2];
      return R < 96 ? LEVEL[1] : LEVEL[0];
    case 3:
      if (R >= 96) return LEVEL[0];
      if (R <= 5) return LEVEL[5];
      if (R <= Math.floor(S / 5)) return LEVEL[4];
      if (R <= Math.floor(S / 2)) return LEVEL[3];
      if (R <= S) return LEVEL[2];
      return LEVEL[1];
    case 4:
      if (R === 100) return LEVEL[0];
      if (R <= 5 && R <= Math.floor(S / 10)) return LEVEL[5];
      if (R <= Math.floor(S / 5)) return LEVEL[4];
      if (R <= Math.floor(S / 2)) return LEVEL[3];
      if (R <= S) return LEVEL[2];
      return (S >= 50 || R < 96 + Math.floor(S / 10)) ? LEVEL[1] : LEVEL[0];
    case 5:
      if (R >= 99) return LEVEL[0];
      if (R <= 2 && R < Math.floor(S / 10)) return LEVEL[5];
      if (R <= Math.floor(S / 5)) return LEVEL[4];
      if (R <= Math.floor(S / 2)) return LEVEL[3];
      if (R <= S) return LEVEL[2];
      return (S >= 50 || R < 96) ? LEVEL[1] : LEVEL[0];
    case 6:
      if (R > S) return (R === 100 || R % 11 === 0) ? LEVEL[0] : LEVEL[1];
      return (R === 1 || R % 11 === 0) ? LEVEL[5] : LEVEL[2];
    case 7:
      if (R >= 100) return LEVEL[0];
      if (R >= 96) return ((90 - S) / 20 + R >= 100) ? LEVEL[0] : LEVEL[1];
      if (R === 1 || R <= Math.floor(S / 5)) return LEVEL[4];
      if (R <= S) return LEVEL[2];
      return LEVEL[1];
    case 0:
    default:
      if (R === 100) return LEVEL[0];
      if (R === 1) return LEVEL[5];
      if (R <= Math.floor(S / 5)) return LEVEL[4];
      if (R <= Math.floor(S / 2)) return LEVEL[3];
      if (R <= S) return LEVEL[2];
      return (S >= 50 || R < 96) ? LEVEL[1] : LEVEL[0];
  }
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
