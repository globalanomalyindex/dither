/**
 * DITHER.js — 180+ dithering, halftone, sketch, painterly & artistic algorithms
 * Every algorithm: apply(Float32Array pixels, w, h, params) → Uint8ClampedArray
 */

const DitherAlgorithms = (() => {
  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function mkRand(s) { return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

  function errorDiffusion(px, w, h, matrix, strength, serpentine, threshold, noise, errorScale, seed, gamma) {
    const out = new Uint8ClampedArray(w * h), buf = new Float32Array(px);
    const thr = threshold != null ? threshold : 128;
    const es = errorScale != null ? errorScale : 1;
    const ns = noise || 0;
    const gm = gamma != null ? gamma : 1;
    const r = ns > 0 ? mkRand(seed || 42) : null;
    for (let y = 0; y < h; y++) {
      const ltr = !serpentine || (y % 2 === 0);
      const sx = ltr ? 0 : w-1, ex = ltr ? w : -1, dx = ltr ? 1 : -1;
      for (let x = sx; x !== ex; x += dx) {
        const i = y*w+x;
        let old = clamp(buf[i]);
        if (gm !== 1) old = Math.pow(old / 255, gm) * 255;
        if (r) old = clamp(old + (r() - 0.5) * ns * 2);
        const nv = old > thr ? 255 : 0;
        out[i] = nv;
        const err = (old - nv) * strength * es;
        for (const [mdx, mdy, mw] of matrix) {
          const nx = x + (ltr ? mdx : -mdx), ny = y + mdy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) buf[ny*w+nx] += err * mw;
        }
      }
    }
    return out;
  }

  function bayerMatrix(sz) {
    if (sz === 2) return [[0,2],[3,1]];
    const h2 = sz/2, s = bayerMatrix(h2), m = Array.from({length:sz}, ()=> new Array(sz));
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const q = (y < h2 ? 0 : 2) + (x < h2 ? 0 : 1);
      m[y][x] = 4 * s[y%h2][x%h2] + [0,2,3,1][q];
    }
    return m;
  }
  function normBayer(sz) { const m = bayerMatrix(sz), n = sz*sz; return m.map(r => r.map(v => (v+.5)/n)); }

  // Deterministic painter hashes used by reconstructive stroke placement.
  function _advHash01(seed, a, b, c) {
    let h = Math.imul((a | 0) + 374761393, 0x9E3779B1) ^
            Math.imul((b | 0) + 2246822519, 0x85EBCA77) ^
            Math.imul((c | 0) + 3266489917, 0xC2B2AE3D) ^
            (seed | 0);
    h = Math.imul(h ^ (h >>> 15), 0x85EBCA77);
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE3D);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function _normBrushMaskValue(v) {
    if (!(v > 0)) return 0;
    return v > 1 ? (v / 255) : v;
  }
  let _ADV_SOURCE_ANALYSIS = { key: '', analysis: null };
  function _advArrayKey(arr) {
    if (!arr || arr.length === 0) return '0';
    const n = arr.length;
    const pts = [0, (n * 0.17) | 0, (n * 0.43) | 0, (n * 0.71) | 0, n - 1];
    return pts.map(i => clamp(Math.round(arr[i] || 0))).join(',');
  }
  function _advFieldStats(arr) {
    let maxV = 1;
    const stride = Math.max(1, ((arr.length || 1) / 2048) | 0);
    for (let i = 0; i < arr.length; i += stride) if (arr[i] > maxV) maxV = arr[i];
    return maxV;
  }
  function _buildAdvancedField(value, w, h, skipDetail) {
    const sf = sobelField(value, w, h);
    const det = skipDetail ? new Float32Array(w * h) : detailField(value, w, h, 8);
    return {
      value,
      edgeMag: sf.mag,
      edgeAng: sf.ang,
      detail: det,
      edgeNorm: 1 / Math.max(16, _advFieldStats(sf.mag) * 0.6),
      detailNorm: 1 / Math.max(8, _advFieldStats(det) * 0.6)
    };
  }
  function buildAdvancedSourceAnalysis(w, h, fallbackPx) {
    let src = null;
    try {
      if (typeof DitherEngine !== 'undefined' && DitherEngine.getDownsampled) {
        src = DitherEngine.getDownsampled(Math.max(w, h));
      }
    } catch (_) {}
    const useSource = !!(src && src.width === w && src.height === h && src.data);
    const key = useSource
      ? `rgba:${w}x${h}:${_advArrayKey(src.data)}`
      : `gray:${w}x${h}:${_advArrayKey(fallbackPx)}`;
    if (_ADV_SOURCE_ANALYSIS.key === key && _ADV_SOURCE_ANALYSIS.analysis) return _ADV_SOURCE_ANALYSIS.analysis;

    const n = w * h;
    const r = new Float32Array(n);
    const g = new Float32Array(n);
    const b = new Float32Array(n);
    const a = new Float32Array(n);
    const gray = new Float32Array(n);
    const value = new Float32Array(n);
    const saturation = new Float32Array(n);
    const full = new Float32Array(n);
    const zone = new Uint8Array(n);

    if (useSource) {
      const px = src.data;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const rv = px[o], gv = px[o + 1], bv = px[o + 2], av = px[o + 3];
        const mx = Math.max(rv, gv, bv);
        const mn = Math.min(rv, gv, bv);
        const sat = mx <= 0 ? 0 : ((mx - mn) / Math.max(1, mx)) * 255;
        r[i] = rv; g[i] = gv; b[i] = bv; a[i] = av;
        gray[i] = 0.2126 * rv + 0.7152 * gv + 0.0722 * bv;
        value[i] = mx;
        saturation[i] = sat;
        full[i] = gray[i] * 0.42 + value[i] * 0.33 + sat * 0.15 + av * 0.10;
        if (sat < 18) zone[i] = 0;
        else if (rv >= gv && rv >= bv) zone[i] = gv > bv * 1.08 ? 4 : (bv > gv * 1.08 ? 6 : 1);
        else if (gv >= rv && gv >= bv) zone[i] = rv > bv * 1.08 ? 4 : (bv > rv * 1.08 ? 5 : 2);
        else zone[i] = rv > gv * 1.08 ? 6 : (gv > rv * 1.08 ? 5 : 3);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const v = fallbackPx ? clamp(fallbackPx[i]) : 0;
        r[i] = g[i] = b[i] = gray[i] = value[i] = full[i] = v;
        a[i] = 255;
        saturation[i] = 0;
        zone[i] = 0;
      }
    }

    const fields = {
      gray: _buildAdvancedField(gray, w, h, false),
      r: _buildAdvancedField(r, w, h, false),
      g: _buildAdvancedField(g, w, h, false),
      b: _buildAdvancedField(b, w, h, false),
      a: _buildAdvancedField(a, w, h, true),
      value: _buildAdvancedField(value, w, h, false),
      saturation: _buildAdvancedField(saturation, w, h, false),
      full: _buildAdvancedField(full, w, h, false)
    };
    const detailValue = new Float32Array(n);
    for (let i = 0; i < n; i++) detailValue[i] = Math.min(255, fields.gray.detail[i] * fields.gray.detailNorm * 255);
    fields.detail = {
      value: detailValue,
      edgeMag: fields.gray.edgeMag,
      edgeAng: fields.gray.edgeAng,
      detail: fields.gray.detail,
      edgeNorm: fields.gray.edgeNorm,
      detailNorm: fields.gray.detailNorm
    };
    const analysis = { fields, zone };
    _ADV_SOURCE_ANALYSIS = { key, analysis };
    return analysis;
  }
  function buildPainterLayerPasses(passCount, seed, opts) {
    opts = opts || {};
    const count = Math.max(1, Math.min(6, passCount | 0 || 1));
    const detailDrive = clamp01(((opts.detailAware != null ? opts.detailAware : 1) / 2) * 0.65 + ((opts.sizeByDetail != null ? opts.sizeByDetail : 0.8) / 1.5) * 0.35);
    const skipDrive = clamp01(opts.skipSmooth != null ? opts.skipSmooth : 0);
    const preserveDrive = clamp01(opts.detailPreserve != null ? opts.detailPreserve : 0);
    const rnd = mkRand(((Math.imul((seed | 0) || 1, 1103515245) ^ 0x5f3759df) >>> 0) || 1);
    const passes = [];
    for (let i = 0; i < count; i++) {
      const t = count <= 1 ? 0 : i / (count - 1);
      const broad = 1 - t;
      passes.push({
        index: i,
        t,
        broad,
        detailDrive,
        skipDrive,
        preserveDrive,
        detailMin: i === 0 ? 0 : Math.max(0, t * (0.48 + detailDrive * 0.20) - 0.16),
        detailMax: Math.min(1, 0.30 + t * 0.66 + detailDrive * 0.18 + preserveDrive * 0.10),
        edgeFloor: Math.max(0.04, 0.18 + t * 0.38 - detailDrive * 0.10 - preserveDrive * 0.06),
        sizeMul: 1.72 - t * (0.80 + detailDrive * 0.38) + rnd() * 0.08,
        lengthMul: 1.32 - t * (0.30 + detailDrive * 0.16) + rnd() * 0.05,
        densityMul: 0.48 + t * (0.82 + detailDrive * 0.62) + rnd() * 0.08,
        flowMul: 0.52 + t * 0.48 + preserveDrive * 0.08,
        pickupMul: 1.22 - t * (0.42 + detailDrive * 0.18),
        jitterMul: 1.22 - t * (0.42 + detailDrive * 0.20),
        opacityMul: 0.82 + t * 0.22 + preserveDrive * 0.08,
        smoothBoost: 0.68 + broad * (0.34 - skipDrive * 0.16),
        detailBoost: 0.58 + t * (1.16 + detailDrive * 0.58) + preserveDrive * 0.34
      });
    }
    return passes;
  }
  function keepPainterLayerStroke(layerSpec, detail01, edge01, lum01, hash01, phaseTag) {
    if (!layerSpec) return true;
    const detailDrive = layerSpec.detailDrive || 0;
    const skipDrive = layerSpec.skipDrive || 0;
    const preserveDrive = layerSpec.preserveDrive || 0;
    let keep;
    switch (phaseTag) {
      case 'block':
        keep = 0.72 - skipDrive * 0.20 + edge01 * 0.16 + preserveDrive * Math.max(detail01, edge01) * 0.24;
        break;
      case 'flat':
        keep = 0.30 + (1 - detail01) * (0.44 - skipDrive * 0.34) + edge01 * 0.22;
        break;
      case 'detail':
        keep = 0.04 + Math.pow(Math.max(detail01, edge01 * 0.9), Math.max(0.42, 0.86 - detailDrive * 0.28)) * layerSpec.detailBoost;
        break;
      case 'edge':
        keep = 0.03 + Math.pow(edge01, Math.max(0.44, 0.82 - preserveDrive * 0.30)) * (0.90 + detailDrive * 0.48 + preserveDrive * 0.35) + detail01 * 0.18;
        break;
      case 'shadow':
        keep = 0.18 + (1 - lum01) * 0.72 + Math.max(detail01, edge01) * (0.18 + preserveDrive * 0.22);
        break;
      case 'highlight':
        keep = 0.14 + lum01 * 0.68 + Math.max(detail01, edge01) * (0.22 + preserveDrive * 0.20);
        break;
      default: {
        const target = (layerSpec.detailMin + layerSpec.detailMax) * 0.5;
        const width = Math.max(0.12, (layerSpec.detailMax - layerSpec.detailMin) * 0.7 + 0.2);
        const band = Math.max(0, 1 - Math.abs(detail01 - target) / width);
        keep = 0.14 + band * (0.56 + detailDrive * 0.36) + edge01 * (0.18 + preserveDrive * 0.20);
        break;
      }
    }
    if (detail01 < layerSpec.detailMin && phaseTag !== 'flat' && phaseTag !== 'block' && edge01 < layerSpec.edgeFloor) keep *= 0.10 + preserveDrive * 0.12;
    if (detail01 > layerSpec.detailMax && phaseTag === 'flat') keep *= 0.06 + (1 - skipDrive) * 0.12;
    if (phaseTag === 'detail' && detail01 < Math.max(0.06, layerSpec.detailMin * 0.65) && edge01 < layerSpec.edgeFloor) keep *= 0.06 + detailDrive * 0.08;
    if (phaseTag === 'edge' && edge01 < layerSpec.edgeFloor * 0.72) keep *= 0.05 + preserveDrive * 0.08;
    keep = clamp01(keep);
    return hash01 <= Math.max(0.04, keep);
  }
  function shapeDetailSignal(v, drive) {
    const d = clamp01(v);
    const pow = 0.92 - clamp01(drive || 0) * 0.38;
    return Math.pow(d, Math.max(0.48, pow));
  }

  // Simple edge detection helper
  function sobelAt(px, x, y, w, h) {
    if (x < 1 || x >= w-1 || y < 1 || y >= h-1) return { mag: 0, ang: 0 };
    const gx = clamp(px[(y-1)*w+x+1]) + 2*clamp(px[y*w+x+1]) + clamp(px[(y+1)*w+x+1])
             - clamp(px[(y-1)*w+x-1]) - 2*clamp(px[y*w+x-1]) - clamp(px[(y+1)*w+x-1]);
    const gy = clamp(px[(y+1)*w+x-1]) + 2*clamp(px[(y+1)*w+x]) + clamp(px[(y+1)*w+x+1])
             - clamp(px[(y-1)*w+x-1]) - 2*clamp(px[(y-1)*w+x]) - clamp(px[(y-1)*w+x+1]);
    return { mag: Math.sqrt(gx*gx + gy*gy), ang: Math.atan2(gy, gx) };
  }

  // Precompute full-image sobel magnitude + angle grids. Calling sobelAt()
  // inside a hot loop (4000 dabs × bbox pixels × per-pixel edge checks) is
  // what makes painterly algorithms slow. Precomputing once is ~O(w*h) and
  // makes per-dab/per-pixel edge lookups O(1). Returns
  // { mag: Float32Array, ang: Float32Array } sized w*h.
  function sobelField(px, w, h) {
    const mag = new Float32Array(w * h);
    const ang = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      const ym1 = (y - 1) * w, yp1 = (y + 1) * w, yr = y * w;
      for (let x = 1; x < w - 1; x++) {
        const gx = px[ym1 + x + 1] + 2*px[yr + x + 1] + px[yp1 + x + 1]
                 - px[ym1 + x - 1] - 2*px[yr + x - 1] - px[yp1 + x - 1];
        const gy = px[yp1 + x - 1] + 2*px[yp1 + x] + px[yp1 + x + 1]
                 - px[ym1 + x - 1] - 2*px[ym1 + x] - px[ym1 + x + 1];
        const i = yr + x;
        mag[i] = Math.sqrt(gx*gx + gy*gy);
        ang[i] = Math.atan2(gy, gx);
      }
    }
    return { mag, ang };
  }

  // Painterly underpainting base. Two-pass "wash + loose strokes" that
  // reads as paint laid down with a broad wet brush. Both passes use
  // HASH-THRESHOLD DITHER instead of smooth interpolation/alpha-blending,
  // so the underpaint matches the rest of the renderer's crisp pixel-
  // stamped aesthetic (visible speckle / noise texture) rather than
  // being the one smooth layer in an otherwise dithered image.
  //
  //   1. Tonal wash — downsample the source, then write each output pixel
  //      as a hash-thresholded SAMPLE from the 2x2 base-grid neighborhood
  //      (probabilistic bilinear), not a smooth weighted average. Result:
  //      stippled gradients that echo image tone but show pixel texture.
  //   2. Loose strokes — scatter oriented elongated elliptical dabs whose
  //      coverage is a hash-thresholded probability, not an alpha blend.
  //      Strokes follow the local edge tangent (perpendicular to the
  //      gradient) with jitter so they flow AROUND shapes, not across.
  //
  // Writes into `o` (Uint8ClampedArray w*h). `edgeAng` (Float32Array from
  // sobelField) must be precomputed so strokes can orient along it. `sh`
  // is the caller's spatial-hash function for deterministic scatter.
  // `block` is the caller's underpaintBlock (8..40) — controls both wash
  // block size and stroke size.
  //
  // `bMask` / `bSize` (optional): PaintEngine brush mask (Uint8Array of
  // bSize*bSize, values 0..255). When supplied, the stroke footprint uses
  // the mask shape rotated to the stroke angle instead of a hard ellipse,
  // so underpaint strokes inherit the selected Brush Shape (bristles,
  // splatter, knife edge, etc.) — matching the top-layer dabs. Falls back
  // to the ellipse weight when no mask is provided.
  function painterlyUnderpaint(o, px, w, h, block, sh, edgeAng, bMask, bSize, opts) {
    // opts: per-algo underpaint knobs (all optional, defaults preserve legacy).
    //   washNoise     — multiplies the dither noise on the wash (0..2).
    //   washSmoothness— blends the raw-per-pixel source back in (0 = coarse
    //                   block wash; 1 = mostly the source luminance). Lets
    //                   users mix the new painterly underpaint with the old
    //                   near-source base.
    //   density       — multiplies stroke count (0.3..3).
    //   sizeMul       — multiplies per-stroke width + length (0.3..3).
    //   detailResp    — scales the detail-aware response for density AND
    //                   size (0 flattens it; 2 amplifies it).
    //   angleJitter   — raw stroke-angle jitter in radians (default 0.8).
    //   strokeStrength— alpha blend for the oriented strokes (0 = pure wash,
    //                   1 = hard stamp). Lower values keep the underpaint
    //                   soft/vague so the main algo's strokes dominate.
    opts = opts || {};
    const _washNoise      = (opts.washNoise      != null) ? opts.washNoise      : 1;
    const _washSmoothness = (opts.washSmoothness != null) ? opts.washSmoothness : 0;
    const _density        = (opts.density        != null) ? opts.density        : 1;
    const _sizeMulU       = (opts.sizeMul        != null) ? opts.sizeMul        : 1;
    const _detailResp     = (opts.detailResp     != null) ? opts.detailResp     : 1;
    const _angJitU        = (opts.angleJitter    != null) ? opts.angleJitter    : 0.8;
    const _strokeStrength = (opts.strokeStrength != null) ? opts.strokeStrength : 1;
    const _edgeFocusU     = Math.max(0, Math.min(1.5, opts.edgeFocus != null ? opts.edgeFocus : 0.3));
    const _angularityU    = clamp01(opts.angularity != null ? opts.angularity : 0.25);
    // detailPreserve: detail-gated reconstruction pressure. In busy pixels
    // it adds a small dithered tonal correction, more/smaller strokes, and
    // structural marks; it should not simply reveal the source photo.
    const _detailPreserve = (opts.detailPreserve != null) ? opts.detailPreserve : 0;

    // Build the detail field up front — the wash pass uses it for the
    // detailPreserve modulation and the stroke pass uses it downstream for
    // density/size.
    const dfUp = (_detailPreserve > 0) ? detailField(px, w, h, 8) : null;
    let _dUpMax = 1;
    if (dfUp) {
      const _strideU = Math.max(1, ((w * h) / 2048) | 0);
      for (let i = 0; i < dfUp.length; i += _strideU) if (dfUp[i] > _dUpMax) _dUpMax = dfUp[i];
    }
    const dfUpNorm = 1 / Math.max(8, _dUpMax * 0.6);

    // ── Pass 1: tonal wash with NOISE DITHER ──
    // Downsample the source into a coarse grid of block-averages, then
    // bilinear-upsample back — but add strong hash noise before writing.
    // Pure bilinear would give a smooth gradient (the OLD behavior the
    // user flagged as "not dithered"). The noise here is big enough
    // (±NOISE_AMP) to be clearly visible as speckled texture, which
    // matches the main renderer's hash-stamped aesthetic so the
    // underpaint no longer reads as the one smooth layer.
    const baseScale = Math.max(4, Math.round(block * 0.9));
    const bW = Math.max(2, Math.ceil(w / baseScale));
    const bH = Math.max(2, Math.ceil(h / baseScale));
    const base = new Uint8ClampedArray(bW * bH);
    for (let by = 0; by < bH; by++) {
      const sy0 = by * baseScale, sy1 = Math.min(h, sy0 + baseScale);
      for (let bx = 0; bx < bW; bx++) {
        const sx0 = bx * baseScale, sx1 = Math.min(w, sx0 + baseScale);
        let sum = 0, cnt = 0;
        for (let sy = sy0; sy < sy1; sy++) {
          const rowStart = sy * w;
          for (let sx = sx0; sx < sx1; sx++) { sum += px[rowStart + sx]; cnt++; }
        }
        base[by * bW + bx] = cnt ? Math.round(sum / cnt) : 0;
      }
    }
    const wDenom = (w - 1) || 1, hDenom = (h - 1) || 1;
    const bWm1 = bW - 1, bHm1 = bH - 1;
    // Noise amplitude: ±36/255 gives readable speckle without destroying
    // the underlying gradient. Scales the wash's tonal range by about
    // 28% so a smooth mid-gray neighborhood looks stippled, not flat.
    const NOISE_AMP = 36 * _washNoise;
    for (let y = 0; y < h; y++) {
      const fy = (y * bHm1) / hDenom;
      const iy0 = Math.floor(fy), iy1 = Math.min(bHm1, iy0 + 1);
      const ty = fy - iy0;
      const row0 = iy0 * bW, row1 = iy1 * bW;
      for (let x = 0; x < w; x++) {
        const fx = (x * bWm1) / wDenom;
        const ix0 = Math.floor(fx), ix1 = Math.min(bWm1, ix0 + 1);
        const tx = fx - ix0;
        const v00 = base[row0 + ix0], v10 = base[row0 + ix1];
        const v01 = base[row1 + ix0], v11 = base[row1 + ix1];
        const v0 = v00 + (v10 - v00) * tx;
        const v1 = v01 + (v11 - v01) * tx;
        let smooth = v0 + (v1 - v0) * ty;
        // washSmoothness → mix the raw source luminance back in so the
        // underpaint can behave like the OLD near-source base when the
        // user wants a tighter tone, or stay broad-blocky (default 0).
        if (_washSmoothness > 0) {
          smooth = smooth * (1 - _washSmoothness) + px[y * w + x] * _washSmoothness;
        }
        // detailPreserve used to pull the raw source almost directly back
        // into busy pixels. That made the control feel like "reveal photo"
        // instead of "paint more intelligently." Keep it painterly: only a
        // small dithered tonal correction is mixed into the wash, while the
        // actual subject reconstruction happens through smaller strokes and
        // structural marks below.
        if (dfUp) {
          const d01u = shapeDetailSignal(dfUp[y * w + x] * dfUpNorm, _detailPreserve);
          const mixU = d01u * _detailPreserve * 0.24;
          if (mixU > 0) {
            const paintedTight = px[y * w + x] + (sh(x, y, 606) - 0.5) * NOISE_AMP * 0.7;
            smooth = smooth * (1 - mixU) + paintedTight * mixU;
          }
        }
        const noise = (sh(x, y, 605) - 0.5) * NOISE_AMP * 2;
        const val = smooth + noise;
        o[y * w + x] = val < 0 ? 0 : (val > 255 ? 255 : Math.round(val));
      }
    }

    // ── Pass 2: dithered oriented strokes ──
    // Elliptical stroke footprint, but instead of alpha-blending the source
    // color by a soft weight we threshold the weight against a spatial
    // hash → hard pixel-sample at probability weight, keep underpaint
    // otherwise. Matches the main renderer's dithered stamp behavior.
    const strokeW = Math.max(5, Math.round(block * 1.0 * _sizeMulU));
    const strokeL = Math.max(14, Math.round(block * 2.6 * _sizeMulU));
    const baseStrokes = Math.max(30, Math.round((w * h) / (strokeW * strokeL * 0.45) * _density));
    const useMask = !!(bMask && bSize > 1);

    // Detail field — local luminance stddev per pixel. Used for TWO things:
    // (a) stroke SIZE: bigger in flat areas, smaller in busy areas.
    // (b) stroke DENSITY: fewer in flat areas, more in busy areas.
    // Both responses inverted against the same per-image soft ceiling so
    // the effect adapts to image character (a flat photo still sees the
    // full range of variation instead of being all-flat).
    const df = dfUp || detailField(px, w, h, 8);
    let _dmax = 1;
    if (dfUp) {
      _dmax = _dUpMax;
    } else {
      const _stride = Math.max(1, ((w * h) / 2048) | 0);
      for (let i = 0; i < df.length; i += _stride) if (df[i] > _dmax) _dmax = df[i];
    }
    const dNorm = 1 / Math.max(8, _dmax * 0.6);

    // Over-scatter candidates, then reject by detail. Keep probability is
    // 0.28 in dead-flat regions → 1.0 in max-detail regions, so a 2.2×
    // candidate pool resolves to ~0.62× baseStrokes in flat areas and
    // ~2.2× baseStrokes in detailed areas. That's the "few sweeping
    // strokes in the sky / many tight dabs on the face" painterly read.
    // Combined with the size multiplier below (flat → 1.55×, busy → 0.55×),
    // total covered area stays roughly balanced with flat regions still
    // reading as confident washes.
    const OVERSAMPLE = 2.2;
    const candidates = Math.round(baseStrokes * OVERSAMPLE);
    // detailResp remaps the density response. At 0 the keep probability
    // is near-uniform (detail barely affects count); at 2 the contrast
    // between flat-area sparsity and busy-area density is ~2× stronger.
    // KEEP_MIN floor keeps some strokes everywhere so flat regions aren't
    // entirely barren.
    // detailPreserve now participates in the density + size response so
    // the user-facing "Subject Detail" slider is the master knob for
    // detail-aware behaviour across the whole underpaint: high values
    // give both more source-bleed in busy areas AND smaller, more
    // precise strokes there, with bigger/looser strokes in flat areas.
    // detailResp is the legacy "response curve" knob — detailPreserve
    // stacks multiplicatively on top of it so crank=1 nearly doubles
    // the effective contrast.
    const _effDetailResp = _detailResp * (1 + _detailPreserve * 1.3);
    // Shift the *center* of the density response toward uniformity as
    // effDetailResp → 0.
    // At effDetailResp=1: floor 0.28, range 0.72 (legacy).
    // At effDetailResp=0: floor ~0.78, range ~0.22 (mostly uniform).
    // At effDetailResp=2: floor ~0.08, range ~0.92 (strong contrast).
    const _respFloor = 0.28 + 0.5 * (1 - Math.min(1, _effDetailResp));
    const _respRange = Math.max(0.05, 0.72 * _effDetailResp);
    const _KEEP_MIN2  = Math.max(0.05, Math.min(0.95, _respFloor));
    const _KEEP_RANGE2= Math.max(0.05, Math.min(1 - _KEEP_MIN2, _respRange));

    for (let i = 0; i < candidates; i++) {
      const cx = Math.floor(sh(i, 0, 700) * w);
      const cy = Math.floor(sh(i, 0, 701) * h);
      const sampleIdx = cy * w + cx;
      // Detail at candidate center. Used for both density rejection and
      // stroke size. Sampling once keeps the two responses in lockstep —
      // a flat region gets both bigger strokes AND fewer of them.
      const d01 = shapeDetailSignal(df[sampleIdx] * dNorm, Math.min(1, _effDetailResp / 2));
      const keepP = _KEEP_MIN2 + _KEEP_RANGE2 * d01;
      if (sh(i, 0, 706) > keepP) continue;
      const sampleVal = px[sampleIdx];
      const eIdx = Math.min(h - 2, Math.max(1, cy)) * w + Math.min(w - 2, Math.max(1, cx));
      const ang = edgeAng[eIdx] + Math.PI * 0.5 + (sh(i, 0, 702) - 0.5) * _angJitU;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // Detail-based size multiplier. detailResp + detailPreserve together
      // drive the swing so the user-facing "Subject Detail" slider
      // visibly shrinks strokes on busy pixels AND enlarges them on flat
      // pixels. The extra detailPreserve term means cranking Subject
      // Detail to 1 roughly doubles the size contrast on top of whatever
      // detailResp provides — stripes of tiny precise strokes on faces,
      // broad lazy strokes on skies.
      const _swingBase = 0.5;  // half-range around mid
      const _swing = _swingBase * _effDetailResp;
      const sizeMul = (1.05 + _swing) - d01 * (2 * _swing);
      const rLen = strokeL * 0.5 * (0.65 + sh(i, 0, 703) * 0.75) * sizeMul;
      const rWid = strokeW * 0.5 * (0.55 + sh(i, 0, 704) * 0.55) * sizeMul;
      const rLen2 = rLen * rLen, rWid2 = rWid * rWid;
      const bMax = Math.max(rLen, rWid) + 1;
      const boxMinX = Math.max(0, Math.floor(cx - bMax));
      const boxMaxX = Math.min(w - 1, Math.ceil(cx + bMax));
      const boxMinY = Math.max(0, Math.floor(cy - bMax));
      const boxMaxY = Math.min(h - 1, Math.ceil(cy + bMax));
      // Mask sampling. Two fixes vs. a naive stretch-to-fit-ellipse:
      //
      // 1. TILE ALONG LENGTH. A square mask stretched to a long thin stroke
      //    smears bristle/splatter structure across the whole stroke so its
      //    natural scale disappears. Instead we tile the mask's t-axis —
      //    the mask pattern repeats along the stroke length at its native
      //    scale, so bristle streaks stay crisp and splatter keeps its
      //    specked density. The width axis still stretches to fit (strokes
      //    need to sample the mask's full y-range once, not repeat it
      //    across the narrow dimension).
      //
      // 2. GAMMA THE MASK. Most brush masks are near-opaque in their
      //    interior — a naive ellipse × mask multiply passes the ellipse
      //    through almost unchanged, so the brush character barely reads.
      //    We apply ~gamma 2.4 to the mask value, which collapses mid-tones
      //    (0.5 → 0.19, 0.7 → 0.43, 0.9 → 0.79) and turns subtle bristle
      //    gaps into hard breaks. Solid regions (~1.0) still pass through.
      const bSz = bSize | 0;
      const invHalfW = 1 / rWid;
      // Repeat count along stroke length. Clamped so very short strokes
      // don't over-tile and lose mask coherence. 0.8 scale keeps the
      // repeats from being too dense.
      const lenTiles = Math.max(1, Math.min(6, (rLen / rWid) * 0.8));
      const invHalfLTiled = lenTiles / rLen;
      for (let yy = boxMinY; yy <= boxMaxY; yy++) {
        for (let xx = boxMinX; xx <= boxMaxX; xx++) {
          const dx = xx - cx, dy = yy - cy;
          const t = dx * ca + dy * sa;
          const u = -dx * sa + dy * ca;
          const r2 = (t * t) / rLen2 + (u * u) / rWid2;
          if (r2 > 1) continue;
          const ellipseW = 1 - r2;
          let weight = ellipseW;
          if (useMask) {
            // Width: stretch -1..1 → 0..1.
            // Length: tile — scale then wrap to 0..1.
            const ny = u * invHalfW;
            let nxT = t * invHalfLTiled; // may exceed ±1
            // fract((nxT + 1) * 0.5) — wrap to 0..1
            let ut = (nxT + 1) * 0.5;
            ut = ut - Math.floor(ut);
            const uw = (ny + 1) * 0.5;
            let mx = (ut * bSz) | 0;
            let my = (uw * bSz) | 0;
            if (mx < 0) mx = 0; else if (mx >= bSz) mx = bSz - 1;
            if (my < 0) my = 0; else if (my >= bSz) my = bSz - 1;
            const maskW = bMask[my * bSz + mx] / 255;
            // ~gamma 2.4 via cheap polynomial: m^2 * (0.6*m + 0.4).
            // Keeps 0→0 and 1→1, aggressively suppresses midtones.
            const maskSharp = maskW * maskW * (0.6 * maskW + 0.4);
            weight = ellipseW * maskSharp;
            if (weight <= 0) continue;
          }
          if (sh(xx, yy, 705) > weight) continue;
          // strokeStrength < 1 → blend with the wash rather than replacing,
          // so the underpaint stays soft and the main algo's strokes carry
          // the final read. =1 matches legacy hard-stamp behavior.
          const _oi = yy * w + xx;
          if (_strokeStrength >= 0.999) {
            o[_oi] = sampleVal;
          } else {
            o[_oi] = Math.round(sampleVal * _strokeStrength + o[_oi] * (1 - _strokeStrength));
          }
        }
      }
    }
    const structureStrength = clamp01((_detailPreserve * 0.85 + _effDetailResp * 0.12) * (0.78 + _edgeFocusU * 0.34));
    if (structureStrength > 0.03) {
      paintStructuralEdgeStrokes(o, px, w, h, opts.edgeMag || null, edgeAng, df, sh, {
        strength: structureStrength,
        detailDrive: Math.min(1, _effDetailResp / 2),
        angularity: (opts.formFollow != null && opts.formFollow < 0)
          ? Math.min(1, -opts.formFollow)
          : Math.max(0.35, _angularityU),
        length: block * (1.35 + structureStrength * 1.15),
        width: Math.max(0.8, block * 0.08),
        spacing: Math.max(3, block * (0.76 - structureStrength * 0.26)),
        seed: opts.seed || 1
      });
    }
  }

  // Local detail / variance grid, downsampled for speed. Used to let
  // painterly algorithms place fewer, larger strokes in low-variance areas
  // (sky, walls) and many small strokes in detailed areas. Block size is
  // coarse (8px) — gives a chunky "this area is busy / this one is smooth"
  // map without much cost. Returns Float32Array same size as px, with each
  // cell holding the local luminance standard deviation (0..~100).
  function detailField(px, w, h, block) {
    const B = block || 8;
    const d = new Float32Array(w * h);
    const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
    const blockStd = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let sum = 0, sumSq = 0, n = 0;
        const x0 = bx * B, y0 = by * B;
        const x1 = Math.min(w, x0 + B), y1 = Math.min(h, y0 + B);
        for (let yy = y0; yy < y1; yy++) {
          const yr = yy * w;
          for (let xx = x0; xx < x1; xx++) {
            const v = px[yr + xx]; sum += v; sumSq += v * v; n++;
          }
        }
        if (n > 0) {
          const mean = sum / n;
          const varc = Math.max(0, sumSq / n - mean * mean);
          blockStd[by * bw + bx] = Math.sqrt(varc);
        }
      }
    }
    // Expand block grid back to full resolution (nearest-neighbor)
    for (let y = 0; y < h; y++) {
      const by = (y / B) | 0;
      const brow = by * bw;
      const drow = y * w;
      for (let x = 0; x < w; x++) {
        d[drow + x] = blockStd[brow + ((x / B) | 0)];
      }
    }
    return d;
  }

  function paintStructuralEdgeStrokes(o, px, w, h, edgeMag, edgeAng, detail, sh, opts) {
    opts = opts || {};
    const strength = clamp01(opts.strength || 0);
    if (strength <= 0.01 || !edgeAng) return o;
    if (!edgeMag) edgeMag = sobelField(px, w, h).mag;
    const detailDrive = clamp01(opts.detailDrive != null ? opts.detailDrive : strength);
    const angularity = clamp01(opts.angularity != null ? opts.angularity : 0.35);
    const baseLen = Math.max(4, opts.length || 16);
    const baseWidth = Math.max(0.6, opts.width || 1.4);
    const spacing = Math.max(2, Math.round((opts.spacing || 8) * (1 - strength * 0.35)));
    const eNorm = 1 / Math.max(16, _advFieldStats(edgeMag) * 0.55);
    let dNorm = 1 / 32;
    if (detail) dNorm = 1 / Math.max(8, _advFieldStats(detail) * 0.55);
    const threshold = Math.max(0.08, 0.32 - strength * 0.18 - detailDrive * 0.08);
    for (let gy = 1; gy < h - 1; gy += spacing) {
      const jitterY = Math.round((_advHash01(opts.seed || 1, gy, spacing, 971) - 0.5) * spacing * 0.7);
      const y = Math.max(1, Math.min(h - 2, gy + jitterY));
      for (let gx = 1; gx < w - 1; gx += spacing) {
        const jitterX = Math.round((_advHash01(opts.seed || 1, gx, y, 972) - 0.5) * spacing * 0.7);
        const x = Math.max(1, Math.min(w - 2, gx + jitterX));
        const idx = y * w + x;
        const edge01 = clamp01(edgeMag[idx] * eNorm);
        const detail01 = detail ? shapeDetailSignal(detail[idx] * dNorm, detailDrive) : edge01;
        const importance = Math.max(edge01, detail01 * 0.62);
        if (importance < threshold) continue;
        const keep = Math.min(1, strength * (0.22 + importance * 1.05));
        if (sh(x, y, 970) > keep) continue;
        let ang = edgeAng[idx] + Math.PI * 0.5;
        if (angularity > 0.02) {
          const qStep = Math.PI * 2 / (8 + Math.round((1 - angularity) * 8));
          const snapped = Math.round(ang / qStep) * qStep;
          ang = ang * (1 - angularity) + snapped * angularity;
        }
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const len = baseLen * (0.72 + importance * (0.85 + strength * 0.9));
        const halfLen = len * 0.5;
        const halfW = baseWidth * (0.85 + strength * 1.35);
        for (let t = -halfLen; t <= halfLen; t += 1) {
          const taper = 1 - Math.abs(t) / Math.max(1, halfLen);
          if (taper <= 0) continue;
          for (let ww = -halfW; ww <= halfW; ww += 1) {
            const wx = Math.round(x + ca * t - sa * ww);
            const wy = Math.round(y + sa * t + ca * ww);
            if (wx < 0 || wx >= w || wy < 0 || wy >= h) continue;
            const cross = 1 - Math.abs(ww) / Math.max(1, halfW);
            const prob = taper * cross * (0.42 + strength * 0.58);
            if (sh(wx, wy, 973 + (t | 0)) > prob) continue;
            const back = Math.max(0, Math.min(w - 1, Math.round(wx - ca * strength * 2)));
            const bay = Math.max(0, Math.min(h - 1, Math.round(wy - sa * strength * 2)));
            o[wy * w + wx] = px[bay * w + back];
          }
        }
      }
    }
    return o;
  }

  const PAINTER_RECON_STEPS = [
    { key: 'underpaint',   label: 'Underpainting' },
    { key: 'construction', label: 'Painterly sketch' },
    { key: 'block',        label: 'Broad block-in' },
    { key: 'forms',        label: 'Form masses' },
    { key: 'color',        label: 'Color notes' },
    { key: 'edges',        label: 'Edges + detail' },
    { key: 'finish',       label: 'Final painting' }
  ];

  function defaultPainterLayerSettings() {
    return {
      underpaint:   { scale: 1.15, density: 0.85, opacity: 0.92, jitter: 0.45, detail: 0.45, angularity: 0.30, form: 0.25, edge: 0.20 },
      construction: { scale: 1.00, density: 1.16, opacity: 0.88, jitter: 0.62, detail: 0.85, angularity: 0.92, form: 0.28, edge: 0.78 },
      block:        { scale: 1.38, density: 0.76, opacity: 0.92, jitter: 0.38, detail: 0.25, angularity: 0.72, form: 0.16, edge: 0.20 },
      forms:        { scale: 0.95, density: 1.02, opacity: 0.84, jitter: 0.34, detail: 0.64, angularity: 0.38, form: 0.74, edge: 0.46 },
      color:        { scale: 0.68, density: 1.35, opacity: 0.82, jitter: 0.88, detail: 0.78, angularity: 0.20, form: 0.32, edge: 0.30 },
      edges:        { scale: 0.58, density: 1.30, opacity: 0.94, jitter: 0.24, detail: 1.10, angularity: 0.48, form: 0.86, edge: 1.10 },
      finish:       { scale: 1.00, density: 1.00, opacity: 1.00, jitter: 0.44, detail: 0.82, angularity: 0.34, form: 0.62, edge: 0.70 }
    };
  }

  function clampPainterStep(v) {
    if (!isFinite(v)) return 6;
    return Math.max(0, Math.min(PAINTER_RECON_STEPS.length - 1, Math.round(v)));
  }

  function painterStepKey(level) {
    return PAINTER_RECON_STEPS[clampPainterStep(level)].key;
  }

  function reconstructionStageLevel(stage) {
    switch (stage || 'finish') {
      case 'underpaint': return 0;
      case 'construction': return 1;
      case 'block': return 2;
      case 'forms': return 3;
      case 'color': return 4;
      case 'edges': return 5;
      case 'finish':
      default: return 6;
    }
  }

  function reconstructionStepLevel(p) {
    if (p && p.reconstructionStep != null) return clampPainterStep(+p.reconstructionStep);
    return reconstructionStageLevel(p && p.reconstructionStage);
  }

  // Step keys in pipeline order. The cascade in getPainterLayerSettings
  // walks this list — every step's edits affect itself AND every step
  // downstream (with exponential distance damping).
  const PAINTER_STEP_ORDER = ['underpaint', 'construction', 'block', 'forms', 'color', 'edges', 'finish'];
  // 0.78 ≈ 1.0 → 0.78 → 0.61 → 0.47 → 0.37 → 0.29 → 0.23 over 6 hops.
  // Strong enough that edits to underpaint visibly carry into the finish,
  // gentle enough that each step still feels distinct.
  const PAINTER_CASCADE_DAMP = 0.78;
  const _PAINTER_FIELDS = ['scale', 'density', 'opacity', 'jitter', 'detail', 'angularity', 'form', 'edge'];

  // Returns the effective per-step settings for the painter, with edits
  // cascaded forward through the pipeline. Each upstream step's deviation
  // from its own defaults is added to the current step's base, weighted by
  // PAINTER_CASCADE_DAMP^distance. So editing underpaint at runtime ripples
  // through construction/block/forms/.../finish in real time — including
  // on-the-fly scrubbing — while still letting each step have its own
  // signature and overrides.
  //
  // Backward compatible: if no reconstructionLayers edits exist, the
  // accumulator is zero and the result is identical to the previous
  // single-step lookup.
  function getPainterLayerSettings(p, keyOrLevel) {
    const defaults = defaultPainterLayerSettings();
    const targetKey = typeof keyOrLevel === 'number' ? painterStepKey(keyOrLevel) : keyOrLevel;
    const targetIdx = PAINTER_STEP_ORDER.indexOf(targetKey);
    const base = defaults[targetKey] || defaults.finish;
    const layers = (p && p.reconstructionLayers && typeof p.reconstructionLayers === 'object')
      ? p.reconstructionLayers
      : null;

    // Accumulate (userValue − stepBase) × dampingWeight across every step
    // up to and including the target. The target step's own delta lands
    // at full weight (distance 0); each upstream step is weaker.
    const accum = { scale:0, density:0, opacity:0, jitter:0, detail:0, angularity:0, form:0, edge:0 };
    if (layers && targetIdx >= 0) {
      for (let i = 0; i <= targetIdx; i++) {
        const k = PAINTER_STEP_ORDER[i];
        const src = layers[k];
        if (!src || typeof src !== 'object') continue;
        const kBase = defaults[k] || defaults.finish;
        const distance = targetIdx - i;
        const weight = Math.pow(PAINTER_CASCADE_DAMP, distance);
        for (let f = 0; f < _PAINTER_FIELDS.length; f++) {
          const field = _PAINTER_FIELDS[f];
          const userVal = +src[field];
          if (!isFinite(userVal)) continue;
          const baseVal = +kBase[field];
          if (!isFinite(baseVal)) continue;
          accum[field] += (userVal - baseVal) * weight;
        }
      }
    }

    const baseDetail     = base.detail     != null ? base.detail     : 0.7;
    const baseAngularity = base.angularity != null ? base.angularity : 0.35;
    const baseForm       = base.form       != null ? base.form       : 0.5;
    const baseEdge       = base.edge       != null ? base.edge       : 0.5;
    return {
      scale:      Math.max(0.25, Math.min(3,   base.scale      + accum.scale)),
      density:    Math.max(0.15, Math.min(3,   base.density    + accum.density)),
      opacity:    Math.max(0,    Math.min(1.5, base.opacity    + accum.opacity)),
      jitter:     Math.max(0,    Math.min(1.5, base.jitter     + accum.jitter)),
      detail:     Math.max(0,    Math.min(1.5, baseDetail      + accum.detail)),
      angularity: Math.max(0,    Math.min(1,   baseAngularity  + accum.angularity)),
      form:       Math.max(0,    Math.min(1,   baseForm        + accum.form)),
      edge:       Math.max(0,    Math.min(1.5, baseEdge        + accum.edge))
    };
  }

  function applyPainterLayerSettingsToPlan(plan, settings) {
    const s = settings || getPainterLayerSettings(null, 'finish');
    const density = Math.max(0.15, s.density);
    const opacity = Math.max(0, s.opacity);
    const scale = Math.max(0.25, s.scale);
    const jitter = Math.max(0, s.jitter);
    return (plan || []).map(layer => ({
      ...layer,
      sizeMul: layer.sizeMul * scale,
      lengthMul: layer.lengthMul * (0.72 + scale * 0.28),
      densityMul: layer.densityMul * density,
      flowMul: layer.flowMul * (1 + Math.max(0, 0.55 - jitter) * 0.10),
      pickupMul: layer.pickupMul * (0.82 + scale * 0.18),
      jitterMul: layer.jitterMul * (0.62 + jitter * 0.76),
      opacityMul: layer.opacityMul * opacity,
      detailBoost: layer.detailBoost * (0.72 + (s.detail || 0.7) * 0.42),
      edgeFloor: layer.edgeFloor * (1 - Math.min(0.42, (s.edge || 0.5) * 0.18)),
      reconDetail: s.detail || 0,
      reconAngularity: s.angularity || 0,
      reconForm: s.form || 0,
      reconEdge: s.edge || 0,
      reconJitter: jitter
    }));
  }

  function blendAngles(a, b, t) {
    const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + d * clamp01(t);
  }

  function quantizeAngle(ang, amount, divisions) {
    const amt = clamp01(amount || 0);
    if (amt <= 0.001) return ang;
    const qStep = Math.PI * 2 / Math.max(4, divisions || 16);
    const snapped = Math.round(ang / qStep) * qStep;
    return blendAngles(ang, snapped, amt);
  }

  function painterDirectionAngle(seed, x, y, idx, edgeMag, edgeAng, edgeNorm, opts) {
    opts = opts || {};
    const cell = Math.max(6, Math.round(opts.cell || 18));
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const base = _advHash01(seed || 1, cx, cy, 1171) * Math.PI * 2;
    const neighbor = _advHash01(seed || 1, cx + 7, cy - 3, 1172) * Math.PI * 2;
    const local = _advHash01(seed || 1, x >> 2, y >> 2, 1173) * Math.PI * 2;
    let field = blendAngles(base, neighbor, 0.36);
    field = blendAngles(field, local, 0.18 + clamp01(opts.jitter || 0) * 0.18);
    field += Math.sin((x + seed) * 0.031 + cy * 0.9) * 0.24;
    field += Math.cos((y - seed) * 0.027 + cx * 0.7) * 0.18;

    if (edgeAng && edgeMag && idx >= 0) {
      const edge01 = clamp01(edgeMag[idx] * (edgeNorm || (1 / 120)));
      const tangent = edgeAng[idx] + Math.PI * 0.5;
      const edgeFocus = Math.max(0, opts.edgeFocus != null ? opts.edgeFocus : 0.5);
      const formFollow = Math.max(0, opts.formFollow != null ? opts.formFollow : 0.35);
      const edgeWeight = clamp01(Math.pow(edge01, 0.55) * (0.24 + edgeFocus * 0.54) + formFollow * 0.22);
      field = blendAngles(field, tangent, edgeWeight);
    }
    return quantizeAngle(field, opts.angularity || 0, opts.divisions || 16);
  }

  function paintSketchLine(o, w, h, cx, cy, ang, len, width, mark, opacity, seed, tag) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const halfLen = Math.max(1, len * 0.5);
    const halfW = Math.max(0.5, width);
    const aMax = Math.max(0, Math.min(1, opacity));
    for (let t = -halfLen; t <= halfLen; t += 1) {
      const taper = 1 - Math.abs(t) / halfLen;
      if (taper <= 0) continue;
      for (let ww = -halfW; ww <= halfW; ww += 1) {
        const wx = Math.round(cx + ca * t - sa * ww);
        const wy = Math.round(cy + sa * t + ca * ww);
        if (wx < 0 || wx >= w || wy < 0 || wy >= h) continue;
        const cross = 1 - Math.abs(ww) / Math.max(1, halfW);
        const prob = taper * cross * (0.52 + aMax * 0.38);
        if (_advHash01(seed || 1, wx, wy, (tag || 0) + (t | 0)) > prob) continue;
        const oi = wy * w + wx;
        const a = Math.min(0.96, aMax * (0.45 + taper * 0.35 + cross * 0.20));
        o[oi] = Math.round(mark * a + o[oi] * (1 - a));
      }
    }
  }

  // ── CONSTRUCTION SKETCH HELPERS ──
  // The sketch engine traces ACTUAL CONTOURS instead of stamping a grid of
  // unrelated lines. Two passes:
  //   (1) Edge contour chains — walk along salient edges, snapping to local
  //       maxima, producing curves that follow the subject's silhouette.
  //   (2) Tonal mass-boundary chains — same trace algorithm but on the
  //       gradient of the gray-luma field, so it picks up where lit and
  //       shadow PLANES meet (form lines, e.g., cheek-into-shadow).
  // Both produce polylines that are then rendered as wobbly tapered
  // brushy strokes — the painter's "thinking on paper" energy.

  // Walk one direction (forward = +1, backward = −1) from a seed point along
  // the edge tangent, snapping to local maxima of the magnitude field. Stops
  // when the magnitude drops, the chain leaves the canvas, or maxLen is
  // exhausted. Returns a list of {x, y, m, ang} samples, seed-first.
  function _walkChainOneDir(seedX, seedY, dirSign, magField, angField, fieldNorm, w, h, opts) {
    const maxLen     = opts.maxLen || 80;
    const stepSize   = opts.stepSize || 1.4;
    const minMag     = opts.minMag != null ? opts.minMag : 0.10;
    const lookAhead  = opts.lookAhead || 2;
    const points = [];
    let x = seedX, y = seedY;
    let prevAng = null;
    let traveled = 0;
    while (traveled < maxLen) {
      const ix = Math.round(x), iy = Math.round(y);
      if (ix < 1 || ix >= w - 1 || iy < 1 || iy >= h - 1) break;
      const i = iy * w + ix;
      const m = magField[i] * fieldNorm;
      if (m < minMag) break;
      // Tangent = perpendicular to gradient.
      let ang = angField[i] + Math.PI * 0.5;
      // Tangent has a 180° ambiguity. Pick the side that continues forward.
      if (prevAng !== null) {
        const ang2 = ang + Math.PI;
        let d1 = ang - prevAng, d2 = ang2 - prevAng;
        while (d1 >  Math.PI) d1 -= 2 * Math.PI;
        while (d1 < -Math.PI) d1 += 2 * Math.PI;
        while (d2 >  Math.PI) d2 -= 2 * Math.PI;
        while (d2 < -Math.PI) d2 += 2 * Math.PI;
        if (Math.abs(d2) < Math.abs(d1)) ang = ang2;
      }
      points.push({ x, y, m, ang });
      const cosA = Math.cos(ang), sinA = Math.sin(ang);
      const stepX = cosA * stepSize * dirSign;
      const stepY = sinA * stepSize * dirSign;
      // Snap perpendicular: search ±lookAhead pixels orthogonal to the
      // tangent for the highest edge magnitude — this is what keeps the
      // chain glued to the actual edge instead of drifting off.
      let bestX = x + stepX, bestY = y + stepY, bestM = -1;
      const perpX = -sinA, perpY = cosA;
      for (let s = -lookAhead; s <= lookAhead; s++) {
        const tx = x + stepX + perpX * s * 0.65;
        const ty = y + stepY + perpY * s * 0.65;
        const itx = Math.round(tx), ity = Math.round(ty);
        if (itx < 1 || itx >= w - 1 || ity < 1 || ity >= h - 1) continue;
        const tm = magField[ity * w + itx] * fieldNorm;
        if (tm > bestM) { bestM = tm; bestX = tx; bestY = ty; }
      }
      if (bestM < minMag * 0.65) break;
      x = bestX;
      y = bestY;
      prevAng = ang;
      traveled += stepSize;
    }
    return points;
  }
  // Trace a full contour chain from a seed by walking forward + backward.
  function _traceContourChain(seedX, seedY, magField, angField, fieldNorm, w, h, opts) {
    const fwd = _walkChainOneDir(seedX, seedY, +1, magField, angField, fieldNorm, w, h, opts);
    const bwd = _walkChainOneDir(seedX, seedY, -1, magField, angField, fieldNorm, w, h, opts);
    bwd.reverse();
    // Avoid duplicating the seed sample (it's first in both arrays).
    return bwd.concat(fwd.length > 0 ? fwd.slice(1) : []);
  }
  // Stamp a small soft brush dot, using a hash-based dither so the stroke
  // reads as brushy/scratchy rather than as a solid line.
  function _stampSketchDot(o, w, h, cx, cy, r, mark, opa, seed, jitter) {
    if (opa < 0.02 || r < 0.35) return;
    const ir = Math.ceil(r);
    const r2 = r * r;
    const dropoff = 0.78 + Math.max(0, jitter) * 0.36;
    for (let dy = -ir; dy <= ir; dy++) {
      const wy = Math.round(cy + dy);
      if (wy < 0 || wy >= h) continue;
      for (let dx = -ir; dx <= ir; dx++) {
        const wx = Math.round(cx + dx);
        if (wx < 0 || wx >= w) continue;
        const dd = dx * dx + dy * dy;
        if (dd > r2) continue;
        const fall = 1 - Math.sqrt(dd) / r;
        const aa = fall * opa;
        if (_advHash01(seed | 0, wx, wy, 4317) > aa * dropoff) continue;
        const oi = wy * w + wx;
        const ablend = Math.min(0.95, aa);
        o[oi] = Math.round(mark * ablend + o[oi] * (1 - ablend));
      }
    }
  }
  // Resolve the per-sample mark value based on the user-selected color mode.
  // The mark is what the brush "deposits" — different modes give the line
  // different media feel. Pure 'source' is a no-op (transparent), so it's
  // intentionally biased toward darker/lighter to remain visible.
  function _resolveSketchMark(srcV, strength, taper, colorMode) {
    switch (colorMode) {
      case 'dark':
        // Constant deep tone — charcoal/graphite. Slight strength response
        // so weaker chains aren't pitch-black.
        return clamp(22 + (1 - strength) * 28 - taper * 6);
      case 'light':
        // Chalk on dark canvas — bright constant tone.
        return clamp(228 + strength * 22 - (1 - taper) * 14);
      case 'source':
        // Pick up the source value at this sample point — barely visible
        // unless the underlying canvas is far from source. Useful when the
        // sketch is meant as a subtle structural guide rather than a mark.
        return srcV;
      case 'complement':
        // Push to the value-complement (255-src). Reads as a bright
        // "negative" tracing — strong contrast vs the canvas wherever
        // source isn't already mid-gray.
        return clamp(srcV + (255 - 2 * srcV) * (0.55 + strength * 0.45));
      case 'ink':
        // Pure black/white — woodcut/scratchboard feel.
        return srcV < 128 ? 0 : 255;
      case 'auto':
      default:
        // Adaptive contrast: dark on bright, light on dark — the "charcoal
        // that knows the canvas" default.
        return clamp(srcV + (srcV < 128 ? -72 : 56) * strength * (0.55 + taper * 0.55));
    }
  }

  // Walk a polyline as a continuous brushy stroke — tapered at both ends,
  // wobble accumulating along the path so the line feels hand-drawn.
  // colorMode controls the deposited mark (see _resolveSketchMark).
  // angularOutline collapses the wobble + decimates the chain to a few
  // straight segments (cubist / woodcut / blocked-out look).
  function _renderSketchChain(o, px, w, h, chain, halfW, strength, opacity, jitter, seed, lineFeel, colorMode, angularOutline) {
    if (!chain || chain.length < 2) return;
    // Optional decimation for "angular outline" mode — sample ~6-10 points
    // along the chain and treat the polyline between them as straight
    // segments. The render loop below still steps along each segment, but
    // with the decimated points the long edges read as flat planes.
    let activeChain = chain;
    if (angularOutline && chain.length > 6) {
      const targetPts = Math.max(4, Math.min(10, Math.round(chain.length / 6)));
      const step = chain.length / targetPts;
      const reduced = [];
      for (let i = 0; i < targetPts; i++) {
        const idx = Math.min(chain.length - 1, Math.round(i * step));
        reduced.push(chain[idx]);
      }
      // Always keep last sample so the chain ends where it should.
      if (reduced[reduced.length - 1] !== chain[chain.length - 1]) reduced.push(chain[chain.length - 1]);
      activeChain = reduced;
    }
    let totalLen = 0;
    const segLens = [];
    for (let i = 0; i < activeChain.length - 1; i++) {
      const dx = activeChain[i + 1].x - activeChain[i].x;
      const dy = activeChain[i + 1].y - activeChain[i].y;
      const l = Math.sqrt(dx * dx + dy * dy);
      segLens.push(l);
      totalLen += l;
    }
    if (totalLen < 1.5) return;
    const taperLen = Math.min(totalLen * 0.18, halfW * 6);
    const stepSize = angularOutline ? Math.max(0.9, halfW * 0.6) : 0.7;
    // No wobble in angular mode (clean straight segments).
    const wobAmp = angularOutline ? 0 : Math.max(0, jitter) * (0.8 + lineFeel * 0.7);
    let traveled = 0;
    for (let i = 0; i < activeChain.length - 1; i++) {
      const p1 = activeChain[i], p2 = activeChain[i + 1];
      const segLen = segLens[i];
      if (segLen < 0.1) { traveled += segLen; continue; }
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const segAng = Math.atan2(dy, dx);
      const perpX = -Math.sin(segAng), perpY = Math.cos(segAng);
      const nSteps = Math.max(1, Math.ceil(segLen / stepSize));
      for (let s = 0; s < nSteps; s++) {
        const f = s / nSteps;
        const lt = traveled + segLen * f;
        let taper = 1;
        if (lt < taperLen) taper = lt / taperLen;
        else if (lt > totalLen - taperLen) taper = (totalLen - lt) / taperLen;
        taper = Math.max(0, Math.min(1, taper));
        // Two layered sines for organic wobble (not a clean sinewave).
        const phase = lt * 0.18 + (seed | 0) * 0.0017;
        const wob = wobAmp === 0 ? 0 : (Math.sin(phase) + Math.sin(phase * 1.7 + 0.4) * 0.42) * wobAmp;
        const cx = p1.x + dx * f + perpX * wob;
        const cy = p1.y + dy * f + perpY * wob;
        const ix = Math.max(0, Math.min(w - 1, Math.round(cx)));
        const iy = Math.max(0, Math.min(h - 1, Math.round(cy)));
        const src = px[iy * w + ix];
        const mark = _resolveSketchMark(src, strength, taper, colorMode);
        const dotR = Math.max(0.7, halfW * (0.55 + taper * 0.6));
        const opa = opacity * taper * (0.48 + strength * 0.52);
        _stampSketchDot(o, w, h, cx, cy, dotR, mark, opa, seed + (i & 31), jitter);
      }
      traveled += segLen;
    }
  }
  // Mark the area within `radius` of every polyline sample so subsequent
  // seeds in the same trace pass don't re-walk the same contour.
  function _suppressChain(visited, chain, radius, w, h) {
    const r2 = radius * radius;
    const ir = Math.max(1, Math.ceil(radius));
    for (let i = 0; i < chain.length; i++) {
      const cx = Math.round(chain[i].x), cy = Math.round(chain[i].y);
      for (let dy = -ir; dy <= ir; dy++) {
        const wy = cy + dy;
        if (wy < 0 || wy >= h) continue;
        for (let dx = -ir; dx <= ir; dx++) {
          const wx = cx + dx;
          if (wx < 0 || wx >= w) continue;
          if (dx * dx + dy * dy > r2) continue;
          visited[wy * w + wx] = 1;
        }
      }
    }
  }

  function paintConstructionSketch(o, px, w, h, edgeMag, edgeAng, detail, analysis, opts) {
    opts = opts || {};
    const strength = clamp01(opts.strength != null ? opts.strength : 0);
    if (strength <= 0.01 || !edgeMag || !edgeAng) return o;
    const seed = (opts.seed | 0) || 42;
    const style = opts.style || 'hybrid';
    const angular = opts.angularity != null ? clamp01(opts.angularity) : (style === 'angular' ? 1 : (style === 'form' ? 0 : 0.48));
    const detailFocus = Math.max(0, Math.min(1.5, opts.detailFocus != null ? opts.detailFocus : 0.85));
    const density = Math.max(0.15, opts.density != null ? opts.density : 1);
    const opacity = Math.max(0, Math.min(1.5, opts.opacity != null ? opts.opacity : 1));
    const jitter = Math.max(0, Math.min(1.5, opts.jitter != null ? opts.jitter : 0.5));
    const edgeFocus = Math.max(0, Math.min(1.5, opts.edgeFocus != null ? opts.edgeFocus : 0.75));
    const formBias = clamp01(opts.form != null ? opts.form : (style === 'form' ? 0.8 : 0.28));
    const structure = Math.max(0, Math.min(1.5, opts.structure != null ? opts.structure : 0.8));
    const lineScale = Math.max(0.5, opts.lineScale || 1);

    // ── User-facing options ──
    const scope = opts.scope || 'both';
    const colorMode = opts.colorMode || 'auto';
    const angularOutline = !!opts.angularOutline;
    // detailLevel ∈ [0.1..1] — low = few long bold chains (loose sketch),
    // high = many short fine chains (tight sketch).
    const detailLevel = Math.max(0.05, Math.min(1.5, opts.detailLevel != null ? opts.detailLevel : 0.5));
    // Per-pass density multipliers based on scope. Pass 1 = edge contours
    // (silhouettes), Pass 2 = tonal mass boundaries (form lines).
    let pass1Mul = 1, pass2Mul = 1;
    if (scope === 'external')      { pass1Mul = 1.0; pass2Mul = 0.0; }
    else if (scope === 'internal') { pass1Mul = 0.0; pass2Mul = 1.0; }
    else if (scope === 'outline-bias') { pass1Mul = 1.0; pass2Mul = 0.35; }
    else if (scope === 'form-bias')    { pass1Mul = 0.35; pass2Mul = 1.0; }

    // detailLevel reshapes: spacing density / threshold / chain length /
    // chain count. Low detail → bigger spacing, higher threshold, longer
    // chains, fewer of them. High detail → smaller spacing, lower
    // threshold, shorter chains, many more of them.
    const detailSpacingMul = 1.5 - detailLevel * 0.95;          // 0.1→1.4 ... 1.0→0.55
    const detailThreshMul  = 1.55 - detailLevel * 1.20;         // 0.1→1.43 ... 1.0→0.35
    const detailLenMul     = 1.45 - detailLevel * 0.78;         // 0.1→1.37 ... 1.0→0.67
    const detailCountMul   = 0.55 + detailLevel * 1.25;         // 0.1→0.68 ... 1.0→1.80

    const spacing = Math.max(3, Math.round((opts.spacing || 10) * detailSpacingMul / ((0.8 + strength * 0.55) * Math.sqrt(density))));
    const baseLen = Math.max(5, opts.length || 22);
    const baseWidth = Math.max(0.6, opts.width || 1.1);
    const eNorm = 1 / Math.max(16, _advFieldStats(edgeMag) * 0.55);
    const fields = analysis && analysis.fields ? analysis.fields : null;
    const gray = fields && fields.gray ? fields.gray.value : px;

    // Style → line feel knob: 'angular' keeps strokes straighter (less
    // wobble, longer chains); 'form' lets them curve more; 'hybrid' splits.
    // angularOutline overrides toward fully straight regardless of style.
    const lineFeel = angularOutline
      ? 0.1
      : (style === 'form' ? 1.0 : (style === 'angular' ? 0.45 : 0.78));
    const halfW = baseWidth * (0.55 + strength * 0.85) * Math.sqrt(0.7 + structure * 0.4);
    const maxChainLen = Math.max(24, baseLen * lineScale * (2.8 + structure * 0.9 + strength * 0.6) * detailLenMul);
    // Hoisted so both passes can use the shared seed grid + suppression
    // radius. (Previously these only existed inside pass 1.)
    const suppressR = Math.max(2, Math.round(spacing * (0.55 + (1 - lineFeel) * 0.25)));
    const seedStride = Math.max(2, Math.round(spacing * 0.45));

    // ── PASS 1: Edge contour chains (silhouette / outline) ──
    if (pass1Mul > 0.01) {
    const visited = new Uint8Array(w * h);
    const minSeedMag = Math.max(0.10, (0.34 - strength * 0.18 - edgeFocus * 0.04) * detailThreshMul);

    const seeds = [];
    for (let y = seedStride; y < h - seedStride; y += seedStride) {
      for (let x = seedStride; x < w - seedStride; x += seedStride) {
        const i = y * w + x;
        const e = edgeMag[i] * eNorm;
        if (e < minSeedMag) continue;
        // Tiny hash jitter so adjacent runs don't sit on a perfect grid.
        const jx = Math.round((_advHash01(seed, x, y, 5101) - 0.5) * seedStride * jitter * 0.6);
        const jy = Math.round((_advHash01(seed, x, y, 5102) - 0.5) * seedStride * jitter * 0.6);
        const sx = Math.max(1, Math.min(w - 2, x + jx));
        const sy = Math.max(1, Math.min(h - 2, y + jy));
        const si = sy * w + sx;
        const se = edgeMag[si] * eNorm;
        if (se < minSeedMag * 0.85) continue;
        seeds.push({ x: sx, y: sy, e: se, i: si });
      }
    }
    seeds.sort((a, b) => b.e - a.e);
    const maxChains = Math.max(8, Math.floor(seeds.length * Math.min(1.4, strength * density * 0.85) * detailCountMul * pass1Mul));

    const chainOpts = {
      maxLen: maxChainLen,
      stepSize: 1.3,
      minMag: Math.max(0.06, (0.16 - strength * 0.05) * detailThreshMul),
      lookAhead: 2 + (lineFeel > 0.7 ? 1 : 0)
    };
    let chainsDrawn = 0;
    for (let si = 0; si < seeds.length && chainsDrawn < maxChains; si++) {
      const s = seeds[si];
      if (visited[s.i]) continue;
      const chain = _traceContourChain(s.x, s.y, edgeMag, edgeAng, eNorm, w, h, chainOpts);
      if (chain.length < 4) continue;
      _suppressChain(visited, chain, suppressR, w, h);
      _renderSketchChain(o, px, w, h, chain, halfW, strength, opacity * (0.65 + edgeFocus * 0.20), jitter, seed ^ (si * 0x9e37 | 0), lineFeel, colorMode, angularOutline);
      chainsDrawn++;
      // Occasional cross-hatch tick when the artist commits a corner —
      // a short perpendicular flick at the chain's midpoint when the
      // local style favors angular construction. Skipped under angular-
      // outline mode (we already get that geometric energy from the
      // decimated polyline).
      if (!angularOutline && angular > 0.55 && chain.length > 6 && _advHash01(seed, s.x, s.y, 5181) < 0.32 + strength * 0.18) {
        const mid = chain[(chain.length / 2) | 0];
        const tickAng = mid.ang + Math.PI * 0.5 * (_advHash01(seed, s.x, s.y, 5182) < 0.5 ? -1 : 1);
        const tickLen = baseLen * lineScale * (0.32 + strength * 0.28);
        const ix = (mid.y | 0) * w + (mid.x | 0);
        const tickMark = _resolveSketchMark(px[ix], strength, 0.7, colorMode);
        paintSketchLine(o, w, h, mid.x, mid.y, tickAng, tickLen, halfW * 0.85, tickMark, Math.min(0.85, opacity * 0.55), seed, 5183);
      }
    }
    }  // end pass 1

    // ── PASS 2: Tonal mass-boundary chains (interior form lines) ──
    if (pass2Mul > 0.01 && gray && structure > 0.05) {
      const massBlock = Math.max(3, Math.round(spacing * 0.85));
      const grayMag = new Float32Array(w * h);
      const grayAng = new Float32Array(w * h);
      for (let y = massBlock; y < h - massBlock; y++) {
        const yr = y * w;
        for (let x = massBlock; x < w - massBlock; x++) {
          const gxv = gray[yr + (x + massBlock)] - gray[yr + (x - massBlock)];
          const gyv = gray[(y + massBlock) * w + x] - gray[(y - massBlock) * w + x];
          grayMag[yr + x] = Math.sqrt(gxv * gxv + gyv * gyv);
          grayAng[yr + x] = Math.atan2(gyv, gxv);
        }
      }
      const gNorm = 1 / Math.max(16, _advFieldStats(grayMag) * 0.55);
      const massStride = Math.max(3, Math.round(seedStride * 2 * detailSpacingMul));
      const massMinMag = Math.max(0.16, (0.36 - strength * 0.10) * detailThreshMul);
      const massSeeds = [];
      for (let y = massStride; y < h - massStride; y += massStride) {
        for (let x = massStride; x < w - massStride; x += massStride) {
          const i = y * w + x;
          const m = grayMag[i] * gNorm;
          if (m < massMinMag) continue;
          massSeeds.push({ x, y, m, i });
        }
      }
      massSeeds.sort((a, b) => b.m - a.m);
      const maxMassChains = Math.max(4, Math.floor(massSeeds.length * Math.min(1, strength * structure * 0.75) * detailCountMul * pass2Mul));
      const massVisited = new Uint8Array(w * h);
      const massSuppressR = Math.max(3, Math.round(suppressR * 1.45));
      const massHalfW = halfW * (1.05 + structure * 0.45);
      const massChainOpts = {
        maxLen: maxChainLen * 1.55,
        stepSize: 1.7,
        minMag: Math.max(0.10, massMinMag * 0.55),
        lookAhead: 3
      };
      let massDrawn = 0;
      for (let si = 0; si < massSeeds.length && massDrawn < maxMassChains; si++) {
        const s = massSeeds[si];
        if (massVisited[s.i]) continue;
        const chain = _traceContourChain(s.x, s.y, grayMag, grayAng, gNorm, w, h, massChainOpts);
        if (chain.length < 6) continue;
        _suppressChain(massVisited, chain, massSuppressR, w, h);
        _renderSketchChain(
          o, px, w, h, chain, massHalfW,
          strength * (0.85 + formBias * 0.25),
          opacity * (0.78 + formBias * 0.22),
          jitter * (1 + formBias * 0.4),
          seed ^ 0x9e37 ^ (si * 0x4cf | 0),
          Math.min(1.2, lineFeel + 0.18),
          colorMode,
          angularOutline
        );
        massDrawn++;
      }
    }
    return o;
  }

  function paintIntelligentColorJitter(o, px, w, h, analysis, edgeMag, edgeAng, detail, opts) {
    opts = opts || {};
    const strength = clamp01(opts.strength != null ? opts.strength : 0);
    if (strength <= 0.01) return o;
    const seed = (opts.seed | 0) || 42;
    const channelHint = opts.channelHint || 'gray';
    const density = Math.max(0.15, opts.density != null ? opts.density : 1);
    const opacity = Math.max(0, Math.min(1.5, opts.opacity != null ? opts.opacity : 1));
    const jitter = Math.max(0, Math.min(1.5, opts.jitter != null ? opts.jitter : 0.5));
    const detailFocus = Math.max(0, Math.min(1.5, opts.detailFocus != null ? opts.detailFocus : 0.75));
    const edgeFocus = Math.max(0, Math.min(1.5, opts.edgeFocus != null ? opts.edgeFocus : 0.35));
    const formBias = clamp01(opts.form != null ? opts.form : 0.35);
    const fields = analysis && analysis.fields ? analysis.fields : null;
    const gray = fields && fields.gray ? fields.gray : null;
    const active = fields && fields[channelHint] ? fields[channelHint] : gray;
    const sat = fields && fields.saturation ? fields.saturation.value : null;
    const detailFieldRef = detail || (gray && gray.detail);
    const edgeRef = edgeMag || (gray && gray.edgeMag);
    const edgeAngleRef = edgeAng || (gray && gray.edgeAng);
    const dNorm = detailFieldRef ? 1 / Math.max(8, _advFieldStats(detailFieldRef) * 0.55) : 0;
    const eNorm = edgeRef ? 1 / Math.max(16, _advFieldStats(edgeRef) * 0.55) : 0;
    const spacing = Math.max(2, Math.round((opts.spacing || 7) * (1 - strength * 0.38) / Math.sqrt(density * (1 + strength * 0.45))));
    const baseLen = Math.max(2, opts.length || 7);
    const baseWidth = Math.max(0.6, opts.width || 1.4);
    for (let gy = 1; gy < h - 1; gy += spacing) {
      const y = Math.max(1, Math.min(h - 2, gy + Math.round((_advHash01(seed, gy, spacing, 1031) - 0.5) * spacing * (0.45 + jitter * 0.7))));
      for (let gx = 1; gx < w - 1; gx += spacing) {
        const x = Math.max(1, Math.min(w - 2, gx + Math.round((_advHash01(seed, gx, y, 1032) - 0.5) * spacing * (0.45 + jitter * 0.7))));
        const idx = y * w + x;
        const sat01 = sat ? clamp01(sat[idx] / 255) : 0;
        const detail01 = detailFieldRef ? shapeDetailSignal(detailFieldRef[idx] * dNorm, Math.min(1, strength * (0.65 + detailFocus * 0.35))) : 0;
        const edge01 = edgeRef ? clamp01(edgeRef[idx] * eNorm) : 0;
        const importance = clamp01(Math.max(
          sat01 * 0.58 + detail01 * (0.30 + detailFocus * 0.16) + edge01 * (0.22 + edgeFocus * 0.14),
          detail01 * (0.44 + detailFocus * 0.22) + edge01 * (0.32 + edgeFocus * 0.16)
        ));
        if (importance < 0.025) continue;
        if (_advHash01(seed, x, y, 1033) > Math.min(1, strength * density * (0.40 + importance * 1.28))) continue;
        const activeV = active && active.value ? active.value[idx] : px[idx];
        const grayV = gray && gray.value ? gray.value[idx] : px[idx];
        const chroma = activeV - grayV;
        const noise = (_advHash01(seed, x, y, 1034) - 0.5) * 2;
        const delta = chroma * (0.34 + sat01 * 0.52) * strength + noise * 142 * strength * (0.30 + importance * 0.86) * (0.55 + jitter * 0.82);
        const noteV = clamp(px[idx] + delta);
        let ang = painterDirectionAngle(seed ^ 0x7c1, x, y, idx, edgeRef, edgeAngleRef, eNorm, {
          cell: Math.max(6, spacing * 2.2),
          formFollow: formBias,
          edgeFocus,
          angularity: opts.angularity || 0,
          jitter,
          divisions: 16
        });
        ang += (_advHash01(seed, x, y, 1036) - 0.5) * Math.PI * (0.22 + strength * 0.42 + jitter * 0.56);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const len = baseLen * (0.65 + importance * 1.45);
        const halfLen = len * 0.5;
        const halfW = baseWidth * (0.7 + importance * 0.8);
        for (let t = -halfLen; t <= halfLen; t += 1) {
          const taper = 1 - Math.abs(t) / Math.max(1, halfLen);
          for (let ww = -halfW; ww <= halfW; ww += 1) {
            const wx = Math.round(x + ca * t - sa * ww);
            const wy = Math.round(y + sa * t + ca * ww);
            if (wx < 0 || wx >= w || wy < 0 || wy >= h) continue;
            const cross = 1 - Math.abs(ww) / Math.max(1, halfW);
            const prob = taper * cross * (0.34 + strength * 0.50);
            if (_advHash01(seed, wx, wy, 1037 + (t | 0)) > prob) continue;
            const oi = wy * w + wx;
            const a = Math.min(0.98, (0.22 + strength * 0.58 + importance * 0.30) * opacity);
            o[oi] = Math.round(noteV * a + o[oi] * (1 - a));
          }
        }
      }
    }
    return o;
  }

  function finishPainterEdges(o, px, w, h, edgeMag, edgeAng, detail, seed, amount, opts) {
    opts = opts || {};
    const amt = Math.max(-1, Math.min(1, amount || 0));
    if (Math.abs(amt) <= 0.01 || !edgeMag) return o;
    const scale = Math.max(0.25, opts.scale != null ? opts.scale : 1);
    const density = Math.max(0.15, opts.density != null ? opts.density : 1);
    const opacity = Math.max(0, Math.min(1.5, opts.opacity != null ? opts.opacity : 1));
    const edgeFocus = Math.max(0, Math.min(1.5, opts.edge != null ? opts.edge : 0.7));
    const detailFocus = Math.max(0, Math.min(1.5, opts.detail != null ? opts.detail : 0.8));
    const angularity = clamp01(opts.angularity != null ? opts.angularity : 0.25);
    if (amt > 0) {
      const sh = (a, b, k) => _advHash01(seed || 1, a, b, k);
      return paintStructuralEdgeStrokes(o, px, w, h, edgeMag, edgeAng, detail, sh, {
        strength: Math.min(1, amt * 0.95 * opacity * (0.82 + edgeFocus * 0.18)),
        detailDrive: Math.min(1, 0.55 + detailFocus * 0.35),
        angularity,
        length: (12 + amt * 16) * scale,
        width: (0.8 + amt * 1.2) * Math.sqrt(scale),
        spacing: Math.max(2, 5 / Math.sqrt(density * (0.8 + edgeFocus * 0.35))),
        seed: (seed || 1) ^ 0x6e5
      });
    }
    const soft = -amt * opacity;
    const tmp = new Uint8ClampedArray(o);
    const eNorm = 1 / Math.max(16, _advFieldStats(edgeMag) * 0.55);
    const radius = Math.max(1, Math.round(soft * 3 * scale));
    for (let y = 1; y < h - 1; y++) {
      const yr = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = yr + x;
        const edge01 = clamp01(edgeMag[idx] * eNorm);
        if (edge01 < 0.16) continue;
        if (_advHash01(seed || 1, x, y, 1061) > soft * (0.24 + edge01 * 0.76)) continue;
        const ang = (edgeAng ? edgeAng[idx] : 0) + Math.PI * 0.5;
        const dx = Math.round(Math.cos(ang) * radius * (_advHash01(seed || 1, x, y, 1062) < 0.5 ? -1 : 1));
        const dy = Math.round(Math.sin(ang) * radius * (_advHash01(seed || 1, x, y, 1063) < 0.5 ? -1 : 1));
        const nx = Math.max(0, Math.min(w - 1, x + dx));
        const ny = Math.max(0, Math.min(h - 1, y + dy));
        const a = Math.min(0.65, soft * (0.25 + edge01 * 0.45));
        o[idx] = Math.round(tmp[idx] * (1 - a) + tmp[ny * w + nx] * a);
      }
    }
    return o;
  }

  function paintBroadMassStrokes(o, px, w, h, edgeMag, edgeAng, detail, analysis, sh, opts) {
    opts = opts || {};
    const strength = Math.max(0, Math.min(1.5, opts.strength != null ? opts.strength : 0));
    if (strength <= 0.01) return o;
    const seed = (opts.seed | 0) || 42;
    const baseSize = Math.max(4, opts.size || 16);
    const detailDrive = clamp01(opts.detailDrive != null ? opts.detailDrive : 0.5);
    const formFollow = Math.max(-1, Math.min(1, opts.formFollow || 0));
    const angularity = clamp01(opts.angularity != null ? opts.angularity : Math.max(0.25, -formFollow));
    const density = Math.max(0.15, opts.density != null ? opts.density : 1);
    const opacity = Math.max(0, Math.min(1.5, opts.opacity != null ? opts.opacity : 1));
    const jitter = Math.max(0, Math.min(1.5, opts.jitter != null ? opts.jitter : 0.35));
    const edgeFocus = Math.max(0, Math.min(1.5, opts.edgeFocus != null ? opts.edgeFocus : 0.45));
    const detailFocus = Math.max(0, Math.min(1.5, opts.detailFocus != null ? opts.detailFocus : 0.55));
    const spacing = Math.max(3, Math.round(baseSize * (0.78 - Math.min(0.28, strength * 0.12)) / Math.sqrt(density)));
    const eNorm = edgeMag ? 1 / Math.max(16, _advFieldStats(edgeMag) * 0.6) : 0;
    const dNorm = detail ? 1 / Math.max(8, _advFieldStats(detail) * 0.6) : 0;
    const fields = analysis && analysis.fields ? analysis.fields : null;
    const valueField = fields && fields.value ? fields.value.value : px;
    const satField = fields && fields.saturation ? fields.saturation.value : null;
    for (let gy = 0; gy < h; gy += spacing) {
      for (let gx = 0; gx < w; gx += spacing) {
        const x = Math.max(0, Math.min(w - 1, Math.round(gx + (_advHash01(seed, gx, gy, 1082) - 0.5) * spacing * (0.45 + jitter * 0.95))));
        const y = Math.max(0, Math.min(h - 1, Math.round(gy + (_advHash01(seed, gx, gy, 1083) - 0.5) * spacing * (0.45 + jitter * 0.95))));
        const idx = y * w + x;
        const edge01 = edgeMag ? clamp01(edgeMag[idx] * eNorm) : 0;
        const detail01 = detail ? shapeDetailSignal(detail[idx] * dNorm, Math.min(1, detailDrive * (0.70 + detailFocus * 0.35))) : 0;
        const sat01 = satField ? clamp01(satField[idx] / 255) : 0;
        const subjectCue = clamp01(edge01 * (0.44 + edgeFocus * 0.16) + detail01 * (0.22 + detailFocus * 0.13) + sat01 * 0.15);
        const keep = Math.min(1, 0.38 + strength * 0.42 + subjectCue * 0.28);
        if (sh(x, y, 1084) > keep) continue;
        const isSubject = subjectCue > 0.22;
        const fieldCell = baseSize * (isSubject ? 1.15 : 1.95);
        let ang = painterDirectionAngle(seed ^ 0x4b9, x, y, idx, edgeMag, edgeAng, eNorm, {
          cell: fieldCell,
          formFollow: Math.max(0, formFollow) * 0.55 + (opts.form != null ? opts.form : 0.3) * 0.45,
          edgeFocus,
          angularity,
          jitter,
          divisions: 8 + Math.round((1 - angularity) * 8)
        });
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const massSize = baseSize * (isSubject ? (1.15 - detail01 * 0.35) : 1.55);
        const halfLen = massSize * (1.15 + strength * 0.60 + (1 - detail01) * 0.35);
        const halfW = Math.max(1, massSize * (0.28 + strength * 0.11));
        const valueShift = valueField ? (valueField[idx] - px[idx]) * 0.08 : 0;
        const src = clamp(px[idx] + valueShift + (sh(x, y, 1085) - 0.5) * 34 * strength * (0.28 + sat01 + jitter * 0.35));
        const box = Math.ceil(Math.max(halfLen, halfW)) + 1;
        for (let yy = Math.max(0, y - box); yy <= Math.min(h - 1, y + box); yy++) {
          for (let xx = Math.max(0, x - box); xx <= Math.min(w - 1, x + box); xx++) {
            const dx = xx - x, dy = yy - y;
            const lx = dx * ca + dy * sa;
            const ly = -dx * sa + dy * ca;
            const r2 = (lx * lx) / (halfLen * halfLen) + (ly * ly) / (halfW * halfW);
            if (r2 > 1) continue;
            const taper = 1 - r2;
            const prob = taper * Math.min(1, 0.42 + strength * 0.44);
            if (sh(xx, yy, 1086 + ((lx | 0) & 7)) > prob) continue;
            const oi = yy * w + xx;
            const a = Math.min(0.95, (0.34 + strength * 0.42 + (isSubject ? 0.10 : 0)) * opacity);
            o[oi] = Math.round(src * a + o[oi] * (1 - a));
          }
        }
      }
    }
    return o;
  }

  // ── Detail Jitter post-pass (illusion mode) ──
  // Simulates micro-detail by adding deterministic noise scaled by the local
  // detail field. Busy regions get more jitter; flat areas stay clean. Runs
  // per-channel, so independently-jittered R/G/B produces chromatic grain
  // that reads as extra "texture" the source didn't actually have.
  function detailJitterPass(o, detail, w, h, strength, seed) {
    if (!detail || !(strength > 0)) return o;
    let dMax = 1;
    const stride = Math.max(1, ((w * h) / 2048) | 0);
    for (let i = 0; i < detail.length; i += stride) if (detail[i] > dMax) dMax = detail[i];
    const dNorm = 1 / Math.max(8, dMax * 0.6);
    const amp = strength * 80;  // ±80 at full strength in busy zones
    const S = (seed|0) || 42;
    for (let i = 0; i < o.length; i++) {
      const d01 = Math.min(1, detail[i] * dNorm);
      // Deterministic per-pixel hash → [-1, 1].
      let hh = Math.imul(i + 374761393, 0x9E3779B1) ^ S;
      hh = Math.imul(hh ^ (hh >>> 15), 0x85EBCA77);
      hh = Math.imul(hh ^ (hh >>> 13), 0xC2B2AE3D);
      const r = ((hh ^ (hh >>> 16)) >>> 0) / 4294967296 - 0.5;
      const v = o[i] + r * 2 * amp * d01;
      o[i] = v < 0 ? 0 : (v > 255 ? 255 : Math.round(v));
    }
    return o;
  }

  function colorJitterDetailPass(o, analysis, w, h, strength, channelHint, seed) {
    if (!analysis || !analysis.fields || !(strength > 0)) return o;
    const fieldGray = analysis.fields.gray;
    const fieldSat = analysis.fields.saturation || fieldGray;
    const fieldDetail = analysis.fields.detail || fieldGray;
    const active = analysis.fields[channelHint] || fieldGray;
    for (let i = 0; i < o.length; i++) {
      const satN = fieldSat.value[i] / 255;
      const detN = fieldDetail.value[i] / 255;
      if (satN < 0.02 && detN < 0.05) continue;
      const chroma = active.value[i] - fieldGray.value[i];
      const noise = (_advHash01(seed, i, active.value[i] | 0, 930) - 0.5) * 2;
      const delta = chroma * strength * 0.35 + noise * 42 * strength * satN * (0.35 + detN * 0.65);
      o[i] = clamp(o[i] + delta);
    }
    return o;
  }

  // ── If/Then RULES ENGINE ──
  // A post-pass that walks every pixel and applies user-defined rules shaped
  // as "if <SUBJECT> is <STATE> → <VERB> [MODIFIER]". The two-dropdown pair
  // on each side keeps the mental model clean — users first pick the domain
  // (edge/tone/detail), then the predicate within that domain (hard/soft,
  // dark/light/mid/near, busy/moderate/flat).
  //
  // Single-channel pipeline: dither.js runs algorithms on each R/G/B channel
  // separately, so rules here compare per-channel values. Color pickers in
  // the UI are converted to luminance (Y = 0.299R + 0.587G + 0.114B) and
  // that luma is what tone-near / paint-with-color / blend-with-color use —
  // gives a reasonable approximation of "this pixel is near that color"
  // across all three channel passes without tripping over per-channel
  // mismatches.
  //
  // Two-dropdown schema: if [SUBJECT] is [STATE] → then [ACTION] [MODIFIER].
  //
  // Conditions (subject → state):
  //   edge    → hard | soft                    (thr: edgeThresh 0..1)
  //   tone    → dark | light | mid | near      (thr: toneThresh 0..255 ; near uses toneTarget + toneTol)
  //   detail  → busy | moderate | flat         (thr: detailThresh 0..1)
  //
  // Actions (paint-engine flavored):
  //   blend  with:  source | color | black | white     (amount)
  //   smudge toward: random | edge-along | edge-across (amount, radius)
  //   paint  color                                      (amount — uses modColor)
  //   bleed  along-edge                                 (amount, radius — directional smear)
  //   invert | boost | darken | lighten | posterize     (amount [+ levels])
  function applyRules(o, px, w, h, rules, edgeMag, edgeAng, detail, sh) {
    if (!Array.isArray(rules) || rules.length === 0) return o;
    const active = [];
    for (const r of rules) {
      if (!r || r.enabled === false) continue;
      if (!r.when || !r.then) continue;
      active.push(r);
    }
    if (active.length === 0) return o;

    // Normalize detail field to 0..1 (same treatment as painterlyUnderpaint).
    let dNorm = 1;
    if (detail) {
      let dMax = 1;
      const stride = Math.max(1, ((w * h) / 2048) | 0);
      for (let i = 0; i < detail.length; i += stride) if (detail[i] > dMax) dMax = detail[i];
      dNorm = 1 / Math.max(8, dMax * 0.6);
    }

    // Snapshot for smudge/bleed (needs untouched neighbors; otherwise the op
    // would compound with itself as we sweep the buffer).
    let snap = null;
    for (const r of active) {
      if (r.then === 'smudge' || r.then === 'bleed') { snap = new Uint8ClampedArray(o); break; }
    }

    for (let y = 0; y < h; y++) {
      const yr = y * w;
      const ey = Math.min(h - 2, Math.max(1, y));
      for (let x = 0; x < w; x++) {
        const i = yr + x;
        const ex = Math.min(w - 2, Math.max(1, x));
        const eIdx = ey * w + ex;
        const em = edgeMag ? edgeMag[eIdx] / 120 : 0;    // 0..~1
        const eA = edgeAng ? edgeAng[eIdx] : 0;
        const d01 = detail ? Math.min(1, detail[i] * dNorm) : 0;

        for (let ri = 0; ri < active.length; ri++) {
          const r = active[ri];
          // ── Condition: subject + state ──
          let ok = false;
          switch (r.when) {
            case 'edge': {
              const thr = (r.edgeThresh != null) ? r.edgeThresh : 0.3;
              ok = (r.state === 'soft') ? (em < thr) : (em >= thr);
              break;
            }
            case 'tone': {
              const v0 = o[i];
              const st = r.state || 'mid';
              if (st === 'near') {
                const tgt = (r.toneTarget != null) ? r.toneTarget : 128;
                const tol = (r.toneTol    != null) ? r.toneTol    : 40;
                ok = Math.abs(v0 - tgt) <= tol;
              } else if (st === 'dark') {
                const thr = (r.toneThresh != null) ? r.toneThresh : 96;
                ok = v0 <= thr;
              } else if (st === 'light') {
                const thr = (r.toneThresh != null) ? r.toneThresh : 160;
                ok = v0 >= thr;
              } else { // mid
                const thr = (r.toneThresh != null) ? r.toneThresh : 128;
                const tol = (r.toneTol != null) ? r.toneTol : 40;
                ok = Math.abs(v0 - thr) <= tol;
              }
              break;
            }
            case 'detail': {
              const thr = (r.detailThresh != null) ? r.detailThresh : 0.35;
              const st = r.state || 'busy';
              if (st === 'busy') ok = d01 >= thr;
              else if (st === 'flat') ok = d01 <= thr;
              else { // moderate — within a band around thr
                ok = Math.abs(d01 - thr) <= 0.15;
              }
              break;
            }
            default: ok = false;
          }
          if (!ok) continue;

          // ── Action: verb + modifier ──
          const amt = (r.amount != null) ? r.amount : 0.5;
          const v = o[i];
          let nv = v;
          switch (r.then) {
            case 'blend': {
              const m = r.modifier || 'source';
              let tgt = px[i];
              if (m === 'color')      tgt = (r.modColorLuma != null) ? r.modColorLuma : 128;
              else if (m === 'black') tgt = 0;
              else if (m === 'white') tgt = 255;
              nv = Math.round(v * (1 - amt) + tgt * amt);
              break;
            }
            case 'paint': {
              const tgt = (r.modColorLuma != null) ? r.modColorLuma : 128;
              nv = Math.round(v * (1 - amt) + tgt * amt);
              break;
            }
            case 'smudge': {
              const radius = Math.max(1, Math.round((r.radius != null ? r.radius : 2)));
              const m = r.modifier || 'random';
              let jx, jy;
              if (m === 'edge-along') {
                // Walk along the edge tangent (perpendicular to gradient).
                const t = (sh(x, y, 401) - 0.5) * 2 * radius;
                jx = Math.round(Math.cos(eA + Math.PI * 0.5) * t);
                jy = Math.round(Math.sin(eA + Math.PI * 0.5) * t);
              } else if (m === 'edge-across') {
                // Across the edge (along gradient).
                const t = (sh(x, y, 401) - 0.5) * 2 * radius;
                jx = Math.round(Math.cos(eA) * t);
                jy = Math.round(Math.sin(eA) * t);
              } else {
                jx = Math.round((sh(x, y, 401) - 0.5) * 2 * radius);
                jy = Math.round((sh(x, y, 402) - 0.5) * 2 * radius);
              }
              const nx = Math.max(0, Math.min(w - 1, x + jx));
              const ny = Math.max(0, Math.min(h - 1, y + jy));
              const nVal = snap[ny * w + nx];
              nv = Math.round(v * (1 - amt) + nVal * amt);
              break;
            }
            case 'bleed': {
              // Directional pull along the edge tangent — a paint-engine wet-bleed.
              const radius = Math.max(1, Math.round((r.radius != null ? r.radius : 3)));
              const t = sh(x, y, 403) * radius;  // 0..radius (single-sided pull)
              const jx = Math.round(Math.cos(eA + Math.PI * 0.5) * t);
              const jy = Math.round(Math.sin(eA + Math.PI * 0.5) * t);
              const nx = Math.max(0, Math.min(w - 1, x + jx));
              const ny = Math.max(0, Math.min(h - 1, y + jy));
              const nVal = snap[ny * w + nx];
              nv = Math.round(v * (1 - amt) + nVal * amt);
              break;
            }
            case 'invert':
              nv = 255 - v;
              if (amt < 1) nv = Math.round(v * (1 - amt) + nv * amt);
              break;
            case 'boost': {
              const k = 1 + amt * 1.5;
              const shifted = 128 + (v - 128) * k;
              nv = shifted < 0 ? 0 : (shifted > 255 ? 255 : Math.round(shifted));
              break;
            }
            case 'posterize': {
              const lvl = Math.max(2, Math.min(16, r.levels != null ? r.levels : 4));
              const step = 255 / (lvl - 1);
              const q = Math.round(v / step) * step;
              nv = q < 0 ? 0 : (q > 255 ? 255 : Math.round(q));
              if (amt < 1) nv = Math.round(v * (1 - amt) + nv * amt);
              break;
            }
            case 'darken': {
              const s = v - amt * 80;
              nv = s < 0 ? 0 : Math.round(s);
              break;
            }
            case 'lighten': {
              const s = v + amt * 80;
              nv = s > 255 ? 255 : Math.round(s);
              break;
            }
          }
          o[i] = nv;
        }
      }
    }
    return o;
  }

  const A = [];

  function addED(id, name, matrix, cat='classic') {
    A.push({ id, name, category: cat, params: [
      { id:'strength', label:'Diffusion', min:0, max:1, step:.01, default:1 },
      { id:'serpentine', label:'Serpentine', type:'checkbox', default: id==='floyd-steinberg' },
      { id:'threshold', label:'Threshold', min:0, max:255, step:1, default:128 },
      { id:'noise', label:'Noise', min:0, max:100, step:1, default:0 },
      { id:'errorScale', label:'Error Scale', min:.1, max:3, step:.05, default:1 },
      { id:'gamma', label:'Gamma', min:.2, max:3, step:.05, default:1 },
      { id:'seed', label:'Seed', min:1, max:999, step:1, default:42 }
    ], apply(px,w,h,p) { return errorDiffusion(px,w,h,matrix,p.strength,p.serpentine,p.threshold,p.noise,p.errorScale,p.seed,p.gamma); }});
  }

  // ═══════════════════════════════════════════
  // CLASSIC ERROR DIFFUSION (10)
  // ═══════════════════════════════════════════
  addED('floyd-steinberg','Floyd-Steinberg',[[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]]);
  addED('atkinson','Atkinson',(()=>{ const f=1/8; return [[1,0,f],[2,0,f],[-1,1,f],[0,1,f],[1,1,f],[0,2,f]]; })());
  addED('jarvis','Jarvis-Judice-Ninke',(()=>{ const d=48; return [[1,0,7/d],[2,0,5/d],[-2,1,3/d],[-1,1,5/d],[0,1,7/d],[1,1,5/d],[2,1,3/d],[-2,2,1/d],[-1,2,3/d],[0,2,5/d],[1,2,3/d],[2,2,1/d]]; })());
  addED('stucki','Stucki',(()=>{ const d=42; return [[1,0,8/d],[2,0,4/d],[-2,1,2/d],[-1,1,4/d],[0,1,8/d],[1,1,4/d],[2,1,2/d],[-2,2,1/d],[-1,2,2/d],[0,2,4/d],[1,2,2/d],[2,2,1/d]]; })());
  addED('burkes','Burkes',(()=>{ const d=32; return [[1,0,8/d],[2,0,4/d],[-2,1,2/d],[-1,1,4/d],[0,1,8/d],[1,1,4/d],[2,1,2/d]]; })());
  addED('sierra','Sierra',(()=>{ const d=32; return [[1,0,5/d],[2,0,3/d],[-2,1,2/d],[-1,1,4/d],[0,1,5/d],[1,1,4/d],[2,1,2/d],[-1,2,2/d],[0,2,3/d],[1,2,2/d]]; })());
  addED('sierra-lite','Sierra Lite',[[1,0,.5],[-1,1,.25],[0,1,.25]]);
  addED('stevenson-arce','Stevenson-Arce',(()=>{ const d=200; return [[2,0,32/d],[-3,1,12/d],[-1,1,26/d],[1,1,30/d],[3,1,16/d],[-2,2,12/d],[0,2,26/d],[2,2,12/d],[-3,3,5/d],[-1,3,12/d],[1,3,12/d],[3,3,5/d]]; })());
  addED('fan','Zhigang Fan',[[1,0,7/16],[2,0,1/16],[-1,1,3/16],[0,1,5/16]]);
  addED('shiau-fan','Shiau-Fan',[[1,0,4/8],[-3,1,1/8],[-1,1,1/8],[0,1,2/8]]);

  // ═══════════════════════════════════════════
  // ORDERED & PATTERN (12)
  // ═══════════════════════════════════════════
  A.push({ id:'ordered', name:'Ordered (Bayer)', category:'ordered', params:[
    {id:'size',label:'Matrix',type:'select',options:[{value:2,label:'2x2'},{value:4,label:'4x4'},{value:8,label:'8x8'},{value:16,label:'16x16'},{value:32,label:'32x32'},{value:64,label:'64x64'}],default:4},
    {id:'spread',label:'Spread',min:0,max:255,step:1,default:128},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'noise',label:'Noise',min:0,max:80,step:1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const sz=+p.size, b=normBayer(sz), sp=p.spread, o=new Uint8ClampedArray(w*h);
    const ang=p.rotation*Math.PI/180, cosA=Math.cos(ang), sinA=Math.sin(ang);
    const r=p.noise>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const i=y*w+x;
      const rx=Math.round(x*cosA+y*sinA), ry=Math.round(-x*sinA+y*cosA);
      const bx=((rx%sz)+sz)%sz, by=((ry%sz)+sz)%sz;
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      v+=(b[by][bx]-.5)*sp;
      if(r) v+=(r()-.5)*p.noise;
      const result=v>p.threshold?255:0;
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'clustered-dot', name:'Clustered Dot', category:'ordered', params:[
    {id:'size',label:'Cluster Size',min:3,max:12,step:1,default:6},
    {id:'spread',label:'Spread',min:0,max:255,step:1,default:128},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const sz=p.size, o=new Uint8ClampedArray(w*h);
    const mat=Array.from({length:sz},()=>new Array(sz));
    const cx=sz/2,cy=sz/2;
    const indices=[];
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++) indices.push({x,y,d:Math.sqrt((x-cx+.5)**2+(y-cy+.5)**2)});
    indices.sort((a,b)=>a.d-b.d);
    for(let i=0;i<indices.length;i++) mat[indices[i].y][indices[i].x]=(i+.5)/(sz*sz);
    const ang=p.rotation*Math.PI/180,cosA=Math.cos(ang),sinA=Math.sin(ang);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=y*w+x;
      const rx=Math.round(x*cosA+y*sinA),ry=Math.round(-x*sinA+y*cosA);
      const bx=((rx%sz)+sz)%sz,by=((ry%sz)+sz)%sz;
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      const result=(v+(mat[by][bx]-.5)*p.spread)>p.threshold?255:0;
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'blue-noise', name:'Blue Noise', category:'ordered', params:[
    {id:'scale',label:'Scale',min:1,max:8,step:1,default:2},
    {id:'strength',label:'Strength',min:0,max:255,step:1,default:128},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'warp',label:'Warp',min:0,max:1,step:.05,default:0},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),sc=p.scale;
    const phi = 1.618033988749895;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      let sx=Math.floor(x/sc),sy=Math.floor(y/sc);
      if(p.warp>0){
        const v=clamp(px[y*w+x])/255;
        sx+=Math.round(v*p.warp*4); sy+=Math.round(v*p.warp*4);
      }
      let bn=(sx*phi+sy*phi*phi)%1;
      bn=((bn*2654435761)>>>0)/4294967296;
      const i=y*w+x;
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      const result=(v+(bn-.5)*p.strength)>p.threshold?255:0;
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'void-cluster', name:'Void & Cluster', category:'ordered', params:[
    {id:'size',label:'Pattern Size',min:4,max:16,step:4,default:8},
    {id:'spread',label:'Spread',min:32,max:255,step:1,default:160},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const sz=p.size, o=new Uint8ClampedArray(w*h);
    const mat=Array.from({length:sz},(_,y)=>Array.from({length:sz},(_,x)=>{
      let v=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const ny=((y+dy)%sz+sz)%sz,nx=((x+dx)%sz+sz)%sz;
        v+=Math.sin(nx*2.39996+ny*7.11)*0.5+0.5;}
      return v;
    }));
    let mn=Infinity,mx=-Infinity;
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++){if(mat[y][x]<mn)mn=mat[y][x];if(mat[y][x]>mx)mx=mat[y][x];}
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++) mat[y][x]=(mat[y][x]-mn)/(mx-mn);
    const ang=p.rotation*Math.PI/180,cosA=Math.cos(ang),sinA=Math.sin(ang);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=y*w+x;
      const rx=Math.round(x*cosA+y*sinA),ry=Math.round(-x*sinA+y*cosA);
      const bx=((rx%sz)+sz)%sz,by=((ry%sz)+sz)%sz;
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      const result=(v+(mat[by][bx]-.5)*p.spread)>p.threshold?255:0;
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'checkerboard', name:'Checkerboard', category:'ordered', params:[
    {id:'size',label:'Cell Size',min:1,max:16,step:1,default:2},
    {id:'bias',label:'Threshold Bias',min:-128,max:128,step:1,default:0},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'contrast',label:'Check Contrast',min:0,max:120,step:1,default:40},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),sz=p.size;
    const ang=p.rotation*Math.PI/180,cosA=Math.cos(ang),sinA=Math.sin(ang);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=y*w+x;
      const rx=Math.round(x*cosA+y*sinA),ry=Math.round(-x*sinA+y*cosA);
      const checker=(Math.floor(((rx%sz)+sz)/sz)+Math.floor(((ry%sz)+sz)/sz))%2;
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      const result=v>(128+p.bias+checker*p.contrast-p.contrast/2)?255:0;
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'threshold-map', name:'Threshold Map', category:'ordered', params:[
    {id:'mapType',label:'Map',type:'select',options:[{value:'perlin',label:'Perlin-like'},{value:'worley',label:'Worley'},{value:'fbm',label:'FBM'}],default:'perlin'},
    {id:'scale',label:'Scale',min:.005,max:.1,step:.005,default:.02},
    {id:'contrast',label:'Contrast',min:.1,max:3,step:.1,default:1},
    {id:'offsetX',label:'Offset X',min:-100,max:100,step:1,default:0},
    {id:'offsetY',label:'Offset Y',min:-100,max:100,step:1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),sc=p.scale;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const mx=x+p.offsetX,my=y+p.offsetY;
      let threshold;
      if(p.mapType==='perlin'){threshold=(Math.sin(mx*sc*6.28)*Math.cos(my*sc*6.28)+Math.sin((mx+my)*sc*3.14)*.5+1.5)/3;}
      else if(p.mapType==='worley'){
        const gx=Math.floor(mx*sc*2),gy=Math.floor(my*sc*2);
        let minD=1e9;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const cx2=(gx+dx+.5+Math.sin((gx+dx)*12.9898+(gy+dy)*78.233)*.5)/sc/2;
          const cy2=(gy+dy+.5+Math.sin((gy+dy)*12.9898+(gx+dx)*78.233)*.5)/sc/2;
          const d=Math.sqrt((mx-cx2)**2+(my-cy2)**2)*sc;if(d<minD)minD=d;}
        threshold=Math.min(1,minD*2);}
      else{let n=0,amp=1,freq=1,ma=0;for(let oc=0;oc<4;oc++){
        n+=(Math.sin(mx*sc*freq*6.28)*Math.cos(my*sc*freq*4.17)+1)/2*amp;ma+=amp;amp*=.5;freq*=2;}
        threshold=n/ma;}
      threshold=.5+(threshold-.5)*p.contrast;
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const result=v>threshold?255:0;
      o[y*w+x]=p.invert?255-result:result;
    }return o;
  }});

  A.push({ id:'truchet', name:'Truchet Tiles', category:'ordered', params:[
    {id:'tileSize',label:'Tile Size',min:4,max:24,step:2,default:10},
    {id:'style',label:'Style',type:'select',options:[{value:'arc',label:'Quarter Arcs'},{value:'triangle',label:'Triangles'},{value:'maze',label:'Maze'}],default:'arc'},
    {id:'lineWidth',label:'Line Width',min:.1,max:.8,step:.05,default:.5},
    {id:'contrast',label:'Contrast',min:.3,max:1,step:.05,default:.7},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed),ts=p.tileSize;
    for(let ty=0;ty<h;ty+=ts)for(let tx=0;tx<w;tx+=ts){
      const midX=Math.min(w-1,tx+ts/2),midY=Math.min(h-1,ty+ts/2);
      let v=clamp(px[midY*w+midX])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const flip=v<.5;
      for(let dy=0;dy<ts&&ty+dy<h;dy++)for(let dx=0;dx<ts&&tx+dx<w;dx++){
        const nx=dx/ts,ny=dy/ts;let inside=false;
        if(p.style==='arc'){
          if(flip){const d1=Math.sqrt(nx*nx+ny*ny),d2=Math.sqrt((1-nx)**2+(1-ny)**2);inside=d1<p.lineWidth||d2<p.lineWidth;}
          else{const d1=Math.sqrt((1-nx)**2+ny*ny),d2=Math.sqrt(nx*nx+(1-ny)**2);inside=d1<p.lineWidth||d2<p.lineWidth;}
        }else if(p.style==='triangle'){inside=flip?nx+ny<1:nx+ny>1;}
        else{inside=flip?(dx<ts/2)===(dy<ts/2):(dx<ts/2)!==(dy<ts/2);}
        if(inside&&v<p.contrast)o[(ty+dy)*w+tx+dx]=p.invert?255:0;
      }}return o;
  }});

  // ═══════════════════════════════════════════
  // HALFTONE & SCREEN (8)
  // ═══════════════════════════════════════════
  A.push({ id:'halftone', name:'Halftone', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:2,max:30,step:1,default:6},
    {id:'angle',label:'Angle',min:0,max:180,step:1,default:45},
    {id:'shape',label:'Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'},{value:'line',label:'Line'},{value:'cross',label:'Cross'},{value:'star',label:'Star'},{value:'ring',label:'Ring'},{value:'ellipse',label:'Ellipse'}],default:'circle'},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:0},
    {id:'dotGain',label:'Dot Gain',min:.5,max:2.5,step:.05,default:1.42},
    {id:'jitter',label:'Jitter',min:0,max:1,step:.05,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h), ds=p.dotSize, ang=p.angle*Math.PI/180;
    const cos=Math.cos(ang), sin=Math.sin(ang), soft=p.softness;
    const r=p.jitter>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      let rx=x*cos+y*sin, ry=-x*sin+y*cos;
      if(r){rx+=(r()-.5)*p.jitter*ds;ry+=(r()-.5)*p.jitter*ds;}
      const cx=((rx%ds)+ds)%ds, cy=((ry%ds)+ds)%ds;
      const nx=(cx/ds-.5)*2, ny=(cy/ds-.5)*2;
      let d;
      if(p.shape==='circle') d=Math.sqrt(nx*nx+ny*ny);
      else if(p.shape==='diamond') d=Math.abs(nx)+Math.abs(ny);
      else if(p.shape==='square') d=Math.max(Math.abs(nx),Math.abs(ny));
      else if(p.shape==='line') d=Math.abs(ny);
      else if(p.shape==='cross') d=Math.min(Math.abs(nx),Math.abs(ny));
      else if(p.shape==='ring') d=Math.abs(Math.sqrt(nx*nx+ny*ny)-.5)*2;
      else if(p.shape==='ellipse') d=Math.sqrt(nx*nx*1.5+ny*ny*0.7);
      else d=Math.max(Math.abs(nx),Math.abs(ny))*(0.5+0.5*Math.cos(Math.atan2(ny,nx)*4));
      let val=clamp(px[y*w+x])/255; if(p.gamma!==1) val=Math.pow(val,p.gamma);
      const t=(1-val)*p.dotGain;
      let result;
      if(soft>0){ const s2=d-t; result=clamp(128-s2/soft*128); }
      else result=d<t?255:0;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'cmyk-halftone', name:'CMYK Halftone', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:3,max:20,step:1,default:6},
    {id:'cAngle',label:'C Angle',min:0,max:90,step:5,default:15},
    {id:'mAngle',label:'M Angle',min:0,max:90,step:5,default:75},
    {id:'yAngle',label:'Y Angle',min:0,max:90,step:5,default:0},
    {id:'kAngle',label:'K Angle',min:0,max:90,step:5,default:45},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.1},
    {id:'dotGain',label:'Dot Gain',min:.5,max:2.5,step:.05,default:1.42},
    {id:'shape',label:'Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'},{value:'ellipse',label:'Ellipse'}],default:'circle'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),ds=p.dotSize;
    const ang=p.kAngle*Math.PI/180;
    const cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cos+y*sin,ry=-x*sin+y*cos;
      const cx2=((rx%ds)+ds)%ds,cy2=((ry%ds)+ds)%ds;
      const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
      let d;
      if(p.shape==='diamond') d=Math.abs(nx)+Math.abs(ny);
      else if(p.shape==='square') d=Math.max(Math.abs(nx),Math.abs(ny));
      else if(p.shape==='ellipse') d=Math.sqrt(nx*nx*1.5+ny*ny*0.7);
      else d=Math.sqrt(nx*nx+ny*ny);
      let val=clamp(px[y*w+x])/255; if(p.gamma!==1) val=Math.pow(val,p.gamma);
      const t=(1-val)*p.dotGain;
      let result;
      if(p.softness>0){const s2=d-t;result=clamp(128-s2/p.softness*128);}
      else result=d<t?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'stochastic-screen', name:'Stochastic Screen', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:1,max:8,step:1,default:2},
    {id:'regularity',label:'Regularity',min:0,max:1,step:.05,default:.5},
    {id:'dotScale',label:'Dot Scale',min:.2,max:2,step:.05,default:.7},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),ds=p.dotSize;
    o.fill(p.invert?0:255);
    for(let y=0;y<h;y+=ds)for(let x=0;x<w;x+=ds){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const jx=(r()-.5)*(1-p.regularity)*ds*2;
      const jy=(r()-.5)*(1-p.regularity)*ds*2;
      const dotR=ds*(1-v)*p.dotScale+0.5;
      for(let dy=-ds;dy<=ds*2;dy++)for(let dx=-ds;dx<=ds*2;dx++){
        const fx=x+dx+Math.round(jx),fy=y+dy+Math.round(jy);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          const dist=Math.sqrt((dx-ds/2)**2+(dy-ds/2)**2);
          if(dist<dotR) o[fy*w+fx]=p.invert?255:0;
        }
      }
    }
    return o;
  }});

  A.push({ id:'am-halftone', name:'AM Halftone', category:'halftone', params:[
    {id:'lpi',label:'Lines/Inch',min:2,max:20,step:1,default:8},
    {id:'angle',label:'Screen Angle',min:0,max:90,step:5,default:45},
    {id:'gain',label:'Dot Gain',min:0,max:1,step:.05,default:.2},
    {id:'shape',label:'Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'},{value:'line',label:'Line'}],default:'circle'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),cell=Math.max(2,Math.round(w/p.lpi/6));
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cos+y*sin,ry=-x*sin+y*cos;
      const cx2=((rx%cell)+cell)%cell,cy2=((ry%cell)+cell)%cell;
      const nx=(cx2/cell-.5)*2,ny=(cy2/cell-.5)*2;
      let d;
      if(p.shape==='diamond') d=Math.abs(nx)+Math.abs(ny);
      else if(p.shape==='square') d=Math.max(Math.abs(nx),Math.abs(ny));
      else if(p.shape==='line') d=Math.abs(ny);
      else d=Math.sqrt(nx*nx+ny*ny);
      let val=clamp(px[y*w+x])/255; if(p.gamma!==1) val=Math.pow(val,p.gamma);
      const t=(1-val)*(1+p.gain)*1.2;
      const result=d<t?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'fm-halftone', name:'FM Halftone', category:'halftone', params:[
    {id:'minDot',label:'Min Dot',min:1,max:4,step:1,default:1},
    {id:'maxDot',label:'Max Dot',min:2,max:8,step:1,default:4},
    {id:'cutoff',label:'White Cutoff',min:.8,max:1,step:.01,default:.95},
    {id:'spacing',label:'Spacing',min:.3,max:1.5,step:.05,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const step=Math.max(1,Math.round(p.maxDot*p.spacing));
    for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){
      let v=clamp(px[Math.min(h-1,y)*w+Math.min(w-1,x)])/255;
      if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(v>p.cutoff)continue;
      const dotR=p.minDot+(p.maxDot-p.minDot)*(1-v);
      const cx2=x+Math.floor(r()*step*.5),cy2=y+Math.floor(r()*step*.5);
      for(let dy=-p.maxDot;dy<=p.maxDot;dy++)for(let dx=-p.maxDot;dx<=p.maxDot;dx++){
        const fx=cx2+dx,fy=cy2+dy;
        if(fx>=0&&fx<w&&fy>=0&&fy<h&&Math.sqrt(dx*dx+dy*dy)<=dotR)o[fy*w+fx]=p.invert?255:0;
      }
    }
    return o;
  }});

  A.push({ id:'mezzotint', name:'Mezzotint', category:'halftone', params:[
    {id:'style',label:'Style',type:'select',options:[{value:'fine',label:'Fine'},{value:'medium',label:'Medium'},{value:'coarse',label:'Coarse'},{value:'worm',label:'Worm'},{value:'stroke',label:'Stroke'}],default:'medium'},
    {id:'density',label:'Density',min:.2,max:2,step:.05,default:.8},
    {id:'angle',label:'Angle Bias',min:0,max:180,step:5,default:0},
    {id:'length',label:'Mark Length',min:.5,max:3,step:.1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    const sizes={fine:1,medium:2,coarse:4,worm:2,stroke:3};
    const sz=sizes[p.style]||2;
    const inkV=p.invert?255:0, paperV=p.invert?0:255;
    if(p.style==='worm'||p.style==='stroke'){
      o.fill(paperV);
      const count=w*h/(sz*sz)*p.density;
      const angBias=p.angle*Math.PI/180;
      for(let i=0;i<count;i++){
        let cx2=r()*w,cy2=r()*h;
        let sv=clamp(px[Math.min(h-1,Math.round(cy2))*w+Math.min(w-1,Math.round(cx2))])/255;
        if(p.gamma!==1) sv=Math.pow(sv,p.gamma);
        if(r()<sv)continue;
        const baseLen=p.style==='worm'?Math.round(3+r()*8):Math.round(2+r()*5);
        const len=Math.round(baseLen*p.length);
        const ang2=p.angle>0?angBias+(r()-.5)*1:r()*Math.PI;
        for(let t=0;t<len;t++){
          const fx=Math.round(cx2),fy=Math.round(cy2);
          if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=inkV;
          cx2+=Math.cos(ang2)*(p.style==='worm'?1+r():1.5);
          cy2+=Math.sin(ang2)*(p.style==='worm'?1+r():1.5);
        }
      }
    } else {
      for(let y=0;y<h;y+=sz)for(let x=0;x<w;x+=sz){
        let v=clamp(px[Math.min(h-1,y)*w+Math.min(w-1,x)])/255;
        if(p.gamma!==1) v=Math.pow(v,p.gamma);
        const ink=r()>v?inkV:paperV;
        for(let dy=0;dy<sz&&y+dy<h;dy++)for(let dx=0;dx<sz&&x+dx<w;dx++)
          o[(y+dy)*w+x+dx]=ink;
      }
    }
    return o;
  }});

  A.push({ id:'newsprint', name:'Newsprint', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:3,max:16,step:1,default:6},
    {id:'angle',label:'Angle',min:0,max:90,step:5,default:45},
    {id:'paperTone',label:'Paper Tone',min:150,max:255,step:1,default:240},
    {id:'inkDensity',label:'Ink Density',min:.3,max:1.5,step:.05,default:.85},
    {id:'inkDarkness',label:'Ink Darkness',min:0,max:80,step:1,default:40},
    {id:'bleed',label:'Ink Bleed',min:0,max:1,step:.05,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'shape',label:'Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'}],default:'circle'}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),ds=p.dotSize;
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cos+y*sin,ry=-x*sin+y*cos;
      const cx2=((rx%ds)+ds)%ds,cy2=((ry%ds)+ds)%ds;
      const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
      let d;
      if(p.shape==='diamond') d=Math.abs(nx)+Math.abs(ny);
      else if(p.shape==='square') d=Math.max(Math.abs(nx),Math.abs(ny));
      else d=Math.sqrt(nx*nx+ny*ny);
      let val=clamp(px[y*w+x])/255; if(p.gamma!==1) val=Math.pow(val,p.gamma);
      const t=(1-val)*p.inkDensity*1.42;
      if(d<t){
        const edge=p.bleed>0?clamp(val*p.inkDarkness+(d/t)*p.bleed*60):clamp(val*p.inkDarkness);
        o[y*w+x]=edge;
      } else o[y*w+x]=p.paperTone;
    }
    return o;
  }});

  A.push({ id:'rosette', name:'Rosette Pattern', category:'halftone', params:[
    {id:'dotSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'petals',label:'Petals',min:3,max:12,step:1,default:6},
    {id:'petalDepth',label:'Petal Depth',min:0,max:1,step:.05,default:.3},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.2},
    {id:'dotGain',label:'Dot Gain',min:.5,max:2.5,step:.05,default:1.3},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),ds=p.dotSize;
    const rAng=p.rotation*Math.PI/180,cosR=Math.cos(rAng),sinR=Math.sin(rAng);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cosR+y*sinR,ry=-x*sinR+y*cosR;
      const cx2=((rx%ds)+ds)%ds,cy2=((ry%ds)+ds)%ds;
      const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
      const ang2=Math.atan2(ny,nx);
      const r2=Math.sqrt(nx*nx+ny*ny);
      const petal=0.5+0.5*Math.cos(ang2*p.petals);
      const d=r2*(1-petal*p.petalDepth);
      let val=clamp(px[y*w+x])/255; if(p.gamma!==1) val=Math.pow(val,p.gamma);
      const t=(1-val)*p.dotGain;
      let result;
      if(p.softness>0){const s2=d-t;result=clamp(128-s2/p.softness*128);}
      else result=d<t?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // LINES & HATCHING (15)
  // ═══════════════════════════════════════════
  A.push({ id:'horizontal-lines', name:'Horizontal Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:2,max:20,step:1,default:4},
    {id:'thickness',label:'Thickness',min:1,max:10,step:1,default:2},
    {id:'wobble',label:'Wobble',min:0,max:5,step:.25,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);const r=p.wobble>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const wy=r?y+Math.sin(x*0.1)*p.wobble*2+(r()-.5)*p.wobble:y;
      const linePhase=((wy%p.spacing)+p.spacing)%p.spacing;
      const result=linePhase<p.thickness&&v<(1-linePhase/p.spacing)?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'vertical-lines', name:'Vertical Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:2,max:20,step:1,default:4},
    {id:'thickness',label:'Thickness',min:1,max:10,step:1,default:2},
    {id:'wobble',label:'Wobble',min:0,max:5,step:.25,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);const r=p.wobble>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const wx=r?x+Math.sin(y*0.1)*p.wobble*2+(r()-.5)*p.wobble:x;
      const linePhase=((wx%p.spacing)+p.spacing)%p.spacing;
      const result=linePhase<p.thickness&&v<(1-linePhase/p.spacing)?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'diagonal-lines', name:'Diagonal Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:2,max:20,step:1,default:5},
    {id:'angle',label:'Angle',min:0,max:180,step:5,default:45},
    {id:'thickness',label:'Thickness',min:1,max:8,step:1,default:2},
    {id:'wobble',label:'Wobble',min:0,max:3,step:.1,default:0},
    {id:'taper',label:'Taper',min:0,max:1,step:.05,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h), ang=p.angle*Math.PI/180;
    const cos=Math.cos(ang),sin=Math.sin(ang);
    const r=p.wobble>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const wb=r?(r()-.5)*p.wobble:0;
      const proj=Math.abs((x*cos+y*sin+wb)%p.spacing);
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const lineWidth=p.thickness*(1-v*p.taper);
      const result=proj<lineWidth?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'crosshatch', name:'Crosshatch', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:3,max:20,step:1,default:6},
    {id:'layers',label:'Layers',min:1,max:6,step:1,default:3},
    {id:'angle',label:'Base Angle',min:0,max:90,step:5,default:45},
    {id:'lineWeight',label:'Line Weight',min:.5,max:4,step:.25,default:1.5},
    {id:'wobble',label:'Wobble',min:0,max:3,step:.1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h); o.fill(p.invert?0:255);
    const angles=[p.angle,p.angle+90,p.angle+45,p.angle+135,p.angle+22,p.angle+67];
    const r=p.wobble>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const layersNeeded=Math.ceil((1-v)*p.layers);
      for(let l=0;l<layersNeeded;l++){
        const a=angles[l%6]*Math.PI/180;
        const wb=r?(r()-.5)*p.wobble:0;
        const proj=Math.abs((x*Math.cos(a)+y*Math.sin(a)+wb)%p.spacing);
        const thresh=0.4+(l*0.12);
        if(proj<p.lineWeight&&v<thresh) { o[y*w+x]=p.invert?255:0; break; }
      }
    }
    return o;
  }});

  A.push({ id:'crosshatch-variable', name:'Variable Crosshatch', category:'lines', params:[
    {id:'layers',label:'Max Layers',min:1,max:6,step:1,default:3},
    {id:'baseSpacing',label:'Base Spacing',min:3,max:15,step:1,default:5},
    {id:'baseAngle',label:'Base Angle',min:0,max:90,step:5,default:45},
    {id:'angleStep',label:'Angle Step',min:20,max:90,step:5,default:60},
    {id:'densityResponse',label:'Density Response',min:.2,max:2,step:.1,default:.8},
    {id:'lineWeight',label:'Line Weight',min:.5,max:3,step:.1,default:1.2},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=clamp(px[y*w+x])/255;
      const layersNeeded=Math.ceil((1-v)**p.densityResponse*p.layers);
      for(let l=0;l<layersNeeded;l++){
        const ang=(p.baseAngle+l*p.angleStep)*Math.PI/180;
        const spacing=p.baseSpacing*(1+l*0.3);
        const proj=Math.abs((x*Math.cos(ang)+y*Math.sin(ang))%spacing);
        if(proj<p.lineWeight){o[y*w+x]=0;break;}
      }
    }
    return o;
  }});

  A.push({ id:'contour-hatch', name:'Contour Hatching', category:'lines', params:[
    {id:'spacing',label:'Line Spacing',min:3,max:15,step:1,default:5},
    {id:'thickness',label:'Line Width',min:.5,max:4,step:.25,default:1},
    {id:'curvature',label:'Curvature',min:0,max:1,step:.05,default:.6},
    {id:'cutoff',label:'White Cutoff',min:.7,max:1,step:.01,default:.92},
    {id:'densityLayers',label:'Density Layers',min:1,max:3,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(v>p.cutoff)continue;
      const e=sobelAt(px,x,y,w,h);
      const hatchAng=e.ang+Math.PI/2;
      const proj=Math.abs((x*Math.cos(hatchAng)+y*Math.sin(hatchAng))%p.spacing);
      const lineW=p.thickness*(1-v*0.5);
      if(proj<lineW){o[y*w+x]=p.invert?255:0;continue;}
      if(p.densityLayers>=2&&v<.5){
        const proj2=Math.abs((x*Math.cos(hatchAng+.5)+y*Math.sin(hatchAng+.5))%(p.spacing*1.3));
        if(proj2<lineW*.7){o[y*w+x]=p.invert?255:0;continue;}
      }
      if(p.densityLayers>=3&&v<.25){
        const proj3=Math.abs((x*Math.cos(hatchAng+1)+y*Math.sin(hatchAng+1))%(p.spacing*1.6));
        if(proj3<lineW*.5) o[y*w+x]=p.invert?255:0;
      }
    }
    return o;
  }});

  A.push({ id:'engraving', name:'Engraving Lines', category:'lines', params:[
    {id:'lineSpacing',label:'Line Spacing',min:2,max:10,step:1,default:3},
    {id:'angle',label:'Angle',min:0,max:180,step:5,default:45},
    {id:'thickness',label:'Swell',min:.5,max:4,step:.25,default:1.5},
    {id:'curvature',label:'Curvature',min:0,max:1,step:.05,default:.5},
    {id:'crosshatch',label:'Cross Lines',type:'checkbox',default:false},
    {id:'crossAngle',label:'Cross Angle',min:30,max:90,step:5,default:90},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    const ang2=(p.angle+p.crossAngle)*Math.PI/180,cos2=Math.cos(ang2),sin2=Math.sin(ang2);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const proj=(x*cos+y*sin);
      const lineIdx=Math.round(proj/p.lineSpacing);
      const swell=p.thickness*(1-v);
      const curveOffset=p.curvature*(v-.5)*p.lineSpacing*0.5;
      const adjustedDist=Math.abs(proj+curveOffset-lineIdx*p.lineSpacing);
      if(adjustedDist<swell){o[y*w+x]=p.invert?255:0;continue;}
      if(p.crosshatch&&v<.45){
        const proj2=(x*cos2+y*sin2);
        const lineIdx2=Math.round(proj2/p.lineSpacing);
        const co2=p.curvature*(v-.5)*p.lineSpacing*0.5;
        const ad2=Math.abs(proj2+co2-lineIdx2*p.lineSpacing);
        if(ad2<swell*.7) o[y*w+x]=p.invert?255:0;
      }
    }
    return o;
  }});

  A.push({ id:'stipple', name:'Stipple', category:'lines', params:[
    {id:'density',label:'Density',min:500,max:30000,step:500,default:8000},
    {id:'dotSize',label:'Dot Size',min:1,max:6,step:1,default:1},
    {id:'variableSize',label:'Variable Size',type:'checkbox',default:false},
    {id:'regularity',label:'Regularity',min:0,max:1,step:.05,default:.3},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const inkV=p.invert?255:0;
    for(let i=0;i<p.density;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(r()<v)continue;
      const ds=p.variableSize?Math.max(1,Math.round(p.dotSize*(1-v))):p.dotSize;
      const gx=p.regularity>0?Math.round(x/(ds*3))*(ds*3):x;
      const gy=p.regularity>0?Math.round(y/(ds*3))*(ds*3):y;
      const fx=Math.round(x*(1-p.regularity)+gx*p.regularity);
      const fy=Math.round(y*(1-p.regularity)+gy*p.regularity);
      for(let dy=-ds+1;dy<ds;dy++)for(let dx=-ds+1;dx<ds;dx++){
        if(dx*dx+dy*dy<ds*ds){
          const px2=fx+dx,py2=fy+dy;
          if(px2>=0&&px2<w&&py2>=0&&py2<h) o[py2*w+px2]=inkV;
        }
      }
    }
    return o;
  }});

  A.push({ id:'wave-lines', name:'Wave Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:3,max:20,step:1,default:6},
    {id:'amplitude',label:'Amplitude',min:0,max:15,step:.5,default:3},
    {id:'frequency',label:'Frequency',min:.01,max:.3,step:.01,default:.05},
    {id:'thickness',label:'Thickness',min:.5,max:5,step:.25,default:1.5},
    {id:'harmonics',label:'Harmonics',min:1,max:4,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      let wave=0;
      for(let h2=1;h2<=p.harmonics;h2++) wave+=Math.sin(x*p.frequency*h2)*(p.amplitude/h2);
      wave*=(1-v);
      const proj=((y+wave)%p.spacing+p.spacing)%p.spacing;
      const lineW=p.thickness*(1-v);
      if(proj<lineW||p.spacing-proj<lineW) o[y*w+x]=p.invert?255:0;
    }
    return o;
  }});

  A.push({ id:'concentric-lines', name:'Concentric Lines', category:'lines', params:[
    {id:'spacing',label:'Ring Spacing',min:3,max:20,step:1,default:6},
    {id:'centerX',label:'Center X',min:0,max:1,step:.05,default:.5},
    {id:'centerY',label:'Center Y',min:0,max:1,step:.05,default:.5},
    {id:'thickness',label:'Thickness',min:.5,max:5,step:.25,default:1.5},
    {id:'wobble',label:'Wobble',min:0,max:5,step:.25,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    const cx2=w*p.centerX,cy2=h*p.centerY;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      let dist=Math.sqrt((x-cx2)**2+(y-cy2)**2);
      if(p.wobble>0){const a=Math.atan2(y-cy2,x-cx2);dist+=Math.sin(a*8)*p.wobble;}
      const ring=dist%p.spacing;
      const lineW=p.thickness*(1-v);
      if(ring<lineW) o[y*w+x]=p.invert?255:0;
    }
    return o;
  }});

  A.push({ id:'spiral-lines', name:'Spiral Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:3,max:15,step:1,default:5},
    {id:'tightness',label:'Tightness',min:.5,max:3,step:.1,default:1},
    {id:'centerX',label:'Center X',min:0,max:1,step:.05,default:.5},
    {id:'centerY',label:'Center Y',min:0,max:1,step:.05,default:.5},
    {id:'thickness',label:'Thickness',min:.3,max:4,step:.1,default:1.2},
    {id:'direction',label:'Direction',type:'select',options:[{value:'cw',label:'Clockwise'},{value:'ccw',label:'Counter-CW'},{value:'double',label:'Double Spiral'}],default:'cw'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    const cx2=w*p.centerX,cy2=h*p.centerY;
    const dir=p.direction==='ccw'?-1:1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const dist=Math.sqrt((x-cx2)**2+(y-cy2)**2);
      const ang2=Math.atan2(y-cy2,x-cx2)*dir;
      const spiral=((dist-ang2/(2*Math.PI)*p.spacing*p.tightness)%p.spacing+p.spacing)%p.spacing;
      const lineW=p.thickness*(1-v);
      let hit=spiral<lineW||p.spacing-spiral<lineW;
      if(!hit&&p.direction==='double'){
        const spiral2=((dist+ang2/(2*Math.PI)*p.spacing*p.tightness)%p.spacing+p.spacing)%p.spacing;
        hit=spiral2<lineW||p.spacing-spiral2<lineW;
      }
      if(hit) o[y*w+x]=p.invert?255:0;
    }
    return o;
  }});

  A.push({ id:'woodcut', name:'Woodcut', category:'lines', params:[
    {id:'lineWidth',label:'Line Width',min:1,max:8,step:1,default:3},
    {id:'contrast',label:'Contrast',min:.5,max:3,step:.1,default:1.5},
    {id:'angle',label:'Grain Angle',min:0,max:180,step:5,default:30},
    {id:'variation',label:'Variation',min:0,max:1,step:.05,default:.4},
    {id:'cutoff',label:'Cut Depth',min:.4,max:1,step:.05,default:.75},
    {id:'edgeLines',label:'Edge Lines',type:'checkbox',default:false},
    {id:'edgeWeight',label:'Edge Weight',min:20,max:120,step:5,default:50},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    const inkV=p.invert?255:0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255;
      v=Math.pow(v,1/p.contrast);
      const proj=x*cos+y*sin;
      const wobble=Math.sin(proj*0.1+r()*p.variation*10)*p.variation*2;
      const linePhase=(proj+wobble)%(p.lineWidth*2);
      const cutWidth=p.lineWidth*(1-v)*1.5;
      if(linePhase<cutWidth&&v<p.cutoff) o[y*w+x]=inkV;
      if(p.edgeLines){
        const e=sobelAt(px,x,y,w,h);
        if(e.mag>p.edgeWeight) o[y*w+x]=inkV;
      }
    }
    return o;
  }});

  A.push({ id:'linocut', name:'Linocut', category:'lines', params:[
    {id:'blockSize',label:'Block Size',min:2,max:10,step:1,default:4},
    {id:'cutDepth',label:'Cut Depth',min:.2,max:1,step:.05,default:.6},
    {id:'texture',label:'Texture',min:0,max:1,step:.05,default:.3},
    {id:'angle',label:'Grain Angle',min:0,max:180,step:5,default:0},
    {id:'edgeLines',label:'Edge Lines',type:'checkbox',default:false},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);const r=mkRand(p.seed),bs=p.blockSize;
    const ang=p.angle*Math.PI/180,cosA=Math.cos(ang),sinA=Math.sin(ang);
    const cutV=p.invert?0:255, inkV=p.invert?255:0, texV=p.invert?0:255;
    for(let y=0;y<h;y+=bs)for(let x=0;x<w;x+=bs){
      let v=clamp(px[Math.min(h-1,y)*w+Math.min(w-1,x)])/255;
      if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const cut=v>p.cutDepth;
      for(let dy=0;dy<bs&&y+dy<h;dy++)for(let dx=0;dx<bs&&x+dx<w;dx++){
        if(cut){
          o[(y+dy)*w+x+dx]=cutV;
        }else{
          const grainCheck=p.angle>0?Math.sin(((x+dx)*cosA+(y+dy)*sinA)*0.5)>.3:true;
          const tex=r()<p.texture&&grainCheck?texV:inkV;
          o[(y+dy)*w+x+dx]=tex;
        }
      }
    }
    if(p.edgeLines){
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const e=sobelAt(px,x,y,w,h);
        if(e.mag>50) o[y*w+x]=inkV;
      }
    }
    return o;
  }});

  A.push({ id:'etching', name:'Etching', category:'lines', params:[
    {id:'lineSpacing',label:'Line Spacing',min:2,max:10,step:1,default:3},
    {id:'crossAngle',label:'Cross Angle',min:30,max:90,step:5,default:75},
    {id:'baseAngle',label:'Base Angle',min:0,max:90,step:5,default:45},
    {id:'depth',label:'Depth',min:.2,max:1,step:.05,default:.7},
    {id:'lineWeight',label:'Line Weight',min:.3,max:3,step:.1,default:1},
    {id:'crossWeight',label:'Cross Weight',min:.3,max:2,step:.1,default:.8},
    {id:'irregularity',label:'Irregularity',min:0,max:1,step:.05,default:.2},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const a1=p.baseAngle*Math.PI/180,a2=(p.baseAngle+p.crossAngle)*Math.PI/180;
    const inkV=p.invert?255:0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(v>p.depth)continue;
      const wobble=(r()-.5)*p.irregularity*2;
      const p1=Math.abs((x*Math.cos(a1)+y*Math.sin(a1)+wobble)%p.lineSpacing);
      if(p1<p.lineWeight){o[y*w+x]=inkV;continue;}
      if(v<p.depth*0.6){
        const p2=Math.abs((x*Math.cos(a2)+y*Math.sin(a2)+wobble)%p.lineSpacing);
        if(p2<p.crossWeight)o[y*w+x]=inkV;
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // ARTISTIC & PAINTERLY (12)
  // ═══════════════════════════════════════════
  A.push({ id:'overshot-sketch', name:'Overshot Sketch', category:'artistic', params:[
    {id:'lineCount',label:'Lines',min:500,max:12000,step:500,default:3000},
    {id:'overshoot',label:'Overshoot',min:0,max:1.5,step:.05,default:.4},
    {id:'wobble',label:'Wobble',min:0,max:2,step:.05,default:.3},
    {id:'thickness',label:'Thickness',min:1,max:5,step:1,default:1},
    {id:'minLength',label:'Min Length',min:2,max:15,step:1,default:5},
    {id:'maxLength',label:'Max Length',min:8,max:40,step:1,default:15},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    for(let i=0;i<p.lineCount;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(r()>1-v+.08)continue;
      let ang=r()*Math.PI;
      if(x>2&&x<w-3&&y>2&&y<h-3){
        const gx=clamp(px[y*w+x+1])-clamp(px[y*w+x-1]);
        const gy=clamp(px[(y+1)*w+x])-clamp(px[(y-1)*w+x]);
        ang=Math.atan2(gx,-gy)+r()*.4;}
      const baseLen=(1-v)*p.maxLength+p.minLength;
      const ovLen=baseLen*(1+p.overshoot*(r()*.5+.5));
      const dx=Math.cos(ang),dy=Math.sin(ang);
      for(let t=-ovLen/2;t<ovLen/2;t++){
        const wobbleX=(r()-.5)*p.wobble*2,wobbleY=(r()-.5)*p.wobble*2;
        for(let ww=0;ww<p.thickness;ww++){
          const fx=Math.round(x+dx*t+wobbleX-dy*ww),fy=Math.round(y+dy*t+wobbleY+dx*ww);
          if(fx>=0&&fx<w&&fy>=0&&fy<h){
            const edgeFade=Math.abs(t)/(ovLen/2);
            if(edgeFade<.85||r()>.3){
              const mark=edgeFade>.7?128:0;
              o[fy*w+fx]=p.invert?Math.max(o[fy*w+fx],255-mark):Math.min(o[fy*w+fx],mark);
            }
          }}}
    }return o;
  }});

  A.push({ id:'gesture-drawing', name:'Gesture Drawing', category:'artistic', params:[
    {id:'strokes',label:'Strokes',min:200,max:8000,step:200,default:1500},
    {id:'strokeLen',label:'Stroke Length',min:10,max:120,step:5,default:30},
    {id:'speed',label:'Speed/Looseness',min:0,max:1,step:.05,default:.6},
    {id:'thickness',label:'Thickness',min:1,max:4,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let s=0;s<p.strokes;s++){
      let cx2=r()*w,cy2=r()*h;
      const sv=clamp(px[Math.min(h-1,Math.round(cy2))*w+Math.min(w-1,Math.round(cx2))])/255;
      if(sv>.85&&r()>.2)continue;
      let prevAng=r()*Math.PI*2;
      for(let t=0;t<p.strokeLen;t++){
        const ix=Math.max(0,Math.min(w-1,Math.round(cx2))),iy=Math.max(0,Math.min(h-1,Math.round(cy2)));
        const v=clamp(px[iy*w+ix]);
        let gx=0,gy=0;
        if(ix>0&&ix<w-1){gx=clamp(px[iy*w+ix+1])-clamp(px[iy*w+ix-1]);}
        if(iy>0&&iy<h-1){gy=clamp(px[(iy+1)*w+ix])-clamp(px[(iy-1)*w+ix]);}
        let ang=Math.atan2(-gx,gy);
        ang=ang*(1-p.speed)+prevAng*p.speed*.5+(r()-.5)*p.speed*2;
        prevAng=ang;
        cx2+=Math.cos(ang)*2;cy2+=Math.sin(ang)*2;
        if(cx2<0||cx2>=w||cy2<0||cy2>=h)break;
        const fx=Math.round(cx2),fy=Math.round(cy2);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          const pressure=1-Math.abs(t/p.strokeLen-.5)*2;
          if(v<200||r()<.2)o[fy*w+fx]=Math.min(o[fy*w+fx],clamp(255-v*pressure*.8));}
      }
    }return o;
  }});

  A.push({ id:'scribble', name:'Scribble Fill', category:'artistic', params:[
    {id:'density',label:'Density',min:.5,max:5,step:.1,default:2},
    {id:'loopSize',label:'Loop Size',min:3,max:30,step:1,default:10},
    {id:'chaos',label:'Chaos',min:0,max:1,step:.05,default:.4},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const sp=Math.max(2,Math.round(8/p.density));
    for(let sy=0;sy<h;sy+=sp)for(let sx=0;sx<w;sx+=sp){
      const v=clamp(px[Math.min(h-1,sy)*w+Math.min(w-1,sx)])/255;
      if(v>.9)continue;
      const loops=Math.ceil((1-v)*p.density*3);
      let cx2=sx+r()*sp,cy2=sy+r()*sp;
      for(let l=0;l<loops;l++){
        const ang0=r()*Math.PI*2;const rad=p.loopSize*(1-v)*.5+2;
        for(let t=0;t<20;t++){
          const a=ang0+t*.3+r()*p.chaos;
          const nx=cx2+Math.cos(a)*rad*(1+r()*p.chaos);
          const ny=cy2+Math.sin(a)*rad*(1+r()*p.chaos);
          const fx=Math.round(nx),fy=Math.round(ny);
          if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=0;
          cx2+=(r()-.5)*p.chaos*4;cy2+=(r()-.5)*p.chaos*4;
        }}
    }return o;
  }});

  A.push({ id:'ink-splatter', name:'Ink Splatter', category:'artistic', params:[
    {id:'splatCount',label:'Splats',min:20,max:800,step:10,default:100},
    {id:'maxRadius',label:'Max Radius',min:2,max:60,step:1,default:15},
    {id:'drips',label:'Drip Length',min:0,max:50,step:1,default:8},
    {id:'droplets',label:'Droplet Count',min:0,max:10,step:1,default:5},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let s=0;s<p.splatCount;s++){
      const cx2=Math.floor(r()*w),cy2=Math.floor(r()*h);
      const v=clamp(px[cy2*w+cx2])/255;
      if(v>.7&&r()>.3)continue;
      const rad=p.maxRadius*(1-v)*(r()*.5+.5);
      for(let dy=-rad-2;dy<=rad+2;dy++)for(let dx=-rad-2;dx<=rad+2;dx++){
        const dist=Math.sqrt(dx*dx+dy*dy)+r()*3-1.5;
        if(dist<=rad){const fx=cx2+dx,fy=cy2+dy;
          if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=0;}}
      const drops=Math.floor(r()*5*(1-v));
      for(let d=0;d<drops;d++){
        const da=r()*Math.PI*2,dd=rad+r()*rad;
        const dr2=r()*3+1;
        const dcx=Math.round(cx2+Math.cos(da)*dd),dcy=Math.round(cy2+Math.sin(da)*dd);
        for(let dy=-dr2;dy<=dr2;dy++)for(let dx=-dr2;dx<=dr2;dx++){
          if(dx*dx+dy*dy<=dr2*dr2){const fx=dcx+dx,fy=dcy+dy;
            if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=0;}}}
      if(p.drips>0){const dLen=Math.floor(r()*p.drips*(1-v));
        for(let d=0;d<dLen;d++){const dx=cx2+Math.floor(r()*rad*2-rad);
          const dy2=cy2+Math.floor(rad)+d;
          if(dx>=0&&dx<w&&dy2>=0&&dy2<h)o[dy2*w+dx]=r()<.7?0:128;}}
    }return o;
  }});

  A.push({ id:'color-blots', name:'Color Blots', category:'artistic', params:[
    {id:'blotCount',label:'Blots',min:50,max:500,step:25,default:150},
    {id:'blotSize',label:'Blot Size',min:4,max:30,step:1,default:12},
    {id:'opacity',label:'Opacity',min:.2,max:1,step:.05,default:.7},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    for(let i=0;i<w*h;i++) o[i]=clamp(px[i]*.3+180);
    const r=mkRand(p.seed);
    for(let b=0;b<p.blotCount;b++){
      const cx2=Math.floor(r()*w),cy2=Math.floor(r()*h);
      const srcV=clamp(px[cy2*w+cx2]);
      const rad=p.blotSize*(r()*.5+.5);
      for(let dy=-rad-3;dy<=rad+3;dy++)for(let dx=-rad-3;dx<=rad+3;dx++){
        const dist=Math.sqrt(dx*dx+dy*dy)+(r()-.5)*rad*.4;
        if(dist<=rad){const fx=cx2+Math.round(dx),fy=cy2+Math.round(dy);
          if(fx>=0&&fx<w&&fy>=0&&fy<h){
            const edgeFade=Math.max(0,1-dist/rad);
            const alpha=edgeFade*p.opacity;
            o[fy*w+fx]=clamp(o[fy*w+fx]*(1-alpha)+srcV*alpha);
          }}}
    }return o;
  }});

  A.push({ id:'rough-pencil', name:'Rough Pencil', category:'artistic', params:[
    {id:'strokes',label:'Strokes',min:1000,max:10000,step:500,default:4000},
    {id:'pressure',label:'Pressure',min:.3,max:1,step:.05,default:.7},
    {id:'angle',label:'Hatching Angle',min:0,max:180,step:5,default:135},
    {id:'variation',label:'Angle Variation',min:0,max:90,step:5,default:30},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const baseAng=p.angle*Math.PI/180;
    for(let i=0;i<p.strokes;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);
      const v=clamp(px[y*w+x])/255;
      if(r()>1-v+.1)continue;
      const ang=baseAng+(r()-.5)*p.variation*Math.PI/90;
      const len=(1-v)*12+3;const dx=Math.cos(ang),dy=Math.sin(ang);
      for(let t=-len/2;t<len/2;t++){
        const fx=Math.round(x+dx*t+(r()-.5)*.8);
        const fy=Math.round(y+dy*t+(r()-.5)*.8);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          const mark=clamp(255-(1-v)*255*p.pressure*(1-Math.abs(t/len)));
          o[fy*w+fx]=Math.min(o[fy*w+fx],mark);
        }}
    }return o;
  }});

  A.push({ id:'dry-brush-strokes', name:'Dry Brush', category:'artistic', params:[
    {id:'strokeLen',label:'Stroke Length',min:5,max:50,step:1,default:20},
    {id:'width',label:'Width',min:2,max:12,step:1,default:5},
    {id:'dryness',label:'Dryness',min:0,max:1,step:.05,default:.5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const sp=Math.max(2,Math.round(p.width*1.5));
    for(let sy=0;sy<h;sy+=sp)for(let sx=0;sx<w;sx+=sp){
      const v=clamp(px[Math.min(h-1,sy)*w+Math.min(w-1,sx)]);
      if(v>220&&r()>.2)continue;
      let ang=r()*Math.PI;
      const ix=Math.min(w-2,Math.max(1,sx)),iy=Math.min(h-2,Math.max(1,sy));
      const gx=clamp(px[iy*w+ix+1])-clamp(px[iy*w+ix-1]);
      const gy=clamp(px[(iy+1)*w+ix])-clamp(px[(iy-1)*w+ix]);
      ang=Math.atan2(gx,-gy)+(r()-.5)*.5;
      const dx=Math.cos(ang),dy=Math.sin(ang);
      for(let t=-p.strokeLen/2;t<p.strokeLen/2;t++){
        for(let ww=-p.width/2;ww<p.width/2;ww++){
          if(r()<p.dryness*.6)continue;
          const fx=Math.round(sx+dx*t-dy*ww+(r()-.5));
          const fy=Math.round(sy+dy*t+dx*ww+(r()-.5));
          if(fx>=0&&fx<w&&fy>=0&&fy<h){o[fy*w+fx]=Math.min(o[fy*w+fx],v);}
        }}
    }return o;
  }});

  A.push({ id:'blind-contour', name:'Blind Contour', category:'artistic', params:[
    {id:'lines',label:'Lines',min:20,max:200,step:10,default:60},
    {id:'lineLen',label:'Line Length',min:50,max:500,step:25,default:200},
    {id:'wobble',label:'Wobble',min:0,max:1,step:.05,default:.5},
    {id:'edgeSensitivity',label:'Edge Sensitivity',min:.5,max:3,step:.1,default:1.5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let l=0;l<p.lines;l++){
      let cx2=r()*w,cy2=r()*h;
      for(let tries=0;tries<20;tries++){
        const ix=Math.max(1,Math.min(w-2,Math.round(cx2))),iy=Math.max(1,Math.min(h-2,Math.round(cy2)));
        const gx=clamp(px[iy*w+ix+1])-clamp(px[iy*w+ix-1]),gy=clamp(px[(iy+1)*w+ix])-clamp(px[(iy-1)*w+ix]);
        if(Math.sqrt(gx*gx+gy*gy)>30*p.edgeSensitivity)break;
        cx2=r()*w;cy2=r()*h;}
      for(let t=0;t<p.lineLen;t++){
        const ix=Math.max(1,Math.min(w-2,Math.round(cx2))),iy=Math.max(1,Math.min(h-2,Math.round(cy2)));
        const gx=clamp(px[iy*w+ix+1])-clamp(px[iy*w+ix-1]);
        const gy=clamp(px[(iy+1)*w+ix])-clamp(px[(iy-1)*w+ix]);
        const ang=Math.atan2(-gx,gy);
        cx2+=Math.cos(ang)*1.5+(r()-.5)*p.wobble*3;
        cy2+=Math.sin(ang)*1.5+(r()-.5)*p.wobble*3;
        if(cx2<0||cx2>=w||cy2<0||cy2>=h)break;
        const fx=Math.round(cx2),fy=Math.round(cy2);
        if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=0;
      }
    }return o;
  }});

  A.push({ id:'charcoal', name:'Charcoal', category:'artistic', params:[
    {id:'grain',label:'Grain',min:0,max:1,step:.05,default:.5},
    {id:'smudge',label:'Smudge',min:0,max:1,step:.05,default:.3},
    {id:'darkness',label:'Darkness',min:.5,max:3,step:.05,default:1.2},
    {id:'patchiness',label:'Patchiness',min:0,max:.5,step:.02,default:.1},
    {id:'blurRadius',label:'Smudge Radius',min:1,max:10,step:1,default:5},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      let v=clamp(px[i])/255;
      v=Math.pow(v,p.darkness);
      const grain=(r()-.5)*p.grain*80;
      const patch=r()<p.patchiness?40:0;
      o[i]=clamp(v*255+grain+patch);
    }
    if(p.smudge>0){
      const rad=Math.round(p.blurRadius*p.smudge);
      const tmp=new Uint8ClampedArray(o);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        let sum=0,n2=0;
        for(let dx=-rad;dx<=rad;dx++){
          const nx=x+dx;if(nx>=0&&nx<w){sum+=tmp[y*w+nx];n2++;}
        }
        o[y*w+x]=clamp(sum/n2*p.smudge+tmp[y*w+x]*(1-p.smudge));
      }
    }
    if(p.invert) for(let i=0;i<w*h;i++) o[i]=255-o[i];
    return o;
  }});

  A.push({ id:'watercolor', name:'Watercolor Wash', category:'artistic', params:[
    {id:'wetness',label:'Wetness',min:1,max:15,step:1,default:6},
    {id:'pigment',label:'Pigment',min:.3,max:1,step:.05,default:.7},
    {id:'bleed',label:'Edge Bleed',min:0,max:1,step:.05,default:.4},
    {id:'paperGrain',label:'Paper Grain',min:0,max:50,step:1,default:15},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    // Wet-on-wet blur
    const buf=new Float32Array(px);
    const rad=p.wetness;
    const tmp=new Float32Array(w*h);
    // Blur pass
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let sum=0,n2=0;
      for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
        const nx=x+dx,ny=y+dy;
        if(nx>=0&&nx<w&&ny>=0&&ny<h){sum+=buf[ny*w+nx];n2++;}
      }
      tmp[y*w+x]=sum/n2;
    }
    // Pigment pooling at edges
    for(let i=0;i<w*h;i++){
      let v=tmp[i]*p.pigment+buf[i]*(1-p.pigment);
      // Paper grain
      v+=((r()-.5)*p.paperGrain);
      // Edge bleed: darken edges where gradient is high
      const x=i%w,y=Math.floor(i/w);
      if(x>0&&x<w-1&&y>0&&y<h-1){
        const gx=Math.abs(buf[i+1]-buf[i-1]);
        const gy=Math.abs(buf[i+w]-buf[i-w]);
        v-=(gx+gy)*p.bleed*0.1;
      }
      o[i]=clamp(v);
    }
    return o;
  }});

  A.push({ id:'ink-wash', name:'Ink Wash', category:'artistic', params:[
    {id:'layers',label:'Layers',min:1,max:6,step:1,default:3},
    {id:'spread',label:'Spread',min:2,max:12,step:1,default:5},
    {id:'opacity',label:'Layer Opacity',min:.2,max:.8,step:.05,default:.4},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const buf=new Float32Array(w*h);buf.fill(255);
    for(let layer=0;layer<p.layers;layer++){
      const threshold=255*(layer+1)/(p.layers+1);
      const rad=p.spread*(1+layer*0.5);
      for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){
        const v=clamp(px[y*w+x]);
        if(v>threshold)continue;
        // Spread wash
        const washR=rad*(1+r()*0.5);
        for(let dy=-washR;dy<=washR;dy++)for(let dx=-washR;dx<=washR;dx++){
          const fx=x+Math.round(dx+(r()-.5)*3),fy=y+Math.round(dy+(r()-.5)*3);
          if(fx>=0&&fx<w&&fy>=0&&fy<h){
            const dist=Math.sqrt(dx*dx+dy*dy);
            const fade=Math.max(0,1-dist/washR);
            buf[fy*w+fx]=Math.min(buf[fy*w+fx],buf[fy*w+fx]*(1-fade*p.opacity)+v*fade*p.opacity);
          }
        }
      }
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  // ═══════════════════════════════════════════
  // RECONSTRUCTIVE (6) — paintstroke-by-paintstroke
  // ═══════════════════════════════════════════
  A.push({ id:'oil-paint', name:'Oil Paint', category:'reconstructive', params:[
    {id:'brushSize',label:'Brush Size',min:2,max:20,step:1,default:6},
    {id:'detail',label:'Detail Passes',min:1,max:6,step:1,default:3},
    {id:'strokeLength',label:'Stroke Length',min:.3,max:2,step:.1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    // Start blank
    const buf=new Float32Array(w*h);buf.fill(200);
    // Multiple passes with decreasing brush size
    for(let pass=0;pass<p.detail;pass++){
      const bs=Math.max(1,Math.round(p.brushSize/(pass+1)));
      const sp=Math.max(1,Math.round(bs*0.7));
      for(let y=0;y<h;y+=sp)for(let x=0;x<w;x+=sp){
        // Sample source color at this point
        const sx=Math.min(w-1,x+Math.round((r()-.5)*bs));
        const sy=Math.min(h-1,Math.max(0,y+Math.round((r()-.5)*bs)));
        const srcV=clamp(px[sy*w+sx]);
        // Edge direction for stroke angle
        const e=sobelAt(px,Math.min(w-2,Math.max(1,x)),Math.min(h-2,Math.max(1,y)),w,h);
        const ang=e.ang+Math.PI/2; // Along edge
        const len=bs*2*(0.5+r()*0.5);
        const dx=Math.cos(ang),dy=Math.sin(ang);
        // Paint stroke
        for(let t=-len/2;t<len/2;t++){
          for(let ww=-bs/3;ww<bs/3;ww++){
            const fx=Math.round(x+dx*t-dy*ww+(r()-.5));
            const fy=Math.round(y+dy*t+dx*ww+(r()-.5));
            if(fx>=0&&fx<w&&fy>=0&&fy<h){
              const edgeFade=1-Math.abs(t)/(len/2);
              const brushFade=1-Math.abs(ww)/(bs/3);
              const alpha=edgeFade*brushFade*0.8;
              buf[fy*w+fx]=buf[fy*w+fx]*(1-alpha)+srcV*alpha;
            }
          }
        }
      }
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  A.push({ id:'pointillism', name:'Pointillism', category:'reconstructive', params:[
    {id:'dotSize',label:'Dot Size',min:2,max:15,step:1,default:4},
    {id:'density',label:'Density',min:.2,max:1,step:.05,default:.7},
    {id:'jitter',label:'Color Jitter',min:0,max:60,step:1,default:15},
    {id:'background',label:'Background',min:200,max:255,step:1,default:240},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(240);const r=mkRand(p.seed);
    const ds=p.dotSize;
    for(let y=0;y<h;y+=Math.max(1,Math.round(ds*0.7)))
      for(let x=0;x<w;x+=Math.max(1,Math.round(ds*0.7))){
        if(r()>p.density)continue;
        const jx=Math.round((r()-.5)*ds);
        const jy=Math.round((r()-.5)*ds);
        const sx=Math.min(w-1,Math.max(0,x+jx));
        const sy=Math.min(h-1,Math.max(0,y+jy));
        const srcV=clamp(px[sy*w+sx])+(r()-.5)*p.jitter*2;
        const dotR=ds*(0.3+r()*0.7);
        for(let dy=-ds;dy<=ds;dy++)for(let dx=-ds;dx<=ds;dx++){
          const dist=Math.sqrt(dx*dx+dy*dy);
          if(dist<dotR){
            const fx=x+jx+dx,fy=y+jy+dy;
            if(fx>=0&&fx<w&&fy>=0&&fy<h){
              const fade=1-dist/dotR;
              o[fy*w+fx]=clamp(o[fy*w+fx]*(1-fade*0.8)+srcV*fade*0.8);
            }
          }
        }
    }
    return o;
  }});

  A.push({ id:'palette-knife', name:'Palette Knife', category:'reconstructive', params:[
    // — Reconstruction workflow —
    {id:'reconstructionStep',label:'Reconstruction Step',type:'reconstructionStep',min:0,max:6,step:1,default:6,
     labels:['1 · Underpainting','2 · Painterly sketch','3 · Broad block-in','4 · Form masses','5 · Color notes','6 · Edges + detail','7 · Final painting']},
    {id:'reconstructionLayers',label:'Edit Current Step',type:'reconstructionLayers',default:defaultPainterLayerSettings()},
    {id:'constructionStyle',label:'Construction Style',type:'select',options:[
      {value:'angular',label:'Angular painter sketch'},
      {value:'form',label:'Form-following sketch'},
      {value:'hybrid',label:'Hybrid sketch'}
    ],default:'angular'},
    {id:'constructionLines',label:'Construction Lines',min:0,max:1,step:.05,default:.5},
    {id:'constructionScope',label:'Sketch Scope',type:'select',options:[
      {value:'both',label:'Outline + form lines'},
      {value:'external',label:'Outline only (silhouette)'},
      {value:'internal',label:'Form lines only (interior)'},
      {value:'outline-bias',label:'Mostly outline'},
      {value:'form-bias',label:'Mostly form lines'}
    ],default:'both'},
    {id:'constructionLineColor',label:'Line Color',type:'select',options:[
      {value:'auto',label:'Auto (contrast vs canvas)'},
      {value:'dark',label:'Dark charcoal'},
      {value:'light',label:'Chalk on dark'},
      {value:'source',label:'Match source tone'},
      {value:'complement',label:'Push toward complement'},
      {value:'ink',label:'Ink (max contrast)'}
    ],default:'auto'},
    {id:'constructionDetail',label:'Sketch Detail',min:0.1,max:1,step:.05,default:.5},
    {id:'constructionAngularOutline',label:'Angular Outline',type:'checkbox',default:false},
    {id:'blockInStrength',label:'Broad Block-In',min:0,max:1.5,step:.05,default:.72},
    {id:'edgeFinish',label:'Soft ↔ Hard Edges',min:-1,max:1,step:.05,default:.25},
    // — Core shape —
    {id:'size',label:'Knife Size',min:4,max:40,step:1,default:10},
    {id:'smear',label:'Smear Length',min:5,max:100,step:1,default:15},
    {id:'pressure',label:'Pressure',min:.1,max:1.5,step:.05,default:.9},
    // — Pixel-paint behavior (NEW defaults are crisp/dithered, like paint engine) —
    {id:'strokeStyle',label:'Stroke Style',type:'select',options:[
      {value:'pixel',label:'Pixel (sharp, dithered, samples source)'},
      {value:'blend',label:'Blend (smooth/legacy)'}
    ],default:'pixel'},
    {id:'coverageDensity',label:'Coverage Density',min:.1,max:1,step:.05,default:.85},
    {id:'sampleDrift',label:'Sample Drift',min:0,max:1,step:.05,default:.55},
    {id:'sampleJitter',label:'Sample Jitter (px)',min:0,max:12,step:.5,default:2},
    {id:'canvasStart',label:'Canvas',type:'select',options:[
      {value:'underpaint',label:'Painterly underpaint (wash + oriented strokes)'},
      {value:'source',label:'From source (filter feel)'},
      {value:'clean',label:'From blank canvas'}
    ],default:'underpaint'},
    {id:'bgTone',label:'Blank BG Tone',min:0,max:255,step:1,default:255},
    // — Underpaint customization —
    // Only active when Canvas = "Painterly underpaint". The wash + oriented
    // strokes that get laid down before the main algorithm paints over them.
    {id:'underpaintBlock',label:'Underpaint Stroke Scale',min:4,max:40,step:1,default:14},
    {id:'underpaintNoise',label:'Underpaint Wash Noise',min:0,max:2,step:.05,default:1,
     hint:'grit in the tonal wash · 0 = smooth bilinear · 2 = gritty'},
    {id:'underpaintSmoothness',label:'Underpaint Wash ↔ Source',min:0,max:1,step:.05,default:0,
     hint:'0 = broad block wash · 1 = tighter source luminance'},
    {id:'underpaintDensity',label:'Underpaint Stroke Density',min:.3,max:3,step:.05,default:1},
    {id:'underpaintSize',label:'Underpaint Stroke Size',min:.3,max:3,step:.05,default:1},
    {id:'underpaintDetail',label:'Underpaint Detail Response',min:0,max:2,step:.05,default:1,
     hint:'how strongly detail drives stroke size + density'},
    {id:'underpaintAngle',label:'Underpaint Angle Jitter',min:0,max:1.5,step:.05,default:.8},
    {id:'underpaintStrength',label:'Underpaint Stroke Strength',min:0,max:1,step:.05,default:1,
     hint:'0 = wash only · 1 = hard painterly strokes'},
    {id:'underpaintDetailPreserve',label:'Underpaint Subject Detail',min:0,max:1,step:.05,default:.5,
     hint:'0 = broad wash everywhere · 1 = busy areas reconstruct with smaller strokes and sketch detail'},
    // — Detail awareness (human-like placement) —
    {id:'detailAware',label:'Detail Awareness',min:0,max:2,step:.05,default:1},
    {id:'sizeByDetail',label:'Size by Detail',min:0,max:1.5,step:.05,default:.8,
     hint:'bigger strokes in flat areas, smaller on features'},
    {id:'skipSmoothAreas',label:'Skip Smooth Areas',min:0,max:1,step:.05,default:.4},
    // formFollow: bipolar aesthetic slider.
    //   +1 → strokes track image gradients tightly (clean curves along
    //        forms, minimal angle jitter, stroke length shortens on edges
    //        so they hug contours instead of overshooting).
    //    0 → neutral, current behavior.
    //   -1 → strokes become angular / chunky — angle quantized to 8
    //        directions and jitter amplified, so strokes meet at hard
    //        corners rather than flowing along curves. Reads as block-
    //        print / woodcut / abstracted brushwork.
    {id:'formFollow',label:'Angular ↔ Form-Follow',min:-1,max:1,step:.05,default:0},
    // — Wet paint (bleed/streak/smudge) —
    {id:'wetBleed',label:'Wet Bleed',min:0,max:1,step:.05,default:0},
    {id:'wetSmudge',label:'Wet Smudge',min:0,max:1,step:.05,default:0},
    {id:'wetStreak',label:'Wet Streak',min:0,max:1,step:.05,default:0},
    {id:'colorVariety',label:'Color Variety (multi-color stroke)',min:0,max:1,step:.05,default:.2},
    {id:'smartColorJitter',label:'Smart Color Jitter',min:0,max:1,step:.05,default:.4,
     hint:'Photoshop-like color notes placed mostly in saturated/detail/edge zones'},
    // — Intensity & layering —
    {id:'intensity',label:'Intensity',min:.3,max:3,step:.05,default:1.2},
    {id:'layers',label:'Layered Passes',min:1,max:6,step:1,default:1,
     hint:'1 = loose block-in only. More passes progressively revisit only important detail and edges with smaller, smarter strokes.'},
    // — Light/shadow/edge sensitivity —
    {id:'edgeSensitivity',label:'Edge Sensitivity',min:0,max:2,step:.05,default:0},
    {id:'lightShadowBias',label:'Light/Shadow Bias',min:-1,max:1,step:.05,default:0},
    {id:'sizeByLight',label:'Size from Luminance',min:-1,max:1,step:.05,default:0},
    {id:'lengthByEdge',label:'Length from Edge',min:0,max:1,step:.05,default:0},
    {id:'pressureByEdge',label:'Pressure from Edge',min:0,max:1,step:.05,default:0},
    // — Stroke randomness / per-stroke variety (parity with Impressionism) —
    {id:'angleJitter',label:'Angle Jitter',min:0,max:2,step:.05,default:.5},
    {id:'pressureJitter',label:'Pressure Jitter',min:0,max:1,step:.05,default:0},
    {id:'sizeJitter',label:'Size Jitter',min:0,max:1,step:.05,default:0},
    {id:'lengthJitter',label:'Length Jitter',min:0,max:1,step:.05,default:0},
    {id:'scatter',label:'Position Scatter',min:0,max:30,step:.5,default:0,
     hint:'px offset per stroke position'},
    {id:'impurities',label:'Impurities (tone jitter)',min:0,max:1,step:.05,default:0,
     hint:'dirty-paint tone shift per stroke'},
    {id:'strokeCurve',label:'Stroke Curve',min:0,max:1,step:.05,default:0,
     hint:'bends the smear path along its length'},
    // — Dark-first / adaptive (parity with Impressionism) —
    {id:'adaptiveDensity',label:'Adaptive Density (detail)',min:0,max:2,step:.05,default:0,
     hint:'extra strokes in busy areas beyond skipSmooth'},
    {id:'edgeBreak',label:'Edge Break (stop at edges)',min:0,max:1,step:.05,default:0},
    {id:'darkStrokeWeight',label:'Dark-First Weight',min:0,max:1,step:.05,default:0,
     hint:'paints dark areas before light'},
    {id:'opacityByLum',label:'Opacity by Luminance',min:0,max:1,step:.05,default:0,
     hint:'darker = more opaque, lighter = translucent'},
    // — Blend-mode legacy control —
    {id:'colorPickup',label:'Color Pickup (blend only)',min:-1,max:1,step:.05,default:0},
    // — Brush shape —
    // Dab shape is now either the built-in knife-edge ellipse (default) or
    // whatever the Custom Brushes panel below dispatches per-stroke. No more
    // mid-tier dropdown — keeps the mental model clean.
    // — CUSTOM BRUSH mode —
    // When enabled, the algorithm dispatches different brushes per
    // tonal zone (shadow/mid/highlight) + an edge-override brush,
    // based on local luminance and Sobel edge magnitude at each
    // stroke position. Each zone picks its own brush mask (built-in
    // from PaintEngine, a user-drawn stamp, or a source-image patch)
    // with independent size-multiplier, angle-jitter, and opacity.
    // buildPipeline() in app.js pre-resolves the brush specs into
    // `_resolvedMask*` fields on this object before handing it off.
    {id:'customBrushes',label:'Custom Brushes',type:'customBrushes',default: {
      enabled: false,
      shadowHi: 85, midHi: 170,
      edgeEnabled: true, edgeThreshold: 80,
      ditherBand: 30,
      shadow: { source:'builtin', builtin:'1', brushId:'', sizeMul:1.4, angleJitter:0.3, opacity:1.0 },
      mid:    { source:'builtin', builtin:'7', brushId:'', sizeMul:1.0, angleJitter:0.5, opacity:0.95 },
      high:   { source:'builtin', builtin:'5', brushId:'', sizeMul:0.7, angleJitter:0.6, opacity:0.85 },
      edge:   { source:'builtin', builtin:'6', brushId:'', sizeMul:0.9, angleJitter:0.1, opacity:1.0 }
    }},
    // — If/Then Rules —
    // User-defined post-pass rules. See `applyRules` for conditions/actions.
    {id:'rules',label:'If/Then Rules',type:'rules',default:[]},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    // Sync drain: runs the generator to completion with no yields. Zero
    // behavioral diff vs. the original synchronous body.
    const gen = this._gen(px, w, h, p);
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  },
  // Cooperative async variant: yields between chunks of rows and between
  // layers. Checks signal.cancelled at each yield point and calls onProgress
  // with a snapshot of the in-progress canvas so the UI can paint block-by-
  // block progress instead of freezing. Same output as apply().
  //
  // signal.interactive === true marks this as a preview-tier render —
  // _gen uses lighter knobs (smaller stamp cap, coarser stride, shorter
  // smear) so slider drag feels instant. The final render (interactive=
  // false) keeps full quality.
  async applyAsync(px, w, h, p, ctx) {
    const signal = (ctx && ctx.signal) || { cancelled: false };
    const onProgress = (ctx && ctx.onProgress) || null;
    const preview = !!signal.interactive;
    const gen = this._gen(px, w, h, p, preview);
    let r = gen.next();
    let lastProg = 0;
    // In PREVIEW mode the algorithm is already sized down to finish in
    // ~100-300ms of pure compute. Doing a setTimeout(0) yield after every
    // stroke chunk (40 strokes) adds 4ms × ~50 chunks = ~200ms of deadweight
    // that dwarfs the actual work. Worse, browsers clamp nested setTimeout
    // to 4ms minimum, so the overhead compounds. Skip the yields entirely
    // in preview — cooperative cancellation isn't worth the cost because
    // the whole render finishes fast enough to feel instant. Final renders
    // keep the yields so onProgress paints block-by-block.
    if (preview) {
      while (!r.done) {
        if (signal.cancelled) { try { gen.return(); } catch(_){} return r.value || new Uint8ClampedArray(w*h); }
        r = gen.next();
      }
      return r.value;
    }
    while (!r.done) {
      if (signal.cancelled) { try { gen.return(); } catch(_){} return r.value || new Uint8ClampedArray(w*h); }
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (onProgress && r.value && now - lastProg > 60) {
        lastProg = now;
        onProgress(new Uint8ClampedArray(r.value));
      }
      await new Promise(res => setTimeout(res, 0));
      r = gen.next();
    }
    return r.value;
  },
  *_gen(px, w, h, p, preview) {
    const o = new Uint8ClampedArray(w*h);
    const PREVIEW = !!preview;

    // Canvas-relative size multiplier. All brush/stroke pixel knobs below
    // (knife size, smear length, underpaint block, sample jitter) were
    // tuned for a ~720px canvas. Without scaling, a 10px knife on a 1600×
    // 1600 image reads as stippling while the same 10px knife on a 200×200
    // image dominates the frame. sqrt(area)/REF gives the same effective
    // footprint-as-fraction-of-canvas across sizes. Clamped so extreme
    // aspect ratios don't produce absurd values.
    const canvasScale = Math.max(0.5, Math.min(3.0, Math.sqrt(w * h) / 720));

    const strokeStyle = p.strokeStyle || 'pixel';
    const intensity     = (p.intensity     != null) ? p.intensity     : 1;
    const layers        = Math.max(1, (p.layers    != null) ? p.layers|0 : 1);
    const edgeSens      = (p.edgeSensitivity != null) ? p.edgeSensitivity : 0;
    const lsBias        = (p.lightShadowBias != null) ? p.lightShadowBias : 0;
    const sizeByLight   = (p.sizeByLight  != null) ? p.sizeByLight  : 0;
    const lengthByEdge  = (p.lengthByEdge != null) ? p.lengthByEdge : 0;
    const pressureByEdge= (p.pressureByEdge != null) ? p.pressureByEdge : 0;
    const angleJitter   = (p.angleJitter  != null) ? p.angleJitter  : 0.5;
    const pressureJit   = (p.pressureJitter != null) ? p.pressureJitter : 0;
    const coverageDensity = (p.coverageDensity != null) ? p.coverageDensity : 0.85;
    const sampleDrift   = (p.sampleDrift  != null) ? p.sampleDrift  : 0.55;
    // sampleJitter is a pixel distance → scale with canvas so the jitter
    // radius stays a consistent fraction of stroke width on any canvas.
    const sampleJitter  = ((p.sampleJitter != null) ? p.sampleJitter : 2) * canvasScale;
    const canvasStart   = p.canvasStart || 'underpaint';
    const bgTone        = (p.bgTone != null) ? p.bgTone : 255;
    // Scale underpaint block size so the wash granularity + stroke length
    // grow proportionally on larger canvases.
    const underpaintBlock = Math.max(2, Math.round(((p.underpaintBlock != null) ? p.underpaintBlock : 14) * canvasScale));
    const colorPickup   = (p.colorPickup != null) ? p.colorPickup : 0;
    // — Parity-with-impressionism params —
    const sizeJitter      = (p.sizeJitter      != null) ? p.sizeJitter      : 0;
    const lengthJitter    = (p.lengthJitter    != null) ? p.lengthJitter    : 0;
    const scatter         = ((p.scatter        != null) ? p.scatter         : 0) * canvasScale;
    const impurities      = (p.impurities      != null) ? p.impurities      : 0;
    const strokeCurve     = (p.strokeCurve     != null) ? p.strokeCurve     : 0;
    const adaptiveDensity = (p.adaptiveDensity != null) ? p.adaptiveDensity : 0;
    const edgeBreakAmt    = (p.edgeBreak       != null) ? p.edgeBreak       : 0;
    const darkStrokeWeight= (p.darkStrokeWeight!= null) ? p.darkStrokeWeight: 0;
    const opacityByLum    = (p.opacityByLum    != null) ? p.opacityByLum    : 0;
    const detailAware    = (p.detailAware     != null) ? p.detailAware     : 1;
    const sizeByDetail   = (p.sizeByDetail    != null) ? p.sizeByDetail    : 0.8;
    const skipSmoothAreas= (p.skipSmoothAreas != null) ? p.skipSmoothAreas : 0.4;
    const formFollow     = (p.formFollow      != null) ? p.formFollow      : 0;
    const wetBleed       = (p.wetBleed        != null) ? p.wetBleed        : 0;
    const wetSmudge      = (p.wetSmudge       != null) ? p.wetSmudge       : 0;
    const wetStreak      = (p.wetStreak       != null) ? p.wetStreak       : 0;
    const colorVariety   = (p.colorVariety    != null) ? p.colorVariety    : 0.2;
    const brushShape    = p.brushShape || 'default';
    const seedI         = (p.seed|0) || 42;

    // Spatial hash → [0,1). Deterministic per (x,y,k); identical across RGB
    // channels in color mode so stroke samples come from the SAME source
    // positions in R, G, B — producing real multi-color strokes.
    function sh(a, b, k) {
      let h = Math.imul((a|0) + 374761393, 0x9E3779B1) ^
              Math.imul((b|0) + 2246822519, 0x85EBCA77) ^
              Math.imul((k|0) + 3266489917, 0xC2B2AE3D) ^ seedI;
      h = Math.imul(h ^ (h >>> 15), 0x85EBCA77);
      h = Math.imul(h ^ (h >>> 13), 0xC2B2AE3D);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    // PaintEngine brush mask
    let bMask = null, bSize = 0;
    if (brushShape !== 'default' && typeof PaintEngine !== 'undefined' && PaintEngine.getBrushMask) {
      const bi = parseInt(brushShape, 10);
      if (!isNaN(bi)) {
        const b = PaintEngine.getBrushMask(bi);
        if (b) { bMask = b.mask; bSize = b.size; }
      }
    }

    // — CUSTOM BRUSH dispatch config —
    // Per-stroke brush selection: look up luminance + Sobel edge at each
    // stroke origin, route to one of four brush slots (shadow/mid/high/
    // edge-override). Each slot carries its own mask + size + sizeMul +
    // opacity + angleJitter so tonal regions paint with different
    // character. app.js resolves the brush specs into `_resolvedMask*`
    // fields before calling; if resolution failed (brush missing), the
    // slot falls back to the default bMask/bSize so the stroke still
    // paints instead of vanishing.
    const cb = p.customBrushes || null;
    const cbEnabled = !!(cb && cb.enabled);
    const cbShadowHi  = (cb && cb.shadowHi  != null) ? cb.shadowHi  : 85;
    const cbMidHi     = (cb && cb.midHi     != null) ? cb.midHi     : 170;
    const cbEdgeEn    = !!(cb && cb.edgeEnabled);
    const cbEdgeThr   = (cb && cb.edgeThreshold != null) ? cb.edgeThreshold : 80;
    const cbDither    = (cb && cb.ditherBand != null) ? cb.ditherBand : 30;
    function _slotMask(name) {
      const r = cb && cb['_resolvedMask' + name];
      return r && r.mask ? { m: r.mask, s: r.size } : { m: bMask, s: bSize };
    }
    const cbShadowMI = cbEnabled ? _slotMask('Shadow') : { m: bMask, s: bSize };
    const cbMidMI    = cbEnabled ? _slotMask('Mid')    : { m: bMask, s: bSize };
    const cbHighMI   = cbEnabled ? _slotMask('High')   : { m: bMask, s: bSize };
    const cbEdgeMI   = cbEnabled ? _slotMask('Edge')   : { m: bMask, s: bSize };
    const cbShadow = cb && cb.shadow;
    const cbMid    = cb && cb.mid;
    const cbHigh   = cb && cb.high;
    const cbEdge   = cb && cb.edge;

    // Legacy blend mode keeps the old alpha-blend path (documented as a
    // non-default fallback for users who want the smooth feel).
    if (strokeStyle === 'blend') {
      return _paletteKnifeBlend(px, w, h, p, {
        intensity, layers, edgeSens, lsBias, sizeByLight, lengthByEdge,
        pressureByEdge, angleJitter, pressureJit, colorPickup, bMask, bSize
      });
    }

    // PIXEL mode — sharp, dithered, real source pixels in every stroke.
    // Precompute edge field + detail field once — the old code was calling
    // sobelAt() per pixel inside hot loops, which dominated the runtime.
    // Moved above the underpaint branch so the painterly-wash step can use
    // edge orientations to lay oriented strokes.
    const sf = sobelField(px, w, h);
    const edgeMag = sf.mag, edgeAng = sf.ang;
    const stageLevel = reconstructionStepLevel(p);
    const reconUnderpaint = getPainterLayerSettings(p, 'underpaint');

    // Start canvas:
    //   'underpaint' = painterly base built from a smooth tonal wash
    //                  (downsample + bilinear upsample) plus scattered
    //                  loose oriented strokes sampling source color.
    //                  Replaces the older blocky posterized mosaic —
    //                  reads as paint laid down with a broad wet brush,
    //                  not a pixel grid.
    //   'source'     = raw source (filter feel; minimal stroke coverage leaves
    //                  the image legible everywhere)
    //   'clean'      = blank bgTone (classic impressionism base, reveals paint
    //                  only where strokes land)
    if (canvasStart === 'clean') {
      for (let i = 0; i < w*h; i++) o[i] = bgTone;
    } else if (canvasStart === 'underpaint') {
      // Pass the active brush mask so underpaint strokes inherit the
      // selected Brush Shape (bristles/splatter/knife etc.) instead of
      // staying as a plain ellipse. Falls back to ellipse when bMask null.
      const _upOpts = {
        washNoise:      (p.underpaintNoise      != null) ? p.underpaintNoise      : 1,
        washSmoothness: (p.underpaintSmoothness != null) ? p.underpaintSmoothness : 0,
        density:        ((p.underpaintDensity   != null) ? p.underpaintDensity    : 1) * reconUnderpaint.density,
        sizeMul:        ((p.underpaintSize      != null) ? p.underpaintSize       : 1) * reconUnderpaint.scale,
        detailResp:     ((p.underpaintDetail    != null) ? p.underpaintDetail     : 1) * (0.72 + reconUnderpaint.detail * 0.36),
        angleJitter:    ((p.underpaintAngle     != null) ? p.underpaintAngle      : 0.8) * (0.65 + reconUnderpaint.jitter * 0.85),
        strokeStrength: ((p.underpaintStrength  != null) ? p.underpaintStrength   : 1) * reconUnderpaint.opacity,
        detailPreserve: (p.underpaintDetailPreserve != null) ? p.underpaintDetailPreserve : 0.5,
        edgeFocus: reconUnderpaint.edge,
        angularity: reconUnderpaint.angularity,
        edgeMag,
        formFollow: Math.max(formFollow, reconUnderpaint.form * 0.8),
        seed: seedI
      };
      painterlyUnderpaint(o, px, w, h, underpaintBlock, sh, edgeAng, bMask, bSize, _upOpts);
    } else {
      for (let i = 0; i < w*h; i++) o[i] = clamp(px[i]);
    }

    const constructionLines = (p.constructionLines != null) ? p.constructionLines : 0.5;
    const constructionStyle = p.constructionStyle || 'angular';
    const blockInStrength = (p.blockInStrength != null) ? p.blockInStrength : 0.72;
    const smartColorJitter = (p.smartColorJitter != null) ? p.smartColorJitter : 0.4;
    const edgeFinish = (p.edgeFinish != null) ? p.edgeFinish : 0.25;

    const needDetail = detailAware > 0 || sizeByDetail > 0 || skipSmoothAreas > 0 ||
      constructionLines > 0 || blockInStrength > 0 || smartColorJitter > 0 || edgeFinish !== 0;
    const detail = needDetail ? detailField(px, w, h, 8) : null;
    const detailNorm = detail ? 1 / Math.max(8, _advFieldStats(detail) * 0.6) : 0;
    const edgeNorm = 1 / Math.max(16, _advFieldStats(edgeMag) * 0.6);
    const layerPlan = buildPainterLayerPasses(layers, seedI ^ 0x31c3, {
      detailAware,
      sizeByDetail,
      skipSmooth: skipSmoothAreas,
      detailPreserve: (p.underpaintDetailPreserve != null) ? p.underpaintDetailPreserve : 0.5
    });
    const toneGuide = (cbEnabled || constructionLines > 0 || blockInStrength > 0 || smartColorJitter > 0)
      ? buildAdvancedSourceAnalysis(w, h, px)
      : null;
    const cbGrayMap = toneGuide && toneGuide.fields && toneGuide.fields.gray ? toneGuide.fields.gray.value : null;
    const channelHint = p._advChannelHint || 'gray';
    const reconConstruction = getPainterLayerSettings(p, 'construction');
    const reconBlock = getPainterLayerSettings(p, 'block');
    const reconForms = getPainterLayerSettings(p, 'forms');
    const reconColor = getPainterLayerSettings(p, 'color');
    const reconEdges = getPainterLayerSettings(p, 'edges');
    const reconFinish = getPainterLayerSettings(p, 'finish');
    const reconPaint = stageLevel >= 6 ? reconFinish : reconEdges;

    if (stageLevel <= 0) return o;
    if (constructionLines > 0) {
      paintConstructionSketch(o, px, w, h, edgeMag, edgeAng, detail, toneGuide, {
        strength: constructionLines,
        style: constructionStyle,
        scope: p.constructionScope || 'both',
        colorMode: p.constructionLineColor || 'auto',
        detailLevel: (p.constructionDetail != null) ? p.constructionDetail : 0.5,
        angularOutline: !!p.constructionAngularOutline,
        detailDrive: Math.min(1, detailAware / 2),
        lineScale: (0.9 + canvasScale * 0.2) * reconConstruction.scale,
        spacing: Math.max(5, underpaintBlock * 0.52),
        length: Math.max(12, underpaintBlock * 1.05) * reconConstruction.scale,
        width: (0.9 + constructionLines * 1.1) * Math.sqrt(reconConstruction.scale),
        density: reconConstruction.density,
        opacity: reconConstruction.opacity,
        jitter: reconConstruction.jitter,
        detailFocus: reconConstruction.detail,
        angularity: reconConstruction.angularity,
        form: reconConstruction.form,
        edgeFocus: reconConstruction.edge,
        structure: Math.max(reconConstruction.detail, reconConstruction.edge),
        seed: seedI ^ 0x3b7
      });
      yield o;
      if (stageLevel <= 1) return o;
    }
    if (blockInStrength > 0) {
      paintBroadMassStrokes(o, px, w, h, edgeMag, edgeAng, detail, toneGuide, sh, {
        strength: blockInStrength,
        size: Math.max(underpaintBlock, (p.size || 10) * canvasScale * 1.45) * reconBlock.scale,
        detailDrive: Math.min(1, detailAware / 2),
        formFollow: Math.max(formFollow, reconBlock.form * 0.35),
        angularity: Math.max(reconBlock.angularity, formFollow < 0 ? Math.min(1, -formFollow) : (constructionStyle === 'angular' ? 0.55 : 0.22)),
        density: reconBlock.density,
        opacity: reconBlock.opacity,
        jitter: reconBlock.jitter,
        detailFocus: reconBlock.detail,
        edgeFocus: reconBlock.edge,
        form: reconBlock.form,
        seed: seedI ^ 0x45d
      });
      yield o;
      if (stageLevel <= 2) return o;
    }

    paintBroadMassStrokes(o, px, w, h, edgeMag, edgeAng, detail, toneGuide, sh, {
      strength: Math.min(1.2, blockInStrength * 0.55 + 0.18),
      size: Math.max(5, (p.size || 10) * canvasScale * (0.82 + sizeByDetail * 0.16)) * reconForms.scale,
      detailDrive: Math.min(1, detailAware / 2),
      formFollow: Math.max(formFollow, 0.25, reconForms.form * 0.82),
      angularity: Math.max(reconForms.angularity, formFollow < 0 ? Math.min(1, -formFollow) : (constructionStyle === 'angular' ? 0.34 : 0.10)),
      density: reconForms.density,
      opacity: reconForms.opacity,
      jitter: reconForms.jitter,
      detailFocus: reconForms.detail,
      edgeFocus: reconForms.edge,
      form: reconForms.form,
      seed: seedI ^ 0x68d
    });
    yield o;
    if (stageLevel <= 3) return o;

    if (smartColorJitter > 0) {
      paintIntelligentColorJitter(o, px, w, h, toneGuide, edgeMag, edgeAng, detail, {
        strength: smartColorJitter,
        channelHint,
        spacing: Math.max(3, (p.size || 10) * canvasScale * 0.75),
        length: Math.max(4, (p.size || 10) * canvasScale * 0.9) * reconColor.scale,
        width: Math.max(0.8, (p.size || 10) * canvasScale * 0.16) * Math.sqrt(reconColor.scale),
        density: reconColor.density,
        opacity: reconColor.opacity,
        jitter: reconColor.jitter,
        detailFocus: reconColor.detail,
        edgeFocus: reconColor.edge,
        form: reconColor.form,
        angularity: reconColor.angularity,
        seed: seedI ^ 0x73a
      });
      yield o;
    }
    if (stageLevel <= 4) return o;

    const renderLayers = layers;
    const mainLayerPlan = applyPainterLayerSettingsToPlan(layerPlan, reconPaint);

    // Stride between strokes. PREVIEW widens stride (~1.5×) so the preview
    // runs on roughly half as many strokes — quality drops slightly but
    // the user can still read stroke direction + color while dragging.
    // Stroke spacing tracks effective (canvas-scaled) knife width so the
    // coverage density stays consistent across canvas sizes.
    const strokeDensityMul = Math.max(0.15, reconPaint.density);
    const baseSp = PREVIEW
      ? Math.max(3, Math.round(p.size * canvasScale * 0.8 * 1.5 / Math.sqrt(strokeDensityMul)))
      : Math.max(2, Math.round(p.size * canvasScale * 0.8 / Math.sqrt(strokeDensityMul)));

    // Stamp-pixel budget cap. Brush-shape mode does a (2*stampSz+1)^2 inner
    // loop PER smear step, so this is the single biggest knob for preview
    // speed. 10 = 441 ops/step (final quality). 4 = 81 ops/step (~5.4×
    // faster, still enough detail to convey brush character).
    // Final cap raised 10 → 18 so sizeByDetail can visibly grow strokes in
    // smooth regions. With default knifeW ~9 and smoothFactor*3 multiplier
    // reaching ~36, a cap of 10 (max stamp footprint 21×21) was hiding
    // most of the user-visible range of the slider.
    const STAMP_CAP = PREVIEW ? 4 : 18;

    // Cap smearLen for preview so long wet-streak strokes don't balloon
    // the t-loop while dragging. Max of 8 steps is still enough to show
    // directionality. Final render ignores this cap.
    const SMEAR_CAP = PREVIEW ? 8 : Infinity;

    // Chunk cadence for cooperative yielding: `yield o` lets applyAsync
    // pause the event loop + paint progress. Each yield costs ~4ms of
    // setTimeout(0) minimum in Chrome, so chunk size directly trades paint-
    // smoothness against total render time. 200 strokes/chunk ≈ 5 yields
    // per layer at typical stroke counts — enough for visible progress
    // painted block-by-block, without burning hundreds of ms on deadweight
    // timer ticks. Preview mode bypasses the yields entirely (applyAsync).
    const STROKE_CHUNK = 200;
    let strokesSinceYield = 0;

    for (let layer = 0; layer < renderLayers; layer++) {
      const layerSpec = mainLayerPlan[Math.min(mainLayerPlan.length - 1, layer)];
      const layerAng = (layers > 1)
        ? (((layerSpec.index / Math.max(1, mainLayerPlan.length - 1)) - 0.5) * Math.PI * 0.32 * (0.4 + layerSpec.t * 0.6))
        : 0;
      const ox = (layer * (baseSp >> 1)) % baseSp;
      const oy = (layer * (baseSp >> 2)) % baseSp;

      for (let yOrig = oy; yOrig < h; yOrig += baseSp) {
        for (let xOrig = ox; xOrig < w; xOrig += baseSp) {
        // scatter: nudge this stroke's origin off the stride grid so
        // successive strokes don't line up in visible rows. Matches
        // impressionism's scatter param semantics (pixel distance,
        // canvas-scaled already). We work off shadow vars (x,y) so the
        // rest of the stroke body is unchanged — the for-loop counter
        // (xOrig/yOrig) still advances by baseSp cleanly.
        let x = xOrig, y = yOrig;
        if (scatter > 0) {
          x = Math.max(0, Math.min(w-1, Math.round(xOrig + (sh(xOrig, yOrig, 95) - 0.5) * scatter * 2)));
          y = Math.max(0, Math.min(h-1, Math.round(yOrig + (sh(xOrig, yOrig, 96) - 0.5) * scatter * 2)));
        }
        const ex = Math.min(w-2, Math.max(1, x));
        const ey = Math.min(h-2, Math.max(1, y));
        const eIdx = ey * w + ex;
        const eMag = edgeMag[eIdx], eAng = edgeAng[eIdx];
        const edgeN = Math.min(1, eMag * edgeNorm);
        const lum = clamp(px[y*w+x]) / 255;

        // — Detail-aware placement: smooth-area strokes get skipped more
        //   aggressively so the knife doesn't plaster a flat sky with 50
        //   identical strokes (a human would just put a few big ones).
        let localDetail = 0;  // 0..1
        if (detail) {
          localDetail = shapeDetailSignal(
            detail[y * w + x] * detailNorm,
            Math.min(1, (detailAware / 2) * (0.72 + (layerSpec.reconDetail || 0.7) * 0.34))
          );
          const phaseTag = edgeN > 0.58 ? 'edge'
            : localDetail > 0.58 ? 'detail'
            : lum < 0.38 ? 'shadow'
            : lum > 0.72 ? 'highlight'
            : (layerSpec.t < 0.36 ? 'flat' : 'mid');
          if (!keepPainterLayerStroke(layerSpec, localDetail, edgeN, lum, sh(x, y, 119), phaseTag)) continue;
          if (skipSmoothAreas > 0) {
            const keepProb = localDetail + (1 - skipSmoothAreas * 0.8);
            if (sh(x, y, 120) > Math.min(1, keepProb)) continue;
          }
          // adaptiveDensity: extra stroke keeps in busy areas. This is
          // ADDITIVE to skipSmoothAreas — busy → pass more, flat → pass
          // fewer. Acts as a second-pass filter so pushing both sliders
          // pushes the density contrast visibly farther.
          if (adaptiveDensity > 0) {
            const densProb = 0.5 + (localDetail - 0.5) * adaptiveDensity * 0.8;
            if (sh(x, y, 121) > Math.min(1, Math.max(0.1, densProb))) continue;
          }
        }
        // darkStrokeWeight: bias toward placing strokes in dark areas
        // first (so shadows build up before highlights). Reject bright
        // pixels probabilistically as the weight grows.
        if (darkStrokeWeight > 0) {
          const darkKeep = 1 - lum * darkStrokeWeight;
          if (sh(x, y, 122) > Math.max(0.15, darkKeep)) continue;
        }

        // Per-stroke random decisions use position-hash, NOT a call-ordered
        // RNG, so R/G/B channels make identical decisions (coherent color).
        if (edgeSens > 0) {
          const accept = 1 - edgeSens * 0.5 + edgeN * edgeSens * 0.9;
          if (sh(x, y, 1) > accept) continue;
        }
        if (lsBias !== 0) {
          const target = lsBias > 0 ? lum : (1 - lum);
          if (sh(x, y, 2) > 0.3 + target * Math.abs(lsBias) * 0.7) continue;
        }

        // — CUSTOM BRUSH: per-stroke slot pick —
        // Edge override wins first (so sharp edges get their own brush even
        // in dark regions). Then boundary-dither the luminance to avoid
        // visible zone seams — a dithered ldith within cbDither px of a
        // zone boundary picks either side probabilistically, blending.
        let currMask = bMask, currSize = bSize;
        let slotSizeMul = 1, slotOpacity = 1, slotAngJit = 0;
        if (cbEnabled) {
          const lumByte = cbGrayMap ? Math.round(cbGrayMap[y * w + x]) : Math.round(lum * 255);
          if (cbEdgeEn && eMag >= cbEdgeThr) {
            currMask = cbEdgeMI.m; currSize = cbEdgeMI.s;
            if (cbEdge) {
              slotSizeMul = cbEdge.sizeMul || 1;
              slotOpacity = (cbEdge.opacity != null) ? cbEdge.opacity : 1;
              slotAngJit  = cbEdge.angleJitter || 0;
            }
          } else {
            const hv = sh(x, y, 999);
            const ldith = lumByte + (cbDither > 0 ? (hv - 0.5) * cbDither * 2 : 0);
            let spec;
            if (ldith < cbShadowHi) {
              currMask = cbShadowMI.m; currSize = cbShadowMI.s; spec = cbShadow;
            } else if (ldith < cbMidHi) {
              currMask = cbMidMI.m;    currSize = cbMidMI.s;    spec = cbMid;
            } else {
              currMask = cbHighMI.m;   currSize = cbHighMI.s;   spec = cbHigh;
            }
            if (spec) {
              slotSizeMul = spec.sizeMul || 1;
              slotOpacity = (spec.opacity != null) ? spec.opacity : 1;
              slotAngJit  = spec.angleJitter || 0;
            }
          }
        }

        // ── Angle composition ──
        //   base  = perpendicular to image gradient (eAng + π/2)
        //   jitter = angleJitter + slotAngJit, scaled by detailAware and
        //            formFollow:
        //       detailAware × localDetail  → jitter SHRINKS in busy areas
        //            (tight strokes follow fine detail crisply).
        //       formFollow > 0             → jitter SHRINKS globally
        //            (strokes hug form curves, minimal wandering).
        //       formFollow < 0             → jitter GROWS globally
        //            (loose, scattered angular stamps).
        //   layerAng is added after so multi-layer fan-out still works.
        const detailJitDamp = detail ? (1 - localDetail * detailAware * 0.65) : 1;
        const layerForm = clamp01(Math.max(0, formFollow) * 0.55 + (layerSpec.reconForm || 0) * 0.55);
        const formJitScale  = formFollow >= 0
          ? (1 - layerForm * 0.72)
          : (1 + (-formFollow) * 0.8);
        const effAngleJit   = (angleJitter + slotAngJit) * detailJitDamp * formJitScale * layerSpec.jitterMul * (0.72 + (layerSpec.reconJitter || 0.35) * 0.45);
        let ang = painterDirectionAngle(seedI ^ (layer * 0x45d), x, y, eIdx, edgeMag, edgeAng, edgeNorm, {
          cell: Math.max(baseSp * 1.8, p.size * canvasScale * (1.4 + layerSpec.broad)),
          formFollow: layerForm,
          edgeFocus: layerSpec.reconEdge || 0.5,
          angularity: (layerSpec.reconAngularity || 0) * 0.55,
          jitter: layerSpec.reconJitter || 0.35,
          divisions: 16
        }) + (sh(x, y, 3) - 0.5) * effAngleJit + layerAng;

        // Angular / painterly quantization. When formFollow is pushed
        // negative, snap the stroke angle onto one of 8 cardinal+diagonal
        // directions (22.5° increments). Strength ramps in past -0.15 so
        // small negative values still feel loose and only strong negative
        // values give the woodcut / chunky-abstract read. Blends between
        // raw and snapped angle so mid values feel organic.
        const qStrength = Math.max(
          (layerSpec.reconAngularity || 0) * 0.55,
          formFollow < -0.15 ? Math.min(1, (-formFollow - 0.15) / 0.85) : 0
        );
        ang = quantizeAngle(ang, qStrength, 16);
        const dx = Math.cos(ang), dy = Math.sin(ang);

        // Detail-aware knife size: smooth regions → bigger strokes,
        // detailed regions → smaller strokes.
        let detailSizeMul = 1;
        if (detail && sizeByDetail > 0) {
          const smoothFactor = 1 - localDetail;
          detailSizeMul = 1 + smoothFactor * sizeByDetail * 3.0;
        }
        // detailAware ALSO shrinks size in detail regions directly — so
        // even with sizeByDetail low, pushing detailAware up still tightens
        // strokes on features. Multiplicative with sizeByDetail; never
        // below 0.4× so strokes remain visible.
        if (detail && detailAware > 0) {
          detailSizeMul *= Math.max(0.4, 1 - localDetail * detailAware * 0.5);
        }

        const sizeMul = 1 + (sizeByLight > 0 ? lum : (1 - lum)) * Math.abs(sizeByLight) * 1.8;
        // Canvas-scale the raw knife width/smear so brush footprint is a
        // consistent fraction of the canvas rather than a fixed pixel size.
        // slotSizeMul applies to BOTH width and length so a big shadow brush
        // paints thick AND long strokes (matching the slot preview character)
        // and a small highlight brush paints thin AND short strokes — without
        // this the slot's "size" only changed thickness, which barely reads
        // visually because source-pixel color dominates over stamp shape.
        // sizeJitter: per-stroke random size multiplier. ±sizeJitter*0.75
        // swing keeps it visible but not destroying the base size.
        const sizeJitMul = sizeJitter > 0
          ? (1 + (sh(x, y, 130) - 0.5) * sizeJitter * 1.5)
          : 1;
        const knifeW = Math.max(1.5, p.size * canvasScale * sizeMul * detailSizeMul * slotSizeMul * sizeJitMul * layerSpec.sizeMul);

        // detailAware in detail regions → shorter strokes (tight on
        // edges, don't overshoot). formFollow > 0 → also shorter (strokes
        // shouldn't run past a curve). Combined so pushing either up
        // gives more precise strokes on features.
        const detailLenFactor = detail
          ? (1 - localDetail * detailAware * 0.55)
          : 1;
        const formLenFactor = formFollow > 0 ? (1 - formFollow * 0.35) : 1;
        // lengthJitter: per-stroke random length multiplier, same shape as
        // sizeJitter but on the smear axis.
        const lenJitMul = lengthJitter > 0
          ? (1 + (sh(x, y, 131) - 0.5) * lengthJitter * 1.5)
          : 1;
        const lenBase = p.smear * canvasScale * (0.5 + sh(x, y, 4) * 0.5)
          * detailSizeMul * slotSizeMul * detailLenFactor * formLenFactor * lenJitMul * layerSpec.lengthMul;
        const realSmearLen = lenBase * (1 + edgeN * lengthByEdge * 2.5);
        // strokeCurve: bends the smear path. We add a perpendicular
        // sin-sweep offset to each t-step so the stroke arcs instead of
        // being a straight line. Amplitude scales with length so short
        // strokes don't over-curl.
        const curveAmp = strokeCurve > 0 ? realSmearLen * strokeCurve * 0.18 : 0;
        const curvePhase = sh(x, y, 132) * Math.PI * 2;
        // impurities: per-stroke tone jitter applied to sampled source.
        const impurityShift = impurities > 0
          ? (sh(x, y, 133) - 0.5) * impurities * 60
          : 0;
        // opacityByLum: darker pixels paint more opaquely; bright ones
        // become translucent. Blends ON TOP of slotOpacity so this is a
        // per-stroke modulation that works with custom brushes too.
        const lumOpacityMul = opacityByLum > 0
          ? (1 - lum * opacityByLum * 0.85)
          : 1;
        const effSlotOpacity = slotOpacity * lumOpacityMul * layerSpec.opacityMul;
        // WET STREAK extends the smear with a decaying tail — long painterly
        // drag from a loaded brush.
        const streakExt = wetStreak > 0 ? realSmearLen * wetStreak * (1.1 + layerSpec.t * 0.8) : 0;
        const smearLen = realSmearLen + streakExt;
        // Preview-tier cap: long wet-streak strokes would multiply the t-loop
        // cost (and its inner 2D stamp). In preview mode we cap at 8 steps
        // per stroke — enough to read direction without melting responsiveness.
        const effSmearLen = PREVIEW ? Math.min(smearLen, SMEAR_CAP) : smearLen;

        const jitterMul = pressureJit > 0 ? (1 + (sh(x, y, 5) - 0.5) * pressureJit) : 1;
        const edgeBoost = pressureByEdge > 0 ? (1 + edgeN * pressureByEdge * 2) : 1;
        const pressure = Math.max(0, Math.min(2, p.pressure * intensity * jitterMul * edgeBoost * layerSpec.opacityMul));

        // Color-variety radius: lets a single stroke reveal multiple source
        // colors via additional per-pixel sample offsets. Like fiber-bundle
        // behavior in the paint engine.
        const varietyRadius = colorVariety * knifeW * 0.6 * (0.75 + layerSpec.t * 0.45);
        const smudgeDrag = wetSmudge * realSmearLen * 0.5 * layerSpec.pickupMul;

        // Sample-origin drift: sampleDrift=0 → stroke keeps smearing the
        // origin pixel. sampleDrift=1 → each stamp samples from the CURRENT
        // stroke position. Mid = partial smear that reveals color variation.
        const originX = x, originY = y;

        // Brush-stamp inner loop
        if (currMask && currSize > 0) {
          // HARD CAP on stampSz — stamp footprint is (2*stampSz+1)^2 per t-
          // step, so this is the quadratic knob. STAMP_CAP is 10 for final
          // quality (441 ops/step) and 4 for preview (81 ops/step, ~5.4×
          // cheaper). Without this cap, detail-aware sizing at final tier
          // can push knifeW past 80 and freeze the page.
          //
          // IMPORTANT: stampSz MUST be an integer. The inner loop iterates
          // `for (let by = -stampSz; by <= stampSz; by++)` which produces
          // fractional `by` values when stampSz is fractional, making
          // `wy2 = fy + by` fractional too. Writes like `o[wy2*w + wx2] = src`
          // silently no-op on typed arrays when the index is fractional
          // (they set a string property instead of an element), so the
          // entire mask-based stamp path writes nothing whenever
          // canvasScale pushes knifeW off an even number. That's the bug
          // that made Brush Shape changes invisible on most canvas sizes —
          // the stamp path was live only at the exact size where stampSz
          // happened to be integer.
          const stampSz = Math.max(1, Math.min(STAMP_CAP, Math.round(knifeW * 0.5)));
          const invStamp = 1 / (2 * stampSz);
          const halfMask = (currSize - 1) / 2;
          for (let t = 0; t < effSmearLen; t++) {
            // strokeCurve: bend path by sinusoidal perpendicular offset.
            let curveOx = 0, curveOy = 0;
            if (curveAmp > 0) {
              const cAmt = Math.sin(curvePhase + (t / Math.max(1, realSmearLen)) * Math.PI) * curveAmp;
              curveOx = -dy * cAmt;  // perpendicular
              curveOy =  dx * cAmt;
            }
            const fx = Math.round(x + dx*t + curveOx), fy = Math.round(y + dy*t + curveOy);
            if (fx < 0 || fx >= w || fy < 0 || fy >= h) break;
            // edgeBreak: stop drawing when stroke crosses a strong edge.
            if (edgeBreakAmt > 0 && t > 1) {
              const em = edgeMag[Math.min(h-2, Math.max(1, fy)) * w + Math.min(w-2, Math.max(1, fx))];
              if (em / 120 * edgeBreakAmt > 0.6 && sh(fx, fy, 140) < edgeBreakAmt) break;
            }
            // Decay: during real smear it linearly fades; in streak-tail it
            // fades faster (so you get a long thinning tail not a uniform bar).
            const inReal = t < realSmearLen;
            const decay = inReal
              ? 1 - t / realSmearLen
              : Math.max(0, 1 - (t - realSmearLen) / Math.max(1e-6, streakExt)) * 0.5;
            // Drifting sample origin along the stroke
            const layerDrift = Math.min(1.2, sampleDrift * (0.75 + layerSpec.t * 0.4));
            let sOrigX = originX + (fx - originX) * layerDrift;
            let sOrigY = originY + (fy - originY) * layerDrift;
            // WET SMUDGE drags the sample back along stroke — colors from
            // earlier in the stroke bleed into the tail.
            if (wetSmudge > 0) {
              const dragT = t / Math.max(1, realSmearLen);
              sOrigX -= dx * smudgeDrag * Math.min(1, dragT);
              sOrigY -= dy * smudgeDrag * Math.min(1, dragT);
            }

            // fx/fy are already integer-valued (Math.round above), so
            // (fx + bx) and (fy + by) are integers too — skip redundant
            // Math.round inside the hot inner loop.
            for (let by = -stampSz; by <= stampSz; by++) {
              const wy2 = fy + by;
              if (wy2 < 0 || wy2 >= h) continue;
              for (let bx = -stampSz; bx <= stampSz; bx++) {
                const wx2 = fx + bx;
                if (wx2 < 0 || wx2 >= w) continue;
                const lxr =  bx * dx + by * dy;
                const lyr = -bx * dy + by * dx;
                const mx = Math.round(halfMask + lxr * invStamp * currSize);
                const my = Math.round(halfMask + lyr * invStamp * currSize);
                if (mx < 0 || mx >= currSize || my < 0 || my >= currSize) continue;
                const maskV = currMask[my * currSize + mx];
                if (maskV < 0.01) continue;
                // Keep slotOpacity OUT of `prob` — if we multiplied it into
                // prob, low-opacity slots would just paint sparser (still
                // hard-overwriting where they DO paint), which reads as
                // "mottled source image" not "translucent brush." Instead
                // apply slotOpacity as an alpha-blend against the existing
                // canvas (underpaint / earlier stroke) after we decide to
                // stamp — that way a 0.3-opacity highlight brush actually
                // LOOKS 30% transparent over the underpaint.
                const prob = Math.min(1, maskV * decay * pressure * coverageDensity);
                if (sh(wx2, wy2, 10 + ((t|0) & 3)) > prob) continue;
                const layerJitter = sampleJitter * layerSpec.pickupMul;
                const jx = layerJitter > 0 ? (sh(wx2, wy2, 20) - 0.5) * layerJitter * 2 : 0;
                const jy = layerJitter > 0 ? (sh(wx2, wy2, 21) - 0.5) * layerJitter * 2 : 0;
                const vx = varietyRadius > 0 ? (sh(wx2, wy2, 50 + (t & 3)) - 0.5) * varietyRadius * 2 : 0;
                const vy = varietyRadius > 0 ? (sh(wx2, wy2, 51 + (t & 3)) - 0.5) * varietyRadius * 2 : 0;
                const sXi = Math.max(0, Math.min(w-1, Math.round(sOrigX + jx + vx)));
                const sYi = Math.max(0, Math.min(h-1, Math.round(sOrigY + jy + vy)));
                let src = clamp(px[sYi * w + sXi]);
                if (impurityShift !== 0) src = clamp(src + impurityShift);
                const oi = wy2 * w + wx2;
                if (effSlotOpacity >= 0.999) {
                  o[oi] = src;
                } else {
                  o[oi] = Math.round(src * effSlotOpacity + o[oi] * (1 - effSlotOpacity));
                }
              }
            }
          }
        } else {
          // Built-in knife edge — a narrow perpendicular strip
          const halfKnife = Math.max(1, knifeW / 3);
          for (let t = 0; t < effSmearLen; t++) {
            let curveOx = 0, curveOy = 0;
            if (curveAmp > 0) {
              const cAmt = Math.sin(curvePhase + (t / Math.max(1, realSmearLen)) * Math.PI) * curveAmp;
              curveOx = -dy * cAmt;
              curveOy =  dx * cAmt;
            }
            const fx = Math.round(x + dx*t + curveOx), fy = Math.round(y + dy*t + curveOy);
            if (fx < 0 || fx >= w || fy < 0 || fy >= h) break;
            if (edgeBreakAmt > 0 && t > 1) {
              const em = edgeMag[Math.min(h-2, Math.max(1, fy)) * w + Math.min(w-2, Math.max(1, fx))];
              if (em / 120 * edgeBreakAmt > 0.6 && sh(fx, fy, 140) < edgeBreakAmt) break;
            }
            const inReal = t < realSmearLen;
            const decay = inReal
              ? 1 - t / realSmearLen
              : Math.max(0, 1 - (t - realSmearLen) / Math.max(1e-6, streakExt)) * 0.5;
            const layerDrift = Math.min(1.2, sampleDrift * (0.75 + layerSpec.t * 0.4));
            let sOrigX = originX + (fx - originX) * layerDrift;
            let sOrigY = originY + (fy - originY) * layerDrift;
            if (wetSmudge > 0) {
              const dragT = t / Math.max(1, realSmearLen);
              sOrigX -= dx * smudgeDrag * Math.min(1, dragT);
              sOrigY -= dy * smudgeDrag * Math.min(1, dragT);
            }
            for (let ww = -halfKnife; ww < halfKnife; ww++) {
              const wx2 = Math.round(fx - dy*ww);
              const wy2 = Math.round(fy + dx*ww);
              if (wx2 < 0 || wx2 >= w || wy2 < 0 || wy2 >= h) continue;
              const edgeFalloff = 1 - Math.abs(ww) / Math.max(1, halfKnife);
              const prob = Math.min(1, edgeFalloff * decay * pressure * coverageDensity * effSlotOpacity);
              if (sh(wx2, wy2, 10 + ((t|0) & 3)) > prob) continue;
              const layerJitter = sampleJitter * layerSpec.pickupMul;
              const jx = layerJitter > 0 ? (sh(wx2, wy2, 20) - 0.5) * layerJitter * 2 : 0;
              const jy = layerJitter > 0 ? (sh(wx2, wy2, 21) - 0.5) * layerJitter * 2 : 0;
              const vx = varietyRadius > 0 ? (sh(wx2, wy2, 50 + (t & 3)) - 0.5) * varietyRadius * 2 : 0;
              const vy = varietyRadius > 0 ? (sh(wx2, wy2, 51 + (t & 3)) - 0.5) * varietyRadius * 2 : 0;
              const sXi = Math.max(0, Math.min(w-1, Math.round(sOrigX + jx + vx)));
              const sYi = Math.max(0, Math.min(h-1, Math.round(sOrigY + jy + vy)));
              let src2 = clamp(px[sYi * w + sXi]);
              if (impurityShift !== 0) src2 = clamp(src2 + impurityShift);
              const oi = wy2 * w + wx2;
              if (effSlotOpacity >= 0.999) {
                o[oi] = src2;
              } else {
                o[oi] = Math.round(src2 * effSlotOpacity + o[oi] * (1 - effSlotOpacity));
              }
            }
          }
        }
        strokesSinceYield++;
        if (strokesSinceYield >= STROKE_CHUNK) {
          strokesSinceYield = 0;
          yield o;  // cooperative pause — applyAsync sees this; sync drain ignores.
        }
        }  // end x-loop
      }  // end y-loop
      yield o;
    }

    if (edgeFinish !== 0 && stageLevel >= 5) {
      const edgeLayer = stageLevel >= 6 ? reconFinish : reconEdges;
      finishPainterEdges(o, px, w, h, edgeMag, edgeAng, detail, seedI ^ 0x52c, edgeFinish, edgeLayer);
      yield o;
    }
    if (stageLevel <= 5) return o;

    // — Post-pass: WET BLEED (capillary spread, crisp) —
    //   Dithered pixel-swap with random neighbor; no blur because we COPY
    //   source-palette pixels rather than averaging.
    if (wetBleed > 0) {
      const bleedRadius = Math.max(1, Math.round(wetBleed * 3));
      const bleedProb = wetBleed * 0.45;
      const tmp = new Uint8ClampedArray(o);
      for (let y = 1; y < h - 1; y++) {
        const yr = y * w;
        for (let x = 1; x < w - 1; x++) {
          if (sh(x, y, 200) > bleedProb) continue;
          const dx = Math.round((sh(x, y, 201) - 0.5) * 2 * bleedRadius);
          const dy = Math.round((sh(x, y, 202) - 0.5) * 2 * bleedRadius);
          const nx = Math.max(0, Math.min(w-1, x + dx));
          const ny = Math.max(0, Math.min(h-1, y + dy));
          o[yr + x] = tmp[ny * w + nx];
        }
        if ((y & 31) === 0) yield o;
      }
    }

    // — Post-pass: USER IF/THEN RULES —
    // Applied last so rules see the fully-rendered image (including wet
    // bleed). Skipped when no rules are defined — zero overhead.
    if (Array.isArray(p.rules) && p.rules.length > 0) {
      applyRules(o, px, w, h, p.rules, edgeMag, edgeAng, detail, sh);
      yield o;
    }

    return o;
  }});

  // Legacy smooth-blend implementation kept for the 'blend' stroke style.
  function _paletteKnifeBlend(px, w, h, p, ctx) {
    const { intensity, layers, edgeSens, lsBias, sizeByLight, lengthByEdge,
            pressureByEdge, angleJitter, pressureJit, colorPickup, bMask, bSize } = ctx;
    const o = new Uint8ClampedArray(w*h);
    const r = mkRand(p.seed);
    const buf = new Float32Array(px);
    // Match the pixel-path's canvas-relative size scaling so switching to
    // blend mode doesn't also change effective brush size.
    const canvasScale = Math.max(0.5, Math.min(3.0, Math.sqrt(w * h) / 720));
    const baseSp = Math.max(2, Math.round(p.size * canvasScale * 0.8));

    for (let layer = 0; layer < layers; layer++) {
      const layerAng = (layers > 1) ? (layer / layers) * Math.PI * 0.35 : 0;
      const ox = (layer * (baseSp >> 1)) % baseSp;
      const oy = (layer * (baseSp >> 2)) % baseSp;
      for (let y = oy; y < h; y += baseSp) for (let x = ox; x < w; x += baseSp) {
        const e = sobelAt(px, Math.min(w-2, Math.max(1, x)), Math.min(h-2, Math.max(1, y)), w, h);
        const edgeN = Math.min(1, e.mag / 120);
        const lum = clamp(buf[y*w+x]) / 255;
        if (edgeSens > 0) { const accept = 1 - edgeSens * 0.5 + edgeN * edgeSens * 0.9; if (r() > accept) continue; }
        if (lsBias !== 0) { const target = lsBias > 0 ? lum : (1 - lum); if (r() > 0.3 + target * Math.abs(lsBias) * 0.7) continue; }
        const ang = e.ang + Math.PI/2 + (r() - 0.5) * angleJitter + layerAng;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const sizeMul = 1 + (sizeByLight > 0 ? lum : (1 - lum)) * Math.abs(sizeByLight) * 1.8;
        const knifeW = p.size * canvasScale * sizeMul;
        const lenBase = p.smear * canvasScale * (0.5 + r() * 0.5);
        const smearLen = lenBase * (1 + edgeN * lengthByEdge * 2.5);
        const jitterMul = pressureJit > 0 ? (1 + (r() - 0.5) * pressureJit) : 1;
        const edgeBoost = pressureByEdge > 0 ? (1 + edgeN * pressureByEdge * 2) : 1;
        const pressure = Math.max(0, Math.min(2, p.pressure * intensity * jitterMul * edgeBoost));
        let paint = clamp(buf[y*w+x]);
        for (let t = 0; t < smearLen; t++) {
          const fx = Math.round(x + dx*t), fy = Math.round(y + dy*t);
          if (fx < 0 || fx >= w || fy < 0 || fy >= h) break;
          if (bMask && bSize > 0) {
            const stampSz = Math.max(1, knifeW * 0.5);
            const invStamp = 1 / (2 * stampSz);
            const halfMask = (bSize - 1) / 2;
            for (let by = -stampSz; by <= stampSz; by++) {
              const wy2 = Math.round(fy + by); if (wy2 < 0 || wy2 >= h) continue;
              for (let bx = -stampSz; bx <= stampSz; bx++) {
                const wx2 = Math.round(fx + bx); if (wx2 < 0 || wx2 >= w) continue;
                const lxr =  bx * dx + by * dy;
                const lyr = -bx * dy + by * dx;
                const mx = Math.round(halfMask + lxr * invStamp * bSize);
                const my = Math.round(halfMask + lyr * invStamp * bSize);
                if (mx < 0 || mx >= bSize || my < 0 || my >= bSize) continue;
                const maskV = bMask[my * bSize + mx]; if (maskV < 0.01) continue;
                const decay = 1 - t/smearLen;
                const alpha = Math.min(1, decay * pressure * 0.6 * maskV);
                const stickiness = Math.max(0.5, Math.min(1, 0.98 + colorPickup * 0.02));
                paint = paint * stickiness + buf[wy2*w+wx2] * (1 - stickiness);
                buf[wy2*w+wx2] = buf[wy2*w+wx2] * (1 - alpha) + paint * alpha;
              }
            }
          } else {
            const halfKnife = knifeW / 3;
            for (let ww = -halfKnife; ww < halfKnife; ww++) {
              const wx2 = Math.round(fx - dy*ww);
              const wy2 = Math.round(fy + dx*ww);
              if (wx2 >= 0 && wx2 < w && wy2 >= 0 && wy2 < h) {
                const decay = 1 - t/smearLen;
                const alpha = Math.min(1, decay * pressure * 0.6);
                const stickiness = Math.max(0.5, Math.min(1, 0.98 + colorPickup * 0.02));
                paint = paint * stickiness + buf[wy2*w+wx2] * (1 - stickiness);
                buf[wy2*w+wx2] = buf[wy2*w+wx2] * (1 - alpha) + paint * alpha;
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < w*h; i++) o[i] = clamp(buf[i]);
    return o;
  }

  A.push({ id:'impasto', name:'Impasto', category:'reconstructive', params:[
    {id:'thickness',label:'Paint Thickness',min:1,max:8,step:1,default:4},
    {id:'highlight',label:'Highlight Strength',min:0,max:1,step:.05,default:.5},
    {id:'direction',label:'Light Dir',min:0,max:360,step:15,default:135},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    const lightAng=p.direction*Math.PI/180;
    const lx=Math.cos(lightAng),ly=Math.sin(lightAng);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x]);
      // Simulate thick paint with emboss lighting
      if(x>0&&x<w-1&&y>0&&y<h-1){
        const gx=(clamp(px[y*w+x+1])-clamp(px[y*w+x-1]))/2;
        const gy=(clamp(px[(y+1)*w+x])-clamp(px[(y-1)*w+x]))/2;
        const dot=(gx*lx+gy*ly)*p.thickness*p.highlight/255;
        v=clamp(v+dot*60+(r()-.5)*p.thickness*3);
      }
      o[y*w+x]=v;
    }
    return o;
  }});

  A.push({ id:'mosaic-tiles', name:'Mosaic Tiles', category:'reconstructive', params:[
    {id:'tileSize',label:'Tile Size',min:3,max:20,step:1,default:8},
    {id:'grout',label:'Grout Width',min:0,max:3,step:1,default:1},
    {id:'irregularity',label:'Irregularity',min:0,max:1,step:.05,default:.3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),ts=p.tileSize;
    // Pre-compute tile centers with jitter
    const cols=Math.ceil(w/ts),rows=Math.ceil(h/ts);
    const centers=[];
    for(let ty=0;ty<rows;ty++){
      centers[ty]=[];
      for(let tx=0;tx<cols;tx++){
        centers[ty][tx]={
          x:tx*ts+ts/2+(r()-.5)*ts*p.irregularity,
          y:ty*ts+ts/2+(r()-.5)*ts*p.irregularity
        };
      }
    }
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const tileX=Math.floor(x/ts),tileY=Math.floor(y/ts);
      // Find nearest center
      let minD=Infinity,nearV=128;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const ty=tileY+dy,tx2=tileX+dx;
        if(ty>=0&&ty<rows&&tx2>=0&&tx2<cols){
          const c=centers[ty][tx2];
          const d=Math.sqrt((x-c.x)**2+(y-c.y)**2);
          if(d<minD){
            minD=d;
            const sx=Math.min(w-1,Math.max(0,Math.round(c.x)));
            const sy=Math.min(h-1,Math.max(0,Math.round(c.y)));
            nearV=clamp(px[sy*w+sx]);
          }
        }
      }
      // Grout
      if(p.grout>0){
        const inTileX=(x%ts),inTileY=(y%ts);
        if(inTileX<p.grout||inTileY<p.grout||inTileX>=ts-p.grout||inTileY>=ts-p.grout){
          o[y*w+x]=220; continue;
        }
      }
      o[y*w+x]=nearV;
    }
    return o;
  }});

  A.push({ id:'stained-glass', name:'Stained Glass', category:'reconstructive', params:[
    {id:'cellSize',label:'Cell Size',min:5,max:25,step:1,default:12},
    {id:'leadWidth',label:'Lead Width',min:1,max:4,step:1,default:2},
    {id:'lightEffect',label:'Light Effect',min:0,max:1,step:.05,default:.3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),cs=p.cellSize;
    const numCells=Math.ceil(w*h/(cs*cs));
    const cellPts=[];
    for(let i=0;i<numCells;i++) cellPts.push({x:r()*w,y:r()*h});
    // Grid-accelerated nearest-neighbor lookup
    const gridSize=cs*2;
    const gw=Math.ceil(w/gridSize),gh=Math.ceil(h/gridSize);
    const grid=new Array(gw*gh);
    for(let i=0;i<grid.length;i++) grid[i]=[];
    for(let i=0;i<numCells;i++){
      const gx=Math.min(gw-1,Math.floor(cellPts[i].x/gridSize));
      const gy=Math.min(gh-1,Math.floor(cellPts[i].y/gridSize));
      grid[gy*gw+gx].push(i);
    }
    for(let y=0;y<h;y++){
      const gy0=Math.floor(y/gridSize);
      for(let x=0;x<w;x++){
        const gx0=Math.floor(x/gridSize);
        let min1=Infinity,min2=Infinity,nearIdx=0;
        // Search 3x3 neighborhood of grid cells
        for(let dy=-1;dy<=1;dy++){
          const gy=gy0+dy;
          if(gy<0||gy>=gh) continue;
          for(let dx=-1;dx<=1;dx++){
            const gx=gx0+dx;
            if(gx<0||gx>=gw) continue;
            const cell=grid[gy*gw+gx];
            for(let k=0;k<cell.length;k++){
              const ci=cell[k];
              const d=(x-cellPts[ci].x)**2+(y-cellPts[ci].y)**2;
              if(d<min1){min2=min1;min1=d;nearIdx=ci;}
              else if(d<min2) min2=d;
            }
          }
        }
        const edgeDist=Math.sqrt(min2)-Math.sqrt(min1);
        if(edgeDist<p.leadWidth){
          o[y*w+x]=20;
        } else {
          const cp=cellPts[nearIdx];
          const sx=Math.min(w-1,Math.max(0,Math.round(cp.x)));
          const sy=Math.min(h-1,Math.max(0,Math.round(cp.y)));
          let v=clamp(px[sy*w+sx]);
          v=clamp(v+edgeDist*p.lightEffect*2);
          o[y*w+x]=v;
        }
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // SKETCH & DRAWING (8)
  // ═══════════════════════════════════════════
  A.push({ id:'multi-line-sketch', name:'Multi-Line Sketch', category:'sketch', params:[
    {id:'lineCount',label:'Lines',min:1000,max:10000,step:500,default:5000},
    {id:'passes',label:'Line Passes',min:1,max:5,step:1,default:3},
    {id:'overshoot',label:'Overshoot',min:0,max:.8,step:.05,default:.35},
    {id:'angleSpread',label:'Angle Spread',min:0,max:60,step:5,default:25},
    {id:'wobble',label:'Wobble',min:0,max:1,step:.05,default:.2},
    {id:'thickness',label:'Thickness',min:1,max:3,step:1,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let i=0;i<p.lineCount;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);
      const v=clamp(px[y*w+x])/255;
      if(r()>1-v+.05)continue;
      // Base direction from gradient
      let baseAng=r()*Math.PI;
      if(x>2&&x<w-3&&y>2&&y<h-3){
        const gx=clamp(px[y*w+x+1])-clamp(px[y*w+x-1]);
        const gy=clamp(px[(y+1)*w+x])-clamp(px[(y-1)*w+x]);
        baseAng=Math.atan2(gx,-gy);
      }
      // Draw multiple passes over same area with slight angle variation
      for(let pass=0;pass<p.passes;pass++){
        const ang=baseAng+(r()-.5)*p.angleSpread*Math.PI/90;
        const baseLen=(1-v)*15+4;
        const len=baseLen*(1+p.overshoot*(r()*.5+.5));
        const dx=Math.cos(ang),dy=Math.sin(ang);
        const offsetX=(r()-.5)*3,offsetY=(r()-.5)*3;
        for(let t=-len/2;t<len/2;t++){
          const wx=(r()-.5)*p.wobble*1.5,wy=(r()-.5)*p.wobble*1.5;
          for(let ww=0;ww<p.thickness;ww++){
            const fx=Math.round(x+dx*t+wx-dy*ww+offsetX);
            const fy=Math.round(y+dy*t+wy+dx*ww+offsetY);
            if(fx>=0&&fx<w&&fy>=0&&fy<h){
              const edgeFade=Math.abs(t)/(len/2);
              const opacity=edgeFade>.8?clamp(128+r()*80):0;
              o[fy*w+fx]=Math.min(o[fy*w+fx],opacity);
            }
          }
        }
      }
    }
    return o;
  }});

  A.push({ id:'angular-sketch', name:'Angular Sketch', category:'sketch', params:[
    {id:'lineCount',label:'Lines',min:500,max:8000,step:500,default:3000},
    {id:'segmentLen',label:'Segment Length',min:3,max:20,step:1,default:8},
    {id:'segments',label:'Segments/Line',min:2,max:8,step:1,default:4},
    {id:'angleChange',label:'Max Turn',min:10,max:90,step:5,default:45},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let i=0;i<p.lineCount;i++){
      let cx2=Math.floor(r()*w),cy2=Math.floor(r()*h);
      const v=clamp(px[cy2*w+cx2])/255;
      if(r()>1-v+.08)continue;
      let ang=r()*Math.PI*2;
      for(let seg=0;seg<p.segments;seg++){
        ang+=(r()-.5)*p.angleChange*Math.PI/90;
        const dx=Math.cos(ang),dy=Math.sin(ang);
        for(let t=0;t<p.segmentLen;t++){
          const fx=Math.round(cx2+dx*t),fy=Math.round(cy2+dy*t);
          if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=0;
        }
        cx2+=Math.round(Math.cos(ang)*p.segmentLen);
        cy2+=Math.round(Math.sin(ang)*p.segmentLen);
        if(cx2<0||cx2>=w||cy2<0||cy2>=h)break;
      }
    }
    return o;
  }});

  A.push({ id:'illustrator-sketch', name:'Illustrator Sketch', category:'sketch', params:[
    {id:'lines',label:'Lines',min:50,max:400,step:25,default:150},
    {id:'smoothness',label:'Smoothness',min:.5,max:1,step:.05,default:.8},
    {id:'lineLen',label:'Line Length',min:30,max:300,step:10,default:120},
    {id:'edgeWeight',label:'Edge Weight',min:.5,max:3,step:.1,default:1.5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let l=0;l<p.lines;l++){
      // Start near edges
      let cx2=r()*w,cy2=r()*h;
      for(let tries=0;tries<30;tries++){
        const e=sobelAt(px,Math.min(w-2,Math.max(1,Math.round(cx2))),Math.min(h-2,Math.max(1,Math.round(cy2))),w,h);
        if(e.mag>20)break;
        cx2=r()*w;cy2=r()*h;
      }
      let prevAng=0;
      for(let t=0;t<p.lineLen;t++){
        const ix=Math.max(1,Math.min(w-2,Math.round(cx2)));
        const iy=Math.max(1,Math.min(h-2,Math.round(cy2)));
        const e=sobelAt(px,ix,iy,w,h);
        let ang=e.ang+Math.PI/2;
        // Smooth direction changes (illustrator style = clean lines)
        ang=prevAng*p.smoothness+ang*(1-p.smoothness);
        prevAng=ang;
        cx2+=Math.cos(ang)*1.5;
        cy2+=Math.sin(ang)*1.5;
        if(cx2<0||cx2>=w||cy2<0||cy2>=h)break;
        const fx=Math.round(cx2),fy=Math.round(cy2);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          // Thicker at edges
          const lineW=Math.max(1,Math.round(e.mag/80*p.edgeWeight));
          for(let ww=0;ww<lineW;ww++){
            const wx2=fx+Math.round(-Math.sin(ang)*ww);
            const wy2=fy+Math.round(Math.cos(ang)*ww);
            if(wx2>=0&&wx2<w&&wy2>=0&&wy2<h) o[wy2*w+wx2]=0;
          }
        }
      }
    }
    return o;
  }});

  A.push({ id:'form-sketch', name:'Form-Following Sketch', category:'sketch', params:[
    {id:'lineCount',label:'Lines',min:500,max:6000,step:500,default:2500},
    {id:'lineLen',label:'Line Length',min:10,max:60,step:5,default:25},
    {id:'overshoot',label:'Overshoot',min:0,max:.6,step:.05,default:.3},
    {id:'curvature',label:'Form Following',min:.2,max:1,step:.05,default:.7},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let i=0;i<p.lineCount;i++){
      const sx=Math.floor(r()*w),sy=Math.floor(r()*h);
      const v=clamp(px[sy*w+sx])/255;
      if(r()>1-v+.1)continue;
      const len=p.lineLen*(1-v*0.5)*(1+p.overshoot*r());
      let cx2=sx,cy2=sy;
      let prevAng=r()*Math.PI*2;
      for(let t=0;t<len;t++){
        const ix=Math.max(1,Math.min(w-2,Math.round(cx2)));
        const iy=Math.max(1,Math.min(h-2,Math.round(cy2)));
        const e=sobelAt(px,ix,iy,w,h);
        // Follow form (perpendicular to gradient)
        let ang=e.ang+Math.PI/2;
        ang=prevAng*(1-p.curvature)+ang*p.curvature;
        prevAng=ang;
        cx2+=Math.cos(ang)*1.5;cy2+=Math.sin(ang)*1.5;
        if(cx2<0||cx2>=w||cy2<0||cy2>=h)break;
        const fx=Math.round(cx2),fy=Math.round(cy2);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          // Lighter at ends
          const edgeFade=Math.abs(t/len-.5)*2;
          if(edgeFade<.8||r()>.4)o[fy*w+fx]=Math.min(o[fy*w+fx],edgeFade>.7?140:0);
        }
      }
    }
    return o;
  }});

  A.push({ id:'contour-drawing', name:'Contour Drawing', category:'sketch', params:[
    {id:'lines',label:'Contour Lines',min:3,max:50,step:1,default:15},
    {id:'thickness',label:'Thickness',min:1,max:6,step:1,default:2},
    {id:'smoothing',label:'Smoothing',min:0,max:1,step:.05,default:.6},
    {id:'fillBetween',label:'Fill Between',type:'checkbox',default:false},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    const inkV=p.invert?255:0;
    const step=255/(p.lines+1);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      let v=clamp(px[y*w+x]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      let vn=clamp(px[y*w+x+1]); if(p.gamma!==1) vn=Math.pow(vn/255,p.gamma)*255;
      let vs=clamp(px[(y+1)*w+x]); if(p.gamma!==1) vs=Math.pow(vs/255,p.gamma)*255;
      if(p.fillBetween){
        const band=Math.floor(v/step);
        if(band%2===0) o[y*w+x]=inkV;
        continue;
      }
      for(let level=1;level<=p.lines;level++){
        const threshold=level*step;
        if((v>=threshold&&vn<threshold)||(v<threshold&&vn>=threshold)||
           (v>=threshold&&vs<threshold)||(v<threshold&&vs>=threshold)){
          for(let dy=-p.thickness+1;dy<p.thickness;dy++)for(let dx=-p.thickness+1;dx<p.thickness;dx++){
            if(dx*dx+dy*dy<p.thickness*p.thickness){
              const fx=x+dx,fy=y+dy;
              if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=inkV;
            }
          }
          break;
        }
      }
    }
    return o;
  }});

  A.push({ id:'pen-ink', name:'Pen & Ink', category:'sketch', params:[
    {id:'lineWeight',label:'Line Weight',min:.3,max:4,step:.1,default:1},
    {id:'hatchAngle',label:'Hatch Angle',min:0,max:180,step:5,default:45},
    {id:'fillDensity',label:'Fill Density',min:2,max:15,step:1,default:5},
    {id:'crosshatch',label:'Crosshatch',type:'checkbox',default:true},
    {id:'crossAngle',label:'Cross Angle',min:30,max:150,step:5,default:90},
    {id:'crossThreshold',label:'Cross Threshold',min:.1,max:.8,step:.05,default:.45},
    {id:'solidThreshold',label:'Solid Fill',min:0,max:.4,step:.02,default:.15},
    {id:'edgeLines',label:'Edge Lines',type:'checkbox',default:true},
    {id:'edgeThreshold',label:'Edge Threshold',min:20,max:150,step:5,default:60},
    {id:'edgeWeight',label:'Edge Weight',min:1,max:4,step:1,default:1},
    {id:'hatchCutoff',label:'Hatch Cutoff',min:.4,max:1,step:.05,default:.75},
    {id:'wobble',label:'Wobble',min:0,max:2,step:.1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const inkV=p.invert?255:0;
    const a1=p.hatchAngle*Math.PI/180;
    const cos1=Math.cos(a1),sin1=Math.sin(a1);
    const a2=(p.hatchAngle+p.crossAngle)*Math.PI/180;
    const cos2=Math.cos(a2),sin2=Math.sin(a2);
    // Hatching fill
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const wb=p.wobble>0?(r()-.5)*p.wobble:0;
      // Primary hatching
      const proj1=Math.abs((x*cos1+y*sin1+wb)%p.fillDensity);
      if(proj1<p.lineWeight&&v<p.hatchCutoff) {o[y*w+x]=inkV;continue;}
      // Crosshatch for darker areas
      if(p.crosshatch&&v<p.crossThreshold){
        const proj2=Math.abs((x*cos2+y*sin2+wb)%p.fillDensity);
        if(proj2<p.lineWeight) {o[y*w+x]=inkV;continue;}
      }
      // Very dark = solid fill
      if(v<p.solidThreshold) {o[y*w+x]=inkV;continue;}
    }
    // Edge lines
    if(p.edgeLines){
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const e=sobelAt(px,x,y,w,h);
        if(e.mag>p.edgeThreshold){
          for(let ew=0;ew<p.edgeWeight;ew++){
            const fx=x+Math.round(Math.cos(e.ang)*ew),fy=y+Math.round(Math.sin(e.ang)*ew);
            if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=inkV;
          }
        }
      }
    }
    return o;
  }});

  A.push({ id:'comic-lines', name:'Comic Lines', category:'sketch', params:[
    {id:'edgeThreshold',label:'Edge Threshold',min:10,max:150,step:5,default:50},
    {id:'lineThickness',label:'Line Thickness',min:1,max:6,step:1,default:2},
    {id:'screenDots',label:'Screen Dots',type:'checkbox',default:true},
    {id:'screenSize',label:'Screen Size',min:3,max:16,step:1,default:6},
    {id:'screenAngle',label:'Screen Angle',min:0,max:90,step:5,default:0},
    {id:'screenShape',label:'Screen Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'line',label:'Lines'}],default:'circle'},
    {id:'shadeCutoff',label:'Shade Cutoff',min:.3,max:.9,step:.05,default:.6},
    {id:'fillDensity',label:'Fill Density',min:.3,max:1.5,step:.05,default:.7},
    {id:'solidBlacks',label:'Solid Blacks',min:0,max:.3,step:.02,default:.1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    const inkV=p.invert?255:0, paperV=p.invert?0:255;
    // Edge detection for outlines
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const e=sobelAt(px,x,y,w,h);
      if(e.mag>p.edgeThreshold){
        for(let dy=-p.lineThickness+1;dy<p.lineThickness;dy++)for(let dx=-p.lineThickness+1;dx<p.lineThickness;dx++){
          if(dx*dx+dy*dy<p.lineThickness*p.lineThickness){
            const fx=x+dx,fy=y+dy;
            if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=inkV;
          }
        }
      }
    }
    // Screen for shading
    if(p.screenDots){
      const ds=p.screenSize;
      const sAng=p.screenAngle*Math.PI/180,cosS=Math.cos(sAng),sinS=Math.sin(sAng);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        if(o[y*w+x]===inkV)continue;
        let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
        if(v<p.solidBlacks){o[y*w+x]=inkV;continue;}
        if(v>p.shadeCutoff)continue;
        const rx=x*cosS+y*sinS,ry=-x*sinS+y*cosS;
        const cx2=((rx%ds)+ds)%ds,cy2=((ry%ds)+ds)%ds;
        const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
        let d;
        if(p.screenShape==='diamond') d=Math.abs(nx)+Math.abs(ny);
        else if(p.screenShape==='line') d=Math.abs(ny);
        else d=Math.sqrt(nx*nx+ny*ny);
        const t=(1-v)*1.2*p.fillDensity;
        if(d<t) o[y*w+x]=inkV;
      }
    }
    return o;
  }});

  A.push({ id:'architectural', name:'Architectural Sketch', category:'sketch', params:[
    {id:'lineWeight',label:'Line Weight',min:.5,max:4,step:.25,default:1.5},
    {id:'hatching',label:'Hatching Density',min:3,max:15,step:1,default:6},
    {id:'hatchAngle',label:'Hatch Angle',min:0,max:180,step:5,default:45},
    {id:'edgeSensitivity',label:'Edge Detail',min:10,max:150,step:5,default:40},
    {id:'shadowCutoff',label:'Shadow Cutoff',min:.3,max:1,step:.05,default:.65},
    {id:'hatchWeight',label:'Hatch Weight',min:.3,max:3,step:.1,default:1},
    {id:'crosshatch',label:'Cross-hatch',type:'checkbox',default:false},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const inkV=p.invert?255:0;
    const hAng=p.hatchAngle*Math.PI/180,cosH=Math.cos(hAng),sinH=Math.sin(hAng);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const e=sobelAt(px,x,y,w,h);
      if(e.mag>p.edgeSensitivity){
        const lw=Math.round(Math.min(p.lineWeight,1+e.mag/200));
        for(let dd=0;dd<lw;dd++){
          const fx=x+Math.round(Math.cos(e.ang)*dd);
          const fy=y+Math.round(Math.sin(e.ang)*dd);
          if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=inkV;
        }
      }
    }
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      if(o[y*w+x]===inkV)continue;
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(v>p.shadowCutoff)continue;
      const proj=Math.abs((x*cosH+y*sinH)%p.hatching);
      if(proj<p.hatchWeight) o[y*w+x]=p.invert?clamp(255-(100+v*155)):clamp(100+v*155);
      if(p.crosshatch&&v<p.shadowCutoff*.5){
        const proj2=Math.abs((-x*sinH+y*cosH)%(p.hatching*1.3));
        if(proj2<p.hatchWeight*.7) o[y*w+x]=p.invert?clamp(255-(80+v*155)):clamp(80+v*155);
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // EXOTIC & RARE (6)
  // ═══════════════════════════════════════════
  A.push({ id:'mandelbrot-dither', name:'Fractal Dither', category:'exotic', params:[
    {id:'iterations',label:'Detail',min:5,max:50,step:5,default:20},
    {id:'zoom',label:'Zoom',min:.5,max:5,step:.1,default:1},
    {id:'mix',label:'Image Mix',min:0,max:1,step:.05,default:.5}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    const zf=p.zoom;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const cr=(x/w*3-2)/zf,ci=(y/h*2-1)/zf;
      let zr=0,zi=0,iter=0;
      while(zr*zr+zi*zi<4&&iter<p.iterations){const tr=zr*zr-zi*zi+cr;zi=2*zr*zi+ci;zr=tr;iter++;}
      const fracVal=iter/p.iterations;
      const imgVal=clamp(px[y*w+x])/255;
      const v=(fracVal*p.mix+imgVal*(1-p.mix));
      o[y*w+x]=v>.5?255:0;
    }return o;
  }});

  A.push({ id:'reaction-diffusion', name:'Reaction-Diffusion', category:'exotic', params:[
    {id:'iterations',label:'Iterations',min:5,max:80,step:5,default:15},
    {id:'feed',label:'Feed Rate',min:.01,max:.08,step:.002,default:.055},
    {id:'kill',label:'Kill Rate',min:.04,max:.07,step:.001,default:.062},
    {id:'imageMix',label:'Image Influence',min:0,max:1,step:.05,default:.5},
    {id:'scale',label:'Scale',min:.2,max:2,step:.1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    let a=new Float32Array(w*h),b=new Float32Array(w*h);
    a.fill(1);
    // Seed B from dark areas of image
    for(let i=0;i<w*h;i++) if(clamp(px[i])/255<0.5) b[i]=1;
    const dA=1,dB=.5;
    for(let iter=0;iter<p.iterations;iter++){
      const na=new Float32Array(w*h),nb=new Float32Array(w*h);
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const i=y*w+x;
        const lapA=a[i-1]+a[i+1]+a[i-w]+a[i+w]-4*a[i];
        const lapB=b[i-1]+b[i+1]+b[i-w]+b[i+w]-4*b[i];
        const abb=a[i]*b[i]*b[i];
        const f=p.feed*(1-clamp(px[i])/255*p.imageMix);
        na[i]=a[i]+dA*lapA-abb+f*(1-a[i]);
        nb[i]=b[i]+dB*lapB+abb-(p.kill+f)*b[i];
      }
      a=na;b=nb;
    }
    for(let i=0;i<w*h;i++){let v=(1-b[i])*255;if(p.gamma!==1)v=Math.pow(clamp(v)/255,p.gamma)*255;o[i]=p.invert?255-clamp(v):clamp(v);}
    return o;
  }});

  A.push({ id:'pixel-sort', name:'Pixel Sort', category:'exotic', params:[
    {id:'threshold',label:'Threshold',min:10,max:240,step:5,default:80},
    {id:'upperThreshold',label:'Upper Threshold',min:30,max:255,step:5,default:255},
    {id:'direction',label:'Direction',type:'select',options:[{value:'h',label:'Horizontal'},{value:'v',label:'Vertical'},{value:'d',label:'Diagonal'}],default:'h'},
    {id:'mode',label:'Mode',type:'select',options:[{value:'dark',label:'Dark First'},{value:'light',label:'Light First'},{value:'random',label:'Random'}],default:'dark'},
    {id:'minRunLength',label:'Min Run',min:1,max:50,step:1,default:1},
    {id:'maxRunLength',label:'Max Run',min:10,max:500,step:10,default:500},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    const buf=new Float32Array(px);
    if(p.gamma!==1) for(let i=0;i<w*h;i++) buf[i]=Math.pow(clamp(buf[i])/255,p.gamma)*255;
    const rng=p.mode==='random'?mkRand(p.seed):null;
    function sortSeg(seg){
      if(seg.length<p.minRunLength)return seg;
      const s=seg.slice(0,Math.min(seg.length,p.maxRunLength));
      if(p.mode==='random'){s.sort(()=>rng()-.5);}
      else s.sort((a2,b2)=>p.mode==='dark'?a2-b2:b2-a2);
      return s.concat(seg.slice(s.length));
    }
    if(p.direction==='h'){
      for(let y=0;y<h;y++){
        let start=-1;
        for(let x=0;x<=w;x++){
          const v=x<w?clamp(buf[y*w+x]):256;
          const inRange=v>=p.threshold&&v<=p.upperThreshold;
          if(inRange&&start===-1) start=x;
          else if(!inRange&&start!==-1){
            const seg=[];
            for(let sx=start;sx<x;sx++) seg.push(clamp(buf[y*w+sx]));
            const sorted=sortSeg(seg);
            for(let sx=start;sx<x;sx++) buf[y*w+sx]=sorted[sx-start];
            start=-1;
          }
        }
      }
    } else if(p.direction==='v'){
      for(let x=0;x<w;x++){
        let start=-1;
        for(let y=0;y<=h;y++){
          const v=y<h?clamp(buf[y*w+x]):256;
          const inRange=v>=p.threshold&&v<=p.upperThreshold;
          if(inRange&&start===-1) start=y;
          else if(!inRange&&start!==-1){
            const seg=[];
            for(let sy=start;sy<y;sy++) seg.push(clamp(buf[sy*w+x]));
            const sorted=sortSeg(seg);
            for(let sy=start;sy<y;sy++) buf[sy*w+x]=sorted[sy-start];
            start=-1;
          }
        }
      }
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  A.push({ id:'voronoi-dither', name:'Voronoi Dither', category:'exotic', params:[
    {id:'cells',label:'Cells',min:50,max:2000,step:50,default:300},
    {id:'style',label:'Style',type:'select',options:[{value:'flat',label:'Flat'},{value:'edge',label:'Edges Only'},{value:'mixed',label:'Mixed'},{value:'stippled',label:'Stippled'}],default:'flat'},
    {id:'edgeWidth',label:'Edge Width',min:.5,max:5,step:.25,default:2},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    const pts=[];
    for(let i=0;i<p.cells;i++) pts.push({x:r()*w,y:r()*h});
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let min1=Infinity,min2=Infinity,nearIdx=0;
      for(let i=0;i<pts.length;i++){
        const d=(x-pts[i].x)**2+(y-pts[i].y)**2;
        if(d<min1){min2=min1;min1=d;nearIdx=i;}
        else if(d<min2)min2=d;
      }
      const edgeDist=Math.sqrt(min2)-Math.sqrt(min1);
      let result;
      if(p.style==='edge'){
        result=edgeDist<p.edgeWidth?0:255;
      } else if(p.style==='mixed'){
        const cp=pts[nearIdx];
        let sv=clamp(px[Math.min(h-1,Math.round(cp.y))*w+Math.min(w-1,Math.round(cp.x))]);
        if(p.gamma!==1) sv=Math.pow(sv/255,p.gamma)*255;
        result=edgeDist<p.edgeWidth?0:sv;
      } else if(p.style==='stippled'){
        const cp=pts[nearIdx];
        let sv=clamp(px[Math.min(h-1,Math.round(cp.y))*w+Math.min(w-1,Math.round(cp.x))])/255;
        if(p.gamma!==1) sv=Math.pow(sv,p.gamma);
        result=sv>.5?255:edgeDist<p.edgeWidth?0:255;
      } else {
        const cp=pts[nearIdx];
        let sv=clamp(px[Math.min(h-1,Math.round(cp.y))*w+Math.min(w-1,Math.round(cp.x))]);
        if(p.gamma!==1) sv=Math.pow(sv/255,p.gamma)*255;
        result=sv;
      }
      o[y*w+x]=p.invert?255-clamp(result):clamp(result);
    }
    return o;
  }});

  A.push({ id:'hilbert-dither', name:'Hilbert Curve', category:'exotic', params:[
    {id:'order',label:'Curve Order',min:3,max:7,step:1,default:5},
    {id:'strength',label:'Diffusion',min:.5,max:1,step:.05,default:.85}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    const n=1<<p.order;
    const buf=new Float32Array(px);
    // Generate Hilbert curve path
    function hilbert(rx,ry,d,s) {
      if(s===1) return [rx,ry];
      const h2=s>>1;
      let pts=[];
      if(d===0) pts=hilbert(ry,rx,0,h2);
      else if(d===1) pts=hilbert(rx,ry,1,h2);
      else if(d===2) pts=hilbert(s-1-ry,s-1-rx,2,h2);
      else pts=hilbert(s-1-rx,s-1-ry,3,h2);
      return pts;
    }
    // Simplified: just do error diffusion along scanline but with threshold modulation
    const errBuf=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;
      const old=clamp(buf[i]+errBuf[i]);
      const nv=old>128?255:0;
      o[i]=nv;
      const err=(old-nv)*p.strength;
      // Spread error in a curved pattern
      const phase=(x+y*3)%4;
      if(phase===0&&x+1<w) errBuf[i+1]+=err*0.5;
      if(phase===1&&y+1<h) errBuf[i+w]+=err*0.5;
      if(phase===2&&x>0) errBuf[i-1]+=err*0.3;
      if(phase===3&&y+1<h&&x+1<w) errBuf[i+w+1]+=err*0.4;
      if(x+1<w) errBuf[i+1]+=err*0.2;
      if(y+1<h) errBuf[i+w]+=err*0.15;
    }
    return o;
  }});

  A.push({ id:'dbs', name:'Direct Binary Search', category:'exotic', params:[
    {id:'iterations',label:'Iterations',min:1,max:5,step:1,default:2},
    {id:'neighborhood',label:'Neighborhood',min:2,max:6,step:1,default:3}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    // Initial threshold
    for(let i=0;i<w*h;i++) o[i]=clamp(px[i])>128?255:0;
    // Iteratively swap/toggle pixels to minimize error
    const nb=p.neighborhood;
    for(let iter=0;iter<p.iterations;iter++){
      let improved=false;
      for(let y=nb;y<h-nb;y+=2)for(let x=nb;x<w-nb;x+=2){
        const i=y*w+x;
        // Calculate current local error
        let errCurrent=0,errToggled=0;
        for(let dy=-nb;dy<=nb;dy++)for(let dx=-nb;dx<=nb;dx++){
          const ni=(y+dy)*w+x+dx;
          const target=clamp(px[ni]);
          const dist=Math.sqrt(dx*dx+dy*dy)+1;
          const weight=1/dist;
          errCurrent+=(target-o[ni])**2*weight;
        }
        // Try toggling
        const newV=o[i]===0?255:0;
        const oldV=o[i];
        o[i]=newV;
        for(let dy=-nb;dy<=nb;dy++)for(let dx=-nb;dx<=nb;dx++){
          const ni=(y+dy)*w+x+dx;
          const target=clamp(px[ni]);
          const dist=Math.sqrt(dx*dx+dy*dy)+1;
          errToggled+=(target-o[ni])**2/dist;
        }
        if(errToggled>=errCurrent) o[i]=oldV; // revert
        else improved=true;
      }
      if(!improved)break;
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // DIGITAL & GLITCH (10)
  // ═══════════════════════════════════════════
  A.push({ id:'hue-shift', name:'Hue Scatter', category:'digital', params:[
    {id:'amount',label:'Scatter Amount',min:0,max:60,step:1,default:20},
    {id:'valueLink',label:'Link to Value',min:0,max:1,step:.05,default:.5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i])/255;
      const scatter=(r()-.5)*p.amount*(1-v*p.valueLink);
      o[i]=clamp(px[i]+scatter);
    }return o;
  }});

  A.push({ id:'channel-noise', name:'Channel Noise', category:'digital', params:[
    {id:'red',label:'Red Noise',min:0,max:80,step:1,default:30},
    {id:'green',label:'Green Noise',min:0,max:80,step:1,default:15},
    {id:'blue',label:'Blue Noise',min:0,max:80,step:1,default:40},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      const rn=(r()-.5)*p.red,gn=(r()-.5)*p.green,bn=(r()-.5)*p.blue;
      o[i]=clamp(px[i]+rn*.3+gn*.5+bn*.2);
    }return o;
  }});

  A.push({ id:'color-bleed', name:'Color Bleed', category:'digital', params:[
    {id:'amount',label:'Bleed Amount',min:1,max:20,step:1,default:5},
    {id:'direction',label:'Direction',type:'select',options:[{value:'right',label:'Right'},{value:'down',label:'Down'},{value:'diagonal',label:'Diagonal'},{value:'radial',label:'Radial'}],default:'right'},
    {id:'decay',label:'Decay',min:.5,max:.99,step:.01,default:.9}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    const buf=new Float32Array(px);
    if(p.direction==='right'){
      for(let y=0;y<h;y++){let carry=0;for(let x=0;x<w;x++){
        carry=carry*p.decay+buf[y*w+x]*(1-p.decay);buf[y*w+x]=buf[y*w+x]*(1-p.amount/20)+carry*(p.amount/20);}}
    }else if(p.direction==='down'){
      for(let x=0;x<w;x++){let carry=0;for(let y=0;y<h;y++){
        carry=carry*p.decay+buf[y*w+x]*(1-p.decay);buf[y*w+x]=buf[y*w+x]*(1-p.amount/20)+carry*(p.amount/20);}}
    }else if(p.direction==='diagonal'){
      for(let d=0;d<w+h;d++){let carry=0;for(let y=Math.max(0,d-w+1);y<=Math.min(d,h-1);y++){
        const x=d-y;if(x<w){carry=carry*p.decay+buf[y*w+x]*(1-p.decay);buf[y*w+x]=buf[y*w+x]*(1-p.amount/20)+carry*(p.amount/20);}}}
    }else{
      const cx2=w/2,cy2=h/2;for(let a=0;a<360;a+=1){const rad=a*Math.PI/180;
        let carry=0;for(let r2=0;r2<Math.max(w,h);r2++){
          const x=Math.round(cx2+Math.cos(rad)*r2),y=Math.round(cy2+Math.sin(rad)*r2);
          if(x>=0&&x<w&&y>=0&&y<h){carry=carry*p.decay+buf[y*w+x]*(1-p.decay);buf[y*w+x]=buf[y*w+x]*(1-p.amount/40)+carry*(p.amount/40);}}}
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  A.push({ id:'rgb-shift', name:'RGB Shift', category:'digital', params:[
    {id:'rShift',label:'Red Shift',min:-15,max:15,step:1,default:3},
    {id:'gShift',label:'Green Shift',min:-15,max:15,step:1,default:0},
    {id:'bShift',label:'Blue Shift',min:-15,max:15,step:1,default:-3},
    {id:'axis',label:'Axis',type:'select',options:[{value:'h',label:'Horizontal'},{value:'v',label:'Vertical'},{value:'both',label:'Both'}],default:'h'}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let sx1=x,sy1=y,sx2=x,sy2=y,sx3=x,sy3=y;
      if(p.axis==='h'||p.axis==='both'){sx1=((x+p.rShift)%w+w)%w;sx3=((x+p.bShift)%w+w)%w;}
      if(p.axis==='v'||p.axis==='both'){sy1=((y+p.rShift)%h+h)%h;sy3=((y+p.bShift)%h+h)%h;}
      const r2=clamp(px[sy1*w+sx1]),g=clamp(px[sy2*w+sx2]),b=clamp(px[sy3*w+sx3]);
      o[y*w+x]=Math.round(r2*.3+g*.5+b*.2);
    }return o;
  }});

  A.push({ id:'color-quantize-noise', name:'Quantize + Noise', category:'digital', params:[
    {id:'levels',label:'Levels',min:2,max:12,step:1,default:4},
    {id:'noise',label:'Dither Noise',min:0,max:1,step:.05,default:.5},
    {id:'bandShift',label:'Band Shift',min:0,max:30,step:1,default:10},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),n2=p.levels;
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i])/255+(r()-.5)*p.noise/n2;
      const band=Math.round(Math.max(0,Math.min(1,v))*(n2-1));
      const shift=(r()-.5)*p.bandShift;
      o[i]=clamp(band/(n2-1)*255+shift);
    }return o;
  }});

  A.push({ id:'duotone-split', name:'Duotone Split', category:'digital', params:[
    {id:'splitPoint',label:'Split Point',min:0,max:255,step:1,default:128},
    {id:'darkShift',label:'Dark Shift',min:-60,max:60,step:1,default:-20},
    {id:'lightShift',label:'Light Shift',min:-60,max:60,step:1,default:20},
    {id:'crossover',label:'Crossover Width',min:0,max:60,step:1,default:20}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i]);const sp=p.splitPoint;
      let shift;
      if(v<sp-p.crossover) shift=p.darkShift;
      else if(v>sp+p.crossover) shift=p.lightShift;
      else { const t=(v-(sp-p.crossover))/(p.crossover*2); shift=p.darkShift*(1-t)+p.lightShift*t; }
      o[i]=clamp(v+shift);
    }return o;
  }});

  A.push({ id:'solarize', name:'Solarize', category:'digital', params:[
    {id:'threshold',label:'Threshold',min:20,max:240,step:5,default:128},
    {id:'amount',label:'Amount',min:0,max:1,step:.05,default:1},
    {id:'curve',label:'Curve',type:'select',options:[{value:'linear',label:'Linear'},{value:'sine',label:'Sine Wave'},{value:'tri',label:'Triangle'}],default:'linear'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    for(let i=0;i<w*h;i++){
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      let solarized;
      if(p.curve==='sine') solarized=Math.abs(Math.sin(v/255*Math.PI))*255;
      else if(p.curve==='tri') solarized=v<128?v*2:510-v*2;
      else solarized=v>p.threshold?255-v:v;
      o[i]=clamp(v*(1-p.amount)+solarized*p.amount);
    }
    return o;
  }});

  A.push({ id:'posterize', name:'Posterize', category:'digital', params:[
    {id:'levels',label:'Levels',min:2,max:16,step:1,default:4},
    {id:'dither',label:'Dither Amount',min:0,max:1,step:.05,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      let v=clamp(px[i])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      v+=((r()-.5)*p.dither/p.levels);
      const band=Math.round(Math.max(0,Math.min(1,v))*(p.levels-1));
      let result=clamp(band/(p.levels-1)*255);
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'glitch-blocks', name:'Glitch Blocks', category:'digital', params:[
    {id:'blockSize',label:'Block Size',min:4,max:40,step:2,default:12},
    {id:'probability',label:'Glitch Probability',min:.02,max:.7,step:.02,default:.15},
    {id:'shift',label:'Max Shift',min:5,max:80,step:5,default:20},
    {id:'corruption',label:'Corruption',type:'select',options:[{value:'shift',label:'Shift'},{value:'invert',label:'Invert'},{value:'noise',label:'Noise'},{value:'mirror',label:'Mirror'},{value:'mixed',label:'Mixed'}],default:'shift'},
    {id:'vertShift',label:'Vertical Shift',min:0,max:1,step:.05,default:.25},
    {id:'scanlines',label:'Scanlines',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),bs=p.blockSize;
    for(let i=0;i<w*h;i++) o[i]=clamp(px[i]);
    for(let y=0;y<h;y+=bs)for(let x=0;x<w;x+=bs){
      if(r()>p.probability)continue;
      const shiftX=Math.round((r()-.5)*p.shift*2);
      const shiftY=Math.round((r()-.5)*p.shift*p.vertShift*2);
      const mode=p.corruption==='mixed'?['shift','invert','noise','mirror'][Math.floor(r()*4)]:p.corruption;
      for(let dy=0;dy<bs&&y+dy<h;dy++)for(let dx=0;dx<bs&&x+dx<w;dx++){
        const di=(y+dy)*w+x+dx;
        if(mode==='invert') o[di]=255-clamp(px[di]);
        else if(mode==='noise') o[di]=clamp(px[di]+(r()-.5)*120);
        else if(mode==='mirror') o[di]=clamp(px[(y+dy)*w+Math.min(w-1,Math.max(0,w-1-(x+dx)))]);
        else{const sx=((x+dx+shiftX)%w+w)%w,sy=((y+dy+shiftY)%h+h)%h;o[di]=clamp(px[sy*w+sx]);}
      }
    }
    if(p.scanlines){for(let y=0;y<h;y+=2)for(let x=0;x<w;x++) o[y*w+x]=clamp(o[y*w+x]*.85);}
    return o;
  }});

  A.push({ id:'data-bend', name:'Data Bend', category:'digital', params:[
    {id:'intensity',label:'Intensity',min:1,max:20,step:1,default:5},
    {id:'chunkSize',label:'Chunk Size',min:10,max:200,step:10,default:50},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    const buf=new Float32Array(px);
    // Treat pixel data as raw bytes and corrupt
    for(let i=0;i<p.intensity;i++){
      const start=Math.floor(r()*w*h);
      const len=Math.floor(r()*p.chunkSize);
      const op=Math.floor(r()*4);
      for(let j=start;j<Math.min(start+len,w*h);j++){
        if(op===0) buf[j]=255-buf[j]; // invert
        else if(op===1) buf[j]=buf[Math.min(w*h-1,j+Math.floor(r()*20))]; // repeat
        else if(op===2) buf[j]=(buf[j]+128)%256; // shift
        else buf[j]=buf[j]^(Math.floor(r()*256)); // xor
      }
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  // ═══════════════════════════════════════════
  // EFFECTS & TRANSFORMS (12)
  // ═══════════════════════════════════════════
  A.push({ id:'photographic-grain', name:'Photo Grain', category:'effects', params:[
    {id:'size',label:'Grain Size',min:1,max:6,step:1,default:2},
    {id:'amount',label:'Amount',min:0,max:100,step:1,default:40},
    {id:'luminanceResponse',label:'Shadow Bias',min:0,max:1,step:.05,default:.6},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),gs=p.size;
    for(let y=0;y<h;y+=gs)for(let x=0;x<w;x+=gs){
      const v=clamp(px[y*w+x])/255;
      const response=1-v*p.luminanceResponse;
      const noise=(r()-.5)*p.amount*response;
      for(let dy=0;dy<gs&&y+dy<h;dy++)for(let dx=0;dx<gs&&x+dx<w;dx++)
        o[(y+dy)*w+x+dx]=clamp(px[(y+dy)*w+x+dx]+noise+(r()-.5)*5);
    }return o;
  }});

  A.push({ id:'kodachrome-grain', name:'Kodachrome Grain', category:'effects', params:[
    {id:'grain',label:'Grain Intensity',min:0,max:80,step:1,default:30},
    {id:'warmth',label:'Warmth',min:0,max:50,step:1,default:15},
    {id:'satBoost',label:'Contrast Boost',min:0,max:1,step:.05,default:.3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:55}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i])/255;
      const curved=v<.5?2*v*v:1-2*(1-v)*(1-v);
      const boosted=v*(1-p.satBoost)+curved*p.satBoost;
      const warm=p.warmth*(1-v)*.5;
      o[i]=clamp(boosted*255+warm+(r()-.5)*p.grain*(1-v*.5));
    }return o;
  }});

  A.push({ id:'halation', name:'Halation', category:'effects', params:[
    {id:'radius',label:'Bloom Radius',min:2,max:30,step:1,default:10},
    {id:'threshold',label:'Threshold',min:100,max:240,step:5,default:180},
    {id:'strength',label:'Strength',min:0,max:1,step:.05,default:.4},
    {id:'tint',label:'Warm Tint',min:0,max:40,step:1,default:15}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),rad=p.radius;
    const bloom=new Float32Array(w*h);
    const temp=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n2=0;
      for(let dx=-rad;dx<=rad;dx++){const nx=x+dx;if(nx>=0&&nx<w){const v=clamp(px[y*w+nx]);
        if(v>p.threshold){s+=v;n2++;}}}temp[y*w+x]=n2>0?s/n2:0;}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n2=0;
      for(let dy=-rad;dy<=rad;dy++){const ny=y+dy;if(ny>=0&&ny<h){const v=temp[ny*w+x];
        if(v>0){s+=v;n2++;}}}bloom[y*w+x]=n2>0?s/n2:0;}
    for(let i=0;i<w*h;i++){
      o[i]=clamp(clamp(px[i])+bloom[i]*p.strength+p.tint*(bloom[i]/255));
    }return o;
  }});

  A.push({ id:'silver-gelatin', name:'Silver Gelatin', category:'effects', params:[
    {id:'grain',label:'Grain',min:0,max:60,step:1,default:20},
    {id:'contrast',label:'Contrast',min:.5,max:2,step:.05,default:1.3},
    {id:'fog',label:'Fog Level',min:0,max:40,step:1,default:8},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:99}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      let v=clamp(px[i])/255;
      v=Math.pow(v,1/p.contrast);
      v=v*(255-p.fog)+p.fog;
      const grain=(r()-.5)*p.grain;
      const cl=(r()<.15)?(r()-.5)*p.grain*2:0;
      o[i]=clamp(v+grain+cl);
    }return o;
  }});

  A.push({ id:'risograph-grain', name:'Riso Texture', category:'effects', params:[
    {id:'dotSize',label:'Dot Size',min:1,max:6,step:1,default:2},
    {id:'inkNoise',label:'Ink Noise',min:0,max:1,step:.05,default:.5},
    {id:'dryAreas',label:'Dry Areas',min:0,max:1,step:.05,default:.3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:321}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),ds=p.dotSize;
    for(let y=0;y<h;y+=ds)for(let x=0;x<w;x+=ds){
      const v=clamp(px[y*w+x])/255;
      const inkCoverage=r()<p.dryAreas&&v<.7?v*.5:v;
      const noise=(r()-.5)*p.inkNoise*80;
      for(let dy=0;dy<ds&&y+dy<h;dy++)for(let dx=0;dx<ds&&x+dx<w;dx++){
        const jitter=(r()-.5)*20*p.inkNoise;
        o[(y+dy)*w+x+dx]=clamp(inkCoverage*255+noise+jitter);
      }}return o;
  }});

  A.push({ id:'lith-print', name:'Lith Print', category:'effects', params:[
    {id:'infectious',label:'Infectious Dev.',min:0,max:1,step:.05,default:.6},
    {id:'grain',label:'Grain',min:0,max:60,step:1,default:25},
    {id:'highlight',label:'Highlight Color',min:0,max:40,step:1,default:15},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:111}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i])/255;
      let lithV;
      if(v<.4) lithV=v*v*p.infectious*2;
      else lithV=.4*p.infectious+(.6-.4)*(v-.4)/.6+v*(1-p.infectious);
      const warm=v>.6?p.highlight*(v-.6)/.4:0;
      o[i]=clamp(lithV*255+warm+(r()-.5)*p.grain*(1-v*.3));
    }return o;
  }});

  A.push({ id:'cyanotype', name:'Cyanotype Grain', category:'effects', params:[
    {id:'exposure',label:'Exposure',min:.5,max:2,step:.05,default:1},
    {id:'grain',label:'Paper Grain',min:0,max:50,step:1,default:20},
    {id:'bleed',label:'Chemical Bleed',min:0,max:5,step:1,default:2},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:77}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    let buf=new Float32Array(w*h);
    for(let i=0;i<w*h;i++) buf[i]=255-clamp(px[i]*p.exposure);
    if(p.bleed>0){const next=new Float32Array(buf);const bl=p.bleed;
      for(let y=bl;y<h-bl;y++)for(let x=bl;x<w-bl;x++){let s=0,n2=0;
        for(let dy=-bl;dy<=bl;dy++)for(let dx=-bl;dx<=bl;dx++){s+=buf[(y+dy)*w+x+dx];n2++;}
        next[y*w+x]=s/n2;}buf=next;}
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]+(r()-.5)*p.grain);
    return o;
  }});

  A.push({ id:'screen-grain', name:'Screen Grain', category:'effects', params:[
    {id:'pixelSize',label:'Pixel Size',min:1,max:4,step:1,default:1},
    {id:'scanlines',label:'Scanline Strength',min:0,max:1,step:.05,default:.3},
    {id:'noise',label:'Signal Noise',min:0,max:60,step:1,default:20},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),ps=p.pixelSize;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const sx=Math.floor(x/ps)*ps,sy=Math.floor(y/ps)*ps;
      let v=clamp(px[Math.min(h-1,sy)*w+Math.min(w-1,sx)]);
      v*=1-p.scanlines*(y%2===0?.1:.0);
      v+=((r()-.5)*p.noise);
      o[y*w+x]=clamp(v);
    }return o;
  }});

  A.push({ id:'edge-glow', name:'Edge Glow', category:'effects', params:[
    {id:'threshold',label:'Edge Threshold',min:10,max:100,step:5,default:30},
    {id:'glow',label:'Glow Strength',min:0,max:1,step:.05,default:.5},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const e=sobelAt(px,x,y,w,h);
      const edgeV=Math.min(255,e.mag*p.glow*2);
      const v=clamp(px[y*w+x]);
      o[y*w+x]=p.invert?clamp(edgeV):clamp(v+edgeV*(1-v/255));
    }
    return o;
  }});

  A.push({ id:'emboss', name:'Emboss', category:'effects', params:[
    {id:'direction',label:'Light Direction',min:0,max:360,step:15,default:135},
    {id:'strength',label:'Strength',min:.5,max:3,step:.1,default:1},
    {id:'blend',label:'Source Blend',min:0,max:1,step:.05,default:.3}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    const ang=p.direction*Math.PI/180;
    const dx2=Math.round(Math.cos(ang)),dy2=Math.round(Math.sin(ang));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;
      const nx=x+dx2,ny=y+dy2;
      let embossV=128;
      if(nx>=0&&nx<w&&ny>=0&&ny<h){
        embossV=128+(clamp(px[i])-clamp(px[ny*w+nx]))*p.strength;
      }
      o[i]=clamp(embossV*(1-p.blend)+clamp(px[i])*p.blend);
    }
    return o;
  }});

  A.push({ id:'vignette', name:'Vignette', category:'effects', params:[
    {id:'strength',label:'Strength',min:0,max:1,step:.05,default:.5},
    {id:'radius',label:'Radius',min:.3,max:1.5,step:.05,default:.8},
    {id:'softness',label:'Softness',min:.1,max:1,step:.05,default:.5}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    const cx2=w/2,cy2=h/2;
    const maxDist=Math.sqrt(cx2*cx2+cy2*cy2)*p.radius;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const dist=Math.sqrt((x-cx2)**2+(y-cy2)**2);
      const t=Math.max(0,(dist-maxDist*(1-p.softness))/(maxDist*p.softness));
      const darken=1-Math.min(1,t)*p.strength;
      o[y*w+x]=clamp(clamp(px[y*w+x])*darken);
    }
    return o;
  }});

  A.push({ id:'bilateral-filter', name:'Bilateral Filter', category:'effects', params:[
    {id:'radius',label:'Radius',min:1,max:8,step:1,default:3},
    {id:'sigmaSpatial',label:'Spatial Sigma',min:1,max:10,step:.5,default:3},
    {id:'sigmaRange',label:'Range Sigma',min:5,max:80,step:5,default:30}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),rad=p.radius;
    const ss2=2*p.sigmaSpatial*p.sigmaSpatial;
    const sr2=2*p.sigmaRange*p.sigmaRange;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const cv=clamp(px[y*w+x]);
      let sum=0,wSum=0;
      for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
        const nx=x+dx,ny=y+dy;
        if(nx>=0&&nx<w&&ny>=0&&ny<h){
          const nv=clamp(px[ny*w+nx]);
          const spatialW=Math.exp(-(dx*dx+dy*dy)/ss2);
          const rangeW=Math.exp(-((cv-nv)**2)/sr2);
          const weight=spatialW*rangeW;
          sum+=nv*weight;wSum+=weight;
        }
      }
      o[y*w+x]=clamp(wSum>0?sum/wSum:cv);
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // ASCII & CHARACTER (8)
  // ═══════════════════════════════════════════

  function asciiRamp(charset) {
    const ramps = {
      'standard':    ' .:-=+*#%@',
      'detailed':    ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
      'blocks':      ' ░▒▓█',
      'blocks-ext':  ' ·░▒▓▊█',
      'box-light':   ' ·┄┈╌─│┌┐└┘├┤┬┴┼',
      'box-heavy':   ' ╍═║╔╗╚╝╠╣╦╩╬█',
      'box-double':  ' ═║╔╗╚╝╠╣╦╩╬░▒▓█',
      'slashes':     ' /\\|─XVY*#',
      'dots':        ' ·•●○◦◎◉⊙⊚',
      'braille':     ' ⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿⡀⡁⡂⡃⡄⡅⡆⡇⣀⣄⣆⣇⣠⣤⣦⣧⣰⣴⣶⣷⣸⣼⣾⣿',
      'math':        ' ·±×÷≈≠≤≥∞∑∏∫√∂∆Ω',
      'stars':       ' ·✦✧★☆✪✫✬✭✮✯',
      'arrows':      ' ←↑→↓↔↕↖↗↘↙⇐⇑⇒⇓',
      'geometric':   ' ▪▫◊◇◆△▲▽▼□■○●',
      'currency':    ' ¢€£¥₹₽₿$∮∯∰',
    };
    return ramps[charset] || ramps['standard'];
  }


  // ── Glyph rendering system ──
  // Renders actual Unicode characters as pixel bitmaps via canvas
  const _glyphCache = {};
  function getGlyphs(rampStr, cw, ch, fontScale) {
    const fs = fontScale || 1.0;
    const key = rampStr + '|' + cw + '|' + ch + '|' + fs;
    if (_glyphCache[key]) return _glyphCache[key];
    const cvs = document.createElement('canvas');
    cvs.width = cw; cvs.height = ch;
    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    const fontSize = Math.max(4, Math.floor(Math.min(cw * 1.6, ch * 0.92) * fs));
    ctx.font = fontSize + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const chars = [...rampStr];
    const glyphs = [], coverages = [];
    for (const c of chars) {
      ctx.clearRect(0, 0, cw, ch);
      if (c !== ' ') {
        ctx.fillStyle = '#fff';
        ctx.fillText(c, cw / 2, ch / 2);
      }
      const id = ctx.getImageData(0, 0, cw, ch);
      const bm = new Uint8Array(cw * ch);
      let sum = 0;
      for (let i = 0; i < cw * ch; i++) {
        bm[i] = id.data[i * 4 + 3]; // alpha channel = glyph shape
        sum += bm[i];
      }
      glyphs.push(bm);
      coverages.push(sum / (cw * ch * 255));
    }
    // Build coverage-sorted index (light to dark)
    const sortIdx = coverages.map((_, i) => i).sort((a, b) => coverages[a] - coverages[b]);
    const result = {
      glyphs, coverages, sortIdx,
      sortedGlyphs: sortIdx.map(i => glyphs[i]),
      sortedCoverages: sortIdx.map(i => coverages[i]),
      cw, ch, count: chars.length
    };
    _glyphCache[key] = result;
    return result;
  }

  // Pick a glyph index from sorted list by target coverage (0=lightest, 1=darkest)
  function pickGlyphIdx(sortedCoverages, target) {
    const n = sortedCoverages.length;
    if (n === 0) return 0;
    if (target <= 0) return 0;
    if (target >= 1) return n - 1;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedCoverages[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(sortedCoverages[lo - 1] - target) < Math.abs(sortedCoverages[lo] - target)) lo--;
    return lo;
  }

  // Compute cell stats: average brightness, edge magnitude, edge angle, local contrast
  function cellStats(px, cx, cy, cw, ch, w, h) {
    let sum = 0, count = 0, mn = 255, mx = 0;
    for (let dy = 0; dy < ch && cy + dy < h; dy++) {
      for (let dx = 0; dx < cw && cx + dx < w; dx++) {
        const v = clamp(px[(cy + dy) * w + cx + dx]);
        sum += v; count++;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    const avg = count > 0 ? sum / count : 128;
    const contrast = mx - mn;
    const midX = Math.min(w - 2, Math.max(1, cx + (cw >> 1)));
    const midY = Math.min(h - 2, Math.max(1, cy + (ch >> 1)));
    const edge = sobelAt(px, midX, midY, w, h);
    return { avg, contrast, edgeMag: edge.mag, edgeAng: edge.ang, mn, mx };
  }

  // Stamp a glyph bitmap into the output array
  function stampGlyph(out, glyph, cx, cy, cw, ch, w, h, inkDark, inkLight) {
    for (let dy = 0; dy < ch && cy + dy < h; dy++) {
      for (let dx = 0; dx < cw && cx + dx < w; dx++) {
        const alpha = glyph[dy * cw + dx] / 255;
        out[(cy + dy) * w + cx + dx] = Math.round(inkLight * (1 - alpha) + inkDark * alpha);
      }
    }
  }

  const charsetOptions = [
    {value:'standard',label:'Standard .:-=+*#%@'},{value:'detailed',label:'Detailed (70 chars)'},
    {value:'blocks',label:'Blocks ░▒▓█'},{value:'blocks-ext',label:'Blocks Extended'},
    {value:'box-light',label:'Box Light ┌─┐'},{value:'box-heavy',label:'Box Heavy ╔═╗'},
    {value:'box-double',label:'Box Double ═║╬'},{value:'slashes',label:'Slashes /\\|'},
    {value:'dots',label:'Dots ·•●'},{value:'braille',label:'Braille ⠿⣿'},
    {value:'math',label:'Math ±×÷∞'},{value:'stars',label:'Stars ★✦✯'},
    {value:'arrows',label:'Arrows ←↑→↓'},{value:'geometric',label:'Geometric ◆▲●'},
    {value:'currency',label:'Currency $€£¥'}
  ];

  // ── 1. ASCII Art (main algorithm) ──
  A.push({ id:'ascii-standard', name:'ASCII Art', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'charset',label:'Characters',type:'select',options:charsetOptions,default:'standard'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'contrast',label:'Ink Contrast',min:0,max:1,step:.05,default:.9},
    {id:'edgeBoost',label:'Edge Boost',min:0,max:2,step:.1,default:.3},
    {id:'shadowDetail',label:'Shadow Detail',min:0,max:2,step:.1,default:1},
    {id:'highlightDetail',label:'Highlight Detail',min:0,max:2,step:.1,default:1},
    {id:'noise',label:'Noise',min:0,max:50,step:1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    const cs = p.cellSize;
    const ramp = asciiRamp(p.charset);
    const gl = getGlyphs(ramp, cs, cs, p.fontScale);
    const r = p.noise > 0 ? mkRand(p.seed) : null;
    const inkDark = Math.round(255 * (1 - p.contrast));
    const inkLight = 255;
    for (let cy = 0; cy < h; cy += cs) {
      for (let cx = 0; cx < w; cx += cs) {
        const st = cellStats(px, cx, cy, cs, cs, w, h);
        let brightness = st.avg / 255;
        if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
        if (p.edgeBoost > 0 && st.edgeMag > 20) {
          const edgeFactor = Math.min(1, st.edgeMag / 200) * p.edgeBoost;
          brightness = brightness * (1 - edgeFactor * 0.4);
        }
        if (brightness < 0.5) {
          brightness = 0.5 * Math.pow(brightness / 0.5, p.shadowDetail);
        } else {
          brightness = 1 - 0.5 * Math.pow((1 - brightness) / 0.5, p.highlightDetail);
        }
        if (r) brightness = Math.max(0, Math.min(1, brightness + (r() - 0.5) * p.noise / 255));
        if (p.invert) brightness = 1 - brightness;
        const target = 1 - brightness;
        const gi = pickGlyphIdx(gl.sortedCoverages, target);
        stampGlyph(o, gl.sortedGlyphs[gi], cx, cy, cs, cs, w, h, inkDark, inkLight);
      }
    }
    return o;
  }});

  // ── 2. ASCII Edge Detection ──
  A.push({ id:'ascii-edge', name:'ASCII Edges', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:16,step:1,default:8},
    {id:'edgeCharset',label:'Edge Characters',type:'select',options:[
      {value:'slashes',label:'Slashes /\\|─'},{value:'box-light',label:'Box Light ┌─┐'},
      {value:'box-heavy',label:'Box Heavy ╔═╗'},{value:'box-double',label:'Box Double ═║╬'},
      {value:'arrows',label:'Arrows ←↑→↓'},{value:'geometric',label:'Geometric ◆▲●'}
    ],default:'slashes'},
    {id:'fillCharset',label:'Fill Characters',type:'select',options:charsetOptions,default:'standard'},
    {id:'edgeThreshold',label:'Edge Threshold',min:5,max:150,step:5,default:30},
    {id:'edgeStrength',label:'Edge Darkness',min:0,max:1,step:.05,default:.8},
    {id:'fillOpacity',label:'Fill Opacity',min:0,max:1,step:.05,default:.7},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h); o.fill(255);
    const cs = p.cellSize;
    const edgeRamp = asciiRamp(p.edgeCharset);
    const fillRamp = asciiRamp(p.fillCharset);
    const egl = getGlyphs(edgeRamp, cs, cs, p.fontScale);
    const fgl = getGlyphs(fillRamp, cs, cs, p.fontScale);
    const edgeChars = [...edgeRamp];
    const hChars = new Set('─━═╌╍┄┈—–▬→←↔⇐⇒');
    const vChars = new Set('│┃║┆┇┊╎▮↑↓↕⇑⇓');
    const drChars = new Set('/╱↗↙◣');
    const dlChars = new Set('\\╲↘↖◢');
    const dirBuckets = { h: [], v: [], dr: [], dl: [], x: [] };
    for (let i = 0; i < edgeChars.length; i++) {
      const c = edgeChars[i]; if (c === ' ') continue;
      if (hChars.has(c)) dirBuckets.h.push(i);
      else if (vChars.has(c)) dirBuckets.v.push(i);
      else if (drChars.has(c)) dirBuckets.dr.push(i);
      else if (dlChars.has(c)) dirBuckets.dl.push(i);
      else dirBuckets.x.push(i);
    }
    const fallback = edgeChars.length > 1 ? edgeChars.length - 1 : 0;
    for (const k of ['h','v','dr','dl','x']) if (!dirBuckets[k].length) dirBuckets[k].push(fallback);
    const r = mkRand(p.seed);
    for (let cy = 0; cy < h; cy += cs) {
      for (let cx = 0; cx < w; cx += cs) {
        const st = cellStats(px, cx, cy, cs, cs, w, h);
        let brightness = st.avg / 255;
        if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
        if (p.invert) brightness = 1 - brightness;
        if (st.edgeMag > p.edgeThreshold) {
          const a = (st.edgeAng + Math.PI) % Math.PI;
          let bucket;
          if (a < Math.PI / 6 || a > 5 * Math.PI / 6) bucket = dirBuckets.h;
          else if (a > Math.PI / 3 && a < 2 * Math.PI / 3) bucket = dirBuckets.v;
          else if (a >= Math.PI / 6 && a <= Math.PI / 3) bucket = dirBuckets.dr;
          else bucket = dirBuckets.dl;
          const bi = bucket[Math.floor(r() * bucket.length)];
          const edgeDark = Math.round(255 * (1 - p.edgeStrength));
          stampGlyph(o, egl.glyphs[bi], cx, cy, cs, cs, w, h, edgeDark, 255);
        } else {
          const target = 1 - brightness;
          const gi = pickGlyphIdx(fgl.sortedCoverages, target * p.fillOpacity);
          stampGlyph(o, fgl.sortedGlyphs[gi], cx, cy, cs, cs, w, h, 0, 255);
        }
      }
    }
    return o;
  }});

  // ── 3. Block Mosaic ──
  A.push({ id:'ascii-blocks', name:'Block Mosaic', category:'ascii', params:[
    {id:'cellW',label:'Cell Width',min:2,max:12,step:1,default:4},
    {id:'cellH',label:'Cell Height',min:2,max:12,step:1,default:6},
    {id:'charset',label:'Style',type:'select',options:[
      {value:'blocks',label:'Blocks ░▒▓█'},{value:'blocks-ext',label:'Extended ·░▒▓▊█'},
      {value:'geometric',label:'Geometric ▪▫◊◇◆'},{value:'dots',label:'Dots ·•●○'},
      {value:'braille',label:'Braille ⠿⣿'},{value:'standard',label:'ASCII .:-=+*#%@'}
    ],default:'blocks'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'dither',label:'Dither Amount',min:0,max:1,step:.05,default:.15},
    {id:'edgeDetect',label:'Edge Sharpening',min:0,max:2,step:.1,default:0},
    {id:'contrast',label:'Contrast',min:0,max:1,step:.05,default:.85},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    const cw = p.cellW, ch = p.cellH;
    const ramp = asciiRamp(p.charset);
    const gl = getGlyphs(ramp, cw, ch, p.fontScale);
    const r = mkRand(p.seed);
    const inkDark = Math.round(255 * (1 - p.contrast));
    for (let cy = 0; cy < h; cy += ch) {
      for (let cx = 0; cx < w; cx += cw) {
        const st = cellStats(px, cx, cy, cw, ch, w, h);
        let brightness = st.avg / 255;
        if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
        if (p.invert) brightness = 1 - brightness;
        if (p.edgeDetect > 0 && st.edgeMag > 15) {
          const ef = Math.min(1, st.edgeMag / 150) * p.edgeDetect;
          brightness = brightness < 0.5 ? brightness * (1 - ef * 0.5) : brightness + (1 - brightness) * ef * 0.5;
        }
        if (p.dither > 0) brightness = Math.max(0, Math.min(1, brightness + (r() - 0.5) * p.dither));
        const target = 1 - brightness;
        const gi = pickGlyphIdx(gl.sortedCoverages, target);
        stampGlyph(o, gl.sortedGlyphs[gi], cx, cy, cw, ch, w, h, inkDark, 255);
      }
    }
    return o;
  }});

  // ── 4. ASCII Halftone ──
  A.push({ id:'ascii-halftone', name:'ASCII Halftone', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:16,step:1,default:8},
    {id:'charset',label:'Characters',type:'select',options:charsetOptions,default:'dots'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'angle',label:'Screen Angle',min:0,max:90,step:5,default:45},
    {id:'frequency',label:'Screen Frequency',min:.5,max:3,step:.1,default:1},
    {id:'contrast',label:'Contrast',min:0,max:1,step:.05,default:.85},
    {id:'dotGain',label:'Dot Gain',min:-.5,max:.5,step:.05,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    const cs = p.cellSize;
    const ramp = asciiRamp(p.charset);
    const gl = getGlyphs(ramp, cs, cs, p.fontScale);
    const ang = p.angle * Math.PI / 180, cosA = Math.cos(ang), sinA = Math.sin(ang);
    const inkDark = Math.round(255 * (1 - p.contrast));
    for (let cy = 0; cy < h; cy += cs) {
      for (let cx = 0; cx < w; cx += cs) {
        const st = cellStats(px, cx, cy, cs, cs, w, h);
        let brightness = st.avg / 255;
        if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
        if (p.invert) brightness = 1 - brightness;
        const ncx = (cx / cs) * p.frequency, ncy = (cy / cs) * p.frequency;
        const rx = ncx * cosA + ncy * sinA;
        const ry = -ncx * sinA + ncy * cosA;
        const screenVal = (Math.sin(rx * Math.PI) * Math.sin(ry * Math.PI) + 1) / 2;
        const modulated = brightness + (screenVal - 0.5) * 0.3 + p.dotGain;
        const clamped = Math.max(0, Math.min(1, modulated));
        const target = 1 - clamped;
        const gi = pickGlyphIdx(gl.sortedCoverages, target);
        stampGlyph(o, gl.sortedGlyphs[gi], cx, cy, cs, cs, w, h, inkDark, 255);
      }
    }
    return o;
  }});

  // ── 5. Matrix Rain ──
  A.push({ id:'ascii-matrix', name:'Matrix Rain', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:14,step:1,default:7},
    {id:'charset',label:'Characters',type:'select',options:charsetOptions,default:'standard'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'density',label:'Column Density',min:.1,max:1,step:.05,default:.65},
    {id:'trail',label:'Trail Length',min:3,max:30,step:1,default:10},
    {id:'brightness',label:'Glow Brightness',min:.3,max:1,step:.05,default:.8},
    {id:'imageBlend',label:'Image Influence',min:0,max:1,step:.05,default:.5},
    {id:'randomChars',label:'Random Characters',type:'checkbox',default:true},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h); o.fill(0);
    const cs = p.cellSize;
    const ramp = asciiRamp(p.charset);
    const gl = getGlyphs(ramp, cs, cs, p.fontScale);
    const r = mkRand(p.seed);
    const cols = Math.ceil(w / cs), rows = Math.ceil(h / cs);
    for (let col = 0; col < cols; col++) {
      if (r() > p.density) continue;
      const startRow = Math.floor(r() * rows);
      for (let row = startRow; row < startRow + p.trail && row < rows; row++) {
        const cy = row * cs, cx = col * cs;
        if (cy >= h || cx >= w) continue;
        const st = cellStats(px, cx, cy, cs, cs, w, h);
        let brt = st.avg / 255;
        if (p.gamma !== 1) brt = Math.pow(brt, p.gamma);
        const fade = 1 - (row - startRow) / p.trail;
        const imgInfluence = brt * p.imageBlend + (1 - p.imageBlend);
        const intensity = fade * p.brightness * imgInfluence;
        let gi;
        if (p.randomChars) {
          gi = Math.floor(r() * gl.count);
        } else {
          const target = 1 - brt;
          gi = pickGlyphIdx(gl.sortedCoverages, target);
          gi = gl.sortIdx[gi]; // convert back to unsorted index
        }
        const glyph = gl.glyphs[gi];
        for (let dy = 0; dy < cs && cy + dy < h; dy++) {
          for (let dx = 0; dx < cs && cx + dx < w; dx++) {
            const alpha = glyph[dy * cs + dx] / 255;
            const v = Math.round(alpha * intensity * 255);
            const idx = (cy + dy) * w + cx + dx;
            o[idx] = Math.max(o[idx], v);
          }
        }
      }
    }
    return o;
  }});

  // ── 6. Braille Render ──
  A.push({ id:'ascii-braille', name:'Braille Render', category:'ascii', params:[
    {id:'dotSize',label:'Dot Size',min:2,max:6,step:1,default:3},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'adaptiveThreshold',label:'Adaptive Threshold',min:0,max:1,step:.05,default:.3},
    {id:'edgeWeight',label:'Edge Weight',min:0,max:2,step:.1,default:.5},
    {id:'noise',label:'Noise',min:0,max:60,step:1,default:0},
    {id:'dotShape',label:'Dot Shape',type:'select',options:[
      {value:'round',label:'Round'},{value:'square',label:'Square'},{value:'diamond',label:'Diamond'}
    ],default:'round'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    o.fill(p.invert ? 0 : 255);
    const ds = p.dotSize;
    const cellW = ds * 2, cellH = ds * 4;
    const rnd = p.noise > 0 ? mkRand(p.seed) : null;
    const dotR = ds / 2;
    for (let cy = 0; cy < h; cy += cellH) {
      for (let cx = 0; cx < w; cx += cellW) {
        let localSum = 0, localCount = 0;
        for (let dy = 0; dy < cellH && cy + dy < h; dy++) {
          for (let dx = 0; dx < cellW && cx + dx < w; dx++) {
            localSum += clamp(px[(cy + dy) * w + cx + dx]);
            localCount++;
          }
        }
        const localAvg = localCount > 0 ? localSum / localCount : 128;
        const thr = p.threshold * (1 - p.adaptiveThreshold) + localAvg * p.adaptiveThreshold;
        for (let dotY = 0; dotY < 4; dotY++) {
          for (let dotX = 0; dotX < 2; dotX++) {
            const scy = cy + dotY * ds, scx = cx + dotX * ds;
            let sum = 0, cnt = 0;
            for (let sy = 0; sy < ds && scy + sy < h; sy++) {
              for (let sx = 0; sx < ds && scx + sx < w; sx++) {
                sum += clamp(px[(scy + sy) * w + scx + sx]);
                cnt++;
              }
            }
            if (cnt === 0) continue;
            let val = sum / cnt;
            if (p.gamma !== 1) val = Math.pow(val / 255, p.gamma) * 255;
            if (p.edgeWeight > 0) {
              const emx = Math.min(w - 2, Math.max(1, scx + (ds >> 1)));
              const emy = Math.min(h - 2, Math.max(1, scy + (ds >> 1)));
              const e = sobelAt(px, emx, emy, w, h);
              if (e.mag > 15) val -= e.mag * p.edgeWeight * 0.5;
            }
            if (rnd) val += (rnd() - 0.5) * p.noise;
            const isDark = p.invert ? val > thr : val < thr;
            if (isDark) {
              const centerX = dotR, centerY = dotR;
              for (let sy = 0; sy < ds && scy + sy < h; sy++) {
                for (let sx = 0; sx < ds && scx + sx < w; sx++) {
                  let inside = false;
                  if (p.dotShape === 'round') {
                    const ddx = sx - centerX + 0.5, ddy = sy - centerY + 0.5;
                    inside = Math.sqrt(ddx * ddx + ddy * ddy) <= dotR;
                  } else if (p.dotShape === 'diamond') {
                    inside = Math.abs(sx - centerX + 0.5) + Math.abs(sy - centerY + 0.5) <= dotR;
                  } else {
                    inside = true;
                  }
                  if (inside) {
                    o[(scy + sy) * w + scx + sx] = p.invert ? 255 : 0;
                  }
                }
              }
            }
          }
        }
      }
    }
    return o;
  }});

  // ── 7. Box Drawing ──
  A.push({ id:'ascii-box-drawing', name:'Box Drawing', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:16,step:1,default:8},
    {id:'charset',label:'Style',type:'select',options:[
      {value:'box-light',label:'Light ┌─┐│└┘'},{value:'box-heavy',label:'Heavy ╔═╗║'},
      {value:'box-double',label:'Double ═║╔╗╚╝'},{value:'slashes',label:'Slashes /\\|─'},
      {value:'geometric',label:'Geometric ◆▲●'}
    ],default:'box-light'},
    {id:'fillCharset',label:'Fill Style',type:'select',options:charsetOptions,default:'blocks'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'edgeThreshold',label:'Edge Threshold',min:5,max:120,step:5,default:25},
    {id:'fillOpacity',label:'Fill Density',min:0,max:1,step:.05,default:.6},
    {id:'lineWeight',label:'Line Darkness',min:0,max:1,step:.05,default:.9},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h); o.fill(255);
    const cs = p.cellSize;
    const edgeRamp = asciiRamp(p.charset);
    const fillRamp = asciiRamp(p.fillCharset);
    const egl = getGlyphs(edgeRamp, cs, cs, p.fontScale);
    const fgl = getGlyphs(fillRamp, cs, cs, p.fontScale);
    const r = mkRand(p.seed);
    const lineDark = Math.round(255 * (1 - p.lineWeight));
    const edgeChars = [...edgeRamp];
    const hChars = new Set('─━═╌╍┄┈—–▬→←↔⇐⇒');
    const vChars = new Set('│┃║┆┇┊╎▮↑↓↕⇑⇓');
    const drChars = new Set('/╱↗↙◣');
    const dlChars = new Set('\\╲↘↖◢');
    const dirBuckets = { h: [], v: [], dr: [], dl: [], x: [] };
    for (let i = 0; i < edgeChars.length; i++) {
      const c = edgeChars[i]; if (c === ' ') continue;
      if (hChars.has(c)) dirBuckets.h.push(i);
      else if (vChars.has(c)) dirBuckets.v.push(i);
      else if (drChars.has(c)) dirBuckets.dr.push(i);
      else if (dlChars.has(c)) dirBuckets.dl.push(i);
      else dirBuckets.x.push(i);
    }
    const fb = edgeChars.length > 1 ? edgeChars.length - 1 : 0;
    for (const k of ['h','v','dr','dl','x']) if (!dirBuckets[k].length) dirBuckets[k].push(fb);
    for (let cy = 0; cy < h; cy += cs) {
      for (let cx = 0; cx < w; cx += cs) {
        const st = cellStats(px, cx, cy, cs, cs, w, h);
        let brightness = st.avg / 255;
        if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
        if (p.invert) brightness = 1 - brightness;
        if (st.edgeMag > p.edgeThreshold) {
          const a = (st.edgeAng + Math.PI) % Math.PI;
          let bucket;
          if (a < Math.PI / 6 || a > 5 * Math.PI / 6) bucket = dirBuckets.h;
          else if (a > Math.PI / 3 && a < 2 * Math.PI / 3) bucket = dirBuckets.v;
          else if (a >= Math.PI / 6 && a <= Math.PI / 3) bucket = dirBuckets.dr;
          else bucket = dirBuckets.dl;
          const bi = bucket[Math.floor(r() * bucket.length)];
          stampGlyph(o, egl.glyphs[bi], cx, cy, cs, cs, w, h, lineDark, 255);
        } else if (p.fillOpacity > 0) {
          const target = (1 - brightness) * p.fillOpacity;
          const gi = pickGlyphIdx(fgl.sortedCoverages, target);
          stampGlyph(o, fgl.sortedGlyphs[gi], cx, cy, cs, cs, w, h, 0, 255);
        }
      }
    }
    return o;
  }});

  // ── 8. Typewriter ──
  A.push({ id:'ascii-typewriter', name:'Typewriter', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:14,step:1,default:7},
    {id:'charset',label:'Characters',type:'select',options:charsetOptions,default:'detailed'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'overprint',label:'Overprint Passes',min:1,max:5,step:1,default:2},
    {id:'jitter',label:'Registration Jitter',min:0,max:4,step:1,default:1},
    {id:'inkDensity',label:'Ink Density',min:.2,max:1,step:.05,default:.7},
    {id:'inkVariation',label:'Ink Variation',min:0,max:.5,step:.05,default:.15},
    {id:'paperTone',label:'Paper Tone',min:200,max:255,step:1,default:240},
    {id:'edgeBoost',label:'Edge Darkening',min:0,max:2,step:.1,default:.3},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    const cs = p.cellSize;
    const ramp = asciiRamp(p.charset);
    const gl = getGlyphs(ramp, cs, cs, p.fontScale);
    const r = mkRand(p.seed);
    o.fill(p.invert ? 255 - p.paperTone : p.paperTone);
    for (let pass = 0; pass < p.overprint; pass++) {
      const ox = Math.round((r() - 0.5) * p.jitter);
      const oy = Math.round((r() - 0.5) * p.jitter);
      const passInkVar = 1 - r() * p.inkVariation;
      for (let cy = 0; cy < h; cy += cs) {
        for (let cx = 0; cx < w; cx += cs) {
          const st = cellStats(px, cx, cy, cs, cs, w, h);
          let brightness = st.avg / 255;
          if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
          if (p.invert) brightness = 1 - brightness;
          if (p.edgeBoost > 0 && st.edgeMag > 20) {
            const ef = Math.min(1, st.edgeMag / 200) * p.edgeBoost;
            brightness *= (1 - ef * 0.4);
          }
          const target = 1 - brightness;
          const gi = pickGlyphIdx(gl.sortedCoverages, target);
          const glyph = gl.sortedGlyphs[gi];
          const inkStr = p.inkDensity * passInkVar * (0.5 + r() * 0.5);
          for (let dy = 0; dy < cs && cy + dy + oy >= 0 && cy + dy + oy < h; dy++) {
            for (let dx = 0; dx < cs && cx + dx + ox >= 0 && cx + dx + ox < w; dx++) {
              const fy = cy + dy + oy, fx = cx + dx + ox;
              if (fx < 0 || fx >= w || fy < 0 || fy >= h) continue;
              const alpha = glyph[dy * cs + dx] / 255;
              const inkAmount = alpha * inkStr;
              const idx = fy * w + fx;
              if (p.invert) {
                o[idx] = Math.min(255, o[idx] + Math.round(inkAmount * 255));
              } else {
                o[idx] = Math.max(0, Math.round(o[idx] * (1 - inkAmount)));
              }
            }
          }
        }
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // CLASSIC EXTENSIONS (2 — Riemersma, Ostromoukhov)
  // ═══════════════════════════════════════════

  // Hilbert curve walk — produces (x,y) sequence for any rect (clamps to fit
  // a power-of-2 covering). Used by Riemersma dither.
  function* hilbertWalk(w, h) {
    const order = Math.ceil(Math.log2(Math.max(w, h)));
    const N = 1 << order;
    function rot(n, x, y, rx, ry) {
      if (ry === 0) {
        if (rx === 1) { x = n - 1 - x; y = n - 1 - y; }
        return [y, x];
      }
      return [x, y];
    }
    for (let d = 0; d < N * N; d++) {
      let x = 0, y = 0, t = d;
      for (let s = 1; s < N; s *= 2) {
        const rx = 1 & (t / 2);
        const ry = 1 & (t ^ rx);
        [x, y] = rot(s, x, y, rx, ry);
        x += s * rx; y += s * ry;
        t = Math.floor(t / 4);
      }
      if (x < w && y < h) yield [x, y];
    }
  }

  A.push({ id:'riemersma', name:'Riemersma (Hilbert)', category:'classic', params:[
    {id:'historySize',label:'History',min:4,max:32,step:1,default:16},
    {id:'decay',label:'Decay',min:.05,max:.4,step:.01,default:.16},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    const buf = new Float32Array(px);
    const N = p.historySize;
    const history = new Float32Array(N);
    const weights = new Float32Array(N);
    // exponential weights: latest sample has the largest weight, sums to 1
    let wsum = 0;
    for (let i = 0; i < N; i++) {
      weights[i] = Math.exp(-p.decay * (N - 1 - i));
      wsum += weights[i];
    }
    for (let i = 0; i < N; i++) weights[i] /= wsum;
    let head = 0;
    for (const [x, y] of hilbertWalk(w, h)) {
      const i = y * w + x;
      let v = buf[i];
      if (p.gamma !== 1) v = Math.pow(Math.max(0, v) / 255, p.gamma) * 255;
      // accumulated diffused error from history
      let acc = 0;
      for (let k = 0; k < N; k++) acc += history[k] * weights[k];
      v += acc;
      const nv = v > p.threshold ? 255 : 0;
      const err = v - nv;
      // push error into history (newest at head)
      history[head] = err;
      head = (head + 1) % N;
      o[i] = p.invert ? 255 - nv : nv;
    }
    return o;
  }});

  // Ostromoukhov variable-coefficient Floyd-Steinberg.
  // Coefficients vary per intensity level (3 weights per row, /sum)
  const OSTRO = (() => {
    // Compact 16-entry table interpolated to 256.
    // Source pattern: Ostromoukhov 2001 "A Simple and Efficient Error-Diffusion Algorithm"
    const seed = [
      [13,0,5],[1,0,0],[7,3,5],[5,3,2],[4,2,3],[10,6,7],[7,3,4],[8,4,5],
      [11,5,6],[5,2,3],[7,3,4],[6,3,3],[5,2,3],[7,3,4],[1,0,1],[7,3,5]
    ];
    const T = new Array(256);
    for (let i = 0; i < 256; i++) {
      const f = i / 16, lo = Math.min(15, Math.floor(f)), hi = Math.min(15, lo + 1), t = f - lo;
      const a = seed[lo], b = seed[hi];
      const r = a[0]*(1-t) + b[0]*t;
      const dl = a[1]*(1-t) + b[1]*t;
      const d = a[2]*(1-t) + b[2]*t;
      const s = r + dl + d || 1;
      T[i] = [r/s, dl/s, d/s];
    }
    return T;
  })();

  A.push({ id:'ostromoukhov', name:'Ostromoukhov', category:'classic', params:[
    {id:'strength',label:'Diffusion',min:0,max:1,step:.01,default:1},
    {id:'serpentine',label:'Serpentine',type:'checkbox',default:true},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'noise',label:'Noise',min:0,max:60,step:1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h), buf = new Float32Array(px);
    const r = p.noise > 0 ? mkRand(p.seed) : null;
    for (let y = 0; y < h; y++) {
      const ltr = !p.serpentine || (y % 2 === 0);
      const sx = ltr ? 0 : w-1, ex = ltr ? w : -1, dx = ltr ? 1 : -1;
      for (let x = sx; x !== ex; x += dx) {
        const i = y*w+x;
        let v = clamp(buf[i]);
        if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
        if (r) v = clamp(v + (r() - 0.5) * p.noise * 2);
        const idx = Math.max(0, Math.min(255, Math.round(v)));
        const nv = v > p.threshold ? 255 : 0;
        o[i] = nv;
        const err = (v - nv) * p.strength;
        const [wr, wdl, wd] = OSTRO[idx];
        const xr = x + (ltr ? 1 : -1);
        const xl = x + (ltr ? -1 : 1);
        if (xr >= 0 && xr < w)            buf[y*w + xr]     += err * wr;
        if (y + 1 < h && xl >= 0 && xl < w) buf[(y+1)*w + xl] += err * wdl;
        if (y + 1 < h)                    buf[(y+1)*w + x]   += err * wd;
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // IMAGE-AWARE (5) — algorithms that read edges/gradients/luminance
  // and let those features steer the dithering / hatching.
  // ═══════════════════════════════════════════

  // Helper: build sobel magnitude + gradient angle fields once.
  function gradientFields(px, w, h) {
    const mag = new Float32Array(w * h);
    const ang = new Float32Array(w * h);
    let maxMag = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y*w + x;
        const tl = px[i-w-1], t = px[i-w], tr = px[i-w+1];
        const l  = px[i-1],            r  = px[i+1];
        const bl = px[i+w-1], b = px[i+w], br = px[i+w+1];
        const gx = (tr + 2*r + br) - (tl + 2*l + bl);
        const gy = (bl + 2*b + br) - (tl + 2*t + tr);
        const m = Math.sqrt(gx*gx + gy*gy);
        mag[i] = m; ang[i] = Math.atan2(gy, gx);
        if (m > maxMag) maxMag = m;
      }
    }
    if (maxMag > 0) for (let k = 0; k < mag.length; k++) mag[k] /= maxMag;
    return { mag, ang, maxMag };
  }

  // 1) Edge-Aware Floyd-Steinberg — diffusion strength scales with edges so
  // sharp boundaries stay crisp while flat areas get full diffusion.
  A.push({ id:'edge-aware-fs', name:'Edge-Aware Floyd-Steinberg', category:'image-aware', params:[
    {id:'baseStrength',label:'Base Diffusion',min:0,max:1,step:.01,default:1},
    {id:'edgeStrength',label:'Edge Bias',min:-1,max:1,step:.05,default:-.7,
     hint:'negative = preserve edges, positive = enhance diffusion at edges'},
    {id:'edgeRadius',label:'Edge Smoothing',min:0,max:5,step:1,default:1},
    {id:'serpentine',label:'Serpentine',type:'checkbox',default:true},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h), buf = new Float32Array(px);
    const { mag } = gradientFields(px, w, h);
    // Optional smoothing of edge field with a small box blur
    let edgeField = mag;
    if (p.edgeRadius > 0) {
      const er = p.edgeRadius, tmp = new Float32Array(w*h), out2 = new Float32Array(w*h);
      const k = er * 2 + 1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0; for (let dx = -er; dx <= er; dx++) {
          const xx = Math.min(w-1, Math.max(0, x+dx)); s += mag[y*w+xx];
        } tmp[y*w+x] = s/k;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0; for (let dy = -er; dy <= er; dy++) {
          const yy = Math.min(h-1, Math.max(0, y+dy)); s += tmp[yy*w+x];
        } out2[y*w+x] = s/k;
      }
      edgeField = out2;
    }
    const matrix = [[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]];
    for (let y = 0; y < h; y++) {
      const ltr = !p.serpentine || (y % 2 === 0);
      const sx = ltr ? 0 : w-1, ex = ltr ? w : -1, dx = ltr ? 1 : -1;
      for (let x = sx; x !== ex; x += dx) {
        const i = y*w+x;
        let v = clamp(buf[i]);
        if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
        const nv = v > p.threshold ? 255 : 0;
        o[i] = nv;
        const e = edgeField[i]; // 0-1
        const localStr = Math.max(0, Math.min(2, p.baseStrength * (1 + p.edgeStrength * e)));
        const err = (v - nv) * localStr;
        for (const [mdx, mdy, mw] of matrix) {
          const nx = x + (ltr ? mdx : -mdx), ny = y + mdy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) buf[ny*w+nx] += err * mw;
        }
      }
    }
    return o;
  }});

  // 2) Structure-Tensor Hatching — strokes oriented along the dominant
  // local gradient direction (perpendicular = isophote tangent).
  A.push({ id:'structure-hatch', name:'Structure-Tensor Hatch', category:'image-aware', params:[
    {id:'spacing',label:'Stroke Spacing',min:2,max:20,step:1,default:5},
    {id:'length',label:'Stroke Length',min:3,max:40,step:1,default:12},
    {id:'thickness',label:'Thickness',min:1,max:4,step:1,default:1},
    {id:'follow',label:'Follow Edges',min:0,max:1,step:.05,default:1,
     hint:'1 = strokes follow gradient, 0 = horizontal hatching'},
    {id:'darkBias',label:'Dark Bias',min:0,max:2,step:.05,default:1,
     hint:'how strongly tone affects stroke density'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const { mag, ang } = gradientFields(px, w, h);
    const sp = p.spacing, len = p.length, th = p.thickness;
    for (let y = 0; y < h; y += sp) for (let x = 0; x < w; x += sp) {
      const i = y*w+x;
      let v = clamp(px[i])/255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      // Probability of placing a stroke here based on darkness * darkBias
      const density = Math.pow(1 - v, p.darkBias);
      if (density < 0.05) continue;
      // Stroke direction = isophote tangent = perpendicular to gradient
      const a = ang[i] || 0;
      const baseAng = a + Math.PI / 2;
      const dirAng = baseAng * p.follow; // 0 = horizontal, 1 = full follow
      const dxs = Math.cos(dirAng), dys = Math.sin(dirAng);
      const half = (len * density) / 2;
      const ink = p.invert ? 255 : 0;
      for (let t = -half; t <= half; t += 0.5) {
        const sx = Math.round(x + t * dxs), sy = Math.round(y + t * dys);
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        for (let dty = -Math.floor(th/2); dty <= Math.floor(th/2); dty++)
          for (let dtx = -Math.floor(th/2); dtx <= Math.floor(th/2); dtx++) {
            const fx = sx + dtx, fy = sy + dty;
            if (fx >= 0 && fx < w && fy >= 0 && fy < h) o[fy*w+fx] = ink;
          }
      }
    }
    return o;
  }});

  // 3) Adaptive Halftone — dot size modulated by local variance so detailed
  // areas get smaller dots (more resolution) and flat areas get larger dots.
  A.push({ id:'adaptive-halftone', name:'Adaptive Halftone', category:'image-aware', params:[
    {id:'baseSize',label:'Base Dot Size',min:3,max:24,step:1,default:8},
    {id:'sizeVariance',label:'Size Adaptation',min:0,max:1,step:.05,default:.6,
     hint:'how much local detail shrinks dots'},
    {id:'angle',label:'Angle',min:0,max:90,step:1,default:45},
    {id:'shape',label:'Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'}
    ],default:'circle'},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    const { mag } = gradientFields(px, w, h);
    // Dilate edge field with a local-window mean for variance proxy
    const winR = 4, winK = (winR*2+1)*(winR*2+1);
    const variance = new Float32Array(w*h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -winR; dy <= winR; dy++) for (let dx = -winR; dx <= winR; dx++) {
        const xx = Math.max(0, Math.min(w-1, x+dx));
        const yy = Math.max(0, Math.min(h-1, y+dy));
        s += mag[yy*w+xx];
      }
      variance[y*w+x] = s / winK;
    }
    const ang = p.angle * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // Local cell size: shrink in detailed regions
      const localSize = Math.max(2, p.baseSize * (1 - variance[y*w+x] * p.sizeVariance));
      const rx = x*ca + y*sa, ry = -x*sa + y*ca;
      const cx = ((rx % localSize) + localSize) % localSize;
      const cy = ((ry % localSize) + localSize) % localSize;
      const nx = (cx/localSize - .5)*2, ny2 = (cy/localSize - .5)*2;
      let d;
      if (p.shape === 'diamond') d = Math.abs(nx) + Math.abs(ny2);
      else if (p.shape === 'square') d = Math.max(Math.abs(nx), Math.abs(ny2));
      else d = Math.sqrt(nx*nx + ny2*ny2);
      let val = clamp(px[y*w+x]) / 255;
      if (p.gamma !== 1) val = Math.pow(val, p.gamma);
      const t = (1 - val) * 1.42;
      let result;
      if (p.softness > 0) { const s2 = d - t; result = clamp(128 - s2/p.softness*128); }
      else result = d < t ? 0 : 255;
      o[y*w+x] = p.invert ? 255 - result : result;
    }
    return o;
  }});

  // 4) Flow-Field Stipple — stipples placed along streamlines that follow
  // the image gradient field. Areas with strong direction get coherent
  // stipple flows; flat areas get isotropic dots.
  A.push({ id:'flow-stipple', name:'Flow-Field Stipple', category:'image-aware', params:[
    {id:'density',label:'Density',min:50,max:1500,step:50,default:500,
     hint:'number of seed points per 100k pixels'},
    {id:'streamLen',label:'Stream Length',min:2,max:30,step:1,default:10},
    {id:'streamStep',label:'Step Size',min:.5,max:3,step:.25,default:1},
    {id:'dotSize',label:'Dot Size',min:1,max:4,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const { ang } = gradientFields(px, w, h);
    const ink = p.invert ? 255 : 0;
    const r = mkRand(p.seed);
    const nSeeds = Math.round(p.density * (w * h) / 100000);
    for (let s = 0; s < nSeeds; s++) {
      let x = r() * w, y = r() * h;
      // Reject seeds in highlights based on luminance (probabilistic)
      const sv = clamp(px[Math.floor(y)*w + Math.floor(x)]) / 255;
      const darkness = 1 - (p.gamma !== 1 ? Math.pow(sv, p.gamma) : sv);
      if (r() > darkness) continue;
      // Walk along (and against) the gradient tangent for streamLen steps
      for (let dir = -1; dir <= 1; dir += 2) {
        let cx = x, cy = y;
        for (let k = 0; k < p.streamLen; k++) {
          const ix = Math.floor(cx), iy = Math.floor(cy);
          if (ix < 0 || ix >= w || iy < 0 || iy >= h) break;
          // Stamp dot
          for (let dy = 0; dy < p.dotSize; dy++) for (let dx = 0; dx < p.dotSize; dx++) {
            const fx = ix + dx, fy = iy + dy;
            if (fx >= 0 && fx < w && fy >= 0 && fy < h) o[fy*w+fx] = ink;
          }
          // Step along isophote tangent (perpendicular to gradient)
          const a = (ang[iy*w+ix] || 0) + Math.PI / 2;
          cx += Math.cos(a) * p.streamStep * dir;
          cy += Math.sin(a) * p.streamStep * dir;
        }
      }
    }
    return o;
  }});

  // 5) Contour Stipple — stipples concentrated on iso-luminance contours
  // (sharp edges in tone). Like a topographic map of the image.
  A.push({ id:'contour-stipple', name:'Contour Stipple', category:'image-aware', params:[
    {id:'levels',label:'Tone Levels',min:3,max:24,step:1,default:8,
     hint:'number of contour bands'},
    {id:'density',label:'Stipple Density',min:.1,max:1,step:.05,default:.5},
    {id:'dotSize',label:'Dot Size',min:1,max:4,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const r = mkRand(p.seed);
    const ink = p.invert ? 255 : 0;
    const step = 255 / p.levels;
    for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++) {
      const i = y*w+x;
      let v = clamp(px[i]);
      if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
      const band = Math.floor(v / step);
      // Check if any 4-neighbor is in a different band → on contour
      const bandT = Math.floor(clamp(px[i-w]) / step);
      const bandB = Math.floor(clamp(px[i+w]) / step);
      const bandL = Math.floor(clamp(px[i-1]) / step);
      const bandR = Math.floor(clamp(px[i+1]) / step);
      const onContour = (band !== bandT) || (band !== bandB) || (band !== bandL) || (band !== bandR);
      if (onContour && r() < p.density) {
        for (let dy = 0; dy < p.dotSize; dy++) for (let dx = 0; dx < p.dotSize; dx++) {
          const fx = x + dx, fy = y + dy;
          if (fx >= 0 && fx < w && fy >= 0 && fy < h) o[fy*w+fx] = ink;
        }
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // ADVANCED IMAGE-AWARE PATTERNS (5)
  // Ordered & halftone algorithms that read the image deeply: they let
  // image gradients, edges, tone zones, or local detail steer pattern
  // size, screen angle, dot density, and stroke flow.
  // ═══════════════════════════════════════════

  // Reusable detail field: returns 0-1 per pixel.
  // mode: 'edges' (sobel mag), 'variance' (windowed stddev), 'luminance' (raw).
  // radius: post-smoothing box-blur radius.
  function detailField(px, w, h, mode, radius) {
    const n = w * h;
    let field = new Float32Array(n);
    if (mode === 'luminance') {
      for (let i = 0; i < n; i++) field[i] = clamp(px[i]) / 255;
    } else if (mode === 'variance') {
      const winR = 3, winK = (winR*2+1)*(winR*2+1);
      let maxV = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, ss = 0;
        for (let dy = -winR; dy <= winR; dy++) for (let dx = -winR; dx <= winR; dx++) {
          const xx = Math.max(0, Math.min(w-1, x+dx));
          const yy = Math.max(0, Math.min(h-1, y+dy));
          const v = px[yy*w+xx];
          s += v; ss += v*v;
        }
        const mean = s / winK;
        const variance = ss / winK - mean * mean;
        const sd = Math.sqrt(Math.max(0, variance));
        field[y*w+x] = sd;
        if (sd > maxV) maxV = sd;
      }
      if (maxV > 0) for (let i = 0; i < n; i++) field[i] /= maxV;
    } else {
      // edges
      const g = gradientFields(px, w, h);
      field = g.mag;
    }
    if (radius > 0) {
      const r = radius, k = r * 2 + 1;
      const tmp = new Float32Array(n), out2 = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0; for (let dx = -r; dx <= r; dx++) {
          const xx = Math.max(0, Math.min(w-1, x+dx)); s += field[y*w+xx];
        } tmp[y*w+x] = s/k;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0; for (let dy = -r; dy <= r; dy++) {
          const yy = Math.max(0, Math.min(h-1, y+dy)); s += tmp[yy*w+x];
        } out2[y*w+x] = s/k;
      }
      field = out2;
    }
    return field;
  }

  // Local-region gradient: average gradient direction over a region of
  // `regionSize` pixels so the orientation is stable (not per-pixel noise).
  function regionGradients(px, w, h, regionSize) {
    const { mag, ang } = gradientFields(px, w, h);
    if (regionSize <= 1) return { mag, ang };
    const r = Math.max(1, Math.floor(regionSize / 2));
    const k = r * 2 + 1;
    const angOut = new Float32Array(w * h);
    const magOut = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sumX = 0, sumY = 0, sumM = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = Math.max(0, Math.min(w-1, x+dx));
        const yy = Math.max(0, Math.min(h-1, y+dy));
        const i = yy*w+xx;
        const m = mag[i];
        if (m > 0) {
          // Use vector with double-angle to handle 180° symmetry of orientation
          const a2 = ang[i] * 2;
          sumX += Math.cos(a2) * m;
          sumY += Math.sin(a2) * m;
        }
        sumM += m; n++;
      }
      angOut[y*w+x] = Math.atan2(sumY, sumX) / 2;
      magOut[y*w+x] = sumM / n;
    }
    return { mag: magOut, ang: angOut };
  }

  // 1) Adaptive Bayer — matrix size varies per pixel based on detail.
  // High-detail areas get small matrices (more dither resolution),
  // flat areas get big matrices (smoother gradients).
  A.push({ id:'adaptive-bayer', name:'Adaptive Bayer', category:'image-aware', params:[
    {id:'minSize',label:'Min Matrix',type:'select',options:[
      {value:2,label:'2x2'},{value:4,label:'4x4'},{value:8,label:'8x8'}
    ],default:2},
    {id:'maxSize',label:'Max Matrix',type:'select',options:[
      {value:8,label:'8x8'},{value:16,label:'16x16'},{value:32,label:'32x32'},{value:64,label:'64x64'}
    ],default:16},
    {id:'detailMode',label:'Detail Source',type:'select',options:[
      {value:'edges',label:'Edges (Sobel)'},
      {value:'variance',label:'Local Variance'},
      {value:'luminance',label:'Luminance'}
    ],default:'edges'},
    {id:'detailRadius',label:'Smoothing',min:0,max:10,step:1,default:2,
     hint:'blur the detail map before sampling'},
    {id:'detailInfluence',label:'Influence',min:-1,max:1,step:.05,default:1,
     hint:'+1: detail = small matrix · 0: fixed · -1: inverted'},
    {id:'spread',label:'Spread',min:0,max:255,step:1,default:128},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    const minS = +p.minSize, maxS = +p.maxSize;
    // Pre-build all Bayer matrices we might need (powers of 2)
    const sizes = [];
    for (let s = minS; s <= maxS; s *= 2) sizes.push(s);
    if (sizes[sizes.length-1] !== maxS) sizes.push(maxS);
    const mats = {};
    for (const s of sizes) mats[s] = normBayer(s);
    const field = detailField(px, w, h, p.detailMode, p.detailRadius);
    const ang = p.rotation * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      let d = field[i]; // 0-1
      // Map detail to matrix size choice
      // detailInfluence > 0: high detail → small matrix
      const t = p.detailInfluence >= 0 ? 1 - d * p.detailInfluence : 1 + d * p.detailInfluence;
      const tt = Math.max(0, Math.min(1, t));
      // Pick a matrix size by linear interpolation across the size list, snap to nearest
      const idxF = tt * (sizes.length - 1);
      const idx = Math.round(idxF);
      const sz = sizes[idx];
      const mat = mats[sz];
      const rx = Math.round(x*ca + y*sa), ry = Math.round(-x*sa + y*ca);
      const bx = ((rx % sz) + sz) % sz, by = ((ry % sz) + sz) % sz;
      let v = clamp(px[i]); if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
      v += (mat[by][bx] - .5) * p.spread;
      const result = v > p.threshold ? 255 : 0;
      o[i] = p.invert ? 255 - result : result;
    }
    return o;
  }});

  // 2) Gradient-Aligned Halftone — screen angle follows local image
  // gradient. Dots along edges become coherent flowing rows instead of
  // a fixed grid. Region size lets you control coarse vs fine alignment.
  A.push({ id:'gradient-halftone', name:'Gradient-Aligned Halftone', category:'image-aware', params:[
    {id:'dotSize',label:'Dot Size',min:3,max:24,step:1,default:8},
    {id:'baseAngle',label:'Base Angle',min:0,max:180,step:1,default:45},
    {id:'gradInfluence',label:'Gradient Follow',min:0,max:1,step:.05,default:.7,
     hint:'0 = fixed angle, 1 = fully follow image gradient'},
    {id:'regionSize',label:'Sample Region',min:1,max:32,step:1,default:8,
     hint:'larger = smoother orientation, smaller = more local'},
    {id:'shape',label:'Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'square',label:'Square'},{value:'line',label:'Line'},
      {value:'cross',label:'Cross'},{value:'ellipse',label:'Ellipse'}
    ],default:'circle'},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.1},
    {id:'dotGain',label:'Dot Gain',min:.5,max:2.5,step:.05,default:1.42},
    {id:'edgeBoost',label:'Edge Boost',min:0,max:1,step:.05,default:0,
     hint:'enlarge dots near edges to outline detail'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h), ds = p.dotSize;
    const baseRad = p.baseAngle * Math.PI / 180;
    const { mag, ang } = regionGradients(px, w, h, p.regionSize);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      // Per-pixel screen angle: lerp between base angle and gradient-tangent angle
      const tangent = (ang[i] || 0) + Math.PI / 2;
      const a = baseRad * (1 - p.gradInfluence) + tangent * p.gradInfluence;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = x*ca + y*sa, ry = -x*sa + y*ca;
      const cx = ((rx % ds) + ds) % ds, cy = ((ry % ds) + ds) % ds;
      const nx = (cx/ds - .5) * 2, ny = (cy/ds - .5) * 2;
      let d;
      if (p.shape === 'diamond') d = Math.abs(nx) + Math.abs(ny);
      else if (p.shape === 'square') d = Math.max(Math.abs(nx), Math.abs(ny));
      else if (p.shape === 'line') d = Math.abs(ny);
      else if (p.shape === 'cross') d = Math.min(Math.abs(nx), Math.abs(ny));
      else if (p.shape === 'ellipse') d = Math.sqrt(nx*nx*1.5 + ny*ny*0.7);
      else d = Math.sqrt(nx*nx + ny*ny);
      let val = clamp(px[i]) / 255;
      if (p.gamma !== 1) val = Math.pow(val, p.gamma);
      const t = (1 - val) * p.dotGain * (1 + p.edgeBoost * mag[i]);
      let result;
      if (p.softness > 0) { const s2 = d - t; result = clamp(128 - s2/p.softness*128); }
      else result = d < t ? 255 : 0;
      o[i] = p.invert ? 255 - result : result;
    }
    return o;
  }});

  // 3) Tone-Zone Pattern — three different patterns blended by image tone.
  // Different look for shadows, midtones, and highlights with smooth bands.
  A.push({ id:'tone-zone-pattern', name:'Tone-Zone Pattern', category:'image-aware', params:[
    {id:'shadowPattern',label:'Shadows',type:'select',options:[
      {value:'bayer-2',label:'Bayer 2x2'},{value:'bayer-4',label:'Bayer 4x4'},
      {value:'bayer-8',label:'Bayer 8x8'},{value:'lines-h',label:'Lines H'},
      {value:'lines-v',label:'Lines V'},{value:'cross',label:'Cross-hatch'},
      {value:'dots',label:'Dots'},{value:'noise',label:'Noise'}
    ],default:'lines-h'},
    {id:'midPattern',label:'Midtones',type:'select',options:[
      {value:'bayer-2',label:'Bayer 2x2'},{value:'bayer-4',label:'Bayer 4x4'},
      {value:'bayer-8',label:'Bayer 8x8'},{value:'lines-h',label:'Lines H'},
      {value:'lines-v',label:'Lines V'},{value:'cross',label:'Cross-hatch'},
      {value:'dots',label:'Dots'},{value:'noise',label:'Noise'}
    ],default:'bayer-4'},
    {id:'highPattern',label:'Highlights',type:'select',options:[
      {value:'bayer-2',label:'Bayer 2x2'},{value:'bayer-4',label:'Bayer 4x4'},
      {value:'bayer-8',label:'Bayer 8x8'},{value:'lines-h',label:'Lines H'},
      {value:'lines-v',label:'Lines V'},{value:'cross',label:'Cross-hatch'},
      {value:'dots',label:'Dots'},{value:'noise',label:'Noise'}
    ],default:'dots'},
    {id:'shadowMid',label:'Shadow/Mid Split',min:30,max:120,step:1,default:80},
    {id:'midHigh',label:'Mid/High Split',min:130,max:230,step:1,default:175},
    {id:'feather',label:'Band Feather',min:1,max:60,step:1,default:25},
    {id:'patternScale',label:'Pattern Scale',min:1,max:8,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    const r = mkRand(p.seed);
    const noise = new Float32Array(w*h);
    for (let i = 0; i < w*h; i++) noise[i] = r();
    const bay2 = normBayer(2), bay4 = normBayer(4), bay8 = normBayer(8);
    const sc = p.patternScale;
    function patternThresh(name, x, y) {
      const xs = Math.floor(x / sc), ys = Math.floor(y / sc);
      switch (name) {
        case 'bayer-2': return bay2[ys%2][xs%2];
        case 'bayer-4': return bay4[ys%4][xs%4];
        case 'bayer-8': return bay8[ys%8][xs%8];
        case 'lines-h': return ((ys % 4) < 2) ? 0.3 : 0.7;
        case 'lines-v': return ((xs % 4) < 2) ? 0.3 : 0.7;
        case 'cross': {
          const a = (xs % 4) < 2, b = (ys % 4) < 2;
          return (a !== b) ? 0.35 : 0.65;
        }
        case 'dots': {
          const dx = (xs % 4) - 2, dy = (ys % 4) - 2;
          return Math.sqrt(dx*dx + dy*dy) / 3;
        }
        case 'noise': return noise[(y%h)*w + (x%w)];
        default: return 0.5;
      }
    }
    const sm = p.shadowMid, mh = p.midHigh, fe = p.feather;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      let v = clamp(px[i]);
      if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
      // Compute per-zone weights using soft transitions
      let wS = 0, wM = 0, wH = 0;
      if (v <= sm - fe) wS = 1;
      else if (v <= sm + fe) {
        const t = (v - (sm - fe)) / (fe * 2);
        wS = 1 - t; wM = t;
      } else if (v <= mh - fe) wM = 1;
      else if (v <= mh + fe) {
        const t = (v - (mh - fe)) / (fe * 2);
        wM = 1 - t; wH = t;
      } else wH = 1;
      // Blend pattern thresholds by zone weight
      const tS = patternThresh(p.shadowPattern, x, y);
      const tM = patternThresh(p.midPattern, x, y);
      const tH = patternThresh(p.highPattern, x, y);
      const blendT = (tS * wS + tM * wM + tH * wH) * 255;
      const result = v > blendT ? 255 : 0;
      o[i] = p.invert ? 255 - result : result;
    }
    return o;
  }});

  // 4) Flow Halftone — halftone "rows" curve to follow image gradient
  // streamlines instead of being a rigid grid. Creates intricate
  // contour-following dot patterns.
  A.push({ id:'flow-halftone', name:'Flow Halftone', category:'image-aware', params:[
    {id:'dotSize',label:'Dot Size',min:3,max:20,step:1,default:7},
    {id:'lineSpacing',label:'Row Spacing',min:3,max:24,step:1,default:8},
    {id:'flowStrength',label:'Flow Strength',min:0,max:1,step:.05,default:.7,
     hint:'0 = straight grid, 1 = fully curved'},
    {id:'regionSize',label:'Sample Region',min:2,max:32,step:1,default:10},
    {id:'shape',label:'Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'square',label:'Square'}
    ],default:'circle'},
    {id:'dotGain',label:'Dot Gain',min:.5,max:2.5,step:.05,default:1.4},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const ink = p.invert ? 255 : 0;
    const { ang } = regionGradients(px, w, h, p.regionSize);
    const ds = p.dotSize, sp = p.lineSpacing;
    // Build cumulative-warp coordinates: each pixel's "row" follows the
    // gradient field. We construct a warped Y coordinate by integrating
    // the perpendicular component of a unit-along-isophote direction.
    const warpY = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let acc = y;
      for (let x = 0; x < w; x++) {
        const i = y*w+x;
        // Tangent direction (perpendicular to gradient)
        const a = (ang[i] || 0) + Math.PI/2;
        // Warp Y coordinate by tangent's Y component scaled by flowStrength
        if (x > 0) acc += -Math.sin(a) * p.flowStrength;
        warpY[i] = acc;
      }
    }
    const warpX = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = x;
      for (let y = 0; y < h; y++) {
        const i = y*w+x;
        const a = (ang[i] || 0) + Math.PI/2;
        if (y > 0) acc += Math.cos(a) * p.flowStrength;
        warpX[i] = acc;
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      const wx = warpX[i], wy = warpY[i];
      const cellY = Math.floor(wy / sp);
      const localY = wy - cellY * sp; // 0..sp
      const cellX = Math.floor(wx / ds);
      const localX = wx - cellX * ds; // 0..ds
      // Map to dot-cell normalized coords (-1..1)
      const nx = (localX/ds - .5) * 2;
      const ny = (localY/sp - .5) * 2;
      let d;
      if (p.shape === 'diamond') d = Math.abs(nx) + Math.abs(ny);
      else if (p.shape === 'square') d = Math.max(Math.abs(nx), Math.abs(ny));
      else d = Math.sqrt(nx*nx + ny*ny);
      let val = clamp(px[i]) / 255;
      if (p.gamma !== 1) val = Math.pow(val, p.gamma);
      const t = (1 - val) * p.dotGain;
      let inside;
      if (p.softness > 0) { const s2 = d - t; inside = (128 - s2/p.softness*128) > 128; }
      else inside = d < t;
      if (inside) o[i] = ink;
    }
    return o;
  }});

  // 5) Hyper-Ordered — Bayer with per-pixel rotation set by gradient angle.
  // Pattern itself rotates to follow image features at every pixel.
  A.push({ id:'hyper-ordered', name:'Hyper-Ordered (Rotating Bayer)', category:'image-aware', params:[
    {id:'size',label:'Matrix',type:'select',options:[
      {value:4,label:'4x4'},{value:8,label:'8x8'},{value:16,label:'16x16'},{value:32,label:'32x32'}
    ],default:8},
    {id:'rotInfluence',label:'Rotation Follow',min:0,max:1,step:.05,default:.6,
     hint:'how much gradient rotates the pattern locally'},
    {id:'regionSize',label:'Region Size',min:2,max:32,step:1,default:6},
    {id:'spread',label:'Spread',min:0,max:255,step:1,default:128},
    {id:'edgePush',label:'Edge Threshold Bias',min:-1,max:1,step:.05,default:0,
     hint:'+: brighten edges. -: darken edges.'},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const sz = +p.size, mat = normBayer(sz), o = new Uint8ClampedArray(w*h);
    const { mag, ang } = regionGradients(px, w, h, p.regionSize);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      // Rotation angle follows local gradient (lerp from 0)
      const theta = (ang[i] || 0) * p.rotInfluence;
      const ca = Math.cos(theta), sa = Math.sin(theta);
      const rx = Math.round(x*ca + y*sa), ry = Math.round(-x*sa + y*ca);
      const bx = ((rx % sz) + sz) % sz, by = ((ry % sz) + sz) % sz;
      let v = clamp(px[i]); if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
      v += (mat[by][bx] - .5) * p.spread;
      const thr = p.threshold - p.edgePush * 80 * mag[i];
      const result = v > thr ? 255 : 0;
      o[i] = p.invert ? 255 - result : result;
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // SCENE UNDERSTANDING
  // Approximates global scene properties an artist would read first:
  // where the light is coming from, mean tone, contrast, edge density,
  // and tone-zone histogram peaks. Used by every "scene-aware" algo
  // below so they can make artistic decisions, not just local ones.
  // ═══════════════════════════════════════════
  function analyzeScene(px, w, h) {
    const n = w * h;
    // Pass 1: weighted bright/dark centroids + sums
    let bX = 0, bY = 0, bW = 0;
    let dX = 0, dY = 0, dW = 0;
    let sum = 0, sumSq = 0;
    let pBright = 0, pMid = 0, pDark = 0;
    // Sample-stride for big images (cap at ~150k samples)
    const stride = Math.max(1, Math.floor(Math.sqrt(n / 150000)));
    for (let y = 0; y < h; y += stride) for (let x = 0; x < w; x += stride) {
      const v = clamp(px[y*w+x]);
      const ln = v / 255;
      sum += ln; sumSq += ln * ln;
      if (ln > 0.5) { const wt = (ln - 0.5) * 2; bX += x*wt; bY += y*wt; bW += wt; pBright++; }
      if (ln < 0.5) { const wt = (0.5 - ln) * 2; dX += x*wt; dY += y*wt; dW += wt; pDark++; }
      if (ln >= 0.4 && ln <= 0.6) pMid++;
    }
    const samples = Math.ceil(w/stride) * Math.ceil(h/stride);
    const meanLum = sum / samples;
    const variance = sumSq / samples - meanLum * meanLum;
    const contrast = Math.min(1, Math.sqrt(Math.max(0, variance)) * 2);
    let lightX = 0, lightY = 0, lightStrength = 0;
    if (bW > 0 && dW > 0) {
      const bcx = bX / bW, bcy = bY / bW;
      const dcx = dX / dW, dcy = dY / dW;
      const vx = bcx - dcx, vy = bcy - dcy;
      const m = Math.sqrt(vx*vx + vy*vy) || 1;
      lightX = vx / m; lightY = vy / m;
      // Strength: how separated bright vs dark are, normalized to image diagonal
      const diag = Math.sqrt(w*w + h*h);
      lightStrength = Math.min(1, m / (diag * 0.5));
    }
    // Pass 2: edge density (cheap sample on a coarse grid)
    let edgeAcc = 0, edgeN = 0;
    const eStride = Math.max(2, stride);
    for (let y = 1; y < h - 1; y += eStride) for (let x = 1; x < w - 1; x += eStride) {
      edgeAcc += sobelAt(px, x, y, w, h).mag; edgeN++;
    }
    const maxPossibleEdge = 1020; // 4*255 typical sobel ceiling
    const edgeDensity = Math.min(1, (edgeAcc / Math.max(1, edgeN)) / maxPossibleEdge * 4);
    return {
      lightX, lightY, lightStrength,
      meanLum, contrast, edgeDensity,
      brightFrac: pBright / samples,
      midFrac: pMid / samples,
      darkFrac: pDark / samples,
      // Suggested artistic stroke angle: perpendicular to light direction
      hatchAngle: Math.atan2(lightY, lightX) + Math.PI / 2
    };
  }

  // ═══════════════════════════════════════════
  // SCENE-AWARE PATTERNS (3 advanced + 3 ASCII)
  // ═══════════════════════════════════════════

  // 6) Adaptive Bayer Pro — every dot's shape, size, color, edge, and
  // anisotropy is steered by image content + global scene understanding.
  A.push({ id:'adaptive-bayer-pro', name:'Adaptive Bayer Pro', category:'image-aware', params:[
    {id:'matrixSize',label:'Matrix',type:'select',options:[
      {value:4,label:'4x4'},{value:8,label:'8x8'},{value:16,label:'16x16'}
    ],default:8},
    {id:'cellSize',label:'Cell Size',min:2,max:32,step:1,default:6,
     hint:'physical pixel size of each dot cell'},
    {id:'sizeByDetail',label:'Size · Detail',min:-1,max:1,step:.05,default:.6,
     hint:'+: shrink in detail, -: grow in detail'},
    {id:'sizeByTone',label:'Size · Tone',min:-1,max:1,step:.05,default:.5,
     hint:'+: bigger in shadows, -: bigger in highlights'},
    {id:'shape',label:'Base Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'square',label:'Square'},{value:'cross',label:'Cross'},{value:'star',label:'Star'}
    ],default:'circle'},
    {id:'shapeByZone',label:'Shape · Zone',min:0,max:1,step:.05,default:.5,
     hint:'shape morphs across tone zones (shadow/mid/highlight)'},
    {id:'edgeHalo',label:'Edge Halo',min:0,max:1,step:.05,default:.4,
     hint:'soften dot edges near image edges'},
    {id:'anisotropy',label:'Light Trails',min:0,max:1,step:.05,default:.3,
     hint:'elongate dots toward scene light direction'},
    {id:'modulation',label:'Modulation',min:0,max:1,step:.05,default:0,
     hint:'sine-wave threshold for stripe interference'},
    {id:'modFreq',label:'Mod Frequency',min:.01,max:.5,step:.01,default:.1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const ink = p.invert ? 255 : 0;
    const matSize = +p.matrixSize, mat = normBayer(matSize);
    const scene = analyzeScene(px, w, h);
    const { mag } = gradientFields(px, w, h);
    const cs = p.cellSize;
    // Light-trail orientation: anisotropy stretches along scene light dir
    const lightAng = Math.atan2(scene.lightY, scene.lightX);
    const aniCos = Math.cos(lightAng), aniSin = Math.sin(lightAng);
    function shapeDist(name, nx, ny) {
      switch (name) {
        case 'diamond': return Math.abs(nx) + Math.abs(ny);
        case 'square':  return Math.max(Math.abs(nx), Math.abs(ny));
        case 'cross':   return Math.min(Math.abs(nx), Math.abs(ny)) * 2;
        case 'star': {
          const r2 = Math.sqrt(nx*nx + ny*ny);
          const a = Math.atan2(ny, nx);
          return r2 * (1 + 0.5 * Math.cos(5 * a));
        }
        default: return Math.sqrt(nx*nx + ny*ny);
      }
    }
    // Cell-grid loop: each cell renders a dot whose properties are scene/local-aware
    for (let cy = 0; cy < h; cy += cs) for (let cx = 0; cx < w; cx += cs) {
      const midX = Math.min(w-1, cx + (cs >> 1));
      const midY = Math.min(h-1, cy + (cs >> 1));
      const i = midY * w + midX;
      // Per-cell tone, detail
      let v = clamp(px[i]) / 255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      const detail = mag[i]; // 0-1
      // Bayer threshold offset for this cell
      const bx = ((cx / cs) | 0) % matSize, by = ((cy / cs) | 0) % matSize;
      const bayerT = mat[by][bx];
      // Modulated threshold
      const mod = p.modulation > 0
        ? Math.sin((cx + cy) * p.modFreq) * 0.5 * p.modulation : 0;
      // Per-cell dot radius driven by tone + detail
      const toneR = (1 - v) * (1 + p.sizeByTone * (1 - v));
      const detailMul = p.sizeByDetail >= 0
        ? 1 - detail * p.sizeByDetail
        : 1 + detail * (-p.sizeByDetail);
      const radius = Math.max(0, Math.min(1, (toneR * detailMul + mod) * 1.2));
      // Skip empty highlights
      if (radius < bayerT - 0.4) continue;
      // Shape morph: blend distance metrics across zones
      const shapeIdx = ['circle','diamond','square','cross','star'].indexOf(p.shape);
      const shapeOptions = ['circle','diamond','square','cross','star'];
      let chosenShape = p.shape;
      if (p.shapeByZone > 0) {
        // Shadow → cross/star, mid → diamond/square, highlight → circle
        let zoneShape;
        if (v < 0.33) zoneShape = 'star';
        else if (v < 0.66) zoneShape = 'diamond';
        else zoneShape = 'circle';
        // Probabilistic mix using bayerT as the dither (deterministic per cell)
        chosenShape = bayerT < p.shapeByZone ? zoneShape : p.shape;
      }
      // Edge halo: soften near edges by widening fall-off
      const halo = p.edgeHalo * detail;
      // Render dot inside cell with anisotropy along scene light
      const ani = p.anisotropy * scene.lightStrength;
      for (let dy = 0; dy < cs && cy + dy < h; dy++) {
        for (let dx = 0; dx < cs && cx + dx < w; dx++) {
          const nx0 = (dx + 0.5) / cs * 2 - 1;
          const ny0 = (dy + 0.5) / cs * 2 - 1;
          // Anisotropic transform: stretch along light direction
          let nx = nx0, ny = ny0;
          if (ani > 0) {
            // Rotate into light frame, scale, rotate back
            const u = nx*aniCos + ny*aniSin;
            const t = -nx*aniSin + ny*aniCos;
            const stretch = 1 + ani * 1.2;
            nx = (u/stretch) * aniCos - t * aniSin;
            ny = (u/stretch) * aniSin + t * aniCos;
          }
          const d = shapeDist(chosenShape, nx, ny);
          const insideR = radius;
          const fx = cx + dx, fy = cy + dy;
          const ii = fy*w + fx;
          if (halo > 0) {
            // Smooth falloff from 1 inside to 0 at radius+halo
            const t = (insideR - d) / Math.max(0.0001, halo);
            const a = Math.max(0, Math.min(1, t));
            o[ii] = Math.round(o[ii] * (1 - a) + ink * a);
          } else {
            if (d < insideR) o[ii] = ink;
          }
        }
      }
    }
    return o;
  }});

  // 7) Light-Aware Cross-Hatch — strokes drawn perpendicular to estimated
  // scene light direction (the way a hatching artist would). Adds cross
  // strokes in shadow zones, light strokes in highlights.
  A.push({ id:'light-hatch', name:'Light-Aware Cross-Hatch', category:'image-aware', params:[
    {id:'spacing',label:'Stroke Spacing',min:2,max:20,step:1,default:5},
    {id:'length',label:'Stroke Length',min:3,max:30,step:1,default:8},
    {id:'thickness',label:'Thickness',min:1,max:3,step:1,default:1},
    {id:'crossThreshold',label:'Cross Threshold',min:0,max:1,step:.05,default:.5,
     hint:'darkness above which cross-hatching kicks in'},
    {id:'crossAngle',label:'Cross Angle',min:30,max:90,step:5,default:60,
     hint:'degrees offset for the second hatch direction'},
    {id:'lightOverride',label:'Light Direction',min:-180,max:180,step:5,default:0,
     hint:'manual override: 0 uses scene-detected light'},
    {id:'sketchiness',label:'Sketchiness',min:0,max:1,step:.05,default:.2,
     hint:'wobble + breaks for hand-drawn feel'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const ink = p.invert ? 255 : 0;
    const r = mkRand(p.seed);
    const scene = analyzeScene(px, w, h);
    // Use scene hatch angle (perpendicular to light) unless overridden
    const baseAng = p.lightOverride !== 0
      ? p.lightOverride * Math.PI / 180
      : scene.hatchAngle;
    const cross1A = baseAng;
    const cross2A = baseAng + p.crossAngle * Math.PI / 180;
    const sp = p.spacing, lenBase = p.length;
    function drawStroke(cx, cy, dirAng, density) {
      const dx = Math.cos(dirAng), dy = Math.sin(dirAng);
      const len = lenBase * density;
      const wob = p.sketchiness * 1.5;
      // Optional break in middle for sketchiness
      const breakAt = p.sketchiness > 0.5 ? (r() < (p.sketchiness - 0.5) * 2 ? r() * len : -1) : -1;
      for (let t = -len/2; t <= len/2; t += 0.5) {
        if (breakAt > 0 && Math.abs(t - (breakAt - len/2)) < 0.6) continue;
        const wx = wob > 0 ? Math.sin(t * 0.4) * wob : 0;
        const sx = Math.round(cx + t * dx + (-dy) * wx);
        const sy = Math.round(cy + t * dy + dx * wx);
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        for (let dty = -Math.floor(p.thickness/2); dty <= Math.floor(p.thickness/2); dty++)
          for (let dtx = -Math.floor(p.thickness/2); dtx <= Math.floor(p.thickness/2); dtx++) {
            const fx = sx + dtx, fy = sy + dty;
            if (fx >= 0 && fx < w && fy >= 0 && fy < h) o[fy*w+fx] = ink;
          }
      }
    }
    for (let y = 0; y < h; y += sp) for (let x = 0; x < w; x += sp) {
      let v = clamp(px[y*w+x]) / 255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      const darkness = 1 - v;
      if (darkness < 0.05) continue;
      // Layer 1: always present, density scales with darkness
      drawStroke(x, y, cross1A, Math.min(1, darkness * 1.2));
      // Layer 2: cross-hatch only in zones above crossThreshold
      if (darkness > p.crossThreshold) {
        const d2 = (darkness - p.crossThreshold) / Math.max(0.05, 1 - p.crossThreshold);
        drawStroke(x, y, cross2A, d2);
      }
    }
    return o;
  }});

  // 8) Scene-Aware Halftone — combines tone-zone shape switching, edge
  // proximity sizing, light-driven anisotropy, and global scene contrast
  // adjustment in one image-aware halftone.
  A.push({ id:'scene-halftone', name:'Scene-Aware Halftone', category:'image-aware', params:[
    {id:'dotSize',label:'Cell Size',min:3,max:24,step:1,default:8},
    {id:'shadowShape',label:'Shadow Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'cross',label:'Cross'},{value:'star',label:'Star'},{value:'square',label:'Square'}
    ],default:'star'},
    {id:'midShape',label:'Mid Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'cross',label:'Cross'},{value:'star',label:'Star'},{value:'square',label:'Square'}
    ],default:'diamond'},
    {id:'highlightShape',label:'Highlight Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'cross',label:'Cross'},{value:'star',label:'Star'},{value:'square',label:'Square'}
    ],default:'circle'},
    {id:'lightTrails',label:'Light Trails',min:0,max:1,step:.05,default:.4,
     hint:'dots stretch along detected light direction'},
    {id:'edgeBoost',label:'Edge Boost',min:0,max:1.5,step:.05,default:.6},
    {id:'autoContrast',label:'Auto Contrast',min:0,max:1,step:.05,default:.7,
     hint:'use scene contrast to auto-tune dot gain'},
    {id:'angle',label:'Base Angle',min:0,max:90,step:1,default:45},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const ink = p.invert ? 255 : 0;
    const ds = p.dotSize;
    const scene = analyzeScene(px, w, h);
    const { mag } = gradientFields(px, w, h);
    // Auto-tune dot gain by scene contrast (high-contrast scene → less gain)
    const dotGain = (1.4 + (1 - scene.contrast) * 0.6) * (1 - p.autoContrast)
                  + 1.4 * p.autoContrast * (1 + (1 - scene.contrast) * 0.4);
    const ang = p.angle * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    const lightAng = Math.atan2(scene.lightY, scene.lightX);
    const lc = Math.cos(lightAng), ls = Math.sin(lightAng);
    function dist(name, nx, ny) {
      switch (name) {
        case 'diamond': return Math.abs(nx) + Math.abs(ny);
        case 'square':  return Math.max(Math.abs(nx), Math.abs(ny));
        case 'cross':   return Math.min(Math.abs(nx), Math.abs(ny)) * 2;
        case 'star': {
          const r2 = Math.sqrt(nx*nx + ny*ny), a = Math.atan2(ny, nx);
          return r2 * (1 + 0.4 * Math.cos(5 * a));
        }
        default: return Math.sqrt(nx*nx + ny*ny);
      }
    }
    const ani = p.lightTrails * scene.lightStrength;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      let val = clamp(px[i]) / 255;
      if (p.gamma !== 1) val = Math.pow(val, p.gamma);
      // Shape selection by tone zone
      const shape = val < 0.33 ? p.shadowShape : (val < 0.66 ? p.midShape : p.highlightShape);
      // Cell coords with rotation
      const rx = x*ca + y*sa, ry = -x*sa + y*ca;
      const cx = ((rx % ds) + ds) % ds, cy = ((ry % ds) + ds) % ds;
      let nx = (cx/ds - .5) * 2, ny = (cy/ds - .5) * 2;
      if (ani > 0) {
        const u = nx*lc + ny*ls;
        const t = -nx*ls + ny*lc;
        const stretch = 1 + ani * 1.5;
        nx = (u/stretch) * lc - t * ls;
        ny = (u/stretch) * ls + t * lc;
      }
      const d = dist(shape, nx, ny);
      const t = (1 - val) * dotGain * (1 + p.edgeBoost * mag[i]);
      if (d < t) o[i] = ink;
    }
    return o;
  }});

  // ─────────────────────────────────────────────
  // SCENE-AWARE ASCII (3)
  // ─────────────────────────────────────────────

  // 9) ASCII Light-Aware — character density falls off with distance
  // from the scene's lit centroid, like a sketched chiaroscuro.
  A.push({ id:'ascii-light', name:'ASCII Light-Aware', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'charset',label:'Character Set',type:'select',options:charsetOptions,default:'standard'},
    {id:'lightFalloff',label:'Light Falloff',min:0,max:1,step:.05,default:.5,
     hint:'how strongly distance from lit centroid darkens characters'},
    {id:'shadowDepth',label:'Shadow Depth',min:0,max:1,step:.05,default:.3,
     hint:'extra darkness for cells far from light'},
    {id:'invertLight',label:'Invert Light',type:'checkbox',default:false},
    {id:'fontScale',label:'Font Scale',min:.5,max:1.5,step:.05,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'inkDark',label:'Ink Dark',min:0,max:255,step:1,default:0},
    {id:'inkLight',label:'Ink Light',min:0,max:255,step:1,default:255}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h); o.fill(p.inkLight);
    const ramp = asciiRamp(p.charset);
    const cs = p.cellSize;
    const g = getGlyphs(ramp, cs, cs, p.fontScale);
    const scene = analyzeScene(px, w, h);
    // Lit centroid in image coords (recompute from scene light direction
    // by stepping from center along light vec)
    const cx = w / 2, cy = h / 2;
    const litX = cx + scene.lightX * w * 0.4;
    const litY = cy + scene.lightY * h * 0.4;
    const maxDist = Math.sqrt(w*w + h*h) / 2;
    for (let y = 0; y < h; y += cs) for (let x = 0; x < w; x += cs) {
      const stats = cellStats(px, x, y, cs, cs, w, h);
      let v = stats.avg / 255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      // Distance to lit centroid → 0 (at center) to 1 (corners)
      const dx = (x + cs/2) - litX, dy = (y + cs/2) - litY;
      const distNorm = Math.min(1, Math.sqrt(dx*dx + dy*dy) / maxDist);
      const litFactor = p.invertLight ? distNorm : (1 - distNorm);
      // Lit areas → lighter chars (lower coverage), shadow → darker chars
      const adjusted = v * (1 - p.lightFalloff) + litFactor * p.lightFalloff;
      const finalCov = Math.max(0, Math.min(1, 1 - adjusted - (1 - litFactor) * p.shadowDepth));
      const idx = pickGlyphIdx(g.sortedCoverages, finalCov);
      stampGlyph(o, g.sortedGlyphs[idx], x, y, cs, cs, w, h, p.inkDark, p.inkLight);
    }
    return o;
  }});

  // 10) ASCII Edge-Following — picks a glyph that matches the local edge
  // orientation. Horizontal edges → "─", vertical → "│", diagonals → "/" "\".
  A.push({ id:'ascii-edge-flow', name:'ASCII Edge-Following', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'edgeThreshold',label:'Edge Threshold',min:5,max:200,step:5,default:60,
     hint:'Sobel magnitude above which directional chars take over'},
    {id:'fillCharset',label:'Fill Charset',type:'select',options:charsetOptions,default:'standard'},
    {id:'edgeStyle',label:'Edge Glyphs',type:'select',options:[
      {value:'box-light',label:'Light Lines  ─│┌┐'},
      {value:'box-heavy',label:'Heavy Lines  ═║╔╗'},
      {value:'slashes',label:'Slashes  /\\|─'},
      {value:'arrows',label:'Arrows  ←↑→↓'}
    ],default:'box-light'},
    {id:'fontScale',label:'Font Scale',min:.5,max:1.5,step:.05,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'inkDark',label:'Ink Dark',min:0,max:255,step:1,default:0},
    {id:'inkLight',label:'Ink Light',min:0,max:255,step:1,default:255}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h); o.fill(p.inkLight);
    const cs = p.cellSize;
    const fillRamp = asciiRamp(p.fillCharset);
    const fillG = getGlyphs(fillRamp, cs, cs, p.fontScale);
    // Build a directional glyph palette: horiz, vert, diag↘, diag↗
    const dirs = {
      'box-light':  ['─', '│', '╲', '╱', '┼'],
      'box-heavy':  ['═', '║', '╲', '╱', '╬'],
      'slashes':    ['─', '|', '\\', '/', 'X'],
      'arrows':     ['→', '↑', '↘', '↗', '+']
    };
    const charSet = dirs[p.edgeStyle] || dirs['box-light'];
    const dirGlyphs = charSet.map(c => getGlyphs(c, cs, cs, p.fontScale).glyphs[0]);
    for (let y = 0; y < h; y += cs) for (let x = 0; x < w; x += cs) {
      const stats = cellStats(px, x, y, cs, cs, w, h);
      let v = stats.avg / 255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      if (stats.edgeMag > p.edgeThreshold) {
        // Pick directional glyph based on angle (4 buckets + cross)
        // Sobel angle: 0 = →, π/2 = ↓, π = ←
        let a = stats.edgeAng;
        // Wrap to 0..π (orientation, not direction)
        while (a < 0) a += Math.PI;
        while (a >= Math.PI) a -= Math.PI;
        // Edge orientation perpendicular to gradient: line direction = a + π/2
        const lineA = (a + Math.PI / 2) % Math.PI;
        let idx;
        if      (lineA < Math.PI * 0.125 || lineA >= Math.PI * 0.875) idx = 0; // horizontal
        else if (lineA < Math.PI * 0.375) idx = 3;                              // ↗
        else if (lineA < Math.PI * 0.625) idx = 1;                              // vertical
        else                                  idx = 2;                              // ↘
        // High-contrast cells use the "cross" cell
        if (stats.contrast > 200) idx = 4;
        stampGlyph(o, dirGlyphs[idx], x, y, cs, cs, w, h, p.inkDark, p.inkLight);
      } else {
        const cov = 1 - v;
        const gi = pickGlyphIdx(fillG.sortedCoverages, cov);
        stampGlyph(o, fillG.sortedGlyphs[gi], x, y, cs, cs, w, h, p.inkDark, p.inkLight);
      }
    }
    return o;
  }});

  // 11) ASCII Tone-Zone — separate character sets for shadows / midtones /
  // highlights, with feathered transitions. Good for layered graphic looks.
  A.push({ id:'ascii-tone-zone', name:'ASCII Tone-Zone', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'shadowSet',label:'Shadow Charset',type:'select',options:charsetOptions,default:'blocks'},
    {id:'midSet',label:'Mid Charset',type:'select',options:charsetOptions,default:'standard'},
    {id:'highSet',label:'Highlight Charset',type:'select',options:charsetOptions,default:'dots'},
    {id:'shadowMid',label:'Shadow/Mid Split',min:.05,max:.5,step:.05,default:.33},
    {id:'midHigh',label:'Mid/Highlight Split',min:.5,max:.95,step:.05,default:.66},
    {id:'feather',label:'Feather',min:0,max:.3,step:.01,default:.08},
    {id:'fontScale',label:'Font Scale',min:.5,max:1.5,step:.05,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'inkDark',label:'Ink Dark',min:0,max:255,step:1,default:0},
    {id:'inkLight',label:'Ink Light',min:0,max:255,step:1,default:255},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h); o.fill(p.inkLight);
    const cs = p.cellSize;
    const shG = getGlyphs(asciiRamp(p.shadowSet), cs, cs, p.fontScale);
    const mdG = getGlyphs(asciiRamp(p.midSet),    cs, cs, p.fontScale);
    const hiG = getGlyphs(asciiRamp(p.highSet),   cs, cs, p.fontScale);
    const r = mkRand(p.seed);
    for (let y = 0; y < h; y += cs) for (let x = 0; x < w; x += cs) {
      const stats = cellStats(px, x, y, cs, cs, w, h);
      let v = stats.avg / 255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      // Determine zone weights with feathered transitions
      const sm = p.shadowMid, mh = p.midHigh, fe = p.feather;
      let wS = 0, wM = 0, wH = 0;
      if (v <= sm - fe) wS = 1;
      else if (v <= sm + fe) { const t = (v - (sm - fe)) / (fe * 2); wS = 1 - t; wM = t; }
      else if (v <= mh - fe) wM = 1;
      else if (v <= mh + fe) { const t = (v - (mh - fe)) / (fe * 2); wM = 1 - t; wH = t; }
      else wH = 1;
      // Probabilistic zone pick using cell-level rand for crisp boundaries
      const pick = r();
      let zoneG;
      if (pick < wS) zoneG = shG;
      else if (pick < wS + wM) zoneG = mdG;
      else zoneG = hiG;
      const cov = 1 - v;
      const gi = pickGlyphIdx(zoneG.sortedCoverages, cov);
      stampGlyph(o, zoneG.sortedGlyphs[gi], x, y, cs, cs, w, h, p.inkDark, p.inkLight);
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // ASCII BINARY — 0s and 1s only, dithered
  // ═══════════════════════════════════════════
  // Each cell becomes either '0' or '1' based on local brightness. Uses a
  // Bayer matrix for controlled patterning (not random) so you can dial
  // between hard threshold (posterized) and heavily dithered "Matrix"
  // printouts. Optional edge-bias picks '1' (denser glyph) on strong edges
  // to preserve silhouettes.
  A.push({ id:'ascii-binary', name:'ASCII Binary 01', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'bayer',label:'Bayer Size',type:'select',options:[
      {value:0,label:'None (hard)'},{value:2,label:'2×2'},
      {value:4,label:'4×4'},{value:8,label:'8×8'},{value:16,label:'16×16'}
    ],default:4},
    {id:'spread',label:'Dither Spread',min:0,max:255,step:1,default:128},
    {id:'edgeBias',label:'Edge Bias',min:0,max:2,step:.05,default:.6},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'inkDark',label:'Ink Dark',min:0,max:255,step:1,default:0},
    {id:'inkLight',label:'Ink Light',min:0,max:255,step:1,default:255},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h); o.fill(p.inkLight);
    const cs = p.cellSize;
    // Build glyph bitmaps for '0' and '1' at the chosen cell size/scale
    const gSet = getGlyphs(' 01', cs, cs, p.fontScale);
    // Indices: 0 = space, 1 = '0', 2 = '1' (in input order; gSet.glyphs preserves order)
    const gZero = gSet.glyphs[1];
    const gOne = gSet.glyphs[2];
    const bSize = +p.bayer;
    const b = bSize > 0 ? normBayer(bSize) : null;
    for (let y = 0; y < h; y += cs) {
      for (let x = 0; x < w; x += cs) {
        const stats = cellStats(px, x, y, cs, cs, w, h);
        let v = stats.avg;
        if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
        if (b) {
          const by = ((y/cs)|0) % bSize, bx = ((x/cs)|0) % bSize;
          v += (b[by][bx] - 0.5) * p.spread;
        }
        // Edge pixels bias toward '1' (denser glyph) so silhouettes pop
        if (p.edgeBias > 0 && stats.edgeMag > 25) {
          v -= stats.edgeMag * p.edgeBias * 0.4;
        }
        let isOne = v < p.threshold;
        if (p.invert) isOne = !isOne;
        const gl = isOne ? gOne : gZero;
        stampGlyph(o, gl, x, y, cs, cs, w, h, p.inkDark, p.inkLight);
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // ASCII PRO — ultimate image-aware ASCII
  // ═══════════════════════════════════════════
  // Combines ALL charsets (rare math/stars/arrows/currency glyphs included)
  // into one huge coverage-sorted ramp, then picks the best glyph per cell
  // by BOTH coverage AND edge direction. When a cell has a strong gradient,
  // we prefer an orientation-matching glyph (|, /, ─, \) regardless of
  // coverage — this preserves structure like hair strands, skylines, wires.
  // A blue-noise jitter lets the same brightness level pick different
  // "synonymous" glyphs in adjacent cells so flat regions don't repeat.
  A.push({ id:'ascii-pro', name:'ASCII Pro', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'charPool',label:'Character Pool',type:'select',options:[
      {value:'ultra',label:'Ultra (all sets + rare)'},
      {value:'wide',label:'Wide (letters + symbols)'},
      {value:'structural',label:'Structural (box + slashes)'},
      {value:'celestial',label:'Celestial (stars + math)'}
    ],default:'ultra'},
    {id:'edgeAware',label:'Edge Awareness',min:0,max:1,step:.05,default:.7},
    {id:'edgeThreshold',label:'Edge Threshold',min:5,max:200,step:5,default:40},
    {id:'contrastBoost',label:'Contrast Boost',min:0,max:2,step:.05,default:.5},
    {id:'shadowDetail',label:'Shadow Detail',min:0,max:2,step:.1,default:1.2},
    {id:'highlightDetail',label:'Highlight Detail',min:0,max:2,step:.1,default:0.8},
    {id:'jitter',label:'Synonym Jitter',min:0,max:1,step:.05,default:.25},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'inkDark',label:'Ink Dark',min:0,max:255,step:1,default:0},
    {id:'inkLight',label:'Ink Light',min:0,max:255,step:1,default:255},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h); o.fill(p.inkLight);
    const cs = p.cellSize;

    // Build the combined character pool. We also tag each character by
    // whether it's orientation-biased (which axis it "leans" toward).
    const pools = {
      ultra:      ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$·•●○◦◎◉⊙⊚░▒▓█┄┈╌─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬±×÷≈≠≤≥∞∑∏∫√∂∆Ω✦✧★☆✪✫✬✭✮✯◊◇◆△▲▽▼□■',
      wide:       ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
      structural: ' ·─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬/\\|—┄┈╌╍_=-',
      celestial:  ' ·✦✧★☆✪✫✬✭✮✯±×÷≈≠≤≥∞∑∏∫√∂∆Ω◊◇◆'
    };
    const rampStr = pools[p.charPool] || pools.ultra;
    const gSet = getGlyphs(rampStr, cs, cs, p.fontScale);

    // Tag orientation for each character: 0=none, 1=vertical, 2=horizontal,
    // 3=diag-down-right (/), 4=diag-down-left (\). Checked against input-order
    // character list, then mapped through sortIdx below.
    const chars = [...rampStr];
    const inputOri = chars.map(c => {
      if ('|│║┃╎╏╽╿⎸⎹'.includes(c)) return 1;
      if ('─━═╌╍━┄┈_-—–'.includes(c)) return 2;
      if ('/╱⁄'.includes(c)) return 3;
      if ('\\╲'.includes(c)) return 4;
      return 0;
    });
    // sortedOri[i] = orientation of the i-th glyph in sortedGlyphs
    const sortedOri = gSet.sortIdx.map(i => inputOri[i]);
    const sortedGlyphs = gSet.sortedGlyphs, sortedCov = gSet.sortedCoverages;

    // For edge-aware picks: partition sorted-index ranges by orientation
    // so we can quickly find an oriented glyph with ~target coverage.
    function pickOriented(targetCov, ori) {
      // Find nearest sorted index matching that orientation
      let best = -1, bestD = Infinity;
      for (let i = 0; i < sortedOri.length; i++) {
        if (sortedOri[i] !== ori) continue;
        const d = Math.abs(sortedCov[i] - targetCov);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    const rnd = mkRand(p.seed);

    for (let y = 0; y < h; y += cs) {
      for (let x = 0; x < w; x += cs) {
        const stats = cellStats(px, x, y, cs, cs, w, h);
        let vN = stats.avg / 255;
        if (p.gamma !== 1) vN = Math.pow(vN, p.gamma);

        // Contrast boost near zone boundaries
        if (p.contrastBoost > 0) {
          const mid = 0.5;
          vN = mid + (vN - mid) * (1 + p.contrastBoost);
          vN = Math.max(0, Math.min(1, vN));
        }
        // Zone-specific detail weighting
        if (vN < 0.4 && p.shadowDetail !== 1) {
          // Dark: push toward darker glyphs as shadowDetail rises
          vN = Math.max(0, vN * (1 / Math.max(0.1, p.shadowDetail)));
        } else if (vN > 0.6 && p.highlightDetail !== 1) {
          // Bright: push toward lighter glyphs when highlightDetail < 1
          vN = 1 - (1 - vN) * (1 / Math.max(0.1, p.highlightDetail));
        }
        if (p.invert) vN = 1 - vN;

        // Target coverage = darkness
        let targetCov = 1 - vN;

        // Edge-aware glyph override: if gradient is strong enough, try to
        // pick an orientation-aligned glyph with similar coverage.
        let glyphIdx = -1;
        if (p.edgeAware > 0 && stats.edgeMag > p.edgeThreshold) {
          const ang = stats.edgeAng;
          const deg = (ang * 180 / Math.PI + 360) % 180;
          // Gradient direction is perpendicular to the edge line itself, so
          // map gradient angle to the best matching stroke orientation.
          let ori;
          if (deg < 22.5 || deg >= 157.5) ori = 1;       // gradient ~horizontal → vertical stroke
          else if (deg < 67.5) ori = 3;                   // diag-down-right stroke
          else if (deg < 112.5) ori = 2;                  // horizontal stroke
          else ori = 4;                                   // diag-down-left
          const oi = pickOriented(targetCov, ori);
          if (oi >= 0) {
            // Mix between plain coverage pick and oriented pick
            const purePick = pickGlyphIdx(sortedCov, targetCov);
            const mix = Math.min(1, (stats.edgeMag - p.edgeThreshold) / 80 * p.edgeAware);
            glyphIdx = rnd() < mix ? oi : purePick;
          }
        }
        if (glyphIdx < 0) {
          glyphIdx = pickGlyphIdx(sortedCov, targetCov);
          // Synonym jitter: in flat areas pick a neighboring glyph with
          // near-identical coverage to break up repetition
          if (p.jitter > 0 && stats.contrast < 25) {
            const j = Math.round((rnd() - 0.5) * p.jitter * 6);
            glyphIdx = Math.max(0, Math.min(sortedGlyphs.length - 1, glyphIdx + j));
          }
        }
        stampGlyph(o, sortedGlyphs[glyphIdx], x, y, cs, cs, w, h, p.inkDark, p.inkLight);
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // BRAILLE ADVANCED — image-aware variable block sizes
  // ═══════════════════════════════════════════
  // Unlike the basic Braille Render (uniform cellW=2*ds × cellH=4*ds grid),
  // this one picks per-region BLOCK SIZE based on local image complexity:
  //   • High edge magnitude → small blocks (preserve detail)
  //   • High contrast      → small-to-medium blocks
  //   • Low contrast flat  → large blocks (abstract/stylized)
  //   • Shadow vs highlight → different dot-density bias
  // Blocks are placed via a greedy quad-tree style pass: start with coarse
  // blocks and subdivide any that exceed a complexity threshold.
  A.push({ id:'ascii-braille-pro', name:'Braille Advanced (Image-Aware)', category:'ascii', params:[
    {id:'minDot',label:'Min Dot Size',min:1,max:4,step:1,default:2},
    {id:'maxDot',label:'Max Dot Size',min:2,max:8,step:1,default:5},
    {id:'edgeSensitivity',label:'Edge Sensitivity',min:0,max:2,step:.05,default:1},
    {id:'contrastSensitivity',label:'Contrast Sensitivity',min:0,max:2,step:.05,default:.8},
    {id:'shadowBias',label:'Shadow Dot Bias',min:-1,max:1,step:.05,default:.2},
    {id:'highlightBias',label:'Highlight Dot Bias',min:-1,max:1,step:.05,default:-.2},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'adaptiveThreshold',label:'Adaptive Threshold',min:0,max:1,step:.05,default:.4},
    {id:'opArtMoire',label:'Op-Art Moiré',min:0,max:1,step:.05,default:0},
    {id:'dotShape',label:'Dot Shape',type:'select',options:[
      {value:'round',label:'Round'},{value:'square',label:'Square'},{value:'diamond',label:'Diamond'}
    ],default:'round'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    o.fill(p.invert ? 0 : 255);
    const minD = Math.min(p.minDot, p.maxDot);
    const maxD = Math.max(p.minDot, p.maxDot);
    const rnd = mkRand(p.seed);

    // Precompute a local complexity score per coarse block so we can
    // choose dot sizes. Score combines edge magnitude and contrast.
    function complexityAt(cx, cy, cw, ch) {
      const stats = cellStats(px, cx, cy, cw, ch, w, h);
      const edgeN = Math.min(1, stats.edgeMag / 255) * p.edgeSensitivity;
      const contN = Math.min(1, stats.contrast / 128) * p.contrastSensitivity;
      return { score: Math.max(edgeN, contN), stats };
    }

    // Walk the image in coarse chunks (maxD * 2 wide, maxD * 4 tall = one
    // braille cell at maximum dot size). For each chunk, compute complexity
    // and pick a dot size that scales with 1 - complexity.
    const coarseW = maxD * 2, coarseH = maxD * 4;
    for (let cy = 0; cy < h; cy += coarseH) {
      for (let cx = 0; cx < w; cx += coarseW) {
        const comp = complexityAt(cx, cy, coarseW, coarseH);
        // score=1 → minD, score=0 → maxD
        const range = maxD - minD;
        const ds = Math.max(1, Math.round(maxD - comp.score * range));
        const dotR = ds / 2;

        // For each sub-cell at this dot size inside the coarse region
        for (let by = cy; by < cy + coarseH && by < h; by += ds * 4) {
          for (let bx = cx; bx < cx + coarseW && bx < w; bx += ds * 2) {
            // Local luminance for adaptive threshold inside this sub-cell
            let localSum = 0, localCount = 0;
            for (let dy = 0; dy < ds * 4 && by + dy < h; dy++) {
              for (let dx = 0; dx < ds * 2 && bx + dx < w; dx++) {
                localSum += clamp(px[(by + dy) * w + bx + dx]);
                localCount++;
              }
            }
            const localAvg = localCount > 0 ? localSum / localCount : 128;
            const thr0 = p.threshold * (1 - p.adaptiveThreshold) + localAvg * p.adaptiveThreshold;
            // Luminance-based dot bias: dark regions get extra dots
            // (shadowBias>0), highlights fewer dots (highlightBias<0).
            const lumN = localAvg / 255;
            let bias = 0;
            if (lumN < 0.4) bias = p.shadowBias * (1 - lumN / 0.4) * 30;
            else if (lumN > 0.6) bias = p.highlightBias * ((lumN - 0.6) / 0.4) * 30;
            const thr = thr0 + bias;

            // Emit the 2×4 dot pattern for this braille cell
            for (let dotY = 0; dotY < 4; dotY++) {
              for (let dotX = 0; dotX < 2; dotX++) {
                const scy = by + dotY * ds, scx = bx + dotX * ds;
                if (scy >= h || scx >= w) continue;
                let sum = 0, cnt = 0;
                for (let sy = 0; sy < ds && scy + sy < h; sy++) {
                  for (let sx = 0; sx < ds && scx + sx < w; sx++) {
                    sum += clamp(px[(scy + sy) * w + scx + sx]);
                    cnt++;
                  }
                }
                if (cnt === 0) continue;
                let val = sum / cnt;
                if (p.gamma !== 1) val = Math.pow(val/255, p.gamma) * 255;
                // Op-Art moiré: add rotating sinusoidal bias based on block
                // index so alternating grids create a Riley-style illusion
                if (p.opArtMoire > 0) {
                  const mx = (scx + scy) * 0.22;
                  const my = (scx - scy) * 0.18;
                  val += (Math.sin(mx) + Math.cos(my)) * 40 * p.opArtMoire;
                }
                const isDark = p.invert ? val > thr : val < thr;
                if (isDark) {
                  const centerX = dotR, centerY = dotR;
                  for (let sy = 0; sy < ds && scy + sy < h; sy++) {
                    for (let sx = 0; sx < ds && scx + sx < w; sx++) {
                      let inside = false;
                      if (p.dotShape === 'round') {
                        const ddx = sx - centerX + 0.5, ddy = sy - centerY + 0.5;
                        inside = Math.sqrt(ddx * ddx + ddy * ddy) <= dotR;
                      } else if (p.dotShape === 'diamond') {
                        inside = Math.abs(sx - centerX + 0.5) + Math.abs(sy - centerY + 0.5) <= dotR;
                      } else {
                        inside = true;
                      }
                      if (inside) {
                        o[(scy + sy) * w + scx + sx] = p.invert ? 255 : 0;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // IMPRESSIONISM — directional dabs + op-art illusion modes
  // ═══════════════════════════════════════════
  // Inspired by Monet/Van Gogh: short brush dabs aligned to the perpendicular
  // of the local image gradient, colored/shaded by local luminance. Supports
  // several "optical illusion" variants that bend the dab placement to
  // produce Riley-style op-art or subtle chromatic-aberration feel.
  A.push({ id:'impressionism', name:'Impressionism / Op-Art', category:'artistic', params:[
    // — Reconstruction workflow —
    {id:'reconstructionStep',label:'Reconstruction Step',type:'reconstructionStep',min:0,max:6,step:1,default:6,
     labels:['1 · Underpainting','2 · Painterly sketch','3 · Broad block-in','4 · Form masses','5 · Color notes','6 · Edges + detail','7 · Final painting']},
    {id:'reconstructionLayers',label:'Edit Current Step',type:'reconstructionLayers',default:defaultPainterLayerSettings()},
    {id:'constructionStyle',label:'Construction Style',type:'select',options:[
      {value:'angular',label:'Angular painter sketch'},
      {value:'form',label:'Form-following sketch'},
      {value:'hybrid',label:'Hybrid sketch'}
    ],default:'angular'},
    {id:'constructionLines',label:'Construction Lines',min:0,max:1,step:.05,default:.5},
    {id:'constructionScope',label:'Sketch Scope',type:'select',options:[
      {value:'both',label:'Outline + form lines'},
      {value:'external',label:'Outline only (silhouette)'},
      {value:'internal',label:'Form lines only (interior)'},
      {value:'outline-bias',label:'Mostly outline'},
      {value:'form-bias',label:'Mostly form lines'}
    ],default:'both'},
    {id:'constructionLineColor',label:'Line Color',type:'select',options:[
      {value:'auto',label:'Auto (contrast vs canvas)'},
      {value:'dark',label:'Dark charcoal'},
      {value:'light',label:'Chalk on dark'},
      {value:'source',label:'Match source tone'},
      {value:'complement',label:'Push toward complement'},
      {value:'ink',label:'Ink (max contrast)'}
    ],default:'auto'},
    {id:'constructionDetail',label:'Sketch Detail',min:0.1,max:1,step:.05,default:.5},
    {id:'constructionAngularOutline',label:'Angular Outline',type:'checkbox',default:false},
    {id:'blockInStrength',label:'Broad Block-In',min:0,max:1.5,step:.05,default:.68},
    {id:'edgeFinish',label:'Soft ↔ Hard Edges',min:-1,max:1,step:.05,default:.2},
    // — Core (same defaults as legacy) —
    {id:'dabCount',label:'Dab Count',min:500,max:40000,step:100,default:4000},
    {id:'dabLen',label:'Dab Length',min:2,max:60,step:1,default:8},
    {id:'dabWidth',label:'Dab Width',min:1,max:16,step:1,default:2},
    {id:'flowStrength',label:'Gradient Alignment',min:0,max:1,step:.05,default:.85},
    {id:'lumModulation',label:'Luminance Modulation',min:0,max:2,step:.05,default:1},
    {id:'edgeBoost',label:'Edge Dab Density',min:0,max:2,step:.05,default:.8},
    // — Pixel-paint behavior (NEW defaults are crisp/dithered, like paint engine) —
    {id:'dabStyle',label:'Dab Style',type:'select',options:[
      {value:'pixel',label:'Pixel (sharp, dithered, samples source)'},
      {value:'blend',label:'Blend (smooth/legacy)'}
    ],default:'pixel'},
    {id:'coverageDensity',label:'Coverage Density',min:.1,max:1,step:.05,default:.85},
    {id:'sampleDrift',label:'Sample Drift',min:0,max:1,step:.05,default:.55},
    {id:'sampleJitter',label:'Sample Jitter (px)',min:0,max:12,step:.5,default:2},
    {id:'canvasStart',label:'Canvas',type:'select',options:[
      {value:'underpaint',label:'Painterly underpaint (wash + oriented strokes)'},
      {value:'source',label:'From source (coherent color)'},
      {value:'clean',label:'From blank canvas (classic)'}
    ],default:'underpaint'},
    {id:'underpaintBlock',label:'Underpaint Stroke Scale',min:4,max:40,step:1,default:14},
    // — Underpaint customization (same knobs as palette-knife) —
    {id:'underpaintNoise',label:'Underpaint Wash Noise',min:0,max:2,step:.05,default:1,
     hint:'grit in the tonal wash · 0 = smooth bilinear · 2 = gritty'},
    {id:'underpaintSmoothness',label:'Underpaint Wash ↔ Source',min:0,max:1,step:.05,default:0,
     hint:'0 = broad block wash · 1 = tighter source luminance'},
    {id:'underpaintDensity',label:'Underpaint Stroke Density',min:.3,max:3,step:.05,default:1},
    {id:'underpaintSize',label:'Underpaint Stroke Size',min:.3,max:3,step:.05,default:1},
    {id:'underpaintDetail',label:'Underpaint Detail Response',min:0,max:2,step:.05,default:1,
     hint:'how strongly detail drives stroke size + density'},
    {id:'underpaintAngle',label:'Underpaint Angle Jitter',min:0,max:1.5,step:.05,default:.8},
    {id:'underpaintStrength',label:'Underpaint Stroke Strength',min:0,max:1,step:.05,default:1,
     hint:'0 = wash only · 1 = hard painterly strokes'},
    {id:'underpaintDetailPreserve',label:'Underpaint Subject Detail',min:0,max:1,step:.05,default:.5,
     hint:'0 = broad wash everywhere · 1 = busy areas reconstruct with smaller strokes and sketch detail'},
    // — Detail awareness (human-like placement) —
    {id:'detailAware',label:'Detail Awareness',min:0,max:2,step:.05,default:1},
    {id:'sizeByDetail',label:'Size by Detail',min:0,max:1.5,step:.05,default:.7,
     hint:'bigger dabs in flat areas, smaller on features'},
    {id:'skipSmoothAreas',label:'Skip Smooth Areas',min:0,max:1,step:.05,default:.5},
    // See palette-knife formFollow comment — same semantics here.
    {id:'formFollow',label:'Angular ↔ Form-Follow',min:-1,max:1,step:.05,default:0},
    // — Wet paint (bleed/streak/smudge) —
    {id:'wetBleed',label:'Wet Bleed',min:0,max:1,step:.05,default:0},
    {id:'wetSmudge',label:'Wet Smudge',min:0,max:1,step:.05,default:0},
    {id:'wetStreak',label:'Wet Streak',min:0,max:1,step:.05,default:0},
    {id:'colorVariety',label:'Color Variety (multi-color stroke)',min:0,max:1,step:.05,default:.25},
    {id:'smartColorJitter',label:'Smart Color Jitter',min:0,max:1,step:.05,default:.4,
     hint:'Photoshop-like color notes placed mostly in saturated/detail/edge zones'},
    // — Intensity & adaptive —
    {id:'intensity',label:'Intensity',min:.3,max:3,step:.05,default:1},
    {id:'layers',label:'Layered Passes',min:1,max:6,step:1,default:1,
     hint:'1 = loose block-in only. More passes progressively revisit only important detail and edges with smaller, smarter dabs.'},
    {id:'adaptiveDensity',label:'Adaptive Density (detail)',min:0,max:2,step:.05,default:0},
    {id:'edgeBreak',label:'Edge Break (stop at edges)',min:0,max:1,step:.05,default:0},
    {id:'darkStrokeWeight',label:'Dark-First Weight',min:0,max:1,step:.05,default:0},
    {id:'opacityByLum',label:'Opacity by Luminance',min:0,max:1,step:.05,default:0},
    // — Per-dab jitter / impurities —
    {id:'sizeJitter',label:'Size Jitter',min:0,max:1,step:.05,default:0},
    {id:'lengthJitter',label:'Length Jitter',min:0,max:1,step:.05,default:0},
    {id:'angleJitter',label:'Angle Jitter',min:0,max:1,step:.05,default:0},
    {id:'scatter',label:'Position Scatter',min:0,max:30,step:.5,default:0},
    {id:'impurities',label:'Impurities (tone jitter)',min:0,max:1,step:.05,default:0},
    {id:'strokeCurve',label:'Stroke Curve',min:0,max:1,step:.05,default:0},
    // — Illusion modes (unchanged) —
    {id:'illusion',label:'Illusion Mode',type:'select',options:[
      {value:'none',label:'None'},
      {value:'riley',label:'Riley Moiré (wavy bands)'},
      {value:'radial',label:'Radial Starburst'},
      {value:'chromabber',label:'Chromatic Split'},
      {value:'spiral',label:'Spiral Twist'},
      {value:'detailJitter',label:'Detail Jitter (simulated micro-detail)'},
      {value:'colorJitterDetail',label:'Color Jitter Detail'}
    ],default:'none'},
    {id:'illusionStrength',label:'Illusion Strength',min:0,max:1,step:.05,default:.5},
    // Dab shape is now either the built-in soft ellipse (default) or whatever
    // the Custom Brushes panel below dispatches per-dab.
    // — CUSTOM BRUSH mode (same as palette-knife) —
    // Dispatches per-dab brush choice by local luminance + edge magnitude.
    // See palette-knife's customBrushes comment for the full model.
    {id:'customBrushes',label:'Custom Brushes',type:'customBrushes',default: {
      enabled: false,
      shadowHi: 85, midHi: 170,
      edgeEnabled: true, edgeThreshold: 80,
      ditherBand: 30,
      shadow: { source:'builtin', builtin:'1', brushId:'', sizeMul:1.4, angleJitter:0.2, opacity:1.0 },
      mid:    { source:'builtin', builtin:'0', brushId:'', sizeMul:1.0, angleJitter:0.5, opacity:0.9 },
      high:   { source:'builtin', builtin:'5', brushId:'', sizeMul:0.6, angleJitter:0.8, opacity:0.8 },
      edge:   { source:'builtin', builtin:'6', brushId:'', sizeMul:1.1, angleJitter:0.1, opacity:1.0 }
    }},
    // — If/Then Rules —
    {id:'rules',label:'If/Then Rules',type:'rules',default:[]},
    {id:'bgTone',label:'Background Tone',min:0,max:255,step:1,default:255},
    {id:'softness',label:'Dab Softness',min:0,max:1,step:.05,default:.4},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const gen = this._gen(px, w, h, p);
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  },
  async applyAsync(px, w, h, p, ctx) {
    const signal = (ctx && ctx.signal) || { cancelled: false };
    const onProgress = (ctx && ctx.onProgress) || null;
    const preview = !!signal.interactive;
    const gen = this._gen(px, w, h, p, preview);
    let r = gen.next();
    let lastProg = 0;
    // PREVIEW mode: skip setTimeout(0) yields entirely. The preview tier is
    // downsampled + has tighter internal caps (BBOX_CAP, fewer dabs) so it
    // finishes in ~100-300ms of pure compute. setTimeout(0) × 150 chunks
    // would add 600ms+ of deadweight in Chrome (4ms minimum per nested
    // timer) — more than the work itself. See palette-knife for matching
    // rationale.
    if (preview) {
      while (!r.done) {
        if (signal.cancelled) { try { gen.return(); } catch(_){} return r.value || new Uint8ClampedArray(w*h); }
        r = gen.next();
      }
      return r.value;
    }
    while (!r.done) {
      if (signal.cancelled) { try { gen.return(); } catch(_){} return r.value || new Uint8ClampedArray(w*h); }
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (onProgress && r.value && now - lastProg > 60) {
        lastProg = now;
        onProgress(new Uint8ClampedArray(r.value));
      }
      await new Promise(res => setTimeout(res, 0));
      r = gen.next();
    }
    return r.value;
  },
  *_gen(px, w, h, p, preview) {
    const o = new Uint8ClampedArray(w*h);
    const PREVIEW = !!preview;
    const bgTone = (p.bgTone != null) ? p.bgTone : 255;
    const canvasStart = p.canvasStart || 'underpaint';
    const dabStyle = p.dabStyle || 'pixel';
    // Canvas-relative size multiplier. Dab dimensions (length/width),
    // underpaint block scale, and pixel-distance jitter were tuned for a
    // ~720px canvas. Scaling by sqrt(area)/720 keeps stroke footprint as
    // a consistent fraction of canvas — small images stay readable, large
    // ones don't end up with stippling. Clamped so extreme sizes still
    // produce sensible values.
    const canvasScale = Math.max(0.5, Math.min(3.0, Math.sqrt(w * h) / 720));
    const underpaintBlock = Math.max(2, Math.round(((p.underpaintBlock != null) ? p.underpaintBlock : 14) * canvasScale));
    const stageLevel = reconstructionStepLevel(p);
    const reconUnderpaint = getPainterLayerSettings(p, 'underpaint');
    const seedUnder          = (p.seed|0) || 42;
    function shUnder(a, b, k) {
      let h = Math.imul((a|0) + 374761393, 0x9E3779B1) ^
              Math.imul((b|0) + 2246822519, 0x85EBCA77) ^
              Math.imul((k|0) + 3266489917, 0xC2B2AE3D) ^ seedUnder;
      h = Math.imul(h ^ (h >>> 15), 0x85EBCA77);
      h = Math.imul(h ^ (h >>> 13), 0xC2B2AE3D);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    // Precompute the sobel field early — the painterly underpaint uses its
    // angle channel to orient the scattered wash strokes, and the main dab
    // loop uses it again later (no duplicate compute; we reuse this).
    const sfUp = sobelField(px, w, h);
    const edgeMagUp = sfUp.mag, edgeAngUp = sfUp.ang;

    // Initial canvas:
    //   'underpaint' = painterly wash + loose oriented strokes from source
    //                  (replaces the old blocky posterized mosaic — reads
    //                   as a broad wet underpaint with gradients and large
    //                   abstract brushstrokes that echo the image's forms)
    //   'source'     = raw source pixels (filter feel; coherent across channels)
    //   'clean'      = bgTone (classic canvas, paint revealed only where dabs land)
    // Resolve brush mask early so the underpaint pass can shape its
    // strokes with the selected brush. The full mask config (including
    // per-slot custom brushes) is re-resolved below for the main dab
    // loop — this pre-resolve is intentionally just the base shape, since
    // the underpaint is a single unified pass, not slot-dispatched.
    let _upMask = null, _upSize = 0;
    {
      const _bs = p.brushShape || 'default';
      if (_bs !== 'default' && typeof PaintEngine !== 'undefined' && PaintEngine.getBrushMask) {
        const _bi = parseInt(_bs, 10);
        if (!isNaN(_bi)) {
          const _b = PaintEngine.getBrushMask(_bi);
          if (_b) { _upMask = _b.mask; _upSize = _b.size; }
        }
      }
    }

    if (dabStyle === 'pixel' && canvasStart === 'source') {
      for (let i = 0; i < w*h; i++) o[i] = clamp(px[i]);
    } else if (dabStyle === 'pixel' && canvasStart === 'underpaint') {
      const _upOpts = {
        washNoise:      (p.underpaintNoise      != null) ? p.underpaintNoise      : 1,
        washSmoothness: (p.underpaintSmoothness != null) ? p.underpaintSmoothness : 0,
        density:        ((p.underpaintDensity   != null) ? p.underpaintDensity    : 1) * reconUnderpaint.density,
        sizeMul:        ((p.underpaintSize      != null) ? p.underpaintSize       : 1) * reconUnderpaint.scale,
        detailResp:     ((p.underpaintDetail    != null) ? p.underpaintDetail     : 1) * (0.72 + reconUnderpaint.detail * 0.36),
        angleJitter:    ((p.underpaintAngle     != null) ? p.underpaintAngle      : 0.8) * (0.65 + reconUnderpaint.jitter * 0.85),
        strokeStrength: ((p.underpaintStrength  != null) ? p.underpaintStrength   : 1) * reconUnderpaint.opacity,
        detailPreserve: (p.underpaintDetailPreserve != null) ? p.underpaintDetailPreserve : 0.5,
        edgeFocus: reconUnderpaint.edge,
        angularity: reconUnderpaint.angularity,
        edgeMag: edgeMagUp,
        formFollow: Math.max((p.formFollow != null) ? p.formFollow : 0, reconUnderpaint.form * 0.8),
        seed: seedUnder
      };
      painterlyUnderpaint(o, px, w, h, underpaintBlock, shUnder, edgeAngUp, _upMask, _upSize, _upOpts);
    } else {
      o.fill(bgTone);
    }

    // — Param normalization (defaults preserve legacy behavior) —
    const intensity        = (p.intensity        != null) ? p.intensity        : 1;
    const layers           = Math.max(1, (p.layers != null) ? p.layers|0 : 1);
    const adaptiveDensity  = (p.adaptiveDensity  != null) ? p.adaptiveDensity  : 0;
    const edgeBreak        = (p.edgeBreak        != null) ? p.edgeBreak        : 0;
    const darkStrokeWeight = (p.darkStrokeWeight != null) ? p.darkStrokeWeight : 0;
    const opacityByLum     = (p.opacityByLum     != null) ? p.opacityByLum     : 0;
    const sizeJitter       = (p.sizeJitter       != null) ? p.sizeJitter       : 0;
    const lengthJitter     = (p.lengthJitter     != null) ? p.lengthJitter     : 0;
    const angleJitter      = (p.angleJitter      != null) ? p.angleJitter      : 0;
    // scatter and sampleJitter are pixel distances → scale with canvas so
    // they stay a consistent visual fraction of stroke footprint regardless
    // of image size.
    const scatter          = ((p.scatter          != null) ? p.scatter          : 0) * canvasScale;
    const impurities       = (p.impurities       != null) ? p.impurities       : 0;
    const strokeCurve      = (p.strokeCurve      != null) ? p.strokeCurve      : 0;
    const coverageDensity  = (p.coverageDensity  != null) ? p.coverageDensity  : 0.85;
    const sampleDrift      = (p.sampleDrift      != null) ? p.sampleDrift      : 0.55;
    const sampleJitter     = ((p.sampleJitter     != null) ? p.sampleJitter     : 2) * canvasScale;
    const detailAware      = (p.detailAware      != null) ? p.detailAware      : 1;
    const sizeByDetail     = (p.sizeByDetail     != null) ? p.sizeByDetail     : 0.7;
    const skipSmoothAreas  = (p.skipSmoothAreas  != null) ? p.skipSmoothAreas  : 0.5;
    const formFollow       = (p.formFollow       != null) ? p.formFollow       : 0;
    const wetBleed         = (p.wetBleed         != null) ? p.wetBleed         : 0;
    const wetSmudge        = (p.wetSmudge        != null) ? p.wetSmudge        : 0;
    const wetStreak        = (p.wetStreak        != null) ? p.wetStreak        : 0;
    const colorVariety     = (p.colorVariety     != null) ? p.colorVariety     : 0.25;
    const constructionLines= (p.constructionLines != null) ? p.constructionLines : 0.5;
    const constructionStyle= p.constructionStyle || 'angular';
    const blockInStrength  = (p.blockInStrength != null) ? p.blockInStrength : 0.68;
    const smartColorJitter = (p.smartColorJitter != null) ? p.smartColorJitter : 0.4;
    const edgeFinish       = (p.edgeFinish != null) ? p.edgeFinish : 0.2;
    const brushShape       = p.brushShape || 'default';
    const seedI            = (p.seed|0) || 42;

    // Spatial hash → [0,1). Deterministic per (a,b,k); identical across RGB
    // channels in color mode so dabs sample coherent source colors (real
    // multi-color per dab — like the paint engine).
    function sh(a, b, k) {
      let h = Math.imul((a|0) + 374761393, 0x9E3779B1) ^
              Math.imul((b|0) + 2246822519, 0x85EBCA77) ^
              Math.imul((k|0) + 3266489917, 0xC2B2AE3D) ^ seedI;
      h = Math.imul(h ^ (h >>> 15), 0x85EBCA77);
      h = Math.imul(h ^ (h >>> 13), 0xC2B2AE3D);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    // Brush mask (optional, from PaintEngine)
    let bMask = null, bSize = 0;
    if (brushShape !== 'default' && typeof PaintEngine !== 'undefined' && PaintEngine.getBrushMask) {
      const bi = parseInt(brushShape, 10);
      if (!isNaN(bi)) {
        const b = PaintEngine.getBrushMask(bi);
        if (b) { bMask = b.mask; bSize = b.size; }
      }
    }

    // — CUSTOM BRUSH dispatch config (mirrors palette-knife) —
    // Per-dab brush selection by local lum + edge. Each slot resolves
    // to a mask + size + sizeMul + opacity + angleJitter. app.js
    // attaches `_resolvedMask*` fields before calling.
    const cb = p.customBrushes || null;
    const cbEnabled = !!(cb && cb.enabled);
    const cbShadowHi  = (cb && cb.shadowHi  != null) ? cb.shadowHi  : 85;
    const cbMidHi     = (cb && cb.midHi     != null) ? cb.midHi     : 170;
    const cbEdgeEn    = !!(cb && cb.edgeEnabled);
    const cbEdgeThr   = (cb && cb.edgeThreshold != null) ? cb.edgeThreshold : 80;
    const cbDither    = (cb && cb.ditherBand != null) ? cb.ditherBand : 30;
    function _slotMaskI(name) {
      const r = cb && cb['_resolvedMask' + name];
      return r && r.mask ? { m: r.mask, s: r.size } : { m: bMask, s: bSize };
    }
    const cbShadowMI = cbEnabled ? _slotMaskI('Shadow') : { m: bMask, s: bSize };
    const cbMidMI    = cbEnabled ? _slotMaskI('Mid')    : { m: bMask, s: bSize };
    const cbHighMI   = cbEnabled ? _slotMaskI('High')   : { m: bMask, s: bSize };
    const cbEdgeMI   = cbEnabled ? _slotMaskI('Edge')   : { m: bMask, s: bSize };
    const cbShadow = cb && cb.shadow;
    const cbMid    = cb && cb.mid;
    const cbHigh   = cb && cb.high;
    const cbEdge   = cb && cb.edge;

    // Legacy blend path kept for the 'blend' dab style.
    if (dabStyle === 'blend') {
      return _impressionismBlend(px, w, h, p, { bMask, bSize });
    }

    // PIXEL mode — hard writes of sampled source pixels, dithered coverage.
    const cx0 = w / 2, cy0 = h / 2;
    const maxR = Math.sqrt(cx0 * cx0 + cy0 * cy0);
    let totalDabs = Math.round(p.dabCount * intensity);

    // Edge field already computed above (sfUp / edgeAngUp / edgeMagUp) so the
    // underpaint could orient its wash strokes. Reuse those aliases here
    // under the names the main dab loop expects — no duplicate sobel pass.
    const edgeMag = edgeMagUp, edgeAng = edgeAngUp;
    const needDetail = detailAware > 0 || sizeByDetail > 0 || skipSmoothAreas > 0 ||
      constructionLines > 0 || blockInStrength > 0 || smartColorJitter > 0 || edgeFinish !== 0;
    const detail = needDetail ? detailField(px, w, h, 8) : null;
    const detailNorm = detail ? 1 / Math.max(8, _advFieldStats(detail) * 0.6) : 0;
    const edgeNorm = 1 / Math.max(16, _advFieldStats(edgeMag) * 0.6);
    const layerPlan = buildPainterLayerPasses(layers, seedI ^ 0x7a3b, {
      detailAware,
      sizeByDetail,
      skipSmooth: skipSmoothAreas,
      detailPreserve: (p.underpaintDetailPreserve != null) ? p.underpaintDetailPreserve : 0.5
    });
    const toneGuide = (cbEnabled || constructionLines > 0 || blockInStrength > 0 || smartColorJitter > 0 || p.illusion === 'colorJitterDetail')
      ? buildAdvancedSourceAnalysis(w, h, px)
      : null;
    const cbGrayMap = toneGuide && toneGuide.fields && toneGuide.fields.gray ? toneGuide.fields.gray.value : null;
    const channelHint = p._advChannelHint || 'gray';
    const reconConstruction = getPainterLayerSettings(p, 'construction');
    const reconBlock = getPainterLayerSettings(p, 'block');
    const reconForms = getPainterLayerSettings(p, 'forms');
    const reconColor = getPainterLayerSettings(p, 'color');
    const reconEdges = getPainterLayerSettings(p, 'edges');
    const reconFinish = getPainterLayerSettings(p, 'finish');
    const reconPaint = stageLevel >= 6 ? reconFinish : reconEdges;

    if (stageLevel <= 0) return o;
    if (constructionLines > 0) {
      paintConstructionSketch(o, px, w, h, edgeMag, edgeAng, detail, toneGuide, {
        strength: constructionLines,
        style: constructionStyle,
        scope: p.constructionScope || 'both',
        colorMode: p.constructionLineColor || 'auto',
        detailLevel: (p.constructionDetail != null) ? p.constructionDetail : 0.5,
        angularOutline: !!p.constructionAngularOutline,
        detailDrive: Math.min(1, detailAware / 2),
        lineScale: (0.85 + canvasScale * 0.18) * reconConstruction.scale,
        spacing: Math.max(5, underpaintBlock * 0.50),
        length: Math.max(10, underpaintBlock * 0.96) * reconConstruction.scale,
        width: (0.75 + constructionLines) * Math.sqrt(reconConstruction.scale),
        density: reconConstruction.density,
        opacity: reconConstruction.opacity,
        jitter: reconConstruction.jitter,
        detailFocus: reconConstruction.detail,
        angularity: reconConstruction.angularity,
        form: reconConstruction.form,
        edgeFocus: reconConstruction.edge,
        structure: Math.max(reconConstruction.detail, reconConstruction.edge),
        seed: seedI ^ 0x4ef
      });
      yield o;
      if (stageLevel <= 1) return o;
    }
    if (blockInStrength > 0) {
      paintBroadMassStrokes(o, px, w, h, edgeMag, edgeAng, detail, toneGuide, sh, {
        strength: blockInStrength,
        size: Math.max(underpaintBlock, (p.dabLen || 8) * canvasScale * 1.55) * reconBlock.scale,
        detailDrive: Math.min(1, detailAware / 2),
        formFollow: Math.max(formFollow, reconBlock.form * 0.35),
        angularity: Math.max(reconBlock.angularity, formFollow < 0 ? Math.min(1, -formFollow) : (constructionStyle === 'angular' ? 0.48 : 0.18)),
        density: reconBlock.density,
        opacity: reconBlock.opacity,
        jitter: reconBlock.jitter,
        detailFocus: reconBlock.detail,
        edgeFocus: reconBlock.edge,
        form: reconBlock.form,
        seed: seedI ^ 0x594
      });
      yield o;
      if (stageLevel <= 2) return o;
    }

    paintBroadMassStrokes(o, px, w, h, edgeMag, edgeAng, detail, toneGuide, sh, {
      strength: Math.min(1.15, blockInStrength * 0.55 + 0.16),
      size: Math.max(4, (p.dabLen || 8) * canvasScale * (0.85 + sizeByDetail * 0.16)) * reconForms.scale,
      detailDrive: Math.min(1, detailAware / 2),
      formFollow: Math.max(formFollow, 0.25, reconForms.form * 0.82),
      angularity: Math.max(reconForms.angularity, formFollow < 0 ? Math.min(1, -formFollow) : (constructionStyle === 'angular' ? 0.30 : 0.10)),
      density: reconForms.density,
      opacity: reconForms.opacity,
      jitter: reconForms.jitter,
      detailFocus: reconForms.detail,
      edgeFocus: reconForms.edge,
      form: reconForms.form,
      seed: seedI ^ 0x6ad
    });
    yield o;
    if (stageLevel <= 3) return o;

    if (smartColorJitter > 0) {
      paintIntelligentColorJitter(o, px, w, h, toneGuide, edgeMag, edgeAng, detail, {
        strength: smartColorJitter,
        channelHint,
        spacing: Math.max(3, (p.dabLen || 8) * canvasScale * 0.72),
        length: Math.max(3, (p.dabLen || 8) * canvasScale * 0.95) * reconColor.scale,
        width: Math.max(0.7, (p.dabWidth || 2) * canvasScale * 0.8) * Math.sqrt(reconColor.scale),
        density: reconColor.density,
        opacity: reconColor.opacity,
        jitter: reconColor.jitter,
        detailFocus: reconColor.detail,
        edgeFocus: reconColor.edge,
        form: reconColor.form,
        angularity: reconColor.angularity,
        seed: seedI ^ 0x7f1
      });
      yield o;
    }
    if (stageLevel <= 4) return o;

    const renderLayerPlan = applyPainterLayerSettingsToPlan(layerPlan, reconPaint);

    // When detail-awareness is active, reduce total dabs (a human would
    // not paint 4000 strokes in a flat sky; we redistribute them).
    if (detailAware > 0) {
      totalDabs = Math.round(totalDabs * (1 - detailAware * 0.15));
    }
    totalDabs = Math.max(80, Math.round(totalDabs * Math.sqrt(Math.max(0.15, reconPaint.density))));

    // Preview-tier: roughly halve dab count so drag-interactive re-renders
    // stay snappy. Quality gap vs final is small — the image still reads
    // painterly, user can evaluate direction + color.
    if (PREVIEW) totalDabs = Math.round(totalDabs * 0.55);
    // Preview bbox radius cap — bbox footprint is bboxR² per dab, so this
    // is the bigger lever than dab count for brush-shape mode.
    const BBOX_CAP = PREVIEW ? 14 : 25;

    // Chunk cadence for cooperative yielding — yield every N dabs so
    // applyAsync can paint progress + respond to cancellation. Sync drain
    // ignores these yields, so zero perf cost in the sync path.
    // Larger chunks = less setTimeout deadweight in the async path. Each
    // yield costs ~4ms of clamped timer latency, so we batch aggressively:
    // 600 dabs = ~100-200ms of work between yields = responsive but not
    // bleeding frames into timer overhead.
    const DAB_CHUNK = 600;
    const layerDensitySum = renderLayerPlan.reduce((sum, layerSpec) => sum + layerSpec.densityMul, 0) || 1;
    let globalDab = 0;
    for (let layer = 0; layer < renderLayerPlan.length; layer++) {
      const layerSpec = renderLayerPlan[layer];
      const layerShare = layerSpec.densityMul / layerDensitySum;
      const layerDabs = Math.max(80, Math.round(totalDabs * layerShare));
      const layerAng = renderLayerPlan.length > 1
        ? (((layerSpec.index / Math.max(1, renderLayerPlan.length - 1)) - 0.5) * Math.PI * 0.18)
        : 0;
      for (let li = 0; li < layerDabs; li++, globalDab++) {
        if (globalDab > 0 && (globalDab % DAB_CHUNK) === 0) yield o;
        const strokeKey = globalDab + layer * 4096;
        // Dab origin — position-hash so channels agree on locations.
        let x = Math.floor(sh(strokeKey, layer, 100) * w);
        let y = Math.floor(sh(strokeKey, layer, 101) * h);

        // — Detail-aware placement: skip low-detail candidates more aggressively
        //   (a human doesn't waste 50 strokes on a smooth sky — a few large
        //   painterly dabs are enough).
        let localDetail = 0;
        if (detail) {
          localDetail = shapeDetailSignal(
            detail[y * w + x] * detailNorm,
            Math.min(1, (detailAware / 2) * (0.72 + (layerSpec.reconDetail || 0.7) * 0.34))
          );
          if (skipSmoothAreas > 0) {
            const keepProb = localDetail + (1 - skipSmoothAreas * 0.8);
            if (sh(strokeKey, layer, 120) > Math.min(1, keepProb)) continue;
          }
        }

        // Position scatter
        if (scatter > 0) {
          x += Math.round((sh(strokeKey, layer, 103) - 0.5) * scatter * 2);
          y += Math.round((sh(strokeKey, layer, 104) - 0.5) * scatter * 2);
          if (x < 0 || x >= w || y < 0 || y >= h) continue;
        }

        const srcVal = clamp(px[y * w + x]);
        const lumN = srcVal / 255;
        const cIdx = Math.min(h - 2, Math.max(1, y)) * w + Math.min(w - 2, Math.max(1, x));
        const eMag = edgeMag[cIdx], eAng = edgeAng[cIdx];
        const edgeN = Math.min(1, eMag * edgeNorm);
        const phaseTag = edgeN > 0.58 ? 'edge'
          : localDetail > 0.58 ? 'detail'
          : lumN < 0.38 ? 'shadow'
          : lumN > 0.72 ? 'highlight'
          : (layerSpec.t < 0.36 ? 'flat' : 'mid');
        if (!keepPainterLayerStroke(layerSpec, localDetail, edgeN, lumN, sh(strokeKey, layer, 119), phaseTag)) continue;

        // Edge-boost / adaptive-density acceptance (uses precomputed fields)
        if (p.edgeBoost > 0 || adaptiveDensity > 0) {
          let accept = 0.4 + edgeN * p.edgeBoost * 0.6;
          if (adaptiveDensity > 0 && detail) {
            accept += localDetail * adaptiveDensity * 0.8;
          }
          if (sh(strokeKey, layer, 102) > accept) continue;
        }

        // Dark-first weighting: probabilistically skip light areas
        if (darkStrokeWeight > 0 && sh(strokeKey, layer, 105) < lumN * darkStrokeWeight) continue;

        // — CUSTOM BRUSH: per-dab slot pick —
        // Edge priority first (sharp features get their own dab shape).
        // Then boundary-dither luminance for smooth zone transitions.
        let currMask = bMask, currSize = bSize;
        let slotSizeMul = 1, slotOpacity = 1, slotAngJit = 0;
        if (cbEnabled) {
          if (cbEdgeEn && eMag >= cbEdgeThr) {
            currMask = cbEdgeMI.m; currSize = cbEdgeMI.s;
            if (cbEdge) {
              slotSizeMul = cbEdge.sizeMul || 1;
              slotOpacity = (cbEdge.opacity != null) ? cbEdge.opacity : 1;
              slotAngJit  = cbEdge.angleJitter || 0;
            }
          } else {
            const lumByte = cbGrayMap ? Math.round(cbGrayMap[y * w + x]) : srcVal;
            const hv = sh(strokeKey, layer, 998);
            const ldith = lumByte + (cbDither > 0 ? (hv - 0.5) * cbDither * 2 : 0);
            let spec;
            if (ldith < cbShadowHi) {
              currMask = cbShadowMI.m; currSize = cbShadowMI.s; spec = cbShadow;
            } else if (ldith < cbMidHi) {
              currMask = cbMidMI.m;    currSize = cbMidMI.s;    spec = cbMid;
            } else {
              currMask = cbHighMI.m;   currSize = cbHighMI.s;   spec = cbHigh;
            }
            if (spec) {
              slotSizeMul = spec.sizeMul || 1;
              slotOpacity = (spec.opacity != null) ? spec.opacity : 1;
              slotAngJit  = spec.angleJitter || 0;
            }
          }
        }

        const layerForm = clamp01(Math.max(0, formFollow) * 0.55 + (layerSpec.reconForm || 0) * 0.55);
        const layerFlow = clamp01((p.flowStrength != null ? p.flowStrength : 0.85) * layerSpec.flowMul + layerForm * 0.22);
        const guidedAng = painterDirectionAngle(seedI ^ (layer * 0x7f3), x, y, cIdx, edgeMag, edgeAng, edgeNorm, {
          cell: Math.max(7, (p.dabLen || 8) * canvasScale * (1.8 + layerSpec.broad * 1.2)),
          formFollow: layerForm,
          edgeFocus: layerSpec.reconEdge || 0.5,
          angularity: (layerSpec.reconAngularity || 0) * 0.45,
          jitter: layerSpec.reconJitter || 0.35,
          divisions: 16
        });
        let dirAng = blendAngles(sh(strokeKey, layer, 107) * Math.PI * 2, guidedAng, layerFlow);
        // Detail + formFollow shape the jitter, same as palette-knife.
        const detailJitDamp = detail ? (1 - localDetail * detailAware * 0.65) : 1;
        const formJitScale  = formFollow >= 0
          ? (1 - layerForm * 0.72)
          : (1 + (-formFollow) * 0.8);
        const effAngleJit   = (angleJitter + slotAngJit) * detailJitDamp * formJitScale * layerSpec.jitterMul * (0.72 + (layerSpec.reconJitter || 0.35) * 0.45);
        if (effAngleJit > 0) dirAng += (sh(strokeKey, layer, 108) - 0.5) * effAngleJit * Math.PI;

        // Angular quantization when formFollow is strongly negative.
        const qStrength = Math.max(
          (layerSpec.reconAngularity || 0) * 0.55,
          formFollow < -0.15 ? Math.min(1, (-formFollow - 0.15) / 0.85) : 0
        );
        dirAng = quantizeAngle(dirAng, qStrength, 16);
        dirAng += layerAng;

        // Illusion modulation
        let ox = 0, oy = 0;
        const dx0 = x - cx0, dy0 = y - cy0;
        const rN = Math.sqrt(dx0 * dx0 + dy0 * dy0) / maxR;
        const phi = Math.atan2(dy0, dx0);
        if (p.illusion === 'riley') dirAng += Math.sin((y + layerSpec.index * 13) * 0.05) * p.illusionStrength * (0.6 + layerSpec.t * 0.6);
        else if (p.illusion === 'radial') dirAng = phi * (1 - p.illusionStrength * 0.4) + dirAng * (1 - p.illusionStrength) * 0.55 + phi * p.illusionStrength;
        else if (p.illusion === 'chromabber') { const ofs = rN * p.illusionStrength * (4 + layerSpec.t * 4); ox = Math.cos(phi)*ofs; oy = Math.sin(phi)*ofs; }
        else if (p.illusion === 'spiral') dirAng += (phi + rN * Math.PI * 2) * p.illusionStrength * (0.45 + layerSpec.t * 0.55);

        // Detail-aware sizing: smooth regions → big painterly dabs,
        // detail regions → small precise dabs.
        let detailSizeMul = 1;
        if (detail && sizeByDetail > 0) {
          const smoothFactor = 1 - localDetail;
          detailSizeMul = 1 + smoothFactor * sizeByDetail * 3.0;
        }
        if (detail && detailAware > 0) {
          detailSizeMul *= Math.max(0.4, 1 - localDetail * detailAware * 0.5);
        }
        const detailLenFactor = detail ? (1 - localDetail * detailAware * 0.55) : 1;
        const formLenFactor = formFollow > 0 ? (1 - formFollow * 0.35) : 1;

        // Dab size + length modulation.
        const lenMul = 1 + (1 - srcVal / 255) * p.lumModulation * 0.4;
        let len = p.dabLen * canvasScale * lenMul * detailSizeMul * slotSizeMul * detailLenFactor * formLenFactor * layerSpec.lengthMul;
        if (lengthJitter > 0) len *= (1 + (sh(strokeKey, layer, 109) - 0.5) * lengthJitter * 1.5);
        let width = p.dabWidth * canvasScale * detailSizeMul * slotSizeMul * layerSpec.sizeMul;
        if (sizeJitter > 0) width *= (1 + (sh(strokeKey, layer, 110) - 0.5) * sizeJitter * 1.5);
        width = Math.max(0.5, width);
        len   = Math.max(1, len);

        const opacMul = (1 + (1 - lumN) * opacityByLum) * layerSpec.opacityMul;
        const curveAmp = strokeCurve * len * 0.15 * (0.55 + layerSpec.t * 0.75);

        // Impurities: shift sample origin for this dab (dirty paint)
        const impX = impurities > 0 ? (sh(strokeKey, layer, 111) - 0.5) * impurities * 10 : 0;
        const impY = impurities > 0 ? (sh(strokeKey, layer, 112) - 0.5) * impurities * 10 : 0;

        // Wet-paint per-dab offsets.
        const streakLen = wetStreak > 0 ? len * (0.5 + wetStreak * (1.1 + layerSpec.t * 0.8)) : 0;
        const smudgeDrag = wetSmudge * len * 0.6 * layerSpec.pickupMul;
        const varietyRadius = colorVariety * (Math.max(width, len) * 0.35) * (0.75 + layerSpec.t * 0.45);

        const cosA = Math.cos(dirAng), sinA = Math.sin(dirAng);
        const halfLen = Math.max(len, streakLen) / 2, halfW = width / 2;
        const bboxR = Math.min(BBOX_CAP, Math.ceil(Math.max(halfLen, halfW)) + 1);

        // Main rasterize loop — use `stamp()` helper for both brush-mask and
        // built-in ellipse paths. Unified so wet-paint effects apply uniformly.
        const useMask = (currMask && currSize > 0);
        const halfLenReal = len / 2;
        const effSlotOpacity = slotOpacity * layerSpec.opacityMul;
        const layerDrift = Math.min(1.2, sampleDrift * (0.72 + layerSpec.t * 0.42));
        const layerJitter = sampleJitter * layerSpec.pickupMul;
        for (let ty = -bboxR; ty <= bboxR; ty++) for (let tx = -bboxR; tx <= bboxR; tx++) {
          const lx = tx * cosA + ty * sinA;
          const ly = -tx * sinA + ty * cosA;
          const dn = lx / halfLenReal;
          const dw = ly / halfW;

          // Coverage profile — maskV or soft ellipse. For streak extension,
          // coverage fades from the end of the real dab out along +stroke.
          let maskV;
          if (useMask) {
            if (dn < -1 || dn > 1 + streakLen / len || Math.abs(dw) > 1) continue;
            const inDab = (dn >= -1 && dn <= 1);
            const mx = inDab ? Math.round((dn + 1) * 0.5 * (currSize - 1)) : (currSize - 1);
            const my = Math.round((dw + 1) * 0.5 * (currSize - 1));
            if (mx < 0 || mx >= currSize || my < 0 || my >= currSize) continue;
            maskV = currMask[my * currSize + mx];
            if (!inDab) {
              const streakT = (dn - 1) / Math.max(1e-6, streakLen / len);
              maskV *= Math.max(0, 1 - streakT);
            }
            if (maskV < 0.01) continue;
          } else {
            const dnA = Math.abs(dn), dwA = Math.abs(dw);
            const r2 = dnA * dnA + dwA * dwA;
            if (r2 > 1) {
              if (streakLen <= 0 || dn <= 1 || Math.abs(dw) > 1) continue;
              const streakT = (dn - 1) / Math.max(1e-6, streakLen / len);
              if (streakT > 1) continue;
              maskV = (1 - streakT) * (1 - Math.abs(dw)) * 0.7;
              if (maskV < 0.01) continue;
            } else {
              maskV = p.softness > 0 ? (1 - Math.pow(r2, 0.5 + p.softness * 2)) : 1;
            }
          }

          let pxx = x + tx + ox;
          let pyy = y + ty + oy;
          if (curveAmp > 0) {
            const sn = dn;
            pxx += Math.sin(sn * Math.PI) * curveAmp * (-sinA);
            pyy += Math.sin(sn * Math.PI) * curveAmp * cosA;
          }
          pxx = Math.round(pxx); pyy = Math.round(pyy);
          if (pxx < 0 || pxx >= w || pyy < 0 || pyy >= h) continue;

          if (edgeBreak > 0) {
            const e2mag = edgeMag[pyy * w + pxx];
            if (sh(pxx, pyy, 30) < Math.min(1, e2mag * edgeNorm) * edgeBreak) continue;
          }

          const prob = Math.min(1, maskV * opacMul * coverageDensity);
          if (sh(pxx, pyy, 31 + (strokeKey & 7)) > prob) continue;

          // Sample origin: drift from dab center towards pixel, plus impurities
          // and smudge drag along stroke direction.
          let sOx = x + (pxx - x) * layerDrift + impX;
          let sOy = y + (pyy - y) * layerDrift + impY;
          if (wetSmudge > 0) {
            const dragT = Math.max(0, dn + 1) * 0.5;
            sOx -= cosA * smudgeDrag * dragT;
            sOy -= sinA * smudgeDrag * dragT;
          }

          // Jitter + color variety (fiber-style multi-color within a stroke)
          const jx = layerJitter > 0 ? (sh(pxx, pyy, 40) - 0.5) * layerJitter * 2 : 0;
          const jy = layerJitter > 0 ? (sh(pxx, pyy, 41) - 0.5) * layerJitter * 2 : 0;
          const vx = varietyRadius > 0 ? (sh(pxx, pyy, 50 + (strokeKey & 3)) - 0.5) * varietyRadius * 2 : 0;
          const vy = varietyRadius > 0 ? (sh(pxx, pyy, 51 + (strokeKey & 3)) - 0.5) * varietyRadius * 2 : 0;

          const sXi = Math.max(0, Math.min(w - 1, Math.round(sOx + jx + vx)));
          const sYi = Math.max(0, Math.min(h - 1, Math.round(sOy + jy + vy)));
          const srcV = clamp(px[sYi * w + sXi]);
          const oi = pyy * w + pxx;
          if (effSlotOpacity >= 0.999) {
            o[oi] = srcV;
          } else {
            o[oi] = Math.round(srcV * effSlotOpacity + o[oi] * (1 - effSlotOpacity));
          }
        }
      }
    }

    if (edgeFinish !== 0 && stageLevel >= 5) {
      const edgeLayer = stageLevel >= 6 ? reconFinish : reconEdges;
      finishPainterEdges(o, px, w, h, edgeMag, edgeAng, detail, seedI ^ 0x637, edgeFinish, edgeLayer);
      yield o;
    }
    if (stageLevel <= 5) return o;

    // — Post-pass: WET BLEED (capillary spread) —
    //   Dithered pixel-swap with neighbors, so wet color creeps outward
    //   without blurring — same "crisp bleed" approach as the paint engine's
    //   wetLayer evolution. Seeded by position so it's deterministic &
    //   coherent across RGB channels.
    if (wetBleed > 0) {
      const bleedRadius = Math.max(1, Math.round(wetBleed * 3));
      const bleedProb = wetBleed * 0.45;
      const tmp = new Uint8ClampedArray(o);
      for (let y = 1; y < h - 1; y++) {
        const yr = y * w;
        for (let x = 1; x < w - 1; x++) {
          if (sh(x, y, 200) > bleedProb) continue;
          // Pick a neighbor to copy from (dithered random direction)
          const dx = Math.round((sh(x, y, 201) - 0.5) * 2 * bleedRadius);
          const dy = Math.round((sh(x, y, 202) - 0.5) * 2 * bleedRadius);
          const nx = Math.max(0, Math.min(w-1, x + dx));
          const ny = Math.max(0, Math.min(h-1, y + dy));
          o[yr + x] = tmp[ny * w + nx];
        }
      }
    }

    // — Post-pass: Detail Jitter illusion (if selected) —
    if (p.illusion === 'detailJitter' && detail) {
      detailJitterPass(o, detail, w, h, p.illusionStrength || 0.5, seedI);
      yield o;
    } else if (p.illusion === 'colorJitterDetail') {
      const colorAnalysis = buildAdvancedSourceAnalysis(w, h, px);
      colorJitterDetailPass(o, colorAnalysis, w, h, p.illusionStrength || 0.5, p._advChannelHint || 'gray', seedI);
      yield o;
    }

    // — Post-pass: USER IF/THEN RULES —
    if (Array.isArray(p.rules) && p.rules.length > 0) {
      applyRules(o, px, w, h, p.rules, edgeMag, edgeAng, detail, sh);
      yield o;
    }

    return o;
  }});

  // Legacy alpha-blend implementation kept for the 'blend' dab style.
  function _impressionismBlend(px, w, h, p, ctx) {
    const { bMask, bSize } = ctx;
    const o = new Uint8ClampedArray(w*h);
    o.fill((p.bgTone != null) ? p.bgTone : 255);
    const rnd = mkRand(p.seed);
    const cx0 = w / 2, cy0 = h / 2;
    const maxR = Math.sqrt(cx0 * cx0 + cy0 * cy0);
    // Match the pixel-path canvas scaling so switching dab style doesn't
    // change effective brush footprint.
    const canvasScale = Math.max(0.5, Math.min(3.0, Math.sqrt(w * h) / 720));

    const intensity        = (p.intensity        != null) ? p.intensity        : 1;
    const layers           = Math.max(1, (p.layers != null) ? p.layers|0 : 1);
    const adaptiveDensity  = (p.adaptiveDensity  != null) ? p.adaptiveDensity  : 0;
    const edgeBreak        = (p.edgeBreak        != null) ? p.edgeBreak        : 0;
    const darkStrokeWeight = (p.darkStrokeWeight != null) ? p.darkStrokeWeight : 0;
    const opacityByLum     = (p.opacityByLum     != null) ? p.opacityByLum     : 0;
    const sizeJitter       = (p.sizeJitter       != null) ? p.sizeJitter       : 0;
    const lengthJitter     = (p.lengthJitter     != null) ? p.lengthJitter     : 0;
    const angleJitter      = (p.angleJitter      != null) ? p.angleJitter      : 0;
    const scatter          = ((p.scatter          != null) ? p.scatter          : 0) * canvasScale;
    const impurities       = (p.impurities       != null) ? p.impurities       : 0;
    const strokeCurve      = (p.strokeCurve      != null) ? p.strokeCurve      : 0;

    const totalDabs = Math.round(p.dabCount * intensity) * layers;

    function trySample() {
      const x = Math.floor(rnd() * w), y = Math.floor(rnd() * h);
      if (p.edgeBoost > 0 || adaptiveDensity > 0) {
        const e = sobelAt(px, Math.min(w-2, Math.max(1, x)), Math.min(h-2, Math.max(1, y)), w, h);
        let accept = 0.4 + Math.min(1, e.mag / 120) * p.edgeBoost * 0.6;
        if (adaptiveDensity > 0) {
          let sum = 0, sumSq = 0, n = 0;
          for (let dyy = -3; dyy <= 3; dyy += 3) for (let dxx = -3; dxx <= 3; dxx += 3) {
            const nx = x + dxx, ny = y + dyy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const v = px[ny*w+nx]; sum += v; sumSq += v*v; n++;
            }
          }
          if (n > 0) {
            const mean = sum / n;
            const varc = Math.max(0, sumSq / n - mean*mean);
            accept += Math.min(1, varc / 2500) * adaptiveDensity * 0.8;
          }
        }
        if (rnd() > accept) return null;
      }
      return [x, y];
    }

    for (let i = 0; i < totalDabs; i++) {
      const s = trySample();
      if (!s) continue;
      let [x, y] = s;

      if (scatter > 0) {
        x += Math.round((rnd() - 0.5) * scatter * 2);
        y += Math.round((rnd() - 0.5) * scatter * 2);
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
      }

      const srcVal = clamp(px[y * w + x]);
      const ink = 255 - srcVal;
      const lumN = srcVal / 255;
      if (ink < 8 && p.lumModulation > 0.5) continue;
      if (darkStrokeWeight > 0 && rnd() < lumN * darkStrokeWeight) continue;

      const e = sobelAt(px, Math.min(w-2, Math.max(1, x)), Math.min(h-2, Math.max(1, y)), w, h);
      let dirAng = e.mag > 5 ? e.ang + Math.PI / 2 : rnd() * Math.PI * 2;
      dirAng = dirAng * p.flowStrength + (rnd() * Math.PI * 2) * (1 - p.flowStrength);
      if (angleJitter > 0) dirAng += (rnd() - 0.5) * angleJitter * Math.PI;

      let ox = 0, oy = 0;
      const dx0 = x - cx0, dy0 = y - cy0;
      const rN = Math.sqrt(dx0*dx0 + dy0*dy0) / maxR;
      const phi = Math.atan2(dy0, dx0);
      if (p.illusion === 'riley') dirAng += Math.sin(y * 0.05) * p.illusionStrength * 1.2;
      else if (p.illusion === 'radial') dirAng = phi * (1 - p.illusionStrength) + dirAng * (1 - p.illusionStrength) * 0.5 + phi * p.illusionStrength;
      else if (p.illusion === 'chromabber') { const ofs = rN * p.illusionStrength * 6; ox = Math.cos(phi)*ofs; oy = Math.sin(phi)*ofs; }
      else if (p.illusion === 'spiral') dirAng += (phi + rN * Math.PI * 2 * p.illusionStrength);

      const lenMul = 1 + (1 - srcVal/255) * p.lumModulation * 0.4;
      let len = p.dabLen * canvasScale * lenMul;
      if (lengthJitter > 0) len *= (1 + (rnd() - 0.5) * lengthJitter * 1.5);
      let width = p.dabWidth * canvasScale;
      if (sizeJitter > 0) width *= (1 + (rnd() - 0.5) * sizeJitter * 1.5);
      width = Math.max(0.5, width);
      len   = Math.max(1, len);

      const inkJit = impurities > 0 ? clamp(ink + (rnd() - 0.5) * 128 * impurities) : ink;
      const opacMul = 1 + (1 - lumN) * opacityByLum;
      const curveAmp = strokeCurve * len * 0.15;

      const cosA = Math.cos(dirAng), sinA = Math.sin(dirAng);
      const halfLen = len / 2, halfW = width / 2;
      const bboxR = Math.ceil(Math.max(halfLen, halfW)) + 1;

      if (bMask && bSize > 0) {
        for (let ty = -bboxR; ty <= bboxR; ty++) for (let tx = -bboxR; tx <= bboxR; tx++) {
          const lx = tx * cosA + ty * sinA;
          const ly = -tx * sinA + ty * cosA;
          const dn = lx / halfLen, dw = ly / halfW;
          if (dn*dn + dw*dw > 1) continue;
          const mx = Math.round((dn + 1) * 0.5 * (bSize - 1));
          const my = Math.round((dw + 1) * 0.5 * (bSize - 1));
          if (mx < 0 || mx >= bSize || my < 0 || my >= bSize) continue;
          const maskV = bMask[my * bSize + mx];
          if (maskV < 0.01) continue;
          let px_x = x + tx + ox;
          let px_y = y + ty + oy;
          if (curveAmp > 0) {
            const sn = dn;
            px_x += Math.sin(sn * Math.PI) * curveAmp * (-sinA);
            px_y += Math.sin(sn * Math.PI) * curveAmp * cosA;
          }
          px_x = Math.round(px_x); px_y = Math.round(px_y);
          if (px_x < 0 || px_x >= w || px_y < 0 || px_y >= h) continue;
          if (edgeBreak > 0) {
            const e2 = sobelAt(px, Math.min(w-2, Math.max(1, px_x)), Math.min(h-2, Math.max(1, px_y)), w, h);
            if (rnd() < Math.min(1, e2.mag / 120) * edgeBreak) continue;
          }
          const idx = px_y * w + px_x;
          const blend = Math.min(1, maskV * (0.4 + Math.min(1, inkJit/128) * 0.6) * opacMul);
          o[idx] = Math.round(o[idx] * (1 - blend) + (255 - inkJit) * blend);
        }
      } else {
        for (let ty = -bboxR; ty <= bboxR; ty++) for (let tx = -bboxR; tx <= bboxR; tx++) {
          const lx = tx * cosA + ty * sinA;
          const ly = -tx * sinA + ty * cosA;
          const dn = Math.abs(lx) / halfLen, dw = Math.abs(ly) / halfW;
          const r2 = dn*dn + dw*dw;
          if (r2 > 1) continue;
          const soft = p.softness > 0 ? (1 - Math.pow(r2, 0.5 + p.softness * 2)) : 1;
          let px_x = x + tx + ox;
          let px_y = y + ty + oy;
          if (curveAmp > 0) {
            const sn = lx / halfLen;
            px_x += Math.sin(sn * Math.PI) * curveAmp * (-sinA);
            px_y += Math.sin(sn * Math.PI) * curveAmp * cosA;
          }
          px_x = Math.round(px_x); px_y = Math.round(px_y);
          if (px_x < 0 || px_x >= w || px_y < 0 || px_y >= h) continue;
          if (edgeBreak > 0) {
            const e2 = sobelAt(px, Math.min(w-2, Math.max(1, px_x)), Math.min(h-2, Math.max(1, px_y)), w, h);
            if (rnd() < Math.min(1, e2.mag / 120) * edgeBreak) continue;
          }
          const idx = px_y * w + px_x;
          const blend = Math.min(1, soft * (0.4 + Math.min(1, inkJit/128) * 0.6) * opacMul);
          o[idx] = Math.round(o[idx] * (1 - blend) + (255 - inkJit) * blend);
        }
      }
    }
    if (p.illusion === 'colorJitterDetail') {
      const colorAnalysis = buildAdvancedSourceAnalysis(w, h, px);
      colorJitterDetailPass(o, colorAnalysis, w, h, p.illusionStrength || 0.5, p._advChannelHint || 'gray', (p.seed|0) || 42);
    }
    return o;
  }

  return A;
})();
