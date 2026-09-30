'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createDiceAi } = require('../src/main/dice-ai');

function makeCtx(overrides) {
  const o = Object.assign({ calls: 0, cfg: { model: 'x', apiKey: 'k', baseUrl: 'http://x', timeoutMs: 1000 } }, overrides || {});
  return {
    ai: {
      chatRaw: async () => { o.calls++; return { ok: true, text: '骰娘回应' }; }
    },
    getContext(feature) {
      if (o.injectError) throw new Error(o.injectError);
      if (o.withBuildSystem !== false && !o.buildSystemOff) {
        return { enabled: o.enabled !== false, cfg: o.cfg, buildSystem: () => '系统人设' };
      }
      return { enabled: o.enabled !== false, cfg: o.cfg };
    },
    _o: o
  };
}

test('总开关关：不调用供应商，返回关闭文案', async () => {
  const ctx = makeCtx({ enabled: false });
  const port = createDiceAi(ctx);
  const r = await port.chat({ feature: 'dice' }, [{ role: 'user', content: 'hi' }]);
  assert.strictEqual(ctx._o.calls, 0);
  assert.strictEqual(r.ok, false);
  assert.match(r.text, /关闭/);
});

test('分开关关（interject）：不调用供应商', async () => {
  const ctx = makeCtx({ enabled: true });
  ctx.getContext = () => ({ enabled: false, cfg: ctx._o.cfg });
  const port = createDiceAi(ctx);
  const r = await port.chat({ feature: 'interject' }, []);
  assert.strictEqual(ctx._o.calls, 0);
  assert.strictEqual(r.ok, false);
});

test('未配置 AI：短路，不调用供应商并给出提示', async () => {
  const ctx = makeCtx({ enabled: true, injectError: '尚未配置 AI 连接' });
  const port = createDiceAi(ctx);
  const r = await port.chat({ feature: 'dice' }, [{ role: 'user', content: 'hi' }]);
  assert.strictEqual(ctx._o.calls, 0);
  assert.match(r.text, /尚未配置|配置/);
});

test('放行：真正调用供应商并返回文本', async () => {
  const ctx = makeCtx({ enabled: true });
  const port = createDiceAi(ctx);
  const r = await port.chat({ feature: 'dice' }, [{ role: 'user', content: '帮我推剧情' }]);
  assert.strictEqual(ctx._o.calls, 1);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, '骰娘回应');
});

test('记忆自动回写：成功后有 remember 钩子则调用并携带 feature 与文本', async () => {
  const remembered = [];
  const ctx = makeCtx({ enabled: true });
  ctx.getContext = (feature) => ({ enabled: true, cfg: ctx._o.cfg, buildSystem: () => 's', remember: (f, t) => remembered.push([f, t]) });
  const port = createDiceAi(ctx);
  const r = await port.chat({ feature: 'kpAdvice' }, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(remembered.length, 1);
  assert.strictEqual(remembered[0][0], 'kpAdvice');
  assert.strictEqual(remembered[0][1], '骰娘回应');
});

test('记忆回写不是硬依赖：未提供 remember 钩子也照常返回（不抛错）', async () => {
  const ctx = makeCtx({ enabled: true, withBuildSystem: true });
  const port = createDiceAi(ctx);
  const r = await port.chat({ feature: 'dice' }, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, '骰娘回应');
});