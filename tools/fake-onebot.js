#!/usr/bin/env node
'use strict';
// 假 OneBot 11 协议端（测试联调专用）：模拟 Lagrange/NapCat 等外部端的事件上报与 API 回执
// 命令行用法：node tools/fake-onebot.js --url ws://127.0.0.1:6700/onebot/v11/ws --token it-token
// 使用 Node 22+ 全局 WebSocket（与 Task 1 测试客户端一致）

function startFakeOnebot(opts) {
  const { url, accessToken = '', autoAck = true } = opts;
  const full = accessToken ? `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(accessToken)}` : url;
  const ws = new WebSocket(full);
  const api = {
    frames: [],
    sendGroupMessage({ group_id, user_id, text, role = 'member' }) {
      ws.send(JSON.stringify({
        post_type: 'message', message_type: 'group', time: Math.floor(Date.now() / 1000),
        self_id: 999, message_id: this.frames.length + 1, group_id, user_id, raw_message: text,
        sender: { user_id, nickname: '假端玩家', role },
      }));
    },
    async waitFor(pred, timeoutMs = 1000) {
      const t0 = Date.now();
      for (;;) {
        if (pred(api.frames)) return;
        if (Date.now() - t0 > timeoutMs) throw new Error('waitFor 超时');
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    close() { ws.close(); },
  };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(api);
    ws.onerror = () => reject(new Error('fake-onebot 连接被拒绝'));
    ws.onmessage = (e) => {
      const frame = JSON.parse(e.data);
      api.frames.push(frame);
      if (autoAck && frame.echo) {
        ws.send(JSON.stringify({ status: 'ok', retcode: 0, echo: frame.echo, data: { message_id: 1 } }));
      }
    };
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  startFakeOnebot({ url: get('--url', 'ws://127.0.0.1:6700/onebot/v11/ws'), accessToken: get('--token', '') })
    .then((fake) => {
      console.log('[fake-onebot] 已连接，可模拟事件上报');
      setInterval(() => fake.sendGroupMessage({ group_id: 1, user_id: 2, text: '.r1d100' }), 5000);
    })
    .catch((e) => { console.error('[fake-onebot] 连接失败:', e.message); process.exit(1); });
}

module.exports = { startFakeOnebot };
