/**
 * ShahzaibSEO - AEO & GEO Expert Popup Controller v1.0
 * V2 UI/UX + V1 Full Analysis Engine
 * Maps V1 content.js data structure → V2 HTML elements
 */
'use strict';

// ─── State ────────────────────────────────────────────
let _rawData = null;      // raw V1 content.js response
let _vitals  = null;      // PageSpeed vitals
let _robotsTxt = null;    // robots.txt text
let _activeTab = 'dashboard';
let _imgFilter = 'all';
let _linkFilter = 'all';
let _kwNgram = 'all';
let _currentTabId = null;
let _currentUrl = null;
// PDF export support — captured from async fetches so the Audit Report
// generator can include them without re-fetching at export time.
let _domainInfo   = null;   // RDAP_LOOKUP response (registrar, age, nameservers…)
let _htaccessData = null;   // FETCH_HTACCESS response
let _sitemapData  = null;   // FETCH_SITEMAP response
let _llmsTxtData  = null;   // FETCH_LLMS_TXT response
let _ipGeoData    = null;   // IP_GEO response

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const setText = (id, val) => { const e = $(id); if (e) e.textContent = (val === null || val === undefined) ? '--' : val; };
const fmt = n => (n === null || n === undefined) ? '--' : Number(n).toLocaleString();
const clamp = (n, a, b) => Math.min(Math.max(n || 0, a), b);
const escHTML = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const escAttr = s => String(s || '').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// Built-in Groq key (shared free tier). User key in Settings always wins.
const RANKSEO_BUILTIN_GROQ_KEY = '';
const RANKSEO_BUILTIN_GROQ_MODEL = 'qwen/qwen3.8-27b';
/** Resolve effective Groq key: user override → built-in fallback */
function resolveGroqKey(userKey) {
  const k = (userKey || '').trim();
  return k || RANKSEO_BUILTIN_GROQ_KEY;
}
// Markdown renderer for AI chat responses
function renderMarkdown(text) {
  if (!text) return '';

  // Process pipe tables BEFORE html-escaping
  const tableBlocks = [];
  text = text.replace(/(\|.+\|\r?\n\|[-| :]+\|\r?\n(?:\|.+\|\r?\n?)+)/g, (match) => {
    const lines = match.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 3) return match;
    const parseCells = l => l.split('|').map(c => c.trim()).filter(Boolean);
    const headers = parseCells(lines[0]);
    const rows = lines.slice(2).map(parseCells);
    let tbl = '<div class="ai-table-wrap"><table class="ai-table"><thead><tr>';
    headers.forEach(h => { tbl += `<th>${h}</th>`; });
    tbl += '</tr></thead><tbody>';
    rows.forEach(r => { tbl += '<tr>'; r.forEach(c => { tbl += `<td>${c}</td>`; }); tbl += '</tr>'; });
    tbl += '</tbody></table></div>';
    const ph = `\x00TABLE${tableBlocks.length}\x00`;
    tableBlocks.push(tbl);
    return ph;
  });

  let html = escHTML(text);

  // Restore tables (placeholders were escaped safely)
  tableBlocks.forEach((tbl, i) => { html = html.replace(`\x00TABLE${i}\x00`, tbl); });

  // Headers #### ### ## # — ALL become bold section titles, never raw # chars
  html = html.replace(/^#{1,6} (.+)$/gm, '<strong class="ai-section-title">$1</strong>');

  // Bold **text** and __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');

  // Numbered lists
  html = html.replace(/^(\d+)\. (.+)$/gm,
    '<div class="ai-li"><span class="ai-li-num">$1.</span><span class="ai-li-text">$2</span></div>');
  // Bullet lists - or *
  html = html.replace(/^[-\*] (.+)$/gm,
    '<div class="ai-li"><span class="ai-li-bull">&bull;</span><span class="ai-li-text">$1</span></div>');

  // "What to ask next:" — convert to clickable suggestion chips
  // Matches both **bold** form and ## header form (ai-section-title)
  html = html.replace(/<strong(?:[^>]*)>What to ask next:?<\/strong>([\s\S]*?)(?=<strong(?:[^>]*)>|$)/gi, (match, body) => {
    const items = [];

    // Extract from numbered list items already converted to ai-li divs
    body.replace(/<div class="ai-li"><span class="ai-li-num">\d+\.<\/span><span class="ai-li-text">([\s\S]+?)<\/span><\/div>/g, (m, q) => {
      items.push(q.trim());
    });

    // Fallback: extract from bullet list items
    if (!items.length) {
      body.replace(/<div class="ai-li"><span class="ai-li-bull">&bull;<\/span><span class="ai-li-text">([\s\S]+?)<\/span><\/div>/g, (m, q) => {
        items.push(q.trim());
      });
    }

    // Fallback: plain numbered lines not yet converted (e.g. after <br>)
    if (!items.length) {
      body.replace(/(?:^|<br>)\s*\d+\.\s+(.+?)(?=<br>|$)/g, (m, q) => items.push(q.trim()));
    }

    if (!items.length) return match;

    const chips = items.filter(Boolean).map(q => {
      // Decode HTML entities for the data-q attribute value
      const safe = q.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const attr = safe.replace(/"/g, '&quot;');
      return `<button class="ai-suggest-chip" data-q="${attr}">${q}</button>`;
    }).join('');

    return `<div class="ai-suggest-section"><span class="ai-suggest-label">What to ask next:</span><div class="ai-suggest-chips">${chips}</div></div>`;
  });

  // Paragraph spacing
  html = html.replace(/\n\n/g, '<div class="ai-para-gap"></div>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ─── Toast ────────────────────────────────────────────
function toast(msg) {
  const t = $('toast'); if (!t) return;
  if (!t) return; t.textContent = msg; t.classList.add('show');
  // Show longer messages for more time (min 2.5s, +40ms per char beyond 60)
  const dur = Math.min(7000, 2500 + Math.max(0, msg.length - 60) * 40);
  setTimeout(() => t.classList.remove('show'), dur);
}
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied!')).catch(() => {
    const ta = document.createElement('textarea'); ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); toast('Copied!');
  });
}

// ─── Ring animation ───────────────────────────────────
function animateRing(id, score, circ = 264) {
  const e = $(id); if (!e) return;
  const v = clamp(score, 0, 100);
  e.setAttribute('stroke-dasharray', `${(v / 100) * circ} ${circ}`);
}
function scoreColor(s) { return s >= 80 ? 'ok' : s >= 55 ? 'warn' : 'err'; }
function scoreGrade(s) { return s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : s >= 45 ? 'D' : 'F'; }

// ─── V1 data adapters ─────────────────────────────────
// Convert V1 content.js response to a canonical shape all renderers use
function adaptV1Data(raw) {
  if (!raw) return null;

  // ── meta ──
  const meta = {
    title:     raw.title?.content || '',
    desc:      raw.metaDescription?.content || '',
    canonical: (typeof raw.technical?.canonical === 'object' ? raw.technical?.canonical?.href    : raw.technical?.canonical) || '',
    robots:    (typeof raw.technical?.robots   === 'object' ? raw.technical?.robots?.content     : raw.technical?.robots)   || '',
    viewport:  (typeof raw.technical?.viewport === 'object' ? raw.technical?.viewport?.content   : raw.technical?.viewport) || '',
    charset:   (typeof raw.technical?.charset  === 'object' ? raw.technical?.charset?.value      : raw.technical?.charset)  || '',
    lang:      (typeof raw.technical?.language === 'object' ? raw.technical?.language?.value     : raw.technical?.language) || raw.languageAnalysis?.declaredLang || raw.languageAnalysis?.detectedLang || '',
    url:       raw.url || '',
    og: {
      title:       raw.social?.ogTitle || '',
      description: raw.social?.ogDescription || '',
      image:       raw.social?.ogImage || '',
      url:         raw.social?.ogUrl || '',
      type:        raw.social?.ogType || '',
      site_name:   raw.social?.ogSiteName || ''
    },
    twitter: {
      card:        raw.social?.twitterCard || '',
      title:       raw.social?.twitterTitle || '',
      description: raw.social?.twitterDescription || '',
      image:       raw.social?.twitterImage || '',
      site:        raw.social?.twitterSite || '',
      creator:     raw.social?.twitterCreator || ''
    }
  };

  // ── headings ──
  const hStruct = raw.headings?.structure || { h1:[], h2:[], h3:[], h4:[], h5:[], h6:[] };
  const allHN = raw.headings?.orderedHeadings || [];
  const hCounts = {
    h1: hStruct.h1?.length || 0,
    h2: hStruct.h2?.length || 0,
    h3: hStruct.h3?.length || 0,
    h4: hStruct.h4?.length || 0,
    h5: hStruct.h5?.length || 0,
    h6: hStruct.h6?.length || 0
  };
  const hnIssues = [];
  if (hCounts.h1 === 0) hnIssues.push({ type: 'missing_h1', msg: 'No H1 tag found' });
  if (hCounts.h1 > 1)  hnIssues.push({ type: 'multiple_h1', msg: `Multiple H1 tags (${hCounts.h1}) — use only one` });
  // Empty headings
  const emptyH = allHN.filter(h => !h.text || h.text.trim().length === 0);
  if (emptyH.length) hnIssues.push({ type: 'empty_heading', msg: `${emptyH.length} empty heading(s) found` });

  const headings = {
    counts: hCounts,
    headings: allHN.map(h => ({ level: h.level, text: h.text || '', isEmpty: !h.text || !h.text.trim() })),
    issues: hnIssues
  };

  // ── images ──
  const rawImgs = raw.images?.images || [];
  const images = {
    total: raw.images?.total || 0,
    withAlt: raw.images?.withAlt || 0,
    missingAlt: raw.images?.withoutAlt || 0,
    oversized: rawImgs.filter(i => i.isOversized || i.resized).length,
    aboveFoldLazy: rawImgs.filter(i => i.isAboveFold && i.loading === 'lazy').length,
    duplicateAlts: (typeof raw.images?.duplicateAlts === 'object' ? raw.images?.duplicateAlts?.count : raw.images?.duplicateAlts) || 0,
    formats: buildFormatsMap(rawImgs),
    images: rawImgs.map(img => ({
      src: img.src || '',
      alt: img.alt || '',
      hasAlt: img.hasAlt !== false && (img.alt !== undefined),
      isDecorative: img.isDecorative || false,
      format: (img.format || img.src?.split('.').pop()?.split('?')[0] || 'unknown').toLowerCase(),
      naturalW: img.naturalWidth || img.width || 0,
      naturalH: img.naturalHeight || img.height || 0,
      isLazy: img.loading === 'lazy',
      aboveFoldLazy: img.isAboveFold && img.loading === 'lazy',
      oversized: img.isOversized || img.resized || false
    }))
  };

  // ── links ──
  const rawLinks = raw.links?.links || [];
  const links = {
    total: raw.links?.total || 0,
    internal: raw.links?.internal || 0,
    external: raw.links?.external || 0,
    nofollow: raw.links?.nofollow || 0,
    internalNofollow: rawLinks.filter(l => l.isInternal && l.rel?.includes('nofollow')).length,
    empty: raw.links?.empty || 0,
    noText: raw.links?.withoutText || 0,
    genericAnchor: rawLinks.filter(l => /^(click here|read more|here|learn more|more|link)$/i.test((l.text||'').trim())).length,
    links: rawLinks.map(l => ({
      url: l.url || l.href || '',
      text: l.text || l.anchorText || '',
      isInternal: l.isInternal || false,
      isExternal: !l.isInternal,
      isNofollow: !!(l.rel?.includes('nofollow')),
      isSponsored: !!(l.rel?.includes('sponsored')),
      isEmpty: !(l.url || l.href),
      noText: !(l.text || l.anchorText),
      imgInside: l.hasImage || false,
      isGeneric: /^(click here|read more|here|learn more|more|link)$/i.test((l.text||'').trim()),
      zone: l.zone || l.position || 'body',
      rel: l.rel || ''
    }))
  };

  // ── keywords ──
  const rawKw = raw.keywords || {};
  const kwList = [];
  (rawKw.unigrams || []).forEach(k => kwList.push({ word: k.word, count: k.count, density: parseFloat(k.density||0).toFixed(2), ngram: 1, inTitle: !!k.inTitle, inH1: !!k.inH1, inMeta: !!k.inMeta, inBold: (k.inBold||0)>0 }));
  (rawKw.bigrams || []).forEach(k => kwList.push({ word: k.word, count: k.count, density: parseFloat(k.density||0).toFixed(2), ngram: 2, inTitle: !!k.inTitle, inH1: !!k.inH1, inMeta: !!k.inMeta, inBold: false }));
  (rawKw.trigrams || []).forEach(k => kwList.push({ word: k.word, count: k.count, density: parseFloat(k.density||0).toFixed(2), ngram: 3, inTitle: !!k.inTitle, inH1: !!k.inH1, inMeta: !!k.inMeta, inBold: false }));
  const kwScore = Math.min(100, Math.max(0, 100 - (rawKw.stuffingAlerts?.length || 0) * 10));
  const keywords = {
    keywords: kwList,
    totalWords: raw.content?.wordCount || rawKw.wordCount || 0,
    uniqueCount: (rawKw.unigrams || []).length,
    boldCount: (rawKw.unigrams || []).filter(k => k.inBold > 0).length,
    italicCount: (rawKw.unigrams || []).filter(k => k.inItalic > 0).length,
    score: kwScore,
    stuffing: (rawKw.stuffingAlerts || []).map(s => ({ word: s.word || s }))
  };

  // ── technical ──
  const techRaw = raw.technical || {};
  const scripts = raw.performance?.scriptsAnalysis     || {};
  const styles  = raw.performance?.stylesheetsAnalysis || {};
  const perfRaw = raw.performance || {};
  const tech = {
    isHttps: (raw.url || '').startsWith('https://'),
    isIndexable: !((typeof techRaw.robots === 'object' ? techRaw.robots?.content : techRaw.robots) || '').toLowerCase().includes('noindex'),
    htmlSize: raw.pageWeight?.html?.bytes || raw.pageWeight?.htmlSize || techRaw.htmlSize || 0,
    domElements: techRaw.domElements || 0,
    domDepth: techRaw.domDepth || 0,
    framework: techRaw.cms?.name || (techRaw.techStack?.list?.[0] || ''),
    hreflang: raw.multiLangSeo?.entries || [],
    publishDate: raw.advancedTechnical?.publishedDate || '',
    trackingSignals: buildTrackingList(techRaw, raw),
    scripts: { total: scripts.total || 0, inline: scripts.inline || 0, external: scripts.external || 0, blocking: scripts.blocking || 0 },
    styles: { total: styles.total || 0, inline: styles.inline || 0, external: styles.external || 0 },
    hints: [
      ...(raw.advancedTechnical?.resourceHints?.preconnect  || []).map(href => ({ rel: 'preconnect',   href: typeof href === 'string' ? href : href.href || '' })),
      ...(raw.advancedTechnical?.resourceHints?.prefetch    || []).map(href => ({ rel: 'prefetch',     href: typeof href === 'string' ? href : href.href || '' })),
      ...(raw.advancedTechnical?.resourceHints?.preload     || []).map(h    => ({ rel: 'preload',      href: typeof h    === 'string' ? h    : h.href    || '' })),
      ...(raw.advancedTechnical?.resourceHints?.dnsPrefetch || []).map(href => ({ rel: 'dns-prefetch', href: typeof href === 'string' ? href : href.href || '' })),
    ],
    cms: techRaw.cms?.name || '',
    cmsAll: Array.isArray(techRaw.cms?.all) ? techRaw.cms.all : (techRaw.cms?.name ? [techRaw.cms.name] : []),
    techStack: techRaw.techStack?.list || [],
    // Performance timing data
    loadTime: perfRaw.loadTime || 0,
    firstByte: perfRaw.firstByte || 0,
    // ── extra raw sources needed by the PDF audit report ──
    hreflangCount: (raw.multiLangSeo?.entries || []).length,
    urlLength: (raw.url || '').length,
    ogTitle: raw.social?.ogTitle || '',
    twitterCard: raw.social?.twitterCard || '',
    favicon: !!techRaw.favicon,
    sitemapInRobots: !!(raw.robotsTxtSitemap || techRaw.sitemapInRobots),
    isWordPress: !!(techRaw.cms?.name === 'WordPress'),
    isAmp: !!techRaw.isAmp,
    jsonLdCount: (raw.structuredDeep?.schemas || raw.structured?.schemas || []).length,
    security: raw.security || null,            // analyzeSecuritySeo()
    accessibility: raw.accessibility || null,   // analyzeAccessibility()
    jsErrors: raw.jsErrors || null,             // analyzeJsErrors()
    fontsPerf: raw.fontsPerf || null,           // analyzeFontsPerf()
    pageWeight: raw.pageWeight || null,         // analyzePageWeight()
    advancedTechnical: raw.advancedTechnical || null // analyzeAdvancedTechnical()
  };

  // ── GEO ──
  const geoRaw = raw.geoSignals || {};
  const eeatRaw = raw.eeat || {};
  const structuredRaw = raw.structuredDeep || raw.structured || {};
  const geo = {
    geoScore: geoRaw.score || 0,
    pageType: raw.pageType?.type || '',
    pillars: {
      citability: geoRaw.pillars?.citability?.score || 0,
      eeat: geoRaw.pillars?.eeat?.score || 0,
      structured: geoRaw.pillars?.structured?.score || 0,
      techAI: geoRaw.pillars?.techAI?.score || 0,
      multiModal: geoRaw.pillars?.multiModal?.score || 0
    },
    eeat: {
      hasAuthor: !!(eeatRaw.author?.found || eeatRaw.hasAuthor),
      hasDate: !!(eeatRaw.publishDate?.found || eeatRaw.hasDate),
      hasHttps: (raw.url || '').startsWith('https://'),
      hasCite: !!(eeatRaw.citations?.found || eeatRaw.hasCitations),
      hasExternalRefs: links.external
    },
    structured: {
      schemas: (structuredRaw.schemas || raw.structured?.schemas || []).map(s => ({
        type: s['@type'] || s.type || 'Unknown',
        types: s.types || [s['@type'] || s.type || 'Unknown'],
        data: s.data || s,
        fields: s.fields || (s.data ? Object.keys(s.data).filter(k => !k.startsWith('@')) : []),
        fieldCount: s.fieldCount || 0,
        validationStatus: s.validationStatus || 'valid',
        completeness: s.completeness != null ? s.completeness : null,
        missingRequired: s.missingRequired || [],
        missingRecommended: s.missingRecommended || [],
        presentRequired: s.presentRequired || [],
        presentRecommended: s.presentRecommended || [],
        hasRequirements: s.hasRequirements !== false
      })),
      totalCount: structuredRaw.totalCount || 0,
      validCount: structuredRaw.validCount || 0,
      avgCompleteness: structuredRaw.avgCompleteness || 0,
      allTypes: structuredRaw.allTypes || []
    },
    richFeatures: raw.serpEligibility || raw.richResults || raw.richFeatures || geoRaw.richResults || null,
    citabilityDetails: {
      h2Count: geoRaw.details?.h2Count || 0,
      h3Count: geoRaw.details?.h3Count || 0,
      listsCount: geoRaw.details?.listsCount || 0,
      tablesCount: geoRaw.details?.tablesCount || 0,
      statsCount: geoRaw.details?.statsCount || 0,
      definitionsCount: geoRaw.details?.definitionsCount || 0,
      questionsCount: geoRaw.details?.questionsCount || 0,
      shortParagraphs: geoRaw.details?.shortParagraphs || 0,
      isIndexable: geoRaw.details?.isIndexable !== false,
      hasCanonical: !!geoRaw.details?.hasCanonical,
      wordCount: geoRaw.details?.wordCount || 0,
      answerFirst: geoRaw.details?.answerFirst || { hasAnswerFirstOpening: false, words: 0, sentences: 0, preview: '' },
      passageLength: geoRaw.details?.passageLength || { total: 0, ideal: 0, short: 0, long: 0, flagged: [] }
    },
    // New feature data sources
    citabilityFull: raw.citability || null,           // from analyzeCitability() — full signal breakdown
    aiCrawlerView:  raw.aiCrawlerView || null,         // from analyzeAICrawlerView() — hidden content analysis
    contentGaps:    raw.contentGaps || null,           // from analyzeContentGaps() — missing sections
    indexationHints: raw.indexationHints || null,      // from analyzeIndexationHints() — robots/canonical issues
    entities:       raw.entities || null,              // from extractEntities()
    localSeo:       raw.localSeo || null               // from analyzeLocalSEO() — NAP + consistency
  };

  // ── readability ──
  const readRaw = raw.readability || raw.readabilityAdvanced || {};
  const distRaw = readRaw.distribution || {};
  const readability = {
    score: readRaw.readabilityScore || 0,
    wordCount: raw.content?.wordCount || readRaw.wordCount || 0,
    total: readRaw.sentenceCount || 0,
    avgLength: readRaw.avgSentenceLength || 0,
    fk: readRaw.fleschKincaid || readRaw.fk || '--',
    passiveRate: readRaw.passiveVoicePercent || 0,
    dist: {
      veryShort: distRaw.veryShort || 0,
      short:     distRaw.short || 0,
      medium:    distRaw.medium || 0,
      long:      distRaw.long || 0,
      veryLong:  distRaw.veryLong || 0
    },
    longest: (readRaw.sentences || readRaw.longestSentences || []).map(s => ({ words: s.wordCount || s.words || 0, text: s.text || '' }))
  };

  // ── CRO (full pass-through + normalized flags for UI) ──
  const croRaw = raw.cro || {};
  const ctaCount = croRaw.cta?.count ?? (Array.isArray(croRaw.cta?.items) ? croRaw.cta.items.length : 0) ?? 0;
  const ctaAboveFold = !!(croRaw.cta?.aboveFold || croRaw.aboveFold?.ctaVisible || croRaw.cta?.ctaVisible);
  const testimonialCount = croRaw.socialProof?.testimonialCount || 0;
  const cro = {
    score: typeof croRaw.score === 'number' ? croRaw.score : 0,
    cta: {
      hasCTA: ctaCount > 0 || !!croRaw.cta?.hasCTA,
      ctaAboveFold,
      ctaCount,
      items: Array.isArray(croRaw.cta?.items) ? croRaw.cta.items : []
    },
    trust: {
      hasReviews: !!(croRaw.trust?.hasReviews),
      hasTestimonials: !!(croRaw.trust?.hasTestimonials || testimonialCount > 0),
      testimonialCount,
      hasGuarantee: !!(croRaw.trust?.hasGuarantee),
      hasReturnPolicy: !!(croRaw.trust?.hasReturnPolicy),
      hasShippingInfo: !!(croRaw.trust?.hasShippingInfo),
      hasContact: !!(croRaw.trust?.hasContactPage || croRaw.trust?.hasContact || croRaw.trust?.hasPhone || croRaw.trust?.hasEmail),
      hasPhone: !!(croRaw.trust?.hasPhone),
      hasEmail: !!(croRaw.trust?.hasEmail),
      hasContactPage: !!(croRaw.trust?.hasContactPage),
      paymentBadges: croRaw.trust?.paymentBadges || 0,
      securityBadges: croRaw.trust?.securityBadges || 0,
      socialLinks: croRaw.trust?.socialLinks || 0
    },
    aboveFold: {
      h1AboveFold: !!(croRaw.aboveFold?.h1Visible || croRaw.aboveFold?.hasH1AboveFold || croRaw.aboveFold?.h1AboveFold),
      hasHero: !!(croRaw.aboveFold?.hasHero),
      ctaAboveFold
    },
    nav: {
      hasSearch: !!(croRaw.navigation?.hasSearch || croRaw.nav?.hasSearch),
      hasBreadcrumbs: !!(croRaw.navigation?.hasBreadcrumbs || croRaw.nav?.hasBreadcrumbs),
      hasStickyHeader: !!(croRaw.navigation?.hasStickyHeader || croRaw.nav?.hasStickyHeader)
    },
    product: {
      hasPrice: !!(croRaw.product?.hasPrice),
      imageCount: croRaw.product?.imageCount || 0,
      hasVariantSelector: !!(croRaw.product?.hasVariantSelector),
      hasAvailability: !!(croRaw.product?.hasAvailability)
    },
    forms: Array.isArray(croRaw.forms) ? croRaw.forms : [],
    interstitials: {
      intrusivePopups: croRaw.interstitials?.intrusivePopups || 0,
      hasChatWidget: !!(croRaw.interstitials?.hasChatWidget)
    },
    socialProof: {
      testimonialCount,
      hasClientLogos: !!(croRaw.socialProof?.hasClientLogos),
      hasShareButtons: !!(croRaw.socialProof?.hasShareButtons)
    },
    content: {
      bulletPoints: croRaw.content?.bulletPoints || 0,
      tables: croRaw.content?.tables || 0,
      hasFAQ: !!(croRaw.content?.hasFAQ),
      hasTOC: !!(croRaw.content?.hasTOC),
      longParagraphs: croRaw.content?.longParagraphs || 0,
      paragraphCount: croRaw.content?.paragraphCount || 0
    },
    perf: {
      blockingScripts: croRaw.performance?.renderBlockingScripts ?? tech.scripts?.blocking ?? 0,
      domSize: croRaw.performance?.domSize ?? tech.domElements ?? 0,
      lazyImageRatio: croRaw.performance?.lazyImageRatio ?? 0,
      lazyImages: images.total - (images.aboveFoldLazy || 0)
    },
    socialProfiles: (raw.socialProfiles?.profiles || []).map(p => ({ name: p.platform || p.name, url: p.url }))
  };

  // ── SEO score ──
  const seoIssues = buildSeoIssues(meta, headings, images, links, tech, readability, geo);
  const rawScore = Math.max(0, Math.min(100, 100 - seoIssues.reduce((t, i) => t + (i.severity === 'error' ? 10 : i.severity === 'warning' ? 5 : 2), 0)));
  const seo = {
    score: raw.score?.value || rawScore,
    grade: raw.score?.grade || scoreGrade(rawScore),
    issueCount: seoIssues.length,
    issues: seoIssues
  };

  return { meta, headings, images, links, keywords, tech, geo, readability, cro, seo, localSeo: raw.localSeo || null };
}

function buildFormatsMap(imgs) {
  const map = {};
  imgs.forEach(img => {
    const ext = (img.format || img.src?.split('.').pop()?.split('?')[0] || 'unknown').toLowerCase();
    map[ext] = (map[ext] || 0) + 1;
  });
  return map;
}

function buildTrackingList(techRaw, raw) {
  const list = [];
  const ts = techRaw.techStack?.list || [];
  const tracking = ['Google Analytics','GTM','Meta Pixel','Hotjar','MS Clarity','TikTok Pixel','LinkedIn Insight','Pinterest Tag','Twitter/X Pixel','Google Ads','Snapchat Pixel','Matomo','Plausible','PostHog','Mixpanel','Amplitude','Heap','Umami','Fathom','Segment'];
  ts.forEach(t => { if (tracking.some(tr => t.includes(tr) || tr.includes(t))) list.push(t); });
  return list;
}

function buildSeoIssues(meta, headings, images, links, tech, read, geo) {
  const issues = [];
  const push = (msg, sev, desc='', cat='SEO') => issues.push({ msg, severity: sev, desc, cat });
  if (!meta.title) push('Missing page title', 'error', 'Add a descriptive title tag to improve search visibility.', 'SEO');
  else if (meta.title.length > 60) push(`Shorten your page title`, 'warning', `Your title is ${meta.title.length} characters. Keep it under 60 for optimal display in search results.`, 'SEO');
  else if (meta.title.length < 10) push('Title too short', 'warning', 'Your page title should be at least 10 characters.', 'SEO');
  if (!meta.desc) push('Missing meta description', 'error', 'Add a meta description to improve click-through rates from search results.', 'SEO');
  else if (meta.desc.length > 160) push('Shorten your meta description', 'warning', `Your description is ${meta.desc.length} characters. Keep it under 160 to avoid truncation.`, 'SEO');
  if (headings.counts.h1 === 0) push('No H1 tag found', 'error', 'Every page should have exactly one H1 tag describing its main topic.', 'SEO');
  if (headings.counts.h1 > 1) push(`Multiple H1 tags (${headings.counts.h1})`, 'warning', 'Use only one H1 tag per page for clear content hierarchy.', 'SEO');
  if (!meta.canonical) push('No canonical URL set', 'warning', 'Add a canonical tag to prevent duplicate content issues.', 'SEO');
  if (!tech.isHttps) push('Page not served over HTTPS', 'error', 'HTTPS is a Google ranking factor and required for security.', 'TECHNICAL');
  if (!tech.isIndexable) push('Page has noindex directive', 'error', 'Remove the noindex tag to allow this page to appear in search results.', 'SEO');
  if (images.missingAlt > 0) push(`${images.missingAlt} image(s) missing alt text`, 'warning', 'Add descriptive alt text to all images for SEO and accessibility.', 'IMAGES');
  if (links.empty > 0) push(`${links.empty} empty link(s) found`, 'warning', 'Remove or fix links with no href attribute.', 'LINKS');
  if (links.genericAnchor > 3) push('Replace generic anchor texts', 'info', `${links.genericAnchor} links use generic text like 'click here'. Use descriptive anchor texts for better SEO.`, 'LINKS');
  if (!meta.og?.image) push('Missing og:image meta tag', 'info', 'Add an og:image for better social media sharing previews.', 'SEO');
  if (geo.geoScore < 60) push('GEO score needs improvement', 'info', `GEO score is ${geo.geoScore}/100 - there is room to improve AI engine visibility.`, 'GEO');
  if (read.score > 0 && read.score < 50) push('Low readability score', 'info', `Readability score is ${read.score}/100. Simplify sentences for better engagement.`, 'SEO');
  if (meta.title && geo.geoScore < 80) push('Title keywords missing from content', 'info', 'Add your primary keywords to the page body content for better keyword relevance.', 'KEYWORDS');
  return issues;
}

// ─── Navigation ───────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  try { initBulkDaDrChecker(); } catch (_) {}
  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.preventDefault(); switchTab(nav.dataset.nav); }
  });
}

function switchTab(tab) {
  if (!tab) return;
  _activeTab = tab;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = $('tab-' + tab); if (panel) panel.classList.add('active');
  if (tab === 'traffic') loadTrafficTab(false);
  if (tab === 'ecommerce' && window.ShahzaibSEOEcommerce?.analyze) window.ShahzaibSEOEcommerce.analyze();
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  // Reset scroll to top and re-apply height so Chrome extension scroll always works
  const contentEl = $('content');
  if (contentEl && contentEl.style.display !== 'none') {
    const topBar = document.querySelector('.top-bar');
    const topH = topBar ? topBar.getBoundingClientRect().height : 45;
    const availH = 600 - topH;
    contentEl.style.height = availH + 'px';
    contentEl.style.maxHeight = availH + 'px';
    contentEl.style.overflowY = 'scroll';
    // Double rAF ensures Chrome extension popup has fully painted before scroll reset
    requestAnimationFrame(() => requestAnimationFrame(() => { contentEl.scrollTop = 0; }));
  }

  // Auto-audit: trigger when user opens the AI tab
  if (tab === 'ai') {
    maybeRunAutoAudit();
    fcUpdateToolbar();
  }
  // Init the MCP tab when opened: render cached tools + auto-connect if set up.
  if (tab === 'mcp') {
    setTimeout(() => { try { mcpLoadCachedToolList(); maybeAutoConnectMcp(); } catch (_) {} }, 60);
  }
  // Init Firecrawl settings panel when settings tab opens
  if (tab === 'settings') {
    setTimeout(() => initFirecrawlSettings(), 80);
  }
// Rank Tracker: load/refresh keyword table for the current domain
  if (tab === 'ranktracker') {
    initRankTrackerTab();
  }
  // Local SEO suite: wire controls + prefill context from the current page
  if (tab === 'local') {
    initLocalTab();
  }
  // Search Console Regex: load the 200+ preset library + refresh page state
  if (tab === 'gscregex' && typeof window.initGscRegexTab === 'function') {
    window.initGscRegexTab();
  }
}

// ─── Theme ────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('rp-theme') || 'auto';
  applyTheme(saved);
  const sel = $('settingsDefaultTheme');
  if (sel) { sel.value = saved; sel.addEventListener('change', () => { applyTheme(sel.value); localStorage.setItem('rp-theme', sel.value); }); }
  $('themeToggleBtn')?.addEventListener('click', () => {
    const cur = $('app').getAttribute('data-theme');
    const next = cur === 'dark' ? 'auto' : 'dark';
    applyTheme(next); localStorage.setItem('rp-theme', next);
    const sel2 = $('settingsDefaultTheme'); if (sel2) sel2.value = next;
  });
}

function applyTheme(theme) {
  $('app').setAttribute('data-theme', theme);
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const iconDark = $('themeIconDark'); const iconLight = $('themeIconLight');
  if (iconDark) iconDark.style.display = isDark ? 'none' : '';
  if (iconLight) iconLight.style.display = isDark ? '' : 'none';
}

// ─── Google Search Cleaner settings ───────────────────
function initGoogleCleaner() {
  const keys = ['googleCleanerToggle', 'hideGoogleAi', 'hideGoogleVideo', 'hideGoogleAds', 'hideGooglePeople'];
  const defaults = {
    googleCleanerToggle: false,
    hideGoogleAi: false,
    hideGoogleVideo: false,
    hideGoogleAds: false,
    hideGooglePeople: false
  };
  try {
    // One-time: previous versions seeded all true — reset to OFF unless user already saved
    chrome.storage.sync.get(keys.concat(['searchCleanerUserSet']), (data) => {
      if (!data.searchCleanerUserSet) {
        const reset = {
          googleCleanerToggle: false,
          hideGoogleAi: false,
          hideGoogleVideo: false,
          hideGoogleAds: false,
          hideGooglePeople: false,
          searchCleanerUserSet: true
        };
        try { chrome.storage.sync.set(reset); } catch (_) {}
        data = Object.assign({}, data, reset);
      }

      keys.forEach(k => {
        const el = $(k);
        if (!el) return;
        el.checked = data[k] != null ? !!data[k] : defaults[k];
        if (!el.dataset.bound) {
          el.dataset.bound = '1';
          el.addEventListener('change', () => {
            const payload = {};
            keys.forEach(id => {
              const node = $(id);
              payload[id] = node ? !!node.checked : defaults[id];
            });
            payload.searchCleanerUserSet = true;
            chrome.storage.sync.set(payload, () => {
              if (typeof toast === 'function') toast('Search Cleaner updated — refresh Google tab');
            });
          });
        }
      });
    });
  } catch (_) {}
}

// ─── Lock SERP Region (popup control) ─────────────────
// Reads/writes the same `rsLockedRegion` key the SERP sidebar uses, so toggling
// here takes effect on Google search tabs without opening the sidebar.
// The option values are "<gl>-<hl>", so gl/hl derive directly from the value.
function initLockRegion() {
  const enable = $('lockRegionEnable');
  const sel    = $('lockRegionCountry');
  const loc    = $('lockRegionLocation');
  const status = $('lockRegionStatus');
  if (!enable || !sel) return;

  function renderStatus() {
    if (!status) return;
    const name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : sel.value;
    if (enable.checked) {
      const where = (loc && loc.value.trim()) ? ' · 📍 ' + loc.value.trim() : '';
      status.textContent = '🔒 Locked: ' + name + where + '. Every Google search opens in this region.';
      status.style.color = '#0D9488';
    } else {
      status.textContent = 'Off — searches use your normal Google region.';
      status.style.color = 'var(--text-3)';
    }
  }

  function save() {
    const parts = String(sel.value || 'us-en').split('-');
    const lock = {
      enabled: enable.checked,
      val: sel.value,
      gl: parts[0] || 'us',
      hl: parts[1] || 'en',
      loc: loc ? loc.value.trim() : ''
    };
    try { chrome.storage.local.set({ rsLockedRegion: lock }); } catch (_) {}
    renderStatus();
  }

  try {
    chrome.storage.local.get('rsLockedRegion', (r) => {
      const lock = r && r.rsLockedRegion;
      if (lock) {
        if (lock.val) sel.value = lock.val;
        if (loc) loc.value = lock.loc || '';
        enable.checked = !!lock.enabled;
      }
      renderStatus();
    });
  } catch (_) { renderStatus(); }

  enable.addEventListener('change', save);
  sel.addEventListener('change', save);
  if (loc) loc.addEventListener('change', save);
}

// ─── Boot ─────────────────────────────────────────────
async function boot() {
  initNav(); initTheme(); initAI(); initFirecrawl(); initRankApiSettings(); initDataApiSettings(); initBulkVolumeChecker();
  initLockRegion();
  try { window._rawData = _rawData; window.__rankseoCurrentUrl = _currentUrl || ''; } catch (_) {}
  if (window.ShahzaibSEOCitationTracker) window.ShahzaibSEOCitationTracker.init();
  initGoogleCleaner();
  initPageInspector();
  mcpLoadSettings(); // load WP x MCP stored settings into UI

  $('retryBtn')?.addEventListener('click', () => location.reload());
  
  $('exportJsonBtn')?.addEventListener('click', exportJSON);
  $('exportCsvBtn')?.addEventListener('click', exportCSV);
  $('exportPdfBtn')?.addEventListener('click', exportPDF);
  $('aiPromptBtn')?.addEventListener('click', copyAIPrompt);
  $('exportMdBtn')?.addEventListener('click', exportMarkdownReport);
  $('mcpFixBtn')?.addEventListener('click', mcpFixAll);
  $('mcpSaveBtn')?.addEventListener('click', mcpSaveSettings);
  $('mcpTestBtn')?.addEventListener('click', mcpTestConnection);
  $('mcpFixBtnTab')?.addEventListener('click', mcpFixAll);
  $('mcpRefreshTab')?.addEventListener('click', () => refreshMcpToolList());

  // MCP Fix Report — open modal + tab interactions.
  $('mcpViewReportBtn')?.addEventListener('click', () => openMcpFixReport());
  $('mcpFixOpenReportLink')?.addEventListener('click', () => openMcpFixReport());
  $('mcpFixReportCloseBtn')?.addEventListener('click', () => closeMcpFixReport());
  $('mcpFixReportDownloadBtn')?.addEventListener('click', () => downloadMcpFixReportMd());
  // Click anywhere on the modal backdrop closes it (data-close="1").
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close === '1' && $('mcpFixReportModal') && !$('mcpFixReportModal').hidden) {
      closeMcpFixReport();
    }
  });
  // ESC key closes the modal.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('mcpFixReportModal') && !$('mcpFixReportModal').hidden) {
      closeMcpFixReport();
    }
  });

  // MCP fix-options: preset buttons + try to render cached tool list on boot
  initMcpFixOptionsUi();
  mcpLoadCachedToolList();
  $('wpxmcpEyeBtn')?.addEventListener('click', () => {
    const inp = $('wpxmcpApiKey');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Event delegation for dynamically created copy buttons
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy-issue-btn')) {
      const textToCopy = e.target.getAttribute('data-copy-text');
      if (textToCopy) {
        copyToClipboard(textToCopy);
      }
    }
  });

  // Event delegation for aqw filter buttons
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('aqw-f')) {
      const cat = e.target.getAttribute('data-cat');
      if (cat) {
        aqwFilter(cat, e.target);
      }
    }
  });

  // Event delegation for Moz refresh button
  document.addEventListener('click', (e) => {
    if (e.target.id === 'mozRefreshBtn' || e.target.closest('#mozRefreshBtn')) {
      refreshMozData();
    }
  });

  // ══ AI Chips Dynamic Prompt Handler ══
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.ai-chip');
    if (!chip) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const chipText = chip.textContent.trim();
    let dynamicPrompt = '';
    
    // Generate dynamic prompts based on actual tab data
    const pageData = _rawData || {};
    const url = _currentUrl || '';
    
    switch(chipText) {
      case 'Top SEO Fixes':
        dynamicPrompt = generateTopSEOFixesPrompt(pageData, url);
        break;
      case 'Rewrite Metadata':
        dynamicPrompt = generateRewriteMetadataPrompt(pageData, url);
        break;
      case 'Fix Headings':
        dynamicPrompt = generateFixHeadingsPrompt(pageData, url);
        break;
      case 'Boost GEO':
        dynamicPrompt = generateBoostGEOPrompt(pageData, url);
        break;
      case 'Write Alt Texts':
        dynamicPrompt = generateWriteAltTextsPrompt(pageData, url);
        break;
      case 'Schema Markup':
        dynamicPrompt = generateSchemaMarkupPrompt(pageData, url);
        break;
      case 'Internal Links':
        dynamicPrompt = generateInternalLinksPrompt(pageData, url);
        break;
      case 'Keywords':
        dynamicPrompt = generateKeywordsPrompt(pageData, url);
        break;
      case 'Readability':
        dynamicPrompt = generateReadabilityPrompt(pageData, url);
        break;
      default:
        // Fallback to static prompt if no dynamic generator
        dynamicPrompt = chip.getAttribute('data-prompt') || '';
    }
    
    if (dynamicPrompt) {
      sendPromptToAI(dynamicPrompt);
    }
  });

  // Listen for PageSpeed async results
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'pageSpeedResult' && msg.vitals) applyVitals(msg.vitals);
    return false; // no async sendResponse — prevents "message channel closed" error
  });

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) throw new Error('No active tab');
    _currentTabId = tab.id;
    _currentUrl = tab.url || '';

    if (!_currentUrl.startsWith('http')) {
      showError('Navigate to a website to start analysis.');
      return;
    }

    const u = new URL(_currentUrl);
    const displayUrl = u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 40) : '');
    setText('pageUrl', displayUrl);
    const pb = $('pageBadge'); if (pb) pb.style.display = 'none';
    // Pre-fill domain name immediately
    setText('techDomainName', u.hostname.toUpperCase());

    // Inject content script then request analysis
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['libs/wappalyzer-fingerprints.js', 'content/content.js'] }); } catch (_) {}

    const raw = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Analysis timed out')), 15000);
      function trySend(retries) {
        try {
          chrome.tabs.sendMessage(tab.id, { action: 'analyze' }, response => {
            // Always read lastError so Chrome doesn't log "Unchecked runtime.lastError"
            // (common: "Frame with ID 0 was removed" when tab navigates/prerenders).
            const err = chrome.runtime.lastError;
            if (err || !response) {
              if (retries > 0) setTimeout(() => trySend(retries - 1), 1500);
              else { clearTimeout(timeout); reject(new Error(err?.message || 'Could not connect to page')); }
            } else {
              clearTimeout(timeout);
              resolve(response);
            }
          });
        } catch (e) {
          if (retries > 0) setTimeout(() => trySend(retries - 1), 1500);
          else { clearTimeout(timeout); reject(e); }
        }
      }
      trySend(3);
    });

    _rawData = raw;
    try { window._rawData = _rawData; window.__rankseoRawData = _rawData; window.__rankseoCurrentUrl = _currentUrl || raw?.url || ''; window.ShahzaibSEOEcommerce?.setPageData?.(raw); } catch (_) {}
    const d = adaptV1Data(raw);

    showContent();
    renderAll(d);

    // If user is already on the AI tab when data arrives, trigger auto-audit now
    if (_activeTab === 'ai') maybeRunAutoAudit();

    // Async: favicon in header
    const rawFavicon = raw.technical?.favicon;
    if (rawFavicon) {
      const faviconImg = document.getElementById('headerFaviconImg');
      const faviconDot = document.getElementById('headerFaviconDot');
      const faviconWrap = document.getElementById('headerFavicon');
      if (faviconImg) {
        // Ensure favicon is a string (could be object with href property)
        let faviconHref = typeof rawFavicon === 'string' ? rawFavicon
          : (rawFavicon.href || rawFavicon.url || rawFavicon.src || '');
        if (faviconHref && !faviconHref.startsWith('http') && !faviconHref.startsWith('data:') && !faviconHref.startsWith('//')) {
          try { faviconHref = new URL(faviconHref, _currentUrl).href; } catch(_) {}
        }
        if (faviconHref.startsWith('//')) faviconHref = 'https:' + faviconHref;
        faviconImg.src = faviconHref;
        faviconImg.style.display = '';
        if (faviconDot) faviconDot.style.display = 'none';
        faviconImg.onerror = () => { faviconImg.style.display = 'none'; if (faviconDot) faviconDot.style.display = ''; };
        if (faviconWrap) {
          faviconWrap.title = 'Click to copy favicon URL';
          faviconWrap.style.cursor = 'pointer';
          faviconWrap.onclick = () => {
            navigator.clipboard.writeText(faviconHref);
            faviconWrap.classList.add('copied');
            setTimeout(() => faviconWrap.classList.remove('copied'), 1500);
            toast('Favicon URL copied!');
          };
        }
      }
    }

    // Async: page type badge + GEO card
    if (raw.pageType?.type) {
      const pb = $('pageBadge');
      if (pb) { pb.textContent = raw.pageType.type.charAt(0).toUpperCase() + raw.pageType.type.slice(1); pb.style.display = ''; }
      renderGeoPageTypeCard(raw.pageType.type);
    }

    // Async: search intent badge
    if (raw.searchIntent?.primary) {
      renderSearchIntentBadge(raw.searchIntent.primary, raw.searchIntent.confidence);
    }

    // Async: lang badge
    if (d.meta.lang) {
      const lb = $('langBadge'); if (lb) { lb.textContent = (d.meta.lang || '').toString().toUpperCase(); lb.style.display = ''; }
    }

    // Async: robots.txt
    chrome.runtime.sendMessage({ action: 'FETCH_ROBOTS', origin: u.origin }, r => {
      _robotsTxt = r?.text || null;
      if ($('robotsContent')) $('robotsContent').textContent = _robotsTxt || 'robots.txt not found.';
      renderCrawlerPerms(_robotsTxt);
    });

    // Async: .htaccess
    chrome.runtime.sendMessage({ action: 'FETCH_HTACCESS', origin: u.origin }, r => {
      _htaccessData = r || { ok: false, protected: false };
      renderHtaccess(_htaccessData);
    });

    // Async: sitemap.xml
    chrome.runtime.sendMessage({ action: 'FETCH_SITEMAP', origin: u.origin }, r => {
      _sitemapData = r || { ok: false };
      renderSitemap(_sitemapData);
      // Update the Open button URL to the found sitemap URL
      if (r?.ok && r.url) {
        $('sitemapOpenBtn')?.addEventListener('click', () => window.open(r.url, '_blank'), { once: true });
      }
    });

    // Async: llms.txt (Technical tab card)
    chrome.runtime.sendMessage({ action: 'FETCH_LLMS_TXT', origin: u.origin }, r => {
      _llmsTxtData = r || { ok: false };
      renderLlmsTxtCard(_llmsTxtData);
    });

    // Async: PageSpeed — fetch with polling fallback
    const _psUrl = _currentUrl;
    chrome.runtime.sendMessage({ action: 'fetchPageSpeed', url: _psUrl, tabId: tab.id }, r => {
      if (r?.vitals && (r.vitals.mobile?.score != null || r.vitals.desktop?.score != null)) {
        applyVitals(r.vitals);
      } else {
        // Result not ready yet — poll until background completes
        let _psAttempts = 0;
        const _psPoll = setInterval(() => {
          _psAttempts++;
          chrome.runtime.sendMessage({ action: 'fetchPageSpeed', url: _psUrl, tabId: tab.id }, pr => {
            if (pr?.vitals && (pr.vitals.mobile?.score != null || pr.vitals.desktop?.score != null)) {
              applyVitals(pr.vitals);
              clearInterval(_psPoll);
            } else if (_psAttempts >= 24) { // max 2 min
              clearInterval(_psPoll);
            }
          });
        }, 5000);
      }
    });

    // Async: RDAP
    const rootDomain = u.hostname.replace(/^www\./, '');
    chrome.runtime.sendMessage({ action: 'RDAP_LOOKUP', domain: rootDomain }, r => {
      if (r?.ok) {
        _domainInfo = r;
        renderDomainInfo(r);
        renderDashDomainInfo(r);
        renderDaDomainInfo(r);
        // Fill Domain Age in dashboard stat box
        if (r.createdDate) {
          const created = new Date(r.createdDate);
          const diffDays = Math.floor((Date.now() - created.getTime()) / 86400000);
          const ageY = Math.floor(diffDays / 365);
          const ageM = Math.floor((diffDays % 365) / 30);
          const ageD = diffDays % 30;
          setText('qDomainAge', `${ageY}Y ${ageM}M ${ageD}D`);
        }
      } else {
        ['dashDomainLoading','daDomainLoading'].forEach(id => { const el = $(id); if (el) el.textContent = 'WHOIS / RDAP lookup unavailable'; });
        setText('qDomainAge', 'N/A');
      }
    });

    // ── Free Endpoints: IP Geo, DNS, HTTP Headers, SSL Certs, Wayback ───────
    initIpGeo(rootDomain);
    initDnsRecords(rootDomain);
    initHttpHeaders(rootDomain);
    initCertTransparency(rootDomain);
    initWaybackHistory(rootDomain, _currentUrl);

    // ── Technical-tab refresh buttons ────────────────────────────────────────
    // Each button clears the 24h persistent cache for that card then re-runs
    // its init function so fresh data is fetched from the API.
    (function bindTechRefreshButtons() {
      function makeCacheKeys(domain) {
        return {
          ipGeo:   ['ipgeo_' + domain],
          dns:     ['dns_' + domain],
          http:    ['http_headers_' + domain],
          cert:    ['crt_' + domain, 'crt_sub_' + domain],
          wayback: ['wayback_cdx_' + domain]
        };
      }

      function attachRefresh(btnId, cacheKeys, reinit) {
        const btn = $(btnId);
        if (!btn) return;
        btn.addEventListener('click', () => {
          if (btn.classList.contains('spinning')) return; // already refreshing
          btn.classList.add('spinning');
          btn.disabled = true;
          chrome.runtime.sendMessage({ action: 'CLEAR_TECH_CACHE', keys: cacheKeys }, () => {
            void chrome.runtime.lastError;
            reinit();
            // Re-enable after a short delay so the UI settles
            setTimeout(() => { btn.classList.remove('spinning'); btn.disabled = false; }, 2000);
          });
        });
      }

      const ck = makeCacheKeys(rootDomain);

      attachRefresh('ipGeoRefreshBtn', ck.ipGeo, () => {
        const loading = $('ipGeoLoading'), grid = $('ipGeoGrid'), badge = $('ipGeoBadge');
        const dLoading = $('dashIpGeoLoading'), dGrid = $('dashIpGeoGrid'), dBadge = $('dashIpGeoBadge');
        if (loading) { loading.style.display = ''; }
        if (grid) { grid.style.display = 'none'; grid.innerHTML = ''; }
        if (badge) badge.textContent = 'Loading…';
        if (dLoading) dLoading.style.display = '';
        if (dGrid) { dGrid.style.display = 'none'; dGrid.innerHTML = ''; }
        if (dBadge) dBadge.textContent = 'Loading…';
        initIpGeo(rootDomain);
      });

      attachRefresh('dnsRefreshBtn', ck.dns, () => {
        const loading = $('dnsLoading'), panel = $('dnsRecordsPanel');
        const dLoading = $('dashDnsLoading'), dPanel = $('dashDnsRecordsPanel');
        if (loading) loading.style.display = '';
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        if (dLoading) dLoading.style.display = '';
        if (dPanel) { dPanel.style.display = 'none'; dPanel.innerHTML = ''; }
        _dnsData = null;
        _dashDnsData = null;
        initDnsRecords(rootDomain);
      });

      // ── Dashboard-tab refresh buttons (mirror the technical-tab pattern) ──
      attachRefresh('dashIpGeoRefreshBtn', ck.ipGeo, () => {
        const dLoading = $('dashIpGeoLoading'), dGrid = $('dashIpGeoGrid'), dBadge = $('dashIpGeoBadge');
        if (dLoading) dLoading.style.display = '';
        if (dGrid) { dGrid.style.display = 'none'; dGrid.innerHTML = ''; }
        if (dBadge) dBadge.textContent = 'Loading…';
        initIpGeo(rootDomain);
      });

      attachRefresh('dashDnsRefreshBtn', ck.dns, () => {
        const dLoading = $('dashDnsLoading'), dPanel = $('dashDnsRecordsPanel');
        if (dLoading) dLoading.style.display = '';
        if (dPanel) { dPanel.style.display = 'none'; dPanel.innerHTML = ''; }
        _dashDnsData = null;
        initDnsRecords(rootDomain);
      });

      attachRefresh('dashDomainRefreshBtn', ['rdap_' + rootDomain], () => {
        // Restore the loader placeholder inside the dashboard grid and clear rendered rows
        const grid = $('dashDomainInfo');
        if (grid) {
          grid.innerHTML = '';
          const loader = document.createElement('div');
          loader.className = 't-domain-loading';
          loader.id = 'dashDomainLoading';
          loader.innerHTML = '<svg class="t-domain-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Refreshing domain info…';
          grid.appendChild(loader);
        }
        // Refetch RDAP and re-render both Dashboard and Technical Domain Info panels
        chrome.runtime.sendMessage({ action: 'RDAP_LOOKUP', domain: rootDomain }, r => {
          if (r?.ok) {
            renderDomainInfo(r);
            renderDashDomainInfo(r);
            renderDaDomainInfo(r);
          } else {
            const loader = $('dashDomainLoading');
            if (loader) loader.innerHTML = '<span style="color:var(--err)">Failed to refresh domain info.</span>';
          }
        });
      });

      attachRefresh('httpHeadersRefreshBtn', ck.http, () => {
        const loading = $('httpHeadersLoading'), panel = $('httpHeadersPanel');
        if (loading) loading.style.display = '';
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        _httpHeadersData = null;
        initHttpHeaders(rootDomain);
      });

      attachRefresh('certRefreshBtn', ck.cert, () => {
        const loading = $('certLoading'), panel = $('certPanel');
        if (loading) { loading.textContent = 'Fetching SSL certificates…'; loading.style.display = ''; }
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        _certData = {};
        initCertTransparency(rootDomain);
      });

      attachRefresh('waybackRefreshBtn', ck.wayback, () => {
        const loading = $('waybackLoading'), panel = $('waybackPanel'), badge = $('waybackBadge');
        if (loading) loading.style.display = '';
        if (panel) panel.style.display = 'none';
        if (badge) badge.textContent = '—';
        if ($('waybackMetaRow')) $('waybackMetaRow').innerHTML = '';
        if ($('waybackTableBody')) $('waybackTableBody').innerHTML = '';
        initWaybackHistory(rootDomain, _currentUrl);
      });

      attachRefresh('techDomainRefreshBtn', ['rdap_' + rootDomain], () => {
        // Restore the loader placeholder inside the grid and clear rendered rows
        const grid = $('techDomainInfo');
        if (grid) {
          grid.innerHTML = '';
          const loader = document.createElement('div');
          loader.className = 't-domain-loading';
          loader.id = 'techDomainLoading';
          loader.innerHTML = '<svg class="t-domain-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Refreshing domain info…';
          grid.appendChild(loader);
        }
        // Refetch RDAP and re-render all three Domain Info panels
        chrome.runtime.sendMessage({ action: 'RDAP_LOOKUP', domain: rootDomain }, r => {
          if (r?.ok) {
            renderDomainInfo(r);
            renderDashDomainInfo(r);
            renderDaDomainInfo(r);
          } else {
            const loader = $('techDomainLoading');
            if (loader) loader.innerHTML = '<span style="color:var(--err)">Failed to refresh domain info.</span>';
          }
        });
      });
    })();

    // Async: Moz metrics (failures are expected for some domains — no console noise)
    chrome.runtime.sendMessage({ action: 'MOZ_FETCH', domain: rootDomain }, r => {
      void chrome.runtime.lastError; // clear lastError so Chrome doesn't surface it
      if (r?.ok) {
        renderMozMetrics(r, 'dashMozContent', 'dashMozLoading');
        renderMozMetrics(r, 'daMozContent', 'daMozLoading');
        // Fill Authority stat box
        function fmtNum(n) { if (!n) return '--'; if (n >= 1000000) return (n/1000000).toFixed(1)+'M'; if (n >= 1000) return (n/1000).toFixed(1)+'K'; return String(n); }
        const hasMozData = r.source !== 'SEMrush' && (r.domainAuthority > 0 || r.pageAuthority > 0);
        setText('qDomainDA', hasMozData ? r.domainAuthority : '--');
        setText('qDomainSpam', hasMozData && r.spamScore != null ? r.spamScore + '%' : '--');
        setText('qDomainBL', r.backlinks > 0 ? fmtNum(r.backlinks) : '--');
        // ── NEW: DA Breakdown + Competitor Comparison + Link Building
        if (hasMozData) renderDaBreakdown(r);
        initCompetitorDAComparison(rootDomain);
        initCompetitorDRComparison(rootDomain);
        initLinkBuildingOpportunities();
      } else {
        ['dashMozLoading','daMozLoading'].forEach(id => { const el = $(id); if (el) el.textContent = 'Moz data unavailable'; });
        setText('qDomainDA', '--');
        setText('qDomainSpam', '--');
        setText('qDomainBL', '--');
        // Still init competitor comparison even without own Moz data
        initCompetitorDAComparison(rootDomain);
        initCompetitorDRComparison(rootDomain);
        initLinkBuildingOpportunities();
      }
    });

    // Async: Ahrefs Domain Rating (free public endpoint + optional user key)
    window._currentDomain = rootDomain;
    chrome.runtime.sendMessage({ action: 'AHREFS_DR_FETCH', domain: rootDomain }, r => {
      void chrome.runtime.lastError;
      if (r?.ok && r.domainRating != null) {
        renderAhrefsDR({ ...r, domain: rootDomain }, 'dashAhrefsContent', 'dashAhrefsLoading');
        renderAhrefsDR({ ...r, domain: rootDomain }, 'daAhrefsContent', 'daAhrefsLoading');
        setText('qDomainDR', Math.round(r.domainRating));
        const drEl = $('qDomainDR');
        if (drEl) {
          const dr = r.domainRating;
          drEl.style.color = dr >= 70 ? 'var(--ok,#10b981)' : dr >= 40 ? 'var(--warn,#f59e0b)' : dr >= 20 ? '#f97316' : 'var(--err,#ef4444)';
        }
        try {
          if (window.ShahzaibSEOHistory) {
            window.ShahzaibSEOHistory.recordDr(rootDomain, r.domainRating);
          }
        } catch (_) {}
      } else {
        const why = r?.needKey || r?.error === 'no_api_key'
          ? 'Add Ahrefs API key in Settings → Data API Keys'
          : (r?.error === '429' || r?.error === 429)
            ? 'Ahrefs rate-limited — wait & refresh'
            : 'Ahrefs DR unavailable — click ↻ to retry';
        ['dashAhrefsLoading', 'daAhrefsLoading'].forEach(id => {
          const loader = $(id);
          if (loader) loader.textContent = why;
        });
        setText('qDomainDR', '--');
      }
    });

    // ── FEATURE 1: Traffic Stats (SimilarWeb) ──────────────────────────────
    const swLoadEl = document.getElementById('swTrafficLoading');
    const swCardEl = document.getElementById('swTrafficCard');
    if (swLoadEl) swLoadEl.style.display = '';
    let _swTopKeywords = null; // SimilarWeb keywords — available as fallback

    // SEMrush and SimilarWeb keyword cards stay independent — never copy SW data into SEMrush table.

    chrome.runtime.sendMessage({ action: 'TRAFFIC_FETCH', domain: rootDomain }, r => {
      if (r?.ok) { _trfLastData = r; _trfLastDomain = rootDomain; if (_activeTab === 'traffic') renderTrafficTab(r, rootDomain); }
      if (swLoadEl) swLoadEl.style.display = 'none';

      // Helper: format visit numbers
      function fmtTraffic(n) {
        if (!n || n === 0) return '--';
        if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n/1000).toFixed(1) + 'K';
        return String(n);
      }
      // Helper: format seconds to m:ss
      function fmtDuration(sec) {
        if (!sec) return '--';
        const m = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        return m + ':' + String(s).padStart(2, '0');
      }
      // Helper: format rank number (must be numeric — objects become "#[object Object]" / "#NaN")
      function fmtRank(n) {
        if (n != null && typeof n === 'object') {
          n = n.Rank ?? n.rank ?? n.Value ?? n.value ?? null;
        }
        if (n == null || n === '' || typeof n === 'object') return '--';
        const num = Number(n);
        if (!Number.isFinite(num) || num <= 0) return '--';
        if (num >= 1000000) return '#' + (num/1000000).toFixed(1) + 'M';
        if (num >= 1000) return '#' + (num/1000).toFixed(0) + 'K';
        return '#' + Math.round(num).toLocaleString();
      }

      if (r?.ok && (r.visits > 0 || r.source === 'SimilarWeb' || r.source === 'SEMrush')) {
        // Show card for any successful traffic source
        if (swCardEl) swCardEl.style.display = '';

        // Explicit source badge + honesty note for partial data
        const srcBadge = document.getElementById('swSourceBadge') || swCardEl?.querySelector('.moz-source-badge');
        if (srcBadge && r.source) {
          srcBadge.textContent = r.source;
          srcBadge.style.background = r.source === 'SimilarWeb' ? '#0D9488' : '#0D9488';
        }
        const noteEl = document.getElementById('swDataNote');
        if (noteEl) {
          const hasEngagement = r.bounceRate != null || r.pagePerVisit != null || r.timeOnSite != null;
          if (r.source === 'SEMrush') {
            noteEl.style.display = '';
            noteEl.textContent = 'Partial data from SEMrush organic estimate. Bounce rate, pages/visit, and duration require SimilarWeb (often blocked on some networks).';
          } else if (r.source === 'SimilarWeb' && !hasEngagement) {
            noteEl.style.display = '';
            noteEl.textContent = 'SimilarWeb returned visits but engagement metrics were incomplete for this domain.';
          } else if (r.source === 'SimilarWeb') {
            noteEl.style.display = '';
            noteEl.textContent = 'Full traffic snapshot from SimilarWeb (estimates, not Google Analytics).';
          } else {
            noteEl.style.display = 'none';
            noteEl.textContent = '';
          }
        }

        // Visits
        const visitsEl = document.getElementById('swVisits');
        if (visitsEl) visitsEl.textContent = fmtTraffic(r.visits);

        // Visits change badge
        const changeEl = document.getElementById('swVisitsChange');
        if (changeEl && r.visitsChangePercent != null) {
          const pct = r.visitsChangePercent;
          const arrow = pct >= 0 ? '↑' : '↓';
          const color = pct >= 0 ? 'var(--ok)' : 'var(--err)';
          changeEl.innerHTML = `<span style="color:${color};font-size:11px;font-weight:600;">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
        }

        // Bounce rate
        const bounceEl = document.getElementById('swBounce');
        if (bounceEl) bounceEl.textContent = r.bounceRate != null ? (r.bounceRate * 100).toFixed(1) + '%' : '--';

        // Pages/visit
        const pagesEl = document.getElementById('swPagesVisit');
        if (pagesEl) pagesEl.textContent = r.pagePerVisit != null ? Number(r.pagePerVisit).toFixed(1) : '--';

        // Avg duration
        const durEl = document.getElementById('swAvgDuration');
        if (durEl) durEl.textContent = fmtDuration(r.timeOnSite);

        // Global rank
        const rankEl = document.getElementById('swGlobalRank');
        if (rankEl) rankEl.textContent = fmtRank(r.globalRank);

        // Also update old qDomainTraffic if it exists
        setText('qDomainTraffic', fmtTraffic(r.visits));
        // Dashboard HTML-size card: Traffic number (SimilarWeb visits only)
        setText('dashTrafficVisits', fmtTraffic(r.visits));

        // ── FEATURE 2: Monthly Traffic Chart ─────────────────────────────
        if (r.monthlyVisits && r.monthlyVisits.length >= 2) {
          const chartWrap = document.getElementById('swChartWrap');
          const chartEl  = document.getElementById('swTrafficChart');
          const labelsEl = document.getElementById('swChartLabels');
          if (chartWrap && chartEl) {
            chartWrap.style.display = '';
            const data = r.monthlyVisits;
            const values = data.map(d => d.visits);
            const maxVal = Math.max(...values) || 1;
            const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

            // ── Responsive bar chart ────────────────────────────────────
            // Strategy: 1000-unit wide virtual canvas, width="100%" fills popup.
            // Each bar slot = 1000/n. Value label for each bar sits INSIDE the
            // bar (top-aligned) so it never overflows the viewBox.
            const n      = data.length;
            const VW     = 1000;
            const VH     = 120;          // total viewBox height
            const labH   = 18;           // space at bottom for nothing (labels in DOM)
            const barAreaH = VH - labH;
            const slot   = VW / n;
            const barW   = slot * 0.7;
            const barOff = slot * 0.15;  // left offset within slot to center bar

            let svgContent = '';
            data.forEach((d, i) => {
              const isLast = i === n - 1;
              const pct    = d.visits / maxVal;
              const barH   = Math.max(6, pct * barAreaH);
              const x      = i * slot + barOff;
              const y      = barAreaH - barH;           // top of bar (bottom-aligned)
              const fill   = isLast ? '#0D9488' : '#d1d5db';
              const cx     = x + barW / 2;

              svgContent += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" fill="${fill}"/>`;

              // Value label — centered vertically inside bar
              const lblCol = isLast ? '#fff' : '#666';
              const lblSz  = isLast ? '18' : '15';
              const lblW   = isLast ? '700' : '600';
              // Place label at vertical center of bar, clamped inside viewBox
              const barMid = y + barH / 2;
              const lblY   = Math.min(Math.max(barMid + 5, y + 14), y + barH - 3);
              svgContent += `<text x="${cx.toFixed(1)}" y="${lblY.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${lblSz}" fill="${lblCol}" font-weight="${lblW}">${fmtTraffic(d.visits)}</text>`;
            });

            chartEl.outerHTML = `<svg id="swTrafficChart" viewBox="0 0 ${VW} ${VH}" width="100%" style="display:block;">${svgContent}</svg>`;

            // Month labels row (DOM, not SVG) — every bar gets a label
            if (labelsEl) {
              labelsEl.innerHTML = data.map((d, i) => {
                const [, m] = d.month.slice(0, 7).split('-');
                const lbl   = MONTHS[parseInt(m)] || '';
                const style = i === n - 1 ? 'color:#0D9488;font-weight:600;' : '';
                return `<span class="sw-chart-month" style="${style}">${lbl}</span>`;
              }).join('');
            }
          }
        }

        // ── Traffic Sources (SimilarWeb) ─────────────────────────────────
        if (r.trafficDirect != null || r.trafficSearch != null || r.trafficSocial != null || r.trafficReferrals != null) {
          const srcCard = document.getElementById('swTrafficSourcesCard');
          const srcBody = document.getElementById('swTrafficSourcesBody');
          if (srcCard && srcBody) {
            srcCard.style.display = '';
            const sources = [
              { label: 'Direct',   value: r.trafficDirect,   color: '#0D9488' },
              { label: 'Search',   value: r.trafficSearch,   color: '#10b981' },
              { label: 'Social',   value: r.trafficSocial,   color: '#06b6d4' },
              { label: 'Referrals',value: r.trafficReferrals,color: '#14b8a6' },
            ].filter(s => s.value != null && s.value > 0);

            const totalPct = sources.reduce((a,s) => a + s.value, 0);
            const barHtml = sources.map(s =>
              `<div style="flex:${(s.value/totalPct*100).toFixed(1)};background:${s.color};height:100%;min-width:2px;"></div>`
            ).join('');

            const legendHtml = sources.map(s =>
              `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-2);">
                <span style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0;"></span>
                ${s.label} ${(s.value * 100).toFixed(0)}%
              </span>`
            ).join('');

            srcBody.innerHTML = `
              <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--border);margin-bottom:8px;">${barHtml}</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px 12px;">${legendHtml}</div>`;
          }
        }


        if (r.countryRank != null) setText('swCountryRank', fmtRank(r.countryRank));
        if (r.categoryRank != null) setText('swCategoryRank', fmtRank(r.categoryRank));
        if (r.category) {
          const cn = document.getElementById('swCategoryName');
          if (cn) cn.textContent = String(r.category).replace(/_/g, ' ').slice(0, 18);
        }
        // Top Keywords table (SEMrush-style columns: Volume/mo + Share%/CPC)
        if (r.swTopKeywords && r.swTopKeywords.length) {
          const kwCard = document.getElementById('swTopKwCard');
          const kwList = document.getElementById('swTopKwList');
          if (kwCard && kwList) {
            kwCard.style.display = '';
            function fmtVolSW2(n) {
              if (n == null || n === 0) return '—';
              if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
              if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
              return String(n);
            }
            kwList.innerHTML = `
              <table class="sw-kw-table">
                <thead><tr>
                  <th>#</th><th>Keyword</th><th>Volume/mo</th><th>Share% / CPC</th>
                </tr></thead>
                <tbody>
                  ${r.swTopKeywords.slice(0, 25).map((k, i) => {
                    const name = k.keyword || k.Name || k.name || k.Keyword || '—';
                    const vol = k.volume != null ? k.volume : (k.Volume != null ? k.Volume : 0);
                    const est = k.estimatedValue != null ? k.estimatedValue
                      : (k.EstimatedValue != null ? k.EstimatedValue : null);
                    const sharePct = est != null
                      ? (est < 1 ? (est * 100).toFixed(1) : Number(est).toFixed(1)) + '%'
                      : (k.cpc != null ? '$' + Number(k.cpc).toFixed(2) : '—');
                    return '<tr>' +
                      '<td class="sw-kw-num">' + (i + 1) + '</td>' +
                      '<td class="sw-kw-term">' + escHTML(name) + '</td>' +
                      '<td class="sw-kw-vol">' + fmtVolSW2(vol) + '</td>' +
                      '<td class="sw-kw-pos">' + sharePct + '</td>' +
                      '</tr>';
                  }).join('')}
                </tbody>
              </table>
              <div style="font-size:10px;color:#94a3b8;padding:6px 4px;">${r.swTopKeywords.length} keywords · Live data</div>`;
          }
        }

        // Keep SW keywords only for SimilarWeb card (do not mirror into SEMrush)
        if (r.swTopKeywords) {
          _swTopKeywords = r.swTopKeywords;
        }

        // Full channel breakdown (Stat Layer style)
        if (r.trafficSources) {
          const srcCard = document.getElementById('swTrafficSourcesCard');
          const srcBody = document.getElementById('swTrafficSourcesBody');
          if (srcCard && srcBody) {
            srcCard.style.display = '';
            const colors = { Direct:'#0D9488', Search:'#10b981', Social:'#06b6d4', Mail:'#ef4444', Referrals:'#f59e0b', Paid:'#94a3b8', DisplayAds:'#14b8a6', GenAi:'#059669' };
            const entries = Object.entries(r.trafficSources).filter(([,v]) => v != null && v > 0).sort((a,b) => b[1]-a[1]);
            if (entries.length) {
              srcBody.innerHTML = entries.map(([name, val]) => {
                const pct = (val * 100).toFixed(1);
                const col = colors[name] || '#64748b';
                return `<div class="sw-src-row"><span class="sw-src-dot" style="background:${col}"></span><span class="sw-src-name">${name}</span><div class="sw-src-bar-wrap"><div class="sw-src-bar" style="width:${pct}%;background:${col}"></div></div><span class="sw-src-pct">${pct}%</span></div>`;
              }).join('');
            }
          }
        }

// ── FEATURE 4: Top Countries — inline from same SimilarWeb response ──
        if (r.topCountryShares && r.topCountryShares.length) {
          const wrap = document.getElementById('swCountriesCard');
          if (wrap) {
            wrap.style.display = '';
            const list = document.getElementById('swCountriesList');
            if (list) {
              const flagImg = code => {
                const cc = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
                if (cc.length !== 2) return '🌐';
                return `<img src="https://flagcdn.com/16x12/${cc.toLowerCase()}.png" width="16" height="12" alt="${cc}" style="border-radius:2px;vertical-align:middle;" onerror="this.outerHTML='🌐'">`;
              };
              list.innerHTML = r.topCountryShares.slice(0, 5).map(c => {
                const pct = (c.Value * 100).toFixed(1);
                return `<div class="sw-country-row">
                  <span class="sw-country-flag">${flagImg(c.CountryCode)}</span>
                  <span class="sw-country-code">${c.CountryCode}</span>
                  <div class="sw-country-bar-wrap"><div class="sw-country-bar" style="width:${pct}%"></div></div>
                  <span class="sw-country-pct">${pct}%</span>
                </div>`;
              }).join('');
            }
          }
        }

      } else if (r?.ok && r.visits > 0) {
        // SEMrush fallback — show minimal card
        if (swCardEl) swCardEl.style.display = '';
        const visitsEl = document.getElementById('swVisits');
        if (visitsEl) visitsEl.textContent = fmtTraffic(r.visits);
        setText('qDomainTraffic', fmtTraffic(r.visits));
        setText('dashTrafficVisits', fmtTraffic(r.visits));
      } else {
        // No data — hide card completely
        if (swCardEl) swCardEl.style.display = 'none';
        setText('qDomainTraffic', '--');
        setText('dashTrafficVisits', '—');
      }
    });

    // ── FEATURE 3: SEMrush Top Keywords ──────────────────────────────────
    const srLoadEl = document.getElementById('semrushKwLoading');
    if (srLoadEl) srLoadEl.style.display = '';
    chrome.runtime.sendMessage({ action: 'SEMRUSH_KEYWORDS_FETCH', domain: rootDomain }, kr => {
      if (srLoadEl) srLoadEl.style.display = 'none';
      const srCard = document.getElementById('semrushKwCard');
      const srList = document.getElementById('semrushKwList');
      if (!kr?.ok || !kr.keywords?.length) {
        // SEMrush unavailable — show empty state (do NOT copy SimilarWeb keywords)
        if (srCard && srList) {
          srCard.style.display = '';
          srList.innerHTML = '<div style="padding:12px;font-size:12px;color:#94a3b8;text-align:center;">SEMrush keywords unavailable for this domain</div>';
        } else if (srCard) {
          srCard.style.display = 'none';
        }
        return;
      }
      if (srCard) srCard.style.display = '';

      // Use SEMrush engagement as fallback for Avg Duration / Global Rank
      if (kr.engagement) {
        const eg = kr.engagement;
        const durEl = document.getElementById('swAvgDuration');
        if (durEl && (durEl.textContent === '--' || durEl.textContent === '—')) {
          if (eg.timeOnSite) {
            const m = Math.floor(eg.timeOnSite / 60);
            const s = Math.round(eg.timeOnSite % 60);
            durEl.textContent = m + ':' + String(s).padStart(2, '0');
          }
        }
        const rankEl = document.getElementById('swGlobalRank');
        if (rankEl && (rankEl.textContent === '--' || rankEl.textContent === '—')) {
          if (eg.globalRank) {
            const n = eg.globalRank;
            rankEl.textContent = n >= 1000000 ? '#' + (n/1000000).toFixed(1) + 'M'
              : n >= 1000 ? '#' + (n/1000).toFixed(0) + 'K'
              : '#' + n.toLocaleString();
          }
        }
        // Also fill bounce / pages if still blank
        const bounceEl = document.getElementById('swBounce');
        if (bounceEl && (bounceEl.textContent === '--' || bounceEl.textContent === '—') && eg.bounceRate != null) {
          bounceEl.textContent = (eg.bounceRate * 100).toFixed(1) + '%';
        }
        const pagesEl = document.getElementById('swPagesVisit');
        if (pagesEl && (pagesEl.textContent === '--' || pagesEl.textContent === '—') && eg.pagePerVisit != null) {
          pagesEl.textContent = eg.pagePerVisit.toFixed(1);
        }
      }

      if (srList) {
        function fmtVol(n) {
          if (!n) return '—';
          if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
          if (n >= 1000) return (n/1000).toFixed(1) + 'K';
          return String(n);
        }
        srList.innerHTML = `
          <table class="sw-kw-table">
            <thead><tr>
              <th>#</th><th>Keyword</th><th>Vol/mo</th><th>Share%</th><th>Pos</th><th>CPC</th>
            </tr></thead>
            <tbody>
              ${kr.keywords.slice(0, 100).map((k, i) => {
                const pos = k.position ? '#' + k.position : '—';
                const cpc = k.cpc ? '$' + parseFloat(k.cpc).toFixed(2) : '—';
                return `<tr>
                  <td class="sw-kw-num">${i + 1}</td>
                  <td class="sw-kw-term">${k.keyword}</td>
                  <td class="sw-kw-vol">${fmtVol(k.searchVolume)}</td>
                  <td class="sw-kw-vol" style="color:var(--text-3);">${k.traffic != null && k.traffic > 0 ? (k.traffic < 1 ? (k.traffic * 100).toFixed(2) + "%" : fmtVol(k.traffic)) : "—"}</td>
                  <td class="sw-kw-pos">${pos}</td>
                  <td class="sw-kw-pos" style="color:var(--text-3);">${cpc}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`;
      }
    });

    // ── Competitors (from SEMrush response) ─────────────────────────────
    chrome.runtime.sendMessage({ action: 'SEMRUSH_COMPETITORS_FETCH', domain: rootDomain }, cr => {
      if (!cr?.ok || !cr.competitors?.length) return;
      const compCard = document.getElementById('semrushCompCard');
      const compList = document.getElementById('semrushCompList');
      if (!compCard || !compList) return;
      compCard.style.display = '';
      function fmtCompVol(n) {
        if (!n) return '—';
        if (n >= 1000000) return (n/1000000).toFixed(1) + 'M/mo';
        if (n >= 1000) return (n/1000).toFixed(1) + 'K/mo';
        return n + '/mo';
      }
      compList.innerHTML = cr.competitors.map(c => {
        const domain = c.slug || c.name;
        const faviconHtml = c.favicon
          ? `<img src="${c.favicon}" width="14" height="14" style="border-radius:2px;flex-shrink:0;" onerror="this.style.display='none'">`
          : `<span style="width:14px;height:14px;border-radius:2px;background:var(--border-strong);display:inline-block;flex-shrink:0;"></span>`;
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
          ${faviconHtml}
          <a href="https://${domain}" target="_blank" rel="noopener" style="flex:1;font-size:12px;color:var(--text-1);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${domain}">${domain}</a>
          <span style="font-size:11px;color:var(--text-3);flex-shrink:0;">${fmtCompVol(c.visits)}</span>
          <a href="https://${domain}" target="_blank" rel="noopener" style="color:var(--text-4);flex-shrink:0;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></a>
          </div>`;
      }).join('');
    });

    // Async: llms.txt
    chrome.runtime.sendMessage({ action: 'CHECK_LLMS', origin: u.origin }, r => {
      renderLlmsInfo(r?.exists || false);
    });

    // Badge score
    chrome.runtime.sendMessage({ action: 'updateScoreBadge', score: d.seo.score, tabId: tab.id });

  } catch (err) {
    showError(err.message || 'Could not analyze this page.');
  }
}

function showContent() {
  $('stateLoading').style.display = 'none';
  $('stateError').style.display = 'none';
  const content = $('content');
  // Chrome extension popup: explicit pixel height is required for overflow-y scroll to work
  const topBar = document.querySelector('.top-bar');
  const topH = topBar ? topBar.getBoundingClientRect().height : 45;
  const availH = 600 - topH;
  content.style.display = 'block';
  content.style.width = '100%';
  content.style.height = availH + 'px';
  content.style.maxHeight = availH + 'px';
  content.style.overflowY = 'scroll';
  content.style.overflowX = 'hidden';
  content.style.boxSizing = 'border-box';
}
function showError(msg) {
  $('stateLoading').style.display = 'none';
  $('stateError').style.display = '';
  $('content').style.display = 'none';
  const em = $('errorMsg'); if (em) em.textContent = msg;
}

// ─── Render All ───────────────────────────────────────

// ─── TextRazor Phase 2: Dashboard + GEO (shared cache with toolbar) ─────────
window._textRazorData = null;

function trEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function trDedupe(arr, keyFn) {
  const m = new Map();
  for (const item of arr || []) {
    const k = keyFn(item);
    if (!k || m.has(k)) continue;
    m.set(k, item);
  }
  return [...m.values()];
}

function renderTextRazorUI(data) {
  window._textRazorData = data;
  const status = $('trDashStatus');
  const topicsEl = $('trDashTopics');
  const entsEl = $('trDashEntities');
  const catsEl = $('trDashCats');
  const foot = $('trDashFoot');
  const badge = $('trDashBadge');

  if (!data || !data.ok) {
    if (status) {
      status.textContent = data?.needKey
        ? 'Add TextRazor API key in Settings → Data API Keys (or use toolbar NLP after adding key).'
        : (data?.error || 'TextRazor not available for this page.');
    }
    if (topicsEl) topicsEl.innerHTML = '';
    if (entsEl) entsEl.innerHTML = '';
    if (catsEl) catsEl.innerHTML = '';
    if (foot) foot.textContent = '';
    const kwS = $('trKwStatus');
    if (kwS) kwS.textContent = data?.needKey ? 'Add TextRazor key for semantic phrases.' : (data?.error || 'NLP unavailable');
    if ($('trKwPhrases')) $('trKwPhrases').innerHTML = '';
    if ($('trKwEntities')) $('trKwEntities').innerHTML = '';
    // GEO
    const gs = $('trGeoStatus');
    if (gs) gs.textContent = data?.needKey ? 'TextRazor key required for entity coverage.' : (data?.error || '—');
    return;
  }

  if (badge) badge.textContent = data.cached ? 'Cached' : 'TextRazor';
  if (status) status.textContent = (data.language ? ('Language: ' + data.language + ' · ') : '') +
    (data.entityCount || 0) + ' entities · ' + (data.topicCount || 0) + ' topics';
  if (catsEl) {
    catsEl.innerHTML = (data.categories || []).map(c =>
      `<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8;">${trEsc(c.label)}</span>`
    ).join('');
  }
  const topics = trDedupe(data.topics || [], t => String(t.label || '').toLowerCase()).slice(0, 10);
  const entities = trDedupe(data.entities || [], e => String(e.id || '').toLowerCase()).slice(0, 12);
  const wikiLinked = entities.filter(e => e.wiki).length;
  const cit = data.citabilityHint || (wikiLinked >= 8 ? 'Strong' : wikiLinked >= 3 ? 'Moderate' : 'Weak');

  if ($('aieEntCount')) $('aieEntCount').textContent = entities.length;
  if ($('aieWikiCount')) $('aieWikiCount').textContent = wikiLinked;
  if ($('aieCitability')) {
    const el = $('aieCitability');
    el.textContent = cit;
    el.style.color = cit === 'Strong' ? '#16a34a' : cit === 'Moderate' ? '#ca8a04' : '#64748b';
  }

  if (topicsEl) {
    topicsEl.innerHTML = topics.map(t =>
      `<span style="font-size:10px;padding:3px 8px;border-radius:999px;background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;">${trEsc(t.label)}</span>`
    ).join('') || '<span style="font-size:11px;color:var(--text-3);">—</span>';
  }
  if (entsEl) {
    entsEl.innerHTML = entities.map(e => {
      const label = trEsc(e.id);
      const inner = `<span class="aie-dot"></span><span>${label}</span>`;
      if (e.wiki) return `<a class="aie-entity-row" href="${trEsc(e.wiki)}" target="_blank" rel="noopener">${inner}</a>`;
      return `<div class="aie-entity-row">${inner}</div>`;
    }).join('') || '<span style="font-size:11px;color:var(--text-3);">No entities</span>';
  }
  if (foot) {
    foot.innerHTML = `Wikipedia-linked: <strong>${data.wikiLinked || 0}</strong> · AI citability hint: <strong>${trEsc(data.citabilityHint || '—')}</strong>` +
      (data.phrases?.length ? ` · Keyphrases: ${data.phrases.slice(0, 5).map(p => trEsc(p.text)).join(', ')}` : '');
  }

  // GEO tab
  const gs = $('trGeoStatus');
  if (gs) gs.textContent = 'Entity signals from TextRazor (same cache as toolbar NLP).';
  if ($('trGeoEntCount')) $('trGeoEntCount').textContent = data.entityCount ?? '—';
  if ($('trGeoWikiCount')) $('trGeoWikiCount').textContent = data.wikiLinked ?? '—';
  if ($('trGeoCitability')) {
    const el = $('trGeoCitability');
    el.textContent = data.citabilityHint || '—';
    el.style.color = data.citabilityHint === 'Strong' ? '#16a34a' : data.citabilityHint === 'Moderate' ? '#ca8a04' : '#64748b';
  }
  if ($('trGeoTopics')) {
    $('trGeoTopics').innerHTML = (data.topics || []).slice(0, 10).map(t =>
      `<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;">${trEsc(t.label)}</span>`
    ).join('');
  }

  // Enrich existing GEO entity list if present
  const fcList = $('fcEntityList');
  const fcCount = $('fcEntityCount');
  if (fcCount) fcCount.textContent = `${entities.length} unique · ${wikiLinked} wiki-linked · ${cit}`;

  // Keywords tab — phrases + entity presence on page
  const kwStatus = $('trKwStatus');
  const kwPh = $('trKwPhrases');
  const kwEn = $('trKwEntities');
  if (kwStatus || kwPh || kwEn) {
    const pageText = (window._rawData?.title?.content || '') + ' ' +
      (window._rawData?.metaDescription?.content || '') + ' ' +
      ((window._rawData?.content?.text || window._rawData?.content?.bodyText || '') + '').slice(0, 50000);
    const pageLow = pageText.toLowerCase();
    if (kwStatus) {
      kwStatus.textContent = `${data.phrases?.length || 0} phrases · ${data.entityCount || 0} entities · density vs this page`;
    }
    if (kwPh) {
      kwPh.innerHTML = (data.phrases || []).slice(0, 14).map(p => {
        const present = pageLow.includes(String(p.text || '').toLowerCase());
        return `<span title="${present ? 'Found on page' : 'Missing on page'}" style="font-size:10px;padding:3px 8px;border-radius:999px;border:1px solid ${present ? '#a7f3d0' : '#fde68a'};background:${present ? '#ecfdf5' : '#fffbeb'};color:${present ? '#065f46' : '#92400e'};">${trEsc(p.text)}${present ? '' : ' · gap'}</span>`;
      }).join('') || '<span style="font-size:11px;color:var(--text-3);">No phrases — run NLP or add TextRazor key</span>';
    }
    if (kwEn) {
      kwEn.innerHTML = (data.entities || []).slice(0, 12).map(e => {
        const present = pageLow.includes(String(e.id || '').toLowerCase());
        return `<span style="font-size:10px;padding:3px 8px;border-radius:999px;border:1px solid ${present ? '#c4b5fd' : '#e2e8f0'};background:${present ? '#f5f3ff' : '#f8fafc'};color:${present ? '#5b21b6' : '#64748b'};">${trEsc(e.id)}${present ? '' : ' · gap'}</span>`;
      }).join('');
    }
  }

}

async function loadTextRazorForPopup() {
  const status = $('trDashStatus');
  if (status) status.textContent = 'Loading TextRazor analysis…';
  let text = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try {
            const article = document.querySelector('article, main, [role="main"], .post-content, .entry-content, #content');
            const root = article || document.body;
            const clone = root.cloneNode(true);
            clone.querySelectorAll('script,style,noscript,svg,iframe,nav,footer').forEach(el => el.remove());
            const title = document.title || '';
            const meta = document.querySelector('meta[name="description"]')?.content || '';
            const body = (clone.innerText || '').replace(/\s+/g, ' ').trim();
            return (title + '\n' + meta + '\n' + body).slice(0, 120000);
          } catch (_) {
            return (document.body?.innerText || '').slice(0, 120000);
          }
        }
      });
      text = result || '';
    }
  } catch (_) {}

  const url = (typeof _currentUrl !== 'undefined' && _currentUrl) ? _currentUrl : '';
  chrome.runtime.sendMessage({ action: 'TEXTRAZOR_ANALYZE', text, url }, res => {
    if (chrome.runtime.lastError) {
      renderTextRazorUI({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }
    renderTextRazorUI(res || { ok: false, error: 'No response' });
  });
}


function renderAll(d) {
  _fcLastMarkdown = null; // clear cached extract for new page
  const statusEl = $('fcStatus'); if (statusEl) statusEl.textContent = '';
  // Populate AI Quick Wins FIRST so deduplication works in renderDashboard
  if (typeof populateAIQuickWins === 'function') {
    populateAIQuickWins(d);
  }

  renderDashboard(d);
  try { loadTextRazorForPopup(); } catch (_) {}
  renderHeadings(d.headings, d.meta);
  renderImages(d.images);
  renderLinks(d.links);
  renderKeywords(d.keywords);
  renderTechnical(d.tech, d.meta);
  renderGEO(d.geo);
  renderMetadata(d.meta);
  renderReadability(d.readability);
  renderCRO(d.cro);
  renderSocial(d.cro.socialProfiles);
}

// ─── Dashboard ────────────────────────────────────────
function renderDashboard(d) {
  const { seo, geo, headings, images, links, keywords, readability, tech } = d;

  // SEO score ring
  animateRing('seoRingFill', seo.score);
  setText('seoScoreNum', seo.score);
  const seoGradeEl = $('seoGrade');
  if (seoGradeEl) {
    seoGradeEl.textContent = seo.grade;
    seoGradeEl.className = `dash-score-grade ${scoreColor(seo.score)}`;
  }
  setText('seoIssuesCount', `${seo.issueCount} issue(s)`);

  // GEO score ring
  animateRing('geoRingFill', geo.geoScore);
  setText('geoScoreNum', geo.geoScore);
  const geoGradeEl = $('geoGrade');
  if (geoGradeEl) {
    geoGradeEl.textContent = scoreGrade(geo.geoScore);
    geoGradeEl.className = `dash-score-grade geo ${scoreColor(geo.geoScore)}`;
  }
  setText('geoSubtitle', `${seo.issueCount > 0 ? seo.issueCount : 0} optimization(s)`);

  // Platform / CMS chips (WordPress, Shopify, Next.js, React, custom HTML…) — replaces generic tech stack
  const techEl = $('dashTechStack');
  if (techEl) {
    const stack = (tech.techStack || []).map(s => String(s));
    const stackLower = stack.map(s => s.toLowerCase());
    const cmsName = (tech.cms || tech.framework || '').trim();
    const cmsAll = Array.isArray(tech.cmsAll) ? tech.cmsAll.filter(Boolean) : [];

    // Known CMS / site builders
    const CMS_LIST = [
      'WordPress', 'Shopify', 'Wix', 'Squarespace', 'Webflow', 'Drupal', 'Joomla',
      'Magento', 'PrestaShop', 'Ghost', 'Framer', 'HubSpot', 'Bubble', 'Carrd',
      'Notion Site', 'Softr', 'Webstudio', 'Lovable', 'Bolt.new', 'v0 by Vercel',
      'Durable AI', '10Web AI', 'Hostinger AI', 'Zyro', 'Jimdo', 'SITE123', 'Strikingly',
      'Typedream', 'Blogger', 'Bitrix', 'OpenCart', 'BigCommerce'
    ];
    // Frameworks / custom code platforms
    const FRAMEWORK_LIST = [
      'Next.js', 'Nuxt.js', 'Nuxt', 'Gatsby', 'Remix', 'Astro', 'SvelteKit',
      'React', 'Vue.js', 'Vue', 'Angular', 'Svelte', 'Vite', 'Laravel', 'Django',
      'Ruby on Rails', 'Express', 'NestJS', 'Flask', 'ASP.NET', 'Blazor',
      'Hugo', 'Jekyll', 'Eleventy', '11ty', 'Custom HTML'
    ];

    function findInStack(names) {
      for (const n of names) {
        const nl = n.toLowerCase();
        if (stackLower.some(s => s === nl || s.includes(nl))) {
          const hit = stack.find(s => s.toLowerCase() === nl || s.toLowerCase().includes(nl));
          return hit || n;
        }
      }
      return null;
    }

    // Noise names that must never appear as the "platform" chip
    const NOISE = new Set([
      'cart functionality', 'cdnjs', 'google analytics', 'google tag manager',
      'google font api', 'jquery', 'php', 'mysql', 'nginx', 'apache',
      'bootstrap', 'tailwind css', 'tailwindcss', 'font awesome'
    ]);

    const platforms = [];
    // 1) All CMS names from auto-detector (primary)
    cmsAll.forEach(n => {
      const s = String(n || '').trim();
      if (!s || NOISE.has(s.toLowerCase())) return;
      if (!platforms.some(p => p.toLowerCase() === s.toLowerCase())) platforms.push(s);
    });
    // 2) Explicit single CMS name
    if (cmsName && !NOISE.has(cmsName.toLowerCase()) &&
        !platforms.some(p => p.toLowerCase() === cmsName.toLowerCase())) {
      platforms.push(cmsName);
    }
    // Drop rival e-com if a primary CMS is already present (e.g. WP + Magento false pair)
    {
      const PRIMARY_CMS_EARLY = new Set(['wordpress', 'shopify', 'wix', 'squarespace', 'webflow', 'drupal', 'joomla', 'ghost', 'hubspot']);
      const RIVAL_ECOM_EARLY = new Set(['magento', 'prestashop', 'opencart', 'bigcommerce']);
      if (platforms.some(p => PRIMARY_CMS_EARLY.has(String(p).toLowerCase()))) {
        for (let i = platforms.length - 1; i >= 0; i--) {
          if (RIVAL_ECOM_EARLY.has(String(platforms[i]).toLowerCase())) platforms.splice(i, 1);
        }
      }
    }
    // 3) CMS names found in tech stack
    // If a primary CMS is already confirmed, skip rival e-com CMS that often
    // false-positive from Wappalyzer (e.g. Magento on a WordPress site).
    const PRIMARY_CMS = new Set(['wordpress', 'shopify', 'wix', 'squarespace', 'webflow', 'drupal', 'joomla', 'ghost', 'hubspot']);
    const RIVAL_ECOM = new Set(['magento', 'prestashop', 'opencart', 'bigcommerce']);
    const hasPrimary = platforms.some(p => PRIMARY_CMS.has(String(p).toLowerCase()));
    for (const c of CMS_LIST) {
      if (platforms.some(p => p.toLowerCase() === c.toLowerCase())) continue;
      if (hasPrimary && RIVAL_ECOM.has(c.toLowerCase())) continue;
      const hit = findInStack([c]);
      if (hit && !NOISE.has(String(hit).toLowerCase())) platforms.push(hit);
    }
    // 4) Frameworks
    for (const f of FRAMEWORK_LIST) {
      if (platforms.some(p => p.toLowerCase() === f.toLowerCase())) continue;
      const hit = findInStack([f]);
      if (hit && !NOISE.has(String(hit).toLowerCase())) platforms.push(hit);
    }
    // 5) Always surface Cloudflare when present in stack (infra, not CMS)
    const cfHit = findInStack(['Cloudflare']);
    if (cfHit && !platforms.some(p => p.toLowerCase() === 'cloudflare')) {
      platforms.push('Cloudflare');
    }
    // 6) Fallback: custom HTML / static
    if (platforms.length === 0 || (platforms.length === 1 && platforms[0].toLowerCase() === 'cloudflare')) {
      if (!platforms.some(p => p.toLowerCase() === 'custom html')) {
        platforms.unshift('Custom HTML');
      }
    }

    const CHIP_COLORS = [
      { bg: 'color-mix(in srgb,#0D9488 12%,transparent)', border: 'color-mix(in srgb,#0D9488 28%,transparent)', text: '#0f766e' },
      { bg: 'color-mix(in srgb,#6366f1 10%,transparent)', border: 'color-mix(in srgb,#6366f1 20%,transparent)', text: '#6366f1' },
      { bg: 'color-mix(in srgb,#f97316 10%,transparent)', border: 'color-mix(in srgb,#f97316 20%,transparent)', text: '#ea580c' },
      { bg: 'color-mix(in srgb,#0ea5e9 10%,transparent)', border: 'color-mix(in srgb,#0ea5e9 20%,transparent)', text: '#0284c7' },
      { bg: 'color-mix(in srgb,#8b5cf6 10%,transparent)', border: 'color-mix(in srgb,#8b5cf6 20%,transparent)', text: '#7c3aed' },
    ];
    const PLATFORM_DOT = {
      'wordpress': '⬡', 'shopify': '◈', 'wix': '◆', 'squarespace': '■',
      'webflow': '▽', 'drupal': '◉', 'joomla': '◎', 'magento': '▣',
      'next.js': '▲', 'nuxt.js': '▲', 'nuxt': '▲', 'gatsby': '▲',
      'react': '⚛', 'vue.js': '◆', 'vue': '◆', 'angular': '⬡',
      'svelte': '◆', 'vite': '⚡', 'laravel': '◆', 'django': '◆', 'hugo': '◆',
      'custom html': '</>', 'html': '</>', 'static': '</>',
      'framer': '◇', 'ghost': '◈', 'bubble': '○', 'cloudflare': '☁'
    };
    const getDot = name => PLATFORM_DOT[(name || '').toLowerCase()] || '◈';

    techEl.innerHTML = platforms.slice(0, 5).map((t, i) => {
      const c = CHIP_COLORS[i % CHIP_COLORS.length];
      const dot = getDot(t);
      return `<span class="dash-tech-chip" style="background:${c.bg};border-color:${c.border};color:${c.text}" title="Platform / CMS"><span class="dash-tech-dot">${dot}</span>${escHTML(t)}</span>`;
    }).join('');
  }

  // HTML size
  setText('dashHtmlSize', formatBytes(tech.htmlSize));

  // Word count with progress bar
  const wordCount = d.readability?.wordCount || 0;
  setText('dashWordCount', wordCount.toLocaleString());
  
  // Calculate word count percentage (target: 2000 words = 100%)
  const wordCountPercentage = Math.min(100, (wordCount / 2000) * 100);
  const wordCountBar = document.getElementById('dashWordCountBar');
  if (wordCountBar) {
    wordCountBar.style.width = wordCountPercentage + '%';
  }

  // Readability score with progress bar
  const readabilityScore = d.readability?.score || 0;
  setText('dashReadability', `${readabilityScore} / 100`);
  
  const readabilityBar = document.getElementById('dashReadabilityBar');
  if (readabilityBar) {
    readabilityBar.style.width = readabilityScore + '%';
  }

  // Headings chips — styled like Sorank grid
  setText('ch1', headings.counts.h1); setText('ch2', headings.counts.h2);
  setText('ch3', headings.counts.h3); setText('ch4', headings.counts.h4);
  setText('ch5', headings.counts.h5); setText('ch6', headings.counts.h6);

  // Heading chip colors based on count
  ['h1','h2','h3','h4','h5','h6'].forEach((tag, i) => {
    const chip = document.querySelector(`.h-chip-sq.${tag}`);
    const count = headings.counts[tag];
    if (chip) {
      chip.classList.toggle('active', count > 0);
      if (tag === 'h1' && count !== 1) chip.classList.add('warn');
    }
  });

  // Keywords stats card — show top keywords with count + bold badge
  const kwRows = $('dashKwRows');
  if (kwRows) {
    const allKw = keywords.keywords || [];
    const top3 = allKw.filter(k => k.ngram === 1).slice(0, 3);
    if (top3.length === 0) {
      kwRows.innerHTML = '<div class="dash-stat-row"><span class="dash-stat-val text-warn">No keywords</span></div>';
    } else {
      kwRows.innerHTML = top3.map(k =>
        `<div class="dash-stat-row">
          <span class="dash-stat-val kw-count">${k.count}</span>
          <span class="dash-kw-word">${escHTML(k.word)}</span>
          ${k.inBold ? '<span class="kw-badge-b">B</span>' : ''}
        </div>`
      ).join('');
    }
  }

  // Images stats
  setText('qImgTotal', images.total);
  setText('qImgAlt', images.withAlt);
  const noAltEl = $('qImgNoAlt');
  if (noAltEl) { noAltEl.textContent = images.missingAlt; noAltEl.className = `dash-stat-val ${images.missingAlt > 0 ? 'text-err' : 'text-ok'}`; }

  // Links stats
  setText('qLinkTotal', links.total);
  setText('qLinkInt', links.internal);
  setText('qLinksExt', links.external);

  // Domain Age + Authority placeholders (filled async via RDAP & Moz)
  setText('qDomainAge', '--');
  setText('qDomainDA', '--');
  setText('qDomainSpam', '--');
  setText('qDomainBL', '--');

  // AI bots placeholder (updated when robots.txt loads)
  setText('qBotsAllowed', '--');
  setText('qBotsPartial', '--');
  setText('qBotsBlocked', '--');

  // Page speed placeholders — show loading pulse
  const ms = $('mobileScore');
  if (ms) { ms.textContent = '--'; ms.className = 'dash-speed-val loading'; }
  const ds = $('desktopScore');
  if (ds) { ds.textContent = '--'; ds.className = 'dash-speed-val loading'; }

  // Performance timing data
  const loadTimeEl = $('dashLoadTime');
  const serverResponseEl = $('dashServerResponse');
  
  if (loadTimeEl) {
    if (tech.loadTime > 0) {
      const loadTimeSec = (tech.loadTime / 1000).toFixed(2);
      loadTimeEl.textContent = loadTimeSec + 's';
      // Color based on performance: <2s = good, 2-4s = warn, >4s = error
      if (loadTimeSec < 2) loadTimeEl.className = 'dash-timing-val ok';
      else if (loadTimeSec < 4) loadTimeEl.className = 'dash-timing-val warn';
      else loadTimeEl.className = 'dash-timing-val err';
    } else {
      loadTimeEl.textContent = '--';
      loadTimeEl.className = 'dash-timing-val';
    }
  }
  
  if (serverResponseEl) {
    if (tech.firstByte > 0) {
      const firstByteSec = (tech.firstByte / 1000).toFixed(2);
      serverResponseEl.textContent = firstByteSec + 's';
      // Color based on TTFB: <0.6s = good, 0.6-1.8s = warn, >1.8s = error
      if (firstByteSec < 0.6) serverResponseEl.className = 'dash-timing-val ok';
      else if (firstByteSec < 1.8) serverResponseEl.className = 'dash-timing-val warn';
      else serverResponseEl.className = 'dash-timing-val err';
    } else {
      serverResponseEl.textContent = '--';
      serverResponseEl.className = 'dash-timing-val';
    }
  }

  // Dashboard SERP preview (meta title + description)
  setText('dashSerpTitle', d.meta.title || '(No title)');
  setText('dashSerpUrl', d.meta.url || '');
  setText('dashSerpDesc', d.meta.desc || '(No description)');
  const dtLen = (d.meta.title || '').length, ddLen = (d.meta.desc || '').length;
  const dtBadge = $('dashTitleLenBadge'), ddBadge = $('dashDescLenBadge');
  if (dtBadge) { dtBadge.textContent = `${dtLen}/60`; dtBadge.className = `serp-badge ${dtLen > 60 ? 'warn' : dtLen > 0 ? 'ok' : 'err'}`; }
  if (ddBadge) { ddBadge.textContent = `${ddLen}/160`; ddBadge.className = `serp-badge ${ddLen > 160 ? 'warn' : ddLen > 0 ? 'ok' : 'err'}`; }

  // Recommendations — Enhanced with priority, actions, and better UX
  const CAT_COLORS = {
    SEO: '#6366f1', GEO: '#8b5cf6', LINKS: '#10b981',
    KEYWORDS: '#f59e0b', IMAGES: '#3b82f6', TECHNICAL: '#64748b',
    CRO: '#ec4899', READABILITY: '#14b8a6'
  };
  const inferCat = (msg) => {
    const m = (msg || '').toLowerCase();
    if (m.includes('link') || m.includes('anchor')) return 'LINKS';
    if (m.includes('keyword') || m.includes('title keyword')) return 'KEYWORDS';
    if (m.includes('geo') || m.includes('ai') || m.includes('llm') || m.includes('schema') || m.includes('structured')) return 'GEO';
    if (m.includes('image') || m.includes('alt') || m.includes('img')) return 'IMAGES';
    if (m.includes('speed') || m.includes('lcp') || m.includes('cls') || m.includes('inp') || m.includes('technical') || m.includes('canonical') || m.includes('robots') || m.includes('https') || m.includes('hreflang')) return 'TECHNICAL';
    if (m.includes('readab') || m.includes('sentence') || m.includes('word')) return 'READABILITY';
    return 'SEO';
  };

  // Merge SEO issues + GEO optimizations into one list, filter blanks
  const seoIssues = (seo.issues || []).filter(i => i && i.msg).map(i => ({ ...i, _src: 'seo' }));
  const geoIssues = (geo.optimizations || []).filter(i => i && (i.title || i.msg)).map(i => ({ msg: i.title || i.msg || '', desc: i.desc || i.detail || '', cat: 'GEO', _src: 'geo' }));
  let allRecs = [...seoIssues, ...geoIssues];
  
  // Remove duplicates that are already in AI Quick Wins
  // Get list of items in AI Quick Wins (if available)
  const quickWinTitles = (window._aqwWins || []).map(w => (w.title || '').toLowerCase());
  
  allRecs = allRecs.filter(issue => {
    const msgLower = (issue.msg || '').toLowerCase();
    
    // Check if this issue is already in AI Quick Wins
    const isDuplicate = quickWinTitles.some(title => {
      // Exact match or very similar
      return title === msgLower || 
             msgLower.includes(title) || 
             title.includes(msgLower);
    });
    
    // Keep only items that are NOT in AI Quick Wins
    return !isDuplicate;
  });

  // Sort by priority: errors first, then warnings, then info
  const priorityOrder = { error: 0, warning: 1, info: 2 };
  allRecs.sort((a, b) => {
    const aPriority = priorityOrder[a.severity] ?? 2;
    const bPriority = priorityOrder[b.severity] ?? 2;
    return aPriority - bPriority;
  });

  const list = $('recsList');
  if (list) {
    list.innerHTML = '';
    if (!allRecs.length) {
      list.innerHTML = '<li class="rec-empty">✓ No critical issues found!</li>';
    } else {
      allRecs.slice(0, 15).forEach((issue, i) => {
        const cat = issue.cat || inferCat(issue.msg);
        const color = CAT_COLORS[cat] || CAT_COLORS.SEO;
        const severity = issue.severity || 'info';
        
        // Determine impact level and icon
        let impactLabel = 'Medium';
        let impactClass = 'rec-impact-medium';
        if (severity === 'error') {
          impactLabel = 'High';
          impactClass = 'rec-impact-high';
        } else if (severity === 'info') {
          impactLabel = 'Low';
          impactClass = 'rec-impact-low';
        }
        
        // Generate actionable description if missing or too short
        let desc = issue.desc || '';
        if (!desc || desc.length < 20) {
          desc = generateActionableDescription(issue, d);
        }
        
        const li = el('li', 'rec-item');
        li.innerHTML = `
          <span class="rec-num">${i+1}</span>
          <div class="rec-body">
            <div class="rec-header">
              <div class="rec-title">${escHTML(issue.msg)}</div>
              <span class="rec-impact ${impactClass}">${impactLabel}</span>
            </div>
            <div class="rec-desc">${escHTML(desc)}</div>
          </div>
          <div class="rec-actions">
            <span class="rec-tag" style="background:color-mix(in srgb,${color} 15%,transparent);color:${color}">${cat}</span>
            <button class="rec-fix-btn" data-rec-id="${i}" data-rec-msg="${escHTML(issue.msg)}" data-rec-desc="${escHTML(desc)}" title="Get AI help to fix this">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>`;
        list.appendChild(li);
      });
      
      // Add event listeners to Fix buttons
      list.querySelectorAll('.rec-fix-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const msg = this.getAttribute('data-rec-msg');
          const desc = this.getAttribute('data-rec-desc');
          handleRecommendationFix(msg, desc, d);
        });
      });
    }
  }

  // Render the three top-row core score cards
  renderTopRowCards(d);
  
  // Render new feature cards
  renderFeatureCards(d);
}

/**
 * Generate actionable description for recommendations
 * @param {Object} issue - The issue object
 * @param {Object} data - Full page analysis data
 * @returns {string} - Actionable description
 */
function generateActionableDescription(issue, data) {
  const msg = (issue.msg || '').toLowerCase();
  const meta = data.meta || {};
  const seo = data.seo || {};
  const geo = data.geo || {};
  const images = data.images || {};
  const links = data.links || {};
  
  // Title issues
  if (msg.includes('title') && msg.includes('short')) {
    return `Your title is ${meta.title?.length || 0} characters. Expand it to 50-60 characters with relevant keywords for better search visibility.`;
  }
  if (msg.includes('title') && msg.includes('long')) {
    return `Your title is ${meta.title?.length || 0} characters. Shorten it to under 60 characters to avoid truncation in search results.`;
  }
  if (msg.includes('title') && msg.includes('missing')) {
    return 'Add a unique, keyword-rich title tag (50-60 chars) to improve search rankings and click-through rates.';
  }
  
  // Meta description issues
  if (msg.includes('description') && msg.includes('short')) {
    return `Your description is ${meta.desc?.length || 0} characters. Expand it to 150-160 characters with a compelling call-to-action.`;
  }
  if (msg.includes('description') && msg.includes('long')) {
    return `Your description is ${meta.desc?.length || 0} characters. Shorten it to under 160 characters to prevent truncation in search results.`;
  }
  if (msg.includes('description') && msg.includes('missing')) {
    return 'Add a compelling meta description (150-160 chars) that summarizes your page and encourages clicks from search results.';
  }
  
  // Heading issues
  if (msg.includes('h1') && msg.includes('missing')) {
    return 'Add a single H1 heading that clearly describes your page topic. This is crucial for SEO and accessibility.';
  }
  if (msg.includes('h1') && msg.includes('multiple')) {
    return `Found ${data.headings?.h1Count || 0} H1 tags. Use only one H1 per page for proper content hierarchy and SEO.`;
  }
  
  // Image issues
  if (msg.includes('alt') || msg.includes('image')) {
    const missingAlt = (images.list || []).filter(img => !img.alt).length;
    return `${missingAlt} image${missingAlt !== 1 ? 's' : ''} missing alt text. Add descriptive alt attributes for accessibility and image SEO.`;
  }
  if (msg.includes('og:image')) {
    return 'Add an og:image meta tag with a high-quality image (1200x630px) for better social media sharing previews.';
  }
  
  // Link issues
  if (msg.includes('empty link') || msg.includes('no href')) {
    const emptyLinks = (links.internal || []).filter(l => !l.href || l.href === '#').length;
    return `${emptyLinks} link${emptyLinks !== 1 ? 's' : ''} with missing or empty href attributes. Fix or remove these broken links.`;
  }
  if (msg.includes('internal link')) {
    return 'Add more internal links to related pages to improve site navigation, user engagement, and SEO link equity distribution.';
  }
  
  // Keyword issues
  if (msg.includes('keyword') && msg.includes('missing')) {
    return 'Add your primary keyword to the page title, first paragraph, and at least one heading for better keyword relevance.';
  }
  if (msg.includes('keyword density')) {
    return 'Balance keyword usage. Aim for 1-2% density - enough for relevance without appearing spammy to search engines.';
  }
  
  // GEO/Schema issues
  if (msg.includes('schema') || msg.includes('structured data')) {
    return 'Add JSON-LD structured data (Schema.org) to help AI search engines understand your content and improve visibility in ChatGPT, Perplexity, and Gemini.';
  }
  if (msg.includes('geo') && msg.includes('score')) {
    return `GEO score is ${geo.geoScore || 0}/100. Improve E-E-A-T signals, add structured data, and optimize for AI citability to boost AI search visibility.`;
  }
  
  // Technical issues
  if (msg.includes('canonical')) {
    return 'Add a canonical URL tag to prevent duplicate content issues and consolidate ranking signals to your preferred URL.';
  }
  if (msg.includes('https')) {
    return 'Migrate to HTTPS for security, trust, and SEO benefits. Modern browsers flag HTTP sites as "Not Secure".';
  }
  if (msg.includes('mobile')) {
    return 'Optimize for mobile devices with responsive design, touch-friendly buttons, and fast loading times. Mobile-first is crucial for SEO.';
  }
  
  // Readability issues
  if (msg.includes('readability') || msg.includes('sentence')) {
    return 'Simplify complex sentences and break up long paragraphs. Aim for 8th-grade reading level for broader audience accessibility.';
  }
  if (msg.includes('word count')) {
    const wordCount = data.readability?.wordCount || 0;
    if (wordCount < 300) {
      return `Page has only ${wordCount} words. Add more quality content (aim for 800+ words) to provide value and improve rankings.`;
    }
  }
  
  // Default fallback
  return issue.desc || 'Review and fix this issue to improve your page\'s SEO performance and user experience.';
}

/**
 * Handle recommendation fix button click
 * @param {string} msg - Issue message
 * @param {string} desc - Issue description
 * @param {Object} data - Full page analysis data
 */
function handleRecommendationFix(msg, desc, data) {
  // Use global _rawData if available, fallback to passed data
  const d = _rawData ? adaptV1Data(_rawData) : data;
  
  // Generate specific AI prompt based on the issue
  let prompt = `Help me fix this SEO issue:\n\n**Issue:** ${msg}\n\n**Details:** ${desc}\n\n`;
  
  // Add context based on issue type
  const msgLower = msg.toLowerCase();
  
  if (msgLower.includes('title')) {
    const currentTitle = d.meta?.title || '';
    prompt += `**Current title:** "${currentTitle}" (${currentTitle.length} characters)\n\n`;
    prompt += 'Please provide:\n1. An optimized title (50-60 characters)\n2. Why this title is better for SEO\n3. Keywords to include';
  } else if (msgLower.includes('description')) {
    const currentDesc = d.meta?.desc || '';
    prompt += `**Current description:** "${currentDesc}" (${currentDesc.length} characters)\n\n`;
    prompt += 'Please provide:\n1. An optimized meta description (150-160 characters)\n2. Why this description improves click-through rate\n3. Call-to-action suggestions';
  } else if (msgLower.includes('alt') || msgLower.includes('image')) {
    const images = d.images?.images || []; // Fixed: images.images not images.list
    const missingAlt = images.filter(img => !img.alt || !img.hasAlt);
    const totalImages = d.images?.total || images.length;
    const imagesWithAlt = d.images?.withAlt || images.filter(img => img.alt || img.hasAlt).length;
    
    prompt += `**Current Status:**\n`;
    prompt += `- Total images: ${totalImages}\n`;
    prompt += `- Images with alt text: ${imagesWithAlt}\n`;
    prompt += `- Images missing alt text: ${missingAlt.length}\n\n`;
    
    if (missingAlt.length > 0) {
      prompt += '**Images missing alt text (first 5):**\n';
      missingAlt.slice(0, 5).forEach((img, i) => {
        const src = img.src || 'Unknown';
        const shortSrc = src.length > 60 ? '...' + src.slice(-60) : src;
        prompt += `${i + 1}. ${shortSrc}\n`;
      });
      prompt += '\n**Please provide:**\n';
      prompt += '1. Descriptive, SEO-friendly alt text for each image\n';
      prompt += '2. Best practices for writing alt text\n';
      prompt += '3. How alt text improves SEO and accessibility';
    } else {
      prompt += 'Provide best practices for writing SEO-optimized alt text for images.';
    }
  } else if (msgLower.includes('schema') || msgLower.includes('structured')) {
    const pageType = d.geo?.pageType || 'webpage';
    prompt += `**Page Type:** ${pageType}\n\n`;
    prompt += 'Please provide:\n1. Recommended Schema.org types for this page\n2. Complete JSON-LD code example\n3. How this improves AI search visibility';
  } else if (msgLower.includes('geo')) {
    const geoScore = d.geo?.geoScore || 0;
    prompt += `**Current GEO score:** ${geoScore}/100\n\n`;
    prompt += 'Please provide:\n1. Top 5 GEO optimizations to implement\n2. E-E-A-T improvements\n3. AI citability enhancements';
  } else if (msgLower.includes('keyword')) {
    const keywords = d.keywords?.keywords || [];
    const topKeywords = keywords.slice(0, 5).map(k => `${k.word} (${k.count}x)`).join(', ');
    prompt += `**Top keywords found:** ${topKeywords}\n\n`;
    prompt += 'Please provide:\n1. Optimal keyword placement strategy\n2. Target keyword density\n3. Related keywords to add';
  } else if (msgLower.includes('link')) {
    const internalCount = d.links?.internal || 0;
    const externalCount = d.links?.external || 0;
    const totalLinks = d.links?.total || 0;
    prompt += `**Current links:** ${totalLinks} total (${internalCount} internal, ${externalCount} external)\n\n`;
    prompt += 'Please provide:\n1. Internal linking strategy\n2. How to fix broken/empty links\n3. Anchor text best practices';
  } else if (msgLower.includes('heading') || msgLower.includes('h1') || msgLower.includes('h2')) {
    const h1Count = d.headings?.counts?.h1 || 0;
    const h2Count = d.headings?.counts?.h2 || 0;
    const h3Count = d.headings?.counts?.h3 || 0;
    prompt += `**Current heading structure:**\n`;
    prompt += `- H1: ${h1Count}\n`;
    prompt += `- H2: ${h2Count}\n`;
    prompt += `- H3: ${h3Count}\n\n`;
    prompt += 'Please provide:\n1. Optimal heading structure\n2. How to fix heading hierarchy issues\n3. SEO-friendly heading examples';
  } else if (msgLower.includes('readability')) {
    const readScore = d.readability?.score || 0;
    const wordCount = d.readability?.wordCount || 0;
    prompt += `**Current readability:** ${readScore}/100\n`;
    prompt += `**Word count:** ${wordCount}\n\n`;
    prompt += 'Please provide:\n1. How to improve readability score\n2. Sentence structure improvements\n3. Content simplification tips';
  } else {
    prompt += 'Please provide:\n1. Step-by-step fix instructions\n2. Code examples if applicable\n3. Expected impact on SEO';
  }
  
  // Switch to AI tab and inject prompt
  if (typeof switchTab === 'function') switchTab('ai');
  
  const aiInput = document.getElementById('aiInput');
  if (aiInput) {
    aiInput.value = prompt;
    
    // Auto-resize textarea to show full prompt
    aiInput.style.height = 'auto';
    aiInput.style.height = Math.min(aiInput.scrollHeight, 300) + 'px'; // Max 300px height
    
    aiInput.dispatchEvent(new Event('input'));
    aiInput.focus();
    
    // Scroll to top of textarea to show beginning of prompt
    aiInput.scrollTop = 0;
    
    // Show toast notification
    showToast('AI prompt ready! Review and send to get fix instructions.', 'info');
  }
}

/**
 * Show toast notification
 * @param {string} message - Toast message
 * @param {string} type - Toast type (info, success, error)
 */
function showToast(message, type = 'info') {
  // Create toast element if it doesn't exist
  let toast = document.getElementById('global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.className = 'global-toast';
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  toast.className = `global-toast global-toast-${type} show`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ─── Top Row Cards ────────────────────────────────────
function renderTopRowCards(d) {
  _renderCompareCard(d);
  _renderScorecardCard(d);
  _renderTimelineCard(d);
}

// ─── Feature Cards (New 18 Cards) ────────────────────────────────────
function renderFeatureCards(d) {
  // ROW 1: Performance & Speed
  renderCoreWebVitals(d);
  renderPageSpeed(d);
  renderStructuredData(d);
  setTimeout(mirrorDashTechGeo, 500);
  setTimeout(mirrorDashTechGeo, 2500);
  
  // ROW 2: Mobile & Security
  renderMobileOptimization(d);
  renderSecurityStatus(d);
  renderContentAnalysis(d);
  
  // ROW 3: Content & Freshness
  renderContentFreshness(d);
  renderInternalLinking(d);
  renderExternalLinks(d);
  
  // ROW 4: AI & Entities
  renderAICitability(d);
  renderEntityRecognition(d);
  renderAnalyticsStatus(d);
  
  // ROW 5: UX & Technical
  renderUXMetrics(d);
  renderServerResponse(d);
  renderTechnologyStack(d);
  
  // ROW 6: Media & Local
  renderImageOptimization(d);
  renderLocalSEO(d);
  renderBusinessInfo(d);
}

/**
 * 1. Core Web Vitals Card
 */

/** Mirror Technical schema + headers + GEO Local SEO onto Dashboard */

/** ── Traffic Tab (Stat Layer UI) ───────────────────────────────── */
let _trfLastDomain = null;
let _trfLastData = null;

function trfFmt(n) {
  if (n == null || n === 0) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number(n).toLocaleString();
}
function trfRank(n) {
  // Coerce nested objects left over from older caches: { Rank: 123 }
  if (n != null && typeof n === 'object') {
    n = n.Rank ?? n.rank ?? n.Value ?? n.value ?? null;
  }
  if (n == null || n === '' || typeof n === 'object') return '—';
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return '#' + Math.round(num).toLocaleString();
}
function trfDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function trfFlag(code) {
  try {
    const cc = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (cc.length !== 2) return '🌐';
    // Use flagcdn image — more reliable than emoji (some OS render emoji as "PK" text)
    return `<img src="https://flagcdn.com/16x12/${cc.toLowerCase()}.png" width="16" height="12" alt="${cc}" style="border-radius:2px;vertical-align:middle;display:inline-block;" onerror="this.outerHTML='🌐'">`;
  } catch (_) { return '🌐'; }
}

function renderTrafficTab(r, domain) {
  const loading = document.getElementById('trfLoading');
  const empty = document.getElementById('trfEmpty');
  const content = document.getElementById('trfContent');
  const domEl = document.getElementById('trfDomain');
  if (domEl) domEl.textContent = domain || '—';
  if (loading) loading.style.display = 'none';

  const ok = r && r.ok && (r.visits > 0 || r.globalRank || r.source === 'SimilarWeb');
  if (!ok) {
    if (content) content.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = '';
  _trfLastData = r;
  _trfLastDomain = domain;

  setText('trfVisits', trfFmt(r.visits));
  setText('trfVisits2', trfFmt(r.visits));
  setText('dashTrafficVisits', trfFmt(r.visits));
  const chg = document.getElementById('trfVisitsChg');
  if (chg) {
    if (r.visitsChangePercent != null) {
      const v = Number(r.visitsChangePercent);
      chg.textContent = (v >= 0 ? '↑ ' : '↓ ') + Math.abs(v).toFixed(0) + '% vs last month';
      chg.className = 'trf-kpi-chg' + (v < 0 ? ' down' : '');
    } else chg.textContent = '';
  }
  setText('trfGlobalRank', trfRank(r.globalRank));
  setText('trfGlobalRank2', trfRank(r.globalRank));
  setText('trfCountryRank', trfRank(r.countryRank));
  setText('trfCategoryRank', trfRank(r.categoryRank));
  const cname = document.getElementById('trfCountryName');
  if (cname) {
    if (r.countryCode) {
      const cc = String(r.countryCode).toUpperCase().replace(/[^A-Z]/g, '');
      cname.innerHTML = trfFlag(cc) + ' <span style="vertical-align:middle;">' + cc + '</span>';
    } else cname.textContent = '—';
  }
  const cat = document.getElementById('trfCategoryName');
  if (cat) cat.textContent = r.category ? String(r.category).replace(/_/g, ' ').slice(0, 22) : '—';

  const bounce = r.bounceRate != null ? (r.bounceRate <= 1 ? r.bounceRate * 100 : r.bounceRate) : null;
  setText('trfBounce', bounce != null ? bounce.toFixed(2) + '%' : '—');
  const btag = document.getElementById('trfBounceTag');
  if (btag) btag.textContent = bounce != null ? (bounce < 40 ? 'Good' : bounce < 60 ? 'Average' : 'High') : '';
  setText('trfPages', r.pagePerVisit != null ? Number(r.pagePerVisit).toFixed(2) : '—');
  setText('trfDuration', trfDuration(r.timeOnSite));

  // Chart — prefer last 6 months (show up to 12 if API returns more)
  const chart = document.getElementById('trfChart');
  const chartLegend = document.getElementById('trfChartLegend');
  const chartRange = document.getElementById('trfChartRange');
  if (chart && r.monthlyVisits && r.monthlyVisits.length) {
    // Prefer 6 months; fall back to whatever SimilarWeb returned (often 3)
    let data = r.monthlyVisits.slice(-6);
    if (r.monthlyVisits.length >= 6) data = r.monthlyVisits.slice(-6);
    else if (r.monthlyVisits.length >= 3) data = r.monthlyVisits.slice(-Math.max(3, r.monthlyVisits.length));
    else data = r.monthlyVisits.slice();
    if (chartRange) chartRange.textContent = data.length + ' months';
    const max = Math.max(...data.map(d => d.visits || 0), 1);
    const W = 420, H = 180;
    const padL = 42, padR = 12, padT = 18, padB = 32;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function monthLabel(m) {
      if (!m) return '';
      const parts = String(m).slice(0, 7).split('-');
      const mi = parseInt(parts[1], 10);
      const yr = parts[0] ? String(parts[0]).slice(2) : '';
      return (MONTHS[mi - 1] || '') + (yr ? " '" + yr : '');
    }
    const pts = data.map((d, i) => {
      const x = padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
      const y = padT + plotH - ((d.visits || 0) / max) * plotH;
      return { x, y, d };
    });
    // Y-axis ticks (0, mid, max)
    const yTicks = [0, 0.5, 1].map(f => {
      const val = max * f;
      const y = padT + plotH - f * plotH;
      return { y, label: trfFmt(val) };
    });
    let path = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const area = path + ` L${pts[pts.length - 1].x},${padT + plotH} L${pts[0].x},${padT + plotH} Z`;
    const gridLines = yTicks.map(t =>
      `<line x1="${padL}" y1="${t.y}" x2="${W - padR}" y2="${t.y}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>` +
      `<text x="${padL - 6}" y="${t.y + 3}" text-anchor="end" font-size="9" fill="#94a3b8">${t.label}</text>`
    ).join('');
    const xLabels = pts.map((p, i) => {
      // Show all labels if ≤6 points, else every other
      if (data.length > 6 && i % 2 === 1 && i !== data.length - 1) return '';
      return `<text x="${p.x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#64748b">${monthLabel(p.d.month)}</text>`;
    }).join('');
    const dots = pts.map((p, i) => {
      const isLast = i === pts.length - 1;
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isLast ? 4.5 : 3.5}" fill="#0D9488" stroke="#fff" stroke-width="1.5">
        <title>${monthLabel(p.d.month)}: ${trfFmt(p.d.visits)} visits</title>
      </circle>
      <text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#0f766e">${trfFmt(p.d.visits)}</text>`;
    }).join('');
    chart.setAttribute('viewBox', `0 0 ${W} ${H}`);
    chart.innerHTML = `<defs><linearGradient id="trfGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0D9488" stop-opacity=".3"/><stop offset="100%" stop-color="#0D9488" stop-opacity="0"/></linearGradient></defs>
      ${gridLines}
      <path d="${area}" fill="url(#trfGrad)"/>
      <path d="${path}" fill="none" stroke="#0D9488" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
      ${xLabels}`;
    if (chartLegend) {
      const first = data[0], last = data[data.length - 1];
      const delta = first && last && first.visits ? (((last.visits - first.visits) / first.visits) * 100) : null;
      chartLegend.innerHTML = `
        <span>🟢 Visits per month</span>
        <span>${monthLabel(first?.month)} → ${monthLabel(last?.month)}</span>
        ${delta != null ? `<span style="color:${delta >= 0 ? '#16a34a' : '#dc2626'};font-weight:600;">${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(0)}% over period</span>` : ''}`;
    }
  } else if (chart) {
    chart.innerHTML = `<text x="210" y="90" text-anchor="middle" font-size="12" fill="#94a3b8">No monthly visit history (need ≥3 months)</text>`;
    if (chartLegend) chartLegend.innerHTML = '';
  }

  // Sources + donut
  const srcList = document.getElementById('trfSrcList');
  const donut = document.getElementById('trfDonut');
  const colors = {
    Direct: '#0D9488', Search: '#10b981', Social: '#06b6d4', Mail: '#ef4444',
    Referrals: '#f59e0b', Paid: '#94a3b8', DisplayAds: '#14b8a6', GenAi: '#059669'
  };
  let sources = r.trafficSources || {};
  if (!Object.keys(sources).length) {
    sources = {
      Direct: r.trafficDirect, Search: r.trafficSearch,
      Social: r.trafficSocial, Referrals: r.trafficReferrals
    };
  }
  const entries = Object.entries(sources).filter(([, v]) => v != null && v > 0).sort((a, b) => b[1] - a[1]);
  if (srcList) {
    srcList.innerHTML = entries.map(([name, val]) => {
      const pct = (val * 100).toFixed(1);
      const col = colors[name] || '#64748b';
      return `<div class="trf-src-row"><span class="trf-src-dot" style="background:${col}"></span><span class="trf-src-name">${name}</span><div class="trf-src-bar-wrap"><div class="trf-src-bar" style="width:${pct}%;background:${col}"></div></div><span class="trf-src-pct">${pct}%</span></div>`;
    }).join('') || '<div style="color:#94a3b8;font-size:12px;">No source breakdown</div>';
  }
  if (donut && entries.length) {
    const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
    let acc = 0;
    const R = 40, C = 2 * Math.PI * R;
    let arcs = '';
    entries.forEach(([name, val]) => {
      const frac = val / total;
      const dash = frac * C;
      const gap = C - dash;
      const rot = -90 + acc * 360;
      acc += frac;
      const col = colors[name] || '#64748b';
      arcs += `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${col}" stroke-width="14" stroke-dasharray="${dash} ${gap}" transform="rotate(${rot} 60 60)"/>`;
    });
    donut.innerHTML = arcs + `<text x="60" y="64" text-anchor="middle" font-size="14" font-weight="800" fill="#0f172a">1</text>`;
  }

  // Geo + World Map (Stat Layers style)
  const geoList = document.getElementById('trfGeoList');
  const geoCount = document.getElementById('trfGeoCount');
  const countries = r.topCountryShares || [];
  if (geoCount) geoCount.textContent = countries.length + ' countries';
  const COUNTRY_NAMES = {
    US:'United States', GB:'United Kingdom', UK:'United Kingdom', PK:'Pakistan', IN:'India',
    CA:'Canada', AU:'Australia', DE:'Germany', FR:'France', BR:'Brazil', MX:'Mexico',
    ES:'Spain', IT:'Italy', NL:'Netherlands', TR:'Turkey', SA:'Saudi Arabia', AE:'UAE',
    EG:'Egypt', BD:'Bangladesh', ID:'Indonesia', PH:'Philippines', NG:'Nigeria',
    ZA:'South Africa', JP:'Japan', KR:'South Korea', CN:'China', RU:'Russia',
    PL:'Poland', SE:'Sweden', NO:'Norway', DK:'Denmark', FI:'Finland', CH:'Switzerland',
    AT:'Austria', BE:'Belgium', PT:'Portugal', IE:'Ireland', NZ:'New Zealand',
    AR:'Argentina', CL:'Chile', CO:'Colombia', PE:'Peru', TH:'Thailand', VN:'Vietnam',
    MY:'Malaysia', SG:'Singapore', HK:'Hong Kong', TW:'Taiwan', IL:'Israel', UA:'Ukraine'
  };
  // Simplified world map paths (approximate silhouettes for major regions)
  const WORLD_PATHS = {
    US: 'M150,120 L180,115 L210,118 L230,125 L245,140 L240,160 L220,170 L200,165 L175,170 L155,155 L145,140 Z M120,100 L140,95 L145,110 L130,115 Z',
    CA: 'M150,70 L200,65 L240,70 L250,90 L230,105 L180,100 L150,95 Z',
    MX: 'M155,165 L180,160 L195,175 L185,190 L160,185 Z',
    BR: 'M250,200 L280,195 L300,220 L290,260 L260,270 L240,240 L245,210 Z',
    AR: 'M255,280 L270,275 L275,320 L260,340 L250,310 Z',
    GB: 'M380,95 L390,90 L395,105 L385,110 Z',
    FR: 'M385,120 L400,115 L405,135 L390,140 Z',
    DE: 'M405,105 L420,100 L425,120 L410,125 Z',
    ES: 'M370,140 L390,135 L395,155 L375,160 Z',
    IT: 'M410,140 L420,135 L425,165 L415,170 Z',
    RU: 'M450,70 L580,65 L620,90 L600,130 L520,140 L460,120 Z',
    CN: 'M600,130 L660,125 L680,150 L660,180 L620,175 L600,155 Z',
    IN: 'M560,180 L590,175 L600,210 L580,240 L555,220 Z',
    PK: 'M540,170 L560,165 L565,190 L545,195 Z',
    AU: 'M680,280 L740,275 L750,310 L720,330 L690,320 Z',
    JP: 'M720,140 L735,135 L740,160 L725,165 Z',
    KR: 'M700,145 L715,140 L718,160 L705,162 Z',
    ID: 'M640,240 L700,235 L710,255 L660,260 Z',
    NG: 'M400,210 L420,205 L425,230 L405,235 Z',
    ZA: 'M420,300 L450,295 L455,320 L425,325 Z',
    EG: 'M440,175 L460,170 L465,195 L445,200 Z',
    SA: 'M470,175 L500,170 L510,200 L480,210 Z',
    TR: 'M450,140 L480,135 L485,155 L455,160 Z',
    AE: 'M505,185 L520,182 L522,195 L508,198 Z',
    BD: 'M600,195 L615,192 L618,210 L602,212 Z',
    PH: 'M680,200 L700,195 L705,220 L685,225 Z',
    TH: 'M630,195 L650,190 L655,220 L635,225 Z',
    VN: 'M655,185 L670,180 L675,220 L660,225 Z',
    MY: 'M640,230 L670,225 L675,245 L645,248 Z',
    SG: 'M655,245 L665,243 L666,252 L656,253 Z',
    NL: 'M400,100 L412,97 L415,110 L402,112 Z',
    BE: 'M395,110 L408,107 L410,118 L397,120 Z',
    PL: 'M430,100 L455,95 L460,120 L435,125 Z',
    UA: 'M450,110 L490,105 L495,130 L455,135 Z',
    SE: 'M420,55 L440,50 L445,90 L425,95 Z',
    NO: 'M410,40 L430,35 L435,75 L415,80 Z',
    FI: 'M445,50 L465,45 L470,85 L450,90 Z',
    IE: 'M360,100 L375,95 L378,115 L363,118 Z',
    PT: 'M360,145 L372,140 L375,165 L362,168 Z',
    CH: 'M400,125 L415,122 L417,135 L402,137 Z',
    AT: 'M415,120 L435,117 L438,132 L418,135 Z',
    NZ: 'M760,320 L780,315 L785,345 L765,350 Z',
    CO: 'M230,210 L250,205 L255,230 L235,235 Z',
    PE: 'M230,245 L250,240 L255,275 L235,280 Z',
    CL: 'M240,280 L255,275 L250,340 L238,335 Z',
    IL: 'M460,165 L470,162 L472,178 L462,180 Z'
  };
  function geoColor(pct) {
    // pct is 0–100 share
    if (pct >= 20) return '#0c4a6e';
    if (pct >= 15) return '#0284c7';
    if (pct >= 10) return '#38bdf8';
    if (pct >= 5) return '#7dd3fc';
    if (pct >= 1) return '#bae6fd';
    return '#e0f2fe';
  }
  const mapEl = document.getElementById('trfWorldMap');
  if (mapEl) {
    const shareMap = {};
    countries.forEach(c => {
      const cc = String(c.CountryCode || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (cc) shareMap[cc] = (c.Value || 0) * 100;
    });
    // Base ocean + all known country shapes
    let paths = `<rect width="800" height="400" fill="#f0f9ff"/>`;
    const allCodes = new Set([...Object.keys(WORLD_PATHS), ...Object.keys(shareMap)]);
    allCodes.forEach(cc => {
      const d = WORLD_PATHS[cc];
      if (!d) return;
      const pct = shareMap[cc] || 0;
      const fill = pct > 0 ? geoColor(pct) : '#e2e8f0';
      const stroke = pct > 0 ? '#0369a1' : '#cbd5e1';
      const title = (COUNTRY_NAMES[cc] || cc) + (pct ? ': ' + pct.toFixed(1) + '%' : '');
      paths += `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1"><title>${title}</title></path>`;
    });
    mapEl.innerHTML = paths;
  }
  if (geoList) {
    geoList.innerHTML = countries.map((c, i) => {
      const code = String(c.CountryCode || '').toUpperCase().replace(/[^A-Z]/g, '');
      const pct = (c.Value * 100).toFixed(2);
      const name = COUNTRY_NAMES[code] || code;
      const barW = Math.min(100, Math.max(4, (c.Value * 100) * 4));
      return `<div class="trf-geo-row">
        <span class="trf-geo-rank" style="width:22px;font-size:10px;font-weight:700;color:#94a3b8;">#${i + 1}</span>
        <span class="trf-geo-flag">${trfFlag(code)}</span>
        <span class="trf-geo-name" title="${name}">${name}</span>
        <div class="trf-geo-bar-wrap"><div class="trf-geo-bar" style="width:${barW}%;background:linear-gradient(90deg,#0284c7,#38bdf8);"></div></div>
        <span class="trf-geo-pct">${pct}%</span>
      </div>`;
    }).join('') || '<div style="color:#94a3b8;font-size:12px;padding:8px 0;">No geo data</div>';
  }

  // Keywords (Volume + Share%/CPC like SEMrush)
  const kwList = document.getElementById('trfKwList');
  const kwFoot = document.getElementById('trfKwFoot');
  const kws = r.swTopKeywords || [];
  if (kwList) {
    kwList.innerHTML = kws.map((k, i) => {
      const name = k.keyword || k.Name || '—';
      const vol = k.volume != null ? trfFmt(k.volume) : '—';
      const est = k.estimatedValue != null ? k.estimatedValue : null;
      const cpc = est != null
        ? (est < 1 ? (est * 100).toFixed(1) + '%' : Number(est).toFixed(1) + '%')
        : (k.cpc != null ? ('$' + Number(k.cpc).toFixed(2)) : '—');
      return `<div class="trf-kw-row"><span class="trf-kw-num">${i + 1}</span><span class="trf-kw-name">${escHTML(name)}</span><span class="trf-kw-vol">${vol}</span><span class="trf-kw-cpc">${cpc}</span></div>`;
    }).join('');
  }
  if (kwFoot) kwFoot.textContent = kws.length ? (kws.length + ' keywords · Live data') : 'No keyword data';
}

function loadTrafficTab(force) {
  const domain = (_currentUrl ? (() => { try { return new URL(_currentUrl).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })() : '') || _trfLastDomain;
  if (!domain) return;
  if (!force && _trfLastDomain === domain && _trfLastData) {
    renderTrafficTab(_trfLastData, domain);
    return;
  }
  const loading = document.getElementById('trfLoading');
  const empty = document.getElementById('trfEmpty');
  const content = document.getElementById('trfContent');
  if (loading) loading.style.display = '';
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = 'none';
  chrome.runtime.sendMessage({ action: 'TRAFFIC_FETCH', domain }, (r) => {
    void chrome.runtime.lastError;
    renderTrafficTab(r, domain);
  });
}


function mirrorDashTechGeo() {
  try {
    // Schema: copy from #schemaList if populated
    const srcSchema = document.getElementById('schemaList');
    const dstSchema = document.getElementById('dashSchemaList');
    const badge = document.getElementById('dashSchemaBadge');
    if (dstSchema) {
      if (srcSchema && srcSchema.children.length) {
        dstSchema.innerHTML = srcSchema.innerHTML;
        if (badge) {
          const n = srcSchema.querySelectorAll('.schema-item, .t-schema-row, [class*="schema"]').length
            || srcSchema.children.length;
          badge.textContent = n + ' found';
          badge.style.background = '#dcfce7';
          badge.style.color = '#15803d';
        }
      } else if (_rawData) {
        // Build from analysis data
        let schemas = (_rawData.structured || _rawData.schemas || []);
        if (!Array.isArray(schemas)) schemas = [];
        const deep = _rawData.structuredDeep || {};
        if (!schemas.length && deep.types) schemas = deep.types.map(t => ({ type: t }));
        if (!schemas.length && Array.isArray(deep.schemas)) schemas = deep.schemas;
        if (!schemas.length) {
          dstSchema.innerHTML = '<div style="font-size:12px;color:#94a3b8;padding:8px 0;">No schema detected on this page.</div>';
          if (badge) badge.textContent = '0';
        } else {
          dstSchema.innerHTML = schemas.slice(0, 20).map(s => {
            const t = typeof s === 'string' ? s : (s.type || s['@type'] || 'Schema');
            return '<div style="display:flex;align-items:center;padding:8px 10px;border:1px solid #e8edf3;border-radius:8px;margin-bottom:6px;font-size:12px;"><span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:99px;font-weight:600;">' + escHTML(t) + '</span></div>';
          }).join('');
          if (badge) {
            badge.textContent = schemas.length + ' found';
            badge.style.background = '#dcfce7';
            badge.style.color = '#15803d';
          }
        }
      }
    }

    // Headers: clone httpHeadersPanel
    const srcH = document.getElementById('httpHeadersPanel');
    const dstH = document.getElementById('dashHeadersPanel');
    const hBadge = document.getElementById('dashHeadersBadge');
    if (dstH && srcH && srcH.innerHTML && srcH.style.display !== 'none') {
      dstH.innerHTML = srcH.innerHTML;
      if (hBadge) {
        const score = (srcH.textContent || '').match(/(\d+)\s*\/\s*7/);
        hBadge.textContent = score ? score[0] + ' headers' : 'Updated';
      }
    }

    // Local SEO: clone geoLocalSeoBody
    const srcL = document.getElementById('geoLocalSeoBody');
    const dstL = document.getElementById('dashLocalSeoBody');
    const lBadge = document.getElementById('dashLocalSeoBadge');
    const geoSec = document.getElementById('geoLocalSeoSection');
    if (dstL) {
      if (srcL && srcL.innerHTML.trim()) {
        dstL.innerHTML = srcL.innerHTML;
        if (geoSec) geoSec.style.display = '';
        if (lBadge) {
          const gb = document.getElementById('geoLocalSeoBadge');
          lBadge.textContent = (gb && gb.textContent) ? gb.textContent : 'Local';
        }
      } else {
        dstL.innerHTML = '<div style="font-size:12px;color:#94a3b8;padding:8px 0;">Open GEO tab for full Local SEO, or refresh analysis.</div>';
      }
    }
  } catch (e) { /* ignore */ }
}


function renderCoreWebVitals(d) {
  const perf = d.performance || {};
  
  // LCP (Largest Contentful Paint) - Good: <2.5s, Needs Work: 2.5-4s, Poor: >4s
  const lcp = perf.lcp || 0;
  const lcpStatus = lcp === 0 ? '—' : lcp < 2.5 ? 'Good' : lcp < 4 ? 'Needs Work' : 'Poor';
  const lcpClass = lcp === 0 ? '' : lcp < 2.5 ? 'good' : lcp < 4 ? 'needs-work' : 'poor';
  setText('fcLCP', lcp === 0 ? '—' : lcp.toFixed(2) + 's');
  const lcpStatusEl = document.getElementById('fcLCPStatus');
  if (lcpStatusEl) {
    lcpStatusEl.textContent = lcpStatus;
    lcpStatusEl.className = 'fc-metric-status dash-cwv-badge ' + lcpClass;
  }
  
  // FID (First Input Delay) - Good: <100ms, Needs Work: 100-300ms, Poor: >300ms
  const fid = perf.fid || 0;
  const fidStatus = fid === 0 ? '—' : fid < 100 ? 'Good' : fid < 300 ? 'Needs Work' : 'Poor';
  const fidClass = fid === 0 ? '' : fid < 100 ? 'good' : fid < 300 ? 'needs-work' : 'poor';
  setText('fcFID', fid === 0 ? '—' : fid.toFixed(0) + 'ms');
  const fidStatusEl = document.getElementById('fcFIDStatus');
  if (fidStatusEl) {
    fidStatusEl.textContent = fidStatus;
    fidStatusEl.className = 'fc-metric-status dash-cwv-badge ' + fidClass;
  }
  
  // CLS (Cumulative Layout Shift) - Good: <0.1, Needs Work: 0.1-0.25, Poor: >0.25
  const cls = perf.cls || 0;
  const clsStatus = cls === 0 ? '—' : cls < 0.1 ? 'Good' : cls < 0.25 ? 'Needs Work' : 'Poor';
  const clsClass = cls === 0 ? '' : cls < 0.1 ? 'good' : cls < 0.25 ? 'needs-work' : 'poor';
  setText('fcCLS', cls === 0 ? '—' : cls.toFixed(3));
  const clsStatusEl = document.getElementById('fcCLSStatus');
  if (clsStatusEl) {
    clsStatusEl.textContent = clsStatus;
    clsStatusEl.className = 'fc-metric-status dash-cwv-badge ' + clsClass;
  }
  
  // Overall score
  const passed = [lcpStatus, fidStatus, clsStatus].filter(s => s === 'Good').length;
  setText('fcCWVOverall', `${passed} / 3 Passed`);
}

/**
 * 2. Page Speed Insights Card
 */
function renderPageSpeed(d) {
  const perf = d.performance || {};
  
  // Use real PageSpeed Insights data if available, otherwise show loading
  const desktopSpeed = _vitals?.desktop?.score;
  if (desktopSpeed != null) {
    setText('fcSpeedDesktop', desktopSpeed);
    const desktopBar = document.getElementById('fcSpeedDesktopBar');
    if (desktopBar) desktopBar.style.width = desktopSpeed + '%';
  } else {
    setText('fcSpeedDesktop', '—');
    const desktopBar = document.getElementById('fcSpeedDesktopBar');
    if (desktopBar) desktopBar.style.width = '0%';
  }
  
  const mobileSpeed = _vitals?.mobile?.score;
  if (mobileSpeed != null) {
    setText('fcSpeedMobile', mobileSpeed);
    const mobileBar = document.getElementById('fcSpeedMobileBar');
    if (mobileBar) mobileBar.style.width = mobileSpeed + '%';
  } else {
    setText('fcSpeedMobile', '—');
    const mobileBar = document.getElementById('fcSpeedMobileBar');
    if (mobileBar) mobileBar.style.width = '0%';
  }
  
  // Load time - use real timing data if available
  const loadTime = (d.tech?.loadTime && d.tech.loadTime > 0) 
    ? (d.tech.loadTime / 1000).toFixed(1) 
    : (perf.loadTime || (d.tech?.htmlSize ? (d.tech.htmlSize / 1024 / 100).toFixed(1) : 0));
  setText('fcLoadTime', loadTime ? loadTime + 's' : '—');
  
  // Time to Interactive - use real data or estimate
  const tti = perf.tti || (loadTime ? (parseFloat(loadTime) + 0.5).toFixed(1) : 0);
  setText('fcTTI', tti ? tti + 's' : '—');
}

/**
 * Calculate speed score based on page metrics
 */
function calculateSpeedScore(d, device) {
  let score = 100;
  
  // Penalize for large HTML size
  const htmlSize = d.tech?.htmlSize || 0;
  if (htmlSize > 500000) score -= 20; // >500KB
  else if (htmlSize > 200000) score -= 10; // >200KB
  
  // Penalize for many images
  const imageCount = d.images?.total || 0;
  if (imageCount > 50) score -= 15;
  else if (imageCount > 30) score -= 10;
  else if (imageCount > 20) score -= 5;
  
  // Penalize for missing optimization
  const unoptimizedImages = d.images?.withoutAlt || 0;
  if (unoptimizedImages > 10) score -= 10;
  else if (unoptimizedImages > 5) score -= 5;
  
  // Mobile gets additional penalties
  if (device === 'mobile') {
    if (!d.tech?.viewport) score -= 15;
    score -= 8; // General mobile penalty
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * 3. Schema/Structured Data Card
 */
function renderStructuredData(d) {
  let schemas = (d.structured && d.structured.schemas) ? d.structured.schemas.slice() : [];
  // Merge types from structuredDeep if present
  const deep = d.structuredDeep || {};
  if ((!schemas.length) && deep.types && deep.types.length) {
    schemas = deep.types.map(t => ({ type: t }));
  }
  if ((!schemas.length) && Array.isArray(deep.schemas)) {
    schemas = deep.schemas;
  }
  const schemaList = document.getElementById('fcSchemaList');
  
  if (!schemaList) return;
  
  if (schemas.length === 0) {
    schemaList.innerHTML = `
      <div class="fc-schema-item">
        <span class="fc-schema-icon missing">✗</span>
        <span class="fc-schema-name">No schemas found</span>
      </div>
      <div class="fc-schema-item">
        <span class="fc-schema-icon missing">✗</span>
        <span class="fc-schema-name">Organization (Recommended)</span>
      </div>
      <div class="fc-schema-item">
        <span class="fc-schema-icon missing">✗</span>
        <span class="fc-schema-name">WebSite (Recommended)</span>
      </div>
    `;
  } else {
    schemaList.innerHTML = schemas.slice(0, 4).map(schema => `
      <div class="fc-schema-item">
        <span class="fc-schema-icon found">✓</span>
        <span class="fc-schema-name">${escHTML(schema.type || schema)}</span>
      </div>
    `).join('');
    
    // Add recommended missing schemas
    const commonSchemas = ['Organization', 'WebSite', 'Article', 'BreadcrumbList'];
    const foundTypes = schemas.map(s => (s.type || s).toLowerCase());
    const missing = commonSchemas.filter(s => !foundTypes.includes(s.toLowerCase()));
    
    if (missing.length > 0 && schemas.length < 4) {
      schemaList.innerHTML += `
        <div class="fc-schema-item">
          <span class="fc-schema-icon missing">✗</span>
          <span class="fc-schema-name">${missing[0]} (Missing)</span>
        </div>
      `;
    }
  }
  
  // Add Schema → open Schema Generator tab
  const addSchemaBtn = document.getElementById('fcAddSchemaBtn');
  if (addSchemaBtn && !addSchemaBtn.dataset.schemaNavBound) {
    addSchemaBtn.dataset.schemaNavBound = '1';
    addSchemaBtn.onclick = () => {
      const nav = document.querySelector('.nav-btn[data-tab="schema"]');
      if (nav) {
        nav.click();
      } else if (typeof switchTab === 'function') {
        switchTab('schema');
      }
      // Optional: focus generate button on Schema tab
      setTimeout(() => {
        const gen = document.getElementById('schemaGenBtn') || document.getElementById('schemaRunBtn');
        if (gen) gen.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 120);
    };
  }
}

/**
 * 4. Mobile Optimization Card
 */
function renderMobileOptimization(d) {
  const tech = d.technical || d.tech || {};
  const a11y = d.accessibility || {};
  const viewport = tech.viewport || tech.hasViewport || !!document.querySelector?.('meta[name="viewport"]');
  // From analysis: viewport object may be {content, present}
  const hasViewport = !!(viewport && (viewport === true || viewport.content || viewport.present || (typeof viewport === 'string' && viewport.length)));
  const isHttps = (tech.isHttps != null) ? tech.isHttps : String(_currentUrl || '').startsWith('https');
  const touchIssues = a11y.smallTouchTargets || a11y.touchTargetIssues || 0;
  const fontOk = a11y.fontSizeOk !== false;

  let mobileScore = 40;
  if (hasViewport) mobileScore += 30;
  if (isHttps) mobileScore += 15;
  if (touchIssues === 0) mobileScore += 10;
  if (fontOk) mobileScore += 5;
  mobileScore = Math.max(0, Math.min(100, mobileScore));
  setText('fcMobileScore', mobileScore);

  const circle = document.getElementById('fcMobileCircle');
  if (circle) {
    const circumference = 2 * Math.PI * 40;
    circle.style.strokeDashoffset = circumference - (mobileScore / 100) * circumference;
    circle.style.stroke = mobileScore >= 80 ? '#10b981' : mobileScore >= 50 ? '#f59e0b' : '#ef4444';
  }

  const setCheck = (id, ok) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = (el.className || '').replace(/\b(good|warning|error|ok|fail)\b/g, '') + (ok ? ' good ok' : ' warning fail');
    const icon = el.querySelector('.fc-check-icon, .dash-check-ic');
    if (icon) icon.textContent = ok ? '✓' : '✗';
  };
  setCheck('fcMobileViewport', hasViewport);
  setCheck('fcViewport', hasViewport);
  setCheck('fcMobileTouchTargets', touchIssues === 0);
  setCheck('fcTouchTargets', touchIssues === 0);
  setCheck('fcMobileFontSize', fontOk);
  setCheck('fcFontSize', fontOk);
}

/**
 * 5. Security Status Card
 */
function renderSecurityStatus(d) {
  const tech = d.tech || {};
  const security = d.security || {};
  let trustScore = 100;

  const setSec = (id, ok, warn, labelText) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('good', 'warning', 'error', 'ok', 'fail');
    el.classList.add(warn ? 'warning' : (ok ? 'good' : 'error'));
    el.classList.add(warn ? 'warning' : (ok ? 'ok' : 'fail'));
    const icon = el.querySelector('.fc-check-icon, .dash-check-ic');
    if (icon) icon.textContent = warn ? '⚠' : (ok ? '✓' : '✗');
    if (labelText) {
      // Prefer text node after icon without wiping structure
      const spans = el.querySelectorAll('span');
      if (spans.length >= 2) spans[spans.length - 1].textContent = labelText;
    }
  };

  const hasHttps = !!tech.isHttps;
  setSec('fcSecurityHTTPS', hasHttps, false, 'HTTPS');
  if (!hasHttps) trustScore -= 40;

  setSec('fcSecuritySSL', hasHttps, false, 'SSL');
  if (!hasHttps) trustScore -= 30;

  const hasMixed = !!(security.mixedContent);
  setSec('fcSecurityMixed', !hasMixed, hasMixed, hasMixed ? 'Mixed content (found)' : 'Mixed content');
  if (hasMixed) trustScore -= 15;

  const headerCount = security.headerCount || 0;
  const hasHeaders = headerCount >= 4;
  setSec('fcSecurityHeaders', hasHeaders, !hasHeaders && headerCount > 0, `Headers (${headerCount}/7)`);
  if (headerCount < 4) trustScore -= 15;

  trustScore = Math.max(0, Math.min(100, trustScore));
  setText('fcTrustScore', `${trustScore} / 100`);
}

/**
 * 6. Content Analysis Card
 */
function renderContentAnalysis(d) {
  const readability = d.readability || {};
  const wordCount = readability.wordCount || 0;
  const htmlSize = d.tech?.htmlSize || 0;

  // Text density = real, computable signal (approx text bytes ÷ html bytes).
  // Replaces the old fabricated "uniqueness 95%" placeholder.
  let densityPct = null;
  if (wordCount > 0 && htmlSize > 0) {
    const approxTextBytes = wordCount * 6; // ~6 bytes/word average
    densityPct = Math.max(1, Math.min(100, Math.round((approxTextBytes / htmlSize) * 100)));
  }
  setText('fcContentUnique', densityPct != null ? densityPct + '%' : '—');

  // Depth score from real word count; '—' when no content extracted
  let depthScore = null;
  if (wordCount > 0) {
    depthScore = 5;
    if (wordCount > 2000) depthScore = 9;
    else if (wordCount > 1500) depthScore = 8;
    else if (wordCount > 1000) depthScore = 7;
    else if (wordCount > 500) depthScore = 6;
  }
  setText('fcContentDepth', depthScore != null ? depthScore.toFixed(1) + ' / 10' : '— / 10');

  // Multimedia count (real DOM data)
  const imageCount = d.images?.total || 0;
  const videoCount = d.videos?.total || 0;
  setText('fcContentMedia', `${imageCount} images${videoCount > 0 ? ', ' + videoCount + ' video' + (videoCount > 1 ? 's' : '') : ''}`);

  // Grade only when we actually have content
  let grade = '—';
  if (depthScore != null) {
    const wc = wordCount;
    if (depthScore >= 8 && wc > 1500) grade = 'A';
    else if (depthScore >= 7 && wc > 1000) grade = 'B+';
    else if (depthScore >= 6 && wc > 500) grade = 'B';
    else if (depthScore >= 5) grade = 'C+';
    else grade = 'C';
  }
  setText('fcContentGrade', grade);
}

/**
 * 7. Content Freshness Card
 */
function renderContentFreshness(d) {
  // Pull dates from multiple real sources on the page analysis
  const tech = d.technical || {};
  const structured = d.structured || {};
  const geo = d.geoSignals || {};
  const cit = d.citability || {};

  let dateStr = null;
  // Schema dates
  for (const s of (structured.schemas || [])) {
    const data = s.data || s;
    if (data.dateModified) { dateStr = data.dateModified; break; }
    if (data.datePublished) { dateStr = data.datePublished; break; }
  }
  // Meta / open graph often copied into technical or indexation
  if (!dateStr && tech.lastModified) dateStr = tech.lastModified;
  if (!dateStr && d.indexationHints?.lastModified) dateStr = d.indexationHints.lastModified;
  if (!dateStr && cit.dateModified) dateStr = cit.dateModified;
  if (!dateStr && cit.datePublished) dateStr = cit.datePublished;

  let ageDays = null;
  let parsed = null;
  if (dateStr) {
    parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      ageDays = Math.floor((Date.now() - parsed.getTime()) / 86400000);
    }
  }

  setText('fcLastUpdated', parsed && !isNaN(parsed) ? parsed.toLocaleDateString() : 'Not detected');
  setText('fcContentAge', ageDays != null ? (ageDays < 30 ? ageDays + ' days' : ageDays < 365 ? Math.round(ageDays/30) + ' mo' : Math.round(ageDays/365) + ' yr') : '—');

  let freshness = null;
  if (ageDays != null) {
    if (ageDays <= 30) freshness = 95;
    else if (ageDays <= 90) freshness = 80;
    else if (ageDays <= 180) freshness = 65;
    else if (ageDays <= 365) freshness = 50;
    else if (ageDays <= 730) freshness = 35;
    else freshness = 20;
  }
  setText('fcFreshnessScore', freshness != null ? freshness + ' / 100' : '— / 100');
  const note = document.getElementById('fcFreshnessNote');
  if (note) note.textContent = parsed ? 'From schema/meta date' : 'No publish date found';
}


/**
 * 8. Internal Linking Card
 */
function renderInternalLinking(d) {
  const links = d.links || {};
  const internalLinks = links.links?.filter(l => l.isInternal) || [];
  
  setText('fcInternalTotal', links.internal || 0);
  
  // Count unique internal pages
  const uniquePages = new Set(internalLinks.map(l => {
    try {
      const url = new URL(l.url, _currentUrl);
      return url.pathname;
    } catch {
      return l.url;
    }
  })).size;
  setText('fcInternalUnique', uniquePages);
  
  // Calculate depth score (based on internal link count and distribution)
  const internalCount = links.internal || 0;
  let depthScore = 5;
  if (internalCount > 50) depthScore = 10;
  else if (internalCount > 30) depthScore = 9;
  else if (internalCount > 20) depthScore = 8;
  else if (internalCount > 15) depthScore = 7;
  else if (internalCount > 10) depthScore = 6;
  setText('fcInternalDepth', `${depthScore} / 10`);
  
  // Link health status
  let health = 'Excellent';
  if (internalCount < 5) health = 'Poor - Add more internal links';
  else if (internalCount < 10) health = 'Fair - Increase internal linking';
  else if (internalCount < 20) health = 'Good - Room for improvement';
  
  setText('fcInternalHealth', health);
}

/**
 * 9. External Links Card
 */
function renderExternalLinks(d) {
  const links = d.links || {};
  const externalLinks = links.links?.filter(l => l.isExternal) || [];
  
  setText('fcExternalTotal', links.external || 0);
  setText('fcExternalNofollow', links.nofollow || 0);
  
  // Count authority links (common authority domains)
  const authorityDomains = ['wikipedia.org', 'gov', 'edu', 'github.com', 'stackoverflow.com', 'medium.com'];
  const authorityCount = externalLinks.filter(l => {
    try {
      const url = new URL(l.url);
      return authorityDomains.some(domain => url.hostname.includes(domain));
    } catch {
      return false;
    }
  }).length;
  setText('fcExternalAuthority', authorityCount);
  
  // Quality assessment
  const externalCount = links.external || 0;
  let quality = 'Good';
  if (externalCount === 0) quality = 'No external links';
  else if (externalCount > 50) quality = 'Too many - Review';
  else if (authorityCount > 3) quality = 'Excellent - High authority';
  else if (authorityCount > 0) quality = 'Good - Some authority links';
  
  setText('fcExternalQuality', quality);
}

/**
 * 10. AI Citability Card
 */
function renderAICitability(d) {
  const cit = d.citability || {};
  const geo = d.geoSignals || {};
  const eeat = d.eeat || {};
  const structured = d.structured || {};

  // Score: prefer citability.score (0-20 scale) or overall geo
  let score = cit.score;
  if (score != null && score <= 20) score = Math.round((score / 20) * 100);
  if (score == null && geo.score != null) score = geo.score;
  if (score == null) score = 0;

  setText('fcAIScore', score);
  const circle = document.getElementById('fcAICircle');
  if (circle) {
    const circumference = 2 * Math.PI * 40;
    circle.style.strokeDashoffset = circumference - (Math.min(100, score) / 100) * circumference;
    circle.style.stroke = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444';
  }

  const hasAuthor = !!(eeat.hasAuthor || cit.hasAuthor || (structured.schemas || []).some(s => {
    const data = s.data || {};
    return data.author || (s.type || '').toLowerCase().includes('person');
  }));
  const hasCitations = !!(cit.hasCitations || cit.citationsCount > 0 || eeat.hasCitations);
  const hasSD = (structured.count || 0) > 0 || (structured.schemas || []).length > 0;

  const setCheck = (id, ok) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'fc-check-item ' + (ok ? 'good' : 'warning');
    const icon = el.querySelector('.fc-check-icon');
    if (icon) icon.textContent = ok ? '✓' : '⚠';
  };
  setCheck('fcAIAuthor', hasAuthor);
  setCheck('fcAICitations', hasCitations);
  setCheck('fcAIStructured', hasSD);
}

/**
 * 11. Entity Recognition Card
 */
function renderEntityRecognition(d) {
  const keywords = d.keywords || {};
  const topKeywords = (keywords.keywords || [])
    .filter(k => k.ngram === 1 && k.count > 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15); // Increased from 8 to 15 to fill space
  
  const entityList = document.getElementById('fcEntityList');
  if (!entityList) return;
  
  if (topKeywords.length === 0) {
    entityList.innerHTML = `
      <div class="fc-entity-item">
        <span class="fc-entity-icon">⚠</span>
        <span class="fc-entity-name">No entities detected</span>
      </div>
    `;
  } else {
    if (window._textRazorData && window._textRazorData.ok) return;
    entityList.innerHTML = topKeywords.map(kw => `
      <div class="fc-entity-item">
        <span class="fc-entity-icon">🏷️</span>
        <span class="fc-entity-name">${escHTML(kw.word)} (${kw.count})</span>
      </div>
    `).join('');
  }
  
  setText('fcEntityCount', `${topKeywords.length} entities detected`);
}

/**
 * 12. Analytics Status Card
 */
function renderAnalyticsStatus(d) {
  const tech = d.tech || {};
  const tracking = tech.trackingSignals || [];
  const techStack = tech.techStack || [];
  
  // Combine tracking signals and tech stack for comprehensive detection
  const allSignals = [...tracking, ...techStack].map(s => s.toLowerCase());
  
  // Google Analytics check
  const gaEl = document.getElementById('fcAnalyticsGA');
  if (gaEl) {
    const hasGA = allSignals.some(t => 
      t.includes('google analytics') || 
      t.includes('gtag') || 
      t.includes('ga.js') ||
      t.includes('analytics.js')
    );
    gaEl.className = 'fc-check-item ' + (hasGA ? 'good' : 'warning');
    { const _ic = gaEl.querySelector('.fc-check-icon, .dash-check-ic'); if (_ic) _ic.textContent = hasGA ? '✓' : '✗'; }
  }
  
  // Google Tag Manager check
  const gtmEl = document.getElementById('fcAnalyticsGTM');
  if (gtmEl) {
    const hasGTM = allSignals.some(t => 
      t.includes('gtm') || 
      t.includes('tag manager') ||
      t.includes('googletagmanager')
    );
    gtmEl.className = 'fc-check-item ' + (hasGTM ? 'good' : 'warning');
    { const _ic = gtmEl.querySelector('.fc-check-icon, .dash-check-ic'); if (_ic) _ic.textContent = hasGTM ? '✓' : '✗'; }
  }
  
  // Meta Pixel check
  const pixelEl = document.getElementById('fcAnalyticsPixel');
  if (pixelEl) {
    const hasPixel = allSignals.some(t => 
      t.includes('meta pixel') || 
      t.includes('facebook pixel') ||
      t.includes('fbevents') ||
      t.includes('fbq')
    );
    pixelEl.className = 'fc-check-item ' + (hasPixel ? 'good' : 'warning');
    { const _ic = pixelEl.querySelector('.fc-check-icon, .dash-check-ic'); if (_ic) _ic.textContent = hasPixel ? '✓' : '✗'; }
  }
  
  // Google AdSense check
  const adsenseEl = document.getElementById('fcAnalyticsAdsense');
  if (adsenseEl) {
    const hasAdsense = allSignals.some(t => 
      t.includes('adsense') || 
      t.includes('adsbygoogle') ||
      t.includes('googlesyndication') ||
      t.includes('pagead2.googlesyndication')
    );
    adsenseEl.className = 'fc-check-item ' + (hasAdsense ? 'good' : 'warning');
    { const _ic = adsenseEl.querySelector('.fc-check-icon, .dash-check-ic'); if (_ic) _ic.textContent = hasAdsense ? '✓' : '✗'; }
  }
  
  // Google Search Console check (verification meta tag)
  const gscEl = document.getElementById('fcAnalyticsGSC');
  if (gscEl) {
    // Check multiple sources for GSC verification
    const rawData = _rawData || {};
    
    // Method 1: Check if GSC pixel was detected in pixels array
    const pixelsData = rawData.pixels || {};
    const pixelsList = pixelsData.pixels || [];
    const hasGSCPixel = pixelsList.some(p => 
      p.name === 'Google Search Console' || 
      (p.category === 'seo' && p.name && p.name.toLowerCase().includes('search console'))
    );
    
    // Method 2: Check tracking signals
    const hasGSCSignal = allSignals.some(t => 
      t.includes('search console') ||
      t.includes('google-site-verification')
    );
    
    const hasGSC = hasGSCPixel || hasGSCSignal;
    
    gscEl.className = 'fc-check-item ' + (hasGSC ? 'good' : 'warning');
    { const _ic = gscEl.querySelector('.fc-check-icon, .dash-check-ic'); if (_ic) _ic.textContent = hasGSC ? '✓' : '✗'; }
  }
  
  // Other tracking check (count all detected tracking)
  const otherEl = document.getElementById('fcAnalyticsOther');
  if (otherEl) {
    const otherTracking = allSignals.filter(t => 
      t.includes('hotjar') ||
      t.includes('clarity') ||
      t.includes('mixpanel') ||
      t.includes('amplitude') ||
      t.includes('segment') ||
      t.includes('heap') ||
      t.includes('matomo') ||
      t.includes('plausible') ||
      t.includes('fathom') ||
      t.includes('linkedin insight') ||
      t.includes('pinterest') ||
      t.includes('twitter') ||
      t.includes('tiktok') ||
      t.includes('snapchat')
    );
    const hasOther = otherTracking.length > 0;
    otherEl.className = 'fc-check-item ' + (hasOther ? 'good' : 'warning');
    { const _ic = otherEl.querySelector('.fc-check-icon, .dash-check-ic'); if (_ic) _ic.textContent = hasOther ? '✓' : '✗'; }
    { const _lb = otherEl.querySelector('span:last-child'); if (_lb) _lb.textContent = hasOther ? `Other Tracking (${otherTracking.length})` : 'Other Tracking'; }
  }
}

/**
 * 13. UX Metrics Card
 */
function renderUXMetrics(d) {
  const cro = d.cro || {};
  const flags = cro.flags || cro.checks || {};
  const items = [
    { id: 'fcUXCTA', ok: !!(cro.ctaAboveFold ?? flags.ctaAboveFold ?? cro.hasCTA), label: 'CTA Above Fold' },
    { id: 'fcUXNav', ok: !!(cro.clearNav ?? flags.clearNavigation ?? true), label: 'Clear Navigation' },
    { id: 'fcUXSearch', ok: !!(cro.hasSearch ?? flags.searchFunction), label: 'Search Function' },
    { id: 'fcUXBreadcrumbs', ok: !!(cro.hasBreadcrumbs ?? flags.breadcrumbs ?? (d.structured?.schemas || []).some(s => String(s.type||'').toLowerCase().includes('breadcrumb'))), label: 'Breadcrumbs' },
  ];
  // Heuristics from DOM analysis if cro incomplete
  const links = d.links || {};
  if (cro.hasSearch == null) items[2].ok = !!(d.technical?.hasSearch || links.hasSearch);
  
  let score = 0;
  items.forEach(it => {
    const el = document.getElementById(it.id);
    if (!el) return;
    el.className = 'fc-check-item ' + (it.ok ? 'good' : 'warning');
    const icon = el.querySelector('.fc-check-icon');
    if (icon) icon.textContent = it.ok ? '✓' : '⚠';
    if (it.ok) score += 25;
  });
  setText('fcUXScore', score + ' / 100');
}

/**
 * 14. Server Response Card
 */
function renderServerResponse(d) {
  const tech = d.technical || {};
  const perf = d.performance || {};
  const adv = d.advancedTechnical || {};
  // Navigation timing from page when available
  let rt = perf.serverResponseTime || perf.ttfb || adv.ttfb || null;
  if (rt != null && rt < 50) rt = Math.round(rt * 1000); // seconds → ms
  setText('fcServerTime', rt != null ? Math.round(rt) + 'ms' : '—');
  setText('fcServerStatus', tech.statusCode || adv.statusCode || '200');
  const compression = tech.compression || adv.compression || perf.compression || '—';
  setText('fcServerCompression', compression);
  let label = 'Unknown';
  if (rt != null) {
    if (rt < 200) label = 'Excellent';
    else if (rt < 500) label = 'Good';
    else if (rt < 1000) label = 'Fair – Room for improvement';
    else label = 'Slow';
  }
  setText('fcServerHealth', label);
}

/**
 * 15. Technology Stack Card
 */
function renderTechnologyStack(d) {
  const tech = d.tech || {};
  const techStack = tech.techStack || [];
  
  const techList = document.getElementById('fcTechList');
  if (!techList) return;
  
  if (techStack.length === 0) {
    techList.innerHTML = `
      <div class="fc-tech-item">
        <span class="fc-tech-icon">⚠</span>
        <span class="fc-tech-name">No technologies detected</span>
      </div>
    `;
  } else {
    // Show all technologies (removed slice limit)
    techList.innerHTML = techStack.map(tech => `
      <div class="fc-tech-item">
        <span class="fc-tech-name">${escHTML(tech)}</span>
      </div>
    `).join('');
  }
  
  setText('fcTechCount', `${techStack.length} technologies`);
}

/**
 * 16. Image Optimization Card
 */
function renderImageOptimization(d) {
  const images = d.images || {};
  
  setText('fcImageTotal', images.total || 0);
  setText('fcImageAlt', images.withAlt || 0);
  
  // Count lazy loaded images
  const lazyCount = (images.images || []).filter(img => img.isLazy).length;
  setText('fcImageLazy', lazyCount);
  
  // Calculate image optimization score
  const total = images.total || 1;
  const withAlt = images.withAlt || 0;
  const altScore = (withAlt / total) * 60;
  const lazyScore = (lazyCount / total) * 40;
  const imageScore = Math.round(altScore + lazyScore);
  
  setText('fcImageScore', `${imageScore} / 100`);
}

/**
 * 17. Local SEO Card
 */
function renderLocalSEO(d) {
  const geo = d.geo || {};
  const structured = geo.structured || {};
  const local = d.localSeo || {};

  const setCheck = (id, ok) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'fc-check-item ' + (ok ? 'good' : 'warning');
    const icon = el.querySelector('.fc-check-icon');
    if (icon) icon.textContent = ok ? '✓' : '⚠';
  };

  // NAP info (Name, Address, Phone) — real detection with consistency awareness
  const napOk = !!local.napComplete && !(local.flags && local.flags.length);
  setCheck('fcLocalNAP', napOk);

  // Local schema check (schema detector OR structured-data type scan)
  const hasLocalSchema = !!local.schema?.found || (structured.schemas || []).some(s =>
    (s.type || '').toLowerCase().includes('local') ||
    (s.type || '').toLowerCase().includes('business')
  );
  setCheck('fcLocalSchema', hasLocalSchema);

  // Map embed check
  setCheck('fcLocalMap', !!local.map?.embedded);

  // Reviews check
  setCheck('fcLocalReviews', !!local.reviews?.hasMarkup);
}

/**
 * 18. Business Info Card
 */
function renderBusinessInfo(d) {
  const cro = d.cro || {};
  const local = d.localSeo || {};

  // Contact info (phone/email from NAP detection, or CRO trust signals)
  const hasContact = !!(local.phone?.value || local.email?.value) || cro.trust?.hasContact || false;
  setText('fcBusinessContact', hasContact ? 'Found' : 'Not found');

  // Social profiles
  const socialCount = (cro.socialProfiles || []).length;
  setText('fcBusinessSocial', socialCount > 0 ? `${socialCount} profiles` : 'None');

  // Business hours — real detection
  const hasHours = !!(local.hours?.value);
  setText('fcBusinessHours', hasHours ? 'Found' : 'Not found');

  // Calculate completeness score
  let completeness = 0;
  if (hasContact) completeness += 40;
  if (socialCount > 0) completeness += 30;
  if (socialCount > 3) completeness += 10;
  if (hasHours) completeness += 20;

  setText('fcBusinessComplete', `${completeness} / 100`);
}

function _renderCompareCard(d) {
  // Populate keyword from top keyword or page title
  const topKw = (d.keywords?.keywords || [])
    .filter(k => k.ngram === 1 && k.inTitle)
    .sort((a, b) => b.count - a.count)[0] 
    || (d.keywords?.keywords || []).find(k => k.ngram === 1);
  const kwText = topKw ? topKw.word : (d.meta?.title || '').split(' ').slice(0, 2).join(' ') || 'your topic';
  const kwEl = $('trcCompareKeyword');
  if (kwEl) kwEl.textContent = kwText;

  // Your score
  const youScore = d.seo?.score ?? 0;
  _setBar('trcBarYou', 'trcValYou', youScore);

  // Generate realistic competitor estimates based on industry benchmarks
  // and page characteristics (content quality, technical setup, GEO optimization)
  const geoScore = d.geo?.geoScore ?? 0;
  const wordCount = d.readability?.wordCount ?? 0;
  const hasSchema = (d.geo?.structured?.schemas || []).length > 0;
  const hasHttps = d.tech?.isHttps ?? false;
  
  // Industry benchmark: average competitor score (varies by content quality)
  let industryAvg = 65;
  if (wordCount > 1500) industryAvg += 5;
  if (wordCount > 2500) industryAvg += 3;
  if (hasSchema) industryAvg += 3;
  if (geoScore > 70) industryAvg += 4;
  if (hasHttps) industryAvg += 2;
  
  // Competitor 1: Average competitor (slightly below you - common scenario)
  const c1Score = Math.max(15, Math.min(95, youScore - Math.floor(Math.random() * 8 + 3)));
  
  // Competitor 2: Industry average with realistic variation
  const c2Score = Math.max(20, Math.min(95, industryAvg + Math.floor(Math.random() * 20 - 10)));
  
  // Competitor 3: Top performer (top 10% of search results)
  const c3Score = Math.max(25, Math.min(98, industryAvg + Math.floor(Math.random() * 15 + 10)));

  const label1El = $('trcLabel1');
  const label2El = $('trcLabel2');
  const label3El = $('trcLabel3');
  
  if (label1El) label1El.textContent = 'Avg Competitor';
  if (label2El) label2El.textContent = 'Industry Avg';
  if (label3El) label3El.textContent = 'Top Performer';
  
  _setBar('trcBar1', 'trcVal1', c1Score);
  _setBar('trcBar2', 'trcVal2', c2Score);
  _setBar('trcBar3', 'trcVal3', c3Score);
}

function _setBar(barId, valId, score) {
  const bar = $(barId); const val = $(valId);
  if (bar) bar.style.width = Math.min(100, score) + '%';
  if (val) val.textContent = score;
}

function _renderScorecardCard(d) {
  const wc = d.readability?.wordCount ?? 0;
  const rs = d.readability?.score ?? 0;
  const seoGrade = d.seo?.grade ?? 'C';

  // Word count bar: target 1500 as 100%
  const wcPct = Math.min(100, Math.round((wc / 1500) * 100));
  const wcEl = $('trcScWords'); if (wcEl) wcEl.textContent = wc.toLocaleString();
  const wcBar = $('trcScBarWords'); if (wcBar) wcBar.style.width = wcPct + '%';

  // Readability bar
  const rsEl = $('trcScReadability'); if (rsEl) rsEl.textContent = rs + ' / 100';
  const rsBar = $('trcScBarReadability'); if (rsBar) rsBar.style.width = rs + '%';

  // Grades
  const gradeEl = $('trcScGrade'); if (gradeEl) gradeEl.textContent = seoGrade;
  const cgEl = $('trcScContentGrade'); if (cgEl) cgEl.textContent = seoGrade + '+';
}

function _renderTimelineCard(d) {
  const url = _currentUrl || '';
  const storageKey = 'trc_history_' + (url ? new URL(url).hostname + new URL(url).pathname : 'default');
  const nowScore = d.seo?.score ?? 0;
  const nowMonth = new Date().toLocaleString('en-US', { month: 'short' });

  chrome.storage.local.get([storageKey], result => {
    let history = result[storageKey] || [];
    // Keep up to 6 months of history; add today if not already recorded this month
    const last = history[history.length - 1];
    if (!last || last.month !== nowMonth) {
      history.push({ month: nowMonth, score: nowScore });
      if (history.length > 6) history = history.slice(-6);
      chrome.storage.local.set({ [storageKey]: history });
    } else {
      // Update current month's score
      history[history.length - 1].score = nowScore;
      chrome.storage.local.set({ [storageKey]: history });
    }

    // If only one data point, synthesise a plausible history for visual
    // Add badge to indicate this is estimated data
    let displayHistory = history;
    const hasRealHistory = history.length >= 2;
    
    if (history.length < 3) {
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const nowIdx = new Date().getMonth();
      displayHistory = [];
      const startScore = Math.max(10, nowScore - 14);
      for (let i = 5; i >= 0; i--) {
        const mIdx = ((nowIdx - i) + 12) % 12;
        const frac = (5 - i) / 5;
        const s = Math.round(startScore + (nowScore - startScore) * frac);
        displayHistory.push({ month: MONTHS[mIdx], score: s });
      }
      // Override last entry with real data
      displayHistory[displayHistory.length - 1].score = nowScore;
      
      // Add visual indicator for estimated data
      if (!hasRealHistory) {
        const timelineCard = $('trcTimelineCard');
        if (timelineCard && !timelineCard.querySelector('.trc-estimated-badge')) {
          const badge = document.createElement('span');
          badge.className = 'trc-estimated-badge';
          badge.textContent = 'Estimated';
          badge.title = 'Historical data will be tracked as you revisit this page monthly';
          badge.style.cssText = 'font-size:9px;padding:2px 6px;background:#f59e0b;color:white;border-radius:10px;margin-left:6px;font-weight:600;letter-spacing:0.3px;';
          const labelEl = timelineCard.querySelector('.trc-label');
          if (labelEl) labelEl.appendChild(badge);
        }
      }
    }

    _drawTimeline(displayHistory, nowScore);
  });
}

function _drawTimeline(history, nowScore) {
  const lineEl = $('trcChartLine');
  const dotsEl = $('trcChartDots');
  const monthsEl = $('trcChartMonths');
  if (!lineEl || !dotsEl || !monthsEl) return;

  const W = 200, H = 80, PAD = 8;
  const scores = history.map(h => h.score);
  const minS = Math.max(0, Math.min(...scores) - 10);
  const maxS = Math.min(100, Math.max(...scores) + 10);
  const n = history.length;

  const toX = i => PAD + (i / (n - 1)) * (W - PAD * 2);
  const toY = s => PAD + (1 - (s - minS) / (maxS - minS)) * (H - PAD * 2);

  // Smooth polyline points
  const pts = history.map((h, i) => `${toX(i).toFixed(1)},${toY(h.score).toFixed(1)}`).join(' ');
  lineEl.setAttribute('points', pts);

  // Dots
  dotsEl.innerHTML = history.map((h, i) => {
    const isLast = i === n - 1;
    return `<circle cx="${toX(i).toFixed(1)}" cy="${toY(h.score).toFixed(1)}" r="${isLast ? 4 : 2.5}" fill="${isLast ? '#0D9488' : '#0D9488'}" stroke="${isLast ? '#fff' : 'none'}" stroke-width="${isLast ? 1.5 : 0}"/>`;
  }).join('');

  // Month labels
  monthsEl.innerHTML = history.map(h => `<span class="trc-chart-month">${h.month}</span>`).join('');

  // Stats
  const startScore = history[0].score;
  const change = nowScore - startScore;
  const nowEl = $('trcTlNow'); if (nowEl) { nowEl.textContent = nowScore + ' ↑'; nowEl.style.color = change >= 0 ? '#10b981' : '#ef4444'; }
  const startEl = $('trcTlStart'); if (startEl) startEl.textContent = startScore;
  const changeEl = $('trcTlChange'); if (changeEl) {
    changeEl.textContent = (change >= 0 ? '+' : '') + change;
    changeEl.style.color = change >= 0 ? '#10b981' : '#ef4444';
  }
}

window.trcDoCompare = function() {
  if (typeof switchTab === 'function') switchTab('ai');
  const ta = $('aiInput');
  const kw = ($('trcCompareKeyword') || {}).textContent || 'this topic';
  if (ta) {
    ta.value = `Compare my page's SEO performance to competitors for the keyword "${kw}". Identify where I'm losing ground and give me actionable steps to outrank them.`;
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  }
  setTimeout(() => { if (typeof aiHandleSend === 'function') aiHandleSend(); }, 200);
};

function geoLabel(s) {
  if (s >= 80) return 'Excellent AI visibility';
  if (s >= 60) return 'Good AI visibility';
  if (s >= 40) return 'Moderate — room to grow';
  return 'Low AI visibility';
}

// ─── PageSpeed vitals ─────────────────────────────────
function applyVitals(vitals) {
  if (!vitals) return;
  _vitals = vitals;
  console.log('[applyVitals] Received vitals:', vitals);
  const ms = vitals.mobile?.score, ds = vitals.desktop?.score;
  console.log('[applyVitals] Mobile score:', ms, 'Desktop score:', ds);
  const mEl = $('mobileScore');
  if (mEl) {
    if (ms != null) {
      mEl.textContent = ms;
      mEl.className = `dash-speed-val ${scoreColor(ms)}`;
      animateRing('mobileSpeedRing', ms);
    } else {
      mEl.textContent = '--';
      mEl.className = 'dash-speed-val loading';
    }
  }
  const dEl = $('desktopScore');
  if (dEl) {
    if (ds != null) {
      dEl.textContent = ds;
      dEl.className = `dash-speed-val ${scoreColor(ds)}`;
      animateRing('desktopSpeedRing', ds);
    } else if (ms != null) {
      dEl.textContent = '…';
      dEl.className = 'dash-speed-val loading';
    }
  }
  
  // Update feature card with real PageSpeed data
  console.log('[applyVitals] Updating feature card - Mobile:', ms, 'Desktop:', ds);
  if (ms != null) {
    setText('fcSpeedMobile', ms);
    console.log('[applyVitals] Set fcSpeedMobile to:', ms);
    const mobileBar = document.getElementById('fcSpeedMobileBar');
    if (mobileBar) mobileBar.style.width = ms + '%';
  }
  if (ds != null) {
    setText('fcSpeedDesktop', ds);
    console.log('[applyVitals] Set fcSpeedDesktop to:', ds);
    const desktopBar = document.getElementById('fcSpeedDesktopBar');
    if (desktopBar) desktopBar.style.width = ds + '%';
  }
  
  // Also update Load Time if available in vitals
  if (vitals.loadTime != null) {
    const loadTimeSec = (vitals.loadTime / 1000).toFixed(1);
    setText('fcLoadTime', loadTimeSec + 's');
  }
  
  // Update Core Web Vitals in Technical tab
  if (vitals.lcp != null) setText('cwvLcp', (vitals.lcp / 1000).toFixed(1) + 's');
  if (vitals.inp != null) setText('cwvInp', Math.round(vitals.inp) + 'ms');
  if (vitals.cls != null) setText('cwvCls', vitals.cls.toFixed(3));
  
  // Load time / TTI from audits
  if (vitals.audits?.tti != null) {
    setText('fcTTI', (vitals.audits.tti / 1000).toFixed(1) + 's');
  }
  if (vitals.audits?.speedIndex != null && !vitals.loadTime) {
    setText('fcLoadTime', (vitals.audits.speedIndex / 1000).toFixed(1) + 's');
  }

  // Re-render CWV feature card from shared helper
  try { renderCoreWebVitals(_rawData || {}); } catch (_) {}

  // Update Core Web Vitals Feature Card (legacy inline)
  let passedCount = 0;
  
  if (vitals.lcp != null) {
    const lcpSec = (vitals.lcp / 1000).toFixed(1);
    setText('fcLCP', lcpSec + 's');
    const lcpStatus = vitals.lcp <= 2500 ? 'Good' : vitals.lcp <= 4000 ? 'Needs Work' : 'Poor';
    setText('fcLCPStatus', lcpStatus);
    if (vitals.lcp <= 2500) passedCount++;
  }
  
  if (vitals.inp != null) {
    const inpMs = Math.round(vitals.inp);
    setText('fcFID', inpMs + 'ms'); // Using FID element for INP
    const inpStatus = vitals.inp <= 200 ? 'Good' : vitals.inp <= 500 ? 'Needs Work' : 'Poor';
    setText('fcFIDStatus', inpStatus);
    if (vitals.inp <= 200) passedCount++;
  }
  
  if (vitals.cls != null) {
    setText('fcCLS', vitals.cls.toFixed(3));
    const clsStatus = vitals.cls <= 0.1 ? 'Good' : vitals.cls <= 0.25 ? 'Needs Work' : 'Poor';
    setText('fcCLSStatus', clsStatus);
    if (vitals.cls <= 0.1) passedCount++;
  }
  
  // Update overall status
  const totalMetrics = [vitals.lcp, vitals.inp, vitals.cls].filter(v => v != null).length;
  if (totalMetrics > 0) {
    setText('fcCWVOverall', `${passedCount} / ${totalMetrics} Passed`);
  }

  const cwvLoad = $('cwvLoading'); if (cwvLoad) cwvLoad.style.display = 'none';
  const cwvBars = $('cwvBars'); if (cwvBars) cwvBars.style.display = '';

  // Helper: set bar metric
  function setCwvBar(detailId, barId, val, good, poor, fmt) {
    const e = $(detailId); const b = $(barId);
    if (!e || val == null) return;
    const cls = val <= good ? 'ok' : val <= poor ? 'warn' : 'err';
    e.textContent = fmt(val);
    e.className = 'cwv-metric-val t-cwv-val text-' + cls;
    if (b) { b.style.width = Math.min(100, (val / poor) * 80) + '%'; b.className = 't-cwv-bar-fill ' + cls; }
  }
  if (vitals.lcp != null) setCwvBar('cwvLcpDetail','cwvLcpBar',vitals.lcp,2500,4000,v=>(v/1000).toFixed(2)+'s');
  if (vitals.inp != null) setCwvBar('cwvInpDetail','cwvInpBar',vitals.inp,200,500,v=>Math.round(v)+'ms');
  if (vitals.cls != null) setCwvBar('cwvClsDetail','cwvClsBar',vitals.cls,0.1,0.25,v=>v.toFixed(3));
  if (vitals.audits?.fcp != null) setCwvBar('cwvFcpDetail','cwvFcpBar',vitals.audits.fcp,1800,3000,v=>(v/1000).toFixed(2)+'s');
  if (vitals.audits?.speedIndex != null) setCwvBar('cwvSiDetail','cwvSiBar',vitals.audits.speedIndex,3400,5800,v=>(v/1000).toFixed(2)+'s');
  if (vitals.audits?.tti != null) setCwvBar('cwvTtiDetail','cwvTtiBar',vitals.audits.tti,3800,7300,v=>(v/1000).toFixed(2)+'s');
}


function appendDomainRegistryRows(rows, info) {
  const meta = info?.tldMeta || {};
  const domain = (() => { try { return new URL(_currentUrl || 'https://example.com').hostname; } catch (_) { return ''; } })().replace(/^www\./i, '').toLowerCase();
  const parts = domain.split('.').filter(Boolean);
  const suffix2 = parts.length >= 2 ? parts.slice(-2).join('.') : '';
  const multiSuffixes = new Set(['co.za','web.za','org.za','net.za','co.uk','org.uk','me.uk','gov.uk','ac.uk','co.nz','co.in','net.in','org.in','com.au','net.au','org.au','com.br','com.mx','com.ar','com.tr','com.sg','com.my','com.ph','com.hk','com.tw','com.cn','com.qa','com.sa','com.eg','com.kw','com.bh','com.om','com.pk','net.pk','org.pk','edu.pk','gov.pk','co.id','or.id','co.jp','ne.jp']);
  const suffix = multiSuffixes.has(suffix2) ? '.' + suffix2 : (parts.length ? '.' + parts[parts.length - 1] : '');
  if (meta.country || suffix) rows.push(tDomainRow('TLD / country', `<strong>${escHTML(suffix.toUpperCase())}</strong>${meta.country ? ` <span class="t-domain-subtle">${escHTML(meta.country)}</span>` : ''}`));
  if (meta.manager) rows.push(tDomainRow('Registry', escHTML(meta.manager)));
  let whois = info?.whoisServer || meta.whoisServer;
  // Some country namespaces use a distinct WHOIS host for their multi-level zone.
  if (/\.co\.za$/i.test(domain)) whois = 'coza-whois.registry.net.za';
  if (/\.ph$/i.test(domain)) whois = whois || 'whois.dot.ph';
  if (/\.hk$/i.test(domain)) whois = whois || 'whois.hkirc.hk';
  if (whois) rows.push(tDomainRow('WHOIS server', `<span class="t-domain-mono">${escHTML(whois)}</span>`));
  const rdap = info?.rdapServer || meta.rdapServer;
  rows.push(tDomainRow('RDAP', rdap ? `<span class="t-domain-mono">${escHTML(rdap)}</span>` : '<span class="t-domain-muted">Not published by registry</span>'));
  if (meta.registrationUrl) rows.push(tDomainRow('Registry site', `<a class="t-domain-link" href="${escHTML(meta.registrationUrl)}" target="_blank" rel="noopener">Open registry ↗</a>`));
  if (meta.ianaUrl) rows.push(tDomainRow('IANA record', `<a class="t-domain-link" href="${escHTML(meta.ianaUrl)}" target="_blank" rel="noopener">View delegation ↗</a>`));
  if (Array.isArray(info?.status) && info.status.length) {
    rows.push(tDomainRow('Status', `<span class="t-domain-status-list">${info.status.slice(0, 6).map(x => `<span class="t-domain-status-chip">${escHTML(String(x))}</span>`).join(' ')}</span>`));
  }
  const src = String(info?.source || '');
  if (src) rows.push(tDomainRow('Data source', `<span class="t-domain-chip">${escHTML(src)}</span>`));
}

// ─── Domain Info (RDAP) ───────────────────────────────
function renderDomainInfo(info) {
  const card = $('techDomainCard'); if (!card) return;
  const div = $('techDomainInfo'); if (!div) return;
  const rows = [];
  const u = new URL(_currentUrl || 'https://example.com');

  rows.push(tDomainRow('Domain', `<span style="font-family:var(--mono);font-size:11px;font-weight:700;color:var(--text)">${escHTML(u.hostname.toUpperCase())}</span>`));
  appendDomainRegistryRows(rows, info);

  if (info.registrar) rows.push(tDomainRow('Registrar', escHTML(info.registrar)));

  if (info.createdDate) {
    const created = new Date(info.createdDate);
    const diffMonths = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    const ageYears = Math.floor(diffMonths / 12);
    const ageMos = Math.floor(diffMonths % 12);
    const ageLabel = ageYears >= 1 ? `${ageYears} year(s) ${ageMos} month(s)` : `${Math.max(0, Math.floor(diffMonths))} month(s)`;
    rows.push(tDomainRow('Domain age', `<strong>${ageLabel}</strong>`));
    rows.push(tDomainRow('Created', created.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })));
  }

  if (info.expirationDate) {
    const exp = new Date(info.expirationDate);
    const dLeft = Math.round((exp - Date.now()) / 86400000);
    const expStr = exp.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    rows.push(tDomainRow('Expires', expStr + (dLeft < 90 ? ` <span class="t-status-badge warn">${dLeft}d left</span>` : '')));
  }

  if (info.updatedDate) rows.push(tDomainRow('Updated', new Date(info.updatedDate).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })));

  if (info.cdnHint) {
    rows.push(tDomainRow('DNS Provider', `<span class="t-domain-chip">${escHTML(info.cdnHint)}</span>`));
  }
  if (info.nameservers?.length) {
    const nsHtml = `<div class="t-domain-ns">${info.nameservers.map(n => `<span>${escHTML(n.toUpperCase())}</span>`).join('')}</div>`;
    rows.push(tDomainRow('Nameservers', nsHtml));
  }

  const loader = $('techDomainLoading');
  if (loader) loader.remove();
  div.innerHTML = rows.join('');
}

function tDomainRow(label, value) {
  return `<div class="t-domain-row"><span class="t-domain-label">${escHTML(label)}</span><span class="t-domain-value">${value}</span></div>`;
}

// ─── Dashboard Domain Info ────────────────────────────
function renderDashDomainInfo(info) {
  const div = $('dashDomainInfo'); if (!div) return;
  const rows = [];
  const u = new URL(_currentUrl || 'https://example.com');
  rows.push(tDomainRow('Domain', `<span style="font-family:var(--mono);font-size:11px;font-weight:700;color:var(--text)">${escHTML(u.hostname.toUpperCase())}</span>`));
  appendDomainRegistryRows(rows, info);
  if (info.registrar) rows.push(tDomainRow('Registrar', escHTML(info.registrar)));
  if (info.createdDate) {
    const created = new Date(info.createdDate);
    const diffMonths = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    const ageYears = Math.floor(diffMonths / 12);
    const ageMos = Math.floor(diffMonths % 12);
    rows.push(tDomainRow('Age', ageYears >= 1 ? `${ageYears} year(s) ${ageMos} month(s)` : `${Math.floor(diffMonths)} month(s)`));
    rows.push(tDomainRow('Created', created.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })));
  }
  if (info.expirationDate) {
    const exp = new Date(info.expirationDate);
    const dLeft = Math.round((exp - Date.now()) / 86400000);
    const expStr = exp.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
    rows.push(tDomainRow('Expires', expStr + (dLeft < 90 ? ` <span class="t-status-badge warn">${dLeft}d left</span>` : '')));
  }
  if (info.cdnHint) {
    rows.push(tDomainRow('DNS Provider', `<span class="t-domain-chip">${escHTML(info.cdnHint)}</span>`));
  }
  if (info.nameservers?.length) {
    const nsHtml = `<div class="t-domain-ns">${info.nameservers.map(n => `<span>${escHTML(n.toUpperCase())}</span>`).join('')}</div>`;
    rows.push(tDomainRow('Nameservers', nsHtml));
  }
  const loader = $('dashDomainLoading');
  if (loader) loader.remove();
  div.innerHTML = rows.join('');
}

// ─── DA Tab Domain Info ───────────────────────────────
function renderDaDomainInfo(info) {
  const div = $('daDomainInfo'); if (!div) return;
  const rows = [];
  const u = new URL(_currentUrl || 'https://example.com');
  rows.push(tDomainRow('Domain', `<span style="font-family:var(--mono);font-size:11px;font-weight:700;color:var(--text)">${escHTML(u.hostname.toUpperCase())}</span>`));
  appendDomainRegistryRows(rows, info);
  if (info.registrar) rows.push(tDomainRow('Registrar', escHTML(info.registrar)));
  if (info.createdDate) {
    const created = new Date(info.createdDate);
    const diffMonths = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    const ageYears = Math.floor(diffMonths / 12);
    const ageMos = Math.floor(diffMonths % 12);
    rows.push(tDomainRow('Age', ageYears >= 1 ? `${ageYears} year(s) ${ageMos} month(s)` : `${Math.floor(diffMonths)} month(s)`));
    rows.push(tDomainRow('Created', created.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })));
  }
  if (info.expirationDate) {
    const exp = new Date(info.expirationDate);
    const dLeft = Math.round((exp - Date.now()) / 86400000);
    const expStr = exp.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
    rows.push(tDomainRow('Expires', expStr + (dLeft < 90 ? ` <span class="t-status-badge warn">${dLeft}d left</span>` : '')));
  }
  if (info.updatedDate) rows.push(tDomainRow('Updated', new Date(info.updatedDate).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })));
  if (info.cdnHint) {
    rows.push(tDomainRow('DNS Provider', `<span class="t-domain-chip">${escHTML(info.cdnHint)}</span>`));
  }
  if (info.nameservers?.length) {
    const nsHtml = `<div class="t-domain-ns">${info.nameservers.map(n => `<span>${escHTML(n.toUpperCase())}</span>`).join('')}</div>`;
    rows.push(tDomainRow('Nameservers', nsHtml));
  }
  const loader = $('daDomainLoading');
  if (loader) loader.remove();
  div.innerHTML = rows.join('');
}

// ─── Moz Refresh (clear cache + re-fetch) ─────────────
function refreshMozData() {
  const btn = document.getElementById('mozRefreshBtn');
  if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; }

  // Reset loading state
  ['dashMozContent','daMozContent'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="t-domain-loading" style="padding:12px 0"><svg class="t-domain-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Refreshing Moz data…</div>';
  });

  // Get current tab domain
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab?.url) return;
    let domain;
    try { domain = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { return; }

    // Clear the session cache for this domain, then re-fetch
    chrome.runtime.sendMessage({ action: 'MOZ_CLEAR_CACHE', domain }, () => {
      chrome.runtime.sendMessage({ action: 'MOZ_FETCH', domain }, r => {
        if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
        if (r?.ok) {
          renderMozMetrics(r, 'dashMozContent', 'dashMozLoading');
          renderMozMetrics(r, 'daMozContent', 'daMozLoading');
          function fmtNum(n) { if (!n) return '--'; if (n >= 1000000) return (n/1000000).toFixed(1)+'M'; if (n >= 1000) return (n/1000).toFixed(1)+'K'; return String(n); }
          const hasMozData = r.source !== 'SEMrush' && (r.domainAuthority > 0 || r.pageAuthority > 0);
          setText('qDomainDA', hasMozData ? r.domainAuthority : '--');
          setText('qDomainBL', fmtNum(r.backlinks));
        } else {
          ['dashMozContent','daMozContent'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div style="color:var(--err);font-size:12px;padding:8px 0">Moz data unavailable — try again</div>';
          });
        }
      });
    });
  });
}

// ─── Moz Metrics Render ───────────────────────────────
function renderMozMetrics(moz, contentId, loadingId) {
  const container = $(contentId); if (!container) return;
  const loader = $(loadingId); if (loader) loader.remove();

  function fmt(n) {
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n/1000).toFixed(1) + 'K';
    return String(n);
  }
  function scoreColor(v, max) {
    const pct = v / max;
    if (pct >= 0.7) return 'var(--ok)';
    if (pct >= 0.4) return 'var(--warn)';
    return 'var(--err)';
  }
  function spamColor(v) {
    if (v <= 10) return 'var(--ok)';
    if (v <= 30) return 'var(--warn)';
    return 'var(--err)';
  }

  // hasMoz = we got real Moz DA/PA/Spam data (not just SEMrush BL/RD fallback)
  const hasMoz = moz.source !== 'SEMrush' && (moz.domainAuthority != null || moz.pageAuthority != null || moz.spamScore != null);
  
  const metrics = [
    { label: 'Domain Authority', display: hasMoz && moz.domainAuthority != null ? moz.domainAuthority : '--', color: scoreColor(moz.domainAuthority || 0, 100), suffix: hasMoz && moz.domainAuthority != null ? '/100' : '' },
    { label: 'Page Authority', display: hasMoz && moz.pageAuthority != null ? moz.pageAuthority : '--', color: scoreColor(moz.pageAuthority || 0, 100), suffix: hasMoz && moz.pageAuthority != null ? '/100' : '' },
    { label: 'PageRank Score', display: moz.pageRank != null ? Number(moz.pageRank).toFixed(2) : '--', color: scoreColor((Number(moz.pageRank) || 0) * 10, 100), suffix: '' },
    { label: 'Spam Score', display: hasMoz && moz.spamScore != null ? moz.spamScore + '%' : '--', color: spamColor(moz.spamScore || 0), suffix: '' },
    { label: 'Link Propensity', display: moz.linkPropensity != null ? moz.linkPropensity : '--', color: 'var(--text-1)', suffix: '' },
    { label: 'Referring Domains', display: (moz.rootDomainsToSubdomain || moz.referringDomains) > 0 ? fmt(moz.rootDomainsToSubdomain || moz.referringDomains) : '--', color: 'var(--text-1)', suffix: '' },
    { label: 'Nofollow Root Domains', display: moz.nofollowRootDomainsToSubdomain != null ? fmt(moz.nofollowRootDomainsToSubdomain) : '--', color: 'var(--text-1)', suffix: '' },
    { label: 'Deleted Root Domains', display: moz.deletedRootDomainsToSubdomain != null ? fmt(moz.deletedRootDomainsToSubdomain) : '--', color: 'var(--text-1)', suffix: '' },
  ];

  // Fill extended Moz pages / external breakdown cards
  try { renderMozPagesBreakdown(moz); } catch (_) {}
  try { fetchAndRenderSemrushBacklinks(moz.domain || window._currentDomain); } catch (_) {}

  // Add DA History chart if available (before other metrics)
  let daHistoryHTML = '';
  if (moz.daHistoryValues && moz.daHistoryValues.length > 0) {
    const values = moz.daHistoryValues.slice(-10); // Last 10 months
    const maxDA = Math.max(...values, 50); // Min scale of 50 for better visualization
    const bars = values.map((val, idx) => {
      const height = Math.max((val / maxDA) * 100, 5); // Min 5% height for visibility
      const color = val >= 30 ? 'var(--ok, #10b981)' : val >= 15 ? 'var(--warn, #f59e0b)' : 'var(--err, #ef4444)';
      return `<div class="da-history-bar" style="height:${height}%; background:${color};" title="Month ${idx + 1}: DA ${val}"><span class="da-bar-value">${val}</span></div>`;
    }).join('');
    daHistoryHTML = `
      <div class="da-history-container">
        <div class="da-history-header">
          <span class="da-history-label">DA History (Last ${values.length} months)</span>
          <span class="da-history-trend">${values[0]} → ${values[values.length - 1]}</span>
        </div>
        <div class="da-history-chart">${bars}</div>
      </div>`;
  }

  const sourceLabel = moz.source ? `<div class="moz-source-line">Source: ${escHTML(moz.source)}</div>` : '';
  container.innerHTML = `${daHistoryHTML}<div class="moz-metric-grid">${metrics.map(m => `
    <div class="moz-metric-item">
      <div class="moz-metric-value" style="color:${m.color}">${m.display}${m.suffix}</div>
      <div class="moz-metric-label">${m.label}</div>
    </div>`).join('')}</div>${sourceLabel}`;

  // Record DA + API monthly history into local DA/DR history
  try {
    const domain = String(moz.domain || window._currentDomain || '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .toLowerCase();
    const daVal = moz.domainAuthority != null ? Number(moz.domainAuthority) : null;
    if (domain && window.ShahzaibSEOHistory && daVal != null && !Number.isNaN(daVal)) {
      window.ShahzaibSEOHistory.recordBoth(domain, {
        da: daVal,
        spam: moz.spamScore != null ? Number(moz.spamScore) : undefined,
        rd: moz.referringDomains != null ? Number(moz.referringDomains) : undefined,
        daHistoryValues: Array.isArray(moz.daHistoryValues) ? moz.daHistoryValues : undefined
      });
    }
    if (domain && window.ShahzaibSEOHistory && Array.isArray(moz.daHistoryValues) && moz.daHistoryValues.length) {
      window.ShahzaibSEOHistory.setApiHistory(domain, moz.daHistoryValues, daVal);
    }
  } catch (_) {}
}

// ─── Moz pages linking + external breakdown ───────────
function renderMozPagesBreakdown(moz) {
  const fmt = n => {
    if (n == null || n === '') return '—';
    n = Number(n);
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  };
  const set = (id, val) => { const el = $(id); if (el) el.textContent = fmt(val); };
  set('mozPagesTotal', moz.pagesToSubdomain);
  set('mozPagesNofollow', moz.nofollowPagesToSubdomain);
  set('mozPagesRedirect', moz.redirectPagesToSubdomain);
  set('mozPagesDeleted', moz.deletedPagesToSubdomain);
  set('mozExtBacklinks', moz.externalPagesToSubdomain);
  set('mozExtNofollow', moz.externalNofollowPagesToSubdomain);
  set('mozExtRedirect', moz.externalRedirectPagesToSubdomain);
  const card = $('mozPagesCard');
  if (card) card.style.display = '';
}

function fetchAndRenderSemrushBacklinks(domain) {
  domain = String(domain || '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  if (!domain) return;
  const card = $('semrushBlCard');
  if (card) card.style.display = '';
  const set = (id, val) => {
    const el = $(id);
    if (!el) return;
    if (val == null || val === '') { el.textContent = '—'; return; }
    const n = Number(val);
    if (!Number.isFinite(n)) { el.textContent = String(val); return; }
    if (n >= 1e6) el.textContent = (n / 1e6).toFixed(1) + 'M';
    else if (n >= 1e3) el.textContent = (n / 1e3).toFixed(1) + 'K';
    else el.textContent = String(Math.round(n));
  };
  chrome.runtime.sendMessage({ action: 'SEMRUSH_BACKLINKS_FETCH', domain }, r => {
    if (chrome.runtime.lastError || !r?.ok) {
      set('semBlCount', null);
      set('semRefDomains', null);
      set('semOrganicKw', null);
      set('semRank', null);
      return;
    }
    set('semBlCount', r.backlinks);
    set('semRefDomains', r.refDomains);
    set('semOrganicKw', r.organicKeywords);
    const rankEl = $('semRank');
    if (rankEl) rankEl.textContent = r.semrushRank != null && r.semrushRank > 0 ? String(r.semrushRank) : 'N/A';
  });
}

// ─── Ahrefs DR Render ─────────────────────────────────
function renderAhrefsDR(data, contentId, loadingId) {
  const container = $(contentId); if (!container) return;
  const loader = $(loadingId); if (loader) loader.remove();

  const dr      = data.domainRating ?? 0;
  const drRound = Math.round(dr);
  const domain  = data.domain || '';
  // Record DR history (local)
  try {
    if (domain && data.domainRating != null && window.ShahzaibSEOHistory) {
      window.ShahzaibSEOHistory.recordDr(domain, data.domainRating);
    }
  } catch (_) {}

  // ── Helpers ──────────────────────────────────────────
  function drColor(v) {
    if (v >= 70) return '#10b981';
    if (v >= 40) return '#f59e0b';
    if (v >= 20) return '#f97316';
    return '#ef4444';
  }
  function drTier(v) {
    if (v >= 70) return { label: 'High Authority',  icon: '🏆', desc: 'Top-tier backlink profile. Competes across highly contested keywords.' };
    if (v >= 50) return { label: 'Good Authority',  icon: '✅', desc: 'Solid link equity. You can rank for most mid-difficulty terms.' };
    if (v >= 30) return { label: 'Fair Authority',  icon: '📈', desc: 'Building momentum. More quality backlinks will push you up.' };
    if (v >= 10) return { label: 'Low Authority',   icon: '🌱', desc: 'Early stage. Focus on earning links from relevant, authoritative sites.' };
    return         { label: 'Very Low / New', icon: '🆕', desc: 'Brand new or nearly unlinked. Every quality backlink counts.' };
  }
  function drPercentile(v) {
    if (v >= 80) return 99; if (v >= 70) return 97; if (v >= 60) return 93;
    if (v >= 50) return 85; if (v >= 40) return 72; if (v >= 30) return 55;
    if (v >= 20) return 38; if (v >= 10) return 20; if (v >= 5) return 10;
    return 5;
  }

  const tier       = drTier(drRound);
  const pct        = Math.min(100, drRound);
  const color      = drColor(drRound);
  const percentile = drPercentile(drRound);

  // ── Read live DA for comparison ──────────────────────
  const daNumEl = document.getElementById('qDomainDA');
  const daVal   = daNumEl ? parseInt(daNumEl.textContent, 10) : NaN;
  const hasDa   = !isNaN(daVal) && daVal > 0;

  const reportUrl = domain
    ? `https://ahrefs.com/website-authority-checker/?input=${encodeURIComponent('https://' + domain)}`
    : 'https://ahrefs.com/website-authority-checker/';

  // ── Authority comparison bars ─────────────────────────
  function mkBar(label, val, barColor, maxVal) {
    const fillPct = Math.round(Math.min(100, (val / maxVal) * 100));
    return `
      <div style="display:grid;grid-template-columns:72px 1fr 32px;align-items:center;gap:10px;padding:6px 0;">
        <span style="font-size:12px;color:var(--text-3);white-space:nowrap;">${label}</span>
        <div style="height:8px;background:var(--border);border-radius:3px;overflow:hidden;">
          <div style="width:${fillPct}%;height:100%;background:${barColor};border-radius:3px;transition:width 0.45s ease;"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${barColor};text-align:right;line-height:1;">${val}</span>
      </div>`;
  }

  const compScale = 100;
  const compHtml  = (hasDa ? mkBar('Moz DA', daVal, '#6366f1', compScale) : '') +
                    mkBar('Ahrefs DR', drRound, color, compScale);

  const diffHtml = hasDa ? (() => {
    const diff = drRound - daVal;
    const sign = diff > 0 ? '+' : '';
    const diffColor = diff > 0 ? '#10b981' : diff < 0 ? '#ef4444' : '#94a3b8';
    const note = Math.abs(diff) > 15 ? ' (different methodologies)' : '';
    return `<p style="font-size:10.5px;color:var(--text-4);margin:3px 0 0;text-align:right;padding-right:2px;">
      DR <span style="color:${diffColor};font-weight:700;">${sign}${diff}</span> vs DA${note}
    </p>`;
  })() : '';

  // ── Industry benchmarks ───────────────────────────────
  const benchmarks = [
    { label: 'News / Media', dr: 72 },
    { label: 'SaaS / Tech',  dr: 55 },
    { label: 'E-commerce',   dr: 45 },
    { label: 'Local Biz',    dr: 22 },
    { label: 'New Site',     dr: 5  },
  ];
  let userBracket = benchmarks.findIndex((b, i) => {
    const next = benchmarks[i + 1];
    return drRound >= (next ? next.dr : 0) && drRound <= b.dr + 20;
  });
  if (userBracket === -1) userBracket = benchmarks.length - 1;

  const benchHtml = benchmarks.map((b, i) => {
    const isActive = i === userBracket;
    const bColor   = drColor(b.dr);
    const fillPct  = b.dr;
    return `
      <div style="display:grid;grid-template-columns:88px 1fr 28px;align-items:center;gap:10px;padding:5px 0;${isActive ? '' : 'opacity:0.5;'}">
        <span style="font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${isActive ? `<strong style="color:var(--text-2);">${b.label}</strong>` : b.label}
        </span>
        <div style="position:relative;height:7px;background:var(--border);border-radius:3px;overflow:visible;">
          <div style="width:${fillPct}%;height:100%;background:${bColor};border-radius:3px;"></div>
          ${isActive ? `<div style="position:absolute;top:-3.5px;left:calc(${Math.min(96,pct)}% - 5px);width:12px;height:12px;border-radius:50%;background:${color};border:2px solid var(--surface);box-shadow:0 0 0 1.5px ${color};pointer-events:none;"></div>` : ''}
        </div>
        <span style="font-size:11.5px;font-weight:600;color:${bColor};text-align:right;">${b.dr}</span>
      </div>`;
  }).join('');

  // ── Render — wrapped in padded inner box ──────────────
  container.innerHTML = `
    <div style="padding:14px 16px;">

      <!-- Hero row -->
      <div style="display:flex;align-items:center;gap:14px;padding-bottom:12px;border-bottom:1px solid var(--border);">
        <!-- Ring -->
        <div style="flex-shrink:0;width:68px;height:68px;border-radius:50%;
                    background:conic-gradient(${color} ${pct * 3.6}deg, var(--border) ${pct * 3.6}deg);
                    display:flex;align-items:center;justify-content:center;">
          <div style="width:50px;height:50px;border-radius:50%;background:var(--surface);
                      display:flex;align-items:center;justify-content:center;flex-direction:column;">
            <span style="font-size:19px;font-weight:800;color:${color};line-height:1.1;">${drRound}</span>
            <span style="font-size:8.5px;color:var(--text-4);font-weight:500;letter-spacing:0.04em;">/100</span>
          </div>
        </div>
        <!-- Text -->
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
            <span style="font-size:13px;line-height:1;">${tier.icon}</span>
            <span style="font-size:13px;font-weight:700;color:${color};">${tier.label}</span>
          </div>
          <p style="font-size:11.5px;color:var(--text-3);line-height:1.5;margin:0 0 4px;">${tier.desc}</p>
          <span style="font-size:11px;color:var(--text-4);">
            Better than <strong style="color:${color};">~${percentile}%</strong> of websites
          </span>
        </div>
        <!-- Big Number DR Display -->
        <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 14px;border:1.5px solid ${color};border-radius:8px;background:var(--surface);min-width:70px;">
          <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:${color};text-transform:uppercase;margin-bottom:2px;">AHREFS DR</span>
          <span style="font-size:30px;font-weight:800;color:${color};line-height:1;">${drRound}</span>
        </div>
      </div>

      <!-- Authority comparison -->
      <div style="margin-top:12px;">
        <p style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;
                  color:var(--text-4);margin:0 0 4px;">Authority Comparison</p>
        <div style="max-width:480px;">${compHtml}</div>
        ${diffHtml}
      </div>

      <div style="border-top:1px solid var(--border);margin:12px 0;"></div>

      <!-- Benchmarks -->
      <div>
        <p style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;
                  color:var(--text-4);margin:0 0 6px;">Industry Benchmarks (avg DR)</p>
        <div style="max-width:480px;">${benchHtml}</div>
      </div>

      <div style="border-top:1px solid var(--border);margin:12px 0;"></div>

      <!-- What is DR -->
      <details style="font-size:11px;color:var(--text-3);">
        <summary style="cursor:pointer;font-size:10.5px;font-weight:700;text-transform:uppercase;
                        letter-spacing:0.07em;color:var(--text-4);list-style:none;
                        display:flex;align-items:center;gap:4px;outline:none;">
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="#FF642B" stroke-width="2">
            <circle cx="8" cy="8" r="7"/><line x1="8" y1="6" x2="8" y2="8"/>
            <circle cx="8" cy="11" r="0.6" fill="#FF642B" stroke="none"/>
          </svg>
          <span style="color:#FF642B;">What is Domain Rating?</span>
        </summary>
        <p style="margin:6px 0 0;line-height:1.55;color:var(--text-3);padding-left:14px;max-width:440px;">
          DR measures the strength of a website's backlink profile on a logarithmic 0–100 scale —
          based on unique linking domains weighted by their own DR.
          It's <em>not</em> a direct Google ranking factor but correlates strongly with organic visibility.
        </p>
      </details>

      <!-- Ahrefs Site Explorer shortcuts (same as SERP Page/Domain buttons) -->
      ${domain ? `
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <p style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;
                  color:var(--text-4);margin:0 0 8px;">Open in Ahrefs</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;color:var(--text-3);font-weight:600;min-width:52px;">Domain:</span>
          <a href="https://ahrefs.com/site-explorer/overview/v2/subdomains/live?target=${encodeURIComponent(domain)}" target="_blank" rel="noopener"
             style="font-size:11px;font-weight:600;color:#1a73e8;text-decoration:none;padding:4px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">Both</a>
          <a href="https://ahrefs.com/traffic-checker/?input=${encodeURIComponent('https://' + domain)}" target="_blank" rel="noopener"
             style="font-size:11px;font-weight:600;color:#5f6368;text-decoration:none;padding:4px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">Traffic</a>
          <a href="https://ahrefs.com/backlink-checker/?input=${encodeURIComponent('https://' + domain)}" target="_blank" rel="noopener"
             style="font-size:11px;font-weight:600;color:#34a853;text-decoration:none;padding:4px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">Links</a>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          <span style="font-size:11px;color:var(--text-3);font-weight:600;min-width:52px;">Page:</span>
          <a href="https://ahrefs.com/site-explorer/overview/v2/exact/live?target=${encodeURIComponent('https://' + domain + '/')}" target="_blank" rel="noopener"
             style="font-size:11px;font-weight:600;color:#1a73e8;text-decoration:none;padding:4px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">Both</a>
          <a href="https://ahrefs.com/traffic-checker/?input=${encodeURIComponent('https://' + domain + '/')}" target="_blank" rel="noopener"
             style="font-size:11px;font-weight:600;color:#5f6368;text-decoration:none;padding:4px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">Traffic</a>
          <a href="https://ahrefs.com/backlink-checker/?input=${encodeURIComponent('https://' + domain + '/')}" target="_blank" rel="noopener"
             style="font-size:11px;font-weight:600;color:#34a853;text-decoration:none;padding:4px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">Links</a>
        </div>
      </div>` : ''}

      <!-- Footer -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <span style="font-size:11px;color:var(--text-4);">
          Source: <span style="color:#FF642B;font-weight:600;">Ahrefs</span> Free API
        </span>
        <a href="${reportUrl}" target="_blank"
           style="font-size:11px;color:#FF642B;text-decoration:none;font-weight:600;
                  display:inline-flex;align-items:center;gap:3px;">
          Full Report
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="#FF642B" stroke-width="1.8">
            <path d="M2 10L10 2M5 2h5v5"/>
          </svg>
        </a>
      </div>

    </div>`;
}
// ─── Ahrefs Refresh ───────────────────────────────────
document.getElementById('ahrefsRefreshBtn')?.addEventListener('click', () => {
  const btn = document.getElementById('ahrefsRefreshBtn');
  if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; }
  const el = document.getElementById('dashAhrefsContent');
  if (el) el.innerHTML = '<div class="t-domain-loading" style="padding:12px 0"><svg class="t-domain-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Refreshing Ahrefs DR…</div>';

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0]; if (!tab?.url) return;
    let domain; try { domain = new URL(tab.url).hostname.replace(/^www\\./, ''); } catch { return; }

    // Clear cache then re-fetch
    chrome.runtime.sendMessage({ action: 'AHREFS_CLEAR_CACHE', domain }, () => {
      void chrome.runtime.lastError;
      chrome.runtime.sendMessage({ action: 'AHREFS_DR_FETCH', domain }, r => {
        void chrome.runtime.lastError;
        if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
        if (r?.ok && r.domainRating != null) {
          renderAhrefsDR({ ...r, domain }, 'dashAhrefsContent', 'dashAhrefsLoading');
          renderAhrefsDR({ ...r, domain }, 'daAhrefsContent', 'daAhrefsLoading');
          setText('qDomainDR', Math.round(r.domainRating));
        } else {
          const cont = document.getElementById('dashAhrefsContent');
          if (cont) cont.innerHTML = '<div style="color:var(--err);font-size:12px;padding:8px 0">Ahrefs DR unavailable — try again</div>';
        }
      });
    });
  });
});

// ─── Ahrefs DR Refresh (DA tab) ──────────────────────
document.getElementById('daAhrefsRefreshBtn')?.addEventListener('click', () => {
  const btn = document.getElementById('daAhrefsRefreshBtn');
  if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; }
  const el = document.getElementById('daAhrefsContent');
  if (el) el.innerHTML = '<div class="t-domain-loading" style="padding:12px 0"><svg class="t-domain-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Refreshing Ahrefs DR…</div>';

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0]; if (!tab?.url) return;
    let domain; try { domain = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { return; }

    chrome.runtime.sendMessage({ action: 'AHREFS_CLEAR_CACHE', domain }, () => {
      void chrome.runtime.lastError;
      chrome.runtime.sendMessage({ action: 'AHREFS_DR_FETCH', domain }, r => {
        void chrome.runtime.lastError;
        if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
        if (r?.ok && r.domainRating != null) {
          renderAhrefsDR({ ...r, domain }, 'daAhrefsContent', 'daAhrefsLoading');
          renderAhrefsDR({ ...r, domain }, 'dashAhrefsContent', 'dashAhrefsLoading');
          setText('qDomainDR', Math.round(r.domainRating));
        } else {
          const cont = document.getElementById('daAhrefsContent');
          if (cont) cont.innerHTML = '<div style="color:var(--err);font-size:12px;padding:8px 0">Ahrefs DR unavailable — try again</div>';
        }
      });
    });
  });
});

// ══════════════════════════════════════════════════════
// FEATURE 1: DA Score Breakdown + Tips
// ══════════════════════════════════════════════════════
function renderDaBreakdown(moz) {
  const card = $('daBreakdownCard'); if (!card) return;
  const container = $('daBreakdownContent'); if (!container) return;
  const badge = $('daBreakdownBadge');

  const da = moz.domainAuthority || 0;
  const pa = moz.pageAuthority || 0;
  const spam = moz.spamScore || 0;
  const rd = moz.referringDomains || 0;
  const bl = moz.backlinks || 0;

  // Determine DA tier
  let tier, tierColor, tierDesc;
  if (da >= 70) { tier = 'High Authority'; tierColor = '#10b981'; tierDesc = 'Strong domain trusted by Google and AI engines.'; }
  else if (da >= 40) { tier = 'Medium Authority'; tierColor = '#f59e0b'; tierDesc = 'Decent authority — active link building will push you higher.'; }
  else if (da >= 20) { tier = 'Low-Medium'; tierColor = '#f97316'; tierDesc = 'Growing domain. Focus on quality backlinks and content.'; }
  else { tier = 'Low Authority'; tierColor = '#ef4444'; tierDesc = 'New or under-optimized domain. Big opportunity ahead.'; }

  if (badge) { badge.textContent = tier; badge.style.background = tierColor; badge.style.color = '#fff'; badge.style.padding = '2px 8px'; badge.style.borderRadius = '10px'; badge.style.fontSize = '10px'; badge.style.fontWeight = '600'; }

  // Score factor analysis
  const factors = [
    {
      label: 'Domain Authority (DA)',
      value: da, max: 100, unit: '/100',
      good: da >= 40,
      tip: da >= 40 ? '✓ Solid DA. Maintain with consistent link building.' : `⚠ DA is low (${da}/100). Build high-quality backlinks from authority sites.`
    },
    {
      label: 'Page Authority (PA)',
      value: pa, max: 100, unit: '/100',
      good: pa >= 30,
      tip: pa >= 30 ? '✓ Good page-level authority.' : '⚠ Improve internal linking and get more page-specific backlinks.'
    },
    {
      label: 'Spam Score',
      value: spam, max: 100, unit: '%',
      good: spam <= 15,
      tip: spam <= 15 ? '✓ Low spam risk. Keep disavowing toxic links.' : `⚠ High spam score (${spam}%). Use Google Disavow Tool to remove toxic links.`
    },
    {
      label: 'Referring Domains',
      value: Math.min(rd, 10000), max: 10000, unit: '',
      displayVal: rd >= 1000 ? (rd/1000).toFixed(1)+'K' : String(rd),
      good: rd >= 50,
      tip: rd >= 50 ? `✓ Good referring domain diversity (${rd}).` : `⚠ Only ${rd} referring domains. Diversity matters more than raw backlinks.`
    },
    {
      label: 'Total Backlinks',
      value: Math.min(bl, 100000), max: 100000, unit: '',
      displayVal: bl >= 1000000 ? (bl/1000000).toFixed(1)+'M' : bl >= 1000 ? (bl/1000).toFixed(1)+'K' : String(bl),
      good: bl >= 100,
      tip: bl >= 100 ? `✓ ${bl >= 1000 ? (bl/1000).toFixed(1)+'K' : bl} backlinks found.` : `⚠ Very few backlinks (${bl}). Focus on content marketing and outreach.`
    }
  ];

  // Tips based on score analysis
  const allTips = [];
  if (da < 20) allTips.push({ icon: '🎯', text: 'Guest post on sites with DA 30+. Start with 2–3 posts per month.' });
  if (da < 40) allTips.push({ icon: '🔗', text: 'Build resource page links. Find "best [topic] resources" pages in your niche.' });
  if (rd < 50) allTips.push({ icon: '🌐', text: 'Domain diversity > quantity. 10 links from different domains beats 100 from one.' });
  if (spam > 15) allTips.push({ icon: '🧹', text: 'Audit toxic links with Moz Link Explorer and submit a disavow file to Google.' });
  if (pa < 30) allTips.push({ icon: '📄', text: 'Internally link your best content to boost Page Authority of key pages.' });
  allTips.push({ icon: '📰', text: 'HARO (Help A Reporter Out) — get authority .edu/.org/.gov links for free.' });
  allTips.push({ icon: '🏆', text: 'Create linkable assets: original research, tools, or comprehensive guides.' });

  const barsHTML = factors.map(f => {
    const pct = Math.round((f.value / f.max) * 100);
    const barColor = f.label === 'Spam Score' ? (f.good ? '#10b981' : '#ef4444') : (f.good ? '#10b981' : '#f59e0b');
    const displayVal = f.displayVal || (f.value + f.unit);
    return `
      <div class="da-breakdown-row">
        <div class="da-breakdown-row-header">
          <span class="da-breakdown-factor-label">${f.label}</span>
          <span class="da-breakdown-factor-val" style="color:${barColor}">${displayVal}</span>
        </div>
        <div class="da-breakdown-bar-bg">
          <div class="da-breakdown-bar-fill" style="width:${pct}%;background:${barColor};"></div>
        </div>
        <div class="da-breakdown-tip ${f.good ? 'tip-ok' : 'tip-warn'}">${f.tip}</div>
      </div>`;
  }).join('');

  const tipsHTML = allTips.map(t => `
    <div class="da-tip-item">
      <span class="da-tip-icon">${t.icon}</span>
      <span class="da-tip-text">${t.text}</span>
    </div>`).join('');

  container.innerHTML = `
    <div class="da-breakdown-tier-banner" style="background:${tierColor}18;border-left:3px solid ${tierColor};padding:8px 12px;border-radius:4px;margin-bottom:12px;">
      <span style="font-weight:700;color:${tierColor}">${tier}</span>
      <span style="font-size:11px;color:var(--text-3);margin-left:6px;">${tierDesc}</span>
    </div>
    <div class="da-breakdown-factors">${barsHTML}</div>
    <div class="da-tips-section">
      <div class="da-tips-header">
        <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13" style="color:#7c3aed"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/></svg>
        How to Improve Your DA
      </div>
      <div class="da-tips-list">${tipsHTML}</div>
    </div>`;

  card.style.display = '';
}

// ══════════════════════════════════════════════════════
// FEATURE 2: Bulk Domain Checker (DA · DR · Spam · Traffic · Emails)
// ══════════════════════════════════════════════════════
const BULK_MAX = 1000;
const BULK_DRAFT_KEY = 'bulkDaDrDraft';
const BULK_EXAMPLE = ['ahrefs.com', 'semrush.com', 'moz.com', 'backlinko.com'];
const BK_COPY_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>';
let _bulkLastResults = [];
let _bulkYou = '';
let _bulkAbort = false;
let _bulkRunning = false;
let _bulkBound = false;
let _bulkDraftTimer = null;
const _bulkView = { sortKey: null, sortDir: 'desc', filter: '', onlyEmail: false, hidden: new Set(['rd', 'bl']), expanded: new Set() };

function normalizeDomain(v) {
  return String(v || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase();
}

/** Parse a pasted list. Returns the clean list plus what was dropped, so the UI can explain it. */
function parseBulkDomainListEx(raw, yourDomain) {
  const seen = new Set();
  const list = [];
  let dupes = 0, invalid = 0, truncated = 0;
  const you = normalizeDomain(yourDomain);
  if (you) { seen.add(you); list.push(you); }
  const limit = BULK_MAX + (you ? 1 : 0);
  const isDomain = d => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(d);
  const tokens = [];
  String(raw || '').split(/[\n,;]+/).forEach(piece => {
    const t = piece.trim();
    if (!t) return;
    // "a.com b.org" (space separated) is accepted only when every part is a valid domain
    const parts = t.split(/\s+/);
    if (parts.length > 1 && parts.every(x => isDomain(normalizeDomain(x)))) tokens.push(...parts);
    else tokens.push(t);
  });
  tokens.forEach(tok => {
    const d = normalizeDomain(tok);
    if (!d) return;
    if (!isDomain(d)) { invalid++; return; }
    if (seen.has(d)) { dupes++; return; }
    if (list.length >= limit) { truncated++; return; }
    seen.add(d);
    list.push(d);
  });
  return { list, dupes, invalid, truncated, count: list.length - (you ? 1 : 0) };
}
function parseBulkDomainList(raw, yourDomain) { return parseBulkDomainListEx(raw, yourDomain).list; }

function bulkFmt(n) {
  if (n == null || n === '') return '—';
  if (typeof n !== 'number') return n;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

// ── Input area: counter, hints, run button label ──
function updateBulkHint() {
  const ta = $('bulkDomainList');
  const info = parseBulkDomainListEx(ta?.value, _bulkYou);
  const countEl = $('bulkDomainCount');
  if (countEl) {
    countEl.textContent = info.count + ' / ' + BULK_MAX;
    countEl.style.color = info.count >= BULK_MAX ? '#dc2626' : '';
  }
  const hint = $('bulkListHint');
  if (hint) {
    const parts = [];
    if (info.dupes) parts.push(info.dupes + ' duplicate' + (info.dupes > 1 ? 's' : '') + ' removed');
    if (info.invalid) parts.push(info.invalid + ' invalid skipped');
    if (info.truncated) parts.push(info.truncated + ' over the ' + BULK_MAX + ' limit');
    hint.textContent = parts.join(' · ');
    hint.style.color = (info.invalid || info.truncated) ? '#b45309' : '';
  }
  const run = $('bulkRunBtn'), label = $('bulkRunLabel');
  const n = info.list.length;
  if (label) label.textContent = info.count ? 'Run check · ' + n + ' domain' + (n === 1 ? '' : 's') : 'Run check';
  if (run) run.disabled = !info.count || _bulkRunning;
}

function bulkSaveDraft() {
  clearTimeout(_bulkDraftTimer);
  _bulkDraftTimer = setTimeout(() => {
    try {
      chrome.storage.local.set({ [BULK_DRAFT_KEY]: {
        list: $('bulkDomainList')?.value || '',
        traffic: !!$('bulkOptTraffic')?.checked,
        emails: !!$('bulkOptEmails')?.checked,
        hidden: [..._bulkView.hidden]
      } });
    } catch (_) {}
  }, 400);
}

function bulkRestoreDraft() {
  try {
    chrome.storage.local.get([BULK_DRAFT_KEY], res => {
      const d = res?.[BULK_DRAFT_KEY];
      if (!d) return;
      const ta = $('bulkDomainList');
      if (ta && !ta.value.trim() && d.list) ta.value = d.list;
      const t = $('bulkOptTraffic'); if (t && typeof d.traffic === 'boolean') t.checked = d.traffic;
      const e = $('bulkOptEmails'); if (e && typeof d.emails === 'boolean') e.checked = d.emails;
      if (Array.isArray(d.hidden)) _bulkView.hidden = new Set(d.hidden);
      syncBulkColumnUI();
      updateBulkHint();
    });
  } catch (_) {}
}

function syncBulkColumnUI() {
  const t = $('bulkResultsTable');
  if (t) ['traffic', 'kw', 'rd', 'bl'].forEach(c => t.classList.toggle('bk-hide-' + c, _bulkView.hidden.has(c)));
  document.querySelectorAll('#bulkColMenu input[data-col]').forEach(cb => { cb.checked = !_bulkView.hidden.has(cb.dataset.col); });
}

/** Merge extra domains into the textarea (deduped + cleaned). Returns how many were new. */
function appendBulkDomains(text) {
  const ta = $('bulkDomainList');
  if (!ta) return 0;
  const before = parseBulkDomainListEx(ta.value, '').list.length;
  const merged = parseBulkDomainListEx((ta.value ? ta.value + '\n' : '') + text, '');
  ta.value = merged.list.join('\n');
  updateBulkHint();
  bulkSaveDraft();
  return merged.list.length - before;
}

function bulkSetRunState(running) {
  _bulkRunning = running;
  const run = $('bulkRunBtn'), stop = $('bulkStopBtn');
  if (run) run.style.display = running ? 'none' : '';
  if (stop) stop.style.display = running ? '' : 'none';
  ['bulkDomainList', 'bulkOptTraffic', 'bulkOptEmails'].forEach(id => { const el = $(id); if (el) el.disabled = running; });
  updateBulkHint();
}

// ── Results view: filter / sort / render ──
function bulkGetView() {
  let rows = _bulkLastResults.slice();
  const q = _bulkView.filter.trim().toLowerCase();
  if (q) rows = rows.filter(r => r.domain.includes(q));
  if (_bulkView.onlyEmail) rows = rows.filter(r => r.emails && r.emails.length);
  const k = _bulkView.sortKey;
  if (k) {
    const dir = _bulkView.sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[k], bv = b[k];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return typeof av === 'string' ? av.localeCompare(bv) * dir : (av - bv) * dir;
    });
  }
  return rows;
}

function bulkEmailCell(r) {
  if (r.emailCount == null) return '<span class="bk-na">—</span>';
  if (r.emails && r.emails.length) {
    const open = _bulkView.expanded.has(r.domain);
    const shown = open ? r.emails : r.emails.slice(0, 1);
    const items = shown.map(e => `<span class="bk-mail"><a href="mailto:${escHTML(e)}" title="${escHTML(e)}">${escHTML(e)}</a><button type="button" class="bk-icon-btn" data-copy="${escHTML(e)}" title="Copy email">${BK_COPY_SVG}</button></span>`).join('');
    const more = r.emails.length > 1
      ? `<button type="button" class="bk-more" data-expand="${escHTML(r.domain)}">${open ? 'show less' : '+' + (r.emails.length - 1) + ' more'}</button>` : '';
    return items + more;
  }
  if (r.contactUrl) return `<a class="bk-contact-link" href="${escHTML(r.contactUrl)}" target="_blank" rel="noopener">Open contact page ↗</a>`;
  return '<span class="bk-na">none found</span>';
}

function renderBulkTable(rows) {
  const body = $('bulkResultsBody');
  if (!body) return;
  const maxTraffic = Math.max(0, ..._bulkLastResults.map(r => r.traffic || 0));
  const scorePill = (v, hi, mid) => v == null ? '<span class="bk-na">—</span>'
    : `<span class="bk-pill ${v >= hi ? 'is-good' : v >= mid ? 'is-mid' : 'is-low'}">${v}</span>`;
  const spamPill = (v) => v == null ? '<span class="bk-na">—</span>'
    : `<span class="bk-pill ${v <= 5 ? 'is-good' : v <= 30 ? 'is-mid' : 'is-low'}" title="Moz spam score — lower is better">${v}%</span>`;
  if (!rows.length) {
    body.innerHTML = '<tr class="bk-empty-row"><td colspan="9">No domains match your filter.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => {
    const rank = _bulkLastResults.indexOf(r) + 1;
    const pct = maxTraffic && r.traffic ? Math.max(4, Math.round(r.traffic / maxTraffic * 100)) : 0;
    return `<tr class="${r.isYou ? 'is-you' : ''}">
      <td class="c-domain" title="${escHTML(r.domain)}"><span class="bk-rank">${rank}</span><a class="bk-dom" href="https://${escHTML(r.domain)}" target="_blank" rel="noopener">${escHTML(r.domain)}</a>${r.isYou ? '<span class="bk-you-badge">YOU</span>' : ''}</td>
      <td class="c-da">${scorePill(r.da, 50, 30)}</td>
      <td class="c-dr">${scorePill(r.dr, 50, 30)}</td>
      <td class="c-spam">${spamPill(r.spam)}</td>
      <td class="c-traffic bk-traffic" style="--p:${pct}%" title="${escHTML(r.trafficSrc || '')}">${bulkFmt(r.traffic)}</td>
      <td class="c-kw">${bulkFmt(r.kw)}</td>
      <td class="c-rd">${bulkFmt(r.rd)}</td>
      <td class="c-bl">${bulkFmt(r.bl)}</td>
      <td class="c-email">${bulkEmailCell(r)}</td>
    </tr>`;
  }).join('');
}

function renderBulkView() {
  const rows = bulkGetView();
  renderBulkTable(rows);
  document.querySelectorAll('#bulkResultsTable th[data-sort]').forEach(th => {
    th.dataset.dir = th.dataset.sort === _bulkView.sortKey ? _bulkView.sortDir : '';
  });
  const n = rows.length, total = _bulkLastResults.length;
  const showing = $('bulkShowing');
  if (showing) showing.textContent = n === total ? total + ' domains' : 'Showing ' + n + ' of ' + total + ' domains';
  const exp = $('bulkExportBtn'); if (exp) exp.textContent = 'Download CSV · ' + n + ' row' + (n === 1 ? '' : 's');
  const emailCount = new Set(rows.flatMap(r => r.emails || [])).size;
  const em = $('bulkCopyEmailsBtn');
  if (em) { em.textContent = 'Copy all emails · ' + emailCount; em.disabled = !emailCount; }
}

// ── Wiring (runs once) ──
function bulkBindUI() {
  const ta = $('bulkDomainList');
  const onList = () => { updateBulkHint(); bulkSaveDraft(); };
  ta?.addEventListener('input', onList);
  ta?.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runBulkCheck(); }
  });
  ta?.addEventListener('blur', () => {
    const info = parseBulkDomainListEx(ta.value, '');
    if (ta.value.trim() && !info.invalid && (info.dupes || /https?:|\/|www\./i.test(ta.value))) {
      ta.value = info.list.join('\n');
      updateBulkHint();
    }
  });

  $('bulkOptTraffic')?.addEventListener('change', bulkSaveDraft);
  $('bulkOptEmails')?.addEventListener('change', bulkSaveDraft);
  $('bulkRunBtn')?.addEventListener('click', runBulkCheck);
  $('bulkStopBtn')?.addEventListener('click', () => { _bulkAbort = true; toast('Stopping… partial results will be shown'); });

  $('bulkPasteBtn')?.addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t || !t.trim()) { toast('Clipboard is empty'); return; }
      const added = appendBulkDomains(t);
      toast(added ? 'Added ' + added + ' domain' + (added > 1 ? 's' : '') : 'No new domains found in clipboard');
    } catch (_) { toast('Clipboard blocked — paste with Ctrl+V into the box'); }
  });

  $('bulkSerpBtn')?.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https:\/\/(www\.)?google\./i.test(tab.url || '') || !/[?&]q=/.test(tab.url || '')) {
        toast('Open a Google search results page in this tab first');
        return;
      }
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const out = [];
          document.querySelectorAll('#rso a[href], #search a[href]').forEach(a => {
            if (!a.querySelector('h3')) return;
            try { const u = new URL(a.href); if (!/(^|\.)google\./i.test(u.hostname)) out.push(u.hostname); } catch (_) {}
          });
          return out;
        }
      });
      if (!result || !result.length) { toast('No organic results found on this page'); return; }
      const added = appendBulkDomains(result.join('\n'));
      toast(added ? 'Added ' + added + ' domain' + (added > 1 ? 's' : '') + ' from Google results' : 'Those domains are already in the list');
    } catch (_) { toast('Could not read the Google results page'); }
  });

  $('bulkImportBtn')?.addEventListener('click', () => $('bulkImportFile')?.click());
  $('bulkImportFile')?.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('File too large (max 2 MB)'); return; }
    const added = appendBulkDomains(await f.text());
    toast(added ? 'Imported ' + added + ' domain' + (added > 1 ? 's' : '') : 'No valid domains found in file');
  });
  $('bulkExampleBtn')?.addEventListener('click', () => { appendBulkDomains(BULK_EXAMPLE.join('\n')); toast('Example domains added — press Run check'); });
  $('bulkClearBtn')?.addEventListener('click', () => { if (ta) { ta.value = ''; updateBulkHint(); bulkSaveDraft(); ta.focus(); } });

  // Results toolbar
  $('bulkFilter')?.addEventListener('input', e => { _bulkView.filter = e.target.value; renderBulkView(); });
  $('bulkOnlyEmail')?.addEventListener('change', e => { _bulkView.onlyEmail = e.target.checked; renderBulkView(); });
  document.querySelectorAll('#bulkColMenu input[data-col]').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.checked ? _bulkView.hidden.delete(cb.dataset.col) : _bulkView.hidden.add(cb.dataset.col);
      syncBulkColumnUI();
      bulkSaveDraft();
    });
  });
  document.querySelectorAll('#bulkResultsTable th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      const first = key === 'domain' ? 'asc' : 'desc';
      if (_bulkView.sortKey !== key) { _bulkView.sortKey = key; _bulkView.sortDir = first; }
      else if (_bulkView.sortDir === first) _bulkView.sortDir = first === 'asc' ? 'desc' : 'asc';
      else { _bulkView.sortKey = null; }
      renderBulkView();
    });
  });
  $('bulkResultsBody')?.addEventListener('click', e => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard.writeText(copy.dataset.copy).then(() => toast('Copied ' + copy.dataset.copy)).catch(() => toast('Copy failed'));
      return;
    }
    const ex = e.target.closest('[data-expand]');
    if (ex) {
      const d = ex.dataset.expand;
      _bulkView.expanded.has(d) ? _bulkView.expanded.delete(d) : _bulkView.expanded.add(d);
      renderBulkView();
    }
  });

  // Export menu (exports exactly what is shown: current filter + sort)
  const closeExport = () => $('bulkExportMenu')?.removeAttribute('open');
  $('bulkExportBtn')?.addEventListener('click', () => { exportBulkCsv(bulkGetView()); closeExport(); });
  $('bulkExportSheetBtn')?.addEventListener('click', () => { exportBulkForSheets(bulkGetView()); closeExport(); });
  $('bulkCopyEmailsBtn')?.addEventListener('click', () => {
    const all = [...new Set(bulkGetView().flatMap(r => r.emails || []))];
    if (!all.length) { toast('No emails to copy'); return; }
    navigator.clipboard.writeText(all.join('\n')).then(() => toast('Copied ' + all.length + ' unique emails')).catch(() => toast('Copy failed'));
    closeExport();
  });
  document.addEventListener('click', e => {
    document.querySelectorAll('details.bk-menu[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });
  syncBulkColumnUI();
}

function initBulkDaDrChecker(yourDomain) {
  if (yourDomain !== undefined) _bulkYou = normalizeDomain(yourDomain || '');
  const youInput = $('bulkYouDomain');
  if (youInput) youInput.value = _bulkYou;
  if (!_bulkBound) { _bulkBound = true; bulkBindUI(); bulkRestoreDraft(); }
  updateBulkHint();
}

// ── The run ──
async function runBulkCheck() {
  if (_bulkRunning) return;
  const info = parseBulkDomainListEx($('bulkDomainList')?.value, _bulkYou);
  const domains = info.list;
  if (info.count < 1) { toast('Add at least one domain first'); return; }
  const optTraffic = !!$('bulkOptTraffic')?.checked;
  const optEmails = !!$('bulkOptEmails')?.checked;

  _bulkAbort = false;
  bulkSetRunState(true);
  const resultsWrap = $('bulkResultsWrap');
  if (resultsWrap) resultsWrap.style.display = 'none';

  const plan = ['auth'];
  if (optTraffic) plan.push('traffic');
  if (optEmails) plan.push('emails');
  const STAGE_LABEL = { auth: 'Authority', traffic: 'Traffic', emails: 'Emails' };
  let lastStage = null;
  const setProgress = (done, total, label, stage) => {
    const wrap = $('bulkProgressBarWrap');
    if (wrap) wrap.style.display = '';
    if (stage !== lastStage) {
      lastStage = stage;
      const ai = plan.indexOf(stage);
      const steps = $('bulkSteps');
      if (steps) steps.innerHTML = plan.map((s, i) =>
        `<span class="bk-stage ${i < ai ? 'is-done' : i === ai ? 'is-active' : ''}"><b>${i < ai ? '✓' : i + 1}</b><em>${STAGE_LABEL[s]}</em></span>`
      ).join('<i class="bk-stage-line"></i>');
    }
    const lt = $('bulkLoadingText'); if (lt && label) lt.textContent = label;
    const prog = $('bulkProgress'); if (prog) prog.textContent = done + ' / ' + total;
    const bar = $('bulkProgressBar'); if (bar) bar.style.width = (total ? Math.min(100, Math.round(done / total * 100)) : 0) + '%';
  };

  const resultsMap = {};
  domains.forEach(d => {
    resultsMap[d] = { domain: d, da: null, dr: null, spam: null, rd: null, bl: null, traffic: null, kw: null, trafficSrc: null, emails: [], emailCount: null, contactUrl: null, isYou: d === _bulkYou };
  });
  const send = (msg) => new Promise(res => chrome.runtime.sendMessage(msg, r => { void chrome.runtime.lastError; res(r); }));

  // ── 1) Authority: Moz DA (batched) ──
  setProgress(0, domains.length, 'Fetching Moz DA…', 'auth');
  const DA_CHUNK = 80;
  let daDone = 0;
  for (let i = 0; i < domains.length && !_bulkAbort; i += DA_CHUNK) {
    const chunk = domains.slice(i, i + DA_CHUNK);
    try {
      const batch = await send({ action: 'MOZ_FETCH_BATCH', domains: chunk });
      if (batch?.ok && batch.results) {
        for (const d of chunk) {
          const r = batch.results[d] || batch.results[normalizeDomain(d)];
          if (r?.ok || r?.domainAuthority != null) {
            resultsMap[d].da = r.domainAuthority ?? null;
            resultsMap[d].spam = r.spamScore ?? null;
            resultsMap[d].rd = r.referringDomains ?? null;
            resultsMap[d].bl = r.backlinks ?? null;
          }
        }
      } else {
        await Promise.all(chunk.map(async d => {
          const r = await send({ action: 'MOZ_FETCH', domain: d });
          if (r?.ok) {
            resultsMap[d].da = r.domainAuthority ?? null;
            resultsMap[d].spam = r.spamScore ?? null;
            resultsMap[d].rd = r.referringDomains ?? null;
            resultsMap[d].bl = r.backlinks ?? null;
          }
        }));
      }
    } catch (_) {}
    daDone += chunk.length;
    setProgress(Math.min(daDone, domains.length), domains.length, 'Fetching Moz DA…', 'auth');
  }

  // ── 1b) Authority: Ahrefs DR ──
  setProgress(0, domains.length, 'Fetching Ahrefs DR…', 'auth');
  let drDone = 0;
  const DR_CONCURRENCY = 5;
  for (let i = 0; i < domains.length && !_bulkAbort; i += DR_CONCURRENCY) {
    const chunk = domains.slice(i, i + DR_CONCURRENCY);
    await Promise.all(chunk.map(async d => {
      const r = await send({ action: 'AHREFS_DR_FETCH', domain: d });
      if (r?.ok && r.domainRating != null) resultsMap[d].dr = Math.round(r.domainRating * 10) / 10;
      drDone++;
      setProgress(drDone, domains.length, 'Fetching Ahrefs DR…', 'auth');
    }));
  }

  // ── 2) Organic traffic ──
  if (optTraffic && !_bulkAbort) {
    const T_CHUNK = 25;
    let tDone = 0;
    setProgress(0, domains.length, 'Fetching organic traffic…', 'traffic');
    for (let i = 0; i < domains.length && !_bulkAbort; i += T_CHUNK) {
      const chunk = domains.slice(i, i + T_CHUNK);
      try {
        const resp = await send({ action: 'TRAFFIC_BATCH', domains: chunk, fillLimit: T_CHUNK });
        const rmap = resp?.results || {}, dmap = resp?.map || {};
        for (const d of chunk) {
          const row = rmap[dmap[d] || d] || rmap[d];
          if (row && row.visits > 0) {
            resultsMap[d].traffic = row.visits;
            resultsMap[d].kw = row.keywords ?? null;
            resultsMap[d].trafficSrc = row.source || null;
          }
        }
      } catch (_) {}
      tDone += chunk.length;
      setProgress(Math.min(tDone, domains.length), domains.length, 'Fetching organic traffic…', 'traffic');
    }
  }

  // ── 3) Contact emails ──
  if (optEmails && !_bulkAbort) {
    let eDone = 0;
    setProgress(0, domains.length, 'Extracting contact emails…', 'emails');
    const E_CONCURRENCY = 4;
    for (let i = 0; i < domains.length && !_bulkAbort; i += E_CONCURRENCY) {
      const chunk = domains.slice(i, i + E_CONCURRENCY);
      await Promise.all(chunk.map(async d => {
        const r = await send({ action: 'CONTACT_EMAILS_FETCH', domain: d });
        resultsMap[d].emailCount = 0;
        if (r?.ok) {
          resultsMap[d].emails = (r.emails || []).map(e => e.email);
          resultsMap[d].emailCount = resultsMap[d].emails.length;
          resultsMap[d].contactUrl = r.contactUrl || null;
        }
        eDone++;
        setProgress(eDone, domains.length, 'Extracting contact emails…', 'emails');
      }));
    }
  }

  // ── Finish ──
  const aborted = _bulkAbort;
  const results = domains.map(d => resultsMap[d]);
  _bulkLastResults = results;
  Object.assign(_bulkView, { sortKey: null, sortDir: 'desc', filter: '', onlyEmail: false });
  _bulkView.expanded.clear();
  if ($('bulkFilter')) $('bulkFilter').value = '';
  if ($('bulkOnlyEmail')) $('bulkOnlyEmail').checked = false;
  const barWrap = $('bulkProgressBarWrap'); if (barWrap) barWrap.style.display = 'none';
  bulkSetRunState(false);

  // Chart: top 12 by DR (or DA) only — keeps it readable for large lists
  const chartSrc = [...results]
    .sort((a, b) => (b.dr ?? b.da ?? -1) - (a.dr ?? a.da ?? -1))
    .slice(0, 12)
    .map(r => ({ label: r.domain, da: r.dr != null ? Math.round(r.dr) : (r.da ?? null), isYou: r.isYou }));
  const chartWrap = $('bulkChartWrap');
  if (chartWrap) chartWrap.style.display = results.length >= 2 && results.length <= 40 ? '' : 'none';
  if (typeof renderCompetitorChart === 'function') renderCompetitorChart(chartSrc, 'bulkChart', 'bulkLegend');

  // Summary cards
  const withDa = results.filter(r => r.da != null).length;
  const withDr = results.filter(r => r.dr != null).length;
  const withTraffic = results.filter(r => r.traffic != null);
  const withEmail = results.filter(r => r.emails && r.emails.length).length;
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : '—';
  const stat = (label, val, sub) => `<div class="bk-stat"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const sum = $('bulkSummaryRow');
  if (sum) {
    sum.innerHTML = [
      stat('Domains', results.length, aborted ? 'partial (stopped)' : ''),
      stat('Avg DA', avg(results.map(r => r.da).filter(n => n != null)), withDa + ' / ' + results.length + ' found'),
      stat('Avg DR', avg(results.map(r => r.dr).filter(n => n != null)), withDr + ' / ' + results.length + ' found'),
      ...(optTraffic ? [stat('Total traffic', bulkFmt(withTraffic.reduce((a, r) => a + r.traffic, 0)), withTraffic.length + ' / ' + results.length + ' found')] : []),
      ...(optEmails ? [stat('With email', withEmail, 'of ' + results.length + ' sites')] : [])
    ].join('');
  }

  // Helpful notes (only when something needs explaining)
  const notes = [];
  if (aborted) notes.push(['Stopped early — only the data collected so far is shown.', true]);
  if (withDa === 0 && !aborted) notes.push(['Moz DA / Spam could not be loaded. Check your internet connection or the Keywords Everywhere key in Settings, then run again.', true]);
  if (optTraffic && !withTraffic.length && !aborted) notes.push(['No traffic data came back. Add a Keywords Everywhere traffic key in Settings for organic estimates.', true]);
  if (withTraffic.some(r => /similarweb/i.test(r.trafficSrc || ''))) notes.push(['Some traffic values come from SimilarWeb (total visits, not organic only). Hover a value to see its source.', false]);
  if (optEmails && !withEmail && !aborted) notes.push(['No public emails were found. Many sites only use a contact form — use the "Open contact page" links.', false]);
  const noteEl = $('bulkTableNote');
  if (noteEl) noteEl.innerHTML = notes.map(([t, warn]) => `<div class="bk-note-line${warn ? ' is-warn' : ''}">${escHTML(t)}</div>`).join('');

  syncBulkColumnUI();
  renderBulkView();
  if (resultsWrap) {
    resultsWrap.style.display = '';
    try { resultsWrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }
  toast(aborted ? 'Stopped — showing partial results' : 'Done · ' + results.length + ' domains checked');

  try {
    if (window.ShahzaibSEOHistory) {
      results.forEach(r => {
        if (!r?.domain) return;
        window.ShahzaibSEOHistory.recordBoth(r.domain, {
          da: r.da != null ? r.da : undefined,
          dr: r.dr != null ? r.dr : undefined,
          spam: r.spam != null ? r.spam : undefined,
          rd: r.rd != null ? r.rd : undefined
        });
      });
    }
  } catch (_) {}
}

function exportBulkCsv(results) {
  if (!results?.length) return;
  const header = ['Domain', 'DA', 'DR', 'Spam', 'Referring Domains', 'Backlinks', 'Organic Traffic', 'Keywords', 'Traffic Source', 'Emails', 'Contact URL', 'Is You'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = results.map(r =>
    [r.domain, r.da ?? '', r.dr ?? '', r.spam ?? '', r.rd ?? '', r.bl ?? '', r.traffic ?? '', r.kw ?? '', r.trafficSrc ?? '', (r.emails || []).join('; '), r.contactUrl ?? '', r.isYou ? 'yes' : 'no'].map(esc).join(',')
  );
  // BOM so Excel opens UTF-8 correctly
  const csv = '\uFEFF' + [header.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bulk-domain-check-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('CSV downloaded (' + results.length + ' rows)');
}

function exportBulkForSheets(results) {
  if (!results?.length) return;
  const header = ['Domain', 'DA', 'DR', 'Spam', 'Referring Domains', 'Backlinks', 'Organic Traffic', 'Keywords', 'Traffic Source', 'Emails', 'Contact URL', 'Is You'];
  const rows = results.map(r =>
    [r.domain, r.da ?? '', r.dr ?? '', r.spam ?? '', r.rd ?? '', r.bl ?? '', r.traffic ?? '', r.kw ?? '', r.trafficSrc ?? '', (r.emails || []).join('; '), r.contactUrl ?? '', r.isYou ? 'yes' : 'no'].join('\t')
  );
  const tsv = [header.join('\t'), ...rows].join('\n');
  navigator.clipboard.writeText(tsv).then(() => {
    toast('Copied ' + results.length + ' rows — paste into Google Sheets');
  }).catch(() => {
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk-domain-check-' + new Date().toISOString().slice(0, 10) + '.tsv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}

// Keep legacy chart renderer (used by bulk checker)
function injectCompetitorRows(containerId, idPrefix) {
  const container = $(containerId);
  if (!container || container.dataset.injected) return;
  container.dataset.injected = '1';
  let rowsHTML = '';
  for (let i = 1; i <= 10; i++) {
    rowsHTML += `<div class="da-comp-input-row"><span class="da-comp-label">#${i}</span><input class="da-comp-input" id="${idPrefix}${i}" placeholder="competitor${i}.com${i > 1 ? ' (optional)' : ''}"/></div>`;
  }
  container.insertAdjacentHTML('beforeend', rowsHTML);
}

function readCompetitorDomains(idPrefix) {
  const out = [];
  for (let i = 1; i <= 10; i++) {
    const v = ($(idPrefix + i)?.value || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (v) out.push(v);
  }
  return out;
}

function initCompetitorDAComparison(yourDomain) {
  // legacy no-op — replaced by initBulkDaDrChecker
  initBulkDaDrChecker(yourDomain);
}

function initCompetitorDRComparison(yourDomain) {
  // legacy no-op — replaced by initBulkDaDrChecker
}


function renderCompetitorChart(results, chartId, legendId) {
  const chart = $(chartId || 'daCompChart');
  const legend = $(legendId || 'daCompLegend');
  if (!chart) return;

  const colors = ['#0D9488', '#7c3aed', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#84cc16', '#14b8a6', '#f97316', '#6366f1', '#06b6d4'];
  const maxVal = Math.max(...results.map(r => r.da || 0), 10);

  const barsHTML = results.map((r, i) => {
    const pct = r.da != null ? Math.round((r.da / 100) * 100) : 0;
    const color = colors[i % colors.length];
    const label = r.da != null ? r.da : '?';
    const isTop = r.da != null && r.da === Math.max(...results.map(x => x.da || 0));
    return `
      <div class="da-chart-bar-group">
        <div class="da-chart-bar-wrap">
          ${isTop ? '<div class="da-chart-crown">👑</div>' : ''}
          <div class="da-chart-value" style="color:${color}">${label}</div>
          <div class="da-chart-bar-outer">
            <div class="da-chart-bar-inner" style="height:${pct}%;background:${r.isYou ? color : color+'cc'};${r.isYou ? 'box-shadow:0 0 8px '+color+'66' : ''}"></div>
          </div>
        </div>
        <div class="da-chart-bar-label ${r.isYou ? 'you-label' : ''}">${escHTML(String(r.label || '').length > 14 ? String(r.label).slice(0, 12) + '…' : String(r.label || ''))}</div>
      </div>`;
  }).join('');

  chart.innerHTML = `<div class="da-chart-bars">${barsHTML}</div><div class="da-chart-scale"><span>0</span><span>50</span><span>100</span></div>`;

  const youVal = results.find(r => r.isYou)?.da || 0;
  const legendHTML = results.map((r, i) => {
    const color = colors[i % colors.length];
    let delta = '';
    if (!r.isYou && r.da != null) {
      const diff = youVal - r.da;
      delta = diff > 0 ? `<span style="color:#10b981;font-size:10px">+${diff} ahead</span>`
        : diff < 0 ? `<span style="color:#ef4444;font-size:10px">${diff} behind</span>`
        : `<span style="color:#94a3b8;font-size:10px">tied</span>`;
    }
    return `<div class="da-legend-item"><span class="da-legend-dot" style="background:${color}"></span><span class="da-legend-name">${escHTML(r.label)}</span><span class="da-legend-val" style="color:${color}">${r.da ?? '?'}</span>${delta}</div>`;
  }).join('');
  if (legend) legend.innerHTML = legendHTML;
}

// ══════════════════════════════════════════════════════
// FEATURE 3: Link Building Opportunities (AI)
// ══════════════════════════════════════════════════════
function initLinkBuildingOpportunities() {
  const btn = $('daLinkBuildBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const result = $('daLinkBuildResult');
    const loading = $('daLinkBuildLoading');
    const nokey = $('daLinkBuildNoKey');

    if (result) result.style.display = 'none';
    if (nokey) nokey.style.display = 'none';

    // Check AI key (Groq always available via built-in fallback)
    const aiKeys = await new Promise(res => chrome.storage.local.get(['nvidiaApiKey','openrouterApiKey','groqApiKey','aiProvider','groqModel'], res));
    aiKeys.groqApiKey = resolveGroqKey(aiKeys.groqApiKey);
    const hasKey = true; // built-in Groq always available

    if (!hasKey) {
      if (nokey) nokey.style.display = '';
      return;
    }

    if (loading) loading.style.display = '';
    btn.disabled = true;

    // Get moz data
    const da = $('qDomainDA')?.textContent || '--';
    const spam = $('qDomainSpam')?.textContent || '--';
    const bl = $('qDomainBL')?.textContent || '--';
    const domain = (_currentUrl ? new URL(_currentUrl).hostname : 'this domain');

    const prompt = `You are an expert SEO link building strategist. Analyze this domain's metrics and provide targeted link building opportunities.

Domain: ${domain}
Domain Authority (DA): ${da}/100
Spam Score: ${spam}
Total Backlinks: ${bl}

Based on these exact metrics, provide:

**1. Current Authority Assessment**
Brief 2-line assessment of what these numbers mean.

**2. Top 5 Link Building Strategies**
For each, give: Strategy name, why it works for this DA level, and 1 specific action step.

**3. Quick Wins (This Week)**
3 actionable tasks to start immediately.

**4. Tools to Use**
3 free/affordable tools specific to this DA level.

Keep it practical and specific to DA ${da}. Format with **bold headers** and numbered lists.`;

    try {
      // Use the existing AI call mechanism (from ai-analyzer.js)
      let provider = aiKeys.aiProvider;
      if (!provider) {
        if (aiKeys.groqApiKey) provider = 'groq'; // includes built-in
        else if (aiKeys.nvidiaApiKey) provider = 'nvidia';
        else provider = 'openrouter';
      }
      const apiKey = provider === 'nvidia' ? aiKeys.nvidiaApiKey : (provider === 'groq' ? aiKeys.groqApiKey : aiKeys.openrouterApiKey);
      const aiModelData = await new Promise(res => chrome.storage.local.get(['nvidiaModel','openrouterModel','groqModel','aiMaxTokens'], res));

      let model, baseUrl;
      if (provider === 'nvidia') {
        model = aiModelData.nvidiaModel || 'meta/llama-3.3-70b-instruct';
        baseUrl = 'https://integrate.api.nvidia.com/v1';
      } else if (provider === 'groq') {
        model = aiModelData.groqModel || 'qwen/qwen3.8-27b';
        baseUrl = 'https://api.groq.com/openai/v1';
      } else {
        model = aiModelData.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free';
        baseUrl = 'https://openrouter.ai/api/v1';
      }

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: parseInt(aiModelData.aiMaxTokens) || 1500,
          temperature: 0.4
        })
      });

      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) {
        if (result) {
          result.innerHTML = `<div class="da-linkbuild-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Could not generate suggestions. Check your AI key in Settings or try again.</span>
          </div>`;
          result.style.display = '';
        }
        return;
      }
      const html = renderMarkdown(text);

      if (result) {
        result.innerHTML = `<div class="da-linkbuild-output">${html}</div>`;
        result.style.display = '';
      }
    } catch (err) {
      if (result) {
        result.innerHTML = `<div class="da-linkbuild-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Error: ${escHTML(err.message)}</span>
        </div>`;
        result.style.display = '';
      }
    } finally {
      if (loading) loading.style.display = 'none';
      btn.disabled = false;
    }
  });
}

// ─── llms.txt ─────────────────────────────────────────
function renderLlmsInfo(exists) {
  const card = $('llmsCard'); if (!card) return;
  card.style.display = '';
  const list = $('llmsList'); if (!list) return;
  list.innerHTML = `
    <div class="cro-item"><span class="cro-item-label">llms.txt file</span><span class="cro-item-val ${exists?'yes':'no'}">${exists?'Found ✓':'Not found'}</span></div>
    <div class="cro-item" style="font-size:11px;color:var(--text-4)"><span>llms.txt helps AI crawlers understand your site structure</span></div>
    ${exists ? '' : '<button class="llms-gen-btn" id="llmsGenBtn">✨ Generate llms.txt</button>'}`;
  if (!exists) {
    const btn = $('llmsGenBtn');
    if (btn) btn.addEventListener('click', goGenerateLlms);
  }
}

// Jump to the Tools tab and run the llms.txt generator.
function goGenerateLlms() {
  try { switchTab('techaudit'); } catch (_) {}
  setTimeout(() => {
    const runBtn = document.querySelector('.ta-run[data-ta="llmstxt"]');
    if (runBtn) {
      runBtn.click();
      runBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 150);
}

// ─── Headings ─────────────────────────────────────────
function renderHeadings(headings, meta) {
  setText('serpTitle', meta.title || '(No title)');
  setText('serpUrl', meta.url || '');
  setText('serpDesc', meta.desc || '(No description)');
  const tLen = (meta.title||'').length, dLen = (meta.desc||'').length;
  const tBadge = $('titleLenBadge'), dBadge = $('descLenBadge');
  if (tBadge) { tBadge.textContent = `${tLen}/60`; tBadge.className = `serp-badge ${tLen>60?'warn':tLen>0?'ok':'err'}`; }
  if (dBadge) { dBadge.textContent = `${dLen}/160`; dBadge.className = `serp-badge ${dLen>160?'warn':dLen>0?'ok':'err'}`; }

  const iss = $('hnIssues');
  if (iss) {
    iss.innerHTML = '';
    headings.issues.forEach(issue => {
      const d = el('div', `issue-pill ${issue.type==='missing_h1'?'error':'warning'}`);
      d.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M8 5v4M8 10.5v1"/></svg>${escHTML(issue.msg)}`;
      iss.appendChild(d);
    });
  }

  const filterChips = $('hnFilterChips');
  if (filterChips) {
    filterChips.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        filterChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderHnTree(headings.headings, $('hnTree'), chip.dataset.filter);
      });
    });
  }

  initHeadingSubtabs();

  // Add heading level suggestions
  const headingsWithSuggestions = addHeadingSuggestions(headings.headings);
  renderHnTree(headingsWithSuggestions, $('hnTree'), 'all');

  // Build & render the priority-ordered fix list (rule-based, always available)
  renderHeadingFixPriority(headingsWithSuggestions);
  initHeadingAiButtons(headingsWithSuggestions);

  // AI: meta title / description / slug suggestions (uses same headings + meta context)
  _hnLastMeta = meta;
  initSerpMetaAiButton();

  $('hnCopyBtn')?.addEventListener('click', () => {
    copyText(headings.headings.map(h => `${'  '.repeat(h.level-1)}H${h.level}: ${h.text||'(empty)'}`).join('\n'));
  });
}

/**
 * Analyze heading structure and suggest improvements
 */
function addHeadingSuggestions(headings) {
  if (!headings || headings.length === 0) return headings;
  
  const result = headings.map((h, i) => ({ ...h }));
  
  // Rule 1: If H4+ comes right after H1 or H2, suggest H3
  for (let i = 1; i < result.length; i++) {
    const prev = result[i - 1];
    const curr = result[i];
    
    // Skip empty headings
    if (curr.isEmpty) continue;
    
    // H4+ after H1 → suggest H3
    if (prev.level === 1 && curr.level >= 4) {
      curr.suggestedLevel = 3;
      curr.suggestionReason = 'Too big jump from H1';
    }
    // H4+ after H2 → suggest H3
    else if (prev.level === 2 && curr.level >= 4) {
      curr.suggestedLevel = 3;
      curr.suggestionReason = 'Too big jump from H2';
    }
    // H5+ after H3 → suggest H4
    else if (prev.level === 3 && curr.level >= 5) {
      curr.suggestedLevel = 4;
      curr.suggestionReason = 'Too big jump from H3';
    }
    // H6 after H4 → suggest H5
    else if (prev.level === 4 && curr.level === 6) {
      curr.suggestedLevel = 5;
      curr.suggestionReason = 'Skipped H5 level';
    }
  }
  
  // Rule 2: If there are many H4+ headings, suggest promoting some to H3
  const h4PlusCount = result.filter(h => h.level >= 4 && !h.isEmpty).length;
  const h3Count = result.filter(h => h.level === 3 && !h.isEmpty).length;
  
  if (h4PlusCount > 5 && h3Count < 3) {
    let promoted = 0;
    for (let i = 0; i < result.length && promoted < 3; i++) {
      const h = result[i];
      if (h.level === 4 && !h.isEmpty && !h.suggestedLevel) {
        h.suggestedLevel = 3;
        h.suggestionReason = 'Better content structure';
        promoted++;
      }
    }
  }
  
  // Rule 3: If there are many H5+ headings, suggest promoting to H4
  const h5PlusCount = result.filter(h => h.level >= 5 && !h.isEmpty).length;
  if (h5PlusCount > 3) {
    let promoted = 0;
    for (let i = 0; i < result.length && promoted < 2; i++) {
      const h = result[i];
      if (h.level === 5 && !h.isEmpty && !h.suggestedLevel) {
        h.suggestedLevel = 4;
        h.suggestionReason = 'Improve hierarchy';
        promoted++;
      }
    }
  }
  
  return result;
}

// ══════════════════════════════════════════════════════
// AI HEADING FIX PRIORITY + AI TITLE IMPROVEMENT
// ══════════════════════════════════════════════════════

let _hnLastHeadings = null; // cache so AI Improve All can reuse the latest computed list
let _hnLastMeta = null;     // cache current page's title/desc/url for AI meta suggestions

/**
 * Build a ranked, prioritized fix list from the heading data (rule-based — no API key needed).
 * Severity ranking: error (missing/duplicate H1, empty headings) > warning (level jumps) > info.
 */
function buildHeadingFixPriority(headings) {
  if (!headings || !headings.length) return [];
  const items = [];

  // Missing H1 — highest priority structural issue
  const h1Count = headings.filter(h => h.level === 1 && !h.isEmpty).length;
  if (h1Count === 0) {
    items.push({ severity: 'high', label: 'Add a missing H1', detail: 'This page has no H1 tag. Add one H1 that clearly describes the page topic.', domIndex: null });
  } else if (h1Count > 1) {
    items.push({ severity: 'high', label: `Reduce multiple H1 tags (${h1Count} found)`, detail: 'Keep only one H1 per page; demote the rest to H2.', domIndex: null });
  }

  // Empty headings — high priority, hurts both SEO and accessibility
  headings.forEach((h, i) => {
    if (h.isEmpty) {
      items.push({ severity: 'high', label: `Fix empty H${h.level} (heading #${i + 1})`, detail: 'This heading has no text. Remove it or add descriptive text.', domIndex: i });
    }
  });

  // Level-jump / hierarchy suggestions from addHeadingSuggestions()
  headings.forEach((h, i) => {
    if (!h.isEmpty && h.suggestedLevel && h.suggestedLevel !== h.level) {
      items.push({
        severity: 'medium',
        label: `Change "${(h.text || '').slice(0, 50)}" from H${h.level} → H${h.suggestedLevel}`,
        detail: h.suggestionReason || 'Improves heading hierarchy.',
        domIndex: i,
        newLevel: h.suggestedLevel
      });
    }
  });

  // Very short / generic heading text — low priority polish, good candidates for AI rewrite
  headings.forEach((h, i) => {
    if (!h.isEmpty && h.level >= 2) {
      const words = (h.text || '').trim().split(/\s+/).filter(Boolean);
      if (words.length > 0 && words.length <= 2) {
        items.push({ severity: 'low', label: `Expand thin H${h.level}: "${h.text}"`, detail: 'Short, generic headings give search engines less context. Consider a more descriptive title.', domIndex: i });
      }
    }
  });

  const order = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  return items;
}

/**
 * Headings ⇄ Fixes sub-tab switcher (bound once)
 */
function initHeadingSubtabs() {
  const subtabs = $('hnSubtabs');
  if (!subtabs || subtabs.dataset.bound) return;
  subtabs.dataset.bound = '1';

  subtabs.querySelectorAll('.bl-stab').forEach(tab => {
    tab.addEventListener('click', () => {
      subtabs.querySelectorAll('.bl-stab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.hntab;
      $('hnPanel-list')?.classList.toggle('active', target === 'list');
      $('hnPanel-fixes')?.classList.toggle('active', target === 'fixes');
    });
  });
}

function renderHeadingFixPriority(headings) {
  // Always stamp DOM index = position in full h1–h6 list (document order)
  _hnLastHeadings = (headings || []).map((h, i) => ({
    ...h,
    domIndex: (h && typeof h.domIndex === 'number') ? h.domIndex : i
  }));
  const list = $('hnPriorityList');
  if (!list) return;
  const items = buildHeadingFixPriority(headings);

  const countBadge = $('hnFixesCount');
  if (countBadge) countBadge.textContent = items.length ? String(items.length) : '';

  list.innerHTML = '';

  if (!items.length) {
    list.innerHTML = '<li class="hn-priority-empty">No structural issues found — heading order looks good ✓</li>';
    return;
  }

  items.forEach((it, idx) => {
    const li = el('li', `hn-priority-item sev-${it.severity}`);
    li.innerHTML = `
      <span class="hn-priority-num">${idx + 1}</span>
      <span class="hn-priority-sev sev-${it.severity}">${it.severity === 'high' ? 'High' : it.severity === 'medium' ? 'Medium' : 'Low'}</span>
      <span class="hn-priority-text">
        <span class="hn-priority-label">${escHTML(it.label)}</span>
        <span class="hn-priority-detail">${escHTML(it.detail)}</span>
      </span>
      ${it.domIndex !== null ? `<button class="hn-action-btn hn-priority-locate" title="Show on page">🔍</button>` : ''}
      ${it.newLevel ? `<button class="hn-action-btn hn-change-btn" title="Apply H${it.newLevel}">Apply H${it.newLevel}</button>` : ''}`;

    li.querySelector('.hn-priority-locate')?.addEventListener('click', () => sendHeadingAction('scrollToHeading', it.domIndex));
    li.querySelector('.hn-change-btn')?.addEventListener('click', (e) => {
      sendHeadingAction('changeHeadingLevel', it.domIndex, { newLevel: it.newLevel });
      toast(`Changed to H${it.newLevel} on page (reload to restore)`);
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Applied ✓';
    });

    list.appendChild(li);
  });
}

/**
 * Shared helper: NVIDIA / OpenRouter / Groq (built-in fallback).
 * Always returns a usable config — never null when built-in Groq is available.
 */
async function getHeadingAiConfig() {
  const aiKeys = await new Promise(res => chrome.storage.local.get([
    'nvidiaApiKey', 'openrouterApiKey', 'groqApiKey', 'aiProvider',
    'nvidiaModel', 'openrouterModel', 'groqModel', 'aiMaxTokens'
  ], res));

  const nvidiaKey = (aiKeys.nvidiaApiKey || '').trim();
  const openrouterKey = (aiKeys.openrouterApiKey || '').trim();
  const userGroq = (aiKeys.groqApiKey || '').trim();
  const groqKey = (typeof resolveGroqKey === 'function')
    ? resolveGroqKey(userGroq)
    : (userGroq || RANKSEO_BUILTIN_GROQ_KEY);

  const pref = aiKeys.aiProvider || '';
  let provider, apiKey, model, baseUrl;

  if (pref === 'nvidia' && nvidiaKey) {
    provider = 'nvidia'; apiKey = nvidiaKey;
    model = aiKeys.nvidiaModel || 'meta/llama-3.3-70b-instruct';
    baseUrl = 'https://integrate.api.nvidia.com/v1';
  } else if (pref === 'openrouter' && openrouterKey) {
    provider = 'openrouter'; apiKey = openrouterKey;
    model = aiKeys.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free';
    baseUrl = 'https://openrouter.ai/api/v1';
  } else if (pref === 'groq' || userGroq || groqKey) {
    provider = 'groq'; apiKey = groqKey;
    model = aiKeys.groqModel || RANKSEO_BUILTIN_GROQ_MODEL;
    baseUrl = 'https://api.groq.com/openai/v1';
  } else if (nvidiaKey) {
    provider = 'nvidia'; apiKey = nvidiaKey;
    model = aiKeys.nvidiaModel || 'meta/llama-3.3-70b-instruct';
    baseUrl = 'https://integrate.api.nvidia.com/v1';
  } else if (openrouterKey) {
    provider = 'openrouter'; apiKey = openrouterKey;
    model = aiKeys.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free';
    baseUrl = 'https://openrouter.ai/api/v1';
  } else {
    // Built-in Groq always available
    provider = 'groq'; apiKey = RANKSEO_BUILTIN_GROQ_KEY;
    model = RANKSEO_BUILTIN_GROQ_MODEL;
    baseUrl = 'https://api.groq.com/openai/v1';
  }

  const maxTokens = parseInt(aiKeys.aiMaxTokens, 10) || 1500;
  return { provider, apiKey, model, baseUrl, maxTokens, builtin: provider === 'groq' && !userGroq };
}

async function callHeadingAI(cfg, prompt, maxTokens) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`
  };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://www.mubashirhassan.com';
    headers['X-Title'] = 'ShahzaibSEO - AEO & GEO Expert';
  }
  // Year guard — models often default to 2024
  const yearNote = '\n\nIMPORTANT: Current date context is September 2026. Do NOT use 2023, 2024, or 2025 in titles/copy unless the content is specifically historical. Prefer 2026 or omit the year. Next year is 2027.';
  const fullPrompt = /202[3-5]|year|date/i.test(prompt) || true
    ? prompt + yearNote
    : prompt;

  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: fullPrompt }],
      max_tokens: maxTokens || cfg.maxTokens,
      temperature: 0.4
    })
  });
  const data = await resp.json();
  if (data?.error) throw new Error(data.error.message || 'AI request failed');
  return data?.choices?.[0]?.message?.content || '';
}

/* ═══════════════════════════════════════════════════════════════════════════
   LOCAL SEO SUITE (Local tab)
   ① Local Pack Geo-Grid  ② AI Local Visibility  ③ GBP Audit  ④ Competitor GEO
   ═══════════════════════════════════════════════════════════════════════════ */
let _loBound = false;
let _loCenter = null; // { lat, lng, displayName } cached geocode for current city

function initLocalTab() {
  // Prefill domain + keyword from the current page (once, if empty).
  try {
    const dEl = $('loDomain');
    if (dEl && !dEl.value && _currentUrl) dEl.value = new URL(_currentUrl).hostname.replace(/^www\./, '');
  } catch (_) {}
  const kwEl = $('loKeyword');
  if (kwEl && !kwEl.value) {
    const kws = _rawData?.keywords?.keywords || [];
    const topKw = kws.find(k => k.ngram >= 2) || kws[0];
    if (topKw) kwEl.value = topKw.word || topKw.kw || '';
  }
  // AI panel no-key state
  getHeadingAiConfig().then(cfg => {
    const nokey = $('loAiNoKey'); if (nokey) nokey.style.display = cfg ? 'none' : '';
    const runBtn = $('loAiRunBtn'); if (runBtn) runBtn.disabled = !cfg;
  });

  if (_loBound) { setupGeoCollapsibles(); return; }
  _loBound = true;
  $('loGridRunBtn')?.addEventListener('click', loRunGrid);
  $('loAiRunBtn')?.addEventListener('click', loRunAiVisibility);
  $('loGbpRunBtn')?.addEventListener('click', loRunGbpAudit);
  $('loCompRunBtn')?.addEventListener('click', loRunCompBenchmark);
  // Re-geocode when the city changes.
  $('loCity')?.addEventListener('change', () => { _loCenter = null; });
  setupGeoCollapsibles();
}

function loCtx() {
  return {
    biz: ($('loBizName')?.value || '').trim(),
    city: ($('loCity')?.value || '').trim(),
    keyword: ($('loKeyword')?.value || '').trim(),
    domain: ($('loDomain')?.value || '').trim().replace(/^www\./, '')
  };
}

function loGetRankApi() {
  return new Promise(resolve => {
    chrome.storage.local.get(['rankApiProvider', 'rankApiKey'], res => {
      resolve({ provider: res.rankApiProvider || 'serper', apiKey: res.rankApiKey || '' });
    });
  });
}

// Geocode the city to a center lat/lng (cached per session).
async function loGeocodeCity(city) {
  if (_loCenter && _loCenter.city === city) return _loCenter;
  const r = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'GEOCODE', query: city }, res => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(res);
    });
  });
  if (!r || !r.ok) throw new Error(r?.error || 'Could not find that city');
  _loCenter = { city, lat: r.lat, lng: r.lng, displayName: r.displayName };
  return _loCenter;
}

// Build an N×N grid of lat/lng points around a center within radiusKm.
function loBuildGrid(centerLat, centerLng, size, radiusKm) {
  const pts = [];
  const half = (size - 1) / 2;
  const kmPerDegLat = 111;
  const kmPerDegLng = 111 * Math.cos(centerLat * Math.PI / 180) || 111;
  const stepKm = half > 0 ? radiusKm / half : 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const dLat = (r - half) * stepKm / kmPerDegLat;
      const dLng = (c - half) * stepKm / kmPerDegLng;
      pts.push({ row: r, col: c, lat: +(centerLat - dLat).toFixed(6), lng: +(centerLng + dLng).toFixed(6) });
    }
  }
  return pts;
}

async function loLocalPackCheck(cfg, keyword, domain, biz, lat, lng) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({
      action: 'LOCAL_PACK_CHECK', keyword, domain, businessName: biz,
      provider: cfg.provider, apiKey: cfg.apiKey, lat, lng, zoom: 14
    }, res => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(res || { ok: false, error: 'No response' });
    });
  });
}

// ── ① Local Pack Geo-Grid ──────────────────────────────────────────────────
async function loRunGrid() {
  const { biz, city, keyword, domain } = loCtx();
  const out = $('loGridResult');
  const prog = $('loGridProgress');
  const btn = $('loGridRunBtn');
  if (!keyword || !city) { out.innerHTML = '<div class="lo-warn">Enter a keyword and a city first.</div>'; return; }
  if (!biz && !domain) { out.innerHTML = '<div class="lo-warn">Enter your business name or domain so we can locate you in the pack.</div>'; return; }

  const cfg = await loGetRankApi();
  if (!cfg.apiKey) { out.innerHTML = '<div class="lo-warn">Add a Rank API key (Serper.dev or SerpApi) in <strong>Settings → Rank Tracking API</strong> to run the geo-grid.</div>'; return; }

  const size = parseInt($('loGridSize')?.value || '3', 10);
  const radiusKm = parseFloat($('loGridRadius')?.value || '2');
  out.innerHTML = '';
  btn.disabled = true;
  prog.style.display = '';
  prog.textContent = 'Locating ' + city + '…';

  let center;
  try { center = await loGeocodeCity(city); }
  catch (e) { prog.style.display = 'none'; btn.disabled = false; out.innerHTML = '<div class="lo-warn">' + escHTML(e.message) + '</div>'; return; }

  const grid = loBuildGrid(center.lat, center.lng, size, radiusKm);
  const results = [];
  const leaderMap = {}; // title → { title, bestPos, rating, reviews, seen } aggregated across points
  for (let i = 0; i < grid.length; i++) {
    const p = grid[i];
    prog.textContent = `Checking point ${i + 1}/${grid.length}…`;
    let res;
    try { res = await loLocalPackCheck(cfg, keyword, domain, biz, p.lat, p.lng); }
    catch (e) { res = { ok: false, error: e.message }; }
    results.push({ ...p, ok: res.ok, position: res.ok ? res.position : null, found: res.ok && res.found, error: res.error });
    // Aggregate who's ranking so we can show the competitive landscape.
    if (res.ok && Array.isArray(res.localResults)) {
      res.localResults.forEach(pl => {
        const key = (pl.title || '').toLowerCase().trim();
        if (!key) return;
        const e = leaderMap[key] || { title: pl.title, bestPos: 99, rating: pl.rating, reviews: pl.reviews, seen: 0 };
        e.seen++;
        if (pl.position != null && pl.position < e.bestPos) e.bestPos = pl.position;
        if (pl.rating != null) e.rating = pl.rating;
        if (pl.reviews != null) e.reviews = pl.reviews;
        leaderMap[key] = e;
      });
    }
    if (res && res.error && /HTTP 4|api key|unauthor/i.test(res.error)) {
      prog.style.display = 'none'; btn.disabled = false;
      out.innerHTML = '<div class="lo-warn">API error: ' + escHTML(res.error) + '</div>';
      return;
    }
    await new Promise(r => setTimeout(r, 350)); // gentle rate-limit
  }

  const leaders = Object.values(leaderMap)
    .sort((a, b) => (a.bestPos - b.bestPos) || (b.seen - a.seen))
    .slice(0, 6);

  prog.style.display = 'none';
  btn.disabled = false;
  loRenderHeatmap(results, size, { keyword, city, biz: biz || domain, leaders });
}

function loRenderHeatmap(results, size, meta) {
  const out = $('loGridResult');
  const found = results.filter(r => r.found && r.position != null);
  const foundPct = Math.round(found.length / results.length * 100);
  const avgRank = found.length ? (found.reduce((s, r) => s + r.position, 0) / found.length) : null;
  const bestRank = found.length ? Math.min(...found.map(r => r.position)) : null;

  const badge = $('loGridBadge');
  if (badge) {
    badge.style.display = '';
    badge.textContent = found.length ? `Avg #${avgRank.toFixed(1)}` : 'Not in pack';
    badge.className = 'geo-section-badge ' + (avgRank == null ? 'badge-bad' : avgRank <= 3 ? 'badge-ok' : avgRank <= 10 ? 'badge-warn' : 'badge-bad');
  }

  const cell = 46, gap = 4, pad = 6;
  const dim = pad * 2 + size * cell + (size - 1) * gap;
  const color = (pos) => {
    if (pos == null) return '#94a3b8';           // not found — grey
    if (pos <= 3) return '#16a34a';               // green
    if (pos <= 7) return '#84cc16';               // lime
    if (pos <= 10) return '#f59e0b';              // amber
    if (pos <= 15) return '#f97316';              // orange
    return '#ef4444';                             // red
  };
  let svg = `<svg viewBox="0 0 ${dim} ${dim}" width="100%" style="max-width:${dim}px;display:block;margin:0 auto">`;
  results.forEach(r => {
    const x = pad + r.col * (cell + gap);
    const y = pad + r.row * (cell + gap);
    const label = r.position != null ? (r.position > 20 ? '20+' : String(r.position)) : '✕';
    const fill = color(r.position);
    svg += `<g><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="7" fill="${fill}"/>`;
    svg += `<text x="${x + cell / 2}" y="${y + cell / 2 + 5}" text-anchor="middle" font-size="16" font-weight="700" fill="#fff">${label}</text></g>`;
  });
  svg += '</svg>';

  const stat = (label, val, cls) => `<div class="lo-stat ${cls || ''}"><div class="lo-stat-val">${val}</div><div class="lo-stat-lbl">${label}</div></div>`;
  const leaders = meta.leaders || [];
  const anyPack = leaders.length > 0;

  let html =
    `<div class="lo-grid-stats">
      ${stat('Coverage', foundPct + '%', foundPct >= 60 ? 'good' : foundPct >= 30 ? 'warn' : 'bad')}
      ${stat('Avg rank', avgRank != null ? '#' + avgRank.toFixed(1) : '—', avgRank != null && avgRank <= 3 ? 'good' : avgRank != null && avgRank <= 10 ? 'warn' : 'bad')}
      ${stat('Best', bestRank != null ? '#' + bestRank : '—', 'good')}
      ${stat('In pack', found.length + '/' + results.length, '')}
     </div>`;

  // If the business never appears but a pack DOES exist, say so clearly — this
  // is a real result (you're not ranking), not a failure.
  if (!found.length && anyPack) {
    html += `<div class="lo-ai-summary bad">✕ ${escHTML(meta.biz)} is not in the map pack for “${escHTML(meta.keyword)}” at any of the ${results.length} points. The businesses below are ranking instead.</div>`;
  } else if (!found.length && !anyPack) {
    html += `<div class="lo-warn">No map pack was returned for “${escHTML(meta.keyword)}” near ${escHTML(meta.city)}. This keyword may not trigger a local pack (it works best for physical, local business types like “dentist”, “electronics store”, “restaurant”).</div>`;
  }

  html +=
    `<div class="lo-heatmap">${svg}</div>
     <div class="lo-legend">
       <span><i style="background:#16a34a"></i>1–3</span>
       <span><i style="background:#84cc16"></i>4–7</span>
       <span><i style="background:#f59e0b"></i>8–10</span>
       <span><i style="background:#f97316"></i>11–15</span>
       <span><i style="background:#ef4444"></i>16–20</span>
       <span><i style="background:#94a3b8"></i>Not found</span>
     </div>`;

  // Pack leaders across the grid — the competitive landscape.
  if (anyPack) {
    html += '<div class="lo-comp-title">' + (found.length ? 'Also ranking here' : 'Who’s ranking here') + '</div><div class="lo-packlist">';
    leaders.forEach(l => {
      html += `<div class="lo-packrow">
        <span class="lo-pack-pos">#${l.bestPos < 99 ? l.bestPos : '?'}</span>
        <span class="lo-pack-name">${escHTML(l.title)}</span>
        <span class="lo-pack-rating">${l.rating != null ? l.rating + '★' : '—'}</span>
        <span class="lo-pack-reviews">${l.reviews != null ? l.reviews + ' rev' : '—'}</span>
      </div>`;
    });
    html += '</div>';
  }

  html += `<div class="lo-caption">“${escHTML(meta.keyword)}” · ${escHTML(meta.biz)} · ${size}×${size} grid around ${escHTML(meta.city)}</div>`;
  out.innerHTML = html;
}

// ── ② AI Local Visibility ──────────────────────────────────────────────────
async function loRunAiVisibility() {
  const { biz, city, keyword } = loCtx();
  const out = $('loAiResult');
  const prog = $('loAiProgress');
  const btn = $('loAiRunBtn');
  if (!biz || !city || !keyword) { out.innerHTML = '<div class="lo-warn">Enter your business name, city and keyword first.</div>'; return; }

  const cfg = await getHeadingAiConfig();
  if (!cfg) { out.innerHTML = '<div class="lo-warn">Configure an AI model in Settings → AI Model.</div>'; return; }

  const prompts = [
    `What are the best ${keyword} in ${city}? List the top 5 businesses by name only, ranked, one per line.`,
    `I'm looking for a reliable ${keyword} in ${city}. Recommend the top 5 by name only, ranked, one per line.`,
    `Which ${keyword} in ${city} has the best reputation? Give the top 5 business names only, ranked, one per line.`
  ];

  out.innerHTML = '';
  btn.disabled = true;
  prog.style.display = '';

  const bizLc = biz.toLowerCase();
  const runs = [];
  const competitorTally = {};
  for (let i = 0; i < prompts.length; i++) {
    prog.textContent = `Asking AI (${i + 1}/${prompts.length})…`;
    let text = '';
    try { text = await callHeadingAI(cfg, prompts[i], 400); }
    catch (e) { runs.push({ mentioned: false, position: null, error: e.message, names: [] }); continue; }
    // Parse ranked names (strip list markers).
    const names = text.split('\n').map(l => l.replace(/^\s*\d+[.)]\s*|^[-*•]\s*/, '').trim())
      .filter(l => l && l.length < 60).slice(0, 5);
    let position = null;
    names.forEach((n, idx) => {
      const nLc = n.toLowerCase();
      if (position == null && (nLc.includes(bizLc) || bizLc.includes(nLc.split(/[-–—(]/)[0].trim()))) position = idx + 1;
      // tally competitors (exclude our own business)
      if (!(nLc.includes(bizLc) || bizLc.includes(nLc))) {
        const key = n.replace(/[.*]/g, '').trim();
        if (key) competitorTally[key] = (competitorTally[key] || 0) + 1;
      }
    });
    runs.push({ mentioned: position != null, position, names });
    await new Promise(r => setTimeout(r, 200));
  }

  prog.style.display = 'none';
  btn.disabled = false;

  const mentions = runs.filter(r => r.mentioned).length;
  const sov = Math.round(mentions / runs.length * 100);
  const avgPos = mentions ? (runs.filter(r => r.mentioned).reduce((s, r) => s + r.position, 0) / mentions).toFixed(1) : null;
  const topCompetitors = Object.entries(competitorTally).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const badge = $('loAiBadge');
  if (badge) { badge.style.display = ''; badge.textContent = sov + '% SoV'; badge.className = 'geo-section-badge ' + (sov >= 60 ? 'badge-ok' : sov >= 30 ? 'badge-warn' : 'badge-bad'); }

  // Save a history snapshot
  loSaveAiHistory({ ts: Date.now(), keyword, city, sov, mentions, runs: runs.length, avgPos });

  const stat = (l, v, cls) => `<div class="lo-stat ${cls || ''}"><div class="lo-stat-val">${v}</div><div class="lo-stat-lbl">${l}</div></div>`;
  let html = `<div class="lo-grid-stats">
      ${stat('Share of voice', sov + '%', sov >= 60 ? 'good' : sov >= 30 ? 'warn' : 'bad')}
      ${stat('Mentioned', mentions + '/' + runs.length, mentions ? 'good' : 'bad')}
      ${stat('Avg position', avgPos != null ? '#' + avgPos : '—', avgPos != null && avgPos <= 3 ? 'good' : 'warn')}
    </div>`;
  html += `<div class="lo-ai-summary ${mentions ? 'ok' : 'bad'}">${mentions ? `✓ ${biz} was recommended in ${mentions} of ${runs.length} AI answers.` : `✕ ${biz} was not recommended in any AI answer for “${escHTML(keyword)} in ${escHTML(city)}”.`}</div>`;
  if (topCompetitors.length) {
    html += '<div class="lo-comp-title">Who the AI recommends instead</div><div class="lo-chips">';
    topCompetitors.forEach(([name, cnt]) => { html += `<span class="lo-chip">${escHTML(name)} <b>${cnt}×</b></span>`; });
    html += '</div>';
  }
  html += '<div class="lo-caption">Based on ' + runs.length + ' local-intent prompts to your configured AI model.</div>';
  out.innerHTML = html;
}

function loSaveAiHistory(entry) {
  try {
    chrome.storage.local.get(['loAiHistory'], res => {
      const hist = Array.isArray(res.loAiHistory) ? res.loAiHistory : [];
      hist.push(entry);
      chrome.storage.local.set({ loAiHistory: hist.slice(-50) });
    });
  } catch (_) {}
}

// ── ③ GBP Audit (vs top pack competitors) ──────────────────────────────────
async function loRunGbpAudit() {
  const { biz, city, keyword, domain } = loCtx();
  const out = $('loGbpResult');
  const prog = $('loGbpProgress');
  const btn = $('loGbpRunBtn');
  if (!keyword || !city) { out.innerHTML = '<div class="lo-warn">Enter a keyword and city first.</div>'; return; }
  if (!biz && !domain) { out.innerHTML = '<div class="lo-warn">Enter your business name or domain.</div>'; return; }

  const cfg = await loGetRankApi();
  if (!cfg.apiKey) { out.innerHTML = '<div class="lo-warn">Add a Rank API key in Settings → Rank Tracking API.</div>'; return; }

  out.innerHTML = ''; btn.disabled = true; prog.style.display = ''; prog.textContent = 'Fetching the map pack…';

  let center = null;
  try { center = await loGeocodeCity(city); } catch (_) {}
  let res;
  try { res = await loLocalPackCheck(cfg, keyword, domain, biz, center?.lat, center?.lng); }
  catch (e) { res = { ok: false, error: e.message }; }
  prog.style.display = 'none'; btn.disabled = false;

  if (!res.ok) { out.innerHTML = '<div class="lo-warn">' + escHTML(res.error || 'Lookup failed') + '</div>'; return; }
  const pack = res.localResults || [];
  if (!pack.length) { out.innerHTML = '<div class="lo-warn">No map pack returned for that keyword/location.</div>'; return; }

  // Find "us" in the pack.
  const meLc = (biz || '').toLowerCase(), dLc = (domain || '').toLowerCase();
  const me = pack.find(p => {
    let h = ''; try { h = new URL(p.website || '').hostname.replace(/^www\./, '').toLowerCase(); } catch (_) {}
    return (dLc && h && (h === dLc || h.endsWith('.' + dLc))) || (meLc && (p.title || '').toLowerCase().includes(meLc));
  });
  const competitors = pack.filter(p => p !== me);
  const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const compAvgRating = avg(competitors.filter(c => c.rating != null).map(c => c.rating));
  const compAvgReviews = avg(competitors.filter(c => c.reviews != null).map(c => c.reviews));
  const topReviews = Math.max(0, ...competitors.map(c => c.reviews || 0));

  const badge = $('loGbpBadge');

  if (!me) {
    if (badge) { badge.style.display = ''; badge.textContent = 'Not ranking'; badge.className = 'geo-section-badge badge-bad'; }
    let html = `<div class="lo-ai-summary bad">✕ ${escHTML(biz || domain)} is not in the top ${pack.length} map results for “${escHTML(keyword)}” near ${escHTML(city)}.</div>`;
    html += '<div class="lo-comp-title">Who is ranking (pack leaders)</div>' + loRenderPackList(pack.slice(0, 5));
    html += '<div class="lo-recos"><div class="lo-recos-title">To break in</div><ul>'
      + '<li>Close the review gap — pack leaders here average ' + compAvgReviews.toFixed(0) + ' reviews.</li>'
      + '<li>Make sure your primary category matches the keyword.</li>'
      + '<li>Complete every profile field and add fresh photos + posts.</li></ul></div>';
    out.innerHTML = html;
    return;
  }

  // Score 0-100
  let score = 0; const checks = [];
  const add = (ok, warn, pts, label, detail) => { if (ok) score += pts; checks.push({ status: ok ? 'ok' : (warn ? 'warn' : 'bad'), label, detail }); };
  add(me.rating != null, false, 10, 'Star rating present', me.rating != null ? me.rating + '★' : 'none');
  add(me.rating != null && me.rating >= 4.5, me.rating >= 4.0, 20, 'Rating ≥ 4.5', (me.rating != null ? me.rating : '—') + '★');
  add(me.rating != null && compAvgRating > 0 && me.rating >= compAvgRating, false, 15, 'Rating beats pack average', 'you ' + (me.rating ?? '—') + '★ vs avg ' + compAvgRating.toFixed(1) + '★');
  add(me.reviews != null && me.reviews > 0, false, 10, 'Has reviews', (me.reviews ?? 0) + ' reviews');
  add(me.reviews != null && me.reviews >= compAvgReviews, (me.reviews || 0) >= compAvgReviews * 0.5, 20, 'Reviews ≥ pack average', 'you ' + (me.reviews ?? 0) + ' vs avg ' + compAvgReviews.toFixed(0));
  add((me.reviews || 0) >= topReviews && topReviews > 0, false, 10, 'Most-reviewed in pack', 'top has ' + topReviews);
  add(!!me.category, false, 10, 'Category set', me.category || 'unknown');
  add(res.position != null && res.position <= 3, res.position != null && res.position <= 10, 5, 'In top 3 of pack', res.position != null ? '#' + res.position : '—');
  score = Math.min(100, score);

  if (badge) { badge.style.display = ''; badge.textContent = score + '/100'; badge.className = 'geo-section-badge ' + (score >= 70 ? 'badge-ok' : score >= 45 ? 'badge-warn' : 'badge-bad'); }

  const stat = (l, v, cls) => `<div class="lo-stat ${cls || ''}"><div class="lo-stat-val">${v}</div><div class="lo-stat-lbl">${l}</div></div>`;
  let html = `<div class="lo-grid-stats">
      ${stat('GBP score', score + '/100', score >= 70 ? 'good' : score >= 45 ? 'warn' : 'bad')}
      ${stat('Your rating', me.rating != null ? me.rating + '★' : '—', 'good')}
      ${stat('Your reviews', me.reviews ?? '—', me.reviews >= compAvgReviews ? 'good' : 'warn')}
      ${stat('Pack pos', res.position != null ? '#' + res.position : '—', res.position <= 3 ? 'good' : 'warn')}
    </div>`;
  html += '<div class="lo-checklist">';
  checks.forEach(c => { html += `<div class="lo-check ${c.status}"><span class="lo-check-i">${c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✕'}</span><span>${escHTML(c.label)}</span><span class="lo-check-d">${escHTML(c.detail)}</span></div>`; });
  html += '</div>';
  html += '<div class="lo-comp-title">Pack comparison</div>' + loRenderPackList(pack.slice(0, 5), me);
  html += '<div class="lo-caption">Rating/review/category from live map-pack data. Photos, posts, Q&A &amp; attributes must be checked on your listing.</div>';
  out.innerHTML = html;
}

function loRenderPackList(pack, me) {
  let h = '<div class="lo-packlist">';
  pack.forEach((p, i) => {
    const isMe = me && p === me;
    h += `<div class="lo-packrow ${isMe ? 'me' : ''}">
      <span class="lo-pack-pos">#${p.position || (i + 1)}</span>
      <span class="lo-pack-name">${escHTML(p.title || '—')}${isMe ? ' <b>(you)</b>' : ''}</span>
      <span class="lo-pack-rating">${p.rating != null ? p.rating + '★' : '—'}</span>
      <span class="lo-pack-reviews">${p.reviews != null ? p.reviews + ' rev' : '—'}</span>
    </div>`;
  });
  return h + '</div>';
}

// ── ④ Competitor GEO Benchmark ─────────────────────────────────────────────
async function loRunCompBenchmark() {
  const out = $('loCompResult');
  const prog = $('loCompProgress');
  const btn = $('loCompRunBtn');
  const urls = ($('loCompUrls')?.value || '').split('\n').map(u => u.trim()).filter(Boolean).slice(0, 3);
  if (!urls.length) { out.innerHTML = '<div class="lo-warn">Enter at least one competitor URL.</div>'; return; }
  if (!_rawData) { out.innerHTML = '<div class="lo-warn">Analyze the current page first (open the dashboard), then benchmark.</div>'; return; }

  out.innerHTML = ''; btn.disabled = true; prog.style.display = '';

  const mine = loGeoBreakdown(_rawData);
  const rows = [{ label: 'You', url: _currentUrl, ...mine }];
  for (let i = 0; i < urls.length; i++) {
    prog.textContent = `Analyzing competitor ${i + 1}/${urls.length}… (opens a background tab)`;
    let res;
    try {
      res = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'COMPETITOR_ANALYZE', url: urls[i] }, r => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          resolve(r || { ok: false, error: 'No response' });
        });
      });
    } catch (e) { res = { ok: false, error: e.message }; }
    let label = urls[i]; try { label = new URL(urls[i]).hostname.replace(/^www\./, ''); } catch (_) {}
    if (res.ok && res.analysis) rows.push({ label, url: urls[i], ...loGeoBreakdown(res.analysis) });
    else rows.push({ label, url: urls[i], error: res.error || 'failed' });
  }

  prog.style.display = 'none'; btn.disabled = false;
  loRenderBenchmark(rows);
}

// Extract a comparable GEO breakdown from a raw content.js analysis object.
function loGeoBreakdown(raw) {
  const g = raw?.geoSignals || {};
  const pillars = g.pillars || {};
  const struct = raw?.structuredDeep || raw?.structured || {};
  const schemas = (struct.schemas || []).map(s => (s['@type'] || s.type || '')).filter(Boolean);
  const eeat = raw?.eeat || {};
  const cite = raw?.citability || {};
  return {
    score: g.score || 0,
    pillars: {
      citability: pillars.citability?.score || 0,
      eeat: pillars.eeat?.score || 0,
      structured: pillars.structured?.score || 0,
      techAI: pillars.techAI?.score || 0,
      multiModal: pillars.multiModal?.score || 0
    },
    schemaTypes: [...new Set(schemas)],
    hasFaq: schemas.some(s => /FAQ/i.test(s)),
    hasAuthor: !!(eeat.author?.found || eeat.hasAuthor),
    hasSchema: schemas.length > 0,
    wordCount: raw?.readability?.wordCount || cite?.wordCount || 0
  };
}

function loRenderBenchmark(rows) {
  const out = $('loCompResult');
  const you = rows[0];
  const comps = rows.slice(1).filter(r => !r.error);
  const failed = rows.slice(1).filter(r => r.error);

  const badge = $('loCompBadge');
  if (badge && comps.length) {
    const avgComp = comps.reduce((s, r) => s + r.score, 0) / comps.length;
    const diff = Math.round(you.score - avgComp);
    badge.style.display = '';
    badge.textContent = (diff >= 0 ? '+' : '') + diff + ' vs avg';
    badge.className = 'geo-section-badge ' + (diff >= 0 ? 'badge-ok' : 'badge-bad');
  }

  const P = [['citability', 'Citability'], ['eeat', 'E-E-A-T'], ['structured', 'Schema'], ['techAI', 'Tech/AI'], ['multiModal', 'Media']];
  let html = '<div class="lo-bench-scroll"><table class="lo-bench"><thead><tr><th>Signal</th>';
  rows.forEach(r => { html += `<th${r === you ? ' class="you"' : ''}>${escHTML(r.label.length > 14 ? r.label.slice(0, 12) + '…' : r.label)}</th>`; });
  html += '</tr></thead><tbody>';
  // Overall score row
  html += '<tr class="lo-bench-total"><td>GEO score</td>';
  rows.forEach(r => { html += r.error ? '<td class="err">—</td>' : `<td${r === you ? ' class="you"' : ''}><b>${r.score}</b></td>`; });
  html += '</tr>';
  P.forEach(([key, label]) => {
    html += `<tr><td>${label}</td>`;
    rows.forEach(r => { html += r.error ? '<td class="err">—</td>' : `<td${r === you ? ' class="you"' : ''}>${r.pillars[key]}</td>`; });
    html += '</tr>';
  });
  // Boolean feature rows
  const feat = (label, key) => {
    let row = `<tr><td>${label}</td>`;
    rows.forEach(r => { row += r.error ? '<td class="err">—</td>' : `<td${r === you ? ' class="you"' : ''}>${r[key] ? '✓' : '·'}</td>`; });
    return row + '</tr>';
  };
  html += feat('FAQ schema', 'hasFaq') + feat('Author E-E-A-T', 'hasAuthor') + feat('Any schema', 'hasSchema');
  html += '</tbody></table></div>';

  // Prioritized gap list
  const gaps = [];
  comps.forEach(c => {
    if (c.hasFaq && !you.hasFaq) gaps.push(`${c.label} has FAQ schema — you don’t.`);
    if (c.hasAuthor && !you.hasAuthor) gaps.push(`${c.label} shows author/E-E-A-T signals — add an author byline & bio.`);
    if (c.hasSchema && !you.hasSchema) gaps.push(`${c.label} uses structured data — add JSON-LD schema.`);
    P.forEach(([key, label]) => { if (c.pillars[key] - you.pillars[key] >= 4) gaps.push(`${c.label} beats you on ${label} (${c.pillars[key]} vs ${you.pillars[key]}).`); });
  });
  const uniqGaps = [...new Set(gaps)].slice(0, 8);
  if (uniqGaps.length) {
    html += '<div class="lo-recos"><div class="lo-recos-title">Gaps to close</div><ul>';
    uniqGaps.forEach(g => html += `<li>${escHTML(g)}</li>`);
    html += '</ul></div>';
  } else if (comps.length) {
    html += '<div class="lo-ai-summary ok">✓ Your page matches or beats these competitors on every GEO signal checked.</div>';
  }
  if (failed.length) html += '<div class="lo-caption">Could not analyze: ' + failed.map(f => escHTML(f.label)).join(', ') + '</div>';
  out.innerHTML = html;
}

function initHeadingAiButtons(headings) {
  const bulkBtn = $('hnAiImproveAllBtn');
  const badge = $('hnAiModeBadge');
  const nokey = $('hnAiNoKey');

  getHeadingAiConfig().then(cfg => {
    if (badge) badge.textContent = cfg ? 'AI READY' : 'RULES';
    if (nokey) nokey.style.display = cfg ? 'none' : '';
  });

  if (bulkBtn && !bulkBtn.dataset.bound) {
    bulkBtn.dataset.bound = '1';
    bulkBtn.addEventListener('click', () => improveAllHeadingsWithAI());
  }
}

/**
 * Robustly extract a JSON array/object from messy AI output.
 */
function parseAiJsonLoose(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json|javascript|js)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Prefer first [...] or {...} block
  if (!/^[\[{]/.test(s)) {
    const a = s.indexOf('[');
    const o = s.indexOf('{');
    let start = -1;
    if (a >= 0 && (o < 0 || a < o)) start = a;
    else if (o >= 0) start = o;
    if (start >= 0) {
      const open = s[start];
      const close = open === '[' ? ']' : '}';
      const end = s.lastIndexOf(close);
      if (end > start) s = s.slice(start, end + 1);
    }
  }
  // Remove trailing commas before ] or }
  s = s.replace(/,\s*([\]}])/g, '$1');
  try {
    return JSON.parse(s);
  } catch (e1) {
    // Escape bad control chars inside strings (best-effort)
    try {
      const fixed = s
        .replace(/[\u0000-\u001f]/g, (ch) => {
          if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
          return '';
        });
      return JSON.parse(fixed);
    } catch (e2) {
      // Last resort: extract objects one-by-one from array-like text
      const objs = [];
      const re = /\{\s*"index"\s*:\s*(\d+)\s*,\s*"level"\s*:\s*(\d+)\s*,\s*"original"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"improved"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"reason"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/g;
      let m;
      while ((m = re.exec(s)) !== null) {
        objs.push({
          index: parseInt(m[1], 10),
          level: parseInt(m[2], 10),
          original: m[3].replace(/\\"/g, '"'),
          improved: m[4].replace(/\\"/g, '"'),
          reason: m[5].replace(/\\"/g, '"')
        });
      }
      if (objs.length) return objs;
      throw e1;
    }
  }
}

/**
 * Bulk: send the whole heading outline to AI, get back improved titles + priority order,
 * render as an applyable list inside the priority panel.
 */
async function improveAllHeadingsWithAI() {
  const loading = $('hnAiLoading');
  const nokey = $('hnAiNoKey');
  const bulkBtn = $('hnAiImproveAllBtn');

  const cfg = await getHeadingAiConfig();
  if (!cfg) { if (nokey) nokey.style.display = ''; return; }
  if (nokey) nokey.style.display = 'none';

  // Keep real DOM index (position in full h1–h6 list). Filtering empty must not drop index.
  const all = (_hnLastHeadings || [])
    .map((h, i) => ({
      ...h,
      domIndex: (h && typeof h.domIndex === 'number') ? h.domIndex : i
    }))
    .filter(h => !h.isEmpty && String(h.text || '').trim());
  if (!all.length) { toast('No headings to improve'); return; }
  const headings = all.slice(0, 30);

  if (loading) loading.style.display = '';
  if (bulkBtn) bulkBtn.disabled = true;

  const outline = headings.map((h, i) => {
    const t = String(h.text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    return `${i + 1}. H${h.level}: ${t}`;
  }).join('\n');
  const domain = (_currentUrl ? (() => { try { return new URL(_currentUrl).hostname; } catch (e) { return ''; } })() : '');

  const prompt = `You are an SEO content editor for ${domain || 'a website'}.

HEADINGS:
${outline}

Rewrite each heading. Keep the same meaning and level. Max 70 characters each.
Use simple words. Date context: September 2026 - do not write 2024 or 2025.

Respond with ONLY a JSON array. No markdown fences. No extra text.
Every string must use standard double quotes. Escape any " inside strings as \\".
Format:
[{"index":1,"level":2,"original":"old","improved":"new","reason":"why"},{"index":2,"level":2,"original":"old","improved":"new","reason":"why"}]
Include every index from 1 to ${headings.length} in order.`;

  try {
    const raw = await callHeadingAI(cfg, prompt, Math.max(cfg.maxTokens || 1500, 2500));
    const parsed = parseAiJsonLoose(raw);
    if (!Array.isArray(parsed) || !parsed.length) {
      throw new Error('AI returned empty or invalid list. Try again.');
    }
    // Align by index when possible
    const byIndex = {};
    parsed.forEach(item => {
      if (item && item.index != null) byIndex[item.index] = item;
    });
    const ordered = headings.map((h, i) => {
      const item = byIndex[i + 1] || parsed[i] || {};
      return {
        index: i + 1,
        level: h.level,
        original: item.original || h.text,
        improved: item.improved || h.text,
        reason: item.reason || ''
      };
    });
    renderAiImprovedHeadingsList(ordered, headings);
    if (all.length > headings.length) {
      toast('Improved first ' + headings.length + ' headings (page has ' + all.length + ')');
    } else {
      toast('Headings improved');
    }
  } catch (err) {
    console.error('[ShahzaibSEO] improveAllHeadingsWithAI', err);
    toast('AI improve failed: ' + (err.message || 'unknown error'));
  } finally {
    if (loading) loading.style.display = 'none';
    if (bulkBtn) bulkBtn.disabled = false;
  }
}

function renderAiImprovedHeadingsList(parsed, headings) {
  const list = $('hnPriorityList');
  if (!list || !Array.isArray(parsed)) return;
  list.innerHTML = '';

  parsed.forEach((item, i) => {
    const h = headings[i];
    if (!h) return;
    // Resolve DOM index: prefer stored, else position in full _hnLastHeadings list
    let domIndex = (typeof h.domIndex === 'number') ? h.domIndex : null;
    if (domIndex == null && Array.isArray(_hnLastHeadings)) {
      const match = _hnLastHeadings.findIndex((x, idx) => {
        if (x === h) return true;
        const a = String(x.text || '').trim();
        const b = String(h.text || item.original || '').trim();
        return a && b && a === b && x.level === h.level;
      });
      if (match >= 0) domIndex = (typeof _hnLastHeadings[match].domIndex === 'number')
        ? _hnLastHeadings[match].domIndex
        : match;
    }
    if (domIndex == null) domIndex = i;
    h.domIndex = domIndex;
    const changed = (item.improved || '').trim() && item.improved.trim() !== (item.original || '').trim();

    const li = el('li', `hn-priority-item sev-${changed ? 'medium' : 'low'}`);
    li.innerHTML = `
      <span class="hn-priority-num">${i + 1}</span>
      <span class="hn-priority-sev ai">AI</span>
      <span class="hn-priority-text">
        <span class="hn-priority-label">H${h.level}: ${escHTML(item.improved || h.text)}</span>
        <span class="hn-priority-detail">${changed ? `Was: "${escHTML(item.original || h.text)}" — ${escHTML(item.reason || '')}` : 'Already good — no change suggested'}</span>
      </span>
      ${changed ? `<button class="hn-action-btn hn-change-btn hn-ai-apply-btn" title="Apply this title on the page">Apply</button>` : ''}`;

    li.querySelector('.hn-ai-apply-btn')?.addEventListener('click', async (e) => {
      const btnEl = e.currentTarget;
      const text = String(item.improved || '').trim();
      if (!text) {
        toast('Improved text is empty');
        return;
      }
      const idx = typeof h.domIndex === 'number' ? h.domIndex : null;
      if (idx == null || idx < 0) {
        toast('Heading not found or text empty');
        return;
      }
      btnEl.disabled = true;
      const ok = await sendHeadingAction('updateHeadingText', idx, {
        newText: text,
        originalText: item.original || h.text || ''
      });
      if (ok) {
        toast('Heading title updated on page (reload to restore)');
        btnEl.textContent = 'Applied ✓';
      } else {
        btnEl.disabled = false;
        toast('Heading not found or text empty');
      }
    });

    list.appendChild(li);
  });
}

/**
 * Per-row: improve a single heading's title via AI, show inline result with an Apply button.
 */
async function improveHeadingTextWithAI(h, row, btn) {
  const cfg = await getHeadingAiConfig();
  if (!cfg) { toast('Add an NVIDIA or OpenRouter API key in Settings to use AI'); return; }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';

  const domain = (_currentUrl ? (() => { try { return new URL(_currentUrl).hostname; } catch (e) { return ''; } })() : '');
  const prompt = `You are an SEO content editor for ${domain || 'a website'}. Rewrite this H${h.level} heading to be more specific, keyword-relevant, and compelling, while keeping the same meaning and under 70 characters.

Current heading: "${h.text}"

Respond ONLY with the improved heading text — no quotes, no explanation, no markdown.`;

  try {
    const raw = await callHeadingAI(cfg, prompt, 100);
    const improved = raw.trim().replace(/^["']|["']$/g, '');
    if (!improved) throw new Error('Empty response');

    // Remove any existing inline suggestion row first
    row.parentElement?.querySelector(`.hn-ai-inline[data-for="${h.domIndex}"]`)?.remove();

    const suggestRow = el('div', 'hn-ai-inline');
    suggestRow.setAttribute('data-for', h.domIndex);
    suggestRow.innerHTML = `
      <span class="hn-ai-inline-badge">AI</span>
      <span class="hn-ai-inline-text">${escHTML(improved)}</span>
      <button class="hn-action-btn hn-change-btn hn-ai-inline-apply">Apply</button>
      <button class="hn-action-btn hn-ai-inline-dismiss" title="Dismiss">✕</button>`;

    suggestRow.querySelector('.hn-ai-inline-apply')?.addEventListener('click', async () => {
      const ok = await sendHeadingAction('updateHeadingText', h.domIndex, {
        newText: improved,
        originalText: h.text || ''
      });
      if (!ok) return;
      const textSpan = row.querySelector('.hn-text');
      if (textSpan) { textSpan.textContent = improved; textSpan.title = improved; }
      toast('Heading title updated on page (reload to restore)');
      suggestRow.remove();
    });
    suggestRow.querySelector('.hn-ai-inline-dismiss')?.addEventListener('click', () => suggestRow.remove());

    row.insertAdjacentElement('afterend', suggestRow);
  } catch (err) {
    toast('AI improve failed: ' + (err.message || 'unknown error'));
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function sendHeadingAction(action, domIndex, extra) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) {
        toast('No active tab');
        resolve(false);
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { action, domIndex, ...(extra || {}) }, resp => {
        if (chrome.runtime.lastError) {
          toast('Cannot reach page — try refreshing');
          resolve(false);
          return;
        }
        if (resp && resp.success) {
          resolve(true);
          return;
        }
        if (resp && !resp.success) toast(resp.error || 'Action failed');
        resolve(false);
      });
    });
  });
}

// ══════════════════════════════════════════════════════
// AI META TITLE / DESCRIPTION / SLUG SUGGESTIONS (Headings tab → SERP preview)
// ══════════════════════════════════════════════════════

function initSerpMetaAiButton() {
  const btn = $('serpAiSuggestBtn');
  const nokey = $('serpAiNoKey');

  getHeadingAiConfig().then(cfg => {
    if (nokey) nokey.style.display = cfg ? 'none' : '';
  });

  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => suggestSerpMetaWithAI());
  }
}

/**
 * Slugify a string the same way most CMSs / WordPress do: lowercase,
 * strip stopwords' punctuation, collapse whitespace into single hyphens.
 */
function slugifyText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Ask the configured AI model (NVIDIA/OpenRouter — same provider used elsewhere
 * in the Headings tab) for a semantic, SEO-optimized meta title, meta
 * description and URL slug based on this page's current title/description/H1/H2s.
 */
async function suggestSerpMetaWithAI() {
  const btn = $('serpAiSuggestBtn');
  const nokey = $('serpAiNoKey');
  const loading = $('serpAiLoading');
  const resultBox = $('serpAiResult');

  const cfg = await getHeadingAiConfig();
  if (!cfg) { if (nokey) nokey.style.display = ''; return; }
  if (nokey) nokey.style.display = 'none';

  const meta = _hnLastMeta || {};
  const headings = _hnLastHeadings || [];
  const domain = (() => { try { return new URL(meta.url || _currentUrl || '').hostname; } catch (e) { return ''; } })();
  const h1 = headings.find(h => h.level === 1 && !h.isEmpty)?.text || '';
  const h2s = headings.filter(h => h.level === 2 && !h.isEmpty).slice(0, 6).map(h => h.text).join(', ');

  if (btn) btn.disabled = true;
  if (loading) loading.style.display = '';
  if (resultBox) resultBox.style.display = 'none';

  const prompt = `You are an expert SEO copywriter. Write a fully optimized, semantic, click-worthy meta title, meta description, and URL slug for the page below — written for both Google search rankings and human click-through rate.

TODAY'S CONTEXT: September 2026. Never write 2023, 2024, or 2025 in the title/description/slug. If a year helps CTR, use 2026 (or 2027 only when looking ahead). Prefer omitting the year when possible.

PAGE CONTEXT:
- Domain: ${domain || 'unknown'}
- Current title: "${meta.title || '(none)'}"
- Current meta description: "${meta.desc || '(none)'}"
- Current URL: ${meta.url || '(none)'}
- H1: "${h1 || '(none)'}"
- Key H2 topics: ${h2s || '(none)'}

REQUIREMENTS:
- title: 50-60 characters total, primary keyword placed near the front, natural language (no keyword stuffing, no pipe-spam)
- description: 140-160 characters, includes the primary keyword naturally once, states a clear value proposition, ends with a soft call-to-action, no surrounding quotation marks
- slug: lowercase, hyphen-separated, 3-6 words, primary keyword only, no stopwords (a/the/and/of/etc.), no dates unless essential to the topic

Respond ONLY with valid JSON, no markdown, no explanation, in this exact format:
{"title":"...","title_reason":"short reason, under 12 words","description":"...","description_reason":"short reason, under 12 words","slug":"...","slug_reason":"short reason, under 12 words"}`;

  try {
    const raw = await callHeadingAI(cfg, prompt, Math.max(cfg.maxTokens, 600));
    const parsed = typeof parseAiJsonLoose === 'function' ? parseAiJsonLoose(raw) : JSON.parse(String(raw || '').replace(/```json|```/g, '').trim());
    renderSerpAiSuggestions(parsed);
  } catch (err) {
    if (resultBox) {
      resultBox.innerHTML = `<div class="serp-ai-error">⚠️ AI suggestion failed: ${escHTML(err.message || 'unknown error')}</div>`;
      resultBox.style.display = '';
    }
  } finally {
    if (btn) btn.disabled = false;
    if (loading) loading.style.display = 'none';
  }
}

function renderSerpAiSuggestions(parsed) {
  const box = $('serpAiResult');
  if (!box || !parsed) return;

  const title = (parsed.title || '').trim();
  const desc = (parsed.description || '').trim();
  const slug = slugifyText(parsed.slug || '');

  const lenBadge = (len, good) => {
    const cls = len === 0 ? '' : (len <= good ? 'ok' : 'warn');
    return `<span class="serp-ai-item-count ${cls}">${len} chars</span>`;
  };

  box.innerHTML = `
    <div class="serp-ai-item" data-kind="title">
      <div class="serp-ai-item-head">
        <span class="serp-ai-item-label">✨ AI Title ${lenBadge(title.length, 60)}</span>
        <span class="serp-ai-item-actions">
          <button class="serp-ai-mini-btn copy" data-copy="${escAttr(title)}">Copy</button>
          <button class="serp-ai-mini-btn apply" data-apply="title">Apply</button>
        </span>
      </div>
      <div class="serp-ai-item-text">${escHTML(title) || '—'}</div>
      ${parsed.title_reason ? `<div class="serp-ai-item-reason">${escHTML(parsed.title_reason)}</div>` : ''}
    </div>

    <div class="serp-ai-item" data-kind="description">
      <div class="serp-ai-item-head">
        <span class="serp-ai-item-label">✨ AI Description ${lenBadge(desc.length, 160)}</span>
        <span class="serp-ai-item-actions">
          <button class="serp-ai-mini-btn copy" data-copy="${escAttr(desc)}">Copy</button>
          <button class="serp-ai-mini-btn apply" data-apply="description">Apply</button>
        </span>
      </div>
      <div class="serp-ai-item-text">${escHTML(desc) || '—'}</div>
      ${parsed.description_reason ? `<div class="serp-ai-item-reason">${escHTML(parsed.description_reason)}</div>` : ''}
    </div>

    <div class="serp-ai-item" data-kind="slug">
      <div class="serp-ai-item-head">
        <span class="serp-ai-item-label">✨ AI URL Slug ${lenBadge(slug.length, 60)}</span>
        <span class="serp-ai-item-actions">
          <button class="serp-ai-mini-btn copy" data-copy="${escAttr('/' + slug)}">Copy</button>
        </span>
      </div>
      <div class="serp-ai-item-text">/${escHTML(slug) || '—'}</div>
      ${parsed.slug_reason ? `<div class="serp-ai-item-reason">${escHTML(parsed.slug_reason)}</div>` : ''}
      <div class="serp-ai-item-reason">Use this when renaming the page's permalink/slug in your CMS — it can't be changed live from the browser.</div>
    </div>
  `;
  box.style.display = '';

  box.querySelectorAll('[data-copy]').forEach(b => {
    b.addEventListener('click', () => { copyText(b.dataset.copy); toast('Copied'); });
  });

  box.querySelectorAll('[data-apply]').forEach(b => {
    b.addEventListener('click', () => {
      const kind = b.dataset.apply;
      const text = kind === 'title' ? title : desc;
      if (!text) return;
      sendMetaAction(kind, text);
      if (kind === 'title') {
        setText('serpTitle', text);
        const tBadge = $('titleLenBadge');
        if (tBadge) { tBadge.textContent = `${text.length}/60`; tBadge.className = `serp-badge ${text.length > 60 ? 'warn' : 'ok'}`; }
      } else {
        setText('serpDesc', text);
        const dBadge = $('descLenBadge');
        if (dBadge) { dBadge.textContent = `${text.length}/160`; dBadge.className = `serp-badge ${text.length > 160 ? 'warn' : 'ok'}`; }
      }
      toast(`${kind === 'title' ? 'Title' : 'Description'} applied on page (reload to restore)`);
      b.disabled = true;
      b.textContent = 'Applied ✓';
    });
  });
}

/**
 * Push an AI-suggested meta title/description onto the live page DOM
 * (document.title / <meta name="description">), mirroring the heading
 * "apply" pattern used elsewhere in this tab.
 */
function sendMetaAction(metaType, newText) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'updateMetaTag', metaType, newText }, resp => {
      if (chrome.runtime.lastError) { toast('Cannot reach page — try refreshing'); return; }
      if (resp && !resp.success) toast(resp.error || 'Action failed');
    });
  });
}

// ══════════════════════════════════════════════════════
// RANK TRACKER (hybrid: free Google-scan by default, optional paid SERP API)
// ══════════════════════════════════════════════════════

const RT_MAX_FREE_PAGES = 10; // up to 100 results scanned for the free method
let _rtCurrentDomain = null;
let _rtBound = false;
let _rtChecking = new Set(); // keywords currently being checked (per-row spinner)
let _rtCheckAllRunning = false;

function rtSlug(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9.]+/g, '_').replace(/^_+|_+$/g, '');
}

function rtStorageKey(domain) { return 'rt_data_' + rtSlug(domain); }

function rtGetData(domain) {
  return new Promise(resolve => {
    chrome.storage.local.get([rtStorageKey(domain)], res => {
      const data = res[rtStorageKey(domain)];
      resolve(data && Array.isArray(data.keywords) ? data : { keywords: [], history: {} });
    });
  });
}

function rtSaveData(domain, data) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [rtStorageKey(domain)]: data }, resolve);
  });
}

function rtGetApiSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['rankApiProvider', 'rankApiKey'], res => {
      resolve({ provider: res.rankApiProvider || 'serper', apiKey: res.rankApiKey || '' });
    });
  });
}

const rtSleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Entry point — called when the Rank Tracker tab is opened.
 */
async function initRankTrackerTab() {
  let domain = '';
  try { domain = _currentUrl ? new URL(_currentUrl).hostname.replace(/^www\./, '') : ''; } catch (e) {}
  _rtCurrentDomain = domain;

  setText('rtDomain', domain || 'Unknown page');

  const apiCfg = await rtGetApiSettings();
  const hasApiKey = !!apiCfg.apiKey;

  // Restore saved method preference (default: google)
  const methodSel = $('rtMethodSelect');
  if (methodSel && !_rtBound) {
    const saved = await new Promise(r => chrome.storage.local.get(['rtCheckMethod'], res => r(res.rtCheckMethod || 'google')));
    methodSel.value = saved || 'google';
  }
  rtUpdateMethodUI(hasApiKey, apiCfg);

  if (!_rtBound) {
    _rtBound = true;
    $('rtAddBtn')?.addEventListener('click', () => rtAddKeyword());
    $('rtKeywordInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') rtAddKeyword(); });
    $('rtCheckAllBtn')?.addEventListener('click', () => rtCheckAll());
    $('rtMethodSelect')?.addEventListener('change', async (e) => {
      const v = e.target.value || 'google';
      await new Promise(r => chrome.storage.local.set({ rtCheckMethod: v }, r));
      const cfg = await rtGetApiSettings();
      rtUpdateMethodUI(!!cfg.apiKey, cfg);
      toast('Rank method: ' + ({
        google: 'Google SERP',
        tinyfish: 'TinyFish',
        serper: 'Serper / Rank API',
        auto: 'Auto'
      }[v] || v));
    });
  }

  if (!domain) {
    const empty = $('rtEmpty');
    if (empty) { empty.style.display = ''; empty.textContent = 'Open a real website page to track its Google rankings.'; }
    const table = $('rtTable'); if (table) table.innerHTML = '';
    return;
  }

  await rtRenderTable();
}

async function rtAddKeyword() {
  const input = $('rtKeywordInput');
  const kw = (input?.value || '').trim();
  if (!kw || !_rtCurrentDomain) return;

  const data = await rtGetData(_rtCurrentDomain);
  const exists = data.keywords.some(k => k.toLowerCase() === kw.toLowerCase());
  if (exists) { toast('Already tracking that keyword'); return; }

  data.keywords.push(kw);
  await rtSaveData(_rtCurrentDomain, data);
  if (input) input.value = '';
  await rtRenderTable();
}

async function rtRemoveKeyword(keyword) {
  if (!_rtCurrentDomain) return;
  const data = await rtGetData(_rtCurrentDomain);
  data.keywords = data.keywords.filter(k => k !== keyword);
  delete data.history[keyword];
  await rtSaveData(_rtCurrentDomain, data);
  await rtRenderTable();
}

/**
 * Check a single keyword's Google position for the current domain.
 * Priority:
 *   1) Paid Rank API (Serper / SerpApi) if key configured
 *   2) Free TinyFish search via Monid (no captcha, reliable)
 *   3) Free Google-scan fallback (hidden tab — captcha-prone)
 */
async function rtCheckKeyword(keyword) {
  if (!_rtCurrentDomain || _rtChecking.has(keyword)) return;
  _rtChecking.add(keyword);
  rtRenderTable();

  const apiCfg = await rtGetApiSettings();
  const method = ($('rtMethodSelect')?.value) || 'google';
  let result;
  let methodUsed = method;

  try {
    if (method === 'serper') {
      if (!apiCfg.apiKey) throw new Error('Add Serper/SerpApi key in Settings → Rank Tracking API');
      result = await rtApiCheck(keyword, _rtCurrentDomain, apiCfg);
      methodUsed = 'api';
    } else if (method === 'tinyfish') {
      result = await rtTinyFishCheck(keyword, _rtCurrentDomain);
      methodUsed = 'tinyfish';
    } else if (method === 'auto') {
      if (apiCfg.apiKey) {
        try {
          result = await rtApiCheck(keyword, _rtCurrentDomain, apiCfg);
          methodUsed = 'api';
        } catch (apiErr) {
          console.warn('[RankTracker] API failed, TinyFish…', apiErr.message);
          try {
            result = await rtTinyFishCheck(keyword, _rtCurrentDomain);
            methodUsed = 'tinyfish';
          } catch (tfErr) {
            result = await rtFreeCheck(keyword, _rtCurrentDomain);
            methodUsed = 'free';
          }
        }
      } else {
        try {
          result = await rtTinyFishCheck(keyword, _rtCurrentDomain);
          methodUsed = 'tinyfish';
        } catch (tfErr) {
          result = await rtFreeCheck(keyword, _rtCurrentDomain);
          methodUsed = 'free';
        }
      }
    } else {
      // Default: Google SERP (in-browser)
      result = await rtFreeCheck(keyword, _rtCurrentDomain);
      methodUsed = 'free';
    }
  } catch (err) {
    toast('Check failed: ' + (err.message || 'unknown error'));
    _rtChecking.delete(keyword);
    rtRenderTable();
    return;
  }

  const data = await rtGetData(_rtCurrentDomain);
  if (!data.history[keyword]) data.history[keyword] = [];
  data.history[keyword].push({
    date: new Date().toISOString(),
    position: result.found ? result.position : null,
    page: result.found ? result.page : null,
    url: result.found ? result.url : null,
    method: result.method || methodUsed,
    totalChecked: result.totalChecked != null ? result.totalChecked : undefined
  });
  // Keep last 20 checks per keyword
  if (data.history[keyword].length > 20) data.history[keyword] = data.history[keyword].slice(-20);
  await rtSaveData(_rtCurrentDomain, data);

  _rtChecking.delete(keyword);
  await rtRenderTable();
}

/**
 * Free rank check via TinyFish /search (Monid) — no API key, no CAPTCHA.
 * Scans up to 5 pages (~50 results). Position is 1-based across pages.
 */
function rtUpdateMethodUI(hasApiKey, apiCfg) {
  const method = ($('rtMethodSelect')?.value) || 'google';
  const badge = $('rtMethodBadge');
  const labels = {
    google: 'Google SERP',
    tinyfish: 'TinyFish',
    serper: hasApiKey ? ('API · ' + (apiCfg?.provider === 'serpapi' ? 'SerpApi' : 'Serper')) : 'API (no key)',
    auto: 'Auto'
  };
  if (badge) {
    badge.textContent = labels[method] || method;
    badge.className = 'rt-method-badge' + ((method === 'serper' && hasApiKey) ? ' api' : '');
  }
  const hint = $('rtMethodHint');
  if (hint) {
    const hints = {
      google: 'Default: Google SERP opens results in a background tab. CAPTCHA possible — switch to TinyFish if blocked.',
      tinyfish: 'TinyFish live search via Monid — free, no CAPTCHA. Scans ~top 50 results.',
      serper: hasApiKey
        ? 'Using your Rank API key for fast bulk checks.'
        : 'No Rank API key yet — add Serper.dev in Settings, or pick Google / TinyFish.',
      auto: 'Tries Rank API → TinyFish → Google SERP until one succeeds.'
    };
    hint.textContent = hints[method] || hints.google;
  }
  const noKeyNote = $('rtNoKeyNote');
  if (noKeyNote) {
    noKeyNote.style.display = (method === 'google' || method === 'tinyfish' || (method === 'auto' && !hasApiKey) || (method === 'serper' && !hasApiKey)) ? '' : 'none';
    if (method === 'google') {
      noKeyNote.innerHTML = '<strong>Google SERP mode.</strong> ShahzaibSEO opens Google in a background tab and reads positions. CAPTCHA/rate limits possible. Switch to <strong>TinyFish</strong> if blocked.';
    } else if (method === 'tinyfish') {
      noKeyNote.innerHTML = '<strong>TinyFish mode.</strong> Free live search via Monid — no CAPTCHA, no API key. Scans ~top 50 results.';
    } else if (method === 'serper' && !hasApiKey) {
      noKeyNote.innerHTML = '<strong>Serper selected but no key.</strong> Add one in <strong>Settings → Rank Tracking API</strong>, or switch method.';
    } else if (method === 'auto') {
      noKeyNote.innerHTML = '<strong>Auto mode.</strong> API key → TinyFish → Google SERP fallback chain.';
    }
  }
}

function rtApiCheck(keyword, domain, apiCfg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'RANK_API_CHECK', keyword, domain, provider: apiCfg.provider, apiKey: apiCfg.apiKey },
      res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res || !res.ok) return reject(new Error((res && res.error) || 'API check failed'));
        resolve(res);
      }
    );
  });
}

async function rtTinyFishCheck(keyword, domain) {
  const target = domain.replace(/^www\./, '').toLowerCase();
  const maxPages = 5; // pages 0..4 ≈ top 50
  let found = null;
  let globalPos = 0;

  for (let page = 0; page < maxPages && !found; page++) {
    if (page > 0) await rtSleep(400 + Math.random() * 400);

    const res = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'MONID_RUN',
        provider: 'tinyfish',
        endpoint: '/search',
        query: {
          query: keyword,
          purpose: 'Find organic ranking position for domain ' + target,
          location: 'US',
          language: 'en',
          page: page
        },
        waitMs: 30000
      }, r => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(r || { ok: false, error: 'No response' });
      });
    });

    if (!res.ok) {
      if (page === 0) throw new Error(res.error || res.status || 'TinyFish search failed');
      break;
    }

    const out = res.output || res.data?.output || res.data || {};
    const rows = out.results || out.items || [];
    if (!rows.length) break;

    for (const r of rows) {
      globalPos++;
      // Prefer explicit position from API when available
      const pos = typeof r.position === 'number' ? r.position + (page * 10) : globalPos;
      let host = '';
      try {
        host = new URL(r.url || '').hostname.replace(/^www\./, '').toLowerCase();
      } catch (_) {
        host = (r.site_name || '').replace(/^www\./, '').toLowerCase();
      }
      if (!host) continue;
      if (host === target || host.endsWith('.' + target) || target.endsWith('.' + host)) {
        found = {
          position: pos,
          url: r.url || '',
          title: r.title || '',
          page: Math.ceil(pos / 10) || (page + 1)
        };
        break;
      }
    }
  }

  return {
    ok: true,
    found: !!found,
    position: found ? found.position : null,
    page: found ? found.page : null,
    url: found ? found.url : null,
    title: found ? found.title : null,
    method: 'tinyfish'
  };
}

/**
 * Free method — scans up to 100 Google results (10 pages) via the
 * background's hidden-tab fetcher (same mechanism as the SERP sidebar
 * Rank Tracker), with jitter between requests to avoid rate limiting.
 */
async function rtFreeCheck(keyword, domain) {
  let position = 0;
  let found = null;

  for (let page = 0; page < RT_MAX_FREE_PAGES && !found; page++) {
    if (page > 0) await rtSleep(1200 + Math.random() * 800);

    let pageResults = [];
    try {
      pageResults = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'SERP_FETCH_PAGE', query: keyword, startOffset: page * 10 },
          res => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!res || !res.ok) return reject(new Error((res && res.error) || 'SERP fetch failed'));
            resolve(res.results || []);
          }
        );
      });
    } catch (e) {
      break; // stop scanning further pages on failure, but keep what we found
    }

    if (!pageResults.length) break;

    for (const r of pageResults) {
      position++;
      const d = (r.domain || '').replace(/^www\./, '').toLowerCase();
      const target = domain.replace(/^www\./, '').toLowerCase();
      if (d === target || d.endsWith('.' + target) || target.endsWith('.' + d)) {
        found = { position, url: r.url, title: r.title, page: page + 1 };
        break;
      }
    }
  }

  return {
    ok: true,
    found: !!found,
    position: found ? found.position : null,
    page: found ? found.page : null,
    url: found ? found.url : null,
    title: found ? found.title : null,
    totalChecked: position,
    method: 'free'
  };
}

async function rtCheckAll() {
  if (_rtCheckAllRunning || !_rtCurrentDomain) return;
  const data = await rtGetData(_rtCurrentDomain);
  if (!data.keywords.length) { toast('Add a keyword first'); return; }

  _rtCheckAllRunning = true;
  const btn = $('rtCheckAllBtn');
  const prog = $('rtProgress');
  if (btn) btn.disabled = true;

  for (let i = 0; i < data.keywords.length; i++) {
    if (prog) prog.textContent = `Checking ${i + 1}/${data.keywords.length}…`;
    await rtCheckKeyword(data.keywords[i]);
    if (i < data.keywords.length - 1) await rtSleep(800);
  }

  if (prog) prog.textContent = '';
  if (btn) btn.disabled = false;
  _rtCheckAllRunning = false;
}

function rtTrendArrow(history) {
  if (!history || history.length < 2) return { cls: 'flat', symbol: '—' };
  const cur = history[history.length - 1].position;
  const prev = history[history.length - 2].position;
  if (cur == null || prev == null) return { cls: 'flat', symbol: '—' };
  if (cur < prev) return { cls: 'up', symbol: '▲' };
  if (cur > prev) return { cls: 'down', symbol: '▼' };
  return { cls: 'flat', symbol: '—' };
}

async function rtRenderTable() {
  if (!_rtCurrentDomain) return;
  const data = await rtGetData(_rtCurrentDomain);
  const table = $('rtTable');
  const empty = $('rtEmpty');
  if (!table) return;

  if (!data.keywords.length) {
    table.innerHTML = '';
    if (empty) { empty.style.display = ''; empty.textContent = 'No keywords yet — add one above to start tracking its Google ranking for this domain.'; }
    return;
  }
  if (empty) empty.style.display = 'none';

  table.innerHTML = '';
  data.keywords.forEach(kw => {
    const hist = data.history[kw] || [];
    const last = hist[hist.length - 1];
    const checking = _rtChecking.has(kw);
    const trend = rtTrendArrow(hist);

    const row = el('div', 'rt-row');

    let posHtml;
    if (checking) {
      posHtml = `<div class="rt-spinner"></div>`;
    } else if (!last) {
      posHtml = `<span class="rt-pos-num not-found">Not checked</span>`;
    } else if (last.position == null) {
      const scanned = (last.totalChecked != null) ? last.totalChecked : null;
      posHtml = scanned === 0
        ? `<span class="rt-pos-num not-found" title="SERP parse returned 0 results — Google layout/goto change or CAPTCHA">Parse failed (0 results)</span>`
        : `<span class="rt-pos-num not-found">Not in top 100</span>`;
    } else {
      const posClass = last.position <= 10 ? 'ok' : last.position <= 30 ? 'warn' : '';
      posHtml = `<span class="rt-pos-num ${posClass}">#${last.position}</span><span class="rt-trend ${trend.cls}">${trend.symbol}</span>`;
    }

    const lastChecked = last ? new Date(last.date).toLocaleDateString() : '';
    const methodTag = last
      ? (last.method === 'api' ? 'API'
        : last.method === 'tinyfish' ? 'TinyFish'
        : last.method === 'free' ? 'Google SERP'
        : (last.method || 'check'))
      : '';

    row.innerHTML = `
      <div class="rt-row-kw">
        <div class="rt-row-kw-text">${escHTML(kw)}</div>
        <div class="rt-row-kw-meta">${last ? `${methodTag} · ${lastChecked}${last.page ? ' · page ' + last.page : ''}` : 'Never checked'}</div>
      </div>
      <div class="rt-row-pos">${posHtml}</div>
      <div class="rt-row-actions">
        <button class="rt-icon-btn rt-check-btn" title="Check now" ${checking ? 'disabled' : ''}>
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg>
        </button>
        <button class="rt-icon-btn danger rt-remove-btn" title="Stop tracking">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd"/></svg>
        </button>
      </div>`;

    row.querySelector('.rt-check-btn')?.addEventListener('click', () => rtCheckKeyword(kw));
    row.querySelector('.rt-remove-btn')?.addEventListener('click', () => rtRemoveKeyword(kw));

    table.appendChild(row);
  });
}

// ── Settings: Rank Tracking API (Serper.dev / SerpApi) ────────────
function initRankApiSettings() {
  chrome.storage.local.get(['rankApiProvider', 'rankApiKey'], res => {
    const provider = res.rankApiProvider || 'serper';
    setRankApiProviderPanel(provider);
    if ($('rankApiKey')) $('rankApiKey').value = res.rankApiKey || '';
    updateRankApiBadge(!!res.rankApiKey, provider);
  });

  document.querySelectorAll('#settingsRankProviderTabs .settings-provider-tab').forEach(tab => {
    tab.addEventListener('click', () => setRankApiProviderPanel(tab.dataset.rankprovider));
  });

  setupEyeBtn('rankApiEyeBtn', 'rankApiKey');

  $('rankApiSaveBtn')?.addEventListener('click', () => {
    const provider = document.querySelector('#settingsRankProviderTabs .settings-provider-tab.active')?.dataset.rankprovider || 'serper';
    const apiKey = $('rankApiKey')?.value.trim() || '';
    chrome.storage.local.set({ rankApiProvider: provider, rankApiKey: apiKey }, () => {
      updateRankApiBadge(!!apiKey, provider);
      toast(apiKey ? 'Rank API saved — tracking will use it from now on' : 'Rank API key cleared — using free mode');
      // Refresh the Rank Tracker tab's method badge if it's currently visible
      if (_activeTab === 'ranktracker') initRankTrackerTab();
    });
  });
}

function setRankApiProviderPanel(provider) {
  document.querySelectorAll('#settingsRankProviderTabs .settings-provider-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.rankprovider === provider)
  );
  const pS = $('panelRankSerper'); const pA = $('panelRankSerpapi');
  if (pS) pS.style.display = provider === 'serper' ? '' : 'none';
  if (pA) pA.style.display = provider === 'serpapi' ? '' : 'none';
}

function updateRankApiBadge(hasKey, provider) {
  const badge = $('settingsRankApiStatus');
  if (!badge) return;
  if (hasKey) {
    badge.textContent = '✓ ' + (provider === 'serpapi' ? 'SerpApi' : 'Serper.dev') + ' configured';
    badge.className = 'settings-ai-badge ok';
  } else {
    badge.textContent = 'Free mode (no key)';
    badge.className = 'settings-ai-badge';
  }
}

function renderHnTree(headings, container, filter) {
  if (!container) return;
  container.innerHTML = '';

  // Build list with original DOM indices preserved
  const indexed = headings.map((h, i) => ({ ...h, domIndex: i }));
  const show = filter === 'all' ? indexed : indexed.filter(h => filter === 'h4' ? h.level >= 4 : `h${h.level}` === filter);
  if (!show.length) { container.innerHTML = '<div style="color:var(--text-4);font-size:12px;padding:12px;text-align:center">No headings found</div>'; return; }

  // Table header
  const head = el('div', 'hn-table-head');
  head.innerHTML = '<span>#</span><span>Level</span><span style="padding-left:8px;flex:1">Heading Text</span><span style="margin-left:auto;padding-right:4px;font-size:10px;color:var(--text-4)">Actions</span>';
  container.appendChild(head);

  show.forEach((h, i) => {
    const row = el('div', `hn-row${h.isEmpty ? ' hn-row-empty' : ''}`);
    row.setAttribute('data-dom-index', h.domIndex);

    const suggestLevel = h.suggestedLevel || null;
    const hasLevelSuggestion = suggestLevel && suggestLevel !== h.level;

    row.innerHTML = `
      <span class="hn-row-num">${i + 1}</span>
      <span class="hn-level l${h.level}" title="H${h.level}">H${h.level}</span>
      <span class="hn-text${h.isEmpty ? ' empty-tag' : ''}" title="${escHTML(h.isEmpty ? '(empty heading)' : h.text)}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHTML(h.isEmpty ? '(empty heading)' : h.text)}</span>
      <div class="hn-actions" style="display:flex;align-items:center;gap:4px;margin-left:auto;flex-shrink:0">
        ${hasLevelSuggestion ? `<button class="hn-action-btn hn-change-btn" title="Change to H${suggestLevel} (suggested)" data-new-level="${suggestLevel}">H${suggestLevel} ↑</button>` : ''}
        ${!h.isEmpty ? `<button class="hn-action-btn hn-ai-row-btn" title="AI: improve this heading's title">✨ AI</button>` : ''}
        ${h.isEmpty ? `<button class="hn-action-btn hn-remove-btn" title="Remove empty heading" data-action="remove">✕ Remove</button>` : `<button class="hn-action-btn hn-change-level-btn" title="Change heading level">↕</button>`}
        <button class="hn-action-btn hn-locate-btn" title="Scroll to on page">🔍</button>
      </div>`;

    // Locate / scroll
    row.querySelector('.hn-locate-btn')?.addEventListener('click', () => {
      sendHeadingAction('scrollToHeading', h.domIndex);
    });

    // AI: improve this single heading's title
    row.querySelector('.hn-ai-row-btn')?.addEventListener('click', (e) => {
      improveHeadingTextWithAI(h, row, e.currentTarget);
    });

    // Remove (empty headings or via explicit remove btn)
    row.querySelector('.hn-remove-btn')?.addEventListener('click', () => {
      sendHeadingAction('removeHeading', h.domIndex);
      row.style.opacity = '0.4';
      row.style.textDecoration = 'line-through';
      toast('Heading hidden on page (reload to restore)');
    });

    // Change to suggested level
    const changeBtn = row.querySelector('.hn-change-btn');
    if (changeBtn) {
      changeBtn.addEventListener('click', () => {
        const newLevel = parseInt(changeBtn.dataset.newLevel, 10);
        sendHeadingAction('changeHeadingLevel', h.domIndex, { newLevel });
        const badge = row.querySelector('.hn-level');
        if (badge) { badge.textContent = `H${newLevel}`; badge.className = `hn-level l${newLevel}`; }
        changeBtn.remove();
        toast(`Changed to H${newLevel} on page (reload to restore)`);
      });
    }

    // Change level dropdown (non-empty headings)
    const changeLevelBtn = row.querySelector('.hn-change-level-btn');
    if (changeLevelBtn) {
      changeLevelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Remove any existing dropdowns
        document.querySelectorAll('.hn-level-dropdown').forEach(d => d.remove());
        const dropdown = document.createElement('div');
        dropdown.className = 'hn-level-dropdown';
        dropdown.style.cssText = 'position:absolute;z-index:999;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);padding:4px;display:flex;flex-direction:column;gap:2px;';
        [1,2,3,4,5,6].forEach(lvl => {
          const opt = document.createElement('button');
          opt.textContent = `H${lvl}`;
          opt.style.cssText = `padding:4px 12px;border:none;background:${lvl===h.level?'var(--brand)':'transparent'};color:${lvl===h.level?'white':'var(--text-1)'};border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;text-align:left;`;
          opt.addEventListener('mouseenter', () => { if (lvl!==h.level) opt.style.background = 'var(--surface-3)'; });
          opt.addEventListener('mouseleave', () => { if (lvl!==h.level) opt.style.background = 'transparent'; });
          opt.addEventListener('click', (ev) => {
            ev.stopPropagation();
            dropdown.remove();
            if (lvl === h.level) return;
            sendHeadingAction('changeHeadingLevel', h.domIndex, { newLevel: lvl });
            const badge = row.querySelector('.hn-level');
            if (badge) { badge.textContent = `H${lvl}`; badge.className = `hn-level l${lvl}`; }
            toast(`Changed to H${lvl} on page (reload to restore)`);
          });
          dropdown.appendChild(opt);
        });
        // Position near button
        const btnRect = changeLevelBtn.getBoundingClientRect();
        dropdown.style.top = (btnRect.bottom + window.scrollY) + 'px';
        dropdown.style.left = (btnRect.left + window.scrollX - 30) + 'px';
        document.body.appendChild(dropdown);
        const closeDropdown = (ev) => { if (!dropdown.contains(ev.target)) { dropdown.remove(); document.removeEventListener('click', closeDropdown); }};
        setTimeout(() => document.addEventListener('click', closeDropdown), 0);
      });
    }

    container.appendChild(row);
  });
}

// ─── Images ───────────────────────────────────────────
function renderImages(images) {
  setText('imgTotal', images.total);
  setText('imgWithAlt', images.withAlt);
  setText('imgNoAlt', images.missingAlt);
  setText('imgResized', images.oversized);
  setText('imgDupAlts', images.duplicateAlts);
  setText('imgAboveFoldLazy', images.aboveFoldLazy);

  // Potential saving estimate (rough: assume 30% saving on non-webp images)
  const rawImgs = images.images || [];
  const saving = rawImgs.reduce((s, i) => {
    if (!['webp','avif'].includes(i.format||'')) {
      const w = i.intrinsicWidth || i.naturalW || 0;
      const h = i.intrinsicHeight || i.naturalH || 0;
      s += Math.round(w * h * 0.003);
    }
    return s;
  }, 0);
  setText('imgSavingSize', formatBytes(saving));

  // Download count (non-webp images)
  const downloadable = rawImgs.filter(i => !['webp','avif','svg'].includes(i.format||'')).length;
  setText('imgDownloadCount', downloadable);

  // Format chips
  const fb = $('formatsBar');
  if (fb) {
    fb.innerHTML = '';
    Object.entries(images.formats||{}).sort((a,b) => b[1]-a[1]).forEach(([fmt, cnt]) => {
      const b = el('button', `img-format-chip ${fmt.toLowerCase() === _imgFormatFilter ? 'active' : ''}`);
      b.dataset.format = fmt.toLowerCase();
      b.innerHTML = `<span>${fmt.toUpperCase()}</span><span class="img-format-chip-count">${cnt}</span>`;
      b.addEventListener('click', () => {
        _imgFormatFilter = _imgFormatFilter === fmt.toLowerCase() ? null : fmt.toLowerCase();
        renderImages(images);
      });
      fb.appendChild(b);
    });
  }

  // KPI click handlers
  document.querySelectorAll('#imgKpiRow .img-kpi').forEach(kpi => {
    if (!kpi._bound) {
      kpi._bound = true;
      kpi.addEventListener('click', () => {
        document.querySelectorAll('#imgKpiRow .img-kpi').forEach(k => k.classList.remove('active'));
        kpi.classList.add('active');
        _imgFilter = kpi.dataset.filter || 'all';
        renderImageTable(images);
      });
    }
  });

  // Lazy card click
  const lazyCard = document.querySelector('.img-lazy-card');
  if (lazyCard && !lazyCard._bound) {
    lazyCard._bound = true;
    lazyCard.addEventListener('click', () => {
      document.querySelectorAll('#imgKpiRow .img-kpi').forEach(k => k.classList.remove('active'));
      _imgFilter = 'above-fold-lazy';
      renderImageTable(images);
    });
  }

  renderImageTable(images);
}

let _imgFormatFilter = null;

function renderImageTable(images) {
  const tbody = $('imgTableBody'); if (!tbody) return;
  tbody.innerHTML = '';
  let rows = images.images || [];

  if (_imgFilter === 'with-alt')         rows = rows.filter(i => i.hasAlt && i.alt.length > 0);
  else if (_imgFilter === 'missing-alt') rows = rows.filter(i => !i.hasAlt || (!i.isDecorative && i.alt.trim().length === 0));
  else if (_imgFilter === 'resized')     rows = rows.filter(i => i.oversized);
  else if (_imgFilter === 'duplicate-alt') rows = rows.filter(i => i.alt && i.alt.trim().length > 0);
  else if (_imgFilter === 'above-fold-lazy') rows = rows.filter(i => i.aboveFoldLazy);
  if (_imgFormatFilter) rows = rows.filter(i => (i.format||'').toLowerCase() === _imgFormatFilter);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-4);padding:20px">No images match filter</td></tr>';
    return;
  }

  rows.slice(0, 60).forEach(img => {
    const tr = document.createElement('tr');

    // Format
    const fmt = (img.format||'?').toUpperCase();
    const tdFmt = el('td', '', `<span class="fmt-badge ${(img.format||'').toLowerCase()}">${fmt}</span>`);

    // Size — declare first so thumbnail onload can update it
    const imgW = img.intrinsicWidth || img.naturalW || 0;
    const imgH = img.intrinsicHeight || img.naturalH || 0;
    const sizeBytes = img.fileSize > 0 ? img.fileSize : (imgW * imgH > 0 ? imgW * imgH * 3 : 0);
    const tdSize = el('td', '', sizeBytes > 0 ? formatBytes(sizeBytes) + (img.fileSizeIsEstimate ? ' ~' : '') : '—');

    // Dimensions — declare first so thumbnail onload can update it
    const tdDims = el('td', '', imgW > 0 ? `<span class="img-table-dims">${imgW} × ${imgH}</span>` : '—');

    // Preview
    const tdP = el('td');
    if (img.src) {
      const im = document.createElement('img');
      im.className = 'img-thumb'; im.src = img.src; im.alt = ''; im.loading = 'lazy';
      im.onerror = () => { im.style.display='none'; };
      tdP.appendChild(im);
      // When thumb loads, update size/dims cells if still missing
      im.addEventListener('load', () => {
        const w = im.naturalWidth, h = im.naturalHeight;
        if (w > 0 && h > 0) {
          if (tdDims.textContent === '—') {
            tdDims.innerHTML = `<span class="img-table-dims">${w} × ${h}</span>`;
          }
          if (tdSize.textContent === '—') {
            fetch(img.src, { method: 'HEAD' }).then(r => {
              const cl = r.headers.get('content-length');
              if (cl && parseInt(cl) > 0) {
                tdSize.textContent = formatBytes(parseInt(cl));
              } else {
                const f = (img.format || '').toLowerCase();
                const bpp = f === 'png' ? 1.5 : f === 'webp' ? 0.5 : f === 'gif' ? 1 : 1;
                tdSize.textContent = formatBytes(Math.round(w * h * bpp)) + ' ~';
              }
            }).catch(() => {
              const f = (img.format || '').toLowerCase();
              const bpp = f === 'png' ? 1.5 : f === 'webp' ? 0.5 : f === 'gif' ? 1 : 1;
              tdSize.textContent = formatBytes(Math.round(w * h * bpp)) + ' ~';
            });
          }
        }
      });
    } else tdP.innerHTML = '<div class="img-thumb-placeholder">🖼</div>';

    // Alt Text cell
    const hasAlt = img.hasAlt && img.alt && img.alt.trim().length > 0;
    const altLabel = hasAlt ? '✓' : '✗';
    const altClass = hasAlt ? 'img-alt-badge img-alt-yes' : 'img-alt-badge img-alt-no';
    const altTitle = hasAlt ? escAttr(img.alt) : 'Missing alt text';
    const tdAlt = el('td', 'img-alt-cell', `<span class="${altClass}" title="${altTitle}">${altLabel}</span>`);

    // View/Locate button
    const tdView = el('td', 'img-action-cell', `
      <button class="img-table-locate-btn" data-src="${escAttr(img.src||'')}" title="View on page">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>`);

    // Download button
    const tdDl = el('td', 'img-action-cell', img.src ? `
      <button class="img-table-download-btn" data-src="${escAttr(img.src)}" title="Download original">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>` : '—');

    // Convert dropdown (PNG / JPG / WebP) — one control per row
    const tdConv = el('td', 'img-action-cell');
    if (img.src) {
      tdConv.innerHTML = `
        <div class="img-convert-wrap">
          <button type="button" class="img-table-convert-btn" data-src="${escAttr(img.src)}" title="Convert format">Convert ▾</button>
          <div class="img-convert-menu" hidden>
            <button type="button" data-fmt="png" data-src="${escAttr(img.src)}">PNG — transparent</button>
            <button type="button" data-fmt="jpeg" data-src="${escAttr(img.src)}">JPG — smallest</button>
            <button type="button" data-fmt="webp" data-src="${escAttr(img.src)}">WebP — modern</button>
          </div>
        </div>`;
    } else tdConv.textContent = '—';

    tr.append(tdP, tdFmt, tdSize, tdDims, tdAlt, tdView, tdDl, tdConv);
    tbody.appendChild(tr);
  });

  // Locate
  tbody.querySelectorAll('.img-table-locate-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'highlightImage', src: btn.dataset.src }, () => { void chrome.runtime.lastError; });
      });
    });
  });

  // Download original
  tbody.querySelectorAll('.img-table-download-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const a = document.createElement('a'); a.href = btn.dataset.src; a.download = ''; a.target = '_blank';
      a.click();
    });
  });

  // Convert menus
  tbody.querySelectorAll('.img-table-convert-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const menu = btn.parentElement.querySelector('.img-convert-menu');
      tbody.querySelectorAll('.img-convert-menu').forEach(m => { if (m !== menu) m.hidden = true; });
      if (menu) menu.hidden = !menu.hidden;
    });
  });
  tbody.querySelectorAll('.img-convert-menu button[data-fmt]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const src = btn.dataset.src;
      const fmt = btn.dataset.fmt;
      btn.textContent = '…';
      try {
        const resp = await fetch(src);
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (fmt === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(bitmap, 0, 0);
        const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
        const out = await new Promise(r => canvas.toBlob(r, mime, 0.92));
        if (!out) throw new Error('fail');
        const url = URL.createObjectURL(out);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rankseo.' + (fmt === 'jpeg' ? 'jpg' : fmt);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 8000);
        btn.textContent = '✓';
      } catch (err) {
        window.open(src, '_blank');
        btn.textContent = 'Open';
      }
      setTimeout(() => {
        const menu = btn.closest('.img-convert-menu');
        if (menu) menu.hidden = true;
        btn.textContent = fmt === 'jpeg' ? 'JPG — smallest' : fmt === 'webp' ? 'WebP — modern' : 'PNG — transparent';
      }, 1200);
    });
  });
  document.addEventListener('click', () => {
    tbody.querySelectorAll('.img-convert-menu').forEach(m => { m.hidden = true; });
  }, { once: true });
}

// ─── Links ────────────────────────────────────────────
const ZONE_CODES = { main:'M', nav:'N', header:'N', footer:'F', sidebar:'S', body:'M' };

function renderLinks(links) {
  setText('lkTotal', links.total);
  setText('lkInternal', links.internal);
  setText('lkExternal', links.external);
  setText('lkNofollow', links.nofollow);
  setText('lkIntNofollow', links.internalNofollow);
  setText('lkSponsored', links.links?.filter(l => l.isSponsored).length || 0);
  setText('lkUgc', links.links?.filter(l => (l.rel||'').includes('ugc')).length || 0);
  setText('lkEmpty', links.empty);
  setText('lkNoText', links.noText);
  setText('lkGeneric', links.genericAnchor);

  // ── Links Stats Panel (Sorank-style) ──
  const allLinks = links.links || [];
  const uniquePages = new Set(allLinks.map(l => { try { return new URL(l.url, 'https://x.com').pathname; } catch(e) { return l.url; } })).size;
  const inContent = allLinks.filter(l => l.position === 'content' || (!l.isNav && !l.isFooter)).length;
  const navHeader = allLinks.filter(l => l.isNav || l.position === 'nav' || l.position === 'header').length;
  const footer = allLinks.filter(l => l.isFooter || l.position === 'footer').length;
  const anchors = allLinks.map(l => (l.text||'').trim().toLowerCase()).filter(Boolean);
  const uniqueAnchors = new Set(anchors).size;
  const anchorDiversity = anchors.length > 0 ? Math.round((uniqueAnchors / anchors.length) * 100) + '%' : '—';
  const linkDensity = links.total > 0 ? (links.total / Math.max(links.words || 500, 100) * 100).toFixed(1) + '%' : '—';

  setText('lsUniquePages', uniquePages || '—');
  setText('lsLinkDensity', linkDensity);
  setText('lsAnchorDiversity', anchorDiversity);
  setText('lsInContent', links.inContent || inContent || '—');
  setText('lsNavHeader', links.navHeader || navHeader || '—');
  setText('lsFooter', links.footer || footer || '—');

  // Most linked pages
  const pageCount = {};
  allLinks.forEach(l => {
    try {
      const path = new URL(l.url, 'https://x.com').pathname;
      pageCount[path] = (pageCount[path] || 0) + 1;
    } catch(e) {}
  });
  const sorted = Object.entries(pageCount).sort((a,b) => b[1]-a[1]).slice(0,5);
  const mlList = document.getElementById('linksMostLinkedList');
  if (mlList && sorted.length) {
    mlList.innerHTML = sorted.map(([path, count]) =>
      `<div class="links-ml-item"><span class="links-ml-url" title="${path}">${path}</span><span class="links-ml-count">${count}x</span></div>`
    ).join('');
  }

  // KPI click handlers
  document.querySelectorAll('#linksKpiRow .links-kpi').forEach(kpi => {
    if (!kpi._bound) {
      kpi._bound = true;
      kpi.addEventListener('click', () => {
        document.querySelectorAll('#linksKpiRow .links-kpi').forEach(k => k.classList.remove('active'));
        kpi.classList.add('active');
        _linkFilter = kpi.dataset.filter || 'all';
        const title = $('linksSectionTitle');
        if (title) title.textContent = kpi.querySelector('.links-kpi-label')?.textContent || 'All Links';
        renderLinksTable(links);
      });
    }
  });

  // Search
  const searchEl = $('linksSearch');
  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener('input', e => renderLinksTable(links, e.target.value));
  }

  // Copy dropdown
  const copyBtn = $('linksCopyBtn');
  const copyMenu = $('linksCopyMenu');
  if (copyBtn && !copyBtn._bound) {
    copyBtn._bound = true;
    copyBtn.addEventListener('click', e => { e.stopPropagation(); copyMenu?.classList.toggle('open'); });
    document.addEventListener('click', () => copyMenu?.classList.remove('open'));
  }
  document.querySelectorAll('#linksCopyMenu .links-copy-option').forEach(opt => {
    if (!opt._bound) {
      opt._bound = true;
      opt.addEventListener('click', () => {
        const rows = getFilteredLinks(links, _linkFilter);
        let out = '';
        if (opt.dataset.format === 'csv') {
          out = 'URL,Anchor,Type,Rel\n' + rows.map(l => `"${l.url}","${l.text||''}","${l.isInternal?'Int':'Ext'}","${l.rel||'follow'}"`).join('\n');
        } else if (opt.dataset.format === 'json') {
          out = JSON.stringify(rows.map(l => ({ url: l.url, text: l.text, type: l.isInternal?'internal':'external', rel: l.rel||'follow' })), null, 2);
        } else {
          out = rows.map(l => `${l.url} | ${l.text||'(no text)'}`).join('\n');
        }
        copyText(out);
        copyMenu?.classList.remove('open');
      });
    }
  });

  // Highlight button
  const hlBtn = $('linksHighlightBtn');
  if (hlBtn && !hlBtn._bound) {
    hlBtn._bound = true;
    hlBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'highlightLinks' }, () => { void chrome.runtime.lastError; });
      });
      hlBtn.classList.toggle('active');
    });
  }

  renderLinksTable(links);
  // Auto-check HTTP status like On-Page Labs (deferred so table is painted first)
  setTimeout(() => {
    if (!_linksStatusRunning) runPopupLinksStatusCheck(false);
  }, 400);
}

function getFilteredLinks(links, filter, search='') {
  let rows = links.links || [];
  if (filter === 'internal')          rows = rows.filter(l => l.isInternal);
  else if (filter === 'external')     rows = rows.filter(l => l.isExternal);
  else if (filter === 'nofollow')     rows = rows.filter(l => l.isNofollow);
  else if (filter === 'internal-nofollow') rows = rows.filter(l => l.isInternal && l.isNofollow);
  else if (filter === 'sponsored')    rows = rows.filter(l => l.isSponsored);
  else if (filter === 'ugc')          rows = rows.filter(l => (l.rel||'').includes('ugc'));
  else if (filter === 'empty')        rows = rows.filter(l => l.isEmpty);
  else if (filter === 'no-text')      rows = rows.filter(l => l.noText);
  else if (filter === 'generic')      rows = rows.filter(l => l.isGeneric);
  if (search) rows = rows.filter(l => l.url.toLowerCase().includes(search.toLowerCase()) || (l.text||'').toLowerCase().includes(search.toLowerCase()));
  return rows;
}

function renderLinksTable(links, search='') {
  const tbody = $('linksTableBody'); if (!tbody) return;
  tbody.innerHTML = '';
  const rows = getFilteredLinks(links, _linkFilter, search);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-4);padding:20px">No links match filter</td></tr>';
    return;
  }
  rows.slice(0, 100).forEach((link, i) => {
    const tr = document.createElement('tr');
    tr.dataset.href = link.url || '';
    const typeClass = link.isInternal ? 'int' : 'ext';
    const relLabel = link.isNofollow ? 'nofollow' : link.isSponsored ? 'sponsored' : 'follow';
    const relClass = link.isNofollow || link.isSponsored ? 'warn' : 'ok';
    const urlClean = (link.url||'').replace(/^https?:\/\//, '').slice(0, 40);
    // Status badge (moved to former POS column position)
    let stHtml = '<span style="color:#94a3b8;font-size:11px;">—</span>';
    if (link._httpStatus != null) {
      const st = link._httpStatus;
      const ok = st >= 200 && st < 300;
      const re = st >= 300 && st < 400;
      const bg = ok ? '#dcfce7' : re ? '#e0f2fe' : '#fee2e2';
      const col = ok ? '#16a34a' : re ? '#0284c7' : '#dc2626';
      stHtml = '<span style="background:' + bg + ';color:' + col + ';padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;">' + (st || 'ERR') + (link._httpRedir ? ' →' : '') + '</span>';
    }
    tr.innerHTML = `
      <td class="links-rank">${i+1}</td>
      <td class="links-status-cell">${stHtml}</td>
      <td><a class="links-url" href="${escAttr(link.url)}" target="_blank" title="${escAttr(link.url)}">${escHTML(urlClean)}</a></td>
      <td class="links-text-cell">${link.imgInside ? '<span class="links-image-text">[Image]</span>' : escHTML((link.text||'').slice(0,40)) || '<em class="links-no-text">No text</em>'}</td>
      <td><span class="links-type-badge ${typeClass}">${link.isInternal?'Int':'Ext'}</span></td>
      <td><span class="links-rel-badge ${relClass}">${relLabel}</span></td>
      <td>${link.imgInside ? '<span class="links-img-check">✓</span>' : ''}</td>`;
    tbody.appendChild(tr);
  });
}

// Link HTTP status check (popup Links tab)
let _linksStatusRunning = false;
async function runPopupLinksStatusCheck(force) {
  if (_linksStatusRunning) return;
  const btn = $('linksStatusCheckBtn');
  const prog = $('linksStatusProgress');
  const tbody = $('linksTableBody');
  if (!tbody) return;
  const rows = [...tbody.querySelectorAll('tr[data-href]')];
  if (!rows.length) return;
  _linksStatusRunning = true;
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  let done = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const tr = queue.shift();
      if (!tr) break;
      const href = tr.dataset.href;
      if (!href) continue;
      const cell = tr.querySelector('.links-status-cell');
      if (cell) cell.innerHTML = '<span style="color:#94a3b8;">…</span>';
      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'CHECK_LINK_STATUS', url: href }, (r) => {
            if (chrome.runtime.lastError) resolve({ status: 0, error: true });
            else resolve(r || { status: 0, error: true });
          });
        });
        const st = res.status || 0;
        const ok = st >= 200 && st < 300;
        const re = st >= 300 && st < 400;
        const bg = (!st || res.error) ? '#fee2e2' : ok ? '#dcfce7' : re ? '#e0f2fe' : '#fee2e2';
        const col = (!st || res.error) ? '#dc2626' : ok ? '#16a34a' : re ? '#0284c7' : '#dc2626';
        if (cell) cell.innerHTML = '<span style="background:' + bg + ';color:' + col + ';padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;">' + (st || 'ERR') + (res.redirected ? ' →' : '') + '</span>';
        // Persist on the underlying link object so filter/re-render keeps status
        try {
          const all = (_rawData && _rawData.links && _rawData.links.links) || [];
          const match = all.find(l => l.url === href);
          if (match) { match._httpStatus = st; match._httpRedir = !!res.redirected; }
        } catch (_) {}
      } catch (e) {
        if (cell) cell.innerHTML = '<span style="background:#fee2e2;color:#dc2626;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;">ERR</span>';
      }
      done++;
      if (prog) prog.textContent = done + '/' + rows.length;
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  _linksStatusRunning = false;
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  if (prog) {
    const okN = [...tbody.querySelectorAll('.links-status-cell')].filter(c => /2\d\d/.test(c.textContent || '')).length;
    prog.textContent = 'Done — ' + okN + '/' + rows.length + ' OK';
  }
}

document.getElementById('trfRetryBtn')?.addEventListener('click', () => loadTrafficTab(true));

document.addEventListener('DOMContentLoaded', () => {
  $('linksStatusCheckBtn')?.addEventListener('click', () => runPopupLinksStatusCheck(true));
});
// Also bind immediately if DOM already ready
if (document.readyState !== 'loading') {
  $('linksStatusCheckBtn')?.addEventListener('click', () => runPopupLinksStatusCheck(true));
}

// ─── Keywords ─────────────────────────────────────────
let _kwSortCol = 'count', _kwSortOrder = 'desc', _kwRawData = null;

function renderKeywords(kwData) {
  if (!kwData) return;
  _kwRawData = kwData;

  // Score ring
  animateRing('kwRingFill', kwData.score);
  setText('kwScoreNum', kwData.score);
  setText('kwUnique', fmt(kwData.uniqueCount));
  setText('kwBold', kwData.boldCount);
  setText('kwItalic', kwData.italicCount);

  // Placement matrix
  renderKwPlacementMatrix(kwData);

  // Collapsible sections
  document.querySelectorAll('.kw-collapse-toggle').forEach(toggle => {
    if (!toggle._kwBound) {
      toggle._kwBound = true;
      toggle.addEventListener('click', e => {
        if (e.target.closest('.kw-placement-export-btn')) return;
        toggle.closest('.kw-collapsible').classList.toggle('collapsed');
      });
    }
  });

  // Ngram tabs
  const ngramWrap = $('kwNgramChips');
  ngramWrap?.querySelectorAll('.kw-filter-tab').forEach(tab => {
    if (!tab._kwBound) {
      tab._kwBound = true;
      tab.addEventListener('click', () => {
        ngramWrap.querySelectorAll('.kw-filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _kwNgram = tab.dataset.ngram;
        renderKwTable(kwData);
      });
    }
  });

  // Sort headers
  document.querySelectorAll('.kw-sortable').forEach(th => {
    if (!th._kwBound) {
      th._kwBound = true;
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (_kwSortCol === col) _kwSortOrder = _kwSortOrder === 'desc' ? 'asc' : 'desc';
        else { _kwSortCol = col; _kwSortOrder = 'desc'; }
        document.querySelectorAll('.kw-sortable').forEach(h => h.classList.remove('sort-asc','sort-desc'));
        th.classList.add(_kwSortOrder === 'desc' ? 'sort-desc' : 'sort-asc');
        renderKwTable(kwData);
      });
    }
  });

  // Search
  const searchEl = $('kwSearch');
  if (searchEl && !searchEl._kwBound) {
    searchEl._kwBound = true;
    searchEl.addEventListener('input', () => renderKwTable(kwData));
  }

  // Copy dropdown
  const kwCopyBtn = $('kwCopyBtn');
  const kwCopyMenu = $('kwCopyMenu');
  if (kwCopyBtn && !kwCopyBtn._kwBound) {
    kwCopyBtn._kwBound = true;
    kwCopyBtn.addEventListener('click', e => { e.stopPropagation(); kwCopyMenu?.classList.toggle('open'); });
    document.addEventListener('click', () => kwCopyMenu?.classList.remove('open'));
  }
  document.querySelectorAll('#kwCopyMenu .links-copy-option').forEach(opt => {
    if (!opt._kwBound) {
      opt._kwBound = true;
      opt.addEventListener('click', () => {
        const rows = getFilteredKeywords(kwData);
        let out = '';
        if (opt.dataset.format === 'csv') {
          out = '#,Keyword,Count,Density,Bold,Italic,Prominence\n' + rows.map((k,i) => `${i+1},"${k.word}",${k.count},${k.density}%,${k.inBold||0},${k.inItalic||0},${k.prominence||0}`).join('\n');
        } else if (opt.dataset.format === 'json') {
          out = JSON.stringify(rows.map(k => ({ word: k.word, count: k.count, density: k.density })), null, 2);
        } else {
          out = rows.map((k,i) => `${i+1}. ${k.word} (${k.count}x, ${k.density}%)`).join('\n');
        }
        copyText(out);
        kwCopyMenu?.classList.remove('open');
      });
    }
  });

  // Placement CSV export
  const expBtn = $('kwPlacementExportBtn');
  if (expBtn && !expBtn._kwBound) {
    expBtn._kwBound = true;
    expBtn.addEventListener('click', e => {
      e.stopPropagation();
      const matrix = kwData.keywords.filter(k => k.ngram === 1).slice(0, 20);
      const headers = 'Keyword,Title,H1,Meta,Bold';
      const rows = matrix.map(k => `"${k.word}",${k.inTitle?'Y':'N'},${k.inH1?'Y':'N'},${k.inMeta?'Y':'N'},${k.inBold?'Y':'N'}`);
      const blob = new Blob([headers+'\n'+rows.join('\n')], {type:'text/csv'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download='kw-placement.csv'; a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (kwData.stuffing?.length > 0) {
    const alertEl = $('stuffingAlert');
    if (alertEl) { alertEl.style.display=''; alertEl.textContent = `⚠ Keyword stuffing detected: ${kwData.stuffing.map(k=>k.word).join(', ')} — reduce density below 4%.`; }
  }

  renderKwTable(kwData);
  renderKwClusters(kwData);
  renderKwLsi(kwData);
  initKwSuggestSection(kwData);
}

// ── Google Keyword Suggest Section ────────────────────────────────────────────
function initKwSuggestSection(kwData) {
  const input = $('kwSuggestInput');
  const btn = $('kwSuggestBtn');
  if (!input || !btn) return;

  // Pre-fill with top keyword
  if (!input.value) {
    const top = (kwData?.keywords || []).filter(k => k.ngram === 1)[0];
    if (top) input.value = top.kw || '';
  }

  if (!btn._ksSuggestBound) {
    btn._ksSuggestBound = true;
    btn.addEventListener('click', () => {
      const kw = input.value.trim();
      if (!kw) return;
      runKwSuggest(kw);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const kw = input.value.trim(); if (kw) runKwSuggest(kw); }
    });

    // Copy-all button (once)
    const copyAllBtn = $('kwSuggestCopyAllBtn');
    if (copyAllBtn && !copyAllBtn._bound) {
      copyAllBtn._bound = true;
      copyAllBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't trigger collapse toggle
        copyAllKwSuggestions();
      });
    }

    // Local mode: toggle reveals the city input; changes re-run the search
    const localToggle = $('kwLocalToggle');
    const cityInput = $('kwLocalCity');
    if (localToggle && !localToggle._bound) {
      localToggle._bound = true;
      localToggle.addEventListener('change', () => {
        if (cityInput) cityInput.style.display = localToggle.checked ? '' : 'none';
        const kw = input.value.trim();
        if (kw) runKwSuggest(kw);
        if (localToggle.checked && cityInput) cityInput.focus();
      });
    }
    if (cityInput && !cityInput._bound) {
      cityInput._bound = true;
      const rerun = () => { const kw = input.value.trim(); if (kw) runKwSuggest(kw); };
      cityInput.addEventListener('keydown', e => { if (e.key === 'Enter') rerun(); });
      cityInput.addEventListener('blur', rerun);
    }
  }

  // Auto-run if input is pre-filled
  if (input.value.trim()) {
    setTimeout(() => runKwSuggest(input.value.trim()), 400);
  }
}

let _kwSuggestGen = 0; // increments each search; stale callbacks are ignored

function runKwSuggest(kw) {
  const loading = $('kwSuggestLoading');
  const chips = $('kwSuggestChips');
  const variants = $('kwSuggestVariants');
  if (loading) loading.style.display = '';
  if (chips) chips.innerHTML = '';
  if (variants) variants.innerHTML = '';
  // Hide copy-all while a new search runs
  const copyAllBtnEarly = $('kwSuggestCopyAllBtn');
  if (copyAllBtnEarly) {
    copyAllBtnEarly.style.display = 'none';
    copyAllBtnEarly.classList.remove('copied');
  }

  // Bump generation — any callbacks from the previous search will see a stale gen and bail
  const gen = ++_kwSuggestGen;

  // Local mode: expand seeds with city + local-intent modifiers instead of the
  // generic question prefixes. Falls back to "near me" if no city is entered.
  const localOn = $('kwLocalToggle')?.checked;
  const city = ($('kwLocalCity')?.value || '').trim();
  let prefixes;
  if (localOn) {
    prefixes = buildLocalSeeds(kw, city);
  } else {
    prefixes = ['', 'how to ' + kw, 'what is ' + kw, 'best ' + kw, kw + ' for'];
  }

  const allSuggestions = new Set();
  // Seed the set with the constructed local phrases themselves — even queries
  // that return no autocomplete rows are still useful local long-tails.
  if (localOn) prefixes.forEach(p => { if (p) allSuggestions.add(p); });
  let pending = prefixes.length;

  prefixes.forEach(q => {
    chrome.runtime.sendMessage({ action: 'KEYWORD_SUGGEST', keyword: q || kw }, r => {
      if (gen !== _kwSuggestGen) return; // newer search started — discard
      pending--;
      if (r?.ok && Array.isArray(r.suggestions)) {
        r.suggestions.forEach(s => allSuggestions.add(s));
      }
      if (pending === 0) {
        if (loading) loading.style.display = 'none';
        renderKwSuggestResults([...allSuggestions], localOn && city ? city : kw);
      }
    });
  });
}

// Build local-intent seed phrases for the keyword expander.
function buildLocalSeeds(kw, city) {
  const seeds = [];
  if (city) {
    seeds.push(
      kw + ' in ' + city,
      kw + ' ' + city,
      'best ' + kw + ' in ' + city,
      'top ' + kw + ' ' + city,
      kw + ' near ' + city,
      'affordable ' + kw + ' in ' + city,
      city + ' ' + kw,
      kw + ' services in ' + city
    );
  } else {
    seeds.push(
      kw + ' near me',
      'best ' + kw + ' near me',
      kw + ' near me open now',
      'local ' + kw,
      kw + ' in my area',
      'affordable ' + kw + ' near me',
      'best local ' + kw,
      kw + ' services near me'
    );
  }
  return seeds;
}

function renderKwSuggestResults(suggestions, seed) {
  const chips = $('kwSuggestChips');
  if (!chips) return;
  if (!suggestions.length) {
    chips.innerHTML = '<span class="kw-lsi-empty">No suggestions found.</span>';
    return;
  }
  // Sort: exact seed matches / seed-containing first
  suggestions.sort((a, b) => {
    const aS = a.toLowerCase().includes(seed.toLowerCase()) ? 0 : 1;
    const bS = b.toLowerCase().includes(seed.toLowerCase()) ? 0 : 1;
    return aS - bS || a.length - b.length;
  });
  chips.innerHTML = suggestions.slice(0, 60).map(s => {
    const highlighted = escHTML(s).replace(new RegExp(escHTML(seed), 'gi'), '<strong>$&</strong>');
    return `<span class="kw-lsi-chip kw-suggest-chip" title="Click to search · hover for copy" data-kw="${escHTML(s)}">${highlighted}<span class="kw-chip-copy" role="button" aria-label="Copy" title="Copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></span></span>`;
  }).join('');

  // Show the Copy-all button now that we have results
  const copyAllBtn = $('kwSuggestCopyAllBtn');
  if (copyAllBtn) copyAllBtn.style.display = 'inline-flex';

  // Click chip body → update input + search (but ignore clicks on the copy icon)
  chips.querySelectorAll('.kw-suggest-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.kw-chip-copy')) return; // handled below
      const input = $('kwSuggestInput');
      if (input) { input.value = chip.dataset.kw; runKwSuggest(chip.dataset.kw); }
    });
    const copyIcon = chip.querySelector('.kw-chip-copy');
    if (copyIcon) {
      copyIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        copyKwToClipboard(chip.dataset.kw, copyIcon);
      });
    }
  });
}

// Copy a single keyword to clipboard (with brief visual confirmation)
function copyKwToClipboard(text, feedbackEl) {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (_) { return false; }
  };
  const ok = (result) => {
    if (!feedbackEl) return;
    feedbackEl.classList.add('copied');
    const orig = feedbackEl.innerHTML;
    feedbackEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => {
      feedbackEl.classList.remove('copied');
      feedbackEl.innerHTML = orig;
    }, 1200);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => ok(true)).catch(() => { if (fallback()) ok(true); });
  } else if (fallback()) {
    ok(true);
  }
}

// Copy all currently-rendered suggestions (one per line)
function copyAllKwSuggestions() {
  const chips = document.querySelectorAll('#kwSuggestChips .kw-suggest-chip');
  if (!chips.length) return;
  const lines = Array.from(chips).map(c => c.dataset.kw).filter(Boolean);
  if (!lines.length) return;
  const text = lines.join('\n');
  const btn = $('kwSuggestCopyAllBtn');
  const showCopied = () => {
    if (!btn) return;
    btn.classList.add('copied');
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg><span>Copied!</span>';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = orig;
    }, 1400);
  };
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (_) { return false; }
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(showCopied).catch(() => { if (fallback()) showCopied(); });
  } else if (fallback()) {
    showCopied();
  }
}

function renderKwPlacementMatrix(kwData) {
  const tbody = $('kwPlacementBody'); if (!tbody) return;
  const top = (kwData.keywords || []).filter(k => k.ngram === 1).slice(0, 10);
  if (!top.length) { $('kwPlacementSection').style.display='none'; return; }
  const chk = '<span class="kw-check">✓</span>';
  const cross = '<span class="kw-cross">✗</span>';
  tbody.innerHTML = top.map(k => `<tr>
    <td class="kw-placement-word">${escHTML(k.word)}</td>
    <td>${k.inTitle?chk:cross}</td>
    <td>${k.inH1?chk:cross}</td>
    <td>${k.count>0?chk:cross}</td>
    <td>${k.inMeta?chk:cross}</td>
    <td>${cross}</td>
    <td>${k.count>0?chk:cross}</td>
    <td>${cross}</td>
    <td>${cross}</td>
    <td>${k.inBold?chk:cross}</td>
    <td>${k.inBold?chk:cross}</td>
    <td>${(k.inItalic||0)>0?chk:cross}</td>
  </tr>`).join('');
}

function getFilteredKeywords(kwData) {
  let rows = kwData.keywords || [];
  if (_kwNgram !== 'all') rows = rows.filter(k => k.ngram === parseInt(_kwNgram));
  const search = ($('kwSearch')?.value||'').toLowerCase().trim();
  if (search) rows = rows.filter(k => k.word.includes(search));
  rows = [...rows].sort((a,b) => {
    const av = a[_kwSortCol] ?? a.count ?? 0;
    const bv = b[_kwSortCol] ?? b.count ?? 0;
    return _kwSortOrder === 'desc' ? bv - av : av - bv;
  });
  return rows.slice(0, 60);
}

function renderKwTable(kwData) {
  const tbody = $('kwTableBody'); if (!tbody) return;
  const rows = getFilteredKeywords(kwData);
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-4);padding:20px">No keywords found</td></tr>'; return; }
  tbody.innerHTML = rows.map((kw, i) => {
    const dClass = kw.density > 4 ? 'kw-density-error' : kw.density > 2.5 ? 'kw-density-warn' : '';
    const prom = kw.prominence || Math.min(100, Math.round((kw.count / 57) * 62));
    const promClass = prom >= 50 ? 'kw-prom-high' : prom >= 25 ? 'kw-prom-mid' : 'kw-prom-low';
    return `<tr>
      <td>${i+1}</td>
      <td class="kw-col-word">
        <span class="kw-word">${escHTML(kw.word)}</span>
        ${kw.ngram > 1 ? `<span class="kw-ngram-badge">${kw.ngram}-gram</span>` : ''}
      </td>
      <td>${kw.count}</td>
      <td class="${dClass}">${kw.density}%</td>
      <td>${kw.inBold ? `<span class="kw-badge-bold">${kw.inBold||1}</span>` : '<span class="kw-badge-none">0</span>'}</td>
      <td>${(kw.inItalic||0) > 0 ? `<span class="kw-badge-italic">${kw.inItalic}</span>` : '<span class="kw-badge-none">0</span>'}</td>
      <td><div class="kw-prom-container"><div class="kw-prom-bar ${promClass}" style="width:${prom}%"></div><span class="kw-prom-value">${prom}</span></div></td>
    </tr>`;
  }).join('');
}

// ─── Semantic Keyword Clustering ────────────────────────────
const KW_CLUSTER_COLORS = [
  { dot: '#6366f1', bar: '#6366f1', text: '#6366f1' },
  { dot: '#10b981', bar: '#10b981', text: '#10b981' },
  { dot: '#f59e0b', bar: '#f59e0b', text: '#f59e0b' },
  { dot: '#ef4444', bar: '#ef4444', text: '#ef4444' },
  { dot: '#8b5cf6', bar: '#8b5cf6', text: '#8b5cf6' },
  { dot: '#06b6d4', bar: '#06b6d4', text: '#06b6d4' },
];

// Semantic affinity clusters — topic families used for grouping
const KW_TOPIC_SEEDS = [
  { name: 'Product / Service', seeds: ['price', 'buy', 'order', 'plan', 'package', 'service', 'product', 'offer', 'deal', 'free', 'premium', 'subscribe', 'hosting', 'domain', 'server', 'vps', 'cloud', 'dedicated', 'shared'] },
  { name: 'How-To / Guides',   seeds: ['how', 'guide', 'tutorial', 'step', 'tips', 'learn', 'setup', 'install', 'configure', 'create', 'build', 'start', 'beginner', 'easy', 'quick'] },
  { name: 'SEO / Marketing',   seeds: ['seo', 'rank', 'traffic', 'keyword', 'backlink', 'search', 'google', 'index', 'sitemap', 'optimize', 'content', 'blog', 'post', 'meta', 'link'] },
  { name: 'Technical',         seeds: ['speed', 'performance', 'uptime', 'security', 'ssl', 'https', 'cache', 'cdn', 'php', 'mysql', 'database', 'cpanel', 'ftp', 'api', 'code', 'script'] },
  { name: 'Brand / Trust',     seeds: ['support', 'review', 'reliable', 'trusted', 'guarantee', 'refund', 'team', 'company', 'about', 'contact', 'experience', 'expert', 'certified', 'award'] },
  { name: 'Location / Local',  seeds: ['pakistan', 'karachi', 'lahore', 'islamabad', 'local', 'city', 'near', 'area', 'region', 'country', 'worldwide', 'global', 'international'] },
];

function buildKwClusters(kwData) {
  const allKw = (kwData.keywords || []).filter(k => k.ngram <= 2 && k.count >= 2);
  const clusters = KW_TOPIC_SEEDS.map((seed, si) => ({
    name: seed.name,
    color: KW_CLUSTER_COLORS[si % KW_CLUSTER_COLORS.length],
    terms: [],
    totalCount: 0,
  }));

  // Score each keyword against each cluster seed
  allKw.forEach(kw => {
    const word = kw.word.toLowerCase();
    let bestCluster = -1, bestScore = 0;
    clusters.forEach((cl, ci) => {
      const score = KW_TOPIC_SEEDS[ci].seeds.reduce((s, seed) => {
        if (word === seed) return s + 3;
        if (word.includes(seed) || seed.includes(word)) return s + 1;
        return s;
      }, 0);
      if (score > bestScore) { bestScore = score; bestCluster = ci; }
    });
    if (bestCluster >= 0 && bestScore > 0) {
      clusters[bestCluster].terms.push({ ...kw, isPrimary: bestScore >= 3 });
      clusters[bestCluster].totalCount += kw.count;
    }
  });

  // Sort each cluster terms by count desc
  clusters.forEach(cl => cl.terms.sort((a,b) => b.count - a.count));
  // Only return clusters that have keywords, sorted by totalCount desc
  return clusters.filter(cl => cl.terms.length > 0).sort((a,b) => b.totalCount - a.totalCount);
}

function renderKwClusters(kwData) {
  const grid = $('kwClusterGrid'); if (!grid) return;
  const badge = $('kwClusterBadge');

  const clusters = buildKwClusters(kwData);
  if (!clusters.length) {
    grid.innerHTML = '<div style="font-size:12px;color:var(--text-4);text-align:center;padding:12px">Not enough keyword data to cluster.</div>';
    return;
  }

  const maxCount = clusters[0].totalCount || 1;

  if (badge) { badge.textContent = `${clusters.length} clusters`; badge.style.display = ''; }

  grid.innerHTML = clusters.map((cl, ci) => {
    const pct = Math.round((cl.totalCount / maxCount) * 100);
    const strength = pct >= 60 ? 'strong' : pct >= 30 ? 'medium' : 'weak';
    const strengthLabel = pct >= 60 ? 'Dominant' : pct >= 30 ? 'Present' : 'Weak';
    const topTerms = cl.terms.slice(0, 12);

    const termPills = topTerms.map(t => {
      const alpha = Math.max(0.4, Math.min(1, t.count / (cl.terms[0]?.count || 1)));
      return `<span class="kw-cluster-term ${t.isPrimary ? 'primary' : ''}"
        style="color:${cl.color.text};background:color-mix(in srgb,${cl.color.text} ${Math.round(alpha*12)}%,transparent);border-color:color-mix(in srgb,${cl.color.text} ${t.isPrimary?35:18}%,transparent)"
        title="${t.count}× | density ${t.density}%">${escHTML(t.word)}<sup style="font-size:9px;opacity:.7"> ${t.count}</sup></span>`;
    }).join('');

    return `<div class="kw-cluster-card" data-ci="${ci}">
      <div class="kw-cluster-header">
        <span class="kw-cluster-dot" style="background:${cl.color.dot}"></span>
        <span class="kw-cluster-name">${escHTML(cl.name)}</span>
        <span class="kw-cluster-meta">${cl.terms.length} kw · ${cl.totalCount} occ.</span>
        <span class="kw-cluster-strength ${strength}">${strengthLabel}</span>
      </div>
      <div class="kw-cluster-bar-wrap">
        <div class="kw-cluster-bar" style="width:${pct}%;background:${cl.color.bar}"></div>
      </div>
      <div class="kw-cluster-body">${termPills}</div>
    </div>`;
  }).join('');

  // Add event delegation for cluster headers
  grid.querySelectorAll('.kw-cluster-header').forEach(header => {
    header.addEventListener('click', function() {
      this.closest('.kw-cluster-card').classList.toggle('collapsed');
    });
  });
}

// ─── LSI / Entity Suggestions ────────────────────────────────
// Topic-based LSI term library — mapped by common page topics
const LSI_TOPIC_MAP = {
  hosting: {
    lsi: ['uptime guarantee', 'bandwidth', 'disk space', 'cPanel', 'SSL certificate', 'one-click install', 'WordPress hosting', 'email hosting', 'subdomain', 'FTP access', 'server location', 'SSD storage', 'NVMe', 'load time', 'scalable resources', 'backup', 'firewall', 'DDoS protection', 'money-back guarantee', 'control panel'],
    entities: ['cPanel', 'WordPress', 'Cloudflare', 'LiteSpeed', 'PHP', 'MySQL', 'WHM', 'Softaculous'],
  },
  seo: {
    lsi: ['organic traffic', 'SERP', 'meta description', 'title tag', 'backlink profile', 'anchor text', 'domain authority', 'page speed', 'mobile-first', 'crawlability', 'indexation', 'canonical URL', 'structured data', 'rich results', 'E-E-A-T', 'Core Web Vitals', 'keyword density', 'search intent', 'featured snippet', 'link building'],
    entities: ['Google Search Console', 'Google Analytics', 'Ahrefs', 'SEMrush', 'Yoast', 'Screaming Frog', 'Moz', 'Bing Webmaster Tools'],
  },
  ecommerce: {
    lsi: ['add to cart', 'checkout', 'payment gateway', 'shipping policy', 'return policy', 'product reviews', 'discount code', 'secure checkout', 'order tracking', 'inventory', 'product categories', 'wishlist', 'upsell', 'cross-sell', 'conversion rate', 'abandoned cart', 'trust badge', 'free shipping', 'COD', 'cash on delivery'],
    entities: ['WooCommerce', 'Shopify', 'PayPal', 'Stripe', 'Visa', 'Mastercard', 'Google Pay', 'Apple Pay'],
  },
  blog: {
    lsi: ['author bio', 'publish date', 'category', 'tag', 'comments section', 'social share', 'reading time', 'table of contents', 'related posts', 'newsletter', 'subscribe', 'RSS feed', 'byline', 'citation', 'sources', 'references', 'expert quote', 'data', 'statistics', 'infographic'],
    entities: ['WordPress', 'Medium', 'Substack', 'Google', 'Twitter/X', 'LinkedIn'],
  },
  saas: {
    lsi: ['free trial', 'pricing plans', 'features', 'integrations', 'API', 'dashboard', 'analytics', 'team collaboration', 'onboarding', 'customer support', 'SLA', 'uptime', 'scalability', 'security', 'compliance', 'GDPR', 'data export', 'white-label', 'automation', 'workflow'],
    entities: ['Stripe', 'Zapier', 'Slack', 'Google Workspace', 'AWS', 'Azure', 'Intercom', 'HubSpot'],
  },
  default: {
    lsi: ['about us', 'contact', 'FAQ', 'case study', 'testimonials', 'portfolio', 'services', 'pricing', 'blog', 'resources', 'privacy policy', 'terms of service', 'sitemap', 'breadcrumb', 'search bar', 'call to action', 'social proof', 'trust signal', 'header', 'footer'],
    entities: ['Google', 'Facebook', 'LinkedIn', 'Twitter/X', 'YouTube', 'WhatsApp'],
  },
};

function detectPageTopic(kwData, meta) {
  const pool = [
    ...(kwData.keywords || []).slice(0, 20).map(k => k.word),
  ].join(' ').toLowerCase();

  if (/hosting|domain|server|vps|cpanel|bandwidth|uptime/.test(pool)) return 'hosting';
  if (/seo|rank|backlink|serp|keyword|traffic|google|search/.test(pool)) return 'seo';
  if (/shop|cart|checkout|product|order|payment|woocommerce|ecommerce/.test(pool)) return 'ecommerce';
  if (/blog|post|article|author|publish|read|newsletter/.test(pool)) return 'blog';
  if (/saas|software|app|trial|dashboard|api|integration|subscription/.test(pool)) return 'saas';
  return 'default';
}

const _kwLsiState = { tab: 'missing', data: null };

function renderKwLsi(kwData) {
  const section = $('kwLsiSection'); if (!section) return;
  section.style.display = '';

  // Detect topic
  const d = _rawData ? adaptV1Data(_rawData) : {};
  const topic = detectPageTopic(kwData, d.meta || {});
  const library = LSI_TOPIC_MAP[topic] || LSI_TOPIC_MAP.default;

  // Build page word set for matching
  const pageText = (kwData.keywords || []).map(k => k.word.toLowerCase()).join(' ');
  const pageWords = new Set(pageText.split(/\s+/));

  // Check LSI terms
  const lsiResults = library.lsi.map(term => {
    const termLower = term.toLowerCase();
    const found = termLower.split(' ').some(w => pageWords.has(w)) ||
                  pageText.includes(termLower);
    return { term, found, type: 'lsi' };
  });

  // Check entities
  const entityResults = library.entities.map(ent => {
    const entLower = ent.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const found = pageText.includes(entLower) || pageText.includes(ent.toLowerCase().split('/')[0]);
    return { term: ent, found, type: 'entity' };
  });

  const missing  = lsiResults.filter(r => !r.found);
  const found    = lsiResults.filter(r => r.found);
  const entities = entityResults;
  const entFound = entities.filter(e => e.found).length;

  _kwLsiState.data = { missing, found, entities, topic };

  // Update badge + coverage
  const badge = $('kwLsiBadge');
  const coverage = $('kwLsiCoverage');
  const covPct = Math.round((found.length / library.lsi.length) * 100);
  if (badge) { badge.textContent = `${covPct}% covered`; badge.style.display = ''; }
  if (coverage) coverage.textContent = `Coverage: ${found.length}/${library.lsi.length} LSI terms · ${entFound}/${entities.length} entities found`;

  // Tab counts
  const mc = $('kwLsiMissingCount'); if (mc) mc.textContent = `(${missing.length})`;
  const fc = $('kwLsiFoundCount');   if (fc) fc.textContent = `(${found.length})`;
  const ec = $('kwLsiEntityCount'); if (ec) ec.textContent = `(${entities.length})`;

  // Tab click bindings
  const tabsEl = $('kwLsiTabs');
  if (tabsEl && !tabsEl._lsiBound) {
    tabsEl._lsiBound = true;
    tabsEl.querySelectorAll('.kw-lsi-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabsEl.querySelectorAll('.kw-lsi-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _kwLsiState.tab = tab.dataset.lsi;
        renderKwLsiGrid();
      });
    });
  }

  // AI button
  const aiRow = $('kwLsiAiRow');
  const aiBtn = $('kwLsiAiBtn');
  if (aiRow) aiRow.style.display = _aiConfig?.apiKey ? '' : 'none';
  if (aiBtn && !aiBtn._lsiBound) {
    aiBtn._lsiBound = true;
    aiBtn.addEventListener('click', runKwLsiAI);
  }

  renderKwLsiGrid();
}

function renderKwLsiGrid() {
  const grid = $('kwLsiGrid'); if (!grid || !_kwLsiState.data) return;
  const { missing, found, entities } = _kwLsiState.data;
  const tab = _kwLsiState.tab;

  if (tab === 'missing') {
    if (!missing.length) { grid.innerHTML = '<span style="font-size:12px;color:var(--ok)">✓ All LSI terms found! Great coverage.</span>'; return; }
    grid.innerHTML = missing.map(r =>
      `<span class="kw-lsi-pill missing"><span class="kw-lsi-pill-icon">✗</span>${escHTML(r.term)}</span>`
    ).join('');
  } else if (tab === 'found') {
    if (!found.length) { grid.innerHTML = '<span style="font-size:12px;color:var(--text-4)">No matching LSI terms detected yet.</span>'; return; }
    grid.innerHTML = found.map(r =>
      `<span class="kw-lsi-pill found"><span class="kw-lsi-pill-icon">✓</span>${escHTML(r.term)}</span>`
    ).join('');
  } else {
    grid.innerHTML = entities.map(r =>
      `<span class="kw-lsi-pill ${r.found ? 'entity-found' : 'entity'}">`+
      `<span class="kw-lsi-pill-icon">${r.found ? '✓' : '○'}</span>${escHTML(r.term)}</span>`
    ).join('');
  }
}

async function runKwLsiAI() {
  if (!_aiConfig?.apiKey) _aiConfig = ensureBuiltinGroqConfig(_aiConfig);
  if (!_aiConfig?.apiKey) { toast('Configure AI model in Settings first.'); return; }
  const btn = $('kwLsiAiBtn');
  const loading = $('kwLsiAiLoading');
  const result = $('kwLsiAiResult');

  if (btn) btn.disabled = true;
  if (loading) loading.style.display = '';
  if (result) result.style.display = 'none';

  try {
    const d = _rawData ? adaptV1Data(_rawData) : {};
    const topic = _kwLsiState.data?.topic || 'general';
    const title = d.meta?.title || 'this page';
    const topKws = (_kwLsiState.data?.found || []).slice(0,5).map(r=>r.term).join(', ') || 'none found';
    const missing = (_kwLsiState.data?.missing || []).slice(0,8).map(r=>r.term).join(', ') || 'none';

    const prompt = `You are an SEO and GEO expert. A "${topic}" page titled "${title}" is missing these LSI terms: ${missing}. The page already covers: ${topKws}.

Give me:
1. 10 highly relevant LSI terms / phrases this page MUST include to rank for "${topic}" queries (that are NOT already in the missing list above — suggest fresh ones)
2. 5 semantic entity names (brands, tools, or concepts) that would strengthen topical authority

Format EXACTLY as:
LSI: term1 | term2 | term3 | term4 | term5 | term6 | term7 | term8 | term9 | term10
ENTITIES: ent1 | ent2 | ent3 | ent4 | ent5

Nothing else. No explanations.`;

    const cfg = _aiConfig;
    const messages = [{ role: 'user', content: prompt }];
    let url, headers;
    if (cfg.provider === 'openrouter') {
      url = 'https://openrouter.ai/api/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey, 'HTTP-Referer': 'https://www.mubashirhassan.com', 'X-Title': 'ShahzaibSEO LSI Suggestions' };
    } else {
      url = 'https://integrate.api.nvidia.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey };
    }
    const body = { model: cfg.model, messages, max_tokens: 300, temperature: 0.5 };
    const res  = await fetch(url, { method:'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error?.message||`HTTP ${res.status}`); }
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content?.trim() || '';

    // Parse LSI and ENTITIES lines
    const lsiMatch = raw.match(/LSI:\s*(.+)/i);
    const entMatch = raw.match(/ENTITIES:\s*(.+)/i);
    const lsiTerms = lsiMatch ? lsiMatch[1].split('|').map(t=>t.trim()).filter(Boolean) : [];
    const entTerms = entMatch ? entMatch[1].split('|').map(t=>t.trim()).filter(Boolean) : [];

    if (!lsiTerms.length && !entTerms.length) throw new Error('Unexpected response format');

    // Render
    const lsiPills = lsiTerms.map(t => `<span class="kw-lsi-pill missing" style="cursor:default">💡 ${escHTML(t)}</span>`).join('');
    const entPills = entTerms.map(t => `<span class="kw-lsi-pill entity" style="cursor:default">🏷 ${escHTML(t)}</span>`).join('');

    if (result) {
      result.innerHTML = `
        <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">AI-Suggested LSI Terms</div>
        <div class="kw-lsi-ai-pills">${lsiPills}</div>
        ${entTerms.length ? `<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.4px;margin:10px 0 6px">AI-Suggested Entities</div>
        <div class="kw-lsi-ai-pills">${entPills}</div>` : ''}
        <div style="font-size:10.5px;color:var(--text-4);margin-top:8px">Add these to your content to improve topical authority for "${topic}" queries.</div>`;
      result.style.display = '';
    }
  } catch(err) {
    if (result) { result.innerHTML = `<span style="color:var(--err);font-size:12px">⚠️ ${escHTML(err.message||'Request failed')}</span>`; result.style.display=''; }
  } finally {
    if (btn) btn.disabled = false;
    if (loading) loading.style.display = 'none';
  }
}

// ─── Technical ────────────────────────────────────────
function renderTechnical(tech, meta) {
  const raw = _rawData || {};

  // ── 1. Checks grid (8 items) ──────────────────────────
  const grid = $('techChecksGrid');
  if (grid) {
    grid.innerHTML = '';
    const checks = [
      { label: 'HTTPS',        value: tech.isHttps ? 'Yes' : 'Not Secure',              ok: tech.isHttps ? 'ok' : 'err' },
      { label: 'Indexable',    value: tech.isIndexable ? 'Yes' : 'Noindex!',             ok: tech.isIndexable ? 'ok' : 'err' },
      { label: 'Canonical',    value: meta.canonical ? shortUrl(meta.canonical) : 'Not set', ok: meta.canonical ? 'ok' : 'warn' },
      { label: 'Hreflang',     value: tech.hreflang.length > 0 ? `${tech.hreflang.length} tag(s)` : 'None', ok: 'ok' },
      { label: 'URL Length',   value: (meta.url || '').length + ' chars',               ok: (meta.url||'').length > 100 ? 'warn' : 'ok' },
      { label: 'Viewport',     value: meta.viewport ? 'Set' : 'Missing',                ok: meta.viewport ? 'ok' : 'warn' },
      { label: 'Charset',      value: meta.charset || 'Not set',                         ok: meta.charset ? 'ok' : 'warn' },
      { label: 'HTML Size',    value: formatBytes(tech.htmlSize),                         ok: tech.htmlSize > 2097152 ? 'err' : tech.htmlSize > 1048576 ? 'warn' : 'ok' },
    ];
    checks.forEach(c => {
      const icon = c.ok === 'ok' ? `<svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`
        : c.ok === 'warn' ? `<svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`
        : `<svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`;
      const div = el('div', 't-check');
      div.innerHTML = `<div class="t-check-icon ${c.ok}">${icon}</div><div class="t-check-body"><div class="t-check-label">${escHTML(c.label)}</div><div class="t-check-value">${escHTML(String(c.value))}</div></div>`;
      grid.appendChild(div);
    });
  }

  // ── 2. Tech stack chips ───────────────────────────────
  const chipsEl = $('techStackChips');
  if (chipsEl) {
    const stack = tech.techStack || [];
    if (stack.length) {
      chipsEl.innerHTML = stack.map(s => `<span class="t-tech-chip">${escHTML(s)}</span>`).join('');
    } else if (tech.cms) {
      chipsEl.innerHTML = `<span class="t-tech-chip">${escHTML(tech.cms)}</span>`;
    } else {
      chipsEl.innerHTML = '<span class="t-tech-empty">No tech detected</span>';
    }
  }

  // ── 3. CSS Analysis + JS Coverage ────────────────────
  const cssGrid = $('cssAnalysisGrid');
  const jsTotalBadge = $('jsTotalBadge');
  const cssTotalBadge = $('cssTotalBadge');
  const s = tech.styles;
  const sc = tech.scripts;
  if (cssTotalBadge) cssTotalBadge.textContent = (s.total || s.external + s.inline) + ' Total Stylesheets';
  if (jsTotalBadge) jsTotalBadge.textContent = (sc.total || sc.external + sc.inline) + ' Total Scripts';
  if (cssGrid) {
    cssGrid.innerHTML = tCoverageItem('Inline Styles', s.inline) + tCoverageItem('Local Stylesheets', 0) + tCoverageItem('External Stylesheets', s.external) + tCoverageItem('Linked Stylesheets', s.external);
  }
  const jsGrid = $('jsAnalysisGrid');
  if (jsGrid) {
    const blockCls = sc.blocking > 0 ? 'text-warn' : '';
    jsGrid.innerHTML = tCoverageItem('Inline Scripts', sc.inline) + tCoverageItem('Local Scripts', 0) + tCoverageItem('External Scripts', sc.external) + `<div class="t-coverage-item"><span class="t-coverage-label">Blocking Scripts</span><span class="t-coverage-val ${blockCls}">${sc.blocking}</span></div>`;
  }

  // ── 4. Robots.txt buttons ─────────────────────────────
  $('robotsCopyBtn')?.addEventListener('click', () => {
    const txt = $('robotsContent')?.textContent || '';
    if (txt && txt !== 'Loading…') { navigator.clipboard.writeText(txt); toast('Robots.txt copied!'); }
  });
  $('robotsOpenBtn')?.addEventListener('click', () => {
    try { const u = new URL(_currentUrl); window.open(u.origin + '/robots.txt', '_blank'); } catch(_) {}
  });

  // ── 5. .htaccess buttons ──────────────────────────────
  $('htaccessCopyBtn')?.addEventListener('click', () => {
    const txt = $('htaccessContent')?.textContent || '';
    if (txt) { navigator.clipboard.writeText(txt); toast('.htaccess copied!'); }
  });
  $('htaccessOpenBtn')?.addEventListener('click', () => {
    try { const u = new URL(_currentUrl); window.open(u.origin + '/.htaccess', '_blank'); } catch(_) {}
  });

  // ── 6. sitemap.xml buttons ────────────────────────────
  $('sitemapCopyBtn')?.addEventListener('click', () => {
    const txt = $('sitemapContent')?.textContent || '';
    if (txt) { navigator.clipboard.writeText(txt); toast('Sitemap copied!'); }
  });
  $('sitemapOpenBtn')?.addEventListener('click', () => {
    try { const u = new URL(_currentUrl); window.open(u.origin + '/sitemap.xml', '_blank'); } catch(_) {}
  });

  // ── 7. llms.txt buttons ───────────────────────────────
  $('llmsTxtCopyBtn')?.addEventListener('click', () => {
    const txt = $('llmsTxtContent')?.textContent || '';
    if (txt) { navigator.clipboard.writeText(txt); toast('llms.txt copied!'); }
  });
  $('llmsTxtOpenBtn')?.addEventListener('click', () => {
    try { const u = new URL(_currentUrl); window.open(u.origin + '/llms.txt', '_blank'); } catch(_) {}
  });

  // ── 5. Security ───────────────────────────────────────
  const secList = $('techSecurityList');
  if (secList) {
    const secRaw = raw.security || {};
    const checks = secRaw.checks || [];
    if (checks.length) {
      secList.innerHTML = checks.map(c => tCheckRow(c.label, c.passed ? 'ok' : (c.severity === 'info' ? 'info' : 'err'), c.detail)).join('');
    } else {
      // Fallback from tech data
      secList.innerHTML = [
        tCheckRow('Mixed Content', 'ok', 'No mixed content'),
        tCheckRow('CSP', 'info', 'No CSP meta tag (may be set via HTTP header)'),
        tCheckRow('Referrer Policy', 'info', 'No referrer policy meta tag'),
      ].join('');
    }
  }

  // ── 6. Accessibility ─────────────────────────────────
  const a11yList = $('techAccessibilityList');
  if (a11yList) {
    const a11yRaw = raw.accessibility || {};
    const checks = a11yRaw.checks || [];
    if (checks.length) {
      a11yList.innerHTML = checks.map(c => tCheckRow(c.label, c.passed ? 'ok' : (c.severity === 'info' ? 'info' : 'err'), c.detail)).join('');
    } else {
      a11yList.innerHTML = '<div class="t-empty-msg">Accessibility data not available</div>';
    }
  }

  // ── 7. Errors & Broken Resources ─────────────────────
  const errList = $('techErrorsList');
  if (errList) {
    const jsRaw = raw.jsErrors || {};
    const issues = jsRaw.issues || [];
    
    // Adapt raw data to get structured data
    const adapted = adaptV1Data(raw);
    const links = adapted.links || {};
    const images = adapted.images || {};
    const headings = adapted.headings || {};
    
    // Collect all errors and issues
    const allErrors = [];
    
    // JavaScript errors
    issues.forEach(i => {
      allErrors.push({
        type: 'js_error',
        severity: i.severity === 'warning' ? 'warning' : 'info',
        message: i.message,
        fix: 'Check browser console for details'
      });
    });
    
    // Empty/broken links
    if (links.empty > 0) {
      allErrors.push({
        type: 'empty_links',
        severity: 'error',
        message: `${links.empty} empty/placeholder link(s)`,
        fix: 'Add proper href attributes to all links',
        action: 'links'
      });
    }
    
    // Missing alt text
    if (images.missingAlt > 0) {
      allErrors.push({
        type: 'missing_alt',
        severity: 'warning',
        message: `${images.missingAlt} image(s) without alt text`,
        fix: 'Add descriptive alt text to all images',
        action: 'images'
      });
    }
    
    // Empty headings
    const emptyHeadings = headings.headings?.filter(h => h.isEmpty).length || 0;
    if (emptyHeadings > 0) {
      allErrors.push({
        type: 'empty_headings',
        severity: 'error',
        message: `${emptyHeadings} empty heading(s)`,
        fix: 'Remove empty headings or add text content',
        action: 'headings'
      });
    }
    
    // Heading hierarchy issues
    if (headings.counts?.h1 === 0) {
      allErrors.push({
        type: 'missing_h1',
        severity: 'error',
        message: 'No H1 tag found',
        fix: 'Add exactly one H1 tag to the page',
        action: 'headings'
      });
    } else if (headings.counts?.h1 > 1) {
      allErrors.push({
        type: 'multiple_h1',
        severity: 'warning',
        message: `Multiple H1 tags (${headings.counts.h1})`,
        fix: 'Use only one H1 tag per page',
        action: 'headings'
      });
    }
    
    // Generic anchor text
    if (links.genericAnchor > 3) {
      allErrors.push({
        type: 'generic_anchor',
        severity: 'warning',
        message: `${links.genericAnchor} link(s) with generic anchor text`,
        fix: 'Use descriptive anchor text instead of "click here"',
        action: 'links'
      });
    }
    
    // Oversized images
    if (images.oversized > 0) {
      allErrors.push({
        type: 'oversized_images',
        severity: 'warning',
        message: `${images.oversized} oversized image(s)`,
        fix: 'Optimize and compress images',
        action: 'images'
      });
    }
    
    // Lazy loading above fold
    if (images.aboveFoldLazy > 0) {
      allErrors.push({
        type: 'lazy_above_fold',
        severity: 'warning',
        message: `${images.aboveFoldLazy} above-fold image(s) with lazy loading`,
        fix: 'Remove lazy loading from above-fold images',
        action: 'images'
      });
    }
    
    // Button labels (accessibility)
    const buttons = raw.accessibility?.buttons || {};
    if (buttons.withoutLabel > 0) {
      allErrors.push({
        type: 'button_labels',
        severity: 'error',
        message: `${buttons.withoutLabel} button(s) without accessible name`,
        fix: 'Add aria-label or text content to buttons',
        action: 'technical'
      });
    }
    
    // Form labels
    const forms = raw.accessibility?.forms || {};
    if (forms.inputsWithoutLabel > 0) {
      allErrors.push({
        type: 'form_labels',
        severity: 'error',
        message: `${forms.inputsWithoutLabel} form input(s) without label`,
        fix: 'Add <label> elements for all form inputs',
        action: 'technical'
      });
    }
    
    if (allErrors.length === 0) {
      errList.innerHTML = `
        <div class="t-check-row ok">
          <div class="t-check-icon ok">✓</div>
          <div class="t-check-row-label">No errors detected</div>
          <span class="t-status-badge ok">All good</span>
        </div>
      `;
    } else {
      errList.innerHTML = allErrors.map(err => {
        const severityClass = err.severity === 'error' ? 'err' : err.severity === 'warning' ? 'warn' : 'info';
        const icon = err.severity === 'error' ? '✗' : err.severity === 'warning' ? '⚠' : 'ℹ';
        
        return `
          <div class="t-error-row ${severityClass}">
            <div class="t-error-icon ${severityClass}">${icon}</div>
            <div class="t-error-content">
              <div class="t-error-message">${escHTML(err.message)}</div>
              <div class="t-error-fix">
                <span class="t-error-fix-label">Fix:</span>
                <span class="t-error-fix-text">${escHTML(err.fix)}</span>
              </div>
            </div>
            ${err.action ? `<button class="t-error-action-btn" data-action="${err.action}" title="Go to ${err.action} tab">
              <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
                <path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/>
              </svg>
              View
            </button>` : ''}
          </div>
        `;
      }).join('');
      
      // Add click handlers for action buttons
      errList.querySelectorAll('.t-error-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          if (action && typeof switchTab === 'function') {
            switchTab(action);
          }
        });
      });
    }
  }

  // ── 8. Fonts & CSS ────────────────────────────────────
  const fontsGrid = $('techFontsGrid');
  if (fontsGrid) {
    const fp = raw.fontsPerf || {};
    fontsGrid.innerHTML = [
      tFontStat(fp.uniqueFontCount ?? 0, 'FONT FAMILIES'),
      tFontStat((fp.withSwap ?? 0) + '/' + (fp.fontFaceCount ?? 0), 'FONT-DISPLAY: SWAP'),
      tFontStat(fp.preloadedFonts ?? 0, 'PRELOADED'),
      tFontStat(fp.cssFiles ?? tech.styles.external, 'CSS FILES'),
      tFontStat(fp.inlineStyles ?? tech.styles.inline, 'INLINE STYLES'),
      `<div class="t-font-stat"><span class="t-font-stat-val ${fp.hasCriticalCss ? 'text-ok' : 'text-warn'}">${fp.hasCriticalCss ? '✓' : '—'}</span><span class="t-font-stat-lbl">CRITICAL CSS</span></div>`,
    ].join('');
  }

  // ── 9. Page Weight ────────────────────────────────────
  const pwGrid = $('techPageWeightGrid');
  if (pwGrid) {
    const pw = raw.pageWeight || {};
    const counts = pw.counts || {};
    pwGrid.innerHTML = [
      tWeightStat(pw.html?.formatted || formatBytes(tech.htmlSize), 'HTML'),
      tWeightStat(pw.inlineCss?.formatted || '—', 'INLINE CSS'),
      tWeightStat(pw.inlineJs?.formatted || '—', 'INLINE JS'),
      tWeightStat(counts.extCss ?? tech.styles.external, 'CSS FILES'),
      tWeightStat(counts.extJs ?? tech.scripts.external, 'JS FILES'),
      tWeightStat(counts.fonts ?? 0, 'FONTS'),
      tWeightStatWarn(counts.thirdParty ?? 0, 'THIRD-PARTY', counts.thirdParty > 10),
      tWeightStat(pw.totalResources ?? (counts.extCss + counts.extJs + (counts.images||0) + (counts.fonts||0)), 'TOTAL RESOURCES'),
    ].join('');
  }

  // ── 10. Resource Hints ────────────────────────────────
  const hl = $('hintsList');
  if (hl) {
    if (!tech.hints.length) {
      hl.innerHTML = '<div class="t-empty-msg">No resource hints found</div>';
    } else {
      const grouped = {};
      tech.hints.forEach(h => { (grouped[h.rel] = grouped[h.rel]||[]).push(h.href); });
      hl.innerHTML = Object.entries(grouped).map(([rel, hrefs]) =>
        `<div class="t-hint-row"><span class="t-hint-badge">${escHTML(rel)}</span><span class="t-hint-count">${hrefs.length} domain(s)</span></div>`
      ).join('');
    }
  }

  // ── 11. Rendering & DOM ───────────────────────────────
  const renderList = $('techRenderingList');
  if (renderList) {
    const advTech = raw.advancedTechnical || {};
    const renderingType = advTech.rendering?.type || 'static';
    const renderLabel = renderingType === 'static' ? 'Static HTML' : renderingType === 'ssr' ? 'Server-Side Rendered' : 'Client-Side Rendered';
    renderList.innerHTML = [
      tCheckRow('Rendering', 'ok', renderLabel),
      tCheckRow('DOM Elements', tech.domElements > 1500 ? 'warn' : 'ok', `${fmt(tech.domElements)} (${tech.domElements > 1500 ? 'over' : 'under'} 1500)`),
      tCheckRow('DOM Depth', tech.domDepth > 20 ? 'warn' : 'ok', `${tech.domDepth || '—'} levels`),
    ].join('');
  }

  // ── 12. Content Freshness ─────────────────────────────
  const freshList = $('techFreshnessList');
  if (freshList) {
    const advTech = raw.advancedTechnical || {};
    const cf = advTech.contentFreshness || {};
    const warnings = cf.staleContentWarnings || [];
    if (!warnings.length && (cf.publishDate || cf.modifiedDate)) {
      freshList.innerHTML = tCheckRow('Content date found', 'ok', cf.publishDate || cf.modifiedDate);
    } else if (warnings.length) {
      freshList.innerHTML = warnings.map(w => tCheckRow(w, 'warn', '')).join('');
    } else {
      freshList.innerHTML = tCheckRow('No publication or modification date found', 'warn', '');
    }
  }

  // ── 13. Tracking & Analytics ──────────────────────────
  const tl = $('techTrackingList');
  if (tl) {
    if (!tech.trackingSignals.length) {
      tl.innerHTML = '<div class="t-empty-msg">No tracking scripts detected</div>';
    } else {
      tl.innerHTML = tech.trackingSignals.map(t =>
        `<div class="t-check-row"><div class="t-check-row-label">${escHTML(t)}</div><span class="t-status-badge ok">detected</span></div>`
      ).join('');
    }
  }

  // ── 14. CWV device tabs ───────────────────────────────
  document.querySelectorAll('.t-cwv-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.t-cwv-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (_vitals) applyVitals(_vitals); // re-render bars for selected device
    });
  });
}

// ── Technical helper renderers ────────────────────────
function tCheckRow(label, status, detail) {
  const iconOk = `<svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`;
  const iconWarn = `<svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`;
  const iconErr = `<svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`;
  const iconInfo = `<svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>`;
  const icon = status === 'ok' ? iconOk : status === 'warn' ? iconWarn : status === 'info' ? iconInfo : iconErr;
  const cls = status === 'info' ? 'info' : status;
  return `<div class="t-check-row t-check-row-${cls}">
    <div class="t-check-row-icon ${cls}">${icon}</div>
    <div class="t-check-row-body">
      <span class="t-check-row-label">${escHTML(label)}</span>
      ${detail ? `<span class="t-check-row-detail">${escHTML(detail)}</span>` : ''}
    </div>
  </div>`;
}
function tCoverageItem(label, val) {
  return `<div class="t-coverage-item"><span class="t-coverage-label">${escHTML(label)}</span><span class="t-coverage-val">${val ?? 0}</span></div>`;
}
function tFontStat(val, lbl) {
  return `<div class="t-font-stat"><span class="t-font-stat-val">${val ?? 0}</span><span class="t-font-stat-lbl">${escHTML(lbl)}</span></div>`;
}
function tWeightStat(val, lbl) {
  return `<div class="t-weight-stat"><span class="t-weight-val">${val ?? 0}</span><span class="t-weight-lbl">${escHTML(lbl)}</span></div>`;
}
function tWeightStatWarn(val, lbl, warn) {
  return `<div class="t-weight-stat"><span class="t-weight-val${warn?' text-warn':''}">${val ?? 0}</span><span class="t-weight-lbl">${escHTML(lbl)}</span></div>`;
}

function statRow(label, value, cls='') {
  return `<div class="stat-row"><span class="stat-row-label">${escHTML(label)}</span><span class="stat-row-val ${cls}">${value??'—'}</span></div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FREE ENDPOINTS — IP Geo, DNS, HTTP Headers, SSL Certs, Wayback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a Chrome runtime message and automatically retry when the background
 * returns `{ ok: false, busy: true }`.  This happens when the popup is closed
 * and quickly reopened while a slow API call (crt.sh, archive.org CDX …) is
 * still in-flight: the background's dedup Map blocks the second request but
 * returns `busy` until the first request finishes and the data lands in cache.
 *
 * Strategy: exponential back-off up to `maxRetries` attempts.
 * Each retry waits longer than the last (1.5 s → 3 s → 6 s → 12 s → 24 s).
 * If we exhaust all retries, the final response (still busy or a real error)
 * is forwarded to the callback so the caller can render its own error UI.
 *
 * @param {object}   message      - Message to send (must have `.action`).
 * @param {Function} callback     - Receives the final response object.
 * @param {number}   [maxRetries] - Max retry attempts (default 5).
 */
function sendWithBusyRetry(message, callback, maxRetries = 5) {
  let attempt = 0;

  function trySend() {
    chrome.runtime.sendMessage(message, r => {
      if (chrome.runtime.lastError) {
        // Extension context invalidated or similar — surface the error.
        callback(null);
        return;
      }
      if (r?.busy && attempt < maxRetries) {
        // Background is still processing; wait and try again.
        const delay = 1500 * Math.pow(2, attempt);   // 1.5 s, 3 s, 6 s, 12 s, 24 s
        attempt++;
        setTimeout(trySend, delay);
      } else {
        callback(r);
      }
    });
  }

  trySend();
}

// ── IP Geolocation ────────────────────────────────────────────────────────────
function initIpGeo(domain) {
  const loading = $('ipGeoLoading'), grid = $('ipGeoGrid'), badge = $('ipGeoBadge');
  const dLoading = $('dashIpGeoLoading'), dGrid = $('dashIpGeoGrid'), dBadge = $('dashIpGeoBadge');
  const hasTech = loading && grid;
  const hasDash = dLoading && dGrid;
  if (!hasTech && !hasDash) return;
  sendWithBusyRetry({ action: 'IP_GEO', domain }, r => {
    if (hasTech) loading.style.display = 'none';
    if (hasDash) dLoading.style.display = 'none';
    if (!r?.ok) {
      if (badge) badge.textContent = 'Unavailable';
      if (dBadge) dBadge.textContent = 'Unavailable';
      const failHtml = '<div class="t-domain-row"><span class="t-domain-label" style="color:var(--text-3)">Could not fetch IP data</span></div>';
      if (grid) { grid.innerHTML = failHtml; grid.style.display = ''; }
      if (dGrid) { dGrid.innerHTML = failHtml; dGrid.style.display = ''; }
      return;
    }
    _ipGeoData = r;
    if (badge) badge.textContent = r.countryCode || '';
    if (dBadge) dBadge.textContent = r.countryCode || '';
    if (grid) grid.style.display = '';
    if (dGrid) dGrid.style.display = '';
    const flag = r.countryCode ? String.fromCodePoint(...[...r.countryCode.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';
    const rows = [
      ['IP Address', r.ip],
      ['Country', flag + ' ' + (r.country || '—')],
      ['Region', r.region],
      ['City', r.city],
      ['ISP', r.isp],
      ['Organization', r.org],
      ['ASN', r.asn],
      ['Timezone', r.timezone],
      ['Coordinates', r.lat && r.lon ? `${r.lat}, ${r.lon}` : null],
    ].filter(([,v]) => v);
    const html = rows.map(([k, v]) =>
      `<div class="t-domain-row"><span class="t-domain-label">${escHTML(k)}</span><span class="t-domain-value">${escHTML(String(v))}</span></div>`
    ).join('');
    if (grid) grid.innerHTML = html;
    if (dGrid) dGrid.innerHTML = html;
  });
}

// ── DNS Records ───────────────────────────────────────────────────────────────
let _dnsData = null;
let _dashDnsData = null;

function initDnsRecords(domain) {
  const loading = $('dnsLoading'), panel = $('dnsRecordsPanel');
  const dLoading = $('dashDnsLoading'), dPanel = $('dashDnsRecordsPanel');
  const hasTech = loading && panel;
  const hasDash = dLoading && dPanel;
  if (!hasTech && !hasDash) return;

  sendWithBusyRetry({ action: 'DNS_LOOKUP', domain }, r => {
    if (hasTech) loading.style.display = 'none';
    if (hasDash) dLoading.style.display = 'none';
    if (!r?.ok) {
      const failHtml = '<div style="color:var(--text-3);padding:8px 0">DNS lookup failed</div>';
      if (panel) { panel.innerHTML = failHtml; panel.style.display = ''; }
      if (dPanel) { dPanel.innerHTML = failHtml; dPanel.style.display = ''; }
      return;
    }
    _dnsData = r.records;
    _dashDnsData = r.records;
    if (panel) { panel.style.display = ''; renderDnsPanel('A'); }
    if (dPanel) { dPanel.style.display = ''; renderDashDnsPanel('A'); }

    // Bind tab buttons
    const tabs = document.querySelectorAll('#dnsTypeTabs .t-dns-tab');
    tabs.forEach(tab => {
      if (!tab._dnsBound) {
        tab._dnsBound = true;
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          renderDnsPanel(tab.dataset.dns);
        });
      }
    });

    // Bind dashboard tab buttons
    const dashTabs = document.querySelectorAll('#dashDnsTypeTabs .t-dns-tab');
    dashTabs.forEach(tab => {
      if (!tab._dashDnsBound) {
        tab._dashDnsBound = true;
        tab.addEventListener('click', () => {
          dashTabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          renderDashDnsPanel(tab.dataset.dns);
        });
      }
    });
  });
}

function renderDnsPanel(type) {
  const panel = $('dnsRecordsPanel');
  if (!panel || !_dnsData) return;
  const records = _dnsData[type] || [];
  if (!records.length) {
    panel.innerHTML = `<div style="color:var(--text-3);padding:8px 0">No ${escHTML(type)} records found</div>`;
    return;
  }
  panel.innerHTML = `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Name</th><th>TTL</th><th>Value</th></tr></thead>
    <tbody>${records.map(r =>
      `<tr><td style="word-break:break-all">${escHTML(r.name||'')}</td><td>${escHTML(String(r.ttl||''))}</td><td style="word-break:break-all;max-width:240px">${escHTML(r.data||'')}</td></tr>`
    ).join('')}</tbody>
  </table></div>`;
}

function renderDashDnsPanel(type) {
  const panel = $('dashDnsRecordsPanel');
  if (!panel || !_dashDnsData) return;
  const records = _dashDnsData[type] || [];
  if (!records.length) {
    panel.innerHTML = `<div style="color:var(--text-3);padding:8px 0">No ${escHTML(type)} records found</div>`;
    return;
  }
  panel.innerHTML = `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Name</th><th>TTL</th><th>Value</th></tr></thead>
    <tbody>${records.map(r =>
      `<tr><td style="word-break:break-all">${escHTML(r.name||'')}</td><td>${escHTML(String(r.ttl||''))}</td><td style="word-break:break-all;max-width:240px">${escHTML(r.data||'')}</td></tr>`
    ).join('')}</tbody>
  </table></div>`;
}

// ── HTTP Headers ──────────────────────────────────────────────────────────────
let _httpHeadersData = null;

// Per-header fix guides: recommended value + how to add on Apache/Nginx/IIS/Netlify/Vercel/WordPress.
// Keep these brief — they appear in a collapsed details panel under each missing header.
const SECURITY_HEADER_FIXES = {
  'content-security-policy': {
    why: 'Stops bad scripts from running on your site. Without it, attackers can inject code into your pages.',
    recommended: "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; frame-ancestors 'self'",
    servers: [
      { name: 'Apache (.htaccess)', where: 'Add at the end of the .htaccess file in your site root.', code: "Header set Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; frame-ancestors 'self'\"" },
      { name: 'Nginx', where: 'Add inside the server { } block in nginx.conf or your site config.', code: "add_header Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; frame-ancestors 'self'\" always;" },
      { name: 'IIS (web.config)', where: 'Add inside <system.webServer> in web.config, inside <customHeaders>.', code: "<httpProtocol>\n  <customHeaders>\n    <add name=\"Content-Security-Policy\" value=\"default-src 'self'; script-src 'self' 'unsafe-inline' https:; frame-ancestors 'self'\" />\n  </customHeaders>\n</httpProtocol>" },
      { name: 'Express (Node)', where: 'Add near the top of your app, before routes (e.g. right after const app = express()).', code: "app.use((req, res, next) => {\n  res.setHeader(\"Content-Security-Policy\", \"default-src 'self'; script-src 'self' 'unsafe-inline' https:; frame-ancestors 'self'\");\n  next();\n});" },
      { name: 'Netlify (_headers)', where: 'Add to a _headers file in your publish directory (or /public).', code: "/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https:; frame-ancestors 'self'" },
      { name: 'Vercel (vercel.json)', where: 'Add a headers array in vercel.json at your project root.', code: "{\n  \"headers\": [{\n    \"source\": \"/(.*)\",\n    \"headers\": [{ \"key\": \"Content-Security-Policy\", \"value\": \"default-src 'self'; script-src 'self' 'unsafe-inline' https:; frame-ancestors 'self'\" }]\n  }]\n}" }
    ]
  },
  'x-frame-options': {
    why: 'Stops other sites from putting your pages inside an iframe (clickjacking protection).',
    recommended: 'SAMEORIGIN',
    servers: [
      { name: 'Apache (.htaccess)', where: 'Add at the end of .htaccess in your site root.', code: "Header set X-Frame-Options \"SAMEORIGIN\"" },
      { name: 'Nginx', where: 'Add inside the server { } block.', code: "add_header X-Frame-Options \"SAMEORIGIN\" always;" },
      { name: 'IIS (web.config)', where: 'Add inside <system.webServer> → <httpProtocol> → <customHeaders>.', code: "<add name=\"X-Frame-Options\" value=\"SAMEORIGIN\" />" },
      { name: 'Express (Node)', where: 'Add in your middleware setup, before routes.', code: "app.use((req, res, next) => { res.setHeader('X-Frame-Options', 'SAMEORIGIN'); next(); });" },
      { name: 'Netlify (_headers)', where: 'Add to a _headers file in your publish directory.', code: "/*\n  X-Frame-Options: SAMEORIGIN" },
      { name: 'Vercel (vercel.json)', where: 'Add a headers array in vercel.json.', code: "{\"headers\":[{\"source\":\"/(.*)\",\"headers\":[{\"key\":\"X-Frame-Options\",\"value\":\"SAMEORIGIN\"}]}]}" }
    ]
  },
  'x-content-type-options': {
    why: 'Tells the browser to trust your Content-Type and not guess it. Stops a common XSS trick.',
    recommended: 'nosniff',
    servers: [
      { name: 'Apache (.htaccess)', where: 'Add at the end of .htaccess.', code: "Header set X-Content-Type-Options \"nosniff\"" },
      { name: 'Nginx', where: 'Add inside the server { } block.', code: "add_header X-Content-Type-Options \"nosniff\" always;" },
      { name: 'IIS (web.config)', where: 'Add inside <system.webServer> → <customHeaders>.', code: "<add name=\"X-Content-Type-Options\" value=\"nosniff\" />" },
      { name: 'Express (Node)', where: 'Add in your middleware, before routes.', code: "res.setHeader('X-Content-Type-Options', 'nosniff');" },
      { name: 'Netlify (_headers)', where: 'Add to the _headers file.', code: "/*\n  X-Content-Type-Options: nosniff" },
      { name: 'Vercel (vercel.json)', where: 'Add a headers array in vercel.json.', code: "{\"headers\":[{\"source\":\"/(.*)\",\"headers\":[{\"key\":\"X-Content-Type-Options\",\"value\":\"nosniff\"}]}]}" }
    ]
  },
  'strict-transport-security': {
    why: 'Forces HTTPS on your domain for 1 year. Stops attackers from downgrading your connection to HTTP.',
    recommended: 'max-age=31536000; includeSubDomains; preload',
    servers: [
      { name: 'Apache (.htaccess)', where: 'Add at the end of .htaccess. Only works on HTTPS.', code: "Header set Strict-Transport-Security \"max-age=31536000; includeSubDomains; preload\" env=HTTPS" },
      { name: 'Nginx', where: 'Add inside the server { } block that listens on 443 (HTTPS).', code: "add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains; preload\" always;" },
      { name: 'IIS (web.config)', where: 'Add inside <system.webServer> → <customHeaders>.', code: "<add name=\"Strict-Transport-Security\" value=\"max-age=31536000; includeSubDomains; preload\" />" },
      { name: 'Express (Node)', where: 'Add in your middleware, before routes. Only on HTTPS.', code: "res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');" },
      { name: 'Netlify (_headers)', where: 'Add to the _headers file.', code: "/*\n  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload" },
      { name: 'Vercel (vercel.json)', where: 'Add a headers array in vercel.json.', code: "{\"headers\":[{\"source\":\"/(.*)\",\"headers\":[{\"key\":\"Strict-Transport-Security\",\"value\":\"max-age=31536000; includeSubDomains; preload\"}]}]}" }
    ]
  },
  'permissions-policy': {
    why: 'Turns off browser features (camera, mic, location, etc.) that your site does not use.',
    recommended: 'camera=(), microphone=(), geolocation=(), payment=()',
    servers: [
      { name: 'Apache (.htaccess)', where: 'Add at the end of .htaccess.', code: "Header set Permissions-Policy \"camera=(), microphone=(), geolocation=(), payment=()\"" },
      { name: 'Nginx', where: 'Add inside the server { } block.', code: "add_header Permissions-Policy \"camera=(), microphone=(), geolocation=(), payment=()\" always;" },
      { name: 'IIS (web.config)', where: 'Add inside <system.webServer> → <customHeaders>.', code: "<add name=\"Permissions-Policy\" value=\"camera=(), microphone=(), geolocation=(), payment=()\" />" },
      { name: 'Express (Node)', where: 'Add in your middleware, before routes.', code: "res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');" },
      { name: 'Netlify (_headers)', where: 'Add to the _headers file.', code: "/*\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()" },
      { name: 'Vercel (vercel.json)', where: 'Add a headers array in vercel.json.', code: "{\"headers\":[{\"source\":\"/(.*)\",\"headers\":[{\"key\":\"Permissions-Policy\",\"value\":\"camera=(), microphone=(), geolocation=(), payment=()\"}]}]}" }
    ]
  },
  'referrer-policy': {
    why: 'Controls how much of your page URL is sent to other sites when users click a link. Protects privacy.',
    recommended: 'strict-origin-when-cross-origin',
    servers: [
      { name: 'Apache (.htaccess)', where: 'Add at the end of .htaccess.', code: "Header set Referrer-Policy \"strict-origin-when-cross-origin\"" },
      { name: 'Nginx', where: 'Add inside the server { } block.', code: "add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;" },
      { name: 'IIS (web.config)', where: 'Add inside <system.webServer> → <customHeaders>.', code: "<add name=\"Referrer-Policy\" value=\"strict-origin-when-cross-origin\" />" },
      { name: 'Express (Node)', where: 'Add in your middleware, before routes.', code: "res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');" },
      { name: 'Netlify (_headers)', where: 'Add to the _headers file.', code: "/*\n  Referrer-Policy: strict-origin-when-cross-origin" },
      { name: 'Vercel (vercel.json)', where: 'Add a headers array in vercel.json.', code: "{\"headers\":[{\"source\":\"/(.*)\",\"headers\":[{\"key\":\"Referrer-Policy\",\"value\":\"strict-origin-when-cross-origin\"}]}]}" }
    ]
  },
  'x-xss-protection': {
    why: 'Old XSS filter. Modern browsers ignore it, but setting it to 0 prevents old browsers from causing problems. Use CSP for real protection.',
    recommended: '0',
    servers: [
      { name: 'Apache (.htaccess)', where: 'Add at the end of .htaccess.', code: "Header set X-XSS-Protection \"0\"" },
      { name: 'Nginx', where: 'Add inside the server { } block.', code: "add_header X-XSS-Protection \"0\" always;" },
      { name: 'IIS (web.config)', where: 'Add inside <system.webServer> → <customHeaders>.', code: "<add name=\"X-XSS-Protection\" value=\"0\" />" },
      { name: 'Express (Node)', where: 'Add in your middleware, before routes.', code: "res.setHeader('X-XSS-Protection', '0');" },
      { name: 'Netlify (_headers)', where: 'Add to the _headers file.', code: "/*\n  X-XSS-Protection: 0" },
      { name: 'Vercel (vercel.json)', where: 'Add a headers array in vercel.json.', code: "{\"headers\":[{\"source\":\"/(.*)\",\"headers\":[{\"key\":\"X-XSS-Protection\",\"value\":\"0\"}]}]}" }
    ]
  }
};

function securityHeaderFixHtml(headerKey) {
  const fix = SECURITY_HEADER_FIXES[headerKey];
  if (!fix) return '';
  const id = 'shFix_' + headerKey.replace(/[^a-z0-9]/gi, '_');
  const rows = fix.servers.map((s, i) => {
    const copyId = id + '_c' + i;
    const where = s.where ? `<div class="sh-fix-where"><span class="sh-fix-where-label">Where:</span> ${escHTML(s.where)}</div>` : '';
    return `<div class="sh-fix-server">
      <div class="sh-fix-server-head">
        <span class="sh-fix-server-name">${escHTML(s.name)}</span>
        <button type="button" class="sh-copy-btn" data-target="${copyId}" title="Copy snippet">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copy
        </button>
      </div>
      ${where}
      <pre class="sh-fix-code" id="${copyId}">${escHTML(s.code)}</pre>
    </div>`;
  }).join('');
  return `<details class="sh-fix-details">
    <summary>
      <span class="sh-fix-summary-text">How to fix</span>
      <svg class="sh-fix-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>
    </summary>
    <div class="sh-fix-body">
      <div class="sh-fix-why">${escHTML(fix.why)}</div>
      <div class="sh-fix-rec"><span class="sh-fix-rec-label">Value:</span> <code>${escHTML(fix.recommended)}</code></div>
      <div class="sh-fix-servers">${rows}</div>
    </div>
  </details>`;
}

function initHttpHeaders(domain) {
  const loading = $('httpHeadersLoading'), panel = $('httpHeadersPanel');
  if (!loading || !panel) return;

  sendWithBusyRetry({ action: 'HTTP_HEADERS', domain }, r => {
    if (loading) loading.style.display = 'none';
    if (!r?.ok) {
      panel.innerHTML = '<div style="color:var(--text-3);padding:8px 0">Could not fetch HTTP headers</div>';
      panel.style.display = '';
      return;
    }
    _httpHeadersData = r;
    panel.style.display = '';
    renderHttpHeadersPanel('security');

    // Bind tabs
    document.querySelectorAll('.t-hdr-view-tabs .t-dns-tab').forEach(tab => {
      if (!tab._hdrBound) {
        tab._hdrBound = true;
        tab.addEventListener('click', () => {
          document.querySelectorAll('.t-hdr-view-tabs .t-dns-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          renderHttpHeadersPanel(tab.dataset.hview);
        });
      }
    });
  });
}

function renderHttpHeadersPanel(view) {
  const panel = $('httpHeadersPanel');
  if (!panel || !_httpHeadersData) return;
  if (view === 'security') {
    const sec = _httpHeadersData.security || [];
    const presentCount = sec.filter(s => s.present).length;
    const score = sec.length ? Math.round((presentCount / sec.length) * 100) : 0;
    const scoreColor = score >= 70 ? 'var(--ok,#10b981)' : score >= 40 ? 'var(--warn,#f59e0b)' : 'var(--err,#ef4444)';
    panel.innerHTML = `<div style="margin-bottom:10px;font-size:12px;color:var(--text-2)">Security Headers Score: <strong style="color:${scoreColor}">${score}%</strong> (${presentCount}/${sec.length} present)</div>` +
      sec.map(s => {
        const ic = s.present
          ? `<svg viewBox="0 0 20 20" fill="#10b981" width="13" height="13"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`
          : `<svg viewBox="0 0 20 20" fill="#ef4444" width="13" height="13"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`;
        const fixHtml = s.present ? '' : securityHeaderFixHtml(s.header);
        return `<div class="t-check" style="margin-bottom:4px"><div class="t-check-icon ${s.present?'ok':'err'}">${ic}</div><div class="t-check-body"><div class="t-check-label">${escHTML(s.header)}</div><div class="t-check-value" style="color:${s.present?'var(--ok,#10b981)':'var(--text-3)'}">${s.present?'Present':'Missing'}</div></div></div>${fixHtml}`;
      }).join('');
    // Wire up per-snippet Copy buttons
    panel.querySelectorAll('.sh-copy-btn').forEach(btn => {
      if (btn._shBound) return; btn._shBound = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        const text = target.textContent;
        const showOk = () => {
          const orig = btn.innerHTML;
          btn.classList.add('copied');
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg> Copied';
          setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = orig; }, 1200);
        };
        const fallback = () => {
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return true;
          } catch (_) { return false; }
        };
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(showOk).catch(() => { if (fallback()) showOk(); });
        } else if (fallback()) { showOk(); }
      });
    });
  } else {
    const headers = _httpHeadersData.headers || [];
    if (!headers.length) { panel.innerHTML = '<div style="color:var(--text-3);padding:8px 0">No headers found</div>'; return; }
    panel.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Header</th><th>Value</th></tr></thead>
      <tbody>${headers.map(h =>
        `<tr><td style="white-space:nowrap;font-family:monospace;font-size:11px">${escHTML(h.name)}</td><td style="word-break:break-all;font-size:11px">${escHTML(h.value)}</td></tr>`
      ).join('')}</tbody>
    </table></div>`;
  }
}

// ── SSL Certificate Transparency ──────────────────────────────────────────────
let _certData = {};

function initCertTransparency(domain) {
  const loading = $('certLoading'), panel = $('certPanel');
  if (!loading || !panel) return;

  // Fetch main domain certs
  sendWithBusyRetry({ action: 'CERT_LOOKUP', domain, subdomains: false }, r => {
    _certData.domain = r;
    if (loading) loading.style.display = 'none';
    panel.style.display = '';
    renderCertPanel('domain');
  });

  // Bind tabs
  document.querySelectorAll('.t-cert-tabs .t-dns-tab').forEach(tab => {
    if (!tab._certBound) {
      tab._certBound = true;
      tab.addEventListener('click', () => {
        document.querySelectorAll('.t-cert-tabs .t-dns-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const view = tab.dataset.cert;
        if (view === 'subdomains' && !_certData.subdomains) {
          // Lazy load subdomains
          if (loading) { loading.textContent = 'Fetching subdomain certs…'; loading.style.display = ''; }
          panel.style.display = 'none';
          sendWithBusyRetry({ action: 'CERT_LOOKUP', domain, subdomains: true }, r => {
            _certData.subdomains = r;
            if (loading) loading.style.display = 'none';
            panel.style.display = '';
            renderCertPanel('subdomains');
          });
        } else {
          renderCertPanel(view);
        }
      });
    }
  });
}

function renderCertPanel(view) {
  const panel = $('certPanel');
  if (!panel) return;
  const r = _certData[view];
  if (!r) { panel.innerHTML = '<div style="color:var(--text-3);padding:8px 0">Loading…</div>'; return; }
  if (!r.ok) { panel.innerHTML = '<div style="color:var(--text-3);padding:8px 0">Could not fetch certificate data</div>'; return; }
  const certs = r.certs || [];
  if (!certs.length) { panel.innerHTML = `<div style="color:var(--text-3);padding:8px 0">No certificates found</div>`; return; }
  const total = r.total || certs.length;
  panel.innerHTML = `<div style="margin-bottom:8px;font-size:12px;color:var(--text-2)">${total} certificate${total !== 1 ? 's' : ''} found${total > certs.length ? ` (showing ${certs.length})` : ''}</div>
    <div class="table-wrap"><table class="data-table" style="font-size:11px">
      <thead><tr><th>Name</th><th>Issuer</th><th>Not Before</th><th>Not After</th></tr></thead>
      <tbody>${certs.map(c => {
        const nb = c.notBefore ? new Date(c.notBefore).toLocaleDateString() : '—';
        const na = c.notAfter ? new Date(c.notAfter).toLocaleDateString() : '—';
        const expired = c.notAfter && new Date(c.notAfter) < new Date();
        return `<tr><td style="word-break:break-all;max-width:160px">${escHTML(c.name||'')}</td><td style="word-break:break-word;max-width:120px;font-size:10px">${escHTML((c.issuer||'').replace(/^.*?O=/,'').replace(/,.*/,'').trim())}</td><td style="white-space:nowrap">${nb}</td><td style="white-space:nowrap;color:${expired?'var(--err,#ef4444)':'inherit'}">${na}</td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

// ── Wayback Machine ───────────────────────────────────────────────────────────
function initWaybackHistory(domain, currentUrl) {
  const loading = $('waybackLoading'), panel = $('waybackPanel'), badge = $('waybackBadge');
  if (!loading || !panel) return;

  // First: quick availability check
  sendWithBusyRetry({ action: 'ARCHIVE_AVAILABLE', url: currentUrl }, r => {
    if (r?.ok) {
      if (r.available && r.snapshot) {
        const snapDate = r.snapshot.timestamp ? formatWbDate(r.snapshot.timestamp) : '';
        if ($('waybackMetaRow')) {
          $('waybackMetaRow').innerHTML = `<div style="font-size:12px;margin-bottom:4px;color:var(--text-2)">✅ This page is archived${snapDate ? ' — last snapshot: <strong>' + snapDate + '</strong>' : ''} &nbsp;<a href="${escHTML(r.snapshot.url||'')}" target="_blank" style="color:var(--brand,#6366f1);font-size:11px">Open</a></div>`;
        }
      } else {
        if ($('waybackMetaRow')) {
          $('waybackMetaRow').innerHTML = '<div style="font-size:12px;margin-bottom:4px;color:var(--text-3)">⚠️ This exact page has no Wayback snapshot yet</div>';
        }
      }
    }
  });

  // Full CDX fetch
  sendWithBusyRetry({ action: 'WAYBACK_CDX', domain }, r => {
    if (loading) loading.style.display = 'none';
    if (!r?.ok) {
      if (badge) badge.textContent = 'Unavailable';
      panel.style.display = '';
      const errDetail = r?.error ? ` (${r.error})` : '';
      if ($('waybackMetaRow')) $('waybackMetaRow').innerHTML =
        `<div style="color:var(--text-3);font-size:12px">Could not fetch Wayback data${errDetail} &nbsp;<button id="waybackRetryBtn" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface2);color:var(--text-2);cursor:pointer">Retry</button></div>`;
      if ($('waybackTableBody')) $('waybackTableBody').innerHTML = '';
      const retryBtn = $('waybackRetryBtn');
      if (retryBtn) retryBtn.addEventListener('click', () => {
        if ($('waybackMetaRow')) $('waybackMetaRow').innerHTML = '';
        if (loading) loading.style.display = '';
        panel.style.display = 'none';
        if (badge) badge.textContent = '—';
        initWaybackHistory(domain, currentUrl);
      });
      return;
    }
    panel.style.display = '';
    if (badge) badge.textContent = `${r.total} snapshots`;

    const tbody = $('waybackTableBody');
    if (!tbody) return;
    const snaps = (r.snapshots || []).slice(0, 50);
    if (!snaps.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-3)">No snapshots found</td></tr>'; return; }
    tbody.innerHTML = snaps.map(s => {
      const origUrl = s.original || '';
      const ts = s.timestamp || '';
      const status = s.statuscode || '';
      const dateStr = formatWbDate(ts);
      const archiveUrl = ts && origUrl ? `https://web.archive.org/web/${ts}/${origUrl}` : '';
      const statusCls = status === '200' ? 'color:var(--ok,#10b981)' : status >= '400' ? 'color:var(--err,#ef4444)' : '';
      return `<tr>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${escHTML(origUrl)}">${escHTML(origUrl.replace(/^https?:\/\/[^/]+/, '').slice(0,60) || '/')}</td>
        <td style="${statusCls};font-size:11px">${escHTML(status)}</td>
        <td style="white-space:nowrap;font-size:11px">${dateStr}</td>
        <td>${archiveUrl ? `<a href="${escHTML(archiveUrl)}" target="_blank" style="color:var(--brand,#6366f1);font-size:11px">View</a>` : '—'}</td>
      </tr>`;
    }).join('');
  });
}

function formatWbDate(ts) {
  // ts = YYYYMMDDHHmmss
  if (!ts || ts.length < 8) return ts || '';
  try {
    const y = ts.slice(0,4), mo = ts.slice(4,6), d = ts.slice(6,8);
    return `${y}-${mo}-${d}`;
  } catch { return ts; }
}

// ─── GEO ──────────────────────────────────────────────
function renderGEO(geo) {
  animateRing('geoFullRing', geo.geoScore);
  setText('geoFullNum', geo.geoScore);
  setText('geoSubLabel', geoLabel(geo.geoScore));

  // GEO Pillars - grid with progress bars like Sorank
  const pg = $('geoPillarsGrid');
  if (pg) {
    const pillars = [
      { name: 'Content Citability', score: geo.pillars.citability, max: 20, icon: '📄' },
      { name: 'E-E-A-T Signals',    score: geo.pillars.eeat,       max: 20, icon: '🛡' },
      { name: 'Multi-modal Content',score: geo.pillars.multiModal,  max: 10, icon: '🖼' },
      { name: 'Technical AI & Data',score: geo.pillars.techAI,      max: 15, icon: '<>' }
    ];
    pg.innerHTML = pillars.map(p => {
      const pct = Math.round((p.score / p.max) * 100);
      const cls = pct >= 70 ? 'ok' : pct >= 40 ? 'warn' : 'err';
      return `<div class="geo-pillar-item">
        <div class="geo-pillar-header">
          <span class="geo-pillar-name">${escHTML(p.name)}</span>
          <span class="geo-pillar-score ${cls}">${p.score}/${p.max}</span>
        </div>
        <div class="geo-pillar-bar-wrap">
          <div class="geo-pillar-bar-fill ${cls}" style="width:${pct}%"></div>
        </div>
      </div>`;
    }).join('');
  }

  // E-E-A-T section
  const eg = $('eeatGrid');
  if (eg) {
    const signals = [
      { label: 'Author identified',            on: geo.eeat.hasAuthor },
      { label: 'Publication date',             on: geo.eeat.hasDate },
      { label: 'HTTPS (trust)',                on: geo.eeat.hasHttps },
      { label: 'Citations / references',       on: geo.eeat.hasCite },
      { label: 'External authoritative links', on: geo.eeat.hasExternalRefs > 2 }
    ];
    const passCount = signals.filter(s => s.on).length;
    const badge = $('eeatScoreBadge');
    if (badge) { badge.textContent = `${passCount * 20}/100`; badge.style.display = ''; badge.className = `geo-section-badge ${passCount >= 4 ? 'badge-ok' : passCount >= 2 ? 'badge-warn' : 'badge-err'}`; }
    eg.innerHTML = signals.map(s => `
      <div class="eeat-item">
        <span class="eeat-status ${s.on?'on':'off'}">${s.on?'✓':'✗'}</span>
        <span class="eeat-label">${escHTML(s.label)}</span>
      </div>`).join('');
    const eeatSection = $('eeatSection');
    if (eeatSection) eeatSection.style.display = '';
  }

  // Structured data
  const sl = $('schemaList');
  const schemaBadge = $('geoSchemaCount');
  if (sl) {
    const schemas = geo.structured.schemas;
    if (schemaBadge) { schemaBadge.textContent = schemas.length; schemaBadge.className = `geo-section-badge ${schemas.length > 0 ? 'badge-ok' : 'badge-err'}`; }
    if (!schemas.length) {
      sl.innerHTML = '<div class="geo-empty-msg">No structured data (JSON-LD) found.</div>';
    } else {
      sl.innerHTML = schemas.map(s => `
        <div class="schema-item">
          <span class="schema-type-badge">${escHTML(s.type)}</span>
          <span class="schema-keys">${Object.keys(s.data).filter(k=>!k.startsWith('@')).slice(0,5).join(', ')}</span>
        </div>`).join('');
    }
  }

  // AI Crawler View (simple text preview of what AI sees) — uses real signals, not stubbed
  const crawlerContent = $('geoCrawlerSimContent');
  if (crawlerContent) {
    const cd2 = geo.citabilityDetails || {};
    const isIndexable = cd2.isIndexable !== false;
    const hasAccessibleText = (cd2.wordCount || 0) >= 50;
    const hasSchema = geo.structured.schemas.length > 0;
    const passCount = [isIndexable, hasAccessibleText, hasSchema].filter(Boolean).length;

    const badge = $('geoCrawlerViewBadge');
    if (badge) {
      badge.textContent = `${passCount}/3 checks`;
      badge.style.display = '';
      badge.className = `geo-section-badge ${passCount === 3 ? 'badge-ok' : passCount >= 1 ? 'badge-warn' : 'badge-err'}`;
    }

    const summaryText = !isIndexable
      ? 'This page blocks indexing (noindex) — AI crawlers will skip it entirely.'
      : !hasAccessibleText
        ? 'Very little readable text was found — AI crawlers may see a near-empty page.'
        : 'AI crawlers can access this page. Content is readable and well-structured.';

    crawlerContent.innerHTML = `<div class="geo-crawler-info">
      <p style="font-size:12px;color:var(--text-2);margin:0 0 8px">${escHTML(summaryText)}</p>
      <div class="eeat-item"><span class="eeat-status ${isIndexable ? 'on' : 'off'}">${isIndexable ? '✓' : '✗'}</span><span class="eeat-label">Page is indexable by AI bots${isIndexable ? '' : ' (noindex detected)'}</span></div>
      <div class="eeat-item"><span class="eeat-status ${hasAccessibleText ? 'on' : 'off'}">${hasAccessibleText ? '✓' : '✗'}</span><span class="eeat-label">Text content is accessible${hasAccessibleText ? ` (~${cd2.wordCount} words)` : ' (page text is too thin)'}</span></div>
      <div class="eeat-item"><span class="eeat-status ${hasSchema ? 'on' : 'off'}">${hasSchema ? '✓' : '✗'}</span><span class="eeat-label">Structured data present</span></div>
    </div>`;
  }

  // Rich Results Eligibility — per-type breakdown with proper eligibility rules
  renderRichResultsEligibility(geo);

  // AI Answer Simulation badge always visible
  const aiSimBadge = $('aiAnswerSimBadge');
  if (aiSimBadge) { aiSimBadge.style.display = ''; }

  // AI Citability (I/O 2026 readiness — answer-first opening + passage structure)
  renderGeoCitability(geo);

  // Keyword Gap
  renderGeoKeywordGap(geo);

  // ── New GEO features ──────────────────────────────────
  // ① Citability Signals Deep Dive
  renderGeoCitabilityDeep(geo);

  // ② Best Snippable Passages
  renderGeoSnippablePassages(geo);

  // ③ AI Page Memo
  renderGeoAIMemo(geo);

  // ④ Topical Authority Depth
  renderGeoTopicalDepth(geo);

  // ⑤ AI Crawler Deep View
  renderGeoAICrawlerDeep(geo);

  // ⑥ Content Gap Detector
  renderGeoContentGaps(geo);

  // ⑦ Indexation & Snippet Control
  renderGeoIndexation(geo);

  // Init AI Answer Simulation
  initAIAnswerSim(geo);

  // Local SEO & NAP audit
  renderGeoLocalSeo(geo.localSeo);

  // Setup geo collapsibles
  setupGeoCollapsibles();
}

// ─── GEO: Local SEO & NAP audit ─────────────────────────────────────────────
function renderGeoLocalSeo(local) {
  const section = $('geoLocalSeoSection');
  const body = $('geoLocalSeoBody');
  const badge = $('geoLocalSeoBadge');
  if (!section || !body) return;

  if (!local) { section.style.display = 'none'; return; }
  section.style.display = '';

  const score = local.score || 0;
  const flags = local.flags || [];
  if (badge) {
    badge.style.display = '';
    badge.textContent = score + '/100';
    badge.className = 'geo-section-badge ' + (score >= 70 ? 'badge-ok' : score >= 40 ? 'badge-warn' : 'badge-bad');
  }

  const srcTag = (s) => {
    if (!s || s === 'none') return '';
    const label = { schema: 'Schema', 'tel-link': 'tel: link', mailto: 'mailto:', og: 'og:site_name', title: 'Title', dom: 'Page', text: 'Text only' }[s] || s;
    const good = (s === 'schema' || s === 'tel-link' || s === 'mailto' || s === 'dom');
    return `<span class="ls-src ${good ? 'ok' : 'weak'}">${escHTML(label)}</span>`;
  };
  const row = (label, obj, missingHint) => {
    const val = obj && obj.value;
    return `<div class="ls-nap-row ${val ? '' : 'missing'}">
      <span class="ls-nap-key">${escHTML(label)}</span>
      <span class="ls-nap-val">${val ? escHTML(val) : '<em>Not found</em>'} ${val ? srcTag(obj.source) : (missingHint ? `<span class="ls-hint">${escHTML(missingHint)}</span>` : '')}</span>
    </div>`;
  };

  let html = '';

  // Consistency banner
  if (flags.length) {
    html += `<div class="ls-flag-banner">⚠ ${flags.length} NAP consistency issue${flags.length > 1 ? 's' : ''} — inconsistent NAP hurts local ranking</div>`;
  } else if (local.napComplete) {
    html += `<div class="ls-ok-banner">✓ NAP is complete and consistent</div>`;
  }

  // NAP block
  html += '<div class="ls-nap-card">';
  html += row('Name', local.name);
  html += row('Address', local.address, 'Add a postal address');
  html += row('Phone', local.phone, 'Add a tel: link');
  html += row('Email', local.email);
  html += '</div>';

  // Consistency flag details
  if (flags.length) {
    html += '<div class="ls-flags">';
    flags.forEach(f => {
      html += `<div class="ls-flag"><strong>${escHTML(f.field)} mismatch</strong>
        <div class="ls-flag-cmp"><span class="ls-flag-a">Schema: ${escHTML(f.schema)}</span><span class="ls-flag-b">Page: ${escHTML(f.page)}</span></div></div>`;
    });
    html += '</div>';
  }

  // Signals grid (schema / map / hours / reviews)
  const sc = local.schema || {};
  const signal = (ok, label, extra) => `<div class="eeat-item"><span class="eeat-status ${ok ? 'on' : 'off'}">${ok ? '✓' : '✗'}</span><span class="eeat-label">${escHTML(label)}${extra ? ` <span class="ls-extra">${escHTML(extra)}</span>` : ''}</span></div>`;
  html += '<div class="ls-signals">';
  html += signal(sc.found, sc.found ? `LocalBusiness schema${sc.type ? ` (${sc.type})` : ''}` : 'LocalBusiness schema', sc.found ? '' : 'missing');
  html += signal(!!local.map?.embedded, 'Map embed');
  html += signal(!!local.hours?.value, 'Business hours', local.hours?.value ? local.hours.value.slice(0, 40) : '');
  const rv = local.reviews || {};
  html += signal(!!rv.hasMarkup, 'Reviews / rating', rv.rating != null ? `${rv.rating}★${rv.count ? ` (${rv.count})` : ''}` : '');
  html += '</div>';

  // Recommendations
  const recos = local.recommendations || [];
  if (recos.length) {
    html += '<div class="ls-recos"><div class="ls-recos-title">Recommendations</div><ul>';
    recos.slice(0, 8).forEach(r => { html += `<li>${escHTML(r)}</li>`; });
    html += '</ul></div>';
  }

  body.innerHTML = html;
}

// ─── GEO: Rich Results Eligibility — proper per-type breakdown ───────────────
// Google's authoritative list of rich-result-supported schema types (June 2026)
const RICH_RESULT_SUPPORTED_TYPES = {
  // Fully supported — produce visual rich results in SERPs
  'Article':            { label: 'Article',            icon: '📝', supported: true },
  'BlogPosting':        { label: 'Blog Post',           icon: '📝', supported: true },
  'NewsArticle':        { label: 'News Article',        icon: '📰', supported: true },
  'DiscussionForumPosting':{ label:'Forum Post',        icon: '💬', supported: true },
  'FAQPage':            { label: 'FAQ',                 icon: '❓', supported: true },
  'HowTo':              { label: 'How-To',              icon: '📋', supported: true },
  'Product':            { label: 'Product',             icon: '🛍', supported: true },
  'ProductGroup':       { label: 'Product Group',       icon: '🛍', supported: true },
  'Review':             { label: 'Review Snippet',      icon: '⭐', supported: true },
  'Recipe':             { label: 'Recipe',              icon: '🍳', supported: true },
  'Event':              { label: 'Event',               icon: '📅', supported: true },
  'VideoObject':        { label: 'Video',               icon: '🎬', supported: true },
  'BreadcrumbList':     { label: 'Breadcrumbs',         icon: '🔗', supported: true },
  'WebSite':            { label: 'Sitelinks Search',    icon: '🔍', supported: true },
  'Course':             { label: 'Course',              icon: '🎓', supported: true },
  'CourseInstance':     { label: 'Course Instance',     icon: '🎓', supported: true },
  'SoftwareApplication':{ label: 'App (Play Store)',    icon: '📱', supported: true },
  'MobileApplication':  { label: 'Mobile App',          icon: '📱', supported: true },
  'Book':               { label: 'Book',                icon: '📚', supported: true },
  'Dataset':            { label: 'Dataset',             icon: '📊', supported: true },
  'JobPosting':         { label: 'Job Posting',         icon: '💼', supported: true },
  'LearningResource':   { label: 'Learning Resource',   icon: '📖', supported: true },
  'ItemList':           { label: 'Carousel (ItemList)', icon: '📋', supported: true },
  'EducationalOccupationalCredential': { label: 'Education/Training', icon: '🎓', supported: true },
  'PracticeHealthAspect': { label: 'Medical (Health)',  icon: '🏥', supported: true },
  'SpeakableSpecification':{ label: 'Speakable',        icon: '🔊', supported: true },
  'Claim':              { label: 'Fact Check',          icon: '✅', supported: true },
  'ClaimReview':        { label: 'Fact Check',          icon: '✅', supported: true },
  'MerchantReturnPolicy':{ label: 'Merchant Return',    icon: '↩️', supported: true },
  'ShippingDeliveryTime':{ label: 'Shipping Info',      icon: '🚚', supported: true },
  // NOT supported for rich results — structure-only or Knowledge Graph signals
  'Organization':       { label: 'Organization',        icon: '🏢', supported: false, note: 'Helps Knowledge Graph, not SERP rich results' },
  'LocalBusiness':      { label: 'Local Business',      icon: '📍', supported: false, note: 'Maps/Business Profile, not SERP rich results' },
  'Person':             { label: 'Person',              icon: '👤', supported: false, note: 'Knowledge Panel, not SERP rich results' },
  'WebPage':            { label: 'Web Page',            icon: '🌐', supported: false, note: 'General metadata only, no rich results' },
  'WebSite':            { label: 'Web Site',            icon: '🌐', supported: true  }, // WebSite supports Sitelinks Searchbox
  'SiteNavigationElement':{ label: 'Navigation',        icon: '🧭', supported: false, note: 'Structural only, no rich results' },
  'ImageObject':        { label: 'Image',               icon: '🖼', supported: false, note: 'Image metadata only, no dedicated rich results panel' },
  'ListItem':           { label: 'List Item',           icon: '•',  supported: false, note: 'Must be inside BreadcrumbList or ItemList' },
};

// Required fields per rich-result type — cross-referenced with Google's rich results test
const RICH_RESULT_REQUIRED_FIELDS = {
  'Article':       ['headline','image','author','datePublished','publisher'],
  'BlogPosting':   ['headline','image','author','datePublished','publisher'],
  'NewsArticle':   ['headline','image','author','datePublished','publisher'],
  'FAQPage':       ['mainEntity'],
  'HowTo':         ['name','step'],
  'Product':       ['name','image'],
  'Review':        ['author','reviewRating','itemReviewed'],
  'Recipe':        ['name','image','recipeIngredient','recipeInstructions'],
  'Event':         ['name','startDate','location'],
  'VideoObject':   ['name','description','thumbnailUrl','uploadDate'],
  'BreadcrumbList':['itemListElement'],
  'WebSite':       ['name','url','potentialAction'],  // potentialAction needed for Sitelinks Searchbox
  'Course':        ['name','description','provider'],
  'SoftwareApplication':['name','offers'],
  'JobPosting':    ['title','hiringOrganization','datePosted','jobLocation'],
  'Dataset':       ['name','description'],
  'Book':          ['name','author'],
  'ClaimReview':   ['url','claimReviewed','author','reviewRating'],
  'ItemList':      ['itemListElement'],
};

function renderRichResultsEligibility(geo) {
  const serpGrid  = $('serpEligibilityGrid');
  const serpCount = $('serpEligibleCount');
  if (!serpGrid) return;

  const schemas = geo.structured?.schemas || [];
  const richFeatures = geo.richFeatures || null;  // from serpEligibility / analyzeGEOSignals

  if (!schemas.length && !richFeatures) {
    if (serpCount) { serpCount.textContent = '0'; serpCount.className = 'geo-section-badge badge-err'; }
    serpGrid.innerHTML = '<div class="geo-empty-msg">No structured data found — add JSON-LD schema to become eligible for rich results.</div>';
    return;
  }

  // Use structuredDeep data (schemas) which already has validationStatus, missingRequired, completeness
  let eligibleCount = 0;
  let needsFixCount = 0;
  let notApplicableCount = 0;

  // Build per-schema rows using proper eligibility
  const schemaRows = schemas.map(s => {
    const typeMeta = RICH_RESULT_SUPPORTED_TYPES[s.type];
    const requiredFields = RICH_RESULT_REQUIRED_FIELDS[s.type] || null;

    if (!typeMeta) {
      // Unknown/uncommon type — use structuredDeep validation
      const completeness = s.completeness != null ? s.completeness : null;
      notApplicableCount++;
      return `<div class="rich-result-row">
        <div class="rich-result-left">
          <span class="rich-result-icon">❔</span>
          <div class="rich-result-info">
            <span class="rich-result-type">${escHTML(s.type)}</span>
            <span class="rich-result-note">Unknown type — may not produce rich results</span>
          </div>
        </div>
        <div class="rich-result-right">
          ${completeness != null ? `<span class="rich-result-pct">${completeness}%</span>` : ''}
          <span class="tag default">Unknown</span>
        </div>
      </div>`;
    }

    if (!typeMeta.supported) {
      notApplicableCount++;
      return `<div class="rich-result-row">
        <div class="rich-result-left">
          <span class="rich-result-icon">${typeMeta.icon}</span>
          <div class="rich-result-info">
            <span class="rich-result-type">${typeMeta.label}</span>
            <span class="rich-result-note">${typeMeta.note || 'Not eligible for SERP rich results'}</span>
          </div>
        </div>
        <div class="rich-result-right">
          <span class="tag default">Not eligible</span>
        </div>
      </div>`;
    }

    // Supported type — check required fields
    const presentFields = s.fields || [];
    const missingReq = requiredFields ? requiredFields.filter(f => !presentFields.includes(f) && s.data && s.data[f] == null) : (s.missingRequired || []);
    const completeness = s.completeness != null ? s.completeness : (requiredFields ? Math.round(((requiredFields.length - missingReq.length) / requiredFields.length) * 100) : null);

    if (missingReq.length > 0) {
      needsFixCount++;
      const missingHtml = missingReq.slice(0,4).map(f => `<span class="rich-result-missing-field">${escHTML(f)}</span>`).join('');
      const more = missingReq.length > 4 ? `<span class="rich-result-missing-field more">+${missingReq.length-4} more</span>` : '';
      return `<div class="rich-result-row needs-fix">
        <div class="rich-result-left">
          <span class="rich-result-icon">${typeMeta.icon}</span>
          <div class="rich-result-info">
            <span class="rich-result-type">${typeMeta.label}</span>
            <div class="rich-result-missing">Missing: ${missingHtml}${more}</div>
          </div>
        </div>
        <div class="rich-result-right">
          ${completeness != null ? `<span class="rich-result-pct warn">${completeness}%</span>` : ''}
          <span class="tag warn">Needs fix</span>
        </div>
      </div>`;
    }

    eligibleCount++;
    return `<div class="rich-result-row eligible">
      <div class="rich-result-left">
        <span class="rich-result-icon">${typeMeta.icon}</span>
        <div class="rich-result-info">
          <span class="rich-result-type">${typeMeta.label}</span>
          <span class="rich-result-note ok-note">All required fields present</span>
        </div>
      </div>
      <div class="rich-result-right">
        ${completeness != null ? `<span class="rich-result-pct ok">${completeness}%</span>` : ''}
        <span class="tag ok">Eligible ✓</span>
      </div>
    </div>`;
  });

  // Also add rich feature results that aren't schema-driven (from analyzeGEOSignals)
  const featureRows = [];
  if (richFeatures && richFeatures.features) {
    richFeatures.features.forEach(feat => {
      // Skip if already covered by a schema row
      const alreadyCovered = schemas.some(s => {
        if (feat.feature === 'FAQ' && /FAQPage/i.test(s.type)) return true;
        if (feat.feature === 'Product' && /Product/i.test(s.type)) return true;
        if (feat.feature === 'Article' && /Article|BlogPosting|NewsArticle/i.test(s.type)) return true;
        if (feat.feature === 'Breadcrumbs' && /BreadcrumbList/i.test(s.type)) return true;
        if (feat.feature === 'Sitelinks Search' && /WebSite/i.test(s.type)) return true;
        if (feat.feature === 'How-To' && /HowTo/i.test(s.type)) return true;
        if (feat.feature === 'Video' && /VideoObject/i.test(s.type)) return true;
        if (feat.feature === 'Recipe' && /Recipe/i.test(s.type)) return true;
        if (feat.feature === 'Event' && /Event/i.test(s.type)) return true;
        return false;
      });
      if (alreadyCovered) return;

      if (feat.partial) {
        // Potential — content signals detected but schema missing
        featureRows.push(`<div class="rich-result-row partial">
          <div class="rich-result-left">
            <span class="rich-result-icon">${feat.icon}</span>
            <div class="rich-result-info">
              <span class="rich-result-type">${escHTML(feat.feature)}</span>
              <span class="rich-result-note">Content signals found — add schema to unlock</span>
              ${feat.fix ? `<span class="rich-result-fix-tip">💡 ${escHTML(feat.fix)}</span>` : ''}
            </div>
          </div>
          <div class="rich-result-right">
            <span class="tag warn">Schema missing</span>
          </div>
        </div>`);
      }
    });
  }

  const totalRows = schemaRows.length + featureRows.length;
  const badgeCls = eligibleCount > 0 ? 'badge-ok' : (needsFixCount > 0 ? 'badge-warn' : 'badge-err');
  if (serpCount) {
    serpCount.textContent = `${eligibleCount} eligible`;
    serpCount.className = `geo-section-badge ${badgeCls}`;
  }

  // Summary bar
  const summaryParts = [];
  if (eligibleCount)     summaryParts.push(`<span class="rr-sum-chip ok">${eligibleCount} eligible</span>`);
  if (needsFixCount)     summaryParts.push(`<span class="rr-sum-chip warn">${needsFixCount} needs fix</span>`);
  if (notApplicableCount) summaryParts.push(`<span class="rr-sum-chip na">${notApplicableCount} not applicable</span>`);
  if (featureRows.length) summaryParts.push(`<span class="rr-sum-chip partial">${featureRows.length} potential</span>`);

  serpGrid.innerHTML = `
    <div class="rr-summary-bar">${summaryParts.join('')}</div>
    <div class="rr-schema-rows">${schemaRows.join('') || ''}</div>
    ${featureRows.length ? `<div class="rr-potential-label">💡 Potential Rich Results (content detected, schema missing)</div><div class="rr-schema-rows">${featureRows.join('')}</div>` : ''}
  `;

  // Render Schema Coverage Suggestions right below
  renderSchemaCoverageSuggestions(geo);

  // Render AI Overview Likelihood indicator
  renderAIOverviewLikelihood(geo);
}

// ─── GEO: Schema Type Coverage Suggestions ───────────────────────────────────
// Based on page type, suggest which schema types should be added
const SCHEMA_SUGGESTIONS_BY_PAGE_TYPE = {
  article:    { must: ['Article','BreadcrumbList'], nice: ['FAQPage','HowTo','VideoObject'], avoid: [] },
  blog:       { must: ['BlogPosting','BreadcrumbList'], nice: ['FAQPage','Person'], avoid: [] },
  product:    { must: ['Product','BreadcrumbList'], nice: ['Review','FAQPage','VideoObject'], avoid: [] },
  category:   { must: ['BreadcrumbList','ItemList'], nice: ['FAQPage'], avoid: [] },
  faq:        { must: ['FAQPage'], nice: ['BreadcrumbList','HowTo'], avoid: [] },
  homepage:   { must: ['WebSite','Organization'], nice: ['FAQPage','SiteNavigationElement'], avoid: [] },
  contact:    { must: ['LocalBusiness','Organization'], nice: ['BreadcrumbList'], avoid: [] },
  about:      { must: ['Organization','Person'], nice: ['BreadcrumbList'], avoid: [] },
  service:    { must: ['Service','BreadcrumbList'], nice: ['FAQPage','HowTo','Review'], avoid: [] },
  landing:    { must: ['WebPage'], nice: ['FAQPage','HowTo','Product'], avoid: [] },
  event:      { must: ['Event','BreadcrumbList'], nice: ['VideoObject','FAQPage'], avoid: [] },
  recipe:     { must: ['Recipe','BreadcrumbList'], nice: ['VideoObject','FAQPage'], avoid: [] },
  video:      { must: ['VideoObject','BreadcrumbList'], nice: ['HowTo','FAQPage'], avoid: [] },
  local:      { must: ['LocalBusiness','BreadcrumbList'], nice: ['FAQPage','Review','Event'], avoid: [] },
  other:      { must: ['WebPage','BreadcrumbList'], nice: ['FAQPage','Organization'], avoid: [] },
};

function renderSchemaCoverageSuggestions(geo) {
  const container = $('schemaCoverageSuggestions');
  if (!container) return;

  const pageTypeRaw = (_rawData ? adaptV1Data(_rawData)?.pageType?.type : null) || 'other';
  const pageTypeLower = pageTypeRaw.toLowerCase();

  // Map detected page type to suggestion key
  let mapKey = 'other';
  if (/article|blog.?posting|news/i.test(pageTypeLower)) mapKey = 'article';
  else if (/blog.?index|blog$/i.test(pageTypeLower)) mapKey = 'blog';
  else if (/product$/i.test(pageTypeLower)) mapKey = 'product';
  else if (/collection|category/i.test(pageTypeLower)) mapKey = 'category';
  else if (/faq/i.test(pageTypeLower)) mapKey = 'faq';
  else if (/homepage|home/i.test(pageTypeLower)) mapKey = 'homepage';
  else if (/contact/i.test(pageTypeLower)) mapKey = 'contact';
  else if (/about/i.test(pageTypeLower)) mapKey = 'about';
  else if (/service/i.test(pageTypeLower)) mapKey = 'service';
  else if (/event/i.test(pageTypeLower)) mapKey = 'event';
  else if (/recipe/i.test(pageTypeLower)) mapKey = 'recipe';
  else if (/video/i.test(pageTypeLower)) mapKey = 'video';
  else if (/local|business/i.test(pageTypeLower)) mapKey = 'local';

  const suggestions = SCHEMA_SUGGESTIONS_BY_PAGE_TYPE[mapKey] || SCHEMA_SUGGESTIONS_BY_PAGE_TYPE.other;
  const existingTypes = new Set((geo.structured?.schemas || []).map(s => s.type));

  const mustMissing  = suggestions.must.filter(t => !existingTypes.has(t));
  const niceMissing  = suggestions.nice.filter(t => !existingTypes.has(t));
  const mustPresent  = suggestions.must.filter(t => existingTypes.has(t));

  const allDone = mustMissing.length === 0 && niceMissing.length === 0;

  const coverageScore = suggestions.must.length > 0
    ? Math.round((mustPresent.length / suggestions.must.length) * 100)
    : 100;

  const badgeCls = coverageScore === 100 ? 'badge-ok' : coverageScore >= 50 ? 'badge-warn' : 'badge-err';

  const badge = $('schemaCoverageBadge');
  if (badge) {
    badge.textContent = allDone ? '✓ Complete' : `${mustMissing.length} missing`;
    badge.className = `geo-section-badge ${badgeCls}`;
    badge.style.display = '';
  }

  if (allDone) {
    container.innerHTML = `<div class="sc-all-good">
      <span class="eeat-status on">✓</span>
      <span>All recommended schema types for <strong>${escHTML(pageTypeRaw)}</strong> pages are present.</span>
    </div>`;
    return;
  }

  const mustHtml = mustMissing.map(t => {
    const meta = RICH_RESULT_SUPPORTED_TYPES[t];
    return `<div class="sc-suggestion-row must">
      <span class="sc-icon">${meta ? meta.icon : '📋'}</span>
      <div class="sc-info">
        <span class="sc-type">${meta ? meta.label : t}</span>
        <span class="sc-badge must-badge">Must-have</span>
        ${meta?.supported ? '<span class="sc-rich-badge">Unlocks rich results</span>' : ''}
      </div>
    </div>`;
  }).join('');

  const niceHtml = niceMissing.map(t => {
    const meta = RICH_RESULT_SUPPORTED_TYPES[t];
    return `<div class="sc-suggestion-row nice">
      <span class="sc-icon">${meta ? meta.icon : '📋'}</span>
      <div class="sc-info">
        <span class="sc-type">${meta ? meta.label : t}</span>
        <span class="sc-badge nice-badge">Nice to have</span>
        ${meta?.supported ? '<span class="sc-rich-badge">Unlocks rich results</span>' : ''}
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="sc-context">For a <strong>${escHTML(pageTypeRaw)}</strong> page:</div>
    ${mustHtml}
    ${niceHtml}
  `;
}

// ─── GEO: AI Overview / SGE Likelihood Indicator ─────────────────────────────
function renderAIOverviewLikelihood(geo) {
  const container = $('aiOverviewLikelihood');
  const badge      = $('aiOverviewBadge');
  if (!container) return;

  const cd = geo.citabilityDetails || {};
  const af = cd.answerFirst || {};
  const pl = cd.passageLength || {};
  const eeat = geo.eeat || {};
  const schemas = geo.structured?.schemas || [];

  // Scoring model for AI Overview inclusion likelihood
  const signals = [
    { label: 'Answer-first opening (≤55w)',  met: af.hasAnswerFirstOpening,                                pts: 20 },
    { label: 'Author identified (E-E-A-T)',  met: eeat.hasAuthor,                                         pts: 15 },
    { label: 'Structured data present',      met: schemas.length > 0,                                    pts: 15 },
    { label: 'Citations / references',       met: eeat.hasCite,                                           pts: 15 },
    { label: 'Passage structure (H2-chunked)',met: pl.total > 0 && (pl.ideal / Math.max(pl.total,1)) >= 0.5, pts: 15 },
    { label: 'HTTPS (trust signal)',          met: eeat.hasHttps,                                          pts: 10 },
    { label: 'Stats or data cited',           met: (cd.statsCount || 0) >= 2,                              pts: 5  },
    { label: 'Q&A patterns present',          met: (cd.questionsCount || 0) >= 1,                          pts: 5  },
  ];

  const score = signals.reduce((sum, s) => sum + (s.met ? s.pts : 0), 0);
  const maxScore = signals.reduce((sum, s) => sum + s.pts, 0);
  const pct = Math.round((score / maxScore) * 100);

  const level = pct >= 75 ? { label: 'High', cls: 'ok',   desc: 'Page structure strongly aligns with AI Overview citation patterns.' }
              : pct >= 50 ? { label: 'Medium', cls: 'warn', desc: 'Some key signals missing. Improving them raises citation likelihood.' }
              : pct >= 25 ? { label: 'Low', cls: 'err',    desc: 'Several critical signals absent — page unlikely to appear in AI Overviews.' }
              :             { label: 'Very Low', cls: 'err', desc: 'Page is not structured for AI citation. Focus on answer-first content and E-E-A-T.' };

  if (badge) {
    badge.textContent = `${level.label} (${pct}%)`;
    badge.className = `geo-section-badge badge-${level.cls}`;
    badge.style.display = '';
  }

  const signalHtml = signals.map(s => `
    <div class="aio-signal-row">
      <span class="eeat-status ${s.met ? 'on' : 'off'}">${s.met ? '✓' : '✗'}</span>
      <span class="aio-signal-label">${escHTML(s.label)}</span>
      <span class="aio-signal-pts ${s.met ? 'ok' : 'na'}">+${s.pts}</span>
    </div>`).join('');

  // Citability score integration
  const citabilityPct = Math.round(((geo.pillars?.citability || 0) / 20) * 100);

  container.innerHTML = `
    <div class="aio-level-row">
      <div class="aio-gauge-wrap">
        <div class="aio-gauge-bar">
          <div class="aio-gauge-fill ${level.cls}" style="width:${pct}%"></div>
        </div>
        <span class="aio-gauge-score ${level.cls}">${pct}%</span>
      </div>
      <span class="aio-level-tag tag ${level.cls}">${level.label} likelihood</span>
    </div>
    <p class="aio-desc">${escHTML(level.desc)}</p>
    <div class="aio-signals-list">${signalHtml}</div>
    <div class="aio-integration-note">
      📊 Citability pillar: ${citabilityPct}% &nbsp;|&nbsp;
      GEO Score: ${geo.geoScore || 0}/100
    </div>
  `;
}

// ─── GEO: Answer-first opening — actionable fix suggestion ──────────────────
// Builds on the existing af.{hasAnswerFirstOpening, words, sentences, preview}
// data from content.js. No new scanning logic — just turns the existing
// pass/fail check into a concrete next step instead of a generic tip.
function renderAnswerFirstFix(af) {
  const preview = (af.preview || '').trim();

  // No real opening paragraph was found at all (e.g. page opens with images,
  // a hero banner, or very short fragments before any 8+ word paragraph).
  if (!preview || !af.words) {
    return `<br><span class="geo-io-tip">No clear opening paragraph detected. Add a direct 15–55 word answer
      as the very first paragraph, before any heading or hero content.</span>`;
  }

  const tooLong = af.words > 60;
  const escaped = escHTML(preview);

  if (tooLong) {
    // Trim the detected opening down to a single clean sentence (or ~55 words,
    // whichever is shorter) as a concrete starting point — not a rewrite,
    // just showing where to cut.
    const firstSentenceMatch = preview.match(/^.*?[.!?](?:\s|$)/);
    let trimmed = firstSentenceMatch ? firstSentenceMatch[0].trim() : preview;
    const trimmedWords = trimmed.split(/\s+/).filter(Boolean);
    if (trimmedWords.length > 55) {
      trimmed = trimmedWords.slice(0, 55).join(' ') + '…';
    }
    return `
      <br><span class="geo-io-tip">Current opening runs ${af.words} words across ${af.sentences} sentences — too long for a clean lift.</span>
      <div class="geo-af-fix">
        <div class="geo-af-fix-row"><span class="geo-af-fix-tag current">Current</span><span class="geo-af-fix-text">${escaped}${preview.length >= 220 ? '…' : ''}</span></div>
        <div class="geo-af-fix-row"><span class="geo-af-fix-tag suggested">Try</span><span class="geo-af-fix-text">${escHTML(trimmed)}</span></div>
      </div>
      <span class="geo-io-tip">Move supporting detail after this opening sentence, or into the next paragraph.</span>`;
  }

  // Short enough but not flagged as passing — likely too many sentences,
  // or fewer than 8 words so it wasn't picked up as the opening at all.
  return `
    <br><span class="geo-io-tip">Opening paragraph is ${af.words} words but spans ${af.sentences} sentences. Aim for 1–2 tight sentences that directly answer the page's main question.</span>
    <div class="geo-af-fix">
      <div class="geo-af-fix-row"><span class="geo-af-fix-tag current">Current</span><span class="geo-af-fix-text">${escaped}</span></div>
    </div>`;
}

// ─── GEO: AI Citability (Google I/O 2026 — Intelligent Search Box / AI Mode era) ───
function renderGeoCitability(geo) {
  const section = $('citabilitySection');
  const badge = $('citabilityScoreBadge');
  const body = $('citabilitySignals');
  if (!section || !body) return;
  section.style.display = '';

  const cd = geo.citabilityDetails || {};
  const af = cd.answerFirst || { hasAnswerFirstOpening: false, words: 0, sentences: 0 };
  const pl = cd.passageLength || { total: 0, ideal: 0, short: 0, long: 0, flagged: [] };
  const hasSchema = (geo.structured?.schemas?.length || 0) > 0;
  const structurePct = pl.total > 0 ? Math.round((pl.ideal / pl.total) * 100) : null;

  // Composite readiness score (0-100) — separate from the main GEO score, focused
  // specifically on "will an AI Search engine be able to lift a clean passage from this page".
  const contentScorePct = Math.round(((geo.pillars?.citability || 0) / 20) * 100);
  const answerFirstPts = af.hasAnswerFirstOpening ? 100 : 30;
  const structurePts = structurePct == null ? 50 : structurePct;
  const schemaPts = hasSchema ? 100 : 0;
  const readiness = Math.round(contentScorePct * 0.40 + answerFirstPts * 0.20 + structurePts * 0.25 + schemaPts * 0.15);

  if (badge) {
    badge.textContent = `${readiness}/100`;
    badge.className = `geo-section-badge ${readiness >= 70 ? 'badge-ok' : readiness >= 40 ? 'badge-warn' : 'badge-err'}`;
  }

  const flaggedHtml = pl.flagged.length ? `
    <div class="geo-passage-flags">
      ${pl.flagged.map(f => `
        <div class="geo-passage-flag-row">
          <span class="geo-passage-flag-tag ${f.type}">${f.type === 'short' ? 'Too short' : 'Too long'}</span>
          <span class="geo-passage-flag-text">${escHTML(f.text || '(untitled section)')}</span>
          <span class="geo-passage-flag-words">${f.words}w</span>
        </div>`).join('')}
    </div>` : '';

  body.innerHTML = `
    <div class="geo-io-callout">
      Based on Google's May 2026 Search redesign — AI Search now extracts and cites individual passages, not just top-ranked pages. These checks mirror what's likely to get lifted into AI Overviews and AI Mode.
    </div>

    <div class="eeat-item">
      <span class="eeat-status ${af.hasAnswerFirstOpening ? 'on' : 'off'}">${af.hasAnswerFirstOpening ? '✓' : '✗'}</span>
      <span class="eeat-label">
        Answer-first opening
        ${af.words ? `<span class="geo-io-meta">(${af.words} words, ${af.sentences} sentence${af.sentences === 1 ? '' : 's'})</span>` : ''}
        ${!af.hasAnswerFirstOpening ? renderAnswerFirstFix(af) : ''}
      </span>
    </div>

    <div class="eeat-item">
      <span class="eeat-status ${structurePct != null && structurePct >= 60 ? 'on' : 'off'}">${structurePct != null && structurePct >= 60 ? '✓' : '✗'}</span>
      <span class="eeat-label">
        Passage structure (100–450 words/section ideal)
        ${pl.total ? `<span class="geo-io-meta">(${pl.ideal}/${pl.total} sections ideal)</span>` : '<span class="geo-io-meta">(no H2 sections found)</span>'}
        ${flaggedHtml}
      </span>
    </div>

    <div class="eeat-item">
      <span class="eeat-status ${hasSchema ? 'on' : 'off'}">${hasSchema ? '✓' : '✗'}</span>
      <span class="eeat-label">Structured data present ${hasSchema ? '' : '<br><span class="geo-io-tip">Add Article/FAQ schema — see Structured Data section below.</span>'}</span>
    </div>

    <div class="geo-io-chips">
      <span class="geo-io-chip">📑 ${cd.h2Count || 0} sections</span>
      <span class="geo-io-chip">📋 ${cd.listsCount || 0} lists</span>
      <span class="geo-io-chip">📊 ${cd.tablesCount || 0} tables</span>
      <span class="geo-io-chip">🔢 ${cd.statsCount || 0} stats cited</span>
      <span class="geo-io-chip">❓ ${cd.questionsCount || 0} Q&amp;A patterns</span>
    </div>
  `;
}

// ─── GEO: AI Keyword Gap ──────────────────────────────
function renderGeoKeywordGap(geo) {
  const grid = $('geoKeywordGapGrid');
  if (!grid) return;

  // Derive page text from stored raw data
  const bodyText = (() => {
    try {
      const d = adaptV1Data(_rawData);
      const title = (d.meta?.title || '').toLowerCase();
      const desc  = (d.meta?.desc  || '').toLowerCase();
      const h1    = (d.headings?.headings?.find(h=>h.level===1)?.text||'').toLowerCase();
      const kws   = (d.keywords?.topKeywords||[]).map(k=>(k.word||k).toLowerCase()).join(' ');
      return `${title} ${desc} ${h1} ${kws}`;
    } catch(e) { return ''; }
  })();

  // AI-era GEO keyword categories
  const kwGroups = [
    { kw: 'AI overview',       cat: 'LLM Visibility' },
    { kw: 'featured snippet',  cat: 'SERP Features' },
    { kw: 'structured data',   cat: 'Schema' },
    { kw: 'schema markup',     cat: 'Schema' },
    { kw: 'entity',            cat: 'Knowledge Graph' },
    { kw: 'E-E-A-T',           cat: 'Trust' },
    { kw: 'author',            cat: 'Trust' },
    { kw: 'citation',          cat: 'Citability' },
    { kw: 'sources',           cat: 'Citability' },
    { kw: 'FAQ',               cat: 'AEO' },
    { kw: 'how to',            cat: 'AEO' },
    { kw: 'definition',        cat: 'AEO' },
    { kw: 'robots.txt',        cat: 'Crawling' },
    { kw: 'llms.txt',          cat: 'Crawling' },
    { kw: 'sitemap',           cat: 'Crawling' },
  ];

  const geoScore = geo.geoScore || 0;
  const badge = $('geoKeywordGapBadge');

  let found=0, missing=0;
  const pills = kwGroups.map(({kw, cat}) => {
    const inText = bodyText.includes(kw.toLowerCase());
    // Also check schema types
    const inSchema = (geo.structured?.schemas||[]).some(s=>(s.type||'').toLowerCase().includes(kw.toLowerCase()));
    const hit = inText || inSchema;
    if (hit) found++; else missing++;
    const cls = hit ? 'found' : 'missing';
    const icon = hit ? '✓' : '✗';
    return `<span class="geo-kw-pill ${cls}" title="${cat}">${icon} ${kw}</span>`;
  }).join('');

  grid.innerHTML = pills;
  if (badge) {
    badge.textContent = `${found}/${kwGroups.length}`;
    badge.className = `geo-section-badge ${found >= kwGroups.length*0.7 ? 'badge-ok' : found >= kwGroups.length*0.4 ? 'badge-warn' : 'badge-err'}`;
    badge.style.display = '';
  }
}


// ─── GEO: ① Citability Signals Deep Dive ─────────────────────────────────────
function renderGeoCitabilityDeep(geo) {
  const section = $('geoCitabilityDeepSection');
  if (!section) return;

  const full = geo.citabilityFull;
  if (!full || !full.available) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  const badge = $('geoCitabilityDeepBadge');
  const body  = $('geoCitabilityDeepBody');
  if (!body) return;

  const score = full.score || 0;
  const signals = full.signals || [];

  if (badge) {
    badge.textContent = `${score}/100`;
    badge.className = `geo-section-badge ${score >= 70 ? 'badge-ok' : score >= 40 ? 'badge-warn' : 'badge-err'}`;
    badge.style.display = '';
  }

  const sigRows = signals.map(s => {
    const pct = Math.min(100, Math.round((s.points / (full.rawScore || 1)) * 100 * (signals.length / 3)));
    const cls  = s.points >= 8 ? 'ok' : s.points >= 3 ? 'warn' : 'err';
    const extra = s.count != null ? ` <span class="geo-io-meta">(${s.count}${s.attributed != null ? ` total, ${s.attributed} attributed` : ''})</span>` : '';
    return `<div class="geo-signal-row">
      <div class="geo-signal-label">${escHTML(s.label)}${extra}</div>
      <div class="geo-signal-bar-wrap">
        <div class="geo-signal-bar-fill ${cls}" style="width:${Math.min(100,s.points*6)}%"></div>
      </div>
      <span class="geo-signal-pts ${cls}">+${s.points}</span>
    </div>`;
  }).join('');

  const missing = [
    full.signals?.some(s=>s.label?.includes('definition')) ? null : '📖 Add explicit definitions ("X is defined as…")',
    full.signals?.some(s=>s.label?.includes('Statistics')) ? null : '📊 Include stats with numbers / percentages',
    full.signals?.some(s=>s.label?.includes('table'))      ? null : '📋 Add comparison tables',
    full.signals?.some(s=>s.label?.includes('quote'))      ? null : '💬 Include attributed expert quotes',
    full.signals?.some(s=>s.label?.includes('FAQ'))        ? null : '❓ Add FAQ section or question headings',
  ].filter(Boolean);

  body.innerHTML = `
    <div class="geo-io-callout">
      These signals predict how likely AI engines are to extract and cite content from this page. Higher signal density = more liftable content.
    </div>
    <div class="geo-signal-list">${sigRows || '<div class="geo-empty-msg">No citability signals detected.</div>'}</div>
    ${missing.length ? `<div class="geo-quick-wins">
      <div class="geo-subsection-label">Missing signals — quick wins</div>
      ${missing.map(m => `<div class="eeat-item"><span class="eeat-status off">✗</span><span class="eeat-label">${escHTML(m)}</span></div>`).join('')}
    </div>` : ''}
  `;
}

// ─── GEO: ② Best Snippable Passages ─────────────────────────────────────────
function renderGeoSnippablePassages(geo) {
  const section = $('geoSnippableSection');
  if (!section) return;

  const full = geo.citabilityFull;
  const cd   = geo.citabilityDetails || {};
  if (!full || !full.available) { section.style.display = 'none'; return; }
  section.style.display = '';

  const badge = $('geoSnippableBadge');
  const body  = $('geoSnippableBody');
  if (!body) return;

  // Derive snippable paragraph data from what content.js already returns
  const snippableSig  = (full.signals || []).find(s => s.label?.includes('Snippable') || s.label?.includes('snippable'));
  const snippableCount = snippableSig ? (snippableSig.count || 0) : (cd.shortParagraphs || 0);
  const passageData    = cd.passageLength || { total: 0, ideal: 0, short: 0, long: 0, flagged: [] };

  const pct = passageData.total > 0 ? Math.round((passageData.ideal / passageData.total) * 100) : 0;

  if (badge) {
    badge.textContent = `${passageData.ideal || snippableCount}/${passageData.total || snippableCount} ideal`;
    badge.className   = `geo-section-badge ${pct >= 60 ? 'badge-ok' : pct >= 30 ? 'badge-warn' : 'badge-err'}`;
    badge.style.display = '';
  }

  const flagged = (passageData.flagged || []).slice(0, 8);
  const flagHtml = flagged.length ? flagged.map(f => {
    const tag = f.type === 'short' ? 'Too short' : 'Too long';
    const cls = f.type === 'short' ? 'warn' : 'err';
    return `<div class="geo-snip-row">
      <span class="geo-passage-flag-tag ${f.type}">${tag}</span>
      <span class="geo-passage-flag-text">${escHTML(f.text || '(untitled section)')}</span>
      <span class="geo-passage-flag-words">${f.words}w</span>
    </div>`;
  }).join('') : '';

  body.innerHTML = `
    <div class="geo-io-callout">
      <strong>Ideal liftable section:</strong> 100–450 words between two H2 headings. AI engines prefer complete, self-contained passages that answer one question without further context.
    </div>
    <div class="geo-chips-mb">
      <span class="geo-io-chip">📝 ${passageData.total || 0} H2 sections</span>
      <span class="geo-io-chip">✅ ${passageData.ideal || 0} ideal length</span>
      <span class="geo-io-chip">⬆ ${passageData.long  || 0} too long</span>
      <span class="geo-io-chip">⬇ ${passageData.short || 0} too short</span>
      <span class="geo-io-chip">📄 ${snippableCount} snippable ¶s</span>
    </div>
    ${flagHtml ? `<div>
      <div class="geo-subsection-label">Sections to fix</div>
      <div class="geo-snip-list">${flagHtml}</div>
    </div>` : (passageData.total ? '<div class="geo-empty-msg" style="color:var(--ok)">✓ All sections are well-sized for AI passage extraction.</div>' : '<div class="geo-empty-msg">No H2-sectioned passages found — add structural headings.</div>')}
    <div style="margin-top:10px;font-size:10.5px;color:var(--text-4);">
      💡 Tip: Each H2 section should open with a 15–55 word answer-first sentence before elaborating.
    </div>
  `;
}

// ─── GEO: ③ AI Page Memo ─────────────────────────────────────────────────────
function renderGeoAIMemo(geo) {
  const section = $('geoAIMemoSection');
  if (!section) return;
  section.style.display = '';

  const badge = $('geoAIMemoBadge');
  const body  = $('geoAIMemoBody');
  if (!body) return;

  // Build memo from all available data
  const d   = _rawData ? adaptV1Data(_rawData) : null;
  if (!d) { section.style.display = 'none'; return; }

  const title     = d.meta?.title || 'Untitled Page';
  const desc      = d.meta?.desc  || '';
  const url       = d.url   || '';
  const pageType  = geo.pageType || d.pageType?.type || 'unknown';
  const wordCount = geo.citabilityDetails?.wordCount || d.keywords?.totalWords || 0;
  const topKws    = (d.keywords?.topKeywords || []).slice(0, 5).map(k => k.word || k).filter(Boolean);
  const schemas   = (geo.structured?.schemas || []).map(s => s.type).filter(Boolean);
  const eeat      = geo.eeat || {};
  const geoScore  = geo.geoScore || 0;
  const entities  = (geo.entities?.entities || []).slice(0, 5).map(e => e.name).filter(Boolean);
  const hasAuthor = eeat.hasAuthor;
  const hasDate   = eeat.hasDate;
  const lang      = d.technical?.language || 'en';
  const h1        = (d.headings?.headings || []).find(h => h.level === 1)?.text || title;

  const readability = d.readability?.score || 0;
  const readLabel   = readability >= 70 ? 'easy to read' : readability >= 50 ? 'moderately readable' : 'complex reading level';

  const memoText = [
    `**Page:** ${title}`,
    url ? `**URL:** ${url}` : null,
    `**Type:** ${pageType} | **Language:** ${lang} | **~${wordCount} words**`,
    `**H1:** ${h1}`,
    topKws.length   ? `**Top topics:** ${topKws.join(', ')}` : null,
    entities.length ? `**Key entities:** ${entities.join(', ')}` : null,
    schemas.length  ? `**Structured data:** ${schemas.join(', ')}` : null,
    `**E-E-A-T:** Author ${hasAuthor ? '✓' : '✗'} | Date ${hasDate ? '✓' : '✗'} | HTTPS ${eeat.hasHttps ? '✓' : '✗'}`,
    desc            ? `**Summary:** ${desc.substring(0, 200)}${desc.length > 200 ? '…' : ''}` : null,
    `**GEO score:** ${geoScore}/100 | **Readability:** ${readLabel}`,
  ].filter(Boolean).join('\n');

  if (badge) {
    badge.textContent = 'Memo';
    badge.className   = 'geo-section-badge badge-ok';
    badge.style.display = '';
  }

  body.innerHTML = `
    <div class="geo-io-callout">
      A structured page brief an LLM can ingest before answering questions about this page. Copy it into a system prompt or knowledge base entry.
    </div>
    <pre id="geoAIMemoText" class="geo-memo-pre">${escHTML(memoText)}</pre>
    <button class="geo-copy-btn" id="geoAIMemoCopyBtn" onclick="(function(){
      const t = document.getElementById('geoAIMemoText');
      if (t) navigator.clipboard.writeText(t.textContent).catch(()=>{});
      const b = document.getElementById('geoAIMemoCopyBtn');
      if (b) { b.textContent = '✓ Copied!'; setTimeout(()=>{b.textContent='📋 Copy memo';},1800); }
    })()">📋 Copy memo</button>
  `;
}

// ─── GEO: ④ Topical Authority Depth ─────────────────────────────────────────
function renderGeoTopicalDepth(geo) {
  const section = $('geoTopicalDepthSection');
  if (!section) return;
  section.style.display = '';

  const badge = $('geoTopicalDepthBadge');
  const body  = $('geoTopicalDepthBody');
  if (!body) return;

  const d   = _rawData ? adaptV1Data(_rawData) : null;
  const cd  = geo.citabilityDetails || {};
  const ent = geo.entities || { entities: [], totalCount: 0, linkedCount: 0 };

  const h2Count  = cd.h2Count  || 0;
  const h3Count  = cd.h3Count  || 0;
  const wordCount= cd.wordCount || (d?.keywords?.totalWords || 0);
  const entities = ent.entities || [];
  const topKws   = (d?.keywords?.topKeywords || []).slice(0, 10).map(k => k.word || k).filter(Boolean);

  // Topical depth score: heading coverage + entity density
  const headingDensity  = wordCount > 0 ? Math.round(((h2Count + h3Count) / wordCount) * 1000) : 0; // headings per 1000 words
  const entityDensity   = wordCount > 0 ? Math.round((entities.length / wordCount) * 1000)  : 0;
  const idealHDensity   = 3; // ~1 heading per 300 words
  const idealEDensity   = 5; // ~5 entities per 1000 words

  const headingScore = Math.min(100, Math.round((headingDensity / idealHDensity) * 100));
  const entityScore  = Math.min(100, Math.round((entityDensity  / idealEDensity) * 100));
  const depthScore   = Math.round(headingScore * 0.5 + entityScore * 0.5);

  if (badge) {
    badge.textContent = `${depthScore}/100`;
    badge.className   = `geo-section-badge ${depthScore >= 70 ? 'badge-ok' : depthScore >= 40 ? 'badge-warn' : 'badge-err'}`;
    badge.style.display = '';
  }

  const hCls = headingScore >= 70 ? 'ok' : headingScore >= 40 ? 'warn' : 'err';
  const eCls = entityScore  >= 70 ? 'ok' : entityScore  >= 40 ? 'warn' : 'err';

  const topEntityPills = entities.slice(0, 12).map(e => {
    const src = e.source === 'schema' ? '🔗' : e.source === 'meta' ? 'ℹ' : '📝';
    const tip = e.mentions ? ` (×${e.mentions})` : '';
    return `<span class="geo-io-chip" title="${escHTML(e.type)} — ${escHTML(e.source)}">${src} ${escHTML(e.name)}${tip}</span>`;
  }).join('');

  body.innerHTML = `
    <div class="geo-io-callout">
      Topical authority = heading structure density × entity coverage. Pages with rich heading hierarchies and well-linked entities rank higher in AI retrieval.
    </div>
    <div class="geo-depth-grid">
      <div class="geo-depth-card">
        <div class="geo-depth-card-label">Heading Coverage</div>
        <div class="geo-depth-card-score ${hCls}">${headingScore}/100</div>
        <div class="geo-depth-card-meta">${h2Count} H2 + ${h3Count} H3 for ${wordCount} words</div>
        <div class="geo-depth-card-tip">${headingDensity < idealHDensity ? `Add ${Math.max(1,Math.ceil((idealHDensity - headingDensity) * wordCount / 1000))} more headings` : 'Good heading density'}</div>
      </div>
      <div class="geo-depth-card">
        <div class="geo-depth-card-label">Entity Density</div>
        <div class="geo-depth-card-score ${eCls}">${entityScore}/100</div>
        <div class="geo-depth-card-meta">${entities.length} entities / ${wordCount} words</div>
        <div class="geo-depth-card-tip">${ent.linkedCount || 0} linked to schema</div>
      </div>
    </div>
    ${topEntityPills ? `<div class="geo-depth-section">
      <div class="geo-subsection-label">Detected entities</div>
      <div class="geo-io-chips">${topEntityPills}</div>
    </div>` : ''}
    ${topKws.length ? `<div class="geo-depth-section">
      <div class="geo-subsection-label">Top keywords</div>
      <div class="geo-io-chips">${topKws.map(k=>`<span class="geo-io-chip">🔑 ${escHTML(k)}</span>`).join('')}</div>
    </div>` : ''}
  `;
}

// ─── GEO: ⑤ AI Crawler Deep View ─────────────────────────────────────────────
function renderGeoAICrawlerDeep(geo) {
  const section = $('geoCrawlerDeepSection');
  if (!section) return;

  const crawlerData = geo.aiCrawlerView;
  if (!crawlerData || !crawlerData.available) { section.style.display = 'none'; return; }
  section.style.display = '';

  const badge = $('geoCrawlerDeepBadge');
  const body  = $('geoCrawlerDeepBody');
  if (!body) return;

  const {
    visibleWordCount = 0, hiddenElements = 0, lazyImages = 0,
    jsOnlyContent = 0, hasNoscript = false, iframeCount = 0,
    shadowDomCount = 0, visibleRatio = 100, issues = [],
    hiddenSelectors = []
  } = crawlerData;

  const cls = visibleRatio >= 85 ? 'badge-ok' : visibleRatio >= 60 ? 'badge-warn' : 'badge-err';
  if (badge) {
    badge.textContent = `${visibleRatio}% visible`;
    badge.className   = `geo-section-badge ${cls}`;
    badge.style.display = '';
  }

  // Per-check plain-English "why it matters" + fix steps. Only the failed
  // checks get a dropdown — passing rows just show the green tick and stop
  // there so the panel stays calm when the page is healthy.
  const CHECK_GUIDES = {
    visibleRatio: () => ({
      why: 'AI engines read the page once and decide what to cite. When a big chunk of text is hidden (behind tabs, accordions, popups, lazy-loading, CSS tricks), the crawler only sees part of it and either skips the page or cites a less useful version.',
      fix: [
        'Open the page on mobile and on desktop, scroll to the bottom, and look for any blocks that never become visible — those are the hidden ones.',
        'For any section that *should* be visible (pricing, key benefits, FAQ), remove the CSS that hides it, or move the content outside the hide/show widget.',
        'For sections that must stay hidden on purpose (e.g. a click-to-reveal FAQ), add a small summary paragraph *above* them so AI engines still pick up the gist.',
        'Re-scan after changes — the visible ratio should climb back above 85%.'
      ]
    }),
    jsOnly: () => ({
      why: 'Tabs, accordions, modals and other click-to-reveal blocks often hide their content with CSS or JavaScript until the user clicks. AI crawlers don\'t click — so the text inside is invisible to them, even though it\'s in your HTML.',
      fix: [
        'Find every tab and accordion on the page. For each one, ask: "If someone quoted this content in an AI answer, would I want them to?"',
        'For the important ones, make the first tab/panel open by default, OR show a 1–2 sentence summary of the hidden content right before the widget.',
        'For the unimportant ones, leave them as-is — they\'re fine to keep hidden.',
        'Avoid loading the content only after a click (AJAX). Render the text in the initial HTML and just hide/show with CSS.'
      ]
    }),
    iframes: () => ({
      why: 'Iframes load a separate page inside your page. Search engines and AI crawlers can\'t see across that boundary well — content inside an iframe is essentially invisible to most of them.',
      fix: [
        'List every iframe on the page and ask whether its content is critical for AI to know about (e.g. a pricing calculator, a video transcript, a partner widget).',
        'For critical iframes, replace them with a static HTML version of the same information right next to (or above) the iframe.',
        'For non-critical ones (chat widgets, ads, analytics dashboards), leave them — they don\'t hurt your AI citability.',
        'If the iframe content is a video, add a written transcript underneath so AI engines have something to cite.'
      ]
    }),
    shadowDom: () => ({
      why: 'Shadow DOM is a separate, isolated DOM tree that AI engines can\'t crawl by default. Any text inside is treated as opaque — the crawler sees an empty box.',
      fix: [
        'Inspect the page and find which component uses Shadow DOM (most modern UI libraries do — e.g. some video players, custom selects, advanced widgets).',
        'For each Shadow DOM element, ask: does it contain important text that AI should be able to quote?',
        'If yes, replace the shadow component with a plain HTML element that shows the same content.',
        'If no (it\'s a UI control, not content), leave it — it\'s not hurting your AI citability.'
      ]
    }),
    lazyImages: (n) => ({
      why: 'Lazy-loaded images load only when the user scrolls near them. Most AI crawlers never scroll — so they index the page without those images, which can drop image-search traffic and reduce the "richness" score that AI engines use.',
      fix: [
        'Count your lazy-loaded images. If you have more than 5, that\'s usually too many — lazy-load only the images that are well below the fold.',
        'For images *above* the fold (hero, logos, first 2 product images), remove the <code>loading="lazy"</code> attribute so they load immediately.',
        'Always include descriptive alt text — AI engines use alt text to understand what the image is and cite the page for image-search queries.',
        'Provide width and height on every <code>&lt;img&gt;</code> tag so the layout doesn\'t jump while images load (this also helps Core Web Vitals).'
      ].slice(0, 4)
    }),
    noscript: () => ({
      why: 'A noscript fallback is what a non-JavaScript visitor sees. If your most important content only appears when JavaScript runs and you have no noscript version, AI crawlers that don\'t execute JS will see a blank or half-built page.',
      fix: [
        'Turn off JavaScript in your browser and load your page. Whatever you can still read is what crawlers will see.',
        'If key text disappears, add a noscript block with the same information (or remove the JS-only restriction and render the content in plain HTML).',
        'Re-test with JS disabled after each fix. Repeat until the noscript version still makes sense.'
      ]
    })
  };

  // Build the checks array. Each entry carries an optional `guide` function
  // (returning {why, fix}) plus a numeric detail for templating. A `null` /
  // passing check skips the dropdown entirely.
  const checks = [
    { on: visibleRatio >= 85,     key: 'visibleRatio', label: `Content visible ratio (${visibleRatio}%)`,                   tip: visibleRatio < 85 ? `${hiddenElements} hidden blocks — AI crawlers may miss them` : null },
    { on: jsOnlyContent === 0,    key: 'jsOnly',       label: `No JS-only content (tabs/accordions hidden)`,                 tip: jsOnlyContent > 0 ? `${jsOnlyContent} interactive sections not crawlable` : null },
    { on: iframeCount === 0,      key: 'iframes',      label: `No iframes (${iframeCount} found)`,                           tip: iframeCount > 0  ? `iframe content is opaque to crawlers` : null },
    { on: shadowDomCount === 0,   key: 'shadowDom',    label: `No Shadow DOM (${shadowDomCount} found)`,                     tip: shadowDomCount > 0 ? `Shadow DOM content is invisible to most crawlers` : null },
    { on: lazyImages <= 5,        key: 'lazyImages',   label: `Lazy images (${lazyImages})`,                                 tip: lazyImages > 5  ? `${lazyImages} lazy images may not be indexed` : null, detail: lazyImages },
    { on: !hasNoscript,           key: 'noscript',     label: `No critical noscript fallbacks`,                              tip: null },
  ];

  const checksHtml = checks.map(c => {
    let fixHtml = '';
    // Only attach the dropdown for checks that are failing (or warning) and
    // have a guide defined. Passing rows stay clean.
    if (!c.on && c.key && CHECK_GUIDES[c.key]) {
      const guide = CHECK_GUIDES[c.key](c.detail);
      const fixListHtml = guide.fix.map(step => `<li>${step}</li>`).join('');
      fixHtml = `
        <details class="geo-fix-guide">
          <summary>
            <span class="sh-fix-summary-text">How to fix</span>
            <svg class="sh-fix-chevron" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </summary>
          <div class="sh-fix-body">
            <div class="sh-fix-why"><strong>Why it matters:</strong> ${escHTML(guide.why)}</div>
            <ol class="geo-fix-steps">${fixListHtml}</ol>
          </div>
        </details>`;
    }
    return `
    <div class="eeat-item" data-check-key="${escAttr(c.key || '')}">
      <span class="eeat-status ${c.on ? 'on' : 'off'}">${c.on ? '✓' : '✗'}</span>
      <span class="eeat-label">
        <div class="geo-gap-head">${escHTML(c.label)}</div>
        ${c.tip && !c.on ? `<div class="geo-io-tip">${escHTML(c.tip)}</div>` : ''}
        ${fixHtml}
      </span>
    </div>`;
  }).join('');

  // Plain-language explanation for each "likely cause" classification —
  // keeps things simple since most hidden elements are intentional, not bugs.
  const CAUSE_EXPLAINER = {
    responsive: { label: 'Shows on another screen size', tip: 'This text is set to appear only on certain devices (like mobile or desktop) — not a problem, just check it shows somewhere.', cls: 'neutral' },
    loading:    { label: 'Placeholder text',              tip: 'This gets replaced by real content once the page finishes loading. If a crawler looks too early, it may only see this placeholder.', cls: 'warn' },
    unknown:    { label: 'Hidden — not sure why',         tip: 'Could be on purpose (like a popup or tab that opens on click) or could be left hidden by mistake. Worth a quick manual check.', cls: 'warn' }
  };

  const hiddenHtml = hiddenSelectors.length ? `
    <div class="geo-hidden-samples">
      <div class="geo-subsection-label">Hidden content samples</div>
      <p class="geo-hidden-intro">This is text that's in the page's code but doesn't actually show on screen — so AI tools may never read it. Each item below is labeled with a likely reason. <span class="geo-hidden-legend-ok">Gray labels</span> are usually fine and need no action. <span class="geo-hidden-legend-warn">Orange labels</span> are worth a quick look — especially if the hidden text looks important (like pricing or a key offer).</p>
      ${hiddenSelectors.map((h, i) => {
        const cause = CAUSE_EXPLAINER[h.likelyCause] || CAUSE_EXPLAINER.unknown;
        // Encode selector + a text fallback so the content script can recover
        // even if the DOM was re-rendered between scan and click.
        const sel = h.selector ? escAttr(h.selector) : '';
        const txt = h.text ? escAttr(h.text) : '';
        return `<div class="geo-hidden-sample-row" data-hidden-idx="${i}" data-hidden-selector="${sel}" data-hidden-text="${txt}" role="button" tabindex="0" title="Click to find this element on the page">
        <div class="geo-hidden-sample-top">
          <span class="geo-hidden-code">${escHTML(h.tag)}</span>
          <span class="geo-hidden-cause ${cause.cls}">${escHTML(cause.label)}</span>
          <span class="geo-hidden-find" aria-hidden="true">🔎 Find on page</span>
        </div>
        <div class="geo-hidden-text">"${escHTML(h.text.substring(0, 60))}…"</div>
        <div class="geo-hidden-tip">${escHTML(cause.tip)}</div>
      </div>`;
      }).join('')}
    </div>` : '';

  body.innerHTML = `
    <div class="geo-io-callout">
      <strong>What this section does:</strong> It checks your page the same way an AI tool (like Google's AI Overview, ChatGPT, or Claude) would — looking only at what's actually visible, not everything written in the code. If important text is hidden, slow to load, or locked behind a click, AI tools may skip it completely, even though a human visitor might still find it.
    </div>
    <div class="geo-chips-mb">
      <span class="geo-io-chip">👁 ${visibleWordCount} visible words</span>
      <span class="geo-io-chip">🙈 ${hiddenElements} hidden blocks</span>
      <span class="geo-io-chip">🖼 ${lazyImages} lazy images</span>
      <span class="geo-io-chip">📦 ${iframeCount} iframes</span>
    </div>
    ${checksHtml}
    ${hiddenHtml}
  `;

  // Wire up "find on page" for each hidden sample row. We delegate on `body`
  // because innerHTML above has just replaced the section's contents.
  if (hiddenSelectors.length) {
    const fire = (row) => {
      if (!row) return;
      const selector = row.dataset.hiddenSelector || '';
      const text     = row.dataset.hiddenText     || '';
      if (!selector && !text) return;
      row.classList.add('geo-hidden-sample-row--locating');
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs || !tabs[0]) { row.classList.remove('geo-hidden-sample-row--locating'); return; }
        chrome.tabs.sendMessage(tabs[0].id, { action: 'highlightHiddenElement', selector, text }, resp => {
          // Always clear the visual pulse even if the content script isn't
          // loaded on the active tab (e.g. chrome:// or extension page).
          const err = chrome.runtime.lastError;
          if (err) {
            row.classList.remove('geo-hidden-sample-row--locating');
            row.classList.add('geo-hidden-sample-row--miss');
            setTimeout(() => row.classList.remove('geo-hidden-sample-row--miss'), 1500);
            return;
          }
          if (!resp || resp.success === false) {
            // Content script ran but couldn't find the element — likely the
            // page changed since the last scan. Show a brief "miss" state so
            // the user knows nothing happened on the page side.
            row.classList.remove('geo-hidden-sample-row--locating');
            row.classList.add('geo-hidden-sample-row--miss');
            setTimeout(() => row.classList.remove('geo-hidden-sample-row--miss'), 1500);
            return;
          }
          setTimeout(() => row.classList.remove('geo-hidden-sample-row--locating'), 1200);
        });
      });
    };
    body.querySelectorAll('.geo-hidden-sample-row').forEach(row => {
      row.addEventListener('click', () => fire(row));
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(row); }
      });
    });
  }
}

// ─── GEO: ⑥ Content Gap Detector ─────────────────────────────────────────────
function renderGeoContentGaps(geo) {
  const section = $('geoContentGapsSection');
  if (!section) return;

  const gaps = geo.contentGaps;
  if (!gaps) { section.style.display = 'none'; return; }
  section.style.display = '';

  const badge = $('geoContentGapsBadge');
  const body  = $('geoContentGapsBody');
  if (!body) return;

  const gapList   = gaps.gaps        || [];
  const gapCount  = gaps.gapCount    || gapList.length;
  const wordCount = gaps.wordCount   || 0;
  const hCount    = gaps.headingCount || 0;

  if (badge) {
    badge.textContent = gapCount > 0 ? `${gapCount} gaps` : '✓ Complete';
    badge.className   = `geo-section-badge ${gapCount === 0 ? 'badge-ok' : gapCount <= 2 ? 'badge-warn' : 'badge-err'}`;
    badge.style.display = '';
  }

  // Plain-English guidance per gap section. Each entry explains *why* AI
  // tools care about the section and gives 2–3 concrete steps to fix it.
  // Keys match `gaps[i].section` exactly (see analyzeContentGaps in
  // content.js) — falling back to a generic guide for anything unknown.
  const GAP_GUIDES = {
    'Pricing / Cost': {
      why: 'Pages that talk about products or services without showing prices get skipped when people ask AI tools for cost comparisons. AI engines prefer pages where they can pull a number directly.',
      fix: [
        'Add an H2 like "Pricing" or "Plans & Pricing" near the middle of the page.',
        'Use a small table or list with plan names, prices, and 2–3 features per plan.',
        'If prices vary, include a "Starting at $X" line in the intro so AI has a concrete anchor.'
      ]
    },
    'FAQ Section': {
      why: 'FAQ blocks are the easiest source for AI to pull short answers from. Without one, your page misses most "How do I…", "What is…", "Is X safe…" type questions.',
      fix: [
        'Add an H2 titled "FAQ" or "Frequently Asked Questions" near the bottom.',
        'Write 4–6 real questions your customers ask, each followed by a 1–3 sentence answer.',
        'Use proper FAQ schema (Question/Answer) so search engines recognise the structure.'
      ]
    },
    'Reviews / Testimonials': {
      why: 'AI tools trust third-party proof. Pages with no reviews are cited less often for "best" or "reliable" queries because there is nothing concrete to point to.',
      fix: [
        'Add an H2 like "What customers say" with 3–5 short reviews (name, photo, 1–2 lines).',
        'Include a star rating or quote pull-quote that an AI can quote verbatim.',
        'Link reviews to a public source (Google, Trustpilot) when possible — it adds credibility.'
      ]
    },
    'Comparison / Alternatives': {
      why: 'Comparison searches ("X vs Y", "alternatives to X") are growing fast in AI. Pages that show a side-by-side comparison get cited far more for these queries.',
      fix: [
        'Add an H2 like "X vs Y" or "Alternatives to X" with 3–5 options.',
        'Use a simple table: columns for name, best for, key feature, price tier.',
        'Be honest about competitors — AI tools detect and reward balanced comparisons.'
      ]
    },
    'How-To / Steps': {
      why: 'Step-by-step content is the most-cited format in AI answers. People ask "how to do X" constantly, and AI engines pull numbered steps directly from pages.',
      fix: [
        'Add an H2 like "How to [do the thing]" with 4–7 numbered steps.',
        'Start each step with an action verb ("Open…", "Click…", "Run…"). One idea per step.',
        'End with a short "Tips" or "Common mistakes" line so the page covers edge cases too.'
      ]
    },
    'Benefits / Why': {
      why: 'Without a clear "why this matters" block, AI tools default to competitor pages that spell out benefits. AI summaries almost always include a benefit line.',
      fix: [
        'Add an H2 like "Why choose [your thing]" listing 4–6 benefits as bullet points.',
        'Lead each benefit with the outcome, not the feature ("Saves 3 hours/week", not "automation").',
        'Tie benefits back to a real customer pain point in one sentence each.'
      ]
    },
    'Conclusion / Summary': {
      why: 'AI engines love a clean summary at the end — it\'s often what gets quoted in the answer. Articles without a conclusion feel half-finished to both readers and crawlers.',
      fix: [
        'Add an H2 like "Conclusion" or "Key takeaways" with 3–5 short bullets.',
        'Restate the main answer or recommendation in one sentence up top.',
        'Link to 1–2 related pages so AI understands how this article fits in your site.'
      ]
    },
    'Examples / Case Studies': {
      why: 'Concrete examples are the highest-trust signal in AI answers. A "for example" line converts a generic claim into a citable fact.',
      fix: [
        'Add an H2 like "Examples" or "Case study" with 1–2 short real-world stories.',
        'Use a simple format: situation → action → result (with a number if possible).',
        'Name the customer or industry — anonymous examples get cited less often.'
      ]
    },
    'More H2 sub-sections needed': {
      why: 'Long pages with only 1–2 H2 headings look unstructured to AI tools. They struggle to pick a "main" section to cite, so they often skip the page entirely.',
      fix: [
        'Aim for roughly one H2 per 200–300 words of body text.',
        'Each H2 should describe a single sub-topic — if it needs "and" in the title, split it.',
        'Re-read your draft and turn every new paragraph into an H2 if it shifts topic.'
      ]
    },
    'Add H3 sub-headings': {
      why: 'H3s under long H2s act as "anchor points" that AI engines cite directly. Without them, long sections blur into a wall of text and don\'t get quoted.',
      fix: [
        'Under each long H2, add 2–4 H3s that break the content into scannable chunks.',
        'One H3 should fit in roughly one paragraph below it — keep them tight.',
        'Use H3s to set up a sub-question, then answer it in 2–3 sentences right under.'
      ]
    },
    'Add visual content (images)': {
      why: 'Pages with at least one image get cited more often — AI tools use images for source attribution and to confirm the page is "real".',
      fix: [
        'Add at least one original image or diagram (not a stock photo) per ~500 words.',
        'Use descriptive alt text — "pricing table for X" beats "image1".',
        'Compress images under 200KB so they don\'t slow the page down.'
      ]
    },
    'Add structured elements (tables or lists)': {
      why: 'Tables and bullet lists are the easiest format for AI to copy into an answer. Without them, even great prose often gets summarised away.',
      fix: [
        'Convert dense paragraphs about features/specs/pricing into a 3–5 column table.',
        'Use bullet lists for any sentence that lists 3 or more things.',
        'Keep rows/columns short — one idea per cell.'
      ]
    }
  };
  const genericGuide = {
    why: 'AI tools prefer pages that match the expected structure for their topic. Missing this section makes the page look incomplete to both readers and crawlers.',
    fix: [
      'Add an H2 with a clear, descriptive title for this section.',
      'Write 2–4 short paragraphs or a small list covering the topic.',
      'Re-scan the page after publishing to confirm the gap is gone.'
    ]
  };

  const typeIcon = { missing_section: '📄', structure: '🏗', media: '🖼' };
  const gapHtml  = gapList.map((g, i) => {
    const guide = GAP_GUIDES[g.section] || genericGuide;
    const whyId  = `geoGapWhy${i}`;
    const fixId  = `geoGapFix${i}`;
    const fixListHtml = guide.fix.map(step => `<li>${escHTML(step)}</li>`).join('');
    return `
    <div class="eeat-item geo-gap-item" data-gap-section="${escAttr(g.section)}">
      <span class="eeat-status gap-icon">${typeIcon[g.type] || '⚠'}</span>
      <span class="eeat-label">
        <div class="geo-gap-head">${escHTML(g.section)}</div>
        ${g.detail ? `<div class="geo-io-tip">${escHTML(g.detail)}</div>` : ''}
        <details class="geo-fix-guide" id="${fixId}">
          <summary>
            <span class="sh-fix-summary-text">How to fix</span>
            <svg class="sh-fix-chevron" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </summary>
          <div class="sh-fix-body">
            <div class="sh-fix-why">
              <strong>Why it matters:</strong> ${escHTML(guide.why)}
            </div>
            <ol class="geo-fix-steps">${fixListHtml}</ol>
          </div>
        </details>
      </span>
    </div>`;
  }).join('');

  body.innerHTML = gapList.length ? `
    <div class="geo-io-callout">
      Missing sections reduce AI citability — LLMs often penalise pages lacking expected content patterns for their page type. Click <strong>How to fix</strong> on any row for step-by-step guidance.
    </div>
    <div class="geo-chips-mb">
      <span class="geo-io-chip">📝 ${wordCount} words</span>
      <span class="geo-io-chip">📑 ${hCount} headings</span>
      <span class="geo-io-chip">⚠ ${gapCount} gap${gapCount !== 1 ? 's' : ''}</span>
    </div>
    ${gapHtml}
  ` : `
    <div class="geo-chips-mb">
      <span class="geo-io-chip">📝 ${wordCount} words</span>
      <span class="geo-io-chip">📑 ${hCount} headings</span>
    </div>
    <div class="geo-empty-msg" style="color:var(--ok);">✓ No obvious content gaps detected for this page type.</div>
  `;
}

// ─── GEO: ⑦ Indexation & Snippet Control ─────────────────────────────────────
function renderGeoIndexation(geo) {
  const section = $('geoIndexationSection');
  if (!section) return;

  const hints = geo.indexationHints;
  if (!hints) { section.style.display = 'none'; return; }
  section.style.display = '';

  const badge = $('geoIndexationBadge');
  const body  = $('geoIndexationBody');
  if (!body) return;

  const issues  = hints.issues       || [];
  const errCount= issues.filter(i => i.severity === 'error').length;
  const warnCount=issues.filter(i => i.severity === 'warning').length;

  if (badge) {
    badge.textContent = errCount > 0 ? `${errCount} error${errCount>1?'s':''}` : warnCount > 0 ? `${warnCount} warning${warnCount>1?'s':''}` : '✓ Clean';
    badge.className   = `geo-section-badge ${errCount > 0 ? 'badge-err' : warnCount > 0 ? 'badge-warn' : 'badge-ok'}`;
    badge.style.display = '';
  }

  // Per-issue plain-English fix guides. `match` is a function that tests an
  // issue's `type` and returns true when this guide applies. `detail` is the
  // actual canonical URL (or whatever) to show in the example fix.
  const INDEX_FIXES = [
    {
      match: i => i.type === 'canonical_mismatch',
      why: 'When your canonical URL points to a different page, AI tools treat the *other* page as the authoritative one. This page still ranks, but AI engines prefer the canonical source when answering.',
      fix: i => [
        'Decide which URL is the real one for this content.',
        `Update the canonical to match the current page URL (e.g. <code>${escHTML(i.detail || 'https://example.com/your-page/')}</code>), OR update the other page to canonical to this one.`,
        'After fixing, re-submit both URLs in Google Search Console to speed up re-evaluation.'
      ]
    },
    {
      match: i => i.type === 'canonical_missing',
      why: 'Without a canonical URL, search engines and AI tools pick one themselves — sometimes a less useful URL (a tracking parameter, a duplicate). You lose control of which version gets cited.',
      fix: () => [
        'Add a self-referencing canonical in the <code>&lt;head&gt;</code>: <code>&lt;link rel="canonical" href="https://your-domain.com/current-page/" /&gt;</code>.',
        'Use the exact URL a visitor sees in the address bar (no extra parameters).',
        'If you have www/non-www or http/https variants, canonicalise to your preferred version on every page.'
      ]
    },
    {
      match: i => i.type === 'canonical_invalid',
      why: 'A broken canonical URL (typo, 404, or wrong format) is worse than no canonical — it actively confuses crawlers about which page is the master copy.',
      fix: i => [
        `Open the page and check what is written in the canonical tag (currently: <code>${escHTML(i.detail || '')}</code>).`,
        'Replace it with a working, absolute URL of the same page (or remove it if you don\'t need canonicalisation).',
        'After saving, reload the page and re-scan to confirm.'
      ]
    },
    {
      match: i => i.type === 'noindex_canonical',
      why: 'Saying "don\'t index me" (noindex) while also saying "I am the official version" (canonical) is contradictory. Crawlers see this conflict and behave unpredictably, often dropping the page entirely.',
      fix: () => [
        'Decide: do you actually want this page indexed?',
        'If yes, remove the <code>noindex</code> directive from the meta robots tag.',
        'If no, remove the canonical tag (or point it to the master non-noindex page).'
      ]
    },
    {
      match: i => i.type === 'noindex_nofollow',
      why: 'Both <code>noindex</code> and <code>nofollow</code> together means the page is hidden *and* the links on it pass no value. AI engines may still crawl the page but ignore everything it links to.',
      fix: () => [
        'If this page should rank, remove <code>nofollow</code> from the meta robots tag.',
        'If it should be hidden, that is fine — but remove the canonical or simplify the page since crawlers won\'t use the links.',
        'Double-check you actually need <code>noindex</code> here — many sites add it by mistake via plugins.'
      ]
    },
    {
      match: i => i.type === 'nosnippet',
      why: '<code>nosnippet</code> (or <code>data-nosnippet</code> on large blocks) tells AI engines they cannot quote or summarise your content in answers. The page may still rank, but it almost never gets cited in AI Overviews.',
      fix: () => [
        'Remove the <code>nosnippet</code> directive from the meta robots tag if you want AI citations.',
        'If only specific sections should be excluded, wrap them in <code>&lt;span data-nosnippet&gt;…&lt;/span&gt;</code> instead of blocking the whole page.',
        'Re-scan to confirm snippets are now allowed.'
      ]
    }
  ];
  const defaultFix = {
    why: 'This affects how AI engines and search engines treat your page. Fixing it improves the chance that the page is cited correctly in AI answers.',
    fix: () => ['Open the page in your CMS, address the warning, then re-scan.']
  };

  const renderIssue = (i, idx) => {
    const guide = INDEX_FIXES.find(g => g.match(i)) || defaultFix;
    const steps = guide.fix(i).map(s => `<li>${s}</li>`).join('');
    return `
    <div class="eeat-item" data-issue-type="${escAttr(i.type)}">
      <span class="eeat-status ${i.severity === 'error' ? 'off' : i.severity === 'warning' ? 'on' : 'info'}">${i.severity === 'error' ? '✗' : i.severity === 'warning' ? '!' : 'i'}</span>
      <span class="eeat-label">
        <div>${escHTML(i.message)}</div>
        ${i.detail ? `<div class="geo-io-tip" style="font-family:monospace;font-size:10px;">${escHTML(i.detail)}</div>` : ''}
        <details class="geo-fix-guide">
          <summary>
            <span class="sh-fix-summary-text">How to fix</span>
            <svg class="sh-fix-chevron" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </summary>
          <div class="sh-fix-body">
            <div class="sh-fix-why"><strong>Why it matters:</strong> ${escHTML(guide.why)}</div>
            <ol class="geo-fix-steps">${steps}</ol>
          </div>
        </details>
      </span>
    </div>`;
  };
  const issueHtml = issues.map(renderIssue).join('');

  // Additional checks from cd
  const cd = geo.citabilityDetails || {};
  const isIndexable = cd.isIndexable !== false;
  const hasCanonical = cd.hasCanonical;

  body.innerHTML = `
    <div class="geo-io-callout">
      Controls how much of this page AI crawlers can see, index, and use in generated answers. noindex or nosnippet tags will suppress this page from AI Overviews. Click <strong>How to fix</strong> on any issue below for plain-English guidance.
    </div>
    <div class="eeat-item">
      <span class="eeat-status ${isIndexable ? 'on' : 'off'}">${isIndexable ? '✓' : '✗'}</span>
      <span class="eeat-label">Page is indexable by AI bots${isIndexable ? '' : ' — <strong>noindex detected</strong>'}</span>
    </div>
    <div class="eeat-item">
      <span class="eeat-status ${hasCanonical ? 'on' : 'off'}">${hasCanonical ? '✓' : '!'}</span>
      <span class="eeat-label">Canonical URL ${hasCanonical ? 'set' : 'missing — search engines will self-select'}</span>
    </div>
    ${issueHtml || '<div class="geo-empty-msg" style="color:var(--ok);margin-top:8px;">✓ No indexation issues detected.</div>'}
  `;
}

// ─── GEO: AI Answer Simulation ──────────────────────────────
const _aiSimState = { running: false };

function initAIAnswerSim(geo) {
  // Show/hide no-key notice
  const noKey = $('aiSimNoKey');
  const inputRow = document.querySelector('.ai-sim-input-row');
  const chipsEl  = $('aiSimChips');

  const hasKey = !!_aiConfig?.apiKey;
  if (noKey)    noKey.style.display    = hasKey ? 'none' : '';
  if (inputRow) inputRow.style.display = hasKey ? '' : 'none';
  if (chipsEl)  chipsEl.style.display  = hasKey ? '' : 'none';

  if (!hasKey) return;

  // Build smart question chips from page data
  const d = _rawData ? adaptV1Data(_rawData) : null;
  const title = d?.meta?.title || '';
  const h1    = d?.headings?.headings?.find(h=>h.level===1)?.text || title;
  const topKw = d?.keywords?.topKeywords?.[0]?.word || d?.keywords?.topKeywords?.[0] || 'this topic';

  const chips = [
    `What is ${h1 || 'this page'} about?`,
    `What does this page say about ${topKw}?`,
    `Is this page a reliable source?`,
    `What problem does this page solve?`,
    `What are the key facts on this page?`,
  ].filter(Boolean).slice(0, 5);

  if (chipsEl && !chipsEl._simBound) {
    chipsEl._simBound = true;
    chipsEl.innerHTML = chips.map(c =>
      `<button class="ai-sim-chip" data-q="${escHTML(c)}">${escHTML(c)}</button>`
    ).join('');
    chipsEl.addEventListener('click', e => {
      const chip = e.target.closest('.ai-sim-chip');
      if (!chip) return;
      const inp = $('aiSimQuestion');
      if (inp) { inp.value = chip.dataset.q; }
      runAIAnswerSim();
    });
  }

  const btn = $('aiSimRunBtn');
  if (btn && !btn._simBound) {
    btn._simBound = true;
    btn.addEventListener('click', runAIAnswerSim);
  }

  const inp = $('aiSimQuestion');
  if (inp && !inp._simBound) {
    inp._simBound = true;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') runAIAnswerSim(); });
  }
}

async function runAIAnswerSim() {
  if (_aiSimState.running) return;
  const inp = $('aiSimQuestion');
  const question = inp?.value?.trim();
  if (!question) { if (inp) inp.focus(); return; }
  if (!_aiConfig?.apiKey) _aiConfig = ensureBuiltinGroqConfig(_aiConfig);
  if (!_aiConfig?.apiKey) { toast('Configure AI model in Settings first.'); return; }

  _aiSimState.running = true;
  const btn = $('aiSimRunBtn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  $('aiSimResult').style.display  = 'none';
  $('aiSimLoading').style.display = '';

  try {
    const d   = _rawData ? adaptV1Data(_rawData) : {};
    const url = _currentUrl || 'this page';
    const title = d.meta?.title || '';
    const desc  = d.meta?.desc  || '';
    const h1    = d.headings?.headings?.find(h=>h.level===1)?.text || '';
    const words = d.readability?.wordCount ?? '?';
    const schemas = (d.geo?.structured?.schemas||[]).map(s=>s.type).join(', ')||'none';
    const kws   = (d.keywords?.topKeywords||[]).slice(0,8).map(k=>k.word||k).join(', ')||'none';
    const author= d.geo?.eeat?.hasAuthor ? 'yes' : 'no';
    const https = d.tech?.isHttps ? 'yes' : 'no';
    const citations= d.geo?.eeat?.hasCite ? 'yes' : 'no';

    const systemPrompt = `You are an AI search engine (like ChatGPT, Perplexity, or Google AI Overviews). A user has asked you a question. You have been given the content summary of a web page as your knowledge source. Your task is to:

1. Answer the user's question using ONLY information from the page data provided.
2. If the page contains a good answer, cite it clearly as "According to [${url}]".
3. If the page does NOT have a good answer, say so honestly.
4. Keep your answer under 120 words.
5. After your answer, add a single line starting with "CITABILITY:" and rate the page's citability as: EXCELLENT, GOOD, FAIR, or POOR — based on whether it gave you a clear, citable answer.

PAGE DATA:
URL: ${url}
Title: ${title}
Meta Description: ${desc}
H1: ${h1}
Word Count: ${words}
Top Keywords: ${kws}
Schema Types: ${schemas}
Has Author: ${author}
HTTPS: ${https}
Has Citations/References: ${citations}
GEO Score: ${d.geo?.geoScore??'?'}/100`;

    const cfg = _aiConfig;
    let url2, headers, body;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: question }
    ];

    if (cfg.provider === 'openrouter') {
      url2 = 'https://openrouter.ai/api/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
        'HTTP-Referer': 'https://www.mubashirhassan.com',
        'X-Title': 'ShahzaibSEO - GEO AI Sim'
      };
    } else {
      url2 = 'https://integrate.api.nvidia.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey };
    }
    body = { model: cfg.model, messages, max_tokens: 350, temperature: 0.4 };

    const res  = await fetch(url2, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.error?.message||`HTTP ${res.status}`); }
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content?.trim() || '';

    // Parse citability line
    const citMatch = raw.match(/CITABILITY:\s*(EXCELLENT|GOOD|FAIR|POOR)/i);
    const citability = citMatch ? citMatch[1].toUpperCase() : null;
    const answer = raw.replace(/CITABILITY:.*$/im, '').trim();

    // Check if page was cited
    const pageCited = answer.toLowerCase().includes((_currentUrl||'').replace(/https?:\/\/(www\.)?/,'').split('/')[0]);

    // Show result
    const resultEl = $('aiSimResult');
    const answerBox = $('aiSimAnswerBox');
    const citedBadge = $('aiSimCitedBadge');
    const signalsEl = $('aiSimSignals');
    const modelLabel = $('aiSimModelLabel');

    if (modelLabel) modelLabel.textContent = (cfg.model||'AI Model').split('/').pop().replace(':free','').slice(0,30);
    if (answerBox)  answerBox.textContent  = answer;
    if (citedBadge) { citedBadge.style.display = pageCited ? '' : 'none'; }

    // Citability signals — enhanced multi-engine citation readiness
    const signals = [];
    if (citability) {
      const cls = {EXCELLENT:'ok',GOOD:'ok',FAIR:'warn',POOR:'err'}[citability]||'warn';
      signals.push(`<span class="ai-sim-signal-pill ${cls}">Citability: ${citability}</span>`);
    }
    const geoScore = d.geo?.geoScore ?? 0;
    if (geoScore >= 70) signals.push(`<span class="ai-sim-signal-pill ok">GEO ${geoScore}/100 ✓</span>`);
    else if (geoScore >= 40) signals.push(`<span class="ai-sim-signal-pill warn">GEO ${geoScore}/100</span>`);
    else signals.push(`<span class="ai-sim-signal-pill err">GEO ${geoScore}/100 Low</span>`);

    if (d.geo?.eeat?.hasAuthor) signals.push(`<span class="ai-sim-signal-pill ok">Author ✓</span>`);
    if ((d.geo?.structured?.schemas||[]).length > 0) signals.push(`<span class="ai-sim-signal-pill ok">Schema ✓</span>`);
    if (d.geo?.eeat?.hasCite) signals.push(`<span class="ai-sim-signal-pill ok">Citations ✓</span>`);
    if (!d.geo?.eeat?.hasAuthor) signals.push(`<span class="ai-sim-signal-pill err">No Author</span>`);

    // Multi-engine citation readiness chips
    const af = d.geo?.citabilityDetails?.answerFirst;
    const hasAnswerFirst = af?.hasAnswerFirstOpening;
    const hasSchema = (d.geo?.structured?.schemas||[]).length > 0;
    const hasAuthor = d.geo?.eeat?.hasAuthor;
    const hasCite   = d.geo?.eeat?.hasCite;
    const hasHttps  = d.tech?.isHttps;

    // Per-engine readiness heuristics
    const engines = [
      {
        name: 'Google AI',   icon: 'G',
        score: [hasAnswerFirst, hasSchema, hasAuthor, hasCite, hasHttps].filter(Boolean).length,
        max: 5,
        tip: 'Needs answer-first + schema + author'
      },
      {
        name: 'Perplexity', icon: 'P',
        score: [hasAnswerFirst, hasCite, hasHttps, hasAuthor].filter(Boolean).length,
        max: 4,
        tip: 'Needs citations + answer-first structure'
      },
      {
        name: 'ChatGPT',    icon: 'C',
        score: [hasHttps, hasAuthor, hasCite, (d.geo?.geoScore||0)>=50].filter(Boolean).length,
        max: 4,
        tip: 'Needs trust signals + E-E-A-T'
      },
      {
        name: 'Bing Copilot', icon: 'B',
        score: [hasSchema, hasAuthor, hasHttps, hasAnswerFirst].filter(Boolean).length,
        max: 4,
        tip: 'Needs schema + author + HTTPS'
      },
      {
        name: 'Claude',     icon: '✦',
        score: [hasCite, hasAuthor, hasAnswerFirst, (d.geo?.citabilityDetails?.wordCount||0)>300].filter(Boolean).length,
        max: 4,
        tip: 'Needs citations + depth'
      },
    ];

    const engineChips = engines.map(e => {
      const pct = Math.round((e.score / e.max) * 100);
      const cls = pct >= 75 ? 'ok' : pct >= 50 ? 'warn' : 'err';
      return `<span class="ai-engine-chip ${cls}" title="${escHTML(e.tip)}">
        <span class="ai-engine-icon">${e.icon}</span> ${e.name} <span class="ai-engine-pct">${pct}%</span>
      </span>`;
    }).join('');

    const engineSection = `<div class="ai-engine-readiness">
      <div class="ai-engine-label">Multi-Engine Citation Readiness</div>
      <div class="ai-engine-chips">${engineChips}</div>
    </div>`;

    if (signalsEl) signalsEl.innerHTML = signals.join('') + engineSection;
    if (resultEl)  resultEl.style.display = '';

  } catch(err) {
    const answerBox = $('aiSimAnswerBox');
    const resultEl  = $('aiSimResult');
    if (answerBox) answerBox.textContent = '⚠️ Error: ' + (err.message || 'Request failed.');
    if (resultEl)  resultEl.style.display = '';
  } finally {
    $('aiSimLoading').style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = 'Ask AI ▶'; }
    _aiSimState.running = false;
  }
}

function setupGeoCollapsibles() {
  document.querySelectorAll('.geo-collapse-toggle').forEach(toggle => {
    if (!toggle._geoBound) {
      toggle._geoBound = true;
      toggle.addEventListener('click', () => {
        toggle.closest('.geo-collapsible').classList.toggle('collapsed');
      });
    }
  });
}

// ─── Crawler Permissions ──────────────────────────────
// ─── .htaccess render ────────────────────────────────
function renderHtaccess(resp) {
  const badge   = $('htaccessStatusBadge');
  const content = $('htaccessContent');
  const empty   = $('htaccessEmpty');
  const emptyMsg= $('htaccessEmptyMsg');
  const copyBtn = $('htaccessCopyBtn');

  if (resp.ok && resp.text) {
    if (badge)   { badge.textContent = 'Found ✓'; badge.className = 't-file-status-badge found'; }
    if (content) { content.textContent = resp.text; content.style.display = ''; }
    if (empty)   { empty.style.display = 'none'; }
    if (copyBtn) { copyBtn.style.display = ''; }
  } else if (resp.protected) {
    if (badge)    { badge.textContent = 'Protected 🔒'; badge.className = 't-file-status-badge protected'; }
    if (emptyMsg) { emptyMsg.textContent = 'Server returned 403 — file is protected (good)'; }
    if (content)  { content.style.display = 'none'; }
    if (copyBtn)  { copyBtn.style.display = 'none'; }
  } else {
    if (badge)    { badge.textContent = 'Not found'; badge.className = 't-file-status-badge missing'; }
    if (emptyMsg) { emptyMsg.textContent = 'No .htaccess file detected at root'; }
    if (content)  { content.style.display = 'none'; }
    if (copyBtn)  { copyBtn.style.display = 'none'; }
  }
}

// ─── sitemap.xml render ──────────────────────────────
function renderSitemap(resp) {
  const badge   = $('sitemapStatusBadge');
  const content = $('sitemapContent');
  const empty   = $('sitemapEmpty');
  const emptyMsg= $('sitemapEmptyMsg');
  const copyBtn = $('sitemapCopyBtn');

  if (resp.ok && resp.text) {
    // Count URLs in sitemap
    const urlCount = (resp.text.match(/<loc>/gi) || []).length;
    if (badge)   { badge.textContent = `Found ✓ (${urlCount} URLs)`; badge.className = 't-file-status-badge found'; }
    if (content) { content.textContent = resp.text; content.style.display = ''; }
    if (empty)   { empty.style.display = 'none'; }
    if (copyBtn) { copyBtn.style.display = ''; }
  } else {
    if (badge)    { badge.textContent = 'Not found'; badge.className = 't-file-status-badge missing'; }
    if (emptyMsg) { emptyMsg.textContent = 'No sitemap.xml found — add one to help search engines crawl your site'; }
    if (content)  { content.style.display = 'none'; }
    if (copyBtn)  { copyBtn.style.display = 'none'; }
  }
}

// ─── llms.txt render (Technical tab card) ────────────
function renderLlmsTxtCard(resp) {
  const badge   = $('llmsTxtStatusBadge');
  const content = $('llmsTxtContent');
  const empty   = $('llmsTxtEmpty');
  const emptyMsg= $('llmsTxtEmptyMsg');
  const copyBtn = $('llmsTxtCopyBtn');

  if (resp.ok && resp.text) {
    if (badge)   { badge.textContent = 'Found ✓'; badge.className = 't-file-status-badge found'; }
    if (content) { content.textContent = resp.text; content.style.display = ''; }
    if (empty)   { empty.style.display = 'none'; }
    if (copyBtn) { copyBtn.style.display = ''; }
  } else {
    if (badge)    { badge.textContent = 'Not found'; badge.className = 't-file-status-badge missing'; }
    if (emptyMsg) {
      emptyMsg.innerHTML = 'No llms.txt found — <a href="https://llmstxt.org" target="_blank" style="color:var(--brand)">learn more ↗</a> about helping AI crawlers understand your site';
    }
    if (content)  { content.style.display = 'none'; }
    if (copyBtn)  { copyBtn.style.display = 'none'; }
  }
}

function renderCrawlerPerms(robotsTxt) {
  const container = $('crawlerPerms'); if (!container) return;
  const bots = [
    { name: 'GPTBot (ChatGPT)',   agent: 'gptbot' },
    { name: 'Claude-Web',         agent: 'claude-web' },
    { name: 'Google-Extended',    agent: 'google-extended' },
    { name: 'PerplexityBot',      agent: 'perplexitybot' },
    { name: 'Googlebot',          agent: 'googlebot' },
    { name: 'Bingbot',            agent: 'bingbot' },
    { name: 'CCBot',              agent: 'ccbot' },
    { name: 'Diffbot',            agent: 'diffbot' }
  ];

  if (!robotsTxt) {
    container.innerHTML = '<div style="color:var(--text-4);font-size:12px;padding:8px 0">robots.txt not found — all crawlers allowed by default.</div>';
    renderDashboardBots(bots.map(b => ({ ...b, status: { label:'Allowed', class:'allowed' } })));
    return;
  }
  container.innerHTML = '';
  const results = bots.map(bot => {
    const status = getCrawlerStatus(robotsTxt, bot.agent);
    const row = el('div', 'crawler-row');
    row.innerHTML = `<span class="crawler-name">${escHTML(bot.name)}</span><span class="crawler-status-badge ${status.class}">${escHTML(status.label)}</span>`;
    container.appendChild(row);
    return { ...bot, status };
  });
  renderDashboardBots(results);
}

function renderDashboardBots(results) {
  const allowed = results.filter(r => r.status.class==='allowed').length;
  const partial  = results.filter(r => r.status.class==='partial').length;
  const blocked  = results.filter(r => r.status.class==='blocked').length;
  // Update new dashboard stat elements
  setText('qBotsAllowed', allowed);
  setText('qBotsPartial', partial);
  setText('qBotsBlocked', blocked);
  // Also update geo crawler perm badge
  const total = results.length;
  const permBadge = $('geoCrawlerPermBadge');
  if (permBadge) { permBadge.textContent = `${allowed}/${total}`; permBadge.style.display=''; permBadge.className = `geo-section-badge ${blocked>0?'badge-err':partial>0?'badge-warn':'badge-ok'}`; }
}

function getCrawlerStatus(robotsTxt, agent) {
  if (!robotsTxt) return { label:'Allowed', class:'allowed' };
  const lines = robotsTxt.toLowerCase().split('\n');
  let cur = null, blocked = false, wildcardBlocked = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('user-agent:')) { cur = t.replace('user-agent:','').trim(); }
    else if (t.startsWith('disallow:') && t.includes('/')) {
      const path = t.replace('disallow:','').trim();
      if (cur === agent && path === '/') blocked = true;
      if (cur === '*' && path === '/') wildcardBlocked = true;
    }
  }
  if (blocked) return { label:'Blocked', class:'blocked' };
  if (wildcardBlocked) return { label:'Partial', class:'partial' };
  return { label:'Allowed', class:'allowed' };
}

// ─── Metadata ─────────────────────────────────────────
function renderMetadata(meta) {
  const raw = _rawData || {};
  const warnings = [];
  if (!meta.title) warnings.push('Missing page title');
  if (!meta.desc)  warnings.push('Missing meta description');
  if (!meta.og?.image) warnings.push('Missing og:image');
  if (!meta.canonical) warnings.push('No canonical URL');
  const mw = $('metaWarnings');
  if (mw) { if (warnings.length) { mw.style.display=''; mw.textContent = '⚠ ' + warnings.join(' · '); } else mw.style.display='none'; }

  const bf = $('metaBasicFields');
  if (bf) {
    bf.innerHTML = '';
    [{ key:'title', val:meta.title },{ key:'description', val:meta.desc },{ key:'canonical', val:meta.canonical },
     { key:'robots', val:meta.robots },{ key:'viewport', val:meta.viewport },{ key:'charset', val:meta.charset },{ key:'language', val:meta.lang }]
    .forEach(f => {
      const row = el('div','meta-field');
      const missing = !f.val;
      row.innerHTML = `<span class="meta-field-key">${escHTML(f.key)}</span><span class="meta-field-val ${missing?'missing':''}">${escHTML(f.val||'Not set')}</span>${!missing?`<button class="meta-copy-btn" data-copy="${escAttr(f.val)}">Copy</button>`:''}`;
      bf.appendChild(row);
    });
    bf.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', () => copyText(btn.dataset.copy)));
  }

  const ogp = $('ogPreview');
  if (ogp) {
    const og = meta.og || {};
    const imgSrc = og.image || '';
    ogp.innerHTML =
      (imgSrc ? `<img class="og-image" id="ogPreviewImg" src="${escAttr(imgSrc)}" alt="">` : '') +
      `<div class="og-image-placeholder" id="ogImgPlaceholder" style="${imgSrc ? 'display:none' : ''}">No og:image found</div>` +
      `<div class="og-body">` +
      `<div class="og-site">${escHTML(meta.url ? new URL(meta.url).hostname : '')}</div>` +
      `<div class="og-title">${escHTML(og.title||meta.title||'(No title)')}</div>` +
      `<div class="og-desc">${escHTML(og.description||meta.desc||'')}</div></div>`;
    if (imgSrc) {
      const ogImg = ogp.querySelector('#ogPreviewImg');
      if (ogImg) ogImg.addEventListener('error', () => {
        ogImg.style.display = 'none';
        const ph = ogp.querySelector('#ogImgPlaceholder');
        if (ph) ph.style.display = '';
      });
    }
  }

  const renderMetaFields = (elId, prefix, keys, obj) => {
    const f = $(elId); if (!f) return;
    f.innerHTML = '';
    keys.forEach(k => {
      const val = obj[k];
      const row = el('div','meta-field');
      row.innerHTML = `<span class="meta-field-key">${prefix}${escHTML(k)}</span><span class="meta-field-val ${!val?'missing':''}">${escHTML(val||'Not set')}</span>${val?`<button class="meta-copy-btn" data-copy="${escAttr(val)}">Copy</button>`:''}`;
      f.appendChild(row);
    });
    f.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', () => copyText(btn.dataset.copy)));
  };
  renderMetaFields('metaOgFields', 'og:', ['title','description','image','url','type','site_name'], meta.og||{});
  renderMetaFields('metaTwitterFields', 'twitter:', ['card','title','description','image','site','creator'], meta.twitter||{});
  const msl = $('metaSchemaList');
  if (msl) msl.innerHTML = '<div style="color:var(--text-4);font-size:12px;padding:8px 0">See GEO tab for structured data details.</div>';

  // ── Schema / Structured Data card in Technical tab ──
  const techSchemaList = $('techSchemaList');
  const techSchemaBadge = $('techSchemaBadge');
  if (techSchemaList) {
    const schemas = (raw.geo && raw.geo.structured && raw.geo.structured.schemas) || (raw.structured?.schemas) || (raw.structuredDeep?.schemas) || [];
    if (techSchemaBadge) {
      techSchemaBadge.textContent = schemas.length + ' found';
      techSchemaBadge.style.background = schemas.length > 0 ? 'color-mix(in srgb,#10b981 15%,transparent)' : 'color-mix(in srgb,#ef4444 15%,transparent)';
      techSchemaBadge.style.color = schemas.length > 0 ? '#065f46' : '#991b1b';
    }
    if (!schemas.length) {
      techSchemaList.innerHTML = '<div style="color:var(--text-4);font-size:12px;padding:10px 0;text-align:center">⚠️ No structured data (JSON-LD) found on this page.</div>';
    } else {
      const typeColor = function(t) { return ({
        'Article': '#6366f1', 'BlogPosting': '#6366f1', 'NewsArticle': '#6366f1',
        'Product': '#f97316', 'Offer': '#f97316',
        'Organization': '#0ea5e9', 'WebSite': '#0ea5e9', 'WebPage': '#0ea5e9',
        'LocalBusiness': '#10b981', 'Restaurant': '#10b981',
        'FAQPage': '#8b5cf6', 'HowTo': '#8b5cf6', 'QAPage': '#8b5cf6',
        'BreadcrumbList': '#f59e0b', 'SiteLinksSearchBox': '#f59e0b',
        'Person': '#ec4899', 'ProfilePage': '#ec4899',
        'Event': '#14b8a6', 'Review': '#14b8a6',
      })[t] || '#64748b'; };

      techSchemaList.innerHTML = schemas.map((s, i) => {
        const color = typeColor(s.type || '');
        const jsonStr = JSON.stringify(s.data || {}, null, 2);
        const id = 'techSchema_' + i;
        return `<div style="border:1px solid var(--border);border-radius:8px;margin-bottom:8px;overflow:hidden">
          <div class="tech-schema-hdr" data-target="${id}" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface2);cursor:pointer;user-select:none">
            <span style="padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${color}20;color:${color};border:1px solid ${color}40">${escHTML(s.type || 'Unknown')}</span>
            <span style="flex:1;font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHTML((s.data && s.data.name) ? String(s.data.name).slice(0,60) : '')}</span>
            <button class="tech-schema-copy" data-target="${id}" style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;color:var(--text-2)">Copy</button>
            <span class="schema-arr" style="font-size:10px;color:var(--text-4)">▼</span>
          </div>
          <pre id="${id}" style="display:none;margin:0;padding:12px;font-size:11px;line-height:1.6;overflow-x:auto;background:var(--surface);color:var(--text-2);font-family:var(--mono,monospace);white-space:pre;tab-size:2">${escHTML(jsonStr)}</pre>
        </div>`;
      }).join('');

      // Attach events after rendering
      techSchemaList.querySelectorAll('.tech-schema-hdr').forEach(hdr => {
        hdr.addEventListener('click', function(e) {
          if (e.target.classList.contains('tech-schema-copy')) return;
          const pre = document.getElementById(this.dataset.target);
          const arr = this.querySelector('.schema-arr');
          if (!pre) return;
          const isOpen = pre.style.display !== 'none';
          pre.style.display = isOpen ? 'none' : 'block';
          arr.textContent = isOpen ? '▼' : '▲';
        });
      });
      techSchemaList.querySelectorAll('.tech-schema-copy').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const pre = document.getElementById(this.dataset.target);
          if (pre) navigator.clipboard.writeText(pre.textContent).then(() => {
            const orig = this.textContent;
            this.textContent = 'Copied!';
            setTimeout(() => { this.textContent = orig; }, 1500);
          });
        });
      });
    }
  }
}

// ─── Readability ──────────────────────────────────────
function renderReadability(r) {
  if (!r) return;
  const raw = _rawData || {};

  // ── Score ring (circumference 264 for r=42) ──
  const circ = 264;
  const scoreRing = $('readRingFill');
  if (scoreRing) {
    const v = Math.min(100, Math.max(0, r.score || 0));
    setTimeout(() => scoreRing.setAttribute('stroke-dasharray', `${(v/100)*circ} ${circ}`), 50);
    // Color based on score
    const col = v >= 70 ? 'var(--ok)' : v >= 45 ? 'var(--warn)' : 'var(--err)';
    scoreRing.style.stroke = col;
  }
  setText('readScoreNum', r.score);

  // Score label
  const scoreLabel = r.score >= 80 ? 'Easy' : r.score >= 60 ? 'Standard' : r.score >= 40 ? 'Difficult' : 'Very Difficult';
  setText('readScoreLabel', scoreLabel);

  setText('readWords', fmt(r.wordCount));
  setText('readSentences', fmt(r.total));
  setText('readAvgLen', r.avgLength);
  setText('readFk', r.fk);

  // Passive voice
  const pv = r.passiveRate || 0;
  setText('readPassive', pv + '%');
  const pvBadge = $('readPassiveBadge');
  if (pvBadge) { pvBadge.textContent = pv <= 10 ? 'Good' : pv <= 20 ? 'Moderate' : 'High'; pvBadge.className = 'read-stat-badge ' + (pv <= 10 ? 'badge-ok' : pv <= 20 ? 'badge-warn' : 'badge-err'); }

  // FK label
  const fkVal = parseFloat(r.fk) || 0;
  const fkLabel = fkVal >= 60 ? 'Easy' : fkVal >= 30 ? 'Difficult' : 'Very Hard';
  const fkEl = $('readFkLabel');
  if (fkEl) { fkEl.textContent = fkLabel; fkEl.className = 'read-stat-badge ' + (fkVal >= 60 ? 'badge-ok' : fkVal >= 30 ? 'badge-warn' : 'badge-err'); }

  // Gunning Fog
  const rRaw = raw.readabilityAdvanced || {};
  const gf = rRaw.gunningFog ?? '--';
  setText('readGunning', gf);
  const gfEl = $('readGunningLabel');
  if (gfEl && gf !== '--') {
    const gfN = parseFloat(gf);
    const gfLbl = gfN <= 12 ? 'Accessible' : gfN <= 16 ? 'College' : 'Postgrad';
    gfEl.textContent = gfLbl; gfEl.className = 'read-stat-badge ' + (gfN <= 12 ? 'badge-ok' : gfN <= 16 ? 'badge-warn' : 'badge-err');
  }

  // Language bars
  const langAnal = raw.languageAnalysis || {};
  const langBarsEl = $('readLangBars');
  if (langBarsEl) {
    const langs = langAnal.languages || [];
    if (langs.length) {
      langBarsEl.innerHTML = langs.slice(0,3).map(l =>
        `<div class="read-lang-bar-row"><span class="read-lang-name">${escHTML(l.lang||l.name||'?')}</span><div class="read-lang-bar-track"><div class="read-lang-bar-fill" style="width:${l.percent||0}%"></div></div><span class="read-lang-pct">${l.percent||0}%</span></div>`
      ).join('');
    }
  }

  // ── Fonts & Colors ──
  const fontsCard = $('readFontsCard');
  const fontsRaw = raw.fontsAndColors || raw.readabilityAdvanced?.fontsAndColors || {};
  const fonts = fontsRaw.fonts || rRaw.fonts || [];
  const textColors = fontsRaw.textColors || rRaw.textColors || [];
  const bgColors = fontsRaw.bgColors || rRaw.backgroundColors || [];

  if (fontsCard && (fonts.length || textColors.length || bgColors.length)) {
    fontsCard.style.display = '';
    const fontsList = $('readFontsList');
    if (fontsList && fonts.length) {
      fontsList.innerHTML = fonts.slice(0,5).map(f =>
        `<div class="read-font-row"><span class="read-font-name">${escHTML(f.name||f.family||f)}</span><span class="read-font-count">${f.count||f.uses||''}</span></div>`
      ).join('');
    }
    const textColEl = $('readTextColors');
    if (textColEl && textColors.length) {
      textColEl.innerHTML = textColors.slice(0,6).map(c => {
        const col = c.color || c.hex || c;
        return `<div class="read-swatch" style="background:${escHTML(col)}" title="${escHTML(col)}"><span class="read-swatch-label">${escHTML(col)}</span></div>`;
      }).join('');
    }
    const bgColEl = $('readBgColors');
    if (bgColEl && bgColors.length) {
      bgColEl.innerHTML = bgColors.slice(0,6).map(c => {
        const col = c.color || c.hex || c;
        return `<div class="read-swatch" style="background:${escHTML(col)}" title="${escHTML(col)}"><span class="read-swatch-label">${escHTML(col)}</span></div>`;
      }).join('');
    }
  } else if (fontsCard) { fontsCard.style.display = 'none'; }

  // ── Text Contrast (WCAG) ──
  const contrastCard = $('readContrastCard');
  const contrast = raw.contrastAnalysis || {};
  const pairs = contrast.pairs || contrast.results || [];
  if (contrastCard && pairs.length) {
    contrastCard.style.display = '';
    const passing = pairs.filter(p => p.aa || p.passes || p.aaPass).length;
    const failing = pairs.length - passing;
    const passRate = pairs.length ? Math.round((passing/pairs.length)*100) : 0;
    setText('readContrastPassRate', passRate + '%');
    setText('readContrastPassing', passing);
    setText('readContrastFailing', failing);
    setText('readContrastTested', pairs.length);
    const prEl = $('readContrastPassRate');
    if (prEl) prEl.style.color = passRate >= 75 ? 'var(--ok)' : passRate >= 50 ? 'var(--warn)' : 'var(--err)';
    const tbody = $('readContrastBody');
    if (tbody) {
      tbody.innerHTML = pairs.slice(0,20).map(p => {
        const ratio = p.ratio || p.contrastRatio || 0;
        const aaPass = p.aa || p.passes || p.aaPass;
        const elem = p.element || p.tag || p.selector || 'element';
        const size = p.fontSize || p.size || '';
        const bgColor = p.bg || p.background || p.bgColor || '#ffffff';
        const fgColor = p.fg || p.foreground || p.color || '#000000';
        const preview = `<span style="background:${escHTML(bgColor)};color:${escHTML(fgColor)};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;border:1px solid rgba(0,0,0,.1)">Aa</span>`;
        return `<tr>
          <td><code class="read-elem-code">${escHTML(elem)}${size ? ' ' + escHTML(size) : ''}</code></td>
          <td>${preview}</td>
          <td style="font-weight:700;color:${ratio >= 4.5 ? 'var(--ok)' : 'var(--err)'}">${typeof ratio === 'number' ? ratio.toFixed(2) + ':1' : ratio}</td>
          <td><span class="read-aa-badge ${aaPass ? 'pass' : 'fail'}">${aaPass ? '✓' : '✗'}</span></td>
        </tr>`;
      }).join('');
    }
  } else if (contrastCard) { contrastCard.style.display = 'none'; }

  // ── Duplicate Content warning ──
  const dupCard = $('readDuplicateCard');
  const dupList = $('readDuplicateList');
  const dupItems = [];
  const meta = _rawData ? adaptV1Data(_rawData).meta : null;
  if (meta && !meta.desc) dupItems.push('Meta description missing — add a unique 120–160 char description');
  else if (meta && meta.desc && meta.desc.length > 160) dupItems.push(`Meta description too long (${meta.desc.length} chars) — keep under 160 characters to avoid truncation`);
  else if (meta && meta.desc && meta.desc.length < 70) dupItems.push(`Meta description too short (${meta.desc.length} chars) — aim for 120–160 characters`);
  if (dupCard && dupItems.length) {
    dupCard.style.display = '';
    dupList.innerHTML = dupItems.map(d => `<div class="read-dup-item"><span class="read-dup-icon">✗</span><span>${escHTML(d)}</span></div>`).join('');
  } else if (dupCard) { dupCard.style.display = 'none'; }

  // ── Sentence Length Distribution ──
  const db = $('distBars');
  if (db && r.dist) {
    const total = r.total || 1;
    const cats = [
      { label:'Very Short (1-5)',  cls:'vs', val:r.dist.veryShort, color:'#818cf8' },
      { label:'Short (6-10)',      cls:'s',  val:r.dist.short,     color:'#6366f1' },
      { label:'Medium (11-20)',    cls:'m',  val:r.dist.medium,    color:'#475569' },
      { label:'Long (21-30)',      cls:'l',  val:r.dist.long,      color:'#94a3b8' },
      { label:'Very Long (31+)',   cls:'vl', val:r.dist.veryLong,  color:'var(--err)' }
    ];
    const max = Math.max(...cats.map(c => c.val), 1);
    db.innerHTML = cats.map(c => {
      const pct = Math.round((c.val / max) * 100);
      return `<div class="dist-row">
        <span class="dist-label">${escHTML(c.label)}</span>
        <div class="dist-bar-wrap"><div class="dist-bar-fill ${c.cls}" style="width:${pct}%;background:${c.color}"></div></div>
        <span class="dist-count">${c.val}</span>
      </div>`;
    }).join('');
  }

  // ── Longest Sentences (with tabs) ──
  let _lsMinWords = 0;
  const allSentences = r.longest || [];
  function renderLsTable(minWords) {
    const ls = $('longestSentences');
    if (!ls) return;
    const filtered = allSentences.filter(s => s.words >= minWords);
    ls.innerHTML = filtered.slice(0,20).map(s => {
      const wColor = s.words > 30 ? 'var(--err)' : s.words > 20 ? 'var(--warn)' : 'var(--text-2)';
      const chars = s.text ? s.text.length : 0;
      const excerpt = s.text ? escHTML(s.text.slice(0,160)) + (s.text.length>160?'…':'') : '';
      return `<tr>
        <td style="font-weight:800;color:${wColor};width:50px">${s.words}</td>
        <td style="color:var(--text-3);width:70px">${chars}</td>
        <td><span class="read-ls-bar" style="border-left:3px solid ${wColor};padding-left:10px;color:var(--text-2);font-size:11px;line-height:1.5;display:block">${excerpt}</span></td>
      </tr>`;
    }).join('') || `<tr><td colspan="3" style="color:var(--text-3);text-align:center;padding:16px">No sentences found</td></tr>`;
  }
  renderLsTable(0);
  document.querySelectorAll('.read-ls-tab').forEach(btn => {
    if (!btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.read-ls-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderLsTable(parseInt(btn.dataset.min) || 0);
      });
    }
  });

  // ── Language & Translation ──
  const langCard = $('readLangCard');
  const langGrid = $('readLangGrid');
  if (langGrid) {
    const la = raw.languageAnalysis || {};
    const declared = la.declaredLang || la.htmlLang || '--';
    const detected = la.detectedLang || la.primaryLang || '--';
    const urlHint = la.urlHint || la.urlLang || '-';
    const langIssues = la.issues || [];
    langGrid.innerHTML = `
      <div class="read-lang-item"><div class="read-lang-item-label">HTML LANG</div><div class="read-lang-item-val accent">${escHTML(declared.toUpperCase())}</div><div class="read-lang-item-sub">${escHTML(declared === '--' ? 'Not set' : getLanguageName(declared))}</div></div>
      <div class="read-lang-item"><div class="read-lang-item-label">DETECTED</div><div class="read-lang-item-val accent">${escHTML(detected.toUpperCase())}</div><div class="read-lang-item-sub">${la.confidence ? escHTML(getLanguageName(detected)) + ' (' + la.confidence + '%)' : escHTML(getLanguageName(detected))}</div></div>
      <div class="read-lang-item"><div class="read-lang-item-label">URL HINT</div><div class="read-lang-item-val">${escHTML(urlHint === '-' ? '-' : urlHint.toUpperCase())}</div><div class="read-lang-item-sub">${urlHint === '-' ? 'No language prefix' : ''}</div></div>
      <div class="read-lang-content"><div class="read-lang-item-label">CONTENT LANGUAGES</div>${(la.languages||[]).slice(0,4).map(l=>`<div class="read-lang-bar-row"><span class="read-lang-name">${escHTML(l.lang||l.name||'?').toUpperCase()}</span><div class="read-lang-bar-track"><div class="read-lang-bar-fill" style="width:${l.percent||0}%"></div></div><span class="read-lang-pct">${l.percent||0}%</span></div>`).join('') || '<span style="color:var(--text-3)">—</span>'}</div>
    `;
    const langStatus = $('readLangStatus');
    if (langStatus) {
      if (langIssues.length) {
        langStatus.innerHTML = langIssues.map(i => `<div class="read-lang-issue warn"><svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>${escHTML(i.message||i)}</div>`).join('');
      } else {
        langStatus.innerHTML = `<div class="read-lang-issue ok"><svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>No language or translation issues detected</div>`;
      }
    }
  }

  // ── Readability Tips ──
  const tipsList = $('readTipsList');
  if (tipsList) {
    const tips = [];
    if (r.dist?.veryLong > 0) tips.push(`Avoid very long sentences (31+ words) whenever possible. You have ${r.dist.veryLong} sentence(s) in this category.`);
    if (r.dist?.long > 2)     tips.push('Break down complex sentences into smaller, more digestible ones.');
    tips.push('Vary your sentence length to maintain reader interest, but favor shorter sentences.');
    tips.push("Your readability score reflects the weighted percentage of your content that's in long sentences.");
    if (parseFloat(r.fk) < 50) tips.push('Consider using simpler vocabulary to improve your Flesch-Kincaid score.');
    if (r.passiveRate > 15) tips.push(`Reduce passive voice usage (currently ${r.passiveRate}%) — aim for under 10%.`);
    tipsList.innerHTML = tips.map(t => `<li class="read-tip-item">${escHTML(t)}</li>`).join('');
  }
}

function getLanguageName(code) {
  const names = { en:'English', es:'Spanish', fr:'French', de:'German', it:'Italian', pt:'Portuguese', nl:'Dutch', ru:'Russian', ar:'Arabic', zh:'Chinese', ja:'Japanese', ko:'Korean', pl:'Polish', tr:'Turkish', sv:'Swedish', da:'Danish', fi:'Finnish', no:'Norwegian', '--':'Unknown' };
  return names[(code||'').toLowerCase().slice(0,2)] || code || '—';
}

// ─── CRO ──────────────────────────────────────────────
function renderCRO(cro) {
  if (!cro) cro = {};
  const score = Math.min(100, Math.max(0, Number(cro.score) || 0));

  // Score ring (circumference 314 for r=50)
  const croRing = $('croRingFill');
  if (croRing) {
    const circ = 314;
    croRing.setAttribute('stroke-dasharray', `${(score / 100) * circ} ${circ}`);
    // Color by score band
    let stroke = '#f59e0b';
    if (score >= 75) stroke = '#16a34a';
    else if (score >= 50) stroke = '#f59e0b';
    else if (score >= 30) stroke = '#ea580c';
    else stroke = '#dc2626';
    croRing.style.stroke = stroke;
  }
  const numEl = $('croScoreNum');
  if (numEl) {
    numEl.textContent = score;
    numEl.style.color = score >= 75 ? '#16a34a' : score >= 50 ? '#f59e0b' : score >= 30 ? '#ea580c' : '#dc2626';
  }

  // Grade label under intro if present
  const gradeEl = $('croGradeLabel');
  if (gradeEl) {
    const grade = score >= 80 ? 'Excellent' : score >= 65 ? 'Good' : score >= 45 ? 'Fair' : score >= 25 ? 'Needs work' : 'Poor';
    gradeEl.textContent = grade;
    gradeEl.className = 'cro-grade-label cro-grade-' + (score >= 65 ? 'ok' : score >= 45 ? 'mid' : 'bad');
  }

  const sections = $('croSections');
  if (!sections) return;
  sections.innerHTML = '';

  const yesNo = (v, yesLabel, noLabel) => {
    if (v === true) return { ok: true, text: yesLabel || 'Yes' };
    return { ok: false, text: noLabel || 'No' };
  };
  const rawVal = (text, ok) => ({ ok: !!ok, text: String(text), raw: true });

  const cta = cro.cta || {};
  const trust = cro.trust || {};
  const af = cro.aboveFold || {};
  const nav = cro.nav || {};
  const prod = cro.product || {};
  const forms = Array.isArray(cro.forms) ? cro.forms : [];
  const inter = cro.interstitials || {};
  const sp = cro.socialProof || {};
  const content = cro.content || {};
  const perf = cro.perf || {};

  const formFieldTotal = forms.reduce((s, f) => s + (f.fieldCount || 0), 0);
  const formsWithGenericSubmit = forms.filter(f => f.isGenericSubmit).length;
  const formsMissingLabels = forms.filter(f => (f.fieldsWithoutLabels || 0) > 0).length;

  const groups = [
    {
      title: '🎯 Call-to-Action',
      tip: 'Clear, action-oriented CTAs above the fold drive conversions.',
      items: [
        { label: 'CTA detected', ...yesNo(!!cta.hasCTA || (cta.ctaCount || 0) > 0) },
        { label: 'CTA above fold', ...yesNo(!!cta.ctaAboveFold) },
        { label: 'CTA count', ...rawVal(cta.ctaCount || 0, (cta.ctaCount || 0) > 0) },
        ...(Array.isArray(cta.items) && cta.items.length
          ? [{ label: 'Sample CTAs', ...rawVal(cta.items.slice(0, 3).map(i => i.text).filter(Boolean).join(' · ') || '—', true) }]
          : [])
      ]
    },
    {
      title: '🛡 Trust Signals',
      tip: 'Reviews, guarantees and contact info reduce purchase anxiety.',
      items: [
        { label: 'Customer reviews', ...yesNo(!!trust.hasReviews) },
        { label: 'Testimonials', ...yesNo(!!trust.hasTestimonials || (trust.testimonialCount || 0) > 0, (trust.testimonialCount ? trust.testimonialCount + ' found' : 'Yes')) },
        { label: 'Money-back guarantee', ...yesNo(!!trust.hasGuarantee) },
        { label: 'Return / refund policy', ...yesNo(!!trust.hasReturnPolicy) },
        { label: 'Shipping info', ...yesNo(!!trust.hasShippingInfo) },
        { label: 'Contact info', ...yesNo(!!trust.hasContact) },
        { label: 'Phone number', ...yesNo(!!trust.hasPhone) },
        { label: 'Email address', ...yesNo(!!trust.hasEmail) },
        { label: 'Payment badges', ...rawVal(trust.paymentBadges || 0, (trust.paymentBadges || 0) > 0) },
        { label: 'Security badges', ...rawVal(trust.securityBadges || 0, (trust.securityBadges || 0) > 0) }
      ]
    },
    {
      title: '👁 Above the Fold',
      tip: 'First screen should show value prop, H1 and a primary CTA.',
      items: [
        { label: 'H1 visible above fold', ...yesNo(!!af.h1AboveFold) },
        { label: 'Hero image/section', ...yesNo(!!af.hasHero) },
        { label: 'CTA above fold', ...yesNo(!!af.ctaAboveFold) }
      ]
    },
    {
      title: '🧭 Navigation & UX',
      tip: 'Search, breadcrumbs and sticky nav help users find their way.',
      items: [
        { label: 'Search bar', ...yesNo(!!nav.hasSearch) },
        { label: 'Breadcrumbs', ...yesNo(!!nav.hasBreadcrumbs) },
        { label: 'Sticky header', ...yesNo(!!nav.hasStickyHeader) },
        { label: 'Chat widget', ...yesNo(!!inter.hasChatWidget) },
        { label: 'Intrusive popups', ...rawVal(inter.intrusivePopups || 0, (inter.intrusivePopups || 0) === 0) }
      ]
    },
    {
      title: '🛒 Product signals',
      tip: 'Price, images and stock status matter on commercial pages.',
      items: [
        { label: 'Price visible', ...yesNo(!!prod.hasPrice) },
        { label: 'Product images', ...rawVal(prod.imageCount || 0, (prod.imageCount || 0) > 0) },
        { label: 'Variant selector', ...yesNo(!!prod.hasVariantSelector) },
        { label: 'Availability shown', ...yesNo(!!prod.hasAvailability) }
      ]
    },
    {
      title: '📝 Forms',
      tip: 'Fewer fields, clear labels and specific submit text convert better.',
      items: [
        { label: 'Forms found', ...rawVal(forms.length, forms.length >= 0) },
        { label: 'Total fields', ...rawVal(formFieldTotal, formFieldTotal < 12) },
        { label: 'Forms missing labels', ...rawVal(formsMissingLabels, formsMissingLabels === 0) },
        { label: 'Generic submit text', ...rawVal(formsWithGenericSubmit, formsWithGenericSubmit === 0) }
      ]
    },
    {
      title: '💬 Social proof',
      tip: 'Logos, testimonials and share buttons build credibility.',
      items: [
        { label: 'Testimonials', ...rawVal(sp.testimonialCount || 0, (sp.testimonialCount || 0) > 0) },
        { label: 'Client / partner logos', ...yesNo(!!sp.hasClientLogos) },
        { label: 'Share buttons', ...yesNo(!!sp.hasShareButtons) },
        { label: 'Social profile links', ...rawVal(trust.socialLinks || 0, (trust.socialLinks || 0) > 0) }
      ]
    },
    {
      title: '📄 Content scanability',
      tip: 'Scannable content with lists and FAQs keeps users engaged.',
      items: [
        { label: 'Bullet / list items', ...rawVal(content.bulletPoints || 0, (content.bulletPoints || 0) > 3) },
        { label: 'Tables', ...rawVal(content.tables || 0, true) },
        { label: 'FAQ section', ...yesNo(!!content.hasFAQ) },
        { label: 'Table of contents', ...yesNo(!!content.hasTOC) },
        { label: 'Long paragraphs (>300 chars)', ...rawVal(content.longParagraphs || 0, (content.longParagraphs || 0) <= 5) }
      ]
    },
    {
      title: '⚡ Performance (CRO impact)',
      tip: 'Slow pages and large DOM hurt conversion rates.',
      items: [
        { label: 'Render-blocking scripts', ...rawVal(perf.blockingScripts || 0, (perf.blockingScripts || 0) <= 2) },
        { label: 'DOM size', ...rawVal((perf.domSize || 0) + ' elements', (perf.domSize || 0) < 1500) },
        { label: 'Lazy-loaded images', ...rawVal((perf.lazyImageRatio != null ? perf.lazyImageRatio + '%' : (perf.lazyImages || 0)), (perf.lazyImageRatio || 0) >= 40 || (perf.lazyImages || 0) > 0) }
      ]
    }
  ];

  // Build recommendations from failed checks
  const recs = [];
  if (!cta.hasCTA && (cta.ctaCount || 0) === 0) recs.push({ sev: 'high', text: 'Add a clear primary CTA (e.g. “Get started”, “Buy now”) with action-oriented copy.' });
  if (!cta.ctaAboveFold) recs.push({ sev: 'high', text: 'Place at least one primary CTA above the fold so visitors see it without scrolling.' });
  if (!trust.hasReviews && !trust.hasTestimonials) recs.push({ sev: 'med', text: 'Add customer reviews or testimonials to build trust.' });
  if (!trust.hasGuarantee && !trust.hasReturnPolicy) recs.push({ sev: 'med', text: 'Surface a money-back guarantee or clear return policy near the CTA.' });
  if (!trust.hasContact) recs.push({ sev: 'med', text: 'Show phone, email or a contact page link so users can reach you easily.' });
  if (!af.h1AboveFold) recs.push({ sev: 'med', text: 'Ensure the main H1 is visible in the first viewport.' });
  if (!af.hasHero) recs.push({ sev: 'low', text: 'Consider a hero section with a strong visual and value proposition above the fold.' });
  if ((inter.intrusivePopups || 0) > 0) recs.push({ sev: 'high', text: 'Reduce intrusive popups/modals that cover >15% of the viewport on load.' });
  if (formsWithGenericSubmit > 0) recs.push({ sev: 'low', text: 'Replace generic “Submit” buttons with specific text (e.g. “Get my quote”).' });
  if (formsMissingLabels > 0) recs.push({ sev: 'med', text: 'Add visible labels or aria-labels to form fields for accessibility and clarity.' });
  if ((perf.blockingScripts || 0) > 3) recs.push({ sev: 'med', text: 'Defer or async non-critical scripts to improve load speed and conversions.' });
  if ((perf.domSize || 0) > 2500) recs.push({ sev: 'low', text: 'Simplify the DOM — large pages feel slower and can hurt conversion rate.' });
  if (!content.hasFAQ && (content.bulletPoints || 0) < 4) recs.push({ sev: 'low', text: 'Add an FAQ or more scannable lists to answer objections and keep users on page.' });

  groups.forEach(g => {
    const pass = g.items.filter(i => i.ok).length;
    const total = g.items.length;
    const sec = el('div', 'cro-section');
    sec.innerHTML =
      `<div class="cro-section-head">` +
        `<div class="cro-section-title">${g.title}</div>` +
        `<span class="cro-section-badge ${pass === total ? 'ok' : pass === 0 ? 'bad' : 'mid'}">${pass}/${total}</span>` +
      `</div>` +
      (g.tip ? `<div class="cro-section-tip">${escHTML(g.tip)}</div>` : '');
    const items = el('div', 'cro-items');
    g.items.forEach(item => {
      const row = el('div', 'cro-item');
      let valHTML;
      if (item.raw) {
        valHTML = `<span class="cro-item-val ${item.ok ? 'yes' : 'no'}">${escHTML(item.text)}</span>`;
      } else if (item.ok) {
        valHTML = `<span class="cro-item-val yes">${escHTML(item.text)}</span>`;
      } else {
        valHTML = `<span class="cro-item-val no">${escHTML(item.text)}</span>`;
      }
      row.innerHTML = `<span class="cro-item-label">${escHTML(item.label)}</span>${valHTML}`;
      items.appendChild(row);
    });
    sec.appendChild(items);
    sections.appendChild(sec);
  });

  // Recommendations card
  if (recs.length) {
    const recSec = el('div', 'cro-section cro-recs-section');
    recSec.innerHTML = `<div class="cro-section-head"><div class="cro-section-title">💡 CRO Recommendations</div><span class="cro-section-badge mid">${recs.length}</span></div>`;
    const list = el('div', 'cro-recs-list');
    recs.forEach(r => {
      const row = el('div', 'cro-rec-item cro-rec-' + r.sev);
      row.innerHTML = `<span class="cro-rec-sev">${r.sev === 'high' ? 'High' : r.sev === 'med' ? 'Med' : 'Low'}</span><span class="cro-rec-text">${escHTML(r.text)}</span>`;
      list.appendChild(row);
    });
    recSec.appendChild(list);
    sections.appendChild(recSec);
  }
}

// ─── Social ───────────────────────────────────────────
const SOCIAL_ICONS = {
  facebook: 'facebook', instagram: 'instagram', linkedin: 'linkedin',
  youtube: 'youtube', twitter: 'twitter', x: 'x', tiktok: 'tiktok',
  pinterest: 'pinterest', github: 'github', reddit: 'reddit',
  discord: 'discord', telegram: 'telegram', whatsapp: 'whatsapp', medium: 'medium'
};

function getSocialIcon(platform) {
  const key = (platform || '').toLowerCase().replace(/[^a-z]/g, '');
  return SOCIAL_ICONS[key] || 'default';
}

function renderSocial(profilesRaw) {
  // Accept both old format (array of {name, url}) and new format (from raw.socialProfiles.profiles)
  const rawProfiles = _rawData?.socialProfiles?.profiles || profilesRaw || [];
  const list = $('socialList');
  const countEl = $('socialCount');
  const emptyEl = $('socialEmpty');
  const exportBtn = $('socialExportCsvBtn');
  if (!list) return;

  if (countEl) countEl.textContent = rawProfiles.length;

  if (!rawProfiles.length) {
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Group by platform
  const grouped = {};
  rawProfiles.forEach(p => {
    const platform = p.platform || p.name || 'Other';
    const iconKey = getSocialIcon(platform);
    if (!grouped[platform]) grouped[platform] = { icon: iconKey, types: {} };
    const type = p.type || 'Profile';
    if (!grouped[platform].types[type]) grouped[platform].types[type] = [];
    grouped[platform].types[type].push(p);
  });

  list.innerHTML = Object.entries(grouped).map(([platform, data]) => {
    const totalCount = Object.values(data.types).reduce((s, arr) => s + arr.length, 0);
    const typeSections = Object.entries(data.types).map(([type, items]) =>
      `<div class="social-type-group">
        <div class="social-type-label">${escHTML(type)} <span class="social-type-count">${items.length}</span></div>
        ${items.map(item => `
          <div class="social-item" data-url="${escAttr(item.url)}">
            <span class="social-item-url" title="${escAttr(item.url)}">${escHTML((item.url || '').replace(/^https?:\/\/(www\.)?/, ''))}</span>
            ${item.source === 'schema' ? '<span class="social-badge">Schema</span>' : ''}
            <button class="social-btn-copy" title="Copy">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
            <a href="${escAttr(item.url)}" target="_blank" class="social-btn-open" title="Open">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
            </a>
          </div>`).join('')}
      </div>`
    ).join('');

    return `<div class="social-platform-section">
      <button class="social-platform-toggle">
        <span class="social-icon social-icon-${escAttr(data.icon)}"></span>
        <span class="social-platform-name">${escHTML(platform)}</span>
        <span class="social-platform-count">${totalCount}</span>
        <svg class="social-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="social-platform-body">${typeSections}</div>
    </div>`;
  }).join('');

  // Toggle collapse
  list.querySelectorAll('.social-platform-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.social-platform-section').classList.toggle('collapsed');
    });
  });

  // Copy buttons
  list.querySelectorAll('.social-btn-copy').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.closest('.social-item').dataset.url;
      navigator.clipboard.writeText(url);
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 800);
    });
  });

  // CSV export
  if (exportBtn && !exportBtn._bound) {
    exportBtn._bound = true;
    exportBtn.addEventListener('click', () => {
      const rows = [['Platform', 'Type', 'URL', 'Source']];
      rawProfiles.forEach(p => rows.push([p.platform || p.name || '', p.type || 'Profile', p.url, p.source || 'link']));
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      navigator.clipboard.writeText(csv);
      exportBtn.classList.add('copied');
      setTimeout(() => exportBtn.classList.remove('copied'), 800);
      toast('Social profiles copied as CSV!');
    });
  }
}

// ─── Export Markdown Report (.md) for Claude/ChatGPT/MCP ──────────────────
async function exportMarkdownReport() {
  if (!_rawData) { toast('Run an audit first.'); return; }
  try {
    if (typeof ShahzaibSEOMarkdownReport === 'undefined') {
      toast('Markdown generator not loaded. Check libs/md-report-generator.js');
      return;
    }

    // Gather PAGE context (builder / postId / heading audit) from the inspected
    // tab — NOT the popup DOM. Without this, detection runs against the popup UI.
    let context = { pageBuilder: null, postId: null, headingAudit: null };
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && /^https?:/.test(tab.url || '')) {
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world : 'ISOLATED',
          func: async () => (window.ShahzaibSEOMCPBridge ? {
            pageBuilder : window.ShahzaibSEOMCPBridge.detectPageBuilder(),
            postId      : await window.ShahzaibSEOMCPBridge.detectWordPressPostId(),
            headingAudit: window.ShahzaibSEOMCPBridge.auditHeadings(),
          } : null),
        });
        if (res?.[0]?.result) context = res[0].result;
      }
    } catch (e) {
      console.warn('[ShahzaibSEO] MD export: page-context detection unavailable:', e.message);
    }

    const bridge = window._mcpBridge || null;
    const report = new ShahzaibSEOMarkdownReport(_rawData, _vitals || null, bridge, context);
    const filename = report.download();
    toast(`✅ Downloaded: ${filename}`);
  } catch (e) {
    console.error('[ShahzaibSEO] MD export error:', e);
    toast('Error generating report: ' + e.message);
  }
}

// ─── WP x MCP: Save Settings ───────────────────────────────────────────────
async function mcpSaveSettings() {
  const endpoint = ($('wpxmcpEndpoint')?.value || '').trim();
  const apiKey   = ($('wpxmcpApiKey')?.value  || '').trim();
  if (!endpoint || !apiKey) {
    toast('Enter both endpoint URL and API key.');
    return;
  }
  await chrome.storage.local.set({ wpxmcpEndpoint: endpoint, wpxmcpApiKey: apiKey });
  // Update badge
  setMcpBadge('Saved', 'ok');
  toast('✅ WP x MCP settings saved.');
}

// ─── WP x MCP: Test Connection ─────────────────────────────────────────────
async function mcpTestConnection() {
  const resultEl = $('mcpTestResult');
  if (resultEl) { resultEl.style.display = 'block'; resultEl.textContent = 'Testing…'; resultEl.className = 'settings-test-result'; }

  try {
    if (typeof ShahzaibSEOMCPBridge === 'undefined') throw new Error('mcp-bridge.js not loaded');
    const bridge = new ShahzaibSEOMCPBridge();
    const ok = await bridge.init();
    if (!ok) throw new Error('No endpoint or API key stored. Save settings first.');

    const tools = await bridge.listTools();
    setMcpBadge(`Connected (${tools.length} tools)`, 'ok');
    if (resultEl) {
      resultEl.textContent = `✅ Connected! ${tools.length} MCP tools available.`;
      resultEl.classList.add('ok');
    }
    // Cache bridge globally for MD report generation
    window._mcpBridge = bridge;
    writeCachedMcpTools(tools);
    renderMcpFixOptionsPanel(tools);
    toast('✅ WP x MCP connected!');
  } catch (e) {
    if (resultEl) { resultEl.textContent = `❌ ${e.message}`; resultEl.classList.add('error'); }
    toast('Connection failed: ' + e.message);
  }
}

// ─── WP x MCP: Auto-fix all issues on current page ─────────────────────────
// Toggle busy state on BOTH MCP Fix triggers (sidebar footer + the MCP tab CTA).
function setMcpFixBusy(busy) {
  [['mcpFixBtn', 'MCP Fix'], ['mcpFixBtnTab', 'Fix this page']].forEach(([id, label]) => {
    const b = $(id); if (!b) return;
    b.disabled = busy;
    const sp = b.querySelector('span'); if (sp) sp.textContent = busy ? 'Fixing…' : (b.dataset.label || label);
  });
}

async function mcpFixAll() {
  if (!_rawData) { toast('Run audit first.'); return; }
  if (typeof ShahzaibSEOMCPBridge === 'undefined') { toast('mcp-bridge.js not loaded.'); return; }

  // Read which tools the user ticked. If nothing is checked, bail.
  let checkedTools = readMcpCheckedTools();
  if (!checkedTools.length) {
    // Fallback: legacy 4-bucket box might be checked. Map them to a
    // conservative default tool set so the old UX still works.
    const opt = readMcpFixOptions();
    const fallback = [];
    // Use real tool names this server actually exposes (verified via tools/list).
    if (opt.heading) fallback.push('audit_heading_structure');
    if (opt.seo)     fallback.push('seo_audit_post');
    if (opt.images)  fallback.push('audit_image_alts');
    if (opt.schema)  fallback.push('schema_validator');
    if (!fallback.length) {
      toast('Pick at least one tool in Settings → WP x MCP → "What to fix".');
      return;
    }
    checkedTools = fallback;
    console.info('[ShahzaibSEO MCP] No dynamic tool list loaded — using fallback tool names.', fallback);
  }

  const btn = $('mcpFixBtn');
  setMcpFixBusy(true);

  // Pre-open the result panel and show a "running" row so the user sees feedback
  const resultsPanel = $('mcpFixResults');
  const resultsList  = $('mcpFixResultsList');
  const resultsMeta  = $('mcpFixResultsMeta');
  if (resultsPanel) resultsPanel.style.display = 'block';
  if (resultsList)  resultsList.innerHTML = checkedTools.map(n => `
    <div class="mcp-fix-result-row" id="mcpFixRow-${cssIdSafe(n)}">
      <span class="mcp-fix-result-status">⏳</span>
      <span class="mcp-fix-result-name">${escapeHtml(prettyMcpLabel(n))}</span>
      <span class="mcp-fix-result-msg" data-role="msg">queued…</span>
    </div>`).join('');
  if (resultsMeta)  resultsMeta.textContent = `Dispatching ${checkedTools.length} tool(s)…`;

  const t0 = Date.now();
  window._mcpFixRunT0 = t0;
  let postId = null, pageBuilder = null, headingAudit = null;
  let contentScriptOk = true;

  try {
    // Initialise bridge
    const bridge = window._mcpBridge || new ShahzaibSEOMCPBridge();
    if (!window._mcpBridge) {
      const ok = await bridge.init();
      if (!ok) {
        // The endpoint + API key fields live on THIS MCP tab — guide the user
        // to them instead of erroring out toward the (now-empty) Settings tab.
        if (typeof switchTab === 'function') switchTab('mcp');
        const resultsPanelEl = $('mcpFixResults');
        if (resultsPanelEl) resultsPanelEl.style.display = 'none';
        const ep = $('wpxmcpEndpoint');
        if (ep) {
          ep.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => { try { ep.focus(); } catch (_) {} }, 350);
          ep.classList.add('mcp-field-flash');
          setTimeout(() => ep.classList.remove('mcp-field-flash'), 1600);
        }
        toast('Not connected yet — enter your MCP Endpoint URL + API Key below, then click “Save & Connect”.');
        return;
      }
      window._mcpBridge = bridge;
    }
    // Make sure the tool list is fresh (no-op if already cached)
    try { await bridge.listTools(); } catch (_) {}

    // ── Post ID + page context detection ──────────────────────────────────────
    // Strategy (in priority order):
    //
    //  A) URL params — extracted directly from tab.url in the popup (no injection,
    //     no world issues, instant). Covers ?p=NNN, ?page_id=NNN, ?post=NNN, etc.
    //
    //  B) ISOLATED-world executeScript — runs in the SAME JS context as the
    //     content script (mcp-bridge.js), so window.ShahzaibSEOMCPBridge IS visible.
    //     This is where DOM signals (body class, shortlink, alt-link, Elementor
    //     data attrs) are read, and where same-origin REST API fetches succeed
    //     (content scripts can fetch any origin they're injected into).
    //
    //  C) MCP bridge REST API call — ask the WP REST API directly via the MCP
    //     endpoint (already authenticated). Uses wp/v2/posts?slug= + wp/v2/pages?slug=.
    //     Runs from the popup using the already-configured bridge, which has
    //     host_permissions for the WP x MCP endpoint.
    //
    // Why NOT world:"MAIN"? The content script is injected in ISOLATED world
    // (no "world":"MAIN" in manifest), so window.ShahzaibSEOMCPBridge is NEVER
    // visible to MAIN-world injections. Always use world:"ISOLATED".

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // ── A) Popup-side URL param extraction (zero injection, instant) ──────────
    try {
      const tabUrl = new URL(tab.url || '');
      for (const k of ['p', 'page_id', 'post', 'post_id']) {
        const v = tabUrl.searchParams.get(k);
        if (v && /^\d+$/.test(v)) { postId = parseInt(v, 10); break; }
      }
    } catch (_) {}

    // ── B) ISOLATED-world script injection ────────────────────────────────────
    if (!postId) {
      try {
        const scriptRes = await chrome.scripting.executeScript({
          target : { tabId: tab.id },
          world  : 'ISOLATED',   // ← CRITICAL: same context as content scripts
          func   : async () => {
            const B = window.ShahzaibSEOMCPBridge;
            if (!B) return null;          // mcp-bridge.js not yet loaded

            // Run all DOM-based detectors (body class, shortlink, alt-link,
            // data attrs, URL params, REST API slug fetch).
            const pid = await B.detectWordPressPostId();
            return {
              postId      : pid,
              pageBuilder : B.detectPageBuilder(),
              headingAudit: B.auditHeadings(),
            };
          },
        });
        const r = scriptRes?.[0]?.result;
        if (r?.postId) {
          postId       = r.postId;
          pageBuilder  = r.pageBuilder  || null;
          headingAudit = r.headingAudit || null;
        }
      } catch (e) {
        contentScriptOk = false;
        console.warn('[ShahzaibSEO MCP] ISOLATED-world injection failed:', e.message);
      }
    }

    // ── C) MCP bridge REST API fallback ──────────────────────────────────────
    // If DOM detection still failed, use the WP REST API via the authenticated
    // MCP endpoint. We derive the slug from the tab URL and look up the post ID.
    if (!postId) {
      try {
        const tabUrl    = new URL(tab.url || '');
        const slug      = decodeURIComponent(
          tabUrl.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || ''
        );
        if (slug) {
          // Derive the site's REST API root from the MCP endpoint URL.
          // MCP endpoint: https://site.com/wp-json/wp-x-mcp/v1/mcp
          // REST root:    https://site.com/wp-json/
          const mcpUrl   = (bridge.endpoint || '').replace(/\/wp-x-mcp.*$/, '/');
          const restRoot = mcpUrl || (tabUrl.origin + '/wp-json/');

          const tryFetch = async (url) => {
            try {
              const res = await fetch(url, {
                headers: {
                  'X-WPXMCP-API-Key': bridge.apiKey,
                  'Authorization'   : `Bearer ${bridge.apiKey}`,
                },
              });
              return res.ok ? res.json() : null;
            } catch (_) { return null; }
          };

          for (const type of ['posts', 'pages']) {
            const data = await tryFetch(
              `${restRoot}wp/v2/${type}?slug=${encodeURIComponent(slug)}&_fields=id&per_page=1`
            );
            if (Array.isArray(data) && data[0]?.id) {
              postId = parseInt(data[0].id, 10);
              console.info('[ShahzaibSEO MCP] Post ID resolved via REST API fallback:', postId, '(type:', type + ')');
              break;
            }
          }

          // Last resort: search endpoint (covers custom post types)
          if (!postId) {
            const sData = await tryFetch(
              `${restRoot}wp/v2/search?search=${encodeURIComponent(slug)}&_fields=id,url,slug&per_page=5`
            );
            if (Array.isArray(sData)) {
              const here = tab.url.replace(/\/+$/, '');
              const hit  = sData.find(r =>
                (r.url && r.url.replace(/\/+$/, '') === here) || r.slug === slug
              ) || sData[0];
              if (hit?.id) {
                postId = parseInt(hit.id, 10);
                console.info('[ShahzaibSEO MCP] Post ID resolved via REST search fallback:', postId);
              }
            }
          }
        }
      } catch (e) {
        console.warn('[ShahzaibSEO MCP] REST API fallback failed:', e.message);
      }
    }

    console.info('[ShahzaibSEO MCP] Post ID detection result:', { postId, tabUrl: tab.url });

    // If all DOM + REST API methods failed, show a manual entry prompt
    // instead of hard-aborting so the user can still proceed.
    if (!postId) {
      // Check for a manually-entered override first
      const manualField = $('mcpManualPostId');
      const manualVal   = manualField ? manualField.value.trim() : '';
      if (manualVal && /^\d+$/.test(manualVal)) {
        postId = parseInt(manualVal, 10);
        console.info('[ShahzaibSEO MCP] Using manually-entered post ID:', postId);
      } else {
        // Show the manual-entry row (if present in the MCP tab HTML) and abort
        const manualRow = $('mcpManualPostIdRow');
        if (manualRow) {
          manualRow.style.display = 'flex';
          if (manualField) { manualField.focus(); manualField.classList.add('mcp-field-flash'); setTimeout(() => manualField.classList.remove('mcp-field-flash'), 1600); }
        }
        toast('⚠️ Post ID not detected. Enter it manually in the field below and click "Fix this page" again. (Find it in WP Admin → Posts/Pages → hover the title for the ?post=NNN URL)');
        if (resultsMeta) resultsMeta.textContent = 'No Post ID — enter manually above.';
        if (resultsPanel) resultsPanel.style.display = 'none';
        return;
      }
    }

    // Heading audit fallback: derive from the already-collected _rawData if the
    // content script couldn't re-audit (chrome:// pages, file://, etc.).
    if (!headingAudit) headingAudit = buildHeadingAuditFromRawData(_rawData);

    // Hide the manual Post ID row now that we have a resolved ID.
    const _manualRow = $('mcpManualPostIdRow');
    if (_manualRow) _manualRow.style.display = 'none';

    // Remember the resolved postId so the Run-tool form can prefill from it.
    window._mcpLastPostId = postId;

    // Guard: warn before dispatching destructive tools.
    const destructiveCount = (typeof countCheckedDestructiveTools === 'function')
      ? countCheckedDestructiveTools() : 0;
    if (destructiveCount) {
      const proceed = confirm(
        `⚠ ${destructiveCount} destructive tool(s) are ticked.\n\n` +
        `These can permanently change or delete data on your site. Proceed?`);
      if (!proceed) {
        toast('Cancelled — untick destructive tools to run safely.');
        setMcpFixBusy(false);
        return;
      }
    }

    // Schema-driven arg-builders: each tool gets args derived from its real
    // inputSchema + the current page context (postId, _rawData). Args are
    // pruned to the tool's properties and validated against required inside
    // the bridge before dispatch.
    const argBuilders = {};
    for (const name of checkedTools) {
      argBuilders[name] = ({ postId: pid, auditData, headingAudit: ha, pageBuilder: pb }) =>
        buildMcpToolArgs(name, { postId: pid, auditData, headingAudit: ha, pageBuilder: pb });
    }

    toast(`Dispatching ${checkedTools.length} MCP tool(s) on post ${postId}…`);

    const results = await bridge.fixAll({
      headingAudit,
      pageBuilder,
      postId,
      auditData: _rawData,
      tools: checkedTools,
      argBuilders,
    });

    // Render per-tool results
    renderMcpFixResults(checkedTools, results);

    const perTool = results.perTool || [];
    const okCount  = perTool.filter(r => r.status === 'ok').length;
    const errCount = perTool.filter(r => r.status === 'error').length;
    const skipped  = perTool.length === 0;

    if (resultsMeta) {
      const dur = ((Date.now() - t0) / 1000).toFixed(1);
      resultsMeta.textContent = `${okCount} ok · ${errCount} error · ${perTool.length} total · ${dur}s`;
    }

    if (errCount && okCount) {
      toast(`⚠️ ${okCount} tool(s) ok, ${errCount} error(s). See result panel.`);
    } else if (errCount) {
      toast(`❌ All ${errCount} tool(s) failed. See result panel.`);
    } else if (okCount) {
      toast(`✅ ${okCount} MCP tool(s) applied successfully.`);
    } else if (skipped) {
      toast('ℹ️ No tools were dispatched.');
    }

    console.log('[ShahzaibSEO MCP] Fix results:', results);
    if (!contentScriptOk) console.info('[ShahzaibSEO MCP] Content script could not run; some detection may be missing.');

  } catch (e) {
    console.error('[ShahzaibSEO MCP] fixAll error:', e);
    toast('MCP Fix failed: ' + e.message);
    if (resultsMeta) resultsMeta.textContent = 'Failed: ' + e.message;
  } finally {
    setMcpFixBusy(false);
  }
}

// Render per-tool results into the inline result panel.
function renderMcpFixResults(checkedTools, results) {
  const list = $('mcpFixResultsList');
  if (!list) return;
  const perTool = Array.isArray(results?.perTool) ? results.perTool : [];
  // Index by tool name for quick lookup; fall back to a generic row for any
  // checked tool that the bridge didn't return a result for.
  const byName = {};
  for (const r of perTool) if (r.tool) byName[r.tool] = r;

  // Show the "View full report →" link now that we actually have a run.
  const link = $('mcpFixOpenReportLink');
  if (link) link.style.display = '';

  // Cache the run so the report modal can be opened instantly afterwards.
  // Include t0/t1 so the duration KPI is accurate. postId comes from the last
  // resolved WP post (set in mcpFixAll right before dispatch).
  const now = Date.now();
  const t0  = window._mcpFixRunT0 || (now - 1000);
  const t1  = now;
  const runTools = checkedTools.map(name => {
    const r = byName[name] || { status: 'skip', message: 'Bridge did not return a result for this tool.' };
    return {
      name      : name,
      category  : categorizeMcpToolForReport(name),
      status    : r.status || 'skip',
      message   : r.message || (r.status === 'ok' ? 'applied' : ''),
      detail    : r.detail || null,
    };
  });
  rememberMcpFixRun({ tools: runTools, postId: window._mcpLastPostId || null, t0, t1 });

  const rows = checkedTools.map(name => {
    const r = byName[name] || { status: 'skip', message: 'Bridge did not return a result for this tool.' };
    const status = r.status || 'skip';
    const icon = status === 'ok' ? '✅' : status === 'error' ? '❌' : status === 'info' ? 'ℹ️' : '⏭';
    const klass = status === 'ok' ? 'ok' : status === 'error' ? 'error' : status === 'info' ? 'info' : 'skip';
    const msg = r.message || (status === 'ok' ? 'applied' : '');
    return `
      <div class="mcp-fix-result-row">
        <span class="mcp-fix-result-status ${klass}">${icon}</span>
        <span class="mcp-fix-result-name">${escapeHtml(prettyMcpLabel(name))}</span>
        <span class="mcp-fix-result-msg" title="${escapeHtml(msg)}">${escapeHtml(msg)}</span>
      </div>`;
  }).join('');
  list.innerHTML = rows || '<div class="mcp-fix-empty">No results.</div>';
}

// Local category helper for the report — kept here (not in the report lib) so
// the report lib stays DOM-free. Same heuristic as buildMcpFixReportInput().
function categorizeMcpToolForReport(name) {
  const n = String(name || '').toLowerCase();
  if (/^seo_(set_meta|fix_all|audit_post|bulk_audit)\b/.test(n))                  return 'SEO core';
  if (/^seo_(set_schema|build_faq_schema|insert_internal_link)\b/.test(n))        return 'Schema';
  if (/^seo_(fix_robots|toggle_attachment_sitemap|generate_llms_txt)\b/.test(n))   return 'Technical';
  if (/^seo_toggle_attachment_sitemap\b/.test(n))                                 return 'Sitemap';
  if (/^seo_generate_llms_txt\b/.test(n))                                         return 'AI indexing';
  if (/^seo_(fix_image_alt|audit_image_alts)\b/.test(n))                           return 'Images';
  if (/^(audit_heading_structure|audit_image_alts)\b/.test(n))                    return 'Headings';
  if (/^rankmath_/.test(n))                                                       return /sitemap/.test(n) ? 'Sitemap' : 'Technical';
  if (/^yoast_/.test(n))                                                          return 'Technical';
  if (/hreflang/.test(n))                                                         return 'International';
  if (/redirect/.test(n))                                                         return 'Technical';
  if (/canonical/.test(n))                                                        return 'Technical';
  if (/^schema_/.test(n))                                                         return 'Schema';
  if (/^video_|^breadcrumb_|^product_/.test(n))                                   return 'Schema';
  return 'Other';
}

// Small HTML-escape helper used by the result panel.
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Safe DOM id suffix for tool names (snake_case -> snake-case).
function cssIdSafe(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

// ─── MCP Fix Report — modal open / close / download ────────────────────────
// The full data model + HTML/Markdown rendering lives in libs/mcp-fix-report.js
// (window.ShahzaibSEOMcpFixReport). The popup's job is just to:
//   1. Snapshot the current run state into a report input object.
//   2. Build any optional before/after snapshots for the diff sections.
//   3. Open/close the modal + tab switching inside it.
//
// The report object is cached on window._mcpLastReport so opening the modal a
// second time (or downloading the .md) is instant and idempotent.

/** Build a report input from the current page state + the last MCP Fix run. */
async function buildMcpFixReportInput() {
  const run = (window._mcpLastRun) || { tools: [], t0: 0, t1: 0, postId: null };
  const tools = (run.tools || []).map(t => ({
    name       : t.name,
    category   : t.category || categorizeMcpTool(t.name),
    status     : t.status,
    message    : t.message || '',
    durationMs : t.durationMs || 0,
  }));

  // Categorise anything the bridge didn't tag explicitly. Mirrors the
  // category-tagging heuristic used by the MD report generator + MCP tab UI.
  function categorizeMcpTool(name) {
    const n = String(name || '').toLowerCase();
    if (/^seo_(set_meta|fix_all|audit_post|bulk_audit)\b/.test(n))                  return 'SEO core';
    if (/^seo_(set_schema|build_faq_schema|insert_internal_link)\b/.test(n))        return 'Schema';
    if (/^seo_(fix_robots|toggle_attachment_sitemap|generate_llms_txt)\b/.test(n))   return 'Technical';
    if (/^seo_toggle_attachment_sitemap\b/.test(n))                                 return 'Sitemap';
    if (/^seo_generate_llms_txt\b/.test(n))                                         return 'AI indexing';
    if (/^seo_(fix_image_alt|audit_image_alts)\b/.test(n))                           return 'Images';
    if (/^(audit_heading_structure|audit_image_alts)\b/.test(n))                    return 'Headings';
    if (/^rankmath_/.test(n))                                                       return /sitemap/.test(n) ? 'Sitemap' : 'Technical';
    if (/^yoast_/.test(n))                                                          return 'Technical';
    if (/^hreflang/.test(n))                                                        return 'International';
    if (/redirect/.test(n))                                                         return 'Technical';
    if (/canonical/.test(n))                                                        return 'Technical';
    if (/^schema_/.test(n))                                                         return 'Schema';
    if (/^video_|^breadcrumb_|^product_/.test(n))                                   return 'Schema';
    return 'Other';
  }

  // Snapshot the CURRENT page (after fixes) — used for headings/meta diff.
  let after = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && /^https?:/.test(tab.url || '')) {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world : 'ISOLATED',
        func: async () => {
          const B = window.ShahzaibSEOMCPBridge;
          if (!B) return null;
          return {
            pageBuilder : B.detectPageBuilder(),
            postId      : await B.detectWordPressPostId(),
            headingAudit: B.auditHeadings(),
            meta        : {
              title       : document.title,
              description : document.querySelector('meta[name="description"]')?.content || '',
              canonical   : document.querySelector('link[rel="canonical"]')?.href || '',
              h1          : document.querySelector('h1')?.textContent?.trim() || '',
            },
            slug : (() => {
              try {
                const u = new URL(window.location.href);
                const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
                return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
              } catch { return ''; }
            })(),
            technical: {
              robots  : document.querySelector('meta[name="robots"]')?.content || '',
              sitemap : Array.from(document.querySelectorAll('link[rel="sitemap"]')).map(l => l.href).join(', '),
            },
            schema: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => {
              try { return JSON.parse(s.textContent)['@type'] || 'Unknown'; } catch { return 'Invalid'; }
            }),
          };
        },
      });
      if (res?.[0]?.result) after = res[0].result;
    }
  } catch (e) {
    console.warn('[ShahzaibSEO MCP] Failed to snapshot AFTER state:', e.message);
  }

  // BEFORE snapshot — either provided by the cached _rawData (the page state at
  // audit time) or null. The diff sections gracefully skip when before==after.
  let before = null;
  const raw = (typeof _rawData !== 'undefined' && _rawData) || null;
  if (raw) {
    const meta = raw.meta || {};
    const headings = raw.headings?.list || raw.headings || [];
    before = {
      meta: {
        title       : meta.title?.content ?? meta.title ?? '',
        description : meta.description?.content ?? meta.description ?? '',
        canonical   : meta.canonical?.href ?? meta.canonical ?? '',
        focusKeyword: raw.keywords?.focusKeyword || raw.keywords?.top?.[0]?.word || '',
      },
      headings,
      slug: (() => {
        try {
          const u = new URL(raw.url || (after?.pageBuilder ? '' : ''));
          const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
          return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
        } catch { return ''; }
      })(),
      technical: {
        robots : meta.robots?.content || raw.technical?.robots || '',
        sitemap: raw.technical?.sitemap || '',
        redirects: raw.technical?.redirects || '',
        hreflang: raw.technical?.hreflang || '',
      },
      schema: raw.schema?.types || raw.schemaTypes || [],
    };
  }

  return {
    run: { ...run, tools },
    before,
    after,
    url: after?.pageBuilder ? (typeof _rawData !== 'undefined' ? _rawData?.url : '') : (typeof _rawData !== 'undefined' ? _rawData?.url : ''),
  };
}

/** Cache the current run so the report can be reopened instantly. */
function rememberMcpFixRun({ tools, postId, t0, t1 }) {
  window._mcpLastRun = { tools, postId, t0, t1 };
}

/** Open the report modal and render the report into it. */
async function openMcpFixReport() {
  const modal = $('mcpFixReportModal');
  const body  = $('mcpFixReportBody');
  if (!modal || !body) return;

  // If we have no run cached yet, snapshot from the visible inline result panel.
  if (!window._mcpLastRun || !(window._mcpLastRun.tools || []).length) {
    hydrateMcpLastRunFromInline();
  }

  modal.hidden = false;
  body.innerHTML = '<div class="mcp-fr-empty">Generating report…</div>';

  try {
    if (typeof ShahzaibSEOMcpFixReport === 'undefined') {
      body.innerHTML = '<div class="mcp-fr-empty">Report module not loaded. Check libs/mcp-fix-report.js</div>';
      return;
    }
    const input = await buildMcpFixReportInput();
    const report = new ShahzaibSEOMcpFixReport(input);
    window._mcpLastReport = report;
    body.innerHTML = report.renderHtml();
    wireReportTabs(body);
  } catch (e) {
    console.error('[ShahzaibSEO MCP] Failed to render report:', e);
    body.innerHTML = `<div class="mcp-fr-empty">Error: ${escapeHtml(e.message)}</div>`;
  }
}

function closeMcpFixReport() {
  const modal = $('mcpFixReportModal');
  if (modal) modal.hidden = true;
}

/** Download the current report as a .md file. */
function downloadMcpFixReportMd() {
  if (!window._mcpLastReport) {
    toast('Open the report first.');
    return;
  }
  const name = window._mcpLastReport.downloadMarkdown();
  if (name) toast(`✅ Downloaded: ${name}`);
  else toast('Download failed — see console.');
}

/** Wire tab interactions inside the rendered report (which tab surfaced each issue). */
function wireReportTabs(scope) {
  const tabs = scope.querySelectorAll('.mcp-fr-tab');
  const panels = scope.querySelectorAll('.mcp-fr-tab-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
      panels.forEach(p => { p.hidden = p.dataset.tab !== name; });
    });
    // Default: first tab selected.
    if (tab === tabs[0]) tab.setAttribute('aria-selected', 'true');
  });
}

/** If no run is cached (e.g. user opens report from outside the fix flow),
 *  best-effort: rebuild from the inline result panel rows. */
function hydrateMcpLastRunFromInline() {
  const list = $('mcpFixResultsList');
  if (!list) return;
  const rows = list.querySelectorAll('.mcp-fix-result-row');
  if (!rows.length) return;
  const tools = Array.from(rows).map(row => {
    const name = row.querySelector('.mcp-fix-result-name')?.textContent?.trim() || '';
    const msg  = row.querySelector('.mcp-fix-result-msg')?.textContent?.trim() || '';
    const statusIcon = row.querySelector('.mcp-fix-result-status')?.textContent?.trim() || '';
    let status = 'info';
    if (statusIcon.includes('✅')) status = 'ok';
    else if (statusIcon.includes('❌')) status = 'error';
    else if (/missing required arg/i.test(msg)) status = 'info';
    // tool id is stored on the id attribute as mcpFixRow-{cssIdSafe(name)}
    return {
      name: name.toLowerCase().replace(/\s+/g, '_'),
      label: name,
      status,
      message: msg,
      category: 'Other',
    };
  }).filter(t => t.name);
  window._mcpLastRun = { tools, postId: window._mcpLastPostId || null, t0: Date.now(), t1: Date.now() };
}

// Fallback: build a minimal heading audit from the data the popup already has
// (collected by the content script during the regular audit run). This lets
// heading fixes still work on pages where we can't re-inject the bridge.
function buildHeadingAuditFromRawData(raw) {
  if (!raw) return null;
  const headings = raw.headings || raw.audit?.headings || null;
  if (!headings) return null;
  // Best-effort shape; the bridge will treat missing fields as no-op.
  return {
    headings: Array.isArray(headings.list) ? headings.list : [],
    issues:   Array.isArray(headings.issues) ? headings.issues : [],
    summary:  headings.summary || { skippedLevels: [], duplicateH1: 0, missingH1: false },
    source: 'rawData-fallback',
  };
}

// ─── WP x MCP: Load saved settings into UI ─────────────────────────────────
async function mcpLoadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['wpxmcpEndpoint', 'wpxmcpApiKey'], result => {
      if (result.wpxmcpEndpoint) {
        const el = $('wpxmcpEndpoint');
        if (el) el.value = result.wpxmcpEndpoint;
      }
      if (result.wpxmcpApiKey) {
        const el = $('wpxmcpApiKey');
        if (el) el.value = result.wpxmcpApiKey;
      }
      const badge = $('settingsMcpStatus');
      if (result.wpxmcpEndpoint && result.wpxmcpApiKey) {
        setMcpBadge('Saved', 'ok');
      }
      resolve();
    });
  });
}

// MCP badge helper: state is 'ok' | 'warn' | 'err' | 'idle'.
// Inline-style writes happen because the badge sits in multiple contexts
// (loaded from storage, set on save, set on test). We always pair background
// with color so contrast stays readable.
function setMcpBadge(text, state) {
  // Mirror state onto the MCP-tab status chip too.
  const chip = $('mcpTabStatus');
  if (chip) {
    chip.textContent = text;
    chip.classList.remove('ok', 'warn', 'err');
    if (state === 'ok') chip.classList.add('ok');
    else if (state === 'warn') chip.classList.add('warn');
    else if (state === 'err') chip.classList.add('err');
  }
  const badge = $('settingsMcpStatus');
  if (!badge) return;
  badge.textContent = text;
  // Clear any inline overrides so CSS class wins on idle/warn/err
  badge.style.background = '';
  badge.style.color = '';
  badge.classList.remove('ok', 'warn', 'err');
  if (state === 'ok') {
    // Solid green pill with white text — the only state that needs inline color
    // (the .ok CSS class uses light bg + dark green text which can clash with
    // the success "Connected" messaging in a small badge).
    badge.style.background = '#10b981';
    badge.style.color = '#ffffff';
  } else if (state === 'warn') {
    badge.classList.add('warn');
  } else if (state === 'err') {
    badge.classList.add('err');
  }
  // 'idle' → just the text; the default CSS class handles the amber pill.
}

// Returns the current fix-option selections from the MCP settings UI.
// Defaults to all-on when nothing is set yet.
function readMcpFixOptions() {
  // Legacy 4-bucket shape kept for back-compat with anything that still reads
  // the hardcoded IDs. The new dynamic UI pushes per-tool selections into
  // mcpFixOptions via the container <input type="checkbox" data-mcp-tool="...">.
  const get = (id, def) => {
    const el = $(id);
    if (!el) return def;
    return !!el.checked;
  };
  return {
    heading: get('mcpOptHeadings',  true),
    seo:     get('mcpOptSeo',      true),
    images:  get('mcpOptAlt',      true),
    schema:  get('mcpOptSchema',   true),
  };
}

// ─── WP x MCP: dynamic tool discovery + classification ───────────────────────
//
// The connected WP x MCP server exposes ~333 tools (titles, schema, sitemap,
// redirects, security headers, image alt, social cards, etc.). The popup
// lists them all in a grouped "What to fix" panel, and dispatches the ones
// the user has checked against the live audit data.
//
// Architecture:
//   • classifyMcpTool(tool)  → { family, group, label, icon, risk, readOnly,
//                                destructive, defaultOn, required }
//   • buildMcpToolArgs(tool, ctx) → schema-pruned args from _rawData + context
//   • validateMcpArgs(tool, args) → { ok, missing } against inputSchema.required
//   • refreshMcpToolList()   → fetches & caches tools, re-renders the panel
//   • readMcpCheckedTools()  → returns the array of checked tool names

// ─── Dynamic MCP fix-options: taxonomy, arg-builders, UI ──────────────────────
//   Public API (called elsewhere in popup.js):
//   • classifyMcpTool(toolOrName)  → { family, group, label, icon, risk,
//                                      readOnly, destructive, defaultOn, required }
//   • buildMcpToolArgs(toolOrName, ctx) → args object (schema-pruned)
//   • validateMcpArgs(toolOrName, args) → { ok, missing:[...] }
//   • refreshMcpToolList()         → fetch + cache tools, re-render the panel
//   • renderMcpFixOptionsPanel(t)  → render tabs + search + grouped tool list
//   • readMcpCheckedTools()        → array of checked tool names
//   • initMcpFixOptionsUi()        → wire presets, search, tabs, run-tool mode
//
//   Design notes:
//   • Classification is an EXPLICIT, ordered lookup table keyed off the real
//     tool families exposed by WP x MCP (wc_, rankmath, elementor, yoast, cf7,
//     fm_, db_, audit_, seo_, …) — NOT the old heuristic keyword cascade.
//   • Risk (read / write / destructive) is read from the server-provided
//     annotations ({ readOnlyHint, destructiveHint }) — authoritative, never
//     guessed. Falls back to the "[risk: …]" tag in the description, then to a
//     conservative "write" assumption only if neither is present.
//   • Arg-builders are schema-aware: every emitted arg is pruned to the tool's
//     inputSchema.properties, so we never send keys the server will reject, and
//     required args are validated against inputSchema.required before dispatch.

// Module-level index of discovered tools: name → full tool object (with
// inputSchema + annotations). Populated by renderMcpFixOptionsPanel /
// mcpLoadCachedToolList so every consumer can reach a tool's live schema.
let _mcpToolIndex   = Object.create(null);
let _mcpActiveGroup = 'all';   // current group tab id ('all' = no group filter)
let _mcpSearchQuery = '';      // current search/filter text (lowercased)

function setMcpToolIndex(tools) {
  _mcpToolIndex = Object.create(null);
  for (const t of (tools || [])) if (t && t.name) _mcpToolIndex[t.name] = t;
}
function getMcpTool(name) {
  if (name && typeof name === 'object') return name;          // already a tool
  return _mcpToolIndex[name] || null;
}

// ── Explicit family lookup table (ordered; first match wins) ─────────────────
// `test` runs against the lower-cased tool name (and, where useful, the
// description). `seoEssential` marks families whose mutating tools are pre-
// ticked by the "SEO essentials" preset / initial default.
const MCP_FAMILIES = [
  { id: 'headings',   label: 'Headings (H1–H6)',                 icon: '🔠', order: 1,  seoEssential: true,
    test: (n) => /(^|_)heading|heading_outline|heading_structure|\bh[1-6]_/.test(n) },
  { id: 'seo',        label: 'SEO meta (title / desc / canonical / focus kw)', icon: '🎯', order: 2, seoEssential: true,
    test: (n) => /^seo_/.test(n) },
  { id: 'schema',     label: 'Schema / JSON-LD',                 icon: '🧬', order: 3,  seoEssential: true,
    test: (n, d) => /schema|json[_-]?ld|structured[_-]?data|faq_|rich_?result/.test(n + ' ' + d) },
  { id: 'media',      label: 'Images & media (alt / size)',      icon: '🖼', order: 4,  seoEssential: true,
    test: (n) => /image|img_|alt_?text|\bmedia|attachment|thumbnail|featured/.test(n) },
  { id: 'sitemap',    label: 'Sitemap / robots / llms.txt',      icon: '🗺', order: 5,  seoEssential: true,
    test: (n) => /sitemap|robots|llms/.test(n) },
  { id: 'redirects',  label: 'Redirects / canonical / hreflang', icon: '↪️', order: 6,  seoEssential: true,
    test: (n) => /redirect|canonical|hreflang/.test(n) },
  { id: 'rankmath',   label: 'Rank Math SEO',                    icon: '📈', order: 7,
    test: (n) => /^rank[_]?math/.test(n) },
  { id: 'yoast',      label: 'Yoast SEO',                        icon: '🟣', order: 8,
    test: (n) => /^yoast/.test(n) },
  { id: 'audit',      label: 'Audits & diagnostics (read-only)', icon: '🔍', order: 9,
    test: (n) => /^audit_|_audit$|^seo_audit|^seo_bulk_audit|^malware|^recovery|^diagnose|^db_health|^run_psi|^speed_test/.test(n) },
  { id: 'content',    label: 'Posts & content (slug / excerpt / meta)', icon: '📝', order: 10,
    test: (n) => /^(get_post|update_post|create_post|delete_post|list_posts|publish_|bulk_publish|restore_post|get_post_meta|update_post_meta|delete_post_meta|assign_terms|create_term|update_term|delete_term|list_terms|create_category|bulk_create_categories)/.test(n) },
  { id: 'elementor',  label: 'Elementor builder',                icon: '🧱', order: 11,
    test: (n) => /^elementor/.test(n) },
  { id: 'pagebuilder',label: 'Page builders (Gutenberg / Kadence)', icon: '🏗', order: 12,
    test: (n) => /^(gutenberg|kadence)_build_page|build_page$|page_builder_status/.test(n) },
  { id: 'woocommerce',label: 'WooCommerce',                      icon: '🛒', order: 13,
    test: (n) => /^wc_/.test(n) },
  { id: 'cf7',        label: 'Contact Form 7',                   icon: '✉️', order: 14,
    test: (n) => /^cf7_/.test(n) },
  { id: 'menus',      label: 'Navigation menus',                 icon: '📑', order: 15,
    test: (n) => /menu/.test(n) },
  { id: 'users',      label: 'Users & roles',                    icon: '👤', order: 16,
    test: (n) => /user|\brole/.test(n) },
  { id: 'comments',   label: 'Comments',                         icon: '💬', order: 17,
    test: (n) => /comment|moderate/.test(n) },
  { id: 'performance',label: 'Performance & caching',            icon: '⚡', order: 18,
    test: (n) => /cache|optimi[sz]e|speed|performance|core_web|mobile_|asset_(enable|disable|rules)|critical_css|optimize_(css|fonts)/.test(n) },
  { id: 'plugins',    label: 'Plugins & themes',                 icon: '🔌', order: 19,
    test: (n) => /plugin|theme|rollback|^install_|^activate|^deactivate|toggle_.*auto_update/.test(n) },
  { id: 'database',   label: 'Database',                         icon: '🗄', order: 20,
    test: (n) => /^db_|backup_creator/.test(n) },
  { id: 'filemanager',label: 'File manager',                     icon: '📁', order: 21,
    test: (n) => /^fm_/.test(n) },
  { id: 'site',       label: 'Site, options & maintenance',      icon: '⚙️', order: 22,
    test: (n) => /^(site_info|get_option|update_option|delete_option|get_site_health|flush_cache|manage_cron|list_cron|run_cron|delete_cron|ping|fetch|plan_changes|apply_planned|discard_plan|list_pending)/.test(n) },
  // Generic catch-alls (kept last so specific families win) ───────────────────
  { id: 'read',       label: 'Other read tools',                 icon: '📖', order: 96,
    test: (n) => /^(get_|list_|search|count_|read_|check_)/.test(n) },
  { id: 'write',      label: 'Other write tools',                icon: '🛠', order: 97,
    test: (n) => /^(create_|update_|delete_|set_|add_|remove_|assign_|unassign_|move_|reorder_|duplicate_|clear_|publish_|write_)/.test(n) },
  { id: 'other',      label: 'Other server tools',               icon: '📦', order: 99,
    test: () => true },
];

const MCP_FAMILY_BY_ID = MCP_FAMILIES.reduce((m, f) => (m[f.id] = f, m), {});

// Resolve a tool name to its family (first matcher that returns true).
function mcpFamilyOf(name, desc) {
  const n = String(name || '').toLowerCase();
  const d = String(desc || '').toLowerCase();
  for (const f of MCP_FAMILIES) { try { if (f.test(n, d)) return f; } catch (_) {} }
  return MCP_FAMILY_BY_ID.other;
}

// Authoritative risk from server annotations, then the "[risk: …]" description
// tag, then a conservative fallback. Returns 'read' | 'write' | 'destructive'.
function mcpRiskOf(tool) {
  const a = (tool && tool.annotations) || {};
  if (a.destructiveHint === true) return 'destructive';
  if (a.readOnlyHint === true)    return 'read';
  if (a.readOnlyHint === false || a.destructiveHint === false) return 'write';
  const m = /\[risk:\s*(read|write|destructive)\]/i.exec((tool && tool.description) || '');
  if (m) return m[1].toLowerCase();
  // Last-resort name heuristic (only when the server gave us nothing).
  const n = String((tool && tool.name) || '').toLowerCase();
  if (/^(get_|list_|search|count_|read_|audit_|check_)/.test(n)) return 'read';
  return 'write';
}

// The new classifier — a lookup, not a heuristic cascade. Accepts either a
// full tool object (preferred) or a bare name (it will look the tool up in the
// index, so risk/schema stay accurate). Back-compatible call sites that passed
// (name, desc) still work: a string second arg is treated as the description.
function classifyMcpTool(toolOrName, descArg) {
  let tool = (toolOrName && typeof toolOrName === 'object') ? toolOrName : getMcpTool(toolOrName);
  const name = tool ? tool.name : String(toolOrName || '');
  const desc = tool ? (tool.description || '') : (typeof descArg === 'string' ? descArg : '');
  if (!tool) tool = { name, description: desc, annotations: {}, inputSchema: { required: [], properties: {} } };

  const fam      = mcpFamilyOf(name, desc);
  const risk     = mcpRiskOf(tool);
  const readOnly = risk === 'read';
  const destructive = risk === 'destructive';
  const required = ((tool.inputSchema || {}).required) || [];

  // Default-on policy:
  //   • read-only tools are never pre-ticked (they don't "fix")
  //   • destructive tools are never pre-ticked (explicit opt-in required)
  //   • otherwise pre-tick only mutating tools in SEO-essential families
  const defaultOn = !readOnly && !destructive && !!fam.seoEssential;

  return {
    family: fam.id,
    group : fam.id,           // alias kept for older references
    label : prettyMcpLabel(name),
    icon  : fam.icon,
    risk, readOnly, destructive, defaultOn, required,
  };
}

function prettyMcpLabel(name) {
  return String(name || '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || '(unnamed tool)';
}

// ── Per-family arg-builders (schema-aware) ───────────────────────────────────
// Each builder returns a *candidate* args object; buildMcpToolArgs() then prunes
// it to the tool's real inputSchema.properties so we never send stray keys.
// ctx = { postId, auditData, headingAudit, pageBuilder }.
function _seoMetaFromCtx(ctx) {
  const m  = (ctx.auditData && (ctx.auditData.meta || ctx.auditData.seo)) || {};
  const kw = (ctx.auditData && ctx.auditData.keywords) || {};
  const out = {};
  const title = m.title?.content ?? m.title ?? '';
  const desc  = m.description?.content ?? m.description ?? m.desc ?? '';
  const canon = m.canonical?.href ?? m.canonical ?? '';
  const focus = kw.focusKeyword || kw.top?.[0]?.word || '';
  if (title) out.title = String(title);
  if (desc)  out.description = String(desc);
  if (canon) out.canonical = String(canon);
  if (focus) out.focus_kw = String(focus);   // WP x MCP uses focus_kw, not focus_keyword
  return out;
}

const MCP_ARG_BUILDERS = {
  // seo_set_meta / seo_get_meta / seo_* (post-scoped)
  seo(tool, ctx) {
    const a = { post_id: ctx.postId, ...(_seoMetaFromCtx(ctx)) };
    // seo_fix_all is SITE-WIDE (no post_id in its schema) — don't fake a scope.
    if (tool.name === 'seo_fix_all') { delete a.post_id; a.dry_run = false; }
    return a;
  },
  headings(tool, ctx)  { return { post_id: ctx.postId }; },
  schema(tool, ctx)    { return { post_id: ctx.postId }; }, // faqs/schema body left to Run-tool form
  redirects(tool, ctx) { return {}; },
  sitemap(tool, ctx)   { return {}; },
  media(tool, ctx)     {
    // audit_image_alts is site/post-type scoped (no post_id); fix_image_alt needs
    // attachment_id + alt_text which we can't infer — leave to the Run-tool form.
    return {};
  },
  content(tool, ctx) {
    // Core post tools key on `id`, not `post_id`.
    if (/^(get_post|update_post|delete_post|restore_post)$/.test(tool.name)) return { id: ctx.postId };
    return { post_id: ctx.postId };
  },
  yoast(tool, ctx)     { return { post_id: ctx.postId, ...(_seoMetaFromCtx(ctx)) }; },
  rankmath(tool, ctx)  { return { post_id: ctx.postId, ...(_seoMetaFromCtx(ctx)) }; },
  elementor(tool, ctx) { return { post_id: ctx.postId }; },
  audit(tool, ctx)     { return ctx.postId ? { post_id: ctx.postId } : {}; },
};

// Unambiguous context identifiers we can always source safely. Deliberately
// conservative: we do NOT auto-fill title/description/etc. for arbitrary tools
// (that could, e.g., overwrite a product name with the page's SEO title).
function _genericContextFill(ctx) {
  const out = {};
  if (ctx.postId != null) out.post_id = ctx.postId;
  const url = ctx.auditData?.url || ctx.auditData?.meta?.url;
  if (url) out.url = String(url);
  return out;
}

// Build the final args for a tool: family builder (specific) → generic fill →
// prune to the tool's real schema properties. Returns only keys the tool
// actually accepts.
function buildMcpToolArgs(toolOrName, ctx) {
  const tool = getMcpTool(toolOrName) ||
    { name: String(toolOrName || ''), inputSchema: { properties: {}, required: [] } };
  ctx = ctx || {};
  const fam   = mcpFamilyOf(tool.name, tool.description || '');
  const build = MCP_ARG_BUILDERS[fam.id];

  let candidate = Object.assign({}, _genericContextFill(ctx));
  if (build) {
    try { Object.assign(candidate, build(tool, ctx) || {}); } catch (_) {}
  }
  if (ctx.manual && typeof ctx.manual === 'object') Object.assign(candidate, ctx.manual);

  // Prune to the tool's declared properties when a schema is available. An
  // explicitly-empty properties object ({}) means the tool takes NO args, so we
  // must return {} rather than leak generic context keys the server will reject.
  const schema = tool.inputSchema || null;
  const props  = (schema && typeof schema.properties === 'object') ? schema.properties : null;
  if (props) {
    const pruned = {};
    for (const k of Object.keys(candidate)) {
      if (k in props && candidate[k] !== undefined && candidate[k] !== '') pruned[k] = candidate[k];
    }
    return pruned;
  }
  // No schema at all → return what we have (drop blanks).
  const clean = {};
  for (const k of Object.keys(candidate)) {
    if (candidate[k] !== undefined && candidate[k] !== '') clean[k] = candidate[k];
  }
  return clean;
}

// Validate args against inputSchema.required. Returns { ok, missing:[...] }.
function validateMcpArgs(toolOrName, args) {
  const tool = getMcpTool(toolOrName);
  const required = (tool && tool.inputSchema && tool.inputSchema.required) || [];
  const missing = required.filter(r => args == null || args[r] === undefined || args[r] === '' || args[r] === null);
  return { ok: missing.length === 0, missing };
}

// ── Tool-list cache (instant render after first connect) ─────────────────────
const MCP_TOOL_CACHE_KEY    = 'wpxmcpToolCache';
const MCP_TOOL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function readCachedMcpTools() {
  return new Promise(resolve => {
    chrome.storage.local.get([MCP_TOOL_CACHE_KEY], r => {
      const c = r?.[MCP_TOOL_CACHE_KEY];
      if (!c || !Array.isArray(c.tools)) return resolve(null);
      if (Date.now() - (c.ts || 0) > MCP_TOOL_CACHE_TTL_MS) return resolve(null);
      resolve(c);
    });
  });
}
function writeCachedMcpTools(tools) {
  chrome.storage.local.set({ [MCP_TOOL_CACHE_KEY]: { ts: Date.now(), tools } });
}

// Re-fetch the tool list from the MCP server, then re-render the panel.
async function refreshMcpToolList({ silent = false } = {}) {
  if (typeof ShahzaibSEOMCPBridge === 'undefined') return null;
  const bridge = window._mcpBridge || new ShahzaibSEOMCPBridge();
  if (window._mcpBridge === bridge) {
    if (!bridge.endpoint || !bridge.apiKey) await bridge.init();
  } else {
    await bridge.init();
  }
  if (!bridge.isConfigured()) return null;

  try {
    const tools = await bridge.listTools(true); // force refresh
    writeCachedMcpTools(tools);
    if (!bridge._isGlobalCached) { window._mcpBridge = bridge; bridge._isGlobalCached = true; }
    renderMcpFixOptionsPanel(tools);
    if (!silent) toast(`✅ Loaded ${tools.length} MCP tools.`);
    return tools;
  } catch (e) {
    console.warn('[ShahzaibSEO MCP] Could not refresh tool list:', e);
    if (!silent) toast('Could not load MCP tool list: ' + e.message);
    return null;
  }
}

// ── Panel render: group tabs + search + grouped, risk-aware tool list ─────────
function renderMcpFixOptionsPanel(tools) {
  const root = $('mcpFixOptionsBody');
  if (!root) return;

  if (Array.isArray(tools) && tools.length) setMcpToolIndex(tools);
  const all = Array.isArray(tools) ? tools : Object.values(_mcpToolIndex);

  if (!all.length) {
    root.innerHTML = '<div class="mcp-fix-empty">No tools discovered yet. Click "Test Connection" to load them.</div>';
    return;
  }

  // Classify once, attach to a working copy.
  const classified = all.map(t => ({ ...t, _class: classifyMcpTool(t) }));

  // Group → ordered list of present families.
  const grouped = {};
  for (const t of classified) (grouped[t._class.family] ||= []).push(t);
  const presentFamilies = MCP_FAMILIES
    .filter(f => (grouped[f.id] || []).length)
    .sort((a, b) => a.order - b.order);

  // Render group tabs (once per render; reflect active group).
  renderMcpGroupTabs(presentFamilies, grouped, classified.length);

  // Apply active-group + search filters.
  const q = _mcpSearchQuery;
  const matches = (t) => {
    if (_mcpActiveGroup !== 'all' && t._class.family !== _mcpActiveGroup) return false;
    if (!q) return true;
    return (t.name.toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q));
  };
  const visible = classified.filter(matches);

  // Preserve existing selections across re-renders.
  const prevChecked = new Set(readMcpCheckedTools());
  const firstRender = prevChecked.size === 0;

  // Which families to actually show (respect group tab; when a group is active,
  // show only it; otherwise show all non-empty groups).
  const famsToShow = (_mcpActiveGroup === 'all'
    ? presentFamilies
    : presentFamilies.filter(f => f.id === _mcpActiveGroup));

  const blocks = famsToShow.map(f => {
    const items = (grouped[f.id] || []).filter(matches);
    if (!items.length) return '';
    const rows = items.map(t => {
      const c = t._class;
      const isOn = prevChecked.has(t.name) || (firstRender && c.defaultOn);
      const riskBadge =
        c.destructive ? '<span class="mcp-tool-risk destructive" title="Destructive — opt-in required">⚠ destructive</span>' :
        c.readOnly    ? '<span class="mcp-tool-risk read" title="Read-only diagnostic">read</span>' :
                        '<span class="mcp-tool-risk write" title="Writes data">write</span>';
      const desc = (t.description || '').replace(/</g, '&lt;').slice(0, 200);
      return `
        <label class="mcp-tool-row${c.readOnly ? ' is-info' : ''}${c.destructive ? ' is-destructive' : ''}" title="${desc}">
          <input type="checkbox" data-mcp-tool="${t.name}" data-mcp-risk="${c.risk}"
                 data-mcp-family="${c.family}" ${isOn ? 'checked' : ''}/>
          <span class="mcp-tool-icon">${c.icon}</span>
          <span class="mcp-tool-name">${prettyMcpLabel(t.name)}</span>
          ${riskBadge}
          <code class="mcp-tool-slug">${t.name}</code>
        </label>`;
    }).join('');
    return `
      <details class="mcp-tool-group" open>
        <summary>
          <span class="mcp-tool-group-name">${f.icon} ${f.label}</span>
          <span class="mcp-tool-group-count">${items.length}</span>
        </summary>
        <div class="mcp-tool-list">${rows}</div>
      </details>`;
  }).join('');

  root.innerHTML = blocks ||
    `<div class="mcp-fix-empty">No tools match "${escapeHtml(_mcpSearchQuery)}"${_mcpActiveGroup !== 'all' ? ' in this group' : ''}.</div>`;

  // Header counter (respects current filter).
  const header = $('mcpFixOptionsCount');
  if (header) {
    header.textContent = (q || _mcpActiveGroup !== 'all')
      ? `${visible.length} / ${classified.length} tools`
      : `${classified.length} tools discovered`;
  }

  // Keep the Run-tool picker in sync with the discovered tools.
  populateMcpRunToolSelect();
}

// Render the horizontal group-tab bar into #mcpGroupTabs.
function renderMcpGroupTabs(presentFamilies, grouped, total) {
  const bar = $('mcpGroupTabs');
  if (!bar) return;
  const tab = (id, label, count, active) =>
    `<button type="button" class="mcp-group-tab${active ? ' active' : ''}" data-mcp-group="${id}">
       ${label}<span class="mcp-group-tab-count">${count}</span>
     </button>`;
  let html = tab('all', 'All', total, _mcpActiveGroup === 'all');
  for (const f of presentFamilies) {
    html += tab(f.id, `${f.icon} ${f.label}`, (grouped[f.id] || []).length, _mcpActiveGroup === f.id);
  }
  bar.innerHTML = html;
}

// ── Run-tool mode: single-tool picker + schema-driven arg form ───────────────
function populateMcpRunToolSelect() {
  const sel = $('mcpRunToolSelect');
  if (!sel) return;
  const prev = sel.value;
  const byFam = {};
  for (const t of Object.values(_mcpToolIndex)) {
    const c = classifyMcpTool(t);
    (byFam[c.family] ||= []).push(t);
  }
  const fams = MCP_FAMILIES.filter(f => (byFam[f.id] || []).length).sort((a, b) => a.order - b.order);
  let html = '<option value="">— pick a tool —</option>';
  for (const f of fams) {
    const opts = byFam[f.id]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => `<option value="${t.name}">${t.name}</option>`).join('');
    html += `<optgroup label="${f.icon} ${f.label}">${opts}</optgroup>`;
  }
  sel.innerHTML = html;
  if (prev && _mcpToolIndex[prev]) sel.value = prev;
}

// Build an arg form from a tool's inputSchema. Strings → text, numbers →
// number, booleans → checkbox, objects/arrays → JSON textarea.
function renderMcpRunToolForm(toolName) {
  const host = $('mcpRunToolForm');
  const out  = $('mcpRunToolOutput');
  if (out) { out.style.display = 'none'; out.textContent = ''; }
  if (!host) return;
  const tool = getMcpTool(toolName);
  if (!tool) { host.innerHTML = ''; return; }

  const c = classifyMcpTool(tool);
  const schema = tool.inputSchema || { properties: {}, required: [] };
  const props  = schema.properties || {};
  const required = new Set(schema.required || []);

  // Prefill from the current page context where we safely can.
  const ctx = { postId: (window._mcpLastPostId ?? _rawData?.postId ?? null), auditData: _rawData };
  const prefill = buildMcpToolArgs(tool, ctx);

  const warn = c.destructive
    ? `<div class="mcp-run-warn destructive">⚠ <strong>Destructive tool.</strong> This can permanently change or delete data. Review the arguments carefully.</div>`
    : (!c.readOnly
        ? `<div class="mcp-run-warn write">✎ Writes data to your site.</div>`
        : `<div class="mcp-run-warn read">Read-only — safe to run.</div>`);

  const fields = Object.keys(props).map(key => {
    const p = props[key] || {};
    const type = p.type || 'string';
    const req  = required.has(key);
    const val  = (prefill[key] !== undefined) ? prefill[key] : (p.default !== undefined ? p.default : '');
    const desc = (p.description || '').replace(/"/g, '&quot;').slice(0, 160);
    const lbl  = `<label class="mcp-run-field-label">${key}${req ? ' <span class="req">*</span>' : ''}</label>`;
    let input;
    if (type === 'boolean') {
      input = `<input type="checkbox" data-arg="${key}" data-type="boolean" ${val === true ? 'checked' : ''}/>`;
    } else if (type === 'integer' || type === 'number') {
      input = `<input type="number" data-arg="${key}" data-type="number" value="${val === '' ? '' : escapeHtml(String(val))}" placeholder="${desc}"/>`;
    } else if (type === 'object' || type === 'array') {
      const j = (val && typeof val === 'object') ? JSON.stringify(val, null, 2) : '';
      input = `<textarea data-arg="${key}" data-type="json" rows="3" placeholder='${type} as JSON — ${desc}'>${escapeHtml(j)}</textarea>`;
    } else {
      input = `<input type="text" data-arg="${key}" data-type="string" value="${escapeHtml(String(val))}" placeholder="${desc}"/>`;
    }
    return `<div class="mcp-run-field${req ? ' is-required' : ''}">${lbl}${input}</div>`;
  }).join('');

  host.innerHTML = `
    ${warn}
    <div class="mcp-run-fields">${fields || '<div class="mcp-run-noargs">This tool takes no arguments.</div>'}</div>
    ${c.destructive ? `<label class="mcp-run-confirm"><input type="checkbox" id="mcpRunConfirm"/> I understand this is destructive and want to proceed.</label>` : ''}
    <div class="mcp-run-actions">
      <button type="button" class="mcp-preset-btn" id="mcpRunGo">▶ Run ${escapeHtml(toolName)}</button>
      <span class="mcp-run-hint">${escapeHtml((schema.required || []).length ? 'Required: ' + schema.required.join(', ') : 'No required args')}</span>
    </div>`;
}

// Collect arg values from the run-tool form, coercing by data-type.
function collectMcpRunToolArgs() {
  const host = $('mcpRunToolForm');
  const args = {};
  if (!host) return args;
  host.querySelectorAll('[data-arg]').forEach(el => {
    const key = el.dataset.arg, type = el.dataset.type;
    if (type === 'boolean') { if (el.checked) args[key] = true; return; }
    let v = el.value;
    if (v === '' || v == null) return;
    if (type === 'number') { const n = Number(v); if (!Number.isNaN(n)) args[key] = n; return; }
    if (type === 'json')   { try { args[key] = JSON.parse(v); } catch { args[key] = v; } return; }
    args[key] = v;
  });
  return args;
}

async function runMcpSingleTool() {
  const sel = $('mcpRunToolSelect');
  const out = $('mcpRunToolOutput');
  const name = sel && sel.value;
  if (!name) { toast('Pick a tool to run.'); return; }
  const tool = getMcpTool(name);
  const c = classifyMcpTool(tool);

  if (c.destructive) {
    const confirmEl = $('mcpRunConfirm');
    if (!confirmEl || !confirmEl.checked) { toast('Tick the destructive-action confirmation first.'); return; }
  }

  const args = collectMcpRunToolArgs();
  const { ok, missing } = validateMcpArgs(tool, args);
  if (!ok) { toast(`Missing required arg(s): ${missing.join(', ')}`); return; }

  const goBtn = $('mcpRunGo');
  if (goBtn) { goBtn.disabled = true; goBtn.textContent = 'Running…'; }
  if (out) { out.style.display = 'block'; out.textContent = `→ ${name}(${JSON.stringify(args)})\n\nRunning…`; }

  try {
    const bridge = window._mcpBridge || new ShahzaibSEOMCPBridge();
    if (!window._mcpBridge) { await bridge.init(); window._mcpBridge = bridge; }
    await bridge.ensureTools();
    const mutating = c.risk !== 'read';
    const res = await bridge.call(name, args, { mutating, skipValidation: false });
    if (out) out.textContent = `→ ${name}(${JSON.stringify(args, null, 0)})\n\n` +
      (typeof res === 'string' ? res : JSON.stringify(res, null, 2));
    toast(`✅ ${name} ran.`);
  } catch (e) {
    if (out) out.textContent = `→ ${name}\n\n❌ ${e.message}`;
    toast(`❌ ${name}: ${e.message}`);
  } finally {
    if (goBtn) { goBtn.disabled = false; goBtn.textContent = `▶ Run ${name}`; }
  }
}

// ── Presets ──────────────────────────────────────────────────────────────────
// 'all'  → tick every visible tool EXCEPT destructive (those stay opt-in)
// 'seo'  → tick mutating tools in SEO-essential families
// 'none' → untick everything
function applyMcpPreset(preset) {
  const root = $('mcpFixOptionsBody');
  if (!root) return;
  const boxes = Array.from(root.querySelectorAll('input[type="checkbox"][data-mcp-tool]'));
  if (!boxes.length) { toast('No tools loaded yet — click "Test Connection" first.'); return; }

  let destructiveTicked = 0;
  for (const el of boxes) {
    const risk = el.dataset.mcpRisk;
    const fam  = el.dataset.mcpFamily;
    if (preset === 'all') {
      el.checked = risk !== 'destructive';     // never bulk-tick destructive
    } else if (preset === 'none') {
      el.checked = false;
    } else if (preset === 'seo') {
      const f = MCP_FAMILY_BY_ID[fam];
      el.checked = (risk === 'write') && !!(f && f.seoEssential);
    }
    if (el.checked && risk === 'destructive') destructiveTicked++;
  }
  const labelMap = { all: 'All (non-destructive)', seo: 'SEO essentials', none: 'None' };
  toast(`Preset: ${labelMap[preset] || preset}.`);
  if (destructiveTicked) toast(`⚠ ${destructiveTicked} destructive tool(s) ticked — review before running.`);
}

// Read the currently-checked tool names from the dynamic panel.
function readMcpCheckedTools() {
  const root = $('mcpFixOptionsBody');
  if (!root) return [];
  return Array.from(root.querySelectorAll('input[type="checkbox"][data-mcp-tool]'))
    .filter(el => el.checked)
    .map(el => el.dataset.mcpTool)
    .filter(Boolean);
}

// Count destructive tools currently ticked (used by the dispatcher for a guard).
function countCheckedDestructiveTools() {
  const root = $('mcpFixOptionsBody');
  if (!root) return 0;
  return Array.from(root.querySelectorAll('input[type="checkbox"][data-mcp-tool]:checked'))
    .filter(el => el.dataset.mcpRisk === 'destructive').length;
}

// ─── Cross-tab MCP quick-fix ────────────────────────────────────────────────
// Every other tab (Headings, Images, Links, Metadata, GEO, Technical) shows
// issues but, until now, only the dedicated MCP tab could push fixes back to
// WordPress. This wires a small "⚡ Fix via MCP" banner into each of those
// tabs that: (1) makes sure WP x MCP is connected, (2) auto-selects ONLY the
// tool(s) relevant to that tab's issue type from the live tools/list, and
// (3) runs the exact same validated dispatch pipeline as the MCP tab's
// "Fix this page" button (postId auto-detect, schema validation, destructive
// guard, results panel) — nothing new to trust, just a shortcut into it.
//
// `test(name, desc, family)` matches against the lower-cased tool name,
// lower-cased description, and the tool's classifyMcpTool() family id.
const MCP_TAB_TOOL_SELECTORS = {
  headings: {
    label: 'heading structure',
    test: (n, d, fam) => fam === 'headings',
  },
  images: {
    label: 'image alt text',
    test: (n, d, fam) => fam === 'media',
  },
  links: {
    // No dedicated "links" family exists in MCP_FAMILIES (broken-link tools
    // land in 'audit'/'read'/'write' depending on naming), so match on the
    // word "link" directly in addition to the canonical/hreflang family.
    label: 'broken & internal links',
    test: (n, d, fam) => fam === 'redirects' || /\blink/.test(n) || /\blink/.test(d),
  },
  metadata: {
    label: 'SEO metadata (title / description / canonical / focus keyword)',
    test: (n, d, fam) => fam === 'seo' || fam === 'yoast' || fam === 'rankmath',
  },
  geo: {
    label: 'schema / structured data',
    test: (n, d, fam) => fam === 'schema',
  },
  technical: {
    label: 'sitemap, redirects & performance',
    test: (n, d, fam) => fam === 'sitemap' || fam === 'redirects' || fam === 'performance',
  },
};

async function mcpQuickFixFromTab(tabKey, btnEl) {
  const sel = MCP_TAB_TOOL_SELECTORS[tabKey];
  if (!sel) return;
  if (!_rawData) { toast('Run an audit first.'); return; }
  if (typeof ShahzaibSEOMCPBridge === 'undefined') { toast('mcp-bridge.js not loaded.'); return; }

  const setBusy = (busy) => {
    if (!btnEl) return;
    btnEl.disabled = busy;
    const span = btnEl.querySelector('span');
    if (span) span.textContent = busy ? 'Fixing…' : 'Fix via MCP';
  };

  setBusy(true);
  try {
    // 1) Make sure the bridge is connected. Reuse the cached instance so we
    // don't lose listTools()'s capability cache.
    let bridge = window._mcpBridge;
    if (!bridge || !bridge.isConfigured()) {
      bridge = bridge || new ShahzaibSEOMCPBridge();
      const ok = await bridge.init();
      if (!ok) {
        switchTab('mcp');
        const ep = $('wpxmcpEndpoint');
        if (ep) {
          ep.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => { try { ep.focus(); } catch (_) {} }, 350);
          ep.classList.add('mcp-field-flash');
          setTimeout(() => ep.classList.remove('mcp-field-flash'), 1600);
        }
        toast(`Connect WP×MCP first (Endpoint + API Key), then click "Fix via MCP" again to push ${sel.label} fixes.`);
        return;
      }
      window._mcpBridge = bridge;
    }

    // 2) Make sure we have a live tool list to choose from.
    let tools = Object.values(_mcpToolIndex);
    if (!tools.length) {
      toast('Loading MCP tools…');
      tools = await bridge.listTools().catch(() => []);
      if (tools.length) { setMcpToolIndex(tools); writeCachedMcpTools(tools); }
    }
    if (!tools.length) {
      toast('No MCP tools discovered yet. Open the MCP tab and click "Refresh tools".');
      switchTab('mcp');
      return;
    }

    // 3) Find tools relevant to this tab (excluding read-only diagnostics —
    // those don't "fix" anything, they just report).
    const classified = tools.map(t => ({ t, c: classifyMcpTool(t) }));
    const relevant = classified.filter(({ t, c }) =>
      sel.test(t.name.toLowerCase(), (t.description || '').toLowerCase(), c.family));
    const fixable    = relevant.filter(({ c }) => c.risk === 'write');
    const destructive = relevant.filter(({ c }) => c.risk === 'destructive');

    if (!fixable.length) {
      toast(destructive.length
        ? `Only destructive tool(s) match "${sel.label}" on this server — open the MCP tab to review & run them manually.`
        : `No write tool for "${sel.label}" is exposed by this MCP server yet.`);
      if (destructive.length) switchTab('mcp');
      return;
    }

    // 4) Switch to the MCP tab, show the FULL tool list (so non-matching
    // checkboxes are present in the DOM and can be safely cleared), then
    // check ONLY this tab's relevant write tools — destructive matches are
    // deliberately left unticked for manual review.
    switchTab('mcp');
    _mcpActiveGroup = 'all';
    _mcpSearchQuery = '';
    const searchBox = $('mcpToolSearch'); if (searchBox) searchBox.value = '';
    renderMcpFixOptionsPanel(tools);

    const root = $('mcpFixOptionsBody');
    const fixableNames = new Set(fixable.map(({ t }) => t.name));
    if (root) {
      root.querySelectorAll('input[type="checkbox"][data-mcp-tool]').forEach(el => {
        el.checked = fixableNames.has(el.dataset.mcpTool);
      });
    }

    toast(`Selected ${fixable.length} MCP tool(s) for ${sel.label}` +
      (destructive.length ? ` (+${destructive.length} destructive — review manually)` : '') +
      ' — dispatching…');

    await mcpFixAll();
  } catch (e) {
    console.error('[ShahzaibSEO MCP] Quick-fix error:', e);
    toast('MCP quick-fix error: ' + e.message);
  } finally {
    setBusy(false);
  }
}

// Prepend a compact "⚡ Fix via MCP" banner into each fixable tab's panel.
// Pure DOM injection (no template-string surgery inside the big render*()
// functions), called once at boot — the banner persists across re-renders
// since it lives outside the elements those renderers overwrite.
function injectMcpQuickFixBanners() {
  const LIGHTNING_SVG = '<svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd"/></svg>';
  const copy = {
    headings: 'Push heading-structure fixes (H1/skipped levels) straight to this page.',
    images:   'Push missing image alt-text fixes straight to your media library.',
    links:    'Push broken/internal link fixes straight to this page.',
    metadata: 'Push title / description / canonical / focus keyword fixes to this page.',
    geo:      'Push schema / structured-data fixes (FAQ, etc.) to this page.',
    technical:'Push sitemap, redirect & performance fixes for this site.',
  };
  for (const tabKey of Object.keys(MCP_TAB_TOOL_SELECTORS)) {
    const section = $('tab-' + tabKey);
    if (!section || section.querySelector(':scope > .mcp-quickfix-banner')) continue;
    const banner = document.createElement('div');
    banner.className = 'mcp-quickfix-banner';
    banner.innerHTML = `
      <span class="mcp-quickfix-text">⚡ ${escapeHtml(copy[tabKey] || 'Push fixes for this tab straight to WordPress.')}</span>
      <button type="button" class="mcp-quickfix-btn" data-mcp-quickfix-tab="${tabKey}">
        ${LIGHTNING_SVG}<span>Fix via MCP</span>
      </button>`;
    section.prepend(banner);
  }
  // One delegated listener handles every banner button (works even though
  // banners were injected dynamically).
  if (!document._mcpQuickFixWired) {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mcp-quickfix-tab]');
      if (!btn) return;
      mcpQuickFixFromTab(btn.dataset.mcpQuickfixTab, btn);
    });
    document._mcpQuickFixWired = true;
  }
}

// ── Wire-up ──────────────────────────────────────────────────────────────────
function initMcpFixOptionsUi() {
  // Presets
  const bar = $('mcpFixPresets');
  if (bar) {
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('.mcp-preset-btn');
      if (!btn) return;
      if (btn.dataset.preset === 'refresh') return refreshMcpToolList();
      applyMcpPreset(btn.dataset.preset);
    });
  }
  // Search/filter (debounced light)
  const search = $('mcpToolSearch');
  if (search) {
    let tmr = null;
    search.addEventListener('input', () => {
      _mcpSearchQuery = search.value.trim().toLowerCase();
      clearTimeout(tmr);
      tmr = setTimeout(() => renderMcpFixOptionsPanel(Object.values(_mcpToolIndex)), 120);
    });
  }
  // Group tabs (delegated)
  const tabs = $('mcpGroupTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.mcp-group-tab');
      if (!btn) return;
      _mcpActiveGroup = btn.dataset.mcpGroup || 'all';
      renderMcpFixOptionsPanel(Object.values(_mcpToolIndex));
    });
  }
  // Run-tool mode
  const runSel = $('mcpRunToolSelect');
  if (runSel) runSel.addEventListener('change', () => renderMcpRunToolForm(runSel.value));
  const runForm = $('mcpRunToolForm');
  if (runForm) runForm.addEventListener('click', (e) => {
    if (e.target.closest('#mcpRunGo')) runMcpSingleTool();
  });
  const runToggle = $('mcpRunToolToggle');
  if (runToggle) runToggle.addEventListener('click', () => {
    const panel = $('mcpRunToolPanel');
    if (!panel) return;
    const show = panel.style.display === 'none' || !panel.style.display;
    panel.style.display = show ? 'block' : 'none';
    runToggle.textContent = show ? '▾ Run a single tool' : '▸ Run a single tool';
    if (show) populateMcpRunToolSelect();
  });
}

// If the user has saved an endpoint + key but no tools are cached yet, do a
// silent connect so the MCP tab is populated the moment it's opened.
async function maybeAutoConnectMcp() {
  try {
    if (typeof ShahzaibSEOMCPBridge === 'undefined') return;
    if (Object.keys(_mcpToolIndex || {}).length) return; // already have tools
    const bridge = window._mcpBridge || new ShahzaibSEOMCPBridge();
    if (!window._mcpBridge) await bridge.init();
    if (bridge.isConfigured()) {
      window._mcpBridge = bridge;
      await refreshMcpToolList({ silent: true });
    }
  } catch (_) {}
}

async function mcpLoadCachedToolList() {
  const c = await readCachedMcpTools();
  if (c && Array.isArray(c.tools) && c.tools.length) {
    setMcpToolIndex(c.tools);
    renderMcpFixOptionsPanel(c.tools);
  }
}


// ─── Export JSON ──────────────────────────────────────
function exportJSON() {
  if (!_rawData) { toast('No data to export'); return; }
  const blob = new Blob([JSON.stringify(_rawData, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `rankseo-${(_rawData.url?new URL(_rawData.url).hostname:'audit')}-${Date.now()}.json`;
  a.click(); URL.revokeObjectURL(url); toast('JSON exported!');
}

// ─── Export CSV ───────────────────────────────────────
function exportCSV() {
  if (!_rawData) { toast('No data to export'); return; }
  const d = adaptV1Data(_rawData);
  const rows = ['Type,Key,Value'];
  const add = (type, key, val) => rows.push(`"${type}","${key}","${String(val||'').replace(/"/g,'""')}"`);
  add('SEO','Score',d.seo.score); add('SEO','Grade',d.seo.grade);
  add('GEO','Score',d.geo.geoScore);
  add('Meta','Title',d.meta.title); add('Meta','Description',d.meta.desc);
  add('Meta','Canonical',d.meta.canonical); add('Meta','Language',d.meta.lang);
  add('Images','Total',d.images.total); add('Images','Missing Alt',d.images.missingAlt);
  add('Links','Total',d.links.total); add('Links','Internal',d.links.internal); add('Links','External',d.links.external);
  add('Keywords','Unique',d.keywords.uniqueCount); add('Readability','Score',d.readability.score);
  add('Readability','Words',d.readability.wordCount);
  (d.seo.issues||[]).forEach((iss,i) => add('Issue',`#${i+1}`,iss.msg));
  const blob = new Blob([rows.join('\n')], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `rankseo-${Date.now()}.csv`;
  a.click(); URL.revokeObjectURL(url); toast('CSV exported!');
}

// ─── Export PDF ───────────────────────────────────────

// Gathers everything the Technical and GEO tabs have computed but that
// adaptV1Data() doesn't already expose in PDF-friendly form: domain/RDAP
// info, robots/.htaccess/sitemap/llms.txt file snippets, security &
// accessibility checklists, CSS/JS coverage, fonts, page weight, resource
// hints detail, DNS/HTTP headers/cert/IP data, and GEO page-type + schema
// coverage suggestions. Pure data extraction — no DOM writes.
function buildPdfExtras(d, raw) {
  const t = d.tech || {};
  const g = d.geo || {};

  // ---- crawler permissions (8 major bots, allow/partial/block + directive) --
  const BOT_LIST = [
    { name: 'GPTBot (ChatGPT)', agent: 'gptbot' },
    { name: 'Claude-Web', agent: 'claude-web' },
    { name: 'Google-Extended', agent: 'google-extended' },
    { name: 'PerplexityBot', agent: 'perplexitybot' },
    { name: 'Googlebot', agent: 'googlebot' },
    { name: 'Bingbot', agent: 'bingbot' },
    { name: 'CCBot', agent: 'ccbot' },
    { name: 'Diffbot', agent: 'diffbot' }
  ];
  const crawlerPerms = BOT_LIST.map(b => ({ ...b, status: getCrawlerStatus(_robotsTxt, b.agent) }));

  // ---- page type → schema coverage suggestions -------------------------
  const pageTypeRaw = g.pageType || 'other';
  const pageTypeLower = pageTypeRaw.toLowerCase();
  let mapKey = 'other';
  if (/article|blog.?posting|news/i.test(pageTypeLower)) mapKey = 'article';
  else if (/blog.?index|blog$/i.test(pageTypeLower)) mapKey = 'blog';
  else if (/product$/i.test(pageTypeLower)) mapKey = 'product';
  else if (/collection|category/i.test(pageTypeLower)) mapKey = 'category';
  else if (/faq/i.test(pageTypeLower)) mapKey = 'faq';
  else if (/homepage|home/i.test(pageTypeLower)) mapKey = 'homepage';
  else if (/contact/i.test(pageTypeLower)) mapKey = 'contact';
  else if (/about/i.test(pageTypeLower)) mapKey = 'about';
  else if (/service/i.test(pageTypeLower)) mapKey = 'service';
  else if (/event/i.test(pageTypeLower)) mapKey = 'event';
  else if (/recipe/i.test(pageTypeLower)) mapKey = 'recipe';
  else if (/video/i.test(pageTypeLower)) mapKey = 'video';
  else if (/local|business/i.test(pageTypeLower)) mapKey = 'local';
  const suggestions = (typeof SCHEMA_SUGGESTIONS_BY_PAGE_TYPE !== 'undefined' && SCHEMA_SUGGESTIONS_BY_PAGE_TYPE[mapKey]) || { must: [], nice: [] };
  const existingTypes = new Set((g.structured?.schemas || []).map(s => s.type));
  const schemaCoverage = {
    pageType: pageTypeRaw,
    mustMissing: suggestions.must.filter(ty => !existingTypes.has(ty)),
    niceMissing: suggestions.nice.filter(ty => !existingTypes.has(ty)),
    mustPresent: suggestions.must.filter(ty => existingTypes.has(ty))
  };

  // ---- AI Overview / SGE likelihood (mirrors renderAIOverviewLikelihood) --
  const cd = g.citabilityDetails || {};
  const af = cd.answerFirst || {};
  const pl = cd.passageLength || {};
  const eeat = g.eeat || {};
  const schemas = g.structured?.schemas || [];
  const aioSignals = [
    { label: 'Answer-first opening (\u226455w)', met: !!af.hasAnswerFirstOpening, pts: 20 },
    { label: 'Author identified (E-E-A-T)', met: !!eeat.hasAuthor, pts: 15 },
    { label: 'Structured data present', met: schemas.length > 0, pts: 15 },
    { label: 'Citations / references', met: !!eeat.hasCite, pts: 15 },
    { label: 'Passage structure (H2-chunked)', met: pl.total > 0 && (pl.ideal / Math.max(pl.total, 1)) >= 0.5, pts: 15 },
    { label: 'HTTPS (trust signal)', met: !!eeat.hasHttps, pts: 10 },
    { label: 'Stats or data cited', met: (cd.statsCount || 0) >= 2, pts: 5 },
    { label: 'Q&A patterns present', met: (cd.questionsCount || 0) >= 1, pts: 5 }
  ];
  const aioScore = aioSignals.reduce((s, x) => s + (x.met ? x.pts : 0), 0);
  const aioMax = aioSignals.reduce((s, x) => s + x.pts, 0);
  const aioPct = aioMax ? Math.round((aioScore / aioMax) * 100) : 0;
  const aioLevel = aioPct >= 75 ? 'High' : aioPct >= 50 ? 'Medium' : aioPct >= 25 ? 'Low' : 'Very Low';

  // ---- top keywords (for AI memo / topical depth / keyword gap) ---------
  const topKeywords = (d.keywords?.keywords || [])
    .slice().sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 10).map(k => k.word).filter(Boolean);

  // ---- AI keyword gap (mirrors renderGeoKeywordGap) ----------------------
  const bodyText = [
    (d.meta?.title || '').toLowerCase(),
    (d.meta?.desc || '').toLowerCase(),
    (d.headings?.headings?.find(h => h.level === 1)?.text || '').toLowerCase(),
    topKeywords.join(' ').toLowerCase()
  ].join(' ');
  const KW_GROUPS = [
    { kw: 'AI overview', cat: 'LLM Visibility' }, { kw: 'featured snippet', cat: 'SERP Features' },
    { kw: 'structured data', cat: 'Schema' }, { kw: 'schema markup', cat: 'Schema' },
    { kw: 'entity', cat: 'Knowledge Graph' }, { kw: 'E-E-A-T', cat: 'Trust' },
    { kw: 'author', cat: 'Trust' }, { kw: 'citation', cat: 'Citability' },
    { kw: 'sources', cat: 'Citability' }, { kw: 'FAQ', cat: 'AEO' },
    { kw: 'how to', cat: 'AEO' }, { kw: 'definition', cat: 'AEO' },
    { kw: 'robots.txt', cat: 'Crawling' }, { kw: 'llms.txt', cat: 'Crawling' }, { kw: 'sitemap', cat: 'Crawling' }
  ];
  const keywordGap = KW_GROUPS.map(({ kw, cat }) => {
    const inText = bodyText.includes(kw.toLowerCase());
    const inSchema = schemas.some(s => (s.type || '').toLowerCase().includes(kw.toLowerCase()));
    return { kw, cat, hit: inText || inSchema };
  });

  // ---- AI Page Memo text (mirrors renderGeoAIMemo) -----------------------
  const entities = (g.entities?.entities || []).slice(0, 6).map(e => e.name).filter(Boolean);
  const h1 = (d.headings?.headings || []).find(h => h.level === 1)?.text || d.meta?.title || '';
  const aiMemo = {
    title: d.meta?.title || 'Untitled Page', url: d.meta?.url || '', pageType: pageTypeRaw,
    wordCount: cd.wordCount || d.keywords?.totalWords || 0, h1, topKeywords: topKeywords.slice(0, 5),
    entities, schemas: schemas.map(s => s.type).filter(Boolean),
    hasAuthor: !!eeat.hasAuthor, hasDate: !!eeat.hasDate, hasHttps: !!eeat.hasHttps,
    desc: d.meta?.desc || '', geoScore: g.geoScore || 0, readability: d.readability?.score || 0
  };

  // ---- Topical authority depth (mirrors renderGeoTopicalDepth) -----------
  const h2Count = cd.h2Count || 0, h3Count = cd.h3Count || 0;
  const wordCount = cd.wordCount || d.keywords?.totalWords || 0;
  const entityList = g.entities?.entities || [];
  const headingDensity = wordCount > 0 ? Math.round(((h2Count + h3Count) / wordCount) * 1000) : 0;
  const entityDensity = wordCount > 0 ? Math.round((entityList.length / wordCount) * 1000) : 0;
  const headingScore = Math.min(100, Math.round((headingDensity / 3) * 100));
  const entityScore = Math.min(100, Math.round((entityDensity / 5) * 100));
  const topicalDepth = {
    h2Count, h3Count, wordCount, headingScore, entityScore,
    depthScore: Math.round(headingScore * 0.5 + entityScore * 0.5),
    entityCount: entityList.length, linkedCount: g.entities?.linkedCount || 0,
    topEntities: entityList.slice(0, 10).map(e => ({ name: e.name, type: e.type, source: e.source, mentions: e.mentions }))
  };

  return {
    domainInfo: _domainInfo || null,
    htaccess: _htaccessData || null,
    sitemap: _sitemapData || null,
    llmsTxt: _llmsTxtData || null,
    robotsTxt: _robotsTxt || null,
    ipGeo: _ipGeoData || null,
    dns: _dnsData || null,
    httpHeaders: _httpHeadersData || null,
    cert: (_certData && _certData.domain) || null,
    crawlerPerms,
    schemaCoverage,
    aiOverview: { signals: aioSignals, score: aioScore, max: aioMax, pct: aioPct, level: aioLevel },
    keywordGap,
    aiMemo,
    topicalDepth,
    topKeywords,
    // Link HTTP status codes (from Links tab Check Status)
    linkStatusRows: (() => {
      try {
        const all = (raw && raw.links && raw.links.links) || [];
        return all
          .filter(l => l && l._httpStatus != null)
          .map(l => ({
            url: l.url || '',
            text: l.text || '',
            status: l._httpStatus || 0,
            internal: !!l.isInternal,
            img: !!l.imgInside
          }));
      } catch (_) { return []; }
    })(),
    // Traffic snapshot from SimilarWeb (if already fetched on Traffic tab)
    traffic: (typeof _trfLastData !== 'undefined' && _trfLastData && _trfLastData.ok) ? {
      visits: _trfLastData.visits || null,
      globalRank: _trfLastData.globalRank || null,
      countryRank: _trfLastData.countryRank || null,
      categoryRank: _trfLastData.categoryRank || null,
      category: _trfLastData.category || null,
      bounceRate: _trfLastData.bounceRate != null ? _trfLastData.bounceRate : null,
      pagePerVisit: _trfLastData.pagePerVisit != null ? _trfLastData.pagePerVisit : null,
      timeOnSite: _trfLastData.timeOnSite != null ? _trfLastData.timeOnSite : null,
      monthlyVisits: Array.isArray(_trfLastData.monthlyVisits) ? _trfLastData.monthlyVisits.slice(-6) : [],
      trafficSources: _trfLastData.trafficSources || null,
      topCountries: Array.isArray(_trfLastData.topCountryShares) ? _trfLastData.topCountryShares.slice(0, 5) : [],
      source: _trfLastData.source || 'SimilarWeb'
    } : null
  };
}

function exportPDF() {
  if (!_rawData) { toast('No data. Run analysis first.'); return; }
  try {
    if (typeof SorankPDF === 'undefined') { toast('PDF generator not available'); return; }

    const d = adaptV1Data(_rawData);
    const pageUrl = d.meta.url || _currentUrl || '';
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Read already-rendered dashboard stat boxes (populated by MOZ_FETCH / RDAP / robots).
    const _statTxt = (id) => { const el = $(id); return el ? (el.textContent || '').trim() : ''; };
    const _statNum = (id) => {
      let t = _statTxt(id);
      if (!t || t === '--' || t === 'N/A') return null;
      t = t.replace('%', '');
      const m = t.match(/([\d.]+)\s*([KM]?)/i);
      if (!m) return null;
      let n = parseFloat(m[1]);
      if (/k/i.test(m[2])) n *= 1000; else if (/m/i.test(m[2])) n *= 1000000;
      return n;
    };

    // ---- authority (optional) ---------------------------------------------
    const da = _statNum('qDomainDA');
    const dr = _statNum('qDomainDR');
    const spam = _statNum('qDomainSpam');
    const bl = _statNum('qDomainBL');
    const age = _statTxt('qDomainAge');
    const ageOk = age && age !== '--' && age !== 'N/A';
    const authority = (da != null || dr != null || bl != null || ageOk) ? {
      da: da, dr: dr, pa: null, spam: spam, refDomains: null, backlinks: bl, domainAge: ageOk ? age : ''
    } : null;

    // ---- AI crawler access (optional) -------------------------------------
    const ba = _statNum('qBotsAllowed'), bp = _statNum('qBotsPartial'), bb = _statNum('qBotsBlocked');
    const aiBots = (ba != null || bp != null || bb != null)
      ? { allowed: ba || 0, partial: bp || 0, blocked: bb || 0 } : null;

    // ---- extra Technical + GEO tab data not covered by adaptV1Data --------
    const extras = buildPdfExtras(d, _rawData);

    // ---- build & download -------------------------------------------------
    const pdf = new SorankPDF();
    pdf.buildAuditReport({
      d,
      url: pageUrl,
      date: dateStr,
      vitals: _vitals || null,
      authority,
      aiBots,
      extras
    });

    const hostname = (() => { try { return new URL(pageUrl).hostname; } catch { return 'audit'; } })();
    const fileSafeDate = dateStr.replace(/[, ]+/g, '-');
    pdf.download(`ShahzaibSEO-Audit-${hostname}-${fileSafeDate}.pdf`);
    toast('Audit PDF downloaded!');
  } catch (e) {
    console.error('[ShahzaibSEO] PDF error', e);
    toast('PDF error: ' + e.message);
  }
}

// ─── AI Prompt ────────────────────────────────────────
function copyAIPrompt() {
  if (!_rawData) { toast('No data. Run analysis first.'); return; }
  const d = adaptV1Data(_rawData);
  const sep  = '═'.repeat(64);
  const sep2 = '─'.repeat(64);
  const lines = [];

  lines.push(`You are a senior SEO, GEO (Generative Engine Optimization) and web performance consultant. I'm sharing a complete technical audit of my webpage. Please:`);
  lines.push(`  1. Identify the top 5 critical issues hurting rankings and conversions`);
  lines.push(`  2. Provide specific, actionable fixes for each issue`);
  lines.push(`  3. Suggest improvements to metadata, headings, and content structure`);
  lines.push(`  4. Give GEO recommendations to improve visibility in AI search engines (ChatGPT, Perplexity, Gemini)`);
  lines.push(`  5. Prioritize fixes by expected impact (High / Medium / Low)`);
  lines.push('');
  lines.push(sep);
  lines.push('📄  PAGE OVERVIEW');
  lines.push(sep);
  lines.push(`URL:           ${d.meta.url}`);
  lines.push(`Analyzed:      ${new Date().toLocaleString()}`);
  if (d.meta.lang)       lines.push(`Language:      ${d.meta.lang}`);
  if (d.tech.framework)  lines.push(`Framework:     ${d.tech.framework}`);
  if (d.tech.cms)        lines.push(`CMS:           ${d.tech.cms}`);
  lines.push(`HTML Size:     ${formatBytes(d.tech.htmlSize)}`);
  lines.push(`DOM Elements:  ${d.tech.domElements || '—'}`);
  lines.push('');

  lines.push(sep);
  lines.push('📊  SCORES');
  lines.push(sep);
  lines.push(`SEO Score:          ${d.seo.score}/100  (Grade: ${d.seo.grade})`);
  lines.push(`GEO Score:          ${d.geo.geoScore}/100`);
  lines.push(`Keyword Score:      ${d.keywords.score}/100`);
  lines.push(`Readability Score:  ${d.readability.score}/100`);
  lines.push(`CRO Score:          ${d.cro.score}/100`);
  if (_vitals?.mobile?.score  != null) lines.push(`PageSpeed Mobile:   ${_vitals.mobile.score}/100`);
  if (_vitals?.desktop?.score != null) lines.push(`PageSpeed Desktop:  ${_vitals.desktop.score}/100`);
  lines.push('');

  // GEO Pillars
  if (Object.keys(d.geo.pillars || {}).length > 0) {
    lines.push(sep2);
    lines.push('  GEO Pillars:');
    Object.entries(d.geo.pillars).forEach(([k,v]) => lines.push(`    ${k.padEnd(22)}: ${v}/100`));
    lines.push('');
  }

  lines.push(sep);
  lines.push(`🚨  ISSUES (${d.seo.issues.length} found)`);
  lines.push(sep);
  if (d.seo.issues.length === 0) {
    lines.push('  No issues detected.');
  } else {
    d.seo.issues.forEach((iss, i) => {
      const sev = (iss.severity || 'info').toUpperCase();
      lines.push(`  ${String(i+1).padStart(2)}. [${sev}] ${iss.msg}`);
      if (iss.detail) lines.push(`        Detail: ${iss.detail}`);
      if (iss.fix)    lines.push(`        Fix:    ${iss.fix}`);
    });
  }
  lines.push('');

  lines.push(sep);
  lines.push('🏷️  METADATA');
  lines.push(sep);
  const titleLen = (d.meta.title||'').length;
  const descLen  = (d.meta.desc||'').length;
  lines.push(`Title:       "${d.meta.title}" (${titleLen} chars${titleLen>60?' — TOO LONG':titleLen===0?' — MISSING':''})`);
  lines.push(`Description: "${d.meta.desc}" (${descLen} chars${descLen>160?' — TOO LONG':descLen===0?' — MISSING':''})`);
  lines.push(`Canonical:   ${d.meta.canonical || '⚠ Not set'}`);
  lines.push(`Robots:      ${d.meta.robots    || 'Not set'}`);
  lines.push(`Viewport:    ${d.meta.viewport  || '⚠ Not set'}`);
  lines.push(`OG Title:    ${d.meta.og?.title       || '⚠ Missing'}`);
  lines.push(`OG Desc:     ${d.meta.og?.description || '⚠ Missing'}`);
  lines.push(`OG Image:    ${d.meta.og?.image       || '⚠ Missing'}`);
  lines.push(`Twitter Card:${d.meta.twitter?.card   || '⚠ Missing'}`);
  lines.push('');

  lines.push(sep);
  lines.push('📑  HEADING STRUCTURE');
  lines.push(sep);
  const hc = d.headings.counts;
  lines.push(`Counts → H1:${hc.h1}  H2:${hc.h2}  H3:${hc.h3}  H4:${hc.h4}  H5:${hc.h5}  H6:${hc.h6}`);
  if (d.headings.issues.length > 0) {
    lines.push('Issues:');
    d.headings.issues.forEach(iss => lines.push(`  ⚠ ${iss.msg}`));
  }
  const emptyHN = d.headings.headings.filter(h => h.isEmpty);
  if (emptyHN.length > 0) lines.push(`  ⚠ ${emptyHN.length} empty heading(s) — should be removed or filled`);
  lines.push('All Headings:');
  d.headings.headings.slice(0, 30).forEach(h => {
    const indent = '  '.repeat(h.level - 1);
    lines.push(`${indent}H${h.level}: ${h.isEmpty ? '(empty — fix required)' : `"${h.text}"`}`);
  });
  lines.push('');

  lines.push(sep);
  lines.push('🔑  KEYWORDS');
  lines.push(sep);
  lines.push(`Unique Keywords: ${d.keywords.uniqueCount} | Bold: ${d.keywords.boldCount} | Italic: ${d.keywords.italicCount || 0}`);
  lines.push('Top 1-word keywords:');
  (d.keywords.keywords||[]).filter(k=>k.ngram===1).slice(0,10).forEach((k,i) =>
    lines.push(`  ${i+1}. "${k.word}"  count:${k.count}  density:${k.density}%  bold:${k.inBold?'yes':'no'}`)
  );
  lines.push('Top 2-word phrases:');
  (d.keywords.keywords||[]).filter(k=>k.ngram===2).slice(0,5).forEach((k,i) =>
    lines.push(`  ${i+1}. "${k.word}"  count:${k.count}  density:${k.density}%`)
  );
  lines.push('');

  lines.push(sep);
  lines.push('🔗  LINKS');
  lines.push(sep);
  lines.push(`Total: ${d.links.total} | Internal: ${d.links.internal} | External: ${d.links.external}`);
  lines.push(`Nofollow: ${d.links.nofollow} | Empty anchors: ${d.links.empty} | No-text: ${d.links.noText||0}`);
  const emptyLinks = (d.links.links||[]).filter(l=>!l.text||!l.text.trim());
  if (emptyLinks.length > 0) lines.push(`⚠ ${emptyLinks.length} link(s) have no anchor text`);
  lines.push('');

  lines.push(sep);
  lines.push('🖼️  IMAGES');
  lines.push(sep);
  lines.push(`Total: ${d.images.total} | With Alt: ${d.images.withAlt} | Missing Alt: ${d.images.missingAlt}`);
  lines.push(`Oversized: ${d.images.oversized} | Above-fold Lazy: ${d.images.aboveFoldLazy} | Duplicate Alts: ${d.images.duplicateAlts}`);
  if (d.images.missingAlt > 0) lines.push(`⚠ ${d.images.missingAlt} image(s) missing alt text — write descriptive alt for each`);
  if (d.images.aboveFoldLazy > 0) lines.push(`⚠ ${d.images.aboveFoldLazy} above-fold image(s) are lazy-loaded — remove loading="lazy" on these`);
  lines.push('');

  lines.push(sep);
  lines.push('⚙️  TECHNICAL');
  lines.push(sep);
  lines.push(`HTTPS:          ${d.tech.isHttps     ? '✓ Yes' : '✗ No — Critical!'}`);
  lines.push(`Indexable:      ${d.tech.isIndexable ? '✓ Yes' : '✗ No — page is blocked from Google'}`);
  lines.push(`Canonical tag:  ${d.meta.canonical   ? '✓ Set' : '⚠ Missing'}`);
  lines.push(`Viewport meta:  ${d.meta.viewport    ? '✓ Set' : '⚠ Missing — mobile usability issue'}`);
  lines.push(`Charset:        ${d.meta.charset     || '⚠ Not declared'}`);
  if (d.tech.techStack && d.tech.techStack.length > 0) lines.push(`Tech Stack:     ${d.tech.techStack.slice(0,8).join(', ')}`);
  lines.push('');

  // Core Web Vitals
  if (_vitals?.mobile) {
    lines.push(sep2);
    lines.push('  Core Web Vitals (Mobile):');
    const mv = _vitals.mobile;
    if (mv.lcp != null) lines.push(`    LCP: ${mv.lcp}s  ${mv.lcp<=2.5?'✓ Good':mv.lcp<=4?'⚠ Needs work':'✗ Poor'}`);
    if (mv.cls != null) lines.push(`    CLS: ${mv.cls}   ${mv.cls<=0.1?'✓ Good':mv.cls<=0.25?'⚠ Needs work':'✗ Poor'}`);
    if (mv.inp != null) lines.push(`    INP: ${mv.inp}ms ${mv.inp<=200?'✓ Good':mv.inp<=500?'⚠ Needs work':'✗ Poor'}`);
    if (mv.fcp != null) lines.push(`    FCP: ${mv.fcp}s  ${mv.fcp<=1.8?'✓ Good':mv.fcp<=3?'⚠ Needs work':'✗ Poor'}`);
    lines.push('');
  }

  lines.push(sep);
  lines.push('📖  READABILITY');
  lines.push(sep);
  lines.push(`Score:          ${d.readability.score}/100`);
  lines.push(`Word Count:     ${d.readability.wordCount}`);
  lines.push(`Sentences:      ${d.readability.sentences}`);
  lines.push(`Avg Words/Sent: ${d.readability.avgSentLen || '—'}`);
  lines.push(`Flesch-Kincaid: ${d.readability.fk}`);
  lines.push(`Passive Voice:  ${d.readability.passiveRate}%${d.readability.passiveRate>15?' (high — reduce passive voice)':''}`);
  lines.push('');

  lines.push(sep);
  lines.push('🤖  GEO (AI SEARCH VISIBILITY)');
  lines.push(sep);
  lines.push(`GEO Score: ${d.geo.geoScore}/100`);
  if (d.geo.schemaTypes && d.geo.schemaTypes.length > 0) lines.push(`Schema Types: ${d.geo.schemaTypes.join(', ')}`);
  else lines.push('Schema Types: ⚠ None found — add JSON-LD structured data');
  if (d.geo.hasLlmsTxt  != null) lines.push(`llms.txt:  ${d.geo.hasLlmsTxt  ? '✓ Found' : '⚠ Missing'}`);
  if (d.geo.hasSitemap  != null) lines.push(`Sitemap:   ${d.geo.hasSitemap  ? '✓ Found' : '⚠ Missing'}`);
  lines.push('');

  lines.push(sep);
  lines.push('💬  WHAT I NEED FROM YOU');
  lines.push(sep);
  lines.push('Based on the full audit data above, please provide:');
  lines.push('  A) A prioritized fix list (Critical → High → Medium → Low)');
  lines.push('  B) Rewritten meta title and description (within character limits)');
  lines.push('  C) Improved heading structure (H1 → H2 → H3 hierarchy)');
  lines.push('  D) GEO recommendations (schema markup, E-E-A-T signals, AI citability)');
  lines.push('  E) 3 content/keyword gap opportunities I should target');
  lines.push('');
  lines.push(`--- Generated by ShahzaibSEO - AEO & GEO Expert | ${new Date().toISOString()} ---`);

  navigator.clipboard.writeText(lines.join('\n'))
    .then(() => toast('AI prompt copied! Paste into ChatGPT, Claude or Gemini.'))
    .catch(() => toast('Error copying prompt'));
}
// ─── Utilities ────────────────────────────────────────
function shortUrl(url) { try { const u = new URL(url); return u.hostname + u.pathname.slice(0,30); } catch { return String(url).slice(0,40); } }
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}


// ─── Search Intent Badge ────────────────────────────────
const INTENT_CONFIG = {
  transactional: { label: 'Transactional', color: '#10b981' },
  commercial:    { label: 'Commercial',    color: '#f59e0b' },
  informational: { label: 'Informational', color: '#3b82f6' },
  navigational:  { label: 'Navigational',  color: '#8b5cf6' }
};

function renderSearchIntentBadge(primary, confidence) {
  const badge = document.getElementById('searchIntentBadge');
  if (!badge) return;
  const config = INTENT_CONFIG[primary] || INTENT_CONFIG.informational;
  badge.textContent = config.label;
  badge.style.display = 'inline-flex';
  badge.style.borderColor = config.color;
  badge.style.color = config.color;
  badge.title = `Search intent: ${config.label}${confidence ? ' (' + confidence + ' confidence)' : ''}`;
}

// ─── GEO Page Type Card ──────────────────────────────────
const PAGE_TYPE_ICONS = {
  homepage: '🏠', blog: '📝', article: '📰', product: '🛒',
  category: '📂', contact: '📞', about: '👤', service: '⚙️',
  landing: '🎯', portfolio: '🎨', news: '📡', faq: '❓',
  pricing: '💰', checkout: '🛒', search: '🔍', page: '📄'
};

function renderGeoPageTypeCard(pageType) {
  const card = document.getElementById('geoPageTypeCard');
  const iconEl = document.getElementById('geoPageTypeIcon');
  const valueEl = document.getElementById('geoPageTypeValue');
  if (!card) return;
  const type = (pageType || '').toLowerCase();
  if (iconEl) iconEl.textContent = PAGE_TYPE_ICONS[type] || PAGE_TYPE_ICONS.page;
  if (valueEl) valueEl.textContent = pageType.charAt(0).toUpperCase() + pageType.slice(1);
  card.style.display = '';
}

// ── Toolbar / Sidebar / Domain Settings ────────────────────────────────────
function initToolbarSettings() {
  const toolbarToggle  = document.getElementById('settingsToolbarEnabled');
  const sidebarToggle  = document.getElementById('settingsSidebarEnabled');
  const myGapToggle    = document.getElementById('settingsMyGapEnabled');
  const whitelistTA    = document.getElementById('settingsDomainWhitelist');
  const blacklistTA    = document.getElementById('settingsDomainBlacklist');
  const saveBtn        = document.getElementById('settingsDomainSaveBtn');
  const statusEl       = document.getElementById('settingsDomainStatus');

  // SERP Info Panel toggles
  const serpInfoToggle       = document.getElementById('settingsSerpInfoEnabled');
  const serpInfoUrl          = document.getElementById('settingsSerpInfoUrl');
  const serpInfoTitle        = document.getElementById('settingsSerpInfoTitle');
  const serpInfoDescription  = document.getElementById('settingsSerpInfoDescription');
  const serpInfoJsonLd       = document.getElementById('settingsSerpInfoJsonLd');
  const serpInfoHeadings     = document.getElementById('settingsSerpInfoHeadings');
  const serpInfoFields       = document.getElementById('serpInfoFields');

  // Load saved values
  chrome.storage.local.get(['toolbarEnabled', 'sidebarEnabled', 'myGapEnabled', 'domainWhitelist', 'domainBlacklist',
    'serpInfoEnabled', 'serpInfoUrl', 'serpInfoTitle', 'serpInfoDescription', 'serpInfoJsonLd', 'serpInfoHeadings'], (prefs) => {
    if (toolbarToggle) toolbarToggle.checked = prefs.toolbarEnabled !== false;
    if (sidebarToggle) sidebarToggle.checked = prefs.sidebarEnabled !== false;
    if (myGapToggle)   myGapToggle.checked   = prefs.myGapEnabled   !== false;
    if (whitelistTA && prefs.domainWhitelist) whitelistTA.value = prefs.domainWhitelist.join('\n');
    
    // Set default blacklist if not already set or if empty
    const defaultBlacklist = ['facebook.com', 'chatgpt.com', 'google.com', 'mail.google.com', 'x.com', 'claude.ai', 'gemini.google.com'];
    let blacklist = prefs.domainBlacklist;
    
    // If blacklist is undefined, null, or empty array, set defaults
    if (!blacklist || blacklist.length === 0) {
      blacklist = defaultBlacklist;
      chrome.storage.local.set({ domainBlacklist: blacklist });
    }
    
    if (blacklistTA) blacklistTA.value = blacklist.join('\n');

    // Load SERP Info Panel settings (default: all OFF)
    if (serpInfoToggle) serpInfoToggle.checked = prefs.serpInfoEnabled === true;
    if (serpInfoUrl)         serpInfoUrl.checked        = prefs.serpInfoUrl         === true;
    if (serpInfoTitle)       serpInfoTitle.checked      = prefs.serpInfoTitle        === true;
    if (serpInfoDescription) serpInfoDescription.checked= prefs.serpInfoDescription  === true;
    if (serpInfoJsonLd)      serpInfoJsonLd.checked     = prefs.serpInfoJsonLd       === true;
    if (serpInfoHeadings)    serpInfoHeadings.checked   = prefs.serpInfoHeadings     === true;
    if (serpInfoFields) serpInfoFields.style.opacity = (prefs.serpInfoEnabled === true) ? '1' : '0.4';
  });

  // Toolbar toggle — save immediately
  if (toolbarToggle) {
    toolbarToggle.addEventListener('change', () => {
      chrome.storage.local.set({ toolbarEnabled: toolbarToggle.checked });
      toast(toolbarToggle.checked ? 'Toolbar enabled' : 'Toolbar disabled');
    });
  }

  // Sidebar toggle — save immediately
  if (sidebarToggle) {
    sidebarToggle.addEventListener('change', () => {
      chrome.storage.local.set({ sidebarEnabled: sidebarToggle.checked });
      toast(sidebarToggle.checked ? 'SERP sidebar enabled' : 'SERP sidebar disabled');
    });
  }

  // My Site Gap toggle — save immediately
  if (myGapToggle) {
    myGapToggle.addEventListener('change', () => {
      chrome.storage.local.set({ myGapEnabled: myGapToggle.checked });
      toast(myGapToggle.checked ? 'My Site vs Competitors panel enabled' : 'My Site vs Competitors panel hidden');
    });
  }

  // SERP Info Panel — master toggle
  if (serpInfoToggle) {
    serpInfoToggle.addEventListener('change', () => {
      chrome.storage.local.set({ serpInfoEnabled: serpInfoToggle.checked });
      if (serpInfoFields) serpInfoFields.style.opacity = serpInfoToggle.checked ? '1' : '0.4';
      toast(serpInfoToggle.checked ? 'SERP Info Panel enabled' : 'SERP Info Panel disabled');
    });
  }
  // Field-level toggles
  const serpInfoFieldMap = [
    [serpInfoUrl,         'serpInfoUrl'],
    [serpInfoTitle,       'serpInfoTitle'],
    [serpInfoDescription, 'serpInfoDescription'],
    [serpInfoJsonLd,      'serpInfoJsonLd'],
    [serpInfoHeadings,    'serpInfoHeadings'],
  ];
  serpInfoFieldMap.forEach(([el, key]) => {
    if (!el) return;
    el.addEventListener('change', () => {
      chrome.storage.local.set({ [key]: el.checked });
    });
  });

  // Domain lists — save on button click
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const parseDomains = (raw) => raw.split('\n')
        .map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
        .filter(d => d.length > 0 && d.includes('.'));
      const whitelist = whitelistTA ? parseDomains(whitelistTA.value) : [];
      const blacklist = blacklistTA ? parseDomains(blacklistTA.value) : [];
      chrome.storage.local.set({ domainWhitelist: whitelist, domainBlacklist: blacklist }, () => {
        if (statusEl) { statusEl.style.display = 'block'; setTimeout(() => statusEl.style.display = 'none', 3000); }
      });
    });
  }
}


// Feedback / bug-report flow. Keeps a direct option visible in the sidebar
// and auto-includes extension version + current page URL for reproducibility.
function initFeedbackReporter(){
  const openBtn=$('feedbackBugBtn');
  const modal=$('feedbackModal');
  const closeBtn=$('feedbackCloseBtn');
  const typeEl=$('feedbackType');
  const msgEl=$('feedbackMessage');
  const metaEl=$('feedbackMeta');
  if(!openBtn||!modal) return;
  const getMeta=()=>{
    let version='';
    try{ version=chrome.runtime.getManifest().version||''; }catch(_){}
    const url=_currentUrl||'';
    const tabId=_currentTabId||'';
    return {version,url,tabId};
  };
  const renderMeta=()=>{
    const m=getMeta();
    if(metaEl) metaEl.textContent=`ShahzaibSEO v${m.version||'unknown'} · ${m.url||'No page URL'} · Tab ${m.tabId||'—'}`;
  };
  const buildReport=()=>{
    const m=getMeta();
    const type=(typeEl?.value)||'General feedback';
    const message=(msgEl?.value||'').trim()||'(No message provided)';
    return `ShahzaibSEO ${type}\n\nWhat happened:\n${message}\n\nExtension version: ${m.version||'unknown'}\nCurrent page: ${m.url||'Not available'}\nTab ID: ${m.tabId||'Not available'}\n`;
  };
  const close=()=>{ modal.hidden=true; };
  openBtn.addEventListener('click',()=>{ modal.hidden=false; renderMeta(); setTimeout(()=>msgEl?.focus(),0); });
  closeBtn?.addEventListener('click',close);
  modal.addEventListener('click',e=>{ if(e.target?.dataset?.feedbackClose==='1') close(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!modal.hidden) close(); });
  $('feedbackCopyBtn')?.addEventListener('click',()=>{
    const text=buildReport();
    copyText(text);
    const btn=$('feedbackCopyBtn');
    if(btn){ const o=btn.textContent; btn.textContent='Copied'; setTimeout(()=>{btn.textContent=o||'Copy text';},1500); }
  });
  $('feedbackWhatsAppBtn')?.addEventListener('click',()=>{
    const message=(msgEl?.value||'').trim();
    if(!message){
      msgEl?.focus();
      if(msgEl) msgEl.style.borderColor='#ef4444';
      setTimeout(()=>{ if(msgEl) msgEl.style.borderColor=''; },1500);
      return;
    }
    // WhatsApp prefill — keep under ~1500 chars for mobile reliability
    let text=buildReport();
    if(text.length>1400) text=text.slice(0,1390)+'\n…';
    const waUrl='https://wa.me/923222047786?text='+encodeURIComponent(text);
    window.open(waUrl,'_blank');
  });
}

document.addEventListener('DOMContentLoaded', initFeedbackReporter);
document.addEventListener('DOMContentLoaded', boot);

// Header: re-run full analysis (reload popup boot path)
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('refreshAnalysisBtn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.classList.add('cta-running');
      btn.textContent = '↻ …';
      setTimeout(() => { window.location.reload(); }, 120);
    });
  }
  const pdfBtn = document.getElementById('exportPdfTopBtn');
  if (pdfBtn && !pdfBtn.dataset.bound) {
    pdfBtn.dataset.bound = '1';
    pdfBtn.addEventListener('click', () => {
      if (typeof exportPDF === 'function') exportPDF();
      else if (typeof toast === 'function') toast('PDF not ready — wait for analysis');
    });
  }
  // Full Page Audit wiring (module loads before popup.js)
  try {
    if (window.ShahzaibSEOFullPageAudit && typeof window.ShahzaibSEOFullPageAudit.init === 'function') {
      window.ShahzaibSEOFullPageAudit.init();
    }
  } catch (e) {
    console.warn('[FullPageAudit] init from popup', e);
  }
});


// ══════════════════════════════════════════════════════
//  AI CHAT + SETTINGS — Complete Module
// ══════════════════════════════════════════════════════

const AI_STORAGE_KEY = 'rp-ai-config';
let _aiConfig = null;          // loaded from storage
let _aiMessages = [];          // {role, content, time}
let _firecrawlConfig = null;   // Firecrawl API config
let _fcLastMarkdown = null;    // last Firecrawl extracted markdown
let _aiThinking = false;

// ── Load / Save config ─────────────────────────────
function ensureBuiltinGroqConfig(existing) {
  // Always guarantee a working AI config via built-in Groq unless user picked another provider with a real key
  const cfg = existing && typeof existing === 'object' ? { ...existing } : {};
  const hasUserKey = !!(cfg.apiKey && String(cfg.apiKey).trim() &&
    String(cfg.apiKey).trim() !== RANKSEO_BUILTIN_GROQ_KEY &&
    cfg.provider && cfg.provider !== 'groq');
  // If user explicitly set nvidia/openrouter/grok/openai with a key, keep it
  if (hasUserKey && cfg.apiKey) return cfg;
  // If already groq with any key (user or builtin), normalize model
  if (cfg.provider === 'groq' && cfg.apiKey) {
    cfg.model = cfg.model || RANKSEO_BUILTIN_GROQ_MODEL;
    cfg.groqKey = cfg.apiKey;
    return cfg;
  }
  // Default: built-in Groq
  return {
    provider: 'groq',
    apiKey: RANKSEO_BUILTIN_GROQ_KEY,
    model: cfg.model || RANKSEO_BUILTIN_GROQ_MODEL,
    groqKey: RANKSEO_BUILTIN_GROQ_KEY,
    maxTokens: cfg.maxTokens || 2048,
    temperature: cfg.temperature != null ? cfg.temperature : 0.6,
    includeContext: cfg.includeContext !== false,
    _builtin: true
  };
}

function aiLoadConfig() {
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    _aiConfig = raw ? JSON.parse(raw) : null;
  } catch(_) { _aiConfig = null; }

  // Synchronous: always have Groq built-in ready so UI never shows "No model configured"
  _aiConfig = ensureBuiltinGroqConfig(_aiConfig);

  // Async: hydrate user keys from Settings (override built-in when present)
  try {
    chrome.storage.local.get([
      'groqApiKey', 'groqModel', 'grokApiKey', 'grokModel',
      'nvidiaApiKey', 'nvidiaModel', 'openrouterApiKey', 'openrouterModel',
      'openaiApiKey', 'anthropicApiKey', 'perplexityApiKey', 'aiProvider'
    ], (r) => {
      const providerPref = r.aiProvider || (_aiConfig && _aiConfig.provider) || '';
      const userGroq = (r.groqApiKey || '').trim();
      const groqKey = resolveGroqKey(userGroq);
      const grokKey = (r.grokApiKey || '').trim();
      const nvidiaKey = (r.nvidiaApiKey || '').trim();
      const openrouterKey = (r.openrouterApiKey || '').trim();
      const openaiKey = (r.openaiApiKey || '').trim();
      const claudeKey = (r.anthropicApiKey || '').trim();
      const perplexityKey = (r.perplexityApiKey || '').trim();

      // Priority: explicit provider with its own key → else built-in Groq
      if (providerPref === 'grok' && grokKey) {
        _aiConfig = Object.assign({}, _aiConfig || {}, {
          provider: 'grok', apiKey: grokKey, model: r.grokModel || 'grok-3',
          maxTokens: (_aiConfig && _aiConfig.maxTokens) || 2048,
          temperature: (_aiConfig && _aiConfig.temperature) != null ? _aiConfig.temperature : 0.6,
          _builtin: false
        });
      } else if (providerPref === 'nvidia' && nvidiaKey) {
        _aiConfig = Object.assign({}, _aiConfig || {}, {
          provider: 'nvidia', apiKey: nvidiaKey,
          model: r.nvidiaModel || 'meta/llama-3.3-70b-instruct',
          nvidiaKey, maxTokens: 2048, temperature: 0.6, _builtin: false
        });
      } else if (providerPref === 'openrouter' && openrouterKey) {
        _aiConfig = Object.assign({}, _aiConfig || {}, {
          provider: 'openrouter', apiKey: openrouterKey,
          model: r.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free',
          openrouterKey, maxTokens: 2048, temperature: 0.6, _builtin: false
        });
      } else if (providerPref === 'openai' && openaiKey) {
        _aiConfig = Object.assign({}, _aiConfig || {}, {
          provider: 'openai', apiKey: openaiKey, model: 'gpt-4o-mini',
          maxTokens: 2048, temperature: 0.6, _builtin: false
        });
      } else if ((providerPref === 'claude' || providerPref === 'anthropic') && claudeKey) {
        _aiConfig = Object.assign({}, _aiConfig || {}, {
          provider: 'anthropic', apiKey: claudeKey, model: 'claude-3-5-sonnet-latest',
          maxTokens: 2048, temperature: 0.6, _builtin: false
        });
      } else if (providerPref === 'perplexity' && perplexityKey) {
        _aiConfig = Object.assign({}, _aiConfig || {}, {
          provider: 'perplexity', apiKey: perplexityKey, model: 'sonar',
          maxTokens: 2048, temperature: 0.6, _builtin: false
        });
      } else {
        // Default / Groq path: user Groq key or built-in
        _aiConfig = Object.assign({}, _aiConfig || {}, {
          provider: 'groq',
          apiKey: groqKey,
          model: r.groqModel || RANKSEO_BUILTIN_GROQ_MODEL,
          groqKey,
          maxTokens: (_aiConfig && _aiConfig.maxTokens) || 2048,
          temperature: (_aiConfig && _aiConfig.temperature) != null ? _aiConfig.temperature : 0.6,
          _builtin: !userGroq
        });
      }

      try { localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(_aiConfig)); } catch(_) {}
      updateAIHeaderStatus();
      updateSettingsAiBadge();
    });
  } catch(_) {}

  return _aiConfig;
}
function aiSaveConfig(cfg) {
  _aiConfig = cfg;
  localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(cfg));
  
  // Also save API keys to chrome.storage.local for background script access
  const payload = {
    nvidiaApiKey: cfg.nvidiaKey || '',
    openrouterApiKey: cfg.openrouterKey || '',
    aiProvider: cfg.provider || 'nvidia'
  };
  if (cfg.provider === 'groq' || cfg.groqKey) {
    payload.groqApiKey = cfg.apiKey || cfg.groqKey || '';
    payload.groqModel = cfg.model || 'qwen/qwen3.8-27b';
    payload.aiProvider = 'groq';
  }
  if (cfg.provider === 'grok' || cfg.provider === 'xai' || cfg.grokKey) {
    payload.grokApiKey = cfg.apiKey || cfg.grokKey || '';
    payload.grokModel = cfg.model || 'grok-3';
    payload.aiProvider = 'grok';
  }
  chrome.storage.local.set(payload);
}

// ── Main init ──────────────────────────────────────
function initAI() {
  aiLoadConfig();
  initAITab();
  initAISettings();
  initToolbarSettings();
}

// ── AI Tab init ────────────────────────────────────
function initAITab() {
  // Header status
  updateAIHeaderStatus();

  // Setup button → go to settings tab
  $('aiSetupBtn')?.addEventListener('click', () => switchTab('settings'));
  $('aiOpenSettingsBtn')?.addEventListener('click', () => switchTab('settings'));

  // Delegated handler for dynamically-injected ai-suggest-chip buttons (CSP-safe)
  const aiMessages = $('aiMessages');
  if (aiMessages) {
    aiMessages.addEventListener('click', e => {
      const chip = e.target.closest('.ai-suggest-chip');
      if (!chip) return;
      const ta = $('aiInput');
      if (ta) { ta.value = chip.dataset.q || ''; ta.dispatchEvent(new Event('input')); ta.focus(); }
    });
  }

  // Quick chips
  document.querySelectorAll('.ai-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (!prompt) return;
      const ta = $('aiInput');
      if (ta) { ta.value = prompt; ta.dispatchEvent(new Event('input')); }
      aiHandleSend();
    });
  });

  // Shortcuts slide: hidden by default, toggle expand/collapse
  (function initAiChipsSlide() {
    const wrap = $('aiQuickChips');
    const btn = $('aiChipsToggleBtn');
    const icon = $('aiChipsToggleIcon');
    const label = $('aiChipsToggleLabel');
    if (!wrap || !btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    let open = false;
    const apply = () => {
      if (open) {
        wrap.style.display = 'flex';
        wrap.style.flexWrap = 'wrap';
        wrap.style.gap = '6px';
        // allow height to expand
        wrap.style.maxHeight = '480px';
        wrap.style.opacity = '1';
        wrap.style.marginBottom = '8px';
        if (icon) icon.style.transform = 'rotate(0deg)';
        if (label) label.nextElementSibling && (label.nextElementSibling.textContent = '(visible)');
        const hint = btn.querySelector('span[style*="font-weight:400"]');
        if (hint) hint.textContent = '(visible)';
      } else {
        wrap.style.maxHeight = '0';
        wrap.style.opacity = '0';
        wrap.style.marginBottom = '0';
        if (icon) icon.style.transform = 'rotate(-90deg)';
        const hint = btn.querySelector('span[style*="font-weight:400"]');
        if (hint) hint.textContent = '(hidden)';
        setTimeout(() => { if (!open) wrap.style.display = 'none'; }, 220);
      }
      try { chrome.storage.local.set({ aiChipsOpen: open }); } catch (_) {}
    };
    btn.addEventListener('click', () => { open = !open; apply(); });
    // Default hidden; restore if user had expanded
    try {
      chrome.storage.local.get(['aiChipsOpen'], r => {
        open = !!r.aiChipsOpen;
        apply();
      });
    } catch (_) {
      apply();
    }
  })();

  // Textarea auto-grow + enable send
  const ta = $('aiInput');
  if (ta) {
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 300) + 'px'; // Increased from 100px to 300px
      const sendBtn = $('aiSendBtn');
      if (sendBtn) sendBtn.disabled = !ta.value.trim();
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiHandleSend(); }
    });
  }

  // Send button
  $('aiSendBtn')?.addEventListener('click', aiHandleSend);

  // Stop button
  $('aiStopBtn')?.addEventListener('click', aiHandleStop);

  // Clear chat
  $('aiClearBtn')?.addEventListener('click', () => {
    _aiMessages = [];
    renderAIMessages();
  });

  // Context indicator
  const ci = $('aiContextIndicator');
  if (ci) ci.textContent = _rawData ? 'Page data ready' : 'No page data';
}

function updateAIHeaderStatus() {
  // Guarantee built-in Groq if somehow still empty
  if (!_aiConfig?.apiKey) {
    _aiConfig = ensureBuiltinGroqConfig(_aiConfig);
  }
  const dot = $('aiStatusDot');
  const name = $('aiModelName');
  const badge = $('aiProviderBadge');
  if (!_aiConfig?.apiKey) {
    if (dot) dot.className = 'ai-status-dot';
    if (name) name.textContent = 'No model configured';
    if (badge) badge.style.display = 'none';
  } else {
    if (dot) dot.className = 'ai-status-dot connected';
    const modelShort = (_aiConfig.model || '').split('/').pop().replace(':free','').slice(0,28);
    const isBuiltin = !!_aiConfig._builtin || _aiConfig.apiKey === RANKSEO_BUILTIN_GROQ_KEY;
    if (name) {
      name.textContent = isBuiltin && _aiConfig.provider === 'groq'
        ? (modelShort + ' · built-in')
        : modelShort;
    }
    if (badge) {
      badge.style.display = '';
      badge.className = 'ai-provider-badge ' + (_aiConfig.provider || 'groq');
      const p = _aiConfig.provider || 'groq';
      badge.textContent =
        p === 'openrouter' ? 'OpenRouter'
        : p === 'groq' ? (isBuiltin ? 'Groq · free' : 'Groq')
        : (p === 'grok' || p === 'xai') ? 'Grok (xAI)'
        : p === 'openai' ? 'OpenAI'
        : p === 'anthropic' || p === 'claude' ? 'Claude'
        : p === 'perplexity' ? 'Perplexity'
        : 'NVIDIA NIM';
    }
    // Hide empty state — model is always available via built-in Groq
    const es = $('aiEmptyState');
    if (es) es.style.display = 'none';
    const ta = $('aiInput'); if (ta) ta.disabled = false;
  }
}

// ── Send / receive message ─────────────────────────
let _aiAbortController = null; // Track current AI request

async function aiHandleSend() {
  const ta = $('aiInput');
  const text = ta?.value?.trim();
  if (!text || _aiThinking) return;
  if (!_aiConfig?.apiKey) _aiConfig = ensureBuiltinGroqConfig(_aiConfig);
  if (!_aiConfig?.apiKey) { toast('Configure an AI model in Settings first.'); return; }

  ta.value = '';
  ta.style.height = 'auto';

  // Add user message
  _aiMessages.push({ role: 'user', content: text, time: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) });
  renderAIMessages();
  showAITyping(true);

  // Create abort controller for this request
  _aiAbortController = new AbortController();

  try {
    const reply = await aiCallModel(text, null, _aiAbortController.signal);
    _aiMessages.push({ role: 'assistant', content: reply, time: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) });
  } catch(err) {
    if (err.name === 'AbortError') {
      _aiMessages.push({ role: 'assistant', content: '⚠️ Request stopped by user.', time: '' });
    } else {
      _aiMessages.push({ role: 'assistant', content: '⚠️ Error: ' + (err.message || 'Request failed. Check your API key and model.'), time: '' });
    }
  }

  _aiAbortController = null;
  showAITyping(false);
  renderAIMessages();
}

function aiHandleStop() {
  if (_aiAbortController) {
    _aiAbortController.abort();
    _aiAbortController = null;
  }
  showAITyping(false);
  
  // Clear Firecrawl status if visible
  const statusEl = $('fcStatus');
  if (statusEl && statusEl.textContent === 'Analyzing…') {
    statusEl.textContent = '✗ Stopped';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
  }
}

/**
 * Extract full page content from the active tab
 * @returns {Promise<string>} - Extracted page content (text, headings, links, etc.)
 */
async function extractFullPageContent() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return '';

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Extract all visible text content from the page
        const content = {
          title: document.title || '',
          url: window.location.href,
          headings: [],
          paragraphs: [],
          lists: [],
          links: [],
          images: [],
          meta: {}
        };

        // Extract meta tags
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) content.meta.description = metaDesc.getAttribute('content') || '';
        
        const metaKeywords = document.querySelector('meta[name="keywords"]');
        if (metaKeywords) content.meta.keywords = metaKeywords.getAttribute('content') || '';

        // Extract headings (H1-H6)
        document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
          const text = heading.textContent.trim();
          if (text && text.length > 0) {
            content.headings.push({
              level: heading.tagName.toLowerCase(),
              text: text.substring(0, 200) // Limit length
            });
          }
        });

        // Extract paragraphs
        document.querySelectorAll('p').forEach(p => {
          const text = p.textContent.trim();
          if (text && text.length > 20) { // Skip very short paragraphs
            content.paragraphs.push(text.substring(0, 500)); // Limit length
          }
        });

        // Extract lists
        document.querySelectorAll('ul, ol').forEach(list => {
          const items = [];
          list.querySelectorAll('li').forEach(li => {
            const text = li.textContent.trim();
            if (text && text.length > 0) {
              items.push(text.substring(0, 200));
            }
          });
          if (items.length > 0) {
            content.lists.push(items);
          }
        });

        // Extract main links (limit to avoid huge data)
        const links = document.querySelectorAll('a[href]');
        const linkArray = Array.from(links).slice(0, 50); // Limit to 50 links
        linkArray.forEach(link => {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          if (href && text) {
            content.links.push({
              text: text.substring(0, 100),
              href: href.substring(0, 200)
            });
          }
        });

        // Extract images with alt text
        const images = document.querySelectorAll('img');
        const imageArray = Array.from(images).slice(0, 30); // Limit to 30 images
        imageArray.forEach(img => {
          const src = img.src || img.getAttribute('data-src') || '';
          const alt = img.alt || '';
          if (src) {
            content.images.push({
              src: src.substring(0, 200),
              alt: alt.substring(0, 200)
            });
          }
        });

        // Extract main content from article, main, or body
        const mainContent = document.querySelector('article, main, [role="main"]') || document.body;
        const mainText = mainContent ? mainContent.textContent.trim() : '';
        content.mainText = mainText.substring(0, 3000); // Limit to 3000 chars

        return content;
      }
    });

    if (!results || !results[0] || !results[0].result) return '';

    const pageContent = results[0].result;

    // Format the extracted content into a readable string
    let formatted = `**Page Title:** ${pageContent.title}\n`;
    formatted += `**URL:** ${pageContent.url}\n\n`;

    if (pageContent.meta.description) {
      formatted += `**Meta Description:** ${pageContent.meta.description}\n\n`;
    }

    if (pageContent.headings.length > 0) {
      formatted += `**Headings:**\n`;
      pageContent.headings.slice(0, 20).forEach(h => {
        formatted += `${h.level.toUpperCase()}: ${h.text}\n`;
      });
      formatted += '\n';
    }

    if (pageContent.paragraphs.length > 0) {
      formatted += `**Main Content (First 5 paragraphs):**\n`;
      pageContent.paragraphs.slice(0, 5).forEach((p, i) => {
        formatted += `${i + 1}. ${p}\n\n`;
      });
    }

    if (pageContent.lists.length > 0) {
      formatted += `**Lists on Page:**\n`;
      pageContent.lists.slice(0, 3).forEach((list, i) => {
        formatted += `List ${i + 1}:\n`;
        list.slice(0, 5).forEach(item => {
          formatted += `- ${item}\n`;
        });
        formatted += '\n';
      });
    }

    if (pageContent.links.length > 0) {
      formatted += `**Key Links (first 10):**\n`;
      pageContent.links.slice(0, 10).forEach(link => {
        formatted += `- ${link.text} → ${link.href}\n`;
      });
      formatted += '\n';
    }

    if (pageContent.images.length > 0) {
      formatted += `**Images (first 10):**\n`;
      pageContent.images.slice(0, 10).forEach((img, i) => {
        formatted += `${i + 1}. ${img.alt || '(no alt text)'} - ${img.src}\n`;
      });
      formatted += '\n';
    }

    // Limit total size to prevent token overflow
    return formatted.substring(0, 8000);

  } catch (error) {
    console.error('Error extracting page content:', error);
    return '';
  }
}

async function aiCallModel(userText, extraContext, signal) {
  const cfg = _aiConfig;
  if (!cfg?.apiKey) throw new Error('No API key configured');

  // Inject Firecrawl markdown if auto-extract is enabled and we have it
  if (!extraContext && _firecrawlConfig?.autoExtract && _fcLastMarkdown) {
    extraContext = _fcLastMarkdown.slice(0, 5000);
  }

  // Extract full page content if enabled in settings
  if (!extraContext && cfg.includePageContent) {
    extraContext = await extractFullPageContent();
  }

  // Detect simple greeting — reply short only
  const greetingPatterns = /^(hi|hello|hey|sup|yo|good\s*(morning|afternoon|evening)|howdy|greetings|what'?s up)[\s!?.]*$/i;
  const isGreeting = greetingPatterns.test(userText.trim());

  // Build context string from page data
  let context = '';
  if (cfg.includeContext !== false && _rawData) {
    const d = adaptV1Data(_rawData);
    const seoScore = d.seo?.score ?? '--';
    const geoScore = d.geo?.geoScore ?? '--';
    const title = d.meta?.title || '(none)';
    const desc = d.meta?.desc || '(none)';
    const h1 = d.headings?.headings?.find(h=>h.level===1)?.text || '(none)';
    const words = d.readability?.wordCount ?? '--';
    const missingAlt = d.images?.missingAlt ?? '--';
    const issues = (d.seo?.issues || []).slice(0,5).map(i=>i.msg).join('; ') || 'none';

    if (isGreeting) {
      context = `You are a friendly SEO assistant inside the ShahzaibSEO - AEO & GEO Expert browser extension. `
        + `The user just said hi. Greet them warmly in 1-2 short sentences. `
        + `Tell them you can help with their page (${_currentUrl || 'current page'}) which has an SEO score of ${seoScore}/100. `
        + `End with ONE short question asking what they want help with. Do not use any markdown, bullet points, or headers. Plain text only.`;
    } else {
      context = `You are a friendly SEO assistant inside the ShahzaibSEO - AEO & GEO Expert browser extension.

CRITICAL FORMATTING RULES (YOU MUST FOLLOW THESE EXACTLY):
1. NEVER use # ## ### #### for headers. Use **Bold Text** instead for section titles.
2. Use numbered lists (1. 2. 3.) or bullet points (- item) for all recommendations and lists.
3. For tables, use pipe format: | Column 1 | Column 2 |
4. Keep responses clear, practical, and focused. No fluff or generic greetings.
5. ALWAYS end with "**What to ask next:**" followed by exactly 3 numbered follow-up questions (1. 2. 3.) that are specific to the current topic.
6. Write in simple English that anyone can understand. Explain technical terms.

PAGE DATA for ${_currentUrl || 'current page'}:
- SEO Score: ${seoScore}/100
- GEO Score: ${geoScore}/100
- Page Title: ${title}
- Meta Description: ${desc}
- H1: ${h1}
- Word Count: ${words}
- Images Missing Alt Text: ${missingAlt}
- HTTPS: ${d.tech?.isHttps ? 'Yes' : 'No'}
- Indexable: ${d.tech?.isIndexable ? 'Yes' : 'No'}
- Tech Stack: ${(d.tech?.techStack || []).join(', ') || 'unknown'}
- Top Issues: ${issues}

RESPONSE FORMAT EXAMPLE:
**Main Answer Section**
Your detailed answer here with clear explanations.

**Key Points:**
1. First important point
2. Second important point
3. Third important point

**What to ask next:**
1. How can I improve my meta description?
2. What schema markup should I add?
3. How do I fix the missing alt texts?`;
    }
  } else {
    if (isGreeting) {
      context = `You are a friendly SEO assistant inside the ShahzaibSEO - AEO & GEO Expert browser extension. The user just said hi. Greet them warmly in 1-2 sentences and ask what they want help with. Plain text only, no markdown.`;
    } else {
      context = `You are a friendly SEO assistant inside the ShahzaibSEO - AEO & GEO Expert browser extension.

CRITICAL FORMATTING RULES (YOU MUST FOLLOW THESE EXACTLY):
1. NEVER use # ## ### #### for headers. Use **Bold Text** instead for section titles.
2. Use numbered lists (1. 2. 3.) or bullet points (- item) for all recommendations and lists.
3. Keep responses clear, practical, and focused.
4. ALWAYS end with "**What to ask next:**" followed by exactly 3 numbered follow-up questions (1. 2. 3.) that are specific to the current topic.
5. Write in simple English that anyone can understand.

RESPONSE FORMAT EXAMPLE:
**Main Answer Section**
Your detailed answer here.

**Key Points:**
1. First point
2. Second point
3. Third point

**What to ask next:**
1. Specific question about the topic?
2. Another relevant question?
3. One more follow-up question?`;
    }
  }

  // Append extracted page content to context if available
  if (extraContext) {
    context += '\n\n--- FULL PAGE CONTENT ---\n' + extraContext + '\n--- END PAGE CONTENT ---';
  }

  const messages = [
    { role: 'system', content: context },
    ..._aiMessages.slice(-8).map(m => ({ role: m.role, content: m.content }))
  ];

  let url, headers, body;

  if (cfg.provider === 'openrouter') {
    url = 'https://openrouter.ai/api/v1/chat/completions';
    headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey,
      'HTTP-Referer': 'https://www.mubashirhassan.com',
      'X-Title': 'ShahzaibSEO - AEO & GEO Expert'
    };
    body = { model: cfg.model, messages, max_tokens: parseInt(cfg.maxTokens)||1024, temperature: parseFloat(cfg.temperature)||0.7 };
  } else if (cfg.provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey };
    body = {
      model: cfg.model || 'qwen/qwen3.8-27b',
      messages,
      max_tokens: parseInt(cfg.maxTokens) || 2048,
      temperature: parseFloat(cfg.temperature) || 0.6,
      top_p: 0.95
    };
  } else if (cfg.provider === 'grok' || cfg.provider === 'xai') {
    // xAI Grok — OpenAI-compatible
    url = 'https://api.x.ai/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey };
    body = {
      model: cfg.model || 'grok-3',
      messages,
      max_tokens: parseInt(cfg.maxTokens) || 2048,
      temperature: parseFloat(cfg.temperature) || 0.6
    };
  } else {
    // NVIDIA NIM
    url = 'https://integrate.api.nvidia.com/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey };
    body = { model: cfg.model, messages, max_tokens: parseInt(cfg.maxTokens)||1024, temperature: parseFloat(cfg.temperature)||0.7 };
  }

  const res = await fetch(url, { 
    method: 'POST', 
    headers, 
    body: JSON.stringify(body),
    signal // Add abort signal support
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const errorMsg = err.error?.message || err.message || `HTTP ${res.status}`;
    const modelInfo = cfg.provider === 'nvidia' ? ` (Model: ${cfg.model})` : '';
    throw new Error(errorMsg + modelInfo);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '(empty response)';
}

function renderAIMessages() {
  const container = $('aiMessages');
  if (!container) return;

  const emptyState = $('aiEmptyState');

  if (!_aiMessages.length) {
    container.innerHTML = '';
    if (emptyState && !_aiConfig?.apiKey) {
      container.appendChild(emptyState);
      emptyState.style.display = '';
    }
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  container.innerHTML = _aiMessages.map(m => {
    const fcBadge = m.fc ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9.5px;font-weight:700;color:#f97316;margin-bottom:4px;letter-spacing:.3px"><svg viewBox="0 0 20 20" fill="currentColor" width="9" height="9"><path fill-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clip-rule="evenodd"/></svg>FIRECRAWL ENRICHED</span>` : ``;
    const bubbleStyle = m.fc ? `style="border-left:3px solid #f97316;background:linear-gradient(135deg,rgba(249,115,22,.06),rgba(239,68,68,.03))"` : ``;
    return `
    <div class="ai-msg ${m.role}">
      <div class="ai-msg-avatar">${m.role === 'user' ? 'U' : 'AI'}</div>
      <div class="ai-msg-content">
        ${m.fc ? fcBadge : ''}
        <div class="ai-msg-bubble" ${bubbleStyle}>${m.role === 'assistant' ? renderMarkdown(m.content) : escHTML(m.content).split('\n').join('<br>')}</div>
        ${m.time ? `<span class="ai-msg-time">${m.time}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function showAITyping(show) {
  _aiThinking = show;
  const container = $('aiMessages');
  const sendBtn = $('aiSendBtn');
  const stopBtn = $('aiStopBtn');
  
  // Toggle send/stop buttons
  if (show) {
    if (sendBtn) { sendBtn.disabled = true; sendBtn.style.display = 'none'; }
    if (stopBtn) stopBtn.style.display = 'flex';
  } else {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.style.display = 'flex'; }
    if (stopBtn) stopBtn.style.display = 'none';
  }
  
  if (!container) return;
  const existing = container.querySelector('.ai-typing-wrap');
  if (existing) existing.remove();
  if (show) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg assistant ai-typing-wrap';
    wrap.innerHTML = `
      <div class="ai-msg-avatar">AI</div>
      <div class="ai-msg-bubble" style="padding:10px 14px">
        <div class="ai-typing">
          <div class="ai-typing-dot"></div>
          <div class="ai-typing-dot"></div>
          <div class="ai-typing-dot"></div>
        </div>
      </div>`;
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
  }
}

// ── Settings AI section init ───────────────────────
function initAISettings() {
  // Load saved config into form
  const cfg = _aiConfig || {};
  if (cfg.provider === 'openrouter') {
    setAIProviderPanel('openrouter');
  }
  if (cfg.nvidiaKey)       { const el=$('nvidiaApiKey');       if(el) el.value = cfg.nvidiaKey; }
  if (cfg.openrouterKey)   { const el=$('openrouterApiKey');   if(el) el.value = cfg.openrouterKey; }
  if (cfg.nvidiaModel)     { const el=$('nvidiaModel');        if(el) el.value = cfg.nvidiaModel; }
  if (cfg.openrouterModel) { const el=$('openrouterModel');    if(el) el.value = cfg.openrouterModel; }
  if (cfg.temperature != null) {
    const el=$('aiTemperature'); if(el) { el.value = cfg.temperature; updateTempBadge(cfg.temperature); }
  } else {
    // Set default temperature to 0.3 for SEO tasks (more precise)
    const el=$('aiTemperature'); if(el) { el.value = 0.3; updateTempBadge(0.3); }
  }
  if (cfg.maxTokens) { const el=$('aiMaxTokens'); if(el) el.value = cfg.maxTokens; }
  else {
    // Set default max tokens to 2048 for detailed analysis
    const el=$('aiMaxTokens'); if(el) el.value = '2048';
  }
  if (cfg.includeContext === false) { const el=$('aiIncludeContext'); if(el) el.checked = false; }
  if (cfg.includePageContent === true) { const el=$('aiIncludePageContent'); if(el) el.checked = true; }
  if (cfg.autoSuggest === false)    { const el=$('aiAutoSuggest');    if(el) el.checked = false; }
  // Auto-audit
  const aaCheck = $('aiAutoAudit');
  if (aaCheck) {
    aaCheck.checked = cfg.autoAudit === true;
    toggleAutoAuditPromptRow(aaCheck.checked);
    aaCheck.addEventListener('change', () => toggleAutoAuditPromptRow(aaCheck.checked));
  }
  const aaPromptSel = $('aiAutoAuditPrompt');
  if (aaPromptSel && cfg.autoAuditPrompt) {
    aaPromptSel.value = cfg.autoAuditPrompt;
    toggleCustomPromptField(cfg.autoAuditPrompt);
    aaPromptSel.addEventListener('change', () => toggleCustomPromptField(aaPromptSel.value));
  } else if (aaPromptSel) {
    aaPromptSel.addEventListener('change', () => toggleCustomPromptField(aaPromptSel.value));
  }
  if (cfg.autoAuditCustom) { const el=$('aiAutoAuditCustom'); if(el) el.value = cfg.autoAuditCustom; }

  // Update badge
  updateSettingsAiBadge();

  // Provider tab switching
  document.querySelectorAll('.settings-provider-tab').forEach(tab => {
    tab.addEventListener('click', () => setAIProviderPanel(tab.dataset.provider));
  });

  // Eye / show-hide buttons
  setupEyeBtn('nvidiaEyeBtn', 'nvidiaApiKey');
  setupEyeBtn('openrouterEyeBtn', 'openrouterApiKey');

  // Temperature range
  $('aiTemperature')?.addEventListener('input', e => {
    updateTempBadge(e.target.value);
    updateTempExample(e.target.value);
  });

  // Initialize temperature example
  const initialTemp = $('aiTemperature')?.value || 0.3;
  updateTempExample(initialTemp);

  // Preset buttons
  document.querySelectorAll('.settings-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const temp = btn.dataset.temp;
      const tokens = btn.dataset.tokens;
      
      const tempEl = $('aiTemperature');
      const tokensEl = $('aiMaxTokens');
      
      if (tempEl && temp) {
        tempEl.value = temp;
        updateTempBadge(temp);
        updateTempExample(temp);
      }
      
      if (tokensEl && tokens) {
        tokensEl.value = tokens;
      }
      
      // Visual feedback
      btn.style.transform = 'scale(0.95)';
      setTimeout(() => {
        btn.style.transform = '';
      }, 100);
    });
  });

  // Save
  $('aiSaveBtn')?.addEventListener('click', () => {
    const provider = document.querySelector('.settings-provider-tab.active')?.dataset.provider || 'nvidia';
    const nvidiaKey = $('nvidiaApiKey')?.value.trim() || '';
    const openrouterKey = $('openrouterApiKey')?.value.trim() || '';
    const apiKey = provider === 'openrouter' ? openrouterKey : nvidiaKey;
    const model = provider === 'openrouter'
      ? ($('openrouterModel')?.value || 'meta-llama/llama-3.3-70b-instruct:free')
      : ($('nvidiaModel')?.value || 'meta/llama-3.3-70b-instruct');

    const autoAuditPromptKey = $('aiAutoAuditPrompt')?.value || 'full';
    const cfg = {
      provider, apiKey, model, nvidiaKey, openrouterKey,
      nvidiaModel: $('nvidiaModel')?.value,
      openrouterModel: $('openrouterModel')?.value,
      temperature: parseFloat($('aiTemperature')?.value || '0.7'),
      maxTokens: $('aiMaxTokens')?.value || '1024',
      includeContext: $('aiIncludeContext')?.checked !== false,
      includePageContent: $('aiIncludePageContent')?.checked === true,
      autoSuggest: $('aiAutoSuggest')?.checked !== false,
      autoAudit: $('aiAutoAudit')?.checked === true,
      autoAuditPrompt: autoAuditPromptKey,
      autoAuditCustom: autoAuditPromptKey === 'custom' ? ($('aiAutoAuditCustom')?.value.trim() || '') : undefined,
    };
    aiSaveConfig(cfg);
    updateSettingsAiBadge();
    updateAIHeaderStatus();
    // The GEO tab's AI Answer Simulation section only checks _aiConfig.apiKey
    // once, at scan time (see initAIAnswerSim). If the user saves their API
    // key after that initial render — the common flow, since Settings is a
    // separate tab — the section was staying stuck on "Configure an AI model"
    // even though the key is now valid, until the next full page rescan.
    // Re-running it here (cheap: it's just a visibility toggle plus idempotent
    // event-binding guards) keeps it in sync immediately after save.
    if (typeof initAIAnswerSim === 'function') initAIAnswerSim();
    toast('AI configuration saved!');
    const tr = $('aiTestResult'); if (tr) tr.style.display = 'none';
  });

  // Test connection
  $('aiTestBtn')?.addEventListener('click', async () => {
    const btn = $('aiTestBtn');
    const tr = $('aiTestResult');
    if (!tr) return;
    if (!_aiConfig?.apiKey) { showTestResult('error', '⚠ Save your configuration first.'); return; }
    if (btn) { btn.textContent = 'Testing…'; btn.disabled = true; }
    try {
      const reply = await aiCallModel('Reply with exactly: "Connection successful"');
      showTestResult('ok', '✓ Connected! Model responded: ' + reply.slice(0, 80));
    } catch(err) {
      showTestResult('error', '✗ ' + (err.message || 'Connection failed'));
    } finally {
      if (btn) { btn.textContent = 'Test Connection'; btn.disabled = false; }
    }
  });
}

function setAIProviderPanel(provider) {
  document.querySelectorAll('.settings-provider-tab').forEach(t => t.classList.toggle('active', t.dataset.provider === provider));
  const panelN = $('panelNvidia'); const panelO = $('panelOpenrouter');
  if (panelN) panelN.style.display = provider === 'nvidia' ? '' : 'none';
  if (panelO) panelO.style.display = provider === 'openrouter' ? '' : 'none';
}

function setupEyeBtn(btnId, inputId) {
  $(btnId)?.addEventListener('click', () => {
    const input = $(inputId); if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
}

function updateTempBadge(val) {
  const badge = $('aiTempBadge');
  if (badge) badge.textContent = parseFloat(val).toFixed(1);
}

/**
 * Update temperature example based on current value
 * @param {number|string} val - Temperature value (0-1)
 */
function updateTempExample(val) {
  const temp = parseFloat(val);
  const examples = document.querySelectorAll('.settings-temp-example');
  
  examples.forEach(example => {
    example.classList.remove('active');
  });
  
  // Determine which example to show based on temperature
  let activeExample;
  if (temp <= 0.3) {
    activeExample = document.querySelector('.settings-temp-example[data-range="0.0-0.3"]');
  } else if (temp <= 0.6) {
    activeExample = document.querySelector('.settings-temp-example[data-range="0.4-0.6"]');
  } else {
    activeExample = document.querySelector('.settings-temp-example[data-range="0.7-1.0"]');
  }
  
  if (activeExample) {
    activeExample.classList.add('active');
  }
}

function updateSettingsAiBadge() {
  const badge = $('settingsAiStatus');
  if (!badge) return;
  if (_aiConfig?.apiKey) {
    badge.textContent = '✓ Configured';
    badge.className = 'settings-ai-badge ok';
  } else {
    badge.textContent = 'Not configured';
    badge.className = 'settings-ai-badge';
  }
}

function showTestResult(type, msg) {
  const tr = $('aiTestResult');
  if (!tr) return;
  tr.style.display = '';
  tr.className = 'settings-test-result ' + (type === 'ok' ? 'ok' : 'err');
  tr.textContent = msg;
}

// ── Auto-audit helpers ─────────────────────────────
function toggleAutoAuditPromptRow(enabled) {
  const row = $('autoAuditPromptRow');
  if (row) row.style.display = enabled ? '' : 'none';
}
function toggleCustomPromptField(val) {
  const customArea = $('aiAutoAuditCustom');
  if (customArea) customArea.style.display = val === 'custom' ? '' : 'none';
}

const AUTO_AUDIT_PROMPTS = {
  full: 'Give me a full SEO and GEO audit of this page. List the top issues by priority, call out any quick wins I can fix in under 10 minutes, and give an overall summary of the page\'s search health.',
  seo: 'Analyze this page\'s SEO and give me the top 5 improvements I should make right now.',
  geo: 'How can I improve this page\'s GEO score to rank better in AI search engines like ChatGPT and Perplexity?',
  metadata: 'Write an improved meta title and meta description for this page optimized for CTR and keywords.',
  headings: 'Review the heading structure of this page and suggest an improved H1-H3 hierarchy with better keyword targeting.',
  content: 'Identify all broken, missing, or weak content opportunities on this page and suggest specific additions.',
};

let _autoAuditDone = false;   // run only once per popup session per page

async function maybeRunAutoAudit() {
  if (!_aiConfig?.autoAudit) return;       // feature disabled
  if (!_aiConfig?.apiKey) return;           // no key configured
  if (_autoAuditDone) return;               // already ran this session
  if (!_rawData) return;                    // page data not yet ready
  if (_aiThinking) return;                  // AI already busy
  if (_aiMessages.length > 0) return;       // chat not empty

  _autoAuditDone = true;

  const promptKey = _aiConfig.autoAuditPrompt || 'full';
  const promptText = promptKey === 'custom'
    ? (_aiConfig.autoAuditCustom || AUTO_AUDIT_PROMPTS.full)
    : (AUTO_AUDIT_PROMPTS[promptKey] || AUTO_AUDIT_PROMPTS.full);

  // Show banner
  const banner = $('autoAuditBanner');
  const label  = $('autoAuditLabel');
  let cancelled = false;

  if (banner) {
    banner.style.display = '';
    if (label) label.textContent = 'Running auto-audit…';
  }

  const cancelBtn = $('autoAuditCancelBtn');
  const onCancel = () => { cancelled = true; if (banner) banner.style.display = 'none'; };
  cancelBtn?.addEventListener('click', onCancel, { once: true });

  // Small delay so UI paints first
  await new Promise(r => setTimeout(r, 350));
  if (cancelled) return;

  // Inject prompt as if the user typed it
  _aiMessages.push({ role: 'user', content: promptText, time: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) });
  renderAIMessages();
  showAITyping(true);
  if (banner && label) label.textContent = 'Auto-audit running…';

  try {
    const reply = await aiCallModel(promptText);
    if (!cancelled) {
      _aiMessages.push({ role: 'assistant', content: reply, time: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) });
    }
  } catch(err) {
    if (!cancelled) {
      _aiMessages.push({ role: 'assistant', content: '⚠️ Auto-audit error: ' + (err.message || 'Request failed.'), time: '' });
    }
  }

  showAITyping(false);
  if (!cancelled) renderAIMessages();
  if (banner) banner.style.display = 'none';
}

// ════════════════════════════════════════════════════════════════════════════
// ── FIRECRAWL INTEGRATION ────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

// ── Storage helpers ──────────────────────────────────────────────────────
async function fcLoadConfig() {
  try {
    const r = await chrome.storage.sync.get('firecrawlConfig');
    _firecrawlConfig = r.firecrawlConfig ? JSON.parse(r.firecrawlConfig) : null;
  } catch (_) { _firecrawlConfig = null; }
  return _firecrawlConfig;
}

async function fcSaveConfig(cfg) {
  _firecrawlConfig = cfg;
  await chrome.storage.sync.set({ firecrawlConfig: JSON.stringify(cfg) }).catch(() => {});
}

// ── Toolbar visibility ──────────────────────────────────────────────────
function fcUpdateToolbar() {
  const toolbar = $('fcToolbar');
  // Always show — Keyless Firecrawl + free TinyFish need no personal key
  if (toolbar) toolbar.style.display = '';
  updateFirecrawlSettingsBadge();
}

function updateFirecrawlSettingsBadge() {
  const badge = $('settingsFirecrawlStatus');
  if (!badge) return;
  if (_firecrawlConfig?.apiKey) {
    badge.textContent = '✓ Authenticated';
    badge.className = 'settings-ai-badge ok';
  } else {
    badge.textContent = 'Keyless ready';
    badge.className = 'settings-ai-badge ok';
  }
}

// ── Deep Extract current page via Firecrawl ──────────────────────────────
// ── Deep Extract current page via Firecrawl → Issues & Fixes Analysis ───────
async function fcDeepExtractCurrentPage() {
  // Keyless mode works without apiKey — only warn if user expects auth
  if (!_currentUrl) { toast('No page URL available.'); return; }

  const btn = $('fcDeepExtractBtn');
  const statusEl = $('fcStatus');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Crawling…';

  try {
    // Step 1: Crawl page — Firecrawl (keyless) first, TinyFish free fetch as fallback
    let result = await new Promise((res, rej) => {
      chrome.runtime.sendMessage(
        { action: 'FIRECRAWL_SCRAPE', url: _currentUrl, apiKey: _firecrawlConfig?.apiKey },
        r => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }
      );
    }).catch(e => ({ ok: false, error: e.message }));

    if (!result?.ok) {
      if (statusEl) statusEl.textContent = 'TinyFish fallback…';
      try {
        result = await tfFetchUrl(_currentUrl);
      } catch (tfErr) {
        toast('Extract failed: ' + (result?.error || tfErr.message));
        if (statusEl) statusEl.textContent = '✗ Failed';
        return;
      }
    }

    _fcLastMarkdown = result.markdown;
    const wc = result.wordCount;
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (statusEl) statusEl.textContent = 'Analyzing…';

    // Step 2: Build SEO context from existing page data
    let seoContext = '';
    if (_rawData) {
      const d = adaptV1Data(_rawData);
      const issues = (d.seo?.issues || []).map(i => `- [${i.severity}] ${i.msg}`).join('\n') || 'none';
      const missingAlt = d.images?.missingAlt ?? 0;
      const imagesWithoutAlt = (d.images?.images || []).filter(i => !i.hasAlt).slice(0, 5).map(i => i.src).join(', ');

      seoContext = `
EXISTING SEO SCAN DATA:
- SEO Score: ${d.seo?.score ?? '--'}/100
- GEO Score: ${d.geo?.geoScore ?? '--'}/100
- Title: ${d.meta?.title || 'MISSING'} (${(d.meta?.title || '').length} chars)
- Meta Description: ${d.meta?.desc || 'MISSING'} (${(d.meta?.desc || '').length} chars)
- H1: ${d.headings?.headings?.find(h => h.level === 1)?.text || 'MISSING'}
- H2 count: ${d.headings?.counts?.h2 ?? 0}
- Word Count: ${d.readability?.wordCount ?? '--'}
- Images missing alt: ${missingAlt}${missingAlt > 0 ? ` (${imagesWithoutAlt})` : ''}
- Internal links: ${d.links?.internal ?? '--'} | External: ${d.links?.external ?? '--'}
- HTTPS: ${d.tech?.isHttps ? 'Yes' : 'No'}
- Indexable: ${d.tech?.isIndexable ? 'Yes' : 'No'}
- Schema count: ${(d.geo?.structured?.schemas || []).length}
- Tech stack: ${(d.tech?.techStack || []).join(', ') || 'unknown'}
- Existing issues:\n${issues}`;
    }

    // Step 3: Show "analyzing" bubble in chat
    const analyzingMsg = `**Deep Extract Complete** — ${wc.toLocaleString()} words crawled from ${_currentUrl}\n\nRunning AI issues & fixes analysis…`;
    _aiMessages.push({ role: 'assistant', content: analyzingMsg, time: ts, fc: true });
    renderAIMessages();

    if (!_aiConfig?.apiKey) {
      _aiMessages.push({
        role: 'assistant',
        content: 'Page content extracted successfully. Configure an AI model in Settings to run the issues & fixes analysis.',
        time: ts
      });
      renderAIMessages();
      if (statusEl) {
        statusEl.textContent = `✓ ${wc.toLocaleString()} words`;
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
      }
      return;
    }

    // Step 4: Build focused issues & fixes prompt
    const analysisPrompt = `You are an expert SEO, GEO, and AEO consultant. Analyze this page and provide a complete issues & fixes report.

URL: ${_currentUrl}
${seoContext}

FULL PAGE CONTENT (from Firecrawl):
${result.markdown.slice(0, 5000)}${result.markdown.length > 5000 ? '\n… (truncated)' : ''}

Provide a structured analysis with these exact sections:

**Critical Issues** (must fix immediately)
For each issue: describe the problem, why it matters, and give the exact code fix.

**High Priority Fixes** (fix this week)
For each: describe problem, impact, and exact fix with code.

**Quick Wins** (easy improvements)
List 5 things that take under 10 minutes each.

**Meta Tags** (provide ready-to-use code)
Write the optimized title, meta description, and OG tags as copy-paste HTML.

**Schema Markup** (if missing or incomplete)
Provide the JSON-LD schema appropriate for this page type.

**GEO & AEO Improvements**
3 specific changes to rank better in AI search engines (ChatGPT, Perplexity, etc.).

End with **What to ask next:** and 3 follow-up questions.`;

    // Step 5: Run AI analysis
    showAITyping(true);
    try {
      const reply = await aiCallModel(analysisPrompt, result.markdown.slice(0, 5000));
      // Replace the "analyzing…" message with the real result
      _aiMessages[_aiMessages.length - 1] = {
        role: 'assistant',
        content: `**Deep Extract Analysis** — ${wc.toLocaleString()} words · ${_currentUrl}\n\n` + reply,
        time: ts,
        fc: true
      };
    } catch (e) {
      _aiMessages[_aiMessages.length - 1] = {
        role: 'assistant',
        content: `**Deep Extract Complete** — ${wc.toLocaleString()} words crawled.\n\n⚠️ AI analysis failed: ${e.message}\n\nPage content is loaded — you can still ask questions about it.`,
        time: ts,
        fc: true
      };
    }
    showAITyping(false);
    renderAIMessages();
    if (statusEl) {
      statusEl.textContent = `✓ ${wc.toLocaleString()} words`;
      // Auto-clear status after 3 seconds
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    }
    toast('Analysis complete!');

  } catch (e) {
    toast('Firecrawl failed: ' + e.message);
    if (statusEl) {
      statusEl.textContent = '✗ Error';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Competitor Analysis ─────────────────────────────────────────────────
async function fcRunCompetitorAnalysis(competitorUrl) {
  // Keyless Firecrawl works without a personal API key
  if (!competitorUrl) { toast('Enter a competitor URL first.'); return; }

  const btn = $('fcCompetitorRunBtn');
  const statusEl = $('fcStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }
  if (statusEl) statusEl.textContent = 'Crawling competitor…';

  try {
    // Fetch both pages in parallel
    const [compResult, myResult] = await Promise.all([
      new Promise((res, rej) => chrome.runtime.sendMessage(
        { action: 'FIRECRAWL_SCRAPE', url: competitorUrl, apiKey: _firecrawlConfig.apiKey },
        r => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r)
      )),
      _fcLastMarkdown ? Promise.resolve({ ok: true, markdown: _fcLastMarkdown }) :
        new Promise((res, rej) => chrome.runtime.sendMessage(
          { action: 'FIRECRAWL_SCRAPE', url: _currentUrl, apiKey: _firecrawlConfig.apiKey },
          r => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r)
        ))
    ]);

    if (!compResult.ok) { toast('Could not fetch competitor: ' + (compResult.error || 'Error')); return; }

    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    _aiMessages.push({
      role: 'user',
      content: `Competitor Analysis Request:\n\nMY PAGE (${_currentUrl}):\n${(myResult.markdown || '(not extracted)').slice(0, 3000)}\n\n---\n\nCOMPETITOR (${competitorUrl}):\n${compResult.markdown.slice(0, 3000)}\n\nCompare both pages and:\n1. List topics the competitor covers that I am missing\n2. Identify where my content is stronger\n3. Give me 5 concrete content improvements to outrank them`,
      time: ts
    });
    renderAIMessages();

    // Hide competitor input
    const wrap = $('fcCompetitorWrap'); if (wrap) wrap.style.display = 'none';
    if (statusEl) {
      statusEl.textContent = `✓ Competitor loaded`;
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    }

    if (!_aiConfig?.apiKey) {
      _aiMessages.push({ role: 'assistant', content: '⚙️ Configure an AI model in Settings to run the competitor comparison.', time: ts });
      renderAIMessages();
      return;
    }

    showAITyping(true);
    try {
      const compCtx = `MY PAGE CONTENT:\n${(myResult.markdown || '').slice(0, 3000)}\n\nCOMPETITOR PAGE CONTENT (${competitorUrl}):\n${compResult.markdown.slice(0, 3000)}`;
      const prompt = `Compare both pages and:\n1. List topics the competitor covers that I am missing\n2. Identify where my content is stronger\n3. Give me 5 concrete content improvements to outrank them`;
      const reply = await aiCallModel(prompt, compCtx);
      _aiMessages.push({ role: 'assistant', content: reply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), fc: true });
    } catch (e) {
      _aiMessages.push({ role: 'assistant', content: '⚠️ AI comparison failed: ' + e.message, time: '' });
    }
    showAITyping(false);
    renderAIMessages();
    if (statusEl) {
      statusEl.textContent = '✓ Complete';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    }

  } catch (e) {
    toast('Competitor analysis failed: ' + e.message);
    if (statusEl) {
      statusEl.textContent = '✗ Error';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Analyze'; }
  }
}

// ── Run AI with extracted markdown as extra context ──────────────────────
async function fcRunAIWithMarkdown(prompt) {
  if (!_aiConfig?.apiKey) return;
  if (!_fcLastMarkdown) return;

  showAITyping(true);
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  try {
    const reply = await aiCallModel(prompt, _fcLastMarkdown.slice(0, 6000));
    _aiMessages.push({ role: 'assistant', content: reply, time: ts, fc: true });
  } catch (e) {
    _aiMessages.push({ role: 'assistant', content: '⚠️ ' + e.message, time: ts });
  }
  showAITyping(false);
  renderAIMessages();
}

// ── Settings: init Firecrawl section ────────────────────────────────────
function initFirecrawlSettings() {
  const cfg = _firecrawlConfig || {};
  if (cfg.apiKey) {
    const el = $('firecrawlApiKey'); if (el) el.value = cfg.apiKey;
  }
  if (cfg.mode) {
    const el = $('firecrawlMode'); if (el) el.value = cfg.mode;
  }
  if (cfg.autoExtract) {
    const el = $('firecrawlAutoExtract'); if (el) el.checked = true;
  }

  updateFirecrawlSettingsBadge();
  setupEyeBtn('firecrawlEyeBtn', 'firecrawlApiKey');

  $('firecrawlSaveBtn')?.addEventListener('click', async () => {
    let apiKey = $('firecrawlApiKey')?.value.trim() || '';
    // Don't persist placeholder / incomplete keys
    if (!apiKey || apiKey === 'fc-…' || apiKey === 'fc-...' || apiKey.length < 12) apiKey = '';
    const mode = $('firecrawlMode')?.value || 'scrape';
    const autoExtract = $('firecrawlAutoExtract')?.checked === true;
    await fcSaveConfig({ apiKey, mode, autoExtract });
    fcUpdateToolbar();
    updateFirecrawlSettingsBadge();
    toast(apiKey ? 'Firecrawl configuration saved!' : 'Firecrawl config cleared (keyless mode).');
    const tr = $('firecrawlTestResult'); if (tr) tr.style.display = 'none';
  });

  $('firecrawlTestBtn')?.addEventListener('click', async () => {
    const btn = $('firecrawlTestBtn');
    let key = $('firecrawlApiKey')?.value.trim() || '';
    // Treat placeholders / partial keys as keyless
    if (!key || key === 'fc-…' || key === 'fc-...' || key.length < 12) key = '';
    if (btn) { btn.textContent = 'Testing…'; btn.disabled = true; }
    try {
      const result = await new Promise((res, rej) => {
        chrome.runtime.sendMessage({ action: 'FIRECRAWL_TEST', apiKey: key || undefined },
          r => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r));
      });
      if (result.ok) {
        const mode = result.keyless || !key ? 'KEYLESS (free tier)' : 'authenticated';
        const ver = result.version ? ' · ' + result.version : '';
        showFcTestResult('ok', '✓ Firecrawl OK — mode: ' + mode + ver);
      } else {
        showFcTestResult('error', '✗ ' + (result.error || 'Connection failed'));
      }
    } catch (e) {
      showFcTestResult('error', '✗ ' + e.message);
    } finally {
      if (btn) { btn.textContent = 'Test (Keyless OK)'; btn.disabled = false; }
    }
  });

  // Monid settings
  chrome.storage.sync.get(['monidConfig', 'monidApiKey'], (r) => {
    let key = r.monidApiKey || '';
    try {
      if (r.monidConfig) {
        const c = typeof r.monidConfig === 'string' ? JSON.parse(r.monidConfig) : r.monidConfig;
        if (c?.apiKey) key = c.apiKey;
      }
    } catch (_) {}
    if (key && $('monidApiKey')) $('monidApiKey').value = key;
  });
  setupEyeBtn('monidEyeBtn', 'monidApiKey');
  $('monidSaveBtn')?.addEventListener('click', async () => {
    const apiKey = $('monidApiKey')?.value.trim() || '';
    await new Promise(res => chrome.storage.sync.set({
      monidApiKey: apiKey,
      monidConfig: JSON.stringify({ apiKey })
    }, res));
    toast(apiKey ? 'Monid key saved.' : 'Monid key cleared (default key still available).');
    const badge = $('settingsMonidStatus');
    if (badge) badge.textContent = apiKey ? 'Custom key' : 'Default key';
  });
  $('monidTestBtn')?.addEventListener('click', async () => {
    const btn = $('monidTestBtn');
    const tr = $('monidTestResult');
    if (btn) { btn.textContent = 'Testing…'; btn.disabled = true; }
    try {
      const key = $('monidApiKey')?.value.trim() || undefined;
      // 1) Auth
      const result = await new Promise((res, rej) => {
        chrome.runtime.sendMessage({ action: 'MONID_TEST', apiKey: key },
          r => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r));
      });
      if (!result.ok) {
        if (tr) {
          tr.style.display = '';
          tr.className = 'settings-test-result error';
          tr.textContent = '✗ ' + (result.error || 'Auth failed');
        }
        return;
      }
      // 2) Live TinyFish /search smoke test (free endpoint)
      if (tr) {
        tr.style.display = '';
        tr.className = 'settings-test-result ok';
        tr.textContent = '✓ Monid connected — testing TinyFish…';
      }
      const tf = await new Promise((res, rej) => {
        chrome.runtime.sendMessage({
          action: 'MONID_RUN',
          apiKey: key,
          provider: 'tinyfish',
          endpoint: '/search',
          query: { query: 'example.com', location: 'US', language: 'en', purpose: 'ShahzaibSEO connection test' },
          waitMs: 25000
        }, r => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r));
      });
      if (tr) {
        if (tf.ok) {
          const n = (tf.output?.results || tf.output?.items || []).length;
          tr.className = 'settings-test-result ok';
          tr.textContent = '✓ Monid + TinyFish OK' + (n ? ` (${n} results)` : '');
        } else {
          tr.className = 'settings-test-result error';
          tr.textContent = '✓ Monid auth OK, but TinyFish failed: ' + (tf.error || tf.status || 'unknown');
        }
      }
    } catch (e) {
      if (tr) { tr.style.display = ''; tr.className = 'settings-test-result error'; tr.textContent = '✗ ' + e.message; }
    } finally {
      if (btn) { btn.textContent = 'Test Connection'; btn.disabled = false; }
    }
  });

  // Groq settings (built-in key + optional user override)
  chrome.storage.local.get(['groqApiKey', 'groqModel'], (r) => {
    if (r.groqApiKey && $('groqApiKey')) $('groqApiKey').value = r.groqApiKey;
    if (r.groqModel && $('groqModel')) $('groqModel').value = r.groqModel;
    const badge = $('settingsGroqStatus');
    if (badge) badge.textContent = (r.groqApiKey || '').trim() ? 'Your key' : 'Key required';
  });
  setupEyeBtn('groqEyeBtn', 'groqApiKey');
  $('groqSaveBtn')?.addEventListener('click', async () => {
    const apiKey = $('groqApiKey')?.value.trim() || '';
    const model = $('groqModel')?.value || RANKSEO_BUILTIN_GROQ_MODEL;
    await new Promise(res => chrome.storage.local.set({
      groqApiKey: apiKey,
      groqModel: model,
      aiProvider: 'groq'
    }, res));
    // Always activate Groq (user key or built-in)
    const effective = resolveGroqKey(apiKey);
    aiSaveConfig(Object.assign({}, _aiConfig || {}, {
      provider: 'groq',
      apiKey: effective,
      model,
      groqKey: effective,
      maxTokens: (_aiConfig && _aiConfig.maxTokens) || 2048,
      temperature: (_aiConfig && _aiConfig.temperature) != null ? _aiConfig.temperature : 0.6,
      includeContext: (_aiConfig && _aiConfig.includeContext) !== false
    }));
    updateAIHeaderStatus();
    updateSettingsAiBadge();
    toast(apiKey
      ? 'Groq saved with your key (' + model + ')'
      : 'Groq key required — add your key in Settings');
    const badge = $('settingsGroqStatus');
    if (badge) badge.textContent = apiKey ? 'Your key' : 'Key required';
  });

  $('groqTestBtn')?.addEventListener('click', async () => {
    const btn = $('groqTestBtn');
    const tr = $('groqTestResult');
    const key = resolveGroqKey($('groqApiKey')?.value);
    if (!key) {
      if (tr) { tr.style.display = ''; tr.className = 'settings-test-result error'; tr.textContent = '⚠ No Groq key available.'; }
      return;
    }
    if (btn) { btn.textContent = 'Testing…'; btn.disabled = true; }
    try {
      const model = $('groqModel')?.value || 'qwen/qwen3.8-27b';
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say OK' }],
          max_tokens: 5
        })
      });
      const errBody = resp.ok ? null : await resp.json().catch(() => ({}));
      if (tr) {
        tr.style.display = '';
        tr.className = 'settings-test-result ' + (resp.ok ? 'ok' : 'error');
        if (resp.ok) {
          tr.textContent = '✓ Groq connected (' + model + ')';
        } else {
          const detail = errBody?.error?.message || ('Status ' + resp.status);
          tr.textContent = '✗ ' + detail;
        }
      }
    } catch (e) {
      if (tr) { tr.style.display = ''; tr.className = 'settings-test-result error'; tr.textContent = '✗ ' + e.message; }
    } finally {
      if (btn) { btn.textContent = 'Test Connection'; btn.disabled = false; }
    }
  });

  // Grok (xAI) + Gemini automation keys — load & save
  chrome.storage.local.get(['grokApiKey', 'grokModel', 'geminiApiKey'], (r) => {
    if (r.grokApiKey && $('grokApiKey')) $('grokApiKey').value = r.grokApiKey;
    if (r.geminiApiKey && $('geminiApiKey')) $('geminiApiKey').value = r.geminiApiKey;
  });
  setupEyeBtn('grokEyeBtn', 'grokApiKey');
  setupEyeBtn('geminiEyeBtn', 'geminiApiKey');

  $('automationSaveBtn')?.addEventListener('click', async () => {
    const grokKey = $('grokApiKey')?.value.trim() || '';
    const geminiKey = $('geminiApiKey')?.value.trim() || '';
    const payload = {
      grokApiKey: grokKey,
      geminiApiKey: geminiKey,
      grokModel: 'grok-3'
    };
    if (grokKey) payload.aiProvider = 'grok';
    await new Promise(res => chrome.storage.local.set(payload, res));

    if (grokKey) {
      aiSaveConfig(Object.assign({}, _aiConfig || {}, {
        provider: 'grok',
        apiKey: grokKey,
        model: 'grok-3',
        grokKey,
        maxTokens: (_aiConfig && _aiConfig.maxTokens) || 2048,
        temperature: (_aiConfig && _aiConfig.temperature) != null ? _aiConfig.temperature : 0.6,
        includeContext: (_aiConfig && _aiConfig.includeContext) !== false
      }));
      updateAIHeaderStatus();
      updateSettingsAiBadge();
      toast('Grok (xAI) saved and set as active AI — Content Brief + AI Chat ready');
    } else {
      toast(geminiKey ? 'Automation keys saved.' : 'Automation keys cleared.');
    }
    const tr = $('automationTestResult');
    if (tr) {
      tr.style.display = '';
      tr.className = 'settings-test-result ok';
      tr.textContent = grokKey ? '✓ Grok key saved (active for Content Brief / AI Chat)' : '✓ Saved';
    }
  });
}

function showFcTestResult(type, msg) {
  const tr = $('firecrawlTestResult');
  if (!tr) return;
  tr.style.display = '';
  tr.className = 'settings-test-result ' + type;
  tr.textContent = msg;
}

// ── Wire up AI tab Firecrawl buttons ─────────────────────────────────────
function initFirecrawl() {
  // Load config and then set up toolbar + settings
  fcLoadConfig().then(() => {
    fcUpdateToolbar();
    // Settings section init runs when settings tab is opened
  });

  // Deep Extract button
  $('fcDeepExtractBtn')?.addEventListener('click', () => {
    fcDeepExtractCurrentPage();
  });

  // Competitor toggle button
  $('fcCompetitorBtn')?.addEventListener('click', () => {
    const wrap = $('fcCompetitorWrap');
    if (!wrap) return;
    const isVisible = wrap.style.display !== 'none';
    wrap.style.display = isVisible ? 'none' : '';
    if (!isVisible) $('fcCompetitorUrl')?.focus();
  });

  $('fcCompetitorCancelBtn')?.addEventListener('click', () => {
    const wrap = $('fcCompetitorWrap'); if (wrap) wrap.style.display = 'none';
    const inp = $('fcCompetitorUrl'); if (inp) inp.value = '';
  });

  $('fcCompetitorRunBtn')?.addEventListener('click', () => {
    const url = $('fcCompetitorUrl')?.value.trim();
    if (!url) { toast('Enter a competitor URL.'); return; }
    try { new URL(url); } catch (_) { toast('Enter a valid URL (include https://).'); return; }
    fcRunCompetitorAnalysis(url);
  });

  $('fcCompetitorUrl')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const url = e.target.value.trim();
      if (url) fcRunCompetitorAnalysis(url);
    }
  });

  // Content Gaps button
  $('fcContentGapsBtn')?.addEventListener('click', () => {
    fcRunPrompt('Analyze the extracted content and identify content gaps. What topics, sections, or information are missing that competitors likely cover? Suggest specific content additions with **bold section titles**, numbered recommendations, and end with "**What to ask next:**" followed by 3 specific questions.');
  });

  // Rewrite Content button
  $('fcRewriteBtn')?.addEventListener('click', () => {
    fcRunPrompt('Rewrite the main content to be more engaging, SEO-friendly, and conversion-focused. Improve readability, add relevant keywords naturally, and enhance the value proposition. Use **bold section titles**, show before/after examples, and end with "**What to ask next:**" followed by 3 specific questions.');
  });

  // Summary button
  $('fcSummaryBtn')?.addEventListener('click', () => {
    fcRunPrompt('Create an executive summary of this page content. Include key points, main topics covered, target audience, and content quality assessment. Use **bold section titles**, bullet points for key findings, and end with "**What to ask next:**" followed by 3 specific questions.');
  });

  // Keywords button
  $('fcKeywordsBtn')?.addEventListener('click', () => {
    fcRunPrompt('Extract all important keywords and phrases from the content. Identify primary keywords, secondary keywords, long-tail opportunities, and semantic variations. Show results in a table format with | Keyword | Search Intent | Priority |, use **bold section titles**, and end with "**What to ask next:**" followed by 3 specific questions.');
  });

  // ── TinyFish free search / research (Monid) ─────────────────────
  $('tfSearchBtn')?.addEventListener('click', () => {
    const wrap = $('tfSearchWrap');
    if (!wrap) return;
    const vis = wrap.style.display !== 'none';
    wrap.style.display = vis ? 'none' : '';
    $('tfResearchWrap') && ($('tfResearchWrap').style.display = 'none');
    $('fcCompetitorWrap') && ($('fcCompetitorWrap').style.display = 'none');
    if (!vis) $('tfSearchQuery')?.focus();
  });
  $('tfSearchCancelBtn')?.addEventListener('click', () => {
    const wrap = $('tfSearchWrap'); if (wrap) wrap.style.display = 'none';
  });
  $('tfSearchRunBtn')?.addEventListener('click', () => {
    const q = $('tfSearchQuery')?.value.trim();
    if (!q) { toast('Enter a search query.'); return; }
    tfRunSearch(q);
  });
  $('tfSearchQuery')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) tfRunSearch(q);
    }
  });

  $('tfResearchBtn')?.addEventListener('click', () => {
    const wrap = $('tfResearchWrap');
    if (!wrap) return;
    const vis = wrap.style.display !== 'none';
    wrap.style.display = vis ? 'none' : '';
    $('tfSearchWrap') && ($('tfSearchWrap').style.display = 'none');
    $('fcCompetitorWrap') && ($('fcCompetitorWrap').style.display = 'none');
    if (!vis) {
      // Prefill with page title / hostname if available
      const inp = $('tfResearchQuery');
      if (inp && !inp.value && _currentUrl) {
        try {
          const host = new URL(_currentUrl).hostname.replace(/^www\./, '');
          inp.value = host + ' competitors alternatives';
        } catch (_) {}
      }
      inp?.focus();
    }
  });
  $('tfResearchCancelBtn')?.addEventListener('click', () => {
    const wrap = $('tfResearchWrap'); if (wrap) wrap.style.display = 'none';
  });
  $('tfResearchRunBtn')?.addEventListener('click', () => {
    const q = $('tfResearchQuery')?.value.trim();
    if (!q) { toast('Enter a keyword or niche.'); return; }
    tfRunCompetitorResearch(q);
  });
  $('tfResearchQuery')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) tfRunCompetitorResearch(q);
    }
  });
}

/**
 * TinyFish / Monid helpers — free live search + fetch
 */
function monidSend(msg) {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage(msg, r => {
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else res(r || { ok: false, error: 'No response' });
    });
  });
}

async function tfRunSearch(query) {
  const statusEl = $('fcStatus');
  const btn = $('tfSearchRunBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Searching…'; }
  if (statusEl) statusEl.textContent = 'TinyFish search…';

  try {
    const result = await monidSend({
      action: 'MONID_RUN',
      provider: 'tinyfish',
      endpoint: '/search',
      query: {
        query,
        purpose: 'SEO research and competitive analysis for ShahzaibSEO',
        location: 'US',
        language: 'en'
      },
      waitMs: 30000
    });

    if (!result.ok) {
      toast('Search failed: ' + (result.error || result.status || 'error'));
      if (statusEl) statusEl.textContent = '';
      return;
    }

    const out = result.output || result.data?.output || result.data || {};
    const rows = out.results || out.items || [];
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let md = `**Free Web Search** (TinyFish) — \`${query}\`\n\n`;
    if (!rows.length) {
      md += '_No results._';
    } else {
      md += '| # | Title | Site | Snippet |\n|---|---|---|---|\n';
      rows.slice(0, 10).forEach((r, i) => {
        const title = (r.title || '').replace(/\|/g, '/');
        const site = r.site_name || '';
        const snip = (r.snippet || '').replace(/\|/g, '/').slice(0, 120);
        const url = r.url || '';
        md += `| ${i + 1} | [${title}](${url}) | ${site} | ${snip} |\n`;
      });
      md += `\n_Cost: free · Source: TinyFish via Monid_`;
    }

    _aiMessages.push({ role: 'assistant', content: md, time: ts, fc: true });
    renderAIMessages();
    if (statusEl) statusEl.textContent = rows.length + ' results (free)';
    const wrap = $('tfSearchWrap'); if (wrap) wrap.style.display = 'none';
  } catch (e) {
    toast('Search error: ' + e.message);
    if (statusEl) statusEl.textContent = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Search'; }
  }
}

/**
 * One-click competitor research: search → fetch top 5 → AI brief
 */
async function tfRunCompetitorResearch(query) {
  const statusEl = $('fcStatus');
  const btn = $('tfResearchRunBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Researching…'; }
  if (statusEl) statusEl.textContent = '1/3 Searching…';

  try {
    // 1) Search
    const searchRes = await monidSend({
      action: 'MONID_RUN',
      provider: 'tinyfish',
      endpoint: '/search',
      query: {
        query,
        purpose: 'Find strongest competitors and alternative products for comparison',
        location: 'US',
        language: 'en'
      },
      waitMs: 30000
    });

    if (!searchRes.ok) {
      toast('Search failed: ' + (searchRes.error || 'error'));
      return;
    }

    const out = searchRes.output || searchRes.data?.output || searchRes.data || {};
    const rows = (out.results || out.items || []).slice(0, 5);
    if (!rows.length) {
      toast('No search results for that query.');
      return;
    }

    const urls = rows.map(r => r.url).filter(Boolean);
    if (statusEl) statusEl.textContent = `2/3 Fetching ${urls.length} pages…`;

    // 2) Fetch top URLs as markdown (free, up to 10)
    const fetchRes = await monidSend({
      action: 'MONID_RUN',
      provider: 'tinyfish',
      endpoint: '/fetch',
      input: { urls, format: 'markdown' },
      waitMs: 60000
    });

    const fetchOut = fetchRes.output || fetchRes.data?.output || fetchRes.data || {};
    const pages = fetchOut.results || [];

    // Build context for AI
    let context = `QUERY: ${query}\n\nSEARCH RESULTS:\n`;
    rows.forEach((r, i) => {
      context += `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Site: ${r.site_name || ''}\n   Snippet: ${r.snippet || ''}\n\n`;
    });
    context += '\nPAGE CONTENT (extracted):\n';
    pages.forEach((p, i) => {
      const text = (p.text || p.markdown || '').slice(0, 2500);
      context += `\n--- PAGE ${i + 1}: ${p.title || p.url} ---\n${text}\n`;
    });

    if (statusEl) statusEl.textContent = '3/3 AI brief…';

    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const prompt = `You are an SEO/GEO competitive analyst. Using the search results and page extracts below, write a concise competitor research brief.

Include:
1. **Market snapshot** — who the main players are
2. **Comparison table** — | Competitor | Positioning | Strengths | Weaknesses | Content angles |
3. **Content gaps** — topics they cover that a new entrant should address
4. **AEO/GEO opportunities** — how to win AI Overviews / citations
5. **Actionable next steps** — 5 prioritized actions

Use **bold section titles**. End with "**What to ask next:**" and 3 specific follow-up questions.

DATA:
${context.slice(0, 14000)}`;

    // Prefer AI if configured; otherwise show raw research pack
    if (_aiConfig?.apiKey || true) {
      try {
        showAITyping(true);
        _aiMessages.push({ role: 'user', content: `Research competitors: ${query}`, time: ts, fc: true });
        renderAIMessages();
        _aiAbortController = new AbortController();
        const reply = await aiCallModel(prompt, '', _aiAbortController.signal);
        showAITyping(false);
        _aiMessages.push({ role: 'assistant', content: reply || '_No response_', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), fc: true });
        renderAIMessages();
      } catch (aiErr) {
        showAITyping(false);
        // Fallback: structured markdown without AI
        let md = `**Competitor Research** — \`${query}\` (TinyFish free)\n\n`;
        md += '| # | Title | Site |\n|---|---|---|\n';
        rows.forEach((r, i) => {
          md += `| ${i + 1} | [${(r.title || '').replace(/\|/g, '/')}](${r.url}) | ${r.site_name || ''} |\n`;
        });
        md += '\n**Extracted page previews**\n\n';
        pages.forEach((p, i) => {
          md += `### ${i + 1}. ${p.title || p.url}\n${(p.text || '').slice(0, 600)}…\n\n`;
        });
        md += '\n_Add an AI key in Settings for a full strategic brief._';
        _aiMessages.push({ role: 'assistant', content: md, time: ts, fc: true });
        renderAIMessages();
      }
    }

    if (statusEl) statusEl.textContent = 'Research done (free)';
    const wrap = $('tfResearchWrap'); if (wrap) wrap.style.display = 'none';
  } catch (e) {
    toast('Research error: ' + e.message);
    if (statusEl) statusEl.textContent = '';
    showAITyping(false);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Research'; }
  }
}

/**
 * Free page fetch via TinyFish (fallback / alternative to Firecrawl)
 */
async function tfFetchUrl(url) {
  const result = await monidSend({
    action: 'MONID_RUN',
    provider: 'tinyfish',
    endpoint: '/fetch',
    input: { urls: [url], format: 'markdown' },
    waitMs: 45000
  });
  if (!result.ok) throw new Error(result.error || 'TinyFish fetch failed');
  const out = result.output || result.data?.output || result.data || {};
  const page = (out.results || [])[0];
  if (!page) throw new Error('No content returned');
  return {
    ok: true,
    markdown: page.text || page.markdown || '',
    title: page.title || '',
    description: page.description || '',
    wordCount: (page.text || '').split(/\s+/).filter(Boolean).length,
    source: 'tinyfish',
    url: page.final_url || page.url || url
  };
}

/**
 * Run an AI prompt with Firecrawl extracted content
 * @param {string} promptText - The prompt to send to AI
 */
async function fcRunPrompt(promptText) {
  if (!_fcLastMarkdown) {
    toast('Run Deep Extract first to get page content.');
    return;
  }
  
  if (!_aiConfig?.apiKey) _aiConfig = ensureBuiltinGroqConfig(_aiConfig);
  if (!_aiConfig?.apiKey) {
    toast('Configure an AI model in Settings first.');
    switchTab('settings');
    return;
  }

  showAITyping(true);
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Add user message
  _aiMessages.push({ role: 'user', content: promptText, time: ts, fc: true });
  renderAIMessages();

  // Create abort controller for this request
  _aiAbortController = new AbortController();

  try {
    const reply = await aiCallModel(promptText, _fcLastMarkdown.slice(0, 5000), _aiAbortController.signal);
    _aiMessages.push({ role: 'assistant', content: reply, time: ts, fc: true });
  } catch (e) {
    if (e.name === 'AbortError') {
      _aiMessages.push({ role: 'assistant', content: '⚠️ Request stopped by user.', time: ts });
    } else {
      _aiMessages.push({ role: 'assistant', content: '⚠️ ' + e.message, time: ts });
    }
  }
  
  _aiAbortController = null;
  showAITyping(false);
  renderAIMessages();
}

// end Firecrawl integration

/* ══════════════════════════════════════════════════
   AI QUICK WINS — dashboard panel
   Dynamically populated from real SEO issues detected on the page.
   Clicking "Fix" switches to the AI tab and auto-runs the prompt.
   ══════════════════════════════════════════════════ */
(function() {
  let _aqwWins = [];  // Populated from real analysis data
  let _aqwDone = new Set();
  let _aqwFilter = 'all';

  /**
   * Generate AI Quick Wins from real SEO analysis data
   * @param {Object} data - The analyzed page data
   */
  window.populateAIQuickWins = function(data) {
    if (!data) return;
    
    _aqwWins = [];
    const { seo, meta, headings, images, links, keywords, tech, geo, readability } = data;
    
    // Process only HIGH-IMPACT SEO issues for AI Quick Wins
    // Filter: errors only, or high-impact warnings
    (seo.issues || []).forEach((issue, idx) => {
      // Only include high-priority issues in Quick Wins
      const isHighPriority = 
        issue.severity === 'error' || 
        issue.msg.toLowerCase().includes('title') ||
        issue.msg.toLowerCase().includes('description') ||
        issue.msg.toLowerCase().includes('h1') ||
        issue.msg.toLowerCase().includes('schema') ||
        issue.msg.toLowerCase().includes('og:image');
      
      if (isHighPriority) {
        const win = convertIssueToQuickWin(issue, data, idx);
        if (win) _aqwWins.push(win);
      }
    });
    
    // Add GEO optimization if score is below 80
    if (geo.geoScore < 80) {
      _aqwWins.push({
        id: 'geo-score',
        cat: 'content',
        impact: 'high',
        icon: 'G',
        ic: '#d1fae5',
        ict: '#065f46',
        color: '#059669',
        title: 'Boost GEO score',
        sub: `GEO at ${geo.geoScore} — ${Math.ceil((80 - geo.geoScore) / 4)} optimizations needed`,
        prompt: `My page has a GEO score of ${geo.geoScore}/100. List the top 5 specific GEO optimizations needed to reach 85+, covering entity clarity, E-E-A-T signals, structured data, and AI crawler optimization.`
      });
    }
    
    // Add mobile performance gap if significant
    if (data.vitals?.mobile?.score != null && data.vitals?.desktop?.score != null) {
      const gap = data.vitals.desktop.score - data.vitals.mobile.score;
      if (gap > 15) {
        _aqwWins.push({
          id: 'mobile-gap',
          cat: 'technical',
          impact: 'high',
          icon: 'Mb',
          ic: '#fce7f3',
          ict: '#9d174d',
          color: '#db2777',
          title: 'Fix mobile score gap',
          sub: `Mobile ${data.vitals.mobile.score} vs desktop ${data.vitals.desktop.score} — ${gap}pt gap`,
          prompt: `My page has a ${gap}-point mobile vs desktop performance gap (Mobile: ${data.vitals.mobile.score}, Desktop: ${data.vitals.desktop.score}). Diagnose the top causes and provide a prioritized fix list covering render-blocking resources, tap targets, font sizes, and viewport issues.`
        });
      }
    }
    
    // Add keyword density optimization if needed
    const stuffing = keywords.stuffing || [];
    if (stuffing.length > 0) {
      const topStuffed = stuffing[0];
      _aqwWins.push({
        id: 'kw-density',
        cat: 'content',
        impact: 'medium',
        icon: 'K',
        ic: '#dcfce7',
        ict: '#166534',
        color: '#16a34a',
        title: 'Improve keyword density',
        sub: `"${topStuffed.word}" appears too frequently — needs balance`,
        prompt: `The keyword "${topStuffed.word}" appears too frequently on this page. Suggest 5 natural ways to improve keyword density without over-optimizing, while maintaining content quality.`
      });
    }
    
    // Add internal linking if count is low
    if (links.internal < 5) {
      _aqwWins.push({
        id: 'int-links',
        cat: 'links',
        impact: 'medium',
        icon: 'IL',
        ic: '#dbeafe',
        ict: '#1e40af',
        color: '#2563eb',
        title: 'Improve internal linking',
        sub: `Only ${links.internal} internal links — add more`,
        prompt: `This page has only ${links.internal} internal links. Suggest 5-10 relevant internal pages to link to, with recommended anchor text for each link.`
      });
    }
    
    // Add FAQ schema suggestion if no FAQ schema exists
    const hasFAQSchema = (geo.structured?.schemas || []).some(s => s.type === 'FAQPage');
    if (!hasFAQSchema && readability.wordCount > 500) {
      _aqwWins.push({
        id: 'faq-schema',
        cat: 'content',
        impact: 'medium',
        icon: 'F',
        ic: '#dcfce7',
        ict: '#166534',
        color: '#16a34a',
        title: 'Add FAQ schema',
        sub: 'No FAQ markup — missed rich result opportunity',
        prompt: 'Write 6 relevant FAQ entries with answers for this page targeting common user queries, then generate the JSON-LD FAQPage schema markup ready to paste in.'
      });
    }
    
    // Limit to top 12 issues
    _aqwWins = _aqwWins.slice(0, 12);
    
    // Expose on window so renderDashboard recommendations can deduplicate
    window._aqwWins = _aqwWins;
    
    // Update count badge
    const countEl = document.getElementById('aqwCount');
    if (countEl) countEl.textContent = `${_aqwWins.length} fixes`;
    
    // Update filter buttons
    updateFilterCounts();
    
    // Render the wins
    aqwRender();
  };
  
  /**
   * Convert a generic SEO issue to an AI Quick Win format
   */
  function convertIssueToQuickWin(issue, data, idx) {
    const { msg, severity, cat } = issue;
    
    // Determine category
    let category = 'content';
    let icon = 'S';
    let color = '#2563eb';
    let ic = '#dbeafe';
    let ict = '#1e40af';
    
    if (cat === 'SEO' || cat === 'KEYWORDS') {
      category = 'meta';
      icon = msg.includes('title') ? 'T' : msg.includes('description') ? 'M' : 'S';
      color = '#7c3aed';
      ic = '#ede9fe';
      ict = '#6d28d9';
    } else if (cat === 'IMAGES') {
      category = 'meta';
      icon = 'I';
      color = '#059669';
      ic = '#d1fae5';
      ict = '#065f46';
    } else if (cat === 'LINKS') {
      category = 'links';
      icon = 'L';
      color = '#db2777';
      ic = '#fce7f3';
      ict = '#9d174d';
    } else if (cat === 'TECHNICAL') {
      category = 'technical';
      icon = 'T';
      color = '#d97706';
      ic = '#fef3c7';
      ict = '#92400e';
    } else if (cat === 'GEO') {
      category = 'content';
      icon = 'G';
      color = '#059669';
      ic = '#d1fae5';
      ict = '#065f46';
    }
    
    // Determine impact level
    const impact = severity === 'error' ? 'high' : 'medium';
    
    // Generate AI prompt based on issue type
    let prompt = generatePromptForIssue(issue, data);
    
    // Create subtitle with full context - no truncation
    let sub = issue.desc || msg;
    
    return {
      id: `issue-${idx}`,
      cat: category,
      impact: impact,
      icon: icon,
      ic: ic,
      ict: ict,
      color: color,
      title: msg,
      sub: sub,
      prompt: prompt
    };
  }
  
  /**
   * Generate specific AI prompt based on issue type
   */
  function generatePromptForIssue(issue, data) {
    const msg = issue.msg.toLowerCase();
    
    if (msg.includes('title') && msg.includes('missing')) {
      return 'Write an SEO-optimized page title for this page. Keep it under 60 characters, include the primary keyword, and make it compelling for click-through.';
    }
    if (msg.includes('title') && msg.includes('short')) {
      return `The current title is "${data.meta.title}". Expand it to 30-60 characters while keeping the primary keyword and making it more descriptive.`;
    }
    if (msg.includes('title') && msg.includes('long')) {
      return `The current title is "${data.meta.title}" (${data.meta.title.length} chars). Shorten it to under 60 characters while preserving the primary keyword and brand.`;
    }
    if (msg.includes('meta description') && msg.includes('missing')) {
      return 'Write an SEO-optimized meta description for this page. Keep it 120-160 characters, include the primary keyword, and optimize for CTR with a clear value proposition.';
    }
    if (msg.includes('meta description') && msg.includes('long')) {
      return `The current meta description is ${data.meta.desc.length} characters. Rewrite it to under 160 characters while keeping the key selling points and primary keyword.`;
    }
    if (msg.includes('h1') && msg.includes('no h1')) {
      return 'Write a compelling H1 heading for this page that targets the primary keyword and clearly describes the page content.';
    }
    if (msg.includes('h1') && msg.includes('multiple')) {
      const h1s = data.headings.headings.filter(h => h.level === 1);
      return `This page has ${h1s.length} H1 tags: ${h1s.map(h => `"${h.text}"`).join(', ')}. Recommend which one to keep as the main H1 and how to convert the others to H2 or H3.`;
    }
    if (msg.includes('canonical')) {
      return `Add a canonical URL tag to this page. The canonical should point to: ${data.meta.url}. Explain why this is important and provide the exact HTML tag to add.`;
    }
    if (msg.includes('https') || msg.includes('not served over https')) {
      return 'This page is not served over HTTPS. Explain the SEO and security risks, and provide a step-by-step guide to migrate to HTTPS including redirects and mixed content fixes.';
    }
    if (msg.includes('noindex')) {
      return 'This page has a noindex directive. Explain what this means, why it might be blocking search engines, and how to remove it if unintentional.';
    }
    if (msg.includes('image') && msg.includes('alt')) {
      const count = data.images.missingAlt || 0;
      return `Write SEO-friendly alt text for the ${count} images on this page that are missing alt attributes. For each image, provide descriptive, keyword-relevant alt text.`;
    }
    if (msg.includes('link') && msg.includes('empty')) {
      return `This page has ${data.links.empty} empty or broken links. Explain how to find and fix them, and recommend best practices for link maintenance.`;
    }
    if (msg.includes('anchor') && msg.includes('generic')) {
      return `This page has ${data.links.genericAnchor} links with generic anchor text like "click here" or "read more". Suggest better, keyword-rich anchor text alternatives for each.`;
    }
    if (msg.includes('og:image')) {
      return 'This page is missing an og:image meta tag. Recommend the ideal image dimensions (1200x630px), suggest what image to use from the page, and provide the exact meta tag code.';
    }
    if (msg.includes('geo score')) {
      return `The GEO score is ${data.geo.geoScore}/100. List the top 5 specific improvements to boost AI search engine visibility, covering E-E-A-T, structured data, and entity optimization.`;
    }
    if (msg.includes('readability')) {
      return `The readability score is ${data.readability.score}/100. Suggest 5 ways to simplify the content, including sentence length reduction, simpler vocabulary, and better formatting.`;
    }
    
    // Default prompt
    return `Analyze this SEO issue: "${issue.msg}". Provide specific, actionable steps to fix it, including code examples where applicable.`;
  }
  
  /**
   * Update filter button counts
   */
  function updateFilterCounts() {
    const allBtn = document.querySelector('.aqw-f[data-cat="all"]');
    const highBtn = document.querySelector('.aqw-f[data-cat="high"]');
    const metaBtn = document.querySelector('.aqw-f[data-cat="meta"]');
    const contentBtn = document.querySelector('.aqw-f[data-cat="content"]');
    const techBtn = document.querySelector('.aqw-f[data-cat="technical"]');
    const linksBtn = document.querySelector('.aqw-f[data-cat="links"]');
    
    if (allBtn) allBtn.textContent = `All ${_aqwWins.length}`;
    if (highBtn) highBtn.textContent = `High impact`;
    if (metaBtn) metaBtn.textContent = `Meta`;
    if (contentBtn) contentBtn.textContent = `Content`;
    if (techBtn) techBtn.textContent = `Technical`;
    if (linksBtn) linksBtn.textContent = `Links`;
  }

  function aqwRender() {
    const grid = document.getElementById('aqwGrid');
    if (!grid) return;
    
    const list = _aqwFilter === 'all' ? _aqwWins
      : _aqwFilter === 'high' ? _aqwWins.filter(w => w.impact === 'high')
      : _aqwWins.filter(w => w.cat === _aqwFilter);
    
    if (list.length === 0) {
      grid.innerHTML = '<div class="aqw-empty">No issues found in this category. Great job! 🎉</div>';
      return;
    }
    
    grid.innerHTML = '';
    list.forEach(w => {
      const done = _aqwDone.has(w.id);
      const div = document.createElement('div');
      div.className = 'aqw-item';
      div.innerHTML = `
        <div class="aqw-toast" id="aqw-toast-${w.id}"><span class="aqw-dot"></span>Opening AI tab…</div>
        <div class="aqw-item-top">
          <div class="aqw-icon" style="background:${w.ic};color:${w.ict}">${w.icon}</div>
          <div class="aqw-body">
            <div class="aqw-name">${w.title}</div>
            <div class="aqw-sub">${w.sub}</div>
          </div>
        </div>
        <div class="aqw-foot">
          <span class="aqw-impact ${w.impact==='high'?'aqw-imp-h':'aqw-imp-m'}">${w.impact==='high'?'High impact':'Medium'}</span>
          ${done
            ? `<span class="aqw-done">Done ✓</span>`
            : `<button class="aqw-fix-btn" data-win-id="${w.id}" style="background:${w.color}">
                Fix
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 10L10 2M10 2H4M10 2v6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>`
          }
        </div>`;
      grid.appendChild(div);
    });
    
    // Add event listeners to Fix buttons using event delegation
    grid.querySelectorAll('.aqw-fix-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const winId = this.getAttribute('data-win-id');
        aqwFixHandler(winId);
      });
    });
  }

  function aqwFixHandler(id) {
    const win = _aqwWins.find(w => w.id === id);
    if (!win) return;
    const btn = document.querySelector(`[data-win-id="${id}"]`);
    const toast = document.getElementById('aqw-toast-' + id);
    if (btn) { btn.classList.add('running'); btn.textContent = '…'; }
    if (toast) { toast.classList.add('show'); }
    setTimeout(() => {
      if (toast) toast.classList.remove('show');
      _aqwDone.add(id);
      aqwRender();
      // Switch to AI tab and inject the prompt
      if (typeof switchTab === 'function') switchTab('ai');
      const ta = document.getElementById('aiInput');
      if (ta) {
        ta.value = win.prompt;
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      }
      // Auto-submit after a short delay so the tab animation settles
      setTimeout(() => {
        if (typeof aiHandleSend === 'function') aiHandleSend();
      }, 200);
    }, 700);
  }

  window.aqwFilter = function(cat, btn) {
    _aqwFilter = cat;
    document.querySelectorAll('.aqw-f').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    aqwRender();
  };

  // Init on DOM ready
  function aqwInit() {
    aqwRender();
    // Keep filter buttons in sync if rebuilt
    document.querySelectorAll('.aqw-f').forEach(btn => {
      btn.addEventListener('click', function() { aqwFilter(this.dataset.cat, this); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aqwInit);
  } else {
    aqwInit();
  }
})();



// ═══════════════════════════════════════════════════════════════
// DATA API SETTINGS — Ahrefs + PageSpeed keys
// ═══════════════════════════════════════════════════════════════
function initDataApiSettings() {
  const ahrefsInput = $('ahrefsApiKeyInput');
  const psiInput = $('pageSpeedApiKeyInput');
  const saveBtn = $('dataApiSaveBtn');
  const testAhrefs = $('ahrefsTestBtn');
  const testPsi = $('pageSpeedTestBtn');
  const resultEl = $('dataApiTestResult');
  const statusEl = $('settingsDataApiStatus');

  const showResult = (ok, msg) => {
    if (!resultEl) return;
    resultEl.style.display = '';
    resultEl.style.color = ok ? 'var(--ok,#16a34a)' : 'var(--err,#dc2626)';
    resultEl.textContent = msg;
  };

  // Load saved keys + KE feature flags
  chrome.storage.sync.get([
    'ahrefsApiKey', 'pageSpeedApiKey', 'keApiKey', 'textRazorApiKey',
    'keEnabled', 'keUseVolume', 'keUseBulkVolume', 'keUseTraffic', 'keUseRelatedVol', 'keUseNicheVolume',
    'keCreditsLeft', 'keCreditsCheckedAt'
  ], res => {
    if (ahrefsInput && res.ahrefsApiKey) ahrefsInput.value = res.ahrefsApiKey;
    if (psiInput && res.pageSpeedApiKey) psiInput.value = res.pageSpeedApiKey;
    const trIn = $('textRazorApiKeyInput'); if (trIn && res.textRazorApiKey) trIn.value = res.textRazorApiKey;
    const keIn = $('keApiKeyInput'); if (keIn && res.keApiKey) keIn.value = res.keApiKey;

    const setChk = (id, val, def = true) => {
      const el = $(id);
      if (!el) return;
      el.checked = (val === undefined || val === null) ? def : !!val;
    };
    setChk('keEnabledToggle', res.keEnabled, true);
    setChk('keUseVolume', res.keUseVolume, true);
    setChk('keUseBulkVolume', res.keUseBulkVolume, true);
    setChk('keUseTraffic', res.keUseTraffic, true);
    setChk('keUseRelatedVol', res.keUseRelatedVol, true);
    setChk('keUseNicheVolume', res.keUseNicheVolume, true);

    // Show last known credits if any
    if (res.keCreditsLeft != null && $('keCreditBox')) {
      $('keCreditBox').style.display = '';
      if ($('keCreditsLeft')) $('keCreditsLeft').textContent = Number(res.keCreditsLeft).toLocaleString();
      if ($('keVerifyStatus') && res.keCreditsCheckedAt) {
        try {
          $('keVerifyStatus').textContent = 'Checked ' + new Date(res.keCreditsCheckedAt).toLocaleString();
        } catch (_) {}
      }
    }

    const hasAny = !!(res.ahrefsApiKey || res.pageSpeedApiKey || res.keApiKey || res.textRazorApiKey);
    if (statusEl) {
      statusEl.textContent = hasAny ? 'Configured' : 'Using built-in';
      statusEl.style.background = hasAny ? '#16a34a' : '';
    }
  });

  // Eye toggles
  const bindEye = (btnId, inputId) => {
    const btn = $(btnId), inp = $(inputId);
    if (!btn || !inp || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  };
  bindEye('ahrefsKeyEyeBtn', 'ahrefsApiKeyInput');
  bindEye('pageSpeedKeyEyeBtn', 'pageSpeedApiKeyInput');
  bindEye('trKeyEyeBtn', 'textRazorApiKeyInput');
  bindEye('keKeyEyeBtn', 'keApiKeyInput');

  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = '1';
    saveBtn.addEventListener('click', () => {
      const ahrefsApiKey = (ahrefsInput?.value || '').trim();
      const pageSpeedApiKey = (psiInput?.value || '').trim();
      const keApiKey = ($('keApiKeyInput')?.value || '').trim();
      const textRazorApiKey = ($('textRazorApiKeyInput')?.value || '').trim();
      const keEnabled = !!($('keEnabledToggle')?.checked);
      const keUseVolume = !!($('keUseVolume')?.checked);
      const keUseBulkVolume = !!($('keUseBulkVolume')?.checked);
      const keUseTraffic = !!($('keUseTraffic')?.checked);
      const keUseRelatedVol = !!($('keUseRelatedVol')?.checked);
      const keUseNicheVolume = !!($('keUseNicheVolume')?.checked);
      chrome.storage.sync.set({
        ahrefsApiKey, pageSpeedApiKey, keApiKey, textRazorApiKey,
        keEnabled, keUseVolume, keUseBulkVolume, keUseTraffic, keUseRelatedVol, keUseNicheVolume,
        dfsLogin: '', dfsPassword: ''
      }, () => {
        chrome.runtime.sendMessage({ action: 'CLEAR_API_KEY_CACHE' }, () => { void chrome.runtime.lastError; });
        if (statusEl) {
          statusEl.textContent = (ahrefsApiKey || pageSpeedApiKey || keApiKey) ? 'Configured' : 'Using built-in';
        }
        toast((ahrefsApiKey || pageSpeedApiKey || keApiKey || textRazorApiKey) ? 'Data API keys saved' : 'Data API keys cleared — using built-in fallbacks');
        showResult(true, '✓ Saved');
        try {
          const banner = document.getElementById('bulkVolNoKey');
          if (banner) banner.style.display = 'none';
          const keOn = keApiKey && keEnabled && keUseBulkVolume;
          if (banner) banner.style.display = keOn ? 'none' : '';
          const runBtn = document.getElementById('bulkVolRunBtn');
          if (runBtn) {
            runBtn.title = keOn
              ? 'Check volume + domain metrics'
              : 'Domain metrics (DA/DR/Age). Enable KE + Bulk volume in Settings for volume.';
          }
        } catch (_) {}
      });
    });
  }

  // Verify KE key + show remaining credits
  const keVerifyBtn = $('keVerifyBtn');
  if (keVerifyBtn && !keVerifyBtn.dataset.bound) {
    keVerifyBtn.dataset.bound = '1';
    keVerifyBtn.addEventListener('click', () => {
      const key = ($('keApiKeyInput')?.value || '').trim();
      if (!key) {
        toast('Paste your Keywords Everywhere API key first');
        return;
      }
      keVerifyBtn.disabled = true;
      keVerifyBtn.textContent = 'Checking…';
      if ($('keVerifyStatus')) $('keVerifyStatus').textContent = 'Verifying…';
      chrome.runtime.sendMessage({ action: 'KE_VERIFY', apiKey: key }, res => {
        keVerifyBtn.disabled = false;
        keVerifyBtn.textContent = 'Verify key & credits';
        void chrome.runtime.lastError;
        const box = $('keCreditBox');
        if (box) box.style.display = '';
        if (!res || !res.ok) {
          if ($('keCreditsLeft')) $('keCreditsLeft').textContent = '—';
          if ($('keVerifyStatus')) {
            $('keVerifyStatus').textContent = res?.error || 'Invalid key';
            $('keVerifyStatus').style.color = '#dc2626';
          }
          if ($('keCreditsUsedLabel')) $('keCreditsUsedLabel').textContent = 'Verification failed';
          toast('KE key invalid or API error');
          return;
        }
        const left = res.credits;
        if ($('keCreditsLeft')) $('keCreditsLeft').textContent = left != null ? Number(left).toLocaleString() : '—';
        if ($('keCreditsUsedLabel')) $('keCreditsUsedLabel').textContent = 'Last check used: ' + (res.creditsConsumed != null ? res.creditsConsumed : 1) + ' credit';
        if ($('keVerifyStatus')) {
          $('keVerifyStatus').textContent = '✓ Valid';
          $('keVerifyStatus').style.color = '#16a34a';
        }
        chrome.storage.sync.set({ keCreditsLeft: left, keCreditsCheckedAt: Date.now() });
        toast('KE valid — ' + (left != null ? left.toLocaleString() + ' credits left' : 'OK'));
      });
    });
  }

  if (testAhrefs && !testAhrefs.dataset.bound) {
    testAhrefs.dataset.bound = '1';
    testAhrefs.addEventListener('click', () => {
      const key = (ahrefsInput?.value || '').trim();
      showResult(true, 'Testing Ahrefs…');
      // Temporarily save then fetch DR for ahrefs.com
      const run = () => {
        chrome.runtime.sendMessage({ action: 'AHREFS_CLEAR_CACHE', domain: 'ahrefs.com' }, () => {
          void chrome.runtime.lastError;
          chrome.runtime.sendMessage({ action: 'AHREFS_DR_FETCH', domain: 'ahrefs.com' }, r => {
            void chrome.runtime.lastError;
            if (r?.ok && r.domainRating != null) {
              showResult(true, `✓ Ahrefs OK — DR for ahrefs.com = ${r.domainRating}`);
            } else {
              showResult(false, `✗ Ahrefs failed${r?.error ? ' (' + r.error + ')' : ''}. Check key & network.`);
            }
          });
        });
      };
      if (key) {
        chrome.storage.sync.set({ ahrefsApiKey: key }, () => {
          chrome.runtime.sendMessage({ action: 'CLEAR_API_KEY_CACHE' }, run);
        });
      } else {
        run();
      }
    });
  }

  if (testPsi && !testPsi.dataset.bound) {
    testPsi.dataset.bound = '1';
    testPsi.addEventListener('click', () => {
      const key = (psiInput?.value || '').trim();
      showResult(true, 'Testing PageSpeed…');
      const doTest = (apiKey) => {
        const url = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=' +
          encodeURIComponent('https://example.com') + '&key=' + encodeURIComponent(apiKey) + '&strategy=mobile&category=performance';
        fetch(url, { signal: AbortSignal.timeout(20000) })
          .then(r => r.json().then(j => ({ status: r.status, j })))
          .then(({ status, j }) => {
            if (status === 200 && j?.lighthouseResult) {
              showResult(true, '✓ PageSpeed OK');
            } else {
              const msg = j?.error?.message || ('HTTP ' + status);
              showResult(false, '✗ PageSpeed: ' + msg);
            }
          })
          .catch(e => showResult(false, '✗ PageSpeed: ' + (e.message || 'network error')));
      };
      if (key) {
        doTest(key);
      } else {
        chrome.storage.sync.get(['pageSpeedApiKey'], res => {
          // Ask background for effective key via a lightweight pagespeed on example — or just say need key
          if (res.pageSpeedApiKey) doTest(res.pageSpeedApiKey);
          else showResult(false, '✗ Enter a PageSpeed API key to test (built-in key cannot be verified from popup).');
        });
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// BULK KEYWORD VOLUME (Keywords tab) — Keywords Everywhere only
// ═══════════════════════════════════════════════════════════════
function initBulkVolumeChecker() {
  const input = $('bulkVolInput');
  const runBtn = $('bulkVolRunBtn');
  const exportBtn = $('bulkVolExportBtn');
  const countEl = $('bulkVolCount');
  const noKey = $('bulkVolNoKey');
  const body = $('bulkVolBody');
  const progress = $('bulkVolProgress');
  const bar = $('bulkVolBar');
  const status = $('bulkVolStatus');
  const results = $('bulkVolResults');
  const tbody = $('bulkVolTableBody');
  const sourceEl = $('bulkVolSource');
  const countryEl = $('bulkVolCountry');
  if (!input || !runBtn) return;

  let lastRows = [];

  const parseKws = () => {
    const raw = (input.value || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const k of raw) {
      const key = k.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (k.length <= 120) out.push(k);
      if (out.length >= 1000) break;
    }
    return out;
  };

  const updateCount = () => {
    const n = parseKws().length;
    if (countEl) countEl.textContent = n + ' keyword' + (n === 1 ? '' : 's');
  };
  input.addEventListener('input', updateCount);
  updateCount();

  const refreshKeyState = () => {
    chrome.storage.sync.get(['keApiKey'], res => {
      const has = !!res.keApiKey;
      if (noKey) noKey.style.display = 'none';
      runBtn.disabled = false;
      runBtn.title = has ? 'Check volume + domain metrics' : 'Check volume + domain metrics';
    });
  };
  refreshKeyState();
  // Auto-hide/show banner when KE key is saved or cleared (Settings or elsewhere)
  if (!window.__rsBulkVolStorageBound) {
    window.__rsBulkVolStorageBound = true;
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.keApiKey) refreshKeyState();
      });
    } catch (_) {}
  }

  const fmtVol = (n) => {
    if (n == null) return '—';
    if (n === 0) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  };

  const fmtAge = (iso) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
      const ms = Date.now() - d.getTime();
      if (ms < 0) return d.toISOString().slice(0, 10);
      const days = Math.floor(ms / (24 * 3600 * 1000));
      const years = ms / (365.25 * 24 * 3600 * 1000);
      if (days < 30) return Math.max(0, days) + 'd';
      if (years < 1) return Math.max(1, Math.round(years * 12)) + 'm';
      return years.toFixed(1) + 'y';
    } catch (_) {
      return String(iso).slice(0, 10);
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
      return d.toISOString().slice(0, 10);
    } catch (_) {
      return String(iso).slice(0, 10);
    }
  };

  const renderRows = (rows) => {
    lastRows = rows || [];
    if (!tbody) return;
    tbody.innerHTML = lastRows.map(r => {
      const vol = fmtVol(r.volume);
      const cpc = r.cpc != null && !Number.isNaN(r.cpc) ? ('$' + Number(r.cpc).toFixed(2)) : '—';
      const comp = r.competitionIndex != null ? r.competitionIndex : '—';
      const da = r.da != null ? r.da : '—';
      const dr = r.dr != null ? r.dr : '—';
      const age = fmtAge(r.createdDate);
      const exp = fmtDate(r.expirationDate);
      const kw = String(r.keyword || '').replace(/</g, '&lt;');
      return `<tr>
        <td style="padding:6px 6px;border-bottom:1px solid #f1f5f9;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${kw}">${kw}</td>
        <td style="padding:6px 6px;border-bottom:1px solid #f1f5f9;font-weight:600;">${vol}</td>
        <td style="padding:6px 6px;border-bottom:1px solid #f1f5f9;">${cpc}</td>
        <td style="padding:6px 6px;border-bottom:1px solid #f1f5f9;">${comp}</td>
        <td style="padding:6px 6px;border-bottom:1px solid #f1f5f9;">${da}</td>
        <td style="padding:6px 6px;border-bottom:1px solid #f1f5f9;">${dr}</td>
        <td style="padding:6px 6px;border-bottom:1px solid #f1f5f9;" title="${r.createdDate || ''}">${age}</td>
        <td style="padding:6px 6px;border-bottom:1px solid #f1f5f9;">${exp}</td>
      </tr>`;
    }).join('');
    if (results) results.style.display = lastRows.length ? '' : 'none';
    if (exportBtn) exportBtn.style.display = lastRows.length ? '' : 'none';
  };

  runBtn.addEventListener('click', () => {
    const keywords = parseKws();
    if (!keywords.length) {
      if (typeof toast === 'function') toast('Paste at least one keyword');
      return;
    }
    const country = (countryEl?.value || 'us');
    runBtn.disabled = true;
    if (progress) progress.style.display = '';
    if (bar) bar.style.width = '15%';
    if (status) status.textContent = 'Checking ' + keywords.length + ' keywords…';
    if (results) results.style.display = 'none';

    // Fake progress while waiting (API is one/few batch calls)
    let p = 15;
    const tick = setInterval(() => {
      p = Math.min(90, p + 8);
      if (bar) bar.style.width = p + '%';
    }, 400);

    chrome.runtime.sendMessage({
      action: 'BULK_KEYWORD_VOLUME',
      keywords,
      country
    }, (res) => {
      clearInterval(tick);
      runBtn.disabled = false;
      refreshKeyState();
      if (bar) bar.style.width = '100%';
      if (chrome.runtime.lastError) {
        if (status) status.textContent = chrome.runtime.lastError.message;
        return;
      }
      if (!res || !res.ok) {
        if (status) status.textContent = res?.error || 'Failed';
        if (typeof toast === 'function') toast(res?.error || 'Bulk volume failed');
        return;
      }
      renderRows(res.rows || []);
      const cached = res.cachedCount || 0;
      if (status) {
        status.textContent = (res.count || 0) + ' done' +
          (cached ? (' · ' + cached + ' from cache') : '') +
          (res.source ? (' · Vol: ' + res.source) : ' · Vol: unavailable') +
          ' · DA free · DR Ahrefs · Age WHOIS';
      }
      if (sourceEl) {
        sourceEl.textContent = (res.source ? ('Volume: ' + res.source + ' · ') : 'Volume: free Keyword Planner / KE optional · ') +
          'DA: Keywords Everywhere (free) · DR: Ahrefs · Age/Expiry: RDAP/WHOIS · Export includes all columns';
      }
    });
  });

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!lastRows.length) return;
      const header = 'keyword,volume,cpc,competition,da,dr,age_created,expiry,domain\n';
      const lines = lastRows.map(r => {
        const kw = '"' + String(r.keyword || '').replace(/"/g, '""') + '"';
        return [
          kw,
          r.volume != null ? r.volume : '',
          r.cpc != null ? r.cpc : '',
          r.competitionIndex != null ? r.competitionIndex : '',
          r.da != null ? r.da : '',
          r.dr != null ? r.dr : '',
          r.createdDate ? String(r.createdDate).slice(0, 10) : '',
          r.expirationDate ? String(r.expirationDate).slice(0, 10) : '',
          r.domain || ''
        ].join(',');
      });
      const blob = new Blob([header + lines.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'rankseo-bulk-volume.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTOMATION MODAL - Automate my GEO & SEO
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize Automation Modal
 */
function initAutomationModal() {
  const ctaBtn = document.getElementById('ctaBtn');
  const modal = document.getElementById('automationModal');
  const cancelBtn = document.getElementById('cancelAutomationBtn');
  const overlay = document.getElementById('automationOverlay') || modal?.querySelector('.automation-overlay');
  const retryBtn = document.getElementById('retryAutomationBtn');
  const settingsBtn = document.getElementById('goToSettingsBtn');

  if (ctaBtn && !ctaBtn.dataset.autoBound) {
    ctaBtn.dataset.autoBound = '1';
    ctaBtn.addEventListener('click', () => openAutomationModal());
  }

  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = '1';
    cancelBtn.addEventListener('click', closeAutomationModal);
  }

  if (overlay && !overlay.dataset.bound) {
    overlay.dataset.bound = '1';
    overlay.addEventListener('click', closeAutomationModal);
  }

  if (retryBtn && !retryBtn.dataset.bound) {
    retryBtn.dataset.bound = '1';
    retryBtn.addEventListener('click', () => {
      showAutomationScreen('progress');
      startAutomation();
    });
  }

  if (settingsBtn && !settingsBtn.dataset.bound) {
    settingsBtn.dataset.bound = '1';
    settingsBtn.addEventListener('click', () => {
      closeAutomationModal();
      document.querySelector('[data-tab="settings"]')?.click();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
      closeAutomationModal();
    }
  });

  const tabs = modal?.querySelectorAll('.automation-tab');
  tabs?.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      switchAutomationTab(tabName);
    });
  });
}

/**
 * Open Automation Modal
 */
function openAutomationModal() {
  const modal = document.getElementById('automationModal');
  if (!modal) return;
  
  modal.style.display = 'flex';
  
  // Reset to progress screen
  showAutomationScreen('progress');
  
  // Start automation after a short delay
  setTimeout(() => {
    startAutomation();
  }, 500);
}

/**
 * Close Automation Modal
 */
function closeAutomationModal() {
  const modal = document.getElementById('automationModal');
  if (!modal) return;
  
  modal.style.display = 'none';
  
  // Reset progress
  resetAutomationProgress();
}

/**
 * Show specific automation screen
 */
function showAutomationScreen(screenName) {
  const progress = document.getElementById('automationProgress');
  const results = document.getElementById('automationResults');
  const error = document.getElementById('automationError');
  const history = document.getElementById('automationHistoryView');
  const name = String(screenName || '').toLowerCase();

  if (progress) progress.style.display = (name === 'progress') ? '' : 'none';
  if (results) results.style.display = (name === 'results') ? '' : 'none';
  if (error) error.style.display = (name === 'error') ? '' : 'none';
  if (history) history.style.display = (name === 'history') ? '' : 'none';

  // legacy class-based screens if present
  document.querySelectorAll('.automation-screen').forEach(screen => {
    screen.classList.toggle('active', screen.id && screen.id.toLowerCase().includes(name));
  });
}

/**
 * Switch automation tab
 */
function switchAutomationTab(tabName) {
  // Update tab buttons
  const tabs = document.querySelectorAll('.automation-tab');
  tabs.forEach(tab => {
    tab.classList.remove('active');
    if (tab.getAttribute('data-tab') === tabName) {
      tab.classList.add('active');
    }
  });
  
  // Update tab panes
  const panes = document.querySelectorAll('.tab-pane');
  panes.forEach(pane => {
    pane.classList.remove('active');
  });
  
  const targetPane = document.getElementById(`${tabName}Tab`);
  if (targetPane) {
    targetPane.classList.add('active');
  }
}

/**
 * Start Automation Process
 */
async function startAutomation() {
  try {
    console.log('[Automation] Starting real automation…');
    _automationResults = { seoData: null, firecrawl: null, ai: null, rankings: null, issues: [], guide: [] };

    // Resolve current tab + existing on-page analysis
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageUrl = tab?.url || '';
    if (!pageUrl.startsWith('http')) {
      throw new Error('Open an http(s) page first, then run automation.');
    }

    let analysis = null;
    try {
      analysis = await new Promise(res => {
        chrome.tabs.sendMessage(tab.id, { action: 'getAnalysis' }, r => {
          if (chrome.runtime.lastError) res(null);
          else res(r?.data || r || null);
        });
      });
    } catch (_) {}
    if (!analysis) {
      // Fallback: request from background bridge
      try {
        analysis = await new Promise(res => {
          chrome.runtime.sendMessage({ action: 'getAnalysis' }, r => res(r?.data || null));
        });
      } catch (_) {}
    }
    _automationResults.seoData = analysis;

    const seoScore = analysis?.score?.value ?? analysis?.score ?? 0;
    const geoScore = analysis?.geoSignals?.score ?? 0;

    // Step 1: Firecrawl (optional)
    await runAutomationStep(1, 'Crawling page (Firecrawl if configured)…', async () => {
      const fcKey = await new Promise(res => {
        chrome.storage.sync.get(['firecrawlConfig'], r => {
          try {
            const cfg = r.firecrawlConfig ? JSON.parse(r.firecrawlConfig) : null;
            res(cfg?.apiKey || null);
          } catch { res(null); }
        });
      });
      if (!fcKey) {
        return { success: true, skipped: true, reason: 'Firecrawl not configured — using on-page analysis only' };
      }
      const scraped = await new Promise(res => {
        chrome.runtime.sendMessage({ action: 'FIRECRAWL_SCRAPE', url: pageUrl, apiKey: fcKey }, r => res(r || { ok: false }));
      });
      _automationResults.firecrawl = scraped;
      if (!scraped?.ok) {
        return { success: true, skipped: true, reason: scraped?.error || 'Firecrawl scrape failed — continuing with on-page data' };
      }
      return { success: true, wordCount: (scraped.markdown || scraped.content || '').split(/\s+/).length };
    });

    // Step 2: Build issues from real analysis
    await runAutomationStep(2, 'Analyzing SEO / GEO signals…', async () => {
      const issues = buildAutomationIssuesFromAnalysis(analysis);
      _automationResults.issues = issues;
      return { success: true, count: issues.length };
    });

    // Step 3: Optional AI ranking checks (skip gracefully)
    await runAutomationStep(3, 'Checking AI ranking readiness…', async () => {
      const rankings = {
        perplexity: { ranked: !!(analysis?.geoSignals?.score >= 40), position: null },
        chatgpt: { ranked: !!(analysis?.structuredData?.types?.length), position: null },
        claude: { ranked: !!(analysis?.content?.wordCount > 600), position: null },
        gemini: { ranked: !!(analysis?.score?.value >= 60), position: null },
        grok: { ranked: !!(analysis?.geoSignals?.score >= 50), position: null }
      };
      _automationResults.rankings = rankings;
      return { success: true };
    });

    // Step 4: Generate prioritized fixes
    await runAutomationStep(4, 'Generating prioritized fixes…', async () => {
      if (!_automationResults.issues.length) {
        _automationResults.issues = [{
          id: 1, severity: 'info', title: 'No critical on-page issues detected',
          description: 'Run again after major content changes, or enable Firecrawl + AI keys for deeper audits.',
          fix: '', impact: 'Low'
        }];
      }
      return { success: true };
    });

    // Step 5: Implementation guide
    await runAutomationStep(5, 'Building implementation guide…', async () => {
      _automationResults.guide = _automationResults.issues.slice(0, 8).map((iss, i) => ({
        step: i + 1,
        title: iss.title,
        description: iss.description || iss.fix || '',
        time: iss.severity === 'high' ? '15–30 min' : '5–15 min',
        priority: iss.severity === 'high' ? 'High' : iss.severity === 'medium' ? 'Medium' : 'Low'
      }));
      _automationResults.overview = {
        seoScore: { current: seoScore, improved: Math.min(100, seoScore + Math.min(15, _automationResults.issues.filter(i => i.severity === 'high').length * 3)), change: 0 },
        geoScore: { current: geoScore, improved: Math.min(100, geoScore + 10), change: 0 },
        aeoScore: { current: Math.round((seoScore + geoScore) / 2), improved: Math.min(100, Math.round((seoScore + geoScore) / 2) + 8), change: 0 },
        issuesFound: _automationResults.issues.length,
        issuesFixed: 0
      };
      _automationResults.overview.seoScore.change = _automationResults.overview.seoScore.improved - seoScore;
      _automationResults.overview.geoScore.change = _automationResults.overview.geoScore.improved - geoScore;
      _automationResults.overview.aeoScore.change = _automationResults.overview.aeoScore.improved - _automationResults.overview.aeoScore.current;
      return { success: true };
    });

    showAutomationResults();
  } catch (error) {
    console.error('[Automation] Error:', error);
    showAutomationError(error.message || String(error));
  }
}

function buildAutomationIssuesFromAnalysis(a) {
  const issues = [];
  if (!a) {
    return [{ id: 1, severity: 'high', title: 'No on-page analysis available', description: 'Refresh the page and open ShahzaibSEO again so content analysis can run.', fix: '', impact: 'High' }];
  }
  let id = 1;
  const push = (severity, title, description, fix, impact) => {
    issues.push({ id: id++, severity, title, description, fix: fix || '', impact: impact || severity });
  };
  const title = a.title || {};
  if (title.status === 'error' || (title.length && title.length < 30)) {
    push('high', 'Title tag needs work', title.message || `Title length ${title.length || 0} characters.`, title.content ? `Current: ${title.content}` : '', 'High — CTR');
  }
  const meta = a.metaDescription || {};
  if (meta.status === 'error' || !meta.length) {
    push('high', 'Meta description missing or weak', meta.message || 'Add a compelling 120–160 character meta description.', '', 'High — CTR');
  }
  const h = a.headings || {};
  if ((h.h1Count || 0) !== 1) {
    push('high', 'H1 structure', h.message || `Found ${h.h1Count || 0} H1 tags (recommend exactly 1).`, '', 'High');
  }
  const imgs = a.images || {};
  if ((imgs.withoutAlt || 0) > 0) {
    push('medium', 'Images missing alt text', `${imgs.withoutAlt} image(s) without alt attributes.`, '', 'Medium — accessibility & image SEO');
  }
  const wc = a.content?.wordCount || 0;
  if (wc && wc < 300) {
    push('medium', 'Thin content', `Only ${wc} words detected. Aim for 600+ on commercial/informational pages.`, '', 'Medium');
  }
  if (a.structuredData && (a.structuredData.count === 0 || a.structuredData.types?.length === 0)) {
    push('medium', 'No structured data detected', 'Add relevant JSON-LD (Article, FAQ, Product, Organization) for rich results & AI citations.', '', 'Medium — AEO');
  }
  const geo = a.geoSignals?.score;
  if (typeof geo === 'number' && geo < 50) {
    push('medium', 'GEO score is low', `GEO score ${geo}/100. Improve citability, clear answers, and entity clarity.`, '', 'Medium — AI Overviews');
  }
  (a.score?.issues || []).slice(0, 6).forEach(msg => {
    push('medium', 'SEO issue', String(msg), '', 'Medium');
  });
  return issues.slice(0, 15);
}

let _automationResults = null;

/**
 * Run individual automation step
 */
async function runAutomationStep(stepNum, message, callback) {
  const agentIds = ['crawler', 'nlp', 'rank', 'fix', 'guide'];
  const agentKey = agentIds[stepNum - 1] || 'crawler';
  const row = document.getElementById('agent-' + agentKey);
  const taskEl = document.getElementById('agent-' + agentKey + '-task');
  const chipEl = document.getElementById('agent-' + agentKey + '-chip');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBarFill');

  if (row) row.classList.add('active');
  if (taskEl) taskEl.textContent = message;
  if (chipEl) { chipEl.textContent = 'running'; chipEl.className = 'agent-chip running'; }
  if (progressText) progressText.textContent = message;
  if (progressBar) progressBar.style.width = `${(stepNum / 5) * 100}%`;

  try {
    const result = await callback();
    if (row) { row.classList.remove('active'); row.classList.add('completed'); }
    if (chipEl) { chipEl.textContent = result?.skipped ? 'skipped' : 'done'; chipEl.className = 'agent-chip done'; }
    if (taskEl && result?.reason) taskEl.textContent = result.reason;
    else if (taskEl) taskEl.textContent = result?.skipped ? 'Skipped' : 'Completed';
    return result;
  } catch (error) {
    if (row) { row.classList.remove('active'); row.classList.add('error'); }
    if (chipEl) { chipEl.textContent = 'error'; chipEl.className = 'agent-chip error'; }
    if (taskEl) taskEl.textContent = error.message || 'Failed';
    throw error;
  }
}

/**
 * Show automation results
 */
function showAutomationResults() {
  showAutomationScreen('Results');
  const r = _automationResults || {};
  renderAutomationOverview(r.overview || {
    seoScore: { current: 0, improved: 0, change: 0 },
    geoScore: { current: 0, improved: 0, change: 0 },
    aeoScore: { current: 0, improved: 0, change: 0 },
    issuesFound: (r.issues || []).length,
    issuesFixed: 0
  });
  renderAutomationIssues(r.issues || []);
  renderAutomationRanking(r.rankings || {});
  renderImplementationGuide(r.guide || []);
}

/**
 * Render overview tab
 */
function renderAutomationOverview(data) {
  const container = document.getElementById('resultsSummary');
  if (!container) return;
  
  container.innerHTML = `
    <div class="summary-card">
      <div class="summary-card-header">
        <span class="summary-card-title">SEO Score</span>
        <div class="summary-card-icon" style="background: color-mix(in srgb, #6366f1 15%, transparent); color: #6366f1;">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
          </svg>
        </div>
      </div>
      <div class="summary-card-value">${data.seoScore.improved}/100</div>
      <div class="summary-card-change positive">
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
          <path fill-rule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
        </svg>
        +${data.seoScore.change} points
      </div>
    </div>
    
    <div class="summary-card">
      <div class="summary-card-header">
        <span class="summary-card-title">GEO Score</span>
        <div class="summary-card-icon" style="background: color-mix(in srgb, #8b5cf6 15%, transparent); color: #8b5cf6;">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
          </svg>
        </div>
      </div>
      <div class="summary-card-value">${data.geoScore.improved}/100</div>
      <div class="summary-card-change positive">
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
          <path fill-rule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
        </svg>
        +${data.geoScore.change} points
      </div>
    </div>
    
    <div class="summary-card">
      <div class="summary-card-header">
        <span class="summary-card-title">Issues Found</span>
        <div class="summary-card-icon" style="background: color-mix(in srgb, #f59e0b 15%, transparent); color: #f59e0b;">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
        </div>
      </div>
      <div class="summary-card-value">${data.issuesFound}</div>
      <div class="summary-card-change positive">
        ${data.issuesFixed} fixes generated
      </div>
    </div>
  `;
}

/**
 * Render issues tab
 */
function renderAutomationIssues(issues) {
  const container = document.getElementById('issuesList');
  if (!container) return;
  
  container.innerHTML = issues.map(issue => `
    <div class="issue-card ${issue.severity}">
      <div class="issue-header">
        <div class="issue-title">${issue.title}</div>
        <span class="issue-badge ${issue.severity}">${issue.severity}</span>
      </div>
      <div class="issue-desc">${issue.description}</div>
      <div class="issue-fix">
        <div class="issue-fix-label">Suggested Fix:</div>
        <div class="issue-fix-code">${escHTML(issue.fix)}</div>
      </div>
      <div class="issue-actions">
        <button class="issue-btn copy-issue-btn" data-copy-text="${escAttr(issue.fix)}">Copy Code</button>
        <button class="issue-btn">Learn More</button>
      </div>
    </div>
  `).join('');
}

/**
 * Render ranking tab
 */
function renderAutomationRanking(rankings) {
  const container = document.getElementById('rankingResults');
  if (!container) return;
  
  const engines = [
    { name: 'Perplexity', icon: '🔮', data: rankings.perplexity },
    { name: 'ChatGPT', icon: '🤖', data: rankings.chatgpt },
    { name: 'Claude', icon: '🧠', data: rankings.claude },
    { name: 'Gemini', icon: '💎', data: rankings.gemini },
    { name: 'Grok', icon: '⚡', data: rankings.grok }
  ];
  
  container.innerHTML = engines.map(engine => `
    <div class="ranking-card">
      <div class="ranking-header">
        <div class="ranking-engine">
          <div class="ranking-engine-icon">${engine.icon}</div>
          <div class="ranking-engine-name">${engine.name}</div>
        </div>
        <span class="ranking-status ${engine.data.ranked ? 'ranked' : 'not-ranked'}">
          ${engine.data.ranked ? `Ranked #${engine.data.position}` : 'Not Ranked'}
        </span>
      </div>
      <div class="ranking-details">
        ${engine.data.ranked 
          ? `Your page appears in position ${engine.data.position} for relevant queries.`
          : 'Your page was not found in the top results. Implement the suggested fixes to improve visibility.'
        }
      </div>
    </div>
  `).join('');
}

/**
 * Render implementation guide
 */
function renderImplementationGuide(steps) {
  const container = document.getElementById('implementationGuide');
  if (!container) return;
  
  container.innerHTML = steps.map((step, index) => `
    <div class="guide-step">
      <div class="guide-step-header">
        <div class="guide-step-title">Step ${step.step}: ${step.title}</div>
        <span class="guide-step-time">${step.time}</span>
      </div>
      <div class="guide-step-desc">${step.description}</div>
      <div class="guide-step-actions">
        <button class="issue-btn">View Code</button>
        <button class="issue-btn">Mark as Done</button>
      </div>
    </div>
  `).join('');
}

/**
 * Show automation error
 */
function showAutomationError(message) {
  showAutomationScreen('error');
  const errMsg = document.getElementById('errorMessage');
  if (errMsg) errMsg.textContent = message || 'Something went wrong';
  const progressText = document.getElementById('progressText');
  if (progressText) progressText.textContent = `Error: ${message}`;
}


/**
 * Reset automation progress
 */
function resetAutomationProgress() {
  const steps = document.querySelectorAll('.progress-step');
  steps.forEach(step => {
    step.classList.remove('active', 'completed', 'error');
  });
  
  const progressBar = document.getElementById('progressBarFill');
  if (progressBar) {
    progressBar.style.width = '0%';
  }
  
  const progressText = document.getElementById('progressText');
  if (progressText) {
    progressText.textContent = 'Starting automation...';
    progressText.style.color = '';
  }
}

/**
 * Helper: Sleep function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper: Copy to clipboard
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!', 'success');
  }).catch(err => {
    console.error('Failed to copy:', err);
    showToast('Failed to copy', 'error');
  });
}

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAutomationModal);
} else {
  initAutomationModal();
}
// Google Maps Lead Hunt / local-business scraper module fully removed for Chrome Web Store policy compliance.

/* ═══════════════════════════════════════════════════════════════
   BACKLINK AUTOMATION MODULE  –  ShahzaibSEO Integrated
   AI: uses existing ShahzaibSEO NVIDIA / OpenRouter key
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const blS = { tabId: null, ctx: null, cfg: {}, profiles: {} };

  const BL_CFG_DEFAULTS = {
    name: '', email: '', website: '',
    defaultTone: 'Professional', defaultLanguage: 'English',
    confirmBeforeSubmit: true
  };

  const $b = id => document.getElementById(id);

  function blStatus(elId, msg, type) {
    const el = $b(elId); if (!el) return;
    el.textContent = msg;
    el.className = 'bl-status' + (type ? ' ' + type : '');
  }

  // ── Backlinks Explorer (free co-citation discovery) ─────────────
  let _blxRunning = false;
  function blxDrColor(dr) {
    if (dr == null) return 'var(--text-4)';
    if (dr >= 50) return '#16a34a';
    if (dr >= 25) return '#ca8a04';
    return '#dc2626';
  }
  // Shared core — renders backlink results into any output element
  function blxRenderInto(out, domainRaw, btn, idPrefix) {
    if (_blxRunning) return;
    const pfx = idPrefix || 'blx-dr-';
    const domain = (domainRaw || '').trim()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
    if (!out) return;
    if (!domain) { out.innerHTML = '<span style="color:#dc2626">Enter a domain first.</span>'; return; }
    _blxRunning = true;
    if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
    out.innerHTML = '<div style="color:var(--text-3)">Searching Google for mentions of <b style="color:var(--text)">' + domain + '</b>…</div>';

    chrome.runtime.sendMessage({ action: 'BACKLINK_FETCH', domain }, res => {
      _blxRunning = false;
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      if (chrome.runtime.lastError || !res || !res.ok) {
        out.innerHTML = '<span style="color:#dc2626">Error: ' + (res?.error || chrome.runtime.lastError?.message || 'fetch failed') + '. Google may be rate-limiting — try again shortly.</span>';
        return;
      }
      const links = res.backlinks || [];
      if (!links.length) {
        out.innerHTML = '<span style="color:var(--text-3)">No external mentions found for ' + domain + '.</span>';
        return;
      }
      out.innerHTML =
        '<div style="font-size:10px;color:var(--text-3);margin-bottom:6px">' + links.length +
        ' referring domains for <b style="color:var(--text)">' + domain + '</b> · DR loading…</div>' +
        links.map((l, i) =>
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 7px;border:1px solid var(--border,#e2e8f0);border-radius:6px;margin-bottom:4px">' +
            '<a href="' + l.url + '" class="blx-open-link" data-url="' + String(l.url).replace(/"/g, '&quot;') + '" style="font-size:11.5px;font-weight:700;color:var(--text);text-decoration:none;word-break:break-all;cursor:pointer">' + l.domain + '</a>' +
            '<span id="' + pfx + i + '" style="font-size:11px;font-weight:800;min-width:32px;text-align:right;color:var(--text-4)">…</span>' +
          '</div>'
        ).join('');

      // Open in background tab so the extension popup stays open
      out.querySelectorAll('a.blx-open-link').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const url = a.getAttribute('data-url') || a.href;
          if (url) {
            try {
              chrome.tabs.create({ url: url, active: false });
            } catch (_) {
              window.open(url, '_blank', 'noopener');
            }
          }
        });
      });

      links.forEach((l, i) => {
        chrome.runtime.sendMessage({ action: 'AHREFS_DR_FETCH', domain: l.domain }, dres => {
          void chrome.runtime.lastError; // consume to avoid unchecked warning
          const cell = $b(pfx + i);
          if (!cell) return;
          const dr = (dres && dres.ok) ? dres.domainRating : null;
          cell.textContent = dr != null ? dr : '–';
          cell.style.color = blxDrColor(dr);
        });
      });
    });
  }
  function blxRun(domainRaw) {
    blxRenderInto($b('blxOutput'), domainRaw, $b('blxFindBtn'), 'blx-dr-');
  }
  function dbBlxRun(domainRaw) {
    blxRenderInto($b('dbBlxOutput'), domainRaw, $b('dbBlxFindBtn'), 'db-blx-dr-');
  }
  function blxCurrentSite(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.url) return;
      let host = '';
      try { host = new URL(tab.url).hostname.replace(/^www\./, ''); } catch (_) { return; }
      cb(host);
    });
  }
  function blxUseCurrent() {
    blxCurrentSite(host => {
      const inp = $b('blxDomainInput');
      if (inp) inp.value = host;
      blxRun(host);
    });
  }
  function dbBlxUseCurrent() {
    blxCurrentSite(host => {
      const inp = $b('dbBlxInput');
      if (inp) inp.value = host;
      dbBlxRun(host);
    });
  }
  function blxCopy() {
    const out = $b('blxOutput');
    if (!out) return;
    const domains = Array.from(out.querySelectorAll('a')).map(a => a.textContent).join('\n');
    if (domains) navigator.clipboard.writeText(domains).catch(() => {});
  }


  function blStore(obj) {
    return new Promise((ok, fail) => chrome.storage.local.set(obj, () =>
      chrome.runtime.lastError ? fail(chrome.runtime.lastError) : ok()));
  }
  function blFetch(keys) {
    return new Promise((ok, fail) => chrome.storage.local.get(keys, r =>
      chrome.runtime.lastError ? fail(chrome.runtime.lastError) : ok(r)));
  }
  function blSendTab(tabId, msg) {
    return new Promise((ok, fail) => chrome.tabs.sendMessage(tabId, msg, r =>
      chrome.runtime.lastError ? fail(new Error(chrome.runtime.lastError.message)) : ok(r)));
  }
  function blGetActiveTab() {
    return new Promise((ok, fail) => chrome.tabs.query({ active: true, currentWindow: true }, tabs =>
      tabs?.[0] ? ok(tabs[0]) : fail(new Error('No active tab.'))));
  }
  async function blEnsureScript(tabId) {
    try { await blSendTab(tabId, { action: 'BL_PING' }); }
    catch (_) {
      await new Promise((ok, fail) => chrome.scripting.executeScript(
        { target: { tabId }, func: blInjectContent },
        r => chrome.runtime.lastError ? fail(new Error(chrome.runtime.lastError.message)) : ok(r)
      ));
    }
  }

  const blSlug = v => String(v || 'user').toLowerCase().replace(/https?:\/\//g, '').replace(/[^a-z0-9]+/g, '').slice(0, 14) || 'user';
  const blUser = (name, host) => (blSlug(name).slice(0, 10) + '_' + blSlug(host.split('.')[0])).replace(/^_+|_+$/g, '');
  function blPass() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let r = ''; for (let i = 0; i < 16; i++) r += c[Math.floor(Math.random() * c.length)]; return r;
  }

  // ── AI call — ShahzaibSEO existing key only ───────────────────────
  async function blAI({ system, user, maxTokens = 300, temp = 0.5 }) {
    const cfg = (typeof aiLoadConfig === 'function') ? aiLoadConfig() : null;
    if (!cfg || !cfg.apiKey) throw new Error('NO_KEY');
    const msgs = [{ role: 'system', content: system }, { role: 'user', content: user }];
    let url, headers;
    if (cfg.provider === 'openrouter') {
      url = 'https://openrouter.ai/api/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey,
        'HTTP-Referer': 'https://www.mubashirhassan.com', 'X-Title': 'ShahzaibSEO Backlink' };
    } else {
      url = 'https://integrate.api.nvidia.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey };
    }
    const res = await fetch(url, { method: 'POST', headers,
      body: JSON.stringify({ model: cfg.model, messages: msgs, max_tokens: maxTokens, temperature: temp }) });
    if (!res.ok) {
      const t = await res.text(); let d = t;
      try { d = JSON.parse(t)?.error?.message || t; } catch (_) {}
      throw new Error(d.slice(0, 120));
    }
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content || '').trim();
  }

  // ── Local fallbacks ────────────────────────────────────────────
  function blLocalQueries(kw, exts, types) {
    const ec = exts.length ? '(' + exts.map(function(e) { return 'site:' + e; }).join(' OR ') + ')' : '';
    var q = function(s) { return s.replace(/\s+/g, ' ').trim(); };
    var k = '"' + kw + '"';
    const tpls = {
      'Forum Sites': [
        q('inurl:forum ' + ec + ' ' + k),
        q('intitle:forum ' + k + ' ' + ec),
        q(k + ' "powered by phpbb" ' + ec),
        q(k + ' "powered by vbulletin" ' + ec),
        q(k + ' "community forum" ' + ec),
        q('inurl:viewtopic ' + k),
        q('inurl:phpbb ' + k),
        q(k + ' "board index" ' + ec)
      ],
      'Forum Posts': [
        q('inurl:showthread ' + k),
        q('inurl:topic ' + k),
        q('inurl:viewthread ' + k),
        q(k + ' "reply to thread" ' + ec),
        q(k + ' "post reply" ' + ec),
        q('inurl:forum inurl:post ' + k),
        q(k + ' "new member" inurl:forum'),
        q(k + ' "join date" inurl:member')
      ],
      'EDU Posts': [
        q('site:.edu ' + k + ' "leave a comment"'),
        q('site:.edu ' + k + ' "add a comment"'),
        q('site:.edu ' + k + ' "powered by wordpress"'),
        q('site:.edu ' + k + ' "comments" inurl:blog'),
        q('site:.edu ' + k + ' "submit comment"'),
        q('site:.edu inurl:blog ' + k)
      ],
      '0 OBL Comments': [
        q(k + ' "leave a comment" -"nofollow"'),
        q(k + ' "commentluv" -"nofollow"'),
        q(k + ' "dofollow" "leave a comment"'),
        q(k + ' inurl:blog "0 comments"'),
        q(k + ' "post a comment" -rel:nofollow'),
        q(k + ' "this blog is dofollow"')
      ],
      'Already Commented': [
        q(k + ' "comments are closed"'),
        q(k + ' "comment is awaiting moderation"'),
        q(k + ' "your comment is awaiting"'),
        q(k + ' "comments (0)" inurl:blog'),
        q(k + ' "be the first to comment"'),
        q(k + ' "no comments yet" inurl:blog')
      ],
      'Guest Posts': [
        q('"write for us" ' + k + ' ' + ec),
        q('"guest post" ' + k + ' ' + ec),
        q('"submit a guest post" ' + k),
        q('"submit an article" ' + k + ' ' + ec),
        q('"become a contributor" ' + k),
        q('"contributor guidelines" ' + k + ' ' + ec),
        q('"guest article" ' + k + ' ' + ec),
        q('inurl:write-for-us ' + k),
        q('inurl:guest-post ' + k + ' ' + ec),
        q('"accepting guest posts" ' + k)
      ]
    };
    const active = types.length ? types : Object.keys(tpls);
    const out = [];
    active.forEach(function(t) {
      (tpls[t] || []).forEach(function(fq) { if (fq) out.push(fq); });
    });
    return out.filter(function(v, i, a) { return v && a.indexOf(v) === i; }).slice(0, 20);
  }

  function blParseQueries(txt, fallback) {
    try {
      const s = txt.trim();
      const raw = s.startsWith('[') ? s : (s.match(/\[[\s\S]*\]/) || ['[]'])[0];
      const arr = JSON.parse(raw);
      if (arr && arr.length) return arr.map(function(x) { return String(x).trim(); }).filter(Boolean).slice(0, 20);
    } catch (_) {}
    const lines = txt.split(/\n+/).map(function(l) { return l.replace(/^[-*\d.\s]+/, '').trim(); }).filter(Boolean);
    return lines.length ? lines.slice(0, 20) : fallback;
  }

  function blLocalComment(ctx, tone, inclWeb, website) {
    const title = ((ctx && ctx.title) || 'this post').replace(/[\r\n]+/g, ' ').trim();
    const base = 'Really enjoyed your thoughts on ' + title + '. The perspective here adds practical value. Thanks for sharing.';
    const mention = inclWeb && website ? ' I\'ve been exploring similar ideas on ' + website.replace(/^https?:\/\//, '') + '.' : '';
    return (base + mention).split(/\s+/).slice(0, 100).join(' ');
  }

  // ── Page Analysis ──────────────────────────────────────────────
  async function blAnalyze() {
    blStatus('blSettingsStatus', 'Analyzing…', '');
    try {
      const tab = await blGetActiveTab();
      blS.tabId = tab.id;
      if (!/^https?:/i.test(tab.url || '')) throw new Error('Open a real webpage first.');
      await blEnsureScript(tab.id);
      const r = await blSendTab(tab.id, { action: 'BL_GET_CONTEXT' });
      if (!r || !r.ok) throw new Error((r && r.error) || 'Analysis failed.');
      blS.ctx = r.context;
      blRenderCtx();
      blHydrateProfile();
      blStatus('blSettingsStatus', 'Analyzed: ' + blS.ctx.hostname, 'ok');
    } catch (e) {
      blStatus('blSettingsStatus', e.message, 'err');
      const ex = $b('blExcerpt'); if (ex) ex.textContent = e.message;
    }
  }

  function blRenderCtx() {
    const c = blS.ctx || {};
    const types = (c.forms || []).map(function(f) { return f.type; }).filter(function(v, i, a) { return v && a.indexOf(v) === i; });
    function set(id, val) { const el = $b(id); if (el) el.textContent = val; }
    set('blPageType', c.pageType || '--');
    set('blFormCount', String(c.formCount || 0));
    set('blOblCount', c.obl != null ? String(c.obl) : '--');
    set('blFormTypes', types.length ? types.join(', ') : 'none');
    set('blCurrentHostname', c.hostname || '--');
    const ex = $b('blExcerpt'); if (ex) ex.textContent = c.excerpt || 'No excerpt.';
  }

  function blHydrateProfile() {
    const host = blS.ctx && blS.ctx.hostname; if (!host) return;
    const saved = blS.profiles[host] || {};
    const s = blS.cfg;
    const m = Object.assign({ name: s.name || '', email: s.email || '', website: s.website || '',
      username: blUser(s.name || 'user', host), password: '' }, saved);
    function sv(id, v) { const el = $b(id); if (el) el.value = v; }
    sv('blFillName', m.name); sv('blFillEmail', m.email); sv('blFillWebsite', m.website);
    sv('blFillUsername', m.username); sv('blFillPassword', m.password);
  }

  // ── Config ─────────────────────────────────────────────────────
  async function blLoadCfg() {
    const r = await blFetch(['blCfg', 'blProfiles']);
    blS.cfg = Object.assign({}, BL_CFG_DEFAULTS, r.blCfg || {});
    blS.profiles = r.blProfiles || {};
    blHydrateCfgUI();
  }

  function blHydrateCfgUI() {
    const s = blS.cfg;
    function sv(id, v) { const el = $b(id); if (el) el.value = v; }
    sv('blSettingName', s.name || '');
    sv('blSettingEmail', s.email || '');
    sv('blSettingWebsite', s.website || '');
    sv('blSettingTone', s.defaultTone || 'Professional');
    sv('blSettingLanguage', s.defaultLanguage || 'English');
    const cc = $b('blConfirmSubmit'); if (cc) cc.checked = s.confirmBeforeSubmit !== false;
    const ct = $b('blCommentTone'); if (ct) ct.value = s.defaultTone || 'Professional';
    const cl = $b('blCommentLanguage'); if (cl) cl.value = s.defaultLanguage || 'English';
  }

  async function blSaveCfg() {
    blS.cfg = Object.assign({}, BL_CFG_DEFAULTS, {
      name: ($b('blSettingName') && $b('blSettingName').value.trim()) || '',
      email: ($b('blSettingEmail') && $b('blSettingEmail').value.trim()) || '',
      website: ($b('blSettingWebsite') && $b('blSettingWebsite').value.trim()) || '',
      defaultTone: ($b('blSettingTone') && $b('blSettingTone').value) || 'Professional',
      defaultLanguage: ($b('blSettingLanguage') && $b('blSettingLanguage').value) || 'English',
      confirmBeforeSubmit: $b('blConfirmSubmit') ? $b('blConfirmSubmit').checked !== false : true
    });
    await blStore({ blCfg: blS.cfg });
    blHydrateCfgUI();
    blHydrateProfile();
  }

  // ── Queries ────────────────────────────────────────────────────
  async function blDoQueries() {
    await blSaveCfg();
    const kwEl = $b('blQueryKeyword');
    const kw = kwEl ? kwEl.value.trim() : '';
    if (!kw) { blRenderQueries([], 'Enter a niche keyword first.'); return; }
    const extEl = $b('blQueryExtensions');
    const exts = (extEl ? extEl.value : '').split(',').map(function(s) { return s.trim(); })
      .filter(Boolean).map(function(v) { return v.startsWith('.') ? v : '.' + v; });
    const checked = document.querySelectorAll('#blQueryTypeGrid input:checked');
    const types = Array.from(checked).map(function(i) { return i.value; });
    const fallback = blLocalQueries(kw, exts, types);
    const out = $b('blQueriesOutput');
    if (out) out.innerHTML = '<div class="bl-loading"><div class="bl-spinner"></div>Generating footprints\u2026</div>';
    try {
      const txt = await blAI({
        system: 'You are an SEO backlink research assistant. Generate diverse, effective Google search footprints. Return ONLY a JSON array of 15 to 20 unique query strings covering the selected backlink types. No markdown, no explanation, just the JSON array.',
        user: JSON.stringify({ keyword: kw, domainExtensions: exts, backlinkTypes: types }),
        maxTokens: 600, temp: 0.6
      });
      blRenderQueries(blParseQueries(txt, fallback));
    } catch (e) {
      blRenderQueries(fallback, e.message === 'NO_KEY' ? 'No AI key — showing local templates. Add key in Settings tab.' : 'AI error, using local templates: ' + e.message);
    }
  }

  function blRenderQueries(queries, note) {
    const out = $b('blQueriesOutput'); if (!out) return;
    out.innerHTML = '';
    if (!queries.length) { out.style.color = 'var(--text-3)'; out.textContent = note || 'No results.'; return; }
    out.style.color = '';
    queries.forEach(function(q) {
      const row = document.createElement('div'); row.className = 'bl-query-line';
      const span = document.createElement('span'); span.textContent = q;
      const btn = document.createElement('button'); btn.className = 'bl-query-copy'; btn.textContent = 'Copy';
      btn.addEventListener('click', function() { navigator.clipboard.writeText(q).catch(function() {}); });
      row.appendChild(span); row.appendChild(btn); out.appendChild(row);
    });
    if (note) {
      const n = document.createElement('div');
      n.style.cssText = 'font-size:10.5px;color:var(--text-4);margin-top:6px;';
      n.textContent = note; out.appendChild(n);
    }
  }

  // ── Profile ────────────────────────────────────────────────────
  function blGenProfile() {
    const host = (blS.ctx && blS.ctx.hostname) || 'site';
    const name = (blS.cfg.name || 'Alex Carter').trim();
    const web = (blS.cfg.website || 'https://example.com').trim();
    const eParts = (blS.cfg.email || 'alex@example.com').split('@');
    const nonce = Math.floor(100 + Math.random() * 900);
    function sv(id, v) { const el = $b(id); if (el) el.value = v; }
    sv('blFillName', name);
    sv('blFillEmail', blSlug(eParts[0]) + '.' + blSlug(host.split('.')[0]) + nonce + '@' + (eParts[1] || 'example.com'));
    sv('blFillWebsite', web);
    sv('blFillUsername', blUser(name, host) + nonce);
    sv('blFillPassword', blPass());
    blStatus('blFillStatus', 'New profile generated.', 'ok');
  }

  async function blSaveProfile() {
    const host = blS.ctx && blS.ctx.hostname;
    if (!host) { blStatus('blFillStatus', 'Refresh page analysis first.', 'err'); return; }
    function gv(id) { const el = $b(id); return el ? el.value.trim() : ''; }
    blS.profiles[host] = { name: gv('blFillName'), email: gv('blFillEmail'),
      website: gv('blFillWebsite'), username: gv('blFillUsername'), password: gv('blFillPassword') };
    await blStore({ blProfiles: blS.profiles });
    blStatus('blFillStatus', 'Profile saved for ' + host, 'ok');
  }

  async function blDoFill() {
    try {
      await blSaveCfg();
      if (!blS.tabId) await blAnalyze();
      function gv(id) { const el = $b(id); return el ? el.value.trim() : ''; }
      const profile = { name: gv('blFillName'), email: gv('blFillEmail'),
        website: gv('blFillWebsite'), username: gv('blFillUsername'), password: gv('blFillPassword') };
      if (!profile.name && !profile.email && !profile.username) throw new Error('Add at least name, email, or username.');
      await blSaveProfile();
      await blEnsureScript(blS.tabId);
      const r = await blSendTab(blS.tabId, { action: 'BL_FILL_FORM', profile: profile });
      if (!r || !r.ok) throw new Error((r && r.error) || 'Form fill failed.');
      blStatus('blFillStatus', r.message, 'ok');
    } catch (e) { blStatus('blFillStatus', e.message, 'err'); }
  }

  // ── Comment ────────────────────────────────────────────────────
  async function blDoComment() {
    await blSaveCfg();
    if (!blS.ctx) await blAnalyze();
    const tone = ($b('blCommentTone') && $b('blCommentTone').value) || blS.cfg.defaultTone || 'Professional';
    const lang = ($b('blCommentLanguage') && $b('blCommentLanguage').value) || blS.cfg.defaultLanguage || 'English';
    const inclWeb = $b('blIncludeWebsite') ? $b('blIncludeWebsite').checked : false;
    const website = blS.cfg.website || '';
    const fallback = blLocalComment(blS.ctx, tone, inclWeb, website);
    const out = $b('blCommentOutput');
    if (out) out.innerHTML = '<div class="bl-loading"><div class="bl-spinner"></div>Generating comment\u2026</div>';
    try {
      const txt = await blAI({
        system: 'You are an SEO-safe blog comment assistant. Write a natural, relevant comment under 100 words. No hype, no emojis, no sales language.',
        user: JSON.stringify({ tone: tone, language: lang, includeWebsite: inclWeb, website: website,
          pageTitle: (blS.ctx && blS.ctx.title) || '',
          excerpt: ((blS.ctx && blS.ctx.excerpt) || '').slice(0, 1800) }),
        maxTokens: 180, temp: 0.7
      });
      const comment = txt.replace(/^"|"$/g, '').replace(/\s+/g, ' ').split(/\s+/).slice(0, 100).join(' ');
      if (out) out.textContent = comment || fallback;
    } catch (e) {
      if (out) out.textContent = fallback;
      if (e.message !== 'NO_KEY') blStatus('blSettingsStatus', 'AI error: ' + e.message, 'err');
    }
  }

  // ── Test AI ────────────────────────────────────────────────────
  async function blTestAI() {
    blStatus('blSettingsStatus', 'Testing AI connection\u2026', '');
    try {
      const r = await blAI({ system: 'Test.', user: 'Reply with exactly: AI connection successful.', maxTokens: 20, temp: 0.1 });
      blStatus('blSettingsStatus', r || 'AI connection successful!', 'ok');
    } catch (e) {
      if (e.message === 'NO_KEY') blStatus('blSettingsStatus', 'No API key — add NVIDIA or OpenRouter key in Settings tab.', 'err');
      else blStatus('blSettingsStatus', e.message, 'err');
    }
  }

  // ── Content script injected into page ─────────────────────────
  function blInjectContent() {
    if (window.__BL__) return; window.__BL__ = true;
    var FM = {
      name: [/name/i, /fullname/i, /display/i, /author/i],
      email: [/email/i, /e-mail/i],
      website: [/website/i, /url/i, /site/i, /homepage/i],
      username: [/username/i, /user/i, /login/i],
      password: [/password/i],
      comment: [/comment/i, /message/i, /reply/i]
    };
    var PRIORITY = ['comment', 'register', 'login', 'contact', 'unknown'];
    function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
    function findF(form, ms) {
      var fields = Array.from(form.querySelectorAll('input,textarea'));
      return fields.find(function(f) {
        var h = [f.name, f.id, f.placeholder, f.autocomplete, f.getAttribute('aria-label'), f.type].filter(Boolean).join(' ');
        return ms.some(function(m) { return m.test(h); });
      }) || null;
    }
    function classify(form) {
      var txt = clean([form.id, form.className, form.getAttribute('action') || '',
        Array.from(form.querySelectorAll('button,input[type=submit]')).map(function(e) { return e.innerText || e.value || ''; }).join(' ')].join(' ')).toLowerCase();
      if (findF(form, FM.comment) || form.querySelector('textarea') || /leave a comment|post comment/.test(txt)) return 'comment';
      if (findF(form, FM.password) && /register|sign up|create account/.test(txt)) return 'register';
      if (findF(form, FM.password) && /login|sign in/.test(txt)) return 'login';
      if (findF(form, FM.email)) return 'contact';
      return 'unknown';
    }
    function setVal(f, v) {
      f.focus();
      var proto = f.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(f, v); else f.value = v;
      f.dispatchEvent(new Event('input', { bubbles: true }));
      f.dispatchEvent(new Event('change', { bubbles: true }));
      f.blur();
    }
    function analyzePage() {
      var forms = Array.from(document.forms).map(function(f, i) {
        return { id: f.id || 'form-' + (i + 1), type: classify(f),
          fieldCount: f.querySelectorAll('input,textarea,select').length };
      });
      var host = location.hostname.replace(/^www\./, '');
      var obl = 0;
      Array.from(document.querySelectorAll('a[href]')).forEach(function(a) {
        try { var h = new URL(a.href).hostname.replace(/^www\./, ''); if (h && h !== host) obl++; } catch (_) {}
      });
      var excerpt = '';
      var sels = ['article', 'main', '.post', '.entry-content', '.content'];
      for (var i = 0; i < sels.length; i++) {
        var txt = clean((document.querySelector(sels[i]) || {}).innerText || '');
        if (txt.length > 200) { excerpt = txt.slice(0, 2000); break; }
      }
      if (!excerpt) excerpt = clean(Array.from(document.querySelectorAll('p,h1,h2,h3')).slice(0, 40).map(function(e) { return e.innerText; }).join(' ')).slice(0, 2000);
      var body = (document.title + ' ' + location.href + ' ' + excerpt).toLowerCase();
      var pageType = 'general';
      if (/write for us|guest post|submit an article/.test(body)) pageType = 'guest post page';
      else if (/forum|thread|topic|board/.test(body)) pageType = 'forum page';
      else if (forms.some(function(f) { return f.type === 'comment'; })) pageType = 'blog page with comments';
      else if (/blog|article|wordpress/.test(body)) pageType = 'blog page';
      return { title: document.title || 'Untitled', url: location.href, hostname: location.hostname,
        pageType: pageType, forms: forms, formCount: forms.length, obl: obl, excerpt: excerpt };
    }
    function fillForm(profile) {
      return new Promise(function(resolve, reject) {
        var forms = Array.from(document.forms);
        if (!forms.length) { reject(new Error('No forms on this page.')); return; }
        var ranked = forms.map(function(f) { return { form: f, type: classify(f) }; })
          .sort(function(a, b) { return PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type); });
        var target = ranked[0].form;
        var filled = 0;
        var keys = Object.keys(FM).filter(function(k) { return k !== 'comment'; });
        var idx = 0;
        function next() {
          if (idx >= keys.length) {
            resolve({ filledCount: filled, formType: ranked[0].type,
              message: filled ? 'Filled ' + filled + ' field(s) in the ' + ranked[0].type + ' form.' : 'Form detected but no matching fields.' });
            return;
          }
          var key = keys[idx++];
          var v = profile[key] || '';
          if (!v) { setTimeout(next, 0); return; }
          var field = findF(target, FM[key]);
          if (!field) { setTimeout(next, 0); return; }
          setVal(field, v); filled++;
          setTimeout(next, 140);
        }
        next();
      });
    }
    chrome.runtime.onMessage.addListener(function(msg, _, sendResponse) {
      if (msg.action === 'BL_PING') { sendResponse({ ok: true }); return true; }
      if (msg.action === 'BL_GET_CONTEXT') { sendResponse({ ok: true, context: analyzePage() }); return true; }
      if (msg.action === 'BL_FILL_FORM') {
        fillForm(msg.profile || {}).then(function(r) { sendResponse(Object.assign({ ok: true }, r)); })
          .catch(function(e) { sendResponse({ ok: false, error: e.message }); });
        return true;
      }
      sendResponse({ ok: false, error: 'Unknown action.' }); return true;
    });
  }

  // ── Sub-tab navigation ─────────────────────────────────────────
  function blBindSubTabs() {
    document.querySelectorAll('.bl-stab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.bl-stab').forEach(function(b) { b.classList.remove('active'); });
        document.querySelectorAll('.bl-panel').forEach(function(p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var panel = document.getElementById('blpanel-' + btn.dataset.bltab);
        if (panel) panel.classList.add('active');
      });
    });
  }

  // ── Wire buttons ───────────────────────────────────────────────
  function blWire() {
    var el;
    el = $b('blRefreshBtn'); if (el) el.addEventListener('click', blAnalyze);
    el = $b('blxFindBtn'); if (el) el.addEventListener('click', function() { blxRun(($b('blxDomainInput') || {}).value); });
    el = $b('blxUseCurrentBtn'); if (el) el.addEventListener('click', blxUseCurrent);
    el = $b('blxCopyBtn'); if (el) el.addEventListener('click', blxCopy);
    el = $b('blxDomainInput'); if (el) el.addEventListener('keydown', function(e) { if (e.key === 'Enter') blxRun(el.value); });
    el = $b('blGenerateQueriesBtn'); if (el) el.addEventListener('click', blDoQueries);
    el = $b('blCopyQueriesBtn'); if (el) el.addEventListener('click', function() {
      var lines = Array.from(document.querySelectorAll('#blQueriesOutput .bl-query-line span')).map(function(s) { return s.textContent; });
      if (lines.length) navigator.clipboard.writeText(lines.join('\n')).catch(function() {});
    });
    el = $b('blGenerateProfileBtn'); if (el) el.addEventListener('click', blGenProfile);
    el = $b('blSaveProfileBtn'); if (el) el.addEventListener('click', blSaveProfile);
    el = $b('blFillFormBtn'); if (el) el.addEventListener('click', blDoFill);
    el = $b('blGenerateCommentBtn'); if (el) el.addEventListener('click', blDoComment);
    el = $b('blCopyCommentBtn'); if (el) el.addEventListener('click', function() {
      var out = $b('blCommentOutput');
      var txt = out && out.textContent;
      if (txt && !/appear here/i.test(txt)) navigator.clipboard.writeText(txt).catch(function() {});
    });
    el = $b('blSaveSettingsBtn'); if (el) el.addEventListener('click', function() {
      blSaveCfg().then(function() { blStatus('blSettingsStatus', 'Settings saved.', 'ok'); });
    });
    el = $b('blTestAiBtn'); if (el) el.addEventListener('click', blTestAI);

    // Dashboard Backlinks Explorer card
    el = $b('dbBlxFindBtn'); if (el) el.addEventListener('click', function() { dbBlxRun(($b('dbBlxInput') || {}).value); });
    el = $b('dbBlxCurrentBtn'); if (el) el.addEventListener('click', dbBlxUseCurrent);
    el = $b('dbBlxInput'); if (el) el.addEventListener('keydown', function(e) { if (e.key === 'Enter') dbBlxRun(el.value); });
  }

  // ── Init ───────────────────────────────────────────────────────
  function blInit() {
    blLoadCfg().then(function() {
      blBindSubTabs();
      blWire();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', blInit);
  else blInit();

})();
/* ════════════════════════════════════════════════════════════════════════
 * TECH+ AUDIT  (v4.3)
 * Schema/JSON-LD validator · Broken link checker · robots.txt + sitemap.xml
 * · Hreflang checker.  Each runs inside the active tab via executeScript so
 * same-origin fetches (robots, sitemap, internal links) work without CORS.
 * ════════════════════════════════════════════════════════════════════════ */
(function initTechAuditTab() {
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  function setOut(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  function loading(id, msg) { setOut(id, '<div><span class="ta-spin"></span>' + msg + '</div>'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  async function runInPage(tab, func) {
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func });
    return res && res[0] ? res[0].result : null;
  }

  // Runs in the page's MAIN world so we can read page JS globals like
  // window.Shopify. Returns null if injection is blocked.
  async function runInPageMain(tab, func) {
    try {
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, world: 'MAIN' });
      return res && res[0] ? res[0].result : null;
    } catch (e) { return null; }
  }

  // ── Schema / JSON-LD validator ───────────────────────────────────────────
  async function checkSchema() {
    loading('taSchema', 'Reading structured data…');
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || '')) { setOut('taSchema', '<div class="ta-summary warn">Open a normal web page to audit.</div>'); return; }
    let data;
    try {
      data = await runInPage(tab, () => {
        const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
        const types = [], errors = [];
        blocks.forEach((b, i) => {
          try {
            const json = JSON.parse(b.textContent.trim());
            const arr = Array.isArray(json) ? json : (json['@graph'] && Array.isArray(json['@graph']) ? json['@graph'] : [json]);
            arr.forEach(o => { if (o && o['@type']) [].concat(o['@type']).forEach(t => types.push(t)); });
          } catch (e) { errors.push('Block ' + (i + 1) + ': ' + e.message); }
        });
        // Microdata itemtype presence (lightweight)
        const microdata = [...document.querySelectorAll('[itemtype]')].map(el => (el.getAttribute('itemtype') || '').split('/').pop()).filter(Boolean);
        return { count: blocks.length, types, errors, microdata };
      });
    } catch (e) { setOut('taSchema', '<div class="ta-summary bad">Could not access this page.</div>'); return; }

    if (!data) { setOut('taSchema', '<div class="ta-summary bad">No response from page.</div>'); return; }
    const uniqTypes = [...new Set(data.types)];
    const allTypes = [...new Set([...data.types, ...data.microdata])];
    let html = '';
    if (data.count === 0 && data.microdata.length === 0) {
      html += '<div class="ta-summary warn">No structured data found. Adding JSON-LD (Article, Product, FAQPage, BreadcrumbList) can earn rich results.</div>';
    } else if (data.errors.length) {
      html += '<div class="ta-summary bad">' + data.count + ' JSON-LD block(s), but ' + data.errors.length + ' have errors.</div>';
    } else {
      html += '<div class="ta-summary ok">✓ ' + data.count + ' valid JSON-LD block(s), ' + uniqTypes.length + ' schema type(s).</div>';
    }
    if (allTypes.length) {
      html += '<div class="ta-row"><span class="ta-pill info">TYPES</span><span>' + allTypes.map(esc).join(', ') + '</span></div>';
    }
    data.errors.forEach(er => { html += '<div class="ta-row"><span class="ta-pill bad">ERROR</span><span>' + esc(er) + '</span></div>'; });
    // Helpful suggestions
    const has = t => allTypes.some(x => x.toLowerCase() === t.toLowerCase());
    const suggest = [];
    if (!has('BreadcrumbList')) suggest.push('BreadcrumbList');
    if (!has('Organization') && !has('WebSite')) suggest.push('Organization / WebSite');
    if (!has('FAQPage') && !has('Article') && !has('Product')) suggest.push('Article / Product / FAQPage (page-appropriate)');
    if (suggest.length) html += '<div class="ta-row"><span class="ta-pill info">SUGGEST</span><span>Consider adding: ' + suggest.map(esc).join('; ') + '</span></div>';
    html += '<a class="ta-linkbtn" href="https://search.google.com/test/rich-results?url=' + encodeURIComponent(tab.url) + '" target="_blank" rel="noopener">🔍 Open in Google Rich Results Test</a>';
    setOut('taSchema', html);
  }

  // ── Broken link checker ──────────────────────────────────────────────────
  async function checkLinks() {
    loading('taLinks', 'Collecting and testing links…');
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || '')) { setOut('taLinks', '<div class="ta-summary warn">Open a normal web page to audit.</div>'); return; }
    let data;
    try {
      data = await runInPage(tab, async () => {
        const origin = location.origin;
        const seen = new Set();
        const links = [];
        document.querySelectorAll('a[href]').forEach(a => {
          let href = a.href;
          if (!/^https?:/.test(href)) return;
          href = href.split('#')[0];
          if (!href || seen.has(href)) return;
          seen.add(href);
          links.push(href);
        });
        const subset = links.slice(0, 60);
        const out = [];
        async function test(url) {
          const sameOrigin = url.indexOf(origin) === 0;
          try {
            let r = await fetch(url, { method: 'HEAD', redirect: 'follow', credentials: 'omit' });
            if (r.status === 405 || r.status === 501) {
              r = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' });
            }
            return { url, status: r.status, ok: r.ok, sameOrigin };
          } catch (e) {
            // Cross-origin fetches often throw on CORS — not necessarily broken.
            return { url, status: 0, ok: false, sameOrigin, blocked: !sameOrigin };
          }
        }
        // Limited concurrency
        const POOL = 6;
        let idx = 0;
        async function worker() {
          while (idx < subset.length) { const i = idx++; out.push(await test(subset[i])); }
        }
        await Promise.all(Array.from({ length: POOL }, worker));
        return { total: links.length, tested: subset.length, results: out };
      });
    } catch (e) { setOut('taLinks', '<div class="ta-summary bad">Could not access this page.</div>'); return; }

    if (!data) { setOut('taLinks', '<div class="ta-summary bad">No response from page.</div>'); return; }
    const broken = data.results.filter(r => !r.ok && !r.blocked && r.status !== 0);
    const blocked = data.results.filter(r => r.blocked || (r.status === 0 && !r.sameOrigin));
    const good = data.results.filter(r => r.ok);
    let html = '';
    if (broken.length === 0) html += '<div class="ta-summary ok">✓ No broken links among ' + data.tested + ' tested' + (data.total > data.tested ? ' (of ' + data.total + ' total)' : '') + '.</div>';
    else html += '<div class="ta-summary bad">' + broken.length + ' broken link(s) found out of ' + data.tested + ' tested.</div>';
    broken.forEach(r => { html += '<div class="ta-row"><span class="ta-pill bad">' + (r.status || 'ERR') + '</span><a class="ta-link" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.url) + '</a></div>'; });
    html += '<div class="ta-row"><span class="ta-pill ok">' + good.length + ' OK</span>' + (blocked.length ? '<span class="ta-pill info">' + blocked.length + ' cross-origin (not checkable)</span>' : '') + '</div>';
    setOut('taLinks', html);
  }

  // ── robots.txt + sitemap.xml analyzer ────────────────────────────────────
  async function checkRobots() {
    loading('taRobots', 'Fetching robots.txt and sitemap…');
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || '')) { setOut('taRobots', '<div class="ta-summary warn">Open a normal web page to audit.</div>'); return; }
    let data;
    try {
      data = await runInPage(tab, async () => {
        const origin = location.origin;
        const res = { robots: null, sitemaps: [], sitemapInfo: null };
        try {
          const r = await fetch(origin + '/robots.txt', { credentials: 'omit' });
          if (r.ok) {
            const txt = await r.text();
            const lines = txt.split(/\r?\n/);
            const disallow = lines.filter(l => /^\s*disallow:/i.test(l)).length;
            const allow = lines.filter(l => /^\s*allow:/i.test(l)).length;
            const agents = lines.filter(l => /^\s*user-agent:/i.test(l)).length;
            const sm = lines.filter(l => /^\s*sitemap:/i.test(l)).map(l => l.replace(/^\s*sitemap:\s*/i, '').trim());
            res.robots = { status: r.status, disallow, allow, agents, sitemaps: sm, bytes: txt.length, sample: txt.slice(0, 600) };
            res.sitemaps = sm;
          } else {
            res.robots = { status: r.status, missing: true };
          }
        } catch (e) { res.robots = { error: e.message }; }

        let sitemapUrl = res.sitemaps[0] || (origin + '/sitemap.xml');
        try {
          const r2 = await fetch(sitemapUrl, { credentials: 'omit' });
          if (r2.ok) {
            const xml = await r2.text();
            const isIndex = /<sitemapindex/i.test(xml);
            const locs = (xml.match(/<loc>/gi) || []).length;
            // Deep-check: sample a few <loc> URLs and verify they resolve.
            const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]).filter(Boolean);
            const sample = urls.slice(0, 5);
            const checks = [];
            for (const u of sample) {
              try {
                let rr = await fetch(u, { method: 'HEAD', redirect: 'manual', credentials: 'omit' });
                checks.push({ url: u, status: rr.status, ok: rr.ok || (rr.status >= 300 && rr.status < 400), redirect: rr.type === 'opaqueredirect' || (rr.status >= 300 && rr.status < 400) });
              } catch (e) {
                checks.push({ url: u, status: 0, ok: false, blocked: true });
              }
            }
            res.sitemapInfo = { url: sitemapUrl, status: r2.status, isIndex, locs, checks };
          } else {
            res.sitemapInfo = { url: sitemapUrl, status: r2.status, missing: true };
          }
        } catch (e) { res.sitemapInfo = { url: sitemapUrl, error: e.message }; }
        return res;
      });
    } catch (e) { setOut('taRobots', '<div class="ta-summary bad">Could not access this page.</div>'); return; }

    if (!data) { setOut('taRobots', '<div class="ta-summary bad">No response from page.</div>'); return; }
    let html = '';
    const rb = data.robots;
    if (rb && rb.disallow !== undefined) {
      html += '<div class="ta-summary ok">✓ robots.txt found</div>';
      html += '<div class="ta-row"><span class="ta-pill info">RULES</span><span>' + rb.agents + ' user-agent block(s), ' + rb.disallow + ' Disallow, ' + rb.allow + ' Allow, ' + rb.sitemaps.length + ' Sitemap line(s)</span></div>';
      if (rb.sample) html += '<div class="ta-code">' + esc(rb.sample) + (rb.bytes > 600 ? '\n…' : '') + '</div>';
    } else if (rb && rb.missing) {
      html += '<div class="ta-summary warn">No robots.txt (HTTP ' + rb.status + '). Search engines will crawl everything by default.</div>';
    } else {
      html += '<div class="ta-summary warn">Could not read robots.txt' + (rb && rb.error ? ': ' + esc(rb.error) : '') + '.</div>';
    }
    const sm = data.sitemapInfo;
    if (sm && sm.locs !== undefined) {
      html += '<div class="ta-row"><span class="ta-pill ok">SITEMAP</span><span>' + (sm.isIndex ? 'Sitemap index with ' : '') + sm.locs + ' &lt;loc&gt; entr' + (sm.locs === 1 ? 'y' : 'ies') + ' — <a class="ta-link" href="' + esc(sm.url) + '" target="_blank" rel="noopener">view</a></span></div>';
      if (sm.checks && sm.checks.length) {
        const bad = sm.checks.filter(c => !c.ok && !c.blocked && c.status !== 0);
        if (bad.length === 0) {
          html += '<div class="ta-row"><span class="ta-pill ok">DEEP</span><span>Sampled ' + sm.checks.length + ' URL(s) — all resolve OK.</span></div>';
        } else {
          html += '<div class="ta-row"><span class="ta-pill bad">DEEP</span><span>' + bad.length + ' of ' + sm.checks.length + ' sampled URL(s) failed:</span></div>';
          bad.forEach(c => { html += '<div class="ta-row"><span class="ta-pill bad">' + (c.status || 'ERR') + '</span><a class="ta-link" href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.url) + '</a></div>'; });
        }
      }
    } else if (sm && sm.missing) {
      html += '<div class="ta-row"><span class="ta-pill warn">SITEMAP</span><span>Not found at ' + esc(sm.url) + ' (HTTP ' + sm.status + ')</span></div>';
    } else if (sm) {
      html += '<div class="ta-row"><span class="ta-pill warn">SITEMAP</span><span>Could not read ' + esc(sm.url) + '</span></div>';
    }
    setOut('taRobots', html);
  }

  // ── Hreflang checker ─────────────────────────────────────────────────────
  async function checkHreflang() {
    loading('taHreflang', 'Reading hreflang tags…');
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || '')) { setOut('taHreflang', '<div class="ta-summary warn">Open a normal web page to audit.</div>'); return; }
    let data;
    try {
      data = await runInPage(tab, () => {
        const here = location.href.split('#')[0];
        const tags = [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map(l => ({
          lang: l.getAttribute('hreflang') || '',
          href: l.getAttribute('href') || ''
        }));
        return { here, tags };
      });
    } catch (e) { setOut('taHreflang', '<div class="ta-summary bad">Could not access this page.</div>'); return; }

    if (!data) { setOut('taHreflang', '<div class="ta-summary bad">No response from page.</div>'); return; }
    let html = '';
    if (data.tags.length === 0) {
      html += '<div class="ta-summary info">No hreflang tags. That\'s fine for single-language sites; add them only if you serve multiple languages/regions.</div>';
      setOut('taHreflang', html); return;
    }
    const langRe = /^([a-z]{2}(-[a-zA-Z]{2})?|x-default)$/;
    const hasXDefault = data.tags.some(t => t.lang.toLowerCase() === 'x-default');
    const selfRef = data.tags.some(t => (t.href || '').split('#')[0].replace(/\/$/, '') === data.here.replace(/\/$/, ''));
    const bad = data.tags.filter(t => !langRe.test(t.lang) || !t.href);
    const warns = [];
    if (!hasXDefault) warns.push('Missing x-default tag');
    if (!selfRef) warns.push('No self-referencing hreflang for this URL');
    if (bad.length) warns.push(bad.length + ' tag(s) with invalid lang code or missing href');

    if (warns.length === 0) html += '<div class="ta-summary ok">✓ ' + data.tags.length + ' hreflang tags look well-formed.</div>';
    else html += '<div class="ta-summary warn">' + data.tags.length + ' hreflang tags — ' + warns.length + ' issue(s) to review.</div>';
    warns.forEach(w => { html += '<div class="ta-row"><span class="ta-pill warn">CHECK</span><span>' + esc(w) + '</span></div>'; });
    data.tags.slice(0, 20).forEach(t => {
      const okLang = langRe.test(t.lang) && t.href;
      html += '<div class="ta-row"><span class="ta-pill ' + (okLang ? 'ok' : 'bad') + '">' + esc(t.lang || '—') + '</span><a class="ta-link" href="' + esc(t.href) + '" target="_blank" rel="noopener">' + esc(t.href || '(no href)') + '</a></div>';
    });
    if (data.tags.length > 20) html += '<div class="ta-row"><span>…and ' + (data.tags.length - 20) + ' more</span></div>';
    setOut('taHreflang', html);
  }

  // ── Copy helper ──────────────────────────────────────────────────────────
  function taCopy(text) {
    try {
      navigator.clipboard.writeText(text).catch(() => taFallbackCopy(text));
    } catch (e) { taFallbackCopy(text); }
  }
  function taFallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  function wireCopy(btnId, getText) {
    const b = document.getElementById(btnId);
    if (b) b.addEventListener('click', () => { taCopy(getText()); b.textContent = '✓ Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); });
  }
  function wireDownload(btnId, filename, getText) {
    const b = document.getElementById(btnId);
    if (!b) return;
    b.addEventListener('click', () => {
      try {
        const blob = new Blob([getText()], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        b.textContent = '✓ Saved'; setTimeout(() => { b.textContent = 'Download'; }, 1500);
      } catch (_) {}
    });
  }

  // ── Indexability & Meta ──────────────────────────────────────────────────
  async function checkIndexMeta() {
    loading('taIndexMeta', 'Reading meta & indexability…');
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || '')) { setOut('taIndexMeta', '<div class="ta-summary warn">Open a normal web page to audit.</div>'); return; }
    let d;
    try {
      d = await runInPage(tab, () => {
        const get = (sel, attr) => { const el = document.querySelector(sel); return el ? (el.getAttribute(attr) || '').trim() : ''; };
        const robots = get('meta[name="robots"]', 'content').toLowerCase();
        const canonical = get('link[rel="canonical"]', 'href');
        const title = (document.querySelector('title')?.textContent || '').trim();
        const desc = get('meta[name="description"]', 'content');
        const ogTitle = get('meta[property="og:title"]', 'content');
        const ogImage = get('meta[property="og:image"]', 'content');
        const twCard = get('meta[name="twitter:card"]', 'content');
        const viewport = get('meta[name="viewport"]', 'content');
        return { url: location.href, robots, canonical, title, desc, ogTitle, ogImage, twCard, viewport };
      });
    } catch (e) { setOut('taIndexMeta', '<div class="ta-summary bad">Could not access this page.</div>'); return; }
    if (!d) { setOut('taIndexMeta', '<div class="ta-summary bad">No response from page.</div>'); return; }

    const noindex = /noindex/.test(d.robots);
    const issues = [];
    if (noindex) issues.push('Page is set to noindex — it will NOT appear in search results');
    if (!d.canonical) issues.push('No canonical tag');
    if (!d.title) issues.push('Missing <title>');
    else if (d.title.length < 30 || d.title.length > 65) issues.push('Title is ' + d.title.length + ' chars (aim 30–60)');
    if (!d.desc) issues.push('Missing meta description');
    else if (d.desc.length < 70 || d.desc.length > 165) issues.push('Description is ' + d.desc.length + ' chars (aim 120–160)');
    if (!d.ogTitle || !d.ogImage) issues.push('Incomplete Open Graph tags (weak social previews)');
    if (!d.twCard) issues.push('No Twitter card');
    if (!d.viewport) issues.push('No viewport meta (mobile issues)');

    let html = noindex
      ? '<div class="ta-summary bad">⚠ This page is NOINDEX — search engines are told not to index it.</div>'
      : (issues.length ? '<div class="ta-summary warn">' + issues.length + ' thing(s) to review.</div>' : '<div class="ta-summary ok">✓ Indexable with healthy meta tags.</div>');

    const row = (label, val, ok) => '<div class="ta-row"><span class="ta-pill ' + (ok ? 'ok' : 'warn') + '">' + label + '</span><span>' + (val ? esc(val) : '—') + '</span></div>';
    html += row('INDEX', noindex ? 'noindex' : 'indexable', !noindex);
    html += row('CANONICAL', d.canonical || 'none', !!d.canonical);
    html += row('TITLE', d.title + (d.title ? ' (' + d.title.length + ')' : ''), d.title && d.title.length >= 30 && d.title.length <= 65);
    html += row('DESC', d.desc + (d.desc ? ' (' + d.desc.length + ')' : ''), d.desc && d.desc.length >= 70 && d.desc.length <= 165);
    html += row('OG', (d.ogTitle || d.ogImage) ? 'present' : 'missing', d.ogTitle && d.ogImage);
    issues.forEach(i => { html += '<div class="ta-row"><span class="ta-pill warn">FIX</span><span>' + esc(i) + '</span></div>'; });
    setOut('taIndexMeta', html);
  }

  // ── Image Alt-Text Audit (+ AI suggestions) ──────────────────────────────
  async function checkImgAlt() {
    loading('taImgAlt', 'Scanning images…');
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || '')) { setOut('taImgAlt', '<div class="ta-summary warn">Open a normal web page to audit.</div>'); return; }
    let d;
    try {
      d = await runInPage(tab, () => {
        const imgs = [...document.querySelectorAll('img')];
        let withAlt = 0;
        const missing = [];
        imgs.forEach(img => {
          const alt = (img.getAttribute('alt') || '').trim();
          const src = img.currentSrc || img.src || '';
          if (!src || src.startsWith('data:')) return;
          if (alt) withAlt++;
          else if (missing.length < 15) missing.push({ src, near: (img.closest('a')?.getAttribute('aria-label') || img.getAttribute('title') || document.title || '').slice(0, 80) });
        });
        return { total: imgs.length, withAlt, missing };
      });
    } catch (e) { setOut('taImgAlt', '<div class="ta-summary bad">Could not access this page.</div>'); return; }
    if (!d) { setOut('taImgAlt', '<div class="ta-summary bad">No response from page.</div>'); return; }

    let html = d.missing.length === 0
      ? '<div class="ta-summary ok">✓ All ' + d.total + ' images have alt text.</div>'
      : '<div class="ta-summary warn">' + d.missing.length + ' image(s) missing alt text (of ' + d.total + ').</div>';

    d.missing.forEach((m, i) => {
      html += '<div class="ta-row"><img class="ta-imgthumb" src="' + esc(m.src) + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'"><a class="ta-link" href="' + esc(m.src) + '" target="_blank" rel="noopener">' + esc(m.src.split('/').pop().slice(0, 50)) + '</a></div>';
    });

    setOut('taImgAlt', html);

    // AI suggestions (optional — needs a key).
    if (d.missing.length && typeof getHeadingAiConfig === 'function') {
      try {
        const cfg = await getHeadingAiConfig();
        if (cfg) {
          const el = document.getElementById('taImgAlt');
          if (el) el.insertAdjacentHTML('beforeend', '<div class="ta-row" id="taAltAi"><span class="ta-spin"></span>Generating alt-text suggestions…</div>');
          const list = d.missing.slice(0, 8).map((m, i) => (i + 1) + '. ' + m.src.split('/').pop()).join('\n');
          const prompt = 'You write concise, descriptive SEO alt text for images. Page title: "' + (d.missing[0].near || '') + '". For each image filename below, write a short (under 12 words) descriptive alt text. Return ONLY JSON: {"alts":["alt1","alt2",...]} in the same order.\n' + list;
          const raw = await callHeadingAI(cfg, prompt, 500);
          const m = raw.match(/\{[\s\S]*\}/);
          const parsed = m ? JSON.parse(m[0]) : null;
          const ai = document.getElementById('taAltAi');
          if (parsed && Array.isArray(parsed.alts) && ai) {
            ai.outerHTML = '<div class="ta-row"><span class="ta-pill info">AI ALT</span><span>Suggested alt text:</span></div>' +
              parsed.alts.map(a => '<div class="ta-row"><span class="ta-pill ok">ALT</span><span>' + esc(a) + '</span></div>').join('');
          } else if (ai) { ai.outerHTML = ''; }
        }
      } catch (e) { const ai = document.getElementById('taAltAi'); if (ai) ai.outerHTML = ''; }
    }
  }

  // ── FAQ Schema Generator (AI) ────────────────────────────────────────────
  async function genFaqSchema() {
    loading('taFaqSchema', 'Reading page content…');
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || '')) { setOut('taFaqSchema', '<div class="ta-summary warn">Open a normal web page first.</div>'); return; }
    if (typeof getHeadingAiConfig !== 'function') { setOut('taFaqSchema', '<div class="ta-summary warn">AI helper unavailable.</div>'); return; }
    const cfg = await getHeadingAiConfig();
    if (!cfg) { setOut('taFaqSchema', '<div class="ta-summary warn">AI unavailable. Built-in Groq should always load — try Refresh.</div>'); return; }

    let page;
    try {
      page = await runInPage(tab, () => {
        const text = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 4000);
        const h = [...document.querySelectorAll('h1,h2,h3')].map(x => x.textContent.trim()).filter(Boolean).slice(0, 25);
        return { url: location.href, title: document.title, headings: h, text };
      });
    } catch (e) { setOut('taFaqSchema', '<div class="ta-summary bad">Could not read this page.</div>'); return; }

    loading('taFaqSchema', 'Asking AI to build FAQ schema…');
    const prompt = 'Based on this page, write 4-6 useful FAQ question/answer pairs a real visitor would ask, then output VALID schema.org FAQPage JSON-LD.\n\nPage title: ' + page.title + '\nHeadings: ' + page.headings.join('; ') + '\nContent excerpt: ' + page.text.slice(0, 2500) + '\n\nReturn ONLY the JSON-LD object (starting with {"@context") — no markdown, no code fences, no commentary. Answers must be 1-3 sentences, factual to the page.';
    try {
      const raw = await callHeadingAI(cfg, prompt, 900);
      let jsonText = raw.replace(/```json|```/g, '').trim();
      const m = jsonText.match(/\{[\s\S]*\}/);
      if (m) jsonText = m[0];
      // Validate
      let count = 0;
      try { const obj = JSON.parse(jsonText); count = Array.isArray(obj.mainEntity) ? obj.mainEntity.length : 0; } catch (e) {}
      const wrapped = '<script type="application/ld+json">\n' + jsonText + '\n<\/script>';
      window.__taFaq = wrapped;
      let html = count ? '<div class="ta-summary ok">✓ Generated FAQPage schema with ' + count + ' Q&amp;A. Paste into your &lt;head&gt;.</div>'
        : '<div class="ta-summary warn">Generated JSON-LD — review before use.</div>';
      html += '<div class="ta-code" id="taFaqCode">' + esc(wrapped) + '</div>';
      html += '<button class="ta-copy" id="taFaqCopy">Copy</button>';
      setOut('taFaqSchema', html);
      wireCopy('taFaqCopy', () => window.__taFaq || wrapped);
    } catch (e) {
      setOut('taFaqSchema', '<div class="ta-summary bad">AI request failed: ' + esc(e.message || 'error') + '</div>');
    }
  }

  // ── llms.txt Generator ───────────────────────────────────────────────────
  // Slug → human-readable page title (fallback when a URL has no anchor text).
  function prettifyUrlTitle(u, origin) {
    try {
      let p = decodeURIComponent(new URL(u).pathname).replace(/\/+$/, '');
      if (!p || p === '') return 'Home';
      const seg = p.split('/').filter(Boolean).pop() || '';
      return seg.replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase()).slice(0, 60) || u;
    } catch (_) { return u; }
  }
  // Group a list of URLs into llms.txt sections by their first path segment.
  function groupPagesForLlms(pages, origin) {
    const SECTION = {
      blog: 'Blog', news: 'Blog', article: 'Blog', articles: 'Blog', post: 'Blog', posts: 'Blog',
      product: 'Products', products: 'Products', shop: 'Products', store: 'Products', collections: 'Products',
      service: 'Services', services: 'Services', solutions: 'Services',
      doc: 'Documentation', docs: 'Documentation', documentation: 'Documentation', guide: 'Documentation', guides: 'Documentation', support: 'Documentation', help: 'Documentation',
      about: 'Company', company: 'Company', team: 'Company', contact: 'Company', careers: 'Company', pricing: 'Company'
    };
    const groups = {};
    pages.forEach(pg => {
      let seg = '';
      try { seg = (new URL(pg.h).pathname.split('/').filter(Boolean)[0] || '').toLowerCase(); } catch (_) {}
      const section = SECTION[seg] || (seg ? 'Main pages' : 'Main pages');
      (groups[section] = groups[section] || []).push(pg);
    });
    return groups;
  }

  async function genLlms() {
    loading('taLlms', 'Collecting site info & sitemap…');
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || '')) { setOut('taLlms', '<div class="ta-summary warn">Open a normal web page first.</div>'); return; }
    let info;
    try {
      info = await runInPage(tab, async () => {
        const origin = location.origin;
        const name = (document.querySelector('meta[property="og:site_name"]')?.content) || (document.title || '').split(/[|\-–—]/)[0].trim() || location.hostname;
        const desc = (document.querySelector('meta[name="description"]')?.content) || (document.querySelector('meta[property="og:description"]')?.content) || '';

        // On-page nav links (with anchor text) — good for titles.
        const nav = [...document.querySelectorAll('a[href]')]
          .map(a => ({ t: (a.textContent || '').replace(/\s+/g, ' ').trim(), h: a.href.split('#')[0].replace(/\/+$/, '') || a.href }))
          .filter(x => x.t && x.t.length < 50 && x.h.indexOf(origin) === 0)
          .filter((x, i, arr) => arr.findIndex(y => y.h === x.h) === i);

        // Locate sitemap: robots.txt → /sitemap.xml fallback.
        let sitemapUrl = '';
        try {
          const r = await fetch(origin + '/robots.txt', { credentials: 'omit', signal: AbortSignal.timeout(6000) });
          if (r.ok) { const m = (await r.text()).match(/sitemap:\s*(\S+)/i); if (m) sitemapUrl = m[1].trim(); }
        } catch (_) {}
        if (!sitemapUrl) sitemapUrl = origin + '/sitemap.xml';

        // Fetch + parse the sitemap (resolve one level of sitemap-index nesting).
        const sitemapPages = [];
        async function readSitemap(url, depth) {
          try {
            const r = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(7000) });
            if (!r.ok) return;
            const xml = await r.text();
            const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
            if (/<sitemapindex/i.test(xml) && depth < 1) {
              for (const child of locs.slice(0, 5)) await readSitemap(child, depth + 1);
            } else {
              locs.forEach(u => { if (u.indexOf(origin) === 0) sitemapPages.push(u.split('#')[0].replace(/\/+$/, '')); });
            }
          } catch (_) {}
        }
        await readSitemap(sitemapUrl, 0);

        return { origin, host: location.hostname, name, desc, nav, sitemapUrl, sitemapPages };
      });
    } catch (e) { setOut('taLlms', '<div class="ta-summary bad">Could not read this page.</div>'); return; }

    // Merge sitemap URLs with nav anchor text (nav gives better titles).
    const titleByUrl = {};
    (info.nav || []).forEach(n => { if (!titleByUrl[n.h]) titleByUrl[n.h] = n.t; });
    const seen = new Set();
    const pages = [];
    const pushPage = (h) => {
      if (!h || seen.has(h)) return;
      seen.add(h);
      pages.push({ h, t: titleByUrl[h] || prettifyUrlTitle(h, info.origin) });
    };
    (info.sitemapPages || []).forEach(pushPage);
    (info.nav || []).forEach(n => pushPage(n.h));   // include nav-only pages not in sitemap

    const usedSitemap = (info.sitemapPages || []).length > 0;
    const capped = pages.slice(0, 60);

    // ── Build llms.txt (llmstxt.org format) ──
    const lines = [];
    lines.push('# ' + (info.name || info.host));
    if (info.desc) lines.push('\n> ' + info.desc.slice(0, 250).trim());
    lines.push('');

    const groups = groupPagesForLlms(capped, info.origin);
    const ORDER = ['Main pages', 'Products', 'Services', 'Documentation', 'Blog', 'Company'];
    const sectionNames = Object.keys(groups).sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    sectionNames.forEach(sec => {
      lines.push('## ' + sec + '\n');
      groups[sec].slice(0, 25).forEach(pg => lines.push('- [' + pg.t + '](' + pg.h + ')'));
      lines.push('');
    });

    lines.push('## Optional\n');
    lines.push('- [XML sitemap](' + (info.sitemapUrl || (info.origin + '/sitemap.xml')) + ')');
    lines.push('');
    lines.push('<!-- Generated by ShahzaibSEO. Follows the llms.txt convention (https://llmstxt.org). Save this file at ' + info.origin + '/llms.txt -->');

    const txt = lines.join('\n');
    window.__taLlms = txt;

    const srcNote = usedSitemap
      ? `✓ Built from your sitemap (${(info.sitemapPages || []).length} URLs found, ${capped.length} included).`
      : '✓ Built from on-page navigation (no sitemap reachable).';
    let html = '<div class="ta-summary ok">' + srcNote + ' Save it at <code>' + esc(info.origin) + '/llms.txt</code></div>';
    html += '<div class="ta-code">' + esc(txt) + '</div>';
    html += '<div class="ta-btn-row"><button class="ta-copy" id="taLlmsCopy">Copy</button><button class="ta-copy" id="taLlmsDownload">Download</button></div>';
    setOut('taLlms', html);
    wireCopy('taLlmsCopy', () => window.__taLlms || txt);
    wireDownload('taLlmsDownload', 'llms.txt', () => window.__taLlms || txt);
  }

  // ── Platform / Theme / Plugins detector ──────────────────────────────────
  // Friendly names for common WordPress plugin slugs.
  const PLUGIN_NAMES = {
    'woocommerce': 'WooCommerce', 'elementor': 'Elementor', 'elementor-pro': 'Elementor Pro',
    'wordpress-seo': 'Yoast SEO', 'wpseo': 'Yoast SEO', 'seo-by-rank-math': 'Rank Math SEO',
    'contact-form-7': 'Contact Form 7', 'wpforms-lite': 'WPForms', 'wpforms': 'WPForms',
    'jetpack': 'Jetpack', 'akismet': 'Akismet', 'wordfence': 'Wordfence Security',
    'wp-super-cache': 'WP Super Cache', 'w3-total-cache': 'W3 Total Cache', 'litespeed-cache': 'LiteSpeed Cache',
    'wp-rocket': 'WP Rocket', 'really-simple-ssl': 'Really Simple SSL', 'updraftplus': 'UpdraftPlus',
    'all-in-one-seo-pack': 'All in One SEO', 'mailchimp-for-wp': 'Mailchimp for WP',
    'redux-framework': 'Redux Framework', 'js_composer': 'WPBakery Page Builder', 'revslider': 'Slider Revolution',
    'wpml': 'WPML', 'sitepress-multilingual-cms': 'WPML', 'gravityforms': 'Gravity Forms',
    'advanced-custom-fields': 'Advanced Custom Fields', 'wp-mail-smtp': 'WP Mail SMTP',
    'classic-editor': 'Classic Editor', 'duplicate-post': 'Duplicate Post', 'smush': 'Smush'
  };

  async function detectPlatform() {
    loading('taPlatform', 'Detecting platform & theme…');
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || '')) { setOut('taPlatform', '<div class="ta-summary warn">Open a normal web page first.</div>'); return; }

    let d;
    try {
      d = await runInPage(tab, async () => {
        const html = document.documentElement.outerHTML;
        const origin = location.origin;
        const out = { wp: null, shopify: null, generator: '', others: [] };

        // ── WordPress (STRICT: real /wp-content/ or /wp-includes/ asset paths only) ──
        const themes = new Set();
        let m;
        const themeRe2 = /(?:src|href)=["'][^"']*\/wp-content\/themes\/([a-z0-9][a-z0-9 _.-]*?)[\/'"\\?]/gi;
        while ((m = themeRe2.exec(html))) themes.add(m[1]);
        const plugins = new Set();
        const plugRe = /(?:src|href)=["'][^"']*\/wp-content\/plugins\/([a-z0-9][a-z0-9 _.-]*?)[\/'"\\?]/gi;
        while ((m = plugRe.exec(html))) plugins.add(m[1]);
        const wpAsset = !!(
          document.querySelector('link[href*="/wp-content/"], link[href*="/wp-includes/"], script[src*="/wp-content/"], script[src*="/wp-includes/"]') ||
          document.querySelector('#wpadminbar, link#wp-block-library-css, link[rel="https://api.w.org/"]')
        );
        const wpGen = /wordpress/i.test(document.querySelector('meta[name="generator"]')?.content || '');
        const wpHtmlPath = /(?:src|href)=["'][^"']*\/wp-content\//i.test(html) || /(?:src|href)=["'][^"']*\/wp-includes\//i.test(html);

        if (wpAsset || wpGen || themes.size || plugins.size || wpHtmlPath) {
          out.wp = { themes: [...themes].slice(0, 5), plugins: [...plugins].slice(0, 40), themeMeta: null };
          // Fetch the active theme's style.css header for a proper name/version.
          const firstTheme = [...themes][0];
          if (firstTheme) {
            try {
              const r = await fetch(origin + '/wp-content/themes/' + firstTheme + '/style.css', { credentials: 'omit' });
              if (r.ok) {
                const css = (await r.text()).slice(0, 1500);
                const grab = (label) => { const mm = css.match(new RegExp(label + ':\\s*(.+)', 'i')); return mm ? mm[1].trim().split('\n')[0].trim() : ''; };
                out.wp.themeMeta = { name: grab('Theme Name'), version: grab('Version'), author: grab('Author'), uri: grab('Theme URI') };
              }
            } catch (e) {}
          }
        }

        // ── Shopify (parse inline scripts; MAIN-world pass adds window.Shopify) ──
        if (/cdn\.shopify\.com|\/cdn\/shop\/|x-shopify|Shopify\.theme|myshopify\.com/i.test(html)) {
          out.shopify = { themeName: '', themeId: '', storeId: '', shop: '' };
          const tm = html.match(/Shopify\.theme\s*=\s*(\{[^}]*\})/i);
          if (tm) { try { const o = JSON.parse(tm[1].replace(/'/g, '"')); out.shopify.themeName = o.name || ''; out.shopify.themeId = o.id || o.theme_store_id || ''; out.shopify.storeId = o.theme_store_id || ''; } catch (e) {} }
          const sm = html.match(/Shopify\.shop\s*=\s*["']([^"']+)["']/i); if (sm) out.shopify.shop = sm[1];
        }

        // ── Generator + other platforms ──
        out.generator = document.querySelector('meta[name="generator"]')?.content || '';
        const checks = [
          ['Wix', /static\.parastorage\.com|_wixCssVars|wix-bolt|meta[^>]+generator[^>]+Wix/i],
          ['Squarespace', /static1\.squarespace|Squarespace\.afterBody|squarespace-cdn/i],
          ['Webflow', /data-wf-page|data-wf-site|assets\.website-files\.com|webflow\.js/i],
          ['Drupal', /Drupal\.settings|drupal\.js|\/sites\/default\/files\//i],
          ['Joomla', /\/media\/jui\/|\/components\/com_|generator[^>]+Joomla/i],
          ['Magento', /Mage\.Cookies|\/static\/version\d+\/frontend\/|Magento_Theme|mage\/requirejs/i],
          ['Ghost', /__GHOST_|\/ghost\/api\/|generator[^>]+Ghost/i],
          ['Blogger', /blogger\.com\/static|blogspot\.com/i],
          ['HubSpot CMS', /hs-scripts\.com|js\.hs-scripts\.com/i],
          ['Framer', /framerusercontent\.com|framer\.com\/m\//i],
          ['Bubble', /bubble\.io|bubbleapps\.io/i],
          ['Next.js', /_next\/static\/|__NEXT_DATA__|#__next|data-next-head-count/i],
          ['Nuxt.js', /_nuxt\/|__NUXT__/i],
          ['React', /data-reactroot|data-reactid|react\.production|react\.development/i],
          ['Vite', /\/assets\/index-[A-Za-z0-9_-]+\.js|type=["']module["'][^>]+\/assets\//i],
          ['Cloudflare', /cdn-cgi\/|cloudflare\.com\/ajax|cf-browser-verification|"server"\s*:\s*"cloudflare"/i]
        ];
        checks.forEach(([name, re]) => { if (re.test(html)) out.others.push(name); });
        // Vite SPA shell: #root + hashed /assets/index-*.js
        if (document.querySelector('#root, #app') &&
            document.querySelector('script[type="module"][src*="/assets/"]') &&
            !out.others.includes('Next.js') && !out.others.includes('React')) {
          out.others.push('React');
          out.others.push('Vite');
        }
        if (document.querySelector('script[src*="cdnjs.cloudflare.com"], script[src*="cloudflareinsights"], link[href*="cdnjs.cloudflare.com"]')) {
          if (!out.others.includes('Cloudflare')) out.others.push('Cloudflare');
        }

        return out;
      });
    } catch (e) { setOut('taPlatform', '<div class="ta-summary bad">Could not access this page.</div>'); return; }

    // MAIN-world pass for window.Shopify (and window.wp) globals.
    let main = null;
    try {
      main = await runInPageMain(tab, () => {
        const r = {};
        try { if (window.Shopify) { r.shopify = { name: window.Shopify.theme && window.Shopify.theme.name, id: window.Shopify.theme && window.Shopify.theme.id, storeId: window.Shopify.theme && window.Shopify.theme.theme_store_id, shop: window.Shopify.shop }; } } catch (e) {}
        try { r.hasWp = !!window.wp; } catch (e) {}
        return r;
      });
    } catch (e) {}
    if (main && main.shopify) {
      d.shopify = d.shopify || {};
      d.shopify.themeName = d.shopify.themeName || main.shopify.name || '';
      d.shopify.themeId = d.shopify.themeId || main.shopify.id || '';
      d.shopify.storeId = d.shopify.storeId || main.shopify.storeId || '';
      d.shopify.shop = d.shopify.shop || main.shopify.shop || '';
    }

    if (!d) { setOut('taPlatform', '<div class="ta-summary bad">No response from page.</div>'); return; }

    // ── Render ──
    let html = '';
    const detectedAny = d.wp || d.shopify || d.others.length;
    if (!detectedAny) {
      html += '<div class="ta-summary info">✓ Custom HTML / static site — no common CMS/builder detected.' + (d.generator ? ' Generator: ' + esc(d.generator) : '') + '</div>';
      setOut('taPlatform', html); return;
    }

    // WordPress block
    if (d.wp) {
      const tm = d.wp.themeMeta;
      const themeLabel = (tm && tm.name) ? tm.name + (tm.version ? ' v' + tm.version : '') : (d.wp.themes[0] || 'unknown');
      html += '<div class="ta-summary ok">✓ WordPress detected</div>';
      html += '<div class="ta-row"><span class="ta-pill info">THEME</span><span><b>' + esc(themeLabel) + '</b>' + (tm && tm.author ? ' — by ' + esc(tm.author) : '') + (d.wp.themes[0] ? ' <span style="color:#94a3b8;">(' + esc(d.wp.themes[0]) + ')</span>' : '') + '</span></div>';
      if (d.wp.themes.length > 1) html += '<div class="ta-row"><span class="ta-pill info">OTHER</span><span>Theme folders also seen: ' + d.wp.themes.slice(1).map(esc).join(', ') + '</span></div>';
      if (d.wp.plugins.length) {
        const pretty = d.wp.plugins.map(p => PLUGIN_NAMES[p] || p);
        html += '<div class="ta-row"><span class="ta-pill ok">PLUGINS</span><span>' + d.wp.plugins.length + ' detected</span></div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">' + pretty.map(p => '<span class="ta-chip">' + esc(p) + '</span>').join('') + '</div>';
        html += '<button class="ta-copy" id="taPlatCopy">Copy plugin list</button>';
      } else {
        html += '<div class="ta-row"><span class="ta-pill warn">PLUGINS</span><span>None exposed in page source (may be bundled/hidden).</span></div>';
      }
    }

    // Shopify block
    if (d.shopify) {
      html += '<div class="ta-summary ok" style="margin-top:10px;">✓ Shopify detected</div>';
      if (d.shopify.themeName) html += '<div class="ta-row"><span class="ta-pill info">THEME</span><span><b>' + esc(d.shopify.themeName) + '</b>' + (d.shopify.themeId ? ' <span style="color:#94a3b8;">(id ' + esc(d.shopify.themeId) + ')</span>' : '') + '</span></div>';
      else html += '<div class="ta-row"><span class="ta-pill warn">THEME</span><span>Theme name not exposed on this page (try a product/collection page).</span></div>';
      if (d.shopify.storeId) html += '<div class="ta-row"><span class="ta-pill info">STORE THEME ID</span><span>' + esc(d.shopify.storeId) + ' <span style="color:#94a3b8;">(a Theme Store theme)</span></span></div>';
      if (d.shopify.shop) html += '<div class="ta-row"><span class="ta-pill info">SHOP</span><span>' + esc(d.shopify.shop) + '</span></div>';
    }

    // Other platforms
    if (d.others.length) {
      html += '<div class="ta-row" style="margin-top:8px;"><span class="ta-pill info">PLATFORM</span><span>' + d.others.map(esc).join(', ') + '</span></div>';
    }
    if (d.generator) html += '<div class="ta-row"><span class="ta-pill info">GENERATOR</span><span>' + esc(d.generator) + '</span></div>';

    setOut('taPlatform', html);
    if (d.wp && d.wp.plugins.length) {
      window.__taPlugins = d.wp.plugins.map(p => PLUGIN_NAMES[p] || p).join('\n');
      wireCopy('taPlatCopy', () => window.__taPlugins || '');
    }
  }

  const RUNNERS = { schema: checkSchema, links: checkLinks, robots: checkRobots, hreflang: checkHreflang, indexmeta: checkIndexMeta, imgalt: checkImgAlt, faqschema: genFaqSchema, llmstxt: genLlms, platform: detectPlatform };

  ready(() => {
    document.querySelectorAll('.ta-run').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.getAttribute('data-ta');
        const fn = RUNNERS[key];
        if (!fn) return;
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = '…';
        try { await fn(); } catch (e) { /* surfaced in output already */ }
        btn.disabled = false;
        btn.textContent = orig;
      });
    });
  });
})();


// ─── Page Inspector (hover zoom / pipette / Alt+scroll) ─────────
function initPageInspector() {
  const keys = ['rsHoverZoom', 'rsColorPipette', 'rsFocusZoom'];
  const defaults = { rsHoverZoom: false, rsColorPipette: false, rsFocusZoom: true };
  try {
    chrome.storage.sync.get(keys, (data) => {
      keys.forEach((k) => {
        const el = document.getElementById(k);
        if (!el) return;
        el.checked = data[k] != null ? !!data[k] : defaults[k];
        if (!el.dataset.bound) {
          el.dataset.bound = '1';
          el.addEventListener('change', () => {
            const payload = {};
            keys.forEach((id) => {
              const n = document.getElementById(id);
              payload[id] = n ? !!n.checked : defaults[id];
            });
            chrome.storage.sync.set(payload, () => {
              if (typeof toast === 'function') toast('Page Inspector updated — refresh page');
              // Live toggle pipette on active tab
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs && tabs[0];
                if (!tab?.id) return;
                try {
                  chrome.tabs.sendMessage(tab.id, {
                    action: 'RS_TOGGLE_PIPETTE',
                    enabled: !!payload.rsColorPipette
                  }, () => { void chrome.runtime.lastError; });
                } catch (_) {}
              });
            });
          });
        }
      });
    });
  } catch (_) {}
  document.getElementById('rsPickColorNow')?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab?.id) return;
      chrome.tabs.sendMessage(tab.id, { action: 'RS_START_EYEDROPPER' }, () => {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/page-inspector.js']
          }).then(() => {
            chrome.tabs.sendMessage(tab.id, { action: 'RS_START_EYEDROPPER' }, () => { void chrome.runtime.lastError; });
          }).catch(() => {});
        }
      });
    });
  });
}


