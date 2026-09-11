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
    ROAD_W: 14, ROAD_HALF: 7,          // v6.0：11m → 14m（双向四车道，更接近真实公路）
    LANES: 4, LANE_W: 14 / 4,
    MAX_SPEED: 245, REVERSE_MAX: -50,
    ACCEL: 38, BRAKE_DECEL: 85, COAST_DECEL: 16, ROLL_DRAG: 0.12,
    STEER_KBD: 520, STEER_TOUCH: 5.4, STEER_MAX_OFFSET: 6.2, STEER_RECOVER: 4.5,
    STEER_RATE: 9.2,                    // v0.13.1：6.2 → 9.2（转弯明显更跟手）
    STEER_LAG: 14,                      // v0.13.1：横向速度跟随系数 9 → 14（减少"打舵后要等一下"的迟滞）
    STEER_SWIPE: 0.10, STEER_SWIPE_MIN: 60, // v0.13.1：滑动 0.16 屏宽打满 → 0.10 屏宽（且不低于 60px）
    FOV: 64, CAM_DIST: 8.6, CAM_H: 4.6, CAM_LOOK_Y: 1.1, CAM_LOOK_AHEAD: 24,
    COCKPIT_OFFSET: new THREE.Vector3(0.30, 0.98, 0.34),   // v6.0：0.74 → 0.98（抬到仪表台上方、挡风下沿之上，越过引擎盖看清路面）
    INVINCIBLE: 2.6, HIT_DROP: 0.62,
    /* —— v0.13.2 生命值 / 车损系统 ——
       不再"一撞就掉命"：撞击按相对速度换算成车损值累加，
       累计满 DMG_MAX(100) 才扣 1 条命并清零；停撞 DMG_REPAIR_DELAY 秒后开始自动修复。 */
    LIVES: 3,
    DMG_MAX: 100,           // 车损上限：满 100 掉 1 条命
    DMG_MIN: 6,             // 单次撞击最低伤害（轻擦）
    DMG_MAXHIT: 45,         // 单次撞击最高伤害（全速追尾）
    DMG_PER_KMH: 0.20,      // 每 1km/h 相对接近速度换算的伤害系数
    DMG_LAT: 0.7,           // 横向（侧擦）接近速度的权重
    DMG_REPAIR: 1.6,        // 自动修复速度（车损/秒）
    DMG_REPAIR_DELAY: 3.0,  // 停撞多少秒后开始修复
    DMG_SMOKE: 70,          // 车损超过此值开始冒烟、HUD 转红
    DMG_SLOW: 0.14,         // 满损时极速打 86 折
    GEM_SCORE: 60, GEM_COMBO_WIN: 1.8,
    TRACK_N: 600, LOOP_KM_H: 200,
    FOG_NEAR: 120, FOG_FAR: 640, FOG_COLOR: 0xcfe4f0,       // v6.0：远景更通透
    AI_SPEED_MIN: 0.42, AI_SPEED_MAX: 0.72,
    GYRO_YAW_RANGE: 0.55, GYRO_PITCH_RANGE: 0.30,
    SKY_R: 800, GROUND_R: 1100, BACKDROP_R: 760, BACKDROP_H: 320
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
  var uiScore = $('score'), uiGems = $('gemVal'), uiMile = $('mile'), uiLives = $('lives'),
      uiDmgWrap = $('dmgWrap'), uiDmgFill = $('dmgFill'),
      uiView = $('viewBadge'), btnView = $('btnView'), btnGyro = $('btnGyro'), menu = $('menu'), over = $('over'),
      uiFinalS = $('finalScore'), uiFinalD = $('finalDist'), uiFinalG = $('finalGems'),
      uiCombo = $('combo'), uiComboTxt = $('comboTxt'), uiComboBar = $('comboBar'), elFlash = $('flash'),
      gaugeCv = $('gauge'), miniCv = $('mini'), pedGas = $('pedGas'), pedBrake = $('pedBrake');
  var gaugeCtx = gaugeCv ? gaugeCv.getContext('2d') : null;
  var miniCtx = miniCv ? miniCv.getContext('2d') : null;
  var miniBox = null, hudT = 0;
  var W = 0, H = 0, dpr = 1;
  var state = 'menu';
  // v0.13.2：dmg = 车损值(0~CFG.DMG_MAX)，满 100 才掉 1 条命；dmgCool = 停止撞击后的修复倒计时
  var time = 0, runT = 0, dist = 0, score = 0, gems = 0, lives = 3, dmg = 0, dmgCool = 0, smokeT = 0;
  var speed = 0, throttle = 0, lateral = 0, lateralVel = 0, carTilt = 0, steerVis = 0;
  var inv = 0, shake = 0, flash = 0, overT = 0;
  var aiCars = [], gemsArr = [], trees = [], bushes = [], rocks = [], parts = [], dashInst = null, dashData = [], cityBlocks = [];
  var playerGrp = null, seatCam = null, wheelParts = [], frontWheelGrps = [], wheelSpin = [];
  var clouds = [];
  var comboN = 0, comboT = 0, pendingPop = [];
  var lastTm = 0, camFov = CFG.FOV, camLookYaw = 0, camLookPitch = 0;
  var CHASE = 0, COCKPIT = 1, viewMode = CHASE, viewBlend = 1;
  var gyroOn = false, gyroAvail = false, gyroTilt = new THREE.Vector2(0, 0);
  var trackSamples = [], totalLen = 0, trackCurve = null;
  var curSeg = { pos: new THREE.Vector3(), yaw: 0, right: new THREE.Vector3(1, 0, 0), tan: new THREE.Vector3(0, 0, -1) };

  /* ======== 输入 ========
     v6.0 控制方案：
       · 左下「油门 / 刹车」踏板按钮（按住生效，支持触摸与鼠标）
       · 屏幕右侧区域左右滑动 → 比例转向（相对起点的位移，越往右越右转）
       · 键盘兜底：←→/A D 转向，↑ 油门，↓ 刹车
     ==================================== */
  var input = { kLeft: 0, kRight: 0, kUp: 0, kDown: 0, drag: null, gas: false, brake: false, swipeGas: false, swipeBrake: false };
  var steerTouchId = null;   // 正在负责"转向滑动"的那根手指的 identifier

  function bindPedal(el, key, cls) {
    if (!el) return;
    function on(e) { e.preventDefault(); input[key] = true; el.classList.add('on'); }
    function off(e) { if (e) e.preventDefault(); input[key] = false; el.classList.remove('on'); }
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }
  bindPedal(pedGas, 'gas');
  bindPedal(pedBrake, 'brake');

  /* ⚠️ v6.0 多点触控修复：
     旧实现用 e.touches[0] 取"第一根手指"——若玩家先用左拇指按住油门、
     再用右拇指滑动转向，touches[0] 仍是左拇指（在左侧踏板区），
     于是转向起点的 clientX < 42% 直接 return → 转向失效；
     且 endSteer 会把手按的油门一起清零 → 一松转向手就断油。
     现在用 changedTouches[0]（本次真正按下的那根）+ identifier 绑定，
     转向手势与踏板互不干扰。 */
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    if (!t) return;
    // 左 42% 区域留给踏板/仪表盘，转向只认右侧滑动
    if (t.clientX < W * 0.42) return;
    if (steerTouchId !== null && steerTouchId !== t.identifier) return;  // 已有一根手指在转向
    steerTouchId = t.identifier;
    input.drag = { sx: t.clientX, sy: t.clientY, lx: 0 };
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (!input.drag || steerTouchId === null) return;
    var t = null;
    for (var i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === steerTouchId) t = e.touches[i];
    if (!t) return;
    // 相对起点位移 → 比例转向：滑动约 1/10 屏宽即打满（v0.13.1：原 1/6 偏钝）
    input.drag.lx = clamp((t.clientX - input.drag.sx) / Math.max(W * CFG.STEER_SWIPE, CFG.STEER_SWIPE_MIN), -1, 1);
    // 顺手支持：右侧上滑加油 / 下滑刹车（保留旧习惯，与踏板等效、独立于踏板）
    var dyFromBase = t.clientY - input.drag.sy;
    if (Math.abs(dyFromBase) > 26) {
      if (dyFromBase < 0) { input.swipeGas = true; input.swipeBrake = false; }
      else { input.swipeBrake = true; input.swipeGas = false; }
    }
  }, { passive: false });
  // 只有"转向那根手指"抬起才结束转向；踏板手指抬起不应影响转向/油门
  function endSteer(e) {
    if (e && e.changedTouches && e.changedTouches.length) {
      var isSteerEnd = false;
      for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === steerTouchId) isSteerEnd = true;
      if (!isSteerEnd) return;
    }
    input.drag = null; steerTouchId = null;
    input.swipeGas = false; input.swipeBrake = false;
  }
  canvas.addEventListener('touchend', endSteer, { passive: false });
  canvas.addEventListener('touchcancel', endSteer, { passive: false });

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
  var carHiddenByDebug = false, forceHideCar = false;
  // 车身可见性统一入口：座舱视角（仅比赛中）/ 调试隐藏 时不可见；无敌闪烁在主循环里叠加
  // 注意：菜单/结算界面仍显示车身（镜头绕车动画），所以座舱隐藏只在 state==='run' 时生效
  function carVisible() { return !carHiddenByDebug && !(forceHideCar && state === 'run'); }
  function setViewUI() {
    uiView.textContent = viewMode === COCKPIT ? '驾驶舱视角' : '追尾视角';
    btnView.textContent = viewMode === COCKPIT ? '车后视角' : '车内视角';
    var inCockpit = (viewMode === COCKPIT);
    forceHideCar = inCockpit;
    // v6.0：座舱视角整体隐藏本车（车身）。低多边形超跑的车身/机盖/翼子板体积较大，
    // 相机放进座舱后这些面片会怼在镜头前把路面挡死（实测车身占屏 >45%）。
    // 隐藏整车身 = 干净的第一人称"车前视角"，完全看清路面；HUD 已提供速度/踏板等座舱信息。
    if (playerGrp) playerGrp.visible = carVisible();
    // 同时隐藏玻璃（双保险：某些机型 visible=false 的父级下仍可能残留半透明面）
    if (playerGrp && playerGrp.userData && playerGrp.userData.glass) {
      playerGrp.userData.glass.forEach(function (m) { m.visible = !inCockpit; });
    }
  }
  function setViewVisible(on) {
    btnView.classList.toggle('hidden', !on);
    uiView.style.display = on ? '' : 'none';
    // 菜单/结算时给 #hud 去掉 playing → CSS 隐藏仪表盘/踏板/路线图等（首屏更干净）
    var hudEl = $('hud'); if (hudEl) hudEl.classList.toggle('playing', !!on);
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
    // 记录玻璃件：座舱视角时隐藏本车玻璃，避免视线被半透明车窗糊住
    g.userData.glass = [winFront, winRoof, winRear].concat(
      g.children.filter(function (ch) { return ch.material === M_GLASS; })
    );
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

  /* v0.13.2：车损冒烟。复用已有的 parts 粒子池，不新增任何渲染管线/后处理。
     ⚠️ 关键：粒子必须跟随车速前进（vx/vz = 车速*0.9）。
        最初版本让烟留在地面，结果车以 ~30m/s 前进、相机只在车后 8.6m，
        存活 0.95s 的烟被拉开 28m → 全部落到相机背后，屏幕上一点都看不到。
        现在烟以略低于车速的速度随车漂移，形成"贴车升腾"的可见烟柱（街机常见做法）。 */
  function smoke(x, y, z, vx, vz) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(0.30 + Math.random() * 0.16, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x8b939d, transparent: true, opacity: 0.55, depthWrite: false }));
    m.position.set(x + (Math.random() - 0.5) * 0.7, y, z + (Math.random() - 0.5) * 0.7);
    scene.add(m);
    parts.push({
      m: m, smoke: true, maxLife: 0.70,
      vx: (vx || 0) + (Math.random() - 0.5) * 1.2, vy: 2.2 + Math.random() * 1.4,
      vz: (vz || 0) + (Math.random() - 0.5) * 1.2,
      g: 1.2,   // 正数 = 向上加速（热气上浮），区别于碎片的 -14 重力
      life: 0.70
    });
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
    [-100, -290]
    /* ⚠️ v0.13.0 修复：此处曾多写一个 [0,-260] 作为"闭合点"，但 closed=true
       已经自动首尾相连 → 控制点重复 + 闭合 = 起点处出现退化段，
       CatmullRom 曲线在起点 (-0.4,-260) 自我重叠（自交），
       两段路面共面 z-fighting → 起点处出现一块"发亮的矩形"。
       实测：含重复点时最小自距 0.02m（相距 190m 的两段重合）；
       去掉重复点后最小自距 0.58m（正常）。故删除重复点。 */
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

    /* —— v6.0 天空：渐变贴图天空球（纯色 → 有层次的渐变） —— */
    var skyCv = document.createElement('canvas'); skyCv.width = 8; skyCv.height = 256;
    var sx = skyCv.getContext('2d');
    var sg = sx.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, '#2b6fc4'); sg.addColorStop(0.32, '#5fa4e2');
    sg.addColorStop(0.60, '#a9d3f2'); sg.addColorStop(0.80, '#dcecf9'); sg.addColorStop(1, '#e9f3f8');
    sx.fillStyle = sg; sx.fillRect(0, 0, 8, 256);
    var skyTex = new THREE.CanvasTexture(skyCv);
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(CFG.SKY_R, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false })
    );
    sky.position.y = -30;
    sky.renderOrder = -1000;
    scene.add(sky);

    /* —— v6.0 太阳：径向渐变光晕 Sprite（与主平行光同方向） —— */
    try {
      var sunCv = document.createElement('canvas'); sunCv.width = sunCv.height = 128;
      var ux = sunCv.getContext('2d');
      var rg = ux.createRadialGradient(64, 64, 2, 64, 64, 64);
      rg.addColorStop(0, 'rgba(255,255,245,1)'); rg.addColorStop(0.16, 'rgba(255,247,214,.95)');
      rg.addColorStop(0.40, 'rgba(255,230,168,.34)'); rg.addColorStop(1, 'rgba(255,222,150,0)');
      ux.fillStyle = rg; ux.beginPath(); ux.arc(64, 64, 64, 0, 6.284); ux.fill();
      var sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(sunCv), fog: false, depthWrite: false, transparent: true
      }));
      sunSpr.scale.set(210, 210, 1);
      sunSpr.position.copy(new THREE.Vector3(80, 120, 40).normalize().multiplyScalar(CFG.SKY_R * 0.88));
      scene.add(sunSpr);
    } catch (eSun) { /* 忽略 */ }

    /* —— v6.0 云层：柔和云朵 Sprite 缓慢漂移 —— */
    try {
      var clCv = document.createElement('canvas'); clCv.width = 256; clCv.height = 128;
      var lx = clCv.getContext('2d');
      for (var ci2 = 0; ci2 < 30; ci2++) {
        var cx2 = 44 + Math.random() * 168, cy2 = 54 + Math.random() * 42, rr2 = 14 + Math.random() * 32;
        var cg2 = lx.createRadialGradient(cx2, cy2, 0, cx2, cy2, rr2);
        cg2.addColorStop(0, 'rgba(255,255,255,.9)'); cg2.addColorStop(1, 'rgba(255,255,255,0)');
        lx.fillStyle = cg2; lx.beginPath(); lx.arc(cx2, cy2, rr2, 0, 6.284); lx.fill();
      }
      var clTex = new THREE.CanvasTexture(clCv);
      for (var ci3 = 0; ci3 < 14; ci3++) {
        var spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: clTex, fog: false, depthWrite: false, transparent: true, opacity: 0.75 + Math.random() * 0.2
        }));
        var ang2 = Math.random() * 6.283, rad2 = 150 + Math.random() * 520;
        spr.position.set(Math.cos(ang2) * rad2, 120 + Math.random() * 120, Math.sin(ang2) * rad2);
        var sc = 150 + Math.random() * 240;
        spr.scale.set(sc, sc * 0.48, 1);
        scene.add(spr); clouds.push(spr);
      }
    } catch (eCl) { /* 忽略 */ }

    /* —— v6.0 草地：程序化草皮贴图（替代纯色平面） —— */
    var grCv = document.createElement('canvas'); grCv.width = grCv.height = 128;
    var gx = grCv.getContext('2d');
    gx.fillStyle = '#5f9d47'; gx.fillRect(0, 0, 128, 128);
    for (var gi = 0; gi < 3000; gi++) {
      var gv = Math.random();
      gx.fillStyle = gv < 0.45 ? 'rgba(74,128,56,.45)' : (gv < 0.78 ? 'rgba(112,172,82,.45)' : 'rgba(150,196,104,.32)');
      gx.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 3);
    }
    var grTex = new THREE.CanvasTexture(grCv);
    grTex.wrapS = grTex.wrapT = THREE.RepeatWrapping;
    grTex.repeat.set(140, 140);
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.GROUND_R * 2, CFG.GROUND_R * 2),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: grTex })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;   // ⚠️ v0.11.1：原 -0.02 与路面太近，远处低精度深度缓冲会
                                //     z-fighting 串色（草地"渗"上路面），拉开到 -0.1
    scene.add(ground);

    /* —— v6.0 湖面：赛道环内的水面（增加景深与色彩层次） —— */
    try {
      var lake = new THREE.Mesh(new THREE.CircleGeometry(158, 44),
        new THREE.MeshLambertMaterial({ color: 0x2f74ad }));
      lake.rotation.x = -Math.PI / 2;
      lake.position.set(-18, -0.05, -12);
      scene.add(lake);
      // 湖岸浅滩
      var shore = new THREE.Mesh(new THREE.RingGeometry(158, 176, 44),
        new THREE.MeshLambertMaterial({ color: 0xc9bfa0 }));
      shore.rotation.x = -Math.PI / 2;
      shore.position.set(-18, -0.055, -12);
      scene.add(shore);
    } catch (eLk) { /* 忽略 */ }

    /* —— v6.0 远山：三层景深（近森林丘陵 / 中青蓝山 / 远淡蓝剪影） —— */
    var hideMtn = /[?&]hide=mtn\b/.test(location.search);   // 调试：排除远山
    var mtnRings = [
      { r0: 400, r1: 480, h0: 55, h1: 125, n: 26, cr0: 38, cr1: 62, cols: [0x5d7f62, 0x6f9470] },
      { r0: 540, r1: 720, h0: 95, h1: 235, n: 24, cr0: 68, cr1: 118, cols: [0x7d9db6, 0x92afc5] },
      { r0: 800, r1: 1020, h0: 140, h1: 320, n: 20, cr0: 120, cr1: 185, cols: [0xa9c5db, 0xbfd6e7] }
    ];
    for (var ri = 0; !hideMtn && ri < mtnRings.length; ri++) {
      var ring = mtnRings[ri];
      var mA = new THREE.MeshLambertMaterial({ color: ring.cols[0], flatShading: true, fog: false });
      var mB = new THREE.MeshLambertMaterial({ color: ring.cols[1], flatShading: true, fog: false });
      for (var mi = 0; mi < ring.n; mi++) {
        var ang = (mi / ring.n) * Math.PI * 2 + (Math.random() - 0.5) * 0.22;
        var rad = ring.r0 + Math.random() * (ring.r1 - ring.r0);
        var hgt = ring.h0 + Math.random() * (ring.h1 - ring.h0);
        var crad = ring.cr0 + Math.random() * (ring.cr1 - ring.cr0);
        var mtn = new THREE.Mesh(new THREE.ConeGeometry(crad, hgt, 5), (mi % 3 === 0) ? mB : mA);
        mtn.position.set(Math.cos(ang) * rad, hgt * 0.5 - 8, Math.sin(ang) * rad);
        mtn.rotation.y = Math.random() * 3;
        scene.add(mtn);
      }
    }

    buildRoad();
  }

  /* ======== 程序化沥青贴图（CanvasTexture 同步生成，不依赖外部图片）
     u 轴 = 路幅方向（左边缘 → 右边缘），v 轴 = 沿路 8m
     烘焙内容：沥青噪点 / 轮迹磨损 / 两侧白色边线 / 中央双黄实线 / 车道白色虚线
     ============================================================ */
  /* v6.0：程序化沥青贴图（公路质感的核心）
     坐标约定：横向 u 铺满整条路宽 = CFG.ROAD_W 米（ClampToEdge，不横向重复）；
              纵向 v 每 8m 平铺一次（RepeatWrapping）。
     取 1024×512（均为 2 的幂 → WebGL1 也能 mipmap + RepeatWrapping，
     老 Android WebView 不会因非 POT 贴图变黑/被 clamp）。
     横向 ≈73px/m、纵向 64px/m ≈ 等比 → 近景不再被横向拉伸成"糊斑"。
     所有线宽/尺寸按"米"换算，改动 ROAD_W 时线条粗细仍然正确。 */
  function makeAsphaltTexture() {
    var TW = 1024, TH = 512;
    var PPMX = TW / CFG.ROAD_W;            // 横向像素/米
    var ux = function (m) { return m * PPMX; };
    var cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
    var cx = cv.getContext('2d');
    // 1) 沥青底（中性深灰）
    cx.fillStyle = '#35383e'; cx.fillRect(0, 0, TW, TH);
    // 2) 细骨料噪点（密集小颗粒 = 沥青质感的关键，量要足）
    for (var i = 0; i < 42000; i++) {
      var g = 44 + Math.random() * 66;
      cx.fillStyle = 'rgba(' + (g | 0) + ',' + (g | 0) + ',' + ((g + 6) | 0) + ',' + (0.16 + Math.random() * 0.42).toFixed(2) + ')';
      var sz = 1 + Math.random() * 2.0;
      cx.fillRect(Math.random() * TW, Math.random() * TH, sz, sz);
    }
    // 3) 极淡的低频色斑（只体现"料号差异"，不再是明显云斑）
    for (var p = 0; p < 30; p++) {
      cx.fillStyle = 'rgba(' + (30 + Math.random() * 24 | 0) + ',' + (32 + Math.random() * 24 | 0) + ',' + (38 + Math.random() * 24 | 0) + ',0.10)';
      cx.beginPath();
      cx.ellipse(Math.random() * TW, Math.random() * TH, ux(1.2 + Math.random() * 3.5), ux(0.9 + Math.random() * 3), Math.random() * 3, 0, 6.284);
      cx.fill();
    }
    // 4) 沥青裂缝
    cx.strokeStyle = 'rgba(18,20,24,.5)'; cx.lineWidth = 1.4;
    for (var c = 0; c < 26; c++) {
      var x0 = Math.random() * TW, y0 = Math.random() * TH;
      cx.beginPath(); cx.moveTo(x0, y0);
      for (var q = 0; q < 5; q++) { x0 += (Math.random() - 0.5) * ux(0.5); y0 += TH * 0.03 + Math.random() * TH * 0.06; cx.lineTo(x0, y0); }
      cx.stroke();
    }
    // 5) 沥青修补块（少量深色硬边块，模拟补丁）
    for (var pt = 0; pt < 5; pt++) {
      cx.fillStyle = 'rgba(24,26,31,' + (0.18 + Math.random() * 0.16).toFixed(2) + ')';
      cx.fillRect(Math.random() * TW, Math.random() * TH, ux(1.5 + Math.random() * 3), TH * (0.06 + Math.random() * 0.14));
    }
    // 6) 车辙磨损（每条车道两条略深的带）
    var laneW = TW / CFG.LANES;
    for (var L = 0; L < CFG.LANES; L++) {
      (function (lc) {
        [-1, 1].forEach(function (s) {
          var gw = ux(0.34);
          var gx = lc + s * laneW * 0.20 - gw / 2;
          var gr = cx.createLinearGradient(gx, 0, gx + gw, 0);
          gr.addColorStop(0, 'rgba(22,24,28,0)'); gr.addColorStop(0.5, 'rgba(22,24,28,.34)'); gr.addColorStop(1, 'rgba(22,24,28,0)');
          cx.fillStyle = gr; cx.fillRect(gx, 0, gw, TH);
        });
      })((L + 0.5) * laneW);
    }
    // 7) 两侧白色边线（实线，约 15cm 宽，距路缘 0.3m）
    cx.fillStyle = '#eef2f7';
    var edgeW = Math.max(3, ux(0.15));
    cx.fillRect(ux(0.30), 0, edgeW, TH);
    cx.fillRect(TW - ux(0.30) - edgeW, 0, edgeW, TH);
    // 8) 中央双黄实线（各 12cm、间距 12cm）
    cx.fillStyle = '#e9bb3c';
    var yW = Math.max(3, ux(0.12)), yGap = ux(0.12);
    cx.fillRect(TW / 2 - yGap / 2 - yW, 0, yW, TH);
    cx.fillRect(TW / 2 + yGap / 2, 0, yW, TH);
    // 9) 车道分隔白虚线（一个贴图纵向周期 = 8m：3m 实 + 5m 空）
    cx.fillStyle = '#eef2f7';   // ⚠️ 必须重置：上一段是黄色，否则虚线会画成黄色
    var dashH = TH * 3 / 8, dW = Math.max(3, ux(0.15));
    cx.fillRect(TW * 0.25 - dW / 2, 0, dW, dashH);
    cx.fillRect(TW * 0.75 - dW / 2, 0, dW, dashH);

    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    try {
      var maxA = (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy) ? renderer.capabilities.getMaxAnisotropy() : 4;
      tex.anisotropy = Math.max(1, Math.min(8, maxA));
    } catch (e) { tex.anisotropy = 4; }
    return tex;
  }

  /* ======== 道路路面 / 路缘 / 路肩 / 反光柱 ======== */
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
      /* ⚠️ v0.11.1 修复：旧绕序 (i0,i2,i1)/(i1,i2,i3) 从上看是顺时针 →
         几何正面朝下 → FrontSide 背面剔除把整条路面剔掉 →
         露出下面的绿色草地（用户看到"公路是绿色的"）。
         反转为 (i0,i1,i2)/(i1,i3,i2)，法线朝上、正面朝上。 */
      idxArr.push(i0, i1, i2); idxArr.push(i1, i3, i2);
    }
    var roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
    roadGeo.setIndex(idxArr);
    /* v6.0：路面改用程序化沥青贴图（含车道线/轮迹），光滑度略降 → 更像沥青
       ?flat=1 调试：退回纯色路面（用于判断画面异常是否来自贴图） */
    var roadMat = /[?&]flat=1\b/.test(location.search)
      ? new THREE.MeshLambertMaterial({ color: 0x4a4e57 })
      : new THREE.MeshLambertMaterial({ color: 0xffffff, map: makeAsphaltTexture() });
    var road = new THREE.Mesh(roadGeo, roadMat);
    road.frustumCulled = false;
    scene.add(road);

    // 路缘（左右各一条，红白相间色块）
    // ⚠️ v0.11.1 修复：旧索引只连接了"同一采样点内部"的 4 个顶点（横截面碎片，
    //    面朝行车方向），没有连接相邻采样点 → 路缘是一堆碎片不是连续条带。
    //    现在改为连接 i 与 i+1 的顶面/外侧面/内侧面三个条带。
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
        var vi = i * 4;
        cPos.push(base.x, base.y, base.z, top.x, top.y, top.z, top2.x, top2.y, top2.z, base2.x, base2.y, base2.z);
        // 顶点色：红白相间（必须 0~1 浮点分量）
        var isRed = (i % 4 < 2);
        var cr = isRed ? 0.83 : 0.92, cg = isRed ? 0.25 : 0.92, cb = isRed ? 0.25 : 0.92;
        cCol.push(cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb);
      }
      for (var k = 0; k < N; k++) {
        var v0 = k * 4, v1 = v0 + 1, v2 = v0 + 2, v3 = v0 + 3;      // 采样点 k
        var w0 = v0 + 4, w1 = w0 + 1, w2 = w0 + 2, w3 = w0 + 3;     // 采样点 k+1
        // 顶面（法线朝上）
        cIdx.push(v1, v2, w2); cIdx.push(v1, w2, w1);
        // 外侧面（法线朝外）
        cIdx.push(v3, w3, w2); cIdx.push(v3, w2, v2);
        // 内侧面（法线朝路）
        cIdx.push(v0, w0, w1); cIdx.push(v0, w1, v1);
      }
      curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
      curbGeo.setAttribute('color', new THREE.Float32BufferAttribute(cCol, 3));
      curbGeo.setIndex(cIdx);
      curbGeo.computeVertexNormals();
      // DoubleSide：side=-1 时绕序镜像，双面渲染保证两个方向都可见且光照正确
      var curbMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      var curbMesh = new THREE.Mesh(curbGeo, curbMat);
      curbMesh.frustumCulled = false;
      scene.add(curbMesh);
    });

    // 路肩：路缘外侧的碎石带（v6.0 新增，增加公路层次感）
    [-1, 1].forEach(function (side) {
      var shGeo = new THREE.BufferGeometry();
      var sp = [], si = [];
      for (var i = 0; i <= N; i++) {
        var a = trackSamples[i % N];
        var o1 = a.p.clone().add(a.right.clone().multiplyScalar(side * (half + 0.4)));
        var o2 = a.p.clone().add(a.right.clone().multiplyScalar(side * (half + 2.4)));
        sp.push(o1.x, 0.004, o1.z, o2.x, 0.004, o2.z);
      }
      for (var k2 = 0; k2 < N; k2++) {
        var j0 = k2 * 2, j1 = j0 + 1, j2 = j0 + 2, j3 = j0 + 3;
        // 朝上的绕序随左右镜像，保证正面朝上（否则同样会被剔除成"看不见"）
        if (side > 0) { si.push(j0, j1, j2); si.push(j1, j3, j2); }
        else { si.push(j0, j2, j1); si.push(j1, j2, j3); }
      }
      shGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      shGeo.setIndex(si);
      shGeo.computeVertexNormals();
      var shMat = new THREE.MeshLambertMaterial({ color: 0x8f8474 });
      var shMesh = new THREE.Mesh(shGeo, shMat);
      shMesh.frustumCulled = false;
      scene.add(shMesh);
    });

    // 反光柱（道路两侧，每 34m 一根；InstancedMesh 零开销）
    try {
      var stepP = 34, maxP = Math.ceil(totalLen / stepP) * 2 + 4;
      var postGeo = new THREE.CylinderGeometry(0.075, 0.095, 0.95, 6);
      var postMat = new THREE.MeshLambertMaterial({ color: 0xeef2f7 });
      var posts = new THREE.InstancedMesh(postGeo, postMat, maxP);
      posts.frustumCulled = false;
      var pm = new THREE.Matrix4(), pv = new THREE.Vector3(), pq = new THREE.Quaternion(), ps = new THREE.Vector3(1, 1, 1);
      var pn = 0;
      for (var sP = 0; sP < totalLen && pn < maxP - 1; sP += stepP) {
        for (var sd = -1; sd <= 1; sd += 2) {
          var smp = sampleAtS(sP);
          var offP = sd * (half + 1.6);
          pv.set(smp.pos.x + smp.right.x * offP, 0.45, smp.pos.z + smp.right.z * offP);
          pm.compose(pv, pq, ps);
          posts.setMatrixAt(pn++, pm);
        }
      }
      posts.count = pn;
      scene.add(posts);
      // 柱顶红色反光片
      var capGeo = new THREE.BoxGeometry(0.13, 0.1, 0.06);
      var capMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
      var caps = new THREE.InstancedMesh(capGeo, capMat, maxP);
      caps.frustumCulled = false;
      var cn = 0;
      for (var sC = 0; sC < totalLen && cn < maxP - 1; sC += stepP) {
        for (var sd2 = -1; sd2 <= 1; sd2 += 2) {
          var smp2 = sampleAtS(sC);
          var offC = sd2 * (half + 1.6);
          pv.set(smp2.pos.x + smp2.right.x * offC, 0.82, smp2.pos.z + smp2.right.z * offC);
          pm.compose(pv, pq, ps);
          caps.setMatrixAt(cn++, pm);
        }
      }
      caps.count = cn;
      scene.add(caps);
    } catch (eP) { /* 低端机忽略反光柱 */ }

    // v6.0：车道线全部烘焙进沥青贴图（含中央双黄实线 + 车道虚线），
    //       不再需要每帧刷新的 InstancedMesh 虚线，省一次逐帧矩阵更新。
    dashInst = null; dashData = [];
  }

  /* ======== 城市建筑群（沿路远景天际线，带程序化窗户贴图） ======== */
  function makeWindowTexture() {
    var c = document.createElement('canvas'); c.width = 64; c.height = 64;
    var x = c.getContext('2d');
    x.fillStyle = '#79879a'; x.fillRect(0, 0, 64, 64);          // 墙面
    for (var r = 0; r < 4; r++) {
      for (var q = 0; q < 4; q++) {
        var lit = Math.random() < 0.16;                          // 少量亮灯窗
        x.fillStyle = lit ? 'rgba(255,224,155,.95)' : 'rgba(44,62,86,.88)';
        x.fillRect(q * 16 + 3.5, r * 16 + 4, 9, 9);
      }
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function buildCityBlocks() {
    if (/[?&]hide=city\b/.test(location.search)) return;   // 调试：排除城市建筑
    var winTex = makeWindowTexture();
    var bMats = [
      new THREE.MeshLambertMaterial({ color: 0xf2f4f7, map: winTex }),
      new THREE.MeshLambertMaterial({ color: 0xdbe6f2, map: winTex }),
      new THREE.MeshLambertMaterial({ color: 0xf0e3d2, map: winTex }),
      new THREE.MeshLambertMaterial({ color: 0xc9d6e4, map: winTex })
    ];
    /* ⚠️ 修复：旧版楼群贴着赛道布置（侧向 -22~58m、高 14~52m、每 6 采样点一组），
       玩家在赛道上时视野被楼体完全填死（俯视验证：整屏灰蓝）。
       v6.0：退到赛道外 75~200m 作远景天际线，带窗户贴图与高度层次。 */
    for (var i = 0; i < trackSamples.length; i += 12) {
      var s = trackSamples[i];
      var cluster = new THREE.Group();
      var n = 2 + ((Math.random() * 3) | 0);
      for (var k = 0; k < n; k++) {
        var w = 9 + Math.random() * 15;
        var d = 9 + Math.random() * 15;
        var h = 16 + Math.random() * 34;
        var geo = new THREE.BoxGeometry(w, h, d);
        // 按楼体尺寸缩放 UV，让窗户保持 ~4m×3.6m 的固定大小
        var uv = geo.attributes.uv;
        var ru = Math.max(1, Math.round(w / 4)), rv = Math.max(1, Math.round(h / 3.6));
        for (var ui = 0; ui < uv.count; ui++) uv.setXY(ui, uv.getX(ui) * ru, uv.getY(ui) * rv);
        uv.needsUpdate = true;
        var m = new THREE.Mesh(geo, bMats[(Math.random() * bMats.length) | 0]);
        var side = (i % 24 === 0) ? 1 : -1;                 // 左右交替
        var ox = side * (75 + Math.random() * 125);         // 侧向 75~200m
        var oz = (Math.random() - 0.5) * 80;
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

  /* v6.0：植被多样化——针叶树 / 阔叶树 / 灌木 / 岩石 */
  function makeTree(kind) {
    var g = new THREE.Group();
    var s = 0.85 + Math.random() * 0.95;
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.32 * s, 2.3 * s, 6),
      new THREE.MeshLambertMaterial({ color: 0x7a5230 }));
    trunk.position.y = 1.15 * s; g.add(trunk);
    if (kind === 'broad') {
      var leafCols = [0x4fae55, 0x3f9b43, 0x63b85f];
      for (var i = 0; i < 3; i++) {
        var rr = (1.35 + Math.random() * 0.75) * s;
        var ball = new THREE.Mesh(new THREE.IcosahedronGeometry(rr, 0),
          new THREE.MeshLambertMaterial({ color: leafCols[(Math.random() * 3) | 0], flatShading: true }));
        ball.position.set((Math.random() - 0.5) * 1.3 * s, (3.0 + Math.random() * 1.2) * s, (Math.random() - 0.5) * 1.3 * s);
        g.add(ball);
      }
    } else {
      var layers = 2 + ((Math.random() * 2) | 0);
      var pineCols = [0x2f8b3c, 0x3f9b43, 0x4fae55];
      for (var L = 0; L < layers; L++) {
        var lr = (1.9 - L * 0.42) * s, lh = (2.7 - L * 0.3) * s;
        var cone = new THREE.Mesh(new THREE.ConeGeometry(lr, lh, 7),
          new THREE.MeshLambertMaterial({ color: pineCols[L % 3], flatShading: true }));
        cone.position.y = (2.6 + L * 1.35) * s;
        cone.rotation.y = Math.random() * 3;
        g.add(cone);
      }
    }
    g.userData.s = s;
    return g;
  }

  function makeBush() {
    var g = new THREE.Group();
    var n = 2 + ((Math.random() * 3) | 0);
    for (var i = 0; i < n; i++) {
      var r = 0.45 + Math.random() * 0.55;
      var b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0),
        new THREE.MeshLambertMaterial({ color: Math.random() < 0.5 ? 0x3f8f45 : 0x5aa85e, flatShading: true }));
      b.position.set((Math.random() - 0.5) * 1.2, r * 0.72, (Math.random() - 0.5) * 1.2);
      g.add(b);
    }
    return g;
  }

  function makeRock() {
    var r = 0.4 + Math.random() * 0.85;
    var g = new THREE.Group();
    var m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0),
      new THREE.MeshLambertMaterial({ color: 0x8b8d90, flatShading: true }));
    m.position.y = r * 0.52;
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    g.add(m);
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
    // 树 / 灌木 / 岩石：s-based（v6.0 增加种类与层次）
    for (var ti = 0; ti < 62; ti++) {
      var tr = makeTree(Math.random() < 0.45 ? 'broad' : 'pine');
      var sT = 30 + ti * 26 + Math.random() * 14;
      var side = (ti % 2) ? 1 : -1;
      var off = 8 + Math.random() * 30;
      var samp = sampleAtS(sT);
      var px = samp.pos.x + samp.right.x * side * (CFG.ROAD_HALF + off);
      var pz = samp.pos.z + samp.right.z * side * (CFG.ROAD_HALF + off);
      tr.position.set(px, 0, pz);
      tr.rotation.y = Math.random() * Math.PI;
      tr.userData.sBase = sT; tr.userData.side = side; tr.userData.off = off;
      scene.add(tr); trees.push(tr);
    }
    // 靠路灌木（贴近路肩，视觉上把道路"包"起来）
    for (var bi = 0; bi < 30; bi++) {
      var bs = makeBush();
      var sB = 24 + bi * 54 + Math.random() * 20;
      var sdB = (bi % 2) ? 1 : -1;
      var offB = 6 + Math.random() * 7;
      var smB = sampleAtS(sB);
      bs.position.set(smB.pos.x + smB.right.x * sdB * (CFG.ROAD_HALF + offB), 0,
                      smB.pos.z + smB.right.z * sdB * (CFG.ROAD_HALF + offB));
      bs.rotation.y = Math.random() * Math.PI;
      scene.add(bs); bushes.push(bs);
    }
    // 岩石点缀
    for (var ri3 = 0; ri3 < 14; ri3++) {
      var rk = makeRock();
      var sR = 50 + ri3 * 118 + Math.random() * 40;
      var sdR = (ri3 % 2) ? -1 : 1;
      var offR = 7 + Math.random() * 16;
      var smR = sampleAtS(sR);
      rk.position.set(smR.pos.x + smR.right.x * sdR * (CFG.ROAD_HALF + offR), 0,
                      smR.pos.z + smR.right.z * sdR * (CFG.ROAD_HALF + offR));
      rk.rotation.y = Math.random() * Math.PI;
      scene.add(rk); rocks.push(rk);
    }
  }

  function clearWorld() {
    aiCars.forEach(function (a) { scene.remove(a.mesh); });
    gemsArr.forEach(function (g) { scene.remove(g); });
    trees.forEach(function (t) { scene.remove(t); });
    bushes.forEach(function (b) { scene.remove(b); });
    rocks.forEach(function (r) { scene.remove(r); });
    parts.forEach(function (p) { scene.remove(p.m); });
    aiCars = []; gemsArr = []; trees = []; bushes = []; rocks = []; parts = [];
  }

  function resetRun() {
    runT = 0; dist = 0; score = 0; gems = 0; lives = CFG.LIVES;
    dmg = 0; dmgCool = 0; smokeT = 0;          // v0.13.2：车损清零
    speed = 0; throttle = 0; lateral = 0; lateralVel = 0; carTilt = 0; steerVis = 0;
    inv = 0; shake = 0; flash = 0; comboN = 0; comboT = 0;
    if (playerGrp) { playerGrp.visible = carVisible(); playerGrp.rotation.set(0, 0, 0); }
    clearWorld();
    spawnWorld();
    updateLives();
    __dmgShown = -1; updateDmg();
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
    // —— 油门 / 刹车：踏板按钮（或键盘）→ 平滑趋近目标值 ——
    var tgt = 0;
    if (input.gas || input.swipeGas || input.kUp) tgt += 1;
    if (input.brake || input.swipeBrake || input.kDown) tgt -= 1;
    throttle += (tgt - throttle) * Math.min(1, dt * (tgt === 0 ? 4 : 8));
    if (Math.abs(throttle) < 0.004) throttle = 0;
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
    // v0.13.2：车损越高极速越低（满损 -14%），给玩家"车被打残了"的直观反馈
    var vMax = CFG.MAX_SPEED * (1 - CFG.DMG_SLOW * (dmg / CFG.DMG_MAX));
    if (speed > vMax) speed = vMax;
    if (speed < CFG.REVERSE_MAX) speed = CFG.REVERSE_MAX;
    // 推进 s
    var advance = speed / 3.6 * dt; // km/h -> m/s
    playerS += advance;
    dist += Math.max(advance, 0);
    // —— 转向：屏幕右侧滑动（比例 -1~1）+ 键盘 ——
    var steerInput = 0;
    if (input.drag) steerInput = input.drag.lx;
    if (input.kLeft) steerInput -= 1;
    if (input.kRight) steerInput += 1;
    steerInput = clamp(steerInput, -1, 1);
    // 轮胎抓地随车速变化：低速转向钝、高速转向灵（v0.13.1：抬高低速段 0.45→0.60，起步/中速不再"转不动"）
    var grip = 0.60 + 0.40 * clamp(Math.abs(speed) / CFG.MAX_SPEED, 0, 1);
    var targetLat = steerInput * CFG.STEER_RATE * grip;
    lateralVel += (targetLat - lateralVel) * Math.min(1, dt * CFG.STEER_LAG);
    lateral += lateralVel * dt;
    // 越过路缘 = 被挡住（不会开到草地上）
    if (lateral > CFG.STEER_MAX_OFFSET) { lateral = CFG.STEER_MAX_OFFSET; if (lateralVel > 0) lateralVel = 0; }
    if (lateral < -CFG.STEER_MAX_OFFSET) { lateral = -CFG.STEER_MAX_OFFSET; if (lateralVel < 0) lateralVel = 0; }
    // 转向可视化
    var steerSig = clamp(lateralVel / CFG.STEER_RATE, -1, 1);
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
    // 无敌闪烁（座舱视角/调试隐藏时始终不可见）
    playerGrp.visible = carVisible() && !(inv > 0 && Math.floor(time * 14) % 2 === 0);
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

  /* ======== HUD：速度仪表盘 / 路线图 / 里程 ======== */
  function drawGauge() {
    if (!gaugeCtx) return;
    var S = gaugeCv.width, c = S / 2, r = c - S * 0.03, ctx = gaugeCtx;
    var a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;            // 270° 表盘
    var vr = clamp(Math.abs(speed) / CFG.MAX_SPEED, 0, 1);
    ctx.clearRect(0, 0, S, S);
    // 底盘
    ctx.beginPath(); ctx.arc(c, c, r - S * 0.03, 0, 6.284);
    ctx.fillStyle = 'rgba(8,12,22,.62)'; ctx.fill();
    ctx.lineWidth = S * 0.03; ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.stroke();
    // 弧槽
    ctx.lineWidth = S * 0.052; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(90,110,140,.42)';
    ctx.beginPath(); ctx.arc(c, c, r - S * 0.10, a0, a1); ctx.stroke();
    // 速度弧
    ctx.strokeStyle = vr > 0.82 ? '#ff4d5e' : (vr > 0.55 ? '#ffb35c' : '#37d0ff');
    ctx.beginPath(); ctx.arc(c, c, r - S * 0.10, a0, a0 + (a1 - a0) * vr); ctx.stroke();
    // 刻度
    ctx.lineWidth = Math.max(1.5, S * 0.009);
    for (var i = 0; i <= 10; i++) {
      var a = a0 + (a1 - a0) * (i / 10), ca = Math.cos(a), sa = Math.sin(a);
      var r1 = r - S * 0.055, r2 = r - (i % 5 === 0 ? S * 0.115 : S * 0.085);
      ctx.strokeStyle = (i % 5 === 0) ? 'rgba(230,240,255,.85)' : 'rgba(200,215,235,.45)';
      ctx.beginPath(); ctx.moveTo(c + ca * r1, c + sa * r1); ctx.lineTo(c + ca * r2, c + sa * r2); ctx.stroke();
    }
    // 指针
    var na = a0 + (a1 - a0) * vr;
    ctx.strokeStyle = '#ff5a6e'; ctx.lineWidth = Math.max(2.5, S * 0.016); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c - Math.cos(na) * S * 0.045, c - Math.sin(na) * S * 0.045);
    ctx.lineTo(c + Math.cos(na) * (r - S * 0.115), c + Math.sin(na) * (r - S * 0.115));
    ctx.stroke();
    ctx.beginPath(); ctx.fillStyle = '#e8f1ff'; ctx.arc(c, c, S * 0.028, 0, 6.284); ctx.fill();
    // 数字
    ctx.textAlign = 'center';
    var kmh = Math.floor(Math.abs(speed));
    ctx.fillStyle = '#ffd23f';
    ctx.font = '800 ' + Math.round(S * 0.185) + 'px system-ui,"PingFang SC",sans-serif';
    ctx.fillText(String(kmh), c, c + S * 0.245);
    ctx.fillStyle = 'rgba(190,215,240,.8)';
    ctx.font = '600 ' + Math.round(S * 0.068) + 'px system-ui,"PingFang SC",sans-serif';
    ctx.fillText('km/h', c, c + S * 0.335);
    // 倒车标识
    if (speed < -0.5) {
      ctx.fillStyle = '#ff9d2e';
      ctx.font = '800 ' + Math.round(S * 0.085) + 'px system-ui,sans-serif';
      ctx.fillText('R', c, c - S * 0.20);
    }
  }

  function drawMinimap() {
    if (!miniCtx || !trackSamples.length) return;
    var S = miniCv.width, pad = S * 0.13, ctx = miniCtx;
    ctx.clearRect(0, 0, S, S);
    if (!miniBox) {                       // 赛道包围盒（只算一次）
      var mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
      for (var i = 0; i < trackSamples.length; i++) {
        var p = trackSamples[i].p;
        if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x;
        if (p.z < mnz) mnz = p.z; if (p.z > mxz) mxz = p.z;
      }
      miniBox = { mnx: mnx, mxx: mxx, mnz: mnz, mxz: mxz };
    }
    var b = miniBox;
    var w = Math.max(b.mxx - b.mnx, 1), h = Math.max(b.mxz - b.mnz, 1);
    var k = Math.min((S - pad * 2) / w, (S - pad * 2) / h);
    var ox = (S - w * k) / 2 - b.mnx * k, oz = (S - h * k) / 2 - b.mnz * k;
    function tx(x) { return ox + x * k; }
    function ty(z) { return oz + z * k; }
    // 赛道环
    ctx.beginPath();
    for (var j = 0; j <= trackSamples.length; j++) {
      var pp = trackSamples[j % trackSamples.length].p;
      if (j === 0) ctx.moveTo(tx(pp.x), ty(pp.z)); else ctx.lineTo(tx(pp.x), ty(pp.z));
    }
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(18,26,42,.85)'; ctx.lineWidth = S * 0.075; ctx.stroke();
    ctx.strokeStyle = 'rgba(130,165,205,.6)'; ctx.lineWidth = S * 0.022; ctx.stroke();
    // AI 车
    ctx.fillStyle = '#8fd0ff';
    for (var ai = 0; ai < aiCars.length; ai++) {
      var ap = aiCars[ai].mesh.position;
      ctx.beginPath(); ctx.arc(tx(ap.x), ty(ap.z), S * 0.021, 0, 6.284); ctx.fill();
    }
    // 玩家
    if (playerGrp) {
      var gp = playerGrp.position;
      ctx.beginPath(); ctx.arc(tx(gp.x), ty(gp.z), S * 0.037, 0, 6.284);
      ctx.fillStyle = '#ff4d5e'; ctx.fill();
      ctx.lineWidth = S * 0.016; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.stroke();
    }
  }

  function updateHud(dt) {
    hudT += dt;
    score += Math.max(0, speed / 3.6 * dt) * 1.1;
    uiScore.textContent = Math.floor(score);
    if (uiGems) uiGems.textContent = gems;
    if (uiMile) uiMile.textContent = dist >= 1000 ? (dist / 1000).toFixed(2) + ' km' : Math.floor(dist) + ' m';
    // 仪表/地图 20fps 足够，省电
    if (hudT >= 0.05) { hudT = 0; drawGauge(); drawMinimap(); }
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

    // —— v0.13.2 车损：停撞 DMG_REPAIR_DELAY 秒后开始缓慢自动修复 ——
    dmgCool -= dt;
    if (dmgCool <= 0 && dmg > 0) {
      dmg -= CFG.DMG_REPAIR * dt;
      if (dmg < 0) dmg = 0;
    }
    updateDmg();
    // 车损过高 → 引擎盖持续冒烟（复用已有粒子系统，不新增渲染管线）
    if (dmg > CFG.DMG_SMOKE && playerGrp) {
      smokeT -= dt;
      if (smokeT <= 0) {
        smokeT = 0.06;
        var tg = curSeg.tan || { x: 0, z: -1 };
        var fv = speed / 3.6 * 0.9;   // 烟以 90% 车速随车漂移：略滞后 → 有拖尾感，又不会跑出视野
        // 从引擎盖上方 1.15m 冒出（车顶约 1.3m，烟必须在车体轮廓之上才看得见）
        smoke(playerGrp.position.x + tg.x * 1.2, 1.15, playerGrp.position.z + tg.z * 1.2,
              tg.x * fv, tg.z * fv);
      }
    } else { smokeT = 0; }

    // —— 粒子 ——
    for (var pi = parts.length - 1; pi >= 0; pi--) {
      var pt = parts[pi];
      pt.life -= dt;
      pt.m.position.x += pt.vx * dt;
      pt.m.position.y += pt.vy * dt;
      pt.vy += (pt.g === undefined ? -14 : pt.g) * dt;   // v0.13.2：冒烟用正 g（上浮）而非碎片重力
      pt.m.position.z += pt.vz * dt;
      pt.m.rotation.x += dt * 8; pt.m.rotation.y += dt * 6;
      if (pt.smoke) {                                    // 冒烟：膨胀 + 随寿命淡出
        pt.m.scale.multiplyScalar(1 + dt * 1.6);
        pt.m.material.opacity = Math.max(0, pt.life / pt.maxLife) * 0.5;
      }
      if (pt.life <= 0) {
        scene.remove(pt.m);
        if (pt.m.geometry) pt.m.geometry.dispose();      // v0.13.2：补上泄漏的几何/材质释放
        if (pt.m.material) pt.m.material.dispose();
        parts.splice(pi, 1);
      }
    }

    // —— HUD：仪表盘 / 路线图 / 里程 ——
    updateHud(dt);
    Audio.engineSpeed(ratio / 1.42 + 0.08);
    // —— 云层缓慢漂移 ——
    for (var ci = 0; ci < clouds.length; ci++) {
      var cl = clouds[ci];
      cl.position.x += 2.2 * dt;
      if (cl.position.x > 760) cl.position.x = -760;
    }

    updateCamera(dt);
    flushPopups();
  }

  /* —— v0.13.2 碰撞 → 车损（不再"一撞就掉命"）——
     伤害按「相对接近速度」分级：
       纵向接近 = 玩家速度 − AI 速度（AI 世界速度为 speed * a.ratio）
       横向接近 = 侧向速度（变道擦挂）
     轻擦侧碰 ≈ 6~15，全速追尾 ≈ 20~45；累计满 CFG.DMG_MAX(100) 才扣 1 条命并清零。
     ⚠️ 旧版 bug：这里只做了 lives -= 1，却从未调用 updateLives()，
        导致心形 HUD 永远停在 3 颗（界面不随实际生命变化）。
     现在改为在掉命时调用 updateLives(true) 触发跳动反馈。 */
  function onHit(a, cdx) {
    var relKmh = Math.abs(speed - speed * (a && a.ratio ? a.ratio : 0.6)); // 纵向接近速度 km/h
    var latKmh = Math.abs(lateralVel) * 3.6;                               // 横向接近速度 km/h
    var impact = relKmh + latKmh * CFG.DMG_LAT;
    var gain = clamp(CFG.DMG_MIN + impact * CFG.DMG_PER_KMH, CFG.DMG_MIN, CFG.DMG_MAXHIT);
    var w = (gain - CFG.DMG_MIN) / (CFG.DMG_MAXHIT - CFG.DMG_MIN);         // 撞击强度 0~1
    dmg += gain;
    dmgCool = CFG.DMG_REPAIR_DELAY;      // 重置自动修复倒计时

    inv = CFG.INVINCIBLE;
    shake = Math.max(shake, 6 + 7 * w); flash = Math.max(flash, 0.30 + 0.30 * w);
    Audio.crash();
    vib(60 + Math.round(60 * w));
    speed *= CFG.HIT_DROP;
    var dir = cdx >= 0 ? -1 : 1;
    lateral += dir * (1.0 + 1.2 * w);
    if (lateral > CFG.STEER_MAX_OFFSET) lateral = CFG.STEER_MAX_OFFSET;
    if (lateral < -CFG.STEER_MAX_OFFSET) lateral = -CFG.STEER_MAX_OFFSET;
    comboN = 0; comboT = 0;
    burst(a.mesh.position.x, 0.7, a.mesh.position.z, 10 + Math.round(8 * w));

    // 车损满 → 掉 1 条命、车损清零（清零而非归零到溢出值，避免连续掉命）
    if (dmg >= CFG.DMG_MAX) {
      dmg -= CFG.DMG_MAX;
      lives -= 1;
      updateLives(true);
      flash = Math.max(flash, 0.62); shake = Math.max(shake, 13);
      vib(140);
      updateDmg();
      if (lives <= 0) { gameOver(); return; }
    }
    updateDmg();
  }

  function gameOver() {
    state = 'over'; overT = 0;
    Audio.stopEngine(); Audio.crash(); vib(90);
    if (playerGrp) playerGrp.visible = carVisible();
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
    /* ⚠️ v0.13.0 修复：dt 必须钳制在 [0, 0.05]。
       旧写法 Math.min((ts-lastTm)/1000 || 0.016, 0.05) 没有下限：
       ts 小于 lastTm 时（首帧时钟基准不一致 / 后台切回 / 系统时间被调整）
       会得到 **负数 dt**，于是 `flash -= dt`、`inv -= dt`、`time += dt`
       全部反向累加 —— 表现为"什么都没撞却整屏闪红"。
       现在负数/非法一律回落 0.016，并封顶 0.05（防长卡顿后瞬移）。 */
    var rawDt = (ts - lastTm) / 1000;
    if (!isFinite(rawDt) || rawDt <= 0) rawDt = 0.016;
    var dt = Math.min(rawDt, 0.05);
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
      updateHud(dt);
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
  // v0.13.2：生命值改用 CFG.LIVES；pulse=true 时心形跳动一下（掉命反馈）
  function updateLives(pulse) {
    if (!uiLives) return;
    uiLives.innerHTML = '';
    for (var i = 0; i < CFG.LIVES; i++) {
      var h = document.createElement('div');
      h.className = 'heart' + (i < lives ? '' : ' off');
      uiLives.appendChild(h);
    }
    if (pulse) {
      var hs = uiLives.children;
      for (var k = 0; k < hs.length; k++) {
        hs[k].classList.add('hit');
        (function (el) { setTimeout(function () { el.classList.remove('hit'); }, 460); })(hs[k]);
      }
    }
  }

  // v0.13.2：车损条。只在百分比真正变化时写 DOM，避免每帧触发重排
  var __dmgShown = -1;
  function updateDmg() {
    if (!uiDmgFill) return;
    var pct = Math.round(clamp(dmg, 0, CFG.DMG_MAX) / CFG.DMG_MAX * 100);
    if (pct === __dmgShown) return;
    __dmgShown = pct;
    uiDmgFill.style.width = pct + '%';
    if (uiDmgWrap) uiDmgWrap.className = (pct >= CFG.DMG_SMOKE) ? 'danger' : '';
  }

  function startRun() {
    if (!SUPPORTED) return;
    Audio.ensure();
    menu.classList.add('hidden'); over.classList.add('hidden');
    playerS = 0; // 每局从赛道起点开始
    resetRun();
    if (playerGrp) { playerGrp.visible = carVisible(); }
    state = 'run';
    setViewVisible(true);
    if (playerGrp) { playerGrp.visible = carVisible(); }   // state 已切到 run，座舱视角此处再收敛一次
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
      // 调试：?dump=1 输出赛道采样诊断（段长异常 / 起点附近采样与朝向）
      if (/[?&]dump=1\b/.test(location.search)) {
        var segs = [], mxS = 0, mxi = 0;
        for (var di = 0; di < trackSamples.length; di++) {
          var a1 = trackSamples[di].p, b1 = trackSamples[(di + 1) % trackSamples.length].p;
          var dd1 = a1.distanceTo(b1); segs.push(dd1);
          if (dd1 > mxS) { mxS = dd1; mxi = di; }
        }
        var avgS = totalLen / trackSamples.length, outs = [];
        for (var oi = 0; oi < segs.length; oi++) if (segs[oi] > avgS * 2.5) outs.push(oi + ':' + segs[oi].toFixed(1));
        window.__diagLog('[ERR] DUMP avg=' + avgS.toFixed(2) + ' max=' + mxS.toFixed(2) + '@' + mxi +
          ' L=' + totalLen.toFixed(1) + ' N=' + trackSamples.length + ' outliers[' + outs.join(',') + ']');
        var near2 = [];
        for (var ni = -3; ni <= 3; ni++) {
          var ii = ((ni % trackSamples.length) + trackSamples.length) % trackSamples.length;
          var sm3 = trackSamples[ii];
          near2.push(ii + 'p(' + sm3.p.x.toFixed(1) + ',' + sm3.p.z.toFixed(1) + ')r(' + sm3.right.x.toFixed(2) + ',' + sm3.right.z.toFixed(2) + ')');
        }
        window.__diagLog('[ERR] NEAR ' + near2.join(' '));
      }
      buildScene();
      buildCityBlocks();
      playerGrp = playerCar();
      scene.add(playerGrp);
      seatCam = new THREE.Object3D();
      seatCam.position.copy(CFG.COCKPIT_OFFSET);
      seatCam.rotation.x = -0.05;   // v6.0：略微下俯，越过引擎盖看清前方路面（不俯太多以免车身占满画面）
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
      if (/[?&]autostart=1\b/.test(location.search)) { Audio.ensure(); startRun(); }  // 同步启动（headless 截图验证用；60ms 定时器在 headless 会被节流）
      // 调试：?gas=1 持续油门（配合 autostart 做自动化画面验证）
      if (/[?&]gas=1\b/.test(location.search)) input.gas = true;
      // 调试：?dmg=N 预设车损值（headless 定点验证 车损条/冒烟/danger 红条 状态）
      var dm0 = /[?&]dmg=(\d+)/.exec(location.search);
      if (dm0) { dmg = clamp(parseInt(dm0[1], 10) || 0, 0, CFG.DMG_MAX); __dmgShown = -1; updateDmg(); }
      // 调试：?ff=N 快进 N 秒。无头 Chrome 在页面 load 完成时立即截图（拿不到"运行中"的画面），
      //       这里同步跑 N*60 帧把车开到中途，用于离线验证 速度/里程/仪表盘/路线图/转弯 是否真的动。
      var ffm = /[?&]ff=(\d+)/.exec(location.search);
      if (ffm && state === 'run') {
        var ffs = Math.min(parseInt(ffm[1], 10) || 0, 180);
        for (var fi = 0; fi < ffs * 60; fi++) update(1 / 60);
      }
      // 调试：?hide=car|gem|post|prop 逐组排除（定位"画面里的陌生几何"）
      if (/[?&]hide=car\b/.test(location.search) && playerGrp) { playerGrp.visible = false; carHiddenByDebug = true; }
      // 调试：?inspect=1 列出玩家周围 45m 内的场景对象（含 Sprite/InstancedMesh）+ 索引
      if (/[?&]inspect=1\b/.test(location.search) && playerGrp) {
        var out2 = [];
        scene.children.forEach(function (o, idx) {
          var bx3 = new THREE.Box3();
          try { bx3.setFromObject(o); } catch (e4) { return; }
          if (!isFinite(bx3.min.x)) return;
          var ct3 = bx3.getCenter(new THREE.Vector3()), sz3 = bx3.getSize(new THREE.Vector3());
          var d3 = ct3.distanceTo(playerGrp.position);
          if (d3 - sz3.length() / 2 < 45) {
            out2.push(idx + ':' + o.type + (o.geometry ? '/' + o.geometry.type : '') +
              (o.material ? ('#' + (o.material.color ? o.material.color.getHexString() : '-') + (o.material.vertexColors ? 'VC' : '') + (o.material.map ? 'MAP' : '')) : '') +
              ' sz' + sz3.x.toFixed(0) + 'x' + sz3.y.toFixed(0) + 'x' + sz3.z.toFixed(0) + ' d' + d3.toFixed(0));
          }
        });
        window.__diagLog('[ERR] LIST(' + scene.children.length + ') ' + out2.join(' | '));
      }
      // 调试：?only=N（只显示索引 N 的对象 + 路面 23；灯光始终保留）——单个对象逐一确认
      var on3 = /[?&]only=(\d+)/.exec(location.search);
      if (on3) {
        var keep3 = +on3[1];
        scene.children.forEach(function (o, i) {
          if (o.isLight) return;
          o.visible = (i === keep3 || i === 23);
        });
      }
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