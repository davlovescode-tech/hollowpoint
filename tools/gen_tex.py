#!/usr/bin/env python3
"""Procedural, tileable PBR texture generator for HOLLOWPOINT (numpy + Pillow only).
Every texture is generated from scratch -> original, no licence baggage.
Outputs albedo (sRGB jpg), normal (jpg, GL convention) and rm (G=roughness, B=metalness) per material."""
import numpy as np, sys, os
from PIL import Image, ImageFilter
OUT = sys.argv[1] if len(sys.argv) > 1 else "../assets/tex"
os.makedirs(OUT, exist_ok=True)

def fnoise(n, beta=2.0, seed=0, kx=0.0, ky=0.0):
    """Periodic fractal noise, ~N(0,1). kx/ky stretch features along x / y."""
    r = np.random.default_rng(seed)
    fy = np.fft.fftfreq(n)[:, None]; fx = np.fft.rfftfreq(n)[None, :]
    f = np.sqrt(fx ** 2 + fy ** 2); f[0, 0] = 1
    amp = 1.0 / f ** (beta / 2.0)
    if kx or ky: amp = amp * np.exp(-(fx * kx) ** 2 - (fy * ky) ** 2)
    amp[0, 0] = 0
    spec = amp * np.exp(1j * r.uniform(0, 2 * np.pi, (n, n // 2 + 1)))
    a = np.fft.irfft2(spec, s=(n, n))
    return (a - a.mean()) / (a.std() + 1e-9)

def n01(a, lo=1, hi=99):
    l, h = np.percentile(a, [lo, hi]); return np.clip((a - l) / (h - l + 1e-9), 0, 1)

def sstep(a, e0, e1):
    t = np.clip((a - e0) / (e1 - e0 + 1e-9), 0, 1); return t * t * (3 - 2 * t)

def blur(a, r):
    if r <= 0: return a
    n = a.shape[0]; fy = np.fft.fftfreq(n)[:, None]; fx = np.fft.rfftfreq(n)[None, :]
    g = np.exp(-(fx ** 2 + fy ** 2) * (r * 2 * np.pi) ** 2 / 2)
    return np.fft.irfft2(np.fft.rfft2(a) * g, s=a.shape)

def normal_map(h, s):
    h = blur(h, 0.9); s = s * 0.45   # smooth + gentler: fine noise must not turn into pixel-scale speckle
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * s
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * s
    nv = np.stack([-dx, dy, np.ones_like(h)], -1)
    nv /= np.linalg.norm(nv, axis=-1, keepdims=True)
    return nv * 0.5 + 0.5

def rgb(c): return np.array(c, dtype=np.float64) / 255.0

def save(name, alb, nrm, rough, metal, q=90):
    def img(a): return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    if alb is not None: img(alb).save(f"{OUT}/{name}.jpg", quality=q, subsampling=0)
    if nrm is not None: img(nrm).save(f"{OUT}/{name}_n.jpg", quality=74, subsampling=0)
    if rough is not None:
        rm = np.stack([np.zeros_like(rough), rough, metal], -1); img(rm).save(f"{OUT}/{name}_rm.jpg", quality=q)
    print("wrote", name, flush=True)

def lerp3(a, b, t): return a[None, None, :] * (1 - t[..., None]) + b[None, None, :] * t[..., None]

# ---------------------------------------------------------------- sand
def sand(n=1024):
    macro = fnoise(n, 2.6, 1); mid = fnoise(n, 2.0, 2); grain = fnoise(n, 0.4, 3)
    y, x = np.mgrid[0:n, 0:n] / n
    warp = fnoise(n, 3.0, 4) * 0.02
    rip = np.sin(2 * np.pi * (x * 5 + y * 2.0 + warp * 8)) * 0.5 + 0.5      # wind ripples (periodic: integer cycles)
    rip = rip ** 1.6 * (0.45 + 0.55 * sstep(n01(macro), .35, .7))
    peb = sstep(fnoise(n, 0.15, 5), 2.1, 2.9)                                 # pebbles / specks
    h = 0.5 * n01(mid) + 0.28 * rip + 0.1 * n01(grain) + 0.25 * blur(peb, 1.2)
    base = lerp3(rgb((206, 168, 118)), rgb((168, 130, 90)), n01(macro) * .85 + .15 * n01(mid))
    base = base * (0.9 + 0.2 * n01(grain))[..., None] * (0.86 + 0.22 * rip)[..., None]
    base = base * (1 - 0.35 * peb[..., None]) + rgb((120, 100, 80)) * 0.35 * peb[..., None]
    return base, normal_map(h, n * 0.045), np.full((n, n), .96) - .06 * rip, np.zeros((n, n))

# ---------------------------------------------------------------- asphalt
def asphalt(n=1024):
    agg = fnoise(n, 0.3, 11); mid = fnoise(n, 1.6, 12); macro = fnoise(n, 2.8, 13)
    r = np.abs(fnoise(n, 2.4, 14)); crack = sstep(0.07 - r * 0.07 / 0.18, 0.0, 0.07) * sstep(n01(macro), 0.3, 0.7)
    crack = (r < 0.045).astype(np.float64) * sstep(n01(fnoise(n, 3.0, 15)), .45, .75)
    crack = blur(crack, 0.8)
    stain = sstep(n01(fnoise(n, 3.2, 16)), .55, .95)
    spec = sstep(agg, 1.2, 2.6)
    h = 0.5 * n01(agg) + 0.25 * n01(mid) - 0.55 * crack
    v = 0.20 + 0.06 * n01(mid) + 0.04 * n01(macro)
    v = v * (1 - 0.35 * stain) * (1 - 0.7 * crack) + 0.20 * spec
    base = np.stack([v * 1.0, v * 1.0, v * 1.04], -1) * 1.15
    rough = 0.82 - 0.18 * stain - 0.15 * spec + 0.1 * crack
    return base, normal_map(h, n * 0.08), rough, np.zeros((n, n))

# ---------------------------------------------------------------- concrete (with panel seams)
def concrete(n=512, seams=2):
    macro = fnoise(n, 2.8, 21); mid = fnoise(n, 1.8, 22); fine = fnoise(n, 0.5, 23)
    pores = sstep(fnoise(n, 0.2, 24), 2.0, 2.7)
    streak = n01(fnoise(n, 2.6, 25, kx=0, ky=60))     # long vertical rain streaks
    y, x = np.mgrid[0:n, 0:n]
    s = n // seams
    dx = np.minimum(x % s, s - 1 - x % s); dy = np.minimum(y % s, s - 1 - y % s)
    seam = np.maximum(sstep(3 - dx, 0, 3), sstep(3 - dy, 0, 3)) * 0.0 + (np.minimum(dx, dy) < 2).astype(np.float64)
    seam = blur(seam, 0.9)
    holes = np.zeros((n, n))
    for i in range(seams):
        for j in range(seams):
            for hx, hy in ((0.2, 0.2), (0.8, 0.2), (0.2, 0.8), (0.8, 0.8)):
                cx, cy = int((i + hx) * s), int((j + hy) * s)
                holes += np.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / 14.0))
    h = 0.45 * n01(mid) + 0.15 * n01(fine) - 0.5 * pores - 0.7 * seam - 0.5 * holes
    v = 0.56 + 0.07 * n01(macro) + 0.05 * n01(fine) - 0.1 * streak * n01(macro)
    v = v * (1 - 0.4 * pores) * (1 - 0.3 * seam) * (1 - 0.35 * np.clip(holes, 0, 1))
    base = np.stack([v * 1.02, v, v * 0.95], -1)
    return base, normal_map(h, n * 0.05), 0.9 - 0.08 * n01(mid), np.zeros((n, n))

# ---------------------------------------------------------------- brick (also used as peel-through for plaster)
def brick_layers(n, cols=5, rows=16, seed=30):
    r = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n]
    bh = n // rows; bw = n // cols
    row = y // bh
    xo = (x + (row % 2) * (bw // 2)) % n
    col = xo // bw
    fx = xo % bw; fy = y % bh
    mortar = 3
    inb = ((fx >= mortar) & (fy >= mortar)).astype(np.float64)
    inb = blur(inb, 0.8)
    tint = r.uniform(0, 1, (rows, cols + 1))
    t = tint[row, col]
    return inb, t, fx, fy

def brick(n=512):
    inb, t, fx, fy = brick_layers(n)
    fine = fnoise(n, 1.0, 31); mid = fnoise(n, 2.2, 32); soot = n01(fnoise(n, 2.8, 33))
    cA, cB = rgb((158, 84, 62)), rgb((118, 62, 48))
    bc = cA[None, None, :] * (1 - t[..., None]) + cB[None, None, :] * t[..., None]
    bc = bc * (0.88 + 0.2 * n01(fine))[..., None] * (0.9 + 0.2 * n01(mid))[..., None]
    mc = rgb((176, 168, 152)) * (0.85 + 0.2 * n01(fine))[..., None]
    base = bc * inb[..., None] + mc * (1 - inb[..., None])
    base *= (1 - 0.3 * sstep(soot, .6, 1))[..., None]
    h = inb * (0.7 + 0.2 * n01(fine) + 0.1 * n01(mid)) + (1 - inb) * 0.2
    return base, normal_map(h, n * 0.06), 0.9 - 0.15 * inb * n01(fine), np.zeros((n, n))

# ---------------------------------------------------------------- plaster colourways (peeling to brick)
def plaster(col, n=512, seed=40, peel_amt=0.55):
    macro = fnoise(n, 2.8, seed); mid = fnoise(n, 2.0, seed + 1); fine = fnoise(n, 0.7, seed + 2)
    streak = n01(fnoise(n, 2.4, seed + 3, kx=0, ky=70))
    stain = sstep(n01(fnoise(n, 3.0, seed + 4)), .5, .95)
    peel = sstep(n01(fnoise(n, 3.4, seed + 5)), 1 - peel_amt * .42, 1 - peel_amt * .42 + .04)
    peel *= sstep(n01(fnoise(n, 2.2, seed + 6)), .25, .6)
    edge = blur(peel, 2) - blur(peel, 0.8)
    inb, t, fx, fy = brick_layers(n, 5, 16, seed)
    bcol = lerp3(rgb((166, 90, 66)), rgb((126, 70, 52)), t) * (0.9 + 0.2 * n01(fine))[..., None]
    bcol = bcol * inb[..., None] + rgb((170, 160, 145)) * (1 - inb[..., None])
    p = rgb(col)[None, None, :] * (0.88 + 0.16 * n01(macro) + 0.05 * n01(fine))[..., None]
    p = p * (1 - 0.22 * streak * n01(mid))[..., None] * (1 - 0.18 * stain)[..., None]
    base = p * (1 - peel[..., None]) + bcol * peel[..., None]
    base *= (1 - 0.4 * np.clip(-edge * 3, 0, 1))[..., None]
    h = 0.5 * n01(mid) + 0.2 * n01(fine) - 0.55 * peel + 0.3 * peel * inb
    rough = 0.92 - 0.05 * n01(fine) - 0.1 * peel
    return base, normal_map(h, n * 0.05), rough, np.zeros((n, n))

# ---------------------------------------------------------------- wood planks
def wood(n=512, planks=6, vertical=False):
    h0 = fnoise(n, 2.0, 50, kx=0, ky=0)
    grain = fnoise(n, 1.4, 51, kx=60, ky=0)      # stretched along x
    ring = fnoise(n, 2.6, 52, kx=35, ky=0)
    fine = fnoise(n, 0.6, 53, kx=20, ky=0)
    y, x = np.mgrid[0:n, 0:n]
    ph = n // planks
    pid = y // ph; fy = y % ph
    r = np.random.default_rng(54)
    tone = r.uniform(0, 1, planks + 1)[pid]
    shift = r.uniform(0, 1, planks + 1)[pid]
    g = np.sin((n01(grain) * 9 + n01(ring) * 5) * np.pi * 2) * 0.5 + 0.5
    gap = ((fy < 2) | (fy > ph - 3)).astype(np.float64); gap = blur(gap, 0.8)
    nail = np.zeros((n, n))
    for i in range(planks):
        for cx in (int(n * .12), int(n * .88)):
            cy = i * ph + ph // 2
            nail += np.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / 6.0))
    c0, c1 = rgb((150, 112, 72)), rgb((106, 76, 50))
    base = lerp3(c0, c1, np.clip(tone * 0.55 + 0.55 * g, 0, 1))
    base *= (0.9 + 0.2 * n01(fine))[..., None]
    base *= (1 - 0.6 * gap)[..., None]
    base = base * (1 - 0.4 * np.clip(nail, 0, 1))[..., None]
    h = 0.7 * g + 0.12 * n01(fine) - 0.7 * gap - 0.3 * nail
    h = h if not vertical else h
    img = base
    nrm = normal_map(blur(h, 0.7), n * 0.03)
    rough = 0.72 + 0.15 * n01(fine) + 0.1 * gap
    if vertical:
        img = img.transpose(1, 0, 2).copy(); nrm = nrm.transpose(1, 0, 2).copy()
        nrm[..., [0, 1]] = nrm[..., [1, 0]]; rough = rough.T.copy()
    return img, nrm, rough, np.zeros((n, n))

