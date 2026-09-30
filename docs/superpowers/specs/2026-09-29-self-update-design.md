# 自更新（GitHub Releases 检测 + 应用内下载 + 替换重启）设计文档

- 对应版本：v3.2.0（自更新首个版本）
- 日期：2026-09-29
- 事实来源：本文件。实现期若与代码冲突，以本文件为准并回改代码；若本文件需要变更，先改本文件再改代码。

## 1. 背景与目标

### 1.1 现状（问题）

「检查更新」是 v2.x 留下的实现，与现在的分发方式完全脱节：

| 问题 | 现状 | 后果 |
| --- | --- | --- |
| 更新源是占位地址 | `package.json` 的 `build.publish.url = https://your-update-host.example.com/updates/` | 检查更新必然失败，等于没接 |
| 依赖 electron-updater | 需服务端放 `latest.yml` + blockmap | 发布流程里从来没上传过这两个文件 |
| 绿色版直接不支持 | `updater:check` 在 `PORTABLE_EXECUTABLE_DIR` 下直接返回「绿色版暂不支持自更新」 | 用户实际在用的绿色版永远得不到更新提示 |
| 判断逻辑不严谨 | 以 `!!r.updateInfo` 判定「有更新」 | 已是最新时也可能报「有更新」，或相反 |
| 状态不清理 | `settings.updates.error` 写入后不清 | 页面上永久残留上一次的报错 |
| 静默强制重启 | `autoDownload = true` + `download 完成即 quitAndInstall` | 用户正在录入资料时被强制重启，未保存内容会丢 |

### 1.2 目标

1. 更新检测对接**实际分发渠道 GitHub Releases**，三种形态（绿色版 / 便携版 / 安装版）都能用。
2. 应用内完成「下载 → 校验 → 解压 → 询问 → 替换 → 重启」全链路，绿色版用户点一次即可用上新版。
3. 全程不触碰用户数据（`data/`）与用户设置，任何一步失败都可回退到「手动下载新版」。
4. 检测、下载、解压三层各自可单测，主进程保持**零第三方依赖**。

## 2. 已定决策（澄清记录）

| 编号 | 决策 | 说明 |
| --- | --- | --- |
| U1 | 检测走 GitHub Releases API | 公开仓库，无需 token；不引入更新服务器 |
| U2 | 应用内下载绿色版 zip，并自动替换重启 | 用户明确要求「下载完自己更新完重启」 |
| U3 | 三种形态都覆盖自动更新 | 绿色版=覆盖文件夹；便携版=替换单文件；安装版=拉起安装包 |
| U4 | 下载+解压完成后弹窗询问，选「立即」才替换重启 | 避免打断正在录资料的用户 |
| U5 | 解压自研（`node:zlib`），不用 PowerShell | 与项目零第三方依赖、全量单测的既有做法一致 |
| U6 | 退役 electron-updater | 依赖、`main.js` 调用、占位 `publish.url`、`build:update` 脚本一并退役 |
| U7 | 安装版只下载安装包并**交互式**拉起，不 `/S` 静默 | 静默会装到默认目录；用户装在非默认目录时等于装错位置 |
| U8 | 覆盖式复制，不镜像删除 | 失败时旧文件仍在；不删用户目录里多出来的文件 |

## 3. 非目标

- 不做差分/增量更新（每次下载完整绿色版 zip，约 121MB）。
- 不做代码签名证书与签名校验（项目未购买证书）；不做内容级防篡改承诺。
- 不做后台静默安装、不做定时自动替换（必须用户点确认）。
- 不做 beta/测试版通道（只认 GitHub「latest release」；预发布版本不参与比较）。
- 不做多更新源切换；仅提供单一可选的「下载加速前缀」字符串（默认空，用于网络受限时拼在下载 URL 前）。
- 不改动骰娘、工作台等功能；不重构无关代码。

## 4. 架构与模块边界

主进程新增 `src/main/updater/`（纯 Node，零 Electron 依赖，可单测）：

```
src/main/updater/
  index.js    编排：检测 → 下载 → 校验 → 解压 → 暂存 → 应用；持有状态快照，对外只暴露这几个动作
  github.js   GitHub Releases API 客户端：拉 latest release、解析 tag/body/assets、拼下载 URL
  semver.js   版本解析与比较（x.y.z / x.y.z.w，忽略前导 v）
  zip.js      零依赖 ZIP 读取器：中央目录解析 + zlib.inflateRaw + CRC32 校验 + 路径穿越防护
  apply.js    形态探测（green/portable/installer）、解压后结构校验、helper 脚本生成与 spawn
```

