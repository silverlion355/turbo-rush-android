/* ============================================================
 * 极速狂飙 3D Complete · Turbo Rush 3D v3.0
 * - 实车级超跑：Ferrari F8 Tributo 风格程序化建模（低多边形高辨识度）
 *   Rosso Corsa 车漆 + 物理材质 clearcoat + PMREM 程序化环境反射
 * - 双视角：车后追尾（默认，可见全车）/ 车内驾驶舱（引擎盖+仪表+方向盘）
 * - 完整玩法：宝石连击(音阶上行+倍率)、极速 FOV 冲击、碰撞震屏红闪粒子、
 *   AI 偶发变道、车道虚线实例化滚动、菜单 360° 车展
 * - 原生桥：window.AndroidBridge.vibrate -> 碰撞/宝石触感（Android 壳使用）
 * ============================================================ */
(function () {
  'use strict';

  var SUPPORTED = (function () {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  })();

  var CFG = {
    ROAD_W: 10, ROAD_HALF: 5, LANES: 4,
    PX_RANGE: 5.6,
    Z0: 0,
    CAM: { h: 3.4, d: 7.6, lookY: 0.55, lookZ: -10 },   // 追尾相机（近，突出全车）
    FOV: 58,
    CRUISE_MAX: 205, CRUISE_TIME: 60,
    BOOST_K: 1.42, BRAKE_K: 0.3,
    STEER_SENS: 5.6, STEER_KBD: 720, STEER_TILT: 0.16,
    INVINCIBLE: 1.8, HIT_DROP: 0.5,
    GEM_SCORE: 60, GEM_COMBO_WIN: 1.7,
    SPAWN_Z: -520, CULL_Z: 30,
    FOG: { near: 70, far: 340, color: 0xcfe4f0 },
    SKY: 0x8fc3e8,
    AI_SPEED_MIN: 0.4, AI_SPEED_MAX: 0.66, AI_GAP_MIN: 26,
    DASH_PITCH: 8.4, DASH_LEN: 2.9,
  };

  /* ============ 通用 ============ */
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clampX(x) { return clamp(x, -CFG.PX_RANGE, CFG.PX_RANGE); }
  function sstep(t) { return t * t * (3 - 2 * t); }
  function vib(ms) {
    try { if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === 'function') window.AndroidBridge.vibrate(ms); } catch (e) { }
  }

  /* ============ 音频（WebAudio 合成） ============ */
  var Audio = {
    ctx: null, master: null, muted: false, engine: null,
    ensure: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        return true;
      } catch (e) { return false; }
    },
    toggle: function () {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
      return this.muted;
    },
    tone: function (f0, f1, dur, type, vol) {
      if (!this.ensure() || this.muted) return;
      var t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.05);
    },
    /* 宝石：连击音阶上行 */
    gem: function (step) {
      if (this.muted) return;
      var f = 760 * Math.pow(2, Math.min(step, 12) / 12);
      this.tone(f, f * 1.02, 0.12, 'sine', 0.15);
      this.tone(f * 1.5, f * 1.52, 0.14, 'sine', 0.11);
    },
    crash: function () {
      if (!this.ensure() || this.muted) return;
      var t = this.ctx.currentTime, len = 0.4, buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      var s = this.ctx.createBufferSource(); s.buffer = buf;
      var f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 850;
      var g = this.ctx.createGain(); g.gain.value = 0.5;
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
    },
    startEngine: function () {
      if (!this.ensure() || this.muted || this.engine) return;
      var t = this.ctx.currentTime, o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'square';
      g.gain.value = 0.032;
      o1.frequency.value = 55; o2.frequency.value = 27.5;
      o1.connect(g); o2.connect(g); g.connect(this.master);
      o1.start(t); o2.start(t);
      this.engine = { o1: o1, o2: o2 };
    },
    engineSpeed: function (ratio) {
      if (!this.engine) return;
      var f = 55 + ratio * 130;
      this.engine.o1.frequency.value = f;
      this.engine.o2.frequency.value = f / 2;
    },
    stopEngine: function () {
      if (!this.engine) return;
      try { this.engine.o1.stop(); this.engine.o2.stop(); } catch (e) { }
      this.engine = null;
    }
  };

  /* ============ DOM / 状态 ============ */
  var canvas = $('game'), renderer = null, scene, camera;
  var uiScore = $('score'), uiDist = $('distVal'), uiSpeed = $('speedVal'), uiLives = $('lives'),
      uiView = $('viewBadge'), btnView = $('btnView'), menu = $('menu'), over = $('over'),
      uiFinalS = $('finalScore'), uiFinalD = $('finalDist'), uiFinalG = $('finalGems'),
      uiCombo = $('combo'), uiComboTxt = $('comboTxt'), uiComboBar = $('comboBar'),
      elFlash = $('flash');
  var W = 0, H = 0, dpr = 1;
  var state = 'menu';               // menu | run | over
  var time = 0, runT = 0, dist = 0, score = 0, gems = 0, lives = 3;
  var speed = 0, targetSpeed = 0, boostT = 0, brakeT = 0;
  var px = 0, pvx = 0, carTilt = 0, steerVis = 0;
  var inv = 0, shake = 0, flash = 0, overT = 0;
  var aiCars = [], gemsArr = [], trees = [], parts = [], dashInst = null, dashData = [];
  var playerGrp = null, seatCam = null, wheelParts = [], frontWheelGrps = [], wheelSpin = [];
  var comboN = 0, comboT = 0, pendingPop = [];
  var lastTm = 0, scrollDash = 0, camFov = CFG.FOV;
  var CHASE = 0, COCKPIT = 1, viewMode = CHASE, viewBlend = 1;   // blend 1=chase 0=cockpit
  var uiPopups = [];

  /* ============ 输入 ============ */
  var input = { kLeft: 0, kRight: 0, kUp: 0, kDown: 0, drag: null, tgtX: null };

  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var t = e.touches[0];
    input.drag = { sx: t.clientX, sy: t.clientY, px: t.clientX, py: t.clientY, dx: 0, dy: 0 };
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (!input.drag || !e.touches.length) return;
    var t = e.touches[0];
    var dx = t.clientX - input.drag.px, dy = t.clientY - input.drag.py;
    input.drag.dx += dx; input.drag.dy += dy;
    input.drag.px = t.clientX; input.drag.py = t.clientY;
    if (input.tgtX == null) input.tgtX = px;
    input.tgtX = clampX(input.tgtX + dx * (CFG.STEER_SENS * 2 / Math.max(W, 360)));
    if (input.drag.dy < -28) { if (!input.drag.boost) { input.drag.boost = true; boostT = 1.35; } }
    if (input.drag.dy > 28) brakeT = 0.5;
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) { e.preventDefault(); input.drag = null; input.tgtX = null; }, { passive: false });
  canvas.addEventListener('touchcancel', function (e) { e.preventDefault(); input.drag = null; input.tgtX = null; }, { passive: false });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.kLeft = 1;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.kRight = 1;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') input.kUp = 1;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') input.kDown = 1;
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyC' || e.code === 'KeyV') { if (state === 'run') cycleView(); }
  });
  window.addEventListener('keyup', function (e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.kLeft = 0;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.kRight = 0;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') input.kUp = 0;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') input.kDown = 0;
  });

  /* ============================================================
   * 实车级超跑工厂 —— Ferrari F8 Tributo 风格
   * 坐标：车头 -z / 车尾 +z / 上 +y / 轮轴 y0.33
   * ============================================================ */
  function makeMaterial(color, opts) {
    opts = opts || {};
    var m = new THREE.MeshStandardMaterial({ color: color, metalness: opts.metal != null ? opts.metal : 0.5, roughness: opts.rough != null ? opts.rough : 0.34 });
    if (opts.clearcoat) { m.clearcoat = 1; m.clearcoatRoughness = 0.08; }
    if (opts.side) m.side = opts.side;
    if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity; }
    if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.ei != null ? opts.ei : 1; }
    if (opts.flat) m.flatShading = true;
    return m;
  }
  function B(w, h, d, x, y, z, mat) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); return m;
  }
  function paintMat(hex) { return makeMaterial(hex, { clearcoat: true, metal: 0.62, rough: 0.3 }); }
  var M_DARK = null, M_GLASS = null, M_TIRE = null, M_RIM = null, M_CARBON = null;

  function initCarMats() {
    M_DARK = makeMaterial(0x14161c, { metal: 0.1, rough: 0.85 });
    M_GLASS = makeMaterial(0x0b1220, { metal: 0.9, rough: 0.06, transparent: true, opacity: 0.42, side: THREE.DoubleSide });
    M_TIRE = makeMaterial(0x0c0d10, { rough: 0.95, metal: 0 });
    M_RIM = makeMaterial(0xb8bec6, { metal: 0.95, rough: 0.22 });
    M_CARBON = makeMaterial(0x17191d, { rough: 0.6, metal: 0.2 });
  }

  function makeWheel(hi) {
    var g = new THREE.Group();
    var tire = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 20), M_TIRE);
    tire.rotation.z = Math.PI / 2; g.add(tire);
    var rim = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.25, 20), M_RIM);
    rim.rotation.z = Math.PI / 2; g.add(rim);
    var spokeMat = makeMaterial(0x9aa2ad, { metal: 0.92, rough: 0.2 });
    if (hi) {
      var n = 5;
      for (var i = 0; i < n; i++) {
        var sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.17, 0.035), spokeMat);
        sp.rotation.x = (i / n) * Math.PI * 2;
        g.add(sp);
      }
      var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.27, 12), M_RIM);
      cap.rotation.z = Math.PI / 2; g.add(cap);
      // 黄色卡钳
      var cal = B(0.09, 0.05, 0.05, 0, 0.055, 0.11, makeMaterial(0xffcf3f, { rough: 0.4, metal: 0.2 }));
      g.add(cal);
      cal = cal.clone(); cal.position.z = -0.11; g.add(cal);
    }
    return g;
  }

  /* 超跑整装 */
  function makeSupercar(opts) {
    opts = opts || {};
    var hi = opts.lod !== 'lo';
    var pal = opts.pal || {};
    var body = pal.body != null ? pal.body : 0xd40000;
    var bodyDark = pal.bodyDark != null ? pal.bodyDark : 0x9c0d0d;
    var accent = pal.accent != null ? pal.accent : 0xffd23f;
    var mBody = paintMat(body);
    var mBodyD = paintMat(bodyDark);
    var mBlack = makeMaterial(0x17181d, { rough: 0.42, metal: 0.15 });
    var mSilver = makeMaterial(0xc9cdd4, { metal: 0.9, rough: 0.25 });
    var mLight = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
    var mTailL = new THREE.MeshBasicMaterial({ color: 0xff2233 });
    var g = new THREE.Group();

    /* —— 底盘 —— */
    var floor = B(1.7, 0.16, 4.45, 0, 0.13, 0, M_DARK);
    g.add(floor);

    /* —— 前翼子板（左右）—— */
    var podW = 0.5;
    [-1, 1].forEach(function (s) {
      var pod = B(podW, 0.4, 1.62, s * (0.72), 0.52, -1.44, mBody);   // 顶 y0.72
      pod.rotation.y = s * 0.05;
      g.add(pod);
      // 前挡泥上拱线（黑色饰条）
      var arch = B(0.06, 0.05, 0.9, s * 0.985, 0.62, -1.5, M_DARK);
      g.add(arch);
    });
    /* —— 中置引擎舱盖（前备箱盖，低于翼子板）—— */
    var hood = B(0.84, 0.2, 1.06, 0, 0.48, -1.5, mBody);   // 顶 y0.58
    g.add(hood);
    var hoodVent = B(0.44, 0.012, 0.5, 0, 0.585, -1.98, mBlack);
    g.add(hoodVent);

    /* —— 前脸：黑进气 + 分体大灯 —— */
    var nose = B(1.94, 0.26, 0.34, 0, 0.3, -2.24, mBlack);   // 黑格栅下段
    g.add(nose);
    var noseLip = B(1.98, 0.06, 0.42, 0, 0.14, -2.36, mBlack);
    g.add(noseLip);
    var bumper = B(1.9, 0.24, 0.5, 0, 0.58, -2.08, mBody);
    bumper.rotation.x = -0.14;
    g.add(bumper);
    var mouth = B(1.24, 0.16, 0.08, 0, 0.48, -2.3, mBlack);
    g.add(mouth);
    [-1, 1].forEach(function (s) {
      var hl = B(0.34, 0.05, 0.16, s * 0.58, 0.68, -2.26, mLight);  // 细长大灯
      hl.rotation.z = s * 0.12; hl.rotation.y = s * 0.1;
      g.add(hl);
      var hlDark = B(0.52, 0.07, 0.14, s * 0.6, 0.64, -2.23, mBlack);
      g.add(hlDark);
    });

    /* —— 座舱前挡风下横梁 / 仪表台顶（实体，车内视角可见）—— */
    var cowl = B(1.5, 0.16, 0.2, 0, 0.55, -0.92, mBody);
    g.add(cowl);

    /* —— 门槛/车门主体侧 —— */
    [-1, 1].forEach(function (s) {
      var side = B(0.42, 0.42, 2.5, s * 0.68, 0.52, 0.8, mBody);  // 顶 y0.73
      g.add(side);
      var sill = B(0.36, 0.2, 2.2, s * 0.62, 0.22, 0.3, M_DARK);
      g.add(sill);
      var doorLine = B(0.01, 0.03, 1.1, s * 0.9, 0.62, 0.2, mBlack);
      g.add(doorLine);
    });
    /* —— 侧进气口（F8 标志，后轮前）—— */
    [-1, 1].forEach(function (s) {
      var intake = B(0.1, 0.2, 0.72, s * 0.9, 0.56, 0.78, mBlack);
      intake.rotation.z = s * 0.1;
      g.add(intake);
    });
    /* —— 座舱玻璃（挡风 + 顶 + 后窗 + 侧窗）—— */
    var winFront = B(0.72, 0.03, 1.0, 0, 0.8, -0.62, M_GLASS);
    winFront.rotation.x = -0.86;
    g.add(winFront);
    var winRoof = B(0.66, 0.025, 0.55, 0, 1.02, -0.02, M_GLASS);
    winRoof.rotation.x = 0.34;
    g.add(winRoof);
    var winRear = B(0.7, 0.03, 0.92, 0, 0.86, 0.66, M_GLASS);
    winRear.rotation.x = -0.42;
    g.add(winRear);
    [-1, 1].forEach(function (s) {
      var sw = B(0.03, 0.3, 1.15, s * 0.48, 0.86, 0.02, M_GLASS);
      g.add(sw);
    });

    /* —— 车内：仪表台/方向盘/座椅（驾驶舱视角元素）—— */
    var dash = B(0.66, 0.1, 0.24, 0, 0.62, -0.84, mBlack);
    g.add(dash);
    var dashScreen = B(0.22, 0.04, 0.02, 0.13, 0.655, -0.945, makeMaterial(0x12263a, { metal: 0, rough: 0.3, emissive: 0x1a4f78, ei: 1.2 }));
    g.add(dashScreen);
    var wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 10, 24), mBlack);
    wheelRing.position.set(0.3, 0.58, -0.88); wheelRing.rotation.x = -0.45;
    g.add(wheelRing);
    var wheelHub = B(0.08, 0.1, 0.06, 0.3, 0.58, -0.82, mSilver);
    g.add(wheelHub);
    var seatMat = makeMaterial(0x1c1f26, { rough: 0.85, metal: 0.05 });
    [-0.34, 0.34].forEach(function (sx) {
      var seat = B(0.5, 0.34, 0.5, sx, 0.3, 0.62, seatMat);
      seat.rotation.y = sx > 0 ? 0.06 : -0.06;
      g.add(seat);
      var head = B(0.44, 0.24, 0.14, sx, 0.68, 0.82, seatMat);
      g.add(head);
    });

    /* —— 尾舱玻璃盖板（引擎盖，格栅）—— */
    var deckG = B(0.8, 0.05, 0.42, 0, 0.78, 1.66, M_GLASS);
    g.add(deckG);
    /* —— 后肩 / 车尾 —— */
    [-1, 1].forEach(function (s) {
      var hip = B(0.42, 0.34, 0.8, s * 0.68, 0.66, 1.85, mBodyD);
      g.add(hip);
    });
    var tailF = B(1.86, 0.52, 0.2, 0, 0.56, 2.14, mBlack);       // 黑尾板
    g.add(tailF);
    var tailTop = B(1.62, 0.16, 0.5, 0, 0.82, 1.98, mBodyD);     // 尾甲板
    g.add(tailTop);
    var diff = B(1.5, 0.22, 0.34, 0, 0.22, 2.18, M_CARBON);      // 扩散器
    g.add(diff);
    [-1, 1].forEach(function (s) {
      g.add(B(0.06, 0.18, 0.1, s * 0.5, 0.1, 2.2, M_CARBON));    // 扩散器鳍
    });
    // 双出排气
    [-0.24, 0.24].forEach(function (sx) {
      var ex = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 12), mSilver);
      ex.rotation.x = Math.PI / 2; ex.position.set(sx, 0.42, 2.22);
      g.add(ex);
      var exIn = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.17, 10), mBlack);
      exIn.rotation.x = Math.PI / 2; exIn.position.set(sx, 0.42, 2.24);
      g.add(exIn);
    });
    // 四圆尾灯
    [-1, 1].forEach(function (s) {
      for (var k = 0; k < 2; k++) {
        var lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 14), mTailL);
        lamp.rotation.x = Math.PI / 2;
        lamp.position.set(s * (0.42 + k * 0.2), 0.62, 2.24);
        g.add(lamp);
      }
    });
    // 小鸭尾
    var lip = B(1.6, 0.045, 0.3, 0, 0.9, 2.06, mBodyD);
    lip.rotation.x = -0.1;
    g.add(lip);

    /* —— 后视镜 —— */
    [-1, 1].forEach(function (s) {
      var stem = B(0.02, 0.03, 0.12, s * 0.98, 0.82, -0.95, M_DARK);
      g.add(stem);
      var mir = B(0.2, 0.09, 0.1, s * 1.06, 0.86, -0.98, mBody);
      g.add(mir);
    });

    /* —— 车轮（前轮可转向）+ 轮拱眉（上半黑环，营造轮拱切面）—— */
    var axles = [[-0.9, -1.56], [0.9, -1.56], [-0.9, 1.48], [0.9, 1.48]];
    for (var i = 0; i < 4; i++) {
      var wg2 = makeWheel(hi);
      wg2.position.set(axles[i][0], 0.33, axles[i][1]);
      var arcGeo = new THREE.TorusGeometry(0.4, 0.045, 8, 16, Math.PI);
      var fender = new THREE.Mesh(arcGeo, M_DARK);
      fender.rotation.y = Math.PI / 2;          // 环轴对齐 x → 环落在 y-z 平面
      fender.position.set(axles[i][0], 0.45, axles[i][1]);
      g.add(fender);
      g.add(wg2);
      if (i < 2) frontWheelGrps.push(wg2);
      wheelSpin.push({ grp: wg2, r: 0.33, child: wg2.children[0] });
    }

    /* 撞车后隐藏整台车需要记录引用 */
    g.userData.opts = opts;
    return g;
  }

  function playerCar() {
    return makeSupercar({
      lod: 'hi',
      pal: { body: 0xd40000, bodyDark: 0x9c0d0d, accent: 0xffd23f }
    });
  }

  var AI_PALS = [
    { body: 0x1f5fdb, bodyDark: 0x17409c },   // 蓝
    { body: 0x2ba84a, bodyDark: 0x1d7a33 },   // 绿
    { body: 0xf0b429, bodyDark: 0xb9861c },   // 黄
    { body: 0x8a4fff, bodyDark: 0x6433c9 },   // 紫
    { body: 0xc9cdd4, bodyDark: 0x969ba3 },   // 银
    { body: 0xff6b1a, bodyDark: 0xcc4c0a }    // 橙
  ];

  /* ============ 粒子 ============ */
  function burst(x, y, z, n) {
    for (var i = 0; i < n; i++) {
      var m = new THREE.Mesh(new THREE.OctahedronGeometry(0.1 + Math.random() * 0.14, 0),
        new THREE.MeshBasicMaterial({ color: [0xffd23f, 0xff7a2e, 0xfff6d8, 0xff3b30][i % 4] }));
      m.position.set(x, y + 0.3, z);
      scene.add(m);
      parts.push({
        m: m,
        vx: (Math.random() - 0.5) * 7, vy: 2.5 + Math.random() * 4, vz: (Math.random() - 0.5) * 7,
        life: 0.55 + Math.random() * 0.3
      });
    }
  }

  /* ============ 飘分 / HUD 辅助 ============ */
  function flushPopups() {
    if (!pendingPop.length) return;
    var hudEl = $('hud');
    pendingPop.forEach(function (p) {
      var v = p.pos.clone().project(camera);
      if (v.z > 1) return;
      var x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      var el = document.createElement('div');
      el.className = 'pop' + (p.cls || '');
      el.textContent = p.txt;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      hudEl.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 950);
    });
    pendingPop = [];
  }
  function showCombo() {
    if (comboN < 2) { uiCombo.style.opacity = '0'; return; }
    uiCombo.style.opacity = '1';
    var mult = comboN >= 10 ? 2 : (comboN >= 5 ? 1.5 : 1);
    uiComboTxt.textContent = comboN + ' 连击 ×' + mult;
    uiComboBar.style.width = (comboT / CFG.GEM_COMBO_WIN * 100) + '%';
  }

  /* ============ 世界 ============ */
  function buildScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CFG.SKY);
    scene.fog = new THREE.Fog(CFG.FOG.color, CFG.FOG.near, CFG.FOG.far);

    camera = new THREE.PerspectiveCamera(CFG.FOV, W / H, 0.1, 900);
    camFov = CFG.FOV;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.setSize(W, H, false);
    initCarMats();

    // 程序化环境反射（PMREM）——让车漆/玻璃有真实光泽
    try {
      if (THREE.PMREMGenerator && THREE.CanvasTexture) {
        var cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
        var cx = cv.getContext('2d');
        var gr = cx.createLinearGradient(0, 0, 0, 32);
        gr.addColorStop(0, '#b9d6ff'); gr.addColorStop(0.42, '#dcedff');
        gr.addColorStop(0.5, '#f6f9fd'); gr.addColorStop(0.54, '#c8d9b2');
        gr.addColorStop(0.75, '#57794b'); gr.addColorStop(1, '#33503a');
        cx.fillStyle = gr; cx.fillRect(0, 0, 64, 32);
        var tex = new THREE.CanvasTexture(cv);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        var pmrem = new THREE.PMREMGenerator(renderer);
        var rt = pmrem.fromEquirectangular(tex);
        scene.environment = rt.texture;
        tex.dispose(); pmrem.dispose();
      }
    } catch (e) { /* 低端机忽略环境反射 */ }

    // 灯光
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    var sun = new THREE.DirectionalLight(0xfff2d8, 1.25);
    sun.position.set(12, 20, 8);
    scene.add(sun);
    var fill = new THREE.DirectionalLight(0x9fc8ff, 0.4);
    fill.position.set(-8, 4, -10);
    scene.add(fill);
    var hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a4a33, 0.55);
    scene.add(hemi);

    // 天空球
    var sky = new THREE.Mesh(new THREE.SphereGeometry(650, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xbfe0ff, side: THREE.BackSide, fog: false }));
    sky.position.y = -30; scene.add(sky);
    // 远山
    for (var i = 0; i < 10; i++) {
      var mtn = new THREE.Mesh(new THREE.ConeGeometry(28 + Math.random() * 34, 18 + Math.random() * 30, 5),
        new THREE.MeshLambertMaterial({ color: 0x7fa8c4, flatShading: true }));
      mtn.position.set(-340 + i * 76 + Math.random() * 30, -3, -360 + Math.random() * 110);
      mtn.rotation.y = Math.random() * 3;
      scene.add(mtn);
    }
    // 草地
    var grassMat = new THREE.MeshLambertMaterial({ color: 0x6aa84f });
    [-600, -1600].forEach(function (z) {
      var grass = new THREE.Mesh(new THREE.PlaneGeometry(640, 1000), grassMat);
      grass.rotation.x = -Math.PI / 2;
      grass.position.set(0, -0.02, z);
      scene.add(grass);
    });
    // 道路
    var road = new THREE.Mesh(new THREE.PlaneGeometry(CFG.ROAD_W, 2600),
      new THREE.MeshLambertMaterial({ color: 0x464a53 }));
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0.004, -1080);
    scene.add(road);
    // 路缘（左红右白）
    [-1, 1].forEach(function (side) {
      var curb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 2600),
        new THREE.MeshLambertMaterial({ color: side > 0 ? 0xcc4a4a : 0xd8dde4 }));
      curb.position.set(side * (CFG.ROAD_HALF + 0.3), 0.03, -1080);
      scene.add(curb);
    });

    // 车道虚线：InstancedMesh（实例化滚动，1 次 draw call）
    var rows = [
      { x: -2.5, c: 0xe6ebef },
      { x: -0.09, c: 0xf5c542 },
      { x: 0.09, c: 0xf5c542 },
      { x: 2.5, c: 0xe6ebef }
    ];
    var dashSpan = CFG.DASH_PITCH * 36, perRow = 36;   // 总跨度须为 间距×数量（周期对齐）
    var total = rows.length * perRow;
    var dGeo = new THREE.BoxGeometry(0.15, 0.008, CFG.DASH_LEN);
    var dMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    dashInst = new THREE.InstancedMesh(dGeo, dMat, total);
    dashInst.frustumCulled = false;
    var m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
    dashData = [];
    var col = new THREE.Color();
    for (var r = 0; r < rows.length; r++) {
      for (var k = 0; k < perRow; k++) {
        var idx = r * perRow + k;
        var zz = -282 + k * CFG.DASH_PITCH;
        dashData.push({ x: rows[r].x, z: zz });
        m4.compose(v3.set(rows[r].x, 0.032, zz), q0, s1);
        dashInst.setMatrixAt(idx, m4);
        col.setHex(rows[r].c);
        dashInst.setColorAt(idx, col);
      }
    }
    scene.add(dashInst);
    scrollDash = 0;
  }

  function makeGem() {
    var rr = Math.random();
    var c = rr < 0.45 ? 0x37d0ff : (rr < 0.8 ? 0xffd23f : 0xff5ad1);
    var geo = new THREE.OctahedronGeometry(0.52, 0);
    var m = new THREE.MeshPhongMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, shininess: 90 });
    var gem = new THREE.Mesh(geo, m);
    var core = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    gem.add(core);
    gem.userData.spin = Math.random() * 6;
    gem.userData.baseY = 1.15;
    gem.visible = state === 'run';
    return gem;
  }

  function makeTree() {
    var g2 = new THREE.Group();
    var s = 0.85 + Math.random() * 0.95;
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.32 * s, 2.3 * s, 6),
      new THREE.MeshLambertMaterial({ color: 0x7a5230 }));
    trunk.position.y = 1.15 * s; g2.add(trunk);
    var leaf = new THREE.Mesh(new THREE.ConeGeometry(1.85 * s, 4.4 * s, 7),
      new THREE.MeshLambertMaterial({ color: Math.random() < 0.5 ? 0x3f9b43 : 0x4fae55, flatShading: true }));
    leaf.position.y = 3.6 * s; g2.add(leaf);
    g2.userData.s = s;
    return g2;
  }

  function laneCx() {
    var arr = [];
    for (var i = 0; i < CFG.LANES; i++) arr.push(-CFG.ROAD_HALF + (CFG.ROAD_W / CFG.LANES) * (i + 0.5));
    return arr;
  }

  function spawnWorld() {
    var lanes = laneCx();
    for (var i = 0; i < 6; i++) {
      var pal = AI_PALS[(Math.random() * AI_PALS.length) | 0];
      var mesh = makeSupercar({ pal: pal, lod: 'lo' });
      var lane = (Math.random() * CFG.LANES) | 0;
      var z = -90 - i * 66 - Math.random() * 30;
      scene.add(mesh);
      aiCars.push({
        mesh: mesh, lane: lane, laneFrom: lane, laneP: 1, manT: Math.random() * 5,
        ratio: CFG.AI_SPEED_MIN + Math.random() * (CFG.AI_SPEED_MAX - CFG.AI_SPEED_MIN),
        z: z, pal: pal
      });
      mesh.position.set(lanes[lane], 0, z);
    }
    // 宝石列
    for (var r = 0; r < 15; r++) {
      var lane2 = (Math.random() * CFG.LANES) | 0;
      var z0 = -66 - r * 52 - Math.random() * 18;
      var n = 1 + ((Math.random() * 5) | 0);
      for (var gi = 0; gi < n; gi++) {
        var gem = makeGem();
        gem.position.set(lanes[lane2] + (Math.random() - 0.5) * 1.4, gem.userData.baseY, z0 - gi * 9);
        scene.add(gem); gemsArr.push(gem);
      }
    }
    // 树
    var side = -1;
    for (var ti = 0; ti < 40; ti++) {
      var tr = makeTree();
      side = -side;
      var off = 10 + Math.random() * 44;
      tr.position.set(side * (CFG.PX_RANGE + off), 0, -36 - ti * 26 - Math.random() * 12);
      scene.add(tr); trees.push(tr);
    }
  }

  function clearWorld() {
    aiCars.forEach(function (a) { scene.remove(a.mesh); });
    gemsArr.forEach(function (g) { scene.remove(g); });
    trees.forEach(function (t) { scene.remove(t); });
    parts.forEach(function (p) { scene.remove(p.m); });
    aiCars = []; gemsArr = []; trees = []; parts = [];
  }

  function resetRun() {
    runT = 0; dist = 0; score = 0; gems = 0; lives = 3;
    speed = 0; targetSpeed = 0; boostT = 0; brakeT = 0;
    px = 0; pvx = 0; carTilt = 0; steerVis = 0; inv = 0; shake = 0; flash = 0;
    comboN = 0; comboT = 0;
    if (playerGrp) { playerGrp.visible = true; playerGrp.rotation.set(0, 0, 0); }
    clearWorld();
    spawnWorld();
    updateLives();
  }

  /* ============ 视角 ============ */
  function cycleView() {
    viewMode = 1 - viewMode;
    setViewUI();
  }
  function setViewUI() {
    uiView.textContent = viewMode === COCKPIT ? '驾驶舱视角' : '追尾视角';
    btnView.textContent = viewMode === COCKPIT ? '车后视角' : '车内视角';
  }
  function setViewVisible(on) {
    btnView.classList.toggle('hidden', !on);
    uiView.style.display = on ? '' : 'none';
    if (on) setViewUI();
  }

  function updateCamera(dt) {
    if (state !== 'run') return;
    var ratio = speed / CFG.CRUISE_MAX;
    if (viewMode === COCKPIT) {
      // 驾驶舱：相机挂驾驶位
      playerGrp.updateMatrixWorld();
      var p = new THREE.Vector3(), q = new THREE.Quaternion();
      seatCam.getWorldPosition(p);
      seatCam.getWorldQuaternion(q);
      camera.position.copy(p);
      camera.quaternion.copy(q);
      // 轻微点头/震
      camera.position.y += Math.sin(time * 1.7) * 0.0015 * (0.4 + ratio);
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake * 0.012;
        camera.position.y += (Math.random() - 0.5) * shake * 0.012;
      }
      // 速度 FOV 冲击
      var tf = CFG.FOV - 6 + ratio * 16;
      if (Math.abs(tf - camFov) > 0.1) { camFov += (tf - camFov) * Math.min(1, dt * 5); camera.fov = camFov; camera.updateProjectionMatrix(); }
    } else {
      var camX = px * 0.82 + steerVis * -0.7;
      var ch = CFG.CAM.h + ratio * 0.5;
      var cd = CFG.CAM.d - ratio * 0.8;
      camera.position.set(camX, ch, cd);
      camera.lookAt(px * 0.98, CFG.CAM.lookY + ratio * 0.3, CFG.CAM.lookZ - ratio * 3);
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake * 0.02;
        camera.position.y += (Math.random() - 0.5) * shake * 0.02;
      }
      var tf2 = CFG.FOV - 2 + ratio * 10;
      if (Math.abs(tf2 - camFov) > 0.1) { camFov += (tf2 - camFov) * Math.min(1, dt * 5); camera.fov = camFov; camera.updateProjectionMatrix(); }
    }
  }

  /* ============ 主循环 ============ */
  function update(dt) {
    time += dt;
    if (state !== 'run') return;
    runT += dt;

    // —— 目标速度（S 形）——
    var prog = clamp(runT / CFG.CRUISE_TIME, 0, 1);
    var cruise = CFG.CRUISE_MAX * sstep(prog);
    var tgt = cruise;
    if (input.kUp) tgt = cruise * 1.25;
    if (input.kDown) tgt = cruise * 0.3;
    boostT -= dt; brakeT -= dt;
    if (boostT > 0) tgt = Math.max(tgt, cruise * CFG.BOOST_K);
    if (brakeT > 0) tgt = Math.min(tgt, speed * CFG.BRAKE_K + 8);
    if (inv > 0) tgt = Math.min(tgt, cruise * 0.72);
    targetSpeed = tgt;
    speed += (targetSpeed - speed) * Math.min(1, dt * 2.2);
    var advance = speed / 3.6 * dt * 1.9;
    dist += advance;
    var ratio = speed / CFG.CRUISE_MAX;

    // —— 转向 ——
    var tgtX = px;
    if (input.drag && input.tgtX != null) tgtX = input.tgtX;
    var kb = 0;
    if (input.kLeft) kb -= 1;
    if (input.kRight) kb += 1;
    if (kb) tgtX = clampX(px + kb * CFG.STEER_KBD * dt);
    pvx += (tgtX - px) * Math.min(1, dt * 9);
    px = clampX(pvx);
    var steerSig = kb ? kb : (input.drag && input.tgtX != null ? clamp((input.tgtX - px) * 3, -1, 1) : 0);
    steerVis += (steerSig - steerVis) * Math.min(1, dt * 6);
    carTilt += (steerSig * CFG.STEER_TILT - carTilt) * Math.min(1, dt * 8);

    // —— AI 滚动 + 偶发变道 ——
    var lanes = laneCx();
    aiCars.forEach(function (a) {
      a.z += advance * (1 - a.ratio);
      // 变道决策：远处慢车偶发换道
      a.manT -= dt;
      if (a.manT <= 0) {
        a.manT = 3.5 + Math.random() * 6;
        if (a.z < -30 && a.z > -420 && Math.random() < 0.5) {
          var nl = clamp(a.lane + (Math.random() < 0.5 ? -1 : 1), 0, CFG.LANES - 1);
          if (nl !== a.lane) {
            // 避让检查：目标车道是否有车在 ±34m
            var clear = true;
            for (var oi = 0; oi < aiCars.length; oi++) {
              var o = aiCars[oi];
              if (o !== a && o.lane === nl && Math.abs(o.z - a.z) < 34) { clear = false; break; }
            }
            if (clear) { a.laneFrom = a.lane; a.lane = nl; a.laneP = 0; }
          }
        }
      }
      if (a.laneP < 1) {
        a.laneP = Math.min(1, a.laneP + dt * 0.9);
        a.mesh.position.x = lanes[a.laneFrom] + (lanes[a.lane] - lanes[a.laneFrom]) * sstep(a.laneP);
      } else {
        a.mesh.position.x += (lanes[a.lane] - a.mesh.position.x) * Math.min(1, dt * 4);
      }
      a.mesh.position.z = a.z;
      a.mesh.rotation.y = clamp((lanes[a.lane] - a.mesh.position.x) * 0.06, -0.3, 0.3);
      if (a.z > CFG.CULL_Z) {
        a.z -= 560 + Math.random() * 200;
        a.lane = (Math.random() * CFG.LANES) | 0;
        a.laneFrom = a.lane; a.laneP = 1;
        a.mesh.position.set(lanes[a.lane], 0, a.z);
        a.manT = Math.random() * 4;
      }
    });

    // —— 宝石 / 树 / 虚线滚动 ——
    gemsArr.forEach(function (g) {
      g.position.z += advance;
      g.userData.spin += dt * 3.6;
      g.rotation.y = g.userData.spin;
      g.rotation.x = Math.sin(g.userData.spin * 0.7) * 0.3;
      g.position.y = g.userData.baseY + Math.sin(time * 3 + g.position.z * 0.1) * 0.12;
      if (g.position.z > CFG.CULL_Z + 6) {
        var ln = (Math.random() * CFG.LANES) | 0;
        g.position.set(lanes[ln] + (Math.random() - 0.5) * 1.4, g.userData.baseY, -460 - Math.random() * 90);
      }
    });
    trees.forEach(function (t) {
      t.position.z += advance;
      if (t.position.z > CFG.CULL_Z) t.position.z -= 1200;
    });
    scrollDash += advance;
    if (dashInst) {
      var mL = CFG.DASH_PITCH * 36;
      if (scrollDash > mL) scrollDash -= mL;
      var m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
      for (var di = 0; di < dashData.length; di++) {
        var dd = dashData[di];
        var zz = dd.z + scrollDash;
        if (zz > 40) zz -= mL; else if (zz < -280) zz += mL;
        m4.compose(v3.set(dd.x, 0.032, zz), q0, s1);
        dashInst.setMatrixAt(di, m4);
      }
      dashInst.instanceMatrix.needsUpdate = true;
    }

    // —— 连击计时 ——
    comboT -= dt;
    if (comboT <= 0) { if (comboN > 1) comboN = 0; else comboN = 0; showCombo(); }
    else showCombo();

    // —— 宝石收集 ——
    for (var gi = gemsArr.length - 1; gi >= 0; gi--) {
      var g = gemsArr[gi];
      var dx = g.position.x - px, dz = g.position.z - CFG.Z0;
      if (dx * dx + dz * dz < 2.7) {
        var fresh = (comboT > 0);
        comboN = fresh ? comboN + 1 : 1;
        comboT = CFG.GEM_COMBO_WIN;
        gems += 1;
        var mult = comboN >= 10 ? 2 : (comboN >= 5 ? 1.5 : 1);
        var val = Math.round(CFG.GEM_SCORE * mult);
        score += val;
        Audio.gem(comboN);
        vib(comboN >= 5 ? 14 : 7);
        burst(g.position.x, g.position.y, g.position.z, 7);
        pendingPop.push({ pos: g.position.clone(), txt: (mult > 1 ? '+' + val + ' ×' + mult : '+' + val), cls: mult >= 2 ? ' x2' : (mult > 1 ? ' x15' : '') });
        scene.remove(g); gemsArr.splice(gi, 1);
        var ng = makeGem();
        var ln2 = (Math.random() * CFG.LANES) | 0;
        ng.position.set(lanes[ln2] + (Math.random() - 0.5) * 1.4, ng.userData.baseY, -430 - Math.random() * 90);
        ng.visible = true;
        scene.add(ng); gemsArr.push(ng);
      }
    }

    // —— 碰撞 ——
    if (inv <= 0) {
      for (var ci = 0; ci < aiCars.length; ci++) {
        var a = aiCars[ci];
        var cdx = a.mesh.position.x - px, cdz = a.mesh.position.z - CFG.Z0;
        if (Math.abs(cdz) < 3.4 && Math.abs(cdx) < 1.9) { onHit(a, cdx); break; }
      }
    }
    inv -= dt; shake -= dt * 26; flash -= dt;
    if (inv < 0) inv = 0; if (shake < 0) shake = 0; if (flash < 0) flash = 0;
    elFlash.style.opacity = flash > 0 ? String(flash * 1.6) : '0';

    // —— 粒子 ——
    for (var pi = parts.length - 1; pi >= 0; pi--) {
      var pt = parts[pi];
      pt.life -= dt;
      pt.m.position.x += pt.vx * dt;
      pt.m.position.y += pt.vy * dt; pt.vy -= 14 * dt;
      pt.m.position.z += pt.vz * dt;
      pt.m.rotation.x += dt * 8; pt.m.rotation.y += dt * 6;
      if (pt.life <= 0) { scene.remove(pt.m); parts.splice(pi, 1); }
    }

    // —— 得分 & HUD ——
    score += advance * 1.1;
    uiScore.textContent = Math.floor(score);
    uiDist.textContent = Math.floor(dist);
    uiSpeed.textContent = Math.floor(speed);
    Audio.engineSpeed(ratio / CFG.BOOST_K + 0.08);

    // —— 玩家车 ——
    playerGrp.position.x = px;
    playerGrp.rotation.z = carTilt * 0.92;
    var frontSteer = steerVis * 0.32;
    frontWheelGrps.forEach(function (wg3) { wg3.rotation.y = frontSteer; });
    if (inv > 0 && Math.floor(time * 14) % 2 === 0) playerGrp.visible = false;
    else playerGrp.visible = true;

    updateCamera(dt);
    flushPopups();
  }

  function onHit(a, cdx) {
    lives -= 1;
    inv = CFG.INVINCIBLE;
    shake = 9; flash = 0.42;
    Audio.crash();
    vib(70);
    speed *= CFG.HIT_DROP;
    var dir = cdx >= 0 ? -1 : 1;
    pvx = dir * 7;
    px = clampX(px + dir * 1.6);
    comboN = 0; comboT = 0;
    burst(a.mesh.position.x, 0.7, a.mesh.position.z, 12);
    if (lives <= 0) gameOver();
  }

  function gameOver() {
    state = 'over';
    overT = 0;
    Audio.stopEngine();
    Audio.crash();
    vib(90);
    if (playerGrp) playerGrp.visible = true;
    uiFinalS.textContent = Math.floor(score);
    uiFinalD.textContent = Math.floor(dist);
    uiFinalG.textContent = gems;
    setViewVisible(false);
    over.classList.remove('hidden');
  }

  /* ============ 渲染循环 ============ */
  function frame(ts) {
    requestAnimationFrame(frame);
    var dt = Math.min((ts - lastTm) / 1000 || 0.016, 0.05);
    lastTm = ts;

    if (state === 'menu' || state === 'over') {
      // 车展环视
      var idleA = time * 0.4;
      var target = { x: state === 'over' ? px : 0, y: 0.7, z: -2 };
      if (playerGrp) {
        playerGrp.position.set(target.x, 0, target.z);
        playerGrp.rotation.y = Math.sin(time * 0.35) * 0.5;
        playerGrp.rotation.z = 0;
      }
      if (state === 'over') { overT += dt; }
      else { uiCombo.style.opacity = '0'; }
      // 相机绕车
      var rad = state === 'over' ? 5.2 : 6.0;
      var cy = state === 'over' ? 1.8 : 2.2;
      var ca = state === 'over' ? -overT * 0.25 : idleA;
      var fwd = state === 'over' ? 0.6 : 0.9;
      camera.position.set(target.x + Math.sin(ca) * rad, cy + Math.sin(time * 0.6) * 0.4, target.z + Math.cos(ca) * rad + 0.6);
      camera.lookAt(target.x, fwd, target.z - 1.4);
      gemsArr.forEach(function (g) { g.rotation.y += dt * 2.2; });
    } else {
      update(dt);
      renderer.render(scene, camera);
    }
  }

  /* ============ UI ============ */
  function updateLives() {
    uiLives.innerHTML = '';
    for (var i = 0; i < 3; i++) {
      var h = document.createElement('div');
      h.className = 'heart' + (i < lives ? '' : ' off');
      uiLives.appendChild(h);
    }
  }

  function startRun() {
    if (!SUPPORTED) return;
    Audio.ensure();
    menu.classList.add('hidden'); over.classList.add('hidden');
    resetRun();                                  // 每局全新世界与计分
    if (playerGrp) { playerGrp.visible = true; playerGrp.position.x = 0; }
    state = 'run';
    gemsArr.forEach(function (g) { g.visible = true; });
    setViewVisible(true);
    Audio.startEngine();
    vib(10);
  }

  function toggleMute() {
    var m = Audio.toggle();
    $('btnSound').textContent = m ? '\u266A' : '\u266B';
    $('btnSound').style.opacity = m ? 0.5 : 1;
  }

  /* ============ 初始化 ============ */
  function resize() {
    W = window.innerWidth; H = window.innerHeight; dpr = window.devicePixelRatio || 1;
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.setSize(W, H, false);
    if (camera) { camera.aspect = W / H; camera.updateProjectionMatrix(); }
  }

  function boot() {
    resize();
    if (!SUPPORTED) {
      var box = document.createElement('div');
      box.className = 'no-webgl';
      box.innerHTML = '当前环境不支持 WebGL，无法运行 3D 版。<br>请使用 Chrome / Edge / 现代 Android WebView 打开。';
      menu.appendChild(box);
      return;
    }
    buildScene();
    playerGrp = playerCar();
    scene.add(playerGrp);
    seatCam = new THREE.Object3D();
    seatCam.position.set(0.32, 0.72, 0.5);
    seatCam.rotation.x = -0.05;
    playerGrp.add(seatCam);
    wheelSpin.forEach(function (ws) { ws.ang = 0; });
    resetRun();
    state = 'menu';
    setViewVisible(false);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', function () { if (document.hidden) Audio.stopEngine(); });
    $('btnSound').addEventListener('click', toggleMute);
    $('btnStart').addEventListener('click', function () { Audio.ensure(); startRun(); });
    $('btnAgain').addEventListener('click', function () { Audio.ensure(); startRun(); });
    btnView.addEventListener('click', cycleView);
    // URL 参数（CI/截图自检）：?autostart=1[&view=cockpit]
    var q = /[?&]view=(\w+)/.exec(location.search);
    if (q && q[1] === 'cockpit') { viewMode = COCKPIT; setViewUI(); }
    if (/[?&]autostart=1\b/.test(location.search)) {
      setTimeout(function () { Audio.ensure(); startRun(); }, 60);
    }
    lastTm = performance.now();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
