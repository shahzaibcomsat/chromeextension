// ShahzaibSEO - AEO & GEO Expert - Content Script
// Enhanced page analysis for SEO

(function() {
  'use strict';

  // ─── Skip non-HTML pages ──────────────────────────────────────────────────
  // Mirrors the same guard in toolbar.js — bail out early on XML/JSON/feeds.
  try {
    const path = location.pathname.toLowerCase();
    const NON_HTML_EXT = [
      '.xml','.json','.rss','.atom','.txt','.csv',
      '.pdf','.js','.css','.svg','.ico',
      '.png','.jpg','.jpeg','.gif','.webp','.avif',
      '.mp4','.mp3','.webm','.zip','.gz','.woff','.woff2','.ttf'
    ];
    if (NON_HTML_EXT.some(e => path.endsWith(e))) return;
    const ct = (document.contentType || '').toLowerCase();
    if (ct && !ct.startsWith('text/html') && !ct.startsWith('application/xhtml')) return;
    const root = document.documentElement;
    if (root && root.tagName && root.tagName.toLowerCase() !== 'html') return;
    if (!document.body) return;
  } catch(e) { return; }

  // Guard against double-injection. The content script is auto-injected by
  // the manifest at document_end, but it can also be force-injected by
  // chrome.scripting.executeScript (e.g. when the popup calls analyzeTab on
  // a page that loaded before the extension, or during an extension reload).
  // Without this guard the onMessage listener would be registered twice and
  // each message would be handled twice.
  if (window.__rankseoContentLoaded) return;
  window.__rankseoContentLoaded = true;

  // Main analysis function - each analyzer is protected individually
  // so a crash in one doesn't block the others
  function analyzePage() {
    function safe(fn) {
      try { return fn(); } catch (e) { console.warn('ShahzaibSEO analysis error:', e.message); return null; }
    }

    const analysis = {
      url: window.location.href,
      timestamp: new Date().toISOString(),
      title: safe(analyzeTitle) || { content: '', length: 0, status: 'warning', message: 'Analysis error' },
      metaDescription: safe(analyzeMetaDescription) || { content: '', length: 0, status: 'warning', message: 'Analysis error' },
      headings: safe(analyzeHeadings) || { structure: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] }, orderedHeadings: [], h1Count: 0, totalHeadings: 0, status: 'warning', message: 'Analysis error' },
      images: safe(analyzeImages) || { total: 0, withAlt: 0, withoutAlt: 0, images: [], formats: [], status: 'warning', message: 'Analysis error' },
      links: safe(analyzeLinks) || { total: 0, internal: 0, external: 0, nofollow: 0, empty: 0, withoutText: 0, links: [], status: 'warning', message: 'Analysis error' },
      content: safe(analyzeContent) || { wordCount: 0, paragraphCount: 0, topWords: [], status: 'warning', message: 'Analysis error' },
      keywords: null,
      technical: safe(analyzeTechnical) || { canonical: null, robots: null, language: null, viewport: null, charset: null, favicon: null, cms: null, techStack: null },
      social: safe(analyzeSocialTags) || { status: 'warning', message: 'Analysis error' },
      structured: safe(analyzeStructuredData) || { count: 0, validCount: 0, invalidCount: 0, schemas: [], status: 'warning' },
      structuredDeep: safe(analyzeStructuredDataDeep),
      performance: safe(analyzePerformance) || {},
      readability: safe(analyzeReadability) || { sentenceCount: 0, avgSentenceLength: 0, readabilityScore: 0, distribution: {} },
      pageType: safe(detectPageType),
      geoSignals: safe(analyzeGEOSignals),
      searchIntent: safe(detectSearchIntent),
      serpEligibility: safe(analyzeSERPEligibility),
      readabilityAdvanced: safe(analyzeReadabilityAdvanced),
      duplicateContent: safe(detectDuplicateContent),
      citability: safe(analyzeCitability),
      aiCrawlerView: safe(analyzeAICrawlerView),
      contentGaps: safe(analyzeContentGaps),
      entities: safe(extractEntities),
      indexationHints: safe(analyzeIndexationHints),
      multiLangSeo: safe(analyzeMultiLangSeo),
      security: safe(analyzeSecuritySeo),
      accessibility: safe(analyzeAccessibility),
      jsErrors: safe(analyzeJsErrors),
      fontsPerf: safe(analyzeFontsPerf),
      designTokens: safe(analyzeDesignTokens),
      videos: safe(analyzeVideos),
      pageWeight: safe(analyzePageWeight),
      contrastAnalysis: safe(analyzeContrast),
      eeat: safe(analyzeEEAT),
      advancedTechnical: safe(analyzeAdvancedTechnical),
      languageAnalysis: safe(analyzeLanguage),
      cro: safe(analyzeCRO),
      socialProfiles: safe(analyzeSocialProfiles),
      localSeo: safe(analyzeLocalSEO),
      ecommerce: safe(analyzeEcommerceSnapshot)
    };

    // Keyword analysis (depends on other data)
    analysis.keywords = safe(() => analyzeKeywords(analysis));

    // Calculate global score
    analysis.score = safe(() => calculateOverallScore(analysis)) || { value: 0, grade: '?', issues: [] };

    // Trim large arrays to prevent message size limits
    if (analysis.images && analysis.images.images && analysis.images.images.length > 500) {
      analysis.images.images = analysis.images.images.slice(0, 500);
    }
    if (analysis.links && analysis.links.links && analysis.links.links.length > 500) {
      analysis.links.links = analysis.links.links.slice(0, 500);
    }

    // Clear cached HTML
    _cachedOuterHTML = null;
    _cachedBodyText = null;
    _cachedResourceEntries = null;

    return analysis;
  }

  // Title analysis
  function analyzeTitle() {
    const title = document.title || '';
    const length = title.length;

    let status = 'good';
    let message = 'Title optimized';

    if (length === 0) {
      status = 'error';
      message = 'Title missing';
    } else if (length < 30) {
      status = 'warning';
      message = 'Title too short (< 30 characters)';
    } else if (length > 60) {
      status = 'warning';
      message = 'Title too long (> 60 characters)';
    }

    return {
      content: title,
      length: length,
      status: status,
      message: message,
      recommendation: length < 30 ? 'Extend title to 30-60 characters' :
                      length > 60 ? 'Reduce title to 60 characters max' : null
    };
  }

  // Meta description analysis
  function analyzeMetaDescription() {
    const metaDesc = document.querySelector('meta[name="description"]');
    const content = metaDesc ? metaDesc.getAttribute('content') || '' : '';
    const length = content.length;

    let status = 'good';
    let message = 'Meta description optimized';

    if (length === 0) {
      status = 'error';
      message = 'Meta description missing';
    } else if (length < 120) {
      status = 'warning';
      message = 'Meta description too short (< 120 characters)';
    } else if (length > 160) {
      status = 'warning';
      message = 'Meta description too long (> 160 characters)';
    }

    return {
      content: content,
      length: length,
      status: status,
      message: message,
      recommendation: length === 0 ? 'Add a meta description of 120-160 characters' :
                      length < 120 ? 'Extend meta description to 120-160 characters' :
                      length > 160 ? 'Reduce meta description to 160 characters max' : null
    };
  }

  // Headings analysis
  function analyzeHeadings() {
    const headings = {
      h1: [],
      h2: [],
      h3: [],
      h4: [],
      h5: [],
      h6: []
    };

    // Collect headings in DOM order for hierarchy analysis
    const allHeadingsInOrder = [];
    const headingElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headingElements.forEach((el, globalIndex) => {
      const level = parseInt(el.tagName.charAt(1));
      // Keep full heading text (empty headings stay as '')
      const fullText = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const headingData = {
        text: fullText,
        length: fullText.length,
        isEmpty: fullText.length === 0,
        level: level,
        domIndex: globalIndex
      };
      headings[`h${level}`].push({
        ...headingData,
        index: headings[`h${level}`].length
      });
      allHeadingsInOrder.push(headingData);
    });

    // Calculate suggested levels based on proper hierarchy
    const headingsWithSuggestions = calculateSuggestedLevels(allHeadingsInOrder);

    const h1Count = headings.h1.length;
    let status = 'good';
    let message = 'Headings structure correct';

    if (h1Count === 0) {
      status = 'error';
      message = 'No H1 tag found';
    } else if (h1Count > 1) {
      status = 'warning';
      message = `${h1Count} H1 tags found (1 recommended)`;
    }

    const totalHeadings = Object.values(headings).reduce((sum, arr) => sum + arr.length, 0);

    return {
      structure: headings,
      orderedHeadings: headingsWithSuggestions,
      h1Count: h1Count,
      totalHeadings: totalHeadings,
      status: status,
      message: message,
      hierarchy: checkHeadingHierarchy(headings)
    };
  }

  // Calculate suggested heading levels for proper hierarchy
  function calculateSuggestedLevels(headings) {
    if (headings.length === 0) return [];

    const result = [];
    let lastSuggestedLevel = 0;

    for (let i = 0; i < headings.length; i++) {
      const current = headings[i];
      const currentLevel = current.level;

      let suggestedLevel = currentLevel;

      if (i === 0) {
        // First heading should be H1
        suggestedLevel = 1;
      } else {
        // Check if current level is valid based on last suggested level
        // Valid: same level, one level deeper, or any level going back up
        if (currentLevel > lastSuggestedLevel + 1) {
          // Skipping levels - suggest the next valid level
          suggestedLevel = lastSuggestedLevel + 1;
        } else if (currentLevel <= lastSuggestedLevel) {
          // Going up or staying same - this is valid
          suggestedLevel = currentLevel;
        } else {
          // Going one level deeper - valid
          suggestedLevel = currentLevel;
        }
      }

      result.push({
        ...current,
        suggestedLevel: suggestedLevel,
        hasIssue: suggestedLevel !== currentLevel
      });

      lastSuggestedLevel = suggestedLevel;
    }

    return result;
  }

  // Check heading hierarchy
  function checkHeadingHierarchy(headings) {
    const levels = [];
    for (let i = 1; i <= 6; i++) {
      if (headings[`h${i}`].length > 0) {
        levels.push(i);
      }
    }

    let isCorrect = true;
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i-1] > 1) {
        isCorrect = false;
        break;
      }
    }

    return {
      isCorrect: isCorrect,
      message: isCorrect ? 'Heading hierarchy correct' : 'Missing heading levels in hierarchy'
    };
  }

  // Images analysis - Enhanced for full SEO audit
  function analyzeImages() {
    const images = document.querySelectorAll('img');
    const imagesData = [];
    let withAlt = 0;
    let withoutAlt = 0;
    let emptyAlt = 0;
    let decorativeAlt = 0;
    let resizedCount = 0;
    let aboveFoldLazy = 0;
    let totalPotentialSaving = 0;
    let totalFileSize = 0;

    // Viewport height for above-fold detection
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Get resource timing data for file sizes.
    // NOTE: transferSize is 0 for cached resources and for cross-origin responses
    // without a Timing-Allow-Origin header. In those cases we fall back to
    // encodedBodySize (which is populated for same-origin or TAO-allowed resources).
    // Decoded body size is NOT used because it's the uncompressed in-memory size,
    // which massively overestimates the on-wire/on-disk weight.
    const resourceTimings = {};
    try {
      const entries = getResourceEntries();
      entries.forEach(entry => {
        // Consider entries that look like images: either initiatorType === 'img'
        // (covers <img>, <picture>, srcset) or a content-type starting with image/.
        const isImageEntry = entry.initiatorType === 'img' ||
          (entry.contentType && entry.contentType.indexOf('image/') === 0);
        if (!isImageEntry) return;
        // Prefer transferSize (includes headers + compressed body on the wire),
        // fall back to encodedBodySize for cached/TAO-less responses.
        const size = entry.transferSize > 0
          ? entry.transferSize
          : (entry.encodedBodySize > 0 ? entry.encodedBodySize : 0);
        if (size > 0) {
          // Keep the largest recorded size in case the same URL was requested twice
          // (e.g. redirected or replayed after a cache bust).
          const existing = resourceTimings[entry.name] || 0;
          if (size > existing) {
            resourceTimings[entry.name] = size;
          }
        }
      });
    } catch (e) {
      // Performance API not available
    }

    // Track URLs we've already counted towards the total file size, to avoid
    // double-counting when the same image URL is reused multiple times on the
    // page (e.g. a logo used in the header and footer only transfers once).
    const countedUrls = new Set();

    // Format counters
    const formatCounts = {};

    // Generic alt text patterns to detect
    const genericAltPatterns = [
      /^image$/i,
      /^img$/i,
      /^photo$/i,
      /^picture$/i,
      /^untitled$/i,
      /^dsc\d+$/i,
      /^img_\d+$/i,
      /^image\d+$/i,
      /^\d+$/,
      /^\.jpg$/i,
      /^\.png$/i,
      /^\.webp$/i
    ];

    images.forEach((img, index) => {
      try {
      const alt = img.getAttribute('alt');
      // currentSrc reflects the URL the browser actually loaded (important for
      // <img srcset>/<picture>). Fall back to src/data-* when not yet loaded.
      const loadedSrc = img.currentSrc || '';
      const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
      // Use the loaded URL for size lookups, but keep the original src for display.
      const lookupSrc = loadedSrc || src;

      // Skip non-meaningful images (tracking pixels, hidden, broken)
      const hasLazyData = img.hasAttribute('data-src') || img.hasAttribute('data-lazy-src') ||
                          img.hasAttribute('data-lazy') || img.hasAttribute('data-original');
      const computedStyle = window.getComputedStyle(img);
      const isHiddenImg = computedStyle.display === 'none' || computedStyle.visibility === 'hidden' || computedStyle.opacity === '0';
      const isTrackingPixel = img.complete && img.naturalWidth <= 1 && img.naturalHeight <= 1;
      const isBrokenImg = !src || (img.complete && img.naturalWidth === 0 && img.naturalHeight === 0 && !src.startsWith('data:') && !hasLazyData);

      if (isHiddenImg || isTrackingPixel || isBrokenImg) return;

      // Decorative image detection: alt="" (intentionally empty) or aria-hidden="true"
      const ariaHidden = img.getAttribute('aria-hidden') === 'true';
      const rolePresentation = img.getAttribute('role') === 'presentation' || img.getAttribute('role') === 'none';
      const isDecorative = (alt !== null && alt.trim() === '') || ariaHidden || rolePresentation;

      // Alt text analysis
      let altStatus = 'ok';
      let altText = alt || '';
      if (isDecorative) {
        decorativeAlt++;
        altStatus = 'decorative';
      } else if (alt === null) {
        withoutAlt++;
        altStatus = 'missing';
      } else {
        // Check for generic alt text
        const isGeneric = genericAltPatterns.some(pattern => pattern.test(alt.trim()));
        if (isGeneric) {
          altStatus = 'warning';
        } else if (alt.length > 125) {
          altStatus = 'warning'; // Alt too long
        } else {
          withAlt++;
        }
      }

      // Format detection
      const format = detectImageFormat(src);
      formatCounts[format] = (formatCounts[format] || 0) + 1;

      // Dimensions
      const intrinsicWidth = img.naturalWidth || 0;
      const intrinsicHeight = img.naturalHeight || 0;
      const displayWidth = img.clientWidth || img.width || 0;
      const displayHeight = img.clientHeight || img.height || 0;

      // Check if resized (intrinsic much larger than display)
      let isResizedCandidate = false;
      let resizePercentage = 0;
      if (intrinsicWidth > 0 && displayWidth > 0) {
        const widthRatio = displayWidth / intrinsicWidth;
        const heightRatio = displayHeight / intrinsicHeight;
        const minRatio = Math.min(widthRatio, heightRatio);
        // Consider resized if displayed at less than 50% of original size
        if (minRatio < 0.5 && intrinsicWidth > 100) {
          isResizedCandidate = true;
          resizePercentage = Math.round((1 - minRatio) * 100);
          resizedCount++;
        }
      }

      // Above fold detection using bounding box
      const rect = img.getBoundingClientRect();
      const isAboveFold = rect.top < viewportHeight && rect.bottom > 0 && rect.left < viewportWidth && rect.right > 0;

      // Lazy loading detection
      const loadingAttr = img.getAttribute('loading');
      const hasDataSrc = img.hasAttribute('data-src') || img.hasAttribute('data-lazy-src') ||
                         img.hasAttribute('data-lazy') || img.hasAttribute('data-original');
      const hasLazyClass = img.className.includes('lazy') || img.className.includes('lazyload');
      const isLazy = loadingAttr === 'lazy' || hasDataSrc || hasLazyClass;

      // Above fold + lazy = problem
      if (isAboveFold && isLazy) {
        aboveFoldLazy++;
      }

      // Get actual file size from Performance API or estimate.
      // We look up using the loaded URL first (handles srcset/picture correctly),
      // then fall back to the declared src.
      let fileSize = 0;
      let fileSizeIsEstimate = false;
      let matchedUrl = '';
      if (lookupSrc && resourceTimings[lookupSrc]) {
        fileSize = resourceTimings[lookupSrc];
        matchedUrl = lookupSrc;
      } else if (src && resourceTimings[src]) {
        fileSize = resourceTimings[src];
        matchedUrl = src;
      }
      if (!fileSize) {
        // Try to match by URL pathname (some frameworks rewrite or proxy URLs).
        const candidate = lookupSrc || src;
        if (candidate) {
          let srcPath = '';
          try { srcPath = new URL(candidate, window.location.href).pathname; } catch (e) { srcPath = candidate.split('?')[0]; }
          const srcEnd = srcPath.split('/').pop();
          if (srcEnd && srcEnd.length > 3) {
            for (const [url, size] of Object.entries(resourceTimings)) {
              if (url.indexOf(srcEnd) !== -1) {
                fileSize = size;
                matchedUrl = url;
                break;
              }
            }
          }
        }
      }
      // Only estimate when we have absolutely no measured size AND we have
      // real intrinsic dimensions (meaning the image has actually loaded).
      // This prevents huge phantom weights from lazy/broken images.
      if (!fileSize && intrinsicWidth > 0 && intrinsicHeight > 0 && img.complete) {
        fileSize = estimateImageSize(intrinsicWidth, intrinsicHeight, format);
        fileSizeIsEstimate = true;
      }
      // Dedupe in the total: if this URL was already counted once, don't add
      // its bytes again (browser caches the response after the first request).
      const dedupeKey = matchedUrl || lookupSrc || src;
      if (fileSize > 0 && dedupeKey && !countedUrls.has(dedupeKey)) {
        countedUrls.add(dedupeKey);
        totalFileSize += fileSize;
      } else if (fileSize > 0 && !dedupeKey) {
        // No URL to dedupe on (rare) - still count it.
        totalFileSize += fileSize;
      }

      // Estimate potential saving (simplified calculation)
      let potentialSavingBytes = 0;
      let estimatedFinalBytes = 0;
      if (isResizedCandidate) {
        // Use actual file size if available, otherwise estimate
        const currentSize = fileSize || estimateImageSize(intrinsicWidth, intrinsicHeight, format);
        const targetSizeEstimate = estimateImageSize(displayWidth * 2, displayHeight * 2, 'webp'); // 2x for retina
        potentialSavingBytes = Math.max(0, currentSize - targetSizeEstimate);
        estimatedFinalBytes = targetSizeEstimate;
        totalPotentialSaving += potentialSavingBytes;
      }

      // Generate CSS selector for the image
      const selector = generateSelector(img, index);

      imagesData.push({
        src: src,
        currentSrc: loadedSrc || '',
        alt: altText,
        altStatus: altStatus,
        isDecorative: isDecorative,
        format: format,
        fileSize: fileSize,
        fileSizeIsEstimate: fileSizeIsEstimate,
        intrinsicWidth: intrinsicWidth,
        intrinsicHeight: intrinsicHeight,
        displayWidth: displayWidth,
        displayHeight: displayHeight,
        isResizedCandidate: isResizedCandidate,
        resizePercentage: resizePercentage,
        isAboveFold: isAboveFold,
        isLazy: isLazy,
        potentialSavingBytes: potentialSavingBytes,
        estimatedFinalBytes: estimatedFinalBytes,
        selector: selector,
        loading: loadingAttr,
        index: index
      });
      } catch (e) {
        // Skip images that cause errors
      }
    });

    const total = imagesData.length;
    let status = 'good';
    let message = 'All images have alt attributes';

    if (withoutAlt > 0) {
      status = 'error';
      message = `${withoutAlt} image(s) without alt attribute`;
    }

    // Convert format counts to array
    const formats = Object.entries(formatCounts).map(([format, count]) => ({
      format: format.toUpperCase(),
      count: count
    })).sort((a, b) => b.count - a.count);

    // Detect duplicate alt texts (excluding empty/decorative)
    const altTextCounts = new Map();
    imagesData.forEach(img => {
      const alt = (img.alt || '').trim();
      if (alt && img.altStatus !== 'decorative') {
        altTextCounts.set(alt, (altTextCounts.get(alt) || 0) + 1);
      }
    });
    const duplicateAltsList = [];
    altTextCounts.forEach((count, alt) => {
      if (count > 1) {
        duplicateAltsList.push({ alt, count });
      }
    });
    duplicateAltsList.sort((a, b) => b.count - a.count);
    const duplicateAlts = {
      count: duplicateAltsList.length,
      duplicates: duplicateAltsList
    };

    return {
      total: total,
      withAlt: withAlt,
      withoutAlt: withoutAlt,
      emptyAlt: emptyAlt,
      decorativeAlt: decorativeAlt,
      resizedCount: resizedCount,
      aboveFoldLazy: aboveFoldLazy,
      totalPotentialSaving: totalPotentialSaving,
      totalFileSize: totalFileSize,
      formats: formats,
      images: imagesData,
      duplicateAlts: duplicateAlts,
      status: status,
      message: message
    };
  }

  // Detect image format from URL
  function detectImageFormat(src) {
    if (!src) return 'unknown';

    const url = String(src == null ? '' : src).toLowerCase();

    // Check data URIs first
    if (url.startsWith('data:image/webp')) return 'webp';
    if (url.startsWith('data:image/avif')) return 'avif';
    if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg')) return 'jpg';
    if (url.startsWith('data:image/png')) return 'png';
    if (url.startsWith('data:image/gif')) return 'gif';
    if (url.startsWith('data:image/svg')) return 'svg';

    // Check query params for format hints (CDNs like Shopify, Cloudinary, etc.)
    if (url.includes('format=webp') || url.includes('fm=webp') || url.includes('f_webp')) return 'webp';
    if (url.includes('format=avif') || url.includes('fm=avif') || url.includes('f_avif')) return 'avif';
    if (url.includes('format=jpg') || url.includes('format=jpeg') || url.includes('fm=jpg') || url.includes('format=pjpg') || url.includes('f_jpg')) return 'jpg';
    if (url.includes('format=png') || url.includes('fm=png') || url.includes('f_png')) return 'png';
    if (url.includes('format=gif') || url.includes('fm=gif') || url.includes('f_gif')) return 'gif';
    if (url.includes('format=svg') || url.includes('fm=svg')) return 'svg';

    // Check file extension in URL path (strip query string and hash first)
    try {
      const pathname = new URL(src).pathname.toLowerCase();
      const extMatch = pathname.match(/\.(\w{3,4})$/);
      if (extMatch) {
        const ext = extMatch[1];
        if (ext === 'webp') return 'webp';
        if (ext === 'avif') return 'avif';
        if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
        if (ext === 'png') return 'png';
        if (ext === 'gif') return 'gif';
        if (ext === 'svg') return 'svg';
        if (ext === 'ico') return 'ico';
        if (ext === 'bmp') return 'bmp';
      }
    } catch (e) {
      // Fallback for invalid URLs: simple string checks
      if (url.includes('.webp')) return 'webp';
      if (url.includes('.avif')) return 'avif';
      if (url.includes('.jpg') || url.includes('.jpeg')) return 'jpg';
      if (url.includes('.png')) return 'png';
      if (url.includes('.gif')) return 'gif';
      if (url.includes('.svg')) return 'svg';
      if (url.includes('.ico')) return 'ico';
      if (url.includes('.bmp')) return 'bmp';
    }

    // Try to detect from Performance API content-type
    try {
      const entries = getResourceEntries();
      for (const entry of entries) {
        if (entry.name === src && entry.contentType) {
          const ct = String(entry.contentType == null ? '' : entry.contentType).toLowerCase();
          if (ct.includes('webp')) return 'webp';
          if (ct.includes('avif')) return 'avif';
          if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
          if (ct.includes('png')) return 'png';
          if (ct.includes('gif')) return 'gif';
          if (ct.includes('svg')) return 'svg';
        }
      }
    } catch (e) {
      // Performance API not available
    }

    return 'unknown';
  }

  // Estimate image size based on dimensions and format.
  // This is a last-resort fallback when the Performance API can't tell us the
  // real transferred size (typically cross-origin images from CDNs that don't
  // set a Timing-Allow-Origin header). We intentionally err on the low side:
  // modern CDNs aggressively optimize images, so over-estimating the page
  // weight is worse than slightly under-estimating it.
  function estimateImageSize(width, height, format) {
    const pixels = Math.max(0, width * height);
    if (pixels <= 0) return 0;

    // Approximate bytes per pixel for different formats (conservative).
    const bytesPerPixel = {
      'jpg': 0.12,
      'jpeg': 0.12,
      'png': 0.25,
      'webp': 0.06,
      'avif': 0.04,
      'gif': 0.18,
      'svg': 0.01,
      'ico': 0.1,
      'bmp': 0.5,
      'unknown': 0.1
    };

    const bpp = bytesPerPixel[(format || '').toLowerCase()] || bytesPerPixel.unknown;
    // Clamp to a reasonable upper bound (10 MB per image) so a single giant
    // estimate cannot dominate the total page weight KPI.
    return Math.min(10 * 1024 * 1024, Math.round(pixels * bpp));
  }

  // Generate a CSS selector for an element
  function generateSelector(element, index) {
    // Use CSS.escape so selectors containing special characters (colons from
    // Tailwind prefixes, dots, digits, etc.) still parse when fed back into
    // document.querySelector() by the highlight handlers.
    const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    if (element.id) {
      return `#${esc(element.id)}`;
    }

    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).slice(0, 2).map(esc).join('.');
      if (classes) {
        return `img.${classes}`;
      }
    }

    // Use nth-of-type
    return `img:nth-of-type(${index + 1})`;
  }

  // Links analysis (enhanced with position zone and image detection)
  function analyzeLinks() {
    const links = document.querySelectorAll('a[href]');
    const currentDomain = window.location.hostname;

    let internal = 0;
    let external = 0;
    let nofollow = 0;
    let internalNofollow = 0;
    let sponsored = 0;
    let ugc = 0;
    let empty = 0;
    let withoutText = 0;
    let genericAnchors = 0;

    // Generic anchor text patterns (no SEO value)
    const genericAnchorPatterns = [
      /^click here$/i, /^cliquez ici$/i, /^here$/i, /^ici$/i,
      /^read more$/i, /^lire la suite$/i, /^en savoir plus$/i,
      /^learn more$/i, /^more$/i, /^plus$/i, /^voir plus$/i,
      /^see more$/i, /^view more$/i, /^details$/i, /^détails$/i,
      /^link$/i, /^lien$/i, /^go$/i, /^continue$/i,
      /^this$/i, /^ceci$/i, /^more info$/i, /^info$/i,
      /^download$/i, /^télécharger$/i, /^submit$/i
    ];

    const linksData = [];
    const internalLinkTargets = {}; // Track unique internal URLs
    const anchorTexts = {}; // Track anchor text diversity

    links.forEach((link, index) => {
      try {
        const href = link.getAttribute('href') || '';
        const text = link.textContent.trim();
        const rel = link.getAttribute('rel') || '';
        const target = link.getAttribute('target') || '';

        // Check for empty/invalid href
        const isEmptyLink = !href || href === '#' || href === 'javascript:void(0)' || href === 'javascript:;';
        if (isEmptyLink) {
          empty++;
        }

        let type = 'internal';
        let isInternal = true;
        let fullUrl = href;
        try {
          const url = new URL(href, window.location.origin);
          fullUrl = url.href;
          if (url.hostname !== currentDomain) {
            type = 'external';
            isInternal = false;
            external++;
          } else {
            internal++;
          }
        } catch (e) {
          if (href.startsWith('http')) {
            type = 'external';
            isInternal = false;
            external++;
          } else {
            internal++;
          }
        }

        // Rel attribute parsing
        const relLower = String(rel == null ? '' : rel).toLowerCase();
        const hasNofollow = relLower.includes('nofollow');
        const hasSponsored = relLower.includes('sponsored');
        const hasUgc = relLower.includes('ugc');
        const hasNoopener = relLower.includes('noopener');
        const hasNoreferrer = relLower.includes('noreferrer');

        if (hasNofollow) {
          nofollow++;
          if (isInternal) {
            internalNofollow++;
          }
        }
        if (hasSponsored) sponsored++;
        if (hasUgc) ugc++;

        // Image detection in link
        const hasImage = !!(link.querySelector('img') || link.querySelector('svg') || link.querySelector('picture'));
        const isImageOnlyLink = hasImage && !text;

        // Text analysis
        const hasText = !!(text || hasImage);
        if (!hasText) {
          withoutText++;
        }

        // Generic anchor detection
        const isGenericAnchor = text && genericAnchorPatterns.some(p => p.test(text.trim()));
        if (isGenericAnchor) {
          genericAnchors++;
        }

        // Track internal link targets and anchor diversity
        if (isInternal && fullUrl) {
          try {
            const normalizedUrl = new URL(fullUrl).pathname;
            internalLinkTargets[normalizedUrl] = (internalLinkTargets[normalizedUrl] || 0) + 1;
          } catch (e) {}
          if (text) {
            anchorTexts[text.trim().toLowerCase()] = (anchorTexts[text.trim().toLowerCase()] || 0) + 1;
          }
        }

        // Position zone detection
        const positionZone = detectPositionZone(link);

        // Generate CSS selector
        const selector = generateLinkSelector(link, index);

        // Determine rel display value
        let relDisplay = 'follow';
        if (hasNofollow) relDisplay = 'nofollow';
        if (hasSponsored) relDisplay = 'sponsored';
        if (hasUgc) relDisplay = 'ugc';

        linksData.push({
          index: index + 1,
          href: href,
          fullUrl: fullUrl,
          text: text.substring(0, 150),
          type: type,
          isInternal: isInternal,
          rel: rel,
          relDisplay: relDisplay,
          hasNofollow: hasNofollow,
          hasSponsored: hasSponsored,
          hasUgc: hasUgc,
          hasNoopener: hasNoopener,
          hasNoreferrer: hasNoreferrer,
          target: target,
          hasImage: hasImage,
          isImageOnlyLink: isImageOnlyLink,
          isEmpty: isEmptyLink,
          hasText: hasText,
          isGenericAnchor: isGenericAnchor,
          positionZone: positionZone,
          selector: selector
        });
      } catch (e) {
        // Skip links that cause errors (e.g. SVG-related issues)
      }
    });

    let status = 'good';
    let message = 'Links properly configured';

    if (withoutText > 0) {
      status = 'warning';
      message = `${withoutText} link(s) without anchor text`;
    }

    // Internal linking quality metrics
    const uniqueInternalTargets = Object.keys(internalLinkTargets).length;
    const uniqueAnchors = Object.keys(anchorTexts).length;
    const internalRatio = links.length > 0 ? Math.round((internal / links.length) * 100) : 0;
    const mainContentLinks = linksData.filter(l => l.isInternal && l.positionZone && l.positionZone.code === 'M').length;

    return {
      total: links.length,
      internal: internal,
      external: external,
      nofollow: nofollow,
      internalNofollow: internalNofollow,
      sponsored: sponsored,
      ugc: ugc,
      empty: empty,
      withoutText: withoutText,
      genericAnchors: genericAnchors,
      links: linksData,
      status: status,
      message: message,
      // Internal linking quality
      internalLinking: {
        ratio: internalRatio,
        uniqueTargets: uniqueInternalTargets,
        uniqueAnchors: uniqueAnchors,
        mainContentLinks: mainContentLinks,
        topTargets: Object.entries(internalLinkTargets)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([url, count]) => ({ url, count }))
      }
    };
  }

  // Detect position zone of an element (H=Header, N=Nav, M=Main, A=Aside, F=Footer)
  function detectPositionZone(element) {
    let current = element;

    while (current && current !== document.body) {
      const tagName = current.tagName.toLowerCase();

      // Check semantic elements
      if (tagName === 'header') return { code: 'H', name: 'header' };
      if (tagName === 'nav') return { code: 'N', name: 'nav' };
      if (tagName === 'main') return { code: 'M', name: 'main' };
      if (tagName === 'aside') return { code: 'A', name: 'aside' };
      if (tagName === 'footer') return { code: 'F', name: 'footer' };

      // Check role attributes
      const role = current.getAttribute('role');
      if (role) {
        if (role === 'banner') return { code: 'H', name: 'header' };
        if (role === 'navigation') return { code: 'N', name: 'nav' };
        if (role === 'main') return { code: 'M', name: 'main' };
        if (role === 'complementary') return { code: 'A', name: 'aside' };
        if (role === 'contentinfo') return { code: 'F', name: 'footer' };
      }

      // Check common class names (className can be SVGAnimatedString on SVG elements)
      const className = (typeof current.className === 'string' ? current.className : '').toLowerCase();
      if (className.includes('header') || className.includes('site-header') || className.includes('masthead')) {
        return { code: 'H', name: 'header' };
      }
      if (className.includes('nav') || className.includes('menu') || className.includes('navigation')) {
        return { code: 'N', name: 'nav' };
      }
      if (className.includes('main-content') || className.includes('content-area') || className.includes('article')) {
        return { code: 'M', name: 'main' };
      }
      if (className.includes('sidebar') || className.includes('aside') || className.includes('widget')) {
        return { code: 'A', name: 'aside' };
      }
      if (className.includes('footer') || className.includes('site-footer') || className.includes('colophon')) {
        return { code: 'F', name: 'footer' };
      }

      // Check ID
      const id = String(current.id == null ? '' : current.id).toLowerCase();
      if (id.includes('header') || id === 'masthead') return { code: 'H', name: 'header' };
      if (id.includes('nav') || id.includes('menu')) return { code: 'N', name: 'nav' };
      if (id.includes('main') || id.includes('content')) return { code: 'M', name: 'main' };
      if (id.includes('sidebar') || id.includes('aside')) return { code: 'A', name: 'aside' };
      if (id.includes('footer')) return { code: 'F', name: 'footer' };

      current = current.parentElement;
    }

    // Default to main content if no specific zone detected
    return { code: 'M', name: 'main' };
  }

  // Generate CSS selector for a link element
  function generateLinkSelector(link, index) {
    if (link.id) {
      return `#${link.id}`;
    }

    if (link.className && typeof link.className === 'string') {
      const classes = link.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (classes) {
        return `a.${classes}`;
      }
    }

    // Try to use href as identifier
    const href = link.getAttribute('href');
    if (href && href.length < 50 && !href.includes("'") && !href.includes('"')) {
      return `a[href="${href}"]`;
    }

    // Use nth-of-type
    return `a:nth-of-type(${index + 1})`;
  }

  // Content analysis
  function analyzeContent() {
    const body = document.body;
    const text = body ? body.innerText || '' : '';
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    // Count paragraphs
    const paragraphs = document.querySelectorAll('p');

    let status = 'good';
    let message = 'Sufficient content';

    if (wordCount < 100) {
      status = 'error';
      message = 'Very low content (< 100 words)';
    } else if (wordCount < 300) {
      status = 'warning';
      message = 'Low content (< 300 words)';
    }

    // Calculate word frequency (top 10) - exclude stopwords in all supported languages
    const stopwords = new Set([
      // English
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'this',
      'that', 'these', 'those', 'it', 'its', 'as', 'if', 'then', 'than',
      'so', 'such', 'no', 'not', 'only', 'own', 'same', 'into', 'also',
      'very', 'just', 'about', 'all', 'any', 'each', 'more', 'most',
      'he', 'she', 'we', 'you', 'they', 'me', 'him', 'her', 'us', 'them',
      'my', 'your', 'his', 'our', 'their', 'who', 'what', 'when', 'where',
      'how', 'why', 'which', 'some', 'many', 'much', 'few',
      // French
      'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'en', 'est',
      'que', 'qui', 'dans', 'pour', 'sur', 'avec', 'ce', 'cette', 'ces',
      'son', 'sa', 'ses', 'leur', 'leurs', 'nous', 'vous', 'ils', 'elles',
      'par', 'plus', 'pas', 'au', 'aux', 'ou', 'mais', 'donc', 'car',
      'ne', 'se', 'si', 'tout', 'votre', 'vos', 'notre', 'nos',
      'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'il', 'elle', 'on', 'je', 'tu',
      'dont', 'sans', 'sous', 'entre', 'vers', 'chez', 'aussi', 'tres',
      // German
      'der', 'die', 'das', 'ein', 'eine', 'und', 'ist', 'von', 'den',
      'dem', 'mit', 'auf', 'fur', 'für', 'nicht', 'sich', 'als', 'auch',
      'nach', 'wie', 'bei', 'noch', 'nur', 'aus', 'uber', 'über',
      'hat', 'sind', 'wird', 'oder', 'aber', 'wenn', 'dass', 'kann',
      'ich', 'du', 'wir', 'sie', 'ihr', 'mein', 'dein', 'sein', 'kein',
      // Spanish
      'del', 'los', 'las', 'una', 'con', 'por', 'para', 'como', 'mas', 'más',
      'pero', 'sus', 'sin', 'sobre', 'este', 'cuando', 'muy', 'ser',
      'hay', 'fue', 'son', 'tiene', 'esta', 'está', 'todo', 'cada',
      'el', 'ella', 'ellos', 'mi', 'tu', 'su', 'nos',
      // Italian
      'che', 'non', 'per', 'sono', 'come', 'anche', 'piu', 'più',
      'sua', 'suo', 'dal', 'nel', 'della', 'dello', 'degli', 'delle',
      'alla', 'alle', 'uno', 'tra', 'era', 'hanno', 'loro', 'essere',
      'questo', 'questa', 'ogni', 'molto', 'sempre',
      // Portuguese
      'dos', 'das', 'uma', 'sao', 'são', 'mais', 'seu', 'sua', 'mas',
      'tem', 'foi', 'nos', 'sem', 'pode', 'nao', 'não', 'voce', 'você'
    ]);

    const wordFrequency = {};
    words.forEach(word => {
      const w = word.toLowerCase().replace(/[^a-zàâäéèêëïîôùûüç0-9]/gi, '');
      if (w.length > 3 && !stopwords.has(w)) {
        wordFrequency[w] = (wordFrequency[w] || 0) + 1;
      }
    });

    const topWords = Object.entries(wordFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([word, count]) => ({
        word: word,
        count: count,
        density: wordCount > 0 ? ((count / wordCount) * 100).toFixed(2) + '%' : '0%'
      }));

    // A separate semantic text snapshot is exposed for feature modules that
    // need the page's actual content. We intentionally do NOT make popup/UI
    // text a fallback source in those modules. Prefer the largest meaningful
    // content container and remove obvious chrome such as nav/header/footer.
    let semanticText = text;
    try {
      const candidates = [...document.querySelectorAll('main, [role="main"], article, .entry-content, .post-content, .page-content, .product, .product-page, .product-detail, .collection, .collection-page')];
      let best = '';
      for (const el of candidates) {
        try {
          const clone = el.cloneNode(true);
          clone.querySelectorAll('nav,header,footer,aside,script,style,noscript,svg').forEach(n => n.remove());
          const t = (clone.innerText || '').replace(/\s+/g, ' ').trim();
          if (t.length > best.length) best = t;
        } catch (_) {}
      }
      if (best.length >= 200) semanticText = best;
    } catch (_) {}

    return {
      wordCount: wordCount,
      paragraphCount: paragraphs.length,
      averageWordsPerParagraph: paragraphs.length > 0 ? Math.round(wordCount / paragraphs.length) : 0,
      topWords: topWords,
      text: text.slice(0, 100000),
      visibleText: text.slice(0, 100000),
      mainText: semanticText.slice(0, 60000),
      ecommerceText: extractEcommerceSemanticText().slice(0, 60000),
      textLength: text.length,
      mainTextLength: semanticText.length,
      status: status,
      message: message
    };
  }

  // Improved sentence segmentation function
  function splitIntoSentences(text) {
    if (!text || typeof text !== 'string') return [];

    // First, fix merged words where lowercase is directly followed by uppercase
    // This happens when DOM elements are concatenated without spaces
    // Example: "clientNos clients" -> "client Nos clients"
    // But preserve: acronyms (iPhone, McDonald), camelCase in code
    let processed = text.replace(/([a-zàâäéèêëïîôùûüç])([A-ZÀÂÄÉÈÊËÏÎÔÙÛÜÇ][a-zàâäéèêëïîôùûüç])/g, '$1 $2');

    // Common abbreviations that shouldn't end sentences (case-insensitive matching)
    const abbreviations = [
      'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'inc', 'ltd', 'co',
      'corp', 'eg', 'ie', 'al', 'fig', 'vol', 'no', 'pp', 'ed', 'jan', 'feb', 'mar',
      'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'st', 'ave', 'blvd'
    ];

    // Protect URLs (http://, https://, www.)
    processed = processed.replace(/(https?:\/\/[^\s]+)/g, (match) => match.replace(/\./g, '<<DOT>>'));
    processed = processed.replace(/(www\.[^\s]+)/g, (match) => match.replace(/\./g, '<<DOT>>'));

    // Protect email addresses
    processed = processed.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
      (match) => match.replace(/\./g, '<<DOT>>'));

    // Protect decimal numbers (1.5, 3.14, etc.)
    processed = processed.replace(/(\d+)\.(\d+)/g, '$1<<DOT>>$2');

    // Protect common abbreviations
    abbreviations.forEach(abbr => {
      const regex = new RegExp(`\\b(${abbr})\\.`, 'gi');
      processed = processed.replace(regex, '$1<<DOT>>');
    });

    // Now split on sentence-ending punctuation
    // IMPORTANT: Handle ellipsis BEFORE protecting them
    processed = processed
      // Ellipsis followed by space(s) and uppercase = sentence break
      .replace(/\.{3,}\s+([A-ZÀ-ÖØ-Þ])/g, '...<<SPLIT>>$1')
      // Ellipsis directly followed by uppercase (no space)
      .replace(/\.{3,}([A-ZÀ-ÖØ-Þ])/g, '...<<SPLIT>>$1');

    // Now protect remaining ellipsis (mid-sentence ones)
    processed = processed.replace(/\.{3,}/g, '<<ELLIPSIS>>');

    processed = processed
      // Case 1: Punctuation + whitespace + any content
      .replace(/([.!?])\s+/g, '$1<<SPLIT>>')
      // Case 2: Punctuation + uppercase letter (no space - missing space case)
      .replace(/([.!?])([A-ZÀ-ÖØ-Þ])/g, '$1<<SPLIT>>$2')
      // Case 3: Closing quote + space + uppercase (like `." Usually` or `" Usually`)
      .replace(/(["'»\)\]])(\s+)([A-ZÀ-ÖØ-Þ])/g, '$1<<SPLIT>>$3')
      // Case 4: Punctuation inside quote followed by quote + space/uppercase
      .replace(/([.!?])(["'»\)\]])(\s*)([A-ZÀ-ÖØ-Þ])/g, '$1$2<<SPLIT>>$4')
      // Case 5: Colon followed directly by uppercase (like ":Enfin")
      .replace(/:([A-ZÀ-ÖØ-Þ])/g, ':<<SPLIT>>$1')
      // Case 6: Closing quote directly followed by uppercase (no space)
      .replace(/(["'»\)\]])([A-ZÀ-ÖØ-Þ])/g, '$1<<SPLIT>>$2');

    // Split and restore protected characters
    const sentences = processed
      .split('<<SPLIT>>')
      .map(s => s
        .replace(/<<DOT>>/g, '.')
        .replace(/<<ELLIPSIS>>/g, '...')
        .trim()
      )
      .filter(s => {
        // Filter out very short fragments and navigation-like text
        const words = s.split(/\s+/).filter(w => w.length > 0);
        return words.length >= 1 && s.length > 2;
      });

    return sentences;
  }

  // Readability analysis - Enhanced with sentence-level data
  function analyzeReadability() {
    // Extract main content text, excluding navigation elements
    const mainContentText = extractMainContentText();

    // Split into sentences with improved segmentation
    const rawSentences = splitIntoSentences(mainContentText);

    // Build detailed sentences array
    const sentencesData = [];
    const distribution = {
      very_short: 0, // 1-5 words
      short: 0,      // 6-10 words
      medium: 0,     // 11-20 words
      long: 0,       // 21-30 words
      very_long: 0   // 31+ words
    };

    let totalWords = 0;

    rawSentences.forEach((sentence, index) => {
      const text = sentence.trim();
      const words = text.split(/\s+/).filter(w => w.length > 0);
      const wordCount = words.length;
      const charCount = text.length;

      // Skip sentences that are likely navigation or UI elements
      if (wordCount === 0 || (wordCount <= 3 && charCount < 15)) {
        return;
      }

      totalWords += wordCount;

      // Categorize by word count
      let category = 'medium';
      if (wordCount <= 5) {
        category = 'very_short';
        distribution.very_short++;
      } else if (wordCount <= 10) {
        category = 'short';
        distribution.short++;
      } else if (wordCount <= 20) {
        category = 'medium';
        distribution.medium++;
      } else if (wordCount <= 30) {
        category = 'long';
        distribution.long++;
      } else {
        category = 'very_long';
        distribution.very_long++;
      }

      sentencesData.push({
        index: sentencesData.length + 1,
        text: text.substring(0, 500), // Limit text length for display
        wordCount: wordCount,
        charCount: charCount,
        category: category
      });
    });

    const sentenceCount = sentencesData.length;
    const avgSentenceLength = sentenceCount > 0 ? Math.round(totalWords / sentenceCount) : 0;

    // Calculate readability score (penalize long and very long sentences)
    let readabilityScore = 100;
    if (sentenceCount > 0) {
      const longPercent = (distribution.long / sentenceCount) * 100;
      const veryLongPercent = (distribution.very_long / sentenceCount) * 100;
      readabilityScore -= longPercent * 0.5;
      readabilityScore -= veryLongPercent * 1.5;
      readabilityScore = Math.max(0, Math.min(100, Math.round(readabilityScore)));
    }

    // Sort sentences by word count (descending) for longest sentences display
    const sortedSentences = [...sentencesData].sort((a, b) => b.wordCount - a.wordCount);

    return {
      sentenceCount: sentenceCount,
      avgSentenceLength: avgSentenceLength,
      readabilityScore: readabilityScore,
      distribution: distribution,
      sentences: sortedSentences,
      // Legacy format for backward compatibility
      sentenceLength: {
        veryShort: distribution.very_short,
        short: distribution.short,
        medium: distribution.medium,
        long: distribution.long + distribution.very_long
      }
    };
  }

  // Extract main content text, excluding header, footer, nav, aside.
  // This helper is used by multiple readability/content analyzers. Keep it
  // self-contained so one missing helper can never break the whole audit.
  function extractMainContentText() {
    if (!document.body) return '';
    const bodyClone = document.body.cloneNode(true);
    const excludeSelectors = [
      'header','footer','nav','aside','[role="banner"]','[role="navigation"]',
      '[role="complementary"]','[role="contentinfo"]','[role="menu"]','[role="menubar"]',
      '.header','.footer','.nav','.navigation','.sidebar','.menu','.breadcrumb','.breadcrumbs',
      '.cookie-banner','.cookie-notice','.advertisement','.ads','.social-share','.social-links',
      '.social-icons','.comments','.widget','.widgets','.sitemap','.site-map','.country-selector',
      '.country-list','.language-selector','.footer-links','.footer-menu','.footer-nav','.mega-menu',
      '.dropdown-menu','.sub-menu','.submenu','#header','#footer','#nav','#navigation','#sidebar',
      '#menu','#sitemap'
    ];
    excludeSelectors.forEach(selector => {
      try { bodyClone.querySelectorAll(selector).forEach(el => el.remove()); } catch (_) {}
    });
    try {
      bodyClone.querySelectorAll('script,style,noscript,svg,canvas,video,audio,iframe').forEach(el => el.remove());
    } catch (_) {}

    // Remove large link-only blocks such as mega menus and country selectors.
    try {
      bodyClone.querySelectorAll('ul,ol,div').forEach(el => {
        const links = el.querySelectorAll('a');
        const textContent = el.textContent || '';
        const words = textContent.trim().split(/\s+/).filter(Boolean);
        if (links.length > 10) {
          const linkTextLength = Array.from(links).reduce((sum, a) => sum + (a.textContent || '').length, 0);
          if (textContent.length && linkTextLength / textContent.length > 0.8) { el.remove(); return; }
        }
        if (links.length > 15 && words.length) {
          const avgWordsPerLink = words.length / links.length;
          if (avgWordsPerLink < 2.5) el.remove();
        }
      });
    } catch (_) {}

    let text = extractTextWithSpacing(bodyClone);
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function isShahzaibSEOInjectedElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const id = String(el.id == null ? '' : el.id).toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    const marker = [
      'data-rankseo', 'rankseo-', 'rankseo_', '__rankseo',
      'rs-toolbar', 'rs-score', 'rs-btn-', 'rs-sidebar',
      'rankpulse', 'seoquakemark'
    ];
    return marker.some(m => id.includes(m) || cls.includes(m)) ||
      el.hasAttribute('data-rankseo-ignore') || el.hasAttribute('data-rankseo-toolbar');
  }

  function pruneShahzaibSEONoise(root) {
    if (!root) return;
    const selectors = [
      'header','footer','nav','aside','[role="banner"]','[role="navigation"]','[role="complementary"]','[role="contentinfo"]',
      '[role="menu"]','[role="menubar"]','.breadcrumb','.breadcrumbs','.cookie-banner','.cookie-notice','.advertisement','.ads',
      '.social-share','.social-links','.social-icons','.sitemap','.site-map','.country-selector','.country-list',
      '.language-selector','.footer-links','.footer-menu','.footer-nav','.mega-menu','.dropdown-menu','.sub-menu','.submenu',
      'script','style','noscript','svg','canvas','video','audio','iframe'
    ];
    selectors.forEach(sel => { try { root.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {} });
    try { root.querySelectorAll('*').forEach(el => { if (isShahzaibSEOInjectedElement(el)) el.remove(); }); } catch (_) {}
  }

  function chooseMeaningfulContainer(docRoot, preferProduct=false) {
    const candidates = [];
    const selectors = preferProduct ? [
      '[itemtype*="Product" i]', '[data-product-id]', '[data-product]', '.product-detail', '.product-page', '.product-single',
      '.product-main', '.product-information', '.product-info', '.product-container', '.product', 'main', '[role="main"]', 'article'
    ] : [
      'main','[role="main"]','article','.entry-content','.post-content','.page-content','.collection','.collection-page',
      '.catalog','.shop-page','.product-grid','.products','section'
    ];
    selectors.forEach(sel => { try { docRoot.querySelectorAll(sel).forEach(el => candidates.push(el)); } catch (_) {} });
    let best = null, bestScore = -1;
    for (const el of candidates) {
      try {
        if (isShahzaibSEOInjectedElement(el)) continue;
        const clone = el.cloneNode(true);
        pruneShahzaibSEONoise(clone);
        const text = (clone.innerText || '').replace(/\s+/g,' ').trim();
        if (text.length < 120) continue;
        const links = clone.querySelectorAll('a').length;
        const chars = text.length;
        const linkChars = Array.from(clone.querySelectorAll('a')).reduce((n,a)=>n+(a.textContent||'').length,0);
        const linkRatio = chars ? linkChars / chars : 1;
        const headings = clone.querySelectorAll('h1,h2,h3').length;
        let score = Math.min(chars, 12000) + headings*350 - linkRatio*5000;
        if (preferProduct && clone.querySelector('[itemtype*="Product" i], [itemprop="name"], [itemprop="offers"]')) score += 2200;
        if (score > bestScore) { bestScore = score; best = text; }
      } catch (_) {}
    }
    return best || '';
  }

  function extractEcommerceSemanticText() {
    if (!document.body) return '';
    const productLike = !!document.querySelector('[itemtype*="Product" i], [itemprop="productID"], [itemprop="offers"], [data-product-id], .product-detail, .product-page');
    let text = chooseMeaningfulContainer(document, productLike);
    if (!text) {
      const clone = document.body.cloneNode(true);
      pruneShahzaibSEONoise(clone);
      text = (clone.innerText || '').replace(/\s+/g,' ').trim();
    }
    return text.slice(0, 60000);
  }

  function analyzeEcommerceSnapshot() {
    const body = document.body;
    if (!body) return { available:false };
    const semanticText = extractEcommerceSemanticText();
    const escAttr = s => String(s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"');
    const cssPath = (el) => {
      if (!el || !el.tagName) return '';
      const parts=[]; let cur=el; let guard=0;
      while (cur && cur.nodeType===1 && cur !== document.body && guard++<6) {
        let part=cur.tagName.toLowerCase();
        if (cur.id && !isShahzaibSEOInjectedElement(cur)) { part += '#'+CSS.escape(cur.id); parts.unshift(part); break; }
        const classes=Array.from(cur.classList||[]).filter(c=>c&&!/rankseo|rs-toolbar|rs-score/i.test(c)).slice(0,2);
        if(classes.length) part += '.'+classes.map(c=>CSS.escape(c)).join('.');
        const parent=cur.parentElement;
        if(parent){ const sib=[...parent.children].filter(x=>x.tagName===cur.tagName).indexOf(cur); if(sib>0) part+=`:nth-of-type(${sib+1})`; }
        parts.unshift(part); cur=parent;
      }
      return parts.join(' > ');
    };
    const visible = el => { try { const cs=getComputedStyle(el); const r=el.getBoundingClientRect(); return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0; } catch(_) { return true; } };
    const buyButtons=[];
    document.querySelectorAll('button,a,input[type="submit"],input[type="button"]').forEach((el,domIndex)=>{
      if(!visible(el) || isShahzaibSEOInjectedElement(el)) return;
      const tx=(el.innerText||el.value||el.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
      if(/\b(add to cart|add to bag|add to basket|buy now|purchase|checkout|order now|reserve|pre[- ]?order)\b/i.test(tx)) buyButtons.push({text:tx.slice(0,100),selector:cssPath(el),domIndex});
    });
    const prices=[];
    const priceSelector='[itemprop="price"], meta[property="product:price:amount"], [data-price], .price, [class*="price"]';
    document.querySelectorAll(priceSelector).forEach(el=>{
      if(!visible(el)||isShahzaibSEOInjectedElement(el))return;
      const tx=(el.getAttribute('content')||el.textContent||'').replace(/\s+/g,' ').trim();
      if(tx&&prices.length<30&&/(?:\d[\d,.]*\s?(?:PKR|SAR|AED|USD|EUR|GBP|\$|€|£)|(?:PKR|SAR|AED|USD|EUR|GBP)\s?\d)/i.test(tx)) prices.push({value:tx.slice(0,80),selector:cssPath(el)});
    });
    const availability=[];
    document.querySelectorAll('[itemprop="availability"], [class*="stock"], [class*="availability"], [data-stock]').forEach(el=>{
      if(!visible(el)||isShahzaibSEOInjectedElement(el))return;
      const tx=(el.getAttribute('content')||el.textContent||'').replace(/\s+/g,' ').trim();
      if(tx && availability.length<15 && /in stock|out of stock|available|sold out|unavailable|backorder/i.test(tx)) availability.push({value:tx.slice(0,80),selector:cssPath(el)});
    });
    const shippingNodes=[]; const returnNodes=[];
    const nodes=[...document.querySelectorAll('p,li,div,span,section')].filter(x=>visible(x)&&!isShahzaibSEOInjectedElement(x));
    for(const el of nodes){ const tx=(el.innerText||'').replace(/\s+/g,' ').trim(); if(tx.length<15||tx.length>220) continue; if(/\b(free shipping|shipping|delivery|dispatch)\b/i.test(tx)&&shippingNodes.length<8) shippingNodes.push({text:tx.slice(0,220),selector:cssPath(el)}); if(/\b(returns?|refunds?|exchange policy)\b/i.test(tx)&&returnNodes.length<8)returnNodes.push({text:tx.slice(0,220),selector:cssPath(el)}); }
    return {available:true,text:semanticText,buyButtons,prices,availability,shippingNodes,returnNodes,productLike:!!document.querySelector('[itemtype*="Product" i], [itemprop="offers"], [data-product-id], .product-detail, .product-page'),mainHeading:(document.querySelector('main h1, [role="main"] h1, h1')?.innerText||'').trim(),selectorVersion:1};
  }

  // Extract text from DOM with proper spacing between block elements
  function extractTextWithSpacing(element) {
    const blockElements = new Set([
      'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'TD', 'TH',
      'BLOCKQUOTE', 'PRE', 'ADDRESS', 'ARTICLE', 'SECTION', 'MAIN', 'FIGURE',
      'FIGCAPTION', 'DT', 'DD', 'BR', 'HR'
    ]);

    let result = '';

    function traverse(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text && text.trim()) {
          result += text;
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tagName = node.tagName;

      // Add space before block elements
      if (blockElements.has(tagName)) {
        if (result && !result.endsWith(' ') && !result.endsWith('\n')) {
          result += ' ';
        }
      }

      // Process child nodes
      for (const child of node.childNodes) {
        traverse(child);
      }

      // Add space after block elements
      if (blockElements.has(tagName)) {
        if (result && !result.endsWith(' ') && !result.endsWith('\n')) {
          result += ' ';
        }
      }
    }

    traverse(element);
    return result;
  }

  // Technical analysis
  function analyzeTechnical() {
    const results = {
      canonical: null,
      robots: null,
      language: null,
      viewport: null,
      charset: null,
      favicon: null,
      cms: null,
      techStack: null,
      lastUpdate: null,
      pageSize: null
    };

    // Canonical
    const canonical = document.querySelector('link[rel="canonical"]');
    results.canonical = {
      exists: !!canonical,
      href: canonical ? canonical.getAttribute('href') : null,
      status: canonical ? 'good' : 'warning',
      message: canonical ? 'Canonical URL defined' : 'Canonical URL missing'
    };

    // Robots
    const robots = document.querySelector('meta[name="robots"]');
    results.robots = {
      exists: !!robots,
      content: robots ? robots.getAttribute('content') : null,
      status: 'good',
      message: robots ? `Robots directive: ${robots.getAttribute('content')}` : 'No robots directive (default indexing)'
    };

    // Language
    const htmlLang = document.documentElement.getAttribute('lang');
    results.language = {
      exists: !!htmlLang,
      value: htmlLang,
      status: htmlLang ? 'good' : 'warning',
      message: htmlLang ? `Language set: ${htmlLang}` : 'Lang attribute missing on <html>'
    };

    // Viewport
    const viewport = document.querySelector('meta[name="viewport"]');
    results.viewport = {
      exists: !!viewport,
      content: viewport ? viewport.getAttribute('content') : null,
      status: viewport ? 'good' : 'error',
      message: viewport ? 'Viewport configured (mobile-friendly)' : 'Viewport missing (mobile issue)'
    };

    // Charset
    const charset = document.querySelector('meta[charset]') || document.querySelector('meta[http-equiv="Content-Type"]');
    results.charset = {
      exists: !!charset,
      value: charset ? (charset.getAttribute('charset') || charset.getAttribute('content')) : null,
      status: charset ? 'good' : 'warning',
      message: charset ? 'Encoding defined' : 'Encoding not defined'
    };

    // Favicon
    const favicon = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]') || document.querySelector('link[rel="apple-touch-icon"]');
    let faviconHref = null;
    if (favicon) {
      const rawHref = favicon.getAttribute('href');
      if (rawHref) {
        try { faviconHref = new URL(rawHref, document.baseURI).href; } catch(e) { faviconHref = rawHref; }
      }
    }
    if (!faviconHref) {
      faviconHref = new URL('/favicon.ico', location.origin).href;
    }
    results.favicon = {
      exists: !!favicon,
      href: faviconHref,
      status: favicon ? 'good' : 'warning',
      message: favicon ? 'Favicon present' : 'Favicon missing'
    };

    // CMS Detection
    results.cms = detectCMS();

    // Tech Stack Detection
    results.techStack = detectTechStack();

    // Last Update Detection
    results.lastUpdate = detectLastUpdate();

    // Page Size Calculation (for Google's 2MB crawl limit)
    results.pageSize = calculatePageSize();

    // Noindex detection
    const robotsContent = (robots ? robots.getAttribute('content') : '').toLowerCase();
    const isNoindex = robotsContent.includes('noindex');
    const isNofollow = robotsContent.includes('nofollow');
    results.indexability = {
      isNoindex: isNoindex,
      isNofollow: isNofollow,
      status: isNoindex ? 'error' : 'good',
      message: isNoindex ? 'Page blocked from indexing (noindex)' : 'Page is indexable'
    };

    // Hreflang detection
    const hreflangTags = document.querySelectorAll('link[rel="alternate"][hreflang]');
    const hreflangList = [];
    hreflangTags.forEach(tag => {
      hreflangList.push({
        lang: tag.getAttribute('hreflang'),
        href: tag.getAttribute('href')
      });
    });
    results.hreflang = {
      exists: hreflangList.length > 0,
      count: hreflangList.length,
      tags: hreflangList,
      hasSelfRef: hreflangList.some(t => {
        try { return new URL(t.href).pathname === window.location.pathname; } catch(e) { return false; }
      }),
      status: hreflangList.length > 0 ? 'good' : 'info',
      message: hreflangList.length > 0 ? `${hreflangList.length} hreflang tag(s) found` : 'No hreflang tags (single language)'
    };

    // URL analysis
    const urlPath = window.location.pathname;
    const urlLength = window.location.href.length;
    const hasTrailingSlash = urlPath.endsWith('/') && urlPath !== '/';
    const hasUppercase = /[A-Z]/.test(urlPath);
    const hasUnderscores = urlPath.includes('_');
    const urlDepth = urlPath.split('/').filter(Boolean).length;
    results.url = {
      length: urlLength,
      path: urlPath,
      depth: urlDepth,
      isLong: urlLength > 100,
      hasUppercase: hasUppercase,
      hasUnderscores: hasUnderscores,
      isHttps: window.location.protocol === 'https:',
      status: urlLength > 100 || hasUppercase ? 'warning' : 'good',
      message: urlLength > 100 ? 'URL too long (>100 chars)' : hasUppercase ? 'URL contains uppercase characters' : 'URL structure OK'
    };

    // Text-to-HTML ratio
    const bodyText = getBodyText().length;
    const bodyHtml = document.body ? (document.body.innerHTML || '').length : 0;
    const textHtmlRatio = bodyHtml > 0 ? Math.round((bodyText / bodyHtml) * 100) : 0;
    results.textHtmlRatio = {
      ratio: textHtmlRatio,
      textLength: bodyText,
      htmlLength: bodyHtml,
      status: textHtmlRatio < 10 ? 'warning' : textHtmlRatio > 70 ? 'warning' : 'good',
      message: textHtmlRatio < 10 ? 'Very low text-to-HTML ratio (<10%)' : textHtmlRatio > 70 ? 'Unusually high text-to-HTML ratio' : `Text-to-HTML ratio: ${textHtmlRatio}%`
    };

    // Duplicate title / H1 check
    const pageTitle = (document.title || '').trim().toLowerCase();
    const h1Elements = document.querySelectorAll('h1');
    const h1Text = h1Elements.length === 1 ? (h1Elements[0].textContent || '').trim().toLowerCase() : '';
    results.duplicateTitleH1 = {
      isDuplicate: pageTitle && h1Text && pageTitle === h1Text,
      title: document.title || '',
      h1: h1Elements.length === 1 ? h1Elements[0].textContent.trim() : '',
      status: (pageTitle && h1Text && pageTitle === h1Text) ? 'warning' : 'good',
      message: (pageTitle && h1Text && pageTitle === h1Text) ? 'Title and H1 are identical' : 'Title and H1 are different'
    };

    // Responsive images (srcset) detection.
    // We only count "meaningful" images (natural width > 200 px and not tiny
    // tracking pixels) so the three buckets are mutually exclusive AND their
    // sum matches `total` - i.e. the "X/Y responsive" ratio shown in the UI
    // has a consistent denominator. The DOM image count is kept separately as
    // `allImagesCount` for reference.
    const allImages = document.querySelectorAll('img');
    let withSrcset = 0;
    let withoutSrcset = 0;
    let inPicture = 0;
    let responsiveTotal = 0;
    allImages.forEach(img => {
      // Skip tracking pixels and non-meaningful images; they don't need srcset.
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (w <= 200 && h <= 200) return;
      responsiveTotal++;
      if (img.closest('picture')) {
        inPicture++;
      } else if (img.hasAttribute('srcset') || img.hasAttribute('sizes')) {
        withSrcset++;
      } else {
        withoutSrcset++;
      }
    });
    results.responsiveImages = {
      withSrcset: withSrcset,
      withoutSrcset: withoutSrcset,
      inPicture: inPicture,
      total: responsiveTotal,
      allImagesCount: allImages.length,
      status: withoutSrcset > 3 ? 'warning' : 'good',
      message: withoutSrcset > 0 ? `${withoutSrcset} image(s) without srcset` : 'All images are responsive'
    };

    // Tracking Pixels & Analytics detection
    results.trackingPixels = analyzeTrackingPixels();

    return results;
  }

  // Detect tracking pixels, analytics tools, and marketing tags with details
  // NOTE: Content scripts run in an isolated world (MV3) - window.* globals
  // from page scripts are NOT accessible. Detection relies on DOM queries,
  // HTML string matching, cookies, and noscript beacons only.
  function analyzeTrackingPixels() {
    const html = getOuterHTML();
    const cookies = document.cookie || '';
    const pixels = [];

    // Helper: extract ID from script/meta content
    function extractFromHtml(regex) {
      const match = html.match(regex);
      return match ? match[1] : null;
    }

    function extractMetaContent(name) {
      const meta = document.querySelector(`meta[name="${name}"]`);
      return meta ? meta.getAttribute('content') : null;
    }

    function hasCookie(pattern) {
      return pattern.test(cookies);
    }

    function hasScript(srcPattern) {
      return !!document.querySelector(`script[src*="${srcPattern}"]`);
    }

    function hasNoscriptPixel(srcPattern) {
      const noscripts = document.querySelectorAll('noscript');
      for (const ns of noscripts) {
        if (ns.innerHTML.includes(srcPattern)) return true;
      }
      return false;
    }

    // --- ANALYTICS ---

    // Google Analytics (GA4 / gtag.js / analytics.js)
    const gaId = extractFromHtml(/gtag\(['"]config['"]\s*,\s*['"]([A-Z0-9-]+)['"]/i) || extractFromHtml(/(G-[A-Z0-9]{6,}|UA-\d+-\d+)/);
    if (hasScript('googletagmanager.com/gtag') || hasScript('google-analytics.com') || hasCookie(/_ga=/) || html.includes('google-analytics.com/analytics.js')) {
      pixels.push({ name: 'Google Analytics', category: 'analytics', id: gaId || '', icon: '📊', color: '#E37400' });
    }

    // Google Tag Manager
    const gtmId = extractFromHtml(/googletagmanager\.com\/[a-z]+\.js\?id=(GTM-[A-Z0-9]+)/i);
    if (hasScript('googletagmanager.com/gtm.js') || html.includes('googletagmanager.com/ns.html')) {
      pixels.push({ name: 'Google Tag Manager', category: 'tag_manager', id: gtmId || '', icon: '🏷️', color: '#4285F4' });
    }

    // Google Search Console (site verification)
    const gscContent = extractMetaContent('google-site-verification');
    if (gscContent) {
      pixels.push({ name: 'Google Search Console', category: 'seo', id: gscContent, icon: '🔍', color: '#4285F4' });
    }

    // Google Ads conversion tracking
    const gAdsId = extractFromHtml(/['"](?:AW-[A-Z0-9]+)['"]/);
    if (html.includes('googleads.g.doubleclick.net') || html.includes('googleadservices.com') || hasScript('pagead2.googlesyndication.com') || hasCookie(/_gcl_aw=/)) {
      pixels.push({ name: 'Google Ads', category: 'advertising', id: gAdsId || '', icon: '📢', color: '#FBBC04' });
    }

    // Meta/Facebook Pixel
    const fbPixelId = extractFromHtml(/fbq\(['"]init['"],\s*['"](\d+)['"]/);
    if (hasScript('connect.facebook.net') || html.includes('fbq(') || hasNoscriptPixel('facebook.com/tr') || hasCookie(/_fbp=/)) {
      pixels.push({ name: 'Meta Pixel', category: 'advertising', id: fbPixelId || '', icon: '📘', color: '#1877F2' });
    }

    // TikTok Pixel
    const ttId = extractFromHtml(/ttq\.load\(['"]([A-Z0-9]+)['"]/i);
    if (hasScript('analytics.tiktok.com') || html.includes('ttq.load(') || hasCookie(/_ttp=/)) {
      pixels.push({ name: 'TikTok Pixel', category: 'advertising', id: ttId || '', icon: '🎵', color: '#000000' });
    }

    // LinkedIn Insight Tag
    const liId = extractFromHtml(/_linkedin_partner_id\s*=\s*['"](\d+)['"]/);
    if (hasScript('snap.licdn.com') || html.includes('linkedin.com/px') || hasNoscriptPixel('px.ads.linkedin.com') || hasCookie(/li_fat_id=/)) {
      pixels.push({ name: 'LinkedIn Insight', category: 'advertising', id: liId || '', icon: '💼', color: '#0A66C2' });
    }

    // Twitter/X Pixel
    const twId = extractFromHtml(/twq\(['"]init['"],\s*['"]([a-z0-9]+)['"]/i);
    if (hasScript('static.ads-twitter.com') || html.includes('twq(') || hasNoscriptPixel('t.co/i/adsct')) {
      pixels.push({ name: 'Twitter/X Pixel', category: 'advertising', id: twId || '', icon: '🐦', color: '#1DA1F2' });
    }

    // Pinterest Tag
    const pinId = extractFromHtml(/pintrk\(['"]load['"],\s*['"](\d+)['"]/);
    if (hasScript('pintrk') || hasScript('ct.pinterest.com') || html.includes('pintrk(') || hasNoscriptPixel('ct.pinterest.com')) {
      pixels.push({ name: 'Pinterest Tag', category: 'advertising', id: pinId || '', icon: '📌', color: '#E60023' });
    }

    // Snapchat Pixel
    const snapId = extractFromHtml(/snaptr\(['"]init['"],\s*['"]([a-f0-9-]+)['"]/i);
    if (hasScript('sc-static.net') || html.includes('snaptr(') || hasNoscriptPixel('tr.snapchat.com')) {
      pixels.push({ name: 'Snapchat Pixel', category: 'advertising', id: snapId || '', icon: '👻', color: '#FFFC00' });
    }

    // Matomo / Piwik
    const matomoUrl = extractFromHtml(/['"](https?:\/\/[^'"]*matomo[^'"]*)['"]/i) || extractFromHtml(/['"](https?:\/\/[^'"]*piwik[^'"]*)['"]/i);
    if (hasScript('matomo') || hasScript('piwik') || html.includes('_paq.push') || hasCookie(/_pk_id=/)) {
      pixels.push({ name: 'Matomo', category: 'analytics', id: matomoUrl || '', icon: '📈', color: '#3152A0' });
    }

    // Hotjar
    const hjId = extractFromHtml(/hotjar\.com.*?(\d{6,})/);
    if (hasScript('static.hotjar.com') || hasCookie(/_hj/) || html.includes('hj(')) {
      pixels.push({ name: 'Hotjar', category: 'analytics', id: hjId || '', icon: '🔥', color: '#FD3A5C' });
    }

    // Microsoft Clarity
    const clarityId = extractFromHtml(/clarity\.ms\/tag\/([a-z0-9]+)/i);
    if (hasScript('clarity.ms') || hasCookie(/_clck=/) || hasCookie(/_clsk=/)) {
      pixels.push({ name: 'Microsoft Clarity', category: 'analytics', id: clarityId || '', icon: '🔬', color: '#0078D4' });
    }

    // Plausible
    const plausibleEl = document.querySelector('script[data-domain][src*="plausible"]');
    if (plausibleEl || hasScript('plausible.io')) {
      pixels.push({ name: 'Plausible', category: 'analytics', id: plausibleEl?.getAttribute('data-domain') || '', icon: '🌿', color: '#5850EC' });
    }

    // Umami
    const umamiEl = document.querySelector('script[data-website-id][src*="umami"]');
    if (umamiEl || hasScript('umami.is')) {
      pixels.push({ name: 'Umami', category: 'analytics', id: umamiEl?.getAttribute('data-website-id') || '', icon: '🍙', color: '#000000' });
    }

    // Fathom (specific pattern to avoid matching the English word "fathom")
    const fathomEl = document.querySelector('script[data-site][src*="usefathom"]');
    if (fathomEl || hasScript('cdn.usefathom.com')) {
      pixels.push({ name: 'Fathom', category: 'analytics', id: fathomEl?.getAttribute('data-site') || '', icon: '🐟', color: '#9187FF' });
    }

    // Mixpanel
    const mixpanelToken = extractFromHtml(/mixpanel\.init\(['"]([a-f0-9]+)['"]/i);
    if (hasScript('mixpanel.com') || html.includes('mixpanel.init(') || hasCookie(/mp_.*_mixpanel=/)) {
      pixels.push({ name: 'Mixpanel', category: 'analytics', id: mixpanelToken || '', icon: '🔮', color: '#7856FF' });
    }

    // Segment (specific script src to avoid false positives)
    if (hasScript('cdn.segment.com') || hasScript('cdn.segment.io') || html.includes('analytics.load(')) {
      pixels.push({ name: 'Segment', category: 'analytics', id: '', icon: '🟢', color: '#52BD95' });
    }

    // Amplitude
    if (hasScript('cdn.amplitude.com') || html.includes('amplitude.getInstance(') || hasCookie(/amp_/)) {
      pixels.push({ name: 'Amplitude', category: 'analytics', id: '', icon: '📉', color: '#1E61E4' });
    }

    // Heap
    if (hasScript('heap-analytics.com') || hasScript('heapanalytics.com') || html.includes('heap.load(')) {
      pixels.push({ name: 'Heap', category: 'analytics', id: '', icon: '📦', color: '#FF6D3B' });
    }

    // PostHog
    if (hasScript('posthog.com') || hasScript('app.posthog.com') || html.includes('posthog.init(') || hasCookie(/ph_/)) {
      pixels.push({ name: 'PostHog', category: 'analytics', id: '', icon: '🦔', color: '#F9BD2B' });
    }

    // Adobe Analytics
    if (html.includes('omtrdc.net') || hasScript('adobedtm.com') || html.includes('AppMeasurement') || html.includes('s_code') || hasCookie(/s_vi=/)) {
      pixels.push({ name: 'Adobe Analytics', category: 'analytics', id: '', icon: '🅰️', color: '#FF0000' });
    }

    // --- CHAT & SUPPORT ---

    // HubSpot
    const hsId = extractFromHtml(/js\.hs-scripts\.com\/(\d+)/);
    if (hasScript('hs-scripts.com') || hasScript('js.hubspot.com') || hasCookie(/hubspotutk=/) || hasCookie(/__hstc=/)) {
      pixels.push({ name: 'HubSpot', category: 'marketing', id: hsId || '', icon: '🧡', color: '#FF7A59' });
    }

    // Intercom
    const intercomId = extractFromHtml(/app_id:\s*['"]([a-z0-9]+)['"]/i);
    if (hasScript('widget.intercom.io') || hasScript('intercom.io') || document.getElementById('intercom-container') || html.includes('Intercom(')) {
      pixels.push({ name: 'Intercom', category: 'support', id: intercomId || '', icon: '💬', color: '#6AFDEF' });
    }

    // Crisp
    const crispId = extractFromHtml(/CRISP_WEBSITE_ID\s*=\s*['"]([a-f0-9-]+)['"]/i);
    if (hasScript('crisp.chat') || document.getElementById('crisp-chatbox') || html.includes('CRISP_WEBSITE_ID')) {
      pixels.push({ name: 'Crisp', category: 'support', id: crispId || '', icon: '💭', color: '#4B5CCC' });
    }

    // Zendesk
    if (hasScript('static.zdassets.com') || hasScript('zendesk.com') || document.getElementById('launcher')) {
      pixels.push({ name: 'Zendesk', category: 'support', id: '', icon: '🎧', color: '#03363D' });
    }

    // Drift
    if (hasScript('js.driftt.com') || document.getElementById('drift-widget') || html.includes('drift.load(')) {
      pixels.push({ name: 'Drift', category: 'support', id: '', icon: '🤖', color: '#0176FF' });
    }

    // --- SEO VERIFICATION ---

    // Bing Webmaster Tools
    const bingVerif = extractMetaContent('msvalidate.01');
    if (bingVerif) {
      pixels.push({ name: 'Bing Webmaster', category: 'seo', id: bingVerif, icon: '🅱️', color: '#008373' });
    }

    // Yandex Webmaster
    const yandexVerif = extractMetaContent('yandex-verification');
    if (yandexVerif) {
      pixels.push({ name: 'Yandex Webmaster', category: 'seo', id: yandexVerif, icon: '🔴', color: '#FF0000' });
    }

    // Pinterest verification
    const pinterestVerif = extractMetaContent('p:domain_verify');
    if (pinterestVerif) {
      pixels.push({ name: 'Pinterest Verify', category: 'seo', id: pinterestVerif, icon: '📌', color: '#E60023' });
    }

    // Facebook domain verification
    const fbVerif = extractMetaContent('facebook-domain-verification');
    if (fbVerif) {
      pixels.push({ name: 'Facebook Verify', category: 'seo', id: fbVerif, icon: '📘', color: '#1877F2' });
    }

    // Categorize results
    const categories = {};
    pixels.forEach(p => {
      if (!categories[p.category]) categories[p.category] = [];
      categories[p.category].push(p);
    });

    return {
      total: pixels.length,
      pixels: pixels,
      categories: categories,
      hasAnalytics: pixels.some(p => p.category === 'analytics'),
      hasAdvertising: pixels.some(p => p.category === 'advertising'),
      hasTagManager: pixels.some(p => p.category === 'tag_manager')
    };
  }

  // Cache outerHTML to avoid serializing the entire DOM multiple times
  let _cachedOuterHTML = null;
  function getOuterHTML() {
    if (_cachedOuterHTML === null) {
      _cachedOuterHTML = document.documentElement.outerHTML;
    }
    return _cachedOuterHTML;
  }

  // Cache body innerText - accessing it forces a full DOM traversal + layout
  // calc. Without caching, 10+ analyzers each re-serialise the entire visible
  // text, blocking the main thread for hundreds of ms on large pages.
  let _cachedBodyText = null;
  function getBodyText() {
    if (_cachedBodyText === null) {
      _cachedBodyText = document.body ? (document.body.innerText || '') : '';
    }
    return _cachedBodyText;
  }

  // Cache Performance API resource entries - called by both analyzeImages and
  // detectImageFormat, and can contain 100+ entries on resource-heavy pages.
  let _cachedResourceEntries = null;
  function getResourceEntries() {
    if (_cachedResourceEntries === null) {
      try { _cachedResourceEntries = performance.getEntriesByType('resource'); }
      catch (e) { _cachedResourceEntries = []; }
    }
    return _cachedResourceEntries;
  }

  // Helper: check if any script/link/meta src/href contains a substring
  function domContains(substring) {
    return !!(document.querySelector(`script[src*="${substring}"]`) ||
              document.querySelector(`link[href*="${substring}"]`) ||
              document.querySelector(`img[src*="${substring}"]`));
  }

  // Detect CMS
  function detectCMS() {
    const detectedCMS = [];
    const html = getOuterHTML();
    const htmlLower = html.toLowerCase();
    const generator = (document.querySelector('meta[name="generator"]')?.getAttribute('content') || '').toLowerCase();

    // ── Traditional CMS / builders ──────────────────────────────────────
    // WordPress — STRICT: require real WP asset paths or generator (avoid false positives)
    const wpPathHit = !!(
      document.querySelector('link[href*="/wp-content/"], link[href*="/wp-includes/"], script[src*="/wp-content/"], script[src*="/wp-includes/"]') ||
      document.querySelector('img[src*="/wp-content/"], img[src*="/wp-includes/"]') ||
      document.querySelector('#wpadminbar, link#wp-block-library-css, link#wp-emoji-styles-css, script#wp-emoji-release-js')
    );
    const wpGenerator = /wordpress/i.test(generator);
    const wpJsonLink = !!(document.querySelector('link[rel="https://api.w.org/"], link[href*="/wp-json/"]'));
    // Only use raw HTML path match if it looks like an actual URL path (not random text)
    const wpHtmlPath = /(?:src|href)=["'][^"']*\/wp-content\//i.test(html) ||
                       /(?:src|href)=["'][^"']*\/wp-includes\//i.test(html);
    if (wpPathHit || wpGenerator || wpJsonLink || wpHtmlPath) {
      detectedCMS.push('WordPress');
    }

    // Shopify
    if (
      domContains('cdn.shopify.com') ||
      document.querySelector('meta[name="shopify-checkout-api-token"], meta[name="shopify-digital-wallet"]') ||
      html.includes('Shopify.shop') || html.includes('Shopify.theme') ||
      document.querySelector('script[src*="shopify"]') ||
      /shopify/i.test(generator)
    ) {
      detectedCMS.push('Shopify');
    }

    // Wix
    if (domContains('wix.com') || domContains('wixstatic.com') || /wix/i.test(generator) ||
        document.querySelector('meta[http-equiv="X-Wix-Meta-Site-Id"], meta[name="generator"][content*="Wix"]')) {
      detectedCMS.push('Wix');
    }

    // Squarespace
    if (domContains('squarespace.com') || domContains('static.squarespace') || /squarespace/i.test(generator)) {
      detectedCMS.push('Squarespace');
    }

    // Webflow
    if (domContains('webflow.com') || document.querySelector('html[data-wf-site], html[data-wf-page]')) {
      detectedCMS.push('Webflow');
    }

    // Drupal
    if (/drupal/i.test(generator) || domContains('drupal') ||
        document.querySelector('script[src*="drupal"], link[href*="/sites/default/files"]') ||
        htmlLower.includes('drupal.settings')) {
      detectedCMS.push('Drupal');
    }

    // Joomla
    if (/joomla/i.test(generator) || domContains('/media/jui/') || htmlLower.includes('/components/com_')) {
      detectedCMS.push('Joomla');
    }

    // Magento — STRICT (do not match random "mage" substrings or body.cms-home alone)
    if (
      /magento/i.test(generator) ||
      document.querySelector('script[src*="/static/version"][src*="Magento_"], script[src*="/mage/requirejs"]') ||
      (htmlLower.includes('mage/cookies') && (htmlLower.includes('magento') || htmlLower.includes('/static/version'))) ||
      /(?:src|href)=["'][^"']*\/static\/version\d+\/frontend\//i.test(html)
    ) {
      detectedCMS.push('Magento');
    }

    // PrestaShop
    if (domContains('prestashop') || /prestashop/i.test(generator) ||
        document.querySelector('meta[name="generator"][content*="PrestaShop"]')) {
      detectedCMS.push('PrestaShop');
    }

    // Ghost — STRICT
    if (/ghost/i.test(generator) ||
        document.querySelector('script[src*="/ghost/"], link[href*="/ghost/"]') ||
        htmlLower.includes('__ghost_')) {
      detectedCMS.push('Ghost');
    }

    // Framer
    if (domContains('framer.com') || domContains('framerusercontent.com') || document.querySelector('[data-framer-component-type]')) {
      detectedCMS.push('Framer');
    }

    // HubSpot
    if (domContains('hubspot') || domContains('hs-scripts.com') || document.querySelector('script[src*="hs-scripts"]')) {
      detectedCMS.push('HubSpot');
    }

    // Blogger / Blogspot
    if (domContains('blogger.com') || domContains('blogspot.') || /blogger/i.test(generator)) {
      detectedCMS.push('Blogger');
    }

    // Bitrix
    if (domContains('bitrix') || htmlLower.includes('/bitrix/')) detectedCMS.push('Bitrix');

    // OpenCart
    if (domContains('opencart') || htmlLower.includes('route=common/home')) detectedCMS.push('OpenCart');

    // BigCommerce
    if (domContains('bigcommerce') || document.querySelector('script[src*="bigcommerce"]')) detectedCMS.push('BigCommerce');

    // AI / no-code builders
    if (html.includes('lovable.dev') || html.includes('lovable.app') || /lovable/i.test(generator)) detectedCMS.push('Lovable');
    if (html.includes('bolt.new') || html.includes('stackblitz')) detectedCMS.push('Bolt.new');
    if (html.includes('v0.dev') || html.includes('v0-') || document.querySelector('meta[content*="v0"]')) detectedCMS.push('v0 by Vercel');
    if (html.includes('cursor.sh') || html.includes('cursor.com')) detectedCMS.push('Cursor');
    if (html.includes('replit.com') || html.includes('replit.app')) detectedCMS.push('Replit');
    if (html.includes('durable.co') || /durable/i.test(generator)) detectedCMS.push('Durable AI');
    if (html.includes('10web.io') || /10web/i.test(generator)) detectedCMS.push('10Web AI');
    if (html.includes('hostinger.com/ai') || /hostinger/i.test(generator)) detectedCMS.push('Hostinger AI');
    if (html.includes('zyro.com') || /zyro/i.test(generator)) detectedCMS.push('Zyro');
    if (html.includes('jimdo.com') || /jimdo/i.test(generator)) detectedCMS.push('Jimdo');
    if (html.includes('site123.com') || /site123/i.test(generator)) detectedCMS.push('SITE123');
    if (html.includes('strikingly.com') || /strikingly/i.test(generator)) detectedCMS.push('Strikingly');
    if (html.includes('carrd.co')) detectedCMS.push('Carrd');
    if (html.includes('notion.site') || html.includes('super.so')) detectedCMS.push('Notion Site');
    if (html.includes('typedream.com') || /typedream/i.test(generator)) detectedCMS.push('Typedream');
    if (html.includes('softr.io') || /softr/i.test(generator)) detectedCMS.push('Softr');
    if (html.includes('bubble.io')) detectedCMS.push('Bubble');
    if (html.includes('webstudio.is')) detectedCMS.push('Webstudio');

    // ── JS frameworks / custom code (only if no traditional CMS) ────────
    if (detectedCMS.length === 0) {
      // Next.js — strong path / data markers
      const isNext = !!(
        document.querySelector('#__next, script#__NEXT_DATA__, [data-next-head-count]') ||
        document.querySelector('script[src*="/_next/"], link[href*="/_next/"], link[rel="preload"][href*="/_next/"]') ||
        /__NEXT_DATA__|\/_next\/static\//i.test(html) ||
        document.querySelector('meta[name="next-head-count"]')
      );
      if (isNext) detectedCMS.push('Next.js');

      // Nuxt
      if (document.querySelector('#__nuxt, #__NUXT__') || /__NUXT__|\/_nuxt\//i.test(html) ||
          document.querySelector('script[src*="/_nuxt/"]')) {
        detectedCMS.push('Nuxt.js');
      }
      // Gatsby
      if (document.querySelector('#___gatsby') || htmlLower.includes('gatsby-focus-wrapper') ||
          document.querySelector('script[src*="gatsby"]')) {
        detectedCMS.push('Gatsby');
      }
      // Remix
      if (/__remixContext|__remix/i.test(html) || document.querySelector('script[src*="remix"]')) {
        detectedCMS.push('Remix');
      }
      // Astro
      if (document.querySelector('astro-island, [data-astro-cid]') || htmlLower.includes('astro-island')) {
        detectedCMS.push('Astro');
      }
      // SvelteKit
      if (/__sveltekit/i.test(html) || document.querySelector('script[src*="svelte"][src*="kit"]')) {
        detectedCMS.push('SvelteKit');
      }

      // Vite build fingerprint: /assets/index-<hash>.js + type=module (common for React/Vue SPAs)
      const viteScript = document.querySelector(
        'script[type="module"][src*="/assets/index-"], script[type="module"][src*="/assets/index."], ' +
        'script[type="module"][crossorigin][src*="/assets/"]'
      );
      const hasViteAssets = !!(viteScript ||
        /(?:src|href)=["'][^"']*\/assets\/index-[A-Za-z0-9_-]+\.(?:js|css)/i.test(html));

      // CRA / generic React shell
      const hasReactRoot = !!(
        document.querySelector('#root, #app, [data-reactroot], [data-reactid]') ||
        document.querySelector('script[src*="react.production"], script[src*="react.development"], script[src*="/react.min"]')
      );

      // React (SPA without Next/Gatsby/Remix)
      if (
        !detectedCMS.includes('Next.js') && !detectedCMS.includes('Gatsby') && !detectedCMS.includes('Remix') &&
        (document.querySelector('[data-reactroot], [data-reactid]') ||
          document.querySelector('script[src*="react.production"], script[src*="react.development"], script[src*="/react."]'))
      ) {
        detectedCMS.push('React');
      } else if (
        !detectedCMS.includes('Next.js') && !detectedCMS.includes('Gatsby') && !detectedCMS.includes('Remix') &&
        !detectedCMS.includes('Nuxt.js') && !detectedCMS.includes('Vue.js') &&
        hasViteAssets && hasReactRoot
      ) {
        // Vite + #root is almost always a React SPA (e.g. attockjewellers.com.pk)
        detectedCMS.push('React');
        detectedCMS.push('Vite');
      } else if (hasViteAssets && !detectedCMS.length) {
        detectedCMS.push('Vite');
      }

      // Vue — strict
      if (
        !detectedCMS.includes('Nuxt.js') &&
        (document.querySelector('[data-v-app]') ||
          document.querySelector('script[src*="vue.global"], script[src*="vue.runtime"], script[src*="/vue."]'))
      ) {
        detectedCMS.push('Vue.js');
      }
      // Angular
      if (document.querySelector('[ng-version], app-root') || htmlLower.includes('ng-version')) {
        detectedCMS.push('Angular');
      }
      // Laravel (often custom PHP)
      if (document.querySelector('meta[name="csrf-token"]') &&
          (htmlLower.includes('laravel') || document.querySelector('script[src*="laravel"]'))) {
        detectedCMS.push('Laravel');
      }
      // Static / Custom HTML
      if (detectedCMS.length === 0) {
        detectedCMS.push('Custom HTML');
      }
    }

    // de-dupe preserve order
    const seen = new Set();
    const unique = detectedCMS.filter(n => {
      const k = String(n == null ? '' : n).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return {
      detected: unique.length > 0 && unique[0] !== 'Custom HTML',
      name: unique[0] || null,
      all: unique,
      isCustom: unique[0] === 'Custom HTML'
    };
  }

  // Detect Tech Stack
  // NOTE: Content scripts run in isolated world (MV3) - window.* globals
  // from page scripts are NOT accessible. Use DOM queries and HTML matching only.
  // Tech stack detection powered by the Wappalyzer / WebAppAnalyzer
  // fingerprint database (libs/wappalyzer-fingerprints.js, loaded before
  // this script by the manifest). Detects ~3500 technologies via:
  //   1. <script src> matching (fastest - one querySelectorAll pass)
  //   2. <meta> tag matching (fast - one querySelectorAll pass)
  //   3. DOM selector matching (fast - one querySelector per tech)
  //   4. Cookie matching (fast - one string parse)
  //   5. HTML pattern matching (slower - only for techs with no other method)
  function detectTechStack() {
    const detected = new Set();
    const detectedWithCats = [];

    // Bail out if fingerprints not loaded
    if (typeof WAPPALYZER_FINGERPRINTS === 'undefined') {
      return { detected: false, list: [], summary: '' };
    }
    const FP = WAPPALYZER_FINGERPRINTS;

    // --- Pre-collect page signals (one pass each) ---
    const scriptSrcs = [];
    document.querySelectorAll('script[src]').forEach(s => {
      scriptSrcs.push((s.getAttribute('src') || '').toLowerCase());
    });

    const metaTags = {};
    document.querySelectorAll('meta[name], meta[property]').forEach(m => {
      const name = (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase();
      if (name) metaTags[name] = (m.getAttribute('content') || '');
    });

    const cookies = document.cookie || '';
    const cookieNames = cookies.split(';').map(c => c.trim().split('=')[0]);

    // Only load outerHTML for html-pattern techs (cached by getOuterHTML)
    let html = null;
    const getHtml = () => { if (html === null) html = getOuterHTML(); return html; };

    // --- Match each tech ---
    for (const [name, fp] of Object.entries(FP)) {
      if (detected.has(name)) continue;
      let matched = false;

      // 1. scriptSrc: check if any <script src> matches any pattern
      if (!matched && fp.scriptSrc) {
        for (const pattern of fp.scriptSrc) {
          try {
            // Simple substring for short patterns, regex for complex ones
            if (pattern.length < 4) continue;
            if (pattern.includes('(') || pattern.includes('[') || pattern.includes('\\')) {
              const re = new RegExp(pattern, 'i');
              if (scriptSrcs.some(src => re.test(src))) { matched = true; break; }
            } else {
              const p = pattern.toLowerCase();
              if (scriptSrcs.some(src => src.includes(p))) { matched = true; break; }
            }
          } catch (e) { /* invalid regex, skip */ }
        }
      }

      // 2. meta tags
      if (!matched && fp.meta) {
        for (const [metaName, pattern] of Object.entries(fp.meta)) {
          const content = metaTags[metaName.toLowerCase()];
          if (content !== undefined) {
            if (!pattern || pattern === '') { matched = true; break; }
            try {
              if (new RegExp(pattern, 'i').test(content)) { matched = true; break; }
            } catch (e) {}
          }
        }
      }

      // 3. DOM selectors
      if (!matched && fp.dom) {
        for (const selector of fp.dom) {
          try {
            if (document.querySelector(selector)) { matched = true; break; }
          } catch (e) { /* invalid selector */ }
        }
      }

      // 4. Cookies
      if (!matched && fp.cookies) {
        for (const cookiePattern of fp.cookies) {
          try {
            if (cookiePattern.includes('(') || cookiePattern.includes('[')) {
              const re = new RegExp(cookiePattern, 'i');
              if (cookieNames.some(c => re.test(c))) { matched = true; break; }
            } else {
              if (cookieNames.some(c => c === cookiePattern)) { matched = true; break; }
            }
          } catch (e) {}
        }
      }

      // 5. HTML patterns (last resort - expensive)
      if (!matched && fp.html) {
        const h = getHtml();
        for (const pattern of fp.html) {
          try {
            if (new RegExp(pattern, 'i').test(h)) { matched = true; break; }
          } catch (e) {}
        }
      }

      if (matched) {
        detected.add(name);
        detectedWithCats.push({ name, cats: fp.cats || [], w: fp.w || '' });

        // Resolve implies
        if (fp.implies) {
          for (const implied of fp.implies) {
            if (!detected.has(implied)) {
              detected.add(implied);
              const impliedFp = FP[implied];
              detectedWithCats.push({ name: implied, cats: impliedFp?.cats || [], w: impliedFp?.w || '' });
            }
          }
        }
      }
    }

    const list = [...detected].sort();
    return {
      detected: list.length > 0,
      list: list,
      detailedList: detectedWithCats,
      summary: list.slice(0, 3).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '')
    };
  }

  // Detect Last Update
  function detectLastUpdate() {
    let lastModified = null;

    // Check meta tags for date
    const dateSelectors = [
      'meta[property="article:modified_time"]',
      'meta[property="og:updated_time"]',
      'meta[name="last-modified"]',
      'meta[name="date"]',
      'meta[property="article:published_time"]',
      'meta[name="DC.date.modified"]',
      'meta[itemprop="dateModified"]'
    ];

    for (const selector of dateSelectors) {
      const meta = document.querySelector(selector);
      if (meta) {
        const content = meta.getAttribute('content');
        if (content) {
          try {
            const date = new Date(content);
            if (!isNaN(date.getTime())) {
              lastModified = date;
              break;
            }
          } catch (e) {}
        }
      }
    }

    // Check time elements
    if (!lastModified) {
      const timeElements = document.querySelectorAll('time[datetime]');
      for (const time of timeElements) {
        const datetime = time.getAttribute('datetime');
        if (datetime) {
          try {
            const date = new Date(datetime);
            if (!isNaN(date.getTime())) {
              lastModified = date;
              break;
            }
          } catch (e) {}
        }
      }
    }

    // Check JSON-LD for dateModified
    if (!lastModified) {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          const dateStr = data.dateModified || data.datePublished;
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              lastModified = date;
              break;
            }
          }
        } catch (e) {}
      }
    }

    if (lastModified) {
      const now = new Date();
      const diffDays = Math.floor((now - lastModified) / (1000 * 60 * 60 * 24));

      let formattedDate;
      if (diffDays === 0) {
        formattedDate = 'Today';
      } else if (diffDays === 1) {
        formattedDate = 'Yesterday';
      } else if (diffDays < 7) {
        formattedDate = `${diffDays} days ago`;
      } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        formattedDate = `${weeks} week${weeks > 1 ? 's' : ''} ago`;
      } else if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        formattedDate = `${months} month${months > 1 ? 's' : ''} ago`;
      } else {
        const years = Math.floor(diffDays / 365);
        formattedDate = `${years} year${years > 1 ? 's' : ''} ago`;
      }

      return {
        detected: true,
        date: lastModified.toISOString(),
        formatted: formattedDate,
        daysAgo: diffDays
      };
    }

    return {
      detected: false,
      date: null,
      formatted: null,
      daysAgo: null
    };
  }

  // Calculate Page Size (HTML) for Google's 2MB crawl limit
  function calculatePageSize() {
    // Get the full HTML content
    const html = getOuterHTML();

    // Calculate size in bytes (using TextEncoder for accurate UTF-8 byte count)
    const encoder = new TextEncoder();
    const bytes = encoder.encode(html).length;

    // Google's limit is 2MB (2,097,152 bytes)
    const limitBytes = 2 * 1024 * 1024; // 2MB
    const warningThreshold = 1.5 * 1024 * 1024; // 1.5MB warning

    // Format size for display
    let formatted;
    let unit;
    if (bytes >= 1024 * 1024) {
      formatted = (bytes / (1024 * 1024)).toFixed(2);
      unit = 'MB';
    } else if (bytes >= 1024) {
      formatted = (bytes / 1024).toFixed(1);
      unit = 'KB';
    } else {
      formatted = bytes;
      unit = 'B';
    }

    // Determine status
    let status, message;
    const percentage = (bytes / limitBytes) * 100;

    if (bytes >= limitBytes) {
      status = 'error';
      message = `HTML exceeds Google's 2MB limit! Content may be truncated during indexing.`;
    } else if (bytes >= warningThreshold) {
      status = 'warning';
      message = `HTML approaching Google's 2MB limit (${percentage.toFixed(0)}% used). Consider optimization.`;
    } else {
      status = 'good';
      message = `HTML size is within Google's 2MB limit (${percentage.toFixed(1)}% used).`;
    }

    return {
      bytes: bytes,
      formatted: `${formatted} ${unit}`,
      formattedShort: formatted,
      unit: unit,
      percentage: percentage,
      limit: limitBytes,
      limitFormatted: '2 MB',
      status: status,
      message: message,
      isOverLimit: bytes >= limitBytes,
      isWarning: bytes >= warningThreshold && bytes < limitBytes
    };
  }

  // Social tags analysis (Open Graph, Twitter)
  function analyzeSocialTags() {
    const og = {};
    const twitter = {};

    // Open Graph - comprehensive extraction
    document.querySelectorAll('meta[property^="og:"]').forEach(meta => {
      const property = (meta.getAttribute('property') || '').replace('og:', '');
      og[property] = meta.getAttribute('content');
    });

    // Also check for OG tags with name attribute (some sites use this incorrectly)
    document.querySelectorAll('meta[name^="og:"]').forEach(meta => {
      const property = (meta.getAttribute('name') || '').replace('og:', '');
      if (!og[property]) {
        og[property] = meta.getAttribute('content');
      }
    });

    // Twitter Cards - comprehensive extraction
    document.querySelectorAll('meta[name^="twitter:"]').forEach(meta => {
      const name = (meta.getAttribute('name') || '').replace('twitter:', '');
      twitter[name] = meta.getAttribute('content');
    });

    // Also check property attribute for Twitter
    document.querySelectorAll('meta[property^="twitter:"]').forEach(meta => {
      const name = (meta.getAttribute('property') || '').replace('twitter:', '');
      if (!twitter[name]) {
        twitter[name] = meta.getAttribute('content');
      }
    });

    const hasOG = Object.keys(og).length > 0;
    const hasTwitter = Object.keys(twitter).length > 0;

    // Count issues for warnings
    const warnings = [];

    // Check for required OG tags
    if (!og.title) {
      warnings.push({ code: 'OG_TITLE_MISSING', severity: 'warning' });
    }
    if (!og.description) {
      warnings.push({ code: 'OG_DESC_MISSING', severity: 'warning' });
    }
    if (!og.image) {
      warnings.push({ code: 'OG_IMAGE_MISSING', severity: 'warning' });
    }
    if (!og.url) {
      warnings.push({ code: 'OG_URL_MISSING', severity: 'info' });
    }

    // Check for Twitter card type
    if (hasTwitter && !twitter.card) {
      warnings.push({ code: 'TWITTER_CARD_MISSING', severity: 'warning' });
    }

    // Check title length
    if (og.title && og.title.length > 60) {
      warnings.push({ code: 'OG_TITLE_TOO_LONG', severity: 'info' });
    }
    if (twitter.title && twitter.title.length > 70) {
      warnings.push({ code: 'TWITTER_TITLE_TOO_LONG', severity: 'info' });
    }

    let status = 'good';
    let message = 'Social tags configured';

    if (!hasOG && !hasTwitter) {
      status = 'warning';
      message = 'No social tags (Open Graph/Twitter) found';
    } else if (!hasOG) {
      status = 'warning';
      message = 'Open Graph tags missing';
    } else if (warnings.filter(w => w.severity === 'warning').length > 0) {
      status = 'warning';
      message = `${warnings.filter(w => w.severity === 'warning').length} social tag warning(s)`;
    }

    return {
      openGraph: og,
      twitter: twitter,
      hasOpenGraph: hasOG,
      hasTwitterCards: hasTwitter,
      warnings: warnings,
      status: status,
      message: message
    };
  }

  // Social profile links scraping
  function analyzeSocialProfiles() {
    const platforms = [
      { name: 'Facebook',  icon: 'facebook',  patterns: [/facebook\.com\/(?!sharer|share|dialog|login|help)/i] },
      { name: 'X (Twitter)', icon: 'x',       patterns: [/(?:twitter|x)\.com\/(?!intent|share|login)/i] },
      { name: 'Instagram', icon: 'instagram',  patterns: [/instagram\.com\//i] },
      { name: 'LinkedIn',  icon: 'linkedin',   patterns: [/linkedin\.com\//i] },
      { name: 'YouTube',   icon: 'youtube',    patterns: [/youtube\.com\//i, /youtu\.be\//i] },
      { name: 'TikTok',    icon: 'tiktok',     patterns: [/tiktok\.com\//i] },
      { name: 'Pinterest', icon: 'pinterest',  patterns: [/pinterest\.[a-z.]+\//i] },
      { name: 'Snapchat',  icon: 'snapchat',   patterns: [/snapchat\.com\/add\//i] },
      { name: 'Reddit',    icon: 'reddit',     patterns: [/reddit\.com\/(?:r\/|u\/|user\/)/i] },
      { name: 'Discord',   icon: 'discord',    patterns: [/discord\.(?:gg|com\/invite)\//i] },
      { name: 'Telegram',  icon: 'telegram',   patterns: [/t\.me\//i] },
      { name: 'WhatsApp',  icon: 'whatsapp',   patterns: [/wa\.me\//i, /whatsapp\.com/i] },
      { name: 'GitHub',    icon: 'github',     patterns: [/github\.com\/(?!features|pricing|about)/i] },
      { name: 'Medium',    icon: 'medium',     patterns: [/medium\.com\/@/i] },
      { name: 'Twitch',    icon: 'twitch',     patterns: [/twitch\.tv\//i] },
      { name: 'Spotify',   icon: 'spotify',    patterns: [/open\.spotify\.com\//i] },
      { name: 'Apple Podcasts', icon: 'apple', patterns: [/podcasts\.apple\.com\//i] },
      { name: 'Threads',   icon: 'threads',    patterns: [/threads\.net\/@/i] },
      { name: 'Mastodon',  icon: 'mastodon',   patterns: [/mastodon\.[a-z]+\//i, /mstdn\.[a-z]+\//i] },
      { name: 'Bluesky',   icon: 'bluesky',    patterns: [/bsky\.app\/profile\//i] },
      { name: 'Vimeo',     icon: 'vimeo',      patterns: [/vimeo\.com\/(?!api)/i] },
      { name: 'Dribbble',  icon: 'dribbble',   patterns: [/dribbble\.com\//i] },
      { name: 'Behance',   icon: 'behance',    patterns: [/behance\.net\//i] },
      { name: 'Flickr',    icon: 'flickr',     patterns: [/flickr\.com\//i] },
      { name: 'Tumblr',    icon: 'tumblr',     patterns: [/tumblr\.com/i] },
    ];

    // Classify URL type per platform
    function classifyUrl(platform, url) {
      const path = url.replace(/^https?:\/\/[^/]+/, '').toLowerCase();
      switch (platform) {
        case 'Instagram':
          if (/\/reel\//.test(path)) return 'Reel';
          if (/\/p\//.test(path)) return 'Post';
          if (/\/stories\//.test(path)) return 'Story';
          return 'Profile';
        case 'YouTube':
          if (/\/watch/.test(path) || /youtu\.be\//.test(url)) return 'Video';
          if (/\/shorts\//.test(path)) return 'Short';
          if (/\/playlist/.test(path)) return 'Playlist';
          return 'Channel';
        case 'TikTok':
          if (/\/video\//.test(path)) return 'Video';
          return 'Profile';
        case 'Facebook':
          if (/\/posts\//.test(path)) return 'Post';
          if (/\/photos\//.test(path) || /\/photo/.test(path)) return 'Photo';
          if (/\/videos\//.test(path)) return 'Video';
          if (/\/events\//.test(path)) return 'Event';
          if (/\/groups\//.test(path)) return 'Group';
          return 'Page';
        case 'X (Twitter)':
          if (/\/status\//.test(path)) return 'Tweet';
          return 'Profile';
        case 'LinkedIn':
          if (/\/posts\//.test(path) || /\/pulse\//.test(path)) return 'Post';
          if (/\/company\//.test(path)) return 'Company';
          if (/\/in\//.test(path)) return 'Profile';
          if (/\/school\//.test(path)) return 'School';
          return 'Profile';
        case 'Pinterest':
          if (/\/pin\//.test(path)) return 'Pin';
          return 'Profile';
        default:
          return 'Profile';
      }
    }

    const found = [];
    const seen = new Set();
    const allLinks = document.querySelectorAll('a[href]');

    allLinks.forEach(a => {
      const href = (a.getAttribute('href') || '').trim();
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;

      let fullUrl;
      try { fullUrl = new URL(href, window.location.href).href; } catch { return; }

      for (const platform of platforms) {
        if (platform.patterns.some(p => p.test(fullUrl))) {
          const cleanUrl = fullUrl.split('?')[0].replace(/\/+$/, '');
          const key = platform.name + '|' + cleanUrl.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);

          found.push({
            platform: platform.name,
            icon: platform.icon,
            url: cleanUrl,
            type: classifyUrl(platform.name, cleanUrl),
            text: (a.textContent || '').trim().substring(0, 100),
          });
          return;
        }
      }
    });

    // Also check structured data for sameAs social links
    try {
      document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        const data = JSON.parse(script.textContent);
        const items = Array.isArray(data) ? data : [data];
        items.forEach(item => {
          const sameAs = item.sameAs || item['@graph']?.find(g => g.sameAs)?.sameAs;
          if (Array.isArray(sameAs)) {
            sameAs.forEach(url => {
              for (const platform of platforms) {
                if (platform.patterns.some(p => p.test(url))) {
                  const cleanUrl = url.split('?')[0].replace(/\/+$/, '');
                  const key = platform.name + '|' + cleanUrl.toLowerCase();
                  if (seen.has(key)) return;
                  seen.add(key);
                  found.push({ platform: platform.name, icon: platform.icon, url: cleanUrl, type: classifyUrl(platform.name, cleanUrl), text: '', source: 'schema' });
                  return;
                }
              }
            });
          }
        });
      });
    } catch (e) {}

    return { profiles: found, count: found.length };
  }

  // Structured data analysis - enhanced
  function analyzeStructuredData() {
    // Keep payload small (no full schema objects) so chrome.runtime messaging is reliable
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"], script[type="application/ld+json;"], script[type*="ld+json"]'
    );
    const schemas = [];
    let validCount = 0;
    let invalidCount = 0;

    function pushType(schemaType, index) {
      const type = Array.isArray(schemaType) ? schemaType.join(', ') : (schemaType || 'Unknown');
      schemas.push({
        type: String(type),
        error: false,
        index: index
      });
      validCount++;
    }

    function walk(node, index) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, index + '-' + i));
        return;
      }
      if (node['@graph']) walk(node['@graph'], index + '-g');
      if (node['@type']) pushType(node['@type'], index);
      // nested types sometimes under mainEntity
      if (node.mainEntity) walk(node.mainEntity, index + '-me');
    }

    scripts.forEach((script, index) => {
      let rawContent = (script.textContent || script.innerHTML || '').trim();
      if (!rawContent) return;
      // Unescape common HTML-entity JSON
      if (rawContent.indexOf('&quot;') !== -1 || rawContent.indexOf('&#') !== -1) {
        const ta = document.createElement('textarea');
        ta.innerHTML = rawContent;
        rawContent = ta.value;
      }
      try {
        const data = JSON.parse(rawContent);
        walk(data, String(index));
      } catch (e) {
        // try strip trailing commas once
        try {
          const fixed = rawContent.replace(/,\s*([}\]])/g, '$1');
          const data = JSON.parse(fixed);
          walk(data, String(index));
        } catch (e2) {
          schemas.push({
            type: 'Invalid JSON-LD',
            error: true,
            errorMessage: e.message,
            index: index
          });
          invalidCount++;
        }
      }
    });

    // Microdata fallback (itemtype)
    try {
      document.querySelectorAll('[itemtype]').forEach((el, i) => {
        const it = el.getAttribute('itemtype') || '';
        const type = it.split('/').filter(Boolean).pop() || it;
        if (type && !schemas.some(s => String(s.type).toLowerCase() === type.toLowerCase())) {
          schemas.push({ type: type, error: false, index: 'md-' + i, source: 'microdata' });
          validCount++;
        }
      });
    } catch (_) {}

    let status = 'good';
    let message = 'No structured data found';

    if (schemas.length > 0) {
      if (invalidCount > 0) {
        status = 'warning';
        message = `${validCount} valid, ${invalidCount} invalid JSON-LD schema(s)`;
      } else {
        status = 'good';
        message = `${validCount} JSON-LD schema(s) found`;
      }
    } else {
      status = 'warning';
    }

    return {
      count: schemas.length,
      validCount: validCount,
      invalidCount: invalidCount,
      schemas: schemas,
      status: status,
      message: message
    };
  }

  // Performance analysis (basic metrics)
  function analyzePerformance() {
    const results = {
      domElements: document.getElementsByTagName('*').length,
      scripts: document.querySelectorAll('script').length,
      stylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
      inlineStyles: document.querySelectorAll('[style]').length
    };

    // Timing if available
    if (window.performance && window.performance.timing) {
      const timing = window.performance.timing;
      results.loadTime = timing.loadEventEnd - timing.navigationStart;
      results.domContentLoaded = timing.domContentLoadedEventEnd - timing.navigationStart;
      results.firstByte = timing.responseStart - timing.navigationStart;
    }

    let status = 'good';
    let message = 'Performance acceptable';

    if (results.domElements > 1500) {
      status = 'warning';
      message = 'Too many DOM elements (> 1500)';
    }

    // Analyze scripts in detail
    results.scriptsAnalysis = analyzeScripts();

    // Analyze stylesheets in detail
    results.stylesheetsAnalysis = analyzeStylesheets();

    return {
      ...results,
      status: status,
      message: message
    };
  }

  // Analyze scripts (inline, local, external, blocking)
  function analyzeScripts() {
    const scripts = document.querySelectorAll('script');
    const currentOrigin = window.location.origin;

    let inlineCount = 0;
    let localCount = 0;
    let externalCount = 0;
    let blockingCount = 0;
    const scriptsList = [];

    scripts.forEach((script, index) => {
      const src = script.getAttribute('src');
      const isAsync = script.hasAttribute('async');
      const isDefer = script.hasAttribute('defer');
      const type = script.getAttribute('type') || '';

      // Skip non-javascript types (like application/json or application/ld+json)
      if (type && !type.includes('javascript') && type !== 'module' && type !== '') {
        return;
      }

      let scriptType = 'inline';
      let scriptOrigin = 'inline';
      let isBlocking = false;

      if (!src) {
        // Inline script
        inlineCount++;
        scriptType = 'inline';
        // Inline scripts are blocking unless they're type="module"
        isBlocking = type !== 'module' && !isAsync && !isDefer;
      } else {
        // External script
        try {
          const scriptUrl = new URL(src, window.location.origin);
          if (scriptUrl.origin === currentOrigin) {
            localCount++;
            scriptType = 'local';
            scriptOrigin = 'same-origin';
          } else {
            externalCount++;
            scriptType = 'external';
            scriptOrigin = scriptUrl.hostname;
          }
        } catch (e) {
          // Relative path = local
          localCount++;
          scriptType = 'local';
          scriptOrigin = 'same-origin';
        }

        // External scripts are blocking unless async or defer
        isBlocking = !isAsync && !isDefer;
      }

      if (isBlocking) {
        blockingCount++;
      }

      scriptsList.push({
        index: index,
        src: src || '(inline)',
        type: scriptType,
        origin: scriptOrigin,
        isAsync: isAsync,
        isDefer: isDefer,
        isBlocking: isBlocking,
        size: script.textContent ? script.textContent.length : 0
      });
    });

    return {
      total: scripts.length,
      inline: inlineCount,
      local: localCount,
      external: externalCount,
      blocking: blockingCount,
      scripts: scriptsList
    };
  }

  // Analyze stylesheets
  function analyzeStylesheets() {
    const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
    const inlineStyles = document.querySelectorAll('style');
    const currentOrigin = window.location.origin;

    let localCount = 0;
    let externalCount = 0;
    let totalSize = 0;
    const stylesList = [];

    // Linked stylesheets
    stylesheets.forEach((link, index) => {
      const href = link.getAttribute('href');
      if (!href) return;

      let styleType = 'local';
      let styleOrigin = 'same-origin';

      try {
        const styleUrl = new URL(href, window.location.origin);
        if (styleUrl.origin === currentOrigin) {
          localCount++;
          styleType = 'local';
        } else {
          externalCount++;
          styleType = 'external';
          styleOrigin = styleUrl.hostname;
        }
      } catch (e) {
        localCount++;
        styleType = 'local';
      }

      stylesList.push({
        index: index,
        href: href,
        type: styleType,
        origin: styleOrigin,
        isInline: false
      });
    });

    // Inline style tags
    inlineStyles.forEach((style, index) => {
      totalSize += style.textContent ? style.textContent.length : 0;
      stylesList.push({
        index: stylesheets.length + index,
        href: '(inline)',
        type: 'inline',
        origin: 'inline',
        isInline: true,
        size: style.textContent ? style.textContent.length : 0
      });
    });

    return {
      total: stylesheets.length + inlineStyles.length,
      linked: stylesheets.length,
      inline: inlineStyles.length,
      local: localCount,
      external: externalCount,
      styles: stylesList,
      inlineSize: totalSize
    };
  }

  // Calculate overall score
  // ==================== //
  // Page Type Detection (S1)
  // ==================== //
  function detectPageType() {
    const url = window.location.href.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    const hostname = window.location.hostname.toLowerCase();
    const searchParams = window.location.search.toLowerCase();

    // Collect signals
    const jsonLdTypes = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        const items = data['@graph'] ? data['@graph'] : (Array.isArray(data) ? data : [data]);
        items.forEach(item => {
          if (item['@type']) {
            const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
            jsonLdTypes.push(...types);
          }
        });
      } catch (e) {}
    });

    const ogType = (document.querySelector('meta[property="og:type"]')?.getAttribute('content') || '').toLowerCase();
    const h1Text = (document.querySelector('h1')?.textContent || '').toLowerCase();
    const title = (document.title || '').toLowerCase();

    // Utility: count path segments (ignoring empty segments from leading/trailing slashes)
    const pathSegments = pathname.split('/').filter(s => s.length > 0);

    // Detection functions - each returns { match: boolean, confidence: 'high'|'medium'|'low' }
    function isProduct() {
      // Strong signals
      if (jsonLdTypes.some(t => /^Product$|^IndividualProduct$|^ProductModel$/i.test(t))) return { match: true, confidence: 'high' };
      if (ogType === 'product' || ogType === 'product.item') return { match: true, confidence: 'high' };
      if (document.querySelector('meta[property="product:price:amount"]')) return { match: true, confidence: 'high' };
      // URL pattern with slug (e.g. /products/blue-shirt, /product/123)
      if (/\/products?\/[^\/]+/.test(pathname) && pathSegments.length >= 2) return { match: true, confidence: 'high' };
      // Shopify / e-commerce specific selectors
      if (document.querySelector('[data-product-id], [data-variant-id], .product-form, form[action*="cart"]')) return { match: true, confidence: 'high' };
      if (document.querySelector('.shopify-section[id*="product"], .product-single, .product__info, .product-detail, .product__title')) return { match: true, confidence: 'medium' };
      // WooCommerce
      if (document.querySelector('.single-product, .woocommerce-product-gallery')) return { match: true, confidence: 'high' };
      return { match: false };
    }

    function isCollection() {
      // Don't match if it's clearly a product page
      if (/\/products?\/[^\/]+/.test(pathname)) return { match: false };
      if (jsonLdTypes.some(t => /^CollectionPage$|^ItemList$|^OfferCatalog$|^SearchResultsPage$/i.test(t))) return { match: true, confidence: 'high' };
      // URL patterns for collection/category pages (exact segment match, not sub-pages with slugs)
      if (/\/(collections?|categories?|category|shop|catalog|boutique|tienda|negozio)(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      // Category with sub-path (e.g. /category/shoes) but not deeper article paths
      if (/\/(collections?|categories?|category|shop|catalog)\/.+/.test(pathname) && pathSegments.length <= 3) {
        const productCards = document.querySelectorAll('.product-card, .collection-product, [data-product-card], .product-item, .product-grid-item');
        if (productCards.length > 2) return { match: true, confidence: 'high' };
        return { match: true, confidence: 'medium' };
      }
      // Product card heuristic (strong threshold)
      const productCards = document.querySelectorAll('.product-card, .collection-product, [data-product-card], .product-item, .product-grid-item, .woocommerce ul.products li.product');
      if (productCards.length >= 4) return { match: true, confidence: 'medium' };
      return { match: false };
    }

    function isBlogArticle() {
      // Strong structured data signals
      if (jsonLdTypes.some(t => /^(Article|BlogPosting|NewsArticle|TechArticle|ScholarlyArticle|Report)$/i.test(t))) return { match: true, confidence: 'high' };
      if (ogType === 'article') return { match: true, confidence: 'high' };
      if (document.querySelector('meta[property="article:published_time"]')) return { match: true, confidence: 'high' };
      // Microdata
      if (document.querySelector('[itemtype*="schema.org/Article"], [itemtype*="schema.org/BlogPosting"], [itemtype*="schema.org/NewsArticle"]')) return { match: true, confidence: 'high' };
      // URL: /blog/category/slug or /blog/slug (with at least 2 path segments after keyword)
      if (/\/(blogs?|articles?|posts?|news|journal|magazine|actualites?|noticias?|notizie|nachrichten)\/[^\/]+\/[^\/]+/.test(pathname)) return { match: true, confidence: 'high' };
      // URL: /blog/slug (single slug after keyword, but NOT just /blog/ or /blog/page/2)
      if (/\/(blog|article|post|news|journal|magazine|actualite|noticia|notizia|nachricht)(s)?\/([^\/]+)\/?$/.test(pathname)) {
        const slug = pathname.match(/\/(blog|article|post|news|journal|magazine|actualite|noticia|notizia|nachricht)(s)?\/([^\/]+)\/?$/)?.[3] || '';
        // Exclude pagination patterns and tag/category index pages
        if (/^(page|tag|category|categorie|autor|author|archive)$/i.test(slug) || /^page\/\d+$/.test(slug) || /^\d+$/.test(slug)) return { match: false };
        return { match: true, confidence: 'medium' };
      }
      // WordPress/CMS date-based URLs: /2024/03/article-slug
      if (/\/\d{4}\/\d{2}\/[^\/]+/.test(pathname)) return { match: true, confidence: 'medium' };
      // Heuristic: has <article> with publish date (more specific than bare <article>)
      const article = document.querySelector('article');
      if (article && document.querySelector('time[datetime], .post-date, .entry-date, .published, .article-date')) return { match: true, confidence: 'medium' };
      return { match: false };
    }

    function isBlogIndex() {
      if (jsonLdTypes.some(t => /^Blog$/i.test(t))) return { match: true, confidence: 'high' };
      // Exact blog index pages: /blog, /blog/, /blog?page=2, /news, /articles etc.
      if (/\/(blogs?|articles?|posts?|news|journal|actualites?|noticias?|nachrichten)(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      // Custom blog slugs: /blog-geo-seo, /blog-tech, /blog-actualites (blog- prefix with suffix)
      if (/\/blog[-][a-z0-9-]+(\/)?(\?.*)?$/.test(pathname) && pathSegments.length <= 2) return { match: true, confidence: 'medium' };
      // Blog index with pagination: /blog/page/2
      if (/\/(blogs?|articles?|posts?|news|journal)\/(page|pagina|seite)\/\d+/.test(pathname)) return { match: true, confidence: 'high' };
      // Blog index with category/tag sub-page: /blog/category/tech or /blog/tag/seo
      if (/\/(blogs?|articles?|posts?|news|journal)\/(category|tag|categorie|etiquette|autor|author)\/.+/.test(pathname)) return { match: true, confidence: 'medium' };
      return { match: false };
    }

    function isFAQ() {
      // A homepage with FAQ schema is still a homepage, not a FAQ page
      if (pathname === '/' || pathname === '' || pathname === '/index.html' || pathname === '/index.php') return { match: false };
      if (jsonLdTypes.some(t => /^FAQPage$/i.test(t))) return { match: true, confidence: 'high' };
      // URL patterns - includes foire-aux-questions (FR), haeufig-gestellte-fragen (DE)
      if (/\/(faq|frequently-asked|questions|aide|hilfe|preguntas-frecuentes|domande-frequenti|haeufige-fragen|foire-aux-questions)([-a-z0-9]*)?(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      // Microdata
      if (document.querySelectorAll('[itemtype*="Question"]').length >= 3) return { match: true, confidence: 'high' };
      // Heuristic: FAQ keyword in H1 + multiple Q&A-like structures
      const hasFaqH1 = /faq|frequently asked|questions|foire aux questions|preguntas frecuentes/i.test(h1Text);
      const qElements = document.querySelectorAll('.faq-item, .faq-question, [data-faq], .qa-item');
      if (hasFaqH1 && qElements.length >= 2) return { match: true, confidence: 'medium' };
      // Only match details/accordion if combined with FAQ-related URL or heading
      if (hasFaqH1) {
        const detailsCount = document.querySelectorAll('details, .accordion-item').length;
        if (detailsCount >= 3) return { match: true, confidence: 'medium' };
      }
      return { match: false };
    }

    function isHomepage() {
      if (pathname === '/' || pathname === '' || pathname === '/index.html' || pathname === '/index.php' || pathname === '/home' || pathname === '/home/') return { match: true, confidence: 'high' };
      // Localized homepages: /en, /fr, /de, /es, /it (2-letter lang codes)
      if (/^\/[a-z]{2}(\/)?$/.test(pathname)) return { match: true, confidence: 'medium' };
      // /en-us, /fr-fr etc.
      if (/^\/[a-z]{2}-[a-z]{2}(\/)?$/.test(pathname)) return { match: true, confidence: 'medium' };
      return { match: false };
    }

    function isContact() {
      if (/\/(contact|kontakt|contacto|contatto|contatti|nous-contacter|contactez-nous|kontaktiere-uns)(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      if (document.querySelector('form') && /contact|kontakt|contacto|contatto|nous.contacter|contactez/i.test(h1Text)) return { match: true, confidence: 'medium' };
      return { match: false };
    }

    function isAbout() {
      // Match about/team/history pages, including with suffixes like /equipe-anatae or /notre-histoire-b2b
      if (/\/(about|about-us|a-propos|qui-sommes-nous|uber-uns|ueber-uns|chi-siamo|quienes-somos|sobre-nosotros)([-a-z0-9]*)?(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      if (/\/(notre-histoire|our-story|our-team|equipe|team|nuestra-historia|unsere-geschichte|la-nostra-storia)([-a-z0-9]*)?(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      return { match: false };
    }

    function isLegal() {
      // Use the last meaningful path segment for matching (handles /pages/cgv, /fr/privacy-policy, etc.)
      const lastSegment = pathSegments[pathSegments.length - 1] || '';

      // Privacy - match segment starting with privacy/confidentialite/datenschutz keywords
      if (/^(privacy|privacy-policy|politique[-]?(de[-])?confidentialite|datenschutz|datenschutzrichtlinie|privacidad|politica[-]?privacidad|informativa[-]?privacy|politica[-]?privacidade)([-a-z0-9]*)?$/.test(lastSegment)) return { match: true, confidence: 'high', subType: 'privacy' };

      // Terms - match terms/conditions/CGV/AGB variants, including with suffixes
      if (/^(terms|terms[-]of[-](service|use)|terms[-]and[-]conditions([-]of[-]sale)?|conditions[-]generales([-]vente)?|conditions[-](utilisation|uso)|cgv|cgu|agb|termini|condiciones|condizioni|nutzungsbedingungen|allgemeine[-]geschaeftsbedingungen)([-a-z0-9]*)?$/.test(lastSegment)) return { match: true, confidence: 'high', subType: 'terms' };

      // Legal notices - mentions légales, impressum, etc.
      if (/^(legal|legal[-]notice|mentions[-]legales|impressum|aviso[-]legal|note[-]legali)([-a-z0-9]*)?$/.test(lastSegment)) return { match: true, confidence: 'high', subType: 'legal' };

      // Cookies policy
      if (/^(cookie|cookies|cookie[-]policy|politique[-]cookies)([-a-z0-9]*)?$/.test(lastSegment)) return { match: true, confidence: 'high', subType: 'cookies' };

      // Refund/return policy
      if (/^(refund|return|politique[-]?(de[-])?(remboursement|retour)|rueckerstattung|reembolso|rimborso)([-a-z0-9]*)?$/.test(lastSegment)) return { match: true, confidence: 'high', subType: 'legal' };

      // GDPR / RGPD / DSGVO
      if (/^(gdpr|rgpd|dsgvo)([-a-z0-9]*)?$/.test(lastSegment)) return { match: true, confidence: 'high', subType: 'legal' };

      // Catch-all: long legal page names that contain multiple legal keywords (e.g. "mentions-legales-conditions-generales-de-vente-et-dutilisation-confidentialite-b2b")
      if (/mentions[-]?legales|conditions[-]?generales|confidentialite|datenschutz|impressum/.test(lastSegment) && lastSegment.length > 20) return { match: true, confidence: 'medium', subType: 'legal' };

      return { match: false };
    }

    function isPricing() {
      if (/\/(pricing|plans|tarifs|preise|precios|prezzi|prices)(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      if (jsonLdTypes.some(t => /^PriceSpecification$/i.test(t))) return { match: true, confidence: 'medium' };
      // Pricing tables heuristic
      if (/pricing|tarif|preise|planes|prezzi/i.test(h1Text) && document.querySelectorAll('[class*="pricing"], [class*="plan"], [class*="price-card"]').length >= 2) return { match: true, confidence: 'medium' };
      return { match: false };
    }

    function isService() {
      if (/\/(services?|prestations?|dienstleistungen?|servicios?|servizi)(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      if (jsonLdTypes.some(t => /^Service$/i.test(t))) return { match: true, confidence: 'high' };
      // Service detail page: /services/web-design
      if (/\/(services?|prestations?|dienstleistungen?|servicios?|servizi)\/[^\/]+/.test(pathname)) return { match: true, confidence: 'medium' };
      return { match: false };
    }

    function isEvent() {
      if (jsonLdTypes.some(t => /^Event$|^BusinessEvent$|^SocialEvent$/i.test(t))) return { match: true, confidence: 'high' };
      if (/\/(events?|evenements?|veranstaltungen?|eventos?|eventi)(\/[^\/]+)?\/?$/.test(pathname)) return { match: true, confidence: 'high' };
      return { match: false };
    }

    function isRecipe() {
      if (jsonLdTypes.some(t => /^Recipe$/i.test(t))) return { match: true, confidence: 'high' };
      if (/\/(recipes?|recettes?|rezepte?|recetas?|ricette?)(\/[^\/]+)?\/?$/.test(pathname)) return { match: true, confidence: 'medium' };
      return { match: false };
    }

    function isPortfolio() {
      if (/\/(portfolio|projects?|work|works|realisations?|projets?|projekte?|trabajos?|progetti|lavori)(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      if (/\/(portfolio|projects?|work|realisations?|projets?)\/[^\/]+/.test(pathname)) return { match: true, confidence: 'medium' };
      return { match: false };
    }

    function isLogin() {
      if (/\/(login|signin|sign-in|connexion|anmelden|iniciar-sesion|accedi|register|signup|sign-up|inscription|registrieren|registro|registrazione|account)(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      return { match: false };
    }

    function isSearch() {
      if (/\/(search|recherche|suche|buscar|cerca)(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      if (pathname.includes('/search') && searchParams.includes('q=')) return { match: true, confidence: 'high' };
      if (jsonLdTypes.some(t => /^SearchResultsPage$/i.test(t))) return { match: true, confidence: 'high' };
      return { match: false };
    }

    function isCheckout() {
      if (/\/(checkout|cart|panier|warenkorb|carrito|carrello|basket)(\/)?(\?.*)?$/.test(pathname)) return { match: true, confidence: 'high' };
      return { match: false };
    }

    function isLanding() {
      const nav = document.querySelector('nav, [role="navigation"]');
      const ctas = document.querySelectorAll('a.btn, a.button, button.cta, .hero-cta, a[class*="cta"], .hero a[href], .hero button');
      const links = document.querySelectorAll('a[href]');
      // Landing pages typically lack nav and have few links but prominent CTAs
      if (!nav && ctas.length >= 1 && links.length < 20) return { match: true, confidence: 'medium' };
      // URL pattern for landing pages
      if (/\/(lp|landing|promo|offer|campaign)\//.test(pathname)) return { match: true, confidence: 'medium' };
      return { match: false };
    }

    // Priority-ordered detection: most specific first, then broader types
    let type = 'page';
    let confidence = 'low';

    const checks = [
      // 1. Exact/structural pages
      { fn: isHomepage, type: 'homepage' },
      { fn: isCheckout, type: 'checkout' },
      { fn: isLogin, type: 'login' },
      { fn: isSearch, type: 'search' },
      // 2. Strong structured data types (specific before general)
      { fn: isProduct, type: 'product' },
      { fn: isRecipe, type: 'recipe' },
      { fn: isEvent, type: 'event' },
      { fn: isFAQ, type: 'faq' },
      // 3. Article before blog index (article has stronger signals like JSON-LD, og:type)
      { fn: isBlogArticle, type: 'article' },
      { fn: isBlogIndex, type: 'blog_index' },
      // 4. Collection/catalog
      { fn: isCollection, type: 'collection' },
      // 5. Informational pages
      { fn: isPricing, type: 'pricing' },
      { fn: isService, type: 'service' },
      { fn: isPortfolio, type: 'portfolio' },
      { fn: isContact, type: 'contact' },
      { fn: isAbout, type: 'about' },
      { fn: isLegal, type: 'legal' },
      // 6. Catch-all heuristic
      { fn: isLanding, type: 'landing' },
    ];

    for (const check of checks) {
      const result = check.fn();
      if (result.match) {
        type = result.subType || check.type;
        confidence = result.confidence;
        break;
      }
    }

    return {
      type: type,
      confidence: confidence,
      jsonLdTypes: jsonLdTypes,
      ogType: ogType
    };
  }

  // ==================== //
  // Language Analysis & Content Language Detection
  // ==================== //
  function analyzeLanguage() {
    const htmlLang = (document.documentElement.getAttribute('lang') || '').toLowerCase().trim();
    const contentLang = (document.documentElement.getAttribute('xml:lang') || document.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content') || '').toLowerCase().trim();
    const declaredLang = htmlLang || contentLang || '';
    const pathname = window.location.pathname.toLowerCase();

    // Extract the primary language code (e.g. "fr" from "fr-FR")
    const declaredLangCode = declaredLang.split('-')[0];

    // Language names for display
    const LANG_NAMES = {
      'en': 'English', 'fr': 'Français', 'de': 'Deutsch', 'es': 'Español',
      'it': 'Italiano', 'pt': 'Português', 'nl': 'Nederlands', 'pl': 'Polski',
      'ru': 'Русский', 'ja': '日本語', 'ko': '한국어', 'zh': '中文',
      'ar': 'العربية', 'sv': 'Svenska', 'da': 'Dansk', 'no': 'Norsk',
      'fi': 'Suomi', 'cs': 'Čeština', 'ro': 'Română', 'hu': 'Magyar',
      'tr': 'Türkçe', 'uk': 'Українська', 'el': 'Ελληνικά', 'th': 'ไทย',
      'vi': 'Tiếng Việt', 'id': 'Bahasa Indonesia', 'ms': 'Bahasa Melayu',
      'hi': 'हिन्दी', 'bn': 'বাংলা', 'he': 'עברית', 'ca': 'Català',
      'hr': 'Hrvatski', 'sk': 'Slovenčina', 'bg': 'Български', 'lt': 'Lietuvių',
      'lv': 'Latviešu', 'et': 'Eesti', 'sl': 'Slovenščina'
    };

    // Get visible text for analysis (avoid scripts/styles)
    const textNodes = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG') return NodeFilter.FILTER_REJECT;
        if (parent.offsetParent === null && parent.style.display !== 'contents') return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        if (text.length < 3) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node.textContent.trim());
    }
    const fullText = textNodes.join(' ');
    const textSample = fullText.substring(0, 5000); // Analyze first 5000 chars

    // ---- Lorem Ipsum Detection ----
    const loremPatterns = [
      /lorem\s+ipsum/i,
      /dolor\s+sit\s+amet/i,
      /consectetur\s+adipiscing/i,
      /sed\s+do\s+eiusmod/i,
      /ut\s+labore\s+et\s+dolore/i,
      /magna\s+aliqua/i,
      /quis\s+nostrud/i,
      /exercitation\s+ullamco/i,
      /duis\s+aute\s+irure/i,
      /excepteur\s+sint/i,
      /fugiat\s+nulla\s+pariatur/i
    ];
    const loremMatches = loremPatterns.filter(p => p.test(fullText));
    const hasLoremIpsum = loremMatches.length > 0;

    // Find exact locations of lorem ipsum
    const loremLocations = [];
    if (hasLoremIpsum) {
      const allElements = document.querySelectorAll('p, span, div, li, h1, h2, h3, h4, h5, h6, td, th, a, blockquote');
      allElements.forEach(el => {
        const elText = el.textContent || '';
        if (/lorem\s+ipsum|dolor\s+sit\s+amet|consectetur\s+adipiscing/i.test(elText)) {
          const tag = el.tagName.toLowerCase();
          const preview = elText.substring(0, 80).trim();
          if (!loremLocations.some(l => l.preview === preview)) {
            loremLocations.push({ tag, preview: preview + (elText.length > 80 ? '...' : '') });
          }
        }
      });
    }

    // ---- Language Detection via character/word frequency ----
    // Common short words per language (high-frequency function words)
    const LANG_MARKERS = {
      'en': { words: /\b(the|is|are|was|were|have|has|been|this|that|with|from|will|would|could|should|their|about|which|there|these|those|been|being|than|into|some|other|them|then|also|more|just|only|very|when|what|your|each|make|like|over|such|after|much)\b/gi, weight: 1 },
      'fr': { words: /\b(les|des|une|est|que|dans|pour|qui|sur|par|avec|pas|sont|nous|vous|mais|ses|aux|cette|tout|elle|ont|ces|leur|fait|peut|bien|sans|tous|chez|entre|aussi|même|très|plus|autre|comme|dont|encore|après|sous|avant|depuis|vers|rien|chaque|notre|votre)\b/gi, weight: 1 },
      'de': { words: /\b(der|die|das|und|ist|ein|eine|für|mit|auf|den|dem|des|sich|von|nicht|auch|noch|werden|oder|sind|wird|als|aus|wie|bei|nach|nur|über|kann|aber|ihre|sein|hat|zum|zur|mir|uns|hier|dort|wenn|dass|mehr|sehr|schon|immer|alle|dieser|jeder|wurde|haben|mein|dein|kein)\b/gi, weight: 1 },
      'es': { words: /\b(los|las|del|una|por|con|para|que|son|más|sus|como|pero|esta|este|hay|fue|ser|sin|sobre|todo|han|entre|está|tiene|desde|donde|cada|otro|otra|puede|todos|cuando|muy|bien|también|hasta|después|antes|algo|mismo|hemos|nuestra|nuestro)\b/gi, weight: 1 },
      'it': { words: /\b(del|della|dei|che|per|con|una|sono|gli|dal|nella|questo|questa|anche|come|suo|sua|tra|dopo|ogni|più|può|loro|essere|fatto|tutto|stato|ancora|senza|dove|prima|sempre|solo|molto|altri|quella|questo|nostro|nostra|hanno|quale)\b/gi, weight: 1 },
      'pt': { words: /\b(dos|das|uma|são|mais|seu|sua|mas|tem|foi|nos|sem|pode|cada|outro|outra|quando|muito|bem|também|até|depois|nosso|nossa|todos|onde|ainda|mesmo|não|isso|essa|esse|isto|você|ele|ela|nós|eles|elas|há|já|então|porque|porém|assim|só|aqui|ali|lá|coisa|fazer|ter|dizer|estão|foram|seja|tinha|tudo|nada|algo|quem|qual|aos|pela|pelo|num|numa|vocês|obrigado|obrigada)\b/gi, weight: 1 },
      'nl': { words: /\b(het|een|van|zijn|dat|niet|met|voor|ook|maar|dit|nog|wel|zij|werd|naar|uit|bij|kan|hun|meer|daar|dan|deze|door|over|wordt|alle|hier|ons|onze|veel|hoe|waar|moet|tegen|tussen|onder|zelf)\b/gi, weight: 1 }
    };

    // Count matches per language
    const langScores = {};
    const totalWords = textSample.split(/\s+/).length;

    for (const [lang, config] of Object.entries(LANG_MARKERS)) {
      const matches = textSample.match(config.words);
      const count = matches ? matches.length : 0;
      langScores[lang] = { count, ratio: totalWords > 0 ? count / totalWords : 0 };
    }

    // Attach a normalized percentage (share of detected function words) to
    // each language so the popup can render a meaningful distribution. The
    // raw `ratio` is function-word-count / total-word-count, which is tiny
    // (a few %) because most words don't match any marker - rendering that
    // directly gave every language a visible "1%" bar.
    const sumRatios = Object.values(langScores).reduce((s, v) => s + v.ratio, 0);
    if (sumRatios > 0) {
      for (const lang of Object.keys(langScores)) {
        langScores[lang].pct = Math.round((langScores[lang].ratio / sumRatios) * 100);
      }
    } else {
      for (const lang of Object.keys(langScores)) {
        langScores[lang].pct = 0;
      }
    }

    // Find the dominant detected language
    let detectedLang = '';
    let detectedConfidence = 0;
    let secondLang = '';
    let secondConfidence = 0;

    const sortedLangs = Object.entries(langScores).sort((a, b) => b[1].ratio - a[1].ratio);
    // Calculate relative percentages (share of detected language words)
    const totalDetectedRatio = sortedLangs.reduce((sum, [, v]) => sum + v.ratio, 0) || 1;

    if (sortedLangs.length >= 1 && sortedLangs[0][1].ratio > 0.005) {
      detectedLang = sortedLangs[0][0];
      detectedConfidence = Math.round((sortedLangs[0][1].ratio / totalDetectedRatio) * 100);
    }
    if (sortedLangs.length >= 2 && sortedLangs[1][1].ratio > 0.003) {
      secondLang = sortedLangs[1][0];
      secondConfidence = Math.round((sortedLangs[1][1].ratio / totalDetectedRatio) * 100);
    }

    // ---- URL Language hint ----
    const urlLangMatch = pathname.match(/^\/([a-z]{2})(?:[-_][a-z]{2})?\//);
    const urlLang = urlLangMatch ? urlLangMatch[1] : '';

    // ---- Issues detection ----
    const issues = [];

    // 1. Missing lang attribute
    if (!declaredLang) {
      issues.push({ type: 'missing_lang', severity: 'error', message: 'Missing lang attribute on <html> element' });
    }

    // 2. Lorem ipsum found
    if (hasLoremIpsum) {
      issues.push({
        type: 'lorem_ipsum', severity: 'error',
        message: `Lorem ipsum placeholder text found (${loremLocations.length} location${loremLocations.length > 1 ? 's' : ''})`,
        locations: loremLocations
      });
    }

    // 3. Language mismatch: declared lang vs detected content lang
    if (declaredLangCode && detectedLang && declaredLangCode !== detectedLang) {
      const severity = detectedConfidence >= 60 ? 'error' : 'warning';
      issues.push({
        type: 'lang_mismatch_content', severity,
        message: `Page declares lang="${declaredLang}" but content appears to be ${detectedConfidence}% ${LANG_NAMES[detectedLang] || detectedLang}`
      });
    }

    // 4. URL language vs content language mismatch
    if (urlLang && detectedLang && urlLang !== detectedLang) {
      issues.push({
        type: 'url_lang_mismatch', severity: 'warning',
        message: `URL suggests /${urlLang}/ but content is ${detectedConfidence}% ${LANG_NAMES[detectedLang] || detectedLang}`
      });
    }

    // 5. URL language vs declared lang mismatch
    if (urlLang && declaredLangCode && urlLang !== declaredLangCode) {
      issues.push({
        type: 'url_html_lang_mismatch', severity: 'warning',
        message: `URL prefix /${urlLang}/ doesn't match html lang="${declaredLang}"`
      });
    }

    // 6. Mixed content: any secondary language with significant presence
    if (secondLang && secondConfidence >= 10) {
      // If declared lang exists, check if the secondary language is NOT the declared one
      // (declared lang appearing as secondary is expected on a page with some foreign quotes/terms)
      const isDeclaredSecondary = declaredLangCode && secondLang === declaredLangCode;
      if (!isDeclaredSecondary) {
        const severity = secondConfidence >= 30 ? 'error' : 'warning';
        issues.push({
          type: 'mixed_languages', severity,
          message: `${secondConfidence}% of content detected in ${LANG_NAMES[secondLang] || secondLang} - possible incomplete translation`
        });
      }
    }

    // 7. Declared language is not the dominant one AND appears as secondary
    // e.g. page declares ES, content is 50% EN + 33% ES → declared lang is losing
    if (declaredLangCode && detectedLang && declaredLangCode !== detectedLang) {
      const declaredScore = langScores[declaredLangCode];
      if (declaredScore) {
        const declaredPct = Math.round((declaredScore.ratio / totalDetectedRatio) * 100);
        if (declaredPct > 0 && declaredPct < detectedConfidence) {
          issues.push({
            type: 'untranslated_content', severity: 'error',
            message: `Only ${declaredPct}% of content is in ${LANG_NAMES[declaredLangCode] || declaredLangCode} (declared language) vs ${detectedConfidence}% in ${LANG_NAMES[detectedLang] || detectedLang}`
          });
        }
      }
    }

    return {
      declaredLang: declaredLang,
      declaredLangName: LANG_NAMES[declaredLangCode] || declaredLang || null,
      detectedLang: detectedLang,
      detectedLangName: LANG_NAMES[detectedLang] || null,
      detectedConfidence: detectedConfidence,
      urlLang: urlLang,
      hasLoremIpsum: hasLoremIpsum,
      loremLocations: loremLocations,
      langScores: langScores,
      issues: issues,
      totalWords: totalWords
    };
  }

  // ==================== //
  // Deep Structured Data Analysis (S3)
  // ==================== //
  function analyzeStructuredDataDeep() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const schemas = [];

    // Required/recommended fields per schema type (based on Google Rich Results)
    const SCHEMA_REQUIREMENTS = {
      'Product': {
        required: ['name', 'image'],
        recommended: ['description', 'brand', 'offers', 'aggregateRating', 'review', 'sku', 'gtin']
      },
      'Article': {
        required: ['headline', 'image', 'author', 'datePublished', 'publisher'],
        recommended: ['dateModified', 'description', 'mainEntityOfPage']
      },
      'BlogPosting': {
        required: ['headline', 'image', 'author', 'datePublished', 'publisher'],
        recommended: ['dateModified', 'description', 'mainEntityOfPage', 'wordCount']
      },
      'NewsArticle': {
        required: ['headline', 'image', 'author', 'datePublished', 'publisher'],
        recommended: ['dateModified', 'description']
      },
      'FAQPage': {
        required: ['mainEntity'],
        recommended: []
      },
      'Organization': {
        required: ['name', 'url'],
        recommended: ['logo', 'contactPoint', 'sameAs', 'description', 'address']
      },
      'LocalBusiness': {
        required: ['name', 'address', 'telephone'],
        recommended: ['openingHours', 'geo', 'image', 'priceRange', 'url']
      },
      'WebSite': {
        required: ['name', 'url'],
        recommended: ['potentialAction', 'description']
      },
      'BreadcrumbList': {
        required: ['itemListElement'],
        recommended: []
      },
      'Event': {
        required: ['name', 'startDate', 'location'],
        recommended: ['endDate', 'description', 'image', 'organizer', 'offers']
      },
      'Recipe': {
        required: ['name', 'image', 'recipeIngredient', 'recipeInstructions'],
        recommended: ['cookTime', 'prepTime', 'nutrition', 'recipeYield', 'recipeCategory']
      },
      'HowTo': {
        required: ['name', 'step'],
        recommended: ['description', 'image', 'totalTime', 'supply', 'tool']
      },
      'VideoObject': {
        required: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
        recommended: ['duration', 'contentUrl', 'embedUrl']
      },
      'Review': {
        required: ['author', 'reviewRating', 'itemReviewed'],
        recommended: ['datePublished', 'reviewBody']
      },
      'Course': {
        required: ['name', 'description', 'provider'],
        recommended: ['offers', 'hasCourseInstance']
      },
      'SoftwareApplication': {
        required: ['name', 'offers'],
        recommended: ['applicationCategory', 'operatingSystem', 'aggregateRating']
      }
    };

    scripts.forEach((script, index) => {
      try {
        const data = JSON.parse(script.textContent.trim());
        const items = data['@graph'] ? data['@graph'] : (Array.isArray(data) ? data : [data]);

        items.forEach((item, itemIndex) => {
          const rawType = item['@type'];
          const types = Array.isArray(rawType) ? rawType : [rawType || 'Unknown'];
          const primaryType = types[0];

          // Get requirements for this type
          const reqs = SCHEMA_REQUIREMENTS[primaryType] || null;
          const presentFields = Object.keys(item).filter(k => !k.startsWith('@'));
          const missingRequired = [];
          const missingRecommended = [];
          const presentRequired = [];
          const presentRecommended = [];

          if (reqs) {
            reqs.required.forEach(field => {
              if (item[field] !== undefined && item[field] !== null && item[field] !== '') {
                presentRequired.push(field);
              } else {
                missingRequired.push(field);
              }
            });
            reqs.recommended.forEach(field => {
              if (item[field] !== undefined && item[field] !== null && item[field] !== '') {
                presentRecommended.push(field);
              } else {
                missingRecommended.push(field);
              }
            });
          }

          // Validation status
          let validationStatus = 'valid';
          if (missingRequired.length > 0) {
            validationStatus = 'incomplete';
          } else if (missingRecommended.length > 0) {
            validationStatus = 'improvable';
          }

          // Completeness score
          const totalFields = (reqs ? reqs.required.length + reqs.recommended.length : 0);
          const presentCount = presentRequired.length + presentRecommended.length;
          const completeness = totalFields > 0 ? Math.round((presentCount / totalFields) * 100) : null;

          schemas.push({
            type: primaryType,
            types: types,
            fields: presentFields,
            fieldCount: presentFields.length,
            data: item,
            validationStatus: validationStatus,
            completeness: completeness,
            missingRequired: missingRequired,
            missingRecommended: missingRecommended,
            presentRequired: presentRequired,
            presentRecommended: presentRecommended,
            hasRequirements: reqs !== null,
            rawSnippet: JSON.stringify(item).substring(0, 300)
          });
        });
      } catch (e) {
        schemas.push({
          type: 'Invalid JSON-LD',
          types: ['Invalid JSON-LD'],
          fields: [],
          fieldCount: 0,
          data: null,
          validationStatus: 'error',
          completeness: 0,
          missingRequired: [],
          missingRecommended: [],
          presentRequired: [],
          presentRecommended: [],
          hasRequirements: false,
          errorMessage: e.message,
          rawSnippet: script.textContent.trim().substring(0, 300)
        });
      }
    });

    // Also detect Microdata
    const microdataItems = document.querySelectorAll('[itemscope]');
    const microdataTypes = [];
    microdataItems.forEach(item => {
      const itemtype = item.getAttribute('itemtype') || '';
      const typeName = itemtype.split('/').pop();
      if (typeName) microdataTypes.push(typeName);
    });

    // Overall stats
    const validSchemas = schemas.filter(s => s.validationStatus !== 'error');
    const incompleteSchemas = schemas.filter(s => s.validationStatus === 'incomplete');
    const avgCompleteness = validSchemas.length > 0
      ? Math.round(validSchemas.filter(s => s.completeness !== null).reduce((sum, s) => sum + s.completeness, 0) / Math.max(validSchemas.filter(s => s.completeness !== null).length, 1))
      : 0;

    return {
      schemas: schemas,
      totalCount: schemas.length,
      validCount: validSchemas.length,
      errorCount: schemas.filter(s => s.validationStatus === 'error').length,
      incompleteCount: incompleteSchemas.length,
      improvableCount: schemas.filter(s => s.validationStatus === 'improvable').length,
      avgCompleteness: avgCompleteness,
      microdataTypes: microdataTypes,
      hasMicrodata: microdataTypes.length > 0,
      allTypes: [...new Set(schemas.map(s => s.type))]
    };
  }

  // ==================== //
  // GEO Signals Analysis (S2)
  // ==================== //
  function analyzeGEOSignals() {
    const body = document.body;
    const text = body ? body.innerText || '' : '';
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    // 1. Content Citability: modular sections, lists, stats, definitions, short paragraphs
    const h2Count = document.querySelectorAll('h2').length;
    const h3Count = document.querySelectorAll('h3').length;
    const listsCount = document.querySelectorAll('ul, ol').length;
    const tablesCount = document.querySelectorAll('table').length;
    const paragraphs = document.querySelectorAll('p');
    let shortParagraphs = 0;
    paragraphs.forEach(p => {
      const pWords = (p.textContent || '').split(/\s+/).filter(w => w.length > 0).length;
      if (pWords > 10 && pWords <= 80) shortParagraphs++;
    });

    // Count stats/numbers (e.g., "50%", "$100", "2.5x", "10,000")
    const statsMatches = text.match(/\b\d[\d,.]*(?: ?[%xX$€£]|\b(?:percent|times|million|billion))\b/gi) || [];
    const statsCount = statsMatches.length;

    // Count definitions ("X is Y" pattern). Case-insensitive so definitions
    // whose right-hand side starts with an uppercase acronym/proper noun
    // (e.g. "API is Application Programming Interface") are also picked up.
    const definitionMatches = text.match(/\b[A-Z][a-zA-Z\s]{2,30}\bis\b\s[a-z]/gi) || [];
    const definitionsCount = definitionMatches.length;

    // Q&A patterns
    const questionPatterns = text.match(/\b(what|how|why|when|where|who|which|can|does|is)\b[^.?]*\?/gi) || [];
    const questionsCount = questionPatterns.length;

    // Citability score (0-20)
    let citabilityScore = 0;
    citabilityScore += Math.min(5, h2Count); // up to 5 pts for sections
    citabilityScore += Math.min(3, listsCount); // up to 3 pts for lists
    citabilityScore += Math.min(2, tablesCount); // up to 2 pts for tables
    citabilityScore += Math.min(3, Math.floor(statsCount / 2)); // up to 3 pts for stats
    citabilityScore += Math.min(2, Math.floor(definitionsCount / 2)); // up to 2 pts for definitions
    citabilityScore += Math.min(3, Math.floor(questionsCount / 2)); // up to 3 pts for Q&A
    citabilityScore += shortParagraphs >= 5 ? 2 : (shortParagraphs >= 2 ? 1 : 0); // up to 2 pts

    // 2. EEAT Signals
    const hasAuthor = !!(
      document.querySelector('[rel="author"], [itemprop="author"], .author, .byline, meta[name="author"]') ||
      document.querySelector('script[type="application/ld+json"]')?.textContent?.includes('"author"')
    );
    const hasDatePublished = !!(
      document.querySelector('meta[property="article:published_time"], time[datetime], [itemprop="datePublished"]')
    );
    const hasDateModified = !!(
      document.querySelector('meta[property="article:modified_time"], [itemprop="dateModified"]')
    );
    // Check for citations/sources
    const externalLinks = document.querySelectorAll('a[href^="http"]');
    let sourceLinks = 0;
    const currentHost = window.location.hostname;
    externalLinks.forEach(link => {
      try {
        const linkHost = new URL(link.href).hostname;
        if (linkHost !== currentHost) sourceLinks++;
      } catch (e) {}
    });
    const hasSources = sourceLinks >= 3;

    // EEAT score (0-20)
    // NOTE: hasAuthor already includes meta[name="author"] in its selector (see
    // `analyzeCitability` init above), so we must NOT add a separate bonus for
    // it here - that would double-count the same signal.
    let eeatScore = 0;
    eeatScore += hasAuthor ? 5 : 0;
    eeatScore += hasDatePublished ? 4 : 0;
    eeatScore += hasDateModified ? 3 : 0;
    eeatScore += hasSources ? 4 : 0;
    eeatScore += sourceLinks >= 5 ? 2 : (sourceLinks >= 1 ? 1 : 0);

    // 3. Structured Data quality (0-20) - basic check here, detailed in structuredDeep
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    let structuredScore = 0;
    structuredScore += jsonLdScripts.length > 0 ? 6 : 0;
    structuredScore += jsonLdScripts.length >= 2 ? 4 : 0;
    // Check for important types
    let hasProductSchema = false;
    let hasArticleSchema = false;
    let hasFAQSchema = false;
    let hasBreadcrumbSchema = false;
    let hasOrgSchema = false;
    jsonLdScripts.forEach(script => {
      try {
        const content = script.textContent;
        if (/Product/i.test(content)) hasProductSchema = true;
        if (/Article|BlogPosting/i.test(content)) hasArticleSchema = true;
        if (/FAQPage/i.test(content)) hasFAQSchema = true;
        if (/BreadcrumbList/i.test(content)) hasBreadcrumbSchema = true;
        if (/Organization|WebSite/i.test(content)) hasOrgSchema = true;
      } catch (e) {}
    });
    structuredScore += (hasProductSchema || hasArticleSchema || hasFAQSchema) ? 4 : 0;
    structuredScore += hasBreadcrumbSchema ? 3 : 0;
    structuredScore += hasOrgSchema ? 3 : 0;

    // 4. Technical AI accessibility (0-10)
    // (llms.txt, sitemap, canonical, meta robots - most checked in popup via technicalData)
    const hasCanonical = !!document.querySelector('link[rel="canonical"]');
    const robotsMeta = document.querySelector('meta[name="robots"]');
    const isIndexable = !robotsMeta || !robotsMeta.getAttribute('content')?.toLowerCase().includes('noindex');
    let techAIScore = 0;
    techAIScore += hasCanonical ? 3 : 0;
    techAIScore += isIndexable ? 4 : 0;
    techAIScore += document.querySelector('link[rel="sitemap"], link[type="application/xml"]') ? 3 : 0;

    // 5. Multi-modal content (0-10)
    const images = document.querySelectorAll('img');
    let imagesWithDescAlt = 0;
    images.forEach(img => {
      const alt = img.getAttribute('alt') || '';
      if (alt.length > 10) imagesWithDescAlt++;
    });
    const hasVideo = document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length > 0;
    let multiModalScore = 0;
    multiModalScore += Math.min(4, Math.floor(imagesWithDescAlt / 2));
    multiModalScore += tablesCount >= 1 ? 3 : 0;
    multiModalScore += hasVideo ? 3 : 0;

    // ── AI Search Readiness (Google I/O 2026 — "Intelligent Search Box" / AI Mode era) ──
    // Two checks pulled directly from how Google's AI Search now extracts and cites passages:
    // (1) a tight, direct "answer-first" opening near the top of the page, and
    // (2) sections sized for clean extraction (~100-450 words per H2 block; very short or
    //     very long sections are less likely to be lifted cleanly into an AI answer).
    let firstParaWords = 0, firstParaSentences = 0, firstParaText = '';
    const allParas = document.querySelectorAll('p');
    for (const p of allParas) {
      const t = (p.textContent || '').trim();
      const wc = t.split(/\s+/).filter(Boolean).length;
      if (wc >= 8) {
        firstParaText = t.slice(0, 220);
        firstParaWords = wc;
        firstParaSentences = (t.match(/[.!?]+(?:\s|$)/g) || []).length || 1;
        break;
      }
    }
    const hasAnswerFirstOpening = firstParaWords > 0 && firstParaWords <= 60 && firstParaSentences <= 4;

    // Bucket all body text by the nearest PRECEDING H2 in true document order. A naive
    // "walk h2.nextElementSibling" approach badly undercounts on card/grid layouts where
    // the heading and its body text live in separate wrapper divs (e.g.
    // <div class="card-header"><h2>Title</h2></div><div class="card-body"><p>...</p></div>),
    // so instead we do a single recursive DOM walk and reassign the "current bucket"
    // every time we cross an H2/H1, regardless of nesting depth.
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'TEMPLATE', 'NAV', 'FOOTER']);
    const sectionBuckets = []; // { el, text }
    let currentBucket = null;
    (function walkForSections(node) {
      if (node.nodeType === 3) { // TEXT_NODE
        if (currentBucket && node.textContent) currentBucket.text += ' ' + node.textContent;
        return;
      }
      if (node.nodeType !== 1) return; // ELEMENT_NODE only
      const tag = node.tagName;
      if (SKIP_TAGS.has(tag)) return;
      if (tag === 'H2') {
        currentBucket = { el: node, text: '' };
        sectionBuckets.push(currentBucket);
        return; // don't count the heading's own text as section body
      }
      if (tag === 'H1') currentBucket = null; // hero/intro text isn't attributed to any H2 section
      for (let i = 0; i < node.childNodes.length; i++) walkForSections(node.childNodes[i]);
    })(document.body);

    let idealSections = 0, shortSections = 0, longSections = 0;
    const flaggedSections = [];
    sectionBuckets.forEach(b => {
      const words = b.text.split(/\s+/).filter(Boolean).length;
      let type = 'ideal';
      if (words < 80) { type = 'short'; shortSections++; }
      else if (words > 450) { type = 'long'; longSections++; }
      else { idealSections++; }
      if (type !== 'ideal' && flaggedSections.length < 6) {
        flaggedSections.push({ text: (b.el.textContent || '').trim().slice(0, 60), words, type });
      }
    });
    const h2Els = sectionBuckets.map(b => b.el);

    // Total GEO Score (0-100, scaled from 0-80)
    const rawScore = citabilityScore + eeatScore + structuredScore + techAIScore + multiModalScore;
    const geoScore = Math.min(100, Math.round((rawScore / 80) * 100));

    return {
      score: geoScore,
      pillars: {
        citability: { score: citabilityScore, max: 20, label: 'Content Citability' },
        eeat: { score: eeatScore, max: 20, label: 'E-E-A-T Signals' },
        structured: { score: structuredScore, max: 20, label: 'Structured Data' },
        techAI: { score: techAIScore, max: 10, label: 'AI Accessibility' },
        multiModal: { score: multiModalScore, max: 10, label: 'Multi-modal Content' }
      },
      details: {
        h2Count, h3Count, listsCount, tablesCount, statsCount, definitionsCount, questionsCount,
        shortParagraphs: shortParagraphs,
        hasAuthor, hasDatePublished, hasDateModified, hasSources, sourceLinks,
        jsonLdCount: jsonLdScripts.length, hasProductSchema, hasArticleSchema, hasFAQSchema, hasBreadcrumbSchema, hasOrgSchema,
        hasCanonical, isIndexable, wordCount,
        imagesWithDescAlt, hasVideo, imagesTotal: images.length,
        answerFirst: { hasAnswerFirstOpening, words: firstParaWords, sentences: firstParaSentences, preview: firstParaText },
        passageLength: { total: h2Els.length, ideal: idealSections, short: shortSections, long: longSections, flagged: flaggedSections }
      }
    };
  }

  // ==================== //
  // Search Intent Detection (A1)
  // ==================== //
  function detectSearchIntent() {
    const url = window.location.href.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    const title = (document.title || '').toLowerCase();
    const h1 = (document.querySelector('h1')?.textContent || '').toLowerCase();
    const metaDesc = (document.querySelector('meta[name="description"]')?.getAttribute('content') || '').toLowerCase();
    const bodyText = getBodyText().substring(0, 5000).toLowerCase();
    const combined = `${title} ${h1} ${metaDesc}`;

    // Signal scores
    let transactional = 0;
    let commercial = 0;
    let informational = 0;
    let navigational = 0;

    // Transactional signals
    const transactionalWords = /\b(buy|purchase|order|add to cart|checkout|shop|price|deal|discount|coupon|sale|subscribe|sign up|register|download|get started|free trial|pricing|acheter|commander|panier|prix|promo|solde|kaufen|bestellen|comprar|acquista)\b/gi;
    const transMatches = (combined.match(transactionalWords) || []).length;
    transactional += transMatches * 3;
    if (document.querySelector('form[action*="cart"], [data-action="add-to-cart"], .add-to-cart, button[name="add"], .shopify-payment-button')) transactional += 5;
    if (document.querySelector('meta[property="product:price:amount"], [itemprop="price"]')) transactional += 4;
    if (/\/cart|\/checkout|\/order|\/panier/.test(pathname)) transactional += 5;

    // Commercial signals
    const commercialWords = /\b(best|top|review|comparison|vs|versus|alternative|compare|rated|ranking|recommend|pros and cons|meilleur|comparatif|avis|classement|test|mejor|bewertung|migliore|confronto)\b/gi;
    const commMatches = (combined.match(commercialWords) || []).length;
    commercial += commMatches * 3;
    if (document.querySelectorAll('.product-card, .product-grid, [data-product-card]').length > 2) commercial += 3;
    if (/\/(compare|vs|review|best|top-|meilleur|comparatif|avis)/.test(pathname)) commercial += 4;

    // Informational signals
    const infoWords = /\b(how to|what is|guide|tutorial|learn|tips|steps|example|definition|explain|understand|meaning|comment|pourquoi|qu'est-ce|guide|tutoriel|apprendre|wie|was ist|anleitung|come|cosa|guida|cómo|qué es)\b/gi;
    const infoMatches = (combined.match(infoWords) || []).length;
    informational += infoMatches * 3;
    if (document.querySelector('article, [itemtype*="Article"], [itemtype*="BlogPosting"]')) informational += 3;
    if (document.querySelectorAll('h2').length >= 3) informational += 2;
    if (getBodyText().split(/\s+/).length > 800) informational += 3;
    if (/\/(blog|article|guide|how-to|tutorial|wiki|learn|faq)/.test(pathname)) informational += 4;

    // Navigational signals
    if (pathname === '/' || pathname === '') navigational += 5;
    if (/\/(about|contact|login|signup|account|profile|privacy|terms|legal)/.test(pathname)) navigational += 4;
    const isHomepage = pathname === '/' || pathname === '/index.html';
    if (isHomepage) navigational += 3;

    // Determine primary intent
    const scores = { transactional, commercial, informational, navigational };
    const maxScore = Math.max(...Object.values(scores));
    let primary = 'informational'; // default
    if (maxScore > 0) {
      primary = Object.keys(scores).find(k => scores[k] === maxScore) || 'informational';
    }

    // Confidence
    const totalScore = transactional + commercial + informational + navigational;
    const ratio = totalScore > 0 ? maxScore / totalScore : 0;
    let confidence = 'low';
    if (ratio >= 0.6) confidence = 'high';
    else if (ratio >= 0.4) confidence = 'medium';

    return {
      primary: primary,
      confidence: confidence,
      scores: scores
    };
  }

  // ==================== //
  // SERP Feature Eligibility (C5)
  // ==================== //
  function analyzeSERPEligibility() {
    const results = [];

    // Helper: get JSON-LD types
    const jsonLdTypes = [];
    const jsonLdData = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        const items = data['@graph'] ? data['@graph'] : (Array.isArray(data) ? data : [data]);
        items.forEach(item => {
          const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type'] || ''];
          jsonLdTypes.push(...types);
          jsonLdData.push(item);
        });
      } catch (e) {}
    });

    // 1. FAQ Rich Result
    const hasFAQSchema = jsonLdTypes.some(t => /FAQPage/i.test(t));
    const hasFAQContent = document.querySelectorAll('details, [itemtype*="Question"], .faq-item').length >= 2;
    results.push({
      feature: 'FAQ',
      icon: '❓',
      eligible: hasFAQSchema,
      partial: !hasFAQSchema && hasFAQContent,
      requirements: [
        { label: 'FAQPage schema', met: hasFAQSchema },
        { label: 'Question/Answer pairs', met: hasFAQContent || hasFAQSchema }
      ],
      fix: hasFAQSchema ? null : 'Add FAQPage JSON-LD with mainEntity containing Question/acceptedAnswer pairs'
    });

    // 2. Product Rich Result
    const hasProductSchema = jsonLdTypes.some(t => /Product/i.test(t));
    const productData = jsonLdData.find(d => /Product/i.test(d['@type']));
    const hasPrice = productData?.offers?.price || productData?.offers?.[0]?.price || document.querySelector('[itemprop="price"], meta[property="product:price:amount"]');
    const hasReviews = productData?.aggregateRating || productData?.review || document.querySelector('[itemprop="aggregateRating"]');
    results.push({
      feature: 'Product',
      icon: '🛍',
      eligible: hasProductSchema && !!hasPrice,
      partial: hasProductSchema && !hasPrice,
      requirements: [
        { label: 'Product schema', met: hasProductSchema },
        { label: 'Price/Offers', met: !!hasPrice },
        { label: 'Reviews/Rating', met: !!hasReviews }
      ],
      fix: !hasProductSchema ? 'Add Product JSON-LD with name, image, and offers (price, availability)' : (!hasPrice ? 'Add offers.price to Product schema' : null)
    });

    // 3. Article Rich Result
    const hasArticleSchema = jsonLdTypes.some(t => /Article|BlogPosting|NewsArticle/i.test(t));
    const articleData = jsonLdData.find(d => /Article|BlogPosting|NewsArticle/i.test(d['@type']));
    const hasAuthor = articleData?.author || document.querySelector('[itemprop="author"], meta[name="author"]');
    const hasDatePub = articleData?.datePublished || document.querySelector('meta[property="article:published_time"]');
    results.push({
      feature: 'Article',
      icon: '📝',
      eligible: hasArticleSchema && !!hasAuthor && !!hasDatePub,
      partial: hasArticleSchema && (!hasAuthor || !hasDatePub),
      requirements: [
        { label: 'Article/BlogPosting schema', met: hasArticleSchema },
        { label: 'Author', met: !!hasAuthor },
        { label: 'datePublished', met: !!hasDatePub }
      ],
      fix: !hasArticleSchema ? 'Add Article JSON-LD with headline, author, datePublished, image' : null
    });

    // 4. Breadcrumbs Rich Result
    const hasBreadcrumb = jsonLdTypes.some(t => /BreadcrumbList/i.test(t));
    const hasBreadcrumbHTML = !!document.querySelector('[itemtype*="BreadcrumbList"], nav[aria-label*="breadcrumb"], .breadcrumb, .breadcrumbs');
    results.push({
      feature: 'Breadcrumbs',
      icon: '🔗',
      eligible: hasBreadcrumb,
      partial: !hasBreadcrumb && hasBreadcrumbHTML,
      requirements: [
        { label: 'BreadcrumbList schema', met: hasBreadcrumb },
        { label: 'Breadcrumb navigation', met: hasBreadcrumbHTML || hasBreadcrumb }
      ],
      fix: hasBreadcrumb ? null : 'Add BreadcrumbList JSON-LD with itemListElement'
    });

    // 5. Sitelinks Search Box
    const hasSearchAction = jsonLdData.some(d => JSON.stringify(d).includes('SearchAction'));
    const hasWebSite = jsonLdTypes.some(t => /WebSite/i.test(t));
    const hasSearchForm = !!document.querySelector('form[role="search"], input[type="search"], form[action*="search"]');
    results.push({
      feature: 'Sitelinks Search',
      icon: '🔍',
      eligible: hasSearchAction && hasWebSite,
      partial: hasSearchForm && !hasSearchAction,
      requirements: [
        { label: 'WebSite schema', met: hasWebSite },
        { label: 'SearchAction', met: hasSearchAction },
        { label: 'Search functionality', met: hasSearchForm || hasSearchAction }
      ],
      fix: !hasSearchAction ? 'Add WebSite JSON-LD with potentialAction SearchAction' : null
    });

    // 6. HowTo Rich Result
    const hasHowTo = jsonLdTypes.some(t => /HowTo/i.test(t));
    const hasSteps = document.querySelectorAll('ol li, .step, [itemtype*="HowToStep"]').length >= 3;
    results.push({
      feature: 'How-To',
      icon: '📋',
      eligible: hasHowTo,
      partial: !hasHowTo && hasSteps,
      requirements: [
        { label: 'HowTo schema', met: hasHowTo },
        { label: 'Ordered steps', met: hasSteps || hasHowTo }
      ],
      fix: hasHowTo ? null : 'Add HowTo JSON-LD with name and step array'
    });

    // 7. Video Rich Result
    const hasVideoSchema = jsonLdTypes.some(t => /VideoObject/i.test(t));
    const hasVideo = document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length > 0;
    results.push({
      feature: 'Video',
      icon: '🎬',
      eligible: hasVideoSchema,
      partial: hasVideo && !hasVideoSchema,
      requirements: [
        { label: 'VideoObject schema', met: hasVideoSchema },
        { label: 'Video on page', met: hasVideo || hasVideoSchema }
      ],
      fix: hasVideo && !hasVideoSchema ? 'Add VideoObject JSON-LD with name, description, thumbnailUrl, uploadDate' : null
    });

    // 8. Recipe Rich Result
    const hasRecipe = jsonLdTypes.some(t => /Recipe/i.test(t));
    results.push({
      feature: 'Recipe',
      icon: '🍳',
      eligible: hasRecipe,
      partial: false,
      requirements: [
        { label: 'Recipe schema', met: hasRecipe }
      ],
      fix: null
    });

    // 9. Event Rich Result
    const hasEvent = jsonLdTypes.some(t => /Event/i.test(t));
    results.push({
      feature: 'Event',
      icon: '📅',
      eligible: hasEvent,
      partial: false,
      requirements: [
        { label: 'Event schema', met: hasEvent }
      ],
      fix: null
    });

    // 10. Organization Knowledge Panel
    const hasOrg = jsonLdTypes.some(t => /Organization|LocalBusiness/i.test(t));
    const orgData = jsonLdData.find(d => /Organization|LocalBusiness/i.test(d['@type']));
    const hasLogo = orgData?.logo || document.querySelector('link[rel="icon"], link[rel="apple-touch-icon"]');
    const hasSameAs = orgData?.sameAs && orgData.sameAs.length > 0;
    results.push({
      feature: 'Knowledge Panel',
      icon: '🏢',
      eligible: hasOrg && !!hasLogo && !!hasSameAs,
      partial: hasOrg && (!hasLogo || !hasSameAs),
      requirements: [
        { label: 'Organization schema', met: hasOrg },
        { label: 'Logo', met: !!hasLogo },
        { label: 'sameAs (social links)', met: !!hasSameAs }
      ],
      fix: !hasOrg ? 'Add Organization JSON-LD with name, url, logo, sameAs' : null
    });

    // Summary
    const eligible = results.filter(r => r.eligible).length;
    const partial = results.filter(r => r.partial).length;

    return {
      features: results,
      eligibleCount: eligible,
      partialCount: partial,
      totalChecked: results.length
    };
  }

  // ==================== //
  // Advanced Readability (A7)
  // ==================== //
  function analyzeReadabilityAdvanced() {
    const mainText = extractMainContentText();
    if (!mainText || mainText.length < 100) {
      return { available: false };
    }

    const sentences = splitIntoSentences(mainText);
    const words = mainText.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const sentenceCount = sentences.length;

    if (wordCount < 30 || sentenceCount < 2) {
      return { available: false };
    }

    // Count syllables (English-focused heuristic, works reasonably for Romance languages)
    function countSyllables(word) {
      word = word.toLowerCase().replace(/[^a-zàâäéèêëïîôùûüçñß]/g, '');
      if (word.length <= 2) return 1;
      // Remove trailing silent e
      word = word.replace(/e$/, '');
      const vowelGroups = word.match(/[aeiouyàâäéèêëïîôùûüæœ]+/gi);
      const count = vowelGroups ? vowelGroups.length : 1;
      return Math.max(1, count);
    }

    let totalSyllables = 0;
    let complexWords = 0; // words with 3+ syllables (for Gunning Fog)
    words.forEach(word => {
      const syllables = countSyllables(word);
      totalSyllables += syllables;
      if (syllables >= 3) complexWords++;
    });

    const avgWordsPerSentence = wordCount / sentenceCount;
    const avgSyllablesPerWord = totalSyllables / wordCount;

    // Flesch-Kincaid Reading Ease (0-100, higher = easier)
    const fleschKincaid = Math.round(
      206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord)
    );
    const fkScore = Math.max(0, Math.min(100, fleschKincaid));

    // Gunning Fog Index (grade level)
    const gunningFog = Math.round(
      (0.4 * (avgWordsPerSentence + (100 * complexWords / wordCount))) * 10
    ) / 10;

    // Grade level interpretation
    let gradeLevel = '';
    let difficulty = '';
    if (fkScore >= 80) { gradeLevel = '5th grade'; difficulty = 'very_easy'; }
    else if (fkScore >= 70) { gradeLevel = '6th grade'; difficulty = 'easy'; }
    else if (fkScore >= 60) { gradeLevel = '8th grade'; difficulty = 'standard'; }
    else if (fkScore >= 50) { gradeLevel = '10th grade'; difficulty = 'moderate'; }
    else if (fkScore >= 30) { gradeLevel = 'College'; difficulty = 'difficult'; }
    else { gradeLevel = 'Graduate'; difficulty = 'very_difficult'; }

    // Vocabulary richness (unique words / total words)
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-zàâäéèêëïîôùûüçñß]/g, '')).filter(w => w.length > 2));
    const vocabRichness = Math.round((uniqueWords.size / wordCount) * 100);

    // Long paragraphs detection
    const paragraphs = document.querySelectorAll('p');
    let longParagraphs = 0;
    paragraphs.forEach(p => {
      const pWords = (p.textContent || '').split(/\s+/).filter(w => w.length > 0).length;
      if (pWords > 150) longParagraphs++;
    });

    // Passive voice detection (English heuristic)
    const passivePatterns = /\b(is|are|was|were|been|being|be)\s+(being\s+)?\w+(ed|en|t)\b/gi;
    const passiveMatches = mainText.match(passivePatterns) || [];
    const passiveCount = passiveMatches.length;
    const passivePercent = sentenceCount > 0 ? Math.round((passiveCount / sentenceCount) * 100) : 0;

    return {
      available: true,
      fleschKincaid: fkScore,
      gunningFog: gunningFog,
      gradeLevel: gradeLevel,
      difficulty: difficulty,
      avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
      avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 10) / 10,
      vocabRichness: vocabRichness,
      complexWordPercent: Math.round((complexWords / wordCount) * 100),
      longParagraphs: longParagraphs,
      passiveVoicePercent: passivePercent,
      totalSyllables: totalSyllables,
      wordCount: wordCount,
      sentenceCount: sentenceCount
    };
  }

  // ==================== //
  // Duplicate Content Detection (A6)
  // ==================== //
  function detectDuplicateContent() {
    const title = (document.title || '').trim();
    const h1El = document.querySelector('h1');
    const h1 = h1El ? h1El.textContent.trim() : '';
    const metaDesc = (document.querySelector('meta[name="description"]')?.getAttribute('content') || '').trim();
    const firstP = (document.querySelector('p')?.textContent || '').trim();
    const h2s = Array.from(document.querySelectorAll('h2')).map(el => el.textContent.trim());

    const issues = [];

    // Title = H1 (already detected but we add detail)
    if (title && h1 && title.toLowerCase() === h1.toLowerCase()) {
      issues.push({ type: 'title_h1', severity: 'warning', message: 'Title and H1 are identical - differentiate to target more keywords' });
    }

    // Title = Meta description
    if (title && metaDesc && title.toLowerCase() === metaDesc.toLowerCase()) {
      issues.push({ type: 'title_meta', severity: 'warning', message: 'Title and meta description are identical - each should be unique' });
    }

    // Meta description = first paragraph (first 160 chars)
    if (metaDesc && firstP) {
      const metaLower = metaDesc.toLowerCase().substring(0, 150);
      const firstPLower = firstP.toLowerCase().substring(0, 150);
      if (metaLower === firstPLower || (metaLower.length > 50 && firstPLower.includes(metaLower))) {
        issues.push({ type: 'meta_firstp', severity: 'info', message: 'Meta description duplicates the first paragraph - write a unique summary' });
      }
    }

    // H2 that repeat the title
    h2s.forEach(h2Text => {
      if (title && h2Text.toLowerCase() === title.toLowerCase()) {
        issues.push({ type: 'h2_title', severity: 'info', message: `H2 "${h2Text.substring(0, 50)}" duplicates the title` });
      }
    });

    // H1 empty or missing
    if (!h1) {
      issues.push({ type: 'h1_missing', severity: 'error', message: 'No H1 tag found - add a unique H1' });
    }

    // Meta description missing
    if (!metaDesc) {
      issues.push({ type: 'meta_missing', severity: 'error', message: 'Meta description missing - add a unique 120-160 char description' });
    }

    return {
      issues: issues,
      issueCount: issues.length,
      hasErrors: issues.some(i => i.severity === 'error'),
      hasWarnings: issues.some(i => i.severity === 'warning')
    };
  }

  // ==================== //
  // AI Citability Score (B10)
  // ==================== //
  function analyzeCitability() {
    const body = document.body;
    const text = body ? body.innerText || '' : '';
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    if (wordCount < 50) {
      return { available: false, score: 0 };
    }

    let score = 0;
    const signals = [];

    // 1. Explicit definitions ("X is a...", "X refers to...", "defined as...")
    const explicitDefPatterns = text.match(/\b[A-Z][a-zA-ZÀ-ÿ\s]{2,40}\b(?:is defined as|is a|is an|is the|are the|refers to|means|describes|represents|can be defined as|est défini comme|est un|est une|désigne|bedeutet|es|significa)\b[^.]{10,150}\./gi) || [];
    const definitionsCount = Math.min(explicitDefPatterns.length, 10);
    score += definitionsCount * 3;
    if (definitionsCount > 0) signals.push({ label: 'Explicit definitions', count: definitionsCount, points: definitionsCount * 3 });

    // 2. Statistics with numbers ("73% of...", "in 2024...", "$1.2 billion...")
    const statsPatterns = text.match(/\b\d[\d,.]*\s?(%|percent|million|billion|milliard|thousand|trillion|x|fois|mal|veces|volte)\b/gi) || [];
    const yearPatterns = text.match(/\b(?:in|since|by|from|as of|en|seit|desde)\s+(?:20[0-2]\d|19\d\d)\b/gi) || [];
    const currencyPatterns = text.match(/[$€£¥₹]\s?\d[\d,.]*\s?(?:million|billion|trillion|thousand|k|m|b)?/gi) || [];
    const allStatsCount = Math.min(statsPatterns.length + yearPatterns.length + currencyPatterns.length, 20);
    const statsScore = Math.min(15, allStatsCount);
    score += statsScore;
    if (allStatsCount > 0) signals.push({ label: 'Statistics & numbers', count: allStatsCount, points: statsScore });

    // 3. Structured lists (ul/ol with 3+ items)
    const lists = document.querySelectorAll('ul, ol');
    let substantialLists = 0;
    lists.forEach(list => {
      const items = list.querySelectorAll(':scope > li');
      if (items.length >= 3) substantialLists++;
    });
    const listsScore = Math.min(10, substantialLists * 3);
    score += listsScore;
    if (substantialLists > 0) signals.push({ label: 'Structured lists (3+ items)', count: substantialLists, points: listsScore });

    // 4. Comparison tables (tables with headers)
    const tables = document.querySelectorAll('table');
    let comparisonTables = 0;
    tables.forEach(table => {
      const hasHeader = table.querySelector('th, thead');
      const rows = table.querySelectorAll('tr');
      if (hasHeader && rows.length >= 2) comparisonTables++;
    });
    const tablesScore = Math.min(8, comparisonTables * 4);
    score += tablesScore;
    if (comparisonTables > 0) signals.push({ label: 'Comparison tables', count: comparisonTables, points: tablesScore });
    // Also count basic tables without headers
    const basicTables = tables.length - comparisonTables;
    if (basicTables > 0) {
      const basicTablesScore = Math.min(3, basicTables);
      score += basicTablesScore;
      signals.push({ label: 'Data tables (no headers)', count: basicTables, points: basicTablesScore });
    }

    // 5. Expert quotes (blockquote elements, quotation marks with attribution)
    const blockquotes = document.querySelectorAll('blockquote, q, cite');
    let attributedQuotes = 0;
    blockquotes.forEach(bq => {
      const bqText = (bq.textContent || '').trim();
      // Check for attribution patterns like "- Name", "- Name", "said Name"
      if (bq.querySelector('cite, footer') || bqText.match(/[-–-]\s*[A-Z][a-zA-Z]/)) {
        attributedQuotes++;
      }
    });
    // Also detect inline quotes with attribution
    const inlineQuoteMatches = text.match(/[""][^""]{20,200}[""][\s,]*(?:-|–|-|said|according to|says|wrote|stated|explains|notes)\s*[A-Z]/g) || [];
    const totalQuotes = blockquotes.length + inlineQuoteMatches.length;
    const quoteScore = Math.min(8, totalQuotes * 2 + attributedQuotes * 2);
    score += quoteScore;
    if (totalQuotes > 0) signals.push({ label: 'Expert quotes', count: totalQuotes, attributed: attributedQuotes, points: quoteScore });

    // 6. Step-by-step instructions (ordered lists, "step 1", "first,...second,...third")
    const orderedLists = document.querySelectorAll('ol');
    let instructionalOLs = 0;
    orderedLists.forEach(ol => {
      const items = ol.querySelectorAll(':scope > li');
      if (items.length >= 3) instructionalOLs++;
    });
    const stepPatterns = text.match(/\b(step\s*[1-9]|first[,:]|second[,:]|third[,:]|fourth[,:]|finally[,:]|étape\s*[1-9]|schritt\s*[1-9]|paso\s*[1-9])\b/gi) || [];
    const stepsCount = instructionalOLs + Math.min(stepPatterns.length, 10);
    const stepsScore = Math.min(8, stepsCount * 2);
    score += stepsScore;
    if (stepsCount > 0) signals.push({ label: 'Step-by-step instructions', count: stepsCount, points: stepsScore });

    // 7. FAQ content (question/answer patterns, FAQ schema)
    const questionsInHeadings = document.querySelectorAll('h2, h3, h4');
    let questionHeadingCount = 0;
    questionsInHeadings.forEach(h => {
      if (/\?$/.test(h.textContent.trim())) questionHeadingCount++;
    });
    // Check for FAQ schema
    let hasFAQSchema = false;
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        if (s.textContent.includes('FAQPage')) hasFAQSchema = true;
      } catch(e) {}
    });
    // Check for FAQ-style dl elements
    const dlElements = document.querySelectorAll('dl');
    let faqDLCount = 0;
    dlElements.forEach(dl => {
      const dts = dl.querySelectorAll('dt');
      const dds = dl.querySelectorAll('dd');
      if (dts.length >= 2 && dds.length >= 2) faqDLCount++;
    });
    const faqTotalCount = questionHeadingCount + faqDLCount + (hasFAQSchema ? 3 : 0);
    const faqScore = Math.min(10, faqTotalCount * 2);
    score += faqScore;
    if (faqTotalCount > 0) signals.push({ label: 'FAQ content', count: questionHeadingCount, hasFAQSchema: hasFAQSchema, points: faqScore });

    // 8. Short self-contained paragraphs (snippable, 20-80 words)
    const paragraphs = document.querySelectorAll('p');
    let snippableParagraphs = 0;
    paragraphs.forEach(p => {
      const pText = (p.textContent || '').trim();
      const pWords = pText.split(/\s+/).filter(w => w.length > 0).length;
      if (pWords >= 20 && pWords <= 80) snippableParagraphs++;
    });
    const snippableScore = Math.min(10, Math.floor(snippableParagraphs / 2));
    score += snippableScore;
    if (snippableParagraphs > 0) signals.push({ label: 'Snippable paragraphs', count: snippableParagraphs, points: snippableScore });

    // 9. Bold/strong emphasis (highlighted key points)
    const boldCount = document.querySelectorAll('strong, b').length;
    const boldScore = Math.min(4, Math.floor(boldCount / 2));
    score += boldScore;
    if (boldCount > 0) signals.push({ label: 'Bold key points', count: boldCount, points: boldScore });

    // 10. Section headings (well-structured content)
    const h2Count = document.querySelectorAll('h2').length;
    const h3Count = document.querySelectorAll('h3').length;
    const headingScore = Math.min(8, h2Count * 2 + h3Count);
    score += headingScore;
    if (h2Count + h3Count > 0) signals.push({ label: 'Content sections', count: h2Count + h3Count, points: headingScore });

    // Normalize to 0-100
    const maxPossible = 94;
    const normalizedScore = Math.min(100, Math.round((score / maxPossible) * 100));

    return {
      available: true,
      score: normalizedScore,
      rawScore: score,
      maxPossible: maxPossible,
      signals: signals,
      signalCount: signals.length
    };
  }

  // ==================== //
  // AI Crawler View Simulator (C2)
  // ==================== //
  function analyzeAICrawlerView() {
    // Simulate what an AI crawler sees vs what's hidden
    const body = document.body;
    if (!body) return { available: false };

    // 1. Visible text (what crawlers can see)
    const visibleText = body.innerText || '';
    const visibleWordCount = visibleText.split(/\s+/).filter(w => w.length > 0).length;

    // Build a unique CSS path for an element so the popup can ask the page
    // to scroll/highlight it later. Prefers id; otherwise walks up the tree
    // using :nth-of-type to disambiguate between siblings. Used by the
    // hidden-content "find on page" affordance in the GEO AI Crawler section.
    const buildCssSelector = (el) => {
      if (!el || el === document.documentElement) return 'html';
      const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      if (el.id) return '#' + esc(el.id);
      const path = [];
      let node = el;
      while (node && node !== document.documentElement) {
        let part = node.tagName ? node.tagName.toLowerCase() : '*';
        if (node.id) { path.unshift('#' + esc(node.id)); break; }
        const parent = node.parentElement;
        if (parent) {
          const sibs = Array.from(parent.children).filter(c => c.tagName === node.tagName);
          if (sibs.length > 1) {
            part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
          }
        }
        path.unshift(part);
        node = parent;
      }
      return path.join(' > ') || 'html';
    };

    // 2. Hidden content (JS-rendered, behind interactions)
    let hiddenElements = 0;
    let lazyImages = 0;
    let jsOnlyContent = 0;

    // Elements hidden by CSS
    // Scoped to document.body only — querying '*' against the whole document
    // also walks <head>, <title>, <style>, <meta>, <link>, which always compute
    // display:none (they're never rendered) and were being misreported as
    // "hidden content" (e.g. raw CSS text inside <style> tags showing up as a
    // hidden content sample). Also exclude non-visual tags that can legally
    // appear inside <body> (script/style/template/etc.) for the same reason.
    const NON_VISUAL_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT', 'TITLE', 'HEAD']);
    // ShahzaibSEO injects its own floating toolbar, toggle button, toast, and SERP
    // sidebar directly into document.body (see content/toolbar.js and
    // content/serp-sidebar.js). Their tooltips are intentionally opacity:0
    // until hover, which made the scanner report ShahzaibSEO's own UI text
    // ("SEO Score", "GEO Score", "Domain Authority", "Ahrefs DR", "Spam Score")
    // as if it were hidden content belonging to the page being audited.
    // Resolve ShahzaibSEO's known injected root containers once (cheap, fixed-size
    // lookup) and use the native Node.contains() check per element below,
    // rather than walking up parentElement for every single node in the loop.
    const RANKSEO_ROOT_SELECTORS = ['#rankseo-toolbar', '#rankseo-toggle', '#rs-toast', '#rs-sidebar-host'];
    const rankseoRoots = RANKSEO_ROOT_SELECTORS
      .map(sel => document.querySelector(sel))
      .filter(Boolean);
    const isOwnInjectedUI = el => rankseoRoots.some(root => root === el || root.contains(el));
    const allElements = body.querySelectorAll('*');
    const hiddenSelectors = [];
    // Heuristics to turn a raw CSS reason into a plain-language explanation of
    // *why* something is likely hidden — most hidden elements on real sites
    // are intentional (responsive breakpoints, loading placeholders), not bugs.
    // This only classifies patterns that are actually detectable from the
    // element's class list / attributes; anything else falls back to
    // "unknown" rather than guessing.
    const classifyHiddenReason = el => {
      // Check the element itself plus a few ancestor levels — responsive
      // visibility classes (e.g. Fusion/Avada builder columns) are commonly
      // applied to a wrapping container, not the text node itself.
      let node = el, depth = 0;
      while (node && depth < 4) {
        const cls = (node.className && typeof node.className === 'string') ? node.className : '';
        if (/\b(fusion-no-(small|medium|large)-visibility|d-none|hidden-(xs|sm|md|lg|xl)|hide-on-(mobile|tablet|desktop))\b/i.test(cls)) {
          return 'responsive';
        }
        if (/\b(loading|spinner|placeholder|skeleton|preloader)\b/i.test(cls) || (node.id && /\b(loading|spinner)\b/i.test(node.id))) {
          return 'loading';
        }
        node = node.parentElement;
        depth++;
      }
      return 'unknown';
    };
    allElements.forEach(el => {
      if (NON_VISUAL_TAGS.has(el.tagName)) return;
      if (isOwnInjectedUI(el)) return;
      const style = window.getComputedStyle(el);
      if ((style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') && el.textContent.trim().length > 20) {
        hiddenElements++;
        if (hiddenElements <= 5) {
          hiddenSelectors.push({
            tag: el.tagName.toLowerCase(),
            text: el.textContent.trim().substring(0, 80),
            reason: style.display === 'none' ? 'display:none' : style.visibility === 'hidden' ? 'visibility:hidden' : 'opacity:0',
            likelyCause: classifyHiddenReason(el),
            selector: buildCssSelector(el)
          });
        }
      }
    });

    // Lazy-loaded images not yet loaded
    document.querySelectorAll('img').forEach(img => {
      if (img.getAttribute('loading') === 'lazy' || img.dataset.src || img.dataset.lazySrc) {
        lazyImages++;
      }
    });

    // Content behind JS interactions (tabs, accordions, modals)
    const interactiveContainers = document.querySelectorAll('[data-toggle], [data-bs-toggle], details:not([open]), .accordion-collapse:not(.show), .tab-pane:not(.active), [role="tabpanel"][hidden], [aria-hidden="true"]');
    interactiveContainers.forEach(el => {
      if (el.textContent.trim().length > 30) jsOnlyContent++;
    });

    // 3. Noscript content
    const noscripts = document.querySelectorAll('noscript');
    const hasNoscript = noscripts.length > 0;

    // 4. Iframes (opaque to crawlers)
    const iframes = document.querySelectorAll('iframe');
    const iframeCount = iframes.length;

    // 5. Shadow DOM (invisible to most crawlers)
    let shadowDomCount = 0;
    body.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) shadowDomCount++;
    });

    // Crawlability score
    const totalContentSignals = visibleWordCount + hiddenElements + jsOnlyContent;
    const visibleRatio = totalContentSignals > 0 ? Math.round((visibleWordCount / totalContentSignals) * 100) : 100;

    return {
      available: true,
      visibleWordCount,
      hiddenElements,
      hiddenSelectors,
      lazyImages,
      jsOnlyContent,
      hasNoscript,
      iframeCount,
      shadowDomCount,
      visibleRatio,
      issues: [
        ...(hiddenElements > 5 ? [{ type: 'hidden', message: `${hiddenElements} hidden content blocks may be invisible to AI crawlers` }] : []),
        ...(jsOnlyContent > 3 ? [{ type: 'js_only', message: `${jsOnlyContent} interactive sections (tabs/accordions) may not be crawled` }] : []),
        ...(iframeCount > 0 ? [{ type: 'iframes', message: `${iframeCount} iframe(s) - content inside is not accessible to crawlers` }] : []),
        ...(shadowDomCount > 0 ? [{ type: 'shadow', message: `${shadowDomCount} Shadow DOM element(s) - invisible to most crawlers` }] : []),
        ...(lazyImages > 5 ? [{ type: 'lazy', message: `${lazyImages} lazy-loaded images - may not be indexed` }] : [])
      ]
    };
  }

  // ==================== //
  // Content Gap Detector (C3)
  // ==================== //
  function analyzeContentGaps() {
    const h2s = Array.from(document.querySelectorAll('h2')).map(el => el.textContent.trim().toLowerCase());
    const h3s = Array.from(document.querySelectorAll('h3')).map(el => el.textContent.trim().toLowerCase());
    const allHeadings = [...h2s, ...h3s];
    const bodyText = getBodyText().toLowerCase();
    const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;

    const gaps = [];

    // Check for common expected sections based on page content
    const topicPatterns = [
      { keywords: ['price', 'cost', 'pricing', 'prix', 'coût', 'preis', 'precio', 'prezzo'], section: 'Pricing / Cost', relevant: /buy|shop|product|service|offer|price|plan/i },
      { keywords: ['faq', 'question', 'asked', 'foire aux questions'], section: 'FAQ Section', relevant: /guide|how|product|service/i },
      { keywords: ['review', 'testimonial', 'avis', 'témoignage', 'bewertung', 'recensione'], section: 'Reviews / Testimonials', relevant: /product|service|buy|shop/i },
      { keywords: ['compare', 'comparison', 'vs', 'alternative', 'comparatif'], section: 'Comparison / Alternatives', relevant: /product|service|tool|software|best/i },
      { keywords: ['how to', 'step', 'guide', 'tutorial', 'comment', 'anleitung', 'guida'], section: 'How-To / Steps', relevant: /learn|guide|tutorial|how|use/i },
      { keywords: ['benefit', 'advantage', 'why', 'avantage', 'pourquoi', 'vorteil'], section: 'Benefits / Why', relevant: /product|service|feature|offer/i },
      { keywords: ['conclusion', 'summary', 'takeaway', 'résumé'], section: 'Conclusion / Summary', relevant: /article|blog|guide|review/i },
      { keywords: ['example', 'case study', 'use case', 'exemple', 'beispiel'], section: 'Examples / Case Studies', relevant: /guide|how|product|service|feature/i }
    ];

    topicPatterns.forEach(pattern => {
      const hasSection = allHeadings.some(h => pattern.keywords.some(kw => h.includes(kw)));
      const isRelevant = pattern.relevant.test(bodyText.substring(0, 2000));
      if (!hasSection && isRelevant) {
        gaps.push({ section: pattern.section, type: 'missing_section' });
      }
    });

    // Content depth checks
    if (wordCount > 500 && h2s.length < 3) {
      gaps.push({ section: 'More H2 sub-sections needed', type: 'structure', detail: `${h2s.length} H2s for ${wordCount} words - consider 1 H2 per 200-300 words` });
    }
    if (wordCount > 1000 && h3s.length < 2) {
      gaps.push({ section: 'Add H3 sub-headings', type: 'structure', detail: 'Long content benefits from H3 subsections for better structure' });
    }

    // Missing media
    const images = document.querySelectorAll('img').length;
    const tables = document.querySelectorAll('table').length;
    const lists = document.querySelectorAll('ul, ol').length;

    if (wordCount > 500 && images === 0) {
      gaps.push({ section: 'Add visual content (images)', type: 'media' });
    }
    if (wordCount > 800 && tables === 0 && lists < 2) {
      gaps.push({ section: 'Add structured elements (tables or lists)', type: 'media' });
    }

    return {
      gaps,
      gapCount: gaps.length,
      headingCount: allHeadings.length,
      wordCount
    };
  }

  // ==================== //
  // Entity Extraction (C4)
  // ==================== //
  function extractEntities() {
    const body = document.body;
    if (!body) return { available: false, entities: [] };

    const text = body.innerText || '';
    const entities = [];
    const seen = new Set();

    // 1. Extract from JSON-LD structured data
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        const items = data['@graph'] ? data['@graph'] : (Array.isArray(data) ? data : [data]);
        items.forEach(item => {
          if (item.name && !seen.has(item.name.toLowerCase())) {
            seen.add(item.name.toLowerCase());
            entities.push({ name: item.name, type: item['@type'] || 'Thing', source: 'schema', linked: true });
          }
          // Author
          if (item.author) {
            const authorName = typeof item.author === 'string' ? item.author : item.author.name;
            if (authorName && !seen.has(authorName.toLowerCase())) {
              seen.add(authorName.toLowerCase());
              entities.push({ name: authorName, type: 'Person', source: 'schema', linked: true });
            }
          }
          // Publisher/Organization
          if (item.publisher?.name && !seen.has(item.publisher.name.toLowerCase())) {
            seen.add(item.publisher.name.toLowerCase());
            entities.push({ name: item.publisher.name, type: 'Organization', source: 'schema', linked: true });
          }
          // Brand
          if (item.brand?.name && !seen.has(item.brand.name.toLowerCase())) {
            seen.add(item.brand.name.toLowerCase());
            entities.push({ name: item.brand.name, type: 'Brand', source: 'schema', linked: true });
          }
        });
      } catch (e) {}
    });

    // 2. Extract from meta tags
    const metaAuthor = document.querySelector('meta[name="author"]')?.getAttribute('content');
    if (metaAuthor && !seen.has(metaAuthor.toLowerCase())) {
      seen.add(metaAuthor.toLowerCase());
      entities.push({ name: metaAuthor, type: 'Person', source: 'meta', linked: false });
    }

    // 3. Extract from visible content - Capitalized multi-word phrases (heuristic NER)
    const capPattern = /\b([A-ZÀ-Ö][a-zà-ö]+(?:\s+(?:of|the|and|de|del|di|von|van|et|und|y)\s+)?[A-ZÀ-Ö][a-zà-ö]+(?:\s+[A-ZÀ-Ö][a-zà-ö]+)?)\b/g;
    const contentSample = text.substring(0, 10000);
    let match;
    const candidateCounts = {};
    while ((match = capPattern.exec(contentSample)) !== null) {
      const name = match[1].trim();
      if (name.length >= 4 && name.length <= 60) {
        const key = name.toLowerCase();
        candidateCounts[key] = (candidateCounts[key] || { name, count: 0 });
        candidateCounts[key].count++;
      }
    }

    // Only keep entities mentioned 2+ times (reduces noise)
    Object.values(candidateCounts).forEach(({ name, count }) => {
      if (count >= 2 && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        entities.push({ name, type: 'Entity', source: 'content', linked: false, mentions: count });
      }
    });

    // Entity coverage score
    const linkedCount = entities.filter(e => e.linked).length;
    const totalCount = entities.length;
    const coverageScore = totalCount > 0 ? Math.round((linkedCount / totalCount) * 100) : 0;

    return {
      available: true,
      entities: entities.slice(0, 30),
      totalCount,
      linkedCount,
      unlinkedCount: totalCount - linkedCount,
      coverageScore
    };
  }

  // ==================== //
  // Indexation Hints Checker (C6)
  // ==================== //
  function analyzeIndexationHints() {
    const issues = [];

    // 1. Canonical URL checks
    const canonical = document.querySelector('link[rel="canonical"]');
    const canonicalHref = canonical?.getAttribute('href') || '';
    const currentUrl = window.location.href;

    if (canonical) {
      try {
        const canonicalUrl = new URL(canonicalHref, window.location.origin).href;
        const normalizedCurrent = new URL(currentUrl).href;
        if (canonicalUrl !== normalizedCurrent) {
          issues.push({ type: 'canonical_mismatch', severity: 'warning', message: `Canonical points to different URL`, detail: canonicalHref });
        }
      } catch (e) {
        issues.push({ type: 'canonical_invalid', severity: 'error', message: 'Invalid canonical URL', detail: canonicalHref });
      }
    } else {
      issues.push({ type: 'canonical_missing', severity: 'info', message: 'No canonical URL set - search engines will choose one' });
    }

    // 2. Meta robots conflicts
    const robotsMeta = document.querySelector('meta[name="robots"]');
    const robotsContent = robotsMeta?.getAttribute('content')?.toLowerCase() || '';
    const isNoindex = robotsContent.includes('noindex');
    const isNofollow = robotsContent.includes('nofollow');
    const isNosnippet = robotsContent.includes('nosnippet');
    const maxSnippet = robotsContent.match(/max-snippet:(-?\d+)/);

    if (isNoindex && canonical) {
      issues.push({ type: 'noindex_canonical', severity: 'error', message: 'Conflicting signals: page has both noindex AND canonical' });
    }
    if (isNoindex && isNofollow) {
      issues.push({ type: 'noindex_nofollow', severity: 'warning', message: 'Both noindex and nofollow - links on this page won\'t pass value' });
    }
    if (isNosnippet) {
      issues.push({ type: 'nosnippet', severity: 'warning', message: 'nosnippet prevents AI from showing your content in snippets' });
    }
    if (maxSnippet && parseInt(maxSnippet[1]) >= 0 && parseInt(maxSnippet[1]) < 50) {
      issues.push({ type: 'max_snippet_low', severity: 'info', message: `max-snippet:${maxSnippet[1]} limits snippet length - may reduce AI visibility` });
    }

    // 3. X-Robots-Tag (from meta http-equiv)
    const httpEquivRobots = document.querySelector('meta[http-equiv="X-Robots-Tag"]');
    if (httpEquivRobots) {
      issues.push({ type: 'x_robots_meta', severity: 'info', message: `X-Robots-Tag via meta: ${httpEquivRobots.getAttribute('content')}` });
    }

    // 4. Meta refresh redirect
    const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
    if (metaRefresh) {
      issues.push({ type: 'meta_refresh', severity: 'warning', message: 'Meta refresh detected - use 301 redirect instead', detail: metaRefresh.getAttribute('content') });
    }

    // 5. JavaScript redirects
    const scripts = document.querySelectorAll('script:not([src])');
    let jsRedirect = false;
    scripts.forEach(s => {
      if (/window\.location\s*[=.]|location\.href\s*=|location\.replace/i.test(s.textContent?.substring(0, 500) || '')) {
        jsRedirect = true;
      }
    });
    if (jsRedirect) {
      issues.push({ type: 'js_redirect', severity: 'warning', message: 'JavaScript redirect detected - may not be followed by all crawlers' });
    }

    // 6. Pagination
    const prevLink = document.querySelector('link[rel="prev"]');
    const nextLink = document.querySelector('link[rel="next"]');
    const hasPagination = prevLink || nextLink;

    // Summary
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    return {
      issues,
      issueCount: issues.length,
      errorCount,
      warningCount,
      isIndexable: !isNoindex,
      hasCanonical: !!canonical,
      hasPagination,
      robotsDirective: robotsContent || 'none'
    };
  }

  // ==================== //
  // Multi-language SEO Checker (C7)
  // ==================== //
  function analyzeMultiLangSeo() {
    const hreflangTags = document.querySelectorAll('link[rel="alternate"][hreflang]');
    if (hreflangTags.length === 0) {
      return { available: false, count: 0, issues: [] };
    }

    const entries = [];
    const issues = [];
    const seenLangs = new Set();

    hreflangTags.forEach(tag => {
      const lang = (tag.getAttribute('hreflang') || '').toLowerCase();
      const href = tag.getAttribute('href') || '';
      entries.push({ lang, href });
      seenLangs.add(lang);
    });

    // 1. Check for x-default
    const hasXDefault = seenLangs.has('x-default');
    if (!hasXDefault) {
      issues.push({ type: 'no_x_default', severity: 'warning', message: 'Missing x-default hreflang - add a default fallback URL' });
    }

    // 2. Check self-referencing
    const currentUrl = window.location.href;
    const currentLang = document.documentElement.getAttribute('lang')?.toLowerCase() || '';
    const hasSelfRef = entries.some(e => {
      try {
        return new URL(e.href, window.location.origin).href === new URL(currentUrl).href;
      } catch { return false; }
    });
    if (!hasSelfRef) {
      issues.push({ type: 'no_self_ref', severity: 'error', message: 'Current page not self-referenced in hreflang tags' });
    }

    // 3. Check for invalid language codes
    const validLangPattern = /^[a-z]{2}(-[a-z]{2})?$|^x-default$/;
    entries.forEach(e => {
      if (!validLangPattern.test(e.lang)) {
        issues.push({ type: 'invalid_lang', severity: 'error', message: `Invalid hreflang code: "${e.lang}"` });
      }
    });

    // 4. Check for duplicate languages
    const langCounts = {};
    entries.forEach(e => {
      langCounts[e.lang] = (langCounts[e.lang] || 0) + 1;
    });
    Object.entries(langCounts).forEach(([lang, count]) => {
      if (count > 1) {
        issues.push({ type: 'duplicate_lang', severity: 'warning', message: `Duplicate hreflang for "${lang}" (${count} times)` });
      }
    });

    // 5. Check page lang matches hreflang
    if (currentLang && !seenLangs.has(currentLang) && !seenLangs.has(currentLang.split('-')[0])) {
      issues.push({ type: 'lang_mismatch', severity: 'warning', message: `Page lang="${currentLang}" not found in hreflang tags` });
    }

    // 6. Check for empty href
    entries.forEach(e => {
      if (!e.href) {
        issues.push({ type: 'empty_href', severity: 'error', message: `Empty href for hreflang="${e.lang}"` });
      }
    });

    return {
      available: true,
      count: entries.length,
      entries,
      languages: [...seenLangs],
      hasXDefault,
      hasSelfRef,
      issues,
      issueCount: issues.length,
      pageLang: currentLang
    };
  }

  // ==================== //
  // Security SEO (B1)
  // ==================== //
  function analyzeSecuritySeo() {
    const checks = [];

    // HTTPS
    const isHttps = window.location.protocol === 'https:';
    checks.push({ id: 'https', label: 'HTTPS', passed: isHttps, detail: isHttps ? 'Secure connection' : 'Not using HTTPS - critical for SEO & trust' });

    // Mixed content detection
    let mixedContent = 0;
    if (isHttps) {
      document.querySelectorAll('img[src^="http:"], script[src^="http:"], link[href^="http:"], iframe[src^="http:"]').forEach(() => mixedContent++);
    }
    checks.push({ id: 'mixed', label: 'Mixed Content', passed: mixedContent === 0, detail: mixedContent > 0 ? `${mixedContent} insecure resource(s) loaded over HTTP` : 'No mixed content' });

    // CSP (Content Security Policy)
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    checks.push({ id: 'csp', label: 'CSP', passed: !!csp, detail: csp ? 'Content Security Policy set' : 'No CSP meta tag (may be set via HTTP header)', severity: 'info' });

    // Referrer Policy
    const referrer = document.querySelector('meta[name="referrer"]');
    checks.push({ id: 'referrer', label: 'Referrer Policy', passed: !!referrer, detail: referrer ? `Policy: ${referrer.getAttribute('content')}` : 'No referrer policy meta tag', severity: 'info' });

    // External scripts on HTTP (if page is HTTPS)
    let insecureScripts = 0;
    if (isHttps) {
      document.querySelectorAll('script[src^="http://"]').forEach(() => insecureScripts++);
    }
    if (insecureScripts > 0) {
      checks.push({ id: 'insecure_scripts', label: 'Insecure Scripts', passed: false, detail: `${insecureScripts} script(s) loaded over HTTP` });
    }

    const passed = checks.filter(c => c.passed).length;
    return { checks, passed, total: checks.length };
  }

  // ==================== //
  // Accessibility a11y (B2)
  // ==================== //
  function analyzeAccessibility() {
    const checks = [];

    // 1. Images without alt
    const imgs = document.querySelectorAll('img');
    let noAlt = 0;
    imgs.forEach(img => { if (!img.hasAttribute('alt')) noAlt++; });
    checks.push({ id: 'img_alt', label: 'Images with alt', passed: noAlt === 0, detail: noAlt > 0 ? `${noAlt} image(s) missing alt attribute` : 'All images have alt', count: noAlt });

    // 2. Form labels
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
    let noLabel = 0;
    inputs.forEach(input => {
      const id = input.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      const wrappedInLabel = input.closest('label');
      if (!hasLabel && !hasAriaLabel && !wrappedInLabel && !input.getAttribute('placeholder')) noLabel++;
    });
    checks.push({ id: 'form_labels', label: 'Form labels', passed: noLabel === 0, detail: noLabel > 0 ? `${noLabel} input(s) without accessible label` : 'All inputs labeled', count: noLabel });

    // 3. ARIA landmarks
    const hasMain = !!document.querySelector('main, [role="main"]');
    const hasNav = !!document.querySelector('nav, [role="navigation"]');
    const hasBanner = !!document.querySelector('header, [role="banner"]');
    checks.push({ id: 'landmarks', label: 'ARIA Landmarks', passed: hasMain && hasNav, detail: `main:${hasMain ? '✓' : '✗'} nav:${hasNav ? '✓' : '✗'} header:${hasBanner ? '✓' : '✗'}` });

    // 4. Skip to content link
    const firstLink = document.querySelector('a');
    const hasSkipLink = firstLink && /skip|main|content|contenu|inhalt|contenido/i.test(firstLink.textContent + (firstLink.getAttribute('href') || ''));
    checks.push({ id: 'skip_link', label: 'Skip to content', passed: !!hasSkipLink, detail: hasSkipLink ? 'Skip link present' : 'No skip-to-content link', severity: 'info' });

    // 5. Document language
    const hasLang = !!document.documentElement.getAttribute('lang');
    checks.push({ id: 'doc_lang', label: 'Document language', passed: hasLang, detail: hasLang ? `lang="${document.documentElement.getAttribute('lang')}"` : 'Missing lang attribute on <html>' });

    // 6. Heading hierarchy
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let skipLevel = false;
    let lastLevel = 0;
    headings.forEach(h => {
      const level = parseInt(h.tagName[1]);
      if (lastLevel > 0 && level > lastLevel + 1) skipLevel = true;
      lastLevel = level;
    });
    checks.push({ id: 'heading_order', label: 'Heading hierarchy', passed: !skipLevel, detail: skipLevel ? 'Heading levels are skipped (e.g., H1 → H3)' : 'Correct heading order' });

    // 7. Button/link accessible names
    const emptyButtons = document.querySelectorAll('button:empty:not([aria-label]):not([title])').length;
    if (emptyButtons > 0) {
      checks.push({ id: 'empty_buttons', label: 'Button labels', passed: false, detail: `${emptyButtons} button(s) without accessible name`, count: emptyButtons });
    }

    const passed = checks.filter(c => c.passed).length;
    return { checks, passed, total: checks.length };
  }

  // ==================== //
  // JavaScript Errors & Broken Resources (B6)
  // ==================== //
  function analyzeJsErrors() {
    const issues = [];

    // Broken images (img with error state)
    const imgs = document.querySelectorAll('img');
    let brokenImages = 0;
    imgs.forEach(img => {
      if (img.naturalWidth === 0 && img.naturalHeight === 0 && img.src && !img.src.startsWith('data:') && img.complete) {
        brokenImages++;
      }
    });
    if (brokenImages > 0) {
      issues.push({ type: 'broken_images', severity: 'warning', message: `${brokenImages} broken image(s) detected`, count: brokenImages });
    }

    // Empty links (already counted but surface here)
    const emptyLinks = document.querySelectorAll('a[href=""], a[href="#"], a[href="javascript:void(0)"]').length;
    if (emptyLinks > 0) {
      issues.push({ type: 'empty_links', severity: 'info', message: `${emptyLinks} empty/placeholder link(s)`, count: emptyLinks });
    }

    // Inline event handlers (bad practice)
    const inlineHandlers = document.querySelectorAll('[onclick], [onmouseover], [onload], [onerror]').length;
    if (inlineHandlers > 3) {
      issues.push({ type: 'inline_handlers', severity: 'info', message: `${inlineHandlers} inline event handler(s) - consider external JS`, count: inlineHandlers });
    }

    // Console errors (capture what we can)
    // Note: We can't read past console errors, but we can check for common issues
    const deprecatedAPIs = document.querySelectorAll('applet, blink, marquee, frame, frameset').length;
    if (deprecatedAPIs > 0) {
      issues.push({ type: 'deprecated', severity: 'warning', message: `${deprecatedAPIs} deprecated HTML element(s)`, count: deprecatedAPIs });
    }

    return { issues, issueCount: issues.length };
  }

  // ==================== //
  // Fonts & CSS Performance (B7)
  // ==================== //
  function analyzeFontsPerf() {
    // Font faces
    const fontLinks = document.querySelectorAll('link[href*="fonts.googleapis"], link[href*="fonts.gstatic"], link[href*="use.typekit"], link[rel="preload"][as="font"]');
    const fontFaceRules = [];
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (rule instanceof CSSFontFaceRule) {
              const family = rule.style.getPropertyValue('font-family').replace(/['"]/g, '');
              const display = rule.style.getPropertyValue('font-display') || 'auto';
              const src = rule.style.getPropertyValue('src') || '';
              fontFaceRules.push({ family, display, isSwap: display === 'swap' || display === 'optional' });
            }
          }
        } catch (e) {} // Cross-origin sheets throw
      }
    } catch (e) {}

    // Unique font families used
    const uniqueFonts = new Set(fontFaceRules.map(f => f.family));

    // Font-display check
    const withSwap = fontFaceRules.filter(f => f.isSwap).length;
    const withoutSwap = fontFaceRules.filter(f => !f.isSwap).length;

    // Preloaded fonts
    const preloadedFonts = document.querySelectorAll('link[rel="preload"][as="font"]').length;

    // CSS files count
    const cssFiles = document.querySelectorAll('link[rel="stylesheet"]').length;
    const inlineStyles = document.querySelectorAll('style').length;

    // Critical CSS (check if styles are in head)
    const headStyles = document.querySelectorAll('head style').length;
    const hasCriticalCss = headStyles > 0;

    return {
      fontFaceCount: fontFaceRules.length,
      uniqueFontCount: uniqueFonts.size,
      fontFamilies: [...uniqueFonts].slice(0, 10),
      withSwap,
      withoutSwap,
      preloadedFonts,
      cssFiles,
      inlineStyles,
      hasCriticalCss,
      fontLinks: fontLinks.length
    };
  }

  // ==================== //
  // Design Tokens: fonts used + main colors
  // ==================== //
  function analyzeDesignTokens() {
    // --- Font detection (from computed styles of visible elements) ---
    const fontCounts = {};
    const colorCounts = {};
    const bgColorCounts = {};

    // Sample up to 200 visible text-bearing elements
    const textSelectors = 'h1,h2,h3,h4,h5,h6,p,span,a,li,td,th,button,label,input,blockquote,figcaption,strong,em,b,i';
    const elements = document.querySelectorAll(textSelectors);
    const sample = [];
    elements.forEach((el, i) => {
      if (sample.length >= 200) return;
      if (el.offsetParent === null && el.style.display !== 'contents') return; // hidden
      if ((el.textContent || '').trim().length < 2) return;
      sample.push(el);
    });

    sample.forEach(el => {
      const style = window.getComputedStyle(el);

      // Font family (first in the stack)
      const fontFamily = style.fontFamily;
      if (fontFamily) {
        const primary = fontFamily.split(',')[0].trim().replace(/['"]/g, '');
        if (primary && primary.length < 40) {
          fontCounts[primary] = (fontCounts[primary] || 0) + 1;
        }
      }

      // Text color
      const color = style.color;
      if (color && color !== 'rgba(0, 0, 0, 0)') {
        colorCounts[color] = (colorCounts[color] || 0) + 1;
      }

      // Background color
      const bg = style.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        bgColorCounts[bg] = (bgColorCounts[bg] || 0) + 1;
      }
    });

    // Also sample body and main containers for bg colors
    ['body', 'main', 'header', 'footer', 'nav', '.container', '#app', '#root'].forEach(sel => {
      try {
        const el = document.querySelector(sel);
        if (!el) return;
        const bg = window.getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          bgColorCounts[bg] = (bgColorCounts[bg] || 0) + 5; // weight structural elements
        }
      } catch (e) {}
    });

    // Sort by frequency
    const topFonts = Object.entries(fontCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));

    const topColors = Object.entries(colorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([color, count]) => ({ color, count }));

    const topBgColors = Object.entries(bgColorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([color, count]) => ({ color, count }));

    return {
      fonts: topFonts,
      textColors: topColors,
      bgColors: topBgColors
    };
  }

  // ==================== //
  // Video Analysis (B9)
  // ==================== //
  function analyzeVideos() {
    const videos = [];

    // HTML5 video elements
    document.querySelectorAll('video').forEach(vid => {
      videos.push({
        type: 'html5',
        src: vid.src || vid.querySelector('source')?.src || '',
        hasLazy: vid.getAttribute('loading') === 'lazy' || vid.hasAttribute('data-src'),
        width: vid.width || vid.getAttribute('width') || '',
        height: vid.height || vid.getAttribute('height') || ''
      });
    });

    // YouTube embeds
    document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtu.be"], iframe[data-src*="youtube"]').forEach(iframe => {
      const src = iframe.src || iframe.dataset.src || '';
      videos.push({
        type: 'youtube',
        src: src,
        hasLazy: iframe.getAttribute('loading') === 'lazy' || iframe.hasAttribute('data-src'),
        width: iframe.width || iframe.getAttribute('width') || '',
        height: iframe.height || iframe.getAttribute('height') || ''
      });
    });

    // Vimeo embeds
    document.querySelectorAll('iframe[src*="vimeo.com"], iframe[data-src*="vimeo"]').forEach(iframe => {
      const src = iframe.src || iframe.dataset.src || '';
      videos.push({
        type: 'vimeo',
        src: src,
        hasLazy: iframe.getAttribute('loading') === 'lazy' || iframe.hasAttribute('data-src'),
        width: iframe.width || iframe.getAttribute('width') || '',
        height: iframe.height || iframe.getAttribute('height') || ''
      });
    });

    // Check for VideoObject schema
    let hasVideoSchema = false;
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        if (/VideoObject/i.test(script.textContent)) hasVideoSchema = true;
      } catch (e) {}
    });

    // Issues
    const notLazy = videos.filter(v => !v.hasLazy).length;
    const issues = [];
    if (videos.length > 0 && !hasVideoSchema) {
      issues.push({ message: 'Video found but no VideoObject schema - add JSON-LD for video rich results' });
    }
    if (notLazy > 0) {
      issues.push({ message: `${notLazy} video(s) without lazy loading - consider loading="lazy" on iframes` });
    }

    return {
      count: videos.length,
      videos: videos.slice(0, 10),
      hasVideoSchema,
      notLazy,
      issues,
      types: {
        html5: videos.filter(v => v.type === 'html5').length,
        youtube: videos.filter(v => v.type === 'youtube').length,
        vimeo: videos.filter(v => v.type === 'vimeo').length
      }
    };
  }

  // ==================== //
  // Page Weight Budget (C8)
  // ==================== //
  function analyzePageWeight() {
    const encoder = new TextEncoder();

    // HTML size
    const htmlBytes = encoder.encode(document.documentElement.outerHTML).length;

    // Inline CSS
    let inlineCssBytes = 0;
    document.querySelectorAll('style').forEach(s => {
      inlineCssBytes += encoder.encode(s.textContent || '').length;
    });

    // Inline JS
    let inlineJsBytes = 0;
    document.querySelectorAll('script:not([src])').forEach(s => {
      if (s.type !== 'application/ld+json' && s.type !== 'application/json') {
        inlineJsBytes += encoder.encode(s.textContent || '').length;
      }
    });

    // Count external resources (can't measure bytes without fetching)
    const extCss = document.querySelectorAll('link[rel="stylesheet"]').length;
    const extJs = document.querySelectorAll('script[src]').length;
    const images = document.querySelectorAll('img[src]').length;
    const fonts = document.querySelectorAll('link[rel="preload"][as="font"], link[href*="fonts.googleapis"]').length;

    // Third-party resources
    const currentHost = window.location.hostname;
    let thirdPartyCount = 0;
    document.querySelectorAll('script[src], link[href], img[src]').forEach(el => {
      const src = el.src || el.href || '';
      try {
        if (src && new URL(src).hostname !== currentHost) thirdPartyCount++;
      } catch (e) {}
    });

    // Budget assessment (1.5MB ideal, 3MB warning, 5MB+ error for total estimated)
    const estimatedTotal = htmlBytes + inlineCssBytes + inlineJsBytes;
    const formatBytes = (b) => {
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
      return (b / (1024 * 1024)).toFixed(2) + ' MB';
    };

    return {
      html: { bytes: htmlBytes, formatted: formatBytes(htmlBytes) },
      inlineCss: { bytes: inlineCssBytes, formatted: formatBytes(inlineCssBytes) },
      inlineJs: { bytes: inlineJsBytes, formatted: formatBytes(inlineJsBytes) },
      inlineTotal: { bytes: estimatedTotal, formatted: formatBytes(estimatedTotal) },
      counts: { extCss, extJs, images, fonts, thirdParty: thirdPartyCount },
      totalResources: extCss + extJs + images + fonts
    };
  }

  // ==================== //
  // Keyword Analysis
  // ==================== //
  function analyzeKeywords(analysis) {
    const title = (analysis.title?.content || document.title || '').toLowerCase();
    const metaDesc = (analysis.metaDescription?.content || '').toLowerCase();
    const url = (window.location.pathname + window.location.search).toLowerCase();
    const h1Texts = (analysis.headings?.structure?.h1 || []).map(h => (h.text || '').toLowerCase());
    const h2Texts = (analysis.headings?.structure?.h2 || []).map(h => (h.text || '').toLowerCase());
    const h3Texts = (analysis.headings?.structure?.h3 || []).map(h => (h.text || '').toLowerCase());
    const h4Texts = (analysis.headings?.structure?.h4 || []).map(h => (h.text || '').toLowerCase());
    const h5Texts = (analysis.headings?.structure?.h5 || []).map(h => (h.text || '').toLowerCase());
    const h6Texts = (analysis.headings?.structure?.h6 || []).map(h => (h.text || '').toLowerCase());
    const allSubHeadings = [...h2Texts, ...h3Texts, ...h4Texts, ...h5Texts, ...h6Texts];
    const allHeadings = [...h1Texts, ...allSubHeadings];
    // NOTE: analyzeImages() returns the array under the `images` key, not `list`.
    // The previous `analysis.images?.list` always resolved to undefined, so alt
    // text keyword extraction was silently no-op.
    const altTexts = (analysis.images?.images || []).map(img => (img.alt || '').toLowerCase()).filter(Boolean);

    // Extended stopwords (EN, FR, DE, ES, IT)
    const stopwords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'this',
      'that', 'these', 'those', 'it', 'its', 'as', 'if', 'then', 'than',
      'so', 'such', 'no', 'not', 'only', 'own', 'same', 'into', 'also',
      'very', 'just', 'about', 'above', 'after', 'again', 'all', 'am',
      'any', 'because', 'before', 'below', 'between', 'both', 'each',
      'few', 'get', 'got', 'he', 'her', 'here', 'him', 'his', 'how',
      'me', 'more', 'most', 'my', 'new', 'now', 'off', 'old', 'once',
      'one', 'our', 'out', 'over', 'she', 'some', 'still', 'too', 'up',
      'us', 'use', 'way', 'we', 'what', 'when', 'where', 'which', 'while',
      'who', 'whom', 'why', 'you', 'your',
      // French - comprehensive
      'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'en', 'est',
      'que', 'qui', 'dans', 'pour', 'sur', 'avec', 'ce', 'cette', 'ces',
      'son', 'sa', 'ses', 'leur', 'leurs', 'nous', 'vous', 'ils', 'elles',
      'par', 'plus', 'pas', 'au', 'aux', 'ou', 'mais', 'donc', 'car',
      'ne', 'se', 'si', 'tout', 'tous', 'toute', 'toutes', 'bien', 'fait',
      'votre', 'vos', 'notre', 'nos', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes',
      'il', 'elle', 'on', 'je', 'tu', 'me', 'te', 'lui', 'eux',
      'ai', 'as', 'ont', 'sont', 'suis', 'sommes', 'etes', 'avons', 'avez',
      'etre', 'avoir', 'faire', 'dit', 'va', 'vont', 'peut', 'doit',
      'meme', 'aussi', 'tres', 'peu', 'trop', 'assez', 'ici', 'la',
      'dont', 'sans', 'sous', 'entre', 'vers', 'chez', 'apres', 'avant',
      'depuis', 'pendant', 'contre', 'selon', 'lors', 'des', 'jusque',
      'autre', 'autres', 'cet', 'celui', 'celle', 'ceux', 'celles',
      'quoi', 'quel', 'quelle', 'quels', 'quelles', 'comment', 'quand',
      'non', 'oui', 'ni', 'soit', 'alors', 'encore', 'deja', 'toujours',
      'jamais', 'rien', 'chaque', 'quelque', 'plusieurs', 'certains',
      // German - comprehensive
      'der', 'die', 'das', 'ein', 'eine', 'und', 'ist', 'von', 'den',
      'dem', 'mit', 'auf', 'fur', 'für', 'nicht', 'sich', 'des', 'als', 'auch',
      'nach', 'wie', 'bei', 'noch', 'nur', 'aus', 'uber', 'über', 'hat', 'sind',
      'wird', 'oder', 'aber', 'wenn', 'dass', 'kann', 'mehr', 'sehr',
      'schon', 'immer', 'alle', 'dieser', 'jeder', 'wurde', 'haben',
      'mein', 'dein', 'sein', 'ihr', 'kein', 'wir', 'sie', 'ich', 'du',
      'mir', 'uns', 'hier', 'dort', 'zum', 'zur', 'vor', 'bis',
      'unter', 'zwischen', 'gegen', 'ohne', 'durch', 'warum', 'weil',
      'doch', 'dann', 'wann', 'gar', 'ganz', 'so', 'da', 'nun',
      // Spanish - comprehensive
      'del', 'los', 'las', 'una', 'con', 'por', 'para', 'como', 'mas', 'más',
      'pero', 'sus', 'sin', 'sobre', 'este', 'entre', 'cuando', 'muy',
      'ser', 'hay', 'fue', 'son', 'tiene', 'esta', 'está', 'esto',
      'todo', 'todos', 'toda', 'todas', 'otro', 'otra', 'otros', 'otras',
      'cual', 'donde', 'quien', 'cada', 'puede', 'desde', 'hasta',
      'tambien', 'también', 'ya', 'bien', 'antes', 'despues', 'después',
      'mismo', 'misma', 'nuestro', 'nuestra', 'vuestro', 'vuestra',
      'el', 'ella', 'ellos', 'ellas', 'nos', 'les', 'lo', 'la',
      'mi', 'tu', 'su', 'me', 'te', 'se', 'nos', 'les',
      'algo', 'nada', 'mucho', 'poco', 'tan', 'eso', 'esa',
      // Italian - comprehensive
      'che', 'non', 'per', 'sono', 'come', 'anche', 'piu', 'più', 'sua', 'suo',
      'dal', 'nel', 'della', 'dello', 'degli', 'delle', 'alla', 'alle',
      'uno', 'tra', 'era', 'hanno', 'loro', 'stato', 'essere', 'fatto',
      'questo', 'questa', 'questi', 'queste', 'quello', 'quella',
      'cosa', 'dove', 'quando', 'perche', 'perché', 'dopo', 'prima',
      'ancora', 'senza', 'solo', 'molto', 'altri', 'ogni', 'sempre',
      'mai', 'tutto', 'tutti', 'tutta', 'tutte', 'nostro', 'nostra',
      'quale', 'chi', 'cui', 'cioe', 'cioè', 'sia', 'poi', 'gia', 'già',
      'io', 'tu', 'lui', 'lei', 'noi', 'voi', 'mi', 'ti', 'ci', 'vi',
      // Portuguese
      'dos', 'das', 'uma', 'sao', 'são', 'mais', 'seu', 'sua', 'mas',
      'tem', 'foi', 'nos', 'sem', 'pode', 'cada', 'outro', 'outra',
      'quando', 'muito', 'bem', 'tambem', 'também', 'ate', 'até',
      'depois', 'nosso', 'nossa', 'todos', 'onde', 'ainda', 'mesmo',
      'nao', 'não', 'isso', 'essa', 'esse', 'voce', 'você', 'ele', 'ela'
    ]);

    // Get main content text
    const mainText = extractMainContentText();
    const bodyText = getBodyText();
    const words = bodyText.split(/\s+/).filter(w => w.length > 0);
    const totalWordCount = words.length;

    // Get first 100 words for first-paragraph analysis
    const firstParagraphWords = mainText.split(/\s+/).slice(0, 100).join(' ').toLowerCase();

    // ---- Bold & Italic text extraction ----
    function getTextFromElements(selectors) {
      const texts = [];
      try {
        document.querySelectorAll(selectors).forEach(el => {
          const t = (el.textContent || '').trim();
          if (t.length > 0) texts.push(t.toLowerCase());
        });
      } catch(e) {}
      return texts;
    }

    const boldTexts = getTextFromElements('strong, b');
    const italicTexts = getTextFromElements('em, i');

    // Also detect CSS bold/italic
    try {
      const contentElements = document.querySelectorAll('p, li, td, th, span, div, blockquote');
      contentElements.forEach(el => {
        if (el.children.length > 3) return; // skip containers
        const style = window.getComputedStyle(el);
        const text = (el.textContent || '').trim().toLowerCase();
        if (!text || text.length > 200) return;
        if ((parseInt(style.fontWeight) >= 700 || style.fontWeight === 'bold') && !el.matches('strong, b, h1, h2, h3, h4, h5, h6')) {
          boldTexts.push(text);
        }
        if (style.fontStyle === 'italic' && !el.matches('em, i')) {
          italicTexts.push(text);
        }
      });
    } catch(e) {}

    const allBoldText = boldTexts.join(' ');
    const allItalicText = italicTexts.join(' ');

    // ---- N-gram extraction ----
    function extractNgrams(text, n) {
      const cleanWords = text.toLowerCase()
        .replace(/[^a-zàâäéèêëïîôùûüçñßöü0-9\s'-]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1);
      const ngrams = {};
      for (let i = 0; i <= cleanWords.length - n; i++) {
        const gram = cleanWords.slice(i, i + n);
        // Skip if starts or ends with stopword for n>1
        if (n > 1 && (stopwords.has(gram[0]) || stopwords.has(gram[gram.length - 1]))) continue;
        // Skip if all words are stopwords
        if (gram.every(w => stopwords.has(w) || w.length <= 2)) continue;
        const key = gram.join(' ');
        ngrams[key] = (ngrams[key] || 0) + 1;
      }
      return ngrams;
    }

    // Extract 1-gram through 4-gram from main content
    const unigrams = {};
    words.forEach(word => {
      const w = word.toLowerCase().replace(/[^a-zàâäéèêëïîôùûüçñßöü0-9'-]/gi, '');
      if (w.length > 2 && !stopwords.has(w)) {
        unigrams[w] = (unigrams[w] || 0) + 1;
      }
    });

    const bigrams = extractNgrams(mainText, 2);
    const trigrams = extractNgrams(mainText, 3);
    const quadgrams = extractNgrams(mainText, 4);

    // Helper: check if a word/phrase appears in text
    // Uses Unicode-aware word boundaries since \b doesn't handle accented
    // characters (é, à, ç, ñ, ö, etc.) correctly in JavaScript regex.
    function containsWord(text, word) {
      if (!text || !word) return false;
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('(?<![a-zA-Zàâäéèêëïîôùûüçñßöüáíóúãõ])' + escaped + '(?![a-zA-Zàâäéèêëïîôùûüçñßöüáíóúãõ])', 'i');
      return regex.test(text);
    }

    // Helper: count occurrences of word in text array
    function countInTexts(texts, word) {
      return texts.filter(t => containsWord(t, word)).length;
    }

    // ---- Build unified keyword list ----
    function buildKeywordEntries(ngramMap, ngramSize) {
      return Object.entries(ngramMap)
        .filter(([, count]) => count >= 2) // at least 2 occurrences
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([word, count]) => {
          const density = totalWordCount > 0 ? parseFloat(((count / totalWordCount) * 100).toFixed(2)) : 0;
          const inBold = boldTexts.filter(t => containsWord(t, word)).length;
          const inItalic = italicTexts.filter(t => containsWord(t, word)).length;
          const inTitle = containsWord(title, word);
          const inMetaDesc = containsWord(metaDesc, word);
          const inUrl = containsWord(url, word);
          const inFirstParagraph = containsWord(firstParagraphWords, word);
          const inH1 = countInTexts(h1Texts, word);
          const inH2H6 = countInTexts(allSubHeadings, word);
          const inAlt = countInTexts(altTexts, word);

          // Prominence score (0-100)
          let prominence = 0;
          if (inTitle) prominence += 25;
          if (inH1 > 0) prominence += 20;
          if (inUrl) prominence += 15;
          if (inMetaDesc) prominence += 10;
          if (inFirstParagraph) prominence += 10;
          if (inH2H6 > 0) prominence += 8;
          if (inAlt > 0) prominence += 5;
          if (inBold > 0) prominence += 4;
          if (inItalic > 0) prominence += 3;

          return {
            word,
            count,
            density,
            ngramSize,
            inBold,
            inItalic,
            inTitle,
            inMetaDesc,
            inUrl,
            inFirstParagraph,
            inH1,
            inH2H6,
            inAlt,
            prominence: Math.min(100, prominence)
          };
        });
    }

    const kw1 = buildKeywordEntries(unigrams, 1);
    const kw2 = buildKeywordEntries(bigrams, 2);
    const kw3 = buildKeywordEntries(trigrams, 3);
    const kw4 = buildKeywordEntries(quadgrams, 4);

    // ---- Keyword Stuffing Detection ----
    const stuffingAlerts = [];
    kw1.forEach(kw => {
      if (kw.density > 4) {
        stuffingAlerts.push({ word: kw.word, density: kw.density, severity: 'error', type: 'high_density' });
      } else if (kw.density > 2.5) {
        stuffingAlerts.push({ word: kw.word, density: kw.density, severity: 'warning', type: 'elevated_density' });
      }
    });

    // Check heading repetition
    if (allHeadings.length > 2) {
      const headingWordFreq = {};
      allHeadings.forEach(h => {
        const hw = h.split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w));
        hw.forEach(w => { headingWordFreq[w] = (headingWordFreq[w] || 0) + 1; });
      });
      Object.entries(headingWordFreq).forEach(([word, count]) => {
        if (count > allHeadings.length * 0.5 && count >= 3) {
          stuffingAlerts.push({ word, count, severity: 'warning', type: 'heading_repetition' });
        }
      });
    }

    // ---- Consistency Checks ----
    const consistencyIssues = [];

    // Extract target keywords from title
    const titleWords = title.split(/\s+/)
      .map(w => w.replace(/[^a-zàâäéèêëïîôùûüçñßöü0-9]/gi, ''))
      .filter(w => w.length > 3 && !stopwords.has(w));

    // Extract target keywords from H1
    const h1Words = h1Texts.join(' ').split(/\s+/)
      .map(w => w.replace(/[^a-zàâäéèêëïîôùûüçñßöü0-9]/gi, ''))
      .filter(w => w.length > 3 && !stopwords.has(w));

    // Title keywords not in body content
    const bodyLower = mainText.toLowerCase();
    titleWords.forEach(w => {
      if (!containsWord(bodyLower, w)) {
        consistencyIssues.push({ type: 'title_not_in_body', word: w, severity: 'warning' });
      }
    });

    // H1 keywords not in subheadings
    h1Words.forEach(w => {
      if (!allSubHeadings.some(h => containsWord(h, w))) {
        consistencyIssues.push({ type: 'h1_not_in_subheadings', word: w, severity: 'info' });
      }
    });

    // Title keywords not in bold
    const importantKw = [...new Set([...titleWords, ...h1Words])];
    const hasAnyBold = boldTexts.length > 0;
    if (hasAnyBold) {
      importantKw.forEach(w => {
        if (!containsWord(allBoldText, w)) {
          consistencyIssues.push({ type: 'important_not_bold', word: w, severity: 'info' });
        }
      });
    }

    // Title keywords not in first paragraph
    titleWords.forEach(w => {
      if (!containsWord(firstParagraphWords, w)) {
        consistencyIssues.push({ type: 'title_not_in_first_para', word: w, severity: 'info' });
      }
    });

    // ---- Bold & Italic emphasis summary ----
    const boldWords = [];
    boldTexts.forEach(text => {
      const bw = text.split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w.toLowerCase()));
      bw.forEach(w => {
        const existing = boldWords.find(e => e.word === w.toLowerCase());
        if (existing) existing.count++;
        else boldWords.push({ word: w.toLowerCase(), count: 1, context: text.substring(0, 80) });
      });
    });
    boldWords.sort((a, b) => b.count - a.count);

    const italicWords = [];
    italicTexts.forEach(text => {
      const iw = text.split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w.toLowerCase()));
      iw.forEach(w => {
        const existing = italicWords.find(e => e.word === w.toLowerCase());
        if (existing) existing.count++;
        else italicWords.push({ word: w.toLowerCase(), count: 1, context: text.substring(0, 80) });
      });
    });
    italicWords.sort((a, b) => b.count - a.count);

    // ---- Keyword Placement Matrix for target keywords ----
    const targetKeywords = [...new Set([...titleWords.slice(0, 5), ...h1Words.slice(0, 5)])].slice(0, 10);
    const placementMatrix = targetKeywords.map(word => ({
      word,
      inTitle: containsWord(title, word),
      inH1: h1Texts.some(h => containsWord(h, word)),
      inH2H6: allSubHeadings.some(h => containsWord(h, word)),
      inMetaDesc: containsWord(metaDesc, word),
      inUrl: containsWord(url, word),
      inFirstParagraph: containsWord(firstParagraphWords, word),
      inAlt: altTexts.some(a => containsWord(a, word)),
      inBold: containsWord(allBoldText, word),
      inItalic: containsWord(allItalicText, word)
    }));

    // ---- Keyword Score Calculation (0-100) ----
    let keywordScore = 50; // base

    // Positive signals
    if (kw1.length > 0 && kw1[0].prominence >= 50) keywordScore += 10;
    if (placementMatrix.length > 0) {
      const avgPlacement = placementMatrix.reduce((sum, p) => {
        let pts = 0;
        if (p.inTitle) pts++;
        if (p.inH1) pts++;
        if (p.inH2H6) pts++;
        if (p.inMetaDesc) pts++;
        if (p.inFirstParagraph) pts++;
        return sum + pts;
      }, 0) / placementMatrix.length;
      keywordScore += Math.round(avgPlacement * 6); // up to +30
    }
    if (boldWords.length > 0) keywordScore += 5;
    if (stuffingAlerts.length === 0) keywordScore += 5;

    // Negative signals
    stuffingAlerts.forEach(a => {
      if (a.severity === 'error') keywordScore -= 10;
      else keywordScore -= 5;
    });
    consistencyIssues.filter(i => i.severity === 'warning').forEach(() => { keywordScore -= 3; });

    keywordScore = Math.max(0, Math.min(100, keywordScore));

    // ---- Vocabulary metrics (moved from readability) ----
    const ra = analysis.readabilityAdvanced || {};
    const vocabRichness = ra.vocabRichness || 0;
    const complexWordPercent = ra.complexWordPercent || 0;
    const avgSyllablesPerWord = ra.avgSyllablesPerWord || 0;

    // ---- Question Keywords Detection ----
    const questionPatterns = /\b(who|what|where|when|why|how|which|can|should|is|are|do|does|will|qu'est|pourquoi|comment|quand|quel|quelle|combien|est-ce)\b[^.!?]{5,120}\?/gi;
    const questionMatches = mainText.match(questionPatterns) || [];
    // Dedupe by normalized form (whitespace-collapsed, lowercased) so a
    // question that appears twice on the page (e.g. in an FAQ + a CTA) is
    // only listed once. We keep the first occurrence for display.
    const seenQuestions = new Set();
    const questionKeywords = [];
    for (const raw of questionMatches) {
      const q = raw.trim();
      const normalized = q.toLowerCase().replace(/\s+/g, ' ');
      if (seenQuestions.has(normalized)) continue;
      seenQuestions.add(normalized);
      questionKeywords.push(q);
      if (questionKeywords.length >= 20) break;
    }

    // ---- Image Filename Keyword Check ----
    // Same fix as altTexts above - the correct key is `images`, not `list`.
    const imageFilenames = (analysis.images?.images || []).map(img => {
      try {
        const urlObj = new URL(img.src || '', window.location.href);
        return urlObj.pathname.split('/').pop().toLowerCase().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      } catch(e) { return ''; }
    }).filter(Boolean);

    // ---- Anchor Text Keyword Analysis ----
    const internalAnchorTexts = (analysis.links?.links || [])
      .filter(l => l.isInternal && l.text)
      .map(l => l.text.toLowerCase());

    // ---- Distribution Heatmap (3 tiers) ----
    const contentWords = mainText.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const totalContentWords = contentWords.length;
    const thirdSize = Math.ceil(totalContentWords / 3);
    const tier1 = contentWords.slice(0, thirdSize).join(' ');
    const tier2 = contentWords.slice(thirdSize, thirdSize * 2).join(' ');
    const tier3 = contentWords.slice(thirdSize * 2).join(' ');

    const distributionData = (kw1.slice(0, 5)).map(kw => {
      const w = kw.word;
      const countInTier = (text, word) => {
        const regex = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        return (text.match(regex) || []).length;
      };
      return {
        word: w,
        tiers: [countInTier(tier1, w), countInTier(tier2, w), countInTier(tier3, w)]
      };
    });

    // ---- First/Last Position Tracking ----
    const positionTracking = kw1.slice(0, 15).map(kw => {
      const w = kw.word.toLowerCase();
      let firstPos = -1, lastPos = -1;
      for (let i = 0; i < contentWords.length; i++) {
        const cw = contentWords[i].replace(/[^a-zàâäéèêëïîôùûüçñßöü0-9]/gi, '');
        if (cw === w) {
          if (firstPos === -1) firstPos = i;
          lastPos = i;
        }
      }
      return { word: w, firstPosition: firstPos, lastPosition: lastPos, totalWords: totalContentWords };
    });

    // ---- Enrich placement matrix with image filenames & anchor text ----
    const enrichedPlacementMatrix = placementMatrix.map(p => ({
      ...p,
      inImageFilename: imageFilenames.some(fn => containsWord(fn, p.word)),
      inAnchorText: internalAnchorTexts.some(at => containsWord(at, p.word))
    }));

    return {
      score: keywordScore,
      totalWordCount,
      uniqueKeywords: Object.keys(unigrams).length,
      totalBoldKeywords: boldTexts.length,
      totalItalicKeywords: italicTexts.length,
      unigrams: kw1,
      bigrams: kw2,
      trigrams: kw3,
      quadgrams: kw4,
      placementMatrix: enrichedPlacementMatrix,
      stuffingAlerts,
      consistencyIssues,
      boldWords: boldWords.slice(0, 30),
      italicWords: italicWords.slice(0, 30),
      boldTexts: boldTexts.slice(0, 50),
      italicTexts: italicTexts.slice(0, 50),
      vocabRichness,
      complexWordPercent,
      avgSyllablesPerWord,
      questionKeywords,
      distributionData,
      positionTracking
    };
  }

  function calculateOverallScore(analysis) {
    let score = 100;
    const issues = [];

    // Title
    if (analysis.title?.status === 'error') {
      score -= 15;
      issues.push(analysis.title.message);
    } else if (analysis.title?.status === 'warning') {
      score -= 5;
      issues.push(analysis.title.message);
    }

    // Meta description
    if (analysis.metaDescription?.status === 'error') {
      score -= 10;
      issues.push(analysis.metaDescription.message);
    } else if (analysis.metaDescription?.status === 'warning') {
      score -= 5;
      issues.push(analysis.metaDescription.message);
    }

    // Headings
    if (analysis.headings?.status === 'error') {
      score -= 10;
      issues.push(analysis.headings.message);
    } else if (analysis.headings?.status === 'warning') {
      score -= 5;
      issues.push(analysis.headings.message);
    }

    // Images
    if (analysis.images?.status === 'error') {
      score -= 10;
      issues.push(analysis.images.message);
    } else if (analysis.images?.status === 'warning') {
      score -= 5;
      issues.push(analysis.images.message);
    }

    // Technical
    if (analysis.technical?.viewport?.status === 'error') {
      score -= 15;
      issues.push(analysis.technical.viewport.message);
    }
    if (analysis.technical?.canonical?.status === 'warning') {
      score -= 5;
      issues.push(analysis.technical.canonical.message);
    }
    if (analysis.technical?.language?.status === 'warning') {
      score -= 3;
      issues.push(analysis.technical.language.message);
    }

    // Social
    if (analysis.social?.status === 'warning') {
      score -= 5;
      issues.push(analysis.social.message);
    }

    // Structured data
    if (analysis.structured?.status === 'warning') {
      score -= 5;
      issues.push(analysis.structured.message);
    }

    // Content
    if (analysis.content?.status === 'error') {
      score -= 10;
      issues.push(analysis.content.message);
    } else if (analysis.content?.status === 'warning') {
      score -= 5;
      issues.push(analysis.content.message);
    }

    // Links
    if (analysis.links?.status === 'warning') {
      score -= 3;
      issues.push(analysis.links.message);
    }

    // New checks - penalties
    if (analysis.technical?.indexability?.isNoindex) {
      score -= 15;
      issues.push(analysis.technical.indexability.message);
    }
    if (analysis.technical?.url?.isLong) {
      score -= 3;
      issues.push('URL too long (>100 characters)');
    }
    if (analysis.technical?.url?.hasUppercase) {
      score -= 2;
      issues.push('URL contains uppercase characters');
    }
    if (analysis.technical?.duplicateTitleH1?.isDuplicate) {
      score -= 3;
      issues.push('Title and H1 are identical (differentiate for better SEO)');
    }
    if (analysis.technical?.textHtmlRatio?.ratio < 10) {
      score -= 5;
      issues.push('Very low text-to-HTML ratio (<10%)');
    }
    if (analysis.links?.genericAnchors > 0) {
      score -= 3;
      issues.push(`${analysis.links.genericAnchors} generic anchor text(s) ("click here", "read more"...)`);
    }
    if (analysis.links?.internalNofollow > 0) {
      score -= 5;
      issues.push(`${analysis.links.internalNofollow} internal link(s) with nofollow (link juice loss)`);
    }

    // Bonuses for good practices
    if (analysis.structured?.validCount > 0) {
      score += 3;
    }
    if (analysis.technical?.hreflang?.exists) {
      score += 2;
    }
    if (analysis.technical?.url?.isHttps) {
      score += 2;
    }
    if (analysis.social?.hasOpenGraph && analysis.social?.hasTwitterCards) {
      score += 2;
    }

    // Keywords
    if (analysis.keywords) {
      if (analysis.keywords.stuffingAlerts && analysis.keywords.stuffingAlerts.some(a => a.severity === 'error')) {
        score -= 5;
        issues.push('Keyword stuffing detected (density > 4%)');
      }
      const titleNotInBody = (analysis.keywords.consistencyIssues || []).filter(i => i.type === 'title_not_in_body');
      if (titleNotInBody.length > 0) {
        score -= 5;
        issues.push(`Title keyword(s) not found in body content: ${titleNotInBody.map(i => i.word).join(', ')}`);
      }
      if (analysis.keywords.totalBoldKeywords > 0 && analysis.keywords.placementMatrix?.length > 0) {
        score += 2;
      }
    }

    return {
      value: Math.max(0, Math.min(100, score)),
      grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
      issues: issues
    };
  }

  // Link highlighting state
  let linkHighlightsActive = false;
  const HIGHLIGHT_STYLE_ID = 'rankseo-link-highlights-style';

  // Function to toggle link highlights on the page
  function toggleLinkHighlights(enabled) {
    linkHighlightsActive = enabled;

    // Remove existing highlights
    const existingStyle = document.getElementById(HIGHLIGHT_STYLE_ID);
    if (existingStyle) {
      existingStyle.remove();
    }

    // Remove existing highlight classes
    document.querySelectorAll('[data-rankseo-link-type]').forEach(link => {
      link.removeAttribute('data-rankseo-link-type');
    });

    if (!enabled) return;

    // Add highlight styles
    const style = document.createElement('style');
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
      [data-rankseo-link-type="follow"] {
        outline: 3px solid #3b82f6 !important;
        outline-offset: 2px !important;
        background-color: rgba(59, 130, 246, 0.1) !important;
      }
      [data-rankseo-link-type="nofollow"] {
        outline: 3px solid #ef4444 !important;
        outline-offset: 2px !important;
        background-color: rgba(239, 68, 68, 0.1) !important;
      }
      [data-rankseo-link-type="ugc"] {
        outline: 3px solid #eab308 !important;
        outline-offset: 2px !important;
        background-color: rgba(234, 179, 8, 0.1) !important;
      }
      [data-rankseo-link-type="noreferrer"] {
        outline: 3px solid #f97316 !important;
        outline-offset: 2px !important;
        background-color: rgba(249, 115, 22, 0.1) !important;
      }
      [data-rankseo-link-type="sponsored"] {
        outline: 3px solid #8b5cf6 !important;
        outline-offset: 2px !important;
        background-color: rgba(139, 92, 246, 0.1) !important;
      }
    `;
    document.head.appendChild(style);

    // Analyze and highlight all links
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
      const rel = (link.getAttribute('rel') || '').toLowerCase();

      // Determine link type (priority: nofollow > sponsored > ugc > noreferrer > follow)
      let linkType = 'follow';

      if (rel.includes('nofollow')) {
        linkType = 'nofollow';
      } else if (rel.includes('sponsored')) {
        linkType = 'sponsored';
      } else if (rel.includes('ugc')) {
        linkType = 'ugc';
      } else if (rel.includes('noreferrer')) {
        linkType = 'noreferrer';
      }

      link.setAttribute('data-rankseo-link-type', linkType);
    });
  }

  // Analyze text/background contrast (WCAG)
  function analyzeContrast() {
    try {
      const textElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, label, button');
      const issues = [];
      const samples = [];
      let total = 0;
      let passing = 0;

      const seen = new Set();

      for (const el of textElements) {
        if (total >= 200) break;
        const text = el.textContent.trim();
        if (!text || text.length < 2) continue;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const fg = style.color;
        const bg = getEffectiveBgColor(el);
        if (!fg || !bg) continue;

        const key = fg + '|' + bg;
        if (seen.has(key)) continue;
        seen.add(key);

        const fgRgb = parseColor(fg);
        const bgRgb = parseColor(bg);
        if (!fgRgb || !bgRgb) continue;

        total++;
        const ratio = contrastRatio(fgRgb, bgRgb);
        const fontSize = parseFloat(style.fontSize);
        const isBold = parseInt(style.fontWeight) >= 700 || style.fontWeight === 'bold';
        const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && isBold);
        const requiredAA = isLargeText ? 3 : 4.5;
        const requiredAAA = isLargeText ? 4.5 : 7;
        const passAA = ratio >= requiredAA;
        const passAAA = ratio >= requiredAAA;

        if (passAA) passing++;

        // Build a unique selector for this element
        let selector = '';
        if (el.id) {
          selector = '#' + el.id;
        } else {
          const tag = el.tagName.toLowerCase();
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
            const idx = siblings.indexOf(el);
            selector = tag + (siblings.length > 1 ? `:nth-of-type(${idx + 1})` : '');
            // Try to build a more specific path
            if (parent.id) selector = '#' + parent.id + ' > ' + selector;
            else if (parent.className && typeof parent.className === 'string') {
              const cls = parent.className.trim().split(/\s+/)[0];
              if (cls) selector = '.' + cls + ' > ' + selector;
            }
          } else {
            selector = tag;
          }
        }

        const sample = {
          text: text.substring(0, 50),
          tag: el.tagName.toLowerCase(),
          fg: fg,
          bg: bg,
          ratio: Math.round(ratio * 100) / 100,
          fontSize: Math.round(fontSize),
          passAA: passAA,
          passAAA: passAAA,
          isLargeText: isLargeText,
          selector: selector
        };

        if (!passAA && issues.length < 10) {
          issues.push(sample);
        }
        if (!passAA && samples.length < 15) {
          samples.push(sample);
        }
      }

      return {
        // Mark the analysis as unavailable when there are no samples instead
        // of returning a bogus 100% pass rate. The popup skips the section
        // entirely when `available` is false, which is the correct UX for a
        // page with no analyzable body copy.
        available: total > 0,
        total: total,
        passing: passing,
        failing: total - passing,
        passRate: total > 0 ? Math.round((passing / total) * 100) : 0,
        issues: issues,
        samples: samples
      };
    } catch (e) {
      return { available: false };
    }
  }

  function getEffectiveBgColor(el) {
    let current = el;
    while (current && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      const bg = style.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        return bg;
      }
      current = current.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  function parseColor(str) {
    const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return null;
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  }

  function luminance(rgb) {
    const a = rgb.map(v => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function contrastRatio(fg, bg) {
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyze') {
      try {
        const analysis = analyzePage();
        sendResponse(analysis);
      } catch (e) {
        console.error('ShahzaibSEO analysis failed:', e);
        // Return minimal valid response so popup shows error gracefully
        sendResponse({
          url: window.location.href,
          timestamp: new Date().toISOString(),
          title: { content: document.title || '', length: (document.title || '').length, status: 'error', message: 'Analysis failed: ' + e.message },
          metaDescription: { content: '', length: 0, status: 'error', message: 'Analysis failed' },
          headings: { structure: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] }, orderedHeadings: [], h1Count: 0, totalHeadings: 0, status: 'error', message: 'Analysis failed' },
          images: { total: 0, withAlt: 0, withoutAlt: 0, images: [], status: 'error', message: 'Analysis failed' },
          links: { total: 0, internal: 0, external: 0, links: [], status: 'error', message: 'Analysis failed' },
          content: { wordCount: 0, paragraphCount: 0, topWords: [], status: 'error', message: 'Analysis failed' },
          technical: { canonical: null, robots: null, language: null, viewport: null, charset: null, favicon: null, cms: null, techStack: null },
          social: { status: 'warning', message: 'Analysis failed' },
          structured: { count: 0, validCount: 0, status: 'warning' },
          performance: {},
          readability: { sentenceCount: 0, avgSentenceLength: 0, readabilityScore: 0 },
          score: { value: 0, grade: '?', issues: ['Analysis failed: ' + e.message] },
          _error: e.message
        });
      }
    } else if (request.action === 'ecommerceHighlight') {
      try {
        document.querySelectorAll('[data-rankseo-ecommerce-highlight], .__rankseo_find_hl__').forEach(el => {
          if (el.classList && el.classList.contains('__rankseo_find_hl__')) {
            try { const p=el.parentNode; if(p){ p.replaceChild(document.createTextNode(el.textContent||''), el); p.normalize(); } } catch(_){}
          } else {
            el.style.removeProperty('outline'); el.style.removeProperty('outline-offset'); el.removeAttribute('data-rankseo-ecommerce-highlight');
          }
        });
        let target = null;
        if (request.selector) { try { target = document.querySelector(request.selector); } catch (_) {} }
        if (!target && typeof request.domIndex === 'number') {
          const all=document.querySelectorAll('button,a,input,[itemprop="price"],[class*="price"],[class*="stock"],img,h1,h2,h3,p,li,[itemprop="name"],[itemprop="brand"]');
          target=all[request.domIndex]||null;
        }
        const needle = String(request.text||'').replace(/\s+/g,' ').trim().toLowerCase();
        // 1) Prefer text-node mark (most reliable for product title/price)
        if (!target && needle.length >= 2) {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              const tag = (node.parentElement && node.parentElement.tagName || '').toUpperCase();
              if (['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT'].includes(tag)) return NodeFilter.FILTER_REJECT;
              if (isShahzaibSEOInjectedElement(node.parentElement)) return NodeFilter.FILTER_REJECT;
              return (node.nodeValue||'').toLowerCase().includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
          });
          const tn = walker.nextNode();
          if (tn) {
            try {
              const idx = tn.nodeValue.toLowerCase().indexOf(needle);
              if (idx !== -1) {
                const range = document.createRange();
                range.setStart(tn, idx);
                range.setEnd(tn, idx + needle.length);
                const mark = document.createElement('mark');
                mark.className = '__rankseo_find_hl__';
                mark.setAttribute('data-rankseo-ecommerce-highlight','1');
                mark.style.cssText = 'background:#0d9488!important;color:#fff!important;border-radius:3px;padding:1px 3px;outline:3px solid #0f9f8f;outline-offset:2px;';
                range.surroundContents(mark);
                mark.style.scrollMarginTop = '90px';
                mark.scrollIntoView({behavior:'smooth',block:'center'});
                setTimeout(()=>{ try{ const p=mark.parentNode; if(p){ p.replaceChild(document.createTextNode(mark.textContent||''), mark); p.normalize(); } }catch(_){ } }, 5000);
                sendResponse({success:true, method:'mark'});
                return true;
              }
            } catch (_) {
              target = tn.parentElement;
            }
          }
        }
        // 2) Fallback: smallest element containing the text
        if (!target && needle.length >= 2) {
          let best = null, bestLen = Infinity;
          const candidates = document.querySelectorAll('h1,h2,h3,[itemprop="name"],[itemprop="brand"],[itemprop="price"],.price,[class*="price"],[class*="product-title"],[class*="product__title"],span,p,li,div,a,strong,b');
          for (const el of candidates) {
            if (isShahzaibSEOInjectedElement(el)) continue;
            const tx = (el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
            if (!tx || !tx.includes(needle)) continue;
            if (tx.length < bestLen && tx.length <= 800) { best = el; bestLen = tx.length; }
          }
          target = best;
        }
        if(!target) { sendResponse({success:false,error:'Element not found on the live page.'}); return true; }
        target.setAttribute('data-rankseo-ecommerce-highlight','1');
        target.style.outline='3px solid #0f9f8f'; target.style.outlineOffset='4px'; target.style.scrollMarginTop='90px';
        target.scrollIntoView({behavior:'smooth',block:'center'});
        setTimeout(()=>{try{target.style.removeProperty('outline');target.style.removeProperty('outline-offset');target.style.removeProperty('scroll-margin-top');target.removeAttribute('data-rankseo-ecommerce-highlight');}catch(_){ }},5000);
        sendResponse({success:true, method:'outline'});
      } catch (e) { sendResponse({success:false,error:e.message||'Highlight failed'}); }
      return true;
    } else if (request.action === 'toggleLinkHighlights') {
      toggleLinkHighlights(request.enabled);
      sendResponse({ success: true });
    } else if (request.action === 'highlightHeading') {
      // Remove previous heading highlights
      document.querySelectorAll('[data-rankseo-heading-highlight]').forEach(el => {
        el.style.removeProperty('outline');
        el.style.removeProperty('outline-offset');
        el.style.removeProperty('scroll-margin-top');
        el.removeAttribute('data-rankseo-heading-highlight');
      });
      // Find the heading by DOM index
      const allHeadings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const el = allHeadings[request.domIndex];
      if (el) {
        el.setAttribute('data-rankseo-heading-highlight', 'true');
        el.style.outline = '3px solid #1D4ED8';
        el.style.outlineOffset = '2px';
        el.style.scrollMarginTop = '80px';
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          el.style.removeProperty('outline');
          el.style.removeProperty('outline-offset');
          el.style.removeProperty('scroll-margin-top');
          el.removeAttribute('data-rankseo-heading-highlight');
        }, 5000);
      }
      sendResponse({ success: true });
    } else if (request.action === 'highlightImage') {
      // Remove previous image highlights
      document.querySelectorAll('[data-rankseo-image-highlight]').forEach(el => {
        el.style.removeProperty('outline');
        el.style.removeProperty('outline-offset');
        el.style.removeProperty('scroll-margin-top');
        el.style.removeProperty('box-shadow');
        el.removeAttribute('data-rankseo-image-highlight');
      });
      try {
        let target = null;
        const allImages = document.querySelectorAll('img');
        // Preferred: DOM index captured at analysis time (most reliable since
        // the DOM may have multiple images sharing the same selector/src).
        if (typeof request.domIndex === 'number' && allImages[request.domIndex]) {
          target = allImages[request.domIndex];
        }
        // Fallback 1: match by src / currentSrc
        if (!target && request.src) {
          for (const im of allImages) {
            if (im.src === request.src || im.currentSrc === request.src) {
              target = im;
              break;
            }
          }
        }
        // Fallback 2: CSS selector
        if (!target && request.selector) {
          try { target = document.querySelector(request.selector); } catch (e) {}
        }
        if (target) {
          target.setAttribute('data-rankseo-image-highlight', 'true');
          target.style.outline = '3px solid #1D4ED8';
          target.style.outlineOffset = '2px';
          target.style.boxShadow = '0 0 0 6px rgba(29, 78, 216, 0.25)';
          target.style.scrollMarginTop = '80px';
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            target.style.removeProperty('outline');
            target.style.removeProperty('outline-offset');
            target.style.removeProperty('box-shadow');
            target.style.removeProperty('scroll-margin-top');
            target.removeAttribute('data-rankseo-image-highlight');
          }, 5000);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'image not found' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (request.action === 'highlightContrastIssue') {
      // Remove previous highlights
      document.querySelectorAll('[data-rankseo-contrast-highlight]').forEach(el => {
        el.style.removeProperty('outline');
        el.style.removeProperty('outline-offset');
        el.style.removeProperty('scroll-margin-top');
        el.removeAttribute('data-rankseo-contrast-highlight');
      });
      // Highlight the target element
      try {
        const el = request.selector ? document.querySelector(request.selector) : null;
        if (el) {
          el.setAttribute('data-rankseo-contrast-highlight', 'true');
          el.style.outline = '3px solid #1D4ED8';
          el.style.outlineOffset = '2px';
          el.style.scrollMarginTop = '80px';
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Auto-remove after 5s
          setTimeout(() => {
            el.style.removeProperty('outline');
            el.style.removeProperty('outline-offset');
            el.style.removeProperty('scroll-margin-top');
            el.removeAttribute('data-rankseo-contrast-highlight');
          }, 5000);
        }
      } catch (e) {}
      sendResponse({ success: true });
    } else if (request.action === 'locateCroElement') {
      try {
        // Remove previous CRO highlights
        document.querySelectorAll('[data-rankseo-cro-highlight]').forEach(el => {
          el.style.removeProperty('outline');
          el.style.removeProperty('outline-offset');
          el.removeAttribute('data-rankseo-cro-highlight');
        });
        // Try each selector (comma-separated) until one matches
        const selectors = request.selector.split(',');
        let found = null;
        for (const sel of selectors) {
          found = document.querySelector(sel.trim());
          if (found) break;
        }
        if (found) {
          found.setAttribute('data-rankseo-cro-highlight', 'true');
          found.style.outline = '3px solid #1D4ED8';
          found.style.outlineOffset = '2px';
          found.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            found.style.removeProperty('outline');
            found.style.removeProperty('outline-offset');
            found.removeAttribute('data-rankseo-cro-highlight');
          }, 5000);
        }
      } catch (e) {}
      sendResponse({ success: true });
    } else if (request.action === 'highlightHiddenElement') {
      // Triggered when the user clicks a "Hidden content sample" row in the
      // GEO → AI Crawler Deep View section of the popup. Briefly outlines and
      // scrolls the matching element on the page so the user can see exactly
      // where the hidden text lives in the DOM.
      //
      // Critically: the target may itself be hidden via display:none /
      // visibility:hidden / opacity:0 (that's why it was reported as hidden in
      // the first place). Outlining a zero-height / non-rendered box gives the
      // user no visual feedback at all, so we temporarily force it visible
      // for the duration of the highlight and then restore the original
      // inline styles on cleanup.
      try {
        // Restore any previous highlight first so we don't leak DOM state.
        document.querySelectorAll('[data-rankseo-hidden-highlight]').forEach(el => {
          if (el.__rankseoHiddenRestore) {
            try { el.__rankseoHiddenRestore(); } catch (e) {}
            delete el.__rankseoHiddenRestore;
          }
          el.removeAttribute('data-rankseo-hidden-highlight');
        });

        let target = null;
        if (request.selector) {
          try { target = document.querySelector(request.selector); } catch (e) {}
        }
        if (!target && request.text) {
          // Last-resort fallback: walk text-bearing elements until one contains
          // the saved snippet. Useful if the DOM was rerendered and the saved
          // selector no longer matches (e.g. SPA navigation between scans).
          const needle = String(request.text).substring(0, 40).toLowerCase();
          if (needle.length >= 8) {
            const candidates = document.querySelectorAll('div, section, article, aside, header, footer, main, span, p, li');
            for (const c of candidates) {
              const t = (c.textContent || '').trim().toLowerCase();
              if (t.includes(needle)) { target = c; break; }
            }
          }
        }
        if (target) {
          // Snapshot any inline styles we are about to override so we can put
          // them back exactly as we found them. We deliberately skip the
          // stylesheet cascade — we only touch what we changed.
          const propsToRestore = ['display', 'visibility', 'opacity', 'position', 'z-index'];
          const snapshot = {};
          propsToRestore.forEach(p => { snapshot[p] = target.style.getPropertyValue(p); });

          target.setAttribute('data-rankseo-hidden-highlight', 'true');
          // Outline + offset gives a clear ring around the element. We bump
          // z-index in case the element is inside a stacking context that
          // would otherwise clip the outline.
          target.style.setProperty('outline', '3px solid #1D4ED8', 'important');
          target.style.setProperty('outline-offset', '2px', 'important');
          target.style.setProperty('scroll-margin-top', '80px', 'important');
          // Force visibility so the ring is actually drawn.
          const cs = window.getComputedStyle(target);
          if (cs.display === 'none')  target.style.setProperty('display', 'block', 'important');
          if (cs.visibility === 'hidden') target.style.setProperty('visibility', 'visible', 'important');
          if (parseFloat(cs.opacity || '1') === 0) target.style.setProperty('opacity', '1', 'important');
          target.style.setProperty('position', 'relative', 'important');
          target.style.setProperty('z-index', '2147483647', 'important');

          // Scroll the (now-visible) element into view.
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // Build a one-shot restorer that the cleanup pass above can also
          // invoke if the user clicks a different row before the timer fires.
          const restore = () => {
            propsToRestore.forEach(p => {
              if (snapshot[p]) target.style.setProperty(p, snapshot[p]);
              else target.style.removeProperty(p);
            });
            target.style.removeProperty('outline');
            target.style.removeProperty('outline-offset');
            target.style.removeProperty('scroll-margin-top');
            target.removeAttribute('data-rankseo-hidden-highlight');
          };
          target.__rankseoHiddenRestore = restore;
          setTimeout(restore, 5000);

          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'hidden element not found' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (request.action === 'collectAICrawlerPreview') {
      try {
        const data = collectAICrawlerPreviewData();
        chrome.storage.local.set({ aiPreviewData: data }, () => {
          sendResponse({ success: true });
        });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true; // async sendResponse
    } else if (request.action === 'removeHeading') {
      // Visually hide (not permanently delete) a heading on the page by DOM index
      try {
        const allHeadings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const el = allHeadings[request.domIndex];
        if (el) {
          el.style.display = 'none';
          el.setAttribute('data-rankseo-removed', 'true');
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Heading not found' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (request.action === 'changeHeadingLevel') {
      // Change heading level in the live DOM (e.g. H4 → H3)
      try {
        const allHeadings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const el = allHeadings[request.domIndex];
        if (el && request.newLevel >= 1 && request.newLevel <= 6) {
          const newTag = document.createElement(`h${request.newLevel}`);
          newTag.innerHTML = el.innerHTML;
          // Copy existing class/id/style so the page doesn't visually break
          newTag.className = el.className;
          newTag.id = el.id;
          newTag.style.cssText = el.style.cssText;
          newTag.setAttribute('data-rankseo-changed', 'true');
          el.parentNode.replaceChild(newTag, el);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Heading not found or invalid level' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (request.action === 'updateHeadingText') {
      // Replace heading text content in the live DOM (used by AI text-improve suggestions)
      try {
        const newText = typeof request.newText === 'string' ? request.newText.trim() : '';
        if (!newText) {
          sendResponse({ success: false, error: 'Heading not found or text empty' });
          return true;
        }
        // Include only visible headings in document order (same as analysis list)
        const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        let el = (typeof request.domIndex === 'number') ? allHeadings[request.domIndex] : null;
        // Fallback: match by original text if index drifted after prior applies / level changes
        if (!el && request.originalText) {
          const want = String(request.originalText).trim().toLowerCase();
          el = allHeadings.find(h => (h.textContent || '').trim().toLowerCase() === want) || null;
        }
        if (!el && request.originalText) {
          const want = String(request.originalText).trim().toLowerCase().slice(0, 40);
          el = allHeadings.find(h => (h.textContent || '').trim().toLowerCase().startsWith(want)) || null;
        }
        if (el) {
          el.textContent = newText;
          el.setAttribute('data-rankseo-text-changed', 'true');
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Heading not found or text empty' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (request.action === 'scrollToHeading') {
      // Scroll to a heading without highlighting (for the locate / magnifier button)
      try {
        const allHeadings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const el = allHeadings[request.domIndex];
        if (el) {
          el.style.scrollMarginTop = '80px';
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.outline = '2px dashed #0D9488';
          el.style.outlineOffset = '3px';
          setTimeout(() => {
            el.style.removeProperty('outline');
            el.style.removeProperty('outline-offset');
            el.style.removeProperty('scroll-margin-top');
          }, 3000);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Heading not found' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (request.action === 'updateMetaTag') {
      // Live-preview an AI-suggested meta title or meta description on the page
      // (used by the Headings tab "AI Suggest Title, Desc & Slug" feature)
      try {
        const text = typeof request.newText === 'string' ? request.newText.trim() : '';
        if (!text) {
          sendResponse({ success: false, error: 'Empty value' });
        } else if (request.metaType === 'title') {
          document.title = text;
          sendResponse({ success: true });
        } else if (request.metaType === 'description') {
          let tag = document.querySelector('meta[name="description"]');
          if (!tag) {
            tag = document.createElement('meta');
            tag.setAttribute('name', 'description');
            document.head.appendChild(tag);
          }
          tag.setAttribute('content', text);
          tag.setAttribute('data-rankseo-text-changed', 'true');
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Unknown metaType' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }

    // ── Internal Link: Page par text dhoondhna aur highlight karna ──────────
    if (request.action === 'findTextOnPage') {
      try {
        const phrase = (request.phrase || '').trim();
        if (!phrase) { sendResponse({ success: false, error: 'No phrase provided' }); return true; }

        // Remove any existing findTextOnPage highlights
        document.querySelectorAll('.__rankseo_find_hl__').forEach(el => {
          const parent = el.parentNode;
          if (parent) {
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
          }
        });

        // Walk all text nodes in body, find phrase (case-insensitive)
        const phraseLC = phrase.toLowerCase();
        let found = false;
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const tag = node.parentElement?.tagName?.toUpperCase();
              if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(tag)) return NodeFilter.FILTER_REJECT;
              return node.nodeValue.toLowerCase().includes(phraseLC)
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_SKIP;
            }
          }
        );

        const targetNode = walker.nextNode();
        if (targetNode) {
          const idx = targetNode.nodeValue.toLowerCase().indexOf(phraseLC);
          if (idx !== -1) {
            const range = document.createRange();
            range.setStart(targetNode, idx);
            range.setEnd(targetNode, idx + phrase.length);
            const mark = document.createElement('mark');
            mark.className = '__rankseo_find_hl__';
            mark.style.cssText = 'background:#0d9488!important;color:#fff!important;border-radius:3px;padding:1px 2px;';
            try {
              range.surroundContents(mark);
              mark.style.scrollMarginTop = '80px';
              mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => {
                if (mark.parentNode) {
                  mark.parentNode.replaceChild(document.createTextNode(mark.textContent), mark);
                  mark.parentNode?.normalize();
                }
              }, 4000);
              found = true;
            } catch (e) {
              // Cross-element range — fallback: just scroll nearest block
              const el = targetNode.parentElement;
              if (el) {
                el.style.scrollMarginTop = '80px';
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.style.outline = '2px dashed #0d9488';
                setTimeout(() => el.style.removeProperty('outline'), 3000);
                found = true;
              }
            }
          }
        }
        sendResponse({ success: found, error: found ? null : 'Text not found on page' });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    // ── Internal Link: AI ke liye page se linkable phrases collect karna ────
    if (request.action === 'collectLinkablePhrases') {
      try {
        const selectors = 'p, li, h2, h3, h4, td';
        const snippets = [];
        document.querySelectorAll(selectors).forEach(el => {
          if (snippets.length >= 60) return;
          const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
          if (t.length > 20 && t.length < 500) snippets.push(t);
        });
        sendResponse({ success: true, snippets: snippets.slice(0, 60) });
      } catch (e) {
        sendResponse({ success: false, snippets: [], error: e.message });
      }
      return true;
    }

    // ── Full Page Audit: scroll page + deep extract text/structure ─────────
    if (request.action === 'fullPageExtract') {
      (async () => {
        try {
          const result = await rankseoFullPageExtract(request.options || {});
          sendResponse({ ok: true, ...result });
        } catch (e) {
          sendResponse({ ok: false, error: e.message || 'fullPageExtract failed' });
        }
      })();
      return true; // async
    }

    return true;
  });

  /**
   * Scroll the page to trigger lazy content, then collect a deep snapshot
   * for Full Page Audit (text, headings, links, images, schema, meta).
   */
  async function rankseoFullPageExtract(options) {
    const maxMs = Math.min(Math.max(options.maxMs || 12000, 3000), 25000);
    const stepPx = options.stepPx || Math.max(300, Math.floor(window.innerHeight * 0.85));
    const pauseMs = options.pauseMs || 280;
    const startY = window.scrollY;
    const t0 = Date.now();

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Expand common "read more" / collapsed sections (best-effort)
    try {
      document.querySelectorAll(
        'button, a, [role="button"], summary'
      ).forEach(el => {
        const t = (el.textContent || '').trim().toLowerCase();
        if (/read more|show more|see more|load more|expand|view more|more details/.test(t)) {
          try { el.click(); } catch (_) {}
        }
      });
    } catch (_) {}

    // Smooth step scroll to bottom
    let y = 0;
    const maxY = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight
    );
    while (y < maxY - 10 && (Date.now() - t0) < maxMs) {
      y = Math.min(y + stepPx, maxY);
      window.scrollTo({ top: y, behavior: 'auto' });
      await sleep(pauseMs);
      // Recalculate height (lazy load may grow page)
      const newMax = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      if (newMax > maxY + 50) {
        // allow extra time for growth
      }
    }
    // Return to top for stable UX
    window.scrollTo({ top: startY, behavior: 'auto' });
    await sleep(150);

    // Structured analysis (existing engine)
    let analysis = null;
    try { analysis = analyzePage(); } catch (e) {
      analysis = { _error: e.message };
    }

    // Full visible text (capped)
    const body = document.body;
    let fullText = '';
    try {
      fullText = (body.innerText || body.textContent || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } catch (_) {}
    const MAX_TEXT = 120000;
    if (fullText.length > MAX_TEXT) fullText = fullText.slice(0, MAX_TEXT) + '\n…[truncated]';

    // Headings outline
    const outline = [];
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => {
      if (outline.length >= 80) return;
      const level = parseInt((h.tagName || 'H2').replace(/\D/g, ''), 10) || 2;
      const text = (h.innerText || h.textContent || '').trim().replace(/\s+/g, ' ');
      if (text) outline.push({ level, text: text.slice(0, 200), index: i });
    });

    // Meta
    const meta = {
      title: document.title || '',
      description: (document.querySelector('meta[name="description"]')?.content || '').trim(),
      canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      robots: document.querySelector('meta[name="robots"]')?.content || '',
      lang: document.documentElement.lang || '',
      h1: (document.querySelector('h1')?.innerText || '').trim().slice(0, 200)
    };

    // Schema types
    const schemaTypes = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const j = JSON.parse(s.textContent || '');
        const arr = Array.isArray(j) ? j : [j];
        arr.forEach(obj => {
          if (obj && obj['@type']) {
            const t = obj['@type'];
            (Array.isArray(t) ? t : [t]).forEach(x => schemaTypes.push(String(x)));
          }
          if (obj && obj['@graph']) {
            obj['@graph'].forEach(g => {
              if (g && g['@type']) schemaTypes.push(String(g['@type']));
            });
          }
        });
      } catch (_) {}
    });

    // Images / links quick counts from live DOM
    const imgs = Array.from(document.images || []);
    const links = Array.from(document.querySelectorAll('a[href]'));
    const host = location.hostname.replace(/^www\./, '');
    let internal = 0, external = 0, missingAlt = 0;
    imgs.forEach(im => { if (!(im.alt || '').trim()) missingAlt++; });
    links.forEach(a => {
      try {
        const h = new URL(a.href, location.href).hostname.replace(/^www\./, '');
        if (!h || h === host) internal++;
        else if (!a.href.startsWith('javascript:')) external++;
      } catch (_) {}
    });

    const words = fullText.split(/\s+/).filter(Boolean);

    return {
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
      analysis
    };
  }

  // Collect all data visible to AI crawlers for preview page
  function collectAICrawlerPreviewData() {
    // 1. Content blocks with structure
    const contentBlocks = extractContentWithStructure();

    // 2. Visible images
    const images = [];
    document.querySelectorAll('img').forEach(img => {
      if (images.length >= 50) return;
      const style = window.getComputedStyle(img);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
      if (!img.src && !img.dataset.src) return;
      images.push({
        src: img.src || img.dataset.src || '',
        alt: img.alt || '',
        isLazy: img.loading === 'lazy' || !!img.dataset.src || !!img.dataset.lazySrc,
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0
      });
    });

    // 3. Structured data (JSON-LD)
    const structuredData = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        const parsed = JSON.parse(script.textContent);
        structuredData.push(parsed);
      } catch (e) {
        structuredData.push({ _error: 'Invalid JSON-LD', _raw: script.textContent.substring(0, 500) });
      }
    });

    // 4. Meta tags
    const getMeta = (sel, attr = 'content') => {
      const el = document.querySelector(sel);
      return el ? (el.getAttribute(attr) || '') : '';
    };
    const ogTags = {};
    document.querySelectorAll('meta[property^="og:"]').forEach(m => {
      ogTags[m.getAttribute('property')] = m.getAttribute('content') || '';
    });
    const twitterTags = {};
    document.querySelectorAll('meta[name^="twitter:"]').forEach(m => {
      twitterTags[m.getAttribute('name')] = m.getAttribute('content') || '';
    });
    const meta = {
      title: document.title,
      description: getMeta('meta[name="description"]'),
      canonical: getMeta('link[rel="canonical"]', 'href'),
      robots: getMeta('meta[name="robots"]'),
      og: ogTags,
      twitter: twitterTags
    };

    // 5. Internal crawlable links
    const links = [];
    const seenHrefs = new Set();
    document.querySelectorAll('a[href]').forEach(a => {
      if (links.length >= 200) return;
      const href = a.href;
      if (!href || href.startsWith('javascript:') || href === '#') return;
      try {
        const url = new URL(href);
        if (url.hostname !== window.location.hostname) return;
      } catch (e) { return; }
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      if (rel.includes('nofollow')) return;
      if (seenHrefs.has(href)) return;
      seenHrefs.add(href);
      const text = (a.textContent || '').trim().substring(0, 100);
      if (!text) return;
      links.push({ href, text });
    });

    // 6. Crawler view stats (reuse existing)
    const crawlerView = analyzeAICrawlerView();

    // 7. Page snapshot for faithful page view with overlays
    // Collect elements with SEO issues and their CSS selectors for highlighting
    function collectIssueSelectors() {
      const issues = [];

      // Helper to generate a unique CSS selector for an element
      function getSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        const path = [];
        while (el && el !== document.body && el !== document.documentElement) {
          let selector = el.tagName.toLowerCase();
          if (el.id) {
            path.unshift('#' + CSS.escape(el.id));
            break;
          }
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
            if (siblings.length > 1) {
              const idx = siblings.indexOf(el) + 1;
              selector += ':nth-of-type(' + idx + ')';
            }
          }
          path.unshift(selector);
          el = parent;
        }
        return path.join(' > ');
      }

      // Images without alt text
      document.querySelectorAll('img').forEach(img => {
        const alt = img.getAttribute('alt');
        if (alt === null || alt === '') {
          issues.push({ selector: getSelector(img), type: 'error', category: 'image', message: 'Image missing alt text' });
        }
      });

      // Empty headings
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
        if (!h.textContent.trim()) {
          issues.push({ selector: getSelector(h), type: 'error', category: 'heading', message: 'Empty heading (' + h.tagName + ')' });
        }
      });

      // Multiple H1s
      const h1s = document.querySelectorAll('h1');
      if (h1s.length > 1) {
        h1s.forEach((h1, i) => {
          if (i > 0) issues.push({ selector: getSelector(h1), type: 'warning', category: 'heading', message: 'Multiple H1 tags (should be only one)' });
        });
      }
      if (h1s.length === 0) {
        issues.push({ selector: 'body', type: 'error', category: 'heading', message: 'No H1 tag found on page' });
      }

      // Links without text
      document.querySelectorAll('a[href]').forEach(a => {
        const text = (a.textContent || '').trim();
        const hasImg = a.querySelector('img');
        const ariaLabel = a.getAttribute('aria-label');
        if (!text && !hasImg && !ariaLabel) {
          issues.push({ selector: getSelector(a), type: 'warning', category: 'link', message: 'Link without accessible text' });
        }
      });

      // Generic anchor text
      const genericAnchors = ['click here', 'here', 'read more', 'learn more', 'more', 'link'];
      document.querySelectorAll('a[href]').forEach(a => {
        const text = (a.textContent || '').trim().toLowerCase();
        if (genericAnchors.includes(text)) {
          issues.push({ selector: getSelector(a), type: 'warning', category: 'link', message: 'Generic anchor text: "' + text + '"' });
        }
      });

      // Hidden content (display:none with significant text)
      document.querySelectorAll('div, section, article, aside, main').forEach(el => {
        const style = window.getComputedStyle(el);
        if ((style.display === 'none' || style.visibility === 'hidden') && el.textContent.trim().length > 50) {
          issues.push({ selector: getSelector(el), type: 'info', category: 'hidden', message: 'Hidden content (' + style.display + '/' + style.visibility + ')' });
        }
      });

      // Images not using modern formats
      document.querySelectorAll('img[src]').forEach(img => {
        const src = (img.src || '').toLowerCase();
        if (src.match(/\.(png|jpg|jpeg|gif|bmp)(\?|$)/)) {
          issues.push({ selector: getSelector(img), type: 'info', category: 'image', message: 'Image not using modern format (WebP/AVIF recommended)' });
        }
      });

      // Missing meta description (page-level, attach to body)
      if (!document.querySelector('meta[name="description"]') || !document.querySelector('meta[name="description"]').getAttribute('content')) {
        issues.push({ selector: 'head', type: 'error', category: 'meta', message: 'Missing meta description' });
      }

      // Missing title
      if (!document.title.trim()) {
        issues.push({ selector: 'head', type: 'error', category: 'meta', message: 'Missing page title' });
      }

      return issues;
    }

    const issueSelectors = collectIssueSelectors();

    return {
      url: window.location.href,
      pageTitle: document.title,
      timestamp: new Date().toISOString(),
      contentBlocks,
      images,
      structuredData,
      meta,
      links,
      crawlerView,
      pageSnapshot: {
        fullHtml: document.documentElement.outerHTML.substring(0, 2 * 1024 * 1024),
        baseUrl: window.location.href,
        issues: issueSelectors
      }
    };
  }

  // Extract page content as structured blocks
  function extractContentWithStructure() {
    if (!document.body) return [];
    const bodyClone = document.body.cloneNode(true);

    // Same exclusion logic as extractMainContentText
    const excludeSelectors = [
      'header', 'footer', 'nav', 'aside',
      '[role="banner"]', '[role="navigation"]', '[role="complementary"]', '[role="contentinfo"]',
      '.header', '.footer', '.nav', '.navigation', '.sidebar', '.menu',
      '.breadcrumb', '.breadcrumbs', '.cookie-banner', '.cookie-notice',
      '.advertisement', '.ads', '.social-share', '.social-links', '.comments',
      '.widget', '.widgets', '.mega-menu', '.dropdown-menu',
      '#header', '#footer', '#nav', '#sidebar', '#menu'
    ];
    excludeSelectors.forEach(sel => {
      try { bodyClone.querySelectorAll(sel).forEach(el => el.remove()); } catch (e) {}
    });
    bodyClone.querySelectorAll('script, style, noscript, svg, canvas, video, audio, iframe').forEach(el => el.remove());

    const blocks = [];
    let totalChars = 0;
    const maxChars = 50000;

    function walk(node) {
      if (totalChars >= maxChars) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text && text.length > 1) {
          totalChars += text.length;
          if (blocks.length > 0 && blocks[blocks.length - 1].type === 'paragraph') {
            blocks[blocks.length - 1].text += ' ' + text;
          } else {
            blocks.push({ type: 'paragraph', text });
          }
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName;
      const headingMatch = tag.match(/^H([1-6])$/);
      if (headingMatch) {
        const text = (node.textContent || '').trim();
        if (text) {
          totalChars += text.length;
          blocks.push({ type: 'heading', level: parseInt(headingMatch[1]), text });
        }
        return;
      }

      if (tag === 'UL' || tag === 'OL') {
        const items = [];
        node.querySelectorAll(':scope > li').forEach(li => {
          const t = (li.textContent || '').trim().substring(0, 200);
          if (t) { items.push(t); totalChars += t.length; }
        });
        if (items.length > 0) blocks.push({ type: 'list', items });
        return;
      }

      // Block elements start new paragraph
      const blockTags = ['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'DD', 'DT'];
      if (blockTags.includes(tag)) {
        blocks.push({ type: 'paragraph', text: '' }); // force new block
      }

      for (const child of node.childNodes) {
        walk(child);
      }
    }

    walk(bodyClone);

    // Clean up empty blocks
    return blocks.filter(b => {
      if (b.type === 'paragraph') return b.text && b.text.trim().length > 2;
      if (b.type === 'list') return b.items && b.items.length > 0;
      return true;
    });
  }

  // Advanced technical SEO analysis
  function analyzeAdvancedTechnical() {
    const results = {
      resourceHints: { preconnect: [], prefetch: [], preload: [], dnsPrefetch: [] },
      rendering: { type: 'unknown', jsFramework: null, hydrationDetected: false },
      performance: { domElements: 0, domDepth: 0, criticalRequestChains: 0 },
      serverHints: { http2: null, serverTiming: false },
      contentFreshness: { publishDate: null, modifiedDate: null, ageInDays: null, staleContentWarnings: [] }
    };

    // === RESOURCE HINTS ===
    document.querySelectorAll('link[rel="preconnect"]').forEach(el => {
      results.resourceHints.preconnect.push(el.href);
    });
    document.querySelectorAll('link[rel="prefetch"]').forEach(el => {
      results.resourceHints.prefetch.push(el.href);
    });
    document.querySelectorAll('link[rel="preload"]').forEach(el => {
      results.resourceHints.preload.push({
        href: el.href,
        as: el.getAttribute('as') || 'unknown',
        type: el.getAttribute('type') || ''
      });
    });
    document.querySelectorAll('link[rel="dns-prefetch"]').forEach(el => {
      results.resourceHints.dnsPrefetch.push(el.href);
    });

    // === RENDERING TYPE DETECTION ===
    // Check if content is client-side rendered
    const noscriptContent = document.querySelector('noscript');
    const rootEl = document.querySelector('#root, #app, #__next, #__nuxt, #svelte, [data-reactroot]');

    if (rootEl) {
      // Check for framework hydration markers
      if (document.querySelector('[data-reactroot], [data-react-helmet]')) {
        results.rendering.jsFramework = 'React';
      } else if (document.querySelector('#__next, [data-nextjs-page]')) {
        results.rendering.jsFramework = 'Next.js';
      } else if (document.querySelector('#__nuxt, [data-server-rendered]')) {
        results.rendering.jsFramework = 'Nuxt';
      } else if (document.querySelector('[data-v-]') || document.querySelector('[data-vue-]')) {
        results.rendering.jsFramework = 'Vue';
      } else if (document.querySelector('ng-version, [ng-version], [_ngcontent]')) {
        results.rendering.jsFramework = 'Angular';
      }

      // Detect SSR vs CSR
      const htmlSource = document.documentElement.innerHTML;
      // If the initial HTML is mostly empty div containers, it's likely CSR
      if (rootEl && rootEl.children.length > 2) {
        results.rendering.type = 'ssr';
        results.rendering.hydrationDetected = !!document.querySelector('[data-reactroot], [data-server-rendered], [data-nextjs-page]');
      } else {
        results.rendering.type = 'csr';
      }
    } else {
      results.rendering.type = 'static';
    }

    // === DOM COMPLEXITY ===
    results.performance.domElements = document.querySelectorAll('*').length;

    // Calculate max DOM depth
    let maxDepth = 0;
    function measureDepth(el, depth) {
      if (depth > maxDepth) maxDepth = depth;
      if (depth > 50) return; // Safety limit
      for (const child of el.children) {
        measureDepth(child, depth + 1);
      }
    }
    measureDepth(document.documentElement, 0);
    results.performance.domDepth = maxDepth;

    // === CONTENT FRESHNESS ===
    // Try multiple methods to find dates
    const dateSelectors = [
      'meta[property="article:published_time"]',
      'meta[property="article:modified_time"]',
      'meta[name="date"]',
      'meta[name="DC.date"]',
      'time[datetime]',
      '[itemprop="datePublished"]',
      '[itemprop="dateModified"]'
    ];

    // Published date
    const pubMeta = document.querySelector('meta[property="article:published_time"]');
    if (pubMeta) {
      results.contentFreshness.publishDate = pubMeta.getAttribute('content');
    } else {
      const timeEl = document.querySelector('time[datetime]') || document.querySelector('[itemprop="datePublished"]');
      if (timeEl) {
        results.contentFreshness.publishDate = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
      }
    }

    // Modified date
    const modMeta = document.querySelector('meta[property="article:modified_time"]');
    if (modMeta) {
      results.contentFreshness.modifiedDate = modMeta.getAttribute('content');
    } else {
      const modEl = document.querySelector('[itemprop="dateModified"]');
      if (modEl) {
        results.contentFreshness.modifiedDate = modEl.getAttribute('datetime') || modEl.textContent.trim();
      }
    }

    // Calculate age
    const dateStr = results.contentFreshness.modifiedDate || results.contentFreshness.publishDate;
    if (dateStr) {
      try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          const ageMs = Date.now() - date.getTime();
          results.contentFreshness.ageInDays = Math.round(ageMs / (1000 * 60 * 60 * 24));

          if (results.contentFreshness.ageInDays > 365) {
            results.contentFreshness.staleContentWarnings.push('Content is over 1 year old - consider updating');
          }
          if (results.contentFreshness.ageInDays > 730) {
            results.contentFreshness.staleContentWarnings.push('Content is over 2 years old - may be considered stale by search engines');
          }
        }
      } catch(e) {}
    } else {
      results.contentFreshness.staleContentWarnings.push('No publication or modification date found');
    }

    // Check for outdated year references in content
    const currentYear = new Date().getFullYear();
    const bodyText = getBodyText();
    const yearPattern = /\b(20[12]\d)\b/g;
    const years = [];
    let match;
    while ((match = yearPattern.exec(bodyText)) !== null) {
      const year = parseInt(match[1]);
      if (year < currentYear - 2 && year >= 2010) {
        years.push(year);
      }
    }
    if (years.length > 3) {
      const oldestYear = Math.min(...years);
      results.contentFreshness.staleContentWarnings.push('Content references years as old as ' + oldestYear + ' - verify information is current');
    }

    return results;
  }

  // ==================== //
  // E-E-A-T Signal Detection
  // ==================== //
  function analyzeEEAT() {
    const signals = {
      experience: { score: 0, signals: [] },
      expertise: { score: 0, signals: [] },
      authority: { score: 0, signals: [] },
      trust: { score: 0, signals: [] },
      totalScore: 0
    };

    const bodyText = getBodyText().toLowerCase();
    const html = document.documentElement.innerHTML.toLowerCase();

    // === EXPERIENCE ===
    // First-person experience indicators
    const experiencePatterns = [
      /\b(i tested|i tried|i used|in my experience|from my experience|hands-on|first-hand|we tested|we tried|our experience|i've been using|we've been using)\b/gi,
      /\b(j'ai testé|j'ai essayé|mon expérience|notre expérience|nous avons testé)\b/gi
    ];
    experiencePatterns.forEach(pattern => {
      const matches = bodyText.match(pattern);
      if (matches && matches.length > 0) {
        signals.experience.score += Math.min(matches.length * 5, 15);
        signals.experience.signals.push('First-person experience language (' + matches.length + ' instances)');
      }
    });

    // Date of content (freshness = experience signal)
    const datePatterns = document.querySelectorAll('time[datetime], [itemprop="datePublished"], [itemprop="dateModified"], meta[property="article:published_time"], meta[property="article:modified_time"]');
    if (datePatterns.length > 0) {
      signals.experience.score += 10;
      signals.experience.signals.push('Publication/modification date found');
    }

    // Original images (not stock photos - heuristic: images from same domain)
    const domainImages = Array.from(document.querySelectorAll('img[src]')).filter(img => {
      try { return new URL(img.src).hostname === window.location.hostname; } catch(e) { return false; }
    });
    if (domainImages.length >= 3) {
      signals.experience.score += 10;
      signals.experience.signals.push(domainImages.length + ' images from same domain (likely original)');
    }

    // === EXPERTISE ===
    // Author information
    const authorSchema = document.querySelector('[itemprop="author"], [rel="author"], .author, .byline, .post-author, .entry-author');
    if (authorSchema) {
      signals.expertise.score += 15;
      signals.expertise.signals.push('Author information present');
    }

    // Author page link
    const authorLinks = document.querySelectorAll('a[href*="/author"], a[href*="/about"], a[rel="author"]');
    if (authorLinks.length > 0) {
      signals.expertise.score += 10;
      signals.expertise.signals.push('Link to author page found');
    }

    // Credentials in content
    const credentialPatterns = /\b(ph\.?d|m\.?d|certified|expert|specialist|professor|doctor|engineer|cpa|cfa|mba|founder|ceo|cto|director|consultant|researcher|analyst)\b/gi;
    const credMatches = bodyText.match(credentialPatterns);
    if (credMatches && credMatches.length > 0) {
      signals.expertise.score += Math.min(credMatches.length * 5, 15);
      signals.expertise.signals.push('Professional credentials mentioned (' + [...new Set(credMatches.map(m => m.toLowerCase()))].join(', ') + ')');
    }

    // Schema Person/Organization
    const schemas = document.querySelectorAll('script[type="application/ld+json"]');
    let hasPersonSchema = false;
    let hasOrgSchema = false;
    schemas.forEach(s => {
      try {
        const data = JSON.parse(s.textContent);
        const types = JSON.stringify(data);
        if (types.includes('"Person"')) hasPersonSchema = true;
        if (types.includes('"Organization"')) hasOrgSchema = true;
      } catch(e) {}
    });
    if (hasPersonSchema) {
      signals.expertise.score += 10;
      signals.expertise.signals.push('Schema.org Person markup found');
    }
    if (hasOrgSchema) {
      signals.expertise.score += 5;
      signals.expertise.signals.push('Schema.org Organization markup found');
    }

    // === AUTHORITY ===
    // References to authoritative sources
    const authoritativeLinks = Array.from(document.querySelectorAll('a[href]')).filter(a => {
      const href = (a.href || '').toLowerCase();
      return href.match(/\.(gov|edu|org|who\.int|nature\.com|pubmed|scholar\.google|ieee|acm\.org|nytimes|bbc|reuters)/);
    });
    if (authoritativeLinks.length > 0) {
      signals.authority.score += Math.min(authoritativeLinks.length * 5, 20);
      signals.authority.signals.push(authoritativeLinks.length + ' links to authoritative sources (.gov, .edu, etc.)');
    }

    // Citations / References section
    const hasReferences = bodyText.match(/\b(references|sources|bibliography|citations|works cited|références|sources)\b/i);
    if (hasReferences) {
      signals.authority.score += 10;
      signals.authority.signals.push('References/Sources section detected');
    }

    // Canonical & hreflang (signals established site)
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      signals.authority.score += 5;
      signals.authority.signals.push('Canonical URL set');
    }

    // === TRUST ===
    // HTTPS
    if (window.location.protocol === 'https:') {
      signals.trust.score += 10;
      signals.trust.signals.push('HTTPS enabled');
    }

    // Privacy/Legal pages linked
    const legalLinks = Array.from(document.querySelectorAll('a[href]')).filter(a => {
      const href = (a.href || '').toLowerCase();
      return href.match(/(privacy|legal|terms|conditions|mentions-legales|datenschutz|impressum|cookie|gdpr|rgpd)/);
    });
    if (legalLinks.length > 0) {
      signals.trust.score += 10;
      signals.trust.signals.push('Legal/Privacy pages linked (' + legalLinks.length + ')');
    }

    // Contact information
    const contactEl = document.querySelector('a[href^="mailto:"], a[href^="tel:"], [itemtype*="ContactPoint"], .contact, #contact');
    if (contactEl) {
      signals.trust.score += 10;
      signals.trust.signals.push('Contact information found');
    }

    // Physical address
    const addressEl = document.querySelector('[itemprop="address"], address, [itemtype*="PostalAddress"]');
    if (addressEl) {
      signals.trust.score += 10;
      signals.trust.signals.push('Physical address found');
    }

    // Calculate total (cap each category at 25)
    const maxPerCategory = 25;
    signals.experience.score = Math.min(signals.experience.score, maxPerCategory);
    signals.expertise.score = Math.min(signals.expertise.score, maxPerCategory);
    signals.authority.score = Math.min(signals.authority.score, maxPerCategory);
    signals.trust.score = Math.min(signals.trust.score, maxPerCategory);
    signals.totalScore = signals.experience.score + signals.expertise.score + signals.authority.score + signals.trust.score;

    return signals;
  }

  // Keyword highlighting
  const KW_HIGHLIGHT_STYLE_ID = 'rankseo-keyword-highlights-style';
  let kwHighlightsActive = false;

  function toggleKeywordHighlights(enabled, keywords) {
    kwHighlightsActive = enabled;
    const existingStyle = document.getElementById(KW_HIGHLIGHT_STYLE_ID);
    if (existingStyle) existingStyle.remove();
    document.querySelectorAll('.rankseo-kw-highlight').forEach(el => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });

    if (!enabled || !keywords || keywords.length === 0) return;

    const colors = ['#fef08a', '#bfdbfe', '#bbf7d0', '#fecaca', '#e9d5ff'];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement && !['SCRIPT','STYLE','NOSCRIPT','SVG'].includes(node.parentElement.tagName)) {
        textNodes.push(node);
      }
    }

    // Build highlight spans via DOM API (no innerHTML) to avoid XSS from
    // page text content being interpreted as HTML.
    keywords.slice(0, 5).forEach((kw, idx) => {
      const color = colors[idx % colors.length];
      const regex = new RegExp('\\b(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b', 'gi');
      textNodes.forEach(node => {
        if (!node.parentNode || node.parentElement.classList.contains('rankseo-kw-highlight')) return;
        if (!regex.test(node.textContent)) return;
        regex.lastIndex = 0; // reset after .test()
        const frag = document.createDocumentFragment();
        const text = node.textContent;
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
          }
          const hl = document.createElement('span');
          hl.className = 'rankseo-kw-highlight';
          hl.style.background = color;
          hl.style.padding = '1px 2px';
          hl.style.borderRadius = '2px';
          hl.textContent = match[1];
          frag.appendChild(hl);
          lastIndex = regex.lastIndex;
        }
        if (lastIndex < text.length) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
        node.parentNode.replaceChild(frag, node);
      });
    });
  }

  function analyzeCRO() {
    const bodyText = getBodyText().toLowerCase();
    const html = getOuterHTML();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    function isAboveFold(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.top < viewportHeight && rect.bottom > 0 && rect.width > 0 && rect.height > 0;
    }

    // === CTA ANALYSIS ===
    const ctaTextPatterns = /^(buy now|add to cart|shop now|get started|sign up|sign in|subscribe|download|try free|start (?:free )?trial|order now|book now|reserve|enroll|join now|claim|request (?:a )?demo|contact us|get a quote|get quote|free quote|learn more|see plans|view plans|pricing|buy|purchase|checkout|register|create account|start now|talk to (?:us|sales)|schedule|book a call|hosting|order hosting|acheter|ajouter au panier|commander|s'inscrire|essai gratuit|comprar|añadir al carrito|contactez|devis)/i;
    const ctaPartialPatterns = /\b(buy now|add to cart|shop now|get started|sign up|subscribe|try free|start trial|order now|book now|contact us|get a quote|free quote|learn more|checkout|register now|talk to sales)\b/i;
    const genericTextPatterns = /^(submit|click here|go|send|ok|continue|envoyer|enviar|here)$/i;

    const allButtons = document.querySelectorAll(
      'button, a[role="button"], input[type="submit"], input[type="button"], ' +
      '.btn, .button, [class*="btn"], [class*="button"], ' +
      '[class*="cta"], [class*="add-to-cart"], [class*="buy-now"], [class*="checkout"], ' +
      'a.button, a.btn, .hero a[href], .banner a[href], header a.btn, header button'
    );
    const ctas = [];
    const seenCtaText = new Set();
    allButtons.forEach(btn => {
      const text = (btn.textContent || btn.value || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 60 || text.length < 2) return;
      const cls = (btn.className && typeof btn.className === 'string') ? btn.className : String(btn.className || '');
      const isCTA = ctaTextPatterns.test(text) ||
        ctaPartialPatterns.test(text) ||
        /cta|add.?to.?cart|buy.?now|checkout|get-started|sign-up|btn-primary|button-primary/i.test(cls);
      if (!isCTA) return;
      const key = text.toLowerCase();
      if (seenCtaText.has(key)) return;
      seenCtaText.add(key);
      const style = window.getComputedStyle(btn);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return;
      ctas.push({
        text: text.substring(0, 40),
        isAboveFold: isAboveFold(btn),
        isGenericText: genericTextPatterns.test(text),
        isVisible: true,
        isSticky: style.position === 'fixed' || style.position === 'sticky'
      });
    });

    // === TRUST SIGNALS ===
    const paymentPatterns = /visa|mastercard|amex|american.?express|paypal|stripe|apple.?pay|google.?pay|shop.?pay|klarna|afterpay/i;
    const securityPatterns = /norton|mcafee|comodo|ssl|secure|trust|verified/i;
    let paymentBadges = 0;
    let securityBadges = 0;
    document.querySelectorAll('img').forEach(img => {
      const combined = (img.alt || '') + ' ' + (img.src || '');
      if (paymentPatterns.test(combined)) paymentBadges++;
      if (securityPatterns.test(combined)) securityBadges++;
    });

    const hasReviews = !!document.querySelector('[itemprop="aggregateRating"], [itemprop="review"], [class*="review"], [class*="rating"], [class*="testimonial"], .trustpilot-widget, .yotpo, .stamped-badge, .judge-me');
    const hasGuarantee = /money.?back|satisfaction.?guarantee|100%.?guarantee|risk.?free|garantie/i.test(bodyText);
    const hasReturnPolicy = /return policy|returns|refund|exchange|30.?day|politique de retour|remboursement/i.test(bodyText);
    const hasShippingInfo = /free shipping|shipping policy|delivery|livraison gratuite|envío gratis/i.test(bodyText);
    const hasPhone = /(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/.test(getBodyText());
    const hasEmail = /[\w.-]+@[\w.-]+\.\w{2,}/.test(getBodyText());
    const hasContactPage = !!document.querySelector('a[href*="contact"], a[href*="support"]');
    const hasSocialLinks = [...document.querySelectorAll('a[href]')].filter(a => /facebook\.com|twitter\.com|x\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com/i.test(a.href)).length;

    // === PRODUCT PAGE ELEMENTS ===
    const hasPrice = !!document.querySelector('[itemprop="price"], [class*="price"]:not([class*="priceless"]), [data-price], meta[property="product:price:amount"]');
    const hasProductImages = document.querySelectorAll('[itemprop="image"], .product-image img, .product-gallery img, .product__image').length;
    const hasVariantSelector = !!document.querySelector('select[name*="size"], select[name*="variant"], [class*="swatch"], [class*="variant-selector"]');
    const hasAvailability = !!document.querySelector('[itemprop="availability"], [class*="stock"], [class*="availability"]') || /in stock|out of stock|disponible|en stock/i.test(bodyText);

    // === FORM ANALYSIS ===
    const forms = document.querySelectorAll('form');
    const formAnalysis = [];
    forms.forEach(form => {
      const fields = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
      if (fields.length === 0) return;
      let fieldsWithoutLabels = 0;
      let missingInputTypes = 0;
      fields.forEach(field => {
        const hasLabel = (field.labels?.length > 0) || field.getAttribute('aria-label') || field.getAttribute('aria-labelledby');
        if (!hasLabel) fieldsWithoutLabels++;
        if (field.type === 'text') {
          const name = (field.name || field.placeholder || '').toLowerCase();
          if (/email/.test(name) || /phone|tel/.test(name) || /zip|postal/.test(name)) missingInputTypes++;
        }
      });
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      const submitText = (submitBtn?.textContent || submitBtn?.value || '').trim();
      formAnalysis.push({
        fieldCount: fields.length,
        fieldsWithoutLabels,
        missingInputTypes,
        submitText: submitText.substring(0, 30),
        isGenericSubmit: /^(submit|send|go|envoyer|enviar)$/i.test(submitText),
        hasAutocomplete: !!form.querySelector('[autocomplete]')
      });
    });

    // === ABOVE THE FOLD ===
    const h1 = document.querySelector('h1');
    const h1AboveFold = isAboveFold(h1);
    const ctaAboveFold = ctas.some(c => c.isAboveFold);
    const hasHero = isAboveFold(document.querySelector('[class*="hero"], [class*="banner"], .jumbotron, header img, header video'));

    // === NAVIGATION ===
    const hasSearch = !!document.querySelector('input[type="search"], [role="search"], form[action*="search"], [class*="search-input"], input[name="q"], input[name="s"]');
    const hasBreadcrumbs = !!document.querySelector('[itemtype*="BreadcrumbList"], [class*="breadcrumb"], nav[aria-label*="breadcrumb"]');
    const hasStickyHeader = (() => {
      const header = document.querySelector('header, [role="banner"], .header');
      if (!header) return false;
      const style = window.getComputedStyle(header);
      return style.position === 'fixed' || style.position === 'sticky';
    })();

    // === INTERSTITIALS ===
    const viewportArea = viewportWidth * viewportHeight;
    let intrusivePopups = 0;
    document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="overlay"], [role="dialog"], [class*="lightbox"]').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
        const rect = el.getBoundingClientRect();
        if ((rect.width * rect.height) / viewportArea > 0.15) intrusivePopups++;
      }
    });
    const hasChatWidget = !!document.querySelector('[class*="chat-widget"], [class*="livechat"], [class*="intercom"], #drift-widget, .crisp-client, [class*="zendesk"], [class*="tawk"]');

    // === SOCIAL PROOF ===
    const testimonialCount = document.querySelectorAll('[class*="testimonial"], [class*="customer-story"], blockquote[class*="quote"]').length;
    const hasClientLogos = !!document.querySelector('[class*="client-logo"], [class*="partner-logo"], [class*="trusted-by"], [class*="as-seen"], [class*="logo-bar"]');
    const hasShareButtons = !!document.querySelector('[class*="share"], a[href*="facebook.com/sharer"], a[href*="twitter.com/intent"], [class*="addthis"], [class*="sharethis"]');

    // === CONTENT SCANNABILITY ===
    const bulletPoints = document.querySelectorAll('ul li, ol li').length;
    const tables = document.querySelectorAll('table').length;
    const hasFAQ = !!document.querySelector('[itemtype*="FAQPage"], [class*="faq"], [id*="faq"], details summary');
    const hasTOC = !!document.querySelector('[class*="table-of-contents"], [class*="toc"], [id*="toc"]');
    const paragraphs = document.querySelectorAll('p');
    let longParagraphs = 0;
    paragraphs.forEach(p => { if (p.textContent.trim().length > 300) longParagraphs++; });

    // === PERFORMANCE HINTS ===
    const domSize = document.getElementsByTagName('*').length;
    const allImgs = document.querySelectorAll('img');
    let lazyImages = 0;
    allImgs.forEach(img => {
      if (img.loading === 'lazy' || img.dataset.src || img.classList.contains('lazyload')) lazyImages++;
    });
    const renderBlockingScripts = document.querySelectorAll('script[src]:not([async]):not([defer]):not([type="module"])').length;

    // === CRO SCORE (0-100) ===
    let score = 50; // base
    // CTA
    if (ctas.length > 0) score += 8; else score -= 10;
    if (ctaAboveFold) score += 5;
    // Trust
    if (hasReviews) score += 6;
    if (paymentBadges > 0) score += 3;
    if (securityBadges > 0) score += 2;
    if (hasGuarantee) score += 3;
    if (hasContactPage || hasPhone || hasEmail) score += 3;
    // UX
    if (h1AboveFold) score += 3;
    if (hasSearch) score += 2;
    if (hasBreadcrumbs) score += 2;
    if (intrusivePopups > 0) score -= 8;
    // Content
    if (bulletPoints > 3) score += 2;
    if (hasFAQ) score += 3;
    if (longParagraphs > 5) score -= 3;
    // Performance
    if (domSize > 3000) score -= 5;
    if (renderBlockingScripts > 3) score -= 3;
    // Social
    if (testimonialCount > 0) score += 3;
    if (hasClientLogos) score += 2;
    if (hasSocialLinks > 0) score += 2;

    score = Math.max(0, Math.min(100, score));

    return {
      score,
      cta: { count: ctas.length, items: ctas.slice(0, 10), aboveFold: ctaAboveFold },
      trust: { paymentBadges, securityBadges, hasReviews, hasGuarantee, hasReturnPolicy, hasShippingInfo, hasPhone, hasEmail, hasContactPage, socialLinks: hasSocialLinks },
      product: { hasPrice, imageCount: hasProductImages, hasVariantSelector, hasAvailability, hasReviews },
      forms: formAnalysis,
      aboveFold: { h1Visible: h1AboveFold, ctaVisible: ctaAboveFold, hasHero },
      navigation: { hasSearch, hasBreadcrumbs, hasStickyHeader },
      interstitials: { intrusivePopups, hasChatWidget },
      socialProof: { testimonialCount, hasClientLogos, hasShareButtons },
      content: { bulletPoints, tables, hasFAQ, hasTOC, longParagraphs, paragraphCount: paragraphs.length },
      performance: { domSize, lazyImageRatio: allImgs.length > 0 ? Math.round(lazyImages / allImgs.length * 100) : 100, renderBlockingScripts }
    };
  }

  /**
   * Local SEO / NAP analyzer.
   * Extracts Name, Address, Phone (+ email, map, hours, reviews) from BOTH the
   * live DOM and any LocalBusiness/Organization JSON-LD, then cross-checks the
   * two sources for consistency. Mismatched NAP is the #1 local-ranking killer,
   * so every discrepancy is surfaced as an actionable flag.
   */
  function analyzeLocalSEO() {
    const bodyText = getBodyText();
    const digits = (s) => String(s || '').replace(/\D+/g, '');
    // Two phone numbers "match" if one's significant tail (>=7 digits) is a
    // suffix of the other — tolerant of country-code / formatting differences.
    const phonesMatch = (a, b) => {
      const da = digits(a), db = digits(b);
      if (da.length < 7 || db.length < 7) return false;
      const n = Math.min(da.length, db.length, 10);
      return da.slice(-n) === db.slice(-n);
    };
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '').trim();

    // ── 1. Structured data (LocalBusiness / Organization) ──────────────────────
    const schema = { name: '', phone: '', email: '', address: '', hours: [], rating: null, reviewCount: null, geo: null, sameAs: [], type: '', found: false };
    const LOCAL_TYPES = /(LocalBusiness|Organization|Store|Restaurant|Hotel|Dentist|Physician|Attorney|LegalService|HomeAndConstructionBusiness|ProfessionalService|AutoRepair|MedicalBusiness|FoodEstablishment|Plumber|Electrician|RealEstateAgent)/i;

    function fmtAddr(a) {
      if (!a) return '';
      if (typeof a === 'string') return a.trim();
      const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
        .map(p => (p && typeof p === 'object') ? (p.name || '') : (p || ''))
        .filter(Boolean);
      return parts.join(', ');
    }
    function scanNode(node) {
      if (!node || typeof node !== 'object') return;
      const t = node['@type'];
      const typeStr = Array.isArray(t) ? t.join(' ') : (t || '');
      if (typeStr && LOCAL_TYPES.test(typeStr)) {
        schema.found = true;
        if (!schema.type) schema.type = Array.isArray(t) ? t[0] : t;
        if (!schema.name && node.name) schema.name = String(node.name).trim();
        if (!schema.phone && node.telephone) schema.phone = String(node.telephone).trim();
        if (!schema.email && node.email) schema.email = String(node.email).replace(/^mailto:/i, '').trim();
        if (!schema.address && node.address) schema.address = fmtAddr(node.address);
        if (node.openingHoursSpecification) {
          const specs = Array.isArray(node.openingHoursSpecification) ? node.openingHoursSpecification : [node.openingHoursSpecification];
          specs.forEach(s => {
            if (!s) return;
            const days = Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek];
            const dayTxt = days.filter(Boolean).map(d => String(d).split('/').pop()).join(', ');
            if (dayTxt || s.opens) schema.hours.push(`${dayTxt}: ${s.opens || '?'}–${s.closes || '?'}`.trim());
          });
        } else if (typeof node.openingHours === 'string') {
          schema.hours.push(node.openingHours);
        }
        if (node.aggregateRating) {
          const r = node.aggregateRating;
          if (r.ratingValue != null) schema.rating = parseFloat(r.ratingValue);
          if (r.reviewCount != null) schema.reviewCount = parseInt(r.reviewCount, 10);
          else if (r.ratingCount != null) schema.reviewCount = parseInt(r.ratingCount, 10);
        }
        if (node.geo && node.geo.latitude != null) schema.geo = { lat: node.geo.latitude, lng: node.geo.longitude };
        if (node.sameAs) schema.sameAs = (Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs]).filter(Boolean);
      }
      // Recurse into @graph / nested arrays / nested objects
      if (Array.isArray(node['@graph'])) node['@graph'].forEach(scanNode);
      Object.keys(node).forEach(k => {
        if (k === '@graph') return;
        const v = node[k];
        if (Array.isArray(v)) v.forEach(x => (x && typeof x === 'object') && scanNode(x));
        else if (v && typeof v === 'object') scanNode(v);
      });
    }
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try { scanNode(JSON.parse(s.textContent)); } catch (_) {}
    });

    // ── 2. Live DOM extraction ─────────────────────────────────────────────────
    // Phone: prefer tel: links (explicit, machine-readable) over text scraping.
    const telLinks = [...document.querySelectorAll('a[href^="tel:"]')]
      .map(a => a.getAttribute('href').replace(/^tel:/i, '').trim()).filter(Boolean);
    const mailLinks = [...document.querySelectorAll('a[href^="mailto:"]')]
      .map(a => a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim()).filter(Boolean);

    let pagePhone = telLinks[0] || '';
    if (!pagePhone) {
      const m = bodyText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
      if (m && digits(m[0]).length >= 7) pagePhone = m[0].trim();
    }
    const pageEmail = mailLinks[0] || (bodyText.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/) || [''])[0];

    // Address: <address> element or [itemprop="address"] (microdata)
    let pageAddress = '';
    const addrEl = document.querySelector('address, [itemprop="address"], [class*="address"]:not([class*="email"]):not([class*="ip-"])');
    if (addrEl) {
      const txt = (addrEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt && txt.length < 200 && /\d/.test(txt)) pageAddress = txt;
    }

    // Business name: schema → og:site_name → title
    const ogName = document.querySelector('meta[property="og:site_name"]')?.content || '';
    const pageName = (schema.name || ogName || (document.title || '').split(/[|\-–—]/)[0] || '').trim();

    // Map embed
    const mapEmbed = !!document.querySelector(
      'iframe[src*="google.com/maps"], iframe[src*="maps.google"], iframe[src*="/maps/embed"], ' +
      'a[href*="google.com/maps"], a[href*="goo.gl/maps"], a[href*="maps.app.goo.gl"], [class*="map-embed"], [id*="map"] iframe'
    );

    // Hours (DOM): microdata or a Mon–Fri style pattern
    let domHours = document.querySelector('[itemprop="openingHours"]')?.getAttribute('content')
      || document.querySelector('[itemprop="openingHours"]')?.textContent?.trim() || '';
    if (!domHours) {
      const hm = bodyText.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*[-–—to]+\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*[^\n]{0,40}\d/i);
      if (hm) domHours = hm[0].replace(/\s+/g, ' ').trim().slice(0, 60);
    }

    // Reviews (DOM markers, if no schema rating)
    const hasReviewMarkup = !!document.querySelector('[itemprop="aggregateRating"], [itemprop="review"], [class*="review"], [class*="rating"], [class*="testimonial"], .trustpilot-widget, .yotpo');

    // ── 3. Resolve final NAP + source + consistency ────────────────────────────
    const name = { value: pageName, source: schema.name ? 'schema' : (ogName ? 'og' : 'title') };
    const phone = { value: schema.phone || pagePhone, source: schema.phone ? 'schema' : (telLinks[0] ? 'tel-link' : (pagePhone ? 'text' : 'none')) };
    const address = { value: schema.address || pageAddress, source: schema.address ? 'schema' : (pageAddress ? 'dom' : 'none') };
    const email = { value: schema.email || pageEmail, source: schema.email ? 'schema' : (mailLinks[0] ? 'mailto' : (pageEmail ? 'text' : 'none')) };

    // Consistency: schema value present AND page value present AND they disagree
    const flags = [];
    if (schema.phone && pagePhone && !phonesMatch(schema.phone, pagePhone)) {
      flags.push({ field: 'Phone', schema: schema.phone, page: pagePhone, msg: 'Schema telephone does not match the phone shown on the page.' });
    }
    if (schema.name && ogName && norm(schema.name) !== norm(ogName) && !norm(ogName).includes(norm(schema.name)) && !norm(schema.name).includes(norm(ogName))) {
      flags.push({ field: 'Name', schema: schema.name, page: ogName, msg: 'Schema business name differs from og:site_name.' });
    }

    const hasName = !!name.value;
    const hasAddress = !!address.value;
    const hasPhone = !!phone.value;
    const napComplete = hasName && hasAddress && hasPhone;

    // ── 4. Recommendations ─────────────────────────────────────────────────────
    const recos = [];
    if (!schema.found) recos.push('Add LocalBusiness JSON-LD schema — the single strongest local + AI-citation signal.');
    if (!hasPhone) recos.push('Publish a phone number as a tel: link so crawlers and mobile users can find it.');
    else if (phone.source === 'text') recos.push('Wrap your phone number in a <a href="tel:…"> link (currently only in plain text).');
    if (!hasAddress) recos.push('Add a full postal address (ideally in an <address> element and PostalAddress schema).');
    if (schema.found && !schema.address) recos.push('Add a PostalAddress to your LocalBusiness schema.');
    if (schema.found && !schema.hours.length && !domHours) recos.push('Add openingHoursSpecification so hours can appear in local results.');
    if (!mapEmbed) recos.push('Embed a Google Map of your location to reinforce the NAP.');
    if (schema.rating == null && !hasReviewMarkup) recos.push('Display customer reviews with Review/AggregateRating markup.');
    flags.forEach(f => recos.push(`Fix NAP mismatch (${f.field}): "${f.schema}" vs "${f.page}".`));

    // ── 5. Score (0-100) ───────────────────────────────────────────────────────
    let score = 0;
    if (hasName) score += 12;
    if (hasPhone) score += 18;
    if (phone.source === 'schema' || phone.source === 'tel-link') score += 6;
    if (hasAddress) score += 18;
    if (email.value) score += 6;
    if (schema.found) score += 15;
    if (schema.address) score += 6;
    if (schema.hours.length || domHours) score += 6;
    if (mapEmbed) score += 5;
    if (schema.rating != null || hasReviewMarkup) score += 8;
    if (flags.length) score -= flags.length * 8; // consistency penalty
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      name, phone, address, email,
      napComplete,
      schema: {
        found: schema.found, type: schema.type, name: schema.name, phone: schema.phone,
        email: schema.email, address: schema.address, hours: schema.hours,
        rating: schema.rating, reviewCount: schema.reviewCount, geo: schema.geo,
        sameAs: schema.sameAs
      },
      map: { embedded: mapEmbed },
      hours: { value: (schema.hours[0] || domHours || ''), fromSchema: !!schema.hours.length, list: schema.hours },
      reviews: { rating: schema.rating, count: schema.reviewCount, hasMarkup: hasReviewMarkup || schema.rating != null },
      telLinkCount: telLinks.length,
      flags,
      recommendations: recos
    };
  }

  // Expose for direct use
  window.ShahzaibSEO = {
    analyze: analyzePage,
    highlightLinks: toggleLinkHighlights,
    highlightKeywords: toggleKeywordHighlights
  };

  // Listen for custom events from toolbar.js (both run as content scripts on same page)
  window.addEventListener('rankseo:toggleLinkHighlights', (e) => {
    toggleLinkHighlights(e.detail.enabled);
  });

})();
