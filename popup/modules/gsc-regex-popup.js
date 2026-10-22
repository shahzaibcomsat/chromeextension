/**
 * Search Console Regex tab.
 *
 * A 200+ preset library of ready-made Google Search Console "Query" regex
 * filters (questions, commercial intent, brand/non-brand, local SEO,
 * e-commerce, AI, etc.) — browse, search, favorite, test against a sample
 * query, copy to clipboard, or push straight into a live Search Console
 * Performance report with one click ("Apply in GSC").
 *
 * "Apply in GSC" drives the actual Performance report's filter UI end to
 * end with zero manual clicks: a content script (content/gsc/*) opens the
 * filter panel and match-type dropdown, the background service worker
 * dispatches a genuinely trusted mouse click on the "Custom (regex)" option
 * via the debugger protocol (Search Console ignores synthetic JS events
 * there — see content/gsc/gsc-filter.js), fills in the regex, and clicks
 * Apply. No Google API, no OAuth — it only drives the Search Console tab
 * the user already has open.
 *
 * Depends on (loaded earlier in popup.html):
 *   - libs/gsc-regex/gsc-regex-util.js  -> window.GscRegexUtil
 *   - libs/gsc-regex/gsc-storage.js     -> window.GscStorage
 *   - libs/gsc-regex/gsc-presets.json   (fetched at init)
 * Reuses popup.js's existing toast(msg) and escapeHtml(s) helpers.
 */