`src/main/main.js` 只做：初始化（数据目录 `updates/`）、注册 IPC、把状态事件转发给渲染进程。**不把网络与解压细节写进 main.js。**

渲染层：`src/renderer/app.js` 的「更新公告」页顶部状态卡 + 设置页开关；`src/preload.js` 增加 `updater.*` 方法。

依赖方向单向：`index.js → github/zip/apply`，`apply.js → semver`；互不反向。

## 5. 接口契约（IPC）

| 通道 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `updater:check` | — | `{ ok, hasUpdate, current, latest, publishedAt, notes, assets, mode, error? }` | `notes` 为该 Release 正文（渲染为条目）；`assets` 为 `{green,portable,setup}` → `{name,url,size}` 或 null |
| `updater:download` | `kind`（`green`/`portable`/`setup`） | `{ ok, staged, path, size, error? }` | 下载+校验+解压到暂存目录；进度经 `updater:state` |
| `updater:apply` | — | `{ ok, error? }` | 生成 helper、拉起、随后 `app.quit()` |
| `updater:later` | — | `{ ok }` | 清掉「已就绪」，保留已下载文件 |
| `updater:openRelease` | `target`（`page`/`green`/`portable`/`setup`） | `{ ok }` | `shell.openExternal` 打开下载页或直接下载链接 |
| `updater:status` | — | 状态快照 | 重进页面时恢复进度/就绪态 |

事件 `updater:state`（主 → 渲染）payload：

```
{ state: 'checking'|'none'|'available'|'progress'|'staged'|'applying'|'err',
  latest?, percent?, received?, total?, error? }
```

`preload.js` 暴露：`updater: { check, download, apply, later, openRelease, status, state }`。

## 6. 数据流与关键流程

### 6.1 检测（静默 + 手动）

1. 启动后 1 分钟静默检测一次；距上次检测 `settings.updates.lastCheckAt` 不足 `checkIntervalHours`（默认 24）则跳过。手动「检查更新」不受限。
2. `GET https://api.github.com/repos/zero-fool/kp-workbench/releases/latest`，`Accept: application/vnd.github+json`，8s 超时，遵循 `HTTP(S)_PROXY` 环境变量。
3. 解析 `tag_name` → 版本号；`draft`/`prerelease` 视为无更新；比较 `semver.compare(latest, current)`，>0 才提示。
4. 从 `assets` 里按文件名匹配 `KP-workbench-v<latest>-green.zip` / `-portable.exe` / `-setup.exe`（附件名规范见 `tools/publish-github.sh`）。
5. 结果写入状态快照并向渲染层推送；失败只记录 `runlog.warn`，不打扰用户（手动检查才报错）。

### 6.2 下载与校验

1. 落盘 `<dataDir>/updates/`：`download/<name>.part` → 完成后改名。
2. 支持简单续传：`.part` 存在时带 `Range: bytes=<size>-`；服务端不支持（200）则从头写。
3. 下载前检查磁盘可用空间 ≥ `size × 2 + 200MB`，不足直接报错。
4. 完成后校验：字节数等于 GitHub 给的 `size`（缺失时跳过）→ 用 `zip.js` 读中央目录，验证顶层存在 `KP跑团工作台.exe`。任一不过删掉 `.part` 并报错。
5. 进度节流推送（≥200ms 一次），含 `percent / received / total`。

### 6.3 解压

- 目标 `<dataDir>/updates/staged-v<latest>/`，先解压到 `staged-v<latest>.tmp/` 再改名，避免半成品被当成就绪。
- `zip.js` 支持 store(0) 与 deflate(8)，不支持加密；逐条校验 CRC32；拒绝 `..`、绝对路径、盘符路径（防路径穿越）；解压总量上限 400MB、条目数上限 20000（防 zip bomb）。
- 绿色版 zip 顶层是 `KP跑团工作台_vX.Y.Z_绿色版/`，解压时剥掉这一层。
- 解压后校验必需文件：`KP跑团工作台.exe`、`resources/app.asar`；缺失即判失败。

### 6.4 替换与重启（唯一有破坏性的环节）

形态探测（`apply.js`）：

