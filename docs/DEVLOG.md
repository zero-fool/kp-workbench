# 开发日志

> 版本级开发脉络（大事记）；详细实施计划见 `docs/superpowers/plans/`。

## v3.0（自研骰娘内核 M3）
- 骰娘板块升级「骰娘工作台」六分区；自研 dice-core 引擎统一本地投骰与群指令（规则插件对两端同时生效）。
- 插件工坊 + AI 生成向导：喂规则文本 → 生成 → 测试通道试跑 → 确认安装（两道闸，≤3 轮修正，一键回滚，导出分享）。
- .kp 原生数据联动：WorkspaceDataPort 主进程直连 store.js，群指令与 GM 工作台实时双向刷新；.ai 对话/定向判定（可取消、超时兜底，掷骰永不依赖 AI）。
- 旧内核退役：删除 resources/dice-next、bridge/kp-workspace-bridge.js、src/main/dice.js；preload 收口为 diceCore.*；界面移除「定位内核/引擎目录/Web 控制台」交互。
- 零第三方残留扫描（tools/scan-thirdparty.js）并入 npm run verify；打包体积约 206MB → 约 70MB（<100MB）。

## v2.x（旧版脉络，一行概括）
- 2.10.1 及此前：GM 工作台全功能（资料/地图/关系网/遭遇/统计/剧本/AI 助手）与「连 QQ 骰娘」（内嵌 dice-next 引擎）双板块形态。