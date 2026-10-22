/**
 * Regex helpers: RE2-compatibility linting (GSC's custom filter runs on RE2,
 * which lacks lookahead/lookbehind/backreferences), safe testing, and match
 * highlighting for the popup's regex tester.
 */

const RE2_UNSUPPORTED_PATTERNS = [
  { re: /\(\?=/, message: 'Positive lookahead "(?=...)" is not supported by RE2 (GSC\'s regex engine).' },
  { re: /\(\?!/, message: 'Negative lookahead "(?!...)" is not supported by RE2 (GSC\'s regex engine).' },
  { re: /\(\?<=/, message: 'Positive lookbehind "(?<=...)" is not supported by RE2 (GSC\'s regex engine).' },
  { re: /\(\?<!/, message: 'Negative lookbehind "(?<!...)" is not supported by RE2 (GSC\'s regex engine).' },
  { re: /\\(\d)/, message: 'Backreferences (e.g. "\\1") are not supported by RE2 (GSC\'s regex engine).' },
  { re: /\(\?P?<\w+>/, message: 'Named capture group syntax may behave differently under RE2; verify before relying on it.' }
];

const GscRegexUtil = {
  /**
   * Checks a pattern string for constructs RE2 doesn't support, so users get
   * a warning in the tester/editor before they apply a preset that will
   * silently fail (or behave unexpectedly) inside Search Console.
   * Returns an array of warning strings; empty array means no known issues.
   */
  lintForRE2(pattern) {
    const warnings = [];
    for (const { re, message } of RE2_UNSUPPORTED_PATTERNS) {
      if (re.test(pattern)) warnings.push(message);
    }
    return warnings;
  },

  /**
   * Attempts to compile the pattern as a JS RegExp for local testing.
   * This is an approximation of RE2 behavior (JS regex is a superset of
   * RE2's feature set), not a guarantee it will behave identically in GSC.
   */
  tryCompile(pattern, flags = 'i') {
    try {
      return { ok: true, regex: new RegExp(pattern, flags) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /**
   * Tests a sample query string against a pattern and returns match info
   * plus highlight spans for rendering in the tester UI.
   */
  test(pattern, sample) {
    const compiled = this.tryCompile(pattern);
    if (!compiled.ok) {
      return { matched: false, error: compiled.error, spans: [] };
    }
    const globalRegex = this.tryCompile(pattern, 'gi').regex;
    const spans = [];
    let match;
    let guard = 0;
    while ((match = globalRegex.exec(sample)) !== null && guard < 1000) {
      guard++;
      if (match[0].length === 0) {
        globalRegex.lastIndex++;
        continue;
      }
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
    return { matched: spans.length > 0, error: null, spans };
  },

  /**
   * Escapes a literal string for safe use inside a regex alternation group.
   */
  escapeLiteral(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  /**
   * True if a preset's regex contains a {{brand}}-style placeholder token
   * that must be filled in with user-supplied terms before it's usable.
   */
  hasPlaceholder(pattern) {
    return /\{\{brand\}\}/.test(pattern || '');
  },

  /**
   * Fills the {{brand}} placeholder with an alternation of the given terms,
   * each escaped so literal brand names with regex-special characters (e.g.
   * "C++", "A.B. Co") don't break the pattern. Returns null if no terms are
   * supplied, since an empty alternation group is not a meaningful pattern.
   */
  resolvePlaceholder(pattern, brandTerms) {
    const terms = (brandTerms || []).map((t) => t.trim()).filter(Boolean);
    if (!terms.length) return null;
    const alternation = terms.map((t) => this.escapeLiteral(t)).join('|');
    return pattern.replace(/\{\{brand\}\}/g, alternation);
  },

  /**
   * Renders sample text as HTML with matched spans wrapped in <mark>.
   * Caller is responsible for the sample text being plain (not already HTML).
   */
  highlight(sample, spans) {
    if (!spans.length) return gscEscapeHtml(sample);
    let out = '';
    let cursor = 0;
    for (const { start, end } of spans) {
      out += gscEscapeHtml(sample.slice(cursor, start));
      out += `<mark>${gscEscapeHtml(sample.slice(start, end))}</mark>`;
      cursor = end;
    }
    out += gscEscapeHtml(sample.slice(cursor));
    return out;
  }
};

function gscEscapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GscRegexUtil;
} else if (typeof window !== 'undefined') {
  window.GscRegexUtil = GscRegexUtil;
}
