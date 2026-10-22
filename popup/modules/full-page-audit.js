/**
 * Full Page Audit - reliable click + inject extract (no content-script dependency)
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const BUILTIN_GROQ = '';
  const BUILTIN_MODEL = 'qwen/qwen3.8-27b';

  let _lastReport = null;
  let _running = false;

  function setProgress(pct, msg) {
    const bar = $('fullAuditProgressBar');
    const status = $('fullAuditStatus');
    const wrap = $('fullAuditProgress');
    const tabSt = $('fullAuditTabStatus');
    const out = $('fullAuditOutput');
    if (wrap) wrap.style.display = 'block';
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (status) status.textContent = msg || '';
    if (tabSt) tabSt.textContent = msg || '';
    if (out && pct > 0 && pct < 100) {
      out.style.display = 'block';
      if (!out.dataset.hasReport) {
        out.innerHTML = '<div style="color:#64748b;">' + esc(msg || 'Working...') + '</div>';
      }
    }
    const btn = $('fullAuditRunBtn');
    if (btn && _running) btn.textContent = '... ' + (msg || 'Working').slice(0, 28);
  }

  function showButtons(hasReport) {
    ['fullAuditViewBtn', 'fullAuditCopyBtn', 'fullAuditMdBtn'].forEach(id => {
      const el = $(id);
      if (el) el.style.display = hasReport ? '' : 'none';
    });
  }

  function notify(msg) {
    try {
      if (typeof toast === 'function') toast(msg);
    } catch (_) {}
    console.log('[FullPageAudit]', msg);
  }

  /**
   * Injected into the page - scroll + collect snapshot (runs in page world via scripting)
   */
  async function pageExtractFn() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const startY = window.scrollY;
    const t0 = Date.now();
    const maxMs = 10000;
    const stepPx = Math.max(280, Math.floor(window.innerHeight * 0.8));

    try {
      document.querySelectorAll('button, a, [role="button"], summary').forEach((el) => {
        const t = (el.textContent || '').trim().toLowerCase();
        if (/read more|show more|see more|load more|expand|view more/.test(t)) {
          try { el.click(); } catch (_) {}
        }
      });
    } catch (_) {}

    let y = 0;
    let maxY = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement.scrollHeight
    );
    while (y < maxY - 20 && Date.now() - t0 < maxMs) {
      y = Math.min(y + stepPx, maxY);
      window.scrollTo(0, y);
      await sleep(220);
      maxY = Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement.scrollHeight
      );
    }
    window.scrollTo(0, startY);

    let fullText = '';
    try {
      // Clone body and strip ShahzaibSEO / extension UI so scores & toolbars
      // are not scraped as "page content"
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll([
        '#rankseo-toolbar', '#rs-labs-panel', '#rs-sidebar-host',
        '[id^="rs-"]', '[class*="rs-serp"]', '[class*="rs-labs"]',
        '[class*="rs-toolbar"]', '[data-rs-result]', '.rs-weak-flag',
        '.rs-serp-num', '.rs-kws-pill', '.rs-facts-line',
        'script', 'style', 'noscript', 'iframe', 'svg'
      ].join(',')).forEach((n) => { try { n.remove(); } catch (_) {} });
      fullText = (clone.innerText || clone.textContent || '')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch (_) {
      try {
        fullText = (document.body.innerText || document.body.textContent || '')
          .replace(/\s+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      } catch (__) {}
    }
    if (fullText.length > 100000) fullText = fullText.slice(0, 100000) + '\n...[truncated]';

    const outline = [];
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => {
      if (outline.length >= 80) return;
      const level = parseInt((h.tagName || 'H2').replace(/\D/g, ''), 10) || 2;
      const text = (h.innerText || h.textContent || '').trim().replace(/\s+/g, ' ');
      if (text) outline.push({ level, text: text.slice(0, 200), index: i });
    });

    const meta = {
      title: document.title || '',
      description: (document.querySelector('meta[name="description"]') || {}).content || '',
      canonical: (document.querySelector('link[rel="canonical"]') || {}).href || '',
      robots: (document.querySelector('meta[name="robots"]') || {}).content || '',
      lang: document.documentElement.lang || '',
      h1: ((document.querySelector('h1') || {}).innerText || '').trim().slice(0, 200)
    };

    const schemaTypes = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const j = JSON.parse(s.textContent || '');
        const arr = Array.isArray(j) ? j : [j];
        arr.forEach((obj) => {
          if (obj && obj['@type']) {
            const t = obj['@type'];
            (Array.isArray(t) ? t : [t]).forEach((x) => schemaTypes.push(String(x)));
          }
          if (obj && obj['@graph']) {
            obj['@graph'].forEach((g) => {
              if (g && g['@type']) schemaTypes.push(String(g['@type']));
            });
          }
        });
      } catch (_) {}
    });

    const imgs = Array.from(document.images || []);
    const links = Array.from(document.querySelectorAll('a[href]'));
    const host = location.hostname.replace(/^www\./, '');
    let internal = 0;
    let external = 0;
    let missingAlt = 0;
    imgs.forEach((im) => {
      if (!(im.alt || '').trim()) missingAlt++;
    });
    links.forEach((a) => {
      try {
        const h = new URL(a.href, location.href).hostname.replace(/^www\./, '');
        if (!h || h === host) internal++;
        else if (!a.href.startsWith('javascript:')) external++;
      } catch (_) {}
    });

    const words = fullText.split(/\s+/).filter(Boolean);

    return {
      ok: true,
      url: location.href,
      extractedAt: new Date().toISOString(),
      scrollMs: Date.now() - t0,
      meta,
      outline,
      schemaTypes: [...new Set(schemaTypes)].slice(0, 30),
      stats: {
        wordCount: words.length,
        charCount: fullText.length,
        headingCount: outline.length,
        imageCount: imgs.length,
        missingAlt,
        linkCount: links.length,
        internalLinks: internal,
        externalLinks: external
      },
      fullText,
      analysis: null
    };
  }

  async function extractPage(tabId) {
    // Primary: isolated world inject (does not need content.js)
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageExtractFn
      });
      const r = results && results[0] && results[0].result;
      if (r && r.ok) return r;
      if (r && r.url) return { ...r, ok: true };
    } catch (e) {
      console.warn('[FullPageAudit] scripting extract failed', e);
    }

    // Secondary: content script message
    try {
      const msg = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 8000);
        chrome.tabs.sendMessage(tabId, { action: 'fullPageExtract', options: { maxMs: 8000 } }, (r) => {
          clearTimeout(t);
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      });
      if (msg && (msg.ok || msg.fullText || msg.meta)) return { ...msg, ok: true };
    } catch (_) {}

    // Tertiary: analyze only
    try {
      const analysis = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 8000);
        chrome.tabs.sendMessage(tabId, { action: 'analyze' }, (r) => {
          clearTimeout(t);
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      });
      if (analysis) {
        return {
          ok: true,
          url: analysis.url || '',
          extractedAt: new Date().toISOString(),
          scrollMs: 0,
          meta: {
            title: analysis.title?.content || '',
            description: analysis.metaDescription?.content || '',
            canonical: analysis.technical?.canonical || '',
            robots: analysis.technical?.robots || '',
            lang: analysis.technical?.language || '',
            h1: (analysis.headings?.structure?.h1 || [])[0] || ''
          },
          outline: (analysis.headings?.orderedHeadings || []).slice(0, 40).map((h, i) => ({
            level: h.level || 2,
            text: h.text || '',
            index: i
          })),
          schemaTypes: [],
          stats: {
            wordCount: analysis.content?.wordCount || 0,
            charCount: 0,
            headingCount: analysis.headings?.totalHeadings || 0,
            imageCount: analysis.images?.total || 0,
            missingAlt: analysis.images?.withoutAlt || 0,
            linkCount: analysis.links?.total || 0,
            internalLinks: analysis.links?.internal || 0,
            externalLinks: analysis.links?.external || 0
          },
          fullText: '',
          analysis
        };
      }
    } catch (_) {}

    return { ok: false, error: 'Could not extract page. Refresh the tab and try again.' };
  }

  function fetchTinyFishCompetitors(keyword) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, results: [], error: 'TinyFish timeout' }), 30000);
      try {
        chrome.runtime.sendMessage(
          {
            action: 'MONID_RUN',
            provider: 'tinyfish',
            endpoint: '/search',
            query: {
              query: keyword,
              purpose: 'Competitor SERP for full page audit',
              location: 'US',
              language: 'en',
              page: 0
            },
            waitMs: 25000
          },
          (r) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError || !r || !r.ok) {
              resolve({
                ok: false,
                results: [],
                error: (r && r.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'TinyFish failed'
              });
              return;
            }
            const out = r.output || (r.data && r.data.output) || r.data || {};
            const rows = out.results || out.items || [];
            resolve({
              ok: !!rows.length,
              results: rows.slice(0, 8).map((x, i) => ({
                position: x.position || i + 1,
                title: x.title || '',
                url: x.url || '',
                snippet: x.snippet || ''
              }))
            });
          }
        );
      } catch (e) {
        clearTimeout(timer);
        resolve({ ok: false, results: [], error: e.message });
      }
    });
  }

  async function callGroq(prompt) {
    const stored = await new Promise((res) => {
      chrome.storage.local.get(['groqApiKey', 'groqModel'], res);
    });
    const apiKey = (stored.groqApiKey || '').trim() || BUILTIN_GROQ;
    const model = stored.groqModel || BUILTIN_MODEL;

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You write SEO audit reports in VERY SIMPLE English (about 5th grade). Short sentences. Easy words. No jargon unless you explain it in one short line. Every issue must say: what is wrong, why it is bad, and the exact fix. Use only real facts from the page evidence. No markdown tables. Date context: September 2026.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4200,
        temperature: 0.25
      }),
      signal: AbortSignal.timeout(90000)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error((data.error && data.error.message) || data.message || 'Groq HTTP ' + resp.status);
    }
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  }

  function buildRulesSummary(extract, competitors, keyword) {
    // Compact evidence for the AI prompt only (not for visible UI)
    const st = extract.stats || {};
    const meta = extract.meta || {};
    const lines = [];
    lines.push('# Page evidence');
    lines.push('URL: ' + (extract.url || ''));
    if (keyword) lines.push('Target keyword: ' + keyword);
    lines.push('Title (' + (meta.title || '').length + ' chars): ' + (meta.title || '-'));
    lines.push('Meta (' + (meta.description || '').length + ' chars): ' + (meta.description || '-'));
    lines.push('H1: ' + (meta.h1 || '-'));
    lines.push('Canonical: ' + (meta.canonical || '-'));
    lines.push('Robots: ' + (meta.robots || '-'));
    lines.push('Lang: ' + (meta.lang || '-'));
    lines.push('Words: ' + (st.wordCount || 0) + ' | Headings: ' + (st.headingCount || 0) +
      ' | Images: ' + (st.imageCount || 0) + ' (no alt: ' + (st.missingAlt || 0) + ')' +
      ' | Links: ' + (st.linkCount || 0));
    lines.push('Schema: ' + ((extract.schemaTypes || []).join(', ') || 'none'));
    lines.push('Headings:');
    (extract.outline || []).slice(0, 30).forEach((h) => {
      lines.push('  H' + h.level + ': ' + h.text);
    });
    if (competitors && competitors.results && competitors.results.length) {
      lines.push('Competitors:');
      competitors.results.slice(0, 10).forEach((r) => {
        lines.push('  ' + r.position + '. ' + r.title);
      });
    }
    // Limit body text for AI — never dump ShahzaibSEO UI
    const body = String(extract.fullText || '')
      .replace(/\b(RANKSEO|SEO SCORE|GEO SCORE|AI VISIBILITY|ISSUES\s*\(\d+\))\b/gi, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 12000);
    lines.push('Body text sample:');
    lines.push(body);
    return lines.join('\n');
  }

  /** Clean card-based HTML for the Full Audit tab (not raw markdown dump) */
  function renderSnapshotCards(extract, competitors, keyword) {
    const st = extract.stats || {};
    const meta = extract.meta || {};
    const titleLen = (meta.title || '').length;
    const descLen = (meta.description || '').length;
    const h1Count = (extract.outline || []).filter((h) => h.level === 1).length;

    function pill(ok, label) {
      const bg = ok === true ? '#dcfce7' : (ok === false ? '#fee2e2' : '#f1f5f9');
      const col = ok === true ? '#166534' : (ok === false ? '#991b1b' : '#475569');
      return '<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:' +
        bg + ';color:' + col + ';">' + esc(label) + '</span>';
    }
    function row(label, value, hint) {
      return '<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">' +
        '<span style="color:#64748b;font-weight:600;">' + esc(label) + '</span>' +
        '<span style="text-align:right;color:#0f172a;max-width:65%;word-break:break-word;">' + value +
        (hint ? '<div style="font-size:10px;color:#94a3b8;font-weight:500;margin-top:2px;">' + esc(hint) + '</div>' : '') +
        '</span></div>';
    }
    function card(title, body) {
      return '<div style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;">' +
        '<div style="padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:800;color:#0f172a;">' +
        esc(title) + '</div>' +
        '<div style="padding:4px 12px 10px;">' + body + '</div></div>';
    }

    let html = '';

    // Stat chips
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">';
    [
      ['Words', st.wordCount || 0],
      ['Headings', st.headingCount || 0],
      ['Images', st.imageCount || 0],
      ['Missing alt', st.missingAlt || 0],
      ['Links', st.linkCount || 0],
      ['Schema', (extract.schemaTypes || []).length]
    ].forEach(function (pair) {
      html += '<div style="min-width:72px;padding:8px 10px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;text-align:center;">' +
        '<div style="font-size:16px;font-weight:800;color:#0f172a;">' + esc(String(pair[1])) + '</div>' +
        '<div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.03em;">' + esc(pair[0]) + '</div></div>';
    });
    html += '</div>';

    if (keyword) {
      html += '<div style="margin-bottom:12px;font-size:12px;color:#475569;">Target keyword: <b style="color:#0f172a;">' + esc(keyword) + '</b></div>';
    }

    html += card('On-page essentials',
      row('Title', esc(meta.title || '—') + ' ' +
        pill(titleLen >= 30 && titleLen <= 60, titleLen + ' chars'), titleLen > 60 ? 'May be truncated in SERP' : '') +
      row('Meta description', esc((meta.description || '—').slice(0, 120)) +
        (meta.description && meta.description.length > 120 ? '…' : '') + ' ' +
        pill(descLen >= 70 && descLen <= 160, descLen + ' chars')) +
      row('H1', esc(meta.h1 || '—') + ' ' + pill(h1Count === 1, h1Count === 1 ? '1 H1' : (h1Count + ' H1s'))) +
      row('Canonical', esc(meta.canonical || 'Missing')) +
      row('Robots', esc(meta.robots || 'Not set')) +
      row('Language', esc(meta.lang || 'Missing'))
    );

    const schema = (extract.schemaTypes || []).slice(0, 12);
    html += card('Schema & links',
      row('Schema types', schema.length ? esc(schema.join(', ')) : 'None detected') +
      row('Internal links', String(st.internalLinks || 0)) +
      row('External links', String(st.externalLinks || 0)) +
      row('Images missing alt', String(st.missingAlt || 0))
    );

    const outline = (extract.outline || []).slice(0, 20);
    if (outline.length) {
      let ob = '';
      outline.forEach(function (h) {
        const pad = Math.max(0, (h.level || 2) - 1) * 12;
        ob += '<div style="padding:4px 0 4px ' + pad + 'px;font-size:12px;border-bottom:1px solid #f8fafc;">' +
          '<span style="font-size:10px;font-weight:800;color:#94a3b8;margin-right:6px;">H' + h.level + '</span>' +
          esc(h.text) + '</div>';
      });
      html += card('Heading outline', ob);
    }

    if (competitors && competitors.results && competitors.results.length) {
      let cb = '';
      competitors.results.slice(0, 8).forEach(function (r) {
        cb += '<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">' +
          '<b style="color:#0d9488;">#' + esc(String(r.position)) + '</b> ' + esc(r.title || '') +
          '<div style="font-size:10px;color:#94a3b8;word-break:break-all;">' + esc(r.url || '') + '</div></div>';
      });
      html += card('Competitor SERP', cb);
    }

    return html;
  }

  function priorityBadge(p) {
    const u = String(p || '').toUpperCase();
    let bg = '#e2e8f0';
    let color = '#334155';
    if (u.includes('CRITICAL')) { bg = '#fee2e2'; color = '#b91c1c'; }
    else if (u.includes('HIGH')) { bg = '#ffedd5'; color = '#c2410c'; }
    else if (u.includes('MEDIUM')) { bg = '#fef9c3'; color = '#a16207'; }
    else if (u.includes('LOW')) { bg = '#dcfce7'; color = '#15803d'; }
    return '<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:' + bg + ';color:' + color + ';letter-spacing:.02em;">' + esc(u.replace(/[\[\]]/g, '')) + '</span>';
  }

  function scoreBadge(s) {
    const u = String(s || '').toLowerCase();
    let bg = '#e2e8f0';
    let color = '#334155';
    let label = s;
    if (/good|excellent|strong|yes\b/.test(u)) { bg = '#dcfce7'; color = '#15803d'; }
    else if (/ok|partly|moderate|fair/.test(u)) { bg = '#fef9c3'; color = '#a16207'; }
    else if (/weak|poor|no\b|bad|missing/.test(u)) { bg = '#fee2e2'; color = '#b91c1c'; }
    return '<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:' + bg + ';color:' + color + ';">' + esc(label) + '</span>';
  }

  function htmlTable(headers, rows) {
    let h =
      '<div style="overflow:auto;margin:8px 0 12px;border:1px solid #e2e8f0;border-radius:10px;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px;line-height:1.4;">' +
      '<thead><tr style="background:#f8fafc;text-align:left;">';
    headers.forEach((hd) => {
      h += '<th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">' + esc(hd) + '</th>';
    });
    h += '</tr></thead><tbody>';
    rows.forEach((row, i) => {
      const bg = i % 2 ? '#fafafa' : '#fff';
      h += '<tr style="background:' + bg + ';">';
      row.forEach((cell, ci) => {
        // cell may already be HTML (badges)
        const isHtml = typeof cell === 'string' && cell.indexOf('<') !== -1;
        h +=
          '<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">' +
          (isHtml ? cell : esc(String(cell))) +
          '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  /**
   * Turn audit markdown into compact, table-style HTML (less empty space).
   */
  function simpleMarkdownToHtml(md) {
    let text = String(md || '').replace(/\r\n/g, '\n').trim();

    // --- Issue blocks -> HTML table ---
    const issueRe =
      /(?:^|\n)\s*(?:[-*]\s*)?(\[(?:CRITICAL|HIGH|MEDIUM|LOW)\])\s*\n+\s*Problem:\s*([^\n]+)\s*\n+\s*Why bad:\s*([^\n]+)\s*\n+\s*Fix:\s*([^\n]+)/gi;

    const issues = [];
    text = text.replace(issueRe, (_, pri, problem, why, fix) => {
      issues.push({ pri: pri.trim(), problem: problem.trim(), why: why.trim(), fix: fix.trim() });
      return '\n%%ISSUE_TABLE%%\n';
    });
    text = text.replace(/(?:%%ISSUE_TABLE%%\s*)+/g, '\n%%ISSUE_TABLE%%\n');

    let issueTableHtml = '';
    if (issues.length) {
      issueTableHtml = htmlTable(
        ['Priority', 'Problem', 'Why bad', 'Fix'],
        issues.map((it) => [
          priorityBadge(it.pri),
          it.problem,
          '<span style="color:#64748b;">' + esc(it.why) + '</span>',
          '<span style="color:#0f766e;">' + esc(it.fix) + '</span>'
        ])
      );
    }

    // --- Fix order: "1. [PRIORITY] text" or "1. text" blocks -> table ---
    text = text.replace(
      /((?:^\s*\d+\.\s*(?:\[(?:CRITICAL|HIGH|MEDIUM|LOW|PRIORITY)\])?\s*.+\n?){2,})/gim,
      (block) => {
        const rows = [];
        block.split('\n').forEach((line) => {
          const m = line.trim().match(/^(\d+)\.\s*(?:\[([^\]]+)\])?\s*(.+)$/);
          if (m) {
            rows.push([
              m[1],
              m[2] ? priorityBadge(m[2]) : priorityBadge('MEDIUM'),
              m[3]
            ]);
          }
        });
        if (rows.length < 2) return block;
        return '\n%%RAWHTML%%' + htmlTable(['#', 'Priority', 'Action'], rows) + '%%/RAWHTML%%\n';
      }
    );

    // --- Current X / Better X pairs -> table ---
    text = text.replace(
      /((?:^(?:Current|Better)\s+(?:Title|Meta|Meta Description|H1|H2)[^:]*:\s*.+\n?){2,})/gim,
      (block) => {
        const map = {};
        block.split('\n').forEach((line) => {
          const m = line.trim().match(/^(Current|Better)\s+(Title|Meta(?:\s*Description)?|H1|H2[^:]*)\s*:\s*(.+)$/i);
          if (m) {
            const key = m[2].replace(/\s*Description/i, '').trim();
            if (!map[key]) map[key] = {};
            map[key][m[1].toLowerCase()] = m[3].trim();
          }
        });
        const keys = Object.keys(map);
        if (!keys.length) return block;
        const rows = keys.map((k) => [
          k,
          map[k].current || '—',
          '<span style="color:#0f766e;">' + esc(map[k].better || '—') + '</span>'
        ]);
        return '\n%%RAWHTML%%' + htmlTable(['Field', 'Current', 'Better (use this)'], rows) + '%%/RAWHTML%%\n';
      }
    );

    // --- AI factors: "1. Name: Good" or "Name: Weak (...)" ---
    text = text.replace(
      /((?:^\s*(?:\d+\.\s*)?[A-Za-z][^:\n]{2,40}:\s*(?:Good|OK|Weak|Poor|Excellent|Partly|Yes|No)\b[^\n]*\n?){2,})/gim,
      (block) => {
        const rows = [];
        block.split('\n').forEach((line) => {
          const m = line.trim().match(/^(?:\d+\.\s*)?([^:]+):\s*(Good|OK|Weak|Poor|Excellent|Partly|Yes|No)\b(.*)$/i);
          if (m) {
            rows.push([
              m[1].trim(),
              scoreBadge(m[2] + (m[3] || '').trim())
            ]);
          }
        });
        if (rows.length < 2) return block;
        return '\n%%RAWHTML%%' + htmlTable(['Factor', 'Score'], rows) + '%%/RAWHTML%%\n';
      }
    );

    // --- Checklist lines: - [ ] task ---
    text = text.replace(
      /((?:^\s*[-*]\s*\[\s*[xX ]\s*\]\s*.+\n?){2,})/gm,
      (block) => {
        const items = [];
        block.split('\n').forEach((line) => {
          const m = line.trim().match(/^[-*]\s*\[\s*([xX ])\s*\]\s*(.+)$/);
          if (m) {
            const done = /x/i.test(m[1]);
            items.push(
              '<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;">' +
                '<span style="width:16px;height:16px;border:2px solid ' +
                (done ? '#16a34a' : '#cbd5e1') +
                ';border-radius:4px;flex-shrink:0;margin-top:1px;background:' +
                (done ? '#dcfce7' : '#fff') +
                ';"></span>' +
                '<span>' +
                esc(m[2]) +
                '</span></div>'
            );
          }
        });
        if (items.length < 2) return block;
        return (
          '\n%%RAWHTML%%<div style="margin:8px 0 12px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff;">' +
          items.join('') +
          '</div>%%/RAWHTML%%\n'
        );
      }
    );

    // Pipe markdown tables -> HTML tables
    text = text.replace(/(?:^\|.+\|[ \t]*\n)+/gm, (block) => {
      const rows = block.trim().split('\n').filter((r) => r.trim());
      const parsed = rows
        .filter((r) => !/^\|[\s:-|]+\|$/.test(r.trim()))
        .map((r) => r.split('|').slice(1, -1).map((c) => c.trim()));
      if (parsed.length < 1) return block;
      let html =
        '<div style="overflow:auto;margin:8px 0;border:1px solid #e2e8f0;border-radius:10px;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      parsed.forEach((row, ri) => {
        const tag = ri === 0 ? 'th' : 'td';
        const bg = ri === 0 ? '#f8fafc' : ri % 2 ? '#fafafa' : '#fff';
        html += '<tr style="background:' + bg + ';">';
        row.forEach((cell) => {
          html +=
            '<' + tag + ' style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:left;">' +
            esc(cell) +
            '</' + tag + '>';
        });
        html += '</tr>';
      });
      html += '</table></div>';
      return '\n' + html + '\n';
    });

    // Extract prebuilt HTML blocks so line parser does not break them
    const rawBlocks = [];
    text = text.replace(/%%RAWHTML%%([\s\S]*?)%%\/RAWHTML%%/g, (_, html) => {
      rawBlocks.push(html);
      return '\n%%RAWBLOCK_' + (rawBlocks.length - 1) + '%%\n';
    });

    // Headings
    text = text.replace(/^### (.+)$/gm, '%%H3%%$1%%/H3%%');
    text = text.replace(/^## (.+)$/gm, '%%H2%%$1%%/H2%%');
    text = text.replace(/^# (.+)$/gm, '%%H1%%$1%%/H1%%');

    // Process line by line
    const lines = text.split('\n');
    const htmlParts = [];
    let inList = false;

    function flushList() {
      if (inList) {
        htmlParts.push('</div>');
        inList = false;
      }
    }

    lines.forEach((line) => {
      const t = line.trim();
      if (!t) {
        flushList();
        return;
      }
      if (t === '%%ISSUE_TABLE%%') {
        flushList();
        if (issueTableHtml) htmlParts.push(issueTableHtml);
        return;
      }
      const rb = t.match(/^%%RAWBLOCK_(\d+)%%$/);
      if (rb) {
        flushList();
        htmlParts.push(rawBlocks[parseInt(rb[1], 10)] || '');
        return;
      }
      if (t.startsWith('<div') || t.startsWith('<table')) {
        flushList();
        htmlParts.push(t);
        return;
      }
      let m;
      if ((m = t.match(/^%%H1%%(.+)%%\/H1%%$/))) {
        flushList();
        htmlParts.push(
          '<div style="font-weight:800;margin:14px 0 8px;font-size:16px;color:#1e1b4b;">' + esc(m[1]) + '</div>'
        );
        return;
      }
      if ((m = t.match(/^%%H2%%(.+)%%\/H2%%$/))) {
        flushList();
        htmlParts.push(
          '<div style="font-weight:800;margin:14px 0 6px;font-size:14px;color:#312e81;border-bottom:1px solid #e9e5ff;padding-bottom:4px;">' +
            esc(m[1]) +
            '</div>'
        );
        return;
      }
      if ((m = t.match(/^%%H3%%(.+)%%\/H3%%$/))) {
        flushList();
        htmlParts.push(
          '<div style="font-weight:700;margin:10px 0 4px;font-size:12px;color:#334155;">' + esc(m[1]) + '</div>'
        );
        return;
      }

      // Priority-only bullet lines (orphan) -> badge
      if (/^[-*]\s*\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*$/i.test(t)) {
        flushList();
        htmlParts.push('<div style="margin:6px 0 2px;">' + priorityBadge(t) + '</div>');
        return;
      }

      // List items -> card
      if (/^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) {
        if (!inList) {
          htmlParts.push(
            '<div style="margin:8px 0 12px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff;">'
          );
          inList = true;
        }
        let body = t.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
        body = esc(body).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Inline priority at start of list item
        body = body.replace(
          /^\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*/i,
          (mm) => priorityBadge(mm) + ' '
        );
        const num = t.match(/^(\d+)\.\s+/);
        htmlParts.push(
          '<div style="padding:8px 12px;line-height:1.45;font-size:12px;border-bottom:1px solid #f1f5f9;">' +
            (num ? '<strong style="color:#4f46e5;margin-right:6px;">' + num[1] + '.</strong>' : '<span style="color:#94a3b8;margin-right:6px;">•</span>') +
            body +
            '</div>'
        );
        return;
      }

      // Labeled lines: Title:, Meta:, Problem: etc. that weren't tabled
      if (/^(Problem|Why bad|Fix|Title|Meta|Meta Description|H1|H2|Title Tag|URL|Date|Current Title|Current Meta|Current H1|Better Title|Better Meta|Better H1)\s*:/i.test(t)) {
        flushList();
        const idx = t.indexOf(':');
        const label = t.slice(0, idx).trim();
        const val = t.slice(idx + 1).trim();
        htmlParts.push(
          '<div style="display:grid;grid-template-columns:120px 1fr;gap:8px;padding:8px 10px;font-size:12px;border:1px solid #f1f5f9;border-radius:8px;margin:4px 0;background:#fafafa;">' +
            '<div style="font-weight:700;color:#64748b;">' +
            esc(label) +
            '</div><div style="color:#0f172a;">' +
            esc(val).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') +
            '</div></div>'
        );
        return;
      }

      flushList();
      let para = esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      para = para.replace(
        /\[(CRITICAL|HIGH|MEDIUM|LOW)\]/gi,
        (mm) => priorityBadge(mm)
      );
      htmlParts.push(
        '<div style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#334155;">' + para + '</div>'
      );
    });
    flushList();

    return htmlParts.join('');
  }

  /**
   * Clean markdown for download: all major blocks -> markdown tables.
   */
  function formatPrettyMarkdown(raw, meta) {
    let text = String(raw || '').replace(/\r\n/g, '\n').trim();

    // Issues
    const issueRe =
      /(?:^|\n)\s*(?:[-*]\s*)?(\[(?:CRITICAL|HIGH|MEDIUM|LOW)\])\s*\n+\s*Problem:\s*([^\n]+)\s*\n+\s*Why bad:\s*([^\n]+)\s*\n+\s*Fix:\s*([^\n]+)/gi;
    const issues = [];
    text = text.replace(issueRe, (_, pri, problem, why, fix) => {
      issues.push({
        pri: String(pri).replace(/[\[\]]/g, '').trim(),
        problem: problem.trim().replace(/\|/g, '/'),
        why: why.trim().replace(/\|/g, '/'),
        fix: fix.trim().replace(/\|/g, '/')
      });
      return '\n%%ISSUES%%\n';
    });
    text = text.replace(/(?:%%ISSUES%%\s*)+/g, '\n%%ISSUES%%\n');
    if (issues.length) {
      const table =
        '\n| Priority | Problem | Why bad | Fix |\n| --- | --- | --- | --- |\n' +
        issues.map((it) => '| **' + it.pri + '** | ' + it.problem + ' | ' + it.why + ' | ' + it.fix + ' |').join('\n') +
        '\n';
      text = text.replace('%%ISSUES%%', table);
    }

    // Fix order numbered list
    text = text.replace(
      /((?:^\s*\d+\.\s*(?:\[(?:CRITICAL|HIGH|MEDIUM|LOW|PRIORITY)\])?\s*.+\n?){2,})/gim,
      (block) => {
        const rows = [];
        block.split('\n').forEach((line) => {
          const m = line.trim().match(/^(\d+)\.\s*(?:\[([^\]]+)\])?\s*(.+)$/);
          if (m) rows.push('| ' + m[1] + ' | **' + (m[2] || 'MEDIUM') + '** | ' + m[3].replace(/\|/g, '/') + ' |');
        });
        if (rows.length < 2) return block;
        return '\n| # | Priority | Action |\n| --- | --- | --- |\n' + rows.join('\n') + '\n';
      }
    );

    // Current / Better fields
    text = text.replace(
      /((?:^(?:Current|Better)\s+(?:Title|Meta|Meta Description|H1|H2)[^:]*:\s*.+\n?){2,})/gim,
      (block) => {
        const map = {};
        block.split('\n').forEach((line) => {
          const m = line.trim().match(/^(Current|Better)\s+(Title|Meta(?:\s*Description)?|H1|H2[^:]*)\s*:\s*(.+)$/i);
          if (m) {
            const key = m[2].replace(/\s*Description/i, '').trim();
            if (!map[key]) map[key] = {};
            map[key][m[1].toLowerCase()] = m[3].trim().replace(/\|/g, '/');
          }
        });
        const keys = Object.keys(map);
        if (!keys.length) return block;
        let t = '\n| Field | Current | Better |\n| --- | --- | --- |\n';
        keys.forEach((k) => {
          t += '| ' + k + ' | ' + (map[k].current || '—') + ' | ' + (map[k].better || '—') + ' |\n';
        });
        return t;
      }
    );

    // Factor scores
    text = text.replace(
      /((?:^\s*(?:\d+\.\s*)?[A-Za-z][^:\n]{2,40}:\s*(?:Good|OK|Weak|Poor|Excellent|Partly|Yes|No)\b[^\n]*\n?){2,})/gim,
      (block) => {
        const rows = [];
        block.split('\n').forEach((line) => {
          const m = line.trim().match(/^(?:\d+\.\s*)?([^:]+):\s*(Good|OK|Weak|Poor|Excellent|Partly|Yes|No)\b(.*)$/i);
          if (m) rows.push('| ' + m[1].trim().replace(/\|/g, '/') + ' | **' + m[2] + (m[3] || '').trim() + '** |');
        });
        if (rows.length < 2) return block;
        return '\n| Factor | Score |\n| --- | --- |\n' + rows.join('\n') + '\n';
      }
    );

    text = text.replace(/\n{3,}/g, '\n\n').trim();

    const title = (meta && meta.title) || 'Full Page Audit';
    const url = (meta && meta.url) || '';
    const header =
      '# Full Page Audit Report\n\n' +
      '**Page:** ' + title + '\n\n' +
      (url ? '**URL:** ' + url + '\n\n' : '') +
      '**Generated:** ' + new Date().toLocaleString() + '\n\n---\n\n';
    return header + text + '\n\n---\n\n*Generated by ShahzaibSEO Full Page Audit*\n';
  }

  function formatPrettyHtml(bodyHtml, meta) {
    const title = esc((meta && meta.title) || 'Full Page Audit');
    const url = esc((meta && meta.url) || '');
    return (
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
      '<title>Full Page Audit - ' + title + '</title>' +
      '<style>' +
      '*{box-sizing:border-box;}' +
      'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:28px 16px 48px;color:#0f172a;line-height:1.45;background:linear-gradient(180deg,#eef2ff 0%,#f8fafc 120px,#f8fafc 100%);}' +
      '.wrap{max-width:920px;margin:0 auto;}' +
      '.hero{background:linear-gradient(135deg,#4f46e5,#0d9488);color:#fff;border-radius:16px;padding:22px 24px;margin-bottom:16px;box-shadow:0 8px 24px rgba(79,70,229,.25);}' +
      '.hero h1{margin:0 0 6px;font-size:22px;font-weight:800;}' +
      '.hero .sub{opacity:.92;font-size:13px;}' +
      '.hero a{color:#fff;}' +
      '.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px 20px;box-shadow:0 1px 3px rgba(15,23,42,.06);margin-bottom:14px;}' +
      '.report table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 12px;}' +
      '.report th,.report td{padding:9px 11px;border-bottom:1px solid #f1f5f9;text-align:left;vertical-align:top;}' +
      '.report th{background:#f8fafc;font-weight:700;color:#475569;}' +
      '.report tr:nth-child(even) td{background:#fafafa;}' +
      '.report div[style*=\"overflow\"]{border-radius:10px;}' +
      '.foot{margin-top:18px;font-size:12px;color:#94a3b8;text-align:center;}' +
      '@media print{body{background:#fff;padding:0;} .hero{box-shadow:none;}}' +
      '</style></head><body><div class="wrap">' +
      '<div class="hero"><h1>Full Page Audit Report</h1>' +
      '<div class="sub"><strong>' + title + '</strong><br/>' +
      (url ? '<a href="' + url + '">' + url + '</a><br/>' : '') +
      'Generated: ' + esc(new Date().toLocaleString()) +
      '</div></div>' +
      '<div class="card report">' + bodyHtml + '</div>' +
      '<p class="foot">Generated by ShahzaibSEO Full Page Audit · Print this page to save as PDF</p>' +
      '</div></body></html>'
    );
  }

  function renderReport(html, plain, meta) {
    const prettyMd = formatPrettyMarkdown(plain, meta || {});
    const prettyHtml = formatPrettyHtml(html, meta || {});
    _lastReport = {
      plain: prettyMd,
      raw: plain,
      html: html,
      downloadHtml: prettyHtml,
      url: (meta && meta.url) || '',
      keyword: (meta && meta.keyword) || ''
    };
    const out = $('fullAuditOutput');
    const tabOut = $('fullAuditTabOutput');
    if (out) {
      out.style.display = 'block';
      out.innerHTML = html;
      out.dataset.plain = prettyMd;
      out.dataset.hasReport = '1';
    }
    if (tabOut) {
      tabOut.innerHTML = html;
      tabOut.dataset.plain = prettyMd;
    }
    showButtons(true);
  }

  async function runFullPageAudit() {
    if (_running) {
      notify('Audit already running...');
      return;
    }
    _running = true;
    const btn = $('fullAuditRunBtn');
    const btn2 = $('fullAuditRunBtn2');
    const origLabel = (btn && btn.textContent) || '▶ Run Full Page Audit';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Running...';
    }
    if (btn2) btn2.disabled = true;

    const keyword = (($('fullAuditKeyword') && $('fullAuditKeyword').value) || '').trim();
    const useTf = !!($('fullAuditUseTinyFish') && $('fullAuditUseTinyFish').checked);

    try {
      setProgress(5, 'Locating tab...');
      notify('Full Page Audit started');

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id || !tab.url) throw new Error('No active tab found.');
      if (/^chrome:|^chrome-extension:|^edge:|^about:/i.test(tab.url)) {
        throw new Error('Open a normal website (http/https), not a browser internal page.');
      }

      setProgress(20, 'Scrolling & extracting page...');
      const extract = await extractPage(tab.id);
      if (!extract.ok) throw new Error(extract.error || 'Extract failed');

      setProgress(45, 'Building snapshot...');
      let competitors = { ok: false, results: [] };
      if (useTf && keyword) {
        setProgress(50, 'TinyFish competitors...');
        competitors = await fetchTinyFishCompetitors(keyword);
      }

      const rulesMd = buildRulesSummary(extract, competitors, keyword);

      // Rule-based checks (deterministic + Google docs links)
      let ruleResult = null;
      let ruleHtml = '';
      let ruleMd = '';
      try {
        const Rules = window.ShahzaibSEOAuditRules;
        if (Rules && typeof Rules.buildFromExtract === 'function') {
          const payload = Object.assign({}, extract, {
            host: (function () {
              try { return new URL(extract.url || '').hostname.replace(/^www\./, ''); } catch (_) { return ''; }
            })(),
            meta: Object.assign({}, extract.meta || {}, {
              // ensure host available for canonical check
            }),
            stats: Object.assign({}, extract.stats || {}, {
              imageCount: (extract.stats && extract.stats.imageCount) || 0,
              missingAlt: (extract.stats && extract.stats.missingAlt) || 0,
              wordCount: (extract.stats && extract.stats.wordCount) || 0
            })
          });
          ruleResult = Rules.buildFromExtract(payload);
          ruleHtml = Rules.renderHtml(ruleResult);
          ruleMd = Rules.toMarkdown(ruleResult);
        }
      } catch (ruleErr) {
        console.warn('[FullPageAudit] rule engine', ruleErr);
      }

      // Show snapshot + rules immediately while AI runs
      {
        const early =
          '<div style="margin-bottom:10px;padding:12px 14px;border-radius:12px;background:linear-gradient(135deg,#eef2ff,#ecfeff);border:1px solid #c7d2fe;">' +
          '<div style="font-size:13px;font-weight:800;color:#312e81;">Full Page Audit</div>' +
          '<div style="font-size:11px;color:#64748b;margin-top:4px;">Building report…</div></div>' +
          '<div style="margin-bottom:8px;font-size:13px;font-weight:800;color:#0f172a;">Page snapshot</div>' +
          renderSnapshotCards(extract, competitors, keyword) +
          (ruleHtml
            ? ('<div style="margin-bottom:12px;padding:12px 14px;border-radius:12px;border:1px solid #a7f3d0;background:#ecfdf5;">' +
              '<div style="font-size:13px;font-weight:800;color:#065f46;margin-bottom:10px;">Rule-based checks</div>' +
              ruleHtml +
              '<div style="font-size:10px;color:#047857;margin-top:8px;">AI detailed report loading…</div></div>')
            : '<div style="font-size:11px;color:#64748b;">AI detailed report loading…</div>');
        const outEarly = $('fullAuditOutput');
        if (outEarly) {
          outEarly.style.display = 'block';
          outEarly.innerHTML = early;
        }
        const tabEarly = $('fullAuditTabOutput');
        if (tabEarly) tabEarly.innerHTML = early;
      }

      setProgress(65, 'Groq writing report...');
      const prompt =
        'Read the FULL page evidence (we scrolled the whole page). Write an SEO audit in VERY SIMPLE English (5th grade). Short sentences. Easy words.\n\n' +
        'RULES:\n' +
        '- Only use facts from the evidence. Name real problems found on THIS page (title, H1, headings list, missing alt, schema types, weak text, thin sections, FAQ issues, price confusion, etc.).\n' +
        '- For each issue use EXACTLY this 4-line format (no blank lines between them):\n' +
        '[CRITICAL]\n' +
        'Problem: ...\n' +
        'Why bad: ...\n' +
        'Fix: ...\n' +
        '(same for HIGH / MEDIUM / LOW)\n' +
        '- No hard words like "citability", "multi-modal", "semantic hierarchy". Say things like: "Google may cut your title", "AI tools may skip this page", "Add missing image text".\n' +
        '- No pipe tables. Bullets only.\n' +
        '- Labels: [CRITICAL] [HIGH] [MEDIUM] [LOW]\n' +
        '- Date: September 2026. Do not write 2024 or 2025.\n\n' +
        'USE THESE HEADINGS:\n\n' +
        '## 1. Simple summary\n' +
        '4 bullets max. Is the page OK or not? Biggest problem. Biggest win. Will AI tools likely use this page? Yes/No and why (simple).\n\n' +
        '## 2. Issues found on this page (from full scroll)\n' +
        'List real issues from the page text, headings, title, meta, images, links, schema. At least 5 if evidence supports them. Each with Problem / Why bad / Fix.\n\n' +
        '## 3. Fix order (do these first)\n' +
        'Numbered list ONLY, one line each, format:\n' +
        '1. [CRITICAL] do this...\n' +
        '2. [HIGH] do this...\n\n' +
        '## 4. Title, meta, H1\n' +
        'Use EXACT lines (value on same line):\n' +
        'Current Title: ...\n' +
        'Current Meta: ...\n' +
        'Current H1: ...\n' +
        'Better Title: ...\n' +
        'Better Meta: ...\n' +
        'Better H1: ...\n\n' +
        '## 4b. AI factor scores (optional)\n' +
        'Use lines like: Clear FAQ Answers: Good\n' +
        'Title and Meta Tags: Weak\n\n' +
        '## 5. Headings and page content\n' +
        'What is wrong with H1-H6 and body text after reading the page. How to fix.\n\n' +
        '## 6. Schema and technical\n' +
        'What schema is on the page. What is missing for Google and AI. Image alt and links if broken.\n\n' +
        '## 7. AI search ranking check (ChatGPT, Claude, Gemini, Grok, Perplexity, Google AI)\n' +
        'Answer clearly:\n' +
        '- Is this page ready for AI search engines? Yes / Partly / No\n' +
        '- What helps (schema, clear FAQ, facts, prices, contact)\n' +
        '- What blocks ranking or citations (weak proof, thin answers, messy headings, no author, etc.)\n' +
        '- After the fixes in this report, can it rank or get cited more often? Honest Yes/No + what still depends on backlinks/brand\n' +
        '- Top 5 AI ranking factors for THIS page and score each: Good / OK / Weak\n\n' +
        '## 8. This week checklist\n' +
        'Each task on its own line exactly like:\n' +
        '- [ ] Shorten the title tag to under 60 characters\n' +
        '- [ ] Fix the H1 text\n\n' +
        '## 9. Copy-paste text\n' +
        'Title:\nMeta:\nH1:\nH2-1:\nH2-2:\nH2-3:\n\n' +
        '--- FULL PAGE EVIDENCE (scrolled) ---\n' +
        rulesMd.slice(0, 32000);

      let aiText = '';
      let aiFailed = false;
      try {
        aiText = await callGroq(prompt);
      } catch (aiErr) {
        aiFailed = true;
        aiText = '';
        setProgress(85, 'AI unavailable — showing structured report…');
      }

      const pageTitle = (extract.meta && extract.meta.title) || extract.url || '';
      const header =
        '<div style="margin-bottom:14px;padding:12px 14px;border-radius:12px;background:linear-gradient(135deg,#eef2ff 0%,#ecfeff 100%);border:1px solid #c7d2fe;">' +
        '<div style="font-size:14px;font-weight:800;color:#312e81;margin-bottom:4px;">Full Page Audit</div>' +
        '<div style="font-size:12px;font-weight:600;color:#1e293b;line-height:1.35;">' + esc(pageTitle) + '</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:4px;word-break:break-all;">' + esc(extract.url || '') + '</div>' +
        '</div>';

      const snapshotHtml = renderSnapshotCards(extract, competitors, keyword);

      const rulesBlock = ruleHtml
        ? ('<div style="margin-bottom:14px;padding:12px 14px;border-radius:12px;border:1px solid #a7f3d0;background:#ecfdf5;">' +
          '<div style="font-size:13px;font-weight:800;color:#065f46;margin-bottom:10px;">Rule-based checks</div>' +
          ruleHtml +
          '</div>')
        : '';

      let aiBlock = '';
      if (aiText && !aiFailed) {
        aiBlock =
          '<div style="margin-bottom:8px;font-size:13px;font-weight:800;color:#312e81;">AI detailed report</div>' +
          '<div style="padding:4px 0 8px;">' + simpleMarkdownToHtml(aiText) + '</div>';
      } else if (aiFailed) {
        aiBlock =
          '<div style="margin:12px 0;padding:10px 12px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a;font-size:12px;color:#92400e;">' +
          'AI narrative unavailable. Structured page snapshot and rule checks above are complete — use them to fix issues.</div>';
      }

      const html = header +
        '<div style="margin-bottom:8px;font-size:13px;font-weight:800;color:#0f172a;">Page snapshot</div>' +
        snapshotHtml +
        rulesBlock +
        aiBlock;
      const plain = (ruleMd ? ruleMd + '\n\n---\n\n' : '') + (aiText || '(AI report unavailable)');
      const meta = {
        title: (extract.meta && extract.meta.title) || extract.url || '',
        url: extract.url || '',
        keyword: keyword
      };

      setProgress(100, 'Done.');
      renderReport(html, plain, meta);
      notify('Full Page Audit complete');
    } catch (err) {
      const msg = (err && err.message) || 'Audit failed';
      setProgress(0, '');
      const wrap = $('fullAuditProgress');
      if (wrap) wrap.style.display = 'block';
      const status = $('fullAuditStatus');
      if (status) status.textContent = msg;
      renderReport(
        '<div style="color:#b45309;line-height:1.5;"><strong>Audit failed:</strong> ' +
          esc(msg) +
          '<ul style="margin:8px 0 0;padding-left:18px;">' +
          '<li>Refresh the website tab</li>' +
          '<li>Reload the extension</li>' +
          '<li>Use http/https pages only</li></ul></div>',
        msg
      );
      notify(msg);
    } finally {
      _running = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = origLabel;
      }
      if (btn2) btn2.disabled = false;
    }
  }

  function copyReport() {
    const text =
      (_lastReport && _lastReport.plain) ||
      ($('fullAuditOutput') && $('fullAuditOutput').dataset.plain) ||
      '';
    if (!text) {
      notify('No report to copy');
      return;
    }
    navigator.clipboard.writeText(text).then(() => notify('Report copied')).catch(() => {});
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function downloadMd() {
    if (!_lastReport || (!_lastReport.plain && !_lastReport.downloadHtml)) {
      notify('No report to download');
      return;
    }
    const host = String(_lastReport.url || 'page')
      .replace(/^https?:\/\//, '')
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 40);
    const base = 'full-page-audit-' + (host || 'report');

    // 1) Clean markdown with proper tables
    if (_lastReport.plain) {
      downloadFile(base + '.md', _lastReport.plain, 'text/markdown;charset=utf-8');
    }
    // 2) Beautiful HTML (open in browser / print to PDF)
    if (_lastReport.downloadHtml) {
      setTimeout(function () {
        downloadFile(base + '.html', _lastReport.downloadHtml, 'text/html;charset=utf-8');
      }, 250);
    }
    notify('Downloaded .md + .html report');
  }

  function viewReport() {
    const nav = document.querySelector('[data-tab="fullaudit"]');
    if (nav) nav.click();
  }

  function wireButton(el, fn) {
    if (!el || el.dataset.fpaWired === '1') return;
    el.dataset.fpaWired = '1';
    el.addEventListener(
      'click',
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        fn();
      },
      false
    );
  }

  function init() {
    wireButton($('fullAuditRunBtn'), runFullPageAudit);
    wireButton($('fullAuditRunBtn2'), runFullPageAudit);
    wireButton($('fullAuditCopyBtn'), copyReport);
    wireButton($('fullAuditCopyBtn2'), copyReport);
    wireButton($('fullAuditMdBtn'), downloadMd);
    wireButton($('fullAuditMdBtn2'), downloadMd);
    wireButton($('fullAuditViewBtn'), viewReport);

    // Capture-phase delegation backup
    if (!document.documentElement.dataset.fpaCap) {
      document.documentElement.dataset.fpaCap = '1';
      document.addEventListener(
        'click',
        function (e) {
          const t = e.target && e.target.closest && e.target.closest('#fullAuditRunBtn, #fullAuditRunBtn2');
          if (t) {
            e.preventDefault();
            e.stopPropagation();
            runFullPageAudit();
          }
        },
        true
      );
    }
  }

  // Expose immediately so inline onclick works
  window.ShahzaibSEOFullPageAudit = {
    run: runFullPageAudit,
    getLast: function () {
      return _lastReport;
    },
    init: init
  };

  function boot() {
    try {
      init();
    } catch (e) {
      console.error('[FullPageAudit] init error', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  setTimeout(boot, 300);
  setTimeout(boot, 1000);
  setTimeout(boot, 2500);
})();