# ---------------------------------------------------------------- corrugated metal (container / roof) + colourways
def corrugated(col, n=512, ribs=24, seed=60, rust_amt=0.45):
    y, x = np.mgrid[0:n, 0:n] / n
    prof = np.sin(2 * np.pi * x * ribs)
    h = 0.5 + 0.5 * prof
    macro = fnoise(n, 2.8, seed); fine = fnoise(n, 0.8, seed + 1); scr = fnoise(n, 1.2, seed + 2, kx=0, ky=45)
    rust = sstep(n01(fnoise(n, 3.0, seed + 3)) * 0.75 + 0.25 * n01(fnoise(n, 1.0, seed + 4)), 1 - rust_amt, 1 - rust_amt + .25)
    rust *= (0.5 + 0.5 * (1 - sstep(np.abs(prof), 0, 1) * 0))   # rust sits more on ridges
    rust = rust * (0.6 + 0.4 * (prof * .5 + .5))
    streak = n01(fnoise(n, 2.4, seed + 5, kx=0, ky=70))
    paint = rgb(col)[None, None, :] * (0.88 + 0.18 * n01(macro) + 0.06 * n01(fine))[..., None]
    paint = paint * (1 - 0.25 * streak * n01(macro))[..., None]
    rc = lerp3(rgb((128, 66, 36)), rgb((88, 46, 28)), n01(fnoise(n, 1.5, seed + 6)))
    base = paint * (1 - rust[..., None]) + rc * rust[..., None]
    scratch = sstep(scr, 2.0, 3.0) * 0.4
    base = base * (1 - 0.25 * (prof * -.5 + .5))[..., None] * 1.0 + scratch[..., None] * 0.15
    h = h * 0.9 + 0.1 * n01(fine) + 0.15 * rust
    rough = 0.5 + 0.35 * rust + 0.1 * n01(fine)
    metal = 0.75 * (1 - rust)
    return base, normal_map(h, n * 0.035), rough, metal

