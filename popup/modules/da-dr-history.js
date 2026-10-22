/**
 * DA / DR history — local snapshots per domain (chrome.storage.local)
 */
(function () {
  'use strict';
  const KEY = 'rankseo_da_dr_history_v1';
  const MAX_POINTS = 60;

  function $(id) { return document.getElementById(id); }

  function rootDomain(host) {
    let h = String(host || '').trim().toLowerCase();
    if (!h) return '';
    // Accept full URL
    try {
      if (/^https?:\/\//i.test(h)) h = new URL(h).hostname;
    } catch (_) {}
    h = h.replace(/^www\./i, '').split('/')[0].split('?')[0];
    return h;
  }

  function loadAll() {
    return new Promise(res => {
      try {
        chrome.storage.local.get([KEY], r => res((r && r[KEY]) || {}));
      } catch (_) {
        res({});
      }
    });
  }

  function saveAll(map) {
    return new Promise(res => {
      try {
        chrome.storage.local.set({ [KEY]: map }, () => res());
      } catch (_) {
        res();
      }
    });
  }

  /** Resolve domain key variants so www / bare / trailing match same history */
  function domainKeys(domain) {
    const d = rootDomain(domain);
    if (!d) return [];
    const keys = new Set([d]);
    if (d.startsWith('www.')) keys.add(d.replace(/^www\./, ''));
    else keys.add('www.' + d);
    return [...keys];
  }

  async function getPointsForDomain(domain) {
    const all = await loadAll();
    const keys = domainKeys(domain);
    let best = null;
    for (const k of keys) {
      const entry = all[k];
      if (entry && Array.isArray(entry.points) && entry.points.length) {
        if (!best || entry.points.length > best.points.length) best = entry;
      }
    }
    return best ? best.points.slice().sort((a, b) => a.ts - b.ts) : [];
  }

  async function record(domain, { da, dr, spam, rd, forceNew }) {
    domain = rootDomain(domain);
    if (!domain) return;

    const all = await loadAll();
    // Prefer existing key that already has points (avoid splitting history)
    let storageKey = domain;
    for (const k of domainKeys(domain)) {
      if (all[k]?.points?.length) {
        storageKey = k;
        break;
      }
    }

    const entry = all[storageKey] || { points: [] };
    const last = entry.points[entry.points.length - 1];
    const now = Date.now();

    // Within 6 hours: merge into last point (fill missing DA/DR, update values)
    // forceNew=true (Refresh button) always appends a new row
    if (!forceNew && last && (now - last.ts) < 6 * 3600 * 1000) {
      let changed = false;
      if (da != null && last.da !== da) { last.da = da; changed = true; }
      if (dr != null && last.dr !== dr) { last.dr = dr; changed = true; }
      if (spam != null) { last.spam = spam; changed = true; }
      if (rd != null) { last.rd = rd; changed = true; }
      if (da != null && last.da == null) { last.da = da; changed = true; }
      if (dr != null && last.dr == null) { last.dr = dr; changed = true; }
      if (changed) {
        all[storageKey] = entry;
        await saveAll(all);
      }
      return;
    }

    const point = { ts: now };
    if (da != null) point.da = da;
    if (dr != null) point.dr = dr;
    if (spam != null) point.spam = spam;
    if (rd != null) point.rd = rd;
    // Carry forward previous metric if only one side fetched this run
    if (point.da == null && last?.da != null) point.da = last.da;
    if (point.dr == null && last?.dr != null) point.dr = last.dr;

    entry.points.push(point);
    if (entry.points.length > MAX_POINTS) entry.points = entry.points.slice(-MAX_POINTS);
    all[storageKey] = entry;
    for (const k of domainKeys(domain)) {
      if (k !== storageKey && all[k] && (!all[k].points || !all[k].points.length)) delete all[k];
    }
    await saveAll(all);
  }

  function fmtDelta(d) {
    if (d == null) return '—';
    const col = d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : '#94a3b8';
    const sign = d > 0 ? '+' : '';
    return `<span style="color:${col};font-weight:600;">${sign}${d}</span>`;
  }

  function sparkline(points, key, color) {
    const vals = points.map(p => p[key]).filter(v => v != null && !Number.isNaN(Number(v))).map(Number);
    if (vals.length < 2) {
      return `<div style="flex:1;height:40px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;">Need 2+ snapshots for chart</div>`;
    }
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const span = Math.max(max - min, 1);
    return vals.map(v => {
      const h = Math.max(4, Math.round(((v - min) / span) * 48));
      return `<div title="${key.toUpperCase()}: ${v}" style="flex:1;min-width:4px;height:${h}px;background:${color};border-radius:2px 2px 0 0;opacity:0.85;"></div>`;
    }).join('');
  }

  async function getEntryForDomain(domain) {
    const all = await loadAll();
    const keys = domainKeys(domain);
    let best = null;
    for (const k of keys) {
      const entry = all[k];
      if (!entry) continue;
      const score = (entry.points?.length || 0) + (entry.apiHistory?.length || 0) * 10;
      if (!best || score > best._score) best = Object.assign({ _score: score }, entry);
    }
    return best;
  }

  async function render(domain) {
    domain = rootDomain(domain);
    const body = $('daHistoryBody');
    const chart = $('daHistoryChart');
    if (!body) return;

    if (!domain) {
      body.innerHTML = `<tr><td colspan="5" style="padding:12px;color:var(--text-3);text-align:center;">Open a page analysis first</td></tr>`;
      return;
    }

    const entry = await getEntryForDomain(domain);
    const points = (entry?.points || []).slice().sort((a, b) => a.ts - b.ts);
    const apiHist = entry?.apiHistory || [];

    // API monthly chart container (above local sparklines)
    let apiChartHtml = '';
    if (apiHist.length >= 2) {
      apiChartHtml = renderApiMonthlyChart(apiHist);
    }

    if (!points.length && !apiHist.length) {
      body.innerHTML = `<tr><td colspan="5" style="padding:12px;color:var(--text-3);text-align:center;">Fetch DA/DR once to start history</td></tr>`;
      if (chart) chart.innerHTML = apiChartHtml || '';
      if ($('daHistDaLatest')) $('daHistDaLatest').textContent = '—';
      if ($('daHistDrLatest')) $('daHistDrLatest').textContent = '—';
      if ($('daHistDaDelta')) $('daHistDaDelta').textContent = 'No history yet';
      if ($('daHistDrDelta')) $('daHistDrDelta').textContent = 'No history yet';
      return;
    }

    const latest = points.length ? points[points.length - 1] : null;
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const apiLatest = apiHist.length ? apiHist[apiHist.length - 1] : null;
    const apiPrev = apiHist.length > 1 ? apiHist[apiHist.length - 2] : null;

    const showDa = latest?.da != null ? latest.da : apiLatest;
    const showDr = latest?.dr != null ? latest.dr : null;

    if ($('daHistDaLatest')) $('daHistDaLatest').textContent = showDa != null ? showDa : '—';
    if ($('daHistDrLatest')) $('daHistDrLatest').textContent = showDr != null ? showDr : '—';
    if ($('daHistDaDelta')) {
      let d = null;
      if (prev && latest?.da != null && prev.da != null) d = latest.da - prev.da;
      else if (apiPrev != null && apiLatest != null) d = apiLatest - apiPrev;
      $('daHistDaDelta').innerHTML = d == null
        ? (apiHist.length ? 'API history loaded' : (points.length === 1 ? 'Baseline snapshot' : '—'))
        : fmtDelta(d) + (apiHist.length && !(prev && latest?.da != null) ? ' vs prior month' : ' vs previous');
    }
    if ($('daHistDrDelta')) {
      const d = prev && latest?.dr != null && prev.dr != null
        ? Math.round((latest.dr - prev.dr) * 10) / 10
        : null;
      $('daHistDrDelta').innerHTML = d == null
        ? (points.length <= 1 ? 'Baseline snapshot' : '—')
        : fmtDelta(d) + ' vs previous';
    }

    if (chart) {
      const localSparks = points.length
        ? `<div style="display:flex;gap:6px;margin-top:${apiChartHtml ? '6px' : '0'};">
            <div style="flex:1;display:flex;align-items:flex-end;gap:2px;padding-right:6px;border-right:1px solid var(--border-1,#e2e8f0);">${sparkline(points, 'da', '#0D9488')}</div>
            <div style="flex:1;display:flex;align-items:flex-end;gap:2px;padding-left:6px;">${sparkline(points, 'dr', '#FF642B')}</div>
          </div>`
        : '';
      chart.innerHTML = apiChartHtml + localSparks;
      chart.style.height = 'auto';
      chart.style.display = 'block';
    }

    const rows = points.slice().reverse().map((p, i, arr) => {
      const older = arr[i + 1];
      const dDa = older && p.da != null && older.da != null ? p.da - older.da : null;
      const dDr = older && p.dr != null && older.dr != null
        ? Math.round((p.dr - older.dr) * 10) / 10
        : null;
      const date = new Date(p.ts).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      return `<tr style="border-bottom:1px solid var(--border-1,#e2e8f0);">
        <td style="padding:6px 8px;color:var(--text-3);">${date}</td>
        <td style="padding:6px 8px;font-weight:700;color:#0D9488;">${p.da ?? '—'}</td>
        <td style="padding:6px 8px;">${fmtDelta(dDa)}</td>
        <td style="padding:6px 8px;font-weight:700;color:#FF642B;">${p.dr ?? '—'}</td>
        <td style="padding:6px 8px;">${fmtDelta(dDr)}</td>
      </tr>`;
    }).join('');
    body.innerHTML = rows;
  }

  async function setApiHistory(domain, values, currentDa) {
    domain = rootDomain(domain);
    if (!domain || !Array.isArray(values) || !values.length) return;
    const all = await loadAll();
    let storageKey = domain;
    for (const k of domainKeys(domain)) {
      if (all[k]?.points?.length || all[k]?.apiHistory) { storageKey = k; break; }
    }
    const entry = all[storageKey] || { points: [] };
    entry.apiHistory = values.map(v => Number(v)).filter(v => !Number.isNaN(v));
    entry.apiHistoryTs = Date.now();
    if (currentDa != null) {
      const last = entry.points[entry.points.length - 1];
      const now = Date.now();
      if (last && (now - last.ts) < 6 * 3600 * 1000) {
        last.da = Number(currentDa);
      } else if (!last || last.da !== Number(currentDa)) {
        const point = { ts: now, da: Number(currentDa) };
        if (last?.dr != null) point.dr = last.dr;
        entry.points.push(point);
        if (entry.points.length > MAX_POINTS) entry.points = entry.points.slice(-MAX_POINTS);
      }
    }
    all[storageKey] = entry;
    await saveAll(all);
    render(domain);
  }

  function renderApiMonthlyChart(values) {
    if (!values || values.length < 2) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const now = new Date();
    // values are oldest → newest typically; label last N months ending this month
    const n = values.length;
    const labels = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
      labels.push(months[d.getMonth()]);
    }
    const max = Math.max(...values, 1);
    const bars = values.map((v, i) => {
      const h = Math.max(6, Math.round((v / max) * 56));
      const isLast = i === n - 1;
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;">
        <span style="font-size:9px;font-weight:700;color:${isLast ? '#0D9488' : '#64748b'};">${v}</span>
        <div title="DA ${v}" style="width:100%;max-width:18px;height:${h}px;background:${isLast ? '#0D9488' : '#a78bfa'};border-radius:3px 3px 0 0;opacity:${isLast ? 1 : 0.75};"></div>
      </div>`;
    }).join('');
    const first = labels[0];
    const mid = labels[Math.floor(n / 2)];
    const last = labels[n - 1];
    return `<div style="margin:8px 0 10px;padding:12px 10px 8px;background:var(--surface1,#f8fafc);border:1px solid var(--border,#e4e8ec);border-radius:10px;">
      <div style="font-size:11px;font-weight:600;color:var(--text-2,#374151);margin-bottom:8px;">Domain Authority History <span style="font-weight:500;color:#94a3b8;">(API · monthly)</span></div>
      <div style="display:flex;align-items:flex-end;gap:3px;height:72px;">${bars}</div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:9px;color:#94a3b8;">
        <span>${first}</span><span>${mid}</span><span>${last}</span>
      </div>
    </div>`;
  }

  window.ShahzaibSEOHistory = {
    recordDa(domain, da, extra) {
      return record(domain, Object.assign({ da }, extra || {})).then(() => render(domain));
    },
    recordDr(domain, dr) {
      return record(domain, { dr }).then(() => render(domain));
    },
    recordBoth(domain, data) {
      return record(domain, data || {}).then(() => render(domain));
    },
    setApiHistory,
    render
  };

  function currentDomain() {
    if (window._currentDomain) return rootDomain(window._currentDomain);
    try {
      const candidates = [
        document.getElementById('rtDomain'),
        document.querySelector('.rt-domain'),
        document.getElementById('qDomain'),
        document.querySelector('[data-domain]'),
        document.querySelector('.domain-name')
      ];
      for (const el of candidates) {
        if (!el) continue;
        const t = (el.textContent || el.getAttribute('data-domain') || '').trim();
        if (t && t !== '—' && t !== '--' && t.length > 2) return rootDomain(t);
      }
      // URL chip in header (e.g. ahrefs.com)
      const hostChip = document.querySelector('.topbar-domain, .page-host, #pageHost');
      if (hostChip && hostChip.textContent) return rootDomain(hostChip.textContent);
    } catch (_) {}
    return null;
  }

  function bindTabRerender() {
    // Sidebar DA & DR tab
    document.querySelectorAll('[data-tab="da"], [data-nav="da"], a[href="#da"], .nav-item').forEach(btn => {
      if (btn.dataset.daHistBound) return;
      const label = (btn.textContent || '').toLowerCase();
      const isDa = btn.getAttribute('data-tab') === 'da' ||
        btn.getAttribute('data-nav') === 'da' ||
        label.includes('da') && label.includes('dr');
      if (!isDa && !btn.getAttribute('data-tab')) return;
      btn.dataset.daHistBound = '1';
      btn.addEventListener('click', () => {
        setTimeout(() => {
          const d = currentDomain();
          if (d) render(d);
        }, 100);
      });
    });
  }

  function refreshSnapshot() {
    const domain = currentDomain();
    if (!domain) {
      if (typeof toast === 'function') toast('No domain — analyze a page first');
      return;
    }
    const btn = $('daHistoryRefreshBtn');
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.textContent = '…';
    }
    if ($('daHistDaDelta')) $('daHistDaDelta').textContent = 'Refreshing…';
    if ($('daHistDrDelta')) $('daHistDrDelta').textContent = 'Refreshing…';

    const payload = { da: null, dr: null, spam: null, rd: null };
    let pending = 2;
    const done = () => {
      pending--;
      if (pending > 0) return;
      const finish = () => {
        render(domain);
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '';
          btn.textContent = '↻';
        }
        if (typeof toast === 'function') toast('History updated for ' + domain);
      };
      const p = record(domain, {
        da: payload.da != null ? payload.da : undefined,
        dr: payload.dr != null ? payload.dr : undefined,
        spam: payload.spam != null ? payload.spam : undefined,
        rd: payload.rd != null ? payload.rd : undefined,
        forceNew: true
      });
      if (payload.daHistoryValues && payload.daHistoryValues.length) {
        Promise.all([p, setApiHistory(domain, payload.daHistoryValues, payload.da)]).then(finish);
      } else {
        p.then(finish);
      }
    };

    try {
      chrome.runtime.sendMessage({ action: 'MOZ_FETCH', domain }, r => {
        if (r && (r.ok !== false) && r.domainAuthority != null) {
          payload.da = Number(r.domainAuthority);
          if (r.spamScore != null) payload.spam = Number(r.spamScore);
          if (r.referringDomains != null) payload.rd = Number(r.referringDomains);
          if (Array.isArray(r.daHistoryValues) && r.daHistoryValues.length) {
            payload.daHistoryValues = r.daHistoryValues;
          }
        }
        done();
      });
    } catch (_) { done(); }

    try {
      chrome.runtime.sendMessage({ action: 'AHREFS_DR_FETCH', domain, forceRefresh: true }, r => {
        if (r?.ok && r.domainRating != null) {
          payload.dr = Math.round(Number(r.domainRating) * 10) / 10;
        } else if (r && !r.ok) {
          payload.drError = r.error || (r.needKey ? 'no_api_key' : 'unavailable');
        }
        done();
      });
    } catch (_) { done(); }
  }

  function init() {
    const clearBtn = $('daHistoryClearBtn');
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = '1';
      clearBtn.addEventListener('click', async () => {
        const domain = currentDomain();
        if (!domain) return;
        const all = await loadAll();
        for (const k of domainKeys(domain)) delete all[k];
        await saveAll(all);
        render(domain);
      });
    }

    const refreshBtn = $('daHistoryRefreshBtn');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', refreshSnapshot);
    }

    bindTabRerender();

    // Re-render when domain is known (analysis may finish after module init)
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      const d = currentDomain();
      if (d) {
        render(d);
        if (tries > 3) clearInterval(poll);
      }
      if (tries > 20) clearInterval(poll);
    }, 400);

    // storage changes from other popup instances
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[KEY]) return;
        const d = currentDomain();
        if (d) render(d);
      });
    } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
