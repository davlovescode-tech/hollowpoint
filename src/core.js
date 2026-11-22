/* ============================================================
   HOLLOWPOINT · core.js
   Renderer, golden-hour sky + image-based lighting, sun shadows that follow
   the player, HDR post pipeline (MSAA, bloom, god rays, filmic grade),
   viewmodel layer, procedural-PBR material library.
   three.js r128, no build step.
   ============================================================ */
"use strict";
const T = THREE;
const HP = window.HP = { version: "1.0", Q: {}, S: {}, dbg: {}, ev: {} };
HP.TOUCH = (window.matchMedia && matchMedia("(pointer:coarse)").matches) || "ontouchstart" in window;
if (HP.TOUCH) document.documentElement.classList.add("touch");
const clamp = HP.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = HP.lerp = (a, b, t) => a + (b - a) * t;
HP.rnd = (a, b) => a + Math.random() * (b - a);
HP.rndi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
HP.pick = a => a[Math.floor(Math.random() * a.length)];
HP.mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
HP.angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
HP.$ = id => document.getElementById(id);

/* ---------- settings (persisted) ---------- */
const SKEY = "hollowpoint-set-v1";
HP.set = { quality: "auto", fov: 80, sens: 1.0, vol: 0.8, fx: true, fps: false, xhair: "dot", xcol: "#ffffff", name: "", bobs: true, shake: true, diff: "normal", bots: 5 };
try { Object.assign(HP.set, JSON.parse(localStorage.getItem(SKEY) || "{}")); } catch (e) { }
HP.save = () => { try { localStorage.setItem(SKEY, JSON.stringify(HP.set)); } catch (e) { } };

/* ---------- renderer / scenes ---------- */
const canvas = HP.canvas = document.getElementById("cv");
const renderer = HP.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", stencil: false });
renderer.outputEncoding = T.sRGBEncoding;
renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.autoClear = false;
const scene = HP.scene = new T.Scene();
const camera = HP.camera = new T.PerspectiveCamera(80, innerWidth / innerHeight, 0.06, 1200);
camera.rotation.order = "YXZ";
scene.add(camera);
const vmScene = HP.vmScene = new T.Scene();
const vmCam = HP.vmCam = new T.PerspectiveCamera(56, innerWidth / innerHeight, 0.01, 20);
vmCam.rotation.order = "YXZ";
const vmAnchor = HP.vmAnchor = new T.Object3D(); vmScene.add(vmAnchor);

/* ---------- look ---------- */
// sun: low and warm. sunDir points FROM the ground TOWARDS the sun.
const SUN_ELEV = 21 * Math.PI / 180, SUN_AZ = 200 * Math.PI / 180;
const sunDir = HP.sunDir = new T.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_ELEV), Math.sin(SUN_ELEV), Math.cos(SUN_AZ) * Math.cos(SUN_ELEV)).normalize();
const SUN_COL = new T.Color(1.0, 0.74, 0.46);
const FOG_COL = new T.Color(0.80, 0.52, 0.33);
scene.fog = new T.FogExp2(FOG_COL, 0.0062);
HP.look = { ex: 1.0, sat: 1.05, vig: 0.38, bloom: 0.42, rays: 0.55 };

const sun = HP.sun = new T.DirectionalLight(SUN_COL, 3.1);
sun.castShadow = true; sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.045; sun.shadow.radius = 2.2;
scene.add(sun); scene.add(sun.target);
const SHADOW_HALF = { low: 30, med: 38, high: 44 };
HP.shadowHalf = 38; HP.shadowRes = 2048;

const vmSun = HP.vmSun = new T.DirectionalLight(SUN_COL, 3.1); vmSun.position.copy(sunDir).multiplyScalar(10); vmScene.add(vmSun); vmScene.add(vmSun.target);
const vmFill = new T.HemisphereLight(0x9bb3e0, 0x8a6a48, 0.25); vmScene.add(vmFill);

