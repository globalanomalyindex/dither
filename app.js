/**
 * APP.js — Main application logic with undo/redo, pan+zoom, tone lock, style presets
 */

(() => {
  // ── State ──
  const state = {
    selectedAlgorithms: [],
    globals: {
      colorMode: 'bw',
      grayscaleMode: 'luminance',
      brightness: 0,
      contrast: 0,
      gamma: 1.0,
      colorDark: '#000000',
      colorLight: '#ffffff',
      palettePreset: 'pico8',
      maxColors: 16,
      palette: null,
      toneLock: {
        shadows: false,
        midtones: false,
        highlights: false,
        shadowMid: 64,
        midHighlight: 192
      }
    },
    zoom: 1,
    panX: 0,
    panY: 0,
    processing: false,
    // ── Custom brush library ──
    // Session-local store for user-drawn + source-sampled brush stamps.
    // Keyed by generated ID; each entry: { id, name, w, h, mask: Uint8Array,
    // thumbDataURL, origin: 'drawn'|'sampled' }. The library is separate
    // from param state so the same brush can be referenced by multiple
    // algorithm slots, and undo snapshots don't have to embed bitmaps.
    // Not persisted across reloads (keeps the per-session feel light).
    customBrushLibrary: {}
  };

  const $ = id => document.getElementById(id);
  const dropZone = $('drop-zone');
  const workspace = $('workspace');
  const fileInput = $('file-input');
  const canvas = $('canvas-preview');
  const ctx = canvas.getContext('2d');
  const canvasWrapper = $('canvas-wrapper');
  const paramsContainer = $('params-container');

  // ── Undo/Redo System ──
  // Each entry stores BOTH the state JSON (for sliders/pipeline) AND the
  // exact canvas bitmap that was visible at snapshot time. Undo is WYSIWYG:
  // we paint the pixels back directly and do NOT re-run the pipeline, so
  // any algorithm with even the slightest RNG drift can't make the image
  // change on undo.
  const undoStack = [];
  const redoStack = [];
  const MAX_UNDO = 40;

  function getStateSnapshot() {
    return JSON.stringify({
      selectedAlgorithms: state.selectedAlgorithms,
      globals: state.globals,
      grainLayers: grainLayers
    });
  }

  function capturePixels() {
    if (!canvas.width || !canvas.height) return null;
    try { return ctx.getImageData(0, 0, canvas.width, canvas.height); }
    catch (_) { return null; }
  }

  let lastSnapshot = null;
  function pushUndo() {
    const snap = getStateSnapshot();
    if (snap === lastSnapshot) return;
    undoStack.push({ state: snap, pixels: capturePixels() });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    lastSnapshot = snap;
    updateUndoButtons();
  }

  function restoreSnapshot(entry) {
    const json = typeof entry === 'string' ? entry : entry.state;
    const pixels = typeof entry === 'string' ? null : entry.pixels;
    const data = JSON.parse(json);
    state.selectedAlgorithms = data.selectedAlgorithms;
    state.globals = data.globals;
    if (data.grainLayers) {
      grainLayers.length = 0;
      grainLayers.push(...data.grainLayers);
      updateGrainUI();
      buildGrainParamPanels();
    }
    lastSnapshot = json;
    // Sync UI first so the sidebar matches the restored state.
    syncUIFromState();
    updateAlgorithmUI();
    buildParamPanels();
    // WYSIWYG restore: paint the snapshot pixels back and skip the pipeline.
    // The next user-driven change will re-run the pipeline from source.
    if (pixels && pixels.width && pixels.height) {
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      ctx.putImageData(pixels, 0, 0);
      updateCanvasTransform();
    } else {
      // Legacy entry without pixels — fall back to re-render.
      runProcess();
    }
    updateUndoButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;
    const currentSnap = getStateSnapshot();
    const currentPixels = capturePixels();
    // If the top of the stack equals the state we're already in (because
    // scheduleProcess just pushed it), pop past it so "Undo" visibly moves.
    let prev = undoStack.pop();
    while (prev && prev.state === currentSnap && undoStack.length > 0) {
      prev = undoStack.pop();
    }
    if (!prev) { updateUndoButtons(); return; }
    redoStack.push({ state: currentSnap, pixels: currentPixels });
    restoreSnapshot(prev);
  }

  function redo() {
    if (redoStack.length === 0) return;
    const currentSnap = getStateSnapshot();
    const currentPixels = capturePixels();
    undoStack.push({ state: currentSnap, pixels: currentPixels });
    const next = redoStack.pop();
    restoreSnapshot(next);
  }

  function updateUndoButtons() {
    $('btn-undo').disabled = undoStack.length === 0;
    $('btn-redo').disabled = redoStack.length === 0;
  }

  function syncUIFromState() {
    const g = state.globals;
    $('color-mode').value = g.colorMode;
    $('grayscale-mode').value = g.grayscaleMode;
    $('color-dark').value = g.colorDark;
    $('color-light').value = g.colorLight;
    $('pre-brightness').value = g.brightness;
    $('pre-contrast').value = g.contrast;
    $('pre-gamma').value = g.gamma;
    $('max-colors').value = g.maxColors;
    document.querySelector('.param-value[data-for="pre-brightness"]').textContent = g.brightness;
    document.querySelector('.param-value[data-for="pre-contrast"]').textContent = g.contrast;
    document.querySelector('.param-value[data-for="pre-gamma"]').textContent = g.gamma;
    document.querySelector('.param-value[data-for="max-colors"]').textContent = g.maxColors;
    if (g.toneLock) {
      $('lock-shadows').checked = g.toneLock.shadows;
      $('lock-midtones').checked = g.toneLock.midtones;
      $('lock-highlights').checked = g.toneLock.highlights;
      $('tone-shadow-mid').value = g.toneLock.shadowMid;
      $('tone-mid-highlight').value = g.toneLock.midHighlight;
      document.querySelector('.param-value[data-for="tone-shadow-mid"]').textContent = g.toneLock.shadowMid;
      document.querySelector('.param-value[data-for="tone-mid-highlight"]').textContent = g.toneLock.midHighlight;
    }
    updateColorModeUI();
    if (g.palette) renderPaletteSwatches();
  }

  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    // Space for temporary pan in paint mode
    if (e.code === 'Space' && activeTab === 'paintstroke' && !e.repeat) {
      e.preventDefault();
      spaceHeld = true;
      canvasWrapper.style.cursor = '';
      if (brushCursor) brushCursor.style.display = 'none';
    }
    // Undo: if paint strokes exist, undo stroke first; else undo param change
    if (e.altKey && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (activeTab === 'paintstroke' && PaintEngine.hasStrokes()) {
        PaintEngine.undoStroke();
        updateStrokeCount();
      } else { undo(); }
    }
    if (e.altKey && e.shiftKey && e.key === 'Z') { e.preventDefault(); redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (activeTab === 'paintstroke' && PaintEngine.hasStrokes()) {
        PaintEngine.undoStroke();
        updateStrokeCount();
      } else { undo(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') { e.preventDefault(); redo(); }

    // Brush size shortcuts: [ decrease, ] increase (like Photoshop)
    if (activeTab === 'paintstroke' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        const sizeEl = $('paint-size');
        if (sizeEl) {
          const current = parseInt(sizeEl.value);
          // Tiered step: shift = 10% jumps, otherwise smooth log-ish progression
          let step;
          if (e.shiftKey) step = Math.max(10, Math.round(current * 0.15));
          else if (current > 500) step = 25;
          else if (current > 200) step = 15;
          else if (current > 50) step = 5;
          else if (current > 20) step = 3;
          else step = 1;
          const newSize = e.key === ']' ? Math.min(2000, current + step) : Math.max(1, current - step);
          sizeEl.value = newSize;
          PaintEngine.setSize(newSize);
          // Update display value
          const disp = sizeEl.parentElement.querySelector('.param-value');
          if (disp) disp.textContent = newSize;
          PaintEngine.invalidateCursorCache();
          // Reset app-level cache to force visual refresh
          _lastCursorBrush = -1;
          _lastCursorDisplaySize = 0;
          updateBrushCursorImage();
          // Force reflow so the browser repaints immediately
          if (brushCursor) {
            brushCursor.style.display = 'block';
            void brushCursor.offsetHeight;
          }
        }
      }
    }
  });

  document.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      spaceHeld = false;
      if (activeTab === 'paintstroke') {
        canvasWrapper.style.cursor = 'none';
        if (brushCursor) brushCursor.style.display = 'block';
      }
    }
  });

  // ── Scheduling ──
  // Single-tier render: just the final at full 1200px. We used to run a
  // low-res preview at 300px during drag and nearest-neighbor upscale it
  // to the canvas so the user got a "live" but chunky preview. The user
  // called the upscale flash ugly and asked for speed-over-polish instead,
  // so now we only ever render the final — the canvas shows the last
  // completed render until the new one's progress paint replaces it.
  //
  // Debounce is tight (140ms) so quick flick-of-the-slider still feels
  // responsive; cancellation token drops the in-flight render the instant
  // a new change arrives, so rapid slider moves never queue up.
  //
  // Undo only snapshots completed finals (see pushUndo at end of runProcess).
  let finalTimer = null;
  const SCHEDULE_DEBOUNCE_MS = 140;

  function scheduleProcess() {
    // Cancel any in-flight render — new params supersede it immediately.
    if (currentToken) currentToken.cancelled = true;
    clearTimeout(finalTimer);
    finalTimer = setTimeout(() => runProcess(), SCHEDULE_DEBOUNCE_MS);
  }

  function buildGlobals() {
    const g = state.globals;
    return {
      colorMode: g.colorMode,
      grayscaleMode: g.grayscaleMode,
      brightness: parseFloat(g.brightness),
      contrast: parseFloat(g.contrast),
      gamma: parseFloat(g.gamma),
      colorDark: DitherEngine.hexToRgb(g.colorDark),
      colorLight: DitherEngine.hexToRgb(g.colorLight),
      palette: g.palette,
      maxColors: g.maxColors,
      toneLock: g.toneLock
    };
  }

  // ── Custom brush resolution ──
  // Each customBrushes slot has a spec like:
  //   { source: 'builtin'|'drawn'|'sampled', builtin:'5',
  //     brushId:'cbr_...', sizeMul, angleJitter, opacity }
  // The algorithm needs an actual Uint8Array mask + size. resolveBrushSpec
  // dispatches by source and returns { mask, size } or null. For 'drawn'/
  // 'sampled' the brush lives in state.customBrushLibrary, keyed by brushId.
  // For 'builtin' we fetch from PaintEngine.getBrushMask.
  function resolveBrushSpec(spec) {
    if (!spec) return null;
    if (spec.source === 'builtin') {
      if (typeof PaintEngine === 'undefined' || !PaintEngine.getBrushMask) return null;
      const bi = parseInt(spec.builtin, 10);
      if (isNaN(bi)) return null;
      const b = PaintEngine.getBrushMask(bi);
      return b && b.mask ? { mask: b.mask, size: b.size } : null;
    }
    if (spec.source === 'drawn' || spec.source === 'sampled') {
      const lib = state.customBrushLibrary[spec.brushId];
      return lib && lib.mask ? { mask: lib.mask, size: lib.w } : null;
    }
    return null;
  }

  function buildPipeline() {
    return state.selectedAlgorithms.map(sel => {
      const algo = DitherAlgorithms.find(a => a.id === sel.id);
      const params = { ...sel.params };
      // Pre-resolve customBrushes masks so the algorithm gets actual
      // Uint8Array data, not just spec references. We mutate a shallow
      // copy of the customBrushes object so the state stays clean (no
      // large ArrayBuffers leaking into undo snapshots).
      if (params.customBrushes && params.customBrushes.enabled) {
        const cb = { ...params.customBrushes };
        cb._resolvedMaskShadow = resolveBrushSpec(cb.shadow);
        cb._resolvedMaskMid    = resolveBrushSpec(cb.mid);
        cb._resolvedMaskHigh   = resolveBrushSpec(cb.high);
        cb._resolvedMaskEdge   = resolveBrushSpec(cb.edge);
        params.customBrushes = cb;
      }
      // Normalize rules so each rule has a numeric toneTarget (derived from
      // the user's color swatch). State snapshots / presets can land here
      // with only toneColor set, or with missing fields after schema drift.
      if (Array.isArray(params.rules) && params.rules.length > 0) {
        params.rules = params.rules.map(r => {
          const nr = { ...r };
          normalizeRule(nr);
          return nr;
        });
      }
      return { algorithm: algo, params };
    });
  }

  // ── Zone visualizer ──
  // When any selected custom-brushes algo has `showZones: true`, we bypass
  // the normal painterly render and emit a color-coded map of each pixel's
  // zone assignment (shadow/mid/high/edge). Users toggle this while tuning
  // thresholds so they can see EXACTLY which brush will paint which part
  // of the image before committing to a full render.
  //   shadow → indigo, mid → teal, high → amber, edge → magenta.
  function hasZoneVizActive() {
    for (const sel of state.selectedAlgorithms) {
      const cb = sel.params && sel.params.customBrushes;
      if (cb && cb.enabled && cb.showZones) return cb;
    }
    return null;
  }
  function renderZoneViz(cb, maxDim) {
    const srcData = DitherEngine.getDownsampled
      ? DitherEngine.getDownsampled(maxDim)
      : null;
    if (!srcData) return null;
    const w = srcData.width, h = srcData.height;
    const src = srcData.data;
    // Compute luminance + Sobel magnitude in one pass, then color-code.
    const lum = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = src[i*4], g = src[i*4+1], b = src[i*4+2];
      lum[i] = (r * 0.2126 + g * 0.7152 + b * 0.0722) | 0;
    }
    // Sobel magnitude (3x3 kernel — same family as the engine's sobelField
    // but inline here so we don't need to expose it).
    function mag(x, y) {
      if (x < 1 || x >= w-1 || y < 1 || y >= h-1) return 0;
      const i = y * w + x;
      const gx = -lum[i-w-1] - 2*lum[i-1] - lum[i+w-1]
                 + lum[i-w+1] + 2*lum[i+1] + lum[i+w+1];
      const gy = -lum[i-w-1] - 2*lum[i-w] - lum[i-w+1]
                 + lum[i+w-1] + 2*lum[i+w] + lum[i+w+1];
      return Math.sqrt(gx*gx + gy*gy) * 0.25;
    }
    const out = new ImageData(w, h);
    const od = out.data;
    const shadowHi = cb.shadowHi != null ? cb.shadowHi : 85;
    const midHi    = cb.midHi    != null ? cb.midHi    : 170;
    const edgeEn   = !!cb.edgeEnabled;
    const edgeThr  = cb.edgeThreshold != null ? cb.edgeThreshold : 80;
    // Zone palette (contrasty, readable):
    //   shadow  → indigo  [80,  60,  180]
    //   mid     → teal    [60,  180, 160]
    //   high    → amber   [240, 200, 90]
    //   edge    → magenta [240, 80,  180]
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = lum[i];
      const m = edgeEn ? mag(x, y) : 0;
      let r, g, b;
      if (edgeEn && m >= edgeThr) { r = 240; g = 80; b = 180; }
      else if (l < shadowHi)      { r = 80;  g = 60; b = 180; }
      else if (l < midHi)         { r = 60;  g = 180; b = 160; }
      else                        { r = 240; g = 200; b = 90; }
      // Tint with source luminance so you can still see image structure:
      //   final = 0.6 * zone + 0.4 * lum
      const k = l * 0.4;
      od[i*4]   = (r * 0.6 + k) | 0;
      od[i*4+1] = (g * 0.6 + k) | 0;
      od[i*4+2] = (b * 0.6 + k) | 0;
      od[i*4+3] = 255;
    }
    return out;
  }

  // ── Custom-brush helpers ──
  // Everything downstream of the data model: naming, thumbnails, library
  // writes, spec display. Kept small and self-contained so the panel HTML
  // builder can call them freely without caring about the underlying
  // storage format.

  function genBrushId() {
    return 'cbr_' + Date.now().toString(36) + '_' +
      Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  }

  // Canvas-backed thumbnail renderer used by both drawn and sampled brushes.
  // Writes a semi-transparent white stamp so it reads cleanly on the dark UI.
  // The brush "mask" array stores alpha bytes 0..255 row-major.
  function renderMaskThumbDataURL(mask, w, h, thumbSize) {
    const ts = thumbSize || 48;
    const c = document.createElement('canvas');
    c.width = ts; c.height = ts;
    const cctx = c.getContext('2d');
    const img = cctx.createImageData(ts, ts);
    for (let y = 0; y < ts; y++) for (let x = 0; x < ts; x++) {
      const sx = Math.min(w - 1, Math.floor(x * w / ts));
      const sy = Math.min(h - 1, Math.floor(y * h / ts));
      const a = mask[sy * w + sx] | 0;
      const i = (y * ts + x) * 4;
      img.data[i]   = 255;
      img.data[i+1] = 255;
      img.data[i+2] = 255;
      img.data[i+3] = a;
    }
    cctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  // Save a drawn/sampled mask into the session library. mask is a Uint8Array
  // with alpha bytes (0..255), w pixels wide, square (h = w is enforced by
  // the modals). Returns the generated id so the caller can wire it into a
  // slot spec.
  function saveCustomBrushToLibrary({ origin, name, mask, w }) {
    const id = genBrushId();
    const thumbDataURL = renderMaskThumbDataURL(mask, w, w, 48);
    state.customBrushLibrary[id] = {
      id, origin: origin || 'drawn',
      name: name || (origin === 'sampled' ? 'Sampled' : 'Drawn'),
      w, h: w, mask, thumbDataURL,
      createdAt: Date.now()
    };
    return id;
  }

  function deleteCustomBrushFromLibrary(id) {
    delete state.customBrushLibrary[id];
    // Also clear any selected-algorithm slots referencing this brush so
    // we don't leave dangling pointers that resolve to nothing.
    for (const sel of state.selectedAlgorithms) {
      const cb = sel.params && sel.params.customBrushes;
      if (!cb) continue;
      for (const slot of ['shadow', 'mid', 'high', 'edge']) {
        const s = cb[slot];
        if (s && (s.source === 'drawn' || s.source === 'sampled') && s.brushId === id) {
          // Fall back to a sensible builtin so the algorithm still paints.
          cb[slot] = { ...s, source: 'builtin', builtin: '0', brushId: '' };
        }
      }
    }
  }

  // Human-readable label for a slot spec. Shows up under each slot thumb.
  function describeBrushSpec(spec) {
    if (!spec) return '—';
    if (spec.source === 'builtin') {
      const i = parseInt(spec.builtin, 10);
      if (typeof PaintEngine !== 'undefined' && PaintEngine.getBrushNames) {
        const names = PaintEngine.getBrushNames();
        if (!isNaN(i) && names[i]) return names[i];
      }
      return 'Built-in #' + spec.builtin;
    }
    if (spec.source === 'drawn' || spec.source === 'sampled') {
      const lib = state.customBrushLibrary[spec.brushId];
      const prefix = spec.source === 'drawn' ? '✎ ' : '◉ ';
      if (!lib) return prefix + 'missing';
      return prefix + (lib.name || 'Untitled');
    }
    return String(spec.source || '—');
  }

  // ── If/Then RULES — UI helpers ──
  // Convert a hex color to approximate luminance (Y) — single-channel pipelines
  // compare tone in luma space so the "tone near" condition works across R/G/B.
  function hexToLuma(hex) {
    const h = (hex || '#808080').replace('#', '');
    if (h.length !== 6) return 128;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  // Valid (subject → state) and (action → modifier) combinations. These drive
  // the contextual second dropdowns in the UI and the normalizeRule migration
  // for any rule whose saved state/modifier is incompatible with its subject/verb.
  const SUBJECT_STATES = {
    edge:   [['hard', 'hard'], ['soft', 'soft']],
    tone:   [['dark', 'dark'], ['light', 'light'], ['mid', 'mid'], ['near', 'near color']],
    detail: [['busy', 'busy'], ['moderate', 'moderate'], ['flat', 'flat']]
  };
  const ACTION_MODIFIERS = {
    blend:  [['source', 'source'], ['color', 'color'], ['black', 'black'], ['white', 'white']],
    smudge: [['random', 'random'], ['edge-along', 'along edge'], ['edge-across', 'across edge']],
    paint:  [['color', 'color']],
    bleed:  [['along-edge', 'along edge']],
    // verbs with no modifier
    invert: null, boost: null, posterize: null, darken: null, lighten: null
  };
  // Coerces rules to the two-dropdown schema in-place. Also migrates legacy
  // fields (edgeMin → edgeThresh; detailMin/detailMax → detailThresh+state;
  // top-level 'flat' when → when='detail', state='flat').
  function normalizeRule(r) {
    if (!r || typeof r !== 'object') return;
    if (r.enabled === undefined) r.enabled = true;
    // Legacy: top-level 'flat' when → detail/flat
    if (r.when === 'flat') { r.when = 'detail'; r.state = 'flat'; if (r.detailMax != null && r.detailThresh == null) r.detailThresh = r.detailMax; }
    if (!SUBJECT_STATES[r.when]) r.when = 'edge';
    // State — default first valid option for this subject if missing/incompatible.
    const validStates = SUBJECT_STATES[r.when].map(([v]) => v);
    if (!r.state || !validStates.includes(r.state)) r.state = validStates[0];
    // Action.
    if (!(r.then in ACTION_MODIFIERS)) r.then = 'blend';
    const modSpec = ACTION_MODIFIERS[r.then];
    if (modSpec) {
      const validMods = modSpec.map(([v]) => v);
      if (!r.modifier || !validMods.includes(r.modifier)) r.modifier = validMods[0];
    } else {
      r.modifier = null;
    }
    // Thresholds & modifiers — safe defaults.
    if (r.amount == null) r.amount = 0.5;
    if (r.edgeThresh == null) r.edgeThresh = (r.edgeMin != null ? r.edgeMin : 0.3);
    if (r.detailThresh == null) {
      r.detailThresh = (r.detailMin != null ? r.detailMin : (r.detailMax != null ? r.detailMax : 0.35));
    }
    if (r.toneThresh == null) r.toneThresh = 128;
    if (r.toneTol == null) r.toneTol = 40;
    if (r.toneColor == null) r.toneColor = '#808080';
    if (r.modColor == null) r.modColor = '#c04030';
    if (r.levels == null) r.levels = 4;
    if (r.radius == null) r.radius = 2;
    // Derived luma values (what dither.js reads per-channel).
    r.toneTarget = hexToLuma(r.toneColor);
    r.modColorLuma = hexToLuma(r.modColor);
  }
  const RULE_DEFAULT = () => ({
    enabled: true,
    when: 'edge', state: 'hard',
    then: 'blend', modifier: 'source',
    amount: 0.5,
    edgeThresh: 0.3,
    detailThresh: 0.35,
    toneThresh: 128,
    toneTol: 40,
    toneColor: '#808080', toneTarget: 128,
    modColor: '#c04030', modColorLuma: 90,
    levels: 4, radius: 2
  });
  // Condition-side contextual controls: threshold slider appropriate for the
  // subject+state combo. The subject+state dropdowns themselves are emitted
  // in renderRuleRow.
  function renderRuleCondParams(algoId, r, idx) {
    const mini = (field, min, max, step, val, title, label) =>
      `<span class="rule-mini" title="${title}">${label ? `<span>${label}</span>` : ''}
        <input type="range" class="rule-field" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="${field}"
          min="${min}" max="${max}" step="${step}" value="${val}">
        <span class="rule-mini-val">${(step < 1 ? (+val).toFixed(2) : val)}</span>
      </span>`;
    if (r.when === 'edge') {
      return mini('edgeThresh', 0, 1, 0.05, r.edgeThresh, 'edge magnitude threshold', r.state === 'soft' ? '<' : '≥');
    }
    if (r.when === 'tone') {
      if (r.state === 'near') {
        return `<span class="rule-mini">
          <input type="color" class="rule-field rule-color" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="toneColor" value="${r.toneColor}" title="target color (compared by luma)">
          <span>±</span>
          <input type="range" class="rule-field" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="toneTol"
            min="0" max="128" step="1" value="${r.toneTol}" title="tolerance">
          <span class="rule-mini-val">${r.toneTol}</span>
        </span>`;
      }
      if (r.state === 'mid') {
        return mini('toneThresh', 0, 255, 1, r.toneThresh, 'midtone center', '~') +
          mini('toneTol', 0, 128, 1, r.toneTol, 'midtone tolerance', '±');
      }
      return mini('toneThresh', 0, 255, 1, r.toneThresh, 'tone threshold', r.state === 'dark' ? '≤' : '≥');
    }
    if (r.when === 'detail') {
      const sym = r.state === 'busy' ? '≥' : (r.state === 'flat' ? '≤' : '≈');
      return mini('detailThresh', 0, 1, 0.05, r.detailThresh, 'detail threshold', sym);
    }
    return '';
  }
  // Action-side contextual controls: amount is always shown; posterize adds
  // levels; smudge/bleed add radius. The verb + modifier dropdowns themselves
  // are emitted in renderRuleRow.
  function renderRuleActionParams(algoId, r, idx) {
    let out = `<span class="rule-mini" title="amount">
      <input type="range" class="rule-field" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="amount"
        min="0" max="1" step="0.05" value="${r.amount}">
      <span class="rule-mini-val">${(+r.amount).toFixed(2)}</span>
    </span>`;
    if (r.then === 'posterize') {
      out += `<span class="rule-mini" title="levels">
        <span>L</span>
        <input type="range" class="rule-field" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="levels"
          min="2" max="16" step="1" value="${r.levels}">
        <span class="rule-mini-val">${r.levels}</span>
      </span>`;
    }
    if (r.then === 'smudge' || r.then === 'bleed') {
      out += `<span class="rule-mini" title="radius">
        <span>R</span>
        <input type="range" class="rule-field" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="radius"
          min="1" max="8" step="1" value="${r.radius}">
        <span class="rule-mini-val">${r.radius}</span>
      </span>`;
    }
    // Blend-with-color / paint color swatches.
    if ((r.then === 'blend' && r.modifier === 'color') || r.then === 'paint') {
      out += `<span class="rule-mini" title="color (compared/applied by luma)">
        <input type="color" class="rule-field rule-color" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="modColor" value="${r.modColor}">
      </span>`;
    }
    return out;
  }
  function renderRuleRow(algoId, r, idx) {
    normalizeRule(r);
    // Subject / state dropdowns
    const subjects = [['edge', 'edge'], ['tone', 'tone'], ['detail', 'detail']];
    const subjOpts = subjects.map(([v, l]) =>
      `<option value="${v}" ${r.when === v ? 'selected' : ''}>${l}</option>`).join('');
    const stateOpts = SUBJECT_STATES[r.when].map(([v, l]) =>
      `<option value="${v}" ${r.state === v ? 'selected' : ''}>${l}</option>`).join('');
    // Verb / modifier dropdowns
    const verbs = [
      ['blend', 'blend'],
      ['smudge', 'smudge'],
      ['paint', 'paint'],
      ['bleed', 'bleed'],
      ['invert', 'invert'],
      ['boost', 'boost'],
      ['posterize', 'posterize'],
      ['darken', 'darken'],
      ['lighten', 'lighten']
    ];
    const verbOpts = verbs.map(([v, l]) =>
      `<option value="${v}" ${r.then === v ? 'selected' : ''}>${l}</option>`).join('');
    const modSpec = ACTION_MODIFIERS[r.then];
    const modSelect = modSpec
      ? `<select class="rule-field rule-modifier" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="modifier">${
          modSpec.map(([v, l]) => `<option value="${v}" ${r.modifier === v ? 'selected' : ''}>${l}</option>`).join('')
        }</select>`
      : '';
    return `
      <div class="rule-row" data-rule-idx="${idx}">
        <label class="rule-enable" title="Enable / disable this rule">
          <input type="checkbox" class="rule-field" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="enabled" ${r.enabled ? 'checked' : ''}>
        </label>
        <span class="rule-kw">if</span>
        <select class="rule-field rule-when" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="when">${subjOpts}</select>
        <span class="rule-kw">is</span>
        <select class="rule-field rule-state" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="state">${stateOpts}</select>
        ${renderRuleCondParams(algoId, r, idx)}
        <span class="rule-arrow">→</span>
        <select class="rule-field rule-then" data-algo="${algoId}" data-rule-idx="${idx}" data-rule-field="then">${verbOpts}</select>
        ${modSelect}
        ${renderRuleActionParams(algoId, r, idx)}
        <button class="rule-delete" data-algo="${algoId}" data-rule-idx="${idx}" title="Delete rule">×</button>
      </div>
    `;
  }

  // Rebuild just the rules list for one algo section (after add / delete /
  // when-change / then-change). Avoids a full section rebuild so focus + open
  // dropdowns elsewhere in the section aren't disturbed.
  function rebuildRulesList(section, algoId) {
    const panel = section.querySelector(`.rules-panel[data-algo="${algoId}"]`);
    if (!panel) return;
    const s = state.selectedAlgorithms.find(a => a.id === algoId);
    if (!s) return;
    const rules = Array.isArray(s.params.rules) ? s.params.rules : [];
    const list = panel.querySelector('.rules-list');
    list.innerHTML = rules.map((r, idx) => renderRuleRow(algoId, r, idx)).join('');
    // Swap the empty-state banner in/out.
    let banner = panel.querySelector('.rules-empty');
    if (rules.length === 0 && !banner) {
      const msg = document.createElement('div');
      msg.className = 'rules-empty';
      msg.textContent = 'No rules yet — click "+ Add Rule" to shape how the algorithm responds to edges, tones, and detail.';
      panel.appendChild(msg);
    } else if (rules.length > 0 && banner) {
      banner.remove();
    }
  }
  // Handle any input/change event inside a rules panel. Routes by
  // data-rule-field onto the rule object at data-rule-idx.
  function handleRuleFieldChange(e, section, algoId) {
    const el = e.target.closest('.rule-field');
    if (!el) return;
    const idx = parseInt(el.dataset.ruleIdx, 10);
    const field = el.dataset.ruleField;
    const s = state.selectedAlgorithms.find(a => a.id === algoId);
    if (!s || !Array.isArray(s.params.rules)) return;
    const r = s.params.rules[idx];
    if (!r) return;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.type === 'number' || el.type === 'range') val = parseFloat(el.value);
    else val = el.value;
    r[field] = val;
    // Keep derived luma values in sync when color swatches change.
    if (field === 'toneColor') r.toneTarget = hexToLuma(val);
    if (field === 'modColor')  r.modColorLuma = hexToLuma(val);
    // Subject/verb/state/modifier changes can re-shape the row — partial rebuild.
    if (field === 'when' || field === 'then' || field === 'state' || field === 'modifier') {
      // When subject changes, state may become invalid — let normalizeRule fix it.
      if (field === 'when') r.state = null;
      if (field === 'then') r.modifier = null;
      rebuildRulesList(section, algoId);
    } else {
      // Sibling mini-val readout (if present).
      const mv = el.parentElement && el.parentElement.querySelector('.rule-mini-val');
      if (mv) {
        if (el.type === 'range' && parseFloat(el.step) < 1) mv.textContent = (+el.value).toFixed(2);
        else mv.textContent = el.value;
      }
    }
    scheduleProcess();
  }

  // DataURL of the thumbnail for a slot spec. Built-ins go through
  // PaintEngine.getBrushThumbnail; library entries have a pre-baked dataURL.
  function brushThumbDataURL(spec, sz) {
    sz = sz || 48;
    if (!spec) return '';
    if (spec.source === 'builtin') {
      if (typeof PaintEngine === 'undefined' || !PaintEngine.getBrushThumbnail) return '';
      const bi = parseInt(spec.builtin, 10);
      if (isNaN(bi)) return '';
      return PaintEngine.getBrushThumbnail(bi, sz) || '';
    }
    if (spec.source === 'drawn' || spec.source === 'sampled') {
      const lib = state.customBrushLibrary[spec.brushId];
      return (lib && lib.thumbDataURL) || '';
    }
    return '';
  }

  // Write a single named-path update into the param state, dot-paths allowed
  // (e.g. 'shadow.sizeMul'). Returns the modified root object. Keeps the
  // event-handler call-site small.
  function setCustomBrushField(cb, path, value) {
    const parts = path.split('.');
    let obj = cb;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    return cb;
  }

  // Zone-color swatches. Must match the palette in renderZoneViz so the
  // slot UI reads as visually linked to the debug-view colors.
  const CB_ZONE_COLORS = {
    shadow: 'rgb(80, 60, 180)',
    mid:    'rgb(60, 180, 160)',
    high:   'rgb(240, 200, 90)',
    edge:   'rgb(240, 80, 180)'
  };

  const PREVIEW_MAX_FULL = 1200;        // render size

  // Cancellation token for the currently-running process. We mutate an
  // existing token's `.cancelled` flag so in-flight async work sees it
  // promptly without us having to thread a new arg through every callback.
  let currentToken = null;

  // Remembers the most recent final render dims. Used to detect whether
  // the next render can skip the "save current canvas, blit it scaled,
  // putImageData" dance (when dims already match, no flash is possible).
  let lastFinalDisplayW = 0, lastFinalDisplayH = 0;

  function runProcess() {
    const size = DitherEngine.getSourceSize();
    if (!size) return;

    // ── Zone visualizer short-circuit ──
    // If any selected algo has customBrushes.showZones enabled, bypass the
    // painterly pipeline and render a color-coded zone map instead — lets
    // users tune shadow/mid/high/edge thresholds while seeing EXACTLY
    // which pixels get which brush. Single-pass CPU sample; near-instant.
    const vizCfg = hasZoneVizActive();
    if (vizCfg) {
      if (currentToken) currentToken.cancelled = true;
      const vizData = renderZoneViz(vizCfg, PREVIEW_MAX_FULL);
      if (vizData) {
        canvas.width = vizData.width;
        canvas.height = vizData.height;
        ctx.putImageData(vizData, 0, 0);
        updateCanvasTransform();
      }
      state.processing = false;
      showProcessing(false);
      return;
    }

    // Cancel any in-flight render — new params supersede it. The async
    // loop inside DitherEngine.processAsync checks .cancelled between
    // pipeline steps / channels / stroke chunks, so the previous run
    // bails fast.
    if (currentToken) currentToken.cancelled = true;
    const token = { cancelled: false };
    currentToken = token;

    state.processing = true;
    showProcessing(true);  // deferred 450ms — fast renders never see it

    // Save paint state before re-render if strokes exist
    const hasPaint = PaintEngine.hasStrokes();
    const paintedState = hasPaint ? PaintEngine.getPaintedState() : null;
    const paintBase = hasPaint ? PaintEngine.getBaseSnapshot() : null;

    // One rAF yields to the browser so that any pending paint ticks (from
    // slider thumb position, tooltip updates, etc.) land before we start
    // the heavy compute. Also ensures showProcessing(true) got a chance to
    // queue its delayed overlay timer in a fresh task.
    requestAnimationFrame(async () => {
      // Progress-paint: fires as each channel / step completes. Canvas
      // width/height is set only on the FIRST progress update so the
      // existing canvas content (the previous final) stays visible right
      // up until the new render paints over it — no blank flash mid-frame.
      let dimsInitialized = (canvas.width === lastFinalDisplayW && canvas.height === lastFinalDisplayH && lastFinalDisplayW > 0);
      const onProgress = (partial) => {
        if (token.cancelled) return;
        if (!partial) return;
        if (!dimsInitialized || canvas.width !== partial.width || canvas.height !== partial.height) {
          // If dims change (first render, or user switched image), we have
          // to reset canvas. Cover the flash by blitting the prior content
          // scaled to the new size first, THEN drop the partial on top.
          const prev = (canvas.width > 0 && canvas.height > 0)
            ? (() => { try { return ctx.getImageData(0, 0, canvas.width, canvas.height); } catch(_) { return null; } })()
            : null;
          canvas.width = partial.width;
          canvas.height = partial.height;
          if (prev) {
            const tmp = document.createElement('canvas');
            tmp.width = prev.width; tmp.height = prev.height;
            tmp.getContext('2d').putImageData(prev, 0, 0);
            const prevSmooth = ctx.imageSmoothingEnabled;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tmp, 0, 0, partial.width, partial.height);
            ctx.imageSmoothingEnabled = prevSmooth;
          }
          dimsInitialized = true;
        }
        ctx.putImageData(partial, 0, 0);
      };

      let result;
      try {
        const processFn = DitherEngine.processAsync || DitherEngine.process;
        const ret = processFn(buildPipeline(), buildGlobals(), PREVIEW_MAX_FULL, {
          signal: token, onProgress
        });
        result = (ret && typeof ret.then === 'function') ? await ret : ret;
      } catch (_) { result = null; }

      if (token.cancelled) {
        // Another runProcess has taken over; leave UI state to them.
        return;
      }

      if (result) {
        if (grainLayers.length > 0) {
          result = GrainEngine.applyGrainLayers(result, buildAllGrainOpts());
        }
        if (canvas.width !== result.width || canvas.height !== result.height) {
          canvas.width = result.width;
          canvas.height = result.height;
        }
        ctx.putImageData(result, 0, 0);
        lastFinalDisplayW = result.width;
        lastFinalDisplayH = result.height;
        updateCanvasTransform();
        if (hasPaint && paintedState && paintBase) {
          PaintEngine.applyPaintDelta(paintedState, paintBase, paintComposite.mode, paintComposite.opacity);
        }
      }

      state.processing = false;
      currentToken = null;
      showProcessing(false);
      pushUndo();  // snapshot completed render into undo history
    });
  }

  // Processing overlay: blocks pointer events on the canvas and "heavy"
  // UI buttons while rendering is in flight.
  //
  // Visibility policy: the overlay is only CREATED after a delay threshold
  // (PROCESSING_OVERLAY_DELAY_MS). Renders that finish before the threshold
  // never instantiate the overlay at all — no DOM churn, no cursor flash,
  // no animation-for-the-sake-of-it. Only genuinely long-running operations
  // produce a visible spinner, and it stays on screen only for the actual
  // working portion of the render.
  //
  // body.processing is applied instantly (for disabling bake/apply buttons
  // during any render) and cleared the moment work completes.
  const PROCESSING_OVERLAY_DELAY_MS = 450;
  let _processingOverlayTimer = null;
  let _processingOverlayLabel = null;
  function showProcessing(show, label) {
    // Always clear any pending delayed-show timer when state changes.
    if (_processingOverlayTimer) {
      clearTimeout(_processingOverlayTimer);
      _processingOverlayTimer = null;
    }

    let ov = canvasWrapper.querySelector('.processing-overlay');
    if (show) {
      document.body.classList.add('processing');
      _processingOverlayLabel = label || null;
      if (ov) {
        // Overlay already up (unusual — long-running work doing sub-phases).
        // Update its label in place.
        if (label) {
          const l = ov.querySelector('.processing-label');
          if (l) l.textContent = label;
        }
        return;
      }
      // Defer actual DOM creation. If the render completes before the timer
      // fires, showProcessing(false) cancels it and no overlay ever exists.
      _processingOverlayTimer = setTimeout(() => {
        _processingOverlayTimer = null;
        // Guard: state may have flipped between timer fire and now.
        if (!state.processing) return;
        ov = canvasWrapper.querySelector('.processing-overlay');
        if (ov) return;
        ov = document.createElement('div');
        ov.className = 'processing-overlay';
        ov.innerHTML =
          '<div class="processing-spinner"></div>' +
          '<div class="processing-label">' + (_processingOverlayLabel || 'Processing\u2026') + '</div>';
        // Swallow clicks so spam doesn't queue up more work
        ov.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
        ov.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
        canvasWrapper.appendChild(ov);
      }, PROCESSING_OVERLAY_DELAY_MS);
    } else {
      document.body.classList.remove('processing');
      _processingOverlayLabel = null;
      if (ov) ov.remove();
    }
  }

  // ── Image Upload ──
  $('btn-upload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  document.body.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  document.body.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  document.body.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) handleFile(f);
  });

  async function handleFile(file) {
    const { width, height } = await DitherEngine.loadImage(file);
    $('image-info').textContent = `${width} \u00d7 ${height} \u2014 ${file.name}`;
    dropZone.style.display = 'none';
    workspace.classList.remove('hidden');
    $('btn-export').disabled = false;
    $('btn-bake').disabled = false;
    $('btn-reset').disabled = false;
    lastSnapshot = getStateSnapshot();
    fitToView();
    runProcess();
  }

  // ── Pan + Zoom + Paint ──
  let isPanning = false;
  let isPainting = false;
  let spaceHeld = false;
  let brushSelectionMode = false;
  let pickupSelectionMode = false;
  let panStartX = 0, panStartY = 0;
  let panStartPanX = 0, panStartPanY = 0;

  function canvasToImage(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  // Prevent touch scrolling / gesture defaults so pen input is captured cleanly
  if (canvasWrapper) canvasWrapper.style.touchAction = 'none';

  let _paintPointerId = null;

  // ── Multi-touch pinch-zoom / two-finger pan state ──
  // We track every active pointer; as soon as 2 fingers are down, we enter
  // gesture mode: distance between fingers → zoom, midpoint → pan. This
  // gives mobile/tablet users native-feeling canvas control without needing
  // wheel or trackpad gestures.
  const activePointers = new Map();  // pointerId -> { x, y, type }
  let gestureMode = false;           // true while 2+ fingers down
  let gestureStartDist = 0;
  let gestureStartZoom = 1;
  let gestureStartPanX = 0, gestureStartPanY = 0;
  let gestureStartMidX = 0, gestureStartMidY = 0;
  let gestureStartImgX = 0, gestureStartImgY = 0;  // image-space anchor

  function _gestureMidAndDist() {
    const pts = [...activePointers.values()];
    if (pts.length < 2) return null;
    const a = pts[0], b = pts[1];
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return { midX, midY, dist };
  }

  function _beginGesture() {
    const g = _gestureMidAndDist();
    if (!g) return;
    gestureMode = true;
    gestureStartDist = Math.max(1, g.dist);
    gestureStartZoom = state.zoom;
    gestureStartPanX = state.panX;
    gestureStartPanY = state.panY;
    const rect = canvasWrapper.getBoundingClientRect();
    gestureStartMidX = g.midX - rect.left;
    gestureStartMidY = g.midY - rect.top;
    // Image-space point currently under the midpoint — we keep this
    // pinned under the midpoint as the pinch scales, like native maps.
    const cx = rect.width / 2 + state.panX;
    const cy = rect.height / 2 + state.panY;
    gestureStartImgX = (gestureStartMidX - cx) / state.zoom;
    gestureStartImgY = (gestureStartMidY - cy) / state.zoom;
    // Cancel any in-progress paint/pan — fingers took over.
    if (isPainting) { PaintEngine.endStroke(); isPainting = false; updateStrokeCount(); }
    if (isPanning) { isPanning = false; canvasWrapper.classList.remove('panning'); }
  }

  function _updateGesture() {
    const g = _gestureMidAndDist();
    if (!g) return;
    const rect = canvasWrapper.getBoundingClientRect();
    const midX = g.midX - rect.left;
    const midY = g.midY - rect.top;
    const zoomFactor = g.dist / gestureStartDist;
    const newZoom = Math.max(0.05, Math.min(gestureStartZoom * zoomFactor, 32));
    // Keep the pinned image-space point under the (possibly drifting) midpoint.
    state.zoom = newZoom;
    state.panX = midX - rect.width / 2 - gestureStartImgX * newZoom;
    state.panY = midY - rect.height / 2 - gestureStartImgY * newZoom;
    const zl = $('zoom-level'); if (zl) zl.textContent = Math.round(state.zoom * 100) + '%';
    updateCanvasTransform();
  }

  function _endGestureIfNeeded() {
    if (gestureMode && activePointers.size < 2) {
      gestureMode = false;
    }
  }

  canvasWrapper.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Brush/pickup selection mode intercepts in capture phase — skip here
    if (brushSelectionMode || pickupSelectionMode) return;
    e.preventDefault();

    // Record every active pointer for multi-touch detection
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    // Second (or later) touch → enter gesture mode, cancel any active paint/pan
    if (activePointers.size >= 2 && e.pointerType === 'touch') {
      _beginGesture();
      try { canvasWrapper.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // Paint mode: paintstroke tab active, Space not held, image loaded
    if (activeTab === 'paintstroke' && !spaceHeld && DitherEngine.getSourceSize()) {
      isPainting = true;
      const pt = canvasToImage(e.clientX, e.clientY);
      const isPen = e.pointerType === 'pen';
      // Pens report 0..1. Some pens report 0 on initial contact before pressure
      // is sampled — fall back to 0.5 so the first stamp isn't invisible.
      const pressure = isPen ? (e.pressure > 0 ? e.pressure : 0.5) : 1;
      const opts = {
        tiltX: (typeof e.tiltX === 'number') ? e.tiltX : 0,
        tiltY: (typeof e.tiltY === 'number') ? e.tiltY : 0,
        twist: (typeof e.twist === 'number') ? e.twist : 0,
        time: (typeof e.timeStamp === 'number') ? e.timeStamp : performance.now()
      };
      try {
        canvasWrapper.setPointerCapture(e.pointerId);
        _paintPointerId = e.pointerId;
      } catch (_) {}
      PaintEngine.beginStroke(pt.x, pt.y, pressure, isPen, opts);
      return;
    }

    // Pan mode
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = state.panX;
    panStartPanY = state.panY;
    canvasWrapper.classList.add('panning');
  });

  const brushCursorImg = $('brush-cursor-img');
  let _lastCursorBrush = -1, _lastCursorDisplaySize = 0;
  let _cursorOverCanvas = false;

  function updateBrushCursorImage() {
    if (!brushCursor || !brushCursorImg) return;
    const settings = PaintEngine.getSettings();
    const displaySize = Math.max(4, Math.round(settings.size * state.zoom));
    const curBrush = settings.selectedBrush;
    if (curBrush !== _lastCursorBrush || displaySize !== _lastCursorDisplaySize) {
      const renderSize = Math.min(displaySize, 128);
      brushCursorImg.src = PaintEngine.getBrushCursorURL(renderSize);
      _lastCursorBrush = curBrush;
      _lastCursorDisplaySize = displaySize;
    }
    brushCursor.style.width = displaySize + 'px';
    brushCursor.style.height = displaySize + 'px';
  }

  // Show/hide brush cursor strictly based on whether the mouse is over the
  // canvas-wrapper (not over sidebars or menus).
  function updateCursorVisibility() {
    if (!brushCursor) return;
    const visible = activeTab === 'paintstroke' && _cursorOverCanvas;
    brushCursor.style.display = visible ? 'block' : 'none';
  }
  if (canvasWrapper) {
    canvasWrapper.addEventListener('mouseenter', () => {
      _cursorOverCanvas = true;
      updateCursorVisibility();
    });
    canvasWrapper.addEventListener('mouseleave', () => {
      _cursorOverCanvas = false;
      // Don't hide while painting — user could drag off-canvas momentarily
      if (!isPainting) updateCursorVisibility();
    });
  }

  document.addEventListener('pointermove', e => {
    // Track every active pointer (multi-touch)
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    }

    // Pinch-zoom / two-finger pan takes priority over everything else
    if (gestureMode) {
      _updateGesture();
      return;
    }

    // Update brush cursor position only when shown
    if (activeTab === 'paintstroke' && brushCursor && _cursorOverCanvas) {
      brushCursor.style.left = e.clientX + 'px';
      brushCursor.style.top = e.clientY + 'px';
      updateBrushCursorImage();
    }

    if (isPainting) {
      const isPen = e.pointerType === 'pen';
      // High-resolution sub-events coalesced by the browser — play them back
      // in order so fast flicks and curves don't lose fidelity.
      let events = null;
      if (isPen && typeof e.getCoalescedEvents === 'function') {
        try {
          const c = e.getCoalescedEvents();
          if (c && c.length > 1) events = c;
        } catch (_) {}
      }
      if (events) {
        for (let i = 0; i < events.length; i++) {
          const ce = events[i];
          const pt = canvasToImage(ce.clientX, ce.clientY);
          const pressure = (ce.pressure > 0) ? ce.pressure : undefined;
          const copts = {
            tiltX: (typeof ce.tiltX === 'number') ? ce.tiltX : 0,
            tiltY: (typeof ce.tiltY === 'number') ? ce.tiltY : 0,
            twist: (typeof ce.twist === 'number') ? ce.twist : 0,
            time:  (typeof ce.timeStamp === 'number') ? ce.timeStamp : performance.now()
          };
          PaintEngine.continueStroke(pt.x, pt.y, pressure, copts);
        }
      } else {
        const pt = canvasToImage(e.clientX, e.clientY);
        const pressure = isPen ? (e.pressure > 0 ? e.pressure : undefined) : undefined;
        const copts = isPen ? {
          tiltX: (typeof e.tiltX === 'number') ? e.tiltX : 0,
          tiltY: (typeof e.tiltY === 'number') ? e.tiltY : 0,
          twist: (typeof e.twist === 'number') ? e.twist : 0,
          time:  (typeof e.timeStamp === 'number') ? e.timeStamp : performance.now()
        } : undefined;
        PaintEngine.continueStroke(pt.x, pt.y, pressure, copts);
      }
      return;
    }

    if (!isPanning) return;
    state.panX = panStartPanX + (e.clientX - panStartX);
    state.panY = panStartPanY + (e.clientY - panStartY);
    updateCanvasTransform();
  });

  function _handlePointerRelease(e) {
    activePointers.delete(e.pointerId);
    // If we were pinching and now only one finger remains, end gesture
    // but DON'T start pan/paint mid-motion — wait for the user to lift
    // the last finger and tap again. This avoids a zoom-then-draw glitch.
    if (gestureMode) {
      _endGestureIfNeeded();
      if (!gestureMode) {
        // Remaining single touch becomes a fresh pan anchor if still down
        if (activePointers.size === 1) {
          const [p] = activePointers.values();
          panStartX = p.x; panStartY = p.y;
          panStartPanX = state.panX; panStartPanY = state.panY;
          isPanning = true;
          canvasWrapper.classList.add('panning');
        }
      }
      return;
    }
    if (isPainting) {
      isPainting = false;
      PaintEngine.endStroke();
      updateStrokeCount();
      if (_paintPointerId != null) {
        try { canvasWrapper.releasePointerCapture(_paintPointerId); } catch (_) {}
        _paintPointerId = null;
      }
      return;
    }
    if (isPanning) {
      isPanning = false;
      canvasWrapper.classList.remove('panning');
    }
  }
  document.addEventListener('pointerup', _handlePointerRelease);
  document.addEventListener('pointercancel', _handlePointerRelease);

  $('btn-fit').addEventListener('click', fitToView);
  $('btn-1x').addEventListener('click', () => { setZoom(1); centerCanvas(); });

  canvasWrapper.addEventListener('wheel', e => {
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasWrapper.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldZoom = state.zoom;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.05, Math.min(oldZoom * factor, 32));

    // Zoom towards cursor position
    const wrapW = rect.width;
    const wrapH = rect.height;
    const s = DitherEngine.getSourceSize();
    if (!s) return;

    // Canvas center offset before zoom
    const cx = wrapW / 2 + state.panX;
    const cy = wrapH / 2 + state.panY;

    // Point under cursor in image space
    const imgX = (mouseX - cx) / oldZoom;
    const imgY = (mouseY - cy) / oldZoom;

    // After zoom, that same image point should be under cursor
    state.panX = mouseX - wrapW / 2 - imgX * newZoom;
    state.panY = mouseY - wrapH / 2 - imgY * newZoom;

    state.zoom = newZoom;
    $('zoom-level').textContent = Math.round(state.zoom * 100) + '%';
    updateCanvasTransform();
  }, { passive: false });

  // Double-click to fit
  canvasWrapper.addEventListener('dblclick', fitToView);

  function fitToView() {
    const s = DitherEngine.getSourceSize();
    if (!s) return;
    const r = canvasWrapper.getBoundingClientRect();
    state.zoom = Math.min((r.width - 40) / s.width, (r.height - 40) / s.height, 1);
    $('zoom-level').textContent = Math.round(state.zoom * 100) + '%';
    centerCanvas();
    updateCanvasTransform();
  }

  function setZoom(z) {
    state.zoom = Math.max(0.05, Math.min(z, 32));
    $('zoom-level').textContent = Math.round(state.zoom * 100) + '%';
    updateCanvasTransform();
  }

  function centerCanvas() {
    state.panX = 0;
    state.panY = 0;
  }

  function updateCanvasTransform() {
    const s = DitherEngine.getSourceSize();
    if (!s) return;
    const wrapRect = canvasWrapper.getBoundingClientRect();
    const displayW = s.width * state.zoom;
    const displayH = s.height * state.zoom;

    // Position canvas centered + pan offset
    const left = (wrapRect.width - displayW) / 2 + state.panX;
    const top = (wrapRect.height - displayH) / 2 + state.panY;

    canvas.style.width = displayW + 'px';
    canvas.style.height = displayH + 'px';
    canvas.style.left = left + 'px';
    canvas.style.top = top + 'px';
  }

  // ── Color Mode ──
  const colorMode = $('color-mode');
  const duoControls = $('duo-controls');
  const paletteControls = $('palette-controls');

  function updateColorModeUI() {
    const m = state.globals.colorMode;
    duoControls.classList.toggle('hidden', m !== 'duo' && m !== 'bw');
    paletteControls.classList.toggle('hidden', m !== 'palette');
    $('grayscale-mode').disabled = (m === 'color' || m === 'palette');
  }

  colorMode.addEventListener('change', e => {
    state.globals.colorMode = e.target.value;
    if (e.target.value === 'bw') {
      state.globals.colorDark = '#000000';
      state.globals.colorLight = '#ffffff';
      $('color-dark').value = '#000000';
      $('color-light').value = '#ffffff';
    }
    updateColorModeUI();
    scheduleProcess();
  });

  $('color-dark').addEventListener('input', e => { state.globals.colorDark = e.target.value; scheduleProcess(); });
  $('color-light').addEventListener('input', e => { state.globals.colorLight = e.target.value; scheduleProcess(); });

  // ── Palette ──
  function buildPalettePresets() {
    const sel = $('palette-preset');
    sel.innerHTML = '';
    for (const name of DitherEngine.getPalettePresets()) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name.replace(/([A-Z])/g, ' $1').replace(/(\d+)/, ' $1')
        .split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      sel.appendChild(opt);
    }
    sel.value = state.globals.palettePreset;
  }

  function loadPalettePreset(name) {
    state.globals.palettePreset = name;
    state.globals.palette = DitherEngine.getPalette(name);
    renderPaletteSwatches();
    scheduleProcess();
  }

  $('palette-preset').addEventListener('change', e => loadPalettePreset(e.target.value));

  $('max-colors').addEventListener('input', e => {
    state.globals.maxColors = parseInt(e.target.value);
    document.querySelector('.param-value[data-for="max-colors"]').textContent = e.target.value;
    scheduleProcess();
  });

  $('btn-extract-palette').addEventListener('click', () => {
    const pal = DitherEngine.extractPalette(state.globals.maxColors);
    state.globals.palette = pal;
    renderPaletteSwatches();
    scheduleProcess();
  });

  $('btn-extract-ref').addEventListener('click', () => {
    $('ref-image-input').click();
  });

  $('ref-image-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, c.width, c.height);
      const px = imgData.data, n = c.width * c.height;
      const step = Math.max(1, Math.floor(n / 10000));
      const samples = [];
      for (let i = 0; i < n; i += step) samples.push([px[i*4], px[i*4+1], px[i*4+2]]);
      const pal = DitherEngine.medianCut(samples, state.globals.maxColors);
      state.globals.palette = pal;
      renderPaletteSwatches();
      scheduleProcess();
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  });

  function renderPaletteSwatches() {
    const container = $('palette-swatches');
    container.innerHTML = '';
    const pal = state.globals.palette;
    if (!pal) return;
    const max = state.globals.maxColors;
    const show = pal.slice(0, max);
    for (const [r, g, b] of show) {
      const sw = document.createElement('div');
      sw.className = 'palette-swatch';
      sw.style.background = `rgb(${r},${g},${b})`;
      sw.title = DitherEngine.rgbToHex(r, g, b);
      container.appendChild(sw);
    }
  }

  // ── Adjustments ──
  $('grayscale-mode').addEventListener('change', e => {
    state.globals.grayscaleMode = e.target.value;
    scheduleProcess();
  });

  ['pre-brightness', 'pre-contrast', 'pre-gamma'].forEach(id => {
    const input = $(id);
    const key = id === 'pre-brightness' ? 'brightness' : id === 'pre-contrast' ? 'contrast' : 'gamma';
    input.addEventListener('input', e => {
      state.globals[key] = parseFloat(e.target.value);
      document.querySelector(`.param-value[data-for="${id}"]`).textContent = e.target.value;
      scheduleProcess();
    });
  });

  // ── Tone Lock ──
  $('lock-shadows').addEventListener('change', e => { state.globals.toneLock.shadows = e.target.checked; scheduleProcess(); });
  $('lock-midtones').addEventListener('change', e => { state.globals.toneLock.midtones = e.target.checked; scheduleProcess(); });
  $('lock-highlights').addEventListener('change', e => { state.globals.toneLock.highlights = e.target.checked; scheduleProcess(); });

  $('tone-shadow-mid').addEventListener('input', e => {
    state.globals.toneLock.shadowMid = parseInt(e.target.value);
    document.querySelector('.param-value[data-for="tone-shadow-mid"]').textContent = e.target.value;
    scheduleProcess();
  });
  $('tone-mid-highlight').addEventListener('input', e => {
    state.globals.toneLock.midHighlight = parseInt(e.target.value);
    document.querySelector('.param-value[data-for="tone-mid-highlight"]').textContent = e.target.value;
    scheduleProcess();
  });

  // ── Algorithm List ──
  function buildAlgorithmList() {
    const categories = ['classic', 'ordered', 'halftone', 'image-aware', 'lines', 'artistic', 'reconstructive', 'sketch', 'exotic', 'digital', 'effects', 'ascii'];
    for (const cat of categories) {
      const container = document.querySelector(`.algorithm-list[data-category="${cat}"]`);
      if (!container) continue;
      container.innerHTML = '';
      const algos = DitherAlgorithms.filter(a => a.category === cat);
      for (const algo of algos) {
        const item = document.createElement('div');
        item.className = 'algo-item';
        item.dataset.id = algo.id;
        item.draggable = true;
        item.innerHTML = `
          <div class="algo-checkbox">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#0a0a0a" stroke-width="2.5">
              <polyline points="2 6 5 9 10 3"/>
            </svg>
          </div>
          <span class="algo-name">${algo.name}</span>
          <span class="algo-order"></span>
          <span class="algo-drag">\u2801\u2802\u2804</span>
        `;
        item.addEventListener('click', () => toggleAlgorithm(algo.id));
        item.addEventListener('dragstart', onDragStart);
        item.addEventListener('dragover', onDragOver);
        item.addEventListener('drop', onDrop);
        item.addEventListener('dragend', onDragEnd);
        container.appendChild(item);
      }
      // Hide empty categories
      const catDiv = container.closest('.algo-category');
      if (catDiv && algos.length === 0) catDiv.style.display = 'none';
    }
  }

  let dragSrcId = null;
  function onDragStart(e) { dragSrcId = this.dataset.id; e.dataTransfer.effectAllowed = 'move'; this.style.opacity = '0.4'; }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onDrop(e) {
    e.preventDefault();
    const tgt = this.dataset.id;
    if (dragSrcId && dragSrcId !== tgt) {
      const si = state.selectedAlgorithms.findIndex(a => a.id === dragSrcId);
      const ti = state.selectedAlgorithms.findIndex(a => a.id === tgt);
      if (si !== -1 && ti !== -1) {
        const [item] = state.selectedAlgorithms.splice(si, 1);
        state.selectedAlgorithms.splice(ti, 0, item);
        updateAlgorithmUI();
        buildParamPanels();
        scheduleProcess();
      }
    }
  }
  function onDragEnd() { this.style.opacity = ''; dragSrcId = null; }

  function cloneParamValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      return JSON.parse(JSON.stringify(value));
    }
    return value;
  }

  function randomSeedForParam(param) {
    const min = typeof param.min === 'number' ? Math.floor(param.min) : 1;
    const max = 999999;
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function randomizeSeedParams(algo, params) {
    for (const p of algo.params) {
      if (p.id === 'seed') params[p.id] = randomSeedForParam(p);
    }
  }

  function buildAlgorithmParams(algo, overrides) {
    const params = {
      _mix: 0,
      _invert: false,
      _blackPoint: 0,
      _whitePoint: 255,
      _feather: 10,
      _edgeMode: 'soft',
      _toneResponse: 0,
      _advancedOpen: false,
      _blendMode: 'normal',
      _useOriginal: false
    };
    for (const p of algo.params) params[p.id] = cloneParamValue(p.default);
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) params[key] = cloneParamValue(value);
    }
    randomizeSeedParams(algo, params);
    return params;
  }

  function toggleAlgorithm(id) {
    const idx = state.selectedAlgorithms.findIndex(a => a.id === id);
    if (idx !== -1) {
      state.selectedAlgorithms.splice(idx, 1);
    } else {
      const algo = DitherAlgorithms.find(a => a.id === id);
      const params = buildAlgorithmParams(algo);
      state.selectedAlgorithms.push({ id, params });
    }
    updateAlgorithmUI();
    buildParamPanels();
    scheduleProcess();
  }

  function updateAlgorithmUI() {
    document.querySelectorAll('.algo-item').forEach(item => {
      const id = item.dataset.id;
      const si = state.selectedAlgorithms.findIndex(a => a.id === id);
      item.classList.toggle('selected', si !== -1);
      item.querySelector('.algo-order').textContent = si !== -1 ? `#${si + 1}` : '';
    });
  }

  // ── Parameter Panels ──
  function buildParamPanels() {
    paramsContainer.innerHTML = '';
    for (const sel of state.selectedAlgorithms) {
      const algo = DitherAlgorithms.find(a => a.id === sel.id);
      const section = document.createElement('div');
      section.className = 'param-section';

      let html = `
        <div class="param-section-header">
          <span class="param-section-title">${algo.name}</span>
          <div class="param-section-actions">
            <button class="param-section-btn btn-randomize-params" data-id="${sel.id}" title="Randomize params">Dice</button>
            <button class="param-section-btn btn-remove-algo" data-id="${sel.id}" title="Remove">\u2715</button>
          </div>
        </div>
      `;

      for (const p of algo.params) {
        if (p.id === 'seed') {
          // Seed: number input + a dice button that picks a new random seed
          // (previously a "Random every render" checkbox — user feedback:
          // button is clearer and gives them control over when the seed
          // actually changes).
          html += `
            <div class="param-group seed-group">
              <span class="param-label">${p.label}</span>
              <div class="seed-row">
                <input type="number" class="seed-input" data-algo="${sel.id}" data-param="seed"
                  value="${sel.params[p.id]}" min="1" step="1">
                <button class="seed-random-btn" data-algo="${sel.id}" title="Pick a random seed" type="button">🎲 New Seed</button>
              </div>
            </div>
          `;
        } else if (p.type === 'checkbox') {
          html += `
            <div class="param-group">
              <label class="slider-row">
                <input type="checkbox" data-algo="${sel.id}" data-param="${p.id}" ${sel.params[p.id] ? 'checked' : ''}>
                <span class="param-label" style="margin:0 0 0 6px">${p.label}</span>
              </label>
            </div>
          `;
        } else if (p.type === 'select') {
          const opts = p.options.map(o =>
            `<option value="${o.value}" ${sel.params[p.id] == o.value ? 'selected' : ''}>${o.label}</option>`
          ).join('');
          // Brush Shape dropdown is superseded by Custom Brushes when the
          // master toggle is on (per-zone brushes override the single-brush
          // shape). Disable + dim the dropdown so users can see at a glance
          // that it has no effect in custom-brush mode. Mark the group with
          // data-brush-shape-group so the cb-enabled handler can toggle it
          // live without a full panel rebuild.
          const isBrushShape = (p.id === 'brushShape');
          const cbOverride   = isBrushShape && !!(sel.params.customBrushes && sel.params.customBrushes.enabled);
          const disMark      = isBrushShape ? ' data-brush-shape-group="1"' : '';
          const disCls       = cbOverride ? ' param-cb-override' : '';
          const disAttr      = cbOverride ? ' disabled' : '';
          const overrideNote = cbOverride ? ' <span class="param-note">(overridden by Custom Brushes)</span>' : '';
          html += `
            <div class="param-group${disCls}"${disMark}>
              <span class="param-label">${p.label}${overrideNote}</span>
              <select data-algo="${sel.id}" data-param="${p.id}"${disAttr}>${opts}</select>
            </div>
          `;
        } else if (p.type === 'customBrushes') {
          // Ensure the param has the full default shape (in case a preset
          // or older state snapshot left gaps). Fills in missing slot fields
          // without overwriting anything the user already set.
          const def = p.default;
          if (!sel.params[p.id] || typeof sel.params[p.id] !== 'object') {
            sel.params[p.id] = JSON.parse(JSON.stringify(def));
          } else {
            const cur = sel.params[p.id];
            for (const k of ['enabled','showZones','shadowHi','midHi','edgeEnabled','edgeThreshold','ditherBand']) {
              if (cur[k] === undefined) cur[k] = def[k];
            }
            for (const slot of ['shadow','mid','high','edge']) {
              if (!cur[slot] || typeof cur[slot] !== 'object') cur[slot] = { ...def[slot] };
              else for (const kk of Object.keys(def[slot])) {
                if (cur[slot][kk] === undefined) cur[slot][kk] = def[slot][kk];
              }
            }
          }
          const cb = sel.params[p.id];
          const cbOpen = !!cb.enabled;
          // Four slot cards — shadow/mid/high/edge. Each gets its own thumb
          // button (opens picker) and a trio of micro-sliders.
          function renderSlot(slotKey, label) {
            const spec = cb[slotKey] || {};
            const thumb = brushThumbDataURL(spec, 48);
            const desc = describeBrushSpec(spec);
            const swatch = CB_ZONE_COLORS[slotKey];
            const sizeMul = spec.sizeMul != null ? spec.sizeMul : 1;
            const angJit  = spec.angleJitter != null ? spec.angleJitter : 0.5;
            const op      = spec.opacity != null ? spec.opacity : 1;
            return `
              <div class="cb-slot" data-slot="${slotKey}">
                <div class="cb-slot-head">
                  <span class="cb-slot-swatch" style="background:${swatch}"></span>
                  <span class="cb-slot-title">${label}</span>
                </div>
                <button class="cb-slot-thumb" data-algo="${sel.id}" data-cb-slot="${slotKey}" title="Change brush">
                  ${thumb ? `<img src="${thumb}" alt="">` : '<span class="cb-slot-empty">?</span>'}
                </button>
                <div class="cb-slot-desc" title="${desc}">${desc}</div>
                <div class="cb-slot-minis">
                  <label class="cb-mini">
                    <span>Size×</span>
                    <input type="range" class="cb-input" data-algo="${sel.id}" data-cb-path="${slotKey}.sizeMul"
                      min="0.3" max="2.5" step="0.05" value="${sizeMul}">
                    <span class="cb-mini-val">${(+sizeMul).toFixed(2)}</span>
                  </label>
                  <label class="cb-mini">
                    <span>Jitter</span>
                    <input type="range" class="cb-input" data-algo="${sel.id}" data-cb-path="${slotKey}.angleJitter"
                      min="0" max="1" step="0.05" value="${angJit}">
                    <span class="cb-mini-val">${(+angJit).toFixed(2)}</span>
                  </label>
                  <label class="cb-mini">
                    <span>Opacity</span>
                    <input type="range" class="cb-input" data-algo="${sel.id}" data-cb-path="${slotKey}.opacity"
                      min="0.1" max="1" step="0.05" value="${op}">
                    <span class="cb-mini-val">${(+op).toFixed(2)}</span>
                  </label>
                </div>
              </div>
            `;
          }
          html += `
            <div class="param-group cb-panel" data-algo="${sel.id}">
              <label class="slider-row cb-master">
                <input type="checkbox" class="cb-input" data-algo="${sel.id}" data-cb-path="enabled" ${cbOpen ? 'checked' : ''}>
                <span class="param-label cb-master-label">${p.label}</span>
                <span class="cb-master-hint">${cbOpen ? 'Active — tonal brush routing' : 'Off (uses single brush)'}</span>
              </label>
              <div class="cb-body ${cbOpen ? '' : 'cb-disabled'}">
                <div class="cb-thresholds">
                  <div class="cb-row">
                    <span class="param-label">Shadow ↔ Mid</span>
                    <div class="slider-row">
                      <input type="range" class="cb-input" data-algo="${sel.id}" data-cb-path="shadowHi"
                        min="0" max="255" step="1" value="${cb.shadowHi}">
                      <span class="param-value">${cb.shadowHi}</span>
                    </div>
                  </div>
                  <div class="cb-row">
                    <span class="param-label">Mid ↔ High</span>
                    <div class="slider-row">
                      <input type="range" class="cb-input" data-algo="${sel.id}" data-cb-path="midHi"
                        min="0" max="255" step="1" value="${cb.midHi}">
                      <span class="param-value">${cb.midHi}</span>
                    </div>
                  </div>
                  <div class="cb-row">
                    <span class="param-label">Zone Dither (blur transitions)</span>
                    <div class="slider-row">
                      <input type="range" class="cb-input" data-algo="${sel.id}" data-cb-path="ditherBand"
                        min="0" max="80" step="1" value="${cb.ditherBand}">
                      <span class="param-value">${cb.ditherBand}</span>
                    </div>
                  </div>
                  <div class="cb-row cb-edge-row">
                    <label class="slider-row">
                      <input type="checkbox" class="cb-input" data-algo="${sel.id}" data-cb-path="edgeEnabled" ${cb.edgeEnabled ? 'checked' : ''}>
                      <span class="param-label" style="margin:0 0 0 6px">Edge override</span>
                    </label>
                    <div class="slider-row ${cb.edgeEnabled ? '' : 'cb-dim'}">
                      <input type="range" class="cb-input" data-algo="${sel.id}" data-cb-path="edgeThreshold"
                        min="20" max="200" step="1" value="${cb.edgeThreshold}">
                      <span class="param-value">${cb.edgeThreshold}</span>
                    </div>
                  </div>
                  <div class="cb-row">
                    <label class="slider-row">
                      <input type="checkbox" class="cb-input" data-algo="${sel.id}" data-cb-path="showZones" ${cb.showZones ? 'checked' : ''}>
                      <span class="param-label" style="margin:0 0 0 6px">Show zones (debug viz)</span>
                    </label>
                  </div>
                </div>
                <div class="cb-slots">
                  ${renderSlot('shadow', 'Shadow')}
                  ${renderSlot('mid', 'Mid')}
                  ${renderSlot('high', 'High')}
                  ${renderSlot('edge', 'Edge')}
                </div>
              </div>
            </div>
          `;
        } else if (p.type === 'rules') {
          // If/Then rules — user-defined post-pass stylization.
          // Rules live at sel.params.rules as an array of plain objects; see
          // applyRules in dither.js for the schema. UI is a stacked list
          // with an "Add Rule" button and per-row delete.
          if (!Array.isArray(sel.params[p.id])) sel.params[p.id] = [];
          const rules = sel.params[p.id];
          html += `
            <div class="param-group rules-panel" data-algo="${sel.id}" data-param="${p.id}">
              <div class="rules-head">
                <span class="param-label">${p.label}</span>
                <button class="rules-add" data-algo="${sel.id}" title="Add a rule">+ Add Rule</button>
              </div>
              <div class="rules-list" data-algo="${sel.id}">
                ${rules.map((r, idx) => renderRuleRow(sel.id, r, idx)).join('')}
              </div>
              ${rules.length === 0 ? '<div class="rules-empty">No rules yet — click "+ Add Rule" to shape how the algorithm responds to edges, tones, and detail.</div>' : ''}
            </div>
          `;
        } else {
          html += `
            <div class="param-group">
              <span class="param-label">${p.label}</span>
              <div class="slider-row">
                <input type="range" data-algo="${sel.id}" data-param="${p.id}"
                  min="${p.min}" max="${p.max}" step="${p.step}" value="${sel.params[p.id]}">
                <span class="param-value">${sel.params[p.id]}</span>
              </div>
            </div>
          `;
        }
      }

      // Universal controls
      const bp = sel.params._blackPoint || 0;
      const wp = sel.params._whitePoint === undefined ? 255 : sel.params._whitePoint;
      const bpPct = (bp / 255 * 100).toFixed(1);
      const wpPct = (wp / 255 * 100).toFixed(1);
      const feather = sel.params._feather === undefined ? 10 : sel.params._feather;
      const edgeMode = sel.params._edgeMode || 'soft';
      const toneResponse = sel.params._toneResponse || 0;
      const advOpen = sel.params._advancedOpen || false;
      html += `
        <div class="param-group" style="margin-top:10px; padding-top:8px; border-top:1px solid var(--border);">
          <span class="param-label" style="color:var(--fun); font-weight:600; font-size:10px; text-transform:uppercase; letter-spacing:0.06em;">Chain Controls</span>
        </div>
        <div class="param-group">
          <span class="param-label">Blend Mode</span>
          <select data-algo="${sel.id}" data-param="_blendMode">
            ${ditherBlendModeOptionsHTML(sel.params._blendMode || 'normal')}
          </select>
        </div>
        <div class="param-group">
          <label class="slider-row">
            <input type="checkbox" data-algo="${sel.id}" data-param="_useOriginal" ${sel.params._useOriginal ? 'checked' : ''}>
            <span class="param-label" style="margin:0 0 0 6px">Use Original as Input</span>
          </label>
        </div>
        <div class="param-group">
          <span class="param-label">Mix (blend with original)</span>
          <div class="slider-row">
            <input type="range" data-algo="${sel.id}" data-param="_mix"
              min="0" max="1" step="0.05" value="${sel.params._mix || 0}">
            <span class="param-value">${sel.params._mix || 0}</span>
          </div>
        </div>
        <div class="param-group">
          <label class="slider-row">
            <input type="checkbox" data-algo="${sel.id}" data-param="_invert" ${sel.params._invert ? 'checked' : ''}>
            <span class="param-label" style="margin:0 0 0 6px">Invert Effect</span>
          </label>
        </div>
        <div class="param-group">
          <span class="param-label">Value Range</span>
          <div class="dual-range" data-algo="${sel.id}">
            <div class="dual-range-track">
              <div class="dual-range-fill" style="left:${bpPct}%;right:${100 - parseFloat(wpPct)}%"></div>
            </div>
            <input type="range" class="dual-range-lo" data-algo="${sel.id}" data-param="_blackPoint"
              min="0" max="255" step="1" value="${bp}">
            <input type="range" class="dual-range-hi" data-algo="${sel.id}" data-param="_whitePoint"
              min="0" max="255" step="1" value="${wp}">
          </div>
          <div class="dual-range-labels">
            <span class="dual-range-label" data-label-bp="${sel.id}">${bp}</span>
            <span class="dual-range-label" data-label-wp="${sel.id}">${wp}</span>
          </div>
        </div>
        <div class="param-group">
          <button class="btn-advanced-toggle" data-algo="${sel.id}" title="Advanced blending options">
            <span class="advanced-arrow ${advOpen ? 'open' : ''}"></span> Advanced
          </button>
        </div>
        <div class="advanced-controls ${advOpen ? '' : 'hidden'}" data-advanced-for="${sel.id}">
          <div class="param-group">
            <span class="param-label">Edge Mode</span>
            <select data-algo="${sel.id}" data-param="_edgeMode">
              <option value="soft" ${edgeMode==='soft'?'selected':''}>Soft Blend</option>
              <option value="hard" ${edgeMode==='hard'?'selected':''}>Hard Cut</option>
              <option value="dissolve" ${edgeMode==='dissolve'?'selected':''}>Dissolve</option>
            </select>
          </div>
          <div class="param-group">
            <span class="param-label">Feather Width</span>
            <div class="slider-row">
              <input type="range" data-algo="${sel.id}" data-param="_feather"
                min="0" max="100" step="1" value="${feather}">
              <span class="param-value">${feather}</span>
            </div>
          </div>
          <div class="param-group">
            <span class="param-label">Tone Response</span>
            <div class="tone-response-label">
              <span class="param-hint">${toneResponse > 0 ? 'Stronger in shadows' : toneResponse < 0 ? 'Stronger in highlights' : 'Uniform'}</span>
            </div>
            <div class="slider-row">
              <input type="range" class="tone-response-slider" data-algo="${sel.id}" data-param="_toneResponse"
                min="-100" max="100" step="5" value="${toneResponse}">
              <span class="param-value">${toneResponse}</span>
            </div>
          </div>
        </div>
      `;

      section.innerHTML = html;
      paramsContainer.appendChild(section);

      // Events
      section.querySelector('.btn-remove-algo').addEventListener('click', () => toggleAlgorithm(sel.id));
      section.querySelector('.btn-randomize-params').addEventListener('click', () => randomizeAlgoParams(sel.id));

      // Dual-range slider events
      section.querySelectorAll('.dual-range').forEach(dr => {
        const lo = dr.querySelector('.dual-range-lo');
        const hi = dr.querySelector('.dual-range-hi');
        const fill = dr.querySelector('.dual-range-fill');
        const algoId = dr.dataset.algo;
        const bpLabel = section.querySelector(`[data-label-bp="${algoId}"]`);
        const wpLabel = section.querySelector(`[data-label-wp="${algoId}"]`);

        function updateDualRange() {
          let loVal = parseInt(lo.value), hiVal = parseInt(hi.value);
          if (loVal > hiVal - 1) { loVal = hiVal - 1; lo.value = loVal; }
          if (hiVal < loVal + 1) { hiVal = loVal + 1; hi.value = hiVal; }
          const s = state.selectedAlgorithms.find(a => a.id === algoId);
          if (s) { s.params._blackPoint = loVal; s.params._whitePoint = hiVal; }
          fill.style.left = (loVal / 255 * 100) + '%';
          fill.style.right = (100 - hiVal / 255 * 100) + '%';
          bpLabel.textContent = loVal;
          wpLabel.textContent = hiVal;
          scheduleProcess();
        }
        lo.addEventListener('input', updateDualRange);
        hi.addEventListener('input', updateDualRange);
      });

      // Regular range slider events — exclude .cb-input so the custom-brush
      // panel's nested paths don't double-fire (their values live under
      // sel.params.customBrushes.*, reached via data-cb-path not data-param).
      section.querySelectorAll('input[type="range"]:not(.dual-range-lo):not(.dual-range-hi):not(.cb-input)').forEach(input => {
        input.addEventListener('input', e => {
          const s = state.selectedAlgorithms.find(a => a.id === e.target.dataset.algo);
          if (s) s.params[e.target.dataset.param] = parseFloat(e.target.value);
          e.target.closest('.slider-row').querySelector('.param-value').textContent = e.target.value;
          scheduleProcess();
        });
      });

      section.querySelectorAll('input[type="checkbox"]:not(.cb-input)').forEach(input => {
        input.addEventListener('change', e => {
          const s = state.selectedAlgorithms.find(a => a.id === e.target.dataset.algo);
          if (s) s.params[e.target.dataset.param] = e.target.checked;
          scheduleProcess();
        });
      });

      section.querySelectorAll('select').forEach(select => {
        select.addEventListener('change', e => {
          const s = state.selectedAlgorithms.find(a => a.id === e.target.dataset.algo);
          if (s) s.params[e.target.dataset.param] = e.target.value;
          scheduleProcess();
        });
      });

      // ── Custom-brushes panel wiring ──
      // Every input in the cb-panel uses data-cb-path to name a nested field
      // under sel.params.customBrushes (e.g. "shadow.sizeMul"). One handler
      // routes both ranges and checkboxes through setCustomBrushField().
      section.querySelectorAll('.cb-input').forEach(input => {
        const evt = input.type === 'checkbox' ? 'change' : 'input';
        input.addEventListener(evt, e => {
          const s = state.selectedAlgorithms.find(a => a.id === e.target.dataset.algo);
          if (!s) return;
          if (!s.params.customBrushes || typeof s.params.customBrushes !== 'object') return;
          const cb = s.params.customBrushes;
          const path = e.target.dataset.cbPath;
          const raw = (input.type === 'checkbox') ? input.checked : parseFloat(input.value);
          setCustomBrushField(cb, path, raw);

          // Keep sibling readouts in sync without a full panel rebuild
          // (full rebuild would blow away focus + slider drag state).
          if (input.type === 'range') {
            // cb-thresholds layout: .slider-row > input + .param-value
            const pv = e.target.closest('.slider-row') && e.target.closest('.slider-row').querySelector('.param-value');
            if (pv) pv.textContent = input.value;
            // cb-mini layout: .cb-mini > input + .cb-mini-val
            const mv = e.target.closest('.cb-mini') && e.target.closest('.cb-mini').querySelector('.cb-mini-val');
            if (mv) mv.textContent = (+input.value).toFixed(2);
          }
          // Master enable → gray out body without a rebuild.
          if (path === 'enabled') {
            const body = e.target.closest('.cb-panel').querySelector('.cb-body');
            const hint = e.target.closest('.cb-panel').querySelector('.cb-master-hint');
            if (body) body.classList.toggle('cb-disabled', !input.checked);
            if (hint) hint.textContent = input.checked ? 'Active — tonal brush routing' : 'Off (uses single brush)';
            // Disable/enable the standard Brush Shape dropdown in the same
            // algo section — per-zone custom brushes override the single
            // brushShape, so surfacing that fact in the UI prevents users
            // from fiddling with a dropdown that has no effect.
            const brushGroup = section.querySelector('[data-brush-shape-group="1"]');
            if (brushGroup) {
              const on = input.checked;
              brushGroup.classList.toggle('param-cb-override', on);
              const bsSel = brushGroup.querySelector('select');
              if (bsSel) bsSel.disabled = on;
              const label = brushGroup.querySelector('.param-label');
              let note = brushGroup.querySelector('.param-note');
              if (on && !note && label) {
                note = document.createElement('span');
                note.className = 'param-note';
                note.textContent = ' (overridden by Custom Brushes)';
                label.appendChild(note);
              } else if (!on && note) {
                note.remove();
              }
            }
          }
          // Edge toggle → dim its slider.
          if (path === 'edgeEnabled') {
            const edgeRow = e.target.closest('.cb-edge-row');
            const sr = edgeRow && edgeRow.querySelectorAll('.slider-row')[1];
            if (sr) sr.classList.toggle('cb-dim', !input.checked);
          }
          scheduleProcess();
        });
      });

      // Slot thumb clicks → open brush picker.
      section.querySelectorAll('.cb-slot-thumb').forEach(btn => {
        btn.addEventListener('click', () => {
          const algoId = btn.dataset.algo;
          const slotKey = btn.dataset.cbSlot;
          const s = state.selectedAlgorithms.find(a => a.id === algoId);
          if (!s || !s.params.customBrushes) return;
          openBrushPicker(s.params.customBrushes[slotKey], (newSpec) => {
            // Preserve the slot's per-slot modifiers (sizeMul, angleJitter,
            // opacity) when the user swaps brush shape — only the source
            // fields change. This keeps the panel's mini-sliders useful
            // across brush swaps.
            const prev = s.params.customBrushes[slotKey] || {};
            s.params.customBrushes[slotKey] = {
              ...prev,
              source: newSpec.source,
              builtin: newSpec.builtin || '',
              brushId: newSpec.brushId || ''
            };
            // Rebuild just this slot's thumb + description in place.
            const slotEl = section.querySelector(`.cb-slot[data-slot="${slotKey}"]`);
            if (slotEl) {
              const thumbEl = slotEl.querySelector('.cb-slot-thumb');
              const descEl = slotEl.querySelector('.cb-slot-desc');
              const spec = s.params.customBrushes[slotKey];
              const url = brushThumbDataURL(spec, 48);
              thumbEl.innerHTML = url ? `<img src="${url}" alt="">` : '<span class="cb-slot-empty">?</span>';
              const desc = describeBrushSpec(spec);
              descEl.textContent = desc;
              descEl.title = desc;
            }
            scheduleProcess();
          });
        });
      });

      // ── If/Then RULES wiring ──
      // Add-rule button: append a fresh default, rebuild the list.
      section.querySelectorAll('.rules-add').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          const algoId = btn.dataset.algo;
          const s = state.selectedAlgorithms.find(a => a.id === algoId);
          if (!s) return;
          if (!Array.isArray(s.params.rules)) s.params.rules = [];
          s.params.rules.push(RULE_DEFAULT());
          rebuildRulesList(section, algoId);
          scheduleProcess();
        });
      });
      // Delete button (delegated because rows render dynamically).
      section.querySelectorAll('.rules-panel').forEach(panel => {
        const algoId = panel.dataset.algo;
        panel.addEventListener('click', e => {
          const del = e.target.closest('.rule-delete');
          if (!del) return;
          e.preventDefault();
          const idx = parseInt(del.dataset.ruleIdx, 10);
          const s = state.selectedAlgorithms.find(a => a.id === algoId);
          if (!s || !Array.isArray(s.params.rules)) return;
          s.params.rules.splice(idx, 1);
          rebuildRulesList(section, algoId);
          scheduleProcess();
        });
        // Field changes (when/then dropdowns + all rule-field inputs).
        panel.addEventListener('input', e => handleRuleFieldChange(e, section, algoId));
        panel.addEventListener('change', e => handleRuleFieldChange(e, section, algoId));
      });

      // Advanced toggle
      section.querySelectorAll('.btn-advanced-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const algoId = btn.dataset.algo;
          const panel = section.querySelector(`[data-advanced-for="${algoId}"]`);
          const arrow = btn.querySelector('.advanced-arrow');
          const s = state.selectedAlgorithms.find(a => a.id === algoId);
          if (panel) {
            const isOpen = !panel.classList.contains('hidden');
            panel.classList.toggle('hidden', isOpen);
            arrow.classList.toggle('open', !isOpen);
            if (s) s.params._advancedOpen = !isOpen;
          }
        });
      });

      // Tone response hint
      section.querySelectorAll('.tone-response-slider').forEach(input => {
        input.addEventListener('input', () => {
          const hint = input.closest('.advanced-controls')?.querySelector('.param-hint');
          if (hint) {
            const v = parseInt(input.value);
            hint.textContent = v > 0 ? 'Stronger in shadows' : v < 0 ? 'Stronger in highlights' : 'Uniform';
          }
        });
      });

      // Seed controls
      section.querySelectorAll('.seed-input').forEach(input => {
        let debounceTimer;
        input.addEventListener('input', () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const s = state.selectedAlgorithms.find(a => a.id === input.dataset.algo);
            if (s) { s.params.seed = parseInt(input.value) || 1; scheduleProcess(); }
          }, 400);
        });
      });

      // 🎲 New Seed button — one click picks a fresh random seed, updates
      // the number input, and triggers a re-render. Replaces the older
      // "Random every render" checkbox (user feedback: button is clearer).
      section.querySelectorAll('.seed-random-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          const algoId = btn.dataset.algo;
          const s = state.selectedAlgorithms.find(a => a.id === algoId);
          const numInput = section.querySelector(`.seed-input[data-algo="${algoId}"]`);
          if (!s) return;
          const rnd = Math.floor(Math.random() * 999999) + 1;
          s.params.seed = rnd;
          if (numInput) numInput.value = rnd;
          scheduleProcess();
        });
      });
    }
  }

  // ── Style Presets ──
  const STYLE_PRESETS = {
    underpainting: {
      algorithms: [
        { id: 'overshot-sketch', params: { lineCount: 4000, overshoot: 0.6, wobble: 0.3, thickness: 1, seed: 42, _mix: 0.15 } },
        { id: 'color-bleed', params: { amount: 8, direction: 'radial', decay: 0.92, _mix: 0.4 } }
      ],
      globals: { colorMode: 'color', brightness: 5, contrast: 15, gamma: 0.95 }
    },
    painterly: {
      algorithms: [
        { id: 'oil-paint', params: { brushSize: 6, detail: 3, seed: 42 } },
        { id: 'photographic-grain', params: { size: 2, amount: 15, luminanceResponse: 0.4, seed: 55, _mix: 0.3 } }
      ],
      globals: { colorMode: 'color', contrast: 10 }
    },
    expressive: {
      algorithms: [
        { id: 'dry-brush-strokes', params: { strokeLen: 25, width: 6, dryness: 0.4, seed: 42 } },
        { id: 'gesture-drawing', params: { strokes: 2000, strokeLen: 40, speed: 0.7, seed: 88, _mix: 0.5 } }
      ],
      globals: { colorMode: 'bw', contrast: 20 }
    },
    dynamic: {
      algorithms: [
        { id: 'floyd-steinberg', params: { strength: 0.85, serpentine: true } },
        { id: 'color-bleed', params: { amount: 3, direction: 'diagonal', decay: 0.88, _mix: 0.2 } }
      ],
      globals: { colorMode: 'bw', contrast: 25, gamma: 0.9 }
    },
    technical: {
      algorithms: [
        { id: 'ordered', params: { size: 4, spread: 100 } },
        { id: 'engraving', params: { lineSpacing: 3, angle: 45, thickness: 1.5, curvature: 0.5, seed: 42, _mix: 0.15 } }
      ],
      globals: { colorMode: 'bw' }
    },
    illustrated: {
      algorithms: [
        { id: 'multi-line-sketch', params: { lineCount: 5000, passes: 3, overshoot: 0.35, angleSpread: 25, wobble: 0.2, thickness: 1, seed: 42 } }
      ],
      globals: { colorMode: 'bw', contrast: 15, gamma: 0.9 }
    },
    woodcut: {
      algorithms: [
        { id: 'woodcut', params: { lineWidth: 3, contrast: 1.5, angle: 30, variation: 0.4, seed: 42 } }
      ],
      globals: { colorMode: 'bw', contrast: 30 }
    },
    engraving: {
      algorithms: [
        { id: 'engraving', params: { lineSpacing: 3, angle: 45, thickness: 1.5, curvature: 0.5, seed: 42 } },
        { id: 'crosshatch-variable', params: { layers: 3, baseSpacing: 5, baseAngle: 45, angleStep: 60, densityResponse: 0.8, lineWeight: 1.2, seed: 42, _mix: 0.3 } }
      ],
      globals: { colorMode: 'bw', contrast: 20, gamma: 0.85 }
    },
    newsprint: {
      algorithms: [
        { id: 'cmyk-halftone', params: { dotSize: 6, cAngle: 15, mAngle: 75, yAngle: 0, kAngle: 45, softness: 0.1 } }
      ],
      globals: { colorMode: 'color' }
    },
    'retro-digital': {
      algorithms: [
        { id: 'ordered', params: { size: 4, spread: 160 } },
        { id: 'screen-grain', params: { pixelSize: 2, scanlines: 0.5, noise: 25, seed: 42, _mix: 0.2 } }
      ],
      globals: { colorMode: 'palette', palettePreset: 'pico8', maxColors: 16 }
    },
    'film-noir': {
      algorithms: [
        { id: 'floyd-steinberg', params: { strength: 0.9, serpentine: true } },
        { id: 'silver-gelatin', params: { grain: 30, contrast: 1.5, fog: 5, seed: 99, _mix: 0.4 } }
      ],
      globals: { colorMode: 'bw', contrast: 35, gamma: 0.8 }
    }
  };

  $('style-preset').addEventListener('change', e => {
    const preset = STYLE_PRESETS[e.target.value];
    if (!preset) return;

    pushUndo();

    // Apply preset algorithms
    state.selectedAlgorithms = [];
    for (const pAlgo of preset.algorithms) {
      const algo = DitherAlgorithms.find(a => a.id === pAlgo.id);
      if (!algo) continue;
      const params = buildAlgorithmParams(algo, pAlgo.params);
      state.selectedAlgorithms.push({ id: pAlgo.id, params });
    }

    // Apply preset globals
    if (preset.globals) {
      if (preset.globals.colorMode) state.globals.colorMode = preset.globals.colorMode;
      if (preset.globals.brightness !== undefined) state.globals.brightness = preset.globals.brightness;
      if (preset.globals.contrast !== undefined) state.globals.contrast = preset.globals.contrast;
      if (preset.globals.gamma !== undefined) state.globals.gamma = preset.globals.gamma;
      if (preset.globals.palettePreset) {
        state.globals.palettePreset = preset.globals.palettePreset;
        state.globals.palette = DitherEngine.getPalette(preset.globals.palettePreset);
      }
      if (preset.globals.maxColors) state.globals.maxColors = preset.globals.maxColors;
    }

    syncUIFromState();
    updateAlgorithmUI();
    buildParamPanels();
    runProcess();
  });

  // ── Randomizers ──
  function randomFloat(min, max) { return Math.random() * (max - min) + min; }
  function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function randomHex() { return '#' + Math.floor(Math.random() * 16777216).toString(16).padStart(6, '0'); }

  // Per-algorithm Dice caps. Some algos have expensive params whose worst-case
  // combos (e.g. dabCount=40000 + layers=5 + wetStreak=1 + colorVariety=1) can
  // freeze the page for tens of seconds. Dice picks from full range normally,
  // but these caps keep rolls inside an "interactive" budget so Dice stays fun
  // instead of punishing. Also blacklist 'select' options known to be slow.
  const SAFE_DICE_CAPS = {
    'palette-knife': {
      size:         { max: 22 },
      smear:        { max: 55 },
      layers:       { max: 2 },
      wetBleed:     { max: 0.5 },
      wetSmudge:    { max: 0.55 },
      wetStreak:    { max: 0.55 },
      sizeByDetail: { max: 1.1 },
      colorVariety: { max: 0.6 },
      intensity:    { max: 2.0 },
      pressure:     { max: 1.1 }
    },
    'impressionism': {
      dabCount:     { max: 9000 },
      dabLen:       { max: 30 },
      dabWidth:     { max: 10 },
      layers:       { max: 2 },
      wetBleed:     { max: 0.5 },
      wetSmudge:    { max: 0.55 },
      wetStreak:    { max: 0.55 },
      sizeByDetail: { max: 1.1 },
      colorVariety: { max: 0.6 },
      intensity:    { max: 1.8 },
      scatter:      { max: 12 }
    }
  };

  function randomizeAlgoParams(algoId) {
    const sel = state.selectedAlgorithms.find(a => a.id === algoId);
    if (!sel) return;
    const algo = DitherAlgorithms.find(a => a.id === algoId);
    const caps = SAFE_DICE_CAPS[algoId] || {};
    for (const p of algo.params) {
      if (p.type === 'checkbox') {
        sel.params[p.id] = Math.random() > 0.5;
      } else if (p.type === 'select') {
        const opts = p.options;
        sel.params[p.id] = opts[randomInt(0, opts.length - 1)].value;
      } else if (p.type === 'customBrushes') {
        // Dice only the numeric routing fields — brush specs (which point
        // into the session library) and enabled-state are deliberately
        // preserved so a chaotic reroll doesn't suddenly lose your
        // carefully-picked brushes or flip the whole feature on/off.
        const cb = sel.params[p.id] || (sel.params[p.id] = JSON.parse(JSON.stringify(p.default)));
        const sh = randomInt(40, 130);
        const mh = randomInt(Math.max(sh + 20, 140), 220);
        cb.shadowHi = sh;
        cb.midHi = mh;
        cb.ditherBand = randomInt(0, 60);
        cb.edgeThreshold = randomInt(40, 160);
        // Also jitter each slot's modifier trio for variety without
        // touching the underlying brush shape.
        for (const slot of ['shadow','mid','high','edge']) {
          if (!cb[slot] || typeof cb[slot] !== 'object') cb[slot] = { ...p.default[slot] };
          cb[slot].sizeMul     = Math.round((0.5 + Math.random() * 1.8) * 20) / 20;
          cb[slot].angleJitter = Math.round(Math.random() * 20) / 20;
          cb[slot].opacity     = Math.round((0.5 + Math.random() * 0.5) * 20) / 20;
        }
      } else {
        const cap = caps[p.id];
        const min = p.min;
        const max = cap ? Math.min(p.max, cap.max) : p.max;
        const steps = Math.max(1, Math.round((max - min) / p.step));
        sel.params[p.id] = min + Math.round(Math.random() * steps) * p.step;
        sel.params[p.id] = Math.round(sel.params[p.id] * 1000) / 1000;
      }
    }
    sel.params._mix = Math.round(Math.random() * 20) * 0.05;
    sel.params._invert = Math.random() > 0.8;
    sel.params._blackPoint = Math.random() > 0.7 ? randomInt(0, 60) : 0;
    sel.params._whitePoint = Math.random() > 0.7 ? randomInt(200, 255) : 255;
    sel.params._feather = randomInt(0, 40);
    sel.params._edgeMode = ['soft', 'hard', 'dissolve'][randomInt(0, 2)];
    sel.params._toneResponse = Math.random() > 0.6 ? randomInt(-80, 80) : 0;
    buildParamPanels();
    scheduleProcess();
  }

  document.querySelectorAll('.btn-dice').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.randomize;
      if (target === 'color') randomizeColor();
      else if (target === 'adjustments') randomizeAdjustments();
      else if (target === 'algorithms') randomizeAlgorithms();
    });
  });

  function randomizeColor() {
    const modes = ['bw', 'duo', 'palette', 'color'];
    const mode = modes[randomInt(0, modes.length - 1)];
    state.globals.colorMode = mode;
    colorMode.value = mode;

    if (mode === 'duo' || mode === 'bw') {
      if (mode === 'duo') {
        state.globals.colorDark = randomHex();
        state.globals.colorLight = randomHex();
      } else {
        state.globals.colorDark = '#000000';
        state.globals.colorLight = '#ffffff';
      }
      $('color-dark').value = state.globals.colorDark;
      $('color-light').value = state.globals.colorLight;
    } else if (mode === 'palette') {
      const presets = DitherEngine.getPalettePresets();
      const preset = presets[randomInt(0, presets.length - 1)];
      $('palette-preset').value = preset;
      state.globals.maxColors = randomInt(2, 16);
      $('max-colors').value = state.globals.maxColors;
      document.querySelector('.param-value[data-for="max-colors"]').textContent = state.globals.maxColors;
      loadPalettePreset(preset);
    }

    updateColorModeUI();
    scheduleProcess();
  }

  function randomizeAdjustments() {
    state.globals.brightness = randomInt(-40, 40);
    state.globals.contrast = randomInt(-40, 40);
    state.globals.gamma = Math.round(randomFloat(0.5, 2.0) * 20) / 20;

    $('pre-brightness').value = state.globals.brightness;
    $('pre-contrast').value = state.globals.contrast;
    $('pre-gamma').value = state.globals.gamma;
    document.querySelector('.param-value[data-for="pre-brightness"]').textContent = state.globals.brightness;
    document.querySelector('.param-value[data-for="pre-contrast"]').textContent = state.globals.contrast;
    document.querySelector('.param-value[data-for="pre-gamma"]').textContent = state.globals.gamma;
    scheduleProcess();
  }

  function randomizeAlgorithms() {
    state.selectedAlgorithms = [];
    const count = randomInt(1, 3);
    const shuffled = [...DitherAlgorithms].sort(() => Math.random() - 0.5);
    for (let i = 0; i < count && i < shuffled.length; i++) {
      const algo = shuffled[i];
      const params = buildAlgorithmParams(algo);
      params._mix = Math.round(Math.random() * 20) * 0.05;
      params._invert = Math.random() > 0.8;
      params._blackPoint = Math.random() > 0.7 ? randomInt(0, 60) : 0;
      params._whitePoint = Math.random() > 0.7 ? randomInt(200, 255) : 255;
      params._feather = randomInt(0, 40);
      params._edgeMode = ['soft', 'hard', 'dissolve'][randomInt(0, 2)];
      params._toneResponse = Math.random() > 0.6 ? randomInt(-80, 80) : 0;
      params._advancedOpen = false;
      for (const p of algo.params) {
        if (p.id === 'seed') continue;
        if (p.type === 'checkbox') params[p.id] = Math.random() > 0.5;
        else if (p.type === 'select') params[p.id] = p.options[randomInt(0, p.options.length - 1)].value;
        else if (p.type === 'customBrushes' || p.type === 'rules') params[p.id] = cloneParamValue(p.default);
        else {
          const steps = (p.max - p.min) / p.step;
          params[p.id] = Math.round((p.min + Math.round(Math.random() * steps) * p.step) * 1000) / 1000;
        }
      }
      randomizeSeedParams(algo, params);
      state.selectedAlgorithms.push({ id: algo.id, params });
    }
    updateAlgorithmUI();
    buildParamPanels();
    scheduleProcess();
  }

  $('btn-randomize-all').addEventListener('click', () => {
    randomizeColor();
    randomizeAdjustments();
    randomizeAlgorithms();
  });

  // ── Export Modal ──
  const exportModal = $('export-modal');
  const exportPreviewCanvas = $('export-preview-canvas');
  let exportScale = 1;
  let exportPreviewDebounce = null;
  const MAX_EXPORT_DIM = 16384; // Canvas max dimension safety
  const EXPORT_PREVIEW_MAX = 400;

  function openExportModal() {
    const src = DitherEngine.getSourceSize();
    if (!src) return;
    exportScale = 1;
    $('export-size-info').textContent = `Source: ${src.width} \u00d7 ${src.height}`;
    updateExportDimReadout(src);
    updateExportScaleButtons(src);
    document.querySelector('input[name="export-format"][value="png"]').checked = true;
    $('export-compress-toggle').checked = false;
    $('export-compress-section').style.display = 'none';
    $('export-print-ready').checked = false;
    $('export-print-hint').style.display = 'none';
    $('export-quality').value = 92;
    $('export-quality-val').textContent = '92';
    $('export-artifact-intensity').value = 15;
    $('export-artifact-val').textContent = '15';
    $('export-recompress-passes').value = 1;
    $('export-recompress-val').textContent = '1';
    $('export-filename').value = '';
    updateFilenamePreview();
    updatePrintReadyLocks();
    exportModal.classList.remove('hidden');
    renderExportPreview();
  }

  function sanitizeFilename(name) {
    // Strip path separators, control chars, and trailing dots/spaces.
    return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\.+$/, '').trim();
  }

  function currentFilenameBase() {
    const raw = sanitizeFilename(($('export-filename').value || '').trim());
    return raw || 'dithered';
  }

  function updateFilenamePreview() {
    const opts = getExportOpts();
    const ext = opts.format === 'jpeg' ? 'jpg' : opts.format;
    const scaleLabel = exportScale > 1 ? `_${exportScale}x` : '';
    $('export-filename-preview').textContent = `Will save as: ${currentFilenameBase()}${scaleLabel}.${ext}`;
  }

  function updatePrintReadyLocks() {
    const on = $('export-print-ready').checked;
    $('export-print-hint').style.display = on ? '' : 'none';
    if (on) {
      document.querySelector('input[name="export-format"][value="png"]').checked = true;
      $('export-compress-toggle').checked = false;
      $('export-compress-section').style.display = 'none';
    }
    // Lock format radios + compress toggle while print-ready is on
    document.querySelectorAll('input[name="export-format"]').forEach(r => { r.disabled = on; });
    $('export-compress-toggle').disabled = on;
  }

  function closeExportModal() {
    exportModal.classList.add('hidden');
    // Remove progress overlay if present
    const prog = exportModal.querySelector('.export-progress-overlay');
    if (prog) prog.remove();
  }

  function updateExportDimReadout(src) {
    const w = src.width * exportScale, h = src.height * exportScale;
    const mp = ((w * h) / 1_000_000).toFixed(1);
    $('export-dim-readout').textContent = `${w} \u00d7 ${h}  (${mp} MP)`;
  }

  function updateExportScaleButtons(src) {
    document.querySelectorAll('.export-scale-btn').forEach(btn => {
      const s = parseInt(btn.dataset.scale);
      const maxDim = Math.max(src.width, src.height) * s;
      btn.classList.toggle('selected', s === exportScale);
      btn.classList.toggle('disabled', maxDim > MAX_EXPORT_DIM);
    });
  }

  function getExportOpts() {
    const printReady = $('export-print-ready').checked;
    const fmt = printReady ? 'png' : document.querySelector('input[name="export-format"]:checked').value;
    const compress = !printReady && $('export-compress-toggle').checked;
    return {
      scale: exportScale,
      format: fmt,
      quality: compress ? parseInt($('export-quality').value) : 92,
      artisticMode: compress,
      artifactIntensity: compress ? parseInt($('export-artifact-intensity').value) : 15,
      recompressPasses: compress ? parseInt($('export-recompress-passes').value) : 1,
      printReady
    };
  }

  // ── PNG pHYs chunk injection for print DPI metadata ──
  // PNG spec: pHYs chunk (9 bytes) carries pixels-per-unit X, Y, and unit (1 = meter).
  // 300 DPI = 300 / 0.0254 ≈ 11811 pixels/meter. Must be inserted after IHDR and
  // before IDAT. Also update CRC32 for the new chunk.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes, start, end) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function writeUint32BE(arr, offset, v) {
    arr[offset] = (v >>> 24) & 0xff;
    arr[offset + 1] = (v >>> 16) & 0xff;
    arr[offset + 2] = (v >>> 8) & 0xff;
    arr[offset + 3] = v & 0xff;
  }
  async function addPngDpiMetadata(blob, dpi) {
    const ppm = Math.round(dpi / 0.0254); // pixels per meter
    const buf = new Uint8Array(await blob.arrayBuffer());
    // Validate PNG signature 89 50 4E 47 0D 0A 1A 0A
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
      return blob;
    }
    // Find IHDR (should be first chunk) — its length is 13 bytes, so full chunk is 8+13+4 = 25 bytes starting at offset 8.
    // We insert pHYs immediately after IHDR.
    const ihdrEnd = 8 + 4 + 4 + 13 + 4; // 33
    // Build pHYs chunk: length(4) + type(4) + data(9) + crc(4) = 21 bytes
    const phys = new Uint8Array(21);
    writeUint32BE(phys, 0, 9); // data length
    phys[4] = 0x70; phys[5] = 0x48; phys[6] = 0x59; phys[7] = 0x73; // "pHYs"
    writeUint32BE(phys, 8, ppm);   // X ppu
    writeUint32BE(phys, 12, ppm);  // Y ppu
    phys[16] = 1; // unit = meter
    const crc = crc32(phys, 4, 17);
    writeUint32BE(phys, 17, crc);
    // If a pHYs chunk already exists somewhere, skip; browsers rarely add one.
    // Splice: [0..ihdrEnd) + phys + [ihdrEnd..end)
    const out = new Uint8Array(buf.length + phys.length);
    out.set(buf.subarray(0, ihdrEnd), 0);
    out.set(phys, ihdrEnd);
    out.set(buf.subarray(ihdrEnd), ihdrEnd + phys.length);
    return new Blob([out], { type: 'image/png' });
  }

  async function renderExportPreview() {
    const opts = getExportOpts();
    // Always use exactly what's on the canvas — WYSIWYG
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const tmp = document.createElement('canvas');
    tmp.width = imageData.width; tmp.height = imageData.height;
    tmp.getContext('2d').putImageData(imageData, 0, 0);

    const scaleRatio = opts.scale * opts.scale;

    if (opts.artisticMode && opts.format !== 'png') {
      const mimeType = opts.format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      const artQ = Math.max(0.01, opts.artifactIntensity / 100);
      let c = tmp;
      for (let i = 0; i < opts.recompressPasses; i++) {
        const blob = await new Promise(r => c.toBlob(b => r(b), mimeType, artQ));
        const img = await createImageBitmap(blob);
        const next = document.createElement('canvas');
        next.width = img.width; next.height = img.height;
        next.getContext('2d').drawImage(img, 0, 0);
        c = next;
      }
      const finalBlob = await new Promise(r => c.toBlob(b => r(b), mimeType, opts.quality / 100));
      const finalImg = await createImageBitmap(finalBlob);
      exportPreviewCanvas.width = finalImg.width;
      exportPreviewCanvas.height = finalImg.height;
      exportPreviewCanvas.getContext('2d').drawImage(finalImg, 0, 0);
      const estKB = Math.round(finalBlob.size / 1024 * scaleRatio);
      const estStr = estKB > 1024 ? `~${(estKB / 1024).toFixed(1)} MB` : `~${estKB} KB`;
      $('export-preview-info').textContent = `Preview \u2014 ${estStr} (${opts.format.toUpperCase()})`;
      $('export-estimate').textContent = estStr;
    } else if (opts.format !== 'png') {
      const mimeType = opts.format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      const blob = await new Promise(r => tmp.toBlob(b => r(b), mimeType, opts.quality / 100));
      const img = await createImageBitmap(blob);
      exportPreviewCanvas.width = img.width;
      exportPreviewCanvas.height = img.height;
      exportPreviewCanvas.getContext('2d').drawImage(img, 0, 0);
      const estKB = Math.round(blob.size / 1024 * scaleRatio);
      const estStr = estKB > 1024 ? `~${(estKB / 1024).toFixed(1)} MB` : `~${estKB} KB`;
      $('export-preview-info').textContent = `Preview \u2014 ${estStr} (${opts.format.toUpperCase()})`;
      $('export-estimate').textContent = estStr;
    } else {
      exportPreviewCanvas.width = tmp.width;
      exportPreviewCanvas.height = tmp.height;
      exportPreviewCanvas.getContext('2d').drawImage(tmp, 0, 0);
      // Estimate PNG size from preview blob
      const pngBlob = await new Promise(r => tmp.toBlob(b => r(b), 'image/png'));
      const estKB = Math.round(pngBlob.size / 1024 * scaleRatio);
      const estStr = estKB > 1024 ? `~${(estKB / 1024).toFixed(1)} MB` : `~${estKB} KB`;
      $('export-preview-info').textContent = `Preview \u2014 ${estStr} (PNG)`;
      $('export-estimate').textContent = estStr;
    }
  }

  function scheduleExportPreview() {
    clearTimeout(exportPreviewDebounce);
    exportPreviewDebounce = setTimeout(renderExportPreview, 150);
  }

  $('btn-export').addEventListener('click', openExportModal);
  $('export-modal-close').addEventListener('click', closeExportModal);
  $('export-cancel').addEventListener('click', closeExportModal);
  exportModal.addEventListener('click', e => { if (e.target === exportModal) closeExportModal(); });

  // Scale buttons
  document.querySelectorAll('.export-scale-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('disabled')) return;
      exportScale = parseInt(btn.dataset.scale);
      const src = DitherEngine.getSourceSize();
      if (src) { updateExportDimReadout(src); updateExportScaleButtons(src); }
      updateFilenamePreview();
      scheduleExportPreview();
    });
  });

  // Upscale mode radio
  document.querySelectorAll('input[name="export-upscale"]').forEach(radio => {
    radio.addEventListener('change', scheduleExportPreview);
  });

  // Format radio change
  document.querySelectorAll('input[name="export-format"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const fmt = document.querySelector('input[name="export-format"]:checked').value;
      if (fmt === 'png') {
        $('export-compress-toggle').checked = false;
        $('export-compress-section').style.display = 'none';
      }
      updateFilenamePreview();
      scheduleExportPreview();
    });
  });

  // Compress toggle
  $('export-compress-toggle').addEventListener('change', e => {
    const fmt = document.querySelector('input[name="export-format"]:checked').value;
    if (e.target.checked && fmt === 'png') {
      document.querySelector('input[name="export-format"][value="jpeg"]').checked = true;
    }
    $('export-compress-section').style.display = e.target.checked ? '' : 'none';
    scheduleExportPreview();
  });

  // Quality/artifact sliders update preview
  $('export-quality').addEventListener('input', e => {
    $('export-quality-val').textContent = e.target.value;
    scheduleExportPreview();
  });
  $('export-artifact-intensity').addEventListener('input', e => {
    $('export-artifact-val').textContent = e.target.value;
    scheduleExportPreview();
  });
  $('export-recompress-passes').addEventListener('input', e => {
    $('export-recompress-val').textContent = e.target.value;
    scheduleExportPreview();
  });

  // Print-ready toggle
  $('export-print-ready').addEventListener('change', () => {
    updatePrintReadyLocks();
    updateFilenamePreview();
    scheduleExportPreview();
  });

  // Filename input
  $('export-filename').addEventListener('input', updateFilenamePreview);

  // Confirm export — with progress overlay
  $('export-confirm').addEventListener('click', async () => {
    const btn = $('export-confirm');
    btn.disabled = true;
    $('export-cancel').disabled = true;

    // Show progress overlay on modal
    const modal = exportModal.querySelector('.modal');
    const overlay = document.createElement('div');
    overlay.className = 'export-progress-overlay';
    overlay.innerHTML = `
      <div class="processing-spinner"></div>
      <div class="export-progress-text">Preparing export\u2026</div>
      <div class="export-progress-detail"></div>
    `;
    modal.style.position = 'relative';
    modal.appendChild(overlay);

    const progressText = overlay.querySelector('.export-progress-text');
    const progressDetail = overlay.querySelector('.export-progress-detail');

    const opts = getExportOpts();
    // Always export exactly what's on the canvas — WYSIWYG
    const canvasData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let blob = await DitherEngine.exportImageData(canvasData, opts, (msg, detail) => {
      progressText.textContent = msg;
      progressDetail.textContent = detail || '';
    });

    // Print-ready: inject 300 DPI pHYs chunk into the PNG
    if (blob && opts.printReady && opts.format === 'png') {
      progressText.textContent = 'Tagging 300 DPI\u2026';
      progressDetail.textContent = '';
      try { blob = await addPngDpiMetadata(blob, 300); } catch (e) { console.warn('DPI tag failed', e); }
    }

    if (blob) {
      progressText.textContent = 'Downloading\u2026';
      const sizeKB = (blob.size / 1024).toFixed(0);
      progressDetail.textContent = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
      const ext = opts.format === 'jpeg' ? 'jpg' : opts.format;
      const scaleLabel = exportScale > 1 ? `_${exportScale}x` : '';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentFilenameBase()}${scaleLabel}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    }

    // Brief pause to show download state
    await new Promise(r => setTimeout(r, 400));
    overlay.remove();
    btn.disabled = false;
    $('export-cancel').disabled = false;
    btn.textContent = 'Export';
    closeExportModal();
  });

  // ── Bake ──
  // TRUE WYSIWYG: the current canvas pixels become the new source, byte-for-byte.
  // We never re-run the pipeline at a different resolution, never re-downsample,
  // never re-render after bake. What you see on screen is exactly what gets baked.
  $('btn-bake').addEventListener('click', () => {
    if (!canvas.width || !canvas.height) return;
    pushUndo();
    // 1. Capture current canvas pixels — this IS the baked image.
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // 2. Install those pixels as the new source.
    const result = DitherEngine.bakeImageData(snapshot);
    if (!result) return;
    $('image-info').textContent = `${result.width} \u00d7 ${result.height} \u2014 baked`;
    // 3. Reset all pipeline state — the baked pixels are the starting point now.
    state.selectedAlgorithms = [];
    state.globals.brightness = 0;
    state.globals.contrast = 0;
    state.globals.gamma = 1.0;
    // Force colorMode='color' + neutral dk/lt so when the next slider triggers
    // a re-render, empty-pipeline+color mode passes the RGB pixels through verbatim.
    state.globals.colorMode = 'color';
    state.globals.colorDark = '#000000';
    state.globals.colorLight = '#ffffff';
    state.globals.toneLock = { shadows: false, midtones: false, highlights: false, shadowMid: 64, midHighlight: 192 };
    // Reset grain + paint — they're already composited into the snapshot.
    grainLayers.length = 0;
    updateGrainUI();
    buildGrainParamPanels();
    PaintEngine.clearStrokes();
    updateStrokeCount();
    syncUIFromState();
    updateAlgorithmUI();
    buildParamPanels();
    // 4. Critically: DO NOT call runProcess. The canvas already shows the
    //    baked pixels and re-rendering risks drift. The next user interaction
    //    (adding an algo, tweaking a slider) will kick runProcess on the new source.
    // 5. Belt-and-suspenders: paint the snapshot back over the canvas in case
    //    syncUIFromState/buildParamPanels triggered anything that redrew.
    ctx.putImageData(snapshot, 0, 0);
  });

  // ── Reset ──
  $('btn-reset').addEventListener('click', () => {
    pushUndo();
    state.selectedAlgorithms = [];
    state.globals = {
      colorMode: 'bw',
      grayscaleMode: 'luminance',
      brightness: 0, contrast: 0, gamma: 1.0,
      colorDark: '#000000', colorLight: '#ffffff',
      palettePreset: 'pico8', maxColors: 16, palette: null,
      toneLock: { shadows: false, midtones: false, highlights: false, shadowMid: 64, midHighlight: 192 }
    };

    $('style-preset').value = '';
    syncUIFromState();
    updateAlgorithmUI();
    buildParamPanels();
    runProcess();
  });

  // ── Tab Switching ──
  let activeTab = 'dither';
  const brushCursor = $('brush-cursor');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === activeTab) return;
      activeTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      $('tab-dither').style.display = tab === 'dither' ? '' : 'none';
      $('tab-grain').style.display = tab === 'grain' ? '' : 'none';
      $('tab-paintstroke').style.display = tab === 'paintstroke' ? '' : 'none';
      // Show/hide brush cursor based on tab + canvas hover
      updateCursorVisibility();
      // Set canvas cursor
      canvasWrapper.style.cursor = tab === 'paintstroke' ? 'none' : '';
    });
  });

  // ── Grain Layers ──
  const GRAIN_TYPES = {
    'fine-film': { name: 'Fine Film (35mm)', category: 'film' },
    'medium-film': { name: 'Medium Film (Super 16)', category: 'film' },
    'coarse-film': { name: 'Coarse Film (8mm)', category: 'film' },
    'tri-x': { name: 'Kodak Tri-X 400', category: 'film' },
    'hp5': { name: 'Ilford HP5+', category: 'film' },
    'tmax': { name: 'Kodak T-Max 3200', category: 'film' },
    'portra': { name: 'Kodak Portra 400', category: 'film' },
    'cinestill': { name: 'CineStill 800T', category: 'film' },
    'delta3200': { name: 'Ilford Delta 3200', category: 'film' },
    'ektar': { name: 'Kodak Ektar 100', category: 'film' },
    'gaussian': { name: 'Gaussian Noise', category: 'digital' },
    'uniform': { name: 'Uniform Noise', category: 'digital' },
    'salt-pepper': { name: 'Salt & Pepper', category: 'digital' },
    'poisson': { name: 'Poisson (Shot Noise)', category: 'digital' },
    'speckle': { name: 'Speckle', category: 'digital' },
    'laplacian': { name: 'Laplacian Noise', category: 'digital' },
    'perlin': { name: 'Perlin Noise', category: 'organic' },
    'simplex': { name: 'Simplex Noise', category: 'organic' },
    'worley': { name: 'Worley (Cellular)', category: 'organic' },
    'fbm': { name: 'Fractal Brownian Motion', category: 'organic' },
    'turbulence': { name: 'Turbulence', category: 'organic' },
    'ridged': { name: 'Ridged Multifractal', category: 'organic' },
    'voronoi-crack': { name: 'Voronoi Cracks', category: 'organic' },
    'paper': { name: 'Paper Texture', category: 'textured' },
    'canvas-tex': { name: 'Canvas Weave', category: 'textured' },
    'linen': { name: 'Linen', category: 'textured' },
    'concrete': { name: 'Concrete', category: 'textured' },
    'sandstone': { name: 'Sandstone', category: 'textured' },
    'brushstroke': { name: 'Brushstroke', category: 'textured' },
    'iso-low': { name: 'Low ISO (100-200)', category: 'photo' },
    'iso-mid': { name: 'Mid ISO (800-1600)', category: 'photo' },
    'iso-high': { name: 'High ISO (3200-6400)', category: 'photo' },
    'iso-extreme': { name: 'Extreme ISO (12800+)', category: 'photo' },
    'chromatic': { name: 'Chromatic Noise', category: 'photo' },
    'luminance-noise': { name: 'Luminance Noise', category: 'photo' }
  };

  const grainLayers = [];

  // ── Paint layer composite (how paint overlay blends onto dither+grain) ──
  const paintComposite = { mode: 'normal', opacity: 100 };

  function defaultGrainParams() {
    return {
      amount: 30, size: 1, roughness: 50, variance: 50, softness: 0,
      seed: 42, seedRandom: false,
      highPass: { enabled: false, radius: 10, strength: 50 },
      valueMask: { shadows: 100, midtones: 100, highlights: 100, shadowMid: 64, midHighlight: 192, invert: false },
      colorMode: 'mono', channelR: 100, channelG: 100, channelB: 100,
      tintColor: '#8b7355', tintStrength: 50,
      blendMode: 'overlay', opacity: 100
    };
  }

  function buildGrainLayerOpts(layer) {
    const p = layer.params;
    const h = p.tintColor;
    const tr = parseInt(h.slice(1, 3), 16), tg = parseInt(h.slice(3, 5), 16), tb = parseInt(h.slice(5, 7), 16);
    return {
      type: layer.id, amount: p.amount, size: p.size, roughness: p.roughness,
      variance: p.variance, softness: p.softness, seed: p.seed,
      highPass: p.highPass, valueMask: p.valueMask,
      colorMode: p.colorMode, channelR: p.channelR, channelG: p.channelG, channelB: p.channelB,
      tintColor: [tr, tg, tb], tintStrength: p.tintStrength,
      blendMode: p.blendMode, opacity: p.opacity
    };
  }

  function buildAllGrainOpts() {
    return grainLayers.map(buildGrainLayerOpts);
  }

  // ── Grain Type List ──
  function buildGrainList() {
    const categories = ['film', 'digital', 'organic', 'textured', 'photo'];
    for (const cat of categories) {
      const container = document.querySelector(`.grain-type-list[data-category="${cat}"]`);
      if (!container) continue;
      container.innerHTML = '';
      const types = Object.entries(GRAIN_TYPES).filter(([, t]) => t.category === cat);
      for (const [id, info] of types) {
        const item = document.createElement('div');
        item.className = 'algo-item';
        item.dataset.grainId = id;
        item.draggable = true;
        item.innerHTML = `
          <div class="algo-checkbox">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#0a0a0a" stroke-width="2.5">
              <polyline points="2 6 5 9 10 3"/>
            </svg>
          </div>
          <span class="algo-name">${info.name}</span>
          <span class="algo-order"></span>
          <span class="algo-drag">\u2801\u2802\u2804</span>
        `;
        item.addEventListener('click', () => toggleGrainType(id));
        item.addEventListener('dragstart', onGrainDragStart);
        item.addEventListener('dragover', onGrainDragOver);
        item.addEventListener('drop', onGrainDrop);
        item.addEventListener('dragend', onGrainDragEnd);
        container.appendChild(item);
      }
    }
  }

  let grainDragSrcId = null;
  function onGrainDragStart(e) { grainDragSrcId = this.dataset.grainId; e.dataTransfer.effectAllowed = 'move'; this.style.opacity = '0.4'; }
  function onGrainDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onGrainDrop(e) {
    e.preventDefault();
    const tgt = this.dataset.grainId;
    if (grainDragSrcId && grainDragSrcId !== tgt) {
      const si = grainLayers.findIndex(l => l.id === grainDragSrcId);
      const ti = grainLayers.findIndex(l => l.id === tgt);
      if (si !== -1 && ti !== -1) {
        const [item] = grainLayers.splice(si, 1);
        grainLayers.splice(ti, 0, item);
        updateGrainUI();
        buildGrainParamPanels();
        scheduleProcess();
      }
    }
  }
  function onGrainDragEnd() { this.style.opacity = ''; grainDragSrcId = null; }

  function toggleGrainType(id) {
    const idx = grainLayers.findIndex(l => l.id === id);
    if (idx !== -1) {
      grainLayers.splice(idx, 1);
    } else {
      grainLayers.push({ id, params: defaultGrainParams() });
    }
    updateGrainUI();
    buildGrainParamPanels();
    scheduleProcess();
  }

  function updateGrainUI() {
    document.querySelectorAll('.grain-type-list .algo-item').forEach(item => {
      const id = item.dataset.grainId;
      const si = grainLayers.findIndex(l => l.id === id);
      item.classList.toggle('selected', si !== -1);
      item.querySelector('.algo-order').textContent = si !== -1 ? `#${si + 1}` : '';
    });
  }

  // ── Shared Blend Mode option set (used by grain layers, dither pipeline,
  // and paint layer composite). All modes are routed through the unified
  // DitherEngine.blendPixel which accepts both hyphen-case and legacy
  // camelCase names so older saved state keeps working. ──
  // (forward declared below; defined once and reused everywhere)
  function normalizeBlendMode(m) {
    if (!m) return 'normal';
    const map = { softLight: 'soft-light', hardLight: 'hard-light',
                  vividLight: 'vivid-light', linearLight: 'linear-light',
                  pinLight: 'pin-light', hardMix: 'hard-mix',
                  colorBurn: 'color-burn', linearBurn: 'linear-burn',
                  colorDodge: 'color-dodge', linearDodge: 'linear-dodge',
                  add: 'linear-dodge' };
    return map[m] || m;
  }
  function ditherBlendModeOptionsHTML(currentMode) {
    const cur = normalizeBlendMode(currentMode);
    return BLEND_MODE_OPTS.map(g =>
      `<optgroup label="${g.group}">${g.modes.map(([v,l]) =>
        `<option value="${v}"${cur===v?' selected':''}>${l}</option>`).join('')}</optgroup>`
    ).join('');
  }

  // ── Grain Param Panels ──
  const BLEND_MODE_OPTS = [
    { group: 'Normal', modes: [['normal','Normal'],['dissolve','Dissolve']] },
    { group: 'Darken', modes: [['multiply','Multiply'],['darken','Darken'],['color-burn','Color Burn'],['linear-burn','Linear Burn']] },
    { group: 'Lighten', modes: [['screen','Screen'],['lighten','Lighten'],['color-dodge','Color Dodge'],['linear-dodge','Linear Dodge (Add)']] },
    { group: 'Contrast', modes: [['overlay','Overlay'],['soft-light','Soft Light'],['hard-light','Hard Light'],['vivid-light','Vivid Light'],['linear-light','Linear Light'],['pin-light','Pin Light'],['hard-mix','Hard Mix']] },
    { group: 'Inversion', modes: [['difference','Difference'],['exclusion','Exclusion'],['subtract','Subtract'],['divide','Divide']] },
    { group: 'Component', modes: [['luminosity','Luminosity']] }
  ];

  function buildGrainParamPanels() {
    const container = $('grain-params-container');
    container.innerHTML = '';

    for (const layer of grainLayers) {
      const info = GRAIN_TYPES[layer.id];
      const p = layer.params;
      const section = document.createElement('div');
      section.className = 'param-section';

      const blendOpts = BLEND_MODE_OPTS.map(g =>
        `<optgroup label="${g.group}">${g.modes.map(([v,l]) =>
          `<option value="${v}"${p.blendMode===v?' selected':''}>${l}</option>`).join('')}</optgroup>`
      ).join('');

      const colorOpts = [['mono','Monochrome'],['color','Color Noise'],['channel','Per-Channel'],['tinted','Tinted']]
        .map(([v,l]) => `<option value="${v}"${p.colorMode===v?' selected':''}>${l}</option>`).join('');

      const advOpen = p._advancedOpen || false;

      let html = `
        <div class="param-section-header">
          <span class="param-section-title">${info.name}</span>
          <div class="param-section-actions">
            <button class="param-section-btn btn-randomize-grain" data-grain-id="${layer.id}" title="Randomize">Dice</button>
            <button class="param-section-btn btn-remove-grain" data-grain-id="${layer.id}" title="Remove">\u2715</button>
          </div>
        </div>
        <div class="param-group">
          <span class="param-label">Amount</span>
          <div class="slider-row">
            <input type="range" data-grain="${layer.id}" data-gparam="amount" min="0" max="100" step="1" value="${p.amount}">
            <span class="param-value">${p.amount}</span>
          </div>
        </div>
        <div class="param-group">
          <span class="param-label">Size</span>
          <div class="slider-row">
            <input type="range" data-grain="${layer.id}" data-gparam="size" min="0.5" max="8" step="0.1" value="${p.size}">
            <span class="param-value">${p.size}</span>
          </div>
        </div>
        <div class="param-group">
          <span class="param-label">Blend Mode</span>
          <select data-grain="${layer.id}" data-gparam="blendMode">${blendOpts}</select>
        </div>
        <div class="param-group">
          <span class="param-label">Opacity</span>
          <div class="slider-row">
            <input type="range" data-grain="${layer.id}" data-gparam="opacity" min="0" max="100" step="1" value="${p.opacity}">
            <span class="param-value">${p.opacity}</span>
          </div>
        </div>
        <div class="param-group">
          <button class="btn-advanced-toggle" data-grain-adv="${layer.id}" title="More options">
            <span class="advanced-arrow ${advOpen ? 'open' : ''}"></span> Advanced
          </button>
        </div>
        <div class="advanced-controls ${advOpen ? '' : 'hidden'}" data-grain-advanced-for="${layer.id}">
          <div class="param-group">
            <span class="param-label">Roughness</span>
            <div class="slider-row">
              <input type="range" data-grain="${layer.id}" data-gparam="roughness" min="0" max="100" step="1" value="${p.roughness}">
              <span class="param-value">${p.roughness}</span>
            </div>
          </div>
          <div class="param-group">
            <span class="param-label">Intensity Variance</span>
            <div class="slider-row">
              <input type="range" data-grain="${layer.id}" data-gparam="variance" min="0" max="100" step="1" value="${p.variance}">
              <span class="param-value">${p.variance}</span>
            </div>
          </div>
          <div class="param-group">
            <span class="param-label">Softness</span>
            <div class="slider-row">
              <input type="range" data-grain="${layer.id}" data-gparam="softness" min="0" max="100" step="1" value="${p.softness}">
              <span class="param-value">${p.softness}</span>
            </div>
          </div>
          <div class="param-group seed-group">
            <span class="param-label">Seed</span>
            <div class="seed-row">
              <input type="number" class="seed-input" data-grain-seed="${layer.id}" value="${p.seed}" min="1" max="999999" ${p.seedRandom ? 'disabled' : ''}>
              <label class="seed-random-label" title="Random seed each render">
                <input type="checkbox" class="seed-random-check" data-grain-seed-rnd="${layer.id}" ${p.seedRandom ? 'checked' : ''}>
                <span>Random</span>
              </label>
            </div>
          </div>
          <div class="param-group" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
            <span class="param-label" style="color:var(--fun); font-weight:600; font-size:10px; text-transform:uppercase; letter-spacing:0.06em;">High Pass Filter</span>
          </div>
          <div class="param-group">
            <label class="slider-row">
              <input type="checkbox" data-grain-hp="${layer.id}" ${p.highPass.enabled ? 'checked' : ''}>
              <span class="param-label" style="margin:0 0 0 6px">Enable</span>
            </label>
          </div>
          <div data-grain-hp-controls="${layer.id}" style="display:${p.highPass.enabled ? '' : 'none'}">
            <div class="param-group">
              <span class="param-label">Radius</span>
              <div class="slider-row">
                <input type="range" data-grain="${layer.id}" data-gparam="highPass.radius" min="1" max="50" step="1" value="${p.highPass.radius}">
                <span class="param-value">${p.highPass.radius}</span>
              </div>
            </div>
            <div class="param-group">
              <span class="param-label">Strength</span>
              <div class="slider-row">
                <input type="range" data-grain="${layer.id}" data-gparam="highPass.strength" min="0" max="100" step="1" value="${p.highPass.strength}">
                <span class="param-value">${p.highPass.strength}</span>
              </div>
            </div>
          </div>
          <div class="param-group" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
            <span class="param-label" style="color:var(--fun); font-weight:600; font-size:10px; text-transform:uppercase; letter-spacing:0.06em;">Value Masking</span>
          </div>
          <div class="param-group">
            <span class="param-label">Shadows</span>
            <div class="slider-row">
              <input type="range" data-grain="${layer.id}" data-gparam="valueMask.shadows" min="0" max="100" step="1" value="${p.valueMask.shadows}">
              <span class="param-value">${p.valueMask.shadows}</span>
            </div>
          </div>
          <div class="param-group">
            <span class="param-label">Midtones</span>
            <div class="slider-row">
              <input type="range" data-grain="${layer.id}" data-gparam="valueMask.midtones" min="0" max="100" step="1" value="${p.valueMask.midtones}">
              <span class="param-value">${p.valueMask.midtones}</span>
            </div>
          </div>
          <div class="param-group">
            <span class="param-label">Highlights</span>
            <div class="slider-row">
              <input type="range" data-grain="${layer.id}" data-gparam="valueMask.highlights" min="0" max="100" step="1" value="${p.valueMask.highlights}">
              <span class="param-value">${p.valueMask.highlights}</span>
            </div>
          </div>
          <div class="param-group">
            <span class="param-label">Shadow / Mid Boundary</span>
            <div class="slider-row">
              <input type="range" data-grain="${layer.id}" data-gparam="valueMask.shadowMid" min="20" max="120" step="1" value="${p.valueMask.shadowMid}">
              <span class="param-value">${p.valueMask.shadowMid}</span>
            </div>
          </div>
          <div class="param-group">
            <span class="param-label">Mid / Highlight Boundary</span>
            <div class="slider-row">
              <input type="range" data-grain="${layer.id}" data-gparam="valueMask.midHighlight" min="130" max="240" step="1" value="${p.valueMask.midHighlight}">
              <span class="param-value">${p.valueMask.midHighlight}</span>
            </div>
          </div>
          <div class="param-group">
            <label class="slider-row">
              <input type="checkbox" data-grain-mask-inv="${layer.id}" ${p.valueMask.invert ? 'checked' : ''}>
              <span class="param-label" style="margin:0 0 0 6px">Invert Mask</span>
            </label>
          </div>
          <div class="param-group" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
            <span class="param-label" style="color:var(--fun); font-weight:600; font-size:10px; text-transform:uppercase; letter-spacing:0.06em;">Grain Color</span>
          </div>
          <div class="param-group">
            <select data-grain-color-mode="${layer.id}">${colorOpts}</select>
          </div>
          <div data-grain-color-ch="${layer.id}" style="display:${(p.colorMode === 'channel' || p.colorMode === 'color') ? '' : 'none'}">
            <div class="param-group">
              <span class="param-label">Red</span>
              <div class="slider-row">
                <input type="range" data-grain="${layer.id}" data-gparam="channelR" min="0" max="100" step="1" value="${p.channelR}">
                <span class="param-value">${p.channelR}</span>
              </div>
            </div>
            <div class="param-group">
              <span class="param-label">Green</span>
              <div class="slider-row">
                <input type="range" data-grain="${layer.id}" data-gparam="channelG" min="0" max="100" step="1" value="${p.channelG}">
                <span class="param-value">${p.channelG}</span>
              </div>
            </div>
            <div class="param-group">
              <span class="param-label">Blue</span>
              <div class="slider-row">
                <input type="range" data-grain="${layer.id}" data-gparam="channelB" min="0" max="100" step="1" value="${p.channelB}">
                <span class="param-value">${p.channelB}</span>
              </div>
            </div>
          </div>
          <div data-grain-color-tint="${layer.id}" style="display:${p.colorMode === 'tinted' ? '' : 'none'}">
            <div class="param-group">
              <span class="param-label">Tint Color</span>
              <div class="color-pair">
                <input type="color" data-grain-tint="${layer.id}" value="${p.tintColor}" title="Grain tint">
              </div>
            </div>
            <div class="param-group">
              <span class="param-label">Tint Strength</span>
              <div class="slider-row">
                <input type="range" data-grain="${layer.id}" data-gparam="tintStrength" min="0" max="100" step="1" value="${p.tintStrength}">
                <span class="param-value">${p.tintStrength}</span>
              </div>
            </div>
          </div>
        </div>
      `;

      section.innerHTML = html;
      container.appendChild(section);

      // ── Wire Events ──
      section.querySelector('.btn-remove-grain').addEventListener('click', () => toggleGrainType(layer.id));
      section.querySelector('.btn-randomize-grain').addEventListener('click', () => randomizeGrainLayer(layer.id));

      // Range sliders
      section.querySelectorAll('input[type="range"][data-grain]').forEach(input => {
        input.addEventListener('input', () => {
          const l = grainLayers.find(g => g.id === input.dataset.grain);
          if (!l) return;
          const param = input.dataset.gparam;
          const v = parseFloat(input.value);
          if (param.includes('.')) {
            const [obj, key] = param.split('.');
            l.params[obj][key] = v;
          } else {
            l.params[param] = v;
          }
          input.closest('.slider-row').querySelector('.param-value').textContent = Number.isInteger(v) ? v : v.toFixed(1);
          scheduleProcess();
        });
      });

      // Blend mode select
      section.querySelectorAll('select[data-gparam="blendMode"]').forEach(sel => {
        sel.addEventListener('change', () => {
          const l = grainLayers.find(g => g.id === sel.dataset.grain);
          if (l) l.params.blendMode = sel.value;
          scheduleProcess();
        });
      });

      // Advanced toggle
      section.querySelectorAll('[data-grain-adv]').forEach(btn => {
        btn.addEventListener('click', () => {
          const gid = btn.dataset.grainAdv;
          const panel = section.querySelector(`[data-grain-advanced-for="${gid}"]`);
          const arrow = btn.querySelector('.advanced-arrow');
          const l = grainLayers.find(g => g.id === gid);
          if (panel) {
            const isOpen = !panel.classList.contains('hidden');
            panel.classList.toggle('hidden', isOpen);
            arrow.classList.toggle('open', !isOpen);
            if (l) l.params._advancedOpen = !isOpen;
          }
        });
      });

      // High pass toggle
      section.querySelectorAll('[data-grain-hp]').forEach(chk => {
        chk.addEventListener('change', () => {
          const l = grainLayers.find(g => g.id === chk.dataset.grainHp);
          if (l) {
            l.params.highPass.enabled = chk.checked;
            const ctrl = section.querySelector(`[data-grain-hp-controls="${chk.dataset.grainHp}"]`);
            if (ctrl) ctrl.style.display = chk.checked ? '' : 'none';
            scheduleProcess();
          }
        });
      });

      // Value mask invert
      section.querySelectorAll('[data-grain-mask-inv]').forEach(chk => {
        chk.addEventListener('change', () => {
          const l = grainLayers.find(g => g.id === chk.dataset.grainMaskInv);
          if (l) { l.params.valueMask.invert = chk.checked; scheduleProcess(); }
        });
      });

      // Color mode select
      section.querySelectorAll('[data-grain-color-mode]').forEach(sel => {
        sel.addEventListener('change', () => {
          const gid = sel.dataset.grainColorMode;
          const l = grainLayers.find(g => g.id === gid);
          if (l) {
            l.params.colorMode = sel.value;
            const chCtrl = section.querySelector(`[data-grain-color-ch="${gid}"]`);
            const tintCtrl = section.querySelector(`[data-grain-color-tint="${gid}"]`);
            if (chCtrl) chCtrl.style.display = (sel.value === 'channel' || sel.value === 'color') ? '' : 'none';
            if (tintCtrl) tintCtrl.style.display = sel.value === 'tinted' ? '' : 'none';
            scheduleProcess();
          }
        });
      });

      // Tint color
      section.querySelectorAll('[data-grain-tint]').forEach(input => {
        input.addEventListener('input', () => {
          const l = grainLayers.find(g => g.id === input.dataset.grainTint);
          if (l) { l.params.tintColor = input.value; scheduleProcess(); }
        });
      });

      // Seed input
      section.querySelectorAll('[data-grain-seed]').forEach(input => {
        let timer;
        input.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            const l = grainLayers.find(g => g.id === input.dataset.grainSeed);
            if (l) { l.params.seed = parseInt(input.value) || 1; scheduleProcess(); }
          }, 400);
        });
      });

      // Seed random
      section.querySelectorAll('[data-grain-seed-rnd]').forEach(chk => {
        chk.addEventListener('change', () => {
          const gid = chk.dataset.grainSeedRnd;
          const l = grainLayers.find(g => g.id === gid);
          const numInput = section.querySelector(`[data-grain-seed="${gid}"]`);
          if (l) {
            l.params.seedRandom = chk.checked;
            if (chk.checked) {
              const rnd = Math.floor(Math.random() * 999999) + 1;
              l.params.seed = rnd;
              if (numInput) { numInput.value = rnd; numInput.disabled = true; }
            } else if (numInput) { numInput.disabled = false; }
            scheduleProcess();
          }
        });
      });
    }
  }

  function randomizeGrainLayer(id) {
    const layer = grainLayers.find(l => l.id === id);
    if (!layer) return;
    const p = layer.params;
    p.amount = Math.floor(Math.random() * 80) + 5;
    p.size = +(Math.random() * 4 + 0.5).toFixed(1);
    p.roughness = Math.floor(Math.random() * 100);
    p.variance = Math.floor(Math.random() * 100);
    p.seed = Math.floor(Math.random() * 999999) + 1;
    const modes = ['normal','multiply','screen','overlay','soft-light','hard-light','difference','exclusion','linear-light','color-burn','color-dodge'];
    p.blendMode = modes[Math.floor(Math.random() * modes.length)];
    p.opacity = Math.floor(Math.random() * 60) + 40;
    buildGrainParamPanels();
    scheduleProcess();
  }

  // Grain randomize — picks 1-3 random grain types
  if ($('grain-randomize')) {
    $('grain-randomize').addEventListener('click', () => {
      const allTypes = Object.keys(GRAIN_TYPES);
      const count = Math.floor(Math.random() * 3) + 1;
      const shuffled = [...allTypes].sort(() => Math.random() - 0.5);
      grainLayers.length = 0;
      for (let i = 0; i < count; i++) {
        const params = defaultGrainParams();
        params.amount = Math.floor(Math.random() * 80) + 5;
        params.size = +(Math.random() * 4 + 0.5).toFixed(1);
        params.roughness = Math.floor(Math.random() * 100);
        params.variance = Math.floor(Math.random() * 100);
        params.seed = Math.floor(Math.random() * 999999) + 1;
        const modes = ['normal','multiply','screen','overlay','soft-light','hard-light','difference','exclusion'];
        params.blendMode = modes[Math.floor(Math.random() * modes.length)];
        params.opacity = Math.floor(Math.random() * 60) + 40;
        grainLayers.push({ id: shuffled[i], params });
      }
      updateGrainUI();
      buildGrainParamPanels();
      scheduleProcess();
    });
  }

  // ── Paintstroke UI ──
  PaintEngine.init(canvas);

  function updateStrokeCount() {
    const cnt = PaintEngine.getStrokeCount();
    $('stroke-count').textContent = cnt + ' stroke' + (cnt !== 1 ? 's' : '');
    $('btn-clear-strokes').disabled = cnt === 0;
  }

  // Tool selection
  function enterPickupMarquee() {
    if (!DitherEngine.getSourceSize()) return;
    pickupSelectionMode = true;
    canvasWrapper.style.cursor = 'crosshair';
    if (brushCursor) brushCursor.style.display = 'none';
  }

  document.querySelectorAll('.paint-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.paint-tool-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      PaintEngine.setTool(btn.dataset.tool);
      buildToolOptions(btn.dataset.tool);
      // Auto-enter marquee mode when selecting pickup without a stamp
      if (btn.dataset.tool === 'pickup' && !PaintEngine.hasStamp()) {
        enterPickupMarquee();
      }
    });
  });

  // Stroke sliders
  function paintSlider(id, setter) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      setter(v);
      const disp = el.parentElement.querySelector('.param-value');
      if (disp) disp.textContent = Number.isInteger(v) ? v : v.toFixed(1);
    });
  }

  paintSlider('paint-size', v => { PaintEngine.setSize(v); PaintEngine.invalidateCursorCache(); updateBrushCursorImage(); });
  paintSlider('paint-spacing', v => PaintEngine.setSpacing(v));
  paintSlider('paint-strength', v => PaintEngine.setStrength(v));
  paintSlider('paint-opacity', v => PaintEngine.setOpacity(v));

  // Brush shape influence + wet-paint sliders
  paintSlider('brush-shape-influence', v => PaintEngine.setShapeInfluence(v));
  paintSlider('paint-wet-drip', v => PaintEngine.setWetDrip(v));
  paintSlider('paint-wet-bleed', v => PaintEngine.setWetBleed(v));
  paintSlider('paint-wet-smear', v => PaintEngine.setWetSmear(v));
  paintSlider('paint-wet-separate', v => PaintEngine.setWetSeparate(v));
  paintSlider('paint-wet-lifetime', v => PaintEngine.setWetLifetime(v));
  paintSlider('paint-wet-evolve', v => PaintEngine.setWetEvolveRate(v));

  // ── Pen pressure controls ──
  const pSizeCheck = $('paint-pressure-size');
  if (pSizeCheck) pSizeCheck.addEventListener('change', () => PaintEngine.setPressureSize(pSizeCheck.checked));
  const pOpCheck = $('paint-pressure-opacity');
  if (pOpCheck) pOpCheck.addEventListener('change', () => PaintEngine.setPressureOpacity(pOpCheck.checked));
  paintSlider('paint-pressure-size-min', v => PaintEngine.setPressureSizeMin(v / 100));
  paintSlider('paint-pressure-opacity-min', v => PaintEngine.setPressureOpacityMin(v / 100));

  // Extended pen pressure / tilt / twist / velocity controls
  const pStrCheck = $('paint-pressure-strength');
  if (pStrCheck) pStrCheck.addEventListener('change', () => PaintEngine.setPressureStrength(pStrCheck.checked));
  paintSlider('paint-pressure-strength-min', v => PaintEngine.setPressureStrengthMin(v / 100));
  const pSpcCheck = $('paint-pressure-spacing');
  if (pSpcCheck) pSpcCheck.addEventListener('change', () => PaintEngine.setPressureSpacing(pSpcCheck.checked));
  // Curve is stored as 0.1..5, slider holds 10..500 (×100) for integer step
  paintSlider('paint-pressure-curve', v => PaintEngine.setPressureCurve(v / 100));

  const tiltCheck = $('paint-tilt-enabled');
  if (tiltCheck) tiltCheck.addEventListener('change', () => PaintEngine.setTiltEnabled(tiltCheck.checked));
  paintSlider('paint-tilt-angle', v => PaintEngine.setTiltAngleInfluence(v / 100));
  paintSlider('paint-tilt-size',  v => PaintEngine.setTiltSizeInfluence(v / 100));

  const twistCheck = $('paint-twist-enabled');
  if (twistCheck) twistCheck.addEventListener('change', () => PaintEngine.setTwistEnabled(twistCheck.checked));
  paintSlider('paint-twist-influence', v => PaintEngine.setTwistInfluence(v / 100));

  const velCheck = $('paint-velocity-enabled');
  if (velCheck) velCheck.addEventListener('change', () => PaintEngine.setVelocityEnabled(velCheck.checked));
  paintSlider('paint-velocity-size', v => PaintEngine.setVelocitySizeInfluence(v / 100));

  // ── Paint layer composite mode + opacity ──
  const paintCompModeEl = $('paint-composite-mode');
  if (paintCompModeEl) {
    paintCompModeEl.innerHTML = BLEND_MODE_OPTS.map(g =>
      `<optgroup label="${g.group}">${g.modes.map(([v,l]) =>
        `<option value="${v}"${paintComposite.mode===v?' selected':''}>${l}</option>`).join('')}</optgroup>`
    ).join('');
    paintCompModeEl.addEventListener('change', () => {
      paintComposite.mode = paintCompModeEl.value;
      runProcess();
    });
  }
  const paintCompOpEl = $('paint-composite-opacity');
  if (paintCompOpEl) {
    paintCompOpEl.addEventListener('input', () => {
      paintComposite.opacity = parseFloat(paintCompOpEl.value);
      const disp = paintCompOpEl.parentElement.querySelector('.param-value');
      if (disp) disp.textContent = paintComposite.opacity;
      runProcess();
    });
  }

  // Tool-specific options panel
  function buildToolOptions(tool) {
    const container = $('paint-tool-params');
    container.innerHTML = '';
    const toolOpts = {
      smudge: [{ label: 'Decay', id: 'smudge-decay', min: 0, max: 100, value: PaintEngine.getSettings().smudgeDecay, setter: v => PaintEngine.setSmudgeDecay(v) }],
      push: [{ label: 'Distance', id: 'push-dist', min: 1, max: 100, value: PaintEngine.getSettings().pushDistance, setter: v => PaintEngine.setPushDistance(v) }],
      scatter: [{ label: 'Radius', id: 'scatter-rad', min: 1, max: 100, value: PaintEngine.getSettings().scatterRadius, setter: v => PaintEngine.setScatterRadius(v) }],
      swirl: [{ label: 'Angle', id: 'swirl-angle', min: -360, max: 360, value: PaintEngine.getSettings().swirlAngle, setter: v => PaintEngine.setSwirlAngle(v) }],
      liquify: [
        { label: 'Distance', id: 'liq-dist', min: 1, max: 100, value: PaintEngine.getSettings().pushDistance, setter: v => PaintEngine.setPushDistance(v) },
        { label: 'Smoothness', id: 'liq-smooth', min: 0, max: 2, step: 0.1, value: PaintEngine.getSettings().liquifySmooth, setter: v => PaintEngine.setLiquifySmooth(v) }
      ],
      blend: [{ label: 'Kernel', id: 'blend-kern', min: 1, max: 20, value: PaintEngine.getSettings().blendKernel, setter: v => PaintEngine.setBlendKernel(v) }],
      spread: [{ label: 'Amount', id: 'spread-amt', min: 1, max: 100, value: PaintEngine.getSettings().spreadAmount, setter: v => PaintEngine.setSpreadAmount(v) }],
      pickup: 'custom'
    };

    const opts = toolOpts[tool] || [];

    // Pickup tool: custom UI
    if (opts === 'custom' && tool === 'pickup') {
      const hasStamp = PaintEngine.hasStamp();
      const stampSize = PaintEngine.getStampSize();
      const s = PaintEngine.getSettings();

      // Helper to render a slider param row
      const sliderRow = (label, id, min, max, val, hint) => `
        <div class="param-group">
          <span class="param-label">${label}${hint ? `<span class="param-hint-inline"> ${hint}</span>` : ''}</span>
          <div class="slider-row">
            <input type="range" id="${id}" min="${min}" max="${max}" step="1" value="${val}">
            <span class="param-value">${val}</span>
          </div>
        </div>`;

      // Preset buttons that set a coherent group of params at once
      const presetBtn = (label, key) => `<button class="pickup-preset-btn" data-preset="${key}">${label}</button>`;

      container.innerHTML = `
        <div class="param-group">
          <button id="btn-pickup-select" class="btn-small">${hasStamp ? 'Re-select Pixels' : 'Select Pixels from Canvas'}</button>
          ${hasStamp && stampSize ? `<span class="param-label" style="font-size:10px;opacity:0.6;margin-top:4px">${stampSize.w}×${stampSize.h}px captured — drag to paint</span>` : '<span class="param-label" style="font-size:10px;opacity:0.6;margin-top:4px">Draw a rectangle on the canvas to pick up pixels</span>'}
        </div>
        <div class="param-group">
          <span class="param-label">Presets</span>
          <div class="pickup-preset-grid">
            ${presetBtn('Bristles', 'bristles')}
            ${presetBtn('Smear', 'smear')}
            ${presetBtn('Solid', 'solid')}
            ${presetBtn('Wisp', 'wisp')}
            ${presetBtn('Chaos', 'chaos')}
            ${presetBtn('Liquid', 'liquid')}
          </div>
        </div>
        <div class="param-section-divider">FIBERS</div>
        ${sliderRow('Density', 'tool-opt-pickup-density', 0, 100, s.pickupFiberDensity, 'sparse → packed')}
        ${sliderRow('Length',  'tool-opt-pickup-length',  0, 100, s.pickupFiberLength,  'short → long')}
        ${sliderRow('Flow',    'tool-opt-pickup-flow',    0, 100, s.pickupFiberFlow,    'broken → solid')}
        ${sliderRow('Wander',  'tool-opt-pickup-wander',  0, 100, s.pickupFiberWander,  'straight → curl')}
        ${sliderRow('Variety', 'tool-opt-pickup-variety', 0, 100, s.pickupColorVariety, 'uniform → mixed')}
        ${sliderRow('Taper',   'tool-opt-pickup-taper',   0, 100, s.pickupFiberTaper,   'flat → tapered')}
        <div class="param-section-divider">GRAIN</div>
        ${sliderRow('Jitter',    'tool-opt-pickup-jitter',    0, 100, s.pickupJitter)}
        ${sliderRow('Scatter',   'tool-opt-pickup-scatter',   0, 50,  s.pickupScatter)}
        ${sliderRow('Coherence', 'tool-opt-pickup-coherence', 0, 100, s.pickupCoherence)}
      `;
      $('btn-pickup-select').addEventListener('click', () => enterPickupMarquee());

      // Slider wiring
      const wire = (id, setter) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', () => {
          const v = parseInt(el.value);
          setter(v);
          const disp = el.parentElement.querySelector('.param-value');
          if (disp) disp.textContent = v;
        });
      };
      wire('tool-opt-pickup-density', v => PaintEngine.setPickupFiberDensity(v));
      wire('tool-opt-pickup-length',  v => PaintEngine.setPickupFiberLength(v));
      wire('tool-opt-pickup-flow',    v => PaintEngine.setPickupFiberFlow(v));
      wire('tool-opt-pickup-wander',  v => PaintEngine.setPickupFiberWander(v));
      wire('tool-opt-pickup-variety', v => PaintEngine.setPickupColorVariety(v));
      wire('tool-opt-pickup-taper',   v => PaintEngine.setPickupFiberTaper(v));
      wire('tool-opt-pickup-jitter',  v => PaintEngine.setPickupJitter(v));
      wire('tool-opt-pickup-scatter', v => PaintEngine.setPickupScatter(v));
      wire('tool-opt-pickup-coherence', v => PaintEngine.setPickupCoherence(v));

      // Preset application
      const presets = {
        bristles: { density: 25, length: 60, flow: 30, wander: 35, variety: 70, taper: 40, jitter: 40, scatter: 5, coherence: 30 },
        smear:    { density: 80, length: 75, flow: 70, wander: 15, variety: 30, taper: 20, jitter: 20, scatter: 0, coherence: 80 },
        solid:    { density: 95, length: 90, flow: 100, wander: 5, variety: 0, taper: 60, jitter: 0, scatter: 0, coherence: 100 },
        wisp:     { density: 15, length: 85, flow: 15, wander: 25, variety: 80, taper: 80, jitter: 50, scatter: 8, coherence: 40 },
        chaos:    { density: 50, length: 50, flow: 35, wander: 90, variety: 100, taper: 10, jitter: 80, scatter: 30, coherence: 10 },
        liquid:   { density: 70, length: 70, flow: 55, wander: 50, variety: 60, taper: 35, jitter: 30, scatter: 12, coherence: 60 }
      };
      const applyPreset = (key) => {
        const p = presets[key];
        if (!p) return;
        PaintEngine.setPickupFiberDensity(p.density);
        PaintEngine.setPickupFiberLength(p.length);
        PaintEngine.setPickupFiberFlow(p.flow);
        PaintEngine.setPickupFiberWander(p.wander);
        PaintEngine.setPickupColorVariety(p.variety);
        PaintEngine.setPickupFiberTaper(p.taper);
        PaintEngine.setPickupJitter(p.jitter);
        PaintEngine.setPickupScatter(p.scatter);
        PaintEngine.setPickupCoherence(p.coherence);
        // Sync slider visuals
        const setSlider = (id, val) => {
          const el = $(id);
          if (!el) return;
          el.value = val;
          const disp = el.parentElement.querySelector('.param-value');
          if (disp) disp.textContent = val;
        };
        setSlider('tool-opt-pickup-density', p.density);
        setSlider('tool-opt-pickup-length',  p.length);
        setSlider('tool-opt-pickup-flow',    p.flow);
        setSlider('tool-opt-pickup-wander',  p.wander);
        setSlider('tool-opt-pickup-variety', p.variety);
        setSlider('tool-opt-pickup-taper',   p.taper);
        setSlider('tool-opt-pickup-jitter',  p.jitter);
        setSlider('tool-opt-pickup-scatter', p.scatter);
        setSlider('tool-opt-pickup-coherence', p.coherence);
      };
      container.querySelectorAll('.pickup-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
      });
      return;
    }

    if (typeof opts === 'string') return;
    for (const opt of opts) {
      const step = opt.step || 1;
      const dispVal = step < 1 ? parseFloat(opt.value).toFixed(1) : opt.value;
      container.innerHTML += `
        <div class="param-group">
          <span class="param-label">${opt.label}</span>
          <div class="slider-row">
            <input type="range" id="tool-opt-${opt.id}" min="${opt.min}" max="${opt.max}" step="${step}" value="${opt.value}">
            <span class="param-value">${dispVal}</span>
          </div>
        </div>
      `;
    }

    // Wire events after HTML is set
    for (const opt of opts) {
      const el = $('tool-opt-' + opt.id);
      if (el) {
        el.addEventListener('input', () => {
          const v = parseFloat(el.value);
          opt.setter(v);
          const disp = el.parentElement.querySelector('.param-value');
          const step = opt.step || 1;
          if (disp) disp.textContent = step < 1 ? v.toFixed(1) : v;
        });
      }
    }
  }

  buildToolOptions('smudge');

  // Brush library
  function buildBrushLibrary() {
    const container = $('brush-library');
    container.innerHTML = '';
    const brushes = PaintEngine.getBrushes();
    for (const brush of brushes) {
      const thumb = document.createElement('div');
      thumb.className = 'brush-thumb' + (brush.selected ? ' selected' : '');
      thumb.title = brush.name;
      const dataUrl = PaintEngine.getBrushThumbnail(brush.index, 40);
      if (dataUrl) thumb.style.backgroundImage = `url(${dataUrl})`;
      thumb.addEventListener('click', () => {
        PaintEngine.selectBrush(brush.index);
        PaintEngine.invalidateCursorCache();
        container.querySelectorAll('.brush-thumb').forEach(t => t.classList.remove('selected'));
        thumb.classList.add('selected');
        updateBrushPreview();
      });
      container.appendChild(thumb);
    }
  }

  function updateBrushPreview() {
    const previewCanvas = $('brush-preview');
    if (!previewCanvas) return;
    const idx = PaintEngine.getSelectedBrush();
    const dataUrl = PaintEngine.getBrushThumbnail(idx, 48);
    if (dataUrl) {
      const img = new Image();
      img.onload = () => {
        const pctx = previewCanvas.getContext('2d');
        pctx.clearRect(0, 0, 48, 48);
        pctx.drawImage(img, 0, 0);
      };
      img.src = dataUrl;
    }
  }

  buildBrushLibrary();
  updateBrushPreview();

  // Canvas brush maker — marquee selection mode
  let marqueeStartX = 0, marqueeStartY = 0;
  let marqueeActive = false;
  const brushMarquee = $('brush-marquee');
  const brushMakerModal = $('brush-maker-modal');
  const brushMakerCanvas = $('brush-maker-canvas');
  const brushMakerCtx = brushMakerCanvas.getContext('2d');
  let _brushMakerSourceData = null;
  let _brushMakerName = 'Canvas Brush';

  $('btn-make-brush').addEventListener('click', () => {
    if (!DitherEngine.getSourceSize()) return;
    brushSelectionMode = true;
    canvasWrapper.style.cursor = 'crosshair';
    if (brushCursor) brushCursor.style.display = 'none';
  });

  // Override mousedown to intercept marquee selection (brush maker OR pickup)
  canvasWrapper.addEventListener('mousedown', e => {
    if ((brushSelectionMode || pickupSelectionMode) && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      marqueeActive = true;
      marqueeStartX = e.clientX;
      marqueeStartY = e.clientY;
      brushMarquee.style.display = 'block';
      brushMarquee.style.left = e.clientX + 'px';
      brushMarquee.style.top = e.clientY + 'px';
      brushMarquee.style.width = '0px';
      brushMarquee.style.height = '0px';
    }
  }, true); // capture phase to intercept before paint/pan handler

  document.addEventListener('mousemove', e => {
    if (marqueeActive) {
      const x = Math.min(marqueeStartX, e.clientX);
      const y = Math.min(marqueeStartY, e.clientY);
      const w = Math.abs(e.clientX - marqueeStartX);
      const h = Math.abs(e.clientY - marqueeStartY);
      brushMarquee.style.left = x + 'px';
      brushMarquee.style.top = y + 'px';
      brushMarquee.style.width = w + 'px';
      brushMarquee.style.height = h + 'px';
    }
  });

  document.addEventListener('mouseup', e => {
    if (marqueeActive) {
      marqueeActive = false;
      brushMarquee.style.display = 'none';
      const wasPickup = pickupSelectionMode;
      brushSelectionMode = false;
      pickupSelectionMode = false;
      canvasWrapper.style.cursor = activeTab === 'paintstroke' ? 'none' : '';
      if (activeTab === 'paintstroke' && brushCursor) brushCursor.style.display = 'block';

      // Compute the selected rectangle in canvas pixel space
      const x1 = Math.min(marqueeStartX, e.clientX);
      const y1 = Math.min(marqueeStartY, e.clientY);
      const x2 = Math.max(marqueeStartX, e.clientX);
      const y2 = Math.max(marqueeStartY, e.clientY);

      // Need at least a 4px drag
      if (x2 - x1 < 4 || y2 - y1 < 4) return;

      // Convert screen coords to canvas pixel coords
      const ptTL = canvasToImage(x1, y1);
      const ptBR = canvasToImage(x2, y2);
      const cx = Math.max(0, Math.floor(ptTL.x));
      const cy = Math.max(0, Math.floor(ptTL.y));
      const cw = Math.min(canvas.width - cx, Math.ceil(ptBR.x) - cx);
      const ch = Math.min(canvas.height - cy, Math.ceil(ptBR.y) - cy);

      if (cw < 2 || ch < 2) return;

      // Pickup tool: capture raw pixels as stamp
      if (wasPickup) {
        PaintEngine.capturePickupStamp(cx, cy, cw, ch);
        // Update tool options to show stamp info
        buildToolOptions('pickup');
        return;
      }

      // Brush maker: capture for threshold processing
      _brushMakerSourceData = ctx.getImageData(cx, cy, cw, ch);
      _brushMakerName = 'Canvas Brush ' + (PaintEngine.getBrushes().length + 1);

      // Reset controls
      $('brush-maker-threshold').value = 128;
      $('brush-maker-softness').value = 20;
      const featherEl = $('brush-maker-feather');
      if (featherEl) featherEl.value = 0;
      $('brush-maker-invert').checked = false;

      // Show modal after a tick so the browser's click event (which fires
      // after mouseup) doesn't land on the modal's buttons and close it
      requestAnimationFrame(() => {
        brushMakerModal.style.display = '';
        renderBrushMakerPreview();
      });
    }
  });

  function getBrushMakerParams() {
    const th = parseInt($('brush-maker-threshold').value);
    const sf = parseInt($('brush-maker-softness').value);
    const inv = $('brush-maker-invert').checked;
    const featherEl = $('brush-maker-feather');
    const fe = featherEl ? parseInt(featherEl.value) : 0;
    return { th, sf, inv, fe };
  }

  function renderBrushMakerPreview() {
    if (!_brushMakerSourceData) return;
    const { th, sf, inv, fe } = getBrushMakerParams();
    $('brush-maker-threshold-val').textContent = th;
    $('brush-maker-softness-val').textContent = sf;
    const featherValEl = $('brush-maker-feather-val');
    if (featherValEl) featherValEl.textContent = fe;

    const result = PaintEngine.extractBrushFromImage(_brushMakerSourceData, th, sf, inv, fe);
    const sz = brushMakerCanvas.width;  // now 220
    const srcSz = result.size;
    const srcW = _brushMakerSourceData.width;
    const srcH = _brushMakerSourceData.height;
    const srcD = _brushMakerSourceData.data;
    const scale = srcSz / sz;

    // Draw checkerboard
    const chk = 10;
    brushMakerCtx.clearRect(0, 0, sz, sz);
    for (let cy2 = 0; cy2 < sz; cy2 += chk) {
      for (let cx2 = 0; cx2 < sz; cx2 += chk) {
        const dark = ((cx2 / chk + cy2 / chk) % 2 === 0);
        brushMakerCtx.fillStyle = dark ? '#999' : '#ccc';
        brushMakerCtx.fillRect(cx2, cy2, chk, chk);
      }
    }

    const img = brushMakerCtx.createImageData(sz, sz);
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const sx = Math.min(Math.round(x * scale), srcSz - 1);
        const sy = Math.min(Math.round(y * scale), srcSz - 1);
        const alpha = result.mask[sy * srcSz + sx];
        const sxClamped = Math.min(sx, srcW - 1);
        const syClamped = Math.min(sy, srcH - 1);
        const si = (syClamped * srcW + sxClamped) * 4;
        const idx = (y * sz + x) * 4;
        img.data[idx]     = srcD[si];
        img.data[idx + 1] = srcD[si + 1];
        img.data[idx + 2] = srcD[si + 2];
        img.data[idx + 3] = Math.round(alpha * 255);
      }
    }
    const tmpCvs = document.createElement('canvas');
    tmpCvs.width = sz; tmpCvs.height = sz;
    const tmpCtx = tmpCvs.getContext('2d');
    tmpCtx.putImageData(img, 0, 0);
    brushMakerCtx.drawImage(tmpCvs, 0, 0);

    // Render side test pads (simulates strokes using the brush as alpha mask)
    renderBrushTestPads(result.mask, result.size);
  }

  // Render two test canvases: one with white "ink" on dark, one with dark on light.
  // Strokes are drawn using the mask as a soft alpha stamp at varying sizes/spacings.
  function renderBrushTestPads(mask, maskSize) {
    renderBrushTest('brush-test-dark',  mask, maskSize, '#0a0a0d', '#f4f4f6');
    renderBrushTest('brush-test-light', mask, maskSize, '#f4f4f6', '#0a0a0d');
  }
  function renderBrushTest(canvasId, mask, maskSize, bg, ink) {
    const c = document.getElementById(canvasId);
    if (!c) return;
    const tctx = c.getContext('2d');
    const w = c.width, h = c.height;
    // Background fill
    tctx.fillStyle = bg;
    tctx.fillRect(0, 0, w, h);
    // Build a small RGBA stamp from the mask once (small render size for speed)
    const stampSizes = [22, 30, 40];
    const stamps = stampSizes.map(sz => makeMaskStamp(mask, maskSize, sz, ink));

    // Three test strokes: straight, wavy, dab cluster
    drawStrokeWithStamp(tctx, stamps[1], 12, 30, w - 12, 30, 0.45);
    // Wavy
    let prev = null;
    for (let x = 12; x < w - 12; x += 4) {
      const y = 70 + Math.sin(x * 0.08) * 12;
      if (prev) drawStrokeWithStamp(tctx, stamps[0], prev.x, prev.y, x, y, 0.5);
      prev = { x, y };
    }
    // Dabs of varying size at the bottom
    for (let i = 0; i < 5; i++) {
      const stamp = stamps[i % stamps.length];
      const x = 24 + i * (w - 48) / 4;
      stampAt(tctx, stamp, x, 100, 1);
    }
  }
  function makeMaskStamp(mask, maskSize, outSize, inkCss) {
    const c = document.createElement('canvas');
    c.width = outSize; c.height = outSize;
    const ictx = c.getContext('2d');
    const img = ictx.createImageData(outSize, outSize);
    const scale = maskSize / outSize;
    // Parse ink color
    const tmp = document.createElement('canvas').getContext('2d');
    tmp.fillStyle = inkCss; tmp.fillRect(0,0,1,1);
    const px = tmp.getImageData(0,0,1,1).data;
    const r = px[0], g = px[1], b = px[2];
    for (let y = 0; y < outSize; y++) {
      for (let x = 0; x < outSize; x++) {
        const sx = Math.min(maskSize - 1, Math.floor(x * scale));
        const sy = Math.min(maskSize - 1, Math.floor(y * scale));
        const a = mask[sy * maskSize + sx];
        const i = (y * outSize + x) * 4;
        img.data[i] = r; img.data[i+1] = g; img.data[i+2] = b;
        img.data[i+3] = Math.round(a * 255);
      }
    }
    ictx.putImageData(img, 0, 0);
    return c;
  }
  function stampAt(tctx, stamp, x, y, alpha) {
    tctx.globalAlpha = alpha;
    tctx.drawImage(stamp, x - stamp.width / 2, y - stamp.height / 2);
    tctx.globalAlpha = 1;
  }
  function drawStrokeWithStamp(tctx, stamp, x0, y0, x1, y1, alpha) {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const step = Math.max(1, stamp.width * 0.18);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampAt(tctx, stamp, x0 + dx*t, y0 + dy*t, alpha);
    }
  }

  // Live preview on slider change
  $('brush-maker-threshold').addEventListener('input', renderBrushMakerPreview);
  $('brush-maker-softness').addEventListener('input', renderBrushMakerPreview);
  const _featherSlider = $('brush-maker-feather');
  if (_featherSlider) _featherSlider.addEventListener('input', renderBrushMakerPreview);
  $('brush-maker-invert').addEventListener('change', renderBrushMakerPreview);
  const _redrawBtn = document.getElementById('brush-test-redraw');
  if (_redrawBtn) _redrawBtn.addEventListener('click', renderBrushMakerPreview);

  // Cancel
  $('brush-maker-cancel').addEventListener('click', () => {
    brushMakerModal.style.display = 'none';
    _brushMakerSourceData = null;
  });

  // Confirm — add the brush
  $('brush-maker-confirm').addEventListener('click', () => {
    if (!_brushMakerSourceData) return;
    const { th, sf, inv, fe } = getBrushMakerParams();
    const result = PaintEngine.extractBrushFromImage(_brushMakerSourceData, th, sf, inv, fe);
    PaintEngine.addBrush(_brushMakerName, result.mask, result.size);
    PaintEngine.selectBrush(PaintEngine.getBrushes().length - 1);
    PaintEngine.invalidateCursorCache();
    buildBrushLibrary();
    updateBrushPreview();
    brushMakerModal.style.display = 'none';
    _brushMakerSourceData = null;
  });

  // Brush angle + follow direction
  const brushAngleSlider = $('brush-angle');
  if (brushAngleSlider) {
    brushAngleSlider.addEventListener('input', () => {
      const v = parseInt(brushAngleSlider.value);
      brushAngleSlider.nextElementSibling.textContent = v;
      PaintEngine.setBrushAngle(v);
    });
  }
  const followDirCheck = $('brush-follow-dir');
  if (followDirCheck) {
    followDirCheck.addEventListener('change', () => {
      PaintEngine.setFollowDirection(followDirCheck.checked);
    });
  }

  // Clear strokes
  $('btn-clear-strokes').addEventListener('click', () => {
    PaintEngine.clearStrokes();
    updateStrokeCount();
    runProcess(); // Re-render base image
  });

  // ─────────────────────────────────────────────────────────────────
  //  Custom-brush modals
  // ─────────────────────────────────────────────────────────────────
  //
  //  openBrushPicker(currentSpec, onChoose)
  //    Full-screen overlay with four tabs:
  //      1. Built-in  — grid of PaintEngine library brushes.
  //      2. Library   — drawn + sampled entries from this session.
  //      3. Draw      — paint a brush shape freehand on a 256×256 pad.
  //      4. Sample    — circle-select a region of the source image.
  //    Calls onChoose({source, builtin, brushId}) with only the
  //    source-selection fields — the caller preserves its own
  //    sizeMul/angleJitter/opacity modifiers.
  //
  //  The draw & sample tabs build an alpha mask (Uint8Array, 96×96)
  //  and push it into state.customBrushLibrary via saveCustomBrushToLibrary.
  //  Once saved, the newly-created library entry is auto-selected so
  //  the user doesn't have to click again to pick it.

  // Shared modal-overlay scaffold. Returns { overlay, body, close }.
  function _openModalScaffold(title, className) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay cb-modal-overlay ' + (className || '');
    const modal = document.createElement('div');
    modal.className = 'modal cb-modal';
    modal.innerHTML = `
      <div class="modal-header">
        <h2>${title}</h2>
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body"></div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const body = modal.querySelector('.modal-body');
    const closeBtn = modal.querySelector('.modal-close');
    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    closeBtn.addEventListener('click', close);
    // Click outside modal panel closes.
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    // Esc closes.
    const escHandler = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
    return { overlay, modal, body, close };
  }

  function openBrushPicker(currentSpec, onChoose) {
    const { body, close } = _openModalScaffold('Choose Brush', 'cb-modal-picker');

    // Tab state (kept local to this modal instance).
    let activeTab = currentSpec && (currentSpec.source === 'drawn' || currentSpec.source === 'sampled')
      ? 'library' : 'builtin';

    function chooseAndClose(spec) {
      try { onChoose(spec); } finally { close(); }
    }

    function renderBuiltinGrid() {
      const count = (typeof PaintEngine !== 'undefined' && PaintEngine.getBrushMaskCount)
        ? PaintEngine.getBrushMaskCount() : 0;
      const names = (typeof PaintEngine !== 'undefined' && PaintEngine.getBrushNames)
        ? PaintEngine.getBrushNames() : [];
      let grid = '<div class="cb-picker-grid">';
      for (let i = 0; i < count; i++) {
        const url = PaintEngine.getBrushThumbnail ? PaintEngine.getBrushThumbnail(i, 64) : '';
        const sel = (currentSpec && currentSpec.source === 'builtin' && parseInt(currentSpec.builtin, 10) === i) ? 'selected' : '';
        grid += `
          <button class="cb-picker-cell ${sel}" data-pick-builtin="${i}" title="${names[i] || ('Brush ' + i)}">
            ${url ? `<img src="${url}" alt="">` : ''}
            <span class="cb-picker-name">${names[i] || ('#' + i)}</span>
          </button>
        `;
      }
      grid += '</div>';
      if (count === 0) grid = '<p class="cb-picker-empty">Built-in brushes not initialized yet.</p>';
      return grid;
    }

    function renderLibraryGrid() {
      const entries = Object.values(state.customBrushLibrary)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (entries.length === 0) {
        return `<p class="cb-picker-empty">
          No custom brushes yet. Use the <b>Draw</b> or <b>Sample</b> tab to create one.
        </p>`;
      }
      let grid = '<div class="cb-picker-grid">';
      for (const e of entries) {
        const sel = (currentSpec && currentSpec.brushId === e.id) ? 'selected' : '';
        const badge = e.origin === 'drawn' ? '✎' : '◉';
        grid += `
          <div class="cb-picker-libcell ${sel}" data-pick-lib="${e.id}" data-origin="${e.origin}">
            <button class="cb-picker-cell cb-picker-libthumb" data-pick-lib-btn="${e.id}" title="${e.name}">
              <img src="${e.thumbDataURL}" alt="">
              <span class="cb-picker-badge">${badge}</span>
            </button>
            <div class="cb-picker-libname">${e.name}</div>
            <button class="cb-picker-libdel" data-pick-libdel="${e.id}" title="Delete">×</button>
          </div>
        `;
      }
      grid += '</div>';
      return grid;
    }

    function renderContent() {
      let html = `
        <div class="cb-picker-tabs">
          <button class="cb-picker-tab ${activeTab==='builtin'?'active':''}" data-tab="builtin">Built-in</button>
          <button class="cb-picker-tab ${activeTab==='library'?'active':''}" data-tab="library">Library</button>
          <button class="cb-picker-tab ${activeTab==='draw'?'active':''}" data-tab="draw">✎ Draw</button>
          <button class="cb-picker-tab ${activeTab==='sample'?'active':''}" data-tab="sample">◉ Sample</button>
        </div>
        <div class="cb-picker-body">
      `;
      if (activeTab === 'builtin') html += renderBuiltinGrid();
      else if (activeTab === 'library') html += renderLibraryGrid();
      else if (activeTab === 'draw') html += `<div class="cb-picker-draw-slot"></div>`;
      else if (activeTab === 'sample') html += `<div class="cb-picker-sample-slot"></div>`;
      html += '</div>';
      body.innerHTML = html;

      // Tab switching.
      body.querySelectorAll('.cb-picker-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          activeTab = btn.dataset.tab;
          renderContent();
        });
      });

      if (activeTab === 'builtin') {
        body.querySelectorAll('[data-pick-builtin]').forEach(cell => {
          cell.addEventListener('click', () => {
            chooseAndClose({ source: 'builtin', builtin: cell.dataset.pickBuiltin, brushId: '' });
          });
        });
      } else if (activeTab === 'library') {
        body.querySelectorAll('[data-pick-lib-btn]').forEach(cell => {
          cell.addEventListener('click', e => {
            const id = cell.dataset.pickLibBtn;
            const entry = state.customBrushLibrary[id];
            if (!entry) return;
            chooseAndClose({ source: entry.origin, builtin: '', brushId: id });
          });
        });
        body.querySelectorAll('[data-pick-libdel]').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.dataset.pickLibdel;
            if (!confirm('Delete this brush? It will also be removed from any slot currently using it.')) return;
            deleteCustomBrushFromLibrary(id);
            renderContent();  // re-render grid
            scheduleProcess();
          });
        });
      } else if (activeTab === 'draw') {
        renderDrawPane(body.querySelector('.cb-picker-draw-slot'), (mask, w, name) => {
          const id = saveCustomBrushToLibrary({ origin: 'drawn', name: name || 'Drawn', mask, w });
          chooseAndClose({ source: 'drawn', builtin: '', brushId: id });
        });
      } else if (activeTab === 'sample') {
        renderSamplePane(body.querySelector('.cb-picker-sample-slot'), (mask, w, name) => {
          const id = saveCustomBrushToLibrary({ origin: 'sampled', name: name || 'Sampled', mask, w });
          chooseAndClose({ source: 'sampled', builtin: '', brushId: id });
        });
      }
    }

    renderContent();
  }

  // ───── Draw pane ─────
  // Renders into the provided container. onCommit(mask, size, name) fires
  // when the user clicks "Add to Library". The drawing canvas is an alpha
  // accumulator: strokes layer into a Float32 buffer so overlap deepens
  // opacity smoothly. On commit we trim, normalize, and downsample the
  // buffer to a 96×96 mask.
  function renderDrawPane(container, onCommit) {
    const DRAW_SIZE = 256;   // editing resolution
    const OUT_SIZE  = 96;    // stored resolution
    container.innerHTML = `
      <div class="cb-draw-top">
        <div class="cb-draw-stage">
          <canvas class="cb-draw-canvas" width="${DRAW_SIZE}" height="${DRAW_SIZE}"></canvas>
        </div>
        <div class="cb-draw-controls">
          <label class="cb-mini">
            <span>Brush radius</span>
            <input type="range" class="cb-draw-radius" min="2" max="40" step="1" value="12">
            <span class="cb-mini-val" data-val="radius">12</span>
          </label>
          <label class="cb-mini">
            <span>Hardness</span>
            <input type="range" class="cb-draw-hardness" min="0" max="1" step="0.05" value="0.3">
            <span class="cb-mini-val" data-val="hardness">0.30</span>
          </label>
          <label class="cb-mini">
            <span>Flow</span>
            <input type="range" class="cb-draw-flow" min="0.05" max="1" step="0.05" value="0.4">
            <span class="cb-mini-val" data-val="flow">0.40</span>
          </label>
          <label class="cb-mini cb-draw-vel">
            <input type="checkbox" class="cb-draw-velocity" checked>
            <span>Velocity → opacity (fast = lighter)</span>
          </label>
          <label class="cb-mini cb-draw-erase-wrap">
            <input type="checkbox" class="cb-draw-erase">
            <span>Erase mode</span>
          </label>
          <label class="cb-mini">
            <span>Name</span>
            <input type="text" class="cb-draw-name" value="Drawn" maxlength="24">
          </label>
          <div class="cb-draw-actions">
            <button class="btn-secondary cb-draw-clear" type="button">Clear</button>
            <button class="btn-primary cb-draw-save" type="button">Add to Library</button>
          </div>
          <p class="cb-hint">Tip: draw near the center. Edges get trimmed and everything gets scaled to a ${OUT_SIZE}×${OUT_SIZE} stamp.</p>
        </div>
      </div>
      <div class="cb-draw-preview-row">
        <span class="cb-draw-preview-label">Preview stamp:</span>
        <canvas class="cb-draw-preview" width="${OUT_SIZE}" height="${OUT_SIZE}"></canvas>
      </div>
    `;

    const canvas = container.querySelector('.cb-draw-canvas');
    const ctx2 = canvas.getContext('2d');
    // Alpha accumulator — we paint into this and re-blit to the visible
    // canvas each stroke. Float so repeated overlap stacks smoothly.
    const accum = new Float32Array(DRAW_SIZE * DRAW_SIZE);

    let drawing = false;
    let lastX = 0, lastY = 0, lastT = 0;

    function drawBlob(x, y, radius, opacity, erase) {
      const r = radius | 0;
      const x0 = Math.max(0, (x - r) | 0), y0 = Math.max(0, (y - r) | 0);
      const x1 = Math.min(DRAW_SIZE, (x + r + 1) | 0), y1 = Math.min(DRAW_SIZE, (y + r + 1) | 0);
      const rSq = r * r;
      const hardness = parseFloat(container.querySelector('.cb-draw-hardness').value);
      const core = hardness;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const dx = xx - x, dy = yy - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > rSq) continue;
          const d = Math.sqrt(d2) / r; // 0..1
          // Radial falloff with hardness plateau.
          let f;
          if (d < core) f = 1;
          else f = 1 - (d - core) / (1 - core);
          if (f <= 0) continue;
          const add = f * opacity;
          const i = yy * DRAW_SIZE + xx;
          if (erase) accum[i] = Math.max(0, accum[i] - add);
          else       accum[i] = Math.min(1, accum[i] + add);
        }
      }
    }

    function blitAccum() {
      const img = ctx2.createImageData(DRAW_SIZE, DRAW_SIZE);
      for (let i = 0; i < DRAW_SIZE * DRAW_SIZE; i++) {
        const a = Math.round(accum[i] * 255);
        const j = i * 4;
        img.data[j]   = 255;
        img.data[j+1] = 255;
        img.data[j+2] = 255;
        img.data[j+3] = a;
      }
      ctx2.clearRect(0, 0, DRAW_SIZE, DRAW_SIZE);
      // Checkerboard background for alpha legibility.
      const bg = ctx2.createImageData(DRAW_SIZE, DRAW_SIZE);
      for (let y = 0; y < DRAW_SIZE; y++) for (let x = 0; x < DRAW_SIZE; x++) {
        const v = ((x >> 3) + (y >> 3)) & 1 ? 32 : 22;
        const j = (y * DRAW_SIZE + x) * 4;
        bg.data[j] = v; bg.data[j+1] = v; bg.data[j+2] = v; bg.data[j+3] = 255;
      }
      ctx2.putImageData(bg, 0, 0);
      // Now paint the accum on top.
      const tmp = document.createElement('canvas');
      tmp.width = DRAW_SIZE; tmp.height = DRAW_SIZE;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx2.drawImage(tmp, 0, 0);
      updatePreview();
    }

    function pointerPos(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (DRAW_SIZE / rect.width),
        y: (e.clientY - rect.top)  * (DRAW_SIZE / rect.height)
      };
    }

    function handleDown(e) {
      drawing = true;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      const p = pointerPos(e);
      lastX = p.x; lastY = p.y; lastT = performance.now();
      const r = parseFloat(container.querySelector('.cb-draw-radius').value);
      const flow = parseFloat(container.querySelector('.cb-draw-flow').value);
      const erase = container.querySelector('.cb-draw-erase').checked;
      drawBlob(p.x, p.y, r, flow, erase);
      blitAccum();
      e.preventDefault();
    }
    function handleMove(e) {
      if (!drawing) return;
      const p = pointerPos(e);
      const now = performance.now();
      const dx = p.x - lastX, dy = p.y - lastY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const dt = Math.max(1, now - lastT);
      const speed = dist / dt; // px per ms
      const velEnabled = container.querySelector('.cb-draw-velocity').checked;
      // At speed=0.3 px/ms (slow), opacityMul ~= 1. At speed=3 (fast), ~= 0.3.
      const velMul = velEnabled ? Math.max(0.2, 1 / (1 + speed * 1.5)) : 1;
      const r = parseFloat(container.querySelector('.cb-draw-radius').value);
      const flow = parseFloat(container.querySelector('.cb-draw-flow').value) * velMul;
      const erase = container.querySelector('.cb-draw-erase').checked;
      // Interpolate blobs along the stroke — step ~= radius*0.25 keeps it smooth.
      const step = Math.max(1, r * 0.25);
      const steps = Math.max(1, Math.ceil(dist / step));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        drawBlob(lastX + dx * t, lastY + dy * t, r, flow, erase);
      }
      lastX = p.x; lastY = p.y; lastT = now;
      blitAccum();
      e.preventDefault();
    }
    function handleUp(e) {
      drawing = false;
      try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId); } catch(_) {}
    }
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', handleDown);
    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('pointerup', handleUp);
    canvas.addEventListener('pointercancel', handleUp);
    canvas.addEventListener('pointerleave', handleUp);

    // Slider live-value readouts
    container.querySelectorAll('.cb-draw-controls input[type="range"]').forEach(inp => {
      inp.addEventListener('input', e => {
        const mv = e.target.closest('.cb-mini').querySelector('.cb-mini-val');
        if (mv) mv.textContent = (+e.target.value).toFixed(inp.step.includes('.') ? 2 : 0);
      });
    });

    container.querySelector('.cb-draw-clear').addEventListener('click', () => {
      for (let i = 0; i < accum.length; i++) accum[i] = 0;
      blitAccum();
    });

    // Preview: trim + scale to OUT_SIZE × OUT_SIZE, show live.
    const previewCanvas = container.querySelector('.cb-draw-preview');
    const pctx = previewCanvas.getContext('2d');
    function buildMaskFromAccum() {
      // Find bounding box of nonzero pixels
      let minX = DRAW_SIZE, minY = DRAW_SIZE, maxX = -1, maxY = -1;
      for (let y = 0; y < DRAW_SIZE; y++) for (let x = 0; x < DRAW_SIZE; x++) {
        if (accum[y * DRAW_SIZE + x] > 0.02) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      if (maxX < 0) return null;
      const w = maxX - minX + 1, h = maxY - minY + 1;
      const side = Math.max(w, h);
      // Center the bbox in a square the size of the longest side + small padding.
      const pad = Math.max(2, (side * 0.05) | 0);
      const sq = side + pad * 2;
      const ox = minX - ((sq - w) >> 1);
      const oy = minY - ((sq - h) >> 1);
      // Scale sq → OUT_SIZE nearest-neighbor. Use bilinear for smoother results.
      const mask = new Uint8Array(OUT_SIZE * OUT_SIZE);
      for (let y = 0; y < OUT_SIZE; y++) for (let x = 0; x < OUT_SIZE; x++) {
        const sx = ox + x * sq / OUT_SIZE;
        const sy = oy + y * sq / OUT_SIZE;
        const xi = Math.max(0, Math.min(DRAW_SIZE - 1, sx | 0));
        const yi = Math.max(0, Math.min(DRAW_SIZE - 1, sy | 0));
        const xf = sx - xi, yf = sy - yi;
        const i00 = yi * DRAW_SIZE + xi;
        const i10 = yi * DRAW_SIZE + Math.min(DRAW_SIZE - 1, xi + 1);
        const i01 = Math.min(DRAW_SIZE - 1, yi + 1) * DRAW_SIZE + xi;
        const i11 = Math.min(DRAW_SIZE - 1, yi + 1) * DRAW_SIZE + Math.min(DRAW_SIZE - 1, xi + 1);
        const a = accum[i00] * (1 - xf) * (1 - yf) +
                  accum[i10] * xf       * (1 - yf) +
                  accum[i01] * (1 - xf) * yf +
                  accum[i11] * xf       * yf;
        mask[y * OUT_SIZE + x] = Math.round(Math.min(1, a) * 255);
      }
      return mask;
    }
    function updatePreview() {
      const mask = buildMaskFromAccum();
      const img = pctx.createImageData(OUT_SIZE, OUT_SIZE);
      // Checkerboard bg
      for (let y = 0; y < OUT_SIZE; y++) for (let x = 0; x < OUT_SIZE; x++) {
        const v = ((x >> 2) + (y >> 2)) & 1 ? 32 : 22;
        const j = (y * OUT_SIZE + x) * 4;
        img.data[j] = v; img.data[j+1] = v; img.data[j+2] = v; img.data[j+3] = 255;
      }
      if (mask) {
        // Composite stamp over bg (white alpha over dark checker)
        for (let i = 0; i < OUT_SIZE * OUT_SIZE; i++) {
          const a = mask[i] / 255;
          const j = i * 4;
          img.data[j]   = Math.round(img.data[j]   * (1 - a) + 255 * a);
          img.data[j+1] = Math.round(img.data[j+1] * (1 - a) + 255 * a);
          img.data[j+2] = Math.round(img.data[j+2] * (1 - a) + 255 * a);
        }
      }
      pctx.putImageData(img, 0, 0);
    }

    // Initial empty paint so the checker bg shows
    blitAccum();

    container.querySelector('.cb-draw-save').addEventListener('click', () => {
      const mask = buildMaskFromAccum();
      if (!mask) { alert('Draw something first!'); return; }
      const name = (container.querySelector('.cb-draw-name').value || 'Drawn').slice(0, 24);
      onCommit(mask, OUT_SIZE, name);
    });
  }

  // ───── Sample pane ─────
  // Shows a downsampled view of the current source image. User drags a
  // circular selector; radius is a slider. On commit we read the pixels
  // from the circle, convert to a luminance mask (dark-ink or light-ink
  // mode), then scale to OUT_SIZE × OUT_SIZE. This lets users turn any
  // interesting region of a photo — a crackle, a scrape, a cloud edge —
  // into a painterly stamp without leaving the app.
  function renderSamplePane(container, onCommit) {
    const VIEW_MAX = 380;
    const OUT_SIZE = 96;
    const srcSize = DitherEngine.getSourceSize && DitherEngine.getSourceSize();
    if (!srcSize) {
      container.innerHTML = `<p class="cb-picker-empty">Load an image first to sample brushes from it.</p>`;
      return;
    }
    // Get a downsampled RGBA preview we can show + click on.
    const preview = DitherEngine.getDownsampled(VIEW_MAX);
    const viewW = preview.width, viewH = preview.height;

    container.innerHTML = `
      <div class="cb-sample-top">
        <div class="cb-sample-stage" style="width:${viewW}px;height:${viewH}px">
          <canvas class="cb-sample-canvas" width="${viewW}" height="${viewH}"></canvas>
          <canvas class="cb-sample-overlay" width="${viewW}" height="${viewH}"></canvas>
        </div>
        <div class="cb-sample-controls">
          <label class="cb-mini">
            <span>Radius</span>
            <input type="range" class="cb-sample-radius" min="8" max="${Math.min(viewW, viewH) >> 1}" step="1" value="32">
            <span class="cb-mini-val" data-val="radius">32</span>
          </label>
          <label class="cb-mini">
            <span>Invert</span>
            <input type="checkbox" class="cb-sample-invert">
            <span class="cb-mini-hint">Dark → ink</span>
          </label>
          <label class="cb-mini">
            <span>Threshold</span>
            <input type="range" class="cb-sample-threshold" min="0" max="255" step="1" value="140">
            <span class="cb-mini-val" data-val="threshold">140</span>
          </label>
          <label class="cb-mini">
            <span>Softness</span>
            <input type="range" class="cb-sample-softness" min="0" max="1" step="0.05" value="0.5">
            <span class="cb-mini-val" data-val="softness">0.50</span>
          </label>
          <label class="cb-mini">
            <span>Name</span>
            <input type="text" class="cb-sample-name" value="Sampled" maxlength="24">
          </label>
          <div class="cb-draw-actions">
            <button class="btn-primary cb-sample-save" type="button">Add to Library</button>
          </div>
          <p class="cb-hint">Drag the circle. Threshold/softness build the alpha; invert if your image is light-on-dark.</p>
        </div>
      </div>
      <div class="cb-draw-preview-row">
        <span class="cb-draw-preview-label">Preview stamp:</span>
        <canvas class="cb-sample-preview" width="${OUT_SIZE}" height="${OUT_SIZE}"></canvas>
      </div>
    `;

    const canvas = container.querySelector('.cb-sample-canvas');
    const overlay = container.querySelector('.cb-sample-overlay');
    canvas.getContext('2d').putImageData(preview, 0, 0);
    const octx = overlay.getContext('2d');

    let cx = viewW / 2, cy = viewH / 2;
    let dragging = false;

    function drawOverlay() {
      const r = parseInt(container.querySelector('.cb-sample-radius').value, 10);
      octx.clearRect(0, 0, viewW, viewH);
      // Dim outside the circle
      octx.fillStyle = 'rgba(0,0,0,0.45)';
      octx.fillRect(0, 0, viewW, viewH);
      octx.save();
      octx.globalCompositeOperation = 'destination-out';
      octx.beginPath();
      octx.arc(cx, cy, r, 0, Math.PI * 2);
      octx.fill();
      octx.restore();
      // Draw circle border
      octx.strokeStyle = '#a78bfa';
      octx.lineWidth = 2;
      octx.beginPath();
      octx.arc(cx, cy, r, 0, Math.PI * 2);
      octx.stroke();
      // Crosshair
      octx.strokeStyle = 'rgba(167, 139, 250, 0.8)';
      octx.lineWidth = 1;
      octx.beginPath();
      octx.moveTo(cx - 6, cy); octx.lineTo(cx + 6, cy);
      octx.moveTo(cx, cy - 6); octx.lineTo(cx, cy + 6);
      octx.stroke();
      updatePreview();
    }

    function posFrom(e) {
      const rect = overlay.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (viewW / rect.width),
        y: (e.clientY - rect.top)  * (viewH / rect.height)
      };
    }
    overlay.style.touchAction = 'none';
    overlay.style.cursor = 'move';
    overlay.addEventListener('pointerdown', e => {
      dragging = true;
      overlay.setPointerCapture && overlay.setPointerCapture(e.pointerId);
      const p = posFrom(e);
      cx = p.x; cy = p.y;
      drawOverlay();
      e.preventDefault();
    });
    overlay.addEventListener('pointermove', e => {
      if (!dragging) return;
      const p = posFrom(e);
      cx = p.x; cy = p.y;
      drawOverlay();
      e.preventDefault();
    });
    overlay.addEventListener('pointerup', e => {
      dragging = false;
      try { overlay.releasePointerCapture && overlay.releasePointerCapture(e.pointerId); } catch(_){}
    });
    overlay.addEventListener('pointercancel', () => dragging = false);
    overlay.addEventListener('pointerleave', () => dragging = false);

    container.querySelectorAll('.cb-sample-controls input[type="range"]').forEach(inp => {
      inp.addEventListener('input', e => {
        const mv = e.target.closest('.cb-mini').querySelector('.cb-mini-val');
        if (mv) mv.textContent = (+e.target.value).toFixed(inp.step.includes('.') ? 2 : 0);
        drawOverlay();
      });
    });
    container.querySelector('.cb-sample-invert').addEventListener('change', drawOverlay);

    const previewCanvas = container.querySelector('.cb-sample-preview');
    const pctx = previewCanvas.getContext('2d');
    function buildMaskFromSample() {
      const r = parseInt(container.querySelector('.cb-sample-radius').value, 10);
      const thr = parseInt(container.querySelector('.cb-sample-threshold').value, 10);
      const soft = parseFloat(container.querySelector('.cb-sample-softness').value);
      const inv = container.querySelector('.cb-sample-invert').checked;
      // Read the circle patch from the preview image.
      const box = 2 * r;
      const bx = Math.max(0, (cx - r) | 0);
      const by = Math.max(0, (cy - r) | 0);
      const bw = Math.min(viewW - bx, box);
      const bh = Math.min(viewH - by, box);
      if (bw <= 0 || bh <= 0) return null;
      // Build mask in box-local space, then scale to OUT_SIZE.
      const local = new Uint8Array(box * box);
      const px = preview.data;
      // Soft edge at the circle boundary
      const softPx = Math.max(0.5, r * (soft * 0.5 + 0.02));
      for (let yy = 0; yy < box; yy++) {
        for (let xx = 0; xx < box; xx++) {
          const gx = bx + xx - (bx - (cx - r)); // patch coord
          // Actually, cleaner: sample at (cx - r + xx, cy - r + yy)
          const sx = (cx - r + xx) | 0;
          const sy = (cy - r + yy) | 0;
          if (sx < 0 || sx >= viewW || sy < 0 || sy >= viewH) continue;
          const dx = xx - r, dy = yy - r;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist > r) continue;
          const edgeA = Math.max(0, Math.min(1, (r - dist) / softPx));
          const j = (sy * viewW + sx) * 4;
          const lum = (px[j] * 0.2126 + px[j+1] * 0.7152 + px[j+2] * 0.0722);
          // Two-sided soft threshold: farther from threshold = more opaque.
          const lumDepth = inv ? (lum - thr) / 128 : (thr - lum) / 128;
          let a = Math.max(0, Math.min(1, 0.5 + lumDepth));
          // Soften the curve
          a = Math.pow(a, 1 / (1 + soft * 2));
          local[yy * box + xx] = Math.round(Math.min(1, a * edgeA) * 255);
        }
      }
      // Scale to OUT_SIZE with bilinear
      const mask = new Uint8Array(OUT_SIZE * OUT_SIZE);
      for (let y = 0; y < OUT_SIZE; y++) for (let x = 0; x < OUT_SIZE; x++) {
        const sx = x * box / OUT_SIZE;
        const sy = y * box / OUT_SIZE;
        const xi = Math.max(0, Math.min(box - 1, sx | 0));
        const yi = Math.max(0, Math.min(box - 1, sy | 0));
        const xf = sx - xi, yf = sy - yi;
        const i00 = yi * box + xi;
        const i10 = yi * box + Math.min(box - 1, xi + 1);
        const i01 = Math.min(box - 1, yi + 1) * box + xi;
        const i11 = Math.min(box - 1, yi + 1) * box + Math.min(box - 1, xi + 1);
        const a = local[i00] * (1 - xf) * (1 - yf) +
                  local[i10] * xf       * (1 - yf) +
                  local[i01] * (1 - xf) * yf +
                  local[i11] * xf       * yf;
        mask[y * OUT_SIZE + x] = Math.round(a);
      }
      return mask;
    }
    function updatePreview() {
      const mask = buildMaskFromSample();
      const img = pctx.createImageData(OUT_SIZE, OUT_SIZE);
      for (let y = 0; y < OUT_SIZE; y++) for (let x = 0; x < OUT_SIZE; x++) {
        const v = ((x >> 2) + (y >> 2)) & 1 ? 32 : 22;
        const j = (y * OUT_SIZE + x) * 4;
        img.data[j] = v; img.data[j+1] = v; img.data[j+2] = v; img.data[j+3] = 255;
      }
      if (mask) {
        for (let i = 0; i < OUT_SIZE * OUT_SIZE; i++) {
          const a = mask[i] / 255;
          const j = i * 4;
          img.data[j]   = Math.round(img.data[j]   * (1 - a) + 255 * a);
          img.data[j+1] = Math.round(img.data[j+1] * (1 - a) + 255 * a);
          img.data[j+2] = Math.round(img.data[j+2] * (1 - a) + 255 * a);
        }
      }
      pctx.putImageData(img, 0, 0);
    }

    drawOverlay();

    container.querySelector('.cb-sample-save').addEventListener('click', () => {
      const mask = buildMaskFromSample();
      if (!mask) { alert('Pick a region first!'); return; }
      const name = (container.querySelector('.cb-sample-name').value || 'Sampled').slice(0, 24);
      onCommit(mask, OUT_SIZE, name);
    });
  }

  // ── Init ──
  buildAlgorithmList();
  buildGrainList();
  buildPalettePresets();
  loadPalettePreset('pico8');
  updateColorModeUI();
  updateUndoButtons();

})();
