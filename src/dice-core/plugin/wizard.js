'use strict';
/* AI 生成向导后端：生成闸 + 试跑 + 准装闸（两道闸）。
 * 契约：createWizard({ host, aiPort, opts }) → { start, trial, install, discard, list, host }。
 * start(ruleText[, {cfg, signal}]) → { ok, draftId, pkg, rounds } | { ok:false, errors[] }（生成闸不过不产生草稿）；
 * trial(draftId[, {rng}]) → { ok, draftId, results[] }；install(draftId) 必须先试跑（NEED_TRIAL 第二道闸）；
 * 草稿只存内存、不落盘、不生效；discard 丢弃；list 列摘要。 */
const crypto = require('node:crypto');
const { generate } = require('./ai-author');
const { check, toRng } = require('../rules');
const { evalCalc } = require('../calc');

function createWizard({ host, aiPort, opts = {} }) {
  const drafts = new Map();                       // draftId -> { pkg, state, rounds }
  const uid = () => crypto.randomBytes(6).toString('hex');
  const fail = (code, why) => ({ ok: false, error: code + ': ' + why });
  /* cfg 惰性求值：opts.cfg 可为函数（注册期不求值），start() 时若未显式传入 o.cfg 才调用。
   * 修复 M3 回归：main.js 注册向导时若同步求值 aiCfg()，未配置 AI 会同步 throw，
   * 导致 whenReady 回调中断、createWindow() 永不执行（窗口不出现、仅 data 文件夹生成）。 */
  const resolveCfg = (o) => {
    if (o.cfg !== undefined) return typeof o.cfg === 'function' ? o.cfg() : o.cfg;
    return typeof opts.cfg === 'function' ? opts.cfg() : opts.cfg;
  };

  async function start(ruleText, o = {}) {
    const rounds = { n: 0 };
    let cfg;
    try { cfg = resolveCfg(o); } catch (err) {
      return { ok: false, errors: [{ path: '$.cfg', code: 'AI_TRANSPORT', msg: 'AI 配置不可用：' + (err && err.message || String(err)) }] };
    }
    const r = await generate(ruleText, aiPort, {
      cfg, signal: o.signal,
      onRound: () => { rounds.n++; }
    });
    if (!r.ok) return r;                          // 第一道闸：生成 + 校验，不过不产生草稿
    const draftId = uid();
    drafts.set(draftId, { pkg: r.pkg, state: 'generated', rounds: rounds.n });
    return { ok: true, draftId, pkg: r.pkg, rounds: rounds.n };
  }

  function trial(draftId, o = {}) {
    const d = drafts.get(draftId);
    if (!d) return fail('NOT_FOUND', '草稿 ' + draftId + ' 不存在');
    if (d.state === 'installed') return fail('ALREADY_INSTALLED', draftId + ' 已安装，不能重复试跑');
    const rng = o.rng || Math.random;
    const pkg = d.pkg;
    const results = [];
    for (const c of (pkg.checks || [])) {
      const r = check(pkg, c.name, {}, rng);
      results.push({
        kind: 'check', name: c.name, expr: c.expr,
        roll: r.ok ? r.roll : null, level: r.ok ? r.level : null,
        text: r.ok ? r.text : ((r.error && r.error.msg) || '试跑失败')
      });
    }
    for (const cmd of (pkg.commands || [])) {
      const exprSrc = String(cmd.run).replace(/^calc:\s*/, '');
      try {
        const res = evalCalc(exprSrc, { rng: toRng(rng) });
        if (!res.ok) throw new Error((res.error && res.error.message) || '表达式求值失败');
        const v = res.value;
        results.push({ kind: 'command', name: cmd.trigger, expr: exprSrc, value: String(v), text: cmd.trigger + ' → ' + String(v) });
      } catch (e) {
        results.push({ kind: 'command', name: cmd.trigger, expr: exprSrc, value: null, text: '试跑失败：' + (e.message || String(e)) });
      }
    }
    d.state = 'trialed';
    return { ok: true, draftId, results };
  }

  function install(draftId) {
    const d = drafts.get(draftId);
    if (!d) return fail('NOT_FOUND', '草稿 ' + draftId + ' 不存在');
    if (d.state === 'installed') return fail('ALREADY_INSTALLED', draftId + ' 已安装');
    if (d.state !== 'trialed') return fail('NEED_TRIAL', draftId + ' 必须先经过测试通道试跑才能安装（两道闸）');
    const r = host.install(d.pkg);                // 第二道闸：准装，落盘进宿主并热加载
    if (!r.ok) return r;
    d.state = 'installed';
    return { ok: true, id: r.id, version: r.version, draftId };
  }

  function discard(draftId) {
    if (!drafts.delete(draftId)) return fail('NOT_FOUND', '草稿 ' + draftId + ' 不存在');
    return { ok: true, draftId };
  }

  function list() {
    return [...drafts].map(([draftId, d]) => ({
      draftId, id: d.pkg.manifest.id, name: d.pkg.manifest.name,
      version: d.pkg.manifest.version, state: d.state, rounds: d.rounds }));
  }

  return { start, trial, install, discard, list, host: () => host };
}
module.exports = { createWizard };
