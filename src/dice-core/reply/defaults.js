'use strict';
// 骰娘默认文案库（原创模板，用户可在界面分区 4 编辑并导出/导入）
const DEFAULT_PERSONA = { name: '骰娘', style: 'neutral', prefix: '' };

const DEFAULT_TEMPLATES = {
  'jrrp.result': '{name} 的今日运势是 {luck}（{score}/100）{comment}',
  'jrrp.luck.0': '大吉', 'jrrp.luck.1': '中吉', 'jrrp.luck.2': '小吉', 'jrrp.luck.3': '凶', 'jrrp.luck.4': '大凶',
  'jrrp.comment.0': '，骰运正盛，放手推进剧情吧。',
  'jrrp.comment.1': '，稳扎稳打更顺手。',
  'jrrp.comment.2': '，小有波折但无大碍。',
  'jrrp.comment.3': '，关键时刻记得留个幸运点。',
  'jrrp.comment.4': '，今天适合在安全屋里喝杯热茶。',
  'sign.ok': '{name} 签到成功，连续 {days} 天，好感度 {favor}',
  'sign.repeat': '{name} 今天已经签过到啦，明天再来',
  'sign.favor': '好感度提升 {delta} 点，现在是 {favor}',
  'drew.empty': '{name} 这张事件表还没有内容，先在工作台里加几条吧',
  'drew.result': '{name} 抽到了事件表「{table}」：{item}',
  'admin.denied': '抱歉 {name}，这条指令需要更高的权限',
  'admin.granted': '已更新 {target} 的权限为 {role}',
  'admin.list': '当前会话权限名单：{list}',
  'set.saved': '会话设置已保存：{summary}',
  'custom.created': '自定义指令「{trigger}」已生效',
  'custom.duplicated': '触发词「{trigger}」已被占用，换一个试试',
  'log.empty': '这个会话还没有投骰记录',
  'log.line': '{time} {name}：{cmd} → {result}',
  'common.error': '这一掷出了点小状况：{reason}，指令仍然可用',
  'help.header': '骰娘 {version} 指令表：',
};

module.exports = { DEFAULT_TEMPLATES, DEFAULT_PERSONA };