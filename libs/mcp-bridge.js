/**
 * ShahzaibSEO ↔ WP x MCP Bridge  (v2 — hardened)
 * ─────────────────────────────────────────────────────────────────────────────
 * Connects ShahzaibSEO audit data to the WP x MCP WordPress plugin.
 * Detects the page builder, audits heading structure, and dispatches targeted
 * fix commands over JSON-RPC 2.0 to the MCP server endpoint.
 *
 * Architecture note:
 *   • STATIC methods (detectPageBuilder / auditHeadings / detectWordPressPostId)
 *     read the live DOM and therefore MUST run in the inspected PAGE context
 *     (injected via chrome.scripting.executeScript). Never call them from the
 *     popup — the popup's `document` is the popup UI, not the page.
 *   • INSTANCE methods (call / fix*) issue cross-origin fetch and run from the
 *     POPUP, which holds the required host_permissions.
 *
 * v2 changelog:
 *   • FIX: Avada/Fusion regexes used single backslashes inside template
 *          literals (\[ → [, \s → s) producing malformed patterns. Now escaped.
 *   • FIX: inconsistent auth headers between call() and listTools().
 *   • NEW: request timeout (AbortController) + single network retry.
 *   • NEW: _unwrap() handles MCP content-block responses ({content:[{text}]}).
 *   • NEW: tool capability cache + hasTool() gating (no calls to absent tools).
 *   • NEW: fixImageAlts() via audit_image_alts / fix_image_alt.
 *   • NEW: richer postId detection + dry-run support + timestamped logging.
 *   • NEW (v3): detectWordPressPostId() is now async and adds a REST API
 *          by-slug fallback (via the <link rel="https://api.w.org/"> root)
 *          so the post/page ID auto-resolves even on themes/builders that
 *          strip body classes, shortlinks, or the JSON alternate link —
 *          no more manual WP-admin visit or ?p=ID URL hack required.
 * ─────────────────────────────────────────────────────────────────────────────
 */

class ShahzaibSEOMCPBridge {

  constructor() {
    this.endpoint   = null;   // https://your-site.com/wp-json/wp-x-mcp/v1/mcp
    this.apiKey     = null;   // wpxmcp_xxxxx
    this.postId     = null;   // WordPress post ID (from URL or meta)
    this._rpcId     = 1;
    this._log       = [];
    this._tools     = null;   // cached tools/list result (capability gate)
    this.timeoutMs  = 25000;  // per-request timeout
    this.dryRun     = false;  // when true, mutating tools are not called
  }

  // ─── Initialise from chrome.storage ────────────────────────────────────────

