/**
 * ShahzaibSEO Popup — Niche Check
 * Single country + Multi-country "Find easiest market" (100% free)
 */
(function () {
  'use strict';

  const COUNTRY_OPTIONS = [
    ['us', 'en', 'United States - English'],
    ['uk', 'en', 'United Kingdom - English'],
    ['ca', 'en', 'Canada - English'],
    ['au', 'en', 'Australia - English'],
    ['in', 'en', 'India - English'],
    ['ae', 'en', 'UAE - English'],
    ['sa', 'ar', 'Saudi Arabia - Arabic'],
    ['pk', 'en', 'Pakistan - English'],
    ['bd', 'en', 'Bangladesh - English'],
    ['ng', 'en', 'Nigeria - English'],
    ['ph', 'en', 'Philippines - English'],
    ['id', 'id', 'Indonesia - Indonesian'],
    ['my', 'en', 'Malaysia - English'],
    ['sg', 'en', 'Singapore - English'],
    ['jp', 'ja', 'Japan - Japanese'],
    ['kr', 'ko', 'South Korea - Korean'],
    ['tw', 'zh-TW', 'Taiwan - Chinese'],
    ['hk', 'zh-TW', 'Hong Kong - Chinese'],
    ['cn', 'zh-CN', 'China - Chinese'],
    ['th', 'th', 'Thailand - Thai'],
    ['vn', 'vi', 'Vietnam - Vietnamese'],
    ['eg', 'ar', 'Egypt - Arabic'],
    ['ma', 'fr', 'Morocco - French'],
    ['gh', 'en', 'Ghana - English'],
    ['ke', 'en', 'Kenya - English'],
    ['ci', 'fr', "Côte d'Ivoire - French"],
    ['sn', 'fr', 'Senegal - French'],
    ['cm', 'fr', 'Cameroon - French'],
    ['bf', 'fr', 'Burkina Faso - French'],
    ['za', 'en', 'South Africa - English'],
    ['br', 'pt', 'Brazil - Portuguese'],
    ['mx', 'es', 'Mexico - Spanish'],
    ['de', 'de', 'Germany - German'],
    ['fr', 'fr', 'France - French'],
    ['es', 'es', 'Spain - Spanish'],
    ['it', 'it', 'Italy - Italian'],
    ['tr', 'tr', 'Turkey - Turkish'],
  ];

  /**
   * Full multi-scan pool (ordered by typical usefulness for beginners).
   * UI "How many countries" slices this list from the top (default 12).
   */
  const MULTI_MARKETS = [
    // Core English / high-opportunity
    ['us', 'en'], ['uk', 'en'], ['ca', 'en'], ['au', 'en'],
    // High-volume MENA early (sports / live TV often peak here — e.g. MA volume >> US)
    ['ma', 'fr'], ['ae', 'en'], ['sa', 'ar'], ['eg', 'ar'],
    ['in', 'en'], ['pk', 'en'],
    ['bd', 'en'], ['ng', 'en'], ['ph', 'en'], ['id', 'id'],
    // SE Asia + East Asia
    ['my', 'en'], ['sg', 'en'], ['jp', 'ja'], ['kr', 'ko'],
    ['tw', 'zh-TW'], ['hk', 'zh-TW'], ['cn', 'zh-CN'],
    ['th', 'th'], ['vn', 'vi'],
    // Africa
    ['gh', 'en'], ['ke', 'en'],
    ['ci', 'fr'], ['sn', 'fr'], ['cm', 'fr'], ['bf', 'fr'], ['za', 'en'],
    // LatAm + Europe
    ['br', 'pt'], ['mx', 'es'],
    ['de', 'de'], ['fr', 'fr'], ['es', 'es'], ['it', 'it'], ['tr', 'tr'],
  ];

  const MARKET_COUNT_OPTIONS = [8, 12, 16, 20, 24];
  const MARKET_COUNT_DEFAULT = 12;
  const MARKET_COUNT_KEY = 'rs_niche_market_count';

  let currentMode = 'single';
  let lastPayload = null;
  let multiRunning = false;
  /** Prevents re-entrant auto volume fetch while multi table re-renders */
  let multiVolFetching = false;
  /** Last multi rows with volumes — poll must not wipe these */
  let lastMultiRows = null;
  let lastMultiSeed = '';
  let multiUiStable = false;
  /** Increments on every new run — ignore late responses from previous runs */
  let runToken = 0;

  function sendMsg(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { ok: false, error: 'No response' });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: e.message || String(e) });
      }
    });
  }

  function fetchSerpPage(query, gl, hl, near) {
    return sendMsg({
      action: 'SERP_FETCH_PAGE',
      query,
      startOffset: 0,
      gl: gl || 'us',
      hl: hl || 'en',
      near: near || '',
      settleMs: 3200,
      loadTimeoutMs: 22000,
    });
  }

  function fetchDr(domain) {
    return sendMsg({ action: 'AHREFS_DR_FETCH', domain }).then((res) => {
      if (!res) return null;
      const dr = res.domainRating != null ? res.domainRating
        : res.dr != null ? res.dr
        : res.data && res.data.domainRating != null ? res.data.domainRating
        : null;
      return typeof dr === 'number' ? dr : null;
    });
  }

  function fetchMozBatch(domains) {
    return sendMsg({ action: 'MOZ_FETCH_BATCH', domains }).then((res) => {
      if (!res || !res.ok) return {};
      return res.results || res.data || {};
    });
  }

  function fetchMozOne(domain) {
    return sendMsg({ action: 'MOZ_FETCH', domain }).then((res) => {
      if (!res || res.ok === false) return null;
      return res;
    });
  }

  function fetchRdap(domain) {
    return sendMsg({ action: 'RDAP_LOOKUP', domain }).then((res) => {
      if (!res || !res.ok || !res.createdDate) return null;
      const created = new Date(res.createdDate);
      if (isNaN(created.getTime())) return null;
      const ms = Date.now() - created.getTime();
      const years = ms / (365.25 * 24 * 3600 * 1000);
      const days = Math.floor(ms / (24 * 3600 * 1000));
      const yWhole = Math.floor(years);
      const months = Math.round((years - yWhole) * 12);
      let ageLabel;
      if (days < 30) ageLabel = Math.max(0, days) + 'd';
      else if (yWhole < 1) ageLabel = Math.max(1, months || 1) + 'm';
      else ageLabel = yWhole + 'y' + (months ? ' ' + months + 'm' : '');
      return { ageYears: years, ageLabel };
    });
  }

  function isHomepageUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url.startsWith('http') ? url : 'https://' + url);
      const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
      return path === '/' || path === '';
    } catch (_) {
      return false;
    }
  }

  function normDomain(d) {
    return String(d || '').replace(/^www\./i, '').toLowerCase().trim();
  }

  /**
   * Enrich Top 10: DA/Spam/BL (batch) + DR + Age (RDAP) — slower, more complete.
   */
  async function enrichCompetitors(results, onProgress) {
    const base = (results || []).map((r, i) => ({
      domain: r.domain || '',
      url: r.url || '',
      title: r.title || '',
      serpPosition: r.position || i + 1,
      dr: null,
      da: null,
      spam: null,
      backlinks: null,
      ageYears: null,
      ageLabel: null,
      isHomepage: isHomepageUrl(r.url),
    }));

    const domains = base.map((b) => b.domain).filter(Boolean);
    if (onProgress) onProgress(0, domains.length, 'metrics');

    // Brief pause after SERP before metrics (accuracy over speed)
    await new Promise((r) => setTimeout(r, 600));

    let mozMap = {};
    try {
      mozMap = await fetchMozBatch(domains);
    } catch (_) {}

    function applyMoz(row, m) {
      if (!m) return;
      if (typeof m.domainAuthority === 'number') row.da = Math.round(m.domainAuthority);
      else if (typeof m.da === 'number') row.da = Math.round(m.da);
      if (typeof m.spamScore === 'number' && m.spamScore >= 0) row.spam = Math.round(m.spamScore);
      else if (typeof m.spam === 'number' && m.spam >= 0) row.spam = Math.round(m.spam);
      if (typeof m.backlinks === 'number' && m.backlinks > 0) row.backlinks = m.backlinks;
    }

    base.forEach((row) => {
      const key = normDomain(row.domain);
      const m = mozMap[key] || mozMap[row.domain] || mozMap['www.' + key];
      applyMoz(row, m);
    });

    // Per-domain MOZ fallback when batch omitted DA/Spam (common for some TLDs)
    for (let i = 0; i < base.length; i++) {
      const row = base[i];
      if (!row.domain) continue;
      if (row.da != null && row.spam != null) continue;
      try {
        const m = await fetchMozOne(row.domain);
        applyMoz(row, m);
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 200));
    }

    if (onProgress) onProgress(0, base.length, 'dr');
    for (let i = 0; i < base.length; i++) {
      const row = base[i];
      if (row.domain) {
        try {
          const dr = await fetchDr(row.domain);
          if (typeof dr === 'number') row.dr = dr;
        } catch (_) {}
      }
      if (onProgress) onProgress(i + 1, base.length, 'dr');
      await new Promise((r) => setTimeout(r, 320));
    }

    if (onProgress) onProgress(0, base.length, 'age');
    for (let i = 0; i < base.length; i++) {
      const row = base[i];
      if (row.domain) {
        try {
          const age = await fetchRdap(row.domain);
          if (age) {
            row.ageYears = age.ageYears;
            row.ageLabel = age.ageLabel;
          }
        } catch (_) {}
      }
      if (onProgress) onProgress(i + 1, base.length, 'age');
      await new Promise((r) => setTimeout(r, 260));
    }

    return base;
  }

  function countryLabel(gl, hl) {
    const row = COUNTRY_OPTIONS.find((c) => c[0] === gl && c[1] === hl)
      || COUNTRY_OPTIONS.find((c) => c[0] === gl);
    return row ? row[2] : (gl || 'us').toUpperCase();
  }

  function shortCountry(gl, hl) {
    const full = countryLabel(gl, hl);
    return full.split(' - ')[0] || full;
  }

  function setProgress(pct) {
    const bar = document.getElementById('nicheProgress');
    const fill = document.getElementById('nicheProgressBar');
    const n = Math.max(0, Math.min(100, Number(pct) || 0));
    // Keep bar visible while job is active (0–100); hide only when explicitly reset to 0 after stop/idle
    if (bar) {
      const stopVisible = document.getElementById('nicheStopBtn');
      const running = stopVisible && stopVisible.style.display !== 'none';
      bar.style.display = (n > 0 || running) ? 'block' : 'none';
    }
    if (fill) fill.style.width = n + '%';
    if (n >= 100) setTimeout(() => {
      const stopVisible = document.getElementById('nicheStopBtn');
      const stillRunning = stopVisible && stopVisible.style.display !== 'none';
      if (!stillRunning) {
        if (bar) bar.style.display = 'none';
        if (fill) fill.style.width = '0%';
      }
    }, 800);
  }

  /** AdSense estimate — keyword → niche category + country base RPM (rough, free) */
  const ADSENSE_COUNTRY_RPM = {
    us: 12, uk: 10, ca: 10, au: 9.5, de: 8, fr: 7, nl: 7.5, se: 7, no: 7.5, dk: 7,
    ie: 8, nz: 8, ch: 11, at: 7, be: 6.5, jp: 6, it: 5.5, es: 5, kr: 5, sg: 9,
    ae: 8, sa: 5, qa: 9, il: 6, br: 3.5, mx: 3, ar: 2.5, tr: 2.5, za: 3,
    in: 1.2, pk: 0.9, bd: 0.8, ph: 1.1, id: 1.0, my: 2.5, ng: 0.8, eg: 1.2, ma: 1.5,
  };
  const ADSENSE_NICHE_MULT = [
    { re: /\b(loan|mortgage|insurance|credit|invest|stock|forex|crypto|bitcoin|trading|bank|finance|tax|cpa|accounting)\b/i, cat: 'Finance', mult: 2.8 },
    { re: /\b(lawyer|attorney|legal|lawsuit|divorce|injury|patent)\b/i, cat: 'Legal', mult: 2.4 },
    { re: /\b(saas|software|crm|hosting|vpn|cloud|api|developer tool)\b/i, cat: 'Software / SaaS', mult: 2.2 },
    { re: /\b(real\s*estate|property|mortgage|apartment|rent)\b/i, cat: 'Real Estate', mult: 2.1 },
    { re: /\b(health|medical|doctor|clinic|supplement|weight\s*loss|diabetes|cancer)\b/i, cat: 'Health', mult: 1.7 },
    { re: /\b(tech|gadget|iphone|android|laptop|pc|smartphone|ai\b|chatgpt)\b/i, cat: 'Technology', mult: 1.6 },
    { re: /\b(marketing|seo|adsense|affiliate|email\s*list)\b/i, cat: 'Marketing', mult: 1.5 },
    { re: /\b(course|tuition|university|degree|learn|tutorial|education)\b/i, cat: 'Education', mult: 1.4 },
    { re: /\b(fitness|gym|workout|yoga|diet|nutrition)\b/i, cat: 'Fitness', mult: 1.3 },
    { re: /\b(job|career|resume|salary|hiring|remote\s*work)\b/i, cat: 'Career', mult: 1.3 },
    { re: /\b(travel|hotel|flight|visa|tourism|airline)\b/i, cat: 'Travel', mult: 1.2 },
    { re: /\b(car|auto|vehicle|motorcycle|electric\s*vehicle)\b/i, cat: 'Automotive', mult: 1.2 },
    { re: /\b(recipe|food|cooking|restaurant|cuisine)\b/i, cat: 'Food', mult: 1.0 },
    { re: /\b(fashion|beauty|makeup|skincare|clothing)\b/i, cat: 'Fashion', mult: 1.0 },
    { re: /\b(pet|dog|cat|puppy|kitten)\b/i, cat: 'Pets', mult: 1.0 },
    { re: /\b(game|gaming|esport|steam|xbox|playstation)\b/i, cat: 'Gaming', mult: 0.6 },
    { re: /\b(movie|music|celebrity|entertainment|tv\s*show|netflix)\b/i, cat: 'Entertainment', mult: 0.7 },
    { re: /\b(news|live\s*score|koora|match|football|soccer|cricket|sports)\b/i, cat: 'Sports / News', mult: 0.65 },
    { re: /\b(apk|mod\s*apk|crack|warez|torrent)\b/i, cat: 'APK / Low-intent', mult: 0.4 },
  ];

  function detectAdsenseCategory(seed) {
    const q = String(seed || '');
    for (let i = 0; i < ADSENSE_NICHE_MULT.length; i++) {
      if (ADSENSE_NICHE_MULT[i].re.test(q)) {
        return { category: ADSENSE_NICHE_MULT[i].cat, mult: ADSENSE_NICHE_MULT[i].mult };
      }
    }
    return { category: 'General / Info', mult: 0.9 };
  }

  function countryBaseRpm(gl) {
    const key = String(gl || 'us').toLowerCase();
    if (ADSENSE_COUNTRY_RPM[key] != null) return ADSENSE_COUNTRY_RPM[key];
    // rough regional defaults
    if (['us', 'uk', 'ca', 'au'].indexOf(key) >= 0) return 10;
    return 2.5;
  }

  function formatMoney(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1000) return '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    if (n >= 100) return '$' + Math.round(n);
    return '$' + n.toFixed(2);
  }

  /**
   * Auto AdSense earnings estimate for a keyword + market.
   * Returns RPM, monthly/yearly at 10k / 50k / 100k pageviews.
   */
  function estimateAdsense(seed, gl) {
    const { category, mult } = detectAdsenseCategory(seed);
    const base = countryBaseRpm(gl);
    const rpm = Math.max(0.2, +(base * mult).toFixed(2));
    const tiers = [10000, 50000, 100000];
    const monthly = tiers.map((pv) => +(pv / 1000 * rpm).toFixed(2));
    const yearly = monthly.map((m) => +(m * 12).toFixed(2));
    return {
      category,
      mult,
      country: String(gl || 'us').toUpperCase(),
      baseRpm: base,
      rpm,
      tiers,
      monthly,
      yearly,
      // highlight mid tier (50k) for cards
      monthly50k: monthly[1],
      yearly50k: yearly[1],
      note: 'Rough estimate from niche + country RPM benchmarks. Not a guarantee — real AdSense varies by site quality, ad density, seasonality.',
    };
  }

  function renderAdsenseCard(est) {
    if (!est) return '';
    const rows = est.tiers.map((pv, i) => {
      const label = pv >= 1000 ? (pv / 1000) + 'k' : String(pv);
      return `<tr>
        <td>${label} PV/mo</td>
        <td><strong>${formatMoney(est.monthly[i])}</strong>/mo</td>
        <td><strong>${formatMoney(est.yearly[i])}</strong>/yr</td>
      </tr>`;
    }).join('');
    return `
      <div class="niche-section niche-adsense">
        <div class="niche-section-title">Rough AdSense earnings (estimate only)</div>
        <div class="niche-adsense-meta">
          <span class="niche-pill niche-pill-good">${String(est.category).replace(/</g, '&lt;')}</span>
          <span class="niche-pill">${est.country}</span>
          <span class="niche-pill">Est. RPM ~$${est.rpm}</span>
        </div>
        <div class="niche-adsense-hero">
          <div class="niche-adsense-big">${formatMoney(est.yearly50k)}<span>/year</span></div>
          <div class="niche-adsense-sub">at ~50,000 monthly pageviews · ${formatMoney(est.monthly50k)}/mo</div>
        </div>
        <table class="niche-table niche-adsense-table">
          <thead><tr><th>Traffic</th><th>Monthly</th><th>Yearly</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="niche-note" style="margin-top:8px">${est.note}</p>
      </div>`;
  }

  function adsensePrintBlock(est) {
    if (!est) return '';
    const rows = est.tiers.map((pv, i) => {
      const label = pv >= 1000 ? (pv / 1000) + 'k' : String(pv);
      return `<tr><td>${label} pageviews/mo</td><td>${formatMoney(est.monthly[i])}/mo</td><td>${formatMoney(est.yearly[i])}/yr</td></tr>`;
    }).join('');
    return `
<div class="adsense-box">
  <h2>Rough AdSense earnings (estimate only)</h2>
  <p class="meta">Category: <strong>${String(est.category).replace(/</g,'&lt;')}</strong> · Market: <strong>${est.country}</strong> · Est. RPM: <strong>$${est.rpm}</strong> · Not a guarantee — real earnings vary by site quality &amp; seasonality.</p>
  <div class="tiles">
    <div class="tile"><b>${formatMoney(est.yearly50k)}</b><span>Yearly @ 50k PV</span></div>
    <div class="tile"><b>${formatMoney(est.monthly50k)}</b><span>Monthly @ 50k PV</span></div>
    <div class="tile"><b>$${est.rpm}</b><span>Est. RPM</span></div>
  </div>
  <table><thead><tr><th>Traffic</th><th>Monthly</th><th>Yearly</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="foot">${est.note}</p>
</div>`;
  }

  function ringClass(verdict) {
    if (verdict === 'YES') return '';
    if (verdict === 'MAYBE') return 'maybe';
    if (verdict === 'NO') return 'no';
    return '';
  }

  function badgeClass(verdict) {
    if (verdict === 'YES') return 'niche-badge-yes';
    if (verdict === 'MAYBE') return 'niche-badge-maybe';
    if (verdict === 'NO') return 'niche-badge-no';
    return 'niche-badge-err';
  }


  function downloadText(filename, content, mime) {
    try {
      const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (_) {}
  }

  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportSingleCsv(payload) {
    if (!payload || !payload.competitors) return;
    const { seed, gl, hl, competitors, verdict } = payload;
    const lines = [
      ['keyword', 'country', 'verdict', 'score', 'low_dr', 'mid', 'high', 'homepages', 'type'].map(csvEscape).join(','),
      [seed, (gl || '').toUpperCase(), verdict && verdict.verdict, verdict && verdict.scoreNum,
        verdict && verdict.lowAuth, verdict && verdict.midAuth, verdict && verdict.highAuth,
        verdict && verdict.homepageCount, verdict && verdict.nicheTypeLabel].map(csvEscape).join(','),
      '',
      ['position', 'domain', 'url', 'dr', 'da', 'spam', 'age', 'homepage'].map(csvEscape).join(','),
    ];
    (competitors || []).forEach((c) => {
      lines.push([c.serpPosition, c.domain, c.url, c.dr, c.da, c.spam, c.ageLabel, c.isHomepage ? 'yes' : 'no'].map(csvEscape).join(','));
    });
    const safe = String(seed || 'niche').replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
    downloadText('rankseo-niche-' + safe + '-' + (gl || 'us') + '.csv', lines.join('\n'), 'text/csv;charset=utf-8');
  }


  /** Discover keywords only */
  function exportDiscoverKeywordsCsv(data) {
    const kws = (data && data.keywords) || [];
    const seed = (data && data.seed) || 'seed';
    const lines = [['keyword', 'hits', 'volume', 'volume_source', 'sources'].map(csvEscape).join(',')];
    kws.forEach((r) => {
      lines.push([
        r.keyword,
        r.hits || 1,
        r.volume != null ? r.volume : '',
        r.volumeSource || '',
        Array.isArray(r.sources) ? r.sources.join(' | ') : ''
      ].map(csvEscape).join(','));
    });
    const safe = String(seed).replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
    downloadText('rankseo-discover-keywords-' + safe + '.csv', lines.join('\n'), 'text/csv;charset=utf-8');
  }

  /** Batch competition scores only */
  function exportDiscoverBatchCsv(seed, results) {
    const lines = [[
      'keyword', 'ok', 'score', 'ease', 'volume', 'volume_source', 'weak_dr', 'error'
    ].map(csvEscape).join(',')];
    (results || []).forEach((r) => {
      lines.push([
        r.seed,
        r.ok ? 'yes' : 'no',
        r.ok ? (r.score != null ? r.score : '') : '',
        r.ok ? (r.label || r.verdict || '') : '',
        r.ok && r.volume != null ? r.volume : '',
        r.ok ? (r.volumeSource || '') : '',
        r.ok && r.weakCount != null ? r.weakCount : '',
        r.ok ? '' : (r.error || 'failed')
      ].map(csvEscape).join(','));
    });
    const safe = String(seed || 'batch').replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
    downloadText('rankseo-discover-scores-' + safe + '.csv', lines.join('\n'), 'text/csv;charset=utf-8');
  }

  /**
   * One file: discovered keywords + competition scores (if batch was run).
   * Sheet-style sections separated by blank lines.
   */
  function exportDiscoverAllInOne(data, batchResults) {
    const seed = (data && data.seed) || (batchResults && batchResults[0] && batchResults[0].seed) || 'seed';
    const lines = [];
    lines.push(['# ShahzaibSEO Discover export'].map(csvEscape).join(','));
    lines.push(['seed', seed].map(csvEscape).join(','));
    lines.push(['exported_at', new Date().toISOString()].map(csvEscape).join(','));
    lines.push('');
    lines.push(['## Keywords discovered'].map(csvEscape).join(','));
    lines.push(['keyword', 'hits', 'sources'].map(csvEscape).join(','));
    ((data && data.keywords) || []).forEach((r) => {
      lines.push([
        r.keyword,
        r.hits || 1,
        Array.isArray(r.sources) ? r.sources.join(' | ') : ''
      ].map(csvEscape).join(','));
    });
    if (batchResults && batchResults.length) {
      lines.push('');
      lines.push(['## Competition scores'].map(csvEscape).join(','));
      lines.push(['keyword', 'ok', 'score', 'verdict', 'volume', 'weak_dr', 'error'].map(csvEscape).join(','));
      batchResults.forEach((r) => {
        lines.push([
          r.seed,
          r.ok ? 'yes' : 'no',
          r.ok ? (r.score != null ? r.score : '') : '',
          r.ok ? (r.label || '') : '',
          r.ok && r.volume != null ? r.volume : '',
          r.ok && r.weakCount != null ? r.weakCount : '',
          r.ok ? '' : (r.error || 'failed')
        ].map(csvEscape).join(','));
      });
      // Detailed competitors for each successful check
      batchResults.filter((r) => r.ok && r.payload && r.payload.competitors).forEach((r) => {
        lines.push('');
        lines.push(['## SERP Top 10 — ' + r.seed].map(csvEscape).join(','));
        lines.push(['position', 'domain', 'url', 'dr', 'da', 'spam', 'age', 'homepage'].map(csvEscape).join(','));
        (r.payload.competitors || []).forEach((c) => {
          lines.push([
            c.serpPosition, c.domain, c.url, c.dr, c.da, c.spam, c.ageLabel,
            c.isHomepage ? 'yes' : 'no'
          ].map(csvEscape).join(','));
        });
      });
    }
    const safe = String(seed).replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
    downloadText('rankseo-discover-full-' + safe + '.csv', lines.join('\n'), 'text/csv;charset=utf-8');
  }


  function exportMultiCsv(seed, rows) {
    const lines = [
      ['keyword', 'rank', 'country', 'gl', 'verdict', 'score', 'volume', 'volume_source', 'low_dr', 'mid', 'high', 'homepages', 'young_under_2y', 'low_spam', 'ai_overview', 'error'].map(csvEscape).join(','),
    ];
    const sorted = sortMarketRows(rows);
    sorted.forEach((r, i) => {
      lines.push([
        seed, i + 1, shortCountry(r.gl, r.hl), r.gl, r.verdict || '', r.scoreNum,
        typeof r.volume === 'number' ? r.volume : '',
        r.volumeSource || '',
        r.lowAuth, r.midAuth, r.highAuth, r.homepageCount,
        r.lowAge, r.lowSpam,
        r.hasAiOverview === true ? 'yes' : r.hasAiOverview === false ? 'no' : '',
        r.error || ''
      ].map(csvEscape).join(','));
    });
    const safe = String(seed || 'niche').replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
    downloadText('rankseo-niche-multi-' + safe + '.csv', lines.join('\n'), 'text/csv;charset=utf-8');
  }

  /**
   * Open a print-friendly window without any inline <script> / onclick
   * (extension CSP blocks inline JS on about:blank). Wire buttons from parent.
   */
  function openPrintWindow(html) {
    const w = window.open('', '_blank');
    if (!w) {
      alert('Popup blocked. Allow popups for this extension, then try Print / PDF again.');
      return null;
    }
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (e) {
      try { w.close(); } catch (_) {}
      alert('Could not open print window: ' + (e && e.message ? e.message : String(e)));
      return null;
    }

    const wire = () => {
      try {
        const doc = w.document;
        if (!doc || !doc.body) return false;
        const doPrint = () => {
          try { w.focus(); } catch (_) {}
          try {
            w.print();
          } catch (_) {
            alert('Print blocked. Press Ctrl+P (Cmd+P on Mac) → Save as PDF.');
          }
        };
        const btn = doc.getElementById('btnPrint');
        if (btn && !btn._bound) {
          btn._bound = true;
          btn.addEventListener('click', doPrint);
        }
        const closeBtn = doc.getElementById('btnClose');
        if (closeBtn && !closeBtn._bound) {
          closeBtn._bound = true;
          closeBtn.addEventListener('click', () => {
            try { w.close(); } catch (_) {}
          });
        }
        // Auto print once (user can cancel). Delay so layout settles.
        if (!w._autoPrintScheduled) {
          w._autoPrintScheduled = true;
          setTimeout(doPrint, 700);
        }
        return true;
      } catch (_) {
        return false;
      }
    };

    // document.write is sync but DOM may need a tick in some Chromium builds
    if (!wire()) {
      setTimeout(wire, 50);
      setTimeout(wire, 200);
    }
    try { w.focus(); } catch (_) {}
    return w;
  }

  function openPrintReport(payload) {
    if (!payload || !payload.verdict) return;
    const { seed, gl, hl, competitors, verdict, hasAiOverview } = payload;
    const rows = (competitors || []).map((c) =>
      `<tr><td>${c.serpPosition || ''}</td><td>${(c.domain || '').replace(/</g,'&lt;')}</td>` +
      `<td>${c.dr != null ? c.dr : '—'}</td><td>${c.da != null ? c.da : '—'}</td>` +
      `<td>${c.spam != null ? c.spam + '%' : '—'}</td><td>${c.ageLabel || '—'}</td></tr>`
    ).join('');
    const reasons = (verdict.reasons || []).map((r) => `<li>${String(r).replace(/</g,'&lt;')}</li>`).join('');
    const ads = estimateAdsense(seed, gl || 'us');
    const genDate = new Date().toISOString().slice(0, 10);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ShahzaibSEO Niche — ${String(seed).replace(/</g,'')}</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px 48px;color:#0f172a;background:#fff}
h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:18px 0 8px} .meta{color:#64748b;font-size:13px;margin-bottom:14px;line-height:1.5}
.verdict{font-size:18px;font-weight:800;margin:12px 0 4px}
.tiles{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
.tile{border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;min-width:80px;text-align:center}
.tile b{display:block;font-size:18px} .tile span{font-size:10px;color:#94a3b8;text-transform:uppercase}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
th,td{border-bottom:1px solid #e2e8f0;padding:8px 6px;text-align:left}
th{font-size:11px;color:#64748b;background:#f8fafc}
.adsense-box{border:1px solid #c4b5fd;background:#f5f3ff;border-radius:12px;padding:14px 16px;margin:16px 0}
.legend{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin:12px 0;font-size:12px;line-height:1.55;color:#475569}
.legend strong{color:#0f172a}
.howto{background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin:12px 0;font-size:12.5px;line-height:1.55;color:#1e40af}
.print-bar{position:sticky;top:0;z-index:50;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin:0 0 20px;padding:12px 14px;background:linear-gradient(135deg,#4c1d95,#6d28d9);border-radius:14px;box-shadow:0 4px 14px rgba(109,40,217,.25);color:#fff}
.print-bar-text{font-size:13px;line-height:1.4;opacity:.95}
.print-bar-text strong{font-weight:700}
.print-bar-actions{display:flex;gap:8px;flex-wrap:wrap}
.btn-print{appearance:none;border:none;cursor:pointer;font:inherit;font-size:13px;font-weight:700;padding:10px 16px;border-radius:10px;background:#fff;color:#5b21b6;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.btn-print:hover{filter:brightness(1.05)}
.btn-ghost{appearance:none;border:1px solid rgba(255,255,255,.35);cursor:pointer;font:inherit;font-size:12px;font-weight:600;padding:9px 14px;border-radius:10px;background:transparent;color:#fff}
.btn-ghost:hover{background:rgba(255,255,255,.12)}
.brand{margin-top:28px;padding:18px 18px 16px;border-radius:16px;border:1px solid #e2e8f0;background:linear-gradient(180deg,#fafafa 0%,#f8fafc 100%)}
.brand-top{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px}
.brand-name{font-size:15px;font-weight:800;color:#0f172a;letter-spacing:-.02em}
.brand-by{font-size:12px;color:#64748b;margin-top:2px}
.brand-badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6d28d9;background:#ede9fe;padding:4px 10px;border-radius:999px}
.brand-links{margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 16px;font-size:12px;line-height:1.45}
.brand-links a{color:#4c1d95;text-decoration:none;font-weight:600}
.brand-links a:hover{text-decoration:underline}
.brand-links span{color:#94a3b8;font-weight:500;display:block;font-size:10px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:1px}
.brand-note{margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.5}
@media print{
  .noprint,.print-bar{display:none!important}
  body{padding:12px 0;max-width:100%}
  .brand{break-inside:avoid;border-color:#ddd;background:#fff}
  a{color:#0f172a!important;text-decoration:none}
}
</style></head><body>
<div class="print-bar noprint">
  <div class="print-bar-text"><strong>Ready to save</strong><br>Use Print → “Save as PDF” (Chrome) or your system PDF printer.</div>
  <div class="print-bar-actions">
    <button type="button" class="btn-print" id="btnPrint">Print / Save as PDF</button>
    <button type="button" class="btn-ghost" id="btnClose">Close</button>
  </div>
</div>
<h1>ShahzaibSEO · Is this niche easy?</h1>
<div class="meta">Keyword: <strong>${String(seed).replace(/</g,'&lt;')}</strong> · Country: <strong>${countryLabel(gl, hl)}</strong><br>
Based on Google Top 10 competition strength (not search volume).</div>
<div class="verdict">${verdict.verdict} — ${verdict.verdictLabel || ''} · Score ${verdict.scoreNum != null ? verdict.scoreNum : '—'}/100</div>
<div class="meta">${verdict.nicheTypeLabel || 'Info / blogging'} niche type</div>
<div class="tiles">
<div class="tile"><b>${verdict.lowAuth??0}</b><span>Weak sites</span></div>
<div class="tile"><b>${verdict.midAuth??0}</b><span>Medium</span></div>
<div class="tile"><b>${verdict.highAuth??0}</b><span>Strong</span></div>
<div class="tile"><b>${verdict.homepageCount??0}</b><span>Niche sites</span></div>
</div>
<div class="howto">
  <strong>Quick meaning for beginners</strong><br>
  <strong>Score 80–100</strong> = soft competition, good for new sites.<br>
  <strong>Weak sites</strong> = DR/DA under 20 — these are the ones you can realistically outrank.<br>
  <strong>Strong sites</strong> = DR/DA 50+ — hard to beat if you are starting out.<br>
  <strong>YES</strong> = promising · <strong>MAYBE</strong> = mixed · <strong>NO</strong> = hard SERP.
</div>
${adsensePrintBlock(ads)}
<h2>Why this score</h2>
<ul>${reasons}</ul>
<h2>Google Top 10 for this keyword</h2>
<div class="legend">
  <strong>DR / DA</strong> = domain authority (higher = stronger site). Under 20 = weak competitor.<br>
  <strong>Spam</strong> = spam score (lower is better). <strong>Age</strong> = how old the domain is.
</div>
<table><thead><tr><th>#</th><th>Site</th><th>DR</th><th>DA</th><th>Spam</th><th>Age</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="brand">
  <div class="brand-top">
    <div>
      <div class="brand-name">ShahzaibSEO</div>
      <div class="brand-by">by Mubashir Hassan</div>
    </div>
    <span class="brand-badge">100% free</span>
  </div>
  <div class="brand-links">
    <div><span>Website</span><a href="https://www.mubashirhassan.com" target="_blank" rel="noopener">mubashirhassan.com</a></div>
    <div><span>Extension</span><a href="https://www.mubashirhassan.com/rankseo.html" target="_blank" rel="noopener">rankseo.html</a></div>
    <div><span>WhatsApp</span><a href="https://wa.me/923222047786?text=Hi%20Mubashir%2C%20I%20found%20you%20via%20ShahzaibSEO%20extension." target="_blank" rel="noopener">+92 322 2047786</a></div>
    <div><span>Email</span><a href="mailto:hello@mubashirhassan.com">hello@mubashirhassan.com</a></div>
  </div>
  <div class="brand-note">Generated ${genDate} · No paid volume API · Competition-based analysis (not search volume).</div>
</div>
</body></html>`;
    openPrintWindow(html);
  }


  function buildSummary(verdict, hasAiOverview, volume) {
    if (!verdict) return '';
    const parts = [];
    if (verdict.lowAuth != null) parts.push(verdict.lowAuth + ' site(s) under DR/DA 20');
    if (verdict.homepageCount != null) parts.push(verdict.homepageCount + ' dedicated homepage(s)');
    if (verdict.nicheTypeLabel) parts.push(verdict.nicheTypeLabel);
    if (hasAiOverview === true) parts.push('AI Overview present');
    else if (hasAiOverview === false) parts.push('No AI Overview detected');
    if (typeof volume === 'number' && volume >= 0) {
      parts.push('volume ~' + (volume >= 1000 ? Math.round(volume / 1000) + 'K' : volume) + '/mo');
    } else {
      parts.push('free SERP analysis — not search volume');
    }
    return parts.join(' · ');
  }

  function renderSingleResult(host, payload) {
    if (!host || !payload) return;
    const { seed, gl, hl, near, competitors, verdict, hasAiOverview } = payload;
    if (!verdict) {
      host.innerHTML = '<p class="niche-err">No verdict — try again.</p>';
      return;
    }

    const color =
      verdict.verdict === 'YES' ? '#16a34a'
      : verdict.verdict === 'MAYBE' ? '#ca8a04'
      : verdict.verdict === 'WAIT' ? '#64748b'
      : '#dc2626';

    const rows = (competitors || []).map((c) => {
      const auth = typeof c.dr === 'number' ? c.dr : (typeof c.da === 'number' ? c.da : null);
      const weak = auth !== null && auth < 20;
      const home = c.isHomepage ? '<span class="niche-pill niche-pill-dedicated">Dedicated site</span>' : '';
      const weakPill = weak ? '<span class="niche-pill niche-pill-good">DR/DA &lt; 20</span>' : '';
      const title = (c.title || '').replace(/</g, '&lt;').slice(0, 80);
      return `<tr class="${weak ? 'niche-row-weak' : ''}">
        <td class="niche-pos">${c.serpPosition || '—'}</td>
        <td class="niche-dom">
          <a href="${c.url || '#'}" target="_blank" rel="noopener">${c.domain || '—'}</a>
          ${title ? `<div class="niche-title-line">${title}</div>` : ''}
          <div class="niche-pills">${home}${weakPill}</div>
        </td>
        <td class="niche-metric">${c.dr != null ? c.dr : '—'}</td>
        <td class="niche-metric">${c.da != null ? c.da : '—'}</td>
        <td class="niche-metric">${c.spam != null ? c.spam + '%' : '—'}</td>
        <td class="niche-metric">${c.ageLabel || '—'}</td>
      </tr>`;
    }).join('');

    const reasons = (verdict.reasons || []).map((r) =>
      `<li>${String(r).replace(/</g, '&lt;')}</li>`
    ).join('');

    const openUrl = 'https://www.google.com/search?q=' + encodeURIComponent(seed)
      + '&gl=' + encodeURIComponent(gl || 'us')
      + '&hl=' + encodeURIComponent(hl || 'en')
      + (near ? '&near=' + encodeURIComponent(near) : '');

    const seedSafe = String(seed || '').replace(/</g, '&lt;');
    const vol = payload.volume != null ? payload.volume : null;
    const volSrc = payload.volumeSource || '';
    const summary = buildSummary(verdict, hasAiOverview, vol);
    const aioLine = hasAiOverview === true
      ? '<div class="niche-aio niche-aio-yes">AI Overview · Yes — some clicks may skip organic results</div>'
      : hasAiOverview === false
        ? '<div class="niche-aio niche-aio-no">AI Overview · No</div>'
        : '';
    const adsEst = estimateAdsense(seed, gl || 'us');
    const adsCard = renderAdsenseCard(adsEst);
    const volMeta = (typeof vol === 'number' && vol >= 0)
      ? ' · volume ~' + (vol >= 1000 ? Math.round(vol / 1000) + 'K' : vol) + '/mo' + (volSrc ? ' (' + volSrc + ')' : '')
      : ' · competition-based (not volume)';

    host.innerHTML = `
      <div class="niche-query-meta">Query: <strong>${seedSafe}</strong> · ${(gl || 'us').toUpperCase()}${hl ? ' · ' + hl : ''}${volMeta}</div>
      <div class="niche-verdict" style="--nv-color:${color}">
        <div class="niche-verdict-top">
          <div>
            <div class="niche-verdict-head">
              <span class="niche-verdict-emoji">${verdict.scoreEmoji || ''}</span>
              <span class="niche-verdict-label">${verdict.verdict} — ${verdict.verdictLabel || ''}</span>
            </div>
            <div class="niche-verdict-sub">${(verdict.nicheTypeLabel || '')} · ${countryLabel(gl, hl)}</div>
          </div>
          <div class="niche-score-block">
            <div class="niche-score-num">${verdict.scoreNum != null ? verdict.scoreNum : '—'}</div>
            <div class="niche-score-max">/ 100</div>
          </div>
        </div>
        <div class="niche-score-meter" style="--p:${verdict.scoreNum || 0}"><i></i></div>
        <p class="niche-summary">${summary.replace(/</g, '&lt;')}</p>
        <div class="niche-tiles">
          <div class="niche-tile${(verdict.lowAuth ?? 0) > 0 ? ' is-good' : ''}"><div class="niche-tile-v">${verdict.lowAuth ?? 0}</div><div class="niche-tile-l">Weak DR/DA</div></div>
          <div class="niche-tile"><div class="niche-tile-v">${verdict.midAuth ?? 0}</div><div class="niche-tile-l">Medium</div></div>
          <div class="niche-tile"><div class="niche-tile-v">${verdict.highAuth ?? 0}</div><div class="niche-tile-l">Strong</div></div>
          <div class="niche-tile"><div class="niche-tile-v">${verdict.homepageCount ?? 0}</div><div class="niche-tile-l">Niche sites</div></div>
          <div class="niche-tile${(verdict.lowAge ?? 0) > 0 ? ' is-good' : ''}"><div class="niche-tile-v">${verdict.lowAge ?? 0}</div><div class="niche-tile-l">Young &lt;2y</div></div>
          <div class="niche-tile${(verdict.lowSpam ?? 0) > 0 ? ' is-good' : ''}"><div class="niche-tile-v">${verdict.lowSpam ?? 0}</div><div class="niche-tile-l">Low spam</div></div>
        </div>
        <p class="niche-note" style="margin:10px 0 0;font-size:11px;color:#94a3b8;line-height:1.45">Weak = DR/DA &lt;20 · Young = age under 2 years · Low spam = spam 0–5% · Strong = DR/DA 50+</p>
        ${aioLine}
      </div>
      ${adsCard}
      <div class="niche-section">
        <div class="niche-section-title">Why this score</div>
        <ul class="niche-reasons">${reasons || '<li>No details</li>'}</ul>
      </div>
      <div class="niche-section">
        <div class="niche-section-title">Google Top 10 · ${seedSafe} · ${(gl || 'us').toUpperCase()}</div>
        <p class="niche-note" style="margin-top:0;margin-bottom:8px">Green rows = weak competitors (DR or DA under 20) — realistic targets for a new site. “Dedicated site” = ranking on their homepage.</p>
        <table class="niche-table">
          <thead><tr><th>#</th><th>Site</th><th>DR</th><th>DA</th><th>Spam</th><th>Age</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No results</td></tr>'}</tbody>
        </table>
        <p class="niche-note">100% free · ShahzaibSEO. Search volume needs paid APIs — AdSense figures above are category/country estimates only.</p>
      </div>
      <div class="niche-actions">
        <a class="niche-btn niche-btn-secondary" href="${openUrl}" target="_blank" rel="noopener">Open this SERP</a>
        <button type="button" class="niche-btn niche-btn-secondary" id="nicheCopyBtn">Copy summary</button>
        <button type="button" class="niche-btn niche-btn-secondary" id="nicheCsvBtn">Export CSV</button>
        <button type="button" class="niche-btn niche-btn-secondary" id="nichePdfBtn">Download PDF</button>
      </div>
    `;

    const copyBtn = host.querySelector('#nicheCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const ads = estimateAdsense(seed, gl || 'us');
        const text = [
          `Niche: ${seed}`,
          `Country: ${countryLabel(gl, hl)}`,
          `${verdict.verdict} — ${verdict.verdictLabel} (${verdict.scoreNum}/100)`,
          `Low DR: ${verdict.lowAuth} · Mid: ${verdict.midAuth} · High: ${verdict.highAuth} · Homepages: ${verdict.homepageCount}`,
          (verdict.reasons || []).join('\n'),
          `AdSense est: ${ads.category} · ${ads.country} · RPM ~$${ads.rpm} · ~${formatMoney(ads.monthly50k)}/mo · ~${formatMoney(ads.yearly50k)}/yr @ 50k PV`,
          '— ShahzaibSEO Niche Check (free)',
        ].join('\n');
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy summary'; }, 1500);
        }).catch(() => {});
      });
    }
    const csvBtn = host.querySelector('#nicheCsvBtn');
    if (csvBtn) csvBtn.addEventListener('click', () => exportSingleCsv(payload));
    const pdfBtn = host.querySelector('#nichePdfBtn');
    if (pdfBtn) pdfBtn.addEventListener('click', () => downloadNicheSinglePdf(payload));
  }

  function downloadNicheMultiPdf(seed, rows) {
    if (typeof SorankPDF === 'undefined') {
      alert('PDF generator not loaded. Reload the extension and try again.');
      return;
    }
    try {
      const enriched = (rows || []).map((r) => ({
        ...r,
        countryLabel: shortCountry(r.gl, r.hl),
      }));
      const pdf = new SorankPDF();
      pdf.buildNicheMultiReport({
        seed,
        rows: enriched,
        date: new Date().toISOString().slice(0, 10),
      });
      const safe = String(seed || 'niche').replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
      pdf.download('ShahzaibSEO-Niche-Multi-' + safe + '.pdf');
    } catch (e) {
      alert('PDF failed: ' + (e && e.message ? e.message : String(e)));
    }
  }

  function downloadNicheSinglePdf(payload) {
    if (!payload || !payload.verdict) {
      alert('No niche result to export. Run a check first.');
      return;
    }
    if (typeof SorankPDF === 'undefined') {
      alert('PDF generator not loaded. Reload the extension and try again.');
      return;
    }
    try {
      const seed = payload.seed;
      const gl = payload.gl || 'us';
      const hl = payload.hl || 'en';
      const verdict = payload.verdict;
      let competitors = payload.competitors;
      if (!Array.isArray(competitors) || !competitors.length) {
        competitors = (payload.payload && payload.payload.competitors) || [];
      }
      if (!Array.isArray(competitors)) competitors = [];

      const volume = payload.volume != null ? payload.volume
        : (payload.payload && payload.payload.volume != null ? payload.payload.volume : null);
      const volumeSource = payload.volumeSource
        || (payload.payload && payload.payload.volumeSource) || null;
      const hasAiOverview = payload.hasAiOverview != null ? payload.hasAiOverview
        : (payload.payload && payload.payload.hasAiOverview);
      const adsense = estimateAdsense(seed, gl);

      const pdf = new SorankPDF();
      pdf.buildNicheSingleReport({
        seed,
        gl,
        countryLabel: countryLabel(gl, hl),
        verdict,
        competitors,
        volume: typeof volume === 'number' ? volume : null,
        volumeSource,
        hasAiOverview,
        adsense,
        date: new Date().toISOString().slice(0, 10),
      });
      const safe = String(seed || 'niche').replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
      pdf.download('ShahzaibSEO-Niche-' + safe + '-' + (gl || 'us') + '.pdf');
    } catch (e) {
      alert('PDF failed: ' + (e && e.message ? e.message : String(e)));
    }
  }

  function openMultiPrintReport(seed, rows) {
    const sorted = sortMarketRows(rows);
    const ok = sorted.filter((r) => !r.error);
    const best = ok[0];
    const highVol = ok.filter((r) => typeof r.volume === 'number').reduce((m, r) => {
      if (!m || r.volume > m.volume) return r;
      return m;
    }, null);
    const body = sorted.map((r, i) => {
      if (r.error) {
        return `<tr><td>${i + 1}</td><td>${shortCountry(r.gl, r.hl)}</td><td colspan="8" style="color:#b91c1c">${String(r.error).replace(/</g,'&lt;').slice(0,80)}</td></tr>`;
      }
      const isBest = best && r.gl === best.gl;
      return `<tr style="${isBest ? 'background:#ecfdf5' : ''}">
        <td>${i + 1}</td>
        <td><strong>${shortCountry(r.gl, r.hl)}</strong>${isBest ? ' ★' : ''}</td>
        <td>${r.verdict || '—'}</td>
        <td>${r.scoreNum != null ? r.scoreNum : '—'}</td>
        <td>${typeof r.volume === 'number' ? fmtVolShort(r.volume) : '—'}</td>
        <td>${r.lowAuth ?? '—'}</td>
        <td>${r.midAuth ?? '—'}</td>
        <td>${r.highAuth ?? '—'}</td>
        <td>${r.homepageCount ?? '—'}</td>
        <td>${r.hasAiOverview === true ? 'Yes' : r.hasAiOverview === false ? 'No' : '—'}</td>
      </tr>`;
    }).join('');
    const bestAds = best ? estimateAdsense(seed, best.gl || 'us') : null;
    const genDate = new Date().toISOString().slice(0, 10);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ShahzaibSEO · Easiest countries — ${String(seed).replace(/</g,'')}</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;max-width:860px;margin:0 auto;padding:24px 18px 48px;color:#0f172a;background:#fff}
h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:20px 0 8px;color:#0f172a}
.meta{color:#64748b;font-size:13px;margin-bottom:16px;line-height:1.5}
.hero{border:1px solid #bbf7d0;border-radius:14px;padding:16px 18px;margin-bottom:18px;background:#f0fdf4}
.hero strong{font-size:17px;color:#16a34a}
.tiles{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.tile{border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;min-width:72px;text-align:center;background:#fff}
.tile b{display:block;font-size:18px} .tile span{font-size:10px;color:#94a3b8;text-transform:uppercase}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
th,td{border-bottom:1px solid #e2e8f0;padding:8px 6px;text-align:left}
th{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.03em;background:#f8fafc}
.adsense-box{border:1px solid #c4b5fd;background:#f5f3ff;border-radius:12px;padding:14px 16px;margin:16px 0}
.legend{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin:14px 0;font-size:12px;line-height:1.55;color:#475569}
.legend strong{color:#0f172a}
.howto{background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin:14px 0;font-size:12.5px;line-height:1.55;color:#1e40af}
/* Action bar — screen only */
.print-bar{position:sticky;top:0;z-index:50;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin:0 0 20px;padding:12px 14px;background:linear-gradient(135deg,#4c1d95,#6d28d9);border-radius:14px;box-shadow:0 4px 14px rgba(109,40,217,.25);color:#fff}
.print-bar-text{font-size:13px;line-height:1.4;opacity:.95}
.print-bar-text strong{font-weight:700}
.print-bar-actions{display:flex;gap:8px;flex-wrap:wrap}
.btn-print{appearance:none;border:none;cursor:pointer;font:inherit;font-size:13px;font-weight:700;padding:10px 16px;border-radius:10px;background:#fff;color:#5b21b6;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.btn-print:hover{filter:brightness(1.05)}
.btn-print:active{transform:scale(.98)}
.btn-ghost{appearance:none;border:1px solid rgba(255,255,255,.35);cursor:pointer;font:inherit;font-size:12px;font-weight:600;padding:9px 14px;border-radius:10px;background:transparent;color:#fff}
.btn-ghost:hover{background:rgba(255,255,255,.12)}
/* Brand footer */
.brand{margin-top:28px;padding:18px 18px 16px;border-radius:16px;border:1px solid #e2e8f0;background:linear-gradient(180deg,#fafafa 0%,#f8fafc 100%)}
.brand-top{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px}
.brand-name{font-size:15px;font-weight:800;color:#0f172a;letter-spacing:-.02em}
.brand-by{font-size:12px;color:#64748b;margin-top:2px}
.brand-badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6d28d9;background:#ede9fe;padding:4px 10px;border-radius:999px}
.brand-links{margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 16px;font-size:12px;line-height:1.45}
.brand-links a{color:#4c1d95;text-decoration:none;font-weight:600}
.brand-links a:hover{text-decoration:underline}
.brand-links span{color:#94a3b8;font-weight:500;display:block;font-size:10px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:1px}
.brand-note{margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.5}
@media print{
  .noprint,.print-bar{display:none!important}
  body{padding:12px 0;max-width:100%}
  .brand{break-inside:avoid;border-color:#ddd;background:#fff}
  a{color:#0f172a!important;text-decoration:none}
}
</style></head><body>
<div class="print-bar noprint">
  <div class="print-bar-text"><strong>Ready to save</strong><br>Use Print → “Save as PDF” (Chrome) or your system PDF printer.</div>
  <div class="print-bar-actions">
    <button type="button" class="btn-print" id="btnPrint">Print / Save as PDF</button>
    <button type="button" class="btn-ghost" id="btnClose">Close</button>
  </div>
</div>
<h1>ShahzaibSEO · Which countries are easiest?</h1>
<div class="meta">Keyword: <strong>${String(seed).replace(/</g,'&lt;')}</strong><br>
Ranked by <strong>competition score</strong>, then <strong>country volume</strong>. Same keyword can be 550K in US and 16M+ in Morocco.</div>
${best ? `<div class="hero">
  <div style="font-size:12px;color:#64748b;margin-bottom:2px">Easiest country for this keyword</div>
  <strong>${shortCountry(best.gl, best.hl)} · ${best.verdict || ''} — ${best.verdictLabel || ''} · Score ${best.scoreNum != null ? best.scoreNum : '—'}/100${typeof best.volume === 'number' ? ' · Vol ~' + fmtVolShort(best.volume) + '/mo' : ''}</strong>
  ${highVol && best && (highVol.gl !== best.gl || highVol.hl !== best.hl) && typeof highVol.volume === 'number'
    ? `<div style="margin-top:8px;font-size:12px;color:#0f766e">Highest volume: <strong>${shortCountry(highVol.gl, highVol.hl)}</strong> ~${fmtVolShort(highVol.volume)}/mo (score ${highVol.scoreNum != null ? highVol.scoreNum : '—'})</div>`
    : ''}
  <div class="tiles">
    <div class="tile"><b>${best.lowAuth ?? 0}</b><span>Weak sites</span></div>
    <div class="tile"><b>${best.midAuth ?? 0}</b><span>Medium</span></div>
    <div class="tile"><b>${best.highAuth ?? 0}</b><span>Strong</span></div>
    <div class="tile"><b>${best.homepageCount ?? 0}</b><span>Niche sites</span></div>
    <div class="tile"><b>${typeof best.volume === 'number' ? fmtVolShort(best.volume) : '—'}</b><span>Volume</span></div>
  </div>
</div>` : ''}
<div class="howto">
  <strong>How to read this (beginner guide)</strong><br>
  1. <strong>Score</strong> 80–100 = soft competition.<br>
  2. <strong>Vol</strong> = monthly searches <em>in that country</em> (not global).<br>
  3. Best = softest competition; Highest volume may be a different market — choose traffic vs ease.<br>
  4. Click a country in the extension for the full Top 10 list.
</div>
${bestAds ? adsensePrintBlock(bestAds) : ''}
<h2>All countries compared</h2>
<div class="legend">
  <strong>Column meanings:</strong><br>
  <strong>Score</strong> = opportunity 0–100 ·
  <strong>Vol</strong> = monthly volume in that country ·
  <strong>Weak</strong> = DR/DA under 20 ·
  <strong>Strong</strong> = DR/DA 50+ ·
  <strong>Easy?</strong> YES / MAYBE / NO
</div>
<table>
<thead><tr><th>#</th><th>Country</th><th>Easy?</th><th>Score</th><th>Vol</th><th>Weak</th><th>Medium</th><th>Strong</th><th>Niche sites</th><th>AI box</th></tr></thead>
<tbody>${body}</tbody>
</table>
<div class="brand">
  <div class="brand-top">
    <div>
      <div class="brand-name">ShahzaibSEO</div>
      <div class="brand-by">by Mubashir Hassan</div>
    </div>
    <span class="brand-badge">Niche Multi</span>
  </div>
  <div class="brand-links">
    <div><span>Website</span><a href="https://www.mubashirhassan.com" target="_blank" rel="noopener">mubashirhassan.com</a></div>
    <div><span>Extension</span><a href="https://www.mubashirhassan.com/rankseo.html" target="_blank" rel="noopener">rankseo.html</a></div>
    <div><span>WhatsApp</span><a href="https://wa.me/923222047786?text=Hi%20Mubashir%2C%20I%20found%20you%20via%20ShahzaibSEO%20extension." target="_blank" rel="noopener">+92 322 2047786</a></div>
    <div><span>Email</span><a href="mailto:hello@mubashirhassan.com">hello@mubashirhassan.com</a></div>
  </div>
  <div class="brand-note">Generated ${genDate} · Volume via Keywords Everywhere when key is enabled · Click a country row for full Top 10.</div>
</div>
</body></html>`;
    openPrintWindow(html);
  }

  /** Rank markets: Score first; ties → more Weak → more Young → fewer Strong. AI ignored (unstable). */
  function fmtVolShort(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 10e6 ? 1 : 2).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n));
  }

  function sortMarketRows(rows) {
    return [...rows].sort((a, b) => {
      if (a.error && !b.error) return 1;
      if (!a.error && b.error) return -1;
      if (a.error && b.error) return 0;
      // Primary: competition opportunity score
      const sa = a.scoreNum || 0;
      const sb = b.scoreNum || 0;
      if (sb !== sa) return sb - sa;
      // Tie-break: higher search volume first (country-specific KE volume)
      const va = typeof a.volume === 'number' ? a.volume : -1;
      const vb = typeof b.volume === 'number' ? b.volume : -1;
      if (vb !== va) return vb - va;
      const weakA = a.lowAuth ?? 0;
      const weakB = b.lowAuth ?? 0;
      if (weakB !== weakA) return weakB - weakA;
      const youngA = a.lowAge ?? 0;
      const youngB = b.lowAge ?? 0;
      if (youngB !== youngA) return youngB - youngA;
      const strongA = a.highAuth ?? 0;
      const strongB = b.highAuth ?? 0;
      if (strongA !== strongB) return strongA - strongB;
      return 0;
    });
  }

  /** Plain-English reason why this row is #1 Best (for beginners) */
  function explainBestPick(best, allOk) {
    if (!best) return '';
    const parts = [];
    parts.push('Highest opportunity score (' + (best.scoreNum != null ? best.scoreNum : '—') + '/100)');
    if (typeof best.volume === 'number' && best.volume >= 0) {
      parts.push('volume ~' + fmtVolShort(best.volume) + '/mo in this country');
    }
    if (best.lowAuth != null) parts.push(best.lowAuth + ' weak competitor(s) in Top 10');
    if (best.lowAge != null) parts.push(best.lowAge + ' young domain(s) under 2 years');
    if (best.highAuth != null && best.highAuth === 0) parts.push('no strong (DR/DA 50+) sites');
    const sameScore = (allOk || []).filter((r) => (r.scoreNum || 0) === (best.scoreNum || 0));
    if (sameScore.length > 1) {
      parts.push(sameScore.length + ' tied on score — Best = higher volume, then most Weak / Young');
    }
    // Call out another market with much higher volume
    const withVol = (allOk || []).filter((r) => typeof r.volume === 'number' && r.volume > 0);
    if (withVol.length && typeof best.volume === 'number') {
      const maxVol = withVol.reduce((m, r) => (r.volume > m.volume ? r : m), withVol[0]);
      if (maxVol.volume > best.volume * 1.5 && (maxVol.gl !== best.gl || maxVol.hl !== best.hl)) {
        parts.push('Note: ' + shortCountry(maxVol.gl, maxVol.hl) + ' has higher volume (~' + fmtVolShort(maxVol.volume) + '/mo) — softer competition won the rank');
      }
    }
    return parts.join(' · ');
  }

  function renderMultiResult(host, seed, rows) {
    if (!host) return;
    const sorted = sortMarketRows(rows);
    const ok = sorted.filter((r) => !r.error);
    const best = ok[0];
    const seedSafe = String(seed || '').replace(/</g, '&lt;');

    const highVol = ok.filter((r) => typeof r.volume === 'number').reduce((m, r) => {
      if (!m || r.volume > m.volume) return r;
      return m;
    }, null);

    const body = sorted.map((r, i) => {
      if (r.error) {
        return `<tr class="niche-multi-err">
          <td>${i + 1}</td>
          <td>${shortCountry(r.gl, r.hl)}</td>
          <td colspan="10"><span class="niche-badge niche-badge-err">Failed</span> ${String(r.error).replace(/</g, '&lt;').slice(0, 55)}</td>
        </tr>`;
      }
      const isBest = best && r.gl === best.gl && r.hl === best.hl;
      const isTop = !r.error && (r.scoreNum || 0) >= 90;
      const isHighVol = highVol && r.gl === highVol.gl && r.hl === highVol.hl && typeof r.volume === 'number' && r.volume > 0;
      const rowClass = isBest ? 'best' : (isTop ? 'top-tier' : '');
      const v = r.verdict || '—';
      const volCell = typeof r.volume === 'number'
        ? `<strong title="${r.volumeSource || 'volume'}">${fmtVolShort(r.volume)}</strong>`
        : '—';
      return `<tr class="${rowClass}" data-gl="${r.gl}" data-hl="${r.hl}">
        <td class="niche-pos">${i + 1}</td>
        <td>
          <strong>${shortCountry(r.gl, r.hl)}</strong>
          ${isBest ? '<span class="niche-pill niche-pill-good">Best</span>' : (isTop ? '<span class="niche-pill niche-pill-soft">Top</span>' : '')}
          ${isHighVol && !isBest ? '<span class="niche-pill niche-pill-soft" title="Highest search volume among scanned markets">High vol</span>' : ''}
          ${r.nicheTypeLabel ? `<div class="niche-title-line">${String(r.nicheTypeLabel).replace(/</g,'&lt;')}</div>` : ''}
        </td>
        <td><span class="niche-badge ${badgeClass(v)}">${v}</span></td>
        <td class="niche-metric"><strong>${r.scoreNum != null ? r.scoreNum : '—'}</strong></td>
        <td class="niche-metric" style="color:${typeof r.volume === 'number' && r.volume > 0 ? '#0d9488' : 'inherit'}">${volCell}</td>
        <td class="niche-metric">${r.lowAuth ?? '—'}</td>
        <td class="niche-metric">${r.midAuth ?? '—'}</td>
        <td class="niche-metric">${r.highAuth ?? '—'}</td>
        <td class="niche-metric">${r.homepageCount ?? '—'}</td>
        <td class="niche-metric">${r.lowAge ?? '—'}</td>
        <td class="niche-metric">${r.lowSpam ?? '—'}</td>
        <td class="niche-metric">${r.hasAiOverview === true ? 'Yes' : r.hasAiOverview === false ? 'No' : '—'}</td>
      </tr>`;
    }).join('');

    const bestAds = best ? estimateAdsense(seed, best.gl || 'us') : null;
    const bestWhy = explainBestPick(best, ok);
    const bestVolLine = typeof best?.volume === 'number'
      ? ' · vol ~' + fmtVolShort(best.volume) + '/mo'
      : '';
    const highVolNote = highVol && best && (highVol.gl !== best.gl || highVol.hl !== best.hl) && typeof highVol.volume === 'number'
      ? `<p class="niche-note" style="margin:8px 0 0;font-size:11px;color:#0f766e;line-height:1.45;background:#f0fdfa;border-radius:8px;padding:8px 10px"><strong>Highest volume:</strong> ${shortCountry(highVol.gl, highVol.hl)} ~${fmtVolShort(highVol.volume)}/mo (score ${highVol.scoreNum != null ? highVol.scoreNum : '—'}/100) — compare with Best if you want traffic over softest competition.</p>`
      : '';
    const bestCard = best ? `
      <div class="niche-verdict niche-multi-hero" style="--nv-color:#16a34a">
        <div class="niche-verdict-top">
          <div>
            <div class="niche-verdict-head">
              <span class="niche-verdict-label">Easiest country · ${shortCountry(best.gl, best.hl)}</span>
            </div>
            <div class="niche-verdict-sub">${best.verdict || ''} — ${best.verdictLabel || ''} · ${seedSafe}${bestVolLine}</div>
          </div>
          <div class="niche-score-block">
            <div class="niche-score-num">${best.scoreNum != null ? best.scoreNum : '—'}</div>
            <div class="niche-score-max">/ 100</div>
          </div>
        </div>
        <div class="niche-score-meter" style="--p:${best.scoreNum || 0}"><i></i></div>
        <p class="niche-summary">${best.lowAuth ?? 0} weak · ${best.lowAge ?? 0} young (&lt;2y) · ${best.lowSpam ?? 0} low-spam · ${best.homepageCount ?? 0} niche sites${typeof best.volume === 'number' ? ' · volume ~' + fmtVolShort(best.volume) + '/mo' : ''}</p>
        <p class="niche-note" style="margin:8px 0 0;font-size:11px;color:#166534;line-height:1.45;background:#ecfdf5;border-radius:8px;padding:8px 10px"><strong>Why this pick?</strong> ${bestWhy.replace(/</g, '&lt;')}</p>
        ${highVolNote}
        <div class="niche-tiles" style="grid-template-columns:repeat(6,1fr)">
          <div class="niche-tile${(best.lowAuth ?? 0) > 0 ? ' is-good' : ''}"><div class="niche-tile-v">${best.lowAuth ?? 0}</div><div class="niche-tile-l">Weak DR/DA</div></div>
          <div class="niche-tile"><div class="niche-tile-v">${best.midAuth ?? 0}</div><div class="niche-tile-l">Medium</div></div>
          <div class="niche-tile"><div class="niche-tile-v">${best.highAuth ?? 0}</div><div class="niche-tile-l">Strong</div></div>
          <div class="niche-tile"><div class="niche-tile-v">${best.homepageCount ?? 0}</div><div class="niche-tile-l">Niche sites</div></div>
          <div class="niche-tile${(best.lowAge ?? 0) > 0 ? ' is-good' : ''}"><div class="niche-tile-v">${best.lowAge ?? 0}</div><div class="niche-tile-l">Young &lt;2y</div></div>
          <div class="niche-tile${(best.lowSpam ?? 0) > 0 ? ' is-good' : ''}"><div class="niche-tile-v">${best.lowSpam ?? 0}</div><div class="niche-tile-l">Low spam</div></div>
        </div>
      </div>
      ${renderAdsenseCard(bestAds)}` : '';

    host.innerHTML = `
      <div class="niche-query-meta">Multi-country check · <strong>${seedSafe}</strong> · ${ok.length}/${sorted.length} markets · ranked by score, then volume</div>
      ${bestCard}
      <div class="niche-section">
        <div class="niche-section-title">Which countries are easiest?</div>
        <p class="niche-note" style="margin-top:0;margin-bottom:10px"><strong>Best</strong> = highest Score (soft competition), ties broken by <strong>country volume</strong>. <strong>High vol</strong> badge = most searches among scanned markets. Volume is per-country (KE) — US can be 550K while MA is 16M for the same keyword. Click a row for full Top 10.</p>
        <div class="niche-legend" style="display:flex;flex-wrap:wrap;gap:8px 14px;font-size:11px;color:#64748b;margin-bottom:10px;padding:10px 12px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;line-height:1.45">
          <span><strong>Best</strong> = #1 Score → then volume</span>
          <span><strong>Vol</strong> = monthly searches in that country</span>
          <span><strong>Top</strong> = Score 90+</span>
          <span><strong>Weak</strong> = DR/DA &lt;20</span>
          <span><strong>Young</strong> = age under 2y</span>
          <span><strong>AI</strong> = info only</span>
        </div>
        <div class="niche-table-scroll">
          <table class="niche-multi-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Country</th>
                <th>Easy?</th>
                <th title="Opportunity score 0–100">Score</th>
                <th title="Monthly search volume in this country (Keywords Everywhere)">Vol</th>
                <th title="Sites with DR/DA under 20">Weak</th>
                <th title="Sites with DR/DA 20–50">Med</th>
                <th title="Sites with DR/DA 50+">Strong</th>
                <th title="Dedicated niche sites on homepage">Niche</th>
                <th title="Domains younger than 2 years">Young</th>
                <th title="Sites with spam score 0–5%">Low spam</th>
                <th title="Google AI Overview present?">AI</th>
              </tr>
            </thead>
            <tbody>${body || '<tr><td colspan="12">No data yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="niche-actions">
        <button type="button" class="niche-btn niche-btn-secondary" id="nicheVolMultiBtn">Load volumes</button>
        <button type="button" class="niche-btn niche-btn-secondary" id="nicheCopyMultiBtn">Copy comparison</button>
        <button type="button" class="niche-btn niche-btn-secondary" id="nicheCsvMultiBtn">Export CSV</button>
        <button type="button" class="niche-btn niche-btn-secondary" id="nichePdfMultiBtn">Download PDF</button>
      </div>
      <div id="nicheMultiDetail"></div>
    `;

    const statusEl = document.getElementById('nicheStatus');
    const volBtn = host.querySelector('#nicheVolMultiBtn');
    if (volBtn) {
      const missing = (rows || []).filter((r) => !r.error && !(typeof r.volume === 'number' && r.volume >= 0)).length;
      if (!missing) {
        volBtn.textContent = 'Volumes loaded';
        volBtn.disabled = true;
      } else {
        volBtn.textContent = 'Load volumes (' + missing + ')';
        volBtn.addEventListener('click', () => {
          volBtn.disabled = true;
          volBtn.textContent = 'Loading…';
          void enrichMultiRowsWithVolume(seed, rows, host, statusEl).then(() => {
            volBtn.textContent = 'Volumes loaded';
          });
        });
        // Auto-fetch only if not already stable / fetching (poll must not restart this)
        if (!multiVolFetching && !multiUiStable && missing > 0) {
          multiVolFetching = true;
          volBtn.disabled = true;
          volBtn.textContent = 'Loading volumes…';
          void enrichMultiRowsWithVolume(seed, rows, host, statusEl).finally(() => {
            multiVolFetching = false;
          });
        }
      }
    }

    const csvMulti = host.querySelector('#nicheCsvMultiBtn');
    if (csvMulti) csvMulti.addEventListener('click', () => exportMultiCsv(seed, rows));

    const pdfMulti = host.querySelector('#nichePdfMultiBtn');
    if (pdfMulti) pdfMulti.addEventListener('click', () => downloadNicheMultiPdf(seed, rows));

    const copyBtn = host.querySelector('#nicheCopyMultiBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const lines = [
          `Multi niche: ${seed}`,
          'Ranked by competition score, then country volume',
          best ? `Best: ${shortCountry(best.gl, best.hl)} · ${best.verdict} · ${best.scoreNum}/100 · vol ${fmtVolShort(best.volume)}` : '',
          highVol && best && (highVol.gl !== best.gl || highVol.hl !== best.hl)
            ? `Highest volume: ${shortCountry(highVol.gl, highVol.hl)} · ${fmtVolShort(highVol.volume)}/mo · score ${highVol.scoreNum}/100`
            : '',
          ...sorted.map((r, i) => r.error
            ? `${i + 1}. ${shortCountry(r.gl, r.hl)} — FAIL ${r.error}`
            : `${i + 1}. ${shortCountry(r.gl, r.hl)} · ${r.verdict} · ${r.scoreNum}/100 · vol ${fmtVolShort(r.volume)} · Low ${r.lowAuth} Mid ${r.midAuth} High ${r.highAuth}`),
          '— ShahzaibSEO Niche Multi',
        ].filter(Boolean);
        navigator.clipboard.writeText(lines.join('\n')).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy comparison'; }, 1500);
        }).catch(() => {});
      });
    }

    host.querySelectorAll('.niche-multi-table tr[data-gl]').forEach((tr) => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => {
        const gl = tr.getAttribute('data-gl');
        const hl = tr.getAttribute('data-hl');
        const row = sorted.find((x) => x.gl === gl && x.hl === hl && !x.error);
        const detail = host.querySelector('#nicheMultiDetail');
        if (row && row.payload && detail) {
          detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          renderSingleResult(detail, row.payload);
        }
      });
    });
  }

  async function analyzeCountry(seed, gl, hl, near, onProgress, token) {
    const q = String(seed || '').trim();
    if (!q) throw new Error('Empty keyword');

    const serp = await fetchSerpPage(q, gl, hl, near);
    if (token != null && token !== runToken) throw new Error('__stale__');
    if (!serp || !serp.ok) {
      throw new Error((serp && serp.error) || 'SERP fetch failed');
    }
    const list = Array.isArray(serp.results) ? serp.results : [];
    if (!list.length) throw new Error('No organic results (captcha or empty SERP)');

    const withDomain = list.filter((r) => r && r.domain);
    if (!withDomain.length) throw new Error('SERP returned no domains');

    const hasAiOverview = typeof serp.hasAiOverview === 'boolean' ? serp.hasAiOverview : null;

    const competitors = await enrichCompetitors(list, onProgress);
    if (token != null && token !== runToken) throw new Error('__stale__');
    if (typeof RSNiche === 'undefined' || !RSNiche.computeOpportunity) {
      throw new Error('Niche engine not loaded');
    }

    // Volume via KW_OVERVIEW (KE key when Niche/SERP volume enabled → free fallbacks)
    let volume = null;
    let volumeConfirmed = false;
    let volumeSource = null;
    try {
      const fetchVol = () => sendMsg({
        action: 'KW_OVERVIEW',
        query: q,
        country: gl || 'us',
        gl: gl || 'us'
      });
      let volRes = await fetchVol();
      // Retry once if background lock returned busy (parallel KW_OVERVIEW)
      if (volRes && volRes.busy) {
        await new Promise((r) => setTimeout(r, 1200));
        volRes = await fetchVol();
      }
      const rawVol = volRes && (volRes.volume != null ? volRes.volume : volRes.vol);
      const n = typeof rawVol === 'number' ? rawVol : parseInt(rawVol, 10);
      if (volRes && volRes.ok && Number.isFinite(n) && n >= 0) {
        volume = n;
        volumeConfirmed = volRes.estimated !== true;
        volumeSource = volRes.source || 'Keywords Everywhere';
      }
    } catch (_) { /* stay competition-only */ }

    const verdict = RSNiche.computeOpportunity({
      seed: q,
      competitors,
      volume,
      volumeConfirmed,
      hasAiOverview,
    });
    return {
      gl, hl, near: near || '',
      seed: q,
      competitors,
      verdict,
      scoreNum: verdict.scoreNum,
      lowAuth: verdict.lowAuth,
      midAuth: verdict.midAuth,
      highAuth: verdict.highAuth,
      homepageCount: verdict.homepageCount,
      lowAge: verdict.lowAge,
      lowSpam: verdict.lowSpam,
      verdictLabel: verdict.verdict,
      hasAiOverview,
      volume,
      volumeConfirmed,
      volumeSource,
      payload: {
        seed: q, gl, hl, near: near || '', competitors, verdict, hasAiOverview,
        volume, volumeConfirmed, volumeSource
      },
    };
  }


  let pollTimer = null;

  function setRunningUi(running) {
    const btn = document.getElementById('nicheRunBtn');
    const stopBtn = document.getElementById('nicheStopBtn');
    if (btn) {
      btn.disabled = !!running;
      if (!running) {
        btn.textContent = currentMode === 'multi' ? 'Find easiest market' : (currentMode === 'discover' ? 'Discover keywords (free)' : 'Check niche (free)');
      }
    }
    if (stopBtn) {
      stopBtn.style.display = running ? 'block' : 'none';
      stopBtn.disabled = !running;
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /**
   * Same volume path as SERP Keyword Overview / VOL pill.
   */
  async function fetchVolumeOnce(query, gl) {
    const country = gl || 'us';
    const attempt = () => sendMsg({
      action: 'KW_OVERVIEW',
      query: query,
      country: country,
      gl: country
    });
    let volRes = await attempt();
    // Up to 3 tries if background lock returns busy
    for (let t = 0; t < 3 && volRes && volRes.busy; t++) {
      await new Promise((r) => setTimeout(r, 800 + t * 400));
      volRes = await attempt();
    }
    const rawVol = volRes && (volRes.volume != null ? volRes.volume : volRes.vol);
    const n = typeof rawVol === 'number' ? rawVol : parseInt(rawVol, 10);
    if (volRes && volRes.ok && Number.isFinite(n) && n >= 0) {
      return {
        volume: n,
        volumeConfirmed: volRes.estimated !== true,
        volumeSource: volRes.source || 'Keywords Everywhere'
      };
    }
    return null;
  }

  async function enrichPayloadWithVolume(payload, host, statusEl) {
    if (!payload || !host) return payload;
    if (typeof payload.volume === 'number' && payload.volume >= 0) return payload;
    const q = String(payload.seed || '').trim();
    if (!q) return payload;
    const gl = payload.gl || 'us';
    try {
      if (statusEl) statusEl.textContent = 'Fetching search volume…';
      const info = await fetchVolumeOnce(q, gl);
      if (info) {
        payload.volume = info.volume;
        payload.volumeConfirmed = info.volumeConfirmed;
        payload.volumeSource = info.volumeSource;
        lastPayload = payload;
        renderSingleResult(host, payload);
        if (statusEl) {
          const vLabel = info.volume >= 1000 ? Math.round(info.volume / 1000) + 'K' : String(info.volume);
          statusEl.textContent = 'Done · “' + q + '” · ' + String(gl).toUpperCase() + ' · vol ' + vLabel;
        }
      } else if (statusEl) {
        statusEl.textContent = 'Done · “' + q + '” · ' + String(gl).toUpperCase() + ' · volume unavailable';
      }
    } catch (_) {
      if (statusEl) statusEl.textContent = 'Done · volume unavailable';
    }
    return payload;
  }

  /** Merge volume fields from enriched cache into job rows (poll must not wipe). */
  function mergeMultiVolumes(seed, rows) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    if (!lastMultiRows || lastMultiSeed !== String(seed || '')) return rows;
    const byKey = new Map();
    lastMultiRows.forEach((r) => {
      if (r && r.gl) byKey.set(String(r.gl) + '|' + String(r.hl || ''), r);
    });
    rows.forEach((r) => {
      if (!r || r.error) return;
      if (typeof r.volume === 'number' && r.volume >= 0) return;
      const prev = byKey.get(String(r.gl) + '|' + String(r.hl || ''));
      if (prev && typeof prev.volume === 'number') {
        r.volume = prev.volume;
        r.volumeConfirmed = prev.volumeConfirmed;
        r.volumeSource = prev.volumeSource;
        if (r.payload) {
          r.payload.volume = prev.volume;
          r.payload.volumeConfirmed = prev.volumeConfirmed;
          r.payload.volumeSource = prev.volumeSource;
        }
      }
    });
    return rows;
  }

  /** Fill missing per-country volume on multi results (SERP KW_OVERVIEW path). */
  async function enrichMultiRowsWithVolume(seed, rows, host, statusEl) {
    if (!Array.isArray(rows) || !rows.length || !host) return rows;
    const q = String(seed || '').trim();
    if (!q) return rows;
    const need = rows.filter((r) => !r.error && !(typeof r.volume === 'number' && r.volume >= 0));
    if (!need.length) {
      lastMultiRows = rows;
      lastMultiSeed = q;
      multiUiStable = true;
      return rows;
    }
    let done = 0;
    for (const r of need) {
      if (statusEl) {
        statusEl.textContent = 'Fetching volume ' + (done + 1) + '/' + need.length + ' · ' + String(r.gl || '').toUpperCase();
      }
      try {
        const info = await fetchVolumeOnce(q, r.gl || 'us');
        if (info) {
          r.volume = info.volume;
          r.volumeConfirmed = info.volumeConfirmed;
          r.volumeSource = info.volumeSource;
          if (r.payload) {
            r.payload.volume = info.volume;
            r.payload.volumeConfirmed = info.volumeConfirmed;
            r.payload.volumeSource = info.volumeSource;
          }
        }
      } catch (_) { /* next */ }
      done++;
      await new Promise((res) => setTimeout(res, 400));
    }
    lastMultiRows = rows;
    lastMultiSeed = q;
    multiUiStable = true;
    multiVolFetching = false;
    renderMultiResult(host, q, rows);
    if (statusEl) {
      const withVol = rows.filter((r) => !r.error && typeof r.volume === 'number').length;
      statusEl.textContent = 'Done · ' + withVol + '/' + rows.filter((r) => !r.error).length + ' markets have volume';
    }
    return rows;
  }

  function applyJobToUi(job, opts) {
    if (!job) return;
    const status = document.getElementById('nicheStatus');
    const result = document.getElementById('nicheResult');
    const kwEl = document.getElementById('nicheKeyword');

    if (job.seed && kwEl && (!kwEl.value || opts && opts.forceSeed)) {
      kwEl.value = job.seed;
    }
    if (job.mode === 'multi' || job.mode === 'single') {
      setMode(job.mode);
    }
    if (status && job.message) status.textContent = job.message;
    if (typeof job.progress === 'number') setProgress(job.progress);

    if (job.status === 'running') {
      setRunningUi(true);
      multiUiStable = false;
      if (job.mode === 'multi') {
        // While volume auto-fetch runs, do not wipe the table with empty-vol rows
        if (multiVolFetching) return;
        if (Array.isArray(job.multiRows) && job.multiRows.length && result) {
          const rows = mergeMultiVolumes(job.seed || '', job.multiRows);
          renderMultiResult(result, job.seed || '', rows);
        } else if (result && !result.querySelector('.niche-multi-table') && !result.querySelector('.niche-verdict')) {
          result.innerHTML = '<div class="niche-empty"><strong>Multi-scan running in background…</strong>Popup close safe. Re-open to watch progress or stop.<br><span style="opacity:.8;font-size:12px">' +
            String(job.message || 'Scanning markets…').replace(/</g, '&lt;') + '</span></div>';
        }
      } else if (job.result && result) {
        lastPayload = job.result;
        renderSingleResult(result, job.result);
      } else if (result && !result.querySelector('.niche-verdict')) {
        result.innerHTML = '<div class="niche-empty"><strong>Running in background…</strong>You can close this popup — check continues. Re-open Niche tab to see progress.<br><span style="opacity:.8;font-size:12px">' +
          String(job.message || 'Working…').replace(/</g, '&lt;') + '</span></div>';
      }
      return;
    }

    if (job.status === 'done') {
      setRunningUi(false);
      setProgress(100);
      if (job.mode === 'multi') {
        const seed = job.seed || '';
        // Already showed final table with volumes — poll must not re-render / re-fetch
        if (multiUiStable && lastMultiSeed === seed && lastMultiRows) {
          if (status && !String(status.textContent || '').includes('volume')) {
            status.textContent = job.message || 'Done';
          }
          return;
        }
        if (multiVolFetching) return;
        const rows = mergeMultiVolumes(seed, job.multiRows || []);
        const missing = rows.filter((r) => !r.error && !(typeof r.volume === 'number' && r.volume >= 0)).length;
        renderMultiResult(result, seed, rows);
        if (status) status.textContent = job.message || 'Done';
        if (missing > 0) {
          multiVolFetching = true;
          void (async () => {
            await enrichMultiRowsWithVolume(seed, rows, result, status);
            job.multiRows = rows;
            lastMultiRows = rows;
            lastMultiSeed = seed;
            multiUiStable = true;
            multiVolFetching = false;
            void persistJobToHistory(job);
          })();
        } else {
          lastMultiRows = rows;
          lastMultiSeed = seed;
          multiUiStable = true;
          void persistJobToHistory(job);
        }
      } else if (job.result) {
        lastPayload = job.result;
        renderSingleResult(result, job.result);
        if (status) status.textContent = job.message || 'Done';
        // Same path as SERP: if job has no volume, fetch via KW_OVERVIEW (KE) and refresh UI
        void enrichPayloadWithVolume(job.result, result, status);
        void persistJobToHistory(job);
      } else {
        if (status) status.textContent = job.message || 'Done';
        void persistJobToHistory(job);
      }
      return;
    }

    if (job.status === 'stopped') {
      setRunningUi(false);
      setProgress(typeof job.progress === 'number' ? job.progress : 0);
      if (status) status.textContent = job.message || 'Stopped';
      if (job.mode === 'multi' && job.multiRows && job.multiRows.length) {
        renderMultiResult(result, job.seed || '', job.multiRows);
      } else if (job.result && result) {
        lastPayload = job.result;
        renderSingleResult(result, job.result);
      } else if (result) {
        result.innerHTML = '<div class="niche-empty"><strong>Stopped</strong>You can start again anytime. Progress was kept in the background until stop.</div>';
      }
      void persistJobToHistory(job);
      return;
    }

    if (job.status === 'error') {
      setRunningUi(false);
      setProgress(0);
      if (status) status.textContent = '';
      if (result) {
        const msg = String(job.error || job.message || 'Error').replace(/</g, '&lt;');
        result.innerHTML = '<p class="niche-err">' + msg + '</p>'
          + '<p class="niche-note">Try again, switch country, or open SERP manually.</p>';
      }
    }
  }

  async function readJobFromStorage() {
    try {
      const local = await new Promise((resolve) => {
        try { chrome.storage.local.get('rs_niche_job', (r) => resolve(r || {})); }
        catch (_) { resolve({}); }
      });
      if (local && local.rs_niche_job) return local.rs_niche_job;
    } catch (_) {}
    try {
      const sess = await new Promise((resolve) => {
        try { chrome.storage.session.get('rs_niche_job', (r) => resolve(r || {})); }
        catch (_) { resolve({}); }
      });
      if (sess && sess.rs_niche_job) return sess.rs_niche_job;
    } catch (_) {}
    return null;
  }

  async function fetchJobStatus() {
    let res = null;
    try {
      res = await sendMsg({ action: 'NICHE_JOB_STATUS' });
    } catch (_) {}
    // busy lock / empty response → read storage so reopen always works
    if (!res || res.busy || (!res.job && !res.running)) {
      const stored = await readJobFromStorage();
      if (stored) {
        return { ok: true, job: stored, running: stored.status === 'running', fromStorage: true };
      }
    }
    // message ok but job null while storage has data
    if (res && !res.job) {
      const stored = await readJobFromStorage();
      if (stored) return { ok: true, job: stored, running: !!(res.running || stored.status === 'running'), fromStorage: true };
    }
    return res || { ok: true, job: null, running: false };
  }

  async function pollJob() {
    const res = await fetchJobStatus();
    const job = res && res.job;
    if (!job) {
      if (res && res.running) {
        setRunningUi(true);
        const status = document.getElementById('nicheStatus');
        const result = document.getElementById('nicheResult');
        if (status && !status.textContent) status.textContent = 'Job running in background…';
        if (result && !result.querySelector('.niche-multi-table') && !result.querySelector('.niche-verdict')) {
          result.innerHTML = '<div class="niche-empty"><strong>Multi-scan running in background…</strong>Popup close safe. Re-open to watch progress or stop.</div>';
        }
      }
      return;
    }

    if (job.status === 'running' || (res && res.running && job.status !== 'done' && job.status !== 'stopped' && job.status !== 'error')) {
      applyJobToUi(Object.assign({}, job, { status: 'running' }), { forceSeed: true });
      return;
    }

    stopPolling();
    applyJobToUi(job, { forceSeed: true });
  }

  function startPolling() {
    stopPolling();
    pollJob();
    pollTimer = setInterval(pollJob, 900);
  }

  async function runSingle() {
    const kwEl = document.getElementById('nicheKeyword');
    const countryEl = document.getElementById('nicheCountry');
    const locEl = document.getElementById('nicheLocation');
    const status = document.getElementById('nicheStatus');
    const result = document.getElementById('nicheResult');

    const seed = (kwEl && kwEl.value || '').trim();
    if (!seed) {
      if (status) status.textContent = 'Enter a keyword first.';
      return;
    }

    const countryVal = (countryEl && countryEl.value) || 'us|en';
    const [gl, hl] = countryVal.split('|');
    const near = (locEl && locEl.value || '').trim();

    lastPayload = null;
    if (result) {
      result.innerHTML = '<div class="niche-empty"><strong>Running in background…</strong>You can close this popup — check continues. Re-open Niche tab to see progress.</div>';
    }
    if (status) status.textContent = 'Starting…';
    setProgress(5);
    setRunningUi(true);

    const res = await sendMsg({
      action: 'NICHE_JOB_START',
      mode: 'single',
      seed, gl: gl || 'us', hl: hl || 'en', near: near || ''
    });
    if (!res || !res.ok) {
      setRunningUi(false);
      setProgress(0);
      if (status) status.textContent = '';
      if (result) result.innerHTML = '<p class="niche-err">' + ((res && res.error) || 'Could not start').replace(/</g, '&lt;') + '</p>';
      return;
    }
    startPolling();
  }

  function getSelectedMarketCount() {
    const el = document.getElementById('nicheMarketCount');
    let n = el ? parseInt(el.value, 10) : MARKET_COUNT_DEFAULT;
    if (!n || n < 1) n = MARKET_COUNT_DEFAULT;
    if (n > MULTI_MARKETS.length) n = MULTI_MARKETS.length;
    return n;
  }

  function getMarketsForScan() {
    const n = getSelectedMarketCount();
    return MULTI_MARKETS.slice(0, n);
  }

  function updateMultiHint() {
    const hint = document.getElementById('nicheModeHint');
    if (!hint || currentMode !== 'multi') return;
    const n = getSelectedMarketCount();
    const minsLow = Math.max(1, Math.round(n * 0.15));
    const minsHigh = Math.max(2, Math.round(n * 0.3));
    hint.textContent = 'Scans ' + n + ' of ' + MULTI_MARKETS.length + ' markets (competition + per-country volume when KE key is on). ~' + minsLow + '–' + minsHigh + ' min · sequential.';
  }

  async function runMulti() {
    const kwEl = document.getElementById('nicheKeyword');
    const status = document.getElementById('nicheStatus');
    const result = document.getElementById('nicheResult');

    const seed = (kwEl && kwEl.value || '').trim();
    if (!seed) {
      if (status) status.textContent = 'Enter a keyword first.';
      return;
    }

    const markets = getMarketsForScan();
    // Remember preference
    try {
      chrome.storage.local.set({ [MARKET_COUNT_KEY]: markets.length });
    } catch (_) {}

    lastPayload = null;
    if (result) {
      result.innerHTML = '<div class="niche-empty"><strong>Multi-scan running in background…</strong>Popup close safe. Re-open to watch progress or stop.</div>';
    }
    if (status) status.textContent = 'Starting multi-scan · ' + markets.length + ' markets…';
    setProgress(2);
    setRunningUi(true);

    const res = await sendMsg({
      action: 'NICHE_JOB_START',
      mode: 'multi',
      seed,
      markets
    });
    if (!res || !res.ok) {
      setRunningUi(false);
      setProgress(0);
      if (result) result.innerHTML = '<p class="niche-err">' + ((res && res.error) || 'Could not start').replace(/</g, '&lt;') + '</p>';
      return;
    }
    startPolling();
  }

  async function stopNicheJob() {
    const status = document.getElementById('nicheStatus');
    if (status) status.textContent = 'Stopping…';
    await sendMsg({ action: 'NICHE_JOB_STOP' });
    startPolling();
  }

  function setMode(mode) {
    if (mode === 'multi') currentMode = 'multi';
    else if (mode === 'discover') currentMode = 'discover';
    else currentMode = 'single';

    const singleBtn = document.getElementById('nicheModeSingle');
    const multiBtn = document.getElementById('nicheModeMulti');
    const discBtn = document.getElementById('nicheModeDiscover');
    const fields = document.getElementById('nicheSingleFields');
    const countryFields = document.getElementById('nicheCountryFields');
    const multiFields = document.getElementById('nicheMultiFields');
    const discOpts = document.getElementById('nicheDiscoverOpts');
    const hint = document.getElementById('nicheModeHint');
    const runBtn = document.getElementById('nicheRunBtn');

    if (singleBtn) singleBtn.classList.toggle('active', currentMode === 'single');
    if (multiBtn) multiBtn.classList.toggle('active', currentMode === 'multi');
    if (discBtn) discBtn.classList.toggle('active', currentMode === 'discover');
    // Country: visible for single + discover (not multi — multi scans many countries)
    if (countryFields) countryFields.style.display = currentMode === 'multi' ? 'none' : '';
    if (fields) fields.classList.toggle('hidden', currentMode !== 'single');
    if (multiFields) multiFields.classList.toggle('hidden', currentMode !== 'multi');
    if (discOpts) discOpts.style.display = currentMode === 'discover' ? 'block' : 'none';
    if (hint) {
      if (currentMode === 'multi') updateMultiHint();
      else if (currentMode === 'discover') {
        hint.textContent = 'Expands seed with A–Z / modifiers / questions via free Google Autocomplete for the selected country.';
        // Restore last discovered list if results area empty / showing report
        setTimeout(() => {
          const host = document.getElementById('nicheResult');
          if (!host) return;
          const hasList = !!host.querySelector('#nicheDiscTbody');
          if (!hasList && _lastDiscover && _lastDiscover.keywords && _lastDiscover.keywords.length) {
            renderDiscoverResults(host, _lastDiscover);
            if (_lastBatchResults && _lastBatchResults.length) {
              const batchHost = host.querySelector('#nicheDiscBatchResults');
              const statusEl = host.querySelector('#nicheDiscBatchStatus');
              if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.textContent = 'Saved competition results · ' + _lastBatchResults.filter(x => x.ok).length + ' checked';
              }
              if (batchHost) renderBatchResultsTable(batchHost, _lastBatchResults);
            }
          }
        }, 0);
      } else {
        hint.textContent = 'Checks one country SERP and scores beginner ease.';
      }
    }
    if (runBtn) {
      if (!runBtn.disabled) {
        runBtn.textContent = currentMode === 'multi'
          ? 'Find easiest market'
          : (currentMode === 'discover' ? 'Discover keywords (free)' : 'Check niche (free)');
      }
      runBtn.classList.toggle('multi', currentMode === 'multi');
    }
  }

  /* ─── Niche history (local storage) ─────────────────────────── */
  const HISTORY_KEY = 'rs_niche_history';
  const HISTORY_MAX = 25;

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (r) => resolve(r || {}));
      } catch (_) {
        resolve({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => resolve());
      } catch (_) {
        resolve();
      }
    });
  }

  async function loadHistory() {
    const r = await storageGet([HISTORY_KEY]);
    return Array.isArray(r[HISTORY_KEY]) ? r[HISTORY_KEY] : [];
  }

  const _histSavedIds = new Set();

  async function saveHistoryEntry(entry) {
    try {
      const id = entry.id || ('nh_' + Date.now());
      if (_histSavedIds.has(id)) return await loadHistory();
      _histSavedIds.add(id);
      const list = await loadHistory();
      const next = [{ ...entry, id, savedAt: entry.savedAt || Date.now() }, ...list.filter((x) => x.id !== id)].slice(0, HISTORY_MAX);
      await storageSet({ [HISTORY_KEY]: next });
      return next;
    } catch (_) {
      return [];
    }
  }

  async function persistJobToHistory(job) {
    if (!job || (job.status !== 'done' && job.status !== 'stopped')) return;
    if (job.mode === 'multi' && Array.isArray(job.multiRows) && job.multiRows.length) {
      await saveHistoryEntry({
        id: job.id || ('nh_m_' + Date.now()),
        mode: 'multi',
        seed: job.seed || '',
        status: job.status,
        message: job.message || '',
        multiRows: job.multiRows,
        savedAt: Date.now(),
      });
    } else if (job.result) {
      await saveHistoryEntry({
        id: job.id || ('nh_s_' + Date.now()),
        mode: 'single',
        seed: job.seed || (job.result && job.result.seed) || '',
        status: job.status,
        message: job.message || '',
        result: job.result,
        gl: job.gl,
        hl: job.hl,
        savedAt: Date.now(),
      });
    }
    void refreshHistoryPanel();
  }

  function formatHistTime(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function renderHistoryList(listHost, list) {
    if (!listHost) return;
    if (!list || !list.length) {
      listHost.innerHTML = '<p class="niche-note" style="margin:0">No past reports yet. Run a check and it will appear here.</p>';
      return;
    }
    const items = list.slice(0, 12).map((h) => {
      const seedSafe = String(h.seed || '—').replace(/</g, '&lt;');
      const modeLabel = h.mode === 'multi' ? 'Multi markets' : (h.gl || 'single').toString().toUpperCase();
      let score = '';
      if (h.mode === 'multi' && Array.isArray(h.multiRows)) {
        const ok = h.multiRows.filter((r) => !r.error);
        const best = ok.sort((a, b) => (b.scoreNum || 0) - (a.scoreNum || 0))[0];
        if (best) score = (best.verdict || '') + ' · ' + (best.scoreNum != null ? best.scoreNum : '—') + '/100 · ' + shortCountry(best.gl, best.hl);
      } else if (h.result && h.result.verdict) {
        const v = h.result.verdict;
        score = (v.verdict || '') + ' · ' + (v.scoreNum != null ? v.scoreNum : '—') + '/100';
      }
      return `<button type="button" class="niche-hist-item" data-hist-id="${String(h.id).replace(/"/g, '')}">
        <div class="niche-hist-top">
          <strong>${seedSafe}</strong>
          <span class="niche-hist-time">${formatHistTime(h.savedAt)}</span>
        </div>
        <div class="niche-hist-meta">${modeLabel}${score ? ' · ' + String(score).replace(/</g, '&lt;') : ''}</div>
      </button>`;
    }).join('');
    listHost.innerHTML = `<div class="niche-hist-list">${items}</div>`;
    listHost.querySelectorAll('.niche-hist-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-hist-id');
        const all = await loadHistory();
        const entry = all.find((x) => String(x.id) === String(id));
        if (!entry) return;
        const resultHost = document.getElementById('nicheResult');
        const kwEl = document.getElementById('nicheKeyword');
        if (kwEl && entry.seed) kwEl.value = entry.seed;
        setMode(entry.mode === 'multi' ? 'multi' : 'single');
        if (entry.mode === 'multi' && entry.multiRows && resultHost) {
          renderMultiResult(resultHost, entry.seed || '', entry.multiRows);
        } else if (entry.result && resultHost) {
          lastPayload = entry.result;
          renderSingleResult(resultHost, entry.result);
        }
        // keep history panel open; refresh count
        void refreshHistoryPanel({ keepOpen: true });
      });
    });
  }

  let _histPanelBound = false;

  function bindHistoryToggle() {
    if (_histPanelBound) return;
    const toggle = document.getElementById('nicheHistToggle');
    const body = document.getElementById('nicheHistoryBody');
    if (!toggle || !body) return;
    _histPanelBound = true;
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      const next = !open;
      toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
      if (next) body.removeAttribute('hidden');
      else body.setAttribute('hidden', '');
    });
    const clearAll = document.getElementById('nicheHistClearAll');
    if (clearAll) {
      clearAll.addEventListener('click', async () => {
        if (!confirm('Clear all past niche reports from history?')) return;
        try {
          await storageSet({ [HISTORY_KEY]: [] });
          _histSavedIds.clear();
        } catch (_) {}
        void refreshHistoryPanel();
        const status = document.getElementById('nicheStatus');
        if (status) status.textContent = 'History cleared';
      });
    }
  }

  async function refreshHistoryPanel(opts) {
    const card = document.getElementById('nicheHistoryCard');
    const listHost = document.getElementById('nicheHistoryList');
    const countEl = document.getElementById('nicheHistCount');
    const toggle = document.getElementById('nicheHistToggle');
    const body = document.getElementById('nicheHistoryBody');
    if (!card || !listHost) return;
    bindHistoryToggle();
    try {
      const list = await loadHistory();
      if (!list.length) {
        card.style.display = 'none';
        return;
      }
      card.style.display = '';
      if (countEl) countEl.textContent = String(list.length);
      renderHistoryList(listHost, list);
      if (opts && opts.keepOpen && toggle && body) {
        toggle.setAttribute('aria-expanded', 'true');
        body.removeAttribute('hidden');
      }
    } catch (_) {
      card.style.display = 'none';
    }
  }

  let _initBusy = false;

  function renderDiscoverProgress(host, job) {
    if (!host) return;
    const done = (job && job.done) || 0;
    const total = (job && job.total) || 80;
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const count = (job && job.count) || 0;
    const msg = (job && job.message) || 'Working…';
    const st = (job && job.status) || 'running';
    host.innerHTML =
      '<div style="padding:18px 16px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">' +
          '<div style="font-size:14px;font-weight:800;color:#0f172a;">Discovering keywords</div>' +
          '<div style="font-size:12px;font-weight:700;color:#0D9488;">' + pct + '%</div>' +
        '</div>' +
        '<div style="height:8px;background:#e2e8f0;border-radius:99px;overflow:hidden;margin-bottom:10px;">' +
          '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#0D9488,#14b8a6);transition:width .3s;"></div>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">' +
          '<span style="font-size:11px;padding:4px 8px;border-radius:6px;background:#f1f5f9;color:#334155;font-weight:600;">' + done + ' / ' + total + ' queries</span>' +
          '<span style="font-size:11px;padding:4px 8px;border-radius:6px;background:#ecfdf5;color:#065f46;font-weight:600;">' + count + ' keywords</span>' +
          '<span style="font-size:11px;padding:4px 8px;border-radius:6px;background:#eff6ff;color:#1e40af;font-weight:600;">' + String(st) + '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#64748b;line-height:1.45;">' + String(msg).replace(/</g, '') + '</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:8px;">Popup band karke wapas kholen — progress yahin se continue hogi.</div>' +
      '</div>';
  }

  function attachDiscoverPolling() {
    stopDiscoverPoll();
    let finished = false;
    const host = document.getElementById('nicheResult');
    const pt = document.getElementById('nicheDiscProgressText');
    const finishWithJob = (job) => {
      if (finished) return;
      if (!job) return;
      if (job.status === 'paused') {
        setDiscoverControls('paused');
        renderDiscoverProgress(host, job);
        if (pt) pt.textContent = job.message || 'Paused';
        return;
      }
      if (job.status === 'running') {
        setDiscoverControls('running');
        renderDiscoverProgress(host, job);
        return;
      }
      finished = true;
      stopDiscoverPoll();
      _discoverBusy = false;
      setDiscoverControls('idle');
      if (pt) pt.textContent = job.message || 'Done';
      if (host) {
        if (job.keywords && job.keywords.length) {
          _lastDiscover = { seed: job.seed, queriesRun: job.done || job.total, keywords: job.keywords, gl: job.gl, hl: job.hl };
          renderDiscoverResults(host, _lastDiscover);
        } else if (job.status === 'error') {
          host.innerHTML = '<div class="niche-empty"><div class="niche-empty-title">Error</div><p>' +
            String(job.message || 'Failed').replace(/</g, '') + '</p></div>';
        }
      }
    };
    const tick = async () => {
      const st = await sendMsg({ action: 'NICHE_DISCOVER_STATUS' });
      const job = st && st.job;
      if (!job) return;
      if (pt) pt.textContent = (job.done || 0) + '/' + (job.total || 0) + ' · ' + (job.count || 0) + ' keywords';
      if (job.status === 'running' || job.status === 'paused') {
        finishWithJob(job);
        return;
      }
      finishWithJob(job);
    };
    void tick();
    _discoverPoll = setInterval(tick, 600);
  }

  async function restoreDiscoverState() {
    try {
      const st = await sendMsg({ action: 'NICHE_DISCOVER_STATUS' });
      const job = st && st.job;
      if (!job) return false;
      const host = document.getElementById('nicheResult');
      const kwEl = document.getElementById('nicheKeyword');
      if (job.seed && kwEl) kwEl.value = job.seed;
      setMode('discover');
      ensureDiscoverControlBar();

      if (job.status === 'running' || (st.running && job.status !== 'done' && job.status !== 'stopped' && job.status !== 'error')) {
        _discoverBusy = true;
        setDiscoverControls('running');
        renderDiscoverProgress(host, job);
        attachDiscoverPolling();
        return true;
      }
      if (job.status === 'paused') {
        _discoverBusy = true;
        setDiscoverControls('paused');
        renderDiscoverProgress(host, job);
        attachDiscoverPolling();
        return true;
      }
      if ((job.status === 'done' || job.status === 'stopped') && job.keywords && job.keywords.length) {
        _discoverBusy = false;
        setDiscoverControls('idle');
        _lastDiscover = { seed: job.seed, queriesRun: job.done || job.total, keywords: job.keywords, gl: job.gl, hl: job.hl };
        if (host) renderDiscoverResults(host, _lastDiscover);
        return true;
      }
    } catch (_) {}
    return false;
  }

  async function restoreNicheState() {
    const result = document.getElementById('nicheResult');
    const status = document.getElementById('nicheStatus');

    // Load last discover keywords from storage (always available for re-download)
    try { await loadDiscoverData(); } catch (_) {}

    // 1) Active batch competition check
    try {
      if (await restoreBatchState()) return true;
    } catch (_) {}

    // 2) Active / recent Discover job (survives popup close)
    try {
      if (await restoreDiscoverState()) return true;
    } catch (_) {}

    try {
      const res = await fetchJobStatus();
      const job = res && res.job;
      const isRunning = !!(job && job.status === 'running') || !!(res && res.running);

      if (isRunning) {
        const j = job || { status: 'running', mode: currentMode || 'multi', message: 'Job running in background…', progress: 5, seed: (document.getElementById('nicheKeyword') || {}).value || '' };
        if (j.mode) setMode(j.mode);
        applyJobToUi(Object.assign({}, j, { status: 'running' }), { forceSeed: true });
        setRunningUi(true);
        startPolling();
        return true;
      }

      if (job && (job.status === 'done' || job.status === 'stopped' || job.status === 'error')) {
        if (job.mode) setMode(job.mode);
        applyJobToUi(job, { forceSeed: true });
        void persistJobToHistory(job);
        return true;
      }
    } catch (_) {}

    // No active job — show last history entry; history panel always available below
    try {
      const list = await loadHistory();
      void refreshHistoryPanel();
      if (list.length) {
        const last = list[0];
        if (last.seed) {
          const kwEl = document.getElementById('nicheKeyword');
          if (kwEl && !kwEl.value) kwEl.value = last.seed;
        }
        if (last.mode === 'multi' && last.multiRows && last.multiRows.length && result) {
          setMode('multi');
          renderMultiResult(result, last.seed || '', last.multiRows);
          if (status) status.textContent = 'Last multi report · ' + formatHistTime(last.savedAt);
          return true;
        }
        if (last.result && result) {
          setMode('single');
          lastPayload = last.result;
          renderSingleResult(result, last.result);
          if (status) status.textContent = 'Last report · ' + formatHistTime(last.savedAt);
          return true;
        }
        // no reopenable payload — leave empty state; history panel still shows
        return true;
      }
    } catch (_) {}

    // Fallback: show last discover keywords so export is always possible
    if (_lastDiscover && _lastDiscover.keywords && _lastDiscover.keywords.length) {
      setMode('discover');
      if (result) {
        renderDiscoverResults(result, _lastDiscover);
        if (_lastBatchResults && _lastBatchResults.length) {
          const batchHost = result.querySelector('#nicheDiscBatchResults');
          const statusEl = result.querySelector('#nicheDiscBatchStatus');
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.textContent = 'Saved competition results · ' + _lastBatchResults.filter(x => x.ok).length + ' checked';
          }
          if (batchHost) renderBatchResultsTable(batchHost, _lastBatchResults);
        }
      }
      return true;
    }

    void refreshHistoryPanel();
    return false;
  }

  let _libCat = 'all';
  let _libOpen = false;

  function initNicheLibrary() {
    const Lib = typeof RSNicheLibrary !== 'undefined' ? RSNicheLibrary : null;
    if (!Lib) return;

    const randomBtn = document.getElementById('nicheRandomBtn');
    const browseBtn = document.getElementById('nicheBrowseBtn');
    const panel = document.getElementById('nicheLibraryPanel');
    const searchEl = document.getElementById('nicheLibSearch');
    const tabsEl = document.getElementById('nicheLibTabs');
    const listEl = document.getElementById('nicheLibList');
    const countEl = document.getElementById('nicheLibCount');
    const kwEl = document.getElementById('nicheKeyword');

    function fillKeyword(keyword) {
      if (!kwEl || !keyword) return;
      kwEl.value = keyword;
      kwEl.focus();
      try { kwEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }

    function renderList(query) {
      if (!listEl) return;
      const items = Lib.search(query, _libCat).slice(0, 200);
      if (countEl) {
        const total = _libCat === 'all' ? Lib.counts.all : (Lib.counts[_libCat] || 0);
        countEl.textContent = items.length + (query ? ' matches' : ' / ' + total);
      }
      if (!items.length) {
        listEl.innerHTML = '<div class="niche-lib-item" style="cursor:default;color:#94a3b8">No matches</div>';
        return;
      }
      const catLabel = { blogging: 'Blog', apk: 'APK', local: 'Local' };
      listEl.innerHTML = items.map((x) =>
        '<div class="niche-lib-item" data-kw="' + String(x.keyword).replace(/"/g, '&quot;') + '">' +
          '<span>' + String(x.keyword).replace(/</g, '&lt;') + '</span>' +
          '<span class="niche-lib-cat">' + (catLabel[x.category] || x.category) + '</span>' +
        '</div>'
      ).join('');
    }

    function renderTabs() {
      if (!tabsEl || tabsEl._built) return;
      tabsEl._built = true;
      tabsEl.innerHTML = Lib.CATEGORIES.map((c) => {
        const n = c.id === 'all' ? Lib.counts.all : (Lib.counts[c.id] || 0);
        return '<button type="button" class="niche-lib-tab' + (c.id === _libCat ? ' active' : '') + '" data-cat="' + c.id + '">' +
          c.label + ' (' + n + ')</button>';
      }).join('');
      tabsEl.addEventListener('click', (e) => {
        const t = e.target && e.target.closest && e.target.closest('[data-cat]');
        if (!t) return;
        _libCat = t.getAttribute('data-cat') || 'all';
        tabsEl.querySelectorAll('.niche-lib-tab').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-cat') === _libCat);
        });
        renderList(searchEl ? searchEl.value : '');
      });
    }

    if (randomBtn && !randomBtn._bound) {
      randomBtn._bound = true;
      randomBtn.addEventListener('click', () => {
        const pick = Lib.random(_libOpen ? _libCat : 'all');
        if (pick) fillKeyword(pick.keyword);
      });
    }

    if (browseBtn && !browseBtn._bound) {
      browseBtn._bound = true;
      browseBtn.addEventListener('click', () => {
        _libOpen = !_libOpen;
        if (panel) {
          panel.style.display = _libOpen ? 'block' : 'none';
          panel.setAttribute('aria-hidden', _libOpen ? 'false' : 'true');
        }
        browseBtn.textContent = _libOpen ? 'Hide' : 'Browse';
        if (_libOpen) {
          renderTabs();
          renderList(searchEl ? searchEl.value : '');
          if (searchEl) searchEl.focus();
        }
      });
    }

    if (searchEl && !searchEl._bound) {
      searchEl._bound = true;
      let t = null;
      searchEl.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => renderList(searchEl.value), 120);
      });
    }

    if (listEl && !listEl._bound) {
      listEl._bound = true;
      listEl.addEventListener('click', (e) => {
        const item = e.target && e.target.closest && e.target.closest('[data-kw]');
        if (!item) return;
        fillKeyword(item.getAttribute('data-kw') || '');
      });
    }
  }


  /* ─── Keyword discovery (NicheSpark-style, free Google Suggest) ─── */
  let _discoverBusy = false;
  let _lastDiscover = null;
  let _lastBatchResults = null;
  const DISCOVER_STORE_KEY = 'rs_discover_last';
  const BATCH_STORE_KEY = 'rs_batch_last_results';

  function persistDiscoverData() {
    try {
      const payload = {};
      if (_lastDiscover && _lastDiscover.keywords && _lastDiscover.keywords.length) {
        payload[DISCOVER_STORE_KEY] = {
          seed: _lastDiscover.seed,
          queriesRun: _lastDiscover.queriesRun,
          keywords: _lastDiscover.keywords,
          gl: _lastDiscover.gl || '',
          hl: _lastDiscover.hl || '',
          savedAt: Date.now()
        };
      }
      if (_lastBatchResults && _lastBatchResults.length) {
        payload[BATCH_STORE_KEY] = { results: _lastBatchResults, savedAt: Date.now() };
      }
      if (Object.keys(payload).length) chrome.storage.local.set(payload);
    } catch (_) {}
  }

  /** Clear saved discover keywords + competition results from memory and storage */
  function clearDiscoverStorage(opts) {
    const clearKw = !opts || opts.keywords !== false;
    const clearBatch = !opts || opts.batch !== false;
    try {
      if (clearKw) _lastDiscover = null;
      if (clearBatch) _lastBatchResults = null;
      const removeKeys = [];
      if (clearKw) removeKeys.push(DISCOVER_STORE_KEY);
      if (clearBatch) removeKeys.push(BATCH_STORE_KEY);
      if (removeKeys.length) {
        try { chrome.storage.local.remove(removeKeys); } catch (_) {}
      }
    } catch (_) {}
  }

  async function loadDiscoverData() {
    try {
      const r = await storageGet([DISCOVER_STORE_KEY, BATCH_STORE_KEY]);
      if (r[DISCOVER_STORE_KEY] && Array.isArray(r[DISCOVER_STORE_KEY].keywords)) {
        _lastDiscover = r[DISCOVER_STORE_KEY];
      }
      if (r[BATCH_STORE_KEY] && Array.isArray(r[BATCH_STORE_KEY].results)) {
        _lastBatchResults = r[BATCH_STORE_KEY].results;
      }
      return !!(_lastDiscover && _lastDiscover.keywords && _lastDiscover.keywords.length);
    } catch (_) {
      return false;
    }
  }

  function injectBackToDiscover(host) {
    if (!host || !(_lastDiscover && _lastDiscover.keywords && _lastDiscover.keywords.length)) return;
    if (host.querySelector('#nicheBackToDiscover')) return;
    const bar = document.createElement('div');
    bar.id = 'nicheBackToDiscover';
    bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;padding:10px 12px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px;';
    bar.innerHTML =
      '<button type="button" id="nicheBackDiscoverBtn" class="niche-lib-btn niche-lib-btn-primary" style="font-size:12px;padding:6px 12px;">← Back to keyword list</button>' +
      '<button type="button" id="nicheExportDiscoverAgain" class="niche-lib-btn" style="font-size:12px;padding:6px 12px;">Export keywords</button>' +
      '<button type="button" id="nicheExportDiscoverAllAgain" class="niche-lib-btn" style="font-size:12px;padding:6px 12px;">Export all (1 file)</button>' +
      '<span style="font-size:11px;color:#0f766e;">' + (_lastDiscover.keywords.length) + ' discovered keywords saved</span>';
    host.insertBefore(bar, host.firstChild);
    const back = bar.querySelector('#nicheBackDiscoverBtn');
    if (back) back.addEventListener('click', () => { showDiscoverList(); });
    const exp = bar.querySelector('#nicheExportDiscoverAgain');
    if (exp) exp.addEventListener('click', () => exportDiscoverKeywordsCsv(_lastDiscover));
    const expAll = bar.querySelector('#nicheExportDiscoverAllAgain');
    if (expAll) expAll.addEventListener('click', () => exportDiscoverAllInOne(_lastDiscover, _lastBatchResults));
  }

  function showDiscoverList() {
    const host = document.getElementById('nicheResult');
    if (!host || !_lastDiscover || !_lastDiscover.keywords || !_lastDiscover.keywords.length) return false;
    setMode('discover');
    renderDiscoverResults(host, _lastDiscover);
    // re-attach batch results if any
    if (_lastBatchResults && _lastBatchResults.length) {
      const batchHost = host.querySelector('#nicheDiscBatchResults');
      const statusEl = host.querySelector('#nicheDiscBatchStatus');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.textContent = 'Saved competition results · ' + _lastBatchResults.filter(x => x.ok).length + ' checked';
      }
      if (batchHost && typeof renderBatchResultsTable === 'function') {
        renderBatchResultsTable(batchHost, _lastBatchResults);
      }
    }
    return true;
  }


  function renderDiscoverResults(host, data) {
    if (!host) return;
    const kws = (data && data.keywords) || [];
    _lastDiscover = data;
    persistDiscoverData();
    if (!kws.length) {
      host.innerHTML = '<div class="niche-empty"><div class="niche-empty-title">No suggestions found</div><p>Try a broader seed or enable more expansion options.</p></div>';
      return;
    }
    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const rows = kws.map((r, i) => {
      const kw = esc(r.keyword);
      const raw = String(r.keyword || '').replace(/"/g, '&quot;');
      const hasVol = r.volume != null && Number.isFinite(Number(r.volume));
      const volCell = hasVol
        ? ('<span class="niche-disc-vol-val" style="font-weight:700;color:#0f172a;">' + esc(formatVol(r.volume) || String(r.volume)) + '</span>')
        : '<span class="niche-disc-vol-val" style="color:#94a3b8;">—</span>';
      return '<tr data-disc-row="1" data-kw-key="' + raw.toLowerCase() + '">' +
        '<td style="width:28px;text-align:center;"><input type="checkbox" class="niche-disc-cb" data-kw="' + raw + '" data-idx="' + i + '" /></td>' +
        '<td class="niche-disc-kw" style="font-weight:600;color:#0f172a;">' + kw + '</td>' +
        '<td class="niche-disc-vol" style="text-align:right;font-size:12px;white-space:nowrap;min-width:64px;">' + volCell + '</td>' +
        '<td style="text-align:center;color:#64748b;font-size:11px;">' + (r.hits || 1) + '</td>' +
        '<td style="text-align:right;white-space:nowrap;">' +
          '<button type="button" class="niche-lib-btn niche-disc-check" data-kw="' + raw + '" style="font-size:11px;padding:3px 8px;">Check</button>' +
        '</td></tr>';
    }).join('');

    host.innerHTML =
      '<div class="niche-verdict" style="--nv-color:#0D9488;margin-bottom:12px;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:13px;font-weight:800;color:#0f172a;">' + kws.length + ' keyword ideas</div>' +
            '<div style="font-size:12px;color:#64748b;margin-top:4px;">Seed “' + esc(data.seed) + '” · ' + (data.queriesRun || 0) + ' autocomplete queries' +
              (data.gl ? (' · ' + String(data.gl).toUpperCase() + (data.hl ? '/' + data.hl : '')) : '') + '</div>' +
          '</div>' +
          '<button type="button" class="niche-lib-btn" id="nicheDiscClearSaved" title="Remove saved keywords &amp; competition results from storage" style="font-size:11px;padding:5px 10px;color:#b91c1c;border-color:#fecaca;flex-shrink:0;">Clear saved</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;align-items:center;">' +
        '<input type="search" id="nicheDiscFilter" class="niche-input" placeholder="Filter keywords…" style="flex:1;min-width:140px;max-width:220px;height:32px;font-size:12px;" />' +
        '<button type="button" class="niche-lib-btn" id="nicheDiscSelectAll">Select all</button>' +
        '<button type="button" class="niche-lib-btn" id="nicheDiscSelectNone">None</button>' +
        '<button type="button" class="niche-lib-btn niche-lib-btn-primary" id="nicheDiscExport" title="Keywords only">Export keywords</button>' +
        '<button type="button" class="niche-lib-btn niche-lib-btn-primary" id="nicheDiscExportAll" title="Keywords + scores + SERP in one CSV">Export all (1 file)</button>' +
        '<button type="button" class="niche-lib-btn" id="nicheDiscCopy">Copy selected</button>' +
        '<button type="button" class="niche-lib-btn niche-lib-btn-primary" id="nicheDiscGetVolume" title="Fetch volume only for selected keywords (saves API quota)">Get volume</button>' +
        '<button type="button" class="niche-run" id="nicheDiscCheckSelected" style="padding:6px 12px;font-size:12px;width:auto;">Check selected</button>' +
      '</div>' +
      '<div id="nicheDiscBatchStatus" style="display:none;margin-bottom:10px;font-size:12px;color:#0f766e;font-weight:600;"></div>' +
      '<div id="nicheDiscBatchResults" style="display:none;margin-bottom:12px;"></div>' +
      '<div id="nicheDiscKwSection">' +
        '<button type="button" id="nicheDiscKwToggle" aria-expanded="true" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:8px 12px;margin-bottom:0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px 10px 0 0;cursor:pointer;font:inherit;text-align:left;">' +
          '<span style="font-size:12px;font-weight:700;color:#334155;">Keyword list <span style="font-weight:600;color:#94a3b8;">(' + kws.length + ')</span></span>' +
          '<span id="nicheDiscKwChevron" style="font-size:14px;color:#64748b;transition:transform .15s;">▼</span>' +
        '</button>' +
        '<div id="nicheDiscKwBody" style="overflow:auto;max-height:420px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;">' +
          '<table class="niche-multi-table" style="margin:0;">' +
            '<thead><tr><th></th><th>Keyword</th><th style="text-align:right;">Volume</th><th>Hits</th><th></th></tr></thead>' +
            '<tbody id="nicheDiscTbody">' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    const selectAll = (on) => {
      host.querySelectorAll('.niche-disc-cb').forEach(cb => {
        const tr = cb.closest('tr');
        if (tr && tr.style.display === 'none') return;
        cb.checked = !!on;
      });
    };
    const sa = host.querySelector('#nicheDiscSelectAll');
    const sn = host.querySelector('#nicheDiscSelectNone');
    if (sa) sa.addEventListener('click', () => selectAll(true));
    if (sn) sn.addEventListener('click', () => selectAll(false));

    const filterEl = host.querySelector('#nicheDiscFilter');
    if (filterEl) {
      filterEl.addEventListener('input', () => {
        const q = filterEl.value.trim().toLowerCase();
        host.querySelectorAll('[data-disc-row]').forEach(tr => {
          const text = (tr.querySelector('.niche-disc-kw') || {}).textContent || '';
          tr.style.display = !q || text.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }

    const exp = host.querySelector('#nicheDiscExport');
    if (exp) exp.addEventListener('click', () => exportDiscoverKeywordsCsv(data));
    const expAll = host.querySelector('#nicheDiscExportAll');
    if (expAll) expAll.addEventListener('click', () => {
      exportDiscoverAllInOne(data, _lastBatchResults);
    });

    const copyBtn = host.querySelector('#nicheDiscCopy');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const selected = [...host.querySelectorAll('.niche-disc-cb:checked')].map(cb => cb.getAttribute('data-kw')).filter(Boolean);
      if (!selected.length) { alert('Select at least one keyword'); return; }
      try {
        await navigator.clipboard.writeText(selected.join('\n'));
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy selected'; }, 1200);
      } catch (_) {
        alert('Copy failed');
      }
    });

    host.querySelectorAll('.niche-disc-check').forEach(btn => {
      btn.addEventListener('click', () => {
        const kw = btn.getAttribute('data-kw') || '';
        if (!kw) return;
        const input = document.getElementById('nicheKeyword');
        if (input) input.value = kw;
        setMode('single');
        void runSingle();
      });
    });

    const batchBtn = host.querySelector('#nicheDiscCheckSelected');
    if (batchBtn) {
      batchBtn.addEventListener('click', () => {
        const selected = [...host.querySelectorAll('.niche-disc-cb:checked')]
          .map(cb => cb.getAttribute('data-kw'))
          .filter(Boolean);
        void runDiscoverBatchCheck(selected, host);
      });
    }

    const volBtn = host.querySelector('#nicheDiscGetVolume');
    if (volBtn) {
      volBtn.addEventListener('click', () => {
        const selected = [...host.querySelectorAll('.niche-disc-cb:checked')]
          .map(cb => cb.getAttribute('data-kw'))
          .filter(Boolean);
        if (!selected.length) {
          alert('Select at least one keyword, then click Get volume.\n\nVolume is only fetched for selected rows to protect API quota.');
          return;
        }
        void enrichDiscoverVolumes(host, data, selected, volBtn);
      });
    }

    // Keyword list collapse
    const kwToggle = host.querySelector('#nicheDiscKwToggle');
    const kwBody = host.querySelector('#nicheDiscKwBody');
    const kwChevron = host.querySelector('#nicheDiscKwChevron');
    if (kwToggle && kwBody) {
      kwToggle.addEventListener('click', () => {
        const open = kwToggle.getAttribute('aria-expanded') !== 'false';
        const next = !open;
        kwToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
        kwBody.style.display = next ? '' : 'none';
        if (kwChevron) kwChevron.style.transform = next ? '' : 'rotate(-90deg)';
        // adjust border radius when collapsed
        kwToggle.style.borderRadius = next ? '10px 10px 0 0' : '10px';
      });
    }

    // Clear saved keywords + competition results
    const clearBtn = host.querySelector('#nicheDiscClearSaved');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!confirm('Clear saved keyword ideas and competition results from storage?\n\nThis will empty the list so the next Discover starts clean.')) return;
        clearDiscoverStorage();
        const resultHost = document.getElementById('nicheResult');
        if (resultHost) {
          resultHost.innerHTML =
            '<div class="niche-empty"><div class="niche-empty-title">Saved results cleared</div>' +
            '<p>Enter a new seed and click <strong>Discover keywords</strong> to start fresh.</p></div>';
        }
      });
    }
    // No auto volume fetch — only selected keywords via "Get volume" (protects API quota)
  }

  /** Max selected keywords per Get volume — sequential SBMM calls need pacing. */
  const DISCOVER_VOL_MAX = 10;
  let _discVolToken = 0;

  /**
   * Fetch volume only for selected keywords — one at a time (same path as SERP VOL).
   * SBMM rate-limits parallel bulk; sequential + delay matches working curl behaviour.
   */
  async function enrichDiscoverVolumes(host, data, keywords, btn) {
    if (!host || !data || !Array.isArray(data.keywords)) return;
    let list = [...new Set((keywords || []).map(k => String(k || '').trim()).filter(Boolean))];
    if (!list.length) return;

    if (list.length > DISCOVER_VOL_MAX) {
      if (!confirm(
        'You selected ' + list.length + ' keywords.\n\n' +
        'Volume is fetched one-by-one from Keyword Planner to avoid API blocks.\n\n' +
        'Fetch only the first ' + DISCOVER_VOL_MAX + ' selected?'
      )) {
        return;
      }
      list = list.slice(0, DISCOVER_VOL_MAX);
    }

    const token = ++_discVolToken;
    const countryEl = document.getElementById('nicheCountry');
    const countryVal = (countryEl && countryEl.value) || ((data.gl || 'us') + '|' + (data.hl || 'en'));
    const [gl] = String(countryVal).split('|');
    const country = (gl || data.gl || 'us').toLowerCase();

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Loading volume…';
    }

    const selectedKeys = new Set(list.map(k => k.toLowerCase()));
    host.querySelectorAll('[data-disc-row]').forEach((tr) => {
      const key = (tr.getAttribute('data-kw-key') || '').toLowerCase();
      if (!selectedKeys.has(key)) return;
      const cell = tr.querySelector('.niche-disc-vol-val');
      if (cell) {
        cell.textContent = '…';
        cell.style.color = '#94a3b8';
      }
    });

    const paintOne = (kw, volume, source) => {
      if (token !== _discVolToken) return;
      const key = String(kw || '').toLowerCase();
      const row = data.keywords.find(r => String(r.keyword || '').toLowerCase() === key);
      if (row) {
        row.volume = volume;
        row.volumeSource = source || '';
      }
      const tr = [...host.querySelectorAll('[data-disc-row]')].find(
        el => (el.getAttribute('data-kw-key') || '') === key
      );
      const cell = tr && tr.querySelector('.niche-disc-vol-val');
      if (cell) {
        if (typeof volume === 'number' && volume > 0) {
          cell.textContent = formatVol(volume) || String(volume);
          cell.style.color = volume >= 10000 ? '#16a34a' : (volume >= 1000 ? '#ca8a04' : '#0f172a');
          cell.style.fontWeight = '700';
        } else {
          cell.textContent = '—';
          cell.style.color = '#94a3b8';
          cell.style.fontWeight = '400';
        }
      }
      try { persistDiscoverData(); } catch (_) {}
    };

    try {
      // One keyword at a time — same KW_OVERVIEW path as SERP search-box VOL
      // (SBMM Keyword Planner → GoTrends). Parallel bulk triggers SBMM "forbidden".
      for (let i = 0; i < list.length; i++) {
        if (token !== _discVolToken) return;
        const kw = list[i];
        if (btn) btn.textContent = 'Volume ' + (i + 1) + '/' + list.length + '…';
        try {
          const one = await sendMsg({
            action: 'KW_OVERVIEW',
            query: kw,
            country: country,
            gl: country
          });
          if (one && one.ok && typeof one.volume === 'number' && one.volume > 0) {
            paintOne(kw, one.volume, one.source || 'Keyword Planner');
          } else {
            paintOne(kw, null, '');
          }
        } catch (_) {
          paintOne(kw, null, '');
        }
        // Pace requests — SBMM blocks rapid parallel / burst calls
        if (i + 1 < list.length) await new Promise(r => setTimeout(r, 400));
      }
    } catch (_) {
      list.forEach((k) => paintOne(k, null, ''));
    } finally {
      if (btn && token === _discVolToken) {
        btn.disabled = false;
        btn.textContent = 'Get volume';
      }
    }
  }

  /** Cap bulk checks so SERP scans stay practical (each keyword = full Top 10 check). */
  const DISCOVER_BATCH_MAX = 10;

  function formatVol(n) {
    if (n == null || n === '') return null;
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    if (v >= 1000000) return (Math.round(v / 100000) / 10) + 'M';
    if (v >= 1000) return (Math.round(v / 100) / 10) + 'K';
    return String(Math.round(v));
  }

  function easeBadge(verdict, label) {
    const v = String(verdict || '').toUpperCase();
    const text = label || (v === 'YES' ? 'Good fit' : v === 'MAYBE' ? 'Mixed' : v === 'NO' ? 'Hard' : v === 'WAIT' ? 'Waiting' : (v || '—'));
    let bg = '#f1f5f9', color = '#475569';
    if (v === 'YES') { bg = '#dcfce7'; color = '#166534'; }
    else if (v === 'MAYBE') { bg = '#fef9c3'; color = '#a16207'; }
    else if (v === 'NO') { bg = '#fee2e2'; color = '#b91c1c'; }
    else if (v === 'WAIT') { bg = '#e0e7ff'; color = '#3730a3'; }
    return '<span style="display:inline-block;font-size:11px;font-weight:700;padding:3px 8px;border-radius:99px;background:' + bg + ';color:' + color + ';">' +
      String(text).replace(/</g, '') + '</span>';
  }

  function renderBatchResultsTable(batchHost, results) {
    if (!batchHost) return;
    if (results && results.length) {
      _lastBatchResults = results;
      persistDiscoverData();
    }
    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const sorted = [...(results || [])].sort((a, b) => {
      if (a.ok && !b.ok) return -1;
      if (!a.ok && b.ok) return 1;
      return (b.score || 0) - (a.score || 0);
    });
    const okN = sorted.filter(r => r.ok).length;

    const cards = sorted.map((r, idx) => {
      if (!r.ok) {
        return '<div style="padding:12px 14px;border:1px solid #fecaca;background:#fef2f2;border-radius:12px;margin-bottom:8px;">' +
          '<div style="font-weight:700;color:#0f172a;margin-bottom:4px;">' + esc(r.seed) + '</div>' +
          '<div style="font-size:12px;color:#b91c1c;">' + esc(r.error || 'Check failed') + '</div></div>';
      }
      const score = r.score != null ? r.score : '—';
      const volStr = formatVol(r.volume);
      const volHtml = volStr != null
        ? ('<span style="font-weight:800;color:#0f172a;">' + volStr + '</span>' +
           (r.volumeSource ? '<span style="font-size:10px;color:#94a3b8;margin-left:4px;">' + esc(r.volumeSource) + '</span>' : ''))
        : '<span style="color:#94a3b8;">n/a</span>';
      const scoreColor = (r.score >= 70) ? '#16a34a' : (r.score >= 40) ? '#ca8a04' : '#dc2626';
      return '<div style="padding:14px;border:1px solid #e2e8f0;background:#fff;border-radius:12px;margin-bottom:8px;box-shadow:0 1px 2px rgba(15,23,42,.04);">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
              '<span style="font-size:11px;font-weight:800;color:#94a3b8;">#' + (idx + 1) + '</span>' +
              easeBadge(r.verdict || r.label, r.label) +
            '</div>' +
            '<div style="font-size:13px;font-weight:700;color:#0f172a;line-height:1.35;word-break:break-word;">' + esc(r.seed) + '</div>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0;">' +
            '<div style="font-size:22px;font-weight:800;line-height:1;color:' + scoreColor + ';">' + score + '</div>' +
            '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">/ 100</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;">' +
          '<div style="font-size:12px;color:#64748b;">Volume: ' + volHtml + '</div>' +
          (r.weakCount != null ? ('<div style="font-size:12px;color:#64748b;">Weak DR: <strong style="color:#0f172a;">' + r.weakCount + '</strong></div>') : '') +
          '<button type="button" class="niche-lib-btn niche-lib-btn-primary niche-batch-open" data-idx="' + idx + '" style="margin-left:auto;font-size:11px;padding:5px 12px;">View report</button>' +
        '</div>' +
      '</div>';
    }).join('');

    batchHost.style.display = 'block';
    batchHost.innerHTML =
      '<div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fff;">' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">' +
          '<button type="button" id="nicheBatchToggle" aria-expanded="true" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;background:none;border:none;cursor:pointer;padding:0;font:inherit;text-align:left;">' +
            '<span id="nicheBatchChevron" style="font-size:14px;color:#64748b;transition:transform .15s;flex-shrink:0;">▼</span>' +
            '<span style="font-size:13px;font-weight:800;color:#0f172a;">Competition results <span style="font-weight:600;color:#64748b;font-size:12px;">(' + okN + '/' + sorted.length + ')</span></span>' +
          '</button>' +
          '<button type="button" class="niche-lib-btn" id="nicheBatchExportScores" style="font-size:11px;">Export scores</button>' +
          '<button type="button" class="niche-lib-btn niche-lib-btn-primary" id="nicheBatchExportAll" style="font-size:11px;">Export all</button>' +
          '<button type="button" class="niche-lib-btn" id="nicheBatchClear" title="Remove competition results only" style="font-size:11px;color:#b91c1c;border-color:#fecaca;">Clear</button>' +
        '</div>' +
        '<div id="nicheBatchBody" style="max-height:360px;overflow:auto;padding:10px 12px 4px;">' + cards + '</div>' +
      '</div>';

    // Collapse / expand competition results
    const batchToggle = batchHost.querySelector('#nicheBatchToggle');
    const batchBody = batchHost.querySelector('#nicheBatchBody');
    const batchChevron = batchHost.querySelector('#nicheBatchChevron');
    if (batchToggle && batchBody) {
      batchToggle.addEventListener('click', () => {
        const open = batchToggle.getAttribute('aria-expanded') !== 'false';
        const next = !open;
        batchToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
        batchBody.style.display = next ? '' : 'none';
        if (batchChevron) batchChevron.style.transform = next ? '' : 'rotate(-90deg)';
      });
    }

    batchHost.querySelectorAll('.niche-batch-open').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-idx'), 10);
        const row = sorted[i];
        if (!row || !row.ok || !row.payload) return;
        const input = document.getElementById('nicheKeyword');
        if (input) input.value = row.seed;
        lastPayload = row.payload;
        const result = document.getElementById('nicheResult');
        if (result && typeof renderSingleResult === 'function') {
          renderSingleResult(result, row.payload);
          injectBackToDiscover(result);
        }
        // stay conceptually on discover data; mode button stays usable
        try { document.getElementById('nicheModeDiscover')?.classList.add('active'); } catch (_) {}

      });
    });
    const bex = batchHost.querySelector('#nicheBatchExportScores');
    if (bex) bex.addEventListener('click', () => {
      exportDiscoverBatchCsv((_lastDiscover && _lastDiscover.seed) || 'batch', results);
    });
    const bexAll = batchHost.querySelector('#nicheBatchExportAll');
    if (bexAll) bexAll.addEventListener('click', () => {
      exportDiscoverAllInOne(_lastDiscover, results);
    });
    const batchClear = batchHost.querySelector('#nicheBatchClear');
    if (batchClear) {
      batchClear.addEventListener('click', () => {
        if (!confirm('Clear saved competition results? Keyword list will stay.')) return;
        clearDiscoverStorage({ keywords: false, batch: true });
        batchHost.style.display = 'none';
        batchHost.innerHTML = '';
        const statusEl = document.getElementById('nicheDiscBatchStatus');
        if (statusEl) {
          statusEl.style.display = 'none';
          statusEl.textContent = '';
        }
      });
    }
  }

  let _batchPoll = null;
  function stopBatchPoll() {
    if (_batchPoll) { clearInterval(_batchPoll); _batchPoll = null; }
  }

  function setBatchControls(state) {
    // state: idle | running | paused
    const runBtn = document.getElementById('nicheRunBtn');
    const pauseBtn = document.getElementById('nicheDiscPauseBtn');
    const resumeBtn = document.getElementById('nicheDiscResumeBtn');
    const stopBtn = document.getElementById('nicheDiscStopBtn');
    const pt = document.getElementById('nicheDiscProgressText');
    if (runBtn && state !== 'idle') {
      runBtn.disabled = true;
      runBtn.textContent = state === 'paused' ? 'Batch paused' : 'Checking selected…';
    } else if (runBtn && currentMode === 'discover') {
      runBtn.disabled = false;
      runBtn.textContent = 'Discover keywords (free)';
    }
    if (pauseBtn) pauseBtn.style.display = state === 'running' ? 'inline-flex' : 'none';
    if (resumeBtn) resumeBtn.style.display = state === 'paused' ? 'inline-flex' : 'none';
    if (stopBtn) stopBtn.style.display = (state === 'running' || state === 'paused') ? 'inline-flex' : 'none';
    if (pt && state === 'idle') pt.textContent = '';
  }

  async function runDiscoverBatchCheck(keywords, host) {
    const list = [...new Set((keywords || []).map(k => String(k || '').trim()).filter(Boolean))];
    if (!list.length) {
      alert('Select at least one keyword');
      return;
    }
    const capped = list.slice(0, DISCOVER_BATCH_MAX);
    if (list.length > DISCOVER_BATCH_MAX) {
      if (!confirm('Checking all ' + list.length + ' would take a long time.\n\nRun the first ' + DISCOVER_BATCH_MAX + ' selected keywords?')) {
        return;
      }
    }

    const countryEl = document.getElementById('nicheCountry');
    const locEl = document.getElementById('nicheLocation');
    const countryVal = (countryEl && countryEl.value) || 'us|en';
    const [gl, hl] = countryVal.split('|');
    const near = (locEl && locEl.value || '').trim();

    const statusEl = host && host.querySelector('#nicheDiscBatchStatus');
    const batchHost = host && host.querySelector('#nicheDiscBatchResults');
    const batchBtn = host && host.querySelector('#nicheDiscCheckSelected');

    ensureDiscoverControlBar();
    if (batchBtn) batchBtn.disabled = true;
    setBatchControls('running');
    stopBatchPoll();
    stopDiscoverPoll(); // don't mix discover poll

    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = 'Starting batch check (0/' + capped.length + ')…';
    }
    if (batchHost) {
      batchHost.style.display = 'block';
      batchHost.innerHTML = '<div style="padding:14px;font-size:12px;color:#64748b;">Running competition checks in background… you can close the popup.</div>';
    }

    const start = await sendMsg({
      action: 'NICHE_BATCH_START',
      seeds: capped,
      gl: gl || 'us',
      hl: hl || 'en',
      near: near || ''
    });
    if (!start || !start.ok) {
      if (batchBtn) batchBtn.disabled = false;
      setBatchControls('idle');
      if (statusEl) statusEl.textContent = (start && start.error) || 'Could not start batch';
      return;
    }

    // Wire pause/resume/stop to BATCH actions while batch runs
    const pauseBtn = document.getElementById('nicheDiscPauseBtn');
    const resumeBtn = document.getElementById('nicheDiscResumeBtn');
    const stopBtn = document.getElementById('nicheDiscStopBtn');
    if (pauseBtn) {
      pauseBtn.onclick = async () => {
        await sendMsg({ action: 'NICHE_BATCH_PAUSE' });
        setBatchControls('paused');
      };
    }
    if (resumeBtn) {
      resumeBtn.onclick = async () => {
        await sendMsg({ action: 'NICHE_BATCH_RESUME' });
        setBatchControls('running');
      };
    }
    if (stopBtn) {
      stopBtn.onclick = async () => {
        await sendMsg({ action: 'NICHE_BATCH_STOP' });
      };
    }

    const finish = (job) => {
      stopBatchPoll();
      if (batchBtn) batchBtn.disabled = false;
      setBatchControls('idle');
      const results = (job && job.results) || [];
      _lastBatchResults = results;
      persistDiscoverData();
      if (statusEl) statusEl.textContent = (job && job.message) || ('Batch done · ' + results.length);
      renderBatchResultsTable(batchHost, results);
      // restore discover pause handlers
      ensureDiscoverControlBar();
    };

    _batchPoll = setInterval(async () => {
      const st = await sendMsg({ action: 'NICHE_BATCH_STATUS' });
      const job = st && st.job;
      if (!job) return;
      if (statusEl) statusEl.textContent = job.message || '';
      if (job.status === 'paused') setBatchControls('paused');
      else if (job.status === 'running') setBatchControls('running');
      if (job.status === 'done' || job.status === 'stopped' || job.status === 'error') {
        finish(job);
      } else if (job.results && job.results.length && batchHost) {
        // live partial table
        renderBatchResultsTable(batchHost, job.results);
      }
    }, 1000);
  }

  async function restoreBatchState(host) {
    try {
      const st = await sendMsg({ action: 'NICHE_BATCH_STATUS' });
      const job = st && st.job;
      if (!job) return false;
      if (!host) host = document.getElementById('nicheResult');
      if (!host) return false;
      // Ensure discover results UI exists for batch status nodes
      if (job.status === 'running' || job.status === 'paused' || (job.results && job.results.length)) {
        setMode('discover');
        ensureDiscoverControlBar();
        if (!_lastDiscover && job.seeds) {
          // keep keyword list if we still have discover data in storage via status only
        }
        let statusEl = host.querySelector('#nicheDiscBatchStatus');
        let batchHost = host.querySelector('#nicheDiscBatchResults');
        if (!statusEl || !batchHost) {
          // inject batch area above keyword table if results UI present
          if (!host.querySelector('#nicheDiscTbody') && job.results && job.results.length) {
            // show only scores
            host.innerHTML = '<div id="nicheDiscBatchStatus" style="display:block;margin-bottom:10px;font-size:12px;color:#0f766e;font-weight:600;"></div>' +
              '<div id="nicheDiscBatchResults"></div>';
            statusEl = host.querySelector('#nicheDiscBatchStatus');
            batchHost = host.querySelector('#nicheDiscBatchResults');
          }
        }
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.textContent = job.message || '';
        }
        if (job.results && job.results.length && batchHost) {
          _lastBatchResults = job.results;
          renderBatchResultsTable(batchHost, job.results);
        }
        if (job.status === 'running' || job.status === 'paused') {
          setBatchControls(job.status === 'paused' ? 'paused' : 'running');
          stopBatchPoll();
          _batchPoll = setInterval(async () => {
            const st2 = await sendMsg({ action: 'NICHE_BATCH_STATUS' });
            const j2 = st2 && st2.job;
            if (!j2) return;
            if (statusEl) statusEl.textContent = j2.message || '';
            if (j2.results && j2.results.length && batchHost) renderBatchResultsTable(batchHost, j2.results);
            if (j2.status === 'done' || j2.status === 'stopped' || j2.status === 'error') {
              stopBatchPoll();
              setBatchControls('idle');
              _lastBatchResults = j2.results || [];
              if (batchHost) renderBatchResultsTable(batchHost, _lastBatchResults);
              if (statusEl) statusEl.textContent = j2.message || '';
            }
          }, 1000);
          return true;
        }
        if (job.status === 'done' || job.status === 'stopped') {
          setBatchControls('idle');
          return !!(job.results && job.results.length);
        }
      }
    } catch (_) {}
    return false;
  }

  let _discoverPoll = null;
  let _batchCtrl = { paused: false, stop: false };

  function stopDiscoverPoll() {
    if (_discoverPoll) {
      clearInterval(_discoverPoll);
      _discoverPoll = null;
    }
  }

  function setDiscoverControls(state) {
    // state: idle | running | paused | done
    const runBtn = document.getElementById('nicheRunBtn');
    const pauseBtn = document.getElementById('nicheDiscPauseBtn');
    const resumeBtn = document.getElementById('nicheDiscResumeBtn');
    const stopBtn = document.getElementById('nicheDiscStopBtn');
    const nicheStop = document.getElementById('nicheStopBtn');
    if (nicheStop) nicheStop.style.display = 'none';

    if (runBtn) {
      if (state === 'running' || state === 'paused') {
        runBtn.disabled = true;
        runBtn.textContent = state === 'paused' ? 'Paused' : 'Discovering…';
      } else {
        runBtn.disabled = false;
        runBtn.textContent = 'Discover keywords (free)';
      }
    }
    if (pauseBtn) pauseBtn.style.display = state === 'running' ? 'inline-flex' : 'none';
    if (resumeBtn) resumeBtn.style.display = state === 'paused' ? 'inline-flex' : 'none';
    if (stopBtn) stopBtn.style.display = (state === 'running' || state === 'paused') ? 'inline-flex' : 'none';
  }

  function ensureDiscoverControlBar() {
    let bar = document.getElementById('nicheDiscControlBar');
    if (bar) return bar;
    const runBtn = document.getElementById('nicheRunBtn');
    if (!runBtn || !runBtn.parentNode) return null;
    bar = document.createElement('div');
    bar.id = 'nicheDiscControlBar';
    bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center;';
    bar.innerHTML =
      '<button type="button" id="nicheDiscPauseBtn" class="niche-lib-btn" style="display:none;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;font-weight:700;padding:6px 12px;">⏸ Pause</button>' +
      '<button type="button" id="nicheDiscResumeBtn" class="niche-lib-btn" style="display:none;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;font-weight:700;padding:6px 12px;">▶ Resume</button>' +
      '<button type="button" id="nicheDiscStopBtn" class="niche-lib-btn" style="display:none;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;font-weight:700;padding:6px 12px;">■ Stop</button>' +
      '<span id="nicheDiscProgressText" style="font-size:12px;color:#64748b;font-weight:600;"></span>';
    runBtn.parentNode.insertBefore(bar, runBtn.nextSibling);

    const pauseBtn = document.getElementById('nicheDiscPauseBtn');
    const resumeBtn = document.getElementById('nicheDiscResumeBtn');
    const stopBtn = document.getElementById('nicheDiscStopBtn');
    if (pauseBtn && !pauseBtn._bound) {
      pauseBtn._bound = true;
      pauseBtn.addEventListener('click', async () => {
        // Discover job pause
        await sendMsg({ action: 'NICHE_DISCOVER_PAUSE' });
        // Batch pause
        _batchCtrl.paused = true;
        setDiscoverControls('paused');
        const pt = document.getElementById('nicheDiscProgressText');
        if (pt) pt.textContent = 'Paused — press Resume to continue';
      });
    }
    if (resumeBtn && !resumeBtn._bound) {
      resumeBtn._bound = true;
      resumeBtn.addEventListener('click', async () => {
        await sendMsg({ action: 'NICHE_DISCOVER_RESUME' });
        _batchCtrl.paused = false;
        setDiscoverControls('running');
        const pt = document.getElementById('nicheDiscProgressText');
        if (pt) pt.textContent = 'Resuming…';
      });
    }
    if (stopBtn && !stopBtn._bound) {
      stopBtn._bound = true;
      stopBtn.addEventListener('click', async () => {
        await sendMsg({ action: 'NICHE_DISCOVER_STOP' });
        _batchCtrl.stop = true;
        _batchCtrl.paused = false;
        stopDiscoverPoll();
        _discoverBusy = false;
        setDiscoverControls('idle');
        const pt = document.getElementById('nicheDiscProgressText');
        if (pt) pt.textContent = 'Stopped';
        // Show partial results if any
        const st = await sendMsg({ action: 'NICHE_DISCOVER_STATUS' });
        const host = document.getElementById('nicheResult');
        if (st && st.job && st.job.keywords && st.job.keywords.length && host) {
          renderDiscoverResults(host, {
            seed: st.job.seed,
            queriesRun: st.job.done,
            keywords: st.job.keywords
          });
        }
      });
    }
    return bar;
  }

  async function runDiscover() {
    if (_discoverBusy) return;
    const input = document.getElementById('nicheKeyword');
    const seed = ((input && input.value) || '').trim();
    if (!seed) {
      alert('Enter a seed keyword first');
      return;
    }
    const host = document.getElementById('nicheResult');
    ensureDiscoverControlBar();
    // New search → clear previous discover + competition results so UI starts clean
    clearDiscoverStorage();
    _discoverBusy = true;
    _batchCtrl = { paused: false, stop: false };
    setDiscoverControls('running');
    stopDiscoverPoll();
    stopBatchPoll();

    const renderProgress = (job) => {
      if (!host) return;
      const done = (job && job.done) || 0;
      const total = (job && job.total) || 80;
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
      const count = (job && job.count) || 0;
      const msg = (job && job.message) || 'Starting…';
      const status = (job && job.status) || 'running';
      host.innerHTML =
        '<div style="padding:18px 16px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">' +
            '<div style="font-size:14px;font-weight:800;color:#0f172a;">Discovering keywords</div>' +
            '<div style="font-size:12px;font-weight:700;color:#0D9488;">' + pct + '%</div>' +
          '</div>' +
          '<div style="height:8px;background:#e2e8f0;border-radius:99px;overflow:hidden;margin-bottom:10px;">' +
            '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#0D9488,#14b8a6);transition:width .3s;"></div>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">' +
            '<span style="font-size:11px;padding:4px 8px;border-radius:6px;background:#f1f5f9;color:#334155;font-weight:600;">' + done + ' / ' + total + ' queries</span>' +
            '<span style="font-size:11px;padding:4px 8px;border-radius:6px;background:#ecfdf5;color:#065f46;font-weight:600;">' + count + ' keywords</span>' +
            '<span style="font-size:11px;padding:4px 8px;border-radius:6px;background:#eff6ff;color:#1e40af;font-weight:600;">' + String(status) + '</span>' +
          '</div>' +
          '<div style="font-size:12px;color:#64748b;line-height:1.45;">' + String(msg).replace(/</g, '') + '</div>' +
          '<div style="font-size:11px;color:#94a3b8;margin-top:8px;">Pause or Stop anytime — progress is kept.</div>' +
        '</div>';
    };

    renderProgress({ done: 0, total: 80, count: 0, message: 'Starting…', status: 'running' });
    const pt = document.getElementById('nicheDiscProgressText');
    if (pt) pt.textContent = 'Starting…';

    try {
      const countryEl = document.getElementById('nicheCountry');
      const countryVal = (countryEl && countryEl.value) || 'us|en';
      const [gl, hl] = countryVal.split('|');
      const start = await sendMsg({
        action: 'NICHE_DISCOVER_START',
        seed,
        gl: gl || 'us',
        hl: hl || 'en',
        alphabet: (document.getElementById('nicheDiscAlphabet') || { checked: true }).checked,
        prefixAlphabet: (document.getElementById('nicheDiscPrefix') || { checked: false }).checked,
        modifiers: (document.getElementById('nicheDiscMods') || { checked: true }).checked,
        questions: (document.getElementById('nicheDiscQuestions') || { checked: true }).checked
      });
      if (!start || !start.ok) {
        if (host) {
          host.innerHTML =
            '<div class="niche-empty"><div class="niche-empty-title">Discovery failed</div><p>' +
            (start && start.error ? String(start.error).replace(/</g, '') : 'Could not start') +
            '</p></div>';
        }
        _discoverBusy = false;
        setDiscoverControls('idle');
        return;
      }

      if (pt && start.total) pt.textContent = '0/' + start.total + ' queries';
      renderDiscoverProgress(host, { done: 0, total: start.total || 80, count: 0, message: 'Starting…', status: 'running' });
      attachDiscoverPolling();
    } catch (e) {
      stopDiscoverPoll();
      _discoverBusy = false;
      setDiscoverControls('idle');
      if (host) {
        host.innerHTML = '<div class="niche-empty"><div class="niche-empty-title">Error</div><p>' +
          String(e.message || e).replace(/</g, '') + '</p></div>';
      }
    }
  }

