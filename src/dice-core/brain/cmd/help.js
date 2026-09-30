'use strict';
/* 指令 help：指令帮助（覆盖 Dice-Next 兼容的全部可回答指令） */

const { getCommand, listCommands, registerCmd } = require('../registry');

const CMD_HELP = {
  r: '.r [表达式]：掷骰。省略表达式则掷「默认骰」，.r+3 / .r-5 为默认骰修正。支持 NdM、kh/kl、爆炸 !、双骰 b、隐骰 h，如 .r 2d6+3 / .rd100睡觉 / .r 3#1d6',
  rh: '.rh [表达式]：隐骰，结果保密只留记录；省略表达式则掷「默认骰」，如 .rh 1d100、.rh+3',
  ra: '.ra <技能名> [技能值] [难度]：CoC 检定，难度 普通/困难/极难/极限，如 .ra 侦查 60 困难',
  rab: '.rab <技能名> [技能值] [奖励骰数]：CoC 奖励骰（别名 .rb），如 .rab 侦查 60',
  rap: '.rap <技能名> [技能值] [惩罚骰数]：CoC 惩罚骰（别名 .rp），如 .rap 侦查 60',
  rd: '.rd [表达式] [DC] [adv|dis]：DnD 检定，如 .rd 15、.rd 15 adv；.rd±n 为默认骰修正',
  rav: '.rav <甲> <乙>：对抗检定（别名 .rcv），双方各掷 1d100 按分档比高低，如 .rav 侦查 聆听',
  rx: '.rx [目标] [心理学值]：心理学暗骰，结果仅 KP 可见',
  ba: '.ba <技能|数值> [成功率] [原因]：BRP 检定（别名 .brp）',
  bav: '.bav <主动> <被动>：BRP 抵抗表对抗，如 .bav 力量 敏捷',
  ww: '.ww <骰数>a<加骰线>c<成功线>+<加值>：骰池（别名 .骰池），如 .ww 10a10c8+2',
  dx: '.dx <骰数> [暴击线] [±修正]：双十字取最高（别名 .rdx），如 .dx 10c9',
  rdc: '.rdc <属性|技能> [DC] [adv|dis]：DnD 检定，d20 + 属性调整值（取绑定人物卡），如 .rdc 力量、.rdc 3#隐匿（别名 .dndcheck）',
  sc: '.sc <成功损失>/<失败损失>：理智检定（别名 .理智），如 .sc 1/1d6',
  en: '.en <技能名> [当前值] [成长骰]：技能成长检定（别名 .成长）；支持 .en 侦查 聆听 批量、.en 侦查+1D3/1D10 指定成长骰',
  ti: '.ti：临时疯狂症状（1d10 轮，别名 .临时疯狂）',
  li: '.li：长期疯狂症状（1d10 小时，别名 .长期疯狂）',
  st: '.st 录入 <人物名> <字段=值 ...> / .st 查询 [人物名] / .st 绑定 <人物名> / .st 列表 / .st 当前：人物卡管理',
  pc: '.pc [list|new <名>|show <名>|bind <名>|del <名>|stat [技能]]：PC 玩家卡管理',
  npc: '.npc [list|new <名>|show <名>|del <名>]：NPC 卡管理',
  ri: '.ri [表达式|±n] [名称]：掷先攻并加入先攻列表，如 .ri、.ri +3、.ri 2d6+1 阿琳',
  init: '.init / .init del <名称|序号> / .init next / .init set <名称> <值> / .init clr：先攻列表管理',
  help: '.help [指令名]：查看全部指令或某条指令的用法',
  helpdoc: '.helpdoc [关键词]：帮助文档检索',
  jrrp: '.jrrp [QQ号]：今日人品/运势',
  sign: '.sign：每日签到，累计天数与好感度',
  drew: '.drew [表名]：抽取工作台的随机事件表',
  draw: '.draw [牌组名]：从牌堆抽一张（不放回）',
  deck: '.deck list / .deck show <牌组名> / .deck reset [牌组名]：牌堆查看与洗牌',
  nn: '.nn <新名>：给自己改名（别名 .改名）',
  nnn: '.nnn [种子]：随机给自己改名（别名 .随机改名）',
  sn: '.sn [新名|off]：设置群名片（别名 .群名片）',
  coc: '.coc [人物名]：随机生成一张 CoC 7th 人物卡',
  dnd: '.dnd [人物名]：随机生成一张 DnD 5e 人物卡',
  name: '.name [en]：随机起名（别名 .起名）；.gn 同',
  gn: '.gn：随机起名（同 .name）',
  me: '.me <动作>：第三人称动作描述，如 .me 端起酒杯',
  ak: '.ak <选项1> <选项2> ...：抉择分歧，随机挑一个（别名 .抉择）',
  sleep: '.sleep：小憩，恢复人物卡生命（别名 .休息）',
  gacha: '.gacha [卡池]：抽卡（别名 .抽卡）',
  favor: '.favor [对象] [+n]：好感度查询/增减（别名 .好感）',
  hiy: '.hiy [技能]：本会话检定统计（别名 .打招呼）',
  ob: '.ob join|exit|list / .ob on|off（群管）/ .ob clr（群管）：旁观名单管理（别名 .旁观）',
  ss: '.ss [环位] [±n] / .ss init 4 3 2：DnD 法术位查看/消耗/恢复/初始化（别名 .法术位）',
  cast: '.cast <法术名> [环位]：施法并消耗法术位，环位可写 3 或 3环（别名 .施法）',
  longrest: '.longrest：长休，生命回满、法术位全恢复（别名 .长休）',
  ds: '.ds [reset]：死亡豁免 1d20（别名 .死亡豁免）',
  buff: '.buff list|show|add <状态> [轮]|<属性> ±<值>|del <状态>|clr：状态增益（别名 .状态）',
  setcoc: '.setcoc [0-7|show|clr]：CoC 房规切换（别名 .房规）',
  setdnd: '.setdnd on|off：DND 模式开关（别名 .dnd模式）',
  setsn: '.setsn [模板|off]：群名片模板（别名 .名片模板）',
  rpmode: '.rpmode [人格名|list]：人格切换（别名 .人格）',
  rules: '.rules [id]：规则包列出/切换（别名 .规则）',
  ruleset: '.ruleset [id]：规则包管理（别名 .规则包）',
  lang: '.lang [语言]：文案语言（别名 .语言）',
  text: '.text <内容>：原样回一段文本（别名 .文本）',
  reply: '.reply list|add <触发词> <回复>|del <触发词>：自定义回复管理（别名 .回复）',
  welcome: '.welcome [文本|off]：入群欢迎语（别名 .欢迎语）',
  bot: '.bot on|off：机器人开关（别名 .机器人）',
  trust: '.trust [用户号] [0-5]：信任等级（别名 .信任）',
  user: '.user list|info [用户号]|ban|unban <用户号>：用户管理（别名 .用户）',
  group: '.group on|off：群功能开关（别名 .群）',
  alias: '.alias [别名 主号]|list：账号别名（别名 .账号别名）',
  bind: '.bind [标识]|off：身份绑定（别名 .身份绑定）',
  info: '.info：机器人信息（别名 .信息）',
  cloud: '.cloud：云服务状态（别名 .云）',
  notice: '.notice list|add <文本>|clr：通知窗口（别名 .通知）',
  plugin: '.plugin list|on|off <插件名>：插件启停（别名 .插件）',
  system: '.system info|stats：系统信息/统计（别名 .系统）',
  send: '.send <文本>：发送一段文本（别名 .发送）',
  dismiss: '.dismiss：停用/解散本群服务（别名 .解散）',
  game: '.game list|new <团名>|info <团名>：团务管理（别名 .团务）',
  mod: '.mod list|load <模组名>：模组管理（别名 .模组）',
  link: '.link <目标窗口>：跨窗口链接（别名 .链接）',
  str: '.str<键名> [新文案|reset|NULL]：自定义内置文案，如 .strRollDice show / .strRollDice reset（别名 .文案）',
  custom: '.custom add <触发词> | <回复模板> / .custom del <触发词> / .custom list：自定义指令',
  log: '.log [条数]：查看最近投骰记录',
  admin: '.admin ...：权限名单管理',
  set: '.set（无参查看） / set d <默认骰>|off / set <面数> / set prefix <符号> / set fullwidth on|off / set fun|admin|ai on|off',
  kp: '.kp list|get|add|set|rm <类型> ...：工作台数据管理',
  ai: '.ai ...：AI 增强开关与配置'
};

module.exports = registerCmd({
  name: 'help', alias: ['帮助'], group: 'core',
  handle(ctx, args) {
    // Dice-Next 兼容：.help on|off 开关「随时帮助提示」。
    const a0 = (args[0] || '').toLowerCase();
    if (a0 === 'on' || a0 === 'off') {
      const s = ctx.session;
      s.settings = s.settings || { prefix: '.', fullwidth: true, switches: {} };
      s.settings.switches = s.settings.switches || {};
      s.settings.switches.helpTip = a0 === 'on';
      return { text: `帮助提示已${a0 === 'on' ? '开启' : '关闭'}（发送 .help [指令名] 可随时查用法）` };
    }
    if (args[0]) {
      const c = getCommand(args[0]);
      if (!c) throw new Error(`没有「${args[0]}」这条指令`);
      return { text: CMD_HELP[c.name] || `「${c.name}」：暂未收录帮助，可发送 .${c.name} 直接尝试` };
    }
    const lines = listCommands().map(c => CMD_HELP[c.name]).filter(Boolean);
    return { text: '可用指令（前缀 . 或 。）：\n' + lines.join('\n') };
  }
});
