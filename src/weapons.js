/* ============================================================
   HOLLOWPOINT · weapons.js
   Weapon stats + procedural, fully-PBR first-person gun models with
   hands, recoil/sway/bob springs, ADS, reload & switch animation.
   ============================================================ */
"use strict";
(function () {
  const T = THREE, clamp = HP.clamp, lerp = HP.lerp;

  /* ---------- stats ---------- */
  HP.WEAPONS = {
    arc7: { id: "arc7", name: "ARC-7", kind: "Assault rifle", auto: true, rpm: 640, dmg: 22, head: 2.0, leg: 0.75, pellets: 1, mag: 30, reload: 2.2, fall: [26, 75, 0.55], hip: 2.4, ads: 0.28, bloom: 0.2, bloomMax: 3.2, kick: [0.6, 0.22], zoom: 1.3, move: 0.95, scope: 0, range: 220, tracer: [1, 0.82, 0.5], snd: "ar" },
    viper: { id: "viper", name: "VIPER-9", kind: "Submachine gun", auto: true, rpm: 900, dmg: 15, head: 1.8, leg: 0.75, pellets: 1, mag: 32, reload: 1.7, fall: [12, 42, 0.45], hip: 2.8, ads: 0.55, bloom: 0.26, bloomMax: 4, kick: [0.42, 0.3], zoom: 1.2, move: 1.05, scope: 0, range: 140, tracer: [1, 0.85, 0.55], snd: "smg" },
    hammer: { id: "hammer", name: "HAMMER-12", kind: "Pump shotgun", auto: false, rpm: 78, dmg: 12, head: 1.5, leg: 0.8, pellets: 9, mag: 6, reload: 2.7, fall: [5, 20, 0.12], hip: 4.4, ads: 3.4, bloom: 0, bloomMax: 0, kick: [3.4, 0.5], zoom: 1.12, move: 1.0, scope: 0, range: 60, tracer: [1, 0.78, 0.4], snd: "sg", pump: true },
    longshot: { id: "longshot", name: "LONGSHOT-50", kind: "Bolt sniper", auto: false, rpm: 50, dmg: 88, head: 2.6, leg: 0.75, pellets: 1, mag: 5, reload: 3.0, fall: [400, 800, 1], hip: 7, ads: 0.02, bloom: 0, bloomMax: 0, kick: [3.2, 0.5], zoom: 3.6, move: 0.85, scope: 1, range: 500, tracer: [1, 0.9, 0.7], snd: "sn", bolt: true },
    sidekick: { id: "sidekick", name: "SIDEKICK .45", kind: "Sidearm", auto: false, rpm: 400, dmg: 27, head: 2.2, leg: 0.8, pellets: 1, mag: 12, reload: 1.5, fall: [14, 48, 0.5], hip: 1.9, ads: 0.4, bloom: 0.5, bloomMax: 3.2, kick: [1.15, 0.32], zoom: 1.15, move: 1.08, scope: 0, range: 120, tracer: [1, 0.85, 0.55], snd: "pi" },
  };
  HP.WORDER = ["arc7", "viper", "hammer", "longshot", "sidekick"];
  HP.damageAt = (w, dist) => { const f = w.fall; if (dist <= f[0]) return 1; if (dist >= f[1]) return f[2]; return 1 + (f[2] - 1) * (dist - f[0]) / (f[1] - f[0]); };

  /* ---------- materials & geometry helpers ---------- */
  let GM = null;
  function noiseBump() {
    const cv = document.createElement("canvas"); cv.width = cv.height = 128; const c = cv.getContext("2d"), id = c.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) { const v = 90 + Math.random() * 120; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; } c.putImageData(id, 0, 0);
    const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(3, 3); return t;
  }
  function mats() {
    if (GM) return GM; const bump = noiseBump();
    const M = (c, r, m, e, b) => new T.MeshStandardMaterial({ color: c, roughness: r, metalness: m, envMapIntensity: e, bumpMap: null });
    GM = {
      metal: M(0x23282e, 0.52, 0.82, 0.8, 0.6), metalLt: M(0x6c737b, 0.46, 0.85, 0.9, 0.4), poly: M(0x14161a, 0.5, 0.1, 1.2, 0.8), tan: M(0x7b6a4c, 0.55, 0.1, 1.2, 0.8),
      wood: M(0x5b3a22, 0.55, 0.05, 1.1, 0.5), rubber: M(0x0d0d0d, 0.9, 0, 0.6), brass: M(0xb08d42, 0.3, 1, 1.4),
      glove: M(0x17181a, 0.7, 0.05, 0.8, 1.2), sleeve: M(0x30361f, 0.95, 0, 0.7, 1.5), skin: M(0x7a5a45, 0.7, 0, 1),
      lens: new T.MeshStandardMaterial({ color: 0x0b1620, roughness: 0.04, metalness: 0.9, envMapIntensity: 2.4, transparent: true, opacity: 0.55 }),
      dot: new T.MeshBasicMaterial({ color: new T.Color(6, 0.3, 0.2), toneMapped: false }),
    };
    return GM;
  }
  function RB(w, h, d, r, seg) {
    const g = new T.BoxGeometry(w, h, d, seg || 3, seg || 3, seg || 3), p = g.attributes.position, n = g.attributes.normal; r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ix = clamp(x, -hx, hx), iy = clamp(y, -hy, hy), iz = clamp(z, -hz, hz); let dx = x - ix, dy = y - iy, dz = z - iz; const l = Math.hypot(dx, dy, dz);
      if (l > 1e-6) { dx /= l; dy /= l; dz /= l; p.setXYZ(i, ix + dx * r, iy + dy * r, iz + dz * r); n.setXYZ(i, dx, dy, dz); }
    } return g;
  }
  function CZ(r1, r2, len, seg) { const g = new T.CylinderGeometry(r1, r2, len, seg || 14); g.rotateX(-Math.PI / 2); return g; }   // axis along Z, r1 at -Z (front)
  function mesh(parent, geo, mat, x, y, z, rx, ry, rz) { const m = new T.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(m); return m; }
  const grp = (parent, x, y, z) => { const g = new T.Group(); g.position.set(x || 0, y || 0, z || 0); if (parent) parent.add(g); return g; };
  const box = (parent, w, h, d, mat, x, y, z, r) => mesh(parent, RB(w, h, d, r == null ? 0.004 : r, 2), mat, x, y, z);
  function railTeeth(g, mat, z0, z1, y, n) { for (let i = 0; i < n; i++) box(g, 0.03, 0.006, 0.009, mat, 0, y, z0 + (z1 - z0) * i / (n - 1), 0.001); }
  function redDot(g, M, x, y, z) {
    const h = grp(g, x, y, z);
    box(h, 0.034, 0.012, 0.062, M.metal, 0, -0.026, 0, 0.004);
    box(h, 0.004, 0.036, 0.05, M.metal, -0.0155, 0, 0, 0.001); box(h, 0.004, 0.036, 0.05, M.metal, 0.0155, 0, 0, 0.001); box(h, 0.034, 0.006, 0.06, M.metal, 0, 0.021, 0, 0.002);
    mesh(h, new T.PlaneGeometry(0.027, 0.034), M.lens, 0, -0.002, -0.024, 0, Math.PI, 0);
    const d = mesh(h, new T.SphereGeometry(0.0016, 8, 6), M.dot, 0, 0.002, -0.02); d.renderOrder = 3; return h;
  }
  function hand(parent, M, x, y, z, rot, mirror, glove) {
    const h = grp(parent, x, y, z); h.rotation.set(rot[0], rot[1], rot[2]); const m = glove ? M.glove : M.skin, s = mirror ? -1 : 1;
    box(h, 0.052, 0.034, 0.088, m, 0, 0, 0, 0.012);                                  // palm
    for (let i = 0; i < 4; i++) { const f = grp(h, s * (-0.017 + i * 0.0115) * -1, 0.004, -0.05); box(f, 0.0105, 0.0125, 0.034, m, 0, 0, 0, 0.005); const f2 = grp(f, 0, 0, -0.017); f2.rotation.x = 0.8; box(f2, 0.0095, 0.0115, 0.028, m, 0, -0.008, -0.008, 0.004); }
    const th = grp(h, s * 0.032, 0.002, -0.012); th.rotation.set(0, s * -0.35, s * 0.25); box(th, 0.0135, 0.0135, 0.04, m, 0, 0, -0.012, 0.005);
    box(h, 0.058, 0.044, 0.04, M.sleeve, 0, 0.0, 0.058, 0.014);                      // cuff
    return h;
  }
  function sleeve(parent, M, fx, fy, fz, tx, ty, tz) {
    const dx = tx - fx, dy = ty - fy, dz = tz - fz, L = Math.hypot(dx, dy, dz); const g = new T.CylinderGeometry(0.052, 0.046, L, 12); g.translate(0, L / 2, 0);
    const m = new T.Mesh(g, M.sleeve); m.position.set(fx, fy, fz); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(dx / L, dy / L, dz / L)); parent.add(m); return m;
  }

  /* ---------- per-weapon builders. forward = -Z, right = +X ---------- */
  const B = {};
  B.arc7 = function (M) {
    const g = new T.Group(), a = { group: g };
    box(g, 0.05, 0.086, 0.3, M.metal, 0, 0, -0.02, 0.008); box(g, 0.048, 0.05, 0.2, M.poly, 0, -0.056, 0.0, 0.006); box(g, 0.028, 0.012, 0.42, M.metal, 0, 0.0505, -0.1, 0.002); railTeeth(g, M.metal, -0.28, 0.1, 0.057, 14);
    box(g, 0.058, 0.066, 0.3, M.poly, 0, -0.004, -0.31, 0.012); for (let i = 0; i < 5; i++) box(g, 0.0595, 0.016, 0.026, M.metal, 0, -0.004, -0.2 - i * 0.05, 0.002);
    mesh(g, CZ(0.0105, 0.0105, 0.26), M.metal, 0, -0.002, -0.58); box(g, 0.032, 0.03, 0.055, M.metal, 0, 0.005, -0.50, 0.005);
    mesh(g, CZ(0.017, 0.017, 0.07), M.metal, 0, -0.002, -0.7); for (let i = 0; i < 3; i++) box(g, 0.036, 0.004, 0.01, M.poly, 0, -0.002, -0.69 - i * 0.02, 0.001);
    a.muzzle = grp(g, 0, -0.002, -0.74); a.eject = grp(g, 0.028, 0.015, -0.04);
    box(g, 0.042, 0.092, 0.21, M.poly, 0, -0.016, 0.235, 0.012); box(g, 0.045, 0.1, 0.028, M.rubber, 0, -0.016, 0.34, 0.006); box(g, 0.036, 0.03, 0.12, M.poly, 0, 0.033, 0.19, 0.01);
    const gr = box(g, 0.032, 0.1, 0.05, M.poly, 0, -0.1, 0.068, 0.01); gr.rotation.x = 0.35;
    a.mag = grp(g, 0, -0.07, -0.05); const mg = box(a.mag, 0.03, 0.16, 0.056, M.poly, 0, -0.06, 0, 0.006); mg.rotation.x = 0.16; box(a.mag, 0.03, 0.012, 0.06, M.metal, 0, -0.14, 0.02, 0.003).rotation.x = 0.16;
    box(g, 0.006, 0.03, 0.008, M.metal, 0, -0.07, 0.01); box(g, 0.01, 0.012, 0.08, M.poly, 0, -0.082, 0.03, 0.004);
    box(g, 0.003, 0.02, 0.04, M.poly, 0.0265, 0.012, -0.05, 0.001);
    redDot(g, M, 0, 0.082, -0.035); a.ads = { x: 0, y: -0.082, z: -0.27 }; a.hip = { x: 0.15, y: -0.155, z: -0.3 };
    a.rh = [0.0, -0.106, 0.1, [0.6, 0, 0]]; a.lh = [-0.008, -0.062, -0.30, [0, 0, 0]];
    a.bolt = grp(g, 0.027, 0.02, -0.05); box(a.bolt, 0.01, 0.012, 0.03, M.metalLt, 0, 0, 0, 0.002);
    return a;
  };
  B.viper = function (M) {
    const g = new T.Group(), a = { group: g };
    box(g, 0.048, 0.07, 0.26, M.poly, 0, 0.005, -0.02, 0.008); box(g, 0.046, 0.032, 0.23, M.tan, 0, -0.04, -0.015, 0.006); box(g, 0.026, 0.012, 0.3, M.metal, 0, 0.048, -0.05, 0.002); railTeeth(g, M.metal, -0.18, 0.06, 0.055, 10);
    box(g, 0.054, 0.056, 0.14, M.poly, 0, 0.0, -0.24, 0.01); mesh(g, CZ(0.012, 0.012, 0.18), M.metal, 0, 0.003, -0.39); mesh(g, CZ(0.021, 0.021, 0.12, 16), M.metal, 0, 0.003, -0.49); for (let i = 0; i < 4; i++) mesh(g, CZ(0.0225, 0.0225, 0.006, 16), M.poly, 0, 0.003, -0.44 - i * 0.026);
    a.muzzle = grp(g, 0, 0.003, -0.55); a.eject = grp(g, 0.026, 0.02, -0.02);
    box(g, 0.036, 0.07, 0.17, M.poly, 0, 0.0, 0.2, 0.01); box(g, 0.04, 0.08, 0.025, M.rubber, 0, 0, 0.29, 0.005);
    const gr = box(g, 0.032, 0.098, 0.05, M.poly, 0, -0.09, 0.07, 0.01); gr.rotation.x = 0.3;
    a.mag = grp(g, 0, -0.06, -0.06); box(a.mag, 0.026, 0.19, 0.04, M.metal, 0, -0.08, 0, 0.004); box(a.mag, 0.028, 0.01, 0.042, M.poly, 0, -0.18, 0, 0.002);
    box(g, 0.01, 0.07, 0.014, M.poly, 0, -0.083, -0.2, 0.004);
    redDot(g, M, 0, 0.078, -0.03); a.ads = { x: 0, y: -0.078, z: -0.25 }; a.hip = { x: 0.15, y: -0.15, z: -0.28 };
    a.rh = [0.0, -0.1, 0.1, [0.5, 0, 0]]; a.lh = [-0.005, -0.06, -0.22, [0, 0, 0]];
    return a;
  };
  B.hammer = function (M) {
    const g = new T.Group(), a = { group: g };
    box(g, 0.048, 0.07, 0.24, M.metal, 0, 0.005, 0.0, 0.008); box(g, 0.026, 0.012, 0.4, M.metal, 0, 0.045, -0.2, 0.002);
    mesh(g, CZ(0.0165, 0.0165, 0.52, 16), M.metal, 0, 0.012, -0.5); mesh(g, CZ(0.0125, 0.0125, 0.46, 14), M.metal, 0, -0.026, -0.47);
    mesh(g, CZ(0.019, 0.019, 0.02, 16), M.metalLt, 0, 0.012, -0.76); box(g, 0.006, 0.014, 0.006, M.metalLt, 0, 0.034, -0.75, 0.001);
    a.muzzle = grp(g, 0, 0.012, -0.77); a.eject = grp(g, 0.028, 0.02, -0.02);
    a.pump = grp(g, 0, -0.026, -0.4); box(a.pump, 0.05, 0.044, 0.2, M.wood, 0, 0, 0, 0.012); for (let i = 0; i < 5; i++) box(a.pump, 0.052, 0.004, 0.012, M.poly, 0, 0, -0.07 + i * 0.03, 0.001);
    const st = box(g, 0.044, 0.1, 0.3, M.wood, 0, -0.018, 0.27, 0.014); st.rotation.x = -0.06; box(g, 0.048, 0.115, 0.028, M.rubber, 0, -0.026, 0.43, 0.006);
    const gr = box(g, 0.034, 0.09, 0.048, M.wood, 0, -0.085, 0.085, 0.012); gr.rotation.x = 0.3;
    a.mag = grp(g, 0, -0.04, -0.02); box(a.mag, 0.02, 0.012, 0.045, M.brass, 0, -0.02, 0, 0.004);
    a.ads = { x: 0, y: -0.048, z: -0.24 }; a.hip = { x: 0.15, y: -0.15, z: -0.3 };
    a.rh = [0.0, -0.1, 0.12, [0.55, 0, 0]]; a.lh = [0.0, -0.045, -0.4, [0, 0, 0]]; a.noMag = true; a.slideAnim = "pump";
    return a;
  };
  B.longshot = function (M) {
    const g = new T.Group(), a = { group: g };
    box(g, 0.05, 0.075, 0.34, M.metal, 0, 0.005, -0.02, 0.008); const st = box(g, 0.046, 0.1, 0.34, M.tan, 0, -0.01, 0.28, 0.014); st.rotation.x = -0.05; box(g, 0.05, 0.118, 0.03, M.rubber, 0, -0.016, 0.46, 0.006);
    box(g, 0.04, 0.05, 0.24, M.tan, 0, -0.03, -0.26, 0.012);
    mesh(g, CZ(0.0125, 0.0125, 0.52, 16), M.metal, 0, 0.012, -0.55); mesh(g, CZ(0.02, 0.02, 0.1, 16), M.metal, 0, 0.012, -0.85); for (let i = 0; i < 3; i++) box(g, 0.044, 0.004, 0.012, M.poly, 0, 0.012, -0.83 - i * 0.022, 0.001);
    a.muzzle = grp(g, 0, 0.012, -0.91); a.eject = grp(g, 0.03, 0.02, 0.0);
    const gr = box(g, 0.032, 0.095, 0.05, M.tan, 0, -0.09, 0.09, 0.01); gr.rotation.x = 0.3;
    a.mag = grp(g, 0, -0.06, -0.06); box(a.mag, 0.032, 0.07, 0.05, M.poly, 0, -0.035, 0, 0.004);
    box(g, 0.03, 0.012, 0.3, M.metal, 0, 0.05, -0.04, 0.002);
    // scope
    const sc = grp(g, 0, 0.1, -0.02); mesh(sc, CZ(0.019, 0.019, 0.24, 20), M.metal, 0, 0, 0); mesh(sc, CZ(0.03, 0.019, 0.07, 20), M.metal, 0, 0, -0.15); mesh(sc, CZ(0.026, 0.019, 0.05, 20), M.metal, 0, 0, 0.14);
    mesh(sc, new T.CircleGeometry(0.028, 20), M.lens, 0, 0, -0.1855); mesh(sc, CZ(0.0215, 0.0215, 0.02, 20), M.poly, 0, 0, 0.005); box(sc, 0.026, 0.01, 0.03, M.metal, 0, -0.05, -0.07, 0.003); box(sc, 0.026, 0.01, 0.03, M.metal, 0, -0.05, 0.08, 0.003);
    a.bolt = grp(g, 0.03, 0.012, 0.03); mesh(a.bolt, CZ(0.006, 0.006, 0.07, 8), M.metalLt, 0.035, 0, 0.0).rotation.set(0, Math.PI / 2, 0); mesh(a.bolt, new T.SphereGeometry(0.014, 12, 10), M.poly, 0.075, 0, 0);
    a.ads = { x: 0, y: -0.1, z: -0.22 }; a.hip = { x: 0.15, y: -0.16, z: -0.3 };
    a.rh = [0.0, -0.105, 0.115, [0.55, 0, 0]]; a.lh = [0.0, -0.05, -0.26, [0, 0, 0]]; a.scoped = true;
    return a;
  };
  B.sidekick = function (M) {
    const g = new T.Group(), a = { group: g };
    box(g, 0.03, 0.038, 0.19, M.metal, 0, 0.022, -0.04, 0.006); a.slide = g.children[g.children.length - 1];
    box(g, 0.028, 0.026, 0.12, M.poly, 0, -0.006, -0.03, 0.006);
    mesh(g, CZ(0.0095, 0.0095, 0.03, 12), M.metalLt, 0, 0.022, -0.145);
    a.muzzle = grp(g, 0, 0.022, -0.16); a.eject = grp(g, 0.017, 0.035, -0.03);
    const gr = box(g, 0.03, 0.11, 0.052, M.poly, 0, -0.07, 0.04, 0.008); gr.rotation.x = 0.22;
    box(g, 0.003, 0.02, 0.012, M.metalLt, 0, 0.046, -0.12, 0.001); box(g, 0.012, 0.012, 0.01, M.poly, 0, 0.048, 0.04, 0.002); box(g, 0.003, 0.012, 0.01, M.dot, 0, 0.0495, -0.125, 0.001); box(g, 0.003, 0.012, 0.012, M.dot, -0.006, 0.0495, 0.045, 0.001); box(g, 0.003, 0.012, 0.012, M.dot, 0.006, 0.0495, 0.045, 0.001);
    box(g, 0.006, 0.018, 0.008, M.metal, 0, -0.03, 0.0, 0.002); box(g, 0.008, 0.008, 0.07, M.poly, 0, -0.037, -0.018, 0.003);
    a.mag = grp(g, 0, -0.1, 0.045); box(a.mag, 0.024, 0.02, 0.04, M.metal, 0, -0.02, 0, 0.004);
    a.ads = { x: 0, y: -0.052, z: -0.24 }; a.hip = { x: 0.13, y: -0.12, z: -0.27 };
    a.rh = [0.0, -0.068, 0.045, [0.78, 0, 0]]; a.lh = [-0.026, -0.082, 0.03, [0.7, 0.4, 0.2]]; a.pistol = true;
    return a;
  };

  /* ---------- viewmodel controller ---------- */
  const VM = HP.vm = { w: null, model: null, root: null, st: {}, flashT: 0 };
  VM.init = function () {
    const M = mats(); VM.M = M; VM.root = new T.Group(); HP.vmAnchor.add(VM.root);
    VM.flash = new T.Sprite(new T.SpriteMaterial({ map: HP.fx.flashTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true, depthTest: false })); VM.flash.visible = false; VM.flash.renderOrder = 20; VM.flash.scale.setScalar(0.16); HP.vmAnchor.add(VM.flash);
    VM.light = new T.PointLight(0xffb868, 0, 2.5, 2); HP.vmAnchor.add(VM.light);
    VM.models = {}; VM.ads = 0; VM.kick = 0; VM.kickR = 0; VM.sx = 0; VM.sy = 0; VM.phase = 0; VM.sprintK = 0; VM.dip = 0; VM.rel = -1; VM.relDur = 1; VM.sw = 0; VM.swDir = 0; VM.nextW = null; VM.rack = 0; VM.fireT = 0;
    VM.landV = 0; VM.t = 0;
    HP.WORDER.forEach(id => { VM.models[id] = build(id, M); VM.models[id].group.visible = false; VM.root.add(VM.models[id].group); });
  };
  function build(id, M) {
    const a = B[id](M); const g = a.group; a.id = id; a.muzzle.name = "muzzle";
    g.traverse(o => { if (o.isMesh) { o.frustumCulled = false; } });
    a.tp = g.clone(true);                              // hands-free copy for third-person soldiers
    // arms: sleeves reach off the bottom of the screen
    a.rhG = hand(g, M, a.rh[0], a.rh[1], a.rh[2], a.rh[3], false, true); a.lhG = hand(g, M, a.lh[0], a.lh[1], a.lh[2], a.lh[3], true, true);
    a.rhG.position.set(a.rh[0], a.rh[1], a.rh[2]); a.lhG.position.set(a.lh[0], a.lh[1], a.lh[2]);
    sleeve(a.rhG, M, 0, 0, 0.07, 0.06, -0.2, 0.55); sleeve(a.lhG, M, 0, 0, 0.07, -0.1, -0.22, 0.55);
    a.rhBase = a.rhG.position.clone(); a.lhBase = a.lhG.position.clone(); a.lhRot = a.lhG.rotation.clone();
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    return a;
  }
  VM.equip = function (id, instant) {
    if (!VM.models) return; if (VM.w === id && VM.swDir === 0) return;
    if (instant || !VM.w) { VM.set(id); VM.sw = 0; VM.swDir = 0; return; }
    VM.nextW = id; VM.swDir = 1;
  };
  VM.set = function (id) { Object.keys(VM.models).forEach(k => VM.models[k].group.visible = k === id); VM.w = id; VM.model = VM.models[id]; VM.def = HP.WEAPONS[id]; VM.rel = -1; VM.rack = 0; VM.ads = 0; VM.kick = 0; VM.kickR = 0; };
  VM.reload = function (dur, cb) { VM.rel = 0; VM.relDur = dur; VM.relCb = cb; VM.relKey = 0; };
  VM.cancelReload = function () { VM.rel = -1; };
  VM.fire = function () {
    const m = VM.model, d = VM.def; if (!m) return;
    const sc = d.id === "hammer" ? 1.35 : d.id === "longshot" ? 1.5 : d.id === "sidekick" ? 0.7 : 1;
    VM.kick = Math.min(VM.kick + 0.7 * sc, 2.2); VM.kickR = Math.min(VM.kickR + (d.id === "hammer" || d.id === "longshot" ? 1.5 : 0.7), 2.2);
    VM.flashT = 0.045; m.muzzle.getWorldPosition(VM.flash.position); VM.flash.position.sub(HP.vmAnchor.position); VM.flash.visible = true; VM.flash.scale.setScalar(0.12 * sc * (0.8 + Math.random() * 0.5)); VM.flash.material.rotation = Math.random() * 6.28;
    VM.light.position.copy(VM.flash.position); VM.light.intensity = 3.2 * sc;
    if (m.pump) VM.rack = 1; if (m.slideAnim === "pump") VM.rack = 1; if (d.bolt) VM.rack = 1; if (m.slide) VM.rack = 0.5;
  };
  VM.muzzleWorld = function (out) { VM.model.muzzle.getWorldPosition(out); out.add(HP.camera.position); return out; };
  VM.ejectWorld = function (out) { VM.model.eject.getWorldPosition(out); out.add(HP.camera.position); return out; };
  const _e = new T.Euler();
  /* st: {speed, maxSpeed, sprint, aimK (0..1 target), crouch, ground, lx, ly (look delta rad)}.  returns scope amount 0..1 */
  VM.update = function (dt, st) {
    const m = VM.model; if (!m) return 0; VM.t += dt;
    const d = VM.def, root = VM.root; const aimT = st.aimK * (VM.rel >= 0 || VM.swDir ? 0.0 : 1) * (st.sprint ? 0 : 1);
    VM.ads += (aimT - VM.ads) * Math.min(1, dt * (d.scope ? 9 : 13)); const ads = VM.ads;
    VM.sprintK += ((st.sprint && st.speed > 1 ? 1 : 0) - VM.sprintK) * Math.min(1, dt * 9);
    // look sway (spring toward -look velocity)
    VM.sx += (clamp(-st.lx * 0.9, -0.05, 0.05) - VM.sx) * Math.min(1, dt * 12); VM.sy += (clamp(-st.ly * 0.9, -0.04, 0.04) - VM.sy) * Math.min(1, dt * 12);
    const sp = clamp(st.speed / Math.max(1, st.maxSpeed || 5.5), 0, 1.4) * (st.ground ? 1 : 0.15);
    VM.phase += dt * (6 + 5 * sp) * (st.sprint ? 1.25 : 1) * (sp > 0.05 ? 1 : 0.3);
    const bobA = HP.set.bobs ? (1 - ads * 0.85) : 0, bx = Math.sin(VM.phase) * 0.0075 * sp * bobA, by = -Math.abs(Math.cos(VM.phase)) * 0.0085 * sp * bobA + Math.sin(VM.t * 1.3) * 0.0008 * (1 - ads);
    VM.kick += (0 - VM.kick) * Math.min(1, dt * 11); VM.kickR += (0 - VM.kickR) * Math.min(1, dt * 7); VM.dip += (0 - VM.dip) * Math.min(1, dt * 8); if (st.landV) VM.dip = Math.min(0.06, VM.dip + st.landV);
    const hp = m.hip, ap = m.ads;
    let px = lerp(hp.x, ap.x, ads) + bx + VM.sx * (1 - ads * 0.8), py = lerp(hp.y, ap.y, ads) + by + VM.sy * (1 - ads * 0.8) - VM.dip * (1 - ads * 0.5) + (st.crouch ? 0.006 : 0), pz = lerp(hp.z, ap.z, ads) + VM.kick * 0.016 * (1 - ads * 0.4);
    let rx = VM.kickR * 0.05 * (1 - ads * 0.45) + VM.sy * 0.6, ry = VM.sx * 0.7 - 0.02 * (1 - ads) + bx * 1.3, rz = -bx * 2.5 + VM.sx * 0.5;
    // sprint pose: gun dips toward the hip, muzzle swung left
    const sk = VM.sprintK; px += -0.07 * sk; py += -0.045 * sk; pz += 0.0 * sk; rx += 0.12 * sk; ry += 0.62 * sk; rz += 0.22 * sk; // (ry>0 swings muzzle left)
    // weapon switch
    let swOff = 0; if (VM.swDir) { VM.sw += dt * (VM.swDir > 0 ? 6.5 : 5.5) * VM.swDir; if (VM.swDir > 0 && VM.sw >= 1) { VM.sw = 1; VM.set(VM.nextW); VM.swDir = -1; } else if (VM.swDir < 0 && VM.sw <= 0) { VM.sw = 0; VM.swDir = 0; } swOff = VM.sw; }
    py -= swOff * 0.32; rx -= swOff * 0.7;
    // reload
    let lhx = 0, lhy = 0, lhz = 0, magY = 0, magZ = 0, magVis = 1, rollR = 0, relK = 0;
    if (VM.rel >= 0) {
      VM.rel += dt / VM.relDur; const t = VM.rel; const e = (a, b) => clamp((t - a) / (b - a), 0, 1), sm = x => x * x * (3 - 2 * x);
      if (d.id === "hammer") {                           // shell-by-shell feel: gun rolls, hand feeds shells, pump at the end
        const k1 = sm(e(0, 0.12)), k2 = sm(e(0.85, 1)); relK = k1 * (1 - k2);
        rollR = 0.5 * relK; ry += 0.1 * relK; lhy = -0.02 * relK; const feed = Math.sin(clamp(e(0.12, 0.85), 0, 1) * Math.PI * 6) * 0.5 + 0.5; lhz = (0.45 + feed * 0.1) * relK * 0.5 * (t > 0.12 && t < 0.85 ? 1 : 0); lhy = -0.1 * relK * (t > 0.12 && t < 0.85 ? 1 : 0.2);
        if (t > 0.9 && t < 1) VM.rack = Math.max(VM.rack, 0.8);
        if (VM.relKey < 1 && t > 0.2) { VM.relKey = 1; HP.audio && HP.audio.reload("shell"); } if (VM.relKey < 2 && t > 0.45) { VM.relKey = 2; HP.audio && HP.audio.reload("shell"); } if (VM.relKey < 3 && t > 0.7) { VM.relKey = 3; HP.audio && HP.audio.reload("shell"); } if (VM.relKey < 4 && t > 0.9) { VM.relKey = 4; HP.audio && HP.audio.reload("pump"); }
      } else {
        const a1 = sm(e(0, 0.2)), a2 = sm(e(0.2, 0.4)), a3 = sm(e(0.5, 0.72)), a4 = sm(e(0.72, 0.9)), a5 = sm(e(0.9, 1));
        relK = (a1 - a5); rollR = 0.55 * relK; ry += 0.22 * relK; rx -= 0.1 * relK; py -= 0.035 * relK;
        lhx = 0.0; lhy = (-0.1 * a1 + 0.1 * a3 * 0.0) * (1 - a5); lhz = (0.12 * a1) * (1 - a5) * (m.pistol ? 0.2 : 1);
        magY = -0.28 * a2 * (1 - a3) - 0.0; magVis = a2 < 0.98 || a3 > 0.01 ? 1 : 0; magZ = 0.03 * a2 * (1 - a3);
        if (a3 > 0 && a3 < 1) magY = -0.28 * (1 - a3); if (a4 > 0) magY = 0;
        if (VM.relKey < 1 && t > 0.22) { VM.relKey = 1; HP.audio && HP.audio.reload("out"); } if (VM.relKey < 2 && t > 0.62) { VM.relKey = 2; HP.audio && HP.audio.reload("in"); } if (VM.relKey < 3 && t > 0.86) { VM.relKey = 3; HP.audio && HP.audio.reload("rack"); }
        if (m.bolt && t > 0.86 && t < 0.97) VM.rack = Math.max(VM.rack, 0.6);
      }
      if (VM.rel >= 1) { VM.rel = -1; if (VM.relCb) VM.relCb(); }
    }
    // slide / pump / bolt anim
    VM.rack = Math.max(0, VM.rack - dt * (d.id === "longshot" ? 0.9 : d.id === "hammer" ? 1.1 : 7)); const rk = VM.rack;
    if (m.pump) { m.pump.position.z = -0.4 + Math.sin(clamp(1 - rk, 0, 1) * Math.PI) * 0.0 + (rk > 0 ? -Math.sin(rk * Math.PI) * 0.09 : 0); }
    if (m.bolt && d.bolt) { const k = rk > 0 ? Math.sin(clamp(rk, 0, 1) * Math.PI) : 0; m.bolt.position.z = 0.03 + k * 0.07; m.bolt.rotation.z = k * 1.1; }
    if (m.slide) m.slide.position.z = -0.04 + Math.sin(rk * Math.PI) * 0.035; if (m.bolt && !d.bolt) m.bolt.position.z = -0.05 + Math.sin(rk * Math.PI) * 0.03;
    if (m.mag && !m.noMag) { m.mag.position.y = -0.07 + (m.pistol ? -0.03 : 0) + magY; m.mag.position.z = -0.05 + magZ; m.mag.rotation.x = magY * 1.2; m.mag.visible = !!magVis; }
    // left hand follows the mag during reloads
    m.lhG.position.set(m.lhBase.x + lhx, m.lhBase.y + lhy + (VM.rel >= 0 && !m.noMag ? magY * 0.9 * (m.pistol ? 0.5 : 1) : 0), m.lhBase.z + lhz);
    root.position.set(px, py, pz); _e.set(rx, ry, rz + rollR, "YXZ"); root.rotation.copy(_e);
    // muzzle flash decay
    if (VM.flashT > 0) { VM.flashT -= dt; if (VM.flashT <= 0) { VM.flash.visible = false; VM.light.intensity = 0; } else { m.muzzle.getWorldPosition(VM.flash.position); VM.light.position.copy(VM.flash.position); VM.light.intensity *= 0.82; } }
    const scoped = d.scope ? clamp((ads - 0.82) / 0.14, 0, 1) : 0; root.visible = !scoped;
    return ads;
  };
  VM.reset = function () { VM.rel = -1; VM.rack = 0; VM.ads = 0; VM.kick = 0; VM.kickR = 0; VM.sw = 0; VM.swDir = 0; if (VM.model) VM.model.mag && (VM.model.mag.visible = true); };
})();
