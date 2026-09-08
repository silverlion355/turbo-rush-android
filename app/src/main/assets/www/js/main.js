/* main.js — 引导层：DOM / 界面流程 / 主循环 / 对外桥接 API
   ------------------------------------------------------------
   Android 升级预留：
   1) 本项目所有逻辑不依赖 DOM，游戏在 <canvas> 内自绘，天然适合 WebView 全屏壳；
   2) window.RacingGame 暴露统一 API（start/pause/resume/getState/setScoreListener），
      Android 端可注入 window.AndroidBridge.{onScore,onGameOver} 接收回调；
   3) 触屏采用 Pointer Events + touch-action:none，防误缩放/滚动。
   ------------------------------------------------------------ */
'use strict';
(function () {
  const CFG = RG.CFG;

  /* ---------- 画布：固定逻辑分辨率，按 DPR 超采样 ---------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = CFG.VW * dpr;
  canvas.height = CFG.VH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const game = new RG.Game(canvas);

  /* ---------- DOM ---------- */
  const $ = id => document.getElementById(id);
  const ui = {
    menu: $('menu'), paused: $('paused'), over: $('over'),
    btnStart: $('btnStart'), btnAgain: $('btnAgain'),
    btnMenu: $('btnMenu'), btnResume: $('btnResume'), btnQuit: $('btnQuit'),
    btnPause: $('btnPause'), btnSound: $('btnSound'),
    menuBest: $('menuBest'), overTitle: $('overTitle'),
    stScore: $('stScore'), stGems: $('stGems'), stDist: $('stDist'), stBest: $('stBest'),
  };
  /* 防御：按钮缺失时只告警不崩溃（便于排查环境加载问题） */
  const wire = (name, fn) => {
    const el = ui[name];
    if (el) el.onclick = fn;
    else console.warn('[TurboRush] 未找到元素 #' + name);
  };
  for (const key of Object.keys(ui)) {
    if (!ui[key]) console.warn('[TurboRush] 未找到元素 #' + key);
  }
  const show = (el, on) => el.classList.toggle('hidden', !on);
  const showFab = on => ui.btnPause.classList.toggle('hidden', !on) || ui.btnSound.classList.toggle('hidden', !on);

  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

  /* ---------- 最高分（WebView 同样可用 localStorage） ---------- */
  const store = {
    get() { try { return parseInt(localStorage.getItem('rg_best') || '0', 10) || 0; } catch (e) { return 0; } },
    set(v) { try { localStorage.setItem('rg_best', String(v)); } catch (e) {} },
  };
  let best = store.get();
  const fmt = n => Math.floor(n).toLocaleString('en-US');

  /* ---------- 原生桥（Android 注入时启用） ---------- */
  const isNative = !!(window.AndroidBridge || window.RacingNative ||
    (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native));
  function nativeCall(method, payload) {
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge[method] === 'function') {
        window.AndroidBridge[method](payload == null ? null : JSON.stringify(payload));
      }
      if (window.RacingNative && typeof window.RacingNative[method] === 'function') {
        window.RacingNative[method](payload);
      }
    } catch (e) {}
  }

  /* ---------- 界面流程 ---------- */
  let lastNativePush = 0;

  function refreshMenu() {
    best = store.get();
    ui.menuBest.textContent = fmt(best);
  }

  function goMenu() {
    show(ui.menu, true); show(ui.paused, false); show(ui.over, false);
    showFab(false);
    game.toMenu();
    refreshMenu();
  }

  function startRun() {
    RG.Audio.ensure();
    RG.Audio.click();
    show(ui.menu, false); show(ui.paused, false); show(ui.over, false);
    showFab(true);
    ui.btnPause.innerHTML = ICON_PAUSE;
    game.startGame();
  }

  function pauseGame() {
    game.pause();
    ui.btnPause.innerHTML = ICON_PLAY;
    show(ui.paused, true);
    nativeCall('onPause', null);
  }
  function resumeGame() {
    RG.Audio.ensure();
    game.resume();
    ui.btnPause.innerHTML = ICON_PAUSE;
    show(ui.paused, false);
    nativeCall('onResume', null);
  }

  wire('btnStart', startRun);
  wire('btnAgain', startRun);
  wire('btnMenu', goMenu);
  wire('btnResume', resumeGame);
  wire('btnQuit', goMenu);

  wire('btnPause', () => {
    if (game.mode === 'run') pauseGame();
    else if (game.mode === 'paused') resumeGame();
  });
  wire('btnSound', () => {
    RG.Audio.ensure();
    ui.btnSound.classList.toggle('muted', RG.Audio.toggleMute());
  });

  /* 键盘快捷 */
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    const k = e.key;
    if (k === 'Enter') {
      if (game.mode === 'menu') startRun();
      else if (game.mode === 'over') startRun();
    } else if (k === 'Escape' || k.toLowerCase() === 'p') {
      if (game.mode === 'run') pauseGame();
      else if (game.mode === 'paused') resumeGame();
    }
  });

  /* 切后台自动暂停 */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.mode === 'run') pauseGame();
  });

  /* ---------- 游戏回调 ---------- */
  let curStats = null;
  game.cbs.onGameOver = stats => {
    curStats = stats;
    show(ui.menu, false); show(ui.paused, false); showFab(false);
    const sc = Math.floor(stats.score);
    const isRecord = sc > best && sc > 0;
    if (isRecord) { best = sc; store.set(best); }
    ui.overTitle.textContent = isRecord ? '新纪录！' : '挑战结束';
    ui.overTitle.classList.toggle('record', isRecord);
    ui.stScore.textContent = fmt(sc);
    ui.stGems.textContent = stats.gems;
    ui.stDist.textContent = fmt(stats.dist) + ' m';
    ui.stBest.textContent = fmt(best);
    show(ui.over, true);
    nativeCall('onGameOver', { score: sc, gems: stats.gems, dist: Math.floor(stats.dist), record: isRecord, high: best });
  };

  game.cbs.onScore = (score, gems) => {
    const t = Date.now();
    if (isNative && t - lastNativePush > 600) {
      lastNativePush = t;
      nativeCall('onScore', { score, gems });
    }
  };

  /* ---------- 对外桥接 API（Android WebView 调用入口） ---------- */
  window.RacingGame = {
    version: '0.1.0',
    isNativeMode: isNative,
    start: startRun,
    resume: resumeGame,
    pause: pauseGame,
    backToMenu: goMenu,
    getState: () => ({
      mode: game.mode,
      score: Math.floor(game.score || 0),
      gems: game.gems || 0,
      lives: game.lives || 0,
      high: best,
    }),
    setScoreListener(fn) {
      this._userScoreFn = typeof fn === 'function' ? fn : null;
    },
    isRunning: () => game.mode === 'run',
  };
  // 允许外部（含原生桥）订阅分数变化
  const _origScore = game.cbs.onScore;
  game.cbs.onScore = (s, gm) => {
    _origScore(s, gm);
    if (window.RacingGame && typeof window.RacingGame._userScoreFn === 'function') {
      try { window.RacingGame._userScoreFn(s, gm); } catch (e) {}
    }
  };

  /* ---------- 主循环 ---------- */
  let last = performance.now();
  function frame(ts) {
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.1) dt = 0.1;
    game.update(dt);
    game.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  refreshMenu();
})();
