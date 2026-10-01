'use strict';
/* KP 跑团工作台 · 渲染层 */
(function () {
  /* 尽早初始化全局 WB 命名空间：骰娘 AI 开关/表情包等方法在文件中部(提交自 window.WB= 之前)
   * 以「window.WB.xxx = function」方式挂载，若不预先建空对象会在加载期抛 TypeError 导致
   * 整页卡在「加载中…」且所有按钮失效。详见 7539 行的 Object.assign 合并。 */
  window.WB = window.WB || {};
  const q = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* 用于「内联 onclick 的 JS 字符串参数」，防止 esc() 的 `&#39;` 被浏览器先解引用成 `'` 再闭合 JS 字符串造成注入。
   * 只对字符实体做 HTML 转义、对单引号/反斜杠/换行做 JS 转义，确保解码后仍停留在字符串内。 */
  const escJs = (s) => String(s == null ? '' : s).replace(/[\\'<>&"\n\r]/g, (c) => ({ '\\': '\\\\', "'": "\\'", '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\n': '\\n', '\r': '\\r' }[c]));
  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16).slice(-4);

  const DATA_TYPE = { pcs: '人物卡', npcs: 'NPC', regions: '地区', logs: '日志', mobs: '怪物', rules: '规则', lore: '背景' };
  const KINDS = ['pcs', 'npcs', 'regions', 'logs', 'mobs', 'rules', 'lore'];
  const TPL_KINDS = ['pcs', 'npcs', 'mobs']; // 仅「卡片类」实体支持切换模板（模板改变显示字段集）
  const THEMES = [['ember', '残火纪·暗黑'], ['parchment', '羊皮纸手账'], ['lite', '极简浅色'], ['neon', '赛博霓虹'], ['dusk', '暮光护眼']];
  const APP_VERSION = '3.2.0';
  const CHANGELOG = [
    { version: '3.2.0', date: '2026-10-01', type: '正式版·骰娘', items: [
      '完整对照 DiceZone/Dice-Next 补齐骰娘指令：在原有骰点/检定基础上，新增大批骰点、人物卡、设置与平台管理类指令，指令总数扩充到 130 余条，均可在本地工作台脱离 AI 独立运转。',
      '骰点/检定类：新增 .dx 双十字骰池（含 .dx <骰数>a<加骰线> 数成功/WoD 模式）、.rdc DnD 5e 属性检定（支持 轮数# 连投、B/P 优势劣势、±加值或骰式、理由与 DC 紧贴写法，如 .rdc3#+1d4力量 15）、.ww 骰池、.ba/.bav 对抗检定、.rx 暗骰、.rav 对抗骰、.rahb*/.rahp* 批量奖励惩罚骰；.rb2~.rb9 / .rp2~.rp9 支持奖励/惩罚骰数量前缀（如 .rb2 侦查 60）。',
      '人物卡/设置类：.en 技能成长支持批量（.en 侦查|聆听|图书馆）与紧贴成长值；.st 支持 Car0/Car1/Car2 车卡模板录入与查询；.set 新增默认骰重置（.set / .set d off / .set <面数>）；新增 .setcoc 0-7 号 CoC 房规（show/clr）、.setdnd DnD 模式、.setsn 群名片模板、.rpmode 人格切换、.lang 语言、.text 文本、.reply 回复、.welcome 欢迎语（show/off）；.rules 支持 .rules <规则书>:<词条> 查询与 .ruleset 规则包切换。',
      '娱乐/表现类：.name jp 日文起名、.favor 好感度（含 覆写/擦除/增加/成长/排行 中文子命令）、.hiy 打招呼与检定统计、.ob 旁观（join/exit/list/on/off/clr，含权限与开关）、.buff 状态、.gacha 抽卡、.mrrp/.zrrp 明日/昨日人品、.sleep 休息、.ak 抉择。',
      '跑团日志：.log 全面对齐 Dice-Next——new/on/off/end/halt 开合，list 查看记录状态、stat 统计参与者与时段、type txt|html 设置导出格式、timer 跑团计时、export 导出投骰记录；统计会记录投骰者并跨「内核投骰」与「外部记录」统一汇总。',
      '平台管理类：新增 .master/.boton/.botoff/.blackqq/.whiteqq/.blackgroup/.whitegroup 骰主远程管理（支持无前缀直呼），以及 .user/.cloud/.notice/.plugin/.system/.send/.dismiss/.game/.mod/.link/.info/.trust/.alias/.bind 等子命令，本地不可真正执行的部分会给出明确的本地化提示；新增 .str 文案体系（含 .strSelfName 骰娘名称 / .strSelfCall 骰娘自称）。',
      '解析器增强：支持指令与参数紧贴（.ra侦查60 / .en侦查 / .rd100睡觉 等无需空格）、无空格原因、N# 连投、预览式检定，指令名最长匹配优先，避免误拆规则包名。',
      '帮助中心与 .help 同步补齐以上全部指令与写法示例；新增 Dice-Next 兼容测试用例，npm test 366 项、npm run verify 全绿。'
    ] },
    { version: '3.1.6', date: '2026-09-29', type: '正式版·骰娘', items: [
      '修复「骰娘 AI 设置」分项开关点了没反应（只有总开关生效）：分项开关没有 id，原先按 id 取元素恒为空，现改按属性选择器读取，各分项开关均可正常开关并保存。',
      '修复 QQ 官方机器人通道连上后回消息报 404：回发接口改用官方 v2 端点（补 /v2 前缀），鉴权头由 Bearer 改为「QQBot <access_token>」，群/单聊消息可正常回复。',
      '骰娘与 AI 彻底解耦：AI 只作为投掷结果之外的文字润色层——仅在原始结果后追加描述，绝不替换或改动骰点数据；无前后文、AI 超时、AI 关闭，或描述跑偏（索要结果、夹带伪指令、未复述引擎结果数字）时，一律回退为骰娘自带的标准回答，骰娘可完全脱离 AI 独立运转。',
      '新增「按规则自定义投掷回答」：内置「通用 / CoC 7th / DnD 5e」三套回复模板，可在骰娘工作台逐条自定义，自定义优先、缺省回退出厂模板，并随文案包一起加载/保存/导入导出。',
      '新增默认骰与修正语法：.r / .rh 省略表达式时掷默认骰，.r±n / .rh±n 直接修正；.rd±n 与 Dice-Next 行为一致（如 .rd-5）；.set d <表达式> / .set <面数> 设置会话默认骰、.set d off 回退规则默认，优先级为「会话自定义 > 规则包常用骰式 > 通用 1d100」。',
      '新增先攻追踪：.ri [表达式|±n] [名称] 掷先攻并自动入列，.init 查看/删除/推进回合/清空列表，列表按先攻值降序排列。',
      '新增牌堆系统：.draw [牌组名] 从牌堆不放回抽牌（抽完提示洗牌），.deck list/show/reset 查看与管理，牌堆内容取自工作台的随机事件表。',
      '新增 CoC 奖励骰/惩罚骰检定：.rab / .rap（个位掷一次、十位掷 n+1 次，奖励取低 / 惩罚取高），沿用 CoC 分档逻辑与指令日志。',
      '对照 DiceZone/Dice-Next 逐项比对补齐上述指令，帮助中心与 .help 同步更新。'
    ] },
    { version: '3.1.5', date: '2026-09-29', type: '正式版·修复', items: [
      '修复「骰娘 AI 设置」（AI 功能开关 / 群聊 AI 行为 / 表情包库）无法读取与保存、界面误报「preload 未暴露 aiSwitchesGet」的问题：根因是渲染层变量名笔误（window.API 应为 window.api）；现已修复，且该设置直接读写本地存档，不依赖骰娘是否开机，随时可改。',
      '修复侧栏「AI 对话」「折叠侧栏」按钮被误当作视图项，点击会清空当前高亮与视图状态的问题。',
      '统一侧栏气泡尺寸：分组标题与子项改为等高、图标固定尺寸居中，emoji 与符号图标不再高低不齐；超长标签以省略号收尾，不再换行撑高。'
    ] },
    { version: '3.1.4', date: '2026-09-29', type: '正式版·界面', items: [
      '重构：侧栏导航重组为六个可折叠大板块——「总览」（独立大板块）／「工作台功能」／「工作台 AI 功能」／「骰娘功能」／「骰娘 AI 设置」／「设置」，各自展开子项，点击后自动展开所在分组，信息架构更清晰。',
      '调整：「原始文本」归入「工作台 AI 功能」；「总览」从各分组中独立为单独大板块。',
      '新增：「骰娘 AI 设置」大板块——把骰娘运行时的 AI 能力集中到一处：AI 功能开关（总开关 + 分项开关）、群聊 AI 行为（随机插话概率、插话附带表情概率）、表情包库。',
      '优化：帮助中心同步新导航并新增「骰娘 AI 设置」说明；命令面板补齐全部新入口；侧栏折叠态下分组图标居中显示。'
    ] },
    { version: '3.1.3', date: '2026-09-29', type: '正式版·新功能', items: [
      '新增：应用内自更新（基于 GitHub Releases）——「更新公告」页可一键检查更新，检测到新版本后可按当前运行形态自动下载对应产物（绿色版 / 便携版 / 安装版），无需再手动找包换包。',
      '新增：下载完成后自动更新并重启——下载完成会弹窗询问「立即重启更新 / 稍后」；确认后应用退出、由临时脚本接力覆盖程序文件并重新启动到新版。绿色版升级自动跳过 data 数据目录，安装版 / 便携版数据本就在系统用户目录，升级过程不丢数据。',
      '新增：更新可靠性保障——下载支持断点续传与完整性校验；zip 解压内置路径穿越拦截与解压体量防护；程序目录不可写时自动降级为「打开下载页」手动更新。',
      '新增：「设置 → 关于 → 更新设置」——可开关「启动时自动检查更新」「检测到新版本自动下载」，可调检查间隔与下载加速前缀（镜像）；上次更新未完成会在下次启动时提示。'
    ] },
    { version: '3.1.2', date: '2026-09-29', type: '正式版·修复', items: [
      '修复：骰娘工作台「插件工坊」一打开即报「DiceUI.pluginListHTML is not a function」——插件工坊（workshop.js）与 AI 生成向导（wizard.js）共用 window.DiceUI 命名空间，后加载的向导直接整体覆盖命名空间，把插件工坊的方法全部抹掉。现两分区改为合并式挂载，方法共存、互不覆盖。',
      '修复：骰娘通道启动仍报「当前运行环境缺少 WebSocket」——主进程（Node 20）没有全局 WebSocket，原先的兜底（undici / ws 依赖）在打包环境都取不到。现新增项目自带的零依赖 WebSocket 客户端（基于 net/tls 实现 RFC6455 子集），启动早期优先注入，打包后也能连 QQ 官方 / OneBot 网关。',
      '说明：以上两项在 3.1.1 已改源码但未打进打包产物，本版重新打包后真正生效。'
    ]},
    { version: '3.1.1', date: '2026-09-29', type: '正式版', items: [
      '修复：骰娘「连接中心」QQ 官方机器人通道无法启动——填好 appId / clientSecret 点启动后输入框被清空并提示“请输入”。根因有二：① 主进程持有一份写死的空配置，界面填写的凭据从未同步过去，启动校验必然失败；② 输入框只有展示、没有写回绑定，点启动整卡重渲染即被清空。现输入实时保存并持久化，启动前把最新配置一并传给主进程，链路三层打通。',
      '修复：骰娘通道启动报「WebSocket is not defined」——QQ 官方 / OneBot 网关在主进程（Node 环境）建立连接，而主进程没有全局 WebSocket。现启动早期自动注入可用实现（内置 undici，零新增依赖），通道启动不再受此阻断。'
    ]},
    { version: '3.1.0', date: '2026-09-28', type: '正式版', items: [
      '新增：运行记录（持续记录，不只报错）——侧栏「更多工具 → 运行记录」可随时查看 / 按日期·等级·关键词筛选 / 一键打开日志文件夹 / 一键导出；界面与主进程的全部未处理异常都会自动写入，并记录每次进入的界面，形成完整操作时间线，便于遇到问题时快速定位。',
      '新增：运行记录文件直接落盘到 data/runlog/ 文件夹——latest.log（固定路径，每次启动重新生成、只保留本次运行全过程，最容易找）＋ 按天 YYYY-MM-DD.log（保留 14 天自动清理）＋ latest.json（最近一次启动信息）。',
      '新增：侧栏结构调整——「骰娘」升级为与「工作台」平级的独立大板块（连 QQ 骰娘 / 本地掷骰 / 骰娘工作台），不再隐藏在「更多工具」折叠内，入口更直观。'
    ]},
    { version: '3.0.0', date: '2026-09-23', type: '正式版', items: [
      '新增：骰娘板块升级为「骰娘工作台」——六分区（投骰台 / 连接中心 / 指令日志 / 文案与人设 / 插件工坊 / 测试通道），本地投骰与群指令共用同一套自研 dice-core 引擎（规则插件对两端同时生效）。',
      '新增：插件工坊 + AI 生成向导——喂规则文本 → 生成 → 测试通道试跑 → 确认安装（两道闸，装坏可一键回滚，可导出分享）。',
      '新增：.kp 指令原生读写工作台数据并与界面实时双向刷新；.ai 指令支持对话与定向判定（可取消、超时兜底，掷骰永不依赖 AI）。',
      '优化：彻底退役旧掷骰引擎与 HTTP 桥插件，打包体积约 206MB → 约 70MB，零第三方可执行文件。'
    ]},
    { version: '2.10.1', date: '2026-09-21', type: '测试版', items: [
      '优化：清理应用内对外展示的第三方骰娘软件标识，统一为本应用自有「骰娘内核」表述。',
      '加固：修复 /kp 数据桥端口选择可能越过自动发现范围导致 .kp 指令偶发失联的问题——端口现限定在发现集内按真实可用性探测，监听失败不再悬挂。',
      '修复：个人账号登录接口路径适配内核，扫码 / 密码登录不再返回 404。'
    ]},
    { version: '2.10.0', date: '2026-09-21', type: '正式版', items: [
      '新增：骰娘板块内置引擎——不再跳转外部页面，改用内核原生接口（连接列表 / 二维码 / 官方机器人 / 个人账号扫码·密码），全程在本应用内完成。',
      '新增：应用启动自动拉起内置骰娘内核，开箱即用，无需手动定位 / 启动引擎。',
      '优化：骰娘内核随应用一同发布，免额外下载发动机。'
    ]},
    { version: '2.9.5', date: '2026-09-20', type: '正式版', items: [
      '新增：骰娘大板块——应用正式拆分为「工作台」与「骰娘」两大板块。骰娘板块一体整合连 QQ 引擎与本地投骰全部功能。',
      '新增：连 QQ（内嵌骰娘内核）——可释放/启停/重启内核，直接在应用内添加官方机器人 / 个人账号并扫码登录；内核仅支持 Windows。',
      '新增：骰娘板块内嵌完整本地投骰面板——规则库（通用 / CoC 7th / DnD 5e）、自定义与快捷投掷、CoC/DnD 定向检定、AI 定向判定、人物卡 Excel 导入、独立 AI 端口、最近记录，与原「本地掷骰」视图功能完全一致，全部可正常运行且离线可玩。',
      '新增：独立 AI 端口（骰娘专用）——在本板块内配置一个 OpenAI 兼容端点（如本地 Ollama http://127.0.0.1:11434/v1），启用后 AI 定向判定独立走此端口，不再依赖工作台全局 AI 配置；提供保存与连接测试。',
      '优化：移除桥插件——原 .kp 指令数据桥接改由应用内原生实现',
      '优化：原「本地掷骰」视图保留，与「骰娘」板块共用同一套投骰面板与记录，互为一致'
    ]},
    { version: '2.9.4', date: '2026-09-19', type: '正式版', items: [
      '修复：临场战斗开启「回合追踪」后，若回合顺序里存在已被删除或悬空的单位 id（历史数据/中途损坏残留），前进/后退/点击流转可能跳到空单位、轮次错乱；现统一走 encNormOrder 归一化，渲染与所有回合操作共用同一份干净顺序，并自动清理写回，杜绝错位'
    ]},
    { version: '2.9.3', date: '2026-09-19', type: '正式版', items: [
      '修复：设置页主题皮肤 / 卡片密度切换后，按钮高亮态未同步——此前仅皮肤与密度真正生效但按钮不跟着点亮；现已就地刷新激活态、保留未保存输入，并可在顶栏「▤ 密度」快捷切换后同步'
    ]},
    { version: '2.9.2', date: '2026-09-18', type: '正式版', items: [
      '优化：临场战斗结算与列表的存活/倒下统计更严谨——无血量的手动单位不再被误计为「倒下」，改为单独标注「无血量」',
      '优化：遭遇删除单位时自动从回合顺序中清除并顺延当前行动者；回合顺序渲染前自动过滤失效 id，杜绝数据损坏或历史记录残留导致的空名/跳转错位',
      '提升：命令面板接入「临场战斗 / 统计分析」直达；新增全局快捷键 Ctrl+E 进入临场战斗、Ctrl+T 进入统计分析，帮助中心已同步说明',
      '清理：移除统计概览未使用的热力图构建调用，减少导出成本'
    ]},
    { version: '2.9.1', date: '2026-09-18', type: '正式版', items: [
      '新增：遭遇战结算标记——临场战斗战局结束后可一键标记「我方胜利 / 我方败北 / 中途弃置」，卡片与面板显式标注结算态，并自动汇总本场存活/倒下单位数与结算时间，便于复盘（「统计分析」的统计概览也会计算已结算场次）',
      '新增：统计视图导出与复制——「统计分析」顶部新增「导出统计文本」（保存为日期命名的 .txt）与「复制概览」（一键复制数据构成/投骰/遭遇汇总到剪贴板）',
      '优化：遭遇页空状态引导——新建前无遭遇时直接给出可点击的「立即新建遭遇」按钮与引导说明'
    ]},
    { version: '2.9.0', date: '2026-09-18', type: '正式版', items: [
      '新增：临场战斗模块——「工具 → 临场战斗」可直接新建遭遇，登记交战场人物，开启回合追踪（回合/当前行动者高亮、可前进/后退/跳转），逐单位管理血量条与状态（昏迷、血流、中毒、狂暴等），并支持把每轮行动的骰子投掷自动并入遭遇流水，全程随时可停',
      '新增：统计分析视图——「工具 → 统计分析」用图表直观呈现档案数据构成（各类型条数与占比）、投骰时段热力图（一周内 0-23 时 × 周一~周日的投骰密集程度）与近 30 天数据活跃曲线（累计投骰趋势），帮你复盘带团节奏',
      '新增：AI 批量润色——在「日志」页「⋯ 更多 → AI 批量润色（日志）」可一次把多/所有日志交给 AI 逐个润色，结果写入各日志新增的「润色稿（AI）」字段，原正文保留',
      '新增：叙事风格贴合——「设置 → 工作台」可为本团填写期望的叙事/文风（流派、口吻、禁忌等），保存后作为最高优先级偏好注入每次 AI 对话与润色，批量润色与剧本撰写同样遵循',
      '新增：AI 编写剧本全文——在「背景/规则」页「⋯ 更多 → AI 编写剧本全文」，AI 会结合当前档案的人物/地区/背景等上下文，生成一篇完整、分幕、可直接开演的剧本，并作为新条目写入对应页',
      '优化：全部破坏性删除弹窗统一走应用内确认框，修复个别删除入口在部分环境下 confirm 被浏览器屏蔽导致无法弹窗的隐患'
    ]},
    { version: '2.8.3', date: '2026-09-18', type: '正式版', items: [
      '新增：可编辑的 AI 记忆偏好——在「AI 助手 → 偏好」里写下你的使用习惯、格式要求与希望长期遵守的风格（如“分幕输出、回复精炼、喜欢中性人设”），AI 每次对话都会优先遵守并贯穿始终，随你随时增删改',
      '优化：主进程写盘差量传输——保存时只发送内容发生变化的实体分片与关系网，未变动的稳定数据不再整段序列化与跨进程传输，档案越大提速越明显，主进程按补丁原位合并后落盘',
      '优化：超大列表窗口化渲染——资料页一次性不再构造上千个卡片节点，改为首屏分帧渲染 + 滚动到接近底部时按需追加，卡片几千张也不会拖慢首屏出现与滚动交互',
      '优化：全局搜索索引化——把全文小写化与拼接的代价从「每次按键」摊到「数据变更时」一次性构建索引，连续输入关键词时不再反复扫描全库与整篇原文，搜索更跟手',
      '优化：AI 对话增量渲染——聊天记录只在有新消息时追加新行，不再每轮对话重建整个聊天区；仅当有新回复时才自动滚到底，你停在历史里阅读时位置不再被顶走；单纯开关侧栏对话也不再触发无谓重建',
      '优化：主进程备份/元信息内存化——自动备份轮询、元信息统计不再周期性整档读盘，改用内存缓存，后台定时任务更安静、退出/备份不卡顿'
    ] },
    { version: '2.8.2', date: '2026-09-16', type: '正式版', items: [
      '优化：资料卡的「被引用」徽标不再重复计算——此前渲染每一张卡都要把全库卡片的检索文本重新拼一遍，现在按卡片缓存一次即可复用；一屏 60 张卡的扫描耗时在 1000 / 3000 / 8000 张卡规模下由 20 / 65 / 175 毫秒降到 6 / 16 / 58 毫秒',
      '优化：同一批数据下的重复渲染（排序、勾选、收藏、右键菜单后）不再重新扫描全库，卡片越多越明显；改动落盘、切换档案或回滚备份时缓存自动作废，徽标数字不会过期',
      '优化：全局搜索与资料页关键词筛选不再每次输入都对全库卡片做整对象序列化，改为复用预建好的检索串，单次按键提速 8 到 11 倍，连续输入时更跟手',
      '优化：连续编辑卡片不再每次都触发全量 JSON 序列化落盘——持久化改为 300ms 防抖合并，底图多时编辑更流畅；交叉引用徽标仍即时刷新、不受防抖影响',
      '优化：地图底图（base64）从主数据文件外置到 maps/ 目录独立存储，主文件体积骤降、存取提速；内存中的底图不受影响，外置文件被误删时自动降级为空白底图、不崩溃',
      '优化：版本快照不再对含 8MB 底图的完整文档重复做哈希判定，复用落盘时已算好的指纹，每次快照省去一次完整序列化',
      '优化：档案数据按实体类型拆分为独立文件（分片存储）——编辑一张卡只重写该类型的文件，不再序列化+写入全档；旧格式首次打开时自动迁移，迁移前自动备份',
      '优化：新建/复制/删除档案均兼容分片目录与旧格式文件共存，档案列表同时展示两种格式',
      '工程：新增 npm run bench 性能基准，直接调用线上函数复测热路径，后续改动可直接对比'
    ] },
    { version: '2.8.1', date: '2026-09-16', type: '正式版', items: [
      '修复：「排序 → 自定义」下的拖拽手柄完全没反应——取网格元素时误把类名当 id 用，函数在第一步就返回了，现已改为按真实 id 取，手柄可以正常拖动排序',
      '修复：拖拽手柄与卡片右上角的收藏星标位置重叠、互相遮挡——手柄改到卡片名左侧随文字排布，星标与手柄都点得到',
      '修复：自定义排序下按住卡片会吞掉卡内控件的点击与聚焦——拖动前先放过收藏星标、交叉引用徽标、多选框、按钮与输入框',
      '修复：拖拽过程中鼠标一旦移出网格就失灵、松手不落盘——补上指针捕获（与看板、关系网的拖拽做法保持一致）',
      '修复：拖卡时卡片受悬浮上浮效果影响来回抖动——拖动中的卡片不再上浮并高亮落点',
      '修复：卡片名长度超限时不再正确省略为「…」——名字改用独立类名保护，避免批量选择框或手柄抢占样式'
    ] },
    { version: '2.8.0', date: '2026-09-15', type: '正式版', items: [
      '新增：界面舒适度双档密度——顶栏「密度」按钮在一键切换「紧凑 / 舒适」两档排版（卡片间距、最小宽度、内边距、字号行高随档同步），五套主题自动适配，选择会记住',
      '新增：工具栏收编——资料视图的高频动作（搜索 / 排序 / 来源 / 新增 / 导出）留在主行，一致性检查、多选、导入、AI 生成等次要动作收进「⋯ 更多」下拉，工具栏更清爽',
      '新增：卡片右键菜单——资料卡上点右键即可弹出快捷菜单（编辑 / 复制 / 收藏 / 删除 / 一致性定位），常用操作不用再找按钮',
      '新增：自定义拖拽排序——任意视图切换「排序 → 自定义」后，卡片名左侧出现拖拽手柄，直接拖动卡片调整先后顺序，顺序被记住，删除的卡不会留下失效位置'
    ] },
    { version: '2.7.0', date: '2026-09-14', type: '正式版', items: [
      '新增：AI 落地记录与一键回滚——任何 AI 写入工作台前（生成/解析资料卡、采纳地图要素、沉淀长期记忆、应用关系）都会自动留一份整体快照并登记进「🧾 AI 落地记录」，可在面板里对某一次落地逐条回滚，或一键全部回滚到最早那一次前的状态，AI 产物再也不怕改坏',
      '新增：资料卡交叉引用——每张资料卡自动扫描全体卡片正文，统计「谁提到了它」，在卡名旁亮出带数量的「被引用」徽标，点击即可跳转到对应卡片，串剧情、补设定更方便',
      '新增：一致性检查——一键扫描全档结构的健康度：自动揪出「重名卡」与「悬空的关系网连线」等结构问题并逐一列出，点条目可直达定位',
      '新增：效率便利——资料卡新增「⧉ 复制」一键生成含全部字段与模板的副本；多选栏新增「⊘ 去重」，一键删除同类里完全重名的重复卡（只保留最早一条），适合批量整理积压资料'
    ] },
    { version: '2.6.0', date: '2026-09-14', type: '正式版', items: [
      '新增：剧本进度状态机——「剧本分幕」的每一幕都可标记「未开始 / 进行中 / 已完成 / 略过」（点胶囊循环切换）。把某幕设为「进行中」时，原先进行中的幕会自动收尾为「已完成」，顺位推进不会错位；顶部同时显示已完成幕数与进度条，开团时一眼看清演到哪了',
      '新增：伏笔兑现勾选——每幕「关键线索 / 伏笔」前新增勾选框，向玩家兑现后勾上即点亮并划线；尚未兑现的伏笔全部汇总在剧本页顶部的「本场待办」条里，告别「埋了坑忘了填」',
      '新增：本场待办条——剧本页顶部常驻显示「当前幕 + 已完成进度 + 未兑现伏笔一览」，点击伏笔胶囊可直接滚动定位到对应那一幕',
      '新增：一键生成开团清单——把当前幕的地点 / 出场人物 / 道具机关 / 线索与全部待兑现伏笔整理成一段提示词，自动填入侧栏对话并复制到剪贴板，直接发给 AI 索取本幕开场白与检查点提示',
      '新增：现场备注——每幕可随手记录临场发生的事（玩家的选择、裁决结果、被迫偏离原剧情等），下次开团时会自动带进开团清单作为参考',
      '加固：进度与剧本原文彻底分离——剧本内容一个字都不会被改动，进度独立存储，随时可「重开进度」；剧本被 AI 重新分幕或幕数变化后，旧进度自动作废，绝不会错位勾选到别的幕'
    ] },
    { version: '2.5.2', date: '2026-09-14', type: '正式版', items: [
      '重写：关系网「一键整理」——改为「按连通分量各自局部排布 + 按外接圆从大到小打包」两步：有关系的节点聚成一块、块与块之间固定留出空隙，不再互相叠压；孤立点排到外圈且彼此不重叠；去掉随机补种，同一张图重复整理结果稳定，不再越点越乱；整理后自动适应画布（内容比画布大才缩小，不做放大会失真）',
      '新增：全局「AI 处理中」提示——任何界面调用 AI（资料卡生成、地图设计、关系补全、剧本分幕、带团建议、导入拆分、侧栏对话…）都会在底部亮起提示条，显示「正在做什么 + 已用秒数」，并提示勿重复点击',
      '加固：AI 请求防重复——同一时间只放行一项 AI 请求，未完成时再次点击会被明确拦下并说明原因，不会再出现「点了好几下、结果互相覆盖」或重复扣费'
    ] },
    { version: '2.5.1', date: '2026-09-14', type: '正式版', items: [
      '新增：常用资料收藏与置顶——资料卡右上角点星收藏，卡片自动置顶并高亮，总览新增「★ 常用收藏」栏一键直达（也可按「★ 收藏置顶」排序）',
      '新增：批量操作——资料页工具栏「☑ 多选」，勾选后一键批量 删除 / 导出(WORD) / 收藏，适合批量整理的场景',
      '新增：前进/后退导航——资料页与总览工具栏新增「← →」按钮，配合 Alt+← / Alt+→ 快速往返刚浏览的页面',
      '新增：开团向导——总览顶部一条龙引导（建档案→配AI→导入素材→一键拆分→创作），按步点亮即可开起一团，可折叠',
      '优化：AI 错误降级提示——接口不可达/Key 无效/限流/超时/模型不存在等均转为可读原因并提示到「AI 配置」，不再甩裸异常'
    ] },
    { version: '2.5.0', date: '2026-09-14', type: '正式版', items: [
      '新增：帮助中心（侧栏「系统 → 帮助中心」）——开团全流程、AI API 配置、资料/工具/关系网等使用手册分门别类整理，方便随时查阅',
      '优化：AI 提示词模板精细重写——拆分登记明确 7 类实体与去重/输出要求，资料生成细化产出规范（人物/怪物含身份性格外貌经历，日志含时间地点经过结果），去除空话',
      '优化：设置 / 更新公告从「工具」一栏移出，归入新的「系统」分区，导航更清晰；「关于」页补充数据与隐私、免责说明更详细'
    ] },
    { version: '2.4.4', date: '2026-09-13', type: '测试版', items: [
      '修复：一键整理关系网报错——连通分量返回结构与整理逻辑不匹配，只要存在连线，点「⟳ 一键整理」即抛错中断；现已统一结构，整理恢复正常',
      '修复：关系网二次进入画布空白——绘制发生在绑定新画布之前，第二次进入时内容画到了已卸载的旧节点上，需再拖一下才自愈',
      '修复：AI 补全关系的勾选项错位——预览按「新增/修正/删除」分组编号，应用时却按 AI 原始顺序读取，导致取消勾选仍被应用、或该应用的反被跳过；并修正未知操作被当作“删除”处理的隐患',
      '修复：地图椭圆区域 / 椭圆迷雾无法点选——命中判定用归一化半径与像素坐标相除，量纲不一致导致永远选不中（双击改名、删除一并失效）',
      '修复：地图标记点取消后仍残留——新增标记先入列再弹窗，点「取消」不回滚，之后任意一次操作都会把它写进数据',
      '修复：画板返回或切换地图后选中错乱、窗口事件重复叠加（一次松手触发多次保存）',
      '修复：剧情要点写入长期记忆无效——长期记忆条目是对象结构，写入时按字符串处理会直接报错，按钮点了没反应；现已统一为对象结构并按文本去重',
      '修复：「剧情建议」生成的剧情点标题丢失——AI 输出用 title，而工作台日志的标题字段是 name，落库与编辑时被过滤，卡片显示“未命名”；钩子改写进 hook 字段',
      '修复：长期记忆注入 AI 时变成 [object Object]；清空对话后「对话过长」提示长时间不再出现；沉淀记忆后重启又重复提示',
      '修复：设置 → 字段里的「模板选择 / 另存为模板 / AI 依据规则书生成模板」与卡片模板下拉共 5 个入口未挂载到全局，点击报“不是函数”',
      '修复：地图适应视口未真正居中（偏左上）、导出 PNG 时若底图尚未解码会导出没有底图的空图、多边形描边粗细在导出时与其它图层不一致',
      '修复：手动框选区域双击完成时会多写入两个重合顶点（生成退化区域）；区域名绘制未判空，空顶点区域会导致整图不渲染',
      '修复：关系网「居中视图」会把内容推到画布之外；被筛选淡出的节点仍能被点选拖动；拖动节点时侧栏被反复重建，正在输入的内容会被清空',
      '修复：导出地图后坐标状态条与区域提示条重叠；改网格格距后按钮文字不更新；框选提示提到不存在的「完成」按钮',
      '加固：导入的地图数据缺 grid/markers/regions/fog 时自动补全；关系网节点坐标缺失其一（只有 x 没有 y）时不再崩溃',
      '修复：关系网节点名标签无法双击改名——标签原先不接收鼠标事件，现在可直接双击节点名改名',
      '修复：地图上单击标记即触发一次落盘、拖拽视图也落盘——现在只有真正改动过位置或迷雾才保存，不再产生无意义的保存与审计记录；双击改名时的像素抖动也不再挪动标记',
      '修复：地图「涂抹迷雾」会覆盖最后一块已有迷雾（地图原本没有迷雾时，这一笔还会凭空丢失）——现每笔起笔新建一块迷雾，并做采样去抖',
      '修复：内部审计记录取日志名称用了错误字段（title / name 不一致），导致日志类操作的审计名称为空'
    ] },
    { version: '2.4.3', date: '2026-09-09', type: '测试版', items: [
      '批次B：关系网深化——节点查找过滤（按名称/类型/描述实时筛选，未匹配节点与连线自动淡出）、视图工具（放大/缩小/适应屏幕/居中视图）、连线类型着色（盟友/敌对/从属/未知四色区分）与样式定制、布局位置持久化（整理后再次进入保持不变）',
      '批次B：地图深化——标记弹窗编辑（点击/双击修改名称、类型、备注）、新增椭圆区域/椭圆迷雾绘制工具（按住拖拽即成形，可单独删改）、网格测量辅助（点两点即显示直线距离与格数换算）、地图导出为 PNG 图片（含底图/网格/标记/迷雾全部图层）',
      '批次C：AI 自动产出——「剧情要点」一键从近期对话与日志提炼值得长期记住的要点，编辑确认后写入长期记忆（每次对话自动注入，保持跨会话连贯）',
      '批次C：AI 自动产出——「剧情建议」分析近期会话/日志，生成 NPC 与剧情点建议，预览逐条勾选确认后才写入工作台，已有同名条目自动跳过',
      '批次C：会话记忆压缩——对话累计满 30 条且持续增长时，自动出现提示条提醒把要点沉淀进长期记忆（可一键总结，也可忽略，不会反复打扰）'
    ] },
    { version: '2.4.2', date: '2026-09-09', type: '正式版', items: [
      '批次A：数据自动版本快照——每次变更自动沉淀一份快照，可一键回滚（仅保留最近 40 份），数据有后悔药',
      '批次A：损坏数据自动自愈——读档失败时自动回退到最近一份完好备份/快照，档案不再因一次写入异常而报废',
      '批次A：删除误触保护——资料/档案/地图/关系网删除均二次确认，关系网另有一键撤销，手滑也能救回',
      '批次A：全局快捷键——Ctrl+K 命令面板 / Ctrl+Shift+F 全局搜索 / Ctrl+N 新建卡片 / Ctrl+D 骰娘 / Esc 关闭浮层',
      '批次A：全局快速搜索——跨人物/NPC/背景/日志/怪物/规则/关系网/地图/原始文本/团内记忆全文检索并一键跳转'
    ] },
    { version: '2.4.1', date: '2026-09-09', type: '正式版', items: [
      '修复：关系网一键整理后孤立节点互相遮挡——孤立点自动移至外围散开，不再糊成一团',
      '新增：地图支持无 AI 手动布置——占位底图、手动框选区域、格距设置，不连 AI 也能搭起地图',
      '优化：AI 设计地图打开即自动取用已导入团本/原始文本，修复“导入后生成按钮不好使”',
      '统一：“战役”一律改称“团”，口径一致'
    ] },
    { version: '2.4.0', date: '2026-09-09', type: '正式版', items: [
      '新增：地图功能（对照枭雄风格）——Canvas 画板：上传底图、网格、标记、迷雾，支持缩放平移',
      '新增：AI 依文字描述生成地图草案——网格/标记/区域/迷雾一键生成，预览确认后可应用'
    ] },
    { version: '2.3.0', date: '2026-09-08', type: '正式版', items: [
      '新增：原始文本界面（侧栏「资料 → 原始文本」）——导入任意文本类文件后自动去除无效乱码、保留原文结构与段落，得到纯净可读文本；支持粘贴、多格式导入、导出 txt',
      '新增：原始文本「AI 建议」——一键调用 AI，在原始文本的关键句子后用不同颜色的括号【（建议）】内联插入带团建议/方案（节奏把控、NPC 扮演、遭遇数值微调、线索埋设、分叉应对等），不改动原文本身',
      '优化：区分人物卡与 NPC——人物卡(PC)为玩家扮演的角色，AI「拆分登记 / 剧本分析」时自动排除 PC，只识别 NPC 及其他剧情实体，团本分析不再混入玩家人物卡',
      '优化：数据「导入/导出」改为资料 + AI 内容打包——导出生成的 JSON 含全部 7 类资料、字段、关系网、AI 角色卡、卡片模板、长期记忆、AI 提示词及原始文本与其 AI 建议；不含主题/布局/AI 连接密钥等“设定”，换机交接更安全干净'
    ] },
    { version: '2.2.3', date: '2026-09-08', type: '正式版', items: [
      '修复：卡片拖动与文件拖入冲突——拖动看板卡片排序时会误弹“松开以导入文件”浮层导致排序失效。现已区分应用内部拖动与外部文件拖入：仅当拖入系统文件时才弹导入浮层，看板/卡片拖动不受干扰、排序恢复正常',
      '修复：骰娘界面首次进入点击无效——投掷/规则切换/检定按钮改为每次渲染后直接绑定事件，彻底消除“第一次进页面点不动、切换规则后才正常”的问题；自定义投掷输入框也支持回车即掷'
    ] },
    { version: '2.2.2', date: '2026-09-08', type: '正式版', items: [
      '优化：关系网一键整理大幅改版——按“连通分组”聚簇排布：有连线关系的节点自动归为同一子图，大组居中、其余小组环形环绕，组内力导向微调 + 组中心锚定，节点连线不再糊成一团，一眼看清各势力/各场景的关系块',
      '优化：记录/资料卡片页排版——卡片网格高度对齐、字段行行距与自动换行更规整，长文本字段区块化呈现更易读，标题、标签、操作区层级更清楚',
      '优化：设置页排版——各设置卡片间距统一、字段行对齐整齐（标签固定列宽），设置页标签（Tabs）悬浮吸顶便于快速切换，段落说明更清晰'
    ] },
    { version: '2.2.1', date: '2026-09-08', type: '正式版', items: [
      '新增：全部资料卡片界面均可结合侧栏对话获取信息——人物/NPC/地区/日志/怪物等卡片页工具栏新增「⚡ AI 生成（结合对话）」，AI 依据侧栏对话上下文/待处理内容生成或提取对应类型资料卡，摆脱“脱离上下文随机生成”',
      '新增：关系网一键整理——工具栏「⟳ 一键整理」自动重排所有节点连线让关系清晰；同时新增「☰ 关系清单」，将全部连线以易读文本列表呈现（节点 → 关系 → 节点），点击即可定位/高亮该连线，彻底告别“连上线后看不清关系内容”',
      '新增：导入 AI 生成的卡片可选模板——导入预览面板新增「卡片模板」下拉框，导入的人物/NPC/怪物卡可按所选规则书模板（CoC/DnD 等）显示对应字段集，AI 内容导入更贴合规则书',
      '重构：剧本解析并入侧栏——删除独立的「剧本解析」页面，全部融入侧栏 AI 对话抽屉（「✎剧本」按钮展开/收起），粘贴剧本 + 一键「⇄解析剧本」多卡拆解流程保留不变，界面更集中、操作更顺手'
    ] },
    { version: '2.2.0', date: '2026-09-08', type: '正式版', items: [
      '新增：卡片模板系统——内置两套规则书模板「CoC 7th 调查员」（克苏鲁的呼唤：力量/体质/敏捷/耐久/理智 SAN/魔法值 MP/幸运等）与「DnD 5e 冒险者」（龙与地下城：力量/敏捷/体质/智力/感知/魅力 + HP/AC/熟练加值/先攻/速度）。同一张卡挂不同模板即按对应规则书显示不同的字段集（如力量、理智等），彻底与全局字段解耦',
      '新增：使用规则时自主选用模板——人物/NPC/怪物卡片的新增与编辑弹窗内可下拉切换卡片模板，字段表单即时按模板重绘，保存后模板随卡片记录并显示在卡片左上角徽标',
      '新增：可把当前字段集「另存为模板」——在设置 → 字段编辑器里，点「另存为模板」即可将当前字段集保存为一个新的可选模板，之后新建/编辑或 AI 生成时都可直接选用',
      '新增：AI 依据规则书生成模板——导入规则书/设定资料后，在设置 → 字段里点「⚡ AI 依据规则书生成模板」，AI 归纳出适配该规则的人物卡字段集并自动加入模板库',
      '新增：AI 生成可多卡提取勾选——「⚡ AI 生成」会结合对话/待处理内容识别其中所有独立条目一次性全部提取（上下文提到多个实体则一不落），弹预览面板逐张勾选（默认全选）确认后才写入，避免遗漏，也防止误入不需要的卡片',
      '优化：AI 生成支持选择模板——各卡片资料页工具栏可选生成所用的模板，AI 即按该模板字段结构化生成'
    ] },
    { version: '2.1.2', date: '2026-09-08', type: '正式版', items: [
      '关键：数据目录与安装/解压位置解耦——数据集中保存到系统用户目录（%APPDATA%/KP跑团工作台），此后替换整个软件文件夹或覆盖升级，都不会丢失任何内容，彻底告别“换包就要重填内容”',
      '新增：首次启动自动迁移——若系统用户目录尚无数据，会自动接管旧安装目录里的 data 文件夹；设置 → 数据页新增「从旧版数据文件夹迁移…」一键按钮，把旧版 data 一键并入新位置',
      '优化：设置 → 数据页新增「数据位置与升级」区块，显示当前数据目录与运行模式（安装版/绿色版），并给出明确的升级说明',
      '说明：应用内“自动更新检查”已就绪（需配置更新源并生成 latest.yml）；无更新服务器时，把新版文件夹或安装包覆盖到旧版位置即可，数据位置不变、零损失升级',
      '备注：NSIS 一键安装包装配已完成（package.json 已含 nsis 配置），因当前构建机不含可运行的 32 位 wine，暂未产出安装器 exe；不影响数据安全——数据已集中到用户目录，替换文件夹与安装包等效'
    ] },
    { version: '2.1.1', date: '2026-09-08', type: '正式版', items: [
      '修复：AI 对话输出不完整——普通对话单次输出 token 上限由 2000 提至 4000，并在输出达到上限被截断时自动“续写”拼回，长文不再拦腰截断',
      '修复：剧本解析过程记录丢失——粘贴/导入的剧本、解析状态与已完成预览结果都会保留，解析中途切页再回来仍能看到过程与结果，不必重复解析',
      '删除：去重合并功能——移除侧栏入口与相关代码（同名检测/合并/撤销/删除），保留独立的「AI 数据检查」',
      '优化：统计报表迁移到主页「总览」看板——资料规模、投骰概况、最近操作直接展示在首页，不再占用独立页面，可在“自定义看板面板”中隐藏',
      '修复：AI 自动建卡「未返回 JSON」——JSON 化请求声明 response_format(json_object) 并兼容不支持的上游，改用容错解析（容忍代码块/尾逗号/说明文字），失败重试时附正确格式化提示，并按输出量自动放大 token 上限（三段降级：高上限+response_format → 去掉字段 → 保守上限），大剧本 JSON 不再被截断',
      '修复：AI 建卡凭空随机造卡——「按类型生成」「⚡ AI 生成」现在会结合上方对话/待处理内容提取信息来建卡，而非脱离上下文随机生成',
      '新增：侧栏 AI 对话抽屉增加「按对话建卡」与「建资料卡」入口，可直接在侧栏结合对话生成或把最近 AI 回复拆解为资料卡',
      '新增：AI 设定的人设改为「开启」开关——开启才套用该人设与使用者对话，同一时间仅一个生效，互斥明确',
      '新增：剧本解析支持一键「导入剧本文件」——读取 txt/md/docx/pdf/xlsx 等文本类文件并填入解析框',
      '优化：内容安全过滤规则迁至「设置 → AI 提示词」统一管理，修复开关/添加/删除按钮失效问题，主控开关 + 逐条规则同页编辑',
      '修复：PDF 导入/上传中文乱码——改用官方 pdfjs 解析引擎抽取正文（正确还原字体编码/ToUnicode，兼容各类中文 PDF），旧浅抽取仅作兜底',
      '修复：文件上传仍被 3MB 拦截——统一「AI 上传选取」与「大文件导入」的上限，均提升到 1GB（满足至少 500MB 大文件），并对 PDF/Word/Excel 等做格式感知抽取而非按纯文本读取'
    ] },
    { version: '2.1.0', date: '2026-09-08', type: '正式版', items: [
      '新增：内容过滤规则可在「AI 配置」编辑——内置 11 条高危拦截规则（未成年人、自残、毒品、提示词注入等）可逐条开关、修改正则与提示文案、删除，也可新增自定义规则，保存即生效',
      '新增：导出格式拓展为 8 种——Markdown、Word、PDF、Excel、CSV、纯文本、JSON、HTML，Word/PDF/Excel 适合直接交付与打印',
      '优化：AI 输入框自适应高度——随内容伸缩、封顶出滚动条，位置与间距重排；发送后自动复位',
      '新增：AI 关系网补全支持「修正/删除」——AI 不只新增连线，还能修正、删除关系，且先弹确认预览面板逐条勾选后才写入（防误改误删）',
      '加固：AI 稳健性——文本审核覆盖对话输入与 AI 产出；超长输入护栏截断、回复设 2.4 万字上限；关系推断姓名走白名单并去重封顶，杜绝 AI 凭空乱改、胡思乱想'
    ] },
    { version: '2.0.0', date: '2026-09-07', type: '正式版', items: [
      '里程碑：功能齐备的 2.0 正式版——整合此前全部能力，本次为完成度与体验提升'
    ] },
    { version: '1.11.0.1', date: '2026-09-07', type: '测试版', items: [
      '新增：Ctrl+K 命令面板——输入随时呼出，可跳转任意页面、直达已有资料条目，或一键发起全局搜索',
      '新增：侧栏可折叠为图标态——窄窗 / 投屏时解放内容空间，折叠状态自动记忆',
      '新增：批量导出——每个资料页新增「↧ 导出」，一键导出当前类型全部资料为 Markdown 文件',
      '新增：合并撤销——去重合并后可在工具栏点「撤销上次合并」恢复原状',
      '新增：自动备份间隔可设置——在「设置 → 数据」可调整自动备份频率（1~1440 分钟，默认 30），保存即时生效',
      '新增：AI 拆分登记加固——主进程对拆分结果做结构校验与最多 2 次自动重试，避免空结果/坏 JSON 直接失败',
      '新增：新手引导——首次打开提示推荐的上手主流程（导入文档 → AI 拆分登记 → 建档 → 创作），可关闭',
      '新增：主题皮肤「暮光护眼」——低蓝光柔和暖暗配色，适合夜间长时间使用'
    ] },
    { version: '1.11.0', date: '2026-09-07', items: [
      '优化：整体界面排版与防溢出——修复长文本/长卡片名把网格与卡片撑破的问题，所有主题下都不再超出框',
      '优化：弹窗、工具栏、卡片操作区在窄窗下自动换行收窄，所有输入框与按钮都能完整显示和点击',
      '美化：更舒展的卡片留白、标题字距、卡片操作区底部对齐、统一精致的空状态占位'
    ] },
    { version: '1.10.0', date: '2026-09-07', items: [
      '新增：批量导入多个文件——一次可选多个文件，逐个抽取解析并列出每个文件的类型/字数/状态，可统一「仅导入」或「AI 拆分登记」',
      '新增：AI 拆分登记——连接 AI 后可从导入内容一键拆分为 7 类资料卡（人物 PC / NPC / 地区 / 日志 / 怪物 / 规则 / 背景），先预览勾选确认再写入',
      '新增：AI 提示词可在设置页「AI 提示词」板块编辑（拆分登记 / 大文件整理 / 清单生成三个模板，带恢复默认）',
      '约束：默认「严禁增编」——AI 只依据导入文本实际信息分类填卡，缺失字段留空、绝不编造；勾选「允许 AI 补充创作」并经确认后才允许合理补写'
    ] },
    { version: '1.9.0', date: '2026-09-07', items: [
      '新增：文件导入功能大幅增强——支持多格式导入（txt/md/log/json/csv/Excel/pdf/docx/html/日志等），自动抽取正文并整理',
      '新增：单文件上限提升到 1GB（约 1000MB，满足至少 500MB 大文件导入），大文件由主进程流式读取、原样存盘 + 展示预览，不再卡死界面',
      '新增：大文件可分块 AI 分析整理——超过 8 千字自动分帧交给 AI 逐段汇总为结构化整理文本，写入资料卡并保留原文件引用',
      '工程：内置零依赖 PDF 文本抽取（支持压缩流）与 DOCX 解析（mammoth），Excel/CSV 表格转正文导入'
    ] },
    { version: '1.8.1', date: '2026-09-07', items: [
      '修复：骰娘界面的 CoC / DnD 检定按钮失效与多次投掷后卡死——根因为事件函数与规则引擎同名导致无限递归，已彻底分离（按钮改调 cocJudgeBtn / dndJudgeBtn，引擎函数独立）',
      '修复：DnD 检定默认无优势/劣势时结果恒为 NaN 必判失败——普通模式取骰逻辑修正，成功率恢复正常',
      '优化：骰娘界面任一规则下均保留「自定义投掷 + 投掷按钮」，并固定提供 d4/d6/d8/d10/d12/d20/d100 常见骰子，点击即掷，不再受规则库切换影响'
    ] },
    { version: '1.8.0', date: '2026-09-07', items: [
      '新增：骰娘鉴定工具——离线通用投掷（NdM±X）、CoC 7th 与 DnD 5e 规则库一键切换，含快捷骰、成功/大成功/大失败判定与投掷历史',
      '新增：AI 定向判定——接入 AI 后按任务与人物卡分析应采用的能力/目标值/DC，再由本地引擎针对性投骰并解释判定依据',
      '新增：支持导入人物卡 Excel（.xlsx/.xls/.csv），把表格当人物卡库，按关键字匹配角色做定向检定',
      '新增：统计报表——资料对象规模、投骰成功率/大成功/失败统计、按规则与高频投法汇总、最近操作记录',
      '新增：自动更新检查——在「更新公告」页一键检查更新（需配置更新源；绿色版暂以手动下载新版为主）',
      '工程：接入 electron-updater 依赖与签名/发布配置，为后续代码签名自动更新铺路'
    ] },
    { version: '1.7.0', date: '2026-09-07', items: [
      '新增：软件窗口改为无边框模式——顶栏可拖动移动窗口，双击最大化/还原，右上角自绘最小化 / 最大化 / 关闭按钮，四套主题下外观统一',
      '外观：软件图标焕新——从“残火纪”专属图标改为通用“跑团工作台”图标（金色 D20 骰子 + 地图卷轴 + 羽毛笔），exe / 任务栏 / 桌面图标同步更新',
      '分发：针对下载后“打开显示无法打开”问题，改用绿色版文件夹（解压即用、不做运行时自解压）+ 提供使用避坑说明，降低杀软误报与临时锁概率'
    ] },
    { version: '1.6.2', date: '2026-09-04', items: [
      '修复：左侧栏所有条目现在可以无限滚动到底——侧栏增加纵向滚动支持，条目再多也能用滚轮/拖拽滑动条到达底部，底部按钮不再被挤出屏幕',
      '外观：整体视觉打磨（顶栏精致化、按钮呼吸光与渐变、卡片悬停上浮、弹窗展开动画、表单聚焦光环、聊天气泡柔和、更精致的滚动条）'
    ] },
    { version: '1.6.1', date: '2026-09-04', items: [
      '加固：新增运行时输入守卫，无论 CSS、覆盖层、user-select 或历史环境如何，所有输入框 / 文本域 / 下拉框都保证可点可写可聚焦；用捕获阶段强制复位 + MutationObserver 实时守护，彻底杜绝“打不了字”',
      '修复：排查确认 v1.6.0 打包产物可能未含输入修复，v1.6.1 基于确认可打字的源码重新构建交付'
    ] },
    { version: '1.6.0', date: '2026-09-04', items: [
      '修复：数据选择里不再出现名为“data”的幽灵档案（原主数据文件名被目录扫描误当成独立档案，选中即冲突卡死）——已彻底根除并加命名防御',
      '修复：归档名与数据目录（data）、主档案（main）冲突时会被阻止，避免误建导致数据错乱',
      '优化：设置页去掉与「AI 配置」重复的 AI 标签，AI 连接 / 行为开关 / 长期记忆统一在侧栏「AI 配置」一处管理，消除双入口并存冲突',
      '加固：输入框 / 文本域 / 下拉框始终可点选可输入，杜绝任何覆盖层或 user-select 导致的无法打字',
      '外观：侧栏加分组标题（资料 / AI 工具 / 工具）、当前项指示条与悬停微动效，按钮统一悬浮反馈，界面更清晰'
    ] },
    { version: '1.5.0', date: '2026-09-04', items: [
      '修复：长期记忆添加无效（原 window.prompt 在桌面端不可用，已改弹窗录入）',
      '新增：主页“开始使用”一步到位——总览顶部即可选择/新建档案（数据默认按“主题名”命名，首次建档/切换更直观）',
      '优化：设置页改为分类标签（外观 / 字段 / 数据 / AI / 关于），小项选择更清晰',
      '优化：AI 行为开关与长期记忆整合进设置，开关即时生效并即时保存',
      '导出：AI 内容导出改为导出本次对话全文（含 AI 整理的背景、规则、设定），可保存为 .txt',
      '侧栏：保留并强化 AI 助手 / AI 对话入口，上传与导出能力可在设置中开启',
      '优化：多档案名支持中文/主题名，仅清洗非法文件名字符'
    ] },
    { version: '1.4.0', date: '2026-09-04', items: [
      '新增：AI 行为开关——可分别控制「启用当前人设 / 自动引入背景规则 / 允许文件上传工具 / 长期记忆」',
      '新增：长期记忆——在「AI 配置」里逐条记录要点，自动注入每次对话，保持跨对话连贯',
      '新增：AI 文件上传——支持把本地文字文件读取后（自动存到 data/uploads/）交给 AI 阅读整理',
      '新增：导出 txt——可直接把最近一条 AI 回复导出为 .txt 文本文件（暂不支持图片识别）',
      '新增：关于与免责声明——注明制作人零弈秋、Bug 反馈 QQ 247910428 与使用免责声明'
    ] },
    { version: '1.3.0', date: '2026-09-04', items: [
      '新增：规则 / 背景两类资料，支持从 .md/.txt 或粘贴导入，AI 一键整合结构化',
      '新增：数据多开——可新建、切换、复制、删除多个档案（团/世界）',
      '新增：备份与恢复——手动/自动备份，从备份快照一键还原',
      '新增：AI 数据审查——一键检查重复、冲突、缺失与异常，并给出修改建议',
      '新增：跨实体去重/合并——同名检测、智能合并、导入时自动跳过重复',
      '优化：界面布局统一（页面头部/工具栏/间距/卡片），整体更整齐'
    ] },
    { version: '1.2.0', date: '2026-09-04', items: [
      '新增：AI 按类型生成——选 NPC/人物卡/地区/日志/怪物一键生成，导入时可选指定类型落地',
      '新增：全局搜索——侧栏跨实体全文搜索，按类型筛滤并一键跳转',
      '新增：导出扩展——记录润色与日志战报支持导出 Markdown，一键生成跑团战报',
      '安全：API Key 改用系统级加密存储，落盘无明文；配置页可临时回显密钥'
    ] },
    { version: '1.1.1', date: '2026-09-04', items: [
      '修复：AI 配置 / 记录润色 / 主题名 / 建资料卡等新增按钮点击无响应（方法未挂载导致的失效）',
      '修复：AI 连通测试不再强制要求先配置“AI 设定”角色卡，全局配置就绪即可测试'
    ] },
    { version: '1.1.0', date: '2026-09-04', items: [
      '修复：创建人物/地点时名字填写后不被采用（隐藏字段覆盖导致的 bug）',
      '新增：AI 连接配置独立一栏，全局统一管理接口地址 / 密钥 / 模型',
      '新增：工作台主题名可自定义（不再写死“残火纪”）',
      '新增：更新公告页，记录每一次改动的版本与内容',
      '新增：记录润色——粘贴跑团记录，AI 补全背景润色并导出为 .txt 小文章',
      '新增：AI 助手生成的内容可直接“建为工作台资料卡”，确认后写入',
      '优化：总览看板拖拽排序手感与视觉反馈',
      '兼容：旧版角色卡上的连接信息仍可继续使用'
    ] },
    { version: '1.0.0', date: '2026-09-03', items: [
      '搭建 KP 跑团工作台：人物卡 / NPC / 地区 / 日志 / 怪物五类资料管理',
      'AI 人设（人设 / 话风 / 设定）与侧栏常驻对话',
      '剧本粘贴后 AI 自动解析成结构化资料',
      '主题换肤、自定义字段、单文件夹数据持久化'
    ] }
  ];

  let S = {
    data: null, fields: null, settings: {}, profiles: [], activeProfile: null,
    view: 'dash', editing: null, scriptPreview: null, aiBusy: false,
    globalQuery: '', gType: 'all', aiGenType: 'npc', meta: null, dedup: null, importRaw: null,
    rawText: '', rawSuggested: '', rawScript: null, rawShow: 'text', pendFiles: [],
    dv: { kind: null, sort: 'none', src: 'all' }
  };

  /* ---------- 工具 ---------- */
  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    q('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  /* AI 错误降级：把底层错误映射成可读原因（附「去配置」直达）。eiAIErr(e) 返回 {msg, config:boolean} */
  function eiAIErr(e) {
    const s = String((e && e.message) || e || '');
    /* 上一项 AI 还没跑完就又被点了一次：不是故障，把原因原样讲清楚即可 */
    if (/AI_BUSY/.test(s)) return { msg: s.replace(/^AI_BUSY\s*/, ''), cfg: false };
    if (/未配置完整|缺.*(baseUrl|apiKey|model)|baseUrl.*apiKey/i.test(s)) return { msg: 'AI 尚未配置完整（需 baseUrl / API Key / model）。请先在「AI 配置」中填写并保存。', cfg: true };
    if (/401|403|unauthor|invalid.*key|api.?key|auth/i.test(s)) return { msg: 'API Key 无效或无权限（' + (s.slice(0, 120) || '401/403') + '）。请到「AI 配置」核对密钥。', cfg: true };
    if (/429|rate.?limit|频率|限流/i.test(s)) return { msg: '触发限流（429）或请求量超限。请稍后重试，或检查模型配额。', cfg: true };
    if (/超时|timeout|timedout/i.test(s)) return { msg: 'AI 请求超时。请检查网络，或在「AI 配置」中调大超时时长后重试。', cfg: true };
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|网络|连接|发送失败/i.test(s)) return { msg: '无法连接 AI 服务（可能 baseUrl 填写有误或网络不通）：「AI 配置」里核对接口地址。', cfg: true };
    if (/404|not.*found|model.*not|不存在/i.test(s)) return { msg: '模型不存在或接口路径错误（' + (s.slice(0, 120) || '404') + '）。请在「AI 配置」核对 model 名称与 baseUrl。', cfg: true };
    if (!s) return { msg: 'AI 请求失败（未知原因）。请检查「AI 配置」后重试。', cfg: true };
    return { msg: s.length > 300 ? s.slice(0, 300) + '…' : s, cfg: /AI|上游|配置/i.test(s) };
  }

  /* ================= 全局「AI 处理中」提示 =================
   * 每项 AI 请求在 preload 层已被守卫，这里只负责界面表现：
   * 请求一开始就亮起提示条（显示当前在做什么 + 已用秒数）并禁用刚点下的那个按钮，
   * 结束自动熄灭。任何界面（资料卡 / 地图 / 关系网 / 骰娘 / 剧本 / 侧栏对话…）调 AI 都有统一提示，
   * 连点同一个按钮也不会再发出一次无用请求（重复的 AI 调用会被直接拦下并说明原因）。 */
  let _aiT0 = 0, _aiTimer = null, _aiLabel = '', _aiBtn = null;
  let _aiLastClickBtn = null, _aiLastClickAt = 0;
  let _aiGroups = []; // 当前在飞的 AI 任务组（供取消）
  /* 记住「刚点下的按钮」：AI 开始时把它禁用即可挡住连点（限 900ms 内，避免误伤别处） */
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (b && b.id !== 'aiBusyCancel') { _aiLastClickBtn = b; _aiLastClickAt = Date.now(); }
  }, true);
  function aiBusyPaint() {
    const el = q('aiBusy'); if (!el) return;
    const txt = q('aiBusyText');
    if (txt) txt.textContent = _aiLabel + ' · 已用 ' + Math.max(0, Math.round((Date.now() - _aiT0) / 1000)) + ' 秒';
  }
  function aiBusySet(s) {
    if (!s) return;
    const el = q('aiBusy');
    if (s.on) {
      _aiLabel = s.label || 'AI 处理中';
      _aiGroups = Array.isArray(s.groups) ? s.groups.concat() : (_aiGroups.length ? _aiGroups : []);
      if (!_aiTimer) { _aiT0 = Date.now(); _aiTimer = setInterval(aiBusyPaint, 1000); }
      if (el) el.hidden = false;
      aiBusyPaint();
      if (!_aiBtn && _aiLastClickBtn && (Date.now() - _aiLastClickAt) < 900 && _aiLastClickBtn.tagName === 'BUTTON') {
        _aiBtn = _aiLastClickBtn; _aiBtn.disabled = true; _aiBtn.classList.add('ai-running');
      }
      const cb = q('aiBusyCancel'); if (cb) cb.hidden = false;
    } else {
      if (_aiTimer) { clearInterval(_aiTimer); _aiTimer = null; }
      _aiGroups = [];
      if (_aiBtn) { try { _aiBtn.disabled = false; _aiBtn.classList.remove('ai-running'); } catch (_) {} _aiBtn = null; }
      if (el) el.hidden = true;
      const cb = q('aiBusyCancel'); if (cb) cb.hidden = true;
    }
  }
  /* 大文件 AI 分析整理进度：主进程按 digest/merge 阶段广播，这里渲染一个浮动进度条 */
  let _importProgEl = null;
  function importProgressSet(p) {
    if (!p) return;
    const create = () => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);width:min(440px,86vw);background:var(--panel-bg,#fff);border:1px solid var(--line,#dfe3ea);border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.22);z-index:9999;font-size:13px;color:var(--ink,#222)';
      d.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><span id="importProgText"></span><span id="importProgPct"></span></div><div style="height:6px;background:var(--line,#dfe3ea);border-radius:3px;overflow:hidden"><div id="importProgBar" style="height:100%;width:0;background:#4f7cff;transition:width .25s"></div></div>';
      return d;
    };
    if (!_importProgEl || !document.body.contains(_importProgEl)) { _importProgEl = create(); document.body.appendChild(_importProgEl); }
    const tx = _importProgEl.querySelector('#importProgText');
    const pct = _importProgEl.querySelector('#importProgPct');
    const bar = _importProgEl.querySelector('#importProgBar');
    if (tx) tx.textContent = p.text || (p.phase === 'merge' ? '合并提纲…' : '抽取段落提纲…');
    if (pct) pct.textContent = (p.percent != null ? p.percent + '%' : ((typeof p.done === 'number' && p.total) ? p.done + ' / ' + p.total : ''));
    if (bar) bar.style.width = (typeof p.percent === 'number' ? p.percent : 0) + '%';
    if (p.phase === 'done' || p.phase === 'error') {
      setTimeout(() => { if (_importProgEl && document.body.contains(_importProgEl)) { _importProgEl.remove(); _importProgEl = null; } }, p.phase === 'error' ? 2500 : 900);
    }
  }
  /* 取消当前在飞的 AI 任务：有明确组就按组取消，否则取消全部；取消完成后由 preload 广播提示 */
  async function aiCancelCurrent() {
    if (!_aiGroups.length) return;
    if (!(await appConfirm('取消 AI 任务', '确定要中止当前的 AI 任务吗？已消耗的部分 token 不会退回，进度可能不完整。'))) return;
    const g = window.api && window.api.aiCancel ? window.api.aiCancel(_aiGroups.length === 1 ? _aiGroups[0] : null) : null;
    toast('已发送取消指令，正在中止…');
  }

  /* ============== AI 用量面板（T28）==============
   * 展示本轮统计（调用次数 / 耗时 / token）与逐条明细，可重置统计时段并清空日志。 */
  function fmtClock(ms) { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return (h ? h + '时' : '') + (h || m ? m + '分' : '') + ss + '秒'; }
  function fmtClockAt(at) { try { const d = new Date(at); const p = n => String(n).padStart(2, '0'); return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); } catch (_) { return '—'; } }
  async function aiOpenUsagePanel() {
    let data = null;
    try { data = (window.api && window.api.aiUsage) ? await window.api.aiUsage() : null; } catch (_) { data = null; }
    const w = (S.settings && S.settings.aiUsageWindow) || 3600e3;
    const mask = q('modalMask'); const box = q('modalBox');
    let listRows;
    const entries = (data && data.entries) ? data.entries.concat().reverse() : [];
    if (!entries.length) listRows = '<div class="empty">本轮尚无 AI 调用。去跑一次资料生成 / 地图 / 对话等即可在此看到用量。</div>';
    else {
      listRows = entries.map(it => {
        const status = it.cancelled ? '<span style="color:var(--warn)">已取消</span>' : (it.error ? '<span style="color:var(--danger)">失败' + (it.status ? ' ' + it.status : '') + '</span>' : '<span style="color:var(--ok);opacity:.85">成功</span>');
        const toks = (typeof it.totalTokens === 'number') ? fmtNum(it.promptTokens || 0) + '/' + fmtNum(it.completionTokens || 0) + '/' + fmtNum(it.totalTokens) : '<span class="hint">—</span>';
        return `<tr><td style="white-space:nowrap;padding:5px 8px">${fmtClockAt(it.at)}</td><td style="padding:5px 8px">${esc(it.label || 'AI')}</td><td style="white-space:nowrap;padding:5px 8px">${fmtClock(it.ms || 0)}</td><td style="white-space:nowrap;padding:5px 8px">${toks}</td><td style="white-space:nowrap;padding:5px 8px">${status}</td></tr>`;
      }).join('');
    }
    box.innerHTML = `<h3>🧮 AI 用量</h3>
      <div class="note">记录每次 AI 请求的耗时与 token 用量，让成本可见。统计时段可切换，切换即重新计。</div>
      <div class="toolbar" style="flex-wrap:wrap;margin:10px 0">
        <span class="hint">统计时段：</span>
        <button class="${w === 600e3 ? '' : 'ghost'}" onclick="WB.aiUsageSetWindow(600000)">近 10 分钟</button>
        <button class="${w === 3600e3 ? '' : 'ghost'}" onclick="WB.aiUsageSetWindow(3600000)">近 1 小时</button>
        <button class="${w === 86400e3 ? '' : 'ghost'}" onclick="WB.aiUsageSetWindow(86400000)">近 1 天</button>
        <button class="${w === 0 ? '' : 'ghost'}" onclick="WB.aiUsageSetWindow(0)">全部</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div class="usage-chip"><b>${fmtNum(data ? data.calls : 0)}</b> 次调用</div>
        <div class="usage-chip"><b>${fmtNum(data ? data.totalTokens : 0)}</b> token <span class="hint">(入 ${fmtNum(data ? data.promptTokens : 0)} / 出 ${fmtNum(data ? data.completionTokens : 0)})</span></div>
        <div class="usage-chip"><b>${fmtClock(data ? data.msSum : 0)}</b> 总耗时</div>
      </div>
      <div class="hint" style="margin-bottom:6px">最近明细（时间倒序，最多 500 条）：</div>
      <div style="max-height:44vh;overflow:auto;border:1px solid var(--line);border-radius:10px">
        <table class="tbl" style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:5px 8px">时间</th><th style="text-align:left;padding:5px 8px">任务</th><th style="text-align:left;padding:5px 8px">耗时</th><th style="text-align:left;padding:5px 8px">token(入/出/总)</th><th style="text-align:left;padding:5px 8px">状态</th></tr></thead><tbody>${listRows}</tbody></table>
      </div>
      <div class="foot">
        <button class="ghost" onclick="WB.closeModal()">关闭</button>
        <span class="grow"></span>
        <button class="danger" onclick="WB.aiUsageResetPanel()">清空本轮统计</button>
      </div>`;
    mask.hidden = false;
  }
  async function aiUsageSetWindow(ms) { (S.settings.aiUsageWindow = ms); try { if (window.api && window.api.aiUsageReset) await window.api.aiUsageReset(ms === 0 ? 86400e6 : ms); } catch (_) {} persist(); toast('统计时段已切换'); aiOpenUsagePanel(); }
  async function aiUsageResetPanel() { try { if (window.api && window.api.aiUsageReset) await window.api.aiUsageReset(0); } catch (_) {} toast('已清零本轮统计'); aiOpenUsagePanel(); }
  function aiErrText(e) { return eiAIErr(e).msg; }
  function val(rid) { const e = q(rid); return e ? e.value : ''; }
  function fmtBytes(b) { const n = Number(b) || 0; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; }
  function fmtNum(n) { return (Number(n) || 0).toLocaleString('zh-CN'); }
  function tagsToArr(s) { return String(s || '').split(/[,，;；]/).map(x => x.trim()).filter(Boolean); }
  /* ---- 常用资料收藏（置顶优先） ----设置储存在 S.settings.favs：{ kind: [id,...] }，随数据持久化 */
  function favIds(kind) {
    if (!S.settings) S.settings = {};
    if (!S.settings.favs) S.settings.favs = {};
    if (!Array.isArray(S.settings.favs[kind])) S.settings.favs[kind] = [];
    return S.settings.favs[kind];
  }
  function isFav(kind, id) { return favIds(kind).indexOf(id) !== -1; }
  function toggleFav(kind, id) {
    const a = favIds(kind);
    const i = a.indexOf(id);
    if (i >= 0) a.splice(i, 1); else a.push(id);
    persist(); pushAudit('fav', kind, isFav(kind, id) ? '加入收藏' : '取消收藏');
    switchView(kind);
  }
  function favCount() { let c = 0; for (const k of KINDS) c += favIds(k).length; return c; }
  /* ---- 卡片模板工具：模板(id)挂到卡片 item.tpl，决定该卡显示的字段集 ----
   * 模板库来自 S.settings.templates（内置 coc/dnd + 用户自定义）。未挂模板或模板未定义某类别时回落全局字段。 */
  function tplList() {
    const base = [{ id: '', name: '基础（当前字段）', note: '使用「设置 → 字段」里的全局字段' }];
    const arr = (S.settings && Array.isArray(S.settings.templates)) ? S.settings.templates : [];
    return base.concat(arr);
  }
  function tplFor(id) {
    if (!id) return null;
    const arr = (S.settings && Array.isArray(S.settings.templates)) ? S.settings.templates : [];
    return arr.find(t => t && t.id === id) || null;
  }
  function tplName(id) { const t = tplFor(id); return t ? (t.name || id) : ''; }
  function schemaFor(kind, item) {
    const t = tplFor(item && item.tpl);
    if (t && t.fields && t.fields[kind] && t.fields[kind].length) return t.fields[kind];
    return S.fields[kind] || [];
  }
  function normFields(kind, item) {
    // 只取该实体 schema 中存在的字段（含模板/自定义）
    const schema = schemaFor(kind, item);
    const keys = new Set(schema.map(f => f.k).concat(['id', 'source', 'at', 'tpl']));
    const o = { id: item.id || uid() };
    if (item.source) o.source = item.source;
    if (item.tpl) o.tpl = item.tpl;
    for (const k of keys) if (item[k] !== undefined && k !== 'id' && k !== 'tpl') o[k] = item[k];
    return o;
  }
  function makeDoc() {
    return {
      version: 3,
      entities: S.data.entities,
      fields: S.fields,
      profiles: S.profiles,
      relations: S.data.relations || { nodes: [], edges: [] },
      settings: S.settings,
      audit: S.data.audit || [],
      rawText: S.rawText || '',
      rawSuggested: S.rawSuggested || '',
      rawScript: S.rawScript || null,
      /* 剧本开团进度（进度状态/伏笔兑现/现场备注）也算“AI 内容 + 工作成果”，随包带走 */
      scriptProg: (S.settings && S.settings.scriptProg) || null,
      maps: S.data.maps || []
    };
  }
  /* 持久化防抖：连续编辑不再每次都触发全量序列化（每张卡改一次就写一次磁盘）。
   * _xrefBump 立即执行（缓存即时失效，排序/勾选/收藏后立刻刷新），实际落盘合并为一次。
   * 返回 Promise，调用方可选择 await 或不等。
   * 差量传输：每次保存仅携带「哈希发生变化的实体分片 + 关系网 + 高频小字段」，
   * 未变动的实体类型不再整段序列化/传输，大档案在 IPC 与 JSON 序列化上显著省时。 */
  let _saveTimer = null, _saveResolve = null, _pendSave = false;
  /* 上个已送达校验和：实体按类型、关系网按整体。空档表示首次/换档案后需全量。 */
  const _lastSent = { ent: {}, rel: null };
  let wsListen = null; // 大列表窗口化增量加载的滚动回调引用，重复进出视图时先解绑再绑定
  function docHash(o) {
    // 轻量内容哈希（djb2），用于判断分片是否变化
    const s = JSON.stringify(o);
    let h = 5381;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); h &= 0x7fffffff; }
    return String(h);
  }
  function makeSavePayload() {
    const d = makeDoc();
    const relH = docHash(d.relations || {});
    const relChanged = relH !== _lastSent.rel;
    _lastSent.rel = relH;
    const entities = {};
    const kinds = ['pcs', 'npcs', 'regions', 'logs', 'mobs', 'rules', 'lore', 'encounters'];
    let anyEnt = false;
    for (const k of kinds) {
      const arr = d.entities[k] || [];
      const h = docHash(arr);
      if (h !== _lastSent.ent[k]) { entities[k] = arr; _lastSent.ent[k] = h; anyEnt = true; }
    }
    /* 补丁结构：实体整段对象可为 null（表示无变动）；其余小字段始终携带，保证不丢。
     * 主进程把「有值字段」合并进其持有的 doc 后再落盘（store 侧仍按分片哈希增量写）。 */
    const out = {
      __patch: true,
      version: d.version,
      entities: anyEnt ? entities : null,
      relations: relChanged ? d.relations : null,
      fields: d.fields, profiles: d.profiles, settings: d.settings, audit: d.audit,
      rawText: d.rawText, rawSuggested: d.rawSuggested, rawScript: d.rawScript, scriptProg: d.scriptProg,
      maps: d.maps
    };
    return out;
  }
  async function _doSave() {
    _saveTimer = null;
    if (!_pendSave) return;
    _pendSave = false;
    await window.api.save(makeSavePayload());
    if (_saveResolve) { const r = _saveResolve; _saveResolve = null; r(); }
  }
  function persist() {
    _xrefBump();
    _pendSave = true;
    return new Promise((resolve) => {
      _saveResolve = resolve;
      if (!_saveTimer) _saveTimer = setTimeout(_doSave, 300);
    });
  }
  function pushAudit(op, kind, name) {
    S.data.audit.unshift({ t: new Date().toISOString(), op, kind, name, at: '工作台' });
    S.data.audit = S.data.audit.slice(0, 400);
  }
  function contentInner(html) { q('content').innerHTML = html; }

  /* ========== 地图：数据工具 ========== */
  function mapsData() { if (!S.data.maps) S.data.maps = []; S.data.maps.forEach(ensureMapShape); return S.data.maps; }
  /* 地图结构补全：导入的旧版/外部数据可能缺 grid/markers/regions/fog，缺则补默认值，避免操作时抛错 */
  function ensureMapShape(m) {
    if (!m || typeof m !== 'object') return m;
    m.id = m.id || ('map-' + uid());
    m.name = m.name || '未命名地图';
    m.grid = (m.grid && typeof m.grid === 'object') ? m.grid : { on: true, size: 64 };
    if (typeof m.grid.on !== 'boolean') m.grid.on = true;
    if (!(Number(m.grid.size) > 0)) m.grid.size = 64;
    m.imgW = Number(m.imgW) > 0 ? Number(m.imgW) : 1280;
    m.imgH = Number(m.imgH) > 0 ? Number(m.imgH) : 800;
    m.markers = Array.isArray(m.markers) ? m.markers : [];
    m.regions = Array.isArray(m.regions) ? m.regions : [];
    m.fog = Array.isArray(m.fog) ? m.fog : [];
    return m;
  }
  const MAP_TYPES = [['mob', '怪物', '#e05d5d', '☠'], ['npc', 'NPC', '#e0803d', '🧙'], ['plot', '剧情点', '#a05dc2', '★'], ['exit', '入口/出口', '#3fa37f', '➤'], ['area', '区域块', '#c2a25d', '▤']];
  function mapTypeInfo(t) { return MAP_TYPES.find(x => x[0] === t) || MAP_TYPES[2]; }
  function mapFind(id) { return mapsData().find(m => m.id === id); }
  function mapPersist() { pushAudit('地图', 'edit', '地图画板'); persist(); }
  function mkMap(name) {
    return { id: 'map-' + uid(),
      name: name || '未命名地图', img: '', imgW: 1280, imgH: 800, imgKind: 'placeholder',
      grid: { on: true, size: 64 }, markers: [], regions: [], fog: [], note: '' };
  }
  /* 地图坐标夹取：单独命名(mClamp)避免与后端 ai.js 的 clamp01 语义混淆 */
  function mClamp1(n) { n = Number(n); if (!isFinite(n)) return 0; return Math.min(1, Math.max(0, n)); }
  /* 拖动/涂抹是否越过“误触阈值”：未越过视为单击或手抖，不改数据也不落盘 */
  function dragExceeded(x0, y0, x1, y1, tol) {
    const t = tol == null ? 3 : tol;
    return Math.abs(Number(x1) - Number(x0)) > t || Math.abs(Number(y1) - Number(y0)) > t;
  }

  /* 输入框自适应高度：随内容增长，封顶后出现滚动条，兼顾“大小”与“位置” */
  function autosize(el) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    const cap = 150;
    const h = Math.min(cap, Math.max(34, el.scrollHeight));
    el.style.height = h + 'px';
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
  }

  /* ---------- 顶栏 ---------- */
  function buildThemeSelect() {
    const sel = q('themeSelect');
    sel.innerHTML = THEMES.map(([k, l]) => `<option value="${k}" ${S.settings.theme === k ? 'selected' : ''}>${l} ${k}</option>`).join('');
  }
  function applyTheme(name, skipPersist) {
    if (!name) name = S.settings.theme || 'ember';
    document.documentElement.dataset.theme = name;
    S.settings.theme = name;
    pushDensityAttr((S.settings.layout && S.settings.layout.density) || 'comfortable');
    buildThemeSelect();
    if (!skipPersist && window.api) persist();
  }
  function updateTopProfile() {
    q('topProfile').textContent = S.activeProfile ? 'AI 人设 · ' + S.activeProfile.name : 'AI 人设 · 未配置';
    updateDrawerProfile();
  }

  /* ---------- 导航 ---------- */
  function switchView(view) {
    S.view = view;
    navPush(view);
    document.querySelectorAll('#sidebar .nav').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    // 自动展开当前视图所在的分组
    const activeNav = document.querySelector('#sidebar .nav[data-view="' + view + '"]');
    if (activeNav) { const grp = activeNav.closest('details.snav'); if (grp) grp.open = true; }
    if (view === 'dash') renderDash();
    else if (view === 'search') renderGlobalSearch();
    else if (S.data.entities[view]) renderDataView(view);
    else if (view === 'encounter') renderEncounter();
    else if (view === 'relations') renderRelations();
    else if (view === 'tags') renderTags();
    else if (view === 'rawtext') renderRawText();
    else if (view === 'ai') renderAI();
    else if (view === 'persona') renderPersona();
    else if (view === 'aiconf') renderAIConf();
    else if (view === 'polish') renderPolish();
    else if (view === 'help') renderHelp();
    else if (view === 'changelog') renderChangelog();
    else if (view === 'settings') renderSettings();
    else if (view === 'maps') renderMaps();
    else if (view === 'dice') renderDice();
    else if (view === 'dicehost') renderDiceHost();
    else if (view === 'dicework') renderDiceWork();
    else if (view === 'diceai') renderDiceAI();
    else if (view === 'diceaichat') renderDiceAIChat();
    else if (view === 'dicememe') renderDiceMeme();
    else if (view === 'stats') renderStats();
    else if (view === 'runlog') renderRunlog();
  }

  /* 根据可自定义的主题名刷新品牌区与窗口标题 */
  function applyAppName() {
    const name = (S.settings && S.settings.appName) || '残火纪';
    const sub = (S.settings && S.settings.appSub) || (name + ' · KP 团工作台');
    if (q('appLogo')) q('appLogo').textContent = (name.trim().charAt(0)) || '残';
    if (q('appSub')) q('appSub').textContent = sub;
    document.title = name + ' · KP 跑团工作台';
  }

  /* ========== 开团向导（总览顶部的一条龙引导） ========== */
  function wizardHTML() {
    const ai = S.settings.ai || {};
    const aiOk = !!(ai.baseUrl && ai.apiKey && ai.model);
    const entTotal = KINDS.reduce((n, k) => n + ((S.data.entities[k] || []).length), 0);
    const personaOk = !!S.activeProfile;
    const steps = [
      { no: 1, title: '建立档案', done: !!((S.meta && S.meta.archive)), tip: '在上方「开始使用」输入团名点「新建档案」，多套团互不干扰。', act: 'dash' },
      { no: 2, title: '配置 AI 接口', done: aiOk, tip: '填入 baseUrl / API Key / model 并保存，是 AI 拆登记与生成的前提。', act: 'aiconf' },
      { no: 3, title: '导入素材', done: entTotal > 0, tip: '在「规则 / 背景 / 原始文本」导入或粘贴剧本、设定笔记，也可直接粘贴。', act: 'rawtext' },
      { no: 4, title: 'AI 一键拆分', done: entTotal > 2, tip: '把长文本拆成 人物卡/NPC/地区/日志/怪物/规则/背景 7 类资料卡。', act: 'npcs' },
      { no: 5, title: '开始创作', done: personaOk, tip: '设定 AI 人设后，用「AI 助手 + 地图 + 骰娘」逐步开团。', act: 'persona' }
    ];
    const collapsed = S.settings.layout && S.settings.layout.wizardHidden;
    const stepHTML = steps.map((s, i) => {
      const state = s.done ? 'done' : (i === 0 ? 'cur' : '');
      const btn = s.done ? `<span class="wz-ok">✔</span>`
        : s.no === 1 ? `<span class="hint">看上方栏位 📌</span>`
        : `<button class="ghost small" onclick="WB.go('${s.act}')">去完成</button>`;
      return `<div class="wz-step ${state}"><div class="wz-dot">${s.done ? '✔' : s.no}</div>
        <div class="wz-body"><b>${s.no}. ${s.title}</b><div class="hint">${s.tip}</div></div>${btn}</div>`;
    }).join('');
    return `<div class="setcard wizard" style="margin-top:10px">
      <div class="wizard-head" onclick="WB.toggleWizard()" style="cursor:pointer;user-select:none">
        <b>🚀 开团向导</b><span class="hint"> · 按 5 步依次点亮，即可开起一团</span>
        <span class="grow"></span><span class="hint">${collapsed ? '展开 ▸' : '收起 ▾'}</span></div>
      <div id="wizardBody" class="wizard-body" ${collapsed ? 'style="display:none"' : ''}>${stepHTML}</div>
    </div>`;
  }
  function toggleWizard() {
    if (!S.settings.layout) S.settings.layout = {};
    S.settings.layout.wizardHidden = !S.settings.layout.wizardHidden;
    persist(); switchView('dash');
  }

  /* ========== 总览看板 ========== */
  function renderDash() {
    const order = (S.settings.layout && S.settings.layout.dashOrder) || [];
    const hidden = (S.settings.layout && Array.isArray(S.settings.layout.dashHidden)) ? S.settings.layout.dashHidden : [];
    const tiles = [
      ['pcs', '人物卡', '⛧'], ['npcs', 'NPC', '🧙'], ['regions', '地区', '⛰'],
      ['logs', '日志', '🕮'], ['mobs', '怪物', '☠'],
      ['ai', 'AI 助手', '✧'], ['persona', 'AI 设定', '♜']
    ];
    const get = (k) => tiles.find(t => t[0] === k);
    const ord = order.filter(k => get(k)).concat(tiles.filter(t => !order.includes(t[0])).map(t => t[0]));
    const shown = ord.filter(k => !hidden.includes(k));

    let html = `<div class="page-title"><h2>总览</h2><span class="hint">资料总计：${KINDS.map(k => `${DATA_TYPE[k]} ${(S.data.entities[k] || []).length}`).join(' · ')}　拖拽卡片可自由排序</span></div>`;
    html += dashTodayHTML();
    html += dashOverviewHTML();
    html += `<div class="homearch setcard"><div class="home-sh">
        <div><b style="font-size:15px">开始使用 · 选择或新建档案</b><div class="hint">数据按“主题名”开档，多套团可各自独立；开档是第一步</div></div>
        <span class="grow"></span>
        <button class="ghost" onclick="WB.go('settings')">管理档案</button>
      </div>
      <div id="homeArList" style="margin:6px 0 8px"></div>
      <div class="toolbar" style="margin:0">
        <input id="homeNewAr" placeholder="新档案名（留空则用当前主题名：${esc(S.settings.appName || '残火纪')}）" style="flex:1;min-width:140px">
        <button onclick="WB.createArchiveHome()">＋ 新建档案并进入</button>
      </div></div>`;
    html += wizardHTML();
    const favChips = [];
    for (const k of KINDS) for (const id of favIds(k)) {
      const it = (S.data.entities[k] || []).find(x => x.id === id);
      if (!it) continue;
      favChips.push(`<div class="favchip" onclick="WB.go('${k}');" title="${esc(DATA_TYPE[k])} · ${esc(it.name || '未命名')}"><span class="fc-x" onclick="event.stopPropagation();WB.toggleFav('${k}','${id}')" title="取消收藏">×</span>${esc(it.name || '未命名')}</div>`);
    }
    if (favChips.length) html += `<div class="setcard" style="margin-top:10px"><div><b style="font-size:13px">★ 常用收藏</b><span class="hint"> · 共 ${favChips.length} 条</span></div><div class="favtiles">${favChips.join('')}</div></div>`;
    html += `<div class="tiles" id="dashTiles">`;
    const all = S.data.entities;
    for (const k of shown) {
      const t = get(k);
      const cnt = all[k] ? all[k].length : '—';
      const sub = t[0].indexOf('persona') === 0 ? (S.activeProfile ? S.activeProfile.name : '未配置人设')
        : t[0].indexOf('ai') === 0 ? (S.activeProfile ? S.activeProfile.name + ' 待命' : '配置角色卡')
        : t[0].indexOf('script') === 0 ? '导入剧本自动登记'
        : DATA_TYPE[t[0]] + ' 登记';
      html += `<div class="tile" data-k="${t[0]}"><div class="tname">${t[2]} ${t[1]}</div>
        <div class="tnum">${cnt}</div><div class="tsub">${sub}</div><div class="handle">⠿ 拖拽排序</div></div>`;
    }
    html += `</div>`;
    html += `<div class="toolbar" style="margin-top:8px">
      <button class="ghost" onclick="WB.go('settings')">⇄ 自定义看板面板</button></div>`;
    /* 遭遇速查：有「进行中」遭遇时在总览顶部给快捷入口 */
    const encInActive = (S.data.entities.encounters || []).filter(x => x && x._open);
    if (encInActive.length) {
      html += `<div class="setcard" style="margin-top:10px"><div class="wizard-head"><b>⚔ 正在进行的遭遇</b>
        <span class="hint"> · 投骰会自动并入其流水</span><span class="grow"></span>
        <button class="ghost small" onclick="WB.go('encounter')">进入临场战斗 ▸</button></div>
        <div class="favtiles">${encInActive.map(e => `<div class="favchip" onclick="WB.go('encounter')" title="${esc(e.name || '未命名遭遇')}">⚔ ${esc(e.name || '未命名遭遇')} <span class="fc-x">${(e.units || []).length} 单位</span></div>`).join('')}</div></div>`;
    }
    if (!hidden.includes('stats')) html += statsReportHTML();
    contentInner(html);
    bindDashDrag(shown);
    paintHomeArchives();
  }

  /* 参考格局：总览 · 「今天要处理」面板 */
  function dashTodayHTML() {
    const all = S.data.entities;
    const encOpen = (all.encounters || []).filter(x => x && x._open);
    const favN = favCount();
    const totalN = KINDS.reduce((n, k) => n + (all[k] ? all[k].length : 0), 0);
    let rows = '';
    if (encOpen.length > 0) {
      rows += `<div class="dt-row"><div class="dt-lbl"><div class="dt-t">进行中的遭遇 (${encOpen.length})</div>
        <div class="dt-d">${esc(encOpen.map(e => e.name || '未命名遭遇').join('、'))} · 投骰会自动并入其流水</div></div>
        <span class="dash-pill warn">待临场</span><button class="mini-btn" onclick="WB.go('encounter')">前往 ▸</button></div>`;
    }
    if (favN > 0) {
      rows += `<div class="dt-row"><div class="dt-lbl"><div class="dt-t">常用收藏 (${favN})</div>
        <div class="dt-d">你的高频资料已置顶，点击即达</div></div><span class="dash-pill quiet">收藏</span></div>`;
    }
    if (totalN === 0) {
      rows += `<div class="dt-row"><div class="dt-lbl"><div class="dt-t">开始建卡</div>
        <div class="dt-d">档案还是空的，先建立第一个角色卡，把故事铺开</div></div>
        <span class="dash-pill danger">新手上路</span><button class="mini-btn" onclick="WB.go('pcs')">去建 ▸</button></div>`;
    }
    if (!rows) {
      rows = `<div class="dt-calm">✓ 暂无待处理事项，享受片刻安宁。</div>`;
    }
    return `<div class="dash-today"><div class="dt-head"><span class="dot"></span>今天要处理</div>${rows}</div>`;
  }

  /* 参考格局：总览 · 「战局概览」统计卡片 + 分布环 */
  function dashOverviewHTML() {
    const all = S.data.entities;
    const palette = [
      { k: 'pcs', c: '#e3c072' }, { k: 'npcs', c: '#c79a3e' }, { k: 'regions', c: '#b9822a' },
      { k: 'logs', c: '#6b9fd1' }, { k: 'mobs', c: '#a8361d' }, { k: 'lore', c: '#7a9a6a' }, { k: 'rules', c: '#8a7bb5' }
    ];
    const kindColor = {};
    for (const p of palette) kindColor[p.k] = p.c;
    let cards = '';
    const entries = [];
    let total = 0;
    for (const k of KINDS) {
      const n = (all[k] || []).length;
      total += n;
      if (n > 0 || k === 'pcs') entries.push({ k, n });
      cards += `<div class="dash-stat dash-click" data-k="${k}" style="--stat-glow:${kindColor[k]}" onclick="WB.go('${k}')">
        <div class="num">${n}</div><div class="cap"><span class="ccore" style="background:${kindColor[k]}"></span>${DATA_TYPE[k]}</div></div>`;
    }
    /* 分布环：用 stroke-dasharray 分片，简单可靠 */
    const C = 2 * Math.PI * 70;
    let segs = '', acc = 0;
    if (total > 0) {
      for (const e of entries) {
        if (!e.n) continue;
        const frac = e.n / total;
        const len = frac * C;
        segs += `<circle r="70" cx="85" cy="85" fill="none" stroke="${kindColor[e.k]}"
          stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
          transform="rotate(${(acc * 360).toFixed(2)} 85 85)" stroke-linecap="butt"/>`;
        acc += frac;
      }
    }
    const legend = KINDS.map(k => `<div class="li"><span class="sw" style="background:${kindColor[k]}"></span>${DATA_TYPE[k]}<b>${(all[k] || []).length}</b></div>`).join('');
    return `<section>
      <div class="dsec" style="margin:0 0 10px">战局概览 <span class="hint" style="font-family:var(--font);font-weight:400;letter-spacing:0">共 ${total} 条资料</span></div>
      <div class="dash-ov">${cards}</div>
      <div class="dash-today"><div class="dt-head"><span class="dot"></span>资料分布</div>
        <div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap">
          <svg width="170" height="170" viewBox="0 0 170 170">
            <circle r="70" cx="85" cy="85" fill="none" stroke="color-mix(in srgb,var(--line) 50%,transparent)" stroke-width="20"/>
            ${total > 0 ? segs : `<text x="85" y="92" text-anchor="middle" font-size="16" fill="color-mix(in srgb,var(--ink-faint) 80%,transparent)">暂无</text>`}
          </svg>
          <div class="dash-legend">${legend}</div>
        </div></div>
    </section>`;
  }

  /* 主页“开始使用 · 档案”列表 */
  async function paintHomeArchives() {
    const box = q('homeArList'); if (!box) return;
    let list; try { list = await window.api.archives.list(); } catch (_) { box.innerHTML = ''; return; }
    const cur = (S.meta && S.meta.archive) || storeName_Fallback();
    let h = '';
    for (const a of list) {
      const active = a.name === cur;
      const label = a.name === 'main' ? '主档案（默认）' : a.name;
      const when = a.modified ? new Date(a.modified).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      h += `<div class="arow" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:6px;${active ? 'background:color-mix(in srgb,var(--accent) 14%,transparent);border-color:var(--accent)' : ''}">
        <span style="flex:0 0 auto;color:var(--accent)">${active ? '✔' : '○'}</span>
        <span style="font-weight:600">${esc(label)}</span>
        <span class="hint">${when}${active ? ' · 使用中' : ''}</span><span class="grow"></span>
        ${!active ? `<button data-ar="${esc(a.name)}" data-open>打开</button>` : '<button class="ghost" disabled>当前档案</button>'}
        <button class="ghost" data-ar="${esc(a.name)}" data-dup>复制</button></div>`;
    }
    box.innerHTML = h || '<div class="empty">暂无档案，在下方新建即可。</div>';
  }
  async function createArchiveHome() {
    const name = (q('homeNewAr') && q('homeNewAr').value || '').trim();
    await createArchive(name);
  }
  function bindDashDrag(_shown) {
    const box = q('dashTiles'); if (!box || !box.children.length) return;
    /* 用 Pointer Events 重写看板卡片排序，替代原生 HTML5 拖拽（原生幽灵图/无落点提示/触屏失效/无动画）。
     * 核心：被拖卡片留在栅格里当“虚线槽位”，一张浮动克隆跟随指针，其余卡片用 FLIP 平滑让位。 */
    let activeEl = null, clone = null;
    let startX = 0, startY = 0, dragDX = 0, dragDY = 0, dragging = false;
    const THRESH = 4; // 移动超过该像素才判定为拖拽（区分纯点击）

    /* 按“读序”（逐行从左到右）求插入下标：停在第一个光标未越过的卡片之前 */
    const insertionIndex = (e) => {
      let idx = 0;
      for (const c of box.children) {
        if (c === activeEl) continue;
        const r = c.getBoundingClientRect();
        const midX = r.left + r.width / 2, midY = r.top + r.height / 2;
        const past = Math.abs(e.clientY - midY) < r.height * 0.6
          ? e.clientX > midX
          : e.clientY > midY;
        if (!past) break;
        idx++;
      }
      return idx;
    };

    /* FLIP：把本次“让位”重新绘制为平滑过渡 */
    const flip = (before) => {
      for (const c of box.children) {
        if (c === activeEl) continue;
        const b = before.get(c); if (!b) continue;
        const r = c.getBoundingClientRect();
        const dx = b.left - r.left, dy = b.top - r.top;
        if (dx || dy) { c.style.transition = 'none'; c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; }
      }
      void box.offsetWidth; // 强制回流，再统一过渡到原位
      for (const c of box.children) {
        if (c === activeEl) continue;
        c.style.transition = 'transform .22s cubic-bezier(.22,.9,.3,1)';
        c.style.transform = '';
      }
    };

    const reorder = (e) => {
      const idx = insertionIndex(e);
      const cur = [].indexOf.call(box.children, activeEl);
      if (idx === cur) return;
      const before = new Map();
      for (const c of box.children) before.set(c, c.getBoundingClientRect());
      box.removeChild(activeEl);
      const kids = [].slice.call(box.children);
      box.insertBefore(activeEl, kids.length ? (kids[idx] || null) : null);
      flip(before);
    };

    const activate = () => {
      if (clone) return;
      const r = activeEl.getBoundingClientRect();
      clone = document.createElement('div');
      clone.className = 'tile auto-clone';
      clone.style.width = r.width + 'px';
      clone.style.height = r.height + 'px';
      clone.style.left = (startX - dragDX) + 'px';
      clone.style.top = (startY - dragDY) + 'px';
      clone.innerHTML = activeEl.innerHTML;
      document.body.appendChild(clone);
      activeEl.classList.add('auto-ghost');
      activeEl.style.transition = 'none';
    };

    const onMove = (e) => {
      if (!activeEl) return;
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESH) return;
        dragging = true; activate();
      }
      if (clone) { clone.style.left = (e.clientX - dragDX) + 'px'; clone.style.top = (e.clientY - dragDY) + 'px'; }
      reorder(e);
    };

    const endDrag = () => {
      if (clone && clone.parentNode) clone.parentNode.removeChild(clone);
      clone = null;
      if (activeEl) {
        activeEl.classList.remove('auto-ghost');
        activeEl.style.transition = ''; activeEl.style.transform = '';
        if (dragging) {
          const order = [].map.call(box.children, c => c.dataset.k);
          S.settings.layout = S.settings.layout || {};
          S.settings.layout.dashOrder = order;
          persist();
        }
      }
      activeEl = null; dragging = false;
    };

    box.addEventListener('pointerdown', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('.tile') : null;
      if (!t || !box.contains(t)) return;
      if (e.button !== 0) return;
      const r = t.getBoundingClientRect();
      dragDX = e.clientX - r.left; dragDY = e.clientY - r.top;
      activeEl = t; startX = e.clientX; startY = e.clientY; dragging = false;
      try { box.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);
  }

  /* ========== 资料视图 ========== */
  function renderDataView(kind) {
    const schema = S.fields[kind] || [];
    const arr = S.data.entities[kind] || [];
    const kw = (S.search || '').toLowerCase();
    const dv = (S.dv && S.dv.kind === kind) ? S.dv : null;
    const srcF = dv ? dv.src : 'all';
    const tagF = (S.tagF && S.tagF.kind === kind) ? S.tagF.tag : '';
    let list = arr.filter(it => {
      if (kw && entitySearchLower(it).indexOf(kw) === -1) return false;
      if (srcF !== 'all' && (it.source || '') !== srcF) return false;
      if (tagF && !entityHasTag(schemaFor(kind, it), it, tagF)) return false;
      return true;
    });
    if (dv && dv.sort === 'custom') {
      list = applyCustomOrder(list, (S.dvCustom && S.dvCustom[kind]) || []);
    } else if (dv && dv.sort === 'fav') {
      list = list.slice().sort((a, b) => (isFav(kind, b.id) ? 1 : 0) - (isFav(kind, a.id) ? 1 : 0)
        || String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
    } else if (dv && dv.sort !== 'none') {
      const dir = dv.dir === 'desc' ? -1 : 1;
      try { list = list.slice().sort((a, b) => dir * String(a.name || '').localeCompare(String(b.name || ''), 'zh')); } catch (_) {}
    } else {
      list = list.slice().sort((a, b) => (isFav(kind, b.id) ? 1 : 0) - (isFav(kind, a.id) ? 1 : 0));
    }
    S._sel = (S._sel || {}); const selSet = S._sel[kind] = S._sel[kind] || {};
    const batchMode = !!S.batchMode;
    const isRuled = (kind === 'rules' || kind === 'lore');   // 参考格局：规则/背景用可折叠「速查卡」
    const sel = (v, key) => v === key ? ' selected' : '';
    const sortOpts = [['none', '排序：添加顺序'], ['fav', '★ 收藏置顶'], ['name', '名称 A→Z'], ['named', '名称 Z→A'], ['custom', '排序：自定义']]
      .map(([v, l]) => `<option value="${v}"${sel(v, (dv && dv.sort) || 'none')}>${l}</option>`).join('');
    const isCustomSort = (dv && dv.sort === 'custom');
    const srcOpts = [['all', '来源：全部'], ['手动导入', '手动导入'], ['文件导入', '文件导入'], ['剧本解析', '剧本解析'], ['AI 生成', 'AI 生成'], ['清单生成', '清单生成'], ['文件分析整理', '文件分析整理'], ['AI 拆分登记', 'AI 拆分登记']]
      .map(([v, l]) => `<option value="${esc(v)}"${sel(v, srcF)}>${l}</option>`).join('');
    const tplSel = (S.viewTpl && S.viewTpl[kind]) || '';
    const tplOpts = TPL_KINDS.includes(kind) ? tplList().map(t => `<option value="${esc(t.id)}"${t.id === tplSel ? ' selected' : ''}>${esc(t.name)}</option>`).join('') : '';

    let html = `<div class="page-title"><h2>${DATA_TYPE[kind]}</h2><span class="hint">共 ${arr.length} 条 · ${schema.length} 个字段${isCustomSort ? ' · 拖动卡片左侧手柄（或卡片本体）可自定义排序' : ''}${tagF ? ` · 已按标签 <b>＃${esc(tagF)}</b> 筛选` : ''}</span></div>`;
    html += `<div class="toolbar">
      <button class="ghost" onclick="WB.navBack()" title="返回 (Alt+←)">←</button>
      <button class="ghost" onclick="WB.navForward()" title="前进 (Alt+→)">→</button>
      <input class="search" placeholder="搜索…" value="${esc(S.search || '')}" oninput="WB.search(this.value)">
      <select onchange="WB.setViewSort(this.value)" title="排序方式">${sortOpts}</select>
      <select onchange="WB.setViewSrc(this.value)" title="按来源筛选">${srcOpts}</select>
      ${tagF ? `<button class="ghost tag-filter" onclick="WB.tagFilter(null)" title="清除标签筛选">＃${esc(tagF)} ✕</button>` : ''}
      <span class="grow"></span>
      <span class="more-anchor">
        <button class="ghost more-trigger" id="tbMoreBtn" onclick="WB.toggleMoreMenu()" title="更多操作">⋯ 更多</button>
        <div class="more-menu" id="tbMoreMenu" hidden>
          ${tplOpts ? `<select onchange="WB.setViewTpl(this.value)" title="AI 生成所用的卡片模板" style="width:100%;margin-bottom:2px">${tplOpts}</select>` : ''}
          <button onclick="WB.aiGenForView('${kind}')">⚡ AI 生成（结合对话）</button>
          ${(kind === 'rules' || kind === 'lore') ? `<button onclick="WB.aiIntegrate('${kind}')">⚡ AI 整合</button>` : ''}
          ${(kind === 'rules' || kind === 'lore') ? `<button onclick="WB.aiWriteScript('${kind}')">📜 AI 编写剧本全文</button>` : ''}
          ${kind === 'logs' ? `<button onclick="WB.polishLogs('${kind}')">✍ AI 批量润色（日志）</button>` : ''}
          <button onclick="WB.consistencyOpen()">🛡 一致性检查</button>
          <button onclick="WB.importContent('${kind}')">↧ 导入/粘贴</button>
          <button onclick="WB.toggleBatch('${kind}')">☑ 多选模式</button>
        </div>
      </span>
      <button onclick="WB.add('${kind}')">＋ 新增</button>
      <button class="ghost" title="导出当前页全部资料（可选格式）" onclick="WB.exportPick('${kind}')">↧ 导出</button></div>`;
    if (kind === 'rules' || kind === 'lore') html += `<div class="hint" id="impState" style="margin-top:-4px"></div>`;
    if (batchMode) {
      const nSel = Object.keys(selSet).filter(id => selSet[id]).length;
      html += `<div class="batchbar">
        <span id="batchCount">已选 <b>${nSel}</b> 条</span>
        <span class="grow"></span>
        <button class="ghost" onclick="WB.batchSelectAll('${kind}', true)">全选</button>
        <button class="ghost" onclick="WB.batchSelectAll('${kind}', false)">清空</button>
        <button class="ghost" onclick="WB.batchFav('${kind}')" title="将已选项加入收藏">★ 收藏已选</button>
        <button class="ghost" onclick="WB.batchExport('${kind}')" title="导出已选为文档">↧ 导出已选</button>
        <button class="ghost" onclick="WB.dedupKind('${kind}')" title="扫描并删除同名重复卡，只保留最早一条">⊘ 去重</button>
        <button class="danger" onclick="WB.batchDel('${kind}')" title="删除已选（需确认）">删除已选</button>
        <button class="ghost" onclick="WB.toggleBatch('${kind}')">完成</button>
      </div>`;
    }

    if (!list.length) { html += `<div class="empty">${arr.length ? '无匹配结果' : '还没有内容，点击右上角新增'}</div>`; }
    else {
      /* 单卡渲染（数据视图内联）：逻辑与原循环体完全一致，供普通/分帧两条路径共用。 */
      const cardHTML = (it) => {
        const cs = schemaFor(kind, it);
        const name = it.name || '未命名';
        const tagsF = new Set(cs.filter(f => f.t === 'tags').map(f => f.k));
        const selectF = new Set(cs.filter(f => ['select', 'number'].includes(f.t)).map(f => f.k));
        let inner = '';
        let shown = 0;
        for (const f of cs) {
          if (f.k === 'name') continue;
          const v = it[f.k];
          if (v === undefined || v === null || v === '') continue;
          if (Array.isArray(v) && !v.length) continue;
          shown++;
          if (shown > 12) break;
          if (tagsF.has(f.k)) {
            const ts = Array.isArray(v) ? v : tagsToArr(v);
            inner += `<div class="row"><b>${esc(f.l)}</b><span class="tags">${ts.map(x => `<span class="tag">${esc(x)}</span>`).join('')}</span></div>`;
          } else {
            const long = Array.isArray(v) ? v.join('、') : v;
            const cmp = String(long).length > 46;
            inner += `<div class="row${cmp ? ' long' : ''}"><b>${esc(f.l)}</b>${esc(long)}</div>`;
          }
        }
        const selVals = cs.filter(f => selectF.has(f.k) && it[f.k]).map(f => `<span class="tag">${esc(f.l)}·${esc(it[f.k])}</span>`).join('');
        const tplTag = it.tpl ? `<span class="ctag tpl" title="模板：${esc(tplName(it.tpl))}">${esc(tplName(it.tpl))}</span>` : '';
        if (isRuled) {
          /* 参考格局：规则/背景一条 = 一张可折叠速查卡 */
          return `<details class="rcard"${it._open ? ' open' : ''}>
            <summary><span class="rc-chev">▸</span><span class="cnm">${esc(name)}</span>${tplTag}${it.source ? '<span class="ctag">' + esc(it.source) + '</span>' : ''}
              <span class="fav-star" onclick="event.preventDefault();WB.toggleFav('${kind}','${it.id}')" title="收藏/取消收藏">${isFav(kind, it.id) ? '★' : '☆'}</span>
              <span class="grow"></span><span class="rc-actions">
                <button class="ghost" onclick="event.preventDefault();event.stopPropagation();WB.edit('${kind}','${it.id}')">编辑</button>
                <button class="ghost" onclick="event.preventDefault();event.stopPropagation();WB.dupCard('${kind}','${it.id}')" title="复制">⧉</button>
                <button class="danger" onclick="event.preventDefault();event.stopPropagation();WB.del('${kind}','${it.id}')">删除</button>
              </span></summary>
            <div class="rc-body">${selVals ? `<div class="tags">${selVals}</div>` : ''}${inner || '<div class="row" style="color:var(--ink-faint)">暂无正文</div>'}</div>
          </details>`;
        }
        const favStar = isFav(kind, it.id) ? '★' : '☆';
        const selChecked = selSet[it.id] ? ' checked' : '';
        return `<div class="card${isFav(kind, it.id) ? ' faved' : ''}${isCustomSort ? ' dragsortable' : ''}" data-kind="${esc(kind)}" data-id="${esc(it.id)}" oncontextmenu="WB.openCtx(event,'${kind}','${it.id}')">
          <div class="cname">
            ${batchMode ? `<label class="batch-check"><input type="checkbox" data-batch="${esc(it.id)}"${selChecked} onchange="WB.toggleSel('${kind}','${it.id}',this.checked)"></label>` : ''}
            ${isCustomSort ? `<span class="sort-handle" title="按住拖动可排序">⠿</span>` : ''}
            <span class="cnm">${esc(name)}</span>${tplTag}${it.source ? '<span class="ctag">' + esc(it.source) + '</span>' : ''}${xrefBadgeHTML(name, kind, it.id)}
            <span class="fav-btn" onclick="WB.toggleFav('${kind}','${it.id}')" title="收藏/取消收藏">${favStar}</span>
          </div>
          ${selVals ? `<div class="tags">${selVals}</div>` : ''}
          <div class="kv">${inner || '<div class="row" style="color:var(--ink-faint)">暂无正文</div>'}</div>
          <div class="card-actions">
            <button class="ghost" onclick="WB.edit('${kind}','${it.id}')">编辑</button>
            <button class="ghost" onclick="WB.dupCard('${kind}','${it.id}')" title="复制一张含全部字段与模板的副本">⧉ 复制</button>
            <button class="danger" onclick="WB.del('${kind}','${it.id}')">删除</button>
          </div></div>`;
      };
      html += `<div class="cardgrid${isRuled ? ' rcards' : ''}" id="cardgrid">`;
      const LEN = list.length;
      const CHUNK = 500;                          // 单批量渲染张数
      const WINDOW = 600;                         // 窗口化首屏/阈值：首屏渲染上限，越界后再按需追加
      if (LEN <= CHUNK) {
        // 常规小列表：一次性拼接，行为与旧版完全一致
        for (const it of list) html += cardHTML(it);
        html += `</div>`;
      } else {
        /* A2/D3 分帧 + 窗口化渲染：超大列表不一次性构造数千个 DOM 节点。
         * 先 rAF 分批 append 首屏 WINDOW 张；滚动接近网格底部再追加下一批，
         * 既避免首屏长时间无响应，也避免一次性挂上上千节点拖慢滚动/交互。 */
        contentInner(html);
        const grid = q('cardgrid');
        let i = 0;
        const loaded = [];                          // 已渲染到的实体索引（供增量追加）
        const boxes = [];
        function rflush() { if (boxes.length) { grid.insertAdjacentHTML('beforeend', boxes.join('')); boxes.length = 0; } }
        function rstep() {
          const end = Math.min(i + CHUNK, LEN, WINDOW);
          for (; i < end; i++) { boxes.push(cardHTML(list[i])); loaded.push(i); }
          rflush();
          if (i < WINDOW && i < LEN) {
            requestAnimationFrame(rstep);
          } else {
            grid.insertAdjacentHTML('beforeend', '</div>');
            if (i < LEN) bindWindowScroll();       // 还有剩余 → 启用增量加载
            if (isCustomSort) bindCardDrag();
          }
        }
        function bindWindowScroll() {
          const cont = q('content');
          /* 重复进出资料页时先解绑上一次的增量回调，避免 scroll 监听叠加、回调数量异常增长 */
          if (wsListen && wsListen.on) { window.removeEventListener('scroll', wsListen.on); cont.removeEventListener('scroll', wsListen.on); }
          const next = () => {
            if (i >= LEN) return;
            const rc = grid.getBoundingClientRect();
            const vp = cont.clientHeight || window.innerHeight;
            if (rc.bottom - window.innerHeight > 640) return;   // 距视口下方仍远，暂不加载
            const end = Math.min(i + CHUNK, LEN);
            const frag = [];
            for (; i < end; i++) { frag.push(cardHTML(list[i])); loaded.push(i); }
            grid.insertAdjacentHTML('beforeend', frag.join(''));
            if (i < LEN) requestAnimationFrame(next);           // 一次滚动可连续补足
          };
          wsListen = { on: next };
          cont.addEventListener('scroll', next, { passive: true });
          window.addEventListener('scroll', next, { passive: true });
          next(); // 首次进入若本就靠底（如窗口很小），立即补一段
        }
        requestAnimationFrame(rstep);
        return; // 分帧路径离开函数，绑定等后续动作在 rstep 完成后统一执行
      }
    }
    contentInner(html);
    if (isCustomSort) bindCardDrag();
  }
  function setViewTpl(v) {
    if (!S.viewTpl) S.viewTpl = {};
    S.viewTpl[S.view] = v;
    renderDataView(S.view);
  }
  function setViewSort(v) {
    if (!S.dv) S.dv = {};
    const by = (v === 'name' || v === 'named') ? 'name' : (v === 'custom' ? 'custom' : 'none');
    S.dv.sort = by; S.dv.dir = (v === 'named') ? 'desc' : 'asc';
    S.dv.kind = S.view;
    renderDataView(S.view);
  }
  function setViewSrc(v) {
    if (!S.dv) S.dv = {};
    S.dv.src = v; S.dv.kind = S.view;
    renderDataView(S.view);
  }

  /* ========== 标签体系：全局标签视图 + 批量重命名/合并 + 按标签筛选 ==========
   * 标签来自各资料的 tags 型字段。视图聚合全库标签计数，可重命名（改正拼写）、
   * 合并（清理近义词），并可一键跳到某类型用某标签筛选卡片列表。 */
  function entityTagsOf(it, schema) {
    const out = [];
    for (const f of (schema || [])) {
      if (f.t !== 'tags') continue;
      const v = it[f.k];
      if (Array.isArray(v)) out.push(...v);
      else out.push(...tagsToArr(v));
    }
    return out;
  }
  function entityHasTag(schema, it, tag) {
    const kw = String(tag).trim().toLowerCase();
    if (!kw) return true;
    return entityTagsOf(it, schema).some(x => String(x).trim().toLowerCase() === kw);
  }
  /* 汇总全库标签：返回 [{tag, count, used:[kind...]}]，count 为使用次数（一份资料记一次） */
  function allTags() {
    const map = new Map();
    for (const k of KINDS) {
      const schema = S.fields[k] || [];
      for (const it of (S.data.entities[k] || [])) {
        const seen = new Set();
        for (const t of entityTagsOf(it, schema)) {
          const tt = String(t).trim(); if (!tt) continue;
          if (seen.has(tt)) continue; seen.add(tt);
          if (!map.has(tt)) map.set(tt, { tag: tt, count: 0, used: {} });
          const rec = map.get(tt); rec.count++; rec.used[k] = (rec.used[k] || 0) + 1;
        }
      }
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));
    return arr;
  }
  /* 批量重命名标签：把 all 里的标签改名为 newName（跨全部实体、全部 tags 字段） */
  function tagRename(oldTag, newName, all) {
    const o = String(oldTag || '').trim(); const n = String(newName || '').trim();
    if (!o || !n || o === n) { toast('新旧标签都不能为空且需不同', 'err'); return; }
    const targets = all && all.length ? all : [o];
    let changed = 0;
    for (const k of KINDS) {
      const schema = S.fields[k] || [];
      for (const it of (S.data.entities[k] || [])) {
        let touched = false;
        for (const f of schema) {
          if (f.t !== 'tags') continue;
          const arr = Array.isArray(it[f.k]) ? it[f.k].slice() : tagsToArr(it[f.k]);
          const mapped = arr.map(x => targets.includes(String(x).trim()) ? n : x);
          const uniq = Array.from(new Set(mapped));
          if (mapped.some(v => targets.includes(String(v)))) { it[f.k] = uniq; touched = true; }
        }
        if (touched) changed++;
      }
    }
    pushAudit('tag', 'rename', '#' + o + ' → #' + n + '（' + targets.length + '）');
    persist();
    if (S.tagF && targets.includes(String(S.tagF.tag))) { delete S.tagF.tag; }
    toast('已重命名标签 #' + o + ' → #' + n + '，涉及 ' + changed + ' 条资料', 'ok');
    renderTags();
  }
  /* 合并标签：把多个标签合并为一个（sources 里的标签全部并入 target） */
  function tagMerge(target, sources) {
    const t = String(target || '').trim(); const srcs = (sources || []).map(x => String(x).trim()).filter(Boolean);
    if (!t || !srcs.length) return;
    const all = [t, ...srcs];
    const o = srcs[0];
    let changed = 0;
    for (const k of KINDS) {
      const schema = S.fields[k] || [];
      for (const it of (S.data.entities[k] || [])) {
        let touched = false;
        for (const f of schema) {
          if (f.t !== 'tags') continue;
          const arr = Array.isArray(it[f.k]) ? it[f.k].slice() : tagsToArr(it[f.k]);
          let mapped = arr.map(x => srcs.includes(String(x).trim()) ? t : x);
          mapped = Array.from(new Set(mapped));
          if (arr.some(x => srcs.includes(String(x).trim()))) { it[f.k] = mapped; touched = true; }
        }
        if (touched) changed++;
      }
    }
    pushAudit('tag', 'merge', all.map(x => '#' + x).join(' + '));
    persist();
    toast('已把 ' + srcs.map(x => '#' + x).join('、#') + ' 合并为 #' + t + '，涉及 ' + changed + ' 条资料', 'ok');
    renderTags();
  }
  /* 全局标签面板（视图） */
  function renderTags() {
    const rows = allTags();
    let html = `<div class="page-title"><h2>标签</h2><span class="hint">全库共 ${rows.length} 个标签 · 点击标签可筛选某类资料 · 支持批量重命名与合并</span></div>`;
    html += `<div class="toolbar">
      <button class="ghost" onclick="WB.go('relations')" title="返回上一页">←</button>
      <span class="grow"></span>
      <button class="ghost" onclick="WB.tagRenameModal()" title="改正标签的拼写或统一叫法">✎ 重命名</button>
      <button class="ghost" onclick="WB.tagMergeModal()" title="把多个同义标签合并为一个">⧉ 合并标签</button>
      <button onclick="WB.addTagGlobal()" title="新建标签并把它加到指定资料">＋ 新建标签</button></div>`;
    if (!rows.length) { html += `<div class="empty">还没有标签。可在编辑人物卡/NPC/怪物时，在「标签/关键词」类字段填写逗号分隔的标签。</div>`; contentInner(html); return; }
    html += `<div class="cardgrid">`;
    for (const r of rows) {
      const kindsBadge = Object.keys(r.used).slice(0, 4).map(k => `<span class="ctag">${DATA_TYPE[k] || k}</span>`).join('');
      const countList = Object.keys(r.used).map(k => r.used[k] + ' 条').join(' · ');
      html += `<div class="card tag-card" data-tag="${esc(r.tag)}">
        <div class="cname"><span class="cnm">＃${esc(r.tag)}</span><span class="ctag">× ${r.count}</span></div>
        <div class="row long"><b>分布</b>${kindsBadge || '<span class="hint">—</span>'} <span class="hint">${countList}</span></div>
        <div class="card-actions">
          <button class="ghost" onclick="WB.tagJump('${escKindParam(r.tag)}')" title="用此标签筛选卡片列表">筛选</button>
          <button class="ghost" onclick="WB.tagRenameModal('${escKindParam(r.tag)}')" title="重命名此标签">✎ 重命名</button>
          <button class="ghost" onclick="WB.tagMergeInto('${escKindParam(r.tag)}')" title="把此标签并入另一个">并入它</button>
        </div></div>`;
    }
    html += `</div>`;
    contentInner(html);
  }
  /* 统计概览纯文本：导出下载 / 复制剪贴板公用 */
  function statsSummaryText() {
    const dayMs = 864e5;
    const dice = (S.settings && Array.isArray(S.settings.diceLog)) ? S.settings.diceLog : [];
    const act = stsActivity(dice, 30, dayMs);
    const L = [];
    L.push('KP 跑团工作台 · 统计分析概览');
    L.push('生成时间：' + new Date().toLocaleString('zh-CN'));
    L.push('档案：' + (worldLabel() || '未命名'));
    L.push('');
    L.push('【数据构成】');
    for (const k of STATS_K) {
      const n = ((S.data.entities && S.data.entities[k]) || []).length;
      if (n > 0) L.push('  ' + (DATA_TYPE[k] || k) + '：' + n);
    }
    L.push('');
    L.push('【投骰档案】');
    L.push('  投骰总次数：' + dice.length);
    if (dice.length) {
      L.push('  近 30 天投骰：' + act.byDay.reduce((a, x) => a + x.n, 0));
      const t = dice[0] && dice[0].t ? new Date(String(dice[0].t)) : null;
      if (t && !isNaN(t.getTime())) L.push('  首次投骰：' + t.toLocaleDateString('zh-CN'));
      const last = dice[dice.length - 1] && dice[dice.length - 1].t ? new Date(String(dice[dice.length - 1].t)) : null;
      if (last && !isNaN(last.getTime())) L.push('  最近投骰：' + last.toLocaleString('zh-CN'));
    }
    L.push('');
    L.push('【遭遇战】');
    const encs = (S.data.entities && S.data.entities.encounters) || [];
    L.push('  遭遇场次：' + encs.length);
    const undone = encs.filter(x => !x.done).length;
    L.push('  进行中/未结算：' + undone + '；已结算：' + (encs.length - undone));
    L.push('');
    return L.join('\n');
  }
  function statsExport() {
    const text = statsSummaryText();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = '跑团统计_' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('统计概览已导出为文本文件', 'ok');
  }
  function statsCopy() {
    const text = statsSummaryText();
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      toast('统计概览已复制到剪贴板', 'ok');
    } catch (_) { toast('复制失败，请使用「导出统计文本」', 'err'); }
  }
  function escKindParam(s) { return String(s).replace(/['"\\]/g, ''); }
  /* 用某标签筛选某类型卡片列表；kind 不确定时弹出类型选择 */
  function tagJump(tag, kind) {
    const t = String(tag || '').trim();
    if (!kind) {
      const opts = KINDS.map(k => `<button class="ghost" style="justify-content:flex-start" onclick="WB.tagJump('${escKindParam(t)}','${k}')">${DATA_TYPE[k]}</button>`).join('');
      const mask = q('modalMask'); const box = q('modalBox');
      box.innerHTML = `<h3>用 ＃${esc(t)} 筛选</h3>
        <div class="note">选择要筛选的资料类型：</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">${opts}</div>
        <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button></div>`;
      mask.hidden = false;
      return;
    }
    if (S.data.entities[kind]) { S.tagF = { kind, tag: t }; switchView(kind); }
  }
  function addTagGlobal() {
    appPrompt({ title: '新建标签', label: '输入标签名（用于跨资料管理）', placeholder: '例如：反派、克苏鲁、重要道具', okText: '创建' }, (v) => {
      const tag = String(v || '').trim(); if (!tag) return;
      toast('已登记标签 #' + tag + '。编辑资料时在标签字段填入它即可归组', 'ok');
      renderTags();
    });
  }
  function tagRenameModal(pre) {
    const rows = allTags();
    const op = pre ? `<option value="${esc(pre)}" selected>${esc(pre)}</option>` : '';
    const opts = op + rows.map(r => `<option value="${esc(r.tag)}">${esc(r.tag)}（×${r.count}）</option>`).join('');
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>重命名标签</h3>
      <div class="note">选择要修改的标签，输入新名称。纠正拼写后全库所有引用此标签的资料会自动更新。</div>
      <div class="row full"><label>旧标签</label><select id="tagRenameOld">${opts}</select></div>
      <div class="row full"><label>新标签名</label><input id="tagRenameNew" placeholder="输入新名称"></div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button><button id="tagRenameOk">重命名</button></div>`;
    mask.hidden = false;
    q('tagRenameOk').onclick = () => { const o = q('tagRenameOld').value; const n = q('tagRenameNew').value.trim(); if (!n) { toast('请输入新标签名', 'err'); return; } tagRename(o, n); };
  }
  function tagMergeInto(src) {
    const rows = allTags().filter(r => r.tag !== src);
    const opts = rows.map(r => `<option value="${esc(r.tag)}">${esc(r.tag)}（×${r.count}）</option>`).join('') || '<option value="">（没有其他标签）</option>';
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>把 ＃${esc(src)} 并入…</h3>
      <div class="note">选择目标标签，#${esc(src)} 会被替换为目标标签，合并后不再存在独立标签。</div>
      <div class="row full"><label>目标标签</label><select id="tagMergeTarget">${opts}</select></div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button><button id="tagMergeOk">合并</button></div>`;
    mask.hidden = false;
    q('tagMergeOk').onclick = () => { const t = q('tagMergeTarget').value; if (!t) return; tagMerge(t, [src]); };
  }
  function tagMergeModal() {
    const rows = allTags();
    const opts = rows.map(r => `<option value="${esc(r.tag)}">${esc(r.tag)}（×${r.count}）</option>`).join('') || '<option value="">（暂无标签）</option>';
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>合并标签</h3>
      <div class="note">把多个同义标签合并为一个。被合并的标签从全库移除，统一改为目标标签。</div>
      <div class="row full"><label>保留的标签（目标）</label><select id="tagMergeDst">${opts}</select></div>
      <div class="row full"><label>待合并标签（可多选）</label><select id="tagMergeSrcs" multiple size="6">${opts}</select></div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button><button id="tagMergeOk">合并</button></div>`;
    mask.hidden = false;
    q('tagMergeOk').onclick = () => {
      const dst = q('tagMergeDst').value; const srcs = Array.from(q('tagMergeSrcs').selectedOptions).map(o => o.value);
      if (!dst || !srcs.length) { toast('请选择目标和至少一个待合并标签', 'err'); return; }
      if (srcs.includes(dst)) { toast('目标标签不能同时在待合并列表里', 'err'); return; }
      tagMerge(dst, srcs);
    };
  }
  /* 清除当前类型的标签筛选 */
  function tagFilter(v) {
    if (v == null) { delete S.tagF; if (S.data.entities[S.view]) renderDataView(S.view); else renderTags(); }
  }

  /* ---- 批量操作：多选 → 批量删除/导出/收藏/置顶 ---- */
  function toggleBatch(kind) {
    S.batchMode = !S.batchMode;
    if (!S.batchMode && S._sel) { const s = S._sel[kind]; if (s) for (const k in s) s[k] = false; }
    switchView(kind);
  }
  function toggleSel(kind, id, checked) {
    if (!S._sel) S._sel = {};
    if (!S._sel[kind]) S._sel[kind] = {};
    S._sel[kind][id] = !!checked;
    const el = q('batchCount'); if (el) el.innerHTML = '已选 <b>' + Object.keys(S._sel[kind]).filter(x => S._sel[kind][x]).length + '</b> 条';
  }
  function batchSelIds(kind) {
    if (!S._sel || !S._sel[kind]) return [];
    return Object.keys(S._sel[kind]).filter(id => S._sel[kind][id]);
  }
  function batchSelectAll(kind, on) {
    const ids = (S.data.entities[kind] || []).map(x => x.id);
    if (!S._sel) S._sel = {};
    if (!S._sel[kind]) S._sel[kind] = {};
    for (const id of ids) S._sel[kind][id] = on;
    switchView(kind);
  }
  async function batchDel(kind) {
    const ids = batchSelIds(kind);
    if (!ids.length) { toast('请先勾选要删除的条目', 'err'); return; }
    if (!(await appConfirm('批量删除', '确定删除已选的 ' + ids.length + ' 条「' + (DATA_TYPE[kind] || kind) + '」？'))) return;
    const set = new Set(ids);
    S.data.entities[kind] = S.data.entities[kind].filter(x => !set.has(x.id));
    pushAudit('delete', kind, '批量 × ' + ids.length);
    const fav = favIds(kind); S.settings.favs[kind] = fav.filter(id => !set.has(id));
    persist(); switchView(kind);
    toast('已删除 ' + ids.length + ' 条', 'ok');
  }
  function batchFav(kind) {
    const ids = batchSelIds(kind);
    if (!ids.length) { toast('请先勾选条目', 'err'); return; }
    const fav = favIds(kind);
    for (const id of ids) if (!fav.includes(id)) fav.push(id);
    persist(); pushAudit('fav', kind, '批量收藏 × ' + ids.length);
    switchView(kind); toast('已收藏 ' + ids.length + ' 条', 'ok');
  }
  function batchExport(kind) {
    const ids = batchSelIds(kind);
    if (!ids.length) { toast('请先勾选要导出的条目', 'err'); return; }
    exportIds(kind, ids);
  }
  /* 按指定 id 集合导出（供批量导出复用导出核心逻辑之后端生成） */
  async function exportIds(kind, ids) {
    const set = new Set(ids);
    const arr = (S.data.entities[kind] || []).filter(x => set.has(x.id));
    const schema = S.fields[kind] || [];
    const title = DATA_TYPE[kind] || kind;
    if (!arr.length) { toast('所选条目不存在', 'err'); return; }
    const fname = String(S.settings.appName || '档案').replace(/[\\/:*?"<>|]/g, '_');
    const base = fname + '_' + kind + '-' + new Date().toISOString().slice(0, 10) + '-已选' + arr.length;
    const renderValue = (v) => Array.isArray(v) ? v.join('、') : String(v == null ? '' : v);
    const has = (it, f) => !(it[f.k] === undefined || it[f.k] === null || (Array.isArray(it[f.k]) && !it[f.k].length) || it[f.k] === '');
    const dload = (content, ext, mime, l) => {
      const blob = new Blob([content], { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = base + '.' + ext;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 400);
      pushAudit('export', kind, title + ' × ' + arr.length + ' · ' + l);
      toast('已导出「' + title + '」共 ' + arr.length + ' 条（.' + ext + '）', 'ok');
    };
    try {
      /* 经主进程生成 Word（与单条导出走同一 store:exportDoc 通道），失败则降级为 Markdown */
      if (window.api && window.api.exportDoc) {
        const rows = arr.map(it => {
          const cells = [];
          for (const f of schema) { if (f.k === 'name' || !has(it, f)) continue; try { cells.push([String(f.l), renderValue(it[f.k])]); } catch (_) {} }
          if (it.source) cells.push(['来源', renderValue(it.source)]);
          return { name: String(it.name || it.title || '未命名'), cells };
        });
        const res = await window.api.exportDoc({ format: 'docx', title, count: arr.length, rows });
        if (!res || !res.ok) { toast('批量导出失败：' + ((res && res.error) || '未知错误'), 'err'); return; }
        dload(res.buf, res.ext, res.mime, 'Word');
      } else {
        const md = arr.map(it => `### ${it.name || '未命名'}\n` + schema.filter(f => has(it, f) && f.k !== 'name').map(f => `- **${f.l}**：${renderValue(it[f.k])}`).join('\n') + '\n').join('\n---\n');
        dload(md, 'md', 'text/markdown', 'Markdown');
      }
    } catch (e) { toast('批量导出失败：' + ((e && e.message) || e), 'err'); }
  }

  /* ---- 前进/后退导航（记录资料页切换历史，用 Alt+← / Alt+→ 或工具栏按钮） ---- */
  let _navHist = [], _navIdx = -1;
  function navPush(v) {
    if (_navIdx >= 0 && _navHist[_navIdx] === v) return;
    _navHist = _navHist.slice(0, _navIdx + 1);
    _navHist.push(v); _navIdx = _navHist.length - 1;
    if (_navHist.length > 60) { _navHist.shift(); _navIdx--; }
  }
  function navBack() { if (_navIdx > 0) { _navIdx--; go(_navHist[_navIdx]); } }
  function navForward() { if (_navIdx < _navHist.length - 1) { _navIdx++; go(_navHist[_navIdx]); } }

  /* 新增/编辑弹窗（模板可切换卡片字段集） */
  function editRows(schema, item) {
    let rows = '';
    for (const f of schema) {
      const v = (item && item[f.k] !== undefined) ? (Array.isArray(item[f.k]) ? item[f.k].join('、') : item[f.k]) : '';
      const full = f.t === 'textarea' || f.t === 'tags' ? ' full' : '';
      if (f.t === 'textarea') {
        rows += `<div class="row${full}"><label>${esc(f.l)}</label><textarea data-k="${esc(f.k)}" rows="${String(v).length > 120 ? 4 : 2}">${esc(v)}</textarea></div>`;
      } else if (f.t === 'select') {
        const opts = (f.opts || []).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
        rows += `<div class="row"><label>${esc(f.l)}</label><select data-k="${esc(f.k)}"><option value="">—</option>${opts}</select></div>`;
      } else if (f.t === 'number') {
        rows += `<div class="row"><label>${esc(f.l)}</label><input data-k="${esc(f.k)}" type="number" value="${esc(v)}"></div>`;
      } else if (f.t === 'tags') {
        rows += `<div class="row${full}"><label>${esc(f.l)}（逗号分隔）</label><input data-k="${esc(f.k)}" value="${esc(v)}"></div>`;
      } else {
        rows += `<div class="row"><label>${esc(f.l)}</label><input data-k="${esc(f.k)}" value="${esc(v)}"></div>`;
      }
    }
    return rows;
  }
  function editModal(kind, item) {
    const isEdit = !!item;
    const curTpl = (item && item.tpl) || '';
    const tplRow = TPL_KINDS.includes(kind) ? `<div class="row" style="grid-column:1/-1"><label>卡片模板</label>
      <select id="etTpl" onchange="WB.editSetTpl('${kind}')">${tplList().map(t => `<option value="${esc(t.id)}"${t.id === curTpl ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <span class="hint" style="grid-column:1/-1;color:var(--ink-faint)">模板决定此卡的字段集（如 CoC 力量/理智/魔法值、DnD 六属性/AC）。</span></div>` : '';
    const mask = q('modalMask');
    const box = q('modalBox');
    box.innerHTML = `<h3>${isEdit ? '编辑' : '新增'} ${DATA_TYPE[kind]}</h3>
      <div class="formgrid" id="etForm" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);">${tplRow}${editRows(schemaFor(kind, item), item)}</div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button>
      <button onclick="WB.saveEdit('${kind}','${isEdit ? item.id : ''}')">保存</button></div>`;
    mask.hidden = false;
    // 新建时自动聚焦名字字段（若 schema 含 name）
    const nameEl = box.querySelector('[data-k="name"]');
    if (nameEl) setTimeout(() => nameEl.focus(), 30);
  }
  /* 编辑弹窗里切换模板：按新模板的字段集重绘表单（保留已填值中仍存在的字段） */
  function editSetTpl(kind) {
    const box = q('modalBox'); if (!box) return;
    const tpl = q('etTpl') ? q('etTpl').value : '';
    const grid = box.querySelector('#etForm'); if (!grid) return;
    // 读取当前已填值（按现有 data-k）
    let vals = {};
    grid.querySelectorAll('[data-k]').forEach(el => { vals[el.dataset.k] = el.value; });
    grid.innerHTML = (TPL_KINDS.includes(kind) ? `<div class="row" style="grid-column:1/-1"><label>卡片模板</label>
      <select id="etTpl" onchange="WB.editSetTpl('${kind}')">${tplList().map(t => `<option value="${esc(t.id)}"${t.id === tpl ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <span class="hint" style="grid-column:1/-1;color:var(--ink-faint)">模板决定此卡的字段集（如 CoC 力量/理智/魔法值、DnD 六属性/AC）。</span></div>` : '')
      + editRows(schemaFor(kind, { tpl }), vals) + '';
  }
  function saveEdit(kind, id) {
    const box = q('modalBox');
    const tpl = q('etTpl') ? q('etTpl').value : '';
    const schema = schemaFor(kind, { tpl });
    const obj = { id: id || uid() };
    if (tpl) obj.tpl = tpl;
    for (const f of schema) {
      const el = box.querySelector(`[data-k="${f.k}"]`);
      if (!el) continue;
      let v = el.value;
      if (f.t === 'tags') v = tagsToArr(v);
      if (v !== '' && v !== undefined) obj[f.k] = (f.t === 'tags' ? v : (f.t === 'number' ? (v === '' ? undefined : Number(v)) : v));
    }
    if (!obj.name && kind !== 'logs') { toast('请填写名称', 'err'); return; }
    const arr = S.data.entities[kind] || (S.data.entities[kind] = []);
    if (id) {
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr[i] = normFields(kind, obj);
    } else {
      arr.unshift(normFields(kind, obj));
    }
    pushAudit(id ? 'update' : 'create', kind, obj.name || '未命名');
    closeModal(); persist(); switchView(kind);
  }

  /* ========== AI 助手（聊天 + 生成/润色） ========== */
  const CH = [];
  const CH_CAP = 200;
  function persistChat() {
    if (!S.settings) return;
    try { S.settings.chat = CH.slice(-CH_CAP); persist(); } catch (_) {}
  }
  function renderAI() {
    const allowTools = (S.settings && S.settings.ai && S.settings.ai.allowTools);
    let html = `<div class="page-title"><h2>AI 助手</h2><span class="hint">人设：${S.activeProfile ? esc(S.activeProfile.name) : '未配置'} · 字段 schema 已自动注入 · 右侧抽屉可随时对话${allowTools ? ' · 文件上传已开启' : ''}</span></div>`;
    html += `<div class="toolbar">
      <select id="aiGenType" onchange="WB.setAiGenType(this.value)" title="选择要生成的实体类型">
        <option value="npc">NPC</option>
        <option value="pc">人物卡</option>
        <option value="region">地区</option>
        <option value="log">日志</option>
        <option value="mob">怪物</option>
      </select>
      <button class="ghost" onclick="WB.aiGenForType()">⚡ 按类型生成</button>
      <button class="ghost" onclick="WB.aiGen('请把上面讨论的内容润色得更适合直接采用。')">润色上一段</button>
      <button class="ghost" onclick="WB.aiGen('请续写一段新的剧情线索/钩子，供下次开团使用。')">续写剧情</button>
      <button class="ghost" onclick="WB.plotSummary()" title="从近期对话与日志提炼剧情要点，一键写入长期记忆">☉ 剧情要点</button>
      <button class="ghost" onclick="WB.storySuggest()" title="从近期会话/日志提炼 NPC 与剧情点建议，预览确认后写入工作台">☷ 剧情建议</button>
      <button class="ghost" onclick="WB.aiImportLast()">⇥ 把回复建为资料卡</button>
      ${allowTools ? '<button class="ghost" onclick="WB.aiUpload()">📎 添加附件</button><button class="ghost" onclick="WB.aiExportLast()">⬇ 导出 .txt</button>' : ''}
      <span class="grow"></span>
      <button class="ghost" onclick="WB.openAiLedger()" title="查看每次 AI 写入工作台的记录，可逐条/全部回滚">🧾 AI 落地记录</button>
      <button class="ghost" onclick="WB.openChat(true)">⇄ 打开侧栏对话</button>
      <button class="danger" onclick="WB.aiClear()">清空对话</button></div>`;
    html += `<div class="chatwrap"><div class="chatlog" id="chatlog"></div>
      <div class="chatinput"><div id="pendFilesAI" class="pend-slot"></div><textarea id="aiIn" class="autoarea" maxlength="60000" rows="1" placeholder="向 ${S.activeProfile ? esc(S.activeProfile.name) : '你的 AI'} 提问…${allowTools ? '（📎 添加附件后可附带你的额外要求一并发送；支持文字文件，暂不支持图片识别）' : '（文件上传功能需在「AI 配置」开启「允许文件上传工具」）'}"></textarea>
      <button onclick="WB.aiSend()">发送</button></div></div>`;
    contentInner(html);
    q('aiIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); WB.aiSend(); } });
    refreshChat();
    renderPendStrip();
  }
  /* 把聊天记录渲染进任意日志容器 */
  function lastAIIndex() { for (let i = CH.length - 1; i >= 0; i--) if (CH[i].role === 'assistant') return i; return -1; }
  /* 单条消息 HTML：与旧全量拼接保持一致，仅把“建卡按钮是否挂在最新助手消息上”抽出来 */
  function chatMsgHTML(m, i, isLastAi) {
    if (m.role === 'user') {
      if (Array.isArray(m.files) && m.files.length) {
        const chips = m.files.map(x => `<span class="msg-file">📎 ${esc(x.name)}</span>`).join('');
        const req = m.fileReq ? `<div class="msg-req">${renderInline(m.fileReq)}</div>` : '';
        return `<div class="msg user"><div class="msg-files">${chips}</div>${req}</div>`;
      }
      return `<div class="msg user">${renderInline(m.content)}</div>`;
    }
    let b = `<div class="msg ai">${renderInline(m.content)}`;
    if (m.embed) b += `<div class="embed">${esc(m.embed)}</div>`;
    if (isLastAi && !S.aiBusy) b += `<div class="ai-actions"><button class="ghost small" onclick="WB.aiImportLast()">⇥ 把这条建为工作台资料卡</button></div>`;
    return b + `</div>`;
  }
  /* 增量渲染聊天：每个容器用 data-msgcount 记录已渲染消息数。
   * 首屏(节点新建)整段重建；之后只 insertAdjacentHTML 追加新消息，不再全量替换 innerHTML。
   * 滚动仅当“有新增内容”才滚底，用户停在历史中时保持阅读位置。 */
  function paintChatInto(log) {
    if (!log) return;
    const li = lastAIIndex();
    const rendered = parseInt((log.dataset && log.dataset.msgCount) || '0', 10) || 0;
    if (rendered === 0) {
      log.innerHTML = chatHintHtml() + CH.map((m, i) => chatMsgHTML(m, i, i === li)).join('');
      log.dataset.msgCount = String(CH.length);
      if (S.aiBusy) log.insertAdjacentHTML('beforeend', '<div class="msg ai think-ind" style="color:var(--ink-faint)">思考中…</div>');
      log.scrollTop = log.scrollHeight;
      return;
    }
    let appended = false;
    if (rendered < CH.length) {
      const appendingAi = CH.slice(rendered).some(m => m.role === 'assistant');
      if (appendingAi) log.querySelectorAll('.ai-actions').forEach(n => n.remove()); // 新助手消息到位，旧“建卡”按钮让位
      const frag = [];
      for (let i = rendered; i < CH.length; i++) frag.push(chatMsgHTML(CH[i], i, i === li));
      log.insertAdjacentHTML('beforeend', frag.join(''));
      log.dataset.msgCount = String(CH.length);
      appended = true;
    }
    const think = log.querySelector('.think-ind');
    if (S.aiBusy && !think) { log.insertAdjacentHTML('beforeend', '<div class="msg ai think-ind" style="color:var(--ink-faint)">思考中…</div>'); appended = true; }
    else if (!S.aiBusy && think) { think.remove(); appended = true; }
    if (appended) log.scrollTop = log.scrollHeight; // 仅新增内容才滚底，否则保持原位
  }
  /* 同时刷新 AI 助手页与侧栏抽屉 */
  let _paintedLen = -1;
  function refreshChat() {
    paintChatInto(q('chatlog'));
    paintChatInto(q('drawerLog'));
    updateDrawerProfile();
    _paintedLen = CH.length;
  }
  function paintChat() { refreshChat(); }
  function renderInline(s) { return esc(s).replace(/\n/g, '<br>'); }
  async function aiSend(text) {
    if (S.aiBusy) return;
    const t = (typeof text === 'string' && text.length) ? text : ((q('drawerIn') ? q('drawerIn').value : '') || (q('aiIn') ? q('aiIn').value : ''));
    const hasFiles = Array.isArray(S.pendFiles) && S.pendFiles.length;
    const typed = (t || '').trim();
    if (!typed && !hasFiles) return;
    let content, atts = null, fileReq = '';
    if (hasFiles) {
      atts = S.pendFiles.map(f => ({ name: f.name, chars: f.chars, ext: f.ext }));
      fileReq = typed.slice(0, 30000);
      content = buildAttachMessage(S.pendFiles, typed);
    } else {
      content = typed.slice(0, 60000);
    }
    // 清空输入框与待发附件
    if (q('drawerIn')) q('drawerIn').value = '';
    if (q('aiIn')) q('aiIn').value = '';
    autosize(q('drawerIn')); autosize(q('aiIn'));
    S.pendFiles = [];
    renderPendStrip();
    const msg = { role: 'user', content };
    if (atts) { msg.files = atts; msg.fileReq = fileReq; }
    CH.push(msg);
    S.aiBusy = true; refreshChat();
    try {
      const r = await window.api.aiChat(CH);
      CH.push({ role: 'assistant', content: r.content });
    } catch (e) {
      const er = eiAIErr(e);
      CH.push({ role: 'assistant', content: '【AI 请求失败】' + er.msg + (er.cfg ? '（点上方⚙可直达「AI 配置」）' : '') });
    }
    S.aiBusy = false; refreshChat();
    persistChat();
  }
  /* 把「待发送附件 + 用户附加要求」组装成发给 AI 的文本：
   * 短文件内联全文，长文件内联开头并指引用 read_uploaded_file 分段读全，稳妥兼顾超长文本。 */
  function buildAttachMessage(files, typed) {
    const parts = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i], body = String(f.content || '');
      const cap = i === 0 ? 30000 : 12000;   // 首文件给更多余量
      if (body.length <= cap) {
        parts.push('【附文件『' + f.name + '』】\n' + body);
      } else {
        parts.push('【附文件『' + f.name + '』】\n' + body.slice(0, cap)
          + '\n…（文件较长，已附开头。如需完整处理，请调用 read_uploaded_file 工具读取 name="' + f.name + '"；长文件它支持用 offset 参数分段读完全部内容）');
      }
    }
    const req = (typed && typed.length)
      ? '用户附加要求：\n' + typed.slice(0, 30000)
      : '请阅读上述可读文件，充分理解后按要求整理 / 分析要点（可结合工作台现有资料），并给出可直接采用的回复。';
    return parts.join('\n\n') + '\n\n' + req;
  }
  /* 待发送附件的界面条：同时渲染到 AI 助手页与侧栏抽屉两处输入框上方 */
  function pendStripHtml() {
    const fs = Array.isArray(S.pendFiles) ? S.pendFiles : [];
    if (!fs.length) return '';
    const chips = fs.map((f, i) =>
      `<span class="pend-chip" title="${esc(f.name)}（${fmtNum(f.chars)} 字）">📎 ${esc(f.name)}<span class="hint"> · ${fmtNum(f.chars)}字</span><button class="pend-x" onclick="WB.removePendFile(${i})" title="移除">×</button></span>`
    ).join('');
    return `<div class="pend-strip">${chips}<button class="ghost small" onclick="WB.clearPendFiles()">全部移除</button></div>`;
  }
  function renderPendStrip() {
    const html = pendStripHtml();
    for (const id of ['pendFiles', 'pendFilesAI']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.innerHTML = html;
      el.hidden = !html;
    }
  }
  function removePendFile(i) {
    if (Array.isArray(S.pendFiles) && S.pendFiles[i]) S.pendFiles.splice(i, 1);
    renderPendStrip();
  }
  function clearPendFiles() { S.pendFiles = []; renderPendStrip(); }
  async function aiGen(prompt) { await aiSend(prompt); }
  /* 按所选类型生成对应实体卡（结构化落地的入口） */
  function setAiGenType(v) { S.aiGenType = v; }
  /* 抽取最近若干条对话作为建卡上下文，避免凭空随机建卡 */
  function chatContextText(n) {
    if (!CH || !CH.length) return '';
    return CH.slice(-(n || 12)).map((m) => (m.role === 'user' ? '【使用者】' : '【AI】') + '：' + String(m.content || '')).join('\n');
  }
  function aiGenForType() {
    const t = S.aiGenType || 'npc';
    const ctx = chatContextText(12);
    const head = ctx ? '请结合我们上面这段对话/待处理内容来创作，从中提取相关信息，不要凭空随机编造：\n\n' + ctx.slice(-6000) + '\n\n—— 基于以上内容，' : '请为当前工作台';
    const p = {
      npc: head + '生成一份新的 NPC：名称、身份/职业、阵营/组织、所在地区、性格、外貌、秘密与动机。请用自然语言列要点。',
      pc: head + '生成一份新的人物卡（PC）：姓名、玩家、称号、等级、属性速写、技能、伤势与状态。请用自然语言列要点。',
      region: head + '生成一个新的地区：名称、类型、区域规模、危险度、环境、距离圈、掩护、描述、补给与关键地点。请用自然语言列要点。',
      log: head + '生成一条新的跑团日志：标题、开团日期、剧情摘要、当前钩子、出场角色与状态。请用自然语言列要点。',
      mob: head + '生成一个新的怪物：名称、类别、层级、等级、生命值、护甲、伤害、特性与弱点。请用自然语言列要点。'
    };
    aiSend(p[t]);
  }
  /* 读取本地文字文件并「加入待发送附件」（不再立即发送）：
   * 上传后先不把全文塞给 AI，而是显示在输入框上方的附件区，由用户补写额外要求后一并发送。 */
  async function aiUpload() {
    const allow = S.settings && S.settings.ai && S.settings.ai.allowTools;
    if (!allow) { toast('工具调用未开启，请在「AI 配置」开启「允许文件上传工具」', 'err'); return; }
    let f;
    try { f = await window.api.openFile(); } catch (e) { toast('无法读取文件：' + ((e && e.message) || e), 'err'); return; }
    if (!f || f.canceled) return;
    if (f.image) { toast('当前工作台 AI 无图片识别（识图）功能，请使用文字类文件', 'err'); return; }
    if (!f.ok) { toast('读取失败：' + (f.error || '未知错误'), 'err'); return; }
    const name = f.name || '上传文件.txt';
    const content = f.content || '';
    // 存盘并登记到 AI 可读列表：主进程会对文件名清洗，取其清洗后名并全程复用，
    // 保证 buildAttachMessage 指示 AI 调 read_uploaded_file 时用的 name 与登记名一致（否则长文件分段读取会“查不到文件”）
    let stName = name;
    try {
      const up = await window.api.saveUpload(name, content);
      if (!up || !up.ok) toast('本地保存失败：' + ((up && up.error) || '未知错误'), 'warn');
      else if (up.name) stName = up.name;
    } catch (_e) { /* 附件本体仍可内联发送，不必中断 */ }
    const ext = (name.split('.').pop() || '').toLowerCase();
    S.pendFiles = S.pendFiles || [];
    S.pendFiles.push({ id: uid(), name: stName, ext, chars: content.length, content });
    renderPendStrip();
    const inp = q('aiIn') || q('drawerIn');
    if (inp) inp.focus();
    toast('已添加附件「' + stName + '」，可继续输入你的额外要求后发送', 'ok');
  }
  /* 导出 AI 整理的内容（本次对话全文）为 .txt —— 含 AI 归纳的背景、规则、设定等（工具开启时可用） */
  async function aiExportLast() {
    if (!CH.length) { toast('暂无可导出的内容，先与 AI 对话', 'err'); return; }
    const head = 'KP 跑团工作台 · AI 内容整理导出\n主题：' + (S.settings && S.settings.appName || '残火纪') +
      '\n导出时间：' + new Date().toLocaleString('zh-CN') + '\n================================\n\n';
    const body = CH.map((m, i) => {
      const who = m.role === 'user' ? '你（KP）' : 'AI 整理';
      return '【' + who + ' #' + (i + 1) + '】\n' + String(m.content || '');
    }).join('\n\n');
    try {
      const r = await window.api.saveText('AI内容整理_' + new Date().toISOString().slice(0, 10) + '.txt', head + body);
      if (r.ok) toast('已导出：' + r.path, 'ok');
    } catch (e) { toast('导出失败：' + ((e && e.message) || e), 'err'); }
  }

  /* ========== 批次C：AI 自动产出 + 会话记忆沉淀 ========== */
  /* 汇总“近期故事素材”：最近 40 条对话 + 最近 10 条日志 */
  function recentStoryText(maxChars) {
    const parts = [];
    const chat = CH.slice(-40).map(m => (m.role === 'user' ? '【KP】' : '【AI】') + '：' + String(m.content || '')).join('\n');
    if (chat.trim()) parts.push('—— 近期 AI 对话 ——\n' + chat);
    const logs = ((S.data.entities && S.data.entities.logs) || []).slice(0, 10);
    if (logs.length) {
      parts.push('—— 已有日志 ——\n' + logs.map(l => '『' + (l.name || l.title || '未命名日志') + '』' + [l.summary, l.content, l.hook, l.note].filter(Boolean).join(' · ').slice(0, 300)).join('\n'));
    }
    return parts.join('\n\n').slice(0, maxChars || 32000);
  }
  /* C1/C3：一键剧情要点总结 → 预览可编辑 → 写入长期记忆 */
  async function plotSummary(fromHint) {
    const content = recentStoryText(32000);
    if (!content.trim()) { toast('暂无可总结的内容：先与 AI 对话或添加日志', 'err'); return; }
    toast('正在提炼剧情要点…');
    try {
      const r = await window.api.plotSummary(content, memoryText());
      if (!r || !r.ok) { toast('总结失败：' + ((r && r.error) || '未知错误'), 'err'); return; }
      const pts = (r.points || []).filter(s => s && String(s).trim());
      if (!pts.length) { toast('AI 暂未提炼出要点（内容可能太短）', 'err'); return; }
      const mask = q('modalMask'); const box = q('modalBox');
      box.innerHTML = `<h3>剧情要点 · 沉淀长期记忆</h3>
        <div class="note">AI 从近期对话/日志提炼的要点如下，可增删修改；确认后逐条写入「AI 配置 → 长期记忆」，每次对话自动注入。${fromHint ? '（已忽略此前提示，下次超过阈值会再次提醒）' : ''}</div>
        <div class="row full"><textarea id="plotPts" class="autoarea" rows="9" style="min-height:160px">${esc(pts.join('\n'))}</textarea></div>
        <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button><button onclick="WB.commitPlotPoints()">✓ 写入长期记忆</button></div>`;
      mask.hidden = false;
      setTimeout(() => { const el = q('plotPts'); if (el) el.focus(); }, 30);
    } catch (e) { toast('总结失败：' + aiErrText(e), 'err'); }
  }
  /* 长期记忆条目统一为 { text, t } 结构；兼容历史字符串条目，按文本去重。
     抽为纯函数，便于回归测试覆盖（见 commitPlotPoints）。 */
  function mergeMemoryEntries(mem, lines) {
    const now = new Date().toISOString();
    const exist = new Set(mem.map(x => String((x && x.text != null ? x.text : x) || '').trim()).filter(Boolean));
    let added = 0;
    for (const s of lines) {
      const t = String(s || '').trim();
      if (!t || exist.has(t)) continue;
      mem.push({ text: t, t: now }); exist.add(t); added++;
    }
    return added;
  }
  function commitPlotPoints() {
    const ta = q('plotPts');
    const lines = String(ta && ta.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) { toast('没有可写入的内容', 'err'); return; }
    aiLandBefore('AI 沉淀长期记忆'); // C2：写入前快照
    const added = mergeMemoryEntries(getMemory(), lines);
    S.settings.chatSumAt = CH.length; /* 先更新再落盘，避免重启后重复弹出沉淀提示 */
    closeModal();
    persist(); paintLongMemoryList(); refreshChat();
    aiLandCommit(); // C2：沉淀完成，登记落地记录
    toast(added ? '已写入长期记忆 ' + added + ' 条' : '内容均已在长期记忆中，无新增', 'ok');
  }
  /* C2：会话/日志 → NPC 与剧情点建议 → 预览确认入工作台 */
  async function storySuggest() {
    const content = recentStoryText(32000);
    if (!content.trim()) { toast('暂无可分析的内容：先与 AI 对话或添加日志', 'err'); return; }
    toast('正在分析 NPC 与剧情点…');
    try {
      const r = await window.api.suggestStory(content);
      if (!r || !r.ok) { toast('建议失败：' + ((r && r.error) || '未知错误'), 'err'); return; }
      const res = r.result && r.result.entities;
      const npcN = ((res && res.npcs) || []).length, logN = ((res && res.logs) || []).length;
      if (!npcN && !logN) { toast('AI 暂未提出新 NPC/剧情点（可能都已登记）', 'err'); return; }
      openScriptPreview(r.result, 'auto', `AI 从近期会话/日志提炼的建议：NPC ${npcN} 条 · 剧情点 ${logN} 条。勾选确认后才写入工作台；已有同名条目会自动跳过。`);
    } catch (e) { toast('建议失败：' + aiErrText(e), 'err'); }
  }
  /* C3：忽略“对话过长”提示，直到累计条数再次增长 */
  function dismissChatHint() { S.settings.chatSumAt = CH.length; persist(); refreshChat(); }
  /* 对话过长提示条：累计 ≥30 条且自上次处理后又增长时显示 */
  function chatHintHtml() {
    if (!S.settings) return '';
    const n = CH.length;
    const th = S.settings.chatSumAt || 0;
    if (n < 30 || th >= n) return '';
    return `<div class="chat-hint">对话已累计 ${n} 条，较早内容将被自动压缩。建议把要点沉淀进长期记忆：<button class="ghost small" onclick="WB.plotSummary(true)">☉ 总结并沉淀</button><button class="ghost small" onclick="WB.dismissChatHint()">忽略</button></div>`;
  }

  /* ========== 侧栏常驻 AI 对话抽屉 ========== */
  function openChat(force) {
    const d = q('chatdrawer');
    const show = (typeof force === 'boolean') ? force : d.hidden;
    d.hidden = !show;
    if (show) { S.settings.chatOpen = true; if (q('drawerIn')) q('drawerIn').focus(); }
    else S.settings.chatOpen = false;
    if (CH.length !== _paintedLen) refreshChat(); // 内容没变只切换显隐/人设，跳过无意义重建
    if (window.api) persist();
  }
  function updateDrawerProfile() {
    const el = q('drawerProfile'); if (!el) return;
    el.textContent = S.activeProfile ? '人设 · ' + S.activeProfile.name : '人设 · 未配置';
  }

  /* ========== AI 回复 → 工作台资料卡（可确认） ========== */
  function lastAssistant() { for (let i = CH.length - 1; i >= 0; i--) if (CH[i].role === 'assistant') return CH[i].content; return ''; }
  async function aiImportLast() {
    const c = lastAssistant();
    if (!c) { toast('暂无可导入的 AI 回复，先让 AI 生成一段内容', 'err'); return; }
    toast('正在从回复中提取资料卡…');
    try {
      const r = await window.api.aiParse(c);
      openScriptPreview(r, 'auto', '已把回复拆解为下方资料卡，勾选确认后才写入工作台；也可直接取消。');
    } catch (e) {
      toast('提取失败：' + ((e && e.message) || e), 'err');
    }
  }
  /* 打开“资料卡预览/确认入台”弹窗；type 为预设导入类型（'auto' 则不预设） */
  function openScriptPreview(r, type, note) {
    S.scriptPreview = r;
    S.splitSource = '剧本解析';
    const mask = q('modalMask'); const box = q('modalBox');
    const tplOpts = tplList().map(t => `<option value="${esc(t.id)}"${t.id === (S.importTpl || '') ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
    box.innerHTML = `<h3>AI 生成的资料卡</h3>
      <div class="note">${esc(note || '已把内容拆解为下方资料卡，勾选确认后才写入工作台。')}</div>
      <div class="row"><label style="display:inline-block;min-width:100px">导入为</label>
      <select id="impType">
        <option value="auto">自动（全部保留）</option>
        ${KINDS.map(k => `<option value="${k}">仅 ${DATA_TYPE[k]}</option>`).join('')}
      </select></div>
      <div class="row"><label style="display:inline-block;min-width:100px">卡片模板</label>
      <select id="impTpl" onchange="WB.setImportTpl(this.value)" title="为导入的人物/NPC/怪物卡挂上选定的规则书模板（决定其显示字段集，如 CoC/DnD）">
        <option value="">不套模板（用全局字段）</option>${tplOpts}</select>
      <span class="hint">导入的人物/NPC/怪物卡将按所选模板显示字段（如力量、理智等）。</span></div>
      <div id="scriptOut">${previewHTML(r)}</div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button>
      <button onclick="WB.commitScript()">✓ 确认添加</button></div>`;
    mask.hidden = false;
    const sel = q('impType');
    if (type && type !== 'auto') { sel.value = type; sel.onchange = () => {}; }
    const it = q('impTpl'); if (it && S.importTpl) it.value = S.importTpl;
  }

  /* ========== C2：AI 落地审批与一键回滚 ==========
   * 每次 AI 写入工作台前，自动把「可写数据」整体留一份快照，登记进「AI 落地记录」，
   * 之后可在面板里对某一次 AI 落地逐条回滚，或一键全部回滚到最早那一次前的状态。
   * 快照包含：7 类资料卡、地图、关系网、长期记忆。AI 落地 = 生成/解析写入、地图采纳、
   * 长期记忆沉淀、关系应用等"AI 把内容真正写进工作台"的动作。 */
  function aiSnapCore(d) { return JSON.parse(JSON.stringify(d || {})); }
  function aiLedgerArr() { if (!S.settings) S.settings = {}; if (!Array.isArray(S.settings.aiLedger)) S.settings.aiLedger = []; return S.settings.aiLedger; }
  function aiLandCtx() {
    return {
      entities: S.data.entities,
      maps: S.data.maps || [],
      relations: S.data.relations,
      memory: (S.settings && Array.isArray(S.settings.memory)) ? S.settings.memory : []
    };
  }
  let _aiLandPending = null;
  /* 在 AI 写入前调用，登记本次动作；写入完成后必须配 aiLandCommit() 才算完成一次落地 */
  function aiLandBefore(action) { _aiLandPending = { action: action || 'AI 写入', t: Date.now(), snap: aiSnapCore(aiLandCtx()) }; }
  /* 本次落地结尾调用：把登记的快照写进记录列表并持久化 */
  function aiLandCommit(extra) {
    if (!_aiLandPending) return false;
    const entry = Object.assign({ id: uid() }, _aiLandPending, extra || {});
    _aiLandPending = null;
    const L = aiLedgerArr();
    L.unshift(entry);
    if (L.length > 50) L.length = 50;
    if (window.api) persist();
    return true;
  }
  /* 取消本次登记（写入中途失败或未发生，不落地积累脏快照） */
  function aiLandCancel() { _aiLandPending = null; }
  function aiLandEntry(id) { return aiLedgerArr().find(e => e.id === id) || null; }
  /* 把快照还原回 S：通用还原，供逐条/全部回滚复用 */
  function aiRestoreSnap(s) {
    if (!s) return false;
    if (s.entities) S.data.entities = s.entities;
    if (s.maps) S.data.maps = s.maps;
    if (s.relations) S.data.relations = s.relations;
    if (s.memory && S.settings) S.settings.memory = s.memory;
    return true;
  }
  /* 逐条回滚：把工作台数据还原到"该次 AI 落地前"的状态，并从记录中移除该项 */
  function aiLandRevert(id) {
    const L = aiLedgerArr();
    const i = L.findIndex(e => e.id === id);
    if (i < 0) { toast('找不到该落地记录', 'err'); return false; }
    const entry = L[i];
    if (!aiRestoreSnap(entry.snap)) { toast('记录快照缺失，无法回滚', 'err'); return false; }
    L.splice(i, 1);
    pushAudit('rollback', 'AI', entry.action || 'AI 落地');
    if (window.api) persist();
    return true;
  }
  /* 全部回滚到"最早一次 AI 落地前"：取最旧那条的快照整体还原，再清空记录 */
  function aiLandRevertAll() {
    const L = aiLedgerArr();
    if (!L.length) { toast('暂无可回滚的 AI 落地记录', ''); return false; }
    const s = L[L.length - 1].snap;
    if (!aiRestoreSnap(s)) { toast('快照缺失，无法回滚', 'err'); return false; }
    const n = L.length;
    S.settings.aiLedger = [];
    pushAudit('rollback', 'AI', '全部 AI 落地 × ' + n);
    if (window.api) persist();
    return true;
  }
  /* 打开「AI 落地记录」面板：列出历史，主按钮支持逐条回滚 / 全部回滚 */
  function openAiLedger() {
    const L = aiLedgerArr();
    const mask = q('modalMask'); const box = q('modalBox');
    const fmt = (ms) => { const d = new Date(ms); return d.getMonth() + 1 + '-' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
    let rows;
    if (!L.length) rows = '<div class="empty">还没有 AI 落地记录。每次 AI 写入工作台（生成/解析资料卡、采纳地图、沉淀长期记忆、应用关系…）前都会自动留一份快照，可在此一键回滚。</div>';
    else {
      rows = L.map((e, i) => `<div class="ai-ledger-row">
        <div class="ai-ledger-ico">${i === 0 ? '🆕' : '↩'}</div>
        <div class="ai-ledger-meta"><div class="ai-ledger-act">${esc(e.action || 'AI 写入')}</div>
        <div class="hint">${fmt(e.t)}</div></div>
        <span class="grow"></span>
        <button class="ghost small" onclick="WB.aiLandRevert('${e.id}')" title="还原到本次 AI 落地前">↩ 回滚</button></div>`).join('');
    }
    box.innerHTML = `<h3>AI 落地记录</h3>
      <div class="note">AI 每次把内容真正写进工作台前都会自动快照。下方按时间倒序列出；点「回滚」可把数据还原到该次落地前。回滚是对整体数据的还原（含资料/地图/关系/长期记忆），请确认不影响已手动新增的内容。</div>
      <div class="ai-ledger-list" style="max-height:50vh;overflow:auto">${rows}</div>
      <div class="foot">
        <button class="ghost" onclick="WB.closeModal()">关闭</button>
        <span class="grow"></span>
        <button class="danger ${L.length ? '' : 'hidden'}" onclick="WB.aiLandRevertAll()" title="还原到最早一次 AI 落地前的状态">↩ 全部回滚（${L.length}）</button>
      </div>`;
    mask.hidden = false;
  }

  /* ========== C3：交叉引用 + 一致性检查 ==========
   * 交叉引用：扫描全部资料卡正文，统计「哪些卡提到了目标卡的名字」，
   * 在资料卡上显示「被 N 处提及」并可一键跳到提及它的卡片。
   * 一致性检查：自动排查重名、关系网悬空连线、缺失/离群字段等结构问题，
   * 产出可读清单并支持一键跳到问题卡片。 */
  function entityNameOf(it) { return String(it.name != null ? it.name : (it.title || '')).trim(); }
  /* 检索文本缓存：以卡片对象本身为键。编辑保存、导入、AI 写入都是用新对象替换数组里的旧对象，
   * 所以缓存会自动失效，不需要任何手工清空，也就不会读到过期文本。 */
  const _entText = new WeakMap();
  function _entCached(it, key, make) {
    const o = it || {};
    let rec = _entText.get(o);
    if (!rec) { rec = {}; _entText.set(o, rec); }
    if (rec[key] === undefined) rec[key] = make(o);
    return rec[key];
  }
  /* 取一张卡用于“被引用全文扫描”的文本串（含名字与全部 string 字段值）
   * 缓存：渲染一屏卡片会反复问到同一批卡，原先每张卡都重新拼一遍全部实体，改为按对象取一次。 */
  function entitySearchText(kind, it) {
    return _entCached(it, 'mention', (o) => {
      const parts = [entityNameOf(o)];
      for (const k in o) {
        const v = o[k];
        if (k === 'id' || k === 'tpl' || k === 'source' || k === 'at' || Array.isArray(v)) continue;
        if (typeof v === 'string' && v) parts.push(v);
      }
      return parts.join('\n');
    });
  }
  /* 全局搜索用的可检索串：语义与旧的 JSON.stringify(it).toLowerCase() 完全一致（含 id、来源、
   * 标签数组等全部字段），只是构建一次后复用，不再每次按键都对全库重新序列化。
   * 注意不能复用 entitySearchText：那个按设计排除了 id/来源/模板/数组，语义不同。 */
  function entitySearchLower(it) {
    return _entCached(it, 'lower', (o) => JSON.stringify(o).toLowerCase());
  }
  /* 扫描某类资料是否“提到名字”：把候选名在目标卡全文里做整词/去空白匹配 */
  function textMentions(text, name) {
    const n = String(name || '').trim();
    if (!n || n.length < 1) return false;
    return text.indexOf(n) !== -1;
  }
  /* 交叉引用结果缓存：结果依赖全体卡片，无法按单张卡作键，因此按「代数」失效。
   * persist()（本地改动落盘）与 reloadAll()（换档案/回滚备份等外部载入）各换一代，
   * 整批结果随之作废重建，保证徽标上的数字不会过期。 */
  const _xref = { gen: 0, seen: -1, memo: new Map() };
  function _xrefBump() { _xref.gen++; }
  /* 统计 name 出现在哪些实体（kind→item）中；selfKind/selfId 用于排除自身。
   * 返回 [{kind,id,name}]。渲染一屏卡片会各问一次，排序/勾选/收藏后的重渲染还会再问一遍，
   * 同一代数据内直接复用上次结果，省掉重复的全库扫描。 */
  function xrefHits(name, selfKind, selfId) {
    if (_xref.seen !== _xref.gen) { _xref.seen = _xref.gen; _xref.memo = new Map(); }
    const key = selfKind + '\u0000' + selfId + '\u0000' + name;
    const memoed = _xref.memo.get(key);
    if (memoed) return memoed;
    const out = [];
    for (const k of KINDS) {
      const arr = S.data.entities[k] || [];
      for (const it of arr) {
        if (k === selfKind && it.id === selfId) continue;
        if (!textMentions(entitySearchText(k, it), name)) continue;
        out.push({ kind: k, id: it.id, name: entityNameOf(it) || '未命名' });
      }
    }
    _xref.memo.set(key, out);
    return out;
  }
  /* ---- A3 预建快速定位索引：命令面板/直达搜索不再每次按键跨全库重扫 ----
   * 名称按小写缓存、标签拼接、拼音首字母（覆盖常见姓氏与团务用字，其余汉字原样参加
   * 子串匹配，缺失不崩）。索引与 _xref 共用同一「代数」：persist 换档、reloadAll 换档，
   * 索引整体重建，保证 CI 后不会再读到过期数据。 */
  /* 常用汉字 → 拼音首字母：覆盖姓氏与人物/地区高频字。多音字取常见读法；未覆盖的汉字
   * 返回原字（再由上层子串匹配兜底）。纯 ASCII 直接小写，数字/空白保留。 */
  const PY_HEAD_WORDS = {
    '王':'w','李':'l','张':'z','刘':'l','陈':'c','杨':'y','黄':'h','赵':'z','吴':'w','周':'z','徐':'x','孙':'s','马':'m','朱':'z','胡':'h','郭':'g','何':'h','高':'g','林':'l','罗':'l','郑':'z','梁':'l','谢':'x','宋':'s','唐':'t','许':'x','韩':'h','冯':'f','邓':'d','曹':'c','彭':'p','曾':'z','萧':'x','田':'t','董':'d','袁':'y','潘':'p','于':'y','蒋':'j','蔡':'c','余':'y','杜':'d','叶':'y','程':'c','苏':'s','魏':'w','吕':'l','丁':'d','任':'r','沈':'s','姚':'y','卢':'l','姜':'j','崔':'c','钟':'z','谭':'t','陆':'l','汪':'w','范':'f','金':'j','石':'s','廖':'l','贾':'j','夏':'x','韦':'w','傅':'f','方':'f','白':'b','邹':'z','孟':'m','秦':'q','邱':'q','江':'j','尹':'y','薛':'x','阎':'y','段':'d','雷':'l','侯':'h','龙':'l','史':'s','陶':'t','黎':'l','贺':'h','顾':'g','毛':'m','郝':'h','龚':'g','邵':'s','万':'w','钱':'q','严':'y','覃':'q','武':'w','戴':'d','莫':'m','孔':'k','向':'x','汤':'t','艾':'a','毕':'b','樊':'f','筋':'j','阮':'r','柳':'l','常':'c','岳':'y','安':'a','柏':'b','蓝':'l','倪':'n','娄':'l','甘':'g','祝':'z','屠':'t','申':'s','闻':'w','卞':'b','官':'g','曲':'q','谷':'g','贝':'b','车':'c','乔':'q','晁':'c','奥':'a','奥古':'a','凯':'k','里':'l','斯':'s','德':'d','弗':'f','格':'g','拉':'l','莱':'l','特':'t','希':'x','安泽':'a','艾尔':'a','维':'w','莉':'l','娜':'n','伊':'y','卡':'k','洛':'l','丝':'s','蒂':'d','露':'l','西':'x','恩':'e','克':'k','尔':'e','伦':'l','德':'d','奥':'a','蒙':'m'
  };
  function pyInitials(str) {
    const s = String(str || '');
    let out = '';
    for (const ch of s) {
      if (/[a-z0-9]/.test(ch)) { out += ch; continue; }
      if (/[A-Z]/.test(ch)) { out += ch.toLowerCase(); continue; }
      if (/\s/.test(ch)) { continue; }
      const w = PY_HEAD_WORDS[ch];
      if (w) out += w;
    }
    return out;
  }
  const _loc = { gen: -1, byKind: {} };   // byKind[kind] = [{id, lo, tag, py}]
  function _locBuild() {
    if (_loc.gen === _xref.gen) return _loc.byKind;
    _loc.gen = _xref.gen; _loc.byKind = {};
    for (const k of KINDS) {
      const box = [];
      for (const it of (S.data.entities[k] || [])) {
        const nm = entityNameOf(it);
        if (!nm) continue;
        box.push({ id: it.id, lo: nm.toLowerCase(), tag: (it.tags || []).join(' ').toLowerCase(), py: pyInitials(nm) });
      }
      if (box.length) _loc.byKind[k] = box;
    }
    return _loc.byKind;
  }
  /* 名/标签/拼音一次判定：命中任一即算匹配（对一屏命令面板候选足够快） */
  function _locHit(e, q) {
    if (!q) return true;
    if (e.lo && e.lo.indexOf(q) !== -1) return true;
    if (e.tag && e.tag.indexOf(q) !== -1) return true;
    if (e.py && e.py.indexOf(q) !== -1) return true;
    return false;
  }
  /* 在卡片网格上渲染“被 N 处提及”徽标；点击打开提及列表弹窗 */
  function xrefBadgeHTML(name, selfKind, selfId) {
    const hits = xrefHits(name, selfKind, selfId);
    if (!hits.length) return '';
    return `<span class="xref-badge" onclick="WB.xrefOpen('${escJs(selfKind)}','${escJs(selfId)}')" title="被 ${hits.length} 处提及，点击查看">⇄ 引用 ${hits.length}</span>`;
  }
  /* 打开“被引用”弹窗：列出提及它的卡，点击跳转并高亮 */
  function xrefOpen(kind, id) {
    const it = (S.data.entities[kind] || []).find(x => x.id === id);
    if (!it) return;
    const name = entityNameOf(it);
    const hits = xrefHits(name, kind, id);
    const mentions = xrefMentions(kind, id);
    const mask = q('modalMask'); const box = q('modalBox');
    const rowFor = h =>
      `<div class="xref-row"><span class="ctag">${esc(DATA_TYPE[h.kind])}</span>
        <span class="xref-name">${esc(h.name)}</span>
        <span class="grow"></span>
        <button class="ghost small" onclick="WB.xrefGo('${h.kind}','${h.id}')">跳到 →</button></div>`;
    const inboundRows = hits.length ? hits.map(rowFor).join('')
      : '<div class="empty">没有被其他资料提及</div>';
    const outboundRows = mentions.length ? mentions.slice(0, 120).map(rowFor).join('')
      : '<div class="empty">正文里没有提及其他资料</div>';
    const canImport = kind === 'npcs' || kind === 'pcs' || kind === 'mobs';
    box.innerHTML = `<h3>“${esc(name)}”双向引用</h3>
      <div class="note">被引用：以下资料卡的正文里提到了「${esc(name)}」。我引用：这张卡正文里提到了以下资料。</div>
      <div class="xref-sec"><div class="xref-sec-title">被引用（${hits.length}）</div>
        <div class="xref-list" style="max-height:24vh;overflow:auto">${inboundRows}</div></div>
      <div class="xref-sec" style="margin-top:10px"><div class="xref-sec-title">我引用（${mentions.length}）${mentions.length > 120 ? '，仅显示前 120 条' : ''}</div>
        <div class="xref-list" style="max-height:24vh;overflow:auto">${outboundRows}</div></div>
      <div class="foot" style="display:flex;gap:8px;align-items:center">${canImport ? `<button class="accent small" onclick="WB.xrefGo('${kind}','${id}')">把提及关系导入关系网（${mentions.length}）</button><span class="grow"></span>` : `<span class="grow"></span>`}
        <button class="ghost" onclick="WB.closeModal()">关闭</button></div>`;
    /* 若已有节点/连线较全，导入有实际意义时启用按钮；此处直接暴露导入入口 */
    if (canImport) {
      const btn = box.querySelector('.foot button.accent');
      if (btn) btn.onclick = () => { const n = xrefImportEdges(); WB.closeModal(); switchView('relations'); relPaint(); toast('已从引用关系导入 ' + n + ' 条连线'); };
    }
    mask.hidden = false;
  }
  function xrefGo(kind, id) {
    q('modalMask').hidden = true;
    const it = (S.data.entities[kind] || []).find(x => x.id === id);
    if (it) edit(kind, id); // 编辑弹窗即算“定位/跳转”
    else { switchView(kind); }
  }
  /* 反向引用：扫描当前实体的正文提到了哪些其他实体（「我提到谁」） */
  function xrefMentions(kind, id) {
    if (_xref.seen !== _xref.gen) { _xref.seen = _xref.gen; _xref.memo = new Map(); }
    const key = 'mentions\u0000' + kind + '\u0000' + id;
    const memoed = _xref.memo.get(key);
    if (memoed) return memoed;
    const it = (S.data.entities[kind] || []).find(x => x.id === id);
    if (!it) return [];
    const text = entitySearchText(kind, it).toLowerCase();
    const out = [];
    for (const k of KINDS) {
      for (const other of (S.data.entities[k] || [])) {
        if (k === kind && other.id === id) continue;
        const nm = entityNameOf(other);
        if (!nm || nm.length < 2) continue;
        if (text.indexOf(nm.toLowerCase()) !== -1) out.push({ kind: k, id: other.id, name: nm });
      }
    }
    _xref.memo.set(key, out);
    return out;
  }
  /* 将全库提及关系批量导入为关系网连线：为引用双方自动建节点 + 建边 */
  function xrefImportEdges() {
    const r = S.data.relations || (S.data.relations = { nodes: [], edges: [] });
    if (!r.nodes) r.nodes = [];
    if (!r.edges) r.edges = [];
    const nodeMap = new Map(r.nodes.map(n => [n.label, n]));
    for (const k of KINDS) {
      for (const it of (S.data.entities[k] || [])) {
        const nm = entityNameOf(it);
        if (!nm || nodeMap.has(nm)) continue;
        const node = { id: uid(), label: nm, kind: k };
        r.nodes.push(node);
        nodeMap.set(nm, node);
      }
    }
    const existing = new Set();
    for (const e of r.edges) { existing.add(e.from + '\u0000' + e.to); existing.add(e.to + '\u0000' + e.from); }
    let added = 0;
    for (const k of KINDS) {
      for (const it of (S.data.entities[k] || [])) {
        const nm = entityNameOf(it);
        if (!nm) continue;
        const fromNode = nodeMap.get(nm);
        if (!fromNode) continue;
        for (const m of xrefMentions(k, it.id)) {
          const toNode = nodeMap.get(m.name);
          if (!toNode) continue;
          const edgeKey = fromNode.id + '\u0000' + toNode.id;
          if (!existing.has(edgeKey)) {
            r.edges.push({ id: uid(), from: fromNode.id, to: toNode.id, label: '提及' });
            existing.add(edgeKey);
            added++;
          }
        }
      }
    }
    if (added) { relSeedLayout(true); relPersist('已从引用关系导入 ' + added + ' 条连线'); }
    return added;
  }

  /* 一致性检查：返回 {ok, issues:[{lv,msg,kind,id}]}，lv ∈ warn|err */
  function consistencyScan() {
    const issues = [];
    const seen = {}; // name→{kind,id}
    for (const k of KINDS) {
      const arr = S.data.entities[k] || [];
      const names = {};
      for (const it of arr) {
        const nm = entityNameOf(it);
        if (!nm) { issues.push({ lv: 'warn', msg: DATA_TYPE[k] + ' 存在空名称条目', kind: k, id: it.id }); continue; }
        const kw = nm.toLowerCase();
        // 同类重名（去空白/大小写）
        if (names[kw]) issues.push({ lv: 'err', msg: '【重名】' + DATA_TYPE[k] + '「' + nm + '」与其他卡重名', kind: k, id: it.id });
        else names[kw] = true;
        // 跨类与先出现的卡重名
        if (seen[kw] && seen[kw].kind !== k) {
          issues.push({ lv: 'warn', msg: '【跨类重名】「' + nm + '」同时作为' + DATA_TYPE[seen[kw].kind] + '与' + DATA_TYPE[k] + '出现，可能引起混淆', kind: k, id: it.id });
        }
        if (!seen[kw]) seen[kw] = { kind: k, id: it.id };
      }
    }
    // 关系网悬空连线：连线引用不存在的节点
    const rel = S.data.relations;
    if (rel && Array.isArray(rel.edges)) {
      const nodeIds = new Set((rel.nodes || []).map(n => n.id));
      for (const e of rel.edges) {
        if (!e) continue;
        if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
          issues.push({ lv: 'err', msg: '【悬空连线】存在一端节点缺失的关系连线，关系可能显示不全', kind: 'relations', id: '' });
          break;
        }
      }
    }
    return { count: issues.length, issues };
  }
  /* 打开一致性检查弹窗 */
  function consistencyOpen() {
    const res = consistencyScan();
    const list = res.issues.length ? res.issues.map((it, i) =>
      `<div class="xref-row ck-${it.lv}"><span class="ctag">${it.lv === 'err' ? '需处理' : '提醒'}</span>
        <span class="xref-name">${esc(it.msg)}</span><span class="grow"></span>
        ${it.kind && it.id ? `<button class="ghost small" onclick="WB.xrefGo('${it.kind}','${it.id}')">跳到 →</button>` : ''}</div>`).join('')
      : '<div class="empty">未发现一致性问题，数据结构健康 ✓</div>';
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>一致性检查</h3>
      <div class="note">自动排查资料卡重名、关系网悬空连线等问题。找到 ${res.count} 项，可点击跳转处理。</div>
      <div class="xref-list" style="max-height:52vh;overflow:auto">${list}</div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">关闭</button></div>`;
    mask.hidden = false;
  }

  /* ========== 规则 / 背景 导入与 AI 整合 ========== */
  function readSmallFile(f) {
    return new Promise((res, rej) => {
      const p = (window.api && window.api.getPathForFile) ? window.api.getPathForFile(f) : (f && f.path);
      if (window.api.importFile && p) return window.api.importFile(p).then(res, rej);
      const rd = new FileReader();
      rd.onload = () => res({ ok: true, name: f.name, preview: String(rd.result || ''), size: f.size, chars: String(rd.result || '').length, type: 'text', ext: (f.name.split('.').pop() || '').toLowerCase(), huge: false });
      rd.onerror = (e) => rej(new Error('读取失败'));
      rd.readAsText(f, 'utf8');
    });
  }
  /* 把一组 File/拖拽文件解析并填充到当前打开的导入面板 */
  async function fillImport(files) {
    const meta = q('impMeta'); if (meta) meta.textContent = '正在解析 ' + files.length + ' 个文件…';
    const results = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const res = await readSmallFile(files[i]);
        if (res && res.ok) results.push(res); else if (meta) meta.textContent = files[i].name + ' 解析失败：' + ((res && res.error) || '未知');
      } catch (e) { if (meta) meta.textContent = files[i].name + ' 解析失败：' + ((e && e.message) || e); }
    }
    S.importFiles = results; S.importFile = results[0] || null;
    const ta = q('impRaw'); if (ta) ta.value = results.length ? (results[0].preview || '') : '';
    if (meta) {
      if (!results.length) meta.textContent = '文件解析失败，请重试。';
      else meta.textContent = '已解析 ' + results.length + ' 个文件 · 合计约 ' + fmtNum(results.reduce((s, r) => s + (r.chars || 0), 0)) + ' 字' + (results.length > 1 ? '（下方列出全部，预览显示第一个）' : '');
    }
    const list = q('impFileList'); if (list) list.innerHTML = results.map((r, i) =>
      `<div style="display:flex;gap:8px;align-items:center;font-size:12px;padding:2px 0;color:var(--ink-soft)">
        <span style="flex:1">${esc(r.name)}</span><span class="hint">${esc(r.type || r.ext || '文本')}</span><span class="hint">${fmtBytes(r.size)}</span><span class="hint">${fmtNum(r.chars)}字</span>
      </div>`).join('');
  }
  /* 打开导入面板；preFiles 为拖拽带入的 File 列表（可选），打开后自动解析填充 */
  async function importContent(kind, preFiles) {
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>导入${DATA_TYPE[kind]}（可多选 / 可拖入）</h3>
      <div class="note">可选择多个本地文件（txt / md / json / csv / xlsx / pdf / docx 等，单文件上限 1GB），逐个抽取解析；也可直接把文件拖到本窗口、或在此粘贴文本。可用「仅导入」「AI 分析整理」或「AI 拆分登记」。</div>
      <label class="file-label"><input type="file" id="impFile" accept=".txt,.md,.markdown,.log,.json,.yaml,.yml,.xml,.html,.htm,.csv,.xlsx,.xls,.pdf,.docx" multiple hidden>
        <span class="ghost filebtn">📄 选择文件…（可多选）</span></label>
      <div id="impMeta" class="hint" style="margin:6px 0"></div>
      <div id="impFileList" style="margin:2px 0 4px"></div>
      <div class="row full"><label>导入内容（大文件此处为预览，完整内容已存盘，供后续 AI 分析）</label><textarea id="impRaw" rows="6" placeholder="选择文件，内容会自动显示在这里；也可直接在此粘贴文本…"></textarea></div>
      <label class="toggle-row" style="display:flex;gap:10px;align-items:center;margin:6px 0">
        <input type="checkbox" id="impSupplement">
        <span><b>允许 AI 补充创作</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">默认关闭：AI 只依据导入文本实际信息分类填卡、缺失字段留空、绝不编造。勾选并经确认后才允许合理补写。</span></span>
      </label>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button>
      <button onclick="WB.doImport('${kind}')">仅导入</button>
      <button onclick="WB.doImportAndIntegrate('${kind}')">AI 分析整理</button>
      <button onclick="WB.doSplitRegister('${kind}')">AI 拆分登记</button></div>`;
    mask.hidden = false;
    const fi = q('impFile');
    if (fi) fi.addEventListener('change', (ev) => {
      const files = Array.prototype.slice.call(ev.target.files || []);
      if (files.length) fillImport(files);
    });
    if (preFiles && preFiles.length) await fillImport(preFiles);
  }
  function _impRaw(kind) {
    const ta = q('impRaw'); const raw = (ta && ta.value || '').trim();
    if (!raw) { toast('请选择文件或粘贴内容', 'err'); }
    return raw;
  }
  function _impRawVal() { const ta = q('impRaw'); return (ta && ta.value || '').trim(); }
  function _importFiles() { return (S.importFiles && S.importFiles.length) ? S.importFiles : (S.importFile ? [S.importFile] : []); }
  function doImport(kind) {
    const files = _importFiles();
    const pasted = _impRawVal();
    const arr = S.data.entities[kind] || (S.data.entities[kind] = []);
    let added = 0;
    if (files.length) {
      for (const imp of files) {
        if (imp.huge || imp.chars > 300 * 1024) {
          const name = imp.name;
          const head = '【文件导入】' + name + ' · ' + (imp.type || imp.ext) + ' · ' + fmtBytes(imp.size) + ' · 抽取 ' + fmtNum(imp.chars) + ' 字';
          const obj = { id: uid(), name, source: '文件导入' };
          if (kind === 'rules') obj.detail = head + '\n' + (imp.preview || ''); else obj.content = head + '\n' + (imp.preview || '');
          if (imp.textPath || imp.origPath) obj.files = [{ path: imp.textPath || imp.origPath, name: imp.name, size: imp.size }];
          arr.unshift(obj); pushAudit('create', kind, obj.name); added++;
        } else {
          const raw = (imp.preview || '').trim(); if (!raw) continue;
          const name = (String(raw).split(/\n/).map(s => s.trim()).filter(Boolean)[0] || imp.name || '导入内容').slice(0, 40);
          const obj = { id: uid(), name, source: '文件导入' };
          if (kind === 'rules') obj.detail = raw; else obj.content = raw;
          arr.unshift(obj); pushAudit('create', kind, obj.name); added++;
        }
      }
      S.importFiles = null; S.importFile = null;
      closeModal(); persist(); toast('已导入 ' + added + ' 个文件到「' + DATA_TYPE[kind] + '」', 'ok'); renderDataView(kind); return;
    }
    if (!pasted) { toast('请先选择文件或粘贴内容', 'err'); return; }
    const name = (String(pasted).split(/\n/).map(s => s.trim()).filter(Boolean)[0] || '导入内容').slice(0, 40);
    const obj = { id: uid(), name, source: '手动导入' };
    if (kind === 'rules') obj.detail = pasted; else obj.content = pasted;
    arr.unshift(obj); pushAudit('create', kind, obj.name);
    S.importRaw = { kind, raw: null }; S.importFile = null;
    closeModal(); persist(); toast('已导入「' + obj.name + '」，可在卡片中继续编辑', 'ok'); renderDataView(kind);
  }
  async function doImportAndIntegrate(kind) {
    const files = _importFiles();
    if (files.length) {
      closeModal();
      for (const imp of files) {
        if (imp.textPath) await analyzeFile(kind, imp);
        else {
          const raw = (imp.preview || '').trim(); if (!raw) continue;
          S.importRaw = { kind, raw }; await aiIntegrate(kind);
        }
      }
      S.importFiles = null; return;
    }
    const raw = _impRawVal();
    const imp = S.importFile || null;
    if (!raw && !imp) return;
    if (imp && (imp.huge || imp.chars > 8000) && imp.textPath) { closeModal(); await analyzeFile(kind, imp); S.importFile = null; return; }
    if (!raw) { toast('请先选择文件或粘贴内容', 'err'); return; }
    S.importRaw = { kind, raw }; closeModal(); await aiIntegrate(kind);
  }
  /* AI 拆分登记：把导入内容拆为 7 类资料卡，先预览勾选确认再写入 */
  async function doSplitRegister(kind) {
    const files = _importFiles();
    const strict = !(q('impSupplement') && q('impSupplement').checked);
    const pasted = (!files.length) ? _impRawVal() : '';
    if (!files.length && !pasted) { toast('请先选择文件或粘贴内容', 'err'); return; }
    closeModal();
    const merged = { entities: {} }; KINDS.forEach(k => merged.entities[k] = []);
    try {
      if (files.length) {
        toast('正在 AI 拆分 ' + files.length + ' 个文件…');
        for (const imp of files) {
          const src = imp.textPath ? { path: imp.textPath, preview: imp.preview || '' } : { preview: imp.preview || '' };
          const r = await runSplit(src, strict);
          if (r && r.entities) for (const k of KINDS) merged.entities[k] = merged.entities[k].concat((r.entities[k] || []));
        }
        S.importFiles = null; S.importFile = null;
      } else {
        const r = await runSplit({ preview: pasted }, strict);
        if (r && r.entities) merged.entities = r.entities;
      }
      presentSplitPreview(merged, files.length || 1);
    } catch (e) { toast('AI 拆分失败：' + aiErrText(e), 'err'); }
    }
  async function runSplit(src, strict) {
    if (src.path) return window.api.splitImport({ path: src.path, preview: src.preview || '', strict, excludePC: true });
    return window.api.aiParse(src.preview || '', { strict, excludePC: true });
  }
  function presentSplitPreview(r, count) {
    S.scriptPreview = r; S.splitSource = 'AI 拆分登记';
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>AI 拆分登记 · 请确认</h3>
      <div class="note">已把${count > 1 ? count + ' 个文件 / ' : ''}导入内容拆解为下方 7 类资料卡。请勾选要写入的条目（默认全选），确认后才写入工作台；与已有同名条目会自动跳过、不会重复。</div>
      <div id="scriptOut">${previewHTML(r)}</div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button>
      <button onclick="WB.commitScript()">✓ 确认写入选中条目</button></div>`;
    mask.hidden = false;
  }
  /* 大文件：交给主进程分块 AI 分析，汇总为结构化整理文本写入资料卡 */
  async function analyzeFile(kind, imp) {
    toast('AI 正在分 ' + Math.max(1, Math.ceil(imp.chars / 12000)) + ' 段整理「' + imp.name + '」，需要一点时间…');
    try {
      const r = await window.api.analyzeImport({ path: imp.textPath, title: imp.name });
      if (!r || !r.ok) { toast((r && r.error) || '分析失败', 'err'); return; }
      aiLandBefore('AI 文件分析整理成卡'); // C2：写入前快照
      const arr = S.data.entities[kind] || (S.data.entities[kind] = []);
      const obj = { id: uid(), name: imp.name + ' · AI 整理', source: '文件分析整理' };
      const body = '【来源】' + imp.name + '（' + fmtBytes(imp.size) + '，AI 分 ' + (r.chunks || 1) + ' 段整理）\n\n' + (r.digest || '（AI 未返回整理结果）');
      if (kind === 'rules') obj.detail = body; else obj.content = body;
      obj.files = [{ path: imp.textPath || imp.origPath, name: imp.name, size: imp.size }];
      arr.unshift(obj); pushAudit('create', kind, obj.name);
      S.importFile = null; S.importRaw = null;
      persist(); aiLandCommit(); toast('已生成 AI 整理「' + obj.name + '」', 'ok');
      // 切页不打断：只有仍停留在本资料页才回填渲染，否则仅持久化，切回时会自动重绘
      if (S.view === kind) renderDataView(kind);
    } catch (e) { toast('分析失败：' + aiErrText(e), 'err'); }
  }
  async function aiIntegrate(kind) {
    const raw = (S.importRaw && S.importRaw.kind === kind) ? S.importRaw.raw : '';
    if (!raw) { toast('请先点击「导入文件/粘贴」放入内容，再 AI 整合', 'err'); return; }
    toast('AI 正在整合拆分…');
    try {
      const r = await window.api.aiParse(raw, { excludePC: true });
      S.importRaw = null;
      openScriptPreview(r, kind, '已把导入内容整理解析为规范资料卡（仅导入「' + DATA_TYPE[kind] + '」），确认后写入。');
    } catch (e) {
      toast('整合失败：' + ((e && e.message) || e), 'err');
    }
  }
  /* 当前资料视图类型感知生成（按所选模板结构化填字段，可一次提取多条，勾选确认后写入） */
  /* 按当前视图「按需注入上下文」：只把与该类卡片相关的既有条目（名称+摘要）注入，
   * 帮助 AI 保持一致性、避免重复建卡，而不是把全库资料一股脑塞进提示词（省 token 也更聚焦）。 */
  function viewEntityContext(kind) {
    const arr = (S.data.entities && S.data.entities[kind]) || [];
    if (!arr.length) return '';
    const lines = arr.slice(0, 80).map(it => {
      const nm = String(it.name != null ? it.name : (it.title || '未命名')).trim();
      const sum = [it.summary, it.desc, it.content, it.subtitle, it.note, it.occupation].filter(Boolean).map(x => String(x)).join(' · ').slice(0, 120);
      return '· ' + nm + (sum ? ' — ' + sum : '');
    });
    return '以下为工作台「' + (DATA_TYPE[kind] || kind) + '」中已存在的条目（请保持一致、不要与之重名或冲突，必要时可引用或扩展）：\n' + lines.join('\n');
  }
  /* 组装给「AI 生成/建卡」类接口的上下文：仅注入当前视图相关条目 + 相关模板 + 近期对话尾部 */
  function viewGenContext(kind) {
    const parts = [];
    const ve = viewEntityContext(kind);
    if (ve) parts.push(ve);
    const cc = chatContextText(6);
    if (cc.trim()) parts.push('近期对话/待处理内容：\n' + cc.slice(-4000));
    return parts.join('\n\n');
  }
  async function aiGenForView(kind) {
    const tips = {
      npc: '一位有血有肉的 NPC',
      pc: '一位调查员/冒险者人物卡（PC）',
      region: '一片有辨识度的地区',
      log: '一条跑团日志/事件',
      mob: '一个怪物/敌人',
      rules: '一条房规/规则',
      lore: '一段背景设定'
    };
    const entKey = { npc: 'npcs', pc: 'pcs', region: 'regions', log: 'logs', mob: 'mobs', rules: 'rules', lore: 'lore' }[kind] || kind;
    const tpl = (S.viewTpl && S.viewTpl[kind]) || '';
    toast('AI 正在生成「' + DATA_TYPE[entKey] + '」…');
    try {
      const r = await window.api.aiGenCards({ kind: entKey, tip: tips[kind] || tips.npc, ctx: viewGenContext(entKey), tpl });
      if (!r || !r.ok) { toast((r && r.error) || '生成失败，请检查 AI 配置', 'err'); return; }
      const list = r.entities || [];
      if (!list.length) { toast('AI 未提取到可写卡的条目', 'err'); return; }
      S.scriptPreview = { entities: {} }; S.scriptPreview.entities[entKey] = list;
      S.splitSource = 'AI 生成';
      openScriptPreview(S.scriptPreview, entKey,
        'AI 已生成 ' + list.length + ' 个「' + DATA_TYPE[entKey] + '」候选' + (tpl ? '（模板：' + tplName(tpl) + '）' : '')
        + '，请勾选需要的（默认全选）确认后写入；确认后仍可在对应页面编辑详情。');
      S.splitSource = 'AI 生成';
    } catch (e) { toast('生成失败：' + aiErrText(e), 'err'); }
  }

  /* B3 AI 编写剧本全文：基于全档案上下文生成整篇剧本，并作为一条「背景/规则」(lore) 写入 */
  async function aiWriteScript(kind) {
    if (kind !== 'lore' && kind !== 'rules') kind = 'lore';
    const ctx = archiveContextText();
    const style = ((S.settings && S.settings.narrStyle) || '').trim();
    if (!(await appConfirm('AI 编写剧本全文', '将结合当前档案的' + (kind === 'lore' ? '背景/人设' : '规则') + '（含' + ctx.length + ' 字资料）让 AI 写出一篇完整、分幕、可直接开演的剧本全文，并作为一条新条目写入「' + DATA_TYPE[kind] + '」。原资料保留不变。继续？'))) return;
    toast('AI 正在编写剧本全文（分幕长文，请稍候）…');
    try {
      const r = await window.api.aiWriteScript({ kind, entName: worldLabel() + ' · 剧本全文', ctx, style });
      if (!r || !r.ok) { toast((r && r.error) || '编写失败', 'err'); return; }
      await reloadAll();
      toast(r.kind === 'lore' ? '剧本全文已写入「' + DATA_TYPE[kind] + '」，可在"背景"页查看' : '剧本全文已写入', 'ok');
      switchView(kind);
    } catch (e) { toast('编写失败：' + ((e && e.message) || e), 'err'); }
  }
  /* 汇总当前档案上下文（各实体名称 + 概要，供 AI 创作作参考） */
  function archiveContextText() {
    const out = [];
    const pick = (k, fields) => {
      const arr = (S.data.entities && S.data.entities[k]) || [];
      const head = arr.slice(0, 25).map(x => {
        const name = x.name || x.title || '未命名';
        const extra = fields.map(f => (typeof x[f] === 'string' && x[f]) ? x[f] : '').filter(Boolean).join('；').slice(0, 200);
        return '· ' + name + (extra ? '：' + extra : '');
      }).join('\n');
      if (head) out.push('【' + (DATA_TYPE[k] || k) + '】\n' + head);
    };
    pick('pcs', ['summary']); pick('npcs', ['summary']); pick('regions', ['summary']);
    pick('mobs', ['summary']); pick('lore', ['content', 'summary']);
    const logs = (S.data.entities && S.data.entities.logs) || [];
    if (logs.length) { pick('logs', ['summary', 'hook']); out.push('（已登记日志 ' + logs.length + ' 条）'); }
    return out.join('\n\n').slice(0, 6000) || '（暂无可用资料）';
  }

  /* ========== 剧本解析 ========== */
  /* ========== 剧本解析（已并入侧栏对话抽屉） ========== */
  function toggleDrawerScript(force) {
    const p = q('drawerScriptPanel'); if (!p) return;
    const show = (typeof force === 'boolean') ? force : p.hidden;
    if (show) {
      p.hidden = false;
      openChat(true);
      const ta = q('drawerScriptText'); if (ta) { if (S.scriptText && !ta.value) ta.value = S.scriptText; autosize(ta); }
      const st = q('drawerScriptState'); if (st && S.scriptState) st.textContent = S.scriptState;
      const btn = q('drawerScriptBtn'); if (btn) btn.classList.add('active');
    } else {
      p.hidden = true;
      const btn = q('drawerScriptBtn'); if (btn) btn.classList.remove('active');
    }
  }
  function captureScript(v) { S.scriptText = v; }
  async function scriptImportFile() {
    let f;
    try { f = await window.api.openFile(); } catch (e) { toast('无法读取文件：' + ((e && e.message) || e), 'err'); return; }
    if (!f || f.canceled) return;
    if (f.image) { toast('剧本解析暂不支持图片，请选择文字类文件', 'err'); return; }
    if (!f.ok) { toast('读取失败：' + (f.error || '未知错误'), 'err'); return; }
    const content = String(f.content || '');
    S.scriptText = content;
    const ta = q('drawerScriptText'); if (ta) { ta.value = content; ta.scrollTop = 0; autosize(ta); }
    const stt = q('drawerScriptState');
    if (stt) stt.textContent = '已导入 ' + f.name + '（' + content.length + ' 字符），点「⇄解析剧本」开始';
    S.scriptState = stt ? stt.textContent : '';
    toast('已导入剧本文件：' + f.name, 'ok');
  }
  async function doParse() {
    const ta = q('drawerScriptText');
    const t = (ta ? ta.value.trim() : (S.scriptText || '').trim());
    if (!t) { toast('请先粘贴剧本内容', 'err'); return; }
    S.scriptText = t;
    const stt = q('drawerScriptState'); if (stt) stt.textContent = '解析中，请稍候…';
    S.scriptState = '解析中，请稍候…';
    try {
      const r = await window.api.aiParse(t);
      S.scriptPreview = r;
      const doneHint = '完成：' + KINDS.map(k => `${DATA_TYPE[k]} ${(r.entities[k] || []).length} 条`).join(' · ');
      S.scriptState = doneHint;
      openScriptPreview(r, 'auto', '剧本解析完成：' + doneHint + '\n预览勾选后（默认全选）确认写入工作台；可在此处直接给导入卡套用「卡片模板」。');
      const curState = q('drawerScriptState'); if (curState) curState.textContent = doneHint;
    } catch (e) {
      S.scriptState = '';
      const curState = q('drawerScriptState'); if (curState) curState.textContent = '';
      toast('解析失败：' + ((e && e.message) || e), 'err');
    }
  }
  function previewHTML(r) {
    let html = '';
    for (const k of KINDS) {
      const all = r.entities[k] || [];
      if (!all.length) continue;
      const list = all; // 不再截断：此前 .slice(0,30) 导致第31条起在 DOM 中不可见也无法勾选，曾静默丢数据
      let rows = '';
      for (const it of list) {
        const name = it.name || it.title || '未命名';
        const meta = Object.keys(it).filter(x => !['name', 'source', 'id'].includes(x)).slice(0, 4)
          .map(x => `${x}：${(Array.isArray(it[x]) ? it[x].join('、') : it[x])}`).join('　');
        rows += `<div class="prow"><input type="checkbox" data-k="${k}" checked>
          <div class="ph"><b>${esc(name)}</b>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}</div></div>`;
      }
      html += `<div class="pkg"><h4>${DATA_TYPE[k]} · ${list.length}</h4>${rows}</div>`;
    }
    return html || '<div class="empty">未提取到可写入的资料</div>';
  }
  function paintScriptPreview(r) {
    const out = q('scriptOut'); if (!out) return;
    out.innerHTML = previewHTML(r) + `<div class="toolbar" style="margin-top:6px"><button onclick="WB.commitScript()">✓ 将勾选项写入工作台</button>
      <button class="ghost" onclick="WB.clearScript()">放弃</button></div>`;
  }
  function commitScript() {
    if (!S.scriptPreview) return;
    aiLandBefore('AI 写入资料卡'); // C2：写入前自动快照，供一键回滚
    const impTypeEl = q('impType');
    const onlyType = (impTypeEl && impTypeEl.value !== 'auto') ? impTypeEl.value : '';
    const impTplEl = q('impTpl');
    const impTpl = (impTplEl && impTplEl.value) || '';
    const picks = picksFromPreview();
    let total = 0; const skipped = [];
    for (const k of KINDS) {
      if (onlyType && k !== onlyType) continue; // 只落地指定类型的资料卡
      const arr = S.data.entities[k] || (S.data.entities[k] = []);
      const existingNames = new Set(arr.map(x => String(x.name || x.title || '').toLowerCase().trim()));
      for (const it of picks[k]) {
        const nm = String(it.name || it.title || '').toLowerCase().trim();
        if (nm && existingNames.has(nm)) { skipped.push(it.name || it.title || '未命名'); continue; } // 跳过重复，确保记录不出错
        it.source = S.splitSource || '剧本解析'; it.at = S.splitSource || '剧本解析';
        if (impTpl && TPL_KINDS.includes(k)) it.tpl = impTpl; // 导入时套用可选模板
        arr.unshift(it);
        existingNames.add(nm);
        pushAudit('create', k, it.name || '未命名');
        total++;
      }
    }
    if (!total) { aiLandCancel(); toast('未勾选任何条目', 'err'); return; }
    S.scriptPreview = null;
    S.importType = null;
    const so = q('scriptOut'); if (so) so.innerHTML = '';
    closeModal();
    toast((skipped.length ? '已写入 ' + total + ' 条' + (impTpl ? '（模板：' + tplName(impTpl) + '）' : '') + '，跳过 ' + skipped.length + ' 条重复' : '已写入 ' + total + ' 条' + (impTpl ? '（模板：' + tplName(impTpl) + '）' : '')), 'ok');
    aiLandCommit(); // C2：写入已完成，登记落地记录
    persist();
  }
  function setImportTpl(v) { S.importTpl = v || ''; }
  function picksFromPreview() {
    const out = {}; KINDS.forEach(k => out[k] = []);
    const pkgs = document.querySelectorAll('#scriptOut .pkg');
    for (const pkg of pkgs) {
      const rows = pkg.querySelectorAll('.prow');
      const list = [];
      rows.forEach((row, i) => { list[i] = { row, box: row.querySelector('input') }; });
      // 依据 data-kind（pkg 里的一律同 kind）——我们用第一行的 data-k
      const rows2 = pkg.querySelectorAll('.prow');
      const kind = rows2[0] ? rows2[0].querySelector('input').dataset.k : null;
      const arr = kind ? (S.scriptPreview.entities[kind] || []) : [];
      rows2.forEach((row, i) => {
        const box = row.querySelector('input');
        if (box.checked && arr[i]) { const it = JSON.parse(JSON.stringify(arr[i])); it.id = uid(); out[kind].push(it); }
      });
    }
    return out;
  }
  function clearScript() {
    S.scriptPreview = null; S.scriptState = '';
    const so = q('scriptOut'); if (so) so.innerHTML = '';
  }

  /* ========== AI 设定（角色卡） ========== */
  function renderPersona() {
    let html = `<div class="page-title"><h2>AI 设定</h2><span class="hint">每张卡片 = 人设 + 话风 + 设定；接口连接请在「AI 配置」统一设置</span></div>`;
    html += `<div class="toolbar"><button onclick="WB.editPersona('')">＋ 新建角色卡</button>
      <span class="grow"></span><span class="hint">当前接口：${(S.settings.ai && S.settings.ai.model) || '未配置（去 AI 配置）'}</span></div><div class="profiles">`;
    for (const p of S.profiles) {
      const act = S.activeProfile && S.activeProfile.id === p.id;
      html += `<div class="profile-card ${act ? 'active' : ''}">
        <div class="pname">${esc(p.name || '未命名')}</div>
        <div class="pdesc">${esc((p.persona || '').slice(0, 60))}${(p.persona || '').length > 60 ? '…' : ''}</div>
        <div class="pmeta">${act ? '● 使用中' : '○ 未启用'}</div>
        <div class="pf">${esc(((p.style || '') + '\n' + (p.setting || '')).trim().slice(0, 140)) || '<span style="color:var(--ink-faint)">未填写话风/设定</span>'}</div>
        <label class="toggle-row" style="display:flex;align-items:center;gap:8px;margin:8px 0 2px">
          <input type="checkbox" ${act ? 'checked' : ''} onchange="WB.togglePersona('${p.id}', this.checked)">
          <span style="font-size:12px"><b>开启（套用此人设对话）</b><br><span class="hint" style="color:var(--ink-faint);font-size:11px">开启后 AI 使用此人设与使用者对话；同一时间仅一个生效</span></span></label>
        <div class="card-actions">
          <button class="ghost" onclick="WB.editPersona('${p.id}')">编辑</button>
          <button class="danger" onclick="WB.delPersona('${p.id}')">删除</button></div></div>`;
    }
    html += (S.profiles.length ? '' : '<div class="empty">还没有角色卡，点右上角「新建角色卡」创建一个含人设/话风/设定的 AI</div>');
    html += `</div>`;
    contentInner(html);
  }
  function editPersona(id) {
    const p = id ? S.profiles.find(x => x.id === id) : { name: '', persona: '', style: '', setting: '' };
    const mask = q('modalMask');
    q('modalBox').innerHTML = `<h3>${id ? '编辑' : '新建'} AI 角色卡</h3>
      <div class="row"><label>角色名（用于识别）</label><input id="pf_name" value="${esc(p.name)}"></div>
      <div class="row"><label>◇ 人设（身份 / 性格 / 生平 / 外貌）</label><textarea id="pf_persona" rows="5">${esc(p.persona)}</textarea></div>
      <div class="row"><label>◇ 话风（说话方式 / 语气规则 / 口头禅）</label><textarea id="pf_style" rows="4">${esc(p.style)}</textarea></div>
      <div class="row"><label>◇ 设定（世界观 / 规则 / 知识库 / 补充约束）</label><textarea id="pf_setting" rows="5">${esc(p.setting)}</textarea></div>
      <div class="note">接口地址 / 密钥 / 模型为全局配置，请在「AI 配置」中统一填写；本卡片只负责“人设、话风、设定”。</div>
      <div class="foot">
        <button class="ghost" onclick="WB.closeModal()">取消</button>
        <button onclick="WB.savePersona('${id}')">保存</button></div>`;
    mask.hidden = false;
  }
  function savePersona(id) {
    const read = () => ({
      name: val('pf_name').trim(), persona: val('pf_persona').trim(), style: val('pf_style').trim(),
      setting: val('pf_setting').trim()
    });
    if (id) {
      const i = S.profiles.findIndex(x => x.id === id);
      if (i >= 0) Object.assign(S.profiles[i], read());
    } else {
      const p = read(); p.id = uid();
      S.profiles.push(p);
      if (!S.activeProfile) { S.settings.activeProfileId = p.id; S.activeProfile = p; }
    }
    closeModal(); persist(); switchView('persona'); updateTopProfile();
  }
  async function testPersona() { await aiTestCfg(); }

  /* ========== AI 配置（全局接口，独立一栏） ========== */
  function renderAIConf() {
    const ai = S.settings.ai || {};
    let html = `<div class="page-title"><h2>AI 配置</h2><span class="hint">全局接口地址 / 密钥 / 模型独立一栏；AI 助手、剧本解析、记录润色统一使用</span></div>
    <div class="setgrid">
      <div class="setcard"><h4>接口连接</h4>
        <div class="row"><label>接口地址 baseUrl（如 https://api.deepseek.com/v1）</label><input id="aif_base" value="${esc(ai.baseUrl || '')}" placeholder="https://api.deepseek.com/v1"></div>
        <div class="row"><label>模型 model</label><input id="aif_model" value="${esc(ai.model || '')}" placeholder="deepseek-chat"></div>
        <div class="row"><label>API Key</label><span class="keywrap"><input id="aif_key" type="password" value="${esc(ai.apiKey || '')}" autocomplete="off">
          <button class="ghost small" type="button" onclick="WB.toggleAiKey()" title="显示/隐藏密钥">👁</button></span>
          <div class="hint">密钥使用系统级加密保存在本机，不会以明文写入数据文件。</div></div>
        <div class="formgrid">
          <div class="row"><label>温度 temperature</label><input id="aif_temp" type="number" step="0.1" min="0" max="2" value="${ai.temperature != null ? ai.temperature : 0.6}"></div>
          <div class="row"><label>超时（秒）</label><input id="aif_to" type="number" min="10" value="${ai.timeoutMs != null ? Math.round(ai.timeoutMs / 1000) : 120}"></div>
        </div>
        <div class="foot" style="margin-top:12px">
          <button class="ghost" onclick="WB.aiTestCfg()">测试连通</button>
          <span class="grow"></span>
          <button onclick="WB.saveAIConf()">保存配置</button></div>
        <div class="hint" style="margin-top:8px">配置仅保存在本机 data/ 文件内，不会上传到工作台之外。</div>
      </div>
      <div class="setcard"><h4>AI 行为开关</h4>
        <div style="display:grid;grid-template-columns:1fr;gap:12px">
          <label class="toggle-row" style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" id="aif_usePersona" ${chk(ai.usePersona !== false)}>
            <span><b>启用当前人设</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">AI 在对话时会遵循「AI 设定」中的人设、话风与世界观设定</span></span>
          </label>
          <label class="toggle-row" style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" id="aif_useLore" ${chk(ai.useLoreRef !== false)}>
            <span><b>自动引入背景/规则</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">每次对话时自动把「背景」「规则」实体里的内容整理给 AI 作为参考，保持设定连贯性</span></span>
          </label>
          <label class="toggle-row" style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" id="aif_allowTools" ${chk(!!ai.allowTools)}>
            <span><b>允许文件上传工具</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">开启后 AI 对话页可上传本地文本文件读取内容，并可将 AI 回复导出为新 txt 文件</span></span>
          </label>
          <label class="toggle-row" style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" id="aif_longMemory" ${chk(!!ai.longMemory)}>
            <span><b>启用长期记忆</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">保留重要的对话要点或设定，让 AI 在长对话中保持记忆连贯</span></span>
          </label>
          <label class="toggle-row" style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" id="aif_useUserPrefs" ${chk(ai.useUserPrefs !== false)}>
            <span><b>启用用户偏好记忆</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">在下方写下你的使用习惯、格式要求、期望风格等，AI 会优先遵守并在每次对话中贯彻</span></span>
          </label>
        </div>
      </div>
      <div class="setcard"><h4>用户偏好记忆（可编辑）</h4>
        <div class="hint" style="margin-bottom:8px">记录你的习惯、要求与期望风格（例如：“回复用口语、少用列表”“所有 NPC 名称用 xx 风格”“资料卡帮我标注来源”等）。会自动注入每次对话，可随时增删。</div>
        <div id="userPrefsList"></div>
        <button class="ghost" onclick="WB.addUserPref()" style="margin-top:8px">＋ 添加偏好条目</button>
      </div>
      <div class="setcard"><h4>长期记忆（可选，手动维护）</h4>
        <div class="hint" style="margin-bottom:8px">如需长期记忆，在这里逐条记录要点（会自动注入每次对话的 prompt）</div>
        <div id="longMemoryList"></div>
        <button class="ghost" onclick="WB.addLongMemory()" style="margin-top:8px">＋ 添加记忆条目</button>
      </div>
      <div class="setcard"><h4>使用说明</h4><div class="note">此连接用于：侧栏 / AI 助手的对话、剧本自动解析、记录润色成文。AI 的「人设 / 话风 / 设定」在「AI 设定」里单独配置。</div></div>
    </div>`;
    contentInner(html);
    paintLongMemoryList();
    paintUserPrefsList();
  }
  function saveAIConf() {
    const toS = Number(val('aif_to')) || 120;
    const prev = S.settings.ai || {};
    S.settings.ai = Object.assign({}, prev, {
      baseUrl: val('aif_base').trim().replace(/\/+$/, ''),
      apiKey: val('aif_key').trim(),
      model: val('aif_model').trim(),
      temperature: Number(val('aif_temp')) || 0.6,
      timeoutMs: toS * 1000,
      maxTokens: 2000,
      usePersona: (q('aif_usePersona') && q('aif_usePersona').checked) !== false,
      useLoreRef: (q('aif_useLore') && q('aif_useLore').checked) !== false,
      allowTools: !!(q('aif_allowTools') && q('aif_allowTools').checked),
      longMemory: !!(q('aif_longMemory') && q('aif_longMemory').checked),
      useUserPrefs: (q('aif_useUserPrefs') && q('aif_useUserPrefs').checked) !== false
    });
    persist(); toast('AI 连接与行为配置已保存', 'ok'); switchView('aiconf');
  }

  /* ---- 骰娘 AI（功能开关 / 群聊行为 / 表情包库）：归入侧栏「骰娘 AI 设置」 ---- */
  const DICE_AI_FEATS = [
    { key: 'dice', label: '骰娘专属 AI 对话', hint: '.ai 指令发起的对话/定向判定，走独立开关；关闭则 .ai 直接给友好提示' },
    { key: 'optimize', label: '骰点文本优化', hint: '掷骰回复结合开团背景润色，更有剧情感（保留数值原义）' },
    { key: 'interject', label: '随机插话', hint: '以设定概率在回复后插一句骰娘本人的话（不消费太多 token，受插话概率控制）' },
    { key: 'meme', label: '表情包（偷表情）', hint: '收集群里 emoji/图片/文本图，插话时按概率附带；关闭则不附带已收集表情' },
    { key: 'kpAdvice', label: 'KP 建议', hint: '依据当前对局给 KP 生成建议（仅在本工作台界面展示，不对外发送）' }
  ];

  /* 骰娘 AI 设置 → AI 功能开关 */
  function renderDiceAI() {
    const html = `<div class="page-title"><h2>骰娘 AI 功能开关</h2>
      <span class="hint">专控「骰娘」运行时用到的 AI 能力；关闭即绝不向模型发起该功能请求，避免 token 消耗</span></div>
      <div class="setgrid">
        <div class="setcard"><h4>功能开关</h4>
          <div class="hint" style="color:var(--ink-faint);font-size:12px;margin-bottom:8px">总开关关闭时，下列所有功能一并停止请求。改动即时生效。</div>
          <div style="display:grid;grid-template-columns:1fr;gap:12px" id="diceAiSwitches"><div class="hint">加载中…</div></div>
        </div>
        <div class="setcard"><h4>使用说明</h4>
          <div class="note">本页开关仅作用于骰娘（<code>.ai</code> 对话 / 定向判定 / 插话 / 表情 / KP 建议）。工作台 AI（AI 助手、剧本解析、记录润色）不受影响，请在「工作台 AI 功能 → AI 配置」中设置。群聊中插话频率与附带表情概率在「群聊 AI 行为」里调整。</div>
        </div>
      </div>`;
    contentInner(html);
    paintDiceAiSwitches();
  }
  async function paintDiceAiSwitches() {
    const box = q('diceAiSwitches'); if (!box) return;
    let sw;
    try { sw = await (window.api && window.api.aiSwitchesGet ? window.api.aiSwitchesGet() : null); }
    catch (_) { sw = null; }
    if (!sw) { box.innerHTML = '<div class="hint">开关服务不可用（preload 未暴露 aiSwitchesGet）。</div>'; return; }
    const feats = sw.features || {};
    const rows = DICE_AI_FEATS.map((f) => `
      <label class="toggle-row" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" data-sw="${f.key}" ${chk(feats[f.key] !== false)} onchange="WB.saveDiceAiSwitches()">
        <span><b>${f.label}</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">${f.hint}</span></span>
      </label>`).join('');
    box.innerHTML = `
      <label class="toggle-row" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="dsw_total" ${chk(sw.enabled)} onchange="WB.saveDiceAiSwitches()">
        <span><b>总开关（所有骰娘 AI 功能）</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">关闭后不发起任何 AI 请求，仅此页面可重新开启</span></span>
      </label>
      ${rows}
    `;
  }

  /* 骰娘 AI 设置 → 群聊 AI 行为 */
  function renderDiceAIChat() {
    const html = `<div class="page-title"><h2>群聊 AI 行为</h2>
      <span class="hint">骰娘在群里发言时的 AI 行为参数（插话频率、附带表情概率）</span></div>
      <div class="setgrid">
        <div class="setcard"><h4>群聊行为概率</h4>
          <div class="hint" style="color:var(--ink-faint);font-size:12px;margin-bottom:8px">这些参数决定骰娘在群聊中的主动程度。数值越高越活跃，同时也会消耗更多 token。改动即时生效。</div>
          <div style="display:grid;grid-template-columns:1fr;gap:12px" id="diceAiChatProbs"><div class="hint">加载中…</div></div>
        </div>
        <div class="setcard"><h4>使用说明</h4>
          <div class="note">插话与附带表情依赖「AI 功能开关」中的<b>随机插话</b>与<b>表情包</b>开关：对应开关关闭时，即使概率非零也不会生效。收集到的表情在「表情包库」里管理。</div>
        </div>
      </div>`;
    contentInner(html);
    paintDiceAiChat();
  }
  async function paintDiceAiChat() {
    const box = q('diceAiChatProbs'); if (!box) return;
    let sw;
    try { sw = await (window.api && window.api.aiSwitchesGet ? window.api.aiSwitchesGet() : null); }
    catch (_) { sw = null; }
    if (!sw) { box.innerHTML = '<div class="hint">开关服务不可用（preload 未暴露 aiSwitchesGet）。</div>'; return; }
    const row = (id, label, hint, val) => `
      <div class="row" style="grid-template-columns:1fr 140px"><label>${label}<br><span class="hint" style="color:var(--ink-faint);font-size:12px">${hint}</span></label>
        <input id="${id}" type="number" min="0" max="100" value="${val}" onchange="WB.saveDiceAiSwitches()"></div>`;
    box.innerHTML =
      row('dsw_interjectProb', '随机插话概率（% 命中率）', '每条回复后骰娘主动接话的命中概率', sw.interjectProb) +
      row('dsw_memeProb', '插话附带表情概率（%）', '每次插话时顺带一个收藏表情的概率', sw.memeProb);
  }

  window.WB.saveDiceAiSwitches = async function saveDiceAiSwitches() {
    const patch = {};
    const feats = {};
    // 注意：q() 是 getElementById，分项开关是 data-sw 属性、没有 id，必须用 querySelector 取，
    // 否则 feats 恒为空、patch.features 从不提交，表现为「只有总开关能保存，分项点了没用」。
    for (const f of DICE_AI_FEATS) { const el = document.querySelector('[data-sw="' + f.key + '"]'); if (el) feats[f.key] = el.checked; }
    if (Object.keys(feats).length) patch.features = feats;
    const tot = q('dsw_total'); if (tot) patch.enabled = !!tot.checked;
    const ip = q('dsw_interjectProb'); if (ip) patch.interjectProb = Number(ip.value);
    const mp = q('dsw_memeProb'); if (mp) patch.memeProb = Number(mp.value);
    try {
      if (window.api && window.api.aiSwitchesSet) {
        const r = await window.api.aiSwitchesSet(patch);
        toast('骰娘 AI 设置已保存', 'ok');
        paintDiceAiSwitches();
        paintDiceAiChat();
        return r;
      }
    } catch (e) { toast('保存失败：' + (e && e.message || e), 'err'); }
  };

  /* 骰娘 AI 设置 → 表情包库 */
  function renderDiceMeme() {
    const html = `<div class="page-title"><h2>表情包库</h2>
      <span class="hint">从群里“偷”到的表情（emoji / 图片 / 文本图），骰娘插话时按概率附带</span></div>
      <div class="setgrid">
        <div class="setcard"><h4>已收集表情</h4>
          <div class="hint" style="color:var(--ink-faint);font-size:12px;margin-bottom:8px">可手动录入、打标签、随机调用。若「AI 功能开关」里的「表情包(meme)」被关闭，则插话时不会附带收集到的表情，但收集仍可进行。</div>
          <div id="memeManage"><div class="hint">加载中…</div></div>
        </div>
      </div>`;
    contentInner(html);
    paintMemeManage();
  }


  /* ---- 骰娘表情包库管理 ---- */
  async function paintMemeManage() {
    const box = q('memeManage'); if (!box) return;
    let data;
    try { data = await (window.api && window.api.diceCore && window.api.diceCore.meme ? window.api.diceCore.meme.list() : null) || { items: [], tags: [], count: 0 }; }
    catch (_) { data = { items: [], tags: [], count: 0 }; }
    const tags = data.tags || [];
    const items = data.items || [];
    const rows = items.slice(0, 30).map((it) => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
        <code style="min-width:60px">${esc(it.token)}</code>
        <span style="font-size:12px;color:var(--ink-faint)">×${it.count}</span>
        <span>${(it.tags || []).map((t) => '<span class="tag" style="background:var(--panel);padding:0 6px;border-radius:8px;font-size:11px">' + esc(t) + '</span>').join(' ')}</span>
        <button class="ghost small" onclick="WB.addMemeTag(${JSON.stringify(it.token).replace(/"/g, '&quot;')})">＋标签</button>
        <button class="ghost small danger" onclick="WB.sampleMeme()">用一次</button>
      </div>`).join('');
    box.innerHTML = `
      <div class="hint" style="margin-bottom:6px">已收集 ${data.count||0} 个表情，标签：${tags.map((t) => esc(t)).join(' / ') || '（无）'}</div>
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <input id="memeAddInput" placeholder="录入一个表情，如 😄 或 [CQ:image,...]" style="flex:1;min-width:220px">
        <button class="ghost" onclick="WB.addMeme()">收录</button>
        <button class="ghost" onclick="WB.sampleMeme()">随机调用一个</button>
      </div>
      <div style="max-height:230px;overflow:auto">${rows || '<div class="hint">还没有表达式，先在测试通道/群里发点表情，或手动收录。</div>'}</div>`;
  }
  window.WB.paintMemeManage = function () { paintMemeManage(); };
  window.WB.addMeme = async function () {
    const el = q('memeAddInput'); const v = el && el.value.trim();
    if (!v) { toast('请输入表情内容', 'err'); return; }
    try { if (window.api && window.api.diceCore && window.api.diceCore.meme) { await window.api.diceCore.meme.add(v); paintMemeManage(); toast('已收录表情', 'ok'); } } catch (e) { toast('收录失败', 'err'); }
  };
  window.WB.sampleMeme = async function () {
    try { let t = ''; if (window.api && window.api.diceCore && window.api.diceCore.meme) t = await window.api.diceCore.meme.sample([]); toast(t || '表情库还是空的', t ? 'ok' : 'err'); } catch (e) { toast('调用失败', 'err'); }
  };
  window.WB.addMemeTag = async function (token) {
    try { if (window.api && window.api.diceCore && window.api.diceCore.meme) { await window.api.diceCore.meme.tag(token, ['通用'], 'add'); paintMemeManage(); } } catch (_) {}
  };

  /* ---- 内容过滤规则：读取 / 渲染 / 添加 / 删除 ---- */
  let _modRuleSeed = null;
  const chk = (b) => b ? 'checked' : ''; // 勾选态工具（供规则/开关渲染共用，避免作用域缺失导致按钮失效）
  function getModRules() {
    const ai = S.settings.ai || {};
    if (Array.isArray(ai.modRules) && ai.modRules.length) return ai.modRules;
    return Array.isArray(_modRuleSeed) ? _modRuleSeed : [];
  }
  function paintModRules() {
    const box = q('modRuleList'); if (!box) return;
    const rules = getModRules();
    if (!rules.length) { box.innerHTML = '<div class="hint" style="color:var(--ink-faint)">暂无规则。可点下方「添加规则」，或用主进程内置的高危内容拦截规则。</div>'; return; }
    box.innerHTML = rules.map((r, i) => `<div style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <label style="font-size:12px;display:flex;gap:5px;align-items:center"><input type="checkbox" id="mron_${i}" ${chk(r.enabled !== false)}>启用</label>
        <span class="grow"></span>
        <button class="danger small" onclick="WB.delModRule(${i})">删除</button></div>
      <div class="row" style="margin-bottom:6px"><label style="min-width:72px">正则/关键词</label><input id="mrpat_${i}" value="${esc(r.pattern || '')}" placeholder="例如 未成年.{0,10}(性|色情)"></div>
      <div class="row"><label style="min-width:72px">提示文案</label><input id="mrres_${i}" value="${esc(r.reason || '')}" placeholder="命中时展示给用户的拦截说明"></div>
    </div>`).join('');
  }
  function addModRule() {
    const rules = getModRules().slice();
    rules.push({ id: 'r' + Date.now(), pattern: '', reason: '检测到敏感/越权内容，已拦截', enabled: true, flags: '' });
    S.settings.ai = Object.assign({}, S.settings.ai || {}, { modRules: rules });
    persist(); paintModRules();
  }
  function delModRule(i) {
    const ai = S.settings.ai = Object.assign({}, S.settings.ai || {});
    const rules = Array.isArray(ai.modRules) ? ai.modRules.slice() : [];
    if (i >= 0 && i < rules.length) { rules.splice(i, 1); if (rules.length) ai.modRules = rules; else delete ai.modRules; }
    persist(); paintModRules(); toast('已删除该规则', 'ok');
  }
  /* ---- 长期记忆：列表 / 添加 / 删除 ---- */
  function getMemory() { return (S.settings.memory = Array.isArray(S.settings.memory) ? S.settings.memory : []); }
  /* 长期记忆条目为 {text,t} 对象（兼容历史字符串条目），此处统一取纯文本用于注入 AI */
  function memoryText() {
    return getMemory().map(x => String((x && x.text != null ? x.text : x) || '').trim()).filter(Boolean).join('\n');
  }
  function paintLongMemoryList() {
    const box = q('longMemoryList'); if (!box) return;
    const mem = getMemory();
    if (!mem.length) { box.innerHTML = '<div class="hint" style="color:var(--ink-faint)">暂无长期记忆条目。</div>'; return; }
    box.innerHTML = mem.map((m, i) => `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px">
      <span class="hint" style="flex:0 0 auto;color:var(--ink-faint)">${m.t ? new Date(m.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
      <span style="flex:1;white-space:pre-wrap;font-size:13px">${esc(m.text)}</span>
      <button class="danger small" onclick="WB.delLongMemory(${i})">删</button></div>`).join('');
  }
  function memoModal() {
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>添加长期记忆</h3>
      <div class="note" style="margin-bottom:8px">记下关键设定、进度或待办，之后每次 AI 对话都会自动注入，保持长对话连贯。可随时删除。</div>
      <div class="row full"><label>记忆要点</label><textarea id="memoInput" rows="5" placeholder="例：主角林澈拥有“燃烬之瞳”，可短暂读取残留记忆…"></textarea></div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button><button onclick="WB.saveMemoModal()">保存记忆</button></div>`;
    mask.hidden = false;
    const ta = q('memoInput'); if (ta) setTimeout(() => ta.focus(), 40);
  }
  function addLongMemory() { memoModal(); }
  function saveMemoModal() {
    const v = (q('memoInput') && q('memoInput').value || '').trim();
    if (!v) { toast('记忆内容不能为空', 'err'); return; }
    getMemory().unshift({ text: v, t: new Date().toISOString() });
    closeModal(); persist(); paintLongMemoryList(); toast('已添加长期记忆', 'ok');
  }
  function delLongMemory(i) {
    const mem = getMemory();
    if (i >= 0 && i < mem.length) { mem.splice(i, 1); persist(); paintLongMemoryList(); toast('已删除记忆条目', 'ok'); }
  }
  /* ---- 用户偏好记忆：可编辑，记录 KP 的使用习惯/要求/期望风格，注入每次对话 ---- */
  function getPrefs() { return (S.settings.userPrefs = Array.isArray(S.settings.userPrefs) ? S.settings.userPrefs : []); }
  function paintUserPrefsList() {
    const box = q('userPrefsList'); if (!box) return;
    const list = getPrefs();
    if (!list.length) { box.innerHTML = '<div class="hint" style="color:var(--ink-faint)">暂无偏好条目。添加一条试试：例如“生成的文本用第二人称、别太啰嗦”。</div>'; return; }
    box.innerHTML = list.map((m, i) => `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px">
      <span style="flex:1;white-space:pre-wrap;font-size:13px">${esc(m.text)}</span>
      <button class="ghost small" onclick="WB.editUserPref(${i})">改</button>
      <button class="danger small" onclick="WB.delUserPref(${i})">删</button></div>`).join('');
  }
  function addUserPref() { userPrefModal(-1); }
  function editUserPref(i) { userPrefModal(i); }
  function userPrefModal(i) {
    const list = getPrefs();
    const it = (i >= 0 && i < list.length) ? list[i] : { text: '' };
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>${i >= 0 ? '编辑' : '添加'}用户偏好</h3>
      <div class="note" style="margin-bottom:8px">写下 KP 的使用习惯、格式要求、期望风格，例如“回复用自然口语、少用列表”“NPC 取名用古文风格”“生成资料卡时帮我标注来源”。AI 会优先遵守并贯穿每次对话。</div>
      <div class="row full"><label>偏好内容</label><textarea id="prefInput" rows="5" placeholder="例：AI 回复请保持简洁、避免空话；生成长文本时按小标题分段…">${esc(it.text)}</textarea></div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button><button onclick="WB.saveUserPrefModal(${i})">保存偏好</button></div>`;
    mask.hidden = false;
    const ta = q('prefInput'); if (ta) setTimeout(() => ta.focus(), 40);
  }
  function saveUserPrefModal(i) {
    const v = (q('prefInput') && q('prefInput').value || '').trim();
    if (!v) { toast('偏好内容不能为空', 'err'); return; }
    const list = getPrefs();
    if (i >= 0 && i < list.length) list[i].text = v;
    else list.unshift({ text: v, t: new Date().toISOString() });
    closeModal(); persist(); paintUserPrefsList(); toast('已保存用户偏好', 'ok');
  }
  function delUserPref(i) {
    const list = getPrefs();
    if (i >= 0 && i < list.length) { list.splice(i, 1); persist(); paintUserPrefsList(); toast('已删除偏好条目', 'ok'); }
  }
  async function aiTestCfg() {
    const cfg = S.settings.ai || {};
    if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) { toast('请先在 AI 配置里填写 baseUrl / Key / 模型 并保存', 'err'); return; }
    toast('正在测试连通性…');
    try {
      const r = await window.api.aiTest();
      toast('连接成功：' + ((r && r.model) || 'ok'), 'ok');
    } catch (e) {
      toast(aiErrText(e), 'err');
    }
  }
  function toggleAiKey() {
    const el = q('aif_key'); if (!el) return;
    el.type = (el.type === 'password') ? 'text' : 'password';
  }

  /* ========== 记录润色 → 导出 txt ========== */
  function renderPolish() {
    let html = `<div class="page-title"><h2>记录润色</h2><span class="hint">粘贴跑团记录，AI 补全背景润色成一篇小文章，可导出为 .txt</span></div>
      <div class="setgrid"><div class="setcard">
        <div class="row"><label>记录标题（可选）</label><input id="polTitle" placeholder="如：第 3 次团 · 雾蚀带之夜"></div>
        <div class="row"><label>跑团记录正文</label><textarea id="polText" rows="10" placeholder="粘贴你的跑团记录…"></textarea></div>
        <div class="toolbar">
          <button onclick="WB.polishRun()">✍ 润色成文（AI）</button>
          <button class="ghost" onclick="WB.buildBattleReport()">⚒ 生成战报（基于日志）</button>
          <span class="grow"></span><span class="hint" id="polState"></span></div>
        <div class="row"><label>润色结果 / 生成的战报</label><textarea id="polOut" rows="12" placeholder="润色后或生成的战报将显示在这里…"></textarea></div>
        <div class="toolbar" style="justify-content:flex-end">
          <button class="ghost" onclick="WB.polishExport()">⬇ 导出 .txt</button>
          <button class="ghost" onclick="WB.polishExportMd()">⬇ 导出 .md</button>
        </div>
      </div></div>`;
    contentInner(html);
  }
  async function polishRun() {
    const t = q('polText').value.trim();
    if (!t) { toast('请先粘贴记录正文', 'err'); return; }
    q('polState').textContent = '润色中，请稍候…';
    try {
      const r = await window.api.aiPolish([t, val('polTitle') || '']);
      q('polOut').value = (r && r.content) || r || '';
      q('polState').textContent = '完成，可导出。';
    } catch (e) {
      q('polState').textContent = '';
      toast('润色失败：' + ((e && e.message) || e), 'err');
    }
  }
  function polishText() {
    const body = (q('polOut') && q('polOut').value.trim()) || (q('polText') ? q('polText').value.trim() : '');
    const title = (val('polTitle') || '跑团记录').trim();
    if (!body) return '';
    const head = title + '\n\n（本文章由「KP 跑团工作台 · 记录润色」整理，背景世界：' + ((S.settings && S.settings.appName) || '残火纪') + '）\n\n';
    return head + body + '\n';
  }
  /* B1 批量润色：把全部日志（或查看更多里的日志）逐条交给 AI 润色，结果写回对应日志的 polished 字段 */
  async function polishLogs(kind) {
    if (kind !== 'logs') return;
    const arr = S.data.entities.logs || [];
    const selSet = (S.batchMode && S._sel && S._sel.logs) ? S._sel.logs : null;
    const items = arr
      .filter(x => !selSet || selSet[x.id])
      .map(x => ({ key: x.id, title: x.name || x.title || '跑团记录', text: logPlain(x) }))
      .filter(x => x.text);
    if (!items.length) { toast('没有可选日志（或已选日志都无正文），请先登记日志', 'err'); return; }
    const style = ((S.settings && S.settings.narrStyle) || '').trim();
    if (!(await appConfirm('AI 批量润色', '将对 ' + items.length + ' 条日志逐条调用 AI 润色（约需部分时间）。润色结果会写入各日志的「润色稿」字段，保留原文。继续？'))) return;
    toast('批量润色开始（0/' + items.length + '）…');
    try {
      const r = await window.api.aiPolishBatch({ items, style });
      if (!r || !r.ok) { toast((r && r.error) || '批量润色失败', 'err'); return; }
      let n = 0;
      for (const out of (r.items || [])) {
        const log = (S.data.entities.logs || []).find(x => x.id === out.key);
        if (out.ok && out.text && log) { log.polished = out.text; n++; }
      }
      persist();
      toast('批量润色完成：' + n + '/' + items.length + ' 条已写入「润色稿」', n ? 'ok' : 'err');
      renderDataView('logs');
    } catch (e) { toast('批量润色失败：' + ((e && e.message) || e), 'err'); }
  }
  /* 把一条日志拼成可润色的纯文本（正文=摘要+钩子+备注） */
  function logPlain(x) {
    return [x.summary, x.hook, x.note].filter(v => typeof v === 'string' && v.trim()).join('\n');
  }
  /* 基于已登记日志生成 Markdown 战报 */
  function buildBattleReport() {
    const logs = (S.data.entities.logs || []).filter(x => x.name || x.title);
    if (!logs.length) { toast('暂无可生成的日志，请先在「日志」里登记开团记录', 'err'); return; }
    let md = `# ${worldLabel()} · 跑团战报\n\n`;
    md += `> 由「KP 跑团工作台」根据日志自动整理 · 生成于 ${new Date().toLocaleDateString('zh-CN')}\n\n`;
    md += `## 团一览\n\n`;
    md += `共收录 ${logs.length} 场（次）记录。\n\n`;
    logs.forEach((l, i) => {
      md += `## ${i + 1}. ${l.name || l.title || '未命名'}\n\n`;
      if (l.when) md += `- **开团日期**：${l.when}\n`;
      if (l.status) md += `- **状态**：${l.status}\n`;
      if (Array.isArray(l.actors) && l.actors.length) md += `- **出场角色**：${l.actors.join('、')}\n`;
      if (l.summary) md += `\n${l.summary}\n`;
      if (l.hook) md += `\n**当前钩子/任务**：${l.hook}\n`;
      if (l.note) md += `\n备注：${l.note}\n`;
      md += `\n---\n\n`;
    });
    md += `_战报由工作台生成，可根据回团补全后再次润色导出。_\n`;
    if (q('polOut')) q('polOut').value = md;
    q('polState').textContent = '战报告成，可导出 .md 或 .txt。';
  }
  function worldLabel() { return (S.settings && S.settings.appName) || '残火纪'; }
  async function polishExportMd() {
    const c = (q('polOut') && q('polOut').value.trim()) || '';
    if (!c) { toast('没有可导出的内容，请先润色或生成战报', 'err'); return; }
    const safe = ((val('polTitle') || '跑团战报').trim() || '跑团战报').replace(/[\\/:*?"<>|]/g, '_');
    const r = await window.api.saveMarkdown(safe + '.md', c);
    if (r && r.ok) toast('已导出：' + r.path, 'ok');
    else if (r && r.canceled) {}
    else toast('导出失败', 'err');
  }
  async function polishExport() {
    const c = polishText();
    if (!c) { toast('没有可导出的内容，请先输入记录或润色', 'err'); return; }
    const safe = ((val('polTitle') || '跑团记录').trim() || '跑团记录').replace(/[\\/:*?"<>|]/g, '_');
    const r = await window.api.saveText(safe + '.txt', c);
    if (r && r.ok) toast('已导出：' + r.path, 'ok');
    else if (r && r.canceled) {}
    else toast('导出失败', 'err');
  }

  /* ========== 临场战斗（遭遇战记录 · 回合 · 血量/状态 · 投骰即记） ==========
   * 数据存于 S.data.entities.encounters（主进程已纳入持久化类型，<main/store.js>）。
   * 边界的做法：遭遇数据不会进入资料卡网格 / 全局搜索 / 关系网等既有卡片体系，
   * 只通过本视图读写，避免把“临场会话”混进“剧情档案”。未开启回合追踪时，
   * 回合/状态控制全部隐藏，仅为登记单位 + 投骰即记的服务。 */
  const ENC_STATUS = [
    ['ok', '正常'], ['down', '昏迷'], ['blood', '血流'], ['poison', '中毒'], ['rage', '狂暴'], ['stun', '眩晕'], ['fear', '恐慌'], ['guard', '防御'], ['other', '其他']
  ];
  function encData() { if (!S.data.entities) S.data.entities = {}; if (!Array.isArray(S.data.entities.encounters)) S.data.entities.encounters = []; return S.data.entities.encounters; }
  function encCur() { return encData().find(x => x._open) || null; }

  function renderEncounter() {
    const list = encData();
    const cur = encCur();
    let html = `<div class="page-title"><h2>临场战斗</h2>
      <span class="hint">遭遇记录 · 回合/血量/状态追踪 · 骰娘投掷即记流水</span></div>`;
    html += `<div class="toolbar">
      <button onclick="WB.encNew()">➕ 新建遭遇</button>
      <span class="grow"></span>
      <span class="hint">共 ${list.length} 场</span></div>`;
    if (!list.length) html += `<div class="empty">还没有遭遇。先登记 NPC / 怪物 / 人物卡，再点「➕ 新建遭遇」，把交战单位拉入即可开启回合追踪；在「骰娘鉴定」投掷会自动并入本场流水。
      <div class="toolbar" style="margin-top:10px;justify-content:flex-start;flex-wrap:wrap">
        <button onclick="WB.encNew()">➕ 立即新建遭遇</button>
        <span class="grow"></span></div></div>`;
    else {
      html += `<div class="enc-list">` + list.map(e => {
        const st = encLiveStats(e);
        const ucnt = st.total;
        const nm = e.name || '未命名遭遇';
        let tag;
        if (e.done === 'win') tag = `<b class="enc-badge done">胜利</b>`;
        else if (e.done === 'fail') tag = `<b class="enc-badge fail">败北</b>`;
        else if (e.done === 'fold') tag = `<span class="enc-badge">弃置</span>`;
        else tag = e._open ? `<b class="enc-badge live">进行中</b>` : `<span class="enc-badge">${ucnt} 单位 · ${st.alive}/${ucnt} 存活</span>`;
        return `<div class="setcard enc-card">
          <div class="wizard-head" style="cursor:pointer;user-select:none">
            <b>⚔ ${esc(nm)}</b> ${tag}
            <span class="grow"></span>
            <button class="ghost small" onclick="event.stopPropagation();WB.encOpen('${e.id}')">${e._open ? '继续' : '进入'}</button>
            <button class="ghost small" onclick="event.stopPropagation();WB.encDel('${e.id}')">✕</button></div>
          ${e.note ? `<div class="row long" style="margin-top:6px"><span class="hint">${esc(e.note)}</span></div>` : ''}
        </div>`;
      }).join('') + `</div>`;
    }
    if (cur) html += renderEncBoard(cur);
    contentInner(html);
  }

  /* 遭遇面板：单位列表 + 回合控制 + 血量/状态 + 流水 */
  function renderEncBoard(e) {
    const units = (e.units || []).slice();
    const flowOn = !!(e.flow && e.flow.active);
    /* 归一化顺序：统一用 encNormOrder（会写回 e.order 并消除悬空 id），保证渲染与回合操作一致 */
    const order = encNormOrder(e);
    const curId = order.indexOf(e.cur) >= 0 ? e.cur : null;
    const curIdx = order.indexOf(curId);
    const unitHtml = units.map(u => {
      const hp = (u.maxHp || 0) > 0 ? Math.max(0, (u.curHp || 0)) + ' / ' + u.maxHp : (u.curHp != null ? String(u.curHp) : '—');
      const statusChips = (u.status || []).map(s => {
        const meta = ENC_STATUS.find(x => x[0] === s);
        return `<span class="enc-status" data-st="${s}">${meta ? meta[1] : esc(s)}</span>`;
      }).join('');
      const isCur = flowOn && curId === u.id;
      const hpPct = (u.maxHp || 0) > 0 ? Math.max(0, Math.min(100, (u.curHp || 0) / u.maxHp * 100)) : 100;
      return `<div class="enc-unit${isCur ? ' cur' : ''}" data-uid="${u.id}">
        <div class="enc-unit-head">
          ${flowOn ? (isCur ? '<b class="enc-mark">▶</b>' : `<button class="ghost small" onclick="WB.encNextTo('${escJs(u.id)}')">▶ 转</button>`) : ''}
          <b class="enc-uname">${esc(u.name || '未命名')}</b>
          <span class="hint">${esc(u.kindLabel || u.kind || '')}</span>
          <span class="grow"></span>
          ${(u.refId && S.data.entities[u.refKind] && S.data.entities[u.refKind].find(x => x.id === u.refId)) ? `<button class="ghost small" onclick="WB.encGoRef('${escJs(u.refKind)}','${escJs(u.refId)}')">查看卡</button>` : ''}
          <button class="ghost small" onclick="WB.encDelUnit('${escJs(e.id)}','${escJs(u.id)}')">✕</button></div>
        <div class="enc-hpbar"><div class="enc-hpfill" style="width:${hpPct}%"></div></div>
        <div class="enc-unit-body">
          <span class="enc-hp">HP ${esc(hp)}</span>
          <button class="ghost small" onclick="WB.encHp('${escJs(e.id)}','${escJs(u.id)}',-1)">−1</button>
          <button class="ghost small" onclick="WB.encHp('${escJs(e.id)}','${escJs(u.id)}',-5)">−5</button>
          <button class="ghost small" onclick="WB.encHp('${escJs(e.id)}','${escJs(u.id)}',1)">＋1</button>
          <button class="ghost small" onclick="WB.encHp('${escJs(e.id)}','${escJs(u.id)}',5)">＋5</button>
          ${statusChips}
          <span class="grow"></span>
          <button class="ghost small" onclick="WB.encToggleStatus('${escJs(e.id)}','${escJs(u.id)}','down')">昏</button>
        </div></div>`;
    }).join('') || `<div class="empty">暂无单位，点下方「拉入资料卡」或「添加单位」。</div>`;

    const pickOpts = [];
    for (const k of ['npcs', 'mobs', 'pcs']) {
      for (const it of (S.data.entities[k] || [])) {
        if (it && (it.name || it.title)) pickOpts.push(`<option value="${escJs(k + '|' + it.id)}">${esc(['npcs', 'NPC', 'mobs', '怪物', 'pcs', '人物卡'][['npcs', 'mobs', 'pcs'].indexOf(k) * 2 + 1])} · ${esc(it.name || it.title)}</option>`);
      }
    }

    let html = `<div class="setcard enc-board">
      <div class="wizard-head"><b>当前遭遇：${esc(e.name || '未命名遭遇')}</b>
        <span class="grow"></span>
        <label class="ai-toggle" title="开启后显示回合顺序与当前行动者"><input type="checkbox" id="encFlowOn" ${flowOn ? 'checked' : ''} onchange="WB.encSetFlow('${escJs(e.id)}', this.checked)"> 回合追踪</label>
        ${e.done ? `<b class="enc-badge ${e.done === 'win' ? 'done' : (e.done === 'fail' ? 'fail' : '')}">${e.done === 'win' ? '胜利' : (e.done === 'fail' ? '败北' : '弃置')}</b>` : ''}
        <button class="ghost small" onclick="WB.closeEnc()">收起</button>
        <button class="ghost small" onclick="WB.encDel('${escJs(e.id)}')">删除</button></div>
      ${!e.done ? `<div class="enc-settle">
        <span class="hint">战斗结束后标记结算，方便回顾复盘：</span>
        <button class="ghost small" onclick="WB.encSettle('${escJs(e.id)}','win')">🏆 我方胜利</button>
        <button class="ghost small" onclick="WB.encSettle('${escJs(e.id)}','fail')">💀 我方败北</button>
        <button class="ghost small" onclick="WB.encSettle('${escJs(e.id)}','fold')">⏸ 中途弃置</button>
      </div>` : `<div class="enc-settle enc-settle-done">
        ${settleLine(e)}
        <span class="grow"></span>
        <button class="ghost small" onclick="WB.encSettle('${escJs(e.id)}','')">↻ 恢复进行中</button>
      </div>`}`;

    if (flowOn) {
      html += `<div class="enc-flow">
        <div class="toolbar"><b>回合顺序：</b>
          <button class="ghost small" onclick="WB.encPrev('${escJs(e.id)}')">◀ 上一位</button>
          <span class="enc-curwho">当前：${curId ? esc((units.find(u => u.id === curId) || {}).name || '—') : '未开始'}</span>
          <button class="ghost small" onclick="WB.encNext('${escJs(e.id)}')">下一位 ▶</button>
          <span class="grow"></span>
          <span class="hint">第 ${Math.max(1, curIdx < 0 ? 1 : Math.floor(curIdx / Math.max(1, order.length)) + 1)} 轮</span></div>
        <div class="enc-order">${order.map((id, i) => {
          const u = units.find(x => x.id === id);
          const tag = id === curId ? '<b class="enc-mark">▶</b>' : (i + 1);
          return `<span class="enc-order-item${id === curId ? ' cur' : ''}" onclick="WB.encNextTo('${escJs(id)}')" title="点击设为当前">${esc(u ? u.name : '—')}</span>`;
        }).join('')}</div>
      </div>`;
    }

    html += `<div class="enc-units">${unitHtml}</div>`;

    html += `<div class="enc-add">
      <select id="encPick">${pickOpts.length ? pickOpts.join('') : '<option value="">（暂无 NPC/怪物/人物卡，请先在资料页登记）</option>'}</select>
      <button class="ghost" onclick="WB.encPull('${escJs(e.id)}')">⇥ 拉入资料卡</button>
      <button class="ghost" onclick="WB.encAddManual('${escJs(e.id)}')">＋ 手动单位</button>
      <span class="hint">投骰即记：在「骰娘鉴定」投掷会自动并入本场流水</span></div>`;

    const clog = (e.combatLog || []).slice().reverse().slice(-30).map(c => `<div class="enc-log-line"><span class="hint">${esc(c.t ? new Date(c.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '')}</span> <b>${esc(c.who || '')}</b> ${esc(c.text || '')}</div>`).join('');
    html += `<div class="enc-log"><h3>投骰 / 行动流水</h3>${clog || '<div class="hint">暂无流水。在骰娘处投掷（本场进行中时）会自动记录到这里。</div>'}</div>`;
    html += `</div>`;
    return html;
  }

  /* ---- 遭遇 CRUD ---- */
  function encNew() {
    const list = encData();
    const e = { id: uid(), name: '遭遇 ' + (list.length + 1), note: '', units: [], order: [], cur: null, flow: { active: false }, combatLog: [], _open: true, created: new Date().toISOString() };
    list.unshift(e);
    persist(); renderEncounter();
  }
  function encOpen(id) {
    encData().forEach(x => x._open = (x.id === id));
    persist(); renderEncounter();
  }
  function closeEnc() { encData().forEach(x => x._open = false); persist(); renderEncounter(); }
  async function encDel(id) {
    const list = encData();
    const i = list.findIndex(x => x.id === id); if (i < 0) return;
    if (!(await appConfirm('删除遭遇', '确定删除该遭遇（含全部单位与投骰流水）？此操作不可恢复。'))) return;
    list.splice(i, 1); persist(); renderEncounter();
  }
  /* 结算行：记录胜负时间与幸存/倒下统计 */
  function settleLine(e) {
    const st = encLiveStats(e);
    const label = e.done === 'win' ? '我方胜利' : e.done === 'fail' ? '我方败北' : '弃置';
    const at = e.doneAt ? new Date(e.doneAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    let txt = label + (at ? ' · ' + at : '') + ' · 合计 ' + st.total + ' 单位';
    if (st.alive + st.dead) txt += ' · 存活 ' + st.alive + ' / 倒下 ' + st.dead;
    if (st.nohp) txt += ' · 无血量 ' + st.nohp;
    return `<span class="hint">${esc(txt)}</span>`;
  }
  function encSettle(id, done) {
    const e = encData().find(x => x.id === id); if (!e) return;
    e.done = done || '';
    if (done) { e.doneAt = new Date().toISOString(); e._open = e._open; encLog(e, '系统', (done === 'win' ? '战斗胜利，遭遇结算' : done === 'fail' ? '战斗失败，遭遇结算' : '遭遇中途弃置')); }
    else delete e.doneAt;
    persist(); renderEncounter();
  }
  function encSetFlow(id, on) {
    const e = encData().find(x => x.id === id); if (!e) return;
    if (!e.flow) e.flow = {};
    e.flow.active = !!on;
    if (!e.order || !e.order.length) e.order = (e.units || []).map(u => u.id);
    if (on && !e.cur && e.order.length) e.cur = e.order[0];
    persist(); renderEncounter();
  }
  function encLog(e, who, text) { if (!e.combatLog) e.combatLog = []; e.combatLog.push({ t: new Date().toISOString(), who, text }); e.combatLog = e.combatLog.slice(-200); }

  /* ---- 单位管理 ---- */
  function encPull(id) {
    const e = encData().find(x => x.id === id); if (!e) return;
    const sel = q('encPick'); if (!sel || !sel.value) { toast('请先选择要拉入的资料卡', 'err'); return; }
    const [refKind, refId] = sel.value.split('|');
    const card = (S.data.entities[refKind] || []).find(x => x.id === refId); if (!card) return;
    const nm = card.name || card.title || '未命名';
    const unit = { id: uid(), kind: refKind, kindLabel: DATA_TYPE[refKind] || refKind, refId, name: nm, curHp: hpFromCard(card), maxHp: hpFromCard(card), status: [] };
    if (!e.units) e.units = [];
    if (!e.units.some(x => x.name === nm)) e.units.push(unit);
    else { toast('同名单位已在场，如需复数请用「手动单位」', 'err'); return; }
    if (e.order && e.order.length) e.order.push(unit.id);
    encLog(e, '系统', `加入单位「${nm}」`);
    persist(); renderEncounter();
  }
  function encAddManual(id) {
    const e = encData().find(x => x.id === id); if (!e) return;
    appPrompt({ title: '手动添加单位', label: '输入名称与当前/最大 HP（如：狼群 · 12/12；留空则无血量）', placeholder: '名称 · 当前/最大', okText: '添加' }, (v) => {
      if (v == null) return;
      const raw = String(v).trim(); if (!raw) { toast('名称不能为空', 'err'); return; }
      const m = /^\s*([^\·|]*)\s*[·|]\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw);
      let nm = raw, curHp, maxHp;
      if (m) { nm = m[1].trim(); curHp = parseInt(m[2], 10); maxHp = parseInt(m[3], 10); }
      const unit = { id: uid(), kind: 'manual', kindLabel: '手动', refId: null, name: nm || '未命名', curHp: curHp != null ? curHp : null, maxHp: maxHp != null ? maxHp : null, status: [] };
      if (!e.units) e.units = [];
      e.units.push(unit);
      if (e.order && e.order.length) e.order.push(unit.id);
      encLog(e, '系统', `手动添加单位「${nm}」`);
      persist(); renderEncounter();
    });
  }
  function encDelUnit(eid, uid) {
    const e = encData().find(x => x.id === eid); if (!e) return;
    e.units = (e.units || []).filter(x => x.id !== uid);
    e.order = (e.order || []).filter(x => x !== uid);
    if (e.cur === uid) { e.cur = (e.order.length ? e.order[0] : null); encLog(e, '系统', '当前行动者已除名，自动转移'); }
    encLog(e, '系统', '移除单位');
    persist(); renderEncounter();
  }
  /* 有血量的单位才计入存活/倒下；无血量（手动单位）不计入任一分组 */
  function encLiveStats(e) {
    const units = e.units || [];
    const alive = units.filter(u => u.curHp != null && (u.curHp > 0)).length;
    const dead = units.filter(u => u.curHp != null && !(u.curHp > 0)).length;
    const nohp = units.length - alive - dead;
    return { total: units.length, alive, dead, nohp };
  }
  function hpFromCard(c) {
    // 卡片可能用 hp / HP / 血量 / health 等字段名
    const v = c.hp != null ? c.hp : c.HP != null ? c.HP : c.health != null ? c.health : c['最大生命值'] != null ? c['最大生命值'] : c['生命值'] != null ? c['生命值'] : null;
    const n = Number(v);
    return (v != null && !isNaN(n)) ? Math.max(0, n) : null;
  }
  function encHp(eid, uId, d) {
    const e = encData().find(x => x.id === eid); if (!e) return;
    const u = (e.units || []).find(x => x.id === uId); if (!u) return;
    const isNull = u.curHp == null;
    if (isNull) { u.curHp = Math.max(0, (u.maxHp != null ? u.maxHp : 0) + d); if (u.maxHp == null) u.maxHp = u.curHp; }
    else u.curHp = Math.max(0, (u.curHp || 0) + d);
    if (u.curHp <= 0 && (u.status || []).indexOf('down') < 0) { u.status = u.status || []; u.status.unshift('down'); encLog(e, u.name, (d < 0 ? '生命归零' : '')); }
    encLog(e, u.name, (d < 0 ? '受到 ' + (-d) + ' 点伤害' : '恢复 ' + d + ' 点生命'));
    persist(); renderEncounter();
  }
  function encToggleStatus(eid, uId, st) {
    const e = encData().find(x => x.id === eid); if (!e) return;
    const u = (e.units || []).find(x => x.id === uId); if (!u) return;
    if (!Array.isArray(u.status)) u.status = [];
    const i = u.status.indexOf(st);
    if (i >= 0) { u.status.splice(i, 1); encLog(e, u.name, '解除状态'); }
    else { u.status.unshift(st); encLog(e, u.name, '附加状态：' + (ENC_STATUS.find(x => x[0] === st) || [,''])[1]); }
    persist(); renderEncounter();
  }
  function encGoRef(kind, refId) {
    closeModal();
    S.view = 'dash';
    goToEntity(kind, refId);
  }

  /* ---- 回合控制 ---- */
  /* 归一化回合顺序：只保留仍在场的单位 id；无顺序时按在场各单位初始化。返回归一化后的数组并写回 e.order */
  function encNormOrder(e) {
    const units = e.units || [];
    const clean = (e.order && e.order.length ? e.order : units.map(u => u.id))
      .filter(id => units.some(u => u.id === id));
    e.order = clean;
    return clean;
  }
  function encNext(eid) {
    const e = encData().find(x => x.id === eid); if (!e) return;
    const order = encNormOrder(e);
    if (!order.length) { toast('请先添加单位', 'err'); return; }
    if (e.cur == null || order.indexOf(e.cur) < 0) e.cur = order[0];
    const i = order.indexOf(e.cur);
    const ni = i + 1;
    e.cur = order[ni % order.length];
    if (ni % order.length === 0) encLog(e, '系统', '进入下一轮');
    persist(); renderEncounter();
  }
  function encPrev(eid) {
    const e = encData().find(x => x.id === eid); if (!e) return;
    const order = encNormOrder(e);
    if (!order.length) { toast('请先添加单位', 'err'); return; }
    if (e.cur == null || order.indexOf(e.cur) < 0) e.cur = order[0];
    const i = order.indexOf(e.cur);
    const pi = (i <= 0 ? order.length : i) - 1;
    e.cur = order[pi];
    persist(); renderEncounter();
  }
  function encNextTo(eid, uId) {
    const e = encData().find(x => x.id === eid); if (!e) return;
    const order = encNormOrder(e);
    if (order.indexOf(uId) < 0) { toast('该单位已不在场', 'err'); return; }
    e.cur = uId;
    persist(); renderEncounter();
  }

  /* 投骰即记：骰娘投掷后若某场遭遇正在进行，把结果并入流水 */
  function encRecordRoll(entry) {
    const e = encCur();
    if (!e) return;
    encLog(e, entry.who || '投骰', entry.summary || ('掷出 ' + entry.total));
    persist();
  }

  /* ========== 统计分析（数据构成 · 投骰热力图 · 数据活跃曲线） ========== */
  const STATS_K = ['pcs', 'npcs', 'regions', 'logs', 'mobs', 'rules', 'lore', 'encounters'];
  function stsCount(k) { return ((S.data.entities && S.data.entities[k]) || []).length; }
  function renderStats() {
    const dayMs = 864e5;
    const dice = (S.settings && Array.isArray(S.settings.diceLog)) ? S.settings.diceLog : [];
    const heat = stsHeatmap(dice);
    const act = stsActivity(dice, 30, dayMs);
    // KPI 概览
    let tots = 0; const comp = [];
    for (const k of STATS_K) { const n = stsCount(k); tots += n; comp.push([k, n]); }
    const kpi = [
      ['资料总数', tots], ['日志', stsCount('logs')], ['投骰次数', dice.length], ['遭遇场次', stsCount('encounters')],
      ['近30天投骰', act.byDay.reduce((a, x) => a + x.n, 0)], ['日均(近30天)', dice.length ? (act.byDay.reduce((a, x) => a + x.n, 0) / Math.max(1, act.byDay.length)).toFixed(1) : 0]
    ].map(([l, v]) => `<div class="stat-kpi"><b>${v}</b><span>${l}</span></div>`).join('');
    let html = `<div class="page-title"><h2>统计分析</h2><span class="hint">档案数据构成 · 投骰时段热力 · 近期活跃曲线</span></div>`;
    html += `<div class="toolbar" style="margin-bottom:10px">
      <button onclick="WB.statsExport()">⬇ 导出统计文本</button>
      <button class="ghost" onclick="WB.statsCopy()">⧉ 复制概览</button>
      <span class="grow"></span><span class="hint">数据含投骰与遭遇等全部档案维度</span></div>`;
    html += `<div class="stat-kpis">${kpi}</div>`;
    // 1) 数据构成
    html += `<div class="setcard"><h4>数据构成（各类型资料条数 / 占比）</h4>${stsComposition(comp, tots)}</div>`;
    // 2) 投骰热力图
    html += `<div class="setcard"><h4>投骰热力图 <span class="hint">一周内不同时段（0-23 时 × 周一~周日）的投骰频次</span></h4>${heat}</div>`;
    // 3) 数据活跃曲线
    html += `<div class="setcard"><h4>数据活跃曲线 <span class="hint">近 ${act.days} 天累计投骰/事件数（投骰越多、团越活跃）</span></h4>${act.html}</div>`;
    contentInner(html);
  }

  /* ========== 运行记录（RunLog）========== */
  const RUNLOG_LEVELS = ['INFO', 'WARN', 'ERROR'];
  const _runlog = { day: '', level: '', query: '', buf: [] };
  async function renderRunlog() {
    let html = `<div class="page-title"><h2>📜 运行记录</h2><span class="hint">软件持续记录全过程（不只报错）。遇到问题时可在此查看，或一键导出发给我，即可快速定位。</span>
      <span style="flex:1"></span>
      <button onclick="WB.runlogExport()" class="ghost" id="rlExport">⬇ 导出记录</button>
      <button onclick="WB.runlogOpen()" class="ghost" title="在文件夹中查看原始日志">🗔 打开日志文件夹</button>
      <button onclick="WB.runlogRefresh()" class="ghost">↻ 刷新</button></div>`;
    // 日志文件夹位置提示（用户可直接到该文件路径自己找，也能发给你）
    const fp = (await window.api.runlog.folder().catch(() => null));
    if (fp && fp.path) {
      html += `<div class="setcard" style="margin-bottom:10px"><b>保存位置：</b><code style="word-break:break-all">${esc(fp.path)}</code>
        <span class="hint" style="display:block;margin-top:4px">每次运行都写入 <b>latest.log</b>（最近运行记录，固定路径）；按天另存为 2026-09-28.log 等文件。发生问题时可到该文件夹直接取出，或点「⬇ 导出记录」打包给我。</span></div>`;
    }
    // 过滤器
    html += `<div class="toolbar" style="margin-bottom:10px;flex-wrap:wrap;gap:6px">
      <span class="hint">日期：</span><select id="rlDay" onchange="WB.runlogPickDay(this.value)" style="max-width:160px"></select>
      <span class="hint">等级：</span><select id="rlLevel" onchange="WB.runlogFilter()"><option value="">全部</option>${RUNLOG_LEVELS.map(l => `<option${_runlog.level === l ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input id="rlQuery" value="${esc(_runlog.query)}" placeholder="关键词过滤…" style="max-width:220px" onkeydown="if(event.key==='Enter')WB.runlogFilter()">
      <button class="ghost" onclick="WB.runlogFilter()">筛选</button>
      <button class="ghost" onclick="WB.runlogClearFilter()">清除</button>
      <span class="grow"></span><span class="hint" id="rlCount"></span></div>`;
    html += `<div class="setcard" style="padding:0;overflow:hidden"><pre id="rlBody" class="runlog-body">加载中…</pre></div>`;
    contentInner(html);
    // 填充日期下拉 + 读取日志
    const dayList = (await window.api.runlog.list().catch(() => [])) || [];
    // 默认展示“最近运行（latest.log）”，用户一进来就能看到本次运行的过程
    if (!_runlog.day) { if (dayList.some(d => d.day === 'latest')) _runlog.day = 'latest'; else if (dayList.length) _runlog.day = dayList[0].day; }
    const daySel = document.getElementById('rlDay');
    if (daySel) {
      daySel.innerHTML = `<option value="">全部 (含每日文件)</option>` + dayList.map(d => `<option value="${d.day}"${_runlog.day === d.day ? ' selected' : ''}>${d.label || d.day}</option>`).join('');
      if (_runlog.day && !dayList.some(d => d.day === _runlog.day)) _runlog.day = '';
    }
    await loadRunlogBody();
  }
  async function loadRunlogBody() {
    const body = document.getElementById('rlBody');
    const cnt = document.getElementById('rlCount');
    if (!body) return;
    body.textContent = '加载中…';
    const r = await window.api.runlog.read({ day: _runlog.day || undefined, level: _runlog.level || undefined, query: _runlog.query || undefined }).catch(() => null) || { lines: [], days: [] };
    const lines = r.lines || [];
    body.innerHTML = lines.length
      ? lines.map(l => `<div>[<span class="rl-t">${esc(l.t)}</span>] [<b class="rl-${l.lv.toLowerCase()}">${l.lv}</b>] <span class="hint">${esc(_runlog.day ? '' : l.day)}</span>${esc(l.msg)}</div>`).join('\n')
      : '<span class="hint">（当前筛选条件下暂无记录）</span>';
    if (cnt) cnt.textContent = `共 ${lines.length} 条`;
  }
  function runlogRefresh() { loadRunlogBody(); }
  function runlogFilter() {
    const q = document.getElementById('rlQuery'); if (q) _runlog.query = q.value.trim();
    const lv = document.getElementById('rlLevel'); if (lv) _runlog.level = lv.value;
    loadRunlogBody();
  }
  function runlogPickDay(v) { _runlog.day = v || ''; loadRunlogBody(); }
  function runlogClearFilter() {
    _runlog.day = ''; _runlog.level = ''; _runlog.query = '';
    const q = document.getElementById('rlQuery'); if (q) q.value = '';
    const lv = document.getElementById('rlLevel'); if (lv) lv.value = '';
    renderRunlog();
  }
  async function runlogExport() {
    const btn = document.getElementById('rlExport'); if (btn) { btn.disabled = true; btn.textContent = '导出中…'; }
    const r = await window.api.runlog.export().catch(e => ({ ok: false, error: String(e && e.message || e) }));
    if (btn) { btn.disabled = false; btn.textContent = '⬇ 导出记录'; }
    if (r && r.canceled) return;
    if (r && r.ok) toast('运行记录已导出：' + r.path, 'ok');
    else toast((r && r.error) || '导出失败', 'err');
  }
  function runlogOpen() { window.api.runlog.open(); }
  /* 数据构成：横向条形（SVG/纯 HTML 均可读） */
  function stsComposition(comp, tots) {
    if (!tots) return `<div class="empty">暂无资料，先到各类型页新增内容即可看到占比。</div>`;
    const max = Math.max(1, ...comp.map(c => c[1]));
    const rows = comp.filter(c => c[0] !== 'encounters').map(([k, n]) => {
      const pct = (tots ? (n / tots * 100) : 0);
      const w = Math.max(0, n / max * 100);
      return `<div class="stat-barrow">
        <span class="stat-bar-name">${DATA_TYPE[k] || k}</span>
        <span class="stat-bar-track"><i style="width:${w}%"></i></span>
        <span class="stat-bar-val">${n}<em>${pct.toFixed(1)}%</em></span>
      </div>`;
    }).join('');
    return `<div class="stat-bars">${rows}</div><div class="hint" style="margin-top:6px">折线类图表用「投骰时间戳」绘制（档案实体多无建造时间，故以投骰作为活跃基线）。</div>`;
  }
  /* 投骰热力图：7 行(周一~周日) × 24 列(小时)，返回 SVG/HTML 矩阵 */
  function stsHeatmap(dice) {
    const grid = []; // [day(0=Mon)][hour]
    for (let d = 0; d < 7; d++) grid.push(new Array(24).fill(0));
    const WD = ['一', '二', '三', '四', '五', '六', '日'];
    for (const it of dice) {
      const t = it && it.t ? new Date(String(it.t)) : null;
      if (!t || isNaN(t.getTime())) continue;
      grid[(t.getDay() + 6) % 7][t.getHours()]++;
    }
    let mx = 1; for (const r of grid) for (const v of r) mx = Math.max(mx, v);
    const cell = 22, gap = 2, pad = 30, ch = cell * 7 + gap * 6;
    let s = `<svg viewBox="0 0 ${pad + 24 * (cell + gap) + 8} ${ch + 18}" style="width:100%;max-width:760px;display:block">
      ${WD.map((dd, d) => `<text x="4" y="${pad + d * (cell + gap) + cell - 6}" font-size="11" fill="var(--ink-faint)">${dd}</text>`).join('')}
      ${grid.map((row, d) => row.map((v, h) => {
        const t = v ? Math.max(1, Math.round((v / mx) * 100)) : 0;
        const col = t <= 0 ? 'var(--bg3)' : (t < 25 ? 'color-mix(in srgb,var(--accent) 28%,var(--bg3))' : t < 55 ? 'color-mix(in srgb,var(--accent) 55%,var(--bg3))' : t < 85 ? 'color-mix(in srgb,var(--accent) 78%,var(--bg3))' : 'var(--accent)');
        return `<rect x="${pad + h * (cell + gap)}" y="${d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="${col}">
          <title>周${WD[d]} ${h} 时：${v} 次</title></rect>`;
      }).join('')).join('')}
      ${Array.from({ length: 24 }, (_, h) => h % 3 === 0 ? `<text x="${pad + h * (cell + gap) + 4}" y="${ch + 14}" font-size="10" fill="var(--ink-faint)">${h}</text>` : '').join('')}
    </svg>`;
    const maxDay = grid.reduce((a, r) => a + r.reduce((x, v) => x + v, 0), 0);
    const peak = grid.map((r, di) => r.reduce((m, v, h) => v > m.n ? { n: v, h } : m, { n: 0, h: -1 }).n)
      .reduce((a, n, di) => n > a.n ? { n, di } : a, { n: 0, di: -1 });
    const peakTxt = (peak && peak.n && peak.di >= 0)
      ? `密集时段：周${WD[peak.di]} · ${grid[peak.di].reduce((m, v, h) => v > m.n ? { n: v, h } : m, { n: 0 }).h} 时（${peak.n} 次）`
      : '尚无有效投骰记录';
    return `<div class="stat-heat">${s}<div class="hint" style="margin-top:6px">共 ${maxDay} 次投骰 · ${peakTxt} · 深色=更频繁</div></div>`;
  }
  /* 数据活跃曲线：近 N 天累计投骰（SVG 面积/折线） */
  function stsActivity(dice, days, dayMs) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const byDay = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(now.getTime() - i * dayMs); byDay.push({ d, n: 0 }); }
    const idx = new Map(byDay.map((x, i) => [x.d.getTime(), i]));
    for (const it of dice) {
      const t = it && it.t ? new Date(String(it.t)) : null;
      if (!t || isNaN(t.getTime())) continue;
      const k = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
      const i = idx.get(k); if (i !== undefined) byDay[i].n++;
    }
    let cum = 0; const series = byDay.map(x => { cum += x.n; return cum; });
    const W = byDay.length, H = 120, pad = 8;
    const VW = 600, maxC = Math.max(1, series[series.length - 1] || 1);
    const px = i => pad + (i / Math.max(1, W - 1)) * (VW - pad * 2);
    const py = v => H - pad - (v / maxC) * (H - pad - 8);
    const pts = series.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
    const area = `${px(0)},${H} ${pts} ${px(W - 1)},${H}`;
    // 最近若干天为时间轴刻度
    const ticks = [0, Math.floor((W - 1) / 3), Math.floor(2 * (W - 1) / 3), W - 1];
    return { days: W, byDay,
      html: `<div class="stat-activity">
        <svg viewBox="0 0 ${VW} ${H + 18}" style="width:100%;max-width:740px;display:block">
          <polyline points="${area}" fill="color-mix(in srgb,var(--accent) 22%,transparent)" stroke="none"></polyline>
          <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"></polyline>
          ${ticks.map(i => `<text x="${px(i)}" y="${H + 12}" font-size="10" fill="var(--ink-faint)" text-anchor="middle">${byDay[i].d.getMonth() + 1}/${byDay[i].d.getDate()}</text>`).join('')}
          <text x="${VW}" y="10" font-size="10" fill="var(--ink-faint)" text-anchor="end">累计 ${series[series.length - 1]}</text>
        </svg></div>` };
  }

  /* ========== AI 数据审查 ========== */
  async function runAudit() {
    if (!(S.settings.ai && S.settings.ai.apiKey && S.settings.ai.baseUrl && S.settings.ai.model)) {
      toast('请先在「AI 配置」填好连接并保存，再进行检查', 'err'); return;
    }
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>AI 数据审查</h3><div class="note">正在对当前档案的全部 ${Object.keys(S.data.entities).reduce((a,k)=>a+(S.data.entities[k]||[]).length,0)} 条资料做一致性检查…</div>
      <textarea id="auditOut" rows="14" readonly placeholder="检查结果将显示在这里…"></textarea>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">关闭</button></div>`;
    mask.hidden = false;
    try {
      const res = await window.api.aiAudit();
      q('auditOut').value = res;
    } catch (e) {
      q('auditOut').value = '检查失败：' + ((e && e.message) || e);
    }
  }

  /* ========== 更新公告 ========== */
  /* ========== 帮助中心 ========== */
  const HELP_CATS = [
    { id: 'start', ic: '🚀', title: '开团流程', html: () => `
      <p>从零搭建一团（一套跑团世界）的完整顺序如下：</p>
      <ol class="help-steps">
        <li><b>配置 AI（可选但推荐）</b> —— 进入「工作台 AI 功能 → AI 配置」，填写 baseUrl / 模型 / API Key 并保存，点「测试连通」验证。这样才能用 AI 拆登记、生成内容。详见下文「AI 设置」。</li>
        <li><b>新建团档案</b> —— 在「总览看板 → 开始使用」输入一个团名，点「＋ 新建档案并进入」。每套团/世界独立开档，互不干扰。</li>
        <li><b>导入原材料</b> —— 在「工作台功能」的「规则速查」「背景城设」等页面粘贴或导入你的剧本、设定、笔记（支持 txt/md/docx/pdf/xlsx）。或在「工作台 AI 功能 → 原始文本」导入纯文本整理。</li>
        <li><b>AI 拆分登记</b> —— 资料页点「AI 拆分登记」，把长文本一键拆成 人物卡 / NPC / 地区 / 日志 / 怪物 / 规则 / 背景 7 类资料卡。</li>
        <li><b>按需创作</b> —— 用「AI 助手」对话写剧情、「地图」布置场景、「本地掷骰」投掷检定、「记录润色」把跑团记录润成文章。</li>
        <li><b>定期备份</b> —— 「设置 → 偏好设置 → 数据」可手动备份（每 30 分钟与退出前自动备份），还可导出 JSON 换机交接。</li>
      </ol>` },
    { id: 'ai', ic: '🤖', title: 'AI 设置与 API 配置', html: () => `
      <div class="helph3">1. 配置接口（全局，一次搞定）</div>
      <p>进入侧栏「工作台 AI 功能 → AI 配置」：</p>
      <ol class="help-steps">
        <li><b>接口地址 baseUrl</b> —— 服务商提供的 API 根地址，如 <code>https://api.deepseek.com/v1</code>（兼容 OpenAI 格式的大模型服务均可）。</li>
        <li><b>模型 model</b> —— 你在服务商开通的模型名，如 <code>deepseek-chat</code>。</li>
        <li><b>API Key</b> —— 你的密钥，使用系统级加密保存在本机，不会明文写入数据文件。</li>
        <li>可调「温度」「超时」，然后点「保存配置」→「测试连通」确认成功。</li>
      </ol>
      <p>该连接被「AI 助手 / 剧本解析 / 记录润色 / 资料生成」统一使用。</p>
      <div class="helph3">2. 设定 AI 人设（AI 设定页）</div>
      <p>新建角色卡 = <b>人设</b>（身份/性格/生平/外貌）+ <b>话风</b>（说话方式/语气/口头禅）+ <b>设定</b>（世界观/规则/约束）。点「开启」即可套用，同一时间仅一个生效。对话时 AI 会遵循这一人设。</p>
      <div class="helph3">3. 行为开关与长期记忆（AI 配置页）</div>
      <p>可开关：启用当前人设、自动引入背景/规则作为参考、允许文件上传、启用长期记忆。长期记忆需手动逐条添加（会自动注入每次对话，保持长对话连贯），也可用「剧情要点」一键从近期对话提炼写入。</p>` },
    { id: 'data', ic: '🗂', title: '资料管理（7 类资料卡）', html: () => `
      <p>工作台把团内内容分为 7 类，侧栏「工作台功能」区逐项管理：</p>
      <ul class="help-list">
        <li><b>人物卡 (PC)</b> —— 玩家扮演的角色；AI 拆分登记时自动排除，不把玩家角色混入 NPC。</li>
        <li><b>NPC</b> —— 非玩家角色。</li>
        <li><b>地区</b> —— 场景、地点、区域。</li>
        <li><b>日志</b> —— 事件、线索、剧情点。</li>
        <li><b>怪物</b> —— 敌人与遭遇。</li>
        <li><b>规则</b> —— 规则书条目与设定。</li>
        <li><b>背景</b> —— 世界观、背景设定。</li>
      </ul>
      <p>字段可自定义（设置 → 字段），可切换卡片模板（人物卡/NPC/怪物）。每页支持「新增 / 导入 / 生成（AI） / 搜索筛选 / 编辑/删除」。</p>` },
    { id: 'tools', ic: '🛠', title: '工具使用', html: () => `
      <div class="helph3">地图</div>
      <ul class="help-list">
        <li>「＋ 新建地图」手动建图：上传底图、网格、标记、区域、迷雾，支持缩放/平移/导出 PNG，无需 AI 也能搭。</li>
        <li>「AI 设计地图」：粘贴文字描述，一键生成体型草图，预览确认后应用。</li>
      </ul>
      <div class="helph3">本地掷骰 / 骰娘鉴定</div>
      <ul class="help-list">
        <li>支持 DnD5e 与 CoC 规则，可自定义投掷表达式（如 <code>2d6+3</code>）、快捷检定与 AI 判定。</li>
      </ul>
      <div class="helph3">记录润色</div>
      <ul class="help-list">
        <li>粘贴跑团记录 → AI 补全背景润色成文章，可导出 txt；也可基于日志一键生成战报。</li>
      </ul>` },
    { id: 'diceai', ic: '🎛', title: '骰娘 AI 设置', html: () => `
      <p>侧栏「骰娘 AI 设置」专管骰娘运行时用到的 AI 能力，与工作台 AI（AI 助手 / 剧本解析 / 记录润色）相互独立。</p>
      <div class="helph3">AI 功能开关</div>
      <ul class="help-list">
        <li><b>总开关</b>：关闭后骰娘不发起任何 AI 请求，最省 token；仅此页可重新开启。</li>
        <li>可按功能细分开关：骰娘专属 AI 对话（<code>.ai</code>）、骰点文本优化、随机插话、表情包（偷表情）、KP 建议。</li>
      </ul>
      <div class="helph3">群聊 AI 行为</div>
      <ul class="help-list">
        <li><b>随机插话概率</b>：每条回复后骰娘主动接话的命中概率。</li>
        <li><b>插话附带表情概率</b>：每次插话时顺带一个收藏表情的概率。</li>
        <li>需先在「AI 功能开关」中开启对应功能，概率才会生效。</li>
      </ul>
      <div class="helph3">表情包库</div>
      <ul class="help-list">
        <li>从群里“偷”到的表情（emoji / 图片 / 文本图）会自动收集到这里，可手动录入、打标签、随机调用。</li>
        <li>关闭「表情包(meme)」开关后，插话不再附带表情，但收集仍会进行。</li>
      </ul>` },
    { id: 'chat', ic: '💬', title: 'AI 助手与侧栏对话', html: () => `
      <p>「AI 助手」页与右侧常驻抽屉（💬 AI 对话）共用同一段会话。</p>
      <ul class="help-list">
        <li>按实体类型生成 NPC / 人物卡 / 地区 / 日志 / 怪物。</li>
        <li>「润色上一段」「续写剧情」「剧情要点」「剧情建议」等快捷操作。</li>
        <li>「⇥ 把回复建为资料卡」：把最近一条 AI 回复一键拆为资料卡。</li>
        <li>「剧本解析」：粘贴剧本一键拆成多类资料，勾选后写入。</li>
      </ul>` },
    { id: 'relation', ic: '☸', title: '关系网', html: () => `
      <p>在全 canvas 上搭建角色/势力/地点之间的关系网络。</p>
      <ul class="help-list">
        <li>添加节点，用连线连接并标注类型（盟友/敌对/从属/未知），可着色。</li>
        <li>「一键整理」按连通分组自动聚簇排布；支持过滤、缩放、居中、位置持久化。</li>
        <li>「AI 建议关系」让 AI 分析现有节点给出新增关系建议；支持一键撤销误操作。</li>
      </ul>` },
    { id: 'raw', ic: '📄', title: '原始文本与剧本进度', html: () => `
      <p>导入任意文本类文件，自动去乱码、保留结构，得到纯净文本；也可用「AI 建议」在关键句子后内联插入带团建议（节奏、NPC 扮演、数值调整、线索埋设等），不改动原文本身。</p>
      <div class="helph3">剧本分幕与开团进度</div>
      <p>点「🎬 剧本分幕」可把整篇团本拆成一幕幕剧本（每幕含地点、出场人物、剧情经过、关键线索与道具）。切到「🎬 剧本分幕」标签后即可进入开团推进模式：</p>
      <ul class="help-list">
        <li><b>进度胶囊</b>：点每幕右上角的胶囊循环切换「未开始 → 进行中 → 已完成 → 略过」。把某幕设为「进行中」时，原先进行中的幕会自动收尾为「已完成」，顺位推进不会错位；也可点「设为当前」直接跳过去。</li>
        <li><b>伏笔兑现</b>：每幕「关键线索 / 伏笔」前都有勾选框，向玩家兑现后勾上即点亮划线。尚未兑现的伏笔会全部汇总在顶部的「本场待办」条里（点击可直接定位到那一幕），不再担心「埋了坑忘了填」。</li>
        <li><b>现场备注</b>：每幕底部可随手记录临场情况（玩家的选择、裁决结果、被迫偏离原剧情等），下次开团会自动带进开团清单。</li>
        <li><b>一键生成开团清单</b>：把当前幕的地点/出场/道具/线索与全部待兑现伏笔整理成一段提示词，自动填入侧栏对话并复制到剪贴板，直接发给 AI 索取本幕开场白与检查点提示。</li>
        <li><b>重开进度</b>：进度与剧本原文彻底分离，剧本内容一个字都不会被改动。随时可「重开进度」清空重来；剧本被 AI 重新分幕或幕数变化后，旧进度自动作废，不会错位勾到别的幕。</li>
      </ul>` },
    { id: 'memory', ic: '🧠', title: '长期记忆与快捷键', html: () => `
      <div class="helph3">长期记忆</div>
      <p>在「AI 配置」逐条记录关键设定/进度/待办，AI 每次对话自动注入，保持长对话连贯。「剧情要点」可一键提炼近期对话中的要点写入。</p>
      <div class="helph3">全局快捷键</div>
      <ul class="help-list">
        <li><code>Ctrl+K</code> 命令面板 · <code>Ctrl+Shift+F</code> 全局搜索</li>
        <li><code>Ctrl+N</code> 新建卡片 · <code>Ctrl+D</code> 骰娘 · <code>Ctrl+E</code> 临场战斗 · <code>Ctrl+T</code> 统计分析 · <code>Esc</code> 关闭浮层</li>
      </ul>` },
    { id: 'dataflow', ic: '🗄', title: '数据、备份与换机', html: () => `
      <ul class="help-list">
        <li><b>多档案</b>：设置 → 数据，可新建/切换/复制/删除多套团档案。</li>
        <li><b>自动备份</b>：每 30 分钟 + 退出应用前各备份一次；点「还原」可回滚。</li>
        <li><b>版本快照</b>：每次变更自动沉淀一份，一键回滚（保留最近 40 份）。</li>
        <li><b>自动自愈</b>：读档失败自动回退到最近完好备份/快照。</li>
        <li><b>导出/导入 JSON</b>：打包全部资料 + AI 内容（不含密钥等“设定”），换机交接更安全。</li>
      </ul>` },
    { id: 'about', ic: 'ℹ', title: '关于与反馈', html: () => `
      <p><b>KP 跑团工作台</b> v${APP_VERSION}（Electron 桌面版）—— 一款专为 TRPG 主持人（KP / 守密人 / GM）打造的 Windows 桌面辅助工具：资料管理、AI 辅助创作、地图与关系网、骰娘检定、记录润色、统计分析，全部收在一个免安装即用的应用里。制作人：<b>零弈秋</b>。</p>
      <ul class="help-list">
        <li><b>桌面外壳</b>：Electron（含 Chromium / Node.js），随包附第三方许可文本。</li>
        <li><b>骰娘内核</b>：自研 dice-core（表达式求值 / 规则判定 / 指令大脑 / 连接通道），可完全脱离 AI 独立运转。</li>
        <li><b>AI 能力</b>：调用你自己配置的 OpenAI 兼容接口，密钥本机加密保存，不经过本项目的任何服务器。</li>
        <li><b>数据自持</b>：资料全部保存在本地 <code>data</code> 目录，不上传、不经第三方服务器，请定期备份。</li>
        <li><b>免费</b>：个人独立开发的免费辅助工具，请勿用于商业用途。</li>
      </ul>
      <div class="helph3">借鉴与第三方说明</div>
      <p>本项目整体为自研实现，除下列明确列明的参考内容外，<b>不复制、不捆绑任何第三方软件的代码、素材、插件包、台词、人设与品牌</b>；发布前会经零第三方残留扫描强制校验。凡有参考，均在此列明：</p>
      <ul class="help-list">
        <li><b>DiceZone / Dice-Next</b>（AGPL-3.0 开源骰娘）—— 为让用户沿用既有操作习惯，<b>参照其公开指令表对齐了骰娘指令的名称与写法</b>（如 <code>.ra</code> / <code>.rd</code> / <code>.en</code> / <code>.log</code> 等；指令语法属通行习惯，不涉及代码复制）。CoC 房规分档（0–7 号）与疯狂症状表（<code>.ti</code> / <code>.li</code>）均<b>依据 CoC 7th 公开规则自行实现</b>，未复制其源码或数据。程序整体运行于自研 dice-core 内核，不捆绑其可执行文件与素材。</li>
        <li><b>第三方跑团工具「枭雄」</b> —— 地图模块的界面格局与操作呈现风格（v2.4.0 起），仅参考交互与布局思路，未使用其代码、素材与数据格式。</li>
        <li><b>OneBot 11</b>（社区公开协议标准）—— 骰娘接入 QQ 个人号的连接协议；按公开标准自行实现，<b>不随包捆绑任何第三方协议端</b>，需用户自备合规协议端，不逆向 QQ 私有协议。</li>
        <li><b>QQ 官方机器人开放平台 API</b>（腾讯公开接口）—— 骰娘接入官方机器人的通道，仅调用公开开放接口并自行适配。</li>
        <li><b>CoC 7th / DnD 5e</b> 规则体系 —— 检定分档与规则插件的规则依据，使用公开的规则体系本身，条目内容自行撰写与整理。</li>
        <li><b>Electron / Chromium / Node.js</b> —— 桌面运行时与打包基础，开源组件，随包附第三方许可文本。</li>
      </ul>
      <div class="helph3">侵权联系删除</div>
      <p>本项目尊重一切在先权利。若你是某项内容的权利人，认为本软件（含代码、文档、界面文案、示例数据或发布产物）中的任何部分侵犯了你的合法权益，请附权利证明与具体位置联系 <b>QQ 247910428</b>（或在本仓库提交 Issue）；核实后我们会立即删除或修改相关内容、必要时下架对应版本，并公开说明处理结果。上述说明如有表述不当之处，同样欢迎指出，我们将立即更正。</p>
      <div class="helph3">免责声明</div>
      <p>本工具为免费个人辅助软件，数据由用户自行录入与保管，请定期备份；使用中造成的任何损失（含数据丢失）作者概不负责，请勿用于商业用途或违反所在平台规则。内容仅供 TRPG 跑团与创作参考。</p>
      <p>Bug / 建议反馈 QQ：<b>247910428</b>。</p>` }
  ];
  function renderHelp() {
    let html = `<div class="page-title"><h2>帮助中心</h2><span class="hint">功能使用手册 · 开团流程 · AI 配置 · 分门别类随时查阅</span></div>`;
    html += `<div class="helpgrid"><aside class="helpnav">`;
    for (const c of HELP_CATS) {
      html += `<button class="ghost helpnav-item" onclick="document.getElementById('help-${c.id}').scrollIntoView({behavior:'smooth',block:'start'})">${c.ic} ${c.title}</button>`;
    }
    html += `</aside><div class="helpbody">`;
    for (const c of HELP_CATS) {
      html += `<div class="setcard helpcard" id="help-${c.id}"><h4>${c.ic} ${c.title}</h4>${c.html()}</div>`;
    }
    html += `</div></div>`;
    contentInner(html);
  }

  /* ---- 更新公告 / 自更新入口 ----
   * 状态：idle | checking | none | available | progress | staged | applying | err
   * 流程：检查 → 有新版本自动下载 → 下载完成弹窗询问「立即重启更新 / 稍后」。
   * 真正的替换由主进程 helper 脚本在退出后完成（见 src/main/updater）。 */
  function updaterApi() { return (window.api && window.api.updater) || null; }
  function updHumanSize(n) {
    n = Number(n) || 0;
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  function renderChangelog() {
    const upd = (S.settings && S.settings.updates) || {};
    const st = upd.state || 'idle';
    const busy = (st === 'checking' || st === 'progress' || st === 'applying');
    const pct = Math.max(0, Math.min(100, Number(upd.percent) || 0));
    const hasApi = !!updaterApi();
    let actions = '';
    if (!hasApi) actions = '';
    else if (st === 'staged') actions = `<button onclick="WB.restartUpdate()">⟳ 立即重启更新</button><button class="ghost" onclick="WB.laterUpdate()">稍后</button>`;
    else if (st === 'available') actions = `<button onclick="WB.startUpdateDownload()">↓ 下载更新${upd.latest ? ' v' + esc(upd.latest) : ''}</button><button class="ghost" onclick="WB.openReleasePage()">打开下载页</button>`;
    else actions = `<button class="ghost" onclick="WB.checkUpdate()" ${busy ? 'disabled' : ''}>↻ ${st === 'checking' ? '检查中…' : st === 'progress' ? '下载中…' : '检查更新'}</button><button class="ghost" onclick="WB.openReleasePage()">打开下载页</button>`;

    let status = '';
    if (!hasApi) status = '当前环境未启用自更新（需在桌面版 EXE 内使用）。';
    else if (st === 'checking') status = '正在检查更新…';
    else if (st === 'none') status = '当前已是最新版本。';
    else if (st === 'progress') status = '正在下载更新… ' + pct + '%' + (upd.total ? '（' + updHumanSize(upd.received) + ' / ' + updHumanSize(upd.total) + '）' : '');
    else if (st === 'staged') status = '新版本 ' + (upd.latest ? 'v' + esc(upd.latest) + ' ' : '') + '已下载完成，重启后生效。';
    else if (st === 'applying') status = '正在更新，应用即将自动重启…';
    else if (st === 'err') status = '更新不可用：' + esc(upd.error || '未知错误');
    else if (st === 'available') status = '发现新版本 ' + (upd.latest ? 'v' + esc(upd.latest) + ' ' : '') + '，正在准备下载…';
    else status = '可点击右上角「检查更新」获取最新版本。';

    let html = `<div class="page-title"><h2>更新公告</h2><span class="hint">当前版本 v${APP_VERSION}</span>
      <span style="flex:1"></span>${actions}</div>`;

    if (hasApi) {
      html += `<div class="setcard"><h4>更新状态</h4><div class="note" style="white-space:normal;line-height:1.8">`;
      html += `<div>运行形态：<b>${esc(upd.modeLabel || '未知')}</b>`;
      if (upd.canAutoApply === false) html += `　<span style="color:var(--warn,#d8a657)">（程序目录不可写，无法自动替换，请用「打开下载页」手动更新）</span>`;
      html += `</div><div id="updState" style="margin-top:4px">${status}</div>`;
      if (st === 'progress') {
        html += `<div style="margin-top:8px;height:10px;border-radius:6px;background:var(--bg-soft,#2c2c2c);overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent,#e0663a);transition:width .25s ease"></div></div>`;
      }
      if (upd.notice) html += `<div class="hint" style="margin-top:6px">${esc(upd.notice)}</div>`;
      if (upd.latest && (st === 'available' || st === 'progress' || st === 'staged')) {
        html += `<div class="hint" style="margin-top:8px">最新版本：v${esc(upd.latest)}${upd.publishedAt ? '　发布于 ' + esc(String(upd.publishedAt).slice(0, 10)) : ''}</div>`;
        if (upd.notes) html += `<details style="margin-top:6px"><summary style="cursor:pointer">查看本次更新说明</summary><div class="hint" style="white-space:pre-wrap;margin-top:6px;max-height:220px;overflow:auto">${esc(String(upd.notes).slice(0, 2000))}</div></details>`;
      }
      html += `</div></div>`;
    }

    html += `<div class="changelog">`;
    for (const v of CHANGELOG) {
      html += `<div class="logentry"><div class="lhead"><b>v${v.version}</b><span>${v.date}</span></div><ul>${v.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
    }
    html += `</div>`;
    html += `<div class="credit" style="margin-top:20px;color:var(--ink-faint);font-size:12px;line-height:1.8">🎨 制作人：零弈秋　·　🐞 Bug/建议反馈 QQ：247910428<br>免责声明：本工具为免费个人辅助软件，数据由用户自行保管，请定期备份；使用中若造成数据丢失等损失，作者概不负责，请勿用于商业用途。<br>借鉴与第三方说明：骰娘指令的名称与写法参照开源项目 DiceZone / Dice-Next（AGPL-3.0）公开指令表对齐，CoC 房规分档与疯狂症状表均依据 CoC 7th 公开规则自行实现；完整清单与侵权联系删除办法见「系统 → 帮助中心 → 关于与反馈」。</div>`;
    contentInner(html);
  }
  function updSetState(patch) {
    if (!S.settings.updates) S.settings.updates = {};
    Object.assign(S.settings.updates, patch || {});
    persist();
    if (S.view === 'changelog') renderChangelog();
  }
  async function checkUpdate() {
    const api = updaterApi();
    if (!api) { toast('当前环境不支持自更新，请使用桌面版', 'err'); return; }
    updSetState({ state: 'checking', error: '', percent: 0, received: 0, total: 0, notice: '', _prompted: false });
    let r;
    try { r = await api.check(); }
    catch (e) { updSetState({ state: 'err', error: String((e && e.message) || e) }); toast('检查失败', 'err'); return; }
    /* 有新版本时：状态推送会置为 available 并自动触发下载；这里只补齐元信息，避免覆盖已开始的下载态 */
    if (r && r.ok && r.hasUpdate) {
      const cur = (S.settings.updates || {}).state;
      updSetState({ latest: r.latest, tag: r.tag, publishedAt: r.publishedAt, notes: r.notes, modeLabel: r.modeLabel, canAutoApply: r.canAutoApply });
      if (cur !== 'progress' && cur !== 'staged') updSetState({ state: 'available', notice: '' });
      toast('检测到新版本 v' + r.latest);
    } else if (r && r.ok) {
      updSetState({ state: 'none', notice: '', percent: 0 });
      toast('已是最新版本', 'ok');
    } else {
      updSetState({ state: 'err', error: (r && r.error) || '未知错误' });
      toast((r && r.error) || '检查失败', 'err');
    }
  }
  async function startUpdateDownload() {
    const api = updaterApi();
    if (!api) return;
    const up = (S.settings.updates = S.settings.updates || {});
    if (up.state === 'progress') return;
    up._prompted = false;
    updSetState({ state: 'progress', percent: 0, received: 0, total: 0, error: '', notice: '' });
    let r;
    try { r = await api.download({}); }
    catch (e) { updSetState({ state: 'err', error: String((e && e.message) || e) }); toast('下载失败', 'err'); return; }
    if (r && r.ok) {
      /* staged 的 UI 状态与重启询问统一由状态推送处理，避免重复弹窗 */
      updSetState({ state: 'staged', percent: 100, latest: up.latest || '', notice: '' });
    } else {
      updSetState({ state: 'err', error: (r && r.error) || '下载失败' });
      toast((r && r.error) || '下载失败', 'err');
    }
  }
  /* 下载完成后的「是否立即重启更新」询问（全局只弹一次） */
  let _updPromptBusy = false;
  function onUpdateStaged(version) {
    const up = (S.settings.updates = S.settings.updates || {});
    if (up._prompted) return;
    up._prompted = true;
    if (_updPromptBusy) return;
    _updPromptBusy = true;
    setTimeout(async () => {
      const v = version || up.latest || '';
      try {
        const yes = await appConfirm('更新已就绪', '新版本' + (v ? ' v' + v : '') + '已下载完成，是否立即重启并完成更新？\n\n点「确定」：关闭应用 → 自动替换文件 → 重新启动（期间请勿手动操作）。\n点「取消」：稍后可在「更新公告」页点「立即重启更新」生效。');
        if (yes) await window.api.updater.apply();
        else await window.api.updater.later();
      } catch (_) {} finally { _updPromptBusy = false; if (S.view === 'changelog') renderChangelog(); }
    }, 400);
  }
  async function restartUpdate() {
    const api = updaterApi(); if (!api) return;
    let r; try { r = await api.apply(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (r && r.ok) { toast('正在更新，应用即将自动重启…', 'ok'); updSetState({ state: 'applying', notice: r.notice || '正在更新，应用即将自动重启…' }); }
    else toast((r && r.error) || '无法启动更新', 'err');
  }
  async function laterUpdate() {
    const api = updaterApi(); if (!api) return;
    try { await api.later(); } catch (_) {}
    updSetState({ state: 'staged', notice: '更新包已下载，可随时点「立即重启更新」生效。' });
    toast('已暂缓更新，可稍后在此页重启生效');
  }
  async function openReleasePage() {
    const api = updaterApi(); if (!api) return;
    try { await api.openRelease('page'); } catch (_) { toast('无法打开下载页', 'err'); }
  }
  function saveUpdateSettings() {
    const up = (S.settings.updates = S.settings.updates || {});
    up.autoCheck = !!(q('updAutoCheck') && q('updAutoCheck').checked);
    up.autoDownload = !!(q('updAutoDownload') && q('updAutoDownload').checked);
    const iv = q('updInterval');
    if (iv) up.checkIntervalHours = Math.max(1, Math.min(720, parseInt(iv.value, 10) || 24));
    const mi = q('updMirror');
    if (mi) up.mirror = mi.value.trim();
    persist(); toast('更新设置已保存', 'ok');
  }
  async function delPersona(id) {
    if (!(await appConfirm('删除角色卡', '确定删除该角色卡？'))) return;
    S.profiles = S.profiles.filter(x => x.id !== id);
    if (S.activeProfile && S.activeProfile.id === id) { S.activeProfile = null; S.settings.activeProfileId = ''; }
    persist(); switchView('persona'); updateTopProfile();
  }
  function setActive(id) {
    const p = S.profiles.find(x => x.id === id);
    if (!p) return;
    S.activeProfile = p; S.settings.activeProfileId = id;
    persist(); switchView('persona'); updateTopProfile(); updateDashIfShown();
  }
  /* AI 设定页的「开启」开关：开启则套用该人设，同一时间仅一个生效；关闭则撤销当前人设 */
  function togglePersona(id, on) {
    if (on) {
      const p = S.profiles.find(x => x.id === id);
      if (!p) return;
      S.activeProfile = p; S.settings.activeProfileId = id;
      toast('已开启人设：' + (p.name || '未命名') + '（同时仅一个生效）', 'ok');
    } else if (S.activeProfile && S.activeProfile.id === id) {
      S.activeProfile = null; S.settings.activeProfileId = '';
      toast('已关闭当前人设');
    } else return;
    persist(); switchView('persona'); updateTopProfile(); updateDashIfShown();
  }

  /* ========== 设置 ========== */
  function renderSettings() {
    const tab = (S.settingsTab === 'ai') ? 'appearance' : (S.settingsTab || 'appearance'); // 原“AI”标签并入 AI 配置页，避免重复/冲突
    const tabs = [['appearance', '🎨 外观'], ['fields', '🧬 字段'], ['prompts', '✏ AI 提示词'], ['data', '🗄 数据'], ['about', 'ℹ 关于']];
    html = `<div class="page-title"><h2>设置</h2><span class="hint">按分类管理，点顶部标签切换小项；AI 连接 / 行为开关 / 长期记忆请在侧栏「AI 配置」统一设置</span></div>
      <div class="settabs">${tabs.map(([k, l]) => `<button class="stab${tab === k ? ' active' : ''}" onclick="WB.setSettingsTab('${k}')">${l}</button>`).join('')}</div>
      <div class="setgrid" id="settingsBody"></div>`;
    contentInner(html);
    paintSettingsTab(tab);
  }
  function setSettingsTab(tab) { S.settingsTab = tab; renderSettings(); }
  function setAiFlag(key, val) {
    S.settings.ai = S.settings.ai || {};
    S.settings.ai[key] = !!val;
    persist(); toast('已更新 AI 开关');
  }
  function aiToggleRow(id, key, title, desc) {
    const on = !!(S.settings && S.settings.ai && S.settings.ai[key]);
    return `<label class="toggle-row"><input type="checkbox" ${on ? 'checked' : ''} onchange="WB.setAiFlag('${key}', this.checked)">
      <span><b>${title}</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">${desc}</span></span></label>`;
  }
  function paintSettingsTab(tab) {
    const body = q('settingsBody'); if (!body) return;
    let h = '';
    if (tab === 'appearance') {
      const hiddens = (S.settings.layout && Array.isArray(S.settings.layout.dashHidden)) ? S.settings.layout.dashHidden : [];
      const tiles = [['pcs', '人物卡'], ['npcs', 'NPC'], ['regions', '地区'], ['logs', '日志'], ['mobs', '怪物'], ['ai', 'AI 助手'], ['persona', 'AI 设定']];
      h += `<div class="setcard"><h4>主题皮肤</h4><div class="toolbar">`;
      for (const [k, l] of THEMES) h += `<button data-app="theme" data-theme="${k}" class="${S.settings.theme === k ? '' : 'ghost'}" onclick="WB.setTheme('${k}')">${l}</button>`;
      h += `</div></div>`;
      const dens = (S.settings.layout && S.settings.layout.density) || 'comfortable';
      h += `<div class="setcard"><h4>卡片密度</h4><div class="toolbar">
        <button data-app="dens" data-dens="comfortable" class="${dens !== 'compact' ? '' : 'ghost'}" onclick="WB.setDensity('comfortable')">舒适（宽松留白）</button>
        <button data-app="dens" data-dens="compact" class="${dens === 'compact' ? '' : 'ghost'}" onclick="WB.setDensity('compact')">紧凑（信息密排）</button>
        <span class="hint">影响卡片间距、字号与最小宽度；顶栏「▤ 密度」可快速切换。</span>
      </div></div>`;
      const wname = (S.settings.appName) || '残火纪', wsub = (S.settings.appSub) || '';
      h += `<div class="setcard"><h4>工作台 / 团名（用于重命名团档案与窗口标题）</h4>
        <div class="row"><label>团名（主题名）</label><input id="setAppName" value="${esc(wname)}"></div>
        <div class="row"><label>副标题（可选）</label><input id="setAppSub" value="${esc(wsub)}" placeholder="如：烬中寻火"></div>
        <div style="margin-top:10px"><button onclick="WB.saveAppName()">保存团名</button></div>
        <div class="hint" style="margin-top:8px">AI 对话/润色也用此名称呼本团；新建档案默认以此命名。</div></div>`;
      const narr = (S.settings && S.settings.narrStyle) || '';
      h += `<div class="setcard"><h4>叙事风格（AI 贴合）</h4>
        <div class="row"><label>本团希望的叙事/文风（可写流派、口吻、禁忌，AI 全程贴合）</label>
        <textarea id="setNarrStyle" rows="3" placeholder="例：克苏鲁冷冽悬疑·第三人称·环境细节丰富但不过度堆砌；对白含蓄留白；允许适度黑暗但避免无意义猎奇。">${esc(narr)}</textarea></div>
        <div style="margin-top:10px"><button onclick="WB.saveNarrStyle()">保存叙事风格</button>
          <span class="hint" style="margin-left:8px">保存后注入每次 AI 对话与润色的上下文，作为最高优先级偏好。</span></div></div>`;
      h += `<div class="setcard"><h4>看板布局</h4><div style="display:flex;flex-wrap:wrap;gap:10px">`;
      for (const [k, l] of tiles) {
        const hid = hiddens.includes(k);
        h += `<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" ${hid ? '' : 'checked'} onchange="WB.toggleTile('${k}',this.checked)"> ${l}</label>`;
      }
      h += `</div><div style="margin-top:12px"><button class="ghost" onclick="WB.resetLayout()">重置看板排序</button></div></div>`;
    } else if (tab === 'fields') {
      h += `<div class="setcard"><h4>字段自定义</h4><div id="fieldEditor"></div></div>`;
    } else if (tab === 'prompts') {
      h += `<div class="setcard" id="promptCard"><div class="note">加载提示词模板…</div></div>
        <div class="setcard" id="promptHubCard"><div class="note">加载提示词中枢（总提示词 / 各场景 / 分场景记忆）…</div></div>
        <div class="setcard"><h4>内容安全过滤（可编辑）</h4>
          <label class="toggle-row" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <input type="checkbox" id="mod_master" ${(S.settings.ai && S.settings.ai.moderate !== false) ? 'checked' : ''} onchange="WB.setAiFlag('moderate', this.checked)">
            <span><b>启用内容安全过滤</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">拦截面向真实未成年人的性内容、自残自杀指导、非法毒品、提示词注入等高危请求并说明；不影响 TRPG 虚构创作。建议保持开启。改动即保存。</span></span></label>
          <div class="note" style="margin-bottom:8px">以下为逐条规则：每条的「正则/关键词」为 JS 正则，命中即按「提示文案」拦截；可逐条开关/改/删，也可点下方「添加规则」新增。改动即保存、立即生效。</div>
          <div id="modRuleList"></div>
          <button class="ghost" onclick="WB.addModRule()" style="margin-top:8px">＋ 添加规则</button></div>`;
    } else if (tab === 'data') {
      const archiveLabel = (S.settings && S.settings.archiveLabel) || (S.meta && S.meta.archive) || 'main';
      h += `<div class="setcard"><h4>数据（多档案 / 备份）</h4>
        <div class="row"><label>当前档案：${esc(archiveLabel)}</label><span class="hint">支持多套团/世界独立开档</span></div>
        <div id="archiveList" style="margin:6px 0 2px"></div>
        <div class="toolbar"><input id="newAr" placeholder="新档案名（默认用主题名）" style="flex:1;min-width:90px">
          <button onclick="WB.createArchive()">新建档案</button>
          <button class="ghost" onclick="WB.doBackup()">立即备份</button>
          <button class="ghost" onclick="WB.runAudit()">AI 检查数据</button></div>
        <div class="row" style="margin-top:8px"><label>自动备份间隔（分钟）</label>
          <input id="setAutoBackup" type="number" min="1" max="1440" value="${esc(S.settings.autoBackupMinutes || 30)}" placeholder="默认 30">
          <button class="ghost" onclick="WB.saveAutoBackup()">保存</button>
          <span class="hint">退出应用前始终自动备份一次；此处 1~1440 分钟，保存后即时生效</span></div>
        <div class="toolbar" style="margin-top:10px;flex-wrap:wrap">
          <button class="ghost" onclick="WB.aiOpenUsagePanel()">🧮 AI 用量（token / 耗时）</button>
          <button class="ghost" onclick="WB.aiCancelCurrent()">✕ 取消在飞 AI 任务</button>
        </div>
        <div id="backupList" style="margin-top:8px"></div>
        <h4 style="margin-top:14px">自动版本快照（数据每次变更自动沉淀，随时可回滚）</h4>
        <div id="snapshotList" style="margin-top:6px"></div>
        <div class="toolbar"><button class="ghost" onclick="WB.exportData()">导出 JSON</button>
          <button class="ghost" onclick="q('imp').click()">导入 JSON</button>
          <input type="file" id="imp" accept=".json" hidden onchange="WB.importData(this)">
          <button class="ghost" onclick="WB.openFolder()">打开数据文件夹</button></div>
        <div class="hint" style="margin-top:6px">「导出 JSON」为“资料 + AI 内容”打包：含全部资料、字段、关系网、AI 角色卡、卡片模板、长期记忆、AI 提示词与原始文本及建议；不含主题/布局/AI 连接密钥等设定。导入同款 JSON 即可换机交接。</div>
        <h4 style="margin-top:16px">数据位置与升级</h4>
        <div class="row"><label>当前数据目录</label><span id="dataFolderLabel" class="hint">读取中…</span></div>
        <div class="row"><label>升级方式</label><span id="dataModeLabel" class="hint">…</span></div>
        <div class="toolbar"><button class="ghost" onclick="WB.importLegacy()">⇥ 从旧版数据文件夹迁移…</button></div>
        <div class="hint" style="margin-top:8px">安装版数据保存在系统用户目录（独立于安装位置），用新安装包原地覆盖升级不会丢失任何内容；从旧的绿色版换到安装版时，点上方按钮一次选定旧 data 文件夹即可无缝搬移，无需重填。</div></div>`;
    } else if (tab === 'about') {
      const updc = (S.settings.updates || {});
      h += `<div class="setcard"><h4>更新设置</h4>
        <div class="note" style="margin-bottom:8px">自更新会从 GitHub Releases 检测新版本，并按当前运行形态（绿色版 / 便携版 / 安装版）自动下载与替换。当前版本 v${APP_VERSION}。</div>
        <label class="toggle-row"><input type="checkbox" id="updAutoCheck" ${updc.autoCheck !== false ? 'checked' : ''}>
          <span><b>启动时自动检查更新</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">应用启动约 1 分钟后静默检查，失败不打扰；勾选间隔内的重复启动会跳过检查。</span></span></label>
        <label class="toggle-row"><input type="checkbox" id="updAutoDownload" ${updc.autoDownload !== false ? 'checked' : ''}>
          <span><b>检测到新版本后自动下载</b><br><span class="hint" style="color:var(--ink-faint);font-size:12px">下载完成后会弹窗询问是否立即重启更新；取消则稍后可在「更新公告」页手动重启。</span></span></label>
        <div class="row" style="margin-top:8px"><label>检查间隔（小时）</label><input id="updInterval" type="number" min="1" max="720" value="${Number(updc.checkIntervalHours) || 24}"></div>
        <div class="row"><label>下载加速前缀<span class="hint" style="margin-left:8px;color:var(--ink-faint);font-size:12px">留空为直连 GitHub；可填镜像/加速前缀，如 https://ghproxy.com/</span></label><input id="updMirror" value="${esc(updc.mirror || '')}" placeholder="留空使用直连"></div>
        <div style="margin-top:10px"><button onclick="WB.saveUpdateSettings()">💾 保存更新设置</button>
        <button class="ghost" onclick="WB.checkUpdate()">↻ 立即检查更新</button>
        <button class="ghost" onclick="WB.openReleasePage()">打开发布页</button></div></div>
      <div class="setcard"><h4>关于</h4>
      <div class="note" style="white-space:normal;line-height:1.7">KP 跑团工作台 v${APP_VERSION}（Electron 桌面版）<br>
      一款专为 TRPG 主持人（KP/守密人）打造的桌面辅助工具，涵盖资料管理、AI 辅助创作、地图、骰娘检定、记录润色、关系网等功能。<br><br>
      🎨 制作人：零弈秋<br>
      🐞 Bug / 建议反馈 QQ：247910428<br><br>
      <b>数据与隐私</b>：安装版数据保存在系统用户目录（可整体拷贝迁移）；绿色版则在 EXE 同目录 data/ 内。备份默认每 30 分钟与退出前各一次。<br><br>
      <b>借鉴与第三方说明</b>：本项目整体为自研实现；骰娘指令的名称与写法参照开源项目 <b>DiceZone / Dice-Next</b>（AGPL-3.0）公开指令表对齐，CoC 房规分档与疯狂症状表均依据 CoC 7th 公开规则自行实现；其余参考对象（枭雄、OneBot 11、QQ 官方机器人 API、CoC 7th / DnD 5e、Electron 等）均未复制其代码与素材。<b>完整清单与侵权联系删除办法见侧栏「系统 → 帮助中心 → 关于与反馈」。</b></div></div>
      <div class="setcard"><h4>免责声明</h4>
      <div class="note" style="white-space:normal;line-height:1.7">本工作台为个人独立开发的免费辅助工具，所有数据由用户自行录入与保管，请务必定期备份。本软件免费发布，使用过程中产生的任何损失（含数据丢失）作者概不负责。内容仅供 TRPG 跑团与创作参考，请勿用于商业用途或违反所在平台规则。<br><br>本项目尊重一切在先权利：若你认为本软件中有任何内容侵犯了你的合法权益，请联系 QQ 247910428 并附权利证明，核实后我们会立即删除或修改、必要时下架对应版本。<br><br>查看各功能的使用说明，请前往侧栏「系统 → 帮助中心」。</div></div>`;
    }
    body.innerHTML = h;
    if (tab === 'fields') { S.editFieldKind = 'pcs'; paintFieldEditor('pcs'); }
    if (tab === 'prompts') {
      loadPromptEditor();
      loadPromptHub();
      paintModRules();
      if (_modRuleSeed === null && !(S.settings.ai && Array.isArray(S.settings.ai.modRules) && S.settings.ai.modRules.length)) {
        window.api.modRuleDefaults().then(r => { _modRuleSeed = (r && Array.isArray(r.rules)) ? r.rules : []; paintModRules(); }).catch(() => { _modRuleSeed = []; });
      }
    }
    if (tab === 'data') { paintArchives(); paintBackups(); paintSnapshots(); paintDataInfo(); }
  }
  /* ---- AI 提示词模板编辑（设置页） ---- */
  const PMETA = [
    { key: 'registration', label: '拆分登记（导入 → 7 类资料卡）', rows: 12, hint: '用于「AI 拆分登记」「剧本解析」把导入文本拆成 PC/NPC/地区/日志/怪物/规则/背景。' },
    { key: 'digest', label: '大文件整理（分块汇总提纲）', rows: 9, hint: '用于大文件「AI 分析整理」逐段汇总为结构化中文提纲。' },
    { key: 'generate', label: '清单生成（生成全新资料卡内容）', rows: 8, hint: '用于资料页「生成」新建 NPC/怪物等卡片的创作风格。' }
  ];
  function getLocalPromptDefaults() {
    return S.promptDefaults || {
      registration: '你是一个 TRPG 跑团剧本「拆分登记」助手。请把下面这段导入资料拆解为 7 类结构化实体，登记到工作台。\n【实体类别】pcs=人物卡(玩家角色)、npcs=非玩家角色、regions=地区/地点、logs=事件/线索/剧情点、mobs=怪物/敌人、rules=规则/设定条目、lore=世界观/背景。\n【字段】只使用以下可用字段，缺失的留空或忽略，名称类(name/title)必须给出：{schema}；现有同名：{existing}，同名不重复新增、合并建议写入 updates。\n【输出格式】只输出一个合法 JSON，无解释文字：{"entities":{"pcs":[],"npcs":[],"regions":[],"logs":[],"mobs":[],"rules":[],"lore":[]},"updates":[]}。{mode_note}\n【导入文本】\n{fragment}',
      digest: '把下列导入资料整理成结构化中文提纲，覆盖：核心设定/规则要点/人物角色/地点/剧情关键点（有则详述、无则略过）。{mode_note}\n按条目简洁列出、保留关键细节、专有名词与数值，800 字内。\n【片段】\n{fragment}',
      generate: '为 TRPG《{world}》生成一条新内容。类型要求：{kind_tip}。字段：{schema}。人物/怪物须含身份、性格、外貌、经历；日志/线索须含时间、地点、经过、结果；忠于世界观，直接用自然语言输出可采用文本。{mode_note}'
    };
  }
  async function loadPromptEditor() {
    const box = q('promptCard'); if (!box) return;
    let DEF = S.promptDefaults;
    if (!DEF) {
      try { DEF = await window.api.promptDefaults(); S.promptDefaults = DEF; }
      catch (_) { DEF = getLocalPromptDefaults(); S.promptDefaults = DEF; }
    }
    const cur = S.settings.prompts || {};
    let h = `<h4>AI 提示词模板</h4>
      <div class="note" style="margin-bottom:8px">以下提示词用于「导入 / 剧本解析 / AI 拆分登记 / 大文件整理」时驱动 AI。支持占位符：{schema}、{existing}、{fragment}、{title}、{kind_tip}、{world}、{mode_note}（{mode_note} 会自动按「是否勾选允许补充」填入严格/补充说明）。修改后点「保存」生效；点「恢复默认」还原内置模板。</div>`;
    for (const m of PMETA) {
      const val = (cur[m.key] && String(cur[m.key]).trim()) ? cur[m.key] : (DEF[m.key] || '');
      h += `<div class="row full" style="margin-top:10px">
        <label>${m.label}<span class="hint" style="margin-left:8px;color:var(--ink-faint);font-size:12px">${m.hint}</span></label>
        <textarea id="pfp_${m.key}" rows="${m.rows}" placeholder="${esc(DEF[m.key] || '默认提示词')}">${esc(val)}</textarea>
        <div style="margin-top:6px"><button class="ghost small" onclick="WB.promptVersionList('${m.key}')">📜 历史版本</button>
        <button class="danger small" onclick="WB.resetPrompt('${m.key}')">恢复默认</button></div>
      </div>`;
    }
    h += `<div style="margin-top:12px"><button onclick="WB.savePrompts()">💾 保存提示词</button>
      <span class="hint" style="margin-left:8px">留空的模板自动使用内置默认</span></div>`;
    box.innerHTML = h;
  }
  function savePrompts() {
    const cur = (S.settings.prompts = (S.settings.prompts || {}));
    const changed = [];
    for (const m of PMETA) {
      const ta = q('pfp_' + m.key); if (!ta) continue;
      const val = ta.value.trim();
      const prev = cur[m.key] || '';
      if (val !== prev) changed.push(m.key);
      cur[m.key] = val;
    }
    /* 版本化：凡本次确有改动的模板，把改动前版本登记进历史（含时间/摘要），供查看与两版对比 */
    if (changed.length) {
      if (!S.settings.promptVersions) S.settings.promptVersions = {};
      for (const key of changed) {
        const list = Array.isArray(S.settings.promptVersions[key]) ? S.settings.promptVersions[key] : (S.settings.promptVersions[key] = []);
        const prev = cur[key];
        list.unshift({
          at: Date.now(),
          prev,
          preview: String(prev || '').slice(0, 60),
          length: String(prev || '').length
        });
        if (list.length > 30) list.length = 30;
      }
    }
    // 内容过滤规则在同页编辑，一并收集保存
    const mr = getModRules().map((r, i) => {
      const pat = q('mrpat_' + i) ? q('mrpat_' + i).value : r.pattern;
      const reason = q('mrres_' + i) ? q('mrres_' + i).value : r.reason;
      const enabled = q('mron_' + i) ? q('mron_' + i).checked : (r.enabled !== false);
      return { id: r.id || ('r' + Date.now() + '_' + i), pattern: pat, reason, enabled, flags: r.flags || '' };
    }).filter(r => true);
    if (mr.length) S.settings.ai = Object.assign({}, S.settings.ai || {}, { modRules: mr });
    persist(); const n = changed.length; toast(n ? ('AI 提示词已保存，' + n + ' 项有改动并录入历史版本' ) : 'AI 提示词已保存（无改动）', 'ok'); renderSettings();
  }
  /* ---- 提示词中枢：总提示词 + 各场景可编辑提示词 + 分场景记忆文件（AI 每次运行都会注入总提示词+本场景记忆） ---- */
  async function loadPromptHub() {
    const box = q('promptHubCard'); if (!box || !window.api.promptHubListScenes) return;
    try {
      const [scenes, masterInfo, memories] = await Promise.all([
        window.api.promptHubListScenes(),
        window.api.promptHubMaster(),
        window.api.promptHubListMemories().catch(() => [])
      ]);
      S._hubScenes = Array.isArray(scenes) ? scenes : [];
      S._hubMasterDefault = (masterInfo && masterInfo.default) || ''; // 供「恢复默认」填入
      const masterVal = (S.settings.prompts && S.settings.prompts.master) || (masterInfo && masterInfo.master) || '';
      const memMap = {};
      (Array.isArray(memories) ? memories : []).forEach(m => { memMap[m.key] = m; });
      S._hubMemories = memMap;
      let h = `<h4>总提示词（每次 AI 运行都会注入）</h4>
        <div class="note" style="margin-bottom:8px">以下为总则，出现在<strong>每一次</strong> AI 调用（工作台助手、资料生成、剧本解析、骰娘对话/优化/插话、KP 建议）的最前面。留空则使用内置默认。</div>
        <textarea id="hubMaster" rows="4" placeholder="${esc((masterInfo && masterInfo.default) || '')}">${esc(masterVal)}</textarea>
        <div style="margin-top:6px"><button class="ghost small" onclick="WB.hubResetMaster()">恢复默认</button></div>
        <h4 style="margin-top:20px">各场景提示词</h4>
        <div class="note" style="margin-bottom:8px">每个使用 AI 的地方对应一个场景。留空 = 使用内置模板；修改后点下方「保存总提示词 + 场景提示词」生效。占位符（如 {world}、{label}）运行时会自动替换。</div>`;
      for (const sc of S._hubScenes) {
        const ov = (S.settings.prompts && S.settings.prompts.scenes && S.settings.prompts.scenes[sc.key]) || {};
        const val = (typeof ov.sys === 'string' && String(ov.sys).trim()) ? ov.sys : (sc.sys || '');
        h += `<div class="row full" style="margin-top:8px">
          <label>${esc(sc.label)}<span style="font-size:11px;color:var(--ink-faint);margin-left:6px">场景 ${esc(sc.key)} · 记忆文件 ${esc(sc.mem || (sc.key + '.md'))}</span></label>
          <textarea id="hub_${sc.key}" rows="${(sc.key === 'chat' ? 3 : 4)}" placeholder="${esc(sc.label + '（留空用内置模板）')}">${esc(val)}</textarea>
          <div style="margin-top:6px"><button class="ghost small" onclick="WB.hubResetScene('${sc.key}')">恢复默认</button>
          ${memMap[sc.key] && memMap[sc.key].exists ? `<button class="ghost small" onclick="WB.hubViewMemory('${sc.key}')">📄 本场景记忆（${memMap[sc.key].chars} 字节）</button>` : `<button class="ghost small" onclick="WB.hubViewMemory('${sc.key}')">📄 本场景记忆（空）</button>`}</div>
        </div>`;
      }
      h += `<div style="margin-top:12px"><button onclick="WB.hubSave()">💾 保存总提示词 + 场景提示词</button>
        <span class="hint" style="margin-left:8px">留空场景自动用内置模板；记忆文件另有入口单独编辑。</span></div>`;
      box.innerHTML = h;
      if (S._hubMasterLoaded) { /* 已在输入框填过则不动 */ }
    } catch (_) {
      box.innerHTML = `<div class="note">提示词中枢加载失败：${esc((_.message) || _)}</div>`;
    }
  }
  function hubResetMaster() {
    const ta = q('hubMaster'); if (!ta) return;
    const def = (S._hubMasterDefault) || '';
    ta.value = def;
    toast('已填入默认总提示词（可再编辑后保存）');
  }
  function hubResetScene(key) {
    const ta = q('hub_' + key); if (!ta) return;
    const sc = (S._hubScenes || []).find(s => s.key === key);
    ta.value = (sc && sc.sys) || '';
    toast('已恢复「' + ((sc && sc.label) || key) + '」内置模板（保存后生效）');
  }
  async function hubSave() {
    const scenes = {};
    for (const sc of (S._hubScenes || [])) {
      const ta = q('hub_' + sc.key); if (!ta) continue;
      scenes[sc.key] = { sys: ta.value.trim() };
    }
    const masterTa = q('hubMaster');
    const master = masterTa ? masterTa.value.trim() : '';
    try {
      await window.api.promptHubSave({ master, scenes });
      S.settings.prompts = S.settings.prompts || {};
      S.settings.prompts.master = master;
      S.settings.prompts.scenes = Object.assign(S.settings.prompts.scenes || {}, scenes);
      toast('提示词中枢已保存（总提示词 + 各场景提示词）', 'ok');
    } catch (e) { toast('保存失败：' + ((e && e.message) || e), 'bad'); }
  }
  async function hubViewMemory(key) {
    const sc = (S._hubScenes || []).find(s => s.key === key);
    const label = (sc && sc.label) || key;
    let raw = '';
    try { raw = await window.api.promptHubRawMemory(key); } catch (_) {}
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>📄 ${esc(label)} · 本场景记忆</h3>
      <div class="note">此场景每次 AI 运行都会把「本场景记忆」的尾部注入，帮助 AI 保持连贯、无需通读全量上下文。运行中神经会自动追加要点；也可在此手动查看 / 写入 / 清空。</div>
      <textarea id="hubMemEdit" rows="12" style="width:100%;box-sizing:border-box" placeholder="为空表示尚无记忆。手动写入要点（每行一条），保存即覆盖。">${esc(raw)}</textarea>
      <div class="foot" style="margin-top:10px">
        <button onclick="WB.hubSaveMemory('${key}')">💾 保存记忆</button>
        <button class="danger" onclick="WB.hubClearMemory('${key}')">🗑 清空记忆</button>
        <button class="ghost" onclick="WB.closeModal()">关闭</button>
      </div>`;
    mask.hidden = false;
  }
  async function hubSaveMemory(key) {
    const ta = q('hubMemEdit'); if (!ta) return;
    const text = ta.value;
    try { await window.api.promptHubWriteMemory(key, text); toast('本场景记忆已保存', 'ok'); loadPromptHub(); closeModal(); } catch (e) { toast('保存失败：' + ((e && e.message) || e), 'bad'); }
  }
  async function hubClearMemory(key) {
    try { await window.api.promptHubClearMemory(key); toast('本场景记忆已清空', 'ok'); loadPromptHub(); closeModal(); } catch (e) { toast('清空失败', 'bad'); }
  }
  /* 查看某模板的历史版本：时间 + 改动摘要 + 内容预览，可对相邻两版做差异对比 */
  function promptVersionList(key) {
    const v = (S.settings && S.settings.promptVersions && Array.isArray(S.settings.promptVersions[key])) ? S.settings.promptVersions[key] : [];
    if (!v.length) return '<div class="empty">该模板还没有历史版本。每次保存若有改动，改动前的版本会自动登记在此。</div>';
    const mask = q('modalMask'); const box = q('modalBox');
    const curVal = (S.settings.prompts && S.settings.prompts[key]) || '';
    const rows = v.map((r, i) => `<div class="pver-row" style="display:flex;gap:10px;align-items:flex-start;padding:8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px">
      <div style="flex:0 0 120px"><b>${fmtClockAt(r.at)}</b><div class="hint">${r.length} 字符</div></div>
      <div style="flex:1;font-size:12px;color:var(--ink-faint);white-space:pre-wrap;word-break:break-word">${esc(r.preview || '（空）')}</div>
      <div style="flex:0 0 auto;white-space:nowrap">
        <button class="ghost small" onclick="WB.promptCompare('${key}',${i})">⟷ 对比上一版</button>
        <button class="ghost small" onclick="WB.promptRestoreVersion('${key}',${i})">↩ 恢复到此次</button>
      </div></div>`).join('');
    box.innerHTML = `<h3>📜 ${esc((PMETA.find(m => m.key === key) || {}).label || key)} · 历史版本</h3>
      <div class="note">改动前的版本按时间倒序排列。可对比「此次与上一版」的差异，或一键恢复到某一版本。当前生效值 ${curVal.length} 字符。</div>
      <div style="max-height:46vh;overflow:auto">${rows}</div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">关闭</button></div>`;
    mask.hidden = false;
  }
  /* 两版对比：此次(保存后) vs 上一版，用逐行 diff 标注新增/删除 */
  function promptCompare(key, i) {
    const v = (S.settings && S.settings.promptVersions && Array.isArray(S.settings.promptVersions[key])) ? S.settings.promptVersions[key] : [];
    const rec = v[i]; if (!rec) return;
    const labelA = '上一版（' + fmtClockAt(rec.at) + '）', contentA = rec.prev || '';
    const contentB = (S.settings.prompts && S.settings.prompts[key]) || '';
    const mask = q('modalMask'); const box = q('modalBox');
    const d = diffLines(contentA, contentB);
    box.innerHTML = `<h3>⟷ ${esc((PMETA.find(m => m.key === key) || {}).label || key)} · 版本对比</h3>
      <div class="note">红 = 删除（上一版独有），绿 = 新增（当前保存后）。仅对相邻两版：上一版 vs 本次保存结果。</div>
      <div style="display:flex;gap:10px;font-family:ui-monospace,monospace;font-size:12px">
        <div style="flex:1"><b>上一版</b><pre style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px;max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-word">${d.a || '（空）'}</pre></div>
        <div style="flex:1"><b>当前</b><pre style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px;max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-word">${d.b || '（空）'}</pre></div>
      </div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">关闭</button></div>`;
    mask.hidden = false;
  }
  /* 恢复某一历史版本到输入框（不自动保存，用户确认后再点保存） */
  function promptRestoreVersion(key, i) {
    const v = (S.settings && S.settings.promptVersions && Array.isArray(S.settings.promptVersions[key])) ? S.settings.promptVersions[key] : [];
    const rec = v[i]; if (!rec) return;
    const ta = q('pfp_' + key); if (!ta) return;
    ta.value = rec.prev || '';
    toast('已把「' + ((PMETA.find(m => m.key === key) || {}).label || key) + '」恢复到 ' + fmtClockAt(rec.at) + ' 的版本，请点「保存提示词」生效');
  }
  /* 简单逐行 diff：返回 {a,b} 两个 HTML 块，标注行级增删 */
  function diffLines(x, y) {
    const A = String(x || '').split('\n'), B = String(y || '').split('\n');
    const ha = new Set(A), hb = new Set(B);
    let outA = '', outB = '';
    // 保守 diff：把只在一侧出现的行标记为删除/新增，其余对齐显示
    for (const l of A) { const onlyB = !hb.has(l); outA += (onlyB ? '<span style="background:color-mix(in srgb,var(--danger) 18%,transparent)">− ' : '&nbsp;&nbsp; ') + esc(l) + (onlyB ? '</span>' : '') + '\n'; }
    for (const l2 of B) { const onlyA = !ha.has(l2); outB += (onlyA ? '<span style="background:color-mix(in srgb,var(--ok) 20%,transparent)">＋ ' : '&nbsp;&nbsp; ') + esc(l2) + (onlyA ? '</span>' : '') + '\n'; }
    return { a: outA || '（空）', b: outB || '（空）' };
  }
  function resetPrompt(key) {
    const DEF = S.promptDefaults || getLocalPromptDefaults();
    const ta = q('pfp_' + key); if (!ta) return;
    ta.value = DEF[key] || '';
    const m = PMETA.find(x => x.key === key);
    toast('「' + (m ? m.label : key) + '」已恢复默认', 'ok');
  }

  /* ---- 多档案渲染与操作 ---- */
  async function paintArchives() {
    const box = q('archiveList'); if (!box) return;
    let list; try { list = await window.api.archives.list(); } catch (_) { box.innerHTML = ''; return; }
    const cur = (S.meta && S.meta.archive) || storeName_Fallback();
    let h = '';
    for (const a of list) {
      const active = a.name === cur;
      const label = a.name === 'main' ? '主档案' : a.name;
      const when = a.modified ? new Date(a.modified).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      h += `<div class="arow" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;${active ? 'background:color-mix(in srgb,var(--accent) 14%,transparent)' : ''}">
        <span style="font-weight:600">${esc(label)}</span><span class="hint">${when} ${active ? '· 当前' : ''}</span>
        <span class="grow"></span>
        ${!active ? `<button class="ghost" data-ar="${esc(a.name)}" data-open>打开</button>` : ''}
        <button class="ghost" data-ar="${esc(a.name)}" data-dup>复制</button>
        <button class="danger" data-ar="${esc(a.name)}" data-del>删除</button></div>`;
    }
    box.innerHTML = h;
  }
  function storeName_Fallback() { return (S.settings && S.settings.archiveLabel) || 'main'; }
  async function reloadAll() {
    _xrefBump();
    const r = await window.api.getAll();
    if (r) { S.data = r.data; S.fields = r.fields; S.settings = r.settings || {}; S.profiles = r.profiles || []; S.activeProfile = r.activeProfile; S.meta = r.meta || {}; S.rawText = (r.data && typeof r.data.rawText === 'string') ? r.data.rawText : ''; S.rawSuggested = (r.data && typeof r.data.rawSuggested === 'string') ? r.data.rawSuggested : ''; S.rawScript = (r.data && r.data.rawScript) ? r.data.rawScript : null; if (!Array.isArray(S.data.maps)) S.data.maps = []; applyAppName();
      if (r.recovered) { const src = r.recovered === 'backup' ? '最近一次备份' : '最近一个版本快照'; toast('检测到数据异常，已自动恢复为' + src + '的数据', 'warn'); }
      if (r.sessionRecovered) toast('上次可能未正常退出，已为你保留此前工作数据 ㊙——如异常可到「数据管理→备份」恢复', 'warn');
    }
    switchView(S.view === 'search' ? 'dash' : S.view);
  }
  async function createArchive(name) {
    let nm = String(name || '').trim();
    if (!nm) nm = String((q('newAr') && q('newAr').value) || '').trim();
    if (!nm) nm = String(S.settings.appName || '').trim();     // 数据默认用主题名命名
    if (!nm) nm = 'main';
    const r = await window.api.archives.create(nm);
    if (!r.ok) { toast('新建失败：' + (r.error || ''), 'err'); return; }
    toast('已新建档案「' + r.name + '」，正在打开…', 'ok');
    const sw = await window.api.archives.switch(r.name);
    if (sw && sw.data) S.data = sw.data;
    await reloadAll();
  }
  async function switchArchive(name) {
    if (name === storeName_Fallback()) return;
    if (!(await appConfirm('切换档案', '切换到档案「' + name + '」？当前未保存的改动会被保留。'))) return;
    const r = await window.api.archives.switch(name);
    if (r && r.data) S.data = r.data;
    await reloadAll();
  }
  async function dupArchive(name) {
    const r = await window.api.archives.duplicate(name);
    if (!r.ok) { toast('复制失败：' + (r.error || ''), 'err'); return; }
    toast('已复制为档案「' + r.name + '」', 'ok'); paintArchives();
  }
  async function delArchive(name) {
    if (name === 'main') { toast('主档案不可删除', 'err'); return; }
    if (!(await appConfirm('删除档案', '删除档案「' + name + '」？其数据文件将一并删除，不可恢复。请先备份！'))) return;
    const r = await window.api.archives.del(name);
    if (!r.ok) { toast('删除失败：' + (r.error || ''), 'err'); return; }
    if (name === storeName_Fallback()) { await reloadAll(); }
    else paintArchives();
  }
  /* ---- 备份列表与恢复 ---- */
  async function paintBackups() {
    const box = q('backupList'); if (!box) return;
    let list; try { list = await window.api.backups.list(); } catch (_) { box.innerHTML = ''; return; }
    if (!list.length) { box.innerHTML = '<div class="hint">尚无备份，可点「立即备份」或等待自动备份（每 30 分钟 + 退出前）。</div>'; return; }
    let h = `<div class="hint" style="margin-bottom:4px">自动备份每 30 分钟 + 退出应用各一次。点击可从头还原该快照。</div>`;
    for (const b of list.slice(0, 12)) {
      const when = new Date(b.modified).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      h += `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--line)">
        <span>${when}</span><span class="hint">${(b.size / 1024).toFixed(0)}KB</span><span class="grow"></span>
        <button class="ghost" onclick="WB.restoreBackup('${b.file}')">还原</button></div>`;
    }
    box.innerHTML = h;
  }
  async function restoreBackup(file) {
    if (!(await appConfirm('还原备份', '将从备份「' + file + '」还原当前档案，当前数据会被覆盖。确定？'))) return;
    const r = await window.api.backups.restore(file);
    if (!r.ok) { toast('还原失败：' + (r.error || ''), 'err'); return; }
    await reloadAll(); toast('已从备份还原', 'ok');
  }
  /* ---- 自动版本快照：列表与回滚 ---- */
  async function paintSnapshots() {
    const box = q('snapshotList'); if (!box) return;
    let list; try { list = await window.api.snapshots.list(); } catch (_) { box.innerHTML = ''; return; }
    if (!list.length) { box.innerHTML = '<div class="hint">尚无快照：每次编辑数据后会自动沉淀一个版本，供误改误删时回滚（保留最近 40 份）。</div>'; return; }
    let h = `<div class="hint" style="margin-bottom:4px">按时间倒序（最近 40 份）。点击可回滚到该版本。若不确定，先用「立即备份」留一份再回滚。</div>`;
    for (const b of list) {
      const when = new Date(b.modified).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      h += `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--line)">
        <span>${when}</span><span class="hint">${(b.size / 1024).toFixed(0)}KB</span><span class="grow"></span>
        <button class="ghost" onclick="WB.restoreSnapshot('${b.file}')">回滚到此</button></div>`;
    }
    box.innerHTML = h;
  }
  async function restoreSnapshot(file) {
    if (!(await appConfirm('回滚快照', '将回滚到版本快照「' + file + '」，当前未备份的改动会丢失。确定？'))) return;
    const r = await window.api.snapshots.restore(file);
    if (!r.ok) { toast('回滚失败：' + (r.error || ''), 'err'); return; }
    await reloadAll(); toast('已回滚到该版本快照', 'ok');
  }
  function saveAppName() {
    S.settings.appName = (val('setAppName') || '残火纪').trim();
    S.settings.appSub = val('setAppSub').trim();
    persist(); applyAppName(); toast('主题名已更新', 'ok');
  }
  function saveNarrStyle() {
    S.settings.narrStyle = (q('setNarrStyle') ? q('setNarrStyle').value : '').trim();
    persist(); toast('叙事风格已保存，将注入后续 AI 对话与润色', 'ok');
  }
  let html = '';
  let editFieldKind = 'pcs';
  /* 字段编辑器：取到「kind + 模板」对应的字段集；模板未定义某类别时回落全局字段 */
  function fldSchema(kind, tplId) {
    if (tplId && S.settings && Array.isArray(S.settings.templates)) {
      const t = S.settings.templates.find(x => x.id === tplId);
      if (t && t.fields && t.fields[kind] && t.fields[kind].length) return t.fields[kind];
    }
    return S.fields[kind] || [];
  }
  function fldWrite(kind, tplId, schema) {
    if (tplId) {
      if (!S.settings.templates) S.settings.templates = [];
      let t = S.settings.templates.find(x => x.id === tplId);
      if (!t) { t = { id: tplId, name: tplId, fields: {} }; S.settings.templates.push(t); }
      if (!t.fields) t.fields = {};
      t.fields[kind] = schema;
    } else {
      S.fields[kind] = schema;
    }
  }
  function readFieldsRows() {
    const newSchema = [];
    document.querySelectorAll('#fieldEditor .fieldrow').forEach(row => {
      const k = ((row.querySelector('[data-f="k"]') || {}).value || '').trim();
      if (!k) return;
      const l = (row.querySelector('[data-f="l"]') || {}).value || k;
      const t = (row.querySelector('[data-f="t"]') || {}).value || 'text';
      const optsEl = row.querySelector('[data-f="opts"]');
      const gmEl = row.querySelector('[data-f="gm"]');
      newSchema.push({ k, l, t, opts: optsEl ? tagsToArr(optsEl.value) : [], gm: !!(gmEl && gmEl.checked) });
    });
    return newSchema.filter(f => f.k);
  }
  function editorTemplates() { return (S.settings && Array.isArray(S.settings.templates)) ? S.settings.templates : []; }
  function paintFieldEditor(kind) {
    const box = q('fieldEditor'); if (!box) return;
    const tplId = S.editFieldTpl || '';
    const schema = fldSchema(kind, tplId);
    let sel = `<div class="toolbar">编辑实体：<select onchange="WB.setFieldKind(this.value)">`;
    for (const k of KINDS) sel += `<option ${k === kind ? 'selected' : ''} value="${k}">${DATA_TYPE[k]}</option>`;
    sel += `</select><span style="margin-left:8px">模板：</span>
      <select onchange="WB.setFieldTpl(this.value)" title="编辑哪套字段集；选模板后点「保存字段」会写回该模板">
        <option value=""${!tplId ? ' selected' : ''}>基础（全局字段）</option>
        ${editorTemplates().map(t => `<option value="${esc(t.id)}"${t.id === tplId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select><span class="grow"></span>
      <button class="ghost" onclick="WB.saveAsTemplate()" title="把当前字段集另存为一个新的可选模板">另存为模板</button>
      <button onclick="WB.addField()">＋ 添加字段</button></div>`;
    let rows = '';
    for (let i = 0; i < schema.length; i++) {
      const f = schema[i];
      const optsHTML = `<input style="flex:0 0 110px" placeholder="枚举用校验" value="${esc((f.opts || []).join(','))}" data-f="opts">`;
      rows += `<div class="fieldrow" data-fid="${esc(f.k)}">
        <input style="flex:0 0 84px" value="${esc(f.l)}" data-f="l" placeholder="显示名">
        <input style="flex:0 0 92px" value="${esc(f.k)}" data-f="k" placeholder="键(英文)">
        <select data-f="t" style="flex:0 0 92px">
          ${['text','textarea','number','select','tags'].map(t => `<option ${f.t === t ? 'selected' : ''} value="${t}">${t}</option>`).join('')}
        </select>
        ${f.t === 'select' ? optsHTML : '<span style="flex:0 0 110px"></span>'}
        <label style="flex:0 0 96px;font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" data-f="gm" ${f.gm ? 'checked' : ''} title="勾选后此字段为 GM 专属，玩家投放物（讲义）会隐藏">GM 专属</label>
        <button class="ghost" onclick="WB.fieldUp(${i})">↑</button>
        <button class="ghost" onclick="WB.fieldDown(${i})">↓</button>
        <button class="danger" onclick="WB.delField(${i})">删</button></div>`;
    }
    box.innerHTML = sel + (rows || '<div class="empty">该模板未定义此类别字段，将回落「基础（全局字段）」；可在下方添加后保存到此模板。</div>')
      + `<div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button onclick="WB.saveFields()">保存字段</button>
        <button class="ghost" onclick="WB.aiBuildTemplate('${kind}')" title="依据当前「规则/背景」实体内容归纳出新人物卡模板">⚡ AI 依据规则书生成模板</button>
        <span class="hint" style="color:var(--ink-faint)">${tplId ? '正在编辑模板「' + esc((S.settings.templates.find(t => t.id === tplId) || {}).name || tplId) + '」' : '正在编辑基础全局字段'} · select 需在“枚举”填逗号分隔选项。</span></div>`;
    // 切换 select 时显示/隐藏 opts
    box.querySelectorAll('select[data-f="t"]').forEach(s => {
      s.addEventListener('change', () => {
        const row = s.closest('.fieldrow');
        const optsEl = row.querySelector('[data-f="opts"]');
        if (optsEl) optsEl.style.display = s.value === 'select' ? '' : 'none';
      });
    });
  }
  function setFieldTpl(v) { S.editFieldTpl = v || ''; paintFieldEditor(S.editFieldKind); }
  function saveFields() {
    const cur = S.editFieldKind; const tplId = S.editFieldTpl || '';
    fldWrite(cur, tplId, readFieldsRows());
    persist(); toast(tplId ? '已把字段保存到模板「' + (tplName(tplId) || tplId) + '」' : '字段已保存', 'ok');
    updateDashIfShown();
  }
  /* 把当前字段集另存为新的可选模板 */
  function saveAsTemplate() {
    const cur = S.editFieldKind;
    let schema = readFieldsRows();
    if (!schema.some(f => f.k === 'name') && cur !== 'logs') schema = [{ k: 'name', l: '姓名', t: 'text' }].concat(schema);
    appPrompt({ title: '另存为模板', label: '模板名称（留空则用「自定义模板」）', placeholder: '自定义模板', okText: '保存' }, (nm) => {
      if (nm == null) return;
      nm = String(nm).trim(); if (!nm) nm = '自定义模板';
      if (!S.settings.templates) S.settings.templates = [];
      const id = 'tpl_' + Date.now().toString(36);
      S.settings.templates.push({ id, name: nm, note: '自定义模板', builtin: false, fields: { [cur]: schema } });
      S.editFieldTpl = id;
      persist(); paintFieldEditor(cur);
      toast('已另存为模板「' + nm + '」，新建/编辑卡片或 AI 生成时可直接选用', 'ok');
    });
  }
  /* 让 AI 依据现有「规则/背景」内容归纳出一套人物卡模板 */
  async function aiBuildTemplate(kind) {
    const parts = [];
    for (const r of ((S.data.entities.rules) || []).slice(0, 25)) { const t = [r.name, r.summary, r.detail, r.content, r.text, r.note].filter(Boolean).join(' · '); if (t) parts.push('· ' + t); }
    for (const l of ((S.data.entities.lore) || []).slice(0, 12)) { const t = [l.name, l.summary, l.content, l.note].filter(Boolean).join(' · '); if (t) parts.push('· ' + t); }
    const rulesText = parts.join('\n').trim();
    if (!rulesText) { toast('请先在「规则 / 背景」导入若干规则书或设定内容，再让 AI 依据它生成模板', 'err'); return; }
    toast('AI 正在依据现有规则/设定归纳人物卡模板…');
    try {
      const r = await window.api.aiGenTemplateForRules(rulesText.slice(0, 16000));
      if (!r || !r.ok) { toast((r && r.error) || '生成失败，请检查 AI 配置', 'err'); return; }
      const t = r.template || {};
      if (!t.fields || !Array.isArray(t.fields.pcs) || !t.fields.pcs.length) { toast('AI 未归纳出有效字段集', 'err'); return; }
      if (!S.settings.templates) S.settings.templates = [];
      const id = 'tpl_' + Date.now().toString(36);
      t.id = id; t.builtin = false;
      S.settings.templates.push(t);
      S.editFieldTpl = id;
      persist(); paintFieldEditor(kind || S.editFieldKind);
      toast('已生成模板「' + (t.name || '自定义模板') + '」（' + t.fields.pcs.length + ' 个字段），可在新建/编辑卡片或 AI 生成时选用', 'ok');
    } catch (e) { toast('生成模板失败：' + ((e && e.message) || e), 'err'); }
  }
  function fieldOptsChanged() {}

  /* ========== 全局动作 ========== */
  function search(v) { S.search = v; switchView(S.view); }
  /* 全局跨实体搜索（侧栏输入） */
  function globalSearch(v) {
    S.globalQuery = (v || '').trim();
    S.gType = 'all';
    switchView(S.globalQuery ? 'search' : 'dash');
  }
  function setGType(t) { S.gType = t; renderGlobalSearch(); }
  function goToEntity(kind, id) {
    const it = (S.data.entities[kind] || []).find(x => x.id === id || (id && x.name === id));
    if (it) { switchView(kind); q('glSearch').value = it.name || ''; S.search = it.name; renderDataView(kind); }
    else switchView(kind);
  }
  function renderGlobalSearch() {
    const kw = (S.globalQuery || '').toLowerCase();
    const typeFilter = (S.gType && S.gType !== 'all') ? S.gType : null;
    let html = `<div class="page-title"><h2>全局搜索结果</h2><span class="hint">匹配 “${esc(S.globalQuery)}” · 点击结果可直接跳转</span></div>`;
    html += `<div class="toolbar">`;
    html += `<button class="${S.gType === 'all' ? '' : 'ghost'}" onclick="WB.setGType('all')">全部</button>`;
    for (const k of KINDS) html += `<button class="${S.gType === k ? '' : 'ghost'}" onclick="WB.setGType('${k}')">${DATA_TYPE[k]}</button>`;
    html += `</div><div class="cardgrid">`;
    let total = 0;
    for (const k of KINDS) {
      if (typeFilter && typeFilter !== k) continue;
      const list = (S.data.entities[k] || []).filter(it => !kw || entitySearchLower(it).indexOf(kw) !== -1);
      for (const it of list) {
        total++;
        const name = it.name || it.title || '未命名';
        let snippet = '';
        for (const [kk, vv] of Object.entries(it)) {
          if (kk === 'id' || kk === 'source' || kk === 'name' || kk === 'title') continue;
          const s = String(Array.isArray(vv) ? vv.join('、') : vv);
          if (!kw || s.toLowerCase().includes(kw)) { snippet = s; break; }
          if (!snippet) snippet = s;
        }
        if (!snippet) snippet = '—';
        const snippetTxt = String(snippet).length > 60 ? String(snippet).slice(0, 60) + '…' : snippet;
        html += `<div class="card search-item"><div class="cname"><span class="cnm">${esc(name)}</span><span class="ctag">${DATA_TYPE[k]}</span></div>
          <div class="row long"><b>摘要</b>${esc(snippetTxt)}</div>
          <div class="card-actions"><button class="ghost" onclick="WB.goToEntity('${k}','${it.id}')">跳转查看</button></div></div>`;
      }
    }
    html += `</div>`;
    if (!total) html += `<div class="empty">未找到匹配条目（可尝试更短的关键词）</div>`;
    contentInner(html);
  }
  function add(kind) { editModal(kind, null); }
  function edit(kind, id) { const it = S.data.entities[kind].find(x => x.id === id); if (it) editModal(kind, it); }
  /* C5：一键复制当前资料卡为新卡（含全部字段与模板，名称追加“副本”） */
  function dupCard(kind, id) {
    const it = S.data.entities[kind].find(x => x.id === id);
    if (!it) return;
    const copy = JSON.parse(JSON.stringify(it));
    const base = entityNameOf(copy) || '未命名';
    copy.id = uid();
    copy.name = base + ' · 副本';
    if (kind === 'logs' && copy.title) copy.name = undefined; // 日志以 title 命名
    if (kind === 'logs' && copy.title) copy.title = (base || '未命名日志') + ' · 副本';
    copy.source = copy.source === 'AI 生成' ? 'AI 生成' : '手动导入';
    const arr = S.data.entities[kind] || (S.data.entities[kind] = []);
    arr.unshift(normFields(kind, copy));
    pushAudit('create', kind, copy.name || copy.title || '副本');
    persist(); switchView(kind);
    toast('已复制为新卡「' + (copy.name || copy.title || '副本') + '」，可在卡片上继续编辑', 'ok');
  }
  /* C5：批量删除同类中“完全重名”的重复卡，只保留最早一条（保留各自 id 不变） */
  async function dedupKind(kind) {
    const arr = S.data.entities[kind] || [];
    const byName = {};
    let dup = 0, total = 0;
    for (const it of arr) {
      const nm = entityNameOf(it);
      if (!nm) continue;
      const kw = nm.toLowerCase();
      if (byName[kw]) { if (byName[kw].dup === undefined) byName[kw].dup = true; dup++; }
      else byName[kw] = { id: it.id };
    }
    total = arr.length;
    for (const k in byName) if (byName[k].dup) total--;
    if (!dup) { toast('「' + DATA_TYPE[kind] + '」没有重复名称的条目', 'ok'); return; }
    if (!(await appConfirm('去重', '「' + DATA_TYPE[kind] + '」检测到 ' + dup + ' 条重名卡，删除重复项（只保留最早一条，名称相同内容取最早）？'))) return;
    const keep = new Set();
    const seenDup = {};
    for (const it of arr) {
      const nm = entityNameOf(it);
      if (!nm) { keep.add(it.id); continue; }
      const kw = nm.toLowerCase();
      if (seenDup[kw]) continue; // 抛掉重复
      seenDup[kw] = true; keep.add(it.id);
    }
    S.data.entities[kind] = arr.filter(x => keep.has(x.id));
    pushAudit('delete', kind, '去重 × ' + dup);
    persist(); switchView(kind);
    toast('已删除 ' + dup + ' 条重复卡（保留 ' + total + ' 条）', 'ok');
  }
  async function del(kind, id) {
    if (!(await appConfirm('删除条目', '确定删除该条目？'))) return;
    S.data.entities[kind] = S.data.entities[kind].filter(x => x.id !== id);
    pushAudit('delete', kind, '');
    persist(); switchView(kind);
  }
  let _modalCancel = null; /* 当前弹窗的「取消」回调（供“先写入再确认”的弹窗回滚用） */
  function closeModal() {
    q('modalMask').hidden = true; q('confirmMask').hidden = true;
    if (typeof _modalCancel === 'function') { const f = _modalCancel; _modalCancel = null; try { f(); } catch (_) { /* 回滚失败不影响关闭 */ } }
  }
  /* Electron 桌面端没有 window.prompt（v1.5 起项目已确认），凡“输入后继续”统一走内置弹窗。
   * appPrompt(opts, onOk)：onOk(value)；取消或按遮罩外关闭传 null，确定传输入框原文（未填为 ''）。 */
  let _appPromptCb = null;
  function appPrompt(opts, onOk) {
    const mask = q('modalMask'); const box = q('modalBox'); if (!mask || !box) return;
    const o = opts || {};
    _appPromptCb = (typeof onOk === 'function') ? onOk : null;
    box.innerHTML = `<h3>${esc(o.title || '请输入')}</h3>
      ${o.label ? `<div class="note" style="margin-bottom:8px;white-space:pre-wrap">${esc(o.label)}</div>` : ''}
      <div class="row full"><input id="appPromptVal" type="${o.inputType || 'text'}" value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}" style="font-size:15px"></div>
      <div class="foot"><button class="ghost" id="appPromptCancel">${esc(o.cancelText || '取消')}</button>
      <button id="appPromptOk">${esc(o.okText || '确定')}</button></div>`;
    mask.hidden = false;
    const inp = q('appPromptVal'), okBtn = q('appPromptOk'), cBtn = q('appPromptCancel');
    if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 40);
    const done = (v) => { const cb = _appPromptCb; _appPromptCb = null; closeModal(); if (cb) cb(v); };
    if (okBtn) okBtn.addEventListener('click', () => done(inp ? inp.value : ''));
    if (cBtn) cBtn.addEventListener('click', () => done(null));
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } });
  }
  /* Electron 同样屏蔽 window.confirm（阻塞式对话框不可用），删除/迁移等破坏性操作改走内置确认弹窗。
   * appConfirm(title, text) → Promise<boolean>：点「确定」true，取消/关闭 false。 */
  let _appConfirmResolve = null;
  function appConfirm(title, text) {
    return new Promise((resolve) => {
      const mask = q('modalMask'); const box = q('modalBox'); if (!mask || !box) { resolve(false); return; }
      _appConfirmResolve = resolve;
      box.innerHTML = `<h3>${esc(title || '确认')}</h3>
        <div class="note" style="margin-bottom:8px;white-space:pre-wrap">${esc(text || '')}</div>
        <div class="foot"><button class="ghost" id="appConfirmNo">取消</button>
        <button class="danger" id="appConfirmYes">确定</button></div>`;
      mask.hidden = false;
      const yes = q('appConfirmYes'), no = q('appConfirmNo');
      /* 只隐藏遮罩、不调 closeModal()：避免在确认瞬间提前触发底层弹窗的 _modalCancel 回滚；
       * 调用方（多为删除流程）随后自会 closeModal 清状态，与原生 confirm 语义一致。 */
      const done = (v) => { const r = _appConfirmResolve; _appConfirmResolve = null; q('modalMask').hidden = true; if (typeof r === 'function') r(v); };
      if (yes) yes.addEventListener('click', () => done(true));
      if (no) no.addEventListener('click', () => done(false));
    });
  }
  function setTheme(t) { applyTheme(t); toast('主题已切换', 'ok'); updateDashIfShown(); refreshAppearanceControls(); }
  function toggleTile(k, on) {
    const h = (S.settings.layout && Array.isArray(S.settings.layout.dashHidden)) ? S.settings.layout.dashHidden.slice() : [];
    const i = h.indexOf(k);
    if (!on && i < 0) h.push(k); else if (on && i >= 0) h.splice(i, 1);
    S.settings.layout = Object.assign({}, S.settings.layout, { dashHidden: h });
    persist(); updateDashIfShown();
  }
  async function resetLayout() {
    if (!(await appConfirm('重置看板', '重置看板排序与面板显示？'))) return;
    S.settings.layout = {};
    persist(); updateDashIfShown();
  }
  function updateDashIfShown() { if (S.view === 'dash') renderDash(); if (S.view === 'settings') { paintFieldEditor(S.editFieldKind); } }
  function go(v) { switchView(v); }

  /* ===== 侧栏折叠（图标态） ===== */
  function toggleSidebar() {
    const sb = q('sidebar');
    const collapsed = sb.classList.toggle('collapsed');
    S.settings.sidebarCollapsed = !!collapsed;
    persist();
  }
  function applySidebar() {
    const sb = q('sidebar');
    if (S.settings && S.settings.sidebarCollapsed) sb.classList.add('collapsed'); else sb.classList.remove('collapsed');
  }

  /* ===== Ctrl+K 命令面板：页面跳转 + 实体直达 + 全局搜索入口 ===== */
  const PAL_COMMANDS = [
    { v: 'dash', ic: '◈', t: '总览看板' }, { v: 'pcs', ic: '⛧', t: '人物卡' }, { v: 'npcs', ic: '🧙', t: 'NPC 图鉴' },
    { v: 'regions', ic: '⛰', t: '地区场景' }, { v: 'logs', ic: '🕮', t: '战役日志' }, { v: 'mobs', ic: '☠', t: '怪物图鉴' },
    { v: 'rules', ic: '▤', t: '规则速查' }, { v: 'lore', ic: '☷', t: '背景城设' }, { v: 'relations', ic: '☸', t: '关系网' },
    { v: 'tags', ic: '＃', t: '标签' }, { v: 'maps', ic: '🗺', t: '地图' },
    { v: 'ai', ic: '✧', t: 'AI 助手' }, { v: 'persona', ic: '♜', t: 'AI 设定' },
    { v: 'aiconf', ic: '⇅', t: 'AI 配置' }, { v: 'polish', ic: '✍', t: '记录润色' }, { v: 'rawtext', ic: '↯', t: '原始文本' },
    { v: 'dicehost', ic: '🎲', t: '连 QQ 骰娘' }, { v: 'dice', ic: '⚀', t: '本地掷骰' }, { v: 'dicework', ic: '🧭', t: '骰娘工作台' },
    { v: 'diceai', ic: '🎛', t: '骰娘 AI 功能开关' }, { v: 'diceaichat', ic: '💬', t: '群聊 AI 行为' }, { v: 'dicememe', ic: '🖼', t: '表情包库' },
    { v: 'encounter', ic: '⚔', t: '临场战斗' }, { v: 'stats', ic: '📊', t: '统计分析' },
    { v: 'settings', ic: '⚙', t: '偏好设置' }, { v: 'help', ic: '❓', t: '帮助中心' },
    { v: 'changelog', ic: '⌘', t: '更新公告' }, { v: 'runlog', ic: '📜', t: '运行记录' }
  ];
  let _palIdx = 0;
  function _palItems(q_) {
    const kw = (q_ || '').trim().toLowerCase();
    // 搜索资料（跨 7 类，名称/标签/拼音首字母命中）——预建索引，按代数失效，避免每按键重扫全库
    const ents = [];
    const byKind = _locBuild();
    if (kw) {
      for (const k of KINDS) {
        const box = byKind[k];
        if (!box) continue;
        for (const e of box) {
          if (!_locHit(e, kw)) continue;
          const nm = (S.data.entities[k] || []).find(x => x.id === e.id);
          if (!nm) continue;
          ents.push({ k, id: e.id, ic: '', t: DATA_TYPE[k] + ' · ' + entityNameOf(nm) });
        }
      }
    }
    const cmds = PAL_COMMANDS
      .filter(c => !kw || c.t.toLowerCase().includes(kw))
      .map(c => ({ kind: 'page', ...c }));
    return cmds.concat(ents.slice(0, 12)).concat(kw ? [{ kind: 'search', ic: '⌕', t: '全局搜索 “' + kw + '”' }] : []);
  }
  function openPalette() {
    const m = q('paletteMask'); const list = q('palList'); const input = q('palIn');
    m.hidden = false; _palIdx = 0;
    input.value = S._palQuery || ''; input.focus();
    _paintPal();
  }
  function _paintPal() {
    const list = q('palList'); const q_ = q('palIn').value;
    const items = _palItems(q_);
    if (_palIdx >= items.length) _palIdx = 0; if (_palIdx < 0) _palIdx = items.length - 1;
    list.innerHTML = items.map((it, i) =>
      `<div class="pal-item${i === _palIdx ? ' sel' : ''}" data-i="${i}">${it.ic ? '<span class="pal-ic">' + esc(it.ic) + '</span>' : ''}<span>${esc(it.t)}</span>${it.kind === 'page' ? '<span class="pal-kind">页面</span>' : it.kind === 'search' ? '<span class="pal-kind">跳转</span>' : '<span class="pal-kind">资料</span>'}</div>`).join('');
    const sel = list.querySelector('.pal-item.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function _palPick() {
    const q_ = (q('palIn').value || '').trim().toLowerCase();
    const items = _palItems(q_);
    const it = items[_palIdx]; if (!it) return;
    closePalette();
    if (it.kind === 'page') switchView(it.v);
    else if (it.kind === 'search') { S.globalQuery = q_; S.gType = 'all'; switchView('search'); }
    else if (it.kind && it.k === undefined) return;
    else { goToEntity(it.k, it.id); }
  }
  function closePalette() { q('paletteMask').hidden = true; }

  /* ===== 全局快速搜索（Ctrl+Shift+F 浮层，扫全部模块） ===== */
  let _gIdx = 0;
  const GS_ICON = { pcs: '⛧', npcs: '🧙', regions: '⛰', logs: '🕮', mobs: '☠', rules: '⚖', lore: '✒' };
  function gsAnchor(text, kw) {
    const i = text.toLowerCase().indexOf(kw);
    if (i < 0) return trunc(text, 60);
    const a = Math.max(0, i - 14), b = Math.min(text.length, i + kw.length + 30);
    return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\n/g, ' ') + (b < text.length ? '…' : '');
  }
  function trunc(s, n) { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }
  function openGlobalSearch() {
    closePalette();
    const m = q('gSearchMask'); const input = q('gSearchIn');
    m.hidden = false; _gIdx = 0; input.value = ''; input.focus(); _gPaint('');
  }
  function closeGlobalSearch() { q('gSearchMask').hidden = true; }
  /* D4 全局搜索索引：把「小写化 + 拼接 + 命中扫描」的代价从「每次击键」摊薄到「数据变更」。
   * 复用 _xref.gen 作为失效代数：persist()(本地改动)与 reloadAll()(换档案/回滚/载入)都会自增，
   * 索引以此懒重建，保证与界面数据一致。搜索命中时不再逐实体拼串/反复下整篇原文。 */
  const _gsIdx = { gen: -1, entities: [], relNodes: [], relEdges: [], maps: [], rawLower: '', mem: [] };
  function gsIndex() {
    if (_gsIdx.gen === _xref.gen) return _gsIdx;
    _gsIdx.gen = _xref.gen;
    const ents = S.data.entities || {};
    const entArr = [];
    for (const k of KINDS) {
      for (const it of (ents[k] || [])) {
        entArr.push({ k, id: it.id, name: it.name || it.title || '未命名', lower: entitySearchLower(it) });
      }
    }
    const rel = S.data.relations || { nodes: [], edges: [] };
    _gsIdx.entities = entArr;
    _gsIdx.relNodes = (rel.nodes || []).map(n => ({ t: String(n.label || '未命名'), lower: (String(n.label || '') + ' ' + String(n.desc || '')).toLowerCase() }));
    _gsIdx.relEdges = (rel.edges || []).map(x => ({ t: String(x.label || ''), lower: String(x.label || '').toLowerCase() }));
    _gsIdx.maps = (S.data.maps || []).map(m => ({ t: m.name || '未命名', lower: (String(m.name || '') + ' ' + String(m.desc || '')).toLowerCase() }));
    _gsIdx.rawLower = (S.rawText && S.rawText.toLowerCase()) || '';
    const mem = (S.settings && Array.isArray(S.settings.memory)) ? S.settings.memory : [];
    _gsIdx.mem = mem.map(tag => { const t = String(tag && tag.text != null ? tag.text : ''); return { t, lower: t.toLowerCase() }; });
    return _gsIdx;
  }
  function _gItems(q_) {
    const kw = (q_ || '').toLowerCase().trim(); const items = [];
    if (!kw) return items;
    const g = gsIndex();
    for (const it of g.entities) {
      if (it.lower.indexOf(kw) === -1) continue;
      items.push({ kind: 'entity', k: it.k, id: it.id, t: it.name, sub: DATA_TYPE[it.k], ic: GS_ICON[it.k] || '•' });
    }
    for (const n of g.relNodes) {
      if (n.lower.includes(kw)) items.push({ kind: 'rel', t: gsAnchor(n.t, kw), sub: '关系·节点', ic: '☰' });
    }
    for (const e2 of g.relEdges) {
      if (e2.lower.includes(kw)) items.push({ kind: 'rel', t: gsAnchor(e2.t, kw), sub: '关系·连线', ic: '↔' });
    }
    for (const mp of g.maps) {
      if (mp.lower.includes(kw)) items.push({ kind: 'map', t: mp.t, sub: '地图', ic: '🗺' });
    }
    if (g.rawLower.includes(kw)) items.push({ kind: 'rawtext', t: gsAnchor(S.rawText, kw), sub: '原始文本', ic: '📄' });
    for (const m of g.mem) {
      if (m.lower.includes(kw)) items.push({ kind: 'memory', t: gsAnchor(m.t, kw), sub: '团内记忆', ic: '✧' });
    }
    return items.slice(0, 60);
  }
  function _gPaint(q_) {
    const list = q('gSearchList'); const items = _gItems(q_);
    if (_gIdx >= items.length) _gIdx = items.length - 1; if (_gIdx < 0) _gIdx = 0;
    if (!items.length) { list.innerHTML = `<div class="pal-empty">${q_ ? '未找到匹配内容' : '输入关键词搜索…'}</div>`; return; }
    list.innerHTML = items.map((it, i) =>
      `<div class="pal-item${i === _gIdx ? ' sel' : ''}" data-i="${i}"><span class="pal-ic">${it.ic}</span><span>${esc(it.t)}</span><span class="pal-kind">${esc(it.sub)}</span></div>`).join('');
    const sel = list.querySelector('.pal-item.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function _gPick() {
    const q_ = (q('gSearchIn').value || '').trim(); const items = _gItems(q_);
    const it = items[_gIdx]; if (!it) return;
    closeGlobalSearch();
    if (it.kind === 'entity') goToEntity(it.k, it.id);
    else if (it.kind === 'rel') switchView('relations');
    else if (it.kind === 'map') switchView('maps');
    else if (it.kind === 'rawtext') switchView('rawtext');
    else if (it.kind === 'memory') switchView('ai');
  }

  /* ===== 新手引导：首次使用主流程提示 ===== */
  function maybeOnboard() {
    if (S.settings && (S.settings.onboarded || S.settings.onboardStep)) return;
    const mask = q('onboardMask'); const box = q('onboardBox');
    box.innerHTML = `<h3>👋 欢迎使用 KP 跑团工作台</h3>
      <div class="note">你的连续跑团资料库已就绪。推荐的第一次上手流程：</div>
      <ol class="onboard-steps">
        <li><b>导入文档</b> —— 在「规则 / 背景」里导入你的剧本、设定或笔记（支持 txt/md/docx/pdf/xlsx）。</li>
        <li><b>AI 拆分登记</b> —— 连接 AI 后，导入内容可一键拆成 人物卡 / NPC / 地区 / 日志 / 怪物 / 规则 / 背景 7 类资料卡。</li>
        <li><b>建立档案</b> —— 在总览「开始使用」选择或新建团档案，多套世界可各自独立。</li>
        <li><b>按需创作</b> —— 用「AI 助手」「骰娘鉴定」「记录润色」继续你的团。</li>
      </ol>
      <div class="row"><label class="toggle-row"><input type="checkbox" id="onbAgain"> 下次启动不再显示</label></div>
      <div class="foot"><button class="ghost" onclick="WB.onboardDismiss(false)">稍后再说</button>
      <button onclick="WB.onboardDismiss(true)">开始使用</button></div>`;
    mask.hidden = false;
  }
  function onboardDismiss(again) {
    const onb = q('onbAgain'); const noMore = onb && onb.checked;
    if ((again || noMore)) { S.settings.onboarded = true; S.settings.onboardStep = 1; }
    else { S.settings.onboarded = false; S.settings.onboardStep = undefined; }
    closeModal(); q('onboardMask').hidden = true; persist();
    if (again) switchView('dash');
  }

  async function doBackup() { const r = await window.api.backup(); toast('已备份：' + r.name, 'ok'); }
  function saveAutoBackup() {
    const v = parseInt(q('setAutoBackup').value, 10);
    if (!v || v < 1 || v > 1440) { toast('间隔需为 1~1440 分钟', 'err'); return; }
    S.settings.autoBackupMinutes = v;
    persist(); toast('自动备份间隔已设为 ' + v + ' 分钟', 'ok');
  }
  function exportData() {
    /* 导出「所有资料内容 + AI 内容」，不含界面/AI连接等“设定”：
     * 资料：entities(7 类) / fields / relations ；AI 内容：profiles(角色卡) / templates(卡片模板) /
     * memory(长期记忆) / prompts(AI 提示词) ；另含原始文本(rawText)与其 AI 建议(rawSuggested)、
     * 剧本分幕(rawScript)与其开团进度(scriptProg)、地图、审计记录。 */
    const bundle = {
      kind: 'kp-workbench-bundle', version: 3, exportedAt: new Date().toISOString(),
      entities: S.data.entities,
      fields: S.fields,
      profiles: S.profiles,
      relations: S.data.relations || { nodes: [], edges: [] },
      memory: (S.settings && Array.isArray(S.settings.memory)) ? S.settings.memory : [],
      templates: (S.settings && Array.isArray(S.settings.templates)) ? S.settings.templates : [],
      prompts: (S.settings && S.settings.prompts) || {},
      audit: S.data.audit || [],
      rawText: S.rawText || '',
      rawSuggested: S.rawSuggested || '',
      rawScript: S.rawScript || null,
      maps: S.data.maps || []
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kp-workbench-资料与AI内容-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); URL.revokeObjectURL(a.href);
    toast('已导出资料 + AI 内容（不含主题/布局/AI 连接等设定）', 'ok');
  }
  /* 导出当前类型全部资料为 Markdown 或 纯文本（含每张卡的名称与字段） */
  /* 导出格式选择：弹窗让用户挑选 文本/纯文本/JSON/表格/网页 */
  function exportPick(kind) {
    const mask = q('modalMask'); const box = q('modalBox');
    const title = DATA_TYPE[kind] || kind;
    const fmts = [['md', 'Markdown 文档', '.md'], ['docx', 'Word 文档', '.docx'], ['pdf', 'PDF 文档', '.pdf'],
      ['xlsx', 'Excel 表格', '.xlsx'], ['csv', 'CSV 表格', '.csv'], ['txt', '纯文本', '.txt'], ['json', 'JSON 数据', '.json'], ['html', 'HTML 网页', '.html']];
    box.innerHTML = `<h3>导出「${esc(title)}」</h3>
      <div class="note" style="margin-bottom:8px">选择导出格式（Word / Excel / PDF 适合直接交付与打印）；「玩家讲义」会隐藏 GM 专属字段后投放给玩家。</div>
      <div class="export-grid">${fmts.map(([v, l, ext]) => `<button class="export-fmt" onclick="WB.exportView('${kind}','${v}')">${esc(l)}<span class="hint">${esc(ext)}</span></button>`).join('')}</div>
      <div class="toolbar" style="margin-top:10px"><button onclick="WB.handoutOpen('${kind}')">🗞 制作玩家讲义</button><span class="hint">生成隐藏 KP/GM 信息的投放文档</span></div>
      <div class="foot" style="margin-top:14px"><button class="ghost" onclick="WB.closeModal()">取消</button></div>`;
    mask.hidden = false;
  }
  /* 导出当前类型全部资料，支持 md / txt / json / csv / html / docx / xlsx / pdf */
  async function exportView(kind, fmt) {
    fmt = fmt || 'md';
    const arr = S.data.entities[kind] || [];
    const schema = S.fields[kind] || [];
    const title = DATA_TYPE[kind] || kind;
    if (!arr.length) { toast('「' + title + '」暂无内容可导出', 'err'); return; }
    const fname = String(S.settings.appName || '档案').replace(/[\\/:*?"<>|]/g, '_');
    const base = fname + '_' + kind + '-' + new Date().toISOString().slice(0, 10);
    const renderValue = (v) => Array.isArray(v) ? v.join('、') : String(v == null ? '' : v);
    const has = (it, f) => !(it[f.k] === undefined || it[f.k] === null || (Array.isArray(it[f.k]) && !it[f.k].length) || it[f.k] === '');
    const dload = (content, ext, mime, l) => {
      const blob = new Blob([content], { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = base + '.' + ext;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 400);
      pushAudit('export', kind, title + ' × ' + arr.length + ' · ' + l);
      toast('已导出「' + title + '」共 ' + arr.length + ' 条（.' + ext + '）', 'ok');
    };

    // Word / Excel / PDF：经主进程生成 Office / PDF 二进制后按 Blob 下载
    if (fmt === 'docx' || fmt === 'xlsx') {
      const colDefs = [{ l: '名称', k: 'name' }].concat(schema.filter(f => f.k !== 'name' && f.t !== 'tags').map(f => ({ l: f.l, k: f.k })));
      const cols = colDefs.map(c => c.l);
      const rows = arr.map(it => {
        const cells = [];
        for (const f of schema) { if (f.k === 'name' || !has(it, f)) continue; try { cells.push([String(f.l), renderValue(it[f.k])]); } catch (_) {} }
        if (it.source) cells.push(['来源', renderValue(it.source)]);
        return { name: String(it.name || it.title || '未命名'), cells };
      });
      const grid = arr.map(it => colDefs.map(c => (c.k === 'name') ? String(it.name || it.title || '未命名') : renderValue(it[c.k])));
      try {
        const res = await window.api.exportDoc({ format: fmt, title, count: arr.length, rows, cols, grid });
        if (!res || !res.ok) { toast('导出失败：' + ((res && res.error) || '未知错误'), 'err'); return; }
        dload(res.buf, res.ext, res.mime, (fmt === 'docx' ? 'Word' : 'Excel'));
      } catch (e) {
        toast('导出失败：' + ((e && e.message) || e), 'err');
      }
      return;
    }
    if (fmt === 'pdf') {
      const cards = arr.map(it => {
        const nm = String(it.name || it.title || '未命名');
        const cells = schema.filter(f => f.k !== 'name' && has(it, f))
          .map(f => `<tr><th>${esc(f.l)}</th><td>${esc(renderValue(it[f.k]))}</td></tr>`).join('');
        return `<details class="doc" open><summary class="doc-s">${esc(nm)}</summary><table class="doc-t"><tbody>${cells}</tbody></table></details>`;
      }).join('\n');
      const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${esc(title)}</title>
        <style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:760px;margin:8px auto;padding:0 8px;color:#1f2328;background:#fff}
        h1{border-bottom:2px solid #333;padding-bottom:8px;font-size:24px}h2{font-size:18px}.meta{color:#57606a;font-size:13px;margin-bottom:14px}
        .doc{margin:10px 0;border:1px solid #dfe1e5;border-radius:8px;overflow:hidden}.doc-s{padding:9px 12px;background:#f6f8fa;font-weight:600}
        .doc-t{width:100%;border-collapse:collapse}.doc-t th,.doc-t td{border:1px solid #eef0f2;padding:5px 9px;text-align:left;vertical-align:top;font-size:13px}
        .doc-t th{width:130px;background:#fafbfc;color:#57606a;font-weight:600}.page{page-break-before:always}</style></head><body>
        <h1>${esc(title)}</h1><div class="meta">共 ${arr.length} 条 · ${new Date().toLocaleString('zh-CN')}</div>${cards}</body></html>`;
      try {
        const res = await window.api.exportDoc({ format: 'pdf', title, count: arr.length, html });
        if (!res || !res.ok) { toast('导出失败：' + ((res && res.error) || '未知错误'), 'err'); return; }
        dload(res.buf, 'pdf', 'application/pdf', 'PDF');
      } catch (e) {
        toast('导出失败：' + ((e && e.message) || e), 'err');
      }
      return;
    }

    if (fmt === 'json') { dload(JSON.stringify(arr, null, 2), 'json', 'application/json;charset=utf-8', 'JSON'); return; }

    if (fmt === 'csv') {
      const cols = schema.filter(f => f.t !== 'textarea' && f.t !== 'tags').map(f => f.k);
      if (!cols.some(c => c === 'name')) cols.unshift('name');
      const escC = (s) => { const v = renderValue(s).replace(/"/g, '""'); return /[",\n\r]/.test(v) ? '"' + v + '"' : v; };
      const hdr = cols.map(c => { const f = schema.find(x => x.k === c); return escC(f ? f.l : c); }).join(',');
      const body = arr.map(it => cols.map(c => escC(it[c])).join(',')).join('\r\n');
      dload('\ufeff' + hdr + '\r\n' + body, 'csv', 'text/csv;charset=utf-8', 'CSV'); return;
    }

    if (fmt === 'html') {
      const cards = arr.map(it => {
        const nm = it.name || it.title || '未命名';
        const cells = schema.filter(f => f.k !== 'name' && has(it, f))
          .map(f => `<tr><th>${esc(f.l)}</th><td>${esc(renderValue(it[f.k]))}</td></tr>`).join('');
        return `<details class="doc"><summary class="doc-s">${esc(nm)}</summary><table class="doc-t">${cells}</table></details>`;
      }).join('\n');
      const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${esc(title)}</title>
        <style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:860px;margin:26px auto;padding:0 16px;color:#23272f;background:#fff}
        h1{border-bottom:2px solid #333;padding-bottom:8px}.doc{margin:10px 0;border:1px solid #dfe1e5;border-radius:8px;overflow:hidden}
        .doc-s{cursor:pointer;padding:10px 14px;background:#f6f8fa;font-weight:600}.doc-t{width:100%;border-collapse:collapse}
        .doc-t th,.doc-t td{border:1px solid #eef0f2;padding:6px 10px;text-align:left;vertical-align:top;font-size:14px}
        .doc-t th{width:130px;background:#fafbfc;color:#57606a;font-weight:600}</style></head><body>
        <h1>${esc(title)}（全量导出 · ${arr.length} 条）</h1>${cards}</body></html>`;
      dload(html, 'html', 'text/html;charset=utf-8', 'HTML'); return;
    }

    // 纯文本
    if (fmt === 'txt') {
      const lines = [title + '（全量导出）', '共 ' + arr.length + ' 条 · ' + new Date().toLocaleString('zh-CN'), '', '====================', ''];
      for (const it of arr) {
        const name = it.name || it.title || '未命名';
        lines.push('【' + name + '】');
        for (const f of schema) { if (f.k === 'name') continue; if (!has(it, f)) continue; lines.push('  ' + f.l + '：' + renderValue(it[f.k])); }
        if (it.source) lines.push('  来源：' + renderValue(it.source));
        lines.push('');
      }
      dload(lines.join('\n'), 'txt', 'text/plain;charset=utf-8', 'TXT'); return;
    }

    // Markdown（默认）
    const lines = ['# ' + title + '（全量导出）', '', '共 ' + arr.length + ' 条 · ' + new Date().toLocaleString('zh-CN'), '', '---', ''];
    for (const it of arr) {
      const name = it.name || it.title || '未命名';
      lines.push('## ' + name);
      for (const f of schema) { if (f.k === 'name') continue; if (!has(it, f)) continue; lines.push('- **' + f.l + '**：' + renderValue(it[f.k])); }
      if (it.source) lines.push('- **来源**：' + renderValue(it.source));
      lines.push('');
    }
    dload(lines.join('\n'), 'md', 'text/markdown;charset=utf-8', 'Markdown');
  }

  /* ========== 玩家投放物（讲义）：KP 字段过滤 + 讲义导出 ==========
   * KP 在字段编辑里把某字段勾选为「GM 专属」后，导出讲义时会自动隐藏，避免把秘密/
   * 动机/数值等 GM 信息泄露给玩家；讲义以玩家可读的 HTML 生成并支持 PDF 导出。 */
  function handoutFields(schema) {
    return (schema || []).filter(f => f.k !== 'name' && !f.gm);   // 玩家可见字段（排除名称与 GM 专属）
  }
  /* 依据 schema 判断是否 GM 专属（供统计用） */
  function gmFieldCount(kind, schema) {
    return (schema || []).filter(f => f.k !== 'name' && f.gm).length;
  }
  /* 打开讲义生成器弹窗：选择要投放给玩家的资料卡 */
  function handoutOpen(kind) {
    const arr = S.data.entities[kind] || [];
    if (!arr.length) { toast('「' + DATA_TYPE[kind] + '」暂无内容可制作讲义', 'err'); return; }
    const schema = (S.fields[kind] || []).filter(f => f.k !== 'name');
    const gmN = gmFieldCount(kind, schema);
    const mask = q('modalMask'); const box = q('modalBox');
    const rows = arr.map(it => {
      const name = esc(it.name || it.title || '未命名');
      return `<label class="hd-row" style="display:flex;align-items:center;gap:8px;padding:6px;border:1px solid var(--rule);border-radius:8px;cursor:pointer">
        <input type="checkbox" class="hd-pick" data-id="${esc(it.id)}" checked> <span style="flex:1">${name}</span></label>`;
    }).join('');
    const safeFields = handoutFields(schema).map(f => esc(f.l)).join('、') || '（无）';
    const gmFields = schema.filter(f => f.gm).map(f => esc(f.l)).join('、') || '（无）';
    box.innerHTML = `<h3>投放物 · ${esc(DATA_TYPE[kind])}</h3>
      <div class="note" style="white-space:normal;line-height:1.7">选择要投放给玩家的资料卡，将自动隐藏「GM 专属」字段。<br>
      玩家可见字段：<b>${safeFields}</b><br>
      GM 专属（已隐藏）：${gmN ? '<b style="color:#e05d5d">' + gmFields + '</b>' : '<span class="hint">无，可在 设置→字段 勾选「GM 专属」</span>'}</div>
      <div class="hd-list" style="max-height:38vh;overflow:auto;display:grid;gap:6px;margin:8px 0">${rows}</div>
      <div class="foot">
        <button class="ghost" onclick="WB.toggleHandoutAll()">全选/全不选</button><span class="grow"></span>
        <button class="ghost" onclick="WB.closeModal()">取消</button>
        <button onclick="WB.handoutExport('${kind}')">制作讲义 →</button></div>`;
    mask.hidden = false;
  }
  function toggleHandoutAll() {
    const cbs = document.querySelectorAll('.hd-pick');
    const any = Array.from(cbs).some(c => !c.checked);
    cbs.forEach(c => c.checked = any);
  }
  /* 用所选资料卡生成讲义 HTML（safeFields 为玩家可见字段） */
  function buildHandoutHTML(kind, list) {
    const title = DATA_TYPE[kind] || kind;
    const cards = list.map(({ it, safeFields }) => {
      const nm = esc(it.name || it.title || '未命名');
      const cells = safeFields.filter(f => it[f.k] !== undefined && it[f.k] !== null && it[f.k] !== '' && !(Array.isArray(it[f.k]) && !it[f.k].length))
        .map(f => `<tr><th>${esc(f.l)}</th><td>${esc(Array.isArray(it[f.k]) ? it[f.k].join('、') : it[f.k])}</td></tr>`).join('');
      return `<div class="doc"><div class="doc-s">${nm}</div><table class="doc-t"><tbody>${cells || '<tr><td style="color:#57606a">（暂无玩家可见内容）</td></tr>'}</tbody></table></div>`;
    }).join('\n');
    return { title, fname, cards };
  }
  /* 生成讲义 HTML 字符串（把玩家实体整理成一份可读文档） */
  function handoutHTML(kind, pickIds) {
    const arr = S.data.entities[kind] || [];
    const schema = S.fields[kind] || [];
    const safeFields = handoutFields(schema);
    const set = new Set(pickIds || []);
    const list = arr.filter(it => set.has(it.id)).map(it => ({ it, safeFields }));
    const { title, cards } = buildHandoutHTML(kind, list);
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${esc(title)} · 玩家讲义</title>
      <style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:760px;margin:8px auto;padding:0 8px;color:#1f2328;background:#fff}
      h1{border-bottom:2px solid #333;padding-bottom:8px;font-size:24px}.meta{color:#57606a;font-size:13px;margin-bottom:14px}
      .doc{margin:10px 0;border:1px solid #dfe1e5;border-radius:8px;overflow:hidden}.doc-s{padding:9px 12px;background:#f6f8fa;font-weight:600}
      .doc-t{width:100%;border-collapse:collapse}.doc-t th,.doc-t td{border:1px solid #eef0f2;padding:5px 9px;text-align:left;vertical-align:top;font-size:13px}
      .doc-t th{width:130px;background:#fafbfc;color:#57606a;font-weight:600}.page{page-break-before:always}</style></head><body>
      <h1>${esc(title)} · 玩家讲义</h1><div class="meta">共 ${list.length} 条 · ${new Date().toLocaleString('zh-CN')}<br>由 KP 生成，GM 专属信息已隐藏</div>${cards}</body></html>`;
  }
  /* 生成讲义并下载 HTML */
  async function handoutExport(kind) {
    const cbs = Array.from(document.querySelectorAll('.hd-pick')).filter(c => c.checked);
    if (!cbs.length) { toast('请至少选择一张资料卡', 'err'); return; }
    const ids = cbs.map(c => c.dataset.id);
    const arr = S.data.entities[kind] || [];
    const schema = S.fields[kind] || [];
    const safeFields = handoutFields(schema);
    const set = new Set(ids);
    const list = arr.filter(it => set.has(it.id)).map(it => ({ it, safeFields }));
    const { title, fname, cards } = buildHandoutHTML(kind, list);
    const base = fname + '_' + kind + '-讲义-' + new Date().toISOString().slice(0, 10);
    const html = handoutHTML(kind, ids);
    closeModal();
    pushAudit('export', kind, title + ' 讲义 × ' + list.length + ' · PDF');
    try {
      const res = await window.api.exportDoc({ format: 'pdf', title: title + ' · 玩家讲义', count: list.length, html });
      if (!res || !res.ok) { toast('讲义 PDF 导出失败：' + ((res && res.error) || '未知错误'), 'err'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([res.buf], { type: 'application/pdf' }));
      a.download = base + '.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 400);
      toast('已生成玩家讲义 PDF（' + list.length + ' 条，GM 信息已隐藏）', 'ok');
    } catch (e) { toast('讲义 PDF 导出失败：' + ((e && e.message) || e), 'err'); }
  }
  function importData(input) {
    const f = input.files && input.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const j = JSON.parse(rd.result);
        if (!j || !j.entities) throw new Error('不是有效的工作台导出文件');
        S.data = S.data || {};
        S.data.entities = j.entities;
        if (j.fields) S.fields = j.fields;
        if (j.profiles) S.profiles = j.profiles;
        if (j.relations && typeof j.relations === 'object') S.data.relations = j.relations;
        if (!S.data.audit) S.data.audit = [];
        // AI 内容：模板 / 长期记忆 / 提示词（合并进既定设定，其余“设定”保持当前不变）
        if (Array.isArray(j.templates) && j.templates.length) S.settings.templates = j.templates.slice();
        if (Array.isArray(j.memory) && j.memory.length) S.settings.memory = j.memory.slice();
        if (j.prompts && typeof j.prompts === 'object') S.settings.prompts = j.prompts;
        if (Array.isArray(j.audit) && j.audit.length) S.data.audit = j.audit;
        if (typeof j.rawText === 'string') S.rawText = j.rawText;
        if (typeof j.rawSuggested === 'string') S.rawSuggested = j.rawSuggested;
        if (j.rawScript) S.rawScript = j.rawScript;
        if (j.scriptProg && typeof j.scriptProg === 'object') S.settings.scriptProg = j.scriptProg;
        if (Array.isArray(j.maps)) S.data.maps = j.maps.slice();
        persist(); updateTopProfile();
        applyTheme(S.settings.theme || 'ember', true); // 保留当前设定主题，不覆盖“设定”
        switchView('dash');
        toast('导入成功：资料 + AI 内容已合并（不含主题/布局/AI 连接等设定）', 'ok');
      } catch (e) { toast('导入失败：' + e.message, 'err'); }
    };
    rd.readAsText(f);
  }
  async function openFolder() { await window.api.openFolder(); }
  async function paintDataInfo() {
    try {
      const info = await window.api.dataInfo();
      const fl = q('dataFolderLabel'); if (fl) fl.textContent = info.folder;
      const ml = q('dataModeLabel');
      if (ml) ml.textContent = info.portable ? '绿色版（数据随包存放在 EXE 旁，可整个文件夹拷贝搬迁）' : '安装版（数据在系统用户目录，用新安装包覆盖升级不丢数据）';
    } catch (_) {}
  }
  async function importLegacy() {
    if (!(await appConfirm('迁移旧数据', '将选择旧版的数据文件夹并把它迁移到当前数据目录。\n\n注意：这会把旧文件夹内容复制并入当前数据目录（不删除旧文件）。继续？'))) return;
    const r = await window.api.importLegacyData();
    if (!r) { toast('未完成', 'err'); return; }
    if (r.canceled) return;
    if (!r.ok) { toast(r.error || '迁移失败', 'err'); return; }
    toast('已迁移 ' + r.copied + ' 项数据文件，正在刷新…', 'ok');
    setTimeout(() => location.reload(), 900);
  }

  /* ========== 原始文本界面（去除无效乱码 → 纯净文本 → AI 带团建议） ========== */
  /* 去除无效乱码：只保留常见可见字符与排版字符，尽量保留原文结构（换行/段落/常见标点） */
  function cleanText(raw) {
    return String(raw == null ? '' : raw)
      .replace(/\uFEFF/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .replace(/[^\x20-\x7E\u00A1-\u00FF\u2010-\u2027\u2030-\u205E\u2100-\u214F\u2E80-\uFFF9\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFE30-\uFE4F\uFF01-\uFF5E\n\r\t]/g, '');
  }
  function renderRawText() {
    const has = !!S.rawText;
    const hasScript = Array.isArray(S.rawScript && S.rawScript.scenes);
    const v = S.rawShow || 'text';
    let html = `<div class="page-title"><h2>原始文本</h2><span class="hint">去除无效乱码后的纯净文本，尽量保留原文结构；可把文件拖入窗口或点「导入文件」导入</span></div>`;
    html += `<div class="setcard">
      <div class="toolbar">
        <label class="file-label"><input type="file" id="rawFile" accept=".txt,.md,.markdown,.log,.json,.yaml,.yml,.xml,.csv,.xlsx,.xls,.pdf,.docx" hidden>
          <span class="ghost filebtn">📄 导入文件</span></label>
        <button class="ghost" onclick="WB.rawClear()">清空</button>
        <span class="grow"></span>
        <button id="rawSuggestBtn" ${has ? '' : 'disabled'} onclick="WB.rawSuggest()">⚡ AI 建议</button>
        <button id="rawScriptBtn" ${has ? '' : 'disabled'} onclick="WB.rawScriptBreak()" title="在不改原剧情的前提下，把整篇团本拆分成一幕幕剧本（展示每幕的人物/地点/剧情/线索）">🎬 剧本分幕</button>
        <button class="ghost" onclick="WB.rawExport()">导出文本</button>
      </div>
      ${hasScript ? `<div class="raw-switch" id="rawSwitch">
        <button class="raw-tab ${v === 'text' ? 'on' : ''}" data-v="text" onclick="WB.rawShowTxt()">纯净文本</button>
        ${S.rawSuggested ? `<button class="raw-tab ${v === 'suggest' ? 'on' : ''}" data-v="suggest" onclick="WB.rawShowSug()">AI 建议</button>` : ''}
        <button class="raw-tab ${v === 'script' ? 'on' : ''}" data-v="script" onclick="WB.rawShowScript()">🎬 剧本分幕</button>
        ${v === 'script' ? '<button class="ghost small" onclick="WB.rawExportScript()">导出剧本</button>' : ''}
      </div>` : ''}
      <div class="row full"><label>输入 / 粘贴原始内容（或从上方导入文件，自动去除乱码）</label>
        <textarea id="rawInput" rows="6" oninput="WB.rawInput()" placeholder="在此粘贴或导入文本…">${esc(S.rawText || '')}</textarea></div>
      <div class="hint" style="margin:4px 0 8px">下方为 ${
        v === 'script' ? '「剧本分幕」展示，其余信息请切回对应标签；' :
        v === 'suggest' ? '带团建议展示，其余信息请切回「纯净文本」标签；' :
        '纯净文本展示'
      }${!hasScript && !S.rawSuggested ? '点「AI 建议」会在不改动原文的前提下插入彩色括号建议；点「🎬 剧本分幕」会把团本拆成可上演的一幕幕剧本。' : ''}</div>
      <div class="raw-text-container" id="rawOut">${has ? rawBodyHtml() : '<span class="hint">（暂无内容，请先导入或粘贴文本）</span>'}</div>
    </div>`;
    contentInner(html);
    const fi = q('rawFile');
    if (fi) fi.addEventListener('change', (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) rawImportFile(f); ev.target.value = ''; });
  }
  /* 组装原始输出区域：按当前展示标签（纯净 / AI 建议 / 剧本分幕）渲染 */
  function rawBodyHtml() {
    const v = S.rawShow || 'text';
    if (v === 'suggest' && S.rawSuggested) return suggestionHtml(S.rawSuggested);
    if (v === 'script' && Array.isArray(S.rawScript && S.rawScript.scenes) && S.rawScript.scenes.length) return scriptViewHtml(S.rawScript);
    return esc(S.rawText);
  }
  /* ============================================================
   * 剧本进度（C1）—— 把「一次性分幕稿」变成「开团推进器」
   * 开团时最缺的不是剧本内容，而是「演到哪一幕、哪些伏笔还没兑现、这一幕要给谁布置什么」。
   * 设计要点：
   *   ① 完全不改动 S.rawScript 原稿，进度写在平行映射 S.settings.scriptProg 里，随时可清空重开；
   *   ② 用「剧本指纹」(scriptSig) 绑定进度：原文变化或 AI 重新分幕后指纹失配，旧进度自动作废，绝不错位；
   *   ③ 线索兑现按「线索文本」匹配而非下标，幕内线索顺序被调整也不会错勾；
   *   ④ 状态与统计是纯函数，可在无 DOM 环境下回归测试。
   * ============================================================ */
  const SCENE_ST = [['todo', '未开始'], ['now', '进行中'], ['done', '已完成'], ['skip', '略过']];
  function scriptStLabel(v) { const f = SCENE_ST.find(x => x[0] === v); return f ? f[1] : '未开始'; }
  function scriptStValid(v) { return SCENE_ST.some(x => x[0] === v) ? v : 'todo'; }

  /* 剧本指纹：幕数 + 各幕标题。同一份分幕结果稳定得到同一指纹（无随机数） */
  function scriptSig(script) {
    const scenes = (script && Array.isArray(script.scenes)) ? script.scenes : [];
    return scenes.length + '|' + scenes.map(s => String((s && s.title) || '').trim()).join('\u0001');
  }
  /* 只读读取当前进度（渲染路径不产生副作用：指纹不符即视为空进度） */
  function scriptProgRead(script) {
    const box = S.settings && S.settings.scriptProg;
    if (!box || typeof box !== 'object') return {};
    if (box.sig !== scriptSig(script)) return {};
    return (box.scenes && typeof box.scenes === 'object') ? box.scenes : {};
  }
  /* 写入用：指纹不符则整块重置（旧剧本的进度不再复用） */
  function scriptProgBox(script) {
    if (!S.settings.scriptProg || typeof S.settings.scriptProg !== 'object') S.settings.scriptProg = {};
    const box = S.settings.scriptProg;
    const sig = scriptSig(script);
    if (box.sig !== sig || !box.scenes || typeof box.scenes !== 'object') { box.sig = sig; box.scenes = {}; }
    return box;
  }
  /* 单幕进度条目（缺省补全），返回值始终可安全读写 */
  function scriptSceneProg(prog, idx) {
    const e = (prog || {})[idx];
    const o = (e && typeof e === 'object') ? e : {};
    return { st: scriptStValid(o.st), note: String(o.note || ''), clues: Array.isArray(o.clues) ? o.clues : [] };
  }
  /* 线索兑现状态：按文本匹配已存记录，返回与入参一一对应的 [{text,done}] */
  function scriptClueStates(prog, sIdx, clues) {
    const saved = scriptSceneProg(prog, sIdx).clues;
    return (Array.isArray(clues) ? clues : []).map(t => {
      const hit = saved.find(x => x && String(x.text) === String(t));
      return { text: String(t), done: !!(hit && hit.done) };
    });
  }
  /* 进度统计（纯函数）：各状态计数、当前幕、待兑现伏笔清单 */
  function scriptStats(script, prog) {
    const scenes = (script && Array.isArray(script.scenes)) ? script.scenes : [];
    const out = { total: scenes.length, todo: 0, now: 0, done: 0, skip: 0, nowIdx: -1, pending: [], cluesTotal: 0, cluesDone: 0 };
    scenes.forEach((sc, i) => {
      const e = scriptSceneProg(prog, i);
      out[e.st]++;
      if (e.st === 'now' && out.nowIdx === -1) out.nowIdx = i;
      const clues = (Array.isArray(sc.clues) ? sc.clues : []).map(x => String(x == null ? '' : x)).filter(x => x.trim());
      for (const c of scriptClueStates(prog, i, clues)) {
        out.cluesTotal++;
        if (c.done) out.cluesDone++;
        else if (e.st !== 'skip') out.pending.push({ scene: i + 1, title: sc.title || '', text: c.text });
      }
    });
    /* 没有显式「进行中」时，把第一幕「未开始」当作当前幕，开团时一眼看到该从哪起 */
    if (out.nowIdx === -1) {
      for (let i = 0; i < scenes.length; i++) { if (scriptSceneProg(prog, i).st === 'todo') { out.nowIdx = i; break; } }
    }
    return out;
  }
  /* 开团清单：把某一幕的要素与待兑现伏笔整理成可直接交给 AI 的提示词 */
  function scriptChecklistText(script, prog, idx) {
    const scenes = (script && Array.isArray(script.scenes)) ? script.scenes : [];
    if (!scenes.length) return '';
    const st = scriptStats(script, prog);
    const i = (typeof idx === 'number' && idx >= 0 && idx < scenes.length) ? idx : (st.nowIdx >= 0 ? st.nowIdx : 0);
    const sc = scenes[i] || {};
    const loc = (Array.isArray(sc.location) ? sc.location : []).map(String).filter(Boolean).join('、') || '未明示';
    const people = (Array.isArray(sc.characters) ? sc.characters : [])
      .map(c => String((c && typeof c === 'object') ? (c.name || '') : (c == null ? '' : c))).filter(Boolean).join('、') || '未明示';
    const props = (Array.isArray(sc.props) ? sc.props : []).map(String).filter(Boolean).join('、') || '无';
    const clues = (Array.isArray(sc.clues) ? sc.clues : []).map(String).filter(x => x.trim());
    const clueSt = scriptClueStates(prog, i, clues);
    const memo = scriptSceneProg(prog, i).note;
    const pend = st.pending.filter(p => p.scene === i + 1).map(p => p.text);
    const lines = [];
    lines.push('【第 ' + (i + 1) + ' 幕开团清单】' + (sc.title ? ' · ' + sc.title : ''));
    lines.push('- 地点：' + loc);
    lines.push('- 出场：' + people);
    lines.push('- 道具 / 机关 / 魔物：' + props);
    if (sc.time) lines.push('- 时间：' + sc.time);
    if (clueSt.length) lines.push('- 线索兑现：' + clueSt.map(c => (c.done ? '☑ ' : '☐ ') + c.text).join('　'));
    if (pend.length) lines.push('- 待兑现伏笔：' + pend.map((t, k) => (k + 1) + ') ' + t).join('　'));
    lines.push('- 全篇进度：已完成 ' + st.done + ' / ' + st.total + ' 幕'
      + (st.pending.length ? '，尚有 ' + st.pending.length + ' 条伏笔未兑现' : '，伏笔已全部兑现'));
    if (memo) lines.push('- 上次现场备注：' + memo);
    lines.push('');
    lines.push('请按以上要素给出本幕的开场白、关键场景引导与检查点提示（含需要掷骰的时机与难度建议）。');
    return lines.join('\n');
  }

  /* 顶部常驻「本场待办」条：当前幕 + 进度条 + 未兑现伏笔一览 + 一键开团清单 */
  function scriptTodoBarHtml(script, prog, st) {
    const scenes = (script && Array.isArray(script.scenes)) ? script.scenes : [];
    const i = st.nowIdx;
    const cur = (i >= 0 && scenes[i]) ? scenes[i] : null;
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    const pendInCur = st.pending.filter(p => p.scene === i + 1).length;
    const started = st.done + st.now + st.skip;
    let h = `<div class="script-todo">
      <div class="std-row">
        <span class="std-live">当前</span>
        <b class="std-cur">${cur ? ('第 ' + (i + 1) + ' 幕 · ' + esc(cur.title || '未命名')) : '全部完成'}</b>
        <span class="std-bar" title="已完成 ${st.done} / ${st.total} 幕"><i style="width:${pct}%"></i></span>
        <span class="hint">${st.done}/${st.total} 幕 · ${pct}%</span>
        <span class="grow"></span>
        <button class="small" onclick="WB.scriptChecklist()" title="把当前幕的要素与待兑现伏笔整理成提示词，填入侧栏对话">📋 生成本幕开团清单</button>
        ${started ? '<button class="ghost small" onclick="WB.scriptReset()" title="清空全部进度、线索兑现与现场备注（不影响剧本原文）">重开进度</button>' : ''}
      </div>
      <div class="std-row std-2">
        ${st.pending.length
          ? `<span class="std-pend">未兑现伏笔 ${st.pending.length} 条</span>`
            + st.pending.slice(0, 8).map(p => `<span class="std-chip" title="第 ${p.scene} 幕 · ${esc(p.title)}：${esc(p.text)}" onclick="WB.scriptJump(${p.scene - 1})">第${p.scene}幕 · ${esc(trunc(p.text, 14))}</span>`).join('')
            + (st.pending.length > 8 ? `<span class="hint">…等共 ${st.pending.length} 条</span>` : '')
          : `<span class="hint">${st.cluesTotal ? '伏笔已全部兑现，可安心推进' : '本剧本未标注线索/伏笔'}</span>`}
        ${pendInCur ? `<span class="hint">· 本幕待兑现 ${pendInCur} 条</span>` : ''}
      </div>
    </div>`;
    return h;
  }

  /* 剧本分幕渲染：一幕一张卡片，清晰展示人物 / 地点 / 剧情 / 线索，并叠加开团进度 */
  function scriptViewHtml(script) {
    const scenes = (script && Array.isArray(script.scenes)) ? script.scenes : [];
    if (!scenes.length) return '<span class="hint">（尚未生成剧本分幕）</span>';
    const overview = script.overview || {};
    const chars = overview.characters || [];
    const prog = scriptProgRead(script);
    const st = scriptStats(script, prog);
    let head = `<div class="script-head">
      <div class="script-title">剧本分幕 · 全篇共 ${scenes.length} 幕</div>
      ${chars.length ? `<div class="script-meta"><span class="script-meta-l">全篇主要登场</span>${chars.map(c => `<span class="script-person">${esc(c)}</span>`).join('')}</div>` : ''}
    </div>`;
    head += scriptTodoBarHtml(script, prog, st);
    let body = '';
    scenes.forEach((sc, i) => {
      const e = scriptSceneProg(prog, i);
      const curSt = e.st;
      const loc = (Array.isArray(sc.location) && sc.location.length) ? sc.location.map(x => `<span class="script-tag loc">📍 ${esc(x)}</span>`).join('') : '<span class="script-tag loc dim">地点未明示</span>';
      const time = sc.time ? `<span class="script-tag time">🕐 ${esc(sc.time)}</span>` : '';
      const charsHtml = (Array.isArray(sc.characters) && sc.characters.length)
        ? sc.characters.map(c => {
            const nm = (c && typeof c === 'object') ? (c.name || '') : (c == null ? '' : c);
            const role = (c && typeof c === 'object') ? c.role : '';
            return `<span class="script-person">${esc(nm)}${role ? `<i>${esc(role)}</i>` : ''}</span>`;
          }).join('')
        : '<span class="script-tag dim">—</span>';
      /* 线索：带兑现勾选（进度独立存储，不改动分幕原稿） */
      const clueArr = (Array.isArray(sc.clues) ? sc.clues : []).map(String).filter(x => x.trim());
      const clueSt = scriptClueStates(prog, i, clueArr);
      const clueDone = clueSt.filter(c => c.done).length;
      const clues = clueSt.length
        ? clueSt.map((c, ci) => `<li class="clue${c.done ? ' on' : ''}"><label title="勾选表示该伏笔已向玩家兑现"><input type="checkbox" ${c.done ? 'checked' : ''} onchange="WB.scriptToggleClue(${i},${ci})"><span>${esc(c.text)}</span></label></li>`).join('')
        : '<li class="dim">（本幕未明示）</li>';
      const props = (Array.isArray(sc.props) && sc.props.length) ? sc.props.map(x => `<li>${esc(x)}</li>`).join('') : '<li class="dim">（无）</li>';
      const isCur = curSt === 'now';
      body += `<div class="script-scene st-${curSt}" id="sceneCard${i}" style="animation-delay:${Math.min(i * 60, 900)}ms">
        <div class="scene-head">
          <span class="scene-no">第 ${sc.index || i + 1} 幕</span>
          <span class="scene-title">${esc(sc.title || '')}</span>
          ${isCur ? '<span class="scene-live">● 进行中</span>' : ''}
          <span class="grow"></span>
          ${clueSt.length ? `<span class="scene-clue-sum${clueDone === clueSt.length ? ' all' : ''}">伏笔 ${clueDone}/${clueSt.length}</span>` : ''}
          <button class="scene-st st-${curSt}" onclick="WB.scriptStatusCycle(${i})" title="点击循环切换：未开始 → 进行中 → 已完成 → 略过">${scriptStLabel(curSt)}</button>
          ${isCur ? '' : `<button class="ghost small" onclick="WB.scriptGoto(${i})" title="把这一幕设为「进行中」（原进行中的幕自动收尾为已完成）">设为当前</button>`}
        </div>
        <div class="scene-cols">
          <div class="scene-col"><div class="scene-col-l">📍 地点</div><div>${loc}${time}</div></div>
          <div class="scene-col"><div class="scene-col-l">👥 出场人物</div><div class="script-people">${charsHtml}</div></div>
        </div>
        <div class="scene-plot"><div class="scene-col-l">✒ 剧情经过</div><div class="plot-text">${renderInline(sc.plot || '')}</div></div>
        <div class="scene-cols">
          <div class="scene-col"><div class="scene-col-l">🔑 关键线索 / 伏笔<span class="scene-col-hint">勾选＝已兑现</span></div><ul class="script-list clue-list">${clues}</ul></div>
          <div class="scene-col"><div class="scene-col-l">🎒 道具 / 机关 / 魔物</div><ul class="script-list">${props}</ul></div>
        </div>
        ${sc.note ? `<div class="scene-note">⟲ 衔接提示：${esc(sc.note)}</div>` : ''}
        <div class="scene-memo">
          <div class="scene-col-l">✎ 现场备注<span class="scene-col-hint">临场记录：玩家的选择、裁决结果、被迫偏离原剧情…</span></div>
          <input class="scene-note-in" value="${esc(e.note || '')}" placeholder="（本次开团到这一幕时发生的事，留空即为无）" onchange="WB.scriptNoteSet(${i}, this.value)">
        </div>
      </div>`;
    });
    return head + body;
  }
  /* ---- 剧本进度的写入动作（全部只改 S.settings.scriptProg，绝不触碰分幕原稿） ---- */
  function scriptProgPersist(msg) {
    pushAudit('剧本进度', 'edit', '剧本分幕');
    persist();
    if (S.view === 'rawtext') { if ((S.rawShow || '') !== 'script') S.rawShow = 'script'; rawRedrawOut(); }
    if (msg) toast(msg, 'ok');
  }
  /* 取当前剧本的第 idx 幕进度条目并补全缺省（写路径统一入口） */
  function scriptProgAt(idx) {
    const script = S.rawScript;
    if (!script || !Array.isArray(script.scenes) || !script.scenes[idx]) return null;
    const box = scriptProgBox(script);
    const prev = box.scenes[idx];
    const e = (prev && typeof prev === 'object') ? prev : {};
    if (!Array.isArray(e.clues)) e.clues = [];
    if (typeof e.note !== 'string') e.note = '';
    e.st = scriptStValid(e.st);
    box.scenes[idx] = e;
    return { script, box, e };
  }
  /* 点击循环切换状态；切到「进行中」时把原先进行中的幕自动收尾为「已完成」（顺位推进） */
  function scriptStatusCycle(idx) {
    const at = scriptProgAt(idx); if (!at) return;
    const order = SCENE_ST.map(x => x[0]);
    const next = order[(order.indexOf(at.e.st) + 1) % order.length];
    if (next === 'now') {
      for (const k of Object.keys(at.box.scenes)) {
        const o = at.box.scenes[k];
        if (Number(k) !== idx && o && o.st === 'now') o.st = 'done';
      }
    }
    at.e.st = next;
    scriptProgPersist('第 ' + (idx + 1) + ' 幕已标记为「' + scriptStLabel(next) + '」');
  }
  /* 直接把某幕设为「进行中」 */
  function scriptGoto(idx) {
    const at = scriptProgAt(idx); if (!at) return;
    for (const k of Object.keys(at.box.scenes)) {
      const o = at.box.scenes[k];
      if (Number(k) !== idx && o && o.st === 'now') o.st = 'done';
    }
    at.e.st = 'now';
    scriptProgPersist('已切到第 ' + (idx + 1) + ' 幕');
  }
  /* 勾选/取消某条线索的兑现状态（按文本定位，顺序变化也不会错勾） */
  function scriptToggleClue(idx, ci) {
    const at = scriptProgAt(idx); if (!at) return;
    const sc = at.script.scenes[idx];
    const clues = (Array.isArray(sc.clues) ? sc.clues : []).map(String).filter(x => x.trim());
    const text = clues[ci];
    if (!text) return;
    const hit = at.e.clues.find(x => x && String(x.text) === text);
    let nowDone;
    if (hit) { hit.done = !hit.done; nowDone = hit.done; }
    else { at.e.clues.push({ text, done: true }); nowDone = true; }
    scriptProgPersist('伏笔「' + trunc(text, 12) + '」' + (nowDone ? '已兑现' : '已撤销兑现'));
  }
  /* 现场备注：只落盘、不重绘，避免正在输入时输入框被重建而丢光标 */
  function scriptNoteSet(idx, val) {
    const at = scriptProgAt(idx); if (!at) return;
    at.e.note = String(val == null ? '' : val).slice(0, 2000);
    pushAudit('剧本进度', 'edit', '现场备注');
    persist();
  }
  /* 点击待办条上的伏笔 → 滚动定位到那一幕 */
  function scriptJump(idx) {
    if (S.view !== 'rawtext') { switchView('rawtext'); }
    if ((S.rawShow || '') !== 'script') { S.rawShow = 'script'; rawRedrawOut(); }
    const el = q('sceneCard' + idx);
    if (el) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { el.scrollIntoView(); } el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); toast('已定位到第 ' + (idx + 1) + ' 幕', ''); }
  }
  /* 重开进度：清空全部状态/兑现/备注，剧本原文不动 */
  async function scriptReset() {
    const script = S.rawScript;
    if (!script || !Array.isArray(script.scenes) || !script.scenes.length) return;
    const ok = await appConfirm('重开进度', '将清空全部幕的进度状态、伏笔兑现与现场备注。剧本分幕原文不受影响，随时可以重新开始记录。确定吗？');
    if (!ok) return;
    S.settings.scriptProg = { sig: scriptSig(script), scenes: {} };
    pushAudit('剧本进度', 'reset', '剧本分幕');
    persist();
    if (S.view === 'rawtext') rawRedrawOut();
    toast('进度已清空，可以重新开团了', 'ok');
  }
  /* 一键生成本幕开团清单 → 填入侧栏对话，作为交给 AI 的提示词起点 */
  function scriptChecklist() {
    const script = S.rawScript;
    if (!script || !Array.isArray(script.scenes) || !script.scenes.length) { toast('请先做「剧本分幕」', 'err'); return; }
    const prog = scriptProgRead(script);
    const st = scriptStats(script, prog);
    const text = scriptChecklistText(script, prog, st.nowIdx);
    if (!text) { toast('无法生成本幕清单', 'err'); return; }
    try { if (navigator.clipboard) navigator.clipboard.writeText(text); } catch (_) {}
    openChat(true);
    const inp = q('drawerIn');
    if (inp) { inp.value = text; try { inp.focus(); inp.setSelectionRange(0, 0); } catch (_) {} }
    toast('已生成第 ' + (st.nowIdx + 1) + ' 幕开团清单（已复制，可直接发送给 AI）', 'ok');
  }
  /* AI 剧本分幕：把原始文本拆成剧本（主进程对超长文本自动分块续幕） */
  async function rawScriptBreak() {
    const text = S.rawText;
    if (!text || !text.trim()) { toast('请先导入或粘贴原始文本', 'err'); return; }
    const btn = q('rawScriptBtn'); if (btn) btn.disabled = true;
    toast('AI 正在剧本分幕，整篇会拆分重组为可上演的剧本，可能需要一点时间…');
    try {
      const r = await window.api.breakdownScenario({ text });
      if (!r || !r.ok) { toast((r && r.error) || '剧本分幕失败', 'err'); return; }
      const scenes = (r.scenes || []).filter(s => s && s.title);
      if (!scenes.length) { toast('AI 未返回分幕结果，请重试', 'err'); return; }
      // 全篇主要登场人物：合并所有幕的人物，按出现频率归并（去重）
      const seen = new Set(); const chars = [];
      for (const sc of scenes) for (const c of (sc.characters || [])) {
        const nm = (c.name || '').trim(); if (!nm || seen.has(nm)) continue; seen.add(nm); chars.push(nm);
      }
      S.rawScript = { scenes, overview: { characters: chars.slice(0, 40) } };
      S.rawShow = 'script';
      persist(); renderRawText();
      toast('剧本分幕完成：共 ' + scenes.length + ' 幕（未改动原剧情）', 'ok');
    } catch (e) {
      toast('剧本分幕失败：' + ((e && e.message) || e), 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  function rawShowTxt() { S.rawShow = 'text'; rawRedrawOut(); syncRawSwitch(); }
  function rawShowSug() { S.rawShow = 'suggest'; rawRedrawOut(); syncRawSwitch(); }
  function rawShowScript() { S.rawShow = 'script'; rawRedrawOut(); syncRawSwitch(); }
  function syncRawSwitch() {
    const el = q('rawSwitch'); if (!el) return;
    const v = S.rawShow || 'text';
    for (const b of el.querySelectorAll('.raw-tab')) b.classList.toggle('on', b.getAttribute('data-v') === v);
  }
  function suggestionHtml(text) {
    let s = esc(text || '');
    const re = /(〔建议〕|【建议】|\[建议\]|〔\/建议〕|【\/建议】|\[\/建议\])/g;
    const parts = s.split(re);
    let out = '', inSug = false;
    for (const p of parts) {
      if (p === '〔建议〕' || p === '【建议】' || p === '[建议]') { out += '<span class="ai-sug">（'; inSug = true; }
      else if (p === '〔/建议〕' || p === '【/建议】' || p === '[/建议]') { out += '）</span>'; inSug = false; }
      else out += p;
    }
    return out;
  }
  /* 抽取单个文件为纯净文本：复用主进程多格式抽取 + 尽量取全文 + 去除乱码 */
  async function rawFileBody(f) {
    const res = await readSmallFile(f);
    if (!res || !res.ok) throw new Error((res && res.error) || '解析失败');
    let body = res.preview || res.content || '';
    if (res.textPath && window.api.getFullText) {
      try { const full = await window.api.getFullText(res.textPath); if (full && full.ok && typeof full.text === 'string' && full.text.trim()) body = full.text; } catch (_) {}
    }
    return { name: res.name || (f && f.name) || '文件', body: cleanText(body.length > 300000 ? body.slice(0, 300000) : body) };
  }
  /* 从文件导入原始文本，并清理乱码（单文件，可由「导入文件」按钮触发） */
  async function rawImportFile(f) {
    try {
      toast('正在解析文件…');
      const r = await rawFileBody(f);
      S.rawText = r.body;
      S.rawSuggested = '';
      S.rawScript = null; S.rawShow = 'text';
      renderRawText();
      const ti = q('rawInput'); if (ti) ti.value = S.rawText;
      const out = q('rawOut'); if (out) out.innerHTML = esc(S.rawText);
      toast('已导入「' + r.name + '」并去除乱码，共 ' + fmtNum(S.rawText.length) + ' 字', 'ok');
    } catch (e) { toast('导入失败：' + ((e && e.message) || e), 'err'); }
  }
  /* 从文件导入原始文本（多文件合并追加，拖拽导入触发） */
  async function rawImportFiles(list) {
    if (!list || !list.length) return;
    try {
      toast('正在解析 ' + list.length + ' 个文件…');
      const parts = [];
      for (const f of list) { parts.push(await rawFileBody(f)); }
      let joined = S.rawText || '';
      for (const p of parts) joined = joined + (joined && p.body ? '\n\n' : '') + p.body;
      if (joined.length > 300000) joined = joined.slice(0, 300000);
      S.rawText = joined;
      S.rawSuggested = '';
      S.rawScript = null; S.rawShow = 'text';
      renderRawText();
      const ti = q('rawInput'); if (ti) ti.value = S.rawText;
      const out = q('rawOut'); if (out) out.innerHTML = esc(S.rawText);
      toast('已导入 ' + list.length + ' 个文件并入原始文本，共 ' + fmtNum(S.rawText.length) + ' 字', 'ok');
    } catch (e) { toast('导入失败：' + ((e && e.message) || e), 'err'); }
  }
  function rawInput() {
    const ti = q('rawInput'); if (!ti) return;
    S.rawText = cleanText(ti.value);
    S.rawSuggested = '';
    S.rawScript = null;                    // 原文变化后旧分幕/建议已失配，清空切回纯净
    S.rawShow = 'text';
    rawRedrawOut();
    const btn = q('rawSuggestBtn'); if (btn) btn.disabled = !S.rawText;
  }
  function rawRedrawOut() {
    const out = q('rawOut'); if (!out) return;
    out.innerHTML = S.rawText ? rawBodyHtml() : '<span class="hint">（暂无内容，请先导入或粘贴文本）</span>';
    syncRawSwitch();
  }
  function rawClear() { S.rawText = ''; S.rawSuggested = ''; S.rawScript = null; S.rawShow = 'text'; renderRawText(); }
  /* AI 带团建议：在原始文本中用彩色括号内联插入建议/方案，不改动原文 */
  async function rawSuggest() {
    const text = S.rawText;
    if (!text || !text.trim()) { toast('请先导入或粘贴原始文本', 'err'); return; }
    const btn = q('rawSuggestBtn'); if (btn) btn.disabled = true;
    toast('AI 正在生成带团建议，可能需要一点时间…');
    try {
      const r = await window.api.aiSuggestText({ text });
      if (!r || !r.ok) { toast((r && r.error) || 'AI 建议生成失败', 'err'); return; }
      if (typeof r.text === 'string' && r.text.trim()) S.rawSuggested = r.text;
      else { toast('AI 未返回建议内容，请重试', 'err'); return; }
      S.rawShow = 'suggest';
      rawRedrawOut();
      toast('已生成带团建议（彩色括号内为建议，原文未改动）', 'ok');
    } catch (e) {
      toast('AI 建议失败：' + aiErrText(e), 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  /* 导出原始文本（若已有 AI 建议则连建议一并导出） */
  async function rawExport() {
    const out = S.rawSuggested || S.rawText;
    if (!out || !out.trim()) { toast('没有可导出的内容', 'err'); return; }
    try {
      const r = await window.api.saveText('原始文本_' + new Date().toISOString().slice(0, 10) + '.txt', out);
      if (!r || r.canceled) return;
      if (!r.ok) { toast(r.error || '导出失败', 'err'); return; }
      toast('已导出文本：' + r.path, 'ok');
    } catch (e) { toast('导出失败：' + ((e && e.message) || e), 'err'); }
  }
  /* 导出剧本分幕（Markdown，含每幕人物/地点/剧情/线索） */
  async function rawExportScript() {
    const sc = Array.isArray(S.rawScript && S.rawScript.scenes) ? S.rawScript.scenes : [];
    if (!sc.length) { toast('还没有剧本分幕结果，先点「🎬 剧本分幕」生成', 'err'); return; }
    const lines = ['# 剧本分幕：' + (S.settings && S.settings.appName || '团本') + '\n', '全篇共 ' + sc.length + ' 幕', ''];
    sc.forEach((s, i) => {
      lines.push('## 第 ' + (s.index || i + 1) + ' 幕 · ' + (s.title || ''));
      if (Array.isArray(s.location) && s.location.length) lines.push('- 地点：' + s.location.join(' / '));
      if (s.time) lines.push('- 时间：' + s.time);
      if (Array.isArray(s.characters) && s.characters.length) lines.push('- 出场人物：' + s.characters.map(c => (typeof c === 'string' ? c : ((c && c.name) || (c && c.character) || '')) + ((c && c.role) ? '(' + c.role + ')' : '')).filter(Boolean).join('、'));
      if (s.plot) lines.push('- 剧情：' + s.plot.replace(/\n/g, ' '));
      if (Array.isArray(s.clues) && s.clues.length) lines.push('- 线索/伏笔：' + s.clues.join('、'));
      if (Array.isArray(s.props) && s.props.length) lines.push('- 道具/机关：' + s.props.join('、'));
      if (s.note) lines.push('- 衔接提示：' + s.note);
      lines.push('');
    });
    try {
      const r = await window.api.saveText('剧本分幕_' + new Date().toISOString().slice(0, 10) + '.md', lines.join('\n'));
      if (!r || r.canceled) return;
      if (!r.ok) { toast(r.error || '导出失败', 'err'); return; }
      toast('已导出剧本分幕：' + r.path, 'ok');
    } catch (e) { toast('导出失败：' + ((e && e.message) || e), 'err'); }
  }

  /* ========== 地图 · 列表 ========== */
  function mapsListHtml() {
    const list = mapsData();
    if (!list.length) return `<div class="empty">还没有地图，点击“＋ 新建地图”导入底图开始布置，或用 AI 快速生成一版。</div>`;
    return `<div class="map-grid">${list.map(m => `
      <div class="map-card">
        <div class="map-thumb">${m.img ? `<img src="${esc(m.img)}" alt="">` : '<span class="map-ph">占位底图</span>'}</div>
        <div class="map-body">
          <b>${esc(m.name)}</b>
          <div class="hint">${(m.markers || []).length} 标记 · ${(m.fog || []).length} 迷雾${m.imgKind === 'placeholder' ? ' · 占位底图' : ''}</div>
        </div>
        <div class="map-ops">
          <button class="ghost" onclick="WB.mapOpen('${escJs(m.id)}')">打开</button>
          <button class="ghost" onclick="WB.mapDel('${escJs(m.id)}','${escJs(m.name)}')">删除</button>
        </div>
      </div>`).join('')}</div>`;
  }
  function renderMaps() {
    let html = `<div class="page-title"><h2>地图</h2><span class="hint">为 DnD/COC 场景布置底图、标记与迷雾，可 AI 一键生成</span></div>`;
    html += `<div class="toolbar"><button onclick="WB.mapNew()">＋ 新建地图</button>
      <span class="grow"></span>
      <button class="ghost" onclick="WB.mapTemplate()">AI 设计地图</button></div>`;
    html += `<div id="mapsList">${mapsListHtml()}</div>`;
    contentInner(html);
  }
  function mapNew() {
    appPrompt({ title: '新建地图', label: '给新地图起个名字（可留空，直接确定则用「未命名地图」）', placeholder: '未命名地图', okText: '创建地图' }, (name) => {
      if (name == null) return; /* 取消则不新建 */
      const m = mkMap(String(name).trim() || '未命名地图');
      mapsData().unshift(m);
      mapPersist();
      mapOpen(m.id);
    });
  }
  async function mapDel(id, name) {
    if (!(await appConfirm('删除地图', '删除地图「' + (name || '') + '」？其中的标记与迷雾将一并移除。'))) return;
    mapsData().splice(mapsData().findIndex(x => x.id === id), 1);
    mapPersist();
    if (S.mapOpenId === id) S.mapOpenId = null;
    renderMaps();
    toast('已删除地图', 'ok');
  }
  function mapOpen(id) {
    const m = mapFind(id); if (!m) return;
    S.mapOpenId = id;
    S.view = 'mapsboard';
    document.querySelectorAll('#sidebar .nav').forEach(n => n.classList.toggle('active', n.dataset.view === 'maps'));
    renderMapBoard(m);
  }

  /* ========== 地图 · 画板引擎 ========== */
  const _map = { tx: 0, ty: 0, k: 1, W: 0, H: 0, drag: null, pan: null, paint: null, sel: null, mode: 'move', paintFog: true, _wire: false, cur: null, curType: 'plot', regionPts: null, editMk: null, ellipse: null, measurePts: null, lastHover: '' };
  function mapCanvas() { return q('mapCanvas'); }
  function mapCtx() { const c = mapCanvas(); return c ? c.getContext('2d') : null; }
  function mapToWorldX(cx) { return (cx - _map.tx) / _map.k; }
  function mapToWorldY(cy) { return (cy - _map.ty) / _map.k; }

  function drawGridOnly(ctx, m, sc_) {
    const sc = sc_ == null ? _map.k : sc_;
    if (m.grid && m.grid.on && m.grid.size > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1 / sc;
      const size = m.grid.size;
      for (let x = 0; x <= m.imgW; x += size) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, m.imgH); ctx.stroke(); }
      for (let y = 0; y <= m.imgH; y += size) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(m.imgW, y); ctx.stroke(); }
    }
  }
  function drawPoly(ctx, pts, fill, stroke, sc) {
    ctx.beginPath();
    pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2 / (sc || _map.k); ctx.stroke(); }
  }
  /* 椭圆形状绘制（区域/迷雾共用） */
  function drawEllipseShape(ctx, cx, cy, rx, ry, fill, stroke, sc) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2 / sc; ctx.stroke(); }
  }
  function pointInPoly(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-9) + xi) inside = !inside;
    }
    return inside;
  }
  /* 命中检测：标记 → 区域 → 迷雾（返回 {k:'reg'|'fog', i}） */
  function mapHitTest(wx, wy, m) {
    const regs = m.regions || [];
    for (let i = regs.length - 1; i >= 0; i--) {
      const r = regs[i];
      if (r.ellipse) {
        /* 椭圆以归一化比例存储，命中判定必须换算回像素半径，否则量纲不一致、永不命中 */
        const e = r.ellipse, dx = wx - e.cx * m.imgW, dy = wy - e.cy * m.imgH;
        const rx = Math.max(1e-6, e.rx * m.imgW), ry = Math.max(1e-6, e.ry * m.imgH);
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.35) return { k: 'reg', i };
      } else {
        const pts = (r.points || []).map(p => [p[0] * m.imgW, p[1] * m.imgH]);
        if (pts.length >= 3 && pointInPoly(wx, wy, pts)) return { k: 'reg', i };
      }
    }
    const fogs = m.fog || [];
    for (let i = fogs.length - 1; i >= 0; i--) {
      const f = fogs[i];
      if (f.ellipse) {
        const e = f.ellipse, dx = wx - e.cx * m.imgW, dy = wy - e.cy * m.imgH;
        const rx = Math.max(1e-6, e.rx * m.imgW), ry = Math.max(1e-6, e.ry * m.imgH);
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.35) return { k: 'fog', i };
      } else {
        const pts = (f.path || []).map(p => [p[0] * m.imgW, p[1] * m.imgH]);
        if (pts.length >= 3 && pointInPoly(wx, wy, pts)) return { k: 'fog', i };
      }
    }
    return null;
  }
  function drawMapLayers(ctx, m, sc_) {
    const sc = sc_ == null ? _map.k : sc_;
    /* 底图绘制在“世界坐标系”（0,0..imgW,imgH）下，与网格/标记/迷雾同源，
       由 mapDraw 的 translate+scale 统一完成平移缩放，避免标记从底图上漂离。 */
    if (m._imgNative) {
      try { ctx.drawImage(m._imgNative, 0, 0, m.imgW, m.imgH); } catch (_) {}
    } else if (!m.img && m.imgKind !== 'uploaded') {
      /* 无底图时的“占位底图”：羊皮纸渐变 + 细线纹理 + 中心提示，
         让用户不开 AI 也能先把网格、标记、区域、迷雾手动摆起来。 */
      const g = ctx.createLinearGradient(0, 0, m.imgW, m.imgH);
      g.addColorStop(0, '#3a3120'); g.addColorStop(0.45, '#2c2517'); g.addColorStop(1, '#241e12');
      ctx.fillStyle = g; ctx.fillRect(0, 0, m.imgW, m.imgH);
      ctx.strokeStyle = 'rgba(224,192,122,0.26)'; ctx.lineWidth = 2 / sc;
      ctx.strokeRect(3 / sc, 3 / sc, m.imgW - 6 / sc, m.imgH - 6 / sc);
      ctx.fillStyle = 'rgba(224,192,122,0.34)'; ctx.font = Math.round(26 / sc) + 'px serif';
      ctx.textAlign = 'center'; ctx.fillText('占位底图', m.imgW / 2, m.imgH / 2 - 8 / sc);
      ctx.font = Math.round(13 / sc) + 'px sans-serif';
      ctx.fillStyle = 'rgba(224,192,122,0.26)';
      ctx.fillText('可点右上「底图」上传图片，或直接用下方工具手动布置', m.imgW / 2, m.imgH / 2 + 18 / sc);
      ctx.textAlign = 'left';
    }
    drawGridOnly(ctx, m, sc);
    /* 区域：多边形或椭圆，选中时高亮 */
    const regs = m.regions || [];
    for (let i = 0; i < regs.length; i++) {
      const reg = regs[i];
      const sel = _map.sel && _map.sel.k === 'reg' && _map.sel.i === i;
      const fill = sel ? 'rgba(224,192,122,0.34)' : 'rgba(194,162,93,0.16)';
      const stroke = sel ? '#ffd97a' : 'rgba(194,162,93,0.85)';
      if (reg.ellipse) {
        const e = reg.ellipse;
        drawEllipseShape(ctx, e.cx * m.imgW, e.cy * m.imgH, e.rx * m.imgW, e.ry * m.imgH, fill, stroke, sc);
        if (reg.label) { ctx.fillStyle = sel ? '#ffd97a' : 'rgba(194,162,93,0.95)'; ctx.font = (13 / sc) + 'px sans-serif'; ctx.fillText(reg.label, e.cx * m.imgW + 4, Math.max(0, e.cy * m.imgH - e.ry * m.imgH - 4)); }
      } else {
        const pts = (reg.points || []).map(p => [p[0] * m.imgW, p[1] * m.imgH]);
        drawPoly(ctx, pts, fill, stroke, sc);
        if (reg.label && pts.length) { ctx.fillStyle = sel ? '#ffd97a' : 'rgba(194,162,93,0.95)'; ctx.font = (13 / sc) + 'px sans-serif'; ctx.fillText(reg.label, pts[0][0] + 4, pts[0][1] - 4); }
      }
    }
    /* 手动框选区域中的“进行中”草稿：半透明填充 + 顶点 + 连线 */
    if (_map.mode === 'region' && _map.regionPts && _map.regionPts.length) {
      const pts = _map.regionPts.map(p => [p[0] * m.imgW, p[1] * m.imgH]);
      if (pts.length >= 3) drawPoly(ctx, pts, 'rgba(160,120,60,0.18)', 'rgba(224,192,122,0.9)', sc);
      else { ctx.strokeStyle = 'rgba(224,192,122,0.9)'; ctx.lineWidth = 2 / sc; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); }
      ctx.fillStyle = '#e0c07a';
      for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], 4 / sc, 0, Math.PI * 2); ctx.fill(); }
    }
    /* 椭圆区域/椭圆迷雾拖拽预览 */
    if ((_map.mode === 'regell' || _map.mode === 'fogell') && _map.ellipse) {
      const e = _map.ellipse;
      const cx = (e.sx + e.curX) / 2, cy = (e.sy + e.curY) / 2;
      const rx = Math.abs(e.curX - e.sx) / 2, ry = Math.abs(e.curY - e.sy) / 2;
      drawEllipseShape(ctx, cx, cy, rx, ry, _map.mode === 'fogell' ? 'rgba(10,10,20,0.68)' : 'rgba(160,120,60,0.18)', _map.mode === 'fogell' ? null : 'rgba(224,192,122,0.9)', sc);
      ctx.strokeStyle = 'rgba(224,192,122,0.8)'; ctx.lineWidth = 1.5 / sc;
      ctx.setLineDash([6 / sc, 5 / sc]);
      ctx.strokeRect(cx - rx, cy - ry, rx * 2, ry * 2);
      ctx.setLineDash([]);
    }
    for (const mk of (m.markers || [])) {
      const t = mapTypeInfo(mk.type);
      ctx.save();
      ctx.translate(mk.x, mk.y);
      ctx.beginPath(); ctx.arc(0, 0, 12 / sc, 0, Math.PI * 2);
      ctx.fillStyle = t[2]; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2 / sc; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + (13 / sc) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t[1].charAt(0), 0, 1 / sc);
      ctx.restore();
      if (mk.label) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = (11 / sc) + 'px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(mk.label, mk.x + 16 / sc, mk.y - 10 / sc); }
    }
    /* 迷雾：多边形或椭圆，选中时描边 */
    for (let i = 0; i < (m.fog || []).length; i++) {
      const f = m.fog[i];
      const sel = _map.sel && _map.sel.k === 'fog' && _map.sel.i === i;
      const st = sel ? '#ffd97a' : null;
      if (f.ellipse) {
        const e = f.ellipse;
        drawEllipseShape(ctx, e.cx * m.imgW, e.cy * m.imgH, e.rx * m.imgW, e.ry * m.imgH, 'rgba(10,10,20,0.68)', st, sc);
      } else {
        const pts = (f.path || []).map(p => [p[0] * m.imgW, p[1] * m.imgH]);
        drawPoly(ctx, pts, 'rgba(10,10,20,0.68)', st, sc);
      }
    }
    /* 网格测量覆盖层：起点/终点圆点 + 虚线连线 */
    if (_map.mode === 'measure' && _map.measurePts && _map.measurePts.length) {
      const pts = _map.measurePts;
      ctx.fillStyle = '#ffd97a';
      for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], 5 / sc, 0, Math.PI * 2); ctx.fill(); }
      if (pts.length === 2) {
        ctx.strokeStyle = 'rgba(255,217,122,0.9)'; ctx.lineWidth = 1.5 / sc;
        ctx.setLineDash([6 / sc, 5 / sc]);
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
  function mapDraw() {
    const cv = mapCanvas(), ctx = mapCtx(), m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
    if (!cv || !ctx || !m) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (W === 0 || H === 0) return;
    if (W !== _map.W || H !== _map.H) { _map.W = W; _map.H = H; cv.width = W * dpr; cv.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = '#14161a';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(_map.tx, _map.ty);
    ctx.scale(_map.k, _map.k);
    if (m.img && !m._imgLoaded && !m._imgLoading) {
      m._imgLoading = true;
      const img = new Image();
      img.onload = () => { m._imgNative = img; m._imgLoaded = true; m._imgLoading = false; m.imgW = img.naturalWidth || m.imgW; m.imgH = img.naturalHeight || m.imgH; mapDraw(); };
      img.onerror = () => { m._imgLoading = false; };
      img.src = m.img;
    }
    drawMapLayers(ctx, m);
    ctx.restore();
  }
  function paintStatus(txt) {
    const s = q('mapStatus'); if (s) s.textContent = txt || '';
  }
  function renderMapBoard(m) {
    const gridOn = m.grid && m.grid.on;
    let html = `<div class="mapboard">
      <div class="mapbar">
        <button class="ghost" onclick="WB.mapBack()">‹ 返回</button>
        <b class="map-name">${esc(m.name)}</b>
        <span class="grow"></span>
        <label class="file-label"><input type="file" id="mapImg" accept="image/*" hidden onchange="WB.mapUpload(event)">
          <span class="ghost">📁 底图</span></label>
        <button class="ghost ${gridOn ? 'on' : ''}" id="mapGridBtn" onclick="WB.mapToggleGrid()">网格${gridOn ? ' ✓' : ''}</button>
        <button class="ghost" id="mapGridSizeBtn" onclick="WB.mapGridSize()" title="设置网格格距（像素），手动布置时用它对齐">格距 ${(m.grid && m.grid.size) || 64}px</button>
        <button class="ghost" onclick="WB.mapExportImg()" title="导出当前地图为 PNG 图片（含网格/区域/标记/迷雾）">⬇ 导出</button>
        <button class="ghost" onclick="WB.mapAi()">⚡ AI 设计</button>
      </div>
      <div class="map-stage" id="mapStage">
        <canvas id="mapCanvas" class="map-canvas"></canvas>
        <div class="map-tools">
          <button class="mt ${_map.mode === 'move' ? 'on' : ''}" data-mode="move" onclick="WB.mapMode('move')" title="选择/拖拽">✥</button>
          <button class="mt ${_map.mode === 'marker' ? 'on' : ''}" data-mode="marker" onclick="WB.mapMode('marker')" title="放置标记">⚑</button>
          <button class="mt ${_map.mode === 'region' ? 'on' : ''}" data-mode="region" onclick="WB.mapMode('region')" title="手动框选区域（每点一下加一个顶点，双击完成）">▤</button>
          <button class="mt ${_map.mode === 'regell' ? 'on' : ''}" data-mode="regell" onclick="WB.mapMode('regell')" title="椭圆区域（按住拖拽成形，松手完成）">◯</button>
          <button class="mt ${_map.mode === 'fog' ? 'on' : ''}" data-mode="fog" onclick="WB.mapMode('fog')" title="涂抹迷雾">╋</button>
          <button class="mt ${_map.mode === 'fogell' ? 'on' : ''}" data-mode="fogell" onclick="WB.mapMode('fogell')" title="椭圆迷雾（按住拖拽成形，松手完成）">◐</button>
          <button class="mt ${_map.mode === 'measure' ? 'on' : ''}" data-mode="measure" onclick="WB.mapMode('measure')" title="网格测量：点两点看距离与格数">📏</button>
        </div>
      </div>
      <div id="mapStatus" class="map-status"></div>
      <div id="mapRegionTip" class="map-status" style="color:var(--accent);bottom:34px"></div>
    </div>`;
    contentInner(html);
    const stage = q('mapStage'); if (stage) { _map._wire = false; mapWire(stage); }
    setTimeout(mapFit, 30);
  }
  function mapBack() {
    S.mapOpenId = null;
    /* 复位画板状态：sel 是“按下标记录”的选中项，不复位会在打开另一张地图时错误高亮同位下标 */
    _map.paint = null; _map.drag = null; _map.pan = null; _map.sel = null;
    _map.editMk = null; _map.ellipse = null; _map.regionPts = null; _map.measurePts = null;
    _map.mode = 'move'; _modalCancel = null;
    S.view = 'maps'; renderMaps();
  }
  function mapWire(stage) {
    if (_map._wire) return; _map._wire = true;
    const cv = mapCanvas(); if (!cv) return;
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nk = Math.min(6, Math.max(0.2, _map.k * f));
      const k = nk / _map.k;
      _map.tx = mx - (mx - _map.tx) * k;
      _map.ty = my - (my - _map.ty) * k;
      _map.k = nk;
      mapDraw();
      paintStatus('缩放 ' + Math.round(_map.k * 100) + '%');
    }, { passive: false });
    cv.addEventListener('mousedown', (e) => {
      const rect = cv.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const wx = mapToWorldX(cx), wy = mapToWorldY(cy);
      const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
      if (_map.mode === 'move') {
        const hitMk = m && (m.markers || []).find(mk => (mk.x - wx) ** 2 + (mk.y - wy) ** 2 < (18 / _map.k) ** 2);
        if (hitMk) { _map.drag = { id: hitMk.id, ox: wx - hitMk.x, oy: wy - hitMk.y, sx: e.clientX, sy: e.clientY, moved: false }; }
        else {
          const hit = m ? mapHitTest(wx, wy, m) : null;
          if (hit) {
            _map.sel = hit;
            mapDraw();
            if (hit.k === 'reg') {
              const r = (m.regions || [])[hit.i];
              paintStatus('已选中区域「' + ((r && r.label) || '区域') + '」 · 双击改名 · Del/右键删除 · Esc 取消');
            } else {
              paintStatus('已选中迷雾块 · Del/右键删除 · Esc 取消');
            }
          } else { _map.sel = null; _map.pan = { sx: e.clientX, sy: e.clientY, tx: _map.tx, ty: _map.ty }; }
        }
      } else if (_map.mode === 'marker') {
        addMarkerAt(wx, wy);
      } else if (_map.mode === 'region') {
        if (!_map.regionPts) _map.regionPts = [];
        _map.regionPts.push([mClamp1(wx / m.imgW), mClamp1(wy / m.imgH)]);
        const rp = q('mapRegionTip');
        if (rp) rp.textContent = '已点 ' + _map.regionPts.length + ' 个顶点 · 双击画布完成，右键/Esc 取消';
        mapDraw();
      } else if (_map.mode === 'regell' || _map.mode === 'fogell') {
        _map.ellipse = { sx: wx, sy: wy, curX: wx, curY: wy };
      } else if (_map.mode === 'fog') {
        _map.paint = { pts: [[wx, wy]], idx: -1, dirty: false };
      } else if (_map.mode === 'measure') {
        if (!_map.measurePts) _map.measurePts = [];
        _map.measurePts.push([Math.round(wx), Math.round(wy)]);
        if (_map.measurePts.length > 2) _map.measurePts = [_map.measurePts[2]];
        updateMeasureStatus(m);
        mapDraw();
      }
    });
    cv.addEventListener('dblclick', (e) => {
      if (_map.mode === 'region') { e.preventDefault(); mapFinishRegion(); return; }
      if (_map.mode === 'move') {
        const rect = cv.getBoundingClientRect();
        const wx = mapToWorldX(e.clientX - rect.left), wy = mapToWorldY(e.clientY - rect.top);
        const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
        if (!m) return;
        const hitMk = (m.markers || []).find(mk => (mk.x - wx) ** 2 + (mk.y - wy) ** 2 < (18 / _map.k) ** 2);
        if (hitMk) { e.preventDefault(); mapEditMarker(hitMk, false); return; }
        if (_map.sel && _map.sel.k === 'reg') { e.preventDefault(); mapRenameRegion(); return; }
        const hit = mapHitTest(wx, wy, m);
        if (hit && hit.k === 'reg') { e.preventDefault(); _map.sel = hit; mapRenameRegion(); }
      }
    });
    cv.addEventListener('contextmenu', (e) => {
      if (_map.mode === 'region') {
        e.preventDefault();
        _map.regionPts = null;
        const rp = q('mapRegionTip'); if (rp) rp.textContent = '已取消框选';
        mapDraw();
        return;
      }
      if (_map.mode === 'move') {
        e.preventDefault();
        const rect = cv.getBoundingClientRect();
        const wx = mapToWorldX(e.clientX - rect.left), wy = mapToWorldY(e.clientY - rect.top);
        const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
        const hit = _map.sel || (m ? mapHitTest(wx, wy, m) : null);
        if (hit) { _map.sel = hit; mapDeleteSel(); }
      }
    });
    /* 窗口级监听只安装一次：画板重绘会重建 canvas，若随 mapWire 重复安装会叠加多份，
       导致一次 mouseup 触发多次 mapPersist，且旧闭包里的 canvas 已卸载 → 回调内实时取用。 */
    if (!_map._wireWin) { _map._wireWin = true; mapWireWindow(); }
  }
  function mapWireWindow() {
    window.addEventListener('mousemove', (e) => {
      const cv = mapCanvas(); if (!cv) return;
      const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
      if (_map.drag) {
        if (!m) return;
        /* 位移未越过阈值即视为单击（含双击改名时的像素抖动）：不改数据、不落盘 */
        if (!_map.drag.moved && !dragExceeded(_map.drag.sx, _map.drag.sy, e.clientX, e.clientY)) return;
        _map.drag.moved = true;
        const mk = (m.markers || []).find(x => x.id === _map.drag.id);
        if (mk) {
          const rect = cv.getBoundingClientRect();
          mk.x = mClamp1(mapToWorldX(e.clientX - rect.left) / m.imgW - _map.drag.ox / m.imgW) * m.imgW;
          mk.y = mClamp1(mapToWorldY(e.clientY - rect.top) / m.imgH - _map.drag.oy / m.imgH) * m.imgH;
          mapDraw(); paintStatus('已移动 ' + (mk.label || ''));
        }
      } else if (_map.pan) {
        _map.tx = _map.pan.tx + (e.clientX - _map.pan.sx);
        _map.ty = _map.pan.ty + (e.clientY - _map.pan.sy);
        mapDraw();
      } else if (_map.ellipse) {
        const rect = cv.getBoundingClientRect();
        _map.ellipse.curX = mapToWorldX(e.clientX - rect.left);
        _map.ellipse.curY = mapToWorldY(e.clientY - rect.top);
        mapDraw();
      } else if (_map.paint && m) {
        const rect = cv.getBoundingClientRect();
        const nx = mapToWorldX(e.clientX - rect.left), ny = mapToWorldY(e.clientY - rect.top);
        const last = _map.paint.pts[_map.paint.pts.length - 1];
        /* 采样去抖：位移过小不记点，避免一笔写进成百上千个点 */
        if (dragExceeded(last[0], last[1], nx, ny, 1.5)) {
          _map.paint.pts.push([nx, ny]);
          m.fog = m.fog || [];
          /* 每笔起手新建一块迷雾：原实现直接改写 m.fog[长度-1]，会覆盖掉最后一块已有迷雾 */
          if (_map.paint.idx < 0) { m.fog.push({ path: [] }); _map.paint.idx = m.fog.length - 1; }
          m.fog[_map.paint.idx] = { path: _map.paint.pts.map(p => [mClamp1(p[0] / m.imgW), mClamp1(p[1] / m.imgH)]) };
          _map.paint.dirty = true;
          mapDraw();
        }
      } else if (_map.mode === 'move' && !_map.sel) {
        const rect = cv.getBoundingClientRect();
        const wx = Math.round(mapToWorldX(e.clientX - rect.left)), wy = Math.round(mapToWorldY(e.clientY - rect.top));
        const key = wx + ',' + wy;
        if (key !== _map.lastHover) {
          _map.lastHover = key;
          const gs = (m && m.grid && m.grid.on && m.grid.size) || 0;
          paintStatus('坐标 ' + wx + ', ' + wy + (gs ? ' ｜ 格 ' + Math.floor(wx / gs) + ',' + Math.floor(wy / gs) : ''));
        }
      }
    });
    window.addEventListener('mouseup', () => {
      if (_map.ellipse) { mapFinishEllipse(); }
      /* 只有真正改动过数据才落盘：单纯点击标记/拖拽视图不再产生无意义的保存与审计记录 */
      else if ((_map.drag && _map.drag.moved) || (_map.paint && _map.paint.dirty)) mapPersist();
      _map.paint = null; _map.drag = null; _map.pan = null;
      if (_map.mode === 'region' && _map.regionPts) { const rp = q('mapRegionTip'); if (rp) rp.textContent = (_map.regionPts.length ? '已点 ' + _map.regionPts.length + ' 个顶点 · 双击完成，右键/Esc 取消' : ''); }
    });
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        if (_map.mode === 'region' && _map.regionPts) {
          _map.regionPts = null;
          const rp = q('mapRegionTip'); if (rp) rp.textContent = '已取消框选';
        }
        if (_map.mode === 'measure' && _map.measurePts) {
          _map.measurePts = null;
          const rp = q('mapRegionTip'); if (rp) rp.textContent = '';
          paintStatus('已清除测量');
        }
        if (_map.sel) { _map.sel = null; paintStatus('已取消选中'); }
        mapDraw();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && _map.sel && _map.mode === 'move') {
        e.preventDefault();
        mapDeleteSel();
      }
    });
  }
  function addMarkerAt(wx, wy) {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    const type = MAP_TYPES.some(t => t[0] === _map.curType) ? _map.curType : 'plot';
    const mk = { id: 'mk-' + uid(), type: type, label: mapTypeInfo(type)[1], note: '', x: Math.round(mClamp1(wx / m.imgW) * m.imgW), y: Math.round(mClamp1(wy / m.imgH) * m.imgH) };
    m.markers.push(mk);
    mapEditMarker(mk, true);
  }
  /* 标记弹窗编辑：双击标记或放置新标记时打开，可改名称/类型/备注或删除 */
  function mapEditMarker(mk, isNew) {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    if (!m.markers.some(x => x.id === mk.id)) return;
    _map.editMk = mk.id;
    /* 新增标记是“先入列再确认”：点取消/直接关窗必须回滚，否则会留下幽灵标记并被后续持久化 */
    _modalCancel = isNew ? () => {
      _map.editMk = null;
      const mm = S.mapOpenId ? mapFind(S.mapOpenId) : null;
      if (mm) { mm.markers = mm.markers.filter(x => x.id !== mk.id); mapDraw(); }
    } : null;
    const typeOpts = MAP_TYPES.map(([v, l]) => `<option value="${v}" ${mk.type === v ? 'selected' : ''}>${l}</option>`).join('');
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>${isNew ? '放置标记' : '编辑标记'}</h3><div class="formgrid">
      <div class="row full"><label>名称</label><input id="mapMkName" value="${esc(mk.label || '')}" placeholder="如 石棺 / 酒馆门 / 巢穴入口…"></div>
      <div class="row full"><label>类型</label><select id="mapMkType">${typeOpts}</select></div>
      <div class="row full"><label>备注</label><textarea id="mapMkNote" class="autoarea" rows="3" placeholder="该处发生了什么 / 埋伏了什么 / 通往哪里…">${esc(mk.note || '')}</textarea></div>
      <div class="row full"><label>位置</label><div class="hint" style="padding:2px 0">x ${mk.x} · y ${mk.y}（拖动标记可微调位置）</div></div>
    </div><div class="foot">
      ${isNew ? '' : '<button class="danger" onclick="WB.mapDelMarker()">删除</button>'}
      <span class="grow"></span>
      <button class="ghost" onclick="WB.closeModal()">取消</button>
      <button onclick="WB.mapSaveMarker()">保存</button>
    </div>`;
    mask.hidden = false;
    setTimeout(() => { const el = q('mapMkName'); if (el) el.focus(); }, 30);
  }
  function mapSaveMarker() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    const mk = m.markers.find(x => x.id === _map.editMk); if (!mk) return;
    const name = String((q('mapMkName') && q('mapMkName').value) || '').trim();
    if (name) mk.label = name;
    const ty = (q('mapMkType') && q('mapMkType').value) || 'plot';
    mk.type = MAP_TYPES.some(t => t[0] === ty) ? ty : 'plot';
    mk.note = String((q('mapMkNote') && q('mapMkNote').value) || '').trim();
    _map.editMk = null; _modalCancel = null;
    closeModal();
    mapPersist(); mapDraw();
    toast('已保存标记「' + (mk.label || '') + '」', 'ok');
  }
  async function mapDelMarker() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    const mk = m.markers.find(x => x.id === _map.editMk); if (!mk) return;
    if (!(await appConfirm('删除标记', '删除标记「' + (mk.label || '') + '」？'))) return;
    m.markers = m.markers.filter(x => x.id !== mk.id);
    _map.editMk = null; _modalCancel = null;
    closeModal();
    mapPersist(); mapDraw();
    toast('已删除标记', 'ok');
  }
  function mapToggleGrid() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    m.grid.on = !m.grid.on;
    const b = q('mapGridBtn'); if (b) b.textContent = '网格' + (m.grid.on ? ' ✓' : '');
    mapPersist(); mapDraw();
  }
  function mapMode(mode) {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
    _map.mode = mode;
    _map.ellipse = null; _map.sel = null;
    document.querySelectorAll('.map-tools .mt').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    if (mode === 'marker') {
      const mapKeys = { '怪': 'mob', '怪物': 'mob', 'mob': 'mob', 'npc': 'npc', 'NPC': 'npc', '剧': 'plot', '剧情点': 'plot', 'plot': 'plot', '门': 'exit', '入口': 'exit', 'exit': 'exit', '区': 'area', '区域': 'area', 'area': 'area' };
      appPrompt({ title: '选择标记类型', label: '输入下列任一：\n怪/怪物/mob → 怪物\nnpc → NPC\n剧/剧情点/plot → 剧情点\n门/入口/exit → 入口/出口\n区/区域/area → 区域块', placeholder: '怪 / npc / 剧 / 门 / 区', cancelText: '取消（默认剧情点）', okText: '确定' }, (raw) => {
        _map.curType = mapKeys[String(raw || '').trim()] || 'plot';
      });
    }
    if (mode !== 'region') { _map.regionPts = null; }
    const rp = q('mapRegionTip');
    if (mode === 'region') { _map.regionPts = _map.regionPts || []; if (rp) rp.textContent = '逐点点击添加顶点，双击画布完成（右键 / Esc 取消）'; }
    else if (mode === 'regell') { if (rp) rp.textContent = '在画布上按住拖拽画出椭圆区域，松手完成'; }
    else if (mode === 'fogell') { if (rp) rp.textContent = '在画布上按住拖拽画出椭圆迷雾，松手完成'; }
    else if (mode === 'measure') { _map.measurePts = _map.measurePts || []; updateMeasureStatus(m); }
    else if (rp) rp.textContent = '';
    mapDraw();
  }
  /* 手动设置网格格距（像素），不开 AI 也能自行对齐布置 */
  function mapGridSize() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    appPrompt({ title: '网格格距', label: '输入网格格距（像素，如 32 / 48 / 64），须为不小于 8 的整数', value: String((m.grid && m.grid.size) || 64), inputType: 'number', okText: '应用' }, (v) => {
      if (v == null) return;
      const n = Math.round(Number(String(v).trim()));
      if (!isFinite(n) || n < 8) { toast('格距需为不小于 8 的整数', 'err'); return; }
      m.grid.size = n; m.grid.on = true;
      mapPersist(); mapDraw();
      paintStatus('网格格距 ' + n + 'px');
      const b = q('mapGridBtn'); if (b) b.textContent = '网格 ✓';
      const sb = q('mapGridSizeBtn'); if (sb) sb.textContent = '格距 ' + n + 'px';
    });
  }
  /* 完成手动框选：把当前草稿存为区域块 */
  function mapFinishRegion() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    /* 双击完成前浏览器会先派发两轮 mousedown，会在同一处追加重复顶点并生成退化区域，
       这里去掉相邻重合点（容差约 3px @1600 宽底图） */
    const raw = _map.regionPts || [];
    const pts = raw.filter((p, i) => {
      if (!i) return true;
      const pr = raw[i - 1];
      return Math.abs(p[0] - pr[0]) > 0.002 || Math.abs(p[1] - pr[1]) > 0.002;
    });
    if (pts.length < 3) { toast('区域至少需要 3 个顶点', 'err'); return; }
    appPrompt({ title: '区域名称', label: '给该区域命名（可留空，自动编号）', placeholder: '区域' + ((m.regions || []).length + 1), okText: '保存区域' }, (v) => {
      const nm = String(v == null ? '' : v).trim() || ('区域' + ((m.regions || []).length + 1));
      m.regions = m.regions || [];
      m.regions.push({ points: pts.slice(), label: nm });
      _map.regionPts = null;
      const rp = q('mapRegionTip'); if (rp) rp.textContent = '已保存区域「' + nm + '」';
      mapPersist(); mapDraw();
      toast('已保存区域「' + nm + '」', 'ok');
    });
  }
  /* 完成椭圆拖拽：松手时按当前模式落成椭圆区域或椭圆迷雾 */
  function mapFinishEllipse() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
    if (!m || !_map.ellipse) return;
    const e = _map.ellipse;
    const cx = (e.sx + e.curX) / 2, cy = (e.sy + e.curY) / 2;
    const rx = Math.abs(e.curX - e.sx) / 2, ry = Math.abs(e.curY - e.sy) / 2;
    _map.ellipse = null;
    if (rx < 4 || ry < 4) { paintStatus('椭圆太小，已取消'); mapDraw(); return; }
    if (_map.mode === 'fogell') {
      m.fog = m.fog || [];
      m.fog.push({ ellipse: { cx: mClamp1(cx / m.imgW), cy: mClamp1(cy / m.imgH), rx: mClamp1(rx / m.imgW), ry: mClamp1(ry / m.imgH) } });
      mapPersist(); mapDraw();
      paintStatus('已添加椭圆迷雾');
      toast('已添加椭圆迷雾', 'ok');
    } else if (_map.mode === 'regell') {
      appPrompt({ title: '区域名称', label: '给该区域命名（可留空，自动编号）', placeholder: '区域' + ((m.regions || []).length + 1), okText: '保存区域' }, (v) => {
        const nm = String(v == null ? '' : v).trim() || ('区域' + ((m.regions || []).length + 1));
        m.regions = m.regions || [];
        m.regions.push({ ellipse: { cx: mClamp1(cx / m.imgW), cy: mClamp1(cy / m.imgH), rx: mClamp1(rx / m.imgW), ry: mClamp1(ry / m.imgH) }, label: nm });
        mapPersist(); mapDraw();
        paintStatus('已保存区域「' + nm + '」');
        toast('已保存区域「' + nm + '」', 'ok');
      });
    }
  }
  /* 网格测量辅助：两点距离 + 格数换算，写入提示条 */
  function updateMeasureStatus(m) {
    const pts = _map.measurePts || [];
    const rp = q('mapRegionTip');
    if (!pts.length) { if (rp) rp.textContent = '测量：点击画布取起点（再点取终点）· 第三点重新测量 · Esc 清除'; return; }
    if (pts.length === 1) { if (rp) rp.textContent = '起点 (' + pts[0][0] + ', ' + pts[0][1] + ') · 再点取终点'; return; }
    const a = pts[0], b = pts[1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.round(Math.hypot(dx, dy));
    const gs = (m && m.grid && m.grid.size) || 0;
    let txt = 'Δx ' + dx + ' · Δy ' + dy + ' · 直线 ' + L + 'px';
    if (gs > 0) {
      const gdx = Math.round(dx / gs), gdy = Math.round(dy / gs);
      txt += ' ｜ 格 ' + gdx + '×' + gdy + '（斜线 ≈ ' + (L / gs).toFixed(1) + ' 格）';
    }
    if (rp) rp.textContent = txt;
    paintStatus('测量完成 · 第三点重新测量 · Esc 清除');
  }
  /* 删除选中的区域/迷雾（支持右键或 Del 触发） */
  async function mapDeleteSel() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
    if (!m || !_map.sel) { closeModal(); return; }
    const sel = _map.sel;
    if (sel.k === 'reg') {
      const r = m.regions && m.regions[sel.i];
      if (!r) { _map.sel = null; closeModal(); return; }
      if (!(await appConfirm('删除区域', '删除区域「' + (r.label || '区域') + '」？'))) return;
      m.regions.splice(sel.i, 1);
    } else {
      if (!(await appConfirm('删除迷雾', '删除这块迷雾？'))) return;
      m.fog.splice(sel.i, 1);
    }
    _map.sel = null;
    closeModal();
    mapPersist(); mapDraw();
    paintStatus('');
    toast('已删除', 'ok');
  }
  /* 选中区域改名（双击区域触发） */
  function mapRenameRegion() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
    if (!m || !_map.sel || _map.sel.k !== 'reg') return;
    const r = m.regions[_map.sel.i];
    if (!r) return;
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>编辑区域</h3><div class="formgrid">
      <div class="row full"><label>名称</label><input id="mapRegName" value="${esc(r.label || '')}" placeholder="区域名称"></div>
      <div class="row full"><label>形状</label><div class="hint">${r.ellipse ? '椭圆' : '多边形'}</div></div>
    </div><div class="foot">
      <button class="danger" onclick="WB.mapDeleteSel()">删除</button>
      <span class="grow"></span>
      <button class="ghost" onclick="WB.closeModal()">取消</button>
      <button onclick="WB.mapSaveRegionName()">保存</button>
    </div>`;
    mask.hidden = false;
    setTimeout(() => { const el = q('mapRegName'); if (el) el.focus(); }, 30);
  }
  function mapSaveRegionName() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
    if (!m || !_map.sel || _map.sel.k !== 'reg') { closeModal(); return; }
    const r = m.regions[_map.sel.i];
    if (r) {
      const name = String((q('mapRegName') && q('mapRegName').value) || '').trim();
      if (name) r.label = name;
    }
    closeModal();
    mapPersist(); mapDraw();
    toast('已保存区域名称', 'ok');
  }
  /* 确保底图已解码：底图是运行时缓存字段，若用户打开画板后立刻导出，_imgNative 可能还没就绪，
     直接画会导出一张没有底图的空图，故导出前先等待解码完成 */
  function ensureBaseImage(m) {
    if (m._imgNative || !m.img) return Promise.resolve();
    return new Promise(res => {
      const img = new Image();
      img.onload = () => { m._imgNative = img; m._imgLoaded = true; res(); };
      img.onerror = () => res();
      img.src = m.img;
    });
  }
  /* 导出当前地图为 PNG：离屏按原图分辨率重绘全部图层后走保存对话框落盘 */
  async function mapExportImg() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
    if (!m) return;
    try {
      await ensureBaseImage(m);
      const W = m.imgW || 1600, H = m.imgH || 1200;
      const MAX = 8192;
      let sc = 1;
      if (W > MAX || H > MAX) sc = Math.min(MAX / W, MAX / H);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(W * sc));
      cv.height = Math.max(1, Math.round(H * sc));
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#14161a'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.save();
      ctx.scale(sc, sc);
      drawMapLayers(ctx, m, sc);
      ctx.restore();
      const url = cv.toDataURL('image/png');
      const base = String(m.name || '地图').replace(/[\\/:*?"<>|]/g, '_');
      toast('正在导出…');
      window.api.saveImage(base + '.png', url).then(r => {
        if (r && r.ok) toast('已导出地图图片：' + (r.path || ''), 'ok');
        else if (r && r.canceled) toast('已取消导出');
        else toast('导出失败：' + ((r && r.error) || '未知错误'), 'err');
      });
    } catch (err) {
      toast('导出失败：' + String((err && err.message) || err), 'err');
    }
  }
  /* 适应视口的纯数学部分（便于回归测试：要求底图投影中心 === 画布中心） */
  function mapFitTransform(W, H, imgW, imgH) {
    const k = 0.9;
    return { k, tx: (W - imgW * k) / 2, ty: (H - imgH * k) / 2 };
  }
  function mapFit() {
    const cv = mapCanvas(); if (!cv) return;
    const W = cv.clientWidth, H = cv.clientHeight;
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    const t = mapFitTransform(W, H, m.imgW, m.imgH);
    _map.k = t.k; _map.tx = t.tx; _map.ty = t.ty;
    mapDraw();
    paintStatus(m.name);
  }
  function mapUpload(ev) {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        m.img = rd.result; m.imgW = img.naturalWidth; m.imgH = img.naturalHeight; m.imgKind = 'uploaded';
        m.regions = m.regions || []; m.fog = m.fog || [];
        m._imgNative = img; m._imgLoaded = true;
        mapPersist(); mapFit();
        toast('已导入底图（' + img.naturalWidth + '×' + img.naturalHeight + '）', 'ok');
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
    ev.target.value = '';
  }

  /* ========== 地图 · AI 设计 ========== */
  function mapTemplate() {
    const m = mkMap('AI 设计地图');
    mapsData().unshift(m); mapPersist();
    S.mapOpenId = m.id; S.view = 'mapsboard';
    document.querySelectorAll('#sidebar .nav').forEach(n => n.classList.toggle('active', n.dataset.view === 'maps'));
    renderMapBoard(m);
    mapAi();
  }
  function mapAiText() { const ta = q('mapAiText'); return ta ? ta.value : ''; }
  function mapAi() {
    /* 打开时若既没草稿也没缓存，自动从“已导入团本/原始文本”取一段填充，
       让「⚡ 生成」按钮一打开就能用，不用手动再点「取用导入团本」。 */
    if (!S.mapAiTextCache) {
      const src = mapBestAiSource();
      if (src) S.mapAiTextCache = src;
    }
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>AI 设计地图</h3>
      <div class="note" style="margin-bottom:6px">填写场景描述，或用下方按钮取用「侧栏聊天」或「已导入团本」作素材。AI 会解出网格、标记、区域与迷雾草案；确认后才应用到画板，可反复重新生成。</div>
      <textarea id="mapAiText" class="autoarea" rows="4" placeholder="例：地下墓穴三层，入口在东侧，正中有石棺，西侧有食尸鬼巢穴，北边密道通到Boss房间……">${esc((S.mapAiTextCache || ''))}</textarea>
      <div class="toolbar" style="margin-top:8px">
        <button id="mapAiGo" onclick="WB.mapAiRun()">⚡ 生成</button>
        <button class="ghost" onclick="WB.mapAiFillChat()" title="把侧栏最近对话整理为场景描述填入">取用侧栏聊天</button>
        <button class="ghost" onclick="WB.mapAiFillText()" title="取用已导入的团本/原始文本填入">取用导入团本</button>
        <span class="grow"></span>
        <button class="ghost" onclick="WB.closeModal()">取消</button>
      </div>
      <div id="mapAiOut" style="margin-top:10px"></div>`;
    mask.hidden = false;
    setTimeout(() => { const ta = q('mapAiText'); if (ta) autosize(ta); }, 40);
  }
  /* 地图 AI 的最佳文字素材：优先已导入的团本/原始文本，没有则回退侧栏聊天 */
  function mapBestAiSource() {
    const raw = S.importRaw ? (typeof S.importRaw === 'string' ? S.importRaw : (S.importRaw.raw || '')) : '';
    const src = String(raw || S.rawText || '').trim();
    if (src) return src.slice(-6000);
    return mapChatTranscript();
  }
  function mapAiFillText() {
    const cache = S.importRaw ? (typeof S.importRaw === 'string' ? S.importRaw : (S.importRaw.raw || '')) : '';
    const cache2 = cache || S.rawText || '';
    if (!cache2) { toast('暂无可取用的导入文本，请直接粘贴文字', 'err'); return; }
    const ta = q('mapAiText'); if (ta) { ta.value = String(cache2).slice(-6000); S.mapAiTextCache = ta.value; }
    toast('已填入已导入的团本/原始文本', 'ok');
  }
  /* 把侧栏对话整理为场景文本（供地图 AI 取用）：优先当前 CH，否则回退到已持久化的 S.settings.chat */
  function mapChatTranscript(limit) {
    const src = CH.length ? CH : (Array.isArray(S.settings && S.settings.chat) ? S.settings.chat : []);
    if (!src.length) return '';
    const recent = src.slice(-(limit || 12));
    const lines = [];
    for (const m of recent) {
      const who = m && m.role === 'assistant' ? 'AI' : '主持人';
      const c = String((m && m.content) || '').replace(/\s+/g, ' ').trim();
      if (c) lines.push(who + '：' + c);
    }
    return lines.join('\n').slice(-12000);
  }
  function mapAiFillChat() {
    const t = mapChatTranscript();
    if (!t) { toast('侧栏暂无会话内容，请先在侧栏对话几句再取用', 'err'); return; }
    const ta = q('mapAiText'); if (ta) { ta.value = t; S.mapAiTextCache = t; }
    toast('已填入侧栏最近对话（可在框内继续编辑）', 'ok');
  }
  async function mapAiRun() {
    const text = mapAiText();
    if (!text || !text.trim()) { toast('请先填写文字描述', 'err'); return; }
    S.mapAiTextCache = text;
    const btn = q('mapAiGo'); if (btn) btn.disabled = true;
    const out = q('mapAiOut');
    try {
      const curM = S.mapOpenId ? mapFind(S.mapOpenId) : { imgW: 1280, imgH: 800 };
      const r = await window.api.aiGenBoard({ text, baseW: curM.imgW, baseH: curM.imgH });
      if (!r || !r.ok) { toast((r && r.error) || 'AI 生成失败', 'err'); return; }
      const b = r.board || {};
      S.mapAiDraft = b;
      const m = curM;
      const summary = ['网格 ' + (b.grid && b.grid.size) + 'px', '标记 ' + (b.markers || []).length + ' 个', '区域 ' + (b.regions || []).length + ' 片', '迷雾 ' + (b.fog || []).length + ' 块'].join(' · ');
      out.innerHTML = `<div class="note">AI 建议：${esc(summary)}${b.note ? '<div class="hint" style="margin-top:2px">💡 ' + esc(b.note) + '</div>' : ''}</div>
        <div class="toolbar" style="margin-top:8px">
          <button onclick="WB.mapAiApply()">✓ 采纳此版</button>
          <button class="ghost" onclick="WB.mapAiRun()">↻ 重新生成</button>
        </div>
        <div class="map-ai-preview" id="mapAiPvWrap"></div>`;
      const cfg = { size: (b.grid && b.grid.size) || 48 };
      setTimeout(() => { paintMapPreview(cfg, b); }, 40);
    } catch (e) {
      toast('AI 设计失败：' + ((e && e.message) || e), 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  function paintMapPreview(cfg, b) {
    const wrap = q('mapAiPvWrap'); if (!wrap) return;
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : { imgW: 640, imgH: 400 };
    const W = 640, H = Math.max(200, Math.round(400 * (m.imgH / m.imgW)));
    wrap.innerHTML = `<canvas id="mapPv" width="${W}" height="${H}" style="width:100%;height:auto;display:block;"></canvas>`;
    const cv = q('mapPv'); if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
    const s = Math.min(W / m.imgW, H / m.imgH);
    const ox = (W - m.imgW * s) / 2, oy = (H - m.imgH * s) / 2;
    drawMapPreviewCtx(ctx, b, m, s, ox, oy);
  }
  function drawMapPreviewCtx(ctx, b, m, s, ox, oy) {
    ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s);
    // 底图
    if (m.img && m._imgNative) { try { ctx.drawImage(m._imgNative, 0, 0, m.imgW, m.imgH); } catch (_) {} ctx.fillStyle = 'rgba(17,17,17,0.35)'; ctx.fillRect(0, 0, m.imgW, m.imgH); }
    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    const size = (b.grid && b.grid.size) || 48;
    for (let x = 0; x <= m.imgW; x += size) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, m.imgH); ctx.stroke(); }
    for (let y = 0; y <= m.imgH; y += size) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(m.imgW, y); ctx.stroke(); }
    // 区域
    for (const reg of (b.regions || [])) {
      const pts = (reg.points || []).map(p => [p[0] * m.imgW, p[1] * m.imgH]);
      ctx.beginPath();
      pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.closePath(); ctx.fillStyle = 'rgba(194,162,93,0.22)'; ctx.fill(); ctx.strokeStyle = 'rgba(194,162,93,0.85)'; ctx.stroke();
      if (reg.label) { ctx.fillStyle = 'rgba(194,162,93,0.95)'; ctx.font = '12px sans-serif'; ctx.fillText(reg.label, pts[0][0] + 4, pts[0][1] - 4); }
    }
    // 标记
    for (const mk of (b.markers || [])) {
      const t = mapTypeInfo(mk.type);
      ctx.beginPath(); ctx.arc(mk.x * m.imgW, mk.y * m.imgH, 10, 0, Math.PI * 2);
      ctx.fillStyle = t[2]; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(t[1].charAt(0), mk.x * m.imgW, mk.y * m.imgH + 4);
      ctx.textAlign = 'left';
    }
    // 迷雾
    ctx.fillStyle = 'rgba(10,10,20,0.6)';
    for (const f of (b.fog || [])) {
      const pts = (f.path || []).map(p => [p[0] * m.imgW, p[1] * m.imgH]);
      ctx.beginPath();
      pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function mapAiApply() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m || !S.mapAiDraft) return;
    aiLandBefore('AI 采纳地图要素'); // C2：提交前快照
    const b = S.mapAiDraft;
    m.grid = { on: true, size: (b.grid && b.grid.size) || m.grid.size };
    m.markers = (b.markers || []).map(k => ({
      id: 'mk-' + uid(), type: k.type, label: k.label, x: Math.round(k.x * m.imgW), y: Math.round(k.y * m.imgH)
    }));
    m.regions = (b.regions || []).map(r => ({ label: r.label, points: (r.points || []).map(p => [mClamp1(p[0]), mClamp1(p[1])]) }));
    m.fog = (b.fog || []).map(f => ({ path: (f.path || []).map(p => [mClamp1(p[0]), mClamp1(p[1])]) }));
    if (b.note) m.note = b.note;
    closeModal();
    mapPersist(); mapDraw();
    aiLandCommit(); // C2：地图采纳完成，登记落地记录
    toast('已采纳 AI 地图要素', 'ok');
  }

  /* ========== 骰子引擎 ========== */
  // parseNdz("2d6+3") -> {count:2,sides:6,mod:3}
  function parseNdz(expr) {
    const src = String(expr || '').replace(/\s+/g, '').toLowerCase();
    const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(src);
    if (!m) return null;
    return { count: m[1] ? Math.max(1, parseInt(m[1], 10)) : 1, sides: parseInt(m[2], 10), mod: m[3] ? parseInt(m[3], 10) : 0, raw: src };
  }
  /* M1：求值切到 dice-core 内核（preload 暴露 window.diceCore.roll/check/Rng）。
   * 求值不再用 Math.random（不可复现），改为「种子 + 过程明细」，投骰记录可精确复现。 */
  let diceSeedCounter = 0;
  function nextDiceSeed() { diceSeedCounter++; return 'renderer-' + Date.now().toString(36) + '-' + diceSeedCounter.toString(36); }
  // 兼容包装：把内核 rollExpr(ast, rng) 的 {total, detail} 展开成 UI 期望的 {ok,total,rolls,mod,count,sides,raw,seed,detail}
  function rollDice(expr) {
    try {
      const dc = window.diceCore;
      const parsed = parseNdz(expr);
      if (!parsed) return { ok: false, error: '表达式需形如 2d6 或 1d20+3（数量d面数±加减）' };
      if (parsed.sides < 2 || parsed.sides > 1000 || parsed.count > 100) return { ok: false, error: '面数 2~1000，单掷数 ≤100' };
      const seed = nextDiceSeed();
      const ast = dc.parseExpr(expr);
      const res = dc.roll(ast, dc.makeRng(seed));
      const grp = (res.detail || []).find(d => d.kind === 'dice') || {};
      const rolls = (grp.groups || []).reduce((a, g) => a.concat(g.rolled.map(d => d.v)), []);
      const total = res.total;
      return {
        ok: true, raw: parsed.raw, count: parsed.count, sides: parsed.sides, mod: parsed.mod,
        rolls, total, max: parsed.count * parsed.sides + parsed.mod, min: parsed.count + parsed.mod,
        seed, detail: res.detail
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e), rollErr: true };
    }
  }
  // CoC：d100 成功判定。等级 relative：<=1/5 极难, <=1/2 困难, <=值 普通, else 失败；大成功5%/大失败96%
  function cocJudge(expr, target) {
    const r = rollDice(expr || '1d100');
    if (!r.ok || r.rolls.length !== 1 || r.sides !== 100) return { ok: false, error: 'CoC 检定需为 1d100 百分骰' };
    const v = r.total;
    let grade = '失败';
    if (v === 1 || v <= Math.ceil(target * 0.05)) grade = '大成功';
    else if (v >= 96) grade = '大失败';
    else if (v <= Math.floor(target / 5)) grade = '极难成功';
    else if (v <= Math.floor(target / 2)) grade = '困难成功';
    else if (v <= target) grade = '普通成功';
    return Object.assign({ ok: true, grade, v, target, kind: 'coc', rolls: r.rolls, total: v }, { seed: r.seed, detail: r.detail });
  }
  // DnD5e：d20 + 属性调整值，支持 adv(优势)dis(劣势)。tot>=DC 成功
  function dndJudge({ mod = 0, dc = 10, adv = 0 }) {
    // M1：求值走内核（rollDice 经 window.diceCore），按 adv 选骰式；分档文案保留原逻辑
    const expr = adv > 0 ? '2d20kh1' : adv < 0 ? '2d20kl1' : '1d20';
    const r = rollDice(expr);
    if (!r.ok) return r;
    const pool = r.rolls;
    const raw = pool[0];
    const v = r.total + mod;
    const pass = v >= dc;
    let grade = pass ? '成功' : '失败';
    if (adv === 0 && raw === 20) grade = '自然 20 · 大成功';
    else if (adv === 0 && raw === 1) grade = '自然 1 · 大失败';
    return Object.assign({ ok: true, grade, v, dc, mod, adv, pool, pass, kind: 'dnd' }, { expr, seed: r.seed, detail: r.detail });
  }
  function diceLogAdd(entry) {
    if (!S.settings.diceLog) S.settings.diceLog = [];
    S.settings.diceLog.unshift(Object.assign({ t: new Date().toISOString(), id: uid() }, entry));
    S.settings.diceLog = S.settings.diceLog.slice(0, 500);
    /* 投骰即记：若正在进行一场遭遇，将本次投掷并入其流水（遭遇模块，见 encRecordRoll） */
    if (typeof encRecordRoll === 'function') encRecordRoll(entry);
    persist();
  }

  /* ========== 骰娘鉴定视图 ========== */
  /* 骰娘投骰面板（供 本地掷骰视图 与 骰娘板块共用）：含 规则库/自定义投掷/CoC·DnD 检定/
   * AI 定向判定/人物卡 Excel/独立 AI 端口/最近记录。交互统一走 bindDice 的常驻事件委托。 */
  function diceBoardHTML(title) {
    const sel = S.settings.dice || {};
    const rule = sel.rule || 'coc';
    const aiCap = !!((S.settings.ai || {}).apiKey);
    const aiPort = sel.aiPort || {};
    const aiReady = (sel.ai !== false && aiCap) || (!!aiPort.enabled && !!aiPort.base);
    const aiOn = sel.ai !== false && aiCap;
    const hist = (S.settings.diceLog || []).slice(0, 12);
    let html = title || '';
    html += `<div class="dicepanel">`;
    // 规则切换（事件绑定见 bindDice，保证首次点击即生效）
    html += `<div class="toolbar"><b>规则库</b>
      <button class="dice-rule${rule === 'plain' ? '' : ' ghost'}" data-rule="plain">通用</button>
      <button class="dice-rule${rule === 'coc' ? '' : ' ghost'}" data-rule="coc">CoC 7th</button>
      <button class="dice-rule${rule === 'dnd' ? '' : ' ghost'}" data-rule="dnd">DnD 5e</button>
      <span class="grow"></span>
      <label class="ai-toggle"><input type="checkbox" id="diceAi" ${aiOn ? 'checked' : ''}> AI 判定</label></div>`;

    // 通用/自定义投掷区：任意规则下都可自定义输入并投掷，常见骰子点击即掷
    html += `<div class="dicebox"><div class="dsec">🎲 常用骰 · 自定义投掷</div>
      <div class="row"><label>自定义投掷（NdM±X，如 2d6、1d20+3、1d100、3d6+2）</label>
      <input id="diceExpr" value="${esc(sel.expr || '1d20')}" placeholder="NdM±X" style="font-family:monospace;font-size:15px"></div>
      <div class="toolbar"><button id="diceRollBtn">⚀ 投掷</button>
        <button class="ghost dicequick" data-die="1d4">d4</button>
        <button class="ghost dicequick" data-die="1d6">d6</button>
        <button class="ghost dicequick" data-die="1d8">d8</button>
        <button class="ghost dicequick" data-die="1d10">d10</button>
        <button class="ghost dicequick" data-die="1d12">d12</button>
        <button class="ghost dicequick" data-die="1d20">d20</button>
        <button class="ghost dicequick" data-die="1d100">d100</button>
        <span class="grow"></span><span class="hint">常见骰子点击即掷</span></div></div>`;

    // 规则定向检定
    if (rule === 'coc') {
      html += `<div class="dicebox"><div class="dsec">🎯 CoC 7th 检定</div>
        <div class="row" style="display:flex;gap:12px"><div style="flex:1"><label>技能/属性值（目标值 1-99）</label>
        <input id="diceCocTarget" type="number" min="1" max="99" value="${sel.cocTarget || 50}"></div>
        <div style="flex:1"><label>检定骰</label><input id="diceCocRoll" value="${esc(sel.cocRoll || '1d100')}"></div></div>
        <div class="toolbar"><button id="cocJudgeBtn">🎯 CoC 检定</button><span class="hint">1 大成功 · ≤1/5 极难 · ≤1/2 困难 · ≤目标普通 · ≥96 大失败</span></div></div>`;
    } else if (rule === 'dnd') {
      html += `<div class="dicebox"><div class="dsec">🎯 DnD 5e 检定</div>
        <div class="row" style="display:flex;gap:12px">
        <div style="flex:1"><label>属性调整值（mod，可为负）</label><input id="diceDndMod" type="number" value="${sel.dndMod != null ? sel.dndMod : 0}"></div>
        <div style="flex:1"><label>难度等级 DC</label><input id="diceDndDc" type="number" value="${sel.dndDc || 10}"></div>
        <div style="flex:1"><label>优势/劣势</label><select id="diceDndAdv"><option value="0" ${!sel.dndAdv ? 'selected' : ''}>普通</option><option value="1" ${sel.dndAdv === 1 ? 'selected' : ''}>优势</option><option value="-1" ${sel.dndAdv === -1 ? 'selected' : ''}>劣势</option></select></div></div>
        <div class="toolbar"><button id="dndJudgeBtn">🎯 DnD 检定</button><span class="hint">d20+mod ≥ DC；自然 20/1 大成功/大失败</span></div></div>`;
    }
    html += `</div>`;

    // 结果显示区
    html += `<div class="dsec" style="margin:14px 0 0">掷骰结果</div>
      <div id="diceOut" class="diceout">${S.settings.diceLast ? renderDiceResult(S.settings.diceLast) : '<div class="empty">投掷 / 检定结果将显示在这里</div>'}</div>`;

    // AI 定向判定 + 人物卡 Excel
    html += `<details class="diceai"><summary class="dsec" style="margin:0;cursor:pointer;list-style:none">🎭 AI 定向判定 <span class="hint" style="font-family:var(--font);font-weight:400;letter-spacing:0">可导入人物卡 Excel，可独立接本地 AI 端口</span></summary>
      <div class="airow"><label class="file-label"><input type="file" id="sheetFile" accept=".xlsx,.xls,.csv" hidden onchange="WB.readSheet(this)">
        <span class="ghost filebtn">📄 选择人物卡 Excel</span></label>
        <span id="sheetState" class="hint">${S.settings.sheetName ? '已加载：' + esc(S.settings.sheetName) : '未加载人物卡'}</span>
        <span class="grow"></span><button class="ghost" onclick="WB.sheetUsage()">字段说明</button></div>
      <div id="sheetPreview" class="sheetprev">${S.settings.sheetRow ? esc(S.settings.sheetRow) : ''}</div>
      <div class="airow"><label>本次要判定的事项（动作目标，如“潜行躲过守卫 / 对抗检定”）</label>
        <input id="diceTask" placeholder="例：守夜时用潜行溜过卫兵 / 使用力量推开石门" value="${esc(sel.task || '')}"></div>
      <div class="airow"><label>可选：人物卡匹配关键字（留空则让 AI 选）</label>
        <input id="diceChar" placeholder="例：李凡 / 默认人物" value="${esc(sel.char || '')}"></div>
      <div class="toolbar"><button ${aiReady ? '' : 'disabled title="需在工作台「AI 配置」填 API Key，或启用下方「独立 AI 端口」"'} onclick="WB.aiJudge()">🤖 AI 定向判定</button>
        <button class="ghost" onclick="WB.aiJudgeExplain()">📋 解释判定</button><span class="hint">接 AI 后按人物卡属性算调整值并针对性投骰</span></div>
      <div id="aiJudgeOut" class="diceout"></div>

      <!-- 独立 AI 端口（骰娘专用）：优先使用，独立于工作台全局 AI -->
      <div class="airow ai-port" style="border-top:1px dashed var(--line);padding-top:10px;margin-top:6px">
        <b>🤖 独立 AI 端口（骰娘专用）</b><span class="grow"></span>
        <label class="ai-toggle"><input type="checkbox" id="diceAiPortOn" ${aiPort.enabled ? 'checked' : ''} onchange="WB.diceAiPortSave()"> 启用</label></div>
      <div class="airow"><label>接口地址（OpenAI 兼容，本地如 Ollama http://127.0.0.1:11434/v1）</label>
        <input id="diceAiPortBase" placeholder="http://127.0.0.1:11434/v1" value="${esc(aiPort.base || '')}" style="font-family:monospace"></div>
      <div class="airow ai2"><label>API Key（本地可留空）</label>
        <input id="diceAiPortKey" type="password" value="${esc(aiPort.key || '')}">
        <label>模型名</label><input id="diceAiPortModel" value="${esc(aiPort.model || '')}" placeholder="模型名，" style="width:180px"></div>
      <div class="toolbar"><button class="ghost" onclick="WB.diceAiPortSave()">💾 保存端口</button>
        <button class="ghost" onclick="WB.diceAITest()">🔍 测试连接</button>
        <span id="diceAiPortState" class="hint">${aiPort.enabled && aiPort.base ? '已启用独立端口' : '未启用，AI 判定走工作台全局 AI'}</span></div>
    </details>`;

    // 历史
    html += `<div class="dicehist"><h3>最近记录</h3><div id="diceHistList">${hist.length ? hist.map(diceHistRow).join('') : '<div class="empty">暂无投掷记录</div>'}</div></div>`;
    return html;
  }

  function renderDice() {
    contentInner(diceBoardHTML(`<div class="page-title"><h2>骰娘鉴定</h2>
      <span class="hint">离线通用投掷 · 规则检定 · 可接 AI 或人物卡 Excel 定向判定</span></div>`));
    bindDice();
  }
  /* 当前所在视图刷新：在「骰娘板块」里操作时整体刷回骰娘板块(含引擎卡)，否则刷本地掷骰视图 */
  function diceViewRefresh() { if (S.view === 'dicehost') renderDiceHost(); else renderDice(); }

  /* 骰子交互统一采用「常驻容器事件委托」：只在首次进入骰娘视图时在 #content 上挂一次监听，
   * 之后由事件冒泡按目标 id/类名分发。避免了反复进出骰娘页对新建节点做逐元素重复查找与重复绑定。 */
  let _diceDeleg = false;
  function bindDice() {
    if (_diceDeleg) return; // #content 常驻，委托监听只挂一次
    _diceDeleg = true;
    const cont = q('content');
    cont.addEventListener('click', (e) => {
      const t = e.target; if (!t) return;
      const r = (t.closest && t.closest('.dice-rule')); if (r) { setDiceRule(r.dataset.rule); return; }
      const qk = (t.closest && t.closest('.dicequick')); if (qk) { rollQuick(qk.dataset.die); return; }
      const id = t.id || (t.closest && t.closest('[id]') && t.closest('[id]').id) || '';
      if (id === 'diceRollBtn') rollExpr();
      else if (id === 'cocJudgeBtn') cocJudgeBtn();
      else if (id === 'dndJudgeBtn') dndJudgeBtn();
    });
    cont.addEventListener('change', (e) => { if (e.target && e.target.id === 'diceAi') setDiceAi(e.target.checked); });
    cont.addEventListener('keydown', (e) => {
      const t = e.target; if (!t || !t.id) return;
      if (t.id === 'diceExpr' && e.key === 'Enter') { e.preventDefault(); rollExpr(); }
      else if ((t.id === 'diceCocTarget' || t.id === 'diceCocRoll') && e.key === 'Enter') { e.preventDefault(); cocJudgeBtn(); }
    });
  }
  function diceHistRow(e) {
    const t = new Date(e.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return `<div class="drow"><span class="dt">${t}</span><span class="dexpr">${esc(e.expr || '')}</span>
      <span class="dres">${esc(e.summary || '')}</span>${e.grade ? `<span class="dgrade ${gradeCls(e.grade)}">${esc(e.grade)}</span>` : ''}<span class="grow"></span>
      <button class="ghost small rmrow" onclick="WB.delDiceLog('${e.id}')">✕</button></div>`;
  }
  function gradeCls(g) {
    return (g && String(g).indexOf('大成功') !== -1) ? 'gok' : (g && String(g).indexOf('成功') !== -1) ? 'gwin' : ((g && String(g).indexOf('失败') !== -1) ? 'gfail' : '');
  }
  function renderDiceResult(r) {
    if (!r) return '';
    let m = `<div class="dreshead"><b>${esc(r.title || '结果')}</b><span class="grow"></span><span class="dexpr">${esc(r.expr || '')}</span></div>`;
    m += `<div class="drestotal">${esc(r.totalView || r.total || 0)}</div>`;
    if (r.rolls) m += `<div class="drolls">点数：${r.rolls.map(v => `<span class="dr">${v}</span>`).join('')}${r.mod ? ` <span class="hint">mod ${r.mod > 0 ? '+' : ''}${r.mod}</span>` : ''}</div>`;
    if (r.grade) m += `<div class="dgrade big ${gradeCls(r.grade)}">${esc(r.grade)}</div>`;
    if (r.note) m += `<div class="dnote">${esc(r.note)}</div>`;
    return m;
  }

  /* ========== 骰娘 · 连 QQ（引擎托管） ========== */
  const _diceHost = { refreshing: false, timer: null, status: null, lastEvent: 0, mode: null, conns: null, qrImg: '', qrTip: '', qrConnId: null, qrHintAt: 0, plugins: [], wizard: { step: 'input' }, wizardDraftId: null, wizardToken: null };
  const DH_STATE = {
    stopped: ['stopped', '已停止', 'dim'],
    starting: ['starting', '启动中…', 'run'],
    running: ['running', '运行中', 'ok'],
    error: ['error', '异常', 'fail']
  };
  function dhState() {
    const st = (_diceHost.status && _diceHost.status.state) || 'stopped';
    return DH_STATE[st] || DH_STATE.stopped;
  }
  function dhClock(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function dhGlobalNow() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  async function dhRefresh(silent) {
    if (_diceHost.refreshing) return;
    _diceHost.refreshing = true;
    try {
      if (!window.api || !window.api.diceCore) return;
      const st = await window.api.diceCore.engine.status();
      _diceHost.status = st;
      dhLivePaint();
    } catch (_) { _diceHost.lastEvent = Date.now(); dhLivePaint(); }
    finally { _diceHost.refreshing = false; }
  }
  /* 仅更新引擎状态徽标，不整体重绘正文 */
  function dhLivePaint() {
    const chip = q('dhStateChip');
    if (chip) {
      const [k, label, cls] = dhState();
      chip.className = 'dh-chip ' + cls;
      chip.innerHTML = `<i class="dh-dot ${cls}"></i>${esc(label)}`;
    }
  }
  function dhStartPoll() {
    if (_diceHost.timer) return;
    _diceHost.timer = setInterval(() => { if (S.view === 'dicehost' && window.api && window.api.diceCore) dhRefresh(true); }, 4000);
  }
  function renderDiceHost() {
    dhStartPoll();
    if (!_diceHost._sub) {
      _diceHost._sub = true;
      try {
        if (window.api && window.api.diceCore) {
          window.api.diceCore.onEngineEvent((v) => { _diceHost.lastEvent = Date.now(); dhRefresh(true); });
          window.api.diceCore.onWorkspaceChanged((v) => { toast('骰娘已改写工作台数据（' + (v && v.action || '') + '），已同步', 'ok'); });
        }
      } catch (_) {}
    }
    const api = !!(window.api && window.api.diceCore);
    let html = `<div class="page-title"><h2>骰娘</h2>
      <span class="hint">内嵌骰娘内核 ＋ 本地投骰 / AI 定向判定 / 人物卡 / 插件工坊，全功能一体</span></div>`;
    if (!api) {
      html += `<div class="setcard"><div class="empty">当前环境未暴露骰娘接口（请通过桌面版打开本页面）。</div></div>`;
      contentInner(html); return;
    }
    const st = _diceHost.status || {};

    html += `<div class="dhgrid">`;

    /* 左：内核状态（M3：内核内嵌、随应用自动启动，无独立托管进程） */
    html += `<div class="dh-card dh-main">
      <div class="dh-head"><b>🧠 骰娘内核</b><span class="grow"></span>
        <span class="dh-chip ${dhState()[2]}" id="dhStateChip"><i class="dh-dot ${dhState()[2]}"></i>${esc(dhState()[1])}</span></div>
      <div class="dh-row"><span class="lbl">引擎</span><span class="val">dice-core（内置 · 随应用运行）</span></div>
      <div class="dh-row"><span class="lbl">插件</span><span class="val">${st.plugins != null ? st.plugins + ' 个启用' : '—'}</span></div>
      <div class="dh-row"><span class="lbl">版本</span><span class="val">${esc(st.version || '—')}</span></div>
      ${st.error ? `<div class="dh-err">⚠ ${esc(st.error)}</div>` : ''}
      <div class="dh-note">M3 起骰娘内核<b>内嵌于应用</b>，随应用自动运行、无独立托管进程，不再需要单独定位内核目录或启动引擎。下方「本地投骰 / AI / 人物卡」与「分区 5 插件工坊 / AI 生成向导」即为全部功能。</div>
    </div>`;

    /* 右：本地掷骰端到端状态 */
    html += `<div class="dh-card">
      <div class="dh-head"><b>🎲 本地投骰 / AI / 人物卡</b><span class="grow"></span><span class="hint">下方面板即为全部功能</span></div>
      <div class="dh-row"><span class="lbl">规则库</span><span class="val">${esc((S.settings.dice && S.settings.dice.rule) || 'coc')}</span></div>
      <div class="dh-row"><span class="lbl">AI 判定</span><span class="val">${diceAiCapable() ? '可用' : '未配置（AI 配置或独立 AI 端口）'}</span></div>
      <div class="dh-row"><span class="lbl">人物卡</span><span class="val">${S.settings.sheetName ? '已加载：' + esc(S.settings.sheetName) : '未加载'}</span></div>
      <div class="dh-row"><span class="lbl">累计投掷</span><span class="val">${(S.settings.diceLog || []).length} 次</span></div>
      <div class="dh-ctrl">
        <button class="ghost" onclick="WB.diceAiPortSave()">🤖 独立 AI 端口</button>
        <button class="ghost" onclick="WB.diceClearLog()" title="清空最近记录">🔄 清空记录</button>
      </div>
    </div></div>`;

    /* 完整掷骰面板（本地功能全套） */
    html += `<div class="dh-board">${diceBoardHTML('')}</div>`;

    /* 说明 */
    html += `<div class="dh-card" style="margin-top:14px"><ol class="dh-help">
      <li>「骰娘」板块分为<b>内嵌内核</b>与<b>本地投骰</b>两半：规则库（通用/CoC 7th/DnD 5e）、自定义与快捷投掷、定向检定、AI 定向判定、人物卡 Excel、独立 AI 端口、历史记录。</li>
      <li>独立 AI 端口：在下方「AI 定向判定 - 独立 AI 端口」配置一个 OpenAI 兼容端点（如本地 Ollama），启用后 AI 判定<b>独立走此端口</b>，不依赖工作台全局 AI。</li>
      <li>群内 <code>.kp</code> 指令读写工作台数据、<code>.ai</code> 指令定向判定均由内嵌内核处理，界面实时刷新。全部本地功能<b>完全离线可玩</b>。</li>
    </ol></div>`;

    contentInner(html);
    bindDice();
    dhLivePaint();
    dhRefresh(true); // 首次进入立即拉取一次真实状态
  }
  function diceAiCapable() {
    const p = (S.settings.dice && S.settings.dice.aiPort) || {};
    const g = !!(S.settings.ai || {}).apiKey;
    return (S.settings.dice && S.settings.dice.ai !== false && g) || (!!p.enabled && !!p.base);
  }

  /* ========== 统计报表（主页区块） ========== */
  function statsReportHTML() {
    const ents = S.data.entities;
    const log = S.settings.diceLog || [];
    let html = `<div class="dash-stats block"><div class="block-title">统计报表 <span class="hint">资料规模 · 投骰概况 · 活动痕迹</span></div>`;
    // 资料卡总数
    html += `<div class="statcards">${KINDS.map(k => {
      const arr = ents[k] || [];
      const n = arr.length;
      return `<div class="statcard" style="background:color-mix(in srgb,var(--accent) ${Math.min(30, 14 + n * 4)}%,var(--card))"><div class="stn">${n}</div><div class="stl">${DATA_TYPE[k]}</div></div>`;
    }).join('')}</div>`;
    // 总对象
    const total = KINDS.reduce((s, k) => s + (ents[k] || []).length, 0);
    html += `<div class="statline">资料对象总数 <b>${total}</b> · 最近 30 天操作 <b>${(S.data.audit || []).filter(a => Date.now() - new Date(a.t).getTime() < 30 * 86400000).length}</b> 次</div>`;
    // 投骰统计
    if (log.length) {
      const success = log.filter(x => String(x.grade || '').indexOf('成功') !== -1).length;
      const crit = log.filter(x => String(x.grade || '').indexOf('大成功') !== -1).length;
      const fail = log.filter(x => String(x.grade || '').indexOf('失败') !== -1 || String(x.grade || '') === '失败').length;
      const ruleCount = {};
      log.forEach(x => { ruleCount[x.rule || 'plain'] = (ruleCount[x.rule || 'plain'] || 0) + 1; });
      html += `<div class="statcards">
        <div class="statcard"><div class="stn" style="color:var(--accent2)">${log.length}</div><div class="stl">总投骰次数</div></div>
        <div class="statcard"><div class="stn" style="color:var(--ok)">${success}</div><div class="stl">成功</div></div>
        <div class="statcard"><div class="stn" style="color:var(--warn)">${crit}</div><div class="stl">大成功</div></div>
        <div class="statcard"><div class="stn" style="color:var(--danger)">${fail}</div><div class="stl">失败</div></div>
      </div>`;
      html += `<div class="statline">按规则：` + Object.entries(ruleCount).map(([k, v]) => `${k} ${v} 次`).join(' · ') + `</div>`;
      const top = {};
      log.slice(0, 200).forEach(x => { const k = x.expr || 'x'; top[k] = (top[k] || 0) + 1; });
      const top3 = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 3);
      html += `<div class="statline">高频投法：` + top3.map(([k, v]) => `<code>${esc(k)}</code>×${v}`).join(' · ') + `</div>`;
    } else {
      html += `<div class="empty">暂无投骰记录，去「骰娘鉴定」投一次吧。</div>`;
    }
    // 各实体最新活动
    html += `<div class="statline"><h3>最近操作</h3></div><div class="recentaudit">${(S.data.audit || []).slice(0, 10).map(a =>
      `<div class="rrow">${esc(a.op)} · <b>${esc(a.name)}</b> <span class="hint">${new Date(a.t).toLocaleString('zh-CN')}</span></div>`).join('') || '<div class="empty">暂无记录</div>'}</div></div>`;
    return html;
  }

  /* ---------- 骰娘交互 ---------- */
  function diceOpt(name, fallback) { if (!S.settings.dice) S.settings.dice = {}; const v = S.settings.dice[name]; return (v === undefined || v === null) ? fallback : v; }
  function saveRule() {
    const rule = S.settings.dice && S.settings.dice.rule;
    if (rule === 'plain') { S.settings.dice.expr = val('diceExpr') || '1d20'; }
    else if (rule === 'coc') {
      S.settings.dice.cocTarget = parseInt(val('diceCocTarget'), 10) || 50;
      S.settings.dice.cocRoll = val('diceCocRoll') || '1d100';
    } else if (rule === 'dnd') {
      S.settings.dice.dndMod = parseInt(val('diceDndMod'), 10) || 0;
      S.settings.dice.dndDc = parseInt(val('diceDndDc'), 10) || 10;
      S.settings.dice.dndAdv = parseInt(val('diceDndAdv'), 10) || 0;
    }
    S.settings.dice.task = val('diceTask');
    S.settings.dice.char = val('diceChar');
    persist();
  }
  function showDiceResultM(obj, title, opts) {
    if (!obj.ok) { toast(obj.error || '掷骰失败', 'err'); q('diceOut').innerHTML = `<div class="dnote err">${esc(obj.error)}</div>`; return null; }
    const r = Object.assign({ title, expr: obj.raw || obj.expr || '' }, opts || {}, {
      totalView: obj.total != null ? obj.total : obj.v, rolls: obj.rolls || obj.pool, mod: obj.mod,
      grade: obj.grade, note: obj.note
    });
    S.settings.diceLast = r;
    const doEl = q('diceOut'); if (doEl) doEl.innerHTML = renderDiceResult(r);
    return r;
  }
  function rollExpr() {
    const expr = val('diceExpr') || diceOpt('expr', '1d20');
    S.settings.dice.expr = expr;
    const r = rollDice(expr);
    const shown = showDiceResultM(r, '通用投掷', { totalView: r.total, mod: r.mod, rolls: r.rolls });
    if (shown) { diceLogAdd({ expr, total: r.total, rolls: r.rolls, seed: r.seed, detail: r.detail, summary: `${r.count}d${r.sides}` + (r.mod ? (r.mod > 0 ? '+' + r.mod : r.mod) : '') + ' = ' + r.total, rule: 'plain' }); }
    persist();
    diceViewRefresh(); // 整体刷新：结果与最近记录同步更新，任何一次点击都有明确可见效果
  }
  function rollQuick(expr) {
    const r = rollDice(expr);
    const shown = showDiceResultM(r, '快捷投掷 ' + expr, { totalView: r.total, mod: r.mod, rolls: r.rolls });
    if (shown) diceLogAdd({ expr, total: r.total, rolls: r.rolls, seed: r.seed, detail: r.detail, summary: expr + ' = ' + r.total, rule: 'plain' });
    persist();
    diceViewRefresh();
  }
  function cocJudgeBtn() {
    saveRule();
    const target = parseInt(val('diceCocTarget'), 10) || 50;
    const exp = val('diceCocRoll') || '1d100';
    const r = cocJudge(exp, target);
    if (!r.ok) { q('diceOut').innerHTML = `<div class="dnote err">${esc(r.error)}</div>`; return; }
    const shown = showDiceResultM(r, 'CoC 检定', { totalView: `${r.v} / ${r.target}`, rolls: r.rolls, mod: 0, grade: r.grade });
    if (shown) diceLogAdd({ expr: exp, total: r.v, seed: r.seed, detail: r.detail, summary: `CoC 目标 ${r.target} 掷出 ${r.v}`, grade: r.grade, rule: 'coc' });
    persist();
    diceViewRefresh();
  }
  function dndJudgeBtn() {
    saveRule();
    const mod = parseInt(val('diceDndMod'), 10) || 0;
    const dc = parseInt(val('diceDndDc'), 10) || 10;
    const adv = parseInt(val('diceDndAdv'), 10) || 0;
    const r = dndJudge({ mod, dc, adv });
    const shown = showDiceResultM(r, 'DnD 检定', { totalView: `${r.pool[0]}${adv ? (adv > 0 ? ' 优势→' + Math.max(...r.pool) : ' 劣势→' + Math.min(...r.pool)) : ''} ${mod >= 0 ? '+' + mod : mod} → ${r.v} / DC ${r.dc}`, pool: r.pool, mod, grade: r.grade });
    if (shown) diceLogAdd({ expr: '1d20' + (adv ? (adv > 0 ? 'A' : 'D') : '') + (mod ? (mod > 0 ? '+' + mod : mod) : ''), total: r.v, seed: r.seed, detail: r.detail, summary: `DnD 检定 v=${r.v} DC=${r.dc}`, grade: r.grade, rule: 'dnd' });
    persist();
    diceViewRefresh();
  }
  function setDiceRule(rule) {
    if (!S.settings.dice) S.settings.dice = {};
    S.settings.dice.rule = rule;
    persist();
    diceViewRefresh();
  }
  function setDiceAi(on) {
    if (!S.settings.dice) S.settings.dice = {};
    S.settings.dice.ai = !!on;
    persist();
  }
  function delDiceLog(id) {
    if (!S.settings.diceLog) return;
    S.settings.diceLog = S.settings.diceLog.filter(x => x.id !== id);
    persist();
    diceViewRefresh();
  }
  function diceClearLog() {
    S.settings.diceLog = [];
    persist();
    toast('已清空投骰记录', 'ok');
    diceViewRefresh();
  }

  /* ---------- 人物卡 Excel 与 AI 定向判定 ---------- */
  let sheetData = null;   // [{name, headers:[], cols:{header:value}} , ...]
  function readSheet(input) {
    const f = input && input.files && input.files[0];
    if (!f) return;
    const list = [];
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const buf = new Uint8Array(reader.result);
        const res = await window.api.readSheet(buf);
        if (!res || !res.ok) { toast((res && res.error) || '解析失败', 'err'); return; }
        sheetData = res.rows || [];
        S.settings.sheetName = f.name;
        S.settings.sheetRow = (sheetData.length ? JSON.stringify(sheetData[0].cols || {}, null, 0) : '表格无有效行');
        S.settings.sheetCount = sheetData.length;
        S.settings.sheetHeaders = res.headers || [];
        persist();
        const st = q('sheetState'); if (st) st.textContent = '已加载：' + f.name + ' · ' + sheetData.length + ' 行';
        const pv = q('sheetPreview'); if (pv) pv.innerHTML = (sheetData[0] ? Object.entries(sheetData[0].cols).slice(0, 8).map(([k, v]) => `<span class="cell"><b>${esc(k)}</b>${esc(v)}</span>`).join('') : '');
      } catch (e) { toast('读取失败：' + e.message, 'err'); }
    };
    reader.readAsArrayBuffer(f);
  }
  function sheetUsage() {
    const box = q('modalBox');
    box.innerHTML = `<h3>人物卡 Excel 字段说明</h3><div style="font-size:13px;line-height:1.7">
      <p>支持 .xlsx / .xls / .csv，把表格第一行作为列名（表头），每行视为一张人物卡。</p>
      <p>建议包含字段（中英文均可，AI 会自行识别）：<code>人物名称/角色名/姓名</code>、<code>力量/STR</code>、<code>敏捷/DEX</code>、<code>体质/CON</code>、<code>智力/INT</code>、<code>感知/WIS</code>、<code>魅力/CHA</code>，以及各技能值（如<a>潜行/侦查/说服</a>）。</p>
      <p>CoC 常用技能/属性值通常按 0-99 填写；DnD 属性按 10-20 并自动换算调整值。</p>
      <p>加载后，在“AI 定向判定”填写要判定的事项与人物关键字，点 AI 定向判定即可按人物卡针对性投骰。判定也可完全不依赖 Excel（AI 自行判断技能）。</p></div>
      <div class="foot"><button class="ghost" onclick="WB.closeModal()">关闭</button></div>`;
    box.hidden = false;
  }
  function pickSheetChar(keyword) {
    if (!sheetData || !sheetData.length) return null;
    const kw = String(keyword || '').trim().toLowerCase();
    if (!kw) return sheetData[0];
    const fn = (v) => String(v || '').toLowerCase().indexOf(kw) !== -1;
    return sheetData.find(r => Object.values(r.cols).some(fn)) || sheetData.find(r => fn(r.name)) || sheetData[0];
  }
  function sheetPrompt(kind, task, charKW) {
    const char = pickSheetChar(charKW);
    let lines = `[系统制定者请按人物卡进行 TRPG 定向判定]\n判定规则库：${kind === 'coc' ? 'CoC 7th（属性/技能值 0-99，1d100 掷骰，≤值普通成功、≤1/2困难、≤1/5极难、1大成功、96+大失败）' : kind === 'dnd' ? 'DnD 5e（属性自动换算调整值 sn-10）/2；技能检定 d20+mod；对抗所有技能可用对应值；DC 由任务难度决定）' : '通用 TRPG（自行判断技能/属性与目标值）'}\n待判定事项：${task}`;
    if (char) {
      lines += `\n[人物卡：${char.name}]\n` + Object.entries(char.cols).map(([k, v]) => `${k}=${v}`).join('；');
      if (charKW) lines += `\n（已指定匹配关键字：${charKW}）`;
    } else {
      lines += `\n（未加载人物卡，请依据通用规则直接给出应采用的能力与目标值/DC）`;
    }
    lines += `\n[要求]\n1. 分析该事项最应使用哪项技能/属性；
2. 说明理由；
3. 给出该项在人物卡上的数值（如有），否则给出合理默认值；
4. 给出目标值（CoC：0-99 技能值）或 DC（DnD：建议难度），以及是否优势/劣势；
5. 用简洁中文作答，直接给结论，不要输出多余格式。`;
    return lines;
  }
  function parseJudgePayload(text) {
    const s = String(text || '');
    const out = { skill: '', target: null, dc: null, adv: 0, reason: '', note: '' };
    const tt = (s.match(/目标(?:值)?[:：]\s*(\d+)/) || [])[1];
    const dc = (s.match(/DC[:：]?\s*(\d+)/i) || [])[1];
    if (dc) out.dc = parseInt(dc, 10); else if (tt) out.target = parseInt(tt, 10);
    const adv = (s.match(/(优势)/) ? 1 : s.match(/(劣势)/) ? -1 : 0);
    out.adv = adv;
    const sk = (s.match(/技能[:：]?\s*([^\s，,。；;]+|[\u4e00-\u9fa5]{2,6})/) || [])[1];
    if (sk) out.skill = sk;
    out.reason = s.slice(0, 400);
    return out;
  }
  /* 骰娘独立 AI 端口：启用且已配置时走本地/独立端点（OpenAI 兼容），否则回退工作台全局 AI。
   * 返回纯文本回复。 */
  function readDiceAiPort() {
    if (!S.settings.dice) S.settings.dice = {};
    if (!S.settings.dice.aiPort) S.settings.dice.aiPort = {};
    return S.settings.dice.aiPort;
  }
  async function diceAiChat(messages) {
    const cfg = readDiceAiPort();
    if (cfg.enabled && cfg.base) {
      try {
        const rep = await window.api.diceCore.ai.chat({ base: cfg.base, key: cfg.key, model: cfg.model }, messages);
        if (rep && rep.ok && rep.reply) return rep.reply;
        if (rep && !rep.ok) toast('独立 AI 端口：' + (rep.error || '调用失败') + '，已回退全局 AI', '');
      } catch (_) {}
    }
    const r = await window.api.aiChat(messages);
    return r && (r.reply || r.text || r);
  }
  function diceAiPortSave() {
    const cfg = readDiceAiPort();
    const on = q('diceAiPortOn');
    cfg.enabled = on ? on.checked : !!cfg.enabled;
    cfg.base = val('diceAiPortBase');
    cfg.key = val('diceAiPortKey');
    cfg.model = val('diceAiPortModel');
    const st = q('diceAiPortState'); if (st) st.textContent = (cfg.enabled && cfg.base) ? '已启用独立端口' : '未启用，AI 判定走工作台全局 AI';
    persist();
    toast(cfg.enabled && cfg.base ? '已保存并启用独立 AI 端口' : '已保存 AI 端口（未启用）', 'ok');
  }
  async function diceAITest() {
    const cfg = readDiceAiPort();
    cfg.base = val('diceAiPortBase'); cfg.key = val('diceAiPortKey'); cfg.model = val('diceAiPortModel'); persist();
    if (!cfg.base) { toast('请先填写接口地址', 'err'); return; }
    const st = q('diceAiPortState'); if (st) { st.textContent = '测试中…'; }
    const rep = await window.api.diceCore.ai.chat({ base: cfg.base, key: cfg.key, model: cfg.model }, [{ role: 'user', content: '只回复两个字：成功' }]);
    if (st) st.textContent = rep && rep.ok ? ('连接成功 · ' + (rep.model || cfg.model || '模型')) : ('失败：' + ((rep && rep.error) || '无响应'));
    toast(rep && rep.ok ? '独立 AI 端口连接成功' : ('独立 AI 端口失败：' + ((rep && rep.error) || '无响应')), rep && rep.ok ? 'ok' : 'err');
  }

  async function aiJudge() {
    const kind = (S.settings.dice && S.settings.dice.rule) || 'coc';
    const task = (val('diceTask') || S.settings.dice.task || '').trim();
    if (!task) { toast('请填写要判定的事项', 'err'); return; }
    const outEl = q('aiJudgeOut');
    outEl.innerHTML = '<div class="hint">AI 分析中…</div>';
    try {
      const prompt = sheetPrompt(kind, task, val('diceChar'));
      const text = await diceAiChat([{ role: 'user', content: prompt }]);
      if (!text) { outEl.innerHTML = '<div class="dnote err">AI 无返回，请检查 AI 配置或独立 AI 端口</div>'; return; }
      const p = parseJudgePayload(typeof text === 'string' ? text : JSON.stringify(text));
      // 执行本地引擎投骰
      let result;
      if (kind === 'coc') {
        result = cocJudge('1d100', p.target || 50);
      } else if (kind === 'dnd') {
        const mod = p.dc != null ? (await aiGuessMod(p.skill)) : 0;
        result = dndJudge({ mod, dc: p.dc || 10, adv: p.adv });
      } else {
        result = rollDice('1d20');
      }
      const r = showDiceResultM(result, 'AI 定向判定 · ' + (p.skill || '技能检定'), {
        totalView: result.v != null ? result.v : result.total,
        grade: result.grade,
        note: (p.skill ? '采用技能：' + p.skill + '\n' : '') + (p.target != null ? '目标值：' + p.target + '\n' : '') + (p.dc != null ? 'DC：' + p.dc + '\n' : '') + (p.reason ? 'AI 依据：' + p.reason : '')
      });
      outEl.innerHTML = `<div class="aianswer"><div class="resx">${renderDiceResult(r)}</div><details><summary>AI 判定说明</summary><div class="ainote">${renderInline(text)}</div></details></div>`;
      if (r) diceLogAdd({ expr: kind === 'coc' ? '1d100' : '1d20', total: r.total != null ? r.total : r.total, summary: 'AI 判定：' + (p.skill || '技能') + ' ' + task, grade: r.grade, rule: kind, task });
      saveRule();
    } catch (e) { outEl.innerHTML = '<div class="dnote err">AI 判定失败：' + esc(e.message || e) + '</div>'; }
  }
  async function aiGuessMod(skill) {
    try {
      const pr = `仅根据技能名“${skill || ''}”对应的 DnD5e 属性调整值（-5 到 +10 的整数），只输出一个数字，不要任何文字。若不确定输出 0。`;
      const t = String((await diceAiChat([{ role: 'user', content: pr }])) || '').trim();
      const n = parseInt(t, 10);
      return isNaN(n) ? 0 : n;
    } catch (_) { return 0; }
  }
  async function aiJudgeExplain() {
    const outEl = q('aiJudgeOut');
    outEl.innerHTML = '<div class="hint">AI 解释中…</div>';
    try {
      const task = val('diceTask') || S.settings.dice.task || '';
      const kind = (S.settings.dice && S.settings.dice.rule) || 'coc';
      const pr = sheetPrompt(kind, task || '查看人物卡', val('diceChar')) + '\n请用自然语言详细解释如何判定该场景（技能/属性、目标值或 DC、是否加值），以及遭遇何种难度时如何处理，500 字以内。';
      const text = await diceAiChat([{ role: 'user', content: pr }]);
      outEl.innerHTML = `<div class="aianswer"><div class="ainote">${renderInline(typeof text === 'string' ? text : JSON.stringify(text || ''))}</div></div>`;
    } catch (e) { outEl.innerHTML = '<div class="dnote err">解释失败：' + esc(e.message || e) + '</div>'; }
  }

  /* ---------- 骰娘工作台界面（分区 2 连接中心 / 3 指令日志 / 4 文案 / 6 测试通道） ---------- */
  const _dw = { simMsgs: [], logPanel: null, replyPack: null, filter: '' };
  function dwApi() { return (window.api && window.api.diceCore) ? window.api.diceCore : null; }
  function dwNetCfg() {
    if (!S.settings.diceNet) S.settings.diceNet = { onebot11: { host: '127.0.0.1', port: 6700 }, qqofficial: {}, sim: {} };
    return S.settings.diceNet;
  }
  async function refreshConnCenter() {
    const CC = window.DiceUIConnCenter || {};
    const cfg = dwNetCfg();
    const el = document.getElementById('dice-conn-center'); if (!el) return;
    el.innerHTML = (CC.renderChannelWizard || (() => ''))(cfg);
    if (dwApi()) {
      try {
        const list = await dwApi().diceNet.list();
        for (const item of list || []) {
          const h = el.querySelector(`[data-channel="${item.id}"] h4`);
          if (h) h.insertAdjacentHTML('beforeend', ' ' + ((CC.renderStatusLight || (() => ''))(item.status)));
        }
      } catch (_) {}
    }
    // 输入框：实时写回配置并持久化。这是关键——否则用户填写后一重渲染就被清空，启动也读不到值（旧 bug：点启动内容消失 + 提示缺少 appId/clientSecret）。
    el.querySelectorAll('[data-channel]').forEach((card) => {
      const ch = card.getAttribute('data-channel');
      if (!cfg[ch]) cfg[ch] = {};
      card.querySelectorAll('input[data-field]').forEach((inp) => {
        const f = inp.getAttribute('data-field');
        inp.addEventListener('input', () => { cfg[ch][f] = inp.value; persist(); });
      });
    });
    el.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest('[data-channel]'); if (!card) return;
        const ch = card.getAttribute('data-channel');
        const act = btn.getAttribute('data-act');
        const api = dwApi();
        if (!api) { toast('当前环境未暴露骰娘接口', ''); return; }
        try {
          let patch;
          if (act === 'start' && cfg[ch]) {
            // 启动前把该卡当前输入收集进配置，并作为最新配置传给主进程（主进程据此合并后 start）
            card.querySelectorAll('input[data-field]').forEach((inp) => { cfg[ch][inp.getAttribute('data-field')] = inp.value; });
            patch = Object.assign({}, cfg[ch]);
            persist();
          }
          await (act === 'start' ? api.diceNet.start(ch, patch) : api.diceNet.stop(ch));
          toast((act === 'start' ? '已启动 ' : '已停止 ') + ch + ' 通道', 'ok');
        } catch (e) { toast('操作失败：' + ((e && e.message) || e), 'err'); }
        refreshConnCenter();
      };
    });
  }
  async function refreshCmdLog() {
    const api = dwApi(); if (!api) return;
    const CL = window.DiceUIConnLog || {};
    const root = document.getElementById('dice-cmd-log'); if (!root) return;
    if (!_dw.logPanel) _dw.logPanel = (CL.createLogPanel || (() => ({ load() { }, append() { }, rows: () => [] })))({ root });
    try {
      const list = (await api.log.query({ sessionId: _dw.filter || '', limit: 200 })) || [];
      _dw.logPanel.load(list);
      const sum = (CL.logSummary || ((l) => ({ total: l.length, sessions: 0 })))(list);
      const meta = document.getElementById('dwLogMeta'); if (meta) meta.textContent = `共 ${sum.total} 条 · ${sum.sessions} 个会话`;
    } catch (_) {}
  }
  async function refreshReplyEditor() {
    const api = dwApi();
    const RE = window.DiceUIReplyEditor || {};
    const el = document.getElementById('dice-reply-editor'); if (!el) return;
    if (!api) { el.innerHTML = '<div class="dice-empty">当前环境未暴露文案接口</div>'; return; }
    try {
      _dw.replyPack = (await api.reply.load()) || { persona: {}, templates: {} };
      el.innerHTML = `<div class="dice-reply-form">${((RE.buildForm || (() => ''))(_dw.replyPack))}</div>`;
    } catch (_) { el.innerHTML = '<div class="dice-empty">文案加载失败</div>'; }
  }
  function collectReplyPack() {
    const RE = window.DiceUIReplyEditor || {};
    const pack = _dw.replyPack || { persona: {}, templates: {} };
    const el = document.getElementById('dice-reply-editor'); if (!el) return pack;
    el.querySelectorAll('[data-field]').forEach((inp) => {
      const f = inp.getAttribute('data-field');
      try { _dw.replyPack = ((RE.applyEdit || ((p) => p))(pack, f, inp.value)); } catch (_) {}
    });
    return _dw.replyPack;
  }
  async function saveReply() {
    const api = dwApi(); if (!api) return;
    try {
      const pack = collectReplyPack();
      ((window.DiceUIReplyEditor || {}).validatePack || (() => true))(pack);
      await api.reply.save(pack);
      toast('文案已保存并即时生效（下一条测试指令即用新文案）', 'ok');
    } catch (e) { toast('保存失败：' + ((e && e.message) || e), 'err'); }
  }
  async function exportReply() {
    const api = dwApi(); if (!api) return;
    try {
      const pack = collectReplyPack();
      const text = `# 骰娘文案与人设导出\n\n## persona\n\n${JSON.stringify((pack && pack.persona) || {}, null, 2)}\n\n## templates\n\n${JSON.stringify((pack && pack.templates) || {}, null, 2)}\n\n## rules（CoC / DnD 投掷与检定回复）\n\n${JSON.stringify((pack && pack.rules) || {}, null, 2)}`;
      const r = await window.api.saveText('骰娘文案_' + new Date().toISOString().slice(0, 10) + '.md', text);
      toast(r !== false ? '文案已导出' : '已取消导出', r !== false ? 'ok' : '');
    } catch (e) { toast('导出失败：' + ((e && e.message) || e), 'err'); }
  }
  async function exportCmdLog() {
    const api = dwApi(); if (!api) return;
    try {
      const text = await api.log.export();
      const r = await window.api.saveText('骰娘指令记录_' + new Date().toISOString().slice(0, 10) + '.txt', text || '（暂无记录）');
      toast(r !== false ? '指令日志已导出' : '已取消导出', r !== false ? 'ok' : '');
    } catch (e) { toast('导出失败：' + ((e && e.message) || e), 'err'); }
  }
  function drawSimChat() {
    const SC = window.DiceUISimChat || {};
    const el = document.getElementById('dice-sim-chat'); if (!el) return;
    el.innerHTML = ((SC.buildTranscript || (() => ''))(_dw.simMsgs));
    el.scrollTop = el.scrollHeight;
  }
  function bindSimChat() {
    const api = dwApi();
    const input = document.getElementById('dice-sim-input');
    const send = document.getElementById('dice-sim-send');
    const SC = window.DiceUISimChat || {};
    const can = SC.canSend || (() => true);
    const doSend = async () => {
      if (!input || !can(input.value)) return;
      const text = String(input.value || '').trim();
      input.value = '';
      _dw.simMsgs.push({ who: 'user', text });
      drawSimChat();
      if (!api) { toast('当前环境未暴露测试通道', ''); return; }
      try {
        const reply = await api.sim.send({ text, userId: S.userId || 'sim-user', userName: S.userName || '模拟玩家' });
        _dw.simMsgs.push({ who: 'bot', text: String(reply || '').trim() || '（无回显）' });
      } catch (e) { _dw.simMsgs.push({ who: 'bot', text: '错误：' + ((e && e.message) || e) }); }
      drawSimChat();
      refreshCmdLog();
    };
    if (send) send.onclick = doSend;
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
  }
  function renderDiceWork() {
    const html = `<div class="page-title"><h2>骰娘工作台</h2>
      <span class="hint">连接中心 · 指令日志 · 文案与人设 · 插件工坊 · 测试通道，端到端指令联调主战场</span></div>
      <div class="dhgrid" style="grid-template-columns:1fr 1fr">
        <div class="dh-card"><div class="dh-head"><b>🔌 连接中心（分区 2）</b><span class="grow"></span><button class="ghost mini" id="dwRefreshNet">🔄 刷新</button></div>
          <div id="dice-conn-center" class="dice-conn-center"></div>
          <div class="dh-note">每个通道一张卡片：填好参数点「启动/停止」，状态灯实时反映运行/停止/重连。</div></div>
        <div class="dh-card"><div class="dh-head"><b>🧾 指令日志（分区 3）</b><span class="grow"></span><span id="dwLogMeta" class="hint">…</span>
          <button class="ghost mini" id="dwExportLog">⬇ 导出</button><button class="ghost mini" id="dwRefreshLog">🔄 刷新</button></div>
          <div id="dice-cmd-log" class="dice-cmd-log"></div>
          <div class="dh-note">与测试通道同源：下一条指令即在此记录，可筛选会话并导出为文本。</div></div>
      </div>
      <div class="dhgrid" style="grid-template-columns:1fr 1fr;margin-top:14px">
        <div class="dh-card"><div class="dh-head"><b>💬 文案与人设（分区 4）</b><span class="grow"></span>
          <button class="ghost mini" id="dwExportReply">⬇ 导出</button><button class="ghost mini" id="dwSaveReply">💾 保存</button></div>
          <div id="dice-reply-editor" class="dice-reply-editor"></div>
          <div class="dh-note">编辑人设名/风格/前缀、各指令文案，以及 CoC 7th / DnD 5e 两套基础规则的投掷与检定回复模板（留空即用出厂默认）。保存后即时生效，测试通道下一条指令即用新文案。</div></div>
        <div class="dh-card"><div class="dh-head"><b>🧩 插件工坊（分区 5）</b><span class="grow"></span><span id="dwPlgMeta" class="hint">…</span>
          <button class="ghost mini" id="dwRefreshPlg">🔄 刷新</button></div>
          <div id="dice-zone-workshop" class="dice-zone-workshop"></div>
          <div id="dice-zone-wizard" class="dice-zone-wizard" style="margin-top:10px"></div>
          <div class="dh-note">内置三套规则与用户插件统一管理：启停即时生效、编辑保存过校验器、回滚一键还原、导出分享。</div></div>
      </div>
      <div class="dh-card" style="margin-top:14px"><div class="dh-head"><b>🧪 测试通道聊天窗（分区 6）</b><span class="grow"></span></div>
        <div id="dice-sim-chat" class="dice-chat"></div>
        <div class="dice-chat-input"><input id="dice-sim-input" placeholder="输入指令，如 .jrrp / .sign / .drew / .r1d20 / .admin list"><button id="dice-sim-send">发送</button></div>
        <div class="dh-note">不经真实 QQ：在本应用内模拟玩家身份，构造消息进中枢，回显气泡并写入指令日志。</div></div>
      <div class="dh-card" style="margin-top:14px"><div class="dh-head"><b>🧠 K P 建议（批次5）</b><span class="grow"></span>
          <span id="dwKpAdviceState" class="hint">…</span>
          <button class="ghost mini" id="dwKpAdviceRun">💡 生成建议</button></div>
        <div class="dh-kpadvice">
          <div class="dh-note" style="margin-bottom:8px">依据骰娘正在跑的对局上下文（近期指令日志、出场角色 / NPC / 区域、当前人设），为 KP 生成推进建议。建议仅在此面板展示，绝不通过骰娘对外发送。若开关「KP 建议」关闭或总开关关闭，则不调用 AI、不消耗 token。</div>
          <textarea id="dwKpAdviceFocus" placeholder="（可选）本次最想解决的推进方向，留空则综合出招。如：玩家卡在搜证环节、如何引入新 NPC、boss战如何收尾…" class="dice-reply-editor textarea"></textarea>
          <div id="dwKpAdviceOut" class="dh-note" style="white-space:pre-wrap;margin-top:8px;min-height:120px">点「生成建议」后，这里会给出可执行的分点建议。</div>
        </div></div>
    `;
    const el = q('content'); el.innerHTML = html;
    _dw.simMsgs = []; _dw.logPanel = null;
    if (!dwApi()) { toast('当前环境未暴露骰娘工作台接口', 'err'); return; }
    refreshConnCenter();
    refreshCmdLog();
    refreshReplyEditor();
    dhRenderWorkshop();
    dhRenderWizard();
    drawSimChat();
    bindSimChat();
    const on = (id, cb) => { const b = document.getElementById(id); if (b) b.onclick = cb; };
    on('dwRefreshNet', refreshConnCenter);
    on('dwRefreshLog', refreshCmdLog);
    on('dwExportLog', exportCmdLog);
    on('dwSaveReply', saveReply);
    on('dwExportReply', exportReply);
    on('dwRefreshPlg', dhRenderWorkshop);
    on('dwKpAdviceRun', runKpAdvice);
    paintKpAdviceState();
  }

  /* ---------- 骰娘工作台：KP 建议（批次5） ---------- */
  async function paintKpAdviceState() {
    const st = q('dwKpAdviceState'); if (!st) return;
    const api = dwApi() && dwApi().kpAdvice;
    if (!api) { st.textContent = '接口未就绪'; st.style.color = '#d33'; return; }
    try {
      const on = await api.enabled();
      st.textContent = on ? '可调用（开关已放行）' : '已关闭（不调用 AI）';
      st.style.color = on ? 'var(--ok)' : 'var(--warn)';
    } catch (_) { st.textContent = '读取失败'; }
  }
  async function runKpAdvice() {
    const api = dwApi() && dwApi().kpAdvice;
    if (!api) { toast('KP 建议接口未就绪', 'err'); return; }
    const focus = q('dwKpAdviceFocus') ? q('dwKpAdviceFocus').value.trim() : '';
    const out = q('dwKpAdviceOut'); if (out) out.textContent = '正在生成建议…';
    const btn = q('dwKpAdviceRun'); if (btn) btn.disabled = true;
    try {
      const r = await api.suggest({ focus });
      if (out) out.textContent = (r && r.ok) ? r.text : ((r && r.text) || '生成失败，请检查 AI 配置/开关。');
    } catch (e) { if (out) out.textContent = '建议生成出错：' + ((e && e.message) || e); }
    finally { if (btn) btn.disabled = false; paintKpAdviceState(); }
  }

  /* ---------- 骰娘工作台：分区 5 插件工坊 ---------- */
  async function dhRenderWorkshop() {
    const box = q('dice-zone-workshop');
    if (!box) return;
    const api = window.api && window.api.diceCore && window.api.diceCore.plugins;
    if (!api) { box.innerHTML = '<div class="hint">插件工坊接口未就绪（diceCore.plugins）</div>'; return; }
    const r = await api.list();
    if (!r || !r.ok) { box.innerHTML = '<div class="hint">插件列表读取失败：' + ((r && r.error) || '未知') + '</div>'; return; }
    _diceHost.plugins = r.items;
    box.innerHTML = DiceUI.pluginListHTML(r.items);
    const meta = q('dwPlgMeta');
    if (meta) meta.textContent = '共 ' + r.items.length + ' 个 · ' + r.items.filter(x => x.enabled).length + ' 启用';
    bindWorkshop(box);
  }
  function bindWorkshop(box) {
    box.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = () => workshopAct(btn.dataset.act, btn.dataset.plg, btn);
    });
  }
  async function workshopAct(act, id, btn) {
    const api = window.api && window.api.diceCore && window.api.diceCore.plugins;
    if (!api) return;
    const box = q('dice-zone-workshop');
    if (!box) return;
    if (act === 'toggle') {
      const r = await api.toggle(id, !!btn.checked);
      if (!r || !r.ok) toast('启停失败：' + ((r && r.error) || '未知'), 'err');
      else toast(btn.checked ? '已启用「' + id + '」' : '已停用「' + id + '」', 'ok');
    } else if (act === 'edit') {
      const r = await api.get(id);
      if (r && r.ok) { box.innerHTML = DiceUI.pluginEditorHTML(r.pkg); bindWorkshop(box); return; }
      toast('读取插件失败：' + ((r && r.error) || '未知'), 'err');
    } else if (act === 'save-edit') {
      const ta = box.querySelector('.plg-editor-text');
      const r = await api.saveJson(id, ta ? ta.value : '');
      if (!r || !r.ok) {
        box.innerHTML = '<div class="plg-editor"><div class="plg-editor-bar">保存失败：' +
          ((r && (r.errors || [r.error])) || ['未知']).join('；') +
          '</div><button class="btn sm" data-act="cancel-edit" data-plg="' + esc(id) + '">返回列表</button></div>';
        bindWorkshop(box);
        return;
      }
      toast('已保存：' + r.id + '@' + r.version + '（旧版已备份，可回滚）', 'ok');
    } else if (act === 'rollback') {
      const cur = (_diceHost.plugins || []).find(p => p.id === id);
      const label = cur && DiceUI.pluginRollbackLabel(cur);
      if (!label) { dhRenderWorkshop(); return; }
      if (!(await appConfirm('回滚插件', label))) { dhRenderWorkshop(); return; }
      const r = await api.rollback(id);
      if (!r || !r.ok) toast('回滚失败：' + ((r && r.error) || '未知'), 'err');
      else toast('已回滚到上一版本', 'ok');
    } else if (act === 'export') {
      const r = await api.export(id);
      if (r && r.ok) { const s = await window.api.saveText(r.id + '.json', r.json); if (!s || !s.ok) toast('导出失败', 'err'); else toast('已导出 ' + r.id + '.json', 'ok'); }
      else toast('导出失败：' + ((r && r.error) || '未知'), 'err');
    }
    dhRenderWorkshop();
  }

  /* ---------- 骰娘工作台：分区 5 AI 生成向导 ---------- */
  function dhRenderWizard(st) {
    const box = q('dice-zone-wizard');
    if (!box) return;
    _diceHost.wizard = st || _diceHost.wizard || { step: 'input' };
    box.innerHTML = DiceUI.wizardViewHTML(_diceHost.wizard);
    box.querySelectorAll('[data-act]').forEach(btn => { btn.onclick = () => wizardAct(btn.dataset.act); });
  }
  async function wizardAct(act) {
    const api = window.api && window.api.diceCore && window.api.diceCore.wizard;
    if (!api) return;
    const w = _diceHost.wizard;
    if (act === 'wizard-start') {
      const ta = q('dice-zone-wizard').querySelector('.wz-rules');
      const text = ta ? ta.value.trim() : '';
      if (!text) return;
      dhRenderWizard({ step: 'generating' });
      const r = await api.start(text);
      if (r && r.ok) { _diceHost.wizardDraftId = r.draftId; _diceHost.wizardToken = r.token; dhRenderWizard({ step: 'generated', pkg: r.pkg }); }
      else { dhRenderWizard({ step: 'error', errors: (r && (r.errors || [r.error])) || ['未知错误'] }); }
    } else if (act === 'wizard-abort') {
      await api.abort(_diceHost.wizardToken);
      dhRenderWizard({ step: 'input' });
    } else if (act === 'wizard-trial') {
      const r = await api.trial(_diceHost.wizardDraftId);
      if (r && r.ok) dhRenderWizard({ step: 'trialed', pkg: w && w.pkg, results: r.results });
      else dhRenderWizard({ step: 'error', errors: [(r && r.error) || '试跑失败'] });
    } else if (act === 'wizard-install') {
      const r = await api.install(_diceHost.wizardDraftId);
      if (r && r.ok) { dhRenderWizard({ step: 'done', id: r.id, version: r.version }); }
      else dhRenderWizard({ step: 'error', errors: [(r && r.error) || '安装失败'] });
    } else if (act === 'wizard-discard') {
      await api.discard(_diceHost.wizardDraftId);
      _diceHost.wizardDraftId = null;
      dhRenderWizard({ step: 'input' });
    } else if (act === 'wizard-back') {
      dhRenderWizard({ step: 'input' });
    }
    if (act === 'wizard-install') dhRenderWorkshop();   // 安装后插件列表同步刷新
  }

  /* =============== 界面舒适度优化（2.8.0）：A1/A2/B1/B2 =============== */
  /* A1：工具栏「⋯ 更多」下拉开合 */
  function toggleMoreMenu() {
    if (!S.settings) S.settings = {};
    const m = q('tbMoreMenu'); if (!m) return;
    const open = m.hidden !== true;
    closeAllMenus();
    if (!open) m.hidden = false;
  }
  function closeAllMenus() {
    const mm = (S._moreEls || []);
    for (const el of mm) if (el) el.hidden = true;
    const tbm = q('tbMoreMenu'); if (tbm) tbm.hidden = true;
    const ctx = q('ctxMenu'); if (ctx) ctx.hidden = true;
  }

  /* A2：两档密度切换 */
  function setDensity(d) {
    if (!S.settings) S.settings = {};
    if (!S.settings.layout) S.settings.layout = {};
    S.settings.layout.density = (d === 'compact') ? 'compact' : 'comfortable';
    pushDensityAttr(S.settings.layout.density);
    persist();
    refreshAppearanceControls();
  }
  function toggleDensity() {
    if (!S.settings.layout) S.settings.layout = {};
    const next = (S.settings.layout.density === 'compact') ? 'comfortable' : 'compact';
    setDensity(next);
  }
  function pushDensityAttr(d) {
    document.documentElement.dataset.density = d || 'comfortable';
  }
  /* 就地刷新设置页「外观」面板的皮肤/密度按钮激活态（不整页重绘，保留未保存输入） */
  function refreshAppearanceControls() {
    if (S.view !== 'settings') return;
    const body = q('settingsBody'); if (!body) return;
    const theme = S.settings.theme || 'ember';
    const dens = (S.settings.layout && S.settings.layout.density) || 'comfortable';
    body.querySelectorAll('button[data-app="theme"]').forEach(b => b.classList.toggle('ghost', b.dataset.theme !== theme));
    body.querySelectorAll('button[data-app="dens"]').forEach(b => b.classList.toggle('ghost', (b.dataset.dens || 'comfortable') !== dens));
  }

  /* B2：纯函数——按自定义顺序重排 ids，过滤已删除项、顺序外项保持原序尾部 */
  function applyCustomOrder(list, order) {
    const keep = (list || []).slice();
    const ids = (order || []).filter(id => keep.some(it => it && it.id === id));
    const indexes = new Map(ids.map((id, i) => [id, i]));
    const inOrder = [], rest = [];
    for (const it of keep) {
      if (indexes.has(it.id)) inOrder[indexes.get(it.id)] = it; else rest.push(it);
    }
    const filled = inOrder.filter(Boolean);
    return filled.concat(rest);
  }

  /* B1：卡片右键菜单 */
  function openCtx(ev, kind, id) {
    if (!ev) return;
    ev.preventDefault(); ev.stopPropagation();
    closeAllMenus();
    let menu = q('ctxMenu');
    if (!menu) { menu = document.createElement('div'); menu.className = 'ctx-menu'; menu.id = 'ctxMenu'; menu.hidden = true; document.body.appendChild(menu); }
    const items = [];
    items.push({ t: '编辑', act: () => { closeAllMenus(); edit(kind, id); } });
    items.push({ t: '⧉ 复制', act: () => { closeAllMenus(); dupCard(kind, id); } });
    items.push(isFav(kind, id)
      ? { t: '☆ 取消收藏', act: () => { closeAllMenus(); toggleFav(kind, id); } }
      : { t: '★ 收藏', act: () => { closeAllMenus(); toggleFav(kind, id); } });
    items.push({ t: '🛡 一致性检查', act: () => { closeAllMenus(); consistencyOpen(); }, sep: true });
    items.push({ t: '删除', danger: true, act: () => { closeAllMenus(); del(kind, id); } });
    menu.innerHTML = items.map(it => (it.sep
      ? '<div class="mm-sep"></div>'
      : `<button class="${it.danger ? 'danger' : ''}" data-act="${esc(it.t)}">${esc(it.t)}</button>`)).join('');
    menu.hidden = false;
    const rw = menu.offsetWidth, rh = menu.offsetHeight;
    const x = Math.min(ev.clientX, window.innerWidth - rw - 8);
    const y = Math.min(ev.clientY, window.innerHeight - rh - 8);
    menu.style.left = Math.max(4, x) + 'px';
    menu.style.top = Math.max(4, y) + 'px';
    menu.onclick = (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!btn) return;
      const label = btn.dataset.act;
      const itm = items.find(i => i.t === label);
      if (itm && itm.act) itm.act();
    };
  }

  /* B2：卡片拖拽排序（custom 档）。核心同 bindDashDrag 的 Pointer Events 做法。 */
  function bindCardDrag() {
    /* 修复：q() 是 getElementById 的封装，原先这里传入的是类名选择器，等于按 id 去查一个类名，
     * 恒为 null 而直接 return，导致「自定义排序」下拖拽手柄完全没反应。改为按网格的真实 id 查询。 */
    const box = q('cardgrid'); if (!box || !box.children.length) return;
    let activeEl = null, startX = 0, startY = 0, dragging = false;
    const THRESH = 4;
    const insertionIndex = (e) => {
      let idx = 0;
      for (const c of box.children) {
        if (c === activeEl) continue;
        const r = c.getBoundingClientRect();
        const midX = r.left + r.width / 2, midY = r.top + r.height / 2;
        const past = Math.abs(e.clientY - midY) < r.height * 0.6 ? e.clientX > midX : e.clientY > midY;
        if (!past) break;
        idx++;
      }
      return idx;
    };
    const onMove = (e) => {
      if (!activeEl) return;
      const dx = Math.abs(e.clientX - startX), dy = Math.abs(e.clientY - startY);
      if (!dragging) {
        if (dx < THRESH && dy < THRESH) return;
        dragging = true;
        activeEl.classList.add('drag-placing');
      }
      const idx = insertionIndex(e);
      const cur = [].indexOf.call(box.children, activeEl);
      if (idx !== cur) { box.insertBefore(activeEl, box.children[idx] || null); }
    };
    const endDrag = (e) => {
      if (!activeEl) return;
      activeEl.classList.remove('drag-placing');
      if (dragging) {
        const kind = activeEl.dataset.kind;
        const order = [].map.call(box.children, c => c.dataset.id);
        if (kind && order.length) setCustomOrder(kind, order);
      }
      activeEl = null; dragging = false;
    };
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const t = e.target && e.target.closest ? e.target.closest('.card.dragsortable') : null;
      if (!t || !box.contains(t)) return;
      /* 卡片内的交互控件（收藏星标 .fav-btn、交叉引用徽标 .xref-badge、多选框、编辑/删除等
       * 按钮、输入类控件）不参与拖拽。否则按下即 preventDefault，会干扰这些控件的点击与聚焦。 */
      if (e.target.closest && e.target.closest('button,input,select,textarea,a,label,.fav-btn,.xref-badge,.sort-handle')) return;
      activeEl = t; startX = e.clientX; startY = e.clientY; dragging = false;
      /* 关键修复：捕获指针。否则指针一旦移出网格范围，pointermove/pointerup 不再派发，
       * 拖拽会中途失灵、松手也不落盘（看板拖拽与关系网拖拽均已有这一步）。 */
      try { box.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);
  }
  function setCustomOrder(kind, ids) {
    if (!S.dvCustom) S.dvCustom = {};
    S.dvCustom[kind] = ids;
    persist();
  }

  /* 全局点击/Esc 关闭所有菜单 */
  document.addEventListener('click', (e) => {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('.more-anchor')) return;
    if (e.target.closest('.ctx-menu')) return;
    closeAllMenus();
  });
  document.addEventListener('contextmenu', (e) => {
    if (e.target && e.target.closest && e.target.closest('.card')) return; // 卡片走 openCtx
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllMenus(); });

  /* 合并而非整对象替换：保证此前已通过「window.WB.xxx =」挂载的运行时方法（骰娘 AI 开关、
   * 表情包库管理）不被覆盖、加载期不抛错。 */
  window.WB = Object.assign(window.WB, {
    go, search, add, edit, del, closeModal, saveEdit, setTheme, aiSend, aiGen, aiClear: () => { CH.length = 0; S.pendFiles = []; renderPendStrip(); if (S.settings) { S.settings.chat = []; S.settings.chatSumAt = 0; } refreshChat(); persist(); },
    setViewSort, setViewSrc, setViewTpl, editSetTpl,
    aiUpload, aiExportLast, addLongMemory, delLongMemory, saveMemoModal, addModRule, delModRule,
    addUserPref, editUserPref, saveUserPrefModal, delUserPref,
    aiImportLast, aiTestCfg, saveAIConf, polishRun, polishExport, polishExportMd, buildBattleReport, saveAppName, toggleAiKey,
    setAiGenType, aiGenForType, globalSearch, setGType, goToEntity,
    importContent, doImport, doImportAndIntegrate, aiIntegrate, aiGenForView, doSplitRegister,
    savePrompts, resetPrompt, promptVersionList, promptCompare, promptRestoreVersion,
    hubResetMaster, hubResetScene, hubSave, hubViewMemory, hubSaveMemory, hubClearMemory,
    runAudit,
    createArchive, createArchiveHome, switchArchive, switchHome: switchArchive, dupArchive, delArchive, restoreBackup, restoreSnapshot,
    setSettingsTab, setAiFlag, saveAutoBackup,
    toggleSidebar, openPalette, openGlobalSearch, closeGlobalSearch, onboardDismiss, exportView, exportPick,
    openChat, doParse, scriptImportFile, captureScript, commitScript, clearScript, editPersona, savePersona, testPersona, delPersona, setActive, togglePersona,
    setFieldKind: (v) => { S.editFieldKind = v; paintFieldEditor(v); },
    addField: () => { const box = q('fieldEditor');            box.insertAdjacentHTML('beforeend', _rfRow()); },
    delField, fieldUp, fieldDown, saveFields, setFieldTpl, saveAsTemplate, aiBuildTemplate, toggleTile, resetLayout, doBackup, exportData, importData, openFolder, importLegacy,
    setDiceRule, setDiceAi, rollExpr, rollQuick, cocJudgeBtn, dndJudgeBtn, delDiceLog, diceClearLog,
    diceAiPortSave, diceAITest, diceViewRefresh,
    readSheet, sheetUsage, aiJudge, aiJudgeExplain, checkUpdate,
    startUpdateDownload, restartUpdate, laterUpdate, openReleasePage, saveUpdateSettings,
    relAddNode, relSaveNewNode, relSaveNode, relDelNode, relAddEdge, relSaveNewEdge, relSaveEdge, relDelEdge,
    relEdgePick, relConfirmEdge, relLayout, relUndo, relClear, relImportEnts, relAiSuggest,
    relToggleList, relListPick, relFilter, relZoomIn, relZoomOut, relFit, relCenter, toggleDrawerScript, setImportTpl,
    relToggleAll, relApplyOps,
    rawInput, rawClear, rawSuggest, rawExport, removePendFile, clearPendFiles,
    rawScriptBreak, rawShowTxt, rawShowSug, rawShowScript, rawExportScript,
    scriptStatusCycle, scriptGoto, scriptToggleClue, scriptNoteSet, scriptReset, scriptChecklist, scriptJump,
    plotSummary, commitPlotPoints, storySuggest, dismissChatHint,
    mapNew, mapDel, mapOpen, mapBack, mapMode, mapToggleGrid, mapGridSize, mapFinishRegion, mapUpload, mapTemplate,
    mapEditMarker, mapSaveMarker, mapDelMarker, mapFit, mapExportImg,
    mapDeleteSel, mapRenameRegion, mapSaveRegionName,
    mapAi, mapAiFillText, mapAiFillChat, mapAiRun, mapAiApply,
    toggleFav, toggleBatch, toggleSel, batchSelectAll, batchFav, batchDel, batchExport,
    dupCard, dedupKind,
    navBack, navForward, toggleWizard,
    openAiLedger, aiLandRevert, aiLandRevertAll,
    aiCancelCurrent, aiOpenUsagePanel, aiUsageResetPanel, aiUsageSetWindow,
    xrefOpen, xrefGo, consistencyOpen,
    tagJump, tagFilter, tagRenameModal, tagMergeModal, tagMergeInto, addTagGlobal,
    handoutOpen, handoutExport, toggleHandoutAll,
    toggleMoreMenu, setDensity, toggleDensity, openCtx, setCustomOrder, applyCustomOrder, bindCardDrag,
    encNew, encOpen, closeEnc, encDel, encSetFlow, encPull, encAddManual, encDelUnit, encHp, encToggleStatus,
    encNext, encPrev, encNextTo, encGoRef, encSettle,
    polishLogs, aiWriteScript, saveNarrStyle,
    statsExport, statsCopy,
    runlogRefresh, runlogFilter, runlogPickDay, runlogClearFilter, runlogExport, runlogOpen
  });

  let _selSeq = 0;
  function _newKey() { _selSeq++; return 'field' + _selSeq; }
  function _rfRow() {
    const k = _newKey();
    return `<div class="fieldrow" data-fid="x${k}">
      <input style="flex:0 0 84px" data-f="l" placeholder="显示名">
      <input style="flex:0 0 92px" data-f="k" placeholder="键(英文)">
      <select data-f="t" style="flex:0 0 92px">${['text','textarea','number','select','tags'].map(t => `<option value="${t}">${t}</option>`).join('')}</select>
      <input style="flex:0 0 132px" data-f="opts" placeholder="枚举用校验(逗号分隔)">
      <label style="flex:0 0 96px;font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" data-f="gm" title="勾选后此字段为 GM 专属，玩家投放物会隐藏">GM 专属</label>
      <button class="ghost" onclick="WB.delField(-1)">删</button></div>`;
  }
  function delField(i) {
    const rows = Array.from(document.querySelectorAll('#fieldEditor .fieldrow'));
    const row = i === -1 ? rows[rows.length - 1] : rows[i];
    if (row) row.remove();
  }
  function fieldUp(i) {
    const rows = Array.from(document.querySelectorAll('#fieldEditor .fieldrow'));
    if (i <= 0) return; const r = rows[i]; const p = rows[i - 1];
    p.parentNode.insertBefore(r, p);
  }
  function fieldDown(i) {
    const rows = Array.from(document.querySelectorAll('#fieldEditor .fieldrow'));
    if (i >= rows.length - 1) return; const r = rows[i]; const n = rows[i + 1];
    n.parentNode.insertBefore(n, r);
  }

  /* ============================================================
   * 关系网（Relations）—— 可拖动节点 + 带标签连线 + AI 协同
   * 数据结构：S.data.relations = { nodes:[{id,label,kind,x,y}], edges:[{id,from,to,label}] }
   * 交互：拖动节点 / 滚轮缩放 / 空白拖拽平移 / 双击改名 / 点击选中（右侧面板）/
   *       「⇄ 添加连线」连两节点、「↧ 从资料导入」由实体派生、「⚡ AI 补全」让 AI 推断关系。
   * ============================================================ */
  const REL_COLORS = { pcs: '#e05d5d', npcs: '#e0803d', regions: '#3fa37f', logs: '#5d7fd6', mobs: '#a05dc2', rules: '#7fa35d', lore: '#c2a25d', base: '#8a93a6' };
  const REL_KINDS = [['', '普通节点'], ['pcs', '人物卡'], ['npcs', 'NPC'], ['regions', '地区'], ['mobs', '怪物'], ['lore', '背景'], ['rules', '规则'], ['logs', '日志']];
  const REL_ETYPES = [['', '默认'], ['ally', '友好'], ['enemy', '敌对'], ['sub', '隶属'], ['un', '未知']];
  const REL_ECOLOR = { ally: '#3fa37f', enemy: '#e05d5d', sub: '#5d7fd6', un: '#9aa3b5', def: '#8a93a6' };
  function relEdgeColor(t) { return REL_ECOLOR[t] || REL_ECOLOR.def; }
  const _rel = { tx: 80, ty: 60, k: 1, W: 900, H: 600, sel: null, drag: null, pan: null, edgeMode: false, pendingFrom: null, svg: null, _escInstalled: false, _resizeInstalled: false, undo: [], filter: '' };

  function relData() {
    if (!S.data.relations) S.data.relations = { nodes: [], edges: [] };
    const r = S.data.relations;
    if (!Array.isArray(r.nodes)) r.nodes = [];
    if (!Array.isArray(r.edges)) r.edges = [];
    return r;
  }
  function relPersist(msg) { pushAudit('关系网', 'edit', '关系网'); persist(); if (msg) toast(msg, 'ok'); }
  function relGetNode(r, id) { return r.nodes.find(n => n.id === id); }
  function relKindLabel(v) { const f = REL_KINDS.find(k => k[0] === v); return f ? f[1] : ''; }
  /* 关系网撤销：在“一键整理/删除节点/删除连线/清空”等破坏性操作前，把当前布点存档，可一键还原 */
  function relPushUndo() {
    const r = relData();
    _rel.undo.push({ nodes: JSON.parse(JSON.stringify(r.nodes)), edges: JSON.parse(JSON.stringify(r.edges)) });
    if (_rel.undo.length > 25) _rel.undo.shift();
  }
  function relUndo() {
    const snap = _rel.undo.pop();
    if (!snap) { toast('没有可撤销的操作', ''); return; }
    const r = relData();
    r.nodes = snap.nodes; r.edges = snap.edges;
    _rel.sel = null; relPersist('已撤销上一步'); relPaint();
  }

  function relAutoSize() {
    const wrap = q('relWrap'); if (!wrap) return;
    _rel.W = Math.max(320, wrap.clientWidth);
    _rel.H = Math.max(360, wrap.clientHeight);
  }
  function relSeedLayout(repaint) {
    const r = relData(); relAutoSize();
    const cx = _rel.W / 2, cy = _rel.H / 2, R = Math.min(_rel.W, _rel.H) / 2 - 70;
    const fresh = r.nodes.filter(n => typeof n.x !== 'number' || typeof n.y !== 'number');
    const placed = r.nodes.filter(n => typeof n.x === 'number' && typeof n.y === 'number');
    fresh.forEach((n, i) => {
      /* 确定式补种（不用随机数）：同一份数据每次得到相同的初始摆位，配合一键整理才不会「越点越乱」 */
      const a = (i / Math.max(fresh.length, 1)) * 2 * Math.PI + (placed.length * 0.53);
      const rr = Math.max(60, R) * (0.72 + (i % 3) * 0.13);
      n.x = cx + Math.cos(a) * rr; n.y = cy + Math.sin(a) * rr;
    });
    if (repaint) relPaint();
  }

  function renderRelations() {
    const r = relData();
    contentInner(`<div class="page-title"><h2>关系网</h2><span class="hint" id="relStats">共 ${r.nodes.length} 节点 · ${r.edges.length} 连线</span></div>
      <div class="toolbar">
        <button onclick="WB.relAddNode()">＋ 新增节点</button>
        <button class="ghost" onclick="WB.relAddEdge()">⇄ 添加连线</button>
        <button class="ghost" onclick="WB.relImportEnts()">↧ 从资料导入</button>
        <button class="ghost" onclick="WB.relAiSuggest()">⚡ AI 补全关系</button>
        <button class="ghost" onclick="WB.consistencyOpen()" title="检查重名 / 悬空连线等结构问题">🛡 一致性</button>
        <button onclick="WB.relLayout()">⟳ 一键整理</button>
        <button class="ghost" onclick="WB.relUndo()" id="relUndoBtn" title="撤销最近一次整理/删除/清空">↩ 撤销</button>
        <button class="ghost" onclick="WB.relToggleList()" id="relListBtn" title="以文本列表形式浏览全部关系内容，避免画布连成一片看不清">☰ 关系清单</button>
        <span class="rel-search"><span class="gf">⌕</span><input id="relFilter" placeholder="筛选节点…" value="${esc(_rel.filter || '')}" oninput="WB.relFilter(this.value)"></span>
        <button class="ghost" onclick="WB.relZoomIn()" title="放大">＋</button>
        <button class="ghost" onclick="WB.relZoomOut()" title="缩小">−</button>
        <button class="ghost" onclick="WB.relFit()" title="适应画布，一屏看全">⌂</button>
        <button class="ghost" onclick="WB.relCenter()" title="居中视图">◎</button>
        <span class="grow"></span>
        <span class="hint">拖动节点 · 滚轮缩放 · 空白拖拽平移</span>
      </div>
      <div class="rel-wrap" id="relWrap">
        <svg id="relSvg" class="rel-svg"></svg>
        <div class="rel-side" id="relSide" hidden></div>
      </div>
      <div class="rel-legend" id="relLegend"></div>`);
    _rel.sel = null; _rel.drag = null; _rel.pan = null; _rel.edgeMode = false; _rel.pendingFrom = null; _rel.listMode = false;
    const lb = q('relListBtn'); if (lb) lb.textContent = '☰ 关系清单';
    const sv2 = q('relSide'); if (sv2) { sv2.hidden = true; sv2.innerHTML = ''; }
    /* 缺坐标（含只有 x 没有 y 的脏数据）即补种，避免 relPaint 里 toFixed 抛错 */
    if (r.nodes.length && r.nodes.some(n => typeof n.x !== 'number' || typeof n.y !== 'number')) relSeedLayout(false);
    relAutoSize();
    /* 必须先绑定新 svg 再绘制：contentInner 已卸载旧 svg，_rel.svg 仍指向旧节点会让画布空白 */
    const svg = q('relSvg'); _rel.svg = svg;
    relPaint();
    svg.addEventListener('pointerdown', relPointerDown);
    svg.addEventListener('pointermove', relPointerMove);
    svg.addEventListener('pointerup', relPointerUp);
    svg.addEventListener('pointercancel', relPointerUp);
    svg.addEventListener('wheel', relWheel, { passive: false });
    svg.addEventListener('dblclick', relDblClick);
    relPaintLegend();
    if (!_rel._escInstalled) {
      _rel._escInstalled = true;
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _rel.edgeMode) { _rel.edgeMode = false; _rel.pendingFrom = null; relPaint(); } });
    }
    if (!_rel._resizeInstalled) {
      _rel._resizeInstalled = true;
      window.addEventListener('resize', () => { if (S.view === 'relations' && _rel.svg) { relAutoSize(); relPaint(); } });
    }
  }

  function relPaint() {
    const svg = _rel.svg || q('relSvg'); if (!svg) return;
    const r = relData();
    const W = Math.max(320, svg.clientWidth || _rel.W), H = Math.max(360, svg.clientHeight || _rel.H);
    _rel.W = W; _rel.H = H;
    const byId = {}; for (const n of r.nodes) byId[n.id] = n;
    const kw = (_rel.filter || '').toLowerCase().trim();
    const hit = (n) => !kw || String(n.label || '').toLowerCase().includes(kw) || String(n.kind || '').toLowerCase().includes(kw) || String(n.desc || '').toLowerCase().includes(kw);
    let eHtml = '', nHtml = '';
    const R = 20;
    let visE = 0, visN = 0;
    for (const e of r.edges) {
      const a = byId[e.from], b = byId[e.to]; if (!a || !b) continue;
      const show = !kw || (hit(a) && hit(b));
      if (show) visE++;
      const sel = _rel.sel === e.id;
      const ecol = relEdgeColor(e.type);
      eHtml += `<line class="rel-edge${sel ? ' sel' : ''}${show ? '' : ' off'}" data-eid="${esc(e.id)}" style="stroke:${ecol}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 12;
      if (show) eHtml += `<text class="rel-elabel" data-eid="${esc(e.id)}" style="fill:${ecol}" x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle">${esc(e.label || '关系')}</text>`;
    }
    for (const n of r.nodes) {
      const col = REL_COLORS[n.kind] || REL_COLORS.base;
      const sel = _rel.sel === n.id;
      const show = hit(n); if (show) visN++;
      nHtml += `<g class="rel-node" data-nid="${esc(n.id)}">
        <circle class="rel-n-body${show ? '' : ' off'}" data-nid="${esc(n.id)}" r="${R}" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" fill="${col}" fill-opacity="${sel ? 1 : 0.9}" stroke="${sel ? '#fff' : (show && kw ? '#ffd24d' : 'rgba(0,0,0,.35)')}" stroke-width="${sel ? 3 : (show && kw ? 2.5 : 1)}"/>
        <circle class="rel-n-hit${show ? '' : ' off'}" data-nid="${esc(n.id)}" r="${R + 12}" fill="transparent"/>
        ${_rel.edgeMode && _rel.pendingFrom === n.id ? `<circle class="rel-n-pulse" data-nid="${esc(n.id)}" r="${R + 7}" fill="none" stroke="${col}" stroke-width="2"/>` : ''}
        ${show ? `<text class="rel-nlabel" text-anchor="middle" x="${n.x.toFixed(1)}" y="${(n.y + R + 16).toFixed(1)}" data-nid="${esc(n.id)}">${esc(n.label || '未命名')}</text>` : ''}
        ${show && n.kind ? `<text class="rel-nkind" text-anchor="middle" x="${n.x.toFixed(1)}" y="${(n.y - R - 6).toFixed(1)}" data-nid="${esc(n.id)}">${esc(relKindLabel(n.kind))}</text>` : ''}
      </g>`;
    }
    svg.setAttribute('viewBox', `0 0 ${_rel.W} ${_rel.H}`);
    svg.innerHTML = `<g class="rel-vp" transform="translate(${_rel.tx},${_rel.ty}) scale(${_rel.k})">
        <g class="rel-edges">${eHtml}</g>
        <g class="rel-nodes">${nHtml}</g>
      </g>`;
    const st = q('relStats'); if (st) st.textContent = kw ? `筛选到 ${visN}/${r.nodes.length} 节点 · ${visE}/${r.edges.length} 连线` : `共 ${r.nodes.length} 节点 · ${r.edges.length} 连线`;
    /* 拖动过程中不重建侧栏：每次 pointermove 都 relPaint，重建会清空正在输入的表单内容与焦点 */
    if (!_rel.drag) relUpdateSide();
  }
  /* 筛选与视图工具 */
  function relFilter(v) { _rel.filter = String(v || ''); relPaint(); }
  function relZoomAt(factor) {
    const svg = _rel.svg; if (!svg) return;
    const cxp = svg.clientWidth / 2, cyp = svg.clientHeight / 2;
    const ux = (cxp - _rel.tx) / _rel.k, uy = (cyp - _rel.ty) / _rel.k;
    const nk = Math.min(40, Math.max(0.2, _rel.k * factor));
    _rel.tx = cxp - ux * nk; _rel.ty = cyp - uy * nk; _rel.k = nk;
    relPaint();
  }
  function relZoomIn() { relZoomAt(1.25); }
  function relZoomOut() { relZoomAt(0.8); }
  function relCenter() {
    _rel.k = Math.max(0.2, Math.min(4, _rel.k));
    relAutoSize();
    /* 居中的正解：screen = t + world*k，故 t = 视口中心 - 内容中心*k
       （原先直接把 t 设为视口中心，会把内容推到画布右下之外） */
    const ns = relData().nodes.filter(n => typeof n.x === 'number' && typeof n.y === 'number');
    if (ns.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of ns) { if (n.x < minX) minX = n.x; if (n.y < minY) minY = n.y; if (n.x > maxX) maxX = n.x; if (n.y > maxY) maxY = n.y; }
      _rel.tx = _rel.W / 2 - ((minX + maxX) / 2) * _rel.k;
      _rel.ty = _rel.H / 2 - ((minY + maxY) / 2) * _rel.k;
    } else { _rel.tx = _rel.W / 2; _rel.ty = _rel.H / 2; }
    relPaint();
  }
  function relFit() {
    const r = relData(); if (!r.nodes.length) { relCenter(); return; }
    relAutoSize();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of r.nodes) {
      if (typeof n.x !== 'number' || typeof n.y !== 'number') continue;
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    }
    if (!isFinite(minX)) { relCenter(); return; }
    const pad = 60, bw = (maxX - minX) + 2 * pad, bh = (maxY - minY) + 2 * pad;
    const k = Math.min((_rel.W - 20) / Math.max(bw, 1), (_rel.H - 20) / Math.max(bh, 1), 4);
    _rel.k = Math.max(0.1, k);
    _rel.tx = (_rel.W - (minX + maxX) * _rel.k) / 2;
    _rel.ty = (_rel.H - (minY + maxY) * _rel.k) / 2;
    relPaint();
  }
  function relPaintLegend() {
    const lg = q('relLegend'); if (!lg) return;
    lg.innerHTML = REL_KINDS.filter(([v]) => v).map(([v, l]) => `<span class="rel-lg"><i class="rel-dot" style="background:${REL_COLORS[v] || REL_COLORS.base}"></i>${esc(l)}</span>`).join('');
  }

  /* 画布事件 */
  function relToUser(ev) {
    const svg = _rel.svg; if (!svg) return { x: 0, y: 0, sx: 0, sy: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    return { x: (sx - _rel.tx) / _rel.k, y: (sy - _rel.ty) / _rel.k, sx, sy };
  }
  function relPointerDown(ev) {
    const svg = _rel.svg; if (!svg) return;
    const t = ev.target;
    const attr = (t && t.getAttribute) ? t.getAttribute.bind(t) : null;
    const nid = attr ? attr('data-nid') : null;
    const eid = attr ? attr('data-eid') : null;
    if (nid && !eid) {
      // 连线模式：点击目标节点创建连线
      if (_rel.edgeMode && _rel.pendingFrom && _rel.pendingFrom !== nid) { relCreateEdgeQuick(_rel.pendingFrom, nid); return; }
      const n = relGetNode(relData(), nid);
      const u = relToUser(ev);
      _rel.drag = { id: nid, offX: n ? (n.x - u.x) : 0, offY: n ? (n.y - u.y) : 0 };
      try { svg.setPointerCapture(ev.pointerId); } catch (_) {}
      ev.preventDefault();
      return;
    }
    if (eid) { _rel.sel = eid; _rel.edgeMode = false; _rel.pendingFrom = null; relPaint(); return; }
    // 空白处：平移
    _rel.pan = { px: ev.clientX, py: ev.clientY, tx: _rel.tx, ty: _rel.ty };
    try { svg.setPointerCapture(ev.pointerId); } catch (_) {}
    ev.preventDefault();
  }
  function relPointerMove(ev) {
    if (_rel.drag) {
      const u = relToUser(ev);
      const n = relGetNode(relData(), _rel.drag.id);
      if (n) { n.x = u.x + _rel.drag.offX; n.y = u.y + _rel.drag.offY; relPaint(); }
    } else if (_rel.pan) {
      _rel.tx = _rel.pan.tx + (ev.clientX - _rel.pan.px);
      _rel.ty = _rel.pan.ty + (ev.clientY - _rel.pan.py);
      relPaint();
    }
  }
  function relPointerUp(ev) {
    if (_rel.drag) {
      const nid = _rel.drag.id; _rel.drag = null; _rel.pan = null;
      _rel.sel = nid; _rel.edgeMode = false; _rel.pendingFrom = null;
      relPersist(); relPaint();
    } else if (_rel.pan) {
      _rel.pan = null;
    }
  }
  function relWheel(ev) {
    const svg = _rel.svg; if (!svg) return;
    ev.preventDefault();
    const u = relToUser(ev);
    const f = ev.deltaY < 0 ? 1.12 : 0.89;
    const nk = Math.min(40, Math.max(0.2, _rel.k * f));
    _rel.tx = u.sx - u.x * nk; _rel.ty = u.sy - u.y * nk; _rel.k = nk;
    relPaint();
  }
  function relDblClick(ev) {
    const t = ev.target; const nid = (t && t.getAttribute) ? t.getAttribute('data-nid') : null;
    if (!nid) return;
    const n = relGetNode(relData(), nid); if (!n) return;
    appPrompt({ title: '重命名节点', label: '节点名称', value: n.label || '', okText: '保存' }, (v) => {
      if (v == null) return;
      const s = String(v).trim(); if (!s) { toast('名称不能为空', 'err'); return; }
      n.label = s; _rel.sel = n.id; relPersist(); relPaint();
    });
  }

  /* 侧栏（选中节点/连线） */
  function relEdgeNames(e) {
    const byId = {}; for (const n of relData().nodes) byId[n.id] = n.label;
    return (byId[e.from] || e.from) + ' —— ' + (byId[e.to] || e.to);
  }
  function relUpdateSide() {
    const side = q('relSide'); if (!side) return;
    const r = relData();
    /* 关系清单模式：以易读文本列出全部连线（画布连成一片看不清时用这招直接读懂关系内容） */
    if (_rel.listMode) {
      let h = '<h4>关系清单</h4>';
      h += '<div class="hint">共 ' + r.edges.length + ' 条。点击某条可在上方修改其关系说明。</div>';
      const selE = r.edges.find(x => x.id === _rel.sel);
      if (selE) {
        const a = relGetNode(r, selE.from), b = relGetNode(r, selE.to);
        const eOpts = REL_ETYPES.map(([v, l]) => `<option value="${esc(v)}" ${selE.type === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
        h += `<div class="rel-edit"><b>${esc(a ? (a.label || a.id) : selE.from)}</b> ➔ <b>${esc(b ? (b.label || b.id) : selE.to)}</b>
          <label>关系类型</label><select id="relEdgeTypeIn">${eOpts}</select>
          <label>关系说明</label><input id="relEdgeLabelIn" value="${esc(selE.label || '')}" placeholder="如 师徒 / 敌对 / 隶属…">
          <div class="foot" style="justify-content:flex-start;padding:0;margin-top:6px"><button onclick="WB.relSaveEdge()">保存</button><button class="danger" onclick="WB.relDelEdge()">删除</button></div></div>`;
      }
      if (!r.edges.length) h += '<div class="empty" style="padding:8px 0">暂无连线，先「＋ 添加连线」或「↧ 从资料导入」。</div>';
      for (const e of r.edges.slice(0, 500)) {
        const a = relGetNode(r, e.from), b = relGetNode(r, e.to);
        const an = a ? (a.label || a.id) : e.from, bn = b ? (b.label || b.id) : e.to;
        const sel = _rel.sel === e.id;
        h += `<div class="rel-li${sel ? ' sel' : ''}" data-eid="${esc(e.id)}" onclick="WB.relListPick('${escJs(e.id)}')"><b>${esc(an)}</b> <em>➔ ${esc(e.label || '关系')}</em> <b>${esc(bn)}</b></div>`;
      }
      side.innerHTML = h; side.hidden = false;
      return;
    }
    let sel = null;
    if (_rel.sel) { const n = relGetNode(r, _rel.sel); if (n) sel = { type: 'node', node: n }; else { const e = r.edges.find(x => x.id === _rel.sel); if (e) sel = { type: 'edge', edge: e }; } }
    if (!sel) { side.hidden = true; side.innerHTML = ''; return; }
    side.hidden = false;
    if (sel.type === 'node') {
      const n = sel.node;
      const kindOpts = REL_KINDS.map(([v, l]) => `<option value="${esc(v)}" ${n.kind === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
      const cand = r.nodes.filter(x => x.id !== n.id).map(x => `<option value="${esc(x.id)}">${esc(x.label || x.id)}</option>`).join('');
      side.innerHTML = `<h4>节点</h4>
        <label>名称</label><input id="relNameIn" value="${esc(n.label || '')}">
        <label>类型</label><select id="relKindIn">${kindOpts}</select>
        <div class="foot" style="justify-content:flex-start;flex-wrap:wrap;padding:0;margin-top:8px">
          <button onclick="WB.relSaveNode()">保存</button>
          <button class="ghost" onclick="WB.relEdgePick('${escJs(n.id)}')">⇄ 在画布连线…</button>
          <button class="danger" onclick="WB.relDelNode()">删除</button>
        </div>
        <div class="hint" style="margin-top:10px">或从下拉选择目标后“确定连线”：</div>
        <select id="relEdgeTo" style="width:100%">${cand}<option value="__pick" selected>在画布上点选…</option></select>
        <button class="ghost" style="width:100%;margin-top:6px" onclick="WB.relConfirmEdge('${escJs(n.id)}')">⇄ 确定连线</button>
        ${_rel.edgeMode ? `<div class="hint" style="color:var(--accent);margin-top:8px">正等待在画布上点击目标节点（Esc 取消）</div>` : ''}`;
    } else {
      const e = sel.edge;
      const eOpts = REL_ETYPES.map(([v, l]) => `<option value="${esc(v)}" ${e.type === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
      side.innerHTML = `<h4>连线</h4><div class="hint">${esc(relEdgeNames(e))}</div>
        <label>关系类型</label><select id="relEdgeTypeIn">${eOpts}</select>
        <label>关系说明</label><input id="relEdgeLabelIn" value="${esc(e.label || '')}" placeholder="如 师徒 / 敌对 / 隶属…">
        <div class="foot" style="justify-content:flex-start;padding:0;margin-top:8px"><button onclick="WB.relSaveEdge()">保存</button><button class="danger" onclick="WB.relDelEdge()">删除</button></div>`;
    }
  }
  function relEdgePick(id) { _rel.edgeMode = true; _rel.pendingFrom = id; _rel.sel = id; relPaint(); toast('点击画布上的目标节点以连线', 'ok'); }
  function relConfirmEdge(fromId) {
    const sel = q('relEdgeTo'); const v = sel ? sel.value : '__pick';
    if (!v || v === '__pick') { toast('请选择目标节点或以画布点选', 'err'); return; }
    if (v === fromId) { toast('不能连接到自身', 'err'); return; }
    relCreateEdgeQuick(fromId, v);
  }
  function relCreateEdgeQuick(a, b) {
    const r = relData();
    if (r.edges.some(e => (e.from === a && e.to === b) || (e.from === b && e.to === a))) { toast('这两点已有连线', 'err'); _rel.edgeMode = false; _rel.pendingFrom = null; relPaint(); return; }
    const e = { id: uid(), from: a, to: b, label: '关系' };
    r.edges.push(e); _rel.sel = e.id; _rel.edgeMode = false; _rel.pendingFrom = null;
    relPersist(); relPaint();
  }
  /* 关系清单：在侧栏以易读文本列出全部连线内容 */
  function relToggleList() {
    _rel.listMode = !_rel.listMode;
    if (_rel.listMode) { _rel.sel = null; }
    const lb = q('relListBtn'); if (lb) lb.textContent = _rel.listMode ? '✕ 收起清单' : '☰ 关系清单';
    const r = relData();
    const mayNeedLayout = _rel.listMode && r.nodes.length && r.nodes.some(n => typeof n.x !== 'number');
    if (mayNeedLayout) relSeedLayout(false);
    relPaint();
  }
  function relListPick(id) {
    _rel.sel = id;
    const r = relData(); const e = r.edges.find(x => x.id === id);
    if (e) { const a = relGetNode(r, e.from), b = relGetNode(r, e.to); const an = a ? a.label : e.from, bn = b ? b.label : e.to; toast(an + ' ➔ ' + (e.label || '关系') + ' ➔ ' + bn, 'ok'); }
    relPaint();
  }

  /* 节点 / 连线 CRUD */
  function relAddNode() {
    const kinds = REL_KINDS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>新增节点</h3><div class="formgrid">
      <div class="row full"><label>名称</label><input id="relAddName" placeholder="节点名称 / 实体名"></div>
      <div class="row full"><label>类型</label><select id="relAddKind">${kinds}</select></div>
    </div><div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button><button onclick="WB.relSaveNewNode()">保存</button></div>`;
    mask.hidden = false; setTimeout(() => { const el = q('relAddName'); if (el) el.focus(); }, 30);
  }
  function relSaveNewNode() {
    const nm = String((q('relAddName') && q('relAddName').value) || '').trim();
    if (!nm) { toast('请填写名称', 'err'); return; }
    const kind = (q('relAddKind') && q('relAddKind').value) || '';
    const r = relData();
    if (r.nodes.some(n => (n.label || '') === nm)) { toast('已存在同名节点', 'err'); return; }
    relAutoSize();
    r.nodes.push({ id: uid(), label: nm, kind, x: _rel.W / 2 + (Math.random() - 0.5) * 120, y: _rel.H / 2 + (Math.random() - 0.5) * 120 });
    _rel.sel = r.nodes[r.nodes.length - 1].id; closeModal();
    relPersist(); relPaint();
  }
  function relSaveNode() {
    const n = relGetNode(relData(), _rel.sel); if (!n) return;
    const t = String((q('relNameIn') && q('relNameIn').value) || '').trim();
    if (t) n.label = t;
    const k = (q('relKindIn') && q('relKindIn').value) || '';
    n.kind = k;
    relPersist(); relPaint();
  }
  async function relDelNode() {
    const id = _rel.sel; const n = relGetNode(relData(), id); if (!n) return;
    if (!(await appConfirm('删除节点', '删除节点「' + (n.label || '') + '」及其所有连线？'))) return;
    relPushUndo();
    const r = relData();
    r.nodes = r.nodes.filter(x => x.id !== id);
    r.edges = r.edges.filter(e => e.from !== id && e.to !== id);
    _rel.sel = null; relPersist('已删除节点'); relPaint();
  }
  function relAddEdge() {
    const r = relData();
    if (r.nodes.length < 2) { toast('至少需要 2 个节点，请先新增或导入节点', 'err'); return; }
    const opts = r.nodes.map(x => `<option value="${esc(x.id)}">${esc(x.label || x.id)}</option>`).join('');
    const eOpts = REL_ETYPES.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>添加连线</h3><div class="formgrid">
      <div class="row"><label>从</label><select id="relEdgeFrom">${opts}</select></div>
      <div class="row"><label>到</label><select id="relEdgeToM">${opts}</select></div>
      <div class="row"><label>关系类型</label><select id="relEdgeTypeM">${eOpts}</select></div>
      <div class="row full"><label>关系说明</label><input id="relEdgeLabelM" placeholder="如 师徒 / 敌对 / 隶属…"></div>
    </div><div class="foot"><button class="ghost" onclick="WB.closeModal()">取消</button><button onclick="WB.relSaveNewEdge()">保存</button></div>`;
    mask.hidden = false;
  }
  function relSaveNewEdge() {
    const a = (q('relEdgeFrom') && q('relEdgeFrom').value), b = (q('relEdgeToM') && q('relEdgeToM').value);
    if (!a || !b || a === b) { toast('请选择两个不同节点', 'err'); return; }
    const r = relData();
    if (r.edges.some(e => (e.from === a && e.to === b) || (e.from === b && e.to === a))) { toast('这两点已有连线', 'err'); return; }
    const lbl = String((q('relEdgeLabelM') && q('relEdgeLabelM').value) || '').trim() || '关系';
    const tp = (q('relEdgeTypeM') && q('relEdgeTypeM').value) || '';
    r.edges.push({ id: uid(), from: a, to: b, label: lbl, type: tp || undefined }); _rel.sel = r.edges[r.edges.length - 1].id; closeModal();
    relPersist(); relPaint();
  }
  function relSaveEdge() {
    const e = relData().edges.find(x => x.id === _rel.sel); if (!e) return;
    e.label = String((q('relEdgeLabelIn') && q('relEdgeLabelIn').value) || '').trim() || '关系';
    const tp = (q('relEdgeTypeIn') && q('relEdgeTypeIn').value) || '';
    e.type = tp || undefined;
    relPersist(); relPaint();
  }
  async function relDelEdge() {
    const id = _rel.sel; const r = relData();
    if (!id) { toast('请先选中一条连线', 'err'); return; }
    /* 必须确认选中的确实是连线：选中节点时点击“删除连线”原先会提示成功但什么都没删 */
    if (!r.edges.some(e => e.id === id)) { toast('请先选中一条连线（当前选中的是节点）', 'err'); return; }
    if (!(await appConfirm('删除连线', '删除这条连线？'))) return;
    relPushUndo();
    r.edges = r.edges.filter(e => e.id !== id);
    _rel.sel = null; relPersist('已删除连线'); relPaint();
  }

  /* 从现有资料派生节点 */
  async function relImportEnts() {
    const r = relData();
    const names = new Set(r.nodes.map(n => String(n.label || '').trim()));
    let added = 0;
    for (const k of KINDS) {
      for (const it of (S.data.entities[k] || [])) {
        const nm = String(it.name || it.title || '').trim();
        if (!nm || names.has(nm)) continue;
        names.add(nm); r.nodes.push({ id: uid(), label: nm, kind: k }); added++;
      }
    }
    if (added) { relSeedLayout(true); relPersist('已从资料导入 ' + added + ' 个节点'); }
    else { relAutoSize(); relPaint(); toast('没有可新增的实体节点', 'ok'); }
  }

  /* AI 一键补全关系：AI 返回「新增/修正/删除」三类候选，先预览确认再应用（防误改误删） */
  async function relAiSuggest() {
    const totalEnts = KINDS.reduce((s, k) => s + (S.data.entities[k] || []).length, 0);
    if (!totalEnts) { toast('请先登记人物/NPC/势力等资料，AI 才能推断关系', 'err'); return; }
    toast('AI 正在分析角色与势力关系…', 'ok');
    try {
      const payload = { entities: S.data.entities, relations: relData() };
      const res = await window.api.relationsSuggest(payload);
      if (!res || !res.ok) { toast('AI 调用失败：' + ((res && res.error) || '未知错误'), 'err'); return; }
      const ops = Array.isArray(res.relations) ? res.relations : [];
      if (!ops.length) { toast('AI 未推断出可用的关系操作，请稍后重试或补充资料', 'err'); return; }
      relBuildPreview(ops);
    } catch (e) {
      toast('AI 补全失败：' + ((e && e.message) || e), 'err');
    }
  }

  /* 生成“操作预览”确认弹窗：按类型分组列出，每项可勾选，确认后才真正写入 */
  function relBuildPreview(ops) {
    const mask = q('modalMask'); const box = q('modalBox');
    _rel._pendingOps = ops;
    const r = relData();
    const nameById = {}; for (const n of r.nodes) nameById[n.id] = n.label;
    const edgeLabelOf = (a, b) => { const e = r.edges.find(x => (x.from === a && x.to === b) || (x.from === b && x.to === a)); return e ? (e.label || '关系') : '关系'; };
    let html = `<h3>AI 关系操作预览</h3><div class="note" style="margin-bottom:8px">AI 依据现有资料推断出以下操作，请逐项勾选确认后再应用。修正/删除只会作用于已存在的连线，AI 无法凭空删改其它内容。</div>`;
    const grp = { add: [], edit: [], del: [] };
    ops.forEach(o => { if (grp[o.op]) grp[o.op].push(o); });
    const rows = [];
    const opLabel = { add: ['＋ 新增', 'var(--ok)'], edit: ['✎ 修正', 'var(--accent)'], del: ['✕ 删除', 'var(--danger)'] };
    const renderRow = (o) => {
      const [tag, col] = opLabel[o.op] || opLabel.add;
      let desc = '';
      const na = String(o.from || '').trim(), nb = String(o.to || '').trim();
      if (o.op === 'add') desc = `<b>${esc(na)}</b> —— <b>${esc(nb)}</b>` + `<div class="hint">关系：${esc(o.label || '关系')}</div>`;
      else if (o.op === 'edit') desc = `<b>${esc(na)}</b> —— <b>${esc(nb)}</b>` + `<div class="hint">${esc(edgeLabelOf(o.from, o.to))}　→　${esc(o.label || '关系')}</div>`;
      else desc = `<b>${esc(na)}</b> —— <b>${esc(nb)}</b>` + `<div class="hint">当前：${esc(edgeLabelOf(o.from, o.to))}</div>`;
      /* 勾选框编号必须用「原始 ops 下标」：渲染按 add→edit→del 分组，
         若用渲染序号编号，relApplyOps 会按 ops 顺序读到错位的勾选状态。 */
      const i = ops.indexOf(o);
      return `<label class="rel-prev-row"><input type="checkbox" id="relchk_${i}" checked>
        <span style="width:62px;flex:0 0 auto;color:${col};font-size:12px">${tag}</span>
        <span style="flex:1;font-size:13px">${desc}</span></label>`;
    };
    if (grp.add.length) rows.push(`<div class="rel-prev-grp"><h4 style="margin:8px 0 6px;font-size:13px">新增 ${grp.add.length}</h4>${grp.add.map(renderRow).join('')}</div>`);
    if (grp.edit.length) rows.push(`<div class="rel-prev-grp"><h4 style="margin:8px 0 6px;font-size:13px">修正 ${grp.edit.length}</h4>${grp.edit.map(renderRow).join('')}</div>`);
    if (grp.del.length) rows.push(`<div class="rel-prev-grp"><h4 style="margin:8px 0 6px;font-size:13px">删除 ${grp.del.length}</h4>${grp.del.map(renderRow).join('')}</div>`);
    html += `<div class="rel-prev-list" style="max-height:48vh;overflow:auto">${rows.join('')}</div>`;
    html += `<div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <label style="font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="relApplyAll" checked onclick="WB.relToggleAll(this.checked)">全选</label>
        <span class="grow"></span>
        <button class="ghost" onclick="WB.closeModal()">取消</button>
        <button onclick="WB.relApplyOps()">应用选中（${ops.length}）</button></div>`;
    box.innerHTML = html;
    mask.hidden = false;
  }
  function relToggleAll(on) {
    const r = _rel._pendingOps || [];
    for (let i = 0; i < r.length; i++) { const el = q('relchk_' + i); if (el) el.checked = on; }
  }

  /* 应用确认后的操作（新增 / 修正 / 删除连线） */
  function relApplyOps() {
    const ops = _rel._pendingOps || [];
    aiLandBefore('AI 应用关系操作'); // C2：应用前快照
    const r = relData();
    const nameId = {}; for (const n of r.nodes) nameId[String(n.label || '').trim()] = n.id;
    const kindOf = {}; for (const k of KINDS) for (const it of (S.data.entities[k] || [])) { const nm = String(it.name || it.title || '').trim(); if (nm && !kindOf[nm]) kindOf[nm] = k; }
    const ensure = (nm) => { const key = String(nm || '').trim(); if (!key) return null; if (nameId[key]) return nameId[key]; const n = { id: uid(), label: key, kind: kindOf[key] || '' }; r.nodes.push(n); nameId[key] = n.id; return n.id; };
    const findEdge = (a, b) => r.edges.find(e => (e.from === a && e.to === b) || (e.from === b && e.to === a)) || null;
    let adds = 0, edits = 0, dels = 0, newNodes = 0;
    const before = r.nodes.length;
    ops.forEach((o, i) => {
      const el = q('relchk_' + i); if (!el || !el.checked) return;
      const a = ensure(o.from), b = ensure(o.to); if (!a || !b || a === b) return;
      if (o.op === 'add') {
        if (findEdge(a, b)) return;
        r.edges.push({ id: uid(), from: a, to: b, label: String(o.label || '关系').slice(0, 20) || '关系' }); adds++;
      } else if (o.op === 'edit') {
        const e = findEdge(a, b); if (!e) return;
        if (e.label !== (o.label || '关系')) { e.label = String(o.label || '关系').slice(0, 20) || '关系'; edits++; }
      } else if (o.op === 'del') {
        const e = findEdge(a, b); if (!e) return;
        r.edges = r.edges.filter(x => x.id !== e.id); dels++;
      }
    });
    newNodes = r.nodes.length - before;
    _rel._pendingOps = null;
    closeModal();
    relSeedLayout(true); relPaint(); relPersist();
    aiLandCommit(); // C2：关系应用完成，登记落地记录
    toast('已应用 AI 操作：新增 ' + adds + ' · 修正 ' + edits + ' · 删除 ' + dels + (newNodes ? ' · 新建节点 ' + newNodes : ''), 'ok');
  }

  /* 连通分量：把有连线关系的节点归入同一子图，用于分组整理 */
  function relComponents(r) {
    if (!r.nodes.length) return [];
    const adj = {}; for (const n of r.nodes) adj[n.id] = [];
    for (const e of r.edges) if (adj[e.from] && adj[e.to]) { adj[e.from].push(e.to); adj[e.to].push(e.from); }
    const seen = new Set(), comps = [];
    for (const n of r.nodes) {
      if (seen.has(n.id)) continue;
      const ids = [n.id], stack = [n.id]; seen.add(n.id);
      while (stack.length) {
        const id = stack.pop();
        for (const nb of adj[id]) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); ids.push(nb); }
      }
      comps.push({ ids });
    }
    return comps;
  }

  /* ---------- 一键整理（重写） ----------
   * 旧版为何「拉跨」：所有节点混在同一个力导向里跑，只有「组心锚点」而没有真正的组间避让，
   * 最后又把每组硬平移回目标圆心，等于把刚分开的节点重新叠回去；孤立点还被挤在一条窄环带里互相压；
   * 另外补种坐标用了随机数，同一张图连点几次结果都不一样，越点越乱。
   * 新版分两步，稳定且把「不重叠」做成硬保证：
   *   ① 每个连通分量在各自的局部坐标系里单独排布——位置式松弛（先消重叠、再收连线长度），比速度积分稳；
   *   ② 把每个分量的外接圆当作一个「块」，从大到小依次打包进画布：每块在环上找第一个与已放块
   *      都不重叠的落点，块与块之间固定留出空隙。
   * 全程无随机数：同一张图重复点「一键整理」结果基本一致。 */

  /* 节点占位半径：本体圆 R=20，下方名称(13px)与上方类型(11px)标签都算进去，避免标签互相压字 */
  function relNodeRadius(n) {
    const len = String(n.label || '未命名').length;
    return Math.max(38, Math.min(len * 7, 104));
  }

  /* 单个连通分量的局部排布：返回 {ids, P:{id:[x,y]}, rad}，P 以该组重心为原点 */
  function relLocalLayout(ids, inner, byId, rad) {
    const P = {};
    if (ids.length === 1) { P[ids[0]] = [0, 0]; return { ids, P, rad: rad[ids[0]] }; }
    /* 种子：沿用当前位置（保留用户已摆好的相对关系）；缺坐标则按确定式圆环铺开 */
    const ok = ids.every(id => typeof byId[id].x === 'number' && typeof byId[id].y === 'number');
    if (ok) {
      let sx = 0, sy = 0;
      for (const id of ids) { sx += byId[id].x; sy += byId[id].y; }
      const cx = sx / ids.length, cy = sy / ids.length;
      for (const id of ids) P[id] = [byId[id].x - cx, byId[id].y - cy];
    } else {
      const rr = Math.max(80, Math.sqrt(ids.length) * 48);
      ids.forEach((id, i) => { const a = (i / ids.length) * 2 * Math.PI; P[id] = [Math.cos(a) * rr, Math.sin(a) * rr]; });
    }
    /* 位置式松弛：奇数轮消重叠、偶数轮收连线长度，交替进行，稳定不发散 */
    for (let it = 0; it < 360; it++) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i], b = ids[j], pa = P[a], pb = P[b];
          let dx = pb[0] - pa[0], dy = pb[1] - pa[1];
          let d = Math.sqrt(dx * dx + dy * dy);
          const need = rad[a] + rad[b] + 14;
          if (d >= need) continue;
          if (d < 0.01) { dx = (i % 2 ? 1 : -1) * 1.3; dy = (j % 2 ? 1 : -1) * 1.3; d = Math.sqrt(dx * dx + dy * dy); }
          const push = (need - d) * 0.5 * 0.55;
          dx /= d; dy /= d;
          pa[0] -= dx * push; pa[1] -= dy * push;
          pb[0] += dx * push; pb[1] += dy * push;
        }
      }
      for (const e of inner) {
        const pa = P[e.from], pb = P[e.to]; if (!pa || !pb) continue;
        let dx = pb[0] - pa[0], dy = pb[1] - pa[1];
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = rad[e.from] + rad[e.to] + 26;
        const mv = Math.max(-14, Math.min(14, (d - rest) * 0.14)) * 0.5;
        dx /= d; dy /= d;
        pa[0] += dx * mv; pa[1] += dy * mv;
        pb[0] -= dx * mv; pb[1] -= dy * mv;
      }
      /* 轻微回中，避免整组在松弛中慢慢漂走 */
      let gx = 0, gy = 0;
      for (const id of ids) { gx += P[id][0]; gy += P[id][1]; }
      gx /= ids.length; gy /= ids.length;
      for (const id of ids) { P[id][0] -= gx * 0.03; P[id][1] -= gy * 0.03; }
    }
    /* 收尾再消一遍重叠：把「不重叠」从概率变成硬保证 */
    for (let pass = 0; pass < 30; pass++) {
      let moved = false;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i], b = ids[j], pa = P[a], pb = P[b];
          let dx = pb[0] - pa[0], dy = pb[1] - pa[1];
          let d = Math.sqrt(dx * dx + dy * dy);
          const need = rad[a] + rad[b] + 12;
          if (d >= need) continue;
          if (d < 0.01) { dx = (i % 2 ? 1 : -1) * 1.3; dy = (j % 2 ? 1 : -1) * 1.3; d = Math.sqrt(dx * dx + dy * dy); }
          dx /= d; dy /= d;
          const push = (need - d) * 0.5 + 0.01;
          pa[0] -= dx * push; pa[1] -= dy * push;
          pb[0] += dx * push; pb[1] += dy * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    let R = 0;
    for (const id of ids) { const p = P[id]; R = Math.max(R, Math.sqrt(p[0] * p[0] + p[1] * p[1]) + rad[id]); }
    return { ids, P, rad: R };
  }

  function relLayout() {
    const r = relData();
    if (!r.nodes.length) { toast('还没有节点', 'err'); return; }
    relPushUndo();
    relAutoSize();
    const W = _rel.W, H = _rel.H, ccx = W / 2, ccy = H / 2;
    const byId = {}; for (const n of r.nodes) byId[n.id] = n;
    const rad = {}; for (const n of r.nodes) rad[n.id] = relNodeRadius(n);
    const comps = relComponents(r);
    /* ① 每个连通分量先各自排好（局部坐标） */
    const blocks = comps.map((c, i) => {
      const set = new Set(c.ids);
      const inner = r.edges.filter(e => set.has(e.from) && set.has(e.to));
      const L = relLocalLayout(c.ids, inner, byId, rad);
      L.idx = i;
      return L;
    });
    /* ② 按外接圆从大到小打包：最大的居中，其余在环上找第一个不重叠的落点 */
    blocks.sort((a, b) => (b.rad - a.rad) || (b.ids.length - a.ids.length) || (a.idx - b.idx));
    const GAP = 26, placed = [];
    blocks.forEach((g, i) => {
      if (i === 0) { g.gx = 0; g.gy = 0; placed.push(g); return; }
      const rMin = placed[0].rad + g.rad + GAP + 10;
      const step = Math.max(26, g.rad * 0.62);
      let hit = null;
      for (let s = 0; s < 600 && !hit; s++) {
        const rr = rMin + s * step;
        const cnt = Math.max(8, Math.round((2 * Math.PI * rr) / (2 * g.rad + GAP)));
        const a0 = s * 0.77; // 每往外扩一圈就错开角度，落点分布更均匀
        for (let k = 0; k < cnt; k++) {
          const a = a0 + (k / cnt) * 2 * Math.PI;
          const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
          let clear = true;
          for (const p of placed) {
            if (Math.sqrt((x - p.gx) * (x - p.gx) + (y - p.gy) * (y - p.gy)) < p.rad + g.rad + GAP) { clear = false; break; }
          }
          if (clear) { hit = [x, y]; break; }
        }
      }
      if (!hit) hit = [placed.length * (g.rad * 2 + GAP), 0]; // 兜底（正常不会走到）
      g.gx = hit[0]; g.gy = hit[1];
      placed.push(g);
    });
    /* ③ 落回画布坐标 */
    for (const g of placed) for (const id of g.ids) {
      const nd = byId[id];
      nd.x = ccx + g.gx + g.P[id][0];
      nd.y = ccy + g.gy + g.P[id][1];
    }
    /* ④ 视图自适应：内容比画布大就整体缩小，否则保持 1:1 居中（不做放大会失真） */
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of r.nodes) {
      const rr = rad[n.id];
      minX = Math.min(minX, n.x - rr); maxX = Math.max(maxX, n.x + rr);
      minY = Math.min(minY, n.y - rr); maxY = Math.max(maxY, n.y + rr);
    }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY), pad = 24;
    _rel.k = Math.max(0.12, Math.min(1, (W - pad * 2) / bw, (H - pad * 2) / bh));
    _rel.tx = W / 2 - ((minX + maxX) / 2) * _rel.k;
    _rel.ty = H / 2 - ((minY + maxY) / 2) * _rel.k;
    relPersist('已按关系分组整理：有关系的节点聚成一块，块与块互不重叠' + (blocks.length > 1 ? '（共 ' + blocks.length + ' 组）' : ''));
    relPaint();
  }
  async function relClear() {
    const r = relData();
    if (!r.nodes.length && !r.edges.length) { toast('关系网已为空', 'ok'); return; }
    if (!(await appConfirm('清空关系网', '清空整张关系网？将删除全部节点与连线（不可恢复，请先确认）。'))) return;
    relPushUndo();
    r.nodes = []; r.edges = []; _rel.sel = null;
    relPersist('已清空'); relPaint();
  }

  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    /* 运行记录（RunLog）：把界面层未捕获的异常 / 未处理 Promise 拒绝也持续上报到主进程日志，
     * 遇到报错时即便不弹红字，也会一并进入「运行记录」，方便事后定位。 */
    if (window.api && window.api.runlog && window.api.runlog.write) {
      window.addEventListener('error', (e) => {
        window.api.runlog.write({ level: 'error', msg: '界面异常: ' + (e && e.message || '未知'), meta: { line: e && e.lineno, col: e && e.colno, file: e && e.filename, stack: e && e.error && e.error.stack } });
      });
      window.addEventListener('unhandledrejection', (e) => {
        const r = e && e.reason;
        window.api.runlog.write({ level: 'error', msg: '界面未处理 Promise 拒绝', meta: { stack: (r && (r.stack || r.message)) || String(r) } });
      });
    }
    /* 「AI 处理中」提示：每项 AI 请求的开始/结束由 preload 广播过来（界面只负责显示） */
    if (window.api && window.api.aiStatus && window.api.aiStatus.on) window.api.aiStatus.on(aiBusySet);
    /* 大文件 AI 分析整理进度：浮动进度条 */
    if (window.api && window.api.onImportProgress) window.api.onImportProgress(importProgressSet);
    /* AI 取消完成提示：当某任务被取消后广播过来，清掉繁忙态并明确告知，避免误以为还在执行 */
    if (window.api && window.api.aiCancelled && window.api.aiCancelled.on) window.api.aiCancelled.on((v) => {
      const n = (v && v.hit) || 0;
      if (n > 0) { toast('已取消该 AI 任务', 'ok'); aiBusySet({ on: false }); }
    });
    document.querySelectorAll('#sidebar .nav').forEach(n => n.addEventListener('click', () => {
      const v = n.dataset.view;
      if (!v) return; // 无 data-view 的侧栏按钮（如「AI 对话」「折叠侧栏」）不参与视图切换
      if (v === S.view) return; // 重复点击当前视图不整体重建（数据刷新走显式 switchView，不受影响）
      if (window.api && window.api.runlog && window.api.runlog.write) window.api.runlog.write({ level: 'info', msg: '进入界面：' + v });
      switchView(v);
    }));
    q('themeSelect').addEventListener('change', () => setTheme(q('themeSelect').value));
    q('btnBackup').addEventListener('click', doBackup);
    q('btnFolder').addEventListener('click', openFolder);
    q('btnChatToggle').addEventListener('click', () => openChat());
    q('btnChatClose').addEventListener('click', () => openChat(false));
    q('btnSidebarToggle').addEventListener('click', () => toggleSidebar());
    /* 全局快捷键：Ctrl+K 命令面板 / Ctrl+Shift+F 全局搜索 / Ctrl+N 新建卡片 / Ctrl+D 骰娘 / Esc 关闭浮层 */
    document.addEventListener('keydown', (e) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openGlobalSearch(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
      if (inField) { if (e.key === 'Escape') { e.target.blur(); } return; }
      if (e.altKey && !e.ctrlKey && (e.key === 'ArrowLeft')) { e.preventDefault(); navBack(); return; }
      if (e.altKey && !e.ctrlKey && (e.key === 'ArrowRight')) { e.preventDefault(); navForward(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        if (KINDS.includes(S.view)) add(S.view);
        else if (S.view === 'relations') relAddNode();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); switchView('dice'); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); switchView('encounter'); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); switchView('stats'); return; }
      if (e.key === 'Escape') { if (!q('gSearchMask').hidden) closeGlobalSearch(); else closePalette(); }
    });
    const palIn = q('palIn'), palList = q('palList'), palMask = q('paletteMask');
    if (palIn) {
      palIn.addEventListener('input', () => { _palIdx = 0; S._palQuery = palIn.value; _paintPal(); });
      palIn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); _palIdx++; _paintPal(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); _palIdx--; _paintPal(); }
        else if (e.key === 'Enter') { e.preventDefault(); _palPick(); }
      });
      palList.addEventListener('click', (ev) => {
        const item = ev.target.closest('.pal-item'); if (!item) return;
        _palIdx = parseInt(item.dataset.i, 10); _palPick();
      });
    }
    if (palMask) palMask.addEventListener('click', (ev) => { if (ev.target === palMask) closePalette(); });
    /* 全局搜索浮层：输入实时过滤 / ↑↓选择 / Enter 跳转 / Esc 关闭 / 点击遮罩关闭 */
    const gIn = q('gSearchIn'), gList = q('gSearchList'), gMask = q('gSearchMask');
    if (gIn) {
      gIn.addEventListener('input', () => { _gIdx = 0; _gPaint(gIn.value); });
      gIn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); _gIdx++; _gPaint(gIn.value); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); _gIdx--; _gPaint(gIn.value); }
        else if (e.key === 'Enter') { e.preventDefault(); _gPick(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeGlobalSearch(); }
      });
    }
    if (gList) gList.addEventListener('click', (ev) => {
      const item = ev.target.closest('.pal-item'); if (!item) return;
      _gIdx = parseInt(item.dataset.i, 10); _gPick();
    });
    if (gMask) gMask.addEventListener('click', (ev) => { if (ev.target === gMask) closeGlobalSearch(); });
    /* 无边框窗口控制 */
    q('wcMin').addEventListener('click', () => window.api.winCtrl.minimize());
    q('wcMax').addEventListener('click', () => window.api.winCtrl.toggleMax());
    q('wcClose').addEventListener('click', () => window.api.winCtrl.close());
    if (window.api.winCtrl.onMaximized) {
      window.api.winCtrl.onMaximized((m) => { q('wcMax').textContent = m ? '❐' : '▢'; });
      window.api.winCtrl.isMaximized().then((r) => { if (r && r.maximized) q('wcMax').textContent = '❐'; }).catch(() => {});
    }
    q('drawerSend').addEventListener('click', () => aiSend());
    q('drawerUpload').addEventListener('click', aiUpload);
    q('drawerExport').addEventListener('click', aiExportLast);
    q('drawerIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); } });
    /* 侧栏「自动建卡」控件：结合上方对话生成 / 把最近回复建为资料卡 */
    const dgt = q('drawerGenType');
    if (dgt) dgt.addEventListener('change', () => { S.aiGenType = dgt.value; });
    if (q('drawerGenBuild')) q('drawerGenBuild').addEventListener('click', () => { if (dgt) S.aiGenType = dgt.value; aiGenForType(); });
    if (q('drawerImportLast')) q('drawerImportLast').addEventListener('click', () => aiImportLast());
    const dp = q('drawerPlot'); if (dp) dp.addEventListener('click', () => plotSummary());
    const dsg = q('drawerSuggest'); if (dsg) dsg.addEventListener('click', storySuggest);
    /* 侧栏「剧本解析」（已并入抽屉） */
    if (q('drawerScriptBtn')) q('drawerScriptBtn').addEventListener('click', () => toggleDrawerScript());
    if (q('drawerScriptImport')) q('drawerScriptImport').addEventListener('click', () => scriptImportFile());
    if (q('drawerScriptParse')) q('drawerScriptParse').addEventListener('click', () => doParse());
    if (q('drawerScriptText')) q('drawerScriptText').addEventListener('input', (e) => { S.scriptText = e.target.value; autosize(e.target); });
    /* 输入框自适应：任何 .autoarea 文本框随内容自动伸缩 */
    document.addEventListener('input', (e) => { autosize(e.target); });
    installDrop();
    installInputGuard();
    init();
  });
  /* 全局文件拖拽导入：把文件拖入窗口即可打开对应资料页的导入面板并自动解析 */
  function installDrop() {
    const overlay = q('dropOverlay');
    const isOpen = () => !q('modalMask').hidden;
    let dart = 0;
    const kindForDrop = () => (KINDS.includes(S.view) ? S.view : (S.view === 'rawtext' ? 'rawtext' : 'npcs'));
    /* 仅当拖入的是「外部文件」才弹导入浮层并接管 drop；应用内的卡片/元素拖动（如看板排序）
     * 一律放行，彻底消除“卡片一拖动就冒出‘松开以导入文件’浮层、排序失效”的冲突。
     * 判定依据：外部文件拖入时 dataTransfer.types 含 'Files'；内部元素拖动为 'text/plain' 等。 */
    const isFileDrag = (e) => {
      const d = e.dataTransfer; if (!d) return false;
      try { return Array.prototype.slice.call(d.types || []).indexOf('Files') !== -1; } catch (_) { return false; }
    };
    window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (!overlay || !isFileDrag(e)) return;
      overlay.hidden = false;
      window.clearTimeout(dart);
    });
    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      if (!overlay || !isFileDrag(e)) return;
      window.clearTimeout(dart);
      dart = window.setTimeout(() => { overlay.hidden = true; }, 120);
    });
    q('dropOverlay').addEventListener('dragleave', () => { overlay.hidden = true; });
    q('dropOverlay').addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      if (!isFileDrag(e)) return;                 // 非文件拖动：不拦截，让卡片排序等内部 drop 正常执行
      e.preventDefault();
      if (overlay) overlay.hidden = true;
      const dt = e.dataTransfer;
      let files = [];
      try { files = Array.prototype.slice.call((dt && dt.files) || []); } catch (_) {}
      if (!files.length) return;
      const kind = kindForDrop();
      const texts = files.filter(f => !/^(image|video|audio)/i.test(f.type || (f.name && f.name.split('.').pop())));
      if (!texts.length) { toast('暂不支持导入图片/音视频，请拖入文本或文档类文件', 'err'); return; }
      if (isOpen() && q('impFile')) { await fillImport(texts); toast('已把拖入的文件加入导入面板', 'ok'); return; }
      if (kind === 'rawtext') { await rawImportFiles(texts); return; }
      await importContent(kind, texts);
    });
  }

  /* ===== 运行时输入守卫：无论 CSS/覆盖层/user-select 如何，输入框永远可点可写 =====
   * 兜底策略：捕获阶段拦截 focus，强制把所在输入框复位为可写、可聚焦、可选中文本；
   * 并用 MutationObserver 监听并守护所有新增的 input/textarea/select，杜绝“打不了字”。 */
  function installInputGuard() {
    const rescue = (el) => {
      if (!el) return;
      try {
        el.style.userSelect = el.style.userSelect === 'none' ? 'text' : el.style.userSelect;
        el.style.webkitUserSelect = el.style.webkitUserSelect === 'none' ? 'text' : el.style.webkitUserSelect;
        el.style.pointerEvents = 'auto';
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          if (el.hasAttribute('disabled')) el.removeAttribute('disabled');
          if (el.hasAttribute('readonly') && el.dataset.forceEditable) el.removeAttribute('readonly');
        }
      } catch (_) {}
    };
    document.addEventListener('focusin', (e) => { const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
      rescue(t);
      let p = t.parentElement; while (p && p !== document.body) {
        try { if (getComputedStyle(p).userSelect === 'none') p.style.userSelect = 'text'; } catch (_) {}
        p = p.parentElement;
      }
    } }, true);
    const guard = () => { const els = document.querySelectorAll('input, textarea, select'); for (let i = 0; i < els.length; i++) rescue(els[i]); };
    guard();
    const mo = new MutationObserver((muts) => { for (const m of muts) if (m.type === 'childList' && m.addedNodes.length) { guard(); return; } });
    try { mo.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
  }
  async function init() {
    if (!window.api) { contentInner('<div class="empty">需要 Electron 环境运行（请直接打开 EXE）</div>'); return; }
    try {
      const r = await window.api.getAll();
      S.data = r.data; S.fields = r.fields; S.settings = r.settings || {}; S.profiles = r.profiles || [];
      S.activeProfile = r.activeProfile; S.meta = r.meta || {};
      S.rawText = (r.data && typeof r.data.rawText === 'string') ? r.data.rawText : '';
      S.rawSuggested = (r.data && typeof r.data.rawSuggested === 'string') ? r.data.rawSuggested : '';
      S.rawScript = (r.data && r.data.rawScript) ? r.data.rawScript : null;
      if (!Array.isArray(S.data.maps)) S.data.maps = [];
      if (Array.isArray(S.settings.chat)) CH.push(...S.settings.chat.slice(-CH_CAP)); // 恢复侧栏对话历史
      if (!S.settings.theme) S.settings.theme = 'ember';
      applyTheme(S.settings.theme, true);
      applySidebar();
      updateTopProfile(); updateDrawerProfile();
      // 档案操作事件委托：数据放在 data-ar（已转义），避免档案名含引号时破坏内联 onclick
      document.addEventListener('click', (ev) => {
        const b = ev.target.closest && ev.target.closest('button[data-ar]');
        if (!b) return;
        const name = b.dataset.ar;
        if (b.hasAttribute('data-open')) switchArchive(name);
        else if (b.hasAttribute('data-dup')) dupArchive(name);
        else if (b.hasAttribute('data-del')) delArchive(name);
      });
      if (S.settings.chatOpen) openChat(true);
      switchView('dash');
      setTimeout(() => maybeOnboard(), 600);
      /* 同步一次主进程当前更新状态：清理跨启动残留的瞬时状态，并提示上次未完成的更新 */
      if (window.api.updater && window.api.updater.status) {
        try {
          const st = await window.api.updater.status();
          const up = (S.settings.updates = S.settings.updates || {});
          if (st && st.lastApplyFailed && st.lastApplyFailed.version && up._warnedFor !== st.lastApplyFailed.version) {
            up._warnedFor = st.lastApplyFailed.version;
            setTimeout(() => toast('上次更新 v' + st.lastApplyFailed.version + ' 未完成，可在「更新公告」页重新检查更新', 'err'), 1600);
          }
          /* 暂存包与下载态只存在于主进程内存，不跨启动；此处归零避免出现点不动的「重启更新」 */
          if (['staged', 'available', 'progress', 'applying', 'checking'].indexOf(up.state) >= 0) {
            up.state = 'idle'; up.percent = 0; up.received = 0; up.total = 0; up._prompted = false;
          }
          persist();
        } catch (_) {}
      }
      /* 订阅主进程推送的更新状态（检测/进度/就绪/出错），实时反映到「更新公告」页；
       * 检测到新版本且允许自动下载时，自动开始下载；下载就绪后弹窗询问是否立即重启更新。 */
      if (window.api.updater && window.api.updater.state) {
        window.api.updater.state((v) => {
          try {
            if (!S.settings.updates) S.settings.updates = {};
            const up = S.settings.updates;
            const st = v && v.state;
            if (st === 'checking') up.state = 'checking';
            else if (st === 'none') up.state = 'none';
            else if (st === 'available') {
              up.state = 'available'; up._prompted = false;
              up.latest = v.latest || up.latest; up.tag = v.tag || up.tag;
              up.publishedAt = v.publishedAt || up.publishedAt; up.notes = v.notes || up.notes;
            } else if (st === 'progress') {
              up.state = 'progress';
              if (typeof v.percent === 'number') up.percent = v.percent;
              up.received = v.received; up.total = v.total; if (v.notice) up.notice = v.notice;
            } else if (st === 'staged') {
              up.state = 'staged'; up.latest = v.latest || up.latest; up.percent = 100; up.notice = '';
            } else if (st === 'applying') {
              up.state = 'applying'; up.notice = v.notice || '正在更新，应用即将自动重启…';
            } else if (st === 'err') {
              up.state = 'err'; up.error = v.error || '未知错误';
            }
            if (v.modeLabel) up.modeLabel = v.modeLabel;
            if (typeof v.canAutoApply === 'boolean') up.canAutoApply = v.canAutoApply;
            persist();
            if (S.view === 'changelog') renderChangelog();
            if (st === 'available' && up.autoDownload !== false && up.state === 'available') startUpdateDownload();
            if (st === 'staged') onUpdateStaged(v.latest);
          } catch (_) {}
        });
      }
    } catch (e) {
      contentInner('<div class="empty">加载失败：' + esc(e.message || e) + '</div>');
    }
  }
})();