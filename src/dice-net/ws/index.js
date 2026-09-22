'use strict';
// 零依赖 WebSocket 服务端（RFC 6455 子集：握手/文本/关闭/ping-pong/掩码），要点见 Task 1 文档注释
const net = require('node:net');
const { acceptKey, encodeFrame, decodeFrame } = require('./frame');

class WsServer {
  constructor(opts = {}) {
    this.conns = new Set(); this._onConnection = null; this.verify = opts.verify || null;
  }
  onConnection(fn) { this._onConnection = fn; }
  listen(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
      this.tcp = net.createServer((sock) => this._handshake(sock));
      this.tcp.listen(port, host, () => resolve(this.tcp.address().port));
    });
  }
  _handshake(sock) {
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      sock.removeListener('data', onData);
      const head = buf.subarray(0, idx).toString();
      const lines = head.split('\r\n');
      const requestLine = lines[0] || '';
      const path = /^GET\s+(\S+)/.exec(requestLine)?.[1] || '';
      const key = /sec-websocket-key:\s*(.+)/i.exec(head)?.[1]?.trim();
      const headers = {};
      for (let i = 1; i < lines.length; i++) {
        const m = /^([^:]+):\s*(.*)$/.exec(lines[i]);
        if (m) headers[m[1].toLowerCase()] = m[2].trim();
      }
      if (!key || !/upgrade:\s*websocket/i.test(head)) {
        sock.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        return;
      }
      if (this.verify && !this.verify({ path, headers })) {
        sock.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n' +
        `Connection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
      this._bind(sock, buf.subarray(idx + 4));
    };
    sock.on('data', onData);
    sock.on('error', () => {});
  }
  _bind(sock, rest) {
    const conn = {
      sock,
      _msgCb: null,
      onMessage(fn) { conn._msgCb = fn; },
      onClose(fn) { conn._closeCb = fn; },
      send(text) { if (!sock.destroyed) sock.write(encodeFrame(text, { mask: false })); },
      close() { sock.write(encodeFrame(Buffer.alloc(0), { opcode: 0x8, mask: false })); sock.end(); },
    };
    this.conns.add(conn);
    let buf = Buffer.from(rest);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const frame = decodeFrame(buf);
        if (!frame) break;
        buf = frame.rest;
        if (frame.opcode === 0x8) { conn.close(); break; }
        if (frame.opcode === 0x9) { sock.write(encodeFrame(frame.payload, { opcode: 0xA, mask: false })); continue; }
        if (frame.opcode === 0x1 || frame.opcode === 0x0) {
          const text = frame.payload.toString('utf8');
          if (conn._msgCb) conn._msgCb(text);
        }
      }
    });
    sock.on('close', () => { this.conns.delete(conn); if (conn._closeCb) conn._closeCb(); });
    sock.on('error', () => {});
    if (this._onConnection) this._onConnection(conn);
  }
  close() {
    for (const c of this.conns) c.close();
    return new Promise((resolve) => (this.tcp ? this.tcp.close(() => resolve()) : resolve()));
  }
}

module.exports = { WsServer };