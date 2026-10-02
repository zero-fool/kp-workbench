# KP 跑团工作台 · Code Wiki

> 本套文档面向新加入项目的开发者，系统说明 **KP 跑团工作台** 的整体架构、模块职责、关键类与函数、依赖关系与运行方式。
> 内容基于仓库源码（`src/`、`tools/`、`tests/`）与 `package.json` / `README.md` / `DEPLOY.md` 整理，描述的是当前代码形态。

## 项目一句话

一款 Windows 桌面端 TRPG 主持人（KP / GM）辅助工具，整合**资料管理 + AI 辅助创作 + 地图/关系网 + 骰娘检定 + 记录润色 + 统计分析**，基于 Electron，数据本地自持。

## 文档目录

| 序号 | 文档 | 内容 |
| ---- | ---- | ---- |
| 01 | [架构总览](01-架构总览.md) | 进程模型、分层结构、数据流、目录结构 |
| 02 | [主进程](02-主进程.md) | Electron 主进程职责、IPC 通道清单、入口与生命周期 |
| 03 | [骰娘内核 dice-core](03-骰娘内核-dice-core.md) | expr / calc / rules / brain / plugin / ports / reply / state / hub |
| 04 | [网络通道 dice-net](04-网络通道-dice-net.md) | OneBot 11 / QQ 官方机器人 / 应用内测试通道 / WS 传输 |
| 05 | [渲染层 renderer](05-渲染层-renderer.md) | 页面结构、preload 契约、UI 组件、交互模型 |
| 06 | [数据存储与持久化](06-数据存储与持久化.md) | DataStore、分片存储、备份/快照/档案、迁移 |
| 07 | [AI 能力集成](07-AI能力集成.md) | ai.js、dice-ai、prompt-hub、请求守卫与任务队列 |
| 08 | [自动更新机制](08-自动更新机制.md) | GitHub Releases 检测、下载、校验、替换 |
| 09 | [依赖与模块关系](09-依赖与模块关系.md) | 内外依赖、模块调用关系、端口抽象 |
| 10 | [运行、构建与测试](10-运行构建与测试.md) | 环境要求、npm 脚本、打包发布、测试与校验工具 |

## 快速导航（按角色）

- **想跑起来**：读 [10-运行、构建与测试](10-运行构建与测试.md)
- **想改骰娘指令**：读 [03-骰娘内核 dice-core](03-骰娘内核-dice-core.md)
- **想接机器人/协议**：读 [04-网络通道 dice-net](04-网络通道-dice-net.md)
- **想改界面**：读 [05-渲染层 renderer](05-渲染层-renderer.md)
- **想加 AI 功能**：读 [07-AI 能力集成](07-AI能力集成.md)

## 版本与元数据

- 应用版本：见 [package.json](file:///workspace/package.json) 的 `version`（当前 `3.2.1`）
- 主入口：`src/main/main.js`
- 运行时：Electron `^31.7.7`（Node.js / Chromium）
- 许可证：MIT（个人免费工具，禁止商用）