function initNichePopup() {
    if (_initBusy) return;
    _initBusy = true;

    initNicheLibrary();

    const sel = document.getElementById('nicheCountry');
    if (sel && !sel.options.length) {
      COUNTRY_OPTIONS.forEach(([gl, hl, label]) => {
        const opt = document.createElement('option');
        opt.value = gl + '|' + hl;
        opt.textContent = label;
        sel.appendChild(opt);
      });
    }

    const countSel = document.getElementById('nicheMarketCount');
    if (countSel && !countSel._nicheBound) {
      countSel._nicheBound = true;
      // Ensure options include full list size
      const opts = MARKET_COUNT_OPTIONS.slice();
      if (opts.indexOf(MULTI_MARKETS.length) === -1) opts.push(MULTI_MARKETS.length);
      opts.sort((a, b) => a - b);
      countSel.innerHTML = '';
      opts.forEach((n) => {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = n === MULTI_MARKETS.length
          ? ('All countries (' + n + ')')
          : (n + ' countries');
        countSel.appendChild(opt);
      });
      // Restore saved preference or default 12
      void (async () => {
        let saved = MARKET_COUNT_DEFAULT;
        try {
          const r = await storageGet([MARKET_COUNT_KEY]);
          if (r && r[MARKET_COUNT_KEY]) saved = parseInt(r[MARKET_COUNT_KEY], 10) || MARKET_COUNT_DEFAULT;
        } catch (_) {}
        if (saved > MULTI_MARKETS.length) saved = MULTI_MARKETS.length;
        if (opts.indexOf(saved) === -1) saved = MARKET_COUNT_DEFAULT;
        countSel.value = String(saved);
        updateMultiHint();
      })();
      countSel.addEventListener('change', () => {
        updateMultiHint();
        try {
          chrome.storage.local.set({ [MARKET_COUNT_KEY]: getSelectedMarketCount() });
        } catch (_) {}
      });
    }

    const singleBtn = document.getElementById('nicheModeSingle');
    const multiBtn = document.getElementById('nicheModeMulti');
    if (singleBtn && !singleBtn._bound) {
      singleBtn._bound = true;
      singleBtn.addEventListener('click', () => {
        // Don't switch mode while job running
        const stopBtn = document.getElementById('nicheStopBtn');
        if (stopBtn && stopBtn.style.display !== 'none') return;
        setMode('single');
      });
    }
    if (multiBtn && !multiBtn._bound) {
      multiBtn._bound = true;
      multiBtn.addEventListener('click', () => {
        const stopBtn = document.getElementById('nicheStopBtn');
        if (stopBtn && stopBtn.style.display !== 'none') return;
        setMode('multi');
      });
    }
    const discBtn = document.getElementById('nicheModeDiscover');
    if (discBtn && !discBtn._bound) {
      discBtn._bound = true;
      discBtn.addEventListener('click', () => {
        const stopBtn = document.getElementById('nicheStopBtn');
        if (stopBtn && stopBtn.style.display !== 'none') return;
        setMode('discover');
      });
    }

    const btn = document.getElementById('nicheRunBtn');
    if (btn && !btn._nicheBound) {
      btn._nicheBound = true;
      btn.addEventListener('click', () => {
        if (currentMode === 'multi') void runMulti();
        else if (currentMode === 'discover') void runDiscover();
        else void runSingle();
      });
    }
    const stopBtn = document.getElementById('nicheStopBtn');
    if (stopBtn && !stopBtn._nicheBound) {
      stopBtn._nicheBound = true;
      stopBtn.addEventListener('click', () => { void stopNicheJob(); });
    }

    const kw = document.getElementById('nicheKeyword');
    if (kw && !kw._nicheBound) {
      kw._nicheBound = true;
      kw.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (currentMode === 'multi') void runMulti();
          else if (currentMode === 'discover') void runDiscover();
          else void runSingle();
        }
      });
    }

    // Restore running job / last report / history — AFTER bindings, and do NOT reset mode first
    void (async () => {
      try {
        const restored = await restoreNicheState();
        if (!restored) {
          setMode(currentMode || 'multi');
        }
      } catch (_) {
        setMode(currentMode || 'single');
      } finally {
        _initBusy = false;
      }
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNichePopup);
  } else {
    initNichePopup();
  }

  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[data-tab="niche"]');
    if (t) setTimeout(initNichePopup, 40);
  });

  // Also restore when popup becomes visible again (some Chromium builds)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      setTimeout(() => { void restoreNicheState(); }, 80);
    }
  });
})();
