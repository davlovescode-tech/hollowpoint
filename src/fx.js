/* ============================================================
   HOLLOWPOINT · fx.js
   Particles (dust, smoke, sparks), tracers, bullet-hole decals,
   shell casings, muzzle-flash light. Everything pooled; ~6 draw calls total.
   ============================================================ */
"use strict";
(function () {
  const T = THREE, clamp = HP.clamp;
  const FX = HP.fx = {};

  /* ---------- point-sprite particle pool ---------- */
  class Particles {
    constructor(N, additive, scene) {
      this.N = N; this.n = 0; this.cur = 0;
      this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.size = new Float32Array(N); this.alpha = new Float32Array(N);
      this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.s0 = new Float32Array(N); this.s1 = new Float32Array(N); this.a0 = new Float32Array(N); this.grav = new Float32Array(N); this.drag = new Float32Array(N);
      for (let i = 0; i < N; i++) this.life[i] = 0;
      const g = this.geo = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage)); g.setAttribute("color", new T.BufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute("size", new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage)); g.setAttribute("alpha", new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage));
      const m = this.mat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending, fog: false,
        uniforms: { scale: { value: 600 }, soft: { value: additive ? 0 : 1 } },
        vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float scale; varying float vA; varying vec3 vC; varying float vS;
          void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; float d=max(-mv.z,.05); gl_PointSize=clamp(size*scale/d,0.,220.); vA=alpha*smoothstep(.0,.5,d); vC=color; vS=position.x*13.1+position.z*7.7; }`,
        fragmentShader: `uniform float soft; varying float vA; varying vec3 vC; varying float vS;
          float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
          void main(){ vec2 c=gl_PointCoord-.5; float r=length(c)*2.; float a=1.-smoothstep(soft>.5?.15:.0,1.,r);
            if(soft>.5){ float ang=atan(c.y,c.x); a*=.72+.28*h(vec2(floor(ang*3.)+vS,floor(r*4.))); }
            gl_FragColor=vec4(vC,a*vA); if(gl_FragColor.a<.004) discard; }`
      });
      this.pts = new T.Points(g, m); this.pts.frustumCulled = false; this.pts.renderOrder = additive ? 8 : 7; scene.add(this.pts);
    }
    emit(o) {
      const i = this.cur; this.cur = (this.cur + 1) % this.N; const p = i * 3;
      this.pos[p] = o.x; this.pos[p + 1] = o.y; this.pos[p + 2] = o.z; this.vel[p] = o.vx || 0; this.vel[p + 1] = o.vy || 0; this.vel[p + 2] = o.vz || 0;
      this.col[p] = o.r; this.col[p + 1] = o.g; this.col[p + 2] = o.b; this.life[i] = this.max[i] = o.life; this.s0[i] = o.s0; this.s1[i] = o.s1 == null ? o.s0 : o.s1; this.a0[i] = o.a == null ? 1 : o.a; this.grav[i] = o.grav || 0; this.drag[i] = o.drag == null ? 1 : o.drag;
    }
    update(dt) {
      let any = false;
      for (let i = 0; i < this.N; i++) {
        if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
        any = true; this.life[i] -= dt; const p = i * 3, t = 1 - this.life[i] / this.max[i];
        const dr = Math.exp(-this.drag[i] * dt); this.vel[p] *= dr; this.vel[p + 1] = this.vel[p + 1] * dr - this.grav[i] * dt; this.vel[p + 2] *= dr;
        this.pos[p] += this.vel[p] * dt; this.pos[p + 1] += this.vel[p + 1] * dt; this.pos[p + 2] += this.vel[p + 2] * dt;
        if (this.pos[p + 1] < 0.02 && this.grav[i] > 0) { this.pos[p + 1] = 0.02; this.vel[p + 1] *= -0.25; this.vel[p] *= 0.5; this.vel[p + 2] *= 0.5; }
        this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t; this.alpha[i] = this.a0[i] * Math.pow(1 - t, 1.4) * Math.min(1, t * 14 + 0.25);
      }
      if (any || this._wasAny) { this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.geo.attributes.size.needsUpdate = true; this.geo.attributes.alpha.needsUpdate = true; }
      this._wasAny = any;
    }
  }

  /* ---------- tracers: dynamic quads stretched along the bullet path ---------- */
  class Tracers {
    constructor(N, scene) {
      this.N = N; this.list = []; const g = this.geo = new T.BufferGeometry();
      this.pos = new Float32Array(N * 12); this.uv = new Float32Array(N * 8); this.cols = new Float32Array(N * 12); const idx = [];
      for (let i = 0; i < N; i++) { this.uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8); idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3); }
      g.setAttribute("position", new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage)); g.setAttribute("uv", new T.BufferAttribute(this.uv, 2)); g.setAttribute("color", new T.BufferAttribute(this.cols, 3).setUsage(T.DynamicDrawUsage)); g.setIndex(idx);
      const cv = document.createElement("canvas"); cv.width = 128; cv.height = 16; const c = cv.getContext("2d");
      const gr = c.createLinearGradient(0, 0, 128, 0); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.7, "rgba(255,255,255,0.65)"); gr.addColorStop(1, "rgba(255,255,255,1)"); c.fillStyle = gr; c.fillRect(0, 0, 128, 16);
      const gv = c.createLinearGradient(0, 0, 0, 16); gv.addColorStop(0, "rgba(0,0,0,1)"); gv.addColorStop(0.5, "rgba(0,0,0,0)"); gv.addColorStop(1, "rgba(0,0,0,1)"); c.globalCompositeOperation = "destination-out"; c.fillStyle = gv; c.fillRect(0, 0, 128, 16);
      const tx = new T.CanvasTexture(cv);
      this.mesh = new T.Mesh(g, new T.MeshBasicMaterial({ map: tx, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, side: T.DoubleSide }));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 9; scene.add(this.mesh);
    }
    add(ox, oy, oz, dx, dy, dz, dist, col, width, speed) { if (this.list.length >= this.N) this.list.shift(); this.list.push({ ox, oy, oz, dx, dy, dz, dist, col, w: width || 0.035, sp: speed || 360, t: 0 }); }
    update(dt, cam) {
      const P = this.pos, C = this.cols, cx = cam.position.x, cy = cam.position.y, cz = cam.position.z; let k = 0;
      this.list = this.list.filter(tr => { tr.t += dt; const head = tr.t * tr.sp; return head - 8 < tr.dist + 2; });
      for (let i = 0; i < this.N; i++) {
        const tr = this.list[i]; const o = i * 12;
        if (!tr) { for (let j = 0; j < 12; j++) { P[o + j] = 0; C[o + j] = 0; } continue; }
        const head = Math.min(tr.dist, tr.t * tr.sp), tail = Math.max(0, head - 9 - tr.sp * 0.015);
        if (head <= tail + 0.01 || tr.t * tr.sp > tr.dist + 12) { for (let j = 0; j < 12; j++) { P[o + j] = 0; C[o + j] = 0; } continue; }
        const ax = tr.ox + tr.dx * tail, ay = tr.oy + tr.dy * tail, az = tr.oz + tr.dz * tail, bx = tr.ox + tr.dx * head, by = tr.oy + tr.dy * head, bz = tr.oz + tr.dz * head;
        const mx = (ax + bx) / 2 - cx, my = (ay + by) / 2 - cy, mz = (az + bz) / 2 - cz; let rx = tr.dy * mz - tr.dz * my, ry = tr.dz * mx - tr.dx * mz, rz = tr.dx * my - tr.dy * mx; const rl = Math.hypot(rx, ry, rz) || 1;
        const dm = Math.hypot(mx, my, mz); const w = tr.w * (0.6 + Math.min(dm, 40) * 0.025); rx = rx / rl * w; ry = ry / rl * w; rz = rz / rl * w;
        P[o] = ax - rx; P[o + 1] = ay - ry; P[o + 2] = az - rz; P[o + 3] = ax + rx; P[o + 4] = ay + ry; P[o + 5] = az + rz; P[o + 6] = bx + rx; P[o + 7] = by + ry; P[o + 8] = bz + rz; P[o + 9] = bx - rx; P[o + 10] = by - ry; P[o + 11] = bz - rz;
        const fade = tr.t * tr.sp > tr.dist ? Math.max(0, 1 - (tr.t * tr.sp - tr.dist) / 12) : 1;
        for (let j = 0; j < 4; j++) { C[o + j * 3] = tr.col[0] * fade; C[o + j * 3 + 1] = tr.col[1] * fade; C[o + j * 3 + 2] = tr.col[2] * fade; }
      }
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    }
  }

  /* ---------- bullet-hole decals (one dynamic mesh, ring buffer) ---------- */
  class Decals {
    constructor(N, scene) {
      this.N = N; this.i = 0; this.pos = new Float32Array(N * 12); this.uv = new Float32Array(N * 8); this.cols = new Float32Array(N * 12); const idx = [];
      for (let i = 0; i < N; i++) { this.uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8); idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3); }
      const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage)); g.setAttribute("uv", new T.BufferAttribute(this.uv, 2)); g.setAttribute("color", new T.BufferAttribute(this.cols, 3).setUsage(T.DynamicDrawUsage)); g.setIndex(idx);
      const cv = document.createElement("canvas"); cv.width = cv.height = 64; const c = cv.getContext("2d");
      let gr = c.createRadialGradient(32, 32, 1, 32, 32, 30); gr.addColorStop(0, "rgba(0,0,0,0.95)"); gr.addColorStop(0.18, "rgba(0,0,0,0.92)"); gr.addColorStop(0.3, "rgba(20,14,10,0.5)"); gr.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
      for (let k = 0; k < 9; k++) { const a = Math.random() * 6.28, l = 8 + Math.random() * 18; c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 1; c.beginPath(); c.moveTo(32, 32); c.lineTo(32 + Math.cos(a) * l, 32 + Math.sin(a) * l); c.stroke(); }
      const tx = new T.CanvasTexture(cv);
      this.mesh = new T.Mesh(g, new T.MeshBasicMaterial({ map: tx, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true }));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; scene.add(this.mesh); this.geo = g;
    }
    add(x, y, z, nx, ny, nz, size, shade) {
      const k = this.i; this.i = (this.i + 1) % this.N; const o = k * 12;
      let ux, uy, uz; if (Math.abs(ny) > 0.9) { ux = 1; uy = 0; uz = 0; } else { ux = 0; uy = 1; uz = 0; }
      let tx = uy * nz - uz * ny, ty = uz * nx - ux * nz, tz = ux * ny - uy * nx; let l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx; const a = Math.random() * 6.28, ca = Math.cos(a), sa = Math.sin(a);
      const t2x = tx * ca + bx * sa, t2y = ty * ca + by * sa, t2z = tz * ca + bz * sa, b2x = -tx * sa + bx * ca, b2y = -ty * sa + by * ca, b2z = -tz * sa + bz * ca; const s = size / 2, e = 0.012;
      const px = x + nx * e, py = y + ny * e, pz = z + nz * e;
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; for (let j = 0; j < 4; j++) { this.pos[o + j * 3] = px + (t2x * q[j][0] + b2x * q[j][1]) * s; this.pos[o + j * 3 + 1] = py + (t2y * q[j][0] + b2y * q[j][1]) * s; this.pos[o + j * 3 + 2] = pz + (t2z * q[j][0] + b2z * q[j][1]) * s; this.cols[o + j * 3] = shade; this.cols[o + j * 3 + 1] = shade; this.cols[o + j * 3 + 2] = shade; }
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    }
    clear() { this.pos.fill(0); this.geo.attributes.position.needsUpdate = true; }
  }

  /* ---------- shell casings ---------- */
  class Shells {
    constructor(N, scene) {
      this.N = N; this.i = 0; const g = new T.CylinderGeometry(0.0045, 0.0045, 0.03, 6); g.rotateZ(Math.PI / 2);
      this.mesh = new T.InstancedMesh(g, new T.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.35, envMapIntensity: 1.4 }), N); this.mesh.frustumCulled = false; this.mesh.castShadow = false; scene.add(this.mesh);
      this.p = []; for (let i = 0; i < N; i++) this.p.push({ on: false, x: 0, y: -9, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, t: 0 });
      this.m = new T.Matrix4(); this.e = new T.Euler(); this.q = new T.Quaternion(); this.s = new T.Vector3(1, 1, 1); this.v = new T.Vector3(); this.hide = new T.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < N; i++) this.mesh.setMatrixAt(i, this.hide); this.big = false;
    }
    emit(x, y, z, vx, vy, vz, shotgun) {
      const k = this.i; this.i = (this.i + 1) % this.N; const s = this.p[k]; Object.assign(s, { on: true, x, y, z, vx, vy, vz, rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6, wx: (Math.random() - 0.5) * 40, wy: (Math.random() - 0.5) * 40, wz: (Math.random() - 0.5) * 40, t: 0, sz: shotgun ? 2.6 : 1, bounced: 0 });
    }
    update(dt) {
      for (let i = 0; i < this.N; i++) {
        const s = this.p[i]; if (!s.on) continue; s.t += dt; if (s.t > 6) { s.on = false; this.mesh.setMatrixAt(i, this.hide); continue; }
        s.vy -= 9.8 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.rx += s.wx * dt; s.ry += s.wy * dt; s.rz += s.wz * dt;
        if (s.y < 0.006) { s.y = 0.006; if (Math.abs(s.vy) > 0.8 && s.bounced < 2) { s.bounced++; if (HP.audio && s.bounced === 1) HP.audio.shell(s.x, s.y, s.z); } s.vy *= -0.35; s.vx *= 0.5; s.vz *= 0.5; s.wx *= 0.4; s.wy *= 0.4; s.wz *= 0.4; }
        this.e.set(s.rx, s.ry, s.rz); this.q.setFromEuler(this.e); this.s.setScalar(s.sz); this.v.set(s.x, s.y, s.z); this.m.compose(this.v, this.q, this.s); this.mesh.setMatrixAt(i, this.m);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* ---------- init ---------- */
  FX.init = function (scene) {
    FX.puff = new Particles(520, false, scene); FX.spark = new Particles(320, true, scene);
    FX.tracers = new Tracers(40, scene); FX.decals = new Decals(110, scene); FX.shells = new Shells(60, scene);
    FX.flashLight = new T.PointLight(0xffc27a, 0, 16, 2); FX.flashLight.castShadow = false; scene.add(FX.flashLight); FX.flashT = 0;
    // world-space muzzle flash sprites for other players (pooled)
    const cv = document.createElement("canvas"); cv.width = cv.height = 128; const c = cv.getContext("2d"); c.translate(64, 64);
    let gr = c.createRadialGradient(0, 0, 2, 0, 0, 62); gr.addColorStop(0, "rgba(255,250,220,1)"); gr.addColorStop(0.25, "rgba(255,190,90,0.85)"); gr.addColorStop(1, "rgba(255,120,30,0)"); c.fillStyle = gr; c.fillRect(-64, -64, 128, 128);
    c.fillStyle = "rgba(255,230,160,0.9)"; for (let i = 0; i < 6; i++) { c.rotate(Math.PI / 3 + Math.random() * 0.2); c.beginPath(); c.moveTo(0, -3); c.lineTo(58, 0); c.lineTo(0, 3); c.fill(); }
    FX.flashTex = new T.CanvasTexture(cv); FX.flashes = [];
    for (let i = 0; i < 10; i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: FX.flashTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); s.visible = false; s.scale.setScalar(0.5); s.renderOrder = 10; scene.add(s); FX.flashes.push({ s, t: 0 }); }
    FX.fi = 0;
  };
  FX.flashAt = function (x, y, z, size) { const f = FX.flashes[FX.fi++ % FX.flashes.length]; f.s.position.set(x, y, z); f.s.scale.setScalar(size || 0.7); f.s.material.rotation = Math.random() * 6.28; f.s.visible = true; f.t = 0.05; FX.flashLight.position.set(x, y, z); FX.flashLight.intensity = 6; FX.flashT = 0.06; };
  FX.update = function (dt, cam) {
    const sc = (HP.renderer.domElement.height) / (2 * Math.tan(cam.fov * Math.PI / 360)); FX.puff.mat.uniforms.scale.value = sc; FX.spark.mat.uniforms.scale.value = sc;
    FX.puff.update(dt); FX.spark.update(dt); FX.tracers.update(dt, cam); FX.shells.update(dt);
    FX.flashes.forEach(f => { if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.s.visible = false; } });
    if (FX.flashT > 0) { FX.flashT -= dt; if (FX.flashT <= 0) FX.flashLight.intensity = 0; else FX.flashLight.intensity = 6 * (FX.flashT / 0.06); }
  };

  /* ---------- impacts ---------- */
  const R = HP.rnd;
  const SURFC = { dust: [0.78, 0.6, 0.38], stone: [0.62, 0.58, 0.52], metal: [0.5, 0.5, 0.5], wood: [0.5, 0.34, 0.2] };
  FX.impact = function (x, y, z, nx, ny, nz, surf, big) {
    const c = SURFC[surf] || SURFC.dust; const n = big ? 7 : 4;
    for (let i = 0; i < n; i++) FX.puff.emit({ x: x + nx * 0.03, y: y + ny * 0.03, z: z + nz * 0.03, vx: nx * R(0.4, 1.6) + R(-0.5, 0.5), vy: ny * R(0.4, 1.6) + R(0.1, 0.9), vz: nz * R(0.4, 1.6) + R(-0.5, 0.5), life: R(0.5, 1.1), s0: R(0.06, 0.12), s1: R(0.35, 0.7) * (big ? 1.4 : 1), r: c[0] * 0.95, g: c[1] * 0.92, b: c[2] * 0.88, a: 0.5, drag: 2.2, grav: -0.2 });
    const sp = surf === "metal" ? 12 : surf === "stone" ? 6 : surf === "wood" ? 4 : 2;
    for (let i = 0; i < sp; i++) { const m = surf === "metal"; FX.spark.emit({ x, y, z, vx: nx * R(1, 5) + R(-2, 2), vy: ny * R(1, 5) + R(0, 3), vz: nz * R(1, 5) + R(-2, 2), life: R(0.15, m ? 0.5 : 0.3), s0: m ? 0.035 : 0.025, s1: 0.01, r: m ? 1.0 : surf === "wood" ? 0.7 : 0.85, g: m ? 0.78 : surf === "wood" ? 0.45 : 0.7, b: m ? 0.4 : surf === "wood" ? 0.22 : 0.5, a: 1, grav: 12, drag: 0.5 }); }
    if (surf !== "dust" || Math.abs(ny) < 0.5) FX.decals.add(x, y, z, nx, ny, nz, R(0.07, 0.11), surf === "metal" ? 0.5 : 0.8);
    else FX.decals.add(x, y, z, nx, ny, nz, R(0.1, 0.16), 1.2);
  };
  FX.hitBody = function (x, y, z, dx, dy, dz, head) {
    for (let i = 0; i < (head ? 9 : 6); i++) FX.puff.emit({ x, y, z, vx: dx * R(0.5, 2.2) + R(-0.8, 0.8), vy: R(-0.2, 1.2), vz: dz * R(0.5, 2.2) + R(-0.8, 0.8), life: R(0.35, 0.8), s0: 0.05, s1: R(0.18, 0.35), r: 0.55, g: 0.04, b: 0.04, a: 0.7, grav: 3, drag: 1.8 });
    for (let i = 0; i < 4; i++) FX.spark.emit({ x, y, z, vx: dx * R(0.5, 3) + R(-1.5, 1.5), vy: R(0, 2.5), vz: dz * R(0.5, 3) + R(-1.5, 1.5), life: R(0.15, 0.35), s0: 0.03, s1: 0.01, r: 1, g: 0.25, b: 0.12, a: 1, grav: 10, drag: 0.6 });
  };
  FX.puffAt = function (x, y, z, r, g, b, s, n) { for (let i = 0; i < (n || 5); i++) FX.puff.emit({ x: x + R(-0.2, 0.2), y: y + R(0, 0.1), z: z + R(-0.2, 0.2), vx: R(-1, 1), vy: R(0.2, 1), vz: R(-1, 1), life: R(0.7, 1.4), s0: s * 0.4, s1: s * 1.5, r, g, b, a: 0.55, drag: 1.6 }); };
  FX.explosion = function (x, y, z) {
    for (let i = 0; i < 16; i++) FX.spark.emit({ x: x + R(-0.5, 0.5), y: y + R(0.2, 1.4), z: z + R(-0.5, 0.5), vx: R(-3, 3), vy: R(1, 6), vz: R(-3, 3), life: R(0.25, 0.65), s0: 1.0, s1: 0.25, r: 1, g: R(0.45, 0.75), b: 0.18, a: 0.85, drag: 2.2 });
    for (let i = 0; i < 24; i++) FX.puff.emit({ x: x + R(-1, 1), y: y + R(0, 0.8), z: z + R(-1, 1), vx: R(-3, 3), vy: R(1.5, 7), vz: R(-3, 3), life: R(1.4, 3.0), s0: 0.8, s1: R(3, 5.5), r: 0.26, g: 0.23, b: 0.2, a: 0.55, drag: 1.1 });
    for (let i = 0; i < 18; i++) { const a = Math.random() * 6.283, sp = R(4, 9); FX.puff.emit({ x, y: 0.2, z, vx: Math.cos(a) * sp, vy: R(0.2, 0.8), vz: Math.sin(a) * sp, life: R(1, 2.1), s0: 0.6, s1: R(2, 3.4), r: 0.76, g: 0.6, b: 0.42, a: 0.5, drag: 1.7 }); }
    for (let i = 0; i < 22; i++) FX.spark.emit({ x, y: y + 0.3, z, vx: R(-9, 9), vy: R(3, 12), vz: R(-9, 9), life: R(0.4, 0.9), s0: 0.05, s1: 0.015, r: 1, g: 0.5, b: 0.15, a: 1, grav: 14, drag: 0.3 });
    FX.flashAt(x, y + 1.2, z, 9);
  };
  FX.land = function (x, z, force) { FX.puffAt(x, 0.05, z, 0.8, 0.62, 0.4, 0.45 + force * 0.1, 4); };
  FX.step = function (x, z, run) { FX.puff.emit({ x, y: 0.04, z, vx: R(-0.3, 0.3), vy: R(0.1, 0.5), vz: R(-0.3, 0.3), life: R(0.5, 0.9), s0: 0.1, s1: run ? 0.4 : 0.25, r: 0.78, g: 0.62, b: 0.42, a: run ? 0.3 : 0.18, drag: 2 }); };
  FX.clearAll = function () { FX.decals.clear(); FX.tracers.list.length = 0; };
})();
