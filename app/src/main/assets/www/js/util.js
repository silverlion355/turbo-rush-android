/* util.js — 基础工具（无 DOM 依赖，便于复用与测试） */
'use strict';
window.RG = window.RG || {};

RG.rand   = (a, b) => a + Math.random() * (b - a);
RG.randi  = (a, b) => Math.floor(RG.rand(a, b + 1));
RG.clamp  = (v, a, b) => (v < a ? a : v > b ? b : v);
RG.lerp   = (a, b, t) => a + (b - a) * t;
RG.damp   = (cur, target, k, dt) => RG.lerp(cur, target, 1 - Math.exp(-k * dt));
RG.pick   = arr => arr[Math.floor(Math.random() * arr.length)];

/* AABB 碰撞（中心点 + 半宽/半高），含双方 shrink 缩放 */
RG.hit = (ax, ay, aw, ah, bx, by, bw, bh, shrink = 0) => {
  const a2 = aw / 2 - shrink, b2 = bw / 2 - shrink;
  const ah2 = ah / 2 - shrink * 1.4, bh2 = bh / 2 - shrink * 1.4;
  if (a2 <= 0 || b2 <= 0) return false;
  return Math.abs(ax - bx) < a2 + b2 && Math.abs(ay - by) < ah2 + bh2;
};

/* 带圆角矩形路径（兼容不支持 ctx.roundRect 的 WebView） */
RG.rr = (ctx, x, y, w, h, r) => {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

RG.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* 原生触感（Android WebView 内由 AndroidBridge.vibrate 触达，浏览器中静默） */
RG.vibrate = (ms) => {
  try {
    if (ms > 0 && window.AndroidBridge && typeof window.AndroidBridge.vibrate === 'function') {
      window.AndroidBridge.vibrate(ms);
    }
  } catch (e) { /* 静默 */ }
};
