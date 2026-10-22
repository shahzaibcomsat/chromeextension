/**
 * On-Page Labs in popup — Density, Weight, Headers, Link Status (current tab)
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&gt;').replace(/"/g, '&quot;');
  }

  let _snapshot = null;
  let _oplTab = 'density';
  let _checking = false;

  async function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve((tabs && tabs[0]) || null);
      });
    });
  }

  // Runs in page context via chrome.scripting
  function extractPageFn() {
    const STOP = new Set('a an the and or but in on at to for of is are was were be been being it this that these those i you he she we they my your his her its our their with from by as into about over after before between under again further then once here there when where why how all each each few more most other some such no nor not only own same so than too very can will just should now'.split(/\s+/));
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,iframe,#rankseo-toolbar,#rs-labs-panel,#rs-sidebar-host').forEach(n => n.remove());
    const text = (clone.innerText || '').replace(/\s+/g, ' ').trim();
    const words = text.toLowerCase().match(/[a-z0-9']+/g) || [];

    function ngrams(n, limit) {
      const counts = new Map();
      for (let i = 0; i <= words.length - n; i++) {
        const slice = words.slice(i, i + n);
        if (n === 1 && STOP.has(slice[0])) continue;
        const key = slice.join(' ');
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const total = Math.max(words.length, 1);
      const title = (document.title || '').toLowerCase();
      const headings = [...document.querySelectorAll('h1,h2,h3')].map(h => (h.textContent || '').toLowerCase()).join(' ');
      return [...counts.entries()]
        .map(([phrase, count]) => ({
          phrase, count,
          density: (count / total) * 100,
          inTitle: title.includes(phrase),
          inH: headings.includes(phrase)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit || 30);
    }

    const resources = (performance.getEntriesByType('resource') || []).map(r => ({
      name: r.name, size: r.transferSize || r.encodedBodySize || 0, initiatorType: r.initiatorType
    }));
    const buckets = { css: 0, js: 0, image: 0, font: 0, other: 0 };
    let totalBytes = 0;
    resources.forEach(r => {
      totalBytes += r.size;
      const name = (r.name || '').split('?')[0].toLowerCase();
      if (/\.css$/.test(name) || r.initiatorType === 'css') buckets.css += r.size;
      else if (/\.m?js$/.test(name) || r.initiatorType === 'script') buckets.js += r.size;
      else if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/.test(name) || r.initiatorType === 'img') buckets.image += r.size;
      else if (/\.(woff2?|ttf|otf|eot)$/.test(name)) buckets.font += r.size;
      else buckets.other += r.size;
    });

    const origin = location.origin;
    const seen = new Set();
    const links = [];
    document.querySelectorAll('a[href]').forEach(a => {
      let href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      try {
        const u = new URL(href, location.href);
        if (!/^https?:/.test(u.protocol)) return;
        const key = u.href.split('#')[0];
        if (seen.has(key)) return;
        seen.add(key);
        links.push({
          href: key,
          anchor: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50) || '(no anchor)',
          internal: u.origin === origin
        });
      } catch (e) {}
    });

    return {
      url: location.href,
      title: document.title || '',
      wordCount: words.length,
      density1: ngrams(1, 25),
      density2: ngrams(2, 20),
      density3: ngrams(3, 15),
      weight: { totalBytes, buckets, resourceCount: resources.length },
      metaRobots: document.querySelector('meta[name="robots"]')?.content || '',
      metaGooglebot: document.querySelector('meta[name="googlebot"]')?.content || '',
      canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      links: links.slice(0, 100)
    };
  }

  function fmtBytes(b) {
    if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  }

  function statusPill(st, redirected, err) {
    if (err || !st) return '<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">ERR</span>';
    const ok = st >= 200 && st < 300;
    const redir = st >= 300 && st < 400;
    const bg = ok ? '#dcfce7' : redir ? '#e0f2fe' : '#fee2e2';
    const col = ok ? '#16a34a' : redir ? '#0284c7' : '#dc2626';
    return '<span style="background:' + bg + ';color:' + col + ';padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">' + st + (redirected ? ' →' : '') + '</span>';
  }

  function renderDensity(n) {
    n = n || 1;
    const rows = _snapshot['density' + n] || [];
    let html = '<div style="margin-bottom:8px;display:flex;gap:4px;">';
    [1, 2, 3].forEach(g => {
      const on = g === n;
      html += '<button type="button" class="opl-gram" data-n="' + g + '" style="padding:4px 10px;border-radius:6px;border:1px solid ' + (on ? '#0f766e' : '#e2e8f0') + ';background:' + (on ? '#0f766e' : '#fff') + ';color:' + (on ? '#fff' : '#64748b') + ';font-size:11px;font-weight:600;cursor:pointer;">' + g + '-gram</button>';
    });
    html += '</div>';
    html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">' + (_snapshot.wordCount || 0).toLocaleString() + ' words · top phrases</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="color:#94a3b8;text-align:left;"><th style="padding:4px;">Keyword</th><th>Count</th><th>Density</th><th>T</th><th>H</th></tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:5px 4px;">' + esc(r.phrase) + '</td><td>' + r.count + '</td><td>' + r.density.toFixed(2) + '%</td><td>' + (r.inTitle ? '✓' : '') + '</td><td>' + (r.inH ? '✓' : '') + '</td></tr>';
    });
    html += '</tbody></table>';
    const out = $('oplOutput');
    if (out) {
      out.innerHTML = html;
      out.querySelectorAll('.opl-gram').forEach(btn => {
        btn.addEventListener('click', () => renderDensity(parseInt(btn.dataset.n, 10)));
      });
    }
  }

  function renderWeight() {
    const w = _snapshot.weight || {};
    const b = w.buckets || {};
    const max = Math.max(...Object.values(b), 1);
    let html = '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span>Total transfer</span><b style="color:#0f766e;">' + fmtBytes(w.totalBytes || 0) + '</b></div>';
    html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span>Resources</span><b>' + (w.resourceCount || 0) + '</b></div>';
    Object.entries(b).forEach(([k, v]) => {
      const pct = ((v / max) * 100).toFixed(0);
      html += '<div style="margin-top:10px;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;">' + k + '</div>';
      html += '<div style="display:flex;justify-content:space-between;font-size:12px;"><span>' + fmtBytes(v) + '</span><span>' + pct + '%</span></div>';
      html += '<div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-top:4px;"><div style="height:100%;width:' + pct + '%;background:#0d9488;"></div></div>';
    });
    html += '<p style="font-size:10px;color:#94a3b8;margin-top:10px;">Cross-origin sizes may be under-reported without Timing-Allow-Origin.</p>';
    const out = $('oplOutput');
    if (out) out.innerHTML = html;
  }

  async function renderHeaders() {
    const out = $('oplOutput');
    if (!out) return;
    out.innerHTML = '<div style="color:#94a3b8;">Fetching headers…</div>';
    let status = '—', xRobots = '', extra = '';
    try {
      const tab = await getActiveTab();
      if (tab && tab.url) {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'CHECK_LINK_STATUS', url: tab.url }, resolve);
        });
        if (res && res.status) {
          status = res.status + (res.redirected ? ' (redirected)' : '');
          if (res.finalUrl && res.redirected) {
            extra = 'Final URL: ' + res.finalUrl + (extra ? '\n' + extra : '');
          }
        }
      }
      // Ask background for a fuller header fetch if available — soft fallback
      const pageRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'SERP_PAGE_INFO', url: _snapshot.url }, (r) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      }).catch(() => null);
      if (pageRes && pageRes.ok && pageRes.headers) {
        extra = Object.entries(pageRes.headers).map(([k, v]) => k + ': ' + v).join('\n');
      }
    } catch (e) {}

    const combined = (_snapshot.metaRobots + ' ' + _snapshot.metaGooglebot + ' ' + xRobots).toLowerCase();
    const noindex = /\bnoindex\b|\bnone\b/.test(combined);
    const nofollow = /\bnofollow\b|\bnone\b/.test(combined);

    let html = '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span>HTTP</span><b>' + esc(String(status)) + '</b></div>';
    html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span>Indexable</span><span style="background:' + (noindex ? '#fee2e2' : '#dcfce7') + ';color:' + (noindex ? '#dc2626' : '#16a34a') + ';padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700;">' + (noindex ? 'noindex' : 'indexable') + '</span></div>';
    html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span>Follow</span><span style="background:' + (nofollow ? '#fef9c3' : '#dcfce7') + ';color:' + (nofollow ? '#ca8a04' : '#16a34a') + ';padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700;">' + (nofollow ? 'nofollow' : 'follow') + '</span></div>';
    html += '<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:11px;"><span style="color:#94a3b8;">Meta robots</span><div>' + esc(_snapshot.metaRobots || '—') + '</div></div>';
    html += '<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:11px;"><span style="color:#94a3b8;">Canonical</span><div style="word-break:break-all;">' + esc(_snapshot.canonical || '—') + '</div></div>';
    if (extra) html += '<pre style="margin-top:10px;background:#0f172a;color:#a5f3fc;padding:8px;border-radius:6px;font-size:10px;overflow:auto;max-height:140px;">' + esc(extra) + '</pre>';
    out.innerHTML = html;
  }

  async function renderLinkStatus(auto) {
    const out = $('oplOutput');
    if (!out || !_snapshot) return;
    const links = _snapshot.links || [];
    let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
    html += '<button type="button" id="oplRecheckLinks" style="padding:6px 12px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;color:#0f766e;font-size:11px;font-weight:600;cursor:pointer;">Re-check status codes</button>';
    html += '<span id="oplLinkProg" style="font-size:11px;color:#64748b;">' + links.length + ' links</span></div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="color:#94a3b8;text-align:left;"><th style="padding:4px;">Anchor</th><th>URL</th><th>Type</th><th>Status</th></tr></thead><tbody id="oplLinkBody">';
    links.forEach((l, i) => {
      html += '<tr data-i="' + i + '" style="border-bottom:1px solid #f1f5f9;">';
      html += '<td style="padding:5px 4px;">' + esc(l.anchor) + '</td>';
      html += '<td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(l.href) + '">' + esc(l.href.replace(/^https?:\/\//, '').slice(0, 40)) + '</td>';
      html += '<td>' + (l.internal ? '<span style="background:#dcfce7;color:#16a34a;padding:1px 6px;border-radius:4px;font-size:10px;">Internal</span>' : '<span style="background:#fef9c3;color:#ca8a04;padding:1px 6px;border-radius:4px;font-size:10px;">External</span>') + '</td>';
      html += '<td class="opl-st">' + statusPill(l._status, l._redir, l._err) + '</td></tr>';
    });
    html += '</tbody></table>';
    out.innerHTML = html;

    async function runCheck(force) {
      if (_checking) return;
      _checking = true;
      const btn = $('oplRecheckLinks');
      const prog = $('oplLinkProg');
      if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
      const rows = [...(out.querySelectorAll('#oplLinkBody tr') || [])];
      let done = 0;
      const queue = [...rows];
      async function worker() {
        while (queue.length) {
          const row = queue.shift();
          if (!row) break;
          const i = parseInt(row.dataset.i, 10);
          const link = links[i];
          if (!link) continue;
          if (!force && link._status != null) {
            done++;
            if (prog) prog.textContent = 'Checking ' + done + '/' + links.length + '…';
            continue;
          }
          const cell = row.querySelector('.opl-st');
          if (cell) cell.innerHTML = statusPill(null, false, false).replace('ERR', '…').replace('#fee2e2', '#f1f5f9').replace('#dc2626', '#94a3b8');
          try {
            const res = await new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: 'CHECK_LINK_STATUS', url: link.href }, (r) => {
                if (chrome.runtime.lastError) resolve({ status: 0, error: true });
                else resolve(r || { status: 0, error: true });
              });
            });
            link._status = res.status || 0;
            link._redir = !!res.redirected;
            link._err = !!res.error || !res.status;
            if (cell) cell.innerHTML = statusPill(link._status, link._redir, link._err);
          } catch (e) {
            link._err = true;
            if (cell) cell.innerHTML = statusPill(0, false, true);
          }
          done++;
          if (prog) prog.textContent = 'Checking ' + done + '/' + links.length + '…';
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);
      _checking = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Re-check status codes'; }
      const ok = links.filter(l => l._status >= 200 && l._status < 300).length;
      if (prog) prog.textContent = 'Done — ' + ok + '/' + links.length + ' OK';
    }

    $('oplRecheckLinks')?.addEventListener('click', () => runCheck(true));
    if (auto) setTimeout(() => runCheck(false), 100);
  }

  function showTab(name) {
    _oplTab = name;
    document.querySelectorAll('.opl-tab').forEach(btn => {
      const on = btn.dataset.opl === name;
      btn.style.background = on ? '#0f766e' : '#fff';
      btn.style.color = on ? '#fff' : '#64748b';
      btn.style.borderColor = on ? '#0f766e' : '#e2e8f0';
      btn.classList.toggle('active', on);
    });
    if (!_snapshot) {
      if ($('oplOutput')) $('oplOutput').innerHTML = '<div style="color:#94a3b8;">Click Analyze page first.</div>';
      return;
    }
    if (name === 'density') renderDensity(1);
    else if (name === 'weight') renderWeight();
    else if (name === 'headers') renderHeaders();
    else if (name === 'links') renderLinkStatus(true);
    else if (name === 'redirects') renderRedirects();
  }

  async function renderRedirects() {
    const out = $('oplOutput');
    if (!out) return;
    out.innerHTML = '<div style="color:#94a3b8;">Checking URL variants (http/https, www, trailing slash)…</div>';
    const tab = await getActiveTab();
    const url = (tab && tab.url) || (_snapshot && _snapshot.url) || '';
    if (!url || !/^https?:/i.test(url)) {
      out.innerHTML = '<div style="color:#dc2626;">Open an http(s) page first, then open Redirects again.</div>';
      return;
    }
    let res;
    try {
      res = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: 'CHECK_REDIRECT_CHAIN', url }, (r) => {
            const err = chrome.runtime.lastError;
            if (err) {
              resolve({
                ok: false,
                error: err.message || 'Background not ready — reload the extension on chrome://extensions'
              });
              return;
            }
            resolve(r || { ok: false, error: 'No response from background' });
          });
        } catch (e) {
          resolve({ ok: false, error: (e && e.message) || 'sendMessage failed' });
        }
      });
    } catch (e) {
      res = { ok: false, error: (e && e.message) || 'Request failed' };
    }
    if (res && res.busy) {
      out.innerHTML = '<div style="color:#d97706;">Redirect check is already running. Wait a few seconds and try again.</div>';
      return;
    }
    if (!res || !res.ok) {
      const msg = (res && (res.error || res.message)) ||
        'No response — reload ShahzaibSEO on chrome://extensions and try again';
      out.innerHTML =
        '<div style="color:#dc2626;">Redirect check failed: ' + esc(msg) + '</div>' +
        '<p style="font-size:11px;color:#64748b;margin-top:8px;">Tip: On chrome://extensions click <b>Reload</b> for ShahzaibSEO, then reopen this page and try Redirects again.</p>';
      return;
    }
    let html = '<div style="font-size:11px;font-weight:700;color:#0f766e;margin-bottom:8px;">Redirect chain / URL variants</div>';
    (res.notes || []).forEach((n) => {
      const bg = n.tone === 'ok' ? '#dcfce7' : (n.tone === 'bad' ? '#fee2e2' : '#fef9c3');
      const col = n.tone === 'ok' ? '#166534' : (n.tone === 'bad' ? '#991b1b' : '#854d0e');
      html += '<div style="padding:8px 10px;border-radius:8px;margin-bottom:6px;background:' + bg + ';color:' + col + ';font-size:11px;line-height:1.4;">' + esc(n.text) + '</div>';
    });
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px;"><thead><tr style="color:#94a3b8;text-align:left;"><th style="padding:4px;">Variant</th><th>Status</th><th>Final URL</th></tr></thead><tbody>';
    (res.chains || []).forEach((c) => {
      const st = c.error ? 'ERR' : String(c.status || '—');
      const stCol = c.error || c.status >= 400 ? '#dc2626' : (c.redirected ? '#d97706' : '#16a34a');
      html += '<tr style="border-bottom:1px solid #f1f5f9;vertical-align:top;">';
      html += '<td style="padding:6px 4px;"><b>' + esc(c.label || '') + '</b><div style="font-size:10px;color:#64748b;word-break:break-all;">' + esc((c.url || '').replace(/^https?:\/\//, '').slice(0, 48)) + '</div></td>';
      html += '<td style="padding:6px 4px;font-weight:700;color:' + stCol + ';">' + esc(st) + (c.redirected ? ' →' : '') + '</td>';
      html += '<td style="padding:6px 4px;font-size:10px;word-break:break-all;color:#334155;">' + esc((c.finalUrl || '').replace(/^https?:\/\//, '').slice(0, 56)) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '<p style="font-size:10px;color:#94a3b8;margin-top:10px;">Tip: Use a single HTTPS preferred host and permanent redirects (301/308) from other variants.</p>';
    out.innerHTML = html;
  }

  async function analyze() {
    const status = $('oplStatus');
    const btn = $('oplRunBtn');
    const tab = await getActiveTab();
    if (!tab || !tab.id || !tab.url || !/^https?:/i.test(tab.url)) {
      if (status) status.textContent = 'Open an http(s) webpage tab first.';
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
    if (status) status.textContent = 'Reading page…';
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageFn
      });
      _snapshot = results && results[0] && results[0].result;
      if (!_snapshot) throw new Error('No data');
      if (status) status.textContent = _snapshot.title || _snapshot.url;
      showTab(_oplTab);
    } catch (e) {
      if (status) status.textContent = 'Could not analyze this tab (restricted page?).';
      if ($('oplOutput')) $('oplOutput').innerHTML = '<div style="color:#dc2626;">' + esc(e.message || String(e)) + '</div>';
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Analyze page'; }
  }

  function init() {
    $('oplRunBtn')?.addEventListener('click', analyze);
    document.querySelectorAll('.opl-tab').forEach(btn => {
      btn.addEventListener('click', () => showTab(btn.dataset.opl));
    });
    // When user opens On-Page Labs tab, auto-analyze if empty
    document.querySelectorAll('.nav-btn[data-tab="onpagelabs"]').forEach(nav => {
      nav.addEventListener('click', () => {
        if (!_snapshot) setTimeout(analyze, 200);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
