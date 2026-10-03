'use strict';
/* AI 层：角色卡(人设/话风/设定) 组装 + OpenAI 兼容接口调用 + 剧本→工作台结构化解析 */

const promptHub = require('./prompt-hub'); // 统一提示词 + 分场景记忆中枢
const _K = ['pcs', 'npcs', 'regions', 'logs', 'mobs', 'rules', 'lore'];

/* 提示词中枢上下文：由主进程注入 dataDir，AI 各调用按场景注入「总提示词(master) + 本场景记忆尾部」。
 * 未注入时(单测/离线)任何 hub 注入都是空，完全不影响既有行为。 */
let _hub = { dataDir: '' };
function setHubContext(ctx) { if (ctx && typeof ctx === 'object') _hub = Object.assign({}, _hub, ctx); }
function hubDataDir() { return _hub.dataDir || ''; }
/* 通用注入：给定场景 + settings，返回(总则 + 本场景记忆)；无配置/无记忆时返回空字符串 */
function hubPrefix(sceneKey, settings, vars) {
  const dd = hubDataDir();
  if (!dd || !settings) return '';
  try {
    const mem = promptHub.readMemory(dd, sceneKey, 2200);
    const parts = [];
    const master = promptHub.masterOf(settings);
    if (master.trim()) parts.push('【总则】' + master.trim());
    const style = promptHub.styleOf(settings); // U2-4：风格包优先级最高
    if (style) parts.push('【叙事风格（最高优先级，覆盖其他风格描述）】' + style.text);
    if (mem.trim()) parts.push(mem);
    return parts.join('\n\n');
  } catch (_) { return ''; }
}
/* 服务式：把「总则+场景记忆」拼到现有 system 之前；未注入则原样返回以防破坏既有提示词 */
function hubSystem(sceneKey, settings, ownSys, vars) {
  const pre = hubPrefix(sceneKey, settings, vars);
  return pre ? String(pre) + '\n\n' + String(ownSys === undefined ? '' : ownSys) : (ownSys === undefined ? '' : String(ownSys));
}

