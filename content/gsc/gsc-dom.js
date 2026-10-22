/**
 * Generic DOM interaction primitives for the "Open in Search Console" flow.
 * Nothing here knows the specific filter-opening sequence (that's
 * content/gsc-filter.js); this module only provides reusable building
 * blocks, each shaped by a specific failure mode hit during live testing —
 * see individual comments.
 */

const SCDom = {
  /**
   * Waits for a selector to appear, using MutationObserver instead of a
   * fixed delay — Search Console's UI renders asynchronously and a
   * hardcoded setTimeout is inherently racy against render speed.
   */
  waitForElement(selector, { root = document, timeout = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      const existing = root.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for element: ${selector}`));
      }, timeout);
    });
  },

  /**
   * Finds the first element matching `selector` whose visible text matches
   * `textPattern`. More resilient than a raw CSS selector against Search
   * Console's hashed, per-build class names.
   */
  findByText(selector, textPattern, { root = document } = {}) {
    const candidates = root.querySelectorAll(selector);
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (textPattern.test(text)) return el;
    }
    return null;
  },

  waitForText(selector, textPattern, { root = document, timeout = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      const existing = this.findByText(selector, textPattern, { root });
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = this.findByText(selector, textPattern, { root });
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(root === document ? document.documentElement : root, {
        childList: true,
        subtree: true,
        characterData: true,
        // Confirmed necessary via live testing: without this, waitForText
        // timed out looking for the "Custom (regex)" dropdown option even
        // though the dropdown visibly opened — the option list appears to
        // already exist in the DOM and just get toggled visible via a
        // class/attribute change, not freshly inserted, so a childList-only
        // observer never fires for it.
        attributes: true
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for text matching ${textPattern} within ${selector}`));
      }, timeout);
    });
  },

  /**
   * Resolves an input's accessible label — aria-labelledby (following the
   * referenced id(s) to their text), then aria-label, then placeholder,
   * then an associated <label for="...">. Needed because Search Console's
   * floating-label text fields expose their label via aria-labelledby
   * pointing at a separate element, not a native `placeholder` attribute —
   * confirmed via live testing that `[placeholder*=...]` matches nothing here.
   */
  getAccessibleLabel(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => {
          const labelEl = document.getElementById(id);
          return labelEl ? (labelEl.textContent || '').trim() : '';
        })
        .join(' ')
        .trim();
      if (text) return text;
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    if (el.placeholder) return el.placeholder.trim();
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return (label.textContent || '').trim();
    }
    return '';
  },

  /**
   * Polls all elements matching any of `candidateSelectors` and returns the
   * first whose resolved accessible label matches `labelPattern`. Needed
   * because Search Console reuses the exact same text-field widget (same
   * maxlength, same classes) for multiple match-type rows — only the
   * accessible label actually differs. Matching on maxlength/class alone
   * previously found the wrong field (the "Keyword" row) while still in
   * keyword mode, and silently filled in the regex there instead.
   */
  waitForFirstMatchByLabel(candidateSelectors, labelPattern, { root = document, timeout = 8000 } = {}) {
    const tryFind = () => {
      for (const sel of candidateSelectors) {
        const candidates = root.querySelectorAll(sel);
        for (const el of candidates) {
          if (labelPattern.test(this.getAccessibleLabel(el))) return el;
        }
      }
      return null;
    };

    return new Promise((resolve, reject) => {
      const existing = tryFind();
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = tryFind();
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(root === document ? document.documentElement : root, {
        childList: true,
        subtree: true,
        attributes: true
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for an element matching label ${labelPattern} among: ${candidateSelectors.join(' | ')}`));
      }, timeout);
    });
  },

  /**
   * Sets a value on a text input the way that actually registers with
   * Search Console's framework-managed form state: writing `.value`
   * directly is intercepted/ignored by the framework's overridden setter,
   * so this walks up to the native prototype's setter instead, then fires
   * the events the framework listens for.
   */
  setNativeValue(element, value) {
    const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    // Some frameworks only finalize validation/enable-Apply state on blur,
    // not on input/change alone — cheap to dispatch, costs nothing if unused.
    element.dispatchEvent(new Event('blur', { bubbles: false }));
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  },

  click(element) {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    element.click();
  },

  /**
   * Waits for a button's disabled state to clear, via MutationObserver on
   * its disabled/aria-disabled attributes rather than a polling loop — kept
   * consistent with every other wait in this module (all MutationObserver-
   * driven, no fixed-interval polling) even though the two approaches are
   * functionally similar here; this one reacts the instant the attribute
   * changes instead of up to 150ms late.
   */
  waitUntilEnabled(button, timeout = 6000) {
    const isEnabled = () => !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    return new Promise((resolve) => {
      if (isEnabled()) return resolve(true);

      const observer = new MutationObserver(() => {
        if (isEnabled()) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(true);
        }
      });
      observer.observe(button, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(isEnabled());
      }, timeout);
    });
  },

  /**
   * Waits for a temporarily-visible loading indicator to disappear again,
   * i.e. for the filtered report re-fetch to finish. If the indicator never
   * appears within `appearTimeout`, resolves anyway (the Apply action may
   * resolve fast enough that no spinner is observed).
   */
  async waitForLoadingCycle(selector, { appearTimeout = 1500, disappearTimeout = 10000, root = document } = {}) {
    try {
      await this.waitForElement(selector, { root, timeout: appearTimeout });
    } catch {
      return { appeared: false, disappeared: true };
    }

    return new Promise((resolve, reject) => {
      const checkGone = () => !root.querySelector(selector);
      if (checkGone()) return resolve({ appeared: true, disappeared: true });

      const observer = new MutationObserver(() => {
        if (checkGone()) {
          observer.disconnect();
          clearTimeout(timer);
          resolve({ appeared: true, disappeared: true });
        }
      });
      observer.observe(root === document ? document.documentElement : root, {
        childList: true,
        subtree: true,
        attributes: true
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error('Timed out waiting for loading indicator to clear.'));
      }, disappearTimeout);
    });
  },

  /**
   * URL is the primary signal for "am I on the Performance report" —
   * Search Console's route is reliably /search-console/performance/...
   * regardless of internal markup, which exposes no confirmed landmark
   * element (relying on a DOM guess here previously caused false negatives).
   */
  isOnPerformanceReport() {
    if (/\/search-console\/performance(\/|$|\?)/.test(location.pathname)) {
      return true;
    }
    return Boolean(document.querySelector(SC_SELECTORS.performanceReportRoot));
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SCDom;
}
