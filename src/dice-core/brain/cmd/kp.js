// src/dice-core/brain/cmd/kp.js —— 指令④：工作台数据增删查改（经 WorkspaceDataPort）
'use strict';

const { registerCmd } = require('../registry');

const KINDS = ['pcs', 'npcs', 'regions', 'logs', 'mobs'];
const KIND_ALIAS = { pc: 'pcs', npc: 'npcs', region: 'regions', log: 'logs', mob: 'mobs' };
const normKind = k => KIND_ALIAS[k] || k;
const HELP = [
  '.kp list <类型>        查看档案列表（pcs/npcs/regions/logs/mobs）',
  '.kp get <类型> <名称>  查看单条档案',
  '.kp add <类型> <名称> [字段=值 …]  新增档案',
  '.kp set <类型> <名称> [字段=值 …]  修改档案',
  '.kp rm <类型> <名称>   删除档案',
  '.kp audit             最近操作审计',
  '.kp help              本帮助'
].join('\n');

const isAdmin = ctx => {
  const role = ctx && ctx.sender && ctx.sender.role;
  return role === 'owner' || role === 'admin';
};
const parsePairs = args => {
  const out = {};
  for (const a of args) {
    const i = a.indexOf('=');
    if (i > 0) out[a.slice(0, i)] = a.slice(i + 1);
  }
  return out;
};

async function handle(ctx, args) {
  const ws = ctx.data && ctx.data.workspace;
  const [sub, ...rest] = args;
  if (!sub || sub === 'help') return { text: HELP };
  if (sub === 'audit') {
    const r = ws.audit();
    if (!r.ok) return { text: '审计读取失败：' + r.error };
    const lines = r.items.slice(0, 10).map(a => a.t + ' ' + a.op + ' ' + a.kind + ' ' + (a.name || ''));
    return { text: '最近操作：\n' + (lines.join('\n') || '（暂无记录）') };
  }
  const kind = normKind(rest[0]);
  if (sub !== 'list' && sub !== 'get' && sub !== 'add' && sub !== 'set' && sub !== 'rm') return { text: HELP };
  if (!KINDS.includes(kind)) return { text: '未知档案类型「' + kind + '」，可用：' + KINDS.join(' / ') };
  if (sub === 'list') {
    const r = ws.list(kind);
    if (!r.ok) return { text: '读取失败：' + r.error };
    const names = r.items.map(x => x.name || x.title || x.id).filter(Boolean);
    return { text: '「' + kind + '」共 ' + r.items.length + ' 条：\n' + (names.join('\n') || '（空）') };
  }
  if (sub === 'get') {
    const key = rest[1];
    if (!key) return { text: '用法：.kp get <类型> <名称>' };
    const r = ws.get(kind, key);
    if (!r.ok) return { text: '读取失败：' + r.error };
    if (!r.item) return { text: '「' + kind + '」中没有「' + key + '」' };
    const fields = Object.entries(r.item).filter(([k]) => k !== 'id')
      .map(([k, v]) => k + '：' + v).join('\n');
    return { text: '「' + (r.item.name || key) + '」\n' + fields };
  }
  // 以下为写操作：仅 owner/admin，改完由端口 onMutate 触发界面刷新事件
  if (!isAdmin(ctx)) return { text: '没有权限：只有主持人与管理员可以修改工作台数据' };
  const key = rest[1];
  if (sub === 'add') {
    if (!key) return { text: '用法：.kp add <类型> <名称> [字段=值 …]' };
    const item = Object.assign({ name: key, at: 'kp指令' }, parsePairs(rest.slice(2)));
    const r = ws.create(kind, item);
    if (!r.ok) return { text: '添加失败：' + r.error };
    return { text: '已添加：' + (r.item.name || key) + '（' + kind + '）' };
  }
  if (sub === 'set' || sub === 'rm') {
    if (!key) return { text: '用法：.kp ' + sub + ' <类型> <名称> [字段=值 …]' };
    const found = ws.get(kind, key);
    if (!found.ok) return { text: '查找失败：' + found.error };
    if (!found.item) return { text: '「' + kind + '」中没有「' + key + '」' };
    if (sub === 'rm') {
      const r = ws.remove(kind, key);
      if (!r.ok) return { text: '删除失败：' + r.error };
      return { text: '已删除：' + key + '（' + kind + '）' };
    }
    const r = ws.update(kind, key, Object.assign(parsePairs(rest.slice(2)), { at: 'kp指令' }));
    if (!r.ok) return { text: '修改失败：' + r.error };
    return { text: '已更新：' + (r.item.name || key) };
  }
  return { text: HELP };
}

module.exports = registerCmd({ name: 'kp', alias: ['工作台'], group: '④工作台联动', handle });
