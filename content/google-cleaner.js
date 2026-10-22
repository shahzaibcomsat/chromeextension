/**
 * ShahzaibSEO — Google Search Cleaner
 * Hides AI Overview, video packs, ads, People Also Ask — WITHOUT wiping organic results.
 */
(function () {
  'use strict';

  const DEFAULTS = {
    googleCleanerToggle: false,
    hideGoogleAi: false,
    hideGoogleVideo: false,
    hideGoogleAds: false,
    hideGooglePeople: false
  };

  // Never hide these (core SERP structure)
  const PROTECTED_IDS = new Set([
    'search', 'rso', 'center_col', 'main', 'cnt', 'rcnt', 'appbar',
    'top_nav', 'searchform', 'gb', 'hdtb', 'hdtbSum', 'result-stats',
    'foot', 'fbar', 'rhs', 'botstuff', 'xjs', 'searchform'
  ]);

  function isProtected(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.tagName === 'HTML' || el.tagName === 'BODY' || el.tagName === 'HEAD') return true;
    const id = el.id || '';
    if (PROTECTED_IDS.has(id)) return true;
    if (el.getAttribute('role') === 'main') return true;
    return false;
  }

  function canHide(el) {
    if (!el || isProtected(el)) return false;
    // Don't hide ancestors of many organic results
    try {
      const organics = el.querySelectorAll('div.g, div[data-sokoban-container]');
      if (organics.length >= 3) return false;
    } catch (_) {}
    // Don't hide huge page chunks
    try {
      if (el.offsetHeight > 2200) return false;
    } catch (_) {}
    return true;
  }

  function hideEl(el) {
    if (!canHide(el)) return;
    if (el.getAttribute('data-rankseo-cleaner-hidden') === 'true') return;
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute('data-rankseo-cleaner-hidden', 'true');
  }

  function hideElements(selector) {
    try {
      document.querySelectorAll(selector).forEach(hideEl);
    } catch (_) {}
  }

  // Narrow selectors only — no broad carousel / generic wrappers
  const SELECTORS = {
    ads: [
      '#tads',
      '#tadsb',
      '#bottomads',
      'div[data-text-ad]',
      'div[data-text-ad="1"]',
      'div.uEierd',
      'div.commercial-unit-desktop-top',
      'div.commercial-unit-desktop-rhs',
      'div.top-pla-group-inner',
      'div.pla-unit-container',
      'div[aria-label="Ads"]'
    ].join(','),

    peopleAlsoAsk: [
      'div.related-question-pair',
      'div[jsname="Cpkphb"]'
    ].join(','),

    video: [
      'div.vtSz8d',
      'video-voyager'
    ].join(','),

    aiOverview: [
      'div.hdzaWe',
      'div.YzCcne',
      'div.M8OgIe',
      '#eKIzJc',
      'div[data-attrid="wa:/description"]'
    ].join(',')
  };

  function hideAiOverviewByLabel() {
    try {
      const nodes = document.querySelectorAll('h1, h2, div[role="heading"]');
      nodes.forEach((h) => {
        const t = (h.textContent || '').trim().toLowerCase();
        if (t !== 'ai overview' && t !== 'ai overviews') return;
        let el = h.parentElement;
        for (let i = 0; i < 5 && el; i++) {
          if (isProtected(el)) return;
          if (el.offsetHeight > 80 && el.offsetHeight < 1800 && canHide(el)) {
            hideEl(el);
            return;
          }
          el = el.parentElement;
        }
      });
    } catch (_) {}
  }

  function hidePaaSection() {
    try {
      const nodes = document.querySelectorAll('h2, h3, div[role="heading"]');
      nodes.forEach((h) => {
        const t = (h.textContent || '').trim().toLowerCase();
        if (t !== 'people also ask') return;
        const el = h.closest('div.ULSxyf, div.wQiwMc, div.cUnQKe');
        if (el && canHide(el)) hideEl(el);
      });
    } catch (_) {}
  }

  function restoreAll() {
    document.querySelectorAll('[data-rankseo-cleaner-hidden="true"]').forEach((el) => {
      el.style.removeProperty('display');
      el.removeAttribute('data-rankseo-cleaner-hidden');
    });
  }

  function resolveSettings(s) {
    const out = {};
    Object.keys(DEFAULTS).forEach((k) => {
      out[k] = s[k] != null ? !!s[k] : DEFAULTS[k];
    });
    return out;
  }

  function apply() {
    if (!chrome.runtime || !chrome.runtime.id) return;
    try {
      chrome.storage.sync.get(Object.keys(DEFAULTS), (s) => {
        if (chrome.runtime.lastError) return;
        const cfg = resolveSettings(s || {});
        if (!cfg.googleCleanerToggle) {
          restoreAll();
          return;
        }
        if (cfg.hideGoogleAds) hideElements(SELECTORS.ads);
        if (cfg.hideGooglePeople) {
          hideElements(SELECTORS.peopleAlsoAsk);
          hidePaaSection();
        }
        if (cfg.hideGoogleVideo) hideElements(SELECTORS.video);
        if (cfg.hideGoogleAi) {
          hideElements(SELECTORS.aiOverview);
          hideAiOverviewByLabel();
        }
      });
    } catch (_) {}
  }

  let t = null;
  const throttled = () => {
    if (t) return;
    t = setTimeout(() => {
      t = null;
      apply();
    }, 150);
  };

  try {
    chrome.storage.sync.get(Object.keys(DEFAULTS), (s) => {
      if (chrome.runtime.lastError) {
        apply();
        return;
      }
      const missing = {};
      let need = false;
      Object.keys(DEFAULTS).forEach((k) => {
        if (s[k] == null) {
          missing[k] = DEFAULTS[k];
          need = true;
        }
      });
      if (need) chrome.storage.sync.set(missing, apply);
      else apply();
    });
  } catch (_) {
    apply();
  }

  function startObserver() {
    if (!document.body) return;
    new MutationObserver(throttled).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', () => {
    apply();
    startObserver();
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const keys = Object.keys(DEFAULTS);
      if (!keys.some((k) => changes[k])) return;
      chrome.storage.sync.get(keys, (s) => {
        const cfg = resolveSettings(s || {});
        if (!cfg.googleCleanerToggle) restoreAll();
        else {
          restoreAll();
          apply();
        }
      });
    });
  } catch (_) {}
})();
