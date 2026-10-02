# 03 · 骰娘内核 dice-core

`src/dice-core` 是自研 TRPG 骰娘内核，**不依赖 Electron**，可在纯 Node 环境下跑单测。它负责从「一条消息文本」到「一组回复」的全部逻辑：指令解析、表达式求值、规则检定、权限校验、插件、会话状态与文案渲染。

设计上遵循「固定导出名 + 契约先行」：跨里程碑不可改名的导出（如 `parseExpr` / `rollExpr` / `CommandBrain.handle`）保证各模块与测试的稳定。

## 1. 模块总览

| 目录 | 职责 | 关键导出 |
| ---- | ---- | ---- |
| `expr/` | 表达式词法/语法解析与求值、随机数 | `parseExpr` / `rollExpr` / `Rng` / `ExprError` / `DICE_LIMITS` |
| `calc/` | 受限表达式求值（检定分档计算） | `evalCalc` / `parseCalcAst` / `LIMITS` |
| `rules/` | 检定分档模型 + 规则数据包 | `check` / `render` / 数据包加载 |
| `brain/` | 指令大脑：解析、分发、执行、渲染 | `CommandBrain` / `registerCmd` / `getCommand` |
| `perm/` | 会话权限闸 | `createPermGate` / `rank` / `RANK` |
| `plugin/` | 插件宿主、校验、AI 生成向导 | `createPluginHost` / `validatePlugin` / `createWizard` |
| `ports/` | 契约接口与内存实现 | `normalizeMessage` / `makeReply` / `assertChannel` / `createMemory*` |
| `reply/` | 文案渲染与人设模板 | `createReplyRenderer` / `DEFAULT_PERSONA` / `DEFAULT_TEMPLATES` |
| `state/` | 会话/用户/日志状态 | `createStateBox` / `createStateStore` |
| `hub/` | 消息总线（通道 ↔ 大脑） | `createHub` |

