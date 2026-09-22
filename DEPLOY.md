# 安装 / 更新发布指南

本工具的安装方式为「安装 + 增量更新」：用户用一次**安装包**装到任意位置，之后每次发版只发**更新包**，更新包在原有安装上原地覆盖升级，无需删除、无需重装，也不丢数据（安装版数据保存在系统用户目录，独立于安装位置）。

## 1. 两个构建命令

| 命令 | 产物 | 用途 |
| ---- | ---- | ---- |
| `npm run build:installer` | `dist/KP跑团工作台_v<版本>_安装版.exe` | 完整安装包（首次安装，可自选目录） |
| `npm run build:update` | 安装包 + `安装版.exe.blockmap` + `latest.yml` | 用于发布更新，产物整体作为更新源 |

> 说明：
> - `build:update` 会额外生成 `latest.yml` 和 `.exe.blockmap`（差分 / 最新版本元数据），应用据此检查并下载新版，在原有安装上覆盖升级。
> - 两种命令在 **Windows** 上执行即能得到最终 `.exe`。在 Linux/mac 上打包 Windows 目标需要 `wine`，建议直接在 Windows 机器上发布。
> - 便携版仍可用 `npm run build:portable` 产出单文件绿色版（但不支持自更新）。

## 2. 第一步：先设置更新源地址

更新源地址写在触发时的配置里。发布前把 `package.json` 的 `build.publish.url` 改成你的实际地址：

```json
"publish": [{ "provider": "generic", "url": "https://<你的域名或服务器>/KP跑团工作台/updates/" }]
```

这个地址会在打包时写入应用的 `app-update.yml`（已验证生成于 `dist/win-unpacked/resources/app-update.yml`），是应用「检查更新」时请求的地址。

## 3. 发布更新包的步骤

1. 改版本号：把 `package.json` 的 `version` 升为新版本（例如 `2.4.4` → `2.4.5`）。
   - 版本比较完全依赖 `package.json` 的 `version`，**每次发版必须提升**，否则应用认为没有新版本。
   - 同步把 `src/renderer/app.js` 顶部的 `APP_VERSION = '2.4.4'` 改成相同值（仅用于界面显示）。
2. 在「更新公告」页脚本（`src/renderer/app.js` 的 `CHANGELOG`）里补一条本次更新的条目，方便用户看到说明。
3. 在 Windows 上执行 `npm run build:update`。
4. 把 `dist/` 下这 **三个文件** 上传到第 2 步的地址根目录：
   - `KP跑团工作台_v<版本>_安装版.exe`
   - `KP跑团工作台_v<版本>_安装版.exe.blockmap`
   - `latest.yml`
5. 老用户打开应用 →「更新公告」→「检查更新」，即自动比对、后台下载、下载完自动重启完成覆盖升级。

## 4. 更新源托管选项

- **任意静态站点 / 对象存储 / 自建 Web 服务**：把三个文件放在一个固定可访问的 HTTPS 目录即可（上面的 generic 方式）。
- 换用 **GitHub Releases**：把 `publish` 改为
  ```json
  "publish": [{ "provider": "github", "owner": "<你的用户名>", "repo": "<仓库名>" }]
  ```
  然后发布 tag 时把三个产物传上去，应用会自动从 GitHub 读取。

## 5. 数据安全保证

安装版数据存放于系统用户目录（`app.getPath('userData')`），与安装目录无关。原地覆盖升级、甚至卸载重装都不会触碰数据；从旧绿色版切换过来时，应用会自动把旧 `data/` 搬到用户目录，无需手动处理。

## 6. 贴合你诉求的验证对照

- 「只留一个安装包，可选安装位置」→ `build:installer`，NSIS 安装器 `allowToChangeInstallationDirectory: true`。
- 「更新包在原有包体上更新，不用反复删除」→ `build:update` 产出差分包 + `latest.yml`，应用下载后 `quitAndInstall` 原地覆盖升级。
- 「无需翻来覆去删除包体」→ 安装版数据独立于安装目录，覆盖升级与数据互不干扰。