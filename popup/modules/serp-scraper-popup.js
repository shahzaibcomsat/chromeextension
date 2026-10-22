/**
 * ShahzaibSEO popup — SERP Scraper (feature-rich)
 */
(function () {
  'use strict';

  const TYPE_COLORS = {
    'Sponsored': '#ea4335', 'Shopping': '#fbbc04', 'AI Overview': '#8e24aa',
    'Featured Snippet': '#1a73e8', 'Knowledge Panel': '#00897b',
    'People Also Ask': '#039be5', 'PAA': '#039be5',
    'Video': '#e53935', 'Image Pack': '#f4511e', 'Top Stories': '#3949ab',
    'Discussions and Forums': '#6d4c41', 'Forum': '#6d4c41',
    'Local Pack': '#43a047', 'Organic': '#34a853', 'Related Search': '#7cb342'
  };

  let rows = [];
  let selectedTypes = new Set();
  let viewMode = 'all';
  let showSnippets = false;
  let sortKey = 'position'; // position | da | dr | title | domain
  let sortDir = 1;
  let myDomain = '';
  let queryMeta = { q: '', hl: '', gl: '' };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function shortType(t) {
    if (t === 'People Also Ask') return 'PAA';
    if (t === 'Discussions and Forums') return 'Forum';
    return t;
  }
  function colorFor(t) {
    return TYPE_COLORS[t] || TYPE_COLORS[shortType(t)] || '#94a3b8';
  }
  function isGoogleSerp(url) {
    try {
      const u = new URL(url);
      return /google\./i.test(u.hostname) && (/[?&]q=/.test(u.search) || /\/search/.test(u.pathname));
    } catch (_) { return false; }
  }
  function parseQuery(url) {
    try {
      const u = new URL(url);
      return {
        q: u.searchParams.get('q') || '',
        hl: u.searchParams.get('hl') || '',
        gl: u.searchParams.get('gl') || '',
        num: u.searchParams.get('num') || ''
      };
    } catch (_) { return { q: '', hl: '', gl: '', num: '' }; }
  }

  async function loadMyDomain() {
    try {
      const st = await chrome.storage.local.get(['rs_my_domain', 'myDomain', 'settings']);
      myDomain = (st.rs_my_domain || st.myDomain || (st.settings && st.settings.myDomain) || '').replace(/^www\./, '').toLowerCase();
    } catch (_) { myDomain = ''; }
  }

  async function runScan() {
    const btn = $('psScrapeRun');
    const table = $('psScrapeTable');
    const status = $('psScrapeStatus');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    if (status) status.textContent = '';
    if (table) table.innerHTML = '<div class="ps-empty">Scanning page…</div>';
    clearChrome();
    await loadMyDomain();

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) throw new Error('No active tab');
      if (!isGoogleSerp(tab.url || '')) throw new Error('Open a Google search results page, then click Scan.');

      queryMeta = parseQuery(tab.url);
      renderQueryBar();

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/serp-scraper-engine.js']
      }).catch(() => {});

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          if (typeof RSSerpScrape !== 'function') return { error: 'Engine not loaded — reload ShahzaibSEO' };
          try {
            const data = await RSSerpScrape({ skipSettle: false });
            const metrics = {};
            const put = (dom, patch) => {
              if (!dom) return;
              const key = String(dom).replace(/^www\./, '').toLowerCase().split('/')[0];
              if (!key || !key.includes('.')) return;
              const cur = metrics[key] || {};
              // Never overwrite a real DA/DR with null; never treat spam as DA
              const next = Object.assign({}, cur);
              if (patch.da != null && patch.da >= 0 && patch.da <= 100) next.da = patch.da;
              if (patch.dr != null && patch.dr >= 0 && patch.dr <= 100) next.dr = patch.dr;
              if (patch.traffic != null) next.traffic = patch.traffic;
              if (patch.spam != null && patch.spam >= 0 && patch.spam <= 100) next.spam = patch.spam;
              metrics[key] = next;
            };

            function hostFromResultRoot(root) {
              if (!root) return '';
              const cite = root.querySelector('cite');
              if (cite) {
                const t = (cite.textContent || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
                const host = t.split(/[›»>\/\s|]/)[0].trim().toLowerCase();
                if (host && host.includes('.')) return host;
              }
              const a = root.querySelector('h3 a[href], a[href^="http"]');
              if (a) {
                try {
                  let href = a.getAttribute('href') || a.href || '';
                  if (href.includes('/url?')) {
                    const u0 = new URL(href, location.origin);
                    href = u0.searchParams.get('q') || u0.searchParams.get('url') || href;
                  }
                  return new URL(href).hostname.replace(/^www\./, '').toLowerCase();
                } catch (_) {}
              }
              return '';
            }

            // 1) ShahzaibSEO sidebar cache (authoritative when present)
            try {
              (window.__rsDomainData || []).forEach(d => {
                if (!d || !d.domain) return;
                put(d.domain, {
                  da: typeof d.da === 'number' ? d.da : null,
                  dr: typeof d.dr === 'number' ? d.dr : null,
                  traffic: d.traffic != null ? d.traffic : null,
                  spam: typeof d.spam === 'number' ? d.spam : null
                });
              });
            } catch (_) {}

            // 2) Structured ShahzaibSEO badges only — .rs-badge-label + .rs-badge-val
            //    (never free-text regex — that mixed SPAM% into DA)
            try {
              document.querySelectorAll('.rs-serp-row').forEach(row => {
                let root = row;
                for (let i = 0; i < 8 && root; i++) root = root.parentElement;
                const host = hostFromResultRoot(root);
                if (!host) return;
                const patch = {};
                row.querySelectorAll('.rs-serp-badge').forEach(badge => {
                  const label = (badge.querySelector('.rs-badge-label')?.textContent || '').trim().toUpperCase();
                  const raw = (badge.querySelector('.rs-badge-val')?.textContent || '').trim();
                  const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);
                  if (!Number.isFinite(num)) return;
                  if (label === 'DA') patch.da = num;
                  else if (label === 'DR') patch.dr = num;
                  else if (label === 'SPAM') patch.spam = num;
                  else if (label === 'TR') patch.traffic = raw;
                });
                put(host, patch);
              });
            } catch (_) {}

            // 3) Green KWScanner pills by stable IDs: rs-kws-da-N / rs-kws-dr-N / rs-kws-spam-N
            try {
              document.querySelectorAll('[id^="rs-kws-da-"], [id^="rs-kws-dr-"], [id^="rs-kws-spam-"]').forEach(el => {
                const id = el.id || '';
                const valTxt = (el.textContent || '').replace(/[^0-9.]/g, '');
                const num = parseInt(valTxt, 10);
                if (!Number.isFinite(num)) return;
                let root = el;
                for (let i = 0; i < 12 && root; i++) root = root.parentElement;
                const host = hostFromResultRoot(root);
                if (!host) return;
                if (id.indexOf('rs-kws-da-') === 0) put(host, { da: num });
                else if (id.indexOf('rs-kws-dr-') === 0) put(host, { dr: num });
                else if (id.indexOf('rs-kws-spam-') === 0) put(host, { spam: num });
              });
            } catch (_) {}

            // 3) Patch rows that still lack URL using cite on matching titles
            const patched = data.map(r => {
              if (r.url) return r;
              if (r.type !== 'Organic' && r.type !== 'Sponsored') return r;
              try {
                const h3s = document.querySelectorAll('#rso h3, #search h3');
                for (const h3 of h3s) {
                  if ((h3.textContent || '').trim().slice(0, 40) !== (r.title || '').slice(0, 40)) continue;
                  const block = h3.closest('.tF2Cxc, .MjjYud, .g, [data-hveid]') || h3.parentElement;
                  const cite = block && block.querySelector('cite');
                  if (!cite) continue;
                  let t = (cite.textContent || '').trim();
                  if (/^https?:\/\//i.test(t)) {
                    const origin = t.split(/\s*›\s*/)[0].replace(/\/+$/, '');
                    return Object.assign({}, r, { url: origin, domain: origin.replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0] });
                  }
                  const host = t.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[›»>\/\s|]/)[0].trim();
                  if (host && host.includes('.')) {
                    return Object.assign({}, r, { url: 'https://' + host, domain: host.toLowerCase() });
                  }
                }
              } catch (_) {}
              return r;
            });

            const related = patched.filter(r => r.type === 'Related Search').map(r => r.title);
            return { ok: true, rows: patched, metrics, related };
          } catch (e) {
            return { error: String(e && e.message || e) };
          }
        }
      });

      if (!result || result.error) throw new Error((result && result.error) || 'Scan failed');
      const metrics = result.metrics || {};
      const lookupMetrics = (dom) => {
        if (!dom) return {};
        const key = String(dom).replace(/^www\./, '').toLowerCase();
        if (metrics[key]) return metrics[key];
        // parent domain match (blog.semrush.com → semrush.com)
        const parts = key.split('.');
        if (parts.length > 2) {
          const parent = parts.slice(-2).join('.');
          if (metrics[parent]) return metrics[parent];
        }
        // any key that ends with this domain
        for (const k of Object.keys(metrics)) {
          if (k === key || k.endsWith('.' + key) || key.endsWith('.' + k)) return metrics[k];
        }
        return {};
      };
      rows = (result.rows || []).map(r => {
        let dom = (r.domain || '').replace(/^www\./, '').toLowerCase();
        if (!dom && r.url) {
          try { dom = new URL(r.url).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) {}
        }
        const m = lookupMetrics(dom);
        return Object.assign({}, r, {
          domain: r.domain || dom,
          da: m.da != null ? m.da : null,
          dr: m.dr != null ? m.dr : null,
          traffic: m.traffic != null ? m.traffic : null,
          spam: m.spam != null ? m.spam : null,
          isMine: myDomain && (dom === myDomain || dom.endsWith('.' + myDomain))
        });
      });
      selectedTypes = new Set();
      viewMode = 'all';
      if (status) status.textContent = rows.length ? ('Found ' + rows.length + ' results') : 'No results';
      renderComposition();
      renderStats();
      renderDifficulty();
      renderDomains();
      renderRelated(result.related || []);
      renderChips();
      renderTable();
      setExportEnabled(!!rows.length);
      syncViewBtns();
      // Save last scan locally
      try {
        await chrome.storage.local.set({
          rs_last_serp_scan: {
            ts: Date.now(),
            query: queryMeta.q,
            count: rows.length,
            rows: rows.slice(0, 100)
          }
        });
      } catch (_) {}
    } catch (e) {
      if (table) table.innerHTML = '<div class="ps-empty" style="color:#dc2626;">' + esc(e.message || String(e)) + '</div>';
      if (status) status.textContent = '';
      setExportEnabled(false);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }
    }
  }

  function clearChrome() {
    ['psCompBar','psBadges','psDomainFreq','psScrapeChips','psScrapeStats','psDifficulty','psRelated'].forEach(id => {
      const el = $(id); if (el) el.innerHTML = '';
    });
  }

  function renderQueryBar() {
    const el = $('psQueryBar');
    if (!el) return;
    if (!queryMeta.q) { el.innerHTML = ''; return; }
    const bits = ['<b style="color:#0f172a;">Query:</b> ' + esc(queryMeta.q)];
    if (queryMeta.hl) bits.push('lang <b>' + esc(queryMeta.hl) + '</b>');
    if (queryMeta.gl) bits.push('country <b>' + esc(queryMeta.gl) + '</b>');
    el.innerHTML = bits.join(' · ');
  }

  function countsByType(list) {
    const c = {};
    list.forEach(r => { c[r.type] = (c[r.type] || 0) + 1; });
    return c;
  }

  function renderComposition() {
    const bar = $('psCompBar');
    const badges = $('psBadges');
    if (!bar || !badges) return;
    bar.innerHTML = '';
    badges.innerHTML = '';
    if (!rows.length) return;
    const counts = countsByType(rows);
    const total = rows.length;
    Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(type => {
      const pct = counts[type] / total * 100;
      const color = colorFor(type);
      const seg = document.createElement('span');
      seg.style.width = Math.max(pct, 1.5) + '%';
      seg.style.background = color;
      seg.title = type + ': ' + counts[type] + ' (' + pct.toFixed(1) + '%)';
      bar.appendChild(seg);
      const badge = document.createElement('span');
      badge.className = 'ps-badge';
      badge.style.borderLeft = '3px solid ' + color;
      badge.innerHTML = '<span style="color:' + color + ';">●</span> ' + esc(shortType(type)) + ' ' + counts[type];
      badges.appendChild(badge);
    });
  }

  function renderStats() {
    const host = $('psScrapeStats');
    if (!host) return;
    if (!rows.length) { host.innerHTML = ''; return; }
    const organic = rows.filter(r => r.type === 'Organic');
    const ads = rows.filter(r => r.type === 'Sponsored' || r.type === 'Shopping');
    const domains = new Set(organic.map(r => r.domain).filter(Boolean));
    const multi = {};
    organic.forEach(r => { if (r.domain) multi[r.domain] = (multi[r.domain] || 0) + 1; });
    const multiCount = Object.values(multi).filter(n => n > 1).length;
    const noUrl = rows.filter(r => !r.url && r.type === 'Organic').length;
    host.innerHTML = [
      ['Organic', organic.length, '#34a853'],
      ['Ads', ads.length, '#ea4335'],
      ['Domains', domains.size, '#0D9488'],
      ['Multi-rank', multiCount, '#8e24aa']
    ].map(([label, val, col]) =>
      `<div class="ps-stat"><div class="ps-stat-val" style="color:${col}">${val}</div><div class="ps-stat-label">${label}</div></div>`
    ).join('');
    let warn = document.getElementById('psScrapeWarn');
    if (!warn) {
      warn = document.createElement('div');
      warn.id = 'psScrapeWarn';
      host.insertAdjacentElement('afterend', warn);
    }
    if (noUrl) {
      warn.className = 'ps-warn';
      warn.textContent = noUrl + ' organic result' + (noUrl > 1 ? 's' : '') + ' missing recovered URL';
    } else {
      warn.className = '';
      warn.textContent = '';
    }
  }

  function renderDifficulty() {
    const host = $('psDifficulty');
    if (!host) return;
    const organic = rows.filter(r => r.type === 'Organic');
    const withDa = organic.filter(r => typeof r.da === 'number');
    const withDr = organic.filter(r => typeof r.dr === 'number');
    if (!organic.length) { host.innerHTML = ''; return; }

    let html = '<div class="ps-diff-inner">';
    if (withDa.length) {
      const avg = Math.round(withDa.reduce((s, r) => s + r.da, 0) / withDa.length);
      const min = Math.min(...withDa.map(r => r.da));
      const label = avg < 20 ? 'Easy' : avg < 40 ? 'Moderate' : avg < 60 ? 'Hard' : 'Very Hard';
      const col = avg < 20 ? '#16a34a' : avg < 40 ? '#ca8a04' : avg < 60 ? '#ea580c' : '#dc2626';
      html += `<span class="ps-diff-pill" style="background:${col}14;color:${col};border-color:${col}33;">
        <span style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0;"></span>
        ${label} · avg DA <b>${avg}</b> · min <b>${min}</b>
      </span>`;
    } else if (withDr.length) {
      const avg = Math.round(withDr.reduce((s, r) => s + r.dr, 0) / withDr.length);
      html += `<span class="ps-diff-pill" style="background:#f8fafc;color:#64748b;border-color:#e2e8f0;">Avg DR ${avg} · DA loading…</span>`;
    }
    const types = new Set(rows.map(r => r.type));
    const features = [
      ['AI Overview', types.has('AI Overview')],
      ['Featured Snippet', types.has('Featured Snippet')],
      ['PAA', types.has('People Also Ask') || types.has('PAA')],
      ['Local', types.has('Local Pack')],
      ['Video', types.has('Video')],
      ['Ads', types.has('Sponsored') || types.has('Shopping')]
    ];
    // Only show present features prominently; absent as muted
    html += '<div class="ps-feat-row">' + features.map(([name, on]) =>
      `<span class="ps-feat ${on ? 'on' : 'off'}" title="${on ? 'Present on this SERP' : 'Not detected'}">${on ? '●' : '○'} ${name}</span>`
    ).join('') + '</div>';
    html += '</div>';
    host.innerHTML = html;
  }

  function renderDomains() {
    const host = $('psDomainFreq');
    if (!host) return;
    const freq = {};
    rows.filter(r => r.type === 'Organic' || r.type === 'Sponsored').forEach(r => {
      const d = r.domain;
      if (!d) return;
      freq[d] = (freq[d] || 0) + 1;
    });
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!top.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<b>Top domains:</b> ' + top.map(([d, n]) => {
      const mine = myDomain && d === myDomain;
      return `<span style="${mine ? 'background:#d1fae5;padding:1px 6px;border-radius:4px;font-weight:700;' : ''}">${esc(d)}${n > 1 ? ' <span style="color:#0D9488;font-weight:700;">(' + n + ')</span>' : ''}${mine ? ' ← you' : ''}</span>`;
    }).join(' · ');
  }

  function renderRelated(related) {
    const host = $('psRelated');
    if (!host) return;
    const list = related && related.length ? related : rows.filter(r => r.type === 'Related Search').map(r => r.title);
    if (!list.length) { host.style.display = 'none'; host.innerHTML = ''; return; }
    host.style.display = 'block';
    host.innerHTML = '<div class="ps-related-label">Related searches — click to open</div><div class="ps-related-chips">' +
      list.slice(0, 12).map(t =>
        `<button type="button" class="ps-related-chip" data-q="${esc(t)}">${esc(t)}</button>`
      ).join('') + '</div>';
    host.querySelectorAll('.ps-related-chip').forEach(btn => {
      btn.addEventListener('click', async () => {
        const q = btn.getAttribute('data-q');
        if (!q) return;
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs && tabs[0];
        if (!tab) return;
        try {
          const u = new URL(tab.url);
          u.searchParams.set('q', q);
          chrome.tabs.update(tab.id, { url: u.toString() });
        } catch (_) {
          chrome.tabs.create({ url: 'https://www.google.com/search?q=' + encodeURIComponent(q) });
        }
      });
    });
  }

  function renderChips() {
    const host = $('psScrapeChips');
    if (!host) return;
    const counts = countsByType(rows);
    const types = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (!types.length) { host.innerHTML = ''; return; }
    host.innerHTML = types.map(ty => {
      const col = colorFor(ty);
      const on = selectedTypes.size === 0 || selectedTypes.has(ty);
      const active = selectedTypes.size > 0 && on;
      return `<button type="button" class="ps-chip${active ? ' active' : ''}" data-type="${esc(ty)}" style="--chip-color:${col}">${esc(shortType(ty))}</button>`;
    }).join('');
    host.querySelectorAll('.ps-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const ty = btn.getAttribute('data-type');
        const counts2 = countsByType(rows);
        if (selectedTypes.size === 0) selectedTypes = new Set(Object.keys(counts2));
        if (selectedTypes.has(ty)) selectedTypes.delete(ty);
        else selectedTypes.add(ty);
        if (selectedTypes.size === 0 || selectedTypes.size === Object.keys(counts2).length) selectedTypes = new Set();
        renderChips();
        renderTable();
      });
    });
  }

  function filteredRows() {
    const q = ($('psScrapeFilter')?.value || '').trim().toLowerCase();
    let list = rows.filter(r => {
      if (selectedTypes.size && !selectedTypes.has(r.type)) return false;
      if (viewMode === 'organic' && r.type !== 'Organic') return false;
      if (!q) return true;
      return (r.title || '').toLowerCase().includes(q) ||
             (r.url || '').toLowerCase().includes(q) ||
             (r.type || '').toLowerCase().includes(q) ||
             (r.domain || '').toLowerCase().includes(q) ||
             (r.snippet || '').toLowerCase().includes(q);
    });

    list = list.slice().sort((a, b) => {
      let av, bv;
      if (sortKey === 'da') { av = a.da ?? -1; bv = b.da ?? -1; }
      else if (sortKey === 'dr') { av = a.dr ?? -1; bv = b.dr ?? -1; }
      else if (sortKey === 'title') { av = (a.title || '').toLowerCase(); bv = (b.title || '').toLowerCase(); return av < bv ? -sortDir : av > bv ? sortDir : 0; }
      else if (sortKey === 'domain') { av = (a.domain || '').toLowerCase(); bv = (b.domain || '').toLowerCase(); return av < bv ? -sortDir : av > bv ? sortDir : 0; }
      else { av = a.position; bv = b.position; }
      return (av - bv) * sortDir;
    });
    return list;
  }

  function renderTable() {
    const table = $('psScrapeTable');
    if (!table) return;
    if (viewMode === 'domains') { renderDomainView(table); return; }

    const list = filteredRows();
    if (!rows.length) {
      table.innerHTML = '<div class="ps-empty">Open a Google search results page, then click <b>Scan</b>.</div>';
      return;
    }
    if (!list.length) {
      table.innerHTML = '<div class="ps-empty">No matches for filter / chips.</div>';
      return;
    }

    const showMetrics = list.some(r => r.da != null || r.dr != null);
    table.innerHTML = `<table>
      <thead><tr>
        <th class="col-pos sortable" data-sort="position">#</th>
        <th>Type</th>
        <th class="sortable" data-sort="title">Title</th>
        ${showMetrics ? '<th class="sortable" data-sort="da">DA</th><th class="sortable" data-sort="dr">DR</th>' : ''}
        <th class="sortable" data-sort="domain">URL</th>
      </tr></thead>
      <tbody>${list.map(r => {
        const col = colorFor(r.type);
        const short = (r.url || '').replace(/^https?:\/\//, '').replace(/^www\./, '');
        const urlCell = r.url
          ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.url)}">${esc(short.slice(0, 48))}${short.length > 48 ? '…' : ''}</a>`
          : '—';
        const sn = (showSnippets && r.snippet)
          ? `<div style="font-size:10px;color:#64748b;margin-top:2px;line-height:1.35;">${esc(r.snippet)}</div>` : '';
        const metrics = showMetrics
          ? `<td style="text-align:center;color:#64748b;">${r.da != null ? r.da : '—'}</td>
             <td style="text-align:center;color:#64748b;">${r.dr != null ? r.dr : '—'}</td>` : '';
        const rowBg = r.isMine ? 'background:#ecfdf5;' : '';
        return `<tr style="${rowBg}">
          <td class="col-pos">${r.position}${r.isMine ? ' ★' : ''}</td>
          <td class="col-type" style="color:${col}">${esc(shortType(r.type))}</td>
          <td>${esc(r.title)}${sn}</td>
          ${metrics}
          <td class="col-url">${urlCell}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;

    table.querySelectorAll('th.sortable').forEach(th => {
      th.style.cursor = 'pointer';
      th.title = 'Click to sort';
      th.addEventListener('click', () => {
        const k = th.getAttribute('data-sort');
        if (sortKey === k) sortDir *= -1;
        else { sortKey = k; sortDir = 1; }
        renderTable();
      });
    });
  }

  function renderDomainView(table) {
    const organic = rows.filter(r => r.type === 'Organic' && r.domain);
    const map = {};
    organic.forEach(r => {
      if (!map[r.domain]) map[r.domain] = { domain: r.domain, count: 0, positions: [], da: r.da, dr: r.dr, isMine: r.isMine };
      map[r.domain].count++;
      map[r.domain].positions.push(r.position);
      if (r.da != null) map[r.domain].da = r.da;
      if (r.dr != null) map[r.domain].dr = r.dr;
    });
    const list = Object.values(map).sort((a, b) => a.positions[0] - b.positions[0]);
    if (!list.length) {
      table.innerHTML = '<div class="ps-empty">No organic domains found.</div>';
      return;
    }
    table.innerHTML = `<table>
      <thead><tr><th>Domain</th><th>Count</th><th>Positions</th><th>DA</th><th>DR</th><th></th></tr></thead>
      <tbody>${list.map(d => `<tr style="${d.isMine ? 'background:#ecfdf5;' : ''}">
        <td><a href="https://${esc(d.domain)}" target="_blank" rel="noopener" style="color:#0D9488;text-decoration:none;font-weight:600;">${esc(d.domain)}${d.isMine ? ' ★' : ''}</a></td>
        <td style="text-align:center;font-weight:700;color:${d.count > 1 ? '#8e24aa' : '#64748b'}">${d.count}</td>
        <td style="color:#64748b;">${d.positions.join(', ')}</td>
        <td style="text-align:center;">${d.da != null ? d.da : '—'}</td>
        <td style="text-align:center;">${d.dr != null ? d.dr : '—'}</td>
        <td style="white-space:nowrap;">
          <a href="https://web.archive.org/web/*/${esc(d.domain)}" target="_blank" rel="noopener" style="font-size:10px;color:#64748b;" title="Wayback">WB</a>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  function setExportEnabled(on) {
    ['psScrapeCopy','psScrapeCsv','psScrapeJson','psScrapeMd','psScrapeCopyUrls','psScrapeCopyDomains'].forEach(id => {
      const b = $(id); if (b) b.disabled = !on;
    });
  }

  function syncViewBtns() {
    document.querySelectorAll('.ps-view-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-view') === viewMode);
    });
  }

  function download(name, content, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function flash(id, text) {
    const btn = $(id);
    if (!btn) return;
    const t = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = t; }, 1400);
  }

  function exportFmt(fmt) {
    const list = viewMode === 'domains' ? rows.filter(r => r.type === 'Organic') : filteredRows();
    if (!list.length) return;
    if (fmt === 'copy') {
      const lines = list.map(r => [r.position, r.type, r.title, r.url, r.domain || '', r.da ?? '', r.dr ?? ''].join(' | ')).join('\n');
      navigator.clipboard.writeText(lines).then(() => flash('psScrapeCopy', 'Copied!'));
      return;
    }
    if (fmt === 'urls') {
      navigator.clipboard.writeText([...new Set(list.map(r => r.url).filter(Boolean))].join('\n')).then(() => flash('psScrapeCopyUrls', 'Copied!'));
      return;
    }
    if (fmt === 'domains') {
      navigator.clipboard.writeText([...new Set(list.map(r => r.domain).filter(Boolean))].join('\n')).then(() => flash('psScrapeCopyDomains', 'Copied!'));
      return;
    }
    if (fmt === 'csv') {
      const escC = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const header = 'Position,Type,Title,URL,Domain,DA,DR,Snippet,Query';
      const lines = [header].concat(list.map(r =>
        [r.position, r.type, r.title, r.url, r.domain || '', r.da ?? '', r.dr ?? '', r.snippet || '', queryMeta.q].map(escC).join(',')
      ));
      download('serp_' + (queryMeta.q || 'results').replace(/\W+/g, '_').slice(0, 40) + '.csv', lines.join('\n'), 'text/csv');
      return;
    }
    if (fmt === 'json') {
      download('serp_results.json', JSON.stringify({ query: queryMeta, scannedAt: new Date().toISOString(), results: list }, null, 2), 'application/json');
      return;
    }
    if (fmt === 'md') {
      const lines = [
        '# SERP: ' + (queryMeta.q || 'results'),
        '',
        '- Scanned: ' + new Date().toISOString(),
        '- Results: ' + list.length,
        '',
        '| # | Type | Title | Domain | DA | DR | URL |',
        '|---|---|---|---|---|---|---|'
      ].concat(list.map(r =>
        `| ${r.position} | ${r.type} | ${String(r.title||'').replace(/\|/g,'\\|')} | ${r.domain||''} | ${r.da??''} | ${r.dr??''} | ${r.url||''} |`
      ));
      download('serp_results.md', lines.join('\n'), 'text/markdown');
    }
  }


  function bind() {
    if (!$('psScrapeRun')) return;
    $('psScrapeRun').addEventListener('click', runScan);
    $('psScrapeCopy')?.addEventListener('click', () => exportFmt('copy'));
    $('psScrapeCopyUrls')?.addEventListener('click', () => exportFmt('urls'));
    $('psScrapeCopyDomains')?.addEventListener('click', () => exportFmt('domains'));
    $('psScrapeCsv')?.addEventListener('click', () => exportFmt('csv'));
    $('psScrapeJson')?.addEventListener('click', () => exportFmt('json'));
    $('psScrapeMd')?.addEventListener('click', () => exportFmt('md'));
    $('psScrapeFilter')?.addEventListener('input', renderTable);
    $('psShowSnippets')?.addEventListener('change', (e) => {
      showSnippets = !!e.target.checked;
      renderTable();
    });
    document.querySelectorAll('.ps-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        viewMode = btn.getAttribute('data-view') || 'all';
        syncViewBtns();
        renderTable();
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
