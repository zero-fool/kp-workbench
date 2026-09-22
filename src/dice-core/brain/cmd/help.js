'use strict';
/* 指令 help：指令帮助 */

const { getCommand, listCommands, registerCmd } = require('../registry');

const CMD_HELP = {
  r: '.r <表达式>：掷骰。支持 NdM、kh/kl、爆炸 !、双骰 b、隐骰 h，如 .r 2d6+3 / .r 2d20kh1 / .r 1d6! / .r 1d6b / .r 1d100h',
  rh: '.rh <表达式>：隐骰，结果保密只留记录，如 .rh 1d100',
  ra: '.ra <技能名> [技能值] [难度]：CoC 检定，难度 普通/困难/极难/极限，如 .ra 侦查 60 困难',
  rd: '.rd [表达式] [DC] [adv|dis]：DnD 检定，如 .rd 15、.rd 2d20kh1+3 15、.rd 15 adv',
  st: '.st 录入 <人物名> <字段=值 ...> / .st 查询 [人物名] / .st 绑定 <人物名> / .st 列表 / .st 当前：人物卡管理',
  help: '.help [指令名]：查看全部指令或某条指令的用法'
};

module.exports = registerCmd({
  name: 'help', alias: ['帮助'], group: 'core',
  handle(ctx, args) {
    if (args[0]) {
      const c = getCommand(args[0]);
      if (!c) throw new Error(`没有「${args[0]}」这条指令`);
      return { text: CMD_HELP[c.name] };
    }
    const lines = listCommands().map(c => CMD_HELP[c.name]).filter(Boolean);
    return { text: '可用指令（前缀 . 或 。）：\n' + lines.join('\n') };
  }
});