/* 内置默认字段 schema（用户未自定时使用；type: text|textarea|number|select|tags|sep） */
const DEFAULT_FIELDS = {
  pcs: [
    { k: 'name', l: '姓名', t: 'text' },
    { k: 'player', l: '玩家', t: 'text' },
    { k: 'path', l: '路径', t: 'text' },
    { k: 'subtitle', l: '称号', t: 'text' },
    { k: 'level', l: '等级', t: 'number' },
    { k: 'attribute', l: '属性速写', t: 'textarea' },
    { k: 'hp', l: '生命值', t: 'number' },
    { k: 'body', l: '体质', t: 'number' },
    { k: 'agi', l: '敏捷', t: 'number' },
    { k: 'wil', l: '意志', t: 'number' },
    { k: 'per', l: '感知', t: 'number' },
    { k: 'skill', l: '技能', t: 'tags' },
    { k: 'wound', l: '伤势', t: 'select', opts: ['健康', '负伤', '重伤', '倒地', '死亡'] },
    { k: 'status', l: '状态', t: 'select', opts: ['在队', '失踪', '退团', '死亡'] },
    { k: 'note', l: '备注', t: 'textarea' }
  ],
  npcs: [
    { k: 'name', l: '名称', t: 'text' },
    { k: 'role', l: '身份/职业', t: 'text' },
    { k: 'faction', l: '阵营/组织', t: 'text' },
    { k: 'location', l: '所在地', t: 'text' },
    { k: 'rel', l: '角色关系', t: 'select', opts: ['友好', '中立', '敌对', '未知'] },
    { k: 'etype', l: '类型', t: 'select', opts: ['普通', '精英', 'Boss'] },
    { k: 'lv', l: '等级', t: 'number' },
    { k: 'hp', l: '生命值', t: 'number' },
    { k: 'personality', l: '性格', t: 'textarea' },
    { k: 'appearance', l: '外貌', t: 'textarea' },
    { k: 'secret', l: '秘密/动机', t: 'textarea' },
    { k: 'status', l: '状态', t: 'select', opts: ['活跃', '失踪', '死亡', '退场'] },
    { k: 'note', l: '备注', t: 'textarea' }
  ],
  regions: [
    { k: 'name', l: '名称', t: 'text' },
    { k: 'type', l: '类型', t: 'select', opts: ['城市', '村镇', '荒野', '地下城', '据点', '异界', '海域'] },
    { k: 'area', l: '区域/规模', t: 'text' },
    { k: 'danger', l: '危险度', t: 'select', opts: ['安全', '低', '中', '高', '极危'] },
    { k: 'env', l: '环境', t: 'select', opts: ['普通', '雾蚀带', '灰区'] },
    { k: 'dist', l: '距离圈', t: 'select', opts: ['近战', '近距', '中距', '远距', '极限'] },
    { k: 'cover', l: '掩护', t: 'select', opts: ['无', '轻掩护', '重掩护'] },
    { k: 'desc', l: '描述', t: 'textarea' },
    { k: 'food', l: '补给/资源', t: 'text' },
    { k: 'key', l: '关键地点/机关', t: 'tags' },
    { k: 'note', l: '备注', t: 'textarea' }
  ],
  logs: [
    { k: 'name', l: '标题', t: 'text' },
    { k: 'when', l: '开团日期', t: 'text' },
    { k: 'summary', l: '剧情摘要', t: 'textarea' },
    { k: 'hook', l: '当前钩子/任务', t: 'textarea' },
    { k: 'polished', l: '润色稿（AI）', t: 'textarea' },
    { k: 'actors', l: '出场角色', t: 'tags' },
    { k: 'status', l: '状态', t: 'select', opts: ['已解决', '进行中', '待跟进'] },
    { k: 'note', l: '备注', t: 'textarea' }
  ],
  mobs: [
    { k: 'name', l: '名称', t: 'text' },
    { k: 'category', l: '类别', t: 'select', opts: ['暗灵', '野兽', '亡灵', '构装体', '人形', '其他'] },
    { k: 'tier', l: '层级', t: 'select', opts: ['普通', '精英', 'Boss'] },
    { k: 'lv', l: '等级', t: 'number' },
    { k: 'hp', l: '生命值', t: 'number' },
    { k: 'av', l: '护甲', t: 'number' },
    { k: 'dmg', l: '伤害', t: 'text' },
    { k: 'trait', l: '特性', t: 'tags' },
    { k: 'weak', l: '弱点', t: 'text' },
    { k: 'note', l: '备注', t: 'textarea' }
  ],
  rules: [
    { k: 'name', l: '规则名称', t: 'text' },
    { k: 'scope', l: '适用范围', t: 'select', opts: ['通用', '战斗', '成长', '物品', '探索', '其他'] },
    { k: 'summary', l: '要点', t: 'textarea' },
    { k: 'detail', l: '详细内容', t: 'textarea' },
    { k: 'source', l: '来源/出处', t: 'text' },
    { k: 'tags', l: '标签', t: 'tags' },
    { k: 'note', l: '备注', t: 'textarea' }
  ],
  lore: [
    { k: 'name', l: '标题', t: 'text' },
    { k: 'category', l: '类别', t: 'select', opts: ['地理', '历史', '设定', '文化', '组织', '其他'] },
    { k: 'summary', l: '概要', t: 'textarea' },
    { k: 'content', l: '正文', t: 'textarea' },
    { k: 'origin', l: '来源', t: 'text' },
    { k: 'tags', l: '标签', t: 'tags' },
    { k: 'note', l: '备注', t: 'textarea' }
  ]
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function defaultFields() { return clone(DEFAULT_FIELDS); }
function effectiveFields(d) { return (d.fields && typeof d.fields === 'object') ? d.fields : DEFAULT_FIELDS; }

function schemaText(fields) {
  const out = {};
  for (const kind of _K) {
    const list = fields[kind] || [];
    out[kind] = list.map(f => {
      if (f.t === 'select') return f.k + ':' + f.l + '(选其一 ' + (f.opts || []).join('/') + ')';
      if (f.t === 'number') return f.k + ':' + f.l + '(数字)';
      return f.k + ':' + f.l;
    }).join('，');
  }
  return JSON.stringify(out);
}

/* U3-4：极简字段 schema（仅类别 + 字段键），用于解析的后续段落——
 * 完整字段说明只在首段注入一次即可，后续段落无需重复，段数越多省得越多。 */
function compactSchemaText(fields) {
  const out = {};
  for (const kind of _K) out[kind] = (fields[kind] || []).map(f => f.k).join(',');
  return JSON.stringify(out);
}

function profileBlock(profile) {
  if (!profile) return '';
  const parts = [];
  parts.push('【当前 AI 人设】');
  if (profile.name) parts.push('角色名：' + profile.name);
  if (profile.persona) parts.push('◇ 人设：\n' + profile.persona);
  if (profile.style) parts.push('◇ 话风：\n' + profile.style);
  if (profile.setting) parts.push('◇ 设定/世界观/规则：\n' + profile.setting);
  return parts.join('\n');
}

function systemForChat(profile, fields, world, opts) {
  opts = opts || {};
  const w = world || '当前团';
  let s = '你在辅助一位 TRPG《' + w + '》的 KP 使用“跑团工作台”。请结合工作台现有资料，用简明、生动'
    + (opts.usePersona !== false && profile ? '、符合当前人设' : '') + '的口吻辅助编写与润色内容。\n'
    + '\n工作台资料字段（供你理解结构，勿在对话中输出 JSON）：\n' + schemaText(fields) + '\n\n';
  // 人设开关：默认开启
  s += (opts.usePersona !== false && profileBlock(profile)) || '（未配置 AI 人设，请用自然、中立的写作口吻。）';
  // 背景作为参考：默认开启
  // U3-2：以下三段均为「每轮随 system 重发」的固定内容，必须限长，否则每轮输入成本被它们拖高；
  // 顺序固定（背景→偏好→记忆），记忆最易增长故放最后，便于服务商对稳定前缀做提示词缓存。
  if (opts.useLoreRef !== false && opts.loreText) {
    s += '\n\n【当前团背景 / 规则（作为参考，勿全量复述）】\n' + clipToks(String(opts.loreText), LORE_MAX_TOKENS);
  }
  // 用户偏好记忆（可编辑：KP 在此写下使用习惯/格式要求/期望风格，AI 应遵守并贯彻）
  if (opts.useUserPrefs !== false && opts.userPrefsText) {
    s += '\n\n【用户偏好（KP 设定，请优先遵守并贯穿始终）】\n' + clipToks(String(opts.userPrefsText), PREFS_MAX_TOKENS);
  }
  // 长期记忆
  if (opts.longMemory && opts.memoryText) {
    s += '\n\n【长期记忆（历史要点，据此与本次对话保持连贯，可自然引用）】\n' + clipToks(String(opts.memoryText), MEMORY_MAX_TOKENS);
  }
  // 工具调用许可
  if (opts.allowTools) {
    s += '\n\n【工具已授权】用户可上传文本文件供你读取/整理，讨论结果可被“建为资料卡”或导出为 .txt 文本。';
  } else {
    s += '\n\n（工具调用未开启：请仅以纯文本对话形式辅助，不执行任何结构化/文件类操作。）';
  }
  s += '\n\n若用户要求生成/改写资料卡，请直接以自然语言给出可直接采用的文本，可含编号或要点。';
  // 提示词中枢注入（总则 + 本场景记忆）；opts.settings 存在且已注入 dataDir 时才会接管
  if (opts.settings && hubDataDir()) {
    return hubSystem('chat', opts.settings, s, { world: w });
  }
  return s;
}

function systemForParse(fields, existing) {
  const exist = {};
  for (const k of _K) {
    existing[k] = existing[k] || [];
    exist[k] = existing[k].map(x => x.name || x.title).filter(Boolean).join('、');
  }
  return '你是一个 TRPG 跑团剧本解析助手。给定一段跑团剧本文字，请把它拆解成本工作台的 7 类结构化实体，只用于登记。\n'
    + '实体类别与可用字段（只填这些字段，缺失可省略，但名称类字段必须给出）：\n' + schemaText(fields) + '\n'
    + '\n现有同名条目（已存在的不要重复新增，尽量合并到 update 建议）：\n' + JSON.stringify(exist) + '\n'
    + '只输出一个 JSON 对象，结构为：\n'
    + '{"entities":{"pcs":[{字段...}],"npcs":[...],"regions":[...],"logs":[...],"mobs":[...],"rules":[...],"lore":[...]},"updates":[]}\n'
    + '要求：从剧本里识别角色(PC/NPC)、地点/场景(regions)、事件/线索(logs)、怪物、规则(rules)、设定与背景(lore)等；每条独立对象、字段用实际含义填空；没有的类别给空数组[]；不要输出任何解释文字。\n'
    + '【人物名约束】人物类(pcs/npcs)的 name 必须是文本中真实出现的人物姓名；严禁把作者/译者/校对/插图/编辑/主持人/KP/GM/玩家/骰娘/目录/序章/附录/规则/模组等元信息或类型词当作人物。';
}

/* ==================== 卡片模板库 ====================
 * 模板是一套「按资料类型」的字段 schema，可挂到某张卡片上，从而按规则书改变卡上显示的数据
 * （例如 CoC 显示 力量/理智/魔法值，DnD 显示 力量/敏捷/智力…/AC/熟练值）。
 * 内置两套规则书模板：coc(克苏鲁的呼唤 7th)、dnd(龙与地下城 5e)。模板通过 id 挂到卡片 item.tpl。
 * 每套模板只对「卡片类」实体(pcs/npcs/mobs)定义差异化字段；未定义的类别回落全局字段。
 * 用户可在「设置 → 字段」里在此基础上另存自定义模板，或让 AI 依据导入的规则书生成模板。 */
const BUILTIN_TEMPLATES = [
  {
    id: 'coc',
    name: 'CoC 7th 调查员',
    note: '克苏鲁的呼唤 7th · 八属性 + 理智SAN/魔法值/幸运 · 生命=(体型+体质)/10',
    builtin: true,
    fields: {
      pcs: [
        { k: 'name', l: '姓名', t: 'text' },
        { k: 'player', l: '玩家', t: 'text' },
        { k: 'occupation', l: '职业', t: 'text' },
        { k: 'age', l: '年龄', t: 'number' },
        { k: 'sex', l: '性别', t: 'select', opts: ['男', '女', '未知'] },
        { k: 'res', l: '居住地', t: 'text' },
        { k: 'str', l: '力量 STR', t: 'number' },
        { k: 'con', l: '体质 CON', t: 'number' },
        { k: 'dex', l: '敏捷 DEX', t: 'number' },
        { k: 'app', l: '外貌 APP', t: 'number' },
        { k: 'int', l: '智力 INT', t: 'number' },
        { k: 'pow', l: '意志 POW', t: 'number' },
        { k: 'siz', l: '体型 SIZ', t: 'number' },
        { k: 'edu', l: '教育 EDU', t: 'number' },
        { k: 'hp', l: '生命值 HP', t: 'number' },
        { k: 'san', l: '理智 SAN', t: 'number' },
        { k: 'mp', l: '魔法值 MP', t: 'number' },
        { k: 'luck', l: '幸运', t: 'number' },
        { k: 'skill', l: '技能', t: 'tags' },
        { k: 'weapon', l: '武器', t: 'textarea' },
        { k: 'belongings', l: '随身物品', t: 'textarea' },
        { k: 'profile', l: '个人背景', t: 'textarea' },
        { k: 'note', l: '备注', t: 'textarea' }
      ],
      npcs: [
        { k: 'name', l: '名称', t: 'text' },
        { k: 'role', l: '身份/职业', t: 'text' },
        { k: 'str', l: '力量 STR', t: 'number' },
        { k: 'con', l: '体质 CON', t: 'number' },
        { k: 'dex', l: '敏捷 DEX', t: 'number' },
        { k: 'pow', l: '意志 POW', t: 'number' },
        { k: 'siz', l: '体型 SIZ', t: 'number' },
        { k: 'hp', l: '生命值 HP', t: 'number' },
        { k: 'san', l: '理智 SAN', t: 'number' },
        { k: 'skill', l: '技能', t: 'tags' },
        { k: 'secret', l: '秘密/动机', t: 'textarea' },
        { k: 'note', l: '备注', t: 'textarea' }
      ],
      mobs: [
        { k: 'name', l: '名称', t: 'text' },
        { k: 'etype', l: '类别', t: 'select', opts: ['怪物', '人类', '梦境生物', '旧日支配者', '其他'] },
        { k: 'str', l: '力量 STR', t: 'number' },
        { k: 'con', l: '体质 CON', t: 'number' },
        { k: 'dex', l: '敏捷 DEX', t: 'number' },
        { k: 'pow', l: '意志 POW', t: 'number' },
        { k: 'siz', l: '体型 SIZ', t: 'number' },
        { k: 'hp', l: '生命值 HP', t: 'number' },
        { k: 'mp', l: '魔法值 MP', t: 'number' },
        { k: 'attack', l: '攻击/伤害', t: 'textarea' },
        { k: 'trait', l: '特性', t: 'tags' },
        { k: 'note', l: '备注', t: 'textarea' }
      ]
    }
  },
  {
    id: 'dnd',
    name: 'DnD 5e 冒险者',
    note: '龙与地下城 5e · 六属性 + HP/AC/熟练/先攻/速度 · 高属性',
    builtin: true,
    fields: {
      pcs: [
        { k: 'name', l: '姓名', t: 'text' },
        { k: 'player', l: '玩家', t: 'text' },
        { k: 'race', l: '种族', t: 'text' },
        { k: 'klass', l: '职业', t: 'text' },
        { k: 'background', l: '背景', t: 'text' },
        { k: 'level', l: '等级', t: 'number' },
        { k: 'exp', l: '经验值', t: 'number' },
        { k: 'str', l: '力量', t: 'number' },
        { k: 'dex', l: '敏捷', t: 'number' },
        { k: 'con', l: '体质', t: 'number' },
        { k: 'int', l: '智力', t: 'number' },
        { k: 'wis', l: '感知', t: 'number' },
        { k: 'cha', l: '魅力', t: 'number' },
        { k: 'hp', l: '生命值 HP', t: 'number' },
        { k: 'ac', l: '护甲 AC', t: 'number' },
        { k: 'prof', l: '熟练加值', t: 'number' },
        { k: 'init', l: '先攻加值', t: 'number' },
        { k: 'speed', l: '速度', t: 'text' },
        { k: 'skill', l: '技能熟练', t: 'tags' },
        { k: 'feat', l: '专长', t: 'tags' },
        { k: 'spell', l: '法术', t: 'tags' },
        { k: 'equip', l: '装备', t: 'textarea' },
        { k: 'bk', l: '人物背景', t: 'textarea' },
        { k: 'note', l: '备注', t: 'textarea' }
      ],
      npcs: [
        { k: 'name', l: '名称', t: 'text' },
        { k: 'race', l: '种族', t: 'text' },
        { k: 'klass', l: '职业', t: 'text' },
        { k: 'role', l: '身份', t: 'text' },
        { k: 'str', l: '力量', t: 'number' },
        { k: 'dex', l: '敏捷', t: 'number' },
        { k: 'con', l: '体质', t: 'number' },
        { k: 'int', l: '智力', t: 'number' },
        { k: 'wis', l: '感知', t: 'number' },
        { k: 'cha', l: '魅力', t: 'number' },
        { k: 'hp', l: '生命值 HP', t: 'number' },
        { k: 'ac', l: '护甲 AC', t: 'number' },
        { k: 'cr', l: '挑战等级', t: 'number' },
        { k: 'trait', l: '特性', t: 'tags' },
        { k: 'secret', l: '秘密/动机', t: 'textarea' },
        { k: 'note', l: '备注', t: 'textarea' }
      ],
      mobs: [
        { k: 'name', l: '名称', t: 'text' },
        { k: 'mtype', l: '生物类型', t: 'select', opts: ['野兽', '类人', '亡灵', '构装体', '龙类', '其他'] },
        { k: 'cr', l: '挑战等级', t: 'number' },
        { k: 'str', l: '力量', t: 'number' },
        { k: 'dex', l: '敏捷', t: 'number' },
        { k: 'con', l: '体质', t: 'number' },
        { k: 'int', l: '智力', t: 'number' },
        { k: 'wis', l: '感知', t: 'number' },
        { k: 'cha', l: '魅力', t: 'number' },
        { k: 'hp', l: '生命值 HP', t: 'number' },
        { k: 'ac', l: '护甲 AC', t: 'number' },
        { k: 'dmg', l: '攻击/伤害', t: 'textarea' },
        { k: 'trait', l: '特性', t: 'tags' },
        { k: 'note', l: '备注', t: 'textarea' }
      ]
    }
  }
];

/* 合并用户自定义模板与内置模板：内置优先（同 id 时以内置为准），用户模板追加在后。
 * 均以浅克隆返回，避免运行时修改污染内置常量。 */
function effectiveTemplates(settings) {
  const cust = (settings && Array.isArray(settings.templates)) ? settings.templates : [];
  const out = BUILTIN_TEMPLATES.map(t => clone(t));
  const have = new Set(out.map(t => t.id));
  for (const t of cust) {
    if (!t || !t.id || have.has(t.id)) continue;
    have.add(t.id);
    out.push(typeof t.fields === 'object' && t.fields ? clone(t) : Object.assign({ fields: {} }, clone(t)));
  }
  return out;
}
/* 取某卡片所用模板在指定类别的字段 schema；模板未定义该类别时回落全局 fallback */
function tplSchema(templates, tplId, kind, fallback) {
  if (!tplId) return fallback;
  const t = (templates || []).find(x => x && x.id === tplId);
  if (t && t.fields && t.fields[kind] && t.fields[kind].length) return t.fields[kind];
  return fallback;
}

/* ==================== AI 提示词模板（可在设置页编辑，缺省回落内置默认） ==================== */
const STRICT_NOTE = '【硬性要求】你只能使用导入文本中实际出现的信息进行分类与填充；对文本里没有提到的字段一律留空，绝不能凭空编造、推测或补写任何原文没有的名称、数值、特性或内容。';
const SUPPLEMENT_NOTE = '【允许补充（已获使用者确认）】你可以对原文未明确提及但合理的内容做适度补充润色，以补全新卡片细节；但仍以原文为准，不得偏离原有设定。';

const DEFAULT_PROMPTS = {
  registration: '你是一个 TRPG 跑团剧本「拆分登记」助手。请把下面这段导入资料拆解为 7 类结构化实体，登记到工作台。\n'
    + '【实体类别】pcs=人物卡(玩家扮演的角色)、npcs=非玩家角色、regions=地区/地点、logs=事件/线索/剧情点、mobs=怪物/敌人、rules=规则/设定条目、lore=世界观/背景。\n'
    + '【字段】只使用以下可用字段，缺失的留空或忽略，但名称类(name/title)必须给出：{schema}\n'
    + '【去重】已存在同名条目：{existing}。同名或同含义的不要重复新增，把「合并建议」写入 updates。\n'
    + '【输出格式】只输出一个合法 JSON，不要输出任何解释文字：\n'
    + '{"entities":{"pcs":[],"npcs":[],"regions":[],"logs":[],"mobs":[],"rules":[],"lore":[]},"updates":[]}\n'
    + '【填充要求】每条独立对象用字段实际含义填空；无法归入 7 类的零散信息放进 updates 供人工处理；没有该类内容就给空数组 []。\n'
    + '【人物名约束】pcs/npcs 的 name/title 必须是文本中真实出现的人物姓名；严禁把「作者/编者/译者/校对/插图/编辑/排版/主持人/守秘人/KP/GM/玩家/骰娘/目录/序章/前言/后记/附录/规则/模组/剧本」等元信息或类型词当作人物，书名/标题/条目名也不得当作人物名；无法确定是人名的，放进 updates 供人工确认。\n'
    + '{mode_note}\n'
    + '【导入文本】\n{fragment}',
  digest: '你是一个 TRPG 资料整理助手。请把下面这段导入资料整理成结构化中文提纲。\n'
    + '必须覆盖以下板块（有则详述、无则略过）：核心设定 / 规则要点 / 人物角色 / 地点 / 剧情或关键点。\n'
    + '{mode_note}\n'
    + '按条目简洁列出，保留关键细节、专有名词与数值，控制在 800 字内；不要输出与原文无关的客套话或空话。\n'
    + '【片段】\n{fragment}',
  generate: '你是 TRPG《{world}》的创作协作者，正在使用跑团工作台为一条新资料卡生成内容。\n'
    + '【任务与要求】{kind_tip}\n'
    + '【字段结构】生成内容须贴合以下字段，帮助把信息填充到位：{schema}\n'
    + '【产出要求】用自然语言直接给出可直接采用的正文；人物/怪物类须含身份、性格、外貌、经历，日志/线索类须含时间、地点、经过、结果；忠于《{world}》的世界观。\n'
    + '{mode_note}'
};

function effectivePrompts(settings) {
  const sp = (settings && settings.prompts) || {};
  const out = {};
  for (const k in DEFAULT_PROMPTS) out[k] = (sp[k] && String(sp[k]).trim()) ? String(sp[k]) : DEFAULT_PROMPTS[k];
  return out;
}

/* 渲染模板：替换 {占位符}；strict 决定注入“严禁增编”还是“允许补充” */
function renderPrompt(tpl, vars, strict) {
  let s = String(tpl == null ? '' : tpl);
  const v = Object.assign({}, vars, { mode_note: strict === false ? SUPPLEMENT_NOTE : STRICT_NOTE });
  for (const k in v) s = s.split('{' + k + '}').join(v[k] == null ? '' : String(v[k]));
  return s;
}

/* 汇总各类现有条目名，供提示词做去重 */
function existingMap(existing) {
  const out = {};
  for (const k of _K) {
    const list = (existing && existing[k]) || [];
    out[k] = list.map(x => x.name || x.title).filter(Boolean).join('、');
  }
  return out;
}

/* 用可编辑的 generate 模板生成一条当前资料类型的全新内容 */
async function generateContent(kind, kindTip, profile, fields, cfg, settings) {
  const prompts = effectivePrompts(settings || {});
  const world = (settings && settings.appName) || '当前团';
  const user = renderPrompt(prompts.generate, {
    world,
    kind_tip: kindTip,
    schema: schemaText(effectiveFields(fields) || DEFAULT_FIELDS)
  }, true);
  const sys = '你是一个 TRPG 内容创作助手，请用中文直接列出要点并给出可直接采用的文本。';
  const c = await apiCall(cfg, sys, sanitizeStr(user, 20000));
  return finalReply(cfg, stripWrap(c));
}

/* 统一的 OpenAI 兼容补全请求：
 * 超时保护覆盖「发送 + 读取响应体」全程（AbortController 在 body 读取完毕前不释放），
 * 任何阶段 AbortError 均被捕获并转为可见的中文错误；失败时把上游真实原因透传出去。 */
/* ==================== 用量记录与取消 ====================
 * 用量：把每次上游对话请求的耗时、token 用量（从响应 usage 字段读取）登记到环形日志，
 * 供「用量面板」查询；在长上下文逼近上限被压缩时也记一条，让成本可见，不再是黑箱。
 * 取消：每项请求注册一个 AbortController，渲染层可按任务类型（group）发起中止。 */
const USAGE_MAX = 500;                       // 用量环形日志保留条数
let _usageLog = [];
let _usageSince = Date.now();                // 本轮统计区间起点（跨「时段」清零用）
function recordUsage(entry) {
  const e = Object.assign({ at: Date.now() }, entry || {});
  _usageLog.push(e); if (_usageLog.length > USAGE_MAX) _usageLog = _usageLog.slice(-USAGE_MAX);
  return e;
}
function resetUsage(bucketMs) {
  if (typeof bucketMs === 'number' && bucketMs === 0) { _usageLog = []; _usageSince = Date.now(); return; } // 0 = 全清
  const cut = (typeof bucketMs === 'number' && bucketMs > 0) ? bucketMs : 3600e3;
  const lim = Date.now() - cut;
  _usageLog = _usageLog.filter(x => x.at > lim); _usageSince = Date.now();
}
function usageLog() {
  let prompt = 0, completion = 0, total = 0, calls = 0, msSum = 0;
  for (const x of _usageLog) {
    calls++; msSum += x.ms || 0;
    prompt += x.promptTokens || 0; completion += x.completionTokens || 0; total += x.totalTokens || 0;
  }
  return {
    since: _usageSince,
    calls,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    msSum,
    entries: _usageLog.map(x => Object.assign({}, x))
  };
}
/* U3-5：预算熔断——按当前统计时段累计的 token 估算花费，达到用户设定上限即拒绝新的上游请求，
 * 避免「无感超支」。仅当 budget 传入了 >0 的 limit 时生效；不参与重试（status 402 不在可重试集合）。 */
function usageCost(budget) {
  const pin = Number(budget && budget.inPrice) || 0, pout = Number(budget && budget.outPrice) || 0;
  let it = 0, ot = 0;
  for (const x of _usageLog) { it += x.promptTokens || 0; ot += x.completionTokens || 0; }
  return (it * pin + ot * pout) / 1e6;
}
function budgetGuard(cfg) {
  const b = cfg && cfg.budget;
  if (!b || !(Number(b.limit) > 0) || cfg.noBudget) return;
  const cost = usageCost(b);
  if (cost >= Number(b.limit)) {
    const e = new Error('AI_BUDGET_EXCEEDED 已达 AI 预算上限（估算 ' + cost.toFixed(4) + ' 元 / 上限 ' + b.limit
      + ' 元），已停止发起新请求。可到「AI 用量」调高预算，或「清空本轮统计」后继续。');
    e.status = 402;
    throw e;
  }
}

/* 取消注册表：group -> Set<AbortController> */
const _cancelRegistry = new Map();
function registerRun(group, controller) {
  const key = group || 'misc';
  if (!_cancelRegistry.has(key)) _cancelRegistry.set(key, new Set());
  _cancelRegistry.get(key).add(controller);
  let released = false;
  return function release() { if (released) return; released = true; const s = _cancelRegistry.get(key); if (s) { s.delete(controller); if (!s.size) _cancelRegistry.delete(key); } };
}
function cancelGroup(group) {
  let hit = 0;
  // 注意：_cancelRegistry 是 Map，务必用 Array.from(keys()) 取键；
  // Object.keys() 对 Map 恒为空数组，会导致「取消」彻底失效。
  for (const key of Array.from(_cancelRegistry.keys())) {
    if (group && key !== group) continue;
    const s = _cancelRegistry.get(key); if (!s) continue;
    for (const c of s) {
      try {
        if (!c.signal.aborted) {
          c._userCancel = true; // 标记为「用户主动取消」，与「超时触发 abort」区分
          c.abort(); hit++;
        }
      } catch (_) {}
    }
  }
  return hit;
}

/* ==================== AI 请求自动降级重试 ====================
 * 可重试的错误（上游限流 429、服务端 5xx、网络发送失败、超时）按指数退避重试若干次；
 * 用户主动取消、鉴权/参数类 4xx（400/401/403/404/422）等重试无意义的错误一律直接抛出不放行。
 * 退避等待期间同样登记一次哨兵，用户点取消能立即中断重试，不会「取消后又偷偷重发」。 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_MSG = ['AI 请求发送失败', 'AI 请求超时', 'AI 响应读取超时'];
const AI_MAX_ATTEMPTS = 3;

function aiShouldRetry(e) {
  if (!e) return false;
  if (e.status && RETRYABLE_STATUS.has(e.status)) return true;
  const msg = String(e.message || '');
  if (msg.indexOf('AI_TASK_CANCELLED') === 0) return false;
  for (const k of RETRYABLE_MSG) if (msg.indexOf(k) === 0) return true;
  return false;
}

/* 指数退避；限流多等一会儿。 */
function aiBackoffMs(status, attempt) {
  const base = status === 429 ? 1500 : 800;
  return base * Math.pow(2, attempt);
}

/* 可取消的退避：注册哨兵 controller 到当前组，用户取消该组会 abort 哨兵，从而中止重试循环。 */
function aiSleep(ms, group) {
  return new Promise(resolve => {
    if (!group) { setTimeout(resolve, ms); return; }
    const sentinel = new AbortController();
    const release = registerRun(group, sentinel);
    const tim = setTimeout(() => { clearTimeout(tim); release(); resolve(); }, ms);
    sentinel.signal.addEventListener('abort', () => {
      if (sentinel._userCancel) { clearTimeout(tim); clearInterval(iv); release(); resolve('CANCEL'); }
    });
    /* 组内若已有被用户打标的在飞请求（超时前收到取消），同样视为用户取消，提前唤醒。 */
    const iv = setInterval(() => {
      const s = _cancelRegistry.get(group);
      if (s) for (const c of s) { if (c !== sentinel && c._userCancel) { clearTimeout(tim); clearInterval(iv); release(); resolve('CANCEL'); return; } }
    }, 200);
  }).then(r => {
    if (r === 'CANCEL') throw new Error('AI_TASK_CANCELLED 该任务已被取消');
  });
}

async function requestCompletions(cfg, body, timeoutMs) {
  let e = null;
  for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt++) {
    try {
      return await requestOnce(cfg, body, timeoutMs);
    } catch (err) {
      e = err;
      if (!aiShouldRetry(err)) throw err;
      if (attempt >= AI_MAX_ATTEMPTS - 1) throw err;
      const back = aiBackoffMs(err.status, attempt);
      await aiSleep(back, cfg.group);
    }
  }
  throw e;
}

