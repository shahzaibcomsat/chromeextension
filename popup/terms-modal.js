(function () {
  var TERMS_KEY = 'rsTermsAgreedV1';
  var overlay = null;

  function buildModal() {
    if (document.getElementById('rsTermsOverlay')) return document.getElementById('rsTermsOverlay');
    var el = document.createElement('div');
    el.id = 'rsTermsOverlay';
    el.className = 'rs-terms-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'rsTermsTitle');
    el.innerHTML =
      '<div class="rs-terms-modal">' +
        '<h2 id="rsTermsTitle">Before you start</h2>' +
        '<p class="rs-terms-sub">Please read this once. It keeps ShahzaibSEO clear, free, and fair for everyone.</p>' +
        '<div class="rs-terms-box"><strong>100% free forever.</strong> No payment, no subscription, no hidden fees.</div>' +
        '<h3>What ShahzaibSEO does</h3>' +
        '<ul>' +
          '<li>Checks SEO on the page you open in your browser</li>' +
          '<li>Reads public data (page content, search results, domain info)</li>' +
          '<li>Runs in your browser — not on a ShahzaibSEO server</li>' +
        '</ul>' +
        '<h3>Your data</h3>' +
        '<ul>' +
          '<li>We do <strong>not</strong> upload your pages, keywords, or reports to our servers</li>' +
          '<li>Nothing is sold or shared with third parties</li>' +
          '<li>Results stay on your device (Chrome storage)</li>' +
        '</ul>' +
        '<h3>Where data comes from</h3>' +
        '<ul>' +
          '<li><strong>This page + Google SERP</strong> — on-page checks and Niche Research (public results)</li>' +
          '<li><strong>WHOIS / RDAP</strong> — domain age (free public lookups)</li>' +
          '<li><strong>Optional keys in Settings</strong> — Keywords Everywhere, Ahrefs, Serper, AI providers: only if <em>you</em> add your own key. ShahzaibSEO never requires paid tools.</li>' +
        '</ul>' +
        '<h3>Official source only</h3>' +
        '<ul>' +
          '<li>Get Shahzaib SEO information and support at <strong>shazzseo.com</strong></li>' +
          '<li>There is no paid seller or third-party ShahzaibSEO shop</li>' +
          '<li>Not affiliated with Google, Ahrefs, Moz, or other data providers</li>' +
        '</ul>' +
        '<h3>Fair use</h3>' +
        '<p>Use public data responsibly. Follow each site’s rules and Google’s terms. Scores and estimates are guidance only — not a ranking or income guarantee.</p>' +
        '<h3>Developer</h3>' +
        '<ul>' +
          '<li><strong>Shahzaib Hassan</strong> — Shahzaib SEO developer</li>' +
          '<li>Website: <a href="https://shazzseo.com" target="_blank" rel="noopener">shazzseo.com</a></li>' +
          '<li>Email: <a href="mailto:info@shazzseo.com">info@shazzseo.com</a></li>' +
        '</ul>' +
        '<p><strong>By clicking Agree</strong> you confirm you understand ShahzaibSEO is free, local-first, and you will use it fairly.</p>' +
        '<div class="rs-terms-actions">' +
          '<button type="button" class="rs-terms-agree" id="rsTermsAgreeBtn">Agree &amp; Continue</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('#rsTermsAgreeBtn').addEventListener('click', function () {
      try {
        chrome.storage.local.set({ [TERMS_KEY]: true, rsTermsAgreedAt: Date.now() });
      } catch (e) {}
      hide();
    });
    return el;
  }

  function show() {
    overlay = buildModal();
    overlay.hidden = false;
  }
  function hide() {
    if (!overlay) overlay = document.getElementById('rsTermsOverlay');
    if (overlay) overlay.hidden = true;
  }

  function maybeShowOnLoad() {
    try {
      chrome.storage.local.get([TERMS_KEY], function (r) {
        if (r && r[TERMS_KEY]) return;
        show();
      });
    } catch (e) {
      show();
    }
  }

  function bindViewBtn() {
    var btn = document.getElementById('rsViewTermsBtn');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        show();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      maybeShowOnLoad();
      bindViewBtn();
    });
  } else {
    maybeShowOnLoad();
    bindViewBtn();
  }
  // Settings tab may load later — re-bind when user opens settings
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-tab="settings"]');
    if (t) setTimeout(bindViewBtn, 50);
  });
})();
