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
/* ===== U1-8 AI 任务队列 =====
 * 原策略是「同类型任务一次只放行一项，再点直接拒绝」，用户连点多个生成只会被拦。
 * 现改为：同类型已在跑时把新任务「排队」，跑完自动按顺序接力；跨类型仍并行。
 * 队列只存在内存（关掉应用即清空），上限防止无节制堆积把内存和 token 打爆。 */
const aiQueue = [];        // [{ id, name, label, group, reject, start }]
const AI_QUEUE_MAX = 20;
let _aiQid = 0;
function aiQueueInfo() { return aiQueue.map(q => ({ id: q.id, name: q.name, label: q.label, group: q.group })); }
function aiActiveInfo() {
  return Object.keys(aiGroupState).filter(g => aiGroupState[g].count > 0)
    .map(g => ({ group: g, label: aiGroupState[g].label, count: aiGroupState[g].count }));
}
function aiBroadcast() {
  const active = Object.keys(aiGroupState).filter(g => aiGroupState[g].count > 0);
  const label = active.map(g => (active.length === 1 ? '' : (AI_GROUP_LABEL[g] || g) + '：') + aiGroupState[g].label).join('；');
  try {
    ipcRenderer.send('ai:busy', {
      on: active.length > 0 || aiQueue.length > 0,
      label, count: aiGroupRunningCount(), groups: active,
      active: aiActiveInfo(), queued: aiQueue.length, queue: aiQueueInfo()
    });
  } catch (_) {}
}
/* 实际执行一项（已在跑或刚从队列取出时调用）：计数 + 广播 + 结束递减并接力下一项 */
function aiRunTask(task) {
  const group = task.group;
  const st = aiGroupState[group] || (aiGroupState[group] = { count: 0, label: '' });
  st.count++; st.label = task.label; aiBroadcast();
  const done = () => {
    const s = aiGroupState[group];
    if (s) { s.count = Math.max(0, s.count - 1); if (!s.count) s.label = ''; }
    aiPump(group);
    aiBroadcast();
  };
  let p;
  try { p = Promise.resolve(task.run()); } catch (err) { done(); return Promise.reject(err); }
  return p.then(v => { done(); return v; }, e => { done(); throw e; });
}
/* 该组空闲时，把队列里同组的下一项取出来执行（保持同组严格串行） */
function aiPump(group) {
  const st = aiGroupState[group];
  if (st && st.count > 0) return;
  const i = aiQueue.findIndex(q => q.group === group);
  if (i < 0) return;
  const task = aiQueue.splice(i, 1)[0];
  try { task.start(); } catch (_) {}
}
/* 对某类型发起取消（请求新会话中止，安全幂等）；同时清掉该组排队中的任务 */
function aiCancel(group) {
  try { ipcRenderer.send('ai:cancel', { group }); } catch (_) {}
  let dropped = 0;
  for (let i = aiQueue.length - 1; i >= 0; i--) {
    if (aiQueue[i].group === group) {
      const q = aiQueue.splice(i, 1)[0];
      try { q.reject(new Error('AI_CANCELLED 该任务已取消（排队中）')); } catch (_) {}
      dropped++;
    }
  }
  aiBroadcast();
  return { ok: true, group, dropped };
}
/* 清空排队 + 中止全部在飞任务（渲染层「清空排队」用） */
function aiAbortAll() {
  let dropped = 0;
  while (aiQueue.length) {
    const q = aiQueue.shift();
    try { q.reject(new Error('AI_CANCELLED 该任务已取消（排队中）')); } catch (_) {}
    dropped++;
  }
  const groups = Object.keys(aiGroupState).filter(g => aiGroupState[g].count > 0);
  for (const g of groups) { try { ipcRenderer.send('ai:cancel', { group: g }); } catch (_) {} }
  aiBroadcast();
  return { ok: true, dropped, cancelled: groups.length };
}
/* 包一层：按组计数并广播；结束（无论成功或失败）递减并广播，绝不漏掉收尾。
 * 同组在飞时不再拒绝，而是排队等待接力；跨组并行不受影响。 */