# ---------------------------------------------------------------- rust / worn painted steel
def rust(n=512, base_col=(96, 92, 86), seed=70, amt=0.5):
    macro = fnoise(n, 2.8, seed); fine = fnoise(n, 0.7, seed + 1); scr = fnoise(n, 1.2, seed + 2, kx=45, ky=0)
    r = sstep(n01(fnoise(n, 2.6, seed + 3)) * 0.7 + 0.3 * n01(fine), 1 - amt, 1 - amt + .3)
    rc = lerp3(rgb((140, 72, 38)), rgb((84, 44, 28)), n01(fnoise(n, 1.4, seed + 4)))
    p = rgb(base_col)[None, None, :] * (0.9 + 0.2 * n01(macro))[..., None]
    base = p * (1 - r[..., None]) + rc * r[..., None]
    base += (sstep(scr, 2.0, 3.0) * 0.12)[..., None]
    h = 0.45 * n01(fine) + 0.3 * r + 0.25 * n01(macro)
    return base, normal_map(h, n * 0.05), 0.55 + 0.35 * r, 0.7 * (1 - r)

# ---------------------------------------------------------------- burlap / sandbag fabric
def fabric(n=512, col=(150, 134, 98), seed=80):
    y, x = np.mgrid[0:n, 0:n]
    wv = (np.sin(x * 2 * np.pi / (n / 48)) * np.sin(y * 2 * np.pi / (n / 48))) * 0.5 + 0.5
    fine = fnoise(n, 1.0, seed); macro = fnoise(n, 2.5, seed + 1)
    dirt = n01(fnoise(n, 2.8, seed + 2))
    base = rgb(col)[None, None, :] * (0.82 + 0.25 * wv + 0.12 * n01(fine))[..., None] * (0.85 + 0.25 * n01(macro))[..., None]
    base *= (1 - 0.3 * sstep(dirt, .6, 1))[..., None]
    h = wv * 0.6 + 0.4 * n01(fine)
    return base, normal_map(h, n * 0.07), np.full((n, n), 0.97), np.zeros((n, n))

if __name__ == "__main__":
    jobs = {
        "sand": lambda: sand(1024), "asphalt": lambda: asphalt(1024),
        "concrete": lambda: concrete(512), "brick": lambda: brick(512),
        "plaster_sand": lambda: plaster((214, 184, 140), seed=40),
        "plaster_terra": lambda: plaster((196, 122, 88), seed=44, peel_amt=0.5),
        "plaster_bone": lambda: plaster((226, 218, 200), seed=48, peel_amt=0.4),
        "wood": lambda: wood(512), "rust": lambda: rust(512), "fabric": lambda: fabric(512),
        "corr_red": lambda: corrugated((150, 52, 42), seed=60),
        "corr_blue": lambda: corrugated((46, 82, 128), seed=64),
        "corr_green": lambda: corrugated((64, 98, 66), seed=68),
        "corr_sand": lambda: corrugated((188, 160, 112), seed=72, rust_amt=0.5),
    }
    only = sys.argv[2:] or list(jobs)
    for k in only:
        a, nm, ro, me = jobs[k]()
        save(k, a, nm, ro, me)
