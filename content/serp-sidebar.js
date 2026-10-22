// ShahzaibSEO SERP Sidebar Panel
// Injects a feature-rich panel into Google's right column
(function () {
  'use strict';

  if (window.__rankseoSidebarLoaded) return;
  window.__rankseoSidebarLoaded = true;

  const host = location.hostname;
  const isGoogle = host.includes('google.');
  if (!isGoogle || !location.pathname.startsWith('/search')) return;

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function getQuery() {
    return new URLSearchParams(location.search).get('q') || '';
  }

  // Only the standard web ("All") results page should show the sidebar.
  // Google's Images / Videos / News / Forums / Shopping / Short-video tabs are
  // selected with a `udm` parameter (e.g. Images = udm=2) or the legacy `tbm`
  // parameter. We allow the page only when neither indicates a vertical tab:
  //   - no `udm`          → the default "All" tab
  //   - udm=14            → the "Web" tab (same organic results)
  //   - any other `udm`   → a vertical tab (suppress)
  //   - any `tbm`         → a legacy vertical filter (suppress)
  // NOTE: Google controls these parameter values and has changed them before,
  // so verify behaviour on each tab after installing.
  function isWebResultsPage() {
    const params = new URLSearchParams(location.search);
    if (params.get('tbm')) return false;
    const udm = params.get('udm');
    if (udm && udm !== '14') return false;
    return true;
  }

  // Remove anything this extension injected (never touches Google's own #rhs).
  function removeSidebar() {
    ['rs-sidebar', 'rs-sidebar-toggle', 'rs-sidebar-host', 'rs-kw-line'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  function fmtNum(n) {
    if (!n || n <= 0) return '--';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function daColor(da) {
    if (!da || da <= 0) return '#94a3b8';
    if (da >= 71) return '#16a34a';
    if (da >= 51) return '#ca8a04';
    if (da >= 31) return '#ea580c';
    return '#dc2626';
  }

  function spamColor(s) {
    if (s >= 8) return '#dc2626';
    if (s >= 4) return '#ea580c';
    return '#16a34a';
  }

  function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '…' : str;
  }

  // ─── CSS ──────────────────────────────────────────────────────────────────
  if (!document.getElementById('rs-sidebar-style')) {
    const st = document.createElement('style');
    st.id = 'rs-sidebar-style';
    st.textContent = `
      #rs-sidebar-host::-webkit-scrollbar { width: 4px; }
      #rs-sidebar-host::-webkit-scrollbar-track { background: #f8fafc; }
      #rs-sidebar-host::-webkit-scrollbar-thumb { background: #c7d2fe; border-radius: 2px; }
      #rs-sidebar-toggle {
        position: fixed;
        top: 116px;
        right: 8px;
        z-index: 2147483601;
        width: 26px;
        height: 26px;
        background: #0D9488;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        box-shadow: 0 2px 8px rgba(13,148,136,0.4);
        line-height: 1;
      }
      #rs-sidebar-toggle:hover { background: #0f766e; }
      #rs-sidebar {
        width: 100%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        font-size: 13px;
        color: #1e293b;
        margin-bottom: 16px;
      }
      .rs-panel {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        margin-bottom: 10px;
        overflow: hidden;
      }
      .rs-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        cursor: pointer;
        user-select: none;
      }
      .rs-panel-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #0D9488;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .rs-panel-title svg {
        width: 14px; height: 14px; flex-shrink: 0;
      }
      .rs-panel-toggle {
        font-size: 10px;
        color: #94a3b8;
        transition: transform 0.2s;
      }
      .rs-panel-toggle.open { transform: rotate(180deg); }
      .rs-panel-body {
        padding: 12px 14px;
      }
      .rs-panel-body.collapsed { display: none; }

      /* Keyword Overview */
      .rs-kw-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
        margin-bottom: 10px;
      }
      .rs-kw-stat {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 8px 10px;
      }
      .rs-kw-stat-label {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #94a3b8;
        margin-bottom: 3px;
      }
      .rs-kw-stat-val {
        font-size: 15px;
        font-weight: 700;
        color: #1e293b;
      }
      .rs-kw-stat-val.green { color: #16a34a; }
      .rs-kw-stat-val.amber { color: #ca8a04; }
      .rs-kw-stat-val.red   { color: #dc2626; }
      .rs-kw-fav-row {
        display: flex; align-items: center; gap: 8px; margin-top: 10px;
      }
      .rs-kw-fav-btn {
        flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        padding: 7px 10px; border-radius: 8px; border: 1px solid #e2e8f0;
        background: #fff; color: #0f766e; font-size: 11px; font-weight: 600;
        cursor: pointer; transition: background .15s, border-color .15s;
      }
      .rs-kw-fav-btn:hover { background: #f0fdfa; border-color: #99f6e4; }
      .rs-kw-fav-btn.saved { background: #f0fdfa; border-color: #0d9488; color: #0f766e; }
      .rs-fav-list { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
      .rs-fav-row {
        display: flex; align-items: center; gap: 6px; padding: 6px 8px;
        border-radius: 6px; background: #f8fafc; border: 1px solid #e2e8f0;
      }
      .rs-fav-row:hover { background: #f1f5f9; }
      .rs-fav-kw { flex: 1; font-size: 12px; font-weight: 600; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rs-fav-vol { font-size: 11px; color: #64748b; font-variant-numeric: tabular-nums; }
      .rs-fav-act {
        border: none; background: transparent; cursor: pointer; font-size: 12px;
        color: #94a3b8; padding: 2px 4px; border-radius: 4px;
      }
      .rs-fav-act:hover { color: #0f766e; background: #e2e8f0; }
      .rs-fav-empty { font-size: 11px; color: #94a3b8; padding: 8px 0; text-align: center; }
      .rs-kd-bar {
        height: 6px;
        background: #e2e8f0;
        border-radius: 3px;
        margin-top: 10px;
        overflow: hidden;
      }
      .rs-kd-fill {
        height: 100%;
        border-radius: 3px;
        background: linear-gradient(90deg, #0D9488, #14b8a6);
        transition: width 0.6s ease;
      }
      .rs-kd-label {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #64748b;
        margin-top: 4px;
      }
      .rs-related-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 6px;
      }
      .rs-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 20px;
        font-size: 10.5px;
        color: #475569;
        cursor: pointer;
        transition: background 0.15s;
      }
      .rs-tag:hover { background: #e0e7ff; color: #4338ca; border-color: #c7d2fe; }
      .rs-tag-copy {
        font-size: 9px;
        color: #94a3b8;
      }

      /* Competitor table */
      .rs-comp-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .rs-comp-table th {
        text-align: left;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #94a3b8;
        padding: 0 4px 6px 0;
        border-bottom: 1px solid #e2e8f0;
      }
      .rs-comp-table th.right { text-align: right; }
      .rs-comp-table td {
        padding: 5px 4px 5px 0;
        border-bottom: 1px solid #f1f5f9;
        vertical-align: middle;
      }
      .rs-comp-table tr:last-child td { border-bottom: none; }
      .rs-rank-num {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #0D9488;
        color: #fff;
        font-size: 9px;
        font-weight: 700;
        flex-shrink: 0;
      }
      .rs-domain-cell {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
      }
      .rs-domain-name {
        font-size: 11px;
        font-weight: 600;
        color: #334155;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 90px;
      }
      .rs-val-cell {
        font-weight: 700;
        text-align: right;
        font-size: 11px;
      }
      .rs-loading-row {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #94a3b8;
        font-size: 11px;
        padding: 6px 0;
      }
      @keyframes rs-spin2 { to { transform: rotate(360deg); } }
      .rs-spin {
        width: 11px; height: 11px;
        border: 1.5px solid #e2e8f0;
        border-top-color: #0D9488;
        border-radius: 50%;
        animation: rs-spin2 0.7s linear infinite;
        flex-shrink: 0;
      }

      /* ── Niche Opportunity Card Redesign ───────────────────────── */
      #rs-niche-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .rs-niche-verdict-card {
        border-radius: 10px;
        padding: 10px 12px;
      }
      .rs-niche-verdict-top {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .rs-niche-verdict-emoji-wrap {
        width: 34px;
        height: 34px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .rs-niche-verdict-emoji {
        font-size: 18px;
        line-height: 1;
      }
      .rs-niche-verdict-label {
        font-size: 13px;
        font-weight: 800;
        line-height: 1.2;
        letter-spacing: -0.01em;
      }
      .rs-niche-verdict-sub {
        font-size: 10px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .rs-niche-chips {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
      }
      .rs-niche-chip {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 7px 8px;
      }
      .rs-niche-chip-label {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #94a3b8;
        margin-bottom: 3px;
      }
      .rs-niche-chip-val {
        font-size: 14px;
        font-weight: 800;
        line-height: 1;
        display: flex;
        align-items: baseline;
        gap: 3px;
      }
      .rs-niche-chip-note {
        font-size: 9px;
        font-weight: 500;
        color: #94a3b8;
      }
      /* RankSpy-style score card + metric tiles */
      .rs-niche-score-card {
        border-radius: 10px;
        padding: 11px 13px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .rs-niche-score-left { display: flex; align-items: center; gap: 9px; }
      .rs-niche-score-emoji { font-size: 20px; line-height: 1; }
      .rs-niche-score-label { font-size: 14px; font-weight: 800; line-height: 1.15; letter-spacing: -0.01em; }
      .rs-niche-score-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
      .rs-niche-score-num { font-size: 30px; font-weight: 800; line-height: 1; letter-spacing: -0.02em; flex-shrink: 0; }
      .rs-niche-tiles {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
      }
      .rs-niche-tile {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 7px 4px;
        text-align: center;
      }
      .rs-niche-tile-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-bottom: 3px; white-space: nowrap; }
      .rs-niche-tile-val { font-size: 15px; font-weight: 800; line-height: 1; color: #1e293b; }
      .rs-niche-tile-sub { font-size: 8px; color: #94a3b8; margin-top: 2px; }
      .rs-niche-section-title { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #7c3aed; margin-bottom: 1px; }
      .rs-niche-reasons {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding-top: 6px;
        border-top: 1px solid #f1f5f9;
      }
      .rs-niche-reason {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        font-size: 11px;
        color: #475569;
        line-height: 1.45;
      }
      .rs-niche-reason-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 5px;
        flex-shrink: 0;
        margin-top: 1px;
      }
      .rs-niche-reason-text {
        flex: 1;
      }
      .rs-niche-bc-card {
        background: #faf5ff;
        border: 1.5px solid #e9d5ff;
        border-radius: 9px;
        padding: 9px 10px;
      }
      .rs-niche-bc-header {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #7c3aed;
        margin-bottom: 5px;
      }
      .rs-niche-bc-domain {
        font-size: 12px;
        font-weight: 700;
        color: #1e293b;
        margin-bottom: 5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rs-niche-bc-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .rs-niche-bc-pill {
        font-size: 10px;
        font-weight: 600;
        color: #6d28d9;
        background: #ede9fe;
        border: 1px solid #ddd6fe;
        border-radius: 20px;
        padding: 2px 7px;
      }
      /* ── End Niche Card ─────────────────────────────────────────── */

      /* AI Analyzer */
      .rs-ai-query {
        font-size: 11px;
        color: #64748b;
        font-style: italic;
        margin-bottom: 10px;
        padding: 6px 8px;
        background: #f8fafc;
        border-radius: 6px;
        border-left: 3px solid #6366f1;
      }
      .rs-ai-section {
        margin-bottom: 10px;
      }
      .rs-ai-section-title {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #0D9488;
        margin-bottom: 5px;
      }
      .rs-ai-item {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 11.5px;
        color: #374151;
        margin-bottom: 4px;
        line-height: 1.5;
      }
      .rs-ai-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        margin-top: 5px;
        flex-shrink: 0;
        background: #0D9488;
      }
      .rs-ai-dot.green { background: #16a34a; }
      .rs-ai-dot.amber { background: #ca8a04; }
      .rs-ai-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-top: 8px;
        padding: 6px 12px;
        background: #0D9488;
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        width: 100%;
        justify-content: center;
        transition: background 0.15s;
      }
      .rs-ai-btn:hover { background: #4f46e5; }
      .rs-ai-loading {
        text-align: center;
        padding: 16px 0;
        color: #0D9488;
        font-size: 12px;
      }

      /* Rank Tracker */
      .rs-rank-input-row {
        display: flex;
        gap: 6px;
        margin-bottom: 10px;
      }
      .rs-rank-input {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        font-size: 12px;
        color: #1e293b;
        outline: none;
        background: #f8fafc;
      }
      .rs-rank-input:focus { border-color: #0D9488; background: #fff; }
      .rs-rank-btn {
        padding: 6px 10px;
        background: #0D9488;
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .rs-rank-btn:hover { background: #4f46e5; }
      .rs-rank-clear {
        padding: 6px 9px;
        background: #fff;
        color: #ef4444;
        border: 1px solid #fecaca;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        white-space: nowrap;
        display: none;
      }
      .rs-rank-clear:hover { background: #fef2f2; border-color: #ef4444; }
      .rs-rank-clear.show { display: inline-block; }
      .rs-rank-saved {
        font-size: 10px;
        color: #0d9488;
        margin: -4px 0 8px;
        display: none;
      }
      .rs-rank-saved.show { display: block; }
      .rs-rank-result {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .rs-rank-result.not-found {
        background: #fef2f2;
        border-color: #fecaca;
      }
      .rs-rank-big {
        font-size: 28px;
        font-weight: 800;
        color: #16a34a;
        line-height: 1;
      }
      .rs-rank-big.not-found { color: #dc2626; font-size: 14px; }
      .rs-rank-info { flex: 1; }
      .rs-rank-domain { font-size: 12px; font-weight: 600; color: #166534; }
      .rs-rank-sub { font-size: 10px; color: #64748b; margin-top: 2px; }

      /* ── AI Overview / PAA / Brief / Cannibalization ── */
      .rs-aio-badge { font-size: 11px; font-weight: 600; padding: 6px 9px; border-radius: 6px; margin-bottom: 5px; }
      .rs-aio-yes { background: #ecfeff; color: #0e7490; border: 1px solid #a5f3fc; }
      .rs-aio-none { background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; }
      .rs-aio-cited { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
      .rs-aio-notcited { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
      .rs-aio-srctitle { font-size: 10px; font-weight: 700; color: #475569; margin: 8px 0 4px; text-transform: uppercase; letter-spacing: .04em; }
      .rs-aio-src { display: flex; align-items: center; gap: 7px; padding: 3px 0; font-size: 11px; }
      .rs-aio-num { width: 16px; height: 16px; flex: 0 0 16px; background: #0D9488; color: #fff; border-radius: 50%; font-size: 9px; display: flex; align-items: center; justify-content: center; font-weight: 700; }
      .rs-aio-src a { color: #0f766e; text-decoration: none; word-break: break-all; }
      .rs-aio-src a:hover { text-decoration: underline; }

      .rs-paa-count { font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 7px; }
      .rs-paa-q { font-size: 11px; color: #1e293b; padding: 6px 9px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 5px; line-height: 1.4; }

      .rs-brief-sec { margin-bottom: 10px; }
      .rs-brief-h { font-size: 10px; font-weight: 700; color: #0D9488; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
      .rs-brief-p { font-size: 11px; color: #1e293b; }
      .rs-brief-q { font-size: 11px; color: #334155; padding: 4px 8px; background: #f8fafc; border-left: 2px solid #0D9488; border-radius: 0 4px 4px 0; margin-bottom: 4px; line-height: 1.4; }
      .rs-brief-chips { display: flex; flex-wrap: wrap; gap: 4px; }
      .rs-brief-chip { font-size: 10px; color: #0f766e; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 10px; padding: 2px 8px; }

      .rs-cann-ok { font-size: 11px; color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 7px 9px; }
      .rs-cann-warn { font-size: 11px; font-weight: 600; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 7px 9px; margin-bottom: 6px; line-height: 1.4; }
      .rs-cann-url { font-size: 10px; padding: 3px 0; }
      .rs-cann-url a { color: #0f766e; text-decoration: none; word-break: break-all; }
      .rs-cann-url a:hover { text-decoration: underline; }

      .rs-rank-trend { margin-top: 10px; padding: 8px 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
      .rs-trend-head { font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
      .rs-trend-vals { font-size: 10px; color: #64748b; margin-top: 4px; font-variant-numeric: tabular-nums; }

      /* ── My Site Gap Panel ── */
      .rs-mygap-domain-row {
        display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
      }
      .rs-mygap-input {
        flex: 1; padding: 5px 8px; border: 1px solid #c7d2fe; border-radius: 6px;
        font-size: 11px; color: #1e293b; outline: none;
      }
      .rs-mygap-input:focus { border-color: #0D9488; }
      .rs-mygap-btn {
        padding: 5px 10px; background: #0D9488; color: #fff; border: none;
        border-radius: 6px; font-size: 10px; font-weight: 700; cursor: pointer;
        white-space: nowrap;
      }
      .rs-mygap-btn:hover { background: #4f46e5; }
      .rs-mygap-row {
        margin-bottom: 9px;
      }
      .rs-mygap-label-row {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 10px; color: #64748b; margin-bottom: 3px; font-weight: 600;
      }
      .rs-mygap-bar-wrap {
        position: relative; background: #f1f5f9; border-radius: 4px;
        height: 7px; overflow: visible;
      }
      .rs-mygap-bar-you {
        position: absolute; left: 0; top: 0; height: 7px; border-radius: 4px;
        background: #0D9488; transition: width 0.5s;
      }
      .rs-mygap-bar-them {
        position: absolute; left: 0; top: 0; height: 7px; border-radius: 4px;
        background: #e2e8f0; transition: width 0.5s;
      }
      .rs-mygap-score-box {
        background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
        padding: 8px 10px; margin-top: 8px; font-size: 10.5px;
      }
      .rs-mygap-score-title { font-weight: 700; color: #1e293b; margin-bottom: 4px; }
      .rs-mygap-fix-item {
        display: flex; align-items: flex-start; gap: 5px; padding: 3px 0;
        font-size: 10px; color: #374151; border-bottom: 1px solid #f1f5f9;
      }
      .rs-mygap-fix-item:last-child { border-bottom: none; }
      .rs-mygap-fix-dot {
        width: 6px; height: 6px; border-radius: 50%; background: #f59e0b;
        margin-top: 3px; flex-shrink: 0;
      }
      .rs-mygap-fix-dot.red { background: #dc2626; }
      .rs-mygap-fix-dot.green { background: #16a34a; }

      /* ── Competitor Keywords Panel ── */
      .rs-ckw-domain-item {
        border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 8px;
        overflow: hidden;
      }
      .rs-ckw-domain-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 7px 10px; background: #f8fafc; cursor: pointer;
      }
      .rs-ckw-domain-name { font-size: 11px; font-weight: 700; color: #334155; }
      .rs-ckw-rank-badge {
        font-size: 9px; font-weight: 700; color: #fff; background: #0D9488;
        border-radius: 10px; padding: 1px 6px;
      }
      .rs-ckw-body { padding: 8px 10px; display: none; }
      .rs-ckw-body.open { display: block; }
      .rs-ckw-kw-pill {
        display: inline-block; padding: 2px 7px; margin: 2px;
        background: #ede9fe; color: #4c1d95; border-radius: 10px;
        font-size: 9.5px; font-weight: 600; cursor: pointer;
      }
      .rs-ckw-kw-pill:hover { background: #c4b5fd; }
      .rs-ckw-links { margin-top: 6px; display: flex; gap: 5px; flex-wrap: wrap; }
      .rs-ckw-link-btn {
        padding: 3px 7px; font-size: 9px; font-weight: 700; border-radius: 4px;
        text-decoration: none; color: #fff;
      }
      .rs-ckw-link-btn.semrush { background: #ff6b23; }
      .rs-ckw-link-btn.ahrefs  { background: #2563eb; }
      .rs-ckw-link-btn.ubersug { background: #16a34a; }
      .rs-ckw-title-kws { margin-top: 5px; }
      .rs-ckw-title-label { font-size: 9px; color: #94a3b8; font-weight: 600;
        text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }

      /* Backlink gap */
      .rs-gap-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 5px 0;
        border-bottom: 1px solid #f1f5f9;
        font-size: 11px;
      }
      .rs-gap-item:last-child { border-bottom: none; }
      .rs-gap-domain { color: #334155; font-weight: 600; }
      .rs-gap-rd { color: #0D9488; font-weight: 700; font-size: 12px; }
      .rs-gap-note { font-size: 9.5px; color: #94a3b8; }

      /* SERP features */
      .rs-feature-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .rs-feature-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 20px;
        font-size: 10px;
        font-weight: 600;
        border: 1px solid;
      }
      .rs-feature-chip.present { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
      .rs-feature-chip.absent  { background: #f8fafc; color: #94a3b8; border-color: #e2e8f0; }

      /* Shared keyword suggestions */
      .rs-related-input-row {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
      }
      .rs-copy-all {
        font-size: 10px;
        color: #0D9488;
        cursor: pointer;
        text-decoration: underline;
        text-align: right;
        margin-top: 4px;
        display: block;
      }
      .rs-toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #1e293b;
        color: #fff;
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 12px;
        z-index: 999999;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s;
      }
      .rs-toast.show { opacity: 1; }

      /* ── International SERP Checker ── */
      .rs-intl-form { display: flex; flex-direction: column; gap: 8px; }
      .rs-intl-label { font-size: 10px; font-weight: 700; color: #0D9488; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 2px; }
      .rs-intl-input {
        width: 100%; box-sizing: border-box;
        padding: 7px 10px; border: 1.5px solid #e2e8f0; border-radius: 7px;
        font-size: 11px; color: #1e293b; background: #fff;
        outline: none; transition: border-color .2s;
      }
      .rs-intl-input:focus { border-color: #0D9488; }
      .rs-intl-select {
        width: 100%; box-sizing: border-box;
        padding: 7px 10px; border: 1.5px solid #e2e8f0; border-radius: 7px;
        font-size: 11px; color: #1e293b; background: #fff;
        outline: none; cursor: pointer;
      }
      .rs-intl-btn {
        width: 100%; padding: 8px; border: none; border-radius: 7px;
        background: linear-gradient(135deg, #0D9488, #14b8a6);
        color: #fff; font-size: 11px; font-weight: 700;
        cursor: pointer; letter-spacing: .2px;
        transition: opacity .2s;
      }
      .rs-intl-btn:hover { opacity: .9; }
      .rs-intl-btn:disabled { opacity: .6; cursor: not-allowed; }

      /* ── Export Top 100 SERP ── */
      .rs-export-form { display: flex; flex-direction: column; gap: 8px; }
      .rs-export-btn {
        width: 100%; padding: 8px; border: none; border-radius: 7px;
        background: linear-gradient(135deg, #10b981, #059669);
        color: #fff; font-size: 11px; font-weight: 700;
        cursor: pointer; transition: opacity .2s;
      }
      .rs-export-btn:hover { opacity: .9; }
      .rs-export-btn:disabled { opacity: .6; cursor: not-allowed; }
      .rs-export-progress {
        padding: 8px 10px; background: #f0fdf4; border-radius: 7px;
        border: 1px solid #bbf7d0; font-size: 10px; color: #166534;
        display: none;
      }
      .rs-export-bar-wrap {
        height: 5px; background: #d1fae5; border-radius: 4px; margin-top: 5px; overflow: hidden;
      }
      .rs-export-bar {
        height: 100%; background: #10b981; border-radius: 4px;
        transition: width .3s; width: 0%;
      }
      .rs-export-note {
        font-size: 9.5px; color: #94a3b8; margin-top: 4px; line-height: 1.4;
      }

      /* ── Easy-Win Stats (Lowest DR / Lowest Age) ───────────────────── */
      .rs-stats-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .rs-stat-card {
        background: linear-gradient(135deg,#f0fdfa,#ecfeff);
        border: 1px solid #ccfbf1;
        border-radius: 10px;
        padding: 10px 12px;
      }
      .rs-stat-card.warn {
        background: linear-gradient(135deg,#fef9c3,#fef3c7);
        border-color: #fde68a;
      }
      .rs-stat-label {
        display: flex; align-items: center; gap: 5px;
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .04em; color: #0f766e; margin-bottom: 3px;
      }
      .rs-stat-card.warn .rs-stat-label { color: #b45309; }
      .rs-stat-val {
        font-size: 20px; font-weight: 800; color: #0f172a; line-height: 1.1;
      }
      .rs-stat-sub {
        font-size: 10px; color: #64748b; margin-top: 2px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .rs-stat-hint {
        margin-top: 8px; font-size: 10.5px; line-height: 1.45;
        color: #475569; background: #f8fafc; border-radius: 8px;
        padding: 7px 9px; border: 1px solid #f1f5f9;
      }
      .rs-stat-hint b { color: #0f766e; }

      /* ── Keyword Ideas (Related + Questions) ───────────────────────── */
      .rs-ideas-section + .rs-ideas-section { margin-top: 14px; }
      .rs-ideas-head {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 6px;
      }
      .rs-ideas-head-label {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .05em; color: #94a3b8;
      }
      .rs-ideas-copy {
        font-size: 10px; font-weight: 700; color: #0D9488; cursor: pointer;
      }
      .rs-ideas-copy:hover { color: #0f766e; text-decoration: underline; }
      .rs-ideas-list { display: flex; flex-direction: column; }
      .rs-idea-row {
        display: flex; align-items: center; justify-content: space-between;
        gap: 6px; padding: 7px 2px; border-bottom: 1px solid #f1f5f9;
        cursor: pointer;
      }
      .rs-idea-row:last-child { border-bottom: none; }
      .rs-idea-row:hover { background: #f8fafc; }
      .rs-idea-text {
        font-size: 12px; color: #334155; line-height: 1.3;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .rs-idea-row:hover .rs-idea-text { color: #0f766e; }
      .rs-idea-go {
        font-size: 9px; font-weight: 700; color: #c7d2fe;
        flex-shrink: 0; opacity: 0; transition: opacity .15s;
      }
      .rs-idea-row:hover .rs-idea-go { opacity: 1; color: #0D9488; }

      /* ── Settings / Quick Filters ──────────────────────────────────── */
      .rs-set-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 0; border-bottom: 1px solid #f1f5f9;
      }
      .rs-set-row:last-of-type { border-bottom: none; }
      .rs-set-label { font-size: 12px; color: #334155; font-weight: 500; }
      .rs-set-hint{font-size:10px;color:#94a3b8;margin:0 0 8px;line-height:1.35}.rs-set-sub {
        font-size: 10px; color: #94a3b8; font-weight: 700;
        text-transform: uppercase; letter-spacing: .05em; margin: 4px 0 2px;
      }
      .rs-switch {
        position: relative; width: 38px; height: 20px; flex-shrink: 0;
        border-radius: 999px; background: #cbd5e1; cursor: pointer;
        transition: background .2s;
      }
      .rs-switch.on { background: #0D9488; }
      .rs-switch::after {
        content: ''; position: absolute; top: 2px; left: 2px;
        width: 16px; height: 16px; border-radius: 50%; background: #fff;
        transition: transform .2s; box-shadow: 0 1px 2px rgba(0,0,0,.2);
      }
      .rs-switch.on::after { transform: translateX(18px); }
      .rs-set-foot {
        display: flex; align-items: center; justify-content: space-between;
        margin-top: 10px; padding-top: 8px; border-top: 1px solid #e2e8f0;
        font-size: 10px; color: #94a3b8;
      }
      .rs-set-clear { color: #0D9488; cursor: pointer; font-weight: 700; }
      .rs-set-clear:hover { text-decoration: underline; }
      tr.rs-row-hidden { display: none; }
      tr.rs-row-weak td { background: #f0fdf4 !important; }
    `;
    document.head.appendChild(st);
  }

  // ─── Toast helper ──────────────────────────────────────────────────────────
  function showToast(msg) {
    let t = document.getElementById('rs-toast');
    if (!t) { t = document.createElement('div'); t.id = 'rs-toast'; t.className = 'rs-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ─── Panel builder ────────────────────────────────────────────────────────
  function makePanel(id, iconSvg, title, bodyHTML, collapsed = false) {
    const panel = document.createElement('div');
    panel.className = 'rs-panel';
    panel.id = id;
    panel.innerHTML = `
      <div class="rs-panel-head">
        <span class="rs-panel-title">${iconSvg}${title}</span>
        <span class="rs-panel-toggle ${collapsed ? '' : 'open'}">▼</span>
      </div>
      <div class="rs-panel-body ${collapsed ? 'collapsed' : ''}">${bodyHTML}</div>
    `;
    // Use addEventListener — inline onclick can be blocked by Google's CSP
    const head = panel.querySelector('.rs-panel-head');
    head.addEventListener('click', () => {
      panel.querySelector('.rs-panel-body').classList.toggle('collapsed');
      panel.querySelector('.rs-panel-toggle').classList.toggle('open');
    });
    return panel;
  }

  // Shared store of per-domain SERP metrics (filled as competitor data loads).
  // Index = SERP position; { domain, dr, ageYears, ageLabel }
  const rsDomainData = [];
  // Expose so serp-overlay.js can read DR values already fetched here,
  // avoiding duplicate Ahrefs API calls and rate-limit failures.
  window.__rsDomainData = rsDomainData;

  // Latest keyword search volume (from KW_OVERVIEW / gotrends). Read by the
  // Niche Opportunity panel; null until the keyword overview API responds.
  let rsVolume = null;

  // Full KW_OVERVIEW result shared across the sidebar so the search-box pill
  // never needs to fire its own API call.  Set by populateKeywordPanel() when
  // the real (or estimated) data arrives; read by injectSearchBoxVolume().
  let rsKwData   = null;   // { volume, competitionIndex, cpc, trend, estimated, source, cpcCurrency }
  let rsPillRender = null; // callback registered by injectSearchBoxVolume()

  // Single entry point for keyword data: feeds the in-search-box pill AND the
  // Keyword metrics line under the search bar (Volume / CPC / Competition /
  // 12-month bars / trend). Both read the same rsKwData, so numbers always match.
  function rsKwPush(data) {
    if (typeof rsPillRender === 'function') rsPillRender(data);
    try { rsKwLineRender(data); } catch (_) {}
  }

  // ── Metrics line under the Google search bar ───────────────────────────────
  const RS_KWL_ID = 'rs-kw-line';
  function rsKwEsc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // Rising / Stable / Decreasing: recent 3-month average vs earliest 3-month
  // average (±10% = flat).
  function rsKwTrendDir(trend) {
    if (!Array.isArray(trend) || trend.length < 3) return null;
    const v = trend.map(t => Number(t.value) || 0);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    const early = avg(v.slice(0, 3)), recent = avg(v.slice(-3));
    const ch = early <= 0 ? (recent > 0 ? 1 : 0) : (recent - early) / early;
    if (ch > 0.1)  return { label: 'Rising',     cls: 'up',   arrow: '\u25B2' };
    if (ch < -0.1) return { label: 'Decreasing', cls: 'down', arrow: '\u25BC' };
    return { label: 'Stable', cls: 'flat', arrow: '\u2192' };
  }

  function rsKwBars(trend) {
    if (!Array.isArray(trend) || trend.length < 2) return '';
    const vals = trend.map(t => Math.max(0, Number(t.value) || 0));
    const max = Math.max(...vals, 1), n = vals.length, bw = 4, gap = 1.5, H = 15;
    const W = n * (bw + gap);
    const rects = vals.map((v, i) => {
      const h = Math.max(1.5, (v / max) * H);
      const t = trend[i] || {};
      return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="1"><title>${rsKwEsc((t.month || '') + ' ' + (t.year || ''))}: ${fmtNum(v)}</title></rect>`;
    }).join('');
    return `<svg class="rs-kwl-bars" viewBox="0 0 ${W.toFixed(1)} ${H}" width="${W.toFixed(1)}" height="${H}">${rects}</svg>`;
  }

  function rsKwLineHtml(m) {
    const tag = '<span class="rs-kwl-tag">ShahzaibSEO</span>';
    if (!m) return `<span class="rs-kwl-row">${tag}<span class="rs-kwl-muted"><span class="rs-kwl-spin"></span>loading\u2026</span></span>`;
    const vol = Number(m.volume) || 0;
    if (m.failed || (!vol && m.estimated)) return `<span class="rs-kwl-row">${tag}<span class="rs-kwl-muted">no keyword data</span></span>`;
    const est = m.estimated === true;
    const volTxt = vol > 0 ? (est ? '~' : '') + fmtNum(vol) : '0';
    const cpcOk = m.cpc != null && Number(m.cpc) > 0;
    const cpc = cpcOk ? (m.cpcCurrency || '$') + Number(m.cpc).toFixed(2) : '\u2014';
    const ci = m.competitionIndex;
    const compLabel = ci == null ? '\u2014' : ci < 34 ? 'Low' : ci < 67 ? 'Medium' : ci < 86 ? 'High' : 'Very Hard';
    const compCls   = ci == null ? '' : ci < 34 ? 'low' : ci < 67 ? 'mid' : ci < 86 ? 'high' : 'vhard';
    const bars = Array.isArray(m.trend) ? rsKwBars(m.trend) : '';
    const dir = Array.isArray(m.trend) ? rsKwTrendDir(m.trend) : null;
    const dirHtml = dir ? `<span class="rs-kwl-dir ${dir.cls}">${dir.arrow} ${dir.label}</span>` : '';
    const sep = '<span class="rs-kwl-sep">|</span>';
    const estNote = est ? '<span class="rs-kwl-muted" title="Estimated from SERP signals \u2014 live keyword data was unavailable">(est.)</span>' : '';
    return `<span class="rs-kwl-row">${tag}
      <span class="rs-kwl-seg">Volume: <b>${volTxt}</b>/mo ${estNote}</span>${sep}
      <span class="rs-kwl-seg">CPC: <b>${cpc}</b></span>${sep}
      <span class="rs-kwl-seg">Competition: <b class="${compCls}">${compLabel}</b></span>${bars ? sep + bars + dirHtml : ''}
    </span>`;
  }

  function rsKwLineStyle() {
    if (document.getElementById('rs-kwl-style')) return;
    const st = document.createElement('style');
    st.id = 'rs-kwl-style';
    st.textContent = `
      #${RS_KWL_ID}{display:block;width:100%;box-sizing:border-box;margin:6px 0 2px;padding:0 0 0 2px;font:13px/20px Arial,Helvetica,sans-serif;color:#70757a;clear:both;flex:0 0 100%;}
      #${RS_KWL_ID} .rs-kwl-row{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px;}
      #${RS_KWL_ID} .rs-kwl-tag{background:#0D9488;color:#fff;font-weight:800;font-size:10px;letter-spacing:.04em;padding:1px 7px;border-radius:4px;}
      #${RS_KWL_ID} b{color:#1a73e8;font-weight:700;}
      #${RS_KWL_ID} b.low{color:#16a34a}#${RS_KWL_ID} b.mid{color:#ca8a04}#${RS_KWL_ID} b.high{color:#ea580c}#${RS_KWL_ID} b.vhard{color:#dc2626}
      #${RS_KWL_ID} .rs-kwl-sep{color:#c4c7c5}
      #${RS_KWL_ID} .rs-kwl-muted{color:#94a3b8;font-size:12px}
      #${RS_KWL_ID} .rs-kwl-bars{display:block;fill:#4f46e5;opacity:.9}
      #${RS_KWL_ID} .rs-kwl-dir{font-weight:700;font-size:12px}
      #${RS_KWL_ID} .rs-kwl-dir.up{color:#16a34a}#${RS_KWL_ID} .rs-kwl-dir.down{color:#dc2626}#${RS_KWL_ID} .rs-kwl-dir.flat{color:#64748b}
      #${RS_KWL_ID} .rs-kwl-spin{display:inline-block;width:10px;height:10px;margin-right:5px;border:2px solid #cbd5e1;border-top-color:#0D9488;border-radius:50%;animation:rs-kwl-r .8s linear infinite;vertical-align:-1px}
      @keyframes rs-kwl-r{to{transform:rotate(360deg)}}`;
    (document.head || document.documentElement).appendChild(st);
  }

  // True when nothing sits to the right of the line on the same row.
  function rsKwOnOwnLine(card) {
    try {
      const r = card.getBoundingClientRect();
      if (r.width < 60 || r.height < 6) return false;
      const free = n => {
        if (!n) return true;
        const rn = n.getBoundingClientRect();
        if (rn.width === 0 && rn.height === 0) return true;
        return !(Math.abs(rn.top - r.top) < Math.min(r.height, rn.height) * 0.6 && rn.left >= r.left);
      };
      return free(card.nextElementSibling) && free(card.previousElementSibling);
    } catch (_) { return true; }
  }

  function rsKwMountLine(html) {
    rsKwLineStyle();
    let card = document.getElementById(RS_KWL_ID);
    if (card) { card.innerHTML = html; return card; }
    card = document.createElement('div');
    card.id = RS_KWL_ID;
    card.setAttribute('dir', 'ltr');
    card.innerHTML = html;
    const tabsBar = (() => {
      const cands = [document.querySelector('#hdtbMenus'), document.querySelector('#appbar'), ...document.querySelectorAll('div[role="navigation"]')].filter(Boolean);
      for (const c of cands) {
        try { const r = c.getBoundingClientRect(); if (r.top < 260 && r.width > 150 && /\b(Images|Videos|News|Maps|Shopping|Books)\b/.test(c.textContent || '')) return c; } catch (_) {}
      }
      return null;
    })();
    const sbtc = document.querySelector('#sbtc') || document.querySelector('#tsf .A8SBwf') || document.querySelector('#tsf');
    const form = document.querySelector('#searchform') || document.querySelector('#tsf') || document.querySelector("form[role='search']");
    const col  = document.querySelector('#rcnt') || document.querySelector('#cnt') || document.querySelector('#center_col') || document.querySelector('#rso') || document.querySelector('#search');
    const tries = [
      () => tabsBar && tabsBar.parentElement && tabsBar.insertAdjacentElement('beforebegin', card),
      () => sbtc && (sbtc.appendChild(card), true),
      () => form && form.parentElement && form.insertAdjacentElement('afterend', card),
      () => col && col.insertBefore(card, col.firstChild),
    ];
    let placed = false;
    for (const t of tries) {
      try {
        if (t()) {
          // let flex parents wrap so the line can take its own row
          let n = card.parentElement, hops = 0;
          while (n && hops < 3) { if (getComputedStyle(n).display.indexOf('flex') !== -1) n.style.flexWrap = 'wrap'; n = n.parentElement; hops++; }
          if (rsKwOnOwnLine(card)) { placed = true; break; }
        }
      } catch (_) {}
    }
    if (!placed) {
      try { card.remove(); } catch (_) {}
      const c2 = document.querySelector('#center_col') || document.querySelector('#rso') || document.querySelector('#search');
      if (!c2) return null;
      c2.insertBefore(card, c2.firstChild);
    }
    return card;
  }

  function rsKwLineRender(data) {
    if (typeof isWebResultsPage === 'function' && !isWebResultsPage()) return;
    rsKwMountLine(rsKwLineHtml(data === undefined ? null : data));
  }

  // Google sometimes re-renders the header and drops our line: put it back
  // from the data we already hold (no new API call).
  let rsKwLineGuard = 0;
  new MutationObserver(() => {
    if (rsKwLineGuard || document.getElementById(RS_KWL_ID)) return;
    if (!rsKwData || !window.__rankseoSidebarLoaded) return;
    if (typeof isWebResultsPage === 'function' && !isWebResultsPage()) return;
    rsKwLineGuard = setTimeout(() => { rsKwLineGuard = 0; try { rsKwLineRender(rsKwData); } catch (_) {} }, 400);
  }).observe(document.body, { childList: true, subtree: true });

  // ─── 0. EASY-WIN STATS (Lowest DR / Lowest Age) ───────────────────────────
  function buildStatsPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
    const body = `
      <div class="rs-stats-grid">
        <div class="rs-stat-card">
          <div class="rs-stat-label">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 17l4-8 4 4 4-6 4 10"/></svg>
            Lowest DA / DR
          </div>
          <div class="rs-stat-val"><span id="rs-stat-da">…</span><span style="color:#cbd5e1;font-weight:700;margin:0 3px;">/</span><span id="rs-stat-dr">…</span></div>
          <div class="rs-stat-sub" id="rs-stat-dr-dom">scanning results…</div>
        </div>
        <div class="rs-stat-card warn">
          <div class="rs-stat-label">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            Lowest Age
          </div>
          <div class="rs-stat-val" id="rs-stat-age">…</div>
          <div class="rs-stat-sub" id="rs-stat-age-dom">scanning results…</div>
        </div>
      </div>
      <div class="rs-stat-hint" id="rs-stat-hint">
        Scanning the top results for the <b>weakest competitor</b> — a low DR or young domain on page 1 signals an easier keyword to rank for.
      </div>
    `;
    return makePanel('rs-panel-stats', svg, 'Easy-Win Signals', body, false);
  }


  function buildTrendsPanel(query) {
    const q = query || getSearchQuery() || '';
    const trendsUrl = 'https://trends.google.com/trends/explore?q=' + encodeURIComponent(q);
    const svg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/></svg>';
    const body = `
      <div id="rs-trends-spark-host" style="margin-bottom:8px;"></div>
      <div style="font-size:11px;color:#64748b;margin-bottom:8px;line-height:1.4;" id="rs-trends-blurb">
        Google Trends relative interest (0–100). Absolute search volume is in Keyword Overview.
      </div>
      <div id="rs-trends-related" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;min-height:20px;">
        <span style="font-size:10px;color:#94a3b8;">Loading related…</span>
      </div>
      <a href="${trendsUrl}" target="_blank" rel="noopener" style="display:inline-block;font-size:11px;font-weight:600;color:#fff;background:#4285f4;padding:6px 10px;border-radius:6px;text-decoration:none;">Open Google Trends ↗</a>
      <div id="rs-vol-cta" style="margin-top:10px;padding:8px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;font-size:10px;color:#92400e;line-height:1.4;">
        Real search volume: add your <strong>Keywords Everywhere</strong> API key in ShahzaibSEO Settings → Data API Keys. Without a key we never invent volume numbers.
      </div>
    `;
    const panel = makePanel('rs-panel-trends', svg, 'Keyword Trends', body, false);
    // Load Google Trends interest + related suggestions (NOT the same as KE volume trend)
    setTimeout(() => {
      let geo = '';
      try {
        const gl = new URLSearchParams(location.search).get('gl');
        if (gl && /^[a-z]{2}$/i.test(gl)) geo = gl.toUpperCase();
      } catch (_) {}
      chrome.runtime.sendMessage({ action: 'TRENDS_SUGGEST', query: q, geo }, res => {
        void chrome.runtime.lastError;
        const box = document.getElementById('rs-trends-related');
        if (box) {
          if (!res?.ok || !res.related?.length) {
            box.innerHTML = '<span style="font-size:10px;color:#94a3b8;">Open Trends for full chart</span>';
          } else {
            box.innerHTML = res.related.slice(0, 10).map(r =>
              `<a href="https://www.google.com/search?q=${encodeURIComponent(r)}" style="font-size:10px;padding:2px 7px;border-radius:999px;background:#f1f5f9;border:1px solid #e2e8f0;color:#334155;text-decoration:none;">${r.replace(/</g,'')}</a>`
            ).join('');
          }
        }
        // Interest sparkline (0–100) — different from KE absolute volume in Keyword Overview
        if (res?.ok && res.timeline) {
          renderGoogleTrendsInterest(res.timeline);
        } else {
          const sparkHost = document.getElementById('rs-trends-spark-host');
          const blurb = document.getElementById('rs-trends-blurb');
          if (sparkHost) {
            sparkHost.innerHTML = `<div style="font-size:10px;color:#94a3b8;padding:4px 0;">Google Trends chart unavailable${res?.timelineError ? ' (' + String(res.timelineError).slice(0, 40) + ')' : ''}. Use the button below.</div>`;
          }
          if (blurb) {
            blurb.innerHTML = 'Relative interest from Google Trends. Absolute monthly volume is in <strong>Keyword Overview</strong> (above).';
          }
        }
      });
      chrome.storage.sync.get(['keApiKey'], r => {
        const cta = document.getElementById('rs-vol-cta');
        if (cta && r.keApiKey) {
          cta.style.background = '#ecfdf5';
          cta.style.borderColor = '#a7f3d0';
          cta.style.color = '#065f46';
          cta.innerHTML = '✓ Keywords Everywhere connected — absolute volume lives in <strong>Keyword Overview</strong>. This panel shows Google Trends interest.';
        }
      });
    }, 300);
    return panel;
  }


    // Recompute the Lowest DR / Lowest Age cards from whatever is in rsDomainData.
  function refreshStatsPanel() {
    const daEl = document.getElementById('rs-stat-da');
    const drEl = document.getElementById('rs-stat-dr');
    const drDom = document.getElementById('rs-stat-dr-dom');
    const ageEl = document.getElementById('rs-stat-age');
    const ageDom = document.getElementById('rs-stat-age-dom');
    const hint = document.getElementById('rs-stat-hint');
    if (!drEl) return;

    if (typeof scrapeOverlayDaIntoRsDomainData === 'function') scrapeOverlayDaIntoRsDomainData();
    const withDa = rsDomainData.filter(d => d && typeof d.da === 'number');
    const withDr = rsDomainData.filter(d => d && typeof d.dr === 'number');
    const withAge = rsDomainData.filter(d => d && typeof d.ageYears === 'number');

    if (withDa.length) {
      const min = withDa.reduce((a, b) => (b.da < a.da ? b : a));
      daEl.textContent = min.da;
      daEl.style.color = min.da <= 20 ? '#16a34a' : min.da <= 50 ? '#ca8a04' : '#dc2626';
    }
    if (withDr.length) {
      const min = withDr.reduce((a, b) => (b.dr < a.dr ? b : a));
      drEl.textContent = min.dr;
      drEl.style.color = min.dr <= 20 ? '#16a34a' : min.dr <= 50 ? '#ca8a04' : '#dc2626';
      drDom.textContent = min.domain;
      drDom.title = min.domain;
    }
    if (withAge.length) {
      const min = withAge.reduce((a, b) => (b.ageYears < a.ageYears ? b : a));
      ageEl.textContent = min.ageLabel || (min.ageYears + 'y');
      ageEl.style.color = min.ageYears <= 2 ? '#16a34a' : min.ageYears <= 5 ? '#ca8a04' : '#b45309';
      ageDom.textContent = min.domain;
      ageDom.title = min.domain;
    }

    // Verdict hint once we have DR data
    if (withDr.length && hint) {
      const lowDr = withDr.reduce((a, b) => (b.dr < a.dr ? b : a)).dr;
      const easyCount = withDr.filter(d => d.dr <= 30).length;
      if (lowDr <= 20) {
        hint.innerHTML = `<b>Strong opportunity.</b> A DR ${lowDr} domain is ranking on page 1${easyCount > 1 ? ` (${easyCount} weak domains total)` : ''} — this keyword looks <b>easy to win</b> with solid content.`;
      } else if (lowDr <= 40) {
        hint.innerHTML = `<b>Moderate.</b> Weakest competitor is DR ${lowDr}. Winnable with good content and a few quality links.`;
      } else {
        hint.innerHTML = `<b>Competitive.</b> Even the weakest result is DR ${lowDr}. Expect to need strong authority and backlinks.`;
      }
    }

    // Keep the Niche Opportunity verdict in sync as DA/DR stream in.
    if (typeof refreshNichePanel === 'function') refreshNichePanel();
  }

  // ─── NICHE OPPORTUNITY (ported from Niche Finder AI) ──────────────────────
  // Uses ShahzaibSEO's already-fetched per-domain DA (Moz/KWE) + DR (free Ahrefs)
  // + keyword volume to produce a niche verdict — no extra extensions needed.
  function buildNichePanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;
    const body = `
      <div id="rs-niche-body">
        <div class="rs-loading-row"><div class="rs-spin"></div>Waiting for competitor DA / DR…</div>
      </div>`;
    return makePanel('rs-panel-niche', svg, 'Niche Opportunity', body, false);
  }

  function refreshNichePanel() {
    const host = document.getElementById('rs-niche-body');
    if (!host || typeof RSNiche === 'undefined') return;

    // Fill any missing DA from overlay badges already painted on the SERP
    if (typeof scrapeOverlayDaIntoRsDomainData === 'function') scrapeOverlayDaIntoRsDomainData();

    const competitors = rsDomainData
      .map((d, i) => d ? {
        domain: d.domain,
        da: (typeof d.da === 'number') ? d.da : null,
        dr: (typeof d.dr === 'number') ? d.dr : null,
        traffic: d.traffic,
        backlinks: d.backlinks,
        spam: (typeof d.spam === 'number') ? d.spam : null,
        ageYears: (typeof d.ageYears === 'number') ? d.ageYears : null,
        serpPosition: i + 1,
      } : null)
      .filter(Boolean);

    // Volume source of truth: prefer the real gotrends API value (rsVolume).
    // If that's unavailable, mirror whatever the Keyword Overview panel shows
    // (#rs-kw-vol) — which may be a "~" SERP estimate — but flag it as an
    // estimate so scoring stays honest and never claims confirmed volume.
    let nicheVolume = null, volumeConfirmed = true, volIsEstimate = false;
    if (rsVolume != null && typeof rsVolume === 'number') {
      nicheVolume = rsVolume;
      volumeConfirmed = true;
    } else {
      // KW Overview panel text
      const volEl = document.getElementById('rs-kw-vol');
      const raw = volEl ? (volEl.textContent || '').trim() : '';
      if (raw && raw !== '--' && raw !== '…' && raw !== '—') {
        const parsed = RSNiche.parseScoreValue(raw.replace(/^~/, ''));
        if (parsed > 0) {
          nicheVolume = parsed;
          volIsEstimate = true;
          volumeConfirmed = false;
        }
      }
    }
    // Shared store from search-box VOL pill / KW_OVERVIEW
    if (nicheVolume == null && typeof rsKwData === 'object' && rsKwData && typeof rsKwData.volume === 'number' && rsKwData.volume > 0) {
      nicheVolume = rsKwData.volume;
      volIsEstimate = !!rsKwData.estimated;
      volumeConfirmed = !rsKwData.estimated;
    }

    // Homepage flag for dedicated-site count
    const withHome = competitors.map((c, i) => {
      const raw = rsDomainData[i];
      let isHomepage = false;
      try {
        const u = (raw && (raw.url || raw.href)) || '';
        if (u) {
          const path = new URL(u.startsWith('http') ? u : 'https://' + u).pathname.replace(/\/+$/, '') || '/';
          isHomepage = path === '/' || path === '';
        }
      } catch (_) {}
      return { ...c, url: (raw && (raw.url || raw.href)) || '', isHomepage };
    });

    const seedKw = (typeof rsKeyword === 'string' && rsKeyword) ? rsKeyword
      : (document.querySelector('input[name="q"]')?.value || '');

    const verdict = RSNiche.computeOpportunity({
      seed: seedKw,
      volume: nicheVolume, volumeConfirmed, competitors: withHome,
    });

    if (verdict.verificationRequired) {
      host.innerHTML = `<div class="rs-loading-row"><div class="rs-spin"></div>${verdict.score || 'Loading…'}</div>`;
      return;
    }

    const tierColorMap = {
      excellent: '#059669', good: '#059669', moderate: '#b45309',
      hard: '#c2410c', 'very-hard': '#dc2626', locked: '#64748b'
    };
    const tierBgMap = {
      excellent: 'rgba(5,150,105,0.08)', good: 'rgba(5,150,105,0.08)',
      moderate: 'rgba(217,119,6,0.10)', hard: 'rgba(220,38,38,0.07)',
      'very-hard': 'rgba(220,38,38,0.07)', locked: 'rgba(100,116,139,0.07)'
    };
    const tier = verdict.scoreTier || 'very-hard';
    const sColor    = tierColorMap[tier] || '#dc2626';
    const sBg       = tierBgMap[tier]    || 'rgba(220,38,38,0.07)';
    const tierEmoji = verdict.scoreEmoji || '❓';
    // Prefer YES/MAYBE/NO + label; fall back to legacy score string
    const tierLabel = (verdict.verdict
      ? (verdict.verdict + ' — ' + (verdict.verdictLabel || ''))
      : (verdict.score || 'Unknown'));
    const scoreDisplay = (typeof verdict.scoreNum === 'number')
      ? String(verdict.scoreNum)
      : ({ excellent: '9', good: '7', moderate: '5', hard: '3', 'very-hard': '1', locked: '—' }[tier] || '—');
    const scoreSuffix = (typeof verdict.scoreNum === 'number') ? '<span style="font-size:11px;opacity:.7">/100</span>' : '';
    const typeLine = verdict.nicheTypeLabel
      ? `<div class="rs-niche-score-sub">${verdict.nicheTypeLabel} · competition-based</div>`
      : `<div class="rs-niche-score-sub">Live SERP · free analysis</div>`;

    const verdictCard = `
      <div class="rs-niche-score-card" style="background:${sBg};border:1.5px solid ${sColor}3d;">
        <div class="rs-niche-score-left">
          <span class="rs-niche-score-emoji">${tierEmoji}</span>
          <div>
            <div class="rs-niche-score-label" style="color:${sColor};">${tierLabel}</div>
            ${typeLine}
          </div>
        </div>
        <div class="rs-niche-score-num" style="color:${sColor};">${scoreDisplay}${scoreSuffix}</div>
      </div>`;

    // ── Metric tiles — REAL values of the best weak target + SERP context ─────
    // Show the actual DA / DR / Traffic / Backlinks / Age / Spam of the weakest
    // ranking site (the realistic target), not derived KD or SERP averages.
    const bc = verdict.bestCompetitor;
    const volTxt  = nicheVolume != null
      ? (volIsEstimate ? '~' : '') + RSNiche.formatNumber(nicheVolume)
      : '—';
    const volColor   = (nicheVolume != null && nicheVolume >= 1000) ? '#16a34a'
      : (nicheVolume != null ? '#ca8a04' : '#94a3b8');
    const weakCount  = verdict.lowDACount;
    const weakColor  = weakCount >= 3 ? '#16a34a' : weakCount >= 1 ? '#ca8a04' : '#dc2626';
    let bcTraffic = bc ? RSNiche.parseScoreValue(bc.traffic) : 0;
    // Fallback: lowest positive traffic among weak (DA<20) competitors already loaded
    if (!bcTraffic) {
      const weakWithT = competitors.filter(c => c && typeof c.da === 'number' && c.da < 20 && RSNiche.parseScoreValue(c.traffic) > 0);
      if (weakWithT.length) {
        bcTraffic = Math.min(...weakWithT.map(c => RSNiche.parseScoreValue(c.traffic)));
      }
    }
    const bcBL = bc ? RSNiche.parseScoreValue(bc.backlinks) : 0;
    const bcSpam = (bc && typeof bc.spam === 'number' && bc.spam >= 0) ? bc.spam : null;
    let bcAge = (bc && typeof bc.ageYears === 'number') ? bc.ageYears : null;
    if (bcAge == null) {
      const weakAge = competitors.filter(c => c && typeof c.ageYears === 'number');
      if (weakAge.length) bcAge = Math.min(...weakAge.map(c => c.ageYears));
    }

    const tileData = [
      { label: 'DA',         value: (bc && bc.da != null) ? bc.da : '—', color: (bc && bc.da < 20) ? '#16a34a' : '#1e293b', sub: 'Best site' },
      { label: 'DR',         value: (bc && typeof bc.dr === 'number') ? bc.dr : '—', color: (bc && bc.dr != null && bc.dr < 20) ? '#16a34a' : '#ea580c', sub: 'Best site' },
      { label: 'Traffic',    value: bcTraffic > 0 ? RSNiche.formatNumber(bcTraffic) : '—', color: '#0D9488', sub: 'Best site' },
      { label: 'Low DA',     value: weakCount, color: weakColor, sub: 'in Top 10' },
      { label: 'Backlinks',  value: bcBL > 0 ? RSNiche.formatNumber(bcBL) : '—', color: '#1e293b', sub: 'Best site' },
      { label: 'Domain Age', value: bcAge != null ? (bcAge < (30/365.25) ? Math.max(0, Math.round(bcAge * 365.25)) + 'd' : bcAge < 1 ? Math.max(1, Math.round(bcAge * 12)) + 'm' : (Math.floor(bcAge) + 'y')) : '—', color: bcAge != null && bcAge <= 2 ? '#16a34a' : '#1e293b', sub: 'Best site' },
      { label: 'Spam',       value: bcSpam != null ? bcSpam + '%' : '—', color: (bcSpam != null && bcSpam >= 8) ? '#dc2626' : '#1e293b', sub: 'Best site' },
      { label: 'Volume',     value: volTxt, color: volColor, sub: volIsEstimate ? 'est.' : 'Global' },
    ];

    const tiles = tileData.map(t => `
      <div class="rs-niche-tile">
        <div class="rs-niche-tile-label">${t.label}</div>
        <div class="rs-niche-tile-val" style="color:${t.color};">${t.value}</div>
        <div class="rs-niche-tile-sub">${t.sub}</div>
      </div>`).join('');
    const metricsRow = `<div class="rs-niche-tiles">${tiles}</div>`;

    // ── Reasons list ─────────────────────────────────────────────────────────
    const reasonsHtml = (verdict.reasons || []).map(r => {
      // parse leading icon from reason text (✅ ⚠️ ❌ 🔴)
      const isWarn = r.startsWith('⚠️') || r.startsWith('🔴') || r.startsWith('❌');
      const iconColor = isWarn ? '#ea580c' : '#16a34a';
      const iconBg    = isWarn ? '#fff7ed' : '#f0fdf4';
      const iconBdr   = isWarn ? '#fed7aa' : '#bbf7d0';
      // strip leading emoji
      const text = r.replace(/^[✅⚠️❌🔴🟡🟠ℹ️]\s*/, '');
      const icon = isWarn
        ? `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M8 2L1 14h14L8 2z" stroke="${iconColor}" stroke-width="1.5" stroke-linejoin="round"/><line x1="8" y1="7" x2="8" y2="10" stroke="${iconColor}" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="12" r=".6" fill="${iconColor}"/></svg>`
        : `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M3 8l3.5 3.5L13 5" stroke="${iconColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      return `
        <div class="rs-niche-reason">
          <span class="rs-niche-reason-icon" style="background:${iconBg};border:1px solid ${iconBdr};">${icon}</span>
          <span class="rs-niche-reason-text">${text}</span>
        </div>`;
    }).join('');

    const reasonsSection = reasonsHtml
      ? `<div class="rs-niche-reasons"><div class="rs-niche-section-title">🤖 AI Reasoning</div>${reasonsHtml}</div>`
      : '';

    // ── Best competitor card ─────────────────────────────────────────────────
    let bestHtml = '';
    if (verdict.bestCompetitor) {
      const b   = verdict.bestCompetitor;
      const drTxt = (typeof b.dr === 'number') ? `DR ${b.dr}` : '';
      const trafficTxt = b.traffic ? RSNiche.formatNumber(RSNiche.parseScoreValue(b.traffic)) + ' traffic' : '';
      const pills = [
        `DA ${b.da}`,
        drTxt,
        trafficTxt,
      ].filter(Boolean).map(p => `<span class="rs-niche-bc-pill">${p}</span>`).join('');

      bestHtml = `
        <div class="rs-niche-bc-card">
          <div class="rs-niche-bc-header">
            <svg viewBox="0 0 16 16" fill="none" width="10" height="10"><circle cx="8" cy="8" r="6" stroke="#7c3aed" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="#7c3aed" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Best weak competitor
          </div>
          <div class="rs-niche-bc-domain">${b.domain}</div>
          <div class="rs-niche-bc-pills">${pills}</div>
        </div>`;
    }

    host.innerHTML = verdictCard + metricsRow + reasonsSection + bestHtml;
  }

  // ─── KEYWORD IDEAS (Related Keywords + Questions) ─────────────────────────
  function buildIdeasPanel(query) {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.5.4.8 1 .9 1.6h6.2c.1-.6.4-1.2.9-1.6A7 7 0 0 0 12 2z"/></svg>`;
    const body = `<div id="rs-ideas-body"><div class="rs-loading-row"><div class="rs-spin"></div>Gathering keyword ideas…</div></div>`;
    return makePanel('rs-panel-ideas', svg, 'Keyword Ideas', body, false);
  }

  function populateIdeasPanel(query) {
    const container = document.getElementById('rs-ideas-body');
    if (!container) return;

    const related = new Set();
    const questions = new Set();
    const suggest = new Set();
    const qWords = /^(is|are|can|how|what|why|when|where|who|does|do|should|will|which|was)\b/i;
    const qNorm = String(query || '').toLowerCase().trim();

    function add(t, bucket) {
      if (!t) return;
      t = String(t).trim().replace(/\s+/g, ' ');
      if (t.length < 3 || t.length > 90) return;
      if (t.toLowerCase() === qNorm) return;
      if (bucket === 'suggest') { suggest.add(t); return; }
      if (qWords.test(t) || t.includes('?')) questions.add(t.replace(/\?+$/, '').trim());
      else related.add(t);
    }

    // ── 1) SERP: Related searches / "People also search for"
    document.querySelectorAll('.s75CSd, .AB4Wff, a.k8XOCe, .Q71vJc, .y6Uyqe, .AaVjTc a, .AJLUJb a').forEach(el => {
      add(el.textContent, 'related');
    });
    // "Searches related to" + footer related
    document.querySelectorAll('#bres a, #botstuff a, .g a[href*="/search?q="]').forEach(el => {
      const href = el.getAttribute('href') || '';
      if (href.includes('/search?q=') || href.includes('&q=')) {
        try {
          const abs = href.startsWith('http') ? href : ('https://www.google.com' + href);
          const q2 = new URL(abs).searchParams.get('q');
          add(q2, 'related');
        } catch (_) {}
      }
    });
    // ── 2) People Also Ask
    document.querySelectorAll(
      '.related-question-pair .iDjcJe, [jsname="yEVEwb"] .iDjcJe, .related-question-pair [role="button"], [data-q]'
    ).forEach(el => {
      const t = (el.getAttribute('data-q') || el.textContent || '').trim();
      if (t) add(t, 'questions');
    });

    function render() {
      // Merge Suggest into related (prefer unique)
      suggest.forEach(s => {
        if (!related.has(s) && !questions.has(s)) related.add(s);
      });
      const relArr = [...related].slice(0, 16);
      const qArr = [...questions].slice(0, 12);
      const sugArr = [...suggest].slice(0, 12);

      if (!relArr.length && !qArr.length && !sugArr.length) {
        container.innerHTML = '<div style="color:#94a3b8;font-size:11px;line-height:1.45;">No ideas yet. Scroll the SERP so “People also ask” and “Related searches” load, or wait a second for Google Suggest.</div>';
        return;
      }

      function section(label, arr, key) {
        if (!arr.length) return '';
        const rows = arr.map(kw => {
          const safe = kw.replace(/"/g, '&quot;');
          return `<div class="rs-idea-row" data-kw="${safe}">
            <span class="rs-idea-text" title="${safe}">${truncate(kw, 42)}</span>
            <span class="rs-idea-go">SEARCH ›</span>
          </div>`;
        }).join('');
        return `<div class="rs-ideas-section">
          <div class="rs-ideas-head">
            <span class="rs-ideas-head-label">${label} (${arr.length})</span>
            <span class="rs-ideas-copy" data-copy="${key}">Copy</span>
          </div>
          <div class="rs-ideas-list">${rows}</div>
        </div>`;
      }

      const lists = { rel: relArr, q: qArr, sug: sugArr };
      container.innerHTML =
        section('Google Suggest', sugArr, 'sug') +
        section('Related Keywords', relArr, 'rel') +
        section('Questions (PAA)', qArr, 'q') +
        '<div style="font-size:9px;color:#94a3b8;margin-top:8px;">Free · no API key · click to search</div>';

      container.querySelectorAll('.rs-idea-row').forEach(row => {
        row.addEventListener('click', () => {
          const kw = row.getAttribute('data-kw');
          if (kw) location.href = 'https://www.google.com/search?q=' + encodeURIComponent(kw);
        });
      });
      container.querySelectorAll('.rs-ideas-copy').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const list = lists[btn.getAttribute('data-copy')] || [];
          navigator.clipboard.writeText(list.join('\n')).then(() => showToast(list.length + ' keywords copied!'));
        });
      });
    }

    // Render SERP data immediately, then enrich with free Google Suggest
    render();

    try {
      chrome.runtime.sendMessage({ action: 'KEYWORD_SUGGEST', keyword: query }, (res) => {
        if (chrome.runtime.lastError) return;
        const arr = res?.suggestions || res?.related || [];
        if (Array.isArray(arr)) arr.forEach(s => {
          const v = typeof s === 'string' ? s : (s?.suggestion || s?.query || '');
          add(v, 'suggest');
        });
        render();
      });
    } catch (_) {}

    // Alphabet expansions a–z for extra free ideas (light, one parallel batch via KEYWORD_SUGGEST style not needed)
    try {
      chrome.runtime.sendMessage({ action: 'TRENDS_SUGGEST', query }, (res) => {
        if (chrome.runtime.lastError) return;
        (res?.related || []).forEach(s => add(typeof s === 'string' ? s : '', 'suggest'));
        render();
      });
    } catch (_) {}
  }

  // ─── SETTINGS / QUICK FILTERS + PANEL VISIBILITY ─────────────────────────
  const RS_FILTER_DEFAULTS = { onlyEasy: false, hideHighDr: false, hideOld: false, highlightWeak: true, weakDr: 20, weakDa: 30 };

  // Optional panels — toggle from Settings to keep sidebar clean
  const RS_PANEL_DEFS = [
    { key: 'aie',     id: 'rs-panel-aie',     label: 'AI Engine Citations' },
    { key: 'rank',    id: 'rs-panel-rank',    label: 'Rank Tracker' },
    { key: 'cann',    id: 'rs-panel-cann',    label: 'Keyword Cannibalization' },
    { key: 'blx',     id: 'rs-panel-blx',     label: 'Backlinks Explorer' },
    { key: 'intl',    id: 'rs-panel-intl',    label: 'International SERP Checker' },
    { key: 'export',  id: 'rs-panel-export',  label: 'Export Top 100 SERP' },
    { key: 'aio',     id: 'rs-panel-aio',     label: 'AI Overview (SGE) Tracker' },
    { key: 'paa',     id: 'rs-panel-paa',     label: 'People Also Ask' },
    { key: 'brief',   id: 'rs-panel-brief',   label: 'Content Brief Generator' },
    { key: 'ai',      id: 'rs-panel-ai',      label: 'AI Content Analyzer' },
    { key: 'related', id: 'rs-panel-related', label: 'Related Keywords' },
    { key: 'serp',    id: 'rs-panel-serp',    label: 'SERP Features Detected' },
    { key: 'fav',     id: 'rs-panel-fav',     label: 'Favorites' },
    { key: 'niche',   id: 'rs-panel-niche',   label: 'Niche Opportunity' },
    { key: 'ideas',   id: 'rs-panel-ideas',   label: 'Keyword Ideas' },
    { key: 'gap',     id: 'rs-panel-gap',     label: 'Backlink Gap Finder' }
  ];
  // Default OFF for heavy/less-used tools (user can enable in Settings)
  const RS_PANEL_VIS_DEFAULTS = {
    aie: false, rank: true, cann: false, blx: false, intl: false, export: false,
    aio: true, paa: true, brief: false, ai: false, related: true, serp: true,
    fav: true, niche: true, ideas: true, gap: false
  };

  function applyPanelVisibility(state) {
    const vis = state || RS_PANEL_VIS_DEFAULTS;
    RS_PANEL_DEFS.forEach(p => {
      const el = document.getElementById(p.id);
      if (!el) return;
      const show = vis[p.key] !== false;
      el.style.display = show ? '' : 'none';
    });
  }

  function buildSettingsPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    const sw = (id, label) => `
      <div class="rs-set-row">
        <span class="rs-set-label">${label}</span>
        <div class="rs-switch" id="${id}" role="switch" aria-checked="false"></div>
      </div>`;
    const panelToggles = RS_PANEL_DEFS.map(p => sw('rs-pvis-' + p.key, p.label)).join('');
    const body = `
      <div class="rs-set-sub">Quick Filters</div>
      <div class="rs-set-hint">Filters apply to the SERP table and live Google results.</div>
      ${sw('rs-set-onlyEasy', 'Show only Easy (DR ≤ threshold)')}
      ${sw('rs-set-hideHighDr', 'Hide DR 70+')}
      ${sw('rs-set-hideOld', 'Hide Age 10+ yrs')}
      ${sw('rs-set-highlightWeak', 'Highlight weak domains')}
      <div class="rs-set-row" style="flex-direction:column;align-items:stretch;gap:6px;padding-top:8px;">
        <span class="rs-set-label">Weak DR threshold: <b id="rs-weak-dr-val">20</b></span>
        <input type="range" id="rs-weak-dr-slider" min="10" max="50" step="5" value="20" style="width:100%;accent-color:#0D9488;" />
      </div>
      <div class="rs-set-row" style="flex-direction:column;align-items:stretch;gap:6px;">
        <span class="rs-set-label">Weak DA threshold: <b id="rs-weak-da-val">30</b></span>
        <input type="range" id="rs-weak-da-slider" min="10" max="50" step="5" value="30" style="width:100%;accent-color:#0D9488;" />
      </div>
      <div class="rs-set-sub" style="margin-top:12px;">Show panels</div>
      <div class="rs-set-hint">Off = hidden from sidebar. Core tools always stay visible.</div>
      ${panelToggles}
      <div class="rs-set-foot">
        <span id="rs-set-count">Cache: ${rsDomainData.length} domains</span>
        <span class="rs-set-clear" id="rs-set-clear">Clear cache</span>
      </div>
    `;
    return makePanel('rs-panel-settings', svg, 'Settings', body, true);
  }

  function setupSettingsPanel() {
    chrome.storage.local.get(['rsSerpFilters', 'rsSerpPanelVis'], (res) => {
      const state = Object.assign({}, RS_FILTER_DEFAULTS, res.rsSerpFilters || {});
      const map = {
        onlyEasy: 'rs-set-onlyEasy',
        hideHighDr: 'rs-set-hideHighDr',
        hideOld: 'rs-set-hideOld',
        highlightWeak: 'rs-set-highlightWeak',
      };
      Object.keys(map).forEach(key => {
        const el = document.getElementById(map[key]);
        if (!el) return;
        el.classList.toggle('on', !!state[key]);
        el.setAttribute('aria-checked', state[key] ? 'true' : 'false');
        el.addEventListener('click', () => {
          state[key] = !state[key];
          el.classList.toggle('on', state[key]);
          el.setAttribute('aria-checked', state[key] ? 'true' : 'false');
          chrome.storage.local.set({ rsSerpFilters: state });
          applySerpFilters(state);
        });
      });

      // Weak DR / DA threshold sliders
      const drSlider = document.getElementById('rs-weak-dr-slider');
      const daSlider = document.getElementById('rs-weak-da-slider');
      const drVal = document.getElementById('rs-weak-dr-val');
      const daVal = document.getElementById('rs-weak-da-val');
      if (drSlider) {
        drSlider.value = String(state.weakDr || 20);
        if (drVal) drVal.textContent = String(state.weakDr || 20);
        drSlider.addEventListener('input', () => {
          state.weakDr = Number(drSlider.value) || 20;
          if (drVal) drVal.textContent = String(state.weakDr);
          chrome.storage.local.set({ rsSerpFilters: state });
          applySerpFilters(state);
        });
      }
      if (daSlider) {
        daSlider.value = String(state.weakDa || 30);
        if (daVal) daVal.textContent = String(state.weakDa || 30);
        daSlider.addEventListener('input', () => {
          state.weakDa = Number(daSlider.value) || 30;
          if (daVal) daVal.textContent = String(state.weakDa);
          chrome.storage.local.set({ rsSerpFilters: state });
          applySerpFilters(state);
        });
      }

      window.__rsFilters = state;
      applySerpFilters(state);

      const pvis = Object.assign({}, RS_PANEL_VIS_DEFAULTS, res.rsSerpPanelVis || {});
      RS_PANEL_DEFS.forEach(p => {
        const el = document.getElementById('rs-pvis-' + p.key);
        if (!el) return;
        const on = pvis[p.key] !== false;
        el.classList.toggle('on', on);
        el.setAttribute('aria-checked', on ? 'true' : 'false');
        el.addEventListener('click', () => {
          const next = !(pvis[p.key] !== false);
          pvis[p.key] = next;
          el.classList.toggle('on', next);
          el.setAttribute('aria-checked', next ? 'true' : 'false');
          chrome.storage.local.set({ rsSerpPanelVis: pvis });
          applyPanelVisibility(pvis);
        });
      });
      applyPanelVisibility(pvis);

      const clear = document.getElementById('rs-set-clear');
      if (clear) clear.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'MOZ_CLEAR_CACHE' }, () => { void chrome.runtime.lastError; });
        chrome.runtime.sendMessage({ action: 'AHREFS_CLEAR_CACHE' }, () => { void chrome.runtime.lastError; });
        showToast('Cache cleared — reload to refetch');
        const c = document.getElementById('rs-set-count');
        if (c) c.textContent = 'Cache: 0 domains';
      });
    });
  }

  function applySerpFilters(state) {
    state = state || window.__rsFilters || RS_FILTER_DEFAULTS;
    window.__rsFilters = state;
    const weakDr = Number(state.weakDr) || 20;
    const weakDa = Number(state.weakDa) || 30;
    const table = document.querySelector('#rs-comp-body .rs-comp-table tbody');
    if (!table) return;
    const rows = table.querySelectorAll('tr');
    rows.forEach((tr, i) => {
      const d = rsDomainData[i] || {};
      let hide = false;
      if (state.onlyEasy && typeof d.dr === 'number' && d.dr > weakDr) hide = true;
      if (state.hideHighDr && typeof d.dr === 'number' && d.dr >= 70) hide = true;
      if (state.hideOld && typeof d.ageYears === 'number' && d.ageYears >= 10) hide = true;
      tr.classList.toggle('rs-row-hidden', hide);
      const weakByDr = typeof d.dr === 'number' && d.dr <= weakDr;
      const weakByDa = typeof d.da === 'number' && d.da <= weakDa;
      const weak = state.highlightWeak && (weakByDr || weakByDa);
      tr.classList.toggle('rs-row-weak', !!weak && !hide);
    });
  }

  // ─── 1. KEYWORD OVERVIEW ──────────────────────────────────────────────────
  function buildKeywordPanel(query) {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;
    const body = `
      <div class="rs-ai-query">"${truncate(query, 60)}"</div>
      <div class="rs-kw-grid" id="rs-kw-grid">
        <div class="rs-kw-stat"><div class="rs-kw-stat-label">Volume</div><div class="rs-kw-stat-val" id="rs-kw-vol">…</div></div>
        <div class="rs-kw-stat"><div class="rs-kw-stat-label">CPC</div><div class="rs-kw-stat-val" id="rs-kw-cpc">…</div></div>
        <div class="rs-kw-stat"><div class="rs-kw-stat-label">Competition</div><div class="rs-kw-stat-val" id="rs-kw-comp">…</div></div>
      </div>
      <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Keyword Difficulty</div>
      <div class="rs-kd-bar"><div class="rs-kd-fill" id="rs-kd-fill" style="width:0%"></div></div>
      <div class="rs-kd-label"><span>Easy</span><span id="rs-kd-score">—/100</span><span>Hard</span></div>
      <div class="rs-kw-fav-row">
        <button type="button" class="rs-kw-fav-btn" id="rs-kw-fav-btn" title="Save keyword to Favorites">☆ Save to Favorites</button>
      </div>
    `;
    return makePanel('rs-panel-kw', svg, 'Keyword Overview', body, false);
  }

  // ─── Favorites (local storage) ─────────────────────────────────────────────
  const RS_FAV_KEY = 'rsKeywordFavorites';
  const RS_FAV_MAX = 80;

  function loadFavorites(cb) {
    try {
      chrome.storage.local.get([RS_FAV_KEY], (res) => {
        const list = Array.isArray(res[RS_FAV_KEY]) ? res[RS_FAV_KEY] : [];
        cb(list);
      });
    } catch (e) { cb([]); }
  }
  function saveFavorites(list, cb) {
    try {
      chrome.storage.local.set({ [RS_FAV_KEY]: list.slice(0, RS_FAV_MAX) }, () => cb && cb());
    } catch (e) { cb && cb(); }
  }
  function buildFavoritesPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9"/></svg>`;
    const body = `
      <div class="rs-fav-list" id="rs-fav-list"><div class="rs-fav-empty">No saved keywords yet</div></div>
      <div style="margin-top:8px;display:flex;gap:6px;">
        <button type="button" class="rs-kw-fav-btn" id="rs-fav-copy" style="flex:1">Copy all</button>
        <button type="button" class="rs-kw-fav-btn" id="rs-fav-clear" style="flex:0.7">Clear</button>
      </div>
    `;
    return makePanel('rs-panel-fav', svg, 'Favorites', body, true);
  }
  function renderFavoritesList() {
    const box = document.getElementById('rs-fav-list');
    if (!box) return;
    loadFavorites((list) => {
      if (!list.length) {
        box.innerHTML = '<div class="rs-fav-empty">No saved keywords yet — use ☆ Save on Keyword Overview</div>';
        return;
      }
      box.innerHTML = list.map((item, i) => {
        const kw = (item.keyword || item.q || '').replace(/</g, '&lt;');
        const vol = item.volume != null ? fmtNum(item.volume) : '—';
        return `<div class="rs-fav-row" data-idx="${i}">
          <span class="rs-fav-kw" title="${kw}">${kw}</span>
          <span class="rs-fav-vol">${vol}</span>
          <button type="button" class="rs-fav-act rs-fav-search" title="Search">🔍</button>
          <button type="button" class="rs-fav-act rs-fav-del" title="Remove">✕</button>
        </div>`;
      }).join('');
      box.querySelectorAll('.rs-fav-search').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = btn.closest('.rs-fav-row');
          const kw = row?.querySelector('.rs-fav-kw')?.textContent?.trim();
          if (kw) location.href = 'https://www.google.com/search?q=' + encodeURIComponent(kw);
        });
      });
      box.querySelectorAll('.rs-fav-del').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.closest('.rs-fav-row')?.dataset.idx, 10);
          loadFavorites((list) => {
            if (isNaN(idx)) return;
            list.splice(idx, 1);
            saveFavorites(list, renderFavoritesList);
          });
        });
      });
    });
  }
  function setupFavoritesPanel(query) {
    renderFavoritesList();
    const favBtn = document.getElementById('rs-kw-fav-btn');
    if (favBtn && query) {
      loadFavorites((list) => {
        const exists = list.some(x => (x.keyword || '').toLowerCase() === query.toLowerCase());
        if (exists) {
          favBtn.classList.add('saved');
          favBtn.textContent = '★ Saved';
        }
      });
      favBtn.addEventListener('click', () => {
        loadFavorites((list) => {
          const q = query.trim();
          const i = list.findIndex(x => (x.keyword || '').toLowerCase() === q.toLowerCase());
          if (i >= 0) {
            list.splice(i, 1);
            favBtn.classList.remove('saved');
            favBtn.textContent = '☆ Save to Favorites';
            showToast('Removed from Favorites');
          } else {
            list.unshift({
              keyword: q,
              volume: rsKwData?.volume || null,
              cpc: rsKwData?.cpc || null,
              competition: rsKwData?.competitionIndex || null,
              savedAt: Date.now()
            });
            favBtn.classList.add('saved');
            favBtn.textContent = '★ Saved';
            showToast('Saved to Favorites');
          }
          saveFavorites(list, renderFavoritesList);
        });
      });
    }
    document.getElementById('rs-fav-copy')?.addEventListener('click', () => {
      loadFavorites((list) => {
        const text = list.map(x => {
          const parts = [x.keyword];
          if (x.volume != null) parts.push(String(x.volume));
          if (x.cpc != null) parts.push(String(x.cpc));
          return parts.join('\t');
        }).join('\n');
        navigator.clipboard?.writeText(text).then(() => showToast('Copied ' + list.length + ' keywords')).catch(() => {});
      });
    });
    document.getElementById('rs-fav-clear')?.addEventListener('click', () => {
      saveFavorites([], () => {
        renderFavoritesList();
        const favBtn = document.getElementById('rs-kw-fav-btn');
        if (favBtn) { favBtn.classList.remove('saved'); favBtn.textContent = '☆ Save to Favorites'; }
        showToast('Favorites cleared');
      });
    });
  }

  // Locale-safe extraction of the largest integer in a string. Google formats
  // the result-count with region-specific digit-group separators (',' '.' ' '
  // non-breaking space, narrow no-break space, "'" …), so before reading the
  // number we strip any single separator that sits BETWEEN two digits. That
  // turns "1,230,000,000" / "1.230.000.000" / "1 230 000 000" / "1\u00A0230\u00A0000"
  // / "1'230'000" all into one clean run of digits, then we take the largest.
  function rsBiggestNumber(text) {
    if (!text) return 0;
    const cleaned = String(text)
      .replace(/(\d)[.,\u00A0\u202F\u2009\u066C\u2019'\s](?=\d)/g, '$1');
    const nums = cleaned.match(/\d{4,}/g);
    if (!nums) return 0;
    return nums.reduce((mx, n) => Math.max(mx, parseInt(n, 10) || 0), 0);
  }

  function populateKeywordPanel(query) {
    // ── 1. Results count from page (for estimation only) ──────────────────────
    // Try multiple selectors as Google changes them frequently
    const statsSelectors = [
      '#result-stats',
      '.LHJvCe',
      '#resultStats',
      '[id="result-stats"]',
      'div#result-stats',
      '.QqJ9ie',
      '.Kx0HBc',
    ];
    let statsEl = null;
    for (const sel of statsSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.match(/[\d,.\u00A0\u202F\u2009']{3,}/)) { statsEl = el; break; }
    }

    // Locale-agnostic last resort. Google translates the result-stats line in
    // every region ("About 1,230,000,000 results" → "Cerca de 1.230.000.000
    // resultados" → "Ungefähr 5.300.000 Ergebnisse" → "Environ 8 200 000
    // résultats" …), so matching the English words "About … results" fails
    // everywhere except en. Instead, find the short childless element that holds
    // the biggest number on the page — that is the stats line in any language.
    if (!statsEl) {
      let best = null, bestNum = 0;
      document.querySelectorAll('div, nobr, span').forEach((el) => {
        if (el.children.length !== 0) return;          // leaf nodes only
        const t = el.textContent || '';
        if (!t || t.length > 80) return;               // the stats line is short
        const n = rsBiggestNumber(t);
        if (n > bestNum) { bestNum = n; best = el; }
      });
      if (best) statsEl = best;
    }

    const statsText = statsEl ? statsEl.textContent : '';
    // Locale-safe number read (handles ',' '.' ' ' '\u00A0' "'" group separators).
    const bigNum = rsBiggestNumber(statsText);
    const resultCount = bigNum > 0 ? String(bigNum) : null;

    // ── 2. Extract related searches count as volume signal ─────────────────
    const relatedEls = document.querySelectorAll('.s75CSd, .AB4Wff, [data-q], .k8XOCe, .Q71vJc');
    const relatedCount = relatedEls.length;

    // ── 3. Use KeywordSurfer-style approach: estimate from page signals ────
    estimateAndDisplay(query, resultCount, relatedCount);
  }

  function estimateAndDisplay(query, resultCount, relatedCount) {
    const vol   = document.getElementById('rs-kw-vol');
    const comp2 = document.getElementById('rs-kw-comp');
    const kd2   = document.getElementById('rs-kd-score');
    const fill2 = document.getElementById('rs-kd-fill');

    // Estimate volume from result count (heuristic used by many SEO tools)
    const results = parseInt(resultCount) || 0;
    let estVolume = 0;
    let compLabel = '--', compClass = '', compScore = 0;

    if (results > 0) {
      // Log scale estimation: 1B results ≈ 1M+ searches, 100M ≈ 100K, 10M ≈ 10K
      if (results >= 1000000000)      estVolume = 1000000 + Math.round((results - 1e9) / 10000);
      else if (results >= 500000000)  estVolume = 500000;
      else if (results >= 100000000)  estVolume = 100000;
      else if (results >= 10000000)   estVolume = 10000 + Math.round((results - 1e7) / 10000);
      else if (results >= 1000000)    estVolume = 1000  + Math.round((results - 1e6) / 10000);
      else if (results >= 100000)     estVolume = 500;
      else estVolume = 100;
    }

    // Competition from ads presence on page
    const hasAds = document.querySelectorAll('[aria-label="Ads"],.uEierd,[data-text-ad]').length > 0;
    const adCount = document.querySelectorAll('[aria-label="Ads"],[data-text-ad]').length;
    if (adCount >= 3)      { compLabel = 'High';   compClass = 'red';   compScore = 80; }
    else if (adCount >= 1) { compLabel = 'Medium';  compClass = 'amber'; compScore = 50; }
    else if (hasAds)       { compLabel = 'Medium';  compClass = 'amber'; compScore = 40; }
    else                   { compLabel = 'Low';     compClass = 'green'; compScore = 20; }

    // KD estimate from results count + competition
    const kd = Math.min(100, Math.round(compScore * 0.5 + (results > 1e8 ? 40 : results > 1e7 ? 25 : results > 1e6 ? 15 : 8)));

    // Display
    if (vol)  {
      vol.textContent = estVolume > 0 ? '~' + fmtNum(estVolume) : '--';
      vol.className = 'rs-kw-stat-val ' + (estVolume > 10000 ? 'green' : estVolume > 1000 ? 'amber' : '');
    const cpcEst = document.getElementById('rs-kw-cpc');
    if (cpcEst) { cpcEst.textContent = '—'; cpcEst.className = 'rs-kw-stat-val'; }
    }
    if (comp2){ comp2.textContent = compLabel; comp2.className = 'rs-kw-stat-val ' + compClass; }
    if (kd2)  { kd2.textContent = kd + '/100'; }
    if (fill2){
      fill2.style.width = kd + '%';
      fill2.style.background = kd >= 70 ? 'linear-gradient(90deg,#dc2626,#ef4444)' :
                               kd >= 40 ? 'linear-gradient(90deg,#ca8a04,#eab308)' :
                                          'linear-gradient(90deg,#0D9488,#14b8a6)';
    }

    // Source badge — initially hidden; shown only if API also fails below
    const kwGrid = document.getElementById('rs-kw-grid');
    if (kwGrid && !document.getElementById('rs-kw-source')) {
      const src = document.createElement('div');
      src.id = 'rs-kw-source';
      src.style.cssText = 'grid-column:1/-1;font-size:9px;color:#94a3b8;text-align:right;margin-top:-4px;';
      // Start hidden — only reveal if real API call below also fails
      src.style.display = 'none';
      src.textContent = 'Estimated from SERP signals';
      kwGrid.appendChild(src);
    }

    // Let the Niche panel pick up this estimate even if the real API later fails.
    if (typeof refreshNichePanel === 'function') refreshNichePanel();

    // Share SERP estimate with the search-box pill so it never needs its own call.
    if (estVolume > 0) {
      rsKwData = { volume: estVolume, competitionIndex: compScore, cpc: null, trend: null, estimated: true, cpcCurrency: '$' };
      rsKwPush(rsKwData);
    } else if (!(rsKwData && rsKwData.volume > 0)) {
      // No SERP estimate (e.g. Google hid the result-stats line in this locale).
      // Clear the "VOL loading…" placeholder now; the real API callback below
      // will overwrite this with a number if it succeeds.
      rsKwPush({ volume: 0, estimated: true, failed: false });
    }

    if (!(rsKwData && rsKwData.volume > 0)) { try { rsKwLineRender(null); } catch (_) {} }
    // Country from Google URL (?gl=pk / gl=us) so KE volume matches the SERP region
    let serpCountry = 'us';
    try {
      const gl = new URLSearchParams(location.search).get('gl');
      if (gl && /^[a-z]{2}$/i.test(gl)) serpCountry = gl.toLowerCase();
      else if (/google\.(co\.uk|com\.pk|com\.au|ca|de|fr|in)/i.test(location.hostname)) {
        const m = location.hostname.match(/google\.(?:co\.|com\.)?([a-z]{2})$/i);
        if (m) serpCountry = m[1].toLowerCase() === 'uk' ? 'gb' : m[1].toLowerCase();
      }
    } catch (_) {}

    // ── Now try real API via background (will update if successful) ─────────
    chrome.runtime.sendMessage({ action: 'KW_OVERVIEW', query, country: serpCountry }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        // API failed — show the estimate badge so user knows it's an approximation
        const srcEl = document.getElementById('rs-kw-source');
        if (srcEl) { srcEl.style.display = ''; }
        // Make sure the search-box pill leaves its "VOL loading…" state instead
        // of spinning forever (happens when the SERP estimate is also 0).
        if (!(rsKwData && rsKwData.volume > 0)) {
          rsKwPush(rsKwData || { volume: 0, estimated: true, failed: true });
        } else {
          rsKwPush(rsKwData); // keep the (est.) line, API had nothing better
        }
        return;
      }
      // Real data received — update display (including volume 0 from KE)
      if (vol && typeof res.volume === 'number') {
        vol.textContent = fmtNum(res.volume);
        vol.className = 'rs-kw-stat-val ' + (res.volume > 10000 ? 'green' : res.volume > 1000 ? 'amber' : res.volume > 0 ? 'red' : '');
      }
      // Feed the Niche Opportunity engine.
      if (typeof res.volume === 'number') {
        rsVolume = res.volume;
        if (typeof refreshNichePanel === 'function') refreshNichePanel();
      }
      // Push real data to the shared store so the search-box pill stays in sync.
      rsKwData = {
        volume:           typeof res.volume === 'number' ? res.volume : (rsKwData && rsKwData.volume) || 0,
        competitionIndex: res.competitionIndex != null   ? res.competitionIndex : (rsKwData && rsKwData.competitionIndex),
        cpc:              res.cpc              != null   ? res.cpc              : null,
        cpcCurrency:      res.cpcCurrency      || '$',
        trend:            Array.isArray(res.trend) && res.trend.length ? res.trend : null,
        estimated:        res.estimated === true,
        source:           res.source || null,
      };
      rsKwPush(rsKwData);
      // CPC display
      const cpcEl = document.getElementById('rs-kw-cpc');
      if (cpcEl) {
        if (res.cpc != null && res.cpc > 0) {
          const cur = res.cpcCurrency || '$';
          cpcEl.textContent = cur + (Number(res.cpc) >= 10 ? Number(res.cpc).toFixed(1) : Number(res.cpc).toFixed(2));
          cpcEl.className = 'rs-kw-stat-val green';
        } else {
          cpcEl.textContent = '—';
          cpcEl.className = 'rs-kw-stat-val';
        }
      }
      if (comp2 && res.competitionIndex != null) {
        const ci = res.competitionIndex;
        const lbl = ci >= 66 ? 'High' : ci >= 33 ? 'Medium' : 'Low';
        comp2.textContent = lbl + ' (' + ci + ')';
        comp2.className = 'rs-kw-stat-val ' + (ci >= 66 ? 'red' : ci >= 33 ? 'amber' : 'green');
      }
      if (kd2 && res.difficulty) kd2.textContent = res.difficulty + '/100';
      if (fill2 && res.difficulty) fill2.style.width = res.difficulty + '%';
      // Source badge — real data: show source name cleanly (no "Estimated" text)
      const srcEl = document.getElementById('rs-kw-source');
      if (srcEl) {
        if (res.estimated === false) {
          // Real confirmed data — show source, hide estimate label
          srcEl.style.display = '';
          srcEl.textContent = '✓ ' + (res.source || 'Real data');
          srcEl.style.color = '#16a34a';
        } else if (res.source) {
          // Returned with a source but estimated=true (rare) — show source only
          srcEl.style.display = '';
          srcEl.textContent = res.source;
          srcEl.style.color = '#94a3b8';
        } else {
          // No source info — keep badge hidden
          srcEl.style.display = 'none';
        }
      }
      // Trend sparkline (12-month) — only when the API returned real trend data.
      if (Array.isArray(res.trend) && res.trend.length) renderKwTrend(res.trend);
      // Best-effort "track" (per API spec). Fire-and-forget; ignored if inactive.
      try { chrome.runtime.sendMessage({ action: 'KW_TRACK', query }, () => void chrome.runtime.lastError); } catch (e) {}
    });
  }

  // Keyword Overview only — absolute monthly search volume from Keywords Everywhere.
  function renderKwTrend(trend) {
    if (!Array.isArray(trend) || !trend.length) return;
    const vals = trend.map(t => Math.max(0, Number(t.value) || 0));
    const max = Math.max(1, ...vals);
    const W = 168, H = 34, n = vals.length, gap = 2;
    const bw = (W - gap * (n - 1)) / n;
    const last = vals[n - 1], prev = n >= 2 ? vals[n - 2] : last;
    const up = last >= prev;
    const barColor = up ? '#16a34a' : '#dc2626';
    const bars = vals.map((v, i) => {
      const h = Math.max(2, Math.round((v / max) * (H - 4)));
      const x = (i * (bw + gap)).toFixed(1);
      const y = (H - h).toFixed(1);
      const t = trend[i];
      const title = `${t.month || ''} ${t.year || ''}: ${fmtNum(v)}`;
      return `<rect x="${x}" y="${y}" width="${bw.toFixed(1)}" height="${h}" rx="1" fill="${i === n - 1 ? barColor : '#cbd5e1'}"><title>${title}</title></rect>`;
    }).join('');
    const first = trend[0], lastT = trend[n - 1];
    const lbl = `${(first.month || '').slice(0, 3)} ${first.year || ''} – ${(lastT.month || '').slice(0, 3)} ${lastT.year || ''}`;
    const html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
        <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;">Volume trend (12 mo) · KE</span>
        <span style="font-size:10px;font-weight:700;color:${barColor};">${up ? '▲' : '▼'} ${fmtNum(last)}</span>
      </div>
      <svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;">${bars}</svg>
      <div style="font-size:8px;color:#cbd5e1;margin-top:1px;">${lbl} · absolute monthly searches</div>
    `;

    const grid = document.getElementById('rs-kw-grid');
    if (!grid) return;
    let host = document.getElementById('rs-kw-trend');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rs-kw-trend';
      host.style.cssText = 'grid-column:1/-1;margin-top:6px;';
      const src = document.getElementById('rs-kw-source');
      if (src && src.parentNode === grid) grid.insertBefore(host, src); else grid.appendChild(host);
    }
    host.innerHTML = html;
  }

  // Keyword Trends panel only — Google Trends relative interest (0–100), not KE volume.
  function renderGoogleTrendsInterest(timeline) {
    const sparkHost = document.getElementById('rs-trends-spark-host');
    if (!sparkHost) return;
    const points = Array.isArray(timeline?.points) ? timeline.points
      : (Array.isArray(timeline) ? timeline : []);
    if (!points.length) {
      sparkHost.innerHTML = '';
      return;
    }
    const step = Math.max(1, Math.floor(points.length / 12));
    const sampled = [];
    for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
    if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);
    const vals = sampled.map(p => Math.max(0, Number(p.value) || 0));
    const max = Math.max(1, ...vals);
    const W = 168, H = 34, n = vals.length, gap = 2;
    const bw = (W - gap * (n - 1)) / n;
    const last = vals[n - 1], prev = n >= 2 ? vals[n - 2] : last;
    const up = last >= prev;
    const barColor = up ? '#2563eb' : '#dc2626';
    const bars = vals.map((v, i) => {
      const h = Math.max(2, Math.round((v / max) * (H - 4)));
      const x = (i * (bw + gap)).toFixed(1);
      const y = (H - h).toFixed(1);
      const t = sampled[i];
      const title = `${t.time || ''}: interest ${v}/100`;
      return `<rect x="${x}" y="${y}" width="${bw.toFixed(1)}" height="${h}" rx="1" fill="${i === n - 1 ? barColor : '#93c5fd'}"><title>${title}</title></rect>`;
    }).join('');
    const first = sampled[0], lastT = sampled[n - 1];
    sparkHost.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
        <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;">Interest (Google Trends)</span>
        <span style="font-size:10px;font-weight:700;color:${barColor};">${up ? '▲' : '▼'} ${last}/100</span>
      </div>
      <svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;">${bars}</svg>
      <div style="font-size:8px;color:#cbd5e1;margin-top:1px;">${(first.time || '').slice(0, 14)} – ${(lastT.time || '').slice(0, 14)} · relative 0–100 (not volume)</div>
    `;
    const blurb = document.getElementById('rs-trends-blurb');
    if (blurb) {
      blurb.innerHTML = 'Google Trends <strong>interest index</strong> (0–100). Absolute search volume is in <strong>Keyword Overview</strong> above.';
    }
  }

  // ── Volume pill INSIDE the Google search box (right side) ─────────────────
  // Injects keyword metrics inline inside the search input — exactly like
  // Keywords Everywhere — so VOL / CPC / COMP / TREND appear at-a-glance.
  // Shows REAL API data (no "est." tag). Falls back to SERP estimate only
  // when API fails, and clearly marks it "est" so it's never misleading.
  // ── Volume pill INSIDE the Google search box (right side) ─────────────────
  // Injects keyword metrics inline inside the search input — exactly like
  // Keywords Everywhere — so VOL / CPC / COMP / TREND appear at-a-glance.
  //
  // KEY DESIGN: this function NEVER fires its own KW_OVERVIEW API call.
  // It registers rsPillRender so populateKeywordPanel() can push data to it
  // from the single shared KW_OVERVIEW call that already runs for the sidebar.
  // This guarantees the pill always shows exactly the same number as the sidebar.
  function injectSearchBoxVolume(query) {
    if (!query) return;
    if (document.getElementById('rs-sb-vol-wrap')) return;

    // Find the Google search textarea/input
    const input = document.querySelector('textarea[name="q"], input[name="q"]');
    if (!input) return;

    // Strategy: find the search input's bounding container that has a defined
    // height (the visible pill-shaped search bar), set it to relative, and
    // absolutely position our bar inside it on the right.
    let container = null;
    let el = input.parentElement;
    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      const cs = getComputedStyle(el);
      const h = parseInt(cs.height) || 0;
      // Google search bar is typically 44–56px tall
      if (h >= 40 && h <= 70) { container = el; break; }
      el = el.parentElement;
    }
    // Fallback: use the form element
    if (!container) container = input.closest('form');
    if (!container) return;

    // Ensure positioning context
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    // ── Build the inline metrics bar ────────────────────────────────────────
    const bar = document.createElement('div');
    bar.id = 'rs-sb-vol-wrap';
    bar.style.cssText = [
      'position:absolute',
      'right:20px',            // sit just left of the X (clear) button
      'top:50%',
      'transform:translateY(-50%)',
      'display:inline-flex',
      'align-items:center',
      'gap:6px',
      'font-family:Arial,Helvetica,sans-serif',
      'font-size:12px',
      'color:#334155',
      'pointer-events:none',
      'z-index:9999',
      'white-space:nowrap',
      'line-height:1',
    ].join(';');

    bar.innerHTML = '<span style="color:#bbb;font-size:11px;">VOL loading\u2026</span>';
    container.appendChild(bar);

    // ── Separator helper ────────────────────────────────────────────────────
    const sep = () => '<span style="color:#d1d5db;margin:0 2px;">|</span>';

    // ── Trend sparkline (inline mini bars) ─────────────────────────────────
    function buildTrend(trend) {
      if (!Array.isArray(trend) || trend.length < 2) return '';
      const vals = trend.map(t => Math.max(0, Number(t.value) || 0));
      const max = Math.max(1, ...vals);
      const n = vals.length;
      const last = vals[n - 1], prev = vals[n - 2];
      const up = last >= prev;
      const col = up ? '#16a34a' : '#dc2626';
      const bars = vals.map(v => {
        const h = Math.max(2, Math.round((v / max) * 14));
        return `<span style="display:inline-block;width:2px;height:${h}px;background:${col};opacity:.6;border-radius:1px;margin-right:1px;vertical-align:bottom;"></span>`;
      }).join('');
      return sep() +
        `<span style="display:inline-flex;align-items:flex-end;height:14px;gap:0;">${bars}</span>` +
        `<span style="color:${col};font-weight:700;font-size:11px;margin-left:1px;">${up ? '\u25b2' : '\u25bc'}</span>`;
    }

    // ── Render — driven exclusively by rsKwData pushed from populateKeywordPanel
    // No independent API call here. Single source of truth = sidebar's KW_OVERVIEW.
    const render = (data) => {
      data = data || {};
      const isEstimate = data.estimated === true;
      const volNum = data.volume || 0;
      const volTxt = volNum > 0 ? (isEstimate ? '~' : '') + fmtNum(volNum) : '\u2014';
      const volColor = volNum > 10000 ? '#16a34a' : volNum > 1000 ? '#ca8a04' : '#475569';

      // Pill shows VOL only — no CPC, COMP, trend, or est label.
      bar.innerHTML =
        `<span style="font-weight:700;color:#0D9488;font-size:11px;letter-spacing:.03em;">VOL</span>` +
        sep() +
        `<span style="font-weight:800;color:${volColor};font-size:12px;">${volTxt}</span>`;
    };

    // ── Register callback so populateKeywordPanel can push data to us ───────
    // If data already arrived before us (race condition), render it now.
    rsPillRender = render;
    if (rsKwData && rsKwData.volume > 0) {
      render(rsKwData);
    }
    // If no data yet, the "VOL loading…" placeholder stays until the sidebar
    // fires rsPillRender once its estimate or real API response arrives.
  }


  // ─── 2. TOP 10 COMPETITORS ────────────────────────────────────────────────
  function buildCompetitorPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
    const body = `<div id="rs-comp-body"><div class="rs-loading-row"><div class="rs-spin"></div>Results loading…</div></div>`;
    return makePanel('rs-panel-comp', svg, 'Top 10 Competitors', body, false);
  }

  function populateCompetitorPanel(results) {
    const container = document.getElementById('rs-comp-body');
    if (!container) return;

    if (!results || results.length === 0) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:11px;">No results found</div>';
      return;
    }

    // Show table immediately with domains, then load DA + DR async
    let rows = results.slice(0, 10).map((r, i) => `
      <tr>
        <td><div class="rs-domain-cell"><span class="rs-rank-num">${i + 1}</span><span class="rs-domain-name" title="${r.domain}">${r.domain}</span></div></td>
        <td class="rs-val-cell" id="rs-c-da-${i}" style="color:#94a3b8">…</td>
        <td class="rs-val-cell" id="rs-c-dr-${i}" style="color:#94a3b8">…</td>
        <td class="rs-val-cell" id="rs-c-spam-${i}" style="color:#94a3b8">…</td>
        <td class="rs-val-cell" id="rs-c-bl-${i}" style="color:#94a3b8">…</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table class="rs-comp-table">
        <thead><tr>
          <th>Domain</th>
          <th class="right">DA</th>
          <th class="right" title="Ahrefs Domain Rating" style="color:#f97316;">DR</th>
          <th class="right">Spam</th>
          <th class="right">BL</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    // Load DA + DR for each domain
    results.slice(0, 10).forEach((r, i) => {
      // Seed the shared store so filters/stats line up with table rows
      rsDomainData[i] = rsDomainData[i] || { domain: r.domain };
      rsDomainData[i].domain = r.domain;
      // DA / Spam / BL are loaded for ALL rows in ONE batched call after this
      // loop (see loadCompetitorMozBatch) — fetching them per-row here made 10
      // requests fight over the single mozLimit queue and stick on "--".
      // Ahrefs DR (async) — retry up to twice on a throttled miss
      const loadDR = (attempt) => chrome.runtime.sendMessage({ action: 'AHREFS_DR_FETCH', domain: r.domain }, (res) => {
        const drEl = document.getElementById(`rs-c-dr-${i}`);
        if (!chrome.runtime.lastError && res && res.ok && res.domainRating != null) {
          const dr = Math.round(res.domainRating);
          rsDomainData[i].dr = dr;
          if (drEl) {
            drEl.textContent = dr;
            // Use Ahrefs orange-tinted scale for DR to distinguish from blue DA
            drEl.style.color = dr >= 70 ? '#10b981' : dr >= 40 ? '#f59e0b' : dr >= 20 ? '#f97316' : '#ef4444';
            drEl.title = `Ahrefs DR ${dr}/100`;
          }
        } else if (attempt < 5) {
          setTimeout(() => loadDR(attempt + 1), 1800);
          return;
        } else if (drEl) {
          drEl.textContent = '--';
          drEl.style.color = '#94a3b8';
        }
        refreshStatsPanel();
        applySerpFilters();
        if (typeof refreshNichePanel === 'function') refreshNichePanel();
        const cnt = document.getElementById('rs-set-count');
        if (cnt) cnt.textContent = 'Cache: ' + rsDomainData.filter(d => d && typeof d.dr === 'number').length + ' domains';
      });
      loadDR(0);
      // Traffic (KE → SimilarWeb → SEMrush) — refresh niche tiles when it lands
      chrome.runtime.sendMessage({ action: 'TRAFFIC_FETCH', domain: r.domain }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.ok && res.visits != null) {
          rsDomainData[i].traffic = res.visits;
          refreshStatsPanel();
          if (typeof refreshNichePanel === 'function') refreshNichePanel();
        }
      });
      // Domain age via RDAP — also feed Niche Opportunity tiles
      chrome.runtime.sendMessage({ action: 'RDAP_LOOKUP', domain: r.domain }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.ok && res.createdDate) {
          const created = new Date(res.createdDate);
          if (!isNaN(created)) {
            const ms = Date.now() - created.getTime();
            const years = ms / (365.25 * 24 * 3600 * 1000);
            rsDomainData[i].ageYears = years;
            const days = Math.floor(ms / (24 * 3600 * 1000));
            const yWhole = Math.floor(years);
            const months = Math.round((years - yWhole) * 12);
            if (days < 30) {
              rsDomainData[i].ageLabel = Math.max(0, days) + 'd';
            } else if (yWhole < 1) {
              rsDomainData[i].ageLabel = Math.max(1, months || 1) + 'm';
            } else {
              rsDomainData[i].ageLabel = yWhole + 'y' + (months ? ' ' + months + 'm' : '');
            }
            refreshStatsPanel();
            applySerpFilters();
            if (typeof refreshNichePanel === 'function') refreshNichePanel();
          }
        }
      });
    });

    // ── Batch-load DA / Spam / BL for the whole table in ONE request ──
    loadCompetitorMozBatch(results.slice(0, 10));
  }

  // One Keywords-Everywhere call fills DA / Spam / BL for every competitor row
  // at once. Per-row MOZ_FETCH previously made 10 requests contend over the
  // single mozLimit queue (shared with the overlay + other panels), so they
  // didn't resolve inside the retry window and the columns stuck on "--".
  // Retries only the rows KWE omitted, then marks the rest "--".
  function normDom(d) {
    return String(d || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase().trim();
  }
  function lookupMozMap(map, domain) {
    if (!map || !domain) return null;
    const key = normDom(domain);
    if (map[key]) return map[key];
    if (map[domain]) return map[domain];
    // fuzzy: any result whose domain normalizes to the same key
    for (const k of Object.keys(map)) {
      if (normDom(k) === key || normDom(map[k].domain) === key) return map[k];
    }
    return null;
  }

  // Overlay often has DA badges before MOZ_FETCH_BATCH resolves — scrape them
  // so Niche Opportunity / Easy-Win don't stay stuck on "Waiting…".
  function scrapeOverlayDaIntoRsDomainData() {
    try {
      const nodes = document.querySelectorAll('[data-rs-da], .rankseo-da, .rs-da-badge, [class*="rankseo"] [title*="Domain Authority"], [title*="DA "]');
      // Primary: ShahzaibSEO overlay pills next to each result — text like "DA 40"
      document.querySelectorAll('a[href^="http"]').forEach(a => {
        try {
          const host = normDom(new URL(a.href).hostname);
          if (!host) return;
          // Walk up a few parents for metric badges
          let root = a;
          for (let i = 0; i < 6 && root; i++) root = root.parentElement;
          if (!root) return;
          const txt = root.innerText || '';
          const m = txt.match(/\bDA\s*[:\s]?(\d{1,3})\b/i);
          if (!m) return;
          const da = parseInt(m[1], 10);
          if (!Number.isFinite(da) || da < 0 || da > 100) return;
          // Find matching rsDomainData row
          for (let i = 0; i < rsDomainData.length; i++) {
            if (rsDomainData[i] && normDom(rsDomainData[i].domain) === host) {
              if (typeof rsDomainData[i].da !== 'number') rsDomainData[i].da = da;
              break;
            }
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  function loadCompetitorMozBatch(rows, attempt) {
    attempt = attempt || 0;
    const domains = rows.map(r => r.domain).filter(Boolean);
    if (!domains.length) return;
    chrome.runtime.sendMessage({ action: 'MOZ_FETCH_BATCH', domains }, (res) => {
      const map = (!chrome.runtime.lastError && res && res.ok && res.results) ? res.results : null;
      const missing = [];
      rows.forEach((r, i) => {
        const m = lookupMozMap(map, r.domain);
        const daEl = document.getElementById(`rs-c-da-${i}`);
        const spamEl = document.getElementById(`rs-c-spam-${i}`);
        const blEl = document.getElementById(`rs-c-bl-${i}`);
        if (m && m.ok) {
          if (typeof m.domainAuthority === 'number') rsDomainData[i].da = m.domainAuthority;
          if (typeof m.backlinks === 'number') rsDomainData[i].backlinks = m.backlinks;
          // Moz sometimes returns -1 for unknown spam — treat as 0 / unknown
          if (typeof m.spamScore === 'number' && m.spamScore >= 0) rsDomainData[i].spam = m.spamScore;
          else if (typeof m.spamScore === 'number' && m.spamScore < 0) rsDomainData[i].spam = null;
          if (daEl) { daEl.textContent = m.domainAuthority != null ? m.domainAuthority : '--'; daEl.style.color = daColor(m.domainAuthority); }
          const spamVal = (typeof m.spamScore === 'number' && m.spamScore >= 0) ? m.spamScore : null;
          if (spamEl) {
            spamEl.textContent = spamVal != null ? spamVal + '%' : '--';
            spamEl.style.color = spamVal != null ? spamColor(spamVal) : '#94a3b8';
          }
          if (blEl) { blEl.textContent = fmtNum(m.backlinks || 0); blEl.style.color = '#0D9488'; }
        } else {
          missing.push(i);
        }
      });
      if (typeof scrapeOverlayDaIntoRsDomainData === 'function') scrapeOverlayDaIntoRsDomainData();
      refreshStatsPanel();
      if (typeof refreshNichePanel === 'function') refreshNichePanel();
      applySerpFilters();
      if (missing.length && attempt < 3) {
        setTimeout(() => loadCompetitorMozBatch(rows, attempt + 1), 1800);
      } else if (missing.length) {
        missing.forEach(i => {
          const daEl = document.getElementById(`rs-c-da-${i}`);
          const spamEl = document.getElementById(`rs-c-spam-${i}`);
          const blEl = document.getElementById(`rs-c-bl-${i}`);
          if (daEl && daEl.textContent === '…') { daEl.textContent = '--'; daEl.style.color = '#94a3b8'; }
          if (spamEl && spamEl.textContent === '…') { spamEl.textContent = '--'; spamEl.style.color = '#94a3b8'; }
          if (blEl && blEl.textContent === '…') { blEl.textContent = '--'; blEl.style.color = '#94a3b8'; }
        });
      }
    });
  }


  // ─── SERP SCRAPER (full widget capture — Malaika Aman engine) ─────────────
  const RS_SCRAPE_TYPE_COLORS = {
    'Sponsored': '#ea4335', 'Shopping': '#f9ab00', 'AI Overview': '#a142f4',
    'Featured Snippet': '#34a853', 'Knowledge Panel': '#4285f4',
    'People Also Ask': '#fbbc04', 'Video': '#db4437', 'Image Pack': '#0f9d58',
    'Top Stories': '#1a73e8', 'Discussions and Forums': '#e8710a',
    'Local Pack': '#188038', 'Organic': '#1967d2', 'Related Search': '#5f6368'
  };

  function buildSerpScraperPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M4 7h16M4 12h10M4 17h14"/><circle cx="18" cy="17" r="3"/></svg>`;
    const body = `
      <style>
        #rs-scrape-body { padding: 4px 0 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
        #rs-scrape-body .rs-sc-toolbar {
          display: flex; flex-wrap: nowrap; gap: 6px; margin-bottom: 10px;
          align-items: stretch; width: 100%;
        }
        #rs-scrape-body .rs-sc-btn {
          flex: 1 1 0; min-width: 0;
          font-size: 11px; font-weight: 700; padding: 8px 6px; border-radius: 8px;
          border: 1px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer;
          transition: .15s; white-space: nowrap; text-align: center; line-height: 1.2;
        }
        #rs-scrape-body .rs-sc-btn:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; color: #0f172a; }
        #rs-scrape-body .rs-sc-btn:disabled { opacity: .4; cursor: not-allowed; }
        #rs-scrape-body .rs-sc-btn-primary {
          flex: 1.4 1 0;
          background: #0D9488; color: #fff; border-color: #0D9488;
          box-shadow: 0 1px 2px rgba(13,148,136,.2);
        }
        #rs-scrape-body .rs-sc-btn-primary:hover:not(:disabled) {
          background: #0f766e; border-color: #0f766e; color: #fff;
        }
        #rs-scrape-body #rs-scrape-stats {
          font-size: 11px; font-weight: 650; color: #64748b; margin: 0 0 6px;
        }
        #rs-scrape-body .rs-sc-chip {
          font-size: 10px; font-weight: 650; padding: 4px 10px; border-radius: 999px;
          border: 1.5px solid transparent; cursor: pointer; transition: all .12s;
          display: inline-flex; align-items: center; gap: 4px;
        }
        #rs-scrape-body #rs-scrape-chips {
          display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0 10px;
        }
        #rs-scrape-body #rs-scrape-filter {
          width: 100%; box-sizing: border-box;
          border: 1px solid #e2e8f0; border-radius: 8px;
          padding: 8px 10px; font-size: 12px; color: #0f172a;
          margin-bottom: 8px; background: #fff; outline: none;
        }
        #rs-scrape-body #rs-scrape-filter:focus {
          border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20,184,166,.12);
        }
        #rs-scrape-body .rs-sc-table-wrap {
          max-height: 360px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px;
          background: #fff;
        }
        #rs-scrape-body .rs-sc-table {
          width: 100%; border-collapse: collapse; table-layout: fixed;
        }
        #rs-scrape-body .rs-sc-table col.c-pos { width: 28px; }
        #rs-scrape-body .rs-sc-table col.c-type { width: 78px; }
        #rs-scrape-body .rs-sc-table col.c-title { width: auto; }
        #rs-scrape-body .rs-sc-table col.c-url { width: 34%; }
        #rs-scrape-body .rs-sc-table th {
          position: sticky; top: 0; z-index: 1; background: #f8fafc; text-align: left;
          padding: 8px 8px; font-size: 9px; font-weight: 750; color: #64748b;
          border-bottom: 1px solid #e2e8f0; text-transform: uppercase; letter-spacing: .04em;
        }
        #rs-scrape-body .rs-sc-table td {
          padding: 8px; font-size: 11px; border-bottom: 1px solid #f1f5f9; vertical-align: top;
        }
        #rs-scrape-body .rs-sc-table tr:hover td { background: #f0fdfa; }
        #rs-scrape-body .rs-sc-pos {
          color: #94a3b8; font-variant-numeric: tabular-nums; font-weight: 650; font-size: 11px;
        }
        #rs-scrape-body .rs-sc-type {
          font-weight: 750; font-size: 10px; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        }
        #rs-scrape-body .rs-sc-title {
          color: #0f172a; font-size: 11.5px; font-weight: 600; line-height: 1.35;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden; word-break: break-word;
        }
        #rs-scrape-body .rs-sc-urlcell { overflow: hidden; }
        #rs-scrape-body .rs-sc-url {
          display: flex; flex-direction: column; gap: 1px;
          color: #0D9488; text-decoration: none; min-width: 0;
        }
        #rs-scrape-body .rs-sc-url:hover .rs-sc-host { text-decoration: underline; }
        #rs-scrape-body .rs-sc-host {
          font-size: 11px; font-weight: 700; color: #0f766e;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        #rs-scrape-body .rs-sc-path {
          font-size: 9.5px; color: #94a3b8; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        #rs-scrape-body .rs-sc-na { color: #cbd5e1; }
        #rs-scrape-body .rs-sc-empty {
          padding: 22px 12px; text-align: center; color: #94a3b8; font-size: 12px;
        }
        #rs-scrape-body #rs-scrape-domains {
          margin: 8px 0 4px; font-size: 10.5px; line-height: 1.55; color: #64748b;
          word-break: break-word;
        }
        #rs-scrape-body #rs-scrape-domains a {
          color: #0D9488; text-decoration: none; font-weight: 650;
        }
        #rs-scrape-body #rs-scrape-domains a:hover { text-decoration: underline; }
        #rs-scrape-body .rs-sc-comp {
          display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 4px 0 8px;
          font-size: 10.5px; font-weight: 650;
        }
        #rs-scrape-body .rs-sc-comp-item {
          display: inline-flex; align-items: center; gap: 5px; color: #475569;
        }
        #rs-scrape-body .rs-sc-dot {
          width: 7px; height: 7px; border-radius: 50%; flex: none;
        }

        /* Card list layout (narrow sidebar friendly) */
        #rs-scrape-body .rs-sc-table-wrap {
          max-height: 380px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px;
          background: #fff; padding: 4px;
        }
        #rs-scrape-body .rs-sc-list { display: flex; flex-direction: column; gap: 2px; }
        #rs-scrape-body .rs-sc-card {
          padding: 8px 10px; border-radius: 8px; border: 1px solid transparent;
          transition: background .12s;
        }
        #rs-scrape-body .rs-sc-card:hover { background: #f0fdfa; border-color: #ccfbf1; }
        #rs-scrape-body .rs-sc-card-top {
          display: flex; align-items: center; gap: 8px; margin-bottom: 3px;
        }
        #rs-scrape-body .rs-sc-pos {
          font-size: 11px; font-weight: 750; color: #94a3b8;
          font-variant-numeric: tabular-nums; min-width: 16px;
        }
        #rs-scrape-body .rs-sc-type {
          font-size: 10px; font-weight: 750; padding: 2px 7px; border-radius: 999px;
          border: 1px solid; white-space: nowrap; line-height: 1.3;
        }
        #rs-scrape-body .rs-sc-card-title {
          font-size: 12px; font-weight: 650; color: #0f172a; line-height: 1.35;
          margin: 0 0 3px; word-break: break-word;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        #rs-scrape-body .rs-sc-link {
          display: block; text-decoration: none; min-width: 0;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          font-size: 11px; line-height: 1.3;
        }
        #rs-scrape-body .rs-sc-host { color: #0f766e; font-weight: 700; }
        #rs-scrape-body .rs-sc-path { color: #94a3b8; font-weight: 500; margin-left: 1px; }
        #rs-scrape-body .rs-sc-link:hover .rs-sc-host { text-decoration: underline; }
        #rs-scrape-body .rs-sc-na { font-size: 11px; color: #cbd5e1; }
        /* Top domains chips */
        #rs-scrape-body #rs-scrape-domains { margin: 6px 0 10px; }
        #rs-scrape-body .rs-sc-dom-label {
          font-size: 10px; font-weight: 750; color: #64748b; text-transform: uppercase;
          letter-spacing: .04em; margin-bottom: 6px;
        }
        #rs-scrape-body .rs-sc-dom-list {
          display: flex; flex-wrap: wrap; gap: 5px;
        }
        #rs-scrape-body .rs-sc-dom-chip {
          display: inline-flex; align-items: center; gap: 5px;
          max-width: 100%; padding: 3px 8px; border-radius: 6px;
          background: #f1f5f9; border: 1px solid #e2e8f0;
          font-size: 10.5px; color: #334155; font-weight: 600;
        }
        #rs-scrape-body .rs-sc-dom-chip b {
          font-weight: 800; color: #0f766e; font-variant-numeric: tabular-nums;
        }
        #rs-scrape-body .rs-sc-dom-chip span {
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;
        }
      </style>
      <div id="rs-scrape-body">
        <div class="rs-sc-toolbar">
          <button type="button" id="rs-scrape-run" class="rs-sc-btn rs-sc-btn-primary">Scan</button>
          <button type="button" id="rs-scrape-copy" class="rs-sc-btn" disabled title="Copy to clipboard">Copy</button>
          <button type="button" id="rs-scrape-csv" class="rs-sc-btn" disabled>CSV</button>
          <button type="button" id="rs-scrape-json" class="rs-sc-btn" disabled>JSON</button>
          <button type="button" id="rs-scrape-md" class="rs-sc-btn" disabled>MD</button>
        </div>
        <div id="rs-scrape-stats" style="font-size:11px;font-weight:600;color:#0f766e;margin-bottom:6px;min-height:16px;"></div>
        <div id="rs-scrape-compbar" style="display:flex;height:7px;border-radius:4px;overflow:hidden;background:#e2e8f0;margin-bottom:6px;"></div>
        <div id="rs-scrape-badges" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;"></div>
        <div id="rs-scrape-domains" style="font-size:10px;color:#64748b;margin-bottom:6px;"></div>
        <div id="rs-scrape-chips" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;"></div>
        <input id="rs-scrape-filter" type="search" placeholder="Search title or URL..." autocomplete="off">
        <div id="rs-scrape-table" class="rs-sc-table-wrap">
          <div class="rs-sc-empty">
            <div style="font-size:20px;margin-bottom:6px;">⌕</div>
            Click <b style="color:#0D9488;">Scan SERP</b> to capture Organic, Ads, AI Overview, PAA, Videos, Shopping…
            <div style="margin-top:6px;font-size:10px;">User-initiated · stays in your browser</div>
          </div>
        </div>
        <div class="rs-sc-privacy">🔒 Local only — results are not uploaded. Native Google widgets only; other extensions ignored.</div>
      </div>`;
    return makePanel('rs-panel-scraper', svg, 'SERP Scraper', body, false);
  }

  let _rsScrapeRows = [];
  let _rsScrapeActiveTypes = null; // null = all

  function setupSerpScraperPanel() {
    const runBtn = document.getElementById('rs-scrape-run');
    if (!runBtn || runBtn.dataset.bound) return;
    runBtn.dataset.bound = '1';
    runBtn.addEventListener('click', () => runSerpScrape(false));
    document.getElementById('rs-scrape-copy')?.addEventListener('click', () => exportScrape('copy'));
    document.getElementById('rs-scrape-csv')?.addEventListener('click', () => exportScrape('csv'));
    document.getElementById('rs-scrape-json')?.addEventListener('click', () => exportScrape('json'));
    document.getElementById('rs-scrape-md')?.addEventListener('click', () => exportScrape('md'));
    document.getElementById('rs-scrape-filter')?.addEventListener('input', () => renderScrapeTable());
  }

  async function runSerpScrape(skipSettle) {
    const runBtn = document.getElementById('rs-scrape-run');
    const table = document.getElementById('rs-scrape-table');
    const stats = document.getElementById('rs-scrape-stats');
    if (!table) return;
    if (typeof RSSerpScrape !== 'function') {
      table.innerHTML = '<div style="padding:12px;color:#dc2626;font-size:11px;">Scraper engine not loaded. Reload the extension.</div>';
      return;
    }
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = '…'; }
    table.innerHTML = '<div class="rs-loading-row" style="padding:12px;"><div class="rs-spin"></div> Scanning native Google widgets…</div>';
    try {
      const rows = await RSSerpScrape({ skipSettle: !!skipSettle });
      _rsScrapeRows = Array.isArray(rows) ? rows : [];
      _rsScrapeActiveTypes = null;
      renderScrapeComposition();
      renderScrapeChips();
      renderScrapeTable();
      renderScrapeDomains();
      if (stats) {
        stats.textContent = _rsScrapeRows.length ? ('Found ' + _rsScrapeRows.length + ' results') : 'No results';
      }
      ['rs-scrape-copy','rs-scrape-csv','rs-scrape-json','rs-scrape-md'].forEach(id => {
        const b = document.getElementById(id); if (b) b.disabled = !_rsScrapeRows.length;
      });
    } catch (e) {
      table.innerHTML = '<div style="padding:12px;color:#dc2626;font-size:11px;">Scan failed: ' + (e && e.message ? e.message : String(e)) + '</div>';
    } finally {
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Scan'; }
    }
  }

  function renderScrapeChips() {
    const host = document.getElementById('rs-scrape-chips');
    if (!host) return;
    const counts = {};
    _rsScrapeRows.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
    const types = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    host.innerHTML = types.map(ty => {
      const col = RS_SCRAPE_TYPE_COLORS[ty] || '#64748b';
      const on = !_rsScrapeActiveTypes || _rsScrapeActiveTypes.has(ty);
      const filled = _rsScrapeActiveTypes && _rsScrapeActiveTypes.has(ty);
      const style = filled
        ? `border-color:${col};background:${col};color:#fff;`
        : `border-color:${col};background:transparent;color:${col};`;
      return `<button type="button" class="rs-sc-chip" data-type="${ty.replace(/"/g,'')}" style="${style}">${ty.replace('People Also Ask','PAA')}</button>`;
    }).join('');
    host.querySelectorAll('.rs-sc-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const ty = btn.getAttribute('data-type');
        if (!_rsScrapeActiveTypes) _rsScrapeActiveTypes = new Set(Object.keys(counts));
        if (_rsScrapeActiveTypes.has(ty)) _rsScrapeActiveTypes.delete(ty);
        else _rsScrapeActiveTypes.add(ty);
        if (_rsScrapeActiveTypes.size === 0) _rsScrapeActiveTypes = null;
        renderScrapeChips();
        renderScrapeTable();
      });
    });
  }

  function renderScrapeComposition() {
    const bar = document.getElementById('rs-scrape-compbar');
    const badges = document.getElementById('rs-scrape-badges');
    if (!bar || !badges) return;
    bar.innerHTML = '';
    badges.innerHTML = '';
    if (!_rsScrapeRows.length) return;
    const counts = {};
    _rsScrapeRows.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
    const total = _rsScrapeRows.length;
    Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(type => {
      const pct = counts[type] / total * 100;
      const col = RS_SCRAPE_TYPE_COLORS[type] || '#94a3b8';
      const seg = document.createElement('span');
      seg.style.cssText = 'height:100%;width:' + Math.max(pct, 1.5) + '%;background:' + col + ';';
      seg.title = type + ': ' + counts[type];
      bar.appendChild(seg);
      const b = document.createElement('span');
      b.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:10px;background:#f1f5f9;font-weight:600;border-left:3px solid ' + col + ';';
      b.innerHTML = '<span style="color:' + col + '">●</span> ' + type.replace('People Also Ask','PAA').replace('Discussions and Forums','Forum') + ' ' + counts[type];
      badges.appendChild(b);
    });
  }

  function renderScrapeDomains() {
    const host = document.getElementById('rs-scrape-domains');
    if (!host) return;
    const freq = {};
    _rsScrapeRows.forEach(r => {
      if (!r.url) return;
      try {
        const h = new URL(r.url).hostname.replace(/^www\./, '');
        if (h) freq[h] = (freq[h] || 0) + 1;
      } catch (_) {}
    });
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!top.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="rs-sc-dom-label">Top domains</div><div class="rs-sc-dom-list">' +
      top.map(([d, n]) =>
        `<span class="rs-sc-dom-chip" title="${d}"><b>${n}</b><span>${d}</span></span>`
      ).join('') +
      '</div>';
  }


  function filteredScrapeRows() {
    const q = (document.getElementById('rs-scrape-filter')?.value || '').trim().toLowerCase();
    return _rsScrapeRows.filter(r => {
      if (_rsScrapeActiveTypes && !_rsScrapeActiveTypes.has(r.type)) return false;
      if (!q) return true;
      return (r.title || '').toLowerCase().includes(q) || (r.url || '').toLowerCase().includes(q) || (r.type || '').toLowerCase().includes(q);
    });
  }

  function renderScrapeTable() {
    const table = document.getElementById('rs-scrape-table');
    if (!table) return;
    const rows = filteredScrapeRows();
    if (!_rsScrapeRows.length) {
      table.innerHTML = `<div class="rs-sc-empty"><div style="font-size:20px;margin-bottom:6px;">⌕</div>Click <b style="color:#0D9488;">Scan</b> to capture results.</div>`;
      return;
    }
    if (!rows.length) {
      table.innerHTML = `<div class="rs-sc-empty">No matches for current filter / type chips.</div>`;
      return;
    }
    const body = rows.map(r => {
      const col = RS_SCRAPE_TYPE_COLORS[r.type] || '#64748b';
      let host = '', path = '';
      try {
        if (r.url) {
          const u = new URL(r.url);
          host = u.hostname.replace(/^www\./, '');
          path = (u.pathname + u.search).replace(/\/$/, '') || '';
        }
      } catch (_) {
        host = String(r.url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '';
      }
      const title = String(r.title || 'Untitled').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const href = r.url ? r.url.replace(/"/g, '&quot;') : '';
      const link = r.url
        ? `<a class="rs-sc-link" href="${href}" target="_blank" rel="noopener" title="${href}"><span class="rs-sc-host">${host}</span>${path ? `<span class="rs-sc-path">${path}</span>` : ''}</a>`
        : '<span class="rs-sc-na">No URL</span>';
      return `<article class="rs-sc-card">
        <div class="rs-sc-card-top">
          <span class="rs-sc-pos">${r.position}</span>
          <span class="rs-sc-type" style="color:${col};border-color:${col}33;background:${col}14">${r.type}</span>
        </div>
        <div class="rs-sc-card-title" title="${title.replace(/"/g, '&quot;')}">${title}</div>
        ${link}
      </article>`;
    }).join('');
    table.innerHTML = `<div class="rs-sc-list">${body}</div>`;
  }

  function exportScrape(fmt) {
    const rows = filteredScrapeRows();
    if (!rows.length) return;
    if (fmt === 'copy') {
      const text = rows.map(r => [r.position, r.type, r.title, r.url].join('\t')).join('\n');
      navigator.clipboard.writeText('Pos\tType\tTitle\tURL\n' + text).catch(() => {});
      return;
    }
    if (fmt === 'json') {
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      downloadBlob(blob, 'serp-scrape.json');
      return;
    }
    if (fmt === 'csv') {
      const esc = v => '"' + String(v || '').replace(/"/g, '""') + '"';
      const lines = ['position,type,title,url'].concat(rows.map(r => [r.position, r.type, r.title, r.url].map(esc).join(',')));
      downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), 'serp-scrape.csv');
      return;
    }
    if (fmt === 'md') {
      const lines = ['| # | Type | Title | URL |', '|---|------|-------|-----|'].concat(
        rows.map(r => `| ${r.position} | ${r.type} | ${String(r.title||'').replace(/\|/g,'\\|')} | ${r.url || ''} |`)
      );
      downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown' }), 'serp-scrape.md');
    }
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ─── 3. SERP FEATURES DETECTOR ────────────────────────────────────────────
  function buildSerpFeaturesPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

    const features = detectSerpFeatures();
    const chips = features.map(f =>
      `<span class="rs-feature-chip ${f.present ? 'present' : 'absent'}" title="${f.desc}">
        ${f.present ? '✓' : '-'} ${f.name}
      </span>`
    ).join('');

    const body = `
      <div class="rs-feature-chips">${chips}</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:8px;">✓ = active on this SERP &nbsp; - = not detected</div>
    `;
    return makePanel('rs-panel-serp', svg, 'SERP Features Detected', body, true);
  }

  function detectSerpFeatures() {
    const body = document.body;
    const text = body.innerHTML;
    return [
      { name: 'Featured Snippet', present: !!document.querySelector('[data-attrid="wa:/description"]') || text.includes('Featured snippet'), desc: 'Featured snippet / answer box' },
      { name: 'People Also Ask', present: !!document.querySelector('[jsname="yEVEwb"]') || !!document.querySelector('.related-question-pair') || text.includes('People also ask'), desc: 'People Also Ask box' },
      { name: 'Local Pack', present: !!document.querySelector('.VkpGBb') || !!document.querySelector('[data-local-attribute]') || text.includes('local pack'), desc: 'Google Local Pack / Map' },
      { name: 'AI Overview',   present: !!document.querySelector('[data-attrid="kc:/collection/films:starring"]') || text.includes('AI Overview') || !!document.querySelector('div[id="m-x-content"]'), desc: 'Google AI Overview' },
      { name: 'Image Pack',    present: !!document.querySelector('.MjjYud .isv-r') || text.includes('Images for'), desc: 'Image Pack in results' },
      { name: 'Video Results', present: !!document.querySelector('[data-hveid] a[href*="youtube"]') || text.includes('youtube.com/watch'), desc: 'Video results present' },
      { name: 'Sitelinks',     present: !!document.querySelector('.HiHjCd') || !!document.querySelector('[data-sncf="1"]'), desc: 'Sitelinks on first result' },
      { name: 'Shopping',      present: text.includes('Shopping') && !!document.querySelector('[aria-label*="Shopping"]'), desc: 'Google Shopping box' },
      { name: 'Knowledge Panel', present: !!document.querySelector('#kp-wp-tab-overview') || !!document.querySelector('.kp-wholepage'), desc: 'Knowledge Panel on right' },
      { name: 'Top Stories',   present: !!document.querySelector('[aria-label="Top stories"]') || text.includes('Top stories'), desc: 'Top Stories / News box' },
    ];
  }

  // ─── 4. RELATED KEYWORDS ──────────────────────────────────────────────────
  function buildRelatedPanel(query) {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="12" r="10"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    const body = `
      <div id="rs-related-body">
        <div class="rs-loading-row"><div class="rs-spin"></div>Keywords extract ho rahe hain…</div>
      </div>
    `;
    return makePanel('rs-panel-related', svg, 'Related Keywords', body, true);
  }

  function populateRelatedPanel(query) {
    const container = document.getElementById('rs-related-body');
    if (!container) return;

    // Extract from page: "Related searches", "People also search for", PAA questions
    const related = new Set();

    // Related searches at bottom
    document.querySelectorAll('.s75CSd, .AB4Wff, [data-q]').forEach(el => {
      const t = el.textContent.trim();
      if (t && t.length > 3 && t.length < 60 && t !== query) related.add(t);
    });

    // Autocomplete suggestions from hidden elements
    document.querySelectorAll('a.k8XOCe, .Q71vJc').forEach(el => {
      const t = el.textContent.trim();
      if (t && t !== query) related.add(t);
    });

    // PAA questions
    document.querySelectorAll('.related-question-pair .iDjcJe, [jsname="yEVEwb"] .iDjcJe').forEach(el => {
      const t = el.textContent.trim();
      if (t) related.add(t);
    });

    // "Searches related to" section
    document.querySelectorAll('#bres a, .g a[href*="/search?q="]').forEach(el => {
      const href = el.getAttribute('href') || '';
      if (href.includes('/search?q=') || href.includes('&q=')) {
        const q2 = new URL('https://google.com' + href).searchParams.get('q');
        if (q2 && q2 !== query && q2.length < 60) related.add(q2);
      }
    });

    const arr = [...related].slice(0, 16);

    if (arr.length === 0) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:11px;">No related keywords found. Check the "Searches related to" section at the bottom of this page.</div>';
      return;
    }

    const renderRelated = (volMap) => {
      const tags = arr.map(kw => {
        const safe = kw.replace(/'/g, "\\'").replace(/</g, '');
        const vol = volMap && volMap[kw.toLowerCase()];
        const volBadge = (vol != null && vol >= 0)
          ? `<span style="margin-left:4px;font-size:9px;font-weight:700;color:#0d9488;background:#ecfdf5;padding:1px 5px;border-radius:999px;">${fmtNum(vol)}</span>`
          : '';
        return `<span class="rs-tag" onclick="navigator.clipboard.writeText('${safe}').then(()=>window._rsToast('Copied: ${truncate(kw, 20).replace(/'/g, "\\'")}'))">
          ${truncate(kw, 32)}${volBadge} <span class="rs-tag-copy">copy</span>
        </span>`;
      }).join('');
      container.innerHTML = `
        <div class="rs-related-tags">${tags}</div>
        <span class="rs-copy-all" onclick="navigator.clipboard.writeText(\`${arr.join('\\n').replace(/`/g, '\\`')}\`).then(()=>window._rsToast('${arr.length} keywords copied!'))">
          Copy all ${arr.length} keywords
        </span>
      `;
    };

    renderRelated(null);
    window._rsToast = showToast;

    // Enrich with real KE volumes when API key is configured (uses credits)
    try {
      chrome.storage.sync.get(['keApiKey', 'keEnabled', 'keUseRelatedVol'], r => {
        if (!r.keApiKey || r.keEnabled === false || r.keUseRelatedVol === false) return;
        let country = 'us';
        try {
          const gl = new URLSearchParams(location.search).get('gl');
          if (gl && /^[a-z]{2}$/i.test(gl)) country = gl.toLowerCase();
        } catch (_) {}
        chrome.runtime.sendMessage({
          action: 'BULK_KEYWORD_VOLUME',
          keywords: arr.slice(0, 20),
          country,
          includeDomainMetrics: false
        }, res => {
          void chrome.runtime.lastError;
          if (!res || !res.ok || !Array.isArray(res.rows)) return;
          const volMap = {};
          res.rows.forEach(row => {
            if (row && row.keyword != null && typeof row.volume === 'number') {
              volMap[String(row.keyword).toLowerCase()] = row.volume;
            }
          });
          if (Object.keys(volMap).length) renderRelated(volMap);
        });
      });
    } catch (_) {}
  }

  // ─── 5. AI CONTENT ANALYZER ───────────────────────────────────────────────
  function buildAIPanel(query) {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 8v4l2 2"/><path d="M18 2l4 4-4 4"/><path d="M22 6h-6"/></svg>`;
    const body = `
      <div id="rs-ai-body">
        <div class="rs-ai-loading">
          <div style="margin-bottom:8px;">🤖</div>
          <div>Analyzing top results…</div>
        </div>
      </div>
      <div style="margin-top:8px;text-align:center;">
        <button id="rs-ai-reanalyze-btn" style="
          background:#0D9488;color:#fff;border:none;border-radius:6px;
          padding:5px 14px;font-size:11px;font-weight:600;cursor:pointer;
          display:inline-flex;align-items:center;gap:5px;
        " title="Re-run AI analysis">
          &#x1F916; Analyze with AI
        </button>
      </div>
    `;
    return makePanel('rs-panel-ai', svg, 'AI Content Analyzer', body, true);
  }

  // ─── AI SERP Analysis (Groq built-in fallback + NVIDIA / OpenRouter / Grok) ──
  async function fetchNvidiaAIAnalysis(query, results) {
    try {
      const stored = await new Promise(res => {
        try {
          chrome.storage.local.get(
            ['aiProvider', 'nvidiaApiKey', 'nvidiaKey', 'openrouterApiKey', 'openrouterKey',
             'aiApiKey', 'groqApiKey', 'grokApiKey'], res);
        } catch(e) { res({}); }
      });
      let lsCfg = {};
      try {
        const raw = localStorage.getItem('rp-ai-config');
        if (raw) lsCfg = JSON.parse(raw);
      } catch(_) {}

      const nvidiaKey = stored.nvidiaApiKey || stored.nvidiaKey || stored.aiApiKey || lsCfg.nvidiaKey || '';
      const openrKey  = stored.openrouterApiKey || stored.openrouterKey || lsCfg.openrouterKey || '';
      const groqKey   = stored.groqApiKey || '';
      const grokKey   = stored.grokApiKey || '';
      // Prefer user provider if they have a key; otherwise always use Groq (built-in in background)
      let provider = stored.aiProvider || lsCfg.provider || 'groq';
      if (provider === 'nvidia' && !nvidiaKey) provider = 'groq';
      if (provider === 'openrouter' && !openrKey) provider = 'groq';
      if (provider === 'grok' && !grokKey) provider = 'groq';

      // Build prompt
      const top3 = results.slice(0, 3);
      const serpSummary = top3.map((r, i) =>
        `${i+1}. Title: "${r.title || 'N/A'}" | Domain: ${r.domain || 'N/A'} | Snippet: ${(r.snippet || '').slice(0, 120)}`
      ).join('\n');

      const prompt = `You are an expert SEO analyst. Analyze these top 3 Google search results for the query: "${query}"

SERP Data:
${serpSummary}

Provide a concise JSON response with these exact keys:
{
  "contentLength": "recommended word count range e.g. 1500-2500 words",
  "contentLengthReason": "1 sentence why",
  "titleTip": "1 actionable title optimization tip based on the patterns above",
  "mustKeywords": ["keyword1","keyword2","keyword3","keyword4","keyword5"],
  "searchIntent": "Informational|Navigational|Transactional|Commercial",
  "topGap": "1 sentence content gap opportunity",
  "checklist": ["tip1","tip2","tip3"]
}
Return only valid JSON, no markdown. Date context: September 2026.`;

      const bgResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'AI_SERP_ANALYZE',
          prompt,
          provider,
          nvidiaKey,
          openrKey,
          groqKey,
          grokKey
        }, (r) => {
          void chrome.runtime.lastError;
          resolve(r);
        });
      });

      if (!bgResp || !bgResp.ok) {
        console.debug('[ShahzaibSEO] AI analysis skipped:', bgResp?.error || 'no response');
        return null;
      }

      const text = bgResp.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      parsed._provider = bgResp.provider || provider;
      return parsed;

    } catch(e) {
      console.debug('[ShahzaibSEO] AI analysis skipped:', e.message);
      return null;
    }
  }

  function populateAIPanel(query, results) {
    const container = document.getElementById('rs-ai-body');
    if (!container) return;

    // Fallback: extract titles directly from page h3s if results empty
    if (!results || results.length === 0) {
      const h3s = [...document.querySelectorAll('#search h3')].slice(0, 3);
      results = h3s.map(h => {
        const a = h.closest('a') || h.querySelector('a');
        let domain = '';
        try { if (a) domain = new URL(a.href).hostname.replace(/^www\./, ''); } catch(e) {}
        return { title: h.textContent.trim(), domain, snippet: '' };
      });
    }

    // Local analysis (instant fallback)
    const top3 = results.slice(0, 3);
    const titles = top3.map(r => r.title || '');
    const hasNumbers = titles.some(t => /\d/.test(t));
    const hasYear = titles.some(t => /202[0-9]/.test(t));
    const avgTitleLen = titles.reduce((a, t) => a + t.length, 0) / (titles.length || 1);
    const allWords = titles.join(' ').toLowerCase().split(/\W+/).filter(w => w.length > 4);
    const wordFreq = {};
    allWords.forEach(w => wordFreq[w] = (wordFreq[w] || 0) + 1);
    const topWords = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    const isLongQuery = query.split(' ').length > 3;
    const targetWords = isLongQuery ? '1,500 – 2,500' : '2,000 – 3,500';

    function renderLocalAnalysis() {
      container.innerHTML = `
        <div class="rs-ai-query">"${truncate(query, 55)}" — top results analysis:</div>

        <div class="rs-ai-section">
          <div class="rs-ai-section-title">📝 Content Length Target</div>
          <div class="rs-ai-item"><div class="rs-ai-dot green"></div>${targetWords} words recommended (estimated from top 3 results)</div>
          <div class="rs-ai-item"><div class="rs-ai-dot amber"></div>Comprehensive coverage required — thin content will not rank</div>
        </div>

        <div class="rs-ai-section">
          <div class="rs-ai-section-title">🏷️ Title Patterns (Top 3)</div>
          ${hasNumbers ? `<div class="rs-ai-item"><div class="rs-ai-dot green"></div>Use numbers — "Top 10", "Best 5" style titles rank better</div>` : ''}
          ${hasYear ? `<div class="rs-ai-item"><div class="rs-ai-dot green"></div>Include year (${new Date().getFullYear()}) — freshness signal</div>` : ''}
          <div class="rs-ai-item"><div class="rs-ai-dot"></div>Avg title length: ~${Math.round(avgTitleLen)} chars (target: 50-60)</div>
        </div>

        <div class="rs-ai-section">
          <div class="rs-ai-section-title">🔑 Must-Use Keywords</div>
          <div class="rs-related-tags">
            ${topWords.map(w => `<span class="rs-tag">${w}</span>`).join('')}
          </div>
          <div style="font-size:10px;color:#94a3b8;margin-top:4px;">Extracted from top competitor titles</div>
        </div>

        <div class="rs-ai-section">
          <div class="rs-ai-section-title">✅ Checklist</div>
          <div class="rs-ai-item"><div class="rs-ai-dot green"></div>Place target keyword in H1</div>
          <div class="rs-ai-item"><div class="rs-ai-dot green"></div>Add Schema markup (Article/FAQ)</div>
          <div class="rs-ai-item"><div class="rs-ai-dot amber"></div>Internal links: min 3-5 relevant pages</div>
          <div class="rs-ai-item"><div class="rs-ai-dot amber"></div>Images with alt text (min 3-5)</div>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin-top:6px;padding-top:6px;border-top:1px solid #f1f5f9;">
          Click <strong>Analyze with AI</strong> — uses built-in Groq (or your NVIDIA / OpenRouter key if set)
        </div>
      `;
    }

    function renderAIAnalysis(ai) {
      const kwTags = (ai.mustKeywords || topWords).slice(0, 6).map(w => `<span class="rs-tag">${w}</span>`).join('');
      const checks = (ai.checklist || ['Place target keyword in H1','Add Schema markup (Article/FAQ)','Internal links: min 3-5 relevant pages']).map(c =>
        `<div class="rs-ai-item"><div class="rs-ai-dot green"></div>${c}</div>`
      ).join('');
      const prov = (ai._provider || 'groq').toString();
      container.innerHTML = `
        <div class="rs-ai-query" style="display:flex;align-items:center;gap:5px;">
          <span style="background:#0D9488;color:#fff;font-size:9px;padding:1px 5px;border-radius:8px;font-weight:700;">AI · ${prov}</span>
          "${truncate(query, 48)}" analysis:
        </div>

        <div class="rs-ai-section">
          <div class="rs-ai-section-title">📝 Content Length Target</div>
          <div class="rs-ai-item"><div class="rs-ai-dot green"></div>${ai.contentLength || targetWords} recommended</div>
          ${ai.contentLengthReason ? `<div class="rs-ai-item"><div class="rs-ai-dot amber"></div>${ai.contentLengthReason}</div>` : ''}
        </div>

        ${ai.searchIntent ? `
        <div class="rs-ai-section">
          <div class="rs-ai-section-title">Search Intent</div>
          <div class="rs-ai-item"><div class="rs-ai-dot green"></div>${ai.searchIntent}</div>
          ${ai.topGap ? `<div class="rs-ai-item"><div class="rs-ai-dot amber"></div><strong>Gap:</strong> ${ai.topGap}</div>` : ''}
        </div>` : ''}

        <div class="rs-ai-section">
          <div class="rs-ai-section-title">🏷️ Title Tip</div>
          <div class="rs-ai-item"><div class="rs-ai-dot green"></div>${ai.titleTip || 'Include primary keyword near the start of your title'}</div>
        </div>

        <div class="rs-ai-section">
          <div class="rs-ai-section-title">🔑 Must-Use Keywords</div>
          <div class="rs-related-tags">${kwTags}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:4px;">AI-powered keyword recommendations</div>
        </div>

        <div class="rs-ai-section">
          <div class="rs-ai-section-title">✅ AI Checklist</div>
          ${checks}
        </div>
      `;
    }

    // Try NVIDIA/OpenRouter AI first, fall back to local
    container.innerHTML = `<div class="rs-ai-loading"><div style="margin-bottom:8px;">🤖</div><div>AI analyzing SERP results…</div></div>`;
    fetchNvidiaAIAnalysis(query, results).then(ai => {
      if (ai) {
        renderAIAnalysis(ai);
      } else {
        renderLocalAnalysis();
      }
    }).catch(() => renderLocalAnalysis());
  }

  // ─── 6. RANK TRACKER ──────────────────────────────────────────────────────
  function buildRankPanel(query) {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
    const body = `
      <div class="rs-rank-input-row">
        <input class="rs-rank-input" id="rs-rank-domain-input" type="text" placeholder="your domain.com" />
        <button class="rs-rank-btn" onclick="window._rsCheckRank()">Check</button>
        <button class="rs-rank-clear" id="rs-rank-clear-btn" title="Remove saved site">\u2715</button>
      </div>
      <div class="rs-rank-saved" id="rs-rank-saved-note">Saved site loaded \u2014 click <b>Check</b> to scan</div>
      <div id="rs-rank-result-box"></div>
      <div style="font-size:10px;color:#94a3b8;margin-top:6px;">"${truncate(query, 40)}" — check your current SERP position</div>
    `;
    return makePanel('rs-panel-rank', svg, 'Rank Tracker', body, true);
  }

  // ─── Shared SERP fetch helpers (run in Google tab context — same-origin) ──
  const RS_TARGET   = 100;
  const RS_MAX_PAGES = 10;
  const rsSleep = ms => new Promise(r => setTimeout(r, ms));

  // ─── Shared: fetch a Google SERP page from content-script context ──────────
  // Uses credentials:'include' so the user's Google session/cookies are sent.
  // This is the only approach that reliably returns real HTML from Google.
  // ─── Shared: fetch a Google SERP page via background hidden tab ────────────
  // Direct fetch() from content scripts always 403s — Google blocks programmatic
  // requests even with credentials:'include' because it checks sec-ch-ua and other
  // browser-level headers that fetch() cannot set. The only reliable approach is
  // opening a real (hidden) tab via the background, which gets full browser headers.
  function rsFetchGooglePage(query, startOffset) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'SERP_FETCH_PAGE', query, startOffset: startOffset || 0 },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!res || !res.ok) {
            reject(new Error(res && res.error || 'SERP fetch failed'));
          } else {
            resolve(res.results || []);
          }
        }
      );
    });
  }

  // ─── Shared: extract organic results from a parsed Google page ───────────
  // Kept for any local HTML parsing paths; primary multi-page path uses
  // background SERP_FETCH_PAGE which has the same resolver logic.
  function rsExtractFromDoc(doc) {
    const out = [];
    const seen = new Set();

    function resolveHref(a, container) {
      if (!a) return null;
      let href = a.getAttribute('href') || a.href || '';
      if (href.startsWith('/url?') || href.includes('google.com/url?')) {
        try {
          const u = href.startsWith('http') ? new URL(href) : new URL(href, 'https://www.google.com');
          const q = u.searchParams.get('q') || u.searchParams.get('url');
          if (q && q.startsWith('http')) href = q;
        } catch (e) {}
      }
      if (/google\.[^/]+\/goto/i.test(href) || href.includes('/goto?')) {
        try {
          const u = new URL(href, 'https://www.google.com');
          let raw = u.searchParams.get('url') || u.searchParams.get('q') || '';
          if (raw) {
            if (raw.startsWith('http')) href = raw;
            else {
              try { const dec = decodeURIComponent(raw); if (dec.startsWith('http')) href = dec; } catch (e) {}
              if (!href.startsWith('http') || /google\.[^/]+\/goto/i.test(href)) {
                try {
                  let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
                  while (b64.length % 4) b64 += '=';
                  const decoded = atob(b64);
                  if (decoded.startsWith('http')) href = decoded;
                } catch (e) {}
              }
            }
          }
        } catch (e) {}
      }
      if (!href.startsWith('http') || /google\.[^/]+\/(goto|url)/i.test(href)) {
        const root = container || a.closest('.g, .MjjYud, .tF2Cxc, [data-hveid]') || a.parentElement;
        if (root) {
          const cite = root.querySelector('cite, .tjvcx, .qLRxge, .ulCwxb, .xBegd');
          if (cite) {
            let t = (cite.textContent || '').trim().split(/[›>]/)[0].trim()
              .replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\s\/]/)[0];
            if (t && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) href = 'https://' + t;
          }
        }
      }
      if (!href || !href.startsWith('http')) return null;
      try {
        const host = new URL(href).hostname.toLowerCase();
        if (host.includes('google.') || host.includes('gstatic.')) return null;
      } catch (e) { return null; }
      return href;
    }

    const containerSelectors = [
      '#rso .g', '#search .MjjYud', '#rso .MjjYud',
      '#search div.g:not(div.g div.g)', '.tF2Cxc', 'div.g', '.rc',
      'div[data-sokoban-container]', '#rso > div'
    ];

    let containers = [];
    for (const sel of containerSelectors) {
      containers = Array.from(doc.querySelectorAll(sel)).filter(el => {
        const h3 = el.querySelector('h3');
        const notAd = !el.querySelector('[data-text-ad]') && !el.closest('[data-text-ad]');
        return h3 && notAd;
      });
      if (containers.length >= 3) break;
    }

    const push = (h3, a, container) => {
      const href = resolveHref(a, container);
      if (!href) return;
      let domain = '';
      try { domain = new URL(href).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) {}
      if (!domain || domain.includes('google.') || seen.has(domain)) return;
      seen.add(domain);
      out.push({ title: (h3 && h3.textContent.trim()) || '', url: href, domain });
    };

    if (containers.length === 0) {
      doc.querySelectorAll('#search h3, #rso h3, #center_col h3').forEach(h3 => {
        const a = h3.closest('a[href]') || h3.querySelector('a[href]');
        if (!a) return;
        push(h3, a, h3.parentElement);
      });
      return out;
    }

    for (const el of containers) {
      const h3 = el.querySelector('h3');
      let a = el.querySelector('.yuRUbf > a[href], h3 a[href], a[href^="http"], a[href^="/url"], a[href*="/goto"]');
      if (!a) a = el.querySelector('a[href]');
      if (!a) continue;
      push(h3, a, el);
    }
    return out;
  }

  function setupRankTracker(serpResults) {
    let _rankRunning = false;
    let _rankCancelled = false;

    // Abort an in-progress scan. The loop checks _rankCancelled each step.
    function cancelCheck() {
      if (!_rankRunning) return;
      _rankCancelled = true;
      const btn = document.querySelector('#rs-panel-rank .rs-rank-btn');
      if (btn) { btn.textContent = 'Stopping…'; btn.disabled = true; }
    }
    window._rsCancelRank = cancelCheck;

    async function doCheck() {
      if (_rankRunning) return;
      const input = document.getElementById('rs-rank-domain-input');
      const box   = document.getElementById('rs-rank-result-box');
      if (!input || !box) return;

      const domainRaw = input.value.trim()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
      if (!domainRaw) { showToast('Please enter a domain first'); return; }

      _rankRunning = true;
      _rankCancelled = false;
      const savedNote = document.getElementById('rs-rank-saved-note');
      if (savedNote) savedNote.classList.remove('show');
      const btn = document.querySelector('#rs-panel-rank .rs-rank-btn');
      // Turn the Check button into a clickable Stop button for the scan's duration.
      if (btn) {
        btn.textContent = '\u2715 Stop';
        btn.disabled = false;
        btn.style.background = '#ef4444';
        btn.onclick = cancelCheck;
      }

      const progBox = (txt) => {
        box.innerHTML = '<div class="rs-rank-result">' +
          '<div class="rs-rank-big" style="font-size:14px;">\u23F3</div>' +
          '<div class="rs-rank-info">' +
          '<div class="rs-rank-domain">' + txt + '</div>' +
          '<div class="rs-rank-sub">Checking up to 100 results</div>' +
          '</div></div>';
      };
      progBox('Scanning page 1\u2026');

      try {
        const query = getQuery();
        let position = 0;
        let found = null;
        let emptyPages = 0;

        for (let page = 0; page < RS_MAX_PAGES && !found && emptyPages < 3; page++) {
          if (_rankCancelled) break;
          progBox('Scanning page ' + (page + 1) + ' of ' + RS_MAX_PAGES + '\u2026');
          await rsSleep(page === 0 ? 0 : 1200 + Math.random() * 800); // jitter avoids rate limit
          if (_rankCancelled) break;

          let pageResults = [];
          if (page === 0) {
            // Page 1: read from the LIVE DOM already on screen (always works)
            pageResults = collectSerpData();
          } else {
            // Pages 2-10: background opens a hidden tab with full browser headers
            // so Google sees a real navigation and returns proper HTML
            try {
              pageResults = await rsFetchGooglePage(query, page * 10);
            } catch(e) {
              emptyPages++;
              continue;
            }
          }
          if (_rankCancelled) break;

          if (pageResults.length === 0) { emptyPages++; continue; }
          emptyPages = 0;

          for (const r of pageResults) {
            position++;
            if (r.domain === domainRaw ||
                r.domain.endsWith('.' + domainRaw) ||
                domainRaw.endsWith('.' + r.domain)) {
              found = { position, url: r.url, title: r.title, page: page + 1 };
              break;
            }
          }
        }

        if (_rankCancelled) {
          box.innerHTML = '<div class="rs-rank-result not-found">' +
            '<div class="rs-rank-big not-found" style="font-size:13px;">Stopped</div>' +
            '<div class="rs-rank-info"><div class="rs-rank-sub">Scan cancelled' +
            (position ? ' after ' + position + ' results' : '') + '. Click Check to run again.</div></div>' +
            '</div>';
          return;
        }

        try { chrome.storage.local.set({ trackedDomain: domainRaw }); } catch(e) {}

        if (found) {
          box.innerHTML = '<div class="rs-rank-result">' +
            '<div class="rs-rank-big">#' + found.position + '</div>' +
            '<div class="rs-rank-info">' +
            '<div class="rs-rank-domain">' + domainRaw + '</div>' +
            '<div class="rs-rank-sub">Position #' + found.position + ' of ' + position + ' results scanned</div>' +
            '<div class="rs-rank-sub" style="margin-top:2px;">' + truncate(found.title || '', 45) + '</div>' +
            '<div class="rs-rank-sub" style="margin-top:4px;color:#10b981;font-weight:600;">\u2713 Found on page ' + found.page + '</div>' +
            '</div></div>';
        } else {
          box.innerHTML = '<div class="rs-rank-result not-found">' +
            '<div class="rs-rank-big not-found">Not in<br>Top ' + position + '</div>' +
            '<div class="rs-rank-info">' +
            '<div style="font-size:12px;font-weight:600;color:#991b1b;">' + domainRaw + '</div>' +
            '<div class="rs-rank-sub">Not found in ' + position + ' results</div>' +
            '<div class="rs-rank-sub" style="margin-top:4px;color:#6b7280;">Checked ' + RS_MAX_PAGES + ' SERP pages</div>' +
            '</div></div>';
        }

        // Save this check to history and render a trend chart below the result.
        try { rsSaveRankHistory(domainRaw, getQuery(), found ? found.position : 0, box); } catch(e) {}
      } catch(err) {
        box.innerHTML = '<div class="rs-rank-result not-found">' +
          '<div class="rs-rank-big not-found" style="font-size:13px;">Error</div>' +
          '<div class="rs-rank-info"><div class="rs-rank-sub">' + (err.message || 'Fetch failed') + '</div></div>' +
          '</div>';
      } finally {
        _rankRunning = false;
        _rankCancelled = false;
        if (btn) {
          btn.textContent = 'Check';
          btn.disabled = false;
          btn.style.background = '';
          btn.onclick = doCheck;
        }
      }
    }

    window._rsCheckRank = doCheck;

    // Remove the currently saved site: clears storage, input and result.
    function clearSavedSite() {
      const inp   = document.getElementById('rs-rank-domain-input');
      const box   = document.getElementById('rs-rank-result-box');
      const clr   = document.getElementById('rs-rank-clear-btn');
      const note  = document.getElementById('rs-rank-saved-note');
      try { chrome.storage.local.remove('trackedDomain'); } catch(e) {}
      if (inp)  inp.value = '';
      if (box)  box.innerHTML = '';
      if (clr)  clr.classList.remove('show');
      if (note) note.classList.remove('show');
      if (inp)  inp.focus();
      showToast('Saved site removed');
    }
    window._rsClearRank = clearSavedSite;

    // Show/hide the remove button depending on whether the input has a value.
    function syncClearBtn() {
      const inp = document.getElementById('rs-rank-domain-input');
      const clr = document.getElementById('rs-rank-clear-btn');
      if (clr) clr.classList.toggle('show', !!(inp && inp.value.trim()));
    }

    setTimeout(() => {
      const btn  = document.querySelector('#rs-panel-rank .rs-rank-btn');
      const inp  = document.getElementById('rs-rank-domain-input');
      const clr  = document.getElementById('rs-rank-clear-btn');
      const note = document.getElementById('rs-rank-saved-note');
      if (btn) btn.onclick = doCheck;
      if (clr) clr.onclick = clearSavedSite;
      if (inp) {
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') doCheck(); });
        inp.addEventListener('input', syncClearBtn);
        try {
          chrome.storage.local.get(['trackedDomain'], (prefs) => {
            if (prefs && prefs.trackedDomain) {
              // Pre-fill the saved site but DO NOT scan automatically.
              // The user starts the scan by clicking "Check".
              inp.value = prefs.trackedDomain;
              if (clr)  clr.classList.add('show');
              if (note) note.classList.add('show');
            }
          });
        } catch(e) {}
      }
    }, 300);
  }

  // ─── Rank history: persist each check + draw a sparkline trend ────────────
  function rsSaveRankHistory(domain, query, position, box) {
    const key = 'rsRankHist:' + domain + ':' + query.toLowerCase().slice(0, 80);
    try {
      chrome.storage.local.get([key], (res) => {
        let hist = (res && Array.isArray(res[key])) ? res[key] : [];
        hist.push({ t: Date.now(), p: position }); // p=0 means "not in top results"
        if (hist.length > 30) hist = hist.slice(hist.length - 30);
        try { chrome.storage.local.set({ [key]: hist }); } catch(e) {}
        rsRenderRankTrend(hist, box);
      });
    } catch(e) {}
  }

  function rsRenderRankTrend(hist, box) {
    if (!box || !hist || hist.length < 1) return;
    // Treat "not found" (0) as a worst-case rank for plotting purposes.
    const WORST = 105;
    const pts = hist.map(h => h.p > 0 ? h.p : WORST);
    const prev = hist.length > 1 ? hist[hist.length - 2].p : null;
    const cur = hist[hist.length - 1].p;

    let delta = '';
    if (prev !== null && prev > 0 && cur > 0) {
      const diff = prev - cur; // positive = improved (lower number)
      if (diff > 0) delta = '<span style="color:#16a34a;font-weight:700;">▲ up ' + diff + '</span>';
      else if (diff < 0) delta = '<span style="color:#dc2626;font-weight:700;">▼ down ' + (-diff) + '</span>';
      else delta = '<span style="color:#64748b;">no change</span>';
    }

    // Build an inline SVG sparkline (lower rank = higher on the chart).
    const W = 220, H = 46, pad = 4;
    const max = Math.max(...pts), min = Math.min(...pts);
    const range = Math.max(1, max - min);
    const step = pts.length > 1 ? (W - pad * 2) / (pts.length - 1) : 0;
    const coords = pts.map((p, i) => {
      const x = pad + i * step;
      const y = pad + ((p - min) / range) * (H - pad * 2); // higher rank number -> lower on chart
      return [x, y];
    });
    const path = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
    const dots = coords.map((c, i) => '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="' + (i === coords.length - 1 ? 3 : 1.6) + '" fill="' + (i === coords.length - 1 ? '#0D9488' : '#94a3b8') + '"/>').join('');

    const last5 = hist.slice(-5).map(h => h.p > 0 ? '#' + h.p : 'NF').join(' → ');

    const trend = document.createElement('div');
    trend.className = 'rs-rank-trend';
    trend.innerHTML =
      '<div class="rs-trend-head">Rank history <span style="float:right;">' + delta + '</span></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none">' +
      '<path d="' + path + '" fill="none" stroke="#0D9488" stroke-width="1.6"/>' + dots + '</svg>' +
      '<div class="rs-trend-vals">' + last5 + (hist.length > 5 ? '  (' + hist.length + ' checks)' : '') + '</div>';

    // Remove any prior trend, then append the fresh one.
    const old = box.querySelector('.rs-rank-trend');
    if (old) old.remove();
    box.appendChild(trend);
  }

  // ════════════════════════════════════════════════════════════════════════
  // NEW AEO/GEO PANELS — AI Overviews, People Also Ask, Content Brief,
  // Keyword Cannibalization.  Added v4.3.
  // ════════════════════════════════════════════════════════════════════════

  // ─── Shared: call the configured AI model (reuses AI_SERP_ANALYZE bridge) ──
  async function rsCallAI(prompt) {
    try {
      // Keys live in chrome.storage.local (shared with the popup, where the
      // user saves them). The content-script localStorage is the page's
      // (google.com) — NOT the extension — so reading it alone never finds the
      // key. Read chrome.storage first, fall back to localStorage for legacy.
      const stored = await new Promise(res => {
        try {
          chrome.storage.local.get(
            ['aiProvider', 'nvidiaApiKey', 'nvidiaKey', 'openrouterApiKey', 'openrouterKey', 'aiApiKey'], res);
        } catch(e) { res({}); }
      });
      let lsCfg = {};
      try {
        const raw = localStorage.getItem('rp-ai-config');
        if (raw) lsCfg = JSON.parse(raw);
      } catch(_) {}

      const provider  = stored.aiProvider || lsCfg.provider || 'nvidia';
      const nvidiaKey = stored.nvidiaApiKey || stored.nvidiaKey || stored.aiApiKey || lsCfg.nvidiaKey || '';
      const openrKey  = stored.openrouterApiKey || stored.openrouterKey || lsCfg.openrouterKey || '';
      if (!nvidiaKey && !openrKey) return null;

      const bgResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'AI_SERP_ANALYZE', prompt, provider, nvidiaKey, openrKey },
          (r) => { void chrome.runtime.lastError; resolve(r); }
        );
      });
      if (!bgResp || !bgResp.ok) return null;
      return bgResp.text || '';
    } catch(e) { return null; }
  }

  // ─── DOM reader: detect Google AI Overview (SGE) block + its sources ───────
  function rsDetectAIOverview(targetDomain) {
    const result = { present: false, sources: [], domainCited: false };
    const root = document.querySelector('#rcnt, #center_col, #search') || document.body;

    // Strategy 1: known AI Overview containers / attributes (these change often,
    // so we try several and also fall back to a text-label scan).
    let block = root.querySelector(
      '[data-subtree="aio"], div[jsname="V67aGc"][data-attrid], div[data-al-attr], [aria-label*="AI Overview" i]'
    );

    // Strategy 2: text-label scan — find a small element whose text is the
    // "AI Overview" heading, then take its larger ancestor as the block.
    if (!block) {
      const labels = root.querySelectorAll('h1, h2, h3, span, div[role="heading"]');
      for (const el of labels) {
        const t = (el.textContent || '').trim();
        if (t.length < 40 && /^AI Overview/i.test(t)) {
          block = el.closest('div[jscontroller], div[data-hveid], div') || el.parentElement;
          break;
        }
      }
    }
    if (!block) return result;
    result.present = true;

    // Collect cited source links inside the AI Overview block.
    const seen = new Set();
    block.querySelectorAll('a[href^="http"]').forEach(a => {
      let href = a.href;
      let domain = '';
      try { domain = new URL(href).hostname.replace(/^www\./, '').toLowerCase(); } catch(e) {}
      if (!domain || domain.includes('google.') || domain.includes('gstatic.')) return;
      if (seen.has(domain)) return;
      seen.add(domain);
      result.sources.push({ domain, url: href });
    });

    if (targetDomain) {
      const d = targetDomain.replace(/^www\./, '').toLowerCase();
      result.domainCited = result.sources.some(s =>
        s.domain === d || s.domain.endsWith('.' + d) || d.endsWith('.' + s.domain));
    }
    return result;
  }

  // ─── DOM reader: scrape "People also ask" questions from the live SERP ─────
  function rsCollectPAA() {
    const out = [];
    const seen = new Set();
    const push = (q) => {
      q = (q || '').trim();
      if (q.length < 8 || q.length > 200) return;
      if (!/[?]/.test(q) && !/^(what|why|how|when|where|who|which|is|are|can|do|does|should)\b/i.test(q)) return;
      const key = q.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(q);
    };

    // Several selector strategies (Google rotates markup frequently).
    document.querySelectorAll(
      'div.related-question-pair, [jsname="yEVEwb"], div[data-q], [data-initq]'
    ).forEach(el => {
      const dq = el.getAttribute('data-q') || el.getAttribute('data-initq');
      if (dq) { push(dq); return; }
      const span = el.querySelector('span, div[role="heading"]');
      if (span) push(span.textContent);
    });

    // Text fallback: find the "People also ask" label and scan nearby rows.
    if (out.length === 0) {
      const all = document.querySelectorAll('#search div[role="heading"], #search span');
      all.forEach(el => {
        const t = (el.textContent || '').trim();
        if (/[?]\s*$/.test(t)) push(t);
      });
    }
    return out;
  }

  // ─── 6b. AI OVERVIEW (SGE) TRACKER ────────────────────────────────────────
  function buildAIOverviewPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4 4 4 0 0 1 2 7 4 4 0 0 1-6 5 4 4 0 0 1-6-5 4 4 0 0 1 2-7 4 4 0 0 1 4-4z"/><path d="M12 8v8M8 12h8"/></svg>`;
    const body = `
      <div class="rs-aio-status" id="rs-aio-status">
        <div class="rs-loading-row"><div class="rs-spin"></div>Scanning this SERP for an AI Overview…</div>
      </div>
      <div class="rs-rank-input-row" style="margin-top:8px;">
        <input class="rs-rank-input" id="rs-aio-domain" type="text" placeholder="your domain.com — am I cited?" />
        <button class="rs-rank-btn" id="rs-aio-check">Check</button>
      </div>
      <div id="rs-aio-sources"></div>
    `;
    return makePanel('rs-panel-aio', svg, 'AI Overview (SGE) Tracker', body, true);
  }

  function setupAIOverviewPanel() {
    const render = (targetDomain) => {
      const statusEl  = document.getElementById('rs-aio-status');
      const sourcesEl = document.getElementById('rs-aio-sources');
      if (!statusEl) return;
      const aio = rsDetectAIOverview(targetDomain);

      if (!aio.present) {
        statusEl.innerHTML = '<div class="rs-aio-badge rs-aio-none">No AI Overview shown for this query</div>' +
          '<div style="font-size:10px;color:#94a3b8;margin-top:4px;">Google isn\'t generating an AI Overview here — a ranking opportunity, since fewer answers are AI-summarised.</div>';
        if (sourcesEl) sourcesEl.innerHTML = '';
        return;
      }

      let head = '<div class="rs-aio-badge rs-aio-yes">✦ AI Overview present — ' + aio.sources.length + ' source' + (aio.sources.length === 1 ? '' : 's') + ' cited</div>';
      if (targetDomain) {
        head += aio.domainCited
          ? '<div class="rs-aio-badge rs-aio-cited">✓ ' + targetDomain + ' IS cited in the AI Overview</div>'
          : '<div class="rs-aio-badge rs-aio-notcited">✗ ' + targetDomain + ' is NOT cited yet</div>';
      }
      statusEl.innerHTML = head;

      if (sourcesEl) {
        if (aio.sources.length) {
          sourcesEl.innerHTML = '<div class="rs-aio-srctitle">Cited sources</div>' +
            aio.sources.map((s, i) =>
              '<div class="rs-aio-src"><span class="rs-aio-num">' + (i + 1) + '</span>' +
              '<a href="' + s.url + '" target="_blank" rel="noopener">' + s.domain + '</a></div>'
            ).join('');
        } else {
          sourcesEl.innerHTML = '<div style="font-size:10px;color:#94a3b8;">Overview detected but no source links could be read.</div>';
        }
      }
    };

    setTimeout(() => {
      render('');
      const btn = document.getElementById('rs-aio-check');
      const inp = document.getElementById('rs-aio-domain');
      try {
        chrome.storage.local.get(['trackedDomain'], (p) => {
          if (p && p.trackedDomain && inp) inp.value = p.trackedDomain;
        });
      } catch(e) {}
      const run = () => {
        const d = (inp && inp.value || '').trim()
          .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
        render(d);
      };
      if (btn) btn.onclick = run;
      if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    }, 600);
  }

  // ─── 6c. PEOPLE ALSO ASK (PAA) SCRAPER ────────────────────────────────────
  function buildPAAPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    const body = `<div id="rs-paa-body"><div class="rs-loading-row"><div class="rs-spin"></div>Reading "People also ask"…</div></div>`;
    return makePanel('rs-panel-paa', svg, 'People Also Ask', body, true);
  }

  function populatePAAPanel() {
    const container = document.getElementById('rs-paa-body');
    if (!container) return;
    const questions = rsCollectPAA();

    if (!questions.length) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:11px;">No "People also ask" box found. Scroll the SERP to load it, then reopen this panel.</div>';
      return;
    }

    container.innerHTML =
      '<div class="rs-paa-count">' + questions.length + ' related questions — answer these to win AEO:</div>' +
      '<div class="rs-paa-list">' +
      questions.map(q => '<div class="rs-paa-q">' + q.replace(/</g, '&lt;') + '</div>').join('') +
      '</div>' +
      '<button class="rs-rank-btn" id="rs-paa-copy" style="margin-top:8px;width:100%;">Copy all questions</button>';

    const copyBtn = document.getElementById('rs-paa-copy');
    if (copyBtn) copyBtn.onclick = () => {
      const txt = questions.join('\n');
      try {
        navigator.clipboard.writeText(txt).then(() => showToast('Questions copied'),
          () => { rsFallbackCopy(txt); });
      } catch(e) { rsFallbackCopy(txt); }
    };
  }

  function rsFallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      showToast('Copied');
    } catch(e) { showToast('Copy failed'); }
  }

  // ─── 6d. CONTENT BRIEF GENERATOR ──────────────────────────────────────────
  function buildContentBriefPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`;
    const body = `
      <div style="font-size:10px;color:#94a3b8;margin-bottom:8px;">Builds a content outline from the top 10 results, the related questions, and an AI pass.</div>
      <button class="rs-rank-btn" id="rs-brief-gen" style="width:100%;">Generate content brief</button>
      <div id="rs-brief-body" style="margin-top:10px;"></div>
    `;
    return makePanel('rs-panel-brief', svg, 'Content Brief Generator', body, true);
  }

  function setupContentBriefPanel() {
    setTimeout(() => {
      const btn = document.getElementById('rs-brief-gen');
      if (!btn) return;
      btn.onclick = async () => {
        const out = document.getElementById('rs-brief-body');
        const query = getQuery();
        const results = collectSerpData();
        const paa = rsCollectPAA();

        // Instant local brief (always works, even without an AI key).
        const titles = results.slice(0, 10).map(r => r.title).filter(Boolean);
        const words = titles.join(' ').toLowerCase().split(/\W+/).filter(w => w.length > 4);
        const freq = {};
        words.forEach(w => freq[w] = (freq[w] || 0) + 1);
        const topics = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
        const isLong = query.split(' ').length > 3;
        const wordTarget = isLong ? '1,500–2,500' : '2,000–3,500';

        const localBrief =
          '<div class="rs-brief-sec"><div class="rs-brief-h">🎯 Target keyword</div><div class="rs-brief-p">' + query + '</div></div>' +
          '<div class="rs-brief-sec"><div class="rs-brief-h">📏 Suggested length</div><div class="rs-brief-p">' + wordTarget + ' words (based on top results)</div></div>' +
          (topics.length ? '<div class="rs-brief-sec"><div class="rs-brief-h">🧩 Topics to cover</div><div class="rs-brief-chips">' + topics.map(t => '<span class="rs-brief-chip">' + t + '</span>').join('') + '</div></div>' : '') +
          (paa.length ? '<div class="rs-brief-sec"><div class="rs-brief-h">❓ Questions to answer</div>' + paa.slice(0, 8).map(q => '<div class="rs-brief-q">' + q.replace(/</g, '&lt;') + '</div>').join('') + '</div>' : '') +
          (titles.length ? '<div class="rs-brief-sec"><div class="rs-brief-h">🏆 What ranks now</div>' + titles.slice(0, 5).map(t => '<div class="rs-brief-q">' + truncate(t, 60).replace(/</g, '&lt;') + '</div>').join('') + '</div>' : '');

        if (out) out.innerHTML = localBrief + '<div class="rs-loading-row" id="rs-brief-ai" style="margin-top:8px;"><div class="rs-spin"></div>Asking AI for a heading outline…</div>';

        // AI pass for a real H2/H3 outline (optional — needs a key configured).
        const prompt = 'You are an SEO content strategist. For the search query "' + query + '", using these top-ranking titles:\n' +
          titles.slice(0, 8).map((t, i) => (i + 1) + '. ' + t).join('\n') +
          (paa.length ? '\n\nAnd these related questions:\n' + paa.slice(0, 8).map(q => '- ' + q).join('\n') : '') +
          '\n\nReturn ONLY a JSON object: {"h2":["H2 heading 1","H2 heading 2",...6-9 items],"angle":"1-sentence unique angle to beat competitors"}. No markdown.';

        const aiText = await rsCallAI(prompt);
        const aiBox = document.getElementById('rs-brief-ai');
        if (!aiText) {
          if (aiBox) aiBox.outerHTML = '<div style="font-size:10px;color:#94a3b8;">Add an AI key in Settings for an auto-generated heading outline.</div>';
          return;
        }
        try {
          const m = aiText.match(/\{[\s\S]*\}/);
          const data = m ? JSON.parse(m[0]) : null;
          if (data && Array.isArray(data.h2)) {
            const html =
              (data.angle ? '<div class="rs-brief-sec"><div class="rs-brief-h">💡 Winning angle</div><div class="rs-brief-p">' + (data.angle + '').replace(/</g, '&lt;') + '</div></div>' : '') +
              '<div class="rs-brief-sec"><div class="rs-brief-h">📑 Suggested headings</div>' +
              data.h2.map(h => '<div class="rs-brief-q">' + (h + '').replace(/</g, '&lt;') + '</div>').join('') + '</div>';
            if (aiBox) aiBox.outerHTML = html;
          } else if (aiBox) {
            aiBox.outerHTML = '';
          }
        } catch(e) { if (aiBox) aiBox.outerHTML = ''; }
      };
    }, 300);
  }

  // ─── 6e. KEYWORD CANNIBALIZATION DETECTOR ─────────────────────────────────
  function buildCannibalPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    const body = `
      <div style="font-size:10px;color:#94a3b8;margin-bottom:8px;">Finds if multiple pages from one domain compete for this keyword (cannibalization).</div>
      <div class="rs-rank-input-row">
        <input class="rs-rank-input" id="rs-cann-domain" type="text" placeholder="your domain.com" />
        <button class="rs-rank-btn" id="rs-cann-check">Check</button>
      </div>
      <div id="rs-cann-body"></div>
    `;
    return makePanel('rs-panel-cann', svg, 'Keyword Cannibalization', body, true);
  }

  function setupCannibalPanel() {
    let running = false;
    setTimeout(() => {
      const btn = document.getElementById('rs-cann-check');
      const inp = document.getElementById('rs-cann-domain');
      try {
        chrome.storage.local.get(['trackedDomain'], (p) => {
          if (p && p.trackedDomain && inp) inp.value = p.trackedDomain;
        });
      } catch(e) {}

      const run = async () => {
        if (running) return;
        const out = document.getElementById('rs-cann-body');
        const domain = (inp && inp.value || '').trim()
          .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
        if (!domain) { showToast('Enter a domain first'); return; }

        running = true;
        if (btn) { btn.textContent = '…'; btn.disabled = true; }
        if (out) out.innerHTML = '<div class="rs-loading-row"><div class="rs-spin"></div>Searching site:' + domain + ' for this keyword…</div>';

        try {
          const query = 'site:' + domain + ' ' + getQuery();
          // Reuse the rank-tracker's background SERP fetch (hidden tab).
          let pages = [];
          try { pages = await rsFetchGooglePage(query, 0); } catch(e) { pages = []; }
          // Keep only URLs that actually belong to the target domain.
          const mine = [];
          const seen = new Set();
          for (const r of pages) {
            const d = (r.domain || '').toLowerCase();
            if (!(d === domain || d.endsWith('.' + domain) || domain.endsWith('.' + d))) continue;
            if (seen.has(r.url)) continue;
            seen.add(r.url);
            mine.push(r);
          }

          if (!out) return;
          if (mine.length === 0) {
            out.innerHTML = '<div class="rs-cann-ok">No indexed page from ' + domain + ' found for this keyword.</div>';
          } else if (mine.length === 1) {
            out.innerHTML = '<div class="rs-cann-ok">✓ Only one page targets this keyword — no cannibalization.</div>' +
              '<div class="rs-cann-url"><a href="' + mine[0].url + '" target="_blank" rel="noopener">' + truncate(mine[0].url, 60) + '</a></div>';
          } else {
            out.innerHTML = '<div class="rs-cann-warn">⚠ ' + mine.length + ' pages compete for this keyword — possible cannibalization. Consolidate or differentiate them.</div>' +
              mine.map(r => '<div class="rs-cann-url"><a href="' + r.url + '" target="_blank" rel="noopener">' + truncate(r.url, 60) + '</a></div>').join('');
          }
        } catch(err) {
          if (out) out.innerHTML = '<div style="color:#dc2626;font-size:11px;">Error: ' + (err.message || 'fetch failed') + '</div>';
        } finally {
          running = false;
          if (btn) { btn.textContent = 'Check'; btn.disabled = false; }
        }
      };
      if (btn) btn.onclick = run;
      if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    }, 300);
  }

  // ─── 6f. AI ENGINE CITATIONS (would an LLM reference you?) ────────────────
  function buildAIEngineCitePanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>`;
    const body = `
      <div style="font-size:10px;color:#94a3b8;margin-bottom:8px;">Asks the AI model which domains it considers authoritative for this query — a proxy for whether assistants would cite you.</div>
      <div class="rs-rank-input-row">
        <input class="rs-rank-input" id="rs-aie-domain" type="text" placeholder="your domain.com" />
        <button class="rs-rank-btn" id="rs-aie-check">Check</button>
      </div>
      <div id="rs-aie-body"></div>
    `;
    return makePanel('rs-panel-aie', svg, 'AI Engine Citations', body, true);
  }

  function setupAIEngineCitePanel() {
    let running = false;
    setTimeout(() => {
      const btn = document.getElementById('rs-aie-check');
      const inp = document.getElementById('rs-aie-domain');
      try {
        chrome.storage.local.get(['trackedDomain'], (p) => {
          if (p && p.trackedDomain && inp) inp.value = p.trackedDomain;
        });
      } catch(e) {}

      const run = async () => {
        if (running) return;
        const out = document.getElementById('rs-aie-body');
        const domain = (inp && inp.value || '').trim()
          .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
        if (!domain) { showToast('Enter a domain first'); return; }

        running = true;
        if (btn) { btn.textContent = '…'; btn.disabled = true; }
        if (out) out.innerHTML = '<div class="rs-loading-row"><div class="rs-spin"></div>Asking the AI model…</div>';

        const query = getQuery();
        const prompt = 'A user searches: "' + query + '". List the 8 most authoritative website domains an AI assistant would reference to answer this, best first. Return ONLY JSON: {"domains":["example.com",...]}. No markdown.';
        const raw = await rsCallAI(prompt);

        running = false;
        if (btn) { btn.textContent = 'Check'; btn.disabled = false; }
        if (!out) return;

        if (!raw) {
          out.innerHTML = '<div class="rs-aio-badge rs-aio-none">Add an NVIDIA or OpenRouter AI key in Settings to use this.</div>';
          return;
        }
        let domains = [];
        try { const m = raw.match(/\{[\s\S]*\}/); const o = m ? JSON.parse(m[0]) : null; if (o && Array.isArray(o.domains)) domains = o.domains.map(d => (d + '').replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase()); } catch(e) {}

        if (!domains.length) {
          out.innerHTML = '<div class="rs-aio-badge rs-aio-none">AI did not return a usable answer. Try again.</div>';
          return;
        }
        const cited = domains.some(d => d === domain || d.endsWith('.' + domain) || domain.endsWith('.' + d));
        out.innerHTML =
          (cited
            ? '<div class="rs-aio-badge rs-aio-cited">✓ ' + domain + ' is among the domains the AI would reference</div>'
            : '<div class="rs-aio-badge rs-aio-notcited">✗ ' + domain + ' is NOT in the AI\'s authoritative list yet</div>') +
          '<div class="rs-aio-srctitle">AI\'s authoritative domains</div>' +
          domains.slice(0, 8).map((d, i) =>
            '<div class="rs-aio-src"><span class="rs-aio-num">' + (i + 1) + '</span>' +
            '<span style="' + ((d === domain || d.endsWith('.' + domain) || domain.endsWith('.' + d)) ? 'color:#0D9488;font-weight:700;' : 'color:#334155;') + '">' + d + '</span></div>'
          ).join('') +
          '<div style="font-size:9px;color:#94a3b8;margin-top:6px;">Reflects the configured model\'s training, not a live ChatGPT/Perplexity query.</div>';
      };
      if (btn) btn.onclick = run;
      if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    }, 300);
  }

  // ─── 7. BACKLINK GAP FINDER ───────────────────────────────────────────────
  function buildBacklinkPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
    const body = `<div id="rs-gap-body"><div class="rs-loading-row"><div class="rs-spin"></div>Competitor backlinks loading…</div></div>`;
    return makePanel('rs-panel-gap', svg, 'Backlink Gap Finder', body, true);
  }

  function populateBacklinkPanel(results) {
    const container = document.getElementById('rs-gap-body');
    if (!container) return;

    // Re-collect SERP data if results is empty
    if (!results || results.length === 0) {
      results = collectSerpData();
    }

    if (!results || results.length === 0) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:11px;padding:8px 0;">No SERP results found. Please wait for the page to fully load and try again.</div>';
      return;
    }

    const topDomains = results.slice(0, 5).filter(r => r.domain);
    if (topDomains.length === 0) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:11px;padding:8px 0;">No competitor domains found on this SERP page.</div>';
      return;
    }

    container.innerHTML = '<div class="rs-loading-row"><div class="rs-spin"></div>Loading competitor backlinks…</div>';

    const rdData = {};
    let loaded = 0;

    topDomains.forEach((r) => {
      chrome.runtime.sendMessage({ action: 'MOZ_FETCH', domain: r.domain }, (res) => {
        void chrome.runtime.lastError;
        loaded++;
        if (res && res.ok) {
          rdData[r.domain] = { rd: res.referringDomains || 0, bl: res.backlinks || 0, da: res.domainAuthority || 0 };
        } else {
          // Still show domain even if Moz data unavailable
          rdData[r.domain] = { rd: 0, bl: 0, da: 0, noData: true };
        }
        if (loaded === topDomains.length) renderGap(rdData);
      });
    });

    function renderGap(data) {
      const sorted = Object.entries(data).sort((a, b) => b[1].rd - a[1].rd);
      const hasRealData = sorted.some(([, d]) => d.rd > 0 || d.bl > 0);
      container.innerHTML = `
        <div style="font-size:10px;color:#64748b;margin-bottom:8px;">
          Top competitor referring domains — use these as your link building targets:
          ${!hasRealData ? '<br><span style="color:#f59e0b;">⚠ Configure Moz API key in Settings for referring domain data</span>' : ''}
        </div>
        ${sorted.map(([domain, d]) => `
          <div class="rs-gap-item">
            <div>
              <div class="rs-gap-domain">${domain}</div>
              <div class="rs-gap-note">${d.noData ? 'Moz data unavailable' : `DA ${d.da} · BL ${fmtNum(d.bl)}`}</div>
            </div>
            <div style="text-align:right">
              <div class="rs-gap-rd">${d.noData ? '–' : fmtNum(d.rd)}</div>
              <div class="rs-gap-note">ref domains</div>
            </div>
          </div>
        `).join('')}
        <div style="font-size:10px;color:#94a3b8;margin-top:6px;">Find sites linking to these competitors and target them for your own backlinks</div>
      `;
    }
  }

  // ─── 7b. BACKLINKS EXPLORER (free, no API key) ───────────────────────────
  function buildBacklinksExplorerPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
    const body = `
      <div id="rs-blx-body">
        <div class="rs-blx-domain-row">
          <input class="rs-blx-input" id="rs-blx-input" type="text" placeholder="domain: example.com" autocomplete="off" spellcheck="false"/>
          <button class="rs-blx-btn" id="rs-blx-go">Find</button>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin:6px 0 4px;">
          Or pick a competitor from this SERP:
        </div>
        <div id="rs-blx-serp-list"></div>
        <div id="rs-blx-results" style="margin-top:8px;"></div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;">
          <a id="rs-blx-sheet-btn" href="https://docs.google.com/spreadsheets/d/18Gc0XJa1FVmX35HMIGPirYpb1J8-Gmi2AXaURZpGy1Y/edit?usp=sharing" target="_blank" rel="noopener"
             style="display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:8px 10px;background:linear-gradient(135deg,#0D9488,#0f766e);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none;cursor:pointer;box-sizing:border-box;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Off-Page Backlinks Sheet
          </a>
          <div style="font-size:9px;color:#94a3b8;margin-top:4px;text-align:center;line-height:1.3;">Open shared sheet to plan &amp; track link building</div>
        </div>
        <div style="font-size:9px;color:#cbd5e1;margin-top:8px;line-height:1.4;">
          Shows external domains that <b>mention</b> a target (co-citation candidates via Google), each scored by Ahrefs DR. These are link-prospect signals, not verified backlinks.
        </div>
      </div>`;
    return makePanel('rs-panel-blx', svg, 'Backlinks Explorer', body, true);
  }

  function setupBacklinksExplorer() {
    const styleId = 'rs-blx-style';
    if (!document.getElementById(styleId)) {
      const st = document.createElement('style');
      st.id = styleId;
      st.textContent = `
        .rs-blx-domain-row { display:flex; gap:6px; margin-bottom:4px; }
        .rs-blx-input { flex:1; padding:6px 8px; border:1px solid #e2e8f0; border-radius:6px; font-size:12px; outline:none; }
        .rs-blx-input:focus { border-color:#0D9488; }
        .rs-blx-btn { padding:6px 12px; background:#0D9488; color:#fff; border:none; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; }
        .rs-blx-btn:disabled { opacity:.6; cursor:wait; }
        .rs-blx-chip { display:inline-block; padding:3px 8px; margin:2px 4px 2px 0; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:12px; font-size:11px; color:#334155; cursor:pointer; }
        .rs-blx-chip:hover { background:#0D9488; color:#fff; border-color:#0D9488; }
        .rs-blx-item { display:flex; align-items:center; justify-content:space-between; padding:6px 8px; border:1px solid #eef2f6; border-radius:6px; margin-bottom:4px; background:#fff; }
        .rs-blx-bd { font-size:11.5px; font-weight:600; color:#0f172a; word-break:break-all; }
        .rs-blx-bd a { color:#0f172a; text-decoration:none; }
        .rs-blx-bd a:hover { color:#0D9488; text-decoration:underline; }
        .rs-blx-dr { font-size:11px; font-weight:800; min-width:34px; text-align:right; }
        .rs-blx-dr.hi { color:#16a34a; } .rs-blx-dr.md { color:#ca8a04; } .rs-blx-dr.lo { color:#dc2626; } .rs-blx-dr.na { color:#94a3b8; }
        .rs-blx-head { font-size:10px; color:#64748b; margin:6px 0 4px; }
      `;
      document.head.appendChild(st);
    }

    function drClass(dr) {
      if (dr == null) return 'na';
      if (dr >= 50) return 'hi';
      if (dr >= 25) return 'md';
      return 'lo';
    }

    let _running = false;
    function run(domainRaw) {
      if (_running) return;
      const domain = (domainRaw || '').trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
      const results = document.getElementById('rs-blx-results');
      if (!domain || !results) return;
      _running = true;
      const btn = document.getElementById('rs-blx-go');
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      results.innerHTML = '<div class="rs-loading-row"><div class="rs-spin"></div>Searching Google for mentions of ' + domain + '…</div>';

      chrome.runtime.sendMessage({ action: 'BACKLINK_FETCH', domain, googleDomain: location.hostname }, (res) => {
        _running = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Find'; }
        if (chrome.runtime.lastError || !res || !res.ok) {
          results.innerHTML = '<div style="color:#dc2626;font-size:11px;padding:6px 0;">Error: ' + (res?.error || chrome.runtime.lastError?.message || 'fetch failed') + '. Google may be rate-limiting — try again shortly.</div>';
          return;
        }
        const links = res.backlinks || [];
        if (links.length === 0) {
          results.innerHTML = '<div style="color:#94a3b8;font-size:11px;padding:6px 0;">No external mentions found for ' + domain + '.</div>';
          return;
        }
        results.innerHTML = '<div class="rs-blx-head">' + links.length + ' referring domains for <b>' + domain + '</b> (DR loading…):</div>' +
          links.map((l, i) =>
            '<div class="rs-blx-item" id="rs-blx-row-' + i + '">' +
              '<div class="rs-blx-bd"><a href="' + l.url + '" target="_blank" rel="noopener">' + l.domain + '</a></div>' +
              '<div class="rs-blx-dr na" id="rs-blx-dr-' + i + '">…</div>' +
            '</div>'
          ).join('');

        // Fetch DR for each referring domain (reuses existing Ahrefs handler + cache)
        links.forEach((l, i) => {
          chrome.runtime.sendMessage({ action: 'AHREFS_DR_FETCH', domain: l.domain }, (dres) => {
            void chrome.runtime.lastError;
            const cell = document.getElementById('rs-blx-dr-' + i);
            if (!cell) return;
            const dr = (dres && dres.ok) ? dres.domainRating : null;
            cell.textContent = dr != null ? dr : '–';
            cell.className = 'rs-blx-dr ' + drClass(dr);
          });
        });
      });
    }

    setTimeout(() => {
      const btn = document.getElementById('rs-blx-go');
      const inp = document.getElementById('rs-blx-input');
      if (btn) btn.onclick = () => run(inp ? inp.value : '');
      if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(inp.value); });

      // Populate SERP competitor chips
      const list = document.getElementById('rs-blx-serp-list');
      if (list) {
        let serp = [];
        try { serp = collectSerpData() || []; } catch (_) {}
        const domains = [...new Set(serp.slice(0, 8).map(r => r.domain).filter(Boolean))];
        if (domains.length) {
          list.innerHTML = domains.map(d => '<span class="rs-blx-chip" data-d="' + d + '">' + d + '</span>').join('');
          list.querySelectorAll('.rs-blx-chip').forEach(chip => {
            chip.addEventListener('click', () => {
              if (inp) inp.value = chip.getAttribute('data-d');
              run(chip.getAttribute('data-d'));
            });
          });
        } else {
          list.innerHTML = '<span style="font-size:10px;color:#cbd5e1;">No competitor domains detected yet.</span>';
        }
      }
    }, 300);
  }


  // ═══════════════════════════════════════════════════════════════════════════

  function buildMyGapPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2">
      <path d="M3 6h18M3 12h12M3 18h8"/><circle cx="19" cy="17" r="3" fill="#0D9488" stroke="none"/><path d="M19 15v4M17 17h4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
    const body = `
      <div id="rs-mygap-body">
        <div class="rs-mygap-domain-row">
          <input class="rs-mygap-input" id="rs-mygap-input" type="text" placeholder="your website: example.com" autocomplete="off" spellcheck="false"/>
          <button class="rs-mygap-btn" id="rs-mygap-analyze">Analyze</button>
        </div>
        <div id="rs-mygap-content" style="color:#94a3b8;font-size:11px;">
          Enter your domain and click Analyze — we will compare you against the competitors ranking on this SERP.
        </div>
      </div>`;
    return makePanel('rs-panel-mygap', svg, 'My Site vs Competitors', body, true);
  }

  function setupMyGapPanel(results) {
    // Load saved domain
    chrome.storage.local.get(['myDomain'], (prefs) => {
      const input = document.getElementById('rs-mygap-input');
      if (!input) return;
      if (prefs.myDomain) {
        input.value = prefs.myDomain;
      }
    });

    const btn = document.getElementById('rs-mygap-analyze');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const input = document.getElementById('rs-mygap-input');
      const rawDomain = (input.value || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
      if (!rawDomain) return;
      chrome.storage.local.set({ myDomain: rawDomain });
      runMyGapAnalysis(rawDomain, results);
    });

    // Auto-run if domain already saved
    chrome.storage.local.get(['myDomain'], (prefs) => {
      if (prefs.myDomain && results && results.length > 0) {
        const input = document.getElementById('rs-mygap-input');
        if (input) input.value = prefs.myDomain;
        setTimeout(() => runMyGapAnalysis(prefs.myDomain, results), 600);
      }
    });
  }

  function runMyGapAnalysis(myDomain, results) {
    const container = document.getElementById('rs-mygap-content');
    if (!container) return;
    if (!results || results.length === 0) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:11px;">SERP results not loaded. Please refresh the page.</div>';
      return;
    }
    container.innerHTML = '<div class="rs-loading-row"><div class="rs-spin"></div>Fetching your website data…</div>';

    // Fetch my domain data
    chrome.runtime.sendMessage({ action: 'MOZ_FETCH', domain: myDomain }, (myRes) => {
      if (chrome.runtime.lastError) {
        container.innerHTML = '<div style="color:#dc2626;font-size:11px;">API error. Try again.</div>';
        return;
      }
      const myDA  = (myRes && myRes.ok && myRes.domainAuthority)  ? myRes.domainAuthority  : 0;
      const myBL  = (myRes && myRes.ok && myRes.backlinks)        ? myRes.backlinks        : 0;
      const mySpam = (myRes && myRes.ok)                          ? (myRes.spamScore || 0) : 0;

      // Show loading state with my info
      container.innerHTML = '<div class="rs-loading-row"><div class="rs-spin"></div>Loading competitor data…</div>';

      // Fetch top 5 competitor data
      const top5 = results.slice(0, 5);
      let fetched = 0;
      const compData = [];

      top5.forEach((r, i) => {
        chrome.runtime.sendMessage({ action: 'MOZ_FETCH', domain: r.domain }, (cRes) => {
          void chrome.runtime.lastError;
          compData[i] = {
            domain: r.domain,
            position: i + 1,
            title: r.title,
            da:   (cRes && cRes.ok && cRes.domainAuthority) ? cRes.domainAuthority  : 0,
            bl:   (cRes && cRes.ok && cRes.backlinks)       ? cRes.backlinks        : 0,
            spam: (cRes && cRes.ok)                         ? (cRes.spamScore || 0) : 0
          };
          fetched++;
          if (fetched === top5.length) renderGapAnalysis(myDomain, myDA, myBL, mySpam, compData);
        });
      });
    });
  }

  function renderGapAnalysis(myDomain, myDA, myBL, mySpam, compData) {
    const container = document.getElementById('rs-mygap-content');
    if (!container) return;

    const validComps = compData.filter(c => c && c.da > 0);
    const avgDA  = validComps.length ? Math.round(validComps.reduce((s, c) => s + c.da, 0) / validComps.length) : 0;
    const avgBL  = validComps.length ? Math.round(validComps.reduce((s, c) => s + c.bl, 0) / validComps.length) : 0;
    const top1   = compData[0] || {};
    const maxDA  = Math.max(myDA, ...compData.map(c => c ? c.da : 0), 1);
    const maxBL  = Math.max(myBL, ...compData.map(c => c ? c.bl : 0), 1);

    // Gap calculations
    const daGap   = avgDA  - myDA;
    const blGap   = avgBL  - myBL;
    const daGapTop = (top1.da || 0) - myDA;

    // Fix priorities (Koray-inspired quality threshold approach)
    const fixes = [];
    if (daGap > 20) fixes.push({ level: 'red', msg: `DA is ${daGap} points behind — urgently build high-quality backlinks (top competitor: DA ${top1.da})` });
    else if (daGap > 5) fixes.push({ level: 'amber', msg: `DA is slightly low (${myDA} vs avg ${avgDA}) — keep building links` });
    else if (daGap <= 0) fixes.push({ level: 'green', msg: `DA is equal or better than competitors — focus on content quality` });

    if (blGap > 5000) fixes.push({ level: 'red', msg: `Big backlink gap — you need ~${fmtNum(blGap)} more backlinks to match avg competitor` });
    else if (blGap > 500) fixes.push({ level: 'amber', msg: `Backlink gap exists (${fmtNum(myBL)} vs avg ${fmtNum(avgBL)}) — run a link building campaign` });

    if (mySpam >= 8) fixes.push({ level: 'red', msg: `Spam score is very high (${mySpam}%) — disavow toxic backlinks immediately` });
    else if (mySpam >= 4) fixes.push({ level: 'amber', msg: `Spam score is moderate (${mySpam}%) — clean up your backlink profile` });

    if (daGapTop <= 0 && blGap <= 500) {
      fixes.push({ level: 'green', msg: `Authority looks good — work on topical coverage and semantic SEO (Koray method)` });
      fixes.push({ level: 'amber', msg: `Run a content gap analysis — have you covered all sub-topics?` });
    }

    if (fixes.length === 0) fixes.push({ level: 'green', msg: `No major metric gaps found — optimize content depth and internal linking` });

    // Bar chart helper
    function barHTML(label, youVal, themVal, maxVal, unit = '') {
      const youW  = Math.round((youVal  / maxVal) * 100);
      const themW = Math.round((themVal / maxVal) * 100);
      const youColor  = youVal >= themVal ? '#16a34a' : '#0D9488';
      const themColor = '#94a3b8';
      return `
        <div class="rs-mygap-row">
          <div class="rs-mygap-label-row">
            <span>${label}</span>
            <span>
              <span style="color:${youColor};font-weight:700;">${unit}${fmtNum(youVal)}</span>
              <span style="color:#94a3b8;"> vs avg </span>
              <span style="font-weight:700;">${unit}${fmtNum(themVal)}</span>
            </span>
          </div>
          <div class="rs-mygap-bar-wrap">
            <div class="rs-mygap-bar-them" style="width:${themW}%;background:#e2e8f0;"></div>
            <div class="rs-mygap-bar-you"  style="width:${youW}%;background:${youColor};"></div>
          </div>
        </div>`;
    }

    // Competitor mini-table
    const compRows = compData.slice(0, 5).filter(Boolean).map(c => `
      <tr style="font-size:10px;">
        <td style="padding:3px 4px;color:#0D9488;font-weight:700;">#${c.position}</td>
        <td style="padding:3px 4px;color:#334155;font-weight:600;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${c.domain}">${c.domain}</td>
        <td style="padding:3px 4px;color:${daColor(c.da)};font-weight:700;">${c.da || '--'}</td>
        <td style="padding:3px 4px;color:#0D9488;">${fmtNum(c.bl)}</td>
        <td style="padding:3px 4px;color:${spamColor(c.spam || 0)};">${c.spam || 0}%</td>
      </tr>`).join('');

    const myStatus = myDA > 0 ? `<span style="color:#0D9488;font-weight:700;">DA:${myDA}</span> · <span>BL:${fmtNum(myBL)}</span> · <span>Spam:${mySpam}%</span>` : '<span style="color:#dc2626;">Moz data not found (new or private domain)</span>';

    container.innerHTML = `
      <div style="font-size:10px;color:#64748b;margin-bottom:8px;padding:5px 8px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
        <span style="font-weight:700;color:#334155;">Your domain:</span> ${myDomain} — ${myStatus}
      </div>

      ${barHTML('Domain Authority (DA)', myDA, avgDA, maxDA)}
      ${barHTML('Backlinks (BL)', myBL, avgBL, maxBL)}

      <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:10px;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:3px 4px;text-align:left;color:#94a3b8;font-size:9px;">#</th>
          <th style="padding:3px 4px;text-align:left;color:#94a3b8;font-size:9px;">Domain</th>
          <th style="padding:3px 4px;text-align:left;color:#94a3b8;font-size:9px;">DA</th>
          <th style="padding:3px 4px;text-align:left;color:#94a3b8;font-size:9px;">BL</th>
          <th style="padding:3px 4px;text-align:left;color:#94a3b8;font-size:9px;">Spam</th>
        </tr></thead>
        <tbody>${compRows}</tbody>
      </table>

      <div class="rs-mygap-score-box">
        <div class="rs-mygap-score-title">Top Rank ke liye Fix List</div>
        ${fixes.map(f => `
          <div class="rs-mygap-fix-item">
            <div class="rs-mygap-fix-dot ${f.level}"></div>
            <span>${f.msg}</span>
          </div>`).join('')}
      </div>`;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ─── COMPETITOR KEYWORDS SPY PANEL ────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  function buildCompKeywordsPanel(query) {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/>
      <path d="M11 8v6M8 11h6" stroke="#0D9488" stroke-linecap="round"/>
    </svg>`;
    const body = `<div id="rs-ckw-body"><div class="rs-loading-row"><div class="rs-spin"></div>Competitor keywords load ho rahe hain…</div></div>`;
    return makePanel('rs-panel-ckw', svg, 'Competitor Keywords Spy', body, true);
  }

  async function populateCompKeywordsPanel(query, results) {
    const container = document.getElementById('rs-ckw-body');
    if (!container) return;
    if (!results || results.length === 0) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:11px;">SERP results nahi mile.</div>';
      return;
    }

    // Google Autocomplete fetch for each competitor domain
    const top3 = results.slice(0, 5);

    // Fetch related suggestions for the main query
    let relatedSuggestions = [];
    try {
      const acUrl = `https://suggestqueries.google.com/complete/search?output=chrome&hl=en&q=${encodeURIComponent(query)}&client=chrome`;
      const r = await fetch(acUrl);
      const j = await r.json();
      relatedSuggestions = j[1] ? j[1].slice(0, 8) : [];
    } catch (e) {}

    // Extract keyword patterns from SERP titles
    function extractKeywords(title, query) {
      if (!title) return [];
      const stopWords = new Set(['the','a','an','is','are','was','were','of','in','to','and','or','for','with','how','what','why','when','where','which','vs','vs.','can','do','does','did','will','would','could','should','by','on','at','from','into','your','our','their','its','it','this','that','these','those','be','been','has','have','had','not','no','any','all','as','if','so','but','up','out','than','then','now','just','more','most','very','about','after','before','between','through','other','each','also','both','few','many','such','here','there','too','only','over','under','same','different']);
      const words = title.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
      const qWords = new Set(query.toLowerCase().split(/\s+/));
      return words.filter(w => !qWords.has(w)).slice(0, 5);
    }

    // Build HTML for each competitor
    const html = top3.map((r, i) => {
      const titleKws = extractKeywords(r.title, query);
      const semrushUrl  = `https://www.semrush.com/analytics/organic/overview/?q=${encodeURIComponent(r.domain)}&searchType=domain`;
      const ahrefsUrl   = `https://ahrefs.com/site-explorer/overview/v2/subdomains/live?target=${encodeURIComponent(r.domain)}`;
      const ubersugUrl  = `https://neilpatel.com/ubersuggest/?q=${encodeURIComponent(r.domain)}&lang=en`;
      const mapsUrl     = `https://www.google.com/search?q=site:${encodeURIComponent(r.domain)}+${encodeURIComponent(query)}`;

      const pillsHTML = titleKws.length
        ? titleKws.map(kw => `<span class="rs-ckw-kw-pill" onclick="window.open('https://www.google.com/search?q=${encodeURIComponent(kw+' '+query)}','_blank')" title="Google mein search karo">${kw}</span>`).join('')
        : '<span style="font-size:10px;color:#94a3b8;">Keywords extract nahi hue</span>';

      return `
        <div class="rs-ckw-domain-item">
          <div class="rs-ckw-domain-head" onclick="this.nextElementSibling.classList.toggle('open')">
            <span class="rs-ckw-domain-name">📌 ${r.domain}</span>
            <span class="rs-ckw-rank-badge">#${i+1} on SERP</span>
          </div>
          <div class="rs-ckw-body">
            <div class="rs-ckw-title-label">Title se keywords:</div>
            <div style="margin-bottom:5px;line-height:1.8;">${pillsHTML}</div>
            <div class="rs-ckw-title-label" style="margin-top:4px;">Is domain ke saare keywords dekho:</div>
            <div class="rs-ckw-links">
              <a class="rs-ckw-link-btn semrush" href="${semrushUrl}" target="_blank">Semrush</a>
              <a class="rs-ckw-link-btn ahrefs"  href="${ahrefsUrl}"  target="_blank">Ahrefs</a>
              <a class="rs-ckw-link-btn ubersug" href="${ubersugUrl}" target="_blank">Ubersuggest</a>
            </div>
            <div style="margin-top:5px;">
              <a href="${mapsUrl}" target="_blank" style="font-size:9.5px;color:#0D9488;text-decoration:underline;">
                🔗 Google pr dekhein: site:${r.domain} + "${query.slice(0,25)}"
              </a>
            </div>
          </div>
        </div>`;
    }).join('');

    // Related autocomplete suggestions section
    const suggestionsHTML = relatedSuggestions.length ? `
      <div style="margin-top:6px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <div class="rs-ckw-title-label" style="margin-bottom:4px;">Google Autocomplete — "${query}" se related queries:</div>
        <div style="line-height:1.9;">
          ${relatedSuggestions.map(s => `<span class="rs-ckw-kw-pill" style="background:#dbeafe;color:#1e40af;" onclick="window.open('https://www.google.com/search?q=${encodeURIComponent(s)}','_blank')">${s}</span>`).join('')}
        </div>
      </div>` : '';

    container.innerHTML = `
      <div style="font-size:10px;color:#94a3b8;margin-bottom:8px;">
        Har competitor pr click karo keywords aur tools dekhne ke liye
      </div>
      ${html}
      ${suggestionsHTML}`;
  }

  function collectSerpData() {
    const results = [];
    const seen = new Set();

    console.log('[ShahzaibSEO] Starting SERP data collection...');

    /**
     * Resolve the real destination URL from a Google result link.
     * Handles:
     *  - normal https://example.com links
     *  - classic /url?q= redirects
     *  - Aug 2026 google.com/goto?url=... (base64 / custom encoded) passthroughs
     *  - visible cite / green URL text as last-resort fallback
     */
    function resolveDestinationUrl(a, container) {
      if (!a) return null;
      let href = a.getAttribute('href') || a.href || '';

      // Classic Google redirect: /url?q=https%3A%2F%2Fexample.com&...
      if (href.startsWith('/url?') || href.includes('google.com/url?')) {
        try {
          const u = href.startsWith('http') ? new URL(href) : new URL(href, 'https://www.google.com');
          const q = u.searchParams.get('q') || u.searchParams.get('url');
          if (q && q.startsWith('http')) href = q;
        } catch (e) {}
      }

      // Aug 2026+ passthrough: https://www.google.com/goto?url=...
      // The real URL is either in ?url= (sometimes base64-like) or recoverable
      // from the visible cite / data attributes / ping.
      if (/google\.[^/]+\/goto/i.test(href) || href.includes('/goto?')) {
        try {
          const u = new URL(href, 'https://www.google.com');
          let raw = u.searchParams.get('url') || u.searchParams.get('q') || '';
          if (raw) {
            // Try plain URL first
            if (raw.startsWith('http')) {
              href = raw;
            } else {
              // Try URL-decode then base64 / base64url decode
              try {
                const dec = decodeURIComponent(raw);
                if (dec.startsWith('http')) href = dec;
              } catch (e) {}
              if (!href.startsWith('http') || /google\.[^/]+\/goto/i.test(href)) {
                try {
                  // base64 / base64url
                  let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
                  while (b64.length % 4) b64 += '=';
                  const decoded = atob(b64);
                  if (decoded.startsWith('http')) href = decoded;
                } catch (e) {}
              }
            }
          }
        } catch (e) {}
      }

      // data-* attributes Google sometimes keeps
      if (!href.startsWith('http') || /google\.[^/]+\/(goto|url)/i.test(href)) {
        const dataUrl = a.getAttribute('data-href') || a.getAttribute('data-url') ||
          a.getAttribute('ping') || '';
        if (dataUrl && dataUrl.startsWith('http') && !/google\.[^/]+\/(goto|url|search)/i.test(dataUrl)) {
          href = dataUrl;
        }
      }

      // Visible cite / green URL (most reliable fallback for /goto era)
      // Looks like: "https://www.example.com › path" or "example.com › path"
      if (!href.startsWith('http') || /google\.[^/]+\/(goto|url|search)/i.test(href)) {
        const root = container || a.closest('.g, .MjjYud, .tF2Cxc, [data-hveid], [data-sokoban-container]') || a.parentElement;
        if (root) {
          const cite = root.querySelector('cite, .tjvcx, .qLRxge, .ulCwxb, .xBegd, span[role="text"]');
          if (cite) {
            let citeText = (cite.textContent || '').trim();
            // Strip trailing › path crumbs and protocol noise
            citeText = citeText.split(/[›>]/)[0].trim();
            citeText = citeText.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\s\/]/)[0];
            if (citeText && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(citeText)) {
              href = 'https://' + citeText;
            }
          }
          // Also try the breadcrumb-style display URL under the title
          if (!href.startsWith('http') || /google\./i.test(href)) {
            const display = root.querySelector('.TbwUpd, .iUh30, .qLRxge cite, .ylgj0e');
            if (display) {
              let t = (display.textContent || '').trim().split(/[›>]/)[0].trim();
              t = t.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\s\/]/)[0];
              if (t && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) {
                href = 'https://' + t;
              }
            }
          }
        }
      }

      if (!href || !href.startsWith('http')) return null;
      // Reject remaining Google internal links
      try {
        const host = new URL(href).hostname.toLowerCase();
        if (host.includes('google.') || host.includes('gstatic.') || host.includes('googleapis.') ||
            host.includes('youtube.com') && href.includes('/results')) {
          return null;
        }
      } catch (e) { return null; }
      return href;
    }

    function parseDomain(href) {
      if (!href) return null;
      try {
        const domain = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
        if (!domain || domain.includes('google.') || domain.includes('gstatic.') || domain.includes('googleapis.')) return null;
        return domain;
      } catch (e) { return null; }
    }

    function isAdOrUI(el) {
      const checks = [
        () => !!el.closest('[data-text-ad]'),
        () => !!el.querySelector('[data-text-ad]'),
        () => !!el.closest('.ads-visurl'),
        () => !!el.closest('[aria-label="Ads"]'),
        () => !!el.closest('.commercial-unit-desktop-top'),
        () => !!el.closest('.pla-unit'),
        () => !!el.closest('[data-text-ad="1"]'),
        () => (el.getAttribute('data-text-ad') != null),
      ];
      return checks.some(c => { try { return c(); } catch (e) { return false; } });
    }

    function pushResult(h3, a, container) {
      const href = resolveDestinationUrl(a, container);
      const domain = parseDomain(href);
      if (!domain || seen.has(domain)) return false;
      seen.add(domain);
      const snippet = container
        ? container.querySelector('.VwiC3b, .IsZvec, .lEBKkf, .yXK7lf, .s3v9rd, [data-sncf="1"], .yDYNvb')
        : null;
      results.push({
        title: (h3 && h3.textContent.trim()) || (a && a.textContent.trim()) || '',
        domain,
        url: href,
        snippet: snippet ? snippet.textContent.trim() : ''
      });
      console.log('[ShahzaibSEO] Added result #' + results.length + ':', domain, href);
      return true;
    }

    // ── Strategy 1: Classic / modern containers ──────────────────────────
    const containerSelectors = [
      '#rso .g', '#rso > div > .g', '#search .g',
      '#search .MjjYud', '#rso .MjjYud',
      '#search .tF2Cxc', '.tF2Cxc',
      '#search div[data-sokoban-container]',
      '#rso > div'
    ];
    let classGContainers = [];
    for (const sel of containerSelectors) {
      classGContainers = Array.from(document.querySelectorAll(sel)).filter(el => {
        if (isAdOrUI(el)) return false;
        // Prefer outermost organic blocks
        if (el.parentElement && el.parentElement.closest('.g, .MjjYud')) return false;
        return !!el.querySelector('h3');
      });
      if (classGContainers.length >= 3) break;
    }
    console.log('[ShahzaibSEO] Strategy1: containers found:', classGContainers.length);
    classGContainers.forEach(container => {
      if (results.length >= 12) return;
      if (isAdOrUI(container)) return;
      const h3 = container.querySelector('h3');
      if (!h3) return;
      // Prefer the title link, then any outbound link
      let a = h3.closest('a[href]') || container.querySelector('.yuRUbf > a[href], a[href^="http"], a[href^="/url"], a[href*="/goto"]');
      if (!a) {
        const links = container.querySelectorAll('a[href]');
        for (const cand of links) {
          if (cand.querySelector('h3') || cand.closest('h3') || cand.getAttribute('href')) {
            a = cand;
            break;
          }
        }
      }
      if (a) pushResult(h3, a, container);
    });

    // ── Strategy 2: data-hveid containers (AI Overview layouts) ───────────
    {
      const hveidContainers = document.querySelectorAll('#search div[data-hveid], #rso div[data-hveid]');
      console.log('[ShahzaibSEO] Strategy2: data-hveid containers found:', hveidContainers.length);
      hveidContainers.forEach(container => {
        if (results.length >= 12) return;
        if (isAdOrUI(container)) return;
        if (container.parentElement?.closest('[data-hveid]')) return;
        const h3 = container.querySelector('h3');
        if (!h3) return;
        const link = h3.closest('a[href]') || h3.querySelector('a[href]') ||
          container.querySelector('a[href^="http"], a[href^="/url"], a[href*="/goto"]');
        if (link) pushResult(h3, link, container);
      });
    }

    // ── Strategy 3: Brute-force h3 scan ───────────────────────────────────
    if (results.length < 3) {
      console.log('[ShahzaibSEO] Strategy3: brute-force h3 scan');
      document.querySelectorAll('#search h3, #rso h3, #center_col h3').forEach(h3 => {
        if (results.length >= 12) return;
        if (isAdOrUI(h3)) return;
        let a = h3.closest('a[href]') || h3.querySelector('a[href]');
        if (!a) {
          let p = h3.parentElement;
          for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
            const found = p.querySelector('a[href^="http"], a[href^="/url"], a[href*="/goto"]');
            if (found) { a = found; break; }
          }
        }
        if (!a) return;
        const container = h3.closest('[data-hveid], .g, .MjjYud, .tF2Cxc') || h3.parentElement;
        pushResult(h3, a, container);
      });
    }

    // ── Strategy 4: Structural a:has(h3) (class-agnostic) ─────────────────
    if (results.length < 3) {
      console.log('[ShahzaibSEO] Strategy4: a:has(h3) structural scan');
      try {
        document.querySelectorAll('a:has(h3)').forEach(a => {
          if (results.length >= 12) return;
          if (isAdOrUI(a)) return;
          const h3 = a.querySelector('h3');
          if (!h3) return;
          const container = a.closest('.g, .MjjYud, .tF2Cxc, [data-hveid]') || a.parentElement;
          pushResult(h3, a, container);
        });
      } catch (e) {
        // :has() unsupported in very old engines — ignore
      }
    }

    console.log('[ShahzaibSEO] Final collected results:', results.length, results.map(r => r.domain));
    return results;
  }

  // ─── Find/create right column ─────────────────────────────────────────────
  function getRightColumn() {
    // 1. Check if Google has a real right column (knowledge panel, etc.)
    const selectors = ['#rhs', '.rhsvw', '[id="rhs"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        // Real Google RHS exists - use it
        return el;
      }
    }

    // 2. Create a fixed sidebar that doesn't interfere with Google's layout
    const existing = document.getElementById('rs-sidebar-host');
    if (existing) return existing;

    // ── Calculate top offset to avoid overlapping the search bar + AI Overview ──
    // We look at actual element heights so we never cover Google's own UI.
    function calcTopOffset() {
      // Fixed position: always start at 120px (below Google search bar + nav tabs).
      // We intentionally do NOT track AI Overview height — the sidebar is independently
      // scrollable and should always be visible at a consistent position regardless of
      // what Google renders on the left side of the page.
      return 120;
    }

    const topOffset = calcTopOffset();

    const host = document.createElement('div');
    host.id = 'rs-sidebar-host';
    host.style.cssText = [
      'position: fixed',
      `top: ${topOffset}px`,
      'right: 16px',
      'width: 320px',
      `max-height: calc(100vh - ${topOffset + 20}px)`,
      'overflow-y: auto',
      'overflow-x: hidden',
      'z-index: 2147483600',
      'box-sizing: border-box',
      'scrollbar-width: thin',
      'scrollbar-color: #c7d2fe #f8fafc',
      'pointer-events: auto'
    ].join(';');

    document.body.appendChild(host);

    // Position is fixed at 120px — no dynamic adjustment needed.
    // Sidebar is independently scrollable regardless of AI Overview size.

    return host;
  }

  // ─── INTERNATIONAL SERP CHECKER ──────────────────────────────────────────
  // ─── LOCKED SERP REGION (pinned top bar) ───────────────────────────────────
  // Lets the user pin one country+language. While locked, EVERY keyword search
  // on Google is auto-rewritten to that region's SERP via gl/hl — so they don't
  // have to reopen the International checker for each keyword.
  const RS_REGIONS = [
    ['us-en','United States - English','us','en'],['uk-en','United Kingdom - English','uk','en'],
    ['ca-en','Canada - English','ca','en'],['ca-fr','Canada - French','ca','fr'],
    ['au-en','Australia - English','au','en'],['pk-en','Pakistan - English','pk','en'],
    ['in-en','India - English','in','en'],['ae-en','UAE - English','ae','en'],['ae-ar','UAE - Arabic','ae','ar'],
    ['sa-ar','Saudi Arabia - Arabic','sa','ar'],['eg-ar','Egypt - Arabic','eg','ar'],
    ['de-de','Germany - German','de','de'],['fr-fr','France - French','fr','fr'],
    ['es-es','Spain - Spanish','es','es'],['it-it','Italy - Italian','it','it'],
    ['nl-nl','Netherlands - Dutch','nl','nl'],['br-pt','Brazil - Portuguese','br','pt'],
    ['mx-es','Mexico - Spanish','mx','es'],['jp-ja','Japan - Japanese','jp','ja'],
    ['cn-zh','China - Chinese','cn','zh'],['kr-ko','South Korea - Korean','kr','ko'],
    ['ru-ru','Russia - Russian','ru','ru'],['tr-tr','Turkey - Turkish','tr','tr'],
    ['pl-pl','Poland - Polish','pl','pl'],['se-sv','Sweden - Swedish','se','sv'],
    ['no-no','Norway - Norwegian','no','no'],['dk-da','Denmark - Danish','dk','da'],
    ['fi-fi','Finland - Finnish','fi','fi'],['sg-en','Singapore - English','sg','en'],
    ['my-en','Malaysia - English','my','en'],['ph-en','Philippines - English','ph','en'],
    ['id-id','Indonesia - Indonesian','id','id'],['th-th','Thailand - Thai','th','th'],
    ['vn-vi','Vietnam - Vietnamese','vn','vi'],['nz-en','New Zealand - English','nz','en'],
    ['ie-en','Ireland - English','ie','en'],['za-en','South Africa - English','za','en'],
    ['ng-en','Nigeria - English','ng','en'],['ar-es','Argentina - Spanish','ar','es'],
    ['co-es','Colombia - Spanish','co','es'],['cl-es','Chile - Spanish','cl','es'],
    ['pt-pt','Portugal - Portuguese','pt','pt'],['gr-el','Greece - Greek','gr','el'],
    ['cz-cs','Czech Republic - Czech','cz','cs'],['ro-ro','Romania - Romanian','ro','ro'],
    ['hu-hu','Hungary - Hungarian','hu','hu'],['il-he','Israel - Hebrew','il','he'],
    ['ua-uk','Ukraine - Ukrainian','ua','uk'],['be-nl','Belgium - Dutch','be','nl'],
    ['ch-de','Switzerland - German','ch','de'],['at-de','Austria - German','at','de']
  ];
  function rsRegionByVal(v) { return RS_REGIONS.find(r => r[0] === v); }

  // Cached lock state (loaded from storage at boot, updated on save).
  let rsLock = null;

  // Fill gl/hl from `val` if a saved lock only has the region code (e.g. when
  // it was written from the popup). val is always "<gl>-<hl>".
  function rsNormalizeLock(lock) {
    if (!lock) return lock;
    if (lock.gl && lock.hl) return lock;
    const r = rsRegionByVal(lock.val);
    return r ? { ...lock, gl: r[2], hl: r[3] } : lock;
  }

  // Build Google's "uule" location parameter for a place name. NOTE: uule is an
  // UNDOCUMENTED Google param (community-derived); it localises the SERP to a
  // place but precision is approximate and Google may change it without notice.
  // Empty location → '' (no uule).
  function rsUule(loc) {
    try {
      const name = String(loc || '').trim();
      if (!name) return '';
      // w+CAIQICI + base64( <byte:name length> + name )  (UTF-8 safe)
      const bytes = String.fromCharCode(name.length) + name;
      return 'w+CAIQICI' + btoa(unescape(encodeURIComponent(bytes)));
    } catch (_) { return ''; }
  }

  // If a region is locked, force the current /search page to that gl/hl (+uule).
  // Reloads the page once (results are server-rendered, so a reload is the only
  // way to change the SERP region). Guarded so it can't loop.
  function applyLockedRegion(lock) {
    try {
      lock = rsNormalizeLock(lock);
      if (!lock || !lock.enabled || !lock.gl) return;
      if (!location.pathname.startsWith('/search')) return;
      const params = new URLSearchParams(location.search);
      if (!params.get('q')) return;                       // not a real query page
      const wantUule = lock.loc ? rsUule(lock.loc) : '';
      const curGl = (params.get('gl') || '').toLowerCase();
      const curHl = (params.get('hl') || '').toLowerCase();
      const curUule = params.get('uule') || '';
      // Already correct → nothing to do.
      if (curGl === lock.gl && curHl === lock.hl && curUule === wantUule) return;
      if (window.__rsRegionRedirected) return;            // one redirect per load
      window.__rsRegionRedirected = true;
      params.set('gl', lock.gl);
      params.set('hl', lock.hl);
      if (wantUule) params.set('uule', wantUule); else params.delete('uule');
      location.search = params.toString();                // triggers reload
    } catch (_) { /* never block the sidebar on a region error */ }
  }

  // Status text shared by the sidebar bar (kept as a pure helper so the popup
  // and the storage.onChanged sync can reuse the same wording).
  function rsLockStatusHTML(val, enabled, loc) {
    const r = rsRegionByVal(val);
    const name = r ? r[1] : val;
    if (enabled) {
      const where = loc ? ` &middot; 📍 ${loc}` : '';
      return `<span style="color:#0D9488;font-weight:700;">🔒 Locked: ${name}${where}.</span> <span style="color:#64748b;">Every keyword search opens in this region automatically.</span>`;
    }
    return `<span style="color:#94a3b8;">Off — searches use your normal Google region. Turn on <b>Lock</b> to force this region (and optional city) for every keyword.</span>`;
  }

  // Push the current rsLock state into the sidebar bar controls (used on first
  // setup and whenever the popup changes the lock via storage.onChanged).
  function rsSyncLockBarUI() {
    const sel = document.getElementById('rs-region-lock-select');
    const tog = document.getElementById('rs-region-lock-toggle');
    const locInput = document.getElementById('rs-region-lock-loc');
    const statusEl = document.getElementById('rs-region-lock-status');
    if (!sel || !tog || !statusEl) return;
    if (rsLock && rsLock.val && rsRegionByVal(rsLock.val)) sel.value = rsLock.val;
    if (locInput) locInput.value = (rsLock && rsLock.loc) || '';
    tog.checked = !!(rsLock && rsLock.enabled);
    statusEl.innerHTML = rsLockStatusHTML(sel.value, tog.checked, locInput ? locInput.value.trim() : '');
  }

  function buildRegionLockBar() {
    const wrap = document.createElement('div');
    wrap.id = 'rs-region-lock';
    wrap.style.cssText = 'background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:8px 9px;margin-bottom:10px;';
    const opts = RS_REGIONS.map(r => `<option value="${r[0]}">${r[1]}</option>`).join('');
    const locked = !!(rsLock && rsLock.enabled);
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span style="font-size:11px;font-weight:700;color:#0D9488;letter-spacing:.02em;">LOCK SERP REGION</span>
        <label style="margin-left:auto;display:flex;align-items:center;gap:5px;cursor:pointer;font-size:10px;color:#0f766e;font-weight:700;">
          <input type="checkbox" id="rs-region-lock-toggle" ${locked ? 'checked' : ''} style="cursor:pointer;width:13px;height:13px;accent-color:#0D9488;"/>Lock
        </label>
      </div>
      <select id="rs-region-lock-select" style="width:100%;font-size:11px;padding:5px 6px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#0f172a;cursor:pointer;">${opts}</select>
      <input id="rs-region-lock-loc" placeholder="City (optional) — e.g. Mumbai" style="width:100%;margin-top:6px;font-size:11px;padding:5px 6px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#0f172a;box-sizing:border-box;"/>
      <div id="rs-region-lock-status" style="font-size:9.5px;margin-top:5px;line-height:1.4;"></div>
    `;
    return wrap;
  }

  function setupRegionLockBar() {
    const sel = document.getElementById('rs-region-lock-select');
    const tog = document.getElementById('rs-region-lock-toggle');
    const locInput = document.getElementById('rs-region-lock-loc');
    const statusEl = document.getElementById('rs-region-lock-status');
    if (!sel || !tog || !statusEl) return;

    // Seed dropdown: saved value → else current page's gl → else US.
    if (rsLock && rsLock.val && rsRegionByVal(rsLock.val)) {
      sel.value = rsLock.val;
    } else {
      const curGl = new URLSearchParams(location.search).get('gl');
      const match = curGl ? RS_REGIONS.find(r => r[2] === curGl.toLowerCase()) : null;
      sel.value = match ? match[0] : 'us-en';
    }
    if (locInput && rsLock && rsLock.loc) locInput.value = rsLock.loc;

    function save(applyNow) {
      const r = rsRegionByVal(sel.value) || RS_REGIONS[0];
      const loc = locInput ? locInput.value.trim() : '';
      rsLock = { enabled: tog.checked, val: r[0], gl: r[2], hl: r[3], loc };
      window.__rsLockSelfWrite = true;                    // skip our own onChanged re-apply
      chrome.storage.local.set({ rsLockedRegion: rsLock });
      statusEl.innerHTML = rsLockStatusHTML(sel.value, tog.checked, loc);
      if (applyNow && tog.checked) {
        window.__rsRegionRedirected = false;
        applyLockedRegion(rsLock); // reloads if current page isn't already this region
      }
    }

    tog.addEventListener('change', () => save(true));
    sel.addEventListener('change', () => save(true));
    if (locInput) {
      // Apply when the user leaves the field or hits Enter — not on each keystroke.
      locInput.addEventListener('change', () => save(true));
      locInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(true); } });
    }
    statusEl.innerHTML = rsLockStatusHTML(sel.value, tog.checked, locInput ? locInput.value.trim() : '');
  }

  function buildInternationalSerpPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    const countryOptions = [
      ['us-en','United States - English'],['uk-en','United Kingdom - English'],
      ['ca-en','Canada - English'],['ca-fr','Canada - French'],
      ['au-en','Australia - English'],['pk-en','Pakistan - English'],
      ['in-en','India - English'],['ae-en','UAE - English'],['ae-ar','UAE - Arabic'],
      ['sa-ar','Saudi Arabia - Arabic'],['eg-ar','Egypt - Arabic'],
      ['de-de','Germany - German'],['fr-fr','France - French'],
      ['es-es','Spain - Spanish'],['it-it','Italy - Italian'],
      ['nl-nl','Netherlands - Dutch'],['br-pt','Brazil - Portuguese'],
      ['mx-es','Mexico - Spanish'],['jp-ja','Japan - Japanese'],
      ['cn-zh','China - Chinese'],['kr-ko','South Korea - Korean'],
      ['ru-ru','Russia - Russian'],['tr-tr','Turkey - Turkish'],
      ['pl-pl','Poland - Polish'],['se-sv','Sweden - Swedish'],
      ['no-no','Norway - Norwegian'],['dk-da','Denmark - Danish'],
      ['fi-fi','Finland - Finnish'],['sg-en','Singapore - English'],
      ['my-en','Malaysia - English'],['ph-en','Philippines - English'],
      ['id-id','Indonesia - Indonesian'],['th-th','Thailand - Thai'],
      ['vn-vi','Vietnam - Vietnamese'],['nz-en','New Zealand - English'],
      ['ie-en','Ireland - English'],['za-en','South Africa - English'],
      ['ng-en','Nigeria - English'],['ar-es','Argentina - Spanish'],
      ['co-es','Colombia - Spanish'],['cl-es','Chile - Spanish'],
      ['pt-pt','Portugal - Portuguese'],['gr-el','Greece - Greek'],
      ['cz-cs','Czech Republic - Czech'],['ro-ro','Romania - Romanian'],
      ['hu-hu','Hungary - Hungarian'],['il-he','Israel - Hebrew'],
      ['ua-uk','Ukraine - Ukrainian'],['be-nl','Belgium - Dutch'],
      ['ch-de','Switzerland - German'],['at-de','Austria - German']
    ].map(([v,l]) => `<option value="${v}">${l}</option>`).join('');

    const body = `
      <div class="rs-intl-form">
        <div>
          <div class="rs-intl-label">Search Keyword</div>
          <input class="rs-intl-input" id="rs-intl-keyword" placeholder="Enter search query…" />
        </div>
        <div>
          <div class="rs-intl-label">Country &amp; Language</div>
          <select class="rs-intl-select" id="rs-intl-country">${countryOptions}</select>
        </div>
        <div>
          <div class="rs-intl-label">Location (Optional)</div>
          <input class="rs-intl-input" id="rs-intl-location" placeholder="e.g. New York, NY" />
        </div>
        <button class="rs-intl-btn" id="rs-intl-go-btn">Search International SERP</button>
      </div>
      <div style="font-size:9.5px;color:#94a3b8;margin-top:6px;line-height:1.4;">Opens Google with the selected country &amp; language settings — no VPN needed.</div>
    `;
    return makePanel('rs-panel-intl', svg, 'International SERP Checker', body, true);
  }

  function setupInternationalSerp() {
    const countryMap = {
      'us-en':{gl:'us',hl:'en'},'uk-en':{gl:'uk',hl:'en'},'ca-en':{gl:'ca',hl:'en'},
      'ca-fr':{gl:'ca',hl:'fr'},'au-en':{gl:'au',hl:'en'},'pk-en':{gl:'pk',hl:'en'},
      'in-en':{gl:'in',hl:'en'},'ae-en':{gl:'ae',hl:'en'},'ae-ar':{gl:'ae',hl:'ar'},
      'sa-ar':{gl:'sa',hl:'ar'},'eg-ar':{gl:'eg',hl:'ar'},'de-de':{gl:'de',hl:'de'},
      'fr-fr':{gl:'fr',hl:'fr'},'es-es':{gl:'es',hl:'es'},'it-it':{gl:'it',hl:'it'},
      'nl-nl':{gl:'nl',hl:'nl'},'br-pt':{gl:'br',hl:'pt'},'mx-es':{gl:'mx',hl:'es'},
      'jp-ja':{gl:'jp',hl:'ja'},'cn-zh':{gl:'cn',hl:'zh'},'kr-ko':{gl:'kr',hl:'ko'},
      'ru-ru':{gl:'ru',hl:'ru'},'tr-tr':{gl:'tr',hl:'tr'},'pl-pl':{gl:'pl',hl:'pl'},
      'se-sv':{gl:'se',hl:'sv'},'no-no':{gl:'no',hl:'no'},'dk-da':{gl:'dk',hl:'da'},
      'fi-fi':{gl:'fi',hl:'fi'},'sg-en':{gl:'sg',hl:'en'},'my-en':{gl:'my',hl:'en'},
      'ph-en':{gl:'ph',hl:'en'},'id-id':{gl:'id',hl:'id'},'th-th':{gl:'th',hl:'th'},
      'vn-vi':{gl:'vn',hl:'vi'},'nz-en':{gl:'nz',hl:'en'},'ie-en':{gl:'ie',hl:'en'},
      'za-en':{gl:'za',hl:'en'},'ng-en':{gl:'ng',hl:'en'},'ar-es':{gl:'ar',hl:'es'},
      'co-es':{gl:'co',hl:'es'},'cl-es':{gl:'cl',hl:'es'},'pt-pt':{gl:'pt',hl:'pt'},
      'gr-el':{gl:'gr',hl:'el'},'cz-cs':{gl:'cz',hl:'cs'},'ro-ro':{gl:'ro',hl:'ro'},
      'hu-hu':{gl:'hu',hl:'hu'},'il-he':{gl:'il',hl:'he'},'ua-uk':{gl:'ua',hl:'uk'},
      'be-nl':{gl:'be',hl:'nl'},'ch-de':{gl:'ch',hl:'de'},'at-de':{gl:'at',hl:'de'}
    };

    setTimeout(() => {
      const btn = document.getElementById('rs-intl-go-btn');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const keyword = (document.getElementById('rs-intl-keyword') || {}).value?.trim();
        const countryVal = (document.getElementById('rs-intl-country') || {}).value || 'us-en';
        const location  = (document.getElementById('rs-intl-location') || {}).value?.trim();

        if (!keyword) { showToast('Enter a keyword first'); return; }

        const cfg = countryMap[countryVal] || { gl: 'us', hl: 'en' };
        let url = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&gl=${cfg.gl}&hl=${cfg.hl}`;
        if (location) url += `&near=${encodeURIComponent(location)}`;

        btn.textContent = '✅ Opened!';
        btn.disabled = true;
        setTimeout(() => { btn.textContent = '🌍 Search International SERP'; btn.disabled = false; }, 2000);

        // window.open is the most reliable method from a content script.
        // Also try the background tab opener as a bonus (won't block if it fails).
        window.open(url, '_blank');
        try { chrome.runtime.sendMessage({ action: 'OPEN_TAB', url }); } catch(e) {}
      });
    }, 300);
  }

  // ─── EXPORT TOP 100 SERP TO CSV ──────────────────────────────────────────
  function buildExportSerpPanel() {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    const body = `
      <div class="rs-export-form">
        <div>
          <div class="rs-intl-label">Search Keyword</div>
          <input class="rs-intl-input" id="rs-export-keyword" placeholder="e.g. best laptops 2025" />
        </div>
        <button class="rs-export-btn" id="rs-export-go-btn">Search &amp; Export to CSV</button>
      </div>
      <div id="rs-export-progress" class="rs-export-progress">
        <span id="rs-export-status">Starting…</span>
        <div class="rs-export-bar-wrap"><div id="rs-export-bar" class="rs-export-bar"></div></div>
      </div>
      <div class="rs-export-note">Fetches up to 10 pages (100 results) from Google and downloads a CSV — no API key required.</div>
    `;
    return makePanel('rs-panel-export', svg, 'Export Top 100 SERP to CSV', body, true);
  }

  function setupExportSerp() {
    let _exportRunning = false;
    setTimeout(() => {
      const btn = document.getElementById('rs-export-go-btn');
      if (!btn) return;

      btn.addEventListener('click', async () => {
        if (_exportRunning) return;
        const kwInput = document.getElementById('rs-export-keyword');
        const kw = kwInput ? kwInput.value.trim() : '';
        if (!kw) { showToast('Enter a keyword to export'); return; }

        const progress = document.getElementById('rs-export-progress');
        const statusEl = document.getElementById('rs-export-status');
        const barEl    = document.getElementById('rs-export-bar');

        _exportRunning = true;
        btn.disabled = true;
        btn.textContent = '\u23F3 Fetching\u2026';
        if (progress) progress.style.display = 'block';
        if (statusEl) statusEl.textContent = 'Starting\u2026';
        if (barEl) barEl.style.width = '0%';

        const allResults = [];
        let emptyPages = 0;

        try {
          for (let page = 0; page < RS_MAX_PAGES && allResults.length < RS_TARGET && emptyPages < 3; page++) {
            const pct = Math.round((page / RS_MAX_PAGES) * 90);
            if (statusEl) statusEl.textContent = 'Page ' + (page + 1) + '/10 \u2014 ' + allResults.length + ' results\u2026';
            if (barEl) barEl.style.width = pct + '%';

            await rsSleep(page === 0 ? 0 : 1200 + Math.random() * 800);

            try {
              let pageResults = await rsFetchGooglePage(kw, page * 10);

              if (pageResults.length === 0) { emptyPages++; continue; }
              emptyPages = 0;

              for (const r of pageResults) {
                if (allResults.length >= RS_TARGET) break;
                allResults.push({
                  position: allResults.length + 1,
                  title: r.title || '',
                  url: r.url || '',
                  domain: r.domain || ''
                });
              }
            } catch(pageErr) {
              emptyPages++;
            }
          }

          if (allResults.length === 0) {
            if (statusEl) statusEl.textContent = '\u26A0\uFE0F No results found. Try a different keyword.';
            setTimeout(() => { if (progress) progress.style.display = 'none'; }, 3000);
            return;
          }

          // Build and download CSV
          if (barEl) barEl.style.width = '95%';
          const rows = allResults.map(r =>
            r.position + ',"' + String(r.title).replace(/"/g, '""') + '","' + r.url + '","' + r.domain + '"'
          );
          const csv = 'Position,Title,URL,Domain\r\n' + rows.join('\r\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = 'SERP_' + kw.replace(/[^a-z0-9]/gi, '_').slice(0, 40) + '_top' + allResults.length + '.csv';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(blobUrl); a.remove(); }, 2000);

          if (statusEl) statusEl.textContent = '\u2705 Exported ' + allResults.length + ' results!';
          if (barEl) barEl.style.width = '100%';
        } catch(err) {
          if (statusEl) statusEl.textContent = '\u274C ' + (err.message || 'Export failed');
        } finally {
          _exportRunning = false;
          btn.disabled = false;
          btn.textContent = '\uD83D\uDCE5 Search & Export to CSV';
          setTimeout(() => { if (progress) progress.style.display = 'none'; }, 3000);
        }
      });
    }, 300);
  }

  // ─── Main inject ──────────────────────────────────────────────────────────
  function injectSidebar() {
    // Suppress on Images/Videos/News/Forums/etc. — web results page only.
    if (!isWebResultsPage()) { removeSidebar(); return; }
    if (document.getElementById('rs-sidebar')) return;

    const rhs = getRightColumn();
    if (!rhs) {
      setTimeout(injectSidebar, 1500);
      return;
    }

    const query = getQuery();
    if (!query) return;

    // Add toggle button (only for fixed host, not Google's real rhs)
    if (rhs.id === 'rs-sidebar-host') {
      if (!document.getElementById('rs-sidebar-toggle')) {
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'rs-sidebar-toggle';
        toggleBtn.title = 'ShahzaibSEO Sidebar toggle';
        toggleBtn.innerHTML = '◀';
        toggleBtn.style.right = '340px';
        
        // Set initial top position based on current calculation
        const currentTop = parseInt(rhs.style.top) || 120;
        toggleBtn.style.top = currentTop + 'px';
        // Match top of sidebar host
        toggleBtn.style.top = rhs.style.top || '120px';
        let collapsed = false;
        toggleBtn.addEventListener('click', () => {
          collapsed = !collapsed;
          rhs.style.display = collapsed ? 'none' : 'block';
          toggleBtn.innerHTML = collapsed ? '▶' : '◀';
          toggleBtn.style.right = collapsed ? '8px' : '340px';
        });
        document.body.appendChild(toggleBtn);
      }
    }

    const sidebar = document.createElement('div');
    sidebar.id = 'rs-sidebar';

    // ShahzaibSEO header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:7px;padding:8px 2px 10px;border-bottom:1px solid #e2e8f0;margin-bottom:10px;';
    header.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 17l4-8 4 4 4-6 4 10" stroke="#0D9488" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 17H3" stroke="#0f766e" stroke-width="1.5" stroke-linecap="round"/></svg>
      <span style="font-size:12px;font-weight:700;color:#0D9488;letter-spacing:.03em;">ShahzaibSEO</span>
      <span style="font-size:10px;color:#94a3b8;margin-left:auto;">SERP Analysis</span>
    `;
    sidebar.appendChild(header);

    // Pinned region lock — stays at the very top so the chosen country sticks
    // for every keyword without reopening the International checker.
    sidebar.appendChild(buildRegionLockBar());

    // Build all panels
    sidebar.appendChild(buildStatsPanel());
    // Keyword Overview + Favorites ABOVE Google Trends (user preference)
    sidebar.appendChild(buildKeywordPanel(query));
    sidebar.appendChild(buildFavoritesPanel());
    sidebar.appendChild(buildTrendsPanel(query));
    sidebar.appendChild(buildCompetitorPanel());
    sidebar.appendChild(buildNichePanel());           // Niche Opportunity (ported)
    if (window.__rsMyGapEnabled !== false) {
      sidebar.appendChild(buildMyGapPanel());           // My Site Gap (toggleable)
    }
    sidebar.appendChild(buildIdeasPanel(query));
    sidebar.appendChild(buildSerpScraperPanel());     // Full SERP Scraper (Malaika Aman)
    sidebar.appendChild(buildSerpFeaturesPanel());
    sidebar.appendChild(buildRelatedPanel(query));
    sidebar.appendChild(buildAIPanel(query));
    sidebar.appendChild(buildAIOverviewPanel());      // AI Overview (SGE) tracker
    sidebar.appendChild(buildPAAPanel());             // People Also Ask scraper
    sidebar.appendChild(buildContentBriefPanel());    // Content brief generator
    sidebar.appendChild(buildAIEngineCitePanel());    // AI engine citations
    sidebar.appendChild(buildRankPanel(query));
    sidebar.appendChild(buildCannibalPanel());        // Keyword cannibalization
    sidebar.appendChild(buildBacklinksExplorerPanel());   // Backlinks Explorer (free)
    sidebar.appendChild(buildInternationalSerpPanel());
    sidebar.appendChild(buildExportSerpPanel());
    sidebar.appendChild(buildSettingsPanel());

    // Insert at top of right column
    rhs.insertBefore(sidebar, rhs.firstChild);

    // Populate with data
    const results = collectSerpData();

    populateKeywordPanel(query);
    setupFavoritesPanel(query);
    injectSearchBoxVolume(query);
    populateCompetitorPanel(results);
    populateRelatedPanel(query);
    populateIdeasPanel(query);
    setupSettingsPanel();
    setupRegionLockBar();
    setupRankTracker(results);
    setupSerpScraperPanel();     // SERP Scraper
    setupAIOverviewPanel();      // AI Overview tracker
    populatePAAPanel();          // People Also Ask
    setupContentBriefPanel();    // Content brief
    setupAIEngineCitePanel();    // AI engine citations
    setupCannibalPanel();        // Cannibalization
    setupBacklinksExplorer();
    setupInternationalSerp();
    setupExportSerp();

    // Pre-fill Export and International SERP keyword inputs with current search query
    setTimeout(() => {
      const exportKwInput = document.getElementById('rs-export-keyword');
      if (exportKwInput && !exportKwInput.value) exportKwInput.value = query;
      const intlKwInput = document.getElementById('rs-intl-keyword');
      if (intlKwInput && !intlKwInput.value) intlKwInput.value = query;
    }, 400);
    if (window.__rsMyGapEnabled !== false) {
      setupMyGapPanel(results);  // My Site Gap
    }

    // AI panel — always populate, use whatever results we have (even empty)
    // Give DOM time to settle, then re-collect if needed
    setTimeout(() => {
      const freshResults = results.length > 0 ? results : collectSerpData();
      populateAIPanel(query, freshResults);

      // Wire up the "Analyze with AI" button
      const reanalyzeBtn = document.getElementById('rs-ai-reanalyze-btn');
      if (reanalyzeBtn) {
        reanalyzeBtn.addEventListener('click', () => {
          reanalyzeBtn.disabled = true;
          reanalyzeBtn.textContent = '⏳ Analyzing…';
          const container = document.getElementById('rs-ai-body');
          if (container) {
            container.innerHTML = '<div class="rs-ai-loading"><div style="margin-bottom:8px;">🤖</div><div>AI analyzing SERP results…</div></div>';
          }
          const latestResults = collectSerpData();
          populateAIPanel(query, latestResults.length > 0 ? latestResults : freshResults);
          // Re-enable button after analysis completes (1.5s safety delay)
          setTimeout(() => {
            const btn = document.getElementById('rs-ai-reanalyze-btn');
            if (btn) { btn.disabled = false; btn.innerHTML = '&#x1F916; Analyze with AI'; }
          }, 6000);
        });
      }
    }, 800);

  }

  // ─── Background message handler for KW_OVERVIEW ──────────────────────────
  // (background.js doesn't have this action yet — handled gracefully with fallback)

  // ─── Run ──────────────────────────────────────────────────────────────────
  chrome.storage.local.get(['toolbarEnabled', 'sidebarEnabled', 'myGapEnabled', 'rsLockedRegion'], (prefs) => {
    // Region lock is independent of the sidebar toggle: if a region is pinned,
    // force it on this page first (may reload), before any sidebar checks.
    rsLock = prefs.rsLockedRegion || null;
    applyLockedRegion(rsLock);

    if (prefs.toolbarEnabled === false) return;
    if (prefs.sidebarEnabled === false) return;

    window.__rsMyGapEnabled = prefs.myGapEnabled !== false;

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(injectSidebar, 3000);
      setTimeout(injectSidebar, 5500); // Extra retry for AI Overview pages
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        setTimeout(injectSidebar, 3000);
        setTimeout(injectSidebar, 5500);
      });
    }
  });

  // SPA navigation support
  let lastQ = getQuery();
  let lastVertical = !isWebResultsPage();
  new MutationObserver(() => {
    const q = getQuery();
    const vertical = !isWebResultsPage();

    // Moved onto a vertical tab (Images/Videos/News/...) — tear the sidebar down.
    if (vertical) {
      if (!lastVertical) { lastVertical = true; removeSidebar(); }
      return;
    }

    // On a web-results page: re-inject if we just came from a vertical tab
    // or if the search query changed.
    if (lastVertical || q !== lastQ) {
      lastVertical = false;
      lastQ = q;
      // New keyword on a locked region → force it (may reload the page).
      window.__rsRegionRedirected = false;
      applyLockedRegion(rsLock);
      window.__rankseoSidebarLoaded = false;
      rsDomainData.length = 0;
      rsKwData = null; // don't show the previous keyword's numbers
      removeSidebar();
      setTimeout(injectSidebar, 1400);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── Live sync: popup (or another tab) changing the locked region ─────────
  // Applies the new lock to THIS Google tab immediately and updates the sidebar
  // bar. Our own sidebar writes set __rsLockSelfWrite so we don't double-apply.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.rsLockedRegion) return;
    rsLock = changes.rsLockedRegion.newValue || null;
    if (window.__rsLockSelfWrite) { window.__rsLockSelfWrite = false; rsSyncLockBarUI(); return; }
    rsSyncLockBarUI();
    window.__rsRegionRedirected = false;
    applyLockedRegion(rsLock);
  });

  // ─── Message Listener for Keyboard Shortcut ───────────────────────────────
  /**
   * Listen for toggle command from keyboard shortcut
   */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'toggleSerpSidebar') {
      const sidebar = document.getElementById('rs-sidebar');
      if (sidebar) {
        // Toggle visibility
        const isHidden = sidebar.style.display === 'none';
        sidebar.style.display = isHidden ? '' : 'none';
        sendResponse({ ok: true, visible: isHidden });
      } else {
        sendResponse({ ok: false, error: 'Sidebar not found' });
      }
      return true; // keep channel open for sendResponse
    }
    return false;
  });

})();