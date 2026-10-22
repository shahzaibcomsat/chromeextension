/**
 * Rank Tracker enhancements (Phase B)
 * - Stronger free-mode messaging
 * - Recommended Serper path
 * - Settings deep-link
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function refreshRankTrackerMessaging() {
    chrome.storage.local.get(['rankApiKey', 'rankApiProvider'], res => {
      const hasKey = !!(res.rankApiKey && String(res.rankApiKey).trim());
      const badge = $('rtMethodBadge');
      const note = $('rtNoKeyNote');
      const recommend = $('rtRecommendBox');
      const sub = $('rtHeaderSub');

      if (badge) {
        badge.textContent = hasKey ? (res.rankApiProvider === 'serpapi' ? 'SERPAPI' : 'SERPER') : 'FREE';
        badge.style.background = hasKey ? '#0D9488' : '#94a3b8';
        badge.style.color = '#fff';
      }
      if (note) note.style.display = hasKey ? 'none' : '';
      if (recommend) {
        recommend.style.display = hasKey ? 'none' : '';
      }
      if (sub) {
        sub.textContent = hasKey
          ? 'Tracking via Rank API — fast checks for bulk keywords.'
          : 'Free Google-scan mode — fine for a few keywords; use Serper for reliable bulk tracking.';
      }
    });
  }

  function bindSettingsLink() {
    const link = $('rtOpenRankSettings');
    if (!link || link.dataset.bound) return;
    link.dataset.bound = '1';
    link.addEventListener('click', e => {
      e.preventDefault();
      document.querySelector('[data-tab="settings"]')?.click();
      setTimeout(() => {
        document.getElementById('settingsRankApiSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    });
  }

  function init() {
    bindSettingsLink();
    refreshRankTrackerMessaging();
    // Re-check when Rank Tracker tab is opened
    document.querySelectorAll('[data-tab="ranktracker"]').forEach(btn => {
      btn.addEventListener('click', () => setTimeout(refreshRankTrackerMessaging, 50));
    });
    // After settings save, other code may toast — poll storage on focus
    window.addEventListener('focus', refreshRankTrackerMessaging);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for popup.js if needed
  window.ShahzaibSEORankTrackerEnhance = { refresh: refreshRankTrackerMessaging };
})();
