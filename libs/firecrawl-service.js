/**
 * Firecrawl API Service (Keyless + Authenticated)
 * Supports Firecrawl Keyless free tier (1000 credits/month, no API key required)
 * and optional authenticated keys for higher limits.
 * Docs: https://www.firecrawl.dev/blog/firecrawl-keyless-launch
 */

class FirecrawlService {
  constructor() {
    this.apiKey = null;
    this.baseUrl = 'https://api.firecrawl.dev/v2'; // v2 is the keyless-native surface
    this.keyless = true;
  }

  _normalizeKey(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const k = raw.trim();
    if (!k || k === 'fc-…' || k === 'fc-...' || k === 'fc-' || k.length < 12) return '';
    if (!k.startsWith('fc-') && !k.startsWith('fc_')) return '';
    return k;
  }

  /**
   * Initialize service with API key from storage (optional — keyless works without it)
   */
  async init() {
    return new Promise((resolve) => {
      Promise.all([
        new Promise((res) => {
          chrome.storage.local.get(['firecrawlApiKey'], (result) => {
            res(result.firecrawlApiKey || '');
          });
        }),
        new Promise((res) => {
          chrome.storage.sync.get('firecrawlConfig', (result) => {
            try {
              const config = result.firecrawlConfig ? JSON.parse(result.firecrawlConfig) : null;
              res(config?.apiKey || '');
            } catch (e) {
              res('');
            }
          });
        })
      ]).then(([localKey, syncKey]) => {
        this.apiKey = this._normalizeKey(localKey) || this._normalizeKey(syncKey) || '';
        this.keyless = !this.apiKey;
        console.log('[Firecrawl] Mode:', this.keyless ? 'KEYLESS (free tier)' : 'Authenticated');
        resolve(this.apiKey);
      });
    });
  }

