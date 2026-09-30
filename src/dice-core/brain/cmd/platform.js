'use strict';
/* 平台/管理类指令（本地工作台语义：不连 QQ/云账号，参数与回复结构对齐 Dice-Next，
 * 真实平台动作在此离线环境中以「本地会话状态 + 明确提示」呈现）：
 *   .bot on|off            机器人总开关（本地会话）
 *   .trust [uid] [0-5]     用户信任等级
 *   .user list|info|ban|unban
 *   .group on|off|list     群设置
 *   .alias [别名 主号]|list 账号别名
 *   .bind [标识]|off       身份绑定
 *   .info                  机器人信息
 *   .cloud                 云服务状态
 *   .notice [list|add 文本|clr]
 *   .plugin list|on|off <名>
 *   .system info|stats
 *   .send <文本>           发送一段文本
 *   .dismiss               解散/停用（本地会话置为 off）
 *   .game new|list|info <名>  团务
 *   .mod list|load <名>    模组
 *   .buff add|list|del|clr 状态增益
 *   .link <目标>           跨窗口链接（本地回执） */
const { registerCmd } = require('../registry');

const argStr = a => (Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a)).trim();
const argsOf = a => (Array.isArray(a) ? a : argStr(a).split(/\s+/).filter(Boolean));
const isAdmin = ctx => { const r = ctx.sender && ctx.sender.role; return r === 'owner' || r === 'admin' || r === 'gm' || r === 'kp' || r === 'master'; };
const deny = { text: '没有权限：该指令需要主持人或管理员' };

function st(ctx) { const s = ctx.session; s.settings = s.settings || {}; s.settings.switches = s.settings.switches || {}; return s; }

/* ─── .bot ────────────────────────────────────────────── */
function runBot(ctx, args) {
  const s = st(ctx);
  const v = argStr(args).toLowerCase();
  if (v !== 'on' && v !== 'off') return { text: `机器人状态：${s.settings.switches.bot === false ? 'off' : 'on'}\n用法：.bot on|off` };
  s.settings.switches.bot = v === 'on';
  return { text: `机器人已${v === 'on' ? '开启' : '关闭'}（本地会话）` };
}

/* ─── .trust ──────────────────────────────────────────── */
function runTrust(ctx, args) {
  const s = st(ctx);
  s.trust = s.trust || {};
  const list = argsOf(args);
  if (!list.length) {
    const lv = s.trust[ctx.sender.id] == null ? (isAdmin(ctx) ? 5 : 3) : s.trust[ctx.sender.id];
    return { text: `你的信任等级：${lv}（0-5）\n管理员可用 .trust <用户号> <0-5> 调整` };
  }
  if (list.length === 1) {
    // Dice-Next 兼容：.trust @某人 / .trust <用户号> 查询指定对象的信任等级。
    const uid = list[0];
    const lv = s.trust[uid] == null ? '（默认）' : s.trust[uid];
    return { text: `用户 ${uid} 的信任等级：${lv}（0-5）` };
  }
  if (!isAdmin(ctx)) return deny;
  const uid = list[0], lv = Number(list[1]);
  if (!uid || !Number.isInteger(lv) || lv < 0 || lv > 5) return { text: '用法：.trust <用户号> <0-5>' };
  s.trust[uid] = lv;
  return { text: `已设置用户 ${uid} 的信任等级为 ${lv}` };
}

