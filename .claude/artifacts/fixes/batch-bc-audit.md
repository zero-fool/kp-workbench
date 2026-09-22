# Bug 批次：批次 B/C 功能上线后代码排查与整改

> Status: FIXED
> Mode: 默认（多缺陷批量排查）
> Severity: blocker（关系网一键整理、剧情要点写入记忆、椭圆区域选中三项为功能级失效）
> Author: 零弈秋
> Last updated: 2026-09-13
> 版本：2.4.3 → 2.4.4（测试版·修复）

## Symptom

批次 B（关系网/地图深化）与批次 C（AI 自动产出/记忆压缩）交付后，按流程做代码排查，发现以下现象级问题：

1. 关系网只要存在连线，点「⟳ 一键整理」即报错中断，整理功能完全不可用。
2. 关系网第二次进入时画布空白，需拖动/缩放一次才恢复。
3. AI 补全关系预览里取消勾选的操作仍会被应用（或被跳过）。
4. 地图上画的椭圆区域/椭圆迷雾无法点选，双击改名、删除随之失效。
5. 地图标记点按「取消」后仍残留在数据里。
6. 侧栏 AI 的「剧情要点 → 写入长期记忆」点击后毫无反应。
7. 「剧情建议」生成的剧情点入库后标题变成“未命名”。
8. 设置 → 字段中的模板相关入口点击报 `WB.xxx is not a function`。

## Expected

上述功能按设计正常可用：一键整理完成排布、二次进入正常渲染、勾选结果与实际应用一致、椭圆可选中编辑、取消即回滚、记忆写入成功并在后续对话注入、剧情点标题与钩子正确落库。

## Reproduction

- 关系网：造 2 个以上节点 + 1 条连线 → 点「⟳ 一键整理」→ 控制台抛 `TypeError: Cannot read properties of undefined (reading 'length')`。
- 椭圆：画一个椭圆区域 → 用选择工具点它 → 无选中（`mapHitTest` 返回 null）。
- 记忆写入：先在「AI 配置 → 长期记忆」加一条 → 点侧栏「☉ 要点」→ 确认写入 → 无反应（`s.trim is not a function`）。
- 自动化复现：`node /data/user/work/regress.test.js`（修复前 12 项中 7 项 RED）。

## Hypotheses & diagnosis

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | 关系网整理与新加入的“孤立点外移”逻辑数据结构不一致 | confirmed（root cause） | `relComponents()` 返回 `string[][]`，`relLayout()` 读 `c.ids.length`；测试 T1 显示实际结构 `[["a","b"],["c"]]` |
| H2 | 关系网二次空白与画布元素生命周期有关 | confirmed（root cause） | `contentInner()` 卸载旧 svg 后仍 `relPaint()`，随后才 `_rel.svg = q('relSvg')`，绘制写进了游离节点 |
| H3 | 椭圆命中失败是坐标量纲问题 | confirmed（root cause） | 存储为归一化比例、绘制乘回像素，命中却用归一化半径作分母；测试 T2 显示仅正中心偶然命中 |
| H4 | 记忆写入失败因条目结构不一致 | confirmed（root cause） | `getMemory()` 返回 `{text,t}` 对象数组，`commitPlotPoints` 按字符串 `s.trim()` 处理 |
| H5 | 剧情点标题丢失因字段名不一致 | confirmed（root cause） | `DEFAULT_FIELDS.logs` 标题键为 `name`，`ai.suggestStory` 却输出 `title`，被 `normFields` 过滤 |
| H6 | 模板入口报错与全局挂载表有关 | confirmed（root cause） | `setViewTpl / editSetTpl / setFieldTpl / saveAsTemplate / aiBuildTemplate` 有定义但未列入 `window.WB` |
| H7 | 地图标记残留是弹窗“先写入再确认”缺少回滚 | confirmed（root cause） | `addMarkerAt()` 先 `markers.push`，`closeModal()` 无任何回滚 |

其余次级缺陷同样经代码取证后确认（见下方 Fix）。

## Root cause

跨 8 类缺陷，可归为 4 种模式：

1. **结构契约漂移**：新增功能改变了函数的返回结构/字段名，调用方未同步（`relComponents`、`logs.title/name`）。
2. **生命周期/时序错误**：在 DOM 重建之前/之后使用了旧引用，或事件绑定随重绘重复叠加（关系网 svg、画板 window 监听）。
3. **量纲/单位不一致**：归一化比例与像素坐标混用（椭圆命中）。
4. **入口未接线 / 缺少回滚**：函数实现完成但未挂载到全局对象；破坏性前置写入没有取消路径。

