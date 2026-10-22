/**
 * Automation Controller
 * Main orchestrator for "Automate my GEO & SEO" feature
 */

class AutomationController {
  constructor() {
    this.firecrawlService = new FirecrawlService();
    this.aiAnalyzer = new AIAnalyzer();
    this.rankingChecker = new RankingChecker();
    
    this.currentUrl = null;
    this.currentSeoData = null;
    this.results = null;
    
    // Progress tracking
    this.totalSteps = 5;
    this.currentStep = 0;
    this.progressCallback = null;
  }

  /**
   * Run complete automation workflow
   * @param {string} url - Page URL to analyze
   * @param {Object} currentSeoData - Current SEO analysis data
   * @param {Function} progressCallback - Progress update callback
   * @param {Function} cancelToken - Optional cancel check function
   * @returns {Promise<Object>} Complete automation results
   */
  async run(url, currentSeoData, progressCallback, cancelToken) {
    this.currentUrl = url;
    this.currentSeoData = currentSeoData;
    this.progressCallback = progressCallback;
    this._cancelled = false;

    console.log('[Automation] Starting workflow for:', url);

    const checkCancel = () => {
      if (this._cancelled || (cancelToken && cancelToken())) {
        throw new Error('CANCELLED');
      }
    };

    try {
      // Step 1: Crawl page with Firecrawl
      this.updateProgress(1, 'Crawling page with Firecrawl...');
      const pageData = await this.firecrawlService.crawl(url);
      checkCancel();

      // Step 2: Analyze with AI
      this.updateProgress(2, 'Analyzing with AI...');
      const analysis = await this.aiAnalyzer.analyze(pageData, currentSeoData);
      checkCancel();

      // Step 3: Check AI engine rankings (parallel with fix generation)
      this.updateProgress(3, 'Testing AI engine rankings...');
      const [rankings, fixes] = await Promise.all([
        this.rankingChecker.checkAll(url, pageData),
        Promise.resolve(this.generateFixes(analysis, pageData))
      ]);
      checkCancel();

      // Step 4: Generating fixes (already done above in parallel, just update UI)
      this.updateProgress(4, 'Generating fixes...');

      // Step 5: Create implementation guide
      this.updateProgress(5, 'Creating implementation guide...');
      const guide = this.createImplementationGuide(fixes, analysis);

      // Compile final results
      this.results = {
        url,
        timestamp: new Date().toISOString(),
        pageData,
        analysis,
        rankings,
        fixes,
        guide,
        summary: this.createSummary(analysis, rankings)
      };

      console.log('[Automation] Workflow complete:', this.results);
      return this.results;

    } catch (error) {
      if (error.message === 'CANCELLED') {
        console.log('[Automation] Workflow cancelled by user');
        throw error;
      }
      console.error('[Automation] Workflow error:', error);
      throw error;
    }
  }

  /**
   * Cancel the current run
   */
  cancel() {
    this._cancelled = true;
    this.firecrawlService._cancelled = true;
    this.aiAnalyzer._cancelled = true;
    this.rankingChecker._cancelled = true;
  }

  /**
   * Update progress
   */
  updateProgress(step, message) {
    this.currentStep = step;
    const percentage = Math.round((step / this.totalSteps) * 100);
    
    console.log(`[Automation] Step ${step}/${this.totalSteps}: ${message}`);
    
    if (this.progressCallback) {
      this.progressCallback({
        step,
        totalSteps: this.totalSteps,
        percentage,
        message
      });
    }
  }

  /**
   * Generate fixes from AI analysis
   */
  generateFixes(analysis, pageData) {
    const fixes = {
      metaTags: this.generateMetaTagsFix(analysis.optimizations),
      schemas: this.generateSchemaFix(analysis.optimizations),
      altTexts: this.generateAltTextsFix(analysis.optimizations, pageData),
      internalLinks: this.generateInternalLinksFix(analysis.optimizations),
      content: this.generateContentFix(analysis),
      technical: this.generateTechnicalFixes(analysis.issues)
    };

    return fixes;
  }

