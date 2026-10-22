/**
 * automation-modal.js
 * Thin entry shim — full automation logic lives in popup.js
 * (initAutomationModal, startAutomation, agent progress UI).
 * Kept so the HTML <script src="automation-modal.js"> does not 404.
 */
(function () {
  'use strict';
  function ensureInit() {
    if (typeof initAutomationModal === 'function') {
      try { initAutomationModal(); } catch (e) {
        console.warn('[ShahzaibSEO] automation-modal init:', e.message);
      }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureInit);
  } else {
    ensureInit();
  }
})();
