# 界面重构设计文档 · 动效令牌体系与毛玻璃效果

- 日期：2026-10-20
- 范围：`src/renderer/styles.css`（v3 · 现代卷宗设计系统，第 1425 行起的「全主题通用覆盖层」）
- 约束前提：1248 条选择器基线、全部 id / 事件挂钩 / JS 动态状态类零丢失；五套主题（ember / parchment / lite / neon / dusk）共用同一套结构与动效，配色交给主题令牌。

---

## 1. 设计目标

重构前的问题：界面缺乏统一的设计语言，控件反馈生硬，页面切换无过渡，浮层直接弹出，没有「呼吸感」。

重构目标：

1. **一套令牌管全部** —— 时长、缓动、圆角、阴影、发丝线全部收敛为 CSS 变量，任何组件不写魔数。
2. **分层动效单元** —— 页面入场、浮层、悬停按压、状态指示、循环脉冲各有唯一「单元」，全应用复用。
3. **毛玻璃分层** —— 顶栏 / 状态条 / 浮层遮罩用不同模糊强度区分空间层级。
4. **可降级** —— `prefers-reduced-motion` 一键全关，五套主题换肤不动动效。

---

## 2. 动效令牌体系

### 2.1 核心令牌声明

全部声明在 `:root`（`styles.css` 第 1434–1445 行）：

```css
:root{
  --r:13px; --r-sm:9px; --r-xs:7px;                  /* 圆角三级 */
  --hair:color-mix(in srgb,var(--ink) 9%,transparent);   /* 发丝线（弱） */
  --hair-2:color-mix(in srgb,var(--ink) 16%,transparent);/* 发丝线（强） */
  --el-1:0 1px 2px rgba(0,0,0,.06), 0 1px 1px rgba(0,0,0,.03);
  --el-2:0 12px 28px -18px rgba(0,0,0,.34), 0 1px 2px rgba(0,0,0,.05);
  --el-3:0 28px 64px -32px rgba(0,0,0,.46), 0 1px 2px rgba(0,0,0,.05);
  --ease:cubic-bezier(.2,.8,.2,1);
  --ease-out:cubic-bezier(.22,.61,.36,1);
  --d1:.14s; --d2:.24s; --d3:.42s;
  --ring:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent);
}
```

### 2.2 时长令牌：三档与交互尺寸对应

| 令牌 | 值 | 语义 | 典型应用 |
|---|---|---|---|
| `--d1` | `.14s` | 微反馈，跟手 | 按钮按压、菜单项/命令面板条目高亮切换、小图标位移 |
| `--d2` | `.24s` | 常规过渡 | 卡片悬停、输入框聚焦、导航悬停、浮层内容 `popIn`、边框/颜色变化 |
| `--d3` | `.42s` | 强调动作 | 品牌 logo 旋转、需要被注意到的大幅形变 |

设计原则：**反馈越轻，时长越短**。`--d1` 接近人手按压节奏，`--d3` 只用于刻意设计的「表演性」动作，避免慢动画造成操作迟滞感。

特例：按压态显式改写时长，比 `--d1` 更快——

```css
button:active{transform:translateY(0) scale(.98);box-shadow:var(--el-1);transition-duration:.08s}
```

「按下」必须比「抬起」快，才有一按到底的实体感。

### 2.3 缓动令牌

| 令牌 | 曲线 | 用途 |
|---|---|---|
| `--ease` | `cubic-bezier(.2,.8,.2,1)` | 主曲线。起步快、收尾稳（强 ease-out），是全部 keyframes 与 transition 的默认 |
| `--ease-out` | `cubic-bezier(.22,.61,.36,1)` | 柔和离场，用于不想「弹」的位移 |

选 `.2,.8,.2,1` 的理由：前 20% 时间完成大部分位移，视觉上「立刻响应」；末段缓出保证停靠无回弹，符合工具类桌面软件的克制感。全部 22 个 keyframes 统一使用 `var(--ease)`，保证整应用「同一种手感」。

