/**
 * Schema Generator — JSON-LD for current page (GEO / AI search)
 * Default AI: built-in Groq; optional NVIDIA / OpenRouter / Grok
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  const BUILTIN_GROQ = '';
  const BUILTIN_MODEL = 'qwen/qwen3.8-27b';

  let _lastJson = '';
  let _running = false;

  function setStatus(msg) {
    const el = $('schemaStatus');
    if (el) el.textContent = msg || '';
  }

  function getSchemaType() {
    const el = document.querySelector('input[name="schemaType"]:checked');
    return (el && el.value) || 'auto';
  }

  function getSchemaAi() {
    const el = document.querySelector('input[name="schemaAi"]:checked');
    return (el && el.value) || 'groq';
  }

  async function extractPage(tabId) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, error: 'Extract timeout' }), 22000);
      chrome.tabs.sendMessage(tabId, { action: 'fullPageExtract', options: { maxMs: 10000 } }, r => {
        clearTimeout(t);
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(r || { ok: false, error: 'No response' });
      });
    });
  }

  async function loadAiConfig(forceProvider) {
    const keys = await new Promise(res => chrome.storage.local.get([
      'nvidiaApiKey', 'openrouterApiKey', 'groqApiKey', 'grokApiKey',
      'nvidiaModel', 'openrouterModel', 'groqModel', 'grokModel'
    ], res));

    const p = forceProvider || 'groq';
    if (p === 'nvidia') {
      const k = (keys.nvidiaApiKey || '').trim();
      if (!k) throw new Error('Add NVIDIA API key in Settings');
      return {
        provider: 'nvidia',
        apiKey: k,
        model: keys.nvidiaModel || 'meta/llama-3.3-70b-instruct',
        baseUrl: 'https://integrate.api.nvidia.com/v1'
      };
    }
    if (p === 'openrouter') {
      const k = (keys.openrouterApiKey || '').trim();
      if (!k) throw new Error('Add OpenRouter API key in Settings');
      return {
        provider: 'openrouter',
        apiKey: k,
        model: keys.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free',
        baseUrl: 'https://openrouter.ai/api/v1'
      };
    }
    if (p === 'grok') {
      const k = (keys.grokApiKey || '').trim();
      if (!k) throw new Error('Add Grok (xAI) API key in Settings');
      return {
        provider: 'grok',
        apiKey: k,
        model: keys.grokModel || 'grok-3',
        baseUrl: 'https://api.x.ai/v1'
      };
    }
    // Groq built-in
    const userGroq = (keys.groqApiKey || '').trim();
    const apiKey = (typeof window.resolveGroqKey === 'function')
      ? window.resolveGroqKey(userGroq)
      : (userGroq || BUILTIN_GROQ);
    return {
      provider: 'groq',
      apiKey,
      model: keys.groqModel || BUILTIN_MODEL,
      baseUrl: 'https://api.groq.com/openai/v1',
      builtin: !userGroq
    };
  }

  async function callAI(cfg, prompt) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey
    };
    if (cfg.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://www.mubashirhassan.com';
      headers['X-Title'] = 'ShahzaibSEO Schema Generator';
    }
    const resp = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          {
            role: 'system',
            content: 'You are a Schema.org / JSON-LD expert for SEO and AI search (Google, Bing, ChatGPT, Perplexity). Output ONLY valid JSON-LD. No markdown fences, no commentary. Current date context: September 2026 — do not use 2024 or 2025 as dates unless the page content requires it.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2500,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(60000)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error?.message || data?.message || ('HTTP ' + resp.status));
    return data?.choices?.[0]?.message?.content || '';
  }

  function parseJsonLoose(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/^```(?:json|ld\+json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    // Extract first { ... } block if needed
    if (!s.startsWith('{') && !s.startsWith('[')) {
      const i = s.indexOf('{');
      const j = s.lastIndexOf('}');
      if (i >= 0 && j > i) s = s.slice(i, j + 1);
    }
    return JSON.parse(s);
  }

  function pretty(obj) {
    return JSON.stringify(obj, null, 2);
  }

  async function generate() {
    if (_running) return;
    _running = true;
    const btn = $('schemaGenBtn');
    if (btn) btn.disabled = true;
    const out = $('schemaOutput');

    try {
      setStatus('Reading active page…');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || /^chrome/i.test(tab.url)) {
        throw new Error('Open a normal website page first.');
      }

      setStatus('Crawling page (scroll extract)…');
      let extract = await extractPage(tab.id);
      if (!extract.ok && /Receiving end|Could not establish/i.test(extract.error || '')) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
          await new Promise(r => setTimeout(r, 400));
          extract = await extractPage(tab.id);
        } catch (_) {}
      }
      if (!extract.ok) throw new Error(extract.error || 'Could not extract page');

      const schemaType = getSchemaType();
      const aiProv = getSchemaAi();
      setStatus('AI (' + aiProv + '): generating JSON-LD…');
      const cfg = await loadAiConfig(aiProv);

      const meta = extract.meta || {};
      const outline = (extract.outline || []).slice(0, 25)
        .map(h => 'H' + h.level + ': ' + h.text).join('\n');
      const textSample = (extract.fullText || '').slice(0, 8000);
      const existing = (extract.schemaTypes || []).join(', ') || 'none detected';

      const prompt = `Generate a complete, valid Schema.org JSON-LD object for this web page so it can rank in Google rich results and be cited by AI search engines.

PREFERRED @type: ${schemaType === 'auto' ? 'Auto-detect the best primary type (Article, FAQPage, Product, Service, LocalBusiness, Organization, HowTo, or WebPage). You may use @graph for multiple types.' : schemaType}

PAGE:
- URL: ${extract.url}
- Title: ${meta.title || ''}
- Meta description: ${meta.description || ''}
- H1: ${meta.h1 || ''}
- Language: ${meta.lang || 'en'}
- Existing schema types on page: ${existing}

HEADINGS:
${outline || '(none)'}

PAGE TEXT (excerpt):
${textSample}

RULES:
1. Output ONE JSON object only (or @graph). Valid JSON-LD.
2. Include @context: https://schema.org
3. Include url, name/headline, description when applicable
4. For Article: headline, datePublished/dateModified if inferable (use 2026 if unknown year needed), author as Organization or Person, mainEntityOfPage
5. For FAQPage: mainEntity array of Question/Answer from real Q&A on the page only — do not invent FAQs
6. For Product/Service: name, description, offers if price visible
7. For LocalBusiness: name, address if present, telephone if present
8. Do not invent phone numbers, addresses, ratings, or prices not in the page text
9. Prefer specific types over generic WebPage when content supports it
10. No markdown, no comments — pure JSON only`;

      const raw = await callAI(cfg, prompt);
      const obj = parseJsonLoose(raw);
      _lastJson = pretty(obj);
      if (out) out.textContent = _lastJson;
      setStatus('Done · ' + (cfg.builtin ? 'Groq built-in' : cfg.provider) + ' · ' + (obj['@type'] || obj['@graph'] ? 'schema ready' : 'JSON ready'));
      if (typeof toast === 'function') toast('Schema generated');
    } catch (err) {
      setStatus('Failed: ' + (err.message || 'error'));
      if (out) out.textContent = '// Error: ' + (err.message || 'failed');
      if (typeof toast === 'function') toast(err.message || 'Schema failed');
    } finally {
      _running = false;
      if (btn) btn.disabled = false;
    }
  }

  function copyJson() {
    if (!_lastJson) {
      if (typeof toast === 'function') toast('Generate schema first');
      return;
    }
    navigator.clipboard.writeText(_lastJson).then(() => {
      if (typeof toast === 'function') toast('JSON copied');
    }).catch(() => {});
  }

  function copyScript() {
    if (!_lastJson) {
      if (typeof toast === 'function') toast('Generate schema first');
      return;
    }
    const tag = '<script type="application/ld+json">\n' + _lastJson + '\n</' + 'script>';
    navigator.clipboard.writeText(tag).then(() => {
      if (typeof toast === 'function') toast('<script> tag copied');
    }).catch(() => {});
  }

  function init() {
    const g = $('schemaGenBtn');
    if (g && !g.dataset.bound) {
      g.dataset.bound = '1';
      g.addEventListener('click', generate);
    }
    const c = $('schemaCopyBtn');
    if (c && !c.dataset.bound) {
      c.dataset.bound = '1';
      c.addEventListener('click', copyJson);
    }
    const s = $('schemaCopyScriptBtn');
    if (s && !s.dataset.bound) {
      s.dataset.bound = '1';
      s.addEventListener('click', copyScript);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.ShahzaibSEOSchemaGenerator = { generate, getLast: () => _lastJson };
})();
