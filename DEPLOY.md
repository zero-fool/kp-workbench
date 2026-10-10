# 安装 / 更新发布指南

本工具的更新机制基于 **GitHub Releases**：应用内「更新公告」页检测最新 Release，按当前运行形态下载对应产物，校验后自动替换并重启。不再依赖 `electron-updater`、`latest.yml` 与 blockmap 差分包。

> **发布产物规定（长期有效）**：所有版本一律只制作并发布 **绿色版 + 便携版** 两种产物，**不再制作、不再发布安装版**（`-setup.exe`）。原因：安装版体积更大、构建环境要求更高（需 NSIS + wine），而绿色版与便携版已覆盖全部运行形态且更新机制更简单可靠。

## 1. 运行形态与更新策略

| 形态 | 判定依据 | 检测到新版后 |
| ---- | ---- | ---- |
| 绿色版 | 程序目录无 `Uninstall*.exe`（解压即用的文件夹） | 下载 `-green.zip` → 校验 `KP跑团工作台.exe` 与 `resources/app.asar` → 解压到暂存 → 退出后覆盖复制 `data/` 之外的文件并重启 |
| 便携版 | 存在环境变量 `PORTABLE_EXECUTABLE_DIR`（单文件自解压） | 下载 `-portable.exe` → 校验 PE 头（`MZ`）→ 退出后替换自身 exe 并重启 |

- 程序目录不可写时（例如装到 `Program Files` 的绿色版）不做自动替换，界面退化为「打开下载页」手动更新。
- 产物命名固定为 ASCII，与 `tools/publish-github.sh` 一致：
  `KP-workbench-v<版本>-green.zip` / `-portable.exe`。

## 2. 应用内自更新流程

1. **检测**：请求 `https://api.github.com/repos/<owner>/<repo>/releases/latest`，取 `tag_name` / `body` / `assets`。
   - 匿名访问 `api.github.com` 容易触发 403 限流，此时自动回退「302 探测」：请求 `github.com/<owner>/<repo>/releases/latest`，从 `Location` 头解析 `vX.Y.Z`（只有版本号，资产地址按命名规范拼出）。
   - 预发布（`prerelease`）与草稿（`draft`）不参与比较；版本比较按 `主.次.补丁[.更迭]` 逐段进行。
   - owner/repo 常量写死在 [github.js](src/main/updater/github.js)：`OWNER = 'zero-fool'`、`REPO = 'kp-workbench'`。**换成自己的仓库时必须同步修改这里**，否则检测/下载会指向错误仓库。
2. **下载**：写临时文件 `<文件>.part` 并支持 HTTP Range 断点续传；完成后校验下载字节数（当 API 提供了 `size` 时）。
3. **校验 / 解压**：绿色版 zip 用零依赖解析器读取中央目录，逐条校验 CRC32，拒绝 `..`/绝对路径/盘符路径（防路径穿越），限制解压总量 ≤ 400MB、条目数 ≤ 20000（防 zip bomb），并剥掉顶层目录 `KP跑团工作台_vX.Y.Z_绿色版/`。
4. **替换并重启**：生成纯 ASCII 的 `.cmd` helper（路径经环境变量以 UTF-16 传入，避免中文乱码），detached 拉起后应用退出；脚本等待 exe 释放锁、覆盖文件、`robocopy` 同步（绿色版，`/XD data` 跳过数据目录）、重新启动。

界面行为：启动约 1 分钟后静默检查一次（可在设置里关闭 / 调整间隔）；检测到新版后默认**自动下载**，下载完成弹窗询问「立即重启更新 / 稍后」，「稍后」可在「更新公告」页点「立即重启更新」；上次更新未完成会在下次启动时提示。相关开关见「设置 → 关于 → 更新设置」，下载加速前缀（镜像）也在该处配置。

## 3. 发布前准备

1. 提升版本号：把 `package.json` 的 `version` 升为新版本（例如 `3.1.2` → `3.1.3`）。
   - 版本比较完全依赖 Release 的 tag，**每次发版必须提升版本号**，否则应用认为没有新版本。
   - 同步把 [app.js](src/renderer/app.js) 顶部的 `APP_VERSION = '...'` 改成相同值（`npm test` 会校验二者一致）。
2. 在 [app.js](src/renderer/app.js) 的 `CHANGELOG` 里补一条本次更新条目——它同时是应用内「更新公告」内容与 Release 正文的来源。
3. 发布前跑通：`npm test`（含 `tests/updater.test.js`）与 `npm run verify`。

## 4. 构建产物（只出绿色版 + 便携版）

| 命令 | 产物 | 对应形态 |
| ---- | ---- | ---- |
| `npm run build` | `dist/KP跑团工作台_v<版本>_便携版.exe` + `dist/KP跑团工作台_v<版本>_绿色版.zip` | 一键产出两种发布产物 |
| `npm run build:portable` | `dist/KP跑团工作台_v<版本>_便携版.exe` | 便携版 |
| `npm run build:green` | `dist/KP跑团工作台_v<版本>_绿色版.zip`（由 `build:dir` 产出 `win-unpacked/` 经 `tools/package-green.js` 压缩，压缩包顶层目录为 `KP跑团工作台_v<版本>_绿色版/`） | 绿色版 |

> **不再提供** `build:installer` 安装版构建。在 Windows 上打包即得到最终 `.exe`；在 Linux/mac 上打 Windows 目标需要 `wine`，建议直接在 Windows 机器上发布。

## 5. 一键发布到 GitHub Releases（tools/publish-github.sh）

```bash
GH_TOKEN=<具备 Contents: write 的令牌> bash tools/publish-github.sh            # 发布 dist 中所有版本
GH_TOKEN=xxx bash tools/publish-github.sh 3.1.2                              # 只发指定版本
GH_TOKEN=xxx bash tools/publish-github.sh --dry-run                          # 只打印动作
```

- Release 正文（「更新通告」）由 `tools/release-notes.js` 从 `src/renderer/app.js` 的 `CHANGELOG` 自动生成；因此**发版前务必先在 CHANGELOG 里补上该版本条目**，否则正文会退回通用说明。
- 附件名统一为 ASCII（中文附件名会被 GitHub 规范化成 `KP._vX_.exe` 导致撞名）：`KP-workbench-vX.Y.Z-green.zip` / `-portable.exe`（仅这两种）。
- **Release 必须是「latest 正式版」**：不要勾选 Pre-release，草稿不会对外可见。应用只认 `releases/latest`。
- 脚本可重复执行：已存在的 Release 会刷新通告正文，已上传的附件自动跳过，缺失的附件补传。

## 6. 更新源、镜像与代理

- owner/repo 写在 [github.js](src/main/updater/github.js)，默认 `zero-fool/kp-workbench`；`tools/publish-github.sh` 则从 `git remote origin` 推断仓库，**两者需指向同一仓库**。
- 匿名访问 API 会被限流，代码已内置 302 探测回退；仍失败时可在「更新设置」填「下载加速前缀」（如 `https://ghproxy.net/`），下载请求会自动拼接该前缀。
- 网络走系统代理：识别 `HTTPS_PROXY` / `HTTP_PROXY` 及其小写形式，命中 `NO_PROXY` 则直连（通过 `CONNECT` 隧道 + TLS）。

## 7. 数据安全保证

- **便携版**：数据存放于系统用户目录（`app.getPath('userData')`），与程序位置无关，覆盖升级不会触碰数据。
- **绿色版**：数据在 exe 同目录 `data/` 内；替换脚本以 `/XD data` 跳过该目录，升级不丢数据。
