'use strict';
/* brain 门面：CommandBrain + 指令注册表 + 指令行解析 + 会话状态 + 文案渲染。
 * require('./cmd') 会完成指令①核心组注册（副作用）。 */

const { CommandBrain, sessionIdOf, recordRoll, boundCard, friendlyError } = require('./CommandBrain');
const { registerCmd, getCommand, listCommands, resetRegistry } = require('./registry');
const { parseCommand, splitArgs } = require('./parser');
const { createStateStore, newSession } = require('./state');
const { renderRoll, renderProcess } = require('./render');
require('./cmd');

module.exports = {
  CommandBrain, sessionIdOf, recordRoll, boundCard, friendlyError,
  registerCmd, getCommand, listCommands, resetRegistry,
  parseCommand, splitArgs,
  createStateStore, newSession,
  renderRoll, renderProcess
};