### 2.4 配套视觉令牌（与动效联动）

- **分层阴影 `--el-1/2/3`**：`el-1` 静置 → `el-2` 悬停 → `el-3` 浮层。阴影加深与 `translateY` 抬升同步发生，共同表达「离开表面」。
  ```css
  .card{transition:transform var(--d2) var(--ease),box-shadow var(--d2) var(--ease),border-color var(--d2) var(--ease)}
  .card:hover{transform:translateY(-2px);box-shadow:var(--el-3)}
  ```
- **焦点环 `--ring`**：用 `color-mix` 从主题强调色生成 22% 透明度的 3px 外环，五套主题自动配色，无需逐主题写 focus 样式。
- **主题收敛**：`--shadow` 旧主题各不相同（厚黑投影），用「同特异性、更靠后」的规则统一改写，五套皮肤一次性获得柔和阴影：
  ```css
  :root[data-theme]{ --shadow:var(--el-2); --radius:var(--r); --radius-sm:var(--r-sm); }
  ```
  这是本文档反复使用的策略：**不动旧规则，在覆盖层用同特异性后置选择器改写终值**——选择器基线零删改。

---

## 3. 动效单元体系

全文件共 **22 个 `@keyframes`、40 处 `transition`、28 处 `animation`**。按职责分为五个单元族。

### 3.1 页面入场族（视图切换的「呼吸」）

| 单元 | keyframes | 时长 | 应用 |
|---|---|---|---|
| `pageIn` | `opacity 0→1` + `translateY(6px)→0` | `.28s` | `.content` 下所有页面块：`.page-title / section / .cabwrap` |
| `heroIn` | `opacity 0→1` + `scale(1.03)→1` | — | 仪表盘 hero 大图，缩放入场制造景深 |
| `detailIn` | `translateY(8px)` 淡入 | — | 档案柜详情面板 |
| `rowIn` | `translateY(7px)` 淡入 | `.24s` | 档案柜列表行 |
| `illusIn` | `translateY(8px)` 淡入 | `.5s` | 空状态插画卡 |

```css
.content>.page-title,.content>section,.content>.cabwrap{animation:pageIn .28s var(--ease) both}
@keyframes pageIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
```

要点：`animation-fill-mode: both` 是全部入场单元的标配——`from` 帧在动画开始前即生效，杜绝「先闪现再跳位」。

**级联节奏**：列表行用 `nth-child` 递增延迟，形成逐条落位的多米诺感：

```css
.cab-list .cab-row{animation:rowIn .24s var(--ease) both}
.cab-list .cab-row:nth-child(2){animation-delay:.012s}
.cab-list .cab-row:nth-child(3){animation-delay:.024s}
```

步长 `.012s` 刻意小：整列表在感知上仍「几乎同时」出现，只多一层细腻的方向性，不做拖沓的瀑布流。

### 3.2 浮层族（遮罩与内容分离）

浮层动画拆两段——**遮罩淡入** + **内容弹入**，二者独立：

```css
.modal-mask,.palette-mask{
  background:color-mix(in srgb,#0b0906 42%,transparent);
  backdrop-filter:blur(6px) saturate(1.1);
  animation:fadeIn var(--d2) var(--ease) both}          /* 遮罩只淡入 */
@keyframes fadeIn{from{opacity:0}to{opacity:1}}

.modal{animation:popIn .24s var(--ease) both}           /* 内容上浮弹入 */
@keyframes popIn{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
```

变体时长：命令面板 `popIn .22s`、下拉菜单 `popIn .18s`（越小的浮层越快）。同族单元还有 `toastIn`（提示条）、`drawerIn`（聊天抽屉 `translateX(14px)`）、`busyIn`（AI 忙碌条）。

**`busyIn` 为什么不复用 `toastIn`**（实测踩坑记录）：

```css
/* busyIn：与 toastIn 同节奏，但终值保留 translateX(-50%) 居中——
   若复用 toastIn（to{transform:none}）会把居中位移动画结束时清掉，整条右偏半屏 */
@keyframes busyIn{from{opacity:0;transform:translate(-50%,12px) scale(.98)}
                  to{opacity:1;transform:translate(-50%,0) scale(1)}}
```

