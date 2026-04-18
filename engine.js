/**
 * ENGINE.js — Processing pipeline with preview downsampling, tone lock
 */
const DitherEngine = (() => {
  let sourceImage = null;
  let sourceCanvas = null;
  let sourceData = null;
  let _cache = { key: '', gray: null, channels: null };

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        sourceImage = img;
        sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = img.width;
        sourceCanvas.height = img.height;
        const ctx = sourceCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        sourceData = ctx.getImageData(0, 0, img.width, img.height);
        _cache.key = '';
        URL.revokeObjectURL(url);
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });
  }

  function getSourceSize() {
    if (sourceData) return { width: sourceData.width, height: sourceData.height };
    if (sourceImage) return { width: sourceImage.width, height: sourceImage.height };
    return null;
  }

  function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

  function hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function toGrayscale(data, w, h, mode) {
    const px = data.data, n = w * h, gray = new Float32Array(n);
    if (mode === 'average') {
      for (let i = 0; i < n; i++) { const o = i * 4; gray[i] = (px[o] + px[o+1] + px[o+2]) / 3; }
    } else if (mode === 'desaturation') {
      for (let i = 0; i < n; i++) { const o = i * 4; gray[i] = (Math.max(px[o], px[o+1], px[o+2]) + Math.min(px[o], px[o+1], px[o+2])) / 2; }
    } else {
      for (let i = 0; i < n; i++) { const o = i * 4; gray[i] = 0.2126 * px[o] + 0.7152 * px[o+1] + 0.0722 * px[o+2]; }
    }
    return gray;
  }

  function toChannels(data, w, h) {
    const px = data.data, n = w * h;
    const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) { const o = i * 4; r[i] = px[o]; g[i] = px[o+1]; b[i] = px[o+2]; }
    return { r, g, b };
  }

  function applyPreProcess(ch, brightness, contrast, gamma) {
    const n = ch.length, out = new Float32Array(n);
    const br = brightness * 2.55;
    const cf = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const ig = 1 / gamma;
    for (let i = 0; i < n; i++) {
      let v = cf * (ch[i] + br - 128) + 128;
      out[i] = 255 * Math.pow(Math.max(0, v / 255), ig);
    }
    return out;
  }

  function getDownsampled(maxDim) {
    if (!sourceData) return null;
    const w = sourceData.width, h = sourceData.height;
    if (w <= maxDim && h <= maxDim) return sourceData;
    const scale = maxDim / Math.max(w, h);
    const nw = Math.round(w * scale), nh = Math.round(h * scale);
    const c = document.createElement('canvas');
    c.width = nw; c.height = nh;
    const ctx = c.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0, nw, nh);
    return ctx.getImageData(0, 0, nw, nh);
  }

  // ── Color Quantization (Median Cut) ──
  function medianCut(pixels, maxColors) {
    if (pixels.length <= maxColors) return pixels;
    function splitBucket(bucket) {
      let minR=255,maxR=0,minG=255,maxG=0,minB=255,maxB=0;
      for (const [r,g,b] of bucket) {
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (g < minG) minG = g; if (g > maxG) maxG = g;
        if (b < minB) minB = b; if (b > maxB) maxB = b;
      }
      const rR = maxR-minR, rG = maxG-minG, rB = maxB-minB;
      const ch = rR >= rG && rR >= rB ? 0 : rG >= rB ? 1 : 2;
      bucket.sort((a, b) => a[ch] - b[ch]);
      const mid = bucket.length >> 1;
      return [bucket.slice(0, mid), bucket.slice(mid)];
    }
    let buckets = [pixels.slice()];
    while (buckets.length < maxColors) {
      let li = 0, ls = 0;
      for (let i = 0; i < buckets.length; i++) if (buckets[i].length > ls) { ls = buckets[i].length; li = i; }
      if (ls <= 1) break;
      const [a, b] = splitBucket(buckets[li]);
      buckets.splice(li, 1, a, b);
    }
    return buckets.map(b => {
      let sr=0, sg=0, sb=0;
      for (const [r,g,bb] of b) { sr+=r; sg+=g; sb+=bb; }
      const n = b.length;
      return [Math.round(sr/n), Math.round(sg/n), Math.round(sb/n)];
    });
  }

  function nearestColor(r, g, b, palette) {
    let minDist = Infinity, best = palette[0];
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const d = (r-c[0])**2 + (g-c[1])**2 + (b-c[2])**2;
      if (d < minDist) { minDist = d; best = c; }
    }
    return best;
  }

  // ── Palette presets ──
  const PALETTES = {
    'bw': [[0,0,0],[255,255,255]],
    'gameboy': [[15,56,15],[48,98,48],[139,172,15],[155,188,15]],
    'cga': [[0,0,0],[0,170,170],[170,0,170],[170,170,170]],
    'commodore64': [[0,0,0],[255,255,255],[136,0,0],[170,255,238],[204,68,204],[0,204,85],[0,0,170],[238,238,119],[221,136,85],[102,68,0],[255,119,119],[51,51,51],[119,119,119],[170,255,102],[0,136,255],[187,187,187]],
    'nes': [[0,0,0],[252,252,252],[188,188,188],[124,124,124],[168,0,16],[248,56,0],[228,92,16],[248,120,88],[0,0,188],[0,120,248],[104,68,252],[152,120,248],[0,88,0],[0,168,0],[88,216,84],[184,248,24]],
    'pico8': [[0,0,0],[29,43,83],[126,37,83],[0,135,81],[171,82,54],[95,87,79],[194,195,199],[255,241,232],[255,0,77],[255,163,0],[255,236,39],[0,228,54],[41,173,255],[131,118,156],[255,119,168],[255,204,170]],
    'grayscale4': [[0,0,0],[85,85,85],[170,170,170],[255,255,255]],
    'grayscale8': [[0,0,0],[36,36,36],[73,73,73],[109,109,109],[146,146,146],[182,182,182],[219,219,219],[255,255,255]],
    'sepia': [[44,31,18],[101,67,33],[181,137,77],[255,223,156],[255,245,225]],
    'cyberpunk': [[13,2,33],[87,17,119],[255,0,102],[0,255,204],[255,255,255]],
    'vapourwave': [[255,113,206],[1,205,254],[5,255,161],[185,103,255],[254,228,64]],
    'autumn': [[44,22,8],[139,69,19],[205,133,63],[218,165,32],[255,215,0],[34,85,34]],
    'ocean': [[0,10,30],[0,40,80],[0,100,150],[70,180,220],[180,230,250],[255,255,255]],
    'sunset': [[25,10,40],[80,20,50],[180,40,50],[230,100,50],[250,180,80],[255,240,200]],
    'neon': [[0,0,0],[255,0,100],[0,255,100],[100,0,255],[255,255,0],[0,200,255]],
    'pastel': [[255,179,186],[255,223,186],[255,255,186],[186,255,201],[186,225,255]],
    'earth': [[59,47,37],[107,84,56],[164,133,88],[196,178,128],[229,222,187],[82,119,72]],
    'candy': [[255,50,120],[255,150,50],[255,230,80],[100,220,140],[80,170,255],[180,100,255]],
    'monochrome-blue': [[8,12,30],[20,40,80],[40,80,150],[80,140,220],[160,200,245],[230,240,255]]
  };

  function getPalettePresets() { return Object.keys(PALETTES); }
  function getPalette(name) { return PALETTES[name] ? PALETTES[name].map(c => [...c]) : null; }

  // ── Advanced Blending Helpers ──
  function quickHash(i) { let h = i * 2654435761; h ^= h >>> 16; return (h & 0x7fffffff) / 0x7fffffff; }

  function calcEdgeAlpha(srcLum, bp, wp, feather, edgeMode, pixelIdx) {
    if (srcLum >= bp && srcLum <= wp) {
      if (feather <= 0 || edgeMode === 'hard') return 1;
      let alpha = 1;
      if (edgeMode === 'dissolve') {
        if (srcLum < bp + feather) {
          const t = (srcLum - bp) / feather;
          alpha = quickHash(pixelIdx * 31 + bp) < t ? 1 : 0;
        } else if (srcLum > wp - feather) {
          const t = (wp - srcLum) / feather;
          alpha = quickHash(pixelIdx * 37 + wp) < t ? 1 : 0;
        }
      } else {
        if (srcLum < bp + feather) alpha = (srcLum - bp) / feather;
        else if (srcLum > wp - feather) alpha = (wp - srcLum) / feather;
        alpha = Math.max(0, Math.min(1, alpha));
      }
      return alpha;
    }
    if (edgeMode === 'dissolve' && feather > 0) {
      if (srcLum >= bp - feather && srcLum < bp) {
        const t = (srcLum - (bp - feather)) / feather;
        return quickHash(pixelIdx * 41 + bp) < t * 0.3 ? 1 : 0;
      }
      if (srcLum > wp && srcLum <= wp + feather) {
        const t = ((wp + feather) - srcLum) / feather;
        return quickHash(pixelIdx * 43 + wp) < t * 0.3 ? 1 : 0;
      }
    }
    return 0;
  }

  function calcToneAlpha(srcLum, toneResponse) {
    const t = srcLum / 255;
    const strength = Math.abs(toneResponse) / 100;
    if (toneResponse > 0) {
      return 1 - strength * t;
    } else {
      return 1 - strength * (1 - t);
    }
  }

  // ── Tone Lock: returns alpha (0=locked, 1=free) based on locked ranges ──
  function calcToneLockAlpha(srcLum, toneLock) {
    if (!toneLock) return 1;
    const { shadows, midtones, highlights, shadowMid, midHighlight } = toneLock;
    if (!shadows && !midtones && !highlights) return 1;

    // Determine which zone this pixel is in with smooth transitions
    const feather = 15; // smooth zone transitions
    let inShadow = 0, inMid = 0, inHigh = 0;

    if (srcLum <= shadowMid - feather) inShadow = 1;
    else if (srcLum <= shadowMid + feather) {
      const t = (srcLum - (shadowMid - feather)) / (feather * 2);
      inShadow = 1 - t; inMid = t;
    } else if (srcLum <= midHighlight - feather) inMid = 1;
    else if (srcLum <= midHighlight + feather) {
      const t = (srcLum - (midHighlight - feather)) / (feather * 2);
      inMid = 1 - t; inHigh = t;
    } else inHigh = 1;

    // Locked zones reduce alpha to 0
    let lockAmount = 0;
    if (shadows) lockAmount += inShadow;
    if (midtones) lockAmount += inMid;
    if (highlights) lockAmount += inHigh;

    return Math.max(0, 1 - lockAmount);
  }

  // ── Blend Modes (full 22-mode set, shared with grain) ──
  // a = base (0-255), b = top (0-255). Accepts both camelCase (legacy) and hyphen-case names.
  function clamp01b(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function blendPixel(a, b, mode) {
    const an = a / 255, bn = b / 255;
    let r;
    switch (mode) {
      case 'normal': r = bn; break;
      case 'dissolve': r = bn; break; // handled at layer level if needed
      case 'multiply': r = an * bn; break;
      case 'darken': r = Math.min(an, bn); break;
      case 'color-burn': case 'colorBurn': r = bn <= 0 ? 0 : 1 - clamp01b((1 - an) / bn); break;
      case 'linear-burn': case 'linearBurn': r = an + bn - 1; break;
      case 'screen': r = 1 - (1 - an) * (1 - bn); break;
      case 'lighten': r = Math.max(an, bn); break;
      case 'color-dodge': case 'colorDodge': r = bn >= 1 ? 1 : clamp01b(an / (1 - bn)); break;
      case 'linear-dodge': case 'linearDodge': case 'add': r = an + bn; break;
      case 'overlay': r = an < 0.5 ? 2 * an * bn : 1 - 2 * (1 - an) * (1 - bn); break;
      case 'soft-light': case 'softLight':
        r = bn < 0.5 ? an - (1 - 2 * bn) * an * (1 - an)
                     : an + (2 * bn - 1) * (an < 0.25 ? ((16 * an - 12) * an + 4) * an : Math.sqrt(an) - an); break;
      case 'hard-light': case 'hardLight':
        r = bn < 0.5 ? 2 * an * bn : 1 - 2 * (1 - an) * (1 - bn); break;
      case 'vivid-light': case 'vividLight':
        r = bn <= 0.5 ? (bn <= 0 ? 0 : 1 - clamp01b((1 - an) / (2 * bn)))
                      : (bn >= 1 ? 1 : clamp01b(an / (2 * (1 - bn)))); break;
      case 'linear-light': case 'linearLight': r = an + 2 * bn - 1; break;
      case 'pin-light': case 'pinLight':
        r = bn < 0.5 ? Math.min(an, 2 * bn) : Math.max(an, 2 * bn - 1); break;
      case 'hard-mix': case 'hardMix': r = (an + bn >= 1) ? 1 : 0; break;
      case 'difference': r = Math.abs(an - bn); break;
      case 'exclusion': r = an + bn - 2 * an * bn; break;
      case 'subtract': r = an - bn; break;
      case 'divide': r = bn <= 0 ? 1 : clamp01b(an / bn); break;
      case 'luminosity': r = bn; break; // simplified
      case 'negation': r = 1 - Math.abs(1 - an - bn); break;
      case 'reflect': r = bn >= 1 ? 1 : clamp01b(an * an / (1 - bn)); break;
      case 'glow': r = an >= 1 ? 1 : clamp01b(bn * bn / (1 - an)); break;
      default: r = bn; break;
    }
    return clamp01b(r) * 255;
  }

  // ── Main Process ──
  function process(pipeline, globals, previewMaxDim) {
    if (!sourceData) return null;
    const data = previewMaxDim ? getDownsampled(previewMaxDim) : sourceData;
    if (!data) return null;
    const w = data.width, h = data.height;
    const colorMode = globals.colorMode;

    if (colorMode === 'color') return processColorDither(pipeline, globals, w, h, data);
    if (colorMode === 'palette') return processPaletteDither(pipeline, globals, w, h, data);
    return processGrayscaleDither(pipeline, globals, w, h, data);
  }

  // Async variant: same output as `process`, but yields control between
  // pipeline steps + between R/G/B channels (and also asks the algorithm
  // itself to yield via applyAsync if supported). Keeps the page responsive
  // during long renders and supports cancellation + progressive preview.
  // opts: { signal: { cancelled }, onProgress: (ImageData)=>void }
  async function processAsync(pipeline, globals, previewMaxDim, opts) {
    if (!sourceData) return null;
    const data = previewMaxDim ? getDownsampled(previewMaxDim) : sourceData;
    if (!data) return null;
    const w = data.width, h = data.height;
    const colorMode = globals.colorMode;
    const signal = (opts && opts.signal) || { cancelled: false };
    const onProgress = (opts && opts.onProgress) || null;

    if (colorMode === 'color') return processColorDitherAsync(pipeline, globals, w, h, data, signal, onProgress);
    if (colorMode === 'palette') return processPaletteDitherAsync(pipeline, globals, w, h, data, signal, onProgress);
    return processGrayscaleDitherAsync(pipeline, globals, w, h, data, signal, onProgress);
  }

  // Yield helper: lets the browser paint + pump input events between chunks.
  function yieldTick() { return new Promise(r => setTimeout(r, 0)); }

  // Run a step's apply() — use applyAsync if the algorithm provides one.
  async function runApply(step, channel, w, h, onStepProgress, signal) {
    if (step.algorithm.applyAsync) {
      return await step.algorithm.applyAsync(channel, w, h, step.params, { signal, onProgress: onStepProgress });
    }
    return step.algorithm.apply(channel, w, h, step.params);
  }

  function processGrayscaleDither(pipeline, globals, w, h, data) {
    let gray = toGrayscale(data, w, h, globals.grayscaleMode || 'luminance');
    gray = applyPreProcess(gray, globals.brightness, globals.contrast, globals.gamma);
    const origGray = gray;
    const toneLock = globals.toneLock;

    if (pipeline.length === 0) {
      const result = new ImageData(w, h);
      for (let i = 0; i < w*h; i++) {
        const v = clampByte(gray[i]);
        result.data[i*4] = result.data[i*4+1] = result.data[i*4+2] = v;
        result.data[i*4+3] = 255;
      }
      return result;
    }

    let current = new Float32Array(gray);
    const n = w * h;

    for (let pi = 0; pi < pipeline.length; pi++) {
      const step = pipeline[pi];
      const useOrig = step.params._useOriginal || false;
      const inputData = useOrig ? new Float32Array(origGray) : new Float32Array(current);
      const dithResult = step.algorithm.apply(inputData, w, h, step.params);
      const mix = step.params._mix || 0;
      const inv = step.params._invert || false;
      const bp = step.params._blackPoint || 0;
      const wp = step.params._whitePoint === undefined ? 255 : step.params._whitePoint;
      const hasBWClip = bp > 0 || wp < 255;
      const feather = step.params._feather === undefined ? 10 : step.params._feather;
      const edgeMode = step.params._edgeMode || 'soft';
      const toneResponse = step.params._toneResponse || 0;
      const blendMode = step.params._blendMode || 'normal';

      const blended = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        let v = dithResult[j];
        if (mix > 0) v = v * (1 - mix) + origGray[j] * mix;

        // Apply blend mode. For pi>0 we blend against the accumulated pipeline
        // so far. For pi===0 there is no prior step, so we blend against the
        // ORIGINAL image — that way a single-step pipeline with e.g. 'overlay'
        // actually composites the dither against the source instead of being
        // a no-op. Also apply when useOrig is set to force the same behavior.
        if (blendMode !== 'normal') {
          const base = pi > 0 ? current[j] : origGray[j];
          v = blendPixel(base, v, blendMode);
        }

        let effectAlpha = 1;
        if (hasBWClip) effectAlpha = calcEdgeAlpha(origGray[j], bp, wp, feather, edgeMode, j);
        if (toneResponse !== 0) effectAlpha *= calcToneAlpha(origGray[j], toneResponse);
        if (inv) effectAlpha = 1 - effectAlpha;
        // Tone lock
        effectAlpha *= calcToneLockAlpha(origGray[j], toneLock);
        if (effectAlpha < 1) {
          v = v * effectAlpha + current[j] * (1 - effectAlpha);
        }
        blended[j] = v;
      }
      current = blended;
    }

    const dk = globals.colorDark, lt = globals.colorLight;
    const result = new ImageData(w, h);
    const rd = result.data;
    for (let i = 0; i < n; i++) {
      const t = clampByte(current[i]) / 255;
      const o = i * 4;
      rd[o]   = dk[0] + (lt[0]-dk[0]) * t;
      rd[o+1] = dk[1] + (lt[1]-dk[1]) * t;
      rd[o+2] = dk[2] + (lt[2]-dk[2]) * t;
      rd[o+3] = 255;
    }
    return result;
  }

  function processColorDither(pipeline, globals, w, h, data) {
    const ch = toChannels(data, w, h);
    let rCh = applyPreProcess(ch.r, globals.brightness, globals.contrast, globals.gamma);
    let gCh = applyPreProcess(ch.g, globals.brightness, globals.contrast, globals.gamma);
    let bCh = applyPreProcess(ch.b, globals.brightness, globals.contrast, globals.gamma);

    const origR = new Float32Array(rCh), origG = new Float32Array(gCh), origB = new Float32Array(bCh);
    const n = w * h;
    const grayRef = new Float32Array(n);
    for (let i = 0; i < n; i++) grayRef[i] = 0.2126 * origR[i] + 0.7152 * origG[i] + 0.0722 * origB[i];
    const toneLock = globals.toneLock;

    for (let pi = 0; pi < pipeline.length; pi++) {
      const step = pipeline[pi];
      const mix = step.params._mix || 0;
      const inv = step.params._invert || false;
      const bp = step.params._blackPoint || 0;
      const wp = step.params._whitePoint === undefined ? 255 : step.params._whitePoint;
      const hasBWClip = bp > 0 || wp < 255;
      const feather = step.params._feather === undefined ? 10 : step.params._feather;
      const edgeMode = step.params._edgeMode || 'soft';
      const toneResponse = step.params._toneResponse || 0;
      const blendMode = step.params._blendMode || 'normal';
      const useOrig = step.params._useOriginal || false;

      const inR = useOrig ? new Float32Array(origR) : new Float32Array(rCh);
      const inG = useOrig ? new Float32Array(origG) : new Float32Array(gCh);
      const inB = useOrig ? new Float32Array(origB) : new Float32Array(bCh);
      const drR = step.algorithm.apply(inR, w, h, step.params);
      const drG = step.algorithm.apply(inG, w, h, step.params);
      const drB = step.algorithm.apply(inB, w, h, step.params);
      const prevR = new Float32Array(rCh), prevG = new Float32Array(gCh), prevB = new Float32Array(bCh);
      for (let j = 0; j < n; j++) {
        let vr = drR[j], vg = drG[j], vb = drB[j];
        if (mix > 0) {
          vr = vr*(1-mix) + origR[j]*mix;
          vg = vg*(1-mix) + origG[j]*mix;
          vb = vb*(1-mix) + origB[j]*mix;
        }
        if (blendMode !== 'normal') {
          const br = pi > 0 ? prevR[j] : origR[j];
          const bg = pi > 0 ? prevG[j] : origG[j];
          const bb = pi > 0 ? prevB[j] : origB[j];
          vr = blendPixel(br, vr, blendMode);
          vg = blendPixel(bg, vg, blendMode);
          vb = blendPixel(bb, vb, blendMode);
        }
        let effectAlpha = 1;
        if (hasBWClip) effectAlpha = calcEdgeAlpha(grayRef[j], bp, wp, feather, edgeMode, j);
        if (toneResponse !== 0) effectAlpha *= calcToneAlpha(grayRef[j], toneResponse);
        if (inv) effectAlpha = 1 - effectAlpha;
        effectAlpha *= calcToneLockAlpha(grayRef[j], toneLock);
        if (effectAlpha < 1) {
          vr = vr * effectAlpha + prevR[j] * (1 - effectAlpha);
          vg = vg * effectAlpha + prevG[j] * (1 - effectAlpha);
          vb = vb * effectAlpha + prevB[j] * (1 - effectAlpha);
        }
        rCh[j] = vr; gCh[j] = vg; bCh[j] = vb;
      }
    }

    const result = new ImageData(w, h);
    const rd = result.data;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      rd[o] = clampByte(rCh[i]); rd[o+1] = clampByte(gCh[i]); rd[o+2] = clampByte(bCh[i]); rd[o+3] = 255;
    }
    return result;
  }

  function processPaletteDither(pipeline, globals, w, h, data) {
    let palette = globals.palette;
    if (!palette || palette.length === 0) palette = [[0,0,0],[255,255,255]];
    if (globals.maxColors > 0 && globals.maxColors < palette.length) palette = palette.slice(0, globals.maxColors);

    const ch = toChannels(data, w, h);
    let rCh = applyPreProcess(ch.r, globals.brightness, globals.contrast, globals.gamma);
    let gCh = applyPreProcess(ch.g, globals.brightness, globals.contrast, globals.gamma);
    let bCh = applyPreProcess(ch.b, globals.brightness, globals.contrast, globals.gamma);

    const n = w * h;
    const toneLock = globals.toneLock;

    if (pipeline.length > 0) {
      const origR = new Float32Array(rCh), origG = new Float32Array(gCh), origB = new Float32Array(bCh);
      const grayRef = new Float32Array(n);
      for (let i = 0; i < n; i++) grayRef[i] = 0.2126 * origR[i] + 0.7152 * origG[i] + 0.0722 * origB[i];

      for (let pi = 0; pi < pipeline.length; pi++) {
        const step = pipeline[pi];
        const mix = step.params._mix || 0;
        const inv = step.params._invert || false;
        const bp = step.params._blackPoint || 0;
        const wp = step.params._whitePoint === undefined ? 255 : step.params._whitePoint;
        const hasBWClip = bp > 0 || wp < 255;
        const feather = step.params._feather === undefined ? 10 : step.params._feather;
        const edgeMode = step.params._edgeMode || 'soft';
        const toneResponse = step.params._toneResponse || 0;
        const blendMode = step.params._blendMode || 'normal';
        const useOrig = step.params._useOriginal || false;

        const inR = useOrig ? new Float32Array(origR) : new Float32Array(rCh);
        const inG = useOrig ? new Float32Array(origG) : new Float32Array(gCh);
        const inB = useOrig ? new Float32Array(origB) : new Float32Array(bCh);
        const drR = step.algorithm.apply(inR, w, h, step.params);
        const drG = step.algorithm.apply(inG, w, h, step.params);
        const drB = step.algorithm.apply(inB, w, h, step.params);
        const prevR = new Float32Array(rCh), prevG = new Float32Array(gCh), prevB = new Float32Array(bCh);
        for (let j = 0; j < n; j++) {
          let vr = drR[j], vg = drG[j], vb = drB[j];
          if (mix > 0) {
            vr = vr*(1-mix) + origR[j]*mix;
            vg = vg*(1-mix) + origG[j]*mix;
            vb = vb*(1-mix) + origB[j]*mix;
          }
          if (blendMode !== 'normal') {
            const br = pi > 0 ? prevR[j] : origR[j];
            const bg = pi > 0 ? prevG[j] : origG[j];
            const bb = pi > 0 ? prevB[j] : origB[j];
            vr = blendPixel(br, vr, blendMode);
            vg = blendPixel(bg, vg, blendMode);
            vb = blendPixel(bb, vb, blendMode);
          }
          let effectAlpha = 1;
          if (hasBWClip) effectAlpha = calcEdgeAlpha(grayRef[j], bp, wp, feather, edgeMode, j);
          if (toneResponse !== 0) effectAlpha *= calcToneAlpha(grayRef[j], toneResponse);
          if (inv) effectAlpha = 1 - effectAlpha;
          effectAlpha *= calcToneLockAlpha(grayRef[j], toneLock);
          if (effectAlpha < 1) {
            vr = vr * effectAlpha + prevR[j] * (1 - effectAlpha);
            vg = vg * effectAlpha + prevG[j] * (1 - effectAlpha);
            vb = vb * effectAlpha + prevB[j] * (1 - effectAlpha);
          }
          rCh[j] = vr; gCh[j] = vg; bCh[j] = vb;
        }
      }
    }

    // Final quantization to palette
    const result = new ImageData(w, h);
    const rd = result.data;
    const rBuf = new Float32Array(rCh), gBuf = new Float32Array(gCh), bBuf = new Float32Array(bCh);
    const dm = [[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]];
    for (let y = 0; y < h; y++) {
      const ltr = y % 2 === 0;
      const sx = ltr ? 0 : w-1, ex = ltr ? w : -1, dx = ltr ? 1 : -1;
      for (let x = sx; x !== ex; x += dx) {
        const i = y*w+x, o = i*4;
        const or2 = clampByte(rBuf[i]), og = clampByte(gBuf[i]), ob = clampByte(bBuf[i]);
        const [nr, ng, nb] = nearestColor(or2, og, ob, palette);
        rd[o] = nr; rd[o+1] = ng; rd[o+2] = nb; rd[o+3] = 255;
        const er = (or2-nr)*.7, eg = (og-ng)*.7, eb = (ob-nb)*.7;
        for (const [mdx, mdy, mw] of dm) {
          const nx = x + (ltr ? mdx : -mdx), ny = y + mdy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const ni = ny*w+nx;
            rBuf[ni] += er*mw; gBuf[ni] += eg*mw; bBuf[ni] += eb*mw;
          }
        }
      }
    }
    return result;
  }

  // ── Async variants ────────────────────────────────────────────────
  // These mirror processGrayscaleDither / processColorDither / processPaletteDither
  // but yield between pipeline steps and between color channels, and call
  // onProgress with an ImageData render of the current accumulated state so
  // the user sees block-by-block transformation during long renders.

  async function processGrayscaleDitherAsync(pipeline, globals, w, h, data, signal, onProgress) {
    let gray = toGrayscale(data, w, h, globals.grayscaleMode || 'luminance');
    gray = applyPreProcess(gray, globals.brightness, globals.contrast, globals.gamma);
    const origGray = gray;
    const toneLock = globals.toneLock;
    const n = w * h;
    const dk = globals.colorDark, lt = globals.colorLight;

    const renderGrayToImageData = (buf) => {
      const out = new ImageData(w, h);
      const rd = out.data;
      for (let i = 0; i < n; i++) {
        const t = clampByte(buf[i]) / 255;
        const o = i * 4;
        rd[o]   = dk[0] + (lt[0]-dk[0]) * t;
        rd[o+1] = dk[1] + (lt[1]-dk[1]) * t;
        rd[o+2] = dk[2] + (lt[2]-dk[2]) * t;
        rd[o+3] = 255;
      }
      return out;
    };

    if (pipeline.length === 0) {
      const result = new ImageData(w, h);
      for (let i = 0; i < n; i++) {
        const v = clampByte(gray[i]);
        result.data[i*4] = result.data[i*4+1] = result.data[i*4+2] = v;
        result.data[i*4+3] = 255;
      }
      return result;
    }

    let current = new Float32Array(gray);

    for (let pi = 0; pi < pipeline.length; pi++) {
      if (signal.cancelled) return null;
      const step = pipeline[pi];
      const useOrig = step.params._useOriginal || false;
      const inputData = useOrig ? new Float32Array(origGray) : new Float32Array(current);

      // Intermediate progress preview: feed algorithm's partial outputs
      // back through the final tone map so the canvas shows real pixels.
      let lastProgressTs = 0;
      const onStepProgress = onProgress ? (partialBuf) => {
        const now = performance.now();
        if (now - lastProgressTs < 40) return;  // throttle to ~25fps
        lastProgressTs = now;
        onProgress(renderGrayToImageData(partialBuf));
      } : null;

      const dithResult = await runApply(step, inputData, w, h, onStepProgress, signal);
      if (signal.cancelled) return null;

      const mix = step.params._mix || 0;
      const inv = step.params._invert || false;
      const bp = step.params._blackPoint || 0;
      const wp = step.params._whitePoint === undefined ? 255 : step.params._whitePoint;
      const hasBWClip = bp > 0 || wp < 255;
      const feather = step.params._feather === undefined ? 10 : step.params._feather;
      const edgeMode = step.params._edgeMode || 'soft';
      const toneResponse = step.params._toneResponse || 0;
      const blendMode = step.params._blendMode || 'normal';

      const blended = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        let v = dithResult[j];
        if (mix > 0) v = v * (1 - mix) + origGray[j] * mix;
        if (blendMode !== 'normal') {
          const base = pi > 0 ? current[j] : origGray[j];
          v = blendPixel(base, v, blendMode);
        }
        let effectAlpha = 1;
        if (hasBWClip) effectAlpha = calcEdgeAlpha(origGray[j], bp, wp, feather, edgeMode, j);
        if (toneResponse !== 0) effectAlpha *= calcToneAlpha(origGray[j], toneResponse);
        if (inv) effectAlpha = 1 - effectAlpha;
        effectAlpha *= calcToneLockAlpha(origGray[j], toneLock);
        if (effectAlpha < 1) v = v * effectAlpha + current[j] * (1 - effectAlpha);
        blended[j] = v;
      }
      current = blended;

      if (onProgress) onProgress(renderGrayToImageData(current));
      await yieldTick();
    }

    return renderGrayToImageData(current);
  }

  async function processColorDitherAsync(pipeline, globals, w, h, data, signal, onProgress) {
    const ch = toChannels(data, w, h);
    let rCh = applyPreProcess(ch.r, globals.brightness, globals.contrast, globals.gamma);
    let gCh = applyPreProcess(ch.g, globals.brightness, globals.contrast, globals.gamma);
    let bCh = applyPreProcess(ch.b, globals.brightness, globals.contrast, globals.gamma);

    const origR = new Float32Array(rCh), origG = new Float32Array(gCh), origB = new Float32Array(bCh);
    const n = w * h;
    const grayRef = new Float32Array(n);
    for (let i = 0; i < n; i++) grayRef[i] = 0.2126 * origR[i] + 0.7152 * origG[i] + 0.0722 * origB[i];
    const toneLock = globals.toneLock;

    const renderRGBToImageData = (rBuf, gBuf, bBuf) => {
      const out = new ImageData(w, h);
      const rd = out.data;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        rd[o] = clampByte(rBuf[i]); rd[o+1] = clampByte(gBuf[i]); rd[o+2] = clampByte(bBuf[i]); rd[o+3] = 255;
      }
      return out;
    };

    for (let pi = 0; pi < pipeline.length; pi++) {
      if (signal.cancelled) return null;
      const step = pipeline[pi];
      const mix = step.params._mix || 0;
      const inv = step.params._invert || false;
      const bp = step.params._blackPoint || 0;
      const wp = step.params._whitePoint === undefined ? 255 : step.params._whitePoint;
      const hasBWClip = bp > 0 || wp < 255;
      const feather = step.params._feather === undefined ? 10 : step.params._feather;
      const edgeMode = step.params._edgeMode || 'soft';
      const toneResponse = step.params._toneResponse || 0;
      const blendMode = step.params._blendMode || 'normal';
      const useOrig = step.params._useOriginal || false;

      const inR = useOrig ? new Float32Array(origR) : new Float32Array(rCh);
      const inG = useOrig ? new Float32Array(origG) : new Float32Array(gCh);
      const inB = useOrig ? new Float32Array(origB) : new Float32Array(bCh);

      // Per-channel progress: during intermediate channel renders we only
      // have valid data for one axis. Showing (partial_R, origG, origB)
      // produces confusing color tints, so instead we render the partial
      // buffer as a grayscale preview — it reads as "painting in progress"
      // without implying a final color that isn't there yet.
      let lastProgressTs = 0;
      const onPartialChannelProgress = onProgress ? (partial) => {
        const now = performance.now();
        if (now - lastProgressTs < 60) return;
        lastProgressTs = now;
        onProgress(renderRGBToImageData(partial, partial, partial));
      } : null;

      const drR = await runApply(step, inR, w, h, onPartialChannelProgress, signal);
      if (signal.cancelled) return null;
      // Between channels, show R as full grayscale snapshot so user sees a
      // visible milestone even if the next channel starts slow.
      if (onProgress) onProgress(renderRGBToImageData(drR, drR, drR));
      await yieldTick();
      const drG = await runApply(step, inG, w, h, onPartialChannelProgress, signal);
      if (signal.cancelled) return null;
      if (onProgress) onProgress(renderRGBToImageData(drR, drG, drG));
      await yieldTick();
      const drB = await runApply(step, inB, w, h, onPartialChannelProgress, signal);
      if (signal.cancelled) return null;

      const prevR = new Float32Array(rCh), prevG = new Float32Array(gCh), prevB = new Float32Array(bCh);
      for (let j = 0; j < n; j++) {
        let vr = drR[j], vg = drG[j], vb = drB[j];
        if (mix > 0) { vr = vr*(1-mix) + origR[j]*mix; vg = vg*(1-mix) + origG[j]*mix; vb = vb*(1-mix) + origB[j]*mix; }
        if (blendMode !== 'normal') {
          const br = pi > 0 ? prevR[j] : origR[j];
          const bg = pi > 0 ? prevG[j] : origG[j];
          const bb = pi > 0 ? prevB[j] : origB[j];
          vr = blendPixel(br, vr, blendMode);
          vg = blendPixel(bg, vg, blendMode);
          vb = blendPixel(bb, vb, blendMode);
        }
        let effectAlpha = 1;
        if (hasBWClip) effectAlpha = calcEdgeAlpha(grayRef[j], bp, wp, feather, edgeMode, j);
        if (toneResponse !== 0) effectAlpha *= calcToneAlpha(grayRef[j], toneResponse);
        if (inv) effectAlpha = 1 - effectAlpha;
        effectAlpha *= calcToneLockAlpha(grayRef[j], toneLock);
        if (effectAlpha < 1) {
          vr = vr * effectAlpha + prevR[j] * (1 - effectAlpha);
          vg = vg * effectAlpha + prevG[j] * (1 - effectAlpha);
          vb = vb * effectAlpha + prevB[j] * (1 - effectAlpha);
        }
        rCh[j] = vr; gCh[j] = vg; bCh[j] = vb;
      }

      if (onProgress) onProgress(renderRGBToImageData(rCh, gCh, bCh));
      await yieldTick();
    }

    return renderRGBToImageData(rCh, gCh, bCh);
  }

  async function processPaletteDitherAsync(pipeline, globals, w, h, data, signal, onProgress) {
    // For palette mode, the final FS-dither serial loop is fast enough that
    // we only bother yielding between pipeline steps / channels.
    let palette = globals.palette;
    if (!palette || palette.length === 0) palette = [[0,0,0],[255,255,255]];
    if (globals.maxColors > 0 && globals.maxColors < palette.length) palette = palette.slice(0, globals.maxColors);

    const ch = toChannels(data, w, h);
    let rCh = applyPreProcess(ch.r, globals.brightness, globals.contrast, globals.gamma);
    let gCh = applyPreProcess(ch.g, globals.brightness, globals.contrast, globals.gamma);
    let bCh = applyPreProcess(ch.b, globals.brightness, globals.contrast, globals.gamma);

    const n = w * h;
    const toneLock = globals.toneLock;

    if (pipeline.length > 0) {
      const origR = new Float32Array(rCh), origG = new Float32Array(gCh), origB = new Float32Array(bCh);
      const grayRef = new Float32Array(n);
      for (let i = 0; i < n; i++) grayRef[i] = 0.2126 * origR[i] + 0.7152 * origG[i] + 0.0722 * origB[i];

      for (let pi = 0; pi < pipeline.length; pi++) {
        if (signal.cancelled) return null;
        const step = pipeline[pi];
        const mix = step.params._mix || 0;
        const inv = step.params._invert || false;
        const bp = step.params._blackPoint || 0;
        const wp = step.params._whitePoint === undefined ? 255 : step.params._whitePoint;
        const hasBWClip = bp > 0 || wp < 255;
        const feather = step.params._feather === undefined ? 10 : step.params._feather;
        const edgeMode = step.params._edgeMode || 'soft';
        const toneResponse = step.params._toneResponse || 0;
        const blendMode = step.params._blendMode || 'normal';
        const useOrig = step.params._useOriginal || false;

        const inR = useOrig ? new Float32Array(origR) : new Float32Array(rCh);
        const inG = useOrig ? new Float32Array(origG) : new Float32Array(gCh);
        const inB = useOrig ? new Float32Array(origB) : new Float32Array(bCh);

        const drR = await runApply(step, inR, w, h, null, signal);
        if (signal.cancelled) return null;
        await yieldTick();
        const drG = await runApply(step, inG, w, h, null, signal);
        if (signal.cancelled) return null;
        await yieldTick();
        const drB = await runApply(step, inB, w, h, null, signal);
        if (signal.cancelled) return null;

        const prevR = new Float32Array(rCh), prevG = new Float32Array(gCh), prevB = new Float32Array(bCh);
        for (let j = 0; j < n; j++) {
          let vr = drR[j], vg = drG[j], vb = drB[j];
          if (mix > 0) { vr = vr*(1-mix) + origR[j]*mix; vg = vg*(1-mix) + origG[j]*mix; vb = vb*(1-mix) + origB[j]*mix; }
          if (blendMode !== 'normal') {
            const br = pi > 0 ? prevR[j] : origR[j];
            const bg = pi > 0 ? prevG[j] : origG[j];
            const bb = pi > 0 ? prevB[j] : origB[j];
            vr = blendPixel(br, vr, blendMode);
            vg = blendPixel(bg, vg, blendMode);
            vb = blendPixel(bb, vb, blendMode);
          }
          let effectAlpha = 1;
          if (hasBWClip) effectAlpha = calcEdgeAlpha(grayRef[j], bp, wp, feather, edgeMode, j);
          if (toneResponse !== 0) effectAlpha *= calcToneAlpha(grayRef[j], toneResponse);
          if (inv) effectAlpha = 1 - effectAlpha;
          effectAlpha *= calcToneLockAlpha(grayRef[j], toneLock);
          if (effectAlpha < 1) {
            vr = vr * effectAlpha + prevR[j] * (1 - effectAlpha);
            vg = vg * effectAlpha + prevG[j] * (1 - effectAlpha);
            vb = vb * effectAlpha + prevB[j] * (1 - effectAlpha);
          }
          rCh[j] = vr; gCh[j] = vg; bCh[j] = vb;
        }

        await yieldTick();
      }
    }

    // Final FS dither to palette (serial; fast enough to be synchronous)
    const result = new ImageData(w, h);
    const rd = result.data;
    const rBuf = new Float32Array(rCh), gBuf = new Float32Array(gCh), bBuf = new Float32Array(bCh);
    const dm = [[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]];
    for (let y = 0; y < h; y++) {
      const ltr = y % 2 === 0;
      const sx = ltr ? 0 : w-1, ex = ltr ? w : -1, dx = ltr ? 1 : -1;
      for (let x = sx; x !== ex; x += dx) {
        const i = y*w+x, o = i*4;
        const or2 = clampByte(rBuf[i]), og = clampByte(gBuf[i]), ob = clampByte(bBuf[i]);
        const [nr, ng, nb] = nearestColor(or2, og, ob, palette);
        rd[o] = nr; rd[o+1] = ng; rd[o+2] = nb; rd[o+3] = 255;
        const er = (or2-nr)*.7, eg = (og-ng)*.7, eb = (ob-nb)*.7;
        for (const [mdx, mdy, mw] of dm) {
          const nx = x + (ltr ? mdx : -mdx), ny = y + mdy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const ni = ny*w+nx;
            rBuf[ni] += er*mw; gBuf[ni] += eg*mw; bBuf[ni] += eb*mw;
          }
        }
      }
    }
    return result;
  }

  function exportFullSize(pipeline, globals) {
    const imageData = process(pipeline, globals, 0);
    if (!imageData) return null;
    const c = document.createElement('canvas');
    c.width = imageData.width; c.height = imageData.height;
    c.getContext('2d').putImageData(imageData, 0, 0);
    return new Promise(resolve => c.toBlob(blob => resolve(blob), 'image/png'));
  }

  function exportWithOptions(pipeline, globals, opts, progressCb, grainOpts) {
    const scale = opts.scale || 1;
    const format = opts.format || 'png';
    const quality = (opts.quality || 92) / 100;
    const artisticMode = opts.artisticMode || false;
    const artifactIntensity = opts.artifactIntensity || 10;
    const recompressPasses = opts.recompressPasses || 1;

    if (progressCb) progressCb('Processing image\u2026', 'Full resolution');

    // Use setTimeout to yield to the UI before heavy processing
    return new Promise(resolve => {
      setTimeout(async () => {
        // Always render at 1x (exactly what's on the canvas)
        let imageData = process(pipeline, globals, 0);
        if (!imageData) { resolve(null); return; }
        // Apply grain
        if (grainOpts && grainOpts.length > 0) {
          if (progressCb) progressCb('Applying grain\u2026', '');
          imageData = GrainEngine.applyGrainLayers(imageData, grainOpts);
        }

        const c = document.createElement('canvas');

        if (scale > 1) {
          // Nearest-neighbor upscale: preserves exact pixel grid
          if (progressCb) progressCb('Upscaling\u2026', `${scale}x nearest-neighbor`);
          const tmp = document.createElement('canvas');
          tmp.width = imageData.width; tmp.height = imageData.height;
          tmp.getContext('2d').putImageData(imageData, 0, 0);
          c.width = imageData.width * scale;
          c.height = imageData.height * scale;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tmp, 0, 0, c.width, c.height);
        } else {
          c.width = imageData.width; c.height = imageData.height;
          c.getContext('2d').putImageData(imageData, 0, 0);
        }

        const mimeType = format === 'jpeg' ? 'image/jpeg'
          : format === 'webp' ? 'image/webp' : 'image/png';

        if (artisticMode && format !== 'png') {
          if (progressCb) progressCb('Compressing\u2026', `${recompressPasses} pass${recompressPasses > 1 ? 'es' : ''}`);
          const artQ = Math.max(0.01, artifactIntensity / 100);
          const blob = await doArtisticCompress(c, mimeType, artQ, recompressPasses, quality);
          resolve(blob);
        } else {
          if (progressCb) progressCb('Encoding\u2026', format.toUpperCase());
          const blobQuality = format === 'png' ? undefined : quality;
          c.toBlob(blob => resolve(blob), mimeType, blobQuality);
        }
      }, 50);
    });
  }

  // Export from raw ImageData (for exporting canvas with paint strokes)
  function exportImageData(imageData, opts, progressCb) {
    const scale = opts.scale || 1;
    const format = opts.format || 'png';
    const quality = (opts.quality || 92) / 100;
    const artisticMode = opts.artisticMode || false;
    const artifactIntensity = opts.artifactIntensity || 10;
    const recompressPasses = opts.recompressPasses || 1;

    return new Promise(resolve => {
      setTimeout(async () => {
        const c = document.createElement('canvas');
        if (scale > 1) {
          if (progressCb) progressCb('Upscaling\u2026', `${scale}x nearest-neighbor`);
          const tmp = document.createElement('canvas');
          tmp.width = imageData.width; tmp.height = imageData.height;
          tmp.getContext('2d').putImageData(imageData, 0, 0);
          c.width = imageData.width * scale;
          c.height = imageData.height * scale;
          const cctx = c.getContext('2d');
          cctx.imageSmoothingEnabled = false;
          cctx.drawImage(tmp, 0, 0, c.width, c.height);
        } else {
          c.width = imageData.width; c.height = imageData.height;
          c.getContext('2d').putImageData(imageData, 0, 0);
        }
        const mimeType = format === 'jpeg' ? 'image/jpeg'
          : format === 'webp' ? 'image/webp' : 'image/png';
        if (artisticMode && format !== 'png') {
          if (progressCb) progressCb('Compressing\u2026', `${recompressPasses} pass${recompressPasses > 1 ? 'es' : ''}`);
          const artQ = Math.max(0.01, artifactIntensity / 100);
          resolve(await doArtisticCompress(c, mimeType, artQ, recompressPasses, quality));
        } else {
          if (progressCb) progressCb('Encoding\u2026', format.toUpperCase());
          c.toBlob(blob => resolve(blob), mimeType, format === 'png' ? undefined : quality);
        }
      }, 50);
    });
  }

  function doArtisticCompress(canvas, mimeType, artQuality, passes, finalQuality) {
    // Iteratively compress at low quality to build up artifacts
    return new Promise(async resolve => {
      let c = canvas;
      for (let i = 0; i < passes; i++) {
        const blob = await new Promise(r => c.toBlob(b => r(b), mimeType, artQuality));
        const img = await createImageBitmap(blob);
        const next = document.createElement('canvas');
        next.width = img.width; next.height = img.height;
        next.getContext('2d').drawImage(img, 0, 0);
        c = next;
      }
      // Final pass at user's chosen quality
      c.toBlob(blob => resolve(blob), mimeType, finalQuality);
    });
  }

  function bake(pipeline, globals, grainOpts) {
    let imageData = process(pipeline, globals, 0);
    if (!imageData) return false;
    if (grainOpts && grainOpts.length > 0) {
      imageData = GrainEngine.applyGrainLayers(imageData, grainOpts);
    }
    const c = document.createElement('canvas');
    c.width = imageData.width; c.height = imageData.height;
    const cctx = c.getContext('2d');
    cctx.putImageData(imageData, 0, 0);
    sourceCanvas = c;
    sourceData = imageData;
    sourceImage = null; // no longer an <img>, but sourceCanvas is set
    _cache.key = '';
    return { width: imageData.width, height: imageData.height };
  }

  function bakeImageData(imageData) {
    const c = document.createElement('canvas');
    c.width = imageData.width; c.height = imageData.height;
    const cctx = c.getContext('2d');
    cctx.putImageData(imageData, 0, 0);
    sourceCanvas = c;
    sourceData = imageData;
    sourceImage = null;
    _cache.key = '';
    return { width: imageData.width, height: imageData.height };
  }

  function extractPalette(maxColors) {
    if (!sourceData) return [];
    const px = sourceData.data, n = sourceData.width * sourceData.height;
    const step = Math.max(1, Math.floor(n / 10000));
    const samples = [];
    for (let i = 0; i < n; i += step) samples.push([px[i*4], px[i*4+1], px[i*4+2]]);
    return medianCut(samples, maxColors);
  }

  return {
    loadImage, getSourceSize, bake, bakeImageData, process, processAsync,
    exportFullSize, exportWithOptions, exportImageData,
    hexToRgb, rgbToHex, clampByte, blendPixel,
    getPalettePresets, getPalette, extractPalette, medianCut, nearestColor
  };
})();
