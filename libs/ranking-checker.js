/**
 * AI Engine Ranking Checker — v2 (NVIDIA-powered, no extra API keys required)
 *
 * Strategy: Use the NVIDIA/OpenRouter model already configured in Settings
 * to intelligently predict whether the page would appear in each AI engine's
 * results, based on deep content signals (E-E-A-T, citations, structure, etc.)
 *
 * For engines where the user also has a live API key, we do a real check.
 * For all others we use the NVIDIA/OpenRouter model — so results are always
 * useful and never just "API key not configured".
 */

class RankingChecker {
  constructor() {
    this.perplexityApiKey  = '';
    this.openaiApiKey      = '';
    this.anthropicApiKey   = '';
    this.geminiApiKey      = '';
    this.grokApiKey        = '';
    this.nvidiaApiKey      = '';
    this.openrouterApiKey  = '';
    this.preferredProvider = null;
    this._cancelled        = false;
  }

  async init() {
    return new Promise(resolve => {
      Promise.all([
        new Promise(res => chrome.storage.local.get([
          'perplexityApiKey','openaiApiKey','anthropicApiKey','geminiApiKey','grokApiKey',
          'nvidiaApiKey','openrouterApiKey'
        ], res)),
        new Promise(res => {
          try {
            const cfg = JSON.parse(localStorage.getItem('rp-ai-config') || 'null');
            res({ nvidia: cfg?.nvidiaKey || '', openrouter: cfg?.openrouterKey || '' });
          } catch { res({ nvidia: '', openrouter: '' }); }
        })
      ]).then(([local, ls]) => {
        this.perplexityApiKey  = local.perplexityApiKey  || '';
        this.openaiApiKey      = local.openaiApiKey      || '';
        this.anthropicApiKey   = local.anthropicApiKey   || '';
        this.geminiApiKey      = local.geminiApiKey      || '';
        this.grokApiKey        = local.grokApiKey        || '';
        this.nvidiaApiKey      = local.nvidiaApiKey      || ls.nvidia      || '';
        this.openrouterApiKey  = local.openrouterApiKey  || ls.openrouter  || '';
        this.preferredProvider = this.nvidiaApiKey ? 'nvidia'
          : this.openrouterApiKey ? 'openrouter' : null;
        resolve();
      });
    });
  }

  async checkAll(url, pageData) {
    const queries = this.generateTestQueries(pageData);
    const query = queries[0] || new URL(url).hostname;
    const domain = new URL(url).hostname.replace(/^www\./i, '');
    const result = await this.checkQuery(query, domain, pageData);
    return { ...result, queries };
  }

