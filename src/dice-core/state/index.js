'use strict';
// 骰娘 state 门面：users(好感/签到) logs(投骰记录) sessions(会话设置) persona(人设与文案元信息)
function createStateBox(init) {
  const data = init
    ? { logs: init.logs, persona: init.persona, sessions: init.sessions, users: init.users }
    : { logs: [], persona: { name: '骰娘', style: 'neutral' }, sessions: {}, users: {} };
  if (init) {
    if (typeof data.users !== 'object' || Array.isArray(data.users)) throw new TypeError('users 必须是对象');
    if (!Array.isArray(data.logs)) throw new TypeError('logs 必须是数组');
  }
  return {
    serialize() {
      return { logs: data.logs, persona: data.persona, sessions: data.sessions, users: data.users };
    },
    users: data.users,
    logs: data.logs,
    sessions: data.sessions,
    persona: data.persona,
  };
}
module.exports = { createStateBox };