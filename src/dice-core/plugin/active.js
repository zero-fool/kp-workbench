'use strict';
/* 活动插件注册表：当前生效的规则插件（进程内单例，热加载由 PluginHost 驱动）。
 * 固定导出名：setActivePlugin(pkg)、getActivePlugin()。 */
let active = null;
function setActivePlugin(pkg) { active = pkg; }
function getActivePlugin() { return active; }
module.exports = { setActivePlugin, getActivePlugin };
