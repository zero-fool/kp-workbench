'use strict';
/* brain/cmd：指令装配。require 即完成注册。
 * 分组：core=骰点/检定/人物卡基础，fun=娱乐/扩展，admin=设置与管理，ws=工作台联动。
 * 新增模块对齐 Dice-Next 的可回答指令集（骰点/检定、人物卡、设置、娱乐、平台管理）。 */

require('./r');
require('./rh');
require('./ra');
require('./ra-bonus');
require('./rd');
require('./check-adv');
require('./coc-adv');
require('./dnd-adv');
require('./st');
require('./card');
require('./help');
require('./init');
require('./ri');
require('./jrrp');
require('./sign');
require('./drew');
require('./draw');
require('./deck');
require('./fun-adv');
require('./custom');
require('./log');
require('./admin');
require('./set');
require('./setting-adv');
require('./platform');
require('./master');
require('./kp');
require('./ai');

module.exports = {
  core: ['r', 'rh', 'ra', 'rab', 'rap', 'rd', 'rav', 'rcv', 'rx', 'ba', 'bav', 'ww', 'dx', 'rdx', 'rdc', 'sc', 'en', 'st', 'pc', 'npc', 'ri', 'init', 'help', 'helpdoc'],
  fun: ['jrrp', 'sign', 'drew', 'draw', 'deck', 'ti', 'li', 'nn', 'nnn', 'sn', 'coc', 'dnd', 'name', 'gn', 'me', 'ak', 'sleep', 'gacha', 'favor', 'hiy', 'ob', 'ss', 'cast', 'longrest', 'ds', 'buff'],
  admin: ['custom', 'log', 'admin', 'set', 'setcoc', 'setdnd', 'setsn', 'rpmode', 'rules', 'ruleset', 'lang', 'text', 'reply', 'welcome', 'bot', 'trust', 'user', 'group', 'alias', 'bind', 'info', 'cloud', 'notice', 'plugin', 'system', 'send', 'dismiss', 'game', 'mod', 'link', 'str', 'strSelfName', 'strSelfCall', 'boton', 'botoff', 'blackqq', 'whiteqq', 'blackgroup', 'whitegroup', 'master'],
  ws: ['kp', 'ai']
};
