'use strict';
/* expr/rng：可种子随机源。FNV-1a 字符串散列 + mulberry32，纯 JS、确定性、可复现 */
function hashSeed(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Rng {
  constructor(seed) {
    this.seed = seed;
    this._next = mulberry32(hashSeed(seed));
  }
  int(min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Rng.int 需要整数闭区间 [min,max]，收到 [${min},${max}]`);
    }
    return min + Math.floor(this._next() * (max - min + 1));
  }
  pick(arr) {
    if (!Array.isArray(arr) || arr.length === 0) throw new RangeError('Rng.pick 需要非空数组');
    return arr[this.int(0, arr.length - 1)];
  }
  float() {
    return this._next();
  }
}
module.exports = { Rng };