async function requestOnce(cfg, body, timeoutMs) {
  if (!cfg || !cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new Error('AI 未配置完整（需 baseUrl/apiKey/model）');
  }
  budgetGuard(cfg); // U3-5：超出预算直接熔断，不再发起上游请求
  const url = String(cfg.baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const ms = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : (cfg.timeoutMs || 120000);
  const controller = new AbortController();
  const release = registerRun(cfg.group, controller);
  const t0 = Date.now();
  const label = cfg.label || 'AI';
  const timer = setTimeout(() => controller.abort(), ms);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer); release();
    const msNow = Date.now() - t0;
    if (e && e.name === 'AbortError') {
      if (controller._userCancel) { // 用户主动取消（cancelGroup 打标），才是「取消」
        recordUsage({ label, ms: msNow, cancelled: true, group: cfg.group });
        throw new Error('AI_TASK_CANCELLED 该任务已被取消');
      }
      throw new Error('AI 请求超时（超过 ' + Math.round(ms / 1000) + ' 秒）：连接/发送阶段无响应，请检查网络或调大「AI 配置」中的超时时间');
    }
    recordUsage({ label, ms: msNow, error: true, group: cfg.group });
    throw new Error('AI 请求发送失败（上游原因）：' + ((e && e.message) || e));
  }
  if (!resp.ok) {
    clearTimeout(timer); release();
    recordUsage({ label, ms: Date.now() - t0, error: true, status: resp.status, group: cfg.group });
    // 优先透传上游返回的具体错误信息，读不到再退化为状态码摘要
    let msg = 'AI 上游返回 ' + resp.status + ' ' + (resp.statusText || '');
    try {
      const j = await resp.json();
      if (j && j.error) msg = String(j.error.message || j.error.code || msg);
      else msg = msg + '（' + String(JSON.stringify(j)).slice(0, 300) + '）';
    } catch (_) {
      try { const t = await resp.text(); if (t) msg = msg + '：' + String(t).slice(0, 300); } catch (__) { msg += '（无法读取响应体）'; }
    }
    const httpErr = new Error(msg.trim());
    httpErr.status = resp.status;
    throw httpErr;
  }
  let j;
  try {
    j = await resp.json();
  } catch (e) {
    clearTimeout(timer); release();
    const msNow = Date.now() - t0;
    if (e && e.name === 'AbortError') {
      if (controller._userCancel) { // 用户主动取消
        recordUsage({ label, ms: msNow, cancelled: true, group: cfg.group });
        throw new Error('AI_TASK_CANCELLED 该任务已被取消');
      }
      throw new Error('AI 响应读取超时（超过 ' + Math.round(ms / 1000) + ' 秒）：已收到响应但长时间未完成，请调大超时时间后重试');
    }
    recordUsage({ label, ms: msNow, error: true, group: cfg.group });
    throw new Error('AI 响应解析失败：' + ((e && e.message) || e));
  }
  clearTimeout(timer); release();
  const u = (j && j.usage) || {};
  recordUsage({
    label,
    model: cfg.model,
    ms: Date.now() - t0,
    group: cfg.group,
    promptTokens: typeof u.prompt_tokens === 'number' ? u.prompt_tokens : undefined,
    completionTokens: typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined,
    totalTokens: typeof u.total_tokens === 'number' ? u.total_tokens : undefined
  });
  return j;
}

async function apiCall(cfg, system, user) {
  const j = await requestCompletions(cfg, {
    model: cfg.model,
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.5,
    max_tokens: cfg.maxTokens || 2000,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  }, cfg.timeoutMs);
  const c = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  return c;
}

/* 需要模型返回严格 JSON 的调用：优先声明 response_format(json_object) 以大幅提升“纯 JSON”合规率；
 * 若上游接口不支持该字段则自动去掉后重试一次，兼容各类 OpenAI 兼容网关。返回原始回复文本。 */
async function rawJsonReply(cfg, system, user, maxTokens) {
  const high = (typeof maxTokens === 'number' && maxTokens > 0) ? maxTokens : (cfg.maxTokens || 6000);
  const limit1 = Math.max(high, 2000);       // 首选上限：尽量给足，避免大 JSON 被截断
  // U1-14：结构化生成（JSON）默认更低随机性，降低「跑题/编造」概率；用户显式配置的 temperature 仍优先。
  const jsonTemp = typeof cfg.temperature === 'number' ? cfg.temperature : 0.3;
  const mk = (limit) => ({
    model: cfg.model,
    temperature: jsonTemp,
    max_tokens: limit,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  });
  const pick = (j) => (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  let j;
  // 用户主动取消必须直接抛出（不可重试）；超时/上游不支持 response_format 等才吞掉重试
  const isUserCancel = (e) => !!e && typeof e.message === 'string' && e.message.indexOf('AI_TASK_CANCELLED') === 0;
  try {
    j = await requestCompletions(cfg, Object.assign({}, mk(limit1), { response_format: { type: 'json_object' } }), cfg.timeoutMs);
    if (pick(j).length) return pick(j);
  } catch (_e) { if (isUserCancel(_e)) throw _e; }
  try {
    j = await requestCompletions(cfg, mk(limit1), cfg.timeoutMs); // 上游不支持 response_format → 去掉重试
    if (pick(j).length) return pick(j);
  } catch (_e2) { if (isUserCancel(_e2)) throw _e2; }
  // 部分模型不接收过大的 max_tokens（400）：退回保守上限兜底
  const cons = Math.min(limit1, Math.max(cfg.maxTokens || 4000, 3000));
  j = await requestCompletions(cfg, mk(cons), cfg.timeoutMs);
  return pick(j);
}

/* 从（可能夹带解释文字的）回复中稳健抽取一个 JSON 对象，容忍代码块与尾逗号；不是对象/解析失败返回 null */
function extractJsonObject(txt) {
  const s = String(txt || '').replace(/^\s*```[^\n]*\n?/, '').replace(/\s*```\s*$/, '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const frag = m[0].replace(/,\s*([}\]])/g, '$1'); // 宽容尾逗号
  try {
    const v = JSON.parse(frag);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch (_) {}
  // 整体带围栏失败时，再尝试去掉外部花括号包裹的重复层
  try { const v = JSON.parse(frag.replace(/^\{+/, '{').replace(/\}+$/, '}')); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch (__) {}
  return null;
}

/* ==================== 工具调用（函数调用 Function Calling） ====================
 * 开启「允许文件上传工具」时，AI 可在对话中检索工作台现存资料、读取用户上传的文本，
 * 工具则由主进程真实执行（而非仅在提示词里声明），并把结果回传给模型直到给出最终答复。 */
function toolContextFrom(cx) { return cx || {}; }

async function runTool(name, args, ctx) {
  args = args || {};
  ctx = toolContextFrom(ctx);
  if (name === 'workbook_search') {
    const kw = String(args.keyword || '').toLowerCase().trim();
    if (!kw) return JSON.stringify({ error: '缺少检索关键词 keyword' });
    const kinds = _K.filter(k => !args.kind || args.kind === k);
    const hits = [];
    for (const k of kinds) {
      for (const it of (ctx.entities && ctx.entities[k]) || []) {
        const blob = JSON.stringify(Object.assign({ name: it.name || it.title || '' }, it)).toLowerCase();
        if (!blob.includes(kw)) continue;
        hits.push({ kind: k, name: it.name || it.title || '未命名', 摘要: String(it.subtitle || it.summary || it.desc || it.content || it.note || '').slice(0, 80) });
        if (hits.length >= 15) break;   // U3-1：命中数与摘要长度收紧，工具结果不再灌满上下文
      }
      if (hits.length >= 15) break;
    }
    return JSON.stringify({ 命中条数: hits.length, items: hits.slice(0, 15) });
  }
  if (name === 'read_uploaded_file') {
    const want = String(args.name || '').toLowerCase().trim();
    const ups = (ctx.uploads || []).slice();
    let up = ups.find(u => u && u.name && String(u.name).toLowerCase() === want);
    if (!up) up = ups.find(u => u && u.name && String(u.name).toLowerCase().includes(want));
    if (!up) {
      const names = ups.map(u => u.name || '').filter(Boolean);
      return JSON.stringify({ error: '未找到上传文件：' + (args.name || '') + '。当前可用文件：' + (names.join('、') || '（无）') });
    }
    try {
      const fs = require('fs');
      const txt = fs.readFileSync(up.textPath || up.path || '', 'utf8');
      const cut = String(txt || '');
      const offset = Math.max(0, parseInt(args.offset, 10) || 0);
      const len = 26000;                       // 单次读取块大小
      const slice = cut.slice(offset, offset + len);
      const total = cut.length;
      const more = offset + slice.length < total;
      let head = '【文件「' + up.name + '」正文 · 第 ' + (offset === 0 ? '1' : Math.floor(offset / len) + 1) + ' / ' + Math.max(1, Math.ceil(total / len)) + ' 段 ｜ 总长度 ' + total + ' 字符，本次返回 ' + offset + '~' + (offset + slice.length) + '】\n';
      if (more) head += '（文件未读完，如需继续请用同一 name 与 offset=' + (offset + len) + ' 再读一次。）\n';
      return head + (slice || '（该偏移处已无内容）');
    } catch (e) {
      return JSON.stringify({ error: '读取文件失败：' + ((e && e.message) || e) });
    }
  }
  if (name === 'relations_query') {
    const kw = String(args.keyword || '').toLowerCase().trim();
    const r = (ctx.relations && typeof ctx.relations === 'object') ? ctx.relations : {};
    const nodes = (r.nodes || []).filter(n => n && n.label);
    const edges = (r.edges || []).filter(e => e && e.from && e.to);
    // 名称映射
    const nm = {}; for (const n of nodes) nm[n.id] = n.label;
    // 匹配关键词命中的节点 id
    const hitIds = new Set();
    for (const n of nodes) if (!kw || String(n.label).toLowerCase().includes(kw) || String(n.kind || '').toLowerCase().includes(kw)) hitIds.add(n.id);
    if (!kw) for (const n of nodes) hitIds.add(n.id);
    // 找出与命中节点相关的连线
    const items = edges.filter(e => hitIds.has(e.from) || hitIds.has(e.to) || !kw)
      .map(e => ({ from: nm[e.from] || e.from, to: nm[e.to] || e.to, label: e.label || '关系' }))
      .slice(0, 15);
    const hitNodes = nodes.filter(n => hitIds.has(n.id)).map(n => ({ label: n.label, kind: n.kind || '' })).slice(0, 15);
    return JSON.stringify({ 相关节点: hitNodes, 相关连线: items, 图总览: { 节点数: nodes.length, 连线数: edges.length } });
  }
  return JSON.stringify({ error: '未知工具：' + String(name) });
}

/* U3-1：工具定义每一轮都会随请求重发，描述越短每轮越省；此处只保留模型够用的信息。 */
const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'workbook_search',
      description: '按类别+关键词检索工作台已有资料（人物/NPC/地区/日志/怪物/规则/背景），返回名称与摘要。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: _K, description: '限定类别，省略则全部' },
          keyword: { type: 'string', description: '检索关键词' }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_uploaded_file',
      description: '读取用户上传文本文件的正文片段；长文件用 offset 续读。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '文件名' },
          offset: { type: 'integer', description: '起始字符位置，省略为 0' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'relations_query',
      description: '查询关系网中某实体的相邻节点与关系；省略关键词返回整图概览。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '实体名称关键词' }
        },
        required: []
      }
    }
  }
];

