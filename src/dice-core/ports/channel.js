'use strict';
/* ports/channel：ChannelAdapter 契约（逐字来自设计规格 4.1 节）。
 *
 * @typedef {Object} ChannelAdapter
 * @property {string} id
 * @property {function(): ChannelAdapter} start
 * @property {function(): ChannelAdapter} stop
 * @property {function(function(Object): void): void} onInbound
 * @property {function(string, Object): Object} send
 * @property {function(): Object} status
 */

/** 校验某个对象是否满足 ChannelAdapter 形状（供 hub 装配时断言） */
function assertChannel(c) {
  if (!c || typeof c !== 'object') throw new TypeError('ChannelAdapter 必须是对象');
  for (const m of ['start', 'stop', 'onInbound', 'send', 'status']) {
    if (typeof c[m] !== 'function') throw new TypeError(`ChannelAdapter 缺少方法 ${m}()`);
  }
  if (typeof c.id !== 'string' || !c.id) throw new TypeError('ChannelAdapter.id 必须是字符串');
  return c;
}

module.exports = { assertChannel };