// ShahzaibSEO On-Page Labs — Keyword Density, Page Weight, Headers (KWScanner-style free tools)
(function () {
  'use strict';
  if (window.__rankseoOnpageLabs) return;
  window.__rankseoOnpageLabs = true;

  // Skip non-HTML / search SERP chrome (sidebar already covers SERP)
  try {
    const ct = document.contentType || '';
    if (ct && !/html/i.test(ct)) return;
  } catch (e) {}

  const STOP = new Set(('a an the and or but in on at to for of is are was were be been being it this that these those i you he she we they my your his her its our their with from by as into about over after before between under again further then once here there when where why how all each few more most other some such no nor not only own same so than too very can will just should now'.split(/\s+/)));

  function injectStyles() {
    if (document.getElementById('rs-labs-style')) return;
    const s = document.createElement('style');
    s.id = 'rs-labs-style';
    s.textContent = `
      #rs-labs-panel {
        all: initial; position: fixed; top: 48px; right: 16px; width: 420px; max-height: calc(100vh - 64px);
        z-index: 2147483646; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(15,23,42,.18); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        font-size: 12px; color: #1e293b; display: none; flex-direction: column; overflow: hidden;
      }
      #rs-labs-panel.open { display: flex; }
      #rs-labs-panel * { box-sizing: border-box; }
      .rs-labs-head {
        display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #e2e8f0;
        background: linear-gradient(180deg, #f0fdfa 0%, #fff 100%);
      }
      .rs-labs-title { font-weight: 800; font-size: 12px; color: #0f766e; letter-spacing: .04em; text-transform: uppercase; flex: 1; }
      .rs-labs-tabs { display: flex; gap: 4px; padding: 8px 10px; border-bottom: 1px solid #f1f5f9; background: #fafafa; }
      .rs-labs-tab {
        flex: 1; padding: 6px 4px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff;
        font-size: 10px; font-weight: 700; color: #64748b; cursor: pointer; text-align: center;
      }
      .rs-labs-tab:hover { border-color: #99f6e4; color: #0f766e; }
      .rs-labs-tab.active { background: #0f766e; color: #fff; border-color: #0f766e; }
      .rs-labs-body { padding: 10px 12px; overflow-y: auto; max-height: 420px; }
      .rs-labs-close {
        border: none; background: #f1f5f9; width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
        font-size: 14px; color: #64748b; line-height: 1;
      }
      .rs-labs-close:hover { background: #e2e8f0; color: #0f172a; }
      .rs-labs-table { width: 100%; border-collapse: collapse; font-size: 11px; }
      .rs-labs-table th {
        text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em;
        color: #94a3b8; padding: 4px 6px; border-bottom: 1px solid #e2e8f0;
      }
      .rs-labs-table td { padding: 5px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
      .rs-labs-table tr:hover td { background: #f8fafc; }
      .rs-labs-bar {
        height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-top: 4px;
      }
      .rs-labs-bar > i { display: block; height: 100%; background: #0d9488; border-radius: 3px; }
      .rs-labs-metric {
        display: flex; justify-content: space-between; align-items: center; padding: 6px 0;
        border-bottom: 1px solid #f1f5f9; font-size: 11px;
      }
      .rs-labs-metric b { font-variant-numeric: tabular-nums; color: #0f766e; }
      .rs-labs-badge {
        display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;
      }
      .rs-labs-good { background: #dcfce7; color: #16a34a; }
      .rs-labs-warn { background: #fef9c3; color: #ca8a04; }
      .rs-labs-bad  { background: #fee2e2; color: #dc2626; }
      .rs-labs-muted { color: #94a3b8; font-size: 10px; margin-top: 6px; }
      .rs-labs-code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px;
        background: #0f172a; color: #a5f3fc; padding: 8px; border-radius: 6px; overflow-x: auto;
        max-height: 160px; white-space: pre-wrap; word-break: break-all;
      }
      .rs-labs-gram {
        display: inline-flex; gap: 4px; margin-bottom: 8px;
      }
      .rs-labs-gram button {
        padding: 4px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fff;
        font-size: 11px; font-weight: 600; cursor: pointer; color: #64748b;
      }
      .rs-labs-gram button.on { background: #0f766e; color: #fff; border-color: #0f766e; }
      .rs-labs-status {
        display: inline-block; min-width: 36px; text-align: center; padding: 2px 6px;
        border-radius: 10px; font-size: 10px; font-weight: 700;
      }
      .rs-labs-st-ok { background: #dcfce7; color: #16a34a; }
      .rs-labs-st-redir { background: #e0f2fe; color: #0284c7; }
      .rs-labs-st-err { background: #fee2e2; color: #dc2626; }
      .rs-labs-st-pend { background: #f1f5f9; color: #94a3b8; }
      .rs-labs-st-btn {
        padding: 6px 12px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff;
        font-size: 11px; font-weight: 600; cursor: pointer; color: #0f766e;
      }
      .rs-labs-st-btn:hover { background: #f0fdfa; border-color: #99f6e4; }
      .rs-labs-st-btn:disabled { opacity: 0.6; cursor: wait; }
      .rs-labs-url { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; }
    `;
    document.head.appendChild(s);
  }

  function ensurePanel() {
    injectStyles();
    let p = document.getElementById('rs-labs-panel');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'rs-labs-panel';
    p.innerHTML = `
      <div class="rs-labs-head">
        <span class="rs-labs-title">On-Page Labs</span>
        <button type="button" class="rs-labs-close" id="rs-labs-close" title="Close">×</button>
      </div>
      <div class="rs-labs-tabs">
        <button type="button" class="rs-labs-tab active" data-tab="density">Density</button>
        <button type="button" class="rs-labs-tab" data-tab="weight">Weight</button>
        <button type="button" class="rs-labs-tab" data-tab="headers">Headers</button>
        <button type="button" class="rs-labs-tab" data-tab="links">Links</button>
        <button type="button" class="rs-labs-tab" data-tab="adsense">AdSense</button>
      </div>
      <div class="rs-labs-body" id="rs-labs-body"></div>
    `;
    document.body.appendChild(p);
    p.querySelector('#rs-labs-close').addEventListener('click', () => p.classList.remove('open'));
    p.querySelectorAll('.rs-labs-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        p.querySelectorAll('.rs-labs-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderTab(tab.dataset.tab);
      });
    });
    return p;
  }

  function getPageText() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,iframe,#rankseo-toolbar,#rs-labs-panel,#rs-sidebar-host').forEach(n => n.remove());
    return (clone.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function ngrams(text, n, limit) {
    const words = text.toLowerCase().match(/[a-z0-9']+/g) || [];
    const counts = new Map();
    for (let i = 0; i <= words.length - n; i++) {
      const slice = words.slice(i, i + n);
      if (n === 1 && STOP.has(slice[0])) continue;
      if (slice.some(w => STOP.has(w) && n > 1 && slice.filter(x => !STOP.has(x)).length === 0)) continue;
      const key = slice.join(' ');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const total = Math.max(words.length, 1);
    return [...counts.entries()]
      .map(([phrase, count]) => ({
        phrase,
        count,
        density: (count / total) * 100,
        inTitle: (document.title || '').toLowerCase().includes(phrase),
        inH: [...document.querySelectorAll('h1,h2,h3')].some(h => (h.textContent || '').toLowerCase().includes(phrase))
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit || 25);
  }

  function renderDensity() {
    const body = document.getElementById('rs-labs-body');
    if (!body) return;
    let n = 1;
    const text = getPageText();
    const words = (text.match(/[a-z0-9']+/gi) || []).length;
    const draw = () => {
      const rows = ngrams(text, n, 30);
      body.innerHTML = `
        <div class="rs-labs-gram">
          <button type="button" class="${n===1?'on':''}" data-n="1">1-gram</button>
          <button type="button" class="${n===2?'on':''}" data-n="2">2-gram</button>
          <button type="button" class="${n===3?'on':''}" data-n="3">3-gram</button>
        </div>
        <div class="rs-labs-muted">${words.toLocaleString()} words analyzed · top ${rows.length} phrases</div>
        <table class="rs-labs-table">
          <thead><tr><th>Keyword</th><th>Count</th><th>Density</th><th>T</th><th>H</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td>${r.phrase}</td>
              <td>${r.count}</td>
              <td>${r.density.toFixed(2)}%</td>
              <td>${r.inTitle ? '✓' : ''}</td>
              <td>${r.inH ? '✓' : ''}</td>
            </tr>`).join('') || '<tr><td colspan="5">Not enough text</td></tr>'}
          </tbody>
        </table>
      `;
      body.querySelectorAll('[data-n]').forEach(btn => {
        btn.addEventListener('click', () => { n = parseInt(btn.dataset.n, 10); draw(); });
      });
    };
    draw();
  }

  function renderWeight() {
    const body = document.getElementById('rs-labs-body');
    if (!body) return;
    const resources = performance.getEntriesByType('resource') || [];
    const buckets = { css: 0, js: 0, image: 0, font: 0, other: 0 };
    let total = 0;
    resources.forEach(r => {
      const size = r.transferSize || r.encodedBodySize || 0;
      total += size;
      const name = (r.name || '').split('?')[0].toLowerCase();
      if (/\.css$/.test(name) || r.initiatorType === 'css') buckets.css += size;
      else if (/\.m?js$/.test(name) || r.initiatorType === 'script') buckets.js += size;
      else if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/.test(name) || r.initiatorType === 'img') buckets.image += size;
      else if (/\.(woff2?|ttf|otf|eot)$/.test(name)) buckets.font += size;
      else buckets.other += size;
    });
    const fmt = b => b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';
    const max = Math.max(...Object.values(buckets), 1);
    body.innerHTML = `
      <div class="rs-labs-metric"><span>Total transfer</span><b>${fmt(total)}</b></div>
      <div class="rs-labs-metric"><span>Resources</span><b>${resources.length}</b></div>
      ${Object.entries(buckets).map(([k, v]) => `
        <div style="margin:8px 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;color:#64748b;">${k}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span>${fmt(v)}</span><span>${((v/max)*100).toFixed(0)}%</span></div>
        <div class="rs-labs-bar"><i style="width:${(v/max)*100}%"></i></div>
      `).join('')}
      <p class="rs-labs-muted">Cross-origin assets without Timing-Allow-Origin may report 0 size — totals are a floor.</p>
    `;
  }

  async function renderHeaders() {
    const body = document.getElementById('rs-labs-body');
    if (!body) return;
    body.innerHTML = '<div class="rs-labs-muted">Fetching response headers…</div>';
    const metaRobots = document.querySelector('meta[name="robots"]')?.content || '';
    const metaGoogle = document.querySelector('meta[name="googlebot"]')?.content || '';
    const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
    let xRobots = '';
    let status = '—';
    let headersText = '';
    try {
      const res = await fetch(location.href, { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
      status = res.status + ' ' + res.statusText;
      xRobots = res.headers.get('x-robots-tag') || '';
      const interesting = ['content-type', 'cache-control', 'x-robots-tag', 'link', 'strict-transport-security', 'content-security-policy', 'x-frame-options', 'server'];
      const lines = [];
      interesting.forEach(h => {
        const v = res.headers.get(h);
        if (v) lines.push(h + ': ' + v);
      });
      headersText = lines.join('\n') || '(limited header access from page context)';
    } catch (e) {
      headersText = 'Could not re-fetch page: ' + (e.message || e);
    }
    const combined = `${metaRobots} ${metaGoogle} ${xRobots}`.toLowerCase();
    const noindex = /\bnoindex\b|\bnone\b/.test(combined);
    const nofollow = /\bnofollow\b|\bnone\b/.test(combined);
    body.innerHTML = `
      <div class="rs-labs-metric"><span>HTTP status</span><b>${status}</b></div>
      <div class="rs-labs-metric"><span>Indexable</span>
        <span class="rs-labs-badge ${noindex ? 'rs-labs-bad' : 'rs-labs-good'}">${noindex ? 'noindex' : 'indexable'}</span>
      </div>
      <div class="rs-labs-metric"><span>Follow links</span>
        <span class="rs-labs-badge ${nofollow ? 'rs-labs-warn' : 'rs-labs-good'}">${nofollow ? 'nofollow' : 'follow'}</span>
      </div>
      <div class="rs-labs-metric"><span>Meta robots</span><b style="font-weight:500;font-size:11px;">${metaRobots || '—'}</b></div>
      <div class="rs-labs-metric"><span>X-Robots-Tag</span><b style="font-weight:500;font-size:11px;">${xRobots || '—'}</b></div>
      <div class="rs-labs-metric"><span>Canonical</span><b style="font-weight:500;font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;">${canonical || '—'}</b></div>
      <div style="margin-top:10px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;">Response headers</div>
      <div class="rs-labs-code">${headersText.replace(/</g, '&lt;')}</div>
    `;
  }

  let linkStatusCache = {};
  let linkCheckAbort = false;

  function collectPageLinks() {
    const origin = location.origin;
    const seen = new Set();
    const out = [];
    document.querySelectorAll('a[href]').forEach(a => {
      let href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      try {
        const u = new URL(href, location.href);
        if (!/^https?:/.test(u.protocol)) return;
        const key = u.href.split('#')[0];
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          href: key,
          anchor: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || '(no anchor)',
          internal: u.origin === origin
        });
      } catch (e) {}
    });
    return out.slice(0, 80);
  }

  async function checkOneLink(url) {
    if (linkStatusCache[url] != null) return linkStatusCache[url];
    // Only via background (has host permissions) — never fetch from content script (CORS errors)
    const viaBg = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'CHECK_LINK_STATUS', url }, (res) => {
          if (chrome.runtime.lastError || !res) {
            resolve({ status: 0, error: true });
            return;
          }
          resolve(res);
        });
      } catch (e) {
        resolve({ status: 0, error: true });
      }
    });
    linkStatusCache[url] = {
      status: viaBg.status || 0,
      redirected: !!viaBg.redirected,
      error: !!viaBg.error || !viaBg.status
    };
    return linkStatusCache[url];
  }

  function statusBadge(info) {
    if (!info) return '<span class="rs-labs-status rs-labs-st-pend">…</span>';
    if (info.error || !info.status) return '<span class="rs-labs-status rs-labs-st-err">ERR</span>';
    const st = info.status;
    const cls = st >= 200 && st < 300 ? 'rs-labs-st-ok' : st >= 300 && st < 400 ? 'rs-labs-st-redir' : 'rs-labs-st-err';
    const arrow = info.redirected ? ' →' : '';
    return '<span class="rs-labs-status ' + cls + '">' + st + arrow + '</span>';
  }

  function renderLinks() {
    const body = document.getElementById('rs-labs-body');
    if (!body) return;
    const links = collectPageLinks();
    const internal = links.filter(l => l.internal).length;
    const external = links.length - internal;

    body.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
        <button type="button" class="rs-labs-st-btn" id="rs-labs-check-links">Re-check status codes</button>
        <button type="button" class="rs-labs-st-btn" id="rs-labs-highlight-links" title="Highlight follow/nofollow links on the page">Highlight on page</button>
        <span class="rs-labs-muted" id="rs-labs-check-progress">${links.length} links · ${internal} int · ${external} ext</span>
      </div>
      <table class="rs-labs-table">
        <thead><tr><th>Anchor</th><th>URL</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>
          ${links.map((l, i) => `<tr data-href="${l.href.replace(/"/g, '&quot;')}">
            <td>${l.anchor.replace(/</g, '&lt;')}</td>
            <td><span class="rs-labs-url" title="${l.href.replace(/"/g, '&quot;')}">${l.href.replace(/^https?:\/\//, '').slice(0, 42)}</span></td>
            <td>${l.internal ? '<span class="rs-labs-badge rs-labs-good">Internal</span>' : '<span class="rs-labs-badge rs-labs-warn">External</span>'}</td>
            <td class="rs-labs-st-cell">${statusBadge(linkStatusCache[l.href])}</td>
          </tr>`).join('') || '<tr><td colspan="4">No links found</td></tr>'}
        </tbody>
      </table>
    `;

    const btn = document.getElementById('rs-labs-check-links');
    const prog = document.getElementById('rs-labs-check-progress');

    async function runLinkCheck(force) {
      if (!btn) return;
      linkCheckAbort = false;
      btn.disabled = true;
      btn.textContent = 'Checking…';
      const rows = [...body.querySelectorAll('tbody tr[data-href]')];
      let done = 0;
      const queue = [...rows];
      async function worker() {
        while (queue.length && !linkCheckAbort) {
          const row = queue.shift();
          if (!row) break;
          const href = row.getAttribute('data-href');
          const cell = row.querySelector('.rs-labs-st-cell');
          if (!force && linkStatusCache[href] != null) {
            if (cell) cell.innerHTML = statusBadge(linkStatusCache[href]);
            done++;
            if (prog) prog.textContent = 'Checking ' + done + '/' + rows.length + '…';
            continue;
          }
          if (cell) cell.innerHTML = statusBadge(null);
          if (force) delete linkStatusCache[href];
          const info = await checkOneLink(href);
          if (cell) cell.innerHTML = statusBadge(info);
          done++;
          if (prog) prog.textContent = 'Checking ' + done + '/' + rows.length + '…';
        }
      }
      await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
      btn.disabled = false;
      btn.textContent = 'Re-check status codes';
      if (prog) {
        const ok = rows.filter(r => {
          const t = (r.querySelector('.rs-labs-st-cell')?.textContent || '').trim();
          return /^2/.test(t);
        }).length;
        const err = rows.length - ok;
        prog.textContent = 'Done — ' + ok + '/' + rows.length + ' OK' + (err ? ' · ' + err + ' issue' + (err > 1 ? 's' : '') : '');
      }
    }

    btn?.addEventListener('click', () => runLinkCheck(true));
    document.getElementById('rs-labs-highlight-links')?.addEventListener('click', () => {
      if (typeof window.ShahzaibSEOToggleLinkHighlight === 'function') {
        window.ShahzaibSEOToggleLinkHighlight();
      } else {
        window.dispatchEvent(new CustomEvent('rankseo:toggleLinkHighlights', { detail: { enabled: true } }));
      }
      const hb = document.getElementById('rs-labs-highlight-links');
      if (hb) {
        const on = hb.classList.toggle('on');
        hb.textContent = on ? 'Hide highlights' : 'Highlight on page';
      }
    });
    // Auto-start on open (use cache for already-checked)
    setTimeout(() => runLinkCheck(false), 120);
  }


  function renderAdSense() {
    const body = document.getElementById('rs-labs-body');
    if (!body) return;
    const html = document.documentElement.outerHTML;
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
    const pubs = [...detected];
    const ga4 = (html.match(/G-[A-Z0-9]{8,12}/i) || [])[0];
    const gtm = (html.match(/GTM-[A-Z0-9]{6,10}/i) || [])[0];
    const adsTxt = location.origin + '/ads.txt';

    if (!pubs.length) {
      body.innerHTML = '<div style="padding:16px;text-align:center;color:#64748b;">No AdSense publisher ID found on this page.<div style="margin-top:8px;"><a href="' + adsTxt + '" target="_blank" style="color:#0f766e;font-weight:600;">Check ads.txt ↗</a></div></div>';
      return;
    }
    body.innerHTML = `
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="font-size:10px;font-weight:700;color:#047857;letter-spacing:.04em;">ADSENSE DETECTED</div>
        <div style="font-family:ui-monospace,monospace;font-size:13px;font-weight:700;margin-top:4px;">${pubs[0]}</div>
        <button type="button" id="rs-labs-copy-pub" style="margin-top:8px;padding:5px 10px;border-radius:6px;border:none;background:#0f766e;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">Copy Pub ID</button>
      </div>
      <div style="font-size:12px;line-height:1.8;">
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:6px 0;"><span style="color:#64748b;">Ad slots</span><b>${slots.length}</b></div>
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:6px 0;"><span style="color:#64748b;">GA4</span><b>${ga4 || '—'}</b></div>
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:6px 0;"><span style="color:#64748b;">GTM</span><b>${gtm || '—'}</b></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;"><span style="color:#64748b;">ads.txt</span><a href="${adsTxt}" target="_blank" style="color:#2563eb;font-weight:600;">View ↗</a></div>
      </div>
      ${pubs.length > 1 ? '<div style="margin-top:8px;font-size:11px;color:#64748b;">All: ' + pubs.join(', ') + '</div>' : ''}
    `;
    body.querySelector('#rs-labs-copy-pub')?.addEventListener('click', () => {
      navigator.clipboard.writeText(pubs[0]).then(() => {
        const b = body.querySelector('#rs-labs-copy-pub');
        if (b) { b.textContent = 'Copied!'; setTimeout(() => { b.textContent = 'Copy Pub ID'; }, 1200); }
      });
    });
  }

  function renderTab(tab) {
    if (tab === 'density') renderDensity();
    else if (tab === 'weight') renderWeight();
    else if (tab === 'links') renderLinks();
    else if (tab === 'adsense') renderAdSense();
    else renderHeaders();
  }

  function openLabs(tab) {
    const p = ensurePanel();
    p.classList.add('open');
    p.querySelectorAll('.rs-labs-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    renderTab(tab || 'density');
  }

  // Toolbar hooks — wait for toolbar buttons if present
  function attachToolbarButtons() {
    const actions = document.querySelector('#rankseo-toolbar .rankseo-actions');
    if (!actions || document.getElementById('rs-btn-labs')) return;
    const btn = document.createElement('button');
    btn.className = 'rankseo-btn';
    btn.id = 'rs-btn-labs';
    btn.title = 'On-Page Labs: Density · Weight · Headers';
    btn.textContent = 'Labs';
    btn.addEventListener('click', () => {
      const p = document.getElementById('rs-labs-panel');
      if (p && p.classList.contains('open')) p.classList.remove('open');
      else openLabs('density');
    });
    actions.insertBefore(btn, actions.firstChild);
  }

  // Expose for toolbar / external
  window.ShahzaibSEOLabs = { open: openLabs };

  // Attach when toolbar appears
  attachToolbarButtons();
  setTimeout(attachToolbarButtons, 1500);
  setTimeout(attachToolbarButtons, 4000);
  new MutationObserver(() => attachToolbarButtons()).observe(document.documentElement, { childList: true, subtree: true });
})();
