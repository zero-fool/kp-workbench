'use strict';
/* AI 关系补全（suggestRelations）：校验「卡片内容 + 源文本」注入与姓名白名单健壮性 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { suggestRelations } = require('../src/main/ai');

function withServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: 'http://127.0.0.1:' + srv.address().port }));
  });
}
const body = (req) => new Promise((res) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => res(s)); });
const okJson = (arr) => JSON.stringify({ choices: [{ message: { content: JSON.stringify(arr) } }] });

test('关系补全：提示词注入卡片关键内容与源文本摘录，含括号名称不误伤白名单', async () => {
  let seen = '';
  const { srv, base } = await withServer(async (req, res) => {
    seen = await body(req);
    res.setHeader('Content-Type', 'application/json');
    res.end(okJson([{ op: 'add', from: '老周（酒馆老板）', to: '火鳞商会', label: '秘密效忠' }]));
  });
  try {
    const entities = {
      npcs: [
        { name: '老周（酒馆老板）', role: '酒馆老板', secret: '暗地里效忠火鳞商会，负责在酒馆传递情报' }
      ],
      lore: [
        { name: '火鳞商会', content: '王都最大的商会，控制着全城的粮食与军需贸易' }
      ],
      pcs: [], regions: [], logs: [], mobs: [], rules: []
    };
    const relations = { nodes: [], edges: [] };
    const cfg = { model: 'm', apiKey: 'k', baseUrl: base, timeoutMs: 3000, maxTokens: 500 };
    const rawText = '酒馆老板老周在深夜接待了火鳞商会的密使，两人低声交谈了很久。';
    const out = await suggestRelations(entities, relations, cfg, rawText);
    const userMsg = JSON.parse(seen).messages[1].content;

    /* ① 卡片关键内容被注入：NPC 秘密/角色、lore 正文都进了提示词 */
    assert.match(userMsg, /暗地里效忠火鳞商会/);
    assert.match(userMsg, /王都最大的商会/);
    assert.match(userMsg, /酒馆老板/);
    /* ② 源文本摘录被注入 */
    assert.match(userMsg, /深夜接待了火鳞商会的密使/);
    /* ③ 含括号的名称（老周（酒馆老板））能通过白名单，不被误伤过滤 */
    assert.equal(out.length, 1);
    assert.equal(out[0].op, 'add');
    assert.equal(out[0].from, '老周（酒馆老板）');
    assert.equal(out[0].to, '火鳞商会');
  } finally { srv.close(); }
});

test('关系补全：未提供源文本时不注入原文段，仍正常工作', async () => {
  let seen = '';
  const { srv, base } = await withServer(async (req, res) => {
    seen = await body(req);
    res.setHeader('Content-Type', 'application/json');
    res.end(okJson([{ op: 'add', from: '阿瑟', to: '艾拉', label: '师徒' }]));
  });
  try {
    const entities = {
      pcs: [{ name: '阿瑟', note: '艾拉的老师，一直暗中保护她' }],
      npcs: [{ name: '艾拉', role: '见习骑士', note: '阿瑟的学徒' }],
      regions: [], logs: [], mobs: [], rules: [], lore: []
    };
    const cfg = { model: 'm', apiKey: 'k', baseUrl: base, timeoutMs: 3000, maxTokens: 500 };
    const out = await suggestRelations(entities, { nodes: [], edges: [] }, cfg, '');
    const userMsg = JSON.parse(seen).messages[1].content;
    assert.equal(userMsg.includes('\n\n原始文本摘录\n'), false);
    assert.equal(out.length, 1);
    assert.equal(out[0].from, '阿瑟');
    assert.equal(out[0].label, '师徒');
  } finally { srv.close(); }
});
