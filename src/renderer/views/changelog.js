'use strict';
/* 更新公告视图（自 app.js 抽出）：渲染自更新状态条 + 版本更新日志。
 *
 * 契约：本文件在加载期只做「注册工厂」，不直接执行渲染；
 * app.js 在 DOMContentLoaded 时以共享上下文 KP 水合（调用工厂）为实例，
 * 因此这里拿到的 S / esc / CHANGELOG 等都是运行期同一份闭包状态与方法。
 * 渲染体与原 app.js 实现保持一致，仅把共享依赖改为从 KP 解构注入。 */
(function () {
  window.KPViews = window.KPViews || {};

  window.KPViews.changelog = function (KP) {
    const { esc, S, APP_VERSION, CHANGELOG, contentInner, updaterApi, updHumanSize } = KP;

    function render() {
      const upd = (S.settings && S.settings.updates) || {};
      const st = upd.state || 'idle';
      const busy = (st === 'checking' || st === 'progress' || st === 'applying');
      const pct = Math.max(0, Math.min(100, Number(upd.percent) || 0));
      const hasApi = !!updaterApi();
      let actions = '';
      if (!hasApi) actions = '';
      else if (st === 'staged') actions = `<button onclick="WB.restartUpdate()">⟳ 立即重启更新</button><button class="ghost" onclick="WB.laterUpdate()">稍后</button>`;
      else if (st === 'available') actions = `<button onclick="WB.startUpdateDownload()">↓ 下载更新${upd.latest ? ' v' + esc(upd.latest) : ''}</button><button class="ghost" onclick="WB.openReleasePage()">打开下载页</button>`;
      else actions = `<button class="ghost" onclick="WB.checkUpdate()" ${busy ? 'disabled' : ''}>↻ ${st === 'checking' ? '检查中…' : st === 'progress' ? '下载中…' : '检查更新'}</button><button class="ghost" onclick="WB.openReleasePage()">打开下载页</button>`;

      let status = '';
      if (!hasApi) status = '当前环境未启用自更新（需在桌面版 EXE 内使用）。';
      else if (st === 'checking') status = '正在检查更新…';
      else if (st === 'none') status = '当前已是最新版本。';
      else if (st === 'progress') status = '正在下载更新… ' + pct + '%' + (upd.total ? '（' + updHumanSize(upd.received) + ' / ' + updHumanSize(upd.total) + '）' : '');
      else if (st === 'staged') status = '新版本 ' + (upd.latest ? 'v' + esc(upd.latest) + ' ' : '') + '已下载完成，重启后生效。';
      else if (st === 'applying') status = '正在更新，应用即将自动重启…';
      else if (st === 'err') status = '更新不可用：' + esc(upd.error || '未知错误');
      else if (st === 'available') status = '发现新版本 ' + (upd.latest ? 'v' + esc(upd.latest) + ' ' : '') + '，正在准备下载…';
      else status = '可点击右上角「检查更新」获取最新版本。';

      let html = `<div class="page-title"><h2>更新公告</h2><span class="hint">当前版本 v${APP_VERSION}</span>
        <span style="flex:1"></span>${actions}</div>`;

      if (hasApi) {
        html += `<div class="setcard"><h4>更新状态</h4><div class="note" style="white-space:normal;line-height:1.8">`;
        html += `<div>运行形态：<b>${esc(upd.modeLabel || '未知')}</b>`;
        if (upd.canAutoApply === false) html += `　<span style="color:var(--warn,#d8a657)">（程序目录不可写，无法自动替换，请用「打开下载页」手动更新）</span>`;
        html += `</div><div id="updState" style="margin-top:4px">${status}</div>`;
        if (st === 'progress') {
          html += `<div style="margin-top:8px;height:10px;border-radius:6px;background:var(--bg-soft,#2c2c2c);overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent,#e0663a);transition:width .25s ease"></div></div>`;
        }
        if (upd.notice) html += `<div class="hint" style="margin-top:6px">${esc(upd.notice)}</div>`;
        if (upd.latest && (st === 'available' || st === 'progress' || st === 'staged')) {
          html += `<div class="hint" style="margin-top:8px">最新版本：v${esc(upd.latest)}${upd.publishedAt ? '　发布于 ' + esc(String(upd.publishedAt).slice(0, 10)) : ''}</div>`;
          if (upd.notes) html += `<details style="margin-top:6px"><summary style="cursor:pointer">查看本次更新说明</summary><div class="hint" style="white-space:pre-wrap;margin-top:6px;max-height:220px;overflow:auto">${esc(String(upd.notes).slice(0, 2000))}</div></details>`;
        }
        html += `</div></div>`;
      }

      html += `<div class="changelog">`;
      for (const v of CHANGELOG) {
        html += `<div class="logentry"><div class="lhead"><b>v${v.version}</b><span>${v.date}</span></div><ul>${v.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
      }
      html += `</div>`;
      html += `<div class="credit" style="margin-top:20px;color:var(--ink-faint);font-size:12px;line-height:1.8">🎨 制作人：零弈秋　·　🐞 Bug/建议反馈 QQ：247910428<br>免责声明：本工具为免费个人辅助软件，数据由用户自行保管，请定期备份；使用中若造成数据丢失等损失，作者概不负责，请勿用于商业用途。<br>借鉴与第三方说明：骰娘指令的名称与写法参照开源项目 DiceZone / Dice-Next（AGPL-3.0）公开指令表对齐，CoC 房规分档与疯狂症状表均依据 CoC 7th 公开规则自行实现；完整清单与侵权联系删除办法见「系统 → 帮助中心 → 关于与反馈」。</div>`;
      contentInner(html);
    }

    return { render };
  };
})();
