'use strict';
/* 分区 6 测试通道聊天窗。消息模型 { who:'user'|'bot', text }。
 * buildMessageIn 产出的 MessageIn 与 ports 契约逐字一致（channel 固定 'sim'）。
 * UMD：Node 用 require 测试，浏览器用 window.DiceUISimChat。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiceUISimChat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderBubble(m) {
    const cls = m.who === 'user' ? 'dice-bubble-user' : 'dice-bubble-bot';
    return `<div class="${cls}"><p>${esc(m.text)}</p></div>`;
  }

  function buildMessageIn(text, userId, userName) {
    return {
      id: `sim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      channel: 'sim',
      groupId: 'sandbox',
      user: { id: userId, name: userName, role: 'member' },
      text,
      ts: Date.now(),
    };
  }

  function buildTranscript(msgs) {
    if (!msgs || !msgs.length) return '<div class="dice-empty">暂无对话</div>';
    return msgs.map(renderBubble).join('');
  }

  function canSend(text) {
    return typeof text === 'string' && text.trim().length > 0;
  }

  return { renderBubble, buildMessageIn, buildTranscript, canSend };
});