# 05 · 渲染层 renderer

`src/renderer` 是 Electron 渲染进程（UI 层）。它**不直接访问 Node/文件系统**，所有能力通过 [preload.js](file:///workspace/src/preload.js) 暴露的 `window.api` / `window.diceCore` 走 IPC 到主进程。

## 1. 文件构成

| 文件 | 大小量级 | 职责 |
| ---- | ---- | ---- |
| [index.html](file:///workspace/src/renderer/index.html) | 中 | 页面骨架：图标精灵、顶栏、侧栏、内容区、AI 抽屉、状态栏、各类模态框 |
| [app.js](file:///workspace/src/renderer/app.js) | **约 600KB** | 全部 UI 逻辑：状态管理、视图路由、渲染、事件绑定 |
| [styles.css](file:///workspace/src/renderer/styles.css) | 大 | 主题皮肤（含暮光护眼）、卡片密度、布局样式 |
| [dice-ui/](file:///workspace/src/renderer/dice-ui) | — | 骰娘工作台专用 UI 组件（UMD，可被 node:test 直接测） |
| [test_dice.html](file:///workspace/src/renderer/test_dice.html) | 小 | 骰娘内核浏览器侧调试页 |
| `assets/` | — | 徽记、空状态插画等图片资源 |

## 2. 页面结构（index.html）

```
#app.app
├─ header.topbar#winBar          无边框窗口标题栏（最小化/最大化/关闭）
├─ .body
│  ├─ nav.sidebar#sidebar        分组折叠导航（details.snav + button.nav[data-view]）
│  ├─ main.content#content       视图内容容器
│  └─ aside.chatdrawer#chatdrawer  AI 侧栏对话抽屉（可隐藏）
└─ footer.statusbar#statusBar    状态栏：版本、备份时间、骰娘连接状态
```

页面顶部是 SVG **图标精灵**（`<symbol id="i-*">`，统一 24 格栅、线性描边、随 `currentColor` 取色），通过 `<use href="#i-*">` 复用。

CSP 限制（head 中声明）：`default-src 'self'`；脚本/样式仅 `'self' 'unsafe-inline'`；图片允许 `data:`。即渲染层不加载外部脚本与远程资源。

## 3. 侧栏导航与视图路由

侧栏按钮用 `data-view="<view>"` 标识，`switchView(view)` 是**唯一路由入口**（[app.js#L800-L831](file:///workspace/src/renderer/app.js#L800-L831)）：

```
switchView(view)
  ├─ S.view = view；navPush(view)（浏览器式前进/后退）
  ├─ 高亮对应导航、自动展开所在分组
  └─ 分派到 render* 函数：
     dash          总览看板        renderDash
     search        全局搜索        renderGlobalSearch
     <entities[k]> 七类资料卡       renderDataView(kind)   ← pcs/npcs/regions/logs/mobs/rules/lore
     encounter     临场战斗        renderEncounter
     relations     关系网          renderRelations
     tags          标签            renderTags
     maps          地图            renderMaps
     stats         统计分析        renderStats
     rawtext       原始文本        renderRawText
     ai             AI 助手        renderAI
     persona        AI 设定        renderPersona
     aiconf         AI 配置        renderAIConf
     polish         记录润色        renderPolish
     dicehost       连 QQ 骰娘     renderDiceHost
     dice           本地掷骰        renderDice
     dicework       骰娘工作台      renderDiceWork
     diceai         AI 功能开关     renderDiceAI
     diceaichat     群聊 AI 行为    renderDiceAIChat
     dicememe       表情包库        renderDiceMeme
     settings       偏好设置        renderSettings
     help           帮助中心        renderHelp
     changelog      更新公告        renderChangelog
     runlog         运行记录        renderRunlog
```

视图分组（侧栏 `details.snav`）：工作台资料 / 关系与地理 / AI 与创作 / 骰娘 / 系统。

## 4. app.js 组织

`app.js` 是一个大 IIFE，主要约定：

- **状态 `S`**：集中管理 `data`（档案数据，含 `entities`）、`settings`、`meta`、`activeProfile`、`view` 等。渲染函数读取 `S` 生成 HTML。
- **选择器 `q(id)`**：`document.getElementById` 的简写。
- **视图渲染 `render*(...)`**：每个视图一个函数，返回/写入 HTML，再绑定该视图的事件。
- **事件委托 + 直接绑定**：侧栏 `data-view` 点击 → `switchView`；其余在渲染后 `q(...).onclick/oninput`。
- **`window.WB` 命名空间**：文件早期即 `window.WB = window.WB || {}`（[app.js#L7](file:///workspace/src/renderer/app.js#L7)），后续 `window.WB = Object.assign(window.WB, {…})`（[app.js#L8129](file:///workspace/src/renderer/app.js#L8129)）挂载供内联事件调用的方法。
- **版本常量**：顶部 `APP_VERSION = '3.2.1'` 与 `CHANGELOG`（[app.js#L19-L20](file:///workspace/src/renderer/app.js#L19-L20)）。`APP_VERSION` 必须与 `package.json` 的 `version` 一致（`npm test` 校验）；`CHANGELOG` 同时是应用内「更新公告」与 Release 正文来源。

> 注意：`app.js` 体量大，修改时优先定位到具体 `render*` / 事件函数；不要整文件重排。

## 5. preload 契约（渲染层可用 API）

[preload.js](file:///workspace/src/preload.js) 通过 `contextBridge` 暴露两个全局对象：

### 5.1 `window.diceCore`（同步求值内核）

零 IPC、同步可用，供本地投骰面板：

```js
window.diceCore = {
  parseExpr, roll, check,
  makeRng(seed) → { int(a,b), pick(arr) }   // 类 Rng 不跨桥，用工厂
}
```

### 5.2 `window.api`（IPC 接口）

按命名空间分组（与 [02-主进程](02-主进程.md) 的 IPC 通道一一对应）：

| 命名空间 | 能力 |
| ---- | ---- |
| 顶层 | `getAll/save/backup/openFolder/dataInfo/importLegacyData`、`openFile/readSheet/importFile/getFullText`、`saveUpload/saveText/saveMarkdown/saveImage/exportDoc/writeNewFile` |
| AI | `aiChat/aiParse/aiGenContent/aiGenCards/aiPolish/…`（均经 `aiGuard` 守卫）、`aiStatus.on`、`aiCancel`、`aiUsage/aiUsageReset`、`aiSwitchesGet/Set`、`onImportProgress` |
| 提示词 | `promptHubListScenes/promptHubMaster/promptHubSave/promptHubListMemories/promptHubRawMemory/promptHubWriteMemory/promptHubClearMemory`、`promptDefaults/modRuleDefaults` |
| `runlog` | `list/read/folder/export/open/write` |
| `archives` | `list/create/switch/duplicate/del` |
| `backups` / `snapshots` | `list/restore` |
| `updater` | `check/status/download/apply/later/openRelease/state` |
| `winCtrl` | `minimize/toggleMax/isMaximized/close/onMaximized` |
| `diceCore` | `engine` / `plugins` / `wizard` / `workspace` / `ai` / `diceNet` / `state` / `log` / `reply` / `sim` / `meme` / `kpAdvice`，以及 `onWorkspaceChanged` / `onEngineEvent` |

### 5.3 AI 请求守卫 `aiGuard`（重要）

preload 把所有 AI 接口包了一层守卫（[preload.js#L21-L89](file:///workspace/src/preload.js#L21-L89)）：

1. **广播忙闲**：请求开始/结束向渲染层发 `ai:busy`，界面统一亮起「AI 处理中」提示（任意界面生效）。
2. **按任务类型分队列**：同类型一次只放行一项，未完成时同类型再调用被拦下并说明原因；不同类型（对话 vs 地图 vs 分幕）可并行，长任务不霸占整条通道。
3. **可取消**：`aiCancel(group)` 对某一类型发起取消。

映射关系：`AI_LABELS`（任务中文名）+ `AI_GROUPS`（任务 → 组：`chat` / `cards` / `scenario` / `map` / `tpl` / `sys`）。

> 易错点：`aiGuard(name, fn)` 返回的是「被守卫的函数」，必须**立即调用**（`(…a) => aiGuard('aiChat', () => …)()`），否则守卫不生效。

## 6. dice-ui 组件

骰娘工作台专用组件，**UMD 双环境**：Node 下 `module.exports` 供 `node:test` 测试，浏览器下挂 `window.DiceUI*` 供 app.js 复用。

| 文件 | 浏览器全局 | 导出/职责 |
| ---- | ---- | ---- |
| [conn-center.js](file:///workspace/src/renderer/dice-ui/conn-center.js) | `window.DiceUIConnCenter` | 连接中心（通道列表/启动/停止/状态） |
| [conn-log.js](file:///workspace/src/renderer/dice-ui/conn-log.js) | `window.DiceUIConnLog` | `renderLogRows` / `filterLogs` / `logSummary` / `createLogPanel`：指令日志视图模型（纯函数） |
| [reply-editor.js](file:///workspace/src/renderer/dice-ui/reply-editor.js) | `window.DiceUIReplyEditor` | 文案与人设编辑 |
| [sim-chat.js](file:///workspace/src/renderer/dice-ui/sim-chat.js) | `window.DiceUISimChat` | 应用内测试通道对话面板 |
| [workshop.js](file:///workspace/src/renderer/dice-ui/workshop.js) | `window.DiceUI` | 插件工坊（列表/启停/编辑/回滚/导出） |
| [wizard.js](file:///workspace/src/renderer/dice-ui/wizard.js) | `window.DiceUI` | AI 生成插件向导（生成/试跑/安装/丢弃） |

> 注意：`workshop.js` 与 `wizard.js` 都挂 `window.DiceUI`，必须**合并**（`Object.assign`）而非直接覆盖，否则后加载者会抹掉前者方法。

## 7. 交互与快捷键

- 全局快捷键：`Ctrl+K` 命令面板、`Ctrl+Shift+F` 全局搜索、`Ctrl+N` 新建卡片、`Ctrl+D` 骰娘、`Ctrl+E` 临场战斗、`Ctrl+T` 统计分析、`Esc` 关闭浮层。
- 主题：`<html data-theme="parchment">` 切换皮肤；卡片密度可调。
- 状态栏实时显示：应用版本、最近备份时间、骰娘连接状态（通道名汇总）。
- 长任务反馈：AI 处理中提示条（含任务类型与已用时长）、导入分块进度条、更新下载进度。

## 8. 与主进程的通信约定

- 请求应答用 `ipcRenderer.invoke` / `ipcMain.handle`（`window.api.*`）。
- 单向通知/广播用 `ipcRenderer.send` / `ipcMain.on`（如 `ai:busy`、`ai:cancel`）与 `webContents.send`（如 `dice-core:workspace-changed`、`updater:state`）。
- 所有通道的接线正确性由 [tools/wiring-audit.js](file:///workspace/tools/wiring-audit.js) 在 `npm run verify` 中强制校验（比对 preload 的 invoke 与主进程的 handle、`window.api.*` 暴露与使用、`window.WB` 定义与引用、重复 id / 重复函数定义、内联事件裸调用等）。
