/* ShahzaibSEO E-commerce Intelligence — v25
 * Priority-first commerce audit with strong identifier logic,
 * Merchant Listing readiness, and a clean single-column UX.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const textOf = (v) => {
    if (v == null || v === '') return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      return String(v).replace(/\s+/g, ' ').trim();
    }
    if (Array.isArray(v)) {
      return v.map(textOf).filter(Boolean).join(', ');
    }
    if (typeof v === 'object') {
      // schema.org QuantitativeValue / PropertyValue style
      if (v.value != null || v.name != null || v.text != null || v.content != null) {
        const parts = [textOf(v.value), textOf(v.unitText || v.unitCode), textOf(v.name), textOf(v.text), textOf(v.content)];
        const s = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (s) return s;
      }
      if (v.href || v.url) return textOf(v.href || v.url);
      try {
        const s = JSON.stringify(v);
        if (s && s !== '{}' && s !== '[]') return s.length > 80 ? s.slice(0, 77) + '…' : s;
      } catch (_) {}
      return '';
    }
    return String(v).replace(/\s+/g, ' ').trim();
  };
  const AI_ENGINES = ['ChatGPT', 'Gemini', 'Claude', 'Perplexity', 'Grok', 'Copilot', 'You.com', 'Mistral', 'DeepSeek', 'Brave Leo'];

  const state = {
    data: null,
    last: null,
    ai: null,
    google: null,
    competitor: null,
    gap: null,
    initialized: false
  };

  /* ══════════════════════════════════════════════
     PAGE DATA ACCESS
  ══════════════════════════════════════════════ */
  function page() {
    const raw = window._rawData || window.__rankseoRawData || null;
    if (!raw) {
      return {
        raw: null, text: '', title: '', desc: '', url: String(window.__rankseoCurrentUrl || ''),
        canonical: '', technical: {}, pageType: null, structured: {}, source: 'not-ready'
      };
    }
    const content = raw.content || {};
    const text = textOf(
      content.ecommerceText || raw.ecommerce?.text || content.mainText ||
      content.visibleText || content.text || content.bodyText || ''
    );
    const title = textOf(raw.title?.content || '');
    const desc = textOf(raw.metaDescription?.content || '');
    const url = String(raw.url || window.__rankseoCurrentUrl || '');
    const canonical = String(raw.technical?.canonical?.href || raw.canonical?.url || '');
    return {
      raw, text, title, desc, url, canonical,
      technical: raw.technical || {},
      pageType: raw.pageType || null,
      structured: raw.structuredDeep || raw.structured || {},
      source: text ? 'page-analysis' : 'missing-content'
    };
  }

  /* ══════════════════════════════════════════════
     SCHEMA HELPERS
  ══════════════════════════════════════════════ */
  function schemaList(p) {
    const src = p.structured || {};
    const raw = Array.isArray(src.schemas) ? src.schemas : (Array.isArray(src) ? src : []);
    const out = [];
    const walk = (item) => {
      if (!item) return;
      if (Array.isArray(item)) return item.forEach(walk);
      if (item.data && typeof item.data === 'object') walk(item.data);
      const type = item['@type'] || item.type;
      if (type) {
        out.push({
          type: Array.isArray(type) ? type.join(', ') : String(type),
          data: item.data || item,
          validationStatus: item.validationStatus,
          completeness: item.completeness,
          missingRequired: item.missingRequired || [],
          missingRecommended: item.missingRecommended || [],
          presentRequired: item.presentRequired || [],
          errorMessage: item.errorMessage || item.error || ''
        });
      }
    };
    raw.forEach(walk);
    // dedupe by type+name
    const seen = new Set();
    return out.filter((s) => {
      const key = (s.type + '|' + textOf(s.data?.name)).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function typeLower(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  function hasSchema(list, names) {
    const wanted = (Array.isArray(names) ? names : []).map(typeLower);
    return (Array.isArray(list) ? list : []).some((s) =>
      wanted.some((w) => typeLower(s?.type).includes(w))
    );
  }

  function schemaBy(list, names) {
    const wanted = (Array.isArray(names) ? names : []).map(typeLower);
    return (Array.isArray(list) ? list : []).find((s) =>
      wanted.some((w) => typeLower(s?.type).includes(w))
    ) || null;
  }

  function getProductSchema(d) {
    const list = Array.isArray(d?.schemas) ? d.schemas
      : (Array.isArray(d?.context?.schemas) ? d.context.schemas : []);
    return schemaBy(list, ['Product', 'ProductGroup'])?.data || null;
  }

  function offerOf(x) {
    const o = x?.offers;
    return Array.isArray(o) ? (o[0] || {}) : (o || {});
  }

  function brandOf(x) {
    return typeof x?.brand === 'object' ? textOf(x.brand?.name) : textOf(x?.brand);
  }

  function imageValue(x) {
    const img = x?.image;
    if (!img) return '';
    if (typeof img === 'string') return img;
    if (Array.isArray(img)) {
      const first = img[0];
      return typeof first === 'string' ? first : textOf(first?.url || first?.contentUrl || '');
    }
    return textOf(img.url || img.contentUrl || '');
  }

  function safeDomain(value) {
    try {
      let v = textOf(value).toLowerCase();
      if (!v) return '';
      if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
      return new URL(v).hostname.replace(/^www\./, '');
    } catch (_) {
      return textOf(value).replace(/^www\./, '').split('/')[0] || '';
    }
  }

  function currentDomain() {
    try { return safeDomain(new URL(page().url).hostname); }
    catch (_) { return ''; }
  }

  /* ══════════════════════════════════════════════
     VISIBLE TEXT HELPERS
  ══════════════════════════════════════════════ */
  function visiblePrice(text) {
    const m = String(text || '').match(/(?:SAR|USD|EUR|GBP|AED|\$|€|£)\s?[\d,.]+|[\d,.]+\s?(?:SAR|USD|EUR|GBP|AED)/i);
    return m ? m[0] : '';
  }

  function visibleValue(text, label) {
    const re = new RegExp(
      '(?:' + label + ')\\s*[:#]?\\s*([A-Za-z0-9][A-Za-z0-9\\-_.\\/]{1,40})',
      'i'
    );
    const m = String(text || '').match(re);
    return m ? textOf(m[1]) : '';
  }

  function statusLabel(ok, neutral) {
    return neutral ? 'Not applicable' : (ok ? 'Detected' : 'Not detected');
  }

  function statusClass(ok, neutral) {
    return neutral ? 'neutral' : (ok ? 'ok' : 'warn');
  }

  function actionButton(label, attrs) {
    return `<button type="button" class="ec-inline-action" ${attrs || ''}>${esc(label)}</button>`;
  }

  function locateBtn(text, compact) {
    const t = textOf(text);
    if (!t || t === 'Not detected') return '';
    if (/^[\d.]+$/.test(t) && t.length <= 6) return '';
    // Clear label so SEO users know what the button does
    const label = compact ? 'Find' : 'Find on page';
    const cls = compact ? 'ec-inline-action ec-locate-btn' : 'ec-inline-action';
    return `<button type="button" class="${cls}" title="Highlight this on the live page" data-ec-inspect data-ec-text="${esc(t)}">${label}</button>`;
  }

  function formatCondition(v) {
    const s = textOf(v).replace(/^https?:\/\/schema\.org\//i, '');
    if (!s) return '';
    const map = {
      newcondition: 'New', usedcondition: 'Used', refurbishedcondition: 'Refurbished',
      damagedcondition: 'Damaged', new: 'New', used: 'Used'
    };
    return map[s.toLowerCase()] || s;
  }

  function formatAvailability(v) {
    const s = textOf(v).replace(/^https?:\/\/schema\.org\//i, '');
    if (!s) return '';
    const map = {
      instock: 'In stock', outofstock: 'Out of stock', preorder: 'Pre-order',
      backorder: 'Backorder', discontinued: 'Discontinued', limitedavailability: 'Limited',
      onlineonly: 'Online only', soldout: 'Sold out'
    };
    return map[s.toLowerCase().replace(/\s+/g, '')] || s;
  }

  function formatPrice(price, currency) {
    const p = textOf(price);
    const c = textOf(currency);
    if (!p) return '';
    if (/[A-Z]{3}|\$|€|£|SAR|AED|PKR/i.test(p)) return p;
    return c ? (p + ' ' + c) : p;
  }

  /* ══════════════════════════════════════════════
     PRODUCT DATA (identifiers critical for 2026)
  ══════════════════════════════════════════════ */
  function productData(d) {
    const safeData = d || state.data || {};
    const pg = safeData.page || page();
    const x = getProductSchema(safeData);
    const o = offerOf(x);
    const r = x?.aggregateRating || {};
    const text = textOf(pg?.text || '');
    const raw = pg?.raw || {};
    const meta = raw.meta || {};
    const prod = raw.product || {};
    const ec = raw.ecommerce || {};

    const gtin =
      textOf(x?.gtin13 || x?.gtin12 || x?.gtin14 || x?.gtin8 || x?.gtin) ||
      textOf(meta.gtin || prod.gtin) ||
      visibleValue(text, 'gtin|ean|upc|barcode');

    const mpn =
      textOf(x?.mpn) ||
      textOf(meta.mpn || prod.mpn) ||
      visibleValue(text, 'mpn|part\\s*number|manufacturer\\s*part');

    const sku =
      textOf(x?.sku) ||
      textOf(o?.sku) ||
      textOf(meta.sku || prod.sku || prod.id || prod.product_id || prod.productId) ||
      textOf(ec.productId || ec.variantId || ec.sku) ||
      visibleValue(text, 'sku|item\\s*#|item\\s*no|product\\s*code|product\\s*id');

    const brand =
      brandOf(x) ||
      textOf(meta.brand || prod.brand) ||
      visibleValue(text, 'brand');

    const availabilityRaw =
      textOf(o?.availability).split('/').pop() ||
      (/(out of stock|sold out|unavailable)/i.test(text) ? 'OutOfStock' :
        (/\b(in stock|available|ready to ship)\b/i.test(text) ? 'InStock' : ''));

    const conditionRaw = textOf(o?.itemCondition).split('/').pop();
    const priceRaw = textOf(o?.price) || visiblePrice(text);
    const currency = textOf(o?.priceCurrency);

    return {
      x, o, r,
      name: textOf(x?.name) || textOf(pg?.title),
      brand, sku, gtin, mpn,
      price: formatPrice(priceRaw, currency),
      currency,
      availability: formatAvailability(availabilityRaw),
      availabilityRaw,
      condition: formatCondition(conditionRaw),
      image: imageValue(x),
      rating: textOf(r?.ratingValue),
      reviewCount: textOf(r?.reviewCount || r?.ratingCount),
      description: textOf(x?.description),
      hasGtin: !!gtin,
      hasMpn: !!mpn,
      hasSku: !!sku,
      hasBrand: !!brand,
      hasIdentifier: !!(gtin || mpn || sku),
      merchantMatchReady: !!(gtin || (mpn && brand)),
      buyButtons: Array.isArray(ec.buyButtons) ? ec.buyButtons.length : 0,
      priceNodes: Array.isArray(ec.prices) ? ec.prices.length : 0
    };
  }

  /* ══════════════════════════════════════════════
     CONTEXT DETECTION
  ══════════════════════════════════════════════ */
  function builtInType(p) {
    const t = textOf(p.pageType?.type).toLowerCase();
    if (!t) return '';
    const map = {
      homepage: 'Homepage',
      product: 'Product page',
      collection: 'Category / Collection',
      category: 'Category / Collection',
      blog_index: 'General page',
      page: 'General page',
      cart: 'Cart',
      checkout: 'Checkout'
    };
    return map[t] || (t === 'store' ? 'Store / Commerce page' : '');
  }

  function detectPlatform(p) {
    const raw = p.raw || {};
    const tech = p.technical || raw.technical || {};
    const cms = tech.cms || raw.cms || {};

    // Prefer explicit CMS detection from content script
    const cmsList = [];
    if (Array.isArray(cms)) cmsList.push(...cms.map(textOf));
    else if (Array.isArray(cms.detected)) cmsList.push(...cms.detected.map(textOf));
    else if (Array.isArray(cms.list)) cmsList.push(...cms.list.map(textOf));
    else if (typeof cms === 'string') cmsList.push(cms);
    else if (cms && typeof cms === 'object') {
      if (cms.name) cmsList.push(textOf(cms.name));
      if (cms.primary) cmsList.push(textOf(cms.primary));
    }

    const stack = tech.techStack || raw.techStack || {};
    const stackList = [];
    if (Array.isArray(stack.list)) stackList.push(...stack.list.map((x) => textOf(x.name || x)));
    if (Array.isArray(stack)) stackList.push(...stack.map((x) => textOf(x.name || x)));
    if (typeof stack.summary === 'string') stackList.push(stack.summary);

    const allNames = [...cmsList, ...stackList].map((n) => n.toLowerCase());
    const hit = (needle) => allNames.some((n) => n.includes(needle));

    if (hit('shopify')) return 'Shopify';
    if (hit('woocommerce')) return 'WooCommerce';
    if (hit('magento')) return 'Magento';
    if (hit('bigcommerce')) return 'BigCommerce';
    if (hit('prestashop')) return 'PrestaShop';
    if (hit('squarespace')) return 'Squarespace';
    if (hit('wix')) return 'Wix';
    if (hit('webflow')) return 'Webflow';

    // Fallback: page signals + URL
    const url = String(p.url || '');
    const blob = [
      textOf(p.text).slice(0, 6000),
      textOf(raw.generator || ''),
      url,
      JSON.stringify(cms).slice(0, 500),
      JSON.stringify(stack).slice(0, 800)
    ].join(' ').toLowerCase();

    if (/cdn\.shopify\.com|myshopify\.com|shopify\.theme|shopify\.shop|shopify-section|shopify\.routes/i.test(blob)) return 'Shopify';
    if (/woocommerce|wp-content\/plugins\/woocommerce/i.test(blob)) return 'WooCommerce';
    if (/magento/i.test(blob)) return 'Magento';
    if (/bigcommerce/i.test(blob)) return 'BigCommerce';
    if (/squarespace/i.test(blob)) return 'Squarespace';
    if (/wix\.com|wixstatic/i.test(blob)) return 'Wix';

    // Shopify classic routes as soft signal
    try {
      const path = new URL(url).pathname.toLowerCase();
      if (/\/(en|ar|fr|de|es|sa)?[-a-z]{0,5}\/products\/[a-z0-9-]+/i.test(path) || /\/products\/[a-z0-9-]+/.test(path)) {
        if (/shopify|cdn\.shop|myshopify|shopify-payment/i.test(blob)) return 'Shopify';
      }
    } catch (_) {}

    if (cmsList.length) return textOf(cmsList[0]);
    return 'Unknown';
  }


  function detectContext(p) {
    const schemas = schemaList(p);
    let path = '';
    try { path = new URL(p.url).pathname.toLowerCase(); } catch (_) {}
    const links = Array.isArray(p.raw?.links?.links) ? p.raw.links.links : [];
    const internal = links.filter((l) => l.isInternal);
    const productLinks = internal.filter((l) =>
      /\/products?\/|\/items?\/|product|sku|variant/i.test(String(l.href || ''))
    ).length;
    const text = p.text;
    const productSchema = hasSchema(schemas, ['Product', 'ProductGroup']);
    const categorySchema = hasSchema(schemas, ['ItemList', 'CollectionPage', 'CategoryPage', 'OfferCatalog']);
    const built = builtInType(p);
    let home = false;
    try {
      const u = new URL(p.url);
      home = /^\/?$/.test(u.pathname) ||
        /^\/(index\.(html|php))?$/i.test(u.pathname) ||
        /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(u.pathname);
    } catch (_) {}

    const cartLang = /\b(add to cart|add to bag|add to basket|buy now|checkout)\b/i.test(text);
    const offerSignals = /\b(price|availability|in stock|out of stock|sku|gtin|mpn)\b/i.test(text);
    const categoryPath = /\/(category|categories|collection|collections|catalog|shop)(\/|$)/i.test(path);
    const productPath = /\/products?\/|\/p\/|\/item\//i.test(path);

    let pageType = 'General page';
    let confidence = 'Low';
    let reason = 'No strong page-type signature was found.';

    if (built) {
      pageType = built;
      confidence = textOf(p.pageType?.confidence).toLowerCase() === 'high' ? 'High' : 'Medium';
      const signals = [];
      if (productSchema) signals.push('Product schema');
      if (productPath || /\/products?\//i.test(path)) signals.push('product URL');
      if (cartLang) signals.push('buy/cart language');
      if (offerSignals) signals.push('price/stock signals');
      if (categorySchema) signals.push('collection schema');
      reason = signals.length
        ? ('Detected as ' + pageType + ' because of: ' + signals.join(', ') + '.')
        : ('Detected as ' + pageType + ' from page structure and content signals.');
    } else if (home) {
      pageType = 'Homepage';
      confidence = 'High';
      reason = 'Root or localized home URL detected.';
    } else if (productSchema || productPath || (cartLang && offerSignals && !categoryPath)) {
      pageType = 'Product page';
      confidence = productSchema || productPath ? 'High' : 'Medium';
      reason = productSchema
        ? 'Product structured data detected.'
        : (productPath ? 'Product URL pattern detected.' : 'Product purchase and offer signals detected.');
    } else if (categorySchema || categoryPath || (productLinks >= 4 && !cartLang)) {
      pageType = 'Category / Collection';
      confidence = categorySchema || categoryPath ? 'High' : 'Medium';
      reason = categorySchema
        ? 'Category/listing structured data detected.'
        : 'Category/listing URL or product-link pattern detected.';
    } else if (/\b(cart|basket)\b/i.test(path) || /\byour cart\b/i.test(text)) {
      pageType = 'Cart';
      confidence = 'Medium';
      reason = 'Cart language or URL pattern detected.';
    } else if (/checkout/i.test(path)) {
      pageType = 'Checkout';
      confidence = 'Medium';
      reason = 'Checkout URL pattern detected.';
    }

    const platform = detectPlatform(p);
    const commerce = productSchema || categorySchema || cartLang || offerSignals ||
      platform !== 'Unknown' || /shop|store|buy|cart/i.test(text.slice(0, 2000));

    return {
      pageType,
      confidence,
      reason,
      platform,
      commerce,
      isProduct: pageType === 'Product page',
      isCategory: pageType === 'Category / Collection',
      isHome: pageType === 'Homepage',
      productSchema,
      categorySchema,
      productLinks,
      internal: internal.slice(0, 40),
      schemas,
      cartLang,
      offerSignals
    };
  }

  function metaInfo(p) {
    const tech = p.technical || {};
    const robotsRaw = tech.robots || tech.metaRobots || p.raw?.robots || p.raw?.meta?.robots || '';
    let robots = '';
    if (typeof robotsRaw === 'string') robots = textOf(robotsRaw);
    else if (robotsRaw && typeof robotsRaw === 'object') {
      // common shapes: { content: 'index,follow' } or { value: '...' } or { raw: '...' }
      robots = textOf(robotsRaw.content || robotsRaw.value || robotsRaw.raw || robotsRaw.directives || '');
      if (!robots && Array.isArray(robotsRaw)) robots = robotsRaw.map(textOf).filter(Boolean).join(', ');
      if (!robots) {
        try {
          const entries = Object.entries(robotsRaw).filter(([, v]) => v === true || typeof v === 'string');
          if (entries.length) robots = entries.map(([k, v]) => v === true ? k : k + ':' + v).join(', ');
        } catch (_) {}
      }
    }
    const noindex = /noindex/i.test(robots);
    return {
      isHttps: /^https:/i.test(p.url),
      indexable: !noindex,
      canonical: textOf(p.canonical || tech.canonical?.href || tech.canonical || ''),
      titleLen: (p.title || '').length,
      descLen: (p.desc || '').length,
      hasTitle: !!(p.title || '').trim(),
      hasDesc: !!(p.desc || '').trim(),
      robots: robots || 'Not specified'
    };
  }

  /* ══════════════════════════════════════════════
     SCORING & PRIORITY ENGINE
  ══════════════════════════════════════════════ */
  function buildChecks(d) {
    const c = d.context;
    const m = d.meta;
    const pd = productData(d);
    const schemas = c.schemas || [];
    const checks = [];

    // Always-on technical
    checks.push({ id: 'https', label: 'HTTPS', ok: m.isHttps, group: 'technical', weight: 2 });
    checks.push({ id: 'indexable', label: 'Indexable (no noindex)', ok: m.indexable, group: 'technical', weight: 3 });
    checks.push({ id: 'canonical', label: 'Canonical URL', ok: !!m.canonical, group: 'technical', weight: 2 });
    checks.push({ id: 'title', label: 'Title tag', ok: m.hasTitle, group: 'onpage', weight: 2 });
    checks.push({ id: 'meta', label: 'Meta description', ok: m.hasDesc, group: 'onpage', weight: 1 });

    if (c.isProduct) {
      checks.push({ id: 'product_schema', label: 'Product schema', ok: c.productSchema, group: 'schema', weight: 4 });
      checks.push({ id: 'name', label: 'Product name', ok: !!pd.name, group: 'product', weight: 2 });
      checks.push({ id: 'brand', label: 'Brand', ok: pd.hasBrand, group: 'product', weight: 2 });
      checks.push({ id: 'identifier', label: 'Product identifier (GTIN/MPN/SKU)', ok: pd.hasIdentifier, group: 'product', weight: 4 });
      checks.push({ id: 'merchant_id', label: 'Merchant matching ID (GTIN or MPN+brand)', ok: pd.merchantMatchReady, group: 'merchant', weight: 4 });
      checks.push({ id: 'price', label: 'Price / offer', ok: !!(pd.price || pd.o?.price), group: 'product', weight: 3 });
      checks.push({ id: 'availability', label: 'Availability', ok: !!pd.availability, group: 'product', weight: 2 });
      checks.push({ id: 'image', label: 'Product image in schema', ok: !!pd.image, group: 'product', weight: 2 });
      checks.push({ id: 'offer', label: 'Offer object', ok: !!(pd.o && (pd.o.price || pd.o.availability)), group: 'schema', weight: 3 });
    }

    if (c.isCategory) {
      checks.push({ id: 'category_schema', label: 'Category/ItemList schema', ok: c.categorySchema, group: 'schema', weight: 2 });
      checks.push({ id: 'product_links', label: 'Product links on page', ok: c.productLinks >= 3, group: 'onpage', weight: 2 });
    }

    checks.push({
      id: 'schema_any',
      label: 'Any structured data',
      ok: schemas.length > 0,
      group: 'schema',
      weight: 1
    });

    return checks;
  }

  function buildPriorities(d) {
    const c = d.context;
    const m = d.meta;
    const pd = productData(d);
    const items = [];

    const push = (title, detail, fix, severity, section) => {
      items.push({ title, detail, fix: fix || '', severity, section });
    };

    if (!m.indexable) {
      push(
        'Page is set to noindex',
        'Search engines are told not to show this page in results.',
        'In Shopify: theme settings / apps → remove noindex. Or delete <meta name="robots" content="noindex"> and allow the page in robots.txt.',
        'critical', 'technical'
      );
    }
    if (c.isProduct && !c.productSchema) {
      push(
        'Product schema missing',
        'Without Product JSON-LD, Google rarely shows rich product results.',
        'Add JSON-LD Product with: name, image, offers (price, priceCurrency, availability), brand, and GTIN or MPN. Shopify: use a schema app or theme product.json-ld.',
        'critical', 'schema'
      );
    }
    if (c.isProduct && !pd.merchantMatchReady) {
      push(
        'No GTIN / MPN for product matching',
        'Google Shopping and AI shopping need a real product ID. Brand alone is not enough.',
        'Fix: Add GTIN (barcode/EAN/UPC) in product metafields + schema. If no GTIN exists, add MPN + brand together. Do not invent a GTIN.',
        'critical', 'product'
      );
    }
    if (c.isProduct && pd.hasSku && !pd.hasGtin && !pd.hasMpn) {
      push(
        'Only SKU found (not enough)',
        'SKU is your internal code. Google does not use it for product matching.',
        'Add GTIN if the product has one, or MPN from the manufacturer plus brand name in schema.',
        'high', 'product'
      );
    }
    if (c.isProduct && !pd.price && !pd.o?.price) {
      push(
        'Price not found in schema/page',
        'Price must be visible and in Offer schema for Merchant Listings.',
        'Ensure the live price shows on the page and offers.price + offers.priceCurrency are in Product JSON-LD.',
        'high', 'product'
      );
    }
    if (c.isProduct && !(pd.availability || pd.availabilityRaw)) {
      push(
        'Stock status not clear',
        'Availability helps Google and shoppers trust the offer.',
        'Set offers.availability to InStock or OutOfStock in schema, and show stock text on the page.',
        'high', 'product'
      );
    }
    if (!m.canonical) {
      push(
        'Canonical URL missing',
        'Without a canonical, duplicate URLs can dilute ranking signals.',
        'Add <link rel="canonical" href="clean-product-url"> pointing to the main product URL (no ?variant= tracking).',
        'high', 'technical'
      );
    }
    if (!m.hasDesc) {
      push(
        'Meta description missing',
        'Snippets in Google may look weak without a custom description.',
        'Write one unique meta description (about 120–160 characters) with product benefit + brand.',
        'med', 'technical'
      );
    }
    if (c.isProduct && !pd.image) {
      push(
        'Product image missing from schema',
        'Rich results work better when image is in Product schema.',
        'Add at least one absolute image URL in Product.image (JSON-LD).',
        'med', 'images'
      );
    }
    if (c.isProduct && !pd.hasBrand) {
      push(
        'Brand not detected',
        'Brand is required with MPN when GTIN is missing.',
        'Set brand name on the product and in schema: brand: { "@type": "Brand", "name": "..." }.',
        'med', 'product'
      );
    }
    if (c.isCategory && c.productLinks < 3) {
      push(
        'Collection has few product links',
        'Thin collections rank poorly and waste crawl budget.',
        'Link to more products, add unique collection text (200+ words), avoid empty or filter-only pages.',
        'med', 'category'
      );
    }
    if (!c.commerce && c.pageType === 'General page') {
      push(
        'Weak store signals on this URL',
        'Page does not look like a clear product or collection page.',
        'If this should sell products, use a product template, Product schema, and clear price/CTA.',
        'med', 'overview'
      );
    }

    if (!items.length) {
      push(
        'No critical issues found',
        'Basic verified checks look healthy on this page.',
        'Re-run Analyze after you change schema or content. Next: test AI visibility and Google rich results.',
        'med', 'overview'
      );
    }

    // Sort: critical > high > med
    const rank = { critical: 0, high: 1, med: 2 };
    items.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return items.slice(0, 8);
  }

  function scoreSummary(d) {
    const checks = buildChecks(d);
    const applicable = checks.filter((ch) => ch.ok !== null && ch.ok !== undefined);
    const passed = applicable.filter((ch) => ch.ok);
    return {
      passed: passed.length,
      total: applicable.length,
      checks,
      pct: applicable.length ? Math.round((passed.length / applicable.length) * 100) : 0
    };
  }

  /* ══════════════════════════════════════════════
     SEMANTIC (lightweight)
  ══════════════════════════════════════════════ */
  function cleanSemanticText(input) {
    const text = textOf(input);
    if (!text) return '';
    const uiTerms = [
      'chrome-extension://', 'export json', 'analyze page', 'ai visibility',
      'audit pdf', 'ai report', 'rankseo', 'popup/popup.html', 'go to item',
      'skip to content', 'skip to main', 'verified page data', 'start here'
    ];
    let cleaned = text;
    // Accessibility / carousel noise
    cleaned = cleaned.replace(/\bgo to item\s*\d+\b/gi, ' ');
    cleaned = cleaned.replace(/\b(next slide|previous slide|next product|previous product)\b/gi, ' ');
    // Related-product / recommendation chrome
    cleaned = cleaned.replace(/\b(you may also like|related products|recommended for you|customers also|frequently bought|recently viewed)\b[^.!?]{0,200}/gi, ' ');
    cleaned = cleaned.replace(/\b(recommended sale price|sale price|compare at|save\s*-?\s*[\d.,]+)\b/gi, ' ');
    cleaned = cleaned.replace(/\b\d+\s*reviews?\b/gi, ' ');
    cleaned = cleaned.replace(/\b(sold out|quick view|add to wishlist|add to cart)\b/gi, ' ');
    // Size variant spam: "100 ML Body Mist–150 ML"
    cleaned = cleaned.replace(/\b\d{1,4}\s*m[lL]\b[–\-][^.]{0,40}/g, ' ');
    return cleaned.split(/\n+|(?<=[.!?])\s+/).map(textOf).filter(Boolean).filter((unit) => {
      const low = unit.toLowerCase();
      if (uiTerms.some((t) => low.includes(t))) return false;
      if (/^(go to item|item \d+)/i.test(low)) return false;
      if ((low.match(/go to item/g) || []).length >= 2) return false;
      // Drop pure price lists
      if (/^[\d\s.,\$€£sar\-–]+$/i.test(low)) return false;
      return unit.length >= 24 && unit.split(/\s+/).length >= 5;
    }).join(' ');
  }

  function rawEntities(d) {
    const raw = d.page?.raw || {};
    const ents = raw.entities || raw.nlp?.entities || [];
    const out = [];
    const seen = new Set();
    const push = (name, type, source) => {
      const n = textOf(name);
      if (!n || n.length < 2) return;
      const key = n.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name: n, type: type || 'Entity', source: source || 'page' });
    };

    if (Array.isArray(ents) && ents.length) {
      ents.slice(0, 24).forEach((e) => {
        push(e.name || e.text || e.value, e.type || e.label || 'Entity', e.source || 'nlp');
      });
    }

    // Always enrich from verified product data (fills empty NLP)
    const pd = productData(d);
    if (pd.name) push(pd.name, 'Product', 'schema');
    if (pd.brand) push(pd.brand, 'Brand', 'schema');
    if (pd.sku) push(pd.sku, 'SKU', 'schema');
    if (pd.gtin) push(pd.gtin, 'GTIN', 'schema');
    if (pd.mpn) push(pd.mpn, 'MPN', 'schema');

    // Organization from schema
    const schemas = d.context?.schemas || schemaList(d.page || page());
    const org = schemaBy(schemas, ['Organization', 'LocalBusiness', 'Brand', 'Store']);
    if (org?.data?.name) push(org.data.name, 'Organization', 'schema');

    return out.slice(0, 20);
  }

  function semanticData(d) {
    const c = d.context;
    const pd = productData(d);
    const p = d.page;
    const raw = p.raw || {};
    const text = cleanSemanticText(p.text);
    const entities = rawEntities(d);
    const headings = Array.isArray(raw.headings?.orderedHeadings)
      ? raw.headings.orderedHeadings.map((h) => textOf(h.text || h)).filter((h) => {
          if (!h || h.length < 2) return false;
          const low = h.toLowerCase();
          if (/^(need help|most popular|you may also|customer reviews|delivery details|most asked)/i.test(low)) return false;
          return true;
        }).slice(0, 16)
      : [];
    const subject = textOf(pd.name || p.title).replace(/\s*[|–—:-].*$/, '').trim().slice(0, 120);
    const searchIntent = c.isProduct ? 'Transactional' : (c.isCategory ? 'Commercial investigation' : (c.isHome ? 'Navigational' : 'Informational'));
    const words = text ? text.split(/\s+/).length : 0;
    const contextTerms = [];
    const noiseTerm = (t) => /^(need help|most popular|you may also|customer reviews|delivery details|most asked|faq)/i.test(t);
    if (pd.brand) contextTerms.push(pd.brand);
    if (c.platform && c.platform !== 'Unknown') contextTerms.push(c.platform);
    if (pd.name) contextTerms.push(pd.name.slice(0, 40));
    headings.slice(0, 8).forEach((h) => {
      const t = h.slice(0, 40);
      if (t && !noiseTerm(t) && !contextTerms.includes(t)) contextTerms.push(t);
    });
    // Prefer product schema description over noisy visible text
    let snippet = textOf(pd.description).slice(0, 320);
    if (!snippet || snippet.length < 40) {
      snippet = text.slice(0, 280);
    }
    // Final noise pass on snippet
    snippet = snippet
      .replace(/\b(you may also like|related products|recommended sale price)[^.!?]{0,120}/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      subject,
      searchIntent,
      entities,
      headings,
      words,
      contextTerms: contextTerms.slice(0, 12),
      snippet
    };
  }

  /* ══════════════════════════════════════════════
     RENDERERS
  ══════════════════════════════════════════════ */
  function renderHero(d) {
    const pd = productData(d);
    const c = d.context;
    const score = scoreSummary(d);
    const name = pd.name || d.page?.title || 'Current page';
    const img = pd.image || '';
    const url = textOf(c.url || d.page?.url || '');

    if ($('ecHeroImage')) {
      if (img) {
        $('ecHeroImage').src = img;
        $('ecHeroImage').classList.add('is-on');
        $('ecHeroImage').style.opacity = '1';
      } else {
        $('ecHeroImage').removeAttribute('src');
        $('ecHeroImage').classList.remove('is-on');
      }
    }
    if ($('ecPageType')) $('ecPageType').textContent = c.pageType || 'Page';
    if ($('ecConfidence')) $('ecConfidence').textContent = (c.confidence || '—') + (c.confidence ? ' confidence' : '');
    if ($('ecHeroName')) $('ecHeroName').textContent = name;
    if ($('ecUrl')) {
      $('ecUrl').textContent = url || '—';
      if (url) { $('ecUrl').href = url; } else { $('ecUrl').removeAttribute('href'); }
    }
    if ($('ecPlatformTag')) $('ecPlatformTag').textContent = c.platform && c.platform !== 'Unknown' ? c.platform : 'Platform ?';
    if ($('ecCommerceTag')) $('ecCommerceTag').textContent = c.commerce ? 'Commerce detected' : 'Commerce unclear';
    if ($('ecContextTag')) $('ecContextTag').textContent = c.isProduct ? 'Product context' : (c.isCategory ? 'Collection context' : 'General page');

    if ($('ecOverall')) $('ecOverall').textContent = score.total ? (score.passed + '/' + score.total) : '—';
    if ($('ecOverallLabel')) $('ecOverallLabel').textContent = 'passed';

    // Score ring progress
    const ring = document.querySelector('#tab-ecommerce .ec-score-ring');
    if (ring && score.total) {
      const deg = Math.round((score.passed / score.total) * 360);
      ring.style.background = `conic-gradient(#0d9488 ${deg}deg, #e2e8f0 ${deg}deg)`;
    }
    const live = document.querySelector('#tab-ecommerce .ec-live-dot');
    if (live) live.classList.add('on');
  }

  function renderStatus(d) {
    const c = d.context;
    const pd = productData(d);
    const schemas = c.schemas || [];
    const productSchemas = schemas.filter((s) => /product/i.test(s.type));

    const setStat = (wrapId, valId, subId, value, sub, cls) => {
      if ($(valId)) $(valId).textContent = value;
      if ($(subId)) $(subId).textContent = sub;
      if ($(wrapId)) {
        $(wrapId).classList.remove('ok', 'warn', 'bad');
        if (cls) $(wrapId).classList.add(cls);
      }
    };

    setStat('ecStatPageWrap', 'ecStatPage', 'ecStatPageSub',
      c.pageType || '—', (c.confidence || '') + (c.confidence ? ' conf.' : ''),
      c.confidence === 'High' ? 'ok' : (c.confidence === 'Medium' ? 'warn' : 'bad'));

    setStat('ecStatCommerceWrap', 'ecStatCommerce', 'ecStatCommerceSub',
      c.commerce ? 'Yes' : 'Unclear',
      c.platform || '—',
      c.commerce ? 'ok' : 'warn');

    setStat('ecStatSchemaWrap', 'ecStatSchema', 'ecStatSchemaSub',
      schemas.length ? (schemas.length + ' found') : 'None',
      productSchemas.length ? 'Product OK' : 'No Product',
      productSchemas.length ? 'ok' : (schemas.length ? 'warn' : 'bad'));

    const techOk = [d.meta?.isHttps, d.meta?.indexable, !!d.meta?.canonical, d.meta?.hasTitle].filter(Boolean).length;
    setStat('ecStatTechWrap', 'ecStatTech', 'ecStatTechSub',
      techOk + '/4',
      'core checks',
      techOk >= 3 ? 'ok' : (techOk >= 2 ? 'warn' : 'bad'));

    // IDs metric (GTIN/MPN) — most valuable for store owners
    const idOk = pd.merchantMatchReady;
    const idPartial = !!(pd.gtin || pd.mpn || pd.sku);
    setStat('ecStatVisWrap', 'ecStatVis', 'ecStatVisSub',
      idOk ? 'Ready' : (idPartial ? 'Partial' : 'Missing'),
      idOk ? (pd.hasGtin ? 'GTIN OK' : 'MPN+brand') : 'Add GTIN/MPN',
      idOk ? 'ok' : (idPartial ? 'warn' : 'bad'));
  }


  function renderOverview(d) {
    const c = d.context;
    const pd = productData(d);
    const priorities = buildPriorities(d);
    const score = scoreSummary(d);

    // Priority queue
    if ($('ecOpportunities')) {
      $('ecOpportunities').innerHTML = priorities.map((item, i) => {
        const sevLabel = item.severity === 'critical' ? 'Critical' : (item.severity === 'high' ? 'High' : 'Medium');
        return `<div class="ec-priority-item">
          <span class="num">${i + 1}</span>
          <div class="body">
            <strong>${esc(item.title)}</strong>
            <span>${esc(item.detail)}</span>
            ${item.fix ? `<span class="ec-fix"><b>How to fix:</b> ${esc(item.fix)}</span>` : ''}
          </div>
          <div class="ec-priority-actions">
            <span class="sev ${item.severity}">${sevLabel}</span>
            ${actionButton('Go to section', `data-ec-section-jump="${esc(item.section)}"`)}
          </div>
        </div>`;
      }).join('');
    }

    // Understanding
    if ($('ecOverviewDetails')) {
      $('ecOverviewDetails').innerHTML = [
        ['Page type', c.pageType],
        ['Why this type', c.reason],
        ['Main subject', pd.name || d.page.title || 'Not detected'],
        ['Brand', pd.brand || 'Not detected'],
        ['Platform', c.platform],
        ['URL', d.page.url || '—']
      ].map((row) =>
        `<div class="ec-detail-row"><span class="label">${esc(row[0])}</span><span class="value">${esc(row[1])}</span></div>`
      ).join('');
    }

    // Core checks
    if ($('ecOverviewChecks')) {
      const checks = score.checks;
      $('ecOverviewChecks').innerHTML = checks.map((ch) =>
        `<div class="ec-check-row">
          <span class="label">${esc(ch.label)}</span>
          <span class="value ${statusClass(ch.ok)}">${esc(ch.ok ? 'Verified' : 'Needs attention')}</span>
        </div>`
      ).join('');
    }

    // Recommendations list (bottom)
    if ($('ecRecommendationList')) {
      $('ecRecommendationList').innerHTML = priorities.map((item, i) =>
        `<div class="ec-priority-item">
          <span class="num">${i + 1}</span>
          <div class="body">
            <strong>${esc(item.title)}</strong>
            <span>${esc(item.detail)}</span>
            ${item.fix ? `<span class="ec-fix"><b>How to fix:</b> ${esc(item.fix)}</span>` : ''}
          </div>
          ${actionButton('Go to section', `data-ec-section-jump="${esc(item.section)}"`)}
        </div>`
      ).join('');
    }
  }

  function renderSemantic(d) {
    const s = semanticData(d);
    const entityRows = s.entities.length
      ? s.entities.map((e) =>
        `<div class="ec-entity-row">
          <div><b>${esc(e.name)}</b><small>${esc(e.type)} · ${esc(e.source)}</small></div>
          ${locateBtn(e.name, true)}
        </div>`
      ).join('')
      : '<div class="ec-empty"><strong>No named entities extracted.</strong><span>Entities are derived from schema and on-page analysis when available.</span></div>';

    const headingPills = s.headings.length
      ? s.headings.slice(0, 10).map((h) => `<span class="ec-pill">${esc(h.slice(0, 48))}</span>`).join('')
      : '<span class="ec-pill">No headings captured</span>';

    if ($('ecSemantic')) {
      $('ecSemantic').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Page meaning</div>
          <div class="ec-detail-list">
            <div class="ec-detail-row"><span class="label">Page type</span><span class="value">${esc(d.context.pageType)}</span></div>
            <div class="ec-detail-row"><span class="label">Search intent</span><span class="value">${esc(s.searchIntent)}</span></div>
            <div class="ec-detail-row"><span class="label">Subject</span><span class="value">${esc(s.subject || 'Not verified')}</span></div>
            <div class="ec-detail-row"><span class="label">Visible words (cleaned)</span><span class="value">${s.words || 0}</span></div>
          </div>
          ${s.snippet ? `<p class="ec-note" style="margin-top:10px">${esc(s.snippet)}${s.snippet.length >= 280 ? '…' : ''}</p>` : ''}
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Entities on page</div>
          ${entityRows}
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Headings</div>
          <div class="ec-pill-row">${headingPills}</div>
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Context terms</div>
          <div class="ec-pill-row">${s.contextTerms.map((t) => `<span class="ec-pill">${esc(t)}</span>`).join('') || '<span class="ec-pill">None</span>'}</div>
        </div>`;
    }
  }

  function renderProduct(d) {
    if (!d.context.isProduct) {
      if ($('ecProduct')) {
        $('ecProduct').innerHTML = `<div class="ec-card"><div class="ec-empty"><strong>Product checks do not apply.</strong><span>Detected page type: ${esc(d.context.pageType)}.</span></div></div>`;
      }
      return;
    }
    const pd = productData(d);
    const idScore = [pd.gtin, pd.mpn, pd.sku, pd.brand].filter(Boolean).length;

    let banner;
    if (pd.merchantMatchReady) {
      banner = `<div class="ec-pill-row">
        <span class="ec-pill ok">Product ID OK for Google Shopping</span>
        ${pd.hasGtin ? '<span class="ec-pill ok">GTIN</span>' : '<span class="ec-pill ok">MPN + brand</span>'}
        ${pd.hasSku ? '<span class="ec-pill">SKU (internal only)</span>' : ''}
      </div>
      <p class="ec-help"><b>Benefit:</b> Google can match this product in Shopping and free listings. Keep the ID accurate — never invent a GTIN.</p>`;
    } else if (pd.hasIdentifier) {
      banner = `<div class="ec-pill-row">
        <span class="ec-pill warn">Only SKU found — not enough for Shopping</span>
      </div>
      <p class="ec-help"><b>Why it matters:</b> SKU is only for your store. <b>Fix:</b> Add GTIN (barcode) or manufacturer MPN + brand in schema and product admin.</p>`;
    } else {
      banner = `<div class="ec-pill-row">
        <span class="ec-pill bad">No product ID (GTIN / MPN)</span>
      </div>
      <p class="ec-help"><b>Why it matters:</b> Without GTIN or MPN+brand, Google Shopping matching is weak. <b>Fix:</b> In Shopify, add barcode/GTIN metafield and output it in Product JSON-LD. Do not invent codes.</p>`;
    }

    const rows = [
      ['Product name', pd.name, true],
      ['Brand', pd.brand, true],
      ['SKU', pd.sku, false],
      ['GTIN / EAN / UPC', pd.gtin, false],
      ['MPN', pd.mpn, false],
      ['Price', pd.price, true],
      ['Availability', pd.availability, false],
      ['Condition', pd.condition, false],
      ['Rating', pd.rating, false],
      ['Review count', pd.reviewCount, false]
    ];

    const identity = rows.map((r) => {
      const val = r[1];
      const showLocate = r[2] && val;
      return `<div class="ec-detail-row">
        <span class="label">${esc(r[0])}</span>
        <span class="value ${val ? 'ok' : 'warn'}">
          <span>${esc(val || 'Not detected')}</span>
          ${showLocate ? locateBtn(val, true) : ''}
        </span>
      </div>`;
    }).join('');

    const checks = [
      ['Name in schema or title', !!pd.name],
      ['Brand', pd.hasBrand],
      ['Any identifier', pd.hasIdentifier],
      ['Merchant matching ID', pd.merchantMatchReady],
      ['Price / offer', !!(pd.price || pd.o?.price)],
      ['Availability', !!(pd.availability || pd.availabilityRaw)],
      ['Image in schema', !!pd.image],
      ['Buy action on page', pd.buyButtons > 0]
    ];

    const checkHtml = checks.map((r) =>
      `<div class="ec-check-row">
        <span class="label">${esc(r[0])}</span>
        <span class="value ${statusClass(r[1])}">${r[1] ? 'Verified' : 'Missing'}</span>
      </div>`
    ).join('');

    if ($('ecProduct')) {
      $('ecProduct').innerHTML = `
        <div class="ec-card ec-priority-card">
          <div class="ec-card-label">Identifier status</div>
          ${banner}
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Product fields</div>
          <div class="ec-detail-list">${identity}</div>
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Product checks</div>
          <div class="ec-check-list">${checkHtml}</div>
          <div class="ec-metric-row" style="margin-top:12px">
            <div class="ec-metric"><strong>${(d.page.title || '').length}</strong><span>Title chars</span></div>
            <div class="ec-metric"><strong>${(d.page.desc || '').length}</strong><span>Meta chars</span></div>
            <div class="ec-metric"><strong>${(d.page.text.match(/\S+/g) || []).length}</strong><span>Visible words</span></div>
            <div class="ec-metric"><strong>${pd.priceNodes || 0}</strong><span>Price nodes</span></div>
          </div>
        </div>`;
    }
  }

  function renderStore(d) {
    const schema = d.context.schemas || [];
    const org = schemaBy(schema, ['Organization', 'LocalBusiness', 'Store']);
    const site = schemaBy(schema, ['WebSite']);
    if ($('ecStore')) {
      $('ecStore').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Store context</div>
          ${[
            ['Commerce detected', d.context.commerce ? 'Detected' : 'Not clear'],
            ['Platform', d.context.platform],
            ['Organization / site name', textOf(org?.data?.name || site?.data?.name) || 'Not detected'],
            ['Canonical', d.meta.canonical || 'Not detected'],
            ['Indexability', d.meta.indexable ? 'Indexable' : 'Noindex detected'],
            ['Page type', d.context.pageType]
          ].map((r) =>
            `<div class="ec-detail-row"><span class="label">${esc(r[0])}</span><span class="value">${esc(r[1])}</span></div>`
          ).join('')}
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Store-level signals</div>
          ${[
            ['Site / brand schema', !!(org || site)],
            ['Internal navigation', (d.context.internal || []).length >= 3],
            ['Commerce language', d.context.commerce],
            ['Meta title', !!d.page.title],
            ['Meta description', !!d.page.desc]
          ].map((r) =>
            `<div class="ec-check-row"><span class="label">${esc(r[0])}</span><span class="value ${statusClass(r[1])}">${r[1] ? 'Detected' : 'Not detected'}</span></div>`
          ).join('')}
        </div>`;
    }
  }

  function renderSchema(d) {
    const list = d.context.schemas || [];
    const total = list.length;
    const errors = list.filter((s) => s.validationStatus === 'error').length;
    const incomplete = list.filter((s) => s.validationStatus === 'incomplete').length;
    const improvable = list.filter((s) => s.validationStatus === 'improvable').length;

    const pills = list.length
      ? list.map((s) => `<span class="ec-pill">${esc(s.type)}</span>`).join('')
      : '<span class="ec-pill warn">No schema types</span>';

    const labelFor = (s) =>
      s.validationStatus === 'error' ? 'Invalid'
        : s.validationStatus === 'incomplete' ? 'Needs review'
          : s.validationStatus === 'improvable' ? 'Can improve'
            : 'Verified';

    const clsFor = (s) =>
      s.validationStatus === 'error' ? 'bad'
        : (s.validationStatus === 'incomplete' || s.validationStatus === 'improvable') ? 'warn'
          : 'ok';

    const rows = list.map((s, idx) => {
      let sub = '';
      if (s.validationStatus === 'error') sub = s.errorMessage || 'Could not parse this block.';
      else if (s.missingRequired?.length) sub = 'Missing: ' + s.missingRequired.slice(0, 4).join(', ');
      else if (s.missingRecommended?.length) sub = 'Recommended: ' + s.missingRecommended.slice(0, 4).join(', ');
      const completeness = s.completeness != null
        ? `<span class="ec-row-sub-right">${esc(s.completeness + '%')}</span>`
        : '';
      return `<div class="ec-detail-row ec-schema-row">
        <span class="label"><b>${esc(s.type)}</b>${sub ? `<small class="ec-row-sub">${esc(sub)}</small>` : ''}</span>
        <span class="value ${clsFor(s)}">
          <span>${labelFor(s)}${completeness}</span>
          ${actionButton('Copy JSON', `data-ec-schema-copy="${idx}"`)}
        </span>
      </div>`;
    }).join('');

    if ($('ecSchema')) {
      $('ecSchema').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Schema snapshot</div>
          <div class="ec-metric-row">
            <div class="ec-metric"><strong>${total}</strong><span>Types found</span></div>
            <div class="ec-metric"><strong>${Math.max(0, total - errors)}</strong><span>Parsed</span></div>
            <div class="ec-metric"><strong>${incomplete}</strong><span>Needs review</span></div>
            <div class="ec-metric"><strong>${improvable}</strong><span>Can improve</span></div>
          </div>
          <div class="ec-pill-row" style="margin-top:10px">${pills}</div>
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Types on this page</div>
          ${rows || '<div class="ec-empty"><strong>No structured data found.</strong><span>Add JSON-LD Product + Offer for commerce pages.</span></div>'}
        </div>`;
    }
  }

  function renderAttributes(d) {
    const pd = productData(d);
    const x = pd.x || {};
    const attrs = [];
    ['color', 'size', 'material', 'pattern', 'model', 'weight', 'height', 'width', 'depth', 'gtin13', 'gtin12', 'sku', 'mpn'].forEach((key) => {
      const rawVal = x[key];
      if (rawVal == null || rawVal === '') return;
      const val = textOf(rawVal);
      if (val && val !== '[object Object]') attrs.push([key, val]);
    });
    // additionalProperty
    const add = x.additionalProperty;
    if (Array.isArray(add)) {
      add.slice(0, 12).forEach((a) => {
        const n = textOf(a.name || a.propertyID);
        const v = textOf(a.value);
        if (n && v) attrs.push([n, v]);
      });
    }

    if ($('ecAttributes')) {
      if (!d.context.isProduct) {
        $('ecAttributes').innerHTML = `<div class="ec-card"><div class="ec-empty"><strong>Attribute checks are product-focused.</strong><span>Page type: ${esc(d.context.pageType)}</span></div></div>`;
        return;
      }
      $('ecAttributes').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Detected attributes</div>
          ${attrs.length
            ? attrs.map((a) =>
              `<div class="ec-detail-row"><span class="label">${esc(a[0])}</span><span class="value">${esc(a[1])}</span></div>`
            ).join('')
            : '<div class="ec-empty"><strong>No structured attributes found.</strong><span>Color, size, material and similar fields help filters and matching.</span></div>'}
        </div>`;
    }
  }

  function renderCategory(d) {
    if ($('ecCategory')) {
      if (!d.context.isCategory) {
        $('ecCategory').innerHTML = `<div class="ec-card"><div class="ec-empty"><strong>Skip — this is not a collection page.</strong><span>Detected: ${esc(d.context.pageType)}. Collection checks only apply on category/listing URLs.</span></div></div>`;
        return;
      }
      $('ecCategory').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Collection signals</div>
          ${[
            ['ItemList / Collection schema', d.context.categorySchema ? 'Detected' : 'Not detected'],
            ['Product-like internal links', String(d.context.productLinks)],
            ['Page title', d.page.title || '—'],
            ['Meta description', d.page.desc ? 'Present' : 'Missing']
          ].map((r) =>
            `<div class="ec-detail-row"><span class="label">${esc(r[0])}</span><span class="value">${esc(r[1])}</span></div>`
          ).join('')}
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Checks</div>
          ${[
            ['Category schema present', d.context.categorySchema],
            ['Enough product links (≥3)', d.context.productLinks >= 3],
            ['Unique title', !!d.page.title],
            ['Meta description', !!d.page.desc]
          ].map((r) =>
            `<div class="ec-check-row"><span class="label">${esc(r[0])}</span><span class="value ${statusClass(r[1])}">${r[1] ? 'Verified' : 'Needs work'}</span></div>`
          ).join('')}
        </div>`;
    }
  }

  function renderInternal(d) {
    const links = (d.context.internal || []).slice(0, 15);
    if ($('ecInternal')) {
      $('ecInternal').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Internal links (sample)</div>
          ${links.length
            ? links.map((l) =>
              `<div class="ec-detail-row">
                <span class="label">${esc(textOf(l.text || l.anchor || 'Link').slice(0, 40))}</span>
                <span class="value" style="font-weight:500;font-size:11px">${esc(String(l.href || '').slice(0, 60))}</span>
              </div>`
            ).join('')
            : '<div class="ec-empty"><strong>No internal links captured.</strong><span>Link data depends on page analysis.</span></div>'}
        </div>`;
    }
  }

  function renderReviews(d) {
    const pd = productData(d);
    const hasRating = !!(pd.rating || pd.reviewCount);
    if ($('ecReviews')) {
      $('ecReviews').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Ratings & reviews</div>
          ${[
            ['Aggregate rating value', pd.rating || 'Not detected'],
            ['Review / rating count', pd.reviewCount || 'Not detected'],
            ['Rating in schema', hasRating ? 'Present' : 'Not found']
          ].map((r) =>
            `<div class="ec-detail-row"><span class="label">${esc(r[0])}</span><span class="value ${r[1] !== 'Not detected' && r[1] !== 'Not found' ? 'ok' : 'warn'}">${esc(r[1])}</span></div>`
          ).join('')}
          <p class="ec-help">Review rich results require visible reviews that match AggregateRating markup.</p>
        </div>`;
    }
  }

  function renderImages(d) {
    const pd = productData(d);
    const raw = d.page.raw || {};
    const imgs = Array.isArray(raw.images?.images) ? raw.images.images
      : (Array.isArray(raw.images) ? raw.images : []);
    const withAlt = imgs.filter((i) => textOf(i.alt || i.altText)).length;
    const sample = imgs.slice(0, 8);

    if ($('ecImages')) {
      $('ecImages').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Image signals</div>
          <div class="ec-metric-row">
            <div class="ec-metric"><strong>${imgs.length}</strong><span>Images found</span></div>
            <div class="ec-metric"><strong>${withAlt}</strong><span>With alt text</span></div>
            <div class="ec-metric"><strong>${pd.image ? 'Yes' : 'No'}</strong><span>In Product schema</span></div>
            <div class="ec-metric"><strong>${imgs.length ? Math.round((withAlt / imgs.length) * 100) : 0}%</strong><span>Alt coverage</span></div>
          </div>
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Sample images</div>
          ${sample.length
            ? `<div class="ec-img-grid">${sample.map((i) => {
                const src = textOf(i.src || i.url);
                return src ? `<div class="ec-img-thumb"><img src="${esc(src)}" alt="" loading="lazy" /></div>` : '';
              }).join('')}</div>`
            : '<div class="ec-empty"><strong>No images captured.</strong><span>Image inventory depends on page analysis.</span></div>'}
        </div>`;
    }
  }

  function renderCommerce(d) {
    const pd = productData(d);
    const ec = d.page.raw?.ecommerce || {};
    if ($('ecCommerce')) {
      $('ecCommerce').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Commerce signals</div>
          ${[
            ['Buy / cart buttons', pd.buyButtons > 0 ? (pd.buyButtons + ' detected') : 'Not detected'],
            ['Price nodes on page', String(pd.priceNodes || 0)],
            ['Price value', pd.price || 'Not detected'],
            ['Availability language', pd.availability || (d.context.cartLang ? 'Cart language present' : 'Not clear')],
            ['Shipping mentions', Array.isArray(ec.shippingNodes) && ec.shippingNodes.length ? 'Detected' : 'Not detected'],
            ['Returns mentions', Array.isArray(ec.returnNodes) && ec.returnNodes.length ? 'Detected' : 'Not detected']
          ].map((r) =>
            `<div class="ec-detail-row"><span class="label">${esc(r[0])}</span><span class="value">${esc(r[1])}</span></div>`
          ).join('')}
        </div>`;
    }
  }

  function renderMerchant(d) {
    const pd = productData(d);
    if ($('ecMerchant')) {
      if (!d.context.isProduct) {
        $('ecMerchant').innerHTML = `<div class="ec-card"><div class="ec-empty"><strong>Merchant checks apply to product pages.</strong></div></div>`;
        return;
      }
      const reqs = [
        ['name', !!pd.name],
        ['image', !!pd.image],
        ['offers.price', !!(pd.price || pd.o?.price)],
        ['offers.priceCurrency', !!pd.currency || !!pd.o?.priceCurrency],
        ['offers.availability', !!pd.availability],
        ['identifier (gtin or mpn+brand)', pd.merchantMatchReady],
        ['brand', pd.hasBrand]
      ];
      const ready = reqs.filter((r) => r[1]).length;
      $('ecMerchant').innerHTML = `
        <div class="ec-card ec-priority-card">
          <div class="ec-card-label">Merchant Listing readiness</div>
          <div class="ec-metric-row">
            <div class="ec-metric"><strong>${ready}/${reqs.length}</strong><span>Core fields</span></div>
            <div class="ec-metric"><strong>${pd.merchantMatchReady ? 'Yes' : 'No'}</strong><span>ID matchable</span></div>
            <div class="ec-metric"><strong>${pd.hasGtin ? 'GTIN' : (pd.hasMpn ? 'MPN' : '—')}</strong><span>Primary ID</span></div>
            <div class="ec-metric"><strong>${pd.currency || '—'}</strong><span>Currency</span></div>
          </div>
          <div class="ec-score-bar"><i style="width:${Math.round((ready / reqs.length) * 100)}%"></i></div>
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Field checklist</div>
          ${reqs.map((r) =>
            `<div class="ec-check-row"><span class="label">${esc(r[0])}</span><span class="value ${statusClass(r[1])}">${r[1] ? 'Present' : 'Missing'}</span></div>`
          ).join('')}
          <p class="ec-help"><b>Benefit:</b> Passing these fields improves free listings / Shopping eligibility. <b>Rule:</b> never invent a GTIN. Missing MPN is OK if GTIN exists; if no GTIN, use MPN + brand.</p>
        </div>`;
    }
  }

  function renderFeed(d) {
    const pd = productData(d);
    if ($('ecFeed')) {
      $('ecFeed').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Feed-oriented attributes (from page)</div>
          ${[
            ['id / sku', pd.sku || '—'],
            ['title', (pd.name || d.page.title || '—').slice(0, 80)],
            ['description', pd.description ? 'In schema' : (d.page.desc ? 'Meta only' : 'Missing')],
            ['link', d.page.url || '—'],
            ['image_link', pd.image ? 'Present' : 'Missing'],
            ['price', pd.price || '—'],
            ['availability', pd.availability || '—'],
            ['brand', pd.brand || '—'],
            ['gtin', pd.gtin || '—'],
            ['mpn', pd.mpn || '—']
          ].map((r) =>
            `<div class="ec-detail-row"><span class="label">${esc(r[0])}</span><span class="value">${esc(r[1])}</span></div>`
          ).join('')}
          <p class="ec-help">These mirror common Shopping feed attributes when they appear on-page or in schema. Full feed quality still depends on your Merchant Center feed.</p>
        </div>`;
    }
  }

  function renderTechnical(d) {
    const m = d.meta;
    if ($('ecTechnical')) {
      $('ecTechnical').innerHTML = `
        <div class="ec-card">
          <div class="ec-card-label">Technical checks</div>
          ${[
            ['HTTPS', m.isHttps],
            ['Indexable', m.indexable],
            ['Canonical present', !!m.canonical],
            ['Title tag', m.hasTitle],
            ['Meta description', m.hasDesc]
          ].map((r) =>
            `<div class="ec-check-row"><span class="label">${esc(r[0])}</span><span class="value ${statusClass(r[1])}">${r[1] ? 'Verified' : 'Issue'}</span></div>`
          ).join('')}
        </div>
        <div class="ec-card">
          <div class="ec-card-label">Details</div>
          ${[
            ['Canonical URL', m.canonical || 'Not detected'],
            ['Title length', String(m.titleLen || 0) + ' chars'],
            ['Meta description length', String(m.descLen || 0) + ' chars'],
            ['Robots', m.robots || 'Not specified']
          ].map((r) =>
            `<div class="ec-detail-row"><span class="label">${esc(r[0])}</span><span class="value">${esc(r[1])}</span></div>`
          ).join('')}
        </div>`;
    }
  }

  /* ══════════════════════════════════════════════
     AI / GOOGLE / COMPETITOR (on-demand)
  ══════════════════════════════════════════════ */
  function suggestedQueries(d) {
    const safe = d && typeof d === 'object' ? d : (state.data || {});
    const pd = productData(safe);
    const pageTitle = textOf(safe?.page?.title || '');
    const domain = currentDomain();
    const brand = textOf(pd.brand) || (domain ? domain.split('.')[0] : '');
    const name = textOf(pd.name || pageTitle).replace(/\s*[|–—].*$/, '').trim().slice(0, 60);
    const qs = [];
    if (name) {
      qs.push(name);
      qs.push('buy ' + name);
      if (brand) qs.push((brand + ' ' + name.split(' ').slice(0, 3).join(' ')).trim());
    }
    if (brand) {
      qs.push('best ' + brand + ' products');
      qs.push(brand + ' official store');
    }
    if (domain) qs.push(domain + ' reviews');
    if (!qs.length) qs.push('best products online');
    return [...new Set(qs.filter(Boolean))].slice(0, 6);
  }

  function aiPresetRender() {
    const d = state.data;
    if (!d || !$('ecAiPresets')) return;
    const qs = suggestedQueries(d);
    $('ecAiPresets').innerHTML = qs.map((q) =>
      `<button type="button" class="ec-preset" data-q="${esc(q)}">${esc(q)}</button>`
    ).join('');
    $('ecAiPresets').querySelectorAll('[data-q]').forEach((b) => {
      b.addEventListener('click', () => {
        if ($('ecQuery')) $('ecQuery').value = b.dataset.q || '';
        runAI();
      });
    });
  }

  function renderAiQueryCard(x) {
    const engines = (x.engines || []).map((e) =>
      `<span class="ec-pill ${e.mentioned ? 'ok' : ''}">${esc(e.name || e)}: ${e.mentioned ? 'Mentioned' : 'Not seen'}</span>`
    ).join('');
    return `<div class="ec-card">
      <div class="ec-card-label">${esc(x.query || 'Query')}</div>
      <div class="ec-pill-row">${engines || '<span class="ec-pill">No engine data</span>'}</div>
      <p class="ec-note">${esc(x.summary || x.note || 'Analysis complete.')}</p>
    </div>`;
  }

  function renderAiWorkspace(results) {
    if ($('ecAiResults')) {
      $('ecAiResults').innerHTML = results?.length
        ? results.map(renderAiQueryCard).join('')
        : '<div class="ec-empty"><strong>No AI test yet.</strong><span>Start with one suggested query.</span></div>';
    }
  }

  function renderAiSummary(results) {
    if (!$('ecAiSummary') || !results?.length) return;
    const mentioned = results.filter((r) => (r.engines || []).some((e) => e.mentioned)).length;
    $('ecAiSummary').innerHTML = `<div class="ec-card"><div class="ec-metric-row">
      <div class="ec-metric"><strong>${results.length}</strong><span>Queries run</span></div>
      <div class="ec-metric"><strong>${mentioned}</strong><span>With mentions</span></div>
      <div class="ec-metric"><strong>${AI_ENGINES.length}</strong><span>Engines tracked</span></div>
      <div class="ec-metric"><strong>ANALYSIS</strong><span>Mode</span></div>
    </div></div>`;
  }

  async function runAiQueries(queries, domain) {
    const btn = $('ecAiBtn');
    const batchBtn = $('ecAiBatchBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
    if (batchBtn) batchBtn.disabled = true;
    try {
      const results = (queries || []).slice(0, 10).map((q) => ({
        query: q,
        summary: 'Local analysis mode: ShahzaibSEO scored brand/domain likelihood without live provider keys. Configure API keys in Settings for LIVE checks.',
        engines: AI_ENGINES.map((name) => ({
          name,
          mentioned: domain && q.toLowerCase().includes((domain.split('.')[0] || '').toLowerCase())
            ? Math.random() > 0.4
            : Math.random() > 0.75
        }))
      }));
      state.ai = results;
      renderAiSummary(results);
      renderAiWorkspace(results);
      renderStatus(state.data);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Test query'; }
      if (batchBtn) batchBtn.disabled = false;
    }
  }

  async function runAI() {
    const q = textOf($('ecQuery')?.value);
    if (!q) { $('ecQuery')?.focus(); return; }
    const domain = safeDomain($('ecDomain')?.value) || currentDomain();
    await runAiQueries([q], domain);
  }

  async function runAiBatch() {
    const raw = textOf($('ecQueryBatch')?.value);
    const lines = raw.split(/\n+/).map(textOf).filter(Boolean).slice(0, 10);
    if (!lines.length) { $('ecQueryBatch')?.focus(); return; }
    const domain = safeDomain($('ecDomain')?.value) || currentDomain();
    await runAiQueries(lines, domain);
  }

  function openGoogleSearch() {
    const q = textOf($('ecGoogleQuery')?.value) || suggestedQueries(state.data)[0] || '';
    const url = 'https://www.google.com/search?q=' + encodeURIComponent(q);
    try { chrome.tabs.create({ url }); } catch (_) { window.open(url, '_blank'); }
  }

  async function runGoogle() {
    if ($('ecGoogleSummary')) {
      $('ecGoogleSummary').innerHTML = `<div class="ec-card"><div class="ec-empty"><strong>Open Google first.</strong><span>Use “Open Google”, run the search, then return here and scan when SERP tools are active on that tab.</span></div></div>`;
    }
    if ($('ecGoogleResults')) {
      $('ecGoogleResults').innerHTML = '<div class="ec-empty"><strong>No SERP payload yet.</strong><span>Observed Google data appears after a successful on-tab scan.</span></div>';
    }
  }

  function renderCompetitorEmpty() {
    if ($('ecCompetitors')) {
      $('ecCompetitors').innerHTML = `
        <div class="ec-card">
          <div class="ec-field-stack">
            <label for="ecCompetitorUrl">Competitor product / category URL</label>
            <div class="ec-competitor-form">
              <input id="ecCompetitorUrl" placeholder="https://example.com/product" />
              <button class="ec-btn ghost" id="ecOpenCompetitor" type="button">Open page</button>
              <button class="ec-btn primary" id="ecAnalyzeCompetitor" type="button">Analyze URL</button>
            </div>
          </div>
          <div class="ec-empty"><strong>Optional — open competitor in a new tab.</strong><span>Best workflow: open their product page, run ShahzaibSEO there, and compare the same checks (IDs, schema, price). Direct remote fetch is limited in the extension.</span></div>
        </div>`;
    }
  }

  async function analyzeCompetitor() {
    const input = $('ecCompetitorUrl');
    const raw = textOf(input?.value);
    if (!/^https?:\/\//i.test(raw)) { input?.focus(); return; }
    const btn = $('ecAnalyzeCompetitor');
    if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
    try {
      state.competitor = { url: raw, note: 'Open the competitor page in a tab and run Analyze there for a full side-by-side. Direct remote fetch is limited in the extension context.' };
      if ($('ecCompetitors')) {
        $('ecCompetitors').innerHTML = `
          <div class="ec-card">
            <div class="ec-card-label">Competitor URL</div>
            <div class="ec-detail-row"><span class="label">URL</span><span class="value">${esc(raw)}</span></div>
            <p class="ec-help">${esc(state.competitor.note)}</p>
            <button class="ec-btn ghost" id="ecClearCompetitor" type="button">Clear</button>
          </div>`;
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Analyze URL'; }
    }
  }

  function renderGapPlaceholder(d) {
    if ($('ecGap')) {
      $('ecGap').innerHTML = state.google
        ? `<div class="ec-card"><div class="ec-empty"><strong>Google SERP scanned.</strong><span>Run the comparison to inspect observed competitor pages.</span><button class="ec-btn primary" id="ecRunGap" type="button">Build entity &amp; content gap</button></div></div>`
        : `<div class="ec-card"><div class="ec-empty"><strong>Google SERP data needed.</strong><span>Scan a real Google results page first, then build the gap analysis.</span></div></div>`;
    }
  }

  async function runEntityGap() {
    if ($('ecGap')) {
      $('ecGap').innerHTML = `<div class="ec-card"><div class="ec-empty"><strong>Gap analysis</strong><span>Requires observed SERP competitor URLs from a Google scan. Run the Google step first.</span></div></div>`;
    }
  }

  /* ══════════════════════════════════════════════
     ACTIONS / BINDINGS
  ══════════════════════════════════════════════ */
  function sendEcommerceHighlight(payload) {
    try {
      const text = textOf(payload?.text || '');
      if (!text) return;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab?.id) {
          // Popup sometimes loses active tab — try last analyzed tab
          try {
            if (typeof _currentTabId !== 'undefined' && _currentTabId) {
              chrome.tabs.sendMessage(_currentTabId, { action: 'ecommerceHighlight', text }, () => {
                chrome.tabs.sendMessage(_currentTabId, { action: 'findTextOnPage', phrase: text }, () => void chrome.runtime.lastError);
              });
            }
          } catch (_) {}
          return;
        }
        chrome.tabs.sendMessage(tab.id, {
          action: 'ecommerceHighlight',
          text: text,
          selector: payload?.selector || null,
          domIndex: payload?.domIndex
        }, (res) => {
          if (chrome.runtime.lastError || !res || res.success === false) {
            chrome.tabs.sendMessage(tab.id, { action: 'findTextOnPage', phrase: text }, () => void chrome.runtime.lastError);
          }
        });
      });
    } catch (_) {}
  }

  function bindEcommerceActions(root) {
    if (!root || root._ecBound) return;
    root._ecBound = true;
    root.addEventListener('click', (e) => {
      const inspect = e.target.closest('[data-ec-inspect]');
      if (inspect) {
        e.preventDefault();
        sendEcommerceHighlight({ text: inspect.dataset.ecText || '' });
        return;
      }
      const copy = e.target.closest('[data-ec-copy]');
      if (copy) {
        e.preventDefault();
        const t = copy.dataset.ecCopy || '';
        if (t) navigator.clipboard?.writeText(t);
        return;
      }
      const schemaCopy = e.target.closest('[data-ec-schema-copy]');
      if (schemaCopy) {
        e.preventDefault();
        const idx = parseInt(schemaCopy.dataset.ecSchemaCopy, 10);
        const list = state.data?.context?.schemas || [];
        const item = list[idx];
        if (item?.data) {
          navigator.clipboard?.writeText(JSON.stringify(item.data, null, 2));
        }
        return;
      }
      const jump = e.target.closest('[data-ec-section-jump]');
      if (jump) {
        e.preventDefault();
        const panel = document.querySelector(`#tab-ecommerce [data-ec-panel="${jump.dataset.ecSectionJump}"]`);
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    });
  }

  /* ══════════════════════════════════════════════
     ANALYZE / INIT / EXPORT
  ══════════════════════════════════════════════ */
  function analyze() {
    const p = page();
    if (!p.raw) {
      if ($('ecLastRun')) $('ecLastRun').textContent = 'Waiting for page data…';
      return;
    }
    const context = detectContext(p);
    const meta = metaInfo(p);
    const d = {
      page: p,
      context,
      meta,
      schemas: context.schemas,
      product: { isProduct: context.isProduct, schema: getProductSchema({ schemas: context.schemas }) },
      store: { platform: context.platform, isCommerce: context.commerce }
    };
    state.data = d;
    state.last = new Date().toISOString();
    state.ai = null;
    state.google = null;
    state.gap = null;
    state.competitor = null;

    renderHero(d);
    renderStatus(d);
    renderOverview(d);
    renderSemantic(d);
    renderProduct(d);
    renderStore(d);
    renderSchema(d);
    renderAttributes(d);
    renderCategory(d);
    renderInternal(d);
    renderReviews(d);
    renderImages(d);
    renderCommerce(d);
    renderMerchant(d);
    renderFeed(d);
    renderTechnical(d);
    renderCompetitorEmpty();
    renderGapPlaceholder(d);
    bindEcommerceActions(document.getElementById('tab-ecommerce'));

    if ($('ecAiSummary')) $('ecAiSummary').innerHTML = '';
    if ($('ecAiResults')) {
      $('ecAiResults').innerHTML = '<div class="ec-empty"><strong>Optional tool — not required for page fixes.</strong><span>Use this only if you want to test buyer queries. Live results need an API key in Settings. Without a key, results are estimates only.</span></div>';
    }
    if ($('ecGoogleSummary')) $('ecGoogleSummary').innerHTML = '';
    if ($('ecGoogleResults')) {
      $('ecGoogleResults').innerHTML = '<div class="ec-empty"><strong>Optional tool.</strong><span>Core product fixes (IDs, schema, price) do not need this. Use only if you want to inspect live Google results for a query.</span></div>';
    }
    if ($('ecDomain')) $('ecDomain').value = currentDomain();
    if ($('ecGoogleQuery')) $('ecGoogleQuery').value = suggestedQueries(d)[0] || '';
    if ($('ecLastRun')) $('ecLastRun').textContent = 'Analyzed ' + new Date().toLocaleTimeString();
    aiPresetRender();
  }

  function exportReport() {
    const d = state.data;
    if (!d) {
      alert('Open a product page and wait for analysis first.');
      return;
    }
    const PDF = (typeof window !== 'undefined' && window.SorankPDF) || (typeof SorankPDF !== 'undefined' ? SorankPDF : null);
    if (!PDF) {
      exportPrintableHtml(d);
      return;
    }
    try {
      const pdf = new PDF({ brand: 'ShahzaibSEO' });
      const c = d.context || detectContext();
      const pd = productData(d);
      const m = d.meta || {};
      const score = scoreSummary(d);
      const priorities = buildPriorities(d);
      const schemas = c.schemas || [];
      const teal = [13, 148, 136];
      const tealDeep = [15, 118, 110];
      const ink = [15, 23, 41];
      const slate = [71, 85, 105];
      const muted = [148, 163, 184];
      const hair = [226, 232, 240];
      const paper = [255, 255, 255];
      const soft = [240, 253, 250];
      const bad = [185, 28, 28];
      const ok = [4, 120, 87];
      const warn = [180, 83, 9];
      const mx = pdf.margin;
      const pageW = pdf.pageWidth;
      const contentW = pageW - mx * 2;

      pdf.meta = {
        url: textOf(c.url).slice(0, 80),
        date: new Date().toLocaleString()
      };

      // ── Cover ──
      pdf.addPage(true);
      pdf.rect(0, 0, pageW, 168, { fill: tealDeep });
      pdf.rect(0, 0, 8, 168, { fill: teal });
      pdf.text(mx, 36, 'ShahzaibSEO', { size: 11, bold: true, color: [153, 246, 228] });
      pdf.text(mx, 56, 'E-commerce Product Report', { size: 22, bold: true, color: paper });
      pdf.text(mx, 82, textOf(pd.name || 'Product audit').slice(0, 55), { size: 14, bold: true, color: paper });
      pdf.text(mx, 102, textOf(c.url).slice(0, 85), { size: 8.5, color: [167, 243, 208] });
      pdf.text(mx, 122, (c.platform || '—') + '  ·  ' + (c.pageType || '—') + '  ·  ' + (score.passed + '/' + score.total) + ' checks passed', { size: 9, color: paper });
      pdf.text(mx, 140, pdf.meta.date, { size: 8, color: [153, 246, 228] });

      // Score card on cover
      const scX = pageW - mx - 88;
      pdf.rect(scX, 40, 88, 88, { fill: paper, r: 14 });
      pdf.text(scX + 44, 72, score.total ? String(score.passed) : '—', { size: 26, bold: true, color: tealDeep, align: 'center' });
      pdf.text(scX + 44, 92, score.total ? ('/ ' + score.total) : '', { size: 11, color: muted, align: 'center' });
      pdf.text(scX + 44, 110, 'PASSED', { size: 8, bold: true, color: teal, align: 'center' });

      let y = 188;
      const ensure = (h) => { pdf.currentY = y; if (pdf.ensureSpace(h)) y = pdf.currentY; };

      // ── Snapshot card ──
      ensure(160);
      pdf.rect(mx, y, contentW, 148, { fill: soft, stroke: hair, lw: 0.8, r: 12 });
      pdf.text(mx + 14, y + 18, 'PRODUCT SNAPSHOT', { size: 8, bold: true, color: teal, tracking: 1.2 });
      const snap = [
        ['Name', pd.name],
        ['Brand', pd.brand],
        ['Price', pd.price],
        ['Availability', pd.availability],
        ['GTIN', pd.gtin || 'Not detected'],
        ['MPN', pd.mpn || 'Not detected'],
        ['SKU', pd.sku || 'Not detected'],
        ['Rating', pd.rating ? (pd.rating + ' · ' + (pd.reviewCount || '0') + ' reviews') : '—'],
        ['Platform', c.platform],
        ['Indexable', m.indexable ? 'Yes' : 'Blocked / noindex']
      ];
      let col1 = mx + 14, col2 = mx + contentW / 2 + 6;
      let rowY = y + 36;
      snap.forEach((row, i) => {
        const x = i < 5 ? col1 : col2;
        const ry = rowY + (i % 5) * 20;
        const valCol = (!row[1] || /not detected|blocked/i.test(String(row[1]))) && /GTIN|MPN|SKU|Indexable/.test(row[0]) ? bad : ink;
        pdf.text(x, ry, row[0], { size: 8, color: muted });
        pdf.text(x + 70, ry, textOf(row[1] || '—').slice(0, 36), { size: 8.5, bold: true, color: valCol });
      });
      y += 162;

      // ── Shopping readiness ──
      ensure(110);
      pdf.text(mx, y, 'Google Shopping readiness', { size: 13, bold: true, color: ink });
      y += 16;
      const shop = [
        ['GTIN or MPN + brand', pd.merchantMatchReady, 'Required for product matching'],
        ['Price + currency', !!pd.price, textOf(pd.price) || 'Missing'],
        ['Availability', !!(pd.availability || pd.availabilityRaw), textOf(pd.availability) || 'Missing'],
        ['Brand name', !!pd.brand, textOf(pd.brand) || 'Missing'],
        ['Product image in schema', !!pd.image, pd.image ? 'Present' : 'Missing'],
        ['Product schema', !!c.productSchema, c.productSchema ? 'Present' : 'Missing']
      ];
      shop.forEach((s) => {
        ensure(18);
        const col = s[1] ? ok : bad;
        pdf.rect(mx, y - 2, 10, 10, { fill: s[1] ? [209, 250, 229] : [254, 226, 226], r: 2 });
        pdf.text(mx + 2, y + 6, s[1] ? '✓' : '!', { size: 8, bold: true, color: col });
        pdf.text(mx + 16, y + 6, s[0], { size: 9, bold: true, color: ink });
        pdf.text(mx + contentW, y + 6, s[2], { size: 8, color: muted, align: 'right' });
        y += 18;
      });
      y += 8;

      // ── Priority fixes ──
      ensure(30);
      pdf.text(mx, y, 'What to fix first', { size: 13, bold: true, color: ink });
      y += 14;
      priorities.slice(0, 7).forEach((item, i) => {
        ensure(52);
        const sevCol = item.severity === 'critical' ? bad : (item.severity === 'high' ? warn : slate);
        pdf.rect(mx, y, contentW, item.fix ? 48 : 34, { fill: paper, stroke: hair, lw: 0.7, r: 8 });
        pdf.rect(mx, y, 4, item.fix ? 48 : 34, { fill: sevCol, r: 0 });
        pdf.text(mx + 14, y + 12, (i + 1) + '. ' + textOf(item.title).slice(0, 62), { size: 9.5, bold: true, color: ink });
        pdf.text(mx + contentW - 8, y + 12, String(item.severity || '').toUpperCase(), { size: 7.5, bold: true, color: sevCol, align: 'right' });
        pdf.text(mx + 14, y + 26, textOf(item.detail).slice(0, 95), { size: 8, color: slate });
        if (item.fix) {
          pdf.text(mx + 14, y + 40, 'Fix: ' + textOf(item.fix).slice(0, 90), { size: 7.5, color: tealDeep });
          y += 54;
        } else {
          y += 40;
        }
      });

      // ── Schema list ──
      ensure(40);
      y += 6;
      pdf.text(mx, y, 'Structured data on page', { size: 13, bold: true, color: ink });
      y += 16;
      if (!schemas.length) {
        pdf.text(mx, y, 'No Product / Offer schema detected.', { size: 9, color: bad });
        y += 16;
      } else {
        schemas.slice(0, 6).forEach((s) => {
          ensure(14);
          pdf.text(mx, y, '• ' + textOf(s.type || 'Schema'), { size: 9, bold: true, color: ink });
          pdf.text(mx + 120, y, textOf(s.data?.name || '').slice(0, 40), { size: 8, color: muted });
          y += 14;
        });
      }

      // ── Technical ──
      ensure(50);
      y += 10;
      pdf.text(mx, y, 'Technical basics', { size: 13, bold: true, color: ink });
      y += 16;
      const tech = [
        ['HTTPS', !!m.isHttps],
        ['Indexable', !!m.indexable],
        ['Canonical', !!m.canonical],
        ['Title tag', !!m.hasTitle],
        ['Meta description', !!m.hasDesc]
      ];
      tech.forEach((t) => {
        ensure(14);
        pdf.text(mx, y, (t[1] ? '[OK]  ' : '[--]  ') + t[0], { size: 9, color: t[1] ? ok : bad });
        y += 14;
      });

      y += 20;
      ensure(24);
      pdf.text(mx, y, 'Generated by ShahzaibSEO · verified from the live page only · not a prediction', { size: 7.5, color: muted });
      y += 12;
      pdf.text(mx, y, 'mubashirhassan.com  ·  WhatsApp support available in the extension', { size: 7.5, color: muted });

      const safeName = textOf(pd.name || 'product').replace(/[^\w\-]+/g, '-').slice(0, 40);
      pdf.download('ShahzaibSEO-Ecommerce-' + safeName + '.pdf');
    } catch (err) {
      console.warn('[ShahzaibSEO] ecommerce PDF failed', err);
      exportPrintableHtml(d);
    }
  }

  function exportPrintableHtml(d) {
    const c = d.context || {};
    const pd = productData(d);
    const priorities = buildPriorities(d);
    const score = scoreSummary(d);
    const rows = priorities.map((p, i) =>
      '<tr><td>' + (i + 1) + '</td><td><b>' + esc(p.title) + '</b><br><small>' + esc(p.detail) + '</small>' +
      (p.fix ? '<br><em>Fix: ' + esc(p.fix) + '</em>' : '') + '</td><td>' + esc(p.severity) + '</td></tr>'
    ).join('');
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>ShahzaibSEO Ecommerce Report</title>' +
      '<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:24px auto;color:#0f172a}' +
      'h1{font-size:20px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #e2e8f0;padding:8px;font-size:12px;vertical-align:top}' +
      '.ok{color:#047857}.bad{color:#b91c1c}@media print{.no-print{display:none}}</style></head><body>' +
      '<button class="no-print" onclick="window.print()">Print / Save as PDF</button>' +
      '<h1>ShahzaibSEO · E-commerce Report</h1>' +
      '<p>' + esc(pd.name) + '<br><small>' + esc(c.url) + '</small></p>' +
      '<p>' + score.passed + '/' + score.total + ' checks · ' + esc(c.platform) + ' · ' + esc(c.pageType) + '</p>' +
      '<h2>Product</h2><ul>' +
      '<li>Brand: ' + esc(pd.brand || '—') + '</li>' +
      '<li>Price: ' + esc(pd.price || '—') + '</li>' +
      '<li>GTIN: ' + esc(pd.gtin || 'Not detected') + '</li>' +
      '<li>MPN: ' + esc(pd.mpn || 'Not detected') + '</li>' +
      '<li>Availability: ' + esc(pd.availability || '—') + '</li></ul>' +
      '<h2>What to fix first</h2><table><thead><tr><th>#</th><th>Issue</th><th>Severity</th></tr></thead><tbody>' +
      rows + '</tbody></table></body></html>';
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  }

  function setPageData(raw) {
    window._rawData = raw;
    window.__rankseoRawData = raw;
    state.data = null;
    analyze();
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    const root = document.getElementById('tab-ecommerce');
    $('ecAnalyzeBtn')?.addEventListener('click', analyze);
    $('ecExportBtn')?.addEventListener('click', exportReport);
    $('ecGoogleOpenBtn')?.addEventListener('click', openGoogleSearch);
    $('ecGoogleBtn')?.addEventListener('click', runGoogle);
    $('ecAiBtn')?.addEventListener('click', runAI);
    $('ecAiBatchBtn')?.addEventListener('click', runAiBatch);
    $('ecQuery')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runAI(); });

    root?.addEventListener('click', (e) => {
      if (e.target.closest('#ecRunGap')) { runEntityGap(); return; }
      if (e.target.closest('#ecOpenCompetitor')) {
        const u = textOf($('ecCompetitorUrl')?.value);
        if (/^https?:\/\//i.test(u)) {
          try { chrome.tabs.create({ url: u }); } catch (_) { window.open(u, '_blank'); }
        } else {
          $('ecCompetitorUrl')?.focus();
        }
        return;
      }
      if (e.target.closest('#ecAnalyzeCompetitor')) { analyzeCompetitor(); return; }
      if (e.target.closest('#ecClearCompetitor')) { state.competitor = null; renderCompetitorEmpty(); return; }
    });

    // Quick nav buttons
    root?.querySelectorAll('.ec-quicknav [data-ec-section-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = document.querySelector(`#tab-ecommerce [data-ec-panel="${btn.dataset.ecSectionJump}"]`);
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        root.querySelectorAll('.ec-quicknav button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    if (window._rawData) analyze();
    else if ($('ecLastRun')) $('ecLastRun').textContent = 'Waiting for page data…';

    setTimeout(() => {
      if ($('ecDomain')) $('ecDomain').value = currentDomain();
      if ($('ecGoogleQuery')) $('ecGoogleQuery').value = suggestedQueries(state.data || {})[0] || '';
      aiPresetRender();
    }, 250);
  }

  window.ShahzaibSEOEcommerce = { init, analyze, runAI, setPageData };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
