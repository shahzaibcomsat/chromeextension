/* SERP Scraper - content script
 *
 * Rules this file obeys:
 *   1. Only Google's own SERP widgets are captured. Anything injected by another
 *      extension (Keywords Everywhere, Ubersuggest, MozBar, SEOquake, ...) is
 *      excluded by container, by element name and by URL.
 *   2. A widget is reported only when its real container exists on the page.
 *      No container means no rows for that widget.
 *   3. The page is settled (lazy blocks rendered) before anything is read.
 *   4. A result whose href is one of Google's encrypted redirects still gets a
 *      real URL, recovered from the page's own data. See recoverUrl().
 */
/** ShahzaibSEO SERP Scraper engine (from SERP Scraper by Malaika Aman)
 *  Exposes window.RSSerpScrape() → Promise<Array<{type,position,title,url}>>
 */
async function RSSerpScrape(options) {
  "use strict";
  options = options || {};
  const skipSettle = !!options.skipSettle;

  /* ---------------------------------------------------------------- utils */

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function txt(el) {
    return el ? el.textContent.trim().replace(/\s+/g, " ") : "";
  }

  function yOf(el) {
    try {
      const r = el.getBoundingClientRect();
      return r.top + window.scrollY;
    } catch (e) { return 999999; }
  }

  /* ------------------------------------------------- wait for lazy content
   * Google renders carousels, PAA and the AI Overview lazily. Reading the DOM
   * the instant the popup opens is what made results appear and disappear at
   * random. Walk the page once to force rendering, wait for mutations to stop,
   * then put the scroll position back where the user had it.
   * The maximum scroll depth is measured once so continuous-scroll pages are
   * not pushed into loading page two.
   */
  const SETTLE_BUDGET_MS = 3500;

  async function settle() {
    // A hidden tab renders nothing and has its timers throttled to about a
    // second, so walking it would stall for no benefit.
    if (document.hidden) { await quiet(200, 600); return; }

    const deadline = Date.now() + SETTLE_BUDGET_MS;
    const startY = window.scrollY;
    const maxY = Math.min(document.documentElement.scrollHeight, 40000);
    const step = Math.max(600, Math.floor(window.innerHeight * 0.85));

    for (let y = 0; y < maxY && Date.now() < deadline; y += step) {
      window.scrollTo(0, y);
      await sleep(40);
    }
    window.scrollTo(0, Math.max(0, maxY - window.innerHeight));
    await quiet(300, Math.max(300, deadline - Date.now()));
    window.scrollTo(0, startY);
    await sleep(80);
  }

  // Resolve once the DOM has been silent for `idle` ms, or after `cap` ms.
  function quiet(idle, cap) {
    return new Promise(resolve => {
      let timer = null;
      const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(done, idle);
      });
      const done = () => {
        clearTimeout(timer);
        clearTimeout(hard);
        obs.disconnect();
        resolve();
      };
      const hard = setTimeout(done, cap);
      timer = setTimeout(done, idle);
      try {
        obs.observe(document.body, { childList: true, subtree: true });
      } catch (e) { done(); }
    });
  }

  /* --------------------------------------------- third party widget filter
   * Other SERP tools inject nodes into the results column. They are recognised
   * by container id/class, by custom element names carrying their own branding,
   * and by the domains their links point at. Google's own custom elements
   * (g-scrolling-carousel, srpx-bugfix, ...) must never be caught here, which
   * is why the tag test matches vendor names instead of "any custom element".
   */
  const INJECTED_SELECTOR = [
    '[id*="keywords-everywhere" i]', '[class*="keywords-everywhere" i]',
    '[id*="keywordseverywhere" i]', '[class*="keywordseverywhere" i]',
    '[class*="kwe-" i]', '[id*="kwe-" i]', '[id*="kwfinder" i]',
    '[id*="ubersuggest" i]', '[class*="ubersuggest" i]',
    '[id*="neilpatel" i]', '[class*="neilpatel" i]',
    '[id*="mozbar" i]', '[class*="mozbar" i]',
    '[id*="seoquake" i]', '[class*="seoquake" i]',
    '[id*="seo-minion" i]', '[class*="seo-minion" i]', '[id*="seominion" i]',
    '[id*="ahrefs" i]', '[class*="ahrefs" i]',
    '[id*="semrush" i]', '[class*="semrush" i]',
    '[id*="similarweb" i]', '[class*="similarweb" i]',
    '[id*="serpstat" i]', '[class*="serpstat" i]',
    '[id*="spyfu" i]', '[class*="spyfu" i]',
    '[id*="surferseo" i]', '[class*="surferseo" i]',
    '[class*="seo-extension" i]', '[data-extension-id]', '[data-injected-by]',
    /* ShahzaibSEO own UI — never treat as Google results */
    '#rankseo-sidebar', '#rs-sidebar', '[id^="rs-"]', '[class^="rs-"]',
    '.rankseo-toolbar', '[class*="rankseo" i]', '[id*="rankseo" i]',
    '.rs-serp-row', '.rs-ahrefs-row', '.rs-serp-badge', '.rs-kws-pill'
  ].join(",");

  const VENDOR_TAG = /(keywordseverywhere|keywords-everywhere|^kwe-|kwfinder|ubersuggest|neilpatel|mozbar|seoquake|seo-minion|seominion|ahrefs|semrush|similarweb|serpstat|spyfu|surferseo|sistrix|rankseo|^rs-)/i;

  const BLOCKED_DOMAINS = [
    "keywordseverywhere.com", "ahrefs.com", "semrush.com", "moz.com",
    "kwfinder.com", "mangools.com", "serpstat.com", "spyfu.com",
    "similarweb.com", "neilpatel.com", "ubersuggest.com", "surferseo.com",
    "seoquake.com", "sistrix.com", "ranxplorer.com"
  ];

  // Google infrastructure links that are never a search result.
  const INFRA_HOSTS = [
    "accounts.google.com", "policies.google.com", "support.google.com",
    "myactivity.google.com", "adssettings.google.com", "translate.google.com"
  ];

  /* The AI Overview sits outside #center_col, so the scan root has to be the
   * whole result container, not the organic column. */
  const ROOT =
    document.querySelector("#rcnt") ||
    document.querySelector("#main") ||
    document.body;

  // Every element Google renders on a SERP carries one of these attributes.
  const GOOGLE_MARKER = "[data-ved],[data-hveid],[jsname],[jscontroller],[data-attrid],[data-async-context]";
  const NATIVE_CONTAINERS = "#rso,#tads,#tadsb,#bottomads,#botstuff,#rhs,#taw,#center_col,#search";

  function isInjected(el) {
    if (!el) return true;
    if (!ROOT.contains(el)) return true;
    if (el.closest(INJECTED_SELECTOR)) return true;
    for (let n = el; n && n !== ROOT; n = n.parentElement) {
      const tag = n.tagName ? n.tagName.toLowerCase() : "";
      if (tag.indexOf("-") !== -1 && VENDOR_TAG.test(tag)) return true;
    }
    return false;
  }

  // Rendered by Google itself rather than pasted in by another extension.
  function isGoogleNode(el) {
    if (!el) return false;
    return !!(el.closest(GOOGLE_MARKER) || el.closest(NATIVE_CONTAINERS));
  }

  /* ------------------------------------------------------------------ urls */

  function unwrap(raw) {
    if (!raw) return "";
    try {
      const u = new URL(raw, location.origin);
      const host = u.hostname.replace(/^www\./, "");
      if (host === "google.com" || host.endsWith(".google.com") || /\.google\.[a-z.]+$/.test(host)) {
        const real = u.searchParams.get("adurl") || u.searchParams.get("url") || u.searchParams.get("q");
        if (real && /^https?:/i.test(real)) return real;
      }
      return raw;
    } catch (e) { return raw; }
  }

  function clean(raw) {
    return unwrap(raw).split("#")[0];
  }

  function domain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }

  function hostMatches(host, list) {
    return list.some(d => host === d || host.endsWith("." + d));
  }

  function isUsableUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    const host = domain(url);
    if (!host) return false;
    if (hostMatches(host, BLOCKED_DOMAINS)) return false;
    if (INFRA_HOSTS.includes(host)) return false;
    if (/^google\.[a-z.]+$/.test(host)) {
      // Keep Google Maps place links (local pack), drop every other Google page.
      return url.indexOf("/maps/") !== -1;
    }
    // Google's own redirect wrappers carry no readable destination.
    if (/google\./.test(host) && /\/goto\?|\/aclk\?|\/url\?|\/imgres\?|\/shopping\/product/.test(url)) return false;
    return true;
  }

  // A Google redirect wrapper marks a genuine result whose target is hidden.
  function isRedirectWrapper(raw) {
    try {
      const u = new URL(raw, location.origin);
      return /google\./.test(u.hostname) && /^\/(goto|url|aclk|imgres)$/.test(u.pathname);
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------- url recovery
   * Google now serves result links as /goto?url=<encrypted blob>. The blob
   * cannot be decoded, but the page still carries the real URLs in two places:
   * the inline data Google ships with the response, and the visible display
   * URL under each result. Both are used, exact matches first.
   */
  let SCRIPTS = null;

  function scriptText() {
    if (SCRIPTS === null) {
      SCRIPTS = Array.from(document.querySelectorAll("script"))
        .map(s => s.textContent || "").join("\n");
    }
    return SCRIPTS;
  }

  // URLs inside Google's inline data are JSON-escaped.
  function decodeJsonUrl(s) {
    return s.replace(/\\u003d/gi, "=")
            .replace(/\\u0026/gi, "&")
            .replace(/\\u003f/gi, "?")
            .replace(/\\\//g, "/")
            .replace(/\\"/g, '"');
  }

  // The encrypted token out of a /goto?url=<token> link.
  function blobOf(a) {
    const href = a ? (a.getAttribute("href") || "") : "";
    const i = href.indexOf("url=");
    if (i === -1) return "";
    return href.slice(i + 4).split("&")[0];
  }

  /* The same token appears in the inline data a few fields ahead of the real
   * destination, so the token is the key that unlocks it. This is what gets
   * YouTube, TikTok, Instagram and Facebook video URLs back. */
  /* The picture behind an image pack thumbnail: the imgurl parameter when the
   * link is an /imgres redirect, else the image file listed beside the page
   * URL in Google's inline data, else the thumbnail's own src. */
  function imageForThumb(rawUrl, pageUrl, el) {
    try {
      const p = new URL(rawUrl, location.origin).searchParams.get("imgurl");
      if (p && /^https?:\/\//i.test(p)) return p;
    } catch (e) {}
    if (pageUrl) {
      const all = scriptText();
      const needle = pageUrl.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");
      let from = 0, idx;
      while (needle.length > 8 && (idx = all.indexOf(needle, from)) !== -1) {
        const win = all.slice(Math.max(0, idx - 700), idx + 700);
        const re = /"(https?:(?:\\?\/){2}[^"\s]{6,400})"/g;
        let m;
        while ((m = re.exec(win))) {
          const u = decodeJsonUrl(m[1]);
          if (!isNoiseUrl(u) && isImageFileUrl(u)) return u;
        }
        from = idx + needle.length;
      }
    }
    const img = el && el.querySelector ? el.querySelector("img") : null;
    const src = img ? (img.getAttribute("src") || img.getAttribute("data-src") || "") : "";
    return /^https?:\/\//i.test(src) ? src : "";
  }

  function isImageFileUrl(u) {
    return /\.(jpg|jpeg|png|webp|gif|svg|avif|bmp)(\?|$)/i.test(u) || /(^|\.)ytimg\.com$/.test(domain(u));
  }

  function urlForBlob(blob, preferImage) {
    if (!blob || blob.length < 40) return "";
    const all = scriptText();
    let image = "", page = "";
    let from = 0, idx;
    while ((idx = all.indexOf(blob, from)) !== -1) {
      const window = all.slice(idx, idx + 900);
      const re = /"(https?:(?:\\?\/){2}[^"\s]{6,400})"/g;
      let m;
      while ((m = re.exec(window))) {
        const u = decodeJsonUrl(m[1]);
        if (isNoiseUrl(u) || !isUsableUrl(u)) continue;
        if (isImageFileUrl(u)) { if (!image) image = u; }
        else if (!page) page = u;
        if (image && page) break;
      }
      if (image && page) break;
      from = idx + blob.length;
    }
    // An image result lists the picture, then the page carrying it. Image
    // pack rows want the picture; every other kind of result wants the page.
    if (preferImage) return image || page;
    return page || image;
  }

  let INDEX = null;

  function sourceIndex() {
    if (INDEX) return INDEX;
    const pairs = [];
    const urls = [];
    const t = scriptText();

    const pairRe = /\["(https?:(?:\\?\/){2}[^"\s]{6,400})","([^"\\]{3,300})"/g;
    let m;
    while ((m = pairRe.exec(t))) {
      const u = decodeJsonUrl(m[1]);
      if (isNoiseUrl(u)) continue;
      pairs.push({ url: u, title: m[2] });
    }

    const urlRe = /"(https?:(?:\\?\/){2}[^"\s]{6,400})"/g;
    while ((m = urlRe.exec(t))) {
      const u = decodeJsonUrl(m[1]);
      if (isNoiseUrl(u)) continue;
      if (urls.indexOf(u) === -1) urls.push(u);
    }

    INDEX = { pairs, urls };
    return INDEX;
  }

  function isNoiseUrl(u) {
    return /^https?:\/\/(www\.)?(google|gstatic|encrypted-tbn|googleusercontent|googleadservices|schema\.org|w3\.org|ogads-pa)/.test(u) ||
           /gstatic\.com|googleusercontent\.com|googleadservices\.com/.test(u);
  }

  // "https://www.healthline.com › nutrition › whiten-teeth-n..."
  function citeParts(block) {
    const cite = block ? block.querySelector("cite") : null;
    if (!cite) return null;
    const s = txt(cite);
    if (!/^https?:\/\//i.test(s)) return null;

    const segs = s.split(/\s*›\s*/).map(x => x.trim()).filter(Boolean);
    const origin = segs[0].replace(/\/+$/, "");
    const path = [];
    let truncated = false;
    for (let i = 1; i < segs.length; i++) {
      if (/\.\.\.|…/.test(segs[i])) { truncated = true; break; }
      path.push(segs[i]);
    }
    return { origin, path, truncated };
  }

  function recoverUrl(title, el, preferImage) {
    // 1. The link's own token, looked up in Google's inline data. Exact.
    const anchor = el && el.tagName === "A"
      ? el
      : (el && (el.closest('a[href*="/goto?"]') || el.querySelector('a[href*="/goto?"]')));
    if (anchor) {
      const byBlob = urlForBlob(blobOf(anchor), preferImage);
      if (isUsableUrl(byBlob)) return byBlob;
    }

    const idx = sourceIndex();

    // 2. Google's own data, matched on the result title.
    if (title && title.length > 10) {
      const hit = idx.pairs.find(p =>
        p.title.length > 10 && (title.indexOf(p.title) > -1 || p.title.indexOf(title) > -1));
      if (hit) return hit.url;
    }

    // 3. The visible display URL, completed from Google data where possible.
    const block = el.closest(".tF2Cxc, .MjjYud, .g, [data-hveid]") || el;
    const c = citeParts(block);
    if (!c) return "";
    const prefix = c.origin + (c.path.length ? "/" + c.path.join("/") : "/");
    const byPrefix = idx.urls.find(u => u.indexOf(prefix) === 0);
    if (byPrefix) return byPrefix;
    if (!c.truncated && c.path.length) return c.origin + "/" + c.path.join("/");
    return c.origin;
  }

  /* ------------------------------------------------------- video detection
   * Hosts that are always video, plus hosts where only certain paths are.
   * This is what stops a Facebook business page being filed as a video and
   * what makes a Facebook video actually get filed as one.
   */
  const ALWAYS_VIDEO = ["youtube.com", "m.youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "twitch.tv", "rumble.com"];
  const PATH_VIDEO = {
    "facebook.com": /\/videos?\/|\/watch|\/reel\/|\/share\/v\//i,
    "fb.watch": /./,
    "instagram.com": /\/reel|\/tv\/|\/p\//i,
    "tiktok.com": /\/video\/|\/@/i,
    "linkedin.com": /\/video\//i,
    "x.com": /\/status\/.*video/i,
    "twitter.com": /\/status\/.*video/i
  };

  function isVideoUrl(url) {
    const host = domain(url);
    if (!host) return false;
    if (hostMatches(host, ALWAYS_VIDEO)) return true;
    for (const h in PATH_VIDEO) {
      if (host === h || host.endsWith("." + h)) return PATH_VIDEO[h].test(url);
    }
    return false;
  }

  /* --------------------------------------------------------------- results */

  const out = [];
  const seen = new Set();
  const claimed = [];       // section containers already consumed by a handler

  function inClaimed(el) {
    return claimed.some(sec => sec !== el && sec.contains(el));
  }

  // Social cards carry an entire post caption as their label, so titles are
  // capped at a length that still reads as a title in the table and exports.
  const TITLE_MAX = 180;

  function trimTitle(t) {
    const s = (t || "").trim();
    return s.length > TITLE_MAX ? s.slice(0, TITLE_MAX).trim() : s;
  }

  function extractSnippet(el) {
    if (!el) return "";
    try {
      const block = el.closest(".tF2Cxc, .MjjYud, .g, [data-hveid], .VkpGBb") || el.parentElement || el;
      const sn =
        block.querySelector("[data-sncf], .VwiC3b, .yXK7lf, .IsZvec, .aCOpRe, .ITZIwc, .kb0tQb") ||
        block.querySelector("div[style*='-webkit-line-clamp']");
      if (!sn) return "";
      const s = txt(sn);
      return s.length > 220 ? s.slice(0, 220).trim() + "…" : s;
    } catch (_) { return ""; }
  }

  function push(type, title, url, el) {
    const key = type + "|" + (url || "t:" + title);
    if (seen.has(key)) return false;
    seen.add(key);
    const u = url || "";
    out.push({
      type,
      title: trimTitle(title) || domain(u) || "(no title)",
      url: u,
      domain: u ? domain(u) : "",
      snippet: (type === "Organic" || type === "Sponsored" || type === "Top Stories") ? extractSnippet(el) : "",
      y: yOf(el)
    });
    return true;
  }

  function add(type, title, rawUrl, el) {
    if (isInjected(el) || !isGoogleNode(el)) return false;

    let url = clean(rawUrl);
    let hidden = false;
    if (!isUsableUrl(url)) {
      if (!isRedirectWrapper(rawUrl)) return false;   // not a result link at all
      url = recoverUrl(title, el, type === "Image Pack");
      hidden = true;
    }
    // Image pack rows carry the picture, however Google linked the thumbnail.
    if (type === "Image Pack" && !isImageFileUrl(url)) {
      const pic = imageForThumb(rawUrl, url, el);
      if (pic) { url = pic; hidden = true; }
    }
    // A real result whose destination cannot be recovered is still reported,
    // with an empty URL, rather than silently dropped.
    if (!isUsableUrl(url)) {
      if (!hidden || !title) return false;
      url = "";
    }

    if (type === "Organic" || type === "Forum" || type === "Top Stories") {
      if (url && isVideoUrl(url)) type = "Video";
    }
    // Cite fallback when redirect never resolved
    if (!isUsableUrl(url) && el && (type === "Organic" || type === "Sponsored")) {
      try {
        const block = el.closest(".tF2Cxc, .MjjYud, .g, [data-hveid]") || el.parentElement;
        const cite = block && block.querySelector("cite");
        if (cite) {
          let t = txt(cite);
          if (/^https?:\/\//i.test(t)) {
            url = t.split(/\s*›\s*/)[0].replace(/\/+$/, "");
          } else {
            const host = t.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[›»>\/\s|]/)[0].trim();
            if (host && host.includes(".") && !/google\./i.test(host)) url = "https://" + host;
          }
        }
      } catch (_) {}
    }
    return push(type, (title || "").trim(), url, el);
  }

  /* Chrome and label text that is furniture rather than a result. Matched as
   * whole strings, not prefixes: a prefix test would throw away a real ad
   * titled "Adidas running shoes" on the strength of its first two letters. */
  const NOISE_EXACT = new Set([
    "feedback", "sponsored", "sponsored result", "sponsored results", "ad", "ads", "more videos",
    "view all", "show more", "see more", "show all", "more images", "more news",
    "next", "previous", "about this result", "translate this page", "cached",
    "people also ask", "learn more", "privacy policy", "images", "videos"
  ]);
  const NOISE_PREFIX = /^(missing:|why this ad|dive deeper in ai mode|ask anything)/i;

  function isNoiseTitle(t) {
    const s = (t || "").trim().toLowerCase();
    return !s || NOISE_EXACT.has(s) || NOISE_PREFIX.test(s);
  }

  /* ---------------------------------------------------- section resolution
   * The old build took the heading's nearest [data-ved] ancestor, which is
   * usually a wrapper around the heading text only. The section therefore
   * contained no links and whole carousels came back empty. Climb instead
   * to the node that sits directly inside Google's result stream.
   */
  const STREAM_IDS = new Set(["rso", "search", "center_col", "rcnt", "main", "botstuff", "bres"]);

  function resolveSection(heading) {
    let node = heading;
    let best = null;
    for (let i = 0; i < 12 && node && node !== document.body; i++) {
      const parent = node.parentElement;
      if (!parent) break;
      if (node.id && STREAM_IDS.has(node.id)) break;
      // Stop before the climb swallows the next block. Without this the
      // "Videos" heading resolves to the whole result stream and ordinary
      // organic results get filed as videos.
      if (containsOtherSection(node, heading)) break;
      if (node.querySelectorAll("a[href]").length > 0) best = node;
      if (parent.id && STREAM_IDS.has(parent.id)) { best = node; break; }
      node = parent;
    }
    return best;
  }

  // Headings Google uses to open a block, as opposed to a result's own title.
  const SECTION_LABEL = /^(videos|short videos?|video results|images|image results|top stories|news|latest news|in the news|discussions and forums|forums|discussions|perspectives|communities|people also ask|people also search for|related searches|web results|products|popular products|popular deals|deals|shopping results|sponsored results|places|more places|ai overview|page navigation|complementary results|things to know|what people are saying.*)$/i;

  function containsOtherSection(node, heading) {
    return Array.from(node.querySelectorAll('h2, [role="heading"]')).some(h => {
      if (h === heading || heading.contains(h) || h.contains(heading)) return false;
      return h.tagName === "H2" || SECTION_LABEL.test(txt(h));
    });
  }

  function headings() {
    return Array.from(ROOT.querySelectorAll('h1, h2, h3, [role="heading"]'))
      .filter(h => !isInjected(h));
  }

  // Text of the elements an aria-labelledby attribute points at.
  function labelledText(el) {
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    if (!ids.length) return "";
    return ids.map(id => txt(document.getElementById(id))).filter(Boolean).join(" - ");
  }

  function sectionsByHeading(matcher) {
    const found = [];
    headings().forEach(h => {
      const label = txt(h).toLowerCase();
      if (!label || label.length > 60) return;
      if (!matcher(label)) return;
      const sec = resolveSection(h);
      if (sec && found.indexOf(sec) === -1) found.push(sec);
    });
    return found;
  }

  // Pull one row per card out of a section instead of one row per anchor.
  function collectSection(sec, type, opts) {
    opts = opts || {};
    if (!sec) return;
    claimed.push(sec);

    let anchors = Array.from(sec.querySelectorAll("a[href]"))
      .filter(a => !isInjected(a))
      .filter(a => !a.parentElement || !a.parentElement.closest("a[href]"));

    const headed = anchors.filter(a => a.querySelector('h3, [role="heading"], .MBeuO, .LC20lb, .n0jPhd'));
    if (headed.length) anchors = headed;

    anchors.forEach(a => {
      const h = a.querySelector('h3, [role="heading"], .MBeuO, .LC20lb, .n0jPhd');
      let title = txt(h);
      if (!title) title = a.getAttribute("aria-label") || "";
      // Image pack thumbnails name themselves through aria-labelledby, which is
      // why every image row used to come out blank and get dropped.
      if (!title) title = labelledText(a);
      if (!title) {
        const img = a.querySelector("img");
        title = img ? (img.getAttribute("alt") || "") : "";
      }
      if (!title) title = txt(a);
      title = title.trim();
      if (isNoiseTitle(title)) return;
      if (opts.requireTitle && title.length < 3) return;
      add(type, title, a.href, a);
    });
  }

  /* ============================== widgets ================================ */

  /* --- AI Overview -------------------------------------------------------
   * False positives were the main bug: the old build matched a.vIWmYe anywhere
   * on the page. That class is reused by other Google units, so an AI Overview
   * was reported on pages that had none, with unrelated links attached. The
   * block itself must now exist before a single row is produced.
   *
   * Citations are listed twice in the markup, once inline and once as source
   * cards, with the publisher and title in opposite order. They are collapsed
   * to one row per source by comparing the words of the label.
   */
  function citationKey(label) {
    return label.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/).filter(Boolean).sort().join(" ");
  }

  function cleanCitationLabel(label) {
    return String(label)
      .replace(/\.?\s*Related results\.?\s*$/i, "")
      .replace(/\.?\s*Opens in (a )?new (tab|window)\.?\s*$/i, "")
      .replace(/\s*\(\+\d+\)/g, "")
      .replace(/\s*\.\s*$/, "")
      .trim();
  }

  /* The block also carries bare publisher chips ("Mayo Clinic") beside the real
   * citations ("Mayo Clinic - Full page title"). A chip has no title half and
   * only a word or two, and every source it stands for is cited in full
   * elsewhere in the block, so it is not a row of its own. */
  function isPublisherChip(label, words) {
    return label.indexOf(" - ") === -1 && words.size <= 4;
  }

  function scrapeAIOverview() {
    let box =
      document.querySelector('div[data-subtree="aio"]') ||
      document.querySelector('[data-attrid="AIOverview"]') ||
      document.querySelector("#m-x-content") ||
      document.querySelector('[data-al-page-type="aio"]');

    if (!box) {
      const h = headings().find(el => {
        const t = txt(el).toLowerCase();
        return t === "ai overview" || t === "ai-powered overview" ||
               t === "ai overview for this search" || /^ai overview\b/.test(t);
      });
      if (h) box = resolveSection(h);
    }
    if (!box || isInjected(box)) return;            // no block, no rows

    claimed.push(box);

    // Every source appears twice: once as an inline citation and once as a
    // source card, with publisher and title in opposite order and sometimes a
    // longer publisher name. Collect first, then merge overlapping labels so
    // each source produces exactly one row.
    const found = [];

    Array.from(box.querySelectorAll("a[href]"))
      .filter(a => !isInjected(a))
      .forEach(a => {
        const direct = clean(a.href);
        let label, url;

        if (isUsableUrl(direct)) {
          label = txt(a.querySelector('[role="heading"], .MBeuO, h3')) ||
                  a.getAttribute("aria-label") || txt(a);
          url = direct;
        } else {
          label = a.getAttribute("aria-label");
          url = "";
        }

        label = cleanCitationLabel(label || "");
        if (label.length < 6 || isNoiseTitle(label)) return;

        const words = citationWords(label);
        if (isPublisherChip(label, words)) return;
        if (!url) url = recoverUrl(label, a);

        found.push({ label, url, el: a, words });
      });

    const merged = [];
    found.forEach(c => {
      const same = merged.find(g =>
        (g.url && c.url && g.url === c.url) || overlaps(g.words, c.words));
      if (!same) { merged.push(c); return; }
      if (c.words.size > same.words.size) { same.words = c.words; same.label = c.label; }
      if (!same.url && c.url) same.url = c.url;
      if (yOf(c.el) < yOf(same.el)) same.el = c.el;
    });

    merged.forEach(g => push("AI Overview", g.label, g.url, g.el));
  }

  // Significant words of a citation label, used to recognise the same source
  // written two different ways.
  function citationWords(label) {
    return new Set(
      label.toLowerCase()
        .replace(/opens in a new (tab|window)/g, " ")
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/)
        .filter(w => w.length >= 4)
    );
  }

  // True when one label's words are contained in the other's.
  function overlaps(a, b) {
    if (a.size < 3 || b.size < 3) return false;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    for (const w of small) if (!big.has(w)) return false;
    return true;
  }

  /* --- Sponsored --------------------------------------------------------- */
  function scrapeAds() {
    /* One [data-text-ad] element is one ad. The blocks around them, #tads at
     * the top and an unnamed block at the bottom, each hold several ads plus
     * the "Sponsored results" label. Treating a block as the unit yields one
     * row at most, and none at all once the label is filtered, which is how a
     * page with four ads came back with zero. Blocks are a fallback only. */
    let units = Array.from(ROOT.querySelectorAll("[data-text-ad]")).filter(u => !isInjected(u));

    if (!units.length) {
      const found = new Set();
      ["#tads > div", "#tadsb > div", "#bottomads > div", ".uEierd", ".v5yQqb", ".commercial-unit-desktop-top > div"]
        .forEach(sel => ROOT.querySelectorAll(sel).forEach(el => { if (!isInjected(el)) found.add(el); }));
      const list = Array.from(found);
      units = list.filter(u => !list.some(o => o !== u && o.contains(u)));
    }

    units.forEach(unit => {
      claimed.push(unit);

      // The ad's own headline, never the label of the block around it.
      let title = txt(unit.querySelector(".sVXRqc, .CCgQ5, h3, .v0nnCb"));
      if (!title || isNoiseTitle(title)) {
        title = Array.from(unit.querySelectorAll('[role="heading"]'))
          .map(txt).find(t => t && !isNoiseTitle(t)) || "";
      }

      // Google records the advertiser's landing page on its own ad markup, so
      // an ad still resolves when its click link is an encrypted redirect.
      const pcuEl = unit.querySelector("[data-pcu]");
      const pcu = pcuEl ? (pcuEl.getAttribute("data-pcu") || "").split(",")[0].trim() : "";

      const anchors = Array.from(unit.querySelectorAll("a[href]")).filter(a => !isInjected(a));
      const a = anchors.find(x => {
        const u = clean(x.href);
        return isUsableUrl(u) && !/google\./.test(domain(u));
      }) || anchors[0];

      if (isUsableUrl(pcu)) { add("Sponsored", title || domain(pcu), pcu, a || unit); return; }
      if (a) add("Sponsored", title, a.href, a);
    });
  }

  /* --- Shopping ---------------------------------------------------------- */
  function scrapeShopping() {
    ROOT.querySelectorAll(".pla-unit, .sh-dgr__content").forEach(item => {
      if (isInjected(item)) return;
      const a = item.querySelector("a[href]") || (item.tagName === "A" ? item : null);
      if (!a) return;
      const t = txt(item.querySelector(".pymv4e, .BXIkFc, .tAxDx, h3, h4")) || a.getAttribute("aria-label");
      add("Shopping", t, a.href, a);
    });

    productSections(l =>
      l === "products" || l === "popular products" || l === "shopping results" ||
      l === "sponsored products" || l === "featured products" || l === "more products" ||
      l === "deals" || l === "popular deals" || l === "in stores nearby" ||
      l === "available nearby" || l === "also nearby"
    ).forEach(entry => {
      const sponsored = /^sponsored/.test(txt(entry.heading).toLowerCase());
      collectProductCards(entry.sec, entry.heading, sponsored ? "Sponsored" : "Shopping");
    });
  }

  // Product card titles. Google does not mark these up as headings.
  const PRODUCT_TITLE = '[role="heading"], h3, h4, .gkQHve, .tAxDx, .pymv4e, .BXIkFc, .rgHvZc';

  /* Product units are resolved by the cards they hold rather than by links,
   * because some of these units contain no anchor at all. */
  function productSections(matcher) {
    const found = [];
    headings().forEach(h => {
      const label = txt(h).toLowerCase();
      if (!label || label.length > 60 || !matcher(label)) return;

      let node = h, best = null;
      for (let i = 0; i < 12 && node && node !== document.body; i++) {
        const parent = node.parentElement;
        if (!parent) break;
        if (node.id && STREAM_IDS.has(node.id)) break;
        if (containsOtherSection(node, h)) break;
        if (node.querySelectorAll(PRODUCT_TITLE).length > 1) best = node;
        if (parent.id && STREAM_IDS.has(parent.id)) { best = node; break; }
        node = parent;
      }
      if (best && !found.some(f => f.sec === best)) found.push({ sec: best, heading: h });
    });
    return found;
  }

  /* Product units are built from click-handled cards, not links: Google ships
   * no per-product URL in the page at all, and the only anchors inside are
   * third-party review pages attached to a card, which are not results. So the
   * card itself is the row, with its price, and an empty URL. If a unit does
   * use real product links, those are taken instead. */
  function collectProductCards(sec, sectionHeading, type) {
    if (!sec) return;
    claimed.push(sec);

    const linked = Array.from(sec.querySelectorAll("a[href]"))
      .filter(a => !isInjected(a))
      .filter(a => a.querySelector(PRODUCT_TITLE));

    if (linked.length) {
      linked.forEach(a => {
        const title = txt(a.querySelector(PRODUCT_TITLE));
        if (isNoiseTitle(title)) return;
        add(type, title, a.href, a);
      });
      return;
    }

    Array.from(sec.querySelectorAll(PRODUCT_TITLE))
      .filter(h => h !== sectionHeading && !isInjected(h))
      .forEach(h => {
        const title = txt(h);
        if (!title || title.length < 3) return;
        if (isNoiseTitle(title) || SECTION_LABEL.test(title)) return;
        push(type, title + priceNear(h), "", h);
      });
  }

  // The price shown on the card this heading belongs to.
  function priceNear(h) {
    for (let n = h.parentElement, i = 0; n && i < 5; n = n.parentElement, i++) {
      const m = txt(n).match(/(?:[$£€₹]|Rs\.?\s?)\s?[\d][\d.,]*/);
      if (m) return " | " + m[0].trim();
    }
    return "";
  }

  /* --- Featured Snippet -------------------------------------------------- */
  function scrapeFeaturedSnippet() {
    const fs = ROOT.querySelector(".xpdopen .hgKElc, .IZ6rdc, [data-attrid='wa:/description']");
    if (!fs || isInjected(fs)) return;
    const block = fs.closest(".xpdopen") || fs.closest(".g") || fs.closest(".M8OgIe") || fs.parentElement;
    if (!block) return;
    const link = Array.from(block.querySelectorAll("a[href]"))
      .filter(a => !isInjected(a))
      .find(a => isUsableUrl(clean(a.href)) || isRedirectWrapper(a.href));
    if (!link) return;
    claimed.push(block);
    add("Featured Snippet", txt(block.querySelector("h3")) || txt(link), link.href, link);
  }

  /* --- Knowledge Panel --------------------------------------------------- */
  function scrapeKnowledgePanel() {
    const kp = document.querySelector(".kp-wholepage, .knowledge-panel, #rhs .kp-blk");
    if (!kp) return;
    const link = Array.from(kp.querySelectorAll("a[href]"))
      .find(a => isUsableUrl(clean(a.href)));
    if (!link) return;
    const title = txt(kp.querySelector('[data-attrid="title"], h2, [role="heading"]'));
    push("Knowledge Panel", title || txt(link), clean(link.href), kp);
  }

  /* --- People Also Ask ---------------------------------------------------- */
  function scrapePAA() {
    const items = new Set();
    ROOT.querySelectorAll('[jsname="yEVEwb"], .related-question-pair, [data-q]')
      .forEach(el => { if (!isInjected(el)) items.add(el); });

    const list = Array.from(items);
    list.forEach(item => {
      if (list.some(o => o !== item && item.contains(o))) return;

      /* Each question carries the heading and link of the page it answers from.
       * Claiming the item keeps the organic pass from reporting those source
       * pages a second time as if they were ordinary results. */
      claimed.push(item);

      const question = (item.getAttribute("data-q") ||
        txt(item.querySelector('[role="heading"], .CSkcDe, .JlqpRe, span'))).trim();
      if (!question || question.length < 6) return;
      if (isNoiseTitle(question)) return;
      // The query itself is repeated in this markup; it is not a question row.
      if (citationKey(question) === citationKey(currentQuery())) return;

      // Only a real source link counts; "search for this" links do not.
      let link = Array.from(item.querySelectorAll("a[href]"))
        .filter(a => !isInjected(a))
        .map(a => clean(a.href))
        .find(u => isUsableUrl(u) && !/google\./.test(domain(u)));

      if (!link) {
        const wrapped = Array.from(item.querySelectorAll("a[href]"))
          .find(a => isRedirectWrapper(a.href));
        if (wrapped) link = recoverUrl(txt(item.querySelector("h3")) || "", wrapped);
      }

      push("PAA", question, isUsableUrl(link) ? link : "", item);
    });
  }

  function currentQuery() {
    try { return new URL(location.href).searchParams.get("q") || ""; } catch (e) { return ""; }
  }

  /* --- Videos ------------------------------------------------------------- */
  function scrapeVideos() {
    sectionsByHeading(l =>
      l === "videos" || l === "short videos" || l === "short video" ||
      l === "video results" || l.indexOf("videos for") === 0 || l === "watch"
    ).forEach(sec => collectSection(sec, "Video", { requireTitle: true }));

    // Carousels and inline video cards that carry no heading of their own.
    ROOT.querySelectorAll("#rso a[href], #search a[href]").forEach(a => {
      if (isInjected(a)) return;
      if (a.parentElement && a.parentElement.closest("a[href]")) return;
      let url = clean(a.href);
      if (!isUsableUrl(url)) return;      // recovery happens in the organic pass
      if (!isVideoUrl(url)) return;
      const img = a.querySelector("img");
      let title = txt(a.querySelector('h3, [role="heading"], .MBeuO, .LC20lb')) ||
                  a.getAttribute("aria-label") ||
                  (img ? (img.getAttribute("alt") || "") : "") ||
                  txt(a);
      title = (title || "").trim();
      if (title.length < 3 || isNoiseTitle(title)) return;
      add("Video", title, a.href, a);
    });
  }

  /* --- Image Pack --------------------------------------------------------- */
  function scrapeImages() {
    sectionsByHeading(l => l === "images" || l === "image results" || l.indexOf("images for") === 0)
      .forEach(sec => collectSection(sec, "Image Pack"));
  }

  /* --- Top Stories / News -------------------------------------------------- */
  function scrapeNews() {
    sectionsByHeading(l =>
      l === "top stories" || l === "news" || l === "latest news" ||
      l === "in the news" || l === "breaking news"
    ).forEach(sec => collectSection(sec, "Top Stories", { requireTitle: true }));
  }

  /* --- Discussions and forums ---------------------------------------------- */
  function scrapeForums() {
    sectionsByHeading(l =>
      l === "discussions and forums" || l === "forums" || l === "discussions" ||
      l === "from forums" || l.indexOf("what people are saying") !== -1 ||
      l === "perspectives" || l === "communities"
    ).forEach(sec => collectSection(sec, "Forum", { requireTitle: true }));
  }

  /* --- Local Pack ---------------------------------------------------------- */
  function scrapeLocalPack() {
    const units = new Set();
    ROOT.querySelectorAll(".VkpGBb, .rllt__details, .cXedhc").forEach(el => {
      if (isInjected(el)) return;
      const unit = el.closest(".VkpGBb") || el;
      if (unit.querySelector(".rllt__details") || unit.matches(".rllt__details") || unit.hasAttribute("data-cid")) {
        units.add(unit);
      }
    });

    const list = Array.from(units);
    list.forEach(unit => {
      if (list.some(o => o !== unit && unit.contains(o))) return;
      // Google appends its own ad label to sponsored local entries.
      const name = txt(unit.querySelector('.OSrXXb, .dbg0pd, .qBF1Pd, [role="heading"]'))
        .replace(/\s*My Ad Center\s*$/i, "").trim();
      if (!name) return;
      claimed.push(unit);
      const addr = txt(unit.querySelector(".rllt__details .W4Efsd:nth-child(2), .lMbq3e"));
      let site = Array.from(unit.querySelectorAll("a[href]"))
        .map(a => clean(a.href))
        .find(u => isUsableUrl(u) && !/google\./.test(domain(u)));
      if (!site) {
        const wrapped = Array.from(unit.querySelectorAll("a[href]")).find(a => isRedirectWrapper(a.href));
        if (wrapped) site = recoverUrl(name, wrapped);
      }
      push("Local Pack", name + (addr ? " | " + addr : ""), isUsableUrl(site) ? site : "", unit);
    });
  }

  /* --- Organic -------------------------------------------------------------
   * Two passes. The class-based pass handles the classic layout; the heading
   * pass catches the newer layouts where .tF2Cxc / .yuRUbf are absent, which
   * is what used to drop organic results at random.
   */
  const AD_CONTEXT = "#tads, #tadsb, #bottomads, [data-text-ad], .commercial-unit-desktop-top, .uEierd, .v5yQqb";

  function scrapeOrganic() {
    ROOT.querySelectorAll("#search .tF2Cxc, #rso .tF2Cxc, #search .yuRUbf, #rso .yuRUbf").forEach(wrap => {
      if (isInjected(wrap)) return;
      if (wrap.closest(".kp-wholepage, .xpdopen") || wrap.closest(AD_CONTEXT)) return;
      if (inClaimed(wrap)) return;
      const h3 = wrap.querySelector("h3");
      const a = wrap.querySelector("a[href]") || (h3 ? h3.closest("a[href]") : null);
      if (!h3 || !a) return;
      add("Organic", txt(h3), a.href, a);
    });

    ROOT.querySelectorAll("#rso h3, #search h3").forEach(h3 => {
      if (isInjected(h3)) return;
      if (h3.closest(".kp-wholepage, .xpdopen") || h3.closest(AD_CONTEXT)) return;
      if (inClaimed(h3)) return;
      const holder = h3.closest(".MjjYud, .g, [data-hveid]") || h3.parentElement || h3;
      const a = h3.closest("a[href]") || holder.querySelector("a[href]");
      if (!a || isInjected(a)) return;
      const title = txt(h3);
      if (!title || isNoiseTitle(title)) return;
      add("Organic", title, a.href, a);
    });
  }

  /* --- Related searches ----------------------------------------------------- */
  function scrapeRelated() {
    sectionsByHeading(l =>
      l === "related searches" || l === "people also search for" ||
      l === "searches related to" || l.indexOf("related searches") === 0
    ).forEach(sec => {
      claimed.push(sec);
      Array.from(sec.querySelectorAll('a[href], [role="link"]'))
        .filter(el => !isInjected(el))
        .forEach(el => {
          const t = txt(el);
          if (!t || t.length < 3 || isNoiseTitle(t)) return;
          push("Related Search", t, "", el);
        });
    });
  }

  /* ================================ run ==================================== */

  if (!skipSettle) await settle();

  // Order matters: every widget claims its container before the organic pass
  // runs, so nothing is counted twice and nothing is mislabelled.
  const steps = [
    scrapeAIOverview, scrapeAds, scrapeShopping, scrapeFeaturedSnippet,
    scrapeKnowledgePanel, scrapePAA, scrapeVideos, scrapeImages,
    scrapeNews, scrapeForums, scrapeLocalPack, scrapeOrganic, scrapeRelated
  ];
  for (const step of steps) {
    try { step(); } catch (e) { /* one broken widget must not kill the scan */ }
  }

  out.sort((a, b) => a.y - b.y);
  return out.map((r, i) => ({
    type: r.type,
    position: i + 1,
    title: r.title,
    url: r.url,
    domain: r.domain || (r.url ? domain(r.url) : ""),
    snippet: r.snippet || ""
  }));
}

// Export for ShahzaibSEO sidebar + popup
if (typeof window !== 'undefined') {
  window.RSSerpScrape = RSSerpScrape;
}

