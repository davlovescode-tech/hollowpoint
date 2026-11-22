/* ============================================================
   HOLLOWPOINT · map.js
   "KILN YARD": a walled brick-works compound at the edge of a desert town.
   Everything is built from PBR boxes/cylinders, merged per material.
   Also exposes the physics world: colliders, ray casts, capsule-ish
   movement, and a nav grid for the bots.
   ============================================================ */
"use strict";
(function () {
  const T = THREE, clamp = HP.clamp;
  const HALF = 48;                         // playable half-extent
  const SURF = { sand: "dust", concrete: "stone", brick: "stone", plasterSand: "stone", plasterTerra: "stone", plasterBone: "stone", wood: "wood", rust: "metal", corrRed: "metal", corrBlue: "metal", corrGreen: "metal", corrSand: "metal", steelDark: "metal", steelLight: "metal", paintOlive: "metal", paintBlack: "metal", fabric: "dust", cloth: "dust", rubber: "dust", asphalt: "stone", glass: "metal", clothRed: "dust", clothBlue: "dust" };

  HP.buildMap = function () {
    const rnd = HP.mulberry(20241121), R = (a, b) => a + rnd() * (b - a);
    const buckets = {}; const colliders = []; const decor = new T.Group(); decor.name = "decor";
    const blobs = [];   // fake contact shadows [x,z,w,d,ry,alpha]
    const spawns = [];

    /* ---------- geometry helpers ---------- */
    function wuv(g, tile) {
      const p = g.attributes.position, n = g.attributes.normal; let uv = g.attributes.uv;
      if (!uv) { uv = new T.BufferAttribute(new Float32Array(p.count * 2), 2); g.setAttribute("uv", uv); }
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)); let u, v;
        if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
        uv.setXY(i, u / tile, v / tile);
      }
      uv.needsUpdate = true;
    }
    function tintGeo(g, r, gg, b, faceTint) {
      const c = g.attributes.position.count, a = new Float32Array(c * 3);
      for (let i = 0; i < c; i++) { let k = 1; if (faceTint) { const f = Math.floor(i / 4); k = faceTint[f] == null ? 1 : faceTint[f]; } a[i * 3] = r * k; a[i * 3 + 1] = gg * k; a[i * 3 + 2] = b * k; }
      g.setAttribute("color", new T.BufferAttribute(a, 3));
    }
    function put(g, mk, o) {
      o = o || {};
      if (o.ry) g.rotateY(o.ry); if (o.rx) g.rotateX(o.rx); if (o.rz) g.rotateZ(o.rz);
      if (o.pos) g.translate(o.pos[0], o.pos[1], o.pos[2]);
      g.computeBoundingBox(); const bb = g.boundingBox.clone();
      if (g.index) g = g.toNonIndexed();
      g.computeVertexNormals && !g.attributes.normal && g.computeVertexNormals();
      wuv(g, HP.MAT[mk].userData.tile || 2);
      if (!g.attributes.color) tintGeo(g, 1, 1, 1);
      (buckets[mk] || (buckets[mk] = [])).push(g);
      if (o.col !== false) colliders.push({ x0: bb.min.x, y0: bb.min.y, z0: bb.min.z, x1: bb.max.x, y1: bb.max.y, z1: bb.max.z, s: SURF[mk] || "stone" });
      return bb;
    }
    /* axis-aligned (optionally yawed) box. cx,cz centre; y0 = bottom */
    function box(cx, y0, cz, w, h, d, mk, o) {
      o = o || {};
      const g = new T.BoxGeometry(w, h, d);
      const t = o.tint == null ? 1 : o.tint, j = o.noJit ? 0 : R(-0.05, 0.05);
      const k = t * (1 + j);
      tintGeo(g, (o.rgb ? o.rgb[0] : 1) * k, (o.rgb ? o.rgb[1] : 1) * k, (o.rgb ? o.rgb[2] : 1) * k, o.face);
      g.translate(0, h / 2, 0);                         // origin at bottom-centre so yaw spins in place
      return put(g, mk, { ry: o.ry, pos: [cx, y0, cz], col: o.col });
    }
    function rbox(cx, y0, cz, w, h, d, r, mk, o) {      // rounded box (sandbags, cushions)
      o = o || {}; const g = new T.BoxGeometry(w, h, d, 5, 5, 5); const p = g.attributes.position, n = g.attributes.normal;
      const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const ix = clamp(x, -hx, hx), iy = clamp(y, -hy, hy), iz = clamp(z, -hz, hz);
        let dx = x - ix, dy = y - iy, dz = z - iz; const l = Math.hypot(dx, dy, dz);
        if (l > 1e-6) { dx /= l; dy /= l; dz /= l; p.setXYZ(i, ix + dx * r, iy + dy * r, iz + dz * r); n.setXYZ(i, dx, dy, dz); }
      }
      const t = (o.tint == null ? 1 : o.tint) * (1 + R(-0.06, 0.06)); tintGeo(g, t, t, t);
      g.translate(0, h / 2, 0); return put(g, mk, { ry: o.ry, pos: [cx, y0, cz], col: o.col });
    }
    function cyl(cx, y0, cz, r, h, mk, o) {
      o = o || {}; const g = new T.CylinderGeometry(o.r1 == null ? r : o.r1, r, h, o.seg || 18, 1, o.open);
      const t = (o.tint == null ? 1 : o.tint) * (1 + R(-0.04, 0.04)); tintGeo(g, (o.rgb ? o.rgb[0] : 1) * t, (o.rgb ? o.rgb[1] : 1) * t, (o.rgb ? o.rgb[2] : 1) * t);
      g.translate(0, h / 2, 0);
      let bb;
      if (o.col === "oct") {                       // octagonal collider for fat round things
        bb = put(g, mk, { pos: [cx, y0, cz], col: false });
        const a = r * 0.93, b = r * 0.38; [[a, b], [b, a]].forEach(s => colliders.push({ x0: cx - s[0], x1: cx + s[0], z0: cz - s[1], z1: cz + s[1], y0: y0, y1: y0 + h, s: SURF[mk] || "stone" }));
        const c = r * 0.70; colliders.push({ x0: cx - c, x1: cx + c, z0: cz - c, z1: cz + c, y0: y0, y1: y0 + h, s: SURF[mk] || "stone" });
        return bb;
      }
      if (o.col !== false) {                       // inscribed box for slim things
        bb = put(g, mk, { pos: [cx, y0, cz], col: false }); const q = r * 0.78; colliders.push({ x0: cx - q, x1: cx + q, z0: cz - q, z1: cz + q, y0: y0, y1: y0 + h, s: SURF[mk] || "metal" }); return bb;
      }
      return put(g, mk, { pos: [cx, y0, cz], col: false });
    }
    const blob = (x, z, w, d, a, ry) => blobs.push([x, z, w, d, a == null ? 0.55 : a, ry || 0]);

    /* wall run with openings. axis 'x': from (x0,z) to (x1,z); axis 'z': from (x,z0) to (x,z1). ops: [{c: centre offset from run centre, w, y0, y1}] */
    function wallRun(axis, a0, a1, fixed, t, h, mk, ops, o) {
      o = o || {}; const len = a1 - a0; const mid = (a0 + a1) / 2; ops = (ops || []).slice().sort((p, q) => p.c - q.c);
      const seg = (s, e, y0, y1) => { if (e - s < 0.02 || y1 - y0 < 0.02) return; const c = a0 + (s + e) / 2; const L = e - s;
        if (axis === "x") box(c, y0, fixed, L, y1 - y0, t, mk, o.o); else box(fixed, y0, c, t, y1 - y0, L, mk, o.o); };
      let cur = 0;
      ops.forEach(op => { const s = len / 2 + op.c - op.w / 2, e = len / 2 + op.c + op.w / 2; seg(cur, s, 0, h); if (op.y0 > 0.01) seg(s, e, 0, op.y0); if (op.y1 < h - 0.01) seg(s, e, op.y1, h); cur = e; });
      seg(cur, len, 0, h);
    }

    /* building: x,z centre; w along x, d along z. sides N(-z) S(+z) W(-x) E(+x). openings c = offset along the wall from its centre */
    function building(b) {
      const t = 0.32, h = b.h || 3.4, w = b.w, d = b.d, mk = b.mat || "plasterSand", x = b.x, z = b.z;
      const inner = { };                                   // interior faces darker: +z(4) -z(5) +x(0) -x(1)
      const wallO = side => ({ o: { face: side === "N" ? [1, 1, 1, 1, 0.5, 1] : side === "S" ? [1, 1, 1, 1, 1, 0.5] : side === "W" ? [0.5, 1, 1, 1, 1, 1] : [1, 0.5, 1, 1, 1, 1], rgb: b.rgb } });
      const ops = { N: [], S: [], W: [], E: [] };
      (b.doors || []).forEach(o => ops[o.s].push({ c: o.c || 0, w: o.w || 1.4, y0: 0, y1: o.h || 2.3 }));
      (b.wins || []).forEach(o => ops[o.s].push({ c: o.c || 0, w: o.w || 1.3, y0: o.y || 1.05, y1: (o.y || 1.05) + (o.h || 1.15) }));
      wallRun("x", x - w / 2, x + w / 2, z - d / 2, t, h, mk, ops.N, wallO("N"));
      wallRun("x", x - w / 2, x + w / 2, z + d / 2, t, h, mk, ops.S, wallO("S"));
      wallRun("z", z - d / 2 + t / 2, z + d / 2 - t / 2, x - w / 2, t, h, mk, ops.W, wallO("W"));
      wallRun("z", z - d / 2 + t / 2, z + d / 2 - t / 2, x + w / 2, t, h, mk, ops.E, wallO("E"));
      // roof slab + parapet
      const rk = b.roof || "concrete";
      box(x, h, z, w + 0.1, 0.28, d + 0.1, rk, { face: [1, 1, 1, 0.45, 1, 1], noJit: true });
      if (b.parapet !== false) {
        const ph = 0.95, pt = 0.26;
        box(x, h + 0.28, z - d / 2 + pt / 2, w + 0.1, ph, pt, mk, { noJit: true }); box(x, h + 0.28, z + d / 2 - pt / 2, w + 0.1, ph, pt, mk, { noJit: true });
        box(x - w / 2 + pt / 2, h + 0.28, z, pt, ph, d - pt * 2, mk, { noJit: true }); box(x + w / 2 - pt / 2, h + 0.28, z, pt, ph, d - pt * 2, mk, { noJit: true });
      }
      // interior floor (visual) + window ledges and door frames
      box(x, 0, z, w - t, 0.05, d - t, "concrete", { col: false, tint: 0.6, noJit: true });
      (b.wins || []).forEach(o => { const y = o.y || 1.05, ww = o.w || 1.3;
        const alongX = o.s === "N" || o.s === "S"; const sgn = (o.s === "S" || o.s === "E") ? 1 : -1;
        const px = alongX ? x + (o.c || 0) : x + sgn * (w / 2 + 0.1), pz = alongX ? z + sgn * (d / 2 + 0.1) : z + (o.c || 0);
        if (alongX) box(px, y - 0.08, pz, ww + 0.3, 0.08, 0.34, "concrete", { col: false, noJit: true }); else box(px, y - 0.08, pz, 0.34, 0.08, ww + 0.3, "concrete", { col: false, noJit: true });
        // shutters (open leaves) on some windows
        if (rnd() < 0.6) { const sh = o.h || 1.15; const g = new T.BoxGeometry(alongX ? 0.05 : ww / 2 * 0.95, sh, alongX ? ww / 2 * 0.95 : 0.05); tintGeo(g, 0.8, 0.7, 0.55); g.translate(0, sh / 2, 0);
          const ang = R(0.6, 1.5) * (rnd() < 0.5 ? 1 : -1); const gg = g; gg.rotateY(alongX ? ang : ang + Math.PI / 2);
          put(gg, "wood", { pos: [alongX ? px - ww / 2 : px, y, alongX ? pz : pz - ww / 2], col: false }); }
      });
      (b.doors || []).forEach(o => { const dh = o.h || 2.3, dw = o.w || 1.4; if (!o.leaf) return;
        const alongX = o.s === "N" || o.s === "S"; const sgn = (o.s === "S" || o.s === "E") ? 1 : -1;
        const g = new T.BoxGeometry(alongX ? dw * 0.96 : 0.06, dh * 0.98, alongX ? 0.06 : dw * 0.96); tintGeo(g, 0.55, 0.58, 0.62); g.translate(0, dh * 0.49, 0);
        g.rotateY(alongX ? 1.25 * sgn : 1.25 * sgn + Math.PI / 2);
        const px = alongX ? x + (o.c || 0) - dw / 2 : x + sgn * (w / 2), pz = alongX ? z + sgn * (d / 2) : z + (o.c || 0) - dw / 2;
        put(g, "steelDark", { pos: [px, 0, pz], col: false }); });
      blob(x, z, w + 2.4, d + 2.4, 0.42);
      return { x, z, w, d, h };
    }
    function stairs(x, z, dx, dz, width, n, rise, run, mk) {
      for (let i = 0; i < n; i++) {
        const hh = (i + 1) * rise, c = (i + 0.5) * run; const cx = x + dx * c, cz = z + dz * c;
        if (dx) box(cx, 0, cz, run, hh, width, mk, { noJit: true, tint: 0.95 }); else box(cx, 0, cz, width, hh, run, mk, { noJit: true, tint: 0.95 });
      }
    }
    function crate(x, y, z, s, ry, mk) { box(x, y, z, s, s, s, mk || "wood", { ry: ry || R(-0.4, 0.4), tint: R(0.82, 1.05) }); if (y === 0) blob(x, z, s * 1.5, s * 1.5, 0.45); }
    function crateStack(x, z, ry) { crate(x, 0, z, 1.0, ry); crate(x + 1.05, 0, z + 0.1, 0.9, ry + 0.2); crate(x + 0.3, 1.0, z + 0.05, 0.85, ry - 0.15); }
    function barrel(x, z, kind) {
      const mk = kind || HP.pick(["rust", "corrRed", "corrBlue", "corrGreen"]);
      cyl(x, 0, z, 0.3, 0.92, mk, { seg: 14 }); [0.12, 0.46, 0.8].forEach(y => cyl(x, y, z, 0.312, 0.04, "steelDark", { seg: 14, col: false, tint: 0.7 }));
      cyl(x, 0.92, z, 0.26, 0.015, "steelLight", { seg: 14, col: false }); blob(x, z, 1.1, 1.1, 0.5);
    }
    function sandbags(x, z, len, ry, courses) {      // straight run, centred, along local x
      courses = courses || 3; const bw = 0.62, bh = 0.2, bd = 0.36; const n = Math.round(len / bw), c = Math.cos(ry), s = Math.sin(ry);
      for (let k = 0; k < courses; k++) for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * bw + ((k % 2) ? bw / 2 : 0) - (k % 2 ? 0 : 0); if (Math.abs(off) > len / 2 + 0.01) continue;
        const px = x + c * off, pz = z - s * off;
        rbox(px, k * bh, pz, bw * 0.96, bh * 1.05, bd, 0.07, "fabric", { ry: ry + R(-0.05, 0.05), col: false, tint: R(0.8, 1.05) });
      }
      // one collider for the wall (axis-aligned bounding box of the run)
      const hx = Math.abs(c) * len / 2 + Math.abs(s) * bd / 2, hz = Math.abs(s) * len / 2 + Math.abs(c) * bd / 2;
      colliders.push({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: 0, y1: courses * bh * 0.98, s: "dust" }); blob(x, z, Math.abs(c) * len + 1, Math.abs(s) * len + 1, 0.35);
    }
    function jersey(x, z, ry) {                       // concrete traffic barrier, 3m long
      const L = 3, prof = new T.Shape(); prof.moveTo(-0.3, 0); prof.lineTo(0.3, 0); prof.lineTo(0.3, 0.18); prof.lineTo(0.17, 0.78); prof.lineTo(-0.17, 0.78); prof.lineTo(-0.3, 0.18); prof.closePath();
      const g = new T.ExtrudeGeometry(prof, { depth: L, bevelEnabled: false }); g.translate(0, 0, -L / 2); g.rotateY(Math.PI / 2);   // length along x
      tintGeo(g, 1, 1, 1);
      const bb = put(g, "concrete", { ry: ry, pos: [x, 0, z], col: false });
      colliders.push({ x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z, y0: 0, y1: 0.78, s: "stone" }); blob(x, z, 3.6, 1.4, 0.4, ry);
    }
    function pole(x, z, h) { box(x, 0, z, 0.26, h, 0.26, "wood", { tint: 0.7, col: false, noJit: true }); box(x, h - 0.5, z, 2.0, 0.12, 0.12, "wood", { tint: 0.7, col: false }); colliders.push({ x0: x - .13, x1: x + .13, z0: z - .13, z1: z + .13, y0: 0, y1: h, s: "wood" }); }
    function wire(ax, ay, az, bx, by, bz, sag) {
      const pts = []; for (let i = 0; i <= 14; i++) { const k = i / 14; pts.push(new T.Vector3(ax + (bx - ax) * k, ay + (by - ay) * k - Math.sin(k * Math.PI) * sag, az + (bz - az) * k)); }
      const g = new T.TubeGeometry(new T.CatmullRomCurve3(pts), 16, 0.014, 4, false); tintGeo(g, 0.1, 0.1, 0.1); put(g, "rubber", { col: false });
    }
    function wheel(x, y, z, r, wdt, axisX) {
      const g = new T.CylinderGeometry(r, r, wdt, 18); tintGeo(g, 0.55, 0.55, 0.55); g.rotateZ(Math.PI / 2); if (!axisX) g.rotateY(Math.PI / 2); put(g, "rubber", { pos: [x, y, z], col: false });
      const h2 = new T.CylinderGeometry(r * 0.55, r * 0.55, wdt + 0.02, 12); tintGeo(h2, 1, 1, 1); h2.rotateZ(Math.PI / 2); if (!axisX) h2.rotateY(Math.PI / 2); put(h2, "steelLight", { pos: [x, y, z], col: false });
    }
    function truck(x, z, ry, cabMk, burnt) {          // old flatbed truck, front toward +x (before yaw)
      const c = Math.cos(ry), s = Math.sin(ry); const P = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
      const add = (lx, y0, lz, w, h, d, mk, o) => { const p = P(lx, lz); box(p[0], y0, p[1], w, h, d, mk, Object.assign({ ry: ry, col: false }, o || {})); };
      add(0, 0.55, 0, 7.4, 0.28, 2.3, "steelDark", { tint: 0.7 });                    // chassis
      add(2.6, 0.83, 0, 2.0, 1.75, 2.25, cabMk, {});                                    // cab
      add(3.55, 1.0, 0, 0.12, 0.9, 2.1, "steelDark", { tint: 0.9 });                  // grille
      add(2.75, 2.1, 0, 1.4, 0.7, 2.18, cabMk, { tint: 0.92 });
      add(2.9, 2.18, 0, 0.1, 0.55, 2.0, "glass", { tint: 0.7 });
      add(-1.1, 0.83, 0, 4.6, 0.12, 2.35, "wood", {});                                // bed
      [[-1.1, 1.0], [-1.1, -1.0]].forEach(q => add(q[0], 0.95, q[1] * 1.12, 4.6, 0.7, 0.08, "wood", { tint: 0.8 }));
      add(-3.35, 0.95, 0, 0.08, 0.7, 2.3, "wood", { tint: 0.8 }); add(0.8, 0.95, 0, 0.08, 0.7, 2.3, "wood", { tint: 0.8 });
      [[2.6, 1.0], [2.6, -1.0], [-0.6, 1.0], [-0.6, -1.0], [-2.4, 1.0], [-2.4, -1.0]].forEach(q => { const p = P(q[0], q[1] * 1.12); wheel(p[0], 0.5, p[1], 0.5, 0.34, Math.abs(s) < 0.5); });
      // collider: the rotated bounding box
      const hx = Math.abs(c) * 3.7 + Math.abs(s) * 1.2, hz = Math.abs(s) * 3.7 + Math.abs(c) * 1.2;
      colliders.push({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: 0, y1: 2.8, s: "metal" }); blob(x, z, Math.abs(c) * 9 + Math.abs(s) * 3.8, Math.abs(s) * 9 + Math.abs(c) * 3.8, 0.55, 0);
    }
    function wreckCar(x, z, ry, mk) {
      const c = Math.cos(ry), s = Math.sin(ry); const P = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
      const add = (lx, y0, lz, w, h, d, m, o) => { const p = P(lx, lz); box(p[0], y0, p[1], w, h, d, m, Object.assign({ ry: ry, col: false }, o || {})); };
      add(0, 0.35, 0, 4.4, 0.7, 1.8, mk || "rust", {}); add(-0.2, 1.05, 0, 2.3, 0.62, 1.62, mk || "rust", { tint: 0.9 }); add(-0.2, 1.08, 0, 2.34, 0.5, 1.66, "glass", { tint: 0.6 });
      add(2.2, 0.55, 0, 0.1, 0.3, 1.6, "steelDark", { tint: 0.7 });
      [[1.4, 0.92], [1.4, -0.92], [-1.4, 0.92], [-1.4, -0.92]].forEach(q => { const p = P(q[0], q[1]); wheel(p[0], 0.32, p[1], 0.33, 0.24, Math.abs(s) < 0.5); });
      const hx = Math.abs(c) * 2.2 + Math.abs(s) * 0.9, hz = Math.abs(s) * 2.2 + Math.abs(c) * 0.9;
      colliders.push({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: 0, y1: 1.7, s: "metal" }); blob(x, z, Math.abs(c) * 5.4 + Math.abs(s) * 2.6, Math.abs(s) * 5.4 + Math.abs(c) * 2.6, 0.55);
    }
    const CONT = ["corrRed", "corrBlue", "corrGreen", "corrSand"];
    function container(x, y, z, along, mk) {          // along: 'x' or 'z'
      const L = 6.06, W = 2.44, H = 2.59; mk = mk || HP.pick(CONT);
      const w = along === "x" ? L : W, d = along === "x" ? W : L;
      box(x, y, z, w, H, d, mk, { noJit: false, tint: R(0.85, 1.05) });
      // door-end frame + locking bars
      const sgn = rnd() < 0.5 ? 1 : -1;
      for (let i = 0; i < 4; i++) { const o = -0.9 + i * 0.6;
        if (along === "x") box(x + sgn * (L / 2 + 0.02), y + 0.15, z + o, 0.05, H - 0.3, 0.035, "steelLight", { col: false, noJit: true, tint: 0.8 });
        else box(x + o, y + 0.15, z + sgn * (L / 2 + 0.02), 0.035, H - 0.3, 0.05, "steelLight", { col: false, noJit: true, tint: 0.8 }); }
      if (y === 0) blob(x, z, w + 1.4, d + 1.4, 0.55);
    }
    function awning(x, z, w, d, h, mk) {              // market stall: posts + sloped cloth
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(q => box(x + q[0] * (w / 2 - 0.1), 0, z + q[1] * (d / 2 - 0.1), 0.1, h, 0.1, "wood", { tint: 0.75, col: true }));
      const g = new T.BoxGeometry(w + 0.4, 0.04, d + 0.4); tintGeo(g, 1, 1, 1); g.rotateX(0.12); put(g, mk, { pos: [x, h + 0.1, z], col: false });
      box(x, 0, z - d / 2 + 0.45, w - 0.3, 0.9, 0.7, "wood", { tint: 0.85 });          // counter
      for (let i = 0; i < 3; i++) box(x - w / 2 + 0.7 + i * (w / 3.2), 0.9, z - d / 2 + 0.45, 0.4, 0.22, 0.4, ["clothRed", "cloth", "clothBlue"][i], { col: false, tint: 0.9 });
      blob(x, z, w + 1, d + 1, 0.3);
    }
    function palm(x, z, h, lean) {
      h = h || R(7, 10); const segs = 7, pts = [];
      for (let i = 0; i <= segs; i++) { const k = i / segs; pts.push(new T.Vector3(x + Math.cos(lean) * k * k * 1.6, k * h, z + Math.sin(lean) * k * k * 1.6)); }
      const curve = new T.CatmullRomCurve3(pts); const g = new T.TubeGeometry(curve, 14, 0.2, 7, false);
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) { /* taper */ const k = clamp(p.getY(i) / h, 0, 1), cp = curve.getPoint(k); const dx = p.getX(i) - cp.x, dz = p.getZ(i) - cp.z, sc = 1.35 - 0.55 * k; p.setX(i, cp.x + dx * sc); p.setZ(i, cp.z + dz * sc); }
      g.computeVertexNormals(); tintGeo(g, 0.55, 0.42, 0.32); put(g, "wood", { col: false });
      colliders.push({ x0: x - 0.22, x1: x + 0.22, z0: z - 0.22, z1: z + 0.22, y0: 0, y1: h, s: "wood" });
      const top = pts[segs];
      for (let i = 0; i < 11; i++) {      // fronds
        const a = i / 11 * Math.PI * 2 + R(-0.2, 0.2), len = R(3.2, 4.4), droop = R(0.9, 1.6), seg = 8, vs = [], idx = [], cols = [], wdt = 0.55;
        for (let s = 0; s <= seg; s++) { const k = s / seg; const rr = k * len, yy = Math.sin(k * 2.2) * 1.2 - k * k * droop; const ww = wdt * Math.sin(Math.PI * Math.pow(k, 0.6)) * (1 - k * 0.3);
          const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, px = -Math.sin(a) * ww, pz = Math.cos(a) * ww; vs.push(cx + px, yy, cz + pz, cx - px, yy, cz - pz); const sh = 0.7 + 0.4 * k * (1 - k) * 2; cols.push(0.22 * sh, 0.34 * sh, 0.12 * sh, 0.22 * sh, 0.34 * sh, 0.12 * sh);
          if (s < seg) { const q = s * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } }
        const fg = new T.BufferGeometry(); fg.setAttribute("position", new T.Float32BufferAttribute(vs, 3)); fg.setAttribute("color", new T.Float32BufferAttribute(cols, 3)); fg.setIndex(idx); fg.computeVertexNormals();
        fg.translate(top.x, top.y, top.z); put(fg, "frond", { col: false });
      }
      blob(x, z, 3, 3, 0.35);
    }
    function sign(text, x, y, z, w, h, ry, bg, fg, font) {
      const cv = document.createElement("canvas"); cv.width = 512; cv.height = Math.round(512 * h / w); const g = cv.getContext("2d");
      g.fillStyle = bg || "#2a2a2a"; g.fillRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? "255,255,255" : "0,0,0"},${rnd() * 0.07})`; g.fillRect(rnd() * cv.width, rnd() * cv.height, 1 + rnd() * 3, 1 + rnd() * 3); }
      g.fillStyle = fg || "#f0e4c8"; g.font = (font || "800 ") + Math.round(cv.height * 0.5) + "px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, cv.width / 2, cv.height / 2 + 4);
      g.strokeStyle = fg || "#f0e4c8"; g.lineWidth = 6; g.strokeRect(8, 8, cv.width - 16, cv.height - 16);
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,50,20,${rnd() * 0.3})`; g.beginPath(); g.arc(rnd() * cv.width, rnd() * cv.height, 4 + rnd() * 16, 0, 7); g.fill(); }
      const tx = new T.CanvasTexture(cv); tx.encoding = T.sRGBEncoding; tx.anisotropy = 8;
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshStandardMaterial({ map: tx, roughness: 0.7, metalness: 0.2, envMapIntensity: 0.8 })); m.position.set(x, y, z); m.rotation.y = ry || 0; m.castShadow = false; m.receiveShadow = true; decor.add(m);
    }

    /* ======================= LAYOUT ======================= */
    // --- roads and plaza (visual only, no collision) ---
    box(0, 0, 0, 98, 0.045, 7.0, "asphalt", { col: false, noJit: true, tint: 1 }); box(0, 0, 0, 7.0, 0.045, 98, "asphalt", { col: false, noJit: true });
    cyl(0, 0, 0, 10.5, 0.06, "concrete", { seg: 40, col: false, tint: 1.05 });
    for (let i = -46; i < 46; i += 4.4) { if (Math.abs(i) < 11) continue; box(i, 0.045, 0, 2.2, 0.006, 0.18, "plasterBone", { col: false, noJit: true }); box(0, 0.045, i, 0.18, 0.006, 2.2, "plasterBone", { col: false, noJit: true }); }
    box(0, 0.045, 3.2, 98, 0.006, 0.12, "plasterBone", { col: false, noJit: true, tint: 0.9 }); box(0, 0.045, -3.2, 98, 0.006, 0.12, "plasterBone", { col: false, noJit: true, tint: 0.9 });
    // fountain + benches in the plaza
    cyl(0, 0, 0, 2.6, 0.7, "concrete", { seg: 28, col: "oct" }); cyl(0, 0.7, 0, 0.5, 2.2, "concrete", { seg: 12, col: false, tint: 0.9 }); cyl(0, 2.7, 0, 1.2, 0.2, "concrete", { seg: 22, col: false });
    cyl(0, 0.55, 0, 2.2, 0.12, "rust", { seg: 26, col: false, tint: 0.5 });
    [[6.2, 0, 0], [-6.2, 0, 0], [0, 0, 6.2], [0, 0, -6.2]].forEach((q, i) => { const alongX = i < 2; box(q[0], 0, q[2], alongX ? 0.5 : 3.0, 0.52, alongX ? 3.0 : 0.5, "concrete", { tint: 0.95 }); });

    // --- perimeter wall with pilasters ---
    const WT = 1.4, WH = 6.2, E = HALF + WT / 2;
    box(0, 0, -E, 2 * (E + WT / 2), WH, WT, "concrete", { noJit: true, tint: 0.95 }); box(0, 0, E, 2 * (E + WT / 2), WH, WT, "concrete", { noJit: true, tint: 0.95 });
    box(-E, 0, 0, WT, WH, 2 * E, "concrete", { noJit: true, tint: 0.95 }); box(E, 0, 0, WT, WH, 2 * E, "concrete", { noJit: true, tint: 0.95 });
    for (let i = -44; i <= 44; i += 11) {
      [[i, -HALF + 0.35], [i, HALF - 0.35]].forEach(q => box(q[0], 0, q[1], 1.2, WH + 0.35, 0.7, "concrete", { col: false, tint: 0.85, noJit: true }));
      [[-HALF + 0.35, i], [HALF - 0.35, i]].forEach(q => box(q[0], 0, q[1], 0.7, WH + 0.35, 1.2, "concrete", { col: false, tint: 0.85, noJit: true }));
    }
    // gates on the road (closed rusty sheet doors, set back so you can see them)
    box(0, 0, -HALF + 0.2, 7.2, 4.4, 0.3, "corrSand", { col: false, tint: 0.85 }); box(0, 0, HALF - 0.2, 7.2, 4.4, 0.3, "corrSand", { col: false, tint: 0.85 });
    box(-HALF + 0.2, 0, 0, 0.3, 4.4, 7.2, "corrSand", { col: false, tint: 0.85 }); box(HALF - 0.2, 0, 0, 0.3, 4.4, 7.2, "corrSand", { col: false, tint: 0.85 });

    // --- NW: market + tyre shop + bakery ---
    building({ x: -31, z: -30, w: 12, d: 9, h: 3.7, mat: "plasterTerra", doors: [{ s: "E", c: 0, w: 1.5, leaf: true }, { s: "S", c: -3.2, w: 3.4, h: 3.0 }], wins: [{ s: "N", c: -3 }, { s: "N", c: 3 }, { s: "W", c: 0 }, { s: "S", c: 3.2 }] });
    building({ x: -15, z: -27, w: 8, d: 7, h: 3.3, mat: "plasterBone", doors: [{ s: "S", c: 1.5, w: 1.4, leaf: true }, { s: "W", c: 0, w: 1.4 }], wins: [{ s: "N", c: 0 }, { s: "E", c: 0 }, { s: "S", c: -2 }] });
    awning(-13, -10, 4.2, 2.6, 2.5, "clothRed"); awning(-19.5, -10, 4.2, 2.6, 2.5, "clothBlue"); awning(-26, -10, 4.2, 2.6, 2.5, "cloth"); awning(-32.5, -10, 4.2, 2.6, 2.5, "clothRed");
    crateStack(-37, -14, 0.3); crateStack(-22, -17, -0.4); barrel(-24.8, -22); barrel(-24.2, -22.6, "rust"); barrel(-40, -22);
    // low yard wall
    wallRun("x", -42, -24, -19, 0.35, 1.25, "plasterSand", [{ c: -2, w: 2.2, y0: 0, y1: 2 }, { c: 4.5, w: 2.2, y0: 0, y1: 2 }], {});
    sandbags(-8.5, -9, 4, Math.PI / 2, 3); sandbags(-36.5, -2.2, 3, 0, 3);

    // --- NE: kiln, warehouse, watchtower ---
    cyl(13, 0, -19, 4.8, 6.4, "brick", { seg: 28, col: "oct", tint: 1 }); cyl(13, 6.4, -19, 5.0, 0.5, "concrete", { seg: 28, col: false, tint: 0.9 }); cyl(13, 6.9, -19, 3.4, 0.25, "brick", { seg: 20, col: false, r1: 3.1 });
    cyl(13, 0, -19, 1.15, 22, "brick", { seg: 14, col: false, r1: 0.75, tint: 0.9 }); cyl(13, 21.8, -19, 0.95, 0.4, "concrete", { seg: 14, col: false });
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.2, ax = 13 + Math.cos(a) * 4.7, az = -19 + Math.sin(a) * 4.7; box(ax, 0.1, az, 0.1, 2.3, 1.5, "steelDark", { col: false, ry: -a + Math.PI / 2, tint: 0.4 }); }
    barrel(19, -24); crate(20, 0, -25, 1.0); crate(8, 0, -26, 0.9);
    building({ x: 25, z: -31, w: 18, d: 11, h: 5.0, mat: "plasterSand", roof: "corrSand", doors: [{ s: "S", c: -3.5, w: 4, h: 3.6 }, { s: "S", c: 5, w: 1.5, leaf: true }, { s: "W", c: 2, w: 4, h: 3.6 }, { s: "N", c: 0, w: 4, h: 3.6 }], wins: [{ s: "S", c: 1.2, y: 2.1 }, { s: "N", c: -5, y: 2.2 }, { s: "N", c: 5, y: 2.2 }, { s: "E", c: -2, y: 2.1 }, { s: "E", c: 3, y: 2.1 }] });
    stairs(34.2, -34.5, 0, 1, 1.4, 17, 0.3, 0.42, "concrete");          // external stairs up the east side (x=34.2, going +z)
    // warehouse interior: racks and pallets
    box(21, 0, -33.5, 8, 0.1, 0.9, "steelDark", { tint: 0.8, col: false }); for (let i = 0; i < 4; i++) { box(17.5 + i * 2.6, 0, -33.8, 0.12, 2.4, 0.12, "steelDark", { tint: 0.8 }); }
    box(21, 1.2, -33.8, 8, 0.08, 0.9, "steelDark", { tint: 0.7, col: false }); box(21, 2.4, -33.8, 8, 0.08, 0.9, "steelDark", { tint: 0.7, col: false });
    crateStack(26, -29, 0.1); crateStack(30, -34, 1.2); crate(22.5, 0, -28, 0.9, 0.3); barrel(30.5, -28.5); barrel(30.9, -27.9);
    // rooftop clutter
    box(20, 5.28, -33, 2.0, 1.1, 1.4, "steelLight", { tint: 0.8 }); cyl(31, 5.28, -28, 1.0, 1.7, "rust", { seg: 14 });
    // watchtower: legs, platform, stairs, sandbag nest
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(q => box(41 + q[0] * 2.2, 0, -12 + q[1] * 2.2, 0.3, 5.2, 0.3, "steelDark", { tint: 0.9 }));
    [1.8, 3.5].forEach(y => { box(41, y, -12 - 2.2, 4.6, 0.08, 0.1, "steelDark", { col: false, tint: 0.8 }); box(41, y, -12 + 2.2, 4.6, 0.08, 0.1, "steelDark", { col: false, tint: 0.8 }); });
    box(41, 4.9, -12, 5.4, 0.22, 5.4, "wood", { noJit: true, tint: 0.85 });
    box(41, 5.12, -14.55, 5.4, 0.95, 0.12, "wood", { tint: 0.8 }); box(41, 5.12, -9.45, 5.4, 0.95, 0.12, "wood", { tint: 0.8 }); box(43.65, 5.12, -12, 0.12, 0.95, 5.2, "wood", { tint: 0.8 });
    stairs(37.8, -9.2, 0, -1, 1.2, 16, 0.31, 0.42, "wood");
    sandbags(41, -9.5, 3, 0, 2); crate(42.2, 5.12, -12.5, 0.8);
    sandbags(34, -6, 4, 0.25, 3); crateStack(44, -20, 0.5); barrel(44.6, -23); barrel(43.9, -23.5);

    // --- SE: container yard ---
    const cy = [[16, 14, "x"], [23.4, 14, "x"], [30.8, 14, "x"], [38.2, 14, "x"],
      [16, 21, "x"], [30.8, 21, "x"], [38.2, 21, "x"], [20, 27.5, "z"], [27.5, 28, "z"], [35, 28, "z"], [42.5, 28, "z"], [16, 36, "x"], [24, 38, "x"], [38, 36, "x"]];
    cy.forEach(c => container(c[0], 0, c[1], c[2]));
    container(23.4, 2.59, 14, "x"); container(38.2, 2.59, 14, "x"); container(30.8, 2.59, 21, "x"); container(27.5, 2.59, 28, "z"); container(24, 2.59, 38, "x");
    crate(13, 0, 18, 1.0); crate(13, 0, 19, 1.0, 0.1); crate(13, 1.0, 18.3, 0.9);     // climb-up crates by the first stack
    crate(44, 0, 18, 1.1); crate(44, 1.1, 18.2, 1.0);                                  // and on the far side
    barrel(34, 18); barrel(34.8, 17.6); jersey(23.5, 18, 0.1); jersey(21, 32, 0);
    wreckCar(46, 8, 0.2, "rust");

    // --- SW: garage and houses ---
    building({ x: -30, z: 28, w: 14, d: 10, h: 4.1, mat: "plasterBone", roof: "corrSand", doors: [{ s: "N", c: -3, w: 5.2, h: 3.3 }, { s: "E", c: 0, w: 1.5, leaf: true }, { s: "W", c: 2, w: 1.5 }], wins: [{ s: "S", c: -3.5 }, { s: "S", c: 3.5 }, { s: "N", c: 4.5 }, { s: "E", c: 3.2 }] });
    truck(-30, 28.6, Math.PI / 2, "corrGreen"); crate(-24.4, 0, 31.5, 1.0); barrel(-35.5, 32);
    building({ x: -13, z: 31, w: 9, d: 8, h: 3.4, mat: "plasterTerra", doors: [{ s: "N", c: -2, w: 1.5, leaf: true }, { s: "W", c: 1.5, w: 1.4 }], wins: [{ s: "S", c: 0 }, { s: "E", c: 0 }, { s: "N", c: 2.4 }] });
    building({ x: -42, z: 13, w: 8, d: 9, h: 3.3, mat: "plasterSand", doors: [{ s: "E", c: 1, w: 1.5, leaf: true }, { s: "S", c: 0, w: 1.4 }], wins: [{ s: "N", c: 0 }, { s: "W", c: 0 }, { s: "E", c: -2.5 }] });
    wallRun("z", 18, 38, -20, 0.35, 1.3, "plasterBone", [{ c: -5, w: 2.4, y0: 0, y1: 2.1 }, { c: 4, w: 2.4, y0: 0, y1: 2.1 }], {});
    wallRun("x", -20, -6, 21, 0.35, 1.3, "plasterBone", [{ c: -3, w: 2.2, y0: 0, y1: 2.1 }], {});
    sandbags(-8, 11, 4.2, 0, 3); sandbags(-20, 8, 3.2, Math.PI / 2, 2); wreckCar(-12, -6, -0.35, "corrBlue"); crateStack(-45, 28, 0.2); barrel(-8, 42); barrel(-7.4, 42.6); barrel(-45.5, 40);

    // --- plaza edges, road chicanes, perimeter dressing ---
    jersey(-22, -2, 0); jersey(-19, 1.2, 0); jersey(22, 2.2, 0); jersey(19, -1.5, 0); jersey(2, 22, Math.PI / 2); jersey(-2.2, 18, Math.PI / 2); jersey(-1.5, -23, Math.PI / 2); jersey(2.2, -27, Math.PI / 2);
    sandbags(7.5, 8, 3.4, 0.4, 3); sandbags(-8.5, -4.5, 3.2, -0.5, 3); sandbags(9.5, -6, 3.2, 1.1, 3);
    truck(8, 13.5, 0.55, "corrRed"); wreckCar(-6, 20, 1.2, "rust");
    for (let i = 0; i < 7; i++) { const tx = HP.pick([-1, 1]) * R(46, 47.2), tz = R(-44, 44); if (Math.abs(tz) < 6) continue; cyl(tx, 0, tz, 0.5, 0.2, "rubber", { seg: 12, col: false }); cyl(tx, 0.2, tz, 0.5, 0.2, "rubber", { seg: 12, col: false }); blob(tx, tz, 1.7, 1.7, 0.45); }
    [[-44, -46.5], [-30, -46.5], [14, -46.5], [38, -46.5], [-46.5, -34], [46.5, -30], [46.5, 32], [-46.5, 32], [-44, 46.5], [20, 46.5], [44, 46.5]].forEach(q => { const x = q[0], z = q[1]; if (Math.abs(z) > 40) { if (Math.abs(x) > 30 || z > 0) jersey(x, z + (z > 0 ? -0.7 : 0.7), 0); } else { jersey(x + (x > 0 ? -0.7 : 0.7), z, Math.PI / 2); } });
    pole(-30, 4.4, 9); pole(-8, 4.5, 9); pole(14, 4.5, 9); pole(36, 4.4, 9);
    for (let i = 0; i < 3; i++) { const a = [-30, -8, 14, 36][i], b = [-30, -8, 14, 36][i + 1]; [-0.8, 0.8].forEach(o => wire(a + o, 8.4, 4.4, b + o, 8.4, 4.5, 0.55)); }
    palm(-4.5, -9.5, 8.5, 0.6); palm(11.5, 5.8, 9.5, 2.4); palm(-17, 15, 8, 4.0); palm(-23, -33, 7.5, 1.0); palm(39, -3, 9, 3.6);
    // pallets, scattered cargo, signs
    for (let i = 0; i < 5; i++) { const px = R(-44, 44), pz = R(-44, 44); if (Math.abs(px) < 8 || Math.abs(pz) < 8) continue; }
    sign("KILN YARD", 0, 5.3, -HALF + 0.55, 6.5, 1.5, 0, "#2d3a2f", "#f1e4c4"); sign("TYRE SHOP", -31, 3.2, -25.3, 3.8, 0.8, 0, "#8a2d1e", "#f6e9cf"); sign("BAKERY", -15, 3.0, -23.4, 2.8, 0.7, 0, "#2c4f7a", "#f6e9cf");
    sign("WAREHOUSE 3", 25, 4.4, -25.4, 5.5, 0.9, 0, "#d3a02b", "#1b1b1b"); sign("GARAGE", -30, 3.5, 22.9, 3.4, 0.8, 0, "#b98a2d", "#1b1b1b"); sign("WATER", -20, 2.0, -18.8, 1.8, 0.5, 0, "#2c4f7a", "#f6e9cf");
    sign("14", 20.0, 1.9, 10.75, 0.7, 0.55, 0, "#1b1b1b", "#f1e4c4");

    /* ======================= BUILD MESHES ======================= */
    const root = new T.Group(); root.name = "map";
    Object.keys(buckets).forEach(k => {
      const g = T.BufferGeometryUtils.mergeBufferGeometries(buckets[k], false);
      const m = new T.Mesh(g, HP.MAT[k]); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m);
    });
    root.add(decor);

    // contact-shadow blobs: one merged transparent mesh
    {
      const cv = document.createElement("canvas"); cv.width = cv.height = 64; const g = cv.getContext("2d"); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, "rgba(0,0,0,0.8)"); gr.addColorStop(0.55, "rgba(0,0,0,0.35)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const tx = new T.CanvasTexture(cv); const pos = [], uv = [], col = [];
      blobs.forEach(b => { const hw = b[2] / 2, hd = b[3] / 2, y = 0.052; const c = Math.cos(b[5]), s = Math.sin(b[5]);
        const q = [[-hw, -hd, 0, 0], [hw, -hd, 1, 0], [hw, hd, 1, 1], [-hw, hd, 0, 1]].map(v => [b[0] + c * v[0] + s * v[1], b[1] - s * v[0] + c * v[1], v[2], v[3]]);
        [0, 1, 2, 0, 2, 3].forEach(i => { pos.push(q[i][0], y, q[i][1]); uv.push(q[i][2], q[i][3]); col.push(0, 0, 0, b[4]); }); });
      const bg = new T.BufferGeometry(); bg.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); bg.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); bg.setAttribute("color", new T.Float32BufferAttribute(col, 4));
      const bm = new T.Mesh(bg, new T.MeshBasicMaterial({ map: tx, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true }));
      bm.renderOrder = 2; bm.frustumCulled = false; root.add(bm);
    }

    /* terrain: flat inside the compound, rolling dunes + far mesas beyond */
    {
      const nr = HP.mulberry(77), tbl = []; for (let i = 0; i < 512; i++) tbl.push(nr());
      const hash = (x, y) => tbl[((x * 73856093) ^ (y * 19349663)) & 511];
      const vnz = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return hash(xi, yi) * (1 - u) * (1 - v) + hash(xi + 1, yi) * u * (1 - v) + hash(xi, yi + 1) * (1 - u) * v + hash(xi + 1, yi + 1) * u * v; };
      const fb = (x, y) => { let a = 0.5, s = 0; for (let i = 0; i < 5; i++) { s += a * vnz(x, y); x = x * 2.03 + 11; y = y * 2.03 + 5; a *= 0.5; } return s; };
      const S = 1100, N = 180; const g = new T.PlaneGeometry(S, S, N, N); g.rotateX(-Math.PI / 2); const p = g.attributes.position, col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i); const r = Math.max(Math.abs(x), Math.abs(z)); const k = clamp((r - 58) / 90, 0, 1); const ks = k * k * (3 - 2 * k);
        const dune = (fb(x * 0.011, z * 0.011) - 0.35) * 46 * ks + Math.pow(Math.abs(Math.sin(x * 0.018 + fb(z * 0.01, x * 0.01) * 5)), 1.5) * 8 * ks;
        const y = Math.max(0, dune) - 0.04 * (r < 56 ? 0 : 1) + (r < 56 ? 0 : 0.0); p.setY(i, r < 55 ? -0.002 : y);
        const sh = 0.86 + 0.22 * fb(x * 0.05, z * 0.05) + clamp(y / 40, 0, 0.1); col[i * 3] = sh; col[i * 3 + 1] = sh * 0.97; col[i * 3 + 2] = sh * 0.94;
      }
      g.setAttribute("color", new T.BufferAttribute(col, 3)); g.computeVertexNormals();
      const uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 7, p.getZ(i) / 7);
      const tm = new T.Mesh(g, HP.MAT.sand); tm.receiveShadow = true; tm.castShadow = false; root.add(tm);
      // mesas
      const mm = [[-250, -260, 90, 70], [180, -330, 120, 95], [330, 60, 95, 64], [-340, 160, 110, 80], [60, 380, 130, 66], [-120, 350, 80, 52]];
      mm.forEach((q, i) => {
        const cg = new T.CylinderGeometry(q[2] * 0.62, q[2], q[3], 14, 4); const cp = cg.attributes.position;
        for (let j = 0; j < cp.count; j++) { const a = Math.atan2(cp.getZ(j), cp.getX(j)); const k = 1 + 0.18 * Math.sin(a * 3 + i) + 0.1 * Math.sin(a * 7 + i * 2); cp.setX(j, cp.getX(j) * k); cp.setZ(j, cp.getZ(j) * k); cp.setY(j, cp.getY(j) + (cp.getY(j) > 0 ? 0 : 0) + (Math.sin(j * 12.9 + i) * 2)); }
        cg.computeVertexNormals(); tintGeo(cg, 0.78, 0.52, 0.4); cg.translate(q[0], q[3] / 2 - 4, q[1]); wuv(cg, 20); if (cg.index) { } const cm = new T.Mesh(cg, HP.MAT.sand); root.add(cm);
      });
    }
    HP.mapRoot = root; HP.scene.add(root);

    /* ======================= PHYSICS WORLD ======================= */
    HP.dbg.colliders = colliders;
    const CELL = 8, GN = Math.ceil((HALF + 6) * 2 / CELL), grid = new Array(GN * GN); for (let i = 0; i < grid.length; i++) grid[i] = [];
    const off = HALF + 6;
    colliders.forEach(c => {
      c.stamp = 0; const gx0 = Math.max(0, Math.floor((c.x0 + off) / CELL)), gx1 = Math.min(GN - 1, Math.floor((c.x1 + off) / CELL)), gz0 = Math.max(0, Math.floor((c.z0 + off) / CELL)), gz1 = Math.min(GN - 1, Math.floor((c.z1 + off) / CELL));
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) grid[gz * GN + gx].push(c);
    });
    let stampN = 1; const _out = [];
    function near(x, z, r) {                       // colliders whose XZ footprint is within r of (x,z)
      _out.length = 0; stampN++;
      const gx0 = Math.max(0, Math.floor((x - r + off) / CELL)), gx1 = Math.min(GN - 1, Math.floor((x + r + off) / CELL)), gz0 = Math.max(0, Math.floor((z - r + off) / CELL)), gz1 = Math.min(GN - 1, Math.floor((z + r + off) / CELL));
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) { const a = grid[gz * GN + gx]; for (let i = 0; i < a.length; i++) { const c = a[i]; if (c.stamp !== stampN) { c.stamp = stampN; _out.push(c); } } }
      return _out;
    }
    const STEP = 0.46;
    /* e: {x,y,z,vx,vy,vz,r,h,onGround}. Moves with gravity + collision. */
    function move(e, dt, grav) {
      // horizontal, in up to 3 sub-steps so fast bodies can't tunnel
      const sp = Math.hypot(e.vx, e.vz) * dt, n = Math.max(1, Math.ceil(sp / 0.25));
      for (let s = 0; s < n; s++) { e.x += e.vx * dt / n; e.z += e.vz * dt / n; resolveXZ(e); }
      // vertical
      const py = e.y; e.vy -= grav * dt; e.y += e.vy * dt; let grounded = false;
      if (e.y <= 0) { e.y = 0; if (e.vy < 0) e.vy = 0; grounded = true; }
      const list = near(e.x, e.z, e.r + 0.05), r = e.r * 0.92;
      for (let i = 0; i < list.length; i++) {
        const c = list[i]; const px = clamp(e.x, c.x0, c.x1), pz = clamp(e.z, c.z0, c.z1); const dx = e.x - px, dz = e.z - pz; if (dx * dx + dz * dz >= r * r) continue;
        if (e.vy <= 0 && py >= c.y1 - 0.08 && e.y < c.y1 + 0.001) { e.y = c.y1; e.vy = 0; grounded = true; }
        else if (e.vy > 0 && py + e.h <= c.y0 + 0.08 && e.y + e.h > c.y0) { e.y = c.y0 - e.h; e.vy = 0; }
      }
      e.onGround = grounded;
      if (e.x < -HALF + e.r) e.x = -HALF + e.r; if (e.x > HALF - e.r) e.x = HALF - e.r; if (e.z < -HALF + e.r) e.z = -HALF + e.r; if (e.z > HALF - e.r) e.z = HALF - e.r;
    }
    function resolveXZ(e) {
      for (let it = 0; it < 3; it++) {
        let moved = false; const list = near(e.x, e.z, e.r + 0.05);
        for (let i = 0; i < list.length; i++) {
          const c = list[i]; if (e.y + e.h <= c.y0 + 0.02 || e.y >= c.y1 - 0.02) continue;
          const px = clamp(e.x, c.x0, c.x1), pz = clamp(e.z, c.z0, c.z1); let dx = e.x - px, dz = e.z - pz; const d2 = dx * dx + dz * dz; if (d2 >= e.r * e.r) continue;
          if (c.y1 - e.y <= STEP && e.vy <= 0.5 && (e.stepOK !== false)) { e.y = c.y1; e.vy = 0; e.onGround = true; moved = true; continue; }
          if (d2 < 1e-9) { const l = e.x - c.x0, rr = c.x1 - e.x, u = e.z - c.z0, dn = c.z1 - e.z, m = Math.min(l, rr, u, dn); if (m === l) e.x = c.x0 - e.r; else if (m === rr) e.x = c.x1 + e.r; else if (m === u) e.z = c.z0 - e.r; else e.z = c.z1 + e.r; }
          else { const d = Math.sqrt(d2), push = e.r - d + 1e-4; e.x += dx / d * push; e.z += dz / d * push; }
          moved = true;
        }
        if (!moved) break;
      }
    }
    /* can the body occupy (x,y,z) with radius r / height h? (used for standing up from a crouch) */
    function fits(x, y, z, r, h) { const list = near(x, z, r + 0.05); for (let i = 0; i < list.length; i++) { const c = list[i]; if (y + h <= c.y0 + 0.02 || y >= c.y1 - 0.02) continue; const px = clamp(x, c.x0, c.x1), pz = clamp(z, c.z0, c.z1); const dx = x - px, dz = z - pz; if (dx * dx + dz * dz < r * r * 0.9) return false; } return true; }
    const _hit = { t: 0, nx: 0, ny: 1, nz: 0, s: "dust", c: null };
    /* ray vs world: origin o, unit direction d, up to maxT. Returns shared _hit (or null). */
    function ray(ox, oy, oz, dx, dy, dz, maxT) {
      let best = maxT, bnx = 0, bny = 0, bnz = 0, bc = null, found = false;
      if (dy < -1e-6) { const t = -oy / dy; if (t > 0 && t < best) { best = t; bnx = 0; bny = 1; bnz = 0; bc = null; found = true; } }
      // march the grid along the ray (cheap: gather colliders near the segment in coarse steps)
      const steps = Math.ceil(Math.min(best, maxT) / (CELL * 0.9)); stampN++;
      for (let s = 0; s <= steps; s++) {
        const tt = Math.min(best, maxT, s * CELL * 0.9), x = ox + dx * tt, z = oz + dz * tt;
        const gx0 = Math.max(0, Math.floor((x - CELL * 0.5 + off) / CELL)), gx1 = Math.min(GN - 1, Math.floor((x + CELL * 0.5 + off) / CELL)), gz0 = Math.max(0, Math.floor((z - CELL * 0.5 + off) / CELL)), gz1 = Math.min(GN - 1, Math.floor((z + CELL * 0.5 + off) / CELL));
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) { const a = grid[gz * GN + gx]; for (let i = 0; i < a.length; i++) {
          const c = a[i]; if (c.stamp === stampN) continue; c.stamp = stampN;
          let t0 = 0, t1 = best, nx = 0, ny = 0, nz = 0, ok = true;
          // x slab
          if (Math.abs(dx) < 1e-9) { if (ox < c.x0 || ox > c.x1) ok = false; } else { let a0 = (c.x0 - ox) / dx, a1 = (c.x1 - ox) / dx, sg = -1; if (a0 > a1) { const q = a0; a0 = a1; a1 = q; sg = 1; } if (a0 > t0) { t0 = a0; nx = sg; ny = 0; nz = 0; } if (a1 < t1) t1 = a1; if (t0 > t1) ok = false; }
          if (ok) { if (Math.abs(dy) < 1e-9) { if (oy < c.y0 || oy > c.y1) ok = false; } else { let a0 = (c.y0 - oy) / dy, a1 = (c.y1 - oy) / dy, sg = -1; if (a0 > a1) { const q = a0; a0 = a1; a1 = q; sg = 1; } if (a0 > t0) { t0 = a0; nx = 0; ny = sg; nz = 0; } if (a1 < t1) t1 = a1; if (t0 > t1) ok = false; } }
          if (ok) { if (Math.abs(dz) < 1e-9) { if (oz < c.z0 || oz > c.z1) ok = false; } else { let a0 = (c.z0 - oz) / dz, a1 = (c.z1 - oz) / dz, sg = -1; if (a0 > a1) { const q = a0; a0 = a1; a1 = q; sg = 1; } if (a0 > t0) { t0 = a0; nx = 0; ny = 0; nz = sg; } if (a1 < t1) t1 = a1; if (t0 > t1) ok = false; } }
          if (ok && t0 > 1e-4 && t0 < best) { best = t0; bnx = nx; bny = ny; bnz = nz; bc = c; found = true; }
        } }
      }
      if (!found) return null; _hit.t = best; _hit.nx = bnx; _hit.ny = bny; _hit.nz = bnz; _hit.c = bc; _hit.s = bc ? bc.s : "dust"; return _hit;
    }
    function clear(ax, ay, az, bx, by, bz) {       // line of sight
      const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz); if (L < 1e-4) return true; const h = ray(ax, ay, az, dx / L, dy / L, dz / L, L - 0.05); return !h;
    }

    /* ---------- nav grid (ground level only) ---------- */
    const NS = 1.0, NN = Math.round(HALF * 2 / NS); const nav = new Uint8Array(NN * NN);   // 1 = blocked
    const toCell = v => Math.floor((v + HALF) / NS);
    const BR = 0.42;
    colliders.forEach(c => { if (c.y0 > 1.2 || c.y1 < 0.5) return; const x0 = toCell(c.x0 - BR), x1 = toCell(c.x1 + BR), z0 = toCell(c.z0 - BR), z1 = toCell(c.z1 + BR);
      for (let z = Math.max(0, z0); z <= Math.min(NN - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(NN - 1, x1); x++) { const cx = -HALF + (x + 0.5) * NS, cz = -HALF + (z + 0.5) * NS; const px = clamp(cx, c.x0, c.x1), pz = clamp(cz, c.z0, c.z1); if ((cx - px) ** 2 + (cz - pz) ** 2 < BR * BR + 0.02) nav[z * NN + x] = 1; } });
    // keep only the region connected to the plaza
    { const seen = new Uint8Array(NN * NN), q = [toCell(0) + toCell(-5) * NN]; seen[q[0]] = 1;
      while (q.length) { const i = q.pop(), x = i % NN, z = (i / NN) | 0; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => { const nx = x + d[0], nz = z + d[1]; if (nx < 0 || nz < 0 || nx >= NN || nz >= NN) return; const j = nz * NN + nx; if (seen[j] || nav[j]) return; seen[j] = 1; q.push(j); }); }
      for (let i = 0; i < nav.length; i++) if (!seen[i]) nav[i] = 1; HP.dbg.navOpen = nav.reduce((a, v) => a + (v ? 0 : 1), 0); }
    const free = (x, z) => { const cx = toCell(x), cz = toCell(z); return cx >= 0 && cz >= 0 && cx < NN && cz < NN && !nav[cz * NN + cx]; };

    // A* on the 8-connected grid
    function path(sx, sz, gx, gz) {
      let s = [toCell(sx), toCell(sz)], g = [toCell(gx), toCell(gz)];
      const fix = c => { c[0] = clamp(c[0], 0, NN - 1); c[1] = clamp(c[1], 0, NN - 1); if (!nav[c[1] * NN + c[0]]) return c; for (let r = 1; r < 8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const x = c[0] + dx, z = c[1] + dz; if (x >= 0 && z >= 0 && x < NN && z < NN && !nav[z * NN + x]) return [x, z]; } return c; };
      s = fix(s); g = fix(g); const si = s[1] * NN + s[0], gi = g[1] * NN + g[0]; if (si === gi) return [[gx, gz]];
      const gS = new Float32Array(NN * NN).fill(1e9), came = new Int32Array(NN * NN).fill(-1), closed = new Uint8Array(NN * NN);
      const open = [[si, 0]]; gS[si] = 0; let guard = 0;
      while (open.length && guard++ < 9000) {
        let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][1] < open[bi][1]) bi = i; const cur = open[bi][0]; open[bi] = open[open.length - 1]; open.pop();
        if (cur === gi) break; if (closed[cur]) continue; closed[cur] = 1; const cx = cur % NN, cz = (cur / NN) | 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dz) continue; const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= NN || nz >= NN) continue; const ni = nz * NN + nx; if (nav[ni] || closed[ni]) continue;
          if (dx && dz && (nav[cz * NN + nx] || nav[nz * NN + cx])) continue; const ng = gS[cur] + (dx && dz ? 1.414 : 1); if (ng < gS[ni]) { gS[ni] = ng; came[ni] = cur; open.push([ni, ng + Math.hypot(g[0] - nx, g[1] - nz)]); } }
      }
      if (came[gi] < 0) return null; const pts = []; let c = gi; while (c !== si && c >= 0) { pts.push([-HALF + ((c % NN) + 0.5) * NS, -HALF + (((c / NN) | 0) + 0.5) * NS]); c = came[c]; } pts.reverse();
      // string-pull: drop waypoints that have a clear straight line between neighbours
      const out = []; let a = [sx, sz], i = 0;
      while (i < pts.length) { let j = pts.length - 1; while (j > i && !lineFree(a[0], a[1], pts[j][0], pts[j][1])) j--; out.push(pts[j]); a = pts[j]; i = j + 1; }
      return out;
    }
    function lineFree(ax, az, bx, bz) { const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 0.5); for (let i = 1; i <= n; i++) { const k = i / n; if (!free(ax + (bx - ax) * k, az + (bz - az) * k)) return false; } return true; }

    /* spawn points: spread around the yard, validated against collision + nav */
    const cand = []; for (let gx = -44; gx <= 44; gx += 6) for (let gz = -44; gz <= 44; gz += 6) cand.push([gx + R(-2, 2), gz + R(-2, 2)]);
    cand.forEach(c => { if (free(c[0], c[1]) && fits(c[0], 0, c[1], 0.45, 1.8) && !(Math.abs(c[0]) < 7 && Math.abs(c[1]) < 7)) spawns.push({ x: c[0], z: c[1], yaw: Math.atan2(-c[0], -c[1]) }); });

    HP.World = { colliders, near, move, fits, ray, clear, path, free, spawns, HALF, nav, NN, toCell, STEP };
    HP.dbg.spawnCount = spawns.length; HP.dbg.nColliders = colliders.length;
    return HP.World;
  };

  /* dust motes drifting in the low sun */
  HP.makeDust = function () {
    const N = 420, pos = new Float32Array(N * 3), seed = new Float32Array(N); const r = HP.mulberry(5);
    for (let i = 0; i < N; i++) { pos[i * 3] = (r() - 0.5) * 60; pos[i * 3 + 1] = r() * 12; pos[i * 3 + 2] = (r() - 0.5) * 60; seed[i] = r(); }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("seed", new T.BufferAttribute(seed, 1));
    const m = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, uniforms: { time: { value: 0 }, center: { value: new T.Vector3() }, pr: { value: 1 }, amt: { value: 1 } },
      vertexShader: `attribute float seed; uniform float time; uniform vec3 center; uniform float pr; varying float vA;
        void main(){ vec3 p=position; p.x+=sin(time*.12+seed*40.)*2.0+time*.35; p.y+=sin(time*.2+seed*20.)*.6; p.z+=cos(time*.1+seed*30.)*2.0;
          p=mod(p-center+30.,60.)-30.; vec4 mv=viewMatrix*vec4(p+center,1.); gl_Position=projectionMatrix*mv; float d=-mv.z; vA=smoothstep(2.,6.,d)*(1.-smoothstep(18.,30.,d))*(.35+.65*seed);
          gl_PointSize=clamp((1.2+seed*1.6)*pr*50./max(d,1.),1.,3.6*pr); }`,
      fragmentShader: `varying float vA; void main(){ vec2 c=gl_PointCoord-.5; float a=1.-smoothstep(.0,.5,length(c)); gl_FragColor=vec4(vec3(1.,.78,.5)*a*vA*.55,1.); }` });
    const pts = new T.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 5; HP.scene.add(pts); HP.dust = pts; return pts;
  };
})();