/* ---------- sky dome (also bakes the image-based lighting) ---------- */
const SKY_VS = `varying vec3 vD; void main(){ vD=position; vec4 p=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*p; gl_Position.z=gl_Position.w*0.99999; }`;
const SKY_FS = `
varying vec3 vD; uniform vec3 sunDir; uniform vec3 fogCol; uniform float time; uniform float expo;
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+vec2(17.1,9.3); a*=.5; } return s; }
void main(){
  vec3 d=normalize(vD); float y=d.y;
  float s=max(dot(d,sunDir),0.);
  vec3 zen=vec3(.055,.13,.34), mid=vec3(.34,.40,.58), hor=fogCol*1.18;
  vec3 c=mix(hor, mid, smoothstep(0.0,.18,y));
  c=mix(c, zen, smoothstep(.12,.85,y));
  // warm wash around the sun
  c+=vec3(1.0,.50,.18)*pow(s,5.)*.85 + vec3(1.0,.66,.32)*pow(s,24.)*1.2 + vec3(1.0,.82,.55)*pow(s,180.)*3.;
  // sun disc (HDR)
  c+=vec3(1.0,.9,.72)*smoothstep(.99955,.99985,s)*38.;
  // clouds: thin high stratus lit from below by the low sun
  if(y>0.0){
    vec2 cp=d.xz/(y+.16)*.9 + vec2(time*.004,time*.0015);
    float n=fbm(cp*1.3), n2=fbm(cp*3.1+4.7);
    float dens=smoothstep(.46,.78,n*.78+n2*.28)*smoothstep(.0,.16,y);
    float lit=pow(s,2.2)*.9+.18;
    vec3 cc=mix(vec3(.30,.24,.30), vec3(1.25,.62,.30), clamp(lit,0.,1.)) * (.65+.7*n2);
    cc+=vec3(1.0,.55,.25)*pow(s,10.)*1.2;
    c=mix(c, cc, dens*.78);
  } else {
    c=mix(hor*.92, vec3(.30,.20,.14), clamp(-y*6.,0.,1.));
  }
  gl_FragColor=vec4(c*expo,1.);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;
function makeSkyMat() {
  return new T.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: T.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { sunDir: { value: sunDir }, fogCol: { value: FOG_COL }, time: { value: 0 }, expo: { value: 1 } } });
}
const skyMat = makeSkyMat();
const sky = HP.sky = new T.Mesh(new T.SphereGeometry(1, 40, 24), skyMat);
sky.scale.setScalar(900); sky.frustumCulled = false; sky.renderOrder = -1000; scene.add(sky);

HP.bakeEnv = function () {
  const es = new T.Scene(); const m = makeSkyMat(); const e = new T.Mesh(new T.SphereGeometry(1, 32, 16), m); e.scale.setScalar(50); es.add(e);
  const pm = new T.PMREMGenerator(renderer); const rt = pm.fromScene(es, 0, 0.1, 200); pm.dispose();
  scene.environment = rt.texture; vmScene.environment = rt.texture; HP.envTex = rt.texture; es.remove(e); e.geometry.dispose(); m.dispose();
};

/* ---------- shadows follow the player (texel-snapped, no shimmer) ---------- */
const _r = new T.Vector3(), _u = new T.Vector3(), _p = new T.Vector3(), UP = new T.Vector3(0, 1, 0);
HP.updateSun = function (px, py, pz) {
  const L = sunDir; _r.crossVectors(UP, L).normalize(); _u.crossVectors(L, _r).normalize();
  const tex = HP.shadowHalf * 2 / HP.shadowRes;
  _p.set(px, py, pz);
  const a = Math.round(_p.dot(_r) / tex) * tex, b = Math.round(_p.dot(_u) / tex) * tex, c = _p.dot(L);
  _p.copy(_r).multiplyScalar(a).addScaledVector(_u, b).addScaledVector(L, c);
  sun.target.position.copy(_p); sun.position.copy(_p).addScaledVector(L, 140); sun.target.updateMatrixWorld();
};
function applyShadowRes(n, half) {
  HP.shadowRes = n; HP.shadowHalf = half;
  const s = sun.shadow; const c = s.camera; c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 1; c.far = 320; c.updateProjectionMatrix();
  if (s.mapSize.x !== n) { if (s.map) { s.map.dispose(); s.map = null; } s.mapSize.set(n, n); }
}

/* ---------- procedural-PBR materials ---------- */
const texLoader = new T.TextureLoader();
HP.TEX = {}; HP.MAT = {};
const TEX_DEF = {   // key: [file, tile size in metres, tint, envMapIntensity, normalScale, grime]
  sand: ["sand", 7, 0xe6d6bd, 0.7, 0.8, 0],
  asphalt: ["asphalt", 5, 0xffffff, 0.8, 0.7, 0],
  concrete: ["concrete", 3.2, 0xffffff, 0.75, 1.0, 1],
  brick: ["brick", 1.6, 0xffffff, 0.8, 1.0, 1],
  plasterSand: ["plaster_sand", 3, 0xffffff, 0.8, 1.0, 1],
  plasterTerra: ["plaster_terra", 3, 0xffffff, 0.8, 1.0, 1],
  plasterBone: ["plaster_bone", 3, 0xffffff, 0.8, 1.0, 1],
  wood: ["wood", 1.2, 0xffffff, 0.8, 1.0, 1],
  rust: ["rust", 2.2, 0xffffff, 1.0, 1.0, 1],
  fabric: ["fabric", 0.9, 0xffffff, 0.8, 1.0, 1],
  corrRed: ["corr_red", 2.4, 0xffffff, 1.0, 1.0, 1],
  corrBlue: ["corr_blue", 2.4, 0xffffff, 1.0, 1.0, 1],
  corrGreen: ["corr_green", 2.4, 0xffffff, 1.0, 1.0, 1],
  corrSand: ["corr_sand", 2.4, 0xffffff, 1.0, 1.0, 1],
};
HP.maxAniso = 8;

/* world-space mottling (kills tiling repeats) + ground-contact grime on walls */
function patchMat(m, grime) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWP=(modelMatrix*vec4(transformed,1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vWP;
float hh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y);}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
float mot=vn(vWP.xz*.21+vWP.y*.33)*.55+vn(vWP.xz*.83+vWP.y*1.3)*.45;
diffuseColor.rgb*=.80+.40*mot;
${grime ? "diffuseColor.rgb*=mix(.46,1.,smoothstep(0.,1.7,vWP.y)); diffuseColor.rgb*=mix(.82,1.,smoothstep(3.0,5.5,vWP.y)+.0);" : ""}`);
  };
  m.customProgramCacheKey = () => "hp-world-" + (grime ? 1 : 0);
}
HP.loadTextures = function (onProg) {
  const files = []; Object.keys(TEX_DEF).forEach(k => { const f = TEX_DEF[k][0]; if (!files.includes(f)) files.push(f); });
  let total = files.length * 3, done = 0;
  const load = (url, srgb) => new Promise(res => texLoader.load(url, t => {
    t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = HP.maxAniso; if (srgb) t.encoding = T.sRGBEncoding; done++; onProg && onProg(done / total); res(t);
  }, undefined, () => { done++; onProg && onProg(done / total); res(null); }));
  return Promise.all(files.map(f => Promise.all([load("assets/tex/" + f + ".jpg", true), load("assets/tex/" + f + "_n.jpg", false), load("assets/tex/" + f + "_rm.jpg", false)]).then(r => { HP.TEX[f] = { map: r[0], normalMap: r[1], rm: r[2] }; })))
    .then(() => {
      Object.keys(TEX_DEF).forEach(k => {
        const d = TEX_DEF[k], t = HP.TEX[d[0]];
        const m = new T.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.rm, metalnessMap: t.rm, roughness: 1, metalness: 1, color: d[2], envMapIntensity: d[3], vertexColors: true });
        m.normalScale.set(d[4], d[4]); m.userData.tile = d[1]; patchMat(m, d[5]); HP.MAT[k] = m;
      });
      const plain = (k, color, r, mt, env, vc) => { const m = new T.MeshStandardMaterial({ color, roughness: r, metalness: mt, envMapIntensity: env == null ? 0.9 : env, vertexColors: vc !== false }); m.userData.tile = 2; patchMat(m, 1); HP.MAT[k] = m; };
      plain("rubber", 0x1a1a1a, 0.92, 0.0); plain("steelDark", 0x30343a, 0.45, 0.85, 1.1); plain("steelLight", 0x9aa0a6, 0.4, 0.9, 1.1);
      plain("glass", 0x16222b, 0.08, 0.9, 1.4); plain("paintOlive", 0x4b5438, 0.55, 0.35); plain("paintBlack", 0x16181a, 0.5, 0.4); plain("cloth", 0xb9a47a, 0.95, 0); plain("clothRed", 0x9c2f24, 0.95, 0); plain("clothBlue", 0x2c4f7a, 0.95, 0);
      { const m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0, vertexColors: true, side: T.DoubleSide, envMapIntensity: 0.9 }); m.userData.tile = 2; HP.MAT.frond = m; }
      plain("bulb", 0xffe0a8, 0.4, 0, 1); HP.MAT.bulb.emissive = new T.Color(1.0, 0.72, 0.36); HP.MAT.bulb.emissiveIntensity = 3.2;
      HP.applyAniso();
    });
};
HP.applyAniso = function () { Object.keys(HP.TEX).forEach(k => { const t = HP.TEX[k]; [t.map, t.normalMap, t.rm].forEach(x => { if (x) { x.anisotropy = HP.maxAniso; x.needsUpdate = true; } }); }); };

