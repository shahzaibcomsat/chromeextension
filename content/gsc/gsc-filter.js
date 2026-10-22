/**
 * "Apply in GSC" flow: drives the live Performance report's filter UI
 * end-to-end with zero manual clicks.
 *
 * Confirmed via extensive live testing (three separate simulation
 * strategies — plain click, keyboard activation, coordinate-accurate
 * pointer events — all tried and all failed): Search Console's "Custom
 * (regex)" dropdown OPTION requires a browser-trusted click to register a
 * selection. isTrusted is a read-only flag the browser sets, not something
 * any JavaScript-dispatched event can fake.
 *
 * So this flow automates everything — opening the filter panel, selecting
 * "Query," opening the match-type dropdown — then asks the background
 * service worker to dispatch a genuinely trusted mouse click at the
 * option's coordinates via the debugger protocol (Input.dispatchMouseEvent,
 * confirmed live to register as trusted on this exact dropdown). The
 * debugger attaches for ~1 second and detaches immediately. If the trusted
 * click fails (e.g. DevTools is open on the tab, which blocks debugger
 * attach), it falls back to the old handoff: a toast asking the user to
 * click "Custom (regex)" once, with everything after that still automatic.
 */

class ApplyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const APPLY_ERROR_CODES = {
  NOT_ON_PERFORMANCE_REPORT: 'NOT_ON_PERFORMANCE_REPORT',
  OFFLINE: 'OFFLINE',
  ADD_FILTER_BUTTON_NOT_FOUND: 'ADD_FILTER_BUTTON_NOT_FOUND',
  QUERY_MENU_ITEM_NOT_FOUND: 'QUERY_MENU_ITEM_NOT_FOUND',
  MODE_DROPDOWN_NOT_FOUND: 'MODE_DROPDOWN_NOT_FOUND',
  REGEX_OPTION_NOT_FOUND: 'REGEX_OPTION_NOT_FOUND',
  USER_DID_NOT_SELECT_REGEX_MODE: 'USER_DID_NOT_SELECT_REGEX_MODE',
  APPLY_BUTTON_NOT_FOUND: 'APPLY_BUTTON_NOT_FOUND',
  APPLY_BUTTON_DISABLED: 'APPLY_BUTTON_DISABLED'
};

