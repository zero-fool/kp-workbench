# 界面舒适度优化设计（方案 A + B 组合）

- 日期：2026-09-15
- 目标版本：2.8.0（次版本，界面层增量）
- 状态：已批准，待编写实现计划

## 背景与目标

KP 跑团工作台功能已相当完善，但界面在三种场景下存在明显的不适：

1. 数据视图工具栏按钮多达 10 个，窄窗下必换行堆挤，挤占内容区（视觉密度）。
2. 卡片间距 / 行高 / 字号硬编码，没有"信息密度 / 阅读舒适"的可调档位。
3. 高频动作层级较深、卡片缺少快捷入口，操作步骤偏多（效率）。

本设计在**不改动任何业务数据结构与既有功能**的前提下，仅围绕 UI 组织与交互做增量优化，缓解以上三处不适。

## 改动范围与非目标

改动范围：
- `src/renderer/styles.css`：密度变量层、下拉菜单样式、右键菜单样式、卡片间距变量化。
- `src/renderer/app.js`：工具栏分层、密度切换、右键上下文菜单、自定义拖拽排序。
- `tools/regress.test.js`：补充上述纯函数与新结构的回归用例。

非目标（本轮不做）：
- 不改动业务实体 / 关系 / 地图的数据模型。
- 不做入口去重重构（侧栏 / AI 抽屉 / 快捷面板维持现状）。
- 不引入第三方 UI 库 / 拖拽库。

## 架构落点

- 主题系统已用 `:root[data-theme=...]` + CSS 变量驱动，叠加 `data-density` 属性作为第二个维度（`<html data-theme="ember" data-density="comfortable">`）。
- 持久化统一走 `persist()` -> `window.api.save()`；所有新偏好存于 `S.settings.layout.*`，不触碰实体数据，因此不影响 AI 快照回滚。
- 复用既有函数：`toggleFav` / `dupCard` / `edit` / `del` / `appConfirm`；拖拽复用 `bindDashDrag` 的 card-clone 先例。

## 三块改动

### A1 工具栏收编

现状 `renderDataView` 工具栏含 10 个动作，窄窗必换行。设计为「主操作行 + 折叠菜单」：

- 常驻首行（最高频 6 项）：`← 返回`、`→ 前进`、`搜索框`、`排序`、`来源筛选`、`＋ 新增`、`↧ 导出`。
- 收入 `⋯ 更多` 下拉：`⚡ AI 生成（结合对话）`、`⚡ AI 整合`（仅 rules / lore）、`🛡 一致性检查`、`☑ 多选模式`、`↧ 导入/粘贴`。
- 实现：用元素 `details`/`summary` 或自绘 dropdown 承载，样式沿用 `--panel / --line / --shadow` 变量，5 套主题自动适配。
- 不做按视图记忆收起项——统一收起逻辑，保证一致、零配置。

### A2 两档密度

- 在 `:root[data-theme=...]` 同级叠加 `data-density="compact|comfortable"`，新增密度变量组（各主题继承后在根级覆写）：
  - `--d-gap`（卡片间距）：compact=10px / comfortable=18px
  - `--d-card-min`（卡片最小宽）：compact=260px / comfortable=340px
  - `--d-pad`（卡片内边距）、`--d-row`（行间距）、`--d-text`（正文字号）、`--d-title`（标题字号）
- 默认值：**comfortable**（开箱即舒适）；`S.settings.layout.density` 持久化。
- 切换入口：顶栏主题下拉旁的字号图标按钮 + 设置页「外观」区。
- `.cardgrid` 改用变量：`gap:var(--d-gap)`、`minmax(var(--d-card-min),1fr)`；`.card padding:var(--d-pad)`。

### B1 卡片右键菜单

- 对列表卡片 `.card` 绑定 `contextmenu` -> `preventDefault`，弹出统一迷你菜单（复用现有 palette / ghost 视觉）。
- 动态菜单项：
  - 通用：`编辑` / `⧉ 复制` / `★ 收藏`（或 `☆ 取消`）/ `去重`（存在同名时）/ `删除`（走 `appConfirm` 确认）。
  - 复用 `toggleFav` / `dupCard` / `edit` / `del`，零重复逻辑。
- 事件委托只绑定到存在的卡片容器，未绑定处不受影响。
- 关闭：点击外部 / Esc / 滚动。
- 不覆盖关系网 / 地图画布已有的 `contextmenu`（它们各自为政）。

### B2 卡片自定义拖拽排序

- 排序下拉新增 `排序：自定义`。
- 进入该档时卡片可拖拽（复用 card-clone 与 `bindDashDrag` 同类先例），拖拽后持久化 `S.dv.customOrder[kind] = [id,...]`。
- `renderDataView` 优先按 `customOrder` 排列；切回收藏/名称序时隐藏手柄。
- 写入前过滤已删除 id，避免悬空引用。

## 错误处理与健壮性

- 新下拉 / 菜单 / 拖拽不得抛未捕获异常；事件委托只绑定到存在容器。
- 排序写入前过滤已删除 id。
- 密度 / 排序偏好存于 `settings.layout`，非实体数据，不影响 AI 快照回滚。
- 所有样式经由变量覆写，不存在裸硬编码导致某一主题下错乱。

## 测试计划

补充 `tools/regress.test.js`：
- A1：`renderDataView` 工具栏含 `more-menu`。
- A2：`data-density` 变化驱动 `.cardgrid` gap / 卡片 min-width 变量（断言变量值）。
- B1：右键菜单渲染函数输出含操作项，且 `contextmenu` 具被绑定路径。
- B2：`applyCustomOrder(list, order)` 纯函数——按序排列、过滤已删 id、无 order 时保序，移至可测的顶层纯函数。

## 交付验收标准

- 数据视图工具栏窄窗不再整排换行（按钮收入 `⋯`）。
- 顶栏一键切换紧凑 / 舒适，卡片间距字号随之变化且在 5 套主题下显示正常。
- 列表卡片右键弹出菜单，编辑/复制/收藏/删除均生效。
- 自定义排序可拖拽且刷新/重开后保持。
- 回归测试新增用例全绿。