/**
 * Privacy blur for screen recordings: blurs URLs (and optionally queries)
 * everywhere on Search Console pages so video audiences can't see them.
 *
 * - URL blur: walks text nodes and wraps anything that looks like a URL
 *   (https://…, www.…, or bare domains like example.com) in a blurred
 *   span. Blurred elements are non-interactive (pointer-events: none) so a
 *   hovered link can't leak its URL via the browser's status-bar preview.
 * - Query blur: in the Performance report's Queries table, blurs the query
 *   column's cells (found via the table headers, not fragile DOM paths).
 *
 * A debounced MutationObserver re-applies the blur to dynamically loaded
 * content (GSC renders tables asynchronously). State comes from extension
 * settings (scqt:settings → blurUrls / blurQueries) and updates live via
 * storage.onChanged, so toggling in the popup (or the Ctrl+Shift+B
 * shortcut) applies instantly to open tabs.
 *
 * Note: the browser's own address bar / tab strip can't be blurred by any
 * extension — crop those in the video itself.
 */

const SCBlur = {
  state: { blurUrls: false, blurQueries: false },
  _observer: null,
  _debounceTimer: null,

  // Matches full URLs, www. hosts, and bare domains with common TLDs.
  // The TLD whitelist keeps false positives low (e.g. "v1.2" won't match).
  // Note: the middle subdomain part is optional so two-part domains like
  // "thedbt.ai" match, not just "www.example.com".
  URL_RE: /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*\.(com|org|net|io|ai|co|app|dev|pk|uk|us|info|biz|me|site|online|store|tech|blog|news|tv|de|fr|es|it|nl|ca|au|nz|ae|sa|my|id|ph|sg|hk|jp|kr|cn|br|mx|ar|za|ng|eg|tr|ru|pl|se|no|dk|fi|be|ch|at|ie|pt|gr|cz|hu|ro|il|qa|kw|bh|om|jo|lb|iq|af|bd|lk)\b/gi,

  QUERY_HEADER_RE: /top queries|^\s*queries?\s*$/i,

  async init() {
    try {
      const stored = await chrome.storage.local.get('scqt:settings');
      const s = stored['scqt:settings'] || {};
      this.state.blurUrls = !!s.blurUrls;
      this.state.blurQueries = !!s.blurQueries;
    } catch { /* storage unavailable — blur stays off */ }

    this.apply();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes['scqt:settings']) return;
      const s = changes['scqt:settings'].newValue || {};
      this.setState({ blurUrls: !!s.blurUrls, blurQueries: !!s.blurQueries });
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'SCQT_BLUR_STATE') {
        this.setState({ blurUrls: !!message.blurUrls, blurQueries: !!message.blurQueries });
      }
    });

    // Re-apply to content GSC loads after the initial render.
    this._observer = new MutationObserver(() => {
      if (!this.state.blurUrls && !this.state.blurQueries) return;
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => this.apply(), 400);
    });
    this._observer.observe(document.documentElement, { childList: true, subtree: true });
  },

  setState(next) {
    const changed = next.blurUrls !== this.state.blurUrls || next.blurQueries !== this.state.blurQueries;
    this.state = { ...this.state, ...next };
    if (this.state.blurUrls || this.state.blurQueries) this.apply();
    else this.clear();
    return changed;
  },

  apply() {
    if (this.state.blurUrls) {
      this._blurUrlsIn(document.body);
      this._blurUrlInputs();
    }
    if (this.state.blurQueries) this._blurQueryCells();
  },

  clear() {
    document.querySelectorAll('.scqt-blur').forEach((el) => {
      // Unwrap URL spans, unmark table cells.
      if (el.tagName === 'SPAN' && el.parentNode) {
        el.replaceWith(document.createTextNode(el.textContent));
      } else {
        el.classList.remove('scqt-blur');
      }
    });
    // Merge adjacent text nodes left behind by unwrapping.
    if (document.body) document.body.normalize();
  },

  _isSkipped(node) {
    let el = node.parentElement;
    while (el) {
      if (el.classList && (el.classList.contains('scqt-blur') || el.classList.contains('sc-qt-toast-container'))) return true;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'INPUT') return true;
      el = el.parentElement;
    }
    return false;
  },

  _blurUrlsIn(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || node.nodeValue.trim().length < 4) continue;
      if (this._isSkipped(node)) continue;
      this.URL_RE.lastIndex = 0;
      if (this.URL_RE.test(node.nodeValue)) nodes.push(node);
    }
    for (const textNode of nodes) this._wrapUrlMatches(textNode);
  },

  _wrapUrlMatches(textNode) {
    const text = textNode.nodeValue;
    this.URL_RE.lastIndex = 0;
    let match, lastIndex = 0;
    const frag = document.createDocumentFragment();
    let found = false;
    while ((match = this.URL_RE.exec(text))) {
      found = true;
      if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const span = document.createElement('span');
      span.className = 'scqt-blur';
      span.textContent = match[0];
      frag.appendChild(span);
      lastIndex = match.index + match[0].length;
      // Guard against zero-length matches looping forever.
      if (match[0].length === 0) { this.URL_RE.lastIndex++; }
    }
    if (!found) return;
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    textNode.parentNode.replaceChild(frag, textNode);
  },

  /**
   * Blurs <input> elements whose value or placeholder contains a URL.
   * Search Console renders the property selector and the URL-inspection
   * bar as inputs (not text nodes), so text-walking alone misses them.
   * The whole input is blurred — fine for a privacy mode.
   */
  _blurUrlInputs() {
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      if (input.classList.contains('scqt-blur')) continue;
      if (input.classList.contains('sc-qt-toast-container')) continue;
      const haystack = `${input.value || ''} ${input.placeholder || ''}`;
      this.URL_RE.lastIndex = 0;
      if (haystack && this.URL_RE.test(haystack)) {
        input.classList.add('scqt-blur');
      }
    }
  },

  _blurQueryCells() {
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th'));
      const queryIdx = headers.findIndex((th) => this.QUERY_HEADER_RE.test(th.textContent || ''));
      if (queryIdx === -1) continue;
      // Sanity: it should look like the Performance queries table (has a Clicks column too).
      const hasClicks = headers.some((th) => /clicks/i.test(th.textContent || ''));
      if (!hasClicks) continue;
      const rows = table.querySelectorAll('tbody tr, tr');
      for (const row of rows) {
        if (row.querySelector('th')) continue; // skip header rows
        const cells = row.querySelectorAll('td');
        const cell = cells[queryIdx];
        if (cell && !cell.classList.contains('scqt-blur')) cell.classList.add('scqt-blur');
      }
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SCBlur };
}
