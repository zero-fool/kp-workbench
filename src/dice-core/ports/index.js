'use strict';
/* ports 门面：M1 把四个接口契约完整落好（接口文件 + JSDoc 类型注释），供 M2/M3 实现。
 *
 * @typedef {Object} CommandContext
 * @property {Object} session
 * @property {{id: string, name: string, role: string}} sender
 * @property {Object} perm
 * @property {{workspace: Object, cards: Object, state: Object}} data
 * @property {import('../expr').Rng} rng
 * @property {Object} ai
 *
 * @typedef {Object} RulePlugin
 * @property {{id: string, name: string, version: string, ruleset: string, author: string, minCore: string}} manifest
 * @property {Object<string, string>} dice
 * @property {Array<Object>} checks
 * @property {Array<Object>} cardFields
 * @property {Array<Object>} commands
 * @property {Object<string, string>} templates
 */

const { normalizeMessage, makeReply } = require('./message');
const { assertChannel } = require('./channel');
const { createMemoryWorkspace, KINDS } = require('./workspace');
const { createMemoryStore } = require('./store');
const { createOfflineAi } = require('./ai');

module.exports = {
  normalizeMessage, makeReply,
  assertChannel,
  createMemoryWorkspace, KINDS,
  createMemoryStore,
  createOfflineAi
};