/* ─── .user ───────────────────────────────────────────── */
/* Dice-Next 兼容：.user state / tojson / diss（旧版入口，复用统一档案与名单）。 */
function runUser(ctx, args) {
  const s = st(ctx);
  s.ban = s.ban || [];
  const toks = argsOf(args);
  const [sub, uid] = toks;
  if (!sub || sub === 'list') return { text: `已知用户：${Object.keys(s.users || {}).join('、') || '（暂无）'}\n屏蔽名单：${s.ban.join('、') || '（空）'}` };
  if (sub === 'state') {
    const id = uid || ctx.sender.id;
    const u = (s.users || {})[id] || {};
    return { text: `用户 ${id} 状态：信任 ${(s.trust || {})[id] == null ? '（默认）' : s.trust[id]}　签到 ${u.days || 0} 天　屏蔽 ${s.ban.includes(id) ? '是' : '否'}` };
  }
  if (sub === 'tojson') {
    return { text: JSON.stringify({ users: s.users || {}, trust: s.trust || {}, ban: s.ban }) };
  }
  if (sub === 'diss') {
    if (!isAdmin(ctx)) return deny;
    if (!uid) return { text: '用法：.user diss <用户号> [原因]' };
    s.diss = s.diss || {};
    s.diss[uid] = toks.slice(2).join(' ') || '（未填原因）';
    return { text: `已记录对 ${uid} 的警告：${s.diss[uid]}（diss 不删除档案或人物卡）` };
  }
  if (sub === 'info') {
    const id = uid || ctx.sender.id;
    const u = (s.users || {})[id];
    return { text: `用户 ${id}：${u ? `签到 ${u.days} 天，好感 ${u.favor}` : '（暂无记录）'}` };
  }
  if (sub === 'ban' || sub === 'unban') {
    if (!isAdmin(ctx)) return deny;
    if (!uid) return { text: `用法：.user ${sub} <用户号>` };
    if (sub === 'ban') { if (!s.ban.includes(uid)) s.ban.push(uid); return { text: `已屏蔽 ${uid}` }; }
    s.ban = s.ban.filter(x => x !== uid);
    return { text: `已解除屏蔽 ${uid}` };
  }
  return { text: '用法：.user list / .user info|state [用户号] / .user tojson / .user ban|unban <用户号> / .user diss <用户号> [原因]' };
}

/* ─── .group ──────────────────────────────────────────── */
function runGroup(ctx, args) {
  const s = st(ctx);
  const v = argStr(args).toLowerCase();
  if (v === 'on' || v === 'off') {
    if (!isAdmin(ctx)) return deny;
    s.settings.switches.groupOn = v === 'on';
    return { text: `本群功能已${v === 'on' ? '开启' : '关闭'}` };
  }
  return { text: `群功能：${s.settings.switches.groupOn === false ? 'off' : 'on'}\n用法：.group on|off` };
}

/* ─── .alias ──────────────────────────────────────────── */
function runAlias(ctx, args) {
  const s = st(ctx);
  s.aliases = s.aliases || {};
  const list = argsOf(args);
  if (!list.length || list[0] === 'list') {
    const keys = Object.keys(s.aliases);
    return { text: keys.length ? `账号别名：\n${keys.map(k => `${k} → ${s.aliases[k]}`).join('\n')}` : '暂无账号别名\n用法：.alias <别名> <主号>' };
  }
  if (!isAdmin(ctx)) return deny;
  if (list.length < 2) return { text: '用法：.alias <别名> <主号>' };
  s.aliases[list[0]] = list[1];
  return { text: `已登记别名 ${list[0]} → ${list[1]}` };
}

/* ─── .bind ───────────────────────────────────────────── */
function runBind(ctx, args) {
  const s = st(ctx);
  s.identities = s.identities || {};
  const v = argStr(args);
  if (!v) {
    const cur = s.identities[ctx.sender.id];
    return { text: `身份绑定：${cur || '（未绑定）'}\n用法：.bind <邮箱/标识> / .bind off` };
  }
  if (v === 'off') { delete s.identities[ctx.sender.id]; return { text: '已解除身份绑定' }; }
  s.identities[ctx.sender.id] = v;
  return { text: `已将身份绑定到「${v}」` };
}

/* ─── .info ───────────────────────────────────────────── */
function runInfo(ctx) {
  const s = st(ctx);
  return { text: `骰娘工作台 · 本地模式\n规则：${ctx.session.rule}　默认骰：${ctx.session.defaultDice || '（随规则）'}\n状态：${s.settings.switches.bot === false ? '已关闭' : '运行中'}　用户 ${Object.keys(s.users || {}).length} 人` };
}

