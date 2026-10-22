// Self-contained function: Chrome serializes this function into the selected tab.
export function inspectPage() {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const all = (selector) => Array.from(document.querySelectorAll(selector));
  const meta = (name) => all('meta').find((el) => (el.getAttribute('name') || '').toLowerCase() === name)?.content || '';
  const words = (text) => (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []);
  const absolute = (value) => { try { return new URL(value, location.href).href; } catch { return null; } };
  const body = document.body?.cloneNode(true);
  body?.querySelectorAll('script,style,noscript,template,svg,nav,footer,[hidden],[aria-hidden="true"]').forEach(el => el.remove());
  const text = clean(body?.textContent);
  const tokens = words(text);
  const lower = tokens.map(w => w.toLocaleLowerCase());
  const counts = new Map();
  const stop = new Set('a an the and or but of in on to for with by is are was were be been it its this that as at from you your we our they their not can will has have'.split(' '));
  for (const word of lower) if (word.length > 2 && !stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  const headings = all('h1,h2,h3,h4,h5,h6').map(el => ({level: Number(el.tagName[1]), text: clean(el.textContent)}));
  const headingSkips = headings.filter((item, i) => i && item.level > headings[i - 1].level + 1).length;
  const images = all('img').map(el => ({src: el.currentSrc || absolute(el.getAttribute('src')), alt: el.getAttribute('alt'), loading: el.loading, width: el.naturalWidth || el.width, height: el.naturalHeight || el.height, dimensionsDeclared: el.hasAttribute('width') && el.hasAttribute('height')}));
  const links = all('a[href]').map(el => {
    const raw = el.getAttribute('href'); const href = absolute(raw);
    if (!href) return null;
    const url = new URL(href);
    const rel = (el.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    return {href, text: clean(el.textContent || el.getAttribute('aria-label') || el.querySelector('img')?.alt), internal: url.hostname === location.hostname, protocol: url.protocol, nofollow: rel.includes('nofollow'), sponsored: rel.includes('sponsored'), ugc: rel.includes('ugc'), newTab: el.target === '_blank', noopener: rel.includes('noopener') || rel.includes('noreferrer')};
  }).filter(Boolean);
  const schemas = all('script[type="application/ld+json"]').map((el, index) => {
    try {
      const data = JSON.parse(el.textContent);
      const types = new Set();
      const walk = (v, depth = 0) => {
        if (!v || typeof v !== 'object' || depth > 40) return;
        if (Array.isArray(v)) {v.forEach(item => walk(item, depth + 1));return;}
        if (v['@type']) [v['@type']].flat().forEach(t => types.add(String(t)));
        Object.values(v).forEach(item => walk(item, depth + 1));
      };
      walk(data);
      return {index: index + 1, valid: true, types: [...types], data};
    } catch (error) {return {index: index + 1, valid: false, error: error.message};}
  });
  const canonical = all('link[rel]').find(el => el.rel.toLowerCase().split(/\s+/).includes('canonical'))?.href || null;
  const robots = [meta('robots'), meta('googlebot')].filter(Boolean).join(', ');
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter(Boolean).length || 1;
  const syllables = lower.reduce((sum, word) => sum + Math.max(1, (word.replace(/e$/, '').match(/[aeiouy]+/g) || []).length), 0);
  const readingEase = tokens.length ? Math.round(206.835 - 1.015 * (tokens.length / sentences) - 84.6 * (syllables / tokens.length)) : null;
  const social = all('meta[property],meta[name]').filter(el => /^(og:|twitter:)/i.test(el.getAttribute('property') || el.name)).map(el => ({name: el.getAttribute('property') || el.name, content: el.content}));
  const navigation = performance.getEntriesByType('navigation')[0];
  const timings = navigation ? {responseMs: Math.round(navigation.responseStart - navigation.requestStart), domReadyMs: Math.round(navigation.domContentLoadedEventEnd), loadMs: Math.round(navigation.loadEventEnd), transferBytes: navigation.transferSize} : null;
  const technologies = [];
  if (meta('generator')) technologies.push({name: meta('generator'), evidence: 'generator meta tag'});
  const scriptUrls = all('script[src]').map(el => el.src);
  if (scriptUrls.some(url => url.includes('/wp-content/')) || all('link[href]').some(el => el.href.includes('/wp-content/'))) technologies.push({name:'WordPress', evidence:'wp-content asset path'});
  if (document.querySelector('#__NEXT_DATA__,script[src*="/_next/"]')) technologies.push({name:'Next.js', evidence:'Next.js data or asset marker'});
  if (document.querySelector('[data-shopify],script[src*="cdn.shopify.com"]')) technologies.push({name:'Shopify', evidence:'Shopify DOM or asset marker'});
  const result = {
    version: 1, url: location.href, hostname: location.hostname, capturedAt: new Date().toISOString(),
    title: clean(document.title), description: clean(meta('description')), canonical, robots,
    language: document.documentElement.lang || '', viewport: meta('viewport'), https: location.protocol === 'https:',
    headings, headingSkips, images, links, schemas, social, technologies, timings,
    content: {words: tokens.length, characters: text.length, sentences, readingMinutes: Math.ceil(tokens.length / 220), readingEase, keywords: [...counts].sort((a,b) => b[1] - a[1]).slice(0,30).map(([word,count]) => ({word,count,density: tokens.length ? Number((count / tokens.length * 100).toFixed(2)) : 0})), excerpt: text.slice(0,1600)},
    technical: {domNodes: all('*').length, scriptCount: all('script').length, stylesheetCount: all('link[rel="stylesheet"]').length, mixedContent: location.protocol === 'https:' ? all('[src]').filter(el => (el.getAttribute('src') || '').startsWith('http://')).length : 0, hreflang: all('link[hreflang]').map(el => ({language:el.hreflang,url:el.href})), insecureForms: all('form[action]').filter(el => absolute(el.getAttribute('action'))?.startsWith('http://')).length}
  };
  return result;
}
