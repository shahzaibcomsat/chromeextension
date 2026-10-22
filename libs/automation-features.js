/**
 * ShahzaibSEO Automation Features - Enhanced v2.1
 * Advanced automation features for SEO/GEO/AEO optimization
 */

class AutomationFeatures {
  constructor() {
    this.featureFlags = {
      autoSitemapGen: true,
      schemaValidation: true,
      competitorAnalysis: true,
      contentGapAnalysis: true,
      keywordClustering: true,
      serptracking: true,
      pdfReports: true
    };
    this.cacheExpiry = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Initialize automation features
   */
  async init() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['automationFeatures'], (result) => {
        if (result.automationFeatures) {
          this.featureFlags = { ...this.featureFlags, ...result.automationFeatures };
        }
        resolve(this.featureFlags);
      });
    });
  }

  /**
   * Run complete automation workflow
   */
  async runAutomation(url, seoData, progressCallback) {
    const steps = [];

    // Step 1: Site Audit
    if (progressCallback) progressCallback({ step: 1, message: 'Running comprehensive site audit...' });
    const audit = await this.runSiteAudit(url, seoData);
    steps.push(audit);

    // Step 2: Content Analysis
    if (progressCallback) progressCallback({ step: 2, message: 'Analyzing content quality...' });
    const contentAnalysis = await this.analyzeContent(seoData);
    steps.push(contentAnalysis);

    // Step 3: GEO Optimization
    if (progressCallback) progressCallback({ step: 3, message: 'Optimizing for AI engines...' });
    const geoOpt = await this.optimizeForGEO(seoData);
    steps.push(geoOpt);

    // Step 4: Technical Fixes
    if (progressCallback) progressCallback({ step: 4, message: 'Applying technical fixes...' });
    const techFixes = await this.applyTechnicalFixes(seoData);
    steps.push(techFixes);

    // Step 5: Generate Report
    if (progressCallback) progressCallback({ step: 5, message: 'Generating optimization report...' });
    const report = await this.generateReport(steps);

    return {
      audit,
      contentAnalysis,
      geoOpt,
      techFixes,
      report,
      recommendations: this.generateRecommendations(audit, contentAnalysis, geoOpt, techFixes)
    };
  }

  /**
   * Run comprehensive site audit
   */
  async runSiteAudit(url, seoData) {
    const audit = {
      timestamp: new Date().toISOString(),
      url,
      scores: {
        seo: seoData?.seo?.score || 50,
        geo: seoData?.geo?.geoScore || 40,
        aeo: seoData?.aeoScore || 45
      },
      issues: [],
      opportunities: [],
      criticalFindings: []
    };

    // Analyze title
    const title = seoData?.title;
    if (!title?.content) {
      audit.issues.push({ category: 'Meta', issue: 'Missing title tag', severity: 'high' });
    } else if (title.length < 30) {
      audit.issues.push({ category: 'Meta', issue: 'Title too short', severity: 'medium' });
    } else if (title.length > 60) {
      audit.issues.push({ category: 'Meta', issue: 'Title too long', severity: 'medium' });
    }

    // Analyze meta description
    const meta = seoData?.metaDescription;
    if (!meta?.content) {
      audit.issues.push({ category: 'Meta', issue: 'Missing meta description', severity: 'high' });
    } else if (meta.length < 120) {
      audit.issues.push({ category: 'Meta', issue: 'Meta description too short', severity: 'medium' });
    }

    // Analyze headings
    const headings = seoData?.headings;
    if (!headings || headings.h1Count === 0) {
      audit.criticalFindings.push('No H1 tag found - critical for SEO');
    } else if (headings.h1Count > 1) {
      audit.issues.push({ category: 'Structure', issue: `Multiple H1 tags (${headings.h1Count})`, severity: 'medium' });
    }

    // Analyze images
    const images = seoData?.images;
    if (images?.withoutAlt > 0) {
      audit.issues.push({ category: 'Images', issue: `${images.withoutAlt} images missing alt text`, severity: 'medium' });
      audit.opportunities.push('Add descriptive alt text to improve image SEO');
    }

    // Analyze links
    const links = seoData?.links;
    if (links?.withoutText > 0) {
      audit.issues.push({ category: 'Links', issue: `${links.withoutText} links without anchor text`, severity: 'low' });
    }

    // Analyze technical
    const tech = seoData?.technical;
    if (tech) {
      if (!tech.canonical) {
        audit.issues.push({ category: 'Technical', issue: 'No canonical URL', severity: 'high' });
      }
      if (!seoData?.url?.startsWith('https://')) {
        audit.criticalFindings.push('Site not using HTTPS - negative ranking factor');
      }
    }

    // GEO-specific audit
    const structured = seoData?.structured;
    if (!structured || structured.count === 0) {
      audit.opportunities.push('Add Schema.org structured data for AI engine visibility');
    }

    // E-E-A-T signals
    const eeat = seoData?.eeat;
    if (!eeat?.hasAuthor) {
      audit.opportunities.push('Add author bio and credentials for E-E-A-T signals');
    }
    if (!eeat?.hasDate) {
      audit.opportunities.push('Add publication and modification dates');
    }

    return audit;
  }

  /**
   * Analyze content quality
   */
  async analyzeContent(seoData) {
    const content = seoData?.content || {};
    const keywords = seoData?.keywords || {};

    const analysis = {
      wordCount: content.wordCount || 0,
      paragraphCount: content.paragraphCount || 0,
      readability: seoData?.readability?.score || 0,
      keywordDensity: this.calculateKeywordDensity(keywords),
      contentGaps: this.identifyContentGaps(keywords),
      recommendations: []
    };

    // Content length recommendations
    if (analysis.wordCount < 300) {
      analysis.recommendations.push({
        type: 'length',
        priority: 'high',
        message: `Content is too short (${analysis.wordCount} words). Aim for 800-2000 words for better rankings.`
      });
    } else if (analysis.wordCount < 800) {
      analysis.recommendations.push({
        type: 'length',
        priority: 'medium',
        message: `Content could be expanded (${analysis.wordCount} words). Consider adding more depth.`
      });
    }

    // Readability recommendations
    if (analysis.readability > 0 && analysis.readability < 50) {
      analysis.recommendations.push({
        type: 'readability',
        priority: 'medium',
        message: 'Content may be difficult to read. Consider simplifying sentence structure.'
      });
    }

    // Keyword analysis
    const topKeywords = (keywords.keywords || []).slice(0, 10);
    if (topKeywords.length > 0) {
      analysis.topKeywords = topKeywords;
      analysis.primaryKeyword = topKeywords[0]?.word || '';
    }

    // Content structure analysis
    const headings = seoData?.headings || {};
    analysis.headingStructure = {
      h1Count: headings.h1Count || 0,
      h2Count: headings.structure?.h2?.length || 0,
      h3Count: headings.structure?.h3?.length || 0,
      isWellStructured: headings.h1Count === 1 && headings.structure?.h2?.length > 2
    };

    return analysis;
  }

  /**
   * Calculate keyword density
   */
  calculateKeywordDensity(keywords) {
    const raw = keywords.keywords || [];
    return raw.slice(0, 20).map(k => ({
      keyword: k.word,
      count: k.count,
      density: k.density
    }));
  }

  /**
   * Identify content gaps
   */
  identifyContentGaps(keywords) {
    const gaps = [];
    const raw = keywords.keywords || [];

    // Find keywords with high count but not in headings
    raw.forEach(k => {
      if (k.count > 3 && !k.inTitle && !k.inH1 && !k.inH2) {
        gaps.push({
          keyword: k.word,
          reason: 'Frequently mentioned but not in headings',
          opportunity: `Add this keyword to H2 or H3 headings`
        });
      }
    });

    return gaps.slice(0, 10);
  }

  /**
   * Optimize for GEO (Generative Engine Optimization)
   */
  async optimizeForGEO(seoData) {
    const geo = {
      currentScore: seoData?.geo?.geoScore || 40,
      factors: {},
      recommendations: []
    };

    // Schema markup check
    const structured = seoData?.structured || {};
    geo.factors.schemaMarkup = {
      present: structured.count > 0,
      count: structured.count || 0,
      valid: structured.validCount || 0,
      score: (structured.count > 0) ? 80 : 20
    };

    if (structured.count === 0) {
      geo.recommendations.push({
        category: 'Structured Data',
        priority: 'high',
        title: 'Add Schema.org markup',
        description: 'Implement JSON-LD structured data to improve AI engine visibility',
        schemaTypes: ['Article', 'FAQPage', 'BreadcrumbList', 'Organization']
      });
    }

    // E-E-A-T signals
    const eeat = seoData?.eeat || {};
    geo.factors.eeat = {
      author: eeat.hasAuthor || false,
      credentials: eeat.hasCredentials || false,
      date: eeat.hasDate || false,
      citations: eeat.hasCitations || false,
      score: this.calculateEEATScore(eeat)
    };

    if (!eeat.hasAuthor) {
      geo.recommendations.push({
        category: 'E-E-A-T',
        priority: 'high',
        title: 'Add author bio',
        description: 'Include author name, photo, credentials, and social links for better AI visibility'
      });
    }

    if (!eeat.hasDate) {
      geo.recommendations.push({
        category: 'E-E-A-T',
        priority: 'medium',
        title: 'Add publication date',
        description: 'Include publish and modification dates for content freshness signals'
      });
    }

    // Multi-modal content
    const images = seoData?.images || {};
    geo.factors.multimodal = {
      imageCount: images.total || 0,
      withAlt: images.withAlt || 0,
      score: images.total > 0 && images.withAlt > 0 ? 70 : 30
    };

    if (images.total > 0 && images.withAlt < images.total * 0.5) {
      geo.recommendations.push({
        category: 'Multimodal',
        priority: 'medium',
        title: 'Improve image optimization',
        description: 'Add descriptive alt text to all images for AI engine understanding'
      });
    }

    // FAQ content
    const headings = seoData?.headings || {};
    const hasFAQ = headings.structure?.h2?.some(h => /faq|question/i.test(h.text)) || false;
    geo.factors.faq = {
      present: hasFAQ,
      score: hasFAQ ? 80 : 30
    };

    if (!hasFAQ) {
      geo.recommendations.push({
        category: 'Content',
        priority: 'medium',
        title: 'Add FAQ section',
        description: 'Include a FAQ section with structured FAQPage schema for AI engine visibility'
      });
    }

    // Calculate final score
    geo.finalScore = Math.round(
      (geo.factors.schemaMarkup.score * 0.3) +
      (geo.factors.eeat.score * 0.3) +
      (geo.factors.multimodal.score * 0.2) +
      (geo.factors.faq.score * 0.2)
    );

    return geo;
  }

  /**
   * Calculate E-E-A-T score
   */
  calculateEEATScore(eeat) {
    let score = 0;
    if (eeat.hasAuthor) score += 30;
    if (eeat.hasCredentials) score += 25;
    if (eeat.hasDate) score += 25;
    if (eeat.hasCitations) score += 20;
    return score;
  }

  /**
   * Apply technical fixes
   */
  async applyTechnicalFixes(seoData) {
    const fixes = [];
    const tech = seoData?.technical || {};

    // Canonical URL
    if (!tech.canonical) {
      fixes.push({
        category: 'Canonical URL',
        priority: 'high',
        code: `<link rel="canonical" href="${seoData?.url || 'https://example.com/page'}">`,
        impact: 'Prevents duplicate content issues'
      });
    }

    // Meta robots
    if (tech.robots?.content?.includes('noindex')) {
      fixes.push({
        category: 'Robots Meta',
        priority: 'high',
        code: '<meta name="robots" content="index, follow">',
        impact: 'Allows page to be indexed'
      });
    }

    // Open Graph tags
    const og = seoData?.meta?.og || {};
    if (!og.title || !og.description || !og.image) {
      fixes.push({
        category: 'Open Graph',
        priority: 'medium',
        code: this.generateOGTags(seoData),
        impact: 'Improves social media sharing'
      });
    }

    // Twitter Cards
    const twitter = seoData?.meta?.twitter || {};
    if (!twitter.card) {
      fixes.push({
        category: 'Twitter Cards',
        priority: 'low',
        code: '<meta name="twitter:card" content="summary_large_image">',
        impact: 'Improves Twitter sharing'
      });
    }

    // Mobile viewport
    if (!tech.viewport) {
      fixes.push({
        category: 'Viewport',
        priority: 'high',
        code: '<meta name="viewport" content="width=device-width, initial-scale=1">',
        impact: 'Ensures mobile compatibility'
      });
    }

    return { fixes, total: fixes.length };
  }

  /**
   * Generate Open Graph tags
   */
  generateOGTags(seoData) {
    const title = seoData?.title?.content || 'Page Title';
    const desc = seoData?.metaDescription?.content || 'Page description';
    const url = seoData?.url || 'https://example.com';

    return `<!-- Open Graph Tags -->
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta property="og:image" content="https://example.com/og-image.jpg">
<meta property="og:site_name" content="Your Site Name">`;
  }

  /**
   * Generate optimization report
   */
  async generateReport(steps) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalIssues: 0,
        criticalIssues: 0,
        recommendations: 0
      },
      sections: []
    };

    steps.forEach(step => {
      if (step.issues) {
        report.summary.totalIssues += step.issues.length;
      }
      if (step.criticalFindings) {
        report.summary.criticalIssues += step.criticalFindings.length;
      }
      if (step.recommendations) {
        report.summary.recommendations += step.recommendations.length;
      }
      report.sections.push({
        name: step.constructor?.name || 'Analysis',
        data: step
      });
    });

    return report;
  }

  /**
   * Generate prioritized recommendations
   */
  generateRecommendations(audit, contentAnalysis, geoOpt, techFixes) {
    const recommendations = [];

    // Critical issues first
    audit.criticalFindings?.forEach(finding => {
      recommendations.push({
        priority: 'critical',
        category: 'Critical',
        title: finding,
        action: 'Fix immediately'
      });
    });

    // High priority
    audit.issues?.filter(i => i.severity === 'high').forEach(issue => {
      recommendations.push({
        priority: 'high',
        category: issue.category,
        title: issue.issue,
        action: 'Fix as soon as possible'
      });
    });

    // Medium priority
    audit.issues?.filter(i => i.severity === 'medium').forEach(issue => {
      recommendations.push({
        priority: 'medium',
        category: issue.category,
        title: issue.issue,
        action: 'Fix within next update'
      });
    });

    // GEO recommendations
    geoOpt.recommendations?.forEach(rec => {
      recommendations.push({
        priority: rec.priority,
        category: rec.category,
        title: rec.title,
        description: rec.description,
        action: 'Implement for AI visibility'
      });
    });

    // Technical fixes
    techFixes.fixes?.forEach(fix => {
      recommendations.push({
        priority: fix.priority,
        category: fix.category,
        title: fix.category,
        code: fix.code,
        action: fix.impact
      });
    });

    return recommendations.slice(0, 20);
  }

  /**
   * Batch URL analysis for bulk checking
   */
  async batchAnalyzeURLs(urls, options = {}) {
    const results = [];
    const maxConcurrent = options.maxConcurrent || 5;
    const onProgress = options.onProgress || (() => {});

    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);
      const batchPromises = batch.map(async (url) => {
        try {
          const result = await this.analyzeSingleURL(url);
          onProgress({ completed: results.length + 1, total: urls.length });
          return result;
        } catch (error) {
          return { url, error: error.message, status: 'failed' };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Analyze a single URL
   */
  async analyzeSingleURL(url) {
    const domain = new URL(url).hostname.replace(/^www\./, '');

    // Fetch page data
    let pageData = null;
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShahzaibSEO/2.0)' }
      });
      if (resp.ok) {
        const html = await resp.text();
        pageData = this.parsePageHTML(html, url);
      }
    } catch (e) {
      // Fetch failed
    }

    // Get Moz DA
    const mozData = await this.fetchMozData(domain);

    // Get traffic data
    const trafficData = await this.fetchTrafficData(domain);

    return {
      url,
      domain,
      pageData,
      seo: pageData ? this.calculateSEOScore(pageData) : null,
      moz: mozData,
      traffic: trafficData
    };
  }

  /**
   * Parse page HTML for basic SEO data
   */
  parsePageHTML(html, url) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    return {
      url,
      title: doc.querySelector('title')?.textContent || '',
      metaDesc: doc.querySelector('meta[name="description"]')?.content || '',
      h1Count: doc.querySelectorAll('h1').length,
      h2Count: doc.querySelectorAll('h2').length,
      imageCount: doc.querySelectorAll('img').length,
      imageWithAlt: doc.querySelectorAll('img[alt]').length,
      links: doc.querySelectorAll('a').length,
      wordCount: doc.body?.textContent?.split(/\s+/).length || 0,
      hasCanonical: !!doc.querySelector('link[rel="canonical"]'),
      hasOG: !!doc.querySelector('meta[property^="og:"]')
    };
  }

  /**
   * Calculate SEO score from page data
   */
  calculateSEOScore(pageData) {
    let score = 50;

    if (pageData.title) score += 10;
    else score -= 15;

    if (pageData.metaDesc) score += 10;
    else score -= 10;

    if (pageData.h1Count === 1) score += 15;
    else score -= 10;

    if (pageData.imageWithAlt > 0) {
      score += Math.min(10, (pageData.imageWithAlt / pageData.imageCount) * 10);
    } else {
      score -= 5;
    }

    if (pageData.wordCount > 300) score += 10;
    if (pageData.hasCanonical) score += 5;
    if (pageData.hasOG) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Fetch Moz data for domain
   */
  async fetchMozData(domain) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'MOZ_FETCH', domain }, (res) => {
        if (res?.ok) {
          resolve({
            da: res.domainAuthority,
            pa: res.pageAuthority,
            spam: res.spamScore,
            backlinks: res.backlinks,
            refDomains: res.referringDomains
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Fetch traffic data
   */
  async fetchTrafficData(domain) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'TRAFFIC_FETCH', domain }, (res) => {
        if (res?.ok) {
          resolve({
            visits: res.visits,
            change: res.visitsChangePercent,
            bounceRate: res.bounceRate,
            globalRank: res.globalRank
          });
        } else {
          resolve(null);
        }
      });
    });
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AutomationFeatures;
}