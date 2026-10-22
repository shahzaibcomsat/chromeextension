/**
 * Message bridge between the popup and the live Search Console page for the
 * "Apply in GSC" flow. Acknowledges receipt synchronously and then runs the
 * flow in the background, reporting all further status via on-page toasts
 * rather than the message response — the popup shouldn't need to stay open
 * or wait for this to finish. On success, also broadcasts a separate
 * message so the popup (if it's still open) can auto-close itself.
 *
 * Also boots the privacy blur (SCBlur) for screen recordings.
 *
 * Deliberately a single attempt, no retry: an earlier version retried the
 * whole flow once on failure, which re-ran "Add filter" → "Query" → etc.
 * from scratch on every retryable error (including the Apply-button-
 * disabled case) — in practice this doubled the wait time and produced two
 * full sets of toasts for a single click, with no real chance of the retry
 * succeeding where the first attempt didn't (the underlying condition
 * hadn't changed). One clear error beats two confusing ones.
 *
 * Requests are serialized on a queue, never run concurrently: Search
 * Console re-renders the filter bar's DOM after a filter is applied (that
 * re-render, plus the confirmation wait in gsc-filter.js, is what makes the
 * success toast land several seconds after the click). If a second "Apply
 * in GSC" request arrived while the first was still settling, both flows
 * used to touch the same filter-panel DOM at once — the second one could
 * end up filling in / clicking a node Search Console was about to discard
 * as part of the first change's re-render, so it silently did nothing while
 * the first (older) filter kept showing. Chaining each request onto a
 * single queue guarantees a new flow only starts once the previous one has
 * fully finished, so it always acts on settled DOM.
 */

(function () {
  let queue = Promise.resolve();
  let inFlight = false;

  function runApply(regex) {
    return SCGscFilter.openAndFill(regex)
      .then(async ({ settled }) => {
        // Fires the instant Apply is clicked — the click is the real
        // action, so the user shouldn't wait several seconds for Search
        // Console's own report refresh just to see confirmation.
        Toast.success('Filter applied in Search Console.', { root: document.body, duration: 4000 });
        chrome.runtime.sendMessage({ type: 'SCQT_GSC_FILTER_SUCCESS' }).catch(() => {
          // No listener — the popup was already closed (e.g. by the user,
          // or by losing focus at some point during the flow). Fine either way.
        });
        // Still awaited here (after the toast, not before) so the queue
        // below only advances to the next request once Search Console's
        // filter-bar re-render has actually settled — this is what stops a
        // second Apply from racing the first's DOM changes.
        await settled;
      })
      .catch((err) => {
        const friendly = err instanceof ApplyError ? err.message : 'Unexpected error applying the filter.';
        Toast.error(friendly, { root: document.body, duration: 6000 });
      });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'SCQT_OPEN_GSC_FILTER') {
      sendResponse({ ok: true, started: true });

      if (inFlight) {
        Toast.info('Finishing the current filter first — this one will run right after.', { root: document.body, duration: 3000 });
      }

      queue = queue.then(() => {
        inFlight = true;
        return runApply(message.regex).finally(() => {
          inFlight = false;
        });
      });

      return false; // response already sent synchronously
    }

    return false;
  });

  // Privacy blur for screen recordings (URLs, optionally queries).
  try {
    if (typeof SCBlur !== 'undefined') SCBlur.init();
  } catch { /* blur is best-effort; never break the filter flow */ }
})();