const MAX_TOOL_ITERS = 3;   // U3-1：工具往返上限 6→3，避免多轮重发 system/工具定义把费用滚大

/* ==================== 上下文压缩（防止文本量过大导致 AI 请求爆炸） ====================
 * 对话历史随聊天持续增长，若全量发给模型最终会超出上下文长度 / 显著放大延迟与费用，
 * 甚至被上游拒收。这里统一在组装请求时做三层保证：
 *   1) 滑动窗口：只保留「最近的」历史，旧消息从早往前裁掉；
 *   2) 摘要压缩：被裁掉的旧消息压缩成一段摘要并入请求（工具模式用 AI 摘要，普通对话用确定性摘要，
 *                均带 try/catch 与缓存兜底，绝不增加不可控延迟或报错）；
 *   3) 硬预算兜底：无论怎么裁，最终请求总估算 token 绝不超过上限，单条超大消息也被裁剪。 */
const CTX_BUDGET_TOKENS  = 24000;   // U3-2：单轮请求（含 system）的估算 token 硬上限（原 52000，过大导致每轮输入成本高）
const CTX_KEEP_TOKENS    = 15000;   // U3-2：保留给「最近消息窗口」的估算 token（原 34000）
const CTX_DIGEST_TOKENS  = 2600;    // 被裁剪前缀压成的摘要允许占用 token
const LORE_MAX_TOKENS    = 1500;    // U3-2：system 中「团背景/规则」注入上限（每轮都会重发，必须限长）
const PREFS_MAX_TOKENS   = 500;     // U3-2：system 中「用户偏好」注入上限
const MEMORY_MAX_TOKENS  = 1200;    // U3-2：system 中「长期记忆」注入上限（该段会随对话增长，最易失控）
const CTX_MIN_DROP       = 4;       // 至少裁掉这么多条才触发压缩摘要
const _digestCache = new Map();     // 旧消息前缀是只增不改的，命中缓存可避免重复 AI 摘要

/* 粗略估算 token：CJK 每字符≈1 token，其余每 3 字符≈1 token（只用于预算，无需精确） */
function estTokens(s) {
  const t = String(s == null ? '' : s);
  const cjk = (t.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f]/g) || []).length;
  return cjk + Math.ceil((t.length - cjk) / 3);
}
function clipToks(s, max) {
  let v = String(s || '');
  if (estTokens(v) <= max) return v;
  while (estTokens(v) > max && v.length > 2000) v = v.slice(0, Math.floor(v.length * 0.6));
  return v.slice(0, max * 8);
}
/* 确定性兜底摘要：每条保留一句要点，零额外 AI 成本 */
function textDigest(msgs) {
  const parts = [];
  for (const m of msgs || []) {
    const c = String(m.content || '').replace(/\s+/g, ' ').trim();
    if (!c) continue;
    parts.push((m.role === 'user' ? '用户' : 'AI') + '：' + c.slice(0, 160));
  }
  return clipToks(parts.join('\n'), CTX_DIGEST_TOKENS * 2);
}
/* AI 摘要：把被裁掉的旧对话浓缩成一段背景摘要；任何失败都回退到确定性摘要，绝不让请求抛错 */
async function aiDigest(cfg, msgs) {
  const body = (msgs || []).map(m => '【' + (m.role === 'user' ? '用户' : 'AI') + '】\n' + String(m.content || '')).join('\n\n');
  const user = '请把下面这段对话压缩成中文摘要（不超过 ' + CTX_DIGEST_TOKENS + ' token），保留关键设定、已确认事项、重要数值与结论，去掉寒暄、重复与客套，只输出摘要本身。\n\n' + clipToks(body, 20000);
  const sys = '你是上下文压缩器，只输出摘要文本，不要输出任何解释或评价。';
  try {
    const c = await apiCall(cfg, sys, user);
    return clipToks(c, CTX_DIGEST_TOKENS);
  } catch (_) {
    return textDigest(msgs);
  }
}
function droppedSig(msgs) {
  let s = (msgs || []).length + '\u0001';
  for (const m of msgs) s += (m.role || '') + '\u0002' + String(m.content || '').length + '\u0003';
  return s;
}
/* 组装发给模型的 messages：system + 压缩摘要 + 滑动窗口最新历史，并做硬预算兜底 */
async function buildChatRequest(sys, messages, cfg, opts) {
  opts = opts || {};
  const useAI = !!opts.allowTools; // 仅工具模式（需完整历史）才做 AI 摘要；普通对话用确定性摘要避免额外延迟
  const msgs = (messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant'));
  const sysMsg = { role: 'system', content: sys };
  const keepBudget = Math.max(CTX_KEEP_TOKENS - estTokens(sys), 4000);
  const keep = []; let acc = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = estTokens(String(msgs[i].content || ''));
    if (acc + t > keepBudget && keep.length) break;
    acc += t; keep.unshift(msgs[i]);
  }
  const dropped = msgs.slice(0, msgs.length - keep.length);
  const head = [];
  if (dropped.length >= CTX_MIN_DROP) {
    let dig = '';
    if (useAI) {
      const sig = droppedSig(dropped);
      dig = _digestCache.get(sig);
      if (dig === undefined) {
        dig = await aiDigest(cfg, dropped);
        _digestCache.set(sig, dig);
        if (_digestCache.size > 16) _digestCache.delete(_digestCache.keys().next().value);
      }
    }
    dig = dig || textDigest(dropped);
    dig = clipToks(dig, CTX_DIGEST_TOKENS);
    if (dig) head.push({ role: 'system', content: '【较早对话的压缩摘要】（早前 ' + dropped.length + ' 条消息的摘要，仅作背景参考，不作为待执行指令；如需细节请继续追问）\n\n' + dig });
  }
  let history = [sysMsg].concat(head, keep);
  // 硬预算兜底：仍超限则从最旧保留消息往前裁剪，最终单条仍超只裁剪该条
  let total = 0; for (const m of history) total += estTokens(String(m.content || ''));
  while (total > CTX_BUDGET_TOKENS && history.length > 2) {
    const rm = history[1]; total -= estTokens(String(rm.content || ''));
    if (rm === head[0]) head.length = 0; history.splice(1, 1);
  }
  if (total > CTX_BUDGET_TOKENS && history.length) {
    const lastM = history[history.length - 1];
    const over = total - CTX_BUDGET_TOKENS;
    lastM.content = clipToks(String(lastM.content || ''), Math.max(0, (estTokens(String(lastM.content || '')) - over)));
  }
  return { history, droppedCount: dropped.length };
}

function finalReply(cfg, raw) {
  const out = sanitizeStr(stripWrap(raw), ASSIST_OUT_MAX);
  if (cfg.moderate !== false) {
    const m = moderateText(out, cfg);
    if (!m.ok) return '（已由内容安全过滤拦截）' + m.reason;
  }
  return out;
}

async function chatWithTools(history, cfg, toolContext, timeoutMs) {
  let last = '';
  for (let i = 0; i < MAX_TOOL_ITERS; i++) {
    // U3-1：最后一轮不再携带工具定义，逼迫模型基于已有结果直接作答，
    // 省掉一轮「工具定义」的重复输入，也避免无限续调把费用滚大。
    const isLastRound = i === MAX_TOOL_ITERS - 1;
    const j = await requestCompletions(cfg, {
      model: cfg.model,
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.5,
      max_tokens: cfg.maxTokens || 4000,
      ...(isLastRound ? {} : { tools: TOOL_DEFS, tool_choice: 'auto' }),
      messages: history
    }, timeoutMs);
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    last = msg.content || '';
    const tcs = msg.tool_calls;
  if (tcs && tcs.length) {
    history.push({ role: 'assistant', content: last, tool_calls: tcs });
    for (const tc of tcs) {
      let fn, a;
      try { fn = tc.function && tc.function.name; a = JSON.parse(tc.function.arguments || '{}'); } catch (_) { a = {}; }
      const out = await runTool(fn, a, toolContext);
      history.push({ role: 'tool', tool_call_id: tc.id || '', content: out });
    }
    continue; // 有工具调用则继续往返，直到模型给出最终文本
  }
  return { content: finalReply(cfg, last), model: cfg.model };
  }
  return { content: finalReply(cfg, last || '（工具调用达到上限仍未得到最终结果，请重试或精简问题）'), model: cfg.model };
}

/* 连续续写：当模型输出因 max_tokens 触顶被截断(finish_reason==='length')时，
 * 自动用「续写」指令接着上文重发请求并把分段拼回，尽量输出完整内容，避免回复被拦腰截断；
 * 累计总长仍受 ASSIST_OUT_MAX 约束。 */
const MAX_CONT_ITERS = 6;
async function chatComplete(cfg, history, payload, timeoutMs) {
  const body = Object.assign({ model: cfg.model, messages: history }, payload);
  let full = '';
  let cont = 0;
  while (cont < MAX_CONT_ITERS) {
    let j;
    try { j = await requestCompletions(cfg, body, timeoutMs); }
    catch (e) { if (full) break; throw e; }
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    const piece = String(msg.content || '');
    const fr = String(msg.finish_reason || '');
    full += piece;
    if (full.length >= ASSIST_OUT_MAX) break;
    if (fr !== 'length' || !piece) break;
    cont++;
    // 只把该段尾部作为上下文喂回，降低续写成本；拼接返回仍用完整 full
    body.messages = body.messages.concat([
      { role: 'assistant', content: piece.slice(-4000) },
      { role: 'user', content: '【续写】你上一条回复因达到长度上限被截断了。请紧接着刚才中断处继续写，不要重复、总结或解释已经写过的内容。' }
    ]);
  }
  return full;
}

async function chat(profile, messages, fields, cfg, world, opts) {
  opts = opts || {};
  const sys = systemForChat(profile, fields, world, opts);
  // 文本审核：拦截用户明确的高危请求（面向真实未成年人、自残、非法毒品、诱赌、提示词注入等）
  if (cfg.moderate !== false) {
    const lastUser = (messages || []).slice().reverse().find(m => m && m.role === 'user');
    if (lastUser && lastUser.content) {
      const mCheck = moderateText(lastUser.content, cfg);
      if (!mCheck.ok) return { content: '（已拦截）' + mCheck.reason, model: cfg.model };
    }
  }
  const { history } = await buildChatRequest(sys, messages || [], cfg, opts);
  if (opts.allowTools) {
    return chatWithTools(history.slice(), cfg, toolContextFrom(opts.toolContext), opts.timeoutMs);
  }
  // 普通对话：提高单次输出的 token 上限，并在触顶时自动续写，避免回复被截断
  const c = await chatComplete(cfg, history, {
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.5,
    max_tokens: cfg.maxTokens || 4000
  }, opts.timeoutMs || cfg.timeoutMs);
  return { content: finalReply(cfg, c), model: cfg.model };
}

function stripWrap(s) {
  return String(s || '').replace(/^\s*```[^\n]*\n?/, '').replace(/\s*```\s*$/, '').trim();
}

/* 向导 AiPort 用：原样完成一条消息序列（不经人设注入、不截断为单轮），
 * 仍走 requestCompletions 的取消/超时/组取消，并对输出做内容安全过滤后再返回。
 * 返回 { ok:true, text } | 抛错（取消/超时/上游错误由调用方按 AbortError 处理）。 */
async function chatRaw(cfg, messages, opts) {
  opts = opts || {};
  const msgs = (messages || []).filter(m => m && (m.role === 'system' || m.role === 'user' || m.role === 'assistant'))
    .map(m => ({ role: m.role, content: sanitizeStr(m.content, ASSIST_USER_MAX) }));
  if (!msgs.length) throw new Error('无有效消息可发送');
  const j = await requestCompletions(cfg, {
    model: cfg.model,
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.5,
    max_tokens: cfg.maxTokens || 4000,
    messages: msgs
  }, opts.timeoutMs || cfg.timeoutMs);
  const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  return { ok: true, text: finalReply(cfg, raw) };
}

/* ==================== AI 稳健性公共设施：清洗 / 文本审核 / 输出收口 ====================
 * 统一解决这几类典型问题：
 *   文本审核 —— 拦截明确高危内容（真实未成年人、自残自杀、非法毒品、现实诱赌、性剥削、人口交易）及提示词注入；
 *   长度失控 —— 清洗内容控制字符、对超长输入做安全截断、对 AI 输出设置字符硬上限，避免界面与数据被撑爆；
 *   幻觉/胡思乱想 —— 结构化输出加 XML-JSON 双保险解析与字段白名单校验，AI 直接返回整段散文时也能抽出 JSON。 */