function aiGuard(name, call) {
  const label = AI_LABELS[name] || 'AI 处理中';
  const group = AI_GROUPS[name] || 'misc';
  return function () {
    const args = arguments;
    const st = aiGroupState[group];
    if (st && st.count > 0) {
      if (aiQueue.length >= AI_QUEUE_MAX) {
        return Promise.reject(new Error('AI_BUSY 排队已满（上限 ' + AI_QUEUE_MAX + ' 项），请等前面的任务跑完，或点「排队」清空后重试。'));
      }
      return new Promise((resolve, reject) => {
        const task = { id: ++_aiQid, name, label, group, reject, start: null };
        task.start = () => {
          try { resolve(aiRunTask({ group, label, run: () => call.apply(null, args) })); }
          catch (e) { reject(e); }
        };
        aiQueue.push(task);
        aiBroadcast();
      });
    }
    return aiRunTask({ group, label, run: () => call.apply(null, args) });
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
  /* U1-10 数据管家：数据路径 / 体积 / 备份时间线 / 全量整包导出与恢复 */
  dataSteward: () => ipcRenderer.invoke('data:steward'),
  dataExportFull: () => ipcRenderer.invoke('data:exportFull'),
  dataImportFull: () => ipcRenderer.invoke('data:importFull'),
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
  /* 大文件 AI 分析整理进度广播：渲染层用于显示分块/合并进度条 */
  onImportProgress: (cb) => { ipcRenderer.on('import:progress', (_e, v) => cb(v)); },
  /* AI 忙闲广播：渲染层据此显示/隐藏「AI 处理中」提示（含当前在飞的任务类型） */
  aiStatus: {
    on: (cb) => { ipcRenderer.on('ai:busy', (_e, v) => cb(v)); }
  },
  /* 取消某一类型在飞 AI 任务（形参为 AI_GROUPS 中的组名，如 'chat'/'cards'/'map'） */
  aiCancel: (group) => aiCancel(group),
  /* 清空排队并中止全部在飞任务（渲染层「清空排队」按钮用） */
  aiAbortAll: () => aiAbortAll(),
  /* 用量面板：读取/重置本轮 AI 用量统计（token + 耗时） */
  aiUsage: () => ipcRenderer.invoke('ai:usage'),
  aiUsageReset: (bucketMs) => ipcRenderer.invoke('ai:usageReset', bucketMs),
  /* 注：骰娘 AI 开关不设独立 IPC——渲染层直接读写本地存档的 settings.dice.aiSwitches，
   * 与工作台 AI 的凭证/开关彻底分离，互不影响。 */
  /* 取消完成事件：渲染层据此提示「该任务已取消」，避免误以为仍在执行 */
  aiCancelled: {
    on: (cb) => { ipcRenderer.on('ai:cancelled', (_e, v) => cb(v)); }
  },
  /* 提示词中枢（总提示词 + 各场景可编辑提示词 + 分场景记忆文件） */
  promptHubListScenes: () => ipcRenderer.invoke('promptHub:listScenes'),
  promptHubMaster: () => ipcRenderer.invoke('promptHub:masterOf'),
  promptHubSave: (prompts) => ipcRenderer.invoke('promptHub:savePrompts', prompts),
  promptHubListMemories: () => ipcRenderer.invoke('promptHub:listMemories'),
  promptHubRawMemory: (sceneKey) => ipcRenderer.invoke('promptHub:rawMemory', sceneKey),
  promptHubWriteMemory: (sceneKey, text) => ipcRenderer.invoke('promptHub:writeMemory', sceneKey, text),
  promptHubClearMemory: (sceneKey) => ipcRenderer.invoke('promptHub:clearMemory', sceneKey),
  promptDefaults: () => ipcRenderer.invoke('ai:promptDefaults'),
  modRuleDefaults: () => ipcRenderer.invoke('modRuleDefaults'),
  openFile: () => ipcRenderer.invoke('file:open'),
  writeNewFile: (content) => ipcRenderer.invoke('store:writeNewFile', content),
  saveUpload: (name, content) => ipcRenderer.invoke('store:saveUpload', name, content),
  saveText: (filename, content) => ipcRenderer.invoke('store:saveText', filename, content),
  openFolder: (p) => ipcRenderer.invoke('store:openPath', p),
  getFullText: (textPath) => ipcRenderer.invoke('file:getFullText', textPath),
  saveMarkdown: (filename, content) => ipcRenderer.invoke('store:saveMarkdown', filename, content),
  saveImage: (filename, dataUrl) => ipcRenderer.invoke('store:saveImage', filename, dataUrl),
  exportDoc: (payload) => ipcRenderer.invoke('store:exportDoc', payload),
  /* 运行记录（RunLog）：持续记录 + 查看 / 导出 / 上报界面事件 */
  runlog: {
    list: () => ipcRenderer.invoke('runlog:list'),
    read: (opts) => ipcRenderer.invoke('runlog:read', opts || {}),
    folder: () => ipcRenderer.invoke('runlog:folder'),
    export: () => ipcRenderer.invoke('runlog:export'),
    open: () => ipcRenderer.invoke('runlog:open'),
    write: (payload) => { try { ipcRenderer.invoke('runlog:write', payload || {}).catch(() => {}); } catch (_) {} }
  },
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
    status: () => ipcRenderer.invoke('updater:status'),
    download: (opts) => ipcRenderer.invoke('updater:download', opts || {}),
    apply: () => ipcRenderer.invoke('updater:apply'),
    later: () => ipcRenderer.invoke('updater:later'),
    openRelease: (target) => ipcRenderer.invoke('updater:openRelease', target || 'page'),
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
      start: (id, cfg) => ipcRenderer.invoke('diceNet:start', id, cfg),
      stop: (id) => ipcRenderer.invoke('diceNet:stop', id),
      status: (id) => ipcRenderer.invoke('diceNet:status', id)
    },
    /* QQ 直连登入：软件内扫码 / 账密直接登入 QQ，无需 OneBot 协议端中转。
     * login(opts) 的 opts = { mode:'qr'|'password', uin, password }；登录过程状态经 onQqEvent 持续推送。 */
    diceQq: {
      login: (opts) => ipcRenderer.invoke('diceQq:login', opts || {}),
      confirmQr: () => ipcRenderer.invoke('diceQq:confirmQr'),
      slider: (ticket) => ipcRenderer.invoke('diceQq:slider', ticket),
      sms: (code) => ipcRenderer.invoke('diceQq:sms', code),
      logout: () => ipcRenderer.invoke('diceQq:logout'),
      status: () => ipcRenderer.invoke('diceQq:status'),
      signCheck: () => ipcRenderer.invoke('diceQq:signCheck'), // U1-19：签名服务连通性自检
      onQqEvent: (cb) => { ipcRenderer.on('dice-qq:event', (_e, v) => cb(v)); }
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
    /* 骰娘表情包库：查询/收录/打标签/随机调用 */
    meme: {
      list: () => ipcRenderer.invoke('diceMeme:list'),
      add: (token) => ipcRenderer.invoke('diceMeme:add', token),
      tag: (token, tagList, op) => ipcRenderer.invoke('diceMeme:tag', token, tagList, op),
      sample: (tags) => ipcRenderer.invoke('diceMeme:sample', tags || undefined)
    },
    /* KP 建议（批次5）：聚合当前对局上下文在面板内生成建议，不对外发送 */
    kpAdvice: {
      suggest: (opts) => ipcRenderer.invoke('diceKpAdvice:suggest', opts || {}),
      enabled: () => ipcRenderer.invoke('diceKpAdvice:enabled')
    },
    /* 工作台数据变更（群 .kp 写入后触发）→ 界面实时刷新 */
    onWorkspaceChanged: (cb) => { ipcRenderer.on('dice-core:workspace-changed', (_e, v) => cb(v)); },
    /* 引擎状态事件（state/status），不含引擎内部心跳 */
    onEngineEvent: (cb) => { ipcRenderer.on('dice-core:engine-event', (_e, v) => cb(v)); }
  }
});