  async checkQuery(query, domain, pageData, isCancelled) {
    await this.init();
    this._cancelled = false;

    const cleanQuery = String(query || '').trim();
    const cleanDomain = String(domain || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim();
    const signals  = this._buildContentSignals(pageData || {}, cleanDomain);

    const wrap = (p, ms, label) => {
      const t = new Promise((_, r) => setTimeout(() => r(new Error(`${label} timed out`)), ms));
      return Promise.race([p, t]).catch(err => ({
        ranked: false, reason: err.message, query: cleanQuery, timedOut: true, method: 'error'
      }));
    };

    const [perplexity, chatgpt, claude, gemini, grok, copilot, you, mistral, deepseek, brave] = await Promise.all([
      wrap(this.perplexityApiKey ? this.checkPerplexityLive(cleanQuery, cleanDomain)
                                 : this.predictWithAI(cleanQuery, cleanDomain, 'Perplexity', signals), 14000, 'Perplexity'),
      wrap(this.openaiApiKey     ? this.checkChatGPTLive(cleanQuery, cleanDomain)
                                 : this.predictWithAI(cleanQuery, cleanDomain, 'ChatGPT', signals),    14000, 'ChatGPT'),
      wrap(this.anthropicApiKey  ? this.checkClaudeLive(cleanQuery, cleanDomain)
                                 : this.predictWithAI(cleanQuery, cleanDomain, 'Claude', signals),     14000, 'Claude'),
      wrap(this.geminiApiKey     ? this.checkGeminiLive(cleanQuery, cleanDomain)
                                 : this.predictWithAI(cleanQuery, cleanDomain, 'Gemini', signals),     14000, 'Gemini'),
      wrap(this.grokApiKey       ? this.checkGrokLive(cleanQuery, cleanDomain)
                                 : this.predictWithAI(cleanQuery, cleanDomain, 'Grok', signals),       14000, 'Grok'),
      wrap(this.predictWithAI(cleanQuery, cleanDomain, 'Microsoft Copilot', signals), 14000, 'Copilot'),
      wrap(this.predictWithAI(cleanQuery, cleanDomain, 'You.com', signals),           14000, 'You.com'),
      wrap(this.predictWithAI(cleanQuery, cleanDomain, 'Mistral Le Chat', signals),   14000, 'Mistral'),
      wrap(this.predictWithAI(cleanQuery, cleanDomain, 'DeepSeek', signals),          14000, 'DeepSeek'),
      wrap(this.predictWithAI(cleanQuery, cleanDomain, 'Brave Leo AI', signals),      14000, 'Brave Leo'),
    ]);

    if (this._cancelled || (typeof isCancelled === 'function' && isCancelled())) {
      return { queries: [cleanQuery], engines: {}, overallRanking: 'Cancelled', rankedCount: 0, usedAIPrediction: true, recommendations: [] };
    }

    const engines     = { perplexity, chatgpt, claude, gemini, grok, copilot, you, mistral, deepseek, brave };
    const rankedCount = Object.values(engines).filter(e => e.ranked).length;
    const totalCount  = Object.keys(engines).length;

    return {
      queries: [cleanQuery],
      engines,
      overallRanking:    `${rankedCount}/${totalCount} AI engines`,
      rankedCount,
      usedAIPrediction:  true,
      recommendations:   this.generateRecommendations(engines, signals)
    };
  }

  /* ─── AI-powered prediction using NVIDIA / OpenRouter ─── */
  async predictWithAI(query, domain, engineName, signals) {
    if (!this.preferredProvider) {
      return this._heuristicPrediction(query, domain, engineName, signals);
    }

    const engineHints = {
      Perplexity: 'prioritises authoritative sources with external citations, factual structured content, and named sources',
      ChatGPT:    'prioritises E-E-A-T signals (author bio, credentials), comprehensive FAQ content, well-structured articles',
      Claude:     'prioritises well-organised nuanced content, clear definitions, entity-rich text with sourced claims',
      Gemini:     'prioritises Schema.org structured data, Google-indexed entities, knowledge graph signals, AMP/mobile-friendly pages',
      Grok:       'prioritises real-time relevance, Q&A format, conversational tone, and social engagement signals'
    };

    const prompt = `You are an AI search ranking expert. Predict if "${domain}" would appear in ${engineName} results for the query: "${query}".

${engineName} ranking factors: ${engineHints[engineName]}

PAGE SIGNALS:
- Title: "${signals.title}" (${signals.titleLength} chars)
- Meta description: ${signals.metaDescLength} chars
- Word count: ${signals.wordCount}
- Headings: ${signals.h1Count} H1, ${signals.h2Count} H2
- H2 topics: ${signals.h2Topics.join(', ')}
- Schema types: ${signals.schemaTypes.join(', ') || 'none'}
- Has FAQ: ${signals.hasFAQ}
- Has author signals: ${signals.hasAuthor}
- Images with alt: ${signals.imagesWithAlt}/${signals.totalImages}
- Internal links: ${signals.internalLinks}
- External links: ${signals.externalLinks}
- HTTPS: ${signals.hasHttps}

Respond ONLY with valid JSON (no markdown, no explanation):
{"ranked":true,"confidence":"high","score":75,"reason":"one sentence","signals_found":[],"signals_missing":[],"position_estimate":3}`;

    try {
      const raw    = await this._callAI(prompt);
      const clean  = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const parsed = JSON.parse(clean);
      return {
        ranked:         Boolean(parsed.ranked),
        query,
        method:         'ai_prediction',
        engine:         engineName,
        confidence:     parsed.confidence || 'medium',
        score:          parsed.score || 0,
        reason:         parsed.reason || '',
        signalsFound:   parsed.signals_found   || [],
        signalsMissing: parsed.signals_missing || [],
        position:       parsed.position_estimate || null,
        citation:       parsed.ranked ? `AI predicts ${domain} would appear for: "${query}"` : null,
        fullResponse:   parsed.reason || ''
      };
    } catch (e) {
      console.error('[RankingChecker] predictWithAI error:', e);
      return this._heuristicPrediction(query, domain, engineName, signals);
    }
  }

  _heuristicPrediction(query, domain, engineName, s) {
    let score = 0;
    if (s.hasSchema)           score += 20;
    if (s.hasFAQ)              score += 15;
    if (s.wordCount > 800)     score += 15;
    if (s.hasAuthor)           score += 10;
    if (s.internalLinks > 3)   score += 5;
    if (s.metaDescLength > 50) score += 5;
    if (s.h2Count > 2)         score += 5;
    if (s.imagesWithAlt > 2)   score += 5;
    if (engineName === 'Gemini'     && s.hasSchema)        score += 10;
    if (engineName === 'Perplexity' && s.wordCount > 1200) score += 10;
    const ranked = score >= 40;
    return {
      ranked, query, method: 'heuristic', engine: engineName, confidence: 'low', score,
      reason: ranked
        ? `Page has sufficient signals (score ${score}/100) for ${engineName}`
        : `Page lacks key signals for ${engineName} (score ${score}/100)`,
      signalsFound:   this._listFound(s),
      signalsMissing: this._listMissing(s, engineName),
      position: null
    };
  }

  _buildContentSignals(pageData, domain) {
    const imagesWithAlt = (pageData.images || []).filter(i => i.hasAlt).length;
    const h2s = (pageData.headings || []).filter(h => h.level === 2);
    const content = (pageData.rawContent || '').toLowerCase();
    const hasFAQ   = content.includes('frequently asked') || content.includes('faq') ||
                     (pageData.headings || []).some(h => /faq|question/i.test(h.text));
    const hasAuthor = content.includes('author') || content.includes('written by') ||
                      content.includes('by ') || content.includes('published by');
    return {
      domain,
      title:          pageData.title || '',
      titleLength:    (pageData.title || '').length,
      metaDescLength: (pageData.description || '').length,
      wordCount:      pageData.wordCount || 0,
      h1Count:        (pageData.headings || []).filter(h => h.level === 1).length,
      h2Count:        h2s.length,
      h2Topics:       h2s.slice(0, 6).map(h => h.text),
      imagesWithAlt,
      totalImages:    (pageData.images || []).length,
      internalLinks:  (pageData.internalLinks || []).length,
      externalLinks:  (pageData.externalLinks || []).length,
      hasSchema:      (pageData.schemas || []).length > 0,
      schemaTypes:    (pageData.schemas || []).map(s => s.type || s['@type']).filter(Boolean),
      hasFAQ,
      hasAuthor,
      hasHttps:       (pageData.url || '').startsWith('https'),
    };
  }

  _listFound(s) {
    const f = [];
    if (s.hasSchema)           f.push('Schema markup present');
    if (s.hasFAQ)              f.push('FAQ content found');
    if (s.hasAuthor)           f.push('Author/E-E-A-T signals found');
    if (s.wordCount > 800)     f.push(`Good content length (${s.wordCount} words)`);
    if (s.h2Count > 2)         f.push(`${s.h2Count} H2 headings for structure`);
    if (s.imagesWithAlt > 0)   f.push(`${s.imagesWithAlt} images with alt text`);
    if (s.hasHttps)            f.push('HTTPS enabled');
    if (s.metaDescLength > 50) f.push('Meta description present');
    return f;
  }

  _listMissing(s, engine) {
    const m = [];
    if (!s.hasSchema)           m.push('Schema.org markup');
    if (!s.hasFAQ)              m.push('FAQ / Q&A section');
    if (!s.hasAuthor)           m.push('Author bio / E-E-A-T signals');
    if (s.wordCount < 800)      m.push('Longer content (800+ words)');
    if (s.h2Count < 3)          m.push('More H2 headings for structure');
    if (s.metaDescLength < 50)  m.push('Compelling meta description');
    if (engine === 'Perplexity' && s.externalLinks < 2) m.push('Authoritative external citations');
    if (engine === 'Gemini'     && !s.hasSchema)         m.push('Structured data for Gemini indexing');
    return m.slice(0, 4);
  }

  async _callAI(prompt) {
    const isNvidia = this.preferredProvider === 'nvidia';
    const url   = isNvidia
      ? 'https://integrate.api.nvidia.com/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
    const model = isNvidia ? 'meta/llama-3.3-70b-instruct' : 'meta-llama/llama-3.3-70b-instruct';
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${isNvidia ? this.nvidiaApiKey : this.openrouterApiKey}`
    };
    if (!isNvidia) {
      headers['HTTP-Referer'] = chrome.runtime.getURL('');
      headers['X-Title']     = 'ShahzaibSEO';
    }
    const resp = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Return ONLY valid JSON. No markdown. No explanation.' },
          { role: 'user',   content: prompt }
        ],
        temperature: 0.15,
        max_tokens: 300
      })
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      throw new Error(e.error?.message || `API ${resp.status}`);
    }
    return (await resp.json()).choices[0].message.content;
  }

  /* ─── Live checks (when user has individual API keys) ─── */
  async checkPerplexityLive(query, domain) {
    try {
      const r = await fetch('https://api.perplexity.ai/chat/completions', {
        method:'POST',
        headers:{'Authorization':`Bearer ${this.perplexityApiKey}`,'Content-Type':'application/json'},
        body: JSON.stringify({ model:'llama-3.1-sonar-large-128k-online',
          messages:[{role:'user',content:`Search for: ${query}. List top 5 sources with URLs.`}] })
      });
      if (!r.ok) throw new Error(`Perplexity ${r.status}`);
      const d = await r.json();
      const c = d.choices[0].message.content;
      const citations = d.citations || [];
      const ranked = c.toLowerCase().includes(domain.toLowerCase()) ||
                     citations.some(x => x.toLowerCase().includes(domain.toLowerCase()));
      return { ranked, query, method:'live', position: ranked ? this._findPos(c, domain) : null,
               citation: ranked ? this._extractCitation(c, domain) : null, fullResponse: c.substring(0,500) };
    } catch(e) { return { ranked:false, reason:e.message, query, method:'live_error' }; }
  }

  async checkChatGPTLive(query, domain) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST', headers:{'Authorization':`Bearer ${this.openaiApiKey}`,'Content-Type':'application/json'},
        body: JSON.stringify({ model:'gpt-4-turbo',
          messages:[{role:'user',content:`Search for: ${query}. List top 5 results with URLs.`}] })
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status}`);
      const d = await r.json(); const c = d.choices[0].message.content;
      const ranked = c.toLowerCase().includes(domain.toLowerCase());
      return { ranked, query, method:'live', position: ranked ? this._findPos(c, domain) : null, fullResponse: c.substring(0,500) };
    } catch(e) { return { ranked:false, reason:e.message, query, method:'live_error' }; }
  }

  async checkClaudeLive(query, domain) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'x-api-key':this.anthropicApiKey,'anthropic-version':'2023-06-01','Content-Type':'application/json'},
        body: JSON.stringify({ model:'claude-3-haiku-20240307', max_tokens:512,
          messages:[{role:'user',content:`Search for: ${query}. Top sources with URLs.`}] })
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}`);
      const d = await r.json(); const c = d.content[0].text;
      const ranked = c.toLowerCase().includes(domain.toLowerCase());
      return { ranked, query, method:'live', position: ranked ? this._findPos(c, domain) : null, fullResponse: c.substring(0,500) };
    } catch(e) { return { ranked:false, reason:e.message, query, method:'live_error' }; }
  }

  async checkGeminiLive(query, domain) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${this.geminiApiKey}`,
        { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ contents:[{parts:[{text:`Search for: ${query}. List top sources with URLs.`}]}] }) }
      );
      if (!r.ok) throw new Error(`Gemini ${r.status}`);
      const d = await r.json(); const c = d.candidates[0].content.parts[0].text;
      const ranked = c.toLowerCase().includes(domain.toLowerCase());
      return { ranked, query, method:'live', position: ranked ? this._findPos(c, domain) : null, fullResponse: c.substring(0,500) };
    } catch(e) { return { ranked:false, reason:e.message, query, method:'live_error' }; }
  }

  async checkGrokLive(query, domain) {
    try {
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method:'POST', headers:{'Authorization':`Bearer ${this.grokApiKey}`,'Content-Type':'application/json'},
        body: JSON.stringify({ model:'grok-beta',
          messages:[{role:'user',content:`Search for: ${query}. Top results with URLs.`}] })
      });
      if (!r.ok) throw new Error(`Grok ${r.status}`);
      const d = await r.json(); const c = d.choices[0].message.content;
      const ranked = c.toLowerCase().includes(domain.toLowerCase());
      return { ranked, query, method:'live', position: ranked ? this._findPos(c, domain) : null, fullResponse: c.substring(0,500) };
    } catch(e) { return { ranked:false, reason:e.message, query, method:'live_error' }; }
  }

  cancel() {
    this._cancelled = true;
  }

  /* ─── Util ─── */
  generateTestQueries(pageData) {
    const q = [];
    if (pageData.title) q.push(pageData.title.toLowerCase().replace(/[^\w\s]/g,'').substring(0,100));
    const h1 = (pageData.headings || []).find(h => h.level === 1);
    if (h1 && !q.includes(h1.text.toLowerCase())) q.push(h1.text.toLowerCase().substring(0,100));
    if (!q.length) q.push(new URL(pageData.url).hostname.replace('www.',''));
    return q.slice(0,3);
  }

  _findPos(content, domain) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(domain.toLowerCase())) continue;
      const m = lines[i].match(/^(\d+)\./);
      return m ? parseInt(m[1]) : i + 1;
    }
    return null;
  }

  _extractCitation(content, domain) {
    return content.split('\n').find(l => l.toLowerCase().includes(domain.toLowerCase()))?.trim().substring(0,200) || null;
  }

  generateRecommendations(engines, signals) {
    const r = [];
    if (!engines.perplexity?.ranked) r.push('Add authoritative external citations — Perplexity prioritises sourced content');
    if (!engines.chatgpt?.ranked)    r.push('Add author bio with credentials (E-E-A-T) and a FAQ section for ChatGPT');
    if (!engines.claude?.ranked)     r.push('Improve content structure with clear definitions and organised sections for Claude');
    if (!engines.gemini?.ranked)     r.push('Add Schema.org JSON-LD markup to improve Gemini structured data indexing');
    if (!engines.grok?.ranked)       r.push('Add Q&A / FAQ format and real-time engagement signals for Grok');
    if (!engines.copilot?.ranked)    r.push('Ensure Bing indexing is active — Microsoft Copilot sources from Bing Search');
    if (!engines.you?.ranked)        r.push('Add clear citations and references — You.com prioritises well-sourced content');
    if (!engines.mistral?.ranked)    r.push('Improve multilingual content and technical depth for Mistral Le Chat');
    if (!engines.deepseek?.ranked)   r.push('Add technical depth, data, and structured reasoning for DeepSeek visibility');
    if (!engines.brave?.ranked)      r.push('Ensure Brave Search indexing — Brave Leo AI uses Brave\'s independent index');
    if (signals && signals.wordCount < 800)  r.push('Expand content to 800+ words — all AI engines prefer comprehensive coverage');
    if (signals && !signals.hasSchema)       r.push('Implement JSON-LD Schema (Article, FAQPage, BreadcrumbList) for AI indexing');
    return r;
  }

  async deepRankCheck(query, domain, options = {}) {
    const { pages = 3 } = options;
    const results = {
      query,
      domain,
      timestamp: new Date().toISOString(),
      positions: [],
      competitors: [],
      targetPosition: null
    };

    for (let page = 0; page < pages; page++) {
      await new Promise((resolve) => setTimeout(resolve, 500 * page));

      const serpPrediction = await this.predictWithAI(
        query,
        domain,
        'Google SERP',
        this._buildContentSignals({
          title: query,
          description: '',
          headings: [],
          images: [],
          internalLinks: [],
          externalLinks: [],
          schemas: [],
          rawContent: ''
        }, domain)
      );

      results.positions.push({
        page: page + 1,
        ...serpPrediction
      });

      if (serpPrediction.ranked && !results.targetPosition) {
        results.targetPosition = serpPrediction.position || (page * 10 + 1);
      }
    }

    return results;
  }

  async checkAIEngineRankings(url, pageData) {
    await this.init();

    const domain = new URL(url).hostname;
    const signals = this._buildContentSignals(pageData, domain);

    const checks = await Promise.all([
      this.perplexityApiKey ? this.checkPerplexityLive(url, domain)
                            : this.predictWithAI(url, domain, 'Perplexity', signals),
      this.openaiApiKey     ? this.checkChatGPTLive(url, domain)
                            : this.predictWithAI(url, domain, 'ChatGPT', signals),
      this.anthropicApiKey  ? this.checkClaudeLive(url, domain)
                            : this.predictWithAI(url, domain, 'Claude', signals),
      this.predictWithAI(url, domain, signals)
    ]);

    return {
      perplexity: checks[0],
      chatgpt: checks[1],
      claude: checks[2],
      predictions: checks[3],
      summary: this.summarizeRankings(checks)
    };
  }

  summarizeRankings(checks) {
    const ranked = checks.filter(c => c.ranked === true).length;
    const total = checks.filter(c => c.ranked !== null).length;

    return {
      rankedCount: ranked,
      totalChecked: total,
      percentage: total > 0 ? Math.round((ranked / total) * 100) : 0,
      status: ranked >= total * 0.5 ? 'Good' : 'Needs improvement'
    };
  }

  async clusterKeywords(keywords, options = {}) {
    const { maxClusters = 20, minClusterSize = 2 } = options;

    if (!keywords || keywords.length === 0) return [];

    const byNgram = {
      1: keywords.filter(k => k.ngram === 1),
      2: keywords.filter(k => k.ngram === 2),
      3: keywords.filter(k => k.ngram === 3)
    };

    const clusters = [];
    const processed = new Set();

    byNgram[1].forEach(kw => {
      if (processed.has(kw.word)) return;

      const cluster = {
        id: clusters.length + 1,
        primaryKeyword: kw.word,
        keywords: [kw],
        volume: kw.searchVolume || 0,
        intent: this.determineIntent(kw.word)
      };

      byNgram[2].forEach(bi => {
        if (bi.word.includes(kw.word) || kw.word.includes(bi.word.split(' ')[0])) {
          if (!processed.has(bi.word)) {
            cluster.keywords.push(bi);
            cluster.volume += bi.searchVolume || 0;
          }
        }
      });

      byNgram[3].forEach(tri => {
        if (tri.word.includes(kw.word)) {
          if (!processed.has(tri.word)) {
            cluster.keywords.push(tri);
            cluster.volume += tri.searchVolume || 0;
          }
        }
      });

      if (cluster.keywords.length >= minClusterSize) {
        clusters.push(cluster);
        cluster.keywords.forEach(k => processed.add(k.word));
      }
    });

    clusters.sort((a, b) => b.volume - a.volume);
    return clusters.slice(0, maxClusters);
  }

  determineIntent(keyword) {
    const transactional = ['buy', 'price', 'shop', 'order', 'deal', 'discount', 'coupon'];
    const informational = ['how', 'what', 'why', 'guide', 'tutorial', 'tips', 'best'];
    const navigational = ['login', 'signin', 'app', 'download', 'portal'];

    const lower = keyword.toLowerCase();

    if (transactional.some(t => lower.includes(t))) return 'transactional';
    if (informational.some(i => lower.includes(i))) return 'informational';
    if (navigational.some(n => lower.includes(n))) return 'navigational';
    return 'informational';
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = RankingChecker;
