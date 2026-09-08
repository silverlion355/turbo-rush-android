/* audio.js — WebAudio 程序化音效（无外部音频文件，Android 壳下零资源加载） */
'use strict';
window.RG = window.RG || {};

RG.Audio = {
  ctx: null,
  master: null,
  engOsc: null, engGain: null, engFilter: null,
  noiseBuf: null,
  muted: false,

  ensure() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.6;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) {
        return false;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  },

  /* —— 引擎：随速度/油门变化的持续音 —— */
  engineStart() {
    if (!this.ensure()) return;
    if (this.engOsc) return;
    const t = this.ctx.currentTime;
    this.engOsc = this.ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc.frequency.value = 60;
    this.engFilter = this.ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 260;
    this.engGain = this.ctx.createGain();
    this.engGain.gain.value = 0;
    this.engOsc.connect(this.engFilter).connect(this.engGain).connect(this.master);
    this.engOsc.start();
  },
  engineSet(speedRatio, throttle) {
    if (!this.engOsc || this.muted) return;
    const t = this.ctx.currentTime;
    const r = RG.clamp(speedRatio, 0, 1);
    this.engOsc.frequency.setTargetAtTime(50 + r * 150 + (throttle || 0) * 40, t, 0.12);
    this.engFilter.frequency.setTargetAtTime(240 + r * 1100, t, 0.15);
    this.engGain.gain.setTargetAtTime(0.028 + r * 0.045, t, 0.15);
  },
  engineStop() {
    if (!this.engOsc) return;
    try {
      this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      const o = this.engOsc;
      setTimeout(() => { try { o.stop(); } catch (e) {} }, 400);
    } catch (e) {}
    this.engOsc = null; this.engGain = null; this.engFilter = null;
  },

  /* 宝石拾取：两声上行短音；连击时整体升半音（最多 12 连 = 1 个八度） */
  gem(chain) {
    if (!this.ensure()) return;
    const step = Math.max(0, Math.min((chain || 0) - 1, 12));
    const base = 660 * Math.pow(2, step / 12);   // 每连 +1 半音
    const t = this.ctx.currentTime;
    [base, base * 1.5].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.01 + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16 + i * 0.05);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.05); o.stop(t + 0.3 + i * 0.05);
    });
  },

  /* 碰撞：噪声爆破 + 低频下坠 */
  crash() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.2); src.stop(t + 0.5);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.35, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.45);
  },

  click() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = 520;
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.1);
  },
};