/* ---------- post-processing ---------- */
const GRADE = {
  uniforms: { tDiffuse: { value: null }, ex: { value: 1 }, vig: { value: .4 }, sat: { value: 1.05 }, time: { value: 0 }, grain: { value: .03 }, ca: { value: .00022 }, dmg: { value: 0 }, low: { value: 0 }, flash: { value: 0 }, aspect: { value: 1 } },
  vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
  fragmentShader: `uniform sampler2D tDiffuse;uniform float ex,vig,sat,time,grain,ca,dmg,low,flash,aspect;varying vec2 vUv;
    vec3 RRT(vec3 v){ vec3 a=v*(v+0.0245786)-0.000090537; vec3 b=v*(0.983729*v+0.4329510)+0.238081; return a/b; }
    vec3 aces(vec3 c){ const mat3 I=mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777)); const mat3 O=mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602)); c*=ex/0.6; c=I*c; c=RRT(c); c=O*c; return clamp(c,0.0,1.0); }
    vec3 enc(vec3 c){ return mix(c*12.92,1.055*pow(c,vec3(0.41666))-0.055,step(vec3(0.0031308),c)); }
    float h21(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 d=vUv-0.5; float r2=dot(d,d);
      vec3 c; c.r=texture2D(tDiffuse,vUv+d*ca*r2*40.0).r; c.g=texture2D(tDiffuse,vUv).g; c.b=texture2D(tDiffuse,vUv-d*ca*r2*40.0).b;
      c=aces(c);
      float l=dot(c,vec3(0.2126,0.7152,0.0722));
      // split-tone: warm highlights, cool teal shadows
      c=mix(c, c*vec3(1.06,1.0,0.90), smoothstep(.35,.95,l)); c=mix(c, c*vec3(.92,1.0,1.08), (1.-smoothstep(.0,.35,l))*.8);
      c=mix(vec3(l),c,sat*(1.0-low*.55));
      c=enc(c);
      c=mix(c,c*c*(3.0-2.0*c),0.30);
      c*=1.0-vig*smoothstep(0.16,0.62,r2*1.9);
      c+=(h21(vUv*vec2(1731.0,977.0)+time)-0.5)*grain;
      // damage: blood-red edge pulse
      float e=smoothstep(.08,.55,r2*1.7);
      c=mix(c, vec3(.62,.03,.02), dmg*e*.85 + low*e*.22);
      c+=vec3(1.0,.8,.5)*flash*.10*(1.-r2*2.);
      gl_FragColor=vec4(c,1.0);
    }`
};
const RAYS = {
  uniforms: { tDiffuse: { value: null }, sun: { value: new T.Vector2(.5, .5) }, k: { value: 0 }, tint: { value: new T.Vector3(1, .72, .42) } },
  vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
  fragmentShader: `uniform sampler2D tDiffuse;uniform vec2 sun;uniform float k;uniform vec3 tint;varying vec2 vUv;
    void main(){
      vec3 c=texture2D(tDiffuse,vUv).rgb;
      if(k>0.001){
        vec2 d=(sun-vUv)/36.0*0.95; vec2 uv=vUv; float w=1.0; float acc=0.0;
        for(int i=0;i<36;i++){ uv+=d; vec3 s=texture2D(tDiffuse,uv).rgb; float l=max(max(s.r,s.g),s.b); acc+=smoothstep(1.4,5.0,l)*w; w*=.965; }
        c+=tint*acc/36.0*k;
      }
      gl_FragColor=vec4(c,1.0);
    }`
};
let composer = null, bloomPass = null, gradePass = null, raysPass = null, postOK = true, vmPass = null;
class ViewmodelPass extends T.Pass {
  constructor() { super(); this.needsSwap = false; }
  render(r, w, rb) { if (!HP.vmVisible) return; r.setRenderTarget(rb); r.autoClear = false; r.clearDepth(); r.render(vmScene, vmCam); }
}
function makeComposer() {
  const gl2 = renderer.capabilities.isWebGL2, ex = renderer.extensions;
  if (!gl2 || !(ex.has("EXT_color_buffer_float") || ex.has("EXT_color_buffer_half_float"))) return null;
  try {
    const sz = renderer.getDrawingBufferSize(new T.Vector2()); const w = Math.max(2, sz.x), h = Math.max(2, sz.y);
    const opt = { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat, type: T.HalfFloatType };
    const ms = gl2 && HP.Q.msaa > 0 && T.WebGLMultisampleRenderTarget;
    const rt = ms ? new T.WebGLMultisampleRenderTarget(w, h, opt) : new T.WebGLRenderTarget(w, h, opt);
    if (ms) rt.samples = HP.Q.msaa;
    const c = new T.EffectComposer(renderer, rt);
    const rp = new T.RenderPass(scene, camera); rp.clearColor = new T.Color(0x000000); rp.clearAlpha = 1; c.addPass(rp);
    vmPass = new ViewmodelPass(); c.addPass(vmPass);
    bloomPass = new T.UnrealBloomPass(new T.Vector2(w, h), 0.4, 0.55, 1.1); c.addPass(bloomPass);
    raysPass = new T.ShaderPass(RAYS); c.addPass(raysPass);
    gradePass = new T.ShaderPass(GRADE); c.addPass(gradePass);
    return c;
  } catch (e) { console.warn("post-processing unavailable", e); return null; }
}
HP.vmVisible = true;
HP.resize = function () {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(HP.Q.pr * (HP.Q.scale || 1)); renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); vmCam.aspect = camera.aspect; vmCam.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(HP.Q.pr * (HP.Q.scale || 1)); composer.setSize(w, h); if (gradePass) gradePass.uniforms.aspect.value = w / h; }
};
HP.setFov = function (f) { camera.fov = f; camera.updateProjectionMatrix(); };
HP.setPost = function (on) {
  on = !!on && postOK && typeof T.EffectComposer === "function";
  if (composer && (!on || HP._msaaBuilt !== HP.Q.msaa)) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; }
  if (on && !composer) { composer = makeComposer(); HP._msaaBuilt = HP.Q.msaa; if (!composer) { postOK = false; on = false; } }
  HP.Q.post = on && !!composer;
  renderer.toneMapping = HP.Q.post ? T.NoToneMapping : T.ACESFilmicToneMapping;
  scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
  vmScene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
  skyMat.uniforms.expo.value = HP.Q.post ? 1 : 0.62;   // sky is HDR; scale it for the tone-mapped fallback path
  HP.resize(); HP.applyLook();
};
HP.applyLook = function () {
  const L = HP.look; renderer.toneMappingExposure = L.ex;
  if (!gradePass) return; const u = gradePass.uniforms;
  u.ex.value = L.ex; u.sat.value = L.sat; u.vig.value = L.vig; bloomPass.strength = L.bloom * (HP.Q.bloomScale || 1);
  u.grain.value = HP.set.fx ? .016 : 0; u.ca.value = HP.set.fx ? .00022 : 0;
  raysPass.uniforms.k.value = HP.Q.rays ? L.rays : 0;
};