(function () {
  'use strict';

  const PERFORMANCE_URL_RE = /^https:\/\/search\.google\.com\/search-console\/performance/;

  const state = {
    inited: false,
    builtinPresets: [],
    categories: [],
    customPresets: [],
    favorites: [],
    brandTerms: [],
    activeCategory: 'all',
    searchQuery: '',
    expandedId: null,
    activeTabId: null,
  };

  function $(id) { return document.getElementById(id); }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function notify(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
  }

  function uid(prefix) {
    return (prefix || 'p') + '-' + Math.floor(Math.random() * 1e9).toString(36);
  }

  // Small inline icon set — kept local so this module has no extra dependency.
  const ICONS = {
    grid: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 3h6v6H3V3zm8 0h6v6h-6V3zM3 11h6v6H3v-6zm8 0h6v6h-6v-6z"/></svg>',
    star: '<svg viewBox="0 0 20 20" fill="{{fill}}"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.448a1 1 0 00-.363 1.118l1.287 3.957c.3.922-.755 1.688-1.54 1.118l-3.367-2.448a1 1 0 00-1.175 0l-3.367 2.448c-.784.57-1.838-.196-1.539-1.118l1.286-3.957a1 1 0 00-.363-1.118L2.063 9.384c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.69l1.285-3.957z"/></svg>',
    clock: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v5a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L11 9.586V5z" clip-rule="evenodd"/></svg>',
    pencil: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-8.5 8.5a1 1 0 01-.447.263l-3 1a1 1 0 01-1.265-1.265l1-3a1 1 0 01.263-.447l8.5-8.5z"/></svg>',
    trash: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 112 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd"/></svg>',
    copy: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M8 3a2 2 0 00-2 2v8a2 2 0 002 2h7a2 2 0 002-2V7.414A2 2 0 0016.414 6L13 2.586A2 2 0 0011.586 2H8z"/><path d="M4 7a2 2 0 00-2 2v8a2 2 0 002 2h7a2 2 0 002-2v-1H6a2 2 0 01-2-2V7z"/></svg>',
    external: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5zM12.5 2a.75.75 0 000 1.5h3.19l-5.72 5.72a.75.75 0 101.06 1.06l5.72-5.72v3.19a.75.75 0 001.5 0v-5a.75.75 0 00-.75-.75h-5z" clip-rule="evenodd"/></svg>',
    check: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z" clip-rule="evenodd"/></svg>',
    x: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>',
    warn: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.72-1.36 3.486 0l6.28 11.18c.75 1.333-.213 2.98-1.743 2.98H3.72c-1.53 0-2.493-1.647-1.743-2.98l6.28-11.18zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.5a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0V7.5z" clip-rule="evenodd"/></svg>',
    tag: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M17.707 9.293l-7-7A1 1 0 0010 2H5a2 2 0 00-2 2v5a1 1 0 00.293.707l7 7a1 1 0 001.414 0l6-6a1 1 0 000-1.414zM6 6a1 1 0 110 2 1 1 0 010-2z" clip-rule="evenodd"/></svg>'
  };
  function icon(name, opts) {
    opts = opts || {};
    const size = opts.size || 14;
    let svg = ICONS[name] || ICONS.tag;
    svg = svg.replace('{{fill}}', opts.filled ? 'currentColor' : 'none');
    if (!opts.filled && name === 'star') {
      svg = svg.replace('<svg viewBox="0 0 20 20" fill="none">', '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">');
    }
    return svg.replace('<svg ', `<svg class="icon" width="${size}" height="${size}" `);
  }

  // ---------------------------------------------------------------------
  // Data helpers
  // ---------------------------------------------------------------------

  function allPresets() {
    return [
      ...state.builtinPresets.map((p) => Object.assign({}, p, { sourceType: 'builtin' })),
      ...state.customPresets.map((p) => Object.assign({}, p, { sourceType: 'custom' }))
    ];
  }

  function presetById(id) {
    return allPresets().find((p) => p.id === id);
  }

  function categoryLabel(id) {
    const c = state.categories.find((x) => x.id === id);
    return c ? c.label : id;
  }

  function categoryIcon(id) {
    const c = state.categories.find((x) => x.id === id);
    return (c && ICONS[c.icon]) ? c.icon : 'tag';
  }

  function resolvedRegexFor(preset, brandTerms) {
    const terms = brandTerms || state.brandTerms;
    return window.GscRegexUtil.hasPlaceholder(preset.regex)
      ? window.GscRegexUtil.resolvePlaceholder(preset.regex, terms)
      : preset.regex;
  }

  function presetSearchScore(preset, q) {
    const name = (preset.name || '').toLowerCase();
    let score = 0;
    if (name === q) score = Math.max(score, 100);
    else if (name.startsWith(q)) score = Math.max(score, 80);
    else if (name.includes(q)) score = Math.max(score, 60);

    if ((preset.tags || []).some((t) => t.toLowerCase() === q)) score = Math.max(score, 55);
    else if ((preset.tags || []).some((t) => t.toLowerCase().includes(q))) score = Math.max(score, 40);

    if ((preset.regex || '').toLowerCase().includes(q)) score = Math.max(score, 45);
    if (categoryLabel(preset.category).toLowerCase().includes(q)) score = Math.max(score, 35);
    if ((preset.description || '').toLowerCase().includes(q)) score = Math.max(score, 25);
    if ((preset.useCase || '').toLowerCase().includes(q)) score = Math.max(score, 20);
    if ((preset.examples || []).some((e) => e.toLowerCase().includes(q))) score = Math.max(score, 10);
    return score;
  }

  function filteredPresets() {
    const q = state.searchQuery.trim().toLowerCase();
    if (q) {
      return allPresets()
        .map((p) => ({ p, score: presetSearchScore(p, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
        .map((x) => x.p);
    }
    let list = allPresets();
    if (state.activeCategory === 'favorites') {
      list = list.filter((p) => state.favorites.includes(p.id));
    } else if (state.activeCategory === 'custom') {
      list = list.filter((p) => p.sourceType === 'custom');
    } else if (state.activeCategory !== 'all') {
      list = list.filter((p) => p.category === state.activeCategory);
    }
    return list;
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  async function init() {
    if (state.inited) { await refreshPageState(); render(); return; }
    state.inited = true;

    try {
      const [presetData, customPresets, favorites, brandTerms] = await Promise.all([
        fetch(chrome.runtime.getURL('libs/gsc-regex/gsc-presets.json')).then((r) => r.json()),
        window.GscStorage.getCustomPresets(),
        window.GscStorage.getFavorites(),
        window.GscStorage.getBrandTerms()
      ]);
      state.builtinPresets = presetData.presets;
      state.categories = presetData.categories;
      state.customPresets = customPresets;
      state.favorites = favorites;
      state.brandTerms = brandTerms;
    } catch (err) {
      console.error('[GSC Regex] failed to load presets', err);
      notify('Could not load the GSC regex preset library.');
      return;
    }

    await refreshPageState();
    wireStaticEvents();
    renderSidebar();
    render();
  }

  async function refreshPageState() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && PERFORMANCE_URL_RE.test(tab.url)) {
        state.activeTabId = tab.id;
        return;
      }
    } catch (_) { /* tabs unavailable */ }
    state.activeTabId = null;
  }

  // ---------------------------------------------------------------------
  // Intent dropdown (replaces category sidebar + yellow banner)
  // ---------------------------------------------------------------------

  function renderSidebar() {
    // Sidebar UI removed — keep Intent select in sync instead
    populateIntentSelect();
  }

  function populateIntentSelect() {
    const sel = $('gsrIntentSelect');
    if (!sel) return;
    const all = allPresets();
    const current = state.activeCategory || 'all';
    const options = [
      { id: 'all', label: 'All intents', count: all.length },
      { id: 'favorites', label: 'Favorites', count: state.favorites.length },
      { id: 'custom', label: 'Custom', count: state.customPresets.length }
    ];
    state.categories.forEach((cat) => {
      const count = all.filter((p) => p.category === cat.id).length;
      options.push({ id: cat.id, label: cat.label, count });
    });
    sel.innerHTML = options
      .map((o) => `<option value="${esc(o.id)}">${esc(o.label)} (${o.count})</option>`)
      .join('');
    if (options.some((o) => o.id === current)) sel.value = current;
    else {
      sel.value = 'all';
      state.activeCategory = 'all';
    }
  }

  function sidebarBtn() {
    // no-op — sidebar removed
    return document.createElement('button');
  }

  // ---------------------------------------------------------------------
  // Main grid / cards
  // ---------------------------------------------------------------------

  function render() {
    const grid = $('gsrGrid');
    const empty = $('gsrEmpty');
    const countEl = $('gsrResultsCount');
    if (!grid || !empty || !countEl) return;

    const presets = filteredPresets();
    countEl.textContent = `${presets.length} preset${presets.length === 1 ? '' : 's'}`;
    grid.innerHTML = '';

    if (!presets.length) {
      empty.textContent = state.searchQuery.trim()
        ? `No presets match "${state.searchQuery.trim()}".`
        : 'No presets in this view yet.';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    presets.forEach((preset) => grid.appendChild(renderCard(preset)));
  }

  function renderCard(preset) {
    const card = document.createElement('article');
    card.className = 'gsr-card';
    card.dataset.id = preset.id;
    const expanded = state.expandedId === preset.id;
    const isFav = state.favorites.includes(preset.id);

    const hasPlaceholder = window.GscRegexUtil.hasPlaceholder(preset.regex);
    const resolved = resolvedRegexFor(preset);
    const needsBrand = hasPlaceholder && !resolved;
    const applyDisabledAttr = needsBrand
      ? 'disabled title="Expand and set your brand name(s) first"'
      : (state.activeTabId ? '' : 'title="Open a Performance report tab first"');

    card.innerHTML = `
      <div class="gsr-card-top">
        <div class="gsr-card-icon">${icon(categoryIcon(preset.category), { size: 13 })}</div>
        <div class="gsr-card-titleblock">
          <span class="gsr-card-name">${esc(preset.name)}</span>
          <span class="gsr-card-meta">${esc(categoryLabel(preset.category))}${preset.difficulty ? ' · ' + esc(preset.difficulty) : ''}</span>
        </div>
        <button type="button" class="gsr-card-fav ${isFav ? 'is-active' : ''}" data-action="favorite" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${icon('star', { size: 15, filled: isFav })}</button>
      </div>
      <p class="gsr-card-desc">${esc(preset.description || '')}</p>
      <div class="gsr-card-actions">
        <button type="button" class="gsr-btn gsr-btn--primary gsr-btn--small" data-action="apply" ${applyDisabledAttr}>${icon('external', { size: 12 })}Apply in GSC</button>
        <button type="button" class="gsr-btn gsr-btn--ghost gsr-btn--small" data-action="expand">${expanded ? 'Hide' : 'Details'}</button>
      </div>
      <div class="gsr-card-details" ${expanded ? '' : 'hidden'}>${expanded ? renderDetails(preset) : ''}</div>
    `;

    card.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (btn) {
        if (btn.disabled) return;
        handleAction(btn.dataset.action, preset, btn);
      }
    });

    if (expanded) wireDetails(card, preset);
    return card;
  }

  function renderDetails(preset) {
    const hasPlaceholder = window.GscRegexUtil.hasPlaceholder(preset.regex);
    const resolved = resolvedRegexFor(preset);
    const brandVal = state.brandTerms.join(', ');
    const examples = (preset.examples || []).map((e) => `<li>${esc(e)}</li>`).join('');
    const hasNotes = preset.notes && preset.notes.trim() && preset.notes.trim() !== 'None.';

    return `
      ${hasPlaceholder ? `
        <div>
          <div class="gsr-label">Your brand name(s), comma-separated</div>
          <input type="text" class="gsr-brand-input" data-brand-input value="${esc(brandVal)}" placeholder="e.g. Acme, Acme Inc" />
        </div>
      ` : ''}
      <div>
        <div class="gsr-label">Regex</div>
        <div class="gsr-regex-box" data-regex-preview>${resolved ? esc(resolved) : 'Set your brand name(s) above to generate the regex.'}</div>
      </div>
      ${examples ? `<div><div class="gsr-label">Example</div><ul class="gsr-examples">${examples}</ul></div>` : ''}
      ${preset.useCase ? `<div><div class="gsr-label">SEO use case</div><p class="gsr-usecase">${esc(preset.useCase)}</p></div>` : ''}
      ${hasNotes ? `<div><div class="gsr-label">Notes</div><p class="gsr-usecase">${esc(preset.notes)}</p></div>` : ''}
      ${(preset.tags && preset.tags.length) ? `<div class="gsr-tags">${preset.tags.map((t) => `<span class="gsr-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      <div>
        <div class="gsr-label">Test a sample query</div>
        <div class="gsr-tester">
          <input type="text" data-mini-tester placeholder="Try a sample query…" />
          <div class="gsr-tester-result" data-mini-tester-result></div>
        </div>
      </div>
      <div class="gsr-card-actions">
        <div class="gsr-card-icon-actions">
          <button type="button" class="gsr-icon-btn" data-action="copy" title="Copy regex">${icon('copy', { size: 13 })}</button>
          ${preset.sourceType === 'custom' ? `
            <button type="button" class="gsr-icon-btn" data-action="edit" title="Edit preset">${icon('pencil', { size: 13 })}</button>
            <button type="button" class="gsr-icon-btn gsr-icon-btn--danger" data-action="delete" title="Delete preset">${icon('trash', { size: 13 })}</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  function wireDetails(card, preset) {
    const brandInput = qs('[data-brand-input]', card);
    if (brandInput) {
      brandInput.addEventListener('input', () => {
        const terms = brandInput.value.split(',').map((t) => t.trim()).filter(Boolean);
        const preview = resolvedRegexFor(preset, terms);
        const box = qs('[data-regex-preview]', card);
        if (box) box.textContent = preview || 'Set your brand name(s) above to generate the regex.';
        qsa('[data-action="apply"], [data-action="copy"]', card).forEach((b) => { b.disabled = !preview; });
      });
      brandInput.addEventListener('change', async () => {
        const terms = brandInput.value.split(',').map((t) => t.trim()).filter(Boolean);
        state.brandTerms = await window.GscStorage.saveBrandTerms(terms);
        render();
      });
    }

    const tester = qs('[data-mini-tester]', card);
    if (tester) {
      tester.addEventListener('input', () => {
        const resultEl = qs('[data-mini-tester-result]', card);
        const sample = tester.value;
        const regex = resolvedRegexFor(preset);
        if (!resultEl) return;
        if (!sample) { resultEl.innerHTML = ''; return; }
        if (!regex) { resultEl.textContent = 'Set your brand name(s) above first.'; return; }
        const result = window.GscRegexUtil.test(regex, sample);
        if (result.error) {
          resultEl.textContent = `Invalid regex: ${result.error}`;
        } else if (result.matched) {
          resultEl.innerHTML = `${icon('check', { size: 12 })}<span class="icon--ok">Match</span> — ${window.GscRegexUtil.highlight(sample, result.spans)}`;
        } else {
          resultEl.innerHTML = `${icon('x', { size: 12 })}No match`;
        }
      });
    }
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  async function withLoading(btn, fn) {
    if (!btn) return fn();
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>' + original.replace(/<svg[\s\S]*?<\/svg>/, '');
    try { return await fn(); }
    finally { btn.disabled = false; btn.innerHTML = original; }
  }

  async function handleAction(action, preset, btn) {
    switch (action) {
      case 'apply':
        await withLoading(btn, () => applyInGsc(preset));
        break;
      case 'copy':
        await copyPreset(preset);
        break;
      case 'favorite': {
        const nowFav = await window.GscStorage.toggleFavorite(preset.id);
        state.favorites = await window.GscStorage.getFavorites();
        notify(nowFav ? 'Added to favorites.' : 'Removed from favorites.');
        render();
        renderSidebar();
        break;
      }
      case 'expand':
        state.expandedId = state.expandedId === preset.id ? null : preset.id;
        render();
        break;
      case 'edit':
        openPresetEditor(preset);
        break;
      case 'delete':
        if (confirm(`Delete preset "${preset.name}"? This cannot be undone.`)) {
          state.customPresets = await window.GscStorage.deleteCustomPreset(preset.id);
          notify('Preset deleted.');
          render();
          renderSidebar();
        }
        break;
    }
  }

  /**
   * Drives the live Search Console tab's filter UI end to end via the
   * content script (content/gsc/gsc-bridge.js + gsc-filter.js). Fire and
   * forget: the content script acknowledges immediately and reports all
   * further progress via toasts on the Search Console page itself.
   */
  async function applyInGsc(preset) {
    const regex = resolvedRegexFor(preset);
    if (!regex) { notify('Set your brand name(s) on this preset first.'); return; }
    await refreshPageState();
    if (!state.activeTabId) {
      notify('Open a property\'s Performance report in Search Console first.');
      return;
    }
    try {
      const response = await chrome.tabs.sendMessage(state.activeTabId, {
        type: 'SCQT_OPEN_GSC_FILTER',
        regex
      });
      if (response && response.ok) {
        notify('Applying filter in Search Console — check that tab.');
      } else {
        notify('Could not start the filter flow.');
      }
    } catch (_) {
      notify('Could not reach the Search Console tab. Reload the page and try again.');
    }
  }

  async function copyPreset(preset) {
    const regex = resolvedRegexFor(preset);
    if (!regex) { notify('Set your brand name(s) on this preset first.'); return; }
    if (typeof window.copyText === 'function') { window.copyText(regex); return; }
    try {
      await navigator.clipboard.writeText(regex);
      notify('Regex copied to clipboard.');
    } catch (_) {
      notify('Clipboard permission denied.');
    }
  }

  // ---------------------------------------------------------------------
  // Custom preset editor (simple modal, self-contained)
  // ---------------------------------------------------------------------

  function openPresetEditor(preset) {
    const isEdit = Boolean(preset);
    const draft = preset
      ? Object.assign({}, preset)
      : { id: uid('custom'), name: '', regex: '', category: (state.categories[0] && state.categories[0].id) || 'informational', description: '' };

    const categoryOptions = state.categories.map((c) =>
      `<option value="${c.id}" ${draft.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'gsr-modal-overlay';
    overlay.innerHTML = `
      <div class="gsr-modal" role="dialog" aria-modal="true">
        <h3>${isEdit ? 'Edit Preset' : 'New Preset'}</h3>
        <div class="gsr-modal-field">
          <label>Name</label>
          <input type="text" id="gsrPresetName" value="${esc(draft.name)}" />
        </div>
        <div class="gsr-modal-field">
          <label>Category</label>
          <select id="gsrPresetCategory">${categoryOptions}</select>
        </div>
        <div class="gsr-modal-field">
          <label>Regex</label>
          <input type="text" id="gsrPresetRegex" value="${esc(draft.regex)}" />
          <div class="gsr-modal-lint" id="gsrPresetLint" hidden></div>
        </div>
        <div class="gsr-modal-field">
          <label>Description</label>
          <textarea id="gsrPresetDesc" rows="2">${esc(draft.description)}</textarea>
        </div>
        <div class="gsr-modal-actions">
          <button type="button" class="gsr-btn gsr-btn--ghost gsr-btn--small" data-action="cancel">Cancel</button>
          <button type="button" class="gsr-btn gsr-btn--primary gsr-btn--small" data-action="save">Save Preset</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const regexInput = qs('#gsrPresetRegex', overlay);
    regexInput.addEventListener('input', () => {
      const warnings = window.GscRegexUtil.lintForRE2(regexInput.value);
      const lintEl = qs('#gsrPresetLint', overlay);
      if (warnings.length) {
        lintEl.hidden = false;
        lintEl.innerHTML = warnings.map(esc).join('<br>');
      } else {
        lintEl.hidden = true;
      }
    });

    qs('[data-action="cancel"]', overlay).addEventListener('click', close);
    qs('[data-action="save"]', overlay).addEventListener('click', async () => {
      const name = qs('#gsrPresetName', overlay).value.trim();
      const regex = qs('#gsrPresetRegex', overlay).value.trim();
      const category = qs('#gsrPresetCategory', overlay).value;
      const description = qs('#gsrPresetDesc', overlay).value.trim();

      if (!name || !regex) { notify('Name and regex are required.'); return; }
      const compiled = window.GscRegexUtil.tryCompile(regex);
      if (!compiled.ok) { notify(`Invalid regex: ${compiled.error}`); return; }

      draft.name = name;
      draft.regex = regex;
      draft.category = category;
      draft.description = description;

      await window.GscStorage.saveCustomPreset(draft);
      state.customPresets = await window.GscStorage.getCustomPresets();
      close();
      renderSidebar();
      render();
      notify('Preset saved.');
    });
  }

  // ---------------------------------------------------------------------
  // Static events (search box, new-preset button)
  // ---------------------------------------------------------------------

  function wireStaticEvents() {
    const search = $('gsrSearchInput');
    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        render();
      });
    }
    const newBtn = $('gsrNewPresetBtn');
    if (newBtn && !newBtn.dataset.bound) {
      newBtn.dataset.bound = '1';
      newBtn.addEventListener('click', () => openPresetEditor(null));
    }
    const intentSel = $('gsrIntentSelect');
    if (intentSel && !intentSel.dataset.bound) {
      intentSel.dataset.bound = '1';
      intentSel.addEventListener('change', (e) => {
        state.activeCategory = e.target.value || 'all';
        render();
      });
    }
  }

  // Exposed for popup.js's switchTab() to call when the tab is opened.
  window.initGscRegexTab = init;
})();
