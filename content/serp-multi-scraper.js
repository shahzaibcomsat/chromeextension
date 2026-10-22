/**
 * SERP Scraper - content script
 * Injected on demand via chrome.scripting.executeScript. The final
 * expression (the async IIFE call) returns a Promise; Chrome awaits
 * it and hands the resolved value back as results[0].result.
 *
 * Scrapes:
 *  1. Organic results - title, url, description, breadcrumb (Google + Bing)
 *  2. Google's "AI Overview" block, when present - the full answer text
 *     plus every inline source link (anchor text + URL)
 *
 * Three things this file is careful about, all learned the hard way:
 *
 *  a) VISIBILITY. Google keeps hidden accessibility/status text in
 *     the DOM even when it's not what's on screen - e.g. fallback
 *     strings like "AI Overview is not available for this search" or
 *     "Can't generate an AI overview right now" sit in the page
 *     alongside the real, visible answer, toggled with CSS rather
 *     than being added/removed. Reading with `.textContent` (which
 *     ignores CSS visibility) can grab the wrong, invisible string.
 *     So anything user-facing here is read with cleanVisibleText(),
 *     which mirrors `.innerText` (visibility-aware), not raw
 *     textContent. Organic titles/snippets are always visibly
 *     rendered in normal use, so plain cleanText() is fine there.
 *
 *  b) TIMING. AI Overview renders asynchronously and can still be
 *     streaming in well after page 'complete'. Organic results can
 *     also render a beat later on AI-Overview-heavy pages. So both
 *     sections retry for a few seconds before giving up, rather than
 *     taking a single snapshot at injection time.
 *
 *  c) /goto REDIRECT TOKENS (root cause of the 0-results bug).
 *     Google switched ALL organic and AI Overview links from the old
 *     readable /url?q=<real-url> format to an opaque encrypted token
 *     routed through /goto?url=<encrypted-blob>. The token cannot be
 *     decoded client-side purely in the content script (a fetch from
 *     google.com following a /goto redirect crosses origins → CORS
 *     error). Strategy:
 *       - /goto is NOT in the blocklist - it is Google's standard.
 *       - FAST PATH: breadcrumb text (the visible <cite> element that
 *         Google still renders in plain text) is used to reconstruct
 *         a clean https://<domain> URL immediately, with no waiting.
 *         This covers ~95% of organic results.
 *       - SLOW PATH (non-blocking): any /goto URLs that survived
 *         (citations, breadcrumb-less results) are flagged with
 *         gotoUrl=<original> and passed back to background.js which
 *         resolves them asynchronously AFTER the scrape returns,
 *         then patches them in storage. The scrape is never blocked
 *         waiting for network.
 *       - For AIO citations: we click expand buttons first to reveal
 *         hidden source cards, then collect + flag /goto hrefs.
 *       - True ad links (/aclk, googleadservices.com, doubleclick.net)
 *         are still filtered out.
 */