/* ─── .cloud ──────────────────────────────────────────── */
/* Dice-Next 兼容：.cloud auth / confirm / list（授权账号中心读写云端人物卡）。 */
function runCloud(ctx, args) {
  const s = st(ctx);
  s.cloud = s.cloud || { authed: false, list: [] };
  const sub = (argsOf(args)[0] || '').toLowerCase();
  if (!sub || sub === 'list') {
    return { text: `云服务：本地工作台未接入 Dice-Next 云账号体系（云卡/云备份需在官方端使用）。\n授权状态：${s.cloud.authed ? '已授权' : '未授权'}　云端人物卡：${s.cloud.list.length} 张\n用法：.cloud auth / .cloud confirm / .cloud list` };
  }
  if (sub === 'auth') return { text: '请在私聊中完成账号中心授权；本地工作台以 .cloud confirm 模拟授权完成，一次授权同时覆盖真实 QQ 核验与云端人物卡读写' };
  if (sub === 'confirm') { s.cloud.authed = true; return { text: '已确认授权（本地模拟）：可读写云端人物卡；真实云卡需在官方端使用' }; }
  return { text: '用法：.cloud auth / .cloud confirm / .cloud list' };
}

/* ─── .notice ─────────────────────────────────────────── */
/* Dice-Next 兼容：.notice on|off / level <级别>，另保留 list/add/clr。 */
function runNotice(ctx, args) {
  const s = st(ctx);
  s.notices = s.notices || [];
  const list = argsOf(args);
  const sub = (list[0] || '').toLowerCase();
  if (!sub || sub === 'list') {
    return { text: `通知窗口：${s.noticeOn === false ? 'off' : 'on'}（级别 ${s.noticeLevel == null ? 15 : s.noticeLevel}）\n已记录：${s.notices.length ? s.notices.map((n, i) => `${i + 1}. ${n}`).join('；') : '（空）'}` };
  }
  if (sub === 'on' || sub === 'off') { s.noticeOn = sub === 'on'; return { text: `骰主通知窗口已${sub === 'on' ? '开启' : '关闭'}` }; }
  if (sub === 'level') {
    const n = Number(list[1]);
    if (!Number.isInteger(n) || n < 0 || n > 99) return { text: '用法：.notice level <0-99>' };
    s.noticeLevel = n;
    return { text: `通知级别已设为 ${n}` };
  }
  if (sub === 'clr') { s.notices = []; return { text: '通知已清空' }; }
  if (sub === 'add') { const t = list.slice(1).join(' '); if (!t) return { text: '用法：.notice add <文本>' }; s.notices.push(t); return { text: `已添加通知：${t}` }; }
  return { text: '用法：.notice list / .notice on|off / .notice level <0-99> / .notice add <文本> / .notice clr' };
}

/* ─── .plugin ─────────────────────────────────────────── */
/* Dice-Next 兼容：.plugin list / on|off <名称> / all on|off。 */
function runPlugin(ctx, args) {
  const s = st(ctx);
  s.plugins = s.plugins || {};
  const [sub, name] = argsOf(args);
  if (!sub || sub === 'list') {
    const keys = Object.keys(s.plugins);
    return { text: keys.length ? `插件状态：\n${keys.map(k => `${k}：${s.plugins[k] ? 'on' : 'off'}`).join('\n')}` : '暂无已登记插件' };
  }
  if (sub === 'on' || sub === 'off') {
    if (!isAdmin(ctx)) return deny;
    if (!name) return { text: `用法：.plugin ${sub} <插件名>` };
    s.plugins[name] = sub === 'on';
    return { text: `插件「${name}」已${sub === 'on' ? '启用' : '停用'}` };
  }
  if (sub === 'all') {
    if (!isAdmin(ctx)) return deny;
    const v = (argsOf(args)[1] || '').toLowerCase();
    if (v !== 'on' && v !== 'off') return { text: '用法：.plugin all on|off' };
    const keys = Object.keys(s.plugins);
    for (const k of keys) s.plugins[k] = v === 'on';
    return { text: keys.length ? `已批量${v === 'on' ? '启用' : '停用'} ${keys.length} 个插件` : '暂无已登记插件（先用 .plugin on|off <名称> 登记）' };
  }
  return { text: '用法：.plugin list / .plugin on|off <插件名> / .plugin all on|off' };
}

