/**
 * AI Analyzer Service
 * Analyzes SEO/GEO/AEO using NVIDIA, OpenRouter, or Groq (Qwen etc.) models
 */

class AIAnalyzer {
  constructor() {
    this.nvidiaApiKey = null;
    this.openrouterApiKey = null;
    this.groqApiKey = null;
    this.preferredProvider = 'nvidia'; // 'nvidia' | 'openrouter' | 'groq'
  }

  /**
   * Initialize service with API keys from storage
   */
  async init() {
    return new Promise((resolve) => {
      Promise.all([
        new Promise((res) => {
          chrome.storage.local.get(['nvidiaApiKey', 'openrouterApiKey', 'groqApiKey', 'aiProvider'], (result) => {
            res({
              nvidia: result.nvidiaApiKey || '',
              openrouter: result.openrouterApiKey || '',
              groq: result.groqApiKey || '',
              provider: result.aiProvider || ''
            });
          });
        }),
        new Promise((res) => {
          try {
            const aiConfigStr = localStorage.getItem('rp-ai-config');
            const aiConfig = aiConfigStr ? JSON.parse(aiConfigStr) : null;
            res({
              nvidia: aiConfig?.nvidiaKey || '',
              openrouter: aiConfig?.openrouterKey || '',
              groq: aiConfig?.groqKey || '',
              provider: aiConfig?.provider || ''
            });
          } catch (e) {
            res({ nvidia: '', openrouter: '', groq: '', provider: '' });
          }
        })
      ]).then(([localKeys, localStorageKeys]) => {
        this.nvidiaApiKey = localKeys.nvidia || localStorageKeys.nvidia || '';
        this.openrouterApiKey = localKeys.openrouter || localStorageKeys.openrouter || '';
        this.groqApiKey = localKeys.groq || localStorageKeys.groq || '';

        const pref = localKeys.provider || localStorageKeys.provider;
        if (pref === 'groq' && this.groqApiKey) this.preferredProvider = 'groq';
        else if (pref === 'openrouter' && this.openrouterApiKey) this.preferredProvider = 'openrouter';
        else if (pref === 'nvidia' && this.nvidiaApiKey) this.preferredProvider = 'nvidia';
        else if (this.nvidiaApiKey) this.preferredProvider = 'nvidia';
        else if (this.groqApiKey) this.preferredProvider = 'groq';
        else if (this.openrouterApiKey) this.preferredProvider = 'openrouter';

        console.log('[AI Analyzer] API Keys loaded:', {
          nvidia: this.nvidiaApiKey ? 'Yes' : 'No',
          openrouter: this.openrouterApiKey ? 'Yes' : 'No',
          groq: this.groqApiKey ? 'Yes' : 'No',
          provider: this.preferredProvider
        });

        resolve(this.preferredProvider);
      });
    });
  }

  /**
   * Analyze page data for SEO/GEO/AEO optimization
   * @param {Object} pageData - Firecrawl page data
   * @param {Object} currentSeoData - Current SEO analysis data
   * @returns {Promise<Object>} AI analysis results
   */
  async analyze(pageData, currentSeoData) {
    await this.init();

    if (!this.nvidiaApiKey && !this.openrouterApiKey && !this.groqApiKey) {
      throw new Error('No AI API key configured. Please add NVIDIA, OpenRouter, or Groq API key in Settings.');
    }

    console.log('[AI Analyzer] Starting analysis with', this.preferredProvider);

    const prompt = this.buildAnalysisPrompt(pageData, currentSeoData);

    let response;
    if (this.preferredProvider === 'nvidia') {
      response = await this.callNvidiaAPI(prompt);
    } else if (this.preferredProvider === 'groq') {
      response = await this.callGroqAPI(prompt);
    } else {
      response = await this.callOpenRouterAPI(prompt);
    }

    return this.parseAnalysisResponse(response);
  }