  /**
   * Build request headers — omit Authorization when keyless
   */
  _headers() {
    const h = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Firecrawl-Client': 'rankseo-extension',
      'X-Integration': 'rankseo'
    };
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  /**
   * Crawl / scrape page and extract content
   * @param {string} url - URL to crawl
   * @param {Object} opts - Optional overrides
   * @returns {Promise<Object>} Crawled page data
   */
  async crawl(url, opts = {}) {
    await this.init();

    console.log('[Firecrawl] Scraping', this.keyless ? '(keyless)' : '(auth):', url);

    const body = {
      url: url,
      formats: opts.formats || ['markdown', 'html', 'links'],
      onlyMainContent: opts.onlyMainContent !== false,
      waitFor: opts.waitFor ?? 2000,
      timeout: opts.timeout ?? 30000
    };

    // Prefer v2 (keyless-native), fall back to v1, then direct fetch
    for (const base of ['https://api.firecrawl.dev/v2', 'https://api.firecrawl.dev/v1']) {
      try {
        const response = await fetch(`${base}/scrape`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify(body)
        });

        if (response.ok) {
          const data = await response.json();
          console.log('[Firecrawl] Success (keyless=' + this.keyless + ', ' + (base.includes('v2') ? 'v2' : 'v1') + ')');
          return this.processFirecrawlData(data, url);
        }

        const errorData = await response.json().catch(() => ({}));
        if ([401, 402, 403, 429].includes(response.status)) {
          if (base.includes('/v2')) continue;
          try { console.debug('[Firecrawl] API limited, falling back to direct fetch:', errorData.error || response.status); } catch (_) {}
          return this._directFetch(url);
        }
        throw new Error(errorData.error || `Firecrawl API error: ${response.status}`);
      } catch (error) {
        if (base.includes('/v2')) continue;
        try { console.debug('[Firecrawl] API failed, falling back to direct fetch:', (error && error.message) || error); } catch (_) {}
        return this._directFetch(url);
      }
    }
    return this._directFetch(url);
  }

  /**
   * Search the web — free, no registration (v2/search with query + limit only).
   * Optional API key increases limits; scrapeOptions only when opts.scrape=true and key present.
   * @param {string} query
   * @param {Object} opts
   */
  async search(query, opts = {}) {
    await this.init();
    const limit = Math.min(Math.max(opts.limit || 5, 1), 20);
    // Free endpoint body — matches: curl -X POST api.firecrawl.dev/v2/search -d '{"query":"...","limit":3}'
    const simplePayload = { query, limit };
    const richPayload = {
      query,
      limit,
      scrapeOptions: { formats: ['markdown'], onlyMainContent: true }
    };

    for (const base of ['https://api.firecrawl.dev/v2', 'https://api.firecrawl.dev/v1']) {
      try {
        let payload = simplePayload;
        if (this.apiKey && opts.scrape) payload = richPayload;

        const response = await fetch(`${base}/search`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          if (base.includes('/v2')) continue;
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `Search failed: ${response.status}`);
        }
        const data = await response.json();
        const root = data.data || data;
        const web = Array.isArray(root.web)
          ? root.web
          : (Array.isArray(root) ? root : (root.results || []));
        return {
          ok: true,
          success: data.success !== false,
          results: (web || []).map((r, i) => ({
            position: r.position || i + 1,
            title: r.title || '',
            url: r.url || r.link || '',
            description: r.description || r.snippet || '',
            markdown: r.markdown || ''
          })),
          data: root,
          keyless: this.keyless,
          creditsUsed: data.creditsUsed,
          raw: data
        };
      } catch (e) {
        if (base.includes('/v2')) continue;
        try { console.debug('[Firecrawl] Search error:', (e && e.message) || e); } catch (_) {}
        throw e;
      }
    }
    throw new Error('Firecrawl search unreachable');
  }

  async _directFetch(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ShahzaibSEO/5.0)'
        }
      });

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const getText = (selector) => doc.querySelector(selector)?.textContent?.trim() || '';
      const getMeta = (name) => {
        return doc.querySelector(`meta[name="${name}"]`)?.content ||
               doc.querySelector(`meta[property="${name}"]`)?.content || '';
      };

      const headings = [];
      doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
        headings.push({
          level: parseInt(h.tagName[1], 10),
          text: h.textContent.trim()
        });
      });

      const images = [];
      doc.querySelectorAll('img').forEach((img) => {
        if (img.src) {
          images.push({
            src: img.src,
            alt: img.alt || '',
            hasAlt: !!img.alt
          });
        }
      });

      const links = [];
      doc.querySelectorAll('a[href]').forEach((a) => {
        try {
          links.push(new URL(a.href, url).href);
        } catch (_) {}
      });

      const bodyText = doc.body?.innerText || doc.body?.textContent || '';

      return {
        url,
        title: getText('title'),
        description: getMeta('description'),
        markdown: bodyText,
        html,
        links,
        screenshot: null,
        headings,
        images,
        metaTags: {
          title: getText('title'),
          description: getMeta('description'),
          ogTitle: getMeta('og:title'),
          ogDescription: getMeta('og:description')
        },
        schemas: this.extractSchemas(html),
        wordCount: this.countWords(bodyText),
        readingTime: this.calculateReadingTime(bodyText),
        internalLinks: this.filterLinks(links, url, 'internal'),
        externalLinks: this.filterLinks(links, url, 'external'),
        rawContent: bodyText,
        _source: 'direct_fetch'
      };
    } catch (error) {
      throw new Error(`Direct fetch also failed: ${error.message}. Keyless Firecrawl or a personal API key is recommended.`);
    }
  }

  processFirecrawlData(data, url) {
    const result = data.data || data;

    return {
      url: url,
      title: result.metadata?.title || '',
      description: result.metadata?.description || '',
      markdown: result.markdown || '',
      html: result.html || '',
      links: result.links || [],
      screenshot: result.screenshot || null,
      headings: this.extractHeadings(result.markdown || ''),
      images: this.extractImages(result.html || ''),
      metaTags: result.metadata || {},
      schemas: this.extractSchemas(result.html || ''),
      wordCount: this.countWords(result.markdown || ''),
      readingTime: this.calculateReadingTime(result.markdown || ''),
      internalLinks: this.filterLinks(result.links || [], url, 'internal'),
      externalLinks: this.filterLinks(result.links || [], url, 'external'),
      rawContent: result.markdown || result.html || '',
      _source: this.keyless ? 'firecrawl_keyless' : 'firecrawl_auth'
    };
  }

  extractHeadings(markdown) {
    const headings = [];
    const lines = markdown.split('\n');
    lines.forEach(line => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        headings.push({ level: match[1].length, text: match[2].trim() });
      }
    });
    return headings;
  }

  extractImages(html) {
    const images = [];
    const imgRegex = /<img[^>]+>/gi;
    const matches = html.match(imgRegex) || [];
    matches.forEach(imgTag => {
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);
      if (srcMatch) {
        images.push({
          src: srcMatch[1],
          alt: altMatch ? altMatch[1] : '',
          hasAlt: !!altMatch && altMatch[1].length > 0
        });
      }
    });
    return images;
  }

  extractSchemas(html) {
    const schemas = [];
    const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
      try {
        schemas.push(JSON.parse(match[1]));
      } catch (e) {
        console.warn('[Firecrawl] Invalid JSON-LD:', e);
      }
    }
    return schemas;
  }

  countWords(text) {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  calculateReadingTime(text) {
    const words = this.countWords(text);
    const minutes = Math.ceil(words / 200);
    return `${minutes} min read`;
  }

  filterLinks(links, baseUrl, type) {
    const baseDomain = new URL(baseUrl).hostname;
    return links.filter(link => {
      try {
        const linkDomain = new URL(link, baseUrl).hostname;
        const isInternal = linkDomain === baseDomain;
        return type === 'internal' ? isInternal : !isInternal;
      } catch (e) {
        return false;
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FirecrawlService;
}
