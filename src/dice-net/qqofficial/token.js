'use strict';
// QQ 官方机器人令牌管理：POST https://api.bot.qq.com/app/getAppAccessToken，到期前 120s 刷新
const TOKEN_URL = 'https://api.bot.qq.com/app/getAppAccessToken';

class TokenKeeper {
  constructor({ appId, clientSecret, fetchImpl = fetch, now = Date.now }) {
    this.appId = appId;
    this.clientSecret = clientSecret;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.token = null;
    this.expireAt = 0;
  }
  async get(at = this.now()) {
    if (this.token && at < this.expireAt - 120000) return this.token;
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.clientSecret }),
    });
    if (!res.ok) {
      this.token = null;
      throw new Error(`令牌获取失败: ${res.status}`);
    }
    const body = await res.json();
    this.token = body.access_token;
    this.expireAt = this.now() + body.expires_in * 1000;
    return this.token;
  }
  botToken() { return this.get().then((t) => `QQBot ${t}`); }
  invalidate() { this.token = null; this.expireAt = 0; }
  /* U7-2 鉴权到期提醒：当前令牌剩余毫秒数（无令牌时返回 0） */
  remainingMs(at = this.now()) { return this.token ? Math.max(0, this.expireAt - at) : 0; }
}

module.exports = { TokenKeeper, TOKEN_URL };