(async function () {
  const host = location.hostname;
  const urlObj = new URL(location.href);
  const query =
    urlObj.searchParams.get("q") || urlObj.searchParams.get("query") || "";
  const startParam = urlObj.searchParams.get("start");
  const firstParam = urlObj.searchParams.get("first");
  let page = 1;
  if (startParam) page = Math.floor(parseInt(startParam, 10) / 10) + 1;
  else if (firstParam) page = Math.floor((parseInt(firstParam, 10) - 1) / 10) + 1;

  // Patterns that identify true ad/tracking links to skip entirely.
  // NOTE: /goto is intentionally NOT here - Google now routes every
  // organic and AI Overview link through /goto?url=<encrypted-token>.
  // Keeping /goto in this list was the root cause of 0 results.
  const BAD_URL_PATTERNS = [
    "/aclk",
    "googleadservices.com",
    "doubleclick.net",
    "webcache.googleusercontent.com",
    "translate.google.",
    "accounts.google.",
    "support.google.",
    "policies.google.",
  ];

  // Old-style /url?q= redirect: we can decode the real URL from the
  // "q" param. /goto?url= uses an opaque encrypted token we cannot
  // decode client-side.
  function resolveGoogleRedirect(href) {
    try {
      const u = new URL(href);
      if (u.pathname === "/url") {
        const real = u.searchParams.get("q");
        if (real && /^https?:\/\//i.test(real)) return real;
      }
    } catch (e) { /* ignore */ }
    return href;
  }

  // Returns true when the href is one of Google's opaque /goto
  // encrypted redirect tokens that cannot be decoded client-side.
  function isGotoUrl(href) {
    try {
      const u = new URL(href);
      return u.pathname === "/goto";
    } catch (e) { return false; }
  }

  // Reconstruct a real URL from a Google <cite> breadcrumb element.
  // Google renders the full path in plaintext even when the href is /goto:
  //   "www.example.com › Blog › My Post Title"
  // We reassemble this into: https://www.example.com/Blog/My-Post-Title
  // This is instant (pure DOM, no network), always accurate, and gives
  // the real landing-page URL without any async resolution.
  function breadcrumbToUrl(citeText) {
    if (!citeText) return null;
    // Split on the breadcrumb separator (›, >, /, or \)
    const parts = citeText
      .split(/\s*[›>\u203a\/\\]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return null;
    const domain = parts[0];
    // Domain must look real: has a dot, no spaces
    if (!domain || domain.length < 3 || !(/\./.test(domain)) || /\s/.test(domain)) return null;
    // Rebuild the path from remaining parts (skip the last part if it
    // looks like a display title rather than a slug — but keep it
    // because Google's breadcrumb IS the actual path structure).
    const path = parts.slice(1).join("/");
    return path ? `https://${domain}/${path}` : `https://${domain}`;
  }

  function isValidUrl(href) {
    if (!href) return false;
    if (!/^https?:\/\//i.test(href)) return false;
    const lower = href.toLowerCase();
    return !BAD_URL_PATTERNS.some((p) => lower.includes(p));
  }

  function cleanText(el) {
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  }

  // Visibility-aware text read. `.innerText` (unlike `.textContent`)
  // only returns text that is actually rendered - it skips
  // display:none, visibility:hidden, and similar. That's exactly
  // what we want for anything Google might keep hidden duplicates of.
  function cleanVisibleText(el) {
    if (!el) return "";
    const t = typeof el.innerText === "string" ? el.innerText : el.textContent;
    return t.replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[aria-hidden="true"], [hidden]')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (el.offsetParent === null) {
      const rects = el.getClientRects();
      if (!rects || rects.length === 0) return false;
    }
    return true;
  }

  // Relaxed visibility for citations - AIO source panels often live
  // inside overflow-hidden containers that make offsetParent null.
  function isCitationVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[aria-hidden="true"], [hidden]')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    return true;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function longestTextBlock(container, excludeEls) {
    const exclude = new Set(excludeEls.filter(Boolean));
    let best = "";
    const candidates = container.querySelectorAll("div, span, p");
    candidates.forEach((el) => {
      if (exclude.has(el)) return;
      let containsExcluded = false;
      exclude.forEach((ex) => {
        if (ex && el.contains(ex)) containsExcluded = true;
      });
      if (containsExcluded) return;
      const t = cleanText(el);
      if (t.length > best.length && t.length < 500) best = t;
    });
    return best;
  }

  // ---------------------------------------------------------------
  // Organic results
  // ---------------------------------------------------------------
  // Broadened title selector: Google's title heading isn't always a
  // literal <h3> in every layout variant - also match elements Google
  // marks with an ARIA heading role at level 3. Wrapped in a retry
  // loop below in case organic results render in a beat after the
  // page's 'complete' event (common on AI-Overview-heavy pages).

  function scrapeOrganicOnce() {
    const found = [];
    const seenUrls = new Set();

    function pushResult(title, rawHref, description, breadcrumb) {
      if (!title || !rawHref) return;

      // Decode old-style /url?q= redirects immediately.
      let url = resolveGoogleRedirect(rawHref);

      // /goto tokens: keep as-is. Each token is unique per result so
      // deduplication by token is safe. Background.js resolves every
      // token to the real landing-page URL via chrome.tabs before
      // returning results to the popup.
      if (!isValidUrl(url) && !isGotoUrl(url)) return;
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      found.push({
        query,
        page,
        title,
        url,
        breadcrumb,
        description,
        scrapedAt: new Date().toISOString(),
      });
    }

    if (host.includes("google.")) {
      const adBlocks = document.querySelectorAll(
        "#tads, #tadsb, [data-text-ad], .uEierd"
      );
      const isInAds = (el) => Array.from(adBlocks).some((ad) => ad.contains(el));

      const titleEls = document.querySelectorAll(
        'h3, [role="heading"][aria-level="3"]'
      );
      titleEls.forEach((h3) => {
        if (isInAds(h3)) return;
        if (!isVisible(h3)) return; // skip hidden a11y duplicates
        const anchor = h3.closest("a");
        if (!anchor) return;
        const href = anchor.href;
        // Accept /goto links - they are now Google's standard link format.
        // Only hard-reject true ad-tracking patterns.
        if (!href) return;
        if (BAD_URL_PATTERNS.some((p) => href.toLowerCase().includes(p))) return;
        if (!/^https?:\/\//i.test(href)) return;

        const title = cleanText(h3);
        const container =
          anchor.closest("div.g") ||
          anchor.closest("[data-hveid]") ||
          anchor.closest("div.MjjYud") ||
          (anchor.parentElement && anchor.parentElement.parentElement
            ? anchor.parentElement.parentElement.parentElement
            : null) ||
          anchor.parentElement;
        // If we can't find a good container, still record title+url -
        // just skip the snippet/breadcrumb extraction rather than
        // dropping the whole result.
        if (!container) {
          pushResult(title, href, "", "");
          return;
        }

        const citeEl = container.querySelector("cite");
        const breadcrumb = cleanText(citeEl);

        const snippetEl = container.querySelector(
          ".VwiC3b, .MUxGbd, .lEBKkf, .s3v9rd, .lyLwlc"
        );
        const description =
          cleanText(snippetEl) || longestTextBlock(container, [h3, citeEl]);

        pushResult(title, href, description, breadcrumb);
      });
    } else if (host.includes("bing.")) {
      document.querySelectorAll("li.b_algo").forEach((li) => {
        const titleAnchor = li.querySelector("h2 a");
        if (!titleAnchor) return;
        const href = titleAnchor.href;
        if (!isValidUrl(href)) return;

        const title = cleanText(titleAnchor);
        const citeEl = li.querySelector("cite");
        const breadcrumb = cleanText(citeEl);
        const snippetEl = li.querySelector(".b_caption p, p");
        const description =
          cleanText(snippetEl) || longestTextBlock(li, [titleAnchor, citeEl]);

        pushResult(title, href, description, breadcrumb);
      });
    } else {
      document.querySelectorAll("h2 a, h3 a").forEach((anchor) => {
        const href = anchor.href;
        if (!isValidUrl(href)) return;
        const title = cleanText(anchor);
        const container = anchor.closest("li, article, div") || anchor.parentElement;
        const description = longestTextBlock(container, [anchor]);
        pushResult(title, href, description, "");
      });
    }

    return found;
  }

  let results = scrapeOrganicOnce();
  if (results.length === 0) {
    // Retry for a few seconds in case organic results are still
    // rendering in (seen on AI-Overview-heavy Google pages).
    const deadline = Date.now() + 2500;
    while (results.length === 0 && Date.now() < deadline) {
      await sleep(400);
      results = scrapeOrganicOnce();
    }
  }

  // ---------------------------------------------------------------
  // AI Overview (Google only) - answer text + inline source links
  // ---------------------------------------------------------------
  // AI OVERVIEW DETECTION - tweak here if Google changes the DOM.
  // Google doesn't expose one stable class name for this block, so
  // detectAioContainer() tries a few attribute hooks first, then
  // falls back to finding a *visible* "AI Overview" heading and
  // climbing to a container that actually holds paragraph/list
  // content. Every text read below goes through cleanVisibleText(),
  // never raw textContent - see the file header for why.

  let aiOverview = { found: false, answerText: "", citations: [] };

  // Canned Google fallback/error strings that sometimes sit hidden in
  // the DOM. If, despite the visibility filtering above, we still end
  // up with one of these as the "answer", treat it as not-found
  // rather than exporting garbage.
  const AIO_ERROR_PATTERNS = [
    /ai overview is not available/i,
    /can'?t generate an ai overview/i,
    /something went wrong.*try again/i,
  ];

  if (host.includes("google.")) {
    try {
      function detectAioContainer() {
        // Strategy 1: known/likely attribute + accessibility hooks.
        const candidates = document.querySelectorAll(
          '[data-attrid="AIOverview"], [data-attrid*="ai_overview" i], ' +
            'div[data-attrid*="AIOverview" i], [jsname="Uxxvtb"], ' +
            '[aria-label="AI Overview" i], [role="region"][aria-label*="AI Overview" i]'
        );
        for (const c of candidates) {
          if (isVisible(c)) return c;
        }

        // Strategy 2: locate a *visible* "AI Overview" heading, then
        // climb to a reasonably sized ancestor container.
        const HEADING_RE = /^ai overview$/i;
        const allEls = document.querySelectorAll(
          "h1, h2, h3, h4, div[role='heading'], span"
        );
        let headingEl = null;
        for (const el of allEls) {
          if (!isVisible(el)) continue; // skip hidden a11y duplicates
          const t = cleanText(el);
          if (HEADING_RE.test(t)) {
            headingEl = el;
            break;
          }
        }
        if (!headingEl) return null;

        let candidate = headingEl.parentElement;
        let steps = 0;
        while (candidate && steps < 8) {
          const text = cleanVisibleText(candidate);
          const hasList = candidate.querySelector("ul, ol, li");
          if (text.length > 150 && (hasList || text.length > 300)) {
            return candidate;
          }
          candidate = candidate.parentElement;
          steps++;
        }
        return headingEl.parentElement
          ? headingEl.parentElement.parentElement || headingEl.parentElement
          : null;
      }

      // Fast pre-check: is there any hint an AI Overview exists or is
      // still loading? Uses innerText (visibility-aware) so a hidden
      // "AI Overview" label elsewhere doesn't trigger a false wait.
      function hasAioHint() {
        if (detectAioContainer()) return true;
        const bodyText = document.body ? document.body.innerText : "";
        return /ai overview/i.test(bodyText.slice(0, 20000));
      }

      async function waitForAiOverviewReady() {
        if (!hasAioHint()) return null;

        let container = detectAioContainer();
        const appearDeadline = Date.now() + 3000;
        while (!container && Date.now() < appearDeadline) {
          await sleep(250);
          container = detectAioContainer();
        }
        if (!container) return null;

        // Let streaming text settle: keep checking until the visible
        // text length stops changing between two consecutive polls.
        let prevLen = cleanVisibleText(container).length;
        for (let i = 0; i < 5; i++) {
          await sleep(300);
          const fresh = detectAioContainer() || container;
          container = fresh;
          const curLen = cleanVisibleText(container).length;
          if (curLen === prevLen) break;
          prevLen = curLen;
        }
        return container;
      }

      const container = await waitForAiOverviewReady();

      if (container) {
        // Some of Google's inline citation chips (the small pill-style
        // "Brand Name +1" mentions inside the answer text, and any
        // source-card strip alongside it) don't always carry a plain
        // href - Google sometimes routes the real destination through
        // data-url/ping attributes or client-side JS instead. So we
        // look past href for those too, and we also widen the search
        // beyond the paragraph-only `container` to catch a sibling
        // source-card strip that may sit just outside it.

        function extractLinkUrl(el) {
          // Primary: the href. /goto links are now accepted because
          // Google routes all organic+AIO links through them.
          if (el.tagName === "A" && el.href) {
            const href = el.href;
            if (isValidUrl(href) || isGotoUrl(href)) {
              // Try to resolve /url?q= old-style redirects.
              const resolved = resolveGoogleRedirect(href);
              if (isValidUrl(resolved)) return resolved;
              // /goto opaque token: keep as-is, flagged for later resolution.
              if (isGotoUrl(resolved)) return resolved;
            }
          }
          const dataUrl = el.getAttribute("data-url");
          if (dataUrl && isValidUrl(dataUrl)) return dataUrl;
          // "ping" attributes sometimes carry the real destination as
          // a "url=" query param; still try for old-style pings.
          const ping = el.getAttribute("ping");
          if (ping) {
            try {
              const pingUrl = new URL(ping, location.href);
              const embedded = pingUrl.searchParams.get("url");
              if (embedded && isValidUrl(embedded)) return embedded;
            } catch (e) {
              /* ignore malformed ping */
            }
          }
          return null;
        }

        function collectCitations(scope, out, seenUrls) {
          const candidates = scope.querySelectorAll(
            'a[href], a[data-url], a[ping], [role="link"][data-url], ' +
              '[role="link"][href]'
          );
          candidates.forEach((el) => {
            if (!isCitationVisible(el)) return;
            const url = extractLinkUrl(el);
            // Accept /goto links - they are flagged for background resolution.
            if (!url || (!isValidUrl(url) && !isGotoUrl(url))) return;
            if (seenUrls.has(url)) return;
            const anchorText =
              cleanVisibleText(el) ||
              el.getAttribute("aria-label") ||
              el.getAttribute("title") ||
              "";
            if (!anchorText) return;
            seenUrls.add(url);
            // Flag /goto citations so the background can resolve them later.
            out.push({ anchor: anchorText, url, ...(isGotoUrl(url) ? { gotoUrl: url } : {}) });
          });
        }

        // --- Expand hidden AIO citation panels before collecting ---
        // Google's AIO often shows only a few source chips inline and
        // hides the rest behind a collapsed panel or a "Show more" button.
        // Click every collapsed/expand button inside the AIO block,
        // wait for the DOM to settle, then re-detect the container in
        // case Google re-renders it after expansion.
        async function expandAioCitations(scope) {
          const expandables = scope.querySelectorAll(
            'button[aria-expanded="false"], [role="button"][aria-expanded="false"]'
          );
          let clicked = 0;
          for (const btn of expandables) {
            if (!isCitationVisible(btn)) continue;
            const label = (
              (btn.textContent || "") +
              " " +
              (btn.getAttribute("aria-label") || "")
            ).toLowerCase();
            // Click buttons that look like they reveal more sources.
            if (
              /show|more|source|all|expand|cite|view/i.test(label) ||
              expandables.length <= 4
            ) {
              try { btn.click(); clicked++; } catch (e) { /* ignore */ }
            }
          }

          // Also look for a tab/drawer toggle that opens the full sources
          // panel (common layout: answer tab + sources tab).
          let parent = scope.parentElement;
          for (let s = 0; s < 4 && parent; s++, parent = parent.parentElement) {
            const tabs = parent.querySelectorAll(
              '[role="tab"], [role="button"][aria-selected="false"]'
            );
            for (const tab of tabs) {
              if (!isCitationVisible(tab)) continue;
              const lbl = (
                (tab.textContent || "") + " " + (tab.getAttribute("aria-label") || "")
              ).toLowerCase();
              if (/source|cite|ref|link/i.test(lbl)) {
                try { tab.click(); clicked++; } catch (e) { /* ignore */ }
              }
            }
            if (clicked > 0) break;
          }

          if (clicked > 0) {
            await sleep(700); // wait for expansion animation + async renders
          }
        }

        // Expand first, then collect.
        await expandAioCitations(container);
        // Re-detect container in case Google swapped the DOM after expansion.
        const expandedContainer = detectAioContainer() || container;

        const citationLinks = [];
        const seenCitationUrls = new Set();
        collectCitations(expandedContainer, citationLinks, seenCitationUrls);

        // If the paragraph container itself yielded no citations, try
        // a wider wrapper - Google sometimes renders the source-card
        // strip as a sibling of the answer text rather than a child
        // of it. Climb a few more ancestor levels, but bail out if a
        // candidate looks like it now includes the organic results
        // list (a real false-positive risk), so we never scoop up
        // unrelated organic links as "AI Overview citations".
        if (citationLinks.length === 0) {
          let wider = expandedContainer.parentElement;
          let steps = 0;
          while (wider && steps < 5) {
            const organicHeadingCount = wider.querySelectorAll(
              'h3, [role="heading"][aria-level="3"]'
            ).length;
            if (organicHeadingCount > 2) break; // looks like organic results now
            collectCitations(wider, citationLinks, seenCitationUrls);
            if (citationLinks.length > 0) break;
            wider = wider.parentElement;
            steps++;
          }
        }

        let answerText = cleanVisibleText(container);
        [/^AI Overview/i, /Show more/i, /Show less/i, /Learn more/i].forEach(
          (re) => {
            answerText = answerText.replace(re, "").trim();
          }
        );
        answerText = answerText.replace(/\s{2,}/g, " ").trim();

        const looksLikeError = AIO_ERROR_PATTERNS.some((re) => re.test(answerText));

        if (!looksLikeError && answerText.length > 40) {
          aiOverview = { found: true, answerText, citations: citationLinks };
        }
      }
    } catch (e) {
      aiOverview = { found: false, answerText: "", citations: [] };
    }
  }

  return {
    engine: host,
    query,
    page,
    count: results.length,
    results,
    aiOverview,
  };
})();
