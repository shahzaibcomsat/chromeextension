/**
 * DOM selector registry for the "Open in Search Console" semi-automated
 * flow — the live Performance report's filter UI. Confirmed via extensive
 * live DevTools capture across multiple sessions (2026-08-02). This is NOT
 * Angular Material (no mat-mdc-* classes) — it's Google's internal
 * closure-compiled component library, with hashed per-build class names
 * that are expected to change on any GSC deploy and MUST NOT be hardcoded.
 * Every selector below keys off visible text or accessible labels instead.
 *
 * One confirmed hard limit this flow works around rather than fights: the
 * "Custom (regex)" dropdown OPTION requires a browser-trusted click to
 * register a selection — no JavaScript-dispatched event (plain click,
 * keyboard activation, or coordinate-accurate pointer events were all
 * tried) can produce that. So this flow opens the dropdown for the user
 * and waits for them to click it, rather than attempting to click it
 * itself. See content/gsc-filter.js.
 */

const SC_SELECTORS = {
  performanceReportRoot: '[aria-label="Performance report"], .performance-report, main',

  // The "+ Add filter" button above the chart. A <button> whose visible
  // text is "Add filter" (the "+" is a separate icon, not part of the text node).
  addFilterButtonText: /add filter/i,

  // The dropdown menu item labelled "Query" (opens after clicking Add filter).
  filterMenuItem: '[role="menuitem"], [role="menuitemradio"], li, mat-option',
  filterMenuItemText: {
    query: /^query$/i
  },

  // The match-type dropdown trigger. Its visible text is whatever mode is
  // currently active — confirmed to vary by session ("Queries containing"
  // by default in one session, "Custom (regex)" in another, apparently
  // remembered per account).
  filterModeTriggerText: /^(queries containing|queries not containing|exact (query|match)|custom\s*\(?regex\)?)/i,
  filterModeOptionText: {
    customRegex: /custom\s*\(?regex\)?/i
  },

  // The regex text field. maxlength="4096" and its class list are NOT
  // unique to regex mode — Search Console reuses the same widget for the
  // "Keyword" field under "Queries containing" mode too. The accessible
  // label (resolved via aria-labelledby, not a native placeholder) is the
  // actual discriminator — see SCDom.getAccessibleLabel /
  // waitForFirstMatchByLabel.
  filterRegexInputCandidates: ['input[maxlength="4096"]', 'input.qdOxv-fmcmS-wGMbrd.HM1Wv'],
  filterRegexInputLabelText: /regular expression|regex/i,

  // The Apply / OK button. Best-effort text match — never captured from
  // live DOM directly, unlike the elements above.
  filterApplyButton: 'button',
  filterApplyButtonText: /^apply$/i,

  // Loading indicator shown while the report re-fetches after Apply. Not yet confirmed.
  loadingIndicator: '[role="progressbar"], .loading-indicator, mat-progress-bar'
};

if (typeof Object.freeze === 'function') {
  Object.freeze(SC_SELECTORS);
  Object.freeze(SC_SELECTORS.filterMenuItemText);
  Object.freeze(SC_SELECTORS.filterModeOptionText);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SC_SELECTORS;
}
