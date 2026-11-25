/* ============================================================
   HOLLOWPOINT · bots.js
   Bot brains: nav-grid pathfinding, line-of-sight perception with reaction time,
   hearing, strafing, bursts, reloads, difficulty levels.
   Runs on the host (or solo player) only; guests just see the soldiers.
   ============================================================ */
"use strict";
(function () {
  const clamp = HP.clamp, R = HP.rnd;
  const NAMES = ["Ghost", "KiloFox", "Dusty", "Mamba", "Razor", "Nomad", "Vector", "Falcon", "Ironside", "Tango", "Sandstorm", "Bishop", "Cobra", "Maverick", "Zephyr", "Reaper", "Hawk", "Rook", "Saber", "Echo", "Onyx", "Phantom", "Bolt", "Jackal", "Titan", "Wraith", "Nova", "Atlas", "Havoc", "Drifter", "Kestrel", "Mirage"];
  const DIFF = {
    easy: { react: 0.75, turn: 3.4, acc: 3.6, dmg: 0.55, rate: 0.6, speed: 4.1, head: 0.08, think: 0.28 },
    normal: { react: 0.4, turn: 6.2, acc: 2.0, dmg: 0.8, rate: 0.8, speed: 4.9, head: 0.22, think: 0.2 },
    hard: { react: 0.22, turn: 9.0, acc: 1.15, dmg: 1.0, rate: 0.95, speed: 5.6, head: 0.4, think: 0.14 },
  };
  const PREF = { arc7: 20, viper: 12, hammer: 7, longshot: 42, sidekick: 14 };
  const WPICK = [["arc7", 38], ["viper", 24], ["hammer", 16], ["sidekick", 9], ["longshot", 13]];
  function pickWeapon() { let t = 0; WPICK.forEach(w => t += w[1]); let r = Math.random() * t; for (const w of WPICK) { r -= w[1]; if (r <= 0) return w[0]; } return "arc7"; }
  const _tmp = { x: 0, z: 0 };

  const B = HP.bots = { names: NAMES, DIFF };
  B.pickName = function (used) { const free = NAMES.filter(n => !used.has(n)); return HP.pick(free.length ? free : NAMES); };
  B.init = function (e, diff) {
    const d = DIFF[diff] || DIFF.normal;
    e.w = pickWeapon(); e.ai = { d, st: "roam", path: null, pi: 0, goal: null, tgt: null, seen: 0, lost: 0, last: null, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: R(0.4, 1.4), err: [0, 0], errT: 0, cd: 0, burst: 0, rest: 0, ammo: HP.WEAPONS[e.w].mag, reload: 0, stuck: 0, lx: e.x, lz: e.z, think: R(0, 0.3), repath: 0, headAim: Math.random() < d.head, alertT: 0, heard: null, jitter: R(0.9, 1.1) };
  };
  B.respawned = function (e) { const a = e.ai; if (!a) return; e.w = pickWeapon(); a.ammo = HP.WEAPONS[e.w].mag; a.st = "roam"; a.path = null; a.tgt = null; a.seen = 0; a.reload = 0; a.cd = 0.4; a.rest = 0; a.last = null; a.heard = null; a.headAim = Math.random() < a.d.head; if (e.ch) e.ch.setWeapon(e.w); };
  B.alert = function (e, attacker) { const a = e.ai; if (!a || !attacker) return; a.heard = { x: attacker.x, z: attacker.z, t: 3 }; a.alertT = 2.5; };

  function eyeOf(e) { return e.y + (e.crouch ? 1.12 : 1.58); }
  function pickGoal(e, G) {
    const W = HP.World, sp = W.spawns; let best = null;
    // like a radar ping: most of the time head for where the other team is, so fights find each other fast
    if (Math.random() < 0.65) {
      const foes = []; G.ents.forEach(t => { if (t.alive && t.team !== e.team) foes.push(t); });
      if (foes.length) { const t = foes[Math.floor(Math.random() * foes.length)]; let bd = 1e9; for (let i = 0; i < 12; i++) { const s = sp[Math.floor(Math.random() * sp.length)]; const d = Math.hypot(s.x - t.x, s.z - t.z); if (d < bd && Math.hypot(s.x - e.x, s.z - e.z) > 6) { bd = d; best = s; } } if (best) return { x: best.x + R(-1.5, 1.5), z: best.z + R(-1.5, 1.5) }; }
    }
    for (let i = 0; i < 6; i++) { const s = sp[Math.floor(Math.random() * sp.length)]; const d = Math.hypot(s.x - e.x, s.z - e.z); if (d > 9 && (!best || Math.random() < 0.5)) best = s; }
    best = best || sp[0]; return { x: best.x + R(-1.5, 1.5), z: best.z + R(-1.5, 1.5) };
  }
  function setPath(e, gx, gz) { const a = e.ai; a.goal = { x: gx, z: gz }; a.path = HP.World.path(e.x, e.z, gx, gz); a.pi = 0; a.repath = 0; if (!a.path || !a.path.length) a.path = [[gx, gz]]; }
  function turnTo(e, yaw, pitch, rate, dt) {
    const dy = HP.angDiff(e.yaw, yaw), st = rate * dt; e.yaw += Math.abs(dy) < st ? dy : Math.sign(dy) * st; const dp = pitch - e.pitch; e.pitch += Math.abs(dp) < st ? dp : Math.sign(dp) * st; e.pitch = clamp(e.pitch, -1.2, 1.2);
  }

  B.update = function (e, dt, G) {
    const a = e.ai, d = a.d, W = HP.World, w = HP.WEAPONS[e.w]; if (!a) return;
    a.cd -= dt; a.rest -= dt; a.strafeT -= dt; a.errT -= dt; a.repath += dt; a.think -= dt; a.alertT -= dt; if (a.heard) { a.heard.t -= dt; if (a.heard.t <= 0) a.heard = null; }
    if (a.reload > 0) { a.reload -= dt; if (a.reload <= 0) a.ammo = w.mag; }
    /* ---------- perception ---------- */
    if (a.think <= 0) {
      a.think = d.think * R(0.8, 1.25); let best = null, bd = 1e9; const ex = e.x, ez = e.z, ey = eyeOf(e);
      G.ents.forEach(t => {
        if (t === e || !t.alive || t.team === e.team || t.spawnProt > 0.3) return; const dx = t.x - ex, dz = t.z - ez, dist = Math.hypot(dx, dz); if (dist > (e.w === "longshot" ? 90 : 62)) return;
        const fa = Math.abs(HP.angDiff(e.yaw, Math.atan2(-dx, -dz))); const noticed = fa < 1.75 || dist < 7 || (a.alertT > 0) || (G.now - (t.lastFireT || -9) < 1.0 && dist < 38);
        if (!noticed) return; const ty = t.y + (t.crouch ? 0.8 : 1.3);
        if (W.clear(ex, ey, ez, t.x, ty, t.z) && dist < bd) { bd = dist; best = t; }
      });
      if (best) { if (a.tgt !== best.id) { a.tgt = best.id; a.seen = 0; } a.lost = 0; a.last = { x: best.x, z: best.z }; a.st = "engage"; }
      else if (a.tgt != null) { a.lost += a.think; if (a.lost > 0.9) { a.tgt = null; if (a.last) { a.st = "search"; setPath(e, a.last.x, a.last.z); } else a.st = "roam"; } }
      if (!best && a.heard && a.st === "roam") { a.st = "search"; a.last = { x: a.heard.x, z: a.heard.z }; setPath(e, a.heard.x, a.heard.z); }
    }
    const tgt = a.tgt != null ? G.ents.get(a.tgt) : null; if (tgt && !tgt.alive) { a.tgt = null; a.st = "roam"; }
    let wx = 0, wz = 0, speed = d.speed, faceMove = true;
    if (a.st === "engage" && tgt && tgt.alive) {
      a.seen += dt; faceMove = false; const dx = tgt.x - e.x, dz = tgt.z - e.z, dist = Math.hypot(dx, dz) || 1, nx = dx / dist, nz = dz / dist;
      // aim
      if (a.errT <= 0) { a.errT = R(0.25, 0.5); const sd = d.acc * (1 + dist / 45) * Math.PI / 180; a.err = [(Math.random() + Math.random() + Math.random() - 1.5) * sd * 1.6, (Math.random() + Math.random() + Math.random() - 1.5) * sd * 1.6]; }
      const aimY = tgt.y + (a.headAim ? (tgt.crouch ? 1.0 : 1.55) : (tgt.crouch ? 0.7 : 1.15)), ey = eyeOf(e);
      const yawT = Math.atan2(-dx, -dz) + a.err[0], pitchT = Math.atan2(aimY - ey, dist) + a.err[1];
      turnTo(e, yawT, pitchT, d.turn * (a.seen < d.react ? 0.45 : 1), dt);
      // movement: hold preferred distance, strafe
      const pref = PREF[e.w] || 18; const ideal = pref * (0.8 + 0.4 * a.jitter);
      if (a.strafeT <= 0) { a.strafeT = R(0.5, 1.6); if (Math.random() < 0.6) a.strafe = -a.strafe; }
      const px = -nz * a.strafe, pz = nx * a.strafe; let fwd = 0; if (dist > ideal + 5) fwd = 1; else if (dist < ideal - 5) fwd = -0.8;
      wx = px * 0.75 + nx * fwd; wz = pz * 0.75 + nz * fwd; speed *= 0.8;
      // follow the nav path when we need to close the distance and there is no direct line
      if (fwd > 0 && a.repath > 1.2) { setPath(e, tgt.x, tgt.z); }
      if (fwd > 0 && a.path && a.pi < a.path.length) { const p = a.path[a.pi]; const pdx = p[0] - e.x, pdz = p[1] - e.z, pd = Math.hypot(pdx, pdz) || 1; if (pd < 0.7) a.pi++; else { wx = pdx / pd + px * 0.3; wz = pdz / pd + pz * 0.3; } }
      // fire
      const ang = Math.abs(HP.angDiff(e.yaw, Math.atan2(-dx, -dz))) + Math.abs(e.pitch - Math.atan2(aimY - ey, dist)) * 0.6;
      if (a.reload <= 0 && a.cd <= 0 && a.rest <= 0 && a.seen > d.react && ang < 0.09 + 3 / Math.max(dist, 6) * 0.1 && dist < w.range * 0.6) {
        if (a.ammo <= 0) { a.reload = w.reload * 1.05; HP.audio && 0; }
        else {
          a.ammo--; const interval = 60 / (w.rpm * d.rate) * R(0.9, 1.15); a.cd = interval * (w.auto ? 1 : (e.w === "longshot" ? 1.0 : 1.4)); a.burst++;
          G.botShoot(e, w, d, dist);
          if (w.auto && a.burst >= HP.rndi(3, 9)) { a.burst = 0; a.rest = R(0.25, 0.8) / (d.rate + 0.3); }
          if (!w.auto) a.burst = 0;
          if (a.ammo <= 0) a.rest = 0.2;
        }
      }
      if (a.ammo <= 0 && a.reload <= 0 && a.cd <= 0) a.reload = w.reload * 1.05;
    } else {
      // roam / search: walk the path
      if (a.reload <= 0 && a.ammo < w.mag * 0.4) a.reload = w.reload;
      if (!a.path || a.pi >= a.path.length || a.repath > 12) { if (a.st === "search") { a.st = "roam"; } const g = pickGoal(e, G); setPath(e, g.x, g.z); }
      const p = a.path[a.pi]; const pdx = p[0] - e.x, pdz = p[1] - e.z, pd = Math.hypot(pdx, pdz) || 1;
      if (pd < 0.7) { a.pi++; } else { wx = pdx / pd; wz = pdz / pd; }
      if (a.st === "search") speed *= 1.05;
      // look where we're going (and glance toward alerts)
      if (a.heard && a.alertT > 0) { turnTo(e, Math.atan2(-(a.heard.x - e.x), -(a.heard.z - e.z)), 0, d.turn * 0.7, dt); faceMove = false; }
      else turnTo(e, Math.atan2(-wx, -wz), 0, d.turn * 0.55, dt);
    }
    // separation from other soldiers
    G.ents.forEach(o => { if (o === e || !o.alive) return; const dx = e.x - o.x, dz = e.z - o.z, dd = Math.hypot(dx, dz); if (dd < 1.3 && dd > 0.01) { wx += dx / dd * (1.3 - dd) * 1.6; wz += dz / dd * (1.3 - dd) * 1.6; } });
    const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
    // don't step into blocked cells while strafing
    if (a.st === "engage" && wl > 0.05 && !W.free(e.x + wx * 0.9, e.z + wz * 0.9)) { a.strafe = -a.strafe; a.strafeT = R(0.4, 1); wx = -wx * 0.5; wz = -wz * 0.5; }
    const ac = Math.min(1, dt * 9); e.vx += (wx * speed - e.vx) * ac; e.vz += (wz * speed - e.vz) * ac;
    e.crouch = a.st === "engage" && e.w === "longshot" && Math.random() < 0.002 ? !e.crouch : e.crouch;
    W.move(e, dt, 20); e.speed = Math.hypot(e.vx, e.vz);
    // stuck handling
    a.stuck += dt; if (a.stuck > 1.2) { const m = Math.hypot(e.x - a.lx, e.z - a.lz); if (m < 0.35 && wl > 0.1) { a.path = null; a.goal = null; if (a.st !== "engage") a.pi = 99; else a.strafe = -a.strafe; } a.lx = e.x; a.lz = e.z; a.stuck = 0; }
  };
})();
