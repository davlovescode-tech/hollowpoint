/* ============================================================
   HOLLOWPOINT · ui.js
   DOM side of the game: title, lobby, HUD, scoreboard, kill feed,
   death / end screens and the settings sheet.
   ============================================================ */
"use strict";
(function () {
  const $ = HP.$, clamp = HP.clamp;
  const ui = HP.ui = {};
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SHORT = { arc7: "ARC", viper: "VPR", hammer: "HMR", longshot: "LNG", sidekick: "SDK" };
  let ready = false, inPlayMenu = false;

  /* ---------- loading / ready ---------- */
  ui.setLoad = function (p) { const b = $("play"); if (ready) return; b.querySelector(".txt").textContent = "LOADING " + Math.round(p * 100) + "%"; b.querySelector(".fill").style.width = Math.round(p * 100) + "%"; };
  ui.ready = function () { ready = true; const b = $("play"); b.disabled = false; b.querySelector(".fill").style.width = "0"; b.querySelector(".txt").textContent = "PLAY SOLO"; $("mkRoom").disabled = false; $("joinRoom").disabled = false; };
  ui.prefillCode = function (c) { $("codeIn").value = HP.net.clean(c); ui.msg("Room " + HP.net.clean(c) + " is ready. Enter a name and press Join."); };
  ui.msg = function (t, err) { const m = $("mpMsg"); m.textContent = t || ""; m.className = err ? "err" : ""; };
  ui.screen = function (n) {
    $("title").hidden = n !== "title"; $("lobby").hidden = n !== "lobby";
    if (n !== "title") $("end").hidden = true;
  };
  ui.hud = function (on) { $("hud").hidden = !on; $("touch").hidden = !(on && HP.TOUCH); if (!on) { ui.respawned(); ui.board(false); } };

  /* ---------- settings sheet ---------- */
  function seg(id, key, cb, num) {
    const root = $(id), set = () => { root.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === String(HP.set[key]))); };
    root.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; HP.set[key] = num ? +b.dataset.v : b.dataset.v; set(); cb && cb(); });
    set(); return set;
  }
  function sw(id, key, cb) {
    const b = $(id), set = () => b.setAttribute("aria-checked", HP.set[key] ? "true" : "false");
    b.addEventListener("click", () => { HP.set[key] = !HP.set[key]; set(); cb && cb(); }); set(); return set;
  }
  function rng(id, label, key, scale, fmt, cb) {
    const r = $(id), l = $(label), set = () => { r.value = Math.round(HP.set[key] * scale); l.textContent = fmt(HP.set[key]); };
    r.addEventListener("input", () => { HP.set[key] = r.value / scale; l.textContent = fmt(HP.set[key]); cb && cb(); }); set(); return set;
  }
  const COLS = ["#ffffff", "#7dff7a", "#ffe066", "#4fd8ff", "#ff5c8a", "#ff7a2f"];
  ui.applyCrosshair = function () {
    const x = $("xh"); x.className = "x-" + HP.set.xhair; x.style.setProperty("--xc", HP.set.xcol); document.documentElement.style.setProperty("--xc", HP.set.xcol);
    $("xhCol").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.c === HP.set.xcol));
    const f = $("fpsC"); f.style.display = HP.set.fps ? "block" : "none";
  };
  function openMenu(playing) {
    inPlayMenu = playing; $("menu").hidden = false; $("menuResume").textContent = playing ? "Resume" : "Close"; $("leaveBtn").style.display = playing ? "" : "none";
  }
  ui.pause = function (on) { if (on) { if (HP.G.state === "play" || HP.G.state === "end") openMenu(true); } else { $("menu").hidden = true; } };
  function closeMenu() { if (inPlayMenu && HP.G.state === "play") HP.game.resume(); else $("menu").hidden = true; }

  /* ---------- init ---------- */
  ui.init = function () {
    // title inputs
    const name = $("nameIn"); name.value = HP.set.name || ""; name.addEventListener("input", () => { HP.set.name = name.value; HP.save(); });
    const code = $("codeIn"); code.addEventListener("input", () => { code.value = HP.net.clean(code.value); }); code.addEventListener("keydown", e => { if (e.key === "Enter") $("joinRoom").click(); });
    name.addEventListener("keydown", e => { if (e.key === "Enter" && ready) $("play").click(); });
    $("play").addEventListener("click", () => { if (!ready) return; HP.save(); HP.game.playSolo(); });
    $("mkRoom").addEventListener("click", () => { if (!ready) return; HP.save(); HP.game.hostRoom(); });
    $("joinRoom").addEventListener("click", () => { if (!ready) return; const c = HP.net.clean(code.value); if (c.length !== 5) { ui.msg("Room codes are 5 characters.", true); return; } HP.save(); HP.game.joinRoom(c); });
    const setDiff = seg("diffSeg", "diff", () => { HP.save(); HP.game.setCfg({ diff: HP.set.diff }); });
    const bn = () => { $("botN").textContent = HP.set.bots; $("lbN").textContent = HP.set.bots; };
    $("botM").onclick = () => { HP.set.bots = clamp(HP.set.bots - 1, 0, 7); bn(); HP.save(); }; $("botP").onclick = () => { HP.set.bots = clamp(HP.set.bots + 1, 0, 7); bn(); HP.save(); }; bn();
    // arsenal cards
    const ar = $("arsenal"); ar.innerHTML = HP.WORDER.map(id => { const w = HP.WEAPONS[id]; const dps = w.dmg * w.pellets * Math.min(w.rpm, 900) / 60; return `<div class="w"><b>${esc(w.name)}</b><small>${esc(w.kind)}</small><div class="bar"><i style="width:${clamp(w.dmg * (w.pellets > 1 ? 4 : 1) / 90 * 100, 8, 100)}%"></i></div><em><span>DMG</span></em><div class="bar"><i style="width:${clamp(dps / 400 * 100, 8, 100)}%"></i></div><em><span>DPS</span></em></div>`; }).join("");
    // lobby
    $("lbM").onclick = () => { HP.set.bots = clamp(HP.set.bots - 1, 0, 7); bn(); HP.save(); HP.game.setCfg({ bots: HP.set.bots }); }; $("lbP").onclick = () => { HP.set.bots = clamp(HP.set.bots + 1, 0, 7); bn(); HP.save(); HP.game.setCfg({ bots: HP.set.bots }); };
    const lt = $("lTarget"), setT = () => lt.querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.v === (HP.G.cfg.target || 20)));
    lt.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; HP.G.cfg.target = +b.dataset.v; setT(); }); ui._setT = setT;
    const ld = $("lDiff"), setLD = () => ld.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === HP.set.diff)); ld.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; HP.set.diff = b.dataset.v; setLD(); setDiff(); HP.save(); HP.game.setCfg({ diff: HP.set.diff }); }); ui._setLD = setLD;
    $("startBtn").onclick = () => HP.game.startMatch(); $("lobbyLeave").onclick = () => HP.game.leave();
    $("roomCode").onclick = () => { const url = location.origin + location.pathname + "?room=" + HP.G.code; const done = () => { $("roomHint").textContent = "Invite link copied. Send it to your friends!"; }; try { navigator.clipboard.writeText(url).then(done, () => { $("roomHint").textContent = url; }); } catch (e) { $("roomHint").textContent = url; } };
    // end
    $("againBtn").onclick = () => HP.game.again(); $("endLeave").onclick = () => HP.game.leave();
    // settings
    $("gearT").onclick = () => openMenu(false); $("menuX").onclick = closeMenu; $("menuResume").onclick = closeMenu;
    $("leaveBtn").onclick = () => { $("menu").hidden = true; HP.game.leave(); };
    $("tpause").onclick = () => { openMenu(true); };
    $("menu").addEventListener("mousedown", e => { if (e.target === $("menu")) closeMenu(); });
    document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => { document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b ? "true" : "false")); document.querySelectorAll(".pane").forEach(p => p.classList.toggle("on", p.dataset.pane === b.dataset.tab)); }));
    const ap = () => HP.game.applySettings();
    seg("qSeg", "quality", ap); rng("rngFov", "fovV", "fov", 1, v => Math.round(v), ap); sw("swFx", "fx", ap); sw("swShake", "shake", () => { HP.set.bobs = HP.set.shake; ap(); }); sw("swFps", "fps", ap);
    rng("rngVol", "volV", "vol", 100, v => Math.round(v * 100), ap); rng("rngSens", "sensV", "sens", 100, v => v.toFixed(2), ap); sw("swAds", "adsToggle", ap); seg("xhSeg", "xhair", ap);
    const cc = $("xhCol"); cc.innerHTML = COLS.map(c => `<button data-c="${c}" style="background:${c}" aria-label="Crosshair colour ${c}"></button>`).join(""); cc.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; HP.set.xcol = b.dataset.c; ap(); });
    ui.applyCrosshair();
    // FPS counter
    let n = 0, t0 = performance.now(); (function tick() { n++; const t = performance.now(); if (t - t0 > 500) { if (HP.set.fps) $("fpsC").textContent = Math.round(n * 1000 / (t - t0)) + " FPS · " + (HP.Q.level || "") + " · " + Math.round((HP.Q.scale || 1) * 100) + "%"; n = 0; t0 = t; } requestAnimationFrame(tick); })();
    addEventListener("keydown", e => { if (e.code === "Escape" && !$("menu").hidden && HP.G.state !== "play") $("menu").hidden = true; });
    $("canvasGuard") && 0;
  };

  /* ---------- lobby ---------- */
  ui.lobby = function (d) {
    $("roomCodeT").textContent = d.code || "-----"; $("plist").innerHTML = d.players.map(p => `<span class="${p.me ? "me" : ""} ${p.host ? "host" : ""}">${esc(p.name)}</span>`).join("");
    $("hostCtl").style.display = d.host ? "" : "none"; $("waitMsg").style.display = d.host ? "none" : ""; $("lbN").textContent = d.bots; ui._setT && ui._setT(); ui._setLD && ui._setLD();
    $("roomHint").textContent = d.host ? "Share the code, or tap it to copy an invite link." : "You're in! The host will start the match.";
  };

  /* ---------- HUD ---------- */
  const C = {};
  const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const setT = (id, v) => { if (C[id] !== v) { C[id] = v; $(id).textContent = v; } };
  let slotsBuilt = false;
  ui.hudTick = function (d) {
    if (!slotsBuilt) { $("slots").innerHTML = d.slots.map((s, i) => `<span data-id="${s.id}"><b>${i + 1}</b>${SHORT[s.id]}</span>`).join(""); slotsBuilt = true; }
    setT("hpN", d.hp); if (C.hpp !== d.hp) { C.hpp = d.hp; $("hpBar").style.width = clamp(d.hp, 0, 100) + "%"; $("hp").classList.toggle("low", d.hp <= 35); }
    if (C.prot !== d.prot) { C.prot = d.prot; $("hp").classList.toggle("prot", d.prot); }
    setT("wName", d.wname); setT("wKind", d.wkind); setT("magN", d.mag); if (C.low !== (d.mag <= Math.ceil(d.magMax * 0.25))) { C.low = d.mag <= Math.ceil(d.magMax * 0.25); document.querySelector("#ammo .mag").classList.toggle("low", C.low); }
    if (C.rl !== d.reloading) { C.rl = d.reloading; $("rl").classList.toggle("on", d.reloading); }
    if (C.cur !== d.cur) { C.cur = d.cur; $("slots").querySelectorAll("span").forEach(s => s.classList.toggle("on", s.dataset.id === d.cur)); }
    setT("sYou", d.my); setT("sLead", d.lead ? d.lead.k : 0); setT("sLeadN", d.lead ? d.lead.name.toUpperCase() : "—"); setT("sTarget", d.target); setT("sTime", fmt(d.left));
    const x = $("xh"); const g = clamp(d.spreadPx, 3, 140); if (Math.abs((C.g || 0) - g) > 0.6) { C.g = g; x.style.setProperty("--g", g.toFixed(1) + "px"); }
    const off = d.scope || !d.alive; if (C.xoff !== off) { C.xoff = off; x.classList.toggle("off", off); }
    if (C.scope !== d.scope) { C.scope = d.scope; $("scope").classList.toggle("on", d.scope); }
  };
  ui.hit = function (kind) { const h = $("hitm"); h.classList.remove("show", "head", "kill"); void h.getBoundingClientRect(); h.classList.add(kind === "kill" ? "kill" : kind === "head" ? "head" : "show"); if (kind === "kill") h.classList.add("show"); };
  ui.feed = function (e) {
    const f = $("feed"), d = document.createElement("div");
    if (e.sys) { d.innerHTML = `<span class="sys">${esc(e.sys)}</span>`; }
    else { d.className = e.me ? "me" : e.died ? "died" : ""; const wn = (HP.WEAPONS[e.w] || {}).name || "";
      d.innerHTML = e.suicide ? `${esc(e.v)}<em>was eliminated</em>` : `${esc(e.k)}<em>${esc(wn)}</em>${esc(e.v)}${e.head ? '<span class="hs">HEADSHOT</span>' : ""}`; }
    f.appendChild(d); while (f.children.length > 5) f.removeChild(f.firstChild); setTimeout(() => d.remove(), 5500);
  };
  ui.toast = function (t, cls) { if (!t) return; const c = $("toasts"), d = document.createElement("div"); d.textContent = t; d.className = cls || ""; c.appendChild(d); while (c.children.length > 3) c.removeChild(c.firstChild); setTimeout(() => d.remove(), 1500); };
  ui.dmg = function (rel) { const c = $("dmgdirs"), i = document.createElement("i"); i.style.transform = `rotate(${-rel}rad)`; c.appendChild(i); setTimeout(() => i.remove(), 900); const fx = $("flash"); };
  ui.death = function (d) { const el = $("death"); el.classList.add("on"); $("dBy").textContent = d.by ? "by " + d.by : "You were eliminated"; $("dW").textContent = d.by ? (d.w || "") + (d.head ? " · HEADSHOT" : "") : ""; $("dT").textContent = "3"; $("dRing").style.setProperty("--p", 1); };
  ui.deathTime = function (left) { $("dT").textContent = Math.ceil(left); $("dRing").style.setProperty("--p", clamp(left / 3, 0, 1)); };
  ui.respawned = function () { $("death").classList.remove("on"); };
  ui.board = function (show, rows) {
    const b = $("board"); b.classList.toggle("on", !!show); if (!show) return;
    $("boardB").innerHTML = rows.map(r => `<tr class="${r.me ? "me" : ""} ${r.alive ? "" : "dead"}"><td class="dot"><i></i></td><td>${esc(r.name)}${r.bot ? ' <span style="color:var(--mute);font-size:10px;letter-spacing:.12em">BOT</span>' : ""}</td><td>${r.k}</td><td>${r.d}</td><td>${r.hs}</td></tr>`).join("");
  };
  ui.end = function (d) {
    $("menu").hidden = true; $("death").classList.remove("on"); $("scope").classList.remove("on");
    const win = d.win === d.me; $("endTitle").textContent = win ? "VICTORY" : (d.win == null ? "MATCH OVER" : "DEFEAT"); $("endKick").textContent = win ? "YOU TOP THE BOARD" : "MATCH OVER";
    $("endRows").innerHTML = d.rows.map((r, i) => `<tr class="${r[0] === d.me ? "me" : ""}"><td>${i + 1}</td><td>${esc(r[1])}</td><td class="n">${r[2]}</td><td class="n">${r[3]}</td></tr>`).join("");
    $("againBtn").style.display = d.host ? "" : "none"; $("endWait").style.display = d.host ? "none" : ""; $("end").hidden = false;
  };
  ui.endHide = function () { $("end").hidden = true; };
})();
