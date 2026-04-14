/**
 * GRAIN.js — Comprehensive grain/noise engine
 * Film grain, digital noise, procedural noise, texture, blending modes
 */
const GrainEngine = (() => {

  // ── Seeded PRNG ──
  function mkRand(seed) {
    let s = seed | 0 || 1;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  // ── Noise Generators ──
  // Each returns Float32Array of values centered around 0 (range depends on type)

  function gaussianNoise(n, rng) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 2) {
      const u1 = Math.max(1e-10, rng()), u2 = rng();
      const r = Math.sqrt(-2 * Math.log(u1));
      out[i] = r * Math.cos(2 * Math.PI * u2);
      if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
    }
    return out;
  }

  function uniformNoise(n, rng) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
    return out;
  }

  function saltPepperNoise(n, rng, density) {
    const out = new Float32Array(n);
    const d = (density || 50) / 100;
    for (let i = 0; i < n; i++) {
      if (rng() < d) out[i] = rng() < 0.5 ? -1 : 1;
    }
    return out;
  }

  function poissonNoise(n, rng, pixels) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const lam = Math.max(1, (pixels ? pixels[i] : 128) / 32);
      let L = Math.exp(-lam), k = 0, p = 1;
      do { k++; p *= rng(); } while (p > L && k < 50);
      out[i] = (k - 1 - lam) / Math.max(1, Math.sqrt(lam));
    }
    return out;
  }

  function speckleNoise(n, rng) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (rng() * 2 - 1) * rng();
    return out;
  }

  function laplacianNoise(n, rng) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = rng() - 0.5;
      out[i] = -Math.sign(u) * Math.log(1 - 2 * Math.abs(u) + 1e-10);
    }
    return out;
  }

  // ── Perlin Noise ──
  const permutation = new Uint8Array(512);
  let permInited = false;
  function initPerm(seed) {
    const rng = mkRand(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) permutation[i] = p[i & 255];
    permInited = true;
  }

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }

  function grad2d(hash, x, y) {
    const h = hash & 3;
    return (h & 1 ? -x : x) + (h & 2 ? -y : y);
  }

  function perlin2d(x, y) {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = permutation[permutation[xi] + yi];
    const ab = permutation[permutation[xi] + yi + 1];
    const ba = permutation[permutation[xi + 1] + yi];
    const bb = permutation[permutation[xi + 1] + yi + 1];
    return lerp(
      lerp(grad2d(aa, xf, yf), grad2d(ba, xf - 1, yf), u),
      lerp(grad2d(ab, xf, yf - 1), grad2d(bb, xf - 1, yf - 1), u),
      v
    );
  }

  function perlinNoise(w, h, scale, seed) {
    initPerm(seed);
    const n = w * h, out = new Float32Array(n);
    const s = Math.max(0.01, scale);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        out[y * w + x] = perlin2d(x / (s * 20), y / (s * 20));
    return out;
  }

  function fbmNoise(w, h, scale, seed, octaves, lacunarity, gain) {
    initPerm(seed);
    const n = w * h, out = new Float32Array(n);
    const s = Math.max(0.01, scale);
    const oct = octaves || 6;
    const lac = lacunarity || 2.0;
    const g = gain || 0.5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let val = 0, amp = 1, freq = 1, maxAmp = 0;
        for (let o = 0; o < oct; o++) {
          val += perlin2d(x * freq / (s * 20), y * freq / (s * 20)) * amp;
          maxAmp += amp;
          amp *= g;
          freq *= lac;
        }
        out[y * w + x] = val / maxAmp;
      }
    }
    return out;
  }

  function turbulenceNoise(w, h, scale, seed) {
    initPerm(seed);
    const n = w * h, out = new Float32Array(n);
    const s = Math.max(0.01, scale);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let val = 0, amp = 1, freq = 1;
        for (let o = 0; o < 6; o++) {
          val += Math.abs(perlin2d(x * freq / (s * 20), y * freq / (s * 20))) * amp;
          amp *= 0.5;
          freq *= 2;
        }
        out[y * w + x] = val - 0.5;
      }
    }
    return out;
  }

  function ridgedNoise(w, h, scale, seed) {
    initPerm(seed);
    const n = w * h, out = new Float32Array(n);
    const s = Math.max(0.01, scale);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let val = 0, amp = 1, freq = 1, prev = 1;
        for (let o = 0; o < 6; o++) {
          let n2 = perlin2d(x * freq / (s * 20), y * freq / (s * 20));
          n2 = 1 - Math.abs(n2);
          n2 *= n2 * prev;
          prev = n2;
          val += n2 * amp;
          amp *= 0.5;
          freq *= 2;
        }
        out[y * w + x] = val - 0.7;
      }
    }
    return out;
  }

  // ── Simplex 2D ──
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const grad3 = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

  function simplex2d(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { t0 *= t0; const g = grad3[permutation[ii + permutation[jj]] & 7]; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { t1 *= t1; const g = grad3[permutation[ii + i1 + permutation[jj + j1]] & 7]; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { t2 *= t2; const g = grad3[permutation[ii + 1 + permutation[jj + 1]] & 7]; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * (n0 + n1 + n2);
  }

  function simplexNoise(w, h, scale, seed) {
    initPerm(seed);
    const n = w * h, out = new Float32Array(n);
    const s = Math.max(0.01, scale);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        out[y * w + x] = simplex2d(x / (s * 20), y / (s * 20));
    return out;
  }

  // ── Worley (Cellular) Noise ──
  function worleyNoise(w, h, scale, seed) {
    const rng = mkRand(seed);
    const s = Math.max(0.5, scale) * 15;
    const gw = Math.ceil(w / s) + 2, gh = Math.ceil(h / s) + 2;
    const pts = [];
    for (let gy = -1; gy < gh; gy++)
      for (let gx = -1; gx < gw; gx++)
        pts.push({ x: (gx + rng()) * s, y: (gy + rng()) * s });
    const n = w * h, out = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let min1 = Infinity;
        const gx0 = Math.floor(x / s), gy0 = Math.floor(y / s);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const idx = (gy0 + dy + 1) * gw + (gx0 + dx + 1);
            if (idx >= 0 && idx < pts.length) {
              const d = (x - pts[idx].x) ** 2 + (y - pts[idx].y) ** 2;
              if (d < min1) min1 = d;
            }
          }
        }
        out[y * w + x] = Math.sqrt(min1) / s - 0.5;
      }
    }
    return out;
  }

  function voronoiCrackNoise(w, h, scale, seed) {
    const rng = mkRand(seed);
    const s = Math.max(0.5, scale) * 15;
    const gw = Math.ceil(w / s) + 2, gh = Math.ceil(h / s) + 2;
    const pts = [];
    for (let gy = -1; gy < gh; gy++)
      for (let gx = -1; gx < gw; gx++)
        pts.push({ x: (gx + rng()) * s, y: (gy + rng()) * s });
    const n = w * h, out = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let min1 = Infinity, min2 = Infinity;
        const gx0 = Math.floor(x / s), gy0 = Math.floor(y / s);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const idx = (gy0 + dy + 1) * gw + (gx0 + dx + 1);
            if (idx >= 0 && idx < pts.length) {
              const d = (x - pts[idx].x) ** 2 + (y - pts[idx].y) ** 2;
              if (d < min1) { min2 = min1; min1 = d; }
              else if (d < min2) min2 = d;
            }
          }
        }
        out[y * w + x] = (Math.sqrt(min2) - Math.sqrt(min1)) / s - 0.3;
      }
    }
    return out;
  }

  // ── Film Grain Profiles ──
  // Each profile defines roughness, variance, clumping, and size characteristics
  const FILM_PROFILES = {
    'fine-film':    { roughness: 0.3, variance: 0.4, clump: 0.1, sizeMul: 0.7 },
    'medium-film':  { roughness: 0.5, variance: 0.6, clump: 0.3, sizeMul: 1.0 },
    'coarse-film':  { roughness: 0.8, variance: 0.8, clump: 0.5, sizeMul: 1.5 },
    'tri-x':        { roughness: 0.65, variance: 0.7, clump: 0.4, sizeMul: 1.2 },
    'hp5':          { roughness: 0.55, variance: 0.65, clump: 0.35, sizeMul: 1.1 },
    'tmax':         { roughness: 0.85, variance: 0.9, clump: 0.6, sizeMul: 1.8 },
    'portra':       { roughness: 0.25, variance: 0.35, clump: 0.15, sizeMul: 0.8 },
    'cinestill':    { roughness: 0.6, variance: 0.75, clump: 0.45, sizeMul: 1.3 },
    'delta3200':    { roughness: 0.9, variance: 0.95, clump: 0.65, sizeMul: 2.0 },
    'ektar':        { roughness: 0.15, variance: 0.2, clump: 0.05, sizeMul: 0.5 },
    'iso-low':      { roughness: 0.15, variance: 0.2, clump: 0.05, sizeMul: 0.6 },
    'iso-mid':      { roughness: 0.5, variance: 0.6, clump: 0.3, sizeMul: 1.1 },
    'iso-high':     { roughness: 0.75, variance: 0.8, clump: 0.5, sizeMul: 1.6 },
    'iso-extreme':  { roughness: 0.95, variance: 1.0, clump: 0.7, sizeMul: 2.2 },
  };

  // ── Texture Generators ──
  function paperTexture(w, h, scale, seed) {
    const base = fbmNoise(w, h, scale * 2, seed, 8, 2.2, 0.45);
    const detail = gaussianNoise(w * h, mkRand(seed + 1));
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = base[i] * 0.7 + detail[i] * 0.15;
    return out;
  }

  function canvasTexture(w, h, scale, seed) {
    const out = new Float32Array(w * h);
    const s = Math.max(1, scale * 3);
    const rng = mkRand(seed);
    const warp = new Float32Array(w * h);
    for (let i = 0; i < warp.length; i++) warp[i] = rng() * 0.3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const weftPhase = Math.sin((x / s) * Math.PI * 2 + warp[i]);
        const warpPhase = Math.sin((y / s) * Math.PI * 2 + warp[i] * 1.3);
        out[i] = (weftPhase * 0.4 + warpPhase * 0.4 + (rng() - 0.5) * 0.2);
      }
    }
    return out;
  }

  function linenTexture(w, h, scale, seed) {
    const out = new Float32Array(w * h);
    const s = Math.max(1, scale * 4);
    const rng = mkRand(seed);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t1 = Math.sin((x / s + rng() * 0.1) * Math.PI);
        const t2 = Math.sin((y / s + rng() * 0.1) * Math.PI * 0.7);
        out[y * w + x] = (t1 + t2) * 0.35 + (rng() - 0.5) * 0.1;
      }
    }
    return out;
  }

  function concreteTexture(w, h, scale, seed) {
    const base = fbmNoise(w, h, scale * 3, seed, 7, 2.0, 0.55);
    const spots = worleyNoise(w, h, scale * 2, seed + 1);
    const detail = gaussianNoise(w * h, mkRand(seed + 2));
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = base[i] * 0.5 + spots[i] * 0.3 + detail[i] * 0.1;
    return out;
  }

  function sandstoneTexture(w, h, scale, seed) {
    const base = turbulenceNoise(w, h, scale * 2.5, seed);
    const layers = perlinNoise(w, h, scale * 0.5, seed + 1);
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = base[i] * 0.6 + Math.sin(layers[i] * 8) * 0.25;
    return out;
  }

  function brushstrokeTexture(w, h, scale, seed) {
    initPerm(seed);
    const out = new Float32Array(w * h);
    const s = Math.max(1, scale * 6);
    const rng = mkRand(seed);
    const angle = rng() * Math.PI;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const rx = x * ca + y * sa;
        const ry = -x * sa + y * ca;
        const streak = Math.sin(rx / s * Math.PI * 3) * 0.4;
        const vary = perlin2d(rx / (s * 8), ry / (s * 3)) * 0.4;
        out[y * w + x] = streak + vary;
      }
    }
    return out;
  }

  // ── Main Grain Generation ──
  function generateGrain(w, h, opts) {
    const type = opts.type || 'gaussian';
    const amount = (opts.amount || 30) / 100;
    const size = opts.size || 1;
    const roughness = (opts.roughness || 50) / 100;
    const variance = (opts.variance || 50) / 100;
    const softness = (opts.softness || 0) / 100;
    const seed = opts.seed || 42;
    const rng = mkRand(seed);
    const n = w * h;

    let raw;
    const profile = FILM_PROFILES[type];

    if (profile) {
      // Film grain: combine gaussian base with clumping noise
      const effSize = size * profile.sizeMul;
      const base = gaussianNoise(n, mkRand(seed));
      const clump = perlinNoise(w, h, effSize * 2, seed + 7);
      raw = new Float32Array(n);
      const r2 = roughness * profile.roughness;
      const v2 = variance * profile.variance;
      const c2 = profile.clump;
      for (let i = 0; i < n; i++) {
        const g = base[i] * (1 - c2) + clump[i] * c2;
        raw[i] = g * (0.5 + v2 * 0.5) * (1 + r2 * Math.abs(base[i]));
      }
    } else {
      switch (type) {
        case 'gaussian': raw = gaussianNoise(n, rng); break;
        case 'uniform': raw = uniformNoise(n, rng); break;
        case 'salt-pepper': raw = saltPepperNoise(n, rng, roughness * 100); break;
        case 'poisson': raw = poissonNoise(n, rng); break;
        case 'speckle': raw = speckleNoise(n, rng); break;
        case 'laplacian': raw = laplacianNoise(n, rng); break;
        case 'perlin': raw = perlinNoise(w, h, size, seed); break;
        case 'simplex': raw = simplexNoise(w, h, size, seed); break;
        case 'worley': raw = worleyNoise(w, h, size, seed); break;
        case 'fbm': raw = fbmNoise(w, h, size, seed, 6, 2 + roughness, 0.3 + variance * 0.4); break;
        case 'turbulence': raw = turbulenceNoise(w, h, size, seed); break;
        case 'ridged': raw = ridgedNoise(w, h, size, seed); break;
        case 'voronoi-crack': raw = voronoiCrackNoise(w, h, size, seed); break;
        case 'paper': raw = paperTexture(w, h, size, seed); break;
        case 'canvas-tex': raw = canvasTexture(w, h, size, seed); break;
        case 'linen': raw = linenTexture(w, h, size, seed); break;
        case 'concrete': raw = concreteTexture(w, h, size, seed); break;
        case 'sandstone': raw = sandstoneTexture(w, h, size, seed); break;
        case 'brushstroke': raw = brushstrokeTexture(w, h, size, seed); break;
        case 'chromatic': raw = gaussianNoise(n, rng); break;
        case 'luminance-noise': raw = gaussianNoise(n, rng); break;
        default: raw = gaussianNoise(n, rng);
      }
    }

    // Apply size > 1 by block-averaging (pixelate the grain)
    if (size > 1.5 && !profile && !['perlin','simplex','worley','fbm','turbulence','ridged',
        'voronoi-crack','paper','canvas-tex','linen','concrete','sandstone','brushstroke'].includes(type)) {
      const bs = Math.round(size);
      const scaled = new Float32Array(n);
      for (let by = 0; by < h; by += bs) {
        for (let bx = 0; bx < w; bx += bs) {
          const val = raw[by * w + bx];
          for (let dy = 0; dy < bs && by + dy < h; dy++)
            for (let dx = 0; dx < bs && bx + dx < w; dx++)
              scaled[(by + dy) * w + (bx + dx)] = val;
        }
      }
      raw = scaled;
    }

    // Apply roughness modulation for non-film types
    if (!profile && roughness > 0) {
      for (let i = 0; i < n; i++) raw[i] *= (0.5 + roughness * Math.abs(raw[i]));
    }

    // Apply softness (box blur the grain)
    if (softness > 0) {
      const rad = Math.max(1, Math.round(softness * 5));
      raw = boxBlur(raw, w, h, rad);
    }

    // Scale to amount
    const scale = amount * 255;
    for (let i = 0; i < n; i++) raw[i] *= scale;

    return raw;
  }

  // ── Box Blur ──
  function boxBlur(data, w, h, radius) {
    const out = new Float32Array(data.length);
    const tmp = new Float32Array(data.length);
    // Horizontal pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w) { sum += data[y * w + nx]; count++; }
        }
        tmp[y * w + x] = sum / count;
      }
    }
    // Vertical pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny >= 0 && ny < h) { sum += tmp[ny * w + x]; count++; }
        }
        out[y * w + x] = sum / count;
      }
    }
    return out;
  }

  // ── High Pass Filter ──
  function applyHighPass(grain, imageGray, w, h, radius, strength) {
    const blurred = boxBlur(imageGray, w, h, radius);
    const str = strength / 100;
    const n = w * h;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const highPass = (imageGray[i] - blurred[i]) / 255;
      const mask = 0.5 + Math.abs(highPass) * str;
      out[i] = grain[i] * Math.min(1, mask);
    }
    return out;
  }

  // ── Value Masking ──
  function applyValueMask(grain, imageGray, w, h, mask) {
    const shadows = (mask.shadows || 0) / 100;
    const midtones = (mask.midtones || 0) / 100;
    const highlights = (mask.highlights || 0) / 100;
    const sMid = mask.shadowMid || 64;
    const mHigh = mask.midHighlight || 192;
    const invert = mask.invert || false;
    const feather = 20;
    const n = w * h;
    const out = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const lum = imageGray[i];
      let inS = 0, inM = 0, inH = 0;

      if (lum <= sMid - feather) inS = 1;
      else if (lum <= sMid + feather) {
        const t = (lum - (sMid - feather)) / (feather * 2);
        inS = 1 - t; inM = t;
      } else if (lum <= mHigh - feather) inM = 1;
      else if (lum <= mHigh + feather) {
        const t = (lum - (mHigh - feather)) / (feather * 2);
        inM = 1 - t; inH = t;
      } else inH = 1;

      let alpha = inS * shadows + inM * midtones + inH * highlights;
      if (invert) alpha = 1 - alpha;
      out[i] = grain[i] * alpha;
    }
    return out;
  }

  // ── Blending Modes ──
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function blendPixel(base, grain, mode) {
    const a = base / 255, b = (grain + 128) / 255; // grain centered, shift to 0-1
    let r;
    switch (mode) {
      case 'normal': r = b; break;
      case 'dissolve': r = b; break; // handled separately
      case 'multiply': r = a * b; break;
      case 'darken': r = Math.min(a, b); break;
      case 'color-burn': r = b <= 0 ? 0 : 1 - clamp01((1 - a) / b); break;
      case 'linear-burn': r = a + b - 1; break;
      case 'screen': r = 1 - (1 - a) * (1 - b); break;
      case 'lighten': r = Math.max(a, b); break;
      case 'color-dodge': r = b >= 1 ? 1 : clamp01(a / (1 - b)); break;
      case 'linear-dodge': r = a + b; break;
      case 'overlay': r = a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b); break;
      case 'soft-light': r = b < 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (a < 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a) - a); break;
      case 'hard-light': r = b < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b); break;
      case 'vivid-light': r = b <= 0.5 ? (b <= 0 ? 0 : 1 - clamp01((1 - a) / (2 * b))) : (b >= 1 ? 1 : clamp01(a / (2 * (1 - b)))); break;
      case 'linear-light': r = a + 2 * b - 1; break;
      case 'pin-light': r = b < 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * b - 1); break;
      case 'hard-mix': r = (a + b >= 1) ? 1 : 0; break;
      case 'difference': r = Math.abs(a - b); break;
      case 'exclusion': r = a + b - 2 * a * b; break;
      case 'subtract': r = a - b; break;
      case 'divide': r = b <= 0 ? 1 : clamp01(a / b); break;
      case 'luminosity': r = b; break; // simplified
      default: r = a;
    }
    return clamp01(r) * 255;
  }

  // ── Apply Grain to ImageData ──
  function applyGrain(imageData, opts) {
    if (!opts || (opts.amount || 0) <= 0) return imageData;

    const w = imageData.width, h = imageData.height, n = w * h;
    const px = imageData.data;

    // Get grayscale reference for masking
    const gray = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      gray[i] = 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    }

    // Generate base grain
    let grain = generateGrain(w, h, opts);

    // Apply high pass filter
    if (opts.highPass && opts.highPass.enabled) {
      grain = applyHighPass(grain, gray, w, h, opts.highPass.radius || 10, opts.highPass.strength || 50);
    }

    // Apply value mask
    if (opts.valueMask) {
      grain = applyValueMask(grain, gray, w, h, opts.valueMask);
    }

    // Generate color grain channels
    const colorMode = opts.colorMode || 'mono';
    let grainR = grain, grainG = grain, grainB = grain;

    if (colorMode === 'color' || colorMode === 'chromatic') {
      grainR = generateGrain(w, h, { ...opts, seed: opts.seed });
      grainG = generateGrain(w, h, { ...opts, seed: opts.seed + 1000 });
      grainB = generateGrain(w, h, { ...opts, seed: opts.seed + 2000 });
    } else if (colorMode === 'channel') {
      const rAmt = (opts.channelR || 100) / 100;
      const gAmt = (opts.channelG || 100) / 100;
      const bAmt = (opts.channelB || 100) / 100;
      grainR = new Float32Array(n);
      grainG = new Float32Array(n);
      grainB = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        grainR[i] = grain[i] * rAmt;
        grainG[i] = grain[i] * gAmt;
        grainB[i] = grain[i] * bAmt;
      }
    } else if (colorMode === 'tinted') {
      const tint = opts.tintColor || [139, 115, 85];
      const tStr = (opts.tintStrength || 50) / 100;
      grainR = new Float32Array(n);
      grainG = new Float32Array(n);
      grainB = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const base = grain[i];
        grainR[i] = base * (1 - tStr + tStr * tint[0] / 128);
        grainG[i] = base * (1 - tStr + tStr * tint[1] / 128);
        grainB[i] = base * (1 - tStr + tStr * tint[2] / 128);
      }
    }

    // Apply blending
    const mode = opts.blendMode || 'overlay';
    const opacity = (opts.opacity === undefined ? 100 : opts.opacity) / 100;
    const result = new ImageData(w, h);
    const rd = result.data;
    const dissolveRng = mode === 'dissolve' ? mkRand(opts.seed + 999) : null;

    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const origR = px[o], origG = px[o + 1], origB = px[o + 2];

      if (mode === 'dissolve') {
        const prob = Math.abs(grain[i]) / 128;
        if (dissolveRng() < prob * opacity) {
          rd[o] = grain[i] > 0 ? 255 : 0;
          rd[o + 1] = grain[i] > 0 ? 255 : 0;
          rd[o + 2] = grain[i] > 0 ? 255 : 0;
        } else {
          rd[o] = origR; rd[o + 1] = origG; rd[o + 2] = origB;
        }
      } else {
        let r = blendPixel(origR, grainR[i], mode);
        let g = blendPixel(origG, grainG[i], mode);
        let b = blendPixel(origB, grainB[i], mode);
        // Apply opacity
        rd[o] = Math.round(origR + (r - origR) * opacity);
        rd[o + 1] = Math.round(origG + (g - origG) * opacity);
        rd[o + 2] = Math.round(origB + (b - origB) * opacity);
      }
      rd[o + 3] = 255;
    }
    return result;
  }

  function applyGrainLayers(imageData, layers) {
    let result = imageData;
    for (const layer of layers) {
      if (layer.amount > 0) result = applyGrain(result, layer);
    }
    return result;
  }

  return { generateGrain, applyGrain, applyGrainLayers };
})();
