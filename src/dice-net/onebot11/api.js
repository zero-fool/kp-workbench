'use strict';
function segToOb(s) {
  if (s.type === 'text') return { type: 'text', data: { text: s.text } };
  if (s.type === 'image') return { type: 'image', data: { file: s.file } };
  throw new TypeError('unsupported segment: ' + s.type);
}
function planApiCalls(sessionId, reply) {
  if (!Array.isArray(reply.segments) || reply.segments.length === 0) throw new TypeError('segments 不能为空');
  const m = /^onebot11:(.+)$/.exec(sessionId);
  if (!m) throw new TypeError('sessionId 不属于 onebot11: ' + sessionId);
  const tail = m[1];
  const isGroup = !tail.startsWith('private:');
  const message = [];
  if (reply.at) message.push({ type: 'at', data: { qq: String(reply.at) } });
  for (const s of reply.segments) message.push(segToOb(s));
  return [{
    action: isGroup ? 'send_group_msg' : 'send_private_msg',
    params: isGroup ? { group_id: Number(tail), message } : { user_id: Number(tail.slice(8)), message },
  }];
}
module.exports = { planApiCalls };
