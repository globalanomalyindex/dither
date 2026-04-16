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
  let pickupJitter = 30;      // % — randomize sample position within stamp
  let pickupScatter = 10;     // px — scatter individual pixels

  // Tapering
  let taperIn = 20;            // % of stroke length for taper in
  let taperOut = 20;           // % of stroke length for taper out
  let taperSize = true;        // taper affects size
  let taperOpacity = true;     // taper affects opacity
  let strokeTotalDist = 0;     // accumulated distance this stroke
  let strokeStampCount = 0;    // stamps applied this stroke

  // Brush angle
  let brushAngle = 0;          // manual rotation in degrees
  let followDirection = false;  // rotate brush to follow stroke direction

  // Active brush mask
  let activeMask = null;
  let activeMaskSize = 0;

  // Stroke direction (normalized, canvas pixel space)
  let prevStampX = 0, prevStampY = 0;
  let strokeDirX = 0, strokeDirY = 0;

  // Smudge pickup buffers
  let pickupR = null, pickupG = null, pickupB = null;
  let hasPickup = false;

  // Pickup tool: marquee-selected pixel stamp
  let pickupStamp = null;      // { data: ImageData, w, h }
  let hasPickupStamp = false;

  // Brush library
  const brushLibrary = [];
  let selectedBrush = 0;

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

  // ── Stamp Application ──
  function applyStamp(cx, cy) {
    if (!activeMask || !canvas) return;
    const ms = activeMaskSize;
    const half = ms / 2;

    // Compute stroke direction from previous stamp
    const ddx = cx - prevStampX, ddy = cy - prevStampY;
    const ddLen = Math.sqrt(ddx * ddx + ddy * ddy);
    if (ddLen > 0.1) { strokeDirX = ddx / ddLen; strokeDirY = ddy / ddLen; }
    prevStampX = cx; prevStampY = cy;

    // Apply brush rotation (manual angle + follow direction)
    let effectiveAngle = brushAngle;
    if (followDirection && (Math.abs(strokeDirX) > 0.01 || Math.abs(strokeDirY) > 0.01)) {
      effectiveAngle += Math.atan2(strokeDirY, strokeDirX) * 180 / Math.PI;
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
    const str = strength / 100;
    const opa = (opacity / 100) * (taperOpacity ? taperMul : 1);

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
  }

  // ── Tool: Smudge ──
  function stampSmudge(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    const decay = smudgeDecay / 100;
    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const a = activeMask[my * ms + mx] * alpha;
        if (a < 0.01) continue;
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const idx = (py * w + px) * 4;
        const mi = my * ms + mx;

        if (hasPickup) {
          // Blend pickup with canvas
          dst[idx]     = Math.round(src[idx]     + (pickupR[mi] - src[idx])     * a);
          dst[idx + 1] = Math.round(src[idx + 1] + (pickupG[mi] - src[idx + 1]) * a);
          dst[idx + 2] = Math.round(src[idx + 2] + (pickupB[mi] - src[idx + 2]) * a);
          // Update pickup with decay
          pickupR[mi] = pickupR[mi] * decay + src[idx]     * (1 - decay);
          pickupG[mi] = pickupG[mi] * decay + src[idx + 1] * (1 - decay);
          pickupB[mi] = pickupB[mi] * decay + src[idx + 2] * (1 - decay);
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
        const a = activeMask[my * ms + mx];
        if (a < 0.01) continue;
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
        const a = activeMask[my * ms + mx];
        if (a < 0.01) continue;
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
        const a = activeMask[my * ms + mx];
        if (a < 0.01) continue;
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
        const a = activeMask[my * ms + mx];
        if (a < 0.01) continue;
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

  // ── Tool: Blend ──
  function stampBlend(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    const kr = blendKernel;
    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const a = activeMask[my * ms + mx] * alpha;
        if (a < 0.01) continue;
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;

        // Average neighborhood
        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (let ky = -kr; ky <= kr; ky++) {
          for (let kx = -kr; kx <= kr; kx++) {
            const sx = px + kx, sy = py + ky;
            if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
              const si = (sy * w + sx) * 4;
              sr += src[si]; sg += src[si + 1]; sb += src[si + 2];
              cnt++;
            }
          }
        }
        if (cnt === 0) continue;
        sr /= cnt; sg /= cnt; sb /= cnt;

        const idx = (py * w + px) * 4;
        dst[idx]     = Math.round(src[idx]     + (sr - src[idx])     * a);
        dst[idx + 1] = Math.round(src[idx + 1] + (sg - src[idx + 1]) * a);
        dst[idx + 2] = Math.round(src[idx + 2] + (sb - src[idx + 2]) * a);
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
        const a = activeMask[my * ms + mx];
        if (a < 0.01) continue;
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

  function stampPickup(src, dst, w, h, cx, cy, bx0, by0, ms, alpha) {
    if (!hasPickupStamp || !pickupStamp) return;
    const sw = pickupStamp.w, sh = pickupStamp.h;
    const sd = pickupStamp.data.data;
    const jit = pickupJitter / 100;
    const scat = pickupScatter;

    if (!_pickupRng) _pickupRng = { s: 42 };
    const rng = () => { _pickupRng.s = (_pickupRng.s * 16807) % 2147483647; return _pickupRng.s / 2147483647; };

    // Stroke direction
    const nx = strokeDirX, ny = strokeDirY;
    const hasDir = Math.abs(nx) > 0.01 || Math.abs(ny) > 0.01;

    // Push displacement distance — canvas pixels behind get shoved forward
    const dist = pushDistance * alpha;

    // Texture scroll: the stamp "feeds" through as you stroke,
    // like an ink roller picking up new texture with each revolution
    const scrollX = strokeStampCount * nx * (sw / ms) * 1.5;
    const scrollY = strokeStampCount * ny * (sh / ms) * 1.5;

    for (let my = 0; my < ms; my++) {
      for (let mx = 0; mx < ms; mx++) {
        const maskVal = activeMask[my * ms + mx];
        if (maskVal < 0.01) continue;
        const px = bx0 + mx, py = by0 + my;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;

        const di = (py * w + px) * 4;

        // --- Sample from stamp texture (generative, scrolling) ---
        let sampleX = (mx / ms) * sw + scrollX;
        let sampleY = (my / ms) * sh + scrollY;

        // Per-pixel jitter: randomize within stamp for organic variation
        if (jit > 0) {
          sampleX += (rng() - 0.5) * sw * jit;
          sampleY += (rng() - 0.5) * sh * jit;
        }
        // Per-pixel scatter: spatial noise
        if (scat > 0) {
          sampleX += (rng() - 0.5) * scat * 2;
          sampleY += (rng() - 0.5) * scat * 2;
        }

        // Wrap within stamp (tiling — infinite texture from finite capture)
        sampleX = ((sampleX % sw) + sw) % sw;
        sampleY = ((sampleY % sh) + sh) % sh;
        const si = (Math.floor(sampleY) * sw + Math.floor(sampleX)) * 4;

        // Stamp pixel — what the engine is "generating"
        const stampR = sd[si], stampG = sd[si + 1], stampB = sd[si + 2];

        // --- Push-displaced canvas pixel (what's being shoved) ---
        let pushR, pushG, pushB;
        if (hasDir) {
          const srcX = px - nx * dist * maskVal;
          const srcY = py - ny * dist * maskVal;
          [pushR, pushG, pushB] = samplePixel(src, w, h, srcX, srcY);
        } else {
          pushR = src[di]; pushG = src[di + 1]; pushB = src[di + 2];
        }

        // --- Blend: stamp feeds the push ---
        // At brush center (high mask), stamp dominates = fresh generative pixels
        // At brush edge (low mask), push dominates = displaced canvas pixels
        // This creates the "engine spitting out pixels" feel
        const stampWeight = maskVal;  // center = stamp, edge = push
        const r = stampR * stampWeight + pushR * (1 - stampWeight);
        const g = stampG * stampWeight + pushG * (1 - stampWeight);
        const b = stampB * stampWeight + pushB * (1 - stampWeight);

        // Direct pixel replacement — NOT alpha-blended with canvas.
        // Brush mask controls coverage; within coverage, pixels are PLACED.
        dst[di]     = Math.round(r);
        dst[di + 1] = Math.round(g);
        dst[di + 2] = Math.round(b);
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

  function beginStroke(x, y) {
    if (!canvas) return;
    pushPaintUndo();
    painting = true;
    lastX = x; lastY = y;
    prevStampX = x; prevStampY = y;
    strokeDirX = 0; strokeDirY = 0;
    strokeTotalDist = 0;
    strokeStampCount = 0;
    updateActiveMask();

    // Reset pickup RNG each stroke for varied but reproducible results
    if (tool === 'pickup') _pickupRng = { s: Math.floor(Math.random() * 2147483646) + 1 };
    if (tool === 'smudge') initPickup(x, y);

    applyStamp(x, y);
  }

  function continueStroke(x, y) {
    if (!painting || !canvas) return;
    const dx = x - lastX, dy = y - lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const spacingPx = Math.max(1, activeMaskSize * spacing / 100);

    if (dist < spacingPx * 0.5) return;
    strokeTotalDist += dist;

    const steps = Math.max(1, Math.ceil(dist / spacingPx));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = lastX + dx * t;
      const sy = lastY + dy * t;
      applyStamp(sx, sy);
    }
    lastX = x; lastY = y;
  }

  function endStroke() {
    if (!painting) return;
    painting = false;
    strokeCount++;
    hasPickup = false;
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
    return true;
  }

  function clearStrokes() {
    undoStack.length = 0;
    strokeCount = 0;
    hasPickup = false;
    baseSnapshot = null;
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

  // Apply a pre-computed paint delta onto the current canvas
  function applyPaintDelta(paintedData, baseData) {
    if (!canvas || !paintedData || !baseData) return;
    const newBase = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const nb = newBase.data;
    const pd = paintedData.data;
    const bd = baseData.data;
    const len = nb.length;
    // If canvas size changed, can't re-apply
    if (pd.length !== len || bd.length !== len) return;
    for (let i = 0; i < len; i += 4) {
      // Check if this pixel was modified by paint
      if (pd[i] !== bd[i] || pd[i+1] !== bd[i+1] || pd[i+2] !== bd[i+2]) {
        nb[i]   = pd[i];
        nb[i+1] = pd[i+1];
        nb[i+2] = pd[i+2];
      }
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

  function extractBrushFromImage(imageData, threshold, softness, invert) {
    const w = imageData.width, h = imageData.height;
    const d = imageData.data;
    const sz = Math.max(w, h);
    const mask = new Float32Array(sz * sz);
    const th = threshold / 255;   // 0-1, pixels brighter than this become transparent
    const sf = softness / 100;    // 0-1, feather width around threshold

    for (let y = 0; y < h && y < sz; y++) {
      for (let x = 0; x < w && x < sz; x++) {
        const i = (y * w + x) * 4;
        const brightness = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        // Threshold removes bright pixels (white → transparent)
        // Darker pixels stay opaque, preserving texture
        const edge = sf > 0 ? sf * 0.5 : 0.005;
        const lo = Math.max(0, th - edge), hi = Math.min(1, th + edge);
        let alpha;
        if (brightness >= hi) {
          alpha = 0;          // above threshold = fully transparent
        } else if (brightness <= lo) {
          alpha = 1;          // well below threshold = fully opaque
        } else {
          alpha = 1 - (brightness - lo) / (hi - lo);  // smooth fade
        }
        // Preserve tonal texture: darks are more opaque, mids partially
        // Scale by inverse brightness so texture detail is retained
        const texture = 1 - brightness;
        alpha = alpha * (0.3 + 0.7 * texture);
        if (invert) alpha = brightness >= hi ? 1 : brightness <= lo ? 0 : (brightness - lo) / (hi - lo);
        mask[y * sz + x] = Math.max(0, Math.min(1, alpha));
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
  function setSize(s) { size = Math.max(1, Math.min(500, s)); updateActiveMask(); }
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
  function setTaperIn(v) { taperIn = Math.max(0, Math.min(100, v)); }
  function setTaperOut(v) { taperOut = Math.max(0, Math.min(100, v)); }
  function setTaperSize(v) { taperSize = !!v; }
  function setTaperOpacity(v) { taperOpacity = !!v; }

  function getSettings() {
    return { tool, size, spacing, strength, opacity, smudgeDecay, pushDistance, scatterRadius, swirlAngle, liquifySmooth, blendKernel, spreadAmount, selectedBrush, brushAngle, followDirection, pickupJitter, pickupScatter, taperIn, taperOut, taperSize, taperOpacity };
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
    for (let i = 0; i < thumbSize * thumbSize; i++) {
      const v = Math.round(scaled[i] * 255);
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

  // ── Public API ──
  return {
    init, beginStroke, continueStroke, endStroke,
    undoStroke, clearStrokes, hasStrokes, getStrokeCount,
    getBaseSnapshot, getPaintedState, applyPaintDelta,
    setTool, setSize, setSpacing, setStrength, setOpacity,
    setSmudgeDecay, setPushDistance, setScatterRadius, setSwirlAngle,
    setLiquifySmooth, setBlendKernel, setSpreadAmount,
    setBrushAngle, setFollowDirection,
    setPickupJitter, setPickupScatter,
    setTaperIn, setTaperOut, setTaperSize, setTaperOpacity,
    selectBrush, getBrushes, getSelectedBrush, getBrushThumbnail,
    addBrush, extractBrushFromImage, capturePickupStamp, hasStamp, getStampSize,
    getSettings, updateActiveMask,
    getBrushCursorURL, invalidateCursorCache
  };
})();
