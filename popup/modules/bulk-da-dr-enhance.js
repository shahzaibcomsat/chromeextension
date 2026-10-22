/**
 * Bulk DA+DR enhancements
 * - Save / load domain lists
 * - Store previous run (optional future use)
 * ΔDA / ΔDR columns removed from UI
 */
(function () {
  'use strict';

  const STORAGE_LIST = 'bulkDaDrSavedList';
  const STORAGE_PREV = 'bulkDaDrPreviousResults';

  function $(id) { return document.getElementById(id); }

  function normalizeDomain(v) {
    return String(v || '').trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
  }

  function initBulkEnhance() {
    const saveBtn = $('bulkSaveListBtn');
    const loadBtn = $('bulkLoadListBtn');
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener('click', () => {
        const raw = $('bulkDomainList')?.value || '';
        const domains = raw.split(/[\n,;]+/).map(normalizeDomain).filter(Boolean);
        chrome.storage.local.set({ [STORAGE_LIST]: domains }, () => {
          if (typeof toast === 'function') toast('Saved ' + domains.length + ' domains');
          else alert('Saved ' + domains.length + ' domains');
        });
      });
    }
    if (loadBtn && !loadBtn.dataset.bound) {
      loadBtn.dataset.bound = '1';
      loadBtn.addEventListener('click', () => {
        chrome.storage.local.get([STORAGE_LIST], res => {
          const list = res[STORAGE_LIST] || [];
          const ta = $('bulkDomainList');
          if (ta) { ta.value = list.join('\n'); ta.dispatchEvent(new Event('input')); }
          if (typeof toast === 'function') toast(list.length ? 'Loaded ' + list.length + ' domains' : 'No saved list');
        });
      });
    }

    // Hide old baseline note if present
    const note = $('bulkDiffNote');
    if (note) note.style.display = 'none';
  }

  /** Save snapshot after each bulk render (no Δ columns in UI) */
  function patchRenderBulkTable() {
    if (typeof window.renderBulkTable !== 'function' && typeof renderBulkTable !== 'function') {
      setTimeout(patchRenderBulkTable, 200);
      return;
    }
    const orig = window.renderBulkTable || renderBulkTable;
    const wrapped = function (results) {
      orig(results);
      try {
        const map = {};
        (results || []).forEach(r => {
          if (r && r.domain) map[r.domain] = { da: r.da, dr: r.dr };
        });
        chrome.storage.local.set({ [STORAGE_PREV]: map });
      } catch (_) {}
    };
    window.renderBulkTable = wrapped;
    try { renderBulkTable = wrapped; } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBulkEnhance);
  } else {
    initBulkEnhance();
  }
})();