const ASSIST_OUT_MAX  = 24000;   // 单次 AI 助手回复保留的字符硬上限
const ASSIST_USER_MAX = 60000;   // 单次用户提问允许送入的最大字符数（超长只保留开头，避免费用爆炸）

/* 清洗文本：去掉控制字符/空字节、统一换行、按需截断 */
function sanitizeStr(s, max) {
  let v = String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (typeof max === 'number' && max > 0 && v.length > max) v = v.slice(0, max);
  return v;
}

/* 轻量文本审核（内容安全）。限于能力，它不追求覆盖万物，只拦截明确、可判定的高危场景，
 * 不会误伤 TRPG 中常见的虚构战斗 / 黑暗风格创作。由 cfg.moderate 开关控制（默认开）。
 * 规则可被用户在「AI 配置」里增删改，pattern 为 JS 正则字符串，reason 为展示给用户的拦截文案。 */
const DEFAULT_MOD_RULES = [
  { pattern: '未成年[人者]?.{0,10}(色情|裸露|性爱|私密|发生关系|性关系)', reason: '面向未成年人的性相关请求依法不予处理', enabled: true },
  { pattern: '(儿童|小孩|幼女|男童).{0,10}(色情|裸露|性爱|私密|性关系)', reason: '面向未成年人的性相关请求依法不予处理', enabled: true },
  { pattern: '把.{0,8}(未成年人|儿童|小孩).{0,10}(当|变成|脱|裸|性)', reason: '面向未成年人的性相关请求依法不予处理', enabled: true },
  { pattern: '教.{0,4}(自杀|自残|割腕|自戕|跳楼)', reason: '涉及自残/自杀指导不予处理', enabled: true },
  { pattern: '教我?(怎么)?(自杀|自残|割腕)', reason: '涉及自残/自杀内容不予处理', enabled: true },
  { pattern: '制作.{0,8}(冰毒|海洛因|摇头丸|氯胺酮|鸦片)', reason: '涉及非法毒品制作不予处理', enabled: true },
  { pattern: '(交易|贩卖|兜售|倒卖).{0,8}(未成年人|儿童)', reason: '涉及未成年人/人口交易不予处理', enabled: true },
  { pattern: '(遗弃|虐待).{0,6}(婴儿|儿童|未成年人)', reason: '涉及虐待儿童不予处理', enabled: true },
  { pattern: '忽略(之前|过往|所有).{0,4}(指令|规则|设定|提示词)', flags: 'i', reason: '检测到疑似提示词注入，已阻止', enabled: true },
  { pattern: '无视(以上|上述|之前).{0,4}(指令|规则|系统)', reason: '检测到疑似提示词注入，已阻止', enabled: true },
  { pattern: 'reveal.{0,6}(system prompt|instructions|上一条)', flags: 'i', reason: '检测到疑似提示词注入，已阻止', enabled: true }
];
function defaultModRules() { return DEFAULT_MOD_RULES.map(r => Object.assign({}, r)); }
function moderateText(s, cfg) {
  const cust = cfg && Array.isArray(cfg.modRules) && cfg.modRules.length ? cfg.modRules : null;
  // 默认安全规则必须始终保留（未成年/自残/毒品等硬性拦截），自定义规则在其后追加；
  // 否则用户加一条自定义规则会让全部默认安全拦截失效，形成安全隐患。
  const list = DEFAULT_MOD_RULES.filter(r => r.enabled !== false);
  if (cust) list.push.apply(list, cust.filter(r => r && r.pattern && r.enabled !== false));
  const txt = String(s == null ? '' : s);
  for (const r of list) {
    let re; try { re = new RegExp(r.pattern, r.flags || ''); } catch (_) { continue; }
    if (re.test(txt)) return { ok: false, reason: r.reason || '内容安全拦截' };
  }
  return { ok: true };
}

/* 从「可能夹带解释文件的文本」中稳健抽取 JSON（数组或对象），失败返回 null 而不是抛错 */
function extractJson(txt) {
  const s = String(txt || '');
  const picks = [() => s.match(/\[[\s\S]*\]/), () => s.match(/\{[\s\S]*\}/)];
  for (const p of picks) {
    const m = p(); if (!m) continue;
    const frag = m[0].replace(/,\s*([}\]])/g, '$1'); // 宽容尾逗号
    try { return { value: JSON.parse(frag) }; } catch (_) {}
  }
  return null;
}

/* ==================== U1-18 实体名称过滤 ====================
 * AI 拆剧本时会把「作者 / 译者 / 校对 / 主持人 / KP / NPC / 目录 / 序章」等元信息或
 * 纯类型词误当成人物落卡。这里在落卡前对 pcs / npcs 的 name 做黑名单 + 正则过滤，
 * 命中者移入 updates 供人工确认。内置词表之外，用户可用 settings.nameFilter = { words:[], allow:[] }
 * 追加自定义停用词 / 放行白名单。 */
const NAME_STOPWORDS = new Set([
  '作者', '编者', '编著', '译者', '翻译', '校对', '插画', '插图', '绘者', '绘图', '编辑', '责编', '排版', '美工',
  '设计', '出品', '版权', '策划', '监制', '顾问', '审校', '润色', '校对者', '目录', '序章', '序言', '序幕', '楔子',
  '前言', '后记', '附录', '索引', '摘要', '简介', '导读', '致谢', '参考文献', '注释', '说明', '概述', '梗概', '背景介绍',
  '主持人', '守秘人', '玩家', '骰娘', '机器人', '管理', '群主', '管理员', '规则书', '规则', '房规', '模组', '剧本',
  '团本', '手册', '指南', '世界观', '设定集', '资料集', '人物', '角色', '怪物', '敌人', '地区', '地点', '事件', '线索',
  '道具', '物品', '未命名', '无名', 'pc', 'npc', 'pl', 'kp', 'gm', 'dm', 'trpg', 'coc', 'dnd', 'san', 'hp', 'mp'
]);
const NAME_META_RE = /(作者|编著|编者|译者|翻译|校对|插画|插图|绘者|绘图|责编|编辑|排版|出品|版权|策划|监制|审校|润色|主持人|守秘人|骰娘|机器人|目录|序[章言幕]|楔子|前言|后记|附录|索引|参考文献|致谢)/;
/* 标题/正文类标点（人名一般不含这些符号）；「·」「-」「.」等常见于人名的连接符不在此列 */
const NAME_PUNCT_RE = /[\n\r\u3000，。、；：！？（）\[\]【】{}<>《》「」『』|\/\\]/;

/* 判定一个名称是否「不像人名」。extra = settings.nameFilter（可选） */
function looksLikeNonPersonName(name, extra) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return true;
  if (s.length > 15) return true;                                   // 一句话 / 描述，不是人名
  if (NAME_PUNCT_RE.test(s)) return true;                           // 含标题类标点
  const low = s.toLowerCase();
  const allow = (extra && extra.allow) || [];
  if (allow.some(a => String(a || '').trim().toLowerCase() === low)) return false; // 用户放行优先
  if (NAME_STOPWORDS.has(low)) return true;
  if (NAME_META_RE.test(s)) return true;
  // 空格/间隔号分隔的复合名：任一独立词命中停用词即判为非人名（如「NPC 守卫队长」）
  const toks = low.split(/[\s·]+/).filter(Boolean);
  if (toks.length > 1 && toks.some(t => NAME_STOPWORDS.has(t))) return true;
  const words = (extra && extra.words) || [];
  if (words.some(w => {
    const wl = String(w || '').trim().toLowerCase();
    return wl && (low === wl || low.indexOf(wl) >= 0);
  })) return true;
  return false;
}

/* ==================== U1-16 结构感知切分 ====================
 * 固定字符数硬切容易把一段剧情/一个角色卡拦腰截断。这里优先在章节/标题/编号行边界处切开，
 * 找不到合适边界时再回退到固定长度 + 重叠，兼顾「不漏信息」与「不打断结构」。 */
const SEG_HEAD_RE = /^(?:第\s*[0-9一二三四五六七八九十百零]+\s*[章节幕部篇回]|Chapter\s+\d+|CHAPTER\s+\d+|[0-9]{1,3}\s*[、.．)）]|[一二三四五六七八九十]+\s*[、.．)）]|#{1,6}\s|序章|序幕|楔子|终章|尾声|后记|附录)/;
const SEG_MAX = 400; // U3-4：分段数上限（入口正文 4MB 按最短切分约 350 段，留余量；避免切分本身丢内容）
function splitByStructure(text, target, overlap) {
  const t = String(text || '');
  if (t.length <= target) return [t];
  const out = [];
  let i = 0;
  const floorStep = Math.floor(target * 0.5);
  while (i < t.length) {
    let j = Math.min(i + target, t.length);
    if (j < t.length) {
      const floor = i + floorStep;
      let cut = -1;
      for (let k = j; k > floor; k--) {           // 从右往左找最近的标题行起点
        if (t[k] !== '\n') continue;
        const line = t.slice(k + 1, k + 48).replace(/^\s+/, '');
        if (SEG_HEAD_RE.test(line)) { cut = k; break; }
      }
      if (cut > i) j = cut;
    }
    out.push(t.slice(i, j));
    if (j >= t.length) break;
    i = Math.max(i + 1, j - overlap);
  }
  return out.filter(s => s && s.trim()).slice(0, SEG_MAX);
}

async function parseScript(text, profile, fields, cfg, existing, opts) {
  opts = opts || {};
  const prompts = effectivePrompts(opts.settings);
  const strict = opts.strict !== false; // 默认严格：未经使用者确认不允许增编
  const sys = hubSystem('registration', opts.settings, '你是一个 TRPG 跑团剧本拆分登记助手，只输出 JSON，不要输出任何解释文字。');
  const EXISTING = existing || {};
  const full = String(text || '');
  // U1-16：结构感知切分 + 受控并行分段（并发 3~5，取代逐段串行）
  const SEG = 24000, OVERLAP = 300;   // U3-4：段长提高、重叠减小（原 18000/600），减少重复注入的 token
  const CONC = Math.max(1, Math.min(5, Number(opts.concurrency) || 3));
  const onProg = typeof opts.onProgress === 'function' ? opts.onProgress : null; // U1-15：进度回调
  const nameFilter = (opts.settings && opts.settings.nameFilter) || null;        // U1-18：自定义过滤词
  const docTitle = String(opts.title || '').trim();
  /* 人物卡(PC)是玩家扮演的角色，分析团本/剧本时应排除：不生成 pcs 类别、不从现有 PC 名单去重 */
  const kinds = opts.excludePC === true ? _K.filter(k => k !== 'pcs') : _K.slice();
  const excludeNote = opts.excludePC === true
    ? '\n【特别注意】本次是解析团本/剧本：人物卡(PC)为玩家扮演的角色，不属于剧情实体。请勿生成/拆分出 pcs 类别，也不要引用或新增任何玩家人物卡，只识别 NPC 及其他类别。'
    : '';
  const FILTER_KINDS = opts.excludePC === true ? { npcs: 1 } : { pcs: 1, npcs: 1 };
  const segs = splitByStructure(full, SEG, OVERLAP);
  const segParsed = new Array(segs.length);
  const errors = [];
  const rejected = [];
  const t0 = Date.now();
  let done = 0;
  let cancelled = false;
  function emitProg() {
    if (!onProg) return;
    const elapsed = Date.now() - t0;
    const total = segs.length || 1;
    const eta = done > 0 ? Math.round(elapsed / done * (total - done)) : null; // U1-15：预计剩余
    try {
      onProg({
        phase: 'parse', done, total,
        percent: Math.min(100, Math.round(done * 100 / total)),
        text: '解析模组：已完成 ' + done + ' / ' + total + ' 段…',
        elapsedMs: elapsed, etaMs: eta
      });
    } catch (_) {}
  }
  emitProg();
  let cursor = 0;
  async function worker() {
    while (!cancelled) {
      const si = cursor++;
      if (si >= segs.length) return;
      const seg = segs[si];
      const existingForSeg = si === 0 ? EXISTING : {}; // 后续片段不再重复注入已有名单，合并时统一去重
      // U3-4：完整字段 schema 只在首段携带（字段约定各段一致，无需重复），
      // 后续段落改用极简 schema，单段即可省下数百 token，段数越多省得越多。
      const schemaForSeg = si === 0
        ? schemaText(effectiveFields(fields) || DEFAULT_FIELDS)
        : compactSchemaText(effectiveFields(fields) || DEFAULT_FIELDS);
      const makeUser = () => renderPrompt(prompts.registration, {
        schema: schemaForSeg,
        existing: JSON.stringify(existingMap(existingForSeg || {})),
        fragment: seg
      }, strict) + excludeNote;
      let lastErr = null;
      let parsed = null;
      // U3-4 补充：单段最多重试 3 次（仅在失败时触发，正常解析不产生额外请求），
      // 尽量让长文本「传一次就拆完整」，避免个别段落偶发坏 JSON 而需重传整份。
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const remind = (attempt > 1) ? '\n【要求纠正】你上一次的回复没有返回可解析的 JSON 对象。请只输出一个 JSON 对象（字段含 entities），不要输出任何解释文字、Markdown 代码块或包围标记；若输出过长会被截断，请务必紧凑地给出完整字段。' : '';
          // 剧本拆解输出量大，用更高 token 上限，避免完整 JSON 被截断成残缺对象
          const c = stripWrap(await rawJsonReply(cfg, sys, makeUser() + remind, 10000));
          const j = extractJsonObject(c);
          if (!j) throw new Error('未返回 JSON 对象');
          const ent = (j && j.entities) || j || {};
          for (const k of kinds) if (!Array.isArray(ent[k])) ent[k] = [];
          const empty = kinds.every(k => !Array.isArray(ent[k]) || !ent[k].length);
          if (empty) throw new Error('解析结果为空（未识别出任何实体）');
          const fe = effectiveFields(fields);
          parsed = { entities: {}, updates: Array.isArray(j && j.updates) ? j.updates : [] };
          for (const k of kinds) {
            const list = Array.isArray(ent[k]) ? ent[k] : [];
            parsed.entities[k] = list.map(item => normalize(item, fe[k], k)).slice(0, 40);
          }
          break;
        } catch (e) {
          lastErr = e;
          // U1-15：用户取消 → 停止调度剩余段落并保留已完成段
          if (String((e && e.message) || e).indexOf('AI_TASK_CANCELLED') === 0) { cancelled = true; return; }
          if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
        }
      }
      if (!parsed) errors.push('[段落 ' + (si + 1) + '] ' + ((lastErr && lastErr.message) || '未知错误'));
      else segParsed[si] = parsed;
      done++;
      emitProg();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, segs.length) }, worker));
  // 按段序合并（并行完成后统一按顺序归并，结果顺序稳定），跨段落按名称去重
  const merged = { entities: {}, updates: [] };
  kinds.forEach(k => merged.entities[k] = []);
  const seen = {}; kinds.forEach(k => seen[k] = new Set());
  for (let si = 0; si < segs.length; si++) {
    const parsed = segParsed[si];
    if (!parsed) continue;
    if (Array.isArray(parsed.updates)) for (const u of parsed.updates) merged.updates.push(u);
    for (const k of kinds) {
      for (const item of parsed.entities[k] || []) {
        const rawName = String(item.name || item.title || '').trim();
        const nm = rawName.toLowerCase();
        if (nm && seen[k].has(nm)) continue;
        // U1-18：人物类实体名称过滤（非人名/元信息词、与文档标题同名）→ 移入 updates 待人工确认
        if (FILTER_KINDS[k] && (looksLikeNonPersonName(rawName, nameFilter) || (docTitle && nm === docTitle.toLowerCase()))) {
          rejected.push({ kind: k, name: rawName });
          continue;
        }
        if (nm) seen[k].add(nm);
        merged.entities[k].push(item);
      }
    }
  }
  if (rejected.length) {
    merged.updates.push({
      type: '名称过滤',
      note: '以下名称疑似非人名/元信息（如 作者 / KP / NPC / 目录等），已移出人物类待人工确认：'
        + rejected.map(r => r.name + '（' + (KIND_LABEL[r.kind] || r.kind) + '）').join('、')
    });
  }
  if (segs.length && !kinds.some(k => merged.entities[k].length)) {
    if (cancelled) throw new Error('AI_TASK_CANCELLED 解析已取消');
    throw new Error('AI 拆分登记在重试后仍失败：' + (errors.join('；') || '所有段落均未识别出实体'));
  }
  /* U3-4 补充：个别分段失败时不静默丢内容——明确列出失败段落，便于用户只对该部分再拆一次，
   * 而不必因为「感觉没解析全」把整份长文本重新上传。 */
  if (!cancelled && errors.length) {
    merged.updates.push({
      type: '分段解析告警',
      note: '有 ' + errors.length + ' / ' + segs.length + ' 段未能解析（' + errors.slice(0, 6).join('；') + (errors.length > 6 ? ' 等' : '') + '），结果可能不完整；可只对上述段落的内容重新拆分一次，无需重传整份文本。'
    });
  }
  if (cancelled) { merged.partial = true; merged.cancelled = true; } // 已取消但有已完成段：返回部分结果
  emitProg();
  return merged;
}

