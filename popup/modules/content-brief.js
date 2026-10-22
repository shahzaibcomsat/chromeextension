/**
 * Content Brief from SERP
 * Free: better outline from titles/snippets (no AI).
 * Optional: Improve with AI (NVIDIA / OpenRouter) using already-fetched SERP data.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  let _lastBrief = null; // { keyword, results, analysis, source, plain }

  const STOP = new Set([
    'the','and','for','with','from','your','that','this','what','how','why','are','was','you','our',
    'all','not','but','can','has','have','will','into','more','best','top','free','new','get','use',
    'a','an','of','to','in','on','is','it','or','as','by','at','be','we','do','if','so','than',
    'then','them','they','their','there','these','those','when','where','which','who','whom',
    'about','after','before','between','through','during','under','over','again','further',
    'once','here','also','just','only','other','some','such','very','own','same','than','too',
    'guide','tips','ways','things','list','vs','versus','review','reviews','2023','2024','2025','2026'
  ]);


  async function fetchTextRazorForText(text, url) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        { action: 'TEXTRAZOR_ANALYZE', text: (text || '').slice(0, 120000), url: url || '' },
        r => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r && r.ok ? r : null);
        }
      );
    });
  }

  function buildSemanticGapsHtml(pageTr, serpTr) {
    if (!pageTr && !serpTr) return '';
    const pageEnts = new Set((pageTr?.entities || []).map(e => (e.id || '').toLowerCase()));
    const pageTopics = new Set((pageTr?.topics || []).map(t => (t.label || '').toLowerCase()));
    const serpEnts = (serpTr?.entities || []).filter(e => e.id && !pageEnts.has(e.id.toLowerCase())).slice(0, 12);
    const serpTopics = (serpTr?.topics || []).filter(t => t.label && !pageTopics.has(t.label.toLowerCase())).slice(0, 8);
    const pageOnlyEnts = (pageTr?.entities || []).filter(e => {
      const id = (e.id || '').toLowerCase();
      return id && !(serpTr?.entities || []).some(se => (se.id || '').toLowerCase() === id);
    }).slice(0, 6);

    if (!serpEnts.length && !serpTopics.length && !pageOnlyEnts.length) {
      return `<div style="margin-bottom:12px;"><div style="font-weight:700;margin-bottom:4px;">Semantic gaps (TextRazor)</div>
        <div style="font-size:11px;color:var(--text-3);">Page entities align with SERP themes, or NLP key missing.</div></div>`;
    }
    let html = `<div style="margin-bottom:12px;"><div style="font-weight:700;margin-bottom:4px;">Semantic gaps (TextRazor)</div>`;
    if (serpEnts.length) {
      html += `<div style="font-size:11px;margin-bottom:4px;color:var(--text-3);">Entities on ranking pages but weak/missing here:</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">` +
        serpEnts.map(e => `<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;">${esc(e.id)}</span>`).join('') +
        `</div>`;
    }
    if (serpTopics.length) {
      html += `<div style="font-size:11px;margin-bottom:4px;color:var(--text-3);">Topics competitors cover:</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">` +
        serpTopics.map(t => `<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;">${esc(t.label)}</span>`).join('') +
        `</div>`;
    }
    if (pageOnlyEnts.length) {
      html += `<div style="font-size:11px;margin-bottom:4px;color:var(--text-3);">On your page (less common in SERP top results):</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">` +
        pageOnlyEnts.map(e => `<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:#f5f3ff;border:1px solid #c4b5fd;color:#5b21b6;">${esc(e.id)}</span>`).join('') +
        `</div>`;
    }
    html += `<div style="margin-top:6px;font-size:10px;color:var(--text-3);">Needs TextRazor key. Uses cached page NLP when available.</div></div>`;
    return html;
  }


  async function getRankApi() {
    return new Promise(res => {
      chrome.storage.local.get(['rankApiProvider', 'rankApiKey'], r => {
        res({ provider: r.rankApiProvider || 'serper', apiKey: (r.rankApiKey || '').trim() });
      });
    });
  }

  async function fetchViaSerper(keyword, apiKey) {
    const resp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: keyword, num: 10 }),
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) throw new Error('Serper HTTP ' + resp.status);
    const data = await resp.json();
    return (data.organic || []).slice(0, 10).map((r, i) => ({
      position: r.position || (i + 1),
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || ''
    }));
  }

  async function fetchViaSerpApi(keyword, apiKey) {
    const url = 'https://serpapi.com/search.json?engine=google&num=10'
      + '&q=' + encodeURIComponent(keyword)
      + '&api_key=' + encodeURIComponent(apiKey);
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error('SerpApi HTTP ' + resp.status);
    const data = await resp.json();
    return (data.organic_results || []).slice(0, 10).map((r, i) => ({
      position: r.position || (i + 1),
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || ''
    }));
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error((label || 'Request') + ' timed out after ' + Math.round(ms / 1000) + 's')), ms)
      )
    ]);
  }

  function getBriefMethod() {
    const el = document.querySelector('input[name="briefMethod"]:checked');
    return (el && el.value) || 'auto';
  }

  function getBriefAiProvider() {
    const el = document.querySelector('input[name="briefAiProvider"]:checked');
    return (el && el.value) || 'none';
  }

  async function fetchViaFreeScrape(keyword) {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        resolve({ ok: false, error: 'Google SERP scan timed out (20s)', results: [] });
      }, 20000);
      try {
        chrome.runtime.sendMessage(
          { action: 'SERP_FETCH_PAGE', query: keyword, startOffset: 0 },
          r => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message, results: [] });
              return;
            }
            const list = r?.results || r?.items || [];
            if (r?.ok !== false && Array.isArray(list) && list.length) {
              resolve({
                ok: true,
                source: 'Google SERP (free)',
                results: list.slice(0, 10).map((x, i) => ({
                  position: i + 1,
                  title: x.title || '',
                  url: x.url || x.link || '',
                  snippet: x.snippet || x.description || ''
                }))
              });
            } else {
              resolve({
                ok: false,
                error: r?.error || (r?.__captcha ? 'Google CAPTCHA' : 'No organic results parsed'),
                results: []
              });
            }
          }
        );
      } catch (e) {
        clearTimeout(timer);
        resolve({ ok: false, error: e.message || 'Google scan failed', results: [] });
      }
    });
  }

  /** Free Firecrawl v2 search — no registration / no API key required */
  async function fetchViaFirecrawl(keyword) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ ok: false, error: 'Firecrawl timed out (25s)', results: [] });
      }, 25000);
      try {
        chrome.runtime.sendMessage({
          action: 'FIRECRAWL_SEARCH',
          query: keyword,
          limit: 10
        }, r => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message, results: [] });
            return;
          }
          if (!r || !r.ok) {
            resolve({ ok: false, error: r?.error || 'Firecrawl search failed', results: [] });
            return;
          }
          const rows = r.results || (r.data && r.data.web) || [];
          if (!rows.length) {
            resolve({ ok: false, error: 'Firecrawl returned 0 results', results: [] });
            return;
          }
          resolve({
            ok: true,
            source: r.keyless === false ? 'Firecrawl (auth)' : 'Firecrawl (free)',
            results: rows.slice(0, 10).map((x, i) => ({
              position: x.position || (i + 1),
              title: x.title || '',
              url: x.url || x.link || '',
              snippet: x.description || x.snippet || ''
            }))
          });
        });
      } catch (e) {
        clearTimeout(timer);
        resolve({ ok: false, error: e.message || 'Firecrawl failed', results: [] });
      }
    });
  }

  /** Free TinyFish live search via Monid — no CAPTCHA, no Rank API key */
  async function fetchViaTinyFish(keyword) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ ok: false, error: 'TinyFish timed out (35s)', results: [] });
      }, 35000);
      try {
        chrome.runtime.sendMessage({
          action: 'MONID_RUN',
          provider: 'tinyfish',
          endpoint: '/search',
          query: {
            query: keyword,
            purpose: 'SERP content brief — titles, URLs, and snippets for SEO outline',
            location: 'US',
            language: 'en',
            page: 0
          },
          waitMs: 30000
        }, r => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message, results: [] });
            return;
          }
          if (!r || !r.ok) {
            resolve({ ok: false, error: r?.error || r?.status || 'TinyFish failed', results: [] });
            return;
          }
          const out = r.output || r.data?.output || r.data || {};
          const rows = out.results || out.items || [];
          if (!rows.length) {
            resolve({ ok: false, error: 'TinyFish returned 0 results', results: [] });
            return;
          }
          resolve({
            ok: true,
            source: 'TinyFish (free)',
            results: rows.slice(0, 10).map((x, i) => ({
              position: x.position || (i + 1),
              title: x.title || '',
              url: x.url || '',
              snippet: x.snippet || ''
            }))
          });
        });
      } catch (e) {
        clearTimeout(timer);
        resolve({ ok: false, error: e.message || 'TinyFish failed', results: [] });
      }
    });
  }

  function setBriefStatus(msg) {
    const loading = $('briefLoading');
    const textEl = $('briefLoadingText');
    if (loading) loading.style.display = '';
    if (textEl) textEl.textContent = msg || 'Building brief…';
    else if (loading) loading.innerHTML = '<svg class="t-domain-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> <span id="briefLoadingText">' + (msg || 'Building brief…') + '</span>';
  }

  /**
   * Fetch SERP results according to radio selection.
   * auto: Serper (if key) → TinyFish → Google SERP → Firecrawl
   * google / tinyfish / firecrawl / serper: force that path only
   * Fallback failures are silent (console.debug) so Chrome Errors panel stays clean.
   */
  async function fetchSerpResults(keyword, method) {
    const mode = method || getBriefMethod() || 'auto';
    const api = await getRankApi();
    const errors = [];

    const tryApi = async () => {
      if (!api.apiKey) throw new Error('No Rank API key in Settings → Rank Tracking API');
      setBriefStatus('Fetching SERP via ' + (api.provider === 'serpapi' ? 'SerpApi' : 'Serper') + '…');
      if (api.provider === 'serpapi') {
        const results = await withTimeout(fetchViaSerpApi(keyword, api.apiKey), 18000, 'SerpApi');
        if (results.length) return { ok: true, source: 'SerpApi', results };
        throw new Error('SerpApi returned 0 results');
      }
      const results = await withTimeout(fetchViaSerper(keyword, api.apiKey), 18000, 'Serper');
      if (results.length) return { ok: true, source: 'Serper', results };
      throw new Error('Serper returned 0 results');
    };

    const tryTinyFish = async () => {
      setBriefStatus('Fetching SERP via TinyFish…');
      const tf = await fetchViaTinyFish(keyword);
      if (tf.ok && tf.results?.length) return tf;
      throw new Error(tf.error || 'TinyFish failed');
    };

    const tryFirecrawl = async () => {
      setBriefStatus('Fetching SERP via Firecrawl (free)…');
      const fc = await fetchViaFirecrawl(keyword);
      if (fc.ok && fc.results?.length) return fc;
      throw new Error(fc.error || 'Firecrawl failed');
    };

    const tryGoogle = async () => {
      setBriefStatus('Scanning Google SERP (background tab)…');
      const g = await fetchViaFreeScrape(keyword);
      if (g.ok && g.results?.length) return g;
      throw new Error(g.error || 'Google SERP parse failed');
    };

    if (mode === 'serper') {
      try {
        return await tryApi();
      } catch (e) {
        return { ok: false, error: e.message || 'API failed', results: [] };
      }
    }
    if (mode === 'tinyfish') {
      try {
        return await tryTinyFish();
      } catch (e) {
        return { ok: false, error: e.message || 'TinyFish failed', results: [] };
      }
    }
    if (mode === 'firecrawl') {
      try {
        return await tryFirecrawl();
      } catch (e) {
        return { ok: false, error: e.message || 'Firecrawl failed', results: [] };
      }
    }
    if (mode === 'google') {
      try {
        return await tryGoogle();
      } catch (e) {
        return { ok: false, error: e.message || 'Google scan failed', results: [] };
      }
    }

    // auto: API → TinyFish → Google → Firecrawl last
    // (Firecrawl free tier often blocks VPN/proxy IPs — keep it last and silent on fail)
    const softFail = (label, e) => {
      const msg = (e && e.message) ? e.message : String(e || 'failed');
      errors.push(label + ': ' + msg);
      // String-only debug — never pass Error objects (Chrome Errors panel treats those as extension errors)
      try { console.debug('[ContentBrief] ' + label + ' skipped:', msg.slice(0, 160)); } catch (_) {}
    };

    if (api.apiKey) {
      try {
        return await tryApi();
      } catch (e) {
        softFail('API', e);
      }
    }
    try {
      return await tryTinyFish();
    } catch (e) {
      softFail('TinyFish', e);
    }
    try {
      return await tryGoogle();
    } catch (e) {
      softFail('Google', e);
    }
    try {
      return await tryFirecrawl();
    } catch (e) {
      softFail('Firecrawl', e);
    }
    return {
      ok: false,
      error: errors.length ? errors.join(' · ') : 'All SERP sources failed',
      results: []
    };
  }

  function tokenize(text) {
    return String(text || '').toLowerCase()
      .replace(/[^a-z0-9\s\-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
  }

  /** Bigrams/trigrams from titles — better than single words for outline */
  function extractPhrases(results) {
    const phraseCount = {};
    const wordCount = {};
    results.forEach(r => {
      const words = tokenize(r.title + ' ' + (r.snippet || ''));
      words.forEach(w => { wordCount[w] = (wordCount[w] || 0) + 1; });
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i <= words.length - n; i++) {
          const ph = words.slice(i, i + n).join(' ');
          if (ph.length < 6) continue;
          phraseCount[ph] = (phraseCount[ph] || 0) + 1;
        }
      }
    });
    const phrases = Object.entries(phraseCount)
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .slice(0, 12)
      .map(([term, count]) => ({ term, count }));
    const words = Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([term, count]) => ({ term, count }));
    return { phrases, words };
  }

  /** Title patterns → H2-style sections (no single-letter keyword splits) */
  function buildOutline(keyword, results, phrases) {
    const kw = keyword.trim();
    const sections = [];
    const seen = new Set();
    const add = (s) => {
      const k = s.toLowerCase().trim();
      if (!k || seen.has(k) || k.length < 8) return;
      seen.add(k);
      sections.push(s.trim());
    };

    add(`What is ${kw}? (definition for beginners)`);
    add(`Why ${kw} matters in 2026`);

    // From competitor titles: keep human-readable patterns
    results.slice(0, 8).forEach(r => {
      let t = (r.title || '').replace(/\s*[\|\-–—].*$/, '').trim();
      t = t.replace(/\s*[\(\[]\d{4}[\)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
      // Skip if almost only the keyword
      if (t.toLowerCase() === kw.toLowerCase()) return;
      if (t.length > 12 && t.length < 90) add(t);
    });

    phrases.slice(0, 5).forEach(p => {
      const titleCase = p.term.replace(/\b\w/g, c => c.toUpperCase());
      add(`${titleCase}: what to know`);
    });

    add(`How to get started with ${kw}`);
    add(`Best practices & common mistakes`);
    add(`Tools and examples`);
    add(`FAQ about ${kw}`);

    return sections.slice(0, 12);
  }

  function detectIntent(keyword, results) {
    const blob = (keyword + ' ' + results.map(r => r.title).join(' ')).toLowerCase();
    if (/\b(buy|price|cost|cheap|best|review|vs|versus)\b/.test(blob)) return 'Commercial / comparison';
    if (/\b(how to|tutorial|guide|steps|learn)\b/.test(blob)) return 'Informational / how-to';
    if (/\b(what is|definition|meaning)\b/.test(blob)) return 'Informational / definition';
    if (/\b(near me|location|hours)\b/.test(blob)) return 'Local';
    return 'Informational / mixed';
  }

  function normalizePageAnalysis(pa) {
    // Accept raw content.js shape, adapted popup shape, or window._rawData
    const src = pa || (typeof window !== 'undefined' ? window._rawData : null) || {};
    const meta = src.meta || {};
    const title =
      (typeof src.title === 'string' && src.title) ||
      src.title?.content ||
      meta.title ||
      src.technical?.title ||
      '';
    const desc =
      (typeof src.metaDescription === 'string' && src.metaDescription) ||
      src.metaDescription?.content ||
      meta.desc ||
      meta.description ||
      '';
    let h2 = [];
    if (src.headings?.structure?.h2) {
      h2 = src.headings.structure.h2.map(h => h.text || h).filter(Boolean);
    } else if (Array.isArray(src.headings?.headings)) {
      h2 = src.headings.headings.filter(h => h.level === 2 || h.tag === 'h2').map(h => h.text || '').filter(Boolean);
    } else if (Array.isArray(src.headings)) {
      h2 = src.headings.filter(h => (h.level === 2 || h.tag === 'h2')).map(h => h.text || h).filter(Boolean);
    }
    const wc =
      src.content?.wordCount ||
      src.wordCount ||
      src.keywords?.totalWords ||
      src.keywords?.wordCount ||
      0;
    return { title, desc, h2, wc };
  }

  function buildBriefHtml(keyword, results, pageAnalysis, source) {
    const { phrases, words } = extractPhrases(results);
    const outline = buildOutline(keyword, results, phrases);
    const intent = detectIntent(keyword, results);
    const page = normalizePageAnalysis(pageAnalysis);
    const pageTitle = page.title;
    const pageMeta = page.desc;
    const pageH2 = page.h2;
    const wc = page.wc;
    const pageBlob = (pageTitle + ' ' + pageMeta + ' ' + pageH2.join(' ')).toLowerCase();
    const missingPhrases = phrases.filter(p => !pageBlob.includes(p.term));
    const missingWords = words.filter(w => !pageBlob.includes(w.term)).slice(0, 8);

    let html = `<div style="margin-bottom:8px;font-size:11px;color:var(--text-3);">
      <strong>Keyword:</strong> ${esc(keyword)} · <strong>${results.length}</strong> results ·
      Intent: <strong>${esc(intent)}</strong> · Source: <strong>${esc(source || 'SERP')}</strong>
      ${source && source.indexOf('Free') >= 0 ? ' <span style="color:#b45309;">(no API key)</span>' : ''}
    </div>`;

    html += `<div style="margin-bottom:12px;"><div style="font-weight:700;margin-bottom:4px;">Suggested content outline</div><ol style="margin:0;padding-left:18px;">`;
    outline.forEach(s => { html += `<li style="margin-bottom:3px;">${esc(s)}</li>`; });
    html += `</ol></div>`;

    html += `<div style="margin-bottom:12px;"><div style="font-weight:700;margin-bottom:4px;">Top SERP results</div>
      <div style="max-height:240px;overflow:auto;border:1px solid var(--border-1,#e2e8f0);border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead><tr style="text-align:left;color:var(--text-3);border-bottom:1px solid var(--border-1,#e2e8f0);background:var(--surface1,#f8fafc);position:sticky;top:0;">
        <th style="padding:6px 4px;">#</th>
        <th style="padding:6px 4px;">Title / Description / URL</th>
      </tr></thead><tbody>`;
    results.forEach(r => {
      let host = '';
      try { host = new URL(r.url).hostname.replace(/^www\./,''); } catch { host = r.url; }
      html += `<tr style="border-bottom:1px solid var(--border-1,#e2e8f0);vertical-align:top;">
        <td style="padding:6px 4px;color:var(--text-3);">${r.position}</td>
        <td style="padding:6px 4px;">
          <div style="font-weight:600;color:var(--text-1);">${esc(r.title).slice(0, 120)}</div>
          ${r.snippet ? `<div style="color:var(--text-3);margin-top:2px;line-height:1.35;">${esc(r.snippet).slice(0, 200)}</div>` : ''}
          <div style="margin-top:2px;"><a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:#0D9488;font-size:10px;word-break:break-all;">${esc(host)}</a></div>
        </td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;

    html += `<div style="margin-bottom:12px;"><div style="font-weight:700;margin-bottom:4px;">Themes in SERP (phrases)</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">`;
    (phrases.length ? phrases : words).slice(0, 12).forEach(t => {
      const miss = (phrases.length ? missingPhrases : missingWords).some(m => m.term === t.term);
      html += `<span style="font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid ${miss ? '#fde68a' : '#a7f3d0'};background:${miss ? '#fffbeb' : '#ecfdf5'};color:${miss ? '#92400e' : '#065f46'};">${esc(t.term)} ×${t.count}${miss ? ' · gap' : ''}</span>`;
    });
    html += `</div></div>`;

    html += `<div style="margin-bottom:12px;"><div style="font-weight:700;margin-bottom:4px;">Gaps vs this page</div><ul style="margin:0;padding-left:18px;">`;
    html += `<li>Title: <strong>${pageTitle ? esc(pageTitle).slice(0, 90) : '—'}</strong></li>`;
    html += `<li>Word count: <strong>${wc || '—'}</strong>${wc && wc < 900 ? ' — many ranking pages use 1,000+ words' : ''}</li>`;
    html += `<li>H2 count: <strong>${pageH2.length}</strong></li>`;
    if (missingPhrases.length || missingWords.length) {
      const miss = (missingPhrases.length ? missingPhrases : missingWords).slice(0, 8).map(t => t.term).join(', ');
      html += `<li>Missing themes: <strong>${esc(miss)}</strong></li>`;
    } else {
      html += `<li>Coverage looks aligned with common SERP themes.</li>`;
    }
    html += `</ul></div>`;

    html += `<div style="font-size:11px;color:var(--text-3);line-height:1.4;">
      Built from SERP titles &amp; descriptions — no AI required.
      Optional: click <strong>Improve with AI</strong> to expand this into a full brief (needs AI key in Settings).
    </div>`;
    return html;
  }

  function briefToPrompt(brief) {
    const lines = [];
    lines.push('You are an expert SEO content strategist. Improve and expand this content brief.');
    lines.push('Use ONLY the SERP evidence provided. Do not invent rankings or volumes.');
    lines.push('DATE CONTEXT: September 2026. Do not write 2023, 2024, or 2025 in titles/meta/outline. Prefer 2026 or omit the year.');
    lines.push('');
    lines.push('TARGET KEYWORD: ' + brief.keyword);
    lines.push('SOURCE: ' + (brief.source || 'SERP'));
    lines.push('');
    lines.push('SERP RESULTS:');
    brief.results.forEach(r => {
      lines.push(`${r.position}. ${r.title}`);
      if (r.snippet) lines.push('   ' + r.snippet);
      lines.push('   URL: ' + r.url);
    });
    lines.push('');
    if (brief.analysis) {
      lines.push('CURRENT PAGE:');
      lines.push('Title: ' + (brief.analysis.title?.content || '—'));
      lines.push('Meta: ' + (brief.analysis.metaDescription?.content || '—'));
      lines.push('Word count: ' + (brief.analysis.content?.wordCount || '—'));
      const h2 = (brief.analysis.headings?.structure?.h2 || []).map(h => h.text || h).filter(Boolean);
      if (h2.length) lines.push('H2s: ' + h2.slice(0, 12).join(' | '));
    }
    lines.push('');
    lines.push('Write an improved content brief with these EXACT section headings:');
    lines.push('## 1. Search Intent');
    lines.push('## 2. Title and Meta');
    lines.push('Use lines: Title: ...');
    lines.push('Meta: ...');
    lines.push('## 3. Outline (H2 / H3)');
    lines.push('Numbered list, 8-12 items, specific not generic');
    lines.push('## 4. Must-cover topics');
    lines.push('Bullet list from SERP');
    lines.push('## 5. Content gaps vs current page');
    lines.push('Bullet list');
    lines.push('## 6. FAQ');
    lines.push('5 questions as bullets');
    lines.push('## 7. Word count');
    lines.push('One line range');
    if (brief.serpTr?.entities?.length || brief.pageTr?.entities?.length) {
      lines.push('');
      lines.push('TEXTRAZOR SEMANTIC SIGNALS:');
      if (brief.serpTr?.entities?.length) {
        lines.push('SERP entities: ' + brief.serpTr.entities.slice(0, 15).map(e => e.id).join(', '));
      }
      if (brief.serpTr?.topics?.length) {
        lines.push('SERP topics: ' + brief.serpTr.topics.slice(0, 10).map(t => t.label).join(', '));
      }
      if (brief.pageTr?.entities?.length) {
        lines.push('Page entities: ' + brief.pageTr.entities.slice(0, 15).map(e => e.id).join(', '));
      }
      lines.push('Call out entity/topic gaps explicitly in the brief.');
    }
    lines.push('Use simple clear English. No pipe tables. Be practical and specific.');
    return lines.join('\n');
  }

  // Built-in Groq key (same as popup.js). User key in Settings always wins.
  const CB_BUILTIN_GROQ_KEY = '';
  const CB_BUILTIN_GROQ_MODEL = 'qwen/qwen3.8-27b';

  /**
   * @param {string} prompt
   * @param {string} [forceProvider] - none|groq|grok|nvidia|openrouter — from Content Brief radios
   */
  async function callAI(prompt, forceProvider) {
    // Support all ShahzaibSEO AI providers: Grok (xAI), Groq, NVIDIA, OpenRouter
    // Groq has a built-in fallback so Improve with AI works out of the box.
    const aiKeys = await new Promise(res =>
      chrome.storage.local.get([
        'nvidiaApiKey', 'openrouterApiKey', 'groqApiKey', 'grokApiKey',
        'aiProvider', 'nvidiaModel', 'openrouterModel', 'groqModel', 'grokModel', 'aiMaxTokens'
      ], res)
    );

    // Also check main AI config (localStorage) used by AI Chat
    let mainCfg = null;
    try {
      const raw = localStorage.getItem('rankseo_ai_config') || localStorage.getItem('aiConfig');
      if (raw) mainCfg = JSON.parse(raw);
    } catch (_) {}

    const userGroq = (aiKeys.groqApiKey || (mainCfg?.provider === 'groq' ? mainCfg.apiKey : '') || '').trim();
    const effectiveGroq = userGroq || CB_BUILTIN_GROQ_KEY;

    let provider = (forceProvider && forceProvider !== 'none')
      ? forceProvider
      : (aiKeys.aiProvider || mainCfg?.provider || '');
    if (!provider || provider === 'none') {
      // Prefer Groq (built-in or user) — fast free tier
      if (effectiveGroq) provider = 'groq';
      else if (aiKeys.nvidiaApiKey) provider = 'nvidia';
      else if (aiKeys.openrouterApiKey) provider = 'openrouter';
      else if (aiKeys.grokApiKey || mainCfg?.provider === 'grok') provider = 'grok';
      else if (mainCfg?.apiKey) provider = mainCfg.provider || 'nvidia';
    }

    let apiKey, model, baseUrl, extraHeaders = {};

    if (provider === 'grok' || provider === 'xai') {
      apiKey = aiKeys.grokApiKey || (mainCfg?.provider === 'grok' ? mainCfg.apiKey : '') || mainCfg?.apiKey;
      model = aiKeys.grokModel || mainCfg?.model || 'grok-3';
      baseUrl = 'https://api.x.ai/v1';
      if (!apiKey) throw new Error('Add Grok (xAI) API key in Settings → AI');
    } else if (provider === 'groq') {
      apiKey = effectiveGroq;
      model = aiKeys.groqModel || mainCfg?.model || CB_BUILTIN_GROQ_MODEL;
      baseUrl = 'https://api.groq.com/openai/v1';
    } else if (provider === 'nvidia') {
      apiKey = aiKeys.nvidiaApiKey || (mainCfg?.provider === 'nvidia' ? mainCfg.apiKey : '');
      model = aiKeys.nvidiaModel || mainCfg?.model || 'meta/llama-3.3-70b-instruct';
      baseUrl = 'https://integrate.api.nvidia.com/v1';
      if (!apiKey) throw new Error('Add NVIDIA API key in Settings → AI');
    } else if (provider === 'openrouter') {
      apiKey = aiKeys.openrouterApiKey || (mainCfg?.provider === 'openrouter' ? mainCfg.apiKey : '');
      model = aiKeys.openrouterModel || mainCfg?.model || 'meta-llama/llama-3.3-70b-instruct:free';
      baseUrl = 'https://openrouter.ai/api/v1';
      extraHeaders = {
        'HTTP-Referer': 'https://www.mubashirhassan.com',
        'X-Title': 'ShahzaibSEO - AEO & GEO Expert'
      };
      if (!apiKey) throw new Error('Add OpenRouter API key in Settings → AI');
    } else {
      // Unknown → Groq built-in
      provider = 'groq';
      apiKey = effectiveGroq;
      model = aiKeys.groqModel || CB_BUILTIN_GROQ_MODEL;
      baseUrl = 'https://api.groq.com/openai/v1';
    }

    // Final fallback: always try built-in Groq if nothing else configured
    if (!apiKey && effectiveGroq) {
      provider = 'groq';
      apiKey = effectiveGroq;
      model = aiKeys.groqModel || CB_BUILTIN_GROQ_MODEL;
      baseUrl = 'https://api.groq.com/openai/v1';
    }

    if (!apiKey) {
      throw new Error('Add Grok (xAI), Groq, NVIDIA, or OpenRouter API key in Settings → AI');
    }

    const resp = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        ...extraHeaders
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are an expert SEO content strategist. Write practical content briefs from SERP evidence. Use clear markdown headings and short bullets. Simple English. Current context: September 2026 - never use years 2023/2024/2025 in titles or copy; prefer 2026 or omit the year.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: parseInt(aiKeys.aiMaxTokens || mainCfg?.maxTokens, 10) || 2500,
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(90000)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error?.message || data?.message || ('AI HTTP ' + resp.status + ' [' + provider + ']'));
    }
    return data?.choices?.[0]?.message?.content || '';
  }

  /**
   * Beautiful structured HTML for AI content brief (cards, lists, title/meta grid).
   */
  function simpleMarkdownToHtml(md) {
    let text = String(md || '').replace(/\r\n/g, '\n').trim();
    // Normalize common heading styles
    text = text.replace(/^#{1,3}\s+/gm, '## ');
    text = text.replace(/^\*\*(.+?)\*\*\s*$/gm, '## $1');

    const lines = text.split('\n');
    const parts = [];
    let inList = false;

    function flushList() {
      if (inList) {
        parts.push('</div>');
        inList = false;
      }
    }

    lines.forEach((line) => {
      const t = line.trim();
      if (!t) {
        flushList();
        return;
      }

      // Headings
      let m;
      if ((m = t.match(/^##\s+(.+)$/)) || (m = t.match(/^#\s+(.+)$/))) {
        flushList();
        parts.push(
          '<div style="font-weight:800;margin:14px 0 8px;font-size:13px;color:#5b21b6;border-bottom:1px solid #ede9fe;padding-bottom:4px;">' +
            esc(m[1].replace(/^\d+\.\s*/, '')) +
            '</div>'
        );
        return;
      }

      // Title: / Meta: labeled rows
      if (/^(Title|Meta|Meta Description|H1|Word count|Intent)\s*:/i.test(t)) {
        flushList();
        const idx = t.indexOf(':');
        const label = t.slice(0, idx).trim();
        const val = t.slice(idx + 1).trim();
        parts.push(
          '<div style="display:grid;grid-template-columns:100px 1fr;gap:8px;padding:8px 10px;margin:4px 0;border:1px solid #ede9fe;border-radius:8px;background:#faf5ff;font-size:12px;">' +
            '<div style="font-weight:700;color:#7c3aed;">' + esc(label) + '</div>' +
            '<div style="color:#0f172a;">' + esc(val).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') + '</div></div>'
        );
        return;
      }

      // Lists
      if (/^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) {
        if (!inList) {
          parts.push(
            '<div style="margin:6px 0 10px;border:1px solid #e9e5ff;border-radius:10px;overflow:hidden;background:#fff;">'
          );
          inList = true;
        }
        const num = t.match(/^(\d+)\.\s+/);
        let body = t.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
        body = esc(body).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        parts.push(
          '<div style="padding:7px 12px;border-bottom:1px solid #f5f3ff;font-size:12px;line-height:1.45;">' +
            (num
              ? '<strong style="color:#7c3aed;margin-right:6px;">' + num[1] + '.</strong>'
              : '<span style="color:#a78bfa;margin-right:6px;">•</span>') +
            body +
            '</div>'
        );
        return;
      }

      flushList();
      let para = esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      parts.push(
        '<div style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#334155;">' + para + '</div>'
      );
    });
    flushList();
    return parts.join('');
  }

  function formatBriefPlain(md) {
    let t = String(md || '').replace(/\r\n/g, '\n').trim();
    t = t.replace(/\n{3,}/g, '\n\n');
    return t;
  }

  async function improveWithAI(forceProvider) {
    if (!_lastBrief || !_lastBrief.results?.length) {
      if (typeof toast === 'function') toast('Extract SERP & build a brief first');
      return;
    }
    const provider = forceProvider || getBriefAiProvider();
    if (provider === 'none') {
      if (typeof toast === 'function') toast('Pick an AI provider (Groq / Grok / NVIDIA / OpenRouter)');
      return;
    }
    const out = $('briefOutput');
    const btn = $('briefAiBtn');
    const loading = $('briefLoading');
    if (btn) btn.disabled = true;
    const labels = { groq: 'Groq', grok: 'Grok', nvidia: 'NVIDIA', openrouter: 'OpenRouter' };
    setBriefStatus('Improving brief with ' + (labels[provider] || provider) + '…');
    try {
      const prompt = briefToPrompt(_lastBrief);
      const text = await callAI(prompt, provider);
      if (!text) throw new Error('Empty AI response');
      const plain = formatBriefPlain(text);
      const html =
        '<div style="margin-bottom:10px;padding:8px 12px;border-radius:10px;background:linear-gradient(135deg,#f5f3ff,#fae8ff);border:1px solid #e9d5ff;font-size:11px;color:#6b21a8;font-weight:600;">' +
        '✦ AI Content Brief · ' + esc(labels[provider] || provider) + ' · keyword: ' + esc(_lastBrief.keyword || '') +
        '</div>' +
        simpleMarkdownToHtml(text) +
        '<div style="margin-top:12px;font-size:11px;color:var(--text-3);">Built from SERP evidence. Review before publishing.</div>';
      if (out) {
        out.style.display = '';
        out.innerHTML = html;
        out.dataset.plain = plain;
      }
      if (_lastBrief) _lastBrief.plain = plain;
      if (typeof toast === 'function') toast('Brief improved with ' + (labels[provider] || provider));
    } catch (e) {
      if (typeof toast === 'function') toast(e.message || 'AI failed');
      else alert(e.message || 'AI failed');
    } finally {
      if (btn) btn.disabled = false;
      if (loading) loading.style.display = 'none';
    }
  }

  async function runBrief() {
    const keyword = ($('briefKeywordInput')?.value || '').trim();
    if (!keyword) {
      if (typeof toast === 'function') toast('Enter a keyword');
      return;
    }
    const method = getBriefMethod();
    const loading = $('briefLoading');
    const out = $('briefOutput');
    const copyBtn = $('briefCopyBtn');
    const aiBtn = $('briefAiBtn');
    const runBtn = $('briefRunBtn');
    setBriefStatus(
      method === 'google' ? 'Scanning Google SERP…'
        : method === 'tinyfish' ? 'Fetching via TinyFish…'
        : method === 'serper' ? 'Fetching via Rank API…'
        : 'Building brief…'
    );
    if (out) out.style.display = 'none';
    if (copyBtn) copyBtn.style.display = 'none';
    if (aiBtn) aiBtn.style.display = 'none';
    if (runBtn) runBtn.disabled = true;

    try {
      const pack = await fetchSerpResults(keyword, method);
      let analysis = null;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          analysis = await new Promise(res => {
            const t = setTimeout(() => res(null), 4000);
            chrome.tabs.sendMessage(tab.id, { action: 'getAnalysis' }, r => {
              clearTimeout(t);
              if (chrome.runtime.lastError) res(null);
              else res(r?.data || r || null);
            });
          });
        }
      } catch (_) {}
      if (window._rawData) analysis = analysis || window._rawData;
      if (!analysis && typeof _rawData !== 'undefined') analysis = _rawData;

      if (!pack.ok || !pack.results?.length) {
        if (out) {
          out.style.display = '';
          const tips = method === 'google'
            ? '<li>Reload extension after the Rank Tracker /goto fix</li><li>Dismiss Google CAPTCHA if a background tab opened</li><li>Try <strong>TinyFish</strong> or add Serper key</li>'
            : method === 'tinyfish'
            ? '<li>Check Settings → Monid is connected</li><li>Try <strong>Google SERP</strong> or Serper</li>'
            : method === 'serper'
            ? '<li>Add Serper.dev / SerpApi key in Settings → Rank Tracking API</li><li>Or switch source to Auto / TinyFish / Google</li>'
            : '<li>Try <strong>Google SERP</strong> or <strong>TinyFish</strong> radio</li><li>Check Monid connection for TinyFish</li><li>Or add Serper in Settings → Rank Tracking API</li>';
          out.innerHTML = `<div style="color:#b45309;line-height:1.45;">
            <strong>Could not read SERP results</strong> (source: ${esc(method)}).
            <ul style="margin:6px 0 0;padding-left:18px;">${tips}</ul>
            ${pack.error ? '<div style="margin-top:6px;font-size:11px;opacity:.85;">Detail: ' + esc(pack.error) + '</div>' : ''}
          </div>`;
        }
        return;
      }

      setBriefStatus('Building outline…');
      let html = buildBriefHtml(keyword, pack.results, analysis, pack.source);

      // Phase 3: semantic gaps via TextRazor (page cache + SERP titles/snippets)
      try {
        const pageTr = (typeof window !== 'undefined' && window._textRazorData && window._textRazorData.ok)
          ? window._textRazorData
          : await fetchTextRazorForText(
              [
                analysis?.title?.content || '',
                analysis?.metaDescription?.content || '',
                (analysis?.content?.text || analysis?.content?.bodyText || '').slice(0, 80000)
              ].join('\n'),
              (typeof _currentUrl !== 'undefined' ? _currentUrl : '')
            );
        const serpBlob = pack.results.map(r => `${r.title}\n${r.snippet || ''}`).join('\n\n');
        const serpTr = await fetchTextRazorForText(serpBlob, '');
        const semHtml = buildSemanticGapsHtml(pageTr, serpTr);
        if (semHtml) html += semHtml;
        _lastBrief = {
          keyword, results: pack.results, analysis, source: pack.source,
          pageTr, serpTr
        };
      } catch (_) {
        _lastBrief = { keyword, results: pack.results, analysis, source: pack.source };
      }

      if (out) {
        out.style.display = '';
        out.innerHTML = html;
        out.dataset.plain = out.innerText;
        _lastBrief.plain = out.dataset.plain;
      }
      if (copyBtn) copyBtn.style.display = '';
      if (aiBtn) aiBtn.style.display = '';

      // Step 3: auto-expand with selected AI provider (if not Free)
      const aiProv = getBriefAiProvider();
      if (aiProv && aiProv !== 'none') {
        await improveWithAI(aiProv);
      }
    } catch (err) {
      if (out) {
        out.style.display = '';
        out.innerHTML = `<div style="color:#b45309;"><strong>Brief failed:</strong> ${esc(err.message || 'unknown error')}</div>`;
      }
      if (typeof toast === 'function') toast(err.message || 'Brief failed');
    } finally {
      if (loading) loading.style.display = 'none';
      if (runBtn) runBtn.disabled = false;
    }
  }

  function init() {
    const runBtn = $('briefRunBtn');
    const copyBtn = $('briefCopyBtn');
    const aiBtn = $('briefAiBtn');
    if (runBtn && !runBtn.dataset.bound) {
      runBtn.dataset.bound = '1';
      runBtn.addEventListener('click', runBrief);
    }
    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = '1';
      copyBtn.addEventListener('click', () => {
        const out = $('briefOutput');
        let text = (out && out.dataset && out.dataset.plain) || (_lastBrief && _lastBrief.plain) || '';
        if (!text && out) text = out.innerText || '';
        text = String(text || '').trim();
        if (!text) {
          if (typeof toast === 'function') toast('Nothing to copy');
          return;
        }
        // Prefer clean markdown; if only innerText, tidy extra blank lines
        text = text.replace(/\n{3,}/g, '\n\n');
        navigator.clipboard.writeText(text).then(() => {
          if (typeof toast === 'function') toast('Brief copied');
        }).catch(() => {
          if (typeof toast === 'function') toast('Copy failed');
        });
      });
    }
    if (aiBtn && !aiBtn.dataset.bound) {
      aiBtn.dataset.bound = '1';
      aiBtn.addEventListener('click', () => improveWithAI());
    }
    // Restore + persist SERP source + AI provider radios
    try {
      chrome.storage.local.get(['briefSerpMethod', 'briefAiProvider'], res => {
        const m = res.briefSerpMethod || 'auto';
        const radio = document.querySelector('input[name="briefMethod"][value="' + m + '"]');
        if (radio) radio.checked = true;
        const ap = res.briefAiProvider || 'none';
        const ar = document.querySelector('input[name="briefAiProvider"][value="' + ap + '"]');
        if (ar) ar.checked = true;
      });
    } catch (_) {}
    document.querySelectorAll('input[name="briefMethod"]').forEach(r => {
      if (r.dataset.bound) return;
      r.dataset.bound = '1';
      r.addEventListener('change', () => {
        try { chrome.storage.local.set({ briefSerpMethod: r.value }); } catch (_) {}
      });
    });
    document.querySelectorAll('input[name="briefAiProvider"]').forEach(r => {
      if (r.dataset.bound) return;
      r.dataset.bound = '1';
      r.addEventListener('change', () => {
        try { chrome.storage.local.set({ briefAiProvider: r.value }); } catch (_) {}
      });
    });
    const input = $('briefKeywordInput');
    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') runBrief();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