/* ---------- quality ---------- */
const QP = {
  low: { pr: Math.min(devicePixelRatio || 1, 1), shadow: 1024, half: 30, msaa: 0, post: HP.TOUCH ? false : true, rays: 0, bloomScale: .6, aniso: 2, dust: 0.3 },
  med: { pr: Math.min(devicePixelRatio || 1, 1.25), shadow: 2048, half: 38, msaa: 2, post: true, rays: 0.7, bloomScale: 1, aniso: 4, dust: 0.7 },
  high: { pr: Math.min(devicePixelRatio || 1, 1.75), shadow: 4096, half: 44, msaa: 4, post: true, rays: 1, bloomScale: 1, aniso: 16, dust: 1 },
};
HP.setQuality = function (name, silent) {
  HP.qName = name; let k = name === "auto" ? (HP.autoLevel || (HP.TOUCH ? "low" : "high")) : name; if (!QP[k]) k = "med";
  const p = QP[k]; HP.Q.level = k;
  HP.Q.pr = p.pr; HP.Q.msaa = p.msaa; HP.Q.rays = p.rays; HP.Q.bloomScale = p.bloomScale; HP.Q.dust = p.dust; HP.Q.scale = HP.Q.scale || 1;
  HP.maxAniso = Math.min(p.aniso, renderer.capabilities.getMaxAnisotropy()); HP.applyAniso();
  applyShadowRes(p.shadow, p.half);
  HP.setPost(p.post);
  if (!silent && HP.ev.quality) HP.ev.quality(k);
};
/* adaptive resolution: keeps the frame rate smooth by nudging render scale */
let _acc = 0, _n = 0, _t0 = 0, _lowCnt = 0;
HP.adapt = function (dt) {
  _acc += dt; _n++; if (_acc < 1.5) return;
  const fps = _n / _acc; _acc = 0; _n = 0; HP.fps = fps;
  if (HP.qName !== "auto" && !HP.set.adaptive) return;
  if (fps < 38 && HP.Q.scale > 0.62) { HP.Q.scale = Math.max(0.6, HP.Q.scale - 0.12); HP.resize(); _lowCnt++; }
  else if (fps > 58 && HP.Q.scale < 1) { HP.Q.scale = Math.min(1, HP.Q.scale + 0.06); HP.resize(); }
  if (HP.qName === "auto" && _lowCnt >= 3 && HP.Q.level !== "low") { HP.autoLevel = HP.Q.level === "high" ? "med" : "low"; _lowCnt = 0; HP.Q.scale = 1; HP.setQuality("auto"); }
};

