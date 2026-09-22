'use strict';
/* brain/registry：指令注册表。
 * 固定导出名：registerCmd({name, alias, group, handle}) */

const commands = new Map(); // 名字/别名 -> 指令定义

function registerCmd(cmd) {
  if (!cmd || typeof cmd.name !== 'string' || !cmd.name) throw new TypeError('registerCmd 需要 {name, ...}');
  if (typeof cmd.handle !== 'function') throw new TypeError(`指令 ${cmd.name} 缺少 handle 函数`);
  const prev = commands.get(cmd.name);
  if (prev) {
    commands.delete(prev.name);
    for (const a of prev.alias) commands.delete(a);
  }
  const c = {
    name: cmd.name,
    alias: Array.isArray(cmd.alias) ? cmd.alias : [],
    group: cmd.group || 'core',
    handle: cmd.handle
  };
  commands.set(cmd.name, c);
  for (const a of c.alias) commands.set(a, c);
  return c;
}
function getCommand(name) { return commands.get(name) || null; }
function listCommands() { return [...new Set(commands.values())]; }
function resetRegistry() { commands.clear(); }

module.exports = { registerCmd, getCommand, listCommands, resetRegistry };