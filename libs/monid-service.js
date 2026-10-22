/**
 * Monid API Service
 * Discover & run hundreds of data endpoints (SEO, domain data, social, enrichment)
 * via a single interface. Docs: https://monid.ai / https://docs.monid.ai
 *
 * Key provided by user is stored in chrome.storage and used for authenticated calls.
 * Spends Monid balance — only call when the capability is not already covered by
 * a free/direct ShahzaibSEO integration.
 */

class MonidService {
  constructor() {
    this.apiKey = null;
    this.baseUrl = 'https://api.monid.ai/v1';
  }

  async init() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['monidConfig', 'monidApiKey'], (result) => {
        try {
          if (result.monidConfig) {
            const cfg = typeof result.monidConfig === 'string' ? JSON.parse(result.monidConfig) : result.monidConfig;
            this.apiKey = cfg?.apiKey || '';
          }
          if (!this.apiKey && result.monidApiKey) {
            this.apiKey = result.monidApiKey;
          }
        } catch (_) {
          this.apiKey = result.monidApiKey || '';
        }
        // Fallback to the key supplied at build / first-run (user can override in Settings)
        if (!this.apiKey) {
          this.apiKey = 'monid_live_zoTUYEfdAH8GgpQT4abowDtk';
        }
        console.log('[Monid] Key loaded:', this.apiKey ? 'Yes' : 'No');
        resolve(!!this.apiKey);
      });
    });
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  /**
   * Discover available endpoints by natural language query
   * @param {string} query
   * @param {number} limit
   */
  async discover(query, limit = 8) {
    await this.init();
    const resp = await fetch(`${this.baseUrl}/discover`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ query, limit })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || err.error || `Discover failed: ${resp.status}`);
    }
    return resp.json();
  }

  /**
   * Inspect endpoint schema
   */
  async inspect(provider, endpoint) {
    await this.init();
    const resp = await fetch(`${this.baseUrl}/inspect`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ provider, endpoint })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || `Inspect failed: ${resp.status}`);
    }
    return resp.json();
  }

  /**
   * Run an endpoint. Supports query/path/body.
   * Polls if async (202).
   * @param {Object} opts { provider, endpoint, input?, query?, path?, waitMs? }
   */
  async run(opts) {
    await this.init();
    const body = {
      provider: opts.provider,
      endpoint: opts.endpoint
    };
    if (opts.input) body.input = opts.input;
    if (opts.queryParams) body.queryParams = opts.queryParams;
    else if (opts.query) body.queryParams = opts.query;
    if (opts.pathParams) body.pathParams = opts.pathParams;
    else if (opts.path) body.pathParams = opts.path;

    const resp = await fetch(`${this.baseUrl}/run`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body)
    });

    const data = await resp.json().catch(() => ({}));

    if (resp.status === 200) {
      // Sync result
      return { ok: true, status: 'COMPLETED', data, runId: data.runId || null };
    }

    if (resp.status === 202 && (data.runId || data.id)) {
      const runId = data.runId || data.id;
      return this._pollRun(runId, opts.waitMs || 45000);
    }

    throw new Error(data.message || data.error || data.reason || `Run failed: ${resp.status}`);
  }

  async _pollRun(runId, maxWaitMs = 45000) {
    const start = Date.now();
    let delay = 1500;
    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, delay));
      const resp = await fetch(`${this.baseUrl}/runs/${runId}`, {
        headers: this._headers()
      });
      const data = await resp.json().catch(() => ({}));
      const status = (data.status || '').toUpperCase();
      if (['COMPLETED', 'FAILED', 'BLOCKED', 'STOPPED', 'TIMED_OUT'].includes(status)) {
        return {
          ok: status === 'COMPLETED',
          status,
          runId,
          data,
          cost: data.cost,
          output: data.output || data.result || data.providerResponse?.body || data
        };
      }
      delay = Math.min(delay * 1.4, 5000);
    }
    return { ok: false, status: 'TIMEOUT', runId, error: 'Polling timed out' };
  }

  async balance() {
    await this.init();
    // CLI uses internal; try common path
    try {
      const resp = await fetch(`${this.baseUrl}/auth/whoami`, { headers: this._headers() });
      if (resp.ok) return resp.json();
    } catch (_) {}
    return null;
  }

  // ── Convenience SEO helpers ──────────────────────────────────────

  /**
   * Domain Rating via Ahrefs (Monid)
   */
  async getDomainRating(target) {
    const today = new Date().toISOString().slice(0, 10);
    return this.run({
      provider: 'ahrefs',
      endpoint: '/site-explorer/domain-rating',
      queryParams: { target, date: today },
      waitMs: 15000
    });
  }

  /**
   * Quick SEO audit (Strale or similar)
   */
  async seoAudit(url) {
    // Prefer a cheap / known endpoint; discover first if needed
    try {
      return await this.run({
        provider: 'api.strale.io',
        endpoint: '/x402/seo-audit',
        input: { url },
        waitMs: 20000
      });
    } catch (e) {
      // Fallback: discover
      const found = await this.discover(`SEO audit ${url}`, 3);
      const first = found?.results?.[0] || found?.items?.[0];
      if (!first) throw e;
      return this.run({
        provider: first.provider,
        endpoint: first.endpoint,
        input: { url },
        waitMs: 25000
      });
    }
  }

  /**
   * Generic enrichment by natural language (discover + run top match)
   */
  async enrich(query, input = {}) {
    const disc = await this.discover(query, 5);
    const list = disc?.results || disc?.items || [];
    if (!list.length) throw new Error('No matching Monid endpoints found for: ' + query);
    const top = list[0];
    return this.run({
      provider: top.provider,
      endpoint: top.endpoint,
      input,
      waitMs: 30000
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MonidService;
}