/* ─── .system ─────────────────────────────────────────── */
function runSystem(ctx, args) {
  const [sub] = argsOf(args);
  const s = st(ctx);
  if (sub === 'stats') {
    return { text: `统计：投骰记录 ${(ctx.session.logs || []).length} 条　人物卡 ${Object.keys(ctx.session.cards || {}).length} 张　用户 ${Object.keys(s.users || {}).length} 人` };
  }
  return { text: '系统：骰娘工作台本地引擎\n可用：.system info / .system stats' };
}

/* ─── .send ───────────────────────────────────────────── */
/* Dice-Next 兼容：.send <留言> 转交 Master；.send group|user <号> <消息> 由 Master 主动发送。 */
function runSend(ctx, args) {
  const toks = argsOf(args);
  const sub = (toks[0] || '').toLowerCase();
  if (sub === 'group' || sub === 'user') {
    if (!isAdmin(ctx)) return deny;
    const target = toks[1], msg = toks.slice(2).join(' ');
    if (!target || !msg) return { text: `用法：.send ${sub} <号> <消息>` };
    return { text: `已向${sub === 'group' ? '群' : '用户'} ${target} 发送：${msg}` };
  }
  const v = argStr(args);
  if (!v) return { text: '用法：.send <留言>（转交 Master）/.send group|user <号> <消息>（Master）' };
  return { text: `已把留言转交给 Master：${v}` };
}

/* ─── .dismiss ────────────────────────────────────────── */
function runDismiss(ctx) {
  if (!isAdmin(ctx)) return deny;
  const s = st(ctx);
  s.settings.switches.dismissed = true;
  return { text: '已请求停用本群机器人服务（本地标记为已解散）' };
}

