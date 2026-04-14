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
    processing: false
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

  let lastSnapshot = null;
  function pushUndo() {
    const snap = getStateSnapshot();
    if (snap === lastSnapshot) return;
    undoStack.push(snap);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    lastSnapshot = snap;
    updateUndoButtons();
  }

  function restoreSnapshot(json) {
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
    // Sync UI
    syncUIFromState();
    updateAlgorithmUI();
    buildParamPanels();
    runProcess();
    updateUndoButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;
    const currentSnap = getStateSnapshot();
    redoStack.push(currentSnap);
    const prev = undoStack.pop();
    restoreSnapshot(prev);
  }

  function redo() {
    if (redoStack.length === 0) return;
    const currentSnap = getStateSnapshot();
    undoStack.push(currentSnap);
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
  });

  document.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      spaceHeld = false;
      if (activeTab === 'paintstroke') {
        canvasWrapper.style.cursor = 'none';
        if (brushCursor) brushCursor.style.display = '';
      }
    }
  });

  // ── Debounced processing ──
  let processTimer = null;
  function scheduleProcess(delay = 16) {
    clearTimeout(processTimer);
    processTimer = setTimeout(() => { pushUndo(); runProcess(); }, delay);
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

  function buildPipeline() {
    return state.selectedAlgorithms.map(sel => {
      const algo = DitherAlgorithms.find(a => a.id === sel.id);
      return { algorithm: algo, params: { ...sel.params } };
    });
  }

  const PREVIEW_MAX = 1200;

  function runProcess() {
    if (state.processing) return;
    const size = DitherEngine.getSourceSize();
    if (!size) return;

    state.processing = true;
    showProcessing(true);

    requestAnimationFrame(() => {
      let result = DitherEngine.process(buildPipeline(), buildGlobals(), PREVIEW_MAX);
      if (result) {
        // Apply grain layers
        if (grainLayers.length > 0) {
          result = GrainEngine.applyGrainLayers(result, buildAllGrainOpts());
        }
        canvas.width = result.width;
        canvas.height = result.height;
        ctx.putImageData(result, 0, 0);
        updateCanvasTransform();
        // Clear paint strokes since the base image changed
        if (PaintEngine.hasStrokes()) {
          PaintEngine.clearStrokes();
          updateStrokeCount();
        }
      }
      state.processing = false;
      showProcessing(false);
    });
  }

  function showProcessing(show) {
    let ov = canvasWrapper.querySelector('.processing-overlay');
    if (show && !ov) {
      ov = document.createElement('div');
      ov.className = 'processing-overlay';
      ov.innerHTML = '<div class="processing-spinner"></div>';
      canvasWrapper.appendChild(ov);
    } else if (!show && ov) ov.remove();
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
  let panStartX = 0, panStartY = 0;
  let panStartPanX = 0, panStartPanY = 0;

  function canvasToImage(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  canvasWrapper.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();

    // Paint mode: paintstroke tab active, Space not held, image loaded
    if (activeTab === 'paintstroke' && !spaceHeld && DitherEngine.getSourceSize()) {
      isPainting = true;
      const pt = canvasToImage(e.clientX, e.clientY);
      PaintEngine.beginStroke(pt.x, pt.y);
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

  document.addEventListener('mousemove', e => {
    // Update brush cursor position
    if (activeTab === 'paintstroke' && brushCursor) {
      brushCursor.style.left = e.clientX + 'px';
      brushCursor.style.top = e.clientY + 'px';
      const cursorSize = PaintEngine.getSettings().size * state.zoom;
      brushCursor.style.width = cursorSize + 'px';
      brushCursor.style.height = cursorSize + 'px';
    }

    if (isPainting) {
      const pt = canvasToImage(e.clientX, e.clientY);
      PaintEngine.continueStroke(pt.x, pt.y);
      return;
    }

    if (!isPanning) return;
    state.panX = panStartPanX + (e.clientX - panStartX);
    state.panY = panStartPanY + (e.clientY - panStartY);
    updateCanvasTransform();
  });

  document.addEventListener('mouseup', () => {
    if (isPainting) {
      isPainting = false;
      PaintEngine.endStroke();
      updateStrokeCount();
      return;
    }
    if (isPanning) {
      isPanning = false;
      canvasWrapper.classList.remove('panning');
    }
  });

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
    const categories = ['classic', 'ordered', 'halftone', 'lines', 'artistic', 'reconstructive', 'sketch', 'exotic', 'digital', 'effects'];
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

  function toggleAlgorithm(id) {
    const idx = state.selectedAlgorithms.findIndex(a => a.id === id);
    if (idx !== -1) {
      state.selectedAlgorithms.splice(idx, 1);
    } else {
      const algo = DitherAlgorithms.find(a => a.id === id);
      const params = { _mix: 0, _invert: false, _blackPoint: 0, _whitePoint: 255,
        _feather: 10, _edgeMode: 'soft', _toneResponse: 0, _advancedOpen: false };
      for (const p of algo.params) params[p.id] = p.default;
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
          // Seed gets a special UI: number input + randomize checkbox
          const isRandom = !!sel.params._seedRandom;
          html += `
            <div class="param-group seed-group">
              <span class="param-label">${p.label}</span>
              <div class="seed-row">
                <input type="number" class="seed-input" data-algo="${sel.id}" data-param="seed"
                  value="${sel.params[p.id]}" min="1" step="1" ${isRandom ? 'disabled' : ''}>
                <label class="seed-random-label" title="Use a random seed each render">
                  <input type="checkbox" class="seed-random-check" data-algo="${sel.id}" ${isRandom ? 'checked' : ''}>
                  <span>Random</span>
                </label>
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
          html += `
            <div class="param-group">
              <span class="param-label">${p.label}</span>
              <select data-algo="${sel.id}" data-param="${p.id}">${opts}</select>
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

      // Regular range slider events
      section.querySelectorAll('input[type="range"]:not(.dual-range-lo):not(.dual-range-hi)').forEach(input => {
        input.addEventListener('input', e => {
          const s = state.selectedAlgorithms.find(a => a.id === e.target.dataset.algo);
          if (s) s.params[e.target.dataset.param] = parseFloat(e.target.value);
          e.target.closest('.slider-row').querySelector('.param-value').textContent = e.target.value;
          scheduleProcess();
        });
      });

      section.querySelectorAll('input[type="checkbox"]').forEach(input => {
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

      section.querySelectorAll('.seed-random-check').forEach(chk => {
        chk.addEventListener('change', () => {
          const algoId = chk.dataset.algo;
          const s = state.selectedAlgorithms.find(a => a.id === algoId);
          const numInput = section.querySelector(`.seed-input[data-algo="${algoId}"]`);
          if (s) {
            s.params._seedRandom = chk.checked;
            if (chk.checked) {
              const rnd = Math.floor(Math.random() * 999999) + 1;
              s.params.seed = rnd;
              numInput.value = rnd;
              numInput.disabled = true;
            } else {
              numInput.disabled = false;
            }
            scheduleProcess();
          }
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
      const params = { _mix: 0, _invert: false, _blackPoint: 0, _whitePoint: 255,
        _feather: 10, _edgeMode: 'soft', _toneResponse: 0, _advancedOpen: false };
      for (const p of algo.params) params[p.id] = p.default;
      if (pAlgo.params) Object.assign(params, pAlgo.params);
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

  function randomizeAlgoParams(algoId) {
    const sel = state.selectedAlgorithms.find(a => a.id === algoId);
    if (!sel) return;
    const algo = DitherAlgorithms.find(a => a.id === algoId);
    for (const p of algo.params) {
      if (p.type === 'checkbox') {
        sel.params[p.id] = Math.random() > 0.5;
      } else if (p.type === 'select') {
        const opts = p.options;
        sel.params[p.id] = opts[randomInt(0, opts.length - 1)].value;
      } else {
        const steps = (p.max - p.min) / p.step;
        sel.params[p.id] = p.min + Math.round(Math.random() * steps) * p.step;
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
      const params = {
        _mix: Math.round(Math.random() * 20) * 0.05,
        _invert: Math.random() > 0.8,
        _blackPoint: Math.random() > 0.7 ? randomInt(0, 60) : 0,
        _whitePoint: Math.random() > 0.7 ? randomInt(200, 255) : 255,
        _feather: randomInt(0, 40),
        _edgeMode: ['soft', 'hard', 'dissolve'][randomInt(0, 2)],
        _toneResponse: Math.random() > 0.6 ? randomInt(-80, 80) : 0,
        _advancedOpen: false
      };
      for (const p of algo.params) {
        if (p.type === 'checkbox') params[p.id] = Math.random() > 0.5;
        else if (p.type === 'select') params[p.id] = p.options[randomInt(0, p.options.length - 1)].value;
        else {
          const steps = (p.max - p.min) / p.step;
          params[p.id] = Math.round((p.min + Math.round(Math.random() * steps) * p.step) * 1000) / 1000;
        }
      }
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
    $('export-quality').value = 92;
    $('export-quality-val').textContent = '92';
    $('export-artifact-intensity').value = 15;
    $('export-artifact-val').textContent = '15';
    $('export-recompress-passes').value = 1;
    $('export-recompress-val').textContent = '1';
    exportModal.classList.remove('hidden');
    renderExportPreview();
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
    const fmt = document.querySelector('input[name="export-format"]:checked').value;
    const compress = $('export-compress-toggle').checked;
    return {
      scale: exportScale,
      format: fmt,
      quality: compress ? parseInt($('export-quality').value) : 92,
      artisticMode: compress,
      artifactIntensity: compress ? parseInt($('export-artifact-intensity').value) : 15,
      recompressPasses: compress ? parseInt($('export-recompress-passes').value) : 1
    };
  }

  async function renderExportPreview() {
    const opts = getExportOpts();
    let imageData = DitherEngine.process(buildPipeline(), buildGlobals(), EXPORT_PREVIEW_MAX);
    if (!imageData) return;
    if (grainLayers.length > 0) imageData = GrainEngine.applyGrainLayers(imageData, buildAllGrainOpts());

    const tmp = document.createElement('canvas');
    tmp.width = imageData.width; tmp.height = imageData.height;
    tmp.getContext('2d').putImageData(imageData, 0, 0);

    // Estimate file size scaled up: area ratio × preview size
    const src = DitherEngine.getSourceSize();
    const scaleRatio = src ? (src.width * opts.scale * src.height * opts.scale) / (imageData.width * imageData.height) : 1;

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
    const gOpts = grainLayers.length > 0 ? buildAllGrainOpts() : null;
    const blob = await DitherEngine.exportWithOptions(buildPipeline(), buildGlobals(), opts, (msg, detail) => {
      progressText.textContent = msg;
      progressDetail.textContent = detail || '';
    }, gOpts);

    if (blob) {
      progressText.textContent = 'Downloading\u2026';
      const sizeKB = (blob.size / 1024).toFixed(0);
      progressDetail.textContent = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
      const ext = opts.format === 'jpeg' ? 'jpg' : opts.format;
      const scaleLabel = exportScale > 1 ? `_${exportScale}x` : '';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dithered${scaleLabel}.${ext}`;
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
  $('btn-bake').addEventListener('click', () => {
    pushUndo();
    let result;
    if (PaintEngine.hasStrokes()) {
      // Bake canvas pixels directly (includes paint strokes at preview resolution)
      result = DitherEngine.bakeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
    } else {
      result = DitherEngine.bake(buildPipeline(), buildGlobals(), grainLayers.length > 0 ? buildAllGrainOpts() : null);
    }
    if (result) {
      $('image-info').textContent = `${result.width} \u00d7 ${result.height} \u2014 baked`;
      // Reset dither state since edits are now baked in
      state.selectedAlgorithms = [];
      state.globals.brightness = 0;
      state.globals.contrast = 0;
      state.globals.gamma = 1.0;
      // Reset grain
      grainLayers.length = 0;
      updateGrainUI();
      buildGrainParamPanels();
      // Reset paint
      PaintEngine.clearStrokes();
      updateStrokeCount();
      syncUIFromState();
      updateAlgorithmUI();
      buildParamPanels();
      runProcess();
    }
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
      // Show/hide brush cursor
      if (brushCursor) brushCursor.style.display = tab === 'paintstroke' ? '' : 'none';
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
  document.querySelectorAll('.paint-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.paint-tool-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      PaintEngine.setTool(btn.dataset.tool);
      buildToolOptions(btn.dataset.tool);
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

  paintSlider('paint-size', v => PaintEngine.setSize(v));
  paintSlider('paint-spacing', v => PaintEngine.setSpacing(v));
  paintSlider('paint-strength', v => PaintEngine.setStrength(v));
  paintSlider('paint-opacity', v => PaintEngine.setOpacity(v));

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
      spread: [{ label: 'Amount', id: 'spread-amt', min: 1, max: 100, value: PaintEngine.getSettings().spreadAmount, setter: v => PaintEngine.setSpreadAmount(v) }]
    };

    const opts = toolOpts[tool] || [];
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

  // Brush upload
  const brushFileInput = $('brush-file-input');
  $('btn-upload-brush').addEventListener('click', () => brushFileInput.click());

  brushFileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const tctx = c.getContext('2d');
        tctx.drawImage(img, 0, 0);
        const imgData = tctx.getImageData(0, 0, img.width, img.height);
        const threshold = parseInt($('brush-threshold')?.value || 50);
        const softness = parseInt($('brush-softness')?.value || 30);
        const result = PaintEngine.extractBrushFromImage(imgData, threshold, softness);
        PaintEngine.addBrush(file.name.replace(/\.[^.]+$/, ''), result.mask, result.size);
        PaintEngine.selectBrush(PaintEngine.getBrushes().length - 1);
        buildBrushLibrary();
        updateBrushPreview();
        $('brush-upload-settings').style.display = '';
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    brushFileInput.value = '';
  });

  // Clear strokes
  $('btn-clear-strokes').addEventListener('click', () => {
    PaintEngine.clearStrokes();
    updateStrokeCount();
    runProcess(); // Re-render base image
  });

  // ── Init ──
  buildAlgorithmList();
  buildGrainList();
  buildPalettePresets();
  loadPalettePreset('pico8');
  updateColorModeUI();
  updateUndoButtons();

})();