规则：**keyframes 的 `to` 绝不能覆盖元素自身布局所依赖的 transform**（绝对定位居中依赖 `translateX(-50%)`）。

### 3.3 悬停 / 按压族（跟手反馈）

```css
button{transition:transform var(--d1) var(--ease),box-shadow var(--d2) var(--ease),
                  filter var(--d2) var(--ease),background-position .62s var(--ease)}
button:hover{transform:translateY(-1px);box-shadow:var(--el-2);background-position:-40% 0}
button:active{transform:translateY(0) scale(.98);box-shadow:var(--el-1);transition-duration:.08s}
```

统一手势语法（全应用一致）：

| 状态 | 位移 | 阴影 | 其他 |
|---|---|---|---|
| 静置 | 0 | `el-1` | — |
| hover | `translateY(-1px)`（卡片 `-2px`，导航 `translateX(2px)`） | `el-2`（卡片 `el-3`） | 边框向强调色靠拢 |
| active | `translateY(0) scale(.98)` | `el-1` | `.08s` 加速 |

按压必须**回到 0 再微缩**，形成「按下 → 陷入」的完整闭环，而不是从 `-1px` 直接收缩。

### 3.4 状态指示族（JS 动态类名驱动）

与 JS 添加/移除的类一一对应，是回归基线重点保护对象：

| 类 / 元素 | 动效 | 说明 |
|---|---|---|
| `.nav::before` 指示条 | `navIn .34s`（`height 0→20px`） | 当前视图高亮条生长 |
| `.cab-row.sel` | `rowMark .3s`（`scaleY(.2)→1`） | 选中行左侧指示条拉伸 |
| `.statusbar .sb-dot` | `sbPulse 2.6s infinite` | 呼吸状态灯（box-shadow 光晕扩散） |
| `.think-ind.streaming::after` | `kblink .9s steps(2) infinite` | 流式输出方块光标闪烁 |
| `button.ai-running::after` | `aispin` 旋转 | AI 请求进行中 |
| `.sidebar.collapsed` | 宽度过渡 | 侧栏收起（无动画跳变的结构类，靠 width transition 平滑） |
| `.gm-on` 系列 | `display:none` 切换 | 开团模式顶栏精简（结构切换不做动画，避免 reflow 拖沓） |

`sbPulse` 用 `box-shadow` 扩散而非 `transform: scale`，因为状态灯是圆点，光晕比缩放更符合「灯在呼吸」的语义，且不触发合成层抖动：

```css
@keyframes sbPulse{
  0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ok) 55%,transparent)}
  70%{box-shadow:0 0 0 6px transparent}
  100%{box-shadow:0 0 0 0 transparent}}
```

### 3.5 高亮闪光族（一次性脉冲反馈）

JS 临时加类、动画播完自动停（`animation` 播一次）：

| 类 | 动画 | 触发场景 |
|---|---|---|
| `.helpcard.help-flash` | `helpflash 1.6s` | 帮助中心定位高亮 |
| `.dice-channel-card.flash` | `qqdFlash 1.6s` | 骰娘频道卡片定位高亮 |
| `.script-scene.flash` | 无动画，边框+光圈定格 | 剧本场景定位 |

```css
@keyframes helpflash{0%,100%{box-shadow:var(--shadow)}
  25%,75%{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 45%,transparent)}}
```

统一模式：**起止值都回归常态**（`0%,100%` 同为默认阴影），动画结束后不留残影，无需 JS 清理样式。

### 3.6 微交互（小控件）

- 命令面板条目 `.pal-item`：`transition:background/color var(--d1)`，键盘上下移动时高亮瞬时跟手。
- 品牌 logo：`transform var(--d3)` 悬停 `rotate(-5deg) scale(1.06)`——唯一用到 `--d3` 的悬停，刻意做成彩蛋。
- 收藏星标 `.cr-fav`：`transform var(--d2)` 缩放反馈。
- 主题下拉 `#themeSelect`：`border-color/box-shadow/color` 三属性同 `--d2` 过渡，hover 升 `el-2`、focus 亮 `--ring`。

