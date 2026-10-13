/* ზარაფხანა — synthesized sound effects (no audio files) */
(function () {
  const Z = window.Z;
  let ctx = null, master = null, on = Z.store.get('zar-sound', true) !== false, lastTick = 0;
  function ensure() {
    if (!on) return null;
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = 0.32; master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { return null; }
    return ctx;
  }
  document.addEventListener('pointerdown', () => { if (on) ensure(); }, { passive: true });
  function tone(f, t0, dur, type, vol, f2) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function noise(t0, dur, vol, lp) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const b = ctx.createBuffer(1, len, ctx.sampleRate), data = b.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = b; f.type = 'lowpass'; f.frequency.value = lp || 1500; g.gain.value = vol || 0.3;
    s.connect(f); f.connect(g); g.connect(master); s.start(t0);
  }
  const SOUNDS = {
    coin: (t) => { tone(1568, t, 0.12, 'triangle', 0.3); tone(2093, t + 0.06, 0.2, 'triangle', 0.26); },
    win: (t) => { [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.07, 0.24, 'triangle', 0.28)); },
    lose: (t) => { tone(330, t, 0.22, 'sawtooth', 0.08, 220); tone(247, t + 0.12, 0.32, 'sine', 0.2, 150); },
    tick: (t) => tone(1900, t, 0.03, 'square', 0.05),
    boom: (t) => { noise(t, 0.7, 0.6, 900); tone(95, t, 0.55, 'sine', 0.45, 38); },
    card: (t) => noise(t, 0.07, 0.22, 4200),
    roll: (t) => { for (let i = 0; i < 6; i++) noise(t + i * 0.06, 0.04, 0.16, 2600); },
    click: (t) => tone(880, t, 0.05, 'sine', 0.08),
    ach: (t) => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, t + i * 0.09, 0.32, 'sine', 0.25)); },
    send: (t) => tone(660, t, 0.09, 'sine', 0.18, 990),
    msg: (t) => { tone(1046, t, 0.08, 'sine', 0.15); tone(1318, t + 0.07, 0.1, 'sine', 0.13); },
    bell: (t) => { tone(1318, t, 0.5, 'sine', 0.18); tone(1975, t, 0.35, 'sine', 0.08); },
  };
  Z.sfx = (name) => {
    if (!on) return;
    if (name === 'tick') { const n = performance.now(); if (n - lastTick < 45) return; lastTick = n; }
    const c = ensure();
    if (!c || c.state !== 'running' || !SOUNDS[name]) return;
    try { SOUNDS[name](c.currentTime + 0.005); } catch (e) {}
  };
  Z.soundOn = () => on;
  Z.setSound = (v) => { on = !!v; Z.store.set('zar-sound', on); if (on) { ensure(); setTimeout(() => Z.sfx('click'), 30); } };
})();
