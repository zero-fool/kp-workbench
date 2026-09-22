'use strict';
/* brain/state：会话状态（人物卡、绑定、投骰记录、规则、前缀设置）。经 StorePort 持久化。 */

const { getRuleset, listRulesets } = require('../../rules');

function loadRuleIds() {
  return listRulesets().map(p => p.manifest.id);
}

function newSession(id) {
  return {
    id,
    rule: 'plain',
    cards: {},       // 人物名 -> { name, fields: {}, updatedAt }
    bind: null,      // 当前绑定人物卡名
    logs: [],        // 投骰记录：{id,t,expr,seed,detail,total,rule,hidden}
    users: {},       // 签到/情趣：{ id -> { days, favor, lastDate } }
    settings: { prefix: '.', fullwidth: true },
    rngSeed: 'session:' + id,
    rngCounter: 0
  };
}

function createStateStore(opts) {
  const o = opts || {};
  const store = o.store || null;
  const sessions = new Map();
  const KEY = 'dice:sessions';

  function load() {
    if (!store) return;
    try {
      const saved = store.load(KEY);
      if (saved && typeof saved === 'object') {
        for (const id of Object.keys(saved)) {
          sessions.set(id, Object.assign(newSession(id), saved[id]));
        }
      }
    } catch (_) { /* 损坏则从空开始 */ }
  }
  function persist() {
    if (!store) return;
    const snap = {};
    for (const [id, s] of sessions) snap[id] = JSON.parse(JSON.stringify(s));
    store.save(KEY, snap);
  }
  load();

  return {
    getSession(id) {
      if (!sessions.has(id)) sessions.set(id, newSession(id));
      return sessions.get(id);
    },
    setRule(id, ruleId) {
      if (!getRuleset(ruleId)) throw new Error(`规则「${ruleId}」不存在，可用：${loadRuleIds().join('/')}`);
      this.getSession(id).rule = ruleId;
      persist();
      return ruleId;
    },
    listSessions() { return [...sessions.values()]; },
    deleteSession(id) { sessions.delete(id); persist(); },
    prefix() { return '.'; },
    persist,
    reset() { sessions.clear(); persist(); }
  };
}

module.exports = { createStateStore, newSession };