## Fix

改动文件：`src/renderer/app.js`、`src/main/ai.js`、`src/renderer/styles.css`

**关系网**

- `relComponents()` 返回 `{ids:[...]}`，`relLayout()` 对应取 `c.ids`（统一结构契约）。
- `renderRelations()` 先绑定新 svg 再 `relPaint()`；缺坐标判定改为「任一节点缺 x 或 y」。
- AI 关系预览的复选框改用「原始 ops 下标」编号（`ops.indexOf(o)`），应用/全选按同一索引取值。
- `relApplyOps()` 未知 op 由“按删除处理”改为跳过；`relDelEdge()` 增加“选中的确实是连线”校验。
- `relCenter()` 改为按节点包围盒中心对齐视口中心；`relPaint()` 拖动中不再重建侧栏；筛选掉的节点命中圈一并禁用。

**地图**

- `mapHitTest()` 椭圆命中把归一化半径换算回像素再判定（区域与迷雾各一处）。
- 新增 `_modalCancel` 取消钩子，`mapEditMarker()` 新增标记时注册回滚，保存/删除前清除。
- 窗口级监听抽到 `mapWireWindow()` 并用 `_map._wireWin` 只安装一次，回调内实时取当前 canvas。
- 新增 `mapFitTransform()` 修正居中公式；`drawPoly()` 增加 `sc` 参数统一线宽；导出前 `await ensureBaseImage()` 保证底图已解码。
- `mapFinishRegion()` 过滤双击带来的相邻重合顶点；区域名绘制加 `pts.length` 判空；`mapBack()` 复位 `sel/mode/editMk/ellipse/regionPts/measurePts`。
- 新增 `ensureMapShape()` 并在 `mapsData()` 统一补全 `grid/markers/regions/fog`；`mkMap()` 补 `regions: []`。
- 格距按钮加 `id` 并在改值后刷新文案；框选提示去掉不存在的「完成」按钮；区域提示条上移避免遮挡状态条。

**AI 记忆链路**

- 新增纯函数 `mergeMemoryEntries()`：统一写入 `{text,t}`、兼容历史字符串条目、按文本去重；`commitPlotPoints()` 改为调用它，并把 `chatSumAt` 更新放到 `persist()` 之前。
- 新增 `memoryText()`，`plotSummary()` 注入 AI 的长期记忆由 `[object Object]` 改为纯文本。
- `recentStoryText()` 读日志标题改为 `l.name || l.title`，并将 `hook` 纳入素材。
- `aiClear` 清空对话时重置 `chatSumAt`。
- `ai.suggestStory()` 输出字段改为 `name` + `hook`，提示词同步；仍兼容读取 `title`。

**接线**

- 把 `setViewTpl / editSetTpl / setFieldTpl / saveAsTemplate / aiBuildTemplate` 补进 `window.WB`。

**低影响项收尾（第二轮）**

- 节点名标签 `.rel-nlabel` 由 `pointer-events:none` 改为 `auto`，可直接双击节点名改名（原先只能双击节点圆圈）。
- 新增纯函数 `dragExceeded()`；标记拖动记录起手坐标，未越过阈值（默认 3px）视为单击，不改数据；`mouseup` 仅在 `drag.moved` 或 `paint.dirty` 时落盘，拖拽视图不再产生无意义保存与审计记录，双击改名的像素抖动也不再挪动标记。
- **额外发现并修复**：地图「涂抹迷雾」原实现按 `m.fog[m.fog.length - 1]` 写入，而全程从未新建迷雾块 —— 会在起笔时覆盖最后一块已有迷雾；若地图原本没有迷雾，则写入数组的 `-1` 属性，笔画被 JSON 序列化直接丢弃。现改为每笔起笔新建迷雾块（`idx` 定位），并加 1.5px 采样去抖。
- `src/main/store.js` 的 `NAME_FIELD.logs` 由 `'title'` 更正为 `'name'`（该常量仅用于写审计记录的条目标题，原先日志类操作的审计名称为空）。

## Verification