  /**
   * Generate meta tags fix
   */
  generateMetaTagsFix(optimizations) {
    return {
      title: 'Update Meta Tags',
      priority: 'High',
      estimatedTime: '5 min',
      code: `<!-- Update these meta tags in your <head> section -->
<title>${optimizations.metaTitle || 'Your Optimized Title Here'}</title>
<meta name="description" content="${optimizations.metaDescription || 'Your optimized description here'}">

<!-- Open Graph Tags -->
<meta property="og:title" content="${optimizations.metaTitle || 'Your Optimized Title Here'}">
<meta property="og:description" content="${optimizations.metaDescription || 'Your optimized description here'}">
<meta property="og:image" content="https://yourdomain.com/images/og-image.jpg">
<meta property="og:url" content="${this.currentUrl}">
<meta property="og:type" content="website">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${optimizations.metaTitle || 'Your Optimized Title Here'}">
<meta name="twitter:description" content="${optimizations.metaDescription || 'Your optimized description here'}">
<meta name="twitter:image" content="https://yourdomain.com/images/twitter-card.jpg">`,
      impact: 'High - Improves CTR by 30-40%'
    };
  }

  /**
   * Generate schema markup fix
   */
  generateSchemaFix(optimizations) {
    const schemaCode = optimizations.schemaMarkup || this.generateDefaultSchema();
    const faqCode = optimizations.faqSchema || '';

    return {
      title: 'Add Schema Markup',
      priority: 'High',
      estimatedTime: '10 min',
      code: `<!-- Add this JSON-LD schema before closing </head> tag -->
<script type="application/ld+json">
${schemaCode}
</script>

${faqCode ? `<!-- FAQ Schema (if applicable) -->
<script type="application/ld+json">
${faqCode}
</script>` : ''}`,
      impact: 'High - Improves AI engine visibility and rich snippets'
    };
  }

