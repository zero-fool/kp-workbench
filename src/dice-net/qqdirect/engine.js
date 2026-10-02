'use strict';
/* QQ 协议引擎装载层：把「用哪个协议库」与「适配器业务逻辑」解耦。
 * - 默认懒加载 icqq（桌面端已随包安装），未安装时不抛到模块顶层，只返回可读原因；
 * - 支持 cfg.enginePath 指向自定义引擎入口，便于换库或离线集成；
 * - 支持 cfg.engine 直接注入引擎对象（单测 / 高级用户自备实现），形状与 icqq 一致：
 *   { createClient(config) → client }。 */

const DEFAULT_MODULE = 'icqq';

/** 装载引擎模块：返回 { ok, mod } 或 { ok:false, reason } */
function loadEngine(opts) {
  const o = opts || {};
  const name = o.enginePath || DEFAULT_MODULE;
  try {
    return { ok: true, mod: require(name), name };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e), name };
  }
}

/** 用引擎创建一个客户端；引擎不合格时抛 TypeError（错误信息可读） */
function createEngineClient(mod, config) {
  if (!mod || typeof mod.createClient !== 'function') {
    throw new TypeError('QQ 协议引擎缺少 createClient(config)');
  }
  return mod.createClient(config);
}

module.exports = { loadEngine, createEngineClient, DEFAULT_MODULE };
