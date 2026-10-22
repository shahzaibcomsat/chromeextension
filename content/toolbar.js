// ShahzaibSEO Toolbar - Ahrefs/Moz style SEO toolbar
// Injected into every page as a content script

(function() {
  'use strict';

  // ─── Skip non-HTML pages ──────────────────────────────────────────────────
  // The toolbar must not run on XML, JSON, plain-text, RSS/Atom feeds or any
  // other non-HTML document (e.g. /sitemap.xml, /feed, /robots.txt).
  // We detect this in two complementary ways:
  //
  //  1. URL path/extension  – cheap, runs before any DOM access.
  //  2. document.contentType – definitive MIME type set by the browser.
  //
  // Both checks must pass before we proceed.

  // 1. URL-based check – block known non-HTML extensions and paths
  (function earlyExitOnNonHTMLUrl() {
    const path = location.pathname.toLowerCase();
    const NON_HTML_EXTENSIONS = [
      '.xml', '.json', '.rss', '.atom', '.txt', '.csv',
      '.pdf', '.js', '.css', '.svg', '.ico',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
      '.mp4', '.mp3', '.webm', '.zip', '.gz', '.woff', '.woff2', '.ttf'
    ];
    if (NON_HTML_EXTENSIONS.some(ext => path.endsWith(ext))) {
      throw new Error('[ShahzaibSEO] Non-HTML URL – toolbar skipped (' + path + ')');
    }
  })();

  // 2. MIME / document-type check – covers dynamically-served XML/JSON
  //    that may not have a file extension in the URL.
  (function earlyExitOnNonHTMLDocument() {
    const ct = (document.contentType || '').toLowerCase();
    // Allow only HTML and XHTML documents
    const HTML_TYPES = ['text/html', 'application/xhtml+xml', ''];
    const isHTML = HTML_TYPES.some(t => ct.startsWith(t));
    if (!isHTML) {
      throw new Error('[ShahzaibSEO] Non-HTML content-type "' + ct + '" – toolbar skipped');
    }
    // Also reject if the document root element is not <html> (e.g. bare XML)
    const root = document.documentElement;
    if (root && root.tagName && root.tagName.toLowerCase() !== 'html') {
      throw new Error('[ShahzaibSEO] Root element is <' + root.tagName + '> not <html> – toolbar skipped');
    }
    // Require a real <body> element; XML/JSON pages rendered by Chrome's
    // built-in viewer wrap content in a <body> but inside an error-page shell
    // that has no real page content — skip those too.
    if (!document.body) {
      throw new Error('[ShahzaibSEO] No <body> element found – toolbar skipped');
    }
  })();

  // Prevent double-injection
  if (window.__rankseoToolbarLoaded) return;
  window.__rankseoToolbarLoaded = true;

  // ─── State ────────────────────────────────────────────────────────────────
  let toolbarEl = null;
  let toggleEl = null;
  let isHidden = false;
  let toolbarPosition = 'top'; // 'top' | 'bottom'
  let analysisData = null;
  let linkHighlightActive = false;
  let kwHighlightActive = false;

  // ─── Load preference ──────────────────────────────────────────────────────
  chrome.storage.local.get(['toolbarHidden', 'toolbarPosition', 'toolbarEnabled', 'domainBlacklist', 'domainWhitelist'], (prefs) => {
    // Handle extension context invalidation
    if (chrome.runtime.lastError) {
      console.log('[RS Toolbar] Storage access failed:', chrome.runtime.lastError.message);
      return;
    }
    
    const enabled = prefs.toolbarEnabled !== false; // default ON
    if (!enabled) return;
    // Domain blacklist/whitelist check.
    // Built-in fallback so search engines / big apps stay toolbar-free even
    // before the background's default blacklist has been written to storage
    // (fresh install race) — fixes the toolbar flashing on google.com.
    const BUILTIN_BLACKLIST = [
      'google.com', 'mail.google.com', 'gemini.google.com', 'bing.com',
      'duckduckgo.com', 'facebook.com', 'instagram.com', 'x.com',
      'youtube.com', 'linkedin.com', 'chatgpt.com', 'claude.ai'
    ];
    const currentHost = location.hostname.replace(/^www\./, '');
    const blacklist = (prefs.domainBlacklist && prefs.domainBlacklist.length) ? prefs.domainBlacklist : BUILTIN_BLACKLIST;
    const whitelist = prefs.domainWhitelist || [];
    if (blacklist.length > 0 && blacklist.some(d => currentHost === d || currentHost.endsWith('.' + d))) return;
    if (whitelist.length > 0 && !whitelist.some(d => currentHost === d || currentHost.endsWith('.' + d))) return;
    isHidden = prefs.toolbarHidden === true;
    toolbarPosition = (prefs.toolbarPosition === 'bottom') ? 'bottom' : 'top';
    injectStyles();
    createToolbar();

    // Fetch DA + Traffic immediately — don't wait for analysis
    fetchDomainDA(location.hostname);
    fetchAhrefsDR(location.hostname);
    fetchTrafficPill(location.hostname);
    fetchSitemapPages(location.hostname);

    // Wait for page to paint then request analysis
    if (document.readyState === 'complete') {
      requestAnalysis();
    } else {
      window.addEventListener('load', requestAnalysis, { once: true });
    }
  });

  // ─── Inject CSS ───────────────────────────────────────────────────────────
  function injectStyles() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content/toolbar.css');
    document.head.appendChild(link);
  }

  // ─── Create Toolbar HTML ──────────────────────────────────────────────────
  function createToolbar() {
    toolbarEl = document.createElement('div');
    toolbarEl.id = 'rankseo-toolbar';
    applyToolbarPositionClasses();
    if (isHidden) toolbarEl.classList.add('rankseo-hidden');

    toolbarEl.innerHTML = buildInitialHTML();
    document.body.insertBefore(toolbarEl, document.body.firstChild);

    if (!isHidden) {
      document.body.classList.add('rankseo-has-toolbar');
      document.body.classList.toggle('rankseo-toolbar-bottom', toolbarPosition === 'bottom');
    }

    // Hide toggle (outside toolbar)
    toggleEl = document.createElement('button');
    toggleEl.id = 'rankseo-toggle';
    toggleEl.type = 'button';
    updateToggleUI();
    toggleEl.addEventListener('click', toggleBar);
    document.body.appendChild(toggleEl);

    // Position toggle: Top ↔ Bottom
    const posEl = document.createElement('button');
    posEl.id = 'rankseo-pos-toggle';
    posEl.type = 'button';
    posEl.title = 'Move ShahzaibSEO toolbar to top or bottom of the page';
    updatePosToggleUI(posEl);
    posEl.addEventListener('click', toggleToolbarPosition);
    document.body.appendChild(posEl);
    window.__rsPosToggle = posEl;

    bindEvents();
  }

  function applyToolbarPositionClasses() {
    if (!toolbarEl) return;
    toolbarEl.classList.remove('rankseo-pos-top', 'rankseo-pos-bottom');
    toolbarEl.classList.add(toolbarPosition === 'bottom' ? 'rankseo-pos-bottom' : 'rankseo-pos-top');
  }

  function updateToggleUI() {
    if (!toggleEl) return;
    const atBottom = toolbarPosition === 'bottom';
    toggleEl.className = (atBottom ? 'rankseo-toggle-bottom' : 'rankseo-toggle-top') + (isHidden ? ' bar-hidden' : '');
    if (isHidden) {
      toggleEl.innerHTML = atBottom ? `<span>▲</span> ShahzaibSEO` : `<span>▼</span> ShahzaibSEO`;
    } else {
      toggleEl.innerHTML = atBottom ? `<span>▼</span> Hide` : `<span>▲</span> Hide`;
    }
  }

  function updatePosToggleUI(el) {
    const posEl = el || window.__rsPosToggle;
    if (!posEl) return;
    const atBottom = toolbarPosition === 'bottom';
    posEl.className = (atBottom ? 'rankseo-toggle-bottom' : 'rankseo-toggle-top') + (isHidden ? ' bar-hidden' : '');
    posEl.innerHTML = atBottom ? `<span>↑</span> Top` : `<span>↓</span> Bottom`;
  }

  function toggleToolbarPosition() {
    toolbarPosition = toolbarPosition === 'bottom' ? 'top' : 'bottom';
    applyToolbarPositionClasses();
    if (!isHidden) {
      document.body.classList.toggle('rankseo-toolbar-bottom', toolbarPosition === 'bottom');
    }
    updateToggleUI();
    updatePosToggleUI();
    if (chrome.runtime?.id) {
      chrome.storage.local.set({ toolbarPosition }, () => {
        if (chrome.runtime.lastError) {
          console.log('[RS Toolbar] Failed to save position:', chrome.runtime.lastError.message);
        }
      });
    }
  }

  function buildInitialHTML() {
    return `
      <div id="rankseo-brand">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M3 17l4-8 4 4 4-6 4 10" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M21 17H3" stroke="#1d4ed8" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span id="rankseo-brand-name">ShahzaibSEO</span>
      </div>

      <div class="rankseo-scroll" id="rankseo-scroll">

      <div class="rankseo-score-pill grade-? rankseo-tooltip-wrap" id="rankseo-overall-score" style="cursor:default;">
        <span class="rankseo-score-label">SEO</span>
        <span class="rankseo-score-value" id="rs-score-num">—</span>
        <div class="rankseo-tooltip" id="rs-seo-tooltip" style="min-width:240px;">
          <div class="rankseo-tooltip-title">SEO Score</div>
          <div id="rs-seo-tip-body"><span style="color:#94a3b8;font-size:10px;">Analyzing…</span></div>
        </div>
      </div>

      <div class="rankseo-score-pill grade-? rankseo-tooltip-wrap" id="rankseo-geo-score" style="cursor:default;">
        <span class="rankseo-score-label">GEO</span>
        <span class="rankseo-score-value" id="rs-geo-num">—</span>
        <div class="rankseo-tooltip" id="rs-geo-tooltip" style="min-width:240px;">
          <div class="rankseo-tooltip-title">GEO Score</div>
          <div id="rs-geo-tip-body"><span style="color:#94a3b8;font-size:10px;">Analyzing…</span></div>
        </div>
      </div>

      <div class="rankseo-score-pill rankseo-da-pill rankseo-tooltip-wrap" id="rankseo-da-score" style="cursor:default;">
        <span class="rankseo-score-label">DA</span>
        <span class="rankseo-score-value" id="rs-da-num">—</span>
        <div class="rankseo-tooltip" id="rs-da-tooltip">
          <div class="rankseo-tooltip-title" style="color:#0284c7;">Domain Authority</div>
          <div id="rs-da-tip-body"></div>
        </div>
      </div>

      <div class="rankseo-score-pill rankseo-dr-pill rankseo-tooltip-wrap" id="rankseo-dr-score" style="cursor:default;">
        <span class="rankseo-score-label">DR</span>
        <span class="rankseo-score-value" id="rs-dr-num">—</span>
        <div class="rankseo-tooltip" id="rs-dr-tooltip">
          <div class="rankseo-tooltip-title" style="color:#f97316;">Ahrefs DR</div>
          <div id="rs-dr-tip-body"><span style="color:#94a3b8;font-size:10px;">Loading…</span></div>
        </div>
      </div>

      <div class="rankseo-score-pill rankseo-spam-pill rankseo-tooltip-wrap" id="rankseo-spam-score" style="cursor:default;">
        <span class="rankseo-score-label">SPAM</span>
        <span class="rankseo-score-value" id="rs-spam-num">—</span>
        <div class="rankseo-tooltip" id="rs-spam-tooltip">
          <div class="rankseo-tooltip-title" id="rs-spam-tip-title">Spam Score</div>
          <div id="rs-spam-tip-body"></div>
        </div>
      </div>

      <div class="rankseo-score-pill rankseo-age-pill rankseo-tooltip-wrap" id="rankseo-age-score" style="cursor:default;">
        <span class="rankseo-score-label">AGE</span>
        <span class="rankseo-score-value" id="rs-age-num">—</span>
        <div class="rankseo-tooltip" id="rs-age-tooltip">
          <div class="rankseo-tooltip-title" style="color:#2563eb;">Domain Age</div>
          <div id="rs-age-tip-body"></div>
        </div>
      </div>

      <div class="rankseo-score-pill rankseo-tooltip-wrap" id="rankseo-traffic-score" style="cursor:default;">
        <span class="rankseo-score-label">TR</span>
        <span class="rankseo-score-value" id="rs-traffic-num" style="color:#6366f1;">—</span>
        <div class="rankseo-tooltip" id="rs-traffic-tooltip" style="min-width:200px;">
          <div class="rankseo-tooltip-title" style="color:#6366f1;">Website Traffic</div>
          <div id="rs-tr-tip-body">—</div>
        </div>
      </div>

      <div class="rankseo-score-pill rankseo-pages-pill rankseo-tooltip-wrap" id="rankseo-pages-score" style="display:none;cursor:default;">
        <span class="rankseo-score-label">PGS</span>
        <span class="rankseo-score-value" id="rs-pages-num" style="color:#10b981;">—</span>
        <div class="rankseo-tooltip" id="rs-pages-tooltip">
          <div class="rankseo-tooltip-title" style="color:#10b981;">Total Pages</div>
          <div id="rs-pages-tip-body">Indexed pages from sitemap</div>
        </div>
      </div>

      <div class="rankseo-divider"></div>

      <div class="rankseo-metrics" id="rankseo-metrics">
        <div class="rankseo-loading">
          <div class="rankseo-spinner"></div>
          <span>Analyzing…</span>
        </div>
      </div>

      </div><!-- /rankseo-scroll -->

      <div class="rankseo-actions">
        <button class="rankseo-btn" id="rs-btn-nlp" title="TextRazor NLP — entities, topics, phrases">
          NLP
        </button>
        <button class="rankseo-btn primary" id="rs-btn-popup" title="Open full analysis">
          Full Report
        </button>
      </div>
    `;
  }

  // ─── Bind events ──────────────────────────────────────────────────────────
  function bindEvents() {
    // Links button removed from toolbar — use On-Page Labs → Links instead
    document.getElementById('rs-btn-nlp')?.addEventListener('click', runTextRazorNlp);
    document.getElementById('rs-btn-popup')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openPopup' });
    });
    bindTooltipPositioning();
  }

  // Position hover tooltips as fixed elements, anchored BELOW their chip, so
  // the horizontal-scroll bar never clips them. Delegated so it also covers
  // metric chips that are rendered after bind time.
  function bindTooltipPositioning() {
    if (!toolbarEl || toolbarEl._tipBound) return;
    toolbarEl._tipBound = true;
    const place = (wrap) => {
      const tip = wrap.querySelector('.rankseo-tooltip');
      if (!tip) return;
      const r = wrap.getBoundingClientRect();
      const tw = tip.offsetWidth || 200;
      const half = tw / 2, pad = 8;
      let left = r.left + r.width / 2;
      left = Math.min(Math.max(left, half + pad), window.innerWidth - half - pad);
      tip.style.left = Math.round(left) + 'px';
      const atBottom = toolbarPosition === 'bottom' || toolbarEl.classList.contains('rankseo-pos-bottom');
      if (atBottom) {
        // Open upward so tooltips stay on-screen
        const th = tip.offsetHeight || 120;
        tip.style.top = Math.round(r.top - th - 8) + 'px';
      } else {
        tip.style.top = Math.round(r.bottom + 8) + 'px';
      }
      tip.style.transform = 'translateX(-50%)';
    };
    toolbarEl.addEventListener('mouseover', (e) => {
      const t = e.target;
      const wrap = t && t.closest ? t.closest('.rankseo-tooltip-wrap') : null;
      if (wrap && toolbarEl.contains(wrap)) place(wrap);
    });
  }

  // ─── Toggle bar visibility ────────────────────────────────────────────────
  function toggleBar() {
    isHidden = !isHidden;
    toolbarEl.classList.toggle('rankseo-hidden', isHidden);
    document.body.classList.toggle('rankseo-has-toolbar', !isHidden);
    document.body.classList.toggle('rankseo-toolbar-bottom', !isHidden && toolbarPosition === 'bottom');
    updateToggleUI();
    updatePosToggleUI();
    
    // Save preference with error handling
    if (chrome.runtime?.id) {
      chrome.storage.local.set({ toolbarHidden: isHidden }, () => {
        if (chrome.runtime.lastError) {
          console.log('[RS Toolbar] Failed to save preference:', chrome.runtime.lastError.message);
        }
      });
    }
  }

  // ─── Request analysis from content.js ─────────────────────────────────────
  function requestAnalysis() {
    // Small delay to let content.js finish loading & running
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'getAnalysis' }, (response) => {
        if (chrome.runtime.lastError) {
          // content.js will analyze directly
          if (window.ShahzaibSEO) {
            try {
              const data = window.ShahzaibSEO.analyze();
              updateToolbar(data);
            } catch(e) { showError(); }
          }
          return;
        }
        if (response) updateToolbar(response);
      });
    }, 800);

    // Fallback: try directly via window.ShahzaibSEO
    setTimeout(() => {
      if (!analysisData && window.ShahzaibSEO) {
        try {
          const data = window.ShahzaibSEO.analyze();
          updateToolbar(data);
        } catch(e) {}
      }
    }, 2500);
  }

  // ─── Update toolbar with data ──────────────────────────────────────────────
  function updateToolbar(data) {
    if (!data || !toolbarEl) return;
    analysisData = data;

    // Scores — use consistent grade thresholds matching popup (A≥90 B≥75 C≥60 D≥45)
    const score = data.score?.value || 0;
    const grade = scoreGrade(score);
    const geoScore = data.geoSignals?.score || 0;

    updateScorePill('rankseo-overall-score', 'rs-score-num', 'rs-score-grade', score, grade);
    updateScorePill('rankseo-geo-score', 'rs-geo-num', 'rs-geo-grade', geoScore, geoGrade(geoScore));

    // ── SEO Tooltip
    const seoTipBody = document.getElementById('rs-seo-tip-body');
    if (seoTipBody) {
      const issues = data.score?.issues || [];
      const gradeColor = { A:'#16a34a', B:'#65a30d', C:'#ca8a04', D:'#ea580c', F:'#dc2626' }[grade] || '#64748b';

      // Score bar
      let html = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <div style="flex:1;height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden;">
          <div style="width:${score}%;height:100%;background:${gradeColor};border-radius:3px;transition:width .4s;"></div>
        </div>
        <span style="font-size:10px;font-weight:700;color:${gradeColor};">${score}/100</span>
      </div>`;

      // Grade label
      const gradeLabel = { A:'Excellent', B:'Good', C:'Needs Work', D:'Poor', F:'Critical' }[grade] || '';
      html += `<div style="font-size:10px;color:${gradeColor};font-weight:600;margin-bottom:5px;">Grade ${grade} — ${gradeLabel}</div>`;

      if (issues.length === 0) {
        html += `<div class="rankseo-tooltip-row"><span class="rankseo-dot ok"></span><span>No critical issues found</span></div>`;
      } else {
        html += `<div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px;">Issues (${issues.length})</div>`;
        issues.slice(0, 5).forEach(issue => {
          html += `<div class="rankseo-tooltip-row"><span class="rankseo-dot err"></span><span style="white-space:normal;line-height:1.4;">${issue}</span></div>`;
        });
        if (issues.length > 5) {
          html += `<div style="font-size:9px;color:#94a3b8;margin-top:2px;">+${issues.length - 5} more — see Full Report</div>`;
        }
      }
      seoTipBody.innerHTML = html;
    }

    // ── GEO Tooltip
    const geoTipBody = document.getElementById('rs-geo-tip-body');
    if (geoTipBody && data.geoSignals?.pillars) {
      const pillars = data.geoSignals.pillars;
      const geoGradeVal = geoGrade(geoScore);
      const geoColor = { A:'#16a34a', B:'#65a30d', C:'#ca8a04', D:'#ea580c', F:'#dc2626' }[geoGradeVal] || '#64748b';
      const geoLabel = { A:'Excellent', B:'Good', C:'Needs Work', D:'Poor', F:'Critical' }[geoGradeVal] || '';

      let html = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <div style="flex:1;height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden;">
          <div style="width:${geoScore}%;height:100%;background:${geoColor};border-radius:3px;transition:width .4s;"></div>
        </div>
        <span style="font-size:10px;font-weight:700;color:${geoColor};">${geoScore}/100</span>
      </div>`;

      html += `<div style="font-size:10px;color:${geoColor};font-weight:600;margin-bottom:6px;">Grade ${geoGradeVal} — ${geoLabel}</div>`;
      html += `<div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;">AI Visibility Pillars</div>`;

      const pillarIcons = { citability:'📝', eeat:'🏅', structured:'🗂️', techAI:'🤖', multiModal:'🖼️' };
      Object.entries(pillars).forEach(([key, p]) => {
        const pct = Math.round((p.score / p.max) * 100);
        const pColor = pct >= 70 ? '#16a34a' : pct >= 40 ? '#ca8a04' : '#dc2626';
        html += `<div style="margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;font-size:9.5px;margin-bottom:2px;">
            <span style="color:#475569;">${pillarIcons[key] || '•'} ${p.label}</span>
            <span style="color:${pColor};font-weight:700;">${p.score}/${p.max}</span>
          </div>
          <div style="height:3px;background:#f1f5f9;border-radius:2px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:${pColor};border-radius:2px;"></div>
          </div>
        </div>`;
      });
      geoTipBody.innerHTML = html;
    }

    // Fetch Moz DA for current domain
    fetchDomainDA(location.hostname);
    // Fetch Ahrefs DR (free)
    fetchAhrefsDR(location.hostname);
    // Fetch monthly traffic for toolbar pill
    fetchTrafficPill(location.hostname);
    // Fetch sitemap pages count
    fetchSitemapPages(location.hostname);

    // Build metrics
    const metrics = buildMetrics(data);
    const metricsEl = document.getElementById('rankseo-metrics');
    if (metricsEl) metricsEl.innerHTML = metrics;
  }

  function updateScorePill(pillId, numId, gradeId, score, grade) {
    const pill = document.getElementById(pillId);
    const numEl = document.getElementById(numId);
    if (!pill || !numEl) return;

    pill.className = `rankseo-score-pill grade-${grade}`;
    numEl.textContent = score;
  }

  // Match popup scoreGrade: A>=90, B>=75, C>=60, D>=45, F<45
  function scoreGrade(s) {
    if (s >= 90) return 'A';
    if (s >= 75) return 'B';
    if (s >= 60) return 'C';
    if (s >= 45) return 'D';
    return 'F';
  }

  function geoGrade(s) {
    return scoreGrade(s);
  }

  function buildMetrics(d) {
    const parts = [];

    // ── Title (character count + text in tooltip)
    const title = d.title || {};
    const titleLen = title.length || 0;
    const titleStatus = title.status === 'good' ? 'ok' : title.status === 'error' ? 'err' : 'warn';
    const titleText = (title.content || '').trim();
    parts.push(metric('T', 'Title', titleLen ? `${titleLen}ch` : '—', titleStatus,
      'Page Title', [
        { status: titleStatus, text: title.message || (titleLen ? `${titleLen} characters` : 'No title found') },
        { status: 'info', text: titleText ? `"${truncate(titleText, 90)}"` : '—' },
        { status: 'info', text: 'Ideal: 50–60 characters' }
      ]));

    // ── Meta Description
    const meta = d.metaDescription || {};
    const metaLen = meta.length || 0;
    const metaStatus = meta.status === 'good' ? 'ok' : meta.status === 'error' ? 'err' : 'warn';
    const metaText = (meta.content || '').trim();
    parts.push(metric('M', 'Meta', metaLen ? `${metaLen}ch` : '—', metaStatus,
      'Meta Description', [
        { status: metaStatus, text: meta.message || (metaLen ? `${metaLen} characters` : 'No meta description') },
        { status: 'info', text: metaText ? `"${truncate(metaText, 110)}"` : '—' },
        { status: 'info', text: 'Ideal: 120–160 characters' }
      ]));

    // ── Words
    const wc = d.content?.wordCount || 0;
    const wcStatus = wc < 100 ? 'err' : wc < 300 ? 'warn' : 'ok';
    const readMin = wc > 0 ? Math.max(1, Math.round(wc / 200)) : 0;
    parts.push(metric('W', 'Words', numFormat(wc), wcStatus,
      'Content Length', [
        { status: wcStatus, text: d.content?.message || 'Content analysis' },
        { status: 'info', text: `${d.content?.paragraphCount || 0} paragraphs` },
        { status: 'info', text: `~${readMin} min read` }
      ]));

    // ── H1
    const headings = d.headings || {};
    const h1Count = headings.h1Count || 0;
    const h2Count = (headings.structure && headings.structure.h2 && headings.structure.h2.length) || headings.h2Count || 0;
    const hStatus = headings.status === 'good' ? 'ok' : headings.status === 'error' ? 'err' : 'warn';
    parts.push(metric('H1', 'H1', h1Count === 1 ? '✓' : String(h1Count), h1Count === 1 ? 'ok' : 'err',
      'Headings Structure', [
        { status: hStatus, text: headings.message || 'Heading analysis' },
        { status: 'info', text: `H2: ${h2Count} · Total: ${headings.totalHeadings || 0}` }
      ]));

    // ── Images
    const imgs = d.images || {};
    const noAlt = imgs.withoutAlt || 0;
    const imgStatus = noAlt === 0 ? 'ok' : noAlt <= 3 ? 'warn' : 'err';
    parts.push(metric('IMG', 'IMG', `${imgs.total || 0}`, imgStatus,
      'Images', [
        { status: imgStatus, text: imgs.message || 'Image analysis' },
        { status: 'info', text: `${imgs.withAlt || 0} with alt · ${noAlt} missing` }
      ]));

    // ── Links
    const links = d.links || {};
    const lStatus = (links.withoutText || 0) > 0 ? 'warn' : 'ok';
    parts.push(metric('LNK', 'Links', `${links.total || 0}`, lStatus,
      'Links', [
        { status: 'info', text: `Internal: ${links.internal || 0}` },
        { status: 'info', text: `External: ${links.external || 0}` },
        { status: links.nofollow > 0 ? 'warn' : 'ok', text: `Nofollow: ${links.nofollow || 0}` }
      ]));

    // ── Page Type (skip homepage — traffic shown in toolbar pill instead)
    const pt = d.pageType?.type || 'page';
    parts.push(divider());
    if (pt !== 'homepage') {
      const ptIcon = pageTypeIcon(pt);
      const ptDesc = d.pageType?.message || `Detected page type: ${formatType(pt)}`;
      parts.push(`<div class="rankseo-metric rankseo-tooltip-wrap">
        <span class="rankseo-type-badge">${formatType(pt)}</span>
        <div class="rankseo-tooltip" style="min-width:180px;">
          <div class="rankseo-tooltip-title">${ptIcon} Page Type</div>
          <div class="rankseo-tooltip-row">
            <span class="rankseo-dot ok"></span>
            <span>${ptDesc}</span>
          </div>
        </div>
      </div>`);
    }

    // ── Search Intent
    const intent = d.searchIntent?.primary || 'informational';
    const intentDetails = {
      informational: { icon: 'ℹ️', full: 'Informational', desc: 'User is looking for information or answers to a question.' },
      transactional: { icon: '🛒', full: 'Transactional', desc: 'User intends to complete a purchase or action.' },
      commercial:    { icon: '📊', full: 'Commercial',    desc: 'User is researching before making a buying decision.' },
      navigational:  { icon: '🧭', full: 'Navigational',  desc: 'User is trying to reach a specific website or page.' }
    };
    const iDetail = intentDetails[intent] || { icon: '📄', full: capitalize(intent), desc: 'Search intent detected for this page.' };
    const intentSecondary = d.searchIntent?.secondary ? capitalize(d.searchIntent.secondary) : null;
    const intentConfidence = d.searchIntent?.confidence || null;
    const intentScores = d.searchIntent?.scores || null;

    // Build scores bar rows
    let scoresHTML = '';
    if (intentScores) {
      const maxS = Math.max(...Object.values(intentScores)) || 1;
      const scoreOrder = ['informational','transactional','commercial','navigational'];
      const scoreColors = { informational:'#2563eb', transactional:'#16a34a', commercial:'#ea580c', navigational:'#7c3aed' };
      scoresHTML = `<div style="margin-top:6px;padding-top:5px;border-top:1px solid #e2e8f0;">
        <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;">Signal Scores</div>
        ${scoreOrder.map(k => {
          const val = intentScores[k] || 0;
          const pct = maxS > 0 ? Math.round((val / maxS) * 100) : 0;
          const color = scoreColors[k] || '#6366f1';
          const isActive = k === intent;
          return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
            <span style="font-size:9px;color:${isActive ? color : '#94a3b8'};font-weight:${isActive ? '700' : '500'};width:68px;text-transform:capitalize;">${k}</span>
            <div style="flex:1;height:4px;background:#f1f5f9;border-radius:2px;overflow:hidden;">
              <div style="width:${pct}%;height:100%;background:${color};border-radius:2px;"></div>
            </div>
            <span style="font-size:9px;color:${isActive ? color : '#94a3b8'};font-weight:600;width:18px;text-align:right;">${val}</span>
          </div>`;
        }).join('')}
      </div>`;
    }

    parts.push(`<div class="rankseo-metric rankseo-tooltip-wrap">
      <span class="rankseo-intent-badge ${intent}">${formatIntent(intent)}</span>
      <div class="rankseo-tooltip" style="min-width:240px;max-width:280px;">
        <div class="rankseo-tooltip-title">${iDetail.icon} ${iDetail.full} Intent</div>
        <div class="rankseo-tooltip-row">
          <span class="rankseo-dot ok"></span>
          <span style="white-space:normal;line-height:1.4;">${iDetail.desc}</span>
        </div>
        ${intentConfidence ? `<div class="rankseo-tooltip-row"><span class="rankseo-dot info"></span><span>Confidence: <strong>${capitalize(intentConfidence)}</strong></span></div>` : ''}
        ${intentSecondary ? `<div class="rankseo-tooltip-row"><span class="rankseo-dot warn"></span><span>Secondary: <strong>${intentSecondary}</strong></span></div>` : ''}
        ${scoresHTML}
      </div>
    </div>`);

    parts.push(divider());

    // ── CMS/Tech
    const cms = d.technical?.cms?.name;
    if (cms) {
      parts.push(metric('CMS', 'CMS', cms, 'info', 'Detected CMS', [
        { status: 'info', text: `Platform: ${cms}` }
      ]));
    }

    // ── Schema
    const schemaCount = d.structured?.validCount || 0;
    const schemaStatus = schemaCount > 0 ? 'ok' : 'warn';
    parts.push(metric('SD', 'Schema', String(schemaCount), schemaStatus,
      'Structured Data', [
        { status: schemaStatus, text: d.structured?.message || 'Structured data analysis' }
      ]));

    // ── Canonical (hidden from toolbar — available in full popup)

    // ── Indexability
    const indexed = !d.technical?.indexability?.isNoindex;
    parts.push(divider());
    parts.push(metric('IDX', 'Index', indexed ? '✓' : '✗', indexed ? 'ok' : 'err',
      'Indexability', [
        { status: indexed ? 'ok' : 'err', text: indexed ? 'Page is indexable' : 'NOINDEX — not indexed!' }
      ]));

    return parts.join('');
  }

  function metric(icon, label, value, statusClass, tooltipTitle, tooltipRows) {
    const rowsHTML = (tooltipRows || []).map(r =>
      `<div class="rankseo-tooltip-row">
        <span class="rankseo-dot ${r.status}"></span>
        <span>${r.text}</span>
      </div>`
    ).join('');

    return `<div class="rankseo-metric rankseo-tooltip-wrap">
      <span class="rankseo-metric-label">${label}</span>
      <span class="rankseo-metric-value ${statusClass}">${value}</span>
      <div class="rankseo-tooltip">
        <div class="rankseo-tooltip-title">${tooltipTitle}</div>
        ${rowsHTML}
      </div>
    </div>`;
  }

  function divider() {
    return '<div class="rankseo-divider"></div>';
  }

  function buildSERPIcons(serp) {
    const featureMap = {
      'FAQ': 'FAQ',
      'Product': 'PROD',
      'Article': 'ART',
      'Breadcrumbs': 'BC',
      'Sitelinks Search': 'SL',
      'How-To': 'HT',
      'Video': 'VID',
      'Recipe': 'REC',
      'Event': 'EVT',
      'Knowledge Panel': 'KP'
    };

    const iconsHTML = (serp.features || []).map(f => {
      const cls = f.eligible ? 'eligible' : f.partial ? 'partial' : '';
      const tip = f.eligible ? 'Eligible' : f.partial ? 'Partial — add schema' : 'Not eligible';
      const icon = featureMap[f.feature] || f.feature.slice(0, 3).toUpperCase();
      return `<span class="rankseo-serp-icon rankseo-tooltip-wrap ${cls}" title="${f.feature}: ${tip}">
        ${icon}
        <div class="rankseo-tooltip" style="min-width:180px">
          <div class="rankseo-tooltip-title">${f.feature}</div>
          <div class="rankseo-tooltip-row">
            <span class="rankseo-dot ${f.eligible ? 'ok' : f.partial ? 'warn' : 'err'}"></span>
            <span>${tip}</span>
          </div>
          ${f.fix ? `<div class="rankseo-tooltip-row"><span class="rankseo-dot info"></span><span>${f.fix}</span></div>` : ''}
        </div>
      </span>`;
    }).join('');

    return `<div class="rankseo-metric rankseo-tooltip-wrap">
      <span class="rankseo-metric-label">SERP</span>
      <span class="rankseo-serp-icons">${iconsHTML}</span>
      <div class="rankseo-tooltip">
        <div class="rankseo-tooltip-title">SERP Features</div>
        <div class="rankseo-tooltip-row"><span class="rankseo-dot ok"></span><span>${serp.eligibleCount} eligible features</span></div>
        <div class="rankseo-tooltip-row"><span class="rankseo-dot warn"></span><span>${serp.partialCount} partial</span></div>
      </div>
    </div>`;
  }

  // ─── Toggle link highlights ────────────────────────────────────────────────
  
  // ─── TextRazor NLP panel + on-page entity highlight ─────────────────────
  let _nlpPanel = null;
  let _nlpHighlightActive = false;
  let _nlpLastData = null;

  function collectPageTextForNlp() {
    try {
      const article = document.querySelector('article, main, [role="main"], .post-content, .entry-content, #content');
      let root = article || document.body;
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,svg,iframe,nav,footer,header,.rankseo-toolbar,#rankseo-toolbar,#rs-nlp-panel').forEach(el => el.remove());
      let text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 80) text = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
      const title = document.title || '';
      const meta = document.querySelector('meta[name="description"]')?.content || '';
      return (title + '\n' + meta + '\n' + text).slice(0, 120000);
    } catch (_) {
      return (document.body?.innerText || '').slice(0, 120000);
    }
  }

  function ensureNlpPanel() {
    if (_nlpPanel && document.body.contains(_nlpPanel)) return _nlpPanel;
    _nlpPanel = document.createElement('div');
    _nlpPanel.id = 'rs-nlp-panel';
    _nlpPanel.innerHTML = `
      <div class="rs-nlp-head">
        <div class="rs-nlp-brand">
          <span class="rs-nlp-logo">NLP</span>
          <span>TextRazor Analysis</span>
        </div>
        <button type="button" id="rs-nlp-close" title="Close">×</button>
      </div>
      <div class="rs-nlp-body" id="rs-nlp-body">Click NLP to analyze this page.</div>
      <div class="rs-nlp-actions">
        <button type="button" id="rs-nlp-highlight-btn" class="rs-nlp-action-btn" disabled>Highlight on page</button>
        <button type="button" id="rs-nlp-clear-btn" class="rs-nlp-action-btn ghost" style="display:none;">Clear highlights</button>
      </div>
    `;
    document.body.appendChild(_nlpPanel);
    _nlpPanel.querySelector('#rs-nlp-close')?.addEventListener('click', () => {
      _nlpPanel.style.display = 'none';
    });
    _nlpPanel.querySelector('#rs-nlp-highlight-btn')?.addEventListener('click', () => {
      if (_nlpLastData) applyNlpHighlights(_nlpLastData);
    });
    _nlpPanel.querySelector('#rs-nlp-clear-btn')?.addEventListener('click', clearNlpHighlights);
    return _nlpPanel;
  }

  function clearNlpHighlights() {
    document.querySelectorAll('mark.rs-nlp-hl').forEach(m => {
      const parent = m.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(m.textContent || ''), m);
      parent.normalize();
    });
    _nlpHighlightActive = false;
    const clearBtn = document.getElementById('rs-nlp-clear-btn');
    const hlBtn = document.getElementById('rs-nlp-highlight-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    if (hlBtn) {
      hlBtn.style.display = '';
      hlBtn.textContent = 'Highlight on page';
      hlBtn.disabled = !_nlpLastData;
    }
  }

  function applyNlpHighlights(data) {
    clearNlpHighlights();
    const terms = [];
    const seen = new Set();
    const add = (text, kind, source) => {
      let t = String(text || '').trim();
      if (!t || t.length < 2) return;
      // Normalize common entityId forms (underscores → spaces) so page text matches
      t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
      if (t.length < 2) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      terms.push({ text: t, kind, source });
    };
    (data.entities || []).forEach(e => {
      const src = e.wiki ? 'Wikipedia' : 'TextRazor';
      // Prefer surface forms that actually appear on the page
      if (Array.isArray(e.matchedTexts) && e.matchedTexts.length) {
        e.matchedTexts.forEach(mt => add(mt, 'entity', src));
      }
      if (e.matchedText) add(e.matchedText, 'entity', src);
      if (e.id) add(e.id, 'entity', src);
    });
    (data.phrases || []).forEach(p => add(p.text, 'phrase', 'TextRazor phrase'));
    (data.topics || []).slice(0, 12).forEach(t => add(t.label, 'topic', 'Topic'));
    // Prefer longer matches first (avoids partial overlaps eating longer entities)
    terms.sort((a, b) => b.text.length - a.text.length);
    if (!terms.length) return;

    // Scan whole document body so footer / nav entities also get highlighted
    const root = document.body;
    const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'PRE', 'SVG', 'IFRAME']);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        let p = node.parentElement;
        while (p) {
          if (skip.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (p.id === 'rankseo-toolbar' || p.id === 'rs-nlp-panel' || p.classList?.contains('rs-nlp-hl') || p.classList?.contains('rankseo-toolbar')) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    let hits = 0;
    for (const node of textNodes) {
      const value = node.nodeValue;
      if (!value) continue;
      const lower = value.toLowerCase();
      const indices = [];
      for (const term of terms) {
        const tl = term.text.toLowerCase();
        if (tl.length < 2) continue;
        let from = 0;
        while (from < lower.length) {
          const idx = lower.indexOf(tl, from);
          if (idx < 0) break;
          // Word-ish boundary (allow short brand names / 2-letter codes)
          const beforeOk = idx === 0 || !/[a-z0-9]/i.test(value[idx - 1] || '');
          const afterOk = idx + tl.length >= value.length || !/[a-z0-9]/i.test(value[idx + tl.length] || '');
          if (beforeOk && afterOk) {
            indices.push({ start: idx, end: idx + tl.length, term });
          }
          from = idx + Math.max(1, tl.length);
        }
      }
      if (!indices.length) continue;
      // Resolve overlaps: earliest start, then longest span
      indices.sort((a, b) => a.start - b.start || (b.end - a.start) - (a.end - a.start));
      const picked = [];
      let lastEnd = -1;
      for (const it of indices) {
        if (it.start < lastEnd) continue;
        picked.push(it);
        lastEnd = it.end;
      }
      if (!picked.length) continue;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const it of picked) {
        if (it.start > cursor) frag.appendChild(document.createTextNode(value.slice(cursor, it.start)));
        const mark = document.createElement('mark');
        mark.className = 'rs-nlp-hl rs-nlp-hl-' + it.term.kind;
        mark.textContent = value.slice(it.start, it.end);
        mark.title = it.term.kind + ' · ' + it.term.source;
        mark.setAttribute('data-rs-nlp-kind', it.term.kind);
        mark.setAttribute('data-rs-nlp-source', it.term.source);
        frag.appendChild(mark);
        hits++;
        cursor = it.end;
      }
      if (cursor < value.length) frag.appendChild(document.createTextNode(value.slice(cursor)));
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    }

    _nlpHighlightActive = true;
    const clearBtn = document.getElementById('rs-nlp-clear-btn');
    const hlBtn = document.getElementById('rs-nlp-highlight-btn');
    if (clearBtn) clearBtn.style.display = '';
    if (hlBtn) {
      hlBtn.textContent = hits ? `Highlighted (${hits})` : 'No matches on page';
      hlBtn.disabled = false;
    }
  }

  function renderNlpResult(data) {
    const body = document.getElementById('rs-nlp-body');
    if (!body) return;
    const hlBtn = document.getElementById('rs-nlp-highlight-btn');
    if (!data?.ok) {
      _nlpLastData = null;
      if (hlBtn) hlBtn.disabled = true;
      body.innerHTML = `<div class="rs-nlp-err">${escapeHtml(data?.error || 'Analysis failed')}</div>
        ${data?.needKey ? '<div class="rs-nlp-hint">Open ShahzaibSEO → Settings → Data API Keys → TextRazor key.</div>' : ''}`;
      return;
    }
    _nlpLastData = data;
    if (hlBtn) {
      hlBtn.disabled = false;
      hlBtn.textContent = 'Highlight on page';
    }

    const dedupeBy = (arr, keyFn) => {
      const m = new Map();
      for (const item of arr || []) {
        const k = keyFn(item);
        if (!k || m.has(k)) continue;
        m.set(k, item);
      }
      return [...m.values()];
    };
    const ent = dedupeBy(data.entities || [], e => String(e.id || '').toLowerCase()).slice(0, 28);
    const topics = dedupeBy(data.topics || [], t => String(t.label || '').toLowerCase()).slice(0, 10);
    const phrases = dedupeBy(data.phrases || [], p => String(p.text || '').toLowerCase()).slice(0, 12);
    const cats = dedupeBy(data.categories || [], c => String(c.label || '').toLowerCase()).slice(0, 4);
    const wikiCount = ent.filter(e => e.wiki).length;

    let html = `<div class="rs-nlp-metrics">
      <div><b>${ent.length}</b><span>Entities</span></div>
      <div><b>${wikiCount}</b><span>Wiki</span></div>
      <div><b>${topics.length}</b><span>Topics</span></div>
    </div>`;
    if (cats.length) {
      html += `<div class="rs-nlp-sec"><div class="rs-nlp-lab">Category</div><div class="rs-nlp-tags">` +
        cats.map(c => `<span class="rs-nlp-tag cat">${escapeHtml(c.label)}</span>`).join('') + `</div></div>`;
    }
    if (topics.length) {
      html += `<div class="rs-nlp-sec"><div class="rs-nlp-lab">Topics</div><div class="rs-nlp-tags">` +
        topics.map(t => `<span class="rs-nlp-tag topic" title="Topic">${escapeHtml(t.label)}</span>`).join('') + `</div></div>`;
    }
    if (ent.length) {
      html += `<div class="rs-nlp-sec"><div class="rs-nlp-lab">Entities · source</div><div class="rs-nlp-tags">` +
        ent.map(e => {
          // Prefer readable surface form when available
          const display = (e.matchedText && e.matchedText.length < 40) ? e.matchedText : e.id;
          const label = escapeHtml(String(display || e.id || '').replace(/_/g, ' '));
          const src = e.wiki ? 'Wikipedia' : 'TextRazor';
          if (e.wiki) return `<a class="rs-nlp-tag ent" href="${escapeHtml(e.wiki)}" target="_blank" rel="noopener" title="${src}">${label}<i>${src}</i></a>`;
          return `<span class="rs-nlp-tag ent" title="${src}">${label}<i>${src}</i></span>`;
        }).join('') + `</div></div>`;
    }
    if (phrases.length) {
      html += `<div class="rs-nlp-sec"><div class="rs-nlp-lab">Keyphrases</div><div class="rs-nlp-tags">` +
        phrases.map(p => `<span class="rs-nlp-tag ph" title="TextRazor phrase">${escapeHtml(p.text)}</span>`).join('') + `</div></div>`;
    }
    html += `<div class="rs-nlp-foot">Click <b>Highlight on page</b> to mark these terms on the live page.</div>`;
    body.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function runTextRazorNlp() {
    const panel = ensureNlpPanel();
    panel.style.display = 'flex';
    const body = document.getElementById('rs-nlp-body');
    if (body) body.innerHTML = '<div class="rs-nlp-loading">Analyzing page with TextRazor…</div>';
    const text = collectPageTextForNlp();
    chrome.runtime.sendMessage(
      { action: 'TEXTRAZOR_ANALYZE', text, url: location.href },
      (res) => {
        if (chrome.runtime.lastError) {
          renderNlpResult({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        renderNlpResult(res || { ok: false, error: 'No response' });
      }
    );
  }

  function toggleLinkHighlight(forceEnabled) {
    if (typeof forceEnabled === 'boolean') linkHighlightActive = forceEnabled;
    else linkHighlightActive = !linkHighlightActive;
    // Highlight is controlled from On-Page Labs → Links (toolbar Links button removed)
    window.dispatchEvent(new CustomEvent('rankseo:toggleLinkHighlights', {
      detail: { enabled: linkHighlightActive }
    }));
  }

  // Expose so Labs panel can toggle page highlights
  window.ShahzaibSEOToggleLinkHighlight = toggleLinkHighlight;

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '…' : str;
  }

  function numFormat(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  function formatType(t) {
    const map = {
      homepage: 'Home',
      article: 'Article',
      blog_index: 'Blog',
      product: 'Product',
      collection: 'Category',
      faq: 'FAQ',
      contact: 'Contact',
      about: 'About',
      landing: 'Landing',
      legal: 'Legal',
      pricing: 'Pricing',
      service: 'Service',
      event: 'Event',
      recipe: 'Recipe',
      portfolio: 'Portfolio',
      login: 'Login',
      search: 'Search',
      checkout: 'Checkout'
    };
    return map[t] || capitalize(t);
  }

  function pageTypeIcon(t) {
    const map = {
      homepage: '🏠', article: '📰', blog_index: '📚',
      product: '🛒', collection: '📦', faq: '❓',
      contact: '📧', about: 'ℹ️', landing: '🎯',
      legal: '⚖️', pricing: '💰', service: '🔧',
      event: '📅', recipe: '🍳', portfolio: '🎨',
      login: '🔑', search: '🔍', checkout: '🛒'
    };
    return map[t] || '📄';
  }

  function formatIntent(i) {
    const map = {
      informational: 'Info',
      transactional: 'Trans',
      commercial: 'Comm',
      navigational: 'Nav'
    };
    return map[i] || capitalize(i);
  }

  function intentIcon(i) {
    const map = {
      transactional: '🛒',
      informational: 'ℹ️',
      commercial: '📊',
      navigational: '🧭'
    };
    return map[i] || '📄';
  }

  // ─── Fetch and display Traffic ──────────────────────────────────────────────
  let _trafficFetchedDomain = null;
  function fetchTrafficPill(hostname) {
    const domain = (hostname || '').replace(/^www\./, '');
    if (!domain || _trafficFetchedDomain === domain) return;
    _trafficFetchedDomain = domain;

    const pill = document.getElementById('rankseo-traffic-score');
    const numEl = document.getElementById('rs-traffic-num');
    const tipBody = document.getElementById('rs-tr-tip-body');
    
    if (!pill || !numEl) return;
    
    // Show loading state
    numEl.textContent = '...';
    numEl.style.color = '#6366f1';

    const applyTraffic = (res) => {
      if (!res || !res.ok) return false;
      const visits = res.visits;
      if (!visits || visits === 0) return false;
      return true;
    };

    const requestTraffic = (attempt) => {
    chrome.runtime.sendMessage({ action: 'TRAFFIC_FETCH', domain }, (res) => {
      if (chrome.runtime.lastError) {
        if (attempt < 1) { setTimeout(() => requestTraffic(attempt + 1), 1500); return; }
        numEl.textContent = 'N/A';
        numEl.style.color = '#94a3b8';
        if (tipBody) tipBody.innerHTML = 'No traffic data';
        _trafficFetchedDomain = null; // allow retry on next update
        return;
      }
      
      if (!applyTraffic(res)) {
        if (attempt < 1) { setTimeout(() => requestTraffic(attempt + 1), 1500); return; }
        numEl.textContent = 'N/A';
        numEl.style.color = '#94a3b8';
        if (tipBody) tipBody.innerHTML = 'No traffic data';
        _trafficFetchedDomain = null;
        return;
      }
      
      // topCountryShares optional (SEMrush fallback won't have it — that's fine)
      
      const visits = res.visits;
      if (!visits || visits === 0) {
        numEl.textContent = 'N/A';
        numEl.style.color = '#94a3b8';
        if (tipBody) tipBody.innerHTML = 'No traffic data';
        return;
      }

      // Format number
      let fmt;
      if (visits >= 1000000) fmt = (visits / 1000000).toFixed(1) + 'M';
      else if (visits >= 1000) fmt = (visits / 1000).toFixed(0) + 'K';
      else fmt = String(visits);

      numEl.textContent = fmt;

      // Color by change direction
      if (res.visitsChangePercent != null) {
        numEl.style.color = res.visitsChangePercent >= 0 ? '#10b981' : '#ef4444';
      } else {
        numEl.style.color = '#6366f1';
      }

      // Build tooltip content
      if (tipBody) {
        const fmtN = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n);
        const chg = res.visitsChangePercent != null
          ? `<span style="color:${res.visitsChangePercent >= 0 ? '#10b981' : '#ef4444'};font-size:9px;"> ${res.visitsChangePercent >= 0 ? '▲' : '▼'} ${Math.abs(res.visitsChangePercent).toFixed(1)}%</span>`
          : '';

        const rows = [
          ['Monthly Visits', fmtN(visits) + chg],
          res.bounceRate != null ? ['Bounce Rate', (res.bounceRate * 100).toFixed(1) + '%'] : null,
          res.pagePerVisit != null ? ['Pages / Visit', Number(res.pagePerVisit).toFixed(2)] : null,
          res.timeOnSite != null ? ['Avg Duration', (Math.floor(res.timeOnSite/60) + 'm ' + (res.timeOnSite%60) + 's')] : null,
          res.globalRank   ? ['Global Rank', '#' + Number(res.globalRank).toLocaleString()] : null,
          res.countryRank  ? ['Country Rank', '#' + Number(res.countryRank).toLocaleString() + (res.countryCode ? ' ('+res.countryCode+')' : '')] : null,
        ].filter(Boolean);

        let html = rows.map(([lbl, val]) =>
          `<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px;">
            <span style="color:#64748b;">${lbl}</span>
            <span style="font-weight:600;color:#1e293b;">${val}</span>
          </div>`
        ).join('');

        // Top countries — flag + code on same line (e.g. 🇺🇸 US)
        if (res.topCountryShares && res.topCountryShares.length) {
          html += `<div style="margin-top:5px;padding-top:4px;border-top:1px solid #e2e8f0;font-size:9.5px;font-weight:700;color:#94a3b8;margin-bottom:2px;">TOP COUNTRIES</div>`;
          html += res.topCountryShares.slice(0, 3).map(c => {
            const code = String(c.CountryCode || c.Country || '').toUpperCase().replace(/[^A-Z]/g, '');
            const flag = code.length === 2
              ? `<img src="https://flagcdn.com/16x12/${code.toLowerCase()}.png" width="16" height="12" alt="${code}" style="display:inline-block;border-radius:2px;vertical-align:middle;flex-shrink:0;" onerror="this.style.display='none'">`
              : '';
            return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;padding:2px 0;gap:8px;">
              <span style="display:inline-flex;align-items:center;gap:5px;min-width:0;">${flag}<span style="font-weight:600;color:#0f172a;letter-spacing:.02em;">${code}</span></span>
              <span style="color:#0D9488;font-weight:600;flex-shrink:0;">${(c.Value*100).toFixed(1)}%</span>
            </div>`;
          }).join('');
        }

        // Top keywords
        if (res.swTopKeywords && res.swTopKeywords.length) {
          html += `<div style="margin-top:5px;padding-top:4px;border-top:1px solid #e2e8f0;font-size:9.5px;font-weight:700;color:#94a3b8;margin-bottom:2px;">TOP KEYWORDS</div>`;
          html += res.swTopKeywords.slice(0, 3).map(k => {
            const name = k.keyword || k.Name || k.name || '';
            const vol = k.volume != null ? k.volume : (k.Volume != null ? k.Volume : null);
            const volStr = vol == null ? '—' : (vol >= 1000 ? (vol / 1000).toFixed(0) + 'K' : String(vol));
            return `<div style="display:flex;justify-content:space-between;font-size:10px;padding:1px 0;">
              <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;">${name}</span>
              <span style="color:#10b981;font-weight:600;">${volStr}</span>
            </div>`;
          }).join('');
        }

        // Source only when traffic exists — at bottom
        if (res.source) {
          html += `<div style="margin-top:6px;padding-top:5px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:12px;font-size:10px;">
            <span style="color:#94a3b8;">Source</span>
            <span style="color:#0D9488;font-weight:700;">${res.source}</span>
          </div>`;
        }

        tipBody.innerHTML = html;
      }
    });
    };
    requestTraffic(0);
  }

  // Registrable domain for AGE/DA (subdomains → main domain)
  const RS_TWO_LEVEL = new Set([
    'co.uk','org.uk','com.au','com.br','com.pk','net.pk','org.pk','edu.pk',
    'gov.pk','fam.pk','biz.pk','web.pk','gob.pk','gok.pk','co.in','com.sg',
    'com.my','co.za','co.nz','com.tr','com.mx','co.jp','com.ng','com.qa'
  ]);
  function rsRootDomain(host) {
    const d = String(host || '').toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '').trim();
    const parts = d.split('.').filter(Boolean);
    if (parts.length <= 2) return d;
    const lastTwo = parts.slice(-2).join('.');
    if (RS_TWO_LEVEL.has(lastTwo)) return parts.slice(-3).join('.');
    return parts.slice(-2).join('.');
  }

  let _daFetchedDomain = null;
  function fetchDomainDA(hostname) {
    const domain = (hostname || '').replace(/^www\./, '');
    if (!domain || _daFetchedDomain === domain) return;
    _daFetchedDomain = domain;

    chrome.runtime.sendMessage({ action: 'MOZ_FETCH', domain }, (res) => {
      if (chrome.runtime.lastError) return;
      const daEl = document.getElementById('rs-da-num');
      const pill = document.getElementById('rankseo-da-score');
      if (!daEl || !pill) return;
      if (res && res.ok && res.domainAuthority > 0) {
        daEl.textContent = res.domainAuthority;
        // Color-code like Moz: 0-30 red, 31-50 orange, 51-70 yellow, 71+ green
        const da = res.domainAuthority;
        let colorClass = 'rs-da-low';
        if (da >= 71) colorClass = 'rs-da-high';
        else if (da >= 51) colorClass = 'rs-da-med';
        else if (da >= 31) colorClass = 'rs-da-fair';
        daEl.className = 'rankseo-score-value ' + colorClass;
        // Build rich MOZ DA tooltip
        const daTipBody = document.getElementById('rs-da-tip-body');
        if (daTipBody) {
          const fmtN = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(0)+'K' : String(n||0);
          const daColor = da >= 71 ? '#16a34a' : da >= 51 ? '#ca8a04' : da >= 31 ? '#ea580c' : '#dc2626';
          const rows = [
            ['Domain Authority', `<span style="color:${daColor};font-weight:700;">${da}<span style="font-size:9px;color:#94a3b8;">/100</span></span>`],
            ['Page Authority',   `<span style="font-weight:600;">${res.pageAuthority || '—'}</span>`],
            ['Backlinks',        fmtN(res.backlinks)],
            ['Referring Domains',fmtN(res.referringDomains)],
            ['Source',          `<span style="color:#94a3b8;font-size:9px;">${res.source || 'Keywords Everywhere'}</span>`],
          ];
          daTipBody.innerHTML = rows.map(([lbl, val]) =>
            `<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px;">
              <span style="color:#64748b;white-space:nowrap;">${lbl}</span>
              <span style="text-align:right;">${val}</span>
            </div>`
          ).join('');
        }

        // Update Spam pill
        const spamEl = document.getElementById('rs-spam-num');
        const spamPill = document.getElementById('rankseo-spam-score');
        if (spamEl && spamPill) {
          const spam = res.spamScore || 0;
          spamEl.textContent = spam + '%';
          let spamColor = 'rs-spam-low';
          if (spam >= 8) spamColor = 'rs-spam-high';
          else if (spam >= 4) spamColor = 'rs-spam-med';
          spamEl.className = 'rankseo-score-value ' + spamColor;
          // Build rich SPAM tooltip
          const spamTipTitle = document.getElementById('rs-spam-tip-title');
          const spamTipBody  = document.getElementById('rs-spam-tip-body');
          const spamLabel = spam < 4 ? 'Low Risk ✅' : spam < 8 ? 'Medium Risk ⚠️' : 'High Risk 🚨';
          const spamHexColor = spam < 4 ? '#16a34a' : spam < 8 ? '#ca8a04' : '#dc2626';
          if (spamTipTitle) spamTipTitle.style.color = spamHexColor;
          if (spamTipBody) {
            const spamRows = [
              ['Spam Score',   `<span style="color:${spamHexColor};font-weight:700;">${spam}%</span>`],
              ['Risk Level',   `<span style="color:${spamHexColor};font-weight:600;">${spamLabel}</span>`],
              ['What it means', spam < 4 ? 'Clean link profile' : spam < 8 ? 'Some spammy links' : 'Many spammy links'],
            ];
            spamTipBody.innerHTML = spamRows.map(([lbl, val]) =>
              `<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px;">
                <span style="color:#64748b;white-space:nowrap;">${lbl}</span>
                <span style="text-align:right;">${val}</span>
              </div>`
            ).join('');
          }
        }
      } else {
        daEl.textContent = '--';
      }
    });

    // Fetch Domain Age via RDAP
    chrome.runtime.sendMessage({ action: 'RDAP_LOOKUP', domain: (typeof rsRootDomain === 'function' ? rsRootDomain(domain) : domain) }, (r) => {
      if (chrome.runtime.lastError || !r || !r.ok) return;
      const ageEl = document.getElementById('rs-age-num');
      const agePill = document.getElementById('rankseo-age-score');
      if (!ageEl || !agePill) return;
      if (r.createdDate) {
        const created = new Date(r.createdDate);
        const now = new Date();
        const ms = now - created;
        const days = Math.floor(ms / (24 * 3600 * 1000));
        const yearsFloat = ms / (365.25 * 24 * 3600 * 1000);
        const years = Math.floor(yearsFloat);
        const months = Math.floor((ms % (365.25 * 24 * 3600 * 1000)) / (30.44 * 24 * 3600 * 1000));
        // Pill: days if < 30d, else m / y
        let ageText;
        if (days < 30) ageText = Math.max(0, days) + 'd';
        else if (years < 1) ageText = Math.max(1, months || 1) + 'm';
        else if (months > 0) ageText = years + 'y ' + months + 'm';
        else ageText = years + 'y';
        ageEl.textContent = ageText;
        let ageLabel;
        if (days < 30) ageLabel = Math.max(0, days) + ' day' + (days !== 1 ? 's' : '');
        else if (years < 1) ageLabel = Math.max(1, months || 1) + ' month' + ((months || 1) !== 1 ? 's' : '');
        else ageLabel = years + ' year' + (years !== 1 ? 's' : '') + (months > 0 ? ' ' + months + ' month' + (months !== 1 ? 's' : '') : '');
        let ageColor = 'rs-age-new';
        if (years >= 5) ageColor = 'rs-age-old';
        else if (years >= 2) ageColor = 'rs-age-med';
        ageEl.className = 'rankseo-score-value ' + ageColor;

        // Build tooltip
        const tipBody = document.getElementById('rs-age-tip-body');
        if (tipBody) {
          const fmt = d => d ? new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—';
          const expiry = r.expirationDate ? new Date(r.expirationDate) : null;
          const now = new Date();
          let expiryHtml = fmt(r.expirationDate);
          if (expiry) {
            const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            const expiryColor = daysLeft < 30 ? '#ef4444' : daysLeft < 90 ? '#f59e0b' : '#16a34a';
            expiryHtml += ` <span style="color:${expiryColor};font-size:9px;">(${daysLeft}d left)</span>`;
          }
          const rows = [
            ['Domain Age', ageLabel],
            ['Domain', (typeof rsRootDomain === 'function' ? rsRootDomain(domain) : domain)],
            ['Registered', fmt(r.createdDate)],
            ['Expires', expiryHtml],
            r.updatedDate ? ['Updated', fmt(r.updatedDate)] : null,
            r.registrar   ? ['Registrar', r.registrar] : null,
          ].filter(Boolean);
          tipBody.innerHTML = rows.map(([lbl, val]) =>
            `<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;font-size:10px;">
              <span style="color:#64748b;white-space:nowrap;">${lbl}</span>
              <span style="font-weight:600;color:#1e293b;text-align:right;">${val}</span>
            </div>`
          ).join('');
        }
      } else {
        ageEl.textContent = '--';
      }
    });
  }

  function showError() {
    const metricsEl = document.getElementById('rankseo-metrics');
    if (metricsEl) {
      metricsEl.innerHTML = `<span style="color:#ef4444;font-size:11px">Analysis failed — reload page</span>`;
    }
  }

  // ─── Ahrefs DR Free Fetch ────────────────────────────────────────
  let _drFetchedDomain = null;
  function fetchAhrefsDR(hostname) {
    const domain = (hostname || '').replace(/^www\./, '');
    if (!domain || _drFetchedDomain === domain) return;
    _drFetchedDomain = domain;

    const drEl = document.getElementById('rs-dr-num');
    const tipBody = document.getElementById('rs-dr-tip-body');
    if (drEl) { drEl.textContent = '…'; drEl.style.color = '#f97316'; }
    if (tipBody) tipBody.innerHTML = '<span style="color:#94a3b8;font-size:10px;">Fetching Ahrefs DR…</span>';

    const applyDR = (res) => {
      const el = document.getElementById('rs-dr-num');
      const pill = document.getElementById('rankseo-dr-score');
      const tip = document.getElementById('rs-dr-tip-body');
      if (!el || !pill) return;

      if (res && res.ok && res.domainRating != null) {
        const dr = Math.round(res.domainRating);
        el.textContent = dr;
        el.style.color = '';
        let colorClass = 'rs-da-low';
        if (dr >= 71) colorClass = 'rs-da-high';
        else if (dr >= 51) colorClass = 'rs-da-med';
        else if (dr >= 31) colorClass = 'rs-da-fair';
        el.className = 'rankseo-score-value ' + colorClass;

        if (tip) {
          const drColor  = dr >= 71 ? '#16a34a' : dr >= 51 ? '#ca8a04' : dr >= 31 ? '#ea580c' : '#dc2626';
          const tier     = dr >= 71 ? 'High Authority' : dr >= 51 ? 'Good Authority' : dr >= 31 ? 'Fair Authority' : dr >= 10 ? 'Low Authority' : 'Very Low / New';
          const pctile   = dr >= 80 ? 99 : dr >= 70 ? 97 : dr >= 60 ? 93 : dr >= 50 ? 85 : dr >= 40 ? 72 : dr >= 30 ? 55 : dr >= 20 ? 38 : dr >= 10 ? 20 : 5;
          const pct      = Math.min(100, dr);
          const daNumEl  = document.getElementById('rs-da-num');
          const daVal    = daNumEl ? parseInt(daNumEl.textContent, 10) : NaN;
          const hasDa    = !isNaN(daVal) && daVal > 0;
          const diff     = hasDa ? dr - daVal : null;
          const diffTxt  = diff !== null
            ? `<span style="color:${diff >= 0 ? '#16a34a' : '#ef4444'};font-weight:700;">${diff >= 0 ? '+' : ''}${diff}</span> vs DA`
            : '';
          tip.innerHTML = `
            <div style="font-size:10px;font-weight:700;color:${drColor};margin-bottom:5px;">${tier}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
              <div style="flex:1;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:${drColor};border-radius:2px;"></div>
              </div>
              <span style="font-size:9px;color:#94a3b8;white-space:nowrap;">${dr}/100</span>
            </div>
            ${[
              ['Percentile',  `Better than <span style="color:${drColor};font-weight:700;">~${pctile}%</span> of sites`],
              hasDa ? ['DA vs DR', diffTxt] : null,
              ['Source',      '<span style="color:#f97316;font-weight:600;">Ahrefs Free API</span>'],
            ].filter(Boolean).map(([lbl, val]) =>
              `<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;font-size:10px;">
                <span style="color:#64748b;white-space:nowrap;">${lbl}</span>
                <span style="text-align:right;">${val}</span>
              </div>`
            ).join('')}`;
        }
        return true;
      }
      return false;
    };

    const requestDR = (attempt) => {
      chrome.runtime.sendMessage({ action: 'AHREFS_DR_FETCH', domain }, (res) => {
        if (chrome.runtime.lastError) {
          if (attempt < 2) {
            setTimeout(() => requestDR(attempt + 1), 1200 * (attempt + 1));
            return;
          }
          if (drEl) { drEl.textContent = '--'; drEl.style.color = '#94a3b8'; }
          if (tipBody) tipBody.innerHTML = '<span style="color:#94a3b8;font-size:10px;">Extension messaging error — reload page</span>';
          return;
        }
        if (applyDR(res)) return;
        if (attempt < 2) {
          // Clear SW cache then retry
          chrome.runtime.sendMessage({ action: 'AHREFS_CLEAR_CACHE', domain }, () => {
            void chrome.runtime.lastError;
            setTimeout(() => requestDR(attempt + 1), 1000 * (attempt + 1));
          });
          return;
        }
        if (drEl) { drEl.textContent = '--'; drEl.style.color = '#94a3b8'; }
        const err = res?.error ? String(res.error) : 'unavailable';
        if (tipBody) {
          tipBody.innerHTML = `<span style="color:#94a3b8;font-size:10px;">DR ${err}. Set Ahrefs key in Settings → Data API Keys, then reload page.</span>`;
        }
      });
    };
    requestDR(0);
  }

  // ─── Fetch Sitemap Pages Count ─────────────────────────────────────────────
  let _pagesFetchedDomain = null;
  function fetchSitemapPages(hostname) {
    const domain = (hostname || '').replace(/^www\./, '');
    if (!domain || _pagesFetchedDomain === domain) return;
    _pagesFetchedDomain = domain;

    const pagesEl = document.getElementById('rs-pages-num');
    const pagesPill = document.getElementById('rankseo-pages-score');
    const tipBody = document.getElementById('rs-pages-tip-body');
    
    if (!pagesEl || !pagesPill) return;
    
    // Show pill immediately with loading state
    pagesPill.style.display = '';
    pagesEl.textContent = '...';
    pagesEl.className = 'rankseo-score-value';

    chrome.runtime.sendMessage({ action: 'FETCH_SITEMAP_PAGES', domain }, (res) => {
      if (chrome.runtime.lastError) {
        pagesEl.textContent = 'N/A';
        if (tipBody) tipBody.innerHTML = 'Sitemap not accessible';
        return;
      }
      
      if (res && res.ok && res.pages > 0) {
        // Format number with K/M suffix
        const fmtPages = res.pages >= 1e6 ? (res.pages/1e6).toFixed(1)+'M' 
                       : res.pages >= 1e3 ? (res.pages/1e3).toFixed(1)+'K' 
                       : String(res.pages);
        
        pagesEl.textContent = fmtPages;
        
        // Color code based on page count
        let colorClass = 'rs-pages-low';
        if (res.pages >= 1000) colorClass = 'rs-pages-high';
        else if (res.pages >= 100) colorClass = 'rs-pages-med';
        pagesEl.className = 'rankseo-score-value ' + colorClass;
        
        // Update tooltip
        if (tipBody) {
          const rows = [
            ['Total Pages', `<span style="font-weight:700;color:#10b981;">${res.pages.toLocaleString()}</span>`],
            ['Source', 'Sitemap.xml'],
            ['Status', res.pages >= 100 ? '✅ Good coverage' : res.pages >= 50 ? '⚠️ Moderate' : '🔍 Small site'],
          ];
          tipBody.innerHTML = rows.map(([lbl, val]) =>
            `<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px;">
              <span style="color:#64748b;white-space:nowrap;">${lbl}</span>
              <span style="text-align:right;">${val}</span>
            </div>`
          ).join('');
        }
      } else {
        // No sitemap found - show N/A but keep pill visible
        pagesEl.textContent = 'N/A';
        pagesEl.className = 'rankseo-score-value';
        pagesEl.style.color = '#94a3b8';
        
        if (tipBody) {
          tipBody.innerHTML = `
            <div style="font-size:10px;color:#64748b;line-height:1.4;">
              <div style="margin-bottom:4px;">❌ No sitemap found</div>
              <div style="font-size:9px;color:#94a3b8;">Checked common paths:<br>
              • /sitemap.xml<br>
              • /sitemap_index.xml<br>
              • /wp-sitemap.xml<br>
              • robots.txt directives</div>
            </div>
          `;
        }
      }
    });
  }

  // ─── Listen for analysis results from background ──────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'analysisReady' && msg.data) {
      updateToolbar(msg.data);
    }
    if (msg.action === 'toggleToolbar') {
      if (!toolbarEl) {
        injectStyles();
        createToolbar();
        return false;
      }
      const isCurrentlyHidden = toolbarEl.classList.contains('rankseo-hidden');
      const show = msg.show !== undefined ? msg.show : isCurrentlyHidden;
      isHidden = !show;
      toolbarEl.classList.toggle('rankseo-hidden', isHidden);
      document.body.classList.toggle('rankseo-has-toolbar', show);
      document.body.classList.toggle('rankseo-toolbar-bottom', show && toolbarPosition === 'bottom');
      updateToggleUI();
      updatePosToggleUI();
    }
    return false; // no async response needed
  });

})();