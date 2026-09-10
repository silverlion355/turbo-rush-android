/* ============================================================
 * 兼容模式渲染器（纯 2D Canvas，零外部依赖）
 *
 * 触发条件（自动检测，满足任一即启用）：
 *   - three.min.js 加载失败（THREE 未定义）
 *   - WebGL 上下文不可用
 *   - main.js 启动过程中抛异常（window.__booted 始终为 false）
 *
 * 目的：3D 渲染链路完全不可用时，屏幕上也必须有画面 + 明确原因，
 *       彻底避免"整屏全黑且无任何提示"这种无法排查的状态。
 * ============================================================ */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  // main.js 的启动是同步的，等一个宏任务再确认（给它留出 DOMContentLoaded 的余量）
  setTimeout(function () {
    if (window.__booted) return;   // 3D 正常起来了，兼容模式不需要
    try { run(); } catch (e) {
      if (window.__diagLog) window.__diagLog('兼容模式启动失败：' + ((e && e.message) || e));
    }
  }, 120);

  function run() {
    var cv = byId('game');
    if (!cv) return;

    // 若 #game 已被 WebGL 占用（拿不到 2d 上下文），换一块全新 canvas
    var ctx = null;
    try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) {
      var old = cv;
      cv = document.createElement('canvas');
      cv.id = 'game2d';
      cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;z-index:1;';
      if (old && old.parentNode) old.parentNode.removeChild(old);
      document.body.insertBefore(cv, document.body.firstChild.nextSibling);
      ctx = cv.getContext('2d');
    }
    if (!ctx) return;

    if (window.__diagLog) window.__diagLog('WebGL 不可用，已启用 2D 兼容模式');
    if (window.__diag) {
      window.__diag.webgl = '不可用 → 兼容模式';
      window.__diag.objs = 0;
    }

    var W = 0, H = 0, dpr = 1;

    function resize() {
      var de = document.documentElement;
      W = window.innerWidth || (de && de.clientWidth) || 360;
      H = window.innerHeight || (de && de.clientHeight) || 240;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.max(1, Math.round(W * dpr));
      cv.height = Math.max(1, Math.round(H * dpr));
      cv.style.width = '100%';
      cv.style.height = '100%';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (window.__diag) window.__diag.size = W + 'x' + H + '@' + dpr;
    }
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () {
      setTimeout(resize, 60); setTimeout(resize, 300);
    });

    /* —— 交互：点"开始"进入行驶动画（3D 版主逻辑此时不可用）—— */
    var started = false;
    function go() {
      started = true;
      var m = byId('menu'), o = byId('over');
      if (m) m.classList.add('hidden');
      if (o) o.classList.add('hidden');
      try { if (window.AndroidBridge && AndroidBridge.vibrate) AndroidBridge.vibrate(12); } catch (e) {}
    }
    var bs = byId('btnStart'), ba = byId('btnAgain');
    if (bs) bs.addEventListener('click', go);
    if (ba) ba.addEventListener('click', go);

    /* —— 透视投影：u=0 → 屏幕底部(近)，u=1 → 地平线(远) —— */
    var vpy = 0;                    // 地平线 y
    function proj(u) {
      var e = Math.pow(u, 2.2);
      return {
        y: H - (H - vpy) * e,
        half: 0.66 * W * (1 - e) + 0.022 * W * e
      };
    }

    var t = 0, last = 0, dz = 0, fpsN = 0, fpsT = 0;

    function draw(ts) {
      requestAnimationFrame(draw);
      var dt = Math.min((ts - last) / 1000 || 0.016, 0.05);
      last = ts; t += dt;
      dz += dt * (started ? 1 : 0.22);

      vpy = H * 0.40;

      /* 1. 天空 */
      var sky = ctx.createLinearGradient(0, 0, 0, vpy);
      sky.addColorStop(0, '#4f9fdd'); sky.addColorStop(0.65, '#a9d3ee'); sky.addColorStop(1, '#dcecf7');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, vpy + 1);

      /* 2. 远山（两层三角，视差随行驶缓慢平移） */
      var off = (dz * 6) % (W * 0.6);
      [[0.62, '#7fa6c4', 0.30], [0.75, '#9dc0d8', 0.18]].forEach(function (L) {
        var baseY = vpy, hgt = H * L[2], col = L[1];
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(-W * 0.3 - off * 0.4, baseY);
        for (var x = -W * 0.3; x <= W * 1.3; x += W * 0.22) {
          var ph = Math.abs(Math.sin((x + off) * 0.01)) * hgt + hgt * 0.35;
          ctx.lineTo(x - off * 0.4, baseY - ph);
        }
        ctx.lineTo(W * 1.3, baseY); ctx.closePath(); ctx.fill();
      });

      /* 3. 草地 */
      var grd = ctx.createLinearGradient(0, vpy, 0, H);
      grd.addColorStop(0, '#7fb45f'); grd.addColorStop(1, '#4e7c3c');
      ctx.fillStyle = grd; ctx.fillRect(0, vpy, W, H - vpy);

      /* 4. 路面（梯形） */
      var near = proj(0), far = proj(1);
      ctx.fillStyle = '#4a4e57';
      ctx.beginPath();
      ctx.moveTo(W / 2 - far.half, far.y);
      ctx.lineTo(W / 2 + far.half, far.y);
      ctx.lineTo(W / 2 + near.half, near.y);
      ctx.lineTo(W / 2 - near.half, near.y);
      ctx.closePath(); ctx.fill();

      /* 5. 车道虚线（随行驶滚动 → 透视缩短） */
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      var SEG = 26;
      for (var i = 0; i < SEG; i++) {
        var u0 = ((i + (dz * 0.55)) % SEG) / SEG;       // 0..1
        var u1 = u0 + 1 / SEG * 0.45;
        if (u0 <= 0.001) continue;
        var a = proj(u0), b = proj(u1);
        var wa = Math.max(1, 0.0016 * W * a.half * 0.06), wb = Math.max(2, 0.0016 * W * b.half * 0.06);
        ctx.beginPath();
        ctx.moveTo(W / 2 - wa / 2, a.y); ctx.lineTo(W / 2 + wa / 2, a.y);
        ctx.lineTo(W / 2 + wb / 2, b.y); ctx.lineTo(W / 2 - wb / 2, b.y);
        ctx.closePath(); ctx.fill();
      }

      /* 6. 路缘白线（左右） */
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 2;
      [-1, 1].forEach(function (s) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + s * far.half, far.y);
        ctx.lineTo(W / 2 + s * near.half, near.y);
        ctx.stroke();
      });

      /* 7. 远处的 AI 车（按行驶推进，透视缩放） */
      ctx.fillStyle = '#e2e8f0';
      var ac = ((dz * 0.30 + 0.6) % 1);
      var ap = proj(0.35 + ac * 0.55);
      var aw = Math.max(3, ap.half * 0.052), ah = aw * 0.7;
      var ax = W / 2 + ap.half * 0.34;
      ctx.fillRect(ax - aw / 2, ap.y - ah, aw, ah);

      /* 8. 玩家车尾（贴屏幕底部中央，红车 + 尾灯 + 尾翼） */
      var cw = W * 0.30, ch = cw * 0.46, cx = W / 2, cy = H - ch * 0.72;
      // 车身
      var body = ctx.createLinearGradient(cx - cw / 2, cy, cx + cw / 2, cy + ch);
      body.addColorStop(0, '#e8352f'); body.addColorStop(0.5, '#c81f1a'); body.addColorStop(1, '#8e1310');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(cx - cw * 0.40, cy + ch);
      ctx.lineTo(cx - cw * 0.50, cy + ch * 0.34);
      ctx.lineTo(cx + cw * 0.50, cy + ch * 0.34);
      ctx.lineTo(cx + cw * 0.40, cy + ch);
      ctx.closePath(); ctx.fill();
      // 尾翼
      ctx.fillStyle = '#2b2b30';
      ctx.fillRect(cx - cw * 0.54, cy + ch * 0.16, cw * 1.08, ch * 0.16);
      // 尾灯
      ctx.fillStyle = '#ff5a4a';
      ctx.fillRect(cx - cw * 0.44, cy + ch * 0.50, cw * 0.26, ch * 0.17);
      ctx.fillRect(cx + cw * 0.18, cy + ch * 0.50, cw * 0.26, ch * 0.17);
      // 排气
      ctx.fillStyle = '#1a1a1e';
      ctx.fillRect(cx - cw * 0.18, cy + ch * 0.80, cw * 0.10, ch * 0.12);
      ctx.fillRect(cx + cw * 0.08, cy + ch * 0.80, cw * 0.10, ch * 0.12);

      /* 9. 诊断：帧率 */
      fpsN++;
      if (!fpsT) fpsT = ts;
      else if (ts - fpsT >= 1000) {
        if (window.__diag) { window.__diag.fps = Math.round(fpsN * 1000 / (ts - fpsT)); }
        fpsN = 0; fpsT = ts;
        if (window.__diagRefresh) window.__diagRefresh();
      }
      if (!run._ok) {
        run._ok = true;
        if (window.__diagLog) window.__diagLog('兼容模式绘制正常');
      }
    }
    requestAnimationFrame(draw);
  }
})();