/* ---------- render ---------- */
const _v = new T.Vector3();
HP.render = function (t) {
  sky.position.copy(camera.position); skyMat.uniforms.time.value = t || 0;
  // viewmodel follows the camera rotation so reflections/lighting stay world-consistent
  vmCam.quaternion.copy(camera.quaternion); vmAnchor.quaternion.copy(camera.quaternion); vmAnchor.position.set(0, 0, 0); vmCam.position.set(0, 0, 0);
  vmSun.position.copy(sunDir).multiplyScalar(10);
  if (HP.Q.post && composer) {
    gradePass.uniforms.time.value = (t || 0) % 97;
    _v.copy(sunDir).multiplyScalar(500).add(camera.position).project(camera);
    const vis = _v.z < 1 && _v.z > -1 ? 1 : 0;
    raysPass.uniforms.sun.value.set(_v.x * .5 + .5, _v.y * .5 + .5);
    const edge = 1 - clamp((Math.max(Math.abs(_v.x), Math.abs(_v.y)) - 1) * .8, 0, 1);
    raysPass.uniforms.k.value = HP.Q.rays ? HP.look.rays * vis * edge : 0;
    composer.render();
  } else {
    renderer.setRenderTarget(null); renderer.autoClear = false; renderer.clear(true, true, true);
    renderer.render(scene, camera);
    if (HP.vmVisible) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
  }
};
/* hit/damage screen effects (driven by game) */
HP.postFx = function (o) { if (!gradePass) return; const u = gradePass.uniforms; if ("dmg" in o) u.dmg.value = o.dmg; if ("low" in o) u.low.value = o.low; if ("flash" in o) u.flash.value = o.flash; };

HP.initRenderer = function () {
  HP.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const q = new URLSearchParams(location.search);
  if (q.get("q")) HP.set.quality = q.get("q");
  HP.setQuality(HP.set.quality, true);
  if (q.get("post") === "0") HP.setPost(false);
  HP.bakeEnv();
};
addEventListener("resize", () => HP.resize());
