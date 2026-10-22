/**
 * ShahzaibSEO Page Inspector — Color pipette + Hover zoom + Alt+Scroll focus zoom
 */
(function () {
  'use strict';
  if (window.__rankseoPageInspector) return;
  window.__rankseoPageInspector = true;

  let hoverZoomOn = false;
  let pipetteOn = false;
  let focusZoomOn = false; // Alt held + scroll zoom
  let hoverTimer = null;
  let currentTarget = null;
  let zoomLevel = 1;
  let hostEl = null;
  let shadow = null;

  const MIN = 60;
  const DELAY = 320;

  // ── Settings ─────────────────────────────────────────────────────────────
  function loadSettings() {
    try {
      chrome.storage.sync.get(
        ['rsHoverZoom', 'rsColorPipette', 'rsFocusZoom'],
        (d) => {
          hoverZoomOn = !!d.rsHoverZoom;
          pipetteOn = !!d.rsColorPipette;
          focusZoomOn = d.rsFocusZoom !== false; // default ON for Alt+scroll
          if (pipetteOn) ensurePipetteBtn(true);
          else ensurePipetteBtn(false);
        }
      );
    } catch (e) {}
  }
  loadSettings();
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync') return;
      if (ch.rsHoverZoom) hoverZoomOn = !!ch.rsHoverZoom.newValue;
      if (ch.rsColorPipette) {
        pipetteOn = !!ch.rsColorPipette.newValue;
        ensurePipetteBtn(pipetteOn);
      }
      if (ch.rsFocusZoom) focusZoomOn = !!ch.rsFocusZoom.newValue;
    });
  } catch (e) {}

  // ── Helpers ──────────────────────────────────────────────────────────────
  function absUrl(u) {
    try { return new URL(u, location.href).href; } catch (e) { return null; }
  }
  function bgUrl(css) {
    if (!css || css === 'none') return null;
    const m = css.match(/url\(["']?([^"')]+)["']?\)/i);
    return m ? m[1] : null;
  }
  function mediaInfo(el) {
    if (!el) return null;
    if (el.tagName === 'IMG') {
      const u = el.currentSrc || el.src;
      if (u && !u.startsWith('data:image/svg')) return { url: absUrl(u), video: false };
    }
    if (el.tagName === 'VIDEO') {
      const u = el.currentSrc || el.src || el.querySelector('source')?.src;
      if (u) return { url: absUrl(u), video: true };
    }
    const bg = bgUrl(getComputedStyle(el).backgroundImage);
    if (bg) return { url: absUrl(bg), video: false };
    return null;
  }
  function eligible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('#rs-hz-host, #rs-pipette-btn, #rankseo-toolbar, #rs-labs-panel')) return false;
    const r = el.getBoundingClientRect();
    return r.width >= MIN && r.height >= MIN;
  }
  function findBg(el) {
    let n = el, d = 0;
    while (n && n !== document.body && d < 4) {
      if (bgUrl(getComputedStyle(n).backgroundImage) && eligible(n)) return n;
      n = n.parentElement; d++;
    }
    return null;
  }

  // ── Hover Zoom overlay ───────────────────────────────────────────────────
  function ensureHost() {
    if (shadow) return shadow;
    hostEl = document.createElement('div');
    hostEl.id = 'rs-hz-host';
    hostEl.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    document.documentElement.appendChild(hostEl);
    shadow = hostEl.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = `
      .box{position:fixed;inset:0;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;pointer-events:auto;font-family:system-ui,sans-serif;}
      .card{position:relative;max-width:90vw;max-height:88vh;background:#0f172a;border-radius:12px;padding:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);}
      .card img,.card video{max-width:86vw;max-height:78vh;display:block;border-radius:8px;object-fit:contain;}
      .bar{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;}
      .bar button{all:unset;cursor:pointer;background:#1e293b;color:#e2e8f0;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;}
      .bar button:hover{background:#0f766e;}
      .dims{position:absolute;top:16px;left:16px;background:rgba(0,0,0,.65);color:#fff;font-size:11px;padding:4px 8px;border-radius:6px;}
      .hint{color:#94a3b8;font-size:11px;margin-left:auto;}
    `;
    shadow.appendChild(st);
    const root = document.createElement('div');
    root.id = 'rs-hz-root';
    shadow.appendChild(root);
    return shadow;
  }

  function openZoom(el) {
    const info = mediaInfo(el);
    if (!info || !info.url) return;
    ensureHost();
    hostEl.style.pointerEvents = 'auto';
    const root = shadow.getElementById('rs-hz-root');
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'box';
    box.addEventListener('click', (e) => { if (e.target === box) closeZoom(); });
    const card = document.createElement('div');
    card.className = 'card';
    const media = document.createElement(info.video ? 'video' : 'img');
    media.src = info.url;
    if (info.video) { media.controls = true; media.autoplay = true; }
    card.appendChild(media);
    const dims = document.createElement('div');
    dims.className = 'dims';
    const showD = () => {
      const w = info.video ? media.videoWidth : media.naturalWidth;
      const h = info.video ? media.videoHeight : media.naturalHeight;
      if (w && h) dims.textContent = w + ' × ' + h + 'px';
    };
    media.addEventListener(info.video ? 'loadedmetadata' : 'load', showD);
    if (!info.video && media.complete) showD();
    card.appendChild(dims);
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = `
      <button type="button" data-a="open">Open full size</button>
      <button type="button" data-a="dl">Download</button>
      <button type="button" data-a="close">Close (Esc)</button>
      <span class="hint">Hover zoom · Esc to close</span>`;
    bar.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'close') closeZoom();
      if (a === 'open') window.open(info.url, '_blank');
      if (a === 'dl') {
        const ael = document.createElement('a');
        ael.href = info.url; ael.download = ''; ael.target = '_blank'; ael.click();
      }
    });
    card.appendChild(bar);
    box.appendChild(card);
    root.appendChild(box);
  }

  function closeZoom() {
    if (shadow) {
      const root = shadow.getElementById('rs-hz-root');
      if (root) root.innerHTML = '';
    }
    if (hostEl) hostEl.style.pointerEvents = 'none';
    currentTarget = null;
  }

  document.addEventListener('mouseover', (e) => {
    if (!hoverZoomOn) return;
    if (hostEl && hostEl.style.pointerEvents === 'auto') return;
    let el = e.target.closest('img, video');
    if (!el) el = findBg(e.target);
    if (!el || el === currentTarget || !eligible(el) || !mediaInfo(el)) return;
    currentTarget = el;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openZoom(el), DELAY);
  });
  document.addEventListener('mouseout', (e) => {
    if (!hoverZoomOn) return;
    if (currentTarget && e.relatedTarget && currentTarget.contains(e.relatedTarget)) return;
    clearTimeout(hoverTimer);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeZoom();
      clearFocusZoom();
    }
  });

  // ── Alt + Scroll focus zoom (anywhere under cursor) ─────────────────────
  let focusTarget = null;
  let focusOrig = null;

  function clearFocusZoom() {
    if (focusTarget && focusOrig) {
      focusTarget.style.transform = focusOrig.transform || '';
      focusTarget.style.transformOrigin = focusOrig.origin || '';
      focusTarget.style.transition = focusOrig.transition || '';
      focusTarget.style.zIndex = focusOrig.zIndex || '';
      focusTarget.style.position = focusOrig.position || '';
    }
    focusTarget = null;
    focusOrig = null;
    zoomLevel = 1;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') document.documentElement.dataset.rsAlt = '1';
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') {
      delete document.documentElement.dataset.rsAlt;
      // keep zoom until Esc — user asked scroll while holding key
    }
  });

  document.addEventListener('wheel', (e) => {
    if (!focusZoomOn) return;
    // Hold Alt (or Ctrl+Alt) while scrolling to zoom element under cursor
    if (!e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.closest('#rs-hz-host, #rs-pipette-btn, #rankseo-toolbar')) return;

    // Prefer image / media under cursor
    let target = el.closest('img, video, picture, canvas') || el;
    if (target !== focusTarget) {
      clearFocusZoom();
      focusTarget = target;
      focusOrig = {
        transform: target.style.transform,
        origin: target.style.transformOrigin,
        transition: target.style.transition,
        zIndex: target.style.zIndex,
        position: target.style.position
      };
      zoomLevel = 1;
    }
    const delta = e.deltaY < 0 ? 0.12 : -0.12;
    zoomLevel = Math.min(5, Math.max(0.4, zoomLevel + delta));
    const cs = getComputedStyle(target);
    if (cs.position === 'static') target.style.position = 'relative';
    target.style.zIndex = '2147483000';
    target.style.transition = 'transform 0.05s linear';
    target.style.transformOrigin = 'center center';
    target.style.transform = 'scale(' + zoomLevel.toFixed(2) + ')';
  }, { passive: false });

  // ── Color pipette ────────────────────────────────────────────────────────
  let pipetteBtn = null;
  let lastColor = '#0f766e';

  function ensurePipetteBtn(show) {
    if (!show) {
      pipetteBtn?.remove();
      pipetteBtn = null;
      return;
    }
    if (pipetteBtn) return;
    pipetteBtn = document.createElement('button');
    pipetteBtn.id = 'rs-pipette-btn';
    pipetteBtn.title = 'Pick color (pen / EyeDropper)';
    // Pen icon (replaces eyedropper)
    pipetteBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
    pipetteBtn.style.cssText = [
      'all:initial', 'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483645',
      'width:44px', 'height:44px', 'border-radius:50%', 'cursor:pointer',
      'background:#0f766e', 'color:#fff', 'display:flex', 'align-items:center', 'justify-content:center',
      'box-shadow:0 8px 24px rgba(15,118,110,.4)', 'font-family:system-ui'
    ].join(';');
    pipetteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startEyedropper();
    });
    document.documentElement.appendChild(pipetteBtn);
  }

  async function startEyedropper() {
    // Native EyeDropper API (Chrome)
    if (window.EyeDropper) {
      try {
        const ed = new EyeDropper();
        const result = await ed.open();
        if (result?.sRGBHex) {
          lastColor = result.sRGBHex;
          showColorToast(lastColor);
          try { await navigator.clipboard.writeText(lastColor); } catch (e) {}
        }
        return;
      } catch (e) {
        // user cancelled
        return;
      }
    }
    // Fallback: click-to-sample via canvas of screenshot is not available without capture;
    // use input type=color as soft fallback
    const input = document.createElement('input');
    input.type = 'color';
    input.value = lastColor;
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(input);
    input.addEventListener('input', () => {
      lastColor = input.value;
      showColorToast(lastColor);
      try { navigator.clipboard.writeText(lastColor); } catch (e) {}
    });
    input.click();
    setTimeout(() => input.remove(), 2000);
  }

  function showColorToast(hex) {
    let t = document.getElementById('rs-color-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'rs-color-toast';
      t.style.cssText = 'position:fixed;bottom:80px;right:24px;z-index:2147483647;background:#0f172a;color:#fff;padding:10px 14px;border-radius:10px;font:12px/1.4 system-ui;display:flex;align-items:center;gap:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);';
      document.documentElement.appendChild(t);
    }
    t.innerHTML = `<span style="width:22px;height:22px;border-radius:6px;background:${hex};border:2px solid #fff;display:inline-block;"></span><span><b>${hex}</b> copied</span>`;
    t.style.display = 'flex';
    clearTimeout(t._tm);
    t._tm = setTimeout(() => { t.style.display = 'none'; }, 2500);
  }

  // Message from popup
  try {
    chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
      if (msg?.action === 'RS_TOGGLE_PIPETTE') {
        pipetteOn = !!msg.enabled;
        ensurePipetteBtn(pipetteOn);
        chrome.storage.sync.set({ rsColorPipette: pipetteOn });
        sendResponse({ ok: true });
        return true;
      }
      if (msg?.action === 'RS_START_EYEDROPPER') {
        startEyedropper().then(() => sendResponse({ ok: true, color: lastColor }));
        return true;
      }
    });
  } catch (e) {}
})();
