'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

/* 自研骰娘内核（M1）：在 preload 进程内直接 require dice-core（零 IPC、同步可用）。
 * M1 范围：内核求值引擎供本地投骰面板换用。contextBridge 暴露纯函数与工厂；
 * 类（Rng）不跨桥，改由 makeRng(seed) 工厂返回 {int,pick}，M2/M3 再接入端口与通道服务。 */
const diceCoreExpr = require('./dice-core/expr');
const diceCoreRules = require('./dice-core/rules');
/* M3 收口：window.diceCore 只保留「同步求值内核」（本地投骰面板用），
 * 插件 / 向导 / 工作台等通道统一归入 window.api.diceCore（见下方 api 命名空间）。 */
const diceCore = {
  parseExpr: diceCoreExpr.parseExpr,
  roll: diceCoreExpr.rollExpr,
  check: diceCoreRules.check,
  makeRng(seed) {
    const r = new diceCoreExpr.Rng(seed);
    return { int: (a, b) => r.int(a, b), pick: (arr) => r.pick(arr) };
  }
};

/* ---- AI 请求统一守卫：按任务类型分队列，可取消 ----
 * 渲染层看不到请求进度，所以在这一层把每个 AI 接口包一遍：
 *   ① 请求开始/结束时向渲染层广播 ai:busy，由界面统一亮起「AI 处理中」提示（任意界面都生效）；
 *   ② 不再用全局单飞锁死整个应用，而是按「任务类型」分队列：同一类型一次只放行一项，
 *      未完成时同类型的再次调用会被拦下并说明原因；不同类型（如对话 vs 地图生成 vs 剧本分幕）
 *      可以并行，长任务不再占用整条通道；
 *   ③ 每项请求都带取消入口：渲染层可对某一类型发起取消，主进程会中止对应在飞请求。 */
const AI_LABELS = {
  aiChat: 'AI 对话',
  aiParse: 'AI 解析拆分',
  aiSuggestText: 'AI 带团建议',
  breakdownScenario: 'AI 剧本分幕',
  plotSummary: 'AI 提炼剧情要点',
  suggestStory: 'AI 分析剧情建议',
  aiGenContent: 'AI 生成资料内容',
  aiGenEntity: 'AI 生成资料卡',
  aiGenCards: 'AI 提取资料卡',
  aiGenBoard: 'AI 设计地图',
  aiGenTemplateForRules: 'AI 生成卡片模板',
  aiPolish: 'AI 润色',
  aiPolishBatch: 'AI 批量润色',
  aiWriteScript: 'AI 编写剧本全文',
  aiTest: 'AI 连通性测试',
  aiAudit: 'AI 数据审查',
  relationsSuggest: 'AI 补全关系',
  splitImport: 'AI 拆分导入资料',
  analyzeImport: 'AI 分析导入资料'
};
/* 任务类型 → 队列组：同组互斥、跨组并行。
 * chat=对话类、cards=资料登记/生成类、scenario=剧本分幕、map=地图设计、tpl=模板、sys=连通性/审查。 */
const AI_GROUPS = {
  aiChat: 'chat', aiSuggestText: 'chat', plotSummary: 'chat', suggestStory: 'chat', aiAudit: 'chat', relationsSuggest: 'chat',
  aiParse: 'cards', aiGenContent: 'cards', aiGenEntity: 'cards', aiGenCards: 'cards', aiPolish: 'cards', aiPolishBatch: 'cards', aiWriteScript: 'cards', splitImport: 'cards', analyzeImport: 'cards',
  breakdownScenario: 'scenario',
  aiGenBoard: 'map',
  aiGenTemplateForRules: 'tpl',
  aiTest: 'sys'
};
const AI_GROUP_LABEL = { chat: '对话类任务', cards: '资料类任务', scenario: '剧本分幕', map: '地图生成', tpl: '模板生成', sys: '连接测试/审查', misc: 'AI 任务' };
const aiGroupState = {}; // group -> { count, label }
function aiGroupRunningCount() { let n = 0; for (const g in aiGroupState) n += aiGroupState[g].count; return n; }
function aiBroadcast() {
  const active = Object.keys(aiGroupState).filter(g => aiGroupState[g].count > 0);
  const label = active.map(g => (active.length === 1 ? '' : (AI_GROUP_LABEL[g] || g) + '：') + aiGroupState[g].label).join('；');
  try { ipcRenderer.send('ai:busy', { on: active.length > 0, label, count: aiGroupRunningCount(), groups: active }); } catch (_) {}
}
/* 对某类型发起取消（请求新会话中止，安全幂等） */
function aiCancel(group) {
  try { ipcRenderer.send('ai:cancel', { group }); } catch (_) {}
  return { ok: true, group };
}
/* 包一层：按组计数并广播；结束（无论成功或失败）递减并广播，绝不漏掉收尾。
 * 同组在飞时拦截并说明原因；跨组并行不受影响。 */