| 判定顺序 | 条件 | 形态 | 更新动作 |
| --- | --- | --- | --- |
| 1 | `process.env.PORTABLE_EXECUTABLE_DIR` 存在 | 便携版 | 退出后用新 exe 覆盖自身单文件，再启动 |
| 2 | 程序目录存在 `Uninstall*.exe` | 安装版 | 下载 `setup.exe`，**交互式**拉起安装程序（沿用上次安装目录），本应用退出 |
| 3 | 其余（解压即用的文件夹） | 绿色版 | 退出后覆盖式复制整个解压目录 |
| 兜底 | 探测未定或程序目录不可写 | — | 不自动替换，只给「打开下载页 / 打开所在文件夹」 |

helper 脚本（`.cmd`，写到 `<dataDir>/updates/apply-<version>.cmd`，`spawn` 时 `detached + windowsHide`，编码用 `chcp 65001` 或纯 ASCII 内容避免中文乱码）：

1. 循环等父进程 PID 退出（`tasklist /FI "PID eq <pid>"`，最多 120s，超时则放弃并写日志）。
2. 绿色版：`robocopy "<staged>" "<appDir>" /E /XD data /R:2 /W:1`（**不删**目标多余文件，不做 `/MIR`）；robocopy 返回码 < 8 视为成功。
3. 便携版：`copy /Y "<新 exe>" "<旧 exe>"`。
4. `start "" "<appDir>\KP跑团工作台.exe"`。
5. 全过程输出重定向到 `<dataDir>/updates/apply-<version>.log`，脚本最后自删。

数据保护红线：**helper 绝不写入或删除 `data/`**（绿色版若把 `data` 放在程序目录内，靠 `/XD data` 显式排除）；不触碰设置文件；不做镜像式删除。

用户交互：`staged` 就绪后弹应用内确认框「已下载 vX.Y.Z，是否立即重启更新？」→「立即」走 `updater:apply`；「稍后」走 `updater:later`（保留暂存文件，页面上可再点）。

### 6.5 界面（更新公告页）

顶部状态卡：当前版本、检查按钮、状态文本 / 进度条、失败原因。

| 状态 | 展示 |
| --- | --- |
| 检查中 | 「正在检查…」，按钮禁用 |
| 已最新 | 「已是最新版本（vX.Y.Z）」，清掉历史 error 与进度 |
| 发现新版 | 展示该版 Release 通告条目 + 按钮：`下载并更新` / `打开下载页` / `稍后` |
| 下载中 | 进度条 + 百分比 + 预计剩余（按钮变「取消并稍后」不做，仅禁止重复点击） |
| 已就绪 | 「vX.Y.Z 已下载，重启后生效」+ `立即重启更新` / `稍后` |
| 失败 | 可读原因 + `打开下载页` 兜底按钮 |

设置页新增：「启动时自动检查更新」（默认开）、「检查间隔（小时）」（默认 24）、「下载加速前缀」（默认空，留空即直连）。

## 7. 错误处理

| 场景 | 处理 |
| --- | --- |
| 网络失败 / 超时 | 手动检查：状态卡显示原因 + 打开下载页；静默检查：仅 `runlog.warn` |
| GitHub 403 限流 | 提示「GitHub 接口限流，请稍后再试」+ 打开下载页 |
| 磁盘不足 | 下载前拦截，提示需释放的空间 |
| zip 损坏 / 校验不过 | 删除 `.part`，提示「下载文件校验失败，已删除，可重试」 |
| 解压出结构不符 | 保留 zip，报错并提示可手动解压使用 |
| helper 替换失败 | 写 `apply-*.log`；旧文件未被删除故应用仍可用；下次启动检测到失败日志则提示「上次更新未完成，可手动下载新版」 |
| 程序目录不可写（如装在 Program Files 的绿色版） | 探测为不可写时不走自动替换，直接给下载页 |

## 8. 测试策略

单测（`tests/updater/*.test.js`，`node:test`，零第三方）：

- `semver`：`3.1.2 / 3.1.1 / 3.10.0 / 1.11.0.1` 比较；前导 `v`；段数不等；非法输入。
- `github`：给定 Release JSON → 版本、正文、三种资产 URL 解析；`prerelease` 忽略；资产缺失返回 null。
- `zip`：自造小 zip（store 与 deflate 各一、含中文文件名）解压内容一致；CRC 不符报错；`../` 路径被拒；超限被拒。
- `apply`：形态探测三分支（mock env 与目录）；helper 脚本内容断言（含 `/XD data`、不含 `/MIR`、含 PID 等待）；暂存目录改名逻辑。
- `index`：编排顺序与状态快照；失败路径不遗留 `.part`。

