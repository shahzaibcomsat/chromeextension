/**
 * ShahzaibSEO Rule-Based Audit Engine
 * Deterministic checks with Google Search Central / MDN documentation links.
 * Used by Full Page Audit (hybrid: rules first, then AI report).
 */
(function (root) {
  'use strict';

  const G = 'https://developers.google.com/search/docs/';
  const L = {
    title: G + 'appearance/title-link',
    desc: G + 'appearance/snippet',
    alt: G + 'appearance/google-images',
    head: 'https://developer.mozilla.org/docs/Web/HTML/Element/Heading_Elements',
    url: G + 'crawling-indexing/url-structure',
    links: G + 'crawling-indexing/links-crawlable',
    mobile: G + 'crawling-indexing/mobile/mobile-sites-mobile-first-indexing',
    robots: G + 'crawling-indexing/robots/intro',
    sitemap: G + 'crawling-indexing/sitemaps/overview',
    meta: G + 'crawling-indexing/robots-meta-tag',
    canon: G + 'crawling-indexing/consolidate-duplicate-urls',
    hreflang: G + 'specialty/international/localized-versions',
    schema: G + 'appearance/structured-data/intro-structured-data',
    favicon: G + 'appearance/favicon-in-search',
    https: G + 'crawling-indexing/sitemaps/build-sitemap'
  };

  function item(key, group, label, value, status, tip, detail, learn) {
    return {
      key: key,
      group: group,
      label: label,
      value: value,
      status: status, // pass | warn | error | info
      tip: tip || '',
      detail: detail || '',
      learn: learn || ''
    };
  }

  /**
   * Build rules from Full Page Audit extract payload:
   * { ok, meta: { title, description, canonical, robots, lang, h1 }, outline, schemaTypes, stats, url, host }
   */
  function buildFromExtract(extract) {
    const items = [];
    const add = function () {
      items.push(item.apply(null, arguments));
    };

    if (!extract || !extract.ok) {
      add('extract', 'technical', 'Page extract', 'Failed', 'error',
        'Could not read the page. Open a normal http/https page and try again.', '', '');
      return { items: items, counts: countStatus(items) };
    }

    const meta = extract.meta || {};
    const outline = extract.outline || [];
    const schemaTypes = extract.schemaTypes || [];
    const stats = extract.stats || {};
    const pageUrl = extract.url || '';
    const https = /^https:/i.test(pageUrl);

    // Title
    const t = meta.title || '';
    add('title', 'content', 'Title tag', t ? (t.length + ' chars') : 'Missing',
      !t ? 'error' : (t.length >= 30 && t.length <= 60 ? 'pass' : 'warn'),
      !t ? 'Add a title tag. It is the clickable headline in search results.'
        : (t.length > 60 ? 'Title may be cut off in search results. Keep the main words in the first 60 characters.'
          : (t.length < 30 ? 'Title is short. Use the space to describe the page more clearly.'
            : 'Title length looks good and should show in full in most search results.')),
      t, L.title);

    // Meta description
    const d = meta.description || '';
    add('desc', 'content', 'Meta description', d ? (d.length + ' chars') : 'Missing',
      !d ? 'warn' : (d.length >= 70 && d.length <= 160 ? 'pass' : 'warn'),
      !d ? 'Add a meta description. Google may use it as the snippet under your title.'
        : (d.length > 160 ? 'Description may be truncated. Put the main point in the first 120–160 characters.'
          : (d.length < 70 ? 'Description is short. Add a clear benefit or summary.'
            : 'Description length looks good for most search results.')),
      d, L.desc);

    // H1
    const h1s = outline.filter(function (h) { return h.level === 1; });
    const h1Count = h1s.length;
    const h1Text = meta.h1 || (h1s[0] && h1s[0].text) || '';
    add('h1', 'content', 'H1 heading', h1Count === 0 ? 'Missing' : (h1Count === 1 ? '1 H1' : h1Count + ' H1s'),
      h1Count === 1 ? 'pass' : (h1Count === 0 ? 'error' : 'warn'),
      h1Count === 0 ? 'Add one clear H1 that matches the main topic of the page.'
        : (h1Count > 1 ? 'Multiple H1s can confuse topic focus. Prefer a single main H1.'
          : 'One H1 is present.'),
      h1Text, L.head);

    // Heading hierarchy skip
    let skipped = false;
    for (let i = 1; i < outline.length; i++) {
      if (outline[i].level > outline[i - 1].level + 1) { skipped = true; break; }
    }
    add('hierarchy', 'content', 'Heading order', skipped ? 'Skipped levels' : 'OK',
      skipped ? 'warn' : (outline.length ? 'pass' : 'info'),
      skipped ? 'Avoid jumping heading levels (e.g. H2 → H4). Keep a logical outline.'
        : (outline.length ? 'Heading levels look sequential.' : 'No headings found.'),
      outline.slice(0, 12).map(function (h) { return 'H' + h.level + ': ' + h.text; }).join('\n'), L.head);

    // Images alt
    const imgTotal = stats.imageCount != null ? stats.imageCount : (stats.images != null ? stats.images : null);
    const imgNoAlt = stats.missingAlt != null ? stats.missingAlt : (stats.imagesNoAlt != null ? stats.imagesNoAlt : null);
    if (imgTotal != null) {
      const missing = imgNoAlt || 0;
      add('alt', 'content', 'Image alt text', missing === 0 ? (imgTotal + ' images OK') : (missing + ' missing alt'),
        missing === 0 ? 'pass' : (missing / Math.max(imgTotal, 1) > 0.3 ? 'error' : 'warn'),
        missing === 0 ? 'Images have alt attributes (or there are no images).'
          : 'Add descriptive alt text for images that convey information.',
        'Images: ' + imgTotal + ', missing alt: ' + missing, L.alt);
    }

    // Canonical
    const canon = meta.canonical || '';
    let canonState = 'missing';
    if (canon) {
      try {
        const cHost = new URL(canon).hostname.replace(/^www\./, '');
        const pHost = (extract.host || '').replace(/^www\./, '');
        canonState = (cHost && pHost && cHost === pHost) ? 'self' : 'other';
      } catch (_) {
        canonState = 'other';
      }
    }
    add('canonical', 'crawl', 'Canonical', canonState === 'missing' ? 'Missing' : (canonState === 'self' ? 'Self-referencing' : 'Points elsewhere'),
      canonState === 'missing' ? 'warn' : 'pass',
      canonState === 'missing' ? 'Add a canonical URL so Google knows the preferred version of this page.'
        : (canonState === 'other' ? 'Canonical points to another URL. Confirm that is intentional.'
          : 'Canonical is set to this site.'),
      canon, L.canon);

    // Robots / indexable
    const robots = (meta.robots || '').toLowerCase();
    const blocked = /\bnoindex\b|\bnone\b/.test(robots);
    add('robots', 'crawl', 'Robots meta', robots || 'Not set',
      blocked ? 'error' : 'pass',
      blocked ? 'This page is marked noindex and should not appear in search results.'
        : (robots ? 'Robots meta does not block indexing.' : 'No robots meta — page is indexable by default.'),
      meta.robots || '', L.meta);

    // HTTPS
    add('https', 'technical', 'HTTPS', https ? 'Yes' : 'No',
      https ? 'pass' : 'error',
      https ? 'Page is served over HTTPS.' : 'Serve the site over HTTPS. Google prefers secure pages.',
      pageUrl, L.https);

    // Language
    const lang = meta.lang || '';
    add('lang', 'technical', 'HTML lang', lang || 'Missing',
      lang ? 'pass' : 'warn',
      lang ? 'Language is declared on the page.' : 'Add lang on the html element, e.g. <html lang="en">.',
      lang ? ('<html lang="' + lang + '">') : '', '');

    // Schema
    const types = Array.from(new Set(schemaTypes.map(String)));
    add('schema', 'technical', 'Structured data', types.length ? (types.length + ' type(s)') : 'None',
      types.length ? 'pass' : 'info',
      types.length ? 'Structured data is present and may enable rich results.'
        : 'No JSON-LD schema found. Optional, but helpful for rich results and AI citation.',
      types.slice(0, 12).join(', '), L.schema);

    // Word count / thin content signal
    const words = stats.wordCount != null ? stats.wordCount : (stats.words != null ? stats.words : null);
    if (words != null) {
      add('words', 'content', 'Visible text', words + ' words',
        words < 150 ? 'warn' : (words < 300 ? 'info' : 'pass'),
        words < 150 ? 'Very little visible text. Search engines and AI tools may treat the page as thin.'
          : 'Word count is a rough signal only — quality matters more than length.',
        '', '');
    }

    return { items: items, counts: countStatus(items) };
  }

  function countStatus(items) {
    const c = { pass: 0, warn: 0, error: 0, info: 0 };
    items.forEach(function (i) {
      if (c[i.status] != null) c[i.status]++;
    });
    return c;
  }

  const GROUP_ORDER = [
    ['content', 'Content'],
    ['crawl', 'Crawl & index'],
    ['technical', 'Technical']
  ];

  function renderHtml(result) {
    if (!result || !result.items || !result.items.length) {
      return '<div style="padding:12px;color:#64748b;font-size:12px;">No rule checks available.</div>';
    }
    const counts = result.counts || countStatus(result.items);
    const statusColor = { pass: '#16a34a', warn: '#d97706', error: '#dc2626', info: '#64748b' };
    const statusLabel = { pass: 'Pass', warn: 'Warn', error: 'Error', info: 'Info' };

    let html = '';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
    ['error', 'warn', 'pass', 'info'].forEach(function (k) {
      if (!counts[k]) return;
      html += '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:' +
        (k === 'error' ? '#fef2f2' : k === 'warn' ? '#fffbeb' : k === 'pass' ? '#f0fdf4' : '#f8fafc') +
        ';color:' + statusColor[k] + ';border:1px solid ' + statusColor[k] + '33;">' +
        statusLabel[k] + ': ' + counts[k] + '</span>';
    });
    html += '</div>';

    GROUP_ORDER.forEach(function (pair) {
      const key = pair[0];
      const title = pair[1];
      const list = result.items.filter(function (i) { return i.group === key; });
      if (!list.length) return;
      html += '<div style="margin-bottom:14px;">';
      html += '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin-bottom:6px;">' + title + '</div>';
      list.forEach(function (i) {
        const col = statusColor[i.status] || '#64748b';
        html += '<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;margin-bottom:4px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;">';
        html += '<span style="flex-shrink:0;width:8px;height:8px;margin-top:5px;border-radius:50%;background:' + col + ';"></span>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;">';
        html += '<span style="font-size:12px;font-weight:600;color:#0f172a;">' + esc(i.label) + '</span>';
        html += '<span style="font-size:11px;font-weight:700;color:' + col + ';">' + esc(i.value) + '</span>';
        html += '</div>';
        if (i.tip) html += '<div style="font-size:11px;color:#475569;margin-top:3px;line-height:1.4;">' + esc(i.tip) + '</div>';
        if (i.learn) {
          html += '<a href="' + esc(i.learn) + '" target="_blank" rel="noopener" style="font-size:10px;color:#0d9488;font-weight:600;text-decoration:none;margin-top:4px;display:inline-block;">Learn more →</a>';
        }
        html += '</div></div>';
      });
      html += '</div>';
    });

    return html;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toMarkdown(result) {
    if (!result || !result.items) return '';
    const lines = ['## Rule-based checks', ''];
    const counts = result.counts || countStatus(result.items);
    lines.push('Errors: ' + (counts.error || 0) + ' · Warnings: ' + (counts.warn || 0) + ' · Pass: ' + (counts.pass || 0));
    lines.push('');
    result.items.forEach(function (i) {
      lines.push('- **[' + i.status.toUpperCase() + ']** ' + i.label + ': ' + i.value);
      if (i.tip) lines.push('  - ' + i.tip);
      if (i.learn) lines.push('  - Docs: ' + i.learn);
    });
    return lines.join('\n');
  }

  const api = {
    buildFromExtract: buildFromExtract,
    renderHtml: renderHtml,
    toMarkdown: toMarkdown,
    links: L
  };

  root.ShahzaibSEOAuditRules = api;
  if (typeof self !== 'undefined') self.ShahzaibSEOAuditRules = api;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