---

## 4. 毛玻璃效果实现

### 4.1 分层配方

毛玻璃不是全局一刀切，按空间层级给三档强度，**全部由「半透明背景 + `backdrop-filter`」两件套构成**：

| 层级 | 选择器 | 背景配方 | 模糊 | 位置 |
|---|---|---|---|---|
| 顶栏 | `.topbar` | `color-mix(in srgb,var(--bg2) 86%,transparent)` | `blur(10px) saturate(1.2)` | 第 1479–1483 行 |
| 底部状态条 | `.statusbar` | 同上 86% | `blur(14px) saturate(1.2)` | 第 1670–1671 行 |
| 浮层遮罩 | `.modal-mask,.palette-mask` | `color-mix(in srgb,#0b0906 42%,transparent)` | `blur(6px) saturate(1.1)` | 第 1640–1641 行 |
| 置顶标签栏 | `.settabs` | `color-mix(in srgb,var(--bg) 90%,transparent)` | `blur(4px)` | 第 906 行 |

典型实现（顶栏）：

```css
.topbar{height:56px;padding:0 18px;gap:14px;align-items:center;
  background:color-mix(in srgb,var(--bg2) 86%,transparent);
  backdrop-filter:blur(10px) saturate(1.2);
  border-bottom:1px solid var(--line);
  box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 40%,transparent)}
```

### 4.2 关键细节

1. **背景必须先半透明**。`backdrop-filter` 只模糊「元素背后的内容」，若背景全不透明，模糊结果被完全遮住，效果等于没开。三档不透明度即对应模糊强度：顶栏/状态条 86%（内容可读优先）、遮罩 42%（看清下层以建立空间关系）、标签栏 90%（sticky 悬浮最上层，最不透明防止文字串扰）。
2. **`saturate(1.2)` 防止发灰**。模糊会把下层颜色平均化，导致观感浑浊；提升 20% 饱和度把色彩「补回来」，这是毛玻璃不显脏的核心。遮罩用 `saturate(1.1)` 略低——遮罩本身要压暗场景，过饱和会喧宾夺主。
3. **强度阶梯表达深度**：状态条 `14px` > 顶栏 `10px` > 遮罩 `6px` > 标签栏 `4px`。状态条模糊最强，因为下方常滚过密集文本，需要更强的「磨砂」保证状态文字可读；遮罩模糊最弱是因为它同时叠加了 58% 不透明的暗色，双重降噪。
4. **发丝边代替描边**：毛玻璃边缘用 `border-bottom:1px solid var(--line)` + `inset 0 1px 0` 白色高光收边，模拟玻璃的边缘反光，而不是粗边框。
5. **与动效配合**：遮罩的 `backdrop-filter` 随 `fadeIn` 的 opacity 一同生效——模糊只在遮罩淡入后可见，形成「世界先变暗、再起雾」的自然次序，无需单独为 blur 写动画（`backdrop-filter` 动画性能开销大且 Safari 兼容性差）。

### 4.3 新旧毛玻璃的收敛

旧文件里已有零散的毛玻璃（`.topbar` 第 637 行 `blur(6px)`、`.modal-mask` 第 322 行 `blur(2px)`、`.palette-mask` 第 758 行 `blur(3px)`）。重构**没有删除任何旧规则**，而是沿用 2.4 节策略：在第 1425 行起的覆盖层里用同特异性选择器重写——

```css
/* 覆盖层（位置更靠后，同特异性，胜出） */
.topbar{ ... backdrop-filter:blur(10px) saturate(1.2); ... }
.modal-mask,.palette-mask{ ... backdrop-filter:blur(6px) saturate(1.1); ... }
```

CSS 层叠规则保证后写覆盖先写，选择器基线因此一字未动。

---

