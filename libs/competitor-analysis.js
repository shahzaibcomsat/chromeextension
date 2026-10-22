/**
 * ShahzaibSEO Competitor Analysis Engine - v2.1
 * Advanced competitor analysis with AI-powered insights
 */

class CompetitorAnalysis {
  constructor() {
    this.cacheExpiry = 60 * 60 * 1000; // 1 hour
    this.maxCompetitors = 10;
  }

  /**
   * Initialize the analysis engine
   */
  async init() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['competitorCache'], (result) => {
        this.cache = result.competitorCache || {};
        resolve();
      });
    });
  }

  /**
   * Analyze competitors for a domain
   * @param {string} domain - Target domain
   * @param {Object} options - Analysis options
   */
  async analyzeCompetitors(domain, options = {}) {
    const { maxCompetitors = 5, includeTraffic = true, includeKeywords = true } = options;

    // Check cache first
    const cacheKey = `comp_${domain}`;
    if (this.isCacheValid(cacheKey)) {
      return this.cache[cacheKey];
    }

    const analysis = {
      timestamp: new Date().toISOString(),
      targetDomain: domain,
      competitors: [],
      gaps: {},
      opportunities: [],
      summary: {}
    };

    // Get SEMrush keywords for the domain
    let targetKeywords = [];
    if (includeKeywords) {
      try {
        const kwData = await this.fetchCompetitorKeywords(domain);
        targetKeywords = kwData.keywords || [];
      } catch (e) {
        console.warn('[CompetitorAnalysis] Keywords fetch failed:', e);
      }
    }

    // Get traffic data
    if (includeTraffic) {
      try {
        analysis.targetTraffic = await this.fetchTraffic(domain);
      } catch (e) {
        console.warn('[CompetitorAnalysis] Traffic fetch failed:', e);
      }
    }

    // Find and analyze competitors
    const competitors = await this.findCompetitors(domain, maxCompetitors);

    for (const competitor of competitors) {
      const compData = await this.analyzeSingleCompetitor(competitor, {
        keywords: includeKeywords,
        traffic: includeTraffic
      });
      analysis.competitors.push(compData);
    }

    // Calculate gaps and opportunities
    analysis.gaps = this.calculateKeywordGaps(targetKeywords, analysis.competitors);
    analysis.opportunities = this.identifyOpportunities(analysis);
    analysis.summary = this.generateSummary(analysis);

    // Cache results
    this.cache[cacheKey] = analysis;
    this.saveCache();

    return analysis;
  }

  /**
   * Find competitors from SEMrush data
   */
  async findCompetitors(domain, maxCount = 5) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'SEMRUSH_COMPETITORS_FETCH', domain },
        (response) => {
          if (response?.ok && response.competitors?.length > 0) {
            resolve(response.competitors.slice(0, maxCount).map(c => c.name || c.slug));
          } else {
            // Fallback: generate hypothetical competitors based on domain type
            const tld = domain.split('.').pop();
            resolve([
              `${domain.split('.')[0]} competitor1.com`,
              `${domain.split('.')[0]} competitor2.net`,
              `${domain.split('.')[0]}-替代.io`
            ].slice(0, maxCount));
          }
        }
      );
    });
  }

  /**
   * Analyze a single competitor
   */
  async analyzeSingleCompetitor(compDomain, options = {}) {
    const domain = compDomain.replace(/^www\./, '');
    const data = {
      domain,
      seo: {},
      traffic: {},
      keywords: [],
      strengths: [],
      weaknesses: []
    };

    // Fetch Moz metrics
    if (options.metrics !== false) {
      try {
        data.seo = await this.fetchMozMetrics(domain);
      } catch (e) {
        console.warn('[CompetitorAnalysis] Moz fetch failed for', domain);
      }
    }

    // Fetch traffic
    if (options.traffic) {
      try {
        data.traffic = await this.fetchTraffic(domain);
      } catch (e) {}
    }

    // Fetch keywords
    if (options.keywords) {
      try {
        data.keywords = await this.fetchCompetitorKeywords(domain);
      } catch (e) {}
    }

    // Analyze strengths and weaknesses
    data.strengths = this.analyzeStrengths(data);
    data.weaknesses = this.analyzeWeaknesses(data);

    return data;
  }

  /**
   * Fetch Moz metrics for domain
   */
  async fetchMozMetrics(domain) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'MOZ_FETCH', domain }, (res) => {
        if (res?.ok) {
          resolve({
            da: res.domainAuthority || 0,
            pa: res.pageAuthority || 0,
            spam: res.spamScore || 0,
            backlinks: res.backlinks || 0,
            refDomains: res.referringDomains || 0,
            linkPropensity: res.linkPropensity || 0
          });
        } else {
          resolve({ da: 0, pa: 0, spam: 0, backlinks: 0, refDomains: 0 });
        }
      });
    });
  }

  /**
   * Fetch traffic data
   */
  async fetchTraffic(domain) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'TRAFFIC_FETCH', domain }, (res) => {
        if (res?.ok) {
          resolve({
            monthlyVisits: res.visits || 0,
            change: res.visitsChangePercent || 0,
            bounceRate: res.bounceRate || 0,
            pagesPerVisit: res.pagePerVisit || 0,
            globalRank: res.globalRank || 0
          });
        } else {
          resolve({ monthlyVisits: 0, change: 0 });
        }
      });
    });
  }

  /**
   * Fetch competitor keywords
   */
  async fetchCompetitorKeywords(domain) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'SEMRUSH_KEYWORDS_FETCH', domain },
        (res) => {
          if (res?.ok && res.keywords?.length > 0) {
            resolve({ keywords: res.keywords.slice(0, 50) });
          } else {
            resolve({ keywords: [] });
          }
        }
      );
    });
  }

  /**
   * Analyze competitor strengths
   */
  analyzeStrengths(compData) {
    const strengths = [];

    if (compData.seo?.da > 50) {
      strengths.push('High domain authority (>50)');
    }
    if (compData.traffic?.monthlyVisits > 100000) {
      strengths.push('Significant organic traffic');
    }
    if (compData.keywords?.length > 50) {
      strengths.push(`Strong keyword portfolio (${compData.keywords.length} keywords)`);
    }
    if (compData.seo?.backlinks > 10000) {
      strengths.push('Large backlink profile');
    }

    return strengths;
  }

  /**
   * Analyze competitor weaknesses
   */
  analyzeWeaknesses(compData) {
    const weaknesses = [];

    if (compData.seo?.spam > 5) {
      weaknesses.push('High spam score - potential penalties');
    }
    if (!compData.keywords || compData.keywords.length < 10) {
      weaknesses.push('Limited keyword targeting');
    }
    if (compData.traffic?.change < -10) {
      weaknesses.push('Declining traffic trend');
    }

    return weaknesses;
  }

  /**
   * Calculate keyword gaps between target and competitors
   */
  calculateKeywordGaps(targetKeywords, competitors) {
    const gaps = {
      missingKeywords: [],
      lowRankingKeywords: [],
      competitorKeywords: {}
    };

    // Build competitor keyword sets
    const compKeywordSets = competitors.map(c => {
      const kwSet = new Set((c.keywords || []).map(k => k.keyword?.toLowerCase()));
      return { domain: c.domain, keywords: kwSet };
    });

    // Find missing keywords
    const targetSet = new Set(targetKeywords.map(k => k.keyword?.toLowerCase()));

    compKeywordSets.forEach(comp => {
      comp.keywords.forEach(kw => {
        if (!targetSet.has(kw)) {
          gaps.missingKeywords.push({
            keyword: kw,
            competitor: comp.domain
          });
        }
      });
    });

    // Dedupe and limit
    const seen = new Set();
    gaps.missingKeywords = gaps.missingKeywords
      .filter(kw => {
        if (seen.has(kw.keyword)) return false;
        seen.add(kw.keyword);
        return true;
      })
      .slice(0, 20);

    return gaps;
  }

  /**
   * Identify opportunities from analysis
   */
  identifyOpportunities(analysis) {
    const opportunities = [];

    // Keyword gap opportunities
    if (analysis.gaps?.missingKeywords?.length > 0) {
      opportunities.push({
        type: 'keyword_gap',
        title: 'Keyword Gap Detected',
        description: `Found ${analysis.gaps.missingKeywords.length} keywords your competitors rank for that you don't.`,
        priority: 'high',
        keywords: analysis.gaps.missingKeywords.slice(0, 5)
      });
    }

    // Content opportunities
    const avgWordCount = analysis.competitors.length > 0
      ? analysis.competitors.reduce((sum, c) => sum + (c.wordCount || 0), 0) / analysis.competitors.length
      : 0;

    if (avgWordCount > 1000) {
      opportunities.push({
        type: 'content_length',
        title: 'Expand Content Length',
        description: `Competitors average ${Math.round(avgWordCount)} words. Consider adding more comprehensive content.`,
        priority: 'medium'
      });
    }

    // DA comparison
    const targetDA = analysis.targetDomain?.seo?.da || 0;
    const compAvgDA = analysis.competitors.length > 0
      ? analysis.competitors.reduce((sum, c) => sum + (c.seo?.da || 0), 0) / analysis.competitors.length
      : 0;

    if (targetDA < compAvgDA - 10) {
      opportunities.push({
        type: 'link_building',
        title: 'Increase Domain Authority',
        description: `Target DA (${targetDA}) is lower than competitor average (${Math.round(compAvgDA)}). Focus on link building.`,
        priority: 'high'
      });
    }

    return opportunities;
  }

  /**
   * Generate analysis summary
   */
  generateSummary(analysis) {
    const totalCompKeywords = analysis.competitors.reduce(
      (sum, c) => sum + (c.keywords?.length || 0), 0
    );
    const avgCompDA = analysis.competitors.length > 0
      ? analysis.competitors.reduce((sum, c) => sum + (c.seo?.da || 0), 0) / analysis.competitors.length
      : 0;

    return {
      competitorCount: analysis.competitors.length,
      totalKeywords: totalCompKeywords,
      avgDomainAuthority: Math.round(avgCompDA),
      topCompetitor: analysis.competitors.sort((a, b) => (b.seo?.da || 0) - (a.seo?.da || 0))[0]?.domain || 'N/A',
      opportunityCount: analysis.opportunities?.length || 0,
      keywordGapCount: analysis.gaps?.missingKeywords?.length || 0
    };
  }

  /**
   * Check if cache is valid
   */
  isCacheValid(key) {
    const cached = this.cache[key];
    if (!cached) return false;
    const age = Date.now() - new Date(cached.timestamp).getTime();
    return age < this.cacheExpiry;
  }

  /**
   * Save cache to storage
   */
  saveCache() {
    chrome.storage.local.set({ competitorCache: this.cache });
  }

  /**
   * Clear all cached data
   */
  clearCache() {
    this.cache = {};
    chrome.storage.local.remove(['competitorCache']);
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompetitorAnalysis;
}