  async init() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['wpxmcpEndpoint', 'wpxmcpApiKey'], (result) => {
        this.endpoint = (result.wpxmcpEndpoint || '').trim();
        this.apiKey   = (result.wpxmcpApiKey   || '').trim();
        resolve(this.isConfigured());
      });
    });
  }

  isConfigured() {
    return !!(this.endpoint && this.apiKey && /^https?:\/\//i.test(this.endpoint));
  }

  // ─── Page Builder Detection (from live DOM) ────────────────────────────────

  /**
   * Detects which page builder built this page.
   * Returns { builder, version, isPro, editorType }.
   * MUST be called in the page (content-script) context.
   */
  static detectPageBuilder() {
    const gen = document.querySelector('meta[name="generator"]')?.content || '';

    // ── Avada / Fusion Builder (very common — check first) ───────────────────
    if (
      document.querySelector('[class*="fusion-"]') ||
      document.querySelector('[class*="avada-"]') ||
      document.querySelector('link[href*="/avada/"]') ||
      document.querySelector('link[href*="/fusion-builder/"]') ||
      document.querySelector('link[href*="/fusion-core/"]') ||
      document.querySelector('script[src*="/fusion-builder/"]') ||
      document.querySelector('script[src*="/avada/"]') ||
      document.querySelector('[data-fusion-element-type]') ||
      document.querySelector('.fusion-page-title-bar') ||
      document.querySelector('.awb-layout-section') ||
      /Avada/i.test(gen)
    ) {
      const ver = (gen.match(/Avada[\s|]+([\d.]+)/i) || [])[1] || 'unknown';
      const isPro = !!document.querySelector('link[href*="/fusion-builder/"]');
      return { builder: 'Avada (Fusion Builder)', version: ver, isPro, editorType: 'avada' };
    }

    // ── Elementor ────────────────────────────────────────────────────────────
    if (
      document.querySelector('[class*="elementor-"]') ||
      document.querySelector('[data-elementor-type]') ||
      document.querySelector('link[href*="/wp-content/plugins/elementor"]')
    ) {
      const ver = (gen.match(/Elementor\s+([\d.]+)/i) || [])[1] || 'unknown';
      const isPro = !!document.querySelector('[class*="elementor-pro"]') ||
                    !!document.querySelector('link[href*="elementor-pro"]');
      return { builder: 'Elementor', version: ver, isPro, editorType: 'elementor' };
    }

    // ── Divi ─────────────────────────────────────────────────────────────────
    if (
      document.querySelector('[class*="et_pb_"]') ||
      document.querySelector('link[href*="/et-cache/"]') ||
      document.querySelector('script[src*="/divi/"]')
    ) {
      const ver = (gen.match(/Divi\s*([\d.]+)/i) || [])[1] || 'unknown';
      return { builder: 'Divi', version: ver, isPro: false, editorType: 'divi' };
    }

    // ── WPBakery ─────────────────────────────────────────────────────────────
    if (
      document.querySelector('[class*="vc_row"]') ||
      document.querySelector('[class*="vc_column"]') ||
      document.querySelector('[data-vc-full-width]') ||
      document.querySelector('link[href*="/js_composer/"]')
    ) {
      return { builder: 'WPBakery', version: 'unknown', isPro: false, editorType: 'wpbakery' };
    }

    // ── Bricks ───────────────────────────────────────────────────────────────
    if (
      document.querySelector('[class*="brxe-"]') ||
      document.querySelector('link[href*="/wp-content/themes/bricks/"]')
    ) {
      return { builder: 'Bricks', version: 'unknown', isPro: false, editorType: 'bricks' };
    }

    // ── Beaver Builder ───────────────────────────────────────────────────────
    if (
      document.querySelector('.fl-builder-content') ||
      document.querySelector('link[href*="/bb-plugin/"]') ||
      document.querySelector('link[href*="/beaver-builder/"]')
    ) {
      return { builder: 'Beaver Builder', version: 'unknown', isPro: false, editorType: 'beaver' };
    }

    // ── SeedProd ─────────────────────────────────────────────────────────────
    if (
      document.querySelector('[class*="seedprod-"]') ||
      document.querySelector('link[href*="/seedprod/"]')
    ) {
      return { builder: 'SeedProd', version: 'unknown', isPro: false, editorType: 'seedprod' };
    }

    // ── Flatsome UX Builder ──────────────────────────────────────────────────
    if (
      document.querySelector('[class*="ux_"]') ||
      document.querySelector('link[href*="/flatsome/"]') ||
      /Flatsome/i.test(gen)
    ) {
      return { builder: 'Flatsome (UX Builder)', version: 'unknown', isPro: false, editorType: 'flatsome' };
    }

    // ── Oxygen (use specific selectors — [class*="ct-"] is too generic) ──────
    if (
      document.querySelector('link[href*="/oxygen/"]') ||
      document.querySelector('[class*="ct-section"]') ||
      document.querySelector('[class*="ct-div-block"]') ||
      document.querySelector('[class*="oxy-"]')
    ) {
      return { builder: 'Oxygen', version: 'unknown', isPro: false, editorType: 'oxygen' };
    }

    // ── Gutenberg ────────────────────────────────────────────────────────────
    if (
      document.querySelector('[class*="wp-block-"]') ||
      document.querySelector('[class*="is-layout-flex"]')
    ) {
      return { builder: 'Gutenberg', version: 'native', isPro: false, editorType: 'gutenberg' };
    }

    // ── Classic editor ───────────────────────────────────────────────────────
    return { builder: 'Classic', version: 'native', isPro: false, editorType: 'classic' };
  }

  // ─── Heading Audit (DOM) ───────────────────────────────────────────────────

  /**
   * Returns a structured heading audit with issues + fix suggestions.
   * MUST run in the page (content-script) context.
   */
  static auditHeadings() {
    const headings = Array.from(
      document.querySelectorAll('h1,h2,h3,h4,h5,h6')
    ).map((el, idx) => ({
      idx,
      level     : parseInt(el.tagName[1], 10),
      text      : el.textContent.trim().replace(/\s+/g, ' '),
      id        : el.id || null,
      classes   : [...el.classList].join(' '),
      xpath     : ShahzaibSEOMCPBridge._xpath(el),
      isEmpty   : !el.textContent.trim(),
      wordCount : el.textContent.trim() ? el.textContent.trim().split(/\s+/).length : 0,
    }));

    const issues = [];
    const fixes  = [];

    // Issue 1: Missing H1
    const h1s = headings.filter(h => h.level === 1);
    if (h1s.length === 0) {
      issues.push({ code: 'MISSING_H1', severity: 'critical',
        message: 'Page has no H1 tag — required for SEO and accessibility.',
        fix: 'Add a single H1 that includes the primary keyword.' });
      fixes.push({ action: 'add_h1', reason: 'Missing H1' });
    }

    // Issue 2: Multiple H1s
    if (h1s.length > 1) {
      issues.push({ code: 'MULTIPLE_H1', severity: 'high',
        message: `${h1s.length} H1 tags found — only one is recommended.`,
        duplicates: h1s.slice(1).map(h => h.text),
        fix: 'Keep only one H1. Convert extras to H2.' });
      fixes.push({ action: 'convert_h1_to_h2',
        targets: h1s.slice(1).map(h => ({ text: h.text, xpath: h.xpath })),
        reason: 'Multiple H1s' });
    }

    // Issue 3: Empty headings
    const empty = headings.filter(h => h.isEmpty);
    if (empty.length) {
      issues.push({ code: 'EMPTY_HEADINGS', severity: 'medium',
        message: `${empty.length} empty heading(s) found.`,
        fix: 'Remove empty heading tags or add content.' });
      fixes.push({ action: 'remove_empty_headings',
        targets: empty.map(h => ({ level: h.level, xpath: h.xpath })) });
    }

    // Issue 4: Skipped heading levels
    const skips = [];
    let prevLevel = 0;
    for (const h of headings) {
      if (prevLevel && h.level > prevLevel + 1) {
        skips.push({ from: prevLevel, to: h.level, text: h.text, missing: `H${prevLevel + 1}` });
        issues.push({ code: 'SKIPPED_LEVEL', severity: 'medium',
          message: `Heading level jumped from H${prevLevel} to H${h.level} — skipped H${prevLevel + 1}.`,
          near: h.text.substring(0, 60),
          fix: `Change H${h.level} to H${prevLevel + 1}, or add a H${prevLevel + 1} before it.` });
      }
      prevLevel = h.level;
    }

    // Issue 5: Very long headings
    headings.filter(h => h.wordCount > 15).forEach(h => {
      issues.push({ code: 'LONG_HEADING', severity: 'low',
        message: `H${h.level} is very long (${h.wordCount} words): "${h.text.substring(0,60)}..."`,
        fix: 'Keep headings concise (ideally under 10 words).' });
    });

    // Issue 6: H1 === title tag
    const titleTag = document.title.trim();
    if (h1s.length === 1 && titleTag && h1s[0].text.toLowerCase() === titleTag.toLowerCase()) {
      issues.push({ code: 'H1_EQUALS_TITLE', severity: 'low',
        message: 'H1 and title tag are identical — differentiate them to target more keywords.',
        fix: 'Make the H1 more conversational; keep the title tag keyword-rich.' });
    }

    const criticals = issues.filter(i => i.severity === 'critical').length;
    const highs     = issues.filter(i => i.severity === 'high').length;
    const score     = Math.max(0, 100 - (criticals * 30) - (highs * 15) -
                      (issues.filter(i => i.severity === 'medium').length * 8) -
                      (issues.filter(i => i.severity === 'low').length * 3));

    return {
      headings,
      summary: {
        total: headings.length,
        byLevel: {
          h1: h1s.length,
          h2: headings.filter(h => h.level===2).length,
          h3: headings.filter(h => h.level===3).length,
          h4: headings.filter(h => h.level===4).length,
          h5: headings.filter(h => h.level===5).length,
          h6: headings.filter(h => h.level===6).length,
        },
        skippedLevels: skips,
        score,
      },
      issues,
      fixes,
    };
  }

  // ─── WordPress Post ID detection ──────────────────────────────────────────

  static async detectWordPressPostId() {
    // body class: "postid-123" / "page-id-123"
    const cls = document.body?.className || '';
    const m1 = cls.match(/\bpostid-(\d+)\b/) || cls.match(/\bpage-id-(\d+)\b/);
    if (m1) return parseInt(m1[1], 10);

    // <link rel="shortlink"> → ?p=123
    const shortlink = document.querySelector('link[rel="shortlink"]');
    if (shortlink) {
      const m = shortlink.href.match(/[?&]p=(\d+)/);
      if (m) return parseInt(m[1], 10);
    }

    // WP REST alternate link → /wp/v2/posts/123 or /pages/123
    const json = document.querySelector('link[rel="alternate"][type="application/json"]');
    if (json) {
      const m = json.href.match(/\/(?:posts|pages)\/(\d+)/);
      if (m) return parseInt(m[1], 10);
    }

    // Any element carrying a post id data attribute (Elementor etc.)
    const dataEl = document.querySelector('[data-elementor-id],[data-post-id],article[id^="post-"]');
    if (dataEl) {
      const v = dataEl.getAttribute('data-elementor-id') ||
                dataEl.getAttribute('data-post-id') ||
                (dataEl.id.match(/post-(\d+)/) || [])[1];
      if (v && /^\d+$/.test(v)) return parseInt(v, 10);
    }

    // URL params
    try {
      const url = new URL(window.location.href);
      for (const key of ['page_id', 'p', 'post', 'post_id']) {
        if (url.searchParams.has(key) && /^\d+$/.test(url.searchParams.get(key))) {
          return parseInt(url.searchParams.get(key), 10);
        }
      }
    } catch (_) {}

    // ── Fallback: ask the site's own REST API. Themes/builders that strip
    // body classes, shortlinks, or the JSON-alternate <link> (custom themes,
    // aggressive cache/CDN HTML, page builders) still expose the standard WP
    // REST API on ~99% of installs, so we resolve the post/page ID by slug —
    // no WP-admin visit or manual ?p=ID needed. ────────────────────────────
    try {
      const id = await ShahzaibSEOMCPBridge._detectPostIdViaRestApi();
      if (id) return id;
    } catch (_) {}

    return null;
  }

  /**
   * Resolve the current page's post/page ID via the public WP REST API.
   * Runs in the PAGE context — same-origin fetch, no CORS issues, no auth
   * required (uses only publicly-readable REST routes).
   */
  static async _detectPostIdViaRestApi() {
    // 1) Find the REST API root. WordPress emits a standard discovery tag
    //    on the front end: <link rel="https://api.w.org/" href=".../wp-json/">
    //    — far more reliable than scraping theme-specific markup.
    let apiRoot = null;
    const apiLink = document.querySelector('link[rel="https://api.w.org/"]');
    if (apiLink?.href) apiRoot = apiLink.href.replace(/\/?$/, '/');
    if (!apiRoot) apiRoot = `${window.location.origin}/wp-json/`;

    // 2) Derive a slug from the current path (last non-empty segment).
    const path = window.location.pathname.replace(/\/+$/, '');
    const slug = decodeURIComponent(path.split('/').pop() || '');
    if (!slug) return null; // homepage / no slug to match against

    const fetchJson = async (url) => {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) return null;
      try { return await res.json(); } catch (_) { return null; }
    };

    // 3) Try the common post types first (covers the vast majority of pages).
    for (const type of ['posts', 'pages']) {
      const data = await fetchJson(
        `${apiRoot}wp/v2/${type}?slug=${encodeURIComponent(slug)}&_fields=id`
      ).catch(() => null);
      if (Array.isArray(data) && data[0]?.id) return parseInt(data[0].id, 10);
    }

    // 4) Last resort: the core "search" endpoint also covers custom post
    //    types (products, portfolio items, etc.) registered with show_in_rest.
    try {
      const data = await fetchJson(
        `${apiRoot}wp/v2/search?search=${encodeURIComponent(slug)}&_fields=id,url,slug&per_page=5`
      );
      if (Array.isArray(data)) {
        const here = window.location.href.replace(/\/+$/, '');
        const hit = data.find(r =>
          (r.url && r.url.replace(/\/+$/, '') === here) ||
          (r.slug && r.slug === slug)
        ) || data[0];
        if (hit?.id) return parseInt(hit.id, 10);
      }
    } catch (_) {}

    return null;
  }

  // ─── JSON-RPC transport ────────────────────────────────────────────────────

  async _rpc(method, params, { mutating = false } = {}) {
    if (!this.isConfigured()) throw new Error('WP x MCP not configured (endpoint + API key required).');
    if (mutating && this.dryRun) {
      return { _dryRun: true, method, params };
    }

    const payload = { jsonrpc: '2.0', id: this._rpcId++, method };
    if (params !== undefined) payload.params = params;

    const headers = {
      'Content-Type'    : 'application/json',
      'Accept'          : 'application/json',
      'X-WPXMCP-API-Key': this.apiKey,
      'Authorization'   : `Bearer ${this.apiKey}`,
    };

    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await fetch(this.endpoint, {
          method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`MCP HTTP ${res.status} ${res.statusText}${body ? ' — ' + body.slice(0, 200) : ''}`);
        }
        const data = await res.json();
        if (data.error) throw new Error(`MCP error ${data.error.code ?? ''}: ${data.error.message || 'unknown'}`);
        return data.result;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        // Retry once on transient network/abort errors only.
        const transient = e.name === 'AbortError' || /network|failed to fetch/i.test(e.message);
        if (!transient || attempt === 1) break;
        await new Promise(r => setTimeout(r, 600));
      }
    }
    throw lastErr;
  }

  /**
   * Call an MCP tool by name. Returns the unwrapped result.
   * @param {string} toolName
   * @param {object} args
   * @param {object} [opts] - { mutating:boolean, skipValidation:boolean }
   *   mutating       - mark tools that change data (honours dryRun). When
   *                    omitted, it is inferred from the tool's annotations.
   *   skipValidation - bypass the inputSchema.required pre-flight check.
   */
  async call(toolName, args = {}, opts = {}) {
    const t0 = Date.now();
    let result, error = null;

    // Infer `mutating` from server annotations when the caller didn't say.
    if (opts.mutating === undefined) {
      const a = this.getToolAnnotations(toolName);
      if (a) opts = { ...opts, mutating: a.destructiveHint === true || a.readOnlyHint === false };
    }

    // Pre-flight: validate required args against the tool's inputSchema so we
    // surface a clear, actionable error instead of a malformed server call.
    if (!opts.skipValidation) {
      const v = this.validateArgs(toolName, args);
      if (!v.ok && v.known) {
        const e = new Error(`Missing required arg(s) for ${toolName}: ${v.missing.join(', ')}`);
        e.code = 'MISSING_ARGS';
        e.missing = v.missing;
        this._log.push({ ts: new Date().toISOString(), ms: 0, tool: toolName, args, error: e.message, skipped: true });
        throw e;
      }
    }

    try {
      const raw = await this._rpc('tools/call', { name: toolName, arguments: args }, opts);
      result = this._unwrap(raw);
      return result;
    } catch (e) {
      error = e.message;
      throw e;
    } finally {
      this._log.push({ ts: new Date().toISOString(), ms: Date.now() - t0, tool: toolName, args, ...(error ? { error } : { ok: true }) });
    }
  }

  /** Look up a cached tool object by name (from listTools()). */
  getTool(name) {
    if (!this._tools) return null;
    return this._tools.find(t => t.name === name) || null;
  }

  /** Server-provided annotations for a tool ({readOnlyHint,destructiveHint}) or null. */
  getToolAnnotations(name) {
    const t = this.getTool(name);
    return t ? (t.annotations || null) : null;
  }

  /**
   * Validate args against a tool's inputSchema.required.
   * Returns { ok, missing:[...], known } — `known:false` when we have no schema
   * for this tool yet (so callers can fall back gracefully rather than block).
   */
  validateArgs(name, args = {}) {
    const t = this.getTool(name);
    if (!t || !t.inputSchema) return { ok: true, missing: [], known: false };
    const required = t.inputSchema.required || [];
    const missing = required.filter(r => args == null || args[r] === undefined || args[r] === '' || args[r] === null);
    return { ok: missing.length === 0, missing, known: true };
  }

  /**
   * Normalises MCP responses. WP x MCP may return either a plain object/array
   * or the MCP content-block shape { content: [{ type:'text', text:'...' }] }.
   * For content blocks we parse JSON when possible, else return the joined text.
   */
  _unwrap(raw) {
    if (raw == null) return raw;
    if (Array.isArray(raw?.content)) {
      const texts = raw.content
        .filter(b => b && (b.type === 'text' || typeof b.text === 'string'))
        .map(b => b.text);
      const joined = texts.join('\n').trim();
      if (!joined) return raw;
      try { return JSON.parse(joined); } catch { return joined; }
    }
    return raw;
  }

  // ─── Capability discovery ──────────────────────────────────────────────────

  async listTools(force = false) {
    if (this._tools && !force) return this._tools;
    const result = await this._rpc('tools/list');
    this._tools = result?.tools || [];
    return this._tools;
  }

  async ensureTools() {
    if (!this._tools) { try { await this.listTools(); } catch (_) { this._tools = []; } }
    return this._tools || [];
  }

  hasTool(name) {
    if (!this._tools) return true; // unknown yet → optimistic (call will error if absent)
    return this._tools.some(t => t.name === name);
  }

  // ─── Master fix dispatcher ─────────────────────────────────────────────────

  /**
   * @param {object} p
   * @param {object} p.headingAudit  - from auditHeadings() (page context)
   * @param {object} p.pageBuilder   - from detectPageBuilder() (page context)
   * @param {number} p.postId        - WordPress post ID
   * @param {object} p.auditData     - full ShahzaibSEO page audit (_rawData)
   */
  async fixAll({ headingAudit, pageBuilder, postId, auditData, fixOptions, tools, argBuilders }) {
    // Backwards-compatible shape.
    const results = { heading: [], seo: [], images: [], schema: [], perTool: [], errors: [] };
    postId = postId || this.postId;

    if (!postId) {
      results.errors.push('Post ID not found. Cannot apply server-side fixes.');
      return results;
    }

    const opt = Object.assign({ heading: true, seo: true, images: true, schema: true }, fixOptions || {});
    const skipped = (cat) => [{ status: 'info', message: `Skipped: "${cat}" is disabled in MCP fix options.` }];

    // Prime capability cache so we can skip tools the server doesn't expose.
    await this.ensureTools();

    // ── 1) Headings (legacy path, used when the UI didn't pass `tools`) ──────
    if (!Array.isArray(tools) || !tools.length) {
      if (!opt.heading) {
        results.heading.push(...skipped('headings'));
      } else if (headingAudit) {
        try {
          results.heading.push(...await this.fixHeadings({ headingAudit, pageBuilder, postId }));
        } catch (e) { results.errors.push(`Heading fix failed: ${e.message}`); }
      } else {
        results.heading.push({ status: 'info', message: 'No heading audit available for this page.' });
      }

      // 2) SEO meta
      if (!opt.seo) {
        results.seo.push(...skipped('SEO meta'));
      } else if (auditData) {
        try {
          results.seo.push(...await this.fixSEOMeta({ postId, auditData }));
        } catch (e) { results.errors.push(`SEO meta fix failed: ${e.message}`); }
      } else {
        results.seo.push({ status: 'info', message: 'No audit data available to derive SEO meta.' });
      }

      // 3) Image alt text
      if (!opt.images) {
        results.images.push(...skipped('image alt'));
      } else if (auditData?.images) {
        try {
          results.images.push(...await this.fixImageAlts({ postId, auditData }));
        } catch (e) { results.errors.push(`Image alt fix failed: ${e.message}`); }
      } else {
        results.images.push({ status: 'info', message: 'No image data in audit.' });
      }

      // 4) Schema
      if (opt.schema) {
        results.schema.push({ status: 'info', message: 'Schema fixes are not yet wired in the bridge. Patch rankseo_schema_patch manually for now.' });
      } else {
        results.schema.push(...skipped('schema'));
      }
    }

    // ── 2) Per-tool dispatch (new dynamic path) ─────────────────────────────
    // If the caller passed an array of tool names, call them in order with
    // args built by the matching argBuilder (or the generic post_id default).
    if (Array.isArray(tools) && tools.length) {
      for (const name of tools) {
        const buildArgs = (argBuilders && argBuilders[name]) || null;
        const args = buildArgs ? buildArgs({ postId, auditData, headingAudit, pageBuilder }) : { post_id: postId };
        // Prefer the server's own annotation; fall back to a name heuristic.
        const ann = this.getToolAnnotations(name);
        const mutating = ann
          ? (ann.destructiveHint === true || ann.readOnlyHint === false)
          : !/(\baudit|analy[sz]e|list_|get_|stats|status|scan|check)/i.test(name);
        try {
          const detail = await this.call(name, args, { mutating });
          results.perTool.push({ status: 'ok', tool: name, args, detail });
        } catch (e) {
          // MISSING_ARGS comes from the schema pre-flight — report as a skip,
          // not a hard failure (graceful fallback).
          const isSkip = e.code === 'MISSING_ARGS';
          results.perTool.push({ status: isSkip ? 'info' : 'error', tool: name, args, message: e.message });
        }
      }
    }

    return results;
  }

  // ─── Heading fixes ─────────────────────────────────────────────────────────

  async fixHeadings({ headingAudit, pageBuilder, postId }) {
    const results = [];
    const { issues } = headingAudit;
    if (!issues.length) return [{ status: 'ok', message: 'No heading issues found.' }];

    switch (pageBuilder?.editorType) {
      case 'elementor':
        return this.hasTool('elementor_patch_content')
          ? this._fixHeadingsElementor({ headingAudit, postId })
          : [{ status: 'info', message: 'Elementor heading fix requires the elementor_patch_content MCP tool, which is not exposed by this server.' }];

      case 'avada':
        return this._fixHeadingsAvada({ headingAudit, postId });

      case 'bricks':
        return [{ status: 'info', message: 'Bricks: heading fixes require reading `_bricks_page_content_2` post meta → patch JSON → update_post_meta. Run via Claude + WP x MCP.' }];
      case 'beaver':
        return [{ status: 'info', message: 'Beaver Builder: heading fixes require reading `_fl_builder_data` post meta → patch serialized data → update_post_meta.' }];
      case 'oxygen':
        return [{ status: 'info', message: 'Oxygen: heading fixes require reading `ct_builder_shortcodes` post meta → patch → update_post_meta.' }];

      case 'gutenberg':
      case 'classic':
      case 'divi':
      case 'wpbakery':
      case 'flatsome':
      case 'seedprod':
      default:
        return this._fixHeadingsPostContent({ headingAudit, postId });
    }
    return results;
  }

  async _fixHeadingsElementor({ headingAudit, postId }) {
    const results = [];
    const { headings, summary } = headingAudit;

    try { await this.call('elementor_read_page', { post_id: postId }); }
    catch (e) { return [{ status: 'error', message: `Could not read Elementor data: ${e.message}` }]; }

    const patches = [];
    const h1s = headings.filter(h => h.level === 1);
    if (h1s.length > 1) {
      for (const h of h1s.slice(1)) {
        patches.push({ type: 'update_by_text', text: h.text, widget: 'heading',
          field: 'header_size', value: 'h2', reason: 'Converting duplicate H1 to H2' });
      }
    }
    for (const skip of summary.skippedLevels) {
      if (headings.find(h => h.text === skip.text)) {
        patches.push({ type: 'update_by_text', text: skip.text, widget: 'heading',
          field: 'header_size', value: `h${skip.from + 1}`,
          reason: `Fixing skipped level H${skip.from}→H${skip.to}` });
      }
    }
    if (!patches.length) return [{ status: 'info', message: 'No Elementor heading patches needed (remaining issues may require manual edits).' }];

    try {
      // WP x MCP's elementor_patch_content requires `edits` (not `patches`).
      const detail = await this.call('elementor_patch_content', { post_id: postId, edits: patches }, { mutating: true });
      results.push({ status: 'ok', tool: 'elementor_patch_content', patchCount: patches.length, detail });
    } catch (e) {
      results.push({ status: 'error', message: `elementor_patch_content failed: ${e.message}` });
    }
    return results;
  }

  async _fixHeadingsAvada({ headingAudit, postId }) {
    const results = [];
    const { headings, summary, issues } = headingAudit;
    const h1s = headings.filter(h => h.level === 1);

    let fusionContent;
    try {
      fusionContent = await this.call('get_post_meta', { post_id: postId, key: '_fusion_builder_content' });
    } catch (e) {
      results.push({ status: 'info', message: `Could not read _fusion_builder_content: ${e.message}. Falling back to post_content.` });
      return this._fixHeadingsPostContent({ headingAudit, postId });
    }
    if (!fusionContent) {
      results.push({ status: 'info', message: 'No Fusion Builder meta — patching post_content instead.' });
      return this._fixHeadingsPostContent({ headingAudit, postId });
    }

    let patched = fusionContent, changed = false;

    // Multiple H1 → H2  (FIXED: properly escaped patterns)
    if (h1s.length > 1) {
      for (const h of h1s.slice(1)) {
        const esc = ShahzaibSEOMCPBridge._esc(h.text);
        const scRegex   = new RegExp(`(\\[fusion_title[^\\]]*size=")1(")(.*?)${esc}(.*?\\[\\/fusion_title\\])`, 'gi');
        const htmlRegex = new RegExp(`<h1([^>]*)>\\s*${esc}\\s*<\\/h1>`, 'gi');
        const after = patched.replace(scRegex, `$1` + `2` + `$2$3${h.text}$4`).replace(htmlRegex, `<h2$1>${h.text}</h2>`);
        if (after !== patched) { patched = after; changed = true; results.push({ status: 'ok', action: 'avada_converted_h1_to_h2', text: h.text }); }
      }
    }

    // Skipped levels
    for (const skip of summary.skippedLevels) {
      const esc = ShahzaibSEOMCPBridge._esc(skip.text);
      const nl  = skip.from + 1;
      const scRegex   = new RegExp(`(\\[fusion_title[^\\]]*size=")${skip.to}(")(.*?)${esc}(.*?\\[\\/fusion_title\\])`, 'gi');
      const htmlRegex = new RegExp(`<h${skip.to}([^>]*)>\\s*${esc}\\s*<\\/h${skip.to}>`, 'gi');
      const after = patched.replace(scRegex, `$1${nl}$2$3${skip.text}$4`).replace(htmlRegex, `<h${nl}$1>${skip.text}</h${nl}>`);
      if (after !== patched) { patched = after; changed = true; results.push({ status: 'ok', action: `avada_fixed_h${skip.to}_to_h${nl}`, text: skip.text }); }
    }

    if (changed) {
      try {
        await this.call('update_post_meta', { post_id: postId, key: '_fusion_builder_content', value: patched }, { mutating: true });
        results.push({ status: 'ok', action: 'avada_meta_saved', postId });
      } catch (e) { results.push({ status: 'error', message: `Failed to save Avada meta: ${e.message}` }); }
    } else {
      results.push({ status: 'info', message: 'No Avada content changes (adding a missing H1 requires new content — use Fusion Builder or Claude AI).', issuesToFix: issues.map(i => i.code) });
    }
    return results;
  }

  async _fixHeadingsPostContent({ headingAudit, postId }) {
    const results = [];
    const { headings, summary, issues } = headingAudit;
    const h1s = headings.filter(h => h.level === 1);
    let changed = false;

    let post;
    try { post = await this.call('get_post', { id: postId }); }
    catch (e) { return [{ status: 'error', message: `Could not read post: ${e.message}` }]; }

    let content = post?.post_content || post?.content || '';
    if (!content) return [{ status: 'info', message: 'Post content empty or stored in builder meta — no direct HTML to patch.' }];

    if (h1s.length > 1) {
      for (const h of h1s.slice(1)) {
        const esc = ShahzaibSEOMCPBridge._esc(h.text);
        const regex = new RegExp(`<h1([^>]*)>\\s*${esc}\\s*<\\/h1>`, 'gi');
        const after = content.replace(regex, `<h2$1>${h.text}</h2>`);
        if (after !== content) { content = after; changed = true; results.push({ status: 'ok', action: 'converted_duplicate_h1_to_h2', text: h.text }); }
      }
    }
    for (const skip of summary.skippedLevels) {
      const esc = ShahzaibSEOMCPBridge._esc(skip.text);
      const nl  = skip.from + 1;
      const regex = new RegExp(`<h${skip.to}([^>]*)>\\s*${esc}\\s*<\\/h${skip.to}>`, 'gi');
      const after = content.replace(regex, `<h${nl}$1>${skip.text}</h${nl}>`);
      if (after !== content) { content = after; changed = true; results.push({ status: 'ok', action: `fixed_skipped_level_h${skip.to}_to_h${nl}`, text: skip.text }); }
    }

    if (changed) {
      try {
        await this.call('update_post', { id: postId, content }, { mutating: true });
        results.push({ status: 'ok', action: 'post_content_saved', postId });
      } catch (e) { results.push({ status: 'error', message: `Failed to save post content: ${e.message}` }); }
    } else {
      results.push({ status: 'info', message: 'No content changes (issues like missing H1 require new content, added manually or via AI).', issuesToFix: issues.map(i => i.code) });
    }
    return results;
  }

  // ─── SEO meta fix ──────────────────────────────────────────────────────────

  async fixSEOMeta({ postId, auditData }) {
    const meta = auditData?.meta || auditData?.seo || {};
    const kw   = auditData?.keywords || {};
    const title = meta.title?.content ?? meta.title ?? '';
    const desc  = meta.description?.content ?? meta.description ?? meta.desc ?? '';
    const canon = meta.canonical?.href ?? meta.canonical ?? '';
    const focus = kw.focusKeyword || kw.top?.[0]?.word || '';
    const needsTitle = !title || String(title).length < 10;
    const needsDesc  = !desc  || String(desc).length  < 50;

    if (!needsTitle && !needsDesc) return [{ status: 'ok', message: 'SEO meta title and description already set.' }];

    // Prefer the post-scoped seo_set_meta (schema: post_id, title, description,
    // focus_kw, canonical). seo_fix_all is SITE-WIDE (no post_id) so we only
    // use it as a last resort and clearly flag the wider scope.
    if (this.hasTool('seo_set_meta')) {
      const args = { post_id: postId };
      if (title) args.title = title;
      if (desc)  args.description = desc;
      if (focus) args.focus_kw = focus;        // correct key is focus_kw
      if (canon) args.canonical = canon;
      try {
        const detail = await this.call('seo_set_meta', args, { mutating: true });
        return [{ status: 'ok', tool: 'seo_set_meta', detail }];
      } catch (e) { return [{ status: 'error', message: `seo_set_meta failed: ${e.message}` }]; }
    }

    if (this.hasTool('seo_fix_all')) {
      try {
        // Site-wide batch — cannot target a single post. dry_run kept false.
        const detail = await this.call('seo_fix_all', { dry_run: false }, { mutating: true });
        return [{ status: 'ok', tool: 'seo_fix_all', scope: 'site-wide', detail,
          message: 'seo_set_meta not available — ran seo_fix_all (site-wide).' }];
      } catch (e) { return [{ status: 'error', message: `seo_fix_all failed: ${e.message}` }]; }
    }

    return [{ status: 'info', message: 'No SEO meta tool (seo_set_meta / seo_fix_all) exposed by this MCP server.' }];
  }

  // ─── Image alt fix ───────────────────────────────────────────────────────

  async fixImageAlts({ postId, auditData }) {
    const missing = auditData?.images?.withoutAlt ?? auditData?.images?.missingAlt ?? 0;
    if (!missing) return [{ status: 'ok', message: 'All images have alt text.' }];
    if (!this.hasTool('audit_image_alts')) {
      return [{ status: 'info', message: `${missing} image(s) missing alt text. Server exposes no audit_image_alts tool — fix via Claude + media library.` }];
    }
    try {
      // audit_image_alts is a read-only diagnostic (schema: post_type, limit,
      // include_media_library — NO post_id, NO auto_fix). It reports offenders;
      // applying alts requires fix_image_alt per attachment_id.
      const detail = await this.call('audit_image_alts', { include_media_library: true }, { mutating: false });
      return [{ status: 'info', tool: 'audit_image_alts', missing, detail,
        message: `Found image(s) missing alt text. Apply per-image with fix_image_alt (attachment_id + alt_text) — use the Run-tool panel or Claude.` }];
    } catch (e) { return [{ status: 'error', message: `audit_image_alts failed: ${e.message}` }]; }
  }

  // ─── Convenience server-side helpers ───────────────────────────────────────

  runServerAudit(postId)  { return this.call('seo_audit_post', { post_id: postId || this.postId }); }
  runBulkAudit({ postType = 'any', maxScore = 70, page = 1 } = {}) {
    return this.call('seo_bulk_audit', { post_type: postType, max_score: maxScore, page });
  }
  attachFAQSchema(postId, faqs) {
    return this.call('seo_build_faq_schema', { post_id: postId, faqs, append_visible: true }, { mutating: true });
  }
  generateLlmsTxt() { return this.call('seo_generate_llms_txt', {}, { mutating: true }); }
  suggestInternalLinks(postId) { return this.call('seo_suggest_internal_links', { post_id: postId }); }

  // ─── Private helpers ───────────────────────────────────────────────────────

  static _esc(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  static _xpath(el) {
    if (!el) return '';
    const parts = [];
    while (el && el.nodeType === 1) {
      let idx = 1, sib = el.previousSibling;
      while (sib) { if (sib.nodeType === 1 && sib.tagName === el.tagName) idx++; sib = sib.previousSibling; }
      parts.unshift(`${el.tagName.toLowerCase()}[${idx}]`);
      el = el.parentNode;
    }
    return '/' + parts.join('/');
  }

  getLog()   { return this._log; }
  clearLog() { this._log = []; }
}

// Export for popup.js and (static methods) page injection.
if (typeof window !== 'undefined') window.ShahzaibSEOMCPBridge = ShahzaibSEOMCPBridge;
if (typeof module !== 'undefined') module.exports = { ShahzaibSEOMCPBridge };
