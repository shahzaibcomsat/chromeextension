/**
 * ShahzaibSEO Multi SERP — cloned flow from SERP Scraper extension
 * Reads chrome.storage.local directly (same as original SERP popup).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'rs_serp_multi_results';
  const PAGES_KEY = 'rs_serp_multi_pages';
  const AIO_KEY = 'rs_serp_multi_aio';
  const AUTO_KEY = 'rs_serp_auto_state';

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let pollTimer = null;

  function showMessage(text, type) {
    const el = $('msMsg');
    if (!el) return;
    if (!text) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'block';
    el.textContent = text;
    const colors = {
      success: { bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0' },
      error: { bg: '#fef2f2', color: '#991b1b', border: '#fecaca' },
      info: { bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' }
    };
    const c = colors[type] || colors.info;
    el.style.background = c.bg;
    el.style.color = c.color;
    el.style.border = '1px solid ' + c.border;
  }


  function normalizePositions(results) {
    return (results || []).map((r, i) => {
      const page = Math.max(1, Number(r.page) || 1);
      const local = Math.max(1, Number(r.localPosition || r.position) || ((i % 10) + 1));
      return { ...r, localPosition: local, globalPosition: ((page - 1) * 10) + local };
    });
  }

  async function getStored() {
    const data = await chrome.storage.local.get([STORAGE_KEY, PAGES_KEY, AIO_KEY]);
    return {
      results: normalizePositions(data[STORAGE_KEY] || []),
      pages: data[PAGES_KEY] || [],
      aioResults: data[AIO_KEY] || []
    };
  }

  function renderTable(results, aioResults) {
    const empty = $('msEmpty');
    const table = $('msTable');
    const tbody = $('msTbody');
    if (!tbody) return;

    const rows = [];
    (aioResults || []).forEach((a) => {
      rows.push({
        position: 'AIO',
        page: a.page || '',
        title: String(a.text || a.answerText || '').slice(0, 140),
        url: (a.citations && a.citations[0] && a.citations[0].url) || '',
        domain: 'AI Overview',
        snippet: String(a.text || a.answerText || '').slice(0, 200)
      });
    });
    (results || []).forEach((r, i) => {
      rows.push({
        position: r.globalPosition || r.position || i + 1,
        page: r.page || '',
        title: r.title || '',
        url: r.url || '',
        domain: r.domain || '',
        snippet: r.snippet || r.description || r.breadcrumb || ''
      });
    });

    const has = rows.length > 0;
    if (empty) empty.style.display = has ? 'none' : 'block';
    if (table) table.hidden = !has;

    if (!has) {
      tbody.innerHTML = '';
    } else {
      tbody.innerHTML = rows
        .map((r) => {
          const displayUrl = String(r.url || '');
          // Prefer clean URL text; truncate long paths for readability
          let urlLabel = displayUrl;
          try {
            if (/^https?:\/\//i.test(displayUrl) && displayUrl.indexOf('/goto') === -1) {
              const u = new URL(displayUrl);
              urlLabel = u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname);
              if (urlLabel.length > 48) urlLabel = urlLabel.slice(0, 45) + '…';
            } else if (displayUrl.length > 48) {
              urlLabel = displayUrl.slice(0, 45) + '…';
            }
          } catch (_) {
            if (urlLabel.length > 48) urlLabel = urlLabel.slice(0, 45) + '…';
          }
          const link = displayUrl
            ? `<a href="${esc(displayUrl)}" target="_blank" rel="noopener" title="${esc(displayUrl)}">${esc(urlLabel)}</a>`
            : '—';
          const title = String(r.title || '').trim() || '—';
          const snip = String(r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 120);
          return `<tr>
            <td class="col-pos">${esc(r.position)}</td>
            <td class="col-page">${esc(r.page)}</td>
            <td class="col-title" title="${esc(title)}">${esc(title)}</td>
            <td class="col-url">${link}</td>
            <td class="col-domain">${esc(r.domain || '—')}</td>
            <td class="col-snip" title="${esc(snip)}">${esc(snip || '—')}</td>
          </tr>`;
        })
        .join('');
    }

    const dis = !has;
    if ($('msExcel')) $('msExcel').disabled = dis;
    if ($('msCsv')) $('msCsv').disabled = dis;
    if ($('msJson')) $('msJson').disabled = dis;
  }

  async function refreshStats() {
    const { results, pages, aioResults } = await getStored();
    if ($('msStatResults')) $('msStatResults').textContent = String(results.length);
    if ($('msStatPages')) $('msStatPages').textContent = String(pages.length);
    if ($('msStatAio')) $('msStatAio').textContent = String(aioResults.length);
    renderTable(results, aioResults);
    return { results, pages, aioResults };
  }

  function renderAutoState(state) {
    const active = !!(state && state.active);
    const prog = $('msProgress');
    const fill = $('msProgressFill');
    const label = $('msProgressLabel');
    const startBtn = $('msStart');
    const stopBtn = $('msStop');
    const oneBtn = $('msScrapeOne');
    const pagesSel = $('msPages');

    if (prog) {
      prog.style.display = active ? 'block' : 'none';
      prog.hidden = !active;
    }
    if (stopBtn) {
      stopBtn.hidden = !active;
      stopBtn.style.display = active ? 'inline-block' : 'none';
      stopBtn.disabled = false;
    }
    if (startBtn) {
      startBtn.disabled = active;
      startBtn.textContent = active ? 'Auto-scraping…' : '▶ Auto-Scrape';
    }
    if (oneBtn) oneBtn.disabled = active;
    if (pagesSel) pagesSel.disabled = active;

    if (active && state) {
      const total = state.targetPages || 10;
      const done = state.scrapedCount || 0;
      const cur = Math.min(Math.max(state.currentPage || 1, 1), total);
      if (label) label.textContent = `Scraping page ${cur} of ${total}… (${done} done)`;
      if (fill) fill.style.width = Math.min(100, Math.round((done / total) * 100)) + '%';
    }

    if (state && state.done && !state.active) {
      if (state.finishReason === 'completed') {
        showMessage(
          `Done! Scraped ${state.scrapedCount || 0} page(s). Download Excel below.`,
          'success'
        );
      } else if (state.finishReason === 'stopped') {
        showMessage('Auto-scrape stopped. You can download what was collected.', 'info');
      } else if (state.finishReason === 'error') {
        showMessage('Auto-scrape hit an error. Download whatever was collected.', 'error');
      }
    }
  }

  async function getAutoState() {
    try {
      const data = await chrome.storage.local.get([AUTO_KEY]);
      return data[AUTO_KEY] || null;
    } catch (_) {
      return null;
    }
  }

  async function syncAll() {
    const state = await getAutoState();
    renderAutoState(state);
    await refreshStats();
    return state;
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => {
      syncAll().catch(() => {});
    }, 600);
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function getSerpTab() {
    // Prefer the tab that is a Google/Bing SERP in current window
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const serp = (tabs || []).find((t) => {
      const u = t.url || '';
      return (
        (/google\./i.test(u) || /bing\./i.test(u)) &&
        (/\/search/i.test(u) || /[?&]q=/.test(u))
      );
    });
    if (serp && serp.id) return serp;

    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active || !active.id) throw new Error('No active tab');
    const u = active.url || '';
    if (
      !((/google\./i.test(u) || /bing\./i.test(u)) && (/\/search/i.test(u) || /[?&]q=/.test(u)))
    ) {
      throw new Error('Open a Google or Bing search results page first.');
    }
    return active;
  }

  async function scrapeCurrentPage() {
    showMessage('', '');
    try {
      const tab = await getSerpTab();
      const startBtn = $('msStart');
      const oneBtn = $('msScrapeOne');
      if (oneBtn) {
        oneBtn.disabled = true;
        oneBtn.textContent = 'Scraping…';
      }

      const res = await chrome.runtime.sendMessage({
        action: 'RS_SERP_SCRAPE_CURRENT',
        tabId: tab.id
      });

      await refreshStats();

      if (!res || !res.ok) {
        showMessage((res && res.error) || "Couldn't scrape this page.", 'error');
        return;
      }

      const parts = [];
      if (res.added > 0) parts.push(`${res.added} new result${res.added === 1 ? '' : 's'}`);
      if (res.aioAdded) parts.push('an AI Overview');
      if (parts.length === 0) {
        showMessage(`Page ${res.page || ''} already scraped — total ${(await getStored()).results.length}.`, 'info');
      } else {
        showMessage(`Added ${parts.join(' and ')} (total ${res.total}).`, 'success');
      }
    } catch (err) {
      console.error(err);
      showMessage(err.message || "Couldn't scrape this page.", 'error');
    } finally {
      const oneBtn = $('msScrapeOne');
      if (oneBtn) {
        oneBtn.disabled = false;
        oneBtn.textContent = 'Scrape this page';
      }
    }
  }

  async function startAutoScrape() {
    showMessage('', '');
    try {
      const tab = await getSerpTab();
      const pages = parseInt(($('msPages') && $('msPages').value) || '10', 10);

      // Optimistic UI
      renderAutoState({
        active: true,
        targetPages: pages,
        currentPage: 1,
        scrapedCount: 0
      });
      startPoll();

      const res = await chrome.runtime.sendMessage({
        action: 'RS_SERP_START_AUTO',
        tabId: tab.id,
        targetPages: pages,
        clearPrevious: true
      });

      if (!res || !res.ok) {
        stopPoll();
        renderAutoState({ active: false });
        showMessage((res && res.error) || "Couldn't start auto-scrape.", 'error');
        return;
      }

      showMessage(`Auto-scrape started (${pages} pages, ${res.engine}). Keep ShahzaibSEO open or reopen later.`, 'info');
      await syncAll();
    } catch (err) {
      stopPoll();
      renderAutoState({ active: false });
      showMessage(err.message || String(err), 'error');
    }
  }

  async function stopAutoScrape() {
    const stopBtn = $('msStop');
    if (stopBtn) stopBtn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ action: 'RS_SERP_STOP_AUTO' });
      await syncAll();
      stopPoll();
    } catch (e) {
      showMessage(e.message || String(e), 'error');
    } finally {
      if (stopBtn) stopBtn.disabled = false;
    }
  }

  async function clearResults() {
    try {
      await chrome.runtime.sendMessage({ action: 'RS_SERP_CLEAR_MULTI' });
      // Also clear directly
      await chrome.storage.local.set({
        [STORAGE_KEY]: [],
        [PAGES_KEY]: [],
        [AIO_KEY]: []
      });
      await refreshStats();
      showMessage('Cleared.', 'info');
      stopPoll();
      renderAutoState({ active: false });
    } catch (e) {
      showMessage(e.message || String(e), 'error');
    }
  }

  function downloadBlob(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function downloadExcel() {
    if (typeof XLSX === 'undefined') {
      showMessage('Excel library not loaded. Reload the extension.', 'error');
      return;
    }
    const { results, aioResults } = await getStored();
    if (!results.length && !aioResults.length) {
      showMessage('Nothing to export.', 'info');
      return;
    }

    const wb = XLSX.utils.book_new();

    const orgHeader = ['#', 'Page', 'Title', 'URL', 'Domain', 'Breadcrumb', 'Description', 'Query', 'Scraped At'];
    const orgData = [orgHeader].concat(
      results.map((r, i) => [
        r.globalPosition || r.position || i + 1,
        r.page || '',
        r.title || '',
        r.url || '',
        r.domain || '',
        r.breadcrumb || '',
        r.snippet || r.description || '',
        r.query || '',
        r.scrapedAt || ''
      ])
    );
    const ws1 = XLSX.utils.aoa_to_sheet(orgData);
    ws1['!cols'] = [
      { wch: 5 }, { wch: 6 }, { wch: 45 }, { wch: 50 }, { wch: 22 },
      { wch: 28 }, { wch: 50 }, { wch: 24 }, { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Organic Results');

    const aioHeader = ['Query', 'Page', 'Answer', 'Citation', 'Citation URL', 'Scraped At'];
    const aioData = [aioHeader];
    aioResults.forEach((a) => {
      const text = a.text || a.answerText || '';
      const cites = a.citations || [];
      if (!cites.length) {
        aioData.push([a.query || '', a.page || '', text, '', '', a.scrapedAt || '']);
      } else {
        cites.forEach((c, idx) => {
          aioData.push([
            idx === 0 ? a.query || '' : '',
            idx === 0 ? a.page || '' : '',
            idx === 0 ? text : '',
            c.label || '',
            c.url || '',
            idx === 0 ? a.scrapedAt || '' : ''
          ]);
        });
      }
    });
    const ws2 = XLSX.utils.aoa_to_sheet(aioData);
    XLSX.utils.book_append_sheet(wb, ws2, 'AI Overviews');

    const q = (results[0] && results[0].query) || 'serp';
    const fname = 'serp_' + String(q).replace(/\W+/g, '_').slice(0, 40) + '.xlsx';
    XLSX.writeFile(wb, fname);
    showMessage('Downloaded ' + fname, 'success');
  }

  async function downloadCsv() {
    const { results } = await getStored();
    if (!results.length) {
      showMessage('Nothing to export.', 'info');
      return;
    }
    const escC = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [
      ['#', 'Page', 'Title', 'URL', 'Domain', 'Snippet', 'Query'].map(escC).join(',')
    ].concat(
      results.map((r, i) =>
        [r.globalPosition || r.position || i + 1, r.page || '', r.title || '', r.url || '', r.domain || '', r.snippet || '', r.query || '']
          .map(escC)
          .join(',')
      )
    );
    downloadBlob('serp_multi.csv', lines.join('\n'), 'text/csv;charset=utf-8');
  }

  async function downloadJson() {
    const data = await getStored();
    downloadBlob('serp_multi.json', JSON.stringify(data, null, 2), 'application/json');
  }

  function bind() {
    if (!$('msStart')) return;

    $('msStart').addEventListener('click', startAutoScrape);
    $('msStop').addEventListener('click', stopAutoScrape);
    $('msScrapeOne').addEventListener('click', scrapeCurrentPage);
    $('msRefresh').addEventListener('click', () => {
      syncAll().then(() => showMessage('Refreshed from storage.', 'info'));
    });
    $('msExcel').addEventListener('click', downloadExcel);
    $('msCsv').addEventListener('click', downloadCsv);
    $('msJson').addEventListener('click', downloadJson);
    $('msClear').addEventListener('click', clearResults);

    // Live updates from background
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[STORAGE_KEY] || changes[PAGES_KEY] || changes[AIO_KEY] || changes[AUTO_KEY]) {
        syncAll().catch(() => {});
      }
    });

    // Init
    syncAll().then((state) => {
      if (state && state.active) startPoll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
