# HOLLOWPOINT

**A Daviccino production** · [@lowkeytuffdav](https://instagram.com/lowkeytuffdav)

A free, instant-play browser FPS with a realistic tactical look: golden-hour desert compound, real-time sun shadows, image-based reflections, PBR materials, volumetric god-rays, filmic colour grade. No download, no account, no build step.

- **Team Deathmatch:** ALPHA vs BRAVO, first team to 40 kills or the highest score at 7:00. Bots fill the smaller team, no friendly fire, team-aware spawns.
- **Play solo** vs AI bots right away, three difficulties (default 8 players: you + 7 bots).
- **Play with friends**: create a room, share the 5-letter code, up to 6 humans + bots (peer-to-peer over WebRTC, the host runs the match). Teams, scores and streaks sync to everyone.
- **Loadouts:** pick a primary (ARC-7 rifle, VIPER-9 SMG, HAMMER-12 shotgun, LONGSHOT-50 sniper) plus the SIDEKICK .45, and a perk: **Juggernaut** (130 HP), **Fast Hands** (faster reloads) or **Ghost** (invisible to radar and UAV).
- **Scorestreaks:** 3-kill streak earns a **UAV** (28 s full-team radar), 6-kill streak an **Airstrike** (7 blasts on an enemy position). Streaks repeat every 3 kills.
- **Radar:** rotating minimap; teammates always shown, enemies when they fire or under UAV.
- **Movement:** sprint, **slide** (sprint then crouch), jump, crouch, ADS slow-down, health regen after 3 s out of combat.
- **Feedback:** hit markers, headshot / kill popups, kill feed, damage direction indicators, team scoreboard and victory / defeat screen.
- **Map:** KILN YARD, a walled brick-kiln compound with a market, container yard, garage block, watchtower and rooftop routes.
- Desktop (mouse + keyboard) and phones/tablets (touch controls, landscape, separate touch sensitivity).

## Controls

| | |
|---|---|
| Move | `W A S D` · Sprint `Shift` · Crouch `C` / `Ctrl` · Jump `Space` |
| Slide | Sprint, then crouch |
| Shoot / Aim | Left mouse / Right mouse (hold, or toggle in settings) |
| Reload | `R` |
| Weapons | `1`-`2`, mouse wheel, `Q` swap |
| Use scorestreak | `G` (phone: the streak button) |
| Scoreboard | `Tab` (hold) |
| Pause / settings | `Esc` (sensitivity, touch sensitivity, quality, volume) |

## Run locally

It is plain static files. Any static server works:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy

Import the repo into Vercel (or any static host: Netlify, GitHub Pages, Cloudflare Pages). No build command, output directory is the repo root.

## Graphics

Quality presets **Low / Medium / High / Auto** (Auto adapts resolution but never drops below 85% of native, so the image stays sharp). Every preset renders at the screen's native pixel ratio and adds a sharpening pass, anisotropic filtering and a fine near-field detail layer on surfaces. High turns on 4096 shadow maps, HDR bloom, god-rays and the full grade. Phones default to a lighter path.

- Procedural sky shader baked to a PMREM environment map; the same sun drives lighting, fog and shadows.
- Texel-snapped cascaded-style shadow frustum that follows the player (no shimmer).
- Procedurally generated PBR texture sets (albedo / normal / roughness-metal) built by `tools/gen_tex.py` from periodic FFT noise, so surfaces tile without seams.
- World-space triplanar UVs, mottling and ground-contact grime injected with `onBeforeCompile`.
- HDR post chain: bloom, radial god-rays, ACES tone mapping, split-toning, vignette, grain, chromatic aberration, damage/low-health edge.
- Separate viewmodel pass so the gun never clips into walls.
- All audio (gunshots, footsteps, reloads, wind, hit markers) is synthesised with Web Audio, so there are no audio files.

Regenerate textures (needs Python 3 + NumPy + Pillow):

```bash
cd tools && python3 gen_tex.py ../assets/tex
```

## Rooms and networking

Rooms use [PeerJS](https://peerjs.com) (loaded from a CDN on demand) with its free public signalling server. Most home networks connect with the Google STUN servers in `config.js`. Strict mobile / corporate networks need a TURN relay: add one to `config.js` and rooms will connect everywhere.

The host is authoritative for damage, kills, respawns and the match clock. Guests send their pose at 20 Hz and shot hit-claims, which the host validates (rate limit, range, pellet caps).

## Code layout

```
index.html, style.css, config.js
src/core.js     renderer, sky, shadows, post chain, materials, settings
src/map.js      KILN YARD geometry, colliders, nav grid, spawns
src/game.js     player controller, team deathmatch, loadouts, scorestreaks, radar, host/guest sync
src/bots.js     AI (A* navigation, line-of-sight, difficulty tuning)
src/weapons.js  weapon stats + procedural first-person models and animation
src/chars.js    soldier rig, tinting, IK, third-person guns
src/fx.js       tracers, impacts, decals, shells, muzzle flash
src/audio.js    synthesised audio
src/net.js      PeerJS rooms
src/ui.js       menus, HUD, scoreboard, settings
tools/gen_tex.py  texture generator
```

## Credits

- three.js r128 (MIT), plus the GLTFLoader / SkeletonUtils / BufferGeometryUtils / post-processing examples bundled in `lib/`.
- `Soldier.glb`: the "Soldier" character from the three.js examples, originally from [Mixamo](https://www.mixamo.com) (Adobe). Mixamo content is free to use in projects but cannot be redistributed as a standalone asset; swap in your own character before any commercial release.
- Inter font (SIL OFL), see `assets/fonts/LICENSE-Inter.txt`.
- Textures, map, weapons and audio are original and generated by code.
- HOLLOWPOINT is an original game. It is inspired by the quick-match browser shooter genre and uses none of any other game's assets, names or maps.
