/**
 * ShahzaibSEO Page Tools — Images enhance, Source viewer, AdSense/Pub ID (OsaniRank-inspired)
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  /** Swallow "Frame with ID 0 was removed" / closed-tab errors */
  function ignoreLastError() {
    try { void chrome.runtime.lastError; } catch (_) {}
  }

  async function safeExecuteScript(tabId, func) {
    try {
      if (!tabId) return null;
      const results = await chrome.scripting.executeScript({ target: { tabId }, func });
      return (results && results[0] && results[0].result) != null ? results[0].result : null;
    } catch (e) {
      // Tab closed / navigated / restricted page
      return null;
    }
  }

  function safeSendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          ignoreLastError();
          resolve(res || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve((tabs && tabs[0]) || null));
    });
  }

  // ── Extractors (injected into page) ──────────────────────────────────────
  function extractAdSenseFn() {
    const html = document.documentElement.outerHTML;
    let hostname = '';
    try { hostname = location.hostname; } catch (e) {}
    const detected = new Set();
    const slots = [];
    document.querySelectorAll('script').forEach(script => {
      const combined = (script.src || '') + ' ' + (script.innerHTML || '');
      const matches = combined.matchAll(/(ca-pub-\d{16}|pub-\d{16})/gi);
      for (const m of matches) {
        let id = (m[1] || m[0] || '').toLowerCase().replace(/[^a-z0-9\-]/g, '');
        if (id) detected.add(id.startsWith('ca-') ? id : 'ca-' + id);
      }
    });
    document.querySelectorAll('ins.adsbygoogle, [data-ad-client], [data-ad-slot]').forEach(ins => {
      const client = ins.getAttribute('data-ad-client');
      const slot = ins.getAttribute('data-ad-slot');
      if (client) {
        const clean = client.toLowerCase().replace(/[^a-z0-9\-]/g, '');
        detected.add(clean.startsWith('ca-') ? clean : 'ca-' + clean);
      }
      if (slot) slots.push(slot);
    });
    (html.match(/(ca-pub-\d{16}|pub-\d{16})/gi) || []).forEach(m => {
      const clean = m.toLowerCase().replace(/[^a-z0-9\-]/g, '');
      detected.add(clean.startsWith('ca-') ? clean : 'ca-' + clean);
    });
    const ga4 = html.match(/G-[A-Z0-9]{8,12}/i);
    const ua = html.match(/UA-\d{4,10}-\d{1,4}/i);
    const gtm = html.match(/GTM-[A-Z0-9]{6,10}/i);
    return {
      publisherIds: [...detected],
      primaryPubId: [...detected][0] || null,
      adSlotsCount: slots.length,
      adSlots: slots.slice(0, 20),
      ga4Id: ga4 ? ga4[0] : null,
      uaId: ua ? ua[0] : null,
      gtmId: gtm ? gtm[0] : null,
      adsTxtUrl: hostname ? 'https://' + hostname + '/ads.txt' : null,
      pageUrl: location.href
    };
  }

  function extractSourceFn() {
    const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return null; } };
    const html = document.documentElement.outerHTML;
    const css = [];
    const js = [];
    const images = [];
    const seenImg = new Set();

    document.querySelectorAll('link[rel="stylesheet"], style').forEach(el => {
      if (el.tagName === 'LINK' && el.href) css.push({ type: 'link', href: el.href });
      else if (el.tagName === 'STYLE') css.push({ type: 'inline', content: (el.textContent || '').slice(0, 80000) });
    });
    document.querySelectorAll('script').forEach(el => {
      if (el.src) js.push({ type: 'src', href: el.src });
      else js.push({ type: 'inline', content: (el.textContent || '').slice(0, 40000) });
    });

    const pushImg = (raw) => {
      if (!raw || raw.startsWith('data:')) return;
      const full = abs(raw);
      if (!full || seenImg.has(full)) return;
      seenImg.add(full);
      const path = full.split('?')[0];
      const ext = (path.match(/\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)(?:$|\?)/i) || [, 'img'])[1].toLowerCase();
      images.push({ url: full, ext: ext === 'jpeg' ? 'jpg' : ext });
    };

    document.querySelectorAll('img').forEach(img => {
      pushImg(img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.getAttribute('data-srcset'));
      const ss = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      if (ss) ss.split(',').forEach(part => pushImg(part.trim().split(/\s+/)[0]));
    });
    document.querySelectorAll('source[srcset], source[src]').forEach(s => {
      pushImg(s.getAttribute('src'));
      const ss = s.getAttribute('srcset');
      if (ss) ss.split(',').forEach(part => pushImg(part.trim().split(/\s+/)[0]));
    });
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="image_src"], meta[property="og:image"]').forEach(el => {
      pushImg(el.href || el.content || el.getAttribute('href') || el.getAttribute('content'));
    });
    // CSS background urls from inline styles only (computed too heavy)
    document.querySelectorAll('[style*="background"]').forEach(el => {
      const m = (el.getAttribute('style') || '').match(/url\([\'"]?([^\'\")]+)[\'"]?\)/i);
      if (m) pushImg(m[1]);
    });

    return {
      html: html.slice(0, 800000),
      css,
      js,
      images: images.slice(0, 80),
      title: document.title,
      url: location.href
    };
  }

  function extractImagesFn() {
    const map = new Map();
    const fmt = (url) => {
      const u = (url || '').split('?')[0].toLowerCase();
      if (u.endsWith('.svg') || u.includes('image/svg')) return 'SVG';
      if (u.endsWith('.webp')) return 'WebP';
      if (u.endsWith('.png')) return 'PNG';
      if (u.endsWith('.gif')) return 'GIF';
      if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'JPG';
      if (u.endsWith('.avif')) return 'AVIF';
      return 'IMG';
    };
    const abs = (src) => {
      try { return new URL(src, location.href).href; } catch (e) { return null; }
    };
    document.querySelectorAll('img').forEach(img => {
      const src = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
      if (!src || src.startsWith('data:image/gif')) return;
      const full = abs(src);
      if (!full || map.has(full)) return;
      map.set(full, {
        url: full,
        alt: img.alt || '',
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        type: fmt(full)
      });
    });
    return [...map.values()].slice(0, 200);
  }

  // ── AdSense UI ───────────────────────────────────────────────────────────
  async function scanAdSense() {
    const box = $('ptAdsenseBox');
    if (!box) return;
    box.innerHTML = '<div style="padding:16px;color:#64748b;font-size:12px;">Scanning page…</div>';
    const tab = await getActiveTab();
    if (!tab || !tab.id || !/^https?:/i.test(tab.url || '')) {
      box.innerHTML = '<div style="padding:16px;color:#94a3b8;">Open an http(s) page first.</div>';
      return;
    }
    try {
      const d = (await safeExecuteScript(tab.id, extractAdSenseFn)) || {};
      let adsTxtVerified = false;
      if (d.adsTxtUrl && d.primaryPubId) {
        try {
          const res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'CHECK_LINK_STATUS', url: d.adsTxtUrl }, (r) => { ignoreLastError(); resolve(r); });
          });
          // Fetch ads.txt content via background if possible
          const txt = await fetchAdsTxt(d.adsTxtUrl);
          if (txt && d.primaryPubId && txt.toLowerCase().includes(d.primaryPubId.toLowerCase().replace('ca-', ''))) {
            adsTxtVerified = true;
          }
        } catch (e) {}
      }
      renderAdSense(box, d, adsTxtVerified);
    } catch (e) {
      box.innerHTML = '<div style="padding:16px;color:#dc2626;">Could not scan this page.</div>';
    }
  }

  async function fetchAdsTxt(url) {
    // Never fetch from popup (CORS / Errors page). Use background proxy.
    try {
      if (!url || /chromewebstore|chrome\.google|accounts\.google/i.test(url)) return null;
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'FETCH_TEXT', url }, (res) => {
          ignoreLastError();
          if (!res || !res.ok) resolve(null);
          else resolve(res.text || null);
        });
      });
    } catch (e) {
      return null;
    }
  }

  function renderAdSense(box, d, verified) {
    if (!d.primaryPubId) {
      box.innerHTML = `
        <div style="padding:20px;text-align:center;">
          <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px;">No AdSense publisher found</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:12px;">No ca-pub-… ID in scripts or ad units.</div>
          ${d.adsTxtUrl ? '<a href="' + esc(d.adsTxtUrl) + '" target="_blank" style="color:#0f766e;font-weight:600;font-size:12px;">Check ads.txt ↗</a>' : ''}
        </div>`;
      return;
    }
    box.innerHTML = `
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:14px;margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="width:36px;height:36px;border-radius:8px;background:#059669;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;">$</div>
        <div style="flex:1;min-width:140px;">
          <div style="font-size:11px;font-weight:700;color:#047857;letter-spacing:.02em;">ADSENSE PUBLISHER DETECTED
            ${verified ? '<span style="background:#22c55e;color:#fff;font-size:9px;padding:2px 6px;border-radius:4px;margin-left:6px;">ADS.TXT VERIFIED</span>' : ''}
          </div>
          <div style="font-family:ui-monospace,monospace;font-size:13px;font-weight:700;color:#0f172a;margin-top:2px;">${esc(d.primaryPubId)}</div>
        </div>
        <button type="button" id="ptCopyPub" style="background:#0f766e;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:11px;font-weight:700;cursor:pointer;">Copy Pub ID</button>
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:12px;">
        <div style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #f1f5f9;">
          <span style="color:#64748b;">Ad Units / Slots</span>
          <b>${d.adSlotsCount || 0} slots</b>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #f1f5f9;">
          <span style="color:#64748b;">Google Analytics 4</span>
          <b>${esc(d.ga4Id || '—')}</b>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #f1f5f9;">
          <span style="color:#64748b;">GTM</span>
          <b>${esc(d.gtmId || '—')}</b>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 12px;">
          <span style="color:#64748b;">Domain ads.txt</span>
          ${d.adsTxtUrl ? '<a href="' + esc(d.adsTxtUrl) + '" target="_blank" style="color:#2563eb;font-weight:600;">View ads.txt ↗</a>' : '<span>—</span>'}
        </div>
      </div>
      ${(d.publisherIds || []).length > 1 ? '<div style="margin-top:10px;font-size:11px;color:#64748b;">All IDs: ' + d.publisherIds.map(esc).join(', ') + '</div>' : ''}
    `;
    $('ptCopyPub')?.addEventListener('click', () => {
      navigator.clipboard.writeText(d.primaryPubId).then(() => {
        const b = $('ptCopyPub');
        if (b) { b.textContent = 'Copied!'; setTimeout(() => { b.textContent = 'Copy Pub ID'; }, 1200); }
      });
    });
  }

  // ── Source UI ────────────────────────────────────────────────────────────
  let _source = null;
  let _srcTab = 'html';

  async function scanSource() {
    const out = $('ptSourceOut');
    const status = $('ptSourceStatus');
    if (status) status.textContent = 'Loading…';
    const tab = await getActiveTab();
    if (!tab || !tab.id || !/^https?:/i.test(tab.url || '')) {
      if (status) status.textContent = 'Open an http(s) page first.';
      return;
    }
    try {
      const result = await safeExecuteScript(tab.id, extractSourceFn);
      _source = result;
      if (status) status.textContent = (_source.title || '').slice(0, 60);
      showSourceTab(_srcTab);
    } catch (e) {
      if (status) status.textContent = 'Could not read page source.';
    }
  }

  function showSourceTab(name) {
    _srcTab = name;
    document.querySelectorAll('.pt-src-tab').forEach(b => {
      const on = b.dataset.src === name;
      b.style.background = on ? '#0f172a' : '#fff';
      b.style.color = on ? '#fff' : '#64748b';
    });
    const out = $('ptSourceOut');
    if (!out || !_source) return;
    let text = '';
    if (name === 'html') text = _source.html || '';
    else if (name === 'css') {
      text = (_source.css || []).map((c, i) =>
        c.type === 'link' ? '/* [' + (i + 1) + '] ' + c.href + ' */\n' : '/* inline style #' + (i + 1) + ' */\n' + (c.content || '')
      ).join('\n\n') || 'No stylesheets found.';
    } else {
      text = (_source.js || []).map((j, i) =>
        j.type === 'src' ? '// [' + (i + 1) + '] ' + j.href : '// inline script #' + (i + 1) + '\n' + (j.content || '')
      ).join('\n\n') || 'No scripts found.';
    }
    out.textContent = text;
    const meta = $('ptSourceMeta');
    if (meta && _source) {
      const cssN = (_source.css || []).length;
      const jsN = (_source.js || []).length;
      const htmlLen = (_source.html || '').length;
      const imgN = (_source.images || []).length;
      if (name === 'html') meta.textContent = 'HTML · ' + Math.round(htmlLen / 1024) + ' KB · ' + imgN + ' images · ' + (_source.url || '');
      else if (name === 'css') meta.textContent = cssN + ' stylesheet(s) · CSS Files';
      else meta.textContent = jsN + ' script(s) · JS Scripts';
    }
  }

  function copySource() {
    const out = $('ptSourceOut');
    if (!out) return;
    navigator.clipboard.writeText(out.textContent || '').then(() => {
      const b = $('ptCopySrc');
      if (b) {
        const prev = b.innerHTML;
        b.innerHTML = '✓ Copied';
        b.style.borderColor = 'rgba(16,185,129,.5)';
        b.style.color = '#6ee7b7';
        setTimeout(() => {
          b.innerHTML = prev;
          b.style.borderColor = '';
          b.style.color = '';
        }, 1400);
      }
    }).catch(() => {});
  }

  function safeName(s) {
    return String(s || 'page').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 40);
  }
  function downloadBlob(text, name, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }
  function downloadSource() {
    if (!_source) { scanSource().then(() => downloadSource()); return; }
    const base = safeName((_source.title || 'page').slice(0, 30));
    let text = '', name = base + '.html', mime = 'text/html;charset=utf-8';
    if (_srcTab === 'html') { text = _source.html || ''; name = base + '.html'; }
    else if (_srcTab === 'css') {
      text = $('ptSourceOut')?.textContent || '';
      name = base + '-styles.css';
      mime = 'text/css;charset=utf-8';
    } else {
      text = $('ptSourceOut')?.textContent || '';
      name = base + '-scripts.js';
      mime = 'text/javascript;charset=utf-8';
    }
    if (!text) return;
    downloadBlob(text, name, mime);
  }
  function downloadAllSource() {
    if (!_source) { scanSource().then(() => downloadAllSource()); return; }
    downloadPagePackage();
  }

  async function fetchAssetBytes(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'FETCH_BLOB_URL', url }, async (res) => {
        ignoreLastError();
        if (!res || !res.ok || !res.dataUrl) {
          resolve(null);
          return;
        }
        try {
          const r = await fetch(res.dataUrl);
          const buf = await r.arrayBuffer();
          resolve(new Uint8Array(buf));
        } catch (_) { resolve(null); }
      });
    });
  }

  async function downloadPagePackage() {
    const status = $('ptSourceStatus');
    const base = safeName((_source.title || 'page').slice(0, 28));
    const Zip = window.SimpleZip;
    if (!Zip) {
      // Fallback: sequential files without zip
      downloadSource();
      const imgs = _source.images || [];
      imgs.slice(0, 30).forEach((im, i) => {
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'FETCH_BLOB_URL', url: im.url }, (res) => {
            ignoreLastError();
            if (!res || !res.ok || !res.dataUrl) return;
            const a = document.createElement('a');
            a.href = res.dataUrl;
            a.download = 'img-' + (i + 1) + '.' + (im.ext || 'img');
            a.click();
          });
        }, 200 * i);
      });
      return;
    }

    if (status) status.textContent = 'Building package (HTML + CSS + images)…';
    const zip = new Zip();
    let html = _source.html || '';
    const imgMap = {}; // original url -> assets/filename

    // Rewrite image URLs in HTML to local assets/
    const images = _source.images || [];
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      if (status) status.textContent = 'Fetching image ' + (i + 1) + '/' + images.length + '…';
      const bytes = await fetchAssetBytes(im.url);
      if (!bytes) continue;
      const fname = 'img-' + String(i + 1).padStart(2, '0') + '.' + (im.ext || 'bin');
      const path = 'assets/' + fname;
      await zip.addFile(path, bytes);
      imgMap[im.url] = path;
      // Also replace common variants without query
      try {
        const noQ = im.url.split('?')[0];
        imgMap[noQ] = path;
      } catch (_) {}
    }

    // Replace absolute image URLs in HTML
    Object.keys(imgMap).sort((a, b) => b.length - a.length).forEach((url) => {
      const local = imgMap[url];
      // Escape for regex
      const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        html = html.replace(new RegExp(esc, 'g'), local);
      } catch (_) {}
    });

    // Bundle CSS (inline + note external)
    const cssText = (_source.css || []).map((c, i) =>
      c.type === 'link' ? '/* external: ' + c.href + ' */' : '/* inline #' + (i + 1) + ' */\n' + (c.content || '')
    ).join('\n\n');
    if (cssText) await zip.addFile('styles.css', new TextEncoder().encode(cssText));

    const jsText = (_source.js || []).map((j, i) =>
      j.type === 'src' ? '// external: ' + j.href : '// inline #' + (i + 1) + '\n' + (j.content || '')
    ).join('\n\n');
    if (jsText) await zip.addFile('scripts.js', new TextEncoder().encode(jsText));

    // README
    const readme = [
      'ShahzaibSEO page package',
      'URL: ' + (_source.url || ''),
      'Title: ' + (_source.title || ''),
      'Images saved: ' + Object.keys(imgMap).length,
      'Open index.html in a browser. External CSS/JS CDNs still need network.',
      ''
    ].join('\n');
    await zip.addFile('README.txt', new TextEncoder().encode(readme));
    await zip.addFile('index.html', new TextEncoder().encode(html));

    const blob = zip.generate();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = base + '-page.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (status) status.textContent = 'Downloaded ' + base + '-page.zip (' + Object.keys(imgMap).length + ' images)';
  }

  // ── Image convert / download helpers (enhance existing Images tab) ───────
  async function convertAndDownload(imageUrl, format) {
    try {
      // Prefer background proxy for cross-origin images (avoids CORS Errors page)
      let blob = null;
      try {
        const proxied = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'FETCH_BLOB_URL', url: imageUrl }, (r) => { ignoreLastError(); resolve(r); });
        });
        if (proxied && proxied.ok && proxied.dataUrl) {
          const r = await fetch(proxied.dataUrl);
          blob = await r.blob();
        }
      } catch (_) {}
      if (!blob) {
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error('fetch');
        blob = await resp.blob();
      }
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (format === 'jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(bitmap, 0, 0);
      const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      const outBlob = await new Promise(r => canvas.toBlob(r, mime, 0.92));
      if (!outBlob) throw new Error('blob');
      const ext = format === 'jpeg' ? 'jpg' : format;
      const objectUrl = URL.createObjectURL(outBlob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'rankseo-image.' + ext;
      a.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 8000);
    } catch (e) {
      // Fallback: open image
      window.open(imageUrl, '_blank');
    }
  }

  function enhanceImagesTab() {
    // Only ONE convert control on Images toolbar (avoid duplicates)
    const toolbar = document.querySelector('.img-download-toolbar');
    if (!toolbar) return;
    // Remove any previously injected duplicates
    toolbar.querySelectorAll('#ptImgConvertHint, #ptImgConvertAll, .pt-img-convert-btn').forEach(n => n.remove());
    const btn = document.createElement('button');
    btn.id = 'ptImgConvertHint';
    btn.className = 'img-download-btn pt-img-convert-btn';
    btn.style.marginLeft = '8px';
    btn.innerHTML = 'Convert All (PNG/JPG/WebP)';
    btn.title = 'Open image grid — download or convert each image';
    btn.addEventListener('click', async () => {
      const tab = await getActiveTab();
      if (!tab?.id) return;
      try {
        const imgs = (await safeExecuteScript(tab.id, extractImagesFn)) || [];
        if (!imgs.length) { alert('No images found on page.'); return; }
        showImageConvertPanel(imgs);
      } catch (e) {
        alert('Could not extract images from this page.');
      }
    });
    toolbar.appendChild(btn);
  }

  function showImageConvertPanel(imgs) {
    let modal = $('ptImgModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ptImgModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:520px;width:100%;max-height:80vh;overflow:auto;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,.25);">
        <div style="display:flex;align-items:center;margin-bottom:12px;">
          <strong style="font-size:14px;color:#0f766e;">Page Images (${imgs.length})</strong>
          <button type="button" id="ptImgModalClose" style="margin-left:auto;border:none;background:#f1f5f9;border-radius:6px;padding:4px 10px;cursor:pointer;">Close</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">
          ${imgs.slice(0, 40).map((im, i) => `
            <div style="border:1px solid #e2e8f0;border-radius:10px;padding:8px;text-align:center;">
              <img src="${esc(im.url)}" style="width:100%;height:64px;object-fit:contain;background:#f8fafc;border-radius:6px;" onerror="this.style.opacity=.3"/>
              <div style="font-size:10px;color:#94a3b8;margin:4px 0;">${esc(im.type)} ${im.width ? im.width + '×' + im.height : ''}</div>
              <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">
                <button type="button" data-dl="${i}" style="font-size:10px;padding:3px 6px;border-radius:4px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;">DL</button>
                <button type="button" data-png="${i}" style="font-size:10px;padding:3px 6px;border-radius:4px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;">PNG</button>
                <button type="button" data-jpg="${i}" style="font-size:10px;padding:3px 6px;border-radius:4px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;">JPG</button>
                <button type="button" data-webp="${i}" style="font-size:10px;padding:3px 6px;border-radius:4px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;">WebP</button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    $('ptImgModalClose')?.addEventListener('click', () => modal.remove());
    modal.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', () => {
      const im = imgs[+b.dataset.dl];
      if (!im) return;
      const a = document.createElement('a'); a.href = im.url; a.download = ''; a.target = '_blank'; a.click();
    }));
    modal.querySelectorAll('[data-png]').forEach(b => b.addEventListener('click', () => convertAndDownload(imgs[+b.dataset.png].url, 'png')));
    modal.querySelectorAll('[data-jpg]').forEach(b => b.addEventListener('click', () => convertAndDownload(imgs[+b.dataset.jpg].url, 'jpeg')));
    modal.querySelectorAll('[data-webp]').forEach(b => b.addEventListener('click', () => convertAndDownload(imgs[+b.dataset.webp].url, 'webp')));
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    $('ptAdsenseRescan')?.addEventListener('click', scanAdSense);
    $('ptSourceScan')?.addEventListener('click', scanSource);
    $('ptCopySrc')?.addEventListener('click', copySource);
    $('ptDlSrc')?.addEventListener('click', downloadSource);
    $('ptDlAllSrc')?.addEventListener('click', downloadAllSource);
    document.querySelectorAll('.pt-src-tab').forEach(b => {
      b.addEventListener('click', () => showSourceTab(b.dataset.src));
    });
    // Source Code tab → auto load
    document.querySelectorAll('.nav-btn[data-tab="pagetools"]').forEach(nav => {
      nav.addEventListener('click', () => setTimeout(scanSource, 150));
    });
    // Dashboard → auto AdSense scan
    document.querySelectorAll('.nav-btn[data-tab="dashboard"]').forEach(nav => {
      nav.addEventListener('click', () => setTimeout(scanAdSense, 200));
    });
    // First open (dashboard active)
    setTimeout(scanAdSense, 600);
    enhanceImagesTab();
    $('ptOpenImgPanel')?.addEventListener('click', async () => {
      const tab = await getActiveTab();
      if (!tab?.id) return;
      try {
        const imgs2 = (await safeExecuteScript(tab.id, extractImagesFn)) || [];
        showImageConvertPanel(imgs2);
      } catch (e) { alert('Could not extract images.'); }
    });
    // Re-enhance when images tab shown
    document.querySelectorAll('.nav-btn[data-tab="images"]').forEach(n => {
      n.addEventListener('click', () => setTimeout(enhanceImagesTab, 300));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
