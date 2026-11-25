/* ============================================================
   HOLLOWPOINT · chars.js
   Third-person soldiers: skinned model + locomotion blend + analytic two-bone
   arm IK so every soldier actually shoulders and aims their weapon.
   ============================================================ */
"use strict";
(function () {
  const T = THREE, clamp = HP.clamp;
  const C = HP.chars = { ready: false, proto: null, clips: {}, scale: 1, tp: {} };
  const TINTS = [0x37639e, 0xb34a2a, 0x6f7a5a, 0xb59a6e, 0x5d7186, 0x45484d, 0x4e6b4a, 0x6a6475];   // [0] ALPHA blue, [1] BRAVO orange
  C.TINTS = TINTS;

  C.load = function (onProg) {
    return new Promise(res => {
      new T.GLTFLoader().load("assets/models/Soldier.glb", g => {
        C.proto = g.scene; g.animations.forEach(a => C.clips[a.name] = a);
        const box = new T.Box3().setFromObject(C.proto); const hgt = box.max.y - box.min.y; C.scale = 1.8 / (hgt || 1.8);
        C.ready = true; res(true);
      }, e => { if (e && e.total && onProg) onProg(e.loaded / e.total); }, err => { console.warn("soldier model failed", err); res(false); });
    });
  };
  /* third-person weapon prototypes (shared geometry, cloned per soldier) */
  C.tpGun = function (id) {
    if (!C.tp[id]) { const g = HP.vm.models[id].tp.clone(true); g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } }); C.tp[id] = g; }
    return C.tp[id].clone(true);
  };

  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _q = new T.Quaternion(), _q2 = new T.Quaternion();
  function pointBone(bone, child, target) {             // rotate `bone` so that the direction bone→child points at `target`
    bone.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false);
    bone.getWorldPosition(_a); child.getWorldPosition(_b); const cur = _b.sub(_a).normalize(), want = _c.copy(target).sub(_a).normalize();
    _q.setFromUnitVectors(cur, want); bone.getWorldQuaternion(_q2); _q2.premultiply(_q);
    if (bone.parent) { const pq = new T.Quaternion(); bone.parent.getWorldQuaternion(pq); _q2.premultiply(pq.invert()); }
    bone.quaternion.copy(_q2); bone.updateWorldMatrix(false, true);
  }
  const S = new T.Vector3(), H = new T.Vector3(), E = new T.Vector3(), dir = new T.Vector3(), pole = new T.Vector3(), tmp = new T.Vector3();
  function twoBone(arm, fore, hand, handPos, poleDir) {
    arm.updateWorldMatrix(true, false); arm.getWorldPosition(S); fore.updateWorldMatrix(true, false); fore.getWorldPosition(E); hand.updateWorldMatrix(true, false); hand.getWorldPosition(H);
    const a = S.distanceTo(E), b = E.distanceTo(H); dir.copy(handPos).sub(S); let d = dir.length(); dir.multiplyScalar(1 / (d || 1)); d = clamp(d, 0.05, a + b - 0.002);
    const along = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - along * along));
    pole.copy(poleDir).addScaledVector(dir, -poleDir.dot(dir)).normalize(); const elbow = tmp.copy(S).addScaledVector(dir, along).addScaledVector(pole, h);
    const hp = new T.Vector3().copy(S).addScaledVector(dir, d);
    pointBone(arm, fore, elbow); pointBone(fore, hand, hp);
  }

  /* ---------- soldier instance ---------- */
  C.make = function (tintIdx, weaponId) {
    const root = new T.Group(), model = T.SkeletonUtils.clone(C.proto); model.scale.setScalar(C.scale); root.add(model);
    const s = { root, model, tint: TINTS[tintIdx % TINTS.length], bones: {}, w: null, walkT: 0 };
    model.traverse(o => {
      if (o.isBone) s.bones[o.name.replace(/^mixamorig\d*:?/, "")] = o;
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; const ms = (Array.isArray(o.material) ? o.material : [o.material]).map(m => { const c = m.clone(); c.envMapIntensity = 1.2; if (/Body/i.test(c.name)) { c.color.setHex(s.tint); c.roughness = 0.7; c.metalness = 0.1; } else c.envMapIntensity = 2; return c; }); o.material = Array.isArray(o.material) ? ms : ms[0]; }
    });
    s.mixer = new T.AnimationMixer(model); s.act = {};
    ["Idle", "Walk", "Run"].forEach(n => { if (C.clips[n]) { const a = s.mixer.clipAction(C.clips[n]); a.play(); a.setEffectiveWeight(n === "Idle" ? 1 : 0); s.act[n] = a; } });
    s.gunHolder = new T.Group(); root.add(s.gunHolder); s.setWeapon = id => { if (s.w === id) return; if (s.gun) s.gunHolder.remove(s.gun); s.w = id; s.gun = C.tpGun(id); s.gunHolder.add(s.gun); s.muz = s.gun.getObjectByName("muzzle") || null; };
    s.setWeapon(weaponId || "arc7");
    // nameplate
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 48; s.npCv = cv; const tx = new T.CanvasTexture(cv); tx.anisotropy = 4;
    s.np = new T.Sprite(new T.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, fog: false })); s.np.scale.set(1.3, 0.24, 1); s.np.position.y = 2.15; s.np.renderOrder = 12; root.add(s.np); s.npName = "";
    s.setName = (n, col) => { const key = n + "|" + (col || ""); if (s.npName === key) return; s.npName = key; const g = cv.getContext("2d"); g.clearRect(0, 0, 256, 48); g.font = "700 28px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,0.65)"; g.strokeText(n, 128, 25); g.fillStyle = col || "#f4ead6"; g.fillText(n, 128, 25); tx.needsUpdate = true; };
    s.dead = false; s.deadT = 0;
    return s;
  };
  const f = new T.Vector3(), r = new T.Vector3(), u = new T.Vector3(), D = new T.Vector3(), up = new T.Vector3(0, 1, 0), RH = new T.Vector3(), LH = new T.Vector3(), CC = new T.Vector3(), P1 = new T.Vector3(), P2 = new T.Vector3();
  /* e: entity {x,y,z,yaw,pitch,speed,crouch,alive,w,recoil}. */
  C.update = function (s, e, dt) {
    const root = s.root; root.position.set(e.x, e.y, e.z);
    if (!e.alive) {                                   // fall over backwards, then stay down
      if (!s.dead) { s.dead = true; s.deadT = 0; s.fallDir = Math.random() < 0.5 ? 1 : -1; }
      s.deadT += dt; const k = clamp(s.deadT / 0.55, 0, 1), ease = 1 - Math.pow(1 - k, 3);
      root.rotation.set(-ease * (Math.PI / 2 - 0.1), e.yaw + Math.PI, ease * 0.25 * s.fallDir, "YXZ"); root.position.y = e.y + ease * 0.12; root.scale.set(1, 1, 1);
      s.np.visible = false; s.gunHolder.visible = s.deadT < 0.6; if (s.deadT < 0.6) { s.gunHolder.position.set(0, 1.0, 0.2); s.gunHolder.rotation.set(0, e.yaw + Math.PI, 0); }
      s.mixer.update(dt * 0.0); return;
    }
    if (s.dead) { s.dead = false; s.gunHolder.visible = true; root.rotation.set(0, 0, 0); }
    root.rotation.set(0, e.yaw + Math.PI, 0); const cs = e.crouch ? 0.8 : 1; root.scale.set(1, cs, 1);
    const sp = e.speed || 0; const idle = sp < 0.4 ? 1 : 0, runW = clamp((sp - 2.2) / 1.8, 0, 1), walkW = sp < 0.4 ? 0 : 1 - runW;
    const A = s.act; if (A.Idle) A.Idle.setEffectiveWeight(idle * 0.999 + 0.001); if (A.Walk) { A.Walk.setEffectiveWeight(walkW * (1 - idle)); A.Walk.timeScale = clamp(sp / 1.7, 0.4, 1.6); } if (A.Run) { A.Run.setEffectiveWeight(runW); A.Run.timeScale = clamp(sp / 4.4, 0.6, 1.5); }
    s.mixer.update(dt);
    // arm IK: both hands on the weapon, aimed along (yaw,pitch)
    root.updateMatrixWorld(true);
    const b = s.bones; if (!b.RightArm || !b.LeftArm) return;
    const cy = Math.cos(e.pitch), sy = Math.sin(e.pitch); f.set(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)); D.set(f.x * cy, sy, f.z * cy).normalize();
    r.crossVectors(D, up).normalize(); u.crossVectors(r, D).normalize();
    const hs = cs * (e.crouch ? 0.92 : 1); CC.set(e.x, e.y + 1.34 * hs, e.z);
    const kick = (e.recoil || 0) * 0.05;
    P1.copy(CC).addScaledVector(D, 0.30 - kick).addScaledVector(r, 0.11).addScaledVector(u, -0.2); RH.copy(P1);
    P2.copy(CC).addScaledVector(D, 0.62 - kick).addScaledVector(r, -0.035).addScaledVector(u, -0.16); LH.copy(P2);
    twoBone(b.RightArm, b.RightForeArm, b.RightHand, RH, new T.Vector3().copy(r).multiplyScalar(0.8).addScaledVector(u, -1));
    twoBone(b.LeftArm, b.LeftForeArm, b.LeftHand, LH, new T.Vector3().copy(r).multiplyScalar(-0.8).addScaledVector(u, -1));
    // weapon sits between the hands
    s.gunHolder.position.copy(CC).addScaledVector(D, 0.45 - kick).addScaledVector(r, 0.075).addScaledVector(u, -0.17).sub(root.position).applyAxisAngle(up, -(e.yaw + Math.PI)).multiplyScalar(1 / cs * 0 + 1);
    s.gunHolder.position.y /= cs; s.gunHolder.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(r.clone().negate().negate(), u, D.clone().negate()));
    s.gunHolder.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(up, -(e.yaw + Math.PI))); s.gunHolder.scale.set(1, 1 / cs, 1);
    // head looks along the aim
    if (b.Head && e.pitch) { b.Neck && (b.Neck.rotation.x += 0); }
    s.np.visible = !!e.npShow;
  };
  C.dispose = function (s) { s.root.parent && s.root.parent.remove(s.root); };
})();
