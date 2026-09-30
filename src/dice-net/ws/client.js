'use strict';
/* 零依赖 WebSocket 客户端（RFC 6455 子集：握手 / 文本 / 关闭 / ping-pong / 掩码）。
 * 与同目录 ws/index.js 的 WsServer 配套，共用 frame.js。
 * 用途：主进程建立上游 WS 连接（QQ 官方网关 / OneBot 客户端模式）——
 *   Node 20 与 Electron 主进程都没有全局 WebSocket，而渲染进程的 WebSocket 不能用于主进程。
 * 对外形状对齐 WHATWG WebSocket 被用到的子集：
 *   new WsClient(url)、onopen/onmessage(e.data)/onerror/onclose(e.code)、send(str)、close()、
 *   readyState 与静态 CONNECTING/OPEN/CLOSING/CLOSED 常量。 */
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { acceptKey, encodeFrame, decodeFrame } = require('./frame');

const CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3;

class WsClient {
  constructor(url) {
    this.url = String(url);
    this.readyState = CONNECTING;
    this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
    this._sock = null;
    this._buf = Buffer.alloc(0);
    this._expect = '';
    this._handshaken = false;
    this._closed = false;
    this._closeCode = null;
    this._frag = [];
    this._fragOpcode = 0;
    this._connect();
  }

  _emit(name, ev) {
    const fn = this[name];
    if (typeof fn === 'function') { try { fn.call(this, ev); } catch (_) { /* 回调异常不影响连接 */ } }
  }

  _connect() {
    let u;
    try { u = new URL(this.url); } catch (err) { this._fail(err); return; }
    const secure = u.protocol === 'wss:';
    const port = u.port ? Number(u.port) : (secure ? 443 : 80);
    const path = (u.pathname || '/') + (u.search || '');
    const host = u.hostname;
    const key = crypto.randomBytes(16).toString('base64');
    this._expect = acceptKey(key);

    const onConnect = () => {
      this._sock.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    };
    const sock = secure
      ? tls.connect({ host, port, servername: host }, onConnect)
      : net.connect({ host, port }, onConnect);
    this._sock = sock;
    sock.on('error', (err) => this._fail(err));
    sock.on('close', () => this._onSockClose());
    sock.on('data', (chunk) => this._onData(chunk));
  }

  _onData(chunk) {
    if (this._closed) return;
    this._buf = Buffer.concat([this._buf, chunk]);
    if (!this._handshaken) {
      const idx = this._buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = this._buf.subarray(0, idx).toString();
      this._buf = this._buf.subarray(idx + 4);
      const code = Number((/^HTTP\/1\.1\s+(\d+)/.exec(head) || [])[1] || 0);
      const acc = ((/sec-websocket-accept:\s*(.+)/i.exec(head) || [])[1] || '').trim();
      if (code !== 101 || acc !== this._expect) {
        this._fail(new Error(`WebSocket 握手失败（HTTP ${code || '?'}）`));
        return;
      }
      this._handshaken = true;
      this.readyState = OPEN;
      this._emit('onopen', { type: 'open' });
    }
    for (;;) {
      const frame = decodeFrame(this._buf);
      if (!frame) break;
      this._buf = frame.rest;
      this._handleFrame(frame);
      if (this._closed) break;
    }
  }

  _handleFrame(frame) {
    const { opcode, fin, payload } = frame;
    if (opcode === 0x8) {                                   // 关闭
      if (payload.length >= 2) this._closeCode = payload.readUInt16BE(0);
      this._send(encodeFrame(Buffer.alloc(0), { opcode: 0x8, mask: true }));
      this._teardown(this._closeCode == null ? 1005 : this._closeCode, true);
      return;
    }
    if (opcode === 0x9) { this._send(encodeFrame(payload, { opcode: 0xA, mask: true })); return; } // ping → pong
    if (opcode === 0xA) return;                                                                    // pong
    if (opcode === 0x1 || opcode === 0x2) { this._fragOpcode = opcode; this._frag = [payload]; }
    else if (opcode === 0x0) { this._frag.push(payload); }
    else return;
    if (fin && this._fragOpcode === 0x1) {                  // 文本（含分片重组）完成
      const text = Buffer.concat(this._frag).toString('utf8');
      this._frag = [];
      this._emit('onmessage', { type: 'message', data: text });
    }
  }

  _send(buf) {
    if (this._sock && !this._sock.destroyed) { try { this._sock.write(buf); } catch (_) { /* 忽略写失败 */ } }
  }

  send(data) {
    if (this.readyState !== OPEN) return;
    this._send(encodeFrame(data, { opcode: 0x1, mask: true })); // 客户端发送必须掩码
  }

  close() {
    if (this.readyState === CLOSED || this.readyState === CLOSING) return;
    this.readyState = CLOSING;
    this._send(encodeFrame(Buffer.alloc(0), { opcode: 0x8, mask: true }));
    if (this._sock) { try { this._sock.end(); } catch (_) {} }
  }

  _fail(err) {
    this._emit('onerror', { type: 'error', message: String((err && err.message) || err), error: err });
    this._teardown(1006, false);
  }

  _onSockClose() {
    if (this._closed) return;
    this._teardown(this._closeCode == null ? 1006 : this._closeCode, false);
  }

  _teardown(code, clean) {
    if (this._closed) return;
    this._closed = true;
    this.readyState = CLOSED;
    if (this._sock) { try { this._sock.destroy(); } catch (_) {} }
    this._emit('onclose', { type: 'close', code, wasClean: clean });
  }
}

WsClient.CONNECTING = CONNECTING;
WsClient.OPEN = OPEN;
WsClient.CLOSING = CLOSING;
WsClient.CLOSED = CLOSED;

module.exports = { WsClient };
