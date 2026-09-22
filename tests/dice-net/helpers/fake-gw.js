'use strict';
// 假 QQ 网关 Socket（测试辅助）：类 WebSocket 对象，记录发出的帧，供驱动握手状态机
class FakeGatewaySocket {
  constructor() {
    this.sent = [];
    this._s = 0;
    this._onmessage = null; this._onclose = null; this._onerror = null;
  }
  factory = () => this;
  send(frame) { this.sent.push(JSON.parse(frame)); }
  close() {}
  set onmessage(fn) { this._onmessage = fn; }
  get onmessage() { return this._onmessage; }
  set onclose(fn) { this._onclose = fn; }
  get onclose() { return this._onclose; }
  set onerror(fn) { this._onerror = fn; }
  get onerror() { return this._onerror; }
  _emit(pkt) { if (this._onmessage) this._onmessage({ data: JSON.stringify(pkt) }); }
  emitHello(d = { heartbeat_interval: 40000 }) { this._emit({ op: 10, d }); }
  emitEvent(pkt) { this._s += 1; this._emit({ op: 0, s: this._s, t: pkt.t, d: pkt.d }); }
  emitClose(code) { if (this._onclose) this._onclose({ code }); }
  async waitForSent(pred, timeoutMs = 3000) {
    const t0 = Date.now();
    for (;;) {
      if (this.sent.some(pred)) return;
      if (Date.now() - t0 > timeoutMs) throw new Error('waitForSent 超时');
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}
module.exports = { FakeGatewaySocket };
