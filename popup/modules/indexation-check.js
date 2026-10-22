/**
 * Lightweight Google site: indexation check (Technical tab)
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function rootDomain(host) {
    return String(host || '').replace(/^www\./i, '').toLowerCase().split('/')[0];
  }

  function getDomain() {
    if (window._currentDomain) return rootDomain(window._currentDomain);
    try {
      const u = window._currentUrl;
      if (u) return rootDomain(new URL(u).hostname);
    } catch (_) {}
    return null;
  }

  function setResult(html) {
    const el = $('techIndexResult');
    if (el) el.innerHTML = html;
  }

  async function runCheck() {
    const domain = getDomain();
    const btn = $('techIndexRunBtn');
    const link = $('techIndexGoogleLink');
    if (!domain) {
      setResult('<span style="color:#dc2626;">Open a page first so ShahzaibSEO knows the domain.</span>');
      return;
    }
    const q = 'site:' + domain;
    const gUrl = 'https://www.google.com/search?q=' + encodeURIComponent(q);
    if (link) {
      link.href = gUrl;
      link.style.display = '';
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    setResult('<span style="color:var(--text-3);">Running Google <code>site:' + domain + '</code>…</span>');

    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'SITE_INDEXATION', domain }, r => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(r || { ok: false });
        });
      });

      if (!res.ok) {
        setResult(`<div style="color:#b45309;"><strong>Could not auto-count results.</strong> ${res.error ? esc(res.error) : ''}
          <div style="margin-top:6px;">Use <a href="${gUrl}" target="_blank" rel="noopener">Google site:${esc(domain)}</a> manually. Captchas block automated counts sometimes.</div></div>`);
        return;
      }

      const count = res.estimatedCount;
      const sample = res.sampleUrls || [];
      let html = `<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
        <div>
          <div style="font-size:11px;color:var(--text-3);">Estimated indexed URLs</div>
          <div style="font-size:28px;font-weight:800;color:#0D9488;">${count != null ? Number(count).toLocaleString() : '—'}</div>
          <div style="font-size:11px;color:var(--text-3);">${res.source || 'Google site:'} · approximate</div>
        </div>
        <div style="flex:1;min-width:160px;">
          <div style="font-size:11px;font-weight:600;margin-bottom:4px;">Sample URLs</div>
          <ul style="margin:0;padding-left:16px;font-size:11px;">
            ${sample.slice(0, 5).map(u => `<li style="margin-bottom:2px;word-break:break-all;"><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`).join('') || '<li>None parsed</li>'}
          </ul>
        </div>
      </div>
      <p style="margin:8px 0 0;font-size:11px;color:var(--text-3);">Not a substitute for Google Search Console coverage report. GSC OAuth can be added later for exact index status.</p>`;
      setResult(html);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Check indexation'; }
    }
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  }

  function init() {
    const btn = $('techIndexRunBtn');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', runCheck);
    }
    document.querySelectorAll('[data-tab="technical"]').forEach(b => {
      b.addEventListener('click', () => {
        const domain = getDomain();
        const link = $('techIndexGoogleLink');
        if (domain && link) {
          link.href = 'https://www.google.com/search?q=' + encodeURIComponent('site:' + domain);
          link.style.display = '';
        }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