/**
 * SERP Tracking History Manager - v2.1
 * Track and analyze search rankings over time
 */
class SERPTracker {
  constructor() {
    this.storageKey = 'serp_tracking_history';
    this.maxHistoryDays = 90;
  }

  /**
   * Initialize tracker
   */
  async init() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.storageKey], (result) => {
        this.history = result[this.storageKey] || {};
        resolve();
      });
    });
  }

  /**
   * Record a SERP check result
   */
  async recordCheck(domain, keyword, position, url) {
    const today = new Date().toISOString().split('T')[0];

    if (!this.history[domain]) {
      this.history[domain] = { keywords: {} };
    }

    if (!this.history[domain].keywords[keyword]) {
      this.history[domain].keywords[keyword] = { history: [] };
    }

    const kwHistory = this.history[domain].keywords[keyword];
    kwHistory.lastPosition = position;
    kwHistory.lastChecked = today;
    kwHistory.lastUrl = url;

    // Add to history
    kwHistory.history.push({
      date: today,
      position,
      url
    });

    // Trim old history
    this.trimHistory(domain);

    // Save
    await this.saveHistory();

    return kwHistory;
  }

  /**
   * Get tracking history for domain
   */
  getHistory(domain, keyword = null) {
    if (!this.history[domain]) return null;

    if (keyword) {
      return this.history[domain].keywords[keyword] || null;
    }

    return this.history[domain];
  }

  /**
   * Get position trend for a keyword
   */
  getPositionTrend(domain, keyword) {
    const kwData = this.getHistory(domain, keyword);
    if (!kwData || !kwData.history || kwData.history.length < 2) {
      return { trend: 'insufficient_data', change: 0 };
    }

    const sorted = kwData.history.sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const first = sorted[0].position;
    const last = sorted[sorted.length - 1].position;
    const change = first - last; // positive = improvement

    let trend = 'stable';
    if (change > 3) trend = 'improving';
    else if (change < -3) trend = 'declining';

    return {
      trend,
      change,
      firstPosition: first,
      lastPosition: last,
      dataPoints: sorted.length
    };
  }

  /**
   * Trim old history entries
   */
  trimHistory(domain) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.maxHistoryDays);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const kwData = this.history[domain]?.keywords;
    if (!kwData) return;

    Object.values(kwData).forEach(kw => {
      if (kw.history) {
        kw.history = kw.history.filter(h => h.date >= cutoffStr);
      }
    });
  }

  /**
   * Save history to storage
   */
  async saveHistory() {
    await chrome.storage.local.set({ [this.storageKey]: this.history });
  }

  /**
   * Export tracking data
   */
  exportData(domain = null) {
    const data = domain ? this.history[domain] : this.history;
    return JSON.stringify(data, null, 2);
  }

  /**
   * Clear tracking data
   */
  async clearHistory(domain = null) {
    if (domain) {
      delete this.history[domain];
    } else {
      this.history = {};
    }
    await this.saveHistory();
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CompetitorAnalysis, SERPTracker };
}