/* ─── .game ───────────────────────────────────────────── */
/* Dice-Next 兼容：new/open/join/exit/master/state/set/call/kick/close/over/rou。 */
function runGame(ctx, args) {
  const s = st(ctx);
  s.games = s.games || {};
  s.gm = s.gm || [];
  const toks = argsOf(args);
  const sub = (toks[0] || '').toLowerCase();
  const me = ctx.sender.id;
  const cur = () => (s.currentGame && s.games[s.currentGame]) || null;

  if (!sub || sub === 'list') {
    const names = Object.keys(s.games);
    return { text: names.length
      ? `团务列表：\n${names.map(n => `${n}${s.currentGame === n ? '（当前）' : ''}　${s.games[n].players} 人${s.games[n].over ? ' · 已结团' : ''}`).join('\n')}`
      : '暂无团务\n用法：.game new <团名> / .game open <团号> / .game state' };
  }
  if (sub === 'new') {
    const name = toks.slice(1).join(' ');
    if (!name) return { text: '用法：.game new <团名>' };
    s.games[name] = { players: 1, gm: me, at: new Date().toISOString(), over: false, vars: {} };
    s.currentGame = name;
    if (!s.gm.includes(me)) s.gm.push(me);
    return { text: `已创建团务「${name}」，开团者为 GM` };
  }
  if (sub === 'open') {
    const code = toks[1];
    if (!code) return { text: '用法：.game open <16位团号>' };
    return { text: `已请求接入团号「${code}」（本地工作台为单群，跨群接入仅作演示）` };
  }
  if (sub === 'join' || sub === 'exit') {
    const g = cur();
    if (!g) return { text: '当前没有进行中的团务，先 .game new/open' };
    g.players = Math.max(0, g.players + (sub === 'join' ? 1 : -1));
    return { text: `${(ctx.sender && ctx.sender.name) || me} 已${sub === 'join' ? '上桌' : '退出'}「${s.currentGame}」，当前 ${g.players} 人` };
  }
  if (sub === 'master') {
    if (toks[1] === 'add' && toks[2]) { if (!s.gm.includes(toks[2])) s.gm.push(toks[2]); return { text: `已添加 GM：${toks[2]}` }; }
    if (!s.gm.includes(me)) { s.gm.push(me); return { text: `已自任 GM：${me}` }; }
    return { text: `GM 名单：${s.gm.join('、') || '（空）'}` };
  }
  if (sub === 'state' || sub === 'stat') {
    const g = cur();
    if (!g) return { text: '当前没有进行中的团务' };
    const vars = Object.entries(g.vars || {}).map(([k, v]) => `${k}=${v}`).join(' ') || '（无）';
    return { text: `团务「${s.currentGame}」：${g.players} 人　GM：${g.gm}　${g.over ? '已结团' : '进行中'}\n团变量：${vars}` };
  }
  if (sub === 'set') {
    if (!isAdmin(ctx)) return deny;
    const g = cur();
    if (!g) return { text: '当前没有进行中的团务' };
    const k = toks[1];
    if (!k) return { text: '用法：.game set <变量> <值>' };
    g.vars = g.vars || {};
    g.vars[k] = toks.slice(2).join(' ') || '1';
    return { text: `团变量 ${k} = ${g.vars[k]}` };
  }
  if (sub === 'call') {
    if (!isAdmin(ctx)) return deny;
    return { text: `📣 点名全体玩家：请到齐（本轮由 ${(ctx.sender && ctx.sender.name) || me} 发起）` };
  }
  if (sub === 'kick') {
    if (!isAdmin(ctx)) return deny;
    const g = cur();
    if (!g) return { text: '当前没有进行中的团务' };
    const who = toks[1];
    if (!who) return { text: '用法：.game kick <QQ>' };
    g.players = Math.max(0, g.players - 1);
    return { text: `已把 ${who} 踢下桌，当前 ${g.players} 人` };
  }
  if (sub === 'close') { return { text: '已关闭当前群的团务领域（本地会话标记）' }; }
  if (sub === 'over') {
    if (!isAdmin(ctx)) return deny;
    const g = cur();
    if (!g) return { text: '当前没有进行中的团务' };
    g.over = true;
    return { text: `团务「${s.currentGame}」已结团` };
  }
  if (sub === 'rou') {
    if (!isAdmin(ctx)) return deny;
    const g = cur();
    if (!g) return { text: '当前没有进行中的团务' };
    const action = (toks[1] || '').toLowerCase();
    g.rou = g.rou || [];
    if (action === 'hist') return { text: g.rou.length ? `轮盘记录：\n${g.rou.join('\n')}` : '暂无轮盘记录' };
    if (action === 'reset') { const last = g.rou.pop(); return { text: last ? `已复原上一次轮盘：${last}` : '没有可复原的轮盘记录' }; }
    if (action === 'clr' || action === 'clear') { g.rou = []; return { text: '轮盘记录已清空' }; }
    const m = /^(\d+)(?:\*(\d+))?$/.exec(toks[1] || '');
    if (!m) return { text: '用法：.game rou <面数>[*份数]，另 rou hist/reset/clr' };
    const faces = Math.max(2, Number(m[1]));
    const times = Math.max(1, Math.min(20, Number(m[2]) || 1));
    const outs = Array.from({ length: times }, () => ctx.rng.int(1, faces));
    const line = `轮盘 d${faces}×${times} → ${outs.join('、')}`;
    g.rou.push(line);
    return { text: line };
  }
  return { text: '用法：.game list / new <团名> / open <团号> / join|exit / master / state / set <变量> <值> / call / kick <QQ> / close / over / rou <面数>[*份数]' };
}

/* ─── .mod ────────────────────────────────────────────── */
function runMod(ctx, args) {
  const s = st(ctx);
  s.mods = s.mods || {};
  const [sub, name] = argsOf(args);
  if (!sub || sub === 'list') {
    const keys = Object.keys(s.mods);
    return { text: keys.length ? `模组：\n${keys.map(k => `${k}${s.mods[k] ? '（已载入）' : ''}`).join('\n')}` : '暂无模组\n用法：.mod load <模组名>' };
  }
  // Dice-Next：.mod on <名称> 载入模组；.mod info <名称> 查看模组信息。
  if (sub === 'load' || sub === 'on' || sub === 'enable') {
    if (!name) return { text: `用法：.mod ${sub} <模组名>` };
    s.mods[name] = true;
    return { text: `已载入模组「${name}」` };
  }
  if (sub === 'off' || sub === 'disable') {
    if (!name) return { text: '用法：.mod off <模组名>' };
    delete s.mods[name];
    return { text: `已卸载模组「${name}」` };
  }
  if (sub === 'info') {
    if (!name) return { text: '用法：.mod info <模组名>' };
    if (!(name in s.mods)) return { text: `未载入模组「${name}」，可先用 .mod on ${name}` };
    return { text: `模组「${name}」：已载入（本地工作台未接入 Dice-Next 模组仓库，内容以开团资料为准）` };
  }
  return { text: '用法：.mod list / .mod on|load <模组名> / .mod info <模组名>' };
}

