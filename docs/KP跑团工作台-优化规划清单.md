# KP跑团工作台 · 优化规划清单

> 更新日期：2026-10-03
> 范围：AI 关系网推理 / 骰娘 QQ 登录与连接 / 界面渲染与交互 / 整体性能与体积
> 优先级：P0 = 低风险高性价比（建议先做） · P1 = 中收益 · P2 = 大工程 / 需权衡

---

## 一、AI 关系网推理

**现状**
- [suggestRelations](../src/main/ai.js#L1727-L1812)：提示词已注入各类型卡片关键内容、原始文本摘录、现有连线；实体名经 `nameNorm` / `canonicalName` 归一化回正，去重并限制 30 条输出。
- 重试/超时/预算熔断位于 [requestCompletions](../src/main/ai.js#L574-L587) 与 [requestOnce](../src/main/ai.js#L590-L618)。
- IPC 入口 [ai:relationsSuggest](../src/main/main.js#L631-L639)，传入 `doc.entities / doc.relations / payload.raw`。

**优化点**

| 编号 | 优先级 | 问题 | 方案 |
|---|---|---|---|
| P0-1 | P0 | 每类实体硬截断 90 张（L1745），卡片一多尾部信息直接丢弃，关系自然漏检 | 先按「原文共现次数 + 字段相似度」给实体对打分，只把 Top N 候选注入 prompt，而不是按卡片顺序截断 |
| P0-2 | P0 | AI 输出 JSON 格式错 → `parseJsonObj` 失败 → 静默返回空数组，白白浪费一次请求 | 对「解析失败」单独触发一次重试（受预算熔断保护），并把解析错误记入诊断 |
| P1-3 | P1 | 相同输入重复跑，双份 token | 对输入指纹（实体名集 + 原文 hash）缓存结果，卡片未变时直接复用 |
| P1-4 | P1 | 靠提示词约束 JSON，仍会幻觉/格式漂移 | 对支持 JSON 模式 / 工具调用的 API 用 `response_format` 强约束 schema，退化走文本解析 |

---

## 二、骰娘 QQ 登录与连接

**现状**
- [qqdirect/index.js](../src/dice-net/qqdirect/index.js#L109-L168)：已有登录退避频控（`loginGuard`）、失败指数退避（`noteLoginFailure`）、按账号隔离设备指纹目录（`sessionDir`）、平台枚举归一化（`normalizePlatform`）。
- 断线/被踢/在线等事件监听位于 [L209-L280](../src/dice-net/qqdirect/index.js#L209-L280)；扫码自动登录与客户端配置指纹重建位于 [L283-L333](../src/dice-net/qqdirect/index.js#L283-L333)。
- 多通道装配入口 [dice-net/index.js](../src/dice-net/index.js#L13-L19)，按 qqdirect / onebot11 / qqofficial / sim 顺序创建。

**优化点**

| 编号 | 优先级 | 问题 | 方案 |
|---|---|---|---|
| P0-5 | P0 | 有 `reconnects` 计数（L121）和「普通断线」事件，但没有明确的「冷却后自动重新 start」状态机 | 区分「网络抖动（自动重连 + 指数退避）」与「被踢 / 风控（不重登，提示人工）」，补齐自动重连闭环 |
| P0-6 | P0 | 只看 icqq 连接态，网络静默时可能假在线 | 应用层记录「最后收到消息时间」，超过阈值标记假在线并触发重连 |
| P1-7 | P1 | 登录错误事件直接透传，用户难懂 | 建错误码 →「风控 / 验证码过期 / 密码错 / 账号冻结」分类映射表，UI 给出可操作建议 |
| P1-8 | P1 | 登录守卫文案已提 OneBot 中转，但未做成动作 | 失败时提供「一键切换 OneBot 中转」入口 |

---

## 三、界面渲染与交互

**现状**
- 基础 `.toggle-row` 已是 flex 布局：[styles.css L366-L371](../src/renderer/styles.css#L366-L371)。
- 但 [app.js](../src/renderer/app.js#L3324-L3326) 仍有约 10 处等价内联 `display:flex; align-items:center` 与基础样式并存。
- 主题皮肤通过 `:root[data-theme=...]` 多套 CSS 变量实现：[styles.css L2-L54](../src/renderer/styles.css#L2-L54)。
- 关系网「一键整理」按连通分量打包、节点查找过滤等位于 [app.js L206/L244](../src/renderer/app.js#L244-L244)。
- 全局搜索 / 快捷键入口位于 [index.html L68-L86](../src/renderer/index.html#L68-L86)。

**优化点**

| 编号 | 优先级 | 问题 | 方案 |
|---|---|---|---|
| P0-9 | P0 | 基础样式已统一，内联样式是重复来源，正是此前勾选框错位的土壤 | 删除 app.js 中与基础类等价的内联 flex，统一收敛到 `.toggle-row` |
| P1-10 | P1 | 关系网数百节点时拖拽 / 平移整帧重绘 | 网格分桶命中测试 + `requestAnimationFrame` 节流 + 拖拽时降低重绘面 |
| P1-11 | P1 | `data-theme` 切换导致整页 repaint | 切换时挂过渡 class + 限制 repaint 范围 |
| P1-12 | P1 | 全局搜索高频按键仍逐次触发 | 150ms 防抖 + 增量索引（2.8.2 已优化序列化，再加防抖即可） |
| P2-13 | P2 | 上千卡片 DOM 全部在树中 | 视口虚拟化渲染，仅渲染可见卡片 |

---

## 四、整体性能与体积

**现状**
- store 已分片增量写（哈希比对、只写变更分片）：[store.js L385-L434](../src/main/store.js#L385-L434)；旧格式保留整档兼容路径（L426-L430）。
- PDF / Excel / Word 解析均已懒加载：[main.js L853-L866](../src/main/main.js#L853-L866)、[L919-L936](../src/main/main.js#L919-L936)。
- 打包配置：`files` 含 `src/**/*`、`node_modules/**/*`、`package.json`（[package.json L32-L47](../package.json#L32-L47)）。
- 性能基准覆盖交叉引用渲染、全局搜索在 1000/3000/8000 卡片规模下的耗时：[tools/perf-bench.js](../tools/perf-bench.js#L114-L159)。

**优化点**

| 编号 | 优先级 | 问题 | 方案 |
|---|---|---|---|
| P0-14 | P0 | `save()` 每次写都生成快照（40 份上限）、JSON 用 2 空格缩进 | 快照异步化 / 降频（间隔 > X 分钟才沉淀），缩进改紧凑序列化，hash 不变不写盘 |
| P0-15 | P0 | 启动路径 [main.js L58-L87](../src/main/main.js#L58-L87) 同步 load + 模板注入阻塞窗口 | 窗口先出、数据后置；确认 icqq 只在连接中心打开时懒加载（engine.js 已是懒加载，保住这一点） |
| P2-16 | P2 | `files` 含 `node_modules/**/*`，pdfjs 自带字体 / cmaps、xlsx 完整版偏大 | 只打包 pdf.worker 与必要字体；xlsx 换 slim 入口；electron-builder 开 `compression: maximum` |
| P2-17 | ✅ 已落实 | app.js 单文件 600KB | 引入极简构建（esbuild）按视图拆文件（收益高但需搭构建链，谨慎评估） |

---

## 执行顺序建议

1. **P0 批**（P0-1 / P0-2 / P0-5 / P0-6 / P0-9 / P0-14 / P0-15）：都是小改动，可被现有测试网直接覆盖。
2. **P1 批**（P1-3 / P1-4 / P1-7 / P1-8 / P1-10 / P1-11 / P1-12）：逐个上，每个配回归测试。
3. **P2 批**（P2-13 / P2-16 / P2-17）：最后评估，需验证构建链与打包结果。

## 验收基线

- 每项优化完成后运行 `npm test` 与 `npm run verify`，确认无回归。
- 涉及性能的项（P1-10 / P1-12 / P0-14 / P2-16）用 `npm run bench` 复测并对比数据。

---

## 执行记录（2026-10-03）

P0 批已全部落实，测试网 `npm test` 全绿（352 项）：

| 编号 | 落实摘要 |
|---|---|
| P0-1 | [ai.js](../src/main/ai.js) `suggestRelations` 增加实体对「原文共现 + 字段相似度」打分，Top N 候选注入，替换按序硬截断；配套单测覆盖共现预筛 |
| P0-2 | [ai.js](../src/main/ai.js) JSON 解析失败触发一次定向重试（受预算熔断保护），解析错误计入 `relationDiag.parseRetries`；配套单测覆盖 |
| P0-5 | [qqdirect/index.js](../src/dice-net/qqdirect/index.js) 补齐断线自动重连闭环：`system.offline.network` 走指数退避自动重连，`kickoff` 不重登、提示人工；单测覆盖 network/kickoff/超限放弃 |
| P0-6 | 同上，新增假在线巡检：记录 `lastMsgAt`，静默超阈值标记假在线并触发重连；单测覆盖触发与消息刷新 |
| P0-9 | [app.js](../src/renderer/app.js) 删除与 `.toggle-row` 基础样式等价的内联 `display:flex; align-items:center`，统一收敛样式 |
| P0-14 | [store.js](../src/main/store.js) 快照降频（`settings.snapshotMinutes`，默认 ≥1 分钟）+ 紧凑 JSON 序列化 + `_lastMetaHash` 跳过未变更 `_meta.json`；单测覆盖紧凑格式与降频 |
| P0-15 | [main.js](../src/main/main.js) 启动路径改为「窗口先出、数据后置」：`store.load()`/模板注入/首写移入后台 `bootData()`（`setImmediate` 让出首帧），`store:getAll`/`store:save` 等待 `dataBooted` 放行；明文 Key 加密迁移并入启动加载 |

P1 批已落实 P1-3 / P1-4 / P1-10 / P1-11 / P1-12，测试网 `npm test` 全绿（352 项，P1 批结束后复测无回归）：

| 编号 | 落实摘要 |
|---|---|
| P1-3 | [ai.js](../src/main/ai.js) 输入指纹缓存：`relFpHash` 对实体名+关键内容+原文+现有连线+模型名生成指纹，命中 `relationCache`（上限 50，滚动淘汰）直接复用结果，`relationDiag.cacheHits` 计数；配套单测覆盖命中/未命中 |
| P1-4 | [ai.js](../src/main/ai.js) 优先声明 `response_format=json_object` 强约束输出（`rawJsonReply`），解析失败再走文本+重试兜底；配套单测覆盖 JSON 解析链路 |
| P1-10 | [app.js](../src/renderer/app.js) 关系网渲染三件套：① `relSchedulePaint` 用 requestAnimationFrame 节流连续手势（drag/box/pan/wheel 同帧只绘一次，且按轻重合并）；② 平移/缩放只改 `<g.rel-vp>` transform（`relPaintView`）不再整帧重建；③ 拖拽只原位更新被拖节点与关联连线的几何属性（`relPaintDraggedOnly`）；④ 框选改用网格分桶命中测试（`relBuildBuckets`/`relQueryBuckets`，REL_CELL=160），数百节点不再线性扫全表 |
| P1-11 | [app.js](../src/renderer/app.js) + [styles.css](../src/renderer/styles.css) 主题切换挂 `.theme-switching` 过渡 class（仅颜色/边框/阴影属性，不碰 transform/opacity），320ms 后移除，切换平滑且无常驻 transition 开销 |
| P1-12 | [app.js](../src/renderer/app.js) 全局搜索 150ms 防抖（`globalSearch` → `runGlobalSearch`），高频按键合并为一次全库检索 |

P1 批补完 P1-7 / P1-8，`npm test` 复测仍全绿（352 项）：

| 编号 | 落实摘要 |
|---|---|
| P1-7 | [qqdirect/index.js](../src/dice-net/qqdirect/index.js) 登录错误分类映射：`QQ_ERR_RULES` 按错误码（`code` 正则）优先、错误文案兜底，归为 banned / password / device / version / risk / network / unknown 七类，每类带可操作建议 `errHint`；`system.login.error` 事件携带 `errCategory` / `errHint` 随 `status()` 上报；UI [conn-center.js](../src/renderer/dice-ui/conn-center.js) 错误面板渲染分类建议 |
| P1-8 | 失败面板加「⇄ 改用 OneBot 中转（高级）」一键入口：[app.js](../src/renderer/app.js) `qq-to-onebot` 动作自动展开高级区、滚动到 OneBot 卡片并闪光提示（`.dice-channel-card.flash`），[conn-center.js](../src/renderer/dice-ui/conn-center.js) 渲染按钮；单测覆盖分类函数、事件携带、面板展示 |

> 剩余待办：P2 批（P2-16 打包瘦身）。

P2 批已落实 P2-13，`npm test` 全绿（437 项，含新增 3 项视口虚拟化审计测试）：

| 编号 | 落实摘要 |
|---|---|
| P2-13 | [app.js](../src/renderer/app.js) 关系网视口虚拟化：`relViewportRect` 按「屏幕 = 世界×k + t」换算当前视口世界范围（含 `REL_VP_MARGIN=400` 缓冲），`relVpNodeIds` 分桶粗筛+坐标精过滤得可见节点集；`relPaint` 只把视口内节点与两端都在视口内的连线渲染进 SVG（筛选中保持全量，避免过滤目标「看不见」），并记录 `_rel._vpRect`；`relPaintView` 平移/缩放只改 transform，仅当新视口越出已渲染范围才补绘一次——上千节点时 DOM 只驻留可见子集 |

P2 批已落实 P2-17，`npm test` 全绿（358 项回归）：
| P2-17 | 按视图拆分 [app.js](../src/renderer/app.js)：统计分析 / 运行记录 / 帮助中心 抽为 [views/stats.js](../src/renderer/views/stats.js)、[views/runlog.js](../src/renderer/views/runlog.js)、[views/help.js](../src/renderer/views/help.js)（沿用 changelog.js 的 `window.KPViews` 工厂模式），app.js 仅保留薄代理桩 + 共享常量 `STATS_K`；`hydrateViews` 的 KP 上下文注入 `DATA_TYPE / STATS_K` 供视图水合；新增 [tools/build-renderer.js](../tools/build-renderer.js)（esbuild 按 index.html 声明顺序聚合 11 个脚本为单 bundle，复制 styles.css / assets，重写 index.html 为单 script 引用）→ [npm run build:renderer]；[window.js](../src/main/window.js) 优先加载 [out/renderer/](../out/renderer/index.html)（未构建回退源目录）；`build.files` 增 `out/**/*`；新增 6 项 P2-17 回归 + [build-renderer.test.js](../tests/build-renderer.test.js) 3 项构建链测试 |