- V-1：`npm run verify` → 接线审计「全部通过」，回归测试 **GREEN 17 · RED 0**（修复前为 GREEN 5 · RED 7；含反证项：旧居中公式会被判为不居中，证明测试有效）。
- V-2：`node --check` 覆盖 `src/renderer/app.js`、`src/main/ai.js`、`src/main/main.js`、`src/main/store.js`、`src/preload.js` → 全部通过。
- V-3：接线审计 → `✅ 所有 WB.* 引用均已挂载`（135 个引用 / 160 个键）、`✅ 所有 q() 引用均有对应 id`（132 个引用）。
- V-4：接线审计 → IPC 通道 48/48 一一对应，无孤儿通道；`window.api.*` 调用与 preload 暴露一致。
- V-5：顺手清掉 `parseState` 两处指向已废弃元素的死引用（原为 `if (ps)` 空转，无用户影响）。
- V-6：`dragExceeded` 的 4 项行为断言（0 位移 / 2px 抖动 / 真实拖动 / 自定义容差）全部 GREEN。

## Regression test

- 命令：`npm run verify`
- 组成：`tools/wiring-audit.js`（接线审计）+ `tools/regress.test.js`（纯逻辑回归）
- 回归覆盖：`relComponents` 返回结构、`mapHitTest` 椭圆命中（含误命中反例）、`mergeMemoryEntries` 对象/字符串兼容与去重、`mapFitTransform` 居中不变量、`dragExceeded` 误触阈值。
- 说明：两个脚本均从源码抽取函数/比对引用关系，无需 DOM 与 Electron，可在打包前快速执行。

## Pattern analysis

| 搜索方式 | 命中数 | 是否本次同类隐患 |
|---|---|---|
| `WB.` 引用 vs `window.WB = {` 键 | 135 / 160 | 是，本次全部补齐（0 处遗留） |
| `ipcRenderer.invoke(` vs `ipcMain.handle(` | 48 / 48 | 否，一一对应 |
| `q('id')` vs 实际 id 定义 | 132 / 173 | 是，`parseState` 已清理（0 处遗留） |
| `c.ids` / `.title` 等跨函数字段名 | 4 | 是，均已修（含 `store.js NAME_FIELD.logs`） |
| `addEventListener('mousemove' \| 'mouseup')` 在重绘函数内 | 3 | 是，已修（改为一次性安装） |
| `arr[arr.length - 1] = ` 无对应 push 的覆写模式 | 1 | 是，即「涂抹迷雾」覆写已修（0 处遗留） |

## Open questions / Follow-ups

此前挂起的 3 项低影响问题已全部处理（见 Fix「低影响项收尾（第二轮）」），并在核查过程中额外发现并修复了「涂抹迷雾覆盖已有迷雾」的数据破坏缺陷。

当前无新增挂起项。后续可选优化：

1. 地图「涂抹迷雾」现在每笔生成独立迷雾块，若一张图上涂抹次数很多，可考虑增加“合并相邻迷雾块”的工具。
2. `tools/regress.test.js` 依赖“按函数名抽取源码 + 括号配平”，若被测逻辑被内联进模板字符串或改写为常量箭头函数，抽取会失效 —— 今后为可测逻辑保留 `function name(...)` 顶层声明形式。

## RCA

- **何时引入**：批次 B 的“孤立点外移”改造（2.4.1）引入 `relComponents` 结构漂移；批次 C 的 `commitPlotPoints`/`suggestStory` 为本次新增即带缺陷；椭圆、标记回滚、窗口监听为 2.4.0/2.4.3 新增。
- **为什么没被发现**：项目无自动化测试，验证依赖人工点测；上述缺陷多数需要“存在连线”“先有长期记忆条目”“底图未解码即导出”等组合前置条件，单点走查容易漏过；结构不匹配类问题在无类型系统的原生 JS 中不会有编译期告警。
- **预防措施**：
  1. 已落地 `npm run verify`（`tools/wiring-audit.js` + `tools/regress.test.js`），作为打包前必跑门禁；
  2. 接线审计覆盖 WB 挂载、IPC 通道、preload 暴露、q('id') 存在性、重复函数/id，新增 UI 入口后必跑；
  3. 约定：新增函数若被内联 `onclick="WB.x()"` 调用，必须同时补进 `window.WB`；
  4. 约定：跨函数传递的结构体（连通分量、记忆条目、日志字段等）在改动时同步检查调用方；
  5. 约定：破坏性前置写入（先入列再确认）必须提供取消回滚路径，可复用 `_modalCancel` 钩子。
