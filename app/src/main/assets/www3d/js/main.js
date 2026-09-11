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
    /* v0.13.3 转向死区：归一化位移（-1~1，1 = 打满）小于此值一律当 0。
       手指按住不放时的生理抖动约 3~8px，在 880 宽手机上相当于归一化 0.04~0.09，
       旧版会被当成"轻微转向"→ 车自己慢慢漂向一边（玩家以为是"跑偏"）。
       注意：死区【不是】简单截断，而是把剩余行程重新拉伸回 0~1
       （见 steerDead()），所以打满所需滑动距离不变、中段响应反而更跟手，
       不会抵消 v0.13.1 那次"提高转向灵敏度"的改动。 */
    STEER_DEAD: 0.07,
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
    /* ======== v0.13.4 统一大气透视（C 包第 1 步·重做）========

       【上一版（v0.13.3）为什么反而更假 —— 诊断】
       修好贴图色彩空间后，颜色回到正确饱和度，于是暴露出一件一直被
       "贴图偏亮"糊住的事：场景根本没有纵深。实测证据：
         · 左侧那座山在屏幕上 y=80..250 连续 170px 全是同一个值 #527090，
           相邻亮度变化 0.0 —— 因为它同时踩了两个坑：
           ConeGeometry(r,h,5) + flatShading（5 边形锥体每面只有一个法线，
           整面一个颜色）以及 fog:false（连雾都不参与）。山不是山，是纸片。
         · shadowMap / castShadow / receiveShadow 在 3800 行代码里出现 0 次。
         · 抽样 0.30% 的像素有通道 ≥254（高光直接削顶）。

       【真正的病根：三套互不兼容的"距离规则"】
         山          fog:false                → 完全不衰减，800m 外和 50m 一样饱和
         城市/草地/路面 THREE.Fog(130→980)    → 线性淡出，980m 外全是同一块死色
         云/太阳/天空  fog:false                → 完全不衰减
       三条不同形状的曲线拼在一张画面上，眼睛读到的就是"拼贴"。
       真实世界只有【一条】曲线：越远 → 越淡、越低饱和、越接近地平线色。

       【本版做法：一条公式，所有远景共用】
         atmFactor(d) = 1 - exp(-(density·d)²)      ← 与 THREE.FogExp2 内部公式逐字一致
         能按顶点算距离的（草地/路面/城市/植被）→ 交给 scene.fog = FogExp2
         距离是固定已知的（远山/云）→ 用 atmColor() 把同一个 factor 烘焙进颜色
       两条路径用同一个 density、同一个地平线色 → 视觉上是同一条曲线。
       ⚠️ 远山保持 fog:false 是【故意的】：烘焙已经包含了大气衰减，
          再让 FogExp2 叠一次就是双重雾化，远山会被吃没。

       【雾色必须等于天空地平线色】
         否则远处草地被染成雾色后，会在地平线处与天空撞出一条浅色横带。

       调试开关：
         ?atm=off     关闭大气衰减（远山恢复满饱和，用于 A/B 对照）
         ?hide=mtn    不要远山      ?hide=cloud  不要云      ?hide=sky 露出背景色
         ?tm=aces|reinhard|cineon|linear|none   切换色调映射
         ?exp=N       灯光总曝光     ?texp=N      色调映射曝光 */
    FOG_COLOR: 0xd8e9f6,
    SKY_HORIZON: 0xd8e9f6,              // ← 必须与 FOG_COLOR 同色（改一处请改两处）
    SKY_ZENITH: 0x1a5cb0,               // 天顶深蓝（渐变起点）
    /* 大气密度：FogExp2 的 density。取值实测标定（factor = 1-exp(-(d·k)²)）：
       k=0.0011 时  440m→0.24   1000m→0.72   2000m→0.99
       这样近景（<300m，factor<0.10）几乎不受影响，远山则逐层化进天空。 */
    ATM_DENSITY: 0.0011,
    /* 远山最多向地平线色混合 95%，留 5% 本色 → 最远那层仍然"看得出是山"，
       而不是彻底消失成一片平色。 */
    ATM_MAX: 0.95,
    /* 大气同时降饱和：真实霾不只变淡，还会把颜色抽掉。0.65 = 最远处保留 35% 饱和度 */
    ATM_DESAT: 0.65,
    /* 云朵数量（分大中小三层，见 buildScene）。?hide=cloud 可排除 */
    CLOUD_N: 22,
    /* —— 影像管线：色调映射 ——
       旧版完全没开 tone mapping，高光在 1.0 处硬削平：云是"一抹纯白"、
       天空是"一块平蓝"，没有任何明暗过渡。开 ACES 后高光滚降，
       云才有体积感、天空才有亮度层次。
       ACES 会整体抬亮中间调（约 ×1.5）并压暗高光，所以灯光曝光要相应回调
       ——两者是耦合的，改一个要同时看另一个（下面 EXPOSURE 已按实测重标）。
       可选值：aces / reinhard / cineon / linear / none（?tm= 覆盖） */
    TONEMAP: 'aces',
    TM_EXPOSURE: 1.0,
    /* —— v0.13.3 灯光总曝光补偿 ——
       修好贴图色彩空间后，所有"贴图面"（草地/路面/楼宇）不再被多提亮一次，
       于是暴露出一个一直存在、只是被掩盖的问题：**灯光本身是偏暗的**。
       实测：朝上的表面最终亮度只有自身反照率的 ~0.72 倍，
       也就是沥青贴图设计值 #35383e 实际只渲成 #1d1f24（近黑）。
       注意车漆用的是 Color（一直转换正确），所以旧版是
       "车颜色对、场景偏亮" —— 两个错误互相抵消，看起来才"正常"。
       现在把两处都修正，用同一个曝光系数把灯光抬到
       "表面渲染值 ≈ 反照率设计值"（草地 #5f9d47、沥青 #35383e、线 #eef2f7）。
       1.5 是实测得出的档位：草地渲成 #5c9645（设计值 #5f9d47），
       即"画成什么色就显示什么色"。
       只乘一个标量、不改变各光源之间的比例，也不动颜色/天空。
       调试：?exp=N 可临时覆盖（不填 = 用 CFG.EXPOSURE）。 */
    EXPOSURE: 1.5,
    AI_SPEED_MIN: 0.42, AI_SPEED_MAX: 0.72,
    GYRO_YAW_RANGE: 0.55, GYRO_PITCH_RANGE: 0.30,
    /* v0.13.3：GROUND_R 1100 → 2200。
       旧值下草地面片是 ±1100m 的正方形；相机最远会离原点约 300m，
       于是朝原点那一侧的草地边缘只有 800m —— 而 FOG_FAR = 980m，
       意思是"还没完全化进雾里，地面就没了"，地平线处会露出一条淡绿色的边。
       现在边缘最近也有 1900m，永远晚于 FOG_FAR 被雾吃掉，接缝彻底消失。
       面片只有 2 个三角形，放大不增加任何开销。 */
    SKY_R: 800, GROUND_R: 2200, BACKDROP_R: 760, BACKDROP_H: 320
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
  /* v0.13.3：转向死区（带重新拉伸）。
     旧写法（直接 clamp 到 ±1）在手指微抖时会输出 0.05 之类的微小转向量，
     车会缓慢漂向一边。这里在死区内归零，死区外把 [dead,1] 线性映射回 [0,1]，
     所以"打满仍需同样滑动距离"，只是把死区那段无效行程删掉了。 */
  function steerDead(v) {
    var a = v < 0 ? -v : v;
    if (a <= CFG.STEER_DEAD) return 0;
    var y = (a - CFG.STEER_DEAD) / (1 - CFG.STEER_DEAD);
    if (y > 1) y = 1;
    return v < 0 ? -y : y;
  }
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
  // v0.13.3：天空组件（天空球 + 太阳光晕 + 云）—— 整体跟随相机，见 updateSky()
  var skyGrp = null;
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
  var deadOff = /[?&]dead=0\b/.test(location.search);   // 调试：?dead=0 关闭转向死区（A/B 对比用）

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
    var rawLx = clamp((t.clientX - input.drag.sx) / Math.max(W * CFG.STEER_SWIPE, CFG.STEER_SWIPE_MIN), -1, 1);
    // v0.13.3：先过转向死区（去手指抖动），再做比例转向
    input.drag.lx = deadOff ? rawLx : steerDead(rawLx);
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
  /* v0.13.3 调试开关（C 包 / 天空步骤）：
     ?hide=cloud 排除云层（用来单独确认天空渐变本身是对的，而不是被云洗白）
     ?hide=sky   排除天空球（露出 scene.background，判断地平线色是否吻合） */
  var hideCloud = /[?&]hide=cloud\b/.test(location.search);
  var hideSky = /[?&]hide=sky\b/.test(location.search);
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
    addBlobShadow(g, 2.6, 5.1, 0.025);          // v0.13.5：车身投影（玩家/AI 共用 makeSupercar）
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

  /* ======== v0.13.3 色彩空间修复（C 包 / 第 1 步的根因）========
     【问题】画面整体"发灰、发白、不高级"，尤其草地和天空像蒙了一层白纱。
     【根因】CanvasTexture 没有声明 colorSpace。
       本工程用的是 three r15x（UMD 版），其中：
         · ColorManagement.enabled 默认 = true（实测反编译确认 `enabled:!0`）
         · 渲染器 outputColorSpace 默认 = SRGBColorSpace
         · 但 Texture.colorSpace 默认 = NoColorSpace（= 按"线性值"采样！）
       于是：画布里按 sRGB 写好的颜色 → 被当成线性值送进着色器 →
       输出时又被编码一次 sRGB → 相当于**多做了一次提亮**。
       实测：草地基色 #5f9d47 实际渲染成 #a5cd91（惨白黄绿）；
             天空 v=0.40 处的 #82bdea 渲染成 #bcdef6（几乎白掉）。
     【铁证】同一盏灯下，车漆用的是 `new THREE.Color(0xd40000)`（Color 走
       ColorManagement，转换正确）→ 车是正常的深红；而草地/路面/楼宇走贴图
       → 明显偏白。同样的光、同样的材质模型，颜色却差一档，只能是贴图解码错了。
     【修法】所有当"颜色"用的 CanvasTexture 显式标 sRGB，让采样时先解码回线性，
       输出再编码回 sRGB → 一来一回正好等于画布里写的颜色（渲染值 = 设计值）。
     注意：`scene.background = new THREE.Color(hex)` 本来就正确（实测
       0xd8e9f6 渲染出来逐位等于 #d8e9f6），所以本修复只动贴图，不动灯光/颜色常量。
     ?cs=legacy 调试开关：退回旧行为，用于 A/B 对比。
     ============================================================ */
  var csLegacy = /[?&]cs=legacy\b/.test(location.search);
  function srgb(t) {
    try {
      if (!csLegacy && t && THREE.SRGBColorSpace && typeof t.colorSpace !== 'undefined') {
        t.colorSpace = THREE.SRGBColorSpace;
      }
    } catch (e) { /* 老版本 three 没有 colorSpace，忽略 */ }
    return t;
  }

  /* ======== v0.13.4 统一大气透视 ========
     全场景【唯一】的距离衰减函数。任何物体想知道"我离视点 d 米，该被大气
     冲淡多少"，都只能问这一个函数 —— 这是解决"拼贴感"的核心约束。

     ⚠️ atmFactor 的公式必须与 THREE.FogExp2 内部实现逐字一致：
        FogExp2 的 GLSL 是  fogFactor = 1.0 - exp(-fogDensity² · fogDepth²)
        写成 JS 就是        1 - exp(-(density·d)²)
     两条路径（逐顶点算 & 颜色烘焙）用同一条公式、同一个 density，
     视觉上才是同一条曲线。改动这里必须同步检查 CFG.ATM_DENSITY。 */
  var atmOff = /[?&]atm=off\b/.test(location.search);   // 调试：?atm=off 关闭大气衰减
  var atmHorizon = new THREE.Color(CFG.SKY_HORIZON);   // 雾/地平线色（线性工作空间）

  function atmFactor(d) {
    if (atmOff) return 0;
    var x = CFG.ATM_DENSITY * (d > 0 ? d : 0);
    return 1 - Math.exp(-x * x);
  }

  /* 把一个"本色"按距离烘焙成"大气后的颜色"。
     baseHex 是设计色（sRGB 十六进制，交给 THREE.Color 做 sRGB→线性 转换，
     与车漆同一条正确路径）；dist 是该物体到视点的代表距离。
     做两件事：①向地平线色靠拢 ②降饱和。
     真实霾不只是"变白"，它是把颜色一起抽走，所以第②步不可省。 */
  function atmColor(baseHex, dist) {
    var c = new THREE.Color(baseHex);
    if (atmOff) return c;
    var f = atmFactor(dist);
    c.lerp(atmHorizon, f * CFG.ATM_MAX);
    var s = 1 - CFG.ATM_DESAT * f;
    var lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    c.r = lum + (c.r - lum) * s;
    c.g = lum + (c.g - lum) * s;
    c.b = lum + (c.b - lum) * s;
    return c;
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
    scene.background = new THREE.Color(CFG.SKY_HORIZON);
    /* v0.13.4：线性 Fog(近,远) → FogExp2(密度)。
       线性雾的问题是"120m 开始、980m 结束"这两条硬边界：
       980m 之外不管多远都渲染成同一块纯色板，远山/云又完全不吃雾，
       于是画面被切成几段互不衔接的色块。
       FogExp2 全距离连续可导，近景几乎不受影响、远景平滑化进天空。 */
    scene.fog = new THREE.FogExp2(CFG.FOG_COLOR, CFG.ATM_DENSITY);

    camera = new THREE.PerspectiveCamera(CFG.FOV, W / H, 0.1, 2400);
    camFov = CFG.FOV;
    renderer = createRenderer();
    if (!renderer) throw new Error('WebGLRenderer 创建失败（WebGL 上下文不可用）');
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.setSize(W, H);

    /* —— v0.13.4 影像管线：色调映射（必须在材质编译之前设置）——
       旧版 renderer.toneMapping 始终保持默认的 NoToneMapping，
       于是所有超过 1.0 的线性亮度被直接削平：云的顶部、太阳光晕、
       白色车身都会变成一片没有细节的纯白；天空的亮度层次也被压掉。
       开启后高光沿曲线滚降，云和天空重新获得明暗过渡。
       用 try 包住：万一打包版本没有某个常量就退回 none，不让整屏黑掉。 */
    var TMM = /[?&]tm=(\w+)/.exec(location.search);
    var tmName = TMM ? TMM[1] : CFG.TONEMAP;
    var tmConst = THREE.NoToneMapping;
    try {
      if (tmName === 'aces' && THREE.ACESFilmicToneMapping !== undefined) tmConst = THREE.ACESFilmicToneMapping;
      else if (tmName === 'reinhard' && THREE.ReinhardToneMapping !== undefined) tmConst = THREE.ReinhardToneMapping;
      else if (tmName === 'cineon' && THREE.CineonToneMapping !== undefined) tmConst = THREE.CineonToneMapping;
      else if (tmName === 'linear' && THREE.LinearToneMapping !== undefined) tmConst = THREE.LinearToneMapping;
      renderer.toneMapping = tmConst;
      var TEO = /[?&]texp=([\d.]+)/.exec(location.search);
      renderer.toneMappingExposure = TEO ? (parseFloat(TEO[1]) || 1) : CFG.TM_EXPOSURE;
    } catch (eTm) {
      renderer.toneMapping = THREE.NoToneMapping;
      if (window.__diagLog) window.__diagLog('色调映射不可用，已退回 none');
    }

    initCarMats();

    // 程序化环境反射（canvas 渐变，无外部图片；让车漆有光泽）
    try {
      var cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
      var cx = cv.getContext('2d');
      var gr = cx.createLinearGradient(0, 0, 0, 32);
      gr.addColorStop(0, '#b9d6ff'); gr.addColorStop(0.42, '#dcedff'); gr.addColorStop(0.5, '#f6f9fd');
      gr.addColorStop(0.54, '#c8d9b2'); gr.addColorStop(0.75, '#57794b'); gr.addColorStop(1, '#33503a');
      cx.fillStyle = gr; cx.fillRect(0, 0, 64, 32);
      var envTex = srgb(new THREE.CanvasTexture(cv)); envTex.mapping = THREE.EquirectangularReflectionMapping;
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
    /* v0.13.3：整套灯光乘同一个曝光系数 EXPOSURE（见 CFG 注释）。
       只缩放总强度、不改变比例，所以原本的光照关系完全保留。
       天空球/云/太阳光晕用的是 Basic/Sprite（不受灯光影响），
       所以抬曝光只会把"被照亮的实体"提到正常亮度，天空保持设计色。 */
    var EO = /[?&]exp=([\d.]+)/.exec(location.search);
    var EXP = EO ? (parseFloat(EO[1]) || 1) : CFG.EXPOSURE;
    scene.add(new THREE.AmbientLight(0xffffff, 0.55 * EXP));
    var sun = new THREE.DirectionalLight(0xfff2d8, 1.15 * EXP); sun.position.set(80, 120, 40); scene.add(sun);
    var fill = new THREE.DirectionalLight(0x9fc8ff, 0.35 * EXP); fill.position.set(-60, 30, -50); scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a4a33, 0.55 * EXP));

    /* —— v0.13.3 天空（C 包 / 第 1 步）——
       ⚠️ 关键修复：整个天空组件（天空球 + 太阳光晕 + 云）必须【跟随相机】。
         旧版把天空球写死在原点 (0,-30,0)，而赛道环直径数百米：
         车一开远，相机就偏离球心几百米，看到的只是球面上很小的一块，
         渐变被彻底"拉平"——实测帧内天空色差只有 #a3d1f1 → #acd5f3
         （ΔRGB ≈ 7/3/1，肉眼完全看不出层次，天空就是一块死板的浅蓝）。
         改为每帧把 skyGrp 对齐到相机（见 updateSky()），球心 = 视点，
         于是球面 UV 真正等于「仰角」，地平线永远精确落在 v=0.5。
       画布 v 轴约定：0 = 天顶，0.5 = 地平线，1 = 对地（被草地挡住）。
       ============================================================ */
    skyGrp = new THREE.Group();
    skyGrp.name = 'sky';
    scene.add(skyGrp);

    var skyCv = document.createElement('canvas'); skyCv.width = 8; skyCv.height = 256;
    var sx = skyCv.getContext('2d');
    var sg = sx.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0.00, '#1a5cb0');   // 天顶：深蓝
    sg.addColorStop(0.20, '#2f7ac8');
    sg.addColorStop(0.32, '#57a0dd');   // ≈ 画面上沿（仰角 ~30°）
    sg.addColorStop(0.42, '#8dc4ed');
    sg.addColorStop(0.47, '#bdddf3');   // 地平线雾带外沿
    sg.addColorStop(0.50, '#d8e9f6');   // ← 地平线 = 雾色（须与 CFG.FOG_COLOR 同色）
    sg.addColorStop(0.54, '#cde1ef');
    sg.addColorStop(1.00, '#aebfcd');   // 对地：略偏灰，避免抬头看到刺眼的亮底
    sx.fillStyle = sg; sx.fillRect(0, 0, 8, 256);
    var skyTex = srgb(new THREE.CanvasTexture(skyCv));
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(CFG.SKY_R, 32, 20),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false })
    );
    sky.name = 'skyDome';
    sky.renderOrder = -1000;
    if (!hideSky) skyGrp.add(sky);   // 位置由 updateSky() 每帧对齐相机

    /* —— v6.0 太阳：径向渐变光晕 Sprite（与主平行光同方向） —— */
    try {
      var sunCv = document.createElement('canvas'); sunCv.width = sunCv.height = 128;
      var ux = sunCv.getContext('2d');
      var rg = ux.createRadialGradient(64, 64, 2, 64, 64, 64);
      rg.addColorStop(0, 'rgba(255,255,245,1)'); rg.addColorStop(0.16, 'rgba(255,247,214,.95)');
      rg.addColorStop(0.40, 'rgba(255,230,168,.34)'); rg.addColorStop(1, 'rgba(255,222,150,0)');
      ux.fillStyle = rg; ux.beginPath(); ux.arc(64, 64, 64, 0, 6.284); ux.fill();
      var sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: srgb(new THREE.CanvasTexture(sunCv)), fog: false, depthWrite: false, transparent: true
      }));
      sunSpr.scale.set(210, 210, 1);
      sunSpr.position.copy(new THREE.Vector3(80, 120, 40).normalize().multiplyScalar(CFG.SKY_R * 0.88));
      skyGrp.add(sunSpr);   // v0.13.3：挂到天空组件（随相机，方向保持不变）
    } catch (eSun) { /* 忽略 */ }

    /* —— v6.0 云层：柔和云朵 Sprite 缓慢漂移（v0.13.3：挂天空组件并推远）——
       旧版云挂在世界原点、半径 150~670；车开远后云会被"甩在后面"并从
       视野左侧飞过，看起来像贴脸飘过的棉花。现在随相机一起移动（即
       "无穷远的云层"），并把半径推到 300~700、高度 150~380，
       保证整朵云都在天空球（R=800）内部。 */
    try {
      var clCv = document.createElement('canvas'); clCv.width = 256; clCv.height = 128;
      var lx = clCv.getContext('2d');
      for (var ci2 = 0; ci2 < 34; ci2++) {
        var cx2 = 34 + Math.random() * 188, cy2 = 40 + Math.random() * 46, rr2 = 16 + Math.random() * 34;
        var cg2 = lx.createRadialGradient(cx2, cy2, 0, cx2, cy2, rr2);
        cg2.addColorStop(0, 'rgba(255,255,255,.95)'); cg2.addColorStop(0.55, 'rgba(255,255,255,.55)');
        cg2.addColorStop(1, 'rgba(255,255,255,0)');
        lx.fillStyle = cg2; lx.beginPath(); lx.arc(cx2, cy2, rr2, 0, 6.284); lx.fill();
      }
      /* v0.13.4：给云朵叠一层"顶亮底灰"的垂直渐变（source-atop 只作用于
         已有的云像素）。旧版云是一团均匀的白色径向渐变，在屏幕上就是
         "抹开的涂改液"——没有体积。真实云层顶部受光最亮、底部是灰蓝色
         的阴影，这层渐变是让云"立起来"的关键，成本为零。 */
      lx.globalCompositeOperation = 'source-atop';
      var clSh = lx.createLinearGradient(0, 22, 0, 120);
      clSh.addColorStop(0, 'rgba(255,255,255,0)');
      clSh.addColorStop(0.42, 'rgba(219,230,243,.34)');
      clSh.addColorStop(0.78, 'rgba(166,187,212,.78)');
      clSh.addColorStop(1, 'rgba(139,162,190,.92)');
      lx.fillStyle = clSh; lx.fillRect(0, 0, 256, 128);
      lx.globalCompositeOperation = 'source-over';
      var clTex = srgb(new THREE.CanvasTexture(clCv));
      /* 三层云，按"真实天空的分布"排：
           tier 0 头顶小云   — 近、高、边缘清晰、最实
           tier 1 中层云     — 中等距离与高度
           tier 2 地平线云带 — 远、低、大而淡，且被大气染向地平线色
         旧版只有一个尺寸档（200~500）且全部 opacity 0.62~0.86，
         结果每朵都是同样大小、同样浓的白斑，天空没有层次。 */
      var clTiers = [
        { rad: [150, 300], y: [210, 360], sc: [90, 190], op: 0.76, haze: 0.0 },
        { rad: [280, 490], y: [140, 240], sc: [220, 380], op: 0.58, haze: 0.22 },
        { rad: [460, 700], y: [88, 152], sc: [400, 660], op: 0.40, haze: 0.5 }
      ];
      for (var ci3 = 0; !hideCloud && ci3 < CFG.CLOUD_N; ci3++) {
        var tier = clTiers[ci3 % clTiers.length];
        var sprMat = new THREE.SpriteMaterial({
          map: clTex, fog: false, depthWrite: false, transparent: true, opacity: tier.op
        });
        /* 低空的云退向地平线色 —— 用的是同一个 atmColor 思路，
           所以云的"远"和山的"远"是同一套色阶，不会各说各话 */
        sprMat.color = new THREE.Color(0xffffff).lerp(atmHorizon, tier.haze);
        var spr = new THREE.Sprite(sprMat);
        var ang2 = Math.random() * 6.283;
        var rad2 = tier.rad[0] + Math.random() * (tier.rad[1] - tier.rad[0]);
        var yy = tier.y[0] + Math.random() * (tier.y[1] - tier.y[0]);
        spr.position.set(Math.cos(ang2) * rad2, yy, Math.sin(ang2) * rad2);
        var sc = tier.sc[0] + Math.random() * (tier.sc[1] - tier.sc[0]);
        spr.scale.set(sc, sc * 0.46, 1);
        skyGrp.add(spr); clouds.push(spr);
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
    var grTex = srgb(new THREE.CanvasTexture(grCv));
    grTex.wrapS = grTex.wrapT = THREE.RepeatWrapping;
    /* v0.13.3：贴图平铺密度按"每格 15.7m"固定推导（原来硬编码 140 次，
       配合 GROUND_R 1100 正好 15.7m/格）。这样以后改 GROUND_R 草地颗粒
       大小也不会跟着变。 */
    grTex.repeat.set(CFG.GROUND_R * 2 / 15.7, CFG.GROUND_R * 2 / 15.7);
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

    /* —— v0.13.4 远山：3 层 → 7 层大气分层 ——
       旧版 3 层只够表达"近/中/远"三档，层与层之间必然留下空档；再加
       flatShading（5 边形锥体每面一个法线）+ 每面单色 + fog:false，
       每座山在屏幕上就是一大块纯色（实测连续 170px 同一个 #527090）。
       现在：
         ① 7 层，半径 440 → 2000m 连续递增，层间互相重叠 → 形成"山脊线"
            而不是"一排孤立的金字塔"。每层实例数刻意取到让圆周上相邻两座
            相接（πR/n ≤ 锥半径），否则层内会有缝、露出下一层。
         ② 半径越大 → 山越高越宽（真实山脉远处显得更雄伟，不是更小）。
         ③ 颜色不再手写三组配色，交给 atmColor(base, 半径)：
            越远越淡、越低饱和，由那一条统一曲线自动生成。
         ④ 关掉 flatShading、辐射段 5 → 7：山体内部有受光面→背光面的
            明暗过渡，不再是一块平色。
         ⑤ InstancedMesh：整层一次绘制调用（7 次 vs 约 168 次），
            逐实例颜色走 setColorAt（±7% 微扰，同一层也不能是同一色号）。
       ⚠️ frustumCulled = false 是必须的：InstancedMesh 的包围球按"基础几何"
          计算，不含实例位置，保持默认会让整层被误剔除 → 远山成片消失。 */
    var hideMtn = /[?&]hide=mtn\b/.test(location.search);   // 调试：排除远山
    var MTN_RINGS = [
      { r: 440, h: [40, 85], cr: [56, 88], n: 24, base: 0x4f6a4d },
      { r: 560, h: [55, 110], cr: [66, 100], n: 26, base: 0x546e52 },
      { r: 700, h: [75, 155], cr: [82, 125], n: 26, base: 0x5e7280 },
      { r: 880, h: [100, 200], cr: [102, 150], n: 26, base: 0x64798a },
      { r: 1120, h: [130, 260], cr: [140, 200], n: 24, base: 0x6b7f90 },
      { r: 1500, h: [170, 330], cr: [205, 290], n: 22, base: 0x71859a },
      { r: 2000, h: [210, 420], cr: [300, 420], n: 20, base: 0x76899e }
    ];
    var mtnUnit = new THREE.ConeGeometry(1, 1, 7);   // 单位锥，全部层共用（不可 dispose）
    var mtnMtx = new THREE.Matrix4(), mtnQuat = new THREE.Quaternion();
    var mtnPos = new THREE.Vector3(), mtnScl = new THREE.Vector3();
    var mtnAxisY = new THREE.Vector3(0, 1, 0), mtnTint = new THREE.Color();
    for (var ri = 0; !hideMtn && ri < MTN_RINGS.length; ri++) {
      var ring = MTN_RINGS[ri];
      var baseCol = atmColor(ring.base, ring.r);
      // 先收集全部实例（主峰 + 山肩），再按实际数量建 InstancedMesh
      var seeds = [];
      for (var mi = 0; mi < ring.n; mi++) {
        var ang = (mi / ring.n) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
        var rad = ring.r * (0.92 + Math.random() * 0.16);
        var hgt = ring.h[0] + Math.random() * (ring.h[1] - ring.h[0]);
        var crad = ring.cr[0] + Math.random() * (ring.cr[1] - ring.cr[0]);
        seeds.push({ a: ang, r: rad, h: hgt, c: crad });
        /* 山肩：主峰侧面挂一座矮锥，打散"完美圆锥"的呆板感 */
        if (Math.random() < 0.45) {
          var da = 0.9 * Math.PI * 2 / ring.n;
          seeds.push({
            a: ang + da * (Math.random() < 0.5 ? 1 : -1),
            r: rad * (1 + (Math.random() - 0.5) * 0.06),
            h: hgt * (0.42 + Math.random() * 0.3),
            c: crad * (0.6 + Math.random() * 0.3)
          });
        }
      }
      var mtnMat = new THREE.MeshLambertMaterial({ fog: false, flatShading: false });
      var mtnInst = new THREE.InstancedMesh(mtnUnit, mtnMat, seeds.length);
      mtnInst.frustumCulled = false;
      mtnInst.matrixAutoUpdate = false;
      for (var si = 0; si < seeds.length; si++) {
        var sd = seeds[si];
        mtnPos.set(Math.cos(sd.a) * sd.r, sd.h * 0.5 - 8, Math.sin(sd.a) * sd.r);
        mtnQuat.setFromAxisAngle(mtnAxisY, Math.random() * 3);
        mtnScl.set(sd.c, sd.h, sd.c);
        mtnMtx.compose(mtnPos, mtnQuat, mtnScl);
        mtnInst.setMatrixAt(si, mtnMtx);
        mtnTint.copy(baseCol).multiplyScalar(0.93 + Math.random() * 0.14);
        mtnInst.setColorAt(si, mtnTint);
      }
      mtnInst.instanceMatrix.needsUpdate = true;
      if (mtnInst.instanceColor) mtnInst.instanceColor.needsUpdate = true;
      scene.add(mtnInst);
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
    // 10) v0.13.5 路缘 AO 暗带：贴图最外 ~0.9m 向内渐变压暗。
    //     真实道路上路缘/护栏/植被会遮住低角度天光，路两侧总有一条暗带；
    //     没有它，路面像一块浮在草地上的"贴纸"，与地面没有光学衔接。
    var aoW = ux(0.9);
    [0, 1].forEach(function (sg) {
      var gr = cx.createLinearGradient(sg ? TW : 0, 0, sg ? TW - aoW : aoW, 0);
      gr.addColorStop(0, 'rgba(12,14,18,0.32)');
      gr.addColorStop(1, 'rgba(12,14,18,0)');
      cx.fillStyle = gr;
      cx.fillRect(sg ? TW - aoW : 0, 0, aoW, TH);
    });

    var tex = srgb(new THREE.CanvasTexture(cv));   // v0.13.3：沥青贴图同样是 sRGB 颜色数据
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
    /* v0.13.4：墙面/窗户整体提亮。
       旧墙色 #79879a、窗色 rgba(44,62,86,.88)。这两个值是在"贴图被当线性
       采样、整场景偏亮"的年代定的；v0.13.3 给贴图标了 SRGBColorSpace 之后
       它们被正确解码 → 立刻暗下去约一档，楼群就变成了远景里一排近黑的方块
       （与旁边明亮的天空对比过强，是画面"假"的又一个来源）。
       现在按"最终渲染值 ≈ 设计值"反推，把墙面提到 #bcc8d6、窗提到中蓝灰。 */
    x.fillStyle = '#bcc8d6'; x.fillRect(0, 0, 64, 64);
    for (var r = 0; r < 4; r++) {
      /* 随机加深某些楼层，打破"整齐划一的窗格"——真实楼宇每层亮度都不同 */
      if (Math.random() < 0.3) { x.fillStyle = 'rgba(150,164,182,.45)'; x.fillRect(0, r * 16, 64, 16); }
      for (var q = 0; q < 4; q++) {
        var lit = Math.random() < 0.17;                          // 少量亮灯窗
        x.fillStyle = lit ? 'rgba(255,232,178,.92)' : 'rgba(93,116,146,.9)';
        x.fillRect(q * 16 + 3.5, r * 16 + 4.5, 9, 8);
      }
    }
    var t = srgb(new THREE.CanvasTexture(c));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function buildCityBlocks() {
    if (/[?&]hide=city\b/.test(location.search)) return;   // 调试：排除城市建筑
    var winTex = makeWindowTexture();
    var bMats = [
      new THREE.MeshLambertMaterial({ color: 0xf2f4f7, map: winTex }),
      new THREE.MeshLambertMaterial({ color: 0xe2ebf4, map: winTex }),
      new THREE.MeshLambertMaterial({ color: 0xf3ece1, map: winTex }),
      new THREE.MeshLambertMaterial({ color: 0xd8e4f0, map: winTex }),
      new THREE.MeshLambertMaterial({ color: 0xe9eef5, map: winTex }),
      new THREE.MeshLambertMaterial({ color: 0xf0e9dd, map: winTex })
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
        /* v0.13.4：高度分布拉开。旧版统一 16~50m，整条天际线是一排等高的
           方块；现在多数是 15~52m 的中层，另有约 12% 拔到 60~110m 的塔楼，
           高低错落才有城市轮廓线。 */
        var h = (Math.random() < 0.12) ? (60 + Math.random() * 50) : (15 + Math.random() * 37);
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
        addBlobShadow(m, w * 1.5, d * 1.5, -h / 2 + 0.04);  // v0.13.5：楼脚暗斑（挂楼体上，随楼旋转）
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
  /* ======== v0.13.5 假接触阴影（blob shadow）========
     现状：shadowMap 0 处，树/灌木/岩石/车/楼都"浮"在地上没有落地影，
     是 v0.13.3 被评"假"的另一半原因（另一半——大气透视——已在 v0.13.4 解决）。
     做法：共享一张径向渐变 CanvasTexture（中心深、边缘透明），
     在各物体 Group 脚下加一块贴地 Plane —— 随物体移动/旋转，零逐帧开销。
     ?sh=0 可关（A/B 对比用） */
  var shOff = /[?&]sh=0\b/.test(location.search);
  var shadowTex = null, shadowMat = null, shadowGeo = null;
  function makeShadowAssets() {
    if (shOff || shadowTex) return;
    var S = 128;
    var cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    var cx = cv.getContext('2d');
    /* ⚠️ 不用 alpha 通道：实机（swiftshader/部分 GPU 驱动）上 CanvasTexture 的
       alpha 在本场景不生效（隔离页正常、游戏内消失，原因未明）。
       改用纯 RGB 径向渐变 + MultiplyBlending：白色(255) = 不变，
       中心灰(~92) = 压到 36% 亮度。视觉等效软阴影，且完全不依赖 alpha。 */
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, S, S);
    var g = cx.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.5);
    g.addColorStop(0, 'rgb(88,90,96)');
    g.addColorStop(0.55, 'rgb(150,152,156)');
    g.addColorStop(1, 'rgb(255,255,255)');
    cx.fillStyle = g; cx.fillRect(0, 0, S, S);
    shadowTex = srgb(new THREE.CanvasTexture(cv));
    shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, depthWrite: false,
      blending: THREE.MultiplyBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      side: THREE.DoubleSide
    });
    shadowGeo = new THREE.PlaneGeometry(1, 1);
  }
  /* 在 grp 脚下加一块 w×d 的椭圆暗斑（y = 离地高度，避免与路面 z-fighting） */
  function addBlobShadow(grp, w, d, y) {
    if (shOff) return;
    makeShadowAssets();
    var m = new THREE.Mesh(shadowGeo, shadowMat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, d, 1);
    m.position.y = y;
    m.renderOrder = 1;
    grp.add(m);
  }

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
    addBlobShadow(g, 2.9 * s, 2.3 * s, 0.02);   // v0.13.5：树冠投影略大于冠幅
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
    addBlobShadow(g, 1.7, 1.35, 0.02);          // v0.13.5
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
    addBlobShadow(g, r * 2.9, r * 2.9, 0.02);   // v0.13.5
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
    // —— 云层缓慢漂移（v0.13.3：范围与新的云分布半径 300~700 对齐） ——
    for (var ci = 0; ci < clouds.length; ci++) {
      var cl = clouds[ci];
      cl.position.x += 2.2 * dt;
      if (cl.position.x > 700) cl.position.x = -700;
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

  /* —— v0.13.3 天空跟随相机（C 包 / 第 1 步的核心修复）——
     把天空组件对齐到相机，等价于"无穷远的天空盒"：
       · 天空球球心 = 视点 → 球面 UV 就等于仰角，地平线永远在 v=0.5
       · 太阳/云的方向保持不变（不会因为车往前开就"飘到身后"）
     放在 render() 里而不是 update() 里：菜单态（相机绕原点缓慢环绕）
     与运行态都能生效，且保证在相机矩阵最终确定之后才对齐。
     ?sky=static 调试：退回旧行为（固定在世界原点），用于 A/B 对比。 */
  var skyStatic = /[?&]sky=static\b/.test(location.search);
  function updateSky() {
    if (!skyGrp || skyStatic) return;
    skyGrp.position.copy(camera.position);
  }

  /* 统一渲染出口：异常不吞掉，写到屏幕诊断条 */
  function render() {
    try {
      updateSky();
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