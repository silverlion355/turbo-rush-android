/* sprites.js — 离屏预渲染美术资源（汽车贴图 / 宝石 / 树木 / 背景）
   全部程序化绘制，零图片资源 → 便于打进 Android WebView 壳 */
'use strict';
window.RG = window.RG || {};

RG.Spr = (function () {
  const SS = 2; // 超采样倍率：高分屏下依旧锐利

  function canvas(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * SS));
    c.height = Math.max(1, Math.round(h * SS));
    const g = c.getContext('2d');
    g.scale(SS, SS);
    fn(g);
    return c;
  }

  /* ============ 汽车贴图（俯视，车头朝上） ============ */
  function drawCar(g, W, H, p) {
    const cx = W / 2;
    const bx = W * 0.175, bw = W * 0.65;      // 车身矩形
    const round = bw * 0.32;

    // 分区（驾驶舱比例）
    const suv = !!p.suv;
    const WIND = suv ? [0.27, 0.39] : [0.29, 0.41];   // 前挡风
    const ROOF = suv ? [0.39, 0.63] : [0.41, 0.57];   // 车顶
    const REAR = suv ? [0.63, 0.74] : [0.57, 0.70];   // 后窗
    const TAIL = suv ? 0.74 : 0.70;                   // 尾厢起点

    // 1) 轮胎（微微探出车身，增加体积感）
    const tw = W * 0.17, th = H * 0.175;
    const wy = [H * 0.25 - th / 2, H * 0.75 - th / 2];
    const tireX = [bx - tw * 0.5, bx + bw - tw * 0.5];
    g.fillStyle = '#0c0c11';
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        RG.rr(g, tireX[j], wy[i], tw, th, tw * 0.42); g.fill();
      }
    }
    g.fillStyle = '#2c2c34';
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        RG.rr(g, tireX[j] + 2.5, wy[i] + th * 0.24, tw - 5, th * 0.5, 2); g.fill();
      }
    }

    // 2) 车身主体（纵向渐变模拟光照）
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, p.bodyLight);
    grad.addColorStop(0.45, p.body);
    grad.addColorStop(1, p.bodyDark);
    g.fillStyle = grad;
    RG.rr(g, bx, H * 0.012, bw, H * 0.976, round); g.fill();

    // 3) 车身两侧暗部（立体感）
    const sd = g.createLinearGradient(bx, 0, bx + bw, 0);
    sd.addColorStop(0, 'rgba(0,0,0,.35)');
    sd.addColorStop(0.12, 'rgba(0,0,0,0)');
    sd.addColorStop(0.5, 'rgba(0,0,0,0)');
    sd.addColorStop(0.88, 'rgba(0,0,0,0)');
    sd.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = sd;
    RG.rr(g, bx, H * 0.012, bw, H * 0.976, round); g.fill();

    // 4) 后视镜
    g.fillStyle = p.bodyDark;
    RG.rr(g, bx - W * 0.085, H * (WIND[0] + 0.06), W * 0.065, H * 0.05, 2); g.fill();
    RG.rr(g, bx + bw + W * 0.02, H * (WIND[0] + 0.06), W * 0.065, H * 0.05, 2); g.fill();

    // 5) 引擎盖高光条
    g.fillStyle = 'rgba(255,255,255,.16)';
    RG.rr(g, cx - bw * 0.16, H * 0.045, bw * 0.32, H * (WIND[0] - 0.10), bw * 0.09); g.fill();

    // 6) 前挡风玻璃（带斜向反光）
    drawGlass(g, W, H, bx, bw, WIND[0], WIND[1], p, true);
    // 车顶（比车身略暗，制造舱体层次）
    g.fillStyle = p.roof;
    RG.rr(g, bx + 2.5, H * ROOF[0], bw - 5, H * (ROOF[1] - ROOF[0]), 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.07)';
    RG.rr(g, bx + 3, H * ROOF[0], bw - 6, H * (ROOF[1] - ROOF[0]) * 0.5, 3); g.fill();
    // 后窗
    drawGlass(g, W, H, bx, bw, REAR[0], REAR[1], p, false);

    // 7) 中置双条拉花（运动款）
    if (p.stripes) {
      g.fillStyle = p.stripes;
      const sw = bw * 0.075;
      RG.rr(g, cx - bw * 0.19, H * 0.06, sw, H * (ROOF[1] - 0.10), sw / 2); g.fill();
      RG.rr(g, cx + bw * 0.19 - sw, H * 0.06, sw, H * (ROOF[1] - 0.10), sw / 2); g.fill();
    }

    // 8) 尾厢盖缝隙与尾部
    g.fillStyle = 'rgba(0,0,0,.22)';
    g.fillRect(bx + 3, H * TAIL, bw - 6, 1.6);

    // 9) 大灯 / 尾灯
    const hlW = bw * 0.21, hlH = H * 0.065;
    g.fillStyle = '#fff6cd';
    RG.rr(g, bx + 2.5, H * 0.025, hlW, hlH, 2.5); g.fill();
    RG.rr(g, bx + bw - hlW - 2.5, H * 0.025, hlW, hlH, 2.5); g.fill();
    g.fillStyle = '#fff';
    RG.rr(g, bx + hlW * 0.18, H * 0.032, hlW * 0.5, hlH * 0.42, 1.5); g.fill();
    RG.rr(g, bx + bw - hlW * 0.68, H * 0.032, hlW * 0.5, hlH * 0.42, 1.5); g.fill();

    const tlY = H * 0.915, tlH = H * 0.05;
    g.fillStyle = '#ff2d35';
    RG.rr(g, bx + 2.5, tlY, hlW, tlH, 2); g.fill();
    RG.rr(g, bx + bw - hlW - 2.5, tlY, hlW, tlH, 2); g.fill();
    g.fillStyle = '#ff9ba1';
    RG.rr(g, bx + 4.5, tlY + tlH * 0.2, hlW * 0.55, tlH * 0.5, 1); g.fill();
    RG.rr(g, bx + bw - hlW - 4.5, tlY + tlH * 0.2, hlW * 0.55, tlH * 0.5, 1); g.fill();

    // 10) 尾翼（运动款）
    if (p.sport) {
      g.fillStyle = '#14141a';
      RG.rr(g, bx - W * 0.03, H * 0.925, W * 0.04, H * 0.075, 2); g.fill();
      RG.rr(g, bx + bw - W * 0.01, H * 0.925, W * 0.04, H * 0.075, 2); g.fill();
      RG.rr(g, bx - W * 0.045, H * 0.965, bw + W * 0.09, H * 0.032, 2.5); g.fill();
      g.fillStyle = 'rgba(255,255,255,.08)';
      RG.rr(g, bx - W * 0.045, H * 0.968, bw + W * 0.09, H * 0.01, 2); g.fill();
    }
  }

  function drawGlass(g, W, H, bx, bw, y0, y1, p, streak) {
    const gy0 = H * y0, gy1 = H * y1;
    g.save();
    g.beginPath();
    RG.rr(g, bx + 2.5, gy0, bw - 5, gy1 - gy0, 3);
    g.clip();
    const gl = g.createLinearGradient(0, gy0, 0, gy1);
    gl.addColorStop(0, p.glassTop);
    gl.addColorStop(0.35, p.glass || '#101d30');
    gl.addColorStop(1, '#0a1118');
    g.fillStyle = gl;
    g.fillRect(bx, gy0, bw, gy1 - gy0);
    if (streak) {
      g.translate(bx + bw / 2, (gy0 + gy1) / 2);
      g.rotate(-0.38);
      g.fillStyle = 'rgba(255,255,255,.17)';
      g.fillRect(-bw, -2, bw * 2.8, 3.6);
      g.fillStyle = 'rgba(255,255,255,.07)';
      g.fillRect(-bw, 4, bw * 2.8, 2.2);
    }
    g.restore();
  }

  function makeCar(opts) {
    const { w, h } = opts;
    const img = canvas(w, h, g => drawCar(g, w, h, opts.pal));
    const flip = canvas(w, h, g => {
      g.translate(0, h);
      g.scale(1, -1);
      drawCar(g, w, h, opts.pal);
    });
    return { w, h, img, flip };
  }

  /* ============ 玩家车 ============ */
  function playerCar() {
    return makeCar({
      w: 50, h: 92,
      pal: {
        body: '#e0342b', bodyDark: '#7e100b', bodyLight: '#ff7a52',
        roof: '#a91a14', glassTop: '#3f5f7e', glass: '#14273d',
        stripes: 'rgba(255,255,255,.94)', sport: true,
      },
    });
  }

  /* ============ AI 车池（多种车型/配色/权重） ============ */
  const AI_DEFS = [
    { w: 52, h: 94, kind: 'sedan',  wt: 3, pal: { body: '#3a7ae8', bodyDark: '#143184', bodyLight: '#8fb8ff', roof: '#2550c8', glassTop: '#44617f' } },
    { w: 52, h: 94, kind: 'sedan',  wt: 3, pal: { body: '#c6d0dc', bodyDark: '#5d6b7c', bodyLight: '#f6f9fc', roof: '#9ba8b8', glassTop: '#5b7190' } },
    { w: 60, h: 102, kind: 'suv',   wt: 2, pal: { body: '#efb120', bodyDark: '#8f6400', bodyLight: '#ffe58a', roof: '#c08c10', glassTop: '#44617f', suv: true } },
    { w: 60, h: 102, kind: 'suv',   wt: 2, pal: { body: '#23262e', bodyDark: '#0a0b10', bodyLight: '#4a4f5c', roof: '#14161c', glassTop: '#44617f', suv: true } },
    { w: 52, h: 94, kind: 'sedan',  wt: 2, pal: { body: '#0fa08c', bodyDark: '#06584d', bodyLight: '#57d6c2', roof: '#0b7a6a', glassTop: '#3f6f77' } },
    { w: 50, h: 92, kind: 'sport',  wt: 1, pal: { body: '#f26a2f', bodyDark: '#96300a', bodyLight: '#ffb27a', roof: '#c24a16', glassTop: '#3f5f7e', stripes: 'rgba(255,255,255,.85)', sport: true } },
    { w: 50, h: 92, kind: 'sport',  wt: 1, pal: { body: '#9c4fd8', bodyDark: '#56227f', bodyLight: '#d49cff', roof: '#7a33b0', glassTop: '#3f5f7e', stripes: 'rgba(255,255,255,.8)', sport: true } },
    { w: 60, h: 102, kind: 'suv',   wt: 1, pal: { body: '#e8edf2', bodyDark: '#7c8896', bodyLight: '#ffffff', roof: '#b7c1cc', glassTop: '#44617f', suv: true } },
  ];

  function aiPool() {
    const pool = [];
    AI_DEFS.forEach((d, i) => {
      const c = makeCar(d);
      for (let k = 0; k < d.wt; k++) {
        pool.push({ w: c.w, h: c.h, img: c.img, flip: c.flip, kind: d.kind, def: i });
      }
    });
    return pool;
  }

  /* ============ 发光宝石 ============ */
  const GEM_COLORS = {
    cyan:    { core: '#3df4ff', edge: '#0a8fa8', glow: 'rgba(61,244,255,', dark: '#064c5c' },
    magenta: { core: '#ff6ee0', edge: '#a2267f', glow: 'rgba(255,110,224,', dark: '#5e0f48' },
    gold:    { core: '#ffe25a', edge: '#b8860b', glow: 'rgba(255,226,90,', dark: '#7a5a08' },
  };

  function gemSprite() {
    const S = 44, c = S / 2;
    const out = {};
    Object.keys(GEM_COLORS).forEach(key => {
      const col = GEM_COLORS[key];
      out[key] = canvas(S, S, g => {
        // 光晕
        const rg = g.createRadialGradient(c, c, 2, c, c, 21);
        rg.addColorStop(0, col.glow + '.75)');
        rg.addColorStop(0.55, col.glow + '.28)');
        rg.addColorStop(1, col.glow + '0)');
        g.fillStyle = rg;
        g.fillRect(0, 0, S, S);
        // 主菱形体
        const hw = 13, hh = 17;
        const grad = g.createLinearGradient(c - hw, c - hh, c + hw, c + hh);
        grad.addColorStop(0, col.core);
        grad.addColorStop(0.5, col.edge);
        grad.addColorStop(1, col.dark);
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(c, c - hh);
        g.lineTo(c + hw, c);
        g.lineTo(c, c + hh);
        g.lineTo(c - hw, c);
        g.closePath();
        g.fill();
        // 顶部切面反光
        g.fillStyle = 'rgba(255,255,255,.6)';
        g.beginPath();
        g.moveTo(c, c - hh);
        g.lineTo(c + hw * 0.42, c);
        g.lineTo(c - hw * 0.42, c);
        g.closePath();
        g.fill();
        // 高光
        g.fillStyle = 'rgba(255,255,255,.9)';
        g.beginPath();
        g.moveTo(c, c - hh);
        g.lineTo(c + hw * 0.16, c - hh * 0.5);
        g.lineTo(c - hw * 0.16, c - hh * 0.5);
        g.closePath();
        g.fill();
        // 星光十字
        g.strokeStyle = 'rgba(255,255,255,.85)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(c, c - hh - 4); g.lineTo(c, c + hh + 3);
        g.moveTo(c - hw - 3, c); g.lineTo(c + hw + 3, c);
        g.stroke();
      });
    });
    return out;
  }

  /* ============ 路旁树木 / 灌木 ============ */
  function treeSprites() {
    const out = [];
    const defs = [
      { S: 44, leaf: ['#2f8a3f', '#3fae54', '#267034'], bush: false },
      { S: 52, leaf: ['#37a04b', '#4cc464', '#2c8040'], bush: false },
      { S: 30, leaf: ['#2c6d46', '#3f9460', '#215a38'], bush: true },
      { S: 40, leaf: ['#3f9b52', '#55c96c', '#2e7a41'], bush: true },
    ];
    defs.forEach(d => {
      const S = d.S;
      out.push(canvas(S + 14, S + 14, g => {
        const cx = (S + 14) / 2, cy = (S + 14) / 2 - 2;
        // 地面投影
        g.fillStyle = 'rgba(0,0,0,.22)';
        g.beginPath();
        g.ellipse(cx + 4, cy + 5, S * 0.44, S * 0.36, 0, 0, Math.PI * 2);
        g.fill();
        // 树冠团
        const blobs = [
          [cx, cy - 1, S * 0.40],
          [cx - S * 0.26, cy + S * 0.12, S * 0.28],
          [cx + S * 0.26, cy + S * 0.12, S * 0.28],
          [cx, cy + S * 0.22, S * 0.30],
        ];
        blobs.forEach((b, i) => {
          g.fillStyle = d.leaf[i % 2];
          g.beginPath();
          g.arc(b[0], b[1], b[2], 0, Math.PI * 2);
          g.fill();
        });
        // 顶部高光
        g.fillStyle = d.leaf[1];
        g.beginPath();
        g.arc(cx - S * 0.10, cy - S * 0.14, S * 0.22, 0, Math.PI * 2);
        g.fill();
      }));
    });
    return out;
  }

  /* ============ 背景（草地 + 暗角），只烘焙一次 ============ */
  function background() {
    return canvas(RG.CFG.VW, RG.CFG.VH, g => {
      const grad = g.createLinearGradient(0, 0, 0, RG.CFG.VH);
      grad.addColorStop(0, '#5dad66');
      grad.addColorStop(0.5, '#47a154');
      grad.addColorStop(1, '#2f7a3a');
      g.fillStyle = grad;
      g.fillRect(0, 0, RG.CFG.VW, RG.CFG.VH);
      // 割草纹带
      g.fillStyle = 'rgba(255,255,255,.04)';
      for (let y = 0; y < RG.CFG.VH; y += 96) g.fillRect(0, y, RG.CFG.VW, 48);
      g.fillStyle = 'rgba(0,40,10,.06)';
      for (let y = 48; y < RG.CFG.VH; y += 96) g.fillRect(0, y, RG.CFG.VW, 48);
      // 细噪声点
      g.fillStyle = 'rgba(255,255,255,.05)';
      for (let i = 0; i < 60; i++) {
        g.fillRect(Math.random() * RG.CFG.VW, Math.random() * RG.CFG.VH, 2, 2);
      }
      // 边缘暗角
      const vg = g.createRadialGradient(RG.CFG.VW / 2, RG.CFG.VH / 2, RG.CFG.VH * 0.42, RG.CFG.VW / 2, RG.CFG.VH / 2, RG.CFG.VH * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,20,0,.34)');
      g.fillStyle = vg;
      g.fillRect(0, 0, RG.CFG.VW, RG.CFG.VH);
    });
  }

  /* ============ 远景雾带（顶部纵深） ============ */
  function fog() {
    return canvas(RG.CFG.VW, 180, g => {
      const fg = g.createLinearGradient(0, 0, 0, 180);
      fg.addColorStop(0, 'rgba(196,224,240,.42)');
      fg.addColorStop(0.7, 'rgba(196,224,240,.10)');
      fg.addColorStop(1, 'rgba(196,224,240,0)');
      g.fillStyle = fg;
      g.fillRect(0, 0, RG.CFG.VW, 180);
    });
  }

  /* ============ 沥青路面贴图 ============ */
  function asphaltTile() {
    const T = 128;
    const c = document.createElement('canvas');
    c.width = T; c.height = T;
    const g = c.getContext('2d');
    g.fillStyle = '#34363d';
    g.fillRect(0, 0, T, T);
    g.fillStyle = '#2b2d33';
    g.fillRect(0, 0, T, T * 0.06);
    g.fillStyle = '#3a3d45';
    for (let i = 0; i < 190; i++) {
      const x = Math.random() * T, y = Math.random() * T, s = Math.random() * 2 + 0.6;
      g.fillRect(x, y, s, s * (Math.random() > 0.5 ? 1.6 : 1));
    }
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 60; i++) {
      g.fillRect(Math.random() * T, Math.random() * T, 1.4, 1.4);
    }
    // 轮胎磨损暗痕
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.fillRect(T * 0.16, 0, 9, T);
    g.fillRect(T * 0.78, 0, 9, T);
    return c;
  }

  return {
    buildAll() {
      return {
        player: playerCar(),
        ai: aiPool(),
        gems: gemSprite(),
        trees: treeSprites(),
        bg: background(),
        fog: fog(),
        asphalt: asphaltTile(),
      };
    },
    /* 以逻辑尺寸为中心绘制贴图（内部按 SS 超采样缩小） */
    blit(g, img, x, y, sx, sy) {
      const w = img.width / SS * (sx == null ? 1 : sx);
      const h = img.height / SS * (sy == null ? 1 : sy);
      g.drawImage(img, x - w / 2, y - h / 2, w, h);
    },
  };
})();