不触网：HTTP 一律用本地 `http.createServer` 打桩。

守卫（必须保持通过）：`tools/wiring-audit.js`（渲染层 `api.*` 必须在 preload 暴露、`WB.*` 必须挂载）、`tests/preload-contract.test.js`（preload 与 main 通道对齐）、`npm run verify`。

手工验收：见第 11 节。

## 9. 影响面

| 文件 | 改动 |
| --- | --- |
| `src/main/updater/*` | 新增 5 个文件 |
| `src/main/main.js` | 删除 electron-updater 段（1051–1079 行），改注册 `updater:*` |
| `src/preload.js` | `updater` 命名空间扩展（保留 `check`/`state` 向后兼容） |
| `src/renderer/app.js` | 更新公告页状态卡重写、新增 `WB.upd*` 方法、设置项 |
| `package.json` | 删 `electron-updater` 依赖（若在 deps 中）、删 `build:update` 脚本、`build.publish` 段退役 |
| `DEPLOY.md` | 更新发布说明（不再讲 latest.yml/更新包，改讲 GitHub Releases 自更新） |
| `tests/updater/*` | 新增单测 |

## 10. 交付节奏（四期，每期独立可验收）

- **M1 检测与展示**：`github.js` + `semver.js` + `updater:check/status/openRelease` + 状态卡（含「已是最新」与失败态）。可验收：真实仓库能查到最新版并正确显示更新通告。
- **M2 下载与解压**：`zip.js` + 断点续传 + 校验 + 暂存，`updater:download` + 进度条。可验收：能把 121MB 绿色版完整下载并解压到暂存目录，中途断网重试可续传。
- **M3 替换与重启**：`apply.js` + helper + 形态分流 + 询问弹窗。可验收：绿色版点「立即重启更新」后，应用自动换新版并重新启动，数据与设置完好。
- **M4 收尾**：设置项、失败兜底提示、electron-updater 退役、文档与测试补齐。可验收：`npm run verify` 与全量测试通过。

## 11. 验收标准

1. 全新绿色版启动后 1 分钟左右自动检测；有新版时状态卡出现新版号与该版更新通告，无新版显示「已是最新版本」。
2. 断网 / GitHub 不可达时，手动检查给出可读原因和「打开下载页」按钮，不出现空白或永久报错残留。
3. 点「下载并更新」有真实进度（百分比随时间增长），断网重连后能从断点继续。
4. 下载完成的 zip 校验通过（大小一致、内含 exe 与 app.asar）；故意损坏 zip 会被判失败且不进入替换。
5. 点「立即重启更新」后应用自行退出、文件被替换、新版本自动启动，界面显示新版本号。
6. 更新前后 `data/`（档案、资料、投骰记录、运行记录）与设置**零丢失**；绿色版 data 在程序目录内时也不会被覆盖或删除。
7. 便携版与安装版路径分别按第 6.4 节动作执行（便携版替换单文件；安装版拉起安装程序）。
8. 安装版安装到非默认目录时，更新不会装到别处。
9. 上次更新失败的机器再次启动会给出「上次更新未完成」的提示，且应用仍能正常使用。
10. `npm test`、`npm run verify` 全绿；新增单测覆盖第 8 节列出的全部用例。

## 12. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 覆盖替换过程中断电/被杀进程，程序目录处于半新半旧状态 | 覆盖式复制（不删旧文件）降低损伤；helper 写日志；失败提示可手动解压新版覆盖 |
| robocopy 复制 180MB+ 期间用户以为程序卡死 | 替换前明确提示「正在更新，请勿关闭窗口，几秒钟后自动重启」 |
| 绿色版用户把 data 放在程序目录内被覆盖 | `/XD data` 显式排除 + 单测断言脚本含该参数 |
| antivirus 拦截 helper.cmd 或替换行为 | 说明文档提示可加白名单；失败不影响旧版本可用 |
| GitHub 在部分地区不可达 | 支持 `HTTP(S)_PROXY`；提供可选下载加速前缀；始终保留「打开下载页」 |
| 自写 ZIP 解析有漏洞/兼容性问题 | 只接受 GitHub 自己产出的 zip（可控）；CRC 校验 + 大小上限 + 单测覆盖 store/deflate/中文名 |
| electron-updater 退役后有人仍想用更新服务器 | 本文件第 3 节明确非目标；DEPLOY.md 同步改写，避免两套说法 |