/* ─── .buff ───────────────────────────────────────────── */
/* Dice-Next 兼容：.buff <属性> ±<值> [轮数] 直接记一条状态；.buff show 等同 list。 */
function buffLine(b) {
  const val = b.value ? ` ${b.value}` : '';
  return `${b.name}${val}${b.turns ? `（${b.turns} 轮）` : ''}`;
}
function runBuff(ctx, args) {
  const s = st(ctx);
  s.buffs = s.buffs || [];
  const list = argsOf(args);
  const sub = (list[0] || '').toLowerCase();
  if (!sub || sub === 'list' || sub === 'show') {
    return { text: s.buffs.length ? `状态：\n${s.buffs.map(buffLine).join('\n')}` : '当前没有状态增益' };
  }
  if (sub === 'add') {
    const name = list[1];
    if (!name) return { text: '用法：.buff add <状态名> [轮数]' };
    const turns = Number(list[2]) || 0;
    s.buffs.push({ name, turns });
    return { text: `已添加状态「${name}」${turns ? `（${turns} 轮）` : ''}` };
  }
  if (sub === 'del') {
    const name = list[1];
    s.buffs = s.buffs.filter(b => b.name !== name);
    return { text: `已移除状态「${name || ''}」` };
  }
  if (sub === 'clr' || sub === 'clear' || sub === '清空') { s.buffs = []; return { text: '状态已清空' }; }
  // Dice-Next 兼容：.buff 力量:2 / .buff 力量+1 [轮数] —— 属性与数值紧贴（无需 add）。
  {
    const m1 = /^([^:：]+)[:：]([+-]?\d+)$/.exec(list[0] || '');
    const m2 = m1 ? null : /^(.+?)([+-]\d+)$/.exec(list[0] || '');
    if ((m1 || m2) && list.length <= 2) {
      const name = (m1 ? m1[1] : m2[1]).trim();
      const raw = m1 ? m1[2] : m2[2];
      const value = raw.startsWith('+') || raw.startsWith('-') ? raw : `+${raw}`;
      const turns = list[1] ? Number(list[1]) || 0 : 0;
      s.buffs.push({ name, value, turns });
      return { text: `已添加状态「${name} ${value}」${turns ? `（${turns} 轮）` : ''}` };
    }
  }
  // 简写：.buff 力量 +2 [轮数]
  if (/^[+-]?\d+$/.test(list[1] || '')) {
    const name = list[0];
    const value = list[1].startsWith('+') ? list[1] : list[1].startsWith('-') ? list[1] : `+${list[1]}`;
    const turns = Number(list[2]) || 0;
    s.buffs.push({ name, value, turns });
    return { text: `已添加状态「${name} ${value}」${turns ? `（${turns} 轮）` : ''}` };
  }
  return { text: '用法：.buff list|show / .buff add <状态名> [轮数] / .buff <属性> ±<值> [轮数] / .buff del <状态名> / .buff clr' };
}

/* ─── .link ───────────────────────────────────────────── */
function runLink(ctx, args) {
  const target = argStr(args);
  if (!target) return { text: '用法：.link <目标窗口>' };
  return { text: `已向「${target}」发起链接（本地工作台为单窗口，回执仅作演示）` };
}

/* ─── .strXXX 文案自定义（对齐 Dice-Next 的 .strXXX）──────
 *   .strRollDice              查看该键当前文案
 *   .strRollDice <新文案>      覆写该键的文案
 *   .strRollDice reset|NULL   清除覆写，回退出厂默认
 * 命令名以 str 开头（如 strRollDice），由 CommandBrain 统一路由到本指令。 */