## 5. 实现要点与踩坑清单

1. **`animation-fill-mode: both` 必配**（入场族全部使用）：防止动画开始前显示 `from` 之前的原始状态造成闪烁。
2. **只写 `from` 的 keyframes**（`illusIn`，第 1790–1792 行）：
   ```css
   /* 只写 from、不写 to：收尾值即各主题声明的 opacity/filter，
      否则 fill-forwards 会把终帧钉死，深色皮肤的压暗声明会被动画覆盖掉。 */
   @keyframes illusIn{from{opacity:0;transform:translateY(8px)}}
   ```
   当终态由主题令牌决定时，keyframes 不能写 `to`，否则 `fill: both` 会把终帧钉死、覆盖主题规则。同理 `:root[data-theme="ember"] .ei-img{opacity:.9}` 的压暗只能由主题层声明。
3. **`busyIn` 保留布局 transform**（见 3.2）：keyframes 终值不得清除 `translateX(-50%)`。
4. **结构性切换不做动画**：`.gm-on` 的 `display:none`、`.collapsed` 的子元素隐藏走瞬时切换——涉及大量 reflow 的状态切换做动画会掉帧，只对 `width`、`background` 等廉价属性做过渡。
5. **`color-mix()` 全面替代硬编码色值**：阴影、光晕、hover 边框、选区全部由主题色混合生成，换肤时动效视觉自动跟随，无需维护五套动效配色。
6. **旧主题硬投影/直角的统一收敛**靠 `:root[data-theme]` 后置覆盖，不逐主题改写（见 2.4）。

---

## 6. 无障碍与降级

```css
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;
    transition-duration:.001ms!important}
}
```

- 全局通配一次性关停所有动效，不依赖任何组件配合，新增组件自动被覆盖。
- `animation-iteration-count:1!important` 连循环动画（`sbPulse` / `kblink` / `aispin`）一并停掉。
- 配套无障碍：`:focus-visible` 2px 强调色描边（第 1707 行）、`::selection` 选区着色、`ink-soft` 正文对比度 ≥6:1（AA 通过，见第 1786 行注释）。

---

## 7. 验证结果（2026-10-20 终验）

**静态统计**（`src/renderer/styles.css`）：

- `@keyframes`：22 个；`transition:`：40 处；`animation:`：28 处；`backdrop-filter:`：7 处。

**浏览器实测**（headless Chrome 1440×900，加载 `out/renderer`，经 HTTP 静态服务）：

| 阶段 | 结果 |
|---|---|
| 页面加载 | OK，0 JS 错误 |
| 主题切换 ×3（ember / neon / parchment） | OK |
| 视图导航 ×4（dash / chars / lore / settings） | OK |
| Ctrl+K 命令面板开关 | OK（`#paletteMask` 正常开合） |
| 动效令牌断言 | `--ease = cubic-bezier(.2,.8,.2,1)`、`--d2 = .24s`、顶栏 `backdrop-filter = blur(10px) saturate(1.2)`、**22 个 keyframes 全部解析、67 条规则含 transition/animation** |

**JS 错误总数：0。**

**回归保障**：`npm test` 391 GREEN · 0 RED；`npm run verify` 接线审计 + 30 条指令回归通过——选择器基线 1248 条、全部 id 与事件挂钩零丢失。

---

## 8. 文件索引

| 内容 | 位置 |
|---|---|
| 设计系统覆盖层（v3） | `src/renderer/styles.css` 第 1425–1714 行 |
| 动效/视觉令牌 | 第 1433–1445 行 |
| 顶栏毛玻璃 | 第 1479–1483 行 |
| 浮层毛玻璃 + 浮族动画 | 第 1639–1667 行 |
| 状态条毛玻璃 + 呼吸灯 | 第 1669–1677 行 |
| 无障碍降级 | 第 1711–1714 行 |
| 主题皮肤令牌（五套） | `src/renderer/styles.css` 文件头部主题区块 |
| 构建产物 | `out/renderer/`（`npm run build:renderer` 同步） |
