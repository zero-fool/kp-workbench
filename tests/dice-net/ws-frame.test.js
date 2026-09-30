'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { acceptKey, encodeFrame, decodeFrame } = require('../../src/dice-net/ws/frame');

test('握手：Sec-WebSocket-Accept 符合 RFC 6455 样例', () => {
  // RFC 6455 第 1.3 节官方样例
  assert.strictEqual(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('帧编解码：服务端文本帧往返', () => {
  const buf = encodeFrame('hello 骰娘', { mask: false });
  const out = decodeFrame(buf);
  assert.strictEqual(out.opcode, 0x1);
  assert.strictEqual(out.payload.toString('utf8'), 'hello 骰娘');
  assert.strictEqual(out.fin, true);
});

test('帧编解码：带掩码的客户端帧可解码', () => {
  const buf = encodeFrame(JSON.stringify({ a: 1 }), { mask: true, maskKey: Buffer.from([1, 2, 3, 4]) });
  const out = decodeFrame(buf);
  assert.strictEqual(out.payload.toString('utf8'), JSON.stringify({ a: 1 }));
});

test('帧编解码：65535 字节以上走 64 位长度', () => {
  const big = 'x'.repeat(70000);
  const out = decodeFrame(encodeFrame(big, { mask: false }));
  assert.strictEqual(out.payload.length, 70000);
});

test('帧编解码：分片输入返回 null 等待更多数据', () => {
  const buf = encodeFrame('abc', { mask: false });
  assert.strictEqual(decodeFrame(buf.subarray(0, 2)), null);
});

test('帧编解码：关闭帧 opcode=8', () => {
  const out = decodeFrame(encodeFrame(Buffer.alloc(0), { opcode: 0x8, mask: false }));
  assert.strictEqual(out.opcode, 0x8);
});

test('WsServer：握手后 echo 回文本', async () => {
  const { WsServer } = require('../../src/dice-net/ws');
  const srv = new WsServer();
  srv.onConnection((conn) => conn.onMessage((text) => conn.send('echo:' + text)));
  const port = await srv.listen(0);
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got = await new Promise((res, rej) => {
    ws.onmessage = (e) => res(e.data);
    ws.onerror = () => rej(new Error('ws error'));
    ws.onopen = () => ws.send('你好');
  });
  assert.strictEqual(got, 'echo:你好');
  ws.close();
  await srv.close();
});

test('WsServer：非法握手（无 Sec-WebSocket-Key）被拒绝', async () => {
  const { WsServer } = require('../../src/dice-net/ws');
  const srv = new WsServer();
  const port = await srv.listen(0);
  const res = await new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    });
    let data = '';
    sock.on('data', (b) => { data += b.toString(); resolve(data); sock.destroy(); });
    sock.on('close', () => resolve(data || 'CLOSED_NO_RESPONSE'));
  });
  assert.match(res, /400/);
  await srv.close();
});