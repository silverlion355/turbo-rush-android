/* ============================================================
 * 极速狂飙 3D · Turbo Rush 3D v4.0 — 弯道 / 陀螺仪 / 加速控制
 *  - 样条赛道（CatmullRom 闭合环路，含 S 弯/发夹/缓直道）
 *  - 玩家沿中心线推进，方向盘转向控制车道偏移
 *  - 触屏：手指上滑/下滑模拟油门与刹车（连续比例），左右拖动转向
 *  - 设备姿态（陀螺仪）控制视角偏航/俯仰，可一键开关
 *  - 写实环境：天空 / 远山 / 城市天际线 / 大海 / 沥青 / 草地 纹理
 *  - 保留：法拉利超跑/AI 变道/宝石连击/触感振动/极速 FOV/碰撞震屏
 * ============================================================ */
(function () {
  'use strict';

  /* ⚠️ 最先检测 THREE：若 three.min.js 未加载成功，本文件后续每一行都会抛错，
     必须在第一行就把原因暴露到屏幕诊断条上（而不是静默黑屏）。 */
  if (typeof THREE === 'undefined') {
    if (window.__diagLog) window.__diagLog('中止：THREE 未定义（three.min.js 未加载成功）');
    return;
  }
  if (window.__diag) window.__diag.three = 'r' + THREE.REVISION;

  var SUPPORTED = (function () {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (window.__diag) window.__diag.webgl = gl ? 'OK' : '不支持';
      return !!(window.WebGLRenderingContext && gl);
    } catch (e) {
      if (window.__diag) window.__diag.webgl = '异常:' + e.message;
      return false;
    }
  })();

  /* ======== 配置 ======== */
  var CFG = {
    ROAD_W: 11, ROAD_HALF: 5.5,
    LANES: 4, LANE_W: 11 / 4,
    MAX_SPEED: 245, REVERSE_MAX: -50,
    ACCEL: 38, BRAKE_DECEL: 85, COAST_DECEL: 16, ROLL_DRAG: 0.12,
    STEER_KBD: 520, STEER_TOUCH: 5.4, STEER_MAX_OFFSET: 4.9, STEER_RECOVER: 4.5,
    FOV: 64, CAM_DIST: 8.0, CAM_H: 4.4, CAM_LOOK_Y: 1.0, CAM_LOOK_AHEAD: 22,
    COCKPIT_OFFSET: new THREE.Vector3(0.34, 0.74, 0.52),
    INVINCIBLE: 1.8, HIT_DROP: 0.55,
    GEM_SCORE: 60, GEM_COMBO_WIN: 1.8,
    TRACK_N: 600, LOOP_KM_H: 200,
    FOG_NEAR: 90, FOG_FAR: 460, FOG_COLOR: 0xcfe4f0,
    AI_SPEED_MIN: 0.42, AI_SPEED_MAX: 0.72,
    GYRO_YAW_RANGE: 0.55, GYRO_PITCH_RANGE: 0.30,
    SKY_R: 800, GROUND_R: 900, BACKDROP_R: 760, BACKDROP_H: 320
  };

  function $(id) { return document.getElementById(id); }

  /* ======== 真机错误可视化：统一写入屏幕底部诊断条 ======== */
  function showFatal(err) {
    var msg = (err && (err.message || err.reason || err)) + '';
    if (!msg || msg === 'undefined') msg = 'unknown error';
    if (window.__diagLog) window.__diagLog('[FATAL] ' + msg);
  }
  window.addEventListener('error', function (e) { if (e && e.message) showFatal(e.message); });
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(t) { return t * t * (3 - 2 * t); }
  function vib(ms) { try { if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === 'function') window.AndroidBridge.vibrate(ms); } catch (e) { } }

  /* ======== 音频 ======== */
  var Audio = {
    ctx: null, master: null, muted: false, engine: null,
    ensure: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
      try {
        var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
        this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination); return true;
      } catch (e) { return false; }
    },
    toggle: function () { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.5; return this.muted; },
    tone: function (f0, f1, dur, type, vol) {
      if (!this.ensure() || this.muted) return;
      var t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.014); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    },
    gem: function (step) { if (this.muted) return; var f = 760 * Math.pow(2, Math.min(step, 12) / 12); this.tone(f, f * 1.02, 0.12, 'sine', 0.15); this.tone(f * 1.5, f * 1.52, 0.14, 'sine', 0.11); },
    crash: function () {
      if (!this.ensure() || this.muted) return;
      var t = this.ctx.currentTime, len = 0.4, buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
      var d = buf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      var s = this.ctx.createBufferSource(); s.buffer = buf;
      var f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 850;
      var g = this.ctx.createGain(); g.gain.value = 0.5; s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
    },
    startEngine: function () {
      if (!this.ensure() || this.muted || this.engine) return;
      var t = this.ctx.currentTime, o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; g.gain.value = 0.032; o1.frequency.value = 55; o2.frequency.value = 27.5;
      o1.connect(g); o2.connect(g); g.connect(this.master); o1.start(t); o2.start(t);
      this.engine = { o1: o1, o2: o2 };
    },
    engineSpeed: function (ratio) {
      if (!this.engine) return; var f = 55 + ratio * 130; this.engine.o1.frequency.value = f; this.engine.o2.frequency.value = f / 2;
    },
    stopEngine: function () { if (!this.engine) return; try { this.engine.o1.stop(); this.engine.o2.stop(); } catch (e) { } this.engine = null; }
  };

  /* ======== DOM / 状态 ======== */
  var canvas = $('game'), renderer, scene, camera;
  var uiScore = $('score'), uiDist = $('distVal'), uiSpeed = $('speedVal'), uiLives = $('lives'),
      uiView = $('viewBadge'), btnView = $('btnView'), btnGyro = $('btnGyro'), menu = $('menu'), over = $('over'),
      uiFinalS = $('finalScore'), uiFinalD = $('finalDist'), uiFinalG = $('finalGems'),
      uiCombo = $('combo'), uiComboTxt = $('comboTxt'), uiComboBar = $('comboBar'), elFlash = $('flash');
  var W = 0, H = 0, dpr = 1;
  var state = 'menu';
  var time = 0, runT = 0, dist = 0, score = 0, gems = 0, lives = 3;
  var speed = 0, throttle = 0, lateral = 0, lateralVel = 0, carTilt = 0, steerVis = 0;
  var inv = 0, shake = 0, flash = 0, overT = 0;
  var aiCars = [], gemsArr = [], trees = [], parts = [], dashInst = null, dashData = [], cityBlocks = [];
  var playerGrp = null, seatCam = null, wheelParts = [], frontWheelGrps = [], wheelSpin = [];
  var comboN = 0, comboT = 0, pendingPop = [];
  var lastTm = 0, camFov = CFG.FOV, camLookYaw = 0, camLookPitch = 0;
  var CHASE = 0, COCKPIT = 1, viewMode = CHASE, viewBlend = 1;
  var gyroOn = false, gyroAvail = false, gyroTilt = new THREE.Vector2(0, 0);
  var trackSamples = [], totalLen = 0, trackCurve = null;
  var curSeg = { pos: new THREE.Vector3(), yaw: 0, right: new THREE.Vector3(1, 0, 0) };

  /* ======== 输入 ======== */
  var input = { kLeft: 0, kRight: 0, kUp: 0, kDown: 0, drag: null, baseY: 0 };

  function setThrottle(t) { throttle = clamp(t, -1, 1); }
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var t = e.touches[0];
    input.drag = { sx: t.clientX, sy: t.clientY, px: t.clientX, py: t.clientY, lx: 0 };
    input.baseY = t.clientY;
    setThrottle(0);
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (!input.drag || !e.touches.length) return;
    var t = e.touches[0];
    var dx = t.clientX - input.drag.px;
    var dy = t.clientY - input.drag.py;
    input.drag.px = t.clientX; input.drag.py = t.clientY;
    input.drag.lx += dx;
    // 油门：向上滑动（dy 负）为正油门，向下为刹车
    var dyFromBase = (t.clientY - input.baseY);
    setThrottle(-dyFromBase / 130);
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) { e.preventDefault(); input.drag = null; setThrottle(0); }, { passive: false });
  canvas.addEventListener('touchcancel', function (e) { e.preventDefault(); input.drag = null; setThrottle(0); }, { passive: false });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.kLeft = 1;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.kRight = 1;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') input.kUp = 1;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') input.kDown = 1;
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyC' || e.code === 'KeyV') { if (state === 'run') cycleView(); }
    if (e.code === 'KeyG') toggleGyro();
  });
  window.addEventListener('keyup', function (e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.kLeft = 0;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.kRight = 0;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') input.kUp = 0;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') input.kDown = 0;
  });

  /* ======== 陀螺仪 ======== */
  function setupGyro() {
    gyroAvail = ('DeviceOrientationEvent' in window);
    if (!gyroAvail) { btnGyro && (btnGyro.style.display = 'none'); return; }
    btnGyro && btnGyro.addEventListener('click', function () {
      // iOS 需要请求权限；Android Chrome 通常不需要
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(function (s) {
          if (s === 'granted') enableGyro(true); else toggleGyro();
        }).catch(function () { toggleGyro(); });
      } else {
        enableGyro(!gyroOn);
      }
    });
  }
  function enableGyro(on) {
    gyroOn = !!on;
    if (gyroOn) {
      window.addEventListener('deviceorientation', gyroHandler);
      btnGyro && (btnGyro.textContent = '陀螺仪·开');
    } else {
      window.removeEventListener('deviceorientation', gyroHandler);
      btnGyro && (btnGyro.textContent = '陀螺仪·关');
      gyroTilt.set(0, 0);
    }
  }
  function toggleGyro() { enableGyro(!gyroOn); }
  function gyroHandler(e) {
    // gamma: 左右倾 (-90..90), beta: 前后倾 (-180..180)
    var g = (e.gamma || 0); var b = (e.beta || 0);
    // 基准归零（首次调用记录）
    if (!gyroHandler._b) { gyroHandler._b = b; gyroHandler._g = g; }
    var dg = (g - gyroHandler._g);
    var db = (b - gyroHandler._b);
    // 平滑
    gyroTilt.x = lerp(gyroTilt.x, clamp(dg / 30, -1, 1), 0.18);
    gyroTilt.y = lerp(gyroTilt.y, clamp((db) / 30, -1, 1), 0.18);
  }

  /* ======== 视角 ======== */
  function cycleView() { viewMode = 1 - viewMode; setViewUI(); }
  function setViewUI() {
    uiView.textContent = viewMode === COCKPIT ? '驾驶舱视角' : '追尾视角';
    btnView.textContent = viewMode === COCKPIT ? '车后视角' : '车内视角';
  }
  function setViewVisible(on) {
    btnView.classList.toggle('hidden', !on);
    uiView.style.display = on ? '' : 'none';
    if (on) setViewUI();
  }

  /* ======== 赛车材质工厂 ======== */
  var M_DARK, M_GLASS, M_TIRE, M_RIM, M_CARBON;
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
  function B(w, h, d, x, y, z, mat) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
  function paintMat(hex) { return makeMaterial(hex, { clearcoat: true, metal: 0.62, rough: 0.3 }); }
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
      for (var i = 0; i < 5; i++) {
        var sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.17, 0.035), spokeMat);
        sp.rotation.x = (i / 5) * Math.PI * 2; g.add(sp);
      }
      var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.27, 12), M_RIM);
      cap.rotation.z = Math.PI / 2; g.add(cap);
      var cal = B(0.09, 0.05, 0.05, 0, 0.055, 0.11, makeMaterial(0xffcf3f, { rough: 0.4, metal: 0.2 }));
      g.add(cal); cal = cal.clone(); cal.position.z = -0.11; g.add(cal);
    }
    return g;
  }
  function makeSupercar(opts) {
    opts = opts || {};
    var hi = opts.lod !== 'lo';
    var pal = opts.pal || {};
    var body = pal.body != null ? pal.body : 0xd40000;
    var bodyDark = pal.bodyDark != null ? pal.bodyDark : 0x9c0d0d;
    var accent = pal.accent != null ? pal.accent : 0xffd23f;
    var mBody = paintMat(body), mBodyD = paintMat(bodyDark);
    var mBlack = makeMaterial(0x17181d, { rough: 0.42, metal: 0.15 });
    var mSilver = makeMaterial(0xc9cdd4, { metal: 0.9, rough: 0.25 });
    var mLight = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
    var mTailL = new THREE.MeshBasicMaterial({ color: 0xff2233 });
    var g = new THREE.Group();

    var floor = B(1.7, 0.16, 4.45, 0, 0.13, 0, M_DARK); g.add(floor);
    [-1, 1].forEach(function (s) {
      var pod = B(0.5, 0.4, 1.62, s * 0.72, 0.52, -1.44, mBody); pod.rotation.y = s * 0.05; g.add(pod);
      var arch = B(0.06, 0.05, 0.9, s * 0.985, 0.62, -1.5, M_DARK); g.add(arch);
    });
    var hood = B(0.84, 0.2, 1.06, 0, 0.48, -1.5, mBody); g.add(hood);
    var hoodVent = B(0.44, 0.012, 0.5, 0, 0.585, -1.98, mBlack); g.add(hoodVent);
    var nose = B(1.94, 0.26, 0.34, 0, 0.3, -2.24, mBlack); g.add(nose);
    var noseLip = B(1.98, 0.06, 0.42, 0, 0.14, -2.36, mBlack); g.add(noseLip);
    var bumper = B(1.9, 0.24, 0.5, 0, 0.58, -2.08, mBody); bumper.rotation.x = -0.14; g.add(bumper);
    var mouth = B(1.24, 0.16, 0.08, 0, 0.48, -2.3, mBlack); g.add(mouth);
    [-1, 1].forEach(function (s) {
      var hl = B(0.34, 0.05, 0.16, s * 0.58, 0.68, -2.26, mLight); hl.rotation.z = s * 0.12; hl.rotation.y = s * 0.1; g.add(hl);
      g.add(B(0.52, 0.07, 0.14, s * 0.6, 0.64, -2.23, mBlack));
    });
    var cowl = B(1.5, 0.16, 0.2, 0, 0.55, -0.92, mBody); g.add(cowl);
    [-1, 1].forEach(function (s) {
      g.add(B(0.42, 0.42, 2.5, s * 0.68, 0.52, 0.8, mBody));
      g.add(B(0.36, 0.2, 2.2, s * 0.62, 0.22, 0.3, M_DARK));
      g.add(B(0.01, 0.03, 1.1, s * 0.9, 0.62, 0.2, mBlack));
    });
    [-1, 1].forEach(function (s) {
      var intake = B(0.1, 0.2, 0.72, s * 0.9, 0.56, 0.78, mBlack); intake.rotation.z = s * 0.1; g.add(intake);
    });
    var winFront = B(0.72, 0.03, 1.0, 0, 0.8, -0.62, M_GLASS); winFront.rotation.x = -0.86; g.add(winFront);
    var winRoof = B(0.66, 0.025, 0.55, 0, 1.02, -0.02, M_GLASS); winRoof.rotation.x = 0.34; g.add(winRoof);
    var winRear = B(0.7, 0.03, 0.92, 0, 0.86, 0.66, M_GLASS); winRear.rotation.x = -0.42; g.add(winRear);
    [-1, 1].forEach(function (s) { g.add(B(0.03, 0.3, 1.15, s * 0.48, 0.86, 0.02, M_GLASS)); });
    var dash = B(0.66, 0.1, 0.24, 0, 0.62, -0.84, mBlack); g.add(dash);
    g.add(B(0.22, 0.04, 0.02, 0.13, 0.655, -0.945, makeMaterial(0x12263a, { metal: 0, rough: 0.3, emissive: 0x1a4f78, ei: 1.2 })));
    var wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 10, 24), mBlack);
    wheelRing.position.set(0.3, 0.58, -0.88); wheelRing.rotation.x = -0.45; g.add(wheelRing);
    g.add(B(0.08, 0.1, 0.06, 0.3, 0.58, -0.82, mSilver));
    var seatMat = makeMaterial(0x1c1f26, { rough: 0.85, metal: 0.05 });
    [-0.34, 0.34].forEach(function (sx) {
      var seat = B(0.5, 0.34, 0.5, sx, 0.3, 0.62, seatMat); seat.rotation.y = sx > 0 ? 0.06 : -0.06; g.add(seat);
      g.add(B(0.44, 0.24, 0.14, sx, 0.68, 0.82, seatMat));
    });
    var deckG = B(0.8, 0.05, 0.42, 0, 0.78, 1.66, M_GLASS); g.add(deckG);
    [-1, 1].forEach(function (s) { g.add(B(0.42, 0.34, 0.8, s * 0.68, 0.66, 1.85, mBodyD)); });
    var tailF = B(1.86, 0.52, 0.2, 0, 0.56, 2.14, mBlack); g.add(tailF);
    var tailTop = B(1.62, 0.16, 0.5, 0, 0.82, 1.98, mBodyD); g.add(tailTop);
    var diff = B(1.5, 0.22, 0.34, 0, 0.22, 2.18, M_CARBON); g.add(diff);
    [-1, 1].forEach(function (s) { g.add(B(0.06, 0.18, 0.1, s * 0.5, 0.1, 2.2, M_CARBON)); });
    [-0.24, 0.24].forEach(function (sx) {
      var ex = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 12), mSilver); ex.rotation.x = Math.PI / 2; ex.position.set(sx, 0.42, 2.22); g.add(ex);
      var exIn = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.17, 10), mBlack); exIn.rotation.x = Math.PI / 2; exIn.position.set(sx, 0.42, 2.24); g.add(exIn);
    });
    [-1, 1].forEach(function (s) {
      for (var k = 0; k < 2; k++) {
        var lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 14), mTailL); lamp.rotation.x = Math.PI / 2; lamp.position.set(s * (0.42 + k * 0.2), 0.62, 2.24); g.add(lamp);
      }
    });
    var lip = B(1.6, 0.045, 0.3, 0, 0.9, 2.06, mBodyD); lip.rotation.x = -0.1; g.add(lip);
    [-1, 1].forEach(function (s) {
      g.add(B(0.02, 0.03, 0.12, s * 0.98, 0.82, -0.95, M_DARK));
      g.add(B(0.2, 0.09, 0.1, s * 1.06, 0.86, -0.98, mBody));
    });
    var axles = [[-0.9, -1.56], [0.9, -1.56], [-0.9, 1.48], [0.9, 1.48]];
    for (var i = 0; i < 4; i++) {
      var wg2 = makeWheel(hi); wg2.position.set(axles[i][0], 0.33, axles[i][1]);
      var arcGeo = new THREE.TorusGeometry(0.4, 0.045, 8, 16, Math.PI);
      var fender = new THREE.Mesh(arcGeo, M_DARK); fender.rotation.y = Math.PI / 2; fender.position.set(axles[i][0], 0.45, axles[i][1]); g.add(fender);
      g.add(wg2);
      if (i < 2) frontWheelGrps.push(wg2);
      wheelSpin.push({ grp: wg2, r: 0.33, child: wg2.children[0] });
    }
    g.userData.opts = opts;
    return g;
  }
  function playerCar() { return makeSupercar({ lod: 'hi', pal: { body: 0xd40000, bodyDark: 0x9c0d0d, accent: 0xffd23f } }); }
  var AI_PALS = [
    { body: 0x1f5fdb, bodyDark: 0x17409c }, { body: 0x2ba84a, bodyDark: 0x1d7a33 },
    { body: 0xf0b429, bodyDark: 0xb9861c }, { body: 0x8a4fff, bodyDark: 0x6433c9 },
    { body: 0xc9cdd4, bodyDark: 0x969ba3 }, { body: 0xff6b1a, bodyDark: 0xcc4c0a }
  ];

  /* ======== 粒子 ======== */
  function burst(x, y, z, n) {
    for (var i = 0; i < n; i++) {
      var m = new THREE.Mesh(new THREE.OctahedronGeometry(0.1 + Math.random() * 0.14, 0),
        new THREE.MeshBasicMaterial({ color: [0xffd23f, 0xff7a2e, 0xfff6d8, 0xff3b30][i % 4] }));
      m.position.set(x, y + 0.3, z); scene.add(m);
      parts.push({
        m: m,
        vx: (Math.random() - 0.5) * 7, vy: 2.5 + Math.random() * 4, vz: (Math.random() - 0.5) * 7,
        life: 0.55 + Math.random() * 0.3
      });
    }
  }

  function flushPopups() {
    if (!pendingPop.length) return;
    var hudEl = $('hud');
    pendingPop.forEach(function (p) {
      var v = p.pos.clone().project(camera);
      if (v.z > 1) return;
      var x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      var el = document.createElement('div');
      el.className = 'pop' + (p.cls || '');
      el.textContent = p.txt; el.style.left = x + 'px'; el.style.top = y + 'px';
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

  /* ======== 赛道：控制点与中心线采样 ======== */
  // 围绕原点设计一个蜿蜒的闭合环路（X,Z 平面）：直道 + S 弯 + 缓弯 + 急弯
  var TRACK_CTRL = [
    [0,    -260],
    [180,  -210],
    [240,    60],
    [ 90,   260],
    [-130,  220],
    [-280,   60],
    [-220, -150],
    [-100, -290],
    [  0,  -260]  // 闭合
  ];

  function buildTrack() {
    var pts = TRACK_CTRL.map(function (c) { return new THREE.Vector3(c[0], 0, c[1]); });
    var curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    trackCurve = curve;
    var N = CFG.TRACK_N;
    trackSamples = [];
    for (var i = 0; i < N; i++) {
      var t = i / N;
      var p = curve.getPoint(t);
      var tn = curve.getPoint((i + 1) / N);
      var dx = tn.x - p.x, dz = tn.z - p.z;
      var yaw = Math.atan2(-dx, -dz); // 让本地 -z 对齐到 (dx, dz)
      // world right = R_y(yaw)*(1,0,0) = (cos yaw, 0, -sin yaw)
      var right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      trackSamples.push({ p: p, yaw: yaw, right: right, tan: new THREE.Vector3(dx, 0, dz).normalize(), t: t });
    }
    // 累计弧长
    totalLen = 0;
    for (var k = 0; k < N; k++) {
      var a = trackSamples[k].p, b = trackSamples[(k + 1) % N].p;
      totalLen += a.distanceTo(b);
    }
    // 诊断：赛道关键数据（真机排查"看不到路"的核心依据）
    if (window.__diagLog) {
      var xs = [], zs = [];
      for (var q = 0; q < TRACK_CTRL.length; q++) { xs.push(TRACK_CTRL[q][0]); zs.push(TRACK_CTRL[q][1]); }
      var mn = function (arr) { return Math.min.apply(null, arr); };
      var mx = function (arr) { return Math.max.apply(null, arr); };
      var p0 = trackSamples[0].p;
      window.__diagLog('赛道: 控制点' + TRACK_CTRL.length +
        ' x[' + mn(xs) + ',' + mx(xs) + '] z[' + mn(zs) + ',' + mx(zs) + ']' +
        ' 周长' + totalLen.toFixed(0) + 'm' +
        ' 起点(' + p0.x.toFixed(0) + ',' + p0.z.toFixed(0) + ')');
    }
  }

  function sampleAtS(s) {
    var smod = ((s % totalLen) + totalLen) % totalLen;
    var N = trackSamples.length;
    var frac = smod / totalLen;
    var idx = Math.floor(frac * N) % N;
    var f = frac * N - idx;
    var a = trackSamples[idx], b = trackSamples[(idx + 1) % N];
    var pos = a.p.clone().lerp(b.p, f);
    var yaw = lerp(a.yaw, b.yaw, f);
    var right = a.right.clone().lerp(b.right, f).normalize();
    return { pos: pos, yaw: yaw, right: right, tan: b.tan.clone() };
  }

  /* ======== WebGL 渲染器：多级降级创建 ========
     部分 Android WebView / 老 GPU 对 powerPreference:'high-performance'、
     antialias 支持不佳，会直接创建失败 → 表现为整屏黑。逐级退回最保守配置。 */
  function createRenderer() {
    var opts = [
      { canvas: canvas, antialias: true, powerPreference: 'high-performance' },
      { canvas: canvas, antialias: true },
      { canvas: canvas, antialias: false },
      { canvas: canvas, antialias: false, precision: 'mediump' }
    ];
    for (var i = 0; i < opts.length; i++) {
      try {
        var r = new THREE.WebGLRenderer(opts[i]);
        if (window.__diagLog && i > 0) window.__diagLog('渲染器已降级至配置 #' + i);
        return r;
      } catch (e) {
        if (window.__diagLog) window.__diagLog('渲染器配置 #' + i + ' 失败：' + (e && e.message));
      }
    }
    return null;
  }

  /* ======== 环境构建（纯程序化：几何 + 纯色，不依赖任何贴图） ======== */
  function buildScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfe0ff);
    scene.fog = new THREE.Fog(CFG.FOG_COLOR, CFG.FOG_NEAR, CFG.FOG_FAR);

    camera = new THREE.PerspectiveCamera(CFG.FOV, W / H, 0.1, 2400);
    camFov = CFG.FOV;
    renderer = createRenderer();
    if (!renderer) throw new Error('WebGLRenderer 创建失败（WebGL 上下文不可用）');
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.setSize(W, H);
    initCarMats();

    // 程序化环境反射（canvas 渐变，无外部图片；让车漆有光泽）
    try {
      var cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
      var cx = cv.getContext('2d');
      var gr = cx.createLinearGradient(0, 0, 0, 32);
      gr.addColorStop(0, '#b9d6ff'); gr.addColorStop(0.42, '#dcedff'); gr.addColorStop(0.5, '#f6f9fd');
      gr.addColorStop(0.54, '#c8d9b2'); gr.addColorStop(0.75, '#57794b'); gr.addColorStop(1, '#33503a');
      cx.fillStyle = gr; cx.fillRect(0, 0, 64, 32);
      var envTex = new THREE.CanvasTexture(cv); envTex.mapping = THREE.EquirectangularReflectionMapping;
      var pmrem = new THREE.PMREMGenerator(renderer);
      var rt = pmrem.fromEquirectangular(envTex); scene.environment = rt.texture;
      envTex.dispose(); pmrem.dispose();
    } catch (e) {
      scene.environment = null;   // 低端机忽略环境反射
      if (window.__diagLog) window.__diagLog('环境反射不可用（已跳过）');
    }
    // PMREM 会切换 renderTarget，显式复位，避免个别驱动后续渲染到离屏缓冲 → 黑屏
    try { renderer.setRenderTarget(null); } catch (e2) {}

    // 灯光
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    var sun = new THREE.DirectionalLight(0xfff2d8, 1.15); sun.position.set(80, 120, 40); scene.add(sun);
    var fill = new THREE.DirectionalLight(0x9fc8ff, 0.35); fill.position.set(-60, 30, -50); scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a4a33, 0.55));

    // 天空球（纯色 BackSide，最先绘制、不写/不测深度）
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(CFG.SKY_R, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xbfe0ff, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false })
    );
    sky.position.y = -30;
    sky.renderOrder = -1000;
    scene.add(sky);

    // 草地（纯色大平面）
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.GROUND_R * 2, CFG.GROUND_R * 2),
      new THREE.MeshLambertMaterial({ color: 0x6aa84f })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);

    // 远山：沿赛道外围环形分布的圆锥体（纯几何 + 纯色，无贴图）
    var hideMtn = /[?&]hide=mtn\b/.test(location.search);   // 调试：排除远山
    var mtnA = new THREE.MeshLambertMaterial({ color: 0x8fb2cc, flatShading: true, fog: false });
    var mtnB = new THREE.MeshLambertMaterial({ color: 0xa9c5da, flatShading: true, fog: false });
    for (var mi = 0; !hideMtn && mi < 32; mi++) {
      var ang = (mi / 32) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
      var rad = 430 + Math.random() * 150;
      var hgt = 70 + Math.random() * 150;
      var crad = 58 + Math.random() * 95;
      var mtn = new THREE.Mesh(new THREE.ConeGeometry(crad, hgt, 5), (mi % 3 === 0) ? mtnB : mtnA);
      mtn.position.set(Math.cos(ang) * rad, hgt * 0.5 - 8, Math.sin(ang) * rad);
      mtn.rotation.y = Math.random() * 3;
      scene.add(mtn);
    }

    buildRoad();
  }

  /* ======== 道路路面 / 路缘 / 虚线 ======== */
  function buildRoad() {
    var N = trackSamples.length;
    var posArr = [], uvArr = [], normArr = [], idxArr = [];
    var half = CFG.ROAD_HALF;
    for (var i = 0; i <= N; i++) { // 接缝处重复 N+1
      var a = trackSamples[i % N];
      var l = a.p.clone().add(a.right.clone().multiplyScalar(-half));
      var r = a.p.clone().add(a.right.clone().multiplyScalar(half));
      var sLen = (i / N) * totalLen;
      posArr.push(l.x, l.y, l.z); posArr.push(r.x, r.y, r.z);
      uvArr.push(0, sLen / 8); uvArr.push(1, sLen / 8);
      normArr.push(0, 1, 0, 0, 1, 0);
    }
    for (var k = 0; k < N; k++) {
      var i0 = k * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i0 + 3;
      idxArr.push(i0, i2, i1); idxArr.push(i1, i2, i3);
    }
    var roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
    roadGeo.setIndex(idxArr);
    var roadMat = new THREE.MeshLambertMaterial({ color: 0x4a4e57 });
    var road = new THREE.Mesh(roadGeo, roadMat);
    road.frustumCulled = false;
    scene.add(road);

    // 路缘（左右各一条，红白相间色块）
    [-1, 1].forEach(function (side) {
      var curbGeo = new THREE.BufferGeometry();
      var cPos = [], cCol = [], cIdx = [];
      var curbH = 0.18, curbT = 0.4;
      for (var i = 0; i <= N; i++) {
        var a = trackSamples[i % N];
        var offIn = a.right.clone().multiplyScalar(side * half);
        var offOut = a.right.clone().multiplyScalar(side * (half + curbT));
        var base = a.p.clone().add(offIn); base.y = 0;
        var top = a.p.clone().add(offIn); top.y = curbH;
        var base2 = a.p.clone().add(offOut); base2.y = 0;
        var top2 = a.p.clone().add(offOut); top2.y = curbH;
        var vi = i * 4;   // ⚠️ 修复：每采样点 4 顶点（旧代码 i*8 越界一倍，越界顶点退化为原点，
                          //     产生从赛道连向原点的巨型畸形三角形，run 态相机被整面遮死 → 全屏灰）
        cPos.push(base.x, base.y, base.z, top.x, top.y, top.z, top2.x, top2.y, top2.z, base2.x, base2.y, base2.z);
        // 顶点色：红白相间（必须 0~1 浮点分量；旧代码把 0xd44040 整数当 float 推送 → 颜色溢出）
        var isRed = (i % 4 < 2);
        var cr = isRed ? 0.83 : 0.92, cg = isRed ? 0.25 : 0.92, cb = isRed ? 0.25 : 0.92;
        cCol.push(cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb);
        cIdx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      }
      curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
      curbGeo.setAttribute('color', new THREE.Float32BufferAttribute(cCol, 3));
      curbGeo.setIndex(cIdx);
      curbGeo.computeVertexNormals();
      var curbMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      var curbMesh = new THREE.Mesh(curbGeo, curbMat);
      curbMesh.frustumCulled = false;
      scene.add(curbMesh);
    });

    // 车道虚线（InstancedMesh）：双黄线 + 两侧白线
    var rows = [
      { x: -0.13, c: 0xf5c542 }, { x: 0.13, c: 0xf5c542 },
      { x: -CFG.ROAD_HALF * 0.5, c: 0xe6ebef }, { x: CFG.ROAD_HALF * 0.5, c: 0xe6ebef }
    ];
    var perRow = 80, dashLen = 2.4, dashGap = 2.8;
    var dGeo = new THREE.BoxGeometry(0.14, 0.012, dashLen);
    var dMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    var total = rows.length * perRow;
    dashInst = new THREE.InstancedMesh(dGeo, dMat, total);
    dashInst.frustumCulled = false;
    var m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
    dashData = [];
    var col = new THREE.Color();
    var segLen = totalLen / perRow;
    for (var r = 0; r < rows.length; r++) {
      for (var k = 0; k < perRow; k++) {
        var idx = r * perRow + k;
        dashData.push({ x: rows[r].x, s: (k + 0.5) * segLen });
        col.setHex(rows[r].c);
        m4.compose(v3.set(rows[r].x, 0.025, 0), q0, s1);
        dashInst.setMatrixAt(idx, m4);
        dashInst.setColorAt(idx, col);
      }
    }
    scene.add(dashInst);
  }

  function updateDashes(playerS) {
    if (!dashInst) return;
    var m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
    var segLen = totalLen / (dashData.length / 4);
    for (var di = 0; di < dashData.length; di++) {
      var d = dashData[di];
      // s 跟随玩家（最近虚线往前推 ~120m）
      var localS = (d.s - playerS);
      // 取模
      localS = ((localS % totalLen) + totalLen) % totalLen;
      // 只渲染前方 [-20, 900] 区间
      if (localS < -20 || localS > 900) {
        // 隐藏：放到原点不可见
        m4.compose(v3.set(0, -1000, 0), q0, s1);
        dashInst.setMatrixAt(di, m4);
        continue;
      }
      var s = sampleAtS(playerS + localS);
      var px = s.pos.x + s.right.x * d.x;
      var pz = s.pos.z + s.right.z * d.x;
      // 朝向沿切线方向
      var yaw = Math.atan2(-s.tan.x, -s.tan.z);
      var e = new THREE.Euler(0, yaw, 0);
      var q = new THREE.Quaternion().setFromEuler(e);
      m4.compose(v3.set(px, 0.025, pz), q, s1);
      dashInst.setMatrixAt(di, m4);
    }
    dashInst.instanceMatrix.needsUpdate = true;
  }

  /* ======== 城市建筑群（沿路一侧） ======== */
  function buildCityBlocks() {
    if (/[?&]hide=city\b/.test(location.search)) return;   // 调试：排除城市建筑
    var bm = makeMaterial(0x5b6b7e, { metal: 0.2, rough: 0.8 });
    /* ⚠️ 修复：旧版楼群贴着赛道布置（侧向 -22~58m、高 14~52m、每 6 采样点一组），
       玩家在赛道上时视野被楼体完全填死（俯视验证：整屏灰蓝）。
       现在楼群退到赛道外 60~170m 作远景天际线，不侵入行车视野。 */
    for (var i = 0; i < trackSamples.length; i += 12) {
      var s = trackSamples[i];
      var cluster = new THREE.Group();
      var n = 2 + ((Math.random() * 3) | 0);
      for (var k = 0; k < n; k++) {
        var w = 8 + Math.random() * 16;
        var d = 8 + Math.random() * 16;
        var h = 10 + Math.random() * 30;
        var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bm);
        var side = (i % 24 === 0) ? 1 : -1;                 // 左右交替
        var ox = side * (60 + Math.random() * 110);         // 侧向 60~170m
        var oz = (Math.random() - 0.5) * 60;
        var pos = s.p.clone().add(s.right.clone().multiplyScalar(ox)).add(s.tan.clone().multiplyScalar(oz));
        pos.y = h / 2;
        m.position.copy(pos);
        m.rotation.y = Math.random() * Math.PI;
        cluster.add(m);
      }
      scene.add(cluster);
      cityBlocks.push(cluster);
    }
  }

  /* ======== 道具 ======== */
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
    return gem;
  }

  function makeTree() {
    var g = new THREE.Group();
    var s = 0.85 + Math.random() * 0.95;
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.32 * s, 2.3 * s, 6),
      new THREE.MeshLambertMaterial({ color: 0x7a5230 }));
    trunk.position.y = 1.15 * s; g.add(trunk);
    var leaf = new THREE.Mesh(new THREE.ConeGeometry(1.85 * s, 4.4 * s, 7),
      new THREE.MeshLambertMaterial({ color: Math.random() < 0.5 ? 0x3f9b43 : 0x4fae55, flatShading: true }));
    leaf.position.y = 3.6 * s; g.add(leaf);
    g.userData.s = s;
    return g;
  }

  function laneCx() {
    var arr = [];
    for (var i = 0; i < CFG.LANES; i++) arr.push(-CFG.ROAD_HALF + (CFG.ROAD_W / CFG.LANES) * (i + 0.5));
    return arr;
  }

  function spawnWorld() {
    var lanes = laneCx();
    // AI 车：s 分布
    for (var i = 0; i < 8; i++) {
      var pal = AI_PALS[(Math.random() * AI_PALS.length) | 0];
      var mesh = makeSupercar({ pal: pal, lod: 'lo' });
      var lane = (Math.random() * CFG.LANES) | 0;
      var s0 = 80 + i * 220 + Math.random() * 80;
      scene.add(mesh);
      aiCars.push({
        mesh: mesh, lane: lane, laneFrom: lane, laneP: 1, manT: Math.random() * 5,
        ratio: CFG.AI_SPEED_MIN + Math.random() * (CFG.AI_SPEED_MAX - CFG.AI_SPEED_MIN),
        s: s0, baseS: s0, pal: pal
      });
      // 占位位置（按 s 算）
      var samp = sampleAtS(s0);
      mesh.position.set(samp.pos.x + samp.right.x * lanes[lane], 0, samp.pos.z + samp.right.z * lanes[lane]);
      mesh.rotation.y = samp.yaw;
    }
    // 宝石（：串
    for (var r = 0; r < 24; r++) {
      var lane2 = (Math.random() * CFG.LANES) | 0;
      var s0 = 60 + r * 70 + Math.random() * 40;
      var n = 1 + ((Math.random() * 5) | 0);
      for (var gi = 0; gi < n; gi++) {
        var gem = makeGem();
        var samp = sampleAtS(s0 + gi * 8);
        gem.position.set(samp.pos.x + samp.right.x * (lanes[lane2] + (Math.random() - 0.5) * 1.0),
                         gem.userData.baseY, samp.pos.z + samp.right.z * (lanes[lane2] + (Math.random() - 0.5) * 1.0));
        gem.userData.sBase = s0 + gi * 8;
        gem.userData.lane = lane2;
        gem.userData.jx = (Math.random() - 0.5) * 1.0;
        scene.add(gem); gemsArr.push(gem);
      }
    }
    // 树：s-based
    for (var ti = 0; ti < 90; ti++) {
      var tr = makeTree();
      var sT = 40 + ti * 18 + Math.random() * 10;
      var side = (ti % 2) ? 1 : -1;
      var off = 7 + Math.random() * 28;
      var samp = sampleAtS(sT);
      var px = samp.pos.x + samp.right.x * side * (CFG.ROAD_HALF + off);
      var pz = samp.pos.z + samp.right.z * side * (CFG.ROAD_HALF + off);
      tr.position.set(px, 0, pz);
      tr.rotation.y = Math.random() * Math.PI;
      tr.userData.sBase = sT; tr.userData.side = side; tr.userData.off = off;
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
    speed = 0; throttle = 0; lateral = 0; lateralVel = 0; carTilt = 0; steerVis = 0;
    inv = 0; shake = 0; flash = 0; comboN = 0; comboT = 0;
    if (playerGrp) { playerGrp.visible = true; playerGrp.rotation.set(0, 0, 0); }
    clearWorld();
    spawnWorld();
    updateLives();
  }

  /* ======== 相机 ======== */
  function updateCamera(dt) {
    if (state !== 'run') return;
    var ratio = clamp(speed / CFG.MAX_SPEED, 0, 1.4);
    var samp = sampleAtS(playerS); // playerS global
    // 调试：?debugcam=top → 玩家上空 60m 俯视（排查起点周围几何）
    if (!debugCamTop) debugCamTop = /[?&]debugcam=top\b/.test(location.search);
    if (debugCamTop) {
      var pT = playerGrp.position;
      camera.position.set(pT.x + 0.01, 60, pT.z);
      camera.lookAt(pT.x, 0, pT.z);
      return;
    }
    if (viewMode === COCKPIT) {
      // 座舱：以车身局部坐标对齐
      playerGrp.updateMatrixWorld();
      var p = new THREE.Vector3(), q = new THREE.Quaternion();
      seatCam.getWorldPosition(p);
      seatCam.getWorldQuaternion(q);
      camera.position.copy(p);
      camera.quaternion.copy(q);
      // 陀螺仪视角偏移
      if (gyroOn) {
        camera.rotateY(gyroTilt.x * CFG.GYRO_YAW_RANGE);
        camera.rotateX(-gyroTilt.y * CFG.GYRO_PITCH_RANGE);
      }
      camera.position.y += Math.sin(time * 1.7) * 0.0015 * (0.4 + ratio);
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake * 0.012;
        camera.position.y += (Math.random() - 0.5) * shake * 0.012;
      }
      var tf = CFG.FOV - 6 + ratio * 18;
      if (Math.abs(tf - camFov) > 0.1) { camFov += (tf - camFov) * Math.min(1, dt * 5); camera.fov = camFov; camera.updateProjectionMatrix(); }
    } else {
      // 追尾相机：取玩家后方 camDist 的曲线点
      var camSamp = sampleAtS(playerS - CFG.CAM_DIST);
      var camX = camSamp.pos.x + camSamp.right.x * (lateral * 0.92);
      var camZ = camSamp.pos.z + camSamp.right.z * (lateral * 0.92);
      var ch = CFG.CAM_H + ratio * 0.6;
      camera.position.set(camX, ch, camZ);
      // 看向玩家前方 ~28m
      var look = sampleAtS(playerS + CFG.CAM_LOOK_AHEAD);
      var lx = look.pos.x + look.right.x * (lateral * 0.98);
      var lz = look.pos.z + look.right.z * (lateral * 0.98);
      camera.lookAt(lx, CFG.CAM_LOOK_Y + ratio * 0.4, lz);
      // 陀螺仪偏移
      if (gyroOn) {
        camera.rotateY(gyroTilt.x * CFG.GYRO_YAW_RANGE);
        camera.rotateX(-gyroTilt.y * CFG.GYRO_PITCH_RANGE);
      }
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake * 0.02;
        camera.position.y += (Math.random() - 0.5) * shake * 0.02;
      }
      var tf2 = CFG.FOV - 2 + ratio * 12;
      if (Math.abs(tf2 - camFov) > 0.1) { camFov += (tf2 - camFov) * Math.min(1, dt * 5); camera.fov = camFov; camera.updateProjectionMatrix(); }
    }
  }

  /* ======== 玩家状态 ======== */
  var playerS = 0; // 沿轨道的进度（米）
  var debugCamTop = false;
  function updatePlayer(dt) {
    // 油门
    if (input.kUp) setThrottle(Math.max(throttle, 1));
    if (input.kDown) setThrottle(Math.min(throttle, -1));
    // 速度积分
    var thr = throttle;
    var drag = speed * CFG.ROLL_DRAG;
    if (thr > 0) {
      speed += (CFG.ACCEL * thr - drag) * dt;
    } else if (thr < 0) {
      speed += (CFG.BRAKE_DECEL * thr - drag) * dt;
    } else {
      speed -= drag * dt;
    }
    if (speed > CFG.MAX_SPEED) speed = CFG.MAX_SPEED;
    if (speed < CFG.REVERSE_MAX) speed = CFG.REVERSE_MAX;
    // 推进 s
    var advance = speed / 3.6 * dt; // km/h -> m/s
    playerS += advance;
    dist += Math.max(advance, 0);
    // 转向输入
    var steerInput = 0;
    if (input.drag) steerInput = input.drag.lx * (CFG.STEER_TOUCH * 2 / Math.max(W, 360));
    var kb = 0;
    if (input.kLeft) kb -= 1;
    if (input.kRight) kb += 1;
    if (kb) steerInput += kb * CFG.STEER_KBD * dt * 0.01; // scale to soft
    // 限制横向加速度
    lateralVel += (steerInput - lateralVel * 0.0) * dt * 14;
    lateral += lateralVel * dt * 3.5;
    // 横向自动回正
    var restore = -lateral * 1.0 * dt;
    if (Math.abs(lateral) > 0 && Math.abs(throttle) < 0.05) lateral += restore * 0.4;
    if (lateral > CFG.STEER_MAX_OFFSET) { lateral = CFG.STEER_MAX_OFFSET; lateralVel = Math.min(lateralVel, 0); }
    if (lateral < -CFG.STEER_MAX_OFFSET) { lateral = -CFG.STEER_MAX_OFFSET; lateralVel = Math.max(lateralVel, 0); }
    // 转向可视化
    var steerSig = clamp(lateralVel * 2.4, -1, 1);
    steerVis += (steerSig - steerVis) * Math.min(1, dt * 6);
    carTilt += (steerSig * 0.16 - carTilt) * Math.min(1, dt * 8);
    // 应用位置
    var samp = sampleAtS(playerS);
    curSeg = samp;
    var px = samp.pos.x + samp.right.x * lateral;
    var pz = samp.pos.z + samp.right.z * lateral;
    playerGrp.position.set(px, 0, pz);
    playerGrp.rotation.y = samp.yaw;
    playerGrp.rotation.z = carTilt * 0.92;
    // 前轮转向
    var frontSteer = steerVis * 0.32;
    frontWheelGrps.forEach(function (wg3) { wg3.rotation.y = frontSteer; });
    // 轮子滚动（按速度推角速度）
    var angV = speed / 3.6 / 0.33; // rad/s
    wheelSpin.forEach(function (ws) { ws.ang = (ws.ang || 0) + angV * dt; ws.grp.children[0].rotation.x = ws.ang; });
    // 无敌闪烁
    if (inv > 0 && Math.floor(time * 14) % 2 === 0) playerGrp.visible = false;
    else playerGrp.visible = true;
  }

  function updateAI(dt, lanes) {
    var dS = speed / 3.6 * dt; // 玩家推进
    aiCars.forEach(function (a) {
      a.s += dS * (a.ratio - 1); // AI 相对玩家速率
      a.manT -= dt;
      if (a.manT <= 0) {
        a.manT = 3.5 + Math.random() * 6;
        if (Math.random() < 0.5) {
          var nl = clamp(a.lane + (Math.random() < 0.5 ? -1 : 1), 0, CFG.LANES - 1);
          if (nl !== a.lane) {
            var clear = true;
            for (var oi = 0; oi < aiCars.length; oi++) {
              var o = aiCars[oi];
              if (o !== a && o.lane === nl) {
                var ds = ((o.s - a.s + totalLen) % totalLen);
                if (ds < 30 || ds > totalLen - 30) { clear = false; break; }
              }
            }
            if (clear) { a.laneFrom = a.lane; a.lane = nl; a.laneP = 0; }
          }
        }
      }
      if (a.laneP < 1) {
        a.laneP = Math.min(1, a.laneP + dt * 0.9);
      }
      var laneX = lanes[a.lane];
      var laneFX = lanes[a.laneFrom];
      var lx = lerp(laneFX, laneX, sstep(a.laneP));
      var samp = sampleAtS(a.s);
      var px = samp.pos.x + samp.right.x * lx;
      var pz = samp.pos.z + samp.right.z * lx;
      a.mesh.position.set(px, 0, pz);
      a.mesh.rotation.y = samp.yaw + clamp((laneX - lx) * 0.06, -0.3, 0.3);
      // 轮子滚动
      a.mesh.children.forEach(function () {});
    });
  }

  function updateGems(dt) {
    var lanes = laneCx();
    var ds = speed / 3.6 * dt;
    gemsArr.forEach(function (g) {
      // 相对玩家的相对 s 不变；世界位置由 sBase 决定
      g.userData.spin += dt * 3.6;
      g.rotation.y = g.userData.spin;
      g.rotation.x = Math.sin(g.userData.spin * 0.7) * 0.3;
      var samp = sampleAtS(g.userData.sBase);
      var lx = lanes[g.userData.lane] + g.userData.jx;
      g.position.x = samp.pos.x + samp.right.x * lx;
      g.position.z = samp.pos.z + samp.right.z * lx;
      g.position.y = g.userData.baseY + Math.sin(time * 3 + g.userData.sBase * 0.1) * 0.12;
    });
  }

  function updateTrees(dt) {
    // 树 s-based（玩家经过就远推到另一端）
    trees.forEach(function (t) {
      var samp = sampleAtS(t.userData.sBase);
      var off = t.userData.off;
      var side = t.userData.side;
      var px = samp.pos.x + samp.right.x * side * (CFG.ROAD_HALF + off);
      var pz = samp.pos.z + samp.right.z * side * (CFG.ROAD_HALF + off);
      t.position.set(px, 0, pz);
      // 烟雾随速度感：微摆
      t.rotation.z = Math.sin(time * 1.6 + t.userData.sBase * 0.1) * 0.02;
    });
  }

  /* ======== 主循环 ======== */
  function update(dt) {
    time += dt;
    if (state !== 'run') return;
    runT += dt;
    var ratio = clamp(speed / CFG.MAX_SPEED, 0, 1.4);
    updatePlayer(dt);
    var lanes = laneCx();
    updateAI(dt, lanes);
    updateGems(dt);
    updateTrees(dt);
    updateDashes(playerS);

    // —— 连击 ——
    comboT -= dt;
    if (comboT <= 0) { comboN = 0; showCombo(); }
    else showCombo();

    // —— 宝石收集 ——
    for (var gi = gemsArr.length - 1; gi >= 0; gi--) {
      var g = gemsArr[gi];
      var dx = g.position.x - playerGrp.position.x, dz = g.position.z - playerGrp.position.z;
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
        // 新一颗放到玩家前方 ~200m
        var ng = makeGem();
        var ln2 = (Math.random() * CFG.LANES) | 0;
        ng.userData.sBase = playerS + 200 + Math.random() * 120;
        ng.userData.lane = ln2;
        ng.userData.jx = (Math.random() - 0.5) * 1.0;
        var ns = sampleAtS(ng.userData.sBase);
        ng.position.set(ns.pos.x + ns.right.x * (lanes[ln2] + ng.userData.jx), ng.userData.baseY,
                        ns.pos.z + ns.right.z * (lanes[ln2] + ng.userData.jx));
        scene.add(ng); gemsArr.push(ng);
      }
    }

    // —— 碰撞 ——
    if (inv <= 0) {
      for (var ci = 0; ci < aiCars.length; ci++) {
        var a = aiCars[ci];
        var cdx = a.mesh.position.x - playerGrp.position.x, cdz = a.mesh.position.z - playerGrp.position.z;
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

    // —— HUD ——
    score += Math.max(0, speed / 3.6 * dt) * 1.1;
    uiScore.textContent = Math.floor(score);
    uiDist.textContent = Math.floor(dist);
    uiSpeed.textContent = Math.floor(Math.abs(speed));
    Audio.engineSpeed(ratio / 1.42 + 0.08);

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
    lateral += dir * 1.6;
    if (lateral > CFG.STEER_MAX_OFFSET) lateral = CFG.STEER_MAX_OFFSET;
    if (lateral < -CFG.STEER_MAX_OFFSET) lateral = -CFG.STEER_MAX_OFFSET;
    comboN = 0; comboT = 0;
    burst(a.mesh.position.x, 0.7, a.mesh.position.z, 12);
    if (lives <= 0) gameOver();
  }

  function gameOver() {
    state = 'over'; overT = 0;
    Audio.stopEngine(); Audio.crash(); vib(90);
    if (playerGrp) playerGrp.visible = true;
    uiFinalS.textContent = Math.floor(score);
    uiFinalD.textContent = Math.floor(dist);
    uiFinalG.textContent = gems;
    setViewVisible(false);
    over.classList.remove('hidden');
  }

  /* ======== 渲染循环 ======== */
  var __fpsN = 0, __fpsT = 0, __rendered = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    var dt = Math.min((ts - lastTm) / 1000 || 0.016, 0.05);
    lastTm = ts;
    ensureSize();                 // 每帧核对画布尺寸（首帧视口为 0 / 旋转后失配）
    if (!scene) { return; }       // 场景还没建好
    // 诊断：帧率与渲染次数（每 1s 刷新一次 DOM）
    if (window.__diag) {
      __fpsN++;
      if (!__fpsT) __fpsT = ts;
      else if (ts - __fpsT >= 1000) {
        window.__diag.fps = Math.round(__fpsN * 1000 / (ts - __fpsT));
        window.__diag.objs = scene.children.length;
        try {
          var cp = camera.position, pp = playerGrp.position;
          var dir = camera.getWorldDirection(new THREE.Vector3());
          window.__diag.extra = 'cam(' + cp.x.toFixed(0) + ',' + cp.y.toFixed(1) + ',' + cp.z.toFixed(0) + ')' +
            ' P(' + pp.x.toFixed(0) + ',' + pp.z.toFixed(0) + ')' +
            ' dir(' + dir.x.toFixed(2) + ',' + dir.y.toFixed(2) + ',' + dir.z.toFixed(2) + ')' +
            ' S=' + playerS.toFixed(0) + ' v=' + speed.toFixed(0) + ' L=' + totalLen.toFixed(0) + ' ' + state;
        } catch (eD) {}
        __fpsN = 0; __fpsT = ts;
        if (window.__diagRefresh) window.__diagRefresh();
      }
    }
    if (state === 'menu' || state === 'over') {
      var idleA = time * 0.4;
      var target = { x: 0, y: 0.7, z: -2 };
      if (playerGrp) {
        playerGrp.position.set(target.x, 0, target.z);
        playerGrp.rotation.y = Math.sin(time * 0.35) * 0.6;
        playerGrp.rotation.z = 0;
      }
      if (state === 'over') { overT += dt; }
      else { uiCombo.style.opacity = '0'; }
      var rad = state === 'over' ? 5.2 : 6.2;
      var cy = state === 'over' ? 1.8 : 2.4;
      var ca = state === 'over' ? -overT * 0.25 : idleA;
      camera.position.set(Math.sin(ca) * rad, cy + Math.sin(time * 0.6) * 0.4, -2 + Math.cos(ca) * rad);
      camera.lookAt(0, 1, -3);
      gemsArr.forEach(function (g) { g.rotation.y += dt * 2.2; });
      render();
    } else {
      update(dt);
      render();
    }
  }

  /* 统一渲染出口：异常不吞掉，写到屏幕诊断条 */
  function render() {
    try {
      renderer.render(scene, camera);
      if (!__rendered) {
        __rendered = 1;
        if (window.__diagLog) window.__diagLog('首帧渲染成功');
      }
    } catch (e) { showFatal(e); }
  }

  /* ======== UI ======== */
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
    playerS = 0; // 每局从赛道起点开始
    resetRun();
    if (playerGrp) { playerGrp.visible = true; }
    state = 'run';
    setViewVisible(true);
    Audio.startEngine(); vib(10);
  }

  function toggleMute() {
    var m = Audio.toggle();
    $('btnSound').textContent = m ? '\u266A' : '\u266B';
    $('btnSound').style.opacity = m ? 0.5 : 1;
  }

  /* ======== 初始化 ======== */
  /* 测量视口：WebView 首帧时 innerWidth/innerHeight 可能为 0，逐级回退 */
  function measure() {
    var de = document.documentElement, bd = document.body;
    return {
      w: window.innerWidth || (de && de.clientWidth) || (bd && bd.clientWidth) || 0,
      h: window.innerHeight || (de && de.clientHeight) || (bd && bd.clientHeight) || 0
    };
  }

  function resize() {
    var m = measure();
    if (m.w > 0) W = m.w;
    if (m.h > 0) H = m.h;
    dpr = window.devicePixelRatio || 1;
    if (window.__diag) window.__diag.size = W + 'x' + H + '@' + dpr;
    if (!renderer || !W || !H) return;
    renderer.setPixelRatio(Math.min(dpr, 2));
    // 同步写 canvas 的 CSS 尺寸，并配合 CSS 100%，让画布严格等于视口
    // （旧代码 setSize(W,H,false) 不写样式，高 DPR 下 canvas 按物理像素撑开 → 只看到一角）
    renderer.setSize(W, H);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    if (camera) { camera.aspect = W / H; camera.updateProjectionMatrix(); }
  }

  /* 每帧自愈：WebView 首帧视口可能为 0、旋转后尺寸也可能失配，
     单靠 resize 事件不足以保证，故每帧核对一次（开销极低）。 */
  function ensureSize() {
    var m = measure();
    if (!m.w || !m.h) return;
    if (!W || !H || m.w !== W || m.h !== H || !renderer) resize();
  }

  function boot() {
    resize();
    if (!SUPPORTED) {
      if (window.__diagLog) window.__diagLog('WebGL 不可用 → 交给兼容模式渲染');
      var box = document.createElement('div');
      box.className = 'no-webgl';
      box.innerHTML = '当前环境不支持 WebGL，已切换为兼容模式（简化画面）。';
      menu.appendChild(box);
      return;
    }
    try {
      buildTrack();
      buildScene();
      buildCityBlocks();
      playerGrp = playerCar();
      scene.add(playerGrp);
      seatCam = new THREE.Object3D();
      seatCam.position.copy(CFG.COCKPIT_OFFSET);
      seatCam.rotation.x = -0.05;
      playerGrp.add(seatCam);
      var initSamp = sampleAtS(0);
      playerGrp.position.set(initSamp.pos.x, 0, initSamp.pos.z);
      playerGrp.rotation.y = initSamp.yaw;
      resetRun();
      state = 'menu';
      setViewVisible(false);
      setupGyro();
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', function () {
        // Android WebView 旋转后 innerWidth 会延迟更新，多补两次
        setTimeout(resize, 60); setTimeout(resize, 260); setTimeout(resize, 600);
      });
      if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
      document.addEventListener('visibilitychange', function () { if (document.hidden) Audio.stopEngine(); });
      $('btnSound').addEventListener('click', toggleMute);
      $('btnStart').addEventListener('click', function () { Audio.ensure(); startRun(); });
      $('btnAgain').addEventListener('click', function () { Audio.ensure(); startRun(); });
      btnView.addEventListener('click', cycleView);
      var q = /[?&]view=(\w+)/.exec(location.search);
      if (q && q[1] === 'cockpit') { viewMode = COCKPIT; setViewUI(); }
      if (/[?&]autostart=1\b/.test(location.search)) { setTimeout(function () { Audio.ensure(); startRun(); }, 60); }
      lastTm = performance.now();
      window.__booted = true;
      if (window.__diagLog) window.__diagLog('启动完成，进入渲染循环');
      requestAnimationFrame(frame);
    } catch (err) {
      showFatal(err);
      if (window.__diagLog) window.__diagLog('启动异常：' + ((err && err.message) || err));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();