function runStr(ctx, args) {
  const list = argsOf(args);
  const key = list[0];
  if (!key) return { text: '用法：.str<键名> [新文案|reset|NULL]，例如 .strRollDice show / .strRollDice 掷骰结果：{}' };
  const s = st(ctx);
  s.settings = s.settings || {};
  s.strOverrides = s.strOverrides || {};
  const rest = list.slice(1).join(' ');
  const low = rest.toLowerCase();
  if (!rest || low === 'show') {
    const cur = s.strOverrides[key];
    return { text: cur
      ? `文案「${key}」当前为：${cur}\n（reset / NULL 可还原默认）`
      : `文案「${key}」当前为出厂默认（尚未覆写）。用法：.${key} <新文案>` };
  }
  if (low === 'reset' || low === 'null' || rest === 'NULL') {
    delete s.strOverrides[key];
    return { text: `文案「${key}」已恢复出厂默认` };
  }
  s.strOverrides[key] = rest;
  return { text: `文案「${key}」已覆写为：${rest}` };
}

/* ─── .strSelfName / .strSelfCall ─────────────────────── */
function runSelf(ctx, args, field) {
  const s = st(ctx);
  const v = argStr(args);
  const isName = field === 'selfName';
  const label = isName ? '骰娘名称' : '骰娘自称';
  if (!v) return { text: `当前${label}：${s.settings[field] || (isName ? '骰娘工作台' : '本骰')}\n用法：.${isName ? 'strSelfName' : 'strSelfCall'} <文本> / reset` };
  if (v === 'reset' || v === 'NULL' || v === 'off') {
    s.settings[field] = '';
    return { text: `${label}已重置为默认` };
  }
  s.settings[field] = v;
  return { text: `${label}已设为「${v}」` };
}

registerCmd({ name: 'bot', alias: ['机器人'], group: 'admin', handle: runBot });
registerCmd({ name: 'trust', alias: ['信任'], group: 'admin', handle: runTrust });
registerCmd({ name: 'user', alias: ['用户'], group: 'admin', handle: runUser });
registerCmd({ name: 'group', alias: ['群'], group: 'admin', handle: runGroup });
registerCmd({ name: 'alias', alias: ['账号别名'], group: 'admin', handle: runAlias });
registerCmd({ name: 'bind', alias: ['身份绑定'], group: 'admin', handle: runBind });
registerCmd({ name: 'info', alias: ['信息'], group: 'admin', handle: runInfo });
registerCmd({ name: 'cloud', alias: ['云'], group: 'admin', handle: runCloud });
registerCmd({ name: 'notice', alias: ['通知'], group: 'admin', handle: runNotice });
registerCmd({ name: 'plugin', alias: ['插件'], group: 'admin', handle: runPlugin });
registerCmd({ name: 'system', alias: ['系统'], group: 'admin', handle: runSystem });
registerCmd({ name: 'send', alias: ['发送'], group: 'admin', handle: runSend });
registerCmd({ name: 'dismiss', alias: ['解散'], group: 'admin', handle: runDismiss });
registerCmd({ name: 'game', alias: ['团务'], group: 'admin', handle: runGame });
registerCmd({ name: 'mod', alias: ['模组'], group: 'admin', handle: runMod });
registerCmd({ name: 'buff', alias: ['状态'], group: 'fun', handle: runBuff });
registerCmd({ name: 'link', alias: ['链接'], group: 'admin', handle: runLink });
registerCmd({ name: 'strSelfName', alias: ['骰娘名称'], group: 'admin', handle: (ctx, a) => runSelf(ctx, a, 'selfName') });
registerCmd({ name: 'strSelfCall', alias: ['骰娘自称'], group: 'admin', handle: (ctx, a) => runSelf(ctx, a, 'selfCall') });
// .strXXX 文案自定义：CommandBrain 把 str 开头的未知命令名统一路由到本指令。
registerCmd({ name: 'str', alias: ['文案'], group: 'admin', handle: runStr });

module.exports = { runBot, runTrust, runUser, runGroup, runAlias, runBind, runInfo, runCloud, runNotice, runPlugin, runSystem, runSend, runDismiss, runGame, runMod, runBuff, runLink, runSelf, runStr };
