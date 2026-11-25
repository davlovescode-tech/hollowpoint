/* ============================================================
   HOLLOWPOINT · audio.js
   100% synthesised Web-Audio sound: layered gunshots (crack + body + thump + room tail),
   positional footsteps/impacts/shells, hit-markers, bullet whizz, wind bed.
   No audio files, no licences.
   ============================================================ */
"use strict";
(function () {
  const A = HP.audio = { ok: false, on: true };
  let ctx = null, master = null, comp = null, rev = null, revSend = null, noise = null, wind = null;
  const R = HP.rnd, clamp = HP.clamp;

  A.init = function () {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ctx = new AC({ latencyHint: "interactive" }); } catch (e) { return; }
    master = ctx.createGain(); master.gain.value = HP.set.vol * (A.on ? 1 : 0);
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.18;
    master.connect(comp); comp.connect(ctx.destination);
    // noise buffer (2s)
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // reverb impulse: dusty open-air slap + long tail
    rev = ctx.createConvolver(); const len = Math.floor(ctx.sampleRate * 1.9), ib = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ib.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const t = i / len; const w = (Math.random() * 2 - 1); lp += (w - lp) * (0.55 - 0.45 * t); ch[i] = lp * Math.pow(1 - t, 3.2) * (i < 900 ? i / 900 : 1) * (1 + (i > ctx.sampleRate * 0.09 && i < ctx.sampleRate * 0.12 ? 1.4 : 0)); } }
    rev.buffer = ib; revSend = ctx.createGain(); revSend.gain.value = 0.55; revSend.connect(rev); const rg = ctx.createGain(); rg.gain.value = 0.9; rev.connect(rg); rg.connect(master);
    A.startWind(); A.ok = true;
  };
  A.setVol = v => { if (master) master.gain.value = (A.on ? 1 : 0) * v; };
  A.setOn = on => { A.on = on; if (master) master.gain.value = on ? HP.set.vol : 0; };
  A.resume = () => { if (ctx && ctx.state === "suspended") ctx.resume(); };

  A.startWind = function () {
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true; const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 420; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.05; const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; const lg = ctx.createGain(); lg.gain.value = 0.03; lfo.connect(lg); lg.connect(g.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.05; const lg2 = ctx.createGain(); lg2.gain.value = 180; lfo2.connect(lg2); lg2.connect(bp.frequency);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(); lfo.start(); lfo2.start(); wind = g;
  };
  A.setWind = k => { if (wind) wind.gain.value = 0.05 * k; };

  /* listener follows the camera */
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0);
  A.listen = function (cam) {
    if (!ctx) return; const l = ctx.listener, p = cam.position; _f.set(0, 0, -1).applyQuaternion(cam.quaternion); _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) { const t = ctx.currentTime; l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t); l.forwardX.setValueAtTime(_f.x, t); l.forwardY.setValueAtTime(_f.y, t); l.forwardZ.setValueAtTime(_f.z, t); l.upX.setValueAtTime(_u.x, t); l.upY.setValueAtTime(_u.y, t); l.upZ.setValueAtTime(_u.z, t); }
    else { l.setPosition(p.x, p.y, p.z); l.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
  };

  /* output node for a sound: 2D (own sounds) or positioned. returns {out, send(amount)} */
  function bus(x, y, z, vol, wet) {
    const g = ctx.createGain(); g.gain.value = vol; let tail = null;
    if (x == null) { g.connect(master); } else {
      const p = ctx.createPanner(); p.panningModel = HP.TOUCH ? "equalpower" : "HRTF"; p.distanceModel = "inverse"; p.refDistance = 5; p.rolloffFactor = 1.15; p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); g.connect(p); p.connect(master);
    }
    if (wet) { tail = ctx.createGain(); tail.gain.value = wet; g.connect(tail); tail.connect(revSend); }
    return g;
  }
  function nsrc(dur, rate) { const s = ctx.createBufferSource(); s.buffer = noise; s.playbackRate.value = rate || 1; s.loop = true; s.start(ctx.currentTime, Math.random() * 1.5); s.stop(ctx.currentTime + dur + 0.05); return s; }
  function env(g, t0, a, peak, d) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
  function noiseHit(out, t, a, d, type, f0, f1, q, peak) {
    const s = nsrc(d + a), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + a + d); f.Q.value = q || 0.7; env(g, t, a, peak, d); s.connect(f); f.connect(g); g.connect(out);
  }
  function tone(out, t, type, f0, f1, a, d, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + a + d); env(g, t, a, peak, d); o.connect(g); g.connect(out); o.start(t); o.stop(t + a + d + 0.05);
  }

  /* ---------- gunshots ---------- */
  const SHOT = {
    ar: { crack: [0.026, 0.9, 3400], body: [0.16, 900, 1.0], thump: [95, 0.13, 0.9], tail: 0.5 },
    smg: { crack: [0.02, 0.8, 4200], body: [0.1, 1500, 0.8], thump: [130, 0.09, 0.6], tail: 0.35 },
    sg: { crack: [0.04, 1.0, 2400], body: [0.42, 520, 1.5], thump: [62, 0.3, 1.3], tail: 0.9 },
    sn: { crack: [0.06, 1.2, 2800], body: [0.55, 460, 1.7], thump: [55, 0.45, 1.5], tail: 1.25 },
    pi: { crack: [0.026, 0.85, 3000], body: [0.13, 1000, 0.9], thump: [110, 0.11, 0.75], tail: 0.5 },
  };
  A.shot = function (id, x, y, z, vol) {
    if (!ctx || !A.on) return; const s = SHOT[id] || SHOT.ar, t = ctx.currentTime, own = x == null; const out = bus(x, y, z, (vol == null ? 1 : vol) * (own ? 0.95 : 1.5), s.tail * (own ? 0.8 : 1.15));
    const pit = R(0.93, 1.08);
    noiseHit(out, t, 0.001, s.crack[0], "highpass", s.crack[2] * pit, null, 0.6, s.crack[1]);
    noiseHit(out, t, 0.002, s.body[0], "lowpass", s.body[1] * 2.2 * pit, s.body[1] * 0.35, 0.8, s.body[2]);
    tone(out, t, "sine", s.thump[0] * pit * 1.6, s.thump[0] * 0.42, 0.002, s.thump[1], s.thump[2] * 0.9);
    tone(out, t, "triangle", s.thump[0] * 2.6 * pit, s.thump[0], 0.001, s.thump[1] * 0.6, s.thump[2] * 0.35);
    if (id === "sg") { noiseHit(out, t + 0.012, 0.004, 0.2, "bandpass", 900, 300, 0.9, 0.7); }
    if (id === "sn") { noiseHit(out, t + 0.03, 0.01, 0.5, "bandpass", 700, 200, 0.6, 0.5); }
    if (!own) { const d2 = Math.hypot(x - HP.camera.position.x, z - HP.camera.position.z); if (d2 > 60) noiseHit(out, t + d2 / 340, 0.01, 0.6, "lowpass", 400, 150, 0.7, 0.25); }
  };
  A.empty = function () { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(null, 0, 0, 0.5); noiseHit(o, t, 0.0005, 0.02, "bandpass", 3200, 2500, 2, 0.7); tone(o, t, "square", 900, 500, 0.0005, 0.02, 0.1); };
  A.reload = function (kind) {
    if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(null, 0, 0, 0.8);
    if (kind === "out") { noiseHit(o, t, 0.001, 0.05, "bandpass", 1800, 900, 3, 0.6); tone(o, t, "square", 420, 220, 0.001, 0.05, 0.12); noiseHit(o, t + 0.12, 0.001, 0.06, "lowpass", 800, 300, 1, 0.5); }
    else if (kind === "in") { noiseHit(o, t, 0.001, 0.04, "bandpass", 2400, 1200, 3, 0.7); tone(o, t, "square", 650, 300, 0.001, 0.04, 0.14); noiseHit(o, t + 0.06, 0.001, 0.07, "lowpass", 1400, 500, 1, 0.6); }
    else if (kind === "rack") { noiseHit(o, t, 0.001, 0.05, "bandpass", 2800, 1600, 3, 0.65); tone(o, t + 0.07, "square", 520, 260, 0.001, 0.05, 0.14); noiseHit(o, t + 0.07, 0.001, 0.05, "bandpass", 1600, 900, 3, 0.7); }
    else if (kind === "shell") { noiseHit(o, t, 0.001, 0.04, "bandpass", 2200, 1100, 3, 0.55); tone(o, t, "triangle", 1500, 800, 0.001, 0.06, 0.1); }
    else if (kind === "pump") { noiseHit(o, t, 0.002, 0.07, "bandpass", 1400, 600, 2, 0.8); noiseHit(o, t + 0.14, 0.002, 0.08, "bandpass", 1600, 700, 2, 0.8); tone(o, t + 0.14, "square", 300, 150, 0.001, 0.05, 0.12); }
    else if (kind === "bolt") { noiseHit(o, t, 0.002, 0.07, "bandpass", 1500, 700, 2, 0.8); noiseHit(o, t + 0.2, 0.002, 0.09, "bandpass", 1900, 800, 2, 0.8); }
  };
  A.boom = function (x, y, z) { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(x, y, z, 1.6, 0.9); noiseHit(o, t, 0.004, 0.5, "lowpass", 1800, 120, 0.7, 1.0); noiseHit(o, t, 0.002, 0.12, "bandpass", 2600, 600, 1.2, 0.8); tone(o, t, "sine", 78, 26, 0.004, 0.9, 1.3); tone(o, t + 0.02, "triangle", 140, 40, 0.004, 0.5, 0.7); noiseHit(o, t + 0.25, 0.2, 1.4, "lowpass", 500, 90, 0.7, 0.45); };
  A.slide = function () { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(null, 0, 0, 0.6); noiseHit(o, t, 0.03, 0.55, "bandpass", 1100, 260, 0.9, 0.35); };
  A.equip = function () { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(null, 0, 0, 0.5); noiseHit(o, t, 0.003, 0.08, "bandpass", 900, 500, 1.2, 0.6); noiseHit(o, t + 0.09, 0.001, 0.04, "bandpass", 2200, 1200, 3, 0.4); };
  A.step = function (x, y, z, run, vol) { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(x, y, z, (vol == null ? 1 : vol) * (run ? 0.9 : 0.55), 0.08); noiseHit(o, t, 0.002, 0.07, "lowpass", 900 * R(0.8, 1.2), 300, 0.6, 0.7); noiseHit(o, t, 0.001, 0.025, "highpass", 3000, null, 0.5, 0.18); };
  A.jump = function (x, y, z) { if (!ctx || !A.on) return; const o = bus(x, y, z, x == null ? 0.5 : 0.8); noiseHit(o, ctx.currentTime, 0.004, 0.1, "lowpass", 700, 300, 0.7, 0.5); };
  A.land = function (x, y, z, f) { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(x, y, z, (x == null ? 0.8 : 1) * clamp(f, 0.3, 1.4)); noiseHit(o, t, 0.002, 0.14, "lowpass", 800, 200, 0.8, 0.9); tone(o, t, "sine", 90, 45, 0.002, 0.12, 0.5); };
  A.shell = function (x, y, z) { if (!ctx || !A.on) return; const d = Math.hypot(x - HP.camera.position.x, z - HP.camera.position.z); if (d > 12) return; const t = ctx.currentTime, o = bus(x, y, z, 0.35); tone(o, t, "sine", R(3300, 5200), null, 0.001, 0.05, 0.5); tone(o, t + 0.01, "sine", R(5200, 7000), null, 0.001, 0.03, 0.2); };
  A.impact = function (surf, x, y, z) {
    if (!ctx || !A.on) return; const d = Math.hypot(x - HP.camera.position.x, z - HP.camera.position.z); if (d > 40) return; const t = ctx.currentTime, o = bus(x, y, z, 0.6, 0.1);
    if (surf === "metal") { noiseHit(o, t, 0.001, 0.05, "bandpass", 2800, 1800, 4, 0.8); tone(o, t, "sine", R(1200, 2200), null, 0.001, 0.18, 0.12); }
    else if (surf === "wood") { noiseHit(o, t, 0.001, 0.06, "bandpass", 700, 300, 2, 0.9); }
    else if (surf === "stone") { noiseHit(o, t, 0.001, 0.05, "bandpass", 1800, 800, 2, 0.8); }
    else { noiseHit(o, t, 0.002, 0.1, "lowpass", 1100, 300, 0.8, 0.7); }
  };
  A.whiz = function (x, y, z) { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(x, y, z, 0.7); noiseHit(o, t, 0.01, 0.16, "bandpass", R(2600, 3600), 900, 5, 0.8); };
  /* ---------- feedback ---------- */
  A.hit = function (head, kill) {
    if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(null, 0, 0, 0.55);
    if (kill) { tone(o, t, "sine", 1100, 700, 0.001, 0.09, 0.5); tone(o, t + 0.05, "sine", 1600, 1000, 0.001, 0.12, 0.45); tone(o, t, "sine", 120, 60, 0.002, 0.2, 0.7); noiseHit(o, t, 0.001, 0.05, "bandpass", 2500, 1500, 2, 0.6); }
    else if (head) { tone(o, t, "sine", 2300, 2100, 0.001, 0.16, 0.5); tone(o, t, "sine", 3500, 3100, 0.001, 0.12, 0.28); noiseHit(o, t, 0.001, 0.03, "highpass", 3000, null, 0.5, 0.4); }
    else { tone(o, t, "sine", 1500, 1200, 0.001, 0.05, 0.4); noiseHit(o, t, 0.001, 0.025, "highpass", 2500, null, 0.5, 0.3); }
  };
  A.hurt = function (big) { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(null, 0, 0, 0.9); noiseHit(o, t, 0.002, 0.16, "lowpass", 700, 200, 0.8, 0.9); tone(o, t, "sine", 95, 48, 0.002, 0.18, 0.7); if (big) tone(o, t, "sine", 55, 30, 0.003, 0.35, 0.8); };
  A.die = function () { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(null, 0, 0, 1); tone(o, t, "sine", 80, 28, 0.003, 0.8, 0.9); noiseHit(o, t, 0.004, 0.5, "lowpass", 900, 120, 0.7, 0.8); tone(o, t + 0.05, "sawtooth", 220, 70, 0.01, 0.6, 0.12); };
  A.spawn = function () { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(null, 0, 0, 0.5); tone(o, t, "sine", 330, 660, 0.01, 0.22, 0.25); tone(o, t + 0.1, "sine", 495, 990, 0.01, 0.25, 0.2); };
  A.ui = function (kind) { if (!ctx || !A.on) return; const t = ctx.currentTime, o = bus(null, 0, 0, 0.45); if (kind === "go") { tone(o, t, "square", 660, 660, 0.002, 0.25, 0.2); tone(o, t + 0.12, "square", 990, 990, 0.002, 0.35, 0.18); } else if (kind === "tick") { tone(o, t, "sine", 880, 880, 0.002, 0.08, 0.3); } else if (kind === "win") { [523, 659, 784, 1046].forEach((f, i) => tone(o, t + i * 0.12, "triangle", f, f, 0.004, 0.4, 0.25)); } else { tone(o, t, "sine", 1200, 900, 0.001, 0.04, 0.22); noiseHit(o, t, 0.001, 0.02, "highpass", 3000, null, 0.5, 0.12); } };
})();
