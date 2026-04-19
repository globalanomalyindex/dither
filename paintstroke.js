/**
 * PAINTSTROKE.js — Paint engine with brush system, 7 displacement tools, stroke recording
 */

const PaintEngine = (() => {
  // ── State ──
  let canvas = null, ctx = null;
  let painting = false;
  let lastX = 0, lastY = 0;
  let strokeCount = 0;

  // Undo stack (ImageData snapshots)
  const undoStack = [];
  const MAX_UNDO = 20;

  // Pre-paint base snapshot for overlay persistence
  let baseSnapshot = null;

  // Tool & settings
  let tool = 'smudge';
  let size = 30;
  let spacing = 25;     // % of brush size
  let strength = 50;    // 0-100
  let opacity = 100;    // 0-100

  // Tool-specific params
  let smudgeDecay = 70;   // % — how much pickup retains (high = long smear)
  let pushDistance = 20;   // px displacement
  let scatterRadius = 30;  // px random offset
  let swirlAngle = 45;     // degrees
  let liquifySmooth = 0.6; // distance falloff exponent
  let blendKernel = 3;     // blur kernel radius
  let spreadAmount = 50;   // stretch intensity

  // Pickup tool params
  let pickupJitter = 30;        // % — randomize sample position within stamp
  let pickupScatter = 10;       // px — scatter individual pixels
  let pickupCoherence = 50;     // 0=noise, 100=solid streaks — block size of randomization

  // Fiber model params — control bristle character
  let pickupFiberDensity = 50;  // 0..100 — sparse bristles → packed solid coverage
  let pickupFiberLength = 50;   // 0..100 — short stamps → long elongated streaks
  let pickupFiberFlow = 50;     // 0..100 — broken/wispy → solid continuous lines
  let pickupFiberWander = 30;   // 0..100 — straight parallel → wandering / chaotic
  let pickupColorVariety = 50;  // 0..100 — uniform color → multi-colored bristles
  let pickupFiberTaper = 50;    // 0..100 — flat ends → tapered stroke ends

  // Tapering
  let taperIn = 20;            // % of stroke length for taper in
  let taperOut = 20;           // % of stroke length for taper out
  let taperSize = true;        // taper affects size
  let taperOpacity = true;     // taper affects opacity
  let strokeTotalDist = 0;     // accumulated distance this stroke
  let strokeStampCount = 0;    // stamps applied this stroke

  // ── Pen input (Pointer Events API) ──
  // Pressure mappings
  let pressureSizeEnabled = true;         // map pressure → stamp size
  let pressureOpacityEnabled = true;      // map pressure → stamp opacity
  let pressureStrengthEnabled = false;    // map pressure → effect strength (bite)
  let pressureSpacingEnabled = false;     // map pressure → tighter spacing
  let pressureSizeMin = 0.15;             // size multiplier at pressure=0 (0..1)
  let pressureOpacityMin = 0.0;           // opacity multiplier at pressure=0 (0..1)
  let pressureStrengthMin = 0.3;          // strength multiplier at pressure=0 (0..1)
  let pressureCurve = 1.0;                // response curve exponent (0.3 soft, 3 hard)

  // Tilt mappings (pen angle relative to surface)
  let tiltEnabled = true;                 // enable tilt-to-brush modulation
  let tiltAngleInfluence = 1.0;           // 0..1 — tilt direction → brush rotation
  let tiltSizeInfluence = 0.4;            // 0..1 — tilt magnitude → brush size (rake)

  // Twist mapping (barrel rotation)
  let twistEnabled = true;                // enable twist-to-angle
  let twistInfluence = 1.0;               // 0..1 — twist angle → brush rotation

  // Velocity mappings
  let velocityEnabled = false;            // enable velocity-aware modulation
  let velocitySizeInfluence = 0.3;        // 0..1 — faster strokes = thinner

  // Current-stroke pen state (updated each stamp sample)
  let currentPressure = 1;                // 0..1
  let pressureActive = false;             // pen pointer driving this stroke
  let currentTiltX = 0, currentTiltY = 0; // -90..90 degrees
  let currentTwist = 0;                   // 0..359 degrees
  let currentVelocity = 0;                // px / ms

  // Velocity tracking
  let _lastMoveTime = 0, _lastMoveX = 0, _lastMoveY = 0;

  // In-stroke cache for pressure-scaled masks (keyed by integer size)
  let _pressureMaskCache = { size: -1, mask: null, brush: -1 };

  // Brush angle
  let brushAngle = 0;          // manual rotation in degrees
  let followDirection = false;  // rotate brush to follow stroke direction

  // Active brush mask
  let activeMask = null;
  let activeMaskSize = 0;

  // Stroke direction (normalized, canvas pixel space)
  let prevStampX = 0, prevStampY = 0;
  let strokeDirX = 0, strokeDirY = 0;

  // Smoothed stroke direction (for stable ribbon orientation)
  let smoothDirX = 0, smoothDirY = 0;

  // Accumulated stroke distance (texture u-coordinate for ribbon)
  let pickupStrokeDist = 0;
  // Random per-stroke offset so consecutive strokes don't sample the same spot
  let pickupStrokeSeedX = 0, pickupStrokeSeedY = 0;

  // Fiber model: array of independent painterly streaks rendered each stamp.
  // Each fiber has its own texture sampling row, opacity envelope, drift,
  // and length envelope. Rebuilt at the start of every stroke.
  let pickupFibers = null;

  // Smudge pickup buffers
  let pickupR = null, pickupG = null, pickupB = null;
  let hasPickup = false;

  // Pickup tool: marquee-selected pixel stamp
  let pickupStamp = null;      // { data: ImageData, w, h }
  let hasPickupStamp = false;

  // Brush library
  const brushLibrary = [];
  let selectedBrush = 0;

  // ── Live wet layer ──
  // Tracks which pixels are still "wet" so they keep evolving (drip, bleed,
  // smear, spread) as the stroke continues. Each stamp adds wetness within
  // the brush footprint; an evolution step then applies physical-paint-like
  // transformations to all wet pixels and decays their wetness.
  let wetMap = null;        // Float32Array (canvas.w * canvas.h), value 0..1
  let wetBounds = null;     // {x0,y0,x1,y1} dirty region
  let wetCanvasW = 0, wetCanvasH = 0;

  // Wet layer params (0..100 scale unless noted)
  let wetDrip      = 0;     // gravity: wet pixels pull color from above
  let wetBleed     = 0;     // capillary: spreading random neighbor swaps
  let wetSmear     = 0;     // continued smear along stroke direction
  let wetSeparate  = 0;     // separation: pull contrast outward (paint splitting)
  let wetLifetime  = 50;    // how long wetness persists (50 = balanced)
  let wetEvolveRate = 1;    // evolution iterations per stamp (subdivides for smoothness)

  // Creative / "super digital" wet effects (all crisp, displacement-based)
  let wetSort      = 0;     // pixel-sort along stroke direction
  let wetGlitch    = 0;     // RGB channel separation displacement
  let wetMosaic    = 0;     // block quantization within wet area
  let wetMosaicSize = 6;    // block size (px)
  let wetWave      = 0;     // sine-wave perpendicular displacement
  let wetWaveFreq  = 50;    // wave frequency
  let wetShred     = 0;     // VHS-style row shifts
  let wetEcho      = 0;     // ghost echo of pre-paint base showing through
  let wetKaleido   = 0;     // radial mirror around stroke center
  let wetVortex    = 0;     // swirl wet pixels around stroke axis
  let wetBitcrush  = 0;     // bit-depth quantize via crisp swap

  // Brush-shape influence (how much the mask shape dominates per-pixel
  // displacement amplitude; 100 = current, >100 = sharper bristly behavior).
  let shapeInfluence = 150; // 0..300 percentage

  // ── Init ──
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    if (brushLibrary.length === 0) initDefaultBrushes();
    selectBrush(0);
  }

  // ── Brush Generation ──
  const BRUSH_REF = 64;

  function initDefaultBrushes() {
    brushLibrary.length = 0;
    brushLibrary.push({ name: 'Round Soft', mask: makeRoundSoft(BRUSH_REF), size: BRUSH_REF });
    brushLibrary.push({ name: 'Round Hard', mask: makeRoundHard(BRUSH_REF), size: BRUSH_REF });
    brushLibrary.push({ name: 'Flat', mask: makeFlat(BRUSH_REF), size: BRUSH_REF });
    brushLibrary.push({ name: 'Splatter', mask: makeSplatter(BRUSH_REF), size: BRUSH_REF });
    brushLibrary.push({ name: 'Noise', mask: makeNoise(BRUSH_REF), size: BRUSH_REF });
    brushLibrary.push({ name: 'Stipple', mask: makeStipple(BRUSH_REF), size: BRUSH_REF });
    brushLibrary.push({ name: 'Rake', mask: makeRake(BRUSH_REF), size: BRUSH_REF });
    brushLibrary.push({ name: 'Dry Brush', mask: makeDryBrush(BRUSH_REF), size: BRUSH_REF });
    brushLibrary.push({ name: 'Charcoal', mask: makeCharcoal(BRUSH_REF), size: BRUSH_REF });
    brushLibrary.push({ name: 'Fan', mask: makeFan(BRUSH_REF), size: BRUSH_REF });
  }

  function makeRoundSoft(s) {
    const m = new Float32Array(s * s);
    const c = s / 2;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c)) / c;
      m[y * s + x] = Math.max(0, 1 - d * d);
    }
    return m;
  }

  function makeRoundHard(s) {
    const m = new Float32Array(s * s);
    const c = s / 2, r = c - 1;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c));
      m[y * s + x] = d <= r ? 1 : Math.max(0, 1 - (d - r));
    }
    return m;
  }

  function makeFlat(s) {
    const m = new Float32Array(s * s);
    const c = s / 2, hw = s * 0.45, hh = s * 0.15;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = Math.abs(x - c) / hw, dy = Math.abs(y - c) / hh;
      const d = Math.max(dx, dy);
      m[y * s + x] = d <= 1 ? Math.max(0, 1 - (d - 0.8) * 5) : 0;
    }
    return m;
  }

  function makeSplatter(s) {
    const m = new Float32Array(s * s);
    const c = s / 2;
    // Seeded random for reproducibility
    let seed = 12345;
    const rng = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };
    // Place random dots
    const dots = [];
    for (let i = 0; i < 40; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = rng() * c * 0.9;
      dots.push({ x: c + Math.cos(angle) * dist, y: c + Math.sin(angle) * dist, r: rng() * 4 + 1 });
    }
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      let val = 0;
      for (const dot of dots) {
        const d = Math.sqrt((x - dot.x) * (x - dot.x) + (y - dot.y) * (y - dot.y));
        if (d < dot.r) val = Math.max(val, 1 - d / dot.r);
      }
      m[y * s + x] = val;
    }
    return m;
  }

  function makeNoise(s) {
    const m = new Float32Array(s * s);
    const c = s / 2;
    let seed = 54321;
    const rng = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c)) / c;
      const circle = Math.max(0, 1 - d);
      m[y * s + x] = circle * (rng() * 0.7 + 0.3);
    }
    return m;
  }

  function makeStipple(s) {
    const m = new Float32Array(s * s);
    const c = s / 2, dotSpacing = 6;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c)) / c;
      if (d > 1) continue;
      const gx = x % dotSpacing, gy = y % dotSpacing;
      const dd = Math.sqrt((gx - dotSpacing / 2) * (gx - dotSpacing / 2) + (gy - dotSpacing / 2) * (gy - dotSpacing / 2));
      if (dd < dotSpacing * 0.3) m[y * s + x] = (1 - d) * (1 - dd / (dotSpacing * 0.3));
    }
    return m;
  }

  function makeRake(s) {
    const m = new Float32Array(s * s);
    const c = s / 2, tines = 5, gap = s / (tines + 1);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c)) / c;
      if (d > 1) continue;
      // Vertical tines
      let tineVal = 0;
      for (let t = 1; t <= tines; t++) {
        const tx = t * gap;
        const dist = Math.abs(x - tx);
        if (dist < gap * 0.25) tineVal = Math.max(tineVal, 1 - dist / (gap * 0.25));
      }
      m[y * s + x] = tineVal * (1 - d * 0.5);
    }
    return m;
  }

  function makeDryBrush(s) {
    const m = new Float32Array(s * s);
    const c = s / 2;
    let seed = 99999;
    const rng = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c)) / c;
      if (d > 1) continue;
      const edge = 1 - d;
      const noise = rng();
      // Streaky horizontal pattern
      const streak = Math.sin(y * 0.8 + rng() * 2) * 0.3 + 0.7;
      m[y * s + x] = edge * (noise > 0.3 ? streak : 0);
    }
    return m;
  }

  function makeCharcoal(s) {
    const m = new Float32Array(s * s);
    const c = s / 2;
    let seed = 77777;
    const rng = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c)) / c;
      if (d > 1) continue;
      const edge = Math.max(0, 1 - d * 1.2);
      const texture = rng() > 0.15 ? 1 : 0;
      const grain = 0.5 + rng() * 0.5;
      m[y * s + x] = edge * texture * grain;
    }
    return m;
  }

  function makeFan(s) {
    const m = new Float32Array(s * s);
    const c = s / 2, fanWidth = Math.PI * 0.6;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = x - c, dy = y - c;
      const d = Math.sqrt(dx * dx + dy * dy) / c;
      if (d > 1 || d < 0.2) continue;
      const angle = Math.atan2(dy, dx);
      // Fan shape: spread across a wide arc
      if (Math.abs(angle) < fanWidth) {
        const angFalloff = 1 - Math.abs(angle) / fanWidth;
        const radFalloff = 1 - Math.abs(d - 0.6) / 0.4;
        m[y * s + x] = Math.max(0, angFalloff * radFalloff);
      }
    }
    return m;
  }

  // ── Mask Utilities ──
  function scaleMask(src, srcSize, dstSize) {
    if (srcSize === dstSize) return new Float32Array(src);
    const dst = new Float32Array(dstSize * dstSize);
    const scale = srcSize / dstSize;
    for (let y = 0; y < dstSize; y++) {
      for (let x = 0; x < dstSize; x++) {
        const sx = x * scale, sy = y * scale;
        const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
        const sx1 = Math.min(sx0 + 1, srcSize - 1), sy1 = Math.min(sy0 + 1, srcSize - 1);
        const fx = sx - sx0, fy = sy - sy0;
        dst[y * dstSize + x] =
          src[sy0 * srcSize + sx0] * (1 - fx) * (1 - fy) +
          src[sy0 * srcSize + sx1] * fx * (1 - fy) +
          src[sy1 * srcSize + sx0] * (1 - fx) * fy +
          src[sy1 * srcSize + sx1] * fx * fy;
      }
    }
    return dst;
  }

  function updateActiveMask() {
    const brush = brushLibrary[selectedBrush];
    if (!brush) return;
    activeMaskSize = Math.max(1, Math.round(size));
    activeMask = scaleMask(brush.mask, brush.size, activeMaskSize);
  }

  // ── Nearest-Neighbor Sampling (preserves dither pattern) ──
  function samplePixel(data, w, h, x, y) {
    const px = Math.max(0, Math.min(Math.round(x), w - 1));
    const py = Math.max(0, Math.min(Math.round(y), h - 1));
    const i = (py * w + px) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  }

  // ── Mask Rotation ──
  function rotateMask(mask, ms, angleDeg) {
    if (Math.abs(angleDeg % 360) < 0.5) return mask;
    const rad = -angleDeg * Math.PI / 180;
    const cosA = Math.cos(rad), sinA = Math.sin(rad);
    const half = ms / 2;
    const out = new Float32Array(ms * ms);
    for (let y = 0; y < ms; y++) {
      for (let x = 0; x < ms; x++) {
        const rx = (x - half) * cosA - (y - half) * sinA + half;
        const ry = (x - half) * sinA + (y - half) * cosA + half;
        const ix = Math.round(rx), iy = Math.round(ry);
        if (ix >= 0 && ix < ms && iy >= 0 && iy < ms) {
          out[y * ms + x] = mask[iy * ms + ix];
        }
      }
    }
    return out;
  }

  // ── Wet Layer ──
  function ensureWetMap() {
    if (!canvas) return;
    if (!wetMap || wetCanvasW !== canvas.width || wetCanvasH !== canvas.height) {
      wetCanvasW = canvas.width; wetCanvasH = canvas.height;
      wetMap = new Float32Array(wetCanvasW * wetCanvasH);
      wetBounds = null;
    }
  }

  function clearWetMap() {
    if (wetMap) wetMap.fill(0);
    wetBounds = null;
  }

  function wetEnabled() {
    return wetDrip > 0 || wetBleed > 0 || wetSmear > 0 || wetSeparate > 0 ||
           wetSort > 0 || wetGlitch > 0 || wetMosaic > 0 || wetWave > 0 ||
           wetShred > 0 || wetEcho > 0 || wetKaleido > 0 || wetVortex > 0 ||
           wetBitcrush > 0;
  }

  // Snapshot of canvas at stroke start, used by Echo (ghost) effect so wet
  // pixels can periodically swap back to the original pre-paint pixel value.
  let wetEchoSnap = null;
  let wetEchoBoundsX = 0, wetEchoBoundsY = 0, wetEchoBoundsW = 0, wetEchoBoundsH = 0;
  // Stroke center for kaleidoscope / vortex
  let wetStrokeCx = 0, wetStrokeCy = 0;

  // Mark pixels under the brush footprint as wet. Wetness adds (clamped to 1)
  // so repeated strokes over the same area remain very wet.
  function markWet(cx, cy, ms) {
    if (!wetMap || !wetEnabled()) return;
    const half = ms / 2;
    const cw = wetCanvasW, ch = wetCanvasH;
    const ax0 = Math.floor(cx - half), ay0 = Math.floor(cy - half);
    let bx0 = Math.max(0, ax0), by0 = Math.max(0, ay0);
    let bx1 = Math.min(cw, ax0 + ms), by1 = Math.min(ch, ay0 + ms);
    if (bx0 >= bx1 || by0 >= by1) return;
    for (let py = by0; py < by1; py++) {
      const my = py - ay0;
      for (let px = bx0; px < bx1; px++) {
        const mx = px - ax0;
        const a = activeMask[my * ms + mx];
        if (a < 0.02) continue;
        const idx = py * cw + px;
        const v = wetMap[idx] + a * 0.9;
        wetMap[idx] = v > 1 ? 1 : v;
      }
    }
    if (!wetBounds) wetBounds = { x0: bx0, y0: by0, x1: bx1, y1: by1 };
    else {
      if (bx0 < wetBounds.x0) wetBounds.x0 = bx0;
      if (by0 < wetBounds.y0) wetBounds.y0 = by0;
      if (bx1 > wetBounds.x1) wetBounds.x1 = bx1;
      if (by1 > wetBounds.y1) wetBounds.y1 = by1;
    }
  }

  // Run one physical-paint evolution pass over the wet bounds.
  //
  // CRISP/DISPLACEMENT-ONLY MODEL:
  //   Every wet pixel either keeps its current color or COPIES the exact
  //   color of a nearby pixel — no blending, no averaging, no interpolation.
  //   This guarantees the dithered palette is preserved: only existing pixel
  //   values appear in the output, never new colors. Drip/bleed/smear/separate
  //   are implemented as probabilistic *swaps* whose probability scales with
  //   wetness × parameter strength.
  function evolveWetLayer() {
    if (!wetMap || !wetBounds || !wetEnabled() || !ctx) return;
    const cw = wetCanvasW, ch = wetCanvasH;
    // Pad bounds by 2 so we can sample neighbors without clamping artifacts
    const x0 = Math.max(0, wetBounds.x0 - 2);
    const y0 = Math.max(0, wetBounds.y0 - 2);
    const x1 = Math.min(cw, wetBounds.x1 + 2);
    const y1 = Math.min(ch, wetBounds.y1 + 2);
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) { wetBounds = null; return; }

    const reg = ctx.getImageData(x0, y0, w, h);
    const sd = reg.data;
    // Working copy: write into `out`, read from `sd`, so a single pass acts
    // simultaneously across the region (avoids cascade artifacts).
    const out = new Uint8ClampedArray(sd);

    const drip      = wetDrip / 100;
    const bleed     = wetBleed / 100;
    const smear     = wetSmear / 100;
    const separate  = wetSeparate / 100;
    const sortP     = wetSort / 100;
    const glitch    = wetGlitch / 100;
    const mosaic    = wetMosaic / 100;
    const mosaicSz  = Math.max(2, wetMosaicSize | 0);
    const wave      = wetWave / 100;
    const waveFreq  = wetWaveFreq / 100; // 0..1
    const shred     = wetShred / 100;
    const echo      = wetEcho / 100;
    const kaleido   = wetKaleido / 100;
    const vortex    = wetVortex / 100;
    const bitcrush  = wetBitcrush / 100;
    const dirX = smoothDirX, dirY = smoothDirY;
    const hasDir = (dirX * dirX + dirY * dirY) > 0.001;
    const lifeN = wetLifetime / 100;
    const decay = Math.pow(0.45 + lifeN * 0.5, 1 / Math.max(1, wetEvolveRate));
    const drySub = (1 - lifeN) * 0.012 + 0.003;
    // Stroke center in region-local coords (for kaleidoscope/vortex)
    const cxL = wetStrokeCx - x0, cyL = wetStrokeCy - y0;

    // Per-frame seed so consecutive passes get fresh randomness but identical
    // pixels in the same pass make consistent decisions
    const frameSeed = (Date.now() & 0xffff) ^ ((wetBounds.x0 << 5) | wetBounds.y0);
    // Cheap deterministic hash → [0,1)
    const rnd = (a, b, c) => {
      let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
      h = (h ^ (h >>> 13)) * 1274126177 | 0;
      h = h ^ (h >>> 16);
      return ((h >>> 0) / 4294967295);
    };

    // Helper: copy pixel from (sx,sy) → out[di] with bounds clamp
    const copyPixel = (di, sx, sy) => {
      if (sx < 0) sx = 0; else if (sx > w - 1) sx = w - 1;
      if (sy < 0) sy = 0; else if (sy > h - 1) sy = h - 1;
      const si = (sy * w + sx) * 4;
      out[di]     = sd[si];
      out[di + 1] = sd[si + 1];
      out[di + 2] = sd[si + 2];
    };

    let nx0 = cw, ny0 = ch, nx1 = 0, ny1 = 0;
    let anyAlive = false;

    for (let y = 0; y < h; y++) {
      const gy = y + y0;
      for (let x = 0; x < w; x++) {
        const gx = x + x0;
        const wi = gy * cw + gx;
        const wet = wetMap[wi];
        if (wet < 0.015) continue;
        const di = (y * w + x) * 4;

        // Source position starts at self — only changes via swaps below.
        // Each operation rolls its own dice so multiple effects can compose
        // (drip + smear can cooperate to drag pixels diagonally, etc.).
        let sx = x, sy = y;
        let swapped = false;

        // DRIP — gravity. Probability scales with drip × wet. When fired,
        // copy color from the pixel directly above. Distance grows with
        // strength (1..2 pixels) so heavy drip falls faster.
        if (drip > 0) {
          const p = drip * wet * 0.85;
          if (rnd(gx, gy, frameSeed) < p) {
            const dStep = drip > 0.6 ? 2 : 1;
            sy -= dStep;
            swapped = true;
          }
        }

        // BLEED — capillary. Pick ONE of the 4 neighbors at random
        // (probability scales with bleed × wet) and swap into it. Because
        // we copy a neighbor's exact color the dither pattern stays crisp
        // — bleed creates "spreading patches" of existing pixel values
        // rather than a soft gradient.
        if (bleed > 0) {
          const p = bleed * wet * 0.7;
          if (rnd(gx + 1, gy, frameSeed) < p) {
            const r4 = (rnd(gx, gy + 1, frameSeed) * 4) | 0;
            const ddx = r4 === 0 ? 1 : r4 === 1 ? -1 : 0;
            const ddy = r4 === 2 ? 1 : r4 === 3 ? -1 : 0;
            sx += ddx; sy += ddy;
            swapped = true;
          }
        }

        // SMEAR — continued drag along stroke. Stronger probability and
        // larger step than drip so smear feels deliberate.
        if (smear > 0 && hasDir) {
          const p = smear * wet * 1.0;
          if (rnd(gx, gy + 2, frameSeed) < p) {
            const stepN = 1 + (smear * 2) | 0; // 1..3 px upstream
            sx -= Math.round(dirX * stepN);
            sy -= Math.round(dirY * stepN);
            swapped = true;
          }
        }

        // SEPARATE — paint splitting via crisp picking. Compare brightness
        // of two opposite perpendicular neighbors; pick the one whose
        // brightness is FURTHER from this pixel's brightness (amplifies
        // contrast). No averaging — the chosen neighbor's exact color
        // replaces this pixel.
        if (separate > 0) {
          const p = separate * wet * 0.65;
          if (rnd(gx + 3, gy, frameSeed) < p) {
            let pX, pY;
            if (hasDir) { pX = -dirY; pY = dirX; }
            else { pX = 1; pY = 0; }
            const a1x = x + Math.round(pX), a1y = y + Math.round(pY);
            const a2x = x - Math.round(pX), a2y = y - Math.round(pY);
            const inB1 = a1x >= 0 && a1x < w && a1y >= 0 && a1y < h;
            const inB2 = a2x >= 0 && a2x < w && a2y >= 0 && a2y < h;
            if (inB1 || inB2) {
              const sLum = sd[di] * 0.299 + sd[di+1] * 0.587 + sd[di+2] * 0.114;
              let pickX = sx, pickY = sy, bestDelta = -1;
              if (inB1) {
                const i1 = (a1y * w + a1x) * 4;
                const l1 = sd[i1] * 0.299 + sd[i1+1] * 0.587 + sd[i1+2] * 0.114;
                const d1 = Math.abs(l1 - sLum);
                if (d1 > bestDelta) { bestDelta = d1; pickX = a1x; pickY = a1y; }
              }
              if (inB2) {
                const i2 = (a2y * w + a2x) * 4;
                const l2 = sd[i2] * 0.299 + sd[i2+1] * 0.587 + sd[i2+2] * 0.114;
                const d2 = Math.abs(l2 - sLum);
                if (d2 > bestDelta) { bestDelta = d2; pickX = a2x; pickY = a2y; }
              }
              sx = pickX; sy = pickY;
              swapped = true;
            }
          }
        }

        // PIXEL SORT — datamosh-style. Compare luminance of self and the
        // next pixel in stroke direction; if probability fires AND order is
        // wrong (depending on direction sign), swap their positions. Over
        // many frames this gradually sorts wet pixels along the stroke axis.
        if (sortP > 0 && hasDir) {
          const p = sortP * wet * 0.95;
          if (rnd(gx + 5, gy + 7, frameSeed) < p) {
            const stepX = Math.round(dirX);
            const stepY = Math.round(dirY);
            const nx = x + stepX, ny = y + stepY;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const ni = (ny * w + nx) * 4;
              const lA = sd[di] * 0.299 + sd[di+1] * 0.587 + sd[di+2] * 0.114;
              const lB = sd[ni] * 0.299 + sd[ni+1] * 0.587 + sd[ni+2] * 0.114;
              if (lA > lB) { sx = nx; sy = ny; swapped = true; }
            }
          }
        }

        // GLITCH — RGB channel separation. Each color channel may be
        // independently displaced from a neighbor pixel, producing crisp
        // RGB-fringe glitches. Channels stay quantized to source values.
        if (glitch > 0) {
          const p = glitch * wet * 0.6;
          // Roll for each channel
          if (rnd(gx + 11, gy + 13, frameSeed) < p) {
            const off = 1 + (glitch * 6) | 0;
            const rx = x + (hasDir ? Math.round(-dirX * off) : -off);
            const ry = y + (hasDir ? Math.round(-dirY * off) : 0);
            const cx2 = rx < 0 ? 0 : rx > w - 1 ? w - 1 : rx;
            const cy2 = ry < 0 ? 0 : ry > h - 1 ? h - 1 : ry;
            const ci = (cy2 * w + cx2) * 4;
            out[di] = sd[ci];           // R from displaced position
            // Keep current G, take B from opposite displacement
            const bx = x + (hasDir ? Math.round(dirX * off) : off);
            const by = y + (hasDir ? Math.round(dirY * off) : 0);
            const cx3 = bx < 0 ? 0 : bx > w - 1 ? w - 1 : bx;
            const cy3 = by < 0 ? 0 : by > h - 1 ? h - 1 : by;
            const bi = (cy3 * w + cx3) * 4;
            out[di + 1] = sd[di + 1];   // G stays
            out[di + 2] = sd[bi + 2];   // B from opposite
            // Skip the regular swap since we wrote channels directly
            swapped = false;
            // Mark as written (reuse sx==-1 sentinel via flag)
            wetMap[wi] = wet * decay - drySub;
            if (wetMap[wi] > 0.015) {
              anyAlive = true;
              if (gx     < nx0) nx0 = gx;
              if (gy     < ny0) ny0 = gy;
              if (gx + 1 > nx1) nx1 = gx + 1;
              if (gy + 1 > ny1) ny1 = gy + 1;
            } else { wetMap[wi] = 0; }
            continue; // jump to next pixel; we already wrote out[]
          }
        }

        // MOSAIC — block quantize: snap pixel to its block-anchor color.
        // Within wet area only, every pixel in an N×N block becomes the
        // exact color of the top-left pixel of that block. Probability
        // controls how often the snap fires per pixel per pass.
        if (mosaic > 0) {
          const p = mosaic * wet * 0.85;
          if (rnd(gx + 17, gy + 19, frameSeed) < p) {
            const ax = (gx - (gx % mosaicSz)) - x0;
            const ay = (gy - (gy % mosaicSz)) - y0;
            sx = ax < 0 ? 0 : ax > w - 1 ? w - 1 : ax;
            sy = ay < 0 ? 0 : ay > h - 1 ? h - 1 : ay;
            swapped = true;
          }
        }

        // WAVE — sine-wave perpendicular displacement.
        if (wave > 0) {
          const p = wave * wet * 0.95;
          if (rnd(gx + 23, gy + 29, frameSeed) < p) {
            // Use stroke axis if known, else canvas-x as the parameter
            let alongPos, perpX, perpY;
            if (hasDir) {
              alongPos = gx * dirX + gy * dirY;
              perpX = -dirY; perpY = dirX;
            } else {
              alongPos = gx; perpX = 0; perpY = 1;
            }
            const amp = (wave * 12) | 0; // up to 12 px
            const f = 0.05 + waveFreq * 0.6;
            const off = Math.round(Math.sin(alongPos * f) * amp);
            const tx = x + Math.round(perpX * off);
            const ty = y + Math.round(perpY * off);
            sx = tx < 0 ? 0 : tx > w - 1 ? w - 1 : tx;
            sy = ty < 0 ? 0 : ty > h - 1 ? h - 1 : ty;
            swapped = true;
          }
        }

        // SHRED — VHS-style: pixels in a row all shift by the same random
        // amount. We hash by row-y so all pixels in the same row get the
        // same shift, producing crisp horizontal bars.
        if (shred > 0) {
          const p = shred * wet * 0.85;
          if (rnd(gx + 31, gy + 37, frameSeed) < p) {
            const rowR = rnd(gy, frameSeed, 41) - 0.5;
            const rowShift = Math.round(rowR * shred * 30);
            const tx = x + rowShift;
            sx = tx < 0 ? 0 : tx > w - 1 ? w - 1 : tx;
            swapped = true;
          }
        }

        // ECHO — ghost of original (pre-wet) canvas peeks through.
        // wetEchoSnap holds the canvas right before this stroke started;
        // probability swaps the wet pixel back to its original color,
        // creating crisp ghost trails.
        if (echo > 0 && wetEchoSnap) {
          const p = echo * wet * 0.7;
          if (rnd(gx + 43, gy + 47, frameSeed) < p) {
            // gx,gy are global canvas coords; wetEchoSnap is full-canvas
            // ImageData with the same dims as canvas
            const ei = (gy * cw + gx) * 4;
            const ed = wetEchoSnap.data;
            out[di]     = ed[ei];
            out[di + 1] = ed[ei + 1];
            out[di + 2] = ed[ei + 2];
            swapped = false;
            // Decay & continue (we wrote out[] directly)
            wetMap[wi] = wet * decay - drySub;
            if (wetMap[wi] > 0.015) {
              anyAlive = true;
              if (gx     < nx0) nx0 = gx;
              if (gy     < ny0) ny0 = gy;
              if (gx + 1 > nx1) nx1 = gx + 1;
              if (gy + 1 > ny1) ny1 = gy + 1;
            } else { wetMap[wi] = 0; }
            continue;
          }
        }

        // KALEIDOSCOPE — radial mirror around stroke center. Reflects the
        // pixel through angular sectors so the stroke produces a symmetric
        // crisp pattern. Each sector samples from sector 0 of the wet area.
        if (kaleido > 0) {
          const p = kaleido * wet * 0.9;
          if (rnd(gx + 53, gy + 59, frameSeed) < p) {
            const rdx = x - cxL, rdy = y - cyL;
            const rDist = Math.sqrt(rdx * rdx + rdy * rdy);
            if (rDist > 0.5) {
              let ang = Math.atan2(rdy, rdx);
              const nSec = 2 + Math.round(kaleido * 10); // 2..12 sectors
              const sec = (Math.PI * 2) / nSec;
              ang = Math.abs(((ang + Math.PI) % sec) - sec * 0.5);
              const tx = Math.round(cxL + Math.cos(ang) * rDist);
              const ty = Math.round(cyL + Math.sin(ang) * rDist);
              sx = tx < 0 ? 0 : tx > w - 1 ? w - 1 : tx;
              sy = ty < 0 ? 0 : ty > h - 1 ? h - 1 : ty;
              swapped = true;
            }
          }
        }

        // VORTEX — swirl around stroke center. Wet pixels rotate around the
        // current stamp center; angle scales with distance for spiral.
        if (vortex > 0) {
          const p = vortex * wet * 0.95;
          if (rnd(gx + 67, gy + 71, frameSeed) < p) {
            const rdx = x - cxL, rdy = y - cyL;
            const rDist = Math.sqrt(rdx * rdx + rdy * rdy);
            if (rDist > 0.5) {
              const ang = vortex * 0.6 * (1 - Math.min(1, rDist / 50));
              const cosA = Math.cos(ang), sinA = Math.sin(ang);
              const tx = Math.round(cxL + (rdx * cosA - rdy * sinA));
              const ty = Math.round(cyL + (rdx * sinA + rdy * cosA));
              sx = tx < 0 ? 0 : tx > w - 1 ? w - 1 : tx;
              sy = ty < 0 ? 0 : ty > h - 1 ? h - 1 : ty;
              swapped = true;
            }
          }
        }

        // BITCRUSH — quantize pixel coordinates to a coarser grid then
        // sample. Effectively a coarse mosaic but with a different grid
        // alignment per channel for chromatic crunch.
        if (bitcrush > 0) {
          const p = bitcrush * wet * 0.9;
          if (rnd(gx + 73, gy + 79, frameSeed) < p) {
            const bits = 1 + Math.round(bitcrush * 4); // 1..5
            const mask = ~((1 << bits) - 1);
            const tx = (x & mask);
            const ty = (y & mask);
            sx = tx < 0 ? 0 : tx > w - 1 ? w - 1 : tx;
            sy = ty < 0 ? 0 : ty > h - 1 ? h - 1 : ty;
            swapped = true;
          }
        }

        if (swapped) copyPixel(di, sx, sy);

        const newWet = wet * decay - drySub;
        if (newWet > 0.015) {
          wetMap[wi] = newWet;
          anyAlive = true;
          if (gx     < nx0) nx0 = gx;
          if (gy     < ny0) ny0 = gy;
          if (gx + 1 > nx1) nx1 = gx + 1;
          if (gy + 1 > ny1) ny1 = gy + 1;
        } else {
          wetMap[wi] = 0;
        }
      }
    }

    reg.data.set(out);
    ctx.putImageData(reg, x0, y0);
    wetBounds = anyAlive ? { x0: nx0, y0: ny0, x1: nx1, y1: ny1 } : null;
  }

  // Run the wet evolution multiple sub-iterations per stamp to keep motion
  // smooth even at low spacing / fast strokes.
  function stepWetLayer() {
    if (!wetEnabled()) return;
    const iters = Math.max(1, Math.min(4, wetEvolveRate | 0));
    for (let i = 0; i < iters; i++) evolveWetLayer();
  }

  // Mask power-shape: amplifies brush-mask contrast so the brush *shape*
  // dominates per-pixel displacement amplitude. Returns a value in 0..1.
  function shapedMask(a) {
    const p = 1 + (shapeInfluence / 100); // 1..4
    return Math.pow(a, p);
  }

  // ── Stamp Application ──
  function applyStamp(cx, cy) {
    if (!activeMask || !canvas) return;

    // ── Pen-input modulation ──
    // Raw pressure (pen-driven only; mouse/touch get neutral 1)
    const pRaw = pressureActive ? currentPressure : 1;
    // Pressure response curve (1 = linear; <1 = soft/sensitive; >1 = hard)
    const pmul = (pressureCurve === 1 || !pressureActive) ? pRaw : Math.pow(pRaw, pressureCurve);

    // Size: pressure base × optional velocity shrink × optional tilt growth
    let sizeMul = pressureSizeEnabled ? (pressureSizeMin + (1 - pressureSizeMin) * pmul) : 1;
    if (velocityEnabled && pressureActive && currentVelocity > 0) {
      // Velocity normalized: 2 px/ms is "fast" — reduce size up to influence
      const vN = Math.min(1, currentVelocity / 2);
      sizeMul *= Math.max(0.05, 1 - vN * velocitySizeInfluence);
    }
    // Tilt magnitude: 0 (vertical pen) .. 1 (fully flat, ~60deg tilt)
    let tiltMag = 0;
    if (tiltEnabled && pressureActive && (currentTiltX !== 0 || currentTiltY !== 0)) {
      tiltMag = Math.min(1, Math.sqrt(currentTiltX * currentTiltX + currentTiltY * currentTiltY) / 60);
      // Tilting grows the brush footprint (rake): flat pen covers more
      sizeMul *= (1 + tiltMag * tiltSizeInfluence);
    }

    // Opacity: pressure-modulated
    const opaMul = pressureOpacityEnabled ? (pressureOpacityMin + (1 - pressureOpacityMin) * pmul) : 1;
    // Strength: pressure-modulated
    const strengthMul = (pressureStrengthEnabled && pressureActive)
      ? (pressureStrengthMin + (1 - pressureStrengthMin) * pmul)
      : 1;

    const _savedPreMask = activeMask;
    const _savedPreMaskSize = activeMaskSize;
    // Rescale the mask by sizeMul (rounded to integer size, cached)
    if (Math.abs(sizeMul - 1) > 0.01) {
      const newSize = Math.max(1, Math.round(activeMaskSize * sizeMul));
      if (newSize !== activeMaskSize) {
        let m = null;
        if (_pressureMaskCache.size === newSize && _pressureMaskCache.brush === selectedBrush && _pressureMaskCache.mask) {
          m = _pressureMaskCache.mask;
        } else {
          const brush = brushLibrary[selectedBrush];
          if (brush) {
            m = scaleMask(brush.mask, brush.size, newSize);
            _pressureMaskCache = { size: newSize, mask: m, brush: selectedBrush };
          }
        }
        if (m) {
          activeMask = m;
          activeMaskSize = newSize;
        }
      }
    }

    const ms = activeMaskSize;
    const half = ms / 2;

    // Compute stroke direction from previous stamp
    const ddx = cx - prevStampX, ddy = cy - prevStampY;
    const ddLen = Math.sqrt(ddx * ddx + ddy * ddy);
    if (ddLen > 0.1) {
      strokeDirX = ddx / ddLen;
      strokeDirY = ddy / ddLen;
      // Smoothed direction (exponential moving average) — ribbons stay
      // stable when the user wiggles
      const sm = 0.35;
      smoothDirX = smoothDirX * (1 - sm) + strokeDirX * sm;
      smoothDirY = smoothDirY * (1 - sm) + strokeDirY * sm;
      // Advance ribbon u-coordinate by canvas distance traveled
      pickupStrokeDist += ddLen;
    }
    prevStampX = cx; prevStampY = cy;

    // Apply brush rotation (manual angle + follow direction + tilt + twist)
    let effectiveAngle = brushAngle;
    if (followDirection && (Math.abs(strokeDirX) > 0.01 || Math.abs(strokeDirY) > 0.01)) {
      effectiveAngle += Math.atan2(strokeDirY, strokeDirX) * 180 / Math.PI;
    }
    // Tilt direction: which way the pen is leaning → rake the brush that way
    if (tiltEnabled && pressureActive && (currentTiltX !== 0 || currentTiltY !== 0)) {
      const tiltDir = Math.atan2(currentTiltY, currentTiltX) * 180 / Math.PI;
      effectiveAngle += tiltDir * tiltAngleInfluence;
    }
    // Barrel twist: pen rotation about its own axis → rotates the brush
    if (twistEnabled && pressureActive && currentTwist !== 0) {
      effectiveAngle += currentTwist * twistInfluence;
    }
    const savedMask = activeMask;
    if (Math.abs(effectiveAngle % 360) > 0.5) {
      activeMask = rotateMask(savedMask, ms, effectiveAngle);
    }

    // Compute canvas-space bounding box for the brush
    let margin = tool === 'push' || tool === 'liquify' ? pushDistance :
                 tool === 'scatter' ? scatterRadius :
                 tool === 'spread' ? spreadAmount :
                 tool === 'blend' ? blendKernel : 0;
    let brushHalfW = half, brushHalfH = half;
    if (tool === 'pickup' && pickupStamp) {
      brushHalfW = Math.max(half, pickupStamp.w / 2);
      brushHalfH = Math.max(half, pickupStamp.h / 2);
    }
    const rx0 = Math.max(0, Math.floor(cx - brushHalfW - margin));
    const ry0 = Math.max(0, Math.floor(cy - brushHalfH - margin));
    const rx1 = Math.min(canvas.width, Math.ceil(cx + brushHalfW + margin));
    const ry1 = Math.min(canvas.height, Math.ceil(cy + brushHalfH + margin));
    const rw = rx1 - rx0, rh = ry1 - ry0;
    if (rw <= 0 || rh <= 0) { activeMask = savedMask; return; }

    // Read source pixels (current canvas state)
    const srcData = ctx.getImageData(rx0, ry0, rw, rh);
    const src = srcData.data;

    // Output: start with copy of source
    const dstData = ctx.createImageData(rw, rh);
    dstData.data.set(src);
    const dst = dstData.data;

    // Brush area in read-buffer space
    const bx0 = Math.floor(cx - half) - rx0;
    const by0 = Math.floor(cy - half) - ry0;
    const bcx = cx - rx0, bcy = cy - ry0;

    strokeStampCount++;
    const taperMul = getTaperMultiplier();
    const str = (strength / 100) * strengthMul;
    const opa = (opacity / 100) * (taperOpacity ? taperMul : 1) * opaMul;

    switch (tool) {
      case 'smudge':  stampSmudge(src, dst, rw, rh, bcx, bcy, bx0, by0, ms, str * opa); break;
      case 'push':    stampPush(src, dst, rw, rh, bcx, bcy, bx0, by0, ms, str * opa); break;
      case 'scatter':  stampScatter(src, dst, rw, rh, bcx, bcy, bx0, by0, ms, str * opa); break;
      case 'swirl':   stampSwirl(src, dst, rw, rh, bcx, bcy, bx0, by0, ms, str * opa); break;
      case 'liquify': stampLiquify(src, dst, rw, rh, bcx, bcy, bx0, by0, ms, str * opa); break;
      case 'blend':   stampBlend(src, dst, rw, rh, bcx, bcy, bx0, by0, ms, str * opa); break;
      case 'spread':  stampSpread(src, dst, rw, rh, bcx, bcy, bx0, by0, ms, str * opa); break;
      case 'pickup':  stampPickup(src, dst, rw, rh, bcx, bcy, bx0, by0, ms, str * opa); break;
    }

    ctx.putImageData(dstData, rx0, ry0);
    activeMask = savedMask;
    // Restore pre-pressure mask (outer layer)
    activeMask = _savedPreMask;
    activeMaskSize = _savedPreMaskSize;

    // Live wet-layer: mark the just-stamped footprint as wet, then evolve
    // the entire wet region (so previously-painted pixels keep changing —
    // dripping, bleeding, smearing — as the stroke continues).
    if (wetEnabled()) {
      // Track stroke-current center for kaleidoscope / vortex effects so
      // their symmetry origin follows the brush.
      wetStrokeCx = cx; wetStrokeCy = cy;
      ensureWetMap();
      markWet(cx, cy, ms);
      stepWetLayer();
    }
  }

  // ── Tool: Smudge ──
  // CRISP smudge: instead of color-averaging the pickup buffer with the
  // canvas (which created blended intermediate colors and destroyed the
  // dither pattern), the pickup buffer is now treated as a STORE OF
  // DISCRETE PIXEL VALUES being carried by the brush.
  //
  // At each stamp:
  //   1. With probability ~ shapedMask, the output pixel is REPLACED by
  //      the pickup-buffer pixel (no blending).
  //   2. With probability ~ (1 - decay), the pickup buffer at this slot
  //      is REPLACED by the current canvas pixel (no averaging).
  //
  // Decay = 1 → buffer never refreshes → pure long smear of original
  // sampled pixels. Decay = 0 → buffer refreshes every stamp → very short
  // smear. All values stay crisp source-palette colors.
  function stampSmudge(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    if (!hasPickup) return;
    const decay = smudgeDecay / 100;
    const stampSeed = (strokeStampCount * 2654435761) | 0;
    const rnd = (a, b) => {
      let h2 = (a * 374761393 + b * 668265263 + stampSeed) | 0;
      h2 = (h2 ^ (h2 >>> 13)) * 1274126177 | 0;
      h2 = h2 ^ (h2 >>> 16);
      return ((h2 >>> 0) / 4294967295);
    };

    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const m0 = activeMask[my * ms + mx];
        if (m0 < 0.01) continue;
        const a = shapedMask(m0) * alpha;
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const idx = (py * w + px) * 4;
        const mi = my * ms + mx;

        // 1. Probabilistic placement of carried pixel onto canvas (crisp)
        if (rnd(mx, my) < a) {
          dst[idx]     = pickupR[mi] | 0;
          dst[idx + 1] = pickupG[mi] | 0;
          dst[idx + 2] = pickupB[mi] | 0;
        }
        // 2. Probabilistic refresh of pickup buffer with canvas pixel
        if (rnd(mx + 991, my + 743) > decay) {
          pickupR[mi] = src[idx];
          pickupG[mi] = src[idx + 1];
          pickupB[mi] = src[idx + 2];
        }
      }
    }
  }

  function initPickup(cx, cy) {
    const ms = activeMaskSize;
    pickupR = new Float32Array(ms * ms);
    pickupG = new Float32Array(ms * ms);
    pickupB = new Float32Array(ms * ms);
    const half = ms / 2;
    const imgData = ctx.getImageData(
      Math.max(0, Math.floor(cx - half)),
      Math.max(0, Math.floor(cy - half)),
      Math.min(canvas.width - Math.max(0, Math.floor(cx - half)), ms),
      Math.min(canvas.height - Math.max(0, Math.floor(cy - half)), ms)
    );
    const d = imgData.data, iw = imgData.width, ih = imgData.height;
    for (let y = 0; y < ih && y < ms; y++) {
      for (let x = 0; x < iw && x < ms; x++) {
        const si = (y * iw + x) * 4;
        const mi = y * ms + x;
        pickupR[mi] = d[si];
        pickupG[mi] = d[si + 1];
        pickupB[mi] = d[si + 2];
      }
    }
    hasPickup = true;
  }

  // ── Tool: Push ──
  function stampPush(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    const nx = strokeDirX, ny = strokeDirY;
    if (Math.abs(nx) < 0.01 && Math.abs(ny) < 0.01) return;
    const dist = pushDistance * alpha;

    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const m0 = activeMask[my * ms + mx];
        if (m0 < 0.01) continue;
        // Per-pixel push amount obeys the brush mask shape — a splatter
        // brush makes scattered displacement, a flat brush makes a clean
        // wedge. Power-shaping makes the contrast much stronger.
        const a = shapedMask(m0);
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;

        const srcX = px - nx * dist * a;
        const srcY = py - ny * dist * a;
        const [r, g, b] = samplePixel(src, w, h, srcX, srcY);
        const idx = (py * w + px) * 4;
        dst[idx]     = Math.round(r);
        dst[idx + 1] = Math.round(g);
        dst[idx + 2] = Math.round(b);
      }
    }
  }

  // ── Tool: Scatter ──
  function stampScatter(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    const rad = scatterRadius * alpha;
    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const m0 = activeMask[my * ms + mx];
        if (m0 < 0.01) continue;
        // Brush mask amplifies/suppresses scatter intensity per pixel —
        // sparse-mask brushes (stipple, splatter) produce sparser scatter.
        const a = shapedMask(m0);
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;

        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * rad * a;
        const srcX = px + Math.cos(angle) * dist;
        const srcY = py + Math.sin(angle) * dist;
        const [r, g, b] = samplePixel(src, w, h, srcX, srcY);
        const idx = (py * w + px) * 4;
        dst[idx]     = Math.round(r);
        dst[idx + 1] = Math.round(g);
        dst[idx + 2] = Math.round(b);
      }
    }
  }

  // ── Tool: Swirl ──
  function stampSwirl(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    const angleRad = swirlAngle * Math.PI / 180 * alpha;
    const half = ms / 2;
    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const m0 = activeMask[my * ms + mx];
        if (m0 < 0.01) continue;
        const a = shapedMask(m0);
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;

        const relX = mx - half, relY = my - half;
        const d = Math.sqrt(relX * relX + relY * relY) / half;
        if (d > 1) continue;
        const ang = angleRad * a * (1 - d);
        const cosA = Math.cos(ang), sinA = Math.sin(ang);
        const srcX = cx + relX * cosA - relY * sinA;
        const srcY = cy + relX * sinA + relY * cosA;
        const [r, g, b] = samplePixel(src, w, h, srcX, srcY);
        const idx = (py * w + px) * 4;
        dst[idx]     = Math.round(r);
        dst[idx + 1] = Math.round(g);
        dst[idx + 2] = Math.round(b);
      }
    }
  }

  // ── Tool: Liquify ──
  function stampLiquify(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    const nx = strokeDirX, ny = strokeDirY;
    if (Math.abs(nx) < 0.01 && Math.abs(ny) < 0.01) return;
    const dist = pushDistance * alpha;
    const half = ms / 2;

    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const m0 = activeMask[my * ms + mx];
        if (m0 < 0.01) continue;
        const a = shapedMask(m0);
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;

        const relX = mx - half, relY = my - half;
        const d = Math.sqrt(relX * relX + relY * relY) / half;
        if (d > 1) continue;
        const falloff = Math.pow(1 - d, liquifySmooth + 0.5);
        const warp = a * falloff;
        const srcX = px - nx * dist * warp;
        const srcY = py - ny * dist * warp;
        const [r, g, b] = samplePixel(src, w, h, srcX, srcY);
        const idx = (py * w + px) * 4;
        dst[idx]     = Math.round(r);
        dst[idx + 1] = Math.round(g);
        dst[idx + 2] = Math.round(b);
      }
    }
  }

  // ── Tool: Blend (CRISP — kernel pixel pick, no averaging) ──
  // Replaces the old neighborhood averaging (which produced blurry
  // intermediate colors and destroyed the dither pattern) with a CRISP
  // kernel-pick: the output pixel is REPLACED with one specific pixel
  // from the kernel chosen by the active blend mode. All output values
  // come from the source palette so dither stays sharp.
  //
  // Modes (set via setBlendMode):
  //   median   — kernel pixel with median luminance (natural-feeling)
  //   mode     — most-frequent color in kernel (true crisp posterize)
  //   dilate   — brightest pixel (highlights expand into mids)
  //   erode    — darkest pixel (shadows expand)
  //   sort     — kernel sorted by luminance, picked by mask value (banding)
  //   closest  — kernel pixel closest in color to current (sharpens edges)
  //   farthest — kernel pixel farthest in color (extreme contrast pump)
  //   random   — random kernel pixel (crisp scatter / shuffle)
  function stampBlend(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    const kr = blendKernel | 0;
    const mode = blendMode || 'median';
    const stampSeed = (strokeStampCount * 2654435761) | 0;
    const rnd = (a, b) => {
      let h2 = (a * 374761393 + b * 668265263 + stampSeed) | 0;
      h2 = (h2 ^ (h2 >>> 13)) * 1274126177 | 0;
      h2 = h2 ^ (h2 >>> 16);
      return ((h2 >>> 0) / 4294967295);
    };

    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const m0 = activeMask[my * ms + mx];
        if (m0 < 0.01) continue;
        const a = shapedMask(m0) * alpha;
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const idx = (py * w + px) * 4;

        // Probabilistic gating — keeps low-mask regions of the brush
        // crisp / unmodified rather than uniformly applying the effect.
        if (rnd(mx, my) > a) continue;

        let pickIdx = -1;

        if (mode === 'median' || mode === 'sort') {
          const lums = [];
          const idxs = [];
          for (let ky = -kr; ky <= kr; ky++) {
            for (let kx = -kr; kx <= kr; kx++) {
              const sx = px + kx, sy = py + ky;
              if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
              const si = (sy * w + sx) * 4;
              lums.push(src[si] * 0.299 + src[si+1] * 0.587 + src[si+2] * 0.114);
              idxs.push(si);
            }
          }
          if (lums.length === 0) continue;
          const order = idxs.map((_, i) => i).sort((A, B) => lums[A] - lums[B]);
          let pick;
          if (mode === 'median') {
            pick = order[order.length >> 1];
          } else { // sort
            const t = m0 < 0 ? 0 : m0 > 0.999 ? 0.999 : m0;
            pick = order[(t * order.length) | 0];
          }
          pickIdx = idxs[pick];
        } else if (mode === 'mode') {
          const counts = new Map();
          let bestCnt = 0, bestI = -1;
          for (let ky = -kr; ky <= kr; ky++) {
            for (let kx = -kr; kx <= kr; kx++) {
              const sx = px + kx, sy = py + ky;
              if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
              const si = (sy * w + sx) * 4;
              const key = (src[si] << 16) | (src[si+1] << 8) | src[si+2];
              const c = (counts.get(key) || 0) + 1;
              counts.set(key, c);
              if (c > bestCnt) { bestCnt = c; bestI = si; }
            }
          }
          pickIdx = bestI;
        } else if (mode === 'dilate' || mode === 'erode') {
          let bestL = mode === 'dilate' ? -1 : 99999;
          for (let ky = -kr; ky <= kr; ky++) {
            for (let kx = -kr; kx <= kr; kx++) {
              const sx = px + kx, sy = py + ky;
              if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
              const si = (sy * w + sx) * 4;
              const l = src[si] * 0.299 + src[si+1] * 0.587 + src[si+2] * 0.114;
              if (mode === 'dilate' ? (l > bestL) : (l < bestL)) {
                bestL = l; pickIdx = si;
              }
            }
          }
        } else if (mode === 'closest' || mode === 'farthest') {
          const cR = src[idx], cG = src[idx+1], cB = src[idx+2];
          let bestD = mode === 'closest' ? 99999 : -1;
          for (let ky = -kr; ky <= kr; ky++) {
            for (let kx = -kr; kx <= kr; kx++) {
              const sx = px + kx, sy = py + ky;
              if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
              if (kx === 0 && ky === 0) continue;
              const si = (sy * w + sx) * 4;
              const dr = src[si] - cR, dg = src[si+1] - cG, db = src[si+2] - cB;
              const d = dr*dr + dg*dg + db*db;
              if (mode === 'closest' ? (d < bestD) : (d > bestD)) {
                bestD = d; pickIdx = si;
              }
            }
          }
        } else { // 'random'
          const xR = (px + ((rnd(mx + 5, my + 7) - 0.5) * (kr * 2 + 1))) | 0;
          const yR = (py + ((rnd(mx + 13, my + 17) - 0.5) * (kr * 2 + 1))) | 0;
          const sx = xR < 0 ? 0 : xR >= w ? w - 1 : xR;
          const sy = yR < 0 ? 0 : yR >= h ? h - 1 : yR;
          pickIdx = (sy * w + sx) * 4;
        }

        if (pickIdx < 0) continue;
        // Crisp replacement — exact source pixel value, no blending
        dst[idx]     = src[pickIdx];
        dst[idx + 1] = src[pickIdx + 1];
        dst[idx + 2] = src[pickIdx + 2];
      }
    }
  }

  // ── Tool: Spread ──
  function stampSpread(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    const nx = strokeDirX, ny = strokeDirY;
    if (Math.abs(nx) < 0.01 && Math.abs(ny) < 0.01) return;
    const amt = spreadAmount * alpha;
    const half = ms / 2;

    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const m0 = activeMask[my * ms + mx];
        if (m0 < 0.01) continue;
        const a = shapedMask(m0);
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;

        const relX = mx - half, relY = my - half;
        // Project onto stroke direction
        const proj = relX * nx + relY * ny;
        const srcX = px - nx * proj * amt / 100 * a;
        const srcY = py - ny * proj * amt / 100 * a;
        const [r, g, b] = samplePixel(src, w, h, srcX, srcY);
        const idx = (py * w + px) * 4;
        dst[idx]     = Math.round(r);
        dst[idx + 1] = Math.round(g);
        dst[idx + 2] = Math.round(b);
      }
    }
  }

  // ── Tool: Pickup (live dynamic pixel brush) ──
  // The captured stamp is a source texture — when painting, each pixel in the
  // brush footprint samples from the stamp at a randomized offset, creating
  // organic strokes that carry the image's dithered texture.
  let _pickupRng = null;

  function capturePickupStamp(x, y, w, h) {
    if (!canvas || !ctx) return;
    const cx = Math.max(0, Math.round(x));
    const cy = Math.max(0, Math.round(y));
    const cw = Math.min(Math.round(w), canvas.width - cx);
    const ch = Math.min(Math.round(h), canvas.height - cy);
    if (cw <= 0 || ch <= 0) return;
    pickupStamp = {
      data: ctx.getImageData(cx, cy, cw, ch),
      w: cw, h: ch
    };
    hasPickupStamp = true;
  }

  function hasStamp() { return hasPickupStamp; }
  function getStampSize() { return pickupStamp ? { w: pickupStamp.w, h: pickupStamp.h } : null; }

  // Nearest-neighbor texture sample with wrapping. Crisp — preserves
  // every dithered pixel from the source stamp exactly. No interpolation,
  // so the painted output is always one of the source palette values.
  function sampleStampNearest(sd, sw, sh, fx, fy) {
    const x = (((Math.floor(fx) % sw) + sw) % sw);
    const y = (((Math.floor(fy) % sh) + sh) % sh);
    const i = (y * sw + x) * 4;
    return [sd[i], sd[i + 1], sd[i + 2]];
  }
  // Back-compat alias (older code paths)
  const sampleStampBilinear = sampleStampNearest;

  // Build the fiber set for a stroke. Each fiber is an independent painterly
  // streak that runs along the stroke direction. The set is fixed for the
  // duration of the stroke so streaks remain coherent as you drag, but
  // randomized per stroke so each pass looks unique.
  function buildPickupFibers(brushDiameter) {
    if (!pickupStamp) return null;
    const sw = pickupStamp.w, sh = pickupStamp.h;

    // Density: low = sparse visible bristles, high = packed solid coverage.
    // Density also slightly thickens each fiber's perpendicular envelope.
    const density = pickupFiberDensity / 100;
    const baseCount = Math.round(brushDiameter / 6);
    const count = Math.max(4, Math.min(140,
      Math.round(baseCount * (0.4 + density * 3))
    ));

    // Color variety: how much each fiber jumps to a different texture row.
    // 0 = all fibers sample the same row (uniform color), 1 = each fiber
    // pulls from a wildly different part of the texture.
    const variety = pickupColorVariety / 100;
    const sharedTexV = Math.random() * sh;          // fallback row when variety=0
    const sharedTexU = Math.random() * sw;

    if (!_pickupRng) _pickupRng = { s: 42 };
    const rng = () => { _pickupRng.s = (_pickupRng.s * 16807) % 2147483647; return _pickupRng.s / 2147483647; };

    // Flow solidity: high flow = small envelope amplitude (solid lines),
    // low flow = high amplitude (broken/wispy paint dropouts).
    const flow = pickupFiberFlow / 100;
    const envAmpBase = (1 - flow) * 0.6;

    // Wander: how much fibers curve perpendicular to stroke as they travel.
    const wander = pickupFiberWander / 100;

    // Length-stretch baseline. Length=0 → very short streaks (almost stamp),
    // length=1 → long elongated streaks well-mapped to texture.
    const lengthN = pickupFiberLength / 100;

    // Fiber thickness: at high density we can keep them thinner so they
    // remain distinct. At low density, widen them so coverage doesn't
    // get gappy from sparse fibers alone.
    const thicknessBase = (1.0 / count) * (1.0 + (1 - density) * 1.5);

    const fibers = new Array(count);
    for (let i = 0; i < count; i++) {
      // Perpendicular slot with light jitter
      const slot = (i + 0.5) / count * 2 - 1;
      const wobble = (rng() - 0.5) * (1.6 / count);
      // Per-fiber thickness variation
      const halfWidth = thicknessBase * (0.55 + rng() * 1.0);

      // Texture sampling — variety controls how far each fiber strays from
      // the shared row/column.
      const texU = sharedTexU + (rng() - 0.5) * sw * variety;
      const texV = sharedTexV + (rng() - 0.5) * sh * variety;

      fibers[i] = {
        perp: slot + wobble,
        halfWidth,
        texU,
        texV,
        // Slow texture-V drift: subtle organic curve along fiber length.
        // Suppressed when wander is low.
        driftV: (rng() - 0.5) * 0.5 * wander,
        // Length stretch. lengthN=0 → very compressed (~stamp-like).
        // lengthN=1 → strong elongation along stroke.
        lenStretch: 0.2 + rng() * 0.4 + lengthN * (0.6 + rng() * 1.4),
        // Per-fiber paint load
        load: 0.55 + rng() * 0.55,
        // Longitudinal break-up envelope. Amplitude shrinks toward 0 as
        // flow → 1, eliminating dropouts → solid lines.
        envPhase: rng() * Math.PI * 2,
        envFreq: 0.025 + rng() * 0.07,
        envAmp: envAmpBase * (0.5 + rng() * 0.8),
        // Perpendicular wander while traveling along stroke
        wanderAmp: (rng() - 0.5) * 0.18 * wander,
        wanderFreq: 0.04 + rng() * 0.08
      };
    }
    return fibers;
  }

  // Fiber-based pickup engine.
  // Renders multiple distinct painterly streaks within the brush footprint,
  // each elongated along the stroke direction, each pulling from a different
  // part of the captured stamp. As you drag, the fibers carry texture along
  // with them — feels like liquid paint pixels stretching, not stamps.
  function stampPickup(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    if (!hasPickupStamp || !pickupStamp) return;
    if (!pickupFibers) pickupFibers = buildPickupFibers(ms);
    const fibers = pickupFibers;
    const fcount = fibers.length;
    const sw = pickupStamp.w, sh = pickupStamp.h;
    const sd = pickupStamp.data.data;
    const half = ms / 2;
    const radius = Math.max(1, half);
    const coh = pickupCoherence / 100;
    const scat = pickupScatter;

    // Stroke axis (smoothed for stable orientation under wiggle)
    let nx = smoothDirX, ny = smoothDirY;
    const dirMag = Math.sqrt(nx * nx + ny * ny);
    const hasDir = dirMag > 0.01;
    if (hasDir) { nx /= dirMag; ny /= dirMag; }
    else { nx = 1; ny = 0; }
    const perpX = -ny, perpY = nx;

    // Texture mapping: how brush-pixel-distance maps to texture pixels.
    // Larger ratio = sample wider area of texture per pixel = more variety.
    const texPerPixelU = (sw / Math.max(1, ms)) * 0.5;
    const texPerPixelV = (sh / Math.max(1, ms)) * 0.7;

    // Helper: deterministic per-pixel hash for non-coherent jitter
    const noise = (a, b) => {
      let h = (a * 374761393 + b * 668265263) | 0;
      h = (h ^ (h >>> 13)) * 1274126177 | 0;
      h = h ^ (h >>> 16);
      return ((h >>> 0) / 4294967295);
    };

    const opa = Math.max(0, Math.min(1, alpha));

    // Per-stamp taper envelope (softens stamp at start of stroke; end-taper
    // is handled by the per-fiber longitudinal envelope falling off when
    // the user lifts).
    const taperN = pickupFiberTaper / 100;
    const taperEnv = taperN > 0
      ? Math.min(1, Math.pow(Math.min(1, pickupStrokeDist / (radius * 4 * taperN + 1)), 1.2))
      : 1;

    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const maskVal = activeMask[my * ms + mx];
        if (maskVal < 0.01) continue;
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;

        const relX = mx - half, relY = my - half;
        // Project to stroke coords
        const u = relX * nx + relY * ny;       // along stroke (px)
        const vRaw = relX * perpX + relY * perpY; // perpendicular (px)
        const vNorm = vRaw / radius;             // -1 .. 1

        // CRISP / WINNER-TAKES-ALL fiber selection.
        // Instead of averaging multiple fiber samples (which produces
        // synthetic blended colors that ruin the dither), we find the
        // single fiber with the highest weight at this pixel and use ITS
        // exact sampled texel. The output is always one of the source
        // dither palette values — pixel-perfect crisp.
        let bestW = -1, bestR = 0, bestG = 0, bestB = 0;

        for (let f = 0; f < fcount; f++) {
          const fib = fibers[f];
          const wander = Math.sin((pickupStrokeDist + u) * fib.wanderFreq) * fib.wanderAmp;
          const dperp = vNorm - (fib.perp + wander);
          const ad = Math.abs(dperp);
          if (ad > fib.halfWidth * 1.6) continue;
          const tp = Math.max(0, 1 - ad / (fib.halfWidth * 1.6));
          const fiberPerpW = tp * tp * (3 - 2 * tp);

          const lenT = (pickupStrokeDist + u) * fib.envFreq + fib.envPhase;
          const env = 1 - fib.envAmp + Math.sin(lenT) * fib.envAmp;
          const fiberLongW = Math.max(0, env);

          const wF = fiberPerpW * fiberLongW * fib.load;
          if (wF <= bestW) continue;

          // Nearest-neighbor sample of the source dither texture
          const sU = fib.texU + (pickupStrokeDist + u) * texPerPixelU * fib.lenStretch;
          const sV = fib.texV + dperp * radius * texPerPixelV * 0.4 +
                     (pickupStrokeDist + u) * fib.driftV;
          const [sr, sg, sb] = sampleStampNearest(sd, sw, sh, sU, sV);
          bestW = wF;
          bestR = sr; bestG = sg; bestB = sb;
        }

        if (bestW < 0) continue;

        let r = bestR, g = bestG, b = bestB;

        // Optional per-pixel scatter — replace (not blend) with a scattered
        // sample so the output remains a crisp source pixel.
        if (scat > 0) {
          const n = noise(mx + (pickupStrokeDist | 0), my);
          if (n < scat / 100) {
            const sx = (noise(mx + 17, my + 31) - 0.5) * scat * 4;
            const sy = (noise(my + 53, mx + 11) - 0.5) * scat * 4;
            const [sr2, sg2, sb2] = sampleStampNearest(sd, sw, sh,
              pickupStrokeSeedX + sx,
              pickupStrokeSeedY + sy);
            r = sr2; g = sg2; b = sb2;
          }
        }

        // Coherence: at low coherence, occasionally swap a pixel for a
        // randomly-sampled texel — keeps grain crisp instead of blurry.
        if (coh < 1) {
          const swapP = (1 - coh) * 0.35;
          if (noise(mx + 7, my + ((pickupStrokeDist * 7) | 0)) < swapP) {
            const rsx = noise(mx, my + 41) * sw;
            const rsy = noise(my, mx + 29) * sh;
            const [sr3, sg3, sb3] = sampleStampNearest(sd, sw, sh, rsx, rsy);
            r = sr3; g = sg3; b = sb3;
          }
        }

        const di = (py * w + px) * 4;
        // CRISP placement: probabilistic replacement instead of alpha blending.
        // The mask × opacity becomes a per-pixel probability that this output
        // pixel is replaced by the (crisp source) value rather than averaged.
        // No interpolation between source and target → dither pattern stays
        // pixel-perfect.
        const replaceP = Math.pow(maskVal, 1.2) * opa * taperEnv;
        if (noise(mx + 101, my + 211 + ((pickupStrokeDist * 13) | 0)) < replaceP) {
          dst[di]     = r < 0 ? 0 : r > 255 ? 255 : r;
          dst[di + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
          dst[di + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        }
      }
    }
  }

  // ── Stroke Handling ──
  // Compute taper multiplier (0-1) based on stroke progress
  function getTaperMultiplier() {
    // Use stamp count as proxy for stroke length
    const count = strokeStampCount;
    // Taper in: ramp up over first N stamps
    const inStamps = Math.max(1, Math.round(taperIn / 5));
    const outStamps = Math.max(1, Math.round(taperOut / 5));
    let taper = 1;
    if (taperIn > 0 && count < inStamps) {
      taper = Math.min(taper, count / inStamps);
    }
    // Taper out is harder without knowing total length, so we apply
    // it retroactively — use velocity-based fade (slower = more taper)
    // For now we apply taper-in at start; taper-out on endStroke is cosmetic
    return Math.max(0.05, taper);
  }

  function beginStroke(x, y, pressure, isPen, opts) {
    if (!canvas) return;
    pushPaintUndo();
    painting = true;
    lastX = x; lastY = y;
    prevStampX = x; prevStampY = y;
    strokeDirX = 0; strokeDirY = 0;
    smoothDirX = 0; smoothDirY = 0;
    strokeTotalDist = 0;
    strokeStampCount = 0;
    pickupStrokeDist = 0;
    wetStrokeCx = x; wetStrokeCy = y;
    // Pen state for this stroke
    pressureActive = !!isPen;
    currentPressure = (pressure == null) ? 1 : Math.max(0, Math.min(1, pressure));
    const o = opts || {};
    currentTiltX = o.tiltX || 0;
    currentTiltY = o.tiltY || 0;
    currentTwist = o.twist || 0;
    currentVelocity = 0;
    _lastMoveTime = (o.time != null) ? o.time : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    _lastMoveX = x; _lastMoveY = y;
    _pressureMaskCache = { size: -1, mask: null, brush: selectedBrush };
    // Snapshot pre-stroke canvas for ECHO effect (only when needed)
    if (wetEcho > 0) {
      try { wetEchoSnap = ctx.getImageData(0, 0, canvas.width, canvas.height); }
      catch (e) { wetEchoSnap = null; }
    } else {
      wetEchoSnap = null;
    }
    updateActiveMask();

    // Reset pickup RNG each stroke for varied but reproducible results
    if (tool === 'pickup') {
      _pickupRng = { s: Math.floor(Math.random() * 2147483646) + 1 };
      // Per-stroke seed offset into the texture, so consecutive strokes
      // don't all start sampling at (0,0)
      pickupStrokeSeedX = Math.random() * (pickupStamp ? pickupStamp.w : 0);
      pickupStrokeSeedY = Math.random() * (pickupStamp ? pickupStamp.h : 0);
      // Build a fresh set of fibers for this stroke
      pickupFibers = buildPickupFibers(activeMaskSize);
    }
    if (tool === 'smudge') initPickup(x, y);

    applyStamp(x, y);
  }

  function continueStroke(x, y, pressure, opts) {
    if (!painting || !canvas) return;
    const dx = x - lastX, dy = y - lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Update velocity from time delta (used by velocity-aware mappings)
    const o = opts || {};
    const now = (o.time != null) ? o.time : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = Math.max(1, now - _lastMoveTime);
    const movedDist = Math.sqrt((x - _lastMoveX) * (x - _lastMoveX) + (y - _lastMoveY) * (y - _lastMoveY));
    // Low-pass filter the velocity so single slow samples don't flicker size
    currentVelocity = currentVelocity * 0.6 + (movedDist / dt) * 0.4;
    _lastMoveTime = now; _lastMoveX = x; _lastMoveY = y;

    // Pressure-modulated spacing: higher pressure → tighter spacing (denser paint)
    const isPickup = tool === 'pickup';
    const spacingPct = isPickup ? Math.min(spacing, 8) : spacing;
    let spacingFactor = 1;
    if (pressureSpacingEnabled && pressureActive) {
      const pN = Math.pow(currentPressure, pressureCurve);
      // at full pressure, spacing drops to 50% of set value
      spacingFactor = 1 - 0.5 * pN;
    }
    const spacingPx = Math.max(1, activeMaskSize * spacingPct / 100 * spacingFactor);

    if (dist < spacingPx * 0.5) return;
    strokeTotalDist += dist;

    // Interpolate pressure + tilt + twist linearly across sub-stamps
    const prevPressure = currentPressure;
    const newPressure = (pressure == null) ? currentPressure : Math.max(0, Math.min(1, pressure));
    const prevTiltX = currentTiltX, prevTiltY = currentTiltY, prevTwist = currentTwist;
    const newTiltX = (o.tiltX != null) ? o.tiltX : currentTiltX;
    const newTiltY = (o.tiltY != null) ? o.tiltY : currentTiltY;
    const newTwist = (o.twist != null) ? o.twist : currentTwist;

    const steps = Math.max(1, Math.ceil(dist / spacingPx));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = lastX + dx * t;
      const sy = lastY + dy * t;
      currentPressure = prevPressure + (newPressure - prevPressure) * t;
      currentTiltX = prevTiltX + (newTiltX - prevTiltX) * t;
      currentTiltY = prevTiltY + (newTiltY - prevTiltY) * t;
      // Twist wraps at 360 — shortest-path interp
      let dT = newTwist - prevTwist;
      if (dT > 180) dT -= 360; else if (dT < -180) dT += 360;
      currentTwist = (prevTwist + dT * t + 360) % 360;
      applyStamp(sx, sy);
    }
    currentPressure = newPressure;
    currentTiltX = newTiltX;
    currentTiltY = newTiltY;
    currentTwist = newTwist;
    lastX = x; lastY = y;
  }

  function endStroke() {
    if (!painting) return;
    painting = false;
    strokeCount++;
    hasPickup = false;
    // Run a few extra wet-evolution iterations after lift so wet pixels
    // settle / drip a bit before drying — the physical "trail" effect.
    if (wetEnabled()) {
      const tail = Math.max(2, Math.min(40, Math.round(wetLifetime / 4)));
      for (let i = 0; i < tail; i++) evolveWetLayer();
    }
    // Force-clear remaining wetness so the next stroke starts dry.
    clearWetMap();
  }

  // ── Undo ──
  function pushPaintUndo() {
    if (!canvas) return;
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Capture the pre-paint base on the very first stroke
    if (!baseSnapshot) baseSnapshot = snap;
    undoStack.push(snap);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  function undoStroke() {
    if (undoStack.length === 0) return false;
    const prev = undoStack.pop();
    ctx.putImageData(prev, 0, 0);
    strokeCount = Math.max(0, strokeCount - 1);
    clearWetMap();
    return true;
  }

  function clearStrokes() {
    undoStack.length = 0;
    strokeCount = 0;
    hasPickup = false;
    baseSnapshot = null;
    clearWetMap();
  }

  // Re-apply paint modifications over a new base image.
  // Computes which pixels were changed by paint (current vs baseSnapshot),
  // then applies those changes on top of the new base already on the canvas.
  function reapplyPaintOver() {
    if (!canvas || !baseSnapshot || strokeCount === 0) return false;
    const painted = undoStack.length > 0
      ? ctx.getImageData(0, 0, canvas.width, canvas.height)
      : null;
    // If the canvas was already overwritten by runProcess, we need the
    // painted state from before that. We store it in the call site.
    return false; // caller handles this via reapplyPaintDelta
  }

  // Apply a pre-computed paint delta onto the current canvas, optionally
  // using a blend mode + opacity so the paint layer composites with the
  // newly-rendered dither/grain base. blendMode/opacity default to "normal"
  // / 100 which preserves the original behavior (paint replaces base).
  function applyPaintDelta(paintedData, baseData, blendMode, opacity) {
    if (!canvas || !paintedData || !baseData) return;
    const newBase = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const nb = newBase.data;
    const pd = paintedData.data;
    const bd = baseData.data;
    const len = nb.length;
    // If canvas size changed, can't re-apply
    if (pd.length !== len || bd.length !== len) return;
    const mode = blendMode || 'normal';
    const op = (opacity == null ? 100 : opacity) / 100;
    const blendFn = (typeof DitherEngine !== 'undefined' && DitherEngine.blendPixel) ? DitherEngine.blendPixel : null;
    const useBlend = mode !== 'normal' && blendFn;
    for (let i = 0; i < len; i += 4) {
      // Was this pixel actually modified by paint?
      if (pd[i] === bd[i] && pd[i+1] === bd[i+1] && pd[i+2] === bd[i+2]) continue;
      let r, g, b;
      if (useBlend) {
        r = blendFn(nb[i],   pd[i],   mode);
        g = blendFn(nb[i+1], pd[i+1], mode);
        b = blendFn(nb[i+2], pd[i+2], mode);
      } else {
        r = pd[i]; g = pd[i+1]; b = pd[i+2];
      }
      nb[i]   = nb[i]   + (r - nb[i])   * op;
      nb[i+1] = nb[i+1] + (g - nb[i+1]) * op;
      nb[i+2] = nb[i+2] + (b - nb[i+2]) * op;
    }
    ctx.putImageData(newBase, 0, 0);
    // Update base snapshot to current new base (so future diffs work)
    baseSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Rebuild undo stack with just the current state
    undoStack.length = 0;
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  function getBaseSnapshot() { return baseSnapshot; }
  function getPaintedState() {
    if (!canvas) return null;
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function hasStrokes() { return strokeCount > 0; }
  function getStrokeCount() { return strokeCount; }

  // ── Brush Library ──
  function selectBrush(index) {
    if (index >= 0 && index < brushLibrary.length) {
      selectedBrush = index;
      updateActiveMask();
    }
  }

  function getBrushes() {
    return brushLibrary.map((b, i) => ({ name: b.name, index: i, selected: i === selectedBrush }));
  }

  function getSelectedBrush() { return selectedBrush; }

  function extractBrushFromImage(imageData, threshold, softness, invert, feather) {
    const w = imageData.width, h = imageData.height;
    const d = imageData.data;
    const sz = Math.max(w, h);
    const mask = new Float32Array(sz * sz);
    const th = threshold / 255;
    const sf = softness / 100;

    for (let y = 0; y < h && y < sz; y++) {
      for (let x = 0; x < w && x < sz; x++) {
        const i = (y * w + x) * 4;
        const brightness = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        const edge = sf > 0 ? sf * 0.5 : 0.005;
        const lo = Math.max(0, th - edge), hi = Math.min(1, th + edge);
        let alpha;
        if (brightness >= hi) {
          alpha = 0;
        } else if (brightness <= lo) {
          alpha = 1;
        } else {
          alpha = 1 - (brightness - lo) / (hi - lo);
        }
        const texture = 1 - brightness;
        alpha = alpha * (0.3 + 0.7 * texture);
        if (invert) alpha = brightness >= hi ? 1 : brightness <= lo ? 0 : (brightness - lo) / (hi - lo);
        mask[y * sz + x] = Math.max(0, Math.min(1, alpha));
      }
    }

    // Feathering: separable box blur (cheap Gaussian approximation).
    // feather is 0..100 → kernel radius scales with mask size so the same
    // value gives consistent perceived softness across brush sizes.
    const fAmt = Math.max(0, Math.min(100, feather || 0));
    if (fAmt > 0) {
      const radius = Math.max(1, Math.round(sz * fAmt / 200));
      const passes = 2; // two box-blur passes ≈ Gaussian
      const tmp = new Float32Array(sz * sz);
      for (let p = 0; p < passes; p++) {
        // Horizontal pass: mask → tmp
        for (let y = 0; y < sz; y++) {
          let sum = 0;
          // Initialize sum with first window
          for (let x = -radius; x <= radius; x++) {
            const xc = Math.max(0, Math.min(sz - 1, x));
            sum += mask[y * sz + xc];
          }
          const inv = 1 / (radius * 2 + 1);
          for (let x = 0; x < sz; x++) {
            tmp[y * sz + x] = sum * inv;
            const addX = Math.min(sz - 1, x + radius + 1);
            const subX = Math.max(0, x - radius);
            sum += mask[y * sz + addX] - mask[y * sz + subX];
          }
        }
        // Vertical pass: tmp → mask
        for (let x = 0; x < sz; x++) {
          let sum = 0;
          for (let y = -radius; y <= radius; y++) {
            const yc = Math.max(0, Math.min(sz - 1, y));
            sum += tmp[yc * sz + x];
          }
          const inv = 1 / (radius * 2 + 1);
          for (let y = 0; y < sz; y++) {
            mask[y * sz + x] = sum * inv;
            const addY = Math.min(sz - 1, y + radius + 1);
            const subY = Math.max(0, y - radius);
            sum += tmp[addY * sz + x] - tmp[subY * sz + x];
          }
        }
      }
    }

    return { mask, size: sz };
  }

  function addBrush(name, mask, maskSize) {
    brushLibrary.push({ name, mask, size: maskSize });
    return brushLibrary.length - 1;
  }

  // ── Settings ──
  function setTool(t) { tool = t; }
  function setSize(s) {
    size = Math.max(1, Math.min(2000, s));
    updateActiveMask();
    // Invalidate fiber set so it rebuilds at the right density next stroke
    pickupFibers = null;
  }
  function setSpacing(s) { spacing = Math.max(1, Math.min(200, s)); }
  function setStrength(s) { strength = Math.max(0, Math.min(100, s)); }
  function setOpacity(o) { opacity = Math.max(0, Math.min(100, o)); }
  function setSmudgeDecay(d) { smudgeDecay = Math.max(0, Math.min(100, d)); }
  function setPushDistance(d) { pushDistance = Math.max(1, Math.min(100, d)); }
  function setScatterRadius(r) { scatterRadius = Math.max(1, Math.min(100, r)); }
  function setSwirlAngle(a) { swirlAngle = Math.max(-360, Math.min(360, a)); }
  function setLiquifySmooth(s) { liquifySmooth = Math.max(0, Math.min(2, s)); }
  function setBlendKernel(k) { blendKernel = Math.max(1, Math.min(20, k)); }
  function setSpreadAmount(a) { spreadAmount = Math.max(1, Math.min(100, a)); }
  function setBrushAngle(a) { brushAngle = a % 360; }
  function setFollowDirection(v) { followDirection = !!v; }
  function setPickupJitter(v) { pickupJitter = Math.max(0, Math.min(100, v)); }
  function setPickupScatter(v) { pickupScatter = Math.max(0, Math.min(50, v)); }
  function setPickupCoherence(v) { pickupCoherence = Math.max(0, Math.min(100, v)); }
  function setPickupFiberDensity(v) { pickupFiberDensity = Math.max(0, Math.min(100, v)); pickupFibers = null; }
  function setPickupFiberLength(v)  { pickupFiberLength  = Math.max(0, Math.min(100, v)); pickupFibers = null; }
  function setPickupFiberFlow(v)    { pickupFiberFlow    = Math.max(0, Math.min(100, v)); pickupFibers = null; }
  function setPickupFiberWander(v)  { pickupFiberWander  = Math.max(0, Math.min(100, v)); pickupFibers = null; }
  function setPickupColorVariety(v) { pickupColorVariety = Math.max(0, Math.min(100, v)); pickupFibers = null; }
  function setPickupFiberTaper(v)   { pickupFiberTaper   = Math.max(0, Math.min(100, v)); }
  function setTaperIn(v) { taperIn = Math.max(0, Math.min(100, v)); }
  function setTaperOut(v) { taperOut = Math.max(0, Math.min(100, v)); }
  function setTaperSize(v) { taperSize = !!v; }
  function setTaperOpacity(v) { taperOpacity = !!v; }

  // Pen pressure setters
  function setPressureSize(v)       { pressureSizeEnabled = !!v; }
  function setPressureOpacity(v)    { pressureOpacityEnabled = !!v; }
  function setPressureSizeMin(v)    { pressureSizeMin = Math.max(0, Math.min(1, v)); }
  function setPressureOpacityMin(v) { pressureOpacityMin = Math.max(0, Math.min(1, v)); }
  function setPressureStrength(v)      { pressureStrengthEnabled = !!v; }
  function setPressureStrengthMin(v)   { pressureStrengthMin = Math.max(0, Math.min(1, v)); }
  function setPressureSpacing(v)       { pressureSpacingEnabled = !!v; }
  function setPressureCurve(v)         { pressureCurve = Math.max(0.1, Math.min(5, v)); }
  // Tilt
  function setTiltEnabled(v)           { tiltEnabled = !!v; }
  function setTiltAngleInfluence(v)    { tiltAngleInfluence = Math.max(0, Math.min(1, v)); }
  function setTiltSizeInfluence(v)     { tiltSizeInfluence  = Math.max(0, Math.min(1, v)); }
  // Twist
  function setTwistEnabled(v)          { twistEnabled = !!v; }
  function setTwistInfluence(v)        { twistInfluence = Math.max(0, Math.min(1, v)); }
  // Velocity
  function setVelocityEnabled(v)       { velocityEnabled = !!v; }
  function setVelocitySizeInfluence(v) { velocitySizeInfluence = Math.max(0, Math.min(1, v)); }

  // Wet layer setters
  function setWetDrip(v)      { wetDrip      = Math.max(0, Math.min(100, v)); }
  function setWetBleed(v)     { wetBleed     = Math.max(0, Math.min(100, v)); }
  function setWetSmear(v)     { wetSmear     = Math.max(0, Math.min(100, v)); }
  function setWetSeparate(v)  { wetSeparate  = Math.max(0, Math.min(100, v)); }
  function setWetLifetime(v)  { wetLifetime  = Math.max(0, Math.min(100, v)); }
  function setWetEvolveRate(v){ wetEvolveRate = Math.max(1, Math.min(4, v|0)); }

  // Brush-shape influence setter
  function setShapeInfluence(v) { shapeInfluence = Math.max(0, Math.min(300, v)); }

  function getSettings() {
    return { tool, size, spacing, strength, opacity, smudgeDecay, pushDistance, scatterRadius, swirlAngle, liquifySmooth, blendKernel, spreadAmount, selectedBrush, brushAngle, followDirection, pickupJitter, pickupScatter, pickupCoherence, pickupFiberDensity, pickupFiberLength, pickupFiberFlow, pickupFiberWander, pickupColorVariety, pickupFiberTaper, taperIn, taperOut, taperSize, taperOpacity, wetDrip, wetBleed, wetSmear, wetSeparate, wetLifetime, wetEvolveRate, shapeInfluence,
      pressureSizeEnabled, pressureOpacityEnabled, pressureSizeMin, pressureOpacityMin,
      pressureStrengthEnabled, pressureStrengthMin, pressureSpacingEnabled, pressureCurve,
      tiltEnabled, tiltAngleInfluence, tiltSizeInfluence,
      twistEnabled, twistInfluence,
      velocityEnabled, velocitySizeInfluence
    };
  }

  // ── Brush Thumbnails ──
  function getBrushThumbnail(index, thumbSize) {
    const brush = brushLibrary[index];
    if (!brush) return null;
    const c = document.createElement('canvas');
    c.width = thumbSize; c.height = thumbSize;
    const tctx = c.getContext('2d');
    const img = tctx.createImageData(thumbSize, thumbSize);
    const scaled = scaleMask(brush.mask, brush.size, thumbSize);
    // Mild power-curve boost so soft drawn brushes (whose mask values are
    // mostly in the 0.1–0.4 feather range) read clearly in thumbnails.
    // pow(0.65) pushes mid-tones brighter in the white-on-black mask dump,
    // which inverts to darker ink in the side-menu preview — faint strokes
    // stay visible instead of washing out to near-invisible light gray.
    for (let i = 0; i < thumbSize * thumbSize; i++) {
      const v = Math.round(Math.pow(Math.min(1, Math.max(0, scaled[i])), 0.65) * 255);
      const idx = i * 4;
      img.data[idx] = v; img.data[idx + 1] = v; img.data[idx + 2] = v; img.data[idx + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  // ── Brush Cursor Image ──
  let _cursorCache = { brush: -1, size: 0, url: '' };

  function getBrushCursorURL(displaySize) {
    if (_cursorCache.brush === selectedBrush && _cursorCache.size === displaySize && _cursorCache.url) {
      return _cursorCache.url;
    }
    const brush = brushLibrary[selectedBrush];
    if (!brush) return '';
    const sz = Math.max(4, Math.min(displaySize, 256));
    const c = document.createElement('canvas');
    c.width = sz; c.height = sz;
    const tctx = c.getContext('2d');
    const img = tctx.createImageData(sz, sz);
    const scaled = scaleMask(brush.mask, brush.size, sz);
    for (let i = 0; i < sz * sz; i++) {
      const a = scaled[i];
      const idx = i * 4;
      img.data[idx] = 255;
      img.data[idx + 1] = 255;
      img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.round(a * 180);
    }
    tctx.putImageData(img, 0, 0);
    _cursorCache = { brush: selectedBrush, size: displaySize, url: c.toDataURL() };
    return _cursorCache.url;
  }

  function invalidateCursorCache() {
    _cursorCache = { brush: -1, size: 0, url: '' };
  }

  // ── Brush mask accessors for cross-module use (algorithms that want to
  // stamp using a paintstroke brush shape). Returns {mask, size} or null. ──
  function getBrushMask(idx) {
    if (brushLibrary.length === 0) initDefaultBrushes();
    const i = idx | 0;
    if (i < 0 || i >= brushLibrary.length) return null;
    const b = brushLibrary[i];
    return b && b.mask ? { mask: b.mask, size: b.size, name: b.name } : null;
  }
  function getBrushMaskCount() {
    if (brushLibrary.length === 0) initDefaultBrushes();
    return brushLibrary.length;
  }
  function getBrushNames() {
    if (brushLibrary.length === 0) initDefaultBrushes();
    return brushLibrary.map(b => b.name);
  }

  // ── Public API ──
  return {
    init, beginStroke, continueStroke, endStroke,
    undoStroke, clearStrokes, hasStrokes, getStrokeCount,
    getBaseSnapshot, getPaintedState, applyPaintDelta,
    setTool, setSize, setSpacing, setStrength, setOpacity,
    setSmudgeDecay, setPushDistance, setScatterRadius, setSwirlAngle,
    setLiquifySmooth, setBlendKernel, setSpreadAmount,
    setBrushAngle, setFollowDirection,
    setPickupJitter, setPickupScatter, setPickupCoherence,
    setPickupFiberDensity, setPickupFiberLength, setPickupFiberFlow,
    setPickupFiberWander, setPickupColorVariety, setPickupFiberTaper,
    setTaperIn, setTaperOut, setTaperSize, setTaperOpacity,
    setPressureSize, setPressureOpacity, setPressureSizeMin, setPressureOpacityMin,
    setPressureStrength, setPressureStrengthMin, setPressureSpacing, setPressureCurve,
    setTiltEnabled, setTiltAngleInfluence, setTiltSizeInfluence,
    setTwistEnabled, setTwistInfluence,
    setVelocityEnabled, setVelocitySizeInfluence,
    setWetDrip, setWetBleed, setWetSmear, setWetSeparate,
    setWetLifetime, setWetEvolveRate, setShapeInfluence,
    selectBrush, getBrushes, getSelectedBrush, getBrushThumbnail,
    addBrush, extractBrushFromImage, capturePickupStamp, hasStamp, getStampSize,
    getSettings, updateActiveMask,
    getBrushCursorURL, invalidateCursorCache,
    // Cross-module brush access (for algorithms like palette-knife/impressionism)
    getBrushMask, getBrushMaskCount, getBrushNames
  };
})();