  /**
   * Build a concise analysis prompt — optimized for speed
   * Keeps context tight: no raw content dump, only structured signals
   */
  buildAnalysisPrompt(pageData, currentSeoData) {
    const imagesWithoutAlt = pageData.images.filter(img => !img.hasAlt).length;
    // Send only first 2000 chars of content — enough for topic/entity detection
    const contentSnippet = (pageData.rawContent || '').substring(0, 2000);
    // Top 15 headings only
    const headingsSummary = pageData.headings.slice(0, 15).map(h => `${'#'.repeat(h.level)} ${h.text}`).join('\n');

    return `You are an SEO/GEO/AEO expert. Analyze this page and return ONLY valid JSON.

PAGE SIGNALS:
URL: ${pageData.url}
Title: ${pageData.title || 'MISSING'}
Meta Desc: ${pageData.description || 'MISSING'} (${(pageData.description || '').length} chars)
Words: ${pageData.wordCount} | H1: ${pageData.headings.filter(h => h.level === 1).length} | H2: ${pageData.headings.filter(h => h.level === 2).length}
Images: ${pageData.images.length} (${imagesWithoutAlt} missing alt) | Internal links: ${pageData.internalLinks.length}
Schemas: ${pageData.schemas.length} | SEO Score: ${currentSeoData?.seoScore || '?'}/100

HEADINGS:
${headingsSummary}

CONTENT SAMPLE:
${contentSnippet}

Return ONLY this JSON (no markdown, no explanation):
{"analysis":{"seoScore":0,"geoScore":0,"aeoScore":0,"overallHealth":""},"issues":[{"id":"","severity":"high","category":"SEO","title":"","description":"","currentValue":"","suggestedFix":"","impact":"","code":""}],"optimizations":{"metaTitle":"","metaDescription":"","h1":"","altTexts":[{"image":"","alt":""}],"schemaMarkup":"","faqSchema":"","internalLinks":[{"anchor":"","url":"","reason":""}]},"geoRecommendations":[{"title":"","description":"","priority":"High"}],"aeoRecommendations":[{"title":"","description":"","priority":"High"}],"implementationGuide":[{"step":1,"title":"","description":"","code":"","priority":"High","estimatedTime":"5 min"}],"keywordOpportunities":[{"keyword":"","intent":"informational","competition":"low","recommendation":""}]}`;
  }

  /**
   * Call NVIDIA AI API — uses fast 70B model for speed
   */
  async callNvidiaAPI(prompt) {
    try {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.nvidiaApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'meta/llama-3.3-70b-instruct', // fast 70B — ~3-5s vs 405B ~30-60s
          messages: [
            {
              role: 'system',
              content: 'You are an SEO/GEO/AEO expert. Return ONLY valid JSON, no markdown, no explanation.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,   // lower = more deterministic & faster
          max_tokens: 2000    // enough for full analysis, avoids slow long responses
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `NVIDIA API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;

    } catch (error) {
      console.error('[AI Analyzer] NVIDIA API error:', error);
      throw new Error(`NVIDIA AI analysis failed: ${error.message}`);
    }
  }

  /**
   * Call OpenRouter API — uses fast 70B model
   */
  async callOpenRouterAPI(prompt) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openrouterApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': chrome.runtime.getURL(''),
          'X-Title': 'ShahzaibSEO Extension'
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct',
          messages: [
            {
              role: 'system',
              content: 'You are an SEO/GEO/AEO expert. Return ONLY valid JSON, no markdown, no explanation.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `OpenRouter API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;

    } catch (error) {
      console.error('[AI Analyzer] OpenRouter API error:', error);
      throw new Error(`OpenRouter AI analysis failed: ${error.message}`);
    }
  }

  /**
   * Call Groq API (OpenAI-compatible) — supports Qwen and other fast models
   * Example model: qwen/qwen3-32b or llama-3.3-70b-versatile
   */
  async callGroqAPI(prompt) {
    try {
      // Allow model override from storage
      let model = 'qwen/qwen3.8-27b';
      try {
        const stored = await new Promise(r => chrome.storage.local.get(['groqModel'], r));
        if (stored.groqModel) model = stored.groqModel;
      } catch (_) {}

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are an SEO/GEO/AEO expert. Return ONLY valid JSON, no markdown, no explanation.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000,
          top_p: 0.95
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Groq API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;

    } catch (error) {
      console.error('[AI Analyzer] Groq API error:', error);
      throw new Error(`Groq AI analysis failed: ${error.message}`);
    }
  }

  /**
   * Parse AI response and validate structure
   */
  parseAnalysisResponse(response) {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = response.trim();
      
      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }
      
      const parsed = JSON.parse(jsonStr);
      
      // Validate required fields
      if (!parsed.analysis || !parsed.issues || !parsed.optimizations) {
        throw new Error('Invalid response structure');
      }
      
      console.log('[AI Analyzer] Analysis complete:', parsed);
      return parsed;

    } catch (error) {
      console.error('[AI Analyzer] Failed to parse response:', error);
      console.log('[AI Analyzer] Raw response:', response);
      
      // Return fallback structure
      return {
        analysis: {
          seoScore: 75,
          geoScore: 60,
          aeoScore: 55,
          overallHealth: 'Needs Improvement'
        },
        issues: [
          {
            id: 'parse-error',
            severity: 'high',
            category: 'System',
            title: 'AI Analysis Error',
            description: 'Failed to parse AI response. Please try again.',
            currentValue: '',
            suggestedFix: 'Retry analysis',
            impact: 'High',
            code: ''
          }
        ],
        optimizations: {
          metaTitle: '',
          metaDescription: '',
          h1: '',
          altTexts: [],
          schemaMarkup: '',
          faqSchema: '',
          internalLinks: []
        },
        geoRecommendations: [],
        aeoRecommendations: [],
        implementationGuide: []
      };
    }
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIAnalyzer;
}