function aiGuard(name, call) {
  const label = AI_LABELS[name] || 'AI 处理中';
  const group = AI_GROUPS[name] || 'misc';
  return function () {
    const st = aiGroupState[group] || (aiGroupState[group] = { count: 0, label: '' });
    if (st.count > 0) {
      return Promise.reject(new Error('AI_BUSY 正在处理「' + (st.label || label)
        + '」。同类型任务一次只发一项，请等它完成后再试；不同类型（如对话/地图）可同时进行。'));
    }
    st.count++; st.label = label; aiBroadcast();
    const done = () => { const s = aiGroupState[group]; if (s) { s.count = Math.max(0, s.count - 1); if (!s.count) s.label = ''; } aiBroadcast(); };
    let p;
    try { p = Promise.resolve(call.apply(null, arguments)); } catch (err) { done(); return Promise.reject(err); }
    return p.then(v => { done(); return v; }, e => { done(); throw e; });
  };
}

contextBridge.exposeInMainWorld('diceCore', diceCore);

contextBridge.exposeInMainWorld('api', {
  getAll: () => ipcRenderer.invoke('store:getAll'),
  getPathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (_) { return f && f.path || ''; } },
  save: (d) => ipcRenderer.invoke('store:save', d),
  backup: () => ipcRenderer.invoke('store:backup'),
  openFolder: () => ipcRenderer.invoke('store:openFolder'),
  importLegacyData: () => ipcRenderer.invoke('store:importLegacyData'),
  dataInfo: () => ipcRenderer.invoke('store:dataInfo'),
  /* —— 以下为 AI 接口：均已套上「提示 + 防重复」守卫 ——
   * 注意末尾的 ()：aiGuard 返回的是「被守卫过的函数」，这里必须立刻调用它才会真正走守卫，
   * 只写 aiGuard(...) 而不调用，等于守卫没生效（请求照发、提示不亮）。 */
  aiChat: (...a) => aiGuard('aiChat', () => ipcRenderer.invoke('ai:chat', ...a))(),
  aiParse: (...a) => aiGuard('aiParse', () => ipcRenderer.invoke('ai:parse', ...a))(),
  aiSuggestText: (...a) => aiGuard('aiSuggestText', () => ipcRenderer.invoke('ai:suggestText', ...a))(),
  breakdownScenario: (...a) => aiGuard('breakdownScenario', () => ipcRenderer.invoke('ai:breakdownScenario', ...a))(),
  plotSummary: (...a) => aiGuard('plotSummary', () => ipcRenderer.invoke('ai:plotSummary', ...a))(),
  suggestStory: (...a) => aiGuard('suggestStory', () => ipcRenderer.invoke('ai:suggestStory', ...a))(),
  aiGenContent: (...a) => aiGuard('aiGenContent', () => ipcRenderer.invoke('ai:genContent', ...a))(),
  aiGenEntity: (...a) => aiGuard('aiGenEntity', () => ipcRenderer.invoke('ai:genEntity', ...a))(),
  aiGenCards: (...a) => aiGuard('aiGenCards', () => ipcRenderer.invoke('ai:genCards', ...a))(),
  aiGenBoard: (...a) => aiGuard('aiGenBoard', () => ipcRenderer.invoke('ai:genBoard', ...a))(),
  aiGenTemplateForRules: (...a) => aiGuard('aiGenTemplateForRules', () => ipcRenderer.invoke('ai:genTemplateForRules', ...a))(),
  aiPolish: (...a) => aiGuard('aiPolish', () => ipcRenderer.invoke('ai:polish', ...a))(),
  aiPolishBatch: (...a) => aiGuard('aiPolishBatch', () => ipcRenderer.invoke('ai:polishBatch', ...a))(),
  aiWriteScript: (...a) => aiGuard('aiWriteScript', () => ipcRenderer.invoke('ai:writeScript', ...a))(),
  aiTest: (...a) => aiGuard('aiTest', () => ipcRenderer.invoke('ai:test', ...a))(),
  aiAudit: (...a) => aiGuard('aiAudit', () => ipcRenderer.invoke('ai:audit', ...a))(),
  relationsSuggest: (...a) => aiGuard('relationsSuggest', () => ipcRenderer.invoke('ai:relationsSuggest', ...a))(),
  splitImport: (...a) => aiGuard('splitImport', () => ipcRenderer.invoke('file:splitImport', ...a))(),
  analyzeImport: (...a) => aiGuard('analyzeImport', () => ipcRenderer.invoke('file:analyzeImport', ...a))(),
  /* AI 忙闲广播：渲染层据此显示/隐藏「AI 处理中」提示（含当前在飞的任务类型） */
  aiStatus: {
    on: (cb) => { ipcRenderer.on('ai:busy', (_e, v) => cb(v)); }
  },
  /* 取消某一类型在飞 AI 任务（形参为 AI_GROUPS 中的组名，如 'chat'/'cards'/'map'） */
  aiCancel: (group) => aiCancel(group),
  /* 用量面板：读取/重置本轮 AI 用量统计（token + 耗时） */
  aiUsage: () => ipcRenderer.invoke('ai:usage'),
  aiUsageReset: (bucketMs) => ipcRenderer.invoke('ai:usageReset', bucketMs),
  /* 取消完成事件：渲染层据此提示「该任务已取消」，避免误以为仍在执行 */
  aiCancelled: {
    on: (cb) => { ipcRenderer.on('ai:cancelled', (_e, v) => cb(v)); }
  },
  promptDefaults: () => ipcRenderer.invoke('ai:promptDefaults'),
  modRuleDefaults: () => ipcRenderer.invoke('modRuleDefaults'),
  openFile: () => ipcRenderer.invoke('file:open'),
  writeNewFile: (content) => ipcRenderer.invoke('store:writeNewFile', content),
  saveUpload: (name, content) => ipcRenderer.invoke('store:saveUpload', name, content),
  saveText: (filename, content) => ipcRenderer.invoke('store:saveText', filename, content),
  getFullText: (textPath) => ipcRenderer.invoke('file:getFullText', textPath),
  saveMarkdown: (filename, content) => ipcRenderer.invoke('store:saveMarkdown', filename, content),
  saveImage: (filename, dataUrl) => ipcRenderer.invoke('store:saveImage', filename, dataUrl),
  exportDoc: (payload) => ipcRenderer.invoke('store:exportDoc', payload),
  archives: {
    list: () => ipcRenderer.invoke('archive:list'),
    create: (name) => ipcRenderer.invoke('archive:create', name),
    switch: (name) => ipcRenderer.invoke('archive:switch', name),
    duplicate: (name) => ipcRenderer.invoke('archive:duplicate', name),
    del: (name) => ipcRenderer.invoke('archive:delete', name)
  },
  backups: {
    list: () => ipcRenderer.invoke('backup:list'),
    restore: (file) => ipcRenderer.invoke('backup:restore', file)
  },
  snapshots: {
    list: () => ipcRenderer.invoke('snapshot:list'),
    restore: (file) => ipcRenderer.invoke('snapshot:restore', file)
  },
  readSheet: (buf) => ipcRenderer.invoke('file:readSheet', buf),
  importFile: (userPath) => ipcRenderer.invoke('file:importFile', userPath || ''),
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    state: (cb) => { ipcRenderer.on('updater:state', (_e, v) => cb(v)); }
  },
  winCtrl: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMax: () => ipcRenderer.invoke('win:toggleMax'),
    isMaximized: () => ipcRenderer.invoke('win:isMax'),
    close: () => ipcRenderer.invoke('win:close'),
    onMaximized: (cb) => { ipcRenderer.on('win:maximized', (_e, v) => cb(v)); }
  },
  /* 骰娘内核统一接口（M3 收口）：所有通道归入 diceCore.*，旧 window.api.dice 全部退役。
   * engine 仅报告新内核运行态；插件/向导/工作台在分区 5；骰娘工作台沿用 diceNet/log/reply/sim。 */
  diceCore: {
    engine: { status: () => ipcRenderer.invoke('diceCore:engineStatus') },
    /* 插件工坊（分区 5）：列表/启停/编辑 JSON/回滚/导出，经主进程 PluginHost */
    plugins: {
      list: () => ipcRenderer.invoke('diceCore:pluginsList'),
      get: (id) => ipcRenderer.invoke('diceCore:pluginsGet', id),
      toggle: (id, enabled) => ipcRenderer.invoke('diceCore:pluginsToggle', id, enabled),
      saveJson: (id, jsonText) => ipcRenderer.invoke('diceCore:pluginsSaveJson', id, jsonText),
      rollback: (id) => ipcRenderer.invoke('diceCore:pluginsRollback', id),
      export: (id) => ipcRenderer.invoke('diceCore:pluginsExport', id)
    },
    /* AI 生成向导（分区 5）：第一道闸生成/取消 → 试跑 → 第二道闸安装/丢弃 */
    wizard: {
      start: (ruleText) => ipcRenderer.invoke('diceCore:wizardStart', ruleText),
      abort: (token) => ipcRenderer.invoke('diceCore:wizardAbort', token),
      trial: (draftId) => ipcRenderer.invoke('diceCore:wizardTrial', draftId),
      install: (draftId) => ipcRenderer.invoke('diceCore:wizardInstall', draftId),
      discard: (draftId) => ipcRenderer.invoke('diceCore:wizardDiscard', draftId)
    },
    /* 工作台数据（Task 6 WorkspaceDataPort，主进程直连 store） */
    workspace: {
      list: (kind) => ipcRenderer.invoke('diceCore:workspaceList', kind),
      get: (kind, key) => ipcRenderer.invoke('diceCore:workspaceGet', kind, key),
      create: (kind, item) => ipcRenderer.invoke('diceCore:workspaceCreate', kind, item),
      update: (kind, key, patch) => ipcRenderer.invoke('diceCore:workspaceUpdate', kind, key, patch),
      remove: (kind, key) => ipcRenderer.invoke('diceCore:workspaceRemove', kind, key),
      audit: () => ipcRenderer.invoke('diceCore:workspaceAudit')
    },
    /* 独立 AI 端口（OpenAI 兼容），供投骰台 AI 定向判定独立调用，不依赖工作台全局 AI */
    ai: { chat: (cfg, messages) => ipcRenderer.invoke('diceCore:aiChat', cfg, messages) },
    /* 骰娘工作台（分区 2/3/4/6），自旧 dice.* 迁移，通道不变 */
    diceNet: {
      list: () => ipcRenderer.invoke('diceNet:list'),
      start: (id) => ipcRenderer.invoke('diceNet:start', id),
      stop: (id) => ipcRenderer.invoke('diceNet:stop', id),
      status: (id) => ipcRenderer.invoke('diceNet:status', id)
    },
    state: {
      load: (key) => ipcRenderer.invoke('diceState:load', key),
      save: (key, value) => ipcRenderer.invoke('diceState:save', key, value),
      backup: () => ipcRenderer.invoke('diceState:backup')
    },
    log: {
      query: (o) => ipcRenderer.invoke('diceLog:query', o),
      export: () => ipcRenderer.invoke('diceLog:export')
    },
    reply: {
      load: () => ipcRenderer.invoke('diceReply:load'),
      save: (p) => ipcRenderer.invoke('diceReply:save', p),
      import: (t) => ipcRenderer.invoke('diceReply:import', t)
    },
    sim: {
      send: (o) => ipcRenderer.invoke('diceSim:send', o)
    },
    /* 工作台数据变更（群 .kp 写入后触发）→ 界面实时刷新 */
    onWorkspaceChanged: (cb) => { ipcRenderer.on('dice-core:workspace-changed', (_e, v) => cb(v)); },
    /* 引擎状态事件（state/status），不含引擎内部心跳 */
    onEngineEvent: (cb) => { ipcRenderer.on('dice-core:engine-event', (_e, v) => cb(v)); }
  }
});
