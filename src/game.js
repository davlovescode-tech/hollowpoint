/* ============================================================
   HOLLOWPOINT · game.js
   Game state, local player controller, hitscan combat, match rules,
   bots on the host, and the room-code multiplayer protocol.
   Host-authoritative: the host (or the solo player) owns hp, kills,
   bots and respawns. Guests send their pose + shot claims.
   ============================================================ */
"use strict";
(function () {
  const T = THREE, clamp = HP.clamp, lerp = HP.lerp, R = HP.rnd;
  const G = HP.G = { ents: new Map(), me: null, now: 0, state: "boot", role: "solo", cfg: { bots: 5, diff: "normal" }, match: { target: 20, time: 420, left: 420, over: false }, nextId: 1, locked: false, paused: false, mdx: 0, mdy: 0, code: null, peers: new Map(), t: 0 };
  const game = HP.game = {};
  const keys = {}; G.keys = keys;
  const UIc = n => (HP.ui && HP.ui[n]) ? HP.ui[n].bind(HP.ui) : () => { };
  const eyeH = e => e.crouch ? 1.12 : 1.6;
  const WIDX = id => HP.WORDER.indexOf(id);
  const TINT_N = 8;

  /* ================= entities ================= */
  function mkEnt(o) {
    const e = { id: o.id, name: o.name || "Soldier", bot: !!o.bot, local: !!o.local, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0.38, h: 1.8, yaw: 0, pitch: 0, hp: 100, alive: false, crouch: false, speed: 0, onGround: true, w: o.w || "arc7", k: 0, d: 0, hs: 0,
      spawnProt: 0, lastFireT: -9, tint: o.tint == null ? (o.id % TINT_N) : o.tint, recoil: 0, respawnAt: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, tpitch: 0, snapped: false, ch: null, stepD: 0, lastHurt: -9, host: !!o.host };
    if (!e.local && HP.chars.ready) { e.ch = HP.chars.make(e.tint, e.w); e.ch.setName(e.name); e.ch.root.visible = false; HP.scene.add(e.ch.root); }
    G.ents.set(e.id, e); return e;
  }
  function dropEnt(id) { const e = G.ents.get(id); if (!e) return; if (e.ch) HP.chars.dispose(e.ch); G.ents.delete(id); }
  function clearBots() { [...G.ents.values()].forEach(e => { if (e.bot) dropEnt(e.id); }); }
  function clearOthers() { [...G.ents.values()].forEach(e => { if (!e.local) dropEnt(e.id); }); }

  /* ================= local player state ================= */
  function newPl() {
    const wa = {}; HP.WORDER.forEach(id => wa[id] = { mag: HP.WEAPONS[id].mag });
    return { wa, cur: "arc7", prev: "sidekick", cd: 0, rel: false, bloom: 0, rkP: 0, rkY: 0, eye: 1.6, dip: 0, phase: 0, bobK: 0, fireHeld: false, fireEdge: false, ads: false, sprint: false, stepD: 0, wasGround: true, lastVy: 0, shake: 0, lx: 0, ly: 0, regen: 0, deadYaw: 0, deadT: 0, killer: null, streak: 0 };
  }

  /* ================= spawning ================= */
  function pickSpawn(e) {
    const W = HP.World, sp = W.spawns; let best = null, bs = -1;
    for (let i = 0; i < 24; i++) {
      const s = sp[Math.floor(Math.random() * sp.length)]; let md = 1e9, seen = 0;
      G.ents.forEach(o => { if (o === e || !o.alive) return; const d = Math.hypot(o.x - s.x, o.z - s.z); if (d < md) md = d; if (d < 45 && W.clear(s.x, 1.6, s.z, o.x, o.y + 1.5, o.z)) seen += 1; });
      const score = Math.min(md, 40) - seen * 14 + Math.random() * 6; if (score > bs) { bs = score; best = s; }
    }
    return best || sp[0];
  }
  function placeAt(e, s) {
    e.x = s.x; e.y = 0; e.z = s.z; e.vx = e.vy = e.vz = 0; e.yaw = s.yaw != null ? s.yaw : 0; e.pitch = 0; e.hp = 100; e.alive = true; e.crouch = false; e.h = 1.8; e.spawnProt = 2.4; e.onGround = true; e.speed = 0;
    e.tx = e.x; e.ty = e.y; e.tz = e.z; e.tyaw = e.yaw; e.tpitch = 0; e.snapped = true;
    if (e.ch) { e.ch.root.visible = true; e.ch.dead = false; e.ch.root.rotation.set(0, 0, 0); }
  }
  function onSpawned(e) {
    if (e.local) {
      const pl = e.pl; pl.wa = newPl().wa; pl.bloom = 0; pl.rkP = pl.rkY = 0; pl.rel = false; pl.cd = 0.3; pl.eye = 1.6; pl.regen = 0; pl.streak = 0;
      HP.vm.reset(); selectWeapon(pl.cur, true); G.cam.dead = false; UIc("respawned")(); HP.audio.spawn();
    } else if (e.bot && e.ai && HP.bots.respawned) { HP.bots.respawned(e); }
  }
  /* host: (re)spawn one entity and tell everyone */
  function hostRespawn(e) {
    const s = pickSpawn(e); placeAt(e, s);
    if (e.bot) { HP.bots.respawned(e); }
    onSpawned(e);
    G.emit({ t: "spawn", id: e.id, x: e.x, z: e.z, yaw: e.yaw, w: e.w }, true);
  }

  /* ================= events (applied identically on every client) ================= */
  G.emit = function (m, localToo) {
    if (G.role === "host") HP.net.broadcast(m);
    if (localToo !== false) G.handle(m);
  };
  const killLog = [];
  G.handle = function (m) {
    const me = G.me;
    switch (m.t) {
      case "spawn": { const e = G.ents.get(m.id); if (!e) break; if (G.role === "host" && !e.local) { /* host already placed it */ if (!e.alive) placeAt(e, m); } else { placeAt(e, m); if (m.w) { e.w = m.w; if (e.ch) e.ch.setWeapon(m.w); } } if (e.local && G.role === "guest") onSpawned(e); break; }
      case "shot": shotFx(m); break;
      case "dmg": if (me && m.v === me.id) { me.hp = m.hp; me.lastHurt = G.now; if (m.f) { const dx = m.f[0] - me.x, dz = m.f[1] - me.z; UIc("dmg")(Math.atan2(-dx, -dz) - me.yaw); } HP.audio.hurt(m.big); G.cam.shake = Math.min(1, (G.cam.shake || 0) + (m.big ? 0.6 : 0.3)); updatePost(); } break;
      case "kill": {
        const k = G.ents.get(m.k), v = G.ents.get(m.v); if (!v) break;
        v.alive = false; v.hp = 0; if (G.role === "guest") { v.d = m.vd != null ? m.vd : v.d; if (k && k !== v) k.k = m.kk != null ? m.kk : k.k; }
        UIc("feed")({ k: k ? k.name : "", v: v.name, w: m.w, head: !!m.h, me: !!(me && (m.k === me.id)), died: !!(me && m.v === me.id), suicide: m.k === m.v });
        if (me && m.v === me.id) onLocalDeath(k, m.w, !!m.h);
        else if (me && m.k === me.id && m.v !== me.id) { HP.audio.hit(false, true); UIc("hit")("kill"); UIc("toast")((m.h ? "HEADSHOT KILL" : "ELIMINATED") + " · " + v.name, m.h ? "hs" : "k"); me.pl.streak++; if (me.pl.streak >= 2) UIc("toast")(["", "", "DOUBLE KILL", "TRIPLE KILL", "QUAD KILL", "RAMPAGE"][Math.min(me.pl.streak, 5)], "streak"); }
        break; }
      case "sc": (m.s || []).forEach(r => { const e = G.ents.get(r[0]); if (e) { e.k = r[1]; e.d = r[2]; e.hs = r[3]; } }); break;
      case "m": G.match.left = m.left; break;
      case "start": onStart(m); break;
      case "end": onEnd(m); break;
      case "join": { if (G.role === "guest" && !G.ents.has(m.e.id)) mkEnt(m.e); refreshLobby(); break; }
      case "leave": { const e = G.ents.get(m.id); if (e) UIc("feed")({ sys: e.name + " left" }); dropEnt(m.id); refreshLobby(); break; }
    }
  };

  /* ================= combat ================= */
  const _o = new T.Vector3();
  /* ray against world + every entity (except `ignore`). returns shared result object or null (pure miss = world/none) */
  const RES = { len: 0, ent: null, zone: "b", hx: 0, hy: 0, hz: 0, nx: 0, ny: 1, nz: 0, surf: "dust", world: false };
  G.castRay = function (ox, oy, oz, dx, dy, dz, max, ignore) {
    const wh = HP.World.ray(ox, oy, oz, dx, dy, dz, max); let t = wh ? wh.t : max; RES.ent = null; RES.world = !!wh;
    if (wh) { RES.nx = wh.nx; RES.ny = wh.ny; RES.nz = wh.nz; RES.surf = wh.s; }
    G.ents.forEach(e => {
      if (e === ignore || !e.alive) return;
      const hh = e.crouch ? 1.42 : 1.8, R0 = 0.36, cx = ox - e.x, cz = oz - e.z, a = dx * dx + dz * dz; let tt = -1;
      if (a > 1e-8) { const b = 2 * (cx * dx + cz * dz), c = cx * cx + cz * cz - R0 * R0, disc = b * b - 4 * a * c; if (disc >= 0) { const sq = Math.sqrt(disc), t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a); const y1 = oy + dy * t1;
        if (t1 > 0 && y1 >= e.y && y1 <= e.y + hh) tt = t1; else if (t1 > 0 && y1 > e.y + hh && dy < 0) { const tc = (e.y + hh - oy) / dy; if (tc > 0 && (cx + dx * tc) ** 2 + (cz + dz * tc) ** 2 <= R0 * R0) tt = tc; } else if (t1 <= 0 && t2 > 0) { tt = 0.001; } } }
      if (tt > 0 && tt < t) { t = tt; const hy = oy + dy * tt, k = (hy - e.y) / hh; RES.ent = e; RES.zone = k > 0.855 ? "h" : k < 0.46 ? "l" : "b"; }
    });
    if (!RES.ent && !wh) return null;
    RES.len = t; RES.hx = ox + dx * t; RES.hy = oy + dy * t; RES.hz = oz + dz * t; if (RES.ent) { RES.surf = "body"; RES.nx = -dx; RES.ny = 0; RES.nz = -dz; }
    return RES;
  };
  const ZM = (w, z) => z === "h" ? w.head : z === "l" ? w.leg : 1;
  /* host-only: apply damage, handle deaths, scoring and win check */
  G.damage = function (v, dmg, att, zone, wid) {
    if (!v.alive || v.spawnProt > 0 || G.match.over || G.state !== "play") return;
    dmg = Math.max(1, Math.round(dmg)); v.hp -= dmg; v.lastHurt = G.now;
    const big = dmg >= 40 || zone === "h";
    G.emit({ t: "dmg", v: v.id, hp: Math.max(0, v.hp), f: att ? [att.x, att.z] : null, big }, true);
    if (v.bot && att) HP.bots.alert(v, att);
    if (v.hp <= 0) {
      v.alive = false; v.respawnAt = G.now + 3.0; v.d++; const self = att === v || !att; if (att && !self) { att.k++; if (zone === "h") att.hs++; }
      G.emit({ t: "kill", k: att ? att.id : v.id, v: v.id, w: wid, h: zone === "h", vd: v.d, kk: att ? att.k : 0 }, true);
      G.emit({ t: "sc", s: scoreRows() }, true); checkWin();
    }
  };
  function scoreRows() { const r = []; G.ents.forEach(e => r.push([e.id, e.k, e.d, e.hs])); return r; }
  function checkWin() {
    if (G.match.over) return; let top = null; G.ents.forEach(e => { if (!top || e.k > top.k) top = e; });
    if (top && top.k >= G.match.target) endMatch(top);
  }
  function endMatch(win) {
    G.match.over = true; const rows = [...G.ents.values()].sort((a, b) => b.k - a.k || a.d - b.d).map(e => [e.id, e.name, e.k, e.d, e.hs]);
    G.emit({ t: "end", win: win ? win.id : null, rows }, true);
  }

  /* shot effects shared by everybody (bots, other players, remote guests) */
  function shotFx(m) {
    const w = HP.WEAPONS[m.w] || HP.WEAPONS.arc7, FX = HP.fx; const src = G.ents.get(m.id); if (src && !src.local) { src.recoil = 1; src.lastFireT = G.now; }
    if (src && src.local) return;                               // our own shot was already shown locally
    const o = m.o, d = m.d; FX.flashAt(o[0], o[1], o[2], w.id === "hammer" ? 1.1 : 0.7);
    HP.audio.shot(w.snd, o[0], o[1], o[2]);
    const cx = HP.camera.position; const dist = Math.hypot(o[0] - cx.x, o[2] - cx.z);
    FX.tracers.add(o[0], o[1], o[2], d[0], d[1], d[2], m.len, w.tracer, 0.03, 380);
    const ex = o[0] + d[0] * m.len, ey = o[1] + d[1] * m.len, ez = o[2] + d[2] * m.len;
    if (m.s === "body") FX.hitBody(ex, ey, ez, d[0], d[1], d[2], m.hd); else if (m.s) { const nn = m.n || [0, 1, 0]; FX.impact(ex, ey, ez, nn[0], nn[1], nn[2], m.s, w.pellets > 1 ? false : false); HP.audio.impact(m.s, ex, ey, ez); }
    // bullet whizz when it passes close to our head
    const me = G.me; if (me && me.alive && src !== me) { const px = cx.x - o[0], py = cx.y - o[1], pz = cx.z - o[2], tp = px * d[0] + py * d[1] + pz * d[2]; if (tp > 0 && tp < m.len) { const qx = px - d[0] * tp, qy = py - d[1] * tp, qz = pz - d[2] * tp; if (qx * qx + qy * qy + qz * qz < 2.6 * 2.6 && (m.s !== "body" || true)) HP.audio.whiz(o[0] + d[0] * tp, o[1] + d[1] * tp, o[2] + d[2] * tp); } }
  }

  /* bot fires (host only) */
  G.botShoot = function (e, w, d, dist) {
    const ey = e.y + (e.crouch ? 1.12 : 1.58), cp = Math.cos(e.pitch), fx = -Math.sin(e.yaw) * cp, fy = Math.sin(e.pitch), fz = -Math.cos(e.yaw) * cp;
    const cone = (w.pellets > 1 ? w.hip : Math.min(1.6, w.hip * 0.55)) * Math.PI / 180, n = w.pellets; const aimO = [e.x + fx * 0.55, ey - 0.12 + fy * 0.55, e.z + fz * 0.55];
    let out = null, hd = false;
    for (let p = 0; p < n; p++) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * cone / 2; let dx = fx, dy = fy, dz = fz;
      // perturb in the plane perpendicular to the aim
      const rx = -fz, rz = fx, rl = Math.hypot(rx, rz) || 1, ux = -fy * rx / rl, uy = rl, uz = -fy * rz / rl;
      const ox = Math.cos(a) * r, oy = Math.sin(a) * r; dx += rx / rl * ox + ux * oy; dy += uy * oy; dz += rz / rl * ox + uz * oy; const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const h = G.castRay(e.x, ey, e.z, dx, dy, dz, w.range, e);
      if (h && h.ent) { const dm = w.dmg * HP.damageAt(w, h.len) * ZM(w, h.zone) * d.dmg; G.damage(h.ent, dm, e, h.zone, w.id); if (h.zone === "h") hd = true; }
      if (p < (n > 1 ? 3 : 1) && h) { const m = { t: "shot", id: e.id, w: w.id, o: aimO, d: [dx, dy, dz], len: h.len, s: h.ent ? "body" : h.surf, n: [h.nx, h.ny, h.nz], hd: h.zone === "h" }; if (!out) out = m; G.emit(m, true); }
    }
    e.recoil = 1; e.lastFireT = G.now;
  };

  /* ================= local player ================= */
  function onLocalDeath(killer, wid, head) {
    const me = G.me, pl = me.pl; me.alive = false; pl.deadT = 0; pl.deadLeft = 3; pl.killer = killer; pl.streak = 0; HP.audio.die(); G.cam.dead = true; G.cam.shake = 1;
    if (killer) pl.deadYaw = Math.atan2(-(killer.x - me.x), -(killer.z - me.z)); else pl.deadYaw = me.yaw;
    UIc("death")({ by: killer && killer !== me ? killer.name : null, w: wid ? (HP.WEAPONS[wid] || {}).name : "", head, left: 3 }); updatePost();
  }
  function selectWeapon(id, instant) {
    const me = G.me, pl = me.pl; if (!HP.WEAPONS[id]) return;
    if (id === pl.cur && !instant) return;
    if (!instant) { HP.vm.cancelReload(); pl.rel = false; pl.prev = pl.cur; HP.audio.equip(); }
    pl.cur = id; me.w = id; HP.vm.equip(id, !!instant); pl.cd = Math.max(pl.cd, 0.32); pl.bloom = 0;
  }
  function startReload() {
    const me = G.me, pl = me.pl, d = HP.WEAPONS[pl.cur], a = pl.wa[pl.cur]; if (pl.rel || a.mag >= d.mag || HP.vm.swDir || !me.alive) return;
    pl.rel = true; pl.ads = false; const wid = pl.cur;
    HP.vm.reload(d.reload, () => { pl.rel = false; if (pl.cur === wid) pl.wa[wid].mag = d.mag; });
  }
  const _f = new T.Vector3(), _r = new T.Vector3(), _u = new T.Vector3(), _m = new T.Vector3(), _e = new T.Vector3();
  function shoot() {
    const me = G.me, pl = me.pl, d = HP.WEAPONS[pl.cur], a = pl.wa[pl.cur], cam = HP.camera, FX = HP.fx; const VM = HP.vm;
    a.mag--; pl.cd = 60 / d.rpm; me.spawnProt = 0; me.lastFireT = G.now;
    const spread = curSpread(), cone = spread * Math.PI / 180;
    cam.getWorldDirection(_f); _r.set(1, 0, 0).applyQuaternion(cam.quaternion); _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    VM.fire(); HP.audio.shot(d.snd, null, 0, 0); VM.muzzleWorld(_m);
    FX.flashLight.position.copy(_m); FX.flashLight.intensity = 5; FX.flashT = 0.05;
    let any = false, head = false, bodyHits = 0, firstEnt = null; const claim = {};
    let tracers = 0;
    for (let p = 0; p < d.pellets; p++) {
      const ang = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * cone / 2, ox = Math.cos(ang) * rr, oy = Math.sin(ang) * rr;
      const dx = _f.x + _r.x * ox + _u.x * oy, dy = _f.y + _r.y * ox + _u.y * oy, dz = _f.z + _r.z * ox + _u.z * oy, l = Math.hypot(dx, dy, dz);
      const nx = dx / l, ny = dy / l, nz = dz / l;
      const h = G.castRay(cam.position.x, cam.position.y, cam.position.z, nx, ny, nz, d.range, me);
      const len = h ? h.len : d.range; const ex = cam.position.x + nx * len, ey = cam.position.y + ny * len, ez = cam.position.z + nz * len;
      if (tracers < (d.pellets > 1 ? 4 : 1) && (h || d.range < 300)) { tracers++; let tx = ex - _m.x, ty = ey - _m.y, tz = ez - _m.z; const tl = Math.hypot(tx, ty, tz) || 1; FX.tracers.add(_m.x, _m.y, _m.z, tx / tl, ty / tl, tz / tl, tl, d.tracer, 0.03, 420); }
      if (h) {
        if (h.ent) {
          any = true; if (h.zone === "h") head = true; bodyHits++; const e = h.ent; FX.hitBody(h.hx, h.hy, h.hz, nx, ny, nz, h.zone === "h");
          const dm = d.dmg * HP.damageAt(d, h.len) * ZM(d, h.zone);
          if (G.role === "guest") { const c = claim[e.id] || (claim[e.id] = { id: e.id, h: 0, b: 0, l: 0, len: h.len }); c[h.zone]++; } else { G.damage(e, dm, me, h.zone, d.id); }
        } else { FX.impact(h.hx, h.hy, h.hz, h.nx, h.ny, h.nz, h.surf, false); HP.audio.impact(h.surf, h.hx, h.hy, h.hz); }
      }
      // tell others (first pellets only)
      if (p < (d.pellets > 1 ? 3 : 1) && G.role !== "solo") {
        const m = { t: "shot", id: me.id, w: d.id, o: [_m.x, _m.y, _m.z], d: [nx, ny, nz], len: h ? h.len : d.range, s: h ? (h.ent ? "body" : h.surf) : null, n: h && !h.ent ? [h.nx, h.ny, h.nz] : null, hd: !!(h && h.zone === "h") };
        if (G.role === "host") HP.net.broadcast(m); else HP.net.toHost({ t: "fire", m });
      }
    }
    if (G.role === "guest") Object.keys(claim).forEach(k => HP.net.toHost({ t: "hit", id: claim[k].id, w: d.id, h: claim[k].h, b: claim[k].b, l: claim[k].l, len: claim[k].len }));
    if (any) { UIc("hit")(head ? "head" : "body"); HP.audio.hit(head, false); }
    // recoil: camera kick + bloom + shell
    const kv = d.kick[0] * (0.8 + Math.random() * 0.4) * (pl.ads ? 0.72 : 1), kh = (Math.random() - 0.5) * 2 * d.kick[1] * (pl.ads ? 0.7 : 1);
    pl.rkP += kv * Math.PI / 180; pl.rkY += kh * Math.PI / 180; me.pitch = clamp(me.pitch + kv * 0.4 * Math.PI / 180, -1.5, 1.5);
    pl.bloom = Math.min(d.bloomMax, pl.bloom + d.bloom); if (d.id === "longshot") pl.ads = pl.ads && false;
    if (!d.pump) { VM.ejectWorld(_e); FX.shells.emit(_e.x, _e.y, _e.z, _r.x * R(1.3, 2.2) + _u.x * R(0.8, 1.6) + me.vx, _r.y * R(1.3, 2.2) + _u.y * R(0.8, 1.6), _r.z * R(1.3, 2.2) + _u.z * R(0.8, 1.6) + me.vz, false); }
    else if (d.id === "hammer") { /* shell ejects on the pump */ pl.pumpT = 0.38; }
    // dust kicked by the muzzle blast when close to the ground
    if (a.mag <= 0 && d.id !== "longshot") { /* auto reload when dry after a pause */ pl.cd = Math.max(pl.cd, 0.18); }
  }
  function curSpread() {
    const me = G.me, pl = me.pl, d = HP.WEAPONS[pl.cur], ads = HP.vm.ads || 0; let s = lerp(d.hip, d.ads, ads) + pl.bloom;
    s *= 1 + clamp(me.speed / 6, 0, 1) * 0.55; if (!me.onGround) s *= 2.2; if (me.crouch) s *= 0.78; return s;
  }
  G.spread = 2;

  const camPos = new T.Vector3();
  G.cam = { dead: false, shake: 0, bob: 0, fov: 80, landDip: 0, sx: 0, sy: 0 };
  function updateLocal(dt) {
    const me = G.me, pl = me.pl, cam = HP.camera, W = HP.World, d = HP.WEAPONS[pl.cur], VM = HP.vm, A = HP.audio;
    // ---- look
    const sens = 0.0022 * HP.set.sens; const adsK = VM.ads || 0; const zoomK = lerp(1, 1 / d.zoom, adsK);
    pl.lx = G.mdx * sens * zoomK; pl.ly = G.mdy * sens * zoomK; G.mdx = G.mdy = 0;
    if (me.alive && G.locked && !G.match.over) { me.yaw -= pl.lx; me.pitch = clamp(me.pitch - pl.ly, -1.52, 1.52); }
    // ---- cooldowns / spawn protect
    pl.cd -= dt; me.spawnProt = Math.max(0, me.spawnProt - dt); me.recoil = Math.max(0, me.recoil - dt * 6); pl.pumpT && (pl.pumpT -= dt, pl.pumpT <= 0 && (pl.pumpT = 0, HP.fx.shells.emit(cam.position.x, cam.position.y - 0.1, cam.position.z, 1.4, 1.5, 0.2, true)));
    if (!me.alive) { deadCam(dt); return; }
    const active = G.locked && !G.match.over && !G.paused;
    // ---- movement
    const fwd = active ? ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0) : 0, side = active ? ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) : 0;
    const wantCrouch = active && (keys.KeyC || keys.ControlLeft || keys.ControlRight);
    if (wantCrouch) { me.crouch = true; me.h = 1.4; } else if (me.crouch && W.fits(me.x, me.y, me.z, me.r, 1.8)) { me.crouch = false; me.h = 1.8; }
    const aiming = active && pl.ads && !pl.rel;
    const moving = fwd || side; pl.sprint = active && !!(keys.ShiftLeft || keys.ShiftRight) && fwd > 0 && !aiming && !me.crouch && me.onGround && !pl.rel && !pl.fireHeld;
    let sp = 5.0 * d.move; if (pl.sprint) sp = 7.3; if (me.crouch) sp = 2.5; if (aiming) sp *= 0.6;
    const s = Math.sin(me.yaw), c = Math.cos(me.yaw); let wx = -s * fwd + c * side, wz = -c * fwd - s * side; const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
    const k = me.onGround ? Math.min(1, dt * (moving ? 11 : 9)) : Math.min(1, dt * 1.8);
    me.vx += (wx * sp - me.vx) * k; me.vz += (wz * sp - me.vz) * k;
    if (active && keys.Space && me.onGround && !pl.jumpHeld) { me.vy = 7.2; pl.jumpHeld = true; me.onGround = false; A.jump(null, 0, 0); } if (!keys.Space) pl.jumpHeld = false;
    pl.lastVy = me.vy; const wasG = me.onGround; me.stepOK = me.onGround || me.vy < 0.5;
    W.move(me, dt, 20); me.speed = Math.hypot(me.vx, me.vz);
    if (!wasG && me.onGround && pl.lastVy < -4.5) { const f = clamp(-pl.lastVy / 9, 0.3, 1.4); G.cam.landDip = Math.min(0.14, f * 0.11); A.land(null, 0, 0, f); HP.fx.land(me.x, me.z, f); HP.vm.dip = Math.max(HP.vm.dip, f * 0.03); }
    // footsteps
    if (me.onGround && me.speed > 1.2) { pl.stepD += me.speed * dt; const stride = pl.sprint ? 2.1 : me.crouch ? 1.7 : 1.55; if (pl.stepD > stride) { pl.stepD = 0; A.step(null, 0, 0, pl.sprint, me.crouch ? 0.4 : 1); if (me.speed > 4) HP.fx.step(me.x, me.z, pl.sprint); } } else pl.stepD = Math.min(pl.stepD, 1);
    // ---- weapons
    if (active) {
      if (pl.fireEdge) { /* consumed below */ }
      pl.bloom = Math.max(0, pl.bloom - dt * (d.bloomMax * 1.6 + 0.6));
      const a = pl.wa[pl.cur], ready = !pl.rel && !VM.swDir && pl.cd <= 0 && !pl.sprint0;
      const wants = d.auto ? pl.fireHeld : pl.fireEdge;
      if (wants && ready) { if (a.mag > 0) shoot(); else { if (pl.fireEdge) { HP.audio.empty(); pl.cd = 0.2; } startReload(); } }
      pl.fireEdge = false; if (a.mag <= 0 && !pl.rel && !VM.swDir && pl.cd <= 0) startReload();
    } else pl.fireEdge = false;
    // ---- regen (host-side truth is in snapshot for guests; solo/host simulate here)
    if (G.role !== "guest" && me.hp < 100 && G.now - me.lastHurt > 4.5) { me.hp = Math.min(100, me.hp + dt * 9); updatePost(); }
    // ---- camera
    const targetEye = eyeH(me); pl.eye += (targetEye - pl.eye) * Math.min(1, dt * 12);
    G.cam.landDip *= Math.exp(-dt * 9); G.cam.shake *= Math.exp(-dt * 8);
    const sp01 = clamp(me.speed / 7, 0, 1) * (me.onGround ? 1 : 0.1); pl.phase += dt * (6.5 + 4 * sp01) * sp01;
    const bobY = HP.set.bobs ? Math.sin(pl.phase * 2) * 0.014 * sp01 : 0, bobX = HP.set.bobs ? Math.sin(pl.phase) * 0.012 * sp01 : 0;
    pl.rkP *= Math.exp(-dt * 6.2); pl.rkY *= Math.exp(-dt * 6.2);
    const sh = HP.set.shake ? G.cam.shake : 0;
    cam.position.set(me.x + Math.cos(me.yaw) * bobX, me.y + pl.eye + bobY - G.cam.landDip, me.z - Math.sin(me.yaw) * bobX);
    cam.rotation.set(me.pitch + pl.rkP + (Math.random() - 0.5) * 0.02 * sh, me.yaw + pl.rkY + (Math.random() - 0.5) * 0.02 * sh, (Math.random() - 0.5) * 0.03 * sh - bobX * 0.4 - (side * 0.012) * (pl.sprint ? 0 : 1) * 0, "YXZ");
    // fov: base + sprint kick, zoomed when aiming
    const base = HP.set.fov * Math.PI / 180, zoom = lerp(1, d.zoom, VM.ads || 0); let fov = 2 * Math.atan(Math.tan(base / 2) / zoom); fov += (pl.sprint ? 0.05 : 0) * (1 - (VM.ads || 0));
    G.cam.fov += (fov * 180 / Math.PI - G.cam.fov) * Math.min(1, dt * 14); if (Math.abs(HP.camera.fov - G.cam.fov) > 0.01) HP.setFov(G.cam.fov);
    pl.sprint0 = false; HP.vmAnchor.quaternion.copy(cam.quaternion);
    G.spread = curSpread();
    const ads = VM.update(dt, { speed: me.speed, maxSpeed: 7.3, sprint: pl.sprint, aimK: aiming ? 1 : 0, crouch: me.crouch, ground: me.onGround, lx: pl.lx, ly: pl.ly, landV: 0 });
    G.ads = ads;
  }
  function deadCam(dt) {
    const me = G.me, pl = me.pl, cam = HP.camera; pl.deadT += dt;
    const k = clamp(pl.deadT / 0.7, 0, 1), e = 1 - Math.pow(1 - k, 3);
    const ey = lerp(pl.eye, 0.32, e); const yaw = lerp(me.yaw, pl.killer ? pl.deadYaw : me.yaw, clamp(pl.deadT / 1.2, 0, 1));
    G.cam.shake *= Math.exp(-dt * 5); const sh = HP.set.shake ? G.cam.shake : 0;
    cam.position.set(me.x, me.y + ey, me.z); cam.rotation.set(lerp(me.pitch, -0.12, e) + (Math.random() - 0.5) * 0.02 * sh, yaw, e * 0.5 * (pl.roll || (pl.roll = Math.random() < 0.5 ? 1 : -1)), "YXZ");
    G.cam.fov += (HP.set.fov - G.cam.fov) * Math.min(1, dt * 6); HP.setFov(G.cam.fov);
    HP.vm.update(dt, { speed: 0, maxSpeed: 7, sprint: false, aimK: 0, crouch: false, ground: true, lx: 0, ly: 0, landV: 0 }); HP.vmVisible = pl.deadT < 0.25;
    me.vx *= 0.9; me.vz *= 0.9; HP.World.move(me, dt, 20);
    const left = Math.max(0, (G.role === "guest" ? pl.deadLeft : me.respawnAt - G.now)); UIc("deathTime")(left);
    if (G.role === "guest") pl.deadLeft = Math.max(0, (pl.deadLeft == null ? 3 : pl.deadLeft) - dt);
  }
  function updatePost() {
    const me = G.me; if (!me) return; const low = me.alive ? clamp((45 - me.hp) / 45, 0, 1) : 0.0;
    HP.postFx({ low });
  }

  /* ================= remote entities ================= */
  function updateRemote(e, dt) {
    if (e.local) return;
    if (G.role === "guest" || (G.role === "host" && !e.bot)) {          // smoothed toward the last received pose
      if (!e.snapped) { e.x = e.tx; e.y = e.ty; e.z = e.tz; e.yaw = e.tyaw; e.pitch = e.tpitch; e.snapped = true; }
      const k = Math.min(1, dt * 14), ox = e.x, oz = e.z;
      e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; e.z += (e.tz - e.z) * k; e.yaw += HP.angDiff(e.yaw, e.tyaw) * k; e.pitch += (e.tpitch - e.pitch) * k;
      if (dt > 0) e.speed += (Math.hypot(e.x - ox, e.z - oz) / dt - e.speed) * Math.min(1, dt * 10);
    }
    e.recoil = Math.max(0, e.recoil - dt * 6); e.spawnProt = Math.max(0, e.spawnProt - dt);
    // positional footsteps
    if (e.alive && e.speed > 1.6) { e.stepD += e.speed * dt; if (e.stepD > (e.speed > 4.5 ? 2.0 : 1.5)) { e.stepD = 0; const d = Math.hypot(e.x - HP.camera.position.x, e.z - HP.camera.position.z); if (d < 38) HP.audio.step(e.x, e.y + 0.1, e.z, e.speed > 4.5, clamp(1 - d / 45, 0.2, 1)); } }
  }

  /* ================= match flow ================= */
  function roster() { return [...G.ents.values()].map(e => ({ id: e.id, name: e.name, bot: e.bot, tint: e.tint, w: e.w, host: e.host })); }
  game.startMatch = function () {              // host / solo
    if (G.role === "guest") return;
    clearBots(); const used = new Set([...G.ents.values()].map(e => e.name));
    const humans = [...G.ents.values()].filter(e => !e.bot).length, nb = clamp(G.cfg.bots, 0, Math.max(0, 8 - humans));
    for (let i = 0; i < nb; i++) { const nm = HP.bots.pickName(used); used.add(nm); const b = mkEnt({ id: G.nextId++, name: nm, bot: true, tint: HP.rndi(0, TINT_N - 1) }); HP.bots.init(b, G.cfg.diff); }
    G.ents.forEach(e => { e.k = e.d = e.hs = 0; });
    G.match = { target: G.cfg.target || 20, time: G.cfg.time || 420, left: G.cfg.time || 420, over: false };
    const m = { t: "start", match: G.match, roster: roster() };
    if (G.role === "host") HP.net.broadcast(m);
    onStart(m, true);
    G.ents.forEach(e => { if (e.local || e.bot || G.role === "host") hostRespawn(e); });
  };
  function onStart(m, isHost) {
    if (!isHost) { clearOthers(); m.roster.forEach(r => { if (r.id === G.me.id) { return; } mkEnt(r); }); G.match = m.match; G.ents.forEach(e => { e.k = e.d = e.hs = 0; }); }
    G.match.over = false; G.state = "play"; G.sync = 0; G.t0 = G.now;
    UIc("screen")("none"); UIc("hud")(true); UIc("endHide")(); HP.vmVisible = true; HP.vm.reset(); G.cam.dead = false; UIc("respawned")(); lockPointer();
    if (G.me) { G.me.alive = G.role === "guest" ? false : G.me.alive; }
    if (HP.audio.ok) HP.audio.ui("go");
  }
  function onEnd(m) {
    G.match.over = true; G.state = "end"; UIc("hud")(true); try { document.exitPointerLock(); } catch (e) { }
    UIc("end")({ rows: m.rows, win: m.win, me: G.me.id, host: G.role !== "guest", solo: G.role === "solo" });
    HP.audio.ui(m.win === G.me.id ? "win" : "tick");
  }
  game.again = function () { if (G.role === "guest") return; UIc("endHide")(); game.startMatch(); };
  game.toMenu = function () { game.leave(); };

  /* ================= start / leave ================= */
  game.playSolo = function () {
    HP.audio.init(); resetSession(); G.role = "solo"; makeLocal(); G.cfg.bots = HP.set.bots; G.cfg.diff = HP.set.diff; G.cfg.target = 20; G.cfg.time = 420; game.startMatch();
  };
  function resetSession() { clearOthers(); if (G.me) { G.ents.delete(G.me.id); G.me = null; } G.nextId = 1; G.peers.clear(); G.match = { target: 20, time: 420, left: 420, over: false }; G.paused = false; G.state = "menu"; }
  function playerName() { return (HP.set.name || "").trim().slice(0, 14) || ("Player" + HP.rndi(100, 999)); }
  function makeLocal(id, host) {
    const nm = playerName(); const e = mkEnt({ id: id || G.nextId++, name: nm, local: true, tint: 0, host: !!host }); e.pl = newPl(); G.me = e; G.cam.dead = false; HP.vm.equip(e.pl.cur, true); return e;
  }
  game.leave = function () {
    try { if (HP.net.conn) HP.net.conn.close(); HP.net.conns.forEach(c => { try { c.close(); } catch (_) { } }); } catch (e) { } try { if (HP.net.peer) HP.net.peer.destroy(); } catch (e) { } HP.net.role = "solo"; HP.net.conns.clear(); HP.net.conn = null; HP.net.peer = null; HP.net.code = null;
    resetSession(); G.role = "solo"; G.state = "menu"; HP.vmVisible = false; UIc("hud")(false); UIc("screen")("title"); UIc("pause")(false); UIc("endHide")(); HP.postFx({ low: 0, dmg: 0 }); try { document.exitPointerLock(); } catch (e) { }
    HP.fx.clearAll(); HP.setFov(HP.set.fov); G.cam.fov = HP.set.fov; backdrop(true);
  };

  /* ---- rooms ---- */
  function refreshLobby() {
    if (G.state !== "lobby") return; UIc("lobby")({ code: G.code, host: G.role === "host", players: [...G.ents.values()].filter(e => !e.bot).map(e => ({ name: e.name, host: e.host, me: e.local })), bots: G.cfg.bots, diff: G.cfg.diff });
  }
  game.setCfg = function (o) { Object.assign(G.cfg, o); if (G.role === "host" && G.state === "lobby") { refreshLobby(); } };
  game.hostRoom = function () {
    HP.audio.init(); UIc("msg")("Creating room…"); resetSession();
    HP.net.host({
      onReady: code => { G.role = "host"; G.code = code; makeLocal(G.nextId++, true); G.cfg.bots = HP.set.bots; G.cfg.diff = HP.set.diff; G.state = "lobby"; UIc("screen")("lobby"); refreshLobby(); history.replaceState(null, "", "?room=" + code); },
      onError: msg => { UIc("msg")(msg, true); G.role = "solo"; },
      onJoin: pid => { /* wait for hello */ },
      onLeave: pid => { const id = G.peers.get(pid); G.peers.delete(pid); if (id != null) { G.emit({ t: "leave", id }, true); } },
      onMsg: (pid, m) => hostMsg(pid, m),
    });
  };
  game.joinRoom = function (code) {
    HP.audio.init(); resetSession(); UIc("msg")("Joining room…");
    HP.net.join(code, {
      onOpen: () => { G.role = "guest"; G.code = HP.net.code; HP.net.toHost({ t: "hello", name: playerName() }); },
      onError: msg => { UIc("msg")(msg, true); G.role = "solo"; },
      onMsg: m => guestMsg(m),
      onClose: () => { UIc("msg")("The host left the room.", true); game.leave(); UIc("msg")("The host left the room.", true); },
    });
  };
  function hostMsg(pid, m) {
    if (m.t === "hello") {
      if ([...G.ents.values()].filter(e => !e.bot).length >= 6) { HP.net.sendTo(pid, { t: "full" }); return; }
      const e = mkEnt({ id: G.nextId++, name: String(m.name || "Player").slice(0, 14), tint: HP.rndi(0, TINT_N - 1) }); G.peers.set(pid, e.id); e.peer = pid;
      HP.net.sendTo(pid, { t: "welcome", id: e.id, started: G.state === "play" || G.state === "end", match: G.match, roster: roster(), code: G.code, sc: scoreRows() });
      HP.net.broadcast({ t: "join", e: { id: e.id, name: e.name, bot: false, tint: e.tint, w: e.w } }); if (G.state === "lobby") refreshLobby();
      if (G.state === "play" && !G.match.over) setTimeout(() => hostRespawn(e), 400);
      return;
    }
    const id = G.peers.get(pid), e = id != null ? G.ents.get(id) : null; if (!e) return;
    if (m.t === "p") { e.tx = clamp(+m.x || 0, -49, 49); e.ty = clamp(+m.y || 0, -2, 12); e.tz = clamp(+m.z || 0, -49, 49); e.tyaw = +m.yaw || 0; e.tpitch = +m.pitch || 0; e.crouch = !!(m.f & 2); e.h = e.crouch ? 1.4 : 1.8; if (HP.WEAPONS[m.w]) { e.w = m.w; if (e.ch) e.ch.setWeapon(m.w); } }
    else if (m.t === "fire") { const f = m.m; if (f && f.o && f.d) { f.id = e.id; HP.net.broadcast(f); shotFx(f); } }
    else if (m.t === "hit") {
      const w = HP.WEAPONS[m.w], v = G.ents.get(m.id); if (!w || !v || !v.alive || !e.alive) return;
      // basic sanity: rate limit per guest, range check from host-known positions
      const now = G.now; e.hitLog = e.hitLog || {}; const last = e.hitLog[m.w] || 0; if (now - last < 60 / w.rpm * 0.55) return; e.hitLog[m.w] = now;
      const dist = Math.hypot(v.x - e.x, v.z - e.z); if (dist > w.range + 6) return;
      const nh = clamp(m.h | 0, 0, w.pellets), nb = clamp(m.b | 0, 0, w.pellets), nl = clamp(m.l | 0, 0, w.pellets); if (nh + nb + nl > w.pellets) return; const fall = HP.damageAt(w, dist);
      const total = w.dmg * fall * (nh * w.head + nb + nl * w.leg); if (total > 0) G.damage(v, total, e, nh ? "h" : nb ? "b" : "l", w.id);
    }
  }
  function guestMsg(m) {
    switch (m.t) {
      case "full": UIc("msg")("That room is full.", true); game.leave(); break;
      case "welcome": {
        G.code = m.code || G.code; G.match = m.match; const me = makeLocal(m.id, false); me.host = false; G.nextId = 1000;
        m.roster.forEach(r => { if (r.id !== m.id) { const e = mkEnt(r); } }); (m.sc || []).forEach(r => { const e = G.ents.get(r[0]); if (e) { e.k = r[1]; e.d = r[2]; e.hs = r[3]; } });
        if (m.started && !m.match.over) { G.state = "play"; G.sync = 0; UIc("screen")("none"); UIc("hud")(true); HP.vmVisible = true; me.alive = false; G.cam.dead = true; me.pl.deadT = 0; me.pl.deadLeft = 1; lockPointer(); }
        else { G.state = "lobby"; UIc("screen")("lobby"); refreshLobby(); }
        break; }
      case "s": applySnap(m); break;
      case "spawn": { const e = G.ents.get(m.id); if (!e) break; placeAt(e, m); if (m.w) { e.w = m.w; if (e.ch) e.ch.setWeapon(m.w); } if (e.local) { onSpawned(e); } break; }
      default: G.handle(m);
    }
  }
  function applySnap(m) {
    const me = G.me; if (m.l != null) G.match.left = m.l;
    m.e.forEach(a => {
      const e = G.ents.get(a[0]); if (!e) return;
      if (e.local) { if (e.alive && a[8] > e.hp) e.hp = a[8]; return; }
      e.tx = a[1]; e.ty = a[2]; e.tz = a[3]; e.tyaw = a[4]; e.tpitch = a[5]; const fl = a[6]; const wasAlive = e.alive; e.alive = !!(fl & 1); e.crouch = !!(fl & 2); e.h = e.crouch ? 1.4 : 1.8; e.hp = a[8];
      const w = HP.WORDER[a[7]]; if (w && w !== e.w) { e.w = w; if (e.ch) e.ch.setWeapon(w); } if (e.alive && !wasAlive) { e.snapped = false; } if (e.ch && e.alive) e.ch.root.visible = true;
    });
  }
  function sendSnap() {
    const arr = []; G.ents.forEach(e => { arr.push([e.id, +e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2), +e.yaw.toFixed(3), +e.pitch.toFixed(3), (e.alive ? 1 : 0) | (e.crouch ? 2 : 0), Math.max(0, WIDX(e.w)), Math.round(e.hp)]); });
    HP.net.broadcast({ t: "s", e: arr, l: Math.round(G.match.left) });
  }
  function sendPose() {
    const me = G.me; if (!me) return; HP.net.toHost({ t: "p", x: +me.x.toFixed(2), y: +me.y.toFixed(2), z: +me.z.toFixed(2), yaw: +me.yaw.toFixed(3), pitch: +(me.pitch + me.pl.rkP).toFixed(3), f: (me.alive ? 1 : 0) | (me.crouch ? 2 : 0), w: me.w });
  }

  /* ================= pointer lock + input ================= */
  function lockPointer() { if (HP.TOUCH) { G.locked = true; return; } try { const r = HP.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
  G.lock = lockPointer;
  document.addEventListener("pointerlockchange", () => {
    G.locked = document.pointerLockElement === HP.canvas;
    if (!G.locked && G.state === "play" && !G.match.over && G.me && !HP.TOUCH) { UIc("pause")(true); if (G.role === "solo") G.paused = true; }
    if (G.locked) { UIc("pause")(false); G.paused = false; }
  });
  document.addEventListener("mousemove", e => { if (G.locked) { G.mdx += e.movementX || 0; G.mdy += e.movementY || 0; } });
  const typing = () => { const a = document.activeElement; return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT"); };
  addEventListener("keydown", e => {
    if (typing()) return; keys[e.code] = true;
    if (G.state !== "play" || !G.me) return; const me = G.me, pl = me.pl;
    if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
    if (e.code === "Tab") UIc("board")(true, boardRows());
    if (!me.alive || !G.locked) return;
    if (e.code === "KeyR") startReload();
    const dig = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 }[e.code]; if (dig != null) selectWeapon(HP.WORDER[dig]);
    if (e.code === "KeyQ") selectWeapon(pl.prev);
    if (e.code === "KeyF") pl.ads = false;
  });
  addEventListener("keyup", e => { keys[e.code] = false; if (e.code === "Tab") UIc("board")(false); });
  addEventListener("blur", () => { for (const k in keys) keys[k] = false; });
  document.addEventListener("mousedown", e => {
    if (G.state !== "play" || !G.me || !G.locked) return; const pl = G.me.pl;
    if (e.button === 0) { pl.fireHeld = true; pl.fireEdge = true; } else if (e.button === 2) { pl.ads = HP.set.adsToggle ? !pl.ads : true; }
  });
  document.addEventListener("mouseup", e => { if (!G.me) return; const pl = G.me.pl; if (e.button === 0) pl.fireHeld = false; else if (e.button === 2 && !HP.set.adsToggle) pl.ads = false; });
  document.addEventListener("contextmenu", e => { if (G.state === "play") e.preventDefault(); });
  addEventListener("wheel", e => { if (G.state !== "play" || !G.me || !G.locked || !G.me.alive) return; const i = HP.WORDER.indexOf(G.me.pl.cur), n = HP.WORDER.length; selectWeapon(HP.WORDER[(i + (e.deltaY > 0 ? 1 : -1) + n) % n]); }, { passive: true });
  function boardRows() { return [...G.ents.values()].sort((a, b) => b.k - a.k || a.d - b.d).map(e => ({ name: e.name, k: e.k, d: e.d, hs: e.hs, me: e.local, bot: e.bot, alive: e.alive })); }
  game.resume = function () { UIc("pause")(false); G.paused = false; lockPointer(); };

  /* touch controls (phones): left stick, right-side look drag, FIRE / AIM / JUMP / RELOAD buttons */
  game.initTouch = function () {
    const el = HP.$("touch"); if (!el) return; const stick = HP.$("tstick"), knob = HP.$("tknob"); let sid = null, lid = null, sx = 0, sy = 0, lx = 0, ly = 0; const SR = 52;
    const mv = (x, y) => { let dx = x - sx, dy = y - sy; const l = Math.hypot(dx, dy); if (l > SR) { dx = dx / l * SR; dy = dy / l * SR; } knob.style.transform = `translate(${dx}px,${dy}px)`; keys.KeyW = dy < -12; keys.KeyS = dy > 12; keys.KeyA = dx < -12; keys.KeyD = dx > 12; keys.ShiftLeft = dy < -SR * 0.92; };
    el.addEventListener("touchstart", e => { for (const t of e.changedTouches) { const tg = t.target; if (tg.dataset && tg.dataset.btn) continue; if (t.clientX < innerWidth * 0.4 && sid == null) { sid = t.identifier; const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; mv(t.clientX, t.clientY); } else if (lid == null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } } e.preventDefault(); }, { passive: false });
    el.addEventListener("touchmove", e => { for (const t of e.changedTouches) { if (t.identifier === sid) mv(t.clientX, t.clientY); else if (t.identifier === lid) { G.mdx += (t.clientX - lx) * 1.6; G.mdy += (t.clientY - ly) * 1.6; lx = t.clientX; ly = t.clientY; } } e.preventDefault(); }, { passive: false });
    const end = e => { for (const t of e.changedTouches) { if (t.identifier === sid) { sid = null; knob.style.transform = ""; keys.KeyW = keys.KeyS = keys.KeyA = keys.KeyD = keys.ShiftLeft = false; } else if (t.identifier === lid) lid = null; } };
    el.addEventListener("touchend", end); el.addEventListener("touchcancel", end);
    const bind = (id, down, up) => { const b = HP.$(id); if (!b) return; b.addEventListener("touchstart", e => { e.preventDefault(); e.stopPropagation(); down(); }, { passive: false }); b.addEventListener("touchend", e => { e.preventDefault(); up && up(); }, { passive: false }); };
    bind("tfire", () => { if (G.me) { G.me.pl.fireHeld = true; G.me.pl.fireEdge = true; } }, () => { if (G.me) G.me.pl.fireHeld = false; });
    bind("tads", () => { if (G.me) G.me.pl.ads = !G.me.pl.ads; }); bind("tjump", () => { keys.Space = true; setTimeout(() => keys.Space = false, 120); }); bind("trel", () => startReload());
    bind("tcrouch", () => { keys.KeyC = !keys.KeyC; }); bind("tswap", () => { if (G.me) { const i = HP.WORDER.indexOf(G.me.pl.cur); selectWeapon(HP.WORDER[(i + 1) % HP.WORDER.length]); } });
  };

  /* ================= menu backdrop ================= */
  let bg = { chars: [], t: 0, cam: null };
  function backdrop(on) {
    bg.on = on; bg.chars.forEach(c => c.root.visible = on);
    if (on && !bg.chars.length && HP.chars.ready) {
      [["arc7", -3.0, 5.5, 0.5], ["longshot", 4.4, -6.5, 2.7], ["hammer", 6.5, 5.0, -0.9]].forEach((p, i) => { const c = HP.chars.make(i + 1, p[0]); c.root.position.set(p[1], 0, p[2]); c.root.visible = true; HP.scene.add(c.root); c.e = { x: p[1], y: 0, z: p[2], yaw: p[3], pitch: 0.02, speed: 0, crouch: i === 1, alive: true, w: p[0], recoil: 0 }; c.setName(["", "", ""][i]); c.np.visible = false; bg.chars.push(c); });
    }
  }
  function menuCam(dt) {
    bg.t += dt; const a = -0.55 + Math.sin(bg.t * 0.05) * 0.5 + bg.t * 0.012, r = 15.5 + Math.sin(bg.t * 0.11) * 1.5, cam = HP.camera;
    cam.position.set(Math.sin(a) * r + 1.2, 1.9 + Math.sin(bg.t * 0.17) * 0.35, Math.cos(a) * r + 2); cam.lookAt(0.8, 1.25, 1.0); cam.rotation.order = "YXZ"; cam.updateMatrixWorld(true);
    bg.chars.forEach(c => { c.e.recoil = 0; HP.chars.update(c, c.e, dt); c.np.visible = false; });
    HP.setFov(58);
  }

  /* ================= main loop ================= */
  let last = 0, snapT = 0, poseT = 0, secT = 0; const R_ = t => { if (!G.noRender) HP.render(t); };
  game.frame = function (tms, forceDt) {
    const t = tms / 1000; let dt = forceDt != null ? forceDt : Math.min(0.05, t - last || 0.016); last = t; G.now = t; HP.adapt && forceDt == null && HP.adapt(dt);
    const dust = HP.dust; if (dust) { dust.material.uniforms.time.value = t; dust.material.uniforms.center.value.copy(HP.camera.position); dust.material.uniforms.pr.value = HP.renderer.getPixelRatio() * (HP.Q.dust || 0); dust.visible = (HP.Q.dust || 0) > 0; }
    if (G.state === "menu" || G.state === "lobby" || G.state === "boot") { menuCam(dt); HP.vmVisible = false; HP.updateSun(HP.camera.position.x, 0, HP.camera.position.z); HP.fx.update(dt, HP.camera); HP.audio.listen(HP.camera); R_(t); return; }
    if (G.paused && G.role === "solo") { HP.updateSun(HP.camera.position.x, 0, HP.camera.position.z); HP.audio.listen(HP.camera); R_(t); return; }
    const me = G.me;
    // ---- simulation
    if (me) updateLocal(dt);
    G.ents.forEach(e => {
      if (e.local) return;
      if (G.role !== "guest" && e.bot) {
        if (e.alive) { e.spawnProt = Math.max(0, e.spawnProt - dt); HP.bots.update(e, dt, G); e.recoil = Math.max(0, e.recoil - dt * 6); }
        else if (G.role !== "guest" && G.state === "play" && !G.match.over && e.respawnAt && G.now >= e.respawnAt) { e.respawnAt = 0; hostRespawn(e); }
      } else updateRemote(e, dt);
    });
    if (G.role !== "guest") {
      // host/solo: respawn the human player + remote humans, regen, match clock
      G.ents.forEach(e => { if (!e.bot && !e.alive && e.respawnAt && G.now >= e.respawnAt && G.state === "play" && !G.match.over) { e.respawnAt = 0; hostRespawn(e); }
        if (!e.local && !e.bot && e.alive && e.hp < 100 && G.now - e.lastHurt > 4.5) e.hp = Math.min(100, e.hp + dt * 9);
        if (e.bot && e.alive && e.hp < 100 && G.now - e.lastHurt > 6) e.hp = Math.min(100, e.hp + dt * 6); });
      if (G.state === "play" && !G.match.over) { secT += dt; G.match.left = Math.max(0, G.match.left - dt); if (G.match.left <= 0) { let top = null; G.ents.forEach(e => { if (!top || e.k > top.k) top = e; }); endMatch(top); } }
      if (G.role === "host") { snapT += dt; if (snapT >= 1 / 15) { snapT = 0; sendSnap(); } }
    } else { poseT += dt; if (poseT >= 1 / 20) { poseT = 0; sendPose(); } G.match.left = Math.max(0, G.match.left - dt); }
    // ---- visuals for everyone else
    G.ents.forEach(e => { if (e.local || !e.ch) return; const ch = e.ch; if (e.alive || ch.deadT < 8) { HP.chars.update(ch, e, dt); if (e.alive) { ch.np.visible = e.spawnProt <= 0 || true; } } ch.root.visible = (e.alive || ch.deadT < 9); });
    if (me) { HP.updateSun(HP.camera.position.x, 0, HP.camera.position.z); }
    HP.fx.update(dt, HP.camera); HP.audio.listen(HP.camera);
    if (me) { UIc("hudTick")(hudData()); } G.cam.shake = G.cam.shake || 0;
    R_(t);
  };
  function hudData() {
    const me = G.me, pl = me.pl, d = HP.WEAPONS[pl.cur]; let lead = null; G.ents.forEach(e => { if (e !== me && (!lead || e.k > lead.k)) lead = e; });
    const fov = HP.camera.fov * Math.PI / 180, px = Math.tan(G.spread * Math.PI / 360) / Math.tan(fov / 2) * innerHeight / 2;
    return { hp: Math.ceil(me.hp), alive: me.alive, mag: pl.wa[pl.cur].mag, magMax: d.mag, reloading: pl.rel, wname: d.name, wkind: d.kind, cur: pl.cur, slots: HP.WORDER.map(id => ({ id, name: HP.WEAPONS[id].name, on: id === pl.cur, mag: pl.wa[id].mag })), spreadPx: px, ads: HP.vm.ads || 0, scope: !!(d.scope && (HP.vm.ads || 0) > 0.9 && me.alive), my: me.k, lead: lead ? { name: lead.name, k: lead.k } : null, target: G.match.target, left: G.match.left, sprint: pl.sprint, prot: me.spawnProt > 0, state: G.state };
  }

  /* ================= boot ================= */
  game.boot = async function () {
    HP.initRenderer(); HP.resize(); UIc("init")();
    const prog = (a, b) => p => UIc("setLoad")(a + (b - a) * p);
    await HP.loadTextures(prog(0, 0.55)); UIc("setLoad")(0.55);
    HP.buildMap(); HP.makeDust(); HP.fx.init(HP.scene); HP.vm.init(); UIc("setLoad")(0.62);
    try { await document.fonts.ready; } catch (e) { }
    await HP.chars.load(p => UIc("setLoad")(0.62 + 0.3 * p)); UIc("setLoad")(0.95);
    HP.post && 0; HP.applyLook(); backdrop(true); G.state = "menu"; HP.vmVisible = false;
    // compile shaders now so the first frame of the match doesn't hitch
    try { HP.renderer.compile(HP.scene, HP.camera); } catch (e) { }
    UIc("setLoad")(1); UIc("ready")();
    const q = new URLSearchParams(location.search).get("room"); if (q) UIc("prefillCode")(q);
    requestAnimationFrame(function loop(t) { try { game.frame(t); } catch (e) { console.error(e); } requestAnimationFrame(loop); });
    game.initTouch();
  };
  game.applySettings = function () {
    HP.setQuality(HP.set.quality); HP.applyLook(); HP.audio.setVol(HP.set.vol); HP.fx && 0; if (G.state === "menu" || G.state === "lobby") HP.setFov(58); else { G.cam.fov = HP.set.fov; HP.setFov(HP.set.fov); }
    UIc("applyCrosshair")(); HP.save();
  };
  /* test hooks */
  HP.dbg.G = G; HP.dbg.mkEnt = mkEnt; HP.dbg.hostRespawn = hostRespawn; HP.dbg.shoot = shoot; HP.dbg.select = selectWeapon;
})();

/* headless logic simulation for tests: runs N seconds of game time without drawing */
HP.dbg.sim = function (secs, dt) { dt = dt || 1 / 30; const G = HP.G; G.noRender = true; let t = (G.now || 0); const n = Math.round(secs / dt); for (let i = 0; i < n; i++) { t += dt; HP.game.frame(t * 1000, dt); } G.noRender = false; };