const SCGscFilter = {
  ERROR_CODES: APPLY_ERROR_CODES,

  async openAndFill(regexPattern) {
    if (!navigator.onLine) {
      throw new ApplyError(APPLY_ERROR_CODES.OFFLINE, 'You appear to be offline.');
    }
    if (!SCDom.isOnPerformanceReport()) {
      throw new ApplyError(APPLY_ERROR_CODES.NOT_ON_PERFORMANCE_REPORT, 'Open Performance → Search Results → Queries first.');
    }

    Toast.info('Opening the Query filter…', { duration: 2500 });

    const addFilterBtn = await this._step(
      () => SCDom.waitForText('button', SC_SELECTORS.addFilterButtonText, { timeout: 5000 }),
      APPLY_ERROR_CODES.ADD_FILTER_BUTTON_NOT_FOUND,
      'Could not find the "Add filter" button. Search Console may have updated its interface.'
    );
    SCDom.click(addFilterBtn);

    const queryMenuItem = await this._step(
      () => SCDom.waitForText(SC_SELECTORS.filterMenuItem, SC_SELECTORS.filterMenuItemText.query, { timeout: 4000 }),
      APPLY_ERROR_CODES.QUERY_MENU_ITEM_NOT_FOUND,
      'Could not find the "Query" filter option. Search Console may have updated its interface.'
    );
    SCDom.click(queryMenuItem);

    const regexInput = await this._getRegexInputWithHandoff();
    SCDom.setNativeValue(regexInput, regexPattern);
    this._ensureModeRowSelected(regexInput);

    const applyButton = await this._step(
      () => SCDom.waitForText(SC_SELECTORS.filterApplyButton, SC_SELECTORS.filterApplyButtonText, { timeout: 4000 }),
      APPLY_ERROR_CODES.APPLY_BUTTON_NOT_FOUND,
      'Could not find the Apply button. Search Console may have updated its interface.'
    );

    if (!(await SCDom.waitUntilEnabled(applyButton, 4000))) {
      throw new ApplyError(
        APPLY_ERROR_CODES.APPLY_BUTTON_DISABLED,
        'The Apply button stayed disabled after filling in the regex. Try clicking Apply in Search Console manually.'
      );
    }
    SCDom.click(applyButton);

    // The click is the real action, so the caller (content.js) shows the
    // success toast right away rather than waiting on this. This wait is
    // best-effort report-refresh confirmation only, kept as a promise the
    // caller can await separately — used to keep two Apply flows from ever
    // running concurrently (see content.js's queue), not to delay feedback.
    // Not a pass/fail gate: the loading-indicator selector was never
    // confirmed against live DOM (see utils/selectors.js comments), so
    // failing to observe it must not surface as an error.
    const settled = SCDom.waitForLoadingCycle(SC_SELECTORS.loadingIndicator, { appearTimeout: 1500, disappearTimeout: 10000 }).catch(() => {});

    return { success: true, settled };
  },

  /**
   * Returns the regex input element. If Custom (regex) is already the
   * active mode, it's there immediately. Otherwise opens the match-type
   * dropdown and selects "Custom (regex)" via a trusted click dispatched
   * through the background's debugger helper — falling back to a manual
   * user click only if the trusted click can't be delivered.
   */
  async _getRegexInputWithHandoff() {
    try {
      return await SCDom.waitForFirstMatchByLabel(SC_SELECTORS.filterRegexInputCandidates, SC_SELECTORS.filterRegexInputLabelText, { timeout: 1500 });
    } catch {
      // Not already in regex mode — fall through to opening the dropdown.
    }

    const trigger = await this._step(
      () => SCDom.waitForText(
        'button, [role="button"], div[jsaction*="click" i], span[jsaction*="click" i]',
        SC_SELECTORS.filterModeTriggerText,
        { timeout: 4000 }
      ),
      APPLY_ERROR_CODES.MODE_DROPDOWN_NOT_FOUND,
      'Could not find the match-type dropdown. Search Console may have updated its interface.'
    );
    SCDom.click(trigger);

    // Try the fully-automatic path first: trusted click on the option.
    const autoClicked = await this._trustedSelectCustomRegex();
    if (autoClicked) {
      try {
        return await SCDom.waitForFirstMatchByLabel(SC_SELECTORS.filterRegexInputCandidates, SC_SELECTORS.filterRegexInputLabelText, { timeout: 4000 });
      } catch {
        // The click dispatched but the input still didn't appear — fall
        // through to the manual handoff below rather than failing outright.
      }
    }

    // Fallback: ask the user to click once (only reached when the trusted
    // click couldn't be delivered, e.g. DevTools open on the tab).
    const handoffToast = Toast.info('Click "Custom (regex)" in the dropdown below to continue — the rest fills in automatically.', { duration: 60000 });

    try {
      const input = await SCDom.waitForFirstMatchByLabel(SC_SELECTORS.filterRegexInputCandidates, SC_SELECTORS.filterRegexInputLabelText, { timeout: 60000 });
      Toast.dismiss(handoffToast);
      return input;
    } catch {
      Toast.dismiss(handoffToast);
      throw new ApplyError(
        APPLY_ERROR_CODES.USER_DID_NOT_SELECT_REGEX_MODE,
        'Didn\'t see "Custom (regex)" get selected within 60 seconds. Click "Apply in GSC" again to retry.'
      );
    }
  },

  /**
   * Finds the visible "Custom (regex)" dropdown option and asks the
   * background to dispatch a trusted mouse click at its center. Returns
   * true when a click was dispatched (up to 2 attempts), false when the
   * trusted click couldn't be delivered at all.
   *
   * The option must be located precisely: a naive text search matches
   * dozens of ancestor containers (the whole page's textContent contains
   * "Custom (regex)" once the dropdown opens), so we prefer the real
   * option element ([role="option"], smallest visible match) and fall back
   * to the smallest visible leaf element with matching text.
   */
  async _trustedSelectCustomRegex() {
    // Wait up to 4s for the dropdown to render its options.
    const deadline = Date.now() + 4000;
    let option = null;
    while (Date.now() < deadline) {
      option = this._findCustomRegexOption();
      if (option) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!option) return false;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        option = this._findCustomRegexOption();
        if (!option) return false;
      }
      // Scroll it into view first so the coordinates are accurate.
      try { option.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, 250));
      const rect = option.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) continue;

      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      let result = null;
      try {
        result = await chrome.runtime.sendMessage({ type: 'SCQT_TRUSTED_CLICK', x, y });
      } catch {
        result = null;
      }
      if (result && result.ok) return true;

      // Debugger attach failed (e.g. DevTools open) — no point retrying.
      return false;
    }
    return false;
  },

  /**
   * Locates the clickable "Custom (regex)" option element. Prefers
   * [role="option"] (the real option widget), smallest visible match first;
   * falls back to the smallest visible leaf element whose text matches.
   */
  _findCustomRegexOption() {
    const pattern = SC_SELECTORS.filterModeOptionText.customRegex;
    const matches = (el) => pattern.test((el.textContent || '').trim());
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.width < 500 && r.height < 200;
    };
    const byArea = (a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (ra.width * ra.height) - (rb.width * rb.height);
    };

    const options = Array.from(document.querySelectorAll('[role="option"]'))
      .filter((el) => isVisible(el) && matches(el))
      .sort(byArea);
    if (options.length) return options[0];

    const leaves = Array.from(document.querySelectorAll('div, span, li'))
      .filter((el) => {
        if (!isVisible(el) || !matches(el)) return false;
        // Leaf: no child element also matches (excludes big containers).
        return !Array.from(el.children).some((c) => matches(c));
      })
      .sort(byArea);
    return leaves[0] || null;
  },

  /**
   * Apply stays disabled until the match-type ROW's own radio is checked —
   * a separate thing from the "Custom (regex)" dropdown value inside that
   * row. If it isn't already checked, select it — scoped to the filter
   * panel (found by walking up from the regex input to an ancestor whose
   * text includes "Branded queries", a stable landmark in that panel) so
   * this never touches unrelated radios elsewhere on the page.
   */
  _ensureModeRowSelected(regexInput) {
    let panel = regexInput;
    for (let i = 0; i < 8 && panel; i++) {
      panel = panel.parentElement;
      if (panel && /branded queries/i.test(panel.textContent || '')) break;
    }
    if (!panel) return;

    const radios = Array.from(panel.querySelectorAll('input[type="radio"]'));
    if (radios.length && !radios.some((r) => r.checked)) {
      SCDom.click(radios[0]);
      radios[0].checked = true;
      radios[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
  },

  async _step(fn, code, message) {
    try {
      return await fn();
    } catch {
      throw new ApplyError(code, message);
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SCGscFilter, ApplyError, APPLY_ERROR_CODES };
}
