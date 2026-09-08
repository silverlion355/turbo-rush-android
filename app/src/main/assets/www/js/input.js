/* input.js — 统一输入层：键盘 + 触屏/鼠标拖动（Pointer Events）
   只产出"意图"，不直接改游戏状态，便于测试与换壳 */
'use strict';
window.RG = window.RG || {};

RG.Input = class Input {
  constructor(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.getCarX = opts.getCarX || (() => 0);

    this.keys = {};
    this.targetX = null;   // 拖动目标位置（null=无拖动）
    this._pid = null;
    this._startPX = 0;
    this._startCarX = 0;

    this._onKeyDown = e => this._key(e, true);
    this._onKeyUp = e => this._key(e, false);
    this._onPD = e => this._down(e);
    this._onPM = e => this._move(e);
    this._onPU = e => this._up(e);

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp, { passive: false });
    canvas.addEventListener('pointerdown', this._onPD);
    canvas.addEventListener('pointermove', this._onPM);
    canvas.addEventListener('pointerup', this._onPU);
    canvas.addEventListener('pointercancel', this._onPU);

    this._block = e => e.preventDefault();
    canvas.addEventListener('contextmenu', this._block);
    document.addEventListener('gesturestart', this._block);
    document.addEventListener('dblclick', this._block);
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('pointerdown', this._onPD);
    this.canvas.removeEventListener('pointermove', this._onPM);
    this.canvas.removeEventListener('pointerup', this._onPU);
    this.canvas.removeEventListener('pointercancel', this._onPU);
  }

  _key(e, down) {
    const c = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(c)) e.preventDefault();
    this.keys[c] = down;
    this.keys[c.toLowerCase()] = down;
  }

  /* 归一化到逻辑坐标 */
  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return (e.clientX - r.left) / r.width * RG.CFG.VW;
  }

  _down(e) {
    if (this._pid !== null) return; // 只跟踪第一根手指
    this._pid = e.pointerId;
    this._startPX = this._pos(e);
    this._startCarX = this.getCarX();
    this.targetX = null;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    if (this.onTouchStart) this.onTouchStart();
  }

  _move(e) {
    if (e.pointerId !== this._pid) return;
    const px = this._pos(e);
    const dx = px - this._startPX;
    this.targetX = RG.clamp(
      this._startCarX + dx * 1.15,
      RG.CFG.ROAD_LEFT + 24,
      RG.CFG.ROAD_RIGHT - 24
    );
  }

  _up(e) {
    if (e.pointerId !== this._pid) return;
    this._pid = null;
    this.targetX = null;
  }

  /* 键盘横向 -1 / 0 / +1 */
  axis() {
    let a = 0;
    if (this.keys.ArrowLeft || this.keys.a || this.keys.A) a -= 1;
    if (this.keys.ArrowRight || this.keys.d || this.keys.D) a += 1;
    return a;
  }
  boost() {
    return !!(this.keys.ArrowUp || this.keys.w || this.keys.W);
  }
  brake() {
    return !!(this.keys.ArrowDown || this.keys.s || this.keys.S);
  }
  hasPointer() { return this._pid !== null; }
};