  /**
   * Generate default schema
   */
  generateDefaultSchema() {
    const url = new URL(this.currentUrl);
    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Page Title",
      "description": "Page description",
      "url": this.currentUrl,
      "publisher": {
        "@type": "Organization",
        "name": url.hostname,
        "url": url.origin
      }
    }, null, 2);
  }

  /**
   * Generate alt texts fix
   */
  generateAltTextsFix(optimizations, pageData) {
    const altTexts = optimizations.altTexts || [];
    const imagesWithoutAlt = pageData.images.filter(img => !img.hasAlt).slice(0, 10);

    const altTextList = altTexts.map((alt, i) => {
      const img = imagesWithoutAlt[i] || { src: 'image.jpg' };
      return `<!-- Image: ${img.src} -->
<img src="${img.src}" alt="${alt.alt}">`;
    }).join('\n\n');

    return {
      title: 'Fix Image Alt Texts',
      priority: 'Medium',
      estimatedTime: '15 min',
      code: altTextList || '<!-- No images found without alt text -->',
      count: altTexts.length,
      impact: 'Medium - Improves accessibility and image SEO'
    };
  }

  /**
   * Generate internal links fix
   */
  generateInternalLinksFix(optimizations) {
    const links = optimizations.internalLinks || [];

    const linksList = links.map(link => 
      `<a href="${link.url}">${link.anchor}</a>\n<!-- Reason: ${link.reason} -->`
    ).join('\n\n');

    return {
      title: 'Add Internal Links',
      priority: 'Medium',
      estimatedTime: '10 min',
      suggestions: links,
      code: linksList || '<!-- No internal linking suggestions -->',
      impact: 'Medium - Improves site structure and crawlability'
    };
  }

  /**
   * Generate content improvements fix
   * AI response has geoRecommendations and aeoRecommendations at top level
   */
  generateContentFix(analysis) {
    // analysis is the parsed AI response — recommendations are at top level
    const geoRecs = analysis.geoRecommendations || [];
    const aeoRecs = analysis.aeoRecommendations || [];
    const recommendations = [...geoRecs, ...aeoRecs].slice(0, 10);

    return {
      title: 'Improve Content for GEO & AEO',
      priority: 'Medium',
      estimatedTime: '30 min',
      recommendations,
      impact: 'High - Improves GEO and AEO scores'
    };
  }

  /**
   * Generate technical fixes from AI issues array (top-level in AI response)
   */
  generateTechnicalFixes(issues) {
    const issuesList = Array.isArray(issues) ? issues : [];
    const technicalIssues = issuesList.filter(i =>
      (i.category || '').toUpperCase() === 'TECHNICAL' || i.severity === 'high'
    );

    return {
      title: 'Technical Fixes',
      priority: 'High',
      estimatedTime: '20 min',
      issues: technicalIssues,
      impact: 'High - Fixes critical technical SEO issues'
    };
  }

  /**
   * Create implementation guide
   */
  createImplementationGuide(fixes, analysis) {
    const steps = [];
    let stepNumber = 1;

    // Step 1: Meta Tags
    if (fixes.metaTags) {
      steps.push({
        step: stepNumber++,
        ...fixes.metaTags,
        completed: false
      });
    }

    // Step 2: Schema Markup
    if (fixes.schemas) {
      steps.push({
        step: stepNumber++,
        ...fixes.schemas,
        completed: false
      });
    }

    // Step 3: Alt Texts
    if (fixes.altTexts && fixes.altTexts.count > 0) {
      steps.push({
        step: stepNumber++,
        ...fixes.altTexts,
        completed: false
      });
    }

    // Step 4: Internal Links
    if (fixes.internalLinks && fixes.internalLinks.suggestions.length > 0) {
      steps.push({
        step: stepNumber++,
        ...fixes.internalLinks,
        completed: false
      });
    }

    // Step 5: Content Improvements
    if (fixes.content && fixes.content.recommendations.length > 0) {
      steps.push({
        step: stepNumber++,
        ...fixes.content,
        completed: false
      });
    }

    // Step 6: Technical Fixes
    if (fixes.technical && fixes.technical.issues.length > 0) {
      steps.push({
        step: stepNumber++,
        ...fixes.technical,
        completed: false
      });
    }

    // Calculate total time
    const totalMinutes = steps.reduce((sum, step) => {
      const time = parseInt(step.estimatedTime) || 0;
      return sum + time;
    }, 0);

    return {
      steps,
      totalSteps: steps.length,
      totalTime: `~${totalMinutes} minutes`,
      expectedImpact: this.calculateExpectedImpact(analysis)
    };
  }

  /**
   * Calculate expected impact
   */
  calculateExpectedImpact(analysis) {
    const scores = analysis.analysis || {};
    const currentSEO = this.currentSeoData?.seo?.score || this.currentSeoData?.seoScore || 50;
    const currentGEO = this.currentSeoData?.geo?.geoScore || this.currentSeoData?.geoScore || 40;
    const seoImprovement = Math.max(0, (scores.seoScore || 85) - currentSEO);
    const geoImprovement = Math.max(0, (scores.geoScore || 70) - currentGEO);

    return {
      seoImprovement: `+${seoImprovement} points`,
      geoImprovement: `+${geoImprovement} points`,
      trafficIncrease: '50-100%',
      aiVisibility: 'Rank in 3-5 AI engines'
    };
  }

  /**
   * Create summary — safely reads from AI response structure
   * AI response: { analysis: { seoScore, geoScore, aeoScore }, issues: [...], ... }
   */
  createSummary(analysis, rankings) {
    const scores = analysis.analysis || {};
    const issues = Array.isArray(analysis.issues) ? analysis.issues : [];

    const currentSEO = this.currentSeoData?.seo?.score || this.currentSeoData?.seoScore || 50;
    const currentGEO = this.currentSeoData?.geo?.geoScore || this.currentSeoData?.geoScore || 40;
    const targetSEO  = scores.seoScore  || 85;
    const targetGEO  = scores.geoScore  || 70;
    const targetAEO  = scores.aeoScore  || 65;

    return {
      scores: {
        current:     { seo: currentSEO, geo: currentGEO, aeo: 50 },
        target:      { seo: targetSEO,  geo: targetGEO,  aeo: targetAEO },
        improvement: {
          seo: Math.max(0, targetSEO - currentSEO),
          geo: Math.max(0, targetGEO - currentGEO),
          aeo: Math.max(0, targetAEO - 50)
        }
      },
      rankings: {
        total:   rankings?.rankedCount ?? 0,
        outOf:   10,
        percentage: Math.round(((rankings?.rankedCount ?? 0) / 10) * 100)
      },
      issues: {
        total:  issues.length,
        high:   issues.filter(i => i.severity === 'high').length,
        medium: issues.filter(i => i.severity === 'medium').length,
        low:    issues.filter(i => i.severity === 'low').length
      }
    };
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AutomationController;
}
