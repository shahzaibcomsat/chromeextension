/**
 * niche-engine.js  —  ShahzaibSEO Niche Opportunity engine (v2)
 * --------------------------------------------------------------------------
 * Pure scoring for beginner niche ease from live / fetched SERP data.
 * 100% free — no paid APIs required.
 *
 * Inputs per competitor: domain, url, da?, dr?, traffic?, ageYears?, serpPosition?
 * Output: YES / MAYBE / NO, score 0–100, type, DR buckets, homepages, reasons.
 *
 * Namespace: RSNiche
 */
(function (global) {
  'use strict';

  const CONSTANTS = {
    MIN_VOLUME: 40000,
    MIN_LOW_DA_COUNT: 2,
    LOW_AUTH_THRESHOLD: 20,   // DR or DA under this = weak
    MID_AUTH_MIN: 20,
    MID_AUTH_MAX: 50,
  };

  function parseScoreValue(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const str = String(val).toUpperCase().replace(/,/g, '');
    if (str.includes('M')) return parseFloat(str) * 1000000;
    if (str.includes('K')) return parseFloat(str) * 1000;
    return parseFloat(str) || 0;
  }

  function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '—';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(Math.round(num));
  }

  /** Prefer DR, else DA, as authority score */
  function authOf(c) {
    if (!c) return null;
    if (typeof c.dr === 'number') return c.dr;
    if (typeof c.da === 'number') return c.da;
    return null;
  }

  function isHomepage(c) {
    if (!c) return false;
    if (c.isHomepage === true) return true;
    const url = c.url || c.href || '';
    if (!url) return false;
    try {
      const u = new URL(url.startsWith('http') ? url : 'https://' + url);
      const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
      return path === '/' || path === '';
    } catch (_) {
      return false;
    }
  }

  function selectBestCompetitor(competitors) {
    const weak = (competitors || []).filter(c => {
      const a = authOf(c);
      return a !== null && a < CONSTANTS.LOW_AUTH_THRESHOLD;
    });
    if (weak.length === 0) return null;

    let maxTraffic = 1;
    weak.forEach(c => {
      const t = parseScoreValue(c.traffic);
      if (t > maxTraffic) maxTraffic = t;
    });

    let bestScore = -1;
    let best = null;
    weak.forEach(c => {
      const trafficVal = parseScoreValue(c.traffic);
      const trafficScore = (trafficVal / maxTraffic) * 50;
      const a = authOf(c) || 0;
      const authScore = ((CONSTANTS.LOW_AUTH_THRESHOLD - a) / CONSTANTS.LOW_AUTH_THRESHOLD) * 40;
      const homeBonus = isHomepage(c) ? 10 : 0;
      const total = trafficScore + authScore + homeBonus;
      if (total > bestScore) { bestScore = total; best = c; }
    });
    return best;
  }

  /** Rule-based niche type (no paid AI) */
  function detectNicheType(seed, competitors) {
    const q = String(seed || '').toLowerCase();
    const localRe = /\b(near me|in [a-z]+|plumber|dentist|lawyer|roofer|hvac|electrician|locksmith|florist|restaurant|hotel|clinic|attorney|chiropractor)\b/i;
    const toolRe = /\b(calculator|converter|generator|online|tool|checker|tester|counter|timer|download)\b/i;
    const apkRe = /\b(mod\s*apk|apk\s*mod|premium\s*apk|modded)\b/i;
    const ecomRe = /\b(buy|shop|store|price|cheap|discount|order|shipping)\b/i;
    const affRe = /\b(best|review|vs|versus|alternative|top \d+|comparison|deal)\b/i;

    if (apkRe.test(q)) return { kind: 'apk_mod', label: 'APK / MOD' };
    if (localRe.test(q)) return { kind: 'local_seo', label: 'Local SEO · service' };
    if (toolRe.test(q)) return { kind: 'tool', label: 'Tool / software' };
    if (ecomRe.test(q)) return { kind: 'ecommerce', label: 'Ecommerce' };
    if (affRe.test(q)) return { kind: 'affiliate', label: 'Affiliate' };

    // Homepage-heavy SERP → often dedicated niche / info
    const homes = (competitors || []).filter(isHomepage).length;
    if (homes >= 3) return { kind: 'info_blogging', label: 'Info blogging' };
    return { kind: 'info_blogging', label: 'Info blogging' };
  }

  function generateReasoning(verdict, data, bestCompetitor, stats) {
    const points = [];
    const volume = data.volume;
    const confirmed = data.volumeConfirmed !== false;

    if (volume == null) {
      points.push('Search volume not available in free mode — confirm with any keyword tool.');
    } else if (!confirmed) {
      points.push('Volume ~' + formatNumber(volume) + ' (rough estimate) — confirm with a keyword tool.');
    } else if (volume >= CONSTANTS.MIN_VOLUME) {
      points.push('Strong volume signal (' + formatNumber(volume) + '+).');
    } else {
      points.push('Volume (' + formatNumber(volume) + ') is modest for a broad niche.');
    }

    if (stats.lowAuth >= 3) {
      points.push(stats.lowAuth + ' sites under DR/DA ' + CONSTANTS.LOW_AUTH_THRESHOLD + ' in Top 10 — soft competition.');
    } else if (stats.lowAuth >= 1) {
      points.push('Only ' + stats.lowAuth + ' weak site(s) in Top 10 — mixed difficulty.');
    } else {
      points.push('No weak (DR/DA < ' + CONSTANTS.LOW_AUTH_THRESHOLD + ') sites in Top 10 — hard SERP.');
    }

    if (stats.homepageCount >= 3) {
      points.push(stats.homepageCount + ' dedicated homepages ranking — niche sites already compete here.');
    } else if (stats.homepageCount >= 1) {
      points.push(stats.homepageCount + ' dedicated homepage(s) in Top 10.');
    }

    if (bestCompetitor) {
      const a = authOf(bestCompetitor);
      const label = a != null ? ('DR/DA ' + a) : 'low authority';
      points.push('Realistic target: ' + (bestCompetitor.domain || 'weak site') + ' (' + label + ').');
    }

    if (stats.kind === 'local_seo') {
      points.push('Looks like local / service SEO — Maps and GMB matter more than pure blogs.');
    }

    if (data.hasAiOverview === true) {
      points.push('AI Overview present — some clicks may skip organic results.');
    } else if (data.hasAiOverview === false) {
      points.push('No AI Overview detected on this SERP.');
    }

    return points;
  }

  /**
   * Main entry
   * data: {
   *   seed?, volume?, volumeConfirmed?, hasAiOverview?,
   *   competitors: [{ domain, url, da?, dr?, traffic?, ageYears?, serpPosition? }]
   * }
   */
  function computeOpportunity(data) {
    const competitors = (data.competitors || []).filter(Boolean);
    const volume = (typeof data.volume === 'number') ? data.volume : null;
    const volumeConfirmed = data.volumeConfirmed !== false;

    const withAuth = competitors.map(c => ({ ...c, _auth: authOf(c) }));
    const known = withAuth.filter(c => c._auth !== null);

    const lowAuth = known.filter(c => c._auth < CONSTANTS.LOW_AUTH_THRESHOLD).length;
    const midAuth = known.filter(c => c._auth >= CONSTANTS.MID_AUTH_MIN && c._auth <= CONSTANTS.MID_AUTH_MAX).length;
    const highAuth = known.filter(c => c._auth > CONSTANTS.MID_AUTH_MAX).length;
    const homepageCount = competitors.filter(isHomepage).length;
    // Young domains (< 2 years) — easier targets for new sites
    const lowAge = competitors.filter(c => typeof c.ageYears === 'number' && c.ageYears < 2).length;
    // Low spam (0–5%) — cleaner / healthier competition signal
    const lowSpam = competitors.filter(c => typeof c.spam === 'number' && c.spam >= 0 && c.spam <= 5).length;
    const minAuth = known.length ? Math.min(...known.map(c => c._auth)) : null;
    const top5 = [...withAuth].sort((a, b) => (a.serpPosition ?? 999) - (b.serpPosition ?? 999)).slice(0, 5);
    const top5Weak = top5.filter(c => c._auth !== null && c._auth < CONSTANTS.LOW_AUTH_THRESHOLD).length;

    const typeInfo = detectNicheType(data.seed, competitors);
    const verificationRequired = known.length === 0 && competitors.length > 0;

    // Score 0–100
    let scoreNum = 0;
    if (known.length === 0 && competitors.length === 0) {
      scoreNum = 0;
    } else {
      // Weak count (0–35)
      scoreNum += Math.min(35, lowAuth * 8);
      // Lowest authority (0–25)
      if (minAuth !== null) {
        if (minAuth < 5) scoreNum += 25;
        else if (minAuth < 10) scoreNum += 20;
        else if (minAuth < 20) scoreNum += 15;
        else if (minAuth < 35) scoreNum += 8;
        else if (minAuth < 50) scoreNum += 3;
      }
      // Homepages (0–15)
      scoreNum += Math.min(15, homepageCount * 3);
      // Top5 weak (0–15)
      scoreNum += Math.min(15, top5Weak * 5);
      // Young domains bonus (0–8) — stable, unlike AI Overview
      scoreNum += Math.min(8, lowAge * 2);
      // Low-spam bonus (0–7)
      scoreNum += Math.min(7, lowSpam);
      // AI Overview is NOT in score — Google shows/hides it inconsistently between scans
      // Volume tiny bonus (0–5)
      if (volume != null && volumeConfirmed && volume >= CONSTANTS.MIN_VOLUME) scoreNum += 5;
      else if (volume != null && volume > 0) scoreNum += 2;
    }
    scoreNum = Math.max(0, Math.min(100, Math.round(scoreNum)));

    // Local SEO: soft-penalize pure "blog beginner" framing
    if (typeInfo.kind === 'local_seo') {
      scoreNum = Math.min(scoreNum, 55);
    }

    let verdict = 'MAYBE';
    let verdictLabel = 'Possible — mixed competition';
    let scoreTier = 'moderate';
    let scoreEmoji = '🟡';

    if (verificationRequired) {
      verdict = 'WAIT';
      verdictLabel = 'Waiting for competitor authority data…';
      scoreTier = 'locked';
      scoreEmoji = '🔒';
    } else if (typeInfo.kind === 'local_seo' && lowAuth < 3) {
      verdict = 'NO';
      verdictLabel = 'Not an info-blogging niche — local / service SEO';
      scoreTier = 'very-hard';
      scoreEmoji = '❌';
    } else if (lowAuth >= 3 && top5Weak >= 1 && (minAuth === null || minAuth < 20)) {
      verdict = 'YES';
      verdictLabel = 'Ideal for starters';
      scoreTier = 'excellent';
      scoreEmoji = '🔥';
    } else if (lowAuth >= 2 || (lowAuth >= 1 && minAuth !== null && minAuth < 15)) {
      verdict = 'YES';
      verdictLabel = 'Easy for a beginner';
      scoreTier = 'good';
      scoreEmoji = '✅';
    } else if (lowAuth >= 1 || (minAuth !== null && minAuth <= 40)) {
      verdict = 'MAYBE';
      verdictLabel = 'Possible — needs SEO effort';
      scoreTier = 'moderate';
      scoreEmoji = '🟡';
    } else {
      verdict = 'NO';
      verdictLabel = 'Hard SERP — not ideal for fast ranking';
      scoreTier = 'very-hard';
      scoreEmoji = '❌';
    }

    const bestCompetitor = selectBestCompetitor(competitors);
    const stats = { lowAuth, midAuth, highAuth, homepageCount, lowAge, lowSpam, minAuth, top5Weak, kind: typeInfo.kind };
    const reasons = verificationRequired
      ? ['Authority metrics still loading…']
      : generateReasoning(verdict, data, bestCompetitor, stats);

    // Backward-compatible fields used by existing sidebar
    const legacyScore =
      verdict === 'YES' && scoreTier === 'excellent' ? 'Excellent ranking opportunity'
      : verdict === 'YES' ? 'Easy to rank'
      : verdict === 'MAYBE' ? 'Requires SEO effort'
      : verdict === 'WAIT' ? 'Waiting for competitor data…'
      : 'Not recommended for fast ranking';

    return {
      // v2
      verdict,
      verdictLabel,
      scoreNum,
      scoreTier,
      scoreEmoji,
      nicheType: typeInfo.kind,
      nicheTypeLabel: typeInfo.label,
      lowAuth,
      midAuth,
      highAuth,
      homepageCount,
      lowAge,
      lowSpam,
      minAuth,
      top5Weak,
      reasons,
      bestCompetitor,
      isNicheOpportunity: verdict === 'YES' || verdict === 'MAYBE',
      volumeOk: volume !== null && volumeConfirmed && volume >= CONSTANTS.MIN_VOLUME,
      verificationRequired,
      // legacy (sidebar)
      score: legacyScore,
      lowDACount: lowAuth,
      lowestDA: minAuth,
      effectiveKD: minAuth,
    };
  }

  global.RSNiche = {
    CONSTANTS,
    parseScoreValue,
    formatNumber,
    authOf,
    isHomepage,
    selectBestCompetitor,
    detectNicheType,
    generateReasoning,
    computeOpportunity,
  };
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
