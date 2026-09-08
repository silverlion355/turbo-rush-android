/* game.js — 游戏核心：状态机 / 物理 / 生成 / 渲染
   逻辑坐标系固定 480x800；更新与渲染分离，便于单元驱动测试 */
'use strict';
window.RG = window.RG || {};

RG.Game = class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.assets = RG.Spr.buildAll();
    this.input = new RG.Input(canvas, { getCarX: () => this.p ? this.p.x : 240 });

    this.roadPat = this.g.createPattern(this.assets.asphalt, 'repeat');
    this.cbs = { onGameOver: null, onScore: null };

    this.bg = this.assets.bg;
    this.mode = 'menu';
    this.time = 0;
    this.menuSwayT = 0;

    this.resetWorld();
    this.p = {
      x: RG.CFG.PLAYER_X0, prevX: RG.CFG.PLAYER_X0,
      y: RG.CFG.PLAYER_Y, w: RG.CFG.PLAYER_W, h: RG.CFG.PLAYER_H,
      lean: 0, dead: false, deadT: 0,
    };
    this.scroll = 190;           // 菜单演示滚动速度
    this.speed = 190;

    // 预置路旁树
    this.trees = [];
    let yy = -20;
    while (yy < RG.CFG.VH + 60) {
      this.trees.push({ x: RG.rand(14, 40), y: yy, s: RG.pick(this.assets.trees), right: false });
      this.trees.push({ x: RG.rand(RG.CFG.VW - 46, RG.CFG.VW - 18), y: yy + RG.rand(0, 60), s: RG.pick(this.assets.trees), right: true });
      yy += RG.rand(120, 170);
    }
    // 云影（远景慢速）
    this.clouds = [{ x: 90, y: 240, w: 190, a: 0.10 }, { x: 320, y: 520, w: 230, a: 0.08 }];
  }

  resetWorld() {
    this.cars = [];
    this.gemList = [];
    this.parts = [];
    this.popups = [];
    this.streaks = [];
  }

  /* ================= 流程控制 ================= */
  startGame() {
    this.resetWorld();
    this.mode = 'run';
    this.time = 0;
    this.lives = RG.CFG.LIFE;
    this.score = 0; this.gems = 0; this.dist = 0;
    this.diffT = 0;
    this.spawnT = 1.0; this.gemT = 0.35;
    this.prevLane = RG.randi(0, RG.CFG.LANES - 1);
    this.speed = RG.CFG.BASE_SPEED;
    this.inv = 0; this.flash = 0; this.shake = 0;
    this.gemChain = 0; this.gemLastT = -9;   // 宝石连击：5 连 x1.5 / 10 连 x2（撞车或超时打断）
    this.p.dead = false; this.p.deadT = 0;
    this.p.x = RG.CFG.PLAYER_X0; this.p.prevX = this.p.x; this.p.lean = 0;
    RG.Audio.engineStart();
    if (this.cbs.onScore) this.cbs.onScore(0, 0);
  }

  pause() {
    if (this.mode !== 'run') return;
    this.mode = 'paused';
    RG.Audio.engineSet(0, 0);
  }
  resume() {
    if (this.mode !== 'paused') return;
    this.mode = 'run';
    RG.Audio.engineStart();
  }
  toMenu() {
    this.mode = 'menu';
    this.scroll = 190;
    this.resetWorld();
    RG.Audio.engineStop();
  }
  get running() { return this.mode === 'run'; }

  /* ================= 更新 ================= */
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    if (this.mode === 'menu') {
      this.menuSwayT += dt;
      this.speed = RG.damp(this.speed, 190, 1, dt);
      this.scroll = this.speed;
      this.p.x = RG.CFG.VW / 2 + Math.sin(this.menuSwayT * 0.7) * 110;
      this.moveScenery(dt);
      return;
    }
    if (this.mode !== 'run') return;
    this.runUpdate(dt);
  }

  moveScenery(dt) {
    const sp = this.scroll;
    for (const t of this.trees) {
      t.y += sp * dt;
      if (t.y > RG.CFG.VH + 80) {
        t.y -= RG.CFG.VH + 190;
        t.x = t.right ? RG.rand(436, 468) : RG.rand(12, 40);
        t.s = RG.pick(this.assets.trees);
      }
    }
    for (const c of this.clouds) {
      c.y += sp * 0.16 * dt;
      c.x += Math.sin(this.time * 0.1 + c.y) * 4 * dt;
      if (c.y > RG.CFG.VH + 40) c.y = -140;
    }
  }

  runUpdate(dt) {
    this.diffT += dt;
    const prog = RG.clamp(this.diffT / RG.CFG.RAMP_TIME, 0, 1);
    // S 形速度目标：开局慢热 → 中段推背爆发 → 后段渐近极速巡航
    // （比原线性曲线更早进入高速段，且到顶后有清晰的"极速巡航"平台感）
    const s = prog * prog * (3 - 2 * prog);
    const base = RG.CFG.BASE_SPEED + (RG.CFG.MAX_SPEED - RG.CFG.BASE_SPEED) * s;

    /* —— 目标速度 —— */
    let target = base;
    const boost = this.input.boost(), brake = this.input.brake();
    if (boost) target = Math.min(target * RG.CFG.KEY_BOOST, RG.CFG.MAX_SPEED * 1.04);
    if (brake) target *= RG.CFG.KEY_SLOW;

    if (!this.p.dead) {
      if (this.inv > 0) {
        this.inv -= dt;
        target *= 0.72; // 撞击后短暂爬升阶段
      }
      this.speed = RG.damp(this.speed, target, 2.0, dt);
    } else {
      // 爆炸慢镜头
      this.p.deadT -= dt;
      this.speed = RG.damp(this.speed, 40, 1.4, dt);
      this.flash = Math.max(this.flash - dt * 0.6, 0);
      if (this.p.deadT <= 0) {
        this.mode = 'over';
        RG.Audio.engineStop();
        if (this.cbs.onGameOver) {
          this.cbs.onGameOver({ score: Math.floor(this.score), gems: this.gems, dist: this.dist, lives: 0 });
        }
        return;
      }
    }
    this.scroll = this.speed;
    this.shake = Math.max(this.shake - dt * 26, 0);
    this.flash = Math.max(this.flash - dt * 1.6, 0);

    /* —— 玩家操控 —— */
    if (!this.p.dead) {
      this.p.prevX = this.p.x;
      const ax = this.input.axis();
      if (ax !== 0) {
        this.p.x += ax * RG.CFG.STEER_SPEED * dt;
      } else if (this.input.targetX !== null) {
        this.p.x = RG.damp(this.p.x, this.input.targetX, RG.CFG.PTR_K, dt);
      }
      const minX = RG.CFG.ROAD_LEFT + 24, maxX = RG.CFG.ROAD_RIGHT - 24;
      const was = this.p.x;
      this.p.x = RG.clamp(this.p.x, minX, maxX);
      const vel = (this.p.x - this.p.prevX) / Math.max(dt, 1e-4);
      this.p.lean = RG.damp(this.p.lean, RG.clamp(vel / 700, -1, 1) * 0.13, 10, dt);
      this.p.prevX = was; // prevX 用作下一帧位移基准
    }

    /* —— 得分/里程 —— */
    this.score += this.speed * dt * RG.CFG.SCORE_SPEED;
    this.dist += this.speed * 0.2 / 3.6 * dt; // 与仪表车速一致：km/h → m/s

    /* —— 生成 —— */
    if (!this.p.dead) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.trySpawnCar(prog);
        const iv = RG.lerp(RG.CFG.SPAWN_MAX, RG.CFG.SPAWN_MIN, prog);
        this.spawnT = iv * RG.rand(0.7, 1.35);
      }
      this.gemT -= dt;
      if (this.gemT <= 0) {
        if (this.trySpawnGems()) this.gemT = RG.rand(1.0, 1.9);
        else this.gemT = 0.3;
      }
    }

    /* —— 移动场景 —— */
    this.moveScenery(dt);

    /* —— 车辆物理 —— */
    for (const c of this.cars) {
      c.y += (this.scroll - c.vOwn) * dt;
      // 同车道同向车距保持（前慢后随）
      for (const d of this.cars) {
        if (c !== d && d.dir === c.dir && Math.abs(d.x - c.x) < 6 && d.y < c.y && c.y - d.y < 150) {
          c.vOwn = Math.min(c.vOwn, d.vOwn);
        }
      }
    }
    this.cars = this.cars.filter(c => c.y < RG.CFG.VH + 200 && c.y > -260);

    /* —— 宝石 —— */
    for (const g of this.gemList) g.y += this.scroll * dt;
    this.gemList = this.gemList.filter(g => g.y < RG.CFG.VH + 60);

    /* —— 碰撞：宝石 —— */
    if (!this.p.dead) {
      for (let i = this.gemList.length - 1; i >= 0; i--) {
        const g = this.gemList[i];
        if (RG.hit(this.p.x, this.p.y, 44, 88, g.x, g.y, 26, 30)) {
          this.gemList.splice(i, 1);
          this.gems += 1;
          // 连击：间隔 >1.6s 打断；5 连起 x1.5，10 连起 x2.0
          if (this.time - this.gemLastT > 1.6) this.gemChain = 0;
          this.gemChain += 1;
          this.gemLastT = this.time;
          let val = RG.CFG.GEM_SCORE * (1 + Math.min(this.gems * 0.004, 0.5));
          let mult = 1;
          if (this.gemChain >= 10) mult = 2;
          else if (this.gemChain >= 5) mult = 1.5;
          val = Math.round(val * mult);
          this.score += val;
          this.popup(g.x, g.y - 16, '+' + val + (mult > 1 ? ' x' + mult : ''), mult > 1 ? '#ffd23f' : '#ffe25a');
          this.burst(g.x, g.y, 8, ['#ffe25a', '#fff6c9', g.color]);
          RG.Audio.gem(this.gemChain);
        }
      }
      /* —— 碰撞：车辆 —— */
      if (this.inv <= 0) {
        for (let i = 0; i < this.cars.length; i++) {
          const c = this.cars[i];
          if (RG.hit(this.p.x, this.p.y, 44, 86, c.x, c.y, c.w - 4, c.h - 4)) {
            this.hitCar(c);
            break;
          }
        }
      }
    }

    /* —— 粒子 / 漂浮字 / 速度线 —— */
    this.updateFx(dt);

    if (this.cbs.onScore && Math.floor(this.score) !== this._lastScore) {
      this._lastScore = Math.floor(this.score);
      this.cbs.onScore(this._lastScore, this.gems);
    }
  }

  hitCar(car) {
    this.lives -= 1;
    this.inv = RG.CFG.INVINCIBLE;
    this.flash = 0.6;
    this.shake = 15;
    this.gemChain = 0;   // 撞车打断宝石连击
    RG.Audio.crash();
    const mx = (this.p.x + car.x) / 2, my = (this.p.y + car.y) / 2;
    this.burst(mx, my, 16, ['#ffd23f', '#ff8a3d', '#ffffff']);
    if (this.lives <= 0) {
      this.p.dead = true;
      this.p.deadT = 1.4;
      this.burst(this.p.x, this.p.y, 42, ['#ff9f2e', '#ffd23f', '#ffffff', '#ff5a3d']);
      this.popup(this.p.x, this.p.y - 60, '车辆损毁', '#ff9a8a', 22);
    } else {
      this.popup(this.p.x, this.p.y - 60, '碰撞！', '#ff7a70', 18);
    }
  }

  /* —— AI 生成 —— */
  trySpawnCar(prog) {
    const lanes = [];
    for (let i = 0; i < RG.CFG.LANES; i++) lanes.push(i);
    // 优先避开上轮车道（避免"堵墙"）
    if (lanes.length > 1 && Math.random() < 0.75) {
      const idx = lanes.indexOf(this.prevLane);
      if (idx >= 0) lanes.splice(idx, 1);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const li = RG.randi(0, lanes.length - 1);
      const lane = lanes.splice(li, 1)[0];
      const x = RG.laneX(lane);
      // 生成区已有车辆 → 换道
      const blocked = this.cars.some(c => Math.abs(c.x - x) < 6 && c.y < 130);
      if (blocked) continue;
      this.prevLane = lane;
      const def = RG.pick(this.assets.ai);
      const oncoming = Math.random() < RG.lerp(RG.CFG.ONCOMING_MIN, RG.CFG.ONCOMING_MAX, prog);
      let vOwn;
      if (oncoming) vOwn = -this.scroll * RG.rand(0.36, 0.55);
      else {
        const f = def.kind === 'sport' ? RG.rand(0.34, 0.42) : def.kind === 'suv' ? RG.rand(0.40, 0.50) : RG.rand(0.42, 0.52);
        vOwn = this.scroll * f;
      }
      this.cars.push({
        x, y: -150,
        w: def.w, h: def.h,
        img: oncoming ? def.flip : def.img,
        dir: oncoming ? 'on' : 'same',
        vOwn,
        def,
      });
      return;
    }
  }

  trySpawnGems() {
    const lanes = [];
    for (let i = 0; i < RG.CFG.LANES; i++) lanes.push(i);
    for (let attempt = 0; attempt < 4; attempt++) {
      const li = RG.randi(0, lanes.length - 1);
      const lane = lanes.splice(li, 1)[0];
      const x = RG.laneX(lane);
      const busy = this.cars.some(c => Math.abs(c.x - x) < 6 && c.y < 160);
      if (busy) continue;
      const n = RG.randi(RG.CFG.GEM_ROW_MIN, RG.CFG.GEM_ROW_MAX);
      const color = RG.pick(Object.keys(this.assets.gems));
      let y = -RG.rand(10, 90);
      for (let i = 0; i < n; i++) {
        this.gemList.push({ x: x + RG.rand(-6, 6), y, color, seed: RG.rand(0, 6.28) });
        y += 62;
      }
      return true;
    }
    return false;
  }

  /* —— 特效 —— */
  popup(x, y, txt, color, size) {
    this.popups.push({ x, y, txt, color, size: size || 15, life: 0.9, max: 0.9 });
  }
  burst(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = RG.rand(0, Math.PI * 2), v = RG.rand(60, 300);
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: RG.rand(0.3, 0.8), max: 0.8,
        size: RG.rand(2, 4.6), color: RG.pick(colors),
      });
    }
  }
  updateFx(dt) {
    for (const p of this.parts) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - dt * 3; p.vy = p.vy * (1 - dt * 3) + 160 * dt;
    }
    this.parts = this.parts.filter(p => p.life > 0);
    for (const t of this.popups) { t.life -= dt; t.y -= 34 * dt; }
    this.popups = this.popups.filter(t => t.life > 0);

    if (this.speed > 520 && !this.p.dead) {
      // 极速时风线更多更密集（520 → 最大 14 条）
      const need = 7 + Math.round(RG.clamp((this.speed - 520) / 300, 0, 1) * 7);
      while (this.streaks.length < need) {
        const left = Math.random() < 0.5;
        this.streaks.push({
          x: left ? RG.rand(0, RG.CFG.ROAD_LEFT + 30) : RG.rand(RG.CFG.ROAD_RIGHT - 30, RG.CFG.VW),
          y: RG.rand(0, RG.CFG.VH), len: RG.rand(40, 110),
        });
      }
    }
    for (const s of this.streaks) {
      s.y += this.speed * 1.5 * dt;
      if (s.y > RG.CFG.VH + 20) { s.y = -30; s.x = Math.random() < 0.5 ? RG.rand(4, 56) : RG.rand(RG.CFG.VW - 60, RG.CFG.VW - 6); s.len = RG.rand(40, 110); }
    }
  }

  /* ================= 渲染 ================= */
  render() {
    const g = this.g;
    g.save();
    g.clearRect(0, 0, RG.CFG.VW, RG.CFG.VH);

    // 震屏：碰撞震 + 极速(>810)巡航微震，共同营造速度冲击感
    const spShake = this.speed > 810 ? ((this.speed - 810) / 50) * 1.5 : 0;
    const sh = Math.max(this.shake, spShake);
    if (sh > 0.15) {
      g.translate(RG.rand(-sh, sh) * 0.5, RG.rand(-sh, sh) * 0.5);
    }

    this.renderWorld(g);

    if (this.mode === 'run') {
      this.renderEntities(g);
      this.renderHud(g);
    } else if (this.mode === 'menu') {
      this.renderCarSprite(g, this.p, this.assets.player, false);
    }

    g.restore();
  }

  renderWorld(g) {
    g.drawImage(this.bg, 0, 0, RG.CFG.VW, RG.CFG.VH);

    // 树（在路面之下的部分会被路面裁掉，视觉上贴路生长）
    for (const t of this.trees) RG.Spr.blit(g, t.s, t.x, t.y);

    // 云影（洒在路面上的淡光斑）
    for (const c of this.clouds) {
      g.fillStyle = `rgba(255,255,255,${c.a})`;
      g.beginPath();
      g.ellipse(c.x, c.y, c.w / 2, c.w * 0.14, 0, 0, Math.PI * 2);
      g.fill();
    }
    const scroll = this.scroll;

    // 路肩红白格
    const curb = (cx, cw) => {
      const span = 22;
      for (let y = -span; y < RG.CFG.VH + span; y += span) {
        g.fillStyle = (Math.floor((y + scroll) / span) % 2 === 0) ? '#dcdcdc' : '#d8342c';
        g.fillRect(cx, y, cw, span);
      }
    };
    curb(RG.CFG.ROAD_LEFT - RG.CFG.CURB_W, RG.CFG.CURB_W);
    curb(RG.CFG.ROAD_RIGHT, RG.CFG.CURB_W);

    // 沥青路面（滚动纹理）
    g.save();
    g.translate(0, -(scroll % 128));
    g.fillStyle = this.roadPat;
    g.fillRect(RG.CFG.ROAD_LEFT, -128, RG.roadW(), RG.CFG.VH + 256);
    g.restore();
    // 路面渐变（近处清晰/远处雾感）
    const sh = g.createLinearGradient(0, 0, 0, RG.CFG.VH);
    sh.addColorStop(0, 'rgba(210,230,240,.30)');
    sh.addColorStop(0.25, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.fillRect(RG.CFG.ROAD_LEFT, 0, RG.roadW(), RG.CFG.VH);

    // 车道线
    const pitch = 58, dash = 24;
    const rem = scroll % pitch;
    const laneW = RG.laneW();
    for (let i = 1; i < RG.CFG.LANES; i++) {
      const x = RG.CFG.ROAD_LEFT + laneW * i;
      if (i === RG.CFG.LANES / 2) {
        // 中央双黄虚线
        for (const off of [-3.2, 3.2]) {
          g.fillStyle = '#f5c542';
          for (let y = -rem; y < RG.CFG.VH; y += pitch) g.fillRect(x + off, y, 2.2, dash);
        }
      } else {
        g.fillStyle = 'rgba(245,248,250,.78)';
        for (let y = -rem; y < RG.CFG.VH; y += pitch) g.fillRect(x - 1.4, y, 2.8, dash);
      }
    }
    // 路面边线（实线）
    g.fillStyle = 'rgba(245,248,250,.92)';
    g.fillRect(RG.CFG.ROAD_LEFT + 3, 0, 3, RG.CFG.VH);
    g.fillRect(RG.CFG.ROAD_RIGHT - 6, 0, 3, RG.CFG.VH);

    // 远景雾
    g.drawImage(this.assets.fog, 0, 0, RG.CFG.VW, 180);
  }

  renderCarSprite(g, obj, spr, isPlayer) {
    const { x, y, w, h } = obj;
    // 地面投影
    g.fillStyle = 'rgba(0,0,0,.30)';
    g.beginPath();
    g.ellipse(x, y + 3, w * 0.62, h * 0.44, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(x, y);
    if (isPlayer) {
      g.rotate(obj.lean || 0);
      g.translate(0, Math.sin(this.time * 7) * 0.8);
    }
    g.drawImage(spr.img, -w / 2, -h / 2, w, h);
    g.restore();
  }

  renderEntities(g) {
    // 宝石（在车辆下方）
    for (const gem of this.gemList) {
      const img = this.assets.gems[gem.color];
      const sp = Math.abs(Math.cos(this.time * 4 + gem.seed));
      const squash = 0.55 + 0.45 * sp;
      const w = 40 * squash, h = 40 * (2 - squash) * 0.5 + 20;
      g.save();
      g.globalAlpha = 0.85;
      g.drawImage(img, gem.x - w / 2, gem.y - h / 2, w, h);
      g.restore();
    }

    // AI 车辆
    for (const c of this.cars) {
      this.renderCarSprite(g, { x: c.x, y: c.y, w: c.w, h: c.h }, c, false);
    }

    // 粒子
    for (const p of this.parts) {
      g.globalAlpha = RG.clamp(p.life / p.max, 0, 1);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // 漂浮字
    for (const t of this.popups) {
      g.globalAlpha = RG.clamp(t.life / t.max, 0, 1);
      g.font = `800 ${t.size}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = 'rgba(0,0,0,.4)';
      g.fillText(t.txt, t.x + 1.5, t.y + 1.5);
      g.fillStyle = t.color;
      g.fillText(t.txt, t.x, t.y);
    }
    g.globalAlpha = 1;

    // 玩家
    if (!this.p.dead) {
      if (this.inv > 0 && Math.sin(this.time * 26) > 0) g.globalAlpha = 0.4;
      this.renderCarSprite(g, this.p, this.assets.player, true);
      g.globalAlpha = 1;
    }

    // 高速风线
    if (this.streaks.length) {
      const k = RG.clamp((this.speed - 520) / 320, 0, 1);
      g.strokeStyle = `rgba(255,255,255,${0.16 * k})`;
      g.lineWidth = 2;
      for (const s of this.streaks) {
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(s.x + s.len * 0.2, s.y - s.len);
        g.stroke();
      }
    }

    // 碰撞红闪
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,40,30,${Math.min(this.flash, 0.42)})`;
      g.fillRect(0, 0, RG.CFG.VW, RG.CFG.VH);
    }
    // 无敌淡色
    if (this.inv > 0) {
      g.fillStyle = 'rgba(120,200,255,.05)';
      g.fillRect(0, 0, RG.CFG.VW, RG.CFG.VH);
    }
  }

  renderHud(g) {
    const VW = RG.CFG.VW;
    // 顶部信息条
    g.fillStyle = 'rgba(8,12,20,.55)';
    g.fillRect(0, 0, VW, 46);
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.font = '700 10px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('SCORE', 14, 20);
    g.fillStyle = '#ffffff';
    g.font = '800 24px "Segoe UI", system-ui, sans-serif';
    g.fillText(String(Math.floor(this.score)).padStart(6, '0'), 14, 42);

    // 生命
    for (let i = 0; i < RG.CFG.LIFE; i++) {
      const hx = 178 + i * 30;
      this.drawHeart(g, hx, 23, 12, i < this.lives);
    }

    // 右下：宝石
    const gw = 128;
    g.fillStyle = 'rgba(8,12,20,.55)';
    g.beginPath();
    RG.rr(g, VW - gw - 10, RG.CFG.VH - 58, gw, 48, 12);
    g.fill();
    g.drawImage(this.assets.gems.gold, VW - gw + 14, RG.CFG.VH - 48, 28, 28);
    g.fillStyle = '#ffe25a';
    g.font = '800 22px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(String(this.gems), VW - gw + 50, RG.CFG.VH - 26);

    // 左下：速度
    const kmh = Math.round(this.speed * RG.CFG.KMH);
    g.fillStyle = 'rgba(8,12,20,.55)';
    g.beginPath();
    RG.rr(g, 10, RG.CFG.VH - 58, 128, 48, 12);
    g.fill();
    g.fillStyle = this.input.boost() ? '#ffd23f' : '#ffffff';
    g.font = '800 26px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(String(kmh), 24, RG.CFG.VH - 28);
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.font = '700 11px system-ui, sans-serif';
    g.fillText('km/h', 90, RG.CFG.VH - 27);
    if (this.input.boost()) {
      g.fillStyle = '#ff8a3d';
      g.font = '800 10px system-ui, sans-serif';
      g.fillText('TURBO', 24, RG.CFG.VH - 44);
    }
    // 无敌提示
    if (this.inv > 0) {
      g.fillStyle = 'rgba(140,215,255,.85)';
      g.font = '700 13px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('防护中', VW / 2, RG.CFG.VH - 74);
    }
  }

  drawHeart(g, x, y, s, alive) {
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.moveTo(0, s * 0.35);
    g.bezierCurveTo(0, 0, -s, -s * 0.35, -s, s * 0.1);
    g.bezierCurveTo(-s, s * 0.7, -s * 0.35, s * 0.9, 0, s * 1.25);
    g.bezierCurveTo(s * 0.35, s * 0.9, s, s * 0.7, s, s * 0.1);
    g.bezierCurveTo(s, -s * 0.35, 0, 0, 0, s * 0.35);
    g.closePath();
    g.fillStyle = alive ? '#ff4d5e' : 'rgba(255,255,255,.14)';
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.6)';
    g.lineWidth = 1.2;
    if (alive) g.stroke();
    g.restore();
  }
};