对外门面：[hub/index.js](file:///workspace/src/dice-core/hub/index.js) 与 [brain/index.js](file:///workspace/src/dice-core/brain/index.js)。preload 另直接 `require('./dice-core/expr')` 与 `rules` 暴露同步求值能力。

## 2. expr —— 表达式引擎

门面 [expr/index.js](file:///workspace/src/dice-core/expr/index.js)，固定导出：

```js
parseExpr(src) → Ast              // 词法 + 语法分析
rollExpr(ast, rng) → { total, detail[] }   // 求值
new Rng(seed).int(min, max) / .pick(arr)   // 可复现随机数
ExprError                          // 带 line/col 的错误
DICE_LIMITS                        // 骰数/面数上限
```

文件构成：`lexer.js`（词法）、`parser.js`（语法）、`roll.js`（求值 + 限额）、`rng.js`（种子随机）、`errors.js`。

特点：`Rng` 由种子决定，同一 `seed` 结果可复现；求值结果 `detail[]` 保留逐步过程，供渲染层展示投骰明细。

## 3. calc —— 受限表达式求值器

[calc/index.js](file:///workspace/src/dice-core/calc/index.js) 用于**检定分档**等场景的沙箱求值：

- 支持：数值/字符串/布尔、四则与比较、`and`/`or`/`not`、`if`、局部变量（`name = expr; …` 末值为结果）、字段引用（`env.fields` 与 env 顶层键）、`roll('3d6')`。
- 函数白名单：`round, min, max, floor, ceil, abs, str, if, roll`。
- 沙箱限额：无 IO、无全局访问、无自定义函数；步数 ≤10000、深度 ≤32、单次骰式 ≤100 骰 1000 面（`LIMITS`）。
- 固定导出：`evalCalc(src, env) → {ok, value} | {ok:false, error}`；`parseCalcAst(src)` 供插件校验器静态审计。

## 4. rules —— 检定分档与规则包

[rules/index.js](file:///workspace/src/dice-core/rules/index.js)：

- 内置三套规则包（`packs/plain.json` / `coc7.json` / `dnd5e.json`），与插件**同格式**，便于统一校验与扩展。
- 数据包结构：`manifest`（id/name/version/ruleset/author/minCore）+ `dice` + `checks` + `cardFields` + `commands` + `templates`。
- `check()` 具备双形态分派：参数含 `checks` 数组时按插件形态 `check(plugin, skill, env, rng)`，否则为 M1 形态 `check(ctx, {expr, skill, level})`。
- `render(tpl, vars)` 做字符串插值，未知占位符原样保留。
- CoC 房规分档、疯狂症状表（`.ti` / `.li`）依据 CoC 7th 公开规则自行实现。

## 5. brain —— 指令大脑

### 5.1 CommandBrain（[brain/CommandBrain.js](file:///workspace/src/dice-core/brain/CommandBrain.js)）

核心方法 `handle(messageIn, ctxData) → ReplyOut[]`：

1. `parseCommand(raw, {prefix: '.', fullwidth: true})` 解析指令；失败则尝试 `parseNoPrefix`（骰主远程指令可无前缀直呼）。
2. 精确匹配不到时回退 `splitAttached`，兼容 Dice-Next 的「指令与参数粘连」写法（`.ra侦查60` / `.en侦查`）。
3. 兼容旧文案 `.strXXX` 统一交由 `str` 指令。
4. 取会话 `sessionIdOf(msg) = channel:groupId | private:userId`，注入会话状态。
5. 构建 `CommandContext`（`makeContext`）：`rng` / `ai` / `render` / `ruleReply` / `perm` / `data`。
6. 先查自定义触发词（`custom.handleTrigger`），命中优先于内置指令。
7. 未知指令 → 友好提示；`group === 'admin'` 的指令须过 `perm.check(sender,'manage')`。
8. 执行 `cmd.handle(ctx, args)`，兼容同步返回值与 Promise（`.kp` / `.ai` 为异步指令），异常统一转 `friendlyError`。
9. 返回单元素 `ReplyOut[]`。

辅助导出：`sessionIdOf` / `recordRoll`（写投骰记录，保留最近 500 条）/ `boundCard`（取绑定人物卡）/ `friendlyError` / `makeContext` / `uid`。

### 5.2 指令注册表（[brain/registry.js](file:///workspace/src/dice-core/brain/registry.js)）

`registerCmd({name, alias, group, handle, handleTrigger?, noPrefix?})`，同名重注册会先移除旧名与别名；`getCommand` / `listCommands` / `resetRegistry`。

### 5.3 指令模块（[brain/cmd/](file:///workspace/src/dice-core/brain/cmd)）

`require('./cmd')` 即完成注册（副作用式装配）。指令聚合见 [cmd/index.js](file:///workspace/src/dice-core/brain/cmd/index.js)，分四组：

| 组 | 说明 | 代表指令 |
| ---- | ---- | ---- |
| `core` | 骰点/检定/人物卡基础 | `r` `rh` `ra` `rab` `rap` `rd` `rav` `rcv` `rx` `ba` `dx` `sc` `en` `st` `pc` `npc` `ri` `init` `help` `helpdoc` |
| `fun` | 娱乐/扩展 | `jrrp` `sign` `drew` `draw` `deck` `ti` `li` `nn` `coc` `dnd` `gacha` `favor` `cast` `longrest` 等 |
| `admin` | 设置与管理 | `custom` `log` `admin` `set` `ruleset` `lang` `reply` `bot` `user` `group` `bind` `plugin` `mod` `str` `boton` `master` 等 |
| `ws` | 工作台联动 | `kp` `ai` |

每个指令模块导出 `{ name, alias, group, handle(ctx, args) → {text|segments} }`。同目录的 `parser.js` 提供 `parseCommand` / `splitArgs`，`render.js` 提供 `renderRoll` / `renderProcess`，`state/index.js` 提供 `createStateStore` / `newSession`，另有 `coc-grade.js`（CoC 分档）、`madness.js`（疯狂症状）、`default-dice.js`、`roll-input.js`。

### 5.4 权限闸（[perm/index.js](file:///workspace/src/dice-core/perm/index.js)）

角色分档 `member(0) < admin(1) < gm/owner(2)`；动作 `use`（一般指令）/ `manage`（管理组）。规则：黑名单恒拒；`use` 默认放行；`manage` 需角色 ≥ admin 或命中白名单。

## 6. plugin —— 插件系统

| 文件 | 职责 |
| ---- | ---- |
| [plugin/host.js](file:///workspace/src/dice-core/plugin/host.js) | `createPluginHost({dir})`：安装/卸载/启停/回滚/热加载 |
| [plugin/validate.js](file:///workspace/src/dice-core/plugin/validate.js) | `validatePlugin` / `sanitizePlugin`：结构校验与净化 |
| [plugin/wizard.js](file:///workspace/src/dice-core/plugin/wizard.js) | AI 生成插件向导（两道闸：生成/试跑/安装） |
| [plugin/ai-author.js](file:///workspace/src/dice-core/plugin/ai-author.js) | 依据规则文本调用 AI 起草插件 JSON |
| [plugin/active.js](file:///workspace/src/dice-core/plugin/active.js) | 当前活动插件设置 |
| [plugin/samples.js](file:///workspace/src/dice-core/plugin/samples.js) | 示例插件 |
| `plugin/builtin/*.json` | 内置三套规则（coc7 / dnd5e / general） |

宿主存储约定：用户包落盘 `<dir>/<id>.json`，更新前备份 `<dir>/<id>.prev.json`，启停状态存 `<dir>/state.json`。

关键行为：
- **内置包与用户包走同一套 `validatePlugin`**；`remove` 拒绝删除内置包。
- 启动即热加载；默认活动插件 = 第一个 enabled 的用户包，否则第一个 enabled 的内置包。
- 损坏的用户 JSON 文件在加载时被跳过，不会导致崩溃。
- 导出形态：`PluginHost { install, remove, enable, disable, rollback, list, get, loadAll, onChange }`。

`PluginHost` 在主进程由 [main.js](file:///workspace/src/main/main.js) 创建，通过 `diceCore:plugins*` IPC 暴露给「插件工坊」界面。

## 7. ports —— 契约层

[ports/index.js](file:///workspace/src/dice-core/ports/index.js) 门面统一导出契约与内存实现，是整个内核能被替换/单测的基础。

### 7.1 契约类型（JSDoc）

- **MessageIn**：`{ id, channel, guildId?, groupId?, user:{id,name,role}, text, ts }`
- **ReplyOut**：`{ sessionId, segments:[{type,text}|{type,image}], at? }`
- **CommandContext**：`{ session, sender, perm, data:{workspace,cards,state}, rng, ai }`
- **RulePlugin**：`{ manifest, dice, checks, cardFields, commands, templates }`

### 7.2 文件与导出

| 文件 | 导出 | 说明 |
| ---- | ---- | ---- |
| [message.js](file:///workspace/src/dice-core/ports/message.js) | `normalizeMessage` / `makeReply` | 原始事件归一为 MessageIn；构造单文本段 ReplyOut |
| [channel.js](file:///workspace/src/dice-core/ports/channel.js) | `assertChannel` | 校验 ChannelAdapter 形状契约 |
| [workspace.js](file:///workspace/src/dice-core/ports/workspace.js) | `createMemoryWorkspace` / `KINDS` | 工作台数据端口内存实现 |
| [store.js](file:///workspace/src/dice-core/ports/store.js) | `createMemoryStore` | StorePort 内存实现 |
| [ai.js](file:///workspace/src/dice-core/ports/ai.js) | `createOfflineAi` | 离线 AI 端口（未配置时的降级实现） |

ChannelAdapter 契约（由 dice-net 各通道实现）：

```js
{
  id: string,
  start(): Promise|void,
  stop(): Promise|void,
  onInbound(fn): void,          // 注册入站回调
  send(sessionId, reply): Promise|void,
  status(): { state, ... }
}
```

## 8. reply / state —— 渲染与状态

- **reply**：`createReplyRenderer({persona, templates})` 渲染文案；`DEFAULT_PERSONA` / `DEFAULT_TEMPLATES` 提供默认人设与模板；`rule-replies.js` 定义按规则渲染的键；`io.js` 的 `importPack` 支持文案包导入。
- **state**：`createStateBox()` 维护 `users`（好感/签到）/ `logs`（投骰记录）/ `sessions`（会话设置）/ `persona`（人设）；`logs.js`、`luck.js`（今日运势）为子模块。

## 9. hub —— 消息总线

[hub/index.js](file:///workspace/src/dice-core/hub/index.js) 把「统一消息模型进 → 会话路由 → 回复出」串起来：

```js
createHub({ store, workspace, ai, brain, transformReplies }) → {
  brain,
  attach(channel),      // 注册通道并订阅其 onInbound
  onEvent(cb),          // 订阅 message / replies 事件
  handleInbound(channel, raw),
  listChannels()
}
```

`handleInbound` 流程：`normalizeMessage` → `await brain.handle` → 可选 `transformReplies` 增强 → 逐条 `channel.send` → 广播 `message` / `replies` 事件。

容错原则：单条指令出错只回一条友好错误，不炸会话、不影响其他群；`transformReplies` 抛错时保持原回复。

## 10. 内核调用链示例

```
玩家: .ra侦查60
  → ChannelAdapter.onInbound(raw)
  → hub.handleInbound → normalizeMessage → MessageIn
  → CommandBrain.handle
       parseCommand → { name:'ra', args:['侦查60'] }
       sessionIdOf → session
       makeContext → ctx { rng, ai, render, perm, data }
       cmd/ra.handle(ctx, args)
         ├─ expr.rollExpr / calc.evalCalc
         ├─ rules.check → 分档
         └─ ctx.render / ctx.ruleReply → 文案
  → ReplyOut[{ sessionId, segments:[{type:'text',text:'…'}] }]
  → channel.send(sessionId, reply) → QQ/群
```
