'use strict';
/* ports/ai：AiPort 契约（逐字来自设计规格 4.1 节）。
 *
 * @typedef {Object} AiPort
 * @property {function(Object, Array, *): Promise} chat
 */

/** M1 离线实现：掷骰与检定永不依赖 AI，AI 能力在 M3 接入 */
function createOfflineAi() {
  return {
    chat() {
      return Promise.resolve({ ok: false, cancelled: false, error: { code: 'AI_UNAVAILABLE', message: 'AI 端口未配置' } });
    }
  };
}

module.exports = { createOfflineAi };