function normalize(item, schema, kind) {
  const o = { source: '剧本解析' };
  const keys = new Set((schema || []).map(f => f.k));
  keys.add('desc'); // 兼容纳气字段
  for (const k of keys) {
    if (item[k] !== undefined && item[k] !== null && item[k] !== '') o[k] = item[k];
  }
  if (!o.name) o.name = (item.title) || '未命名';
  return o;
}

/* ==================== 输出按模板校验（T29） ====================
 * 在 JSON 解析成功之后、写入工作台之前，按字段 schema 对 AI 产物做结构校验：
 *   - 名称类字段（name/title）必须给出；
 *   - select 字段取值必须在可选范围内；
 *   - number 字段必须是数值；
 *   - tags 字段必须是字符串数组；
 * 返回不合格项的列表（每条含字段名与问题原因），供调用方在「自动重试一次」时把差异回传给模型修正。 */
function validateItemSchema(item, schema) {
  const issues = [];
  const byKey = {};
  for (const f of (schema || [])) byKey[f.k] = f;
  const nm = String((item && (item.name || item.title)) || '').trim();
  if (!nm) issues.push('名称字段（name/title）缺失，必须给出');
  for (const k of Object.keys(item || {})) {
    const f = byKey[k];
    if (!f) continue;             // 不在 schema 中的键：属扩展字段，宽容放行
    const v = item[k];
    if (v === undefined || v === null || v === '') continue;
    if (f.t === 'select') {
      const opts = f.opts || [];
      if (opts.length && !opts.some(o => String(o) === String(v))) issues.push('字段『' + k + '』取值「' + String(v) + '」不在可选范围 [' + opts.join(' / ') + ']');
    } else if (f.t === 'number') {
      const n = Number(v);
      if (!isFinite(n)) issues.push('字段『' + k + '』应为数字，实得「' + String(v) + '」');
    } else if (f.t === 'tags') {
      if (!Array.isArray(v)) issues.push('字段『' + k + '』应为字符串数组，实得「' + String(Array.isArray(v) ? '数组' : typeof v) + '」');
    }
  }
  return issues;
}
/* 把校验差异整理成给模型的纠正指引（重试一次时把它附在要求纠正提示里，让模型按原因修正） */
function issuesToHint(issues) {
  if (!issues || !issues.length) return '';
  return '\n- ' + issues.join('\n- ');
}

/* 按类型生成一条结构化实体卡（人物卡/NPC/地区/日志/怪物/规则/背景）。
 * 让 AI 直接按该类型字段 schema 填字段并返回 JSON，经校验与重试后归一化，
 * 确保生成的卡能真正落到工作台对应字段，不再丢失正文。
 * ctx：可选，传入最近对话/待处理内容作为上下文，让建卡从对话中提取信息而非随机编造。 */
const KIND_LABEL = { pcs: '人物卡(PC)', npcs: 'NPC', regions: '地区', logs: '日志', mobs: '怪物', rules: '规则/房规', lore: '背景设定' };
async function generateEntity(kind, tip, profile, fields, cfg, settings, ctx) {
  const fe = effectiveFields(fields) || DEFAULT_FIELDS;
  const kindSchema = (fe[kind] || []).length ? fe[kind] : (DEFAULT_FIELDS[kind] || []);
  const world = (settings && settings.appName) || '当前团';
  const label = KIND_LABEL[kind] || kind;
  const fieldInstr = kindSchema.map(f => {
    if (f.t === 'select') return '"' + f.k + '"：' + f.l + '（选其一：' + ((f.opts || []).join('/') || '—') + '）';
    if (f.t === 'number') return '"' + f.k + '"：' + f.l + '（数字）';
    if (f.t === 'tags') return '"' + f.k + '"：' + f.l + '（字符串数组）';
    return '"' + f.k + '"：' + f.l;
  }).join('\n');
  const sys = '你是 TRPG《' + world + '》的内容创作助手，正在使用跑团工作台。用户请你生成一条' + label + '。你只能输出一个 JSON 对象（不要 Markdown 代码块、不要任何解释文字），字段键名必须严格使用给定的字段名，缺失内容可省略该键，但名称类字段必须给出。';
  let user = '请为当前工作台创作一条' + (tip ? '「' + tip + '」' : '') + label + '。\n可用的字段（键名·含义）：\n' + fieldInstr
    + '\n请用中文填写/创作这些字段，内容要具体、贴合 TRPG 设定，有辨识度与可用性。';
  const convText = String(ctx || '').trim().slice(0, 8000);
  if (convText) user += '\n\n以下是我们之前对话/待处理的内容，请优先从中提取相关人物、设定、状态来填写本条卡片，与上下文保持一致：\n' + convText + '\n\n若上下文不足，再据 TRPG 设定合理补全，不要在已有明确信息处随机编造。';
  let lastErr = null;
  let lastIssues = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const u = (attempt > 1)
        ? user + '\n【要求纠正】你上一次的回复没有通过结构校验。问题如下：' + issuesToHint(lastIssues.length ? lastIssues : ['未返回合规的 JSON 对象']) + '\n请按以上原因修正后再输出。只输出一个 JSON 对象，字段键名使用给定的字段名，不要输出任何解释、Markdown 代码块或包围标记。'
        : user;
      const c = stripWrap(await rawJsonReply(cfg, sys, u));
      const j = extractJsonObject(c);
      if (!j) throw new Error('未返回 JSON 对象');
      const issues = validateItemSchema(j, kindSchema);
      if (issues.length) { lastIssues = issues; throw new Error('结构校验未通过：' + issues.join('；')); }
      const obj = normalize(j, kindSchema, kind);
      obj.source = 'AI 生成';
      return obj;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
    }
  }
  throw new Error('AI 生成失败：' + ((lastErr && lastErr.message) || '未知错误'));
}

/* 按模板批量生成某类结构化实体卡（多实体提取）。
 * 让 AI 依据给定模板 schema 从上下文/对话中提取「全部」合适条目，每条一张卡，返回数组；
 * 若上下文无明确实体则回退创作 1 条。结果会挂上所用模板 id(tpl)，供界面按模板渲染。
 * tplId：可选；传则使用该模板在 kind 类别的字段 schema，否则用全局字段。
 * mode：可选；'single'=生成恰好 1 条新卡；'extract'（默认）=从上下文提取多条。 */
async function generateEntities(kind, tip, profile, fields, cfg, settings, ctx, tplId, mode) {
  const single = mode === 'single';
  const templates = effectiveTemplates(settings);
  const fe = effectiveFields(fields) || DEFAULT_FIELDS;
  const defaultSchema = (fe[kind] || []).length ? fe[kind] : (DEFAULT_FIELDS[kind] || []);
  const kindSchema = tplSchema(templates, tplId, kind, defaultSchema);
  const world = (settings && settings.appName) || '当前团';
  const label = KIND_LABEL[kind] || kind;
  const tpl = tplId ? (templates.find(x => x.id === tplId) || null) : null;
  const tplLine = tpl ? '（使用规则书模板「' + tpl.name + '」）' : '';
  const fieldInstr = kindSchema.map(f => {
    if (f.t === 'select') return '"' + f.k + '"：' + f.l + '（选其一：' + ((f.opts || []).join('/') || '—') + '）';
    if (f.t === 'number') return '"' + f.k + '"：' + f.l + '（数字）';
    if (f.t === 'tags') return '"' + f.k + '"：' + f.l + '（字符串数组）';
    return '"' + f.k + '"：' + f.l;
  }).join('\n');
  const sys = single
    ? '你是 TRPG《' + world + '》的内容创作助手，正在使用跑团工作台。用户请你创作恰好 1 条' + label + tplLine + '。你只能输出一个 JSON 对象（不要 Markdown 代码块、不要任何解释文字），结构为 {"entities":[{字段...}]}；entities 数组里只能有 1 个对象，字段键名必须严格使用给定的字段名，缺失内容可省略该键，但名称字段必须给出。'
    : '你是 TRPG《' + world + '》的内容创作助手，正在使用跑团工作台。用户请你生成一张或多张' + label + tplLine + '。你只能输出一个 JSON 对象（不要 Markdown 代码块、不要任何解释文字），结构为 {"entities":[{字段...}, ...]}；字段键名必须严格使用给定的字段名，缺失内容可省略该键，但名称字段必须给出。';
  let user = single
    ? '请为当前工作台创作恰好 1 条全新的「' + label + '」' + (tip ? '，主题/要求：' + tip : '') + '，放进 entities 数组（只含 1 个对象）。\n要求：\n'
      + '- 这是「生成 1 条」模式：只产出 1 条全新条目，不要罗列、不要提取多条；\n'
      + '- 内容要具体、贴合 TRPG 设定、有辨识度与可用性；名称不得与下方已有条目重复；\n'
      + '- 填写字段须符合下方 schema，不要往字段里塞入与字段含义无关的内容。\n可用的字段（键名·含义）：\n' + fieldInstr
      + '\n请用中文填写/创作。'
    : '请依据当前工作台/对话上下文，识别其中所有适合作为「' + label + '」的独立条目，每一条生成一张资料卡，统一放进 entities 数组。\n要求：\n'
      + '- 上下文/对话里明确提到的多个实体，请全部提取、一不落，不要合并、不要漏掉；\n'
      + '- 若上下文中没有明确的新实体，或上下文为空，则按模板创作恰好 1 条合理、有辨识度的' + label + '；\n'
      + '- 每条卡填写的字段须符合下方 schema。\n可用的字段（键名·含义）：\n' + fieldInstr
      + '\n请用中文填写/创作，内容具体、贴合 TRPG 设定，多张卡片之间要有区分度。';
  const convText = String(ctx || '').trim().slice(0, 8000);
  if (convText) user += (single
    ? '\n\n以下是可参考的上下文（仅供风格与设定对齐；请只据此创作 1 条新条目，不要从上下文直接复制出多条）：\n'
    : '\n\n以下是我们之前对话/待处理的内容，请优先从中提取条目来填卡片，与上下文保持一致：\n') + convText;
  let lastErr = null;
  let lastIssues = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const u = (attempt > 1)
        ? user + '\n【要求纠正】你上一次的回复没有通过结构校验。问题如下：' + issuesToHint(lastIssues.length ? lastIssues.slice(0, 12) : ['未返回合规的 JSON 对象']) + '\n请按以上原因修正。只输出一个 JSON 对象，entities 为数组，字段键名使用给定的字段名，不要输出任何解释、Markdown 代码块或包围标记。'
        : user;
      const c = stripWrap(await rawJsonReply(cfg, sys, u, 9000));
      const j = extractJsonObject(c);
      if (!j) throw new Error('未返回 JSON 对象');
      let arr = Array.isArray(j.entities) ? j.entities : (Array.isArray(j) ? j : ((j.name || j.title) ? [j] : []));
      if (!arr.length) throw new Error('未提取到任何实体（entities 为空数组）');
      /* 结构校验：逐条检查，汇总全部差异（含缺名/字段类型不符），供回传模型修正 */
      const allIssues = [];
      arr.forEach((item, idx) => validateItemSchema(item, kindSchema).forEach(iss => allIssues.push('第 ' + (idx + 1) + ' 条：' + iss)));
      if (allIssues.length) { lastIssues = allIssues.slice(0, 12); throw new Error('结构校验未通过：' + allIssues.slice(0, 4).join('；')); }
      arr = arr.map(item => {
        const obj = normalize(item, kindSchema, kind);
        obj.source = 'AI 生成';
        if (tplId) obj.tpl = tplId;
        return obj;
      }).filter(x => x.name && x.name !== '未命名');
      if (!arr.length) throw new Error('提取到的实体缺少名称');
      return single ? arr.slice(0, 1) : arr.slice(0, 20);
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
    }
  }
  throw new Error('AI 生成失败：' + ((lastErr && lastErr.message) || '未知错误'));
}

/* 依据导入的规则书/设定资料，让 AI 归纳出一套「人物卡模板」（字段 schema）。
 * 返回 {name, note, fields:{pcs:[...]}}，调用方把它并入 settings.templates 供所有人选用。 */
async function genTemplateFromRules(cfg, rulesText) {
  const sys = '你是 TRPG 规则书归纳助手。用户会给你一段规则书/设定资料，你要据此提炼出一套适合绘制该规则「人物卡(PC)」的字段 schema。你只能输出一个 JSON 对象（不要 Markdown 代码块、不要任何解释文字）。';
  let user = '请把下面资料涉及的角色属性、资源数值与特色系统归纳为人物卡字段。\n输出 JSON：'
    + '{"name":"模板名(如：XXX 人物卡)","note":"一句话说明该模板特点","fields":{"pcs":[{"k":"英文键","l":"中文显示名","t":"text|textarea|number|select|tags",可选"opts":["中文选项",...]}, ...]}}\n要求：\n'
    + '- 每个键 k 用英文(小写、不含空格)，显示名 l 用中文；\n- 类型 t 只能是 text/textarea/number/select/tags 之一；select 必须给出 opts 中文选项；\n'
    + '- 应覆盖该规则的属性/能力值、生命或资源类数值、技能/擅长类别等，数量 8~24 个，贴合该规则的特色系统；\n'
    + '- 列表开头两项应为「姓名」与「玩家」，随后是属性与数值。\n【规则书内容】\n' + String(rulesText || '').slice(0, 10000); // U3-3：模板生成输入 18000→10000，控制单次成本
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const c = stripWrap(await rawJsonReply(cfg, sys, user));
      const j = extractJsonObject(c);
      if (!j) throw new Error('未返回 JSON 对象');
      let arr = Array.isArray(j.fields) ? j.fields : ((j.fields && Array.isArray(j.fields.pcs)) ? j.fields.pcs : (Array.isArray(j.pcs) ? j.pcs : null));
      if (!Array.isArray(arr) || !arr.length) throw new Error('未返回人物卡字段集');
      const seen = new Set(); const fields = [];
      for (const f of arr) {
        if (!f || typeof f !== 'object') continue;
        const k = String(f.k || f.key || '').trim().replace(/\s+/g, '_');
        if (!k || seen.has(k)) continue;
        const l = String(f.l || f.label || k);
        const t = ['text', 'textarea', 'number', 'select', 'tags'].includes(f.t) ? f.t : 'text';
        const item = { k, l, t };
        if (t === 'select' && Array.isArray(f.opts) && f.opts.length) item.opts = f.opts.map(x => String(x)).slice(0, 20).filter(Boolean);
        seen.add(k); fields.push(item);
      }
      if (!fields.some(f => f.k === 'name')) fields.unshift({ k: 'name', l: '姓名', t: 'text' });
      if (!fields.length) throw new Error('字段集为空');
      const name = (String(j.name || j.title || '').trim().slice(0, 24)) || '自定义模板';
      return { name, note: String(j.note || '由 AI 依据规则书生成').trim().slice(0, 60), fields: { pcs: fields } };
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
    }
  }
  throw new Error('AI 生成模板失败：' + ((lastErr && lastErr.message) || '未知错误'));
}

/* ---- 地图要素生成：AI 依据文字描述（可选：底图已由用户上传，AI 不看图只读文字）----
 * 返回规范化地图要素 JSON：{grid:{size}, markers:[{type,label,x,y}],
 *   regions:[{label,points:[[x,y],...]}], fog:[{path:[[x,y],...]}], note}
 * x/y 均为“底图相对比例 0~1”，由前端换算成实际像素，避免不同分辨率漂移。 */
const MAP_TYPE_CN = { mob: '怪物', npc: 'NPC', plot: '剧情点', exit: '入口/出口', area: '区域块' };
function clamp01(n) { n = Number(n); if (!isFinite(n)) return 0; return Math.min(1, Math.max(0, n)); }
function normPoly(p) {
  if (!Array.isArray(p)) return null;
  const pts = [];
  let maxAbs = 0;
  for (const pt of p) { if (Array.isArray(pt) && pt.length >= 2) maxAbs = Math.max(maxAbs, Math.abs(Number(pt[0]) || 0), Math.abs(Number(pt[1]) || 0)); }
  const scale = (maxAbs > 1.5) ? 100 : 1;   // >1.5 视为 0~100 百分比，否则即 0~1
  for (const pt of p) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]), y = Number(pt[1]);
    if (!isFinite(x) || !isFinite(y)) continue;
    pts.push([clamp01(x / scale), clamp01(y / scale)]);
  }
  return pts.length >= 3 ? pts : null;
}
async function generateBoard(cfg, text, opts) {
  opts = opts || {};
  const baseW = Math.max(1, Number(opts.baseW) || 1280);
  const baseH = Math.max(1, Number(opts.baseH) || 800);
  const sys = '你是资深 TRPG 主持人（KP/PL 带团）与地图布局助手。你会收到一段与场景/地图有关的文字描述。'
    + '请据此设计一张跑团地图的“要素定义”，纯粹输出一个 JSON 对象（不要 Markdown 代码块、不要解释文字）。'
    + '你必须只输出：{"grid":{"size": <建议网格边长像素，如32/48/64>},'
    + '"markers":[{"type":"mob|npc|plot|exit|area","label":"中文名","x":0~1,"y":0~1}],'
    + '"regions":[{"label":"区域中文名","points":[[x,y],...至少3点,均为0~1]}],'
    + '"fog":[{"path":[[x,y],...至少3点,均为0~1]}],'
    + '"note":"一句话带团提示"}'
    + '要求：- marker/region/fog 的坐标范围均为 0 到 1（相对整幅底图，左上是0,0，右下是1,1）；'
    + '- markers 的类型只能取 mob/npc/plot/exit/area 之一，含义：' + JSON.stringify(MAP_TYPE_CN) + '；'
    + '- 依据文字把“关键地点/入口/怪物/NPC/剧情点”尽量都布置进去，数量克制（一般 3~15 个 marker、0~5 个 region、1~6 块 fog 遮罩）；'
    + '- fog 表示被遮住、玩家还没探索到的区域轮廓；region 表示有名字的大区域；两者都是多边形；'
    + '- 若文字没有地图信息，则给出一套通用的开局布局（含 1~3 个 marker 与 1 块 fog）。';
  const user = '底图比例大约是 ' + baseW + ':' + baseH + '。请给下面这段描述设计地图要素（只输出 JSON）：\n【文字】\n'
    + String(text == null ? '' : text).slice(0, 10000); // U3-3：地图生成输入 18000→10000，控制单次成本
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const c = stripWrap(await rawJsonReply(cfg, sys, user));
      const j = extractJsonObject(c);
      if (!j || typeof j !== 'object') throw new Error('未返回 JSON 对象');
      const out = {
        grid: { size: Math.min(200, Math.max(16, Number((j.grid && j.grid.size) || 48)) || 48) },
        markers: [],
        regions: [],
        fog: []
      };
      if (Array.isArray(j.markers)) {
        for (const m of j.markers.slice(0, 40)) {
          if (!m || typeof m !== 'object') continue;
          const type = MAP_TYPE_CN[m.type] ? String(m.type) : 'plot';
          out.markers.push({
            type, label: String(m.label || MAP_TYPE_CN[type] || '标记').slice(0, 24),
            x: clamp01(m.x), y: clamp01(m.y)
          });
        }
      }
      if (Array.isArray(j.regions)) {
        for (const r of j.regions.slice(0, 12)) {
          const pts = normPoly(r && r.points);
          if (pts && pts.length >= 3) out.regions.push({ label: String((r && r.label) || '区域').slice(0, 20), points: pts });
        }
      }
      if (Array.isArray(j.fog)) {
        for (const f of j.fog.slice(0, 12)) {
          const pts = normPoly(f && f.path);
          if (pts && pts.length >= 3) out.fog.push({ path: pts });
        }
      }
      out.note = String(j.note || '').slice(0, 200);
      return out;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
    }
  }
  throw new Error('AI 生成地图要素失败：' + ((lastErr && lastErr.message) || '未知错误'));
}

/* 数据一致性审查：把当前档案快照交给 AI 检查重复/冲突/缺失/异常 */
async function auditData(cfg, doc, world) {
  const fields = effectiveFields(doc);
  // U3-3：只传「轻量清单」——名称 + 少量关键字段 + 正文摘要截断，
  // 避免整档全字段快照（原最多 8 万字符 ≈ 4 万 token）把单次审查成本推高。
  const KEEP_FIELDS = ['name', 'title', 'subtitle', 'summary', 'type', 'kind', 'level', 'status', 'hp', 'region', 'tags', 'note', 'desc'];
  const snapshot = {};
  for (const k of _K) {
    const arr = (doc.entities && doc.entities[k]) || [];
    snapshot[k] = arr.map((x) => {
      const o = {};
      for (const key of KEEP_FIELDS) {
        const v = x && x[key];
        if (v == null || v === '') continue;
        o[key] = typeof v === 'string' ? String(v).slice(0, 120) : v;
      }
      const body = x && (x.content || x.text);
      if (body) o.正文摘要 = String(body).slice(0, 200);
      return o;
    });
  }
  const sys = '你是一位严谨的 TRPG 数据审查员。下面是一次跑团工作台的数据快照。'
    + '请逐类检查：疑似重复条目、同一实体不同卡片信息冲突、前后不一致、缺失关键字段(如名字)、数值或状态异常、明显的错别字或录入错误。'
    + '对每个问题按编号列出：①类别+名称 ②问题描述 ③建议的修改。'
    + '若某类没有发现问题请跳过；若整体未发现问题，最后明确写一行“未发现明显问题”。'
    + '回答只使用中文，条理清晰，不要客套。';
  const user = '数据快照：\n' + JSON.stringify(snapshot, null, 1);
  const c = await apiCall(cfg, sys, String(user || '').slice(0, 40000));
  return { content: stripWrap(c), model: cfg.model };
}

/* 关系网：依据现有资料清单与既有连线，让 AI 推断「新增/修正/删除」关系。
 * 返回操作数组：[{op:'add'|'edit'|'del', from, to, label?}]，姓名严格取自清单，
 * edit/del 仅针对已存在连线，杜绝 AI 凭空乱改乱删（防幻觉/防破坏）。 */
function parseJsonObj(txt) {
  const x = extractJson(txt);
  if (!x) throw new Error('响应中未找到合法 JSON');
  return x.value;
}
async function suggestRelations(entities, relations, cfg) {
  const lines = [];
  const kl = { pcs: '人物卡', npcs: 'NPC', regions: '地区', logs: '日志', mobs: '怪物', rules: '规则', lore: '背景' };
  for (const k of _K) {
    for (const it of ((entities && entities[k]) || []).slice(0, 90)) {
      const nm = it.name || it.title; if (!nm) continue;
      const tag = [kl[k] || k, it.faction, it.subtitle || it.role].filter(Boolean).join(' · ');
      lines.push((tag ? nm + '(' + tag + ')' : nm));
    }
  }
  const nodes = ((relations && relations.nodes) || []).filter(n => n && n.id);
  const edges = ((relations && relations.edges) || []).filter(e => e && e.from && e.to);
  const id2n = {}; for (const n of nodes) id2n[n.id] = String(n.label || '').trim();
  const pairKey = (a, b) => [String(a || '').trim(), String(b || '').trim()].sort().join('␟');
  const existingPairs = new Set();
  for (const e of edges) { const a = id2n[e.from] || e.from, b = id2n[e.to] || e.to; if (a && b && a !== b) existingPairs.add(pairKey(a, b)); }
  const existingReadable = edges.map(e => (id2n[e.from] || e.from) + '——(' + (e.label || '关系') + ')——' + (id2n[e.to] || e.to));
  const sys = '你是世界观关系网协同助手。基于给定清单与已有连线，判断应新增、修正或删除哪几条连线。只输出合法 JSON 数组，不要任何解释、注释或 markdown 代码块。';
  const user = '输出 JSON 数组，每项是一个操作对象，支持三种类型：\n'
    + '新增：{"op":"add","from":"X","to":"Y","label":"关系说明(4~15字，如 师徒/敌对/私下结盟/隶属于火鳞商会/血亲/线索指向)"}\n'
    + '修正：{"op":"edit","from":"X","to":"Y","label":"纠正后的关系说明"}，from/to 必须是一对已有连线\n'
    + '删除：{"op":"del","from":"X","to":"Y"}，from/to 必须是一对已有连线，仅当确认该关系不合理或名存实亡时才删\n'
    + '要求：from、to 必须严格来自下方清单中的名称；add 的 from/to 不得与现有连线重复；edit/del 只能针对已有连线（正反方向皆可）；避免给只是“同属一大势力”的所有人都互相连线；优先保留最显著、对剧情推进最有价值的关系；每个操作都要确有必要，总量控制在 3~15 条。'
    + '\n\n现有连线（供 add 去重、edit/del 定位）：' + (existingReadable.length ? existingReadable.join('　') : '（暂无）')
    + '\n\n清单\n' + (lines.join('\n').slice(0, 12000) || '（清单为空）');
  const raw = await apiCall(cfg, sys, user);
  let arr = [];
  try { arr = parseJsonObj(raw); } catch (_) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  const nameSet = new Set(lines.map(l => l.split('(')[0].trim()));
  const out = [];
  const pick = (v) => { const f = String(v || '').trim(); return f || null; };
  for (const it of arr) {
    const opRaw = String(it.op || it.action || (it.label ? 'add' : 'del'));
    const op = opRaw === 'edit' ? 'edit' : opRaw === 'del' ? 'del' : 'add';
    const f = pick(it.from || it.a), t = pick(it.to || it.b);
    if (!f || !t || f === t) continue;
    if (!nameSet.has(f) || !nameSet.has(t)) continue; // 姓名白名单，防幻觉捏造节点
    const pk = pairKey(f, t);
    if (op === 'del') {
      if (!existingPairs.has(pk)) continue; // 只允许动已有连线
      out.push({ op: 'del', from: f, to: t });
    } else if (op === 'edit') {
      if (!existingPairs.has(pk)) continue;
      out.push({ op: 'edit', from: f, to: t, label: sanitizeStr(String(it.label || '关系')).slice(0, 20) || '关系' });
    } else {
      if (existingPairs.has(pk)) continue;   // 新增不得与现有连线重复
      out.push({ op: 'add', from: f, to: t, label: sanitizeStr(String(it.label || it.rel || '关系')).slice(0, 20) || '关系' });
    }
  }
  // 去重 + 总量上限，防止 AI 反复输出同批内容造成「胡乱思考」
  const seen = new Set(); const dedup = [];
  for (const o of out) { const k = o.op + '|' + pairKey(o.from, o.to); if (seen.has(k)) continue; seen.add(k); dedup.push(o); }
  return dedup.slice(0, 30);
}

/* 原始文本「带团建议」：保留原文结构与内容，在关键句子之后用标记插入一条主持(带团)建议/方案，
 * 返回带标记的增强文本，格式为 〔建议〕...〔/建议〕；渲染层会把标记换成彩色括号内联样。 */
const SUGGEST_OPEN = '〔建议〕';
const SUGGEST_CLOSE = '〔/建议〕';
async function suggestScript(text, profile, fields, cfg, settings, opts) {
  opts = opts || {};
  const world = (settings && settings.appName) || '当前团';
  const persona = (opts.usePersona !== false && profile && profile.name) ? '，并适度借鉴人设「' + profile.name + '」的口吻与风格' : '';
  const sys = '你是 TRPG《' + world + '》的一位资深 KP/主持，经验老到' + persona + '。'
    + '你会收到一段跑团文本（剧本、战报或设定）。请在你认为真正值得提示的地方，紧跟在相应的句子之后插入一条带团建议或方案，'
    + '用一对固定标记包裹，只包裹建议内容本身，不要改动、删减或重排原文的任何一个字符与段落。\n'
    + '标记格式（必须成对、只在建议内容处使用）：' + SUGGEST_OPEN + '建议内容' + SUGGEST_CLOSE + '\n'
    + '要求：\n'
    + '- 建议务实可落地，切合主持视角：节奏与气氛把控、NPC 的扮演要点、遭遇强度与数值微调、线索与伏笔的埋设、玩家决策分叉与备选方案、容易被忽视的风险与坑点、剧情卡住时的兜底策略等；\n'
    + '- 建议内容用简洁中文，一句话到两三句话，语气直接对主持说话，可带明确做法；\n'
    + '- 只在真正会帮助主持的地方插入，不必每句都加，总量克制（约每 3~6 段加一条，重点场景可稍密）；\n'
    + '- 全程不得删除、改写或遗漏任何原文内容，必须把完整文本连同插入的建议一起输出。';
  const user = '请给下面这段跑团文本添加带团建议（标记法注入，保留全文）：\n\n【文本】\n' + sanitizeStr(String(text == null ? '' : text), 60000);
  const c = await apiCall(cfg, sys, user);
  const raw = stripWrap(String(c || ''));
  if (raw.indexOf(SUGGEST_OPEN) >= 0) return sanitizeStr(raw, 70000);
  // 兜底：模型未按标记输出时，把整段回复作为一条建议附在文末（至少给用户可用结果），并加 IGNORED 标记供渲染层识别
  return sanitizeStr(String(text == null ? '' : text), 60000) + '\n\n' + SUGGEST_OPEN + 'AI 未能按标记插入建议，改在文末汇总：' + raw + SUGGEST_CLOSE;
}

/* C1/C3：一键剧情要点总结 → 长期记忆条目。
 * 依据近期会话/日志提炼值得长期记住的要点，输出 {"points":["…",…]}。 */
async function plotSummary(cfg, content, memoryText) {
  const sys = '你是 TRPG 跑团剧本分析助手。下面给出一段近期跑团对话/日志内容。请提炼其中值得长期记住的剧情要点、人物线索、伏笔与关键设定，输出严格 JSON 对象：{"points":["要点1","要点2",...]}。要求：每条一句话、具体、可独立理解、不要编号前缀，最多 12 条；若内容太少则返回 {"points":[]}。只输出 JSON，不要解释。';
  const user = '【现有长期记忆（避免重复收录）】\n' + (String(memoryText || '').trim() || '（无）') + '\n\n【近期内容】\n' + String(content || '').slice(0, 16000); // U3-3：剧情要点输入 32000→16000
  const raw = await rawJsonReply(cfg, sys, user, 1600);
  const obj = extractJsonObject(raw);
  let points = [];
  if (obj && Array.isArray(obj.points)) {
    points = obj.points.map(x => sanitizeStr(x, 200).trim()).filter(s => s && s.length >= 4).slice(0, 12);
  }
  if (!points.length) {
    // 兜底：模型未按 JSON 输出时，按行/编号拆散
    points = sanitizeStr(raw, 4000).split('\n').map(s => s.replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/, '').trim()).filter(s => s.length >= 6).slice(0, 12);
  }
  return { ok: true, points };
}

/* C2：会话/日志 → NPC 与剧情点建议（结构化，供工作台预览确认后写入）。
 * 结果形状与 parseScript 一致：{entities:{…7 类…}, updates:[]}，可直接进 openScriptPreview。 */
async function suggestStory(cfg, content, existing) {
  existing = existing || {};
  const names = {};
  for (const k of _K) { names[k] = ((existing[k]) || []).map(x => x.name || x.title).filter(Boolean); }
  const sys = '你是 TRPG 跑团工作台的“剧情建议助手”。根据给定内容（近期会话与跑团日志），识别值得登记进工作台的新 NPC 与剧情点建议。只输出严格 JSON：{"npcs":[{"name":"名称","role":"身份/职业","faction":"所属组织","note":"简述(秘密/动机/作用)"}],"logs":[{"name":"剧情点标题","summary":"发生了什么/线索","hook":"后续钩子或状态"}]}。要求：NPC 最多 6 条，剧情点最多 8 条；name 必须来自内容或明显可推出的角色/事件，不要凭空编造；已有同名条目不要重复建议；只输出 JSON，不要解释。';
  const user = '【已存在的 NPC/剧情点名称（避免重复建议）】\n'
    + 'NPC：' + (names.npcs.join('、') || '（无）') + '\n'
    + '日志/剧情点：' + (names.logs.join('、') || '（无）') + '\n\n'
    + '【近期内容】\n' + String(content || '').slice(0, 16000); // U3-3：剧情建议输入 32000→16000
  const raw = await rawJsonReply(cfg, sys, user, 2600);
  const obj = extractJsonObject(raw);
  const result = { entities: { pcs: [], npcs: [], regions: [], logs: [], mobs: [], rules: [], lore: [] }, updates: [] };
  if (obj) {
    const npcArr = Array.isArray(obj.npcs) ? obj.npcs : [];
    for (const it of npcArr.slice(0, 6)) {
      const name = sanitizeStr(it.name || it.npc || it.title, 60).trim();
      if (!name) continue;
      result.entities.npcs.push({ name, role: sanitizeStr(it.role || '', 80), faction: sanitizeStr(it.faction || '', 80), note: sanitizeStr(it.note || '', 500) });
    }
    const logArr = Array.isArray(obj.logs) ? obj.logs : [];
    for (const it of logArr.slice(0, 8)) {
      const title = sanitizeStr(it.name || it.title || it.plot, 80).trim();
      if (!title) continue;
      /* logs 的标题字段为 name、钩子字段为 hook（见 DEFAULT_FIELDS.logs）；
         若沿用 title/note 会被 schema 过滤，导致落库后标题丢失、钩子为空。 */
      const hook = sanitizeStr(it.hook || it.note || '', 300);
      const note = sanitizeStr(it.note || '', 300);
      result.entities.logs.push({ name: title, summary: sanitizeStr(it.summary || '', 600), hook, note: note === hook ? '' : note });
    }
  }
  return { ok: true, result };
}

/* ==================== 团本分幕（剧本式）分析 ====================
 * 在不改变原剧情的前提下，把整篇团本拆成一幕幕可上演的「剧本」：
 * 每幕给出——标题 / 地点 / 时间 / 出场人物 / 剧情经过 / 关键线索与道具 / 备注(导入提示)。
 * 处理策略：
 *   1) 短文本（≤示意阈值）一次调用输出全部场景 JSON；
 *   2) 长文本按块切分，逐块要求“续写随后一幕”，最后合并编号，保证剧情连续；
 *   3) 任何解析失败都回退为最小可用结构，绝不因坏 JSON 崩坏。 */
const SC_CHUNK = 15000;      // 单块交给 AI 的字符量
const SC_OVERLAP = 500;      // 相邻块重叠，避免在切点处断剧情
function chunkTextByLen(text, size, overlap) {
  const out = [];
  const t = String(text || '');
  let i = 0;
  while (i < t.length) {
    let j = Math.min(i + size, t.length);
    out.push(t.slice(i, j));
    i = j - overlap;
    if (i < 0) i = 0;
    if (out.length > 240) break;   // 安全上限：最多切 240 块，再长也兜底
  }
  return out;
}
function sceneSysPrompt() {
  return '你是资深 TRPG 主持人（KP）的剧本拆解助手。把给定跑团团本正文，在你【不改变、不删减、不添加剧情】的前提下，按事件推进的自然节点拆分成一幕一幕可上演的剧本。'
    + '严格输出一个 JSON 对象，结构：{"scenes":[{"title":"这一幕标题","location":["地点1",...],"time":"大概时间/节点","characters":[{"name":"出场人物/势力","role":"在此幕的身份(可空)"}...],"plot":"这一幕的剧情经过（按原文本顺序、保留关键动作与台词摘要，用自然中文分步叙述）","clues":["关键线索/伏笔",...],"props":["道具/机关/魔物",...],"note":"承接上幕/进入下幕的转折提示或主持注意点(可空)"}]}。'
    + '要求：场景按剧情先后排列；人物只写确实在这一幕出现/相关的；location 只列原文本明确提及的场地；没有的内容给空数组；每幕 plot 控制在 300 字以内；只输出 JSON，不要输出任何解释或代码块外的文字。';
}
function normalizeScene(it, idx) {
  const s = (it && typeof it === 'object') ? it : {};
  const loc = (Array.isArray(s.location) ? s.location : []).map(x => sanitizeStr(x, 60).trim()).filter(Boolean);
  const chars = [];
  if (Array.isArray(s.characters)) {
    for (const c of s.characters.slice(0, 20)) {
      if (typeof c === 'string') { const n = sanitizeStr(c, 60).trim(); if (n) chars.push({ name: n, role: '' }); }
      else if (c && typeof c === 'object') { const n = sanitizeStr(c.name || c.character || '', 60).trim(); if (n) chars.push({ name: n, role: sanitizeStr(c.role || '', 80).trim() }); }
    }
  }
  const clues = (Array.isArray(s.clues) ? s.clues : []).map(x => sanitizeStr(x, 200).trim()).filter(Boolean);
  const props = (Array.isArray(s.props) ? s.props : []).map(x => sanitizeStr(x, 200).trim()).filter(Boolean);
  return {
    index: idx,
    title: sanitizeStr(s.title || '第 ' + idx + ' 幕', 80).trim() || ('第 ' + idx + ' 幕'),
    location: loc, time: sanitizeStr(s.time, 60).trim(),
    characters: chars, plot: sanitizeStr(s.plot || s.content || s.summary, 800).trim(),
    clues: clues, props: props, note: sanitizeStr(s.note || '', 300).trim()
  };
}
async function breakdownScenario(cfg, text, settings) {
  const t = String(text || '').trim();
  if (!t) return [];
  const sys = sceneSysPrompt();
  const chunks = chunkTextByLen(t, SC_CHUNK, SC_OVERLAP);
  let scenes = [];
  for (let c = 0; c < chunks.length; c++) {
    const done = chunks.length > 1 ? ('（这块是全篇第 ' + (c + 1) + ' / ' + chunks.length + ' 部分。若前面已产出场景，请严格【接着上一幕的剧情继续】列出随后新的场景，不要重述前面的场景。）') : '';
    const user = '【团本正文 ' + (chunks.length === 1 ? '' : '· 第 ' + (c + 1) + ' / ' + chunks.length + ' 部分') + '】\n' + chunks[c] + done;
    let raw;
    try { raw = await rawJsonReply(cfg, sys, user, 5000); }
    catch (err) { throw err; }
    const obj = extractJsonObject(raw);
    let arr = (obj && Array.isArray(obj.scenes)) ? obj.scenes : (Array.isArray(obj) ? obj : []);
    if (!arr.length) {
      // 兜底：偶发坏返回，记一段极简场景，避免整篇失败
      arr = [{ title: '第 ' + (scenes.length + 1) + ' 幕', plot: '（AI 未返回本段分幕结果）' }];
    }
    for (const s of arr) scenes.push(s);
  }
  // 去重空场景、重编幕号（序号保持 1..N 连续）
  // 原实现 normalizeScene(s,0) 会对缺失标题兜底成固定「第 0 幕」，导致空场景永不过滤、导出序号错位
  const result = [];
  let idx = 0;
  for (const s of scenes) {
    const raw = (s && typeof s === 'object') ? s : {};
    const hasContent = sanitizeStr(raw.plot || raw.content || raw.summary, 800).trim()
      || sanitizeStr(raw.title || '', 80).trim();
    if (!hasContent) continue; // 真正无标题且无剧情的坏场景直接剔除
    const n = normalizeScene(s, idx + 1); // 用真实后续幕号做兜底标题（「第 N 幕」）而非固定第 0 幕
    n.index = ++idx;
    result.push(n);
  }
  return result;
}

module.exports = { DEFAULT_FIELDS, defaultFields, effectiveFields, schemaText, chat, chatRaw, parseScript, auditData, profileBlock, KIND_LIST: _K, DEFAULT_PROMPTS, effectivePrompts, renderPrompt, generateContent, generateEntity, generateEntities, genTemplateFromRules, BUILTIN_TEMPLATES, effectiveTemplates, tplSchema, suggestRelations, suggestScript, defaultModRules, generateBoard, clamp01, normPoly, plotSummary, suggestStory, breakdownScenario, usageLog, resetUsage, cancelGroup, recordUsage, setHubContext, hubPrefix, hubSystem, looksLikeNonPersonName